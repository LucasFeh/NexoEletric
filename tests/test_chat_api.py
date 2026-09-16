# -*- coding: utf-8 -*-
"""O parser do stream da Anthropic — com um SSE GRAVADO, sem encostar na rede.

    python tests/test_chat_api.py

O `tools/chat/claude_api.py` é o único ponto do hub que fala com api.anthropic.com. Ele não
pode ser testado contra a API de verdade (custa dinheiro, precisa de chave e não roda no
deploy), então o teste injeta o `transporte`: uma função que devolve as linhas de um stream
escrito aqui dentro, byte a byte do jeito que a API manda.

O que este teste prende, nesta ordem:

  1. SEM CHAVE não há traceback: sai UM evento de erro que diz onde a chave mora
     (ANTHROPIC_API_KEY, no senha.env) — e o transporte nem é chamado;
  2. o stream feliz: texto partido em vários deltas remontado NA ORDEM, `tool_use` partido em
     três `partial_json` virando UMA entrada já parseada, `: ping` e `event:` ignorados, e um
     evento cujo `data:` vem quebrado em duas linhas (o SSE permite) ainda entendido;
  3. o corpo e os cabeçalhos do pedido: modelo trocável por parâmetro, `stream:true`,
     x-api-key e anthropic-version;
  4. o USO de tokens não dobra: a API manda o total acumulado a cada `message_delta`, e
     somar em vez de tomar o máximo dobraria o dólar que a tela mostra;
  5. erro NO MEIO do stream (o `overloaded_error`) vira evento, com o texto que já tinha
     chegado preservado e nada depois dele;
  6. stream CORTADO antes do `message_stop` vira evento de erro e não exceção — e a
     ferramenta que estava chegando pela metade NÃO é emitida (entregar argumento
     incompleto ao operador é pior que não entregar: ele escreveria no projeto com ele);
  7. 401/429/500/529 viram ErroAPI com frase em português que diz o que fazer, inclusive
     pelo caminho real do urllib (HTTPError, cujo corpo tem o JSON de erro da API);
  8. timeout e defeito de código no meio do stream também viram evento — nada sobe pelo
     Flask, porque lá em cima o SSE do hub já começou e uma exceção só cortaria a conexão.

A rede fica trancada na marra: `urlopen` é trocado por uma função que levanta. Se alguma
linha deste arquivo tentar sair para a internet, o teste acusa em vez de travar.
"""
import io
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'chat'))

import claude_api as C            # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

PERGUNTA = [{'role': 'user', 'content': 'afasta o R5 do conector'}]
CHAVE = 'sk-ant-de-mentira'


def linhas(*eventos):
    """as linhas do SSE do jeito que a API manda: `event:`, `data:` e linha em branco.

    Item que já for bytes entra cru — é assim que entram o `: ping` e o `data:` quebrado.
    """
    saida = []
    for ev in eventos:
        if isinstance(ev, bytes):
            saida.append(ev)
            continue
        nome, dado = ev
        saida.append(('event: %s' % nome).encode('utf-8'))
        saida.append(b'data: ' + json.dumps(dado).encode('utf-8'))
        saida.append(b'')
    return saida


def fita(linhas_do_stream, registro=None):
    """transporte falso: guarda o pedido em `registro` e devolve o stream gravado"""
    def transporte(url, corpo, cabecalhos):
        if registro is not None:
            registro['url'] = url
            registro['corpo'] = json.loads(corpo.decode('utf-8'))
            registro['cabecalhos'] = cabecalhos
        for linha in linhas_do_stream:
            yield linha
    return transporte


def tropeco(excecao, antes=()):
    """transporte que entrega `antes` e então levanta — o cano caindo no meio"""
    def transporte(url, corpo, cabecalhos):
        for linha in antes:
            yield linha
        raise excecao
    return transporte


def textos(evs):
    return ''.join(e['s'] for e in evs if e['t'] == 'texto')


def so(evs, t):
    return [e for e in evs if e['t'] == t]


# ── a rede fica trancada ──
def _nao_toque(*a, **k):
    raise AssertionError('o teste tentou abrir conexão de verdade com a internet')


urlopen_real = C.urllib.request.urlopen
C.urllib.request.urlopen = _nao_toque
chave_real = os.environ.get('ANTHROPIC_API_KEY')

try:
    # ── 1. sem chave ──
    # O pior jeito de isto falhar é um KeyError subindo pelo Flask no meio de um SSE já
    # começado: a tela para no meio de uma frase e ninguém sabe por quê.
    os.environ.pop('ANTHROPIC_API_KEY', None)
    assert C.chave() is None, 'chave() tem que devolver None quando a variável não existe'

    gerador = C.conversa(PERGUNTA, transporte=fita([]))
    evs = list(gerador)
    assert len(evs) == 1 and evs[0]['t'] == 'erro', evs
    assert 'ANTHROPIC_API_KEY' in evs[0]['msg'], 'a mensagem tem que dizer ONDE a chave vai'
    assert 'senha.env' in evs[0]['msg'], 'e qual arquivo é esse lugar no servidor'
    assert 'HTTP' in evs[0]['msg'], 'e por que ela não vai num arquivo servido'

    # o transporte nem chega a ser chamado: sem chave não se monta pedido nenhum
    def nunca(url, corpo, cabecalhos):
        raise AssertionError('montou o pedido mesmo sem chave')
        yield b''                                            # pragma: no cover

    assert [e['t'] for e in C.conversa(PERGUNTA, transporte=nunca)] == ['erro']

    os.environ['ANTHROPIC_API_KEY'] = '  %s  ' % CHAVE
    assert C.chave() == CHAVE, 'espaço em volta da chave no env_file é o erro mais comum'
    os.environ['ANTHROPIC_API_KEY'] = ''
    assert C.chave() is None, 'variável vazia é o mesmo que não ter chave'
    os.environ['ANTHROPIC_API_KEY'] = CHAVE
    print('(1) sem chave sai evento de erro acionável, e nenhum pedido é montado ok')

    # ── 2 e 3. o stream feliz ──
    # texto em quatro deltas, uma ferramenta em três partial_json, um ping no meio e um
    # message_delta com o `data:` quebrado em duas linhas.
    FELIZ = linhas(
        ('message_start', {'type': 'message_start', 'message': {
            'id': 'msg_01', 'model': 'claude-sonnet-5', 'role': 'assistant',
            'usage': {'input_tokens': 1200, 'output_tokens': 2,
                      'cache_creation_input_tokens': 0, 'cache_read_input_tokens': 0}}}),
        ('content_block_start', {'type': 'content_block_start', 'index': 0,
                                 'content_block': {'type': 'text', 'text': ''}}),
        ('content_block_delta', {'type': 'content_block_delta', 'index': 0,
                                 'delta': {'type': 'text_delta', 'text': 'Vou mover '}}),
        ('content_block_delta', {'type': 'content_block_delta', 'index': 0,
                                 'delta': {'type': 'text_delta', 'text': 'o R5 para '}}),
        b': ping',
        b'',
        ('ping', {'type': 'ping'}),
        ('content_block_delta', {'type': 'content_block_delta', 'index': 0,
                                 'delta': {'type': 'text_delta', 'text': 'longe do '}}),
        ('content_block_delta', {'type': 'content_block_delta', 'index': 0,
                                 'delta': {'type': 'text_delta', 'text': 'conector.'}}),
        ('content_block_stop', {'type': 'content_block_stop', 'index': 0}),
        ('content_block_start', {'type': 'content_block_start', 'index': 1,
                                 'content_block': {'type': 'tool_use', 'id': 'toolu_09',
                                                   'name': 'pcb_mover', 'input': {}}}),
        ('content_block_delta', {'type': 'content_block_delta', 'index': 1,
                                 'delta': {'type': 'input_json_delta',
                                           'partial_json': '{"ref": "R'}}),
        ('content_block_delta', {'type': 'content_block_delta', 'index': 1,
                                 'delta': {'type': 'input_json_delta',
                                           'partial_json': '5", "x": 12.7,'}}),
        ('content_block_delta', {'type': 'content_block_delta', 'index': 1,
                                 'delta': {'type': 'input_json_delta',
                                           'partial_json': ' "y": 8.4}'}}),
        ('content_block_stop', {'type': 'content_block_stop', 'index': 1}),
        # o `data:` deste evento vem em DUAS linhas: a spec do SSE junta as duas
        b'event: message_delta',
        b'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},',
        b'data: "usage":{"output_tokens":57}}',
        b'',
        ('message_stop', {'type': 'message_stop'}),
    )

    pedido = {}
    evs = list(C.conversa(PERGUNTA, ferramentas=[{'name': 'pcb_mover'}],
                          sistema='você é o operador', transporte=fita(FELIZ, pedido)))

    assert textos(evs) == 'Vou mover o R5 para longe do conector.', textos(evs)
    ferramentas = so(evs, 'ferramenta')
    assert len(ferramentas) == 1, 'a ferramenta tem que sair UMA vez: %r' % (ferramentas,)
    assert ferramentas[0]['id'] == 'toolu_09' and ferramentas[0]['nome'] == 'pcb_mover'
    assert ferramentas[0]['entrada'] == {'ref': 'R5', 'x': 12.7, 'y': 8.4}, \
        'os três pedaços do partial_json não remontaram: %r' % (ferramentas[0]['entrada'],)
    # ordem: todo o texto antes da ferramenta, e o fim por último
    assert [e['t'] for e in evs] == ['texto'] * 4 + ['ferramenta', 'fim'], \
        [e['t'] for e in evs]
    fim = evs[-1]
    assert fim['motivo'] == 'tool_use', fim
    assert fim['uso']['entrada'] == 1200 and fim['uso']['saida'] == 57, fim['uso']
    print('(2) texto remontado na ordem, ferramenta inteira e parseada, ping ignorado, '
          '`data:` em duas linhas entendido ok')

    assert pedido['url'] == C.URL and pedido['url'].startswith('https://'), pedido['url']
    assert pedido['corpo']['stream'] is True, 'sem stream:true não há SSE nenhum'
    assert pedido['corpo']['model'] == C.MODELO_PADRAO, pedido['corpo']['model']
    assert pedido['corpo']['max_tokens'] == 8192, pedido['corpo']['max_tokens']
    assert pedido['corpo']['messages'] == PERGUNTA
    assert pedido['corpo']['system'] == 'você é o operador'
    assert pedido['corpo']['tools'] == [{'name': 'pcb_mover'}]
    assert pedido['cabecalhos']['x-api-key'] == CHAVE
    assert pedido['cabecalhos']['anthropic-version'] == '2023-06-01'
    assert pedido['cabecalhos']['content-type'] == 'application/json'

    # modelo trocável por parâmetro, e a chave também
    for pedido_ev, modelo, esperado in (({}, 'claude-opus-5', 'claude-opus-5'),
                                        ({}, 'claude-haiku-4-5-20251001', 'claude-haiku-4-5'),
                                        ({}, None, C.MODELO_PADRAO),
                                        ({}, 'claude-x-9', 'claude-x-9')):
        list(C.conversa(PERGUNTA, modelo=modelo, max_tokens=4096, chave='outra',
                        transporte=fita(FELIZ, pedido_ev)))
        assert pedido_ev['corpo']['model'] == esperado, (modelo, pedido_ev['corpo']['model'])
        assert pedido_ev['corpo']['max_tokens'] == 4096
        assert pedido_ev['cabecalhos']['x-api-key'] == 'outra', 'a chave do parâmetro manda'
    assert C.MODELO_PADRAO in C.MODELOS and len(C.MODELOS) == 3, C.MODELOS
    print('(3) corpo e cabeçalhos do pedido; modelo trocável, apelido com data resolvido, '
          'modelo desconhecido atravessa ok')

    # ── 4. o uso não dobra ──
    # A API manda o TOTAL acumulado a cada message_delta. Somar dobraria o dólar da tela.
    DOIS_DELTAS = linhas(
        ('message_start', {'type': 'message_start', 'message': {
            'usage': {'input_tokens': 1200, 'output_tokens': 2,
                      'cache_read_input_tokens': 900, 'cache_creation_input_tokens': 300}}}),
        ('message_delta', {'type': 'message_delta', 'delta': {'stop_reason': 'end_turn'},
                           'usage': {'output_tokens': 57}}),
        ('message_delta', {'type': 'message_delta', 'delta': {},
                           'usage': {'input_tokens': 1200, 'output_tokens': 57}}),
        ('message_stop', {'type': 'message_stop'}),
    )
    uso = list(C.conversa(PERGUNTA, transporte=fita(DOIS_DELTAS)))[-1]['uso']
    assert uso == {'entrada': 1200, 'saida': 57, 'cache_escrita': 300,
                   'cache_leitura': 900}, uso
    assert C.custo({'entrada': 1000000, 'saida': 0}, 'claude-sonnet-5') == 2.0
    assert C.custo({'entrada': 0, 'saida': 1000000}, 'claude-opus-5') == 25.0
    assert C.custo({'entrada': 0, 'saida': 0, 'cache_leitura': 1000000},
                   'claude-sonnet-5') == 0.2, 'leitura de cache custa 1/10 da entrada'
    assert C.custo(uso, 'modelo-que-nao-existe') == 0.0, 'preço desconhecido não inventa conta'
    print('(4) uso de tokens não dobra com dois message_delta, e o custo sai em dólar ok')

    # ── 5. erro no meio do stream ──
    SOBRECARGA = linhas(
        ('message_start', {'type': 'message_start', 'message': {
            'usage': {'input_tokens': 10, 'output_tokens': 1}}}),
        ('content_block_start', {'type': 'content_block_start', 'index': 0,
                                 'content_block': {'type': 'text', 'text': ''}}),
        ('content_block_delta', {'type': 'content_block_delta', 'index': 0,
                                 'delta': {'type': 'text_delta', 'text': 'Vou '}}),
        ('error', {'type': 'error', 'error': {'type': 'overloaded_error',
                                              'message': 'Overloaded'}}),
        # a API fecha o cano aqui; se mandasse mais, não podia virar resposta
        ('content_block_delta', {'type': 'content_block_delta', 'index': 0,
                                 'delta': {'type': 'text_delta', 'text': 'mover'}}),
        ('message_stop', {'type': 'message_stop'}),
    )
    evs = list(C.conversa(PERGUNTA, transporte=fita(SOBRECARGA)))
    assert [e['t'] for e in evs] == ['texto', 'erro'], [e['t'] for e in evs]
    assert textos(evs) == 'Vou ', 'o que já tinha chegado tem que ficar'
    assert evs[-1]['status'] == 529, evs[-1]
    assert 'de novo' in evs[-1]['msg'] and '529' in evs[-1]['msg'], evs[-1]['msg']
    assert 'Overloaded' in evs[-1]['msg'], 'o que a API disse entra na frase'
    print('(5) erro no meio do stream vira evento, o texto anterior fica e nada vem depois ok')

    # ── 6. o corte ──
    # Cortado no meio do partial_json: é o caso em que emitir a ferramenta pela metade seria
    # o operador escrevendo no projeto com meio argumento.
    CORTADO = linhas(
        ('message_start', {'type': 'message_start', 'message': {
            'usage': {'input_tokens': 1200, 'output_tokens': 1}}}),
        ('content_block_start', {'type': 'content_block_start', 'index': 0,
                                 'content_block': {'type': 'text', 'text': ''}}),
        ('content_block_delta', {'type': 'content_block_delta', 'index': 0,
                                 'delta': {'type': 'text_delta', 'text': 'Vou mover '}}),
        ('content_block_stop', {'type': 'content_block_stop', 'index': 0}),
        ('content_block_start', {'type': 'content_block_start', 'index': 1,
                                 'content_block': {'type': 'tool_use', 'id': 'toolu_09',
                                                   'name': 'pcb_mover', 'input': {}}}),
        ('content_block_delta', {'type': 'content_block_delta', 'index': 1,
                                 'delta': {'type': 'input_json_delta',
                                           'partial_json': '{"ref": "R'}}),
    ) + [b'event: content_block_delta', b'data: {"type":"content_block_delta","index":1,"del']

    evs = list(C.conversa(PERGUNTA, transporte=fita(CORTADO)))
    assert so(evs, 'ferramenta') == [], 'ferramenta pela metade NÃO pode ser emitida'
    assert so(evs, 'fim') == [], 'stream cortado não tem fim'
    assert evs[-1]['t'] == 'erro' and evs[-1]['status'] == 0, evs[-1]
    assert 'cortada' in evs[-1]['msg'], evs[-1]['msg']
    assert textos(evs) == 'Vou mover ', 'o que chegou antes do corte fica'

    # e o argumento quebrado que FECHA o bloco (o content_block_stop chega, o JSON não)
    QUEBRADO = linhas(
        ('content_block_start', {'type': 'content_block_start', 'index': 0,
                                 'content_block': {'type': 'tool_use', 'id': 'toolu_09',
                                                   'name': 'pcb_mover', 'input': {}}}),
        ('content_block_delta', {'type': 'content_block_delta', 'index': 0,
                                 'delta': {'type': 'input_json_delta',
                                           'partial_json': '{"ref": "R'}}),
        ('content_block_stop', {'type': 'content_block_stop', 'index': 0}),
        ('message_stop', {'type': 'message_stop'}),
    )
    evs = list(C.conversa(PERGUNTA, transporte=fita(QUEBRADO)))
    assert [e['t'] for e in evs] == ['erro'], [e['t'] for e in evs]
    assert 'pcb_mover' in evs[0]['msg'], evs[0]['msg']

    # ferramenta SEM argumento: nenhum partial_json chega, e `{}` é a entrada certa
    SEM_ARG = linhas(
        ('content_block_start', {'type': 'content_block_start', 'index': 0,
                                 'content_block': {'type': 'tool_use', 'id': 'toolu_10',
                                                   'name': 'projeto_atual', 'input': {}}}),
        ('content_block_stop', {'type': 'content_block_stop', 'index': 0}),
        ('message_delta', {'type': 'message_delta', 'delta': {'stop_reason': 'tool_use'},
                           'usage': {'output_tokens': 9}}),
        ('message_stop', {'type': 'message_stop'}),
    )
    evs = list(C.conversa(PERGUNTA, transporte=fita(SEM_ARG)))
    assert so(evs, 'ferramenta')[0]['entrada'] == {}, evs
    print('(6) corte vira evento de erro (não exceção), e ferramenta incompleta não sai ok')

    # ── 7. os HTTP ──
    erro = C.erro_de_status(401, b'{"type":"error","error":{"type":"authentication_error",'
                                 b'"message":"invalid x-api-key"}}')
    assert isinstance(erro, C.ErroAPI) and erro.status == 401
    assert 'ANTHROPIC_API_KEY' in erro.mensagem and 'senha.env' in erro.mensagem, erro.mensagem
    assert 'invalid x-api-key' in erro.mensagem

    for status, precisa in ((429, 'de novo'), (500, 'de novo'), (529, 'de novo'),
                            (403, '403'), (404, 'modelo'), (413, 'anexos'), (400, '400')):
        e = C.erro_de_status(status)
        assert e.status == status and precisa in e.mensagem, (status, e.mensagem)
    # proxy devolvendo HTML no lugar do JSON de erro não pode virar exceção
    assert C.erro_de_status(502, b'<html>502 Bad Gateway</html>').status == 502

    # o caminho real do urllib: HTTPError É a resposta, e o corpo dela tem o JSON de erro
    corpo_429 = b'{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}'
    C.urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(
        C.urllib.error.HTTPError(C.URL, 429, 'Too Many Requests', {},
                                 io.BytesIO(corpo_429)))
    evs = list(C.conversa(PERGUNTA))
    assert [e['t'] for e in evs] == ['erro'] and evs[0]['status'] == 429, evs
    assert 'slow down' in evs[0]['msg'] and 'de novo' in evs[0]['msg'], evs[0]['msg']

    # e o DNS/rota morrendo antes de qualquer resposta
    C.urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(
        C.urllib.error.URLError('Name or service not known'))
    evs = list(C.conversa(PERGUNTA))
    assert evs[0]['t'] == 'erro' and evs[0]['status'] == 0, evs
    assert 'api.anthropic.com' in evs[0]['msg'], evs[0]['msg']
    C.urllib.request.urlopen = _nao_toque
    print('(7) 401/403/404/413/429/500/529 viram frase acionável, e o HTTPError do urllib '
          'é lido pelo corpo ok')

    # ── 8. timeout e defeito de código ──
    metade = linhas(
        ('content_block_start', {'type': 'content_block_start', 'index': 0,
                                 'content_block': {'type': 'text', 'text': ''}}),
        ('content_block_delta', {'type': 'content_block_delta', 'index': 0,
                                 'delta': {'type': 'text_delta', 'text': 'Vou mover '}}),
    )
    for excecao, precisa in ((TimeoutError('timed out'), 'caiu'),
                             (ConnectionResetError('connection reset'), 'caiu'),
                             (ValueError('defeito meu'), 'defeito do hub')):
        evs = list(C.conversa(PERGUNTA, transporte=tropeco(excecao, metade)))
        assert textos(evs) == 'Vou mover ', (excecao, evs)
        assert evs[-1]['t'] == 'erro' and precisa in evs[-1]['msg'], (excecao, evs[-1])
    # conversa vazia é erro, não 400 pago na API
    assert list(C.conversa([], transporte=nunca))[0]['t'] == 'erro'
    print('(8) timeout, conexão resetada e defeito de código viram evento — nada sobe '
          'pelo Flask ok')

    print('test_chat_api OK (o stream da Anthropic vira os quatro eventos do contrato, e '
          'todo tropeço vira evento de erro legível)')
finally:
    C.urllib.request.urlopen = urlopen_real
    if chave_real is None:
        os.environ.pop('ANTHROPIC_API_KEY', None)
    else:
        os.environ['ANTHROPIC_API_KEY'] = chave_real
