"""AltiumPCBMirror - hubserver.py
Servidor local OPCIONAL: serve o workspace (hub.html, Libs\\, Projects\\...) na rede
local e recarrega o browser sozinho quando um export do Altium grava arquivos.
Uso: python hubserver.py [--port 8000]
Aditivo: nao altera nenhum arquivo do hub; abrir hub.html por duplo clique segue igual.
"""
import argparse
import hmac
import json
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

# Libs/ e propriedade do ExportLibs.pas, que sobrescreve schlib.js/pcblib.js inteiros - por
# isso a substituicao mora em arquivo SEPARADO, o unico de Libs/ que o browser pode gravar.
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
CONFIG_FILE = 'hub-config.json'
CONFIG_KEYS = ('bomDir',)
LOCAL_ADDRS = ('127.0.0.1', '::1', 'localhost')


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


def _config_read():
    """Config invalida vira config VAZIA, nunca erro: um hub-config.json com `[]` dentro
    derrubaria com 500 ate a rota que serve para consertar o problema."""
    try:
        with open(os.path.join(ROOT, CONFIG_FILE), encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: data[k] for k in CONFIG_KEYS if isinstance(data.get(k), str)}


@app.route('/api/config', methods=['GET'])
def api_config_get():
    return {'ok': True, 'config': _config_read()}


@app.route('/api/config', methods=['POST'])
def api_config_set():
    """Grava hub-config.json. So de localhost: bomDir aponta para o disco do servidor, e
    quem escolhe onde o servidor escreve tem que estar sentado nele."""
    if not _is_local(request):
        return {'ok': False, 'error': 'a configuracao so muda no PC do servidor'}, 403
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return {'ok': False, 'error': 'JSON obrigatorio'}, 400
    cfg = _config_read()
    for k in CONFIG_KEYS:
        if k in data:
            if not isinstance(data[k], str):
                return {'ok': False, 'error': '%s tem que ser texto' % k}, 400
            cfg[k] = data[k].strip()
    full = os.path.join(ROOT, CONFIG_FILE)
    tmp = full + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        os.replace(tmp, full)
    except OSError as e:
        return {'ok': False, 'error': 'falha ao gravar a configuracao: %s' % e}, 500
    return {'ok': True, 'config': cfg}


# ─────────────────── escolher a pasta pelo dialogo do Windows ───────────────────
# O navegador nao sabe caminho absoluto (showDirectoryPicker da so o nome, webkitdirectory
# da caminho relativo), entao quem abre a janela de pasta e o SERVIDOR, na maquina dele -
# mesma consequencia honesta do laser-open: acessando o hub de outro PC, a janela abre LA.
PICK_TIMEOUT = 120.0            # segundos: janela esquecida aberta se fecha sozinha
_pick_lock = threading.Lock()   # uma por vez; a segunda abriria atras da primeira


def _pergunta_pasta(inicial):
    """Abre o dialogo de pasta e devolve o caminho, ou '' se cancelou/expirou.

    Roda na thread do request (app.run(threaded=True)) e isso e seguro: o Tcl solta a GIL
    enquanto o dialogo esta aberto, entao o resto do hub continua respondendo normalmente.
    O timeout e um 'after' agendado ANTES de abrir - ele dispara mesmo com o modal nativo
    na tela, destroi o root, e o askdirectory volta '' igualzinho ao Cancelar.

    Funcao separada da rota de proposito: o teste troca ela e exercita a rota inteira sem
    abrir janela nenhuma.
    """
    import tkinter                  # importado aqui: sem tkinter o resto do hub roda igual
    from tkinter import filedialog
    root = None
    try:
        root = tkinter.Tk()
        root.withdraw()             # quero so o dialogo, nao a janela vazia do Tk
        root.attributes('-topmost', True)
        root.after(int(PICK_TIMEOUT * 1000), root.destroy)
        return str(filedialog.askdirectory(
            parent=root, title='Pasta padrao do BOM',
            initialdir=inicial or None,   # None o tkinter descarta; '' viraria -initialdir {}
            mustexist=True) or '')
    finally:
        if root is not None:
            try:
                root.destroy()      # se o timeout ja destruiu, tanto faz
            except Exception:
                pass


@app.route('/api/pick-dir', methods=['POST'])
def api_pick_dir():
    """Abre a janela de pasta do Windows NO PC DO SERVIDOR e devolve o caminho absoluto.

    So de localhost, pelo mesmo motivo do laser-open e do bom-save: o servidor escuta
    0.0.0.0, e abrir janela na maquina de quem hospeda nao pode ficar exposto a LAN.
    Nao grava nada - quem grava e o POST /api/config, que ja existe e ja e atomico.
    """
    if not _is_local(request):
        return {'ok': False, 'error': 'escolher a pasta so funciona no PC do servidor; '
                                      'digite o caminho a mao'}, 403
    if not _pick_lock.acquire(blocking=False):
        return {'ok': False, 'error': 'ja tem uma janela de pasta aberta no PC do servidor'}, 409
    try:
        inicial = _config_read().get('bomDir') or ''
        escolhido = _pergunta_pasta(inicial if os.path.isdir(inicial) else '')
    except ImportError:
        return {'ok': False, 'error': 'este Python nao tem tkinter; digite o caminho a mao'}, 501
    except Exception as e:
        # sem sessao grafica (servico do Windows, sessao desconectada) o Tk nem sobe
        return {'ok': False, 'error': 'nao consegui abrir a janela de pasta: %s' % e}, 500
    finally:
        _pick_lock.release()
    if not escolhido:
        # Cancelar e tempo esgotado caem aqui iguais; 200 porque nao houve falha nenhuma
        return {'ok': True, 'cancelado': True, 'dir': ''}
    return {'ok': True, 'dir': os.path.normpath(escolhido)}   # o Tcl devolve com barra normal


@app.route('/api/bom-save', methods=['POST'])
def api_bom_save():
    """Grava o BOM em qualquer pasta do disco do SERVIDOR.

    E o unico endpoint que escreve fora do workspace, entao carrega as mesmas travas do
    laser-open e mais uma: so de localhost (o servidor escuta 0.0.0.0 e escrever no disco
    nao pode ficar exposto a LAN), so .html, so nome de arquivo (nada de subpasta vinda do
    cliente) e a pasta tem que existir - ou, no maximo, ser criavel DENTRO de uma que ja
    existe. Sem isso um caminho digitado errado cria uma arvore inteira em silencio.
    """
    if not _is_local(request):
        return {'ok': False, 'error': 'salvar em pasta so funciona no PC do servidor; '
                                      'use "Baixar" de outra maquina'}, 403
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or 'name' not in data or 'content' not in data:
        return {'ok': False, 'error': 'JSON {name, content, dir?} obrigatorio'}, 400
    name = os.path.basename(str(data['name']))
    if not name.lower().endswith('.html') or name.startswith('.'):
        return {'ok': False, 'error': 'so .html'}, 403
    d = str(data.get('dir') or _config_read().get('bomDir') or '').strip().strip('"')
    if not d:
        return {'ok': False, 'error': 'sem pasta padrao configurada - use "Salvar como"'}, 400
    d = os.path.abspath(os.path.expanduser(d))
    if not os.path.isdir(d):
        pai = os.path.dirname(d)
        if not os.path.isdir(pai):
            return {'ok': False, 'error': 'a pasta nao existe e a de cima tambem nao: ' + d}, 400
        try:
            os.mkdir(d)
        except OSError as e:
            return {'ok': False, 'error': 'nao consegui criar a pasta: %s' % e}, 500
    full = os.path.join(d, name)
    tmp = full + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            f.write(str(data['content']))
        os.replace(tmp, full)
    except OSError as e:
        return {'ok': False, 'error': 'falha ao gravar: %s' % e}, 500
    return {'ok': True, 'path': full}


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

    Diferente do laser-open e do bom-save, este endpoint NAO e so-localhost: o hub e
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
            # senha em branco no formulario significa "nao mexe", nao "apaga"
            if k == 'senha' and not v:
                continue
            cfg[k] = v
    full = os.path.join(ROOT, ALMOX_CFG_FILE)
    tmp = full + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        os.replace(tmp, full)
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
