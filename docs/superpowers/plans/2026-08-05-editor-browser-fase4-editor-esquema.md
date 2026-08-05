# Editor no browser — Fase 4 (editor Esquema) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edição interativa na vista Esquema — adicionar componentes das libs espelhadas (picker com busca, símbolo + footprint lado a lado, ref sugerido), desenhar fios com snap à ponta quente dos pinos, colocar net labels/power ports/junctions/textos, mover/rotacionar/espelhar/apagar, propriedades por duplo clique e salvar `schematic.js` — fechando a última fase da spec.

**Architecture:** Mesmo padrão da Fase 3: mutar `schematic.items` (os objetos das folhas do modelo SÃO os itens — mutação direta é o preview) → `reapply()` re-roda `buildSchModel`/`extractNets`/`validateSchematic` → redesenha; o painel de validação existente acusa erros ao vivo. O `mkCamera` (hub-draw.js, compartilhado com a vista Libs) ganha hooks **opcionais** de arrasto de objeto (`onDragStart`/`onDrag`/`onDragEnd`) — sem hooks, comportamento idêntico ao atual. Undo/redo por snapshot de `schematic.items`. Salvar usa `HubCore.serializeSchematic` (Fase 1) + `HubIO` com a guarda de dois escritores.

**Tech Stack:** JS vanilla (file://-safe), testes node `assert`.

**Spec:** `docs/superpowers/specs/2026-08-04-editor-browser-sinalizadores-design.md` (seção Editor Esquema). Fases 1-3 entregues (`ade381c..a436177`).

## Global Constraints

- Esquema em **mil**, Y para cima, grade de **100 mil** obrigatória (snap em tudo; `validateSchematic` acusa fora-da-grade); rotação só 0/90/180/270 + `mirror`.
- **Fios devem terminar exatamente na ponta quente** dos pinos (`compPinsWorld`) — snap de ponta quente tem prioridade sobre grade e sobre orto.
- Formato `schmirror-v2`: um item JSON plano por linha (`pts` numa linha); toda gravação passa por `HubCore.serializeSchematic` (valida completude; `comp` exige `footprint`).
- `extractNets` é **preview** — a verdade é o compilador do Altium (não prometer netlist).
- Limitação documentada: para o Altium refletir edições em folha já construída, rodar **BuildSchematic com limpeza** (confirmação "SIM"); criar projeto novo pelo browser fica fora (projects.js é do indexador).
- `hub-draw.js` é compartilhado com a vista Libs — os hooks novos do `mkCamera` são opcionais e o comportamento sem eles fica byte-idêntico.
- `Libs\*.js` só leitura; `file://` continua funcionando (salvar = download).
- Cadeia de verificação: `node tests/test-geom.js && node tests/test-apply.js && node tests/test-serialize.js` (validate/netextract falham pré-existente — não tocar) + `node --check` nos .js tocados.
- Commits com trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Herança da Fase 3 + hooks de arrasto no mkCamera

**Files:**
- Modify: `pcbframe.js` (2 fixes parqueados), `hub-draw.js` (hooks opcionais no `mkCamera`)

**Interfaces:**
- Produces: `mkCamera(canvas, drawWorld, opts)` aceita `opts.onDragStart(w, e) -> boolean` (true = reivindica o arrasto: o pan NÃO acontece), `opts.onDrag(w, e)` (a cada mousemove reivindicado) e `opts.onDragEnd(moved)` (no mouseup). Sem os hooks, comportamento idêntico.

- [ ] **Step 1: pcbframe.js — fixes parqueados** — (a) em `saveChanges`, no ramo de sucesso, junto de `chDiskSnapshot = text;` acrescentar `staleWorkspace = false;`. (b) no handler de `propok`, como primeira coisa antes de ler valores:

```js
  const badField = Array.from(document.querySelectorAll('#proprows input[type=number]'))
    .find(el => el.value.trim() === '' || !isFinite(+el.value));
  if (badField){ alert('Valor numérico inválido no campo "' + badField.dataset.k + '"'); return; }
```

- [ ] **Step 2: hub-draw.js — hooks no mkCamera** — substituir o bloco de mouse (das declarações `let dragging = false...` até o listener de `click`, inclusive) por:

```js
  let dragging = false, lx = 0, ly = 0, moved = false, claimed = false;
  canvas.addEventListener('mousedown', e => {
    dragging = true; moved = false; lx = e.offsetX; ly = e.offsetY;
    claimed = !!(opts && opts.onDragStart && opts.onDragStart(toWorld(e.offsetX, e.offsetY), e));
  });
  window.addEventListener('mouseup', () => {
    if (dragging && claimed && opts && opts.onDragEnd) opts.onDragEnd(moved);
    dragging = false; claimed = false;
  });
  canvas.addEventListener('mousemove', e => {
    if (opts && opts.onMove) opts.onMove(toWorld(e.offsetX, e.offsetY), e);
    if (!dragging) return;
    moved = true;
    if (claimed){ if (opts && opts.onDrag) opts.onDrag(toWorld(e.offsetX, e.offsetY), e); return; }
    cam.cx -= (e.offsetX-lx)/cam.scale; cam.cy += (e.offsetY-ly)/cam.scale;
    lx = e.offsetX; ly = e.offsetY; draw();
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const w = toWorld(e.offsetX, e.offsetY);
    cam.scale *= (e.deltaY < 0 ? 1.18 : 1/1.18);
    cam.cx = w.x - (e.offsetX-W/2)/cam.scale;
    cam.cy = w.y + (e.offsetY-H/2)/cam.scale;
    draw();
    if (opts && opts.onZoom) opts.onZoom(cam);
  }, { passive: false });
  canvas.addEventListener('click', e => {
    if (moved) return;
    if (opts && opts.onClick) opts.onClick(toWorld(e.offsetX, e.offsetY), e);
  });
```

(único delta funcional além dos hooks: `moved = true` agora marca também arrastos reivindicados, suprimindo o click pós-arrasto — para pan puro o comportamento é o mesmo.)

- [ ] **Step 3: Verify** — `node --check hub-draw.js && node --check pcbframe.js`; `node tests/test-geom.js && node tests/test-apply.js && node tests/test-serialize.js` OK (hub-draw é UMD usado só no browser, mas o `module.exports` final continua válido).

- [ ] **Step 4: Commit**

```bash
git add pcbframe.js hub-draw.js
git commit -m "mkCamera: hooks opcionais de arrasto de objeto; pcbframe: fixes parqueados da fase 3

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: schframe — infra de edição (reapply, undo/redo, salvar esquema, dirty)

**Files:**
- Modify: `schframe.js`, `schframe.html` (botão Salvar esquema + barra de ferramentas vazia)

**Interfaces:**
- Produces (Tasks 3-6): `reapply()`; `commit()`; `undo()`/`redo()`; `schDirty`/`setSchDirty`; `saveSchematic()`; `snap100(v)`; `let selItem` (`{kind, item}` ou null); barra `#schtoolbar` (botões chegam nas Tasks 4-5); `schTool`/`setSchTool(t)` (state machine, só 'select' por enquanto).

- [ ] **Step 1: schframe.html** — logo após o fechamento do `#bar`, inserir:

```html
<div id="schtoolbar">
  <button id="toolSelect" class="active" title="Selecionar/mover (Esc)">Selecionar</button>
  <span class="sep"></span>
  <button id="btnSchSave" title="Salvar schematic.js">Salvar esquema</button>
</div>
```

CSS junto das regras do `#bar`:

```css
  #schtoolbar{display:flex; align-items:center; gap:8px; height:32px; padding:0 10px;
    background:var(--panel); border-bottom:1px solid var(--border); font-size:12px;}
  #schtoolbar .sep{width:1px; height:16px; background:var(--border);}
```

(o `body` é flex-column — a barra entra no fluxo sem ajuste de altura.)

- [ ] **Step 2: schframe.js — modelo re-aplicável** — trocar as três `const` por `let` (`model`, `nets`, `val`) e adicionar após elas:

```js
/* ------- infra de edicao ------- */
let selItem = null;                     /* { kind:'comp|wire|netlabel|power|junction|text', item } */
let schDirty = false, schDiskSnapshot = null;
let schTool = 'select';
const undoStack = [JSON.stringify(schematic.items)], redoStack = [];
function snap100(v){ return Math.round(v / 100) * 100; }

function updateMeta(){
  document.getElementById('meta').textContent =
    `${schematic.project} · ${model.sheets.length} folha(s) · ${nets.nets.length} nets`;
}
function reapply(){
  model = HubCore.buildSchModel(schematic);
  nets  = HubCore.extractNets(model, SLIB);
  val   = HubCore.validateSchematic(schematic, SLIB, PLIB);
  if (sheetIdx >= model.sheets.length) sheetIdx = 0;
  buildCompTable(); buildNetList(); buildValList(); updateMeta();
  cam.draw();
}
function setSchDirty(v){
  schDirty = v;
  const b = document.getElementById('btnSchSave');
  b.classList.toggle('active', v);
  b.textContent = v ? 'Salvar esquema *' : 'Salvar esquema';
}
function commit(){
  undoStack.push(JSON.stringify(schematic.items));
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  setSchDirty(true);
  reapply();
}
function restoreItems(json){
  schematic.items.length = 0;
  for (const it of JSON.parse(json)) schematic.items.push(it);
  selItem = null; selComp = null;
  setSchDirty(true);
  reapply();
}
function undo(){ if (undoStack.length < 2) return; redoStack.push(undoStack.pop()); restoreItems(undoStack[undoStack.length - 1]); }
function redo(){ if (!redoStack.length) return; const s = redoStack.pop(); undoStack.push(s); restoreItems(s); }
function setSchTool(t){
  schTool = t;
  document.getElementById('toolSelect').classList.toggle('active', t === 'select');
  document.getElementById('cv').style.cursor = t === 'select' ? 'crosshair' : 'copy';
}
document.getElementById('toolSelect').addEventListener('click', () => setSchTool('select'));

const SCH_REL = 'Projects/' + SCH_P + '/schematic.js';
(async () => { if (HubIO.canPost) try { schDiskSnapshot = await HubIO.fetchText(SCH_REL); } catch (e) {} })();

async function saveSchematic(){
  if (staleWorkspace && !confirm('O workspace mudou desde o carregamento — salvar vai sobrescrever o schematic.js do disco. Continuar?')) return;
  const out = HubCore.serializeSchematic(schematic);
  if (!out.text){ alert('Esquema inválido:\n' + out.errors.map(e => e.msg).join('\n')); return; }
  if (HubIO.canPost){
    try {
      const cur = await HubIO.fetchText(SCH_REL);
      if ((schDiskSnapshot === null || cur !== schDiskSnapshot) &&
          !confirm('schematic.js mudou no disco desde o carregamento (outro escritor — a IA?). Sobrescrever mesmo assim?')) return;
    } catch (e) {}
  }
  const msg = document.getElementById('annmsg');
  try {
    const r = await HubIO.saveFile(SCH_REL, out.text);
    setSchDirty(false);
    staleWorkspace = false;
    schDiskSnapshot = out.text;
    msg.textContent = r.mode === 'server' ? '✓ schematic.js salvo' : '↓ arquivo baixado — substitua ' + SCH_REL;
  } catch (err) {
    if (confirm('Salvar no servidor falhou: ' + err.message + '\nBaixar o arquivo em vez disso?'))
      HubIO.download('schematic.js', out.text);
  }
}
document.getElementById('btnSchSave').addEventListener('click', saveSchematic);
```

- [ ] **Step 3: dirty unificado** — `window.__hubDirty = function(){ return annDirty || schDirty; };`; `__hubOnChange` checa `annDirty || schDirty`; `beforeunload` idem.

- [ ] **Step 4: teclado** — no keydown existente, após o guard de INPUT/TEXTAREA/SELECT e o `const k`:

```js
  if (e.ctrlKey && k === 'z'){ e.preventDefault(); undo(); return; }
  if (e.ctrlKey && k === 'y'){ e.preventDefault(); redo(); return; }
```

- [ ] **Step 5: Verify** — `node --check schframe.js`; cadeia de testes OK.

- [ ] **Step 6: Commit**

```bash
git add schframe.js schframe.html
git commit -m "Vista Esquema: infra de edicao (reapply, undo/redo, salvar schematic.js com guarda)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Selecionar/mover/rotacionar/espelhar/apagar

**Files:**
- Modify: `schframe.js` (hitTest estendido, hooks de arrasto, teclado)

**Interfaces:**
- Consumes: hooks do mkCamera (Task 1), `commit()`/`snap100`/`selItem` (Task 2).
- Produces: `hitTest` devolve também `{kind:'netlabel'|'power'|'junction'|'text', item}` e inclui `item` nos hits de comp/wire; `dragState`.

- [ ] **Step 1: hitTest estendido** — substituir a função `hitTest` por:

```js
function hitTest(x, y){
  const s = model.sheets[sheetIdx];
  const tol = 8 / cam.cam.scale;
  for (const c of s.comps) {
    const pins = HubCore.compPinsWorld(c, SLIB) || [];
    for (const p of pins)
      if (Math.hypot(x - p.x, y - p.y) <= Math.max(tol, 30)) return { kind:'pin', ref:c.ref, num:p.num, item:c };
  }
  for (const j of s.junctions)
    if (Math.hypot(x - j.x, y - j.y) <= Math.max(tol, 35)) return { kind:'junction', item:j };
  for (const l of s.netlabels)
    if (x >= l.x - 20 && x <= l.x + Math.max((l.net || '').length * 40, 120) && y >= l.y - 20 && y <= l.y + 80)
      return { kind:'netlabel', item:l };
  for (const p of s.powers)
    if (Math.hypot(x - p.x, y - p.y) <= Math.max(tol, 140)) return { kind:'power', item:p };
  for (const t of s.texts)
    if (x >= t.x - 20 && x <= t.x + Math.max((t.s || '').length * (t.h || 10) * 4, 120) &&
        y >= t.y - (t.h || 10) * 4 && y <= t.y + (t.h || 10) * 4)
      return { kind:'text', item:t };
  for (let wi = 0; wi < s.wires.length; wi++) {
    const pts = s.wires[wi].pts || [];
    for (let i = 0; i < pts.length - 1; i++)
      if (HubCore.distSeg(x, y, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]) <= Math.max(tol, 20))
        return { kind:'wire', wi, item:s.wires[wi] };
  }
  for (const c of s.comps) {
    const sym = HubCore.symbolOf(SLIB, c.sym);
    const part = HubCore.partOf(sym, c.part);
    const bb = part ? D.symBBox(part) : { x1:-100, y1:-100, x2:100, y2:100 };
    const r = Math.max(bb.x2 - bb.x1, bb.y2 - bb.y1) / 2 + 50;
    if (Math.hypot(x - c.x, y - c.y) <= r) return { kind:'comp', ref:c.ref, item:c };
  }
  return null;
}
```

- [ ] **Step 2: arrasto via hooks** — no `mkCamera(...)`, acrescentar às opts (depois de `onClick`):

```js
  onDragStart: w => {
    if (annTool || schTool !== 'select') return false;
    const h = hitTest(w.x, w.y);
    if (!h || h.kind === 'pin') return false;
    const it = h.item;
    dragState = { kind:h.kind, item:it, start:w,
                  base: h.kind === 'wire' ? it.pts.map(p => [p[0], p[1]]) : { x:it.x, y:it.y } };
    selItem = { kind:h.kind, item:it };
    if (h.kind === 'comp'){ selComp = it.ref; buildCompTable(); }
    return true;
  },
  onDrag: w => {
    if (!dragState) return;
    const d = dragState, dx = w.x - d.start.x, dy = w.y - d.start.y;
    if (d.kind === 'wire'){
      const sx = snap100(d.base[0][0] + dx) - d.base[0][0], sy = snap100(d.base[0][1] + dy) - d.base[0][1];
      d.item.pts = d.base.map(p => [p[0] + sx, p[1] + sy]);
    } else {
      d.item.x = snap100(d.base.x + dx);
      d.item.y = snap100(d.base.y + dy);
    }
    cam.draw();
  },
  onDragEnd: moved => {
    const d = dragState; dragState = null;
    if (d && moved) commit();
  }
```

Declarar `let dragState = null;` junto de `selItem` (Task 2). No `onClick` existente, acrescentar a seleção de item: depois dos ramos atuais, `selItem = h && h.kind !== 'pin' ? { kind:h.kind, item:h.item } : (h && h.kind === 'pin' ? { kind:'comp', item:h.item } : null); cam.draw();` — e em `drawWorld`, destacar o selecionado não-comp com um retângulo tracejado laranja:

```js
  if (selItem && selItem.kind !== 'comp'){
    const it = selItem.item;
    ctx.save();
    ctx.strokeStyle = D.SCH.hl; ctx.setLineDash([20, 14]); ctx.lineWidth = 16 / cam.scale;
    if (selItem.kind === 'wire'){
      ctx.beginPath();
      (it.pts || []).forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.stroke();
    } else {
      ctx.strokeRect(it.x - 80, it.y - 80, 160, 160);
    }
    ctx.restore();
  }
```

- [ ] **Step 3: teclado** — no keydown, após os ramos Ctrl+Z/Y:

```js
  if (e.key === 'Delete' && selItem){
    const i = schematic.items.indexOf(selItem.item);
    if (i >= 0){ schematic.items.splice(i, 1); selItem = null; selComp = null; commit(); }
    return;
  }
  if (e.key === ' ' && selItem && selItem.kind === 'comp'){
    e.preventDefault();
    selItem.item.rot = (((selItem.item.rot || 0) + 90) % 360);
    if (dragState) cam.draw(); else commit();
    return;
  }
  if (k === 'x' && selItem && selItem.kind === 'comp'){
    selItem.item.mirror = !selItem.item.mirror;
    if (dragState) cam.draw(); else commit();
    return;
  }
```

E o ramo `Escape` existente ganha, antes do `setAnnTool(false)`:

```js
    if (dragState){
      const d = dragState; dragState = null;
      if (d.kind === 'wire') d.item.pts = d.base.map(p => [p[0], p[1]]);
      else { d.item.x = d.base.x; d.item.y = d.base.y; }
      cam.draw(); return;
    }
    selItem = null; setSchTool('select');
```

- [ ] **Step 4: Verify** — `node --check schframe.js`; cadeia OK. Manual (pendência de usuário): arrastar comp/fio/label com snap 100; Espaço/X; Delete; Ctrl+Z.

- [ ] **Step 5: Commit**

```bash
git add schframe.js
git commit -m "Vista Esquema: mover/rotacionar/espelhar/apagar itens com snap de 100 mil

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Adicionar componente — picker com busca e posicionamento contínuo

**Files:**
- Modify: `schframe.html` (dialog `#pickform`), `schframe.js` (picker, ghost, colocação)

**Interfaces:**
- Consumes: `commit()`, `snap100`, `setSchTool` (Tasks 2-3).
- Produces: `placing` (estado de posicionamento) — a Task 5 respeita a precedência dele no onClick; botão `#toolComp`.

- [ ] **Step 1: schframe.html** — botão na toolbar (após `#toolSelect`): `<button id="toolComp" title="Adicionar componente das libs (C)">+ Componente</button>`. Dialog dentro de `#cvwrap`, após `#annform`:

```html
      <div id="pickform" style="display:none; position:absolute; top:10px; left:10px; z-index:16;
           background:var(--panel2); border:1px solid var(--border); border-radius:4px; padding:8px; width:430px;">
        <input id="picksearch" placeholder="buscar símbolo (nome/descrição)" style="width:100%; background:var(--panel);
               color:var(--fg); border:1px solid var(--border); border-radius:3px; padding:4px; margin-bottom:6px;">
        <div id="picklist" style="max-height:140px; overflow-y:auto; margin-bottom:6px;"></div>
        <canvas id="pickpreview" width="414" height="150" style="width:100%; height:150px; background:#fffef2;
                border:1px solid var(--border); border-radius:3px; margin-bottom:6px;"></canvas>
        <div style="display:flex; gap:6px; margin-bottom:6px;">
          <label style="flex:1; font-size:11px; color:var(--fg-dim);">footprint
            <select id="pickfp" style="width:100%; background:var(--panel); color:var(--fg); border:1px solid var(--border); border-radius:3px; padding:3px;"></select></label>
          <label style="width:80px; font-size:11px; color:var(--fg-dim);">ref
            <input id="pickref" style="width:100%; background:var(--panel); color:var(--fg); border:1px solid var(--border); border-radius:3px; padding:3px;"></label>
          <label style="width:60px; font-size:11px; color:var(--fg-dim);">parte
            <select id="pickpart" style="width:100%; background:var(--panel); color:var(--fg); border:1px solid var(--border); border-radius:3px; padding:3px;"></select></label>
        </div>
        <input id="pickcomment" placeholder="comment (opcional, ex: 10k)" style="width:100%; background:var(--panel);
               color:var(--fg); border:1px solid var(--border); border-radius:3px; padding:4px; margin-bottom:6px;">
        <div style="display:flex; gap:6px; justify-content:flex-end;">
          <button id="pickok">Posicionar</button>
          <button id="pickcancel">Cancelar</button>
        </div>
      </div>
```

CSS junto das regras existentes:

```css
  .pickitem{padding:3px 6px; margin:1px 0; border-radius:3px; background:var(--panel2);
    cursor:pointer; font-size:11px;}
  .pickitem:hover{background:#383838;}
  .pickitem.sel{background:#0d47a1; color:#fff;}
```

- [ ] **Step 2: schframe.js — picker** — adicionar após o bloco de infra:

```js
/* ------- adicionar componente (picker) ------- */
let pickSym = null, placing = null, hoverW = null;

function refPrefixOf(name){
  const m = String(name || '').match(/^[A-Za-z]+/);
  return m ? m[0].toUpperCase() : 'U';
}
function allComps(){ const out = []; for (const s of model.sheets) for (const c of s.comps) out.push(c); return out; }
function nextRef(symName){
  const comps = allComps();
  const same = comps.filter(c => c.sym === symName);
  let prefix = same.length ? refPrefixOf(same[0].ref) : refPrefixOf(symName).slice(0, 1);
  let mx = 0;
  for (const c of comps){
    const m = String(c.ref).match(/^([A-Za-z]+)(\d+)$/);
    if (m && m[1].toUpperCase() === prefix && +m[2] > mx) mx = +m[2];
  }
  return prefix + (mx + 1);
}
function buildPickList(){
  const q = document.getElementById('picksearch').value.trim().toLowerCase();
  const list = document.getElementById('picklist');
  list.innerHTML = '';
  const syms = (SLIB.symbols || []).filter(s =>
    !q || s.name.toLowerCase().includes(q) || String(s.description || '').toLowerCase().includes(q)).slice(0, 60);
  for (const s of syms){
    const div = document.createElement('div');
    div.className = 'pickitem' + (pickSym === s ? ' sel' : '');
    div.textContent = s.name + (s.description ? ' — ' + s.description : '');
    div.addEventListener('click', () => selectPickSym(s));
    list.appendChild(div);
  }
  if (!syms.length) list.innerHTML = '<div style="color:var(--fg-dim); font-size:11px;">nada encontrado</div>';
}
function selectPickSym(s){
  pickSym = s;
  buildPickList();
  const fps = document.getElementById('pickfp');
  fps.innerHTML = '';
  const names = new Set();
  for (const f of (s.footprints || [])) if (f.name) names.add(f.name);
  for (const f of (PLIB.footprints || [])) names.add(f.name);
  const cur = (s.footprints || []).find(f => f.current);
  for (const n of names){
    const o = document.createElement('option');
    o.textContent = n;
    if (cur && n === cur.name) o.selected = true;
    fps.appendChild(o);
  }
  const parts = document.getElementById('pickpart');
  parts.innerHTML = '';
  const pc = s.partcount || (s.parts || []).length || 1;
  for (let i = 1; i <= pc; i++){ const o = document.createElement('option'); o.textContent = i; parts.appendChild(o); }
  document.getElementById('pickref').value = nextRef(s.name);
  drawPickPreview();
}
function drawPickPreview(){
  const pcv = document.getElementById('pickpreview');
  const pctx = pcv.getContext('2d');
  pctx.setTransform(1, 0, 0, 1, 0, 0);
  pctx.fillStyle = '#fffef2';
  pctx.fillRect(0, 0, pcv.width, pcv.height);
  if (!pickSym) return;
  const part = HubCore.partOf(pickSym, +document.getElementById('pickpart').value || 1);
  if (part){
    const bb = D.symBBox(part);
    const sc = Math.min((pcv.width/2 - 16) / Math.max(bb.x2 - bb.x1, 1), (pcv.height - 16) / Math.max(bb.y2 - bb.y1, 1));
    pctx.setTransform(sc, 0, 0, -sc, pcv.width/4 - (bb.x1 + bb.x2)/2 * sc, pcv.height/2 + (bb.y1 + bb.y2)/2 * sc);
    D.drawSymbolPart(pctx, part, { showPinNums:false });
  }
  const fp = HubCore.footprintOf(PLIB, document.getElementById('pickfp').value);
  if (fp && fp.bbox){
    const fb = fp.bbox;
    const sc = Math.min((pcv.width/2 - 16) / Math.max(fb.x2 - fb.x1, 0.5), (pcv.height - 16) / Math.max(fb.y2 - fb.y1, 0.5));
    pctx.setTransform(sc, 0, 0, -sc, pcv.width*3/4 - (fb.x1 + fb.x2)/2 * sc, pcv.height/2 + (fb.y1 + fb.y2)/2 * sc);
    pctx.fillStyle = '#1b1b1b';
    pctx.fillRect(fb.x1 - 2, fb.y1 - 2, (fb.x2 - fb.x1) + 4, (fb.y2 - fb.y1) + 4);
    D.drawFootprint(pctx, fp, { showPadNames:false });
  }
}
function openPicker(){
  document.getElementById('pickform').style.display = 'block';
  buildPickList();
  document.getElementById('picksearch').focus();
}
function closePicker(){ document.getElementById('pickform').style.display = 'none'; }
document.getElementById('picksearch').addEventListener('input', buildPickList);
document.getElementById('pickfp').addEventListener('change', drawPickPreview);
document.getElementById('pickpart').addEventListener('change', drawPickPreview);
document.getElementById('toolComp').addEventListener('click', openPicker);
document.getElementById('pickcancel').addEventListener('click', closePicker);
document.getElementById('pickok').addEventListener('click', () => {
  if (!pickSym) return;
  const ref = document.getElementById('pickref').value.trim();
  if (!ref){ alert('Informe o ref.'); return; }
  placing = { sym:pickSym.name, part:+document.getElementById('pickpart').value || 1,
              footprint:document.getElementById('pickfp').value, ref,
              comment:document.getElementById('pickcomment').value.trim().replace(/"/g, "'"),
              rot:0, mirror:false };
  closePicker();
  document.getElementById('cv').style.cursor = 'copy';
});
function placeComp(w){
  const c = { t:'comp', sheet:model.sheets[sheetIdx].name, ref:placing.ref, sym:placing.sym,
              x:snap100(w.x), y:snap100(w.y), rot:placing.rot, footprint:placing.footprint };
  if (placing.part !== 1) c.part = placing.part;
  if (placing.mirror) c.mirror = true;
  if (placing.comment) c.comment = placing.comment;
  schematic.items.push(c);
  const m = placing.ref.match(/^([A-Za-z]+)(\d+)$/);
  placing.ref = m ? m[1] + (+m[2] + 1) : placing.ref + '2';
  commit();
}
```

- [ ] **Step 3: ghost + integração** — em `drawWorld`, após o bloco dos sinalizadores:

```js
  /* ghost do componente em colocacao */
  if (placing && hoverW){
    const sym = HubCore.symbolOf(SLIB, placing.sym);
    const part = HubCore.partOf(sym, placing.part);
    if (part){
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.translate(snap100(hoverW.x), snap100(hoverW.y));
      ctx.rotate((placing.rot % 360) * Math.PI / 180);
      if (placing.mirror) ctx.scale(-1, 1);
      D.drawSymbolPart(ctx, part, {});
      ctx.restore();
    }
  }
```

No `onMove` do mkCamera, primeira linha: `hoverW = w; if (placing) cam.draw();`. No `onClick`, logo após o intercept do `annTool`: `if (placing){ placeComp(w); return; }`. No keydown: Espaço/X durante colocação (antes dos ramos de selItem):

```js
  if (e.key === ' ' && placing){ e.preventDefault(); placing.rot = (placing.rot + 90) % 360; cam.draw(); return; }
  if (k === 'x' && placing){ placing.mirror = !placing.mirror; cam.draw(); return; }
  if (k === 'c' && !placing){ openPicker(); return; }
```

E o ramo Escape ganha, antes do cancelamento de drag: `if (placing){ placing = null; document.getElementById('cv').style.cursor = 'crosshair'; cam.draw(); return; }` e também `if (document.getElementById('pickform').style.display === 'block'){ closePicker(); return; }`.

- [ ] **Step 4: Verify** — `node --check schframe.js`; cadeia OK. Manual (pendência): buscar símbolo, prévia com footprint, colocar 2 seguidos (ref auto-incrementa), Espaço/X durante colocação, validação viva acusa footprint divergente.

- [ ] **Step 5: Commit**

```bash
git add schframe.html schframe.js
git commit -m "Vista Esquema: picker de componentes das libs com ghost e colocacao continua

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Fio + net label + power + junção + texto

**Files:**
- Modify: `schframe.html` (botões + mini-forms), `schframe.js` (ferramentas)

**Interfaces:**
- Consumes: `setSchTool`/`schTool`, `commit()`, `snap100`, `hoverW`, precedência do `placing` (Task 4).
- Produces: ferramentas `wire`/`netlabel`/`power`/`junction`/`text` na state machine.

- [ ] **Step 1: schframe.html** — na toolbar, após `#toolComp`:

```html
  <button id="toolWire" title="Desenhar fio (W); botão direito/Esc encerra">Fio</button>
  <button id="toolLabel" title="Net label">Label</button>
  <button id="toolPower" title="Power port">Power</button>
  <button id="toolJunction" title="Junção">Junção</button>
  <button id="toolText" title="Texto">Texto</button>
```

Mini-form dentro de `#cvwrap` após `#pickform`:

```html
      <div id="schform" style="display:none; position:absolute; top:10px; right:10px; z-index:16;
           background:var(--panel2); border:1px solid var(--border); border-radius:4px; padding:8px; width:220px;">
        <div id="schformtitle" style="color:var(--accent); font-size:12px; margin-bottom:6px;"></div>
        <input id="schformtext" placeholder="" style="width:100%; background:var(--panel); color:var(--fg);
               border:1px solid var(--border); border-radius:3px; padding:4px; margin-bottom:6px;">
        <select id="schformstyle" style="display:none; width:100%; background:var(--panel); color:var(--fg);
               border:1px solid var(--border); border-radius:3px; padding:3px; margin-bottom:6px;">
          <option>Bar</option><option>Circle</option><option>Arrow</option><option>Wave</option>
          <option>GndPower</option><option>GndSignal</option><option>GndEarth</option>
        </select>
        <div style="display:flex; gap:6px; justify-content:flex-end;">
          <button id="schformok">Posicionar</button>
          <button id="schformcancel">Cancelar</button>
        </div>
      </div>
```

- [ ] **Step 2: schframe.js — ferramentas** — adicionar após o bloco do picker:

```js
/* ------- fio / label / power / juncao / texto ------- */
let wireDraw = null;          /* { pts:[[x,y],...] } */
let placeKind = null;         /* 'netlabel'|'power'|'text' apos OK do schform */
let placeData = null;

function hotSnap(w){
  const s = model.sheets[sheetIdx];
  for (const c of s.comps){
    const pins = HubCore.compPinsWorld(c, SLIB) || [];
    for (const p of pins)
      if (Math.hypot(w.x - p.x, w.y - p.y) <= 60) return { x:p.x, y:p.y, hot:true };
  }
  return null;
}
function wirePoint(w){
  const hs = hotSnap(w);
  if (hs) return [hs.x, hs.y];
  const gx = snap100(w.x), gy = snap100(w.y);
  if (!wireDraw || !wireDraw.pts.length) return [gx, gy];
  const last = wireDraw.pts[wireDraw.pts.length - 1];
  /* ortogonal: segue o eixo dominante a partir do ultimo ponto */
  return (Math.abs(gx - last[0]) >= Math.abs(gy - last[1])) ? [gx, last[1]] : [last[0], gy];
}
function endWire(){
  if (wireDraw && wireDraw.pts.length >= 2){
    schematic.items.push({ t:'wire', sheet:model.sheets[sheetIdx].name, pts:wireDraw.pts });
    wireDraw = null;
    commit();
  } else { wireDraw = null; cam.draw(); }
}
function openSchForm(kind){
  placeKind = null; placeData = null;
  const f = document.getElementById('schform');
  document.getElementById('schformtitle').textContent =
    kind === 'netlabel' ? 'Net label' : kind === 'power' ? 'Power port' : 'Texto';
  document.getElementById('schformtext').placeholder = kind === 'text' ? 'texto' : 'nome da net (ex: GND)';
  document.getElementById('schformtext').value = '';
  document.getElementById('schformstyle').style.display = kind === 'power' ? 'block' : 'none';
  f.style.display = 'block';
  f.dataset.kind = kind;
  document.getElementById('schformtext').focus();
}
document.getElementById('schformok').addEventListener('click', () => {
  const f = document.getElementById('schform');
  const v = document.getElementById('schformtext').value.trim().replace(/"/g, "'");
  if (!v) return;
  placeKind = f.dataset.kind;
  placeData = { v, style:document.getElementById('schformstyle').value };
  f.style.display = 'none';
  document.getElementById('cv').style.cursor = 'copy';
});
document.getElementById('schformcancel').addEventListener('click', () => {
  document.getElementById('schform').style.display = 'none'; setSchTool('select');
});
function placeAt(w){
  const sheet = model.sheets[sheetIdx].name;
  const x = snap100(w.x), y = snap100(w.y);
  if (placeKind === 'netlabel') schematic.items.push({ t:'netlabel', sheet, net:placeData.v, x, y, rot:0 });
  else if (placeKind === 'power') schematic.items.push({ t:'power', sheet, net:placeData.v, style:placeData.style, x, y, rot:0 });
  else if (placeKind === 'text') schematic.items.push({ t:'text', sheet, s:placeData.v, x, y, h:10 });
  commit();
}
for (const [id, kind] of [['toolWire','wire'], ['toolLabel','netlabel'], ['toolPower','power'],
                          ['toolJunction','junction'], ['toolText','text']])
  document.getElementById(id).addEventListener('click', () => {
    setSchTool(kind);
    if (kind === 'netlabel' || kind === 'power' || kind === 'text') openSchForm(kind);
  });
```

- [ ] **Step 3: integração** — `setSchTool` passa a marcar os botões todos e limpar estados:

```js
function setSchTool(t){
  schTool = t;
  wireDraw = null; placeKind = null; placeData = null;
  document.getElementById('schform').style.display = 'none';
  for (const [id, name] of [['toolSelect','select'], ['toolWire','wire'], ['toolLabel','netlabel'],
                            ['toolPower','power'], ['toolJunction','junction'], ['toolText','text']])
    document.getElementById(id).classList.toggle('active', schTool === name);
  document.getElementById('cv').style.cursor = t === 'select' ? 'crosshair' : 'copy';
  cam.draw();
}
```

No `onClick` do mkCamera, após o intercept do `placing` (Task 4):

```js
    if (schTool === 'wire'){ if (!wireDraw) wireDraw = { pts:[] }; wireDraw.pts.push(wirePoint(w)); cam.draw(); return; }
    if (schTool === 'junction'){ schematic.items.push({ t:'junction', sheet:model.sheets[sheetIdx].name, x:snap100(w.x), y:snap100(w.y) }); commit(); return; }
    if ((schTool === 'netlabel' || schTool === 'power' || schTool === 'text') && placeKind){ placeAt(w); return; }
```

No `onMove`: `if (wireDraw) cam.draw();` junto do `if (placing)`. Em `drawWorld`, após o ghost do placing:

```js
  /* fio em desenho (rubber-band) */
  if (wireDraw && wireDraw.pts.length && hoverW){
    ctx.save();
    ctx.strokeStyle = D.SCH.wire; ctx.globalAlpha = 0.7; ctx.setLineDash([30, 20]);
    ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath();
    wireDraw.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    const np = wirePoint(hoverW);
    ctx.lineTo(np[0], np[1]);
    ctx.stroke();
    ctx.restore();
  }
```

Botão direito **conclui** o fio: `document.getElementById('cv').addEventListener('contextmenu', e => { e.preventDefault(); if (wireDraw) endWire(); });`. Teclado: `else if (k === 'w') setSchTool(schTool === 'wire' ? 'select' : 'wire');` e o ramo Escape ganha, antes dos demais, o **cancelamento** (descarta o fio em desenho, como no Altium): `if (wireDraw){ wireDraw = null; cam.draw(); return; }`.

- [ ] **Step 4: Verify** — `node --check schframe.js`; cadeia OK. Manual (pendência): fio ortogonal com snap em ponta quente (círculo do pino), label/power/texto com dialog + colocação contínua, junção direta.

- [ ] **Step 5: Commit**

```bash
git add schframe.html schframe.js
git commit -m "Vista Esquema: ferramentas fio (W, snap na ponta quente), label, power, juncao e texto

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Propriedades por duplo clique

**Files:**
- Modify: `schframe.html` (form `#schprops`), `schframe.js`

**Interfaces:**
- Consumes: `hitTest` com `item` (Task 3), `commit()`.

- [ ] **Step 1: schframe.html** — dentro de `#cvwrap`, após `#schform`:

```html
      <div id="schprops" style="display:none; position:absolute; top:10px; right:10px; z-index:17;
           background:var(--panel2); border:1px solid var(--border); border-radius:4px; padding:8px; width:250px;">
        <div id="schpropstitle" style="color:var(--accent); font-size:12px; margin-bottom:6px;"></div>
        <div id="schpropsrows"></div>
        <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:6px;">
          <button id="schpropsok">OK</button>
          <button id="schpropscancel">Cancelar</button>
        </div>
        <datalist id="fplist-dl"></datalist>
      </div>
```

CSS: copiar as regras `#proprows label/input/select` do pcbframe.html adaptadas para `#schpropsrows` (mesmo visual).

- [ ] **Step 2: schframe.js** — adicionar após o bloco das ferramentas:

```js
/* ------- propriedades (duplo clique) ------- */
let propItem = null;
function escAttr(v){ return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function sRow(key, label, value, type){
  return `<label><span>${label}</span><input data-k="${key}" type="${type || 'text'}" value="${escAttr(value)}"${type === 'number' ? ' step="any"' : ''}></label>`;
}
function sSelect(key, label, value, opts){
  return `<label><span>${label}</span><select data-k="${key}">` +
    opts.map(o => `<option${String(o) === String(value) ? ' selected' : ''}>${o}</option>`).join('') + '</select></label>';
}
function openSchProps(h){
  propItem = h;
  const it = h.item, rows = document.getElementById('schpropsrows');
  const title = document.getElementById('schpropstitle');
  if (h.kind === 'comp'){
    title.textContent = 'Componente ' + it.ref;
    const sym = HubCore.symbolOf(SLIB, it.sym);
    const pc = sym ? (sym.partcount || (sym.parts || []).length || 1) : 1;
    document.getElementById('fplist-dl').innerHTML =
      (PLIB.footprints || []).map(f => '<option value="' + escAttr(f.name) + '">').join('');
    rows.innerHTML = sRow('ref', 'ref', it.ref) + sRow('comment', 'comment', it.comment || '') +
      `<label><span>footprint</span><input data-k="footprint" list="fplist-dl" value="${escAttr(it.footprint || '')}"></label>` +
      (pc > 1 ? sSelect('part', 'parte', it.part || 1, Array.from({ length:pc }, (_, i) => i + 1)) : '') +
      sRow('x', 'x (mil)', it.x, 'number') + sRow('y', 'y (mil)', it.y, 'number') +
      sSelect('rot', 'rot', ((it.rot || 0) % 360 + 360) % 360, [0, 90, 180, 270]) +
      sSelect('mirror', 'espelhado', it.mirror ? 'sim' : 'não', ['não', 'sim']);
  } else if (h.kind === 'netlabel'){
    title.textContent = 'Net label';
    rows.innerHTML = sRow('net', 'net', it.net || '') + sSelect('rot', 'rot', it.rot || 0, [0, 90, 180, 270]);
  } else if (h.kind === 'power'){
    title.textContent = 'Power port';
    rows.innerHTML = sRow('net', 'net', it.net || '') +
      sSelect('style', 'estilo', it.style || 'Bar', ['Bar','Circle','Arrow','Wave','GndPower','GndSignal','GndEarth']) +
      sSelect('rot', 'rot', it.rot || 0, [0, 90, 180, 270]);
  } else if (h.kind === 'text'){
    title.textContent = 'Texto';
    rows.innerHTML = sRow('s', 'texto', it.s || '') + sRow('h', 'altura', it.h || 10, 'number');
  } else return;
  document.getElementById('schprops').style.display = 'block';
}
document.getElementById('schpropsok').addEventListener('click', () => {
  const h = propItem; if (!h) return;
  const it = h.item, v = {};
  document.querySelectorAll('#schpropsrows [data-k]').forEach(el => { v[el.dataset.k] = el.value; });
  document.getElementById('schprops').style.display = 'none';
  const clean = s => String(s).trim().replace(/"/g, "'");
  if (h.kind === 'comp'){
    const nref = clean(v.ref);
    if (!nref){ alert('ref não pode ficar vazio.'); propItem = null; return; }
    it.ref = nref;
    it.comment = clean(v.comment); if (!it.comment) delete it.comment;
    it.footprint = clean(v.footprint);
    if (v.part !== undefined){ const p = +v.part; if (p !== 1) it.part = p; else delete it.part; }
    const nx = +v.x, ny = +v.y;
    if (isFinite(nx)) it.x = snap100(nx);
    if (isFinite(ny)) it.y = snap100(ny);
    it.rot = +v.rot;
    if (v.mirror === 'sim') it.mirror = true; else delete it.mirror;
    selComp = it.ref;
  } else if (h.kind === 'netlabel'){ it.net = clean(v.net); it.rot = +v.rot; }
  else if (h.kind === 'power'){ it.net = clean(v.net); it.style = v.style; it.rot = +v.rot; }
  else if (h.kind === 'text'){ it.s = clean(v.s); const nh = +v.h; if (isFinite(nh) && nh > 0) it.h = nh; }
  propItem = null;
  commit();
});
document.getElementById('schpropscancel').addEventListener('click', () => {
  document.getElementById('schprops').style.display = 'none'; propItem = null;
});
document.getElementById('cv').addEventListener('dblclick', () => {
  if (annTool || schTool !== 'select' || placing || wireDraw || !hoverW) return;
  const h = hitTest(hoverW.x, hoverW.y);
  if (h && h.kind !== 'pin' && h.kind !== 'wire' && h.kind !== 'junction') openSchProps(h);
  else if (h && h.kind === 'pin') openSchProps({ kind:'comp', item:h.item });
});
```

E o ramo Escape ganha, no topo: `if (document.getElementById('schprops').style.display === 'block'){ document.getElementById('schprops').style.display = 'none'; propItem = null; return; }`.

- [ ] **Step 3: Verify** — `node --check schframe.js`; cadeia OK. Manual (pendência): renomear ref (validação acusa duplicado), trocar footprint com datalist (crosscheck pino↔pad no painel), power muda estilo.

- [ ] **Step 4: Commit**

```bash
git add schframe.html schframe.js
git commit -m "Vista Esquema: propriedades por duplo clique (ref/comment/footprint/rot/mirror, label, power, texto)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Documentação + verificação final

**Files:**
- Modify: `README.md`, `AI-GUIDE.md`

- [ ] **Step 1: README** — (a) na descrição da vista **Esquema** do hub, acrescentar: "A vista Esquema agora **edita**: `+ Componente` abre o picker das libs (símbolo + footprint lado a lado, ref sugerido), `W` desenha fios com snap na ponta quente dos pinos, Label/Power/Junção/Texto por clique, arrastar move com grade de 100 mil, duplo clique abre propriedades, `Ctrl+Z` desfaz e **Salvar esquema** grava o `schematic.js`. Para o Altium refletir edições numa folha já construída, rode o **BuildSchematic com limpeza da folha** (confirmação SIM)." (b) Na seção "Fluxo projeto existente", item 4, trocar "Editar um esquema **existente** não é suportado nesta versão — o espelho é só leitura (round-trip de edição de esquema fica para a v3)." por "Editar o esquema pelo hub grava o `schematic.js`; para levar ao Altium, rode **BuildSchematic com limpeza da folha** (re-despejo completo — o rebuild incremental fica para uma fase futura). A alternativa segue válida: editar no Altium e re-exportar."

- [ ] **Step 2: AI-GUIDE** — (a) na Parte A, após o parágrafo de "Projeto novo: crie `Projects\<nome>\schematic.js`...", acrescentar: "**Dois escritores:** o usuário também edita o `schematic.js` pelo hub (vista Esquema). Releia o arquivo antes de cada edição e preserve as linhas dele; após edições, o BuildSchematic deve rodar com limpeza da folha para refletir removidos/alterados." (b) Na Parte C item 4, trocar "(sinalizadores e changes.js pelo hub; schematic.js manualmente por enquanto)" por "(sinalizadores, changes.js e schematic.js pelo hub)".

- [ ] **Step 3: Verificação final** — `node tests/test-geom.js && node tests/test-apply.js && node tests/test-serialize.js` OK; `node --check` em hub-core.js, hub-io.js, hub-ui.js, hub-draw.js, pcbframe.js, schframe.js; `python -m py_compile hubserver.py`; `git status` limpo.

- [ ] **Step 4: Commit**

```bash
git add README.md AI-GUIDE.md
git commit -m "Docs: edicao na vista Esquema (picker, fio, propriedades) no README e AI-GUIDE

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
