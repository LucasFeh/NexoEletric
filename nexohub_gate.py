# -*- coding: utf-8 -*-
"""Sem o Nexo Hub, o NexoEletric fica vazio (app desktop, ALTIUMHUB_NEXOBD=1; 1.29.0).

Decisao do dono: projetos, esquemas, simbolos e footprints moram no NexoBD, e o NexoEletric os
recebe so pelo Nexo Hub desta maquina (Odoo -> NexoBD -> Nexo Hub -> NexoEletric). A pasta de
trabalho e a memoria de trabalho do hub, nao uma fonte: com o Hub desconectado -- ele fora do ar,
ou no ar sem os dados dele (a saude sem bd.ok) -- nada dela aparece. O indice de projetos sai
vazio, Projects/ e Libs/ nao sao servidos e toda rota que le ou grava projeto/biblioteca responde
503. A unica coisa que segue sem o Hub e o que fala direto com o Odoo: o envio da lista de
material (/api/lista/*).

Quem diz se o Hub esta conectado e ele mesmo: GET <hub>/api/v1/saude, com o endereco do
C:\\Users\\Public\\NexoHub\\conexao.json (ou NEXOHUB_URL), relido a cada CICLO segundos por uma
thread. Mudou (conectou/caiu), chama o aviso -- o hubserver incrementa a versao e as paginas
abertas recarregam, vazias ou cheias.
"""
import json
import os
import threading
import time
import urllib.request

CICLO = 5.0
# Acima dos 4 s que o Nexo Hub espera o NexoBD na saude dele (ponte/ponte.mjs): com 3 s aqui, um
# NexoBD lento fazia a gente desistir antes de o Hub responder.
TIMEOUT = 6.0
# Uma sonda que falha nao derruba: com o Hub e o NexoBD ocupados (o envio de revisao a cada
# gravacao do MCP), a saude passava do tempo, o hub virava "sem Hub" e TODAS as paginas
# recarregavam vazias (a tela preta), e de novo na sonda seguinte. Cai so com FALHAS_PARA_CAIR
# seguidas, conferidas a cada CICLO_CONFIRMA; volta na primeira que responde.
FALHAS_PARA_CAIR = 3
CICLO_CONFIRMA = 2.0
URL_PADRAO = 'http://127.0.0.1:47800'
MSG = 'sem conexão com o Nexo Hub: os projetos e a biblioteca só aparecem com ele conectado'

# o que segue sem o Hub: codigo/paginas do hub (nao sao dados), o ao vivo, o MCP vendo o hub, e o
# que vai direto ao Odoo
LIVRES_API = ('/api/lista/', '/api/mcp/', '/api/config', '/api/nexohub/')

_estado = {'conectado': None, 'erro': '', 'quando': 0.0, 'falhas': 0}
_trava = threading.Lock()


def ligado(env=os.environ):
    return env.get('ALTIUMHUB_NEXOBD') == '1'


def conexao(env=os.environ):
    if env.get('NEXOHUB_URL'):
        return env['NEXOHUB_URL'].rstrip('/'), env.get('NEXOHUB_TOKEN', '')
    pub = env.get('PUBLIC') or r'C:\Users\Public'
    try:
        with open(os.path.join(pub, 'NexoHub', 'conexao.json'), encoding='utf-8-sig') as f:
            j = json.load(f)
        if j.get('url'):
            return str(j['url']).rstrip('/'), env.get('NEXOHUB_TOKEN') or j.get('token') or ''
    except (OSError, ValueError):
        pass
    return URL_PADRAO, env.get('NEXOHUB_TOKEN', '')


def sonda(env=os.environ):
    """-> (conectado, erro). Conectado = o Hub respondeu e tem os dados (bd.ok)."""
    url, token = conexao(env)
    req = urllib.request.Request(url + '/api/v1/saude', headers={'X-App': 'nexoeletric'})
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            j = json.loads(r.read().decode('utf-8'))
    except Exception as e:                                   # noqa: BLE001
        return False, 'Nexo Hub fora do ar em %s (%s)' % (url, getattr(e, 'reason', e))
    bd = j.get('bd') if isinstance(j, dict) else None
    if not j.get('ok') or (isinstance(bd, dict) and bd.get('ok') is False):
        return False, 'o Nexo Hub está no ar, mas sem os dados'
    return True, ''


def conectado():
    """o ultimo estado medido (a thread mede; antes da 1a medida, mede aqui)"""
    if _estado['conectado'] is None:
        atualiza()
    return bool(_estado['conectado'])


def estado():
    return {'conectado': bool(_estado['conectado']), 'erro': _estado['erro'],
            'quando': _estado['quando'], 'ligado': ligado(), 'falhas': _estado['falhas']}


def atualiza(aviso=None):
    ok, erro = sonda()
    with _trava:
        antes = _estado['conectado']
        falhas = 0 if ok else _estado['falhas'] + 1
        if not ok and antes and falhas < FALHAS_PARA_CAIR:
            agora, erro = True, ''      # falha ainda nao confirmada: segue conectado
        else:
            agora = ok                  # respondeu, ou ja estava fora, ou e a 1a medida, ou confirmou
        mudou = antes is not None and antes != agora
        _estado.update(conectado=agora, erro=erro, quando=time.time(), falhas=falhas)
    if mudou and aviso:
        aviso(agora)
    return agora


def _espera():
    """conectado com uma falha por confirmar: confere logo; senao, o ciclo normal"""
    return CICLO_CONFIRMA if _estado['conectado'] and _estado['falhas'] else CICLO


def inicia(aviso):
    if not ligado():
        return

    def laco():
        while True:
            try:
                atualiza(aviso)
            except Exception:                                # noqa: BLE001
                pass
            time.sleep(_espera())
    threading.Thread(target=laco, daemon=True).start()


def bloqueia(path, metodo='GET'):
    """None = segue; senao (corpo, status, tipo) da resposta 'vazia'"""
    if not ligado() or conectado():
        return None
    p = '/' + path.lstrip('/')
    if p == '/api/index.json':
        return (json.dumps({'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S'), 'projects': [],
                            'semHub': True, 'erro': MSG}), 200, 'application/json')
    if p.startswith('/api/'):
        if p.startswith(LIVRES_API):
            return None
        return (json.dumps({'ok': False, 'error': MSG, 'semHub': True}), 503, 'application/json')
    if p.startswith(('/Projects/', '/Libs/', '/projects.js', '/bom/')):
        if p.endswith('.js'):    # <script src> de biblioteca: vazio, sem quebrar a pagina inteira
            return ('/* %s */\n' % MSG, 200, 'text/javascript')
        return (MSG, 503, 'text/plain; charset=utf-8')
    return None
