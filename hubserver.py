"""AltiumPCBMirror - hubserver.py
Servidor local OPCIONAL: serve o workspace (hub.html, Libs\\, Projects\\...) na rede
local e recarrega o browser sozinho quando um export do Altium grava arquivos.
Uso: python hubserver.py [--port 8000]
Aditivo: nao altera nenhum arquivo do hub; abrir hub.html por duplo clique segue igual.
"""
import argparse
import json
import os
import re
import socket
import threading
import time

from flask import Flask, Response, abort, request, send_from_directory
from werkzeug.utils import safe_join

ROOT = os.path.dirname(os.path.abspath(__file__))
WATCH_INTERVAL = 1.0   # segundos entre varreduras de mtime
HEARTBEAT = 15.0       # keep-alive do SSE

app = Flask(__name__)
_version = 0           # incrementa a cada mudanca detectada
_version_lock = threading.Lock()

LIVE_JS = b"""/* hubserver: auto-reload via SSE (injetado; nao existe como arquivo) */
(function(){
  var es = new EventSource('/__events');
  es.addEventListener('change', function(){
    /* paginas de edicao definem __hubOnChange p/ nao perder trabalho nao salvo */
    if (window.__hubOnChange) { window.__hubOnChange(); return; }
    location.reload();
  });
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


def _serve(path):
    if any(seg.startswith('.') for seg in path.replace('\\', '/').split('/')):
        abort(404)
    full = safe_join(ROOT, path)
    if full is None or not os.path.isfile(full):
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


@app.route('/api/save', methods=['POST'])
def api_save():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or 'path' not in data or 'content' not in data:
        return {'ok': False, 'error': 'JSON {path, content} obrigatorio'}, 400
    parts = [seg for seg in str(data['path']).replace('\\', '/').split('/') if seg]
    if any(seg.startswith('.') for seg in parts):
        return {'ok': False, 'error': 'path invalido'}, 403
    if len(parts) != 3 or parts[0] != 'Projects' or parts[2] not in SAVE_BASENAMES:
        return {'ok': False, 'error': 'so Projects/<nome>/{changes,schematic,annotations}.js'}, 403
    full = safe_join(ROOT, *parts)
    if full is None or not os.path.isdir(os.path.dirname(full)):
        return {'ok': False, 'error': 'projeto inexistente'}, 404
    tmp = full + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            f.write(str(data['content']))
        os.replace(tmp, full)
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
    if request.remote_addr not in ('127.0.0.1', '::1', 'localhost'):
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


RUN_ACTIONS = ('ExportLibs', 'BuildSchematic', 'ExportBoard', 'ApplyChanges', 'DRC', 'Rescan')
ALTIUM_HINT = {
    'ExportLibs': 'No Altium: DXP » Run Script » ExportLibs',
    'BuildSchematic': 'No Altium: DXP » Run Script » ApplyProject (cria os .SchDoc)',
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
    ap = argparse.ArgumentParser(description='Servidor local do AltiumPCBMirror')
    ap.add_argument('--port', type=int, default=8000)
    args = ap.parse_args()
    threading.Thread(target=_watcher, daemon=True).start()
    print('AltiumPCBMirror hub:')
    print('  http://127.0.0.1:%d' % args.port)
    ip = _lan_ip()
    if ip:
        print('  http://%s:%d  (rede local; o Windows pode pedir firewall)' % (ip, args.port))
    app.run(host='0.0.0.0', port=args.port, threaded=True, debug=False)
