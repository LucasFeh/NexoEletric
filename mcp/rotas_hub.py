"""NexoEletric MCP - rotas_hub.py: o canal entre o servidor MCP e a VISTA ABERTA no hub.

O MCP grava os arquivos do projeto direto no disco, e o vigia do hubserver.py ja recarrega a
pagina aberta sozinho. O que falta e o caminho de volta: a IA ver a tela de verdade (screenshot)
e pedir algo a vista (focar um ponto, selecionar). Para isso, uma fila pequena de PEDIDOS em
memoria:

    MCP  --POST /api/mcp/pedido {alvo, proj, acao, args}-->  hub  (guarda, devolve {id})
    vista --GET  /api/mcp/pedidos?alvo=pcb&proj=X-------->  hub  (o que ha para ela)
    vista --POST /api/mcp/resposta/<id> {ok, dados}------->  hub
    MCP  --GET  /api/mcp/resposta/<id>?espera=8---------->  hub  (espera a resposta ate N s)
    GET /api/mcp/status -> {ok, root, versao, vistas}         (o hub_status do MCP le)

A pagina so precisa carregar mcp/hub-mcpvista.js (um <script src>). Pedido so entra vindo DESTA
maquina (o MCP roda ao lado do hub; o pedido faz a pagina de alguem tirar foto da tela): da
rede e 403. Nada aqui grava em disco.

Ligar no hubserver.py (o integrador), no mesmo molde dos outros registraveis, sob try:

    try:
        sys.path.insert(0, os.path.join(ROOT, 'mcp'))
        import rotas_hub as _mcp_rotas      # noqa: E402
        _mcp_rotas.registra(app, ROOT)
    except Exception as _e:                  # noqa: BLE001
        print('AVISO: rotas do MCP desligadas (%s) — falta mcp/rotas_hub.py.' % _e)
"""
import socket
import threading
import time
import uuid

from flask import request

VERSAO = '1.0.0'
VALIDADE = 30.0          # segundos que um pedido espera uma vista pegar
VISTA_VIVA = 10.0        # vista que nao pergunta ha mais que isso e dada como fechada
ESPERA_MAX = 20.0
ACOES = ('screenshot', 'recarregar', 'focar', 'selecionar', 'comando')
ALVOS = ('pcb', 'sch')
MAX_RESPOSTA = 30 * 1024 * 1024   # o PNG da tela vem em base64

_lock = threading.Condition()
_pedidos = {}            # id -> {id, alvo, proj, acao, args, criado, pego, resposta}
_vistas = {}             # (alvo, proj) -> ultima pergunta (time)


def _local(req):
    addr = req.remote_addr
    if addr in ('127.0.0.1', '::1', 'localhost'):
        return True
    try:
        return addr in set(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        return False


def _limpa(agora):
    for k in [k for k, p in _pedidos.items() if agora - p['criado'] > VALIDADE + ESPERA_MAX]:
        del _pedidos[k]
    for k in [k for k, t in _vistas.items() if agora - t > 300]:
        del _vistas[k]


def registra(app, root):
    @app.route('/api/mcp/status')
    def mcp_status():
        agora = time.time()
        with _lock:
            vistas = [{'alvo': a, 'proj': p, 'ha_segundos': round(agora - t, 1)}
                      for (a, p), t in _vistas.items() if agora - t <= VISTA_VIVA]
        return {'ok': True, 'root': root, 'versao': VERSAO, 'vistas': vistas}

    @app.route('/api/mcp/pedido', methods=['POST'])
    def mcp_pedido():
        if not _local(request):
            return {'ok': False, 'error': 'pedido a vista so vem desta maquina'}, 403
        d = request.get_json(silent=True)
        if not isinstance(d, dict):
            return {'ok': False, 'error': 'JSON {alvo, proj, acao, args} obrigatorio'}, 400
        alvo, proj, acao = d.get('alvo'), d.get('proj'), d.get('acao')
        if alvo not in ALVOS or acao not in ACOES or not isinstance(proj, str) or not proj:
            return {'ok': False, 'error': 'alvo (pcb|sch), proj e acao (%s) obrigatorios' % '|'.join(ACOES)}, 400
        args = d.get('args') if isinstance(d.get('args'), dict) else {}
        agora = time.time()
        with _lock:
            _limpa(agora)
            viva = agora - _vistas.get((alvo, proj), 0) <= VISTA_VIVA
            pid = uuid.uuid4().hex
            _pedidos[pid] = {'id': pid, 'alvo': alvo, 'proj': proj, 'acao': acao, 'args': args,
                             'criado': agora, 'pego': False, 'resposta': None}
            _lock.notify_all()
        return {'ok': True, 'id': pid, 'vista_aberta': viva}

    @app.route('/api/mcp/pedidos')
    def mcp_pedidos():
        alvo, proj = request.args.get('alvo', ''), request.args.get('proj', '')
        agora = time.time()
        with _lock:
            _vistas[(alvo, proj)] = agora
            _limpa(agora)
            fila = [p for p in _pedidos.values()
                    if p['alvo'] == alvo and p['proj'] == proj and not p['pego']
                    and agora - p['criado'] <= VALIDADE]
            for p in fila:
                p['pego'] = True
        return {'ok': True, 'pedidos': [{'id': p['id'], 'acao': p['acao'], 'args': p['args']} for p in fila]}

    @app.route('/api/mcp/resposta/<pid>', methods=['POST'])
    def mcp_responde(pid):
        request.max_content_length = MAX_RESPOSTA
        d = request.get_json(silent=True)
        if not isinstance(d, dict):
            return {'ok': False, 'error': 'JSON {ok, dados|erro} obrigatorio'}, 400
        with _lock:
            p = _pedidos.get(pid)
            if p is None:
                return {'ok': False, 'error': 'pedido desconhecido ou vencido'}, 404
            p['resposta'] = {'ok': bool(d.get('ok')), 'dados': d.get('dados'), 'erro': d.get('erro')}
            _lock.notify_all()
        return {'ok': True}

    @app.route('/api/mcp/resposta/<pid>')
    def mcp_resposta(pid):
        if not _local(request):
            return {'ok': False, 'error': 'so desta maquina'}, 403
        try:
            espera = min(ESPERA_MAX, max(0.0, float(request.args.get('espera', '0'))))
        except ValueError:
            espera = 0.0
        fim = time.time() + espera
        with _lock:
            while True:
                p = _pedidos.get(pid)
                if p is None:
                    return {'ok': False, 'error': 'pedido desconhecido ou vencido'}, 404
                if p['resposta'] is not None:
                    r = dict(p['resposta'])
                    del _pedidos[pid]
                    return r
                falta = fim - time.time()
                if falta <= 0:
                    return {'ok': False, 'pendente': True, 'pego': p['pego'],
                            'erro': ('a vista pegou o pedido mas nao respondeu a tempo' if p['pego']
                                     else 'nenhuma vista aberta deste projeto pegou o pedido '
                                          '(a pagina precisa do mcp/hub-mcpvista.js)')}
                _lock.wait(falta)

    return app
