"""AltiumPCBMirror - hubserver.py
Servidor local OPCIONAL: serve o workspace (hub.html, Libs\\, Projects\\...) na rede
local e recarrega o browser sozinho quando um export do Altium grava arquivos.
Uso: python hubserver.py [--port 8000]
Aditivo: nao altera nenhum arquivo do hub; abrir hub.html por duplo clique segue igual.
"""
import argparse
import hashlib
import hmac
import json
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time

from flask import Flask, Response, abort, request, send_from_directory
from werkzeug.utils import safe_join

ROOT = os.path.dirname(os.path.abspath(__file__))

# O send_from_directory tira o Content-Type do mimetypes, e no Windows o mimetypes le o registro
# (HKCR\.css\Content Type) POR CIMA do padrao. Numa maquina em que algum instalador registrou o
# .css como text/plain, o Chrome recusa a folha (checagem estrita de MIME) e o hub e as vistas
# abrem sem os tokens do tema (hub-tema.css): fundo transparente, texto preto. O .js vai junto
# pelo mesmo motivo -- e o defeito conhecido do registro do Windows.
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('text/javascript', '.js')
WATCH_INTERVAL = 1.0   # segundos entre varreduras de mtime
HEARTBEAT = 15.0       # keep-alive do SSE

# Estado do BOM, ao lado do projeto. Ficam FORA do _snapshot(): mudam a cada visto
# marcado, e o watcher dispararia reload em todas as paginas abertas -- exatamente no
# meio da montagem, que e quando ninguem pode perder a tela de vista.
BOM_VISTOS = 'bom-vistos.json'   # o que ja foi montado, COMPARTILHADO entre quem abre
BOM_OPTS = 'bom-opts.json'       # as opcoes com que a aba gerou, para o link abrir igual
BOM_STATE_FILES = (BOM_VISTOS, BOM_OPTS)
ODOO_LISTA = 'odoo-lista.json'  # recibo do envio ao Odoo; muda sem o projeto mudar
ESTADO_LOCAL = BOM_STATE_FILES + (ODOO_LISTA,)

app = Flask(__name__)
_version = 0           # incrementa a cada mudanca detectada
_version_lock = threading.Lock()

LIVE_JS = b"""/* hubserver: auto-reload via SSE (injetado; nao existe como arquivo) */
(function(){
  /* paginas de edicao definem __hubOnChange p/ nao perder trabalho nao salvo */
  function avisa(w){
    if (w.__hubOnChange) { w.__hubOnChange(); return; }
    w.location.reload();
  }
  /* UMA conexao por janela, e nao uma por documento. Este script entra em todo .html servido,
     inclusive nos iframes das vistas (Esquema, PCB, Neoden), e cada EventSource prende uma
     das 6 conexoes que o Chromium abre por host: hub + tres vistas + o stream de um
     sincronismo + o do chat ja sao 6, e o fetch seguinte fica na fila para sempre -- o hub
     parece travado. Agora o iframe se registra e quem escuta e a janela de cima, que repassa
     o aviso a cada iframe registrado, na mesma ordem de antes (cada um decide o seu). */
  function repassa(w){
    for (var i = 0; i < w.frames.length; i++) {
      try {
        var f = w.frames[i];
        if (f.__hubLiveFilho) { repassa(f); avisa(f); }
      } catch (e) {}
    }
  }
  var topo = null;
  try { if (window.top !== window && window.top.__hubLive) topo = window.top; } catch (e) {}
  if (topo) { window.__hubLiveFilho = true; return; }
  window.__hubLive = true;
  var es = new EventSource('/__events');
  es.addEventListener('change', function(){ repassa(window); avisa(window); });
  /* EventSource reconecta sozinho se o servidor cair/voltar */
})();
"""


def _snapshot():
    """mtimes de projects.js, Libs\\* e Projects\\** (arvore pequena)."""
    snap = {}

    def add(path):
        try:
            snap[path] = os.stat(path).st_mtime_ns
        except OSError:
            pass

    add(os.path.join(ROOT, 'projects.js'))
    for base in ('Libs', 'Projects'):
        for dirpath, _dirnames, filenames in os.walk(os.path.join(ROOT, base)):
            for f in filenames:
                if f in ESTADO_LOCAL:
                    continue      # visto marcado nao e mudanca de projeto; ver BOM_VISTOS
                add(os.path.join(dirpath, f))
    return snap


def _watcher():
    global _version
    prev = _snapshot()
    while True:
        time.sleep(WATCH_INTERVAL)
        try:
            cur = _snapshot()
        except Exception:
            continue
        if cur != prev:
            prev = cur
            with _version_lock:
                _version += 1


@app.after_request
def _no_store(resp):
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/__live.js')
def live_js():
    return Response(LIVE_JS, mimetype='text/javascript')


@app.route('/__events')
def events():
    def stream():
        with _version_lock:
            seen = _version
        last_beat = time.time()
        while True:
            time.sleep(0.5)
            with _version_lock:
                cur = _version
            if cur != seen:
                seen = cur
                yield 'event: change\ndata: %d\n\n' % cur
                last_beat = time.time()
            elif time.time() - last_beat >= HEARTBEAT:
                yield ': keep-alive\n\n'
                last_beat = time.time()

    return Response(stream(), mimetype='text/event-stream')


def _e_segredo(full):
    """E a credencial do Odoo (hub-almox.json) ou o temporario dela?

    O ponto no nome e o que tira um arquivo do HTTP (.hub-odoo.json, .chat/), e o
    hub-almox.json nao tem ponto: ate aqui GET /hub-almox.json entregava login e senha do
    Odoo a qualquer maquina da rede (tools/deploy/PENDENCIAS.md, 1.1). A comparacao e pelo
    caminho RESOLVIDO, e nao pelo nome: pega o symlink de shared/ no servidor e os apelidos
    que o Windows aceita para o mesmo arquivo (caixa, ponto ou espaco no fim).
    """
    alvo = os.path.normcase(os.path.realpath(full))
    return any(alvo == os.path.normcase(os.path.realpath(os.path.join(ROOT, n)))
               for n in (ALMOX_CFG_FILE, ALMOX_CFG_FILE + '.tmp'))


def _serve(path):
    if any(seg.startswith('.') for seg in path.replace('\\', '/').split('/')):
        abort(404)
    if os.name == 'nt' and ':' in path:   # fluxo alternativo do NTFS (hub-almox.json::$DATA)
        abort(404)
    full = safe_join(ROOT, path)
    if full is None or not os.path.isfile(full) or _e_segredo(full):
        abort(404)
    if full.lower().endswith('.html'):
        with open(full, 'rb') as f:
            body = f.read()
        i = body.rfind(b'</body>')
        tag = b'<script src="/__live.js"></script>\n'
        body = body[:i] + tag + body[i:] if i >= 0 else body + b'\n' + tag
        return Response(body, mimetype='text/html')
    return send_from_directory(ROOT, path)


@app.route('/')
def index():
    return _serve('hub.html')


@app.route('/<path:path>')
def files(path):
    return _serve(path)


SAVE_BASENAMES = ('changes.js', 'schematic.js', 'annotations.js')

# Libs/ e da biblioteca: o symserver (/api/symbols/*) e o guardiao do almoxarifado reescrevem
# schlib.js, symbols-lib.js e os espelhos inteiros, cada um sob a sua trava. A substituicao de
# nomes mora num arquivo SEPARADO, o unico de Libs/ que o browser grava direto por aqui. (No
# app desktop em modo biblioteca remota, este POST vai para o servidor: ver libremota.py.)
SAVE_LIB_FILES = ('lib-subs.js',)


@app.route('/api/save', methods=['POST'])
def api_save():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or 'path' not in data or 'content' not in data:
        return {'ok': False, 'error': 'JSON {path, content} obrigatorio'}, 400
    parts = [seg for seg in str(data['path']).replace('\\', '/').split('/') if seg]
    if any(seg.startswith('.') for seg in parts):
        return {'ok': False, 'error': 'path invalido'}, 403
    ok_proj = len(parts) == 3 and parts[0] == 'Projects' and parts[2] in SAVE_BASENAMES
    ok_lib = len(parts) == 2 and parts[0] == 'Libs' and parts[1] in SAVE_LIB_FILES
    if not (ok_proj or ok_lib):
        return {'ok': False,
                'error': 'so Projects/<nome>/{changes,schematic,annotations}.js ou Libs/lib-subs.js'}, 403
    full = safe_join(ROOT, *parts)
    if full is None or not os.path.isdir(os.path.dirname(full)):
        return {'ok': False, 'error': 'pasta inexistente'}, 404
    tmp = full + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            f.write(str(data['content']))
        # segue o symlink antes de trocar (ver tools/symbols/guardiao.py >> grava_ledger)
        os.replace(tmp, os.path.realpath(full))
    except OSError as e:
        return {'ok': False, 'error': 'falha ao gravar: %s' % e}, 500
    return {'ok': True}


LASER_DIR = 'Laser'


@app.route('/api/laser-open', methods=['POST'])
def api_laser_open():
    """Grava o .lbrn em Laser\\ e manda o Windows abrir com o app associado.

    O navegador nao lanca aplicativo, entao quem abre e o servidor. Consequencia
    honesta: o LightBurn abre na MAQUINA DO SERVIDOR. Acessando o hub de outro PC da
    rede, o arquivo abre la, nao no seu.

    So aceita de localhost: o servidor escuta na rede toda (0.0.0.0), e um endpoint
    que lanca aplicativo nao pode ficar exposto ao resto da LAN.
    """
    if not _is_local(request):
        return {'ok': False,
                'error': 'abrir direto so funciona no PC do servidor; use "Baixar .lbrn"'}, 403
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or 'name' not in data or 'content' not in data:
        return {'ok': False, 'error': 'JSON {name, content} obrigatorio'}, 400
    name = os.path.basename(str(data['name']))
    if not name.endswith(('.lbrn', '.lbrn2')) or name.startswith('.'):
        return {'ok': False, 'error': 'so .lbrn/.lbrn2'}, 403
    outdir = os.path.join(ROOT, LASER_DIR)
    try:
        os.makedirs(outdir, exist_ok=True)
        full = os.path.join(outdir, name)
        with open(full, 'w', encoding='utf-8', newline='\n') as f:
            f.write(str(data['content']))
    except OSError as e:
        return {'ok': False, 'error': 'falha ao gravar: %s' % e}, 500
    try:
        os.startfile(full)                      # Windows: abre com o app associado
    except AttributeError:
        return {'ok': False, 'error': 'abrir direto so no Windows; o arquivo ficou em '
                                      + os.path.join(LASER_DIR, name)}, 501
    except OSError as e:
        return {'ok': False, 'error': 'arquivo gravado, mas nada associado a .lbrn: %s' % e}, 500
    return {'ok': True, 'path': os.path.join(LASER_DIR, name)}


# ─────────────────────────── configuracao do hub ───────────────────────────
# Um arquivo so, na raiz, com o punhado de coisas que sao da MAQUINA e nao do projeto -
# hoje so a pasta padrao do BOM. Nao vai para o localStorage porque o caminho e do disco do
# SERVIDOR: gravado no browser, cada PC da LAN teria a sua versao de um caminho que so o
# servidor usa.
LOCAL_ADDRS = ('127.0.0.1', '::1', 'localhost')
# O hub escuta na rede? Reescrito pelo __main__ a partir do --host. Importado por teste ou
# WSGI, vale o padrao de sempre (rede toda).
_ESCUTA_REDE = True


def _is_local(req):
    """A chamada partiu do PROPRIO PC do servidor?

    Nao basta olhar 127.0.0.1: o banner imprime tambem a URL de LAN (e e ela que fica
    favoritada, porque e a mesma que funciona no tablet da bancada). Aberta no proprio PC,
    ela chega com o IP da maquina como remote_addr e cairia no 403. Comparar com os enderecos
    da propria maquina resolve sem afrouxar nada: o remote_addr e o IP real do outro lado do
    TCP, e o de outra maquina da LAN nunca e um dos nossos.
    """
    addr = req.remote_addr
    if addr in LOCAL_ADDRS:
        return True
    try:
        return addr in set(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        return False


_PROJ_CACHE = {}


def load_var_file(path):
    """Le um arquivo 'var X = ...;' e devolve o valor (os arquivos sao JSON gerado)."""
    with open(path, encoding='utf-8', errors='replace') as f:
        s = f.read()
    s = re.sub(r'^\s*//[^\n]*\n', '', s, flags=re.M)
    s = s[s.find('=') + 1:].strip().rstrip(';').strip()
    s = re.sub(r',\s*([\]}])', r'\1', s)
    return json.loads(s)


def _proj_id(name):
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return slug or 'proj'


def _mtime(path):
    try:
        return os.stat(path).st_mtime
    except OSError:
        return 0


def _count_ops(changes):
    return sum(1 for c in changes if isinstance(c, dict) and c.get('op'))


def build_index(root):
    projects = []
    pdir = os.path.join(root, 'Projects')
    names = sorted(d for d in os.listdir(pdir) if os.path.isdir(os.path.join(pdir, d))) if os.path.isdir(pdir) else []
    for name in names:
        d = os.path.join(pdir, name)
        has_sch = os.path.isfile(os.path.join(d, 'schematic.js'))
        has_board = os.path.isfile(os.path.join(d, 'board.js'))
        board = None
        if has_board:
            try:
                board = load_var_file(os.path.join(d, 'board.js'))
            except Exception:
                board = None
        stats = {'sheets': 0, 'comps': 0, 'nets': 0, 'tracks': 0, 'vias': 0}
        if board:
            stats['comps'] = len(board.get('components', []))
            stats['nets'] = len(board.get('nets', []))
            stats['tracks'] = len(board.get('tracks', []))
            stats['vias'] = len(board.get('vias', []))
        if has_sch and not board:
            try:
                sch = load_var_file(os.path.join(d, 'schematic.js'))
                items = sch.get('items', [])
                stats['sheets'] = sum(1 for i in items if i.get('t') == 'sheet')
                stats['comps'] = sum(1 for i in items if i.get('t') == 'comp')
            except Exception:
                pass
        elif has_sch:
            try:
                sch = load_var_file(os.path.join(d, 'schematic.js'))
                stats['sheets'] = sum(1 for i in sch.get('items', []) if i.get('t') == 'sheet')
            except Exception:
                pass
        pending = 0
        ch_path = os.path.join(d, 'changes.js')
        applied_at = _mtime(os.path.join(d, 'apply-report.txt'))
        if os.path.isfile(ch_path) and _mtime(ch_path) > applied_at:
            try:
                pending = _count_ops(load_var_file(ch_path))
            except Exception:
                pending = 0
        done = [has_sch or has_board, has_board, stats['tracks'] > 0, applied_at > 0 and applied_at >= _mtime(ch_path)]
        stages = [1 if v else 0 for v in done]
        for i, v in enumerate(stages):
            if not v:
                stages[i] = 2
                break
        projects.append({
            'id': _proj_id(name), 'name': name, 'path': 'Projects\\' + name,
            'demo': name.startswith('_'), 'noSchematic': not has_sch,
            'stages': stages, 'pending': pending, 'stats': stats,
        })
    _PROJ_CACHE.clear()
    for p in projects:
        _PROJ_CACHE[p['id']] = p['name']
    return {'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S'), 'projects': projects}


def _fmt_when(ts):
    return time.strftime('%Y-%m-%d %H:%M', time.localtime(ts)) if ts else ''


def build_detail(root, proj_id):
    if proj_id not in _PROJ_CACHE:
        build_index(root)
    name = _PROJ_CACHE.get(proj_id)
    if not name:
        return None
    d = os.path.join(root, 'Projects', name)
    board = sch = None
    try:
        board = load_var_file(os.path.join(d, 'board.js'))
    except Exception:
        pass
    try:
        sch = load_var_file(os.path.join(d, 'schematic.js'))
    except Exception:
        pass
    try:
        fplib = load_var_file(os.path.join(root, 'Libs', 'pcblib.js'))
        fp_by_name = {f.get('name'): f for f in fplib.get('footprints', [])}
    except Exception:
        fp_by_name = {}

    components = []
    if board:
        for c in board.get('components', []):
            nets = sorted({p.get('net') for p in c.get('pads', []) if p.get('net')})
            components.append({
                'des': c.get('ref', ''), 'value': c.get('comment', ''),
                'footprint': c.get('footprint', ''), 'lib': '',
                'pins': len(c.get('pads', [])), 'layer': c.get('layer', ''),
                'pos': '%.2f, %.2f mm' % (c.get('x', 0), c.get('y', 0)),
                'rot': '%g°' % c.get('rot', 0), 'nets': nets,
            })
    elif sch:
        for it in sch.get('items', []):
            if it.get('t') != 'comp':
                continue
            fp = fp_by_name.get(it.get('footprint', ''), {})
            components.append({
                'des': it.get('ref', ''), 'value': it.get('comment', ''),
                'footprint': it.get('footprint', ''), 'lib': '',
                'pins': len(fp.get('pads', [])), 'layer': '',
                'pos': '%g, %g mil' % (it.get('x', 0), it.get('y', 0)),
                'rot': '%g°' % it.get('rot', 0), 'nets': [],
            })

    nets = []
    if board:
        pads_by_net, tracks_by_net, widths = {}, {}, {}
        for c in board.get('components', []):
            for p in c.get('pads', []):
                if p.get('net'):
                    pads_by_net[p['net']] = pads_by_net.get(p['net'], 0) + 1
        for t in board.get('tracks', []):
            if t.get('net'):
                tracks_by_net[t['net']] = tracks_by_net.get(t['net'], 0) + 1
                widths.setdefault(t['net'], t.get('w', 0))
        for n in board.get('nets', []):
            nets.append({'name': n, 'cls': '—', 'nodes': pads_by_net.get(n, 0),
                         'tracks': tracks_by_net.get(n, 0),
                         'width': ('%g mm' % widths[n]) if n in widths else '—'})

    fp_usage = {}
    for c in components:
        if c['footprint']:
            fp_usage[c['footprint']] = fp_usage.get(c['footprint'], 0) + 1
    footprints = []
    for fname, count in sorted(fp_usage.items()):
        f = fp_by_name.get(fname, {})
        footprints.append({'name': fname, 'lib': 'pcblib',
                           'desc': f.get('desc', f.get('description', '')) or '—',
                           'usage': '%d componente%s' % (count, 's' if count != 1 else ''),
                           'pads': '%d pads' % len(f.get('pads', []))})

    history = []
    hist_path = os.path.join(d, 'history.jsonl')
    if os.path.isfile(hist_path):
        with open(hist_path, encoding='utf-8', errors='replace') as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        history.append(json.loads(line))
                    except Exception:
                        pass
    for fname, title in [('apply-report.txt', 'ApplyChanges executado'),
                         ('build-report.txt', 'BuildSchematic executado')]:
        ts = _mtime(os.path.join(d, fname))
        if ts:
            history.append({'when': _fmt_when(ts), 'kind': 'ok', 'title': title,
                            'detail': 'Projects\\' + name + '\\' + fname, 'ts': ts})
    if board and board.get('generated'):
        history.append({'when': str(board['generated']), 'kind': 'ok',
                        'title': 'ExportBoard concluído', 'detail': 'board.js atualizado', 'ts': _mtime(os.path.join(d, 'board.js'))})
    if sch and sch.get('generated'):
        history.append({'when': str(sch['generated']), 'kind': 'ok',
                        'title': 'schematic.js atualizado', 'detail': 'Projects\\' + name + '\\schematic.js', 'ts': _mtime(os.path.join(d, 'schematic.js'))})
    history.sort(key=lambda h: h.get('ts', 0), reverse=True)
    for h in history:
        h.pop('ts', None)

    return {'name': name, 'components': components, 'nets': nets, 'footprints': footprints,
            'history': history, 'schematic': sch or {}, 'board': board or {}}


RUN_ACTIONS = ('BuildSchematic', 'ExportBoard', 'ApplyChanges', 'DRC', 'Rescan')
ALTIUM_HINT = {
    'BuildSchematic': 'No Altium: DXP » Run Script » BuildSchematic (cria os .SchDoc)',
    'ExportBoard': 'No Altium: DXP » Run Script » ExportPcb',
    'ApplyChanges': 'No Altium: DXP » Run Script » ApplyProject',
    'DRC': 'No Altium: Tools » Design Rule Check',
}
_runs = {}


@app.route('/api/index.json')
def api_index():
    return build_index(ROOT)


@app.route('/api/project/<proj_id>.json')
def api_project(proj_id):
    det = build_detail(ROOT, proj_id)
    if det is None:
        return {'error': 'projeto desconhecido'}, 404
    return det


# ─────────────────────────── exclusao de projeto ───────────────────────────
# Senha mestre do hub, em texto aqui de proposito: o que ela protege e o clique errado
# no menu, nao um invasor - quem le este arquivo tambem apaga a pasta a mao. Trocar sem
# mexer no codigo: variavel de ambiente ALTIUMHUB_MASTER antes de subir o servidor.
MASTER_PASSWORD = os.environ.get('ALTIUMHUB_MASTER') or 'LucasGatao'
TRASH_DIR = 'Trash'


@app.route('/api/project/<proj_id>/delete', methods=['POST'])
def api_project_delete(proj_id):
    """Tira o projeto de Projects\\ e move a pasta inteira para Trash\\<nome>-<data>.

    Nao apaga nada. Para o hub da no mesmo - o indice so enxerga Projects\\ -, mas
    mover e reversivel e apagar nao: um clique com a senha certa nao pode custar o
    historico de uma placa. Quem quiser sumir de vez esvazia o Trash\\ a mao.

    Diferente do laser-open, este endpoint NAO e so-localhost: o hub e
    usado do tablet da bancada, e quem manda aqui e a senha mestre.
    """
    data = request.get_json(silent=True) or {}
    senha = data.get('password')
    if not isinstance(senha, str) or not hmac.compare_digest(
            senha.encode('utf-8'), MASTER_PASSWORD.encode('utf-8')):
        return {'ok': False, 'error': 'senha mestre incorreta'}, 403
    if proj_id not in _PROJ_CACHE:
        build_index(ROOT)
    name = _PROJ_CACHE.get(proj_id)
    if not name:
        return {'ok': False, 'error': 'projeto desconhecido'}, 404
    src = os.path.join(ROOT, 'Projects', name)
    if not os.path.isdir(src):
        return {'ok': False, 'error': 'a pasta do projeto ja nao existe'}, 404
    stamp = time.strftime('%Y%m%d-%H%M%S')
    dst = os.path.join(ROOT, TRASH_DIR, '%s-%s' % (name, stamp))
    n = 1
    while os.path.exists(dst):          # dois envios no mesmo segundo
        n += 1
        dst = os.path.join(ROOT, TRASH_DIR, '%s-%s-%d' % (name, stamp, n))
    try:
        os.makedirs(os.path.join(ROOT, TRASH_DIR), exist_ok=True)
        shutil.move(src, dst)
    except OSError as e:
        return {'ok': False, 'error': 'falha ao mover para o Trash: %s' % e}, 500
    build_index(ROOT)                   # o cache id->nome nao pode apontar para o que saiu
    return {'ok': True, 'trash': os.path.relpath(dst, ROOT)}


@app.route('/api/run', methods=['POST'])
def api_run():
    data = request.get_json(silent=True) or {}
    action = data.get('action')
    if action not in RUN_ACTIONS:
        return {'ok': False, 'error': 'acao desconhecida'}, 400
    if action != 'Rescan':
        return {'ok': False, 'error': 'esta acao roda dentro do Altium', 'hint': ALTIUM_HINT[action]}, 400
    run_id = 'r_%04x' % (int(time.time() * 1000) & 0xffff)
    _runs[run_id] = data.get('project') or ''
    return {'runId': run_id}, 202


@app.route('/api/run/<run_id>/stream')
def api_run_stream(run_id):
    if run_id not in _runs:
        abort(404)

    def stream():
        yield 'data: reindexando Projects...\n\n'
        try:
            idx = build_index(ROOT)
            yield 'data: %d projetos indexados\n\n' % len(idx['projects'])
            yield 'event: done\ndata: {"ok":true}\n\n'
        except Exception as e:
            yield 'event: error\ndata: %s\n\n' % json.dumps(str(e))
        _runs.pop(run_id, None)

    return Response(stream(), mimetype='text/event-stream')


# ─────────────────── almoxarifado: sincronizacao com o Odoo ───────────────────
# O trabalho pesado mora em tools/almox/almox2lib.py; aqui so o disparo, o stdout dele
# virando SSE e o arquivo de credenciais.
#
# hub-almox.json fica FORA do git e nunca sai por HTTP: o GET responde se ha senha
# gravada, nunca qual e. Gravar so de localhost, pela mesma regra do /api/config -
# quem escolhe as credenciais que o servidor usa tem que estar sentado nele.
ALMOX_CFG_FILE = 'hub-almox.json'
ALMOX_KEYS = ('url', 'db', 'login', 'senha')
ALMOX_SCRIPT = os.path.join('tools', 'almox', 'almox2lib.py')
ALMOX_TIMEOUT = 600.0          # segundos: Odoo mudo nao pode prender o hub para sempre

_almox_runs = {}
_almox_lock = threading.Lock()


def _almox_cfg_read():
    try:
        with open(os.path.join(ROOT, ALMOX_CFG_FILE), encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: data[k] for k in ALMOX_KEYS if isinstance(data.get(k), str)}


@app.route('/api/almox/config', methods=['GET'])
def api_almox_config_get():
    cfg = _almox_cfg_read()
    return {'ok': True, 'config': {
        'url': cfg.get('url', ''), 'db': cfg.get('db', ''), 'login': cfg.get('login', ''),
        # a senha nunca atravessa a rede de volta; o hub so precisa saber se existe
        'temSenha': bool(cfg.get('senha') or os.environ.get('ODOO_SENHA')),
    }, 'local': _is_local(request), 'script': os.path.isfile(os.path.join(ROOT, ALMOX_SCRIPT))}


@app.route('/api/almox/config', methods=['POST'])
def api_almox_config_set():
    if not _is_local(request):
        return {'ok': False, 'error': 'as credenciais do Odoo so mudam no PC do servidor'}, 403
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return {'ok': False, 'error': 'JSON obrigatorio'}, 400
    cfg = _almox_cfg_read()
    for k in ALMOX_KEYS:
        if k in data:
            if not isinstance(data[k], str):
                return {'ok': False, 'error': '%s tem que ser texto' % k}, 400
            v = data[k].strip()
            # Campo em branco no formulario significa "nao mexe", nao "apaga". Valia so
            # para a senha; passou a valer para todos. Gravar "" por cima de uma url
            # valida nao limpa a configuracao: troca o Odoo com que a maquina fala --
            # antes, calado, pelo default cravado; hoje, virando erro no proximo
            # sincronismo. Quem quiser mesmo zerar apaga o hub-almox.json.
            if not v:
                continue
            cfg[k] = v
    full = os.path.join(ROOT, ALMOX_CFG_FILE)
    tmp = full + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        # segue o symlink antes de trocar (ver tools/symbols/guardiao.py >> grava_ledger)
        os.replace(tmp, os.path.realpath(full))
    except OSError as e:
        return {'ok': False, 'error': 'falha ao gravar as credenciais: %s' % e}, 500
    return api_almox_config_get()


@app.route('/api/almox/sync', methods=['POST'])
def api_almox_sync():
    """Reserva a corrida. Quem executa e o stream, igual ao /api/run."""
    if not os.path.isfile(os.path.join(ROOT, ALMOX_SCRIPT)):
        return {'ok': False, 'error': 'tools/almox/almox2lib.py nao esta neste workspace'}, 404
    data = request.get_json(silent=True) or {}
    pull = bool(data.get('pull'))
    if pull and not (_almox_cfg_read().get('senha') or os.environ.get('ODOO_SENHA')):
        return {'ok': False, 'error': 'sem senha do Odoo gravada — configure antes de puxar '
                                      'ao vivo, ou sincronize a partir do snapshot'}, 400
    if _almox_lock.locked():
        return {'ok': False, 'error': 'ja tem uma sincronizacao rodando'}, 409
    run_id = 'a_%04x' % (int(time.time() * 1000) & 0xffff)
    if len(_almox_runs) > 8:            # corridas reservadas e nunca abertas
        _almox_runs.clear()
    _almox_runs[run_id] = pull
    return {'runId': run_id}, 202


@app.route('/api/almox/sync/<run_id>/stream')
def api_almox_sync_stream(run_id):
    if run_id not in _almox_runs:
        abort(404)
    pull = _almox_runs.pop(run_id)

    def stream():
        if not _almox_lock.acquire(blocking=False):
            yield 'event: error\ndata: %s\n\n' % json.dumps('ja tem uma sincronizacao rodando')
            return
        proc = None
        try:
            cmd = [sys.executable, os.path.join(ROOT, ALMOX_SCRIPT)] + (['--pull'] if pull else [])
            yield 'data: %s\n\n' % ('puxando o Odoo e regerando…' if pull
                                    else 'regerando do snapshot em disco…')
            env = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1')
            proc = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT)
            limite = time.time() + ALMOX_TIMEOUT
            for raw in iter(proc.stdout.readline, b''):
                linha = raw.decode('utf-8', 'replace').rstrip()
                if linha:
                    yield 'data: %s\n\n' % linha.replace('\r', '')
                if time.time() > limite:
                    proc.kill()
                    yield 'event: error\ndata: %s\n\n' % json.dumps(
                        'passou de %d s e foi interrompida' % int(ALMOX_TIMEOUT))
                    return
            code = proc.wait()
            if code != 0:
                yield 'event: error\ndata: %s\n\n' % json.dumps(
                    'o gerador terminou com codigo %d — veja o log acima' % code)
                return
            yield 'event: done\ndata: {"ok":true}\n\n'
        except Exception as e:                                  # noqa: BLE001
            yield 'event: error\ndata: %s\n\n' % json.dumps(str(e))
        finally:
            if proc is not None and proc.poll() is None:
                proc.kill()
            _almox_lock.release()

    return Response(stream(), mimetype='text/event-stream')


# ------------------------------- o BOM servido por link -------------------------------
#
# O BOM nao e mais um arquivo que se baixa: e a URL /bom/<proj_id>. Nada fica gravado em
# lugar nenhum. A rota devolve um bootstrap curto que carrega o hub-bom.js ATUAL, o
# os espelhos do projeto e o estado da bancada, e monta o documento no navegador de quem
# abriu. E dai que vem a propriedade que se queria: mexer no gerador melhora o BOM de
# TODOS os projetos no mesmo instante, porque nao existe copia velha para regerar.
#
# O preco e depender do servidor no ar. Foi uma troca deliberada: o link tem que abrir do
# tablet da bancada e de qualquer maquina da rede, e amanha de um servidor de verdade --
# nada disso um arquivo na pasta de Downloads de alguem faz.

_bom_lock = threading.Lock()   # os vistos chegam de varias maquinas ao mesmo tempo


def _proj_dir_by_id(proj_id):
    """A pasta de Projects/ cujo slug bate com proj_id, ou None.

    Usa o MESMO _proj_id do indice: o link /bom/<id> carrega o id que o resto da API ja
    usa, em vez de inventar um segundo esquema de nomes para o mesmo projeto.
    """
    pdir = os.path.join(ROOT, 'Projects')
    if not os.path.isdir(pdir):
        return None
    for name in sorted(os.listdir(pdir)):
        d = os.path.join(pdir, name)
        if os.path.isdir(d) and _proj_id(name) == proj_id:
            return d
    return None


def _bom_json_read(d, fname):
    """Estado ilegivel vira estado VAZIO, nunca erro: um bom-vistos.json corrompido nao
    pode derrubar a pagina que serve para montar a placa."""
    try:
        with open(os.path.join(d, fname), encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _bom_json_write(d, fname, data):
    """Grava atomico: dois tablets marcando junto nunca deixam meio arquivo no disco."""
    full = os.path.join(d, fname)
    tmp = full + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)
    # segue o symlink antes de trocar (ver tools/symbols/guardiao.py >> grava_ledger)
    os.replace(tmp, os.path.realpath(full))


def _bom_tag(data):
    """Token de versao do estado: hash do CONTEUDO, nao mtime.

    O mtime nao serve aqui. Dois vistos marcados no mesmo milissegundo saem com o mesmo
    st_mtime_ns no NTFS, e a outra maquina perderia o segundo -- justamente o caso de duas
    pessoas montando a mesma placa. O hash muda exatamente quando o conteudo muda, que e a
    unica pergunta que a pagina faz, e sobrevive a reinicio do servidor.
    """
    bruto = json.dumps(data, sort_keys=True, ensure_ascii=False).encode('utf-8')
    return hashlib.md5(bruto).hexdigest()[:12]


def _bom_source_rev(d):
    """Revisao dos dois espelhos: o BOM muda com a PCB ou com o esquema."""
    stamps = []
    for fname in ('board.js', 'schematic.js'):
        try:
            st = os.stat(os.path.join(d, fname))
            stamps.append((st.st_mtime_ns, st.st_size))
        except OSError:
            stamps.append(None)
    return _bom_tag(stamps)


def _bom_source(d):
    """Geometria da PCB com os dados de compra do espelho mais recente.

    Um comment alterado no esquema deve chegar a bancada antes do proximo ECO/ExportBoard.
    Quando a PCB for exportada depois, os dados dela passam a prevalecer. A geometria e a
    presenca fisica de componentes continuam vindo da PCB.
    """
    board_path = os.path.join(d, 'board.js')
    sch_path = os.path.join(d, 'schematic.js')
    board = load_var_file(board_path)
    if os.path.isfile(sch_path) and os.stat(sch_path).st_mtime_ns >= os.stat(board_path).st_mtime_ns:
        sch = load_var_file(sch_path)
        por_ref = {it.get('ref'): it for it in sch.get('items', [])
                   if isinstance(it, dict) and it.get('t') == 'comp' and it.get('ref')}
        for comp in board.get('components', []):
            origem = por_ref.get(comp.get('ref'))
            if origem:
                for campo in ('comment', 'footprint'):
                    if campo in origem:
                        comp[campo] = origem[campo]
    return board


@app.route('/api/bom/<proj_id>/source')
def api_bom_source(proj_id):
    d = _proj_dir_by_id(proj_id)
    if d is None:
        return {'ok': False, 'error': 'projeto nao encontrado'}, 404
    if not os.path.isfile(os.path.join(d, 'board.js')):
        return {'ok': False, 'error': 'board.js ausente'}, 404
    try:
        for _ in range(3):
            antes = _bom_source_rev(d)
            board = _bom_source(d)
            rev = _bom_source_rev(d)
            if antes == rev:
                return {'ok': True, 'board': board, 'sourceRev': rev}
    except (OSError, ValueError) as e:
        return {'ok': False, 'error': 'nao consegui ler os espelhos: ' + str(e)}, 500
    return {'ok': False, 'error': 'espelhos mudaram durante a leitura; tente Refresh'}, 503


BOM_BOOTSTRAP = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BOM — %(projEsc)s</title>
<style>html,body{margin:0;height:100%%;background:#14161a;color:#e8e8ea;
  font:14px system-ui,Segoe UI,sans-serif}
#av{padding:24px;line-height:1.5}#av b{color:#ff9a9a}</style></head><body>
<div id="av">montando o BOM…</div>
<!-- A ORDEM importa: no browser o hub-bom.js le root.HubFont e root.HubLaser, que sao os
     dois arquivos acima. Fora do CommonJS ninguem resolve isso sozinho, e sem eles a
     pagina abre com "Cannot read properties of undefined (reading 'padPrim')". -->
<script src="/hub-font.js"></script>
<script src="/hub-laser.js"></script>
<script src="/hub-bom.js"></script>
<script>
(function(){
  var API = %(api)s, PROJ = %(projJson)s;
  function falha(m){ document.getElementById('av').innerHTML = '<b>' + m + '</b>'; }
  function pega(u){
    return fetch(u, { cache: 'no-store' })
      .then(function (r){ return r.ok ? r.json() : {}; })
      .catch(function (){ return {}; });
  }
  if (typeof HubFont === 'undefined' || typeof HubLaser === 'undefined')
    return falha('nao consegui carregar hub-font.js / hub-laser.js, de que o gerador depende');
  if (typeof HubBom === 'undefined') return falha('nao consegui carregar hub-bom.js');
  Promise.all([pega(API + '/source'), pega(API + '/opts'), pega(API + '/vistos')]).then(function (res){
    var r;
    if (!res[0] || !res[0].ok || !res[0].board)
      return falha((res[0] && res[0].error) || 'nao consegui carregar os dados do BOM');
    try {
      r = HubBom.gerar(res[0].board, (res[1] && res[1].opts) || null, {
        proj: PROJ,
        generated: res[0].board.generated || '',
        api: API,
        vistos: (res[2] && res[2].vistos) || {},
        rev: (res[2] && res[2].rev) || 0,
        sourceRev: res[0].sourceRev
      });
    } catch (e) { return falha('o gerador falhou: ' + (e && e.message)); }
    /* Troca o documento inteiro em vez de embutir num iframe: a URL continua sendo a do
       link, e Ctrl+F, impressao e o zoom do tablet funcionam como em pagina normal. Num
       iframe cada um desses vira um caso especial, e essa pagina vive na bancada. */
    document.open(); document.write(r.html); document.close();
  });
})();
</script>
</body></html>
"""


@app.route('/bom/<proj_id>')
def bom_page(proj_id):
    """A pagina do BOM do projeto, montada na hora pelo gerador atual."""
    d = _proj_dir_by_id(proj_id)
    if d is None:
        abort(404)
    name = os.path.basename(d)
    if not os.path.isfile(os.path.join(d, 'board.js')):
        return Response(
            '<!doctype html><meta charset="utf-8"><p style="font:14px system-ui;padding:24px">'
            'O projeto <b>%s</b> ainda nao tem <code>board.js</code> — '
            'rode ExportPcb no Altium.' % name.replace('<', '&lt;'),
            mimetype='text/html', status=404)
    body = BOM_BOOTSTRAP % {
        'projEsc': name.replace('&', '&amp;').replace('<', '&lt;'),
        'projJson': json.dumps(name),
        'api': json.dumps('/api/bom/' + proj_id),
    }
    return Response(body, mimetype='text/html')


@app.route('/api/bom/<proj_id>/vistos', methods=['GET'])
def api_bom_vistos_get(proj_id):
    d = _proj_dir_by_id(proj_id)
    if d is None:
        return {'ok': False, 'error': 'projeto nao encontrado'}, 404
    vistos = _bom_json_read(d, BOM_VISTOS)
    return {'ok': True,
            'vistos': vistos,
            'rev': _bom_tag(vistos),
            'sourceRev': _bom_source_rev(d)}


@app.route('/api/bom/<proj_id>/vistos', methods=['POST'])
def api_bom_vistos_set(proj_id):
    """Marca e desmarca vistos da bancada.

    NAO e so-localhost, de proposito: quem monta a placa esta no tablet, e e ele que
    marca. Escreve um arquivo unico dentro da pasta do projeto, e o nome da pasta vem de
    _proj_dir_by_id (nada de caminho vindo do cliente).

    O corpo e um DELTA ({set:{chave:bool}}), nao o mapa inteiro: dois tablets marcando
    pecas diferentes ao mesmo tempo se somam, em vez de o ultimo apagar o do outro.
    """
    d = _proj_dir_by_id(proj_id)
    if d is None:
        return {'ok': False, 'error': 'projeto nao encontrado'}, 404
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return {'ok': False, 'error': 'JSON {set:{...}} ou {clear:true} obrigatorio'}, 400
    mudar = data.get('set')
    if mudar is not None and not isinstance(mudar, dict):
        return {'ok': False, 'error': 'set tem que ser objeto'}, 400
    with _bom_lock:
        atual = {} if data.get('clear') else _bom_json_read(d, BOM_VISTOS)
        for k, v in (mudar or {}).items():
            if not isinstance(k, str) or not k or len(k) > 300:
                return {'ok': False, 'error': 'chave de visto invalida'}, 400
            if v:
                atual[k] = True
            else:
                atual.pop(k, None)   # desmarcar APAGA: o arquivo guarda o que foi feito, so
        if len(atual) > 20000:
            return {'ok': False, 'error': 'vistos demais para uma placa'}, 400
        try:
            _bom_json_write(d, BOM_VISTOS, atual)
        except OSError as e:
            return {'ok': False, 'error': 'falha ao gravar: %s' % e}, 500
        return {'ok': True, 'vistos': atual, 'rev': _bom_tag(atual)}


@app.route('/api/bom/<proj_id>/opts', methods=['GET'])
def api_bom_opts_get(proj_id):
    d = _proj_dir_by_id(proj_id)
    if d is None:
        return {'ok': False, 'error': 'projeto nao encontrado'}, 404
    return {'ok': True, 'opts': _bom_json_read(d, BOM_OPTS) or None}


@app.route('/api/bom/<proj_id>/opts', methods=['POST'])
def api_bom_opts_set(proj_id):
    """As opcoes com que a aba gerou, para o link abrir do jeito que quem gerou escolheu.

    Sao preferencia de exibicao (tema, lados, o que aparece), nao dado de projeto -- por
    isso ficam em arquivo separado do board.js e podem ser reescritas a vontade.
    """
    d = _proj_dir_by_id(proj_id)
    if d is None:
        return {'ok': False, 'error': 'projeto nao encontrado'}, 404
    data = request.get_json(silent=True)
    opts = data.get('opts') if isinstance(data, dict) else None
    if not isinstance(opts, dict):
        return {'ok': False, 'error': 'JSON {opts:{...}} obrigatorio'}, 400
    if len(json.dumps(opts)) > 8000:
        return {'ok': False, 'error': 'opcoes grandes demais'}, 400
    try:
        _bom_json_write(d, BOM_OPTS, opts)
    except OSError as e:
        return {'ok': False, 'error': 'falha ao gravar: %s' % e}, 500
    return {'ok': True}


# O BOM que vale para a bancada pode morar noutro hub. O app desktop (electron/) roda um hub
# por PC, mas a referencia -- o projeto que a producao usa e os vistos que os tablets
# compartilham -- e o hub do servidor: com ALTIUMHUB_BOM_LINK=http://192.168.15.192:8100 o
# link copiado e o "abrir" apontam para la. Sem a variavel (o proprio servidor), nada muda.
BOM_LINK_BASE = (os.environ.get('ALTIUMHUB_BOM_LINK') or '').strip().rstrip('/')


def _bom_na_referencia(proj_id):
    """O hub de referencia tem o BOM deste projeto? True/False, ou None se nao respondeu.

    HEAD em /bom/<id>: la ele e 404 para projeto desconhecido E para projeto sem board.js,
    que sao exatamente os dois casos em que o link copiado abriria um erro no tablet.
    """
    import urllib.error
    import urllib.request
    try:
        req = urllib.request.Request(BOM_LINK_BASE + '/bom/' + proj_id, method='HEAD')
        with urllib.request.urlopen(req, timeout=3) as resp:
            return resp.status == 200
    except urllib.error.HTTPError as e:
        return False if e.code == 404 else None
    except Exception:                                    # noqa: BLE001 (rede, DNS, timeout)
        return None


def _bom_opts_para_referencia(d, proj_id):
    """Leva as opcoes do BOM gravadas aqui para o hub de referencia. Falhar e silencioso: o
    link abre do mesmo jeito, so com as opcoes de la."""
    import urllib.request
    opts = _bom_json_read(d, BOM_OPTS) if d else {}
    if not opts:
        return
    try:
        req = urllib.request.Request(BOM_LINK_BASE + '/api/bom/' + proj_id + '/opts',
                                     data=json.dumps({'opts': opts}).encode('utf-8'),
                                     headers={'Content-Type': 'application/json'}, method='POST')
        urllib.request.urlopen(req, timeout=3).close()
    except Exception:                                    # noqa: BLE001
        pass


@app.route('/api/bom/<proj_id>/link')
def api_bom_link(proj_id):
    """A URL do BOM deste projeto, no endereco que serve para OUTRA maquina.

    Quem abre o hub em 127.0.0.1 copiaria um link que so funciona no proprio PC -- e o
    ponto do link e justamente mandar para o tablet. Se o host do request ja e um
    nome/IP de rede (o caso do dia em que isso virar um servidor de verdade), fica como
    veio: o proprio Host: do request e a melhor pista de como se chega aqui.
    """
    if _proj_dir_by_id(proj_id) is None:
        return {'ok': False, 'error': 'projeto nao encontrado'}, 404
    if BOM_LINK_BASE:
        # O BOM de referencia e o do OUTRO hub (o do servidor): e la que a bancada inteira
        # abre e marca os vistos. O slug e o mesmo dos dois lados (_proj_id).
        r = {'ok': True, 'url': BOM_LINK_BASE + '/bom/' + proj_id, 'lan': True, 'trocado': False,
             'externo': True}
        if request.args.get('verificar') != '0':
            tem = _bom_na_referencia(proj_id)
            if tem:
                # As opcoes da aba (tema, lados, colunas) acabaram de ser gravadas AQUI pelo
                # copiarLink; o link abre LA. Repassa, como faria quem copiasse no servidor.
                _bom_opts_para_referencia(_proj_dir_by_id(proj_id), proj_id)
            if tem is False:
                r['aviso'] = ('o servidor nao tem este projeto (ou ele esta sem board.js): o link '
                              'abre um erro la ate o projeto chegar ao servidor')
            elif tem is None:
                r['aviso'] = 'o servidor nao respondeu agora; o link e o dele, confira quando ele voltar'
        return r
    host, _, porta = request.host.partition(':')
    trocado = False
    # Escutando so em 127.0.0.1 (app desktop sem "compartilhar na rede"), o IP de rede
    # daria um link morto: melhor o de loopback, que ao menos abre neste PC.
    if host in LOCAL_ADDRS and _ESCUTA_REDE:
        ip = _lan_ip()
        if ip:
            host, trocado = ip, True
    return {'ok': True,
            'url': 'http://' + host + (':' + porta if porta else '') + '/bom/' + proj_id,
            'lan': host not in LOCAL_ADDRS,
            'trocado': trocado}


# ─────────────────── biblioteca de símbolos (tools/symbols) ───────────────────
sys.path.insert(0, os.path.join(ROOT, 'tools', 'symbols'))
import symserver                     # noqa: E402
symserver.registra(app, ROOT)

# ─────────────── biblioteca remota (app desktop) ───────────────
# Com ALTIUMHUB_LIB_REMOTA=<hub central> a biblioteca e a do SERVIDOR: /api/symbols/*,
# /api/almox/config e o lib-subs.js vao para la, e Libs/ vira espelho dele para quem le do
# disco. Sem a variavel (o proprio servidor, a bancada) so existe o status dizendo "local".
# Fora do try de proposito: sem o modulo, o app subiria local calado -- e a biblioteca
# voltaria a divergir do servidor, que e o que o modo existe para impedir.
import libremota                     # noqa: E402
libremota.registra(app, ROOT, os.environ.get('ALTIUMHUB_LIB_REMOTA'))

# ─────────────────── lista de componentes para o Odoo ───────────────────
# Sob try: o hub inteiro (laser, BOM, PCB) nao pode deixar de subir porque UM arquivo novo
# nao viajou no merge -- e o acidente que o CLAUDE.md descreve, e o hubserver.py e o unico
# arquivo aqui que e de outro dono. O aviso e alto de proposito: botao mudo e pior que erro.
try:
    import odoolista_server        # noqa: E402
    odoolista_server.registra(app, ROOT)
except Exception as _e:            # noqa: BLE001
    print('AVISO: envio da lista ao Odoo desligado (%s) — falta odoolista_server.py '
          'ou odoolista.py na raiz do workspace.' % _e)

# ─────────────────── chat do Claude dentro do hub (tools/chat) ──────────────────
# A senha mestre e a MESMA do "Excluir projeto" — e a unica que este hub tem, e o chat
# precisa de uma porque gasta dinheiro da conta do usuario a cada mensagem. No servidor ela
# vem do /etc/altiumhub/senha.env (o compose ja monta o arquivo); aqui na bancada cai no
# padrao que esta neste arquivo, e por isso o aviso abaixo existe: senha que esta no git nao
# tranca nada contra quem alcanca a maquina pela rede.
#
# Sob try pela mesma razao dos dois de cima: o hub inteiro nao pode deixar de subir porque um
# arquivo novo nao viajou num merge. Botao mudo e pior que erro — o aviso e alto de proposito.
try:
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'chat'))
    import chatserver                # noqa: E402
    chatserver.registra(app, ROOT, MASTER_PASSWORD)
    if not os.environ.get('ALTIUMHUB_MASTER'):
        print('AVISO: o chat esta usando a senha mestre PADRAO (a que esta no git). Numa '
              'maquina que outras pessoas alcancam, defina ALTIUMHUB_MASTER antes de subir.')
except Exception as _e:            # noqa: BLE001
    print('AVISO: chat do Claude desligado (%s) — falta tools/chat/chatserver.py.' % _e)

# ─────────────── lista de materiais do Odoo sobre o esquema (so leitura) ───────────────
# O caminho de volta do de cima: a BoM da PCB no Odoo vira vinculo para os componentes do
# projeto. Sob try pela mesma razao — um arquivo novo que nao viajou no merge nao pode
# impedir o hub inteiro de subir.


def configura_escuta(host):
    """O que muda quando o hub escuta so nesta maquina (--host 127.0.0.1).

    - o link do BOM nao troca o loopback pelo IP da rede (api_bom_link): la nada responde;
    - o Host: legitimo so pode ser o loopback. Sem isto uma pagina qualquer aberta no
      navegador do usuario, com um dominio que resolve para 127.0.0.1 (DNS rebinding), vira
      "mesma origem" do hub: le o hub-almox.json com a senha do Odoo e fala com o chat. Host
      fora da lista = 400, antes de qualquer rota.
    """
    global _ESCUTA_REDE
    _ESCUTA_REDE = host not in LOCAL_ADDRS
    app.config['TRUSTED_HOSTS'] = None if _ESCUTA_REDE else ['127.0.0.1', 'localhost', '::1', '[::1]']
    return _ESCUTA_REDE


def _lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))  # nao envia nada; so escolhe a interface
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Servidor local do EletricHUB (AltiumPCBMirror)')
    ap.add_argument('--port', type=int, default=8000)
    # O padrao continua sendo a rede toda: e o que o servidor e a bancada usam. O app desktop
    # (electron/) passa 127.0.0.1 quando o usuario nao liga "compartilhar na rede".
    ap.add_argument('--host', default='0.0.0.0')
    args = ap.parse_args()
    configura_escuta(args.host)
    threading.Thread(target=_watcher, daemon=True).start()
    libremota.inicia()           # so faz algo com ALTIUMHUB_LIB_REMOTA
    print('EletricHUB:')
    print('  http://127.0.0.1:%d' % args.port)
    ip = _lan_ip() if _ESCUTA_REDE else None
    if ip:
        print('  http://%s:%d  (rede local; o Windows pode pedir firewall)' % (ip, args.port))
    app.run(host=args.host, port=args.port, threaded=True, debug=False)
