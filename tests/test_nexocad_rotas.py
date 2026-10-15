# -*- coding: utf-8 -*-
"""Rotas /api/nexo/* (tools/rotas/nexocad.py): a biblioteca compartilhada e o NexoCAD.

    python tests/test_nexocad_rotas.py

Tudo de mentira: a biblioteca numa pasta temporaria (DIELETRONS_BIBLIOTECA), o NexoCAD um servidor
HTTP que grava os comandos que recebe (o session.json dele vai no NEXOCAD_SESSION), e o hub um Flask
de verdade numa porta local (8301), porque o servidor baixa os STEP de si mesmo.
"""
import json
import os
import shutil
import sys
import tempfile
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except (AttributeError, ValueError):
    pass

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'rotas'))

from flask import Flask, Response  # noqa: E402
from werkzeug.serving import make_server  # noqa: E402

PORTA_HUB = int(os.environ.get('TESTE_PORTA_HUB', '8301'))
PORTA_NX = PORTA_HUB + 1
STEP = b'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n'

tmp = tempfile.mkdtemp(prefix='nexo-')
falhas = []


def confere(cond, msg):
    print(('ok   ' if cond else 'FALHA ') + msg)
    if not cond:
        falhas.append(msg)


# ---------- a biblioteca ----------
BIB = os.path.join(tmp, 'Biblioteca')
os.makedirs(os.path.join(BIB, 'itens', 'el-sot23-a1'))
os.makedirs(os.path.join(BIB, 'itens', 'mec-parafuso'))
with open(os.path.join(BIB, 'itens', 'el-sot23-a1', 'modelo.step'), 'wb') as f:
    f.write(STEP)
with open(os.path.join(BIB, 'itens', 'el-sot23-a1', 'thumb.png'), 'wb') as f:
    f.write(b'\x89PNG\r\n\x1a\n')
with open(os.path.join(tmp, 'segredo.txt'), 'w') as f:
    f.write('nao sai')
indice = {
    'format': 'dieletrons-biblioteca', 'version': 1, 'revisao': 7,
    'categorias': ['Eletrônicos', 'Mecânicos'],
    'itens': [
        {'id': 'el-sot23-a1', 'nome': 'SOT-23', 'categoria': 'Eletrônicos', 'rev': 2,
         'arquivos': {'step': 'itens/el-sot23-a1/modelo.step', 'thumb': 'itens/el-sot23-a1/thumb.png'},
         'eletronico': {'footprints': ['SOT23']}, 'substitui': ['3d-hub/abc.step']},
        {'id': 'mec-parafuso', 'nome': 'Parafuso M3', 'categoria': 'Mecânicos', 'rev': 1,
         'arquivos': {'step': '../segredo.txt'}},
    ]}
with open(os.path.join(BIB, 'biblioteca.json'), 'w', encoding='utf-8') as f:
    json.dump(indice, f, ensure_ascii=False)
os.environ['DIELETRONS_BIBLIOTECA'] = BIB
os.environ['DIELETRONS_PONTEIRO'] = os.path.join(tmp, 'nao-existe.json')
os.environ['NEXOCAD_SESSION'] = os.path.join(tmp, 'session.json')
os.environ.pop('NEXOCAD_EXE', None)

import nexocad as N  # noqa: E402
# NUNCA o exe de verdade: nesta maquina o NexoCAD esta instalado e o teste o abriria
N.acha_exe = lambda: ''

# ---------- o NexoCAD de mentira ----------
recebidos = []


class NX(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _ok(self, obj, st=200):
        b = json.dumps(obj).encode()
        self.send_response(st)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.headers.get('Authorization') != 'Bearer tk':
            return self._ok({'ok': False, 'error': 'token'}, 401)
        self._ok({'ok': True, 'version': '0.6.0'})

    def do_POST(self):
        if self.headers.get('Authorization') != 'Bearer tk':
            return self._ok({'ok': False, 'error': 'token'}, 401)
        n = int(self.headers.get('Content-Length') or 0)
        corpo = json.loads(self.rfile.read(n))
        recebidos.append(corpo)
        c = corpo.get('command')
        if c == 'biblioteca_editar_modelo':
            p = corpo['params']
            ok = (not p.get('step_path')) or open(p['step_path'], 'rb').read().startswith(b'ISO-10303-21')
            return self._ok({'ok': ok, 'result': {'id': 'el-novo-1', 'criado': True}})
        if c == 'pcb_importar':
            return self._ok({'ok': True, 'result': {'id': 'pl-1', 'pecas': 3}})
        if c == 'biblioteca_abrir':
            return self._ok({'ok': True, 'result': {'aberto': corpo['params']['id']}})
        self._ok({'ok': False, 'error': 'comando desconhecido'})


nx = ThreadingHTTPServer(('127.0.0.1', PORTA_NX), NX)
threading.Thread(target=nx.serve_forever, daemon=True).start()

# ---------- o hub ----------
app = Flask(__name__)


@app.route('/Libs/3d-hub/<nome>')
def step_hub(nome):
    if nome == 'naoestep.step':
        return Response(b'oi', mimetype='text/plain')
    return Response(STEP, mimetype='application/step')


N.registra(app, tmp)
srv = make_server('127.0.0.1', PORTA_HUB, app, threaded=True)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % PORTA_HUB


def get(c):
    try:
        with urllib.request.urlopen(BASE + c, timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def post(c, obj):
    req = urllib.request.Request(BASE + c, data=json.dumps(obj).encode(), method='POST',
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


try:
    # raiz: variavel > ponteiro > padrao
    confere(N.raiz() == os.path.abspath(BIB), 'raiz pela variavel DIELETRONS_BIBLIOTECA')
    del os.environ['DIELETRONS_BIBLIOTECA']
    pont = os.path.join(tmp, 'ponteiro.json')
    with open(pont, 'w') as f:
        json.dump({'dir': BIB}, f)
    os.environ['DIELETRONS_PONTEIRO'] = pont
    confere(N.raiz() == os.path.abspath(BIB), 'raiz pelo ponteiro')
    os.environ['DIELETRONS_PONTEIRO'] = os.path.join(tmp, 'nao-existe.json')
    confere(N.raiz() == N.PADRAO_DIR, 'sem variavel nem ponteiro: o padrao')
    os.environ['DIELETRONS_BIBLIOTECA'] = BIB

    st, b = get('/api/nexo/revisao')
    j = json.loads(b)
    confere(st == 200 and j['revisao'] == 7 and j['mtime'] > 0, 'revisao: %r' % j)

    st, b = get('/api/nexo/biblioteca')
    j = json.loads(b)
    confere([i['id'] for i in j['itens']] == ['el-sot23-a1'], 'biblioteca: o padrao e Eletronicos')
    st, b = get('/api/nexo/biblioteca?categoria=*')
    confere(len(json.loads(b)['itens']) == 2, 'biblioteca: categoria=* traz todas')
    st, b = get('/api/nexo/biblioteca?categoria=Mecanicos')
    confere(len(json.loads(b)['itens']) == 1, 'biblioteca: categoria sem acento casa')
    st, b = get('/api/nexo/biblioteca?categoria=*&texto=sot23')
    confere([i['id'] for i in json.loads(b)['itens']] == ['el-sot23-a1'], 'biblioteca: texto acha pelo footprint')

    st, b = get('/api/nexo/arquivo/el-sot23-a1/modelo.step')
    confere(st == 200 and b == STEP, 'arquivo: modelo.step')
    st, b = get('/api/nexo/arquivo/el-sot23-a1/thumb.png')
    confere(st == 200 and b.startswith(b'\x89PNG'), 'arquivo: thumb.png')
    st, b = get('/api/nexo/arquivo/mec-parafuso/modelo.step')
    confere(st == 404, 'arquivo: caminho do indice que sai da raiz = 404')
    st, b = get('/api/nexo/arquivo/el-sot23-a1/modelo.nexo')
    confere(st == 404, 'arquivo: so modelo.step e thumb.png')
    st, b = get('/api/nexo/arquivo/..%2F..%2Fsegredo.txt/modelo.step')
    confere(st == 404, 'arquivo: id com .. = 404')

    # estado sem o NexoCAD
    st, b = get('/api/nexo/estado')
    j = json.loads(b)
    confere(j['ok'] and j['existe'] and j['revisao'] == 7 and j['nexocad']['aberto'] is False, 'estado: NexoCAD fechado')
    st, j = post('/api/nexo/editar', {'id': 'el-sot23-a1'})
    confere(st == 503 and not j['ok'] and 'executável' in j['error'], 'editar sem NexoCAD e sem exe: 503 (%s)' % j.get('error'))

    # com o NexoCAD
    with open(os.environ['NEXOCAD_SESSION'], 'w') as f:
        json.dump({'port': PORTA_NX, 'token': 'tk', 'pid': 1}, f)
    st, b = get('/api/nexo/estado')
    j = json.loads(b)
    confere(j['nexocad']['aberto'] is True and j['nexocad']['versao'] == '0.6.0', 'estado: NexoCAD aberto, versao')

    st, j = post('/api/nexo/editar', {'id': 'el-sot23-a1'})
    confere(st == 200 and j['ok'] and recebidos[-1]['command'] == 'biblioteca_abrir'
            and recebidos[-1]['source'] == 'eletrichub', 'editar {id} -> biblioteca_abrir')

    st, j = post('/api/nexo/editar', {'chave': '3d-hub/abc.step', 'url': '/Libs/3d-hub/abc.step', 'nome': 'X.step', 'footprint': 'SOT23'})
    confere(j['ok'] and recebidos[-1]['command'] == 'biblioteca_abrir' and recebidos[-1]['params']['id'] == 'el-sot23-a1',
            'editar com chave que um item ja substitui -> abre o item')

    st, j = post('/api/nexo/editar', {'chave': '3d-hub/novo.step', 'url': 'Libs/3d-hub/novo.step', 'nome': 'Novo.step', 'footprint': 'QFN'})
    p = recebidos[-1]['params']
    confere(st == 200 and j['ok'] and j['id'] == 'el-novo-1' and recebidos[-1]['command'] == 'biblioteca_editar_modelo'
            and p['chave'] == '3d-hub/novo.step' and p['footprint'] == 'QFN' and os.path.isfile(p['step_path']),
            'editar {chave,url}: baixa de si e passa step_path')

    st, j = post('/api/nexo/editar', {'chave': '3d-hub/x.step', 'url': '/Libs/3d-hub/naoestep.step', 'nome': 'x'})
    confere(st == 422 and not j['ok'], 'editar: o que nao e STEP nao segue')
    st, j = post('/api/nexo/editar', {'chave': 'k', 'url': 'http://exemplo.com/a.step'})
    confere(st == 400, 'editar: url de outro host recusada')

    geo = {'pads': [{'nome': '1', 'x': -2.7, 'y': 1.9, 'w': 1.5, 'h': 0.6, 'rot': 0, 'forma': 'rect', 'furo': 0}],
           'contorno': [[-3, -2.5], [3, -2.5], [3, 2.5], [-3, 2.5]]}
    st, j = post('/api/nexo/editar', {'novo': True, 'footprint': 'SOIC8', 'nome': 'SOIC8', 'geometria': geo})
    p = recebidos[-1]['params']
    confere(j['ok'] and p.get('novo') is True and 'step_path' not in p and p['footprint'] == 'SOIC8', 'editar {novo:true}: item vazio')
    confere(p.get('geometria') == geo, 'editar: geometria vai ao NexoCAD como veio')

    # placa
    pac = {'format': 'eletrichub-placa-v1', 'projeto': 'Teste/Placa', 'espessura': 1.6,
           'contorno': [[[0, 0], [10, 0], [10, 10], [0, 10]]], 'recortes': [], 'furos': [],
           'componentes': [{'ref': 'U1', 'corpos': [
               {'tipo': 'step', 'modelo': '3d-hub/abc.step', 'matriz': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1.6, 1]},
               {'tipo': 'step', 'modelo': '3d-hub/naoestep.step', 'matriz': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]}]}],
           'modelos': {'3d-hub/abc.step': {'arquivo': 'modelos/abc.step', 'nome': 'abc.step', 'url': '/Libs/3d-hub/abc.step'},
                       '3d-hub/naoestep.step': {'arquivo': 'modelos/../x.step', 'nome': 'n.step', 'url': '/Libs/3d-hub/naoestep.step'}}}
    st, j = post('/api/nexo/placa', {'pacote': pac})
    confere(st == 200 and j['ok'] and recebidos[-1]['command'] == 'pcb_importar', 'placa -> pcb_importar (%s)' % j.get('error'))
    arq = recebidos[-1]['params']['path']
    g = json.load(open(arq, encoding='utf-8'))
    confere(os.path.basename(os.path.dirname(arq)).startswith('Teste_Placa-'), 'placa: pasta com o nome seguro do projeto')
    confere(list(g['modelos']) == ['3d-hub/abc.step'] and 'url' not in g['modelos']['3d-hub/abc.step'], 'placa: so o modelo que baixou, sem url')
    confere(open(os.path.join(os.path.dirname(arq), 'modelos', 'abc.step'), 'rb').read() == STEP, 'placa: modelos/abc.step gravado')
    confere(len(g['componentes'][0]['corpos']) == 1 and len(j['avisos']) == 1, 'placa: corpo sem modelo sai, com aviso')
    shutil.rmtree(os.path.dirname(arq), ignore_errors=True)
    st, j = post('/api/nexo/placa', {'pacote': {'format': 'outro'}})
    confere(st == 400, 'placa: formato errado = 400')

    # so desta maquina
    app2 = Flask('x')
    N.registra(app2, tmp, lambda req: False)
    c = app2.test_client()
    r = c.post('/api/nexo/editar', json={'id': 'el-sot23-a1'})
    confere(r.status_code == 403, 'editar de fora = 403')
    r = c.post('/api/nexo/placa', json={'pacote': pac})
    confere(r.status_code == 403, 'placa de fora = 403')
finally:
    srv.shutdown()
    nx.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)

print()
print('%d falha(s)' % len(falhas) if falhas else 'tudo certo')
sys.exit(1 if falhas else 0)
