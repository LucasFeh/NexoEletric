# -*- coding: utf-8 -*-
"""Rotas /api/nexo/*: o hub conversa com o NexoCAD e le a biblioteca compartilhada.

O contrato e o docs/INTEGRACAO-NEXOCAD.md (o mesmo arquivo nos dois programas). Resumo:

- A biblioteca (o "BD") e uma pasta que SO o NexoCAD grava. O hub so a LE, direto do disco:
  DIELETRONS_BIBLIOTECA > o ponteiro C:\\Users\\Public\\Dieletrons\\biblioteca.json ({"dir":...})
  > o padrao C:\\Users\\Public\\Dieletrons\\Biblioteca.
- Para gravar (editar um modelo, montar a placa) o hub PEDE ao NexoCAD: POST /rpc na porta do
  %USERPROFILE%\\.nexocad\\session.json, com o token dele. App fechado: o hub abre o exe e espera
  o session.json e o GET /health ate 60 s.

Rotas:
  GET  /api/nexo/estado                       {ok, dir, existe, revisao, nexocad:{aberto, versao, exe}}
  GET  /api/nexo/revisao                      {revisao, mtime} (barata: as paginas consultam a cada 1,5 s)
  GET  /api/nexo/biblioteca?categoria=&texto= o indice filtrado (padrao: Eletronicos; categoria=* = todas)
  GET  /api/nexo/arquivo/<id>/<modelo.step|thumb.png>
  POST /api/nexo/editar   {chave, url, nome, footprint} | {id} | {novo:true, footprint, nome, chave?}
  POST /api/nexo/placa    {pacote}  (eletrichub-placa-v1)
Os POST so aceitam pedidos desta maquina.

A `url` do STEP (e as dos modelos do pacote) e um caminho do PROPRIO hub (/Libs/3d-hub/...,
/Libs/3d/..., /Projects/<p>/..., /api/nexo/arquivo/...): o servidor baixa de si mesmo, pela porta
em que atende. Assim vale o mesmo caminho que a pagina usa -- o 3D da PcbLib tirado sob demanda e,
no app desktop em modo biblioteca remota, o repasse ao servidor central.

Para os testes: NEXOCAD_SESSION troca o caminho do session.json; DIELETRONS_PONTEIRO, o do ponteiro.

No hubserver.py (o molde dos outros registraveis):

    sys.path.insert(0, os.path.join(ROOT, 'tools', 'rotas'))
    import nexocad
    nexocad.registra(app, ROOT, _is_local)
"""
import datetime
import hashlib
import json
import mimetypes
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

PADRAO_DIR = r'C:\Users\Public\Dieletrons\Biblioteca'
PONTEIRO = r'C:\Users\Public\Dieletrons\biblioteca.json'
INDICE = 'biblioteca.json'
CATEGORIA_PADRAO = 'Eletrônicos'
ARQUIVOS_ITEM = {'modelo.step': 'step', 'thumb.png': 'thumb'}
ID_OK = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')
ESPERA_ABRIR = 60.0          # s: o NexoCAD abrindo do zero
T_HEALTH = 1.5               # s
T_RPC = 300.0                # s: importar um STEP grande / montar a placa
T_BAIXA = 300.0              # s: o 3D da PcbLib sai da PcbLib na primeira vez
MAX_PACOTE = 64 * 1024 * 1024
MAX_MODELOS = 2000
LOCAL = ('127.0.0.1', '::1', 'localhost')


class ErroNexo(Exception):
    def __init__(self, msg, status=502):
        Exception.__init__(self, msg)
        self.status = status


# ─────────────────────────── a biblioteca (so leitura) ───────────────────────────
def raiz():
    """A pasta da biblioteca: variavel > ponteiro > padrao."""
    env = os.environ.get('DIELETRONS_BIBLIOTECA')
    if env:
        return os.path.abspath(env)
    ponteiro = os.environ.get('DIELETRONS_PONTEIRO') or PONTEIRO
    try:
        with open(ponteiro, 'r', encoding='utf-8-sig') as f:
            d = json.load(f).get('dir')
        if isinstance(d, str) and d.strip():
            return os.path.abspath(d.strip())
    except (OSError, ValueError, AttributeError):
        pass
    return PADRAO_DIR


_cache = {'chave': None, 'indice': None}
_cache_lock = threading.Lock()


def _stat_indice(base):
    try:
        st = os.stat(os.path.join(base, INDICE))
        return st.st_mtime_ns, st.st_size
    except OSError:
        return None


def le_indice(base=None):
    """(indice|None, mtime_ns|None). Relido so quando o arquivo muda (mtime+tamanho)."""
    base = base or raiz()
    st = _stat_indice(base)
    if st is None:
        return None, None
    chave = (base, st)
    with _cache_lock:
        if _cache['chave'] == chave:
            return _cache['indice'], st[0]
    try:
        with open(os.path.join(base, INDICE), 'r', encoding='utf-8-sig') as f:
            ind = json.load(f)
        if not isinstance(ind, dict):
            ind = None
    except (OSError, ValueError):
        # o NexoCAD grava atomico (tmp + rename), mas numa share de rede a leitura pode pegar
        # o meio: devolve a ultima copia boa em vez de dizer que a biblioteca sumiu
        with _cache_lock:
            if _cache['chave'] and _cache['chave'][0] == base:
                return _cache['indice'], st[0]
        return None, st[0]
    with _cache_lock:
        _cache['chave'] = chave
        _cache['indice'] = ind
    return ind, st[0]


def _itens(ind):
    return [i for i in ((ind or {}).get('itens') or []) if isinstance(i, dict) and i.get('id')]


def _sem_acento(s):
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', str(s or '')) if unicodedata.category(c) != 'Mn').lower()


def filtra(ind, categoria=None, texto=None):
    itens = _itens(ind)
    if categoria is None or categoria == '':
        categoria = CATEGORIA_PADRAO
    if categoria not in ('*', 'todas', 'Todas'):
        c = _sem_acento(categoria)
        itens = [i for i in itens if _sem_acento(i.get('categoria')) == c]
    if texto:
        t = _sem_acento(texto)
        def casa(i):
            el = i.get('eletronico') or {}
            campos = [i.get('id'), i.get('nome'), i.get('descricao'), i.get('subcategoria'),
                      ' '.join(i.get('tags') or []), ' '.join(el.get('footprints') or []),
                      el.get('mpn'), el.get('fabricante'), el.get('encapsulamento')]
            return any(t in _sem_acento(x) for x in campos if x)
        itens = [i for i in itens if casa(i)]
    return itens


def acha_item(ind, item_id):
    for i in _itens(ind):
        if i.get('id') == item_id:
            return i
    return None


def _dentro(base, caminho):
    b = os.path.normcase(os.path.realpath(base))
    c = os.path.normcase(os.path.realpath(caminho))
    return c == b or c.startswith(b.rstrip('\\/') + os.sep)


def arquivo_do_item(base, ind, item_id, nome):
    """Caminho absoluto de modelo.step/thumb.png do item, ou None (sem sair da raiz)."""
    if not ID_OK.match(item_id or '') or '..' in item_id or nome not in ARQUIVOS_ITEM:
        return None
    rel = None
    it = acha_item(ind, item_id)
    if it and isinstance(it.get('arquivos'), dict):
        rel = it['arquivos'].get(ARQUIVOS_ITEM[nome])
    if not isinstance(rel, str) or not rel:
        rel = 'itens/%s/%s' % (item_id, nome)
    partes = [p for p in rel.replace('\\', '/').split('/') if p]
    if not partes or any(p in ('.', '..') for p in partes) or ':' in rel:
        return None
    f = os.path.join(base, *partes)
    if not _dentro(base, f) or not os.path.isfile(f):
        return None
    return f


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


def baixa_de_si(porta, url, destino):
    """GET http://127.0.0.1:<porta><url> -> destino (precisa ser STEP). Devolve bytes."""
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
    tmp = destino + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(dados)
    os.replace(tmp, destino)
    return len(dados)


def porta_atual():
    return request.environ.get('SERVER_PORT') or str(request.host.rsplit(':', 1)[-1] if ':' in request.host else '80')


# ─────────────────────────── o pacote da placa ───────────────────────────
ARQ_MODELO = re.compile(r'^modelos/[A-Za-z0-9._ ()+-]{1,120}\.step$')


def grava_pacote(pacote, porta, base=None):
    """Grava placa.json + modelos/*.step numa pasta nova. Devolve (pasta, caminho do json, avisos)."""
    if not isinstance(pacote, dict) or pacote.get('format') != 'eletrichub-placa-v1':
        raise ErroNexo('pacote invalido: falta format "eletrichub-placa-v1"', 400)
    proj = nome_seguro(pacote.get('projeto'), 'placa')
    hora = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    raiz_t = base or pasta_temp()
    pasta = os.path.join(raiz_t, '%s-%s' % (proj, hora))
    n = 1
    while os.path.exists(pasta):
        n += 1
        pasta = os.path.join(raiz_t, '%s-%s-%d' % (proj, hora, n))
    os.makedirs(os.path.join(pasta, 'modelos'))
    avisos = []
    modelos = pacote.get('modelos') if isinstance(pacote.get('modelos'), dict) else {}
    if len(modelos) > MAX_MODELOS:
        raise ErroNexo('modelos demais no pacote (%d)' % len(modelos), 400)
    saida = {}
    usados = set()
    falhos = set()
    for chave, m in modelos.items():
        m = m if isinstance(m, dict) else {}
        arq = m.get('arquivo') if isinstance(m.get('arquivo'), str) else ''
        if not ARQ_MODELO.match(arq) or arq.lower() in usados:
            arq = 'modelos/%s-%s.step' % (nome_seguro(os.path.splitext(m.get('nome') or '')[0], 'modelo')[:60],
                                         hashlib.sha1(str(chave).encode('utf-8')).hexdigest()[:8])
        usados.add(arq.lower())
        destino = os.path.join(pasta, *arq.split('/'))
        try:
            if m.get('url'):
                baixa_de_si(porta, m['url'], destino)
            else:
                raise ErroNexo('sem url', 400)
        except ErroNexo as e:
            avisos.append('%s: %s' % (chave, e))
            falhos.add(chave)
            continue
        e = {'arquivo': arq, 'nome': m.get('nome') or os.path.basename(arq)}
        saida[chave] = e
    pac = dict(pacote)
    pac['modelos'] = saida
    if falhos:
        # o corpo cujo modelo nao veio sai do pacote (o NexoCAD nao acharia o arquivo)
        comps = []
        for c in pac.get('componentes') or []:
            if not isinstance(c, dict):
                continue
            c = dict(c)
            c['corpos'] = [b for b in (c.get('corpos') or [])
                           if not (isinstance(b, dict) and b.get('tipo') == 'step' and b.get('modelo') in falhos)]
            comps.append(c)
        pac['componentes'] = comps
    arq_json = os.path.join(pasta, 'placa.json')
    tmp = arq_json + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(pac, f, ensure_ascii=False, indent=1)
    os.replace(tmp, arq_json)
    return pasta, arq_json, avisos


# ─────────────────────────── rotas ───────────────────────────
def _json(obj, status=200):
    return Response(json.dumps(obj, ensure_ascii=False), status=status, mimetype='application/json')


def _local_padrao(req):
    return req.remote_addr in LOCAL


def item_por_chave(ind, chave):
    if not chave:
        return None
    for i in _itens(ind):
        if chave in (i.get('substitui') or []):
            return i
    return None


def registra(app, root, eh_local=None):
    eh_local = eh_local or _local_padrao

    @app.route('/api/nexo/estado')
    def nexo_estado():
        base = raiz()
        ind, _m = le_indice(base)
        h = saude()
        return _json({'ok': True, 'dir': base, 'existe': os.path.isdir(base), 'indice': ind is not None,
                      'revisao': (ind or {}).get('revisao', 0) if ind else 0,
                      'itens': len(_itens(ind)),
                      'nexocad': {'aberto': h['aberto'], 'versao': h['versao'], 'exe': acha_exe()}})

    @app.route('/api/nexo/revisao')
    def nexo_revisao():
        ind, mtime = le_indice()
        return _json({'revisao': (ind or {}).get('revisao', 0) if ind else 0,
                      'mtime': (mtime / 1e9) if mtime else 0})

    @app.route('/api/nexo/biblioteca')
    def nexo_biblioteca():
        base = raiz()
        ind, _m = le_indice(base)
        itens = filtra(ind, request.args.get('categoria'), request.args.get('texto'))
        return _json({'ok': True, 'dir': base, 'existe': os.path.isdir(base),
                      'revisao': (ind or {}).get('revisao', 0) if ind else 0,
                      'categorias': (ind or {}).get('categorias') or [],
                      'itens': itens})

    @app.route('/api/nexo/arquivo/<item_id>/<nome>')
    def nexo_arquivo(item_id, nome):
        base = raiz()
        ind, _m = le_indice(base)
        f = arquivo_do_item(base, ind, item_id, nome)
        if not f:
            abort(404)
        tipo = 'image/png' if nome.endswith('.png') else 'application/step'
        return send_file(f, mimetype=tipo, conditional=False, max_age=0)

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
            # a chave que algum item ja substitui: abre esse item, sem reimportar o STEP
            ind, _m = le_indice()
            ja = item_por_chave(ind, chave)
            if ja:
                r = rpc('biblioteca_abrir', {'id': ja['id']})
                return _json({'ok': True, 'result': r, 'id': ja['id'], 'criado': False})
            params = {'chave': chave, 'nome': a.get('nome') or '', 'footprint': a.get('footprint') or ''}
            if a.get('categoria'):
                params['categoria'] = a['categoria']
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
            pasta, arq, avisos = grava_pacote(pacote, porta_atual())
            r = rpc('pcb_importar', {'path': arq})
            return _json({'ok': True, 'result': r, 'dir': pasta, 'path': arq, 'avisos': avisos})
        except ErroNexo as e:
            return _json({'ok': False, 'error': str(e)}, e.status)
        except OSError as e:
            return _json({'ok': False, 'error': 'não gravei o pacote (%s)' % e}, 500)

    return app
