# Editor no browser — Fases 1+2 (persistência + sinalizadores) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Infra de persistência (serializadores puros + `hub-io.js` + `POST /api/save` no hubserver + reload escopado) e a camada de sinalizadores (`annotations.js` por projeto, UI nas vistas PCB e Esquema, contrato da IA no AI-GUIDE).

**Architecture:** Serializadores viram funções puras no `hub-core.js` (UMD, testáveis em node). `hub-io.js` novo decide POST (HTTP) vs download (file://). O hubserver ganha uma única rota de escrita com whitelist dura. As vistas ganham uma camada de marcadores desenhada por cima do conteúdo atual, com ferramenta de criação, painel lateral e botão salvar. O lado Altium só cria `annotations.js` vazio se não existir e adiciona a flag no índice.

**Tech Stack:** JS vanilla (sem libs, compatível file://), Python 3 + Flask (hubserver), DelphiScript (.pas), testes node com `assert` puro.

**Spec:** `docs/superpowers/specs/2026-08-04-editor-browser-sinalizadores-design.md` (aprovada). Este plano cobre as Fases 1 e 2; as Fases 3 (editor PCB + `comp_attr`) e 4 (editor Esquema) terão planos próprios após estas duas estarem commitadas.

## Global Constraints

- Arquivos de dados são JS com global (`var changes = [...]`), **um objeto JSON plano por linha** (`pts` é a única exceção de aninhamento, sempre numa linha só) — o parser DelphiScript lê linha a linha.
- Strings gravadas em `changes.js`/`schematic.js`/`annotations.js` não podem conter a sequência `":`.
- Chars > U+007D são escapados como `\uXXXX` na serialização (mesma convenção do `JS()` dos `.pas`).
- Tudo funciona em `file://`: sem `fetch` fora do `hub-io.js` (que só o usa em HTTP), sem modules, sem CDN.
- `board.js`, `Libs\*.js` e `projects.js` **nunca** são escritos pelo browser (donos: scripts `.pas`).
- Estilo JS do repo: IIFE + `"use strict"`, comentários PT-BR sem acento nos `.js` de dados.
- Testes: node puro com `require('assert')`, terminam com `console.log('test-X OK')`. Cadeia completa: `node tests/test-geom.js && node tests/test-apply.js && node tests/test-netextract.js && node tests/test-validate.js && node tests/test-serialize.js`.
- Commits com trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- `.pas` não compila fora do Altium — verificação é releitura cuidadosa + diff mínimo; o usuário valida rodando ExportPcb.

---

### Task 1: Serializadores no hub-core (`serializeChanges`, `serializeSchematic`, `serializeAnnotations`)

**Files:**
- Modify: `hub-core.js` (novas funções antes do `return` final, linha ~464; export no `return`)
- Create: `tests/test-serialize.js`

**Interfaces:**
- Produces: `HubCore.serializeChanges(changes) -> {text: string|null, errors: [{idx, msg}]}` — `text` null se houver erros. Idem `serializeSchematic(sch)` e `serializeAnnotations(list)`.

- [ ] **Step 1: Write the failing test** — criar `tests/test-serialize.js`:

```js
const assert = require('assert');
const { loadVar } = require('./load');
const Core = require('../hub-core.js');

/* ---- serializeChanges: round-trip com a fixture demo ---- */
const changes = loadVar('Projects/_DemoKit/changes.js', 'changes');
const out = Core.serializeChanges(changes);
assert.strictEqual(out.errors.length, 0);
assert.ok(out.text);
const reloaded = new Function(out.text + ';return changes;')();
assert.deepStrictEqual(reloaded, changes, 'round-trip changes deve preservar tudo');

/* formato: header + um objeto JSON por linha + fechamento */
const lines = out.text.trim().split('\n');
assert.ok(lines[0].startsWith('//'));
assert.strictEqual(lines[2], 'var changes = [');
assert.strictEqual(lines[lines.length - 1], '];');
for (let i = 3; i < lines.length - 1; i++) {
  assert.ok(lines[i].endsWith(','), 'linha de objeto termina com virgula');
  JSON.parse(lines[i].slice(0, -1)); // cada linha e JSON plano valido
}

/* recusa change incompleto: comp_move sem x/y (o parser Pascal moveria p/ (0,0)) */
const bad = Core.serializeChanges([{ op:'comp_move', ref:'R1', orig_x:1, orig_y:2, orig_rot:0, orig_layer:'Top' }]);
assert.strictEqual(bad.text, null);
assert.ok(bad.errors.some(e => /"x"/.test(e.msg)));

/* recusa op desconhecida e a sequencia proibida ": */
assert.ok(Core.serializeChanges([{ op:'zzz' }]).errors.length);
assert.ok(Core.serializeChanges([{ op:'via_add', x:1, y:1, size:0.6, drill:0.3, note:'a": b' }]).errors.length);

/* escapa nao-ASCII como \uXXXX */
const acc = Core.serializeChanges([{ op:'via_add', x:1, y:1, size:0.6, drill:0.3, note:'via de coração' }]);
assert.ok(acc.text.includes('\\u'));
assert.ok(!/[\u007e-\uffff]/.test(acc.text));

/* ---- serializeSchematic: round-trip com a fixture demo ---- */
const sch = loadVar('Projects/_DemoKit/schematic.js', 'schematic');
const so = Core.serializeSchematic(sch);
assert.strictEqual(so.errors.length, 0);
const schBack = new Function(so.text + ';return schematic;')();
assert.deepStrictEqual(schBack, sch, 'round-trip schematic deve preservar tudo');
const sl = so.text.trim().split('\n');
assert.strictEqual(sl[0], 'var schematic = {');
assert.strictEqual(sl[sl.length - 1], ']};');
/* recusa comp sem footprint */
const sbad = Core.serializeSchematic({ project:'X', items:[{ t:'comp', sheet:'main', ref:'R1', sym:'RES', x:100, y:100 }] });
assert.strictEqual(sbad.text, null);
assert.ok(sbad.errors.some(e => /footprint/.test(e.msg)));
/* recusa wire com pts curto */
assert.ok(Core.serializeSchematic({ project:'X', items:[{ t:'wire', sheet:'main', pts:[[0,0]] }] }).errors.length);

/* ---- serializeAnnotations ---- */
const anns = [
  { id:'n1', view:'pcb', x:12.5, y:8.3, layer:'Top', severity:'err', msg:'trilha muito proxima', ref:'', status:'open', created:'2026-08-04 10:00', reply:'' },
  { id:'n2', view:'sch', sheet:'main', x:2400, y:3400, severity:'warn', msg:'conferir pull-up', ref:'R3', status:'resolved', created:'2026-08-04 10:05', reply:'trocado para 10k' },
];
const ao = Core.serializeAnnotations(anns);
assert.strictEqual(ao.errors.length, 0);
const annBack = new Function(ao.text + ';return annotations;')();
assert.deepStrictEqual(annBack, anns);
/* recusa sem msg, view invalida, ": no texto */
assert.ok(Core.serializeAnnotations([{ id:'n1', view:'pcb', x:1, y:1, severity:'err', msg:'' }]).errors.length);
assert.ok(Core.serializeAnnotations([{ id:'n1', view:'xx', x:1, y:1, severity:'err', msg:'a' }]).errors.length);
assert.ok(Core.serializeAnnotations([{ id:'n1', view:'pcb', x:1, y:1, severity:'err', msg:'a": b' }]).errors.length);

console.log('test-serialize OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-serialize.js`
Expected: FAIL — `Core.serializeChanges is not a function`

- [ ] **Step 3: Write minimal implementation** — em `hub-core.js`, inserir antes do bloco `/* ============ status do projeto na esteira ============ */`:

```js
/* ============ serializacao (formato um-objeto-JSON-por-linha dos parsers .pas) ============ */

/* escapa >= U+007E como \uXXXX (mesma convencao do JS() dos scripts .pas, que escapa > 125) */
function jline(obj){
  return JSON.stringify(obj).replace(/[\u007e-\uffff]/g,
    c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));
}
function badStr(s){ return typeof s === 'string' && s.indexOf('":') >= 0; }

const CH_REQUIRED = {
  comp_move:       { num:['x','y','orig_x','orig_y','orig_rot'], str:['ref','orig_layer'] },
  track_edit:      { num:['orig_x1','orig_y1','orig_x2','orig_y2','orig_w'], str:['id','orig_layer'] },
  track_add:       { num:['x1','y1','x2','y2','w'], str:['layer'] },
  track_del:       { num:['orig_x1','orig_y1','orig_x2','orig_y2','orig_w'], str:['id','orig_layer'] },
  via_edit:        { num:['orig_x','orig_y'], str:['id'] },
  via_add:         { num:['x','y','size','drill'], str:[] },
  via_del:         { num:['orig_x','orig_y'], str:['id'] },
  arc_edit:        { num:['orig_cx','orig_cy','orig_r','orig_sa','orig_ea'], str:['id','orig_layer'] },
  arc_add:         { num:['cx','cy','r','sa','ea','w'], str:['layer'] },
  arc_del:         { num:['orig_cx','orig_cy','orig_r','orig_sa','orig_ea'], str:['id','orig_layer'] },
  text_edit:       { num:['orig_x','orig_y'], str:['id','orig_text','orig_layer'] },
  designator_move: { num:['orig_x','orig_y'], str:['ref'] },
  outline_set:     { num:[], str:[] },
};

function checkFields(objs, reqOf, kindOf, errors){
  objs.forEach((o, i) => {
    const req = reqOf(o);
    if (!req){ errors.push({ idx:i, msg:`${kindOf(o)}: tipo desconhecido` }); return; }
    for (const k of req.num) if (!isNum(o[k])) errors.push({ idx:i, msg:`${kindOf(o)}: campo "${k}" ausente/invalido` });
    for (const k of req.str) if (typeof o[k] !== 'string' || !o[k]) errors.push({ idx:i, msg:`${kindOf(o)}: campo "${k}" ausente` });
    for (const k in o) if (badStr(o[k])) errors.push({ idx:i, msg:`${kindOf(o)}: texto em "${k}" nao pode conter a sequencia aspas-dois-pontos` });
  });
}

function serializeChanges(changes){
  const list = Array.isArray(changes) ? changes : [];
  const errors = [];
  checkFields(list, ch => CH_REQUIRED[ch.op], ch => ch.op || '?', errors);
  list.forEach((ch, i) => {
    if (ch.op === 'outline_set' && (!Array.isArray(ch.pts) || ch.pts.length < 3 ||
        ch.pts.some(p => !Array.isArray(p) || !isNum(p[0]) || !isNum(p[1]))))
      errors.push({ idx:i, msg:'outline_set: pts deve ser [[x,y],...] com >= 3 vertices' });
    if (ch.op === 'track_add' && ch.w <= 0) errors.push({ idx:i, msg:'track_add: w deve ser > 0' });
    if (ch.op === 'via_add' && ch.drill >= ch.size) errors.push({ idx:i, msg:'via_add: drill deve ser < size' });
  });
  if (errors.length) return { text:null, errors };
  const L = ['// AltiumPCBMirror - arquivo de mudancas.',
             '// Edite ESTE arquivo (nunca o board.js). Um objeto JSON por linha. Consulte AI-GUIDE.md.',
             'var changes = ['];
  for (const ch of list) L.push(jline(ch) + ',');
  L.push('];');
  return { text: L.join('\n') + '\n', errors: [] };
}

const SCH_ITEM_REQUIRED = {
  sheet:    { num:[], str:['name','size'] },
  comp:     { num:['x','y'], str:['sheet','ref','sym','footprint'] },
  wire:     { num:[], str:['sheet'] },
  netlabel: { num:['x','y'], str:['sheet','net'] },
  power:    { num:['x','y'], str:['sheet','net','style'] },
  junction: { num:['x','y'], str:['sheet'] },
  text:     { num:['x','y'], str:['sheet','s'] },
};

function serializeSchematic(sch){
  if (!sch || typeof sch !== 'object') return { text:null, errors:[{ idx:-1, msg:'schematic ausente' }] };
  const errors = [];
  if (!sch.project) errors.push({ idx:-1, msg:'header: falta "project"' });
  const items = Array.isArray(sch.items) ? sch.items : [];
  checkFields(items, it => SCH_ITEM_REQUIRED[it.t], it => it.t || '?', errors);
  items.forEach((it, i) => {
    if (it.t === 'wire' && (!Array.isArray(it.pts) || it.pts.length < 2))
      errors.push({ idx:i, msg:'wire: pts precisa de >= 2 pontos' });
    if (it.t === 'comp' && it.rot != null && ![0, 90, 180, 270].includes((((it.rot % 360) + 360) % 360)))
      errors.push({ idx:i, msg:'comp: rot deve ser 0/90/180/270' });
  });
  if (errors.length) return { text:null, errors };
  const L = ['var schematic = {'];
  for (const k of Object.keys(sch)) if (k !== 'items') L.push(JSON.stringify(k) + ':' + jline(sch[k]) + ',');
  L.push('"items":[');
  for (const it of items) L.push(jline(it) + ',');
  L.push(']};');
  return { text: L.join('\n') + '\n', errors: [] };
}

const ANN_REQUIRED = { num:['x','y'], str:['id','severity','msg'] };

function serializeAnnotations(list){
  const anns = Array.isArray(list) ? list : [];
  const errors = [];
  checkFields(anns, () => ANN_REQUIRED, a => a.id || 'sinalizador', errors);
  anns.forEach((a, i) => {
    if (a.view !== 'pcb' && a.view !== 'sch') errors.push({ idx:i, msg:`${a.id || '?'}: view deve ser "pcb" ou "sch"` });
    if (a.view === 'sch' && (typeof a.sheet !== 'string' || !a.sheet)) errors.push({ idx:i, msg:`${a.id || '?'}: falta "sheet"` });
    if (!['err','warn','info'].includes(a.severity)) errors.push({ idx:i, msg:`${a.id || '?'}: severity deve ser err/warn/info` });
  });
  if (errors.length) return { text:null, errors };
  const L = ['// AltiumPCBMirror - sinalizadores do usuario para a IA. Um objeto JSON por linha.',
             '// A IA le, corrige via changes.js e marca status resolved + reply. Consulte AI-GUIDE.md Parte C.',
             'var annotations = ['];
  for (const a of anns) L.push(jline(a) + ',');
  L.push('];');
  return { text: L.join('\n') + '\n', errors: [] };
}
```

E no `return` final do hub-core.js, acrescentar à lista de exports:

```js
         serializeChanges, serializeSchematic, serializeAnnotations,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-serialize.js`
Expected: `test-serialize OK`

- [ ] **Step 5: Run full chain** — `node tests/test-geom.js && node tests/test-apply.js && node tests/test-netextract.js && node tests/test-validate.js && node tests/test-serialize.js` — tudo OK (nada existente pode quebrar).

- [ ] **Step 6: Commit**

```bash
git add hub-core.js tests/test-serialize.js
git commit -m "hub-core: serializadores de changes/schematic/annotations (um objeto por linha)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `hub-io.js` — camada de persistência do browser

**Files:**
- Create: `hub-io.js`
- Modify: `pcbframe.html` (script tag), `schframe.html` (script tag)

**Interfaces:**
- Produces: global `HubIO = { canPost, saveFile(relPath, content) -> Promise<{mode:'server'|'download'}>, download(filename, content) }`. `saveFile` rejeita com `Error` se o POST falhar.

- [ ] **Step 1: Create `hub-io.js`**:

```js
/* AltiumPCBMirror v2 - hub-io.js — persistencia do browser.
   Em HTTP (hubserver): POST /api/save grava direto no workspace.
   Em file:// (duplo clique): download do arquivo para substituir manualmente. */
(function (root) {
"use strict";
const canPost = location.protocol === 'http:' || location.protocol === 'https:';

function download(filename, content){
  const blob = new Blob([content], { type: 'text/javascript' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function saveFile(relPath, content){
  if (!canPost) { download(relPath.split('/').pop(), content); return { mode: 'download' }; }
  const r = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relPath, content })
  });
  if (!r.ok) {
    let msg = 'HTTP ' + r.status;
    try { const j = await r.json(); if (j && j.error) msg += ' — ' + j.error; } catch (e) {}
    throw new Error(msg);
  }
  return { mode: 'server' };
}

root.HubIO = { canPost, saveFile, download };
})(typeof self !== 'undefined' ? self : this);
```

- [ ] **Step 2: Incluir nos frames** — em `pcbframe.html`, trocar o bloco final de scripts:

```html
<script src="hub-core.js"></script>
<script src="hub-draw.js"></script>
<script src="hub-io.js"></script>
<script src="pcbframe.js"></script>
```

Em `schframe.html`, trocar a última linha de scripts (`<script src="schframe.js"></script>`) por:

```html
<script src="hub-io.js"></script>
<script src="schframe.js"></script>
```

- [ ] **Step 3: Verify** — `node --check hub-io.js` limpo (o await dentro de async é sintaxe válida; `node --check` só valida parse).

- [ ] **Step 4: Commit**

```bash
git add hub-io.js pcbframe.html schframe.html
git commit -m "hub-io.js: saveFile dual (POST no hubserver ou download em file://)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: hubserver — `POST /api/save` + reload escopado

**Files:**
- Modify: `hubserver.py` (import `request`/`json`, rota nova após `files()`, `LIVE_JS`)

**Interfaces:**
- Consumes: corpo JSON `{path, content}` enviado pelo `HubIO.saveFile` (Task 2).
- Produces: rota `POST /api/save` → 200 `{"ok":true}` | 400/403/404 `{"ok":false,"error":...}`; `LIVE_JS` chama `window.__hubOnChange()` se definido (páginas de edição definem o hook na Task 5).

- [ ] **Step 1: Editar `hubserver.py`** — (a) na linha de imports do Flask, acrescentar `request`:

```python
from flask import Flask, Response, abort, request, send_from_directory
```

(b) trocar o `LIVE_JS` inteiro por:

```python
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
```

(c) logo após a rota `files()` (final da função, antes de `def _lan_ip`), adicionar:

```python
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
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(str(data['content']))
    os.replace(tmp, full)
    return {'ok': True}
```

- [ ] **Step 2: Verify sintaxe** — `python -m py_compile hubserver.py` limpo.

- [ ] **Step 3: Verify comportamento** — subir `python hubserver.py --port 8765` em background e:
  - `curl.exe -s -X POST http://127.0.0.1:8765/api/save -H "Content-Type: application/json" -d "{\"path\":\"Projects/_DemoKit/annotations.js\",\"content\":\"var annotations = [\n];\n\"}"` → `{"ok":true}` e o arquivo `Projects\_DemoKit\annotations.js` existe com esse conteúdo.
  - POST com `"path":"Libs/schlib.js"` → HTTP 403.
  - POST com `"path":"Projects/../hubserver.py"` → HTTP 403 (o `..` não sobrevive ao split/safe_join → len ≠ 3 ou dotfile).
  - POST com `"path":"Projects/NaoExiste/changes.js"` → HTTP 404.
  - `curl.exe -s http://127.0.0.1:8765/__live.js` contém `__hubOnChange`.
  - Derrubar o servidor e **apagar** o `Projects\_DemoKit\annotations.js` criado no teste (a fixture demo não deve ganhar arquivo novo neste commit; ele voltará como fixture na Task 5).

- [ ] **Step 4: Commit**

```bash
git add hubserver.py
git commit -m "hubserver: POST /api/save (whitelist + escrita atomica) e reload escopado via __hubOnChange

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Lado Altium — `annotations.js` create-if-missing + flag no índice

**Files:**
- Modify: `ExportBoard.pas` (bloco novo após o do `changes.js`, ~linha 996; linha da flag em `RegenerateProjectsIndex`, ~linha 401)
- Modify: `ApplyChanges.pas` e `BuildSchematic.pas` (mesma linha da flag nas cópias de `RegenerateProjectsIndex`)

**Interfaces:**
- Produces: `Projects\<nome>\annotations.js` criado vazio no primeiro ExportPcb; `projects.js` ganha `"annotations":true|false` dentro de `files{}` (consumidor tolera a chave nova — `hub-ui.js` só lê as conhecidas).

- [ ] **Step 1: ExportBoard.pas — bloco create-if-missing** — logo após o bloco do `changes.js` (após a linha `OutL.SaveToFile(OutDir + '\changes.js'); end;`), inserir:

```pascal
  // ------------------------------------------------------------------ annotations.js (apenas se nao existir)
  if not FileExists(OutDir + '\annotations.js') then
  begin
    OutL.Clear;
    OutL.Add('// AltiumPCBMirror - sinalizadores do usuario para a IA. Um objeto JSON por linha.');
    OutL.Add('// A IA le, corrige via changes.js e marca status resolved + reply. Consulte AI-GUIDE.md Parte C.');
    OutL.Add('var annotations = [');
    OutL.Add('];');
    OutL.SaveToFile(OutDir + '\annotations.js');
  end;
```

- [ ] **Step 2: Flag no índice (3 arquivos)** — em `ExportBoard.pas`, `ApplyChanges.pas` e `BuildSchematic.pas`, dentro de `RegenerateProjectsIndex`, a linha

```pascal
      ',"changes":' + JB(FileExists(d + '\changes.js')) +
```

vira

```pascal
      ',"changes":' + JB(FileExists(d + '\changes.js')) +
      ',"annotations":' + JB(FileExists(d + '\annotations.js')) +
```

(mesma edição nas três cópias — os helpers são duplicados por design; conferir com `grep -n "annotations" *.pas` que as três apareceram).

- [ ] **Step 3: Verify** — releitura do diff (`git diff`): só os dois tipos de mudança acima, nada mais. Registrar no relatório da task que a validação real é o usuário rodar **ExportPcb** no Altium.

- [ ] **Step 4: Commit**

```bash
git add ExportBoard.pas ApplyChanges.pas BuildSchematic.pas
git commit -m "Scripts: annotations.js criado vazio no export (nunca sobrescrito) e flag no indice

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Vista PCB — carga, desenho e hit-test dos sinalizadores

**Files:**
- Modify: `pcbframe.html` (loader de `annotations.js`, CSS e seção do painel)
- Modify: `pcbframe.js` (estado, desenho, hit-test, hover/info, painel)
- Create: `Projects/_DemoKit/annotations.js` (fixture demo)

**Interfaces:**
- Consumes: global `annotations` (opcional) carregado pelo HTML.
- Produces: array mutável `ANN` (cópia rasa por item), `drawAnnotations()`, ramo `{kind:'ann', ann}` no `hitTest`, `buildAnnPanel()`, `ANN_COLORS = {err:'#ff5252', warn:'#ffd54f', info:'#4fc3f7'}` — a Task 6 usa `ANN`, `buildAnnPanel()` e `setAnnDirty()` (criada lá).

- [ ] **Step 1: Fixture demo** — criar `Projects/_DemoKit/annotations.js`:

```js
// AltiumPCBMirror - sinalizadores do usuario para a IA. Um objeto JSON por linha.
// A IA le, corrige via changes.js e marca status resolved + reply. Consulte AI-GUIDE.md Parte C.
var annotations = [
{"id":"n1","view":"pcb","x":9,"y":6,"layer":"Top","severity":"err","msg":"trilha muito proxima do pad","ref":"","status":"open","created":"2026-08-04 09:00","reply":""},
{"id":"n2","view":"sch","sheet":"main","x":2400,"y":3400,"severity":"info","msg":"exemplo no esquema","ref":"R1","status":"resolved","created":"2026-08-04 09:01","reply":"exemplo de resposta da IA"},
];
```

- [ ] **Step 2: Loader no `pcbframe.html`** — no bloco `document.write`, acrescentar a terceira linha em ambos os ramos (com `?p=` e sem):

```js
    document.write('<script src="Projects/' + PCB_P + '/annotations.js"><\/script>');
```

e no ramo `else`:

```js
    document.write('<script src="annotations.js"><\/script>');
```

(arquivo ausente vira 404 silencioso de script — o guard do Step 4 cobre).

- [ ] **Step 3: CSS + painel no `pcbframe.html`** — no `<style>`, após as regras de `.changeitem/.valitem`, adicionar:

```css
  .annitem{padding:4px 6px; margin:2px 0; border-radius:3px; background:var(--panel2);
    cursor:pointer; font-size:12px; border-left:3px solid transparent; word-break:break-word;}
  .annitem:hover{background:#383838;}
  .annitem.err{border-left-color:var(--err);}
  .annitem.warn{border-left-color:var(--warn);}
  .annitem.info{border-left-color:var(--accent);}
  .annitem.resolved{opacity:.5;}
  .annitem .annx{float:right; color:var(--fg-dim); padding:0 4px; cursor:pointer;}
  .annitem .annx:hover{color:var(--err);}
```

E no aside esquerdo, antes da seção "Objeto selecionado":

```html
    <div class="section"><h2>Sinalizadores (<span id="anncount">0</span>)</h2><div id="annlist"></div></div>
```

- [ ] **Step 4: Estado + desenho no `pcbframe.js`** — após a linha `const CH = ...` (linha 13), adicionar:

```js
const ANN = (typeof annotations !== 'undefined' && Array.isArray(annotations))
  ? annotations.map(a => ({ ...a })) : [];
const ANN_COLORS = { err:'#ff5252', warn:'#ffd54f', info:'#4fc3f7' };
```

Após `drawSelection()` (função, ~linha 386), adicionar:

```js
function drawAnnotations(){
  for (const a of ANN){
    if (a.view !== 'pcb') continue;
    const c = ANN_COLORS[a.severity] || ANN_COLORS.info;
    const s = 14 / view.scale;                      /* tamanho ~constante em px */
    ctx.save();
    ctx.globalAlpha = a.status === 'resolved' ? 0.45 : 1;
    ctx.strokeStyle = c; ctx.fillStyle = c;
    ctx.lineWidth = 2.2 / view.scale; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, a.y + s * 1.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.x, a.y + s * 1.6); ctx.lineTo(a.x + s * 1.1, a.y + s * 1.25);
    ctx.lineTo(a.x, a.y + s * 0.9); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(a.x, a.y, 2.5 / view.scale, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
```

Dentro de `draw()`, após a chamada `drawSelection();`, adicionar `drawAnnotations();`.

- [ ] **Step 5: Hit-test + hover + info** — no início de `hitTest(x,y)` (antes do loop de pads), adicionar (prioridade máxima):

```js
  for (const a of ANN){
    if (a.view === 'pcb' && Math.hypot(x - a.x, y - a.y) <= 12 / view.scale)
      return { kind:'ann', ann:a };
  }
```

Em `hoverLabel(m)`, adicionar antes do `return ''`:

```js
  if (m.kind==='ann') return `⚑ ${m.ann.id}: ${m.ann.msg}`;
```

Em `showInfo(m)`, antes do `else obj=...`, adicionar:

```js
  else if (m.kind==='ann') obj={ tipo:'sinalizador', ...m.ann };
```

Em `zoomToObj(m)`, antes do `else return;`, adicionar:

```js
  else if (m.kind==='ann'){ x=m.ann.x; y=m.ann.y; r=8; }
```

- [ ] **Step 6: Painel** — junto de `buildChangePanel()`, adicionar e chamar no init (após `buildChangePanel();`):

```js
function buildAnnPanel(){
  const list = document.getElementById('annlist');
  const mine = ANN.filter(a => a.view === 'pcb');
  document.getElementById('anncount').textContent = mine.length;
  list.innerHTML = mine.length ? '' : '<div style="color:var(--fg-dim)">nenhum — use a ferramenta Sinalizar</div>';
  for (const a of mine){
    const div = document.createElement('div');
    div.className = 'annitem ' + a.severity + (a.status === 'resolved' ? ' resolved' : '');
    const x = document.createElement('span');
    x.className = 'annx'; x.textContent = '✕'; x.title = 'apagar sinalizador';
    x.addEventListener('click', ev => { ev.stopPropagation(); annDelete(a); });
    div.appendChild(x);
    div.appendChild(document.createTextNode(
      `${a.id}: ${a.msg}` + (a.status === 'resolved' ? (a.reply ? ` ✓ ${a.reply}` : ' ✓') : '')));
    if (a.status === 'resolved'){
      const rb = document.createElement('span');
      rb.className = 'annx'; rb.textContent = '↺'; rb.title = 'reabrir';
      rb.addEventListener('click', ev => { ev.stopPropagation(); a.status = 'open'; a.reply = ''; annChanged(); });
      div.appendChild(rb);
    }
    div.addEventListener('click', () => { selected = { kind:'ann', ann:a }; showInfo(selected); zoomToObj(selected); });
    list.appendChild(div);
  }
}
function annDelete(a){ ANN.splice(ANN.indexOf(a), 1); annChanged(); }
function annChanged(){ setAnnDirty(true); buildAnnPanel(); draw(); }
```

(`setAnnDirty` chega na Task 6; para este commit compilar sozinho, declarar stub temporário `let setAnnDirty = () => {};` junto do estado — a Task 6 o substitui.)

- [ ] **Step 7: Verify** — `node --check pcbframe.js` limpo; abrir `pcbframe.html?p=_DemoKit` (duplo clique ou hubserver) e conferir: bandeira vermelha em (9,6), painel lista `n1` (e não o `n2`, que é do esquema), hover/clique/zoom funcionam, ✕ remove da lista.

- [ ] **Step 8: Commit**

```bash
git add pcbframe.html pcbframe.js Projects/_DemoKit/annotations.js
git commit -m "Vista PCB: camada de sinalizadores (desenho, hit-test, painel) + fixture demo

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Vista PCB — ferramenta Sinalizar, salvar, dirty/reload

**Files:**
- Modify: `pcbframe.html` (botões no header, formulário `#annform`)
- Modify: `pcbframe.js` (ferramenta, salvar, `__hubOnChange`, `beforeunload`, teclado)

**Interfaces:**
- Consumes: `ANN`, `buildAnnPanel()`, `annChanged()` (Task 5); `HubCore.serializeAnnotations` (Task 1); `HubIO.saveFile` (Task 2); global `PCB_P` (pcbframe.html).
- Produces: `setAnnDirty(bool)` (substitui o stub da Task 5); botão `#btnAnn` (toggle da ferramenta), `#btnAnnSave` (salvar).

- [ ] **Step 1: Header + formulário no `pcbframe.html`** — no `#header`, antes do botão CSV:

```html
  <button id="btnAnn"     title="Sinalizar problema para a IA (N)">⚑ Sinalizar</button>
  <button id="btnAnnSave" title="Salvar sinalizadores (annotations.js)">Salvar sinaliz.</button>
```

Dentro de `#canvaswrap`, após `<div id="fatal"></div>`:

```html
      <div id="annform" style="display:none; position:absolute; top:10px; right:10px; z-index:15;
           background:var(--panel2); border:1px solid var(--border); border-radius:4px; padding:8px; width:240px;">
        <textarea id="anntext" rows="2" placeholder="problema (ex: trilha muito proxima)"
          style="width:100%; background:var(--panel); color:var(--fg); border:1px solid var(--border);
                 border-radius:3px; font:12px 'Segoe UI',sans-serif; padding:4px; resize:vertical;"></textarea>
        <div style="display:flex; gap:6px; margin-top:6px; align-items:center;">
          <select id="annsev" style="background:var(--panel); color:var(--fg); border:1px solid var(--border); border-radius:3px; padding:2px;">
            <option value="err">vermelho (erro)</option>
            <option value="warn">amarelo (atenção)</option>
            <option value="info">azul (nota)</option>
          </select>
          <span style="flex:1"></span>
          <button id="annok">OK</button>
          <button id="anncancel">Cancelar</button>
        </div>
      </div>
```

- [ ] **Step 2: Ferramenta + salvar no `pcbframe.js`** — substituir o stub `let setAnnDirty = () => {};` da Task 5 por este bloco (após `annChanged()`):

```js
/* ------- ferramenta Sinalizar + persistencia ------- */
let annTool = false, annDirty = false, annPending = null;

function setAnnDirty(v){
  annDirty = v;
  const b = document.getElementById('btnAnnSave');
  b.classList.toggle('active', v);
  b.textContent = v ? 'Salvar sinaliz. *' : 'Salvar sinaliz.';
}
function setAnnTool(v){
  annTool = v;
  document.getElementById('btnAnn').classList.toggle('active', v);
  cv.style.cursor = v ? 'copy' : 'crosshair';
  if (!v) hideAnnForm();
}
function hideAnnForm(){ document.getElementById('annform').style.display = 'none'; annPending = null; }
function openAnnForm(w){
  annPending = { x: +w.x.toFixed(4), y: +w.y.toFixed(4) };
  document.getElementById('anntext').value = '';
  document.getElementById('annform').style.display = 'block';
  document.getElementById('anntext').focus();
}
function annNextId(){
  let mx = 0;
  for (const a of ANN){ const n = parseInt(String(a.id || '').replace(/^n/, ''), 10); if (isFinite(n) && n > mx) mx = n; }
  return 'n' + (mx + 1);
}
function nowStr(){
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
document.getElementById('annok').addEventListener('click', () => {
  const msg = document.getElementById('anntext').value.trim().replace(/"/g, "'");
  if (!msg || !annPending) return;
  ANN.push({ id: annNextId(), view: 'pcb', x: annPending.x, y: annPending.y,
             layer: view.flip ? 'Bottom' : 'Top', severity: document.getElementById('annsev').value,
             msg, ref: '', status: 'open', created: nowStr(), reply: '' });
  hideAnnForm(); annChanged();
});
document.getElementById('anncancel').addEventListener('click', hideAnnForm);

async function saveAnnotations(){
  const out = HubCore.serializeAnnotations(ANN);
  if (!out.text){ alert('Sinalizadores inválidos:\n' + out.errors.map(e => e.msg).join('\n')); return; }
  const rel = PCB_P ? 'Projects/' + PCB_P + '/annotations.js' : 'annotations.js';
  const sh = document.getElementById('shover');
  try {
    const r = await HubIO.saveFile(rel, out.text);
    setAnnDirty(false);
    sh.textContent = r.mode === 'server' ? '✓ sinalizadores salvos' : '↓ arquivo baixado — substitua ' + rel;
  } catch (err) {
    if (confirm('Salvar no servidor falhou: ' + err.message + '\nBaixar o arquivo em vez disso?'))
      HubIO.download('annotations.js', out.text);
  }
}
document.getElementById('btnAnn').addEventListener('click', () => setAnnTool(!annTool));
document.getElementById('btnAnnSave').addEventListener('click', saveAnnotations);

/* reload escopado do hubserver + aviso ao fechar com trabalho nao salvo */
window.__hubOnChange = function(){
  if (!annDirty){ location.reload(); return; }
  document.getElementById('shover').textContent = '⚠ workspace mudou — salve e recarregue (F5)';
};
window.addEventListener('beforeunload', e => { if (annDirty){ e.preventDefault(); e.returnValue = ''; } });
```

- [ ] **Step 3: Clique e teclado** — no handler de `click` do canvas, logo após `if (dragMoved) return;`, inserir:

```js
  if (annTool){ openAnnForm(screenToWorld(e.offsetX, e.offsetY)); return; }
```

No handler de `keydown`, adicionar aos `else if`:

```js
  else if (k==='n') setAnnTool(!annTool);
  else if (e.key==='Escape') setAnnTool(false);
```

(o guard `e.target.tagName==='INPUT'` existente não cobre `TEXTAREA`/`SELECT` do formulário — trocar a primeira linha do handler por `if (e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA' || e.target.tagName==='SELECT') return;`).

- [ ] **Step 4: Verify** — `node --check pcbframe.js`; manual: com `python hubserver.py` rodando, abrir `http://127.0.0.1:8000/pcbframe.html?p=_DemoKit`, criar sinalizador (N → clique → texto → OK) e conferir que **com edição não salva a página nunca recarrega sozinha** (o aviso "workspace mudou" aparece se algo mudar no disco); Salvar → `Projects\_DemoKit\annotations.js` atualizado no disco (o próprio save dispara o SSE ~1 s depois e, já sem edição pendente, a página recarrega mostrando o estado salvo — comportamento esperado); em `file://`, Salvar baixa o arquivo. Desfazer alterações da fixture demo após o teste manual (`git checkout -- Projects/_DemoKit/annotations.js` se o save de teste a mudou).

- [ ] **Step 5: Commit**

```bash
git add pcbframe.html pcbframe.js
git commit -m "Vista PCB: ferramenta Sinalizar (N), salvar annotations.js e reload escopado

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Vista Esquema — sinalizadores completos

**Files:**
- Modify: `schframe.html` (loader, botões, formulário, painel, CSS)
- Modify: `schframe.js` (desenho, ferramenta, painel, salvar, hooks)

**Interfaces:**
- Consumes: `HubCore.serializeAnnotations`, `HubIO.saveFile`, global `SCH_P` (schframe.html), `cam`/`drawWorld`/`hitTest` existentes.
- Produces: mesmos comportamentos da vista PCB, com `view:'sch'`, coordenadas em mil e campo `sheet` = nome da folha ativa.

- [ ] **Step 1: `schframe.html`** — (a) no bloco `document.write`, acrescentar:

```js
  document.write('<script src="Projects/' + SCH_P + '/annotations.js"><\/script>');
```

(b) no `#bar`, após o botão Grade:

```html
  <button id="btnAnn" title="Sinalizar problema para a IA (N)">⚑ Sinalizar</button>
  <button id="btnAnnSave" title="Salvar sinalizadores">Salvar sinaliz.</button>
```

(c) dentro de `#cvwrap`, após `<div id="fatal"></div>`, o mesmo `#annform` da Task 6 Step 1 (copiar o bloco HTML inteiro, idêntico).

(d) no `#side`, antes da seção Validação:

```html
    <div class="sec"><h2>Sinalizadores (<span id="anncount">0</span>)</h2><div id="annlist"></div></div>
```

(e) no `<style>`, após as regras `.valitem`:

```css
  .annitem{padding:3px 6px; margin:2px 0; border-radius:3px; background:var(--panel2);
    cursor:pointer; font-size:11px; border-left:3px solid transparent;}
  .annitem.err{border-left-color:var(--err);}
  .annitem.warn{border-left-color:var(--warn);}
  .annitem.info{border-left-color:var(--accent);}
  .annitem.resolved{opacity:.5;}
  .annitem .annx{float:right; color:var(--fg-dim); padding:0 4px; cursor:pointer;}
  .annitem .annx:hover{color:var(--err);}
```

- [ ] **Step 2: `schframe.js` — estado + desenho** — após a linha `const showState = { grid:true };`:

```js
const ANN = (typeof annotations !== 'undefined' && Array.isArray(annotations))
  ? annotations.map(a => ({ ...a })) : [];
const ANN_COLORS = { err:'#ff5252', warn:'#ffd54f', info:'#4fc3f7' };
let annTool = false, annDirty = false, annPending = null;
```

No final de `drawWorld(ctx, cam)` (após o loop dos `s.texts`), adicionar:

```js
  /* sinalizadores da folha ativa */
  for (const a of ANN){
    if (a.view !== 'sch' || a.sheet !== s.name) continue;
    const c = ANN_COLORS[a.severity] || ANN_COLORS.info;
    const sz = 16 / cam.scale;
    ctx.save();
    ctx.globalAlpha = a.status === 'resolved' ? 0.45 : 1;
    ctx.strokeStyle = c; ctx.fillStyle = c;
    ctx.lineWidth = 2.5 / cam.scale; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, a.y + sz * 1.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.x, a.y + sz * 1.6); ctx.lineTo(a.x + sz * 1.1, a.y + sz * 1.25);
    ctx.lineTo(a.x, a.y + sz * 0.9); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(a.x, a.y, 3 / cam.scale, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
```

- [ ] **Step 3: `schframe.js` — ferramenta, painel, salvar** — no `onClick` do `mkCamera`, como primeira linha:

```js
    if (annTool){ openAnnForm(w); return; }
```

Após a definição de `hitTest`, adicionar o bloco:

```js
/* ------- sinalizadores ------- */
function setAnnDirty(v){
  annDirty = v;
  const b = document.getElementById('btnAnnSave');
  b.classList.toggle('active', v);
  b.textContent = v ? 'Salvar sinaliz. *' : 'Salvar sinaliz.';
}
function setAnnTool(v){
  annTool = v;
  document.getElementById('btnAnn').classList.toggle('active', v);
  document.getElementById('cv').style.cursor = v ? 'copy' : 'crosshair';
  if (!v) hideAnnForm();
}
function hideAnnForm(){ document.getElementById('annform').style.display = 'none'; annPending = null; }
function openAnnForm(w){
  annPending = { x: Math.round(w.x), y: Math.round(w.y) };
  document.getElementById('anntext').value = '';
  document.getElementById('annform').style.display = 'block';
  document.getElementById('anntext').focus();
}
function annNextId(){
  let mx = 0;
  for (const a of ANN){ const n = parseInt(String(a.id || '').replace(/^n/, ''), 10); if (isFinite(n) && n > mx) mx = n; }
  return 'n' + (mx + 1);
}
function nowStr(){
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function annChanged(){ setAnnDirty(true); buildAnnPanel(); cam.draw(); }
function buildAnnPanel(){
  const list = document.getElementById('annlist');
  const mine = ANN.filter(a => a.view === 'sch');
  document.getElementById('anncount').textContent = mine.length;
  list.innerHTML = mine.length ? '' : '<div style="color:var(--fg-dim)">nenhum — use ⚑ Sinalizar</div>';
  for (const a of mine){
    const div = document.createElement('div');
    div.className = 'annitem ' + a.severity + (a.status === 'resolved' ? ' resolved' : '');
    const x = document.createElement('span');
    x.className = 'annx'; x.textContent = '✕'; x.title = 'apagar';
    x.addEventListener('click', ev => { ev.stopPropagation(); ANN.splice(ANN.indexOf(a), 1); annChanged(); });
    div.appendChild(x);
    div.appendChild(document.createTextNode(
      `${a.id} [${a.sheet}]: ${a.msg}` + (a.status === 'resolved' ? (a.reply ? ` ✓ ${a.reply}` : ' ✓') : '')));
    div.addEventListener('click', () => {
      const si = model.sheets.findIndex(sh => sh.name === a.sheet);
      if (si >= 0 && si !== sheetIdx){ sheetIdx = si; document.getElementById('sheetsel').value = si; }
      cam.fit({ x1: a.x - 900, y1: a.y - 900, x2: a.x + 900, y2: a.y + 900 });
    });
    list.appendChild(div);
  }
}
document.getElementById('annok').addEventListener('click', () => {
  const msg = document.getElementById('anntext').value.trim().replace(/"/g, "'");
  if (!msg || !annPending) return;
  ANN.push({ id: annNextId(), view: 'sch', sheet: model.sheets[sheetIdx].name,
             x: annPending.x, y: annPending.y, severity: document.getElementById('annsev').value,
             msg, ref: '', status: 'open', created: nowStr(), reply: '' });
  hideAnnForm(); annChanged();
});
document.getElementById('anncancel').addEventListener('click', hideAnnForm);
async function saveAnnotations(){
  const out = HubCore.serializeAnnotations(ANN);
  if (!out.text){ alert('Sinalizadores inválidos:\n' + out.errors.map(e => e.msg).join('\n')); return; }
  const rel = 'Projects/' + SCH_P + '/annotations.js';
  try {
    const r = await HubIO.saveFile(rel, out.text);
    setAnnDirty(false);
    document.getElementById('shover').textContent =
      r.mode === 'server' ? '✓ sinalizadores salvos' : '↓ arquivo baixado — substitua ' + rel;
  } catch (err) {
    if (confirm('Salvar no servidor falhou: ' + err.message + '\nBaixar o arquivo em vez disso?'))
      HubIO.download('annotations.js', out.text);
  }
}
document.getElementById('btnAnn').addEventListener('click', () => setAnnTool(!annTool));
document.getElementById('btnAnnSave').addEventListener('click', saveAnnotations);
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (k === 'n') setAnnTool(!annTool);
  else if (e.key === 'Escape') setAnnTool(false);
});
window.__hubOnChange = function(){
  if (!annDirty){ location.reload(); return; }
  document.getElementById('shover').textContent = '⚠ workspace mudou — salve e recarregue (F5)';
};
window.addEventListener('beforeunload', e => { if (annDirty){ e.preventDefault(); e.returnValue = ''; } });
```

E no init final (linha `buildSheetSel(); buildCompTable(); buildNetList(); buildValList();`), acrescentar `buildAnnPanel();`.

- [ ] **Step 4: Verify** — `node --check schframe.js`; manual: abrir `schframe.html?p=_DemoKit` — a fixture `n2` aparece como bandeira azul esmaeçida (resolved) na folha `main` com a resposta no painel; criar/apagar/salvar funcionam como na PCB.

- [ ] **Step 5: Commit**

```bash
git add schframe.html schframe.js
git commit -m "Vista Esquema: camada de sinalizadores (ferramenta, painel, salvar)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Documentação — AI-GUIDE Parte C + README

**Files:**
- Modify: `AI-GUIDE.md` (nova Parte C no final; nota de dois escritores na Parte B)
- Modify: `README.md` (seção de sinalizadores; rota de escrita no bloco do hubserver; estrutura do workspace)

- [ ] **Step 1: AI-GUIDE.md** — no final do arquivo, acrescentar:

```markdown
---

## Parte C — Sinalizadores (`annotations.js`)

O usuário marca problemas direto no hub (vista PCB ou Esquema) com bandeirinhas
coloridas; elas ficam em `Projects\<nome>\annotations.js` (um objeto JSON por linha):

```js
var annotations = [
{"id":"n1","view":"pcb","x":12.5,"y":8.3,"layer":"Top","severity":"err","msg":"trilha muito proxima","ref":"","status":"open","created":"2026-08-04 10:00","reply":""},
{"id":"n2","view":"sch","sheet":"main","x":2400,"y":3400,"severity":"warn","msg":"conferir pull-up","ref":"R3","status":"resolved","created":"2026-08-04 10:05","reply":"trocado para 10k"},
];
```

| Campo | Significado |
|---|---|
| `id` | estável (`n1`, `n2`…) — nunca reutilize nem renumere |
| `view` | `pcb` (x/y em **mm**, `layer`) ou `sch` (x/y em **mil**, `sheet`) |
| `severity` | `err` (vermelho) / `warn` (amarelo) / `info` (azul) |
| `msg` | texto do usuário descrevendo o problema |
| `ref` | opcional: componente âncora |
| `status` | `open` → `resolved` |
| `reply` | sua resposta ao resolver |

### Contrato (OBRIGATÓRIO para a sessão de IA)

1. **Antes de qualquer trabalho de PCB/esquema num projeto, leia
   `Projects\<nome>\annotations.js`** (se existir). Sinalizadores `open` são
   pendências do usuário para você.
2. Para cada um: corrija via `changes.js` (cada change com `note` referenciando o id,
   ex.: `"note":"n1: trilha afastada 0.4mm"`), depois mude `status` para `"resolved"`
   e escreva em `reply` o que foi feito.
3. **Nunca apague nem reescreva** sinalizadores do usuário — só altere `status`/`reply`.
   Quem apaga/reabre é o usuário, pelo hub.
4. **Dois escritores**: `changes.js`, `schematic.js` e `annotations.js` são editados
   por você **e** pelo usuário (pelo hub). Sempre **releia o arquivo antes de editar**
   e preserve as linhas existentes — nunca regenere do zero sem pedido explícito.
```

E no início da Parte B (após o parágrafo "Fluxo idêntico ao v1..."), acrescentar a nota:

```markdown
> **Dois escritores:** o usuário também edita `changes.js` pelo hub. Releia o arquivo
> antes de cada edição e preserve as linhas dele. E leia os sinalizadores
> (`annotations.js`, Parte C) antes de posicionar/rotear.
```

- [ ] **Step 2: README.md** — (a) na árvore da "Estrutura do workspace", acrescentar após a linha do `changes.js`:

```
│       ├── annotations.js   sinalizadores do usuário para a IA (bandeiras no hub)
```

(b) Na seção "Servidor local com tempo real (opcional)", acrescentar ao final:

```markdown
- Com o servidor rodando, o hub também **salva** arquivos direto no workspace
  (`POST /api/save`, restrito a `Projects\<nome>\{changes,schematic,annotations}.js`,
  escrita atômica). Sem servidor, os botões de salvar baixam o arquivo para você
  substituir manualmente.
```

(c) Nova seção antes de "Limitações e avisos":

```markdown
## Sinalizadores (usuário → IA)

Nas vistas **PCB** e **Esquema**, o botão **⚑ Sinalizar** (tecla `N`) deixa você marcar
problemas direto no desenho — ex.: bandeira vermelha "trilha muito próxima". As marcações
ficam em `Projects\<nome>\annotations.js` e a IA é obrigada (AI-GUIDE.md, Parte C) a
lê-las antes de trabalhar no projeto, corrigir via `changes.js` e responder marcando cada
uma como resolvida. Resolvidas aparecem esmaecidas com a resposta; você pode reabrir (↺)
ou apagar (✕). Severidades: vermelho (erro), amarelo (atenção), azul (nota). O export do
Altium cria o arquivo vazio uma única vez e nunca o sobrescreve.
```

- [ ] **Step 3: Commit**

```bash
git add AI-GUIDE.md README.md
git commit -m "Docs: Parte C (sinalizadores) no AI-GUIDE e secao no README

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Verificação final da cadeia

- [ ] **Step 1:** `node tests/test-geom.js && node tests/test-apply.js && node tests/test-netextract.js && node tests/test-validate.js && node tests/test-serialize.js` — 5× OK.
- [ ] **Step 2:** `node --check hub-core.js && node --check hub-io.js && node --check pcbframe.js && node --check schframe.js && node --check hub-ui.js && node --check hub-draw.js` — limpos.
- [ ] **Step 3:** `python -m py_compile hubserver.py` — limpo.
- [ ] **Step 4:** `git status` limpo (tudo commitado); `git log --oneline` mostra os 8 commits das tasks.
- [ ] **Step 5:** Registrar pendências de validação manual do usuário: (a) rodar **ExportPcb** no Altium e conferir `annotations.js` criado + flag no `projects.js`; (b) fluxo completo: sinalizar no hub → pedir correção à IA → conferir `status:"resolved"` + `reply`.
```
