# hubserver.py (Flask + auto-reload) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servidor Flask opcional (`hubserver.py`, arquivo único na raiz) que serve o workspace na rede local e recarrega o browser automaticamente quando um export do Altium grava arquivos.

**Architecture:** Flask serve tudo estático com `Cache-Control: no-store`; uma thread revarre mtimes (`projects.js`, `Libs\`, `Projects\`) a cada 1 s e incrementa um contador; `/__events` (SSE) emite `change` quando o contador muda; todo `.html` servido ganha `<script src="/__live.js">` injetado antes do último `</body>` — nenhum arquivo do repo é editado. Spec: `docs/superpowers/specs/2026-08-03-hubserver-flask-design.md`.

**Tech Stack:** Python 3.11 + Flask 3.1.3 (já instalados na máquina; sem dependências novas). Repo em `z:\AltiumPCBMirror`, branch `v2-esquema`.

**Estado do working tree:** contém dados do usuário modificados/untracked (`Libs/*.js`, `projects.js`, `Libs/libs-report.txt`, `Projects/TCMS_Reader/`) — NUNCA tocar/stage/commitar esses arquivos.

---

### Task 1: Criar hubserver.py com smoke test

**Files:**
- Create: `hubserver.py`

- [ ] **Step 1: Escrever o arquivo completo**

Criar `hubserver.py` na raiz com exatamente:

```python
"""AltiumPCBMirror - hubserver.py
Servidor local OPCIONAL: serve o workspace (hub.html, Libs\\, Projects\\...) na rede
local e recarrega o browser sozinho quando um export do Altium grava arquivos.
Uso: python hubserver.py [--port 8000]
Aditivo: nao altera nenhum arquivo do hub; abrir hub.html por duplo clique segue igual.
"""
import argparse
import os
import socket
import threading
import time

from flask import Flask, Response, abort, send_from_directory
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
  es.addEventListener('change', function(){ location.reload(); });
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
```

- [ ] **Step 2: Compilar**

Run: `python -m py_compile hubserver.py`
Expected: sem saída, exit 0.

- [ ] **Step 3: Smoke test ao vivo** (porta 8123 para não colidir com um servidor do usuário)

De `z:\AltiumPCBMirror`, subir em background (`python hubserver.py --port 8123`), aguardar ~2 s e verificar:

```bash
curl -s http://127.0.0.1:8123/ | grep -c '__live.js'                       # >= 1 (injetado)
curl -s http://127.0.0.1:8123/ | grep -c '</body>'                          # 1 (HTML íntegro)
curl -sI http://127.0.0.1:8123/Libs/schlib.js | grep -i 'cache-control'     # no-store
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8123/Libs/schlib.js # 200
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8123/nao-existe     # 404
curl -s http://127.0.0.1:8123/__live.js | head -1                            # /* hubserver: ... */
curl -s http://127.0.0.1:8123/schframe.html | grep -c '__live.js'            # >= 1
```

SSE + watcher (o passo central): iniciar `curl -sN --max-time 8 http://127.0.0.1:8123/__events > sse.txt` em background no scratchpad, ~1 s depois `touch Projects/_DemoKit/changes.js` (muda só o mtime — conteúdo intacto, git não acusa nada), aguardar ~5 s e conferir `grep -c 'event: change' sse.txt` → ≥ 1.

Ao final, derrubar o servidor (matar o processo). Confirmar `git status --short` sem NENHUMA mudança além dos dados pré-existentes do usuário (o touch não altera conteúdo).

- [ ] **Step 4: Commit**

```bash
git add hubserver.py
git commit -m "hubserver.py: servidor Flask opcional com auto-reload SSE

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: README — seção do servidor local

**Files:**
- Modify: `README.md` (árvore de estrutura + nova seção antes de "## Fluxo projeto novo do zero")

- [ ] **Step 1: Linha na árvore** — logo APÓS a linha `├── AI-GUIDE.md              contrato/manual para a sessão de IA`, inserir:

```
├── hubserver.py             servidor local opcional (Flask; tempo real na rede)
```

- [ ] **Step 2: Nova seção** — imediatamente ANTES da linha `## Fluxo projeto novo do zero`, inserir:

```markdown
## Servidor local com tempo real (opcional)

O hub continua abrindo por **duplo clique**, sem servidor. Se quiser ver os exports em
**tempo real** (inclusive de outra máquina da rede local), rode na raiz do workspace:

    python hubserver.py

- Abra `http://127.0.0.1:8000` — ou `http://<IP-desta-máquina>:8000` de outro PC da
  rede (o servidor imprime as duas URLs ao subir; o Windows pode pedir liberação de
  firewall na primeira vez).
- Rodou um **Export** no Altium → a página aberta recarrega sozinha em ~1 s.
- `--port N` muda a porta. Requer Python 3 + Flask (`pip install flask`). O servidor
  não altera nenhum arquivo do hub.

```

- [ ] **Step 3: Conferir render** — `grep -n "hubserver" README.md` → 2 ocorrências (árvore + seção); a seção fica entre "## hub.html" e "## Fluxo projeto novo do zero".

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "README: secao do hubserver.py (servidor local opcional)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Verificação de aceite

- [ ] **Step 1:** `python -m py_compile hubserver.py` limpo; repetir o smoke do Task 1 Step 3 do zero (porta 8124) e derrubar ao final.
- [ ] **Step 2:** `git status --short` → apenas os dados pré-existentes do usuário; `git log --oneline -3` mostra os 2 commits novos sobre `b9b5b3f` (spec).
- [ ] **Step 3:** Registrar a pendência do usuário: rodar `python hubserver.py`, abrir de outra máquina, rodar um Export no Altium e ver a página recarregar.
