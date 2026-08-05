# Hub v2 — nova interface conforme spec-implementacao.md — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruir a interface do hub conforme `docs/superpowers/specs/spec-implementacao.md`, sobre o design pronto em `example/hub.html` (HTML+CSS+JS puro, um arquivo): combobox de projetos, pipeline de 4 etapas, abas com Componentes/Nets/Footprints/Histórico, ações, e os renderers/editores existentes montados por iframe.

**Architecture:** O `example/hub.html` é a base — copia-se a casca/tokens/JS e troca-se a camada `API` pelos endpoints reais do `hubserver.py` (novos: `/api/index.json`, `/api/project/<id>.json`, `/api/run` + SSE), mantendo o fallback DEMO quando não há servidor. Os viewports Esquema/PCB montam `schframe.html?p=` / `pcbframe.html?p=` por **iframe** — preserva integralmente os editores das Fases 1-4 ("não reescreva o renderer"). O hub atual vira `hub-classic.html` (100% file://). O servidor parseia os arquivos `var X = {...}` em Python (comprovado: board/schematic/changes/pcblib, incluindo o projeto real MID com 166 comps/1431 trilhas).

**Tech Stack:** HTML+CSS+JS puro (sem framework/build), Python 3 + Flask.

**Spec:** `docs/superpowers/specs/spec-implementacao.md`. Checklist de aceite = §10 da spec.

## Adaptações de realidade (desvios documentados da spec)

1. **Ações Altium não são executáveis pelo servidor** — ExportLibs/BuildSchematic/ExportBoard/ApplyChanges/DRC são DelphiScript rodando DENTRO do Altium. Adaptação: só `Rescan` é `run:true`; as demais viram `run:false` (o botão primário abre o modal do fluxo na etapa certa) e o menu `⋮` mostra a invocação REAL (`no Altium: DXP » Run Script » <comando>`) em vez de comandos node fictícios. `POST /api/run` implementa o contrato: `Rescan` executa de verdade (com SSE); outra ação → 400 com mensagem explicando que roda no Altium.
2. **Renderer por iframe** — o viewport hospeda `schframe.html?p=`/`pcbframe.html?p=` (os frames têm zoom/pan/camadas/edição próprios). Botões `Ajustar`/`Camadas`/zoom flutuante do mock são omitidos; fica `Abrir em nova aba`. A integração de reload/dirty das Fases 1-4 continua: o hub novo define `window.__hubOnChange` que recarrega DADOS (index+detail) quando os iframes estão limpos (`__hubDirty`) e mostra a faixa de aviso quando sujos.
3. **Sem servidor** = dados DEMO (comportamento do próprio example). O hub clássico (`hub-classic.html`) continua 100% file:// e é o fallback documentado.
4. **Derivação de `stages`** (spec §4.1, ajustada ao mundo real onde projetos importados não têm schematic.js): `done = [schematic.js existe OU board.js existe, board.js existe, tracks>0, apply-report.txt mais novo que changes.js]`; `stages[i]=1` se `done[i]`; o primeiro não-done vira `2`; `noSchematic` continua = ausência de schematic.js (selo). `pending` = nº de ops no changes.js quando ele é mais novo que o apply-report (senão 0).
5. **history** — sintetizado dos artefatos (campo `generated` de board/schematic, mtime de build-report/apply-report) + `history.jsonl` por projeto (o `/api/run` grava as execuções dele; scripts futuros podem gravar também).

## Global Constraints

- **Nenhum hex fora do `:root`** (tokens da spec §3, já no example); cor só carrega status; destaque = branco a baixa opacidade; botões contornados; `:focus-visible` nunca removido.
- `html,body { overflow:hidden }`; só o painel da aba rola; nenhuma barra horizontal aninhada; `--page-min: 1040px`.
- Inter por `<link>` no `<head>` (já no example).
- `POST /api/run` valida a ação contra whitelist — **nunca** interpolar entrada do cliente em comando.
- `schframe.html`/`pcbframe.html`/`hub-core.js`/`hub-io.js`/`hub-draw.js` mudam O MÍNIMO (Task 1 herda 2 fixes; Task 6 expõe 1 hook por frame) — os editores das Fases 1-4 não podem regredir.
- Cadeia de verificação: `node tests/test-geom.js && node tests/test-apply.js && node tests/test-serialize.js` + `python tests/test_hubapi.py` (novo) + `node --check` nos .js tocados + `python -m py_compile hubserver.py` (validate/netextract falham pré-existente — não tocar).
- Commits com trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Herdados da Fase 4 (schframe)

**Files:**
- Modify: `schframe.js`

- [ ] **Step 1: exclusão mútua schTool × annTool** — em `setAnnTool(v)`: quando `v` for true, chamar `setSchTool('select')` antes de setar `annTool` (isso zera wireDraw/placeKind e esconde o schform); adicionalmente `placing = null;`. Em `setSchTool(t)`: quando `t !== 'select'` e `annTool`, chamar `setAnnTool(false)` primeiro (sem recursão: `setAnnTool(false)` não chama setSchTool). Conferir cursor final ('copy' quando qualquer ferramenta ativa).
- [ ] **Step 2: escape no painel Componentes** — em `buildCompTable`, trocar o `tr.innerHTML = \`<td>${c.ref}</td>...\`` por construção com `textContent` (4 `el('td', ...)`-style ou `document.createElement` + `textContent`), eliminando a injeção via ref renomeado.
- [ ] **Step 3: Verify** — `node --check schframe.js`; cadeia node OK.
- [ ] **Step 4: Commit** — `git add schframe.js` + mensagem `Vista Esquema: exclusao mutua entre ferramentas e sinalizador; escape no painel de componentes` + trailer.

---

### Task 2: hubserver — APIs de índice, detalhe e execução

**Files:**
- Modify: `hubserver.py`
- Create: `tests/test_hubapi.py`

**Interfaces:**
- Produces: `GET /api/index.json` (spec §4.1, com as derivações da Adaptação 4); `GET /api/project/<id>.json` (spec §4.2: components/nets/footprints/history/schematic/board); `POST /api/run` {project, action} → só `Rescan` executa (202 + runId; SSE em `/api/run/<id>/stream`), demais → 400 JSON com `hint` de como rodar no Altium; funções puras testáveis `load_var_file(path)`, `build_index(root)`, `build_detail(root, proj_id)`.

- [ ] **Step 1: parser + builders** — adicionar em `hubserver.py` (após as rotas atuais, antes de `_lan_ip`):

```python
import json
import re

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
```

- [ ] **Step 2: rotas** — após os builders:

```python
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
```

(`os`/`time` já são importados no topo do arquivo; `request`/`abort`/`Response` idem.)

- [ ] **Step 3: teste** — criar `tests/test_hubapi.py`:

```python
# Teste das funcoes puras do hubserver (rodar da raiz: python tests/test_hubapi.py)
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import hubserver as H

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

board = H.load_var_file(os.path.join(ROOT, 'Projects', '_DemoKit', 'board.js'))
assert isinstance(board, dict) and board.get('components'), 'board.js parseia'

idx = H.build_index(ROOT)
assert idx['projects'], 'indice tem projetos'
demo = next(p for p in idx['projects'] if p['name'] == '_DemoKit')
assert demo['demo'] is True and demo['noSchematic'] is False
assert len(demo['stages']) == 4 and demo['stats']['comps'] > 0
assert sum(1 for v in demo['stages'] if v == 2) <= 1, 'no maximo uma etapa atual'

det = H.build_detail(ROOT, demo['id'])
assert det and det['components'], 'detalhe tem componentes'
c = det['components'][0]
for k in ('des', 'value', 'footprint', 'pins', 'layer', 'pos', 'rot', 'nets'):
    assert k in c, 'campo ' + k
assert det['board'].get('components'), 'board embutido'
assert H.build_detail(ROOT, 'nao-existe') is None

print('test_hubapi OK')
```

- [ ] **Step 4: Verify** — `python -m py_compile hubserver.py && python tests/test_hubapi.py` → `test_hubapi OK`; subir o servidor numa porta alternativa e `curl.exe` em `/api/index.json` (JSON com os 4 projetos), `/api/project/<id>.json` do MID (166 comps), `POST /api/run` com `ExportBoard` → 400 com `hint`, com `Rescan` → 202 + SSE `done`. Derrubar o servidor e apagar `__pycache__`.
- [ ] **Step 5: Commit** — `hubserver: APIs de indice, detalhe e execucao (Rescan) para o hub v2` + trailer.

---

### Task 3: Shell do hub v2 (header + seletor + boot)

**Files:**
- Rename: `hub.html` → `hub-classic.html` (via `git mv`)
- Create: `hub.html` novo (a partir de `example/hub.html`)

- [ ] **Step 1:** `git mv hub.html hub-classic.html` (hub-ui.js e demais continuam usados por ele; nada mais muda no clássico).
- [ ] **Step 2:** copiar `example/hub.html` → `hub.html` e ajustar SOMENTE:
  - `API.index()`/`API.detail()` mantêm o fallback DEMO como está (a spec §4.4: sem índice → estado com comando de indexação; com o fallback DEMO do example, manter e acrescentar no gatilho do seletor a indicação `dados de demonstração` quando o fetch falhar: setar `S.demoMode = true` no catch e mostrar `(demo)` ao lado de `#projCount`).
  - Status do servidor (`.server`): o ponto vira `ok`/`err` conforme o `fetch` do índice (spec §5.1) — `S.serverOk`; o rótulo mostra `location.host` quando servido por HTTP, senão `sem servidor`.
  - Teclado do seletor: acrescentar `↑`/`↓`/`Enter` (spec §5.2 pede): manter um índice ativo em `S.pickerIdx`, `↑↓` movem (com wrap), `Enter` seleciona, digitação reseta para 0; o item ativo ganha a classe `active` e `scrollIntoView({block:'nearest'})`.
- [ ] **Step 3: Verify** — servir com `python hubserver.py` e abrir `http://127.0.0.1:8000/hub.html`: seletor lista os projetos REAIS (4), busca filtra, Ctrl+K/Esc/setas funcionam, ponto do servidor verde; abrir por `file://` cai no DEMO com `(demo)`. `hub-classic.html` abre como antes. (Verificação visual é pendência de usuário; o executor confere o que der por curl/DOM estático.)
- [ ] **Step 4: Commit** — `Hub v2: shell, seletor de projetos e boot com API real (hub antigo vira hub-classic)` + trailer.

---

### Task 4: Barra do projeto, pipeline, abas, fluxo e ações

**Files:**
- Modify: `hub.html`

- [ ] **Step 1: STEP/ACTIONS adaptados** — substituir as tabelas do example por:

```js
const STEP = {
  none:  { label: 'Pedir schematic.js',     flow: 1, run: false },
  0:     { label: 'BuildSchematic',         flow: 3, run: false },
  1:     { label: 'Compile + Update PCB',   flow: 4, run: false },
  2:     { label: 'ExportBoard',            flow: 5, run: false },
  3:     { label: 'ApplyChanges',           flow: 6, run: false },
  4:     { label: 'DRC',                    flow: 6, run: false },
};
const ACTIONS = [
  ['ExportLibs',     'no Altium: DXP » Run Script » ExportLibs'],
  ['BuildSchematic', 'no Altium: DXP » Run Script » ApplyProject'],
  ['ExportBoard',    'no Altium: DXP » Run Script » ExportPcb'],
  ['ApplyChanges',   'no Altium: DXP » Run Script » ApplyProject'],
  ['DRC',            'no Altium: Tools » Design Rule Check'],
  ['Rescan',         'reindexa Projects\\ agora (servidor)'],
];
const RUNNABLE = new Set(['Rescan']);
```

No menu `⋮` e no `runAction`: ação em `RUNNABLE` → `POST /api/run` + SSE + toasts como no example (com recarga de index+detail no `done`); ação fora → fechar o menu e abrir `openFlowDialog()` (o comando real já está visível no menu). O botão `ExportLibs` do header idem (abre o fluxo no passo 1). Sem servidor (`S.demoMode`), `Rescan` mostra toast `err` `sem servidor`. **Falha nunca é só um toast** (spec §6): `runAction` acumula as linhas do SSE num array e, no `catch`, além do toast `err`, mostra o log completo (`alert(lines.join('\n') || e.message)` serve como painel de log mínimo nesta versão).
- [ ] **Step 2:** manter `renderProjBar`/`renderTabs`/`renderPanes`/rodapé do fluxo/`openFlowDialog`/`openActionsMenu`/toasts do example como estão (eles já cumprem §5.3/5.4/5.10/6), conferindo: o destaque do rodapé usa `step.flow` (nunca o índice de etapas) e `#btnNext` + rodapé nunca discordam.
- [ ] **Step 3: hash/persistência** — já no example (`syncURL`/`readURL`/`localStorage`); conferir que aba e projeto sobrevivem a reload com servidor real.
- [ ] **Step 4: Verify** — com o servidor: MID mostra pipeline `[1,1,1,2]` com `ApplyChanges` no botão e passo 6 destacado; TCMS_Reader_V2 mostra `Compile + Update PCB`; PSU/projeto sem esquema (se houver) mostra `Pedir schematic.js`. `Rescan` roda de verdade (toast + recarga).
- [ ] **Step 5: Commit** — `Hub v2: pipeline, abas, fluxo e acoes (Rescan real; passos Altium documentados)` + trailer.

---

### Task 5: Abas de dados — Componentes, Nets, Footprints, Histórico

**Files:**
- Modify: `hub.html`

- [ ] **Step 1:** as quatro abas do example já renderizam do `S.detail` — validá-las contra os dados REAIS do endpoint (MID: 166 componentes com nets reais; nets com nós/trilhas/largura; footprints com desc/pads vindos da pcblib; histórico sintetizado). Ajustes obrigatórios:
  - `Exportar BOM` real: gerar TSV (`Designator\tValor\tFootprint\tPins`) das linhas FILTRADAS e baixar via Blob (`bom.csv`), substituindo o toast fake.
  - Contador `N de M` e filtro conforme example (já ok).
  - Histórico: `kind` `err` também mapeado (o example só mapeia warn/run/ok): `x.kind === 'err' ? 'err' : ...`.
- [ ] **Step 2: Verify** — com servidor: filtro responde com 166 linhas sem travar; painel de detalhe mostra pares e chips de nets; BOM baixa TSV com as linhas filtradas; footprints mostram uso real.
- [ ] **Step 3: Commit** — `Hub v2: abas de dados com endpoint real e exportacao de BOM` + trailer.

---

### Task 6: Esquema/PCB por iframe + integração dirty/seleção

**Files:**
- Modify: `hub.html`, `schframe.js`, `pcbframe.js`

- [ ] **Step 1: viewport com iframe** — em `canvasPane(kind)` do hub.html, no ponto de montagem marcado, substituir o placeholder por:

```js
    const vp = el('div', 'viewport');
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent';
    frame.src = (kind === 'pcb' ? 'pcbframe.html' : 'schframe.html') + '?p=' + encodeURIComponent(proj().name);
    frame.dataset.kind = kind;
    vp.append(frame); wrap.append(vp);
```

(remover os controles de zoom flutuantes; `right` fica só com `Abrir em nova aba`, que faz `window.open(frame.src)`.)

**Cache obrigatório dos panes de canvas** — os iframes NÃO podem ser reconstruídos a cada troca de aba (destruiria zoom e **edições não salvas** dos editores). Em `renderPanes`, o ramo esquema/pcb vira:

```js
  if (S.tab === 'esquema' || S.tab === 'pcb') {
    const pane = document.querySelector('.pane[data-pane="' + S.tab + '"]');
    if (pane.dataset.proj !== S.projId) {
      pane.textContent = '';
      pane.append(canvasPane(S.tab));
      pane.dataset.proj = S.projId;
    }
    return;
  }
```

(o pane só é reconstruído quando o PROJETO muda; trocar de aba apenas alterna a classe `.on`. O reload de dados dos frames em mudanças externas é responsabilidade do `__hubOnChange` DELES — o LIVE_JS é injetado também nos iframes.)
- [ ] **Step 2: dirty/reload** — no hub.html, definir:

```js
window.__hubOnChange = async function () {
  let dirty = false;
  document.querySelectorAll('iframe').forEach(f => {
    try { if (f.contentWindow && f.contentWindow.__hubDirty && f.contentWindow.__hubDirty()) dirty = true; } catch (e) {}
  });
  if (dirty) { toast('workspace mudou no disco — há edições não salvas numa vista', 'warn'); return; }
  const idx = await API.index(); S.projects = idx.projects;
  await loadProject(S.projId);
};
```

(o LIVE_JS injetado pelo hubserver chama esse hook; sem edição pendente o hub recarrega DADOS sem reload de página — os iframes recarregam junto via renderPanes.)
- [ ] **Step 3: “Ver no esquema / Ver no PCB”** — expor um hook mínimo nos frames: em `schframe.js`, junto de `__hubDirty`: `window.__hubSelectComp = function(ref){ setComp(ref); const s = model.sheets[sheetIdx]; const c = s && s.comps.find(c => c.ref === ref); if (c) cam.fit({ x1:c.x-800, y1:c.y-800, x2:c.x+800, y2:c.y+800 }); };` — e em `pcbframe.js`: `window.__hubSelectComp = function(ref){ const m = model.compByRef[ref]; if (m){ selected = m; showInfo(m); syncTableSel(); zoomToObj(m); } };`. No hub, os botões do painel de detalhe trocam de aba e, após o iframe carregar (`frame.onload` ou se já carregado), chamam `frame.contentWindow.__hubSelectComp(S.selDes)` em try/catch.
- [ ] **Step 4: Verify** — `node --check` nos 2 frames + hub servido: vista Esquema/PCB mostram os frames reais com edição funcionando; “Ver no PCB” abre a aba e seleciona o componente; com edição suja, evento de mudança mostra toast e NÃO recarrega.
- [ ] **Step 5: Commit** — `Hub v2: vistas Esquema/PCB por iframe com selecao cruzada e guarda de edicao` + trailer.

---

### Task 7: Docs + checklist de aceite + verificação final

**Files:**
- Modify: `README.md`, `AI-GUIDE.md`

- [ ] **Step 1: README** — atualizar a seção do hub: o hub novo (servido pelo hubserver; combobox, pipeline, abas, ações) e o `hub-classic.html` (duplo clique, 100% file://, vistas antigas + Libs). Nota: sem servidor o hub novo abre em modo demonstração.
- [ ] **Step 2: AI-GUIDE** — referências a "hub.html, vista Esquema/PCB" continuam válidas (os frames são os mesmos); acrescentar 1 linha: o hub novo é servido pelo `hubserver.py` e o clássico continua em `hub-classic.html`.
- [ ] **Step 3: checklist §10 da spec** — percorrer os 14 itens e registrar cada um (ok/pendência-visual) no relatório da task.
- [ ] **Step 4: Verificação final** — cadeia node + `python tests/test_hubapi.py` + `node --check` (hub não tem js externo novo; frames sim) + `py_compile`; `git status` limpo.
- [ ] **Step 5: Commit** — `Docs: hub v2 e hub classico no README/AI-GUIDE` + trailer.
