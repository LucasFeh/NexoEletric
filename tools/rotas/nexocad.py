# -*- coding: utf-8 -*-
"""Rotas /api/nexo/*: o hub conversa com o NexoCAD e le a biblioteca do Nexo Hub.

Desde a 1.9.0 a biblioteca compartilhada e o NEXO HUB, o banco da rede "Nexo Hub" (contrato:
..\\nexohub\\docs\\CONTRATO.md; o lado do NexoEletric em docs/INTEGRACAO-NEXOCAD.md). Ninguem abre o
banco direto: tudo pela API HTTP v1. A URL: NEXOHUB_URL (e NEXOHUB_TOKEN) > o
C:\\Users\\Public\\NexoHub\\conexao.json ({url, token}) > http://127.0.0.1:47800.

- A biblioteca 3D do NexoEletric (Libs/pcblib-hub.js, a PcbLib 3D) e as placas sao publicadas no
  Nexo Hub pelo sincronizador (mcp/lib/nexohub-sync.js, que o app desktop roda). Estas rotas LEEM
  do Nexo Hub e mostram ao hub no formato que o hub-nexo.js sempre leu.
- Para editar um modelo ou montar a placa o hub PEDE ao NexoCAD: POST /rpc na porta do
  %USERPROFILE%\\.nexocad\\session.json, com o token dele. App fechado: o hub abre o exe e espera
  o session.json e o GET /health ate 60 s.

Rotas:
  GET  /api/nexo/estado                       {ok, nexohub:{url, online, versao}, revisao, itens, nexocad:{aberto, versao, exe}}
  GET  /api/nexo/revisao                      {revisao, online} (barata: o seq do ultimo evento do Nexo Hub,
                                              que uma thread acompanha pelo SSE /api/v1/eventos; sem SSE, polling)
  GET  /api/nexo/biblioteca?categoria=&texto= os itens no formato do hub-nexo.js (padrao: Eletronicos; categoria=* = todas)
  GET  /api/nexo/arquivo/<id>/<papel>[?rev=N] o arquivo do item (step|thumb|nexo|origem|placa; modelo.step e
                                              thumb.png tambem valem), repassado do Nexo Hub com cache por sha em %TEMP%
  POST /api/nexo/editar   {chave, url, nome, footprint, geometria?} | {id} | {novo:true, footprint, nome, chave?, geometria?}
  POST /api/nexo/placa    {pacote}  (eletrichub-placa-v1): publica o item placa no Nexo Hub e pede ao NexoCAD
                                    pcb_importar {item}
Os POST so aceitam pedidos desta maquina.

O mapeamento item do Nexo Hub -> item do hub-nexo.js:
  substitui = as chaves nexoeletric-modelo do item, SO quando rev > 1 (editado no NexoCAD);
  eletronico.footprints = atributos.footprints, SO para itens `componente`;
  arquivos.step presente = o item tem STEP para desenhar.

A `url` do STEP (e as dos modelos do pacote) e um caminho do PROPRIO hub (/Libs/3d-hub/...,
/Libs/3d/..., /Projects/<p>/..., /api/nexo/arquivo/...): o servidor baixa de si mesmo, pela porta
em que atende.

Para os testes: NEXOCAD_SESSION troca o caminho do session.json; NEXOCAD_NAO_ABRIR=1 nunca abre o
exe; NEXOHUB_URL / NEXOHUB_CONEXAO apontam um Nexo Hub de teste.

No hubserver.py (o molde dos outros registraveis):

    sys.path.insert(0, os.path.join(ROOT, 'tools', 'rotas'))
    import nexocad
    nexocad.registra(app, ROOT, _is_local)
"""
import hashlib
import json
import os
import re
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from flask import Response, abort, request, send_file

CONEXAO = r'C:\Users\Public\NexoHub\conexao.json'
PADRAO_URL = 'http://127.0.0.1:47800'
APP = 'nexoeletric'
SIS_MODELO = 'nexoeletric-modelo'
SIS_PLACA = 'nexoeletric-placa'
CAT_MODELOS = 'eletronicos/modelos-3d'
CAT_PLACAS = 'placas'
CATEGORIA_PADRAO = 'Eletrônicos'
PAPEIS = {'modelo.step': 'step', 'thumb.png': 'thumb', 'modelo.nexo': 'nexo', 'origem.step': 'origem', 'placa.json': 'placa',
          'step': 'step', 'thumb': 'thumb', 'nexo': 'nexo', 'origem': 'origem', 'placa': 'placa'}
MIME = {'step': 'application/step', 'origem': 'application/step', 'thumb': 'image/png', 'placa': 'application/json',
        'nexo': 'application/octet-stream'}
ID_OK = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')
SHA_OK = re.compile(r'^[0-9a-f]{64}$')
ESPERA_ABRIR = 60.0          # s: o NexoCAD abrindo do zero
T_HEALTH = 1.5               # s
T_RPC = 300.0                # s: importar um STEP grande / montar a placa
T_BAIXA = 300.0              # s: o 3D da PcbLib sai da PcbLib na primeira vez
T_NH = 15.0                  # s: um pedido comum ao Nexo Hub
MAX_PACOTE = 64 * 1024 * 1024
MAX_MODELOS = 2000
LOCAL = ('127.0.0.1', '::1', 'localhost')


class ErroNexo(Exception):
    def __init__(self, msg, status=502):
        Exception.__init__(self, msg)
        self.status = status


# ─────────────────────────── o Nexo Hub (cliente HTTP) ───────────────────────────
def conexao():
    """{url, token}: variavel > conexao.json > padrao (contrato §1)."""
    url, token = '', ''
    try:
        with open(os.environ.get('NEXOHUB_CONEXAO') or CONEXAO, 'r', encoding='utf-8-sig') as f:
            j = json.load(f)
        if isinstance(j, dict):
            url = str(j.get('url') or '').strip()
            token = str(j.get('token') or '').strip()
    except (OSError, ValueError):
        pass
    if os.environ.get('NEXOHUB_URL'):
        url = os.environ['NEXOHUB_URL'].strip()
    if os.environ.get('NEXOHUB_TOKEN'):
        token = os.environ['NEXOHUB_TOKEN'].strip()
    return {'url': (url or PADRAO_URL).rstrip('/'), 'token': token}


def _req_nh(metodo, caminho, corpo=None, cab=None, timeout=T_NH):
    c = conexao()
    h = dict(cab or {})
    h.setdefault('X-App', APP)
    if c['token']:
        h['Authorization'] = 'Bearer %s' % c['token']
    dados = None
    if corpo is not None:
        if isinstance(corpo, (bytes, bytearray)):
            dados = bytes(corpo)
            h.setdefault('Content-Type', 'application/octet-stream')
        else:
            dados = json.dumps(corpo, ensure_ascii=False).encode('utf-8')
            h['Content-Type'] = 'application/json'
    return urllib.request.Request(c['url'] + caminho, data=dados, method=metodo, headers=h), c


def nh(metodo, caminho, corpo=None, cab=None, timeout=T_NH):
    """Pedido JSON ao Nexo Hub. Erro vira ErroNexo (503 se ele esta fora)."""
    req, c = _req_nh(metodo, caminho, corpo, cab, timeout)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        try:
            j = json.loads(e.read().decode('utf-8', 'replace'))
            msg = j.get('erro') or j.get('error') or str(e)
        except (ValueError, AttributeError, OSError):
            msg = str(e)
        err = ErroNexo('Nexo Hub: %s' % msg, e.code if e.code in (400, 404, 409, 422) else 502)
        err.http = e.code
        raise err
    except (OSError, urllib.error.URLError) as e:
        err = ErroNexo('o Nexo Hub (%s) não respondeu: %s' % (c['url'], getattr(e, 'reason', e)), 503)
        err.http = 0
        raise err
    try:
        return json.loads(txt) if txt.strip() else {}
    except ValueError:
        raise ErroNexo('Nexo Hub: resposta que não é JSON em %s' % caminho, 502)


def _q(s):
    return urllib.parse.quote(str(s), safe='')


def nh_item(item_id):
    j = nh('GET', '/api/v1/itens/%s' % _q(item_id))
    return j.get('item') if isinstance(j.get('item'), dict) else j


def nh_todos(params=None):
    """Todas as paginas de GET /itens. (itens, revisao)"""
    out, rev = [], 0
    for pagina in range(1, 1000):
        p = dict(params or {})
        p.update({'limite': 200, 'pagina': pagina})
        j = nh('GET', '/api/v1/itens?' + urllib.parse.urlencode(p))
        L = j.get('itens') or []
        rev = j.get('revisao') or rev
        out.extend(L)
        if not L or len(L) < 200 or len(out) >= (j.get('total') or 0):
            break
    return out, rev


def nh_categorias():
    j = nh('GET', '/api/v1/categorias')
    return j if isinstance(j, list) else (j.get('categorias') or [])


def nh_resolver(sistema, chaves):
    out = {}
    L = [str(c) for c in dict.fromkeys(c for c in (chaves or []) if c)]
    for i in range(0, len(L), 500):
        j = nh('POST', '/api/v1/chaves/resolver', {'sistema': sistema, 'chaves': L[i:i + 500]})
        m = j.get('resultado') if isinstance(j.get('resultado'), dict) else j
        for k, v in (m or {}).items():
            if isinstance(v, dict) and v.get('id'):
                out[k] = v
    return out


def nh_sobe_blob(dados, nome=''):
    return nh('POST', '/api/v1/blobs', dados, {'Content-Type': 'application/octet-stream', 'X-Nome': urllib.parse.quote(nome or '')},
              timeout=T_BAIXA)


def nh_cria(d):
    dd = dict(d)
    dd.setdefault('app', APP)
    j = nh('POST', '/api/v1/itens', dd)
    it = j.get('item') if isinstance(j.get('item'), dict) else j
    if 'existente' in j and 'existente' not in it:
        it['existente'] = j['existente']
    return it


def nh_revisao(item_id, d):
    dd = dict(d)
    dd.setdefault('app', APP)
    return nh('POST', '/api/v1/itens/%s/revisoes' % _q(item_id), dd)


def nh_vincula(d):
    try:
        return nh('POST', '/api/v1/vinculos', d)
    except ErroNexo as e:
        if getattr(e, 'http', 0) == 409:
            return {'existente': True}
        raise


def _rev(it):
    try:
        return int(it.get('rev') if it.get('rev') is not None else it.get('rev_atual') or 0)
    except (TypeError, ValueError):
        return 0


# ─────────────────────────── a revisao (SSE, com polling de reserva) ───────────────────────────
class Seguidor(object):
    """Acompanha o `seq` do ultimo evento do Nexo Hub. Uma thread so, iniciada no 1o pedido."""

    def __init__(self):
        self.seq = 0
        self.online = False
        self.versao = ''
        self.url = ''
        self.erro = ''
        self.modo = ''
        self._t = None
        self._trava = threading.Lock()
        self._mudou = threading.Event()

    def garante(self):
        with self._trava:
            if self._t and self._t.is_alive():
                return
            self._t = threading.Thread(target=self._roda, name='nexohub-sse', daemon=True)
            self._t.start()

    def _saude(self):
        j = nh('GET', '/api/v1/saude', timeout=3)
        self.versao = str(j.get('versao') or '')
        self.online = True
        self.erro = ''
        r = j.get('revisao')
        if isinstance(r, int) and r >= 0:
            self._poe(r)

    def _poe(self, seq):
        if seq != self.seq:
            self.seq = seq
            self._mudou.set()

    def _sse(self):
        req, c = _req_nh('GET', '/api/v1/eventos?desde=%d' % self.seq, cab={'Accept': 'text/event-stream',
                                                                             'Last-Event-ID': str(self.seq)})
        self.url = c['url']
        # keep-alive a cada 15 s (contrato): 40 s sem nada = conexao morta
        with urllib.request.urlopen(req, timeout=40) as r:
            self.modo = 'sse'
            self.online = True
            resto = b''
            while True:
                # read1: o que chegou (um pedaco do chunked), sem esperar o buffer encher
                bloco = r.read1(65536)
                if not bloco:
                    return
                resto += bloco
                linhas = resto.split(b'\n')
                resto = linhas.pop()
                for linha in linhas:
                    linha = linha.decode('utf-8', 'replace').rstrip('\r')
                    if linha.startswith('id:'):
                        try:
                            self._poe(int(linha[3:].strip()))
                        except ValueError:
                            pass
                if conexao()['url'] != self.url:       # a conexao mudou de servidor: refaz
                    return

    def _polling(self, ate):
        self.modo = 'polling'
        while time.time() < ate:
            j = nh('GET', '/api/v1/eventos?formato=json&desde=%d' % self.seq, timeout=5)
            r = j.get('revisao')
            if isinstance(r, int):
                self._poe(r)
            self.online = True
            time.sleep(2.0)

    def _roda(self):
        espera = 1.0
        while True:
            try:
                self._saude()
                espera = 1.0
                try:
                    self._sse()
                except (OSError, urllib.error.URLError, ValueError) as e:
                    # SSE recusado (proxy, servidor velho): polling por 30 s e tenta de novo
                    self.erro = 'SSE: %s' % e
                    self._polling(time.time() + 30)
            except ErroNexo as e:
                self.online = False
                self.erro = str(e)
                time.sleep(espera)
                espera = min(espera * 2, 15.0)
            except Exception as e:      # noqa: BLE001 -- a thread nunca morre calada
                self.online = False
                self.erro = 'seguidor: %s' % e
                time.sleep(5.0)


SEGUIDOR = Seguidor()


# ─────────────────────────── itens do Nexo Hub -> o formato do hub-nexo.js ───────────────────────────
def _cats_por_id(cats):
    out = {}

    def anda(L):
        for c in L or []:
            if isinstance(c, dict) and c.get('id'):
                out[c['id']] = c
                anda(c.get('filhos') or c.get('subcategorias') or c.get('filhas'))
    anda(cats)
    return out


def para_item(it, porid):
    cat_id = str(it.get('categoria') or it.get('categoria_id') or 'outros')
    raiz_id = cat_id.split('/')[0]
    raiz = porid.get(raiz_id)
    sub = porid.get(cat_id) if '/' in cat_id else None
    at = it.get('atributos') if isinstance(it.get('atributos'), dict) else {}
    ar = it.get('arquivos') if isinstance(it.get('arquivos'), dict) else {}
    rev = _rev(it)
    modelo = [str(c.get('chave')) for c in (it.get('chaves') or []) if isinstance(c, dict) and c.get('sistema') == SIS_MODELO]
    o = {'id': it.get('id'), 'nome': it.get('nome') or it.get('id'), 'tipo': it.get('tipo') or '',
         'categoria': raiz.get('nome') if raiz else raiz_id, 'categoria_id': cat_id,
         'subcategoria': sub.get('nome') if sub else '', 'descricao': it.get('descricao') or '',
         'tags': it.get('tags') if isinstance(it.get('tags'), list) else [], 'rev': rev,
         'atualizado': it.get('atualizado_em') or '', 'bbox': it.get('bbox'),
         'arquivos': dict((p, p) for p in ('step', 'nexo', 'thumb', 'origem', 'placa') if ar.get(p)),
         'substitui': modelo if rev > 1 else [], 'chaves': modelo}
    th = ar.get('thumb')
    if isinstance(th, dict) and th.get('sha256'):
        o['thumb_v'] = str(th['sha256'])[:12]   # versao da miniatura na URL (o navegador nao guarda a velha)
    if it.get('tipo') == 'componente':
        o['eletronico'] = {'footprints': [str(f) for f in (at.get('footprints') or [])], 'mpn': at.get('mpn') or '',
                           'fabricante': at.get('fabricante') or '', 'encapsulamento': at.get('encapsulamento') or ''}
    elif isinstance(at.get('footprints'), list):
        o['modelo'] = {'footprints': [str(f) for f in at['footprints']], 'origem': at.get('origem') or ''}
    return o


_cache = {'chave': None, 'quando': 0.0, 'indice': None, 'shas': {}}
_cache_lock = threading.Lock()


def indice(forca=False):
    """O indice inteiro (todas as categorias), relido quando a revisao do Nexo Hub muda.
    Fora do ar: a ultima copia boa, com online=False."""
    SEGUIDOR.garante()
    url = conexao()['url']
    chave = (url, SEGUIDOR.seq)
    with _cache_lock:
        c = dict(_cache)
    agora = time.time()
    fresco = c['indice'] is not None and c['chave'] == chave
    if not forca and fresco and SEGUIDOR.online and (SEGUIDOR.seq or agora - c['quando'] < 5):
        return c['indice']
    if not forca and fresco and not SEGUIDOR.online and agora - c['quando'] < 5:
        ind = dict(c['indice'])
        ind['online'] = False
        ind['erro'] = SEGUIDOR.erro
        return ind
    try:
        itens, rev = nh_todos()
        try:
            cats = nh_categorias()
        except ErroNexo:
            cats = []
    except ErroNexo as e:
        if c['indice'] is not None and c['chave'] and c['chave'][0] == url:
            ind = dict(c['indice'])
            ind['online'] = False
            ind['erro'] = str(e)
            return ind
        return {'revisao': 0, 'online': False, 'erro': str(e), 'categorias': [], 'itens': [], 'url': url}
    porid = _cats_por_id(cats)
    raizes = sorted([x for x in porid.values() if not x.get('pai_id') and '/' not in str(x.get('id'))],
                    key=lambda x: x.get('ordem') or 0)
    shas = {}
    for it in itens:
        ar = it.get('arquivos') if isinstance(it.get('arquivos'), dict) else {}
        shas[it.get('id')] = dict((p, (a or {}).get('sha256')) for p, a in ar.items() if isinstance(a, dict))
    rev_atual = SEGUIDOR.seq if SEGUIDOR.online else (rev or 0)
    ind = {'revisao': rev_atual, 'online': True, 'url': url, 'categorias': [x.get('nome') for x in raizes],
           'itens': [para_item(i, porid) for i in itens if isinstance(i, dict) and i.get('id')]}
    with _cache_lock:
        _cache.update({'chave': chave, 'quando': agora, 'indice': ind, 'shas': shas})
    return ind


def _sem_acento(s):
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', str(s or '')) if unicodedata.category(c) != 'Mn').lower()


def filtra(ind, categoria=None, texto=None):
    itens = list((ind or {}).get('itens') or [])
    if categoria is None or categoria == '':
        categoria = CATEGORIA_PADRAO
    if categoria not in ('*', 'todas', 'Todas'):
        c = _sem_acento(categoria)
        itens = [i for i in itens if _sem_acento(i.get('categoria')) == c or _sem_acento(i.get('categoria_id')).startswith(c)]
    if texto:
        t = _sem_acento(texto)

        def casa(i):
            el = i.get('eletronico') or i.get('modelo') or {}
            campos = [i.get('id'), i.get('nome'), i.get('descricao'), i.get('subcategoria'),
                      ' '.join(i.get('tags') or []), ' '.join(el.get('footprints') or []), ' '.join(i.get('chaves') or []),
                      el.get('mpn'), el.get('fabricante'), el.get('encapsulamento')]
            return any(t in _sem_acento(x) for x in campos if x)
        itens = [i for i in itens if casa(i)]
    return itens


# ─────────────────────────── arquivos (cache por sha) ───────────────────────────
def pasta_cache():
    d = os.environ.get('NEXOHUB_CACHE') or os.path.join(tempfile.gettempdir(), 'nexoeletric-nexohub')
    os.makedirs(d, exist_ok=True)
    return d


def _no_cache(sha):
    return os.path.join(pasta_cache(), sha[:2], sha)


def sha_do_arquivo(item_id, papel):
    with _cache_lock:
        return (_cache['shas'].get(item_id) or {}).get(papel)


def resposta_arquivo(item_id, papel, rev=None):
    """Response com o blob (do cache local se o sha ja passou por aqui)."""
    sha = None if rev else sha_do_arquivo(item_id, papel)
    tipo = MIME.get(papel, 'application/octet-stream')
    if sha and SHA_OK.match(sha) and os.path.isfile(_no_cache(sha)):
        r = send_file(_no_cache(sha), mimetype=tipo, conditional=False, max_age=0)
        r.headers['ETag'] = '"%s"' % sha
        return r
    caminho = ('/api/v1/blobs/%s' % sha) if sha and SHA_OK.match(sha) else \
        ('/api/v1/itens/%s/arquivo/%s%s' % (_q(item_id), _q(papel), ('?rev=%d' % int(rev)) if rev else ''))
    req, c = _req_nh('GET', caminho)
    try:
        r = urllib.request.urlopen(req, timeout=T_BAIXA)
    except urllib.error.HTTPError as e:
        abort(404 if e.code == 404 else 502)
    except (OSError, urllib.error.URLError):
        abort(503)
    etag = (r.headers.get('ETag') or '').strip('"W/ ')
    sha_r = etag if SHA_OK.match(etag or '') else sha

    def gera():
        tmp = None
        f = None
        h = hashlib.sha256()
        try:
            if sha_r:
                os.makedirs(os.path.dirname(_no_cache(sha_r)), exist_ok=True)
                tmp = _no_cache(sha_r) + '.%d.tmp' % threading.get_ident()
                f = open(tmp, 'wb')
            while True:
                bloco = r.read(256 * 1024)
                if not bloco:
                    break
                h.update(bloco)
                if f:
                    f.write(bloco)
                yield bloco
            if f:
                f.close()
                f = None
                if h.hexdigest() == sha_r:
                    os.replace(tmp, _no_cache(sha_r))
                    tmp = None
        finally:
            if f:
                f.close()
            if tmp and os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass
            r.close()
    resp = Response(gera(), mimetype=tipo, direct_passthrough=True)
    if r.headers.get('Content-Length'):
        resp.headers['Content-Length'] = r.headers['Content-Length']
    if sha_r:
        resp.headers['ETag'] = '"%s"' % sha_r
    resp.headers['Cache-Control'] = 'no-cache'
    return resp


# ─────────────────────────── o NexoCAD (cliente do /rpc) ───────────────────────────
def caminho_sessao():
    env = os.environ.get('NEXOCAD_SESSION')
    if env:
        return env
    return os.path.join(os.path.expanduser('~'), '.nexocad', 'session.json')


def le_sessao():
    try:
        with open(caminho_sessao(), 'r', encoding='utf-8-sig') as f:
            s = json.load(f)
        if isinstance(s, dict) and int(s.get('port') or 0) > 0 and s.get('token'):
            return s
    except (OSError, ValueError, TypeError):
        pass
    return None


def acha_exe():
    """Contrato §2: Program Files, depois %LOCALAPPDATA%\\Programs, depois NEXOCAD_EXE."""
    if os.environ.get('NEXOCAD_NAO_ABRIR') == '1':      # testes: nunca o exe instalado na maquina
        return ''
    cands = [r'C:\Program Files\NexoCAD\NexoCAD.exe']
    la = os.environ.get('LOCALAPPDATA')
    if la:
        cands.append(os.path.join(la, 'Programs', 'NexoCAD', 'NexoCAD.exe'))
    if os.environ.get('NEXOCAD_EXE'):
        cands.append(os.environ['NEXOCAD_EXE'])
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return ''


def _pede(s, metodo, caminho, corpo=None, timeout=T_HEALTH):
    url = 'http://127.0.0.1:%d%s' % (int(s['port']), caminho)
    dados = None if corpo is None else json.dumps(corpo).encode('utf-8')
    req = urllib.request.Request(url, data=dados, method=metodo, headers={
        'Authorization': 'Bearer %s' % s['token'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        txt = r.read().decode('utf-8', 'replace')
    try:
        return json.loads(txt) if txt.strip() else {}
    except ValueError:
        return {'texto': txt}


def saude(s=None):
    """{'aberto', 'versao', 'sessao'}: o NexoCAD responde o /health com o token?"""
    s = s or le_sessao()
    if not s:
        return {'aberto': False, 'versao': '', 'sessao': None}
    try:
        h = _pede(s, 'GET', '/health')
        v = ''
        if isinstance(h, dict):
            v = h.get('versao') or h.get('version') or ''
        return {'aberto': True, 'versao': str(v), 'sessao': s}
    except (OSError, urllib.error.URLError, ValueError):
        return {'aberto': False, 'versao': '', 'sessao': None}


_abrindo = threading.Lock()


def garante_aberto(espera=ESPERA_ABRIR):
    """A sessao de um NexoCAD que responde; abre o exe se precisar."""
    h = saude()
    if h['aberto']:
        return h['sessao']
    with _abrindo:                      # dois pedidos juntos nao abrem dois NexoCAD
        h = saude()
        if h['aberto']:
            return h['sessao']
        exe = acha_exe()
        if not exe:
            raise ErroNexo('o NexoCAD não está aberto e o executável não foi encontrado '
                           '(C:\\Program Files\\NexoCAD\\NexoCAD.exe, %LOCALAPPDATA%\\Programs\\NexoCAD ou NEXOCAD_EXE)', 503)
        flags = 0
        if os.name == 'nt':
            flags = getattr(subprocess, 'DETACHED_PROCESS', 0x8) | getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0x200)
        try:
            subprocess.Popen([exe], cwd=os.path.dirname(exe), creationflags=flags, close_fds=True,
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as e:
            raise ErroNexo('não consegui abrir o NexoCAD (%s)' % e, 503)
        fim = time.time() + espera
        while time.time() < fim:
            time.sleep(0.5)
            h = saude()
            if h['aberto']:
                return h['sessao']
        raise ErroNexo('o NexoCAD não respondeu em %d s' % espera, 504)


def rpc(comando, params, timeout=T_RPC):
    """Chama o NexoCAD (abrindo se precisar). Devolve o `result`; erro dele vira ErroNexo."""
    s = garante_aberto()
    try:
        r = _pede(s, 'POST', '/rpc', {'command': comando, 'params': params or {}, 'source': 'eletrichub'}, timeout)
    except urllib.error.HTTPError as e:
        try:
            j = json.loads(e.read().decode('utf-8', 'replace'))
            msg = j.get('error') or j.get('erro') or str(e)
        except (ValueError, AttributeError, OSError):
            msg = str(e)
        raise ErroNexo('NexoCAD: %s' % msg, 502)
    except (OSError, urllib.error.URLError) as e:
        raise ErroNexo('NexoCAD não respondeu (%s)' % e, 502)
    if not isinstance(r, dict) or not r.get('ok'):
        msg = (r or {}).get('error') if isinstance(r, dict) else None
        if isinstance(msg, dict):
            msg = msg.get('message') or json.dumps(msg, ensure_ascii=False)
        raise ErroNexo('NexoCAD: %s' % (msg or 'resposta sem ok'), 502)
    return r.get('result')


# ─────────────────────────── baixar do proprio hub ───────────────────────────
def pasta_temp():
    d = os.path.join(tempfile.gettempdir(), 'eletrichub-nexo')
    os.makedirs(d, exist_ok=True)
    return d


def nome_seguro(s, padrao='modelo'):
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', '_', str(s or '')).strip(' .')
    return (s or padrao)[:80]


def caminho_do_hub(url):
    """So caminho do proprio hub: '/Libs/...', 'Libs/...' ou http://127.0.0.1:<p>/... -> '/Libs/...'."""
    if not isinstance(url, str) or not url.strip():
        return None
    u = url.strip()
    p = urllib.parse.urlsplit(u)
    if p.scheme or p.netloc:
        if p.scheme not in ('http', 'https') or (p.hostname or '') not in LOCAL:
            return None
        u = p.path + (('?' + p.query) if p.query else '')
    if u.startswith('//'):
        return None
    if not u.startswith('/'):
        u = '/' + u
    if '..' in urllib.parse.unquote(u).replace('\\', '/').split('/'):
        return None
    return u


def baixa_de_si(porta, url, destino=None):
    """GET http://127.0.0.1:<porta><url> (precisa ser STEP). Grava em destino (se veio) e devolve os bytes."""
    cam = caminho_do_hub(url)
    if not cam:
        raise ErroNexo('url do STEP invalida (tem de ser um caminho do hub, ex.: /Libs/3d-hub/<id>.step): %r' % url, 400)
    # o caminho chega como a pagina o usou (ja codificado ou nao): quote idempotente
    cam = urllib.parse.quote(urllib.parse.unquote(cam), safe="/?&=%:@!$'()*+,;~-._")
    req = urllib.request.Request('http://127.0.0.1:%s%s' % (porta, cam))
    try:
        with urllib.request.urlopen(req, timeout=T_BAIXA) as r:
            dados = r.read()
    except urllib.error.HTTPError as e:
        raise ErroNexo('o hub não serviu %s (HTTP %d)' % (cam, e.code), 404 if e.code == 404 else 502)
    except (OSError, urllib.error.URLError) as e:
        raise ErroNexo('não consegui baixar %s do hub (%s)' % (cam, e), 502)
    if b'ISO-10303-21' not in dados[:256]:
        raise ErroNexo('%s não é um STEP (não começa com ISO-10303-21)' % cam, 422)
    if destino:
        tmp = destino + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(dados)
        os.replace(tmp, destino)
    return dados


def porta_atual():
    return request.environ.get('SERVER_PORT') or str(request.host.rsplit(':', 1)[-1] if ':' in request.host else '80')


# ─────────────────────────── publicar no Nexo Hub (o mesmo do mcp/lib/nexohub-sync.js) ───────────────────────────
def _origem_da_chave(k):
    if k.startswith('projeto:'):
        return 'projeto'
    if k.startswith('3d-hub/'):
        return 'pcblib-hub'
    if k.startswith('3d/'):
        return 'pcblib-3d'
    return 'nexoeletric'


def garante_modelo(chave, nome, footprints, ler, nota=None):
    """O item modelo3d da chave (cria e sobe a revisao 1 se faltar). (id, rev, criado). Nunca cria rev 2+."""
    r = nh_resolver(SIS_MODELO, [chave]).get(chave)
    criado = False
    if not r:
        fps = sorted(set(str(f) for f in footprints or [] if f))
        it = nh_cria({'tipo': 'modelo3d', 'categoria': CAT_MODELOS,
                      'nome': re.sub(r'\.(step|stp)$', '', nome or chave.split('/')[-1], flags=re.I) or chave,
                      'descricao': ('Corpo 3D de ' + ', '.join(fps)) if fps else '',
                      'tags': ['step', _origem_da_chave(chave)],
                      'atributos': {'footprints': fps, 'origem': _origem_da_chave(chave), 'arquivo': nome or ''},
                      'chaves': [{'sistema': SIS_MODELO, 'chave': chave}],
                      'vinculos': [{'relacao': 'footprint', 'para_ref': f} for f in fps]})
        r = {'id': it.get('id'), 'rev': _rev(it)}
        criado = not it.get('existente')
    if int(r.get('rev') or 0) >= 1:
        return r['id'], int(r['rev']), criado
    dados = ler()
    b = nh_sobe_blob(dados, nome or chave.split('/')[-1])
    try:
        j = nh_revisao(r['id'], {'arquivos': {'step': {'sha256': b['sha256'], 'nome': nome or ''}, 'origem': {'sha256': b['sha256'], 'nome': nome or ''}}, 'base': 0,
                                 'nota': nota or 'importado do NexoEletric'})
        return r['id'], int(j.get('numero') or 1), criado
    except ErroNexo as e:
        if getattr(e, 'http', 0) == 409:
            x = nh_resolver(SIS_MODELO, [chave]).get(chave) or {}
            return r['id'], int(x.get('rev') or 1), criado
        raise


def _num_js(x):
    """O numero como o JSON.stringify do JavaScript o escreve (o hash tem de bater com o do Node)."""
    if isinstance(x, bool):
        return 'true' if x else 'false'
    if isinstance(x, int):
        return str(x)
    if x != x or x in (float('inf'), float('-inf')):
        return 'null'
    if x == 0:
        return '0'
    if x == int(x) and abs(x) < 1e21:
        return str(int(x))
    import decimal
    r = repr(x)
    d = decimal.Decimal(r)
    e = d.adjusted()
    if -7 < e < 21:
        s = format(d, 'f')
        return s.rstrip('0').rstrip('.') if '.' in s else s
    m = r.split('e')[0] if 'e' in r else format(d.scaleb(-e), 'f')
    if '.' in m:
        m = m.rstrip('0').rstrip('.')
    return '%se%s%d' % (m, '+' if e > 0 else '-', abs(e))


def canonico(v):
    """O JSON canonico do mcp/lib/nexohub-sync.js » canonico: chaves em ordem, sem espaco, numeros do JS."""
    if isinstance(v, dict):
        return '{' + ','.join(json.dumps(str(k), ensure_ascii=False) + ':' + canonico(v[k]) for k in sorted(v, key=str)) + '}'
    if isinstance(v, (list, tuple)):
        return '[' + ','.join(canonico(x) for x in v) + ']'
    if isinstance(v, (int, float)):
        return _num_js(v)
    if v is None:
        return 'null'
    return json.dumps(v, ensure_ascii=False)


def sha_pacote(pacote):
    p = dict(pacote)
    p.pop('gerado', None)
    return hashlib.sha256(canonico(p).encode('utf-8')).hexdigest()


def _id_da_chave(k, m):
    a = re.match(r'^nexo:([^@]+)', str(k or ''))
    if a:
        return a.group(1)
    b = re.search(r'/api/nexo/arquivo/([^/?]+)/', str((m or {}).get('url') or ''))
    return urllib.parse.unquote(b.group(1)) if b else None


def publica_pacote(pacote, porta):
    """O pacote (com `url` em cada modelo) -> modelos {item, rev, nome} -> o item placa no Nexo Hub.
    Devolve {item, rev, mudou, avisos}."""
    if not isinstance(pacote, dict) or pacote.get('format') != 'eletrichub-placa-v1':
        raise ErroNexo('pacote invalido: falta format "eletrichub-placa-v1"', 400)
    projeto = str(pacote.get('projeto') or '').strip()
    if not projeto:
        raise ErroNexo('pacote sem "projeto"', 400)
    pac = json.loads(json.dumps(pacote))
    modelos = pac.get('modelos') if isinstance(pac.get('modelos'), dict) else {}
    if len(modelos) > MAX_MODELOS:
        raise ErroNexo('modelos demais no pacote (%d)' % len(modelos), 400)
    avisos = []
    por_chave = nh_resolver(SIS_MODELO, [k for k in modelos if not _id_da_chave(k, modelos[k])])
    saida, falhos, revs = {}, set(), {}
    for k, m in modelos.items():
        m = m if isinstance(m, dict) else {}
        ref = None
        try:
            iid = _id_da_chave(k, m)
            if iid:
                if iid not in revs:
                    revs[iid] = _rev(nh_item(iid))
                ref = (iid, revs[iid])
            elif por_chave.get(k) and int(por_chave[k].get('rev') or 0) >= 1:
                ref = (por_chave[k]['id'], int(por_chave[k]['rev']))
            elif m.get('url'):
                fps = sorted(set(c.get('footprint') for c in pac.get('componentes') or []
                                 if isinstance(c, dict) and c.get('footprint')
                                 and any(isinstance(b, dict) and b.get('modelo') == k for b in c.get('corpos') or [])))
                iid, rev, _c = garante_modelo(k, m.get('nome') or '', fps, lambda u=m['url']: baixa_de_si(porta, u),
                                              'importado do NexoEletric (%s, placa %s)' % (_origem_da_chave(k), projeto))
                ref = (iid, rev)
        except ErroNexo as e:
            avisos.append('%s: %s' % (k, e))
            if e.status == 503:
                raise
            ref = None
        if not ref or ref[1] < 1:
            if not any(a.startswith(k + ':') for a in avisos):
                avisos.append('%s: o modelo não está no Nexo Hub' % k)
            falhos.add(k)
            continue
        saida[k] = {'item': ref[0], 'rev': ref[1], 'nome': m.get('nome') or k.split('/')[-1]}
    pac['modelos'] = saida
    if falhos:
        for c in pac.get('componentes') or []:
            if isinstance(c, dict) and isinstance(c.get('corpos'), list):
                c['corpos'] = [b for b in c['corpos'] if not (isinstance(b, dict) and b.get('tipo') == 'step' and b.get('modelo') in falhos)]
    sha = sha_pacote(pac)
    r = nh_resolver(SIS_PLACA, [projeto]).get(projeto)
    if not r:
        it = nh_cria({'tipo': 'placa', 'categoria': CAT_PLACAS, 'nome': projeto, 'descricao': 'Placa do NexoEletric',
                      'tags': ['pcb'], 'atributos': {'projeto': projeto},
                      'chaves': [{'sistema': SIS_PLACA, 'chave': projeto}]})
    else:
        it = nh_item(r['id'])
    rev_atual = _rev(it)
    if rev_atual >= 1 and (it.get('atributos') or {}).get('pacote_sha') == sha:
        return {'item': it['id'], 'rev': rev_atual, 'mudou': False, 'avisos': avisos}
    b = nh_sobe_blob(json.dumps(pac, ensure_ascii=False, indent=1).encode('utf-8'), 'placa.json')
    try:
        j = nh_revisao(it['id'], {'arquivos': {'placa': {'sha256': b['sha256'], 'nome': 'placa.json'}}, 'base': rev_atual, 'nota': 'placa do NexoEletric'})
    except ErroNexo as e:
        if getattr(e, 'http', 0) != 409:
            raise
        j = nh_revisao(it['id'], {'arquivos': {'placa': {'sha256': b['sha256'], 'nome': 'placa.json'}}, 'base': _rev(nh_item(it['id'])), 'nota': 'placa do NexoEletric'})
    nh('PATCH', '/api/v1/itens/%s' % _q(it['id']), {'atributos': {'projeto': projeto, 'pacote_sha': sha,
                                                                 'componentes': len(pac.get('componentes') or []),
                                                                 'modelos': len(saida)}})
    for iid in sorted(set(m['item'] for m in saida.values())):
        try:
            nh_vincula({'de_item': it['id'], 'relacao': 'usa', 'para_item': iid})
        except ErroNexo as e:
            avisos.append('vínculo %s: %s' % (iid, e))
    return {'item': it['id'], 'rev': int(j.get('numero') or rev_atual + 1), 'mudou': True, 'avisos': avisos}


# ─────────────────────────── rotas ───────────────────────────
def _json(obj, status=200):
    return Response(json.dumps(obj, ensure_ascii=False), status=status, mimetype='application/json')


def _local_padrao(req):
    return req.remote_addr in LOCAL


def registra(app, root, eh_local=None):
    eh_local = eh_local or _local_padrao

    @app.route('/api/nexo/estado')
    def nexo_estado():
        ind = indice()
        h = saude()
        c = conexao()
        return _json({'ok': True, 'dir': c['url'], 'existe': bool(ind.get('online')), 'indice': bool(ind.get('online')),
                      'nexohub': {'url': c['url'], 'online': bool(ind.get('online')), 'versao': SEGUIDOR.versao,
                                  'modo': SEGUIDOR.modo, 'erro': ind.get('erro') or SEGUIDOR.erro or ''},
                      'revisao': ind.get('revisao', 0), 'itens': len(ind.get('itens') or []),
                      'nexocad': {'aberto': h['aberto'], 'versao': h['versao'], 'exe': acha_exe()}})

    @app.route('/api/nexo/revisao')
    def nexo_revisao():
        SEGUIDOR.garante()
        return _json({'revisao': SEGUIDOR.seq, 'mtime': 0, 'online': SEGUIDOR.online})

    @app.route('/api/nexo/biblioteca')
    def nexo_biblioteca():
        ind = indice()
        itens = filtra(ind, request.args.get('categoria'), request.args.get('texto'))
        return _json({'ok': True, 'dir': ind.get('url') or conexao()['url'], 'existe': bool(ind.get('online')),
                      'online': bool(ind.get('online')), 'erro': ind.get('erro') or '',
                      'revisao': ind.get('revisao', 0), 'categorias': ind.get('categorias') or [], 'itens': itens})

    @app.route('/api/nexo/arquivo/<item_id>/<nome>')
    def nexo_arquivo(item_id, nome):
        papel = PAPEIS.get(nome)
        if not papel or not ID_OK.match(item_id or '') or '..' in item_id:
            abort(404)
        rev = request.args.get('rev')
        try:
            rev_n = int(rev) if rev else None
        except ValueError:
            abort(400)
        if rev_n is not None:
            # a revisao atual vem do cache por sha (o pedido normal do hub-nexo.js leva ?rev=<atual>)
            with _cache_lock:
                atual = None
                for it in (_cache['indice'] or {}).get('itens') or []:
                    if it.get('id') == item_id:
                        atual = it.get('rev')
                        break
            if atual == rev_n:
                rev_n = None
        return resposta_arquivo(item_id, papel, rev_n)

    @app.route('/api/nexo/editar', methods=['POST'])
    def nexo_editar():
        if not eh_local(request):
            return _json({'ok': False, 'error': 'só desta máquina: o NexoCAD abre no PC do hub'}, 403)
        a = request.get_json(silent=True) or {}
        try:
            if a.get('id'):
                if not ID_OK.match(str(a['id'])):
                    return _json({'ok': False, 'error': 'id inválido'}, 400)
                r = rpc('biblioteca_abrir', {'id': a['id']})
                return _json({'ok': True, 'result': r, 'id': a['id']})
            chave = a.get('chave') or ''
            params = {'chave': chave, 'nome': a.get('nome') or '', 'footprint': a.get('footprint') or ''}
            if a.get('categoria'):
                params['categoria'] = a['categoria']
            # os pads do footprint (mm, referencial LOCAL do footprint, vista de cima): o NexoCAD
            # desenha o esboco de referencia no plano Superior. Vai como veio.
            if isinstance(a.get('geometria'), dict):
                params['geometria'] = a['geometria']
            if chave and not chave.startswith('nexo:') and (a.get('url') or not a.get('novo')):
                # a chave do modelo ja e (ou passa a ser) um item do Nexo Hub: o NexoCAD abre ESSE item
                try:
                    if a.get('url'):
                        porta = porta_atual()
                        iid, rev, criado = garante_modelo(
                            chave, a.get('nome') or '', [a.get('footprint')] if a.get('footprint') else [],
                            lambda: baixa_de_si(porta, a['url']), 'importado do NexoEletric (editar no NexoCAD)')
                    else:
                        x = nh_resolver(SIS_MODELO, [chave]).get(chave)
                        if not x:
                            return _json({'ok': False, 'error': 'a chave %s não está no Nexo Hub: mande a url do STEP' % chave}, 404)
                        iid, rev, criado = x['id'], int(x.get('rev') or 0), False
                    params['id'] = iid
                    r = rpc('biblioteca_editar_modelo', params)
                    out = {'ok': True, 'result': r, 'id': iid, 'rev': rev, 'criado': criado}
                    return _json(out)
                except ErroNexo as e:
                    if e.status != 503 or not a.get('url'):
                        raise
                    # o Nexo Hub fora do ar: o caminho antigo (o NexoCAD importa o STEP do disco)
            if a.get('url'):
                destino = os.path.join(pasta_temp(), '%s-%s.step' % (
                    nome_seguro(os.path.splitext(a.get('nome') or 'modelo')[0])[:60],
                    hashlib.sha1((chave or a['url']).encode('utf-8')).hexdigest()[:10]))
                baixa_de_si(porta_atual(), a['url'], destino)
                params['step_path'] = destino
            elif a.get('novo'):
                if not params['footprint'] and not chave:
                    return _json({'ok': False, 'error': 'item novo precisa do footprint'}, 400)
                params['novo'] = True
            else:
                return _json({'ok': False, 'error': 'informe {id}, {chave, url} ou {novo:true, footprint}'}, 400)
            r = rpc('biblioteca_editar_modelo', params)
            out = {'ok': True, 'result': r}
            if isinstance(r, dict):
                for k in ('id', 'criado'):
                    if k in r:
                        out[k] = r[k]
            return _json(out)
        except ErroNexo as e:
            return _json({'ok': False, 'error': str(e)}, e.status)

    @app.route('/api/nexo/placa', methods=['POST'])
    def nexo_placa():
        if not eh_local(request):
            return _json({'ok': False, 'error': 'só desta máquina: o NexoCAD abre no PC do hub'}, 403)
        if request.content_length and request.content_length > MAX_PACOTE:
            return _json({'ok': False, 'error': 'pacote grande demais'}, 413)
        a = request.get_json(silent=True) or {}
        pacote = a.get('pacote') if isinstance(a.get('pacote'), dict) else (a if a.get('format') else None)
        try:
            pub = publica_pacote(pacote, porta_atual())
            r = rpc('pcb_importar', {'item': pub['item']})
            return _json({'ok': True, 'result': r, 'item': pub['item'], 'rev': pub['rev'], 'mudou': pub['mudou'],
                          'avisos': pub['avisos']})
        except ErroNexo as e:
            return _json({'ok': False, 'error': str(e)}, e.status)

    return app
