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
TIMEOUT = 3.0
URL_PADRAO = 'http://127.0.0.1:47800'
MSG = 'sem conexão com o Nexo Hub: os projetos e a biblioteca só aparecem com ele conectado'

# o que segue sem o Hub: codigo/paginas do hub (nao sao dados), o ao vivo, o MCP vendo o hub, e o
# que vai direto ao Odoo
LIVRES_API = ('/api/lista/', '/api/mcp/', '/api/config', '/api/nexohub/')

_estado = {'conectado': None, 'erro': '', 'quando': 0.0}
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
            'quando': _estado['quando'], 'ligado': ligado()}


def atualiza(aviso=None):
    ok, erro = sonda()
    with _trava:
        mudou = _estado['conectado'] is not None and _estado['conectado'] != ok
        _estado.update(conectado=ok, erro=erro, quando=time.time())
    if mudou and aviso:
        aviso(ok)
    return ok


def inicia(aviso):
    if not ligado():
        return

    def laco():
        while True:
            try:
                atualiza(aviso)
            except Exception:                                # noqa: BLE001
                pass
            time.sleep(CICLO)
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
