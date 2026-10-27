# -*- coding: utf-8 -*-
"""Sem o Nexo Hub, o NexoEletric fica vazio (nexohub_gate.py) e o Odoo vai pelo Hub (nexohub_odoo.py).

Um Nexo Hub de mentira (http.server, porta livre) responde a saude e as rotas /api/v1/odoo/*:
  1. Hub conectado (saude ok + bd.ok): nada e bloqueado;
  2. Hub no ar sem os dados (bd.ok false) e Hub fora do ar: indice vazio com semHub, Libs/*.js vazio,
     /api/save e /api/symbols/* em 503; seguem a pagina, o ao vivo, o MCP e a lista do Odoo;
  3. o hubserver de verdade (Flask test_client) com ALTIUMHUB_NEXOBD=1: o POST de sincronizar vira o
     do Hub e o stream repete as linhas do estado ate o 'done' com o resumo;
  4. fora do app desktop (sem ALTIUMHUB_NEXOBD) nada muda.
Roda com pytest ou sozinho.
"""
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(BASE)
sys.path.insert(0, RAIZ)

ESTADO = {'saude': {'ok': True, 'bd': {'ok': True}}, 'pedidos': [], 'cfg': {'url': 'http://odoo', 'db': 'odoo_db', 'login': 'x', 'temSenha': False}}


class Hub(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, st, obj):
        b = json.dumps(obj).encode('utf-8')
        self.send_response(st)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _corpo(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'{}')

    def do_GET(self):
        if self.path == '/api/v1/saude':
            return self._json(200, ESTADO['saude'])
        if self.path == '/api/v1/odoo/estado':
            return self._json(200, {'rodando': False, 'ultimo': {'id': 'r1', 'ok': True, 'linhas': ['puxando', 'gerando'],
                                                                  'resumo': {'simbolos': 3}, 'revisao': 7}})
        if self.path == '/api/v1/odoo/config':
            return self._json(200, ESTADO['cfg'])
        self._json(404, {})

    def do_POST(self):
        if self.path == '/api/v1/odoo/sincronizar':
            ESTADO['pedidos'].append(self._corpo())
            return self._json(202, {'id': 'r1'})
        self._json(404, {})

    def do_PUT(self):
        if self.path == '/api/v1/odoo/config':
            d = self._corpo()
            ESTADO['pedidos'].append(('config', d))
            if d.get('senha'):
                ESTADO['cfg']['temSenha'] = True
            return self._json(200, ESTADO['cfg'])
        self._json(404, {})


def _sobe():
    srv = ThreadingHTTPServer(('127.0.0.1', 0), Hub)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://127.0.0.1:%d' % srv.server_address[1]


def _gate(url):
    os.environ['ALTIUMHUB_NEXOBD'] = '1'
    os.environ['NEXOHUB_URL'] = url
    import nexohub_gate as G
    G._estado['conectado'] = None
    return G


def test_conectado_nao_bloqueia_e_desconectado_esvazia():
    srv, url = _sobe()
    try:
        G = _gate(url)
        ESTADO['saude'] = {'ok': True, 'bd': {'ok': True}}
        G.atualiza()
        assert G.bloqueia('/api/index.json') is None
        assert G.bloqueia('/Libs/pcblib.js') is None
        ESTADO['saude'] = {'ok': True, 'bd': {'ok': False}}
        mudou = []
        G.atualiza(mudou.append)
        assert mudou == [False]
        corpo, st, _ = G.bloqueia('/api/index.json')
        j = json.loads(corpo)
        assert st == 200 and j['projects'] == [] and j['semHub']
        assert G.bloqueia('/Libs/pcblib.js')[1] == 200 and 'pcblib' not in G.bloqueia('/Libs/pcblib.js')[0]
        assert G.bloqueia('/api/save', 'POST')[1] == 503
        assert G.bloqueia('/api/symbols/almox-sync', 'POST')[1] == 503
        assert G.bloqueia('/Projects/X/board.js')[1] == 200
        for livre in ('/', '/hub.html', '/hub-core.js', '/__live.js', '/__events', '/api/lista/envio', '/api/mcp/status', '/api/nexohub/estado'):
            assert G.bloqueia(livre) is None, livre
    finally:
        srv.shutdown()
    G._estado['conectado'] = None
    G.atualiza()                                   # Hub fora do ar
    assert not G.conectado() and 'fora do ar' in G.estado()['erro']
    assert json.loads(G.bloqueia('/api/index.json')[0])['projects'] == []


def test_fora_do_app_desktop_nada_muda():
    import nexohub_gate as G
    antes = os.environ.pop('ALTIUMHUB_NEXOBD', None)
    try:
        assert G.bloqueia('/api/index.json') is None
    finally:
        if antes is not None:
            os.environ['ALTIUMHUB_NEXOBD'] = antes


def test_hubserver_sincroniza_pelo_hub():
    srv, url = _sobe()
    try:
        G = _gate(url)
        ESTADO['saude'] = {'ok': True, 'bd': {'ok': True}}
        ESTADO['pedidos'] = []
        G.atualiza()
        import hubserver
        c = hubserver.app.test_client()
        r = c.post('/api/symbols/almox-sync', json={'pull': True})
        assert r.status_code == 202 and r.get_json()['runId'] == 'r1'
        assert ESTADO['pedidos'] == [{'pull': True}]
        txt = c.get('/api/symbols/almox-sync/r1/stream').get_data(as_text=True)
        assert 'data: puxando' in txt and 'data: gerando' in txt
        assert 'event: done' in txt and '"simbolos": 3' in txt
        cfg = c.get('/api/almox/config').get_json()
        assert cfg['ok'] and cfg['config']['db'] == 'odoo_db' and 'senha' not in cfg['config']
        c.post('/api/almox/config', json={'login': '', 'senha': 's3'})
        assert ESTADO['pedidos'][-1] == ('config', {'senha': 's3'})   # campo vazio nao vai
        assert c.get('/api/almox/config').get_json()['config']['temSenha'] is True
    finally:
        srv.shutdown()


if __name__ == '__main__':
    test_conectado_nao_bloqueia_e_desconectado_esvazia()
    test_fora_do_app_desktop_nada_muda()
    test_hubserver_sincroniza_pelo_hub()
    print('ok')
