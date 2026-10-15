# -*- coding: utf-8 -*-
"""Rotas /api/nexo/* (tools/rotas/nexocad.py): o Nexo Hub e o NexoCAD.

    python tests/test_nexocad_rotas.py

Tudo de mentira: o Nexo Hub e o tests/nexohub-falso.js (Node, em memoria; NEXOHUB_URL), o NexoCAD um
servidor HTTP que grava os comandos que recebe (o session.json dele vai no NEXOCAD_SESSION), e o hub um
Flask de verdade numa porta local (8301), porque o servidor baixa os STEP de si mesmo. Precisa do Node
no PATH (ou em NODE).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
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
PORTA_NH = PORTA_HUB + 2
STEP = b'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n'

tmp = tempfile.mkdtemp(prefix='nexo-')
falhas = []


def confere(cond, msg):
    print(('ok   ' if cond else 'FALHA ') + msg)
    if not cond:
        falhas.append(msg)


# ---------- o Nexo Hub de mentira ----------
NODE = os.environ.get('NODE') or shutil.which('node') or 'node'
# NEXOHUB_TESTE_REAL=1: o servidor de verdade (..\nexohub\server\index.mjs), numa pasta de dados temporaria
REAL = os.environ.get('NEXOHUB_TESTE_REAL') == '1'
SERVIDOR = os.environ.get('NEXOHUB_SERVIDOR') or os.path.join(os.path.dirname(RAIZ), 'nexohub', 'server', 'index.mjs')
if REAL:
    nhp = subprocess.Popen([NODE, SERVIDOR, '--dados', os.path.join(tmp, 'nexohub'), '--porta', str(PORTA_NH), '--host', '127.0.0.1',
                            '--sem-ponteiro', '--sem-backup'], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    NH_URL = 'http://127.0.0.1:%d' % PORTA_NH
    for _ in range(100):
        try:
            urllib.request.urlopen(NH_URL + '/api/v1/saude', timeout=1).read()
            break
        except OSError:
            time.sleep(0.1)
    print('Nexo Hub DE VERDADE em %s' % NH_URL)
else:
    nhp = subprocess.Popen([NODE, os.path.join(RAIZ, 'tests', 'nexohub-falso.js'), '--porta', str(PORTA_NH)],
                           stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    linha = nhp.stdout.readline().decode().strip()
    assert linha.startswith('pronto '), linha
    NH_URL = linha.split(' ', 1)[1]
os.environ['NEXOHUB_URL'] = NH_URL
os.environ['NEXOHUB_CONEXAO'] = os.path.join(tmp, 'nao-existe.json')
os.environ['NEXOHUB_CACHE'] = os.path.join(tmp, 'cache')
os.environ['NEXOCAD_SESSION'] = os.path.join(tmp, 'session.json')
os.environ.pop('NEXOCAD_EXE', None)
os.environ['NEXOCAD_NAO_ABRIR'] = '1'      # nunca o NexoCAD instalado nesta maquina


def nh(metodo, caminho, corpo=None, cru=None):
    dados = cru if cru is not None else (json.dumps(corpo).encode() if corpo is not None else None)
    req = urllib.request.Request(NH_URL + caminho, data=dados, method=metodo,
                                 headers={'Content-Type': 'application/octet-stream' if cru is not None else 'application/json'})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def revisao_nexo(item_id, dados):
    """o que o NexoCAD faz no Ctrl+S: sobe o STEP (e o .nexo) e cria a revisao seguinte, herdando o resto"""
    st = nh('POST', '/api/v1/blobs', cru=dados.encode())
    it = nh('GET', '/api/v1/itens/%s' % item_id)
    return nh('POST', '/api/v1/itens/%s/revisoes' % item_id, {'arquivos': {'step': st['sha256'], 'nexo': st['sha256']},
                                                                'herdar': True, 'base': it['rev'], 'app': 'nexocad'})['numero']


# o que ja esta no Nexo Hub: um modelo sincronizado (rev 1), um componente que veste o SOT23, um mecanico
b = nh('POST', '/api/v1/blobs', cru=STEP)
png = nh('POST', '/api/v1/blobs', cru=b'\x89PNG\r\n\x1a\nthumb')
mod = nh('POST', '/api/v1/itens', {'tipo': 'modelo3d', 'categoria': 'eletronicos/modelos-3d', 'nome': 'abc',
                                   'atributos': {'footprints': ['SOT23'], 'origem': 'pcblib-hub'},
                                   'chaves': [{'sistema': 'nexoeletric-modelo', 'chave': '3d-hub/abc.step'}]})
nh('POST', '/api/v1/itens/%s/revisoes' % mod['id'], {'arquivos': {'step': b['sha256'], 'origem': b['sha256']}, 'base': 0})
comp = nh('POST', '/api/v1/itens', {'tipo': 'componente', 'categoria': 'eletronicos', 'nome': 'SOT-23',
                                    'atributos': {'footprints': ['SOT23'], 'mpn': 'BC817'}})
nh('POST', '/api/v1/itens/%s/revisoes' % comp['id'], {'arquivos': {'step': b['sha256'], 'thumb': png['sha256']}, 'base': 0})
mec = nh('POST', '/api/v1/itens', {'tipo': 'peca', 'categoria': 'mecanicos', 'nome': 'Parafuso M3'})

import nexocad as N  # noqa: E402
N.acha_exe = lambda: ''   # NUNCA o exe de verdade: nesta maquina o NexoCAD esta instalado

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
            return self._ok({'ok': ok, 'result': {'id': p.get('id') or 'el-novo-1', 'criado': not p.get('id')}})
        if c == 'pcb_importar':
            return self._ok({'ok': True, 'result': {'id': 'me-montagem-1', 'pecas': 3}})
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
    return Response(STEP.replace(b'HEADER;', b'HEADER;/*' + nome.encode() + b'*/'), mimetype='application/step')


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


def espera(f, s=8.0):
    fim = time.time() + s
    while time.time() < fim:
        if f():
            return True
        time.sleep(0.1)
    return False


def chaves_modelo():
    return {i['id']: i for i in nh('GET', '/api/v1/itens?limite=500')['itens']}


try:
    # conexao: variavel > arquivo > padrao
    confere(N.conexao()['url'] == NH_URL, 'conexao pela variavel NEXOHUB_URL')
    del os.environ['NEXOHUB_URL']
    cx = os.path.join(tmp, 'conexao.json')
    with open(cx, 'w') as f:
        json.dump({'url': NH_URL + '/', 'token': 't'}, f)
    os.environ['NEXOHUB_CONEXAO'] = cx
    confere(N.conexao() == {'url': NH_URL, 'token': 't'}, 'conexao pelo conexao.json')
    os.environ['NEXOHUB_CONEXAO'] = os.path.join(tmp, 'nao-existe.json')
    confere(N.conexao()['url'] == N.PADRAO_URL, 'sem variavel nem arquivo: o padrao')
    os.environ['NEXOHUB_URL'] = NH_URL

    # a revisao: o seq do Nexo Hub, pelo SSE
    st, b = get('/api/nexo/revisao')
    confere(st == 200, 'revisao responde')
    confere(espera(lambda: json.loads(get('/api/nexo/revisao')[1])['revisao'] > 0), 'revisao: a thread pegou o seq')
    r0 = json.loads(get('/api/nexo/revisao')[1])['revisao']

    st, b = get('/api/nexo/biblioteca')
    j = json.loads(b)
    ids = sorted(i['id'] for i in j['itens'])
    confere(ids == sorted([mod['id'], comp['id']]), 'biblioteca: o padrao e Eletronicos (com os Modelos 3D): %r' % ids)
    m = [i for i in j['itens'] if i['id'] == mod['id']][0]
    c = [i for i in j['itens'] if i['id'] == comp['id']][0]
    confere(m['substitui'] == [] and m['chaves'] == ['3d-hub/abc.step'] and 'eletronico' not in m, 'modelo rev 1: nao substitui, nao veste')
    confere(c['eletronico']['footprints'] == ['SOT23'] and c['categoria'] == 'Eletrônicos' and c['arquivos'].get('step'),
            'componente: veste o footprint, tem step')
    confere(m['subcategoria'] == 'Modelos 3D da PcbLib', 'subcategoria pelo nome')
    st, b = get('/api/nexo/biblioteca?categoria=*')
    confere(len(json.loads(b)['itens']) == 3, 'biblioteca: categoria=* traz todas')
    st, b = get('/api/nexo/biblioteca?categoria=Mecanicos')
    confere([i['id'] for i in json.loads(b)['itens']] == [mec['id']], 'biblioteca: categoria sem acento casa')
    st, b = get('/api/nexo/biblioteca?categoria=*&texto=bc817')
    confere([i['id'] for i in json.loads(b)['itens']] == [comp['id']], 'biblioteca: texto acha pelo MPN')

    st, b = get('/api/nexo/arquivo/%s/modelo.step' % comp['id'])
    confere(st == 200 and b == STEP, 'arquivo: modelo.step (repassado do Nexo Hub)')
    confere(os.path.isfile(os.path.join(tmp, 'cache', b_sha[:2], b_sha)) if (b_sha := nh('POST', '/api/v1/blobs', cru=STEP)['sha256']) else False,
            'arquivo: guardado no cache pelo sha')
    st, b = get('/api/nexo/arquivo/%s/modelo.step?rev=1' % comp['id'])
    confere(st == 200 and b == STEP, 'arquivo: ?rev= da revisao atual vem do cache')
    st, b = get('/api/nexo/arquivo/%s/thumb.png' % comp['id'])
    confere(st == 200 and b.startswith(b'\x89PNG'), 'arquivo: thumb.png')
    st, b = get('/api/nexo/arquivo/%s/step' % mec['id'])
    confere(st == 404, 'arquivo: item sem o papel = 404')
    st, b = get('/api/nexo/arquivo/%s/segredo' % comp['id'])
    confere(st == 404, 'arquivo: papel desconhecido = 404')
    st, b = get('/api/nexo/arquivo/..%2F..%2Fx/step')
    confere(st == 404, 'arquivo: id com .. = 404')

    # o NexoCAD salva a rev 2 do modelo: a revisao sobe, e a biblioteca passa a dizer substitui
    confere(revisao_nexo(mod['id'], 'ISO-10303-21;\n/* editado */\nEND-ISO-10303-21;\n') == 2, 'o NexoCAD gravou a rev 2')
    confere(espera(lambda: json.loads(get('/api/nexo/revisao')[1])['revisao'] > r0), 'revisao sobe com o evento do SSE')
    st, b = get('/api/nexo/biblioteca')
    m = [i for i in json.loads(b)['itens'] if i['id'] == mod['id']][0]
    confere(m['rev'] == 2 and m['substitui'] == ['3d-hub/abc.step'], 'rev 2: substitui a chave (%r)' % m)
    st, b = get('/api/nexo/arquivo/%s/modelo.step?rev=2' % mod['id'])
    confere(st == 200 and b'editado' in b, 'arquivo: a rev 2')
    st, b = get('/api/nexo/arquivo/%s/step?rev=1' % mod['id'])
    confere(st == 200 and b == STEP, 'arquivo: a rev 1 continua la')

    # estado sem o NexoCAD
    st, b = get('/api/nexo/estado')
    j = json.loads(b)
    confere(j['ok'] and j['nexohub']['online'] and j['itens'] == 3 and j['nexocad']['aberto'] is False, 'estado: Nexo Hub no ar, NexoCAD fechado')
    st, j = post('/api/nexo/editar', {'id': comp['id']})
    confere(st == 503 and not j['ok'] and 'executável' in j['error'], 'editar sem NexoCAD e sem exe: 503 (%s)' % j.get('error'))

    # com o NexoCAD
    with open(os.environ['NEXOCAD_SESSION'], 'w') as f:
        json.dump({'port': PORTA_NX, 'token': 'tk', 'pid': 1}, f)
    st, b = get('/api/nexo/estado')
    j = json.loads(b)
    confere(j['nexocad']['aberto'] is True and j['nexocad']['versao'] == '0.6.0', 'estado: NexoCAD aberto, versao')

    st, j = post('/api/nexo/editar', {'id': comp['id']})
    confere(st == 200 and j['ok'] and recebidos[-1]['command'] == 'biblioteca_abrir'
            and recebidos[-1]['source'] == 'eletrichub', 'editar {id} -> biblioteca_abrir')

    geo = {'pads': [{'nome': '1', 'x': -2.7, 'y': 1.9, 'w': 1.5, 'h': 0.6, 'rot': 0, 'forma': 'rect', 'furo': 0}],
           'contorno': [[-3, -2.5], [3, -2.5], [3, 2.5], [-3, 2.5]]}
    st, j = post('/api/nexo/editar', {'chave': '3d-hub/abc.step', 'url': '/Libs/3d-hub/abc.step', 'nome': 'X.step', 'footprint': 'SOT23', 'geometria': geo})
    p = recebidos[-1]['params']
    confere(j['ok'] and recebidos[-1]['command'] == 'biblioteca_editar_modelo' and p['id'] == mod['id'] and 'step_path' not in p
            and p['geometria'] == geo and j['criado'] is False, 'editar com chave que ja e item -> o NexoCAD abre o item, com a geometria')

    st, j = post('/api/nexo/editar', {'chave': '3d-hub/novo.step', 'url': 'Libs/3d-hub/novo.step', 'nome': 'Novo.step', 'footprint': 'QFN'})
    p = recebidos[-1]['params']
    novo = nh('POST', '/api/v1/chaves/resolver', {'sistema': 'nexoeletric-modelo', 'chaves': ['3d-hub/novo.step']})['3d-hub/novo.step']
    confere(st == 200 and j['ok'] and j['criado'] and novo and novo['rev'] == 1 and p['id'] == novo['id'] and p['footprint'] == 'QFN',
            'editar {chave,url} nova: publica o modelo (rev 1) e passa o id (%r)' % j)
    it = nh('GET', '/api/v1/itens/%s' % novo['id'])
    confere(it['tipo'] == 'modelo3d' and it['atributos']['footprints'] == ['QFN'] and set(it['arquivos']) == {'step', 'origem'},
            'o item novo: modelo3d, footprints, step e origem')

    st, j = post('/api/nexo/editar', {'chave': '3d-hub/x.step', 'url': '/Libs/3d-hub/naoestep.step', 'nome': 'x'})
    confere(st == 422 and not j['ok'], 'editar: o que nao e STEP nao segue')
    st, j = post('/api/nexo/editar', {'chave': 'k', 'url': 'http://exemplo.com/a.step'})
    confere(st == 400, 'editar: url de outro host recusada')

    st, j = post('/api/nexo/editar', {'novo': True, 'footprint': 'SOIC8', 'nome': 'SOIC8', 'geometria': geo})
    p = recebidos[-1]['params']
    confere(j['ok'] and p.get('novo') is True and 'step_path' not in p and p['footprint'] == 'SOIC8', 'editar {novo:true}: item vazio')
    confere(p.get('geometria') == geo, 'editar: geometria vai ao NexoCAD como veio')

    # placa
    I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1.6, 1]
    pac = {'format': 'eletrichub-placa-v1', 'projeto': 'Teste/Placa', 'gerado': '2026-10-15T10:00:00Z', 'espessura': 1.6,
           'contorno': [[[0, 0], [10, 0], [10, 10], [0, 10]]], 'recortes': [], 'furos': [],
           'componentes': [{'ref': 'U1', 'footprint': 'SOT23', 'corpos': [
               {'tipo': 'step', 'modelo': '3d-hub/abc.step', 'matriz': I},
               {'tipo': 'step', 'modelo': '3d-hub/naoestep.step', 'matriz': I}]},
               {'ref': 'U2', 'footprint': 'SOT23', 'corpos': [{'tipo': 'step', 'modelo': 'nexo:' + comp['id'], 'matriz': I}]},
               {'ref': 'U3', 'footprint': 'QFP', 'corpos': [{'tipo': 'step', 'modelo': '3d-hub/qfp.step', 'matriz': I}]}],
           'modelos': {'3d-hub/abc.step': {'arquivo': 'modelos/abc.step', 'nome': 'abc.step', 'url': '/api/nexo/arquivo/%s/modelo.step?rev=2' % mod['id']},
                       '3d-hub/naoestep.step': {'arquivo': 'modelos/n.step', 'nome': 'n.step', 'url': '/Libs/3d-hub/naoestep.step'},
                       'nexo:' + comp['id']: {'arquivo': 'modelos/sot.step', 'nome': 'SOT-23', 'url': '/api/nexo/arquivo/%s/modelo.step?rev=1' % comp['id']},
                       '3d-hub/qfp.step': {'arquivo': 'modelos/qfp.step', 'nome': 'qfp.step', 'url': '/Libs/3d-hub/qfp.step'}}}
    st, j = post('/api/nexo/placa', {'pacote': pac})
    confere(st == 200 and j['ok'] and recebidos[-1]['command'] == 'pcb_importar' and recebidos[-1]['params'] == {'item': j['item']},
            'placa -> publica e pcb_importar {item} (%s)' % j.get('error'))
    pl = nh('GET', '/api/v1/itens/%s' % j['item'])
    confere(pl['tipo'] == 'placa' and pl['categoria'] == 'placas' and pl['rev'] == 1
            and {'sistema': 'nexoeletric-placa', 'chave': 'Teste/Placa'} in pl['chaves'], 'placa: item placa, chave = projeto, rev 1')
    with urllib.request.urlopen(NH_URL + '/api/v1/itens/%s/arquivo/placa' % j['item']) as r:
        g = json.loads(r.read())
    qfp = nh('POST', '/api/v1/chaves/resolver', {'sistema': 'nexoeletric-modelo', 'chaves': ['3d-hub/qfp.step']})['3d-hub/qfp.step']
    confere(g['modelos'] == {'3d-hub/abc.step': {'item': mod['id'], 'rev': 2, 'nome': 'abc.step'},
                             'nexo:' + comp['id']: {'item': comp['id'], 'rev': 1, 'nome': 'SOT-23'},
                             '3d-hub/qfp.step': {'item': qfp['id'], 'rev': 1, 'nome': 'qfp.step'}},
            'placa: modelos {item, rev, nome}, o que faltava foi publicado (%r)' % g['modelos'])
    confere(len(g['componentes'][0]['corpos']) == 1 and len(j['avisos']) == 1, 'placa: corpo sem modelo sai, com aviso')
    confere(pl['atributos']['pacote_sha'] == N.sha_pacote(g), 'placa: pacote_sha = o hash do pacote canonico')
    # o mesmo hash do Node (mcp/lib/nexohub-sync.js): o app e o hub nao se alternam criando revisoes
    amostra = dict(g, n=[1e21, -2.5e-9, 0.000001, 9.99e-7, 123456789.125, 0.1 + 0.2, 3.0], s='açã "q" \\ \t')
    arq_am = os.path.join(tmp, 'amostra.json')
    with open(arq_am, 'w', encoding='utf-8') as f:
        json.dump(amostra, f, ensure_ascii=False)
    sha_node = subprocess.run([NODE, '-e', 'const S=require(process.argv[1]);process.stdout.write(S.shaPacote(JSON.parse(require("fs").readFileSync(process.argv[2],"utf8"))))',
                               os.path.join(RAIZ, 'mcp', 'lib', 'nexohub-sync.js'), arq_am], capture_output=True, text=True).stdout
    confere(sha_node == N.sha_pacote(json.load(open(arq_am, encoding='utf-8'))), 'o hash do pacote e o mesmo no Node e no Python')
    usa = sorted(v['para_item'] for v in pl['vinculos'] if v['relacao'] == 'usa')
    confere(usa == sorted([mod['id'], comp['id'], qfp['id']]), 'placa: vinculos usa')
    pac2 = dict(pac, gerado='2026-10-16T10:00:00Z')
    st, j2 = post('/api/nexo/placa', {'pacote': pac2})
    confere(j2['ok'] and j2['item'] == j['item'] and j2['rev'] == 1 and j2['mudou'] is False, 'placa igual (so o gerado mudou): sem revisao nova')
    pac3 = json.loads(json.dumps(pac))
    pac3['espessura'] = 1.0
    st, j3 = post('/api/nexo/placa', {'pacote': pac3})
    confere(j3['ok'] and j3['rev'] == 2 and j3['mudou'] is True, 'placa mudou: revisao 2')
    st, j = post('/api/nexo/placa', {'pacote': {'format': 'outro'}})
    confere(st == 400, 'placa: formato errado = 400')

    # o NexoCAD nao cria rev nova de modelo pelo hub: o modelo abc continua na rev 2
    confere(nh('GET', '/api/v1/itens/%s' % mod['id'])['rev'] == 2, 'o modelo editado no NexoCAD nao foi tocado')

    # so desta maquina
    app2 = Flask('x')
    N.registra(app2, tmp, lambda req: False)
    cl = app2.test_client()
    r = cl.post('/api/nexo/editar', json={'id': comp['id']})
    confere(r.status_code == 403, 'editar de fora = 403')
    r = cl.post('/api/nexo/placa', json={'pacote': pac})
    confere(r.status_code == 403, 'placa de fora = 403')

    # Nexo Hub fora do ar: a biblioteca responde com a ultima copia e online=False; o placa = 503
    nhp.kill()
    nhp.wait(10)
    confere(espera(lambda: json.loads(get('/api/nexo/revisao')[1])['online'] is False, 10), 'revisao: online=False sem o Nexo Hub')
    st, b = get('/api/nexo/biblioteca?categoria=*')
    j = json.loads(b)
    confere(st == 200 and j['online'] is False and len(j['itens']) >= 3, 'biblioteca fora do ar: a ultima copia')
    st, j = post('/api/nexo/placa', {'pacote': pac3})
    confere(st == 503 and not j['ok'], 'placa sem o Nexo Hub: 503 (%s)' % j.get('error'))
finally:
    srv.shutdown()
    nx.shutdown()
    if nhp.poll() is None:
        nhp.kill()
    shutil.rmtree(tmp, ignore_errors=True)

print()
print('%d falha(s)' % len(falhas) if falhas else 'tudo certo')
sys.exit(1 if falhas else 0)
