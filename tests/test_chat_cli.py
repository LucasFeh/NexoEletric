# -*- coding: utf-8 -*-
"""O motor CLI do chat, provado SEM ter o `claude` instalado.

    python tests/test_chat_cli.py

O `tools/chat/claude_cli.py` sobe o `claude` da máquina como subprocesso e traduz o
`stream-json` dele para os eventos que o painel já desenha. Testar isso contra o CLI de
verdade exigiria o Claude Code instalado e logado em toda máquina que roda a suíte — e o
servidor de produção, que é onde ela mais precisa passar, não tem nem um nem outro. Então
aqui o `Popen` é trocado pela injeção `abrir`: um processo de mentira que cospe LINHAS
GRAVADAS, copiadas de uma rodada real nesta bancada com o CLI 2.1.260.

O que este teste prende, nesta ordem:

  1. A LINHA DE COMANDO. Ela é o contrato com um programa de fora, e o erro nela não aparece
     como exceção: aparece como um Claude que se comporta diferente do que o seletor do
     painel prometeu. Em "Só planejar" tem de haver `--restricted`, senão a frase "não roda
     comando" é só uma esperança;
  2. a TRADUÇÃO de cada tipo de linha: system/init (o session_id), stream_event/text_delta
     (o texto em pedaços), assistant (o tool_use já parseado) e result (uso, motivo, sessão e
     o dólar equivalente);
  3. o TEXTO NÃO SAI DUAS VEZES. O `assistant` repete, consolidado, o mesmo texto que os
     deltas já entregaram — emitir os dois escreveria a resposta inteira duas vezes na tela;
  4. a SESSÃO sai no `fim`. É ela que o chatserver devolve em `--resume` no turno seguinte;
     sem isso cada mensagem recomeça do zero e o usuário acha que o Claude tem amnésia;
  5. linha que NÃO É JSON vira aviso contado, não lixo na tela: o terminal escreve banner e
     aviso no mesmo cano por onde vêm os eventos;
  6. stderr com código != 0 vira UMA frase legível, e não a pilha do node inteira;
  7. o TIMEOUT mata o processo e diz quanto tempo esperou;
  8. o processo é MORTO quando o gerador é fechado no meio — é o SSE que cai porque o
     navegador fechou a aba. Sem isso sobra um `claude` vivo por conversa abandonada, e o
     defeito só aparece uma semana depois, com a máquina cheia deles;
  9. a mensagem que ENTRA: texto e imagem viram os blocos que o CLI espera, numa linha só;
 10. e, se esta máquina TIVER o `claude`, um turno de verdade com --model haiku. É opcional e
     diz em voz alta por que pulou — teste que some calado quando a dependência falta é
     teste que ninguém percebe ter parado de rodar.

Roda sem rede (o processo é de mentira), sem Odoo e sem Altium, e não escreve em lugar nenhum.
"""
import io
import json
import os
import sys
import threading
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'chat'))

import claude_cli as CLI                                         # noqa: E402

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')


# ═══════════════ o processo de mentira: linhas gravadas num cano ═════════════

class Cano(object):
    """um stdout/stderr de mentira. `readline` devolve o que foi gravado e depois b''.

    Quando `parede` é dado, o cano NÃO acaba: a última leitura fica pendurada nele até
    alguém soltar. É assim que se prova o timeout — o laço de leitura do `claude_cli` fica
    bloqueado esperando uma linha que não vem, que é exatamente o caso real de um `claude`
    que travou, e é por isso que o relógio dele tem de ser uma thread.
    """

    def __init__(self, linhas=(), parede=None):
        self.restantes = list(linhas)
        self.parede = parede
        self.fechado = False
        self.escrito = []

    def readline(self):
        if self.restantes:
            return self.restantes.pop(0)
        if self.parede is not None:
            self.parede.wait(20)
        return b''

    def write(self, b):
        self.escrito.append(b)
        return len(b)

    def close(self):
        self.fechado = True


class Processo(object):
    """o mínimo que o `claude_cli.conversa` usa de um Popen: os três canos, wait, poll, kill"""

    def __init__(self, linhas=(), codigo=0, erro=b'', parede=None, demora_wait=0.0):
        self.parede = parede
        self.stdin = Cano()
        self.stdout = Cano(linhas, parede)
        self.stderr = Cano([erro] if erro else [])
        self.codigo = codigo
        self.demora_wait = demora_wait
        self.morto = False
        self.terminou = False

    def wait(self):
        if self.demora_wait:
            time.sleep(self.demora_wait)
        self.terminou = True
        return -9 if self.morto else self.codigo

    def poll(self):
        return (-9 if self.morto else self.codigo) if self.terminou else None

    def kill(self):
        self.morto = True
        if self.parede is not None:
            self.parede.set()          # solta a leitura pendurada, como um processo morto faz


def abridor(proc, guarda=None):
    """a função `abrir` que o `conversa` recebe: (argv, cwd) -> processo de mentira"""
    def abrir(argv, cwd):
        if guarda is not None:
            guarda.append((argv, cwd))
        return proc
    return abrir


def ln(dado):
    return json.dumps(dado).encode('utf-8') + b'\n'


# ── linhas copiadas de uma rodada real (CLI 2.1.260, `-p --output-format stream-json`) ──
SESSAO = '556e31f9-3a0e-4d4c-9c2a-6a1f0b7c2d11'


def init(sessao=SESSAO):
    return ln({'type': 'system', 'subtype': 'init', 'session_id': sessao,
               'cwd': 'D:\\workspace', 'tools': ['Read', 'Edit', 'Bash', 'Grep']})


def pedaco(texto):
    return ln({'type': 'stream_event', 'session_id': SESSAO,
               'event': {'type': 'content_block_delta', 'index': 0,
                         'delta': {'type': 'text_delta', 'text': texto}}})


def assistente(texto=None, ferramenta=None):
    conteudo = []
    if texto is not None:
        conteudo.append({'type': 'text', 'text': texto})
    if ferramenta is not None:
        conteudo.append({'type': 'tool_use', 'id': ferramenta[0], 'name': ferramenta[1],
                         'input': ferramenta[2]})
    return ln({'type': 'assistant', 'session_id': SESSAO,
               'message': {'role': 'assistant', 'content': conteudo}})


def resultado(sessao=SESSAO, subtype='success', erro=False, custo=0.165771, texto=''):
    return ln({'type': 'result', 'subtype': subtype, 'is_error': erro,
               'session_id': sessao, 'total_cost_usd': custo, 'result': texto,
               'usage': {'input_tokens': 1200, 'output_tokens': 84,
                         'cache_creation_input_tokens': 300, 'cache_read_input_tokens': 9000}})


def eventos(proc, **kw):
    return list(CLI.conversa('oi', exe='claude-de-mentira', abrir=abridor(proc), **kw))


def so(evs, t):
    return [e for e in evs if e.get('t') == t]


falhas = []


def confere(condicao, frase):
    if condicao:
        print('  ok  %s' % frase)
    else:
        falhas.append(frase)
        print('  FALHA  %s' % frase)


# ═══════════ 1. a linha de comando, conferida sem rodar processo nenhum ══════
print('\n── 1. a linha de comando ──')

args = CLI.argumentos(modo='plan')
confere('--restricted' in args,
        'em "Só planejar" há --restricted: sem ele a frase "não roda comando" é só esperança')
confere(args[args.index('--permission-mode') + 1] == 'plan', 'o --permission-mode é plan')

for modo in ('acceptEdits', 'bypassPermissions'):
    a = CLI.argumentos(modo=modo)
    confere('--restricted' not in a,
            '"%s" NÃO leva --restricted (ele tiraria as ferramentas que o modo promete)' % modo)
    confere(a[a.index('--permission-mode') + 1] == modo, 'o --permission-mode é %s' % modo)

fixos = CLI.argumentos()
for par in (('--input-format', 'stream-json'), ('--output-format', 'stream-json'),
            ('--permission-prompts', 'none'), ('--mcp-config', '{"mcpServers":{}}')):
    confere(fixos[fixos.index(par[0]) + 1] == par[1], 'sempre %s %s' % par)
confere('-p' in fixos and '--verbose' in fixos and '--include-partial-messages' in fixos,
        'sempre -p, --verbose e --include-partial-messages (sem eles não há stream)')
confere('--strict-mcp-config' in fixos,
        'sempre --strict-mcp-config: o chat do hub não é a sessão pessoal de quem logou')

# modo que não existe cai no padrão, e o padrão é o que NÃO grava: um erro de digitação em
# "modo" não pode virar bypassPermissions por acaso
confere('--restricted' in CLI.argumentos(modo='modo-que-nao-existe'),
        'modo desconhecido cai no padrão "%s", que é o que não grava' % CLI.MODO_PADRAO)
confere(CLI.MODOS[CLI.MODO_PADRAO]['solto'] is False, 'e o padrão não é o modo solto')

cheia = CLI.argumentos(sistema='seja curto', modelo='haiku', modo='plan',
                       raiz='D:\\workspace', sessao='abc-123', extras=['--settings', '{}'])
confere(cheia[cheia.index('--append-system-prompt') + 1] == 'seja curto', 'o promptzinho entra')
confere(cheia[cheia.index('--model') + 1] == 'haiku', 'o modelo entra pelo apelido')
confere(cheia[cheia.index('--add-dir') + 1] == 'D:\\workspace', 'a raiz do workspace entra')
confere(cheia[cheia.index('--resume') + 1] == 'abc-123', 'a sessão entra em --resume')
confere(cheia[-2:] == ['--settings', '{}'], 'os extras entram no fim, na ordem em que vieram')


# ═════════════════ 2-4. a tradução de cada linha, e a sessão ═════════════════
print('\n── 2. a tradução de cada tipo de linha ──')

guarda = []
proc = Processo([init(), pedaco('P'), pedaco('RONTO'),
                 assistente('PRONTO', ('toolu_1', 'Read', {'file_path': 'schematic.js'})),
                 resultado()])
evs = list(CLI.conversa('oi', exe='claude-de-mentira', abrir=abridor(proc, guarda),
                        modo='plan', raiz=None))
tipos = [e['t'] for e in evs]
confere(tipos == ['texto', 'texto', 'ferramenta', 'fim'],
        'a ordem dos eventos: %s' % ' → '.join(tipos))

confere(''.join(e['s'] for e in so(evs, 'texto')) == 'PRONTO',
        'o texto sai em pedaços, na ordem, e soma a resposta')

fer = so(evs, 'ferramenta')[0]
confere(fer == {'t': 'ferramenta', 'id': 'toolu_1', 'nome': 'Read',
                'entrada': {'file_path': 'schematic.js'}},
        'o tool_use vira ferramenta com a entrada já parseada')

print('\n── 3. o texto não sai duas vezes ──')
confere(len(so(evs, 'texto')) == 2 and ''.join(e['s'] for e in so(evs, 'texto')) == 'PRONTO',
        'o texto consolidado da linha `assistant` NÃO foi emitido por cima dos deltas')

# e o contrário: sem os deltas (um CLI sem --include-partial-messages, ou uma versão que
# pare de mandá-los), o texto da linha `assistant` é a única cópia que existe — melhor a
# resposta inteira de uma vez que tela vazia
sem_delta = eventos(Processo([init(), assistente('so no fim'), resultado()]))
confere(''.join(e['s'] for e in so(sem_delta, 'texto')) == 'so no fim',
        'sem deltas, o texto do `assistant` é usado — a tela nunca fica vazia')

print('\n── 4. a sessão e o dólar equivalente ──')
fim = so(evs, 'fim')[0]
confere(fim['sessao'] == SESSAO, 'o session_id do init/result sai no `fim`: é o fio do --resume')
confere(fim['uso'] == {'entrada': 1200, 'saida': 84,
                       'cache_escrita': 300, 'cache_leitura': 9000}, 'o uso vem inteiro')
confere(fim['motivo'] == 'success', 'o motivo do fim vem do result')
confere(abs(fim['custo_equivalente_usd'] - 0.165771) < 1e-9,
        'o dólar do CLI viaja em campo próprio (é EQUIVALENTE; a assinatura não cobra)')

argv, cwd = guarda[0]
confere(argv[0] == 'claude-de-mentira' and '--restricted' in argv,
        'o processo foi aberto com o executável e os argumentos pedidos')
confere(cwd is None, 'sem raiz, o cwd fica com o do servidor (raiz inexistente não vira cwd)')
entrada = json.loads(b''.join(proc.stdin.escrito).decode('utf-8'))
confere(entrada['message']['content'] == [{'type': 'text', 'text': 'oi'}],
        'a pergunta foi escrita no stdin como UMA linha JSON do formato de entrada')
confere(proc.stdin.fechado, 'e o stdin foi FECHADO: é isso que faz o turno começar')

# o init também não pode virar evento na tela: ele é a ficha do processo, não conversa
estado = {}
confere(CLI.eventos_da_linha(json.loads(init().decode('utf-8')), estado) == []
        and estado['sessao'] == SESSAO and estado['ferramentas'],
        'a linha system/init não vira evento: ela só guarda a sessão e as ferramentas')


# ═════════════════ 5. linha que não é JSON vira aviso contado ════════════════
print('\n── 5. o ruído do terminal ──')
sujo = eventos(Processo([b'\n', b'Welcome to Claude Code!\n', init(),
                         b'[warn] alguma coisa\n', pedaco('oi'), resultado()]))
confere(''.join(e['s'] for e in so(sujo, 'texto')) == 'oi',
        'o texto atravessa o ruído inteiro')
avisos = [e for e in so(sujo, 'erro') if e.get('aviso')]
confere(len(avisos) == 1 and '2 linha' in avisos[0]['msg'],
        'as 2 linhas que não eram JSON viraram UM aviso contado, e não lixo na tela: %s'
        % (avisos[0]['msg'] if avisos else '(nenhum aviso)'))
confere(so(sujo, 'fim') and so(sujo, 'fim')[0]['sessao'] == SESSAO,
        'e o `fim` continua trazendo a sessão')
confere(not [e for e in so(sujo, 'erro') if not e.get('aviso')],
        'ruído não vira ERRO: erro para o usuário é coisa que ele precisa fazer alguma coisa')


# ═════════════ 6. stderr com código != 0 vira uma frase legível ══════════════
print('\n── 6. o processo que falhou ──')
pilha = (b'No conversation found with session ID: 0000-1111\n'
         b'    at Object.<anonymous> (node:internal/modules/run_main:128:12)\n'
         b'    at Module._compile (node:internal/modules/cjs/loader:1234:14)\n')
caiu = eventos(Processo([], codigo=1, erro=pilha))
erros = [e for e in so(caiu, 'erro') if not e.get('aviso')]
confere(len(erros) == 1 and erros[0]['msg'] == 'No conversation found with session ID: 0000-1111',
        'o erro é a primeira linha que EXPLICA, sem a pilha do node: %r'
        % (erros[0]['msg'] if erros else None))
confere('node:internal' not in json.dumps(caiu), 'a pilha não chega à tela do usuário')

mudo = eventos(Processo([], codigo=1))
confere(so(mudo, 'erro') and 'código 1' in so(mudo, 'erro')[0]['msg'],
        'processo que falha sem dizer nada ainda vira frase, com o código')

# e o `result` que já vem marcado como erro sai como erro E como fim: a tela precisa dos dois
ruim = eventos(Processo([init(), resultado(subtype='error_during_execution', erro=True,
                                           texto='o modelo recusou')]))
confere([e['t'] for e in ruim] == ['erro', 'fim'] and 'recusou' in ruim[0]['msg'],
        'um result de erro vira erro + fim (o `fim` é o que para o giro do painel)')

# exe inexistente: erro com frase que ENSINA, e nenhum processo aberto
real = CLI.executavel
CLI.executavel = lambda: None
try:
    sem = list(CLI.conversa('oi'))
finally:
    CLI.executavel = real
confere(len(sem) == 1 and sem[0]['t'] == 'erro' and 'Claude Code' in sem[0]['msg'],
        'sem `claude` na máquina, o erro diz o que instalar — e não sobe processo nenhum')


# ═══════════════════════════════ 7. o timeout ════════════════════════════════
print('\n── 7. o relógio ──')
parede = threading.Event()
travado = Processo([init(), pedaco('comecei')], parede=parede)
começo = time.time()
evs = list(CLI.conversa('oi', exe='claude-de-mentira', abrir=abridor(travado), timeout=0.4))
gastou = time.time() - começo
confere(gastou < 10, 'o turno travado foi encerrado em %.1fs, e não ficou pendurado' % gastou)
confere(travado.morto, 'o processo travado foi MORTO pelo relógio')
confere(''.join(e['s'] for e in so(evs, 'texto')) == 'comecei',
        'o que ele já tinha escrito chegou à tela antes do corte')
tempo = [e for e in so(evs, 'erro') if 'encerrado' in e['msg']]
confere(bool(tempo) and 'está acima' in tempo[0]['msg'],
        'e o usuário lê que o tempo acabou e que o começo da resposta está acima')


# ══════════ 8. o SSE que cai: o processo morre junto com o gerador ═══════════
print('\n── 8. a aba que fechou ──')
parede2 = threading.Event()
vivo = Processo([init(), pedaco('metade da frase')], parede=parede2)
g = CLI.conversa('oi', exe='claude-de-mentira', abrir=abridor(vivo), timeout=60)
primeiro = next(g)
confere(primeiro == {'t': 'texto', 's': 'metade da frase'}, 'o primeiro pedaço saiu')
confere(not vivo.morto, 'e o processo ainda está vivo enquanto alguém lê')
g.close()          # é isto que o Flask faz quando o navegador fecha a aba no meio do SSE
confere(vivo.morto,
        'fechar o gerador MATOU o processo — sem isto sobra um `claude` por aba abandonada')
confere(vivo.stdout.fechado and vivo.stderr.fechado, 'e os canos foram fechados junto')


# ═══════════════════ 9. a mensagem que entra (texto e imagem) ════════════════
print('\n── 9. a linha de entrada ──')
linha = CLI.linha_de_entrada('só texto')
d = json.loads(linha)
confere(linha.endswith('\n') and '\n' not in linha[:-1],
        'é UMA linha só, terminada em \\n: o CLI lê o stdin linha a linha')
confere(d['type'] == 'user' and d['message']['role'] == 'user', 'no formato de entrada do CLI')

png = {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': 'AAA='}}
d2 = json.loads(CLI.linha_de_entrada([png, {'type': 'text', 'text': 'o que é isto?'}]))
confere(d2['message']['content'][0] == png,
        'a imagem atravessa como o mesmo bloco base64 da API (medido: ele responde sobre ela)')
confere(d2['message']['content'][1]['text'] == 'o que é isto?', 'e o texto vem depois dela')

# bloco que o motor não conhece não pode virar objeto quebrado do outro lado
d3 = json.loads(CLI.linha_de_entrada([{'type': 'document', 'source': {'data': 'x'}}]))
confere(d3['message']['content'][0]['type'] == 'text',
        'bloco de tipo desconhecido vira texto, e não um JSON que o CLI recusaria inteiro')

# acento: o console do Windows é cp1252 e mentiria sobre todo acento que passasse por ele
d4 = json.loads(CLI.linha_de_entrada('afasta a trilha da junção, está muito próxima'))
confere(d4['message']['content'][0]['text'] == 'afasta a trilha da junção, está muito próxima',
        'o acento atravessa: a linha é escrita em utf-8, não na página de código do console')


# ═══════════ 10. opcional: um turno de verdade, se houver `claude` ═══════════
print('\n── 10. o `claude` de verdade (opcional) ──')
ok, motivo = CLI.disponivel()
if not ok:
    print('  PULADO  não há `claude` nesta máquina, e este é o único teste que precisa dele.')
    print('          O motor foi provado inteiro acima, com o processo de mentira.')
    print('          Motivo do CLI: %s' % motivo.split('.')[0])
elif os.environ.get('SEM_CLAUDE_DE_VERDADE'):
    print('  PULADO  SEM_CLAUDE_DE_VERDADE está no ambiente (rodada sem gastar turno).')
else:
    print('  (subindo o claude %s de verdade, com --model haiku)' % (CLI.versao() or '?'))
    evs = list(CLI.conversa('Responda exatamente a palavra PRONTO, e nada mais.',
                            modo='plan', modelo='haiku', timeout=180))
    texto = ''.join(e['s'] for e in so(evs, 'texto'))
    fim = so(evs, 'fim')
    erros = [e for e in so(evs, 'erro') if not e.get('aviso')]
    confere(not erros, 'o turno de verdade não deu erro: %s' % (erros[0]['msg'] if erros else ''))
    confere('PRONTO' in texto.upper(), 'ele respondeu, e o texto chegou: %r' % texto[:80])
    confere(bool(fim) and len(fim) == 1, 'saiu UM `fim` só')
    if fim:
        confere(bool(fim[0]['sessao']), 'o `fim` trouxe a sessão: %s' % fim[0]['sessao'][:8])
        confere(fim[0]['uso']['entrada'] > 0, 'e o uso veio preenchido pelo CLI')


print('')
if falhas:
    print('test_chat_cli FALHOU em %d ponto(s):' % len(falhas))
    for f in falhas:
        print('  - %s' % f)
    sys.exit(1)
print('test_chat_cli OK')
