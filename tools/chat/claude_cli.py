# -*- coding: utf-8 -*-
"""O `claude` da máquina como motor do chat — o terminal do Claude Code com outra cara.

    disponivel() -> (bool, motivo)
    versao()     -> '2.1.260' | None
    conversa(mensagens, sistema=..., modo=..., ...) -> iterador dos eventos do contrato

Por que existe, ao lado do `claude_api.py`: a conversa pela API cobra por token, e o usuário
já paga uma assinatura que o terminal dele usa. Aqui o hub sobe o MESMO `claude` que ele roda
no terminal, com o login que já está na máquina — não há chave de API em lugar nenhum deste
arquivo, de propósito.

O preço dessa escolha está dito por inteiro em MODOS, logo abaixo: isto é um acesso de
terminal. Quem abre o painel e sabe a senha mestre manda no `claude` da máquina que roda o
hubserver, com as ferramentas dele (Read, Edit, Bash…). Não é a mesma coisa que o motor da
API, onde as ferramentas eram as do `operador.py` e a cerca era código meu.

TUDO QUE ESTE ARQUIVO SUPÕE FOI MEDIDO em 2026-09-16, nesta bancada, com o CLI 2.1.260:

  o executável     `claude.exe`, 217 MB, PE32+ nativo em C:\\Users\\Lucas\\.local\\bin.
                   Não precisa de node: `shutil.which('claude')` acha e `Popen` roda.
  entrada          `--input-format stream-json`: UMA linha JSON por mensagem do usuário,
                   {"type":"user","message":{"role":"user","content":[…]}}. Fechar o stdin
                   depois da linha é o que faz o turno começar.
  imagem           o mesmo bloco `{"type":"image","source":{"type":"base64",…}}` da API
                   atravessa: mandei um PNG 8x8 azul e a resposta foi "Azul.". É por isso
                   que o anexo do painel não precisa virar arquivo no disco.
  saída            `--output-format stream-json --verbose` dá uma linha JSON por evento:
                   system(hook_started|hook_response|init), assistant, user, rate_limit_event
                   e result. O `init` traz session_id, cwd e a lista de ferramentas.
  texto em pedaço  só com `--include-partial-messages`: aí vêm linhas `stream_event` com
                   content_block_delta/text_delta. Medido: "conte de 1 a 12" saiu em 10
                   pedaços. Sem essa flag o texto só aparece inteiro, no fim, e a tela fica
                   parada — o painel já desenha streaming, seria desperdício.
  continuar        `--resume <session_id>` retoma de verdade: perguntei "qual foi o último
                   número que você disse?" e ele respondeu "12". O result devolve o MESMO
                   session_id, então a conversa do hub tem um fio só.
  MCP pessoal      sem `--strict-mcp-config --mcp-config {"mcpServers":{}}` o CLI carrega os
                   servidores MCP e as configurações pessoais de quem logou (aqui vieram os
                   do Canva). O chat do hub não é a sessão pessoal de ninguém: entra limpo.

O QUE NÃO FOI MEDIDO, e por isso não é prometido: se os *hooks* do usuário (o SessionStart
apareceu na medição) podem ser desligados por linha de comando. Eles rodam. Se um deles for
lento ou falar demais, aparece como atraso no primeiro evento — não como erro.
"""
import json
import os
import shutil
import subprocess
import sys
import threading

# onde procurar, em ordem. A variável de ambiente ganha de tudo: é como um servidor aponta
# para um executável que não está no PATH do serviço (systemd e docker têm PATH curto).
ENV_EXE = 'ALTIUMHUB_CLAUDE'
NOMES = ('claude', 'claude.exe', 'claude.cmd')
EXTRAS = (os.path.join(os.path.expanduser('~'), '.local', 'bin', 'claude.exe'),
          os.path.join(os.path.expanduser('~'), '.local', 'bin', 'claude'),
          '/usr/local/bin/claude', '/usr/bin/claude')

TIMEOUT = 900.0           # um turno é um agente trabalhando: minutos são normais, horas não
TETO_LINHA = 4 * 1024 * 1024   # linha de stdout maior que isto é defeito, não conversa

# Os modos, escritos como o que eles são: quem escolhe no seletor do painel é uma pessoa, e
# "bypassPermissions" precisa estar em português antes de alguém clicar.
MODOS = {
    'plan': {
        'rotulo': 'Só planejar',
        'frase': 'lê o projeto e propõe; não grava arquivo nem roda comando',
        'solto': False,
    },
    'acceptEdits': {
        'rotulo': 'Pode editar',
        'frase': 'grava arquivo dentro do workspace sozinho, sem perguntar',
        'solto': False,
    },
    'bypassPermissions': {
        'rotulo': 'Solto (terminal)',
        'frase': 'faz tudo que o terminal faz, inclusive rodar comando na máquina do hub',
        'solto': True,
    },
}
MODO_PADRAO = 'plan'

# aliases que o CLI aceita em --model. Nome cheio também passa; modelo desconhecido é
# recusado pelo próprio CLI, com a frase dele.
MODELOS = {
    'opus': {'rotulo': 'Opus', 'id': 'opus'},
    'sonnet': {'rotulo': 'Sonnet', 'id': 'sonnet'},
    'haiku': {'rotulo': 'Haiku', 'id': 'haiku'},
}
MODELO_PADRAO = 'sonnet'


class ErroCLI(Exception):
    def __init__(self, mensagem, status=0):
        Exception.__init__(self, mensagem)
        self.mensagem = mensagem
        self.status = status


class ExeApontadoErrado(Exception):
    """a variavel de ambiente aponta para um caminho que nao existe"""


def executavel():
    """o caminho do `claude`, ou None.

    A variavel de ambiente GANHA DE TUDO, inclusive de estar errada: se ela aponta para um
    caminho que nao existe, isto levanta em vez de cair no PATH. Quem a define esta dizendo
    "use ESTE aqui" — normalmente num servidor, onde o PATH do servico e curto. Cair calado
    no `claude` do PATH depois de um caminho errado e o pior resultado possivel: o /estado
    responde "ligado, versao 2.1.260" e o administrador passa a tarde procurando por que a
    variavel dele "nao faz nada". Medido nesta sessao, com ALTIUMHUB_CLAUDE apontando para
    C:\nao-existe\claude.exe: o hub respondia ligado e usava outro executavel.
    """
    apontado = os.environ.get(ENV_EXE)
    if apontado:
        if os.path.isfile(apontado):
            return apontado
        raise ExeApontadoErrado(apontado)
    for nome in NOMES:
        achado = shutil.which(nome)
        if achado:
            return achado
    for cam in EXTRAS:
        if os.path.isfile(cam):
            return cam
    return None


def _exe_ou_none():
    """o mesmo `executavel()`, mas engolindo o apontamento errado — para quem so quer saber
       se da para conversar, e nao por que nao da"""
    try:
        return executavel()
    except ExeApontadoErrado:
        return None


def versao(exe=None):
    """'2.1.260' — e None quando o executável não responde.

    Serve de PROVA DE VIDA, não de enfeite: um `claude` instalado mas quebrado (falta de
    permissão, binário pela metade) responde aqui, e é melhor descobrir no /estado do que
    no meio da primeira conversa do usuário.
    """
    exe = exe or _exe_ou_none()
    if not exe:
        return None
    try:
        p = subprocess.run([exe, '--version'], capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    if p.returncode != 0:
        return None
    txt = (p.stdout or b'').decode('utf-8', 'replace').strip()
    return txt.split()[0] if txt else None


def disponivel():
    """(True, '') ou (False, o que fazer a respeito).

    A frase do `False` vai inteira para a tela. Por isso ela diz o que fazer, e não só o que
    falta: "não há claude" não ensina nada a quem abriu o painel e quer conversar.
    """
    try:
        exe = executavel()
    except ExeApontadoErrado as e:
        return False, ('a variável %s aponta para "%s", e não há arquivo aí. Corrija o '
                       'caminho ou apague a variável para o hub procurar o `claude` no PATH.'
                       % (ENV_EXE, e))
    if not exe:
        return False, ('não achei o `claude` nesta máquina. Instale o Claude Code e rode '
                       '`claude` uma vez para entrar na sua conta — o chat usa esse login, '
                       'e não uma chave de API paga. Se ele já estiver instalado fora do '
                       'PATH, aponte o caminho na variável %s.' % ENV_EXE)
    v = versao(exe)
    if not v:
        return False, ('achei o `claude` em %s, mas ele não respondeu a `--version`. Rode '
                       'esse comando à mão: o que ele reclamar é o que falta aqui.' % exe)
    return True, ''


# ─────────────────────────── a mensagem que entra ────────────────────────────

def _bloco(b):
    """um bloco de conteúdo do jeito que o CLI espera — o mesmo formato da API.

    Só texto e imagem. Documento (PDF) fica de fora de propósito: NÃO foi medido aqui, e
    prometer o que não se mediu é como este arquivo perde o direito de ser lido.
    """
    if not isinstance(b, dict):
        return {'type': 'text', 'text': str(b)}
    t = b.get('type')
    if t == 'image' and isinstance(b.get('source'), dict):
        return {'type': 'image', 'source': b['source']}
    return {'type': 'text', 'text': str(b.get('text') or '')}


def linha_de_entrada(conteudo):
    """a linha JSON de uma mensagem do usuário, terminada em \\n"""
    if isinstance(conteudo, str):
        blocos = [{'type': 'text', 'text': conteudo}]
    else:
        blocos = [_bloco(b) for b in (conteudo or [])]
    return json.dumps({'type': 'user',
                       'message': {'role': 'user', 'content': blocos}},
                      ensure_ascii=False) + '\n'


def argumentos(sistema=None, modelo=None, modo=None, raiz=None, sessao=None, extras=None):
    """a linha de comando, montada num lugar só para o teste poder conferi-la sem rodar nada"""
    modo = modo if modo in MODOS else MODO_PADRAO
    args = ['-p',
            '--input-format', 'stream-json',
            '--output-format', 'stream-json',
            '--verbose',                      # sem ele o stream-json de saída não sai
            '--include-partial-messages',     # o texto em pedaços, que a tela desenha
            '--permission-mode', modo,
            # ninguém para responder prompt de permissão do outro lado de um SSE: o que
            # perguntaria é negado, em vez de a conversa ficar pendurada para sempre
            '--permission-prompts', 'none',
            # o chat do hub não é a sessão pessoal de quem logou: entra sem os MCP dele
            '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}']
    if modelo:
        args += ['--model', MODELOS.get(modelo, {}).get('id', modelo)]
    if sistema:
        args += ['--append-system-prompt', sistema]
    if raiz:
        args += ['--add-dir', raiz]
    if sessao:
        args += ['--resume', sessao]
    if modo == 'plan':
        # em "só planejar" a promessa da tela é que nada roda: --restricted tira as
        # ferramentas que executam comando, e aí a frase do seletor é verdade por código e
        # não só pelo modo de permissão
        args += ['--restricted']
    for x in (extras or []):
        args.append(x)
    return args


# ─────────────────────────── o que sai vira evento ───────────────────────────

def eventos_da_linha(d, estado):
    """traduz UMA linha do CLI para os eventos do contrato. Pura: o teste a chama direto.

    `estado` é um dict que atravessa as linhas (o session_id e o controle de duplicata).

    A regra que evita texto repetido: o texto sai dos `stream_event`/text_delta, e o que vem
    depois na linha `assistant` é a versão consolidada DO MESMO texto. Emitir os dois faria a
    resposta aparecer duas vezes na tela. Da linha `assistant` aproveitamos só o `tool_use`,
    que é onde a entrada da ferramenta chega inteira e já parseada.
    """
    fora = []
    t = d.get('type')

    if t == 'system':
        if d.get('subtype') == 'init':
            estado['sessao'] = d.get('session_id') or estado.get('sessao')
            estado['ferramentas'] = d.get('tools') or []
        return fora

    if t == 'stream_event':
        e = d.get('event') or {}
        if e.get('type') == 'content_block_delta':
            delta = e.get('delta') or {}
            if delta.get('type') == 'text_delta' and delta.get('text'):
                estado['viu_texto'] = True
                fora.append({'t': 'texto', 's': delta['text']})
        return fora

    if t == 'assistant':
        msg = d.get('message') or {}
        estado['sessao'] = d.get('session_id') or estado.get('sessao')
        for b in (msg.get('content') or []):
            if not isinstance(b, dict):
                continue
            if b.get('type') == 'tool_use':
                fora.append({'t': 'ferramenta', 'id': b.get('id') or '',
                             'nome': b.get('name') or '?',
                             'entrada': b.get('input') if isinstance(b.get('input'), dict) else {}})
            elif b.get('type') == 'text' and not estado.get('viu_texto'):
                # sem --include-partial-messages (ou se o CLI parar de mandá-los) o texto só
                # existe aqui: melhor a resposta inteira de uma vez que tela vazia
                if b.get('text'):
                    fora.append({'t': 'texto', 's': b['text']})
        return fora

    if t == 'result':
        estado['sessao'] = d.get('session_id') or estado.get('sessao')
        u = d.get('usage') or {}
        uso = {'entrada': int(u.get('input_tokens') or 0),
               'saida': int(u.get('output_tokens') or 0),
               'cache_escrita': int(u.get('cache_creation_input_tokens') or 0),
               'cache_leitura': int(u.get('cache_read_input_tokens') or 0)}
        if d.get('is_error') or d.get('subtype') not in (None, 'success'):
            fora.append({'t': 'erro', 'status': 0,
                         'msg': str(d.get('result') or d.get('error')
                                    or ('o claude terminou com "%s"' % d.get('subtype')))})
        fora.append({'t': 'fim',
                     'motivo': d.get('stop_reason') or d.get('subtype') or 'end_turn',
                     'uso': uso,
                     'sessao': estado.get('sessao') or '',
                     # o CLI relata quanto o turno CUSTARIA pela API. Quem está na assinatura
                     # não paga isso, e a tela precisa saber a diferença para não parecer fatura
                     'custo_equivalente_usd': d.get('total_cost_usd')})
        return fora

    return fora


# ─────────────────────────────── a conversa ──────────────────────────────────

def conversa(conteudo, sistema=None, modelo=None, modo=None, raiz=None, sessao=None,
             exe=None, timeout=TIMEOUT, abrir=None, extras=None):
    """Um turno. Gerador dos eventos do contrato; NUNCA levanta — erro vira evento.

    O motivo de nunca levantar é o mesmo do `claude_api.conversa`: quando o primeiro evento
    sai, o SSE do hub já mandou os cabeçalhos, e exceção subindo pelo Flask daí em diante não
    vira página de erro, vira conexão cortada — o painel fica girando para sempre.

    UM PROCESSO POR TURNO, e o fio da conversa é o `--resume`. A alternativa (um processo
    vivo entre requisições HTTP) guarda estado de sistema operacional dentro de um servidor
    que pode ser reiniciado a qualquer momento, e deixa processo órfão quando o navegador
    fecha a aba. O `--resume` foi medido: retoma o contexto inteiro.

    `abrir` é a injeção do teste: uma função (argv, cwd) -> objeto com .stdin/.stdout/
    .stderr/.wait()/.kill(), ou seja, um Popen de mentira.
    """
    exe = exe or _exe_ou_none()
    if not exe:
        yield {'t': 'erro', 'status': 0, 'msg': disponivel()[1]}
        return

    argv = [exe] + argumentos(sistema=sistema, modelo=modelo, modo=modo, raiz=raiz,
                              sessao=sessao, extras=extras)
    cwd = raiz if (raiz and os.path.isdir(raiz)) else None
    entrada = linha_de_entrada(conteudo)

    try:
        if abrir is not None:
            p = abrir(argv, cwd)
        else:
            p = subprocess.Popen(
                argv, cwd=cwd,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                # o console do Windows é cp1252 e mentiria sobre todo acento que passar aqui
                env=dict(os.environ, PYTHONIOENCODING='utf-8'))
    except OSError as e:
        yield {'t': 'erro', 'status': 0, 'msg': 'não consegui rodar o claude: %s' % e}
        return

    # o stderr é lido numa thread: se ninguém o consumir, um stderr grande enche o buffer do
    # cano e o processo TRAVA esperando escrever — com a tela parada e nenhuma pista do porquê
    erros = []

    def _drena():
        try:
            for ln in iter(p.stderr.readline, b''):
                if ln:
                    erros.append(ln.decode('utf-8', 'replace'))
        except (OSError, ValueError):
            pass

    t_err = threading.Thread(target=_drena, daemon=True)
    t_err.start()

    # o cronômetro é uma thread também: matar o filho de dentro do laço de leitura não
    # funciona, porque o laço está BLOQUEADO justamente esperando a linha que não vem
    morto = {'por_tempo': False}

    def _relogio():
        if p.poll() is None:
            morto['por_tempo'] = True
            _mata(p)

    t_rel = threading.Timer(timeout, _relogio)
    t_rel.daemon = True
    t_rel.start()

    estado = {'sessao': sessao or '', 'viu_texto': False, 'ferramentas': []}
    quebradas = 0
    try:
        try:
            p.stdin.write(entrada.encode('utf-8'))
            p.stdin.close()          # fechar o stdin é o que faz o turno começar
        except (OSError, ValueError) as e:
            yield {'t': 'erro', 'status': 0, 'msg': 'não consegui falar com o claude: %s' % e}
            return

        for bruta in iter(p.stdout.readline, b''):
            if not bruta:
                break
            if len(bruta) > TETO_LINHA:
                quebradas += 1
                continue
            texto = bruta.decode('utf-8', 'replace').strip()
            if not texto:
                continue
            try:
                d = json.loads(texto)
            except ValueError:
                # linha que não é JSON é ruído do terminal (banner, aviso), não conversa.
                # Contamos para dizer no fim, em vez de calar ou de poluir a tela.
                quebradas += 1
                continue
            if not isinstance(d, dict):
                continue
            for ev in eventos_da_linha(d, estado):
                yield ev

        codigo = p.wait()
        t_rel.cancel()
        t_err.join(timeout=2)

        if morto['por_tempo']:
            yield {'t': 'erro', 'status': 0,
                   'msg': 'o claude passou de %d minutos e foi encerrado. O que ele já tinha '
                          'escrito está acima.' % int(timeout // 60)}
            return

        if codigo not in (0, None):
            msg = ''.join(erros).strip() or ('o claude saiu com código %s' % codigo)
            yield {'t': 'erro', 'status': 0, 'msg': _resumo_erro(msg)}
            return

        if quebradas:
            yield {'t': 'erro', 'status': 0, 'aviso': True,
                   'msg': 'aviso: %d linha(s) do claude não eram JSON e ficaram de fora'
                          % quebradas}
    finally:
        # GeneratorExit cai aqui: é o SSE morrendo porque o navegador fechou a aba. Sem este
        # kill sobra um claude rodando por conversa abandonada — o defeito que só aparece
        # depois de uma semana de uso, quando a máquina está cheia deles.
        t_rel.cancel()
        _mata(p)


def _mata(p):
    try:
        if p.poll() is None:
            p.kill()
    except (OSError, ValueError, AttributeError):
        pass
    for cano in ('stdin', 'stdout', 'stderr'):
        try:
            f = getattr(p, cano, None)
            if f:
                f.close()
        except (OSError, ValueError):
            pass


def _resumo_erro(msg):
    """a primeira linha que explica alguma coisa, e não a pilha inteira na cara do usuário"""
    linhas = [l.strip() for l in msg.splitlines() if l.strip()]
    if not linhas:
        return 'o claude falhou sem dizer por quê'
    util = [l for l in linhas if not l.startswith('at ') and 'node:internal' not in l]
    return (util or linhas)[0][:400]


if __name__ == '__main__':                                   # pragma: no cover
    ok, motivo = disponivel()
    print('claude: %s' % (executavel() or '(não achei)'))
    print('versão: %s' % (versao() or '—'))
    print('pronto: %s%s' % (ok, '' if ok else ' — ' + motivo))
    if ok and len(sys.argv) > 1:
        for ev in conversa(' '.join(sys.argv[1:]), modo='plan', modelo='haiku'):
            print(json.dumps(ev, ensure_ascii=False)[:300])
