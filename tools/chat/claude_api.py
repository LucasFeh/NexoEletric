# -*- coding: utf-8 -*-
"""O cano até a API da Anthropic, em biblioteca padrão — só `urllib`, `json` e `os`.

    for ev in conversa(mensagens, ferramentas=FERRAMENTAS, sistema=PROMPT):
        ...  # {'t':'texto'|'ferramenta'|'fim'|'erro', ...}

Nada de SDK, nada de `requests`, nada de node. A máquina do hub é o servidor de ERP da
empresa (Odoo): o container roda com `mem_limit 1g` e `pids_limit 256`, e mexer no
`requirements.txt` faz o deploy RECONSTRUIR a imagem. Uma dependência nova para falar com
um endereço só não paga esse preço — a decisão de arquitetura foi tomada antes deste
arquivo existir, e o que está aqui é a conta dela: ~200 linhas de SSE no lugar do
`pip install anthropic`.

Medido nesta bancada: o container alcança api.anthropic.com (401 sem chave = alcança).

O contrato para quem chama (o `chatserver.py`, que retransmite isto como SSE do hub) é um
ITERADOR DE EVENTOS SIMPLES, um dict por vez:

    {'t':'texto','s':'...'}                                       pedaço de texto, na ordem
    {'t':'ferramenta','id':'toolu_…','nome':'…','entrada':{…}}    entrada COMPLETA e parseada
    {'t':'fim','motivo':'end_turn|tool_use|max_tokens','uso':{…}}
    {'t':'erro','msg':'…','status':N}

**`conversa` nunca levanta exceção.** Todo tropeço — chave que falta, 401, 429, a conexão
caindo no meio da resposta — sai como `{'t':'erro'}` e a iteração acaba. O motivo é o que
está do outro lado: quando o primeiro evento chega, o `chatserver` já mandou os cabeçalhos
do SSE, e daí em diante uma exceção subindo pelo Flask não vira página de erro nenhuma —
vira conexão cortada, com a tela do usuário parada no meio de uma frase e sem uma palavra
de explicação. Erro que o usuário lê é melhor que traceback que ninguém vê.

`ErroAPI` continua existindo e é ela que CLASSIFICA o tropeço (status + mensagem em
português, acionável). Quem quiser a exceção chama `erro_de_status`/`erro_de_stream`;
`conversa` a converte em evento na saída.

`transporte` é injeção de teste: `funcao(url, corpo_bytes, cabecalhos)` devolvendo um
iterador de linhas (bytes) do SSE. O padrão é `urllib`. É por aí que o
`tests/test_chat_api.py` exercita o parser com um stream gravado, sem tocar a rede.
"""
import json
import os
import urllib.error
import urllib.request

URL = 'https://api.anthropic.com/v1/messages'
VERSAO_API = '2023-06-01'

# Tempo de SILÊNCIO tolerado no socket, e não tempo total da resposta: a API manda um evento
# `ping` de tempos em tempos justamente para o cano não parecer morto, então uma resposta
# longa atravessa isto sem problema. Curto demais mata pensamento longo; longo demais deixa
# um worker do Flask preso num cano que já morreu.
TIMEOUT = 120

# US$ por 1M de tokens — a tela mostra o custo da conversa, e preço é propriedade do modelo,
# então mora junto com ele. `max_saida` é o teto de `max_tokens` que o modelo aceita.
MODELOS = {
    'claude-opus-5':    {'rotulo': 'Opus 5',    'entrada': 5.0, 'saida': 25.0,
                         'contexto': 1000000, 'max_saida': 128000},
    'claude-sonnet-5':  {'rotulo': 'Sonnet 5',  'entrada': 2.0, 'saida': 10.0,
                         'contexto': 1000000, 'max_saida': 128000},
    'claude-haiku-4-5': {'rotulo': 'Haiku 4.5', 'entrada': 1.0, 'saida': 5.0,
                         'contexto': 200000, 'max_saida': 64000},
}
MODELO_PADRAO = 'claude-sonnet-5'

# O resumo desta sessão nomeou o Haiku com sufixo de data. O id publicado é o sem data, e é
# ele que vai no corpo do pedido; o apelido fica de rede para o dia em que alguém (a tela,
# um hub-config velho, outro agente) mandar a forma com data. Resolver aqui é uma linha;
# descobrir um 404 no meio de uma conversa é uma tarde.
APELIDOS = {
    'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
    'opus': 'claude-opus-5',
    'sonnet': 'claude-sonnet-5',
    'haiku': 'claude-haiku-4-5',
}

SEM_CHAVE = (
    'Não há chave da Anthropic. Ela vai na variável de ambiente ANTHROPIC_API_KEY — no '
    'servidor, dentro de /etc/altiumhub/senha.env, que o compose já monta como env_file; '
    'depois de editar, suba o container de novo. Nunca num arquivo que o hub serve por '
    'HTTP: o /hub-almox.json já entrega a senha do Odoo em texto claro para a LAN inteira, '
    'e esse erro não se repete.'
)


class ErroAPI(Exception):
    """tropeço da API já traduzido: `.status` (0 = nem chegou lá) e `.mensagem` em português"""

    def __init__(self, status, mensagem):
        Exception.__init__(self, mensagem)
        self.status = int(status or 0)
        self.mensagem = mensagem


def chave():
    """a chave sai do AMBIENTE e de lugar nenhum mais.

    Não existe versão desta função que leia arquivo: o /hub-almox.json já vaza a senha do
    Odoo porque alguém guardou segredo numa árvore servida por HTTP, e o jeito de esse erro
    não se repetir é não haver caminho de arquivo para ler aqui.
    """
    valor = (os.environ.get('ANTHROPIC_API_KEY') or '').strip()
    return valor or None


def modelo_de(nome):
    """resolve apelido e sufixo de data; modelo desconhecido ATRAVESSA, de propósito.

    Um modelo lançado depois deste arquivo não pode depender de alguém editar a tabela
    acima para o usuário poder escolhê-lo. Se o nome não existir mesmo, a API responde 404
    — e a frase do 404 já manda conferir o nome do modelo.
    """
    nome = (nome or '').strip() or MODELO_PADRAO
    return APELIDOS.get(nome, nome)


def custo(uso, modelo=None):
    """US$ do que este `uso` gastou — a tela mostra em dólar, e o preço mora aqui.

    Leitura de cache custa ~1/10 e escrita ~1,25x da entrada. Enquanto o chat não usar
    cache os dois campos vêm zerados e a conta não muda.
    """
    preco = MODELOS.get(modelo_de(modelo))
    if not preco or not isinstance(uso, dict):
        return 0.0
    entrada = (uso.get('entrada', 0) + uso.get('cache_escrita', 0) * 1.25
               + uso.get('cache_leitura', 0) * 0.1)
    return (entrada * preco['entrada'] + uso.get('saida', 0) * preco['saida']) / 1000000.0


# ─── traduzir um tropeço em frase que se pode agir ────────────────────────────
# `tipo` é o `error.type` da API; `status` é o HTTP. Os dois caminhos (resposta de erro e
# evento `error` no meio do stream) desembocam aqui para a frase ser a mesma nos dois.
_STATUS_DO_TIPO = {
    'authentication_error': 401,
    'permission_error': 403,
    'not_found_error': 404,
    'request_too_large': 413,
    'rate_limit_error': 429,
    'api_error': 500,
    'overloaded_error': 529,
    'invalid_request_error': 400,
    'billing_error': 400,
}


def _frase(status, tipo, detalhe):
    if tipo == 'overloaded_error' or status == 529:
        base = ('A API da Anthropic está sobrecarregada (529). Não é erro seu nem da sua '
                'chave: espere alguns segundos e mande de novo.')
    elif status == 401:
        base = ('A chave da Anthropic foi recusada (401). Confira ANTHROPIC_API_KEY em '
                '/etc/altiumhub/senha.env e suba o container de novo.')
    elif status == 403:
        base = ('A chave não tem permissão para isto (403) — costuma ser workspace ou '
                'modelo fora do plano da chave.')
    elif status == 404:
        base = ('A API não conhece esse modelo (404). Confira o nome do modelo escolhido '
                'na tela.')
    elif status == 413:
        base = ('A conversa ficou grande demais para um pedido só (413). Tire anexos ou '
                'comece outra conversa.')
    elif status == 429:
        base = ('Limite de uso atingido (429). Espere alguns segundos e mande de novo — o '
                'mesmo pedido costuma passar na segunda tentativa.')
    elif status == 400:
        base = ('A API recusou o pedido (400). Quase sempre é defeito do hub montando a '
                'mensagem, não da sua conversa.')
    elif status >= 500:
        base = ('A API da Anthropic falhou (%d). É do lado dela: tente de novo em alguns '
                'segundos.' % status)
    elif status:
        base = 'A API respondeu %d.' % status
    else:
        base = 'Não deu para falar com a API da Anthropic.'
    if detalhe:
        base += ' A API disse: %s' % detalhe
    return base


def _detalhe(corpo):
    """(tipo, mensagem) do JSON de erro da API; corpo ilegível não vira exceção nenhuma"""
    try:
        erro = (json.loads(corpo.decode('utf-8', 'replace')) or {}).get('error') or {}
        return erro.get('type') or '', erro.get('message') or ''
    except Exception:
        return '', ''


def erro_de_status(status, corpo=b''):
    """ErroAPI de uma resposta HTTP de erro (o corpo traz o JSON de erro da API)"""
    tipo, msg = _detalhe(corpo or b'')
    return ErroAPI(status, _frase(int(status or 0), tipo, msg))


def erro_de_stream(erro):
    """ErroAPI do evento `error` que chega NO MEIO do stream (é onde mora o overloaded_error)"""
    erro = erro if isinstance(erro, dict) else {}
    tipo = erro.get('type') or ''
    status = _STATUS_DO_TIPO.get(tipo, 500)
    return ErroAPI(status, _frase(status, tipo, erro.get('message') or ''))


# ─── SSE ──────────────────────────────────────────────────────────────────────
def _blocos_sse(linhas):
    """cada evento do SSE vira o dict do seu JSON.

    O SSE permite quebrar um evento em VÁRIAS linhas `data:` (a spec as junta com uma quebra
    de linha) e fecha o evento com uma linha em branco. A API hoje manda o JSON inteiro numa
    linha só, mas montar o bloco direito custa cinco linhas e tira do caminho um parser que
    se calaria no dia em que ela mudasse. As outras linhas (`event:`, `id:`, `: ping`) não
    mudam nada aqui: o tipo do evento vem DENTRO do JSON, e é nele que confiamos.
    """
    buf = []
    for bruta in linhas:
        if isinstance(bruta, bytes):
            bruta = bruta.decode('utf-8', 'replace')
        linha = bruta.rstrip('\r\n')
        if linha == '':
            bloco = _json_do_bloco(buf)
            buf = []
            if bloco is not None:
                yield bloco
        elif linha.startswith('data:'):
            buf.append(linha[5:].lstrip(' '))
    # stream que acabou sem a linha em branco final: o último evento ainda vale
    bloco = _json_do_bloco(buf)
    if bloco is not None:
        yield bloco


def _json_do_bloco(buf):
    texto = '\n'.join(buf).strip()
    if not texto:
        return None
    try:
        dado = json.loads(texto)
    except ValueError:
        # Meio evento de um stream cortado cai aqui. Ignorar é o certo: quem detecta o corte
        # é o `_traduz`, pela ausência do `message_stop`, e com uma frase que o usuário
        # entende. Uma exceção daqui só trocaria essa frase por um traceback.
        return None
    return dado if isinstance(dado, dict) else None


def _soma_uso(uso, vindo):
    """o uso é MÁXIMO, não soma: a API manda o total acumulado a cada vez.

    `message_start` traz a entrada (e uma saída de um ou dois tokens), `message_delta` traz
    o total de saída até ali. Somar os dois dobraria a conta que a tela mostra em dólar.
    Entrada e cache ficam em campos separados porque custam preços diferentes (ver `custo`).
    """
    if not isinstance(vindo, dict):
        return
    for na_api, no_uso in (('input_tokens', 'entrada'), ('output_tokens', 'saida'),
                           ('cache_creation_input_tokens', 'cache_escrita'),
                           ('cache_read_input_tokens', 'cache_leitura')):
        valor = vindo.get(na_api)
        if isinstance(valor, int) and not isinstance(valor, bool) and valor > uso[no_uso]:
            uso[no_uso] = valor


def _traduz(linhas):
    """os eventos da API viram os quatro eventos do contrato"""
    uso = {'entrada': 0, 'saida': 0, 'cache_escrita': 0, 'cache_leitura': 0}
    # Ferramenta chega em pedaços: o `content_block_start` dá id e nome, os
    # `input_json_delta` dão o JSON da entrada em fatias, e só o `content_block_stop` garante
    # que a entrada está inteira. Emitir antes disso é entregar ao operador um argumento pela
    # metade — que é pior que não entregar nada, porque ele escreveria no projeto com ele.
    abertos = {}
    motivo = 'end_turn'

    for dado in _blocos_sse(linhas):
        tipo = dado.get('type')

        if tipo == 'error':
            erro = erro_de_stream(dado.get('error'))
            yield {'t': 'erro', 'msg': erro.mensagem, 'status': erro.status}
            return                       # a API fecha o cano depois deste evento

        if tipo == 'message_start':
            _soma_uso(uso, (dado.get('message') or {}).get('usage'))

        elif tipo == 'content_block_start':
            bloco = dado.get('content_block') or {}
            if bloco.get('type') == 'tool_use':
                abertos[dado.get('index')] = {'id': bloco.get('id'),
                                              'nome': bloco.get('name'), 'json': []}

        elif tipo == 'content_block_delta':
            delta = dado.get('delta') or {}
            if delta.get('type') == 'text_delta':
                pedaco = delta.get('text') or ''
                if pedaco:
                    yield {'t': 'texto', 's': pedaco}
            elif delta.get('type') == 'input_json_delta':
                aberto = abertos.get(dado.get('index'))
                if aberto is not None:
                    aberto['json'].append(delta.get('partial_json') or '')
            # `thinking_delta`/`signature_delta` passam batido: este chat não pede raciocínio
            # visível, e nesse caso os blocos chegam vazios.

        elif tipo == 'content_block_stop':
            aberto = abertos.pop(dado.get('index'), None)
            if aberto is not None:
                bruto = ''.join(aberto['json'])
                try:
                    # vazio quer dizer `{}`: ferramenta sem argumento não manda um só delta,
                    # e json.loads('') levantaria.
                    entrada = json.loads(bruto) if bruto.strip() else {}
                except ValueError:
                    yield {'t': 'erro', 'status': 0,
                           'msg': ('A ferramenta %s veio com o argumento quebrado (JSON '
                                   'incompleto). Mande de novo.' % (aberto['nome'] or '?'))}
                    return
                yield {'t': 'ferramenta', 'id': aberto['id'], 'nome': aberto['nome'],
                       'entrada': entrada}

        elif tipo == 'message_delta':
            _soma_uso(uso, dado.get('usage'))
            motivo = (dado.get('delta') or {}).get('stop_reason') or motivo

        elif tipo == 'message_stop':
            yield {'t': 'fim', 'motivo': motivo, 'uso': uso}
            return

    # Chegar aqui é o stream ter acabado sem `message_stop`: cano cortado, proxy que
    # desistiu, container reiniciado. O `motivo` pode até já ter chegado pelo `message_delta`
    # — não basta, porque o que vinha depois dele se perdeu, e o operador não pode tratar
    # meia resposta como resposta.
    yield {'t': 'erro', 'status': 0,
           'msg': ('A resposta foi cortada no meio: a conexão com a API caiu antes do fim. '
                   'O que chegou está acima; mande de novo para completar.')}


def _transporte_urllib(url, corpo, cabecalhos):
    """o transporte de verdade: POST, e as linhas do SSE conforme elas chegam"""
    pedido = urllib.request.Request(url, data=corpo, headers=cabecalhos, method='POST')
    try:
        resposta = urllib.request.urlopen(pedido, timeout=TIMEOUT)
    except urllib.error.HTTPError as e:
        # HTTPError É a resposta: o corpo traz o JSON de erro da API e é dele que sai a frase
        # útil. Ler agora — depois do `raise` o socket já foi fechado.
        try:
            corpo_erro = e.read()
        except Exception:
            corpo_erro = b''
        raise erro_de_status(e.code, corpo_erro)
    except urllib.error.URLError as e:
        raise ErroAPI(0, 'Não consegui falar com api.anthropic.com (%s). O container tem '
                         'saída para a internet? (medido nesta bancada: tem).' % (e.reason,))
    with resposta:
        for linha in resposta:
            yield linha


def conversa(mensagens, ferramentas=None, sistema=None, modelo=None, max_tokens=8192,
             chave=None, transporte=None):
    """uma rodada com o modelo, em eventos. NÃO LEVANTA: tropeço vira `{'t':'erro'}`.

    Isto é um gerador, então nada acontece até a primeira iteração — inclusive a conferência
    da chave. É de propósito: quem chama já está dentro de uma resposta SSE começada, e
    precisa que a falta de chave chegue como evento, pelo mesmo cano do resto.
    """
    # `chave` é parâmetro E função de módulo; o parâmetro ganha, e `globals()` alcança a
    # função que ele sombreou.
    api_key = chave if chave else globals()['chave']()
    if not api_key:
        yield {'t': 'erro', 'msg': SEM_CHAVE, 'status': 0}
        return
    if not mensagens:
        yield {'t': 'erro', 'status': 0,
               'msg': 'Conversa vazia: não há o que mandar para o modelo.'}
        return

    corpo = {'model': modelo_de(modelo), 'max_tokens': int(max_tokens),
             'messages': mensagens, 'stream': True}
    if sistema:
        corpo['system'] = sistema
    if ferramentas:
        corpo['tools'] = ferramentas

    cabecalhos = {'x-api-key': api_key,
                  'anthropic-version': VERSAO_API,
                  'content-type': 'application/json',
                  'accept': 'text/event-stream',
                  'user-agent': 'AltiumPCBMirror-hub (urllib)'}
    bytes_corpo = json.dumps(corpo, ensure_ascii=False).encode('utf-8')
    envia = transporte or _transporte_urllib

    try:
        for evento in _traduz(envia(URL, bytes_corpo, cabecalhos)):
            yield evento
    except ErroAPI as e:
        yield {'t': 'erro', 'msg': e.mensagem, 'status': e.status}
    except OSError as e:
        # Timeout de leitura e conexão cortada no meio do stream caem aqui (socket.timeout é
        # TimeoutError, que é OSError). Nunca sobem: ver o cabeçalho do arquivo.
        yield {'t': 'erro', 'status': 0,
               'msg': ('A conexão com a API caiu no meio da resposta (%s). O que chegou está '
                       'acima; mande de novo.' % (e,))}
    except Exception as e:
        yield {'t': 'erro', 'status': 0,
               'msg': ('Falha inesperada falando com a API: %s: %s. Se repetir, é defeito do '
                       'hub.' % (type(e).__name__, e))}
