# Editor no browser — Fase 3 (editor PCB + comp_attr) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edição interativa na vista PCB estilo Altium — arrastar componentes/trilhas/vias/arcos, desenhar trilhas, adicionar vias, editar propriedades e atributos (designator/comment via op nova `comp_attr` nos dois lados), com undo/redo e salvamento do `changes.js` protegido contra o segundo escritor (a IA).

**Architecture:** O editor vive em `pcbframe.js` sobre o loop `reapply()` (mutar `CH` → `HubCore.applyPcbChanges` → reconstruir painéis → `draw()`); o preview de diff existente (verde/fantasma/seta) mostra as edições de graça. Durante o arrasto só o `eff` é mutado (leve); o commit no mouseup grava/edita a change com `orig_*` copiados de `m.src`. **Editar objeto já alterado edita a change existente** (semântica `orig_*`-contra-`board.js`). `comp_attr` entra no motor (`hub-core.js`), no serializador e no `ApplyChanges.pas` (aplicado por último — `FindComponent` casa por nome).

**Tech Stack:** JS vanilla (file://-safe), DelphiScript, testes node `assert`.

**Spec:** `docs/superpowers/specs/2026-08-04-editor-browser-sinalizadores-design.md` (aprovada). Fases 1+2 já entregues (commits `ade381c..0f725bb`). Fase 4 (editor Esquema) terá plano próprio.

## Global Constraints

- Um objeto JSON plano por linha nos arquivos de dados; strings sem a sequência `":`; `\uXXXX` para chars >= U+007E (o serializador já garante — toda gravação passa por `HubCore.serializeChanges`).
- Toda change de edição/remoção carrega `orig_*` copiados **de `m.src`** (nunca de `eff`) — garante status `ok` na validação e trava correta no Altium.
- Editar objeto já alterado **atualiza a change existente**; `Delete` em objeto `*_add` do editor **remove a linha** (não gera `*_del`).
- `file://` continua funcionando (edição em memória + botão de download); `fetch` só via `HubIO` em HTTP.
- `board.js`, `Libs\*.js`, `projects.js` nunca são escritos pelo browser.
- Coordenadas gravadas com até 4 casas (`+v.toFixed(4)`).
- Testes: cadeia `node tests/test-geom.js && node tests/test-apply.js && node tests/test-serialize.js` deve passar (test-netextract/test-validate falham por pendência pré-existente das libs-fixture — não tocar).
- `.pas` não compila fora do Altium — diff mínimo + releitura; validação real é do usuário.
- Commits com trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Op `comp_attr` no motor + serializador (TDD)

**Files:**
- Modify: `hub-core.js` (novo case no switch de `applyPcbChanges`; init dos comps; `CH_REQUIRED`; checagem especial no `serializeChanges`)
- Test: `tests/test-apply.js` (casos novos), `tests/test-serialize.js` (1 caso)

**Interfaces:**
- Produces: op `{op:'comp_attr', ref, orig_designator, orig_comment, designator?, comment?, note?}`; no modelo, `m.eff.designator`/`m.eff.comment` (definidos só quando alterados) e flag `m.attrChanged` (separada de `m.changed`, que continua puramente posicional — o overlay de seta/fantasma não dispara para atributo).

- [ ] **Step 1: Testes que falham** — em `tests/test-apply.js`, antes da linha `// example v1 continua compativel`, acrescentar:

```js
// comp_attr: edita texto de designator/comment; travas por string
const ca = Core.applyPcbChanges(board, [
  { op:'comp_attr', ref:'D1', designator:'D9', comment:'LED azul', orig_designator:'D1', orig_comment: (board.components.find(c=>c.ref==='D1').comment || '') },
]);
assert.strictEqual(ca.validation.filter(v => v.level === 'err').length, 0);
assert.strictEqual(ca.compByRef['D1'].eff.designator, 'D9');
assert.strictEqual(ca.compByRef['D1'].eff.comment, 'LED azul');
assert.ok(ca.compByRef['D1'].attrChanged, 'attrChanged deve marcar');
assert.ok(!ca.compByRef['D1'].changed, 'changed continua puramente posicional');
const ca2 = Core.applyPcbChanges(board, [
  { op:'comp_attr', ref:'D1', designator:'D9', orig_designator:'ERRADO', orig_comment:'' },
]);
assert.ok(ca2.validation.some(v => v.level === 'warn'), 'orig divergente e warn');
const ca3 = Core.applyPcbChanges(board, [
  { op:'comp_attr', ref:'Z9', designator:'A1', orig_designator:'Z9', orig_comment:'' },
]);
assert.ok(ca3.validation.some(v => v.level === 'err'), 'ref inexistente e erro');
const ca4 = Core.applyPcbChanges(board, [
  { op:'comp_attr', ref:'D1', designator:'D9' },
]);
assert.ok(ca4.validation.some(v => v.level === 'err'), 'sem orig_* e erro');
```

Em `tests/test-serialize.js`, junto dos casos de recusa de changes:

```js
/* comp_attr: serializa ok; recusa sem orig_comment e sem nada a alterar */
const cat = Core.serializeChanges([{ op:'comp_attr', ref:'D1', designator:'D9', orig_designator:'D1', orig_comment:'' }]);
assert.strictEqual(cat.errors.length, 0);
assert.ok(Core.serializeChanges([{ op:'comp_attr', ref:'D1', designator:'D9', orig_designator:'D1' }]).errors.length);
assert.ok(Core.serializeChanges([{ op:'comp_attr', ref:'D1', orig_designator:'D1', orig_comment:'' }]).errors.length);
```

- [ ] **Step 2: Rodar e ver falhar** — `node tests/test-apply.js` → erro `operação desconhecida "comp_attr"`; `node tests/test-serialize.js` → falha.

- [ ] **Step 3: Implementar** — em `hub-core.js`:

(a) na construção dos comps (`applyPcbChanges`, loop `for (const c of (B.components || []))`), acrescentar `attrChanged:false` ao objeto `m`:

```js
    const m = { kind:'comp', src:c, eff:{ x:c.x, y:c.y, rot:c.rot, layer:c.layer }, changed:false, attrChanged:false };
```

(b) novo case no switch, logo após o case `'comp_move'`:

```js
      case 'comp_attr': {
        const m = model.compByRef[ch.ref];
        if (!m) return bad(`componente "${ch.ref}" não existe no board.js`);
        item.target = m;
        if (typeof ch.orig_designator !== 'string' || typeof ch.orig_comment !== 'string')
          return bad('faltam orig_designator/orig_comment (copie do board.js)');
        if (ch.orig_designator !== m.src.ref || ch.orig_comment !== (m.src.comment || ''))
          warn('orig_* não confere com o board.js — espelho pode estar desatualizado');
        if (typeof ch.designator === 'string' && ch.designator) m.eff.designator = ch.designator;
        if (typeof ch.comment === 'string') m.eff.comment = ch.comment;
        m.attrChanged = (m.eff.designator !== undefined && m.eff.designator !== m.src.ref) ||
                        (m.eff.comment !== undefined && m.eff.comment !== (m.src.comment || ''));
        break;
      }
```

(c) em `CH_REQUIRED`, acrescentar a entrada:

```js
  comp_attr:       { num:[], str:['ref','orig_designator'] },
```

(d) em `serializeChanges`, junto das checagens especiais (`outline_set`/`track_add`/`via_add`):

```js
    if (ch.op === 'comp_attr'){
      if (typeof ch.orig_comment !== 'string') errors.push({ idx:i, msg:'comp_attr: campo "orig_comment" ausente' });
      if (!(typeof ch.designator === 'string' && ch.designator) && typeof ch.comment !== 'string')
        errors.push({ idx:i, msg:'comp_attr: nada a alterar (informe designator e/ou comment)' });
    }
```

Nota de design (documentar em comentário no case): no motor JS a ordem não importa — `compByRef` é chaveado pelo `ref` do `board.js` e as demais ops também procuram pelo ref do board; só o `.pas` precisa aplicar renames por último.

- [ ] **Step 4: Rodar e ver passar** — `node tests/test-apply.js && node tests/test-serialize.js && node tests/test-geom.js` — 3× OK.

- [ ] **Step 5: Commit**

```bash
git add hub-core.js tests/test-apply.js tests/test-serialize.js
git commit -m "hub-core: op comp_attr (texto de designator/comment) com trava por string

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `DoCompAttr` no ApplyChanges.pas (aplicado por último)

**Files:**
- Modify: `ApplyChanges.pas` (procedure nova após `DoDesignatorMove`; dispatcher em `ApplyChangesInto` com passada final)

**Interfaces:**
- Consumes: linhas `comp_attr` do `changes.js` (Task 1 define o shape).
- Produces: renames aplicados **depois** de todas as outras ops (numa passada própria, ainda dentro do mesmo PreProcess/PostProcess = undo único).

- [ ] **Step 1: Procedure** — inserir após o `end;` de `DoDesignatorMove` (antes de `procedure DoOutlineSet`):

```pascal
procedure DoCompAttr(Line: String);
var
  Ref: String;
  Comp: IPCB_Component;
begin
  Ref := JGet(Line, 'ref');
  Comp := FindComponent(Ref);
  if Comp = nil then
  begin
    LogFail('comp_attr ' + Ref + ': componente nao encontrado');
    Exit;
  end;
  if not (JHas(Line, 'orig_designator') and JHas(Line, 'orig_comment')) then
  begin
    LogFail('comp_attr ' + Ref + ': faltam orig_designator/orig_comment (copie do board.js)');
    Exit;
  end;
  if (Comp.Name.Text <> JGet(Line, 'orig_designator')) or (Comp.Comment.Text <> JGet(Line, 'orig_comment')) then
  begin
    LogFail('comp_attr ' + Ref + ': designator/comment atuais nao casam com orig_* (re-exporte o espelho)');
    Exit;
  end;
  PCBServer.SendMessageToRobots(Comp.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  if JHas(Line, 'designator') then
  begin
    if JGet(Line, 'designator') <> '' then
      Comp.Name.Text := JGet(Line, 'designator');
  end;
  if JHas(Line, 'comment') then
    Comp.Comment.Text := JGet(Line, 'comment');
  PCBServer.SendMessageToRobots(Comp.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  Comp.GraphicallyInvalidate;
  LogOk('comp_attr ' + Ref + ' -> designator=' + JGet(Line, 'designator') + ' comment=' + JGet(Line, 'comment'));
end;
```

- [ ] **Step 2: Dispatcher em duas passadas** — em `ApplyChangesInto`: (a) declarar `AttrLines: TStringList;` no `var`; (b) criar `AttrLines := TStringList.Create;` junto de `Src := TStringList.Create;`; (c) no encadeado if/else do loop, antes do `else LogFail(...)`, acrescentar:

```pascal
    else if Op = 'comp_attr' then
      AttrLines.Add(Line)   // renames por ultimo: FindComponent casa por Name.Text
```

(d) após o `end;` do loop principal e **antes** de `PCBServer.PostProcess;`:

```pascal
  // comp_attr aplicado por ultimo (renomear designator cedo quebraria refs das ops seguintes)
  for i := 0 to AttrLines.Count - 1 do
    DoCompAttr(AttrLines[i]);
```

(e) liberar com `AttrLines.Free;` junto de `Src.Free;`.

- [ ] **Step 3: Verify** — `git diff`: só as mudanças acima; conferir begin/end balanceados e ponto-e-vírgula. Validação real: usuário roda ApplyChanges no Altium (registrar como pendência).

- [ ] **Step 4: Commit**

```bash
git add ApplyChanges.pas
git commit -m "ApplyChanges: op comp_attr (designator/comment) aplicada por ultimo

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Infra de edição no pcbframe — `reapply()`, undo/redo, salvar changes.js, dirty unificado

**Files:**
- Modify: `pcbframe.js`, `pcbframe.html` (botão salvar), `hub-io.js` (`fetchText`), `hub-ui.js` + `schframe.js` (rename do hook dirty)

**Interfaces:**
- Produces (para as Tasks 4-6): `reapply()`; `commit()` (snapshot de undo + `setChDirty(true)` + `reapply()`); `r4(v)`; `undo()`/`redo()`; `selKey/findBySelKey`; `chDirty`; `HubIO.fetchText(relPath) -> Promise<string>`; hook renomeado `window.__hubDirty` (frames e hub-ui).

- [ ] **Step 1: `hub-io.js`** — adicionar antes do `root.HubIO = ...` e exportar:

```js
async function fetchText(relPath){
  if (!canPost) throw new Error('sem servidor');
  const r = await fetch('/' + relPath, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}
```

`root.HubIO = { canPost, saveFile, download, fetchText };`

- [ ] **Step 2: `pcbframe.js` — modelo re-aplicável** — trocar `const model = HubCore.applyPcbChanges(B, CH);` por `let model = ...`; logo abaixo, adicionar o bloco de infra:

```js
/* ------- infra de edicao: reapply, undo/redo, dirty, salvar ------- */
let chDirty = false;
const undoStack = [JSON.stringify(CH)], redoStack = [];
function r4(v){ return +v.toFixed(4); }

function selKey(m){
  if (!m) return null;
  if (m.kind === 'ann') return { kind:'ann', id:m.ann.id };
  if (m.kind === 'pad') return { kind:'pad', ref:m.comp.src.ref, name:m.pad.name };
  if (m.kind === 'comp') return { kind:'comp', ref:m.src.ref };
  return { kind:m.kind, id:(m.added ? m.eff.id : m.src.id), added:!!m.added };
}
function findBySelKey(k){
  if (!k) return null;
  if (k.kind === 'ann'){ const a = ANN.find(x => x.id === k.id); return a ? { kind:'ann', ann:a } : null; }
  if (k.kind === 'comp') return model.compByRef[k.ref] || null;
  if (k.kind === 'pad'){
    const c = model.compByRef[k.ref]; if (!c) return null;
    const p = c.src.pads.find(p => p.name === k.name);
    return p ? { kind:'pad', pad:p, comp:c, x:p.x, y:p.y } : null;
  }
  if (k.added) return model.added.find(m => m.kind === k.kind && m.eff.id === k.id) || null;
  const pool = { track:model.tracks, via:model.vias, arc:model.arcs, text:model.texts }[k.kind] || [];
  return pool.find(m => m.src.id === k.id) || null;
}

function reapply(){
  const k = selKey(selected);
  model = HubCore.applyPcbChanges(B, CH);
  selected = findBySelKey(k);
  buildChangePanel();
  renderTable();
  showInfo(selected);
  draw();
}
function setChDirty(v){
  chDirty = v;
  const b = document.getElementById('btnChSave');
  b.classList.toggle('active', v);
  b.textContent = v ? 'Salvar changes *' : 'Salvar changes';
}
function commit(){
  undoStack.push(JSON.stringify(CH));
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  setChDirty(true);
  reapply();
}
function restoreCH(json){
  CH.length = 0;
  for (const c of JSON.parse(json)) CH.push(c);
  setChDirty(true);
  reapply();
}
function undo(){ if (undoStack.length < 2) return; redoStack.push(undoStack.pop()); restoreCH(undoStack[undoStack.length - 1]); }
function redo(){ if (!redoStack.length) return; const s = redoStack.pop(); undoStack.push(s); restoreCH(s); }

/* dois escritores: snapshot do changes.js em disco para detectar a IA gravando em paralelo */
let chDiskSnapshot = null;
const CH_REL = PCB_P ? 'Projects/' + PCB_P + '/changes.js' : 'changes.js';
(async () => { if (HubIO.canPost) try { chDiskSnapshot = await HubIO.fetchText(CH_REL); } catch (e) {} })();

async function saveChanges(){
  const out = HubCore.serializeChanges(CH);
  if (!out.text){ alert('Mudanças inválidas:\n' + out.errors.map(e => e.msg).join('\n')); return; }
  if (HubIO.canPost && chDiskSnapshot !== null){
    try {
      const cur = await HubIO.fetchText(CH_REL);
      if (cur !== chDiskSnapshot &&
          !confirm('changes.js mudou no disco desde o carregamento (outro escritor — a IA?). Sobrescrever mesmo assim?')) return;
    } catch (e) {}
  }
  const msg = document.getElementById('annmsg');
  try {
    const r = await HubIO.saveFile(CH_REL, out.text);
    setChDirty(false);
    chDiskSnapshot = out.text;
    msg.textContent = r.mode === 'server' ? '✓ changes.js salvo' : '↓ arquivo baixado — substitua ' + CH_REL;
  } catch (err) {
    if (confirm('Salvar no servidor falhou: ' + err.message + '\nBaixar o arquivo em vez disso?'))
      HubIO.download('changes.js', out.text);
  }
}
```

- [ ] **Step 3: dirty unificado** — em `pcbframe.js`: `__hubOnChange` passa a checar `annDirty || chDirty`; substituir `window.__hubAnnDirty = function(){ return annDirty; };` por `window.__hubDirty = function(){ return annDirty || chDirty; };`; `beforeunload` idem (`annDirty || chDirty`). Em `schframe.js`: renomear para `window.__hubDirty = function(){ return annDirty; };`. Em `hub-ui.js`: trocar as duas referências `__hubAnnDirty` por `__hubDirty`. Registrar o listener do botão: `document.getElementById('btnChSave').addEventListener('click', saveChanges);` junto dos listeners dos botões de sinalizador.

- [ ] **Step 4: `pcbframe.html`** — no header, ao lado de `#btnAnnSave`: `<button id="btnChSave" title="Salvar changes.js (mudanças de PCB)">Salvar changes</button>`.

- [ ] **Step 5: `buildChangePanel` re-executável** — no início da função, limpar os dois containers (o guard atual só escreve o placeholder): substituir as duas primeiras linhas do corpo por:

```js
  document.getElementById('chcount').textContent = CH.length;
  const list = document.getElementById('changelist');
  list.innerHTML = CH.length ? '' : '<div style="color:var(--fg-dim)">nenhuma — edite na tela ou no changes.js</div>';
```

e para a validação: `val.innerHTML = model.validation.length ? '' : '<div style="color:var(--ok)">✓ sem problemas</div>';` (mantendo os loops de append).

- [ ] **Step 6: teclado** — no handler keydown, logo **depois** do guard de INPUT/TEXTAREA/SELECT e da declaração `const k = e.key.toLowerCase();` (assim `Ctrl+Z` dentro dos formulários continua sendo o desfazer de texto do browser):

```js
  if (e.ctrlKey && k === 'z'){ e.preventDefault(); undo(); return; }
  if (e.ctrlKey && k === 'y'){ e.preventDefault(); redo(); return; }
```

- [ ] **Step 7: Verify** — `node --check` em pcbframe.js/schframe.js/hub-ui.js/hub-io.js; grep: nenhum `__hubAnnDirty` restante; `node tests/test-serialize.js` OK.

- [ ] **Step 8: Commit**

```bash
git add pcbframe.js pcbframe.html hub-io.js hub-ui.js schframe.js
git commit -m "Vista PCB: infra de edicao (reapply, undo/redo, salvar changes.js com guarda de dois escritores)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Arrastar objetos no modo selecionar (+ Espaço, Esc, Delete, snap)

**Files:**
- Modify: `pcbframe.js` (handlers de mouse, commits por tipo, snap)

**Interfaces:**
- Consumes: `commit()`, `r4()`, `reapply()` (Task 3).
- Produces: `gridStep()`, `snapVal(v, ev)`, `commitCompMove(m)`, `commitTrackEdit(m)`, `commitViaEdit(m)`, `commitArcEdit(m)`, `deleteSelected()` — a Task 6 reutiliza os commits.

- [ ] **Step 1: snap + commits** — adicionar após o bloco de infra da Task 3:

```js
/* ------- snap e commits de edicao ------- */
function gridStep(){
  const steps = [0.1, 0.5, 1, 5, 10, 25, 50];
  for (const s of steps){ if (s * view.scale >= 12) return s; }
  return 50;
}
function snapVal(v, ev){ const g = gridStep(); return (ev && ev.ctrlKey) ? v : Math.round(v / g) * g; }

function sameCompPos(c, s){
  return near(c.x, s.x) && near(c.y, s.y) && nearAng(c.rot, s.rot) && c.layer === s.layer;
}
function commitCompMove(m){
  const e = m.eff, s = m.src;
  let c = CH.find(c => c.op === 'comp_move' && c.ref === s.ref);
  if (sameCompPos(e, s)){                       /* voltou ao original: remove a change */
    if (c) CH.splice(CH.indexOf(c), 1);
    commit(); return;
  }
  if (!c){
    c = { op:'comp_move', ref:s.ref, x:0, y:0, rot:s.rot, layer:s.layer,
          orig_x:s.x, orig_y:s.y, orig_rot:s.rot, orig_layer:s.layer, note:'editado no hub' };
    CH.push(c);
  }
  c.x = r4(e.x); c.y = r4(e.y); c.rot = r4(e.rot); c.layer = e.layer;
  commit();
}
function upsertEdit(m, op, patch, origFields){
  if (m.added){                                  /* objeto do editor: edita a propria linha *_add */
    const item = model.changeItems.find(it => it.target === m);
    if (item) Object.assign(item.ch, patch);
    commit(); return;
  }
  let c = CH.find(c => c.op === op && c.id === m.src.id);
  if (!c){
    c = { op, id:m.src.id, note:'editado no hub' };
    for (const k of origFields) c['orig_' + k] = m.src[k];
    CH.push(c);
  }
  Object.assign(c, patch);
  commit();
}
function commitTrackEdit(m){
  const e = m.eff;
  upsertEdit(m, 'track_edit', { x1:r4(e.x1), y1:r4(e.y1), x2:r4(e.x2), y2:r4(e.y2) },
             ['x1','y1','x2','y2','w','layer']);
}
function commitViaEdit(m){
  const e = m.eff;
  upsertEdit(m, 'via_edit', { x:r4(e.x), y:r4(e.y) }, ['x','y']);
}
function commitArcEdit(m){
  const e = m.eff;
  upsertEdit(m, 'arc_edit', { cx:r4(e.cx), cy:r4(e.cy) }, ['cx','cy','r','sa','ea','layer']);
}
function deleteSelected(){
  const m = selected;
  if (!m || m.kind === 'pad' || m.kind === 'ann' || m.kind === 'comp' || m.kind === 'text') return;
  if (m.added){
    const item = model.changeItems.find(it => it.target === m);
    if (item) CH.splice(item.idx, 1);
  } else {
    const iEdit = CH.findIndex(c => c.op === m.kind + '_edit' && c.id === m.src.id);
    if (iEdit >= 0) CH.splice(iEdit, 1);
    const s = m.src, del = { op:m.kind + '_del', id:s.id, note:'removido no hub' };
    if (m.kind === 'track'){ del.orig_x1=s.x1; del.orig_y1=s.y1; del.orig_x2=s.x2; del.orig_y2=s.y2; del.orig_w=s.w; del.orig_layer=s.layer; }
    else if (m.kind === 'via'){ del.orig_x=s.x; del.orig_y=s.y; }
    else if (m.kind === 'arc'){ del.orig_cx=s.cx; del.orig_cy=s.cy; del.orig_r=s.r; del.orig_sa=s.sa; del.orig_ea=s.ea; del.orig_layer=s.layer; }
    else return;
    CH.push(del);
  }
  selected = null;
  commit();
}
```

- [ ] **Step 2: arrasto** — substituir o handler de `mousedown` atual por:

```js
let objDrag = null; /* { m, startW, base, moved } */
cv.addEventListener('mousedown', e => {
  dragging = false; dragMoved = false; lastX = e.offsetX; lastY = e.offsetY;
  if (annTool || tool !== 'select' || e.button !== 0){ dragging = true; return; }
  const w = screenToWorld(e.offsetX, e.offsetY);
  const h = hitTest(w.x, w.y);
  if (h && ['comp','track','via','arc'].includes(h.kind) && !h.deleted){
    objDrag = { m:h, startW:w, base:JSON.parse(JSON.stringify(h.eff)), moved:false };
  } else dragging = true;
});
```

No `mousemove`, antes do bloco `if (dragging){...}`:

```js
  if (objDrag){
    const d = objDrag, m = d.m, dx = w.x - d.startW.x, dy = w.y - d.startW.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.01 || d.moved){
      d.moved = true; dragMoved = true;
      if (m.kind === 'comp'){ m.eff.x = snapVal(d.base.x + dx, e); m.eff.y = snapVal(d.base.y + dy, e); m.changed = true; }
      else if (m.kind === 'track'){ const sx = snapVal(d.base.x1 + dx, e) - d.base.x1, sy = snapVal(d.base.y1 + dy, e) - d.base.y1;
        m.eff.x1 = d.base.x1 + sx; m.eff.y1 = d.base.y1 + sy; m.eff.x2 = d.base.x2 + sx; m.eff.y2 = d.base.y2 + sy; m.changed = true; }
      else if (m.kind === 'via'){ m.eff.x = snapVal(d.base.x + dx, e); m.eff.y = snapVal(d.base.y + dy, e); m.changed = true; }
      else if (m.kind === 'arc'){ m.eff.cx = snapVal(d.base.cx + dx, e); m.eff.cy = snapVal(d.base.cy + dy, e); m.changed = true; }
      draw();
    }
    return;
  }
```

No `mouseup` global (`window.addEventListener('mouseup', ...)`):

```js
window.addEventListener('mouseup', e => {
  dragging = false;
  if (objDrag){
    const d = objDrag; objDrag = null;
    if (d.moved){
      if (d.m.kind === 'comp') commitCompMove(d.m);
      else if (d.m.kind === 'track') commitTrackEdit(d.m);
      else if (d.m.kind === 'via') commitViaEdit(d.m);
      else if (d.m.kind === 'arc') commitArcEdit(d.m);
    }
  }
});
```

- [ ] **Step 3: Espaço rotaciona / Esc cancela / Delete** — no keydown: o ramo `Escape` existente ganha o cancelamento do arrasto e o Espaço entra antes do guard de INPUT:

```js
  if (e.key === 'Escape') { if (objDrag){ objDrag = null; reapply(); } setAnnTool(false); setTool('select'); return; }
  if (e.key === ' ' && objDrag && objDrag.m.kind === 'comp'){ e.preventDefault(); objDrag.m.eff.rot = (objDrag.m.eff.rot + 90) % 360; objDrag.moved = true; dragMoved = true; draw(); return; }
```

e junto dos `else if` existentes: `else if (e.key === 'Delete') deleteSelected();`
(`setTool` chega na Task 5 — nesta task, declarar stub `let tool = 'select'; let setTool = t => { tool = t; };` junto do estado, que a Task 5 substitui.)

- [ ] **Step 4: Verify** — `node --check pcbframe.js`; manual (pendência de usuário): arrastar D1 no `_DemoKit` gera/atualiza `comp_move` no painel com status ok; arrastar de volta remove a change; Ctrl+Z desfaz; Delete numa trilha gera `track_del`.

- [ ] **Step 5: Commit**

```bash
git add pcbframe.js
git commit -m "Vista PCB: arrastar comp/trilha/via/arco com snap, Espaco rotaciona, Delete remove

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Ferramentas Trilha e Via + barra de ferramentas

**Files:**
- Modify: `pcbframe.html` (linha de toolbar nova), `pcbframe.js` (state machine, rubber-band, forms)

**Interfaces:**
- Consumes: `commit()`, `snapVal()`, `r4()` (Tasks 3-4).
- Produces: `setTool(t)` real (substitui o stub da Task 4); `tool` ∈ `'select'|'track'|'via'`.

- [ ] **Step 1: toolbar no `pcbframe.html`** — logo após o fechamento do `#header`, inserir:

```html
<div id="toolbar">
  <button id="toolSelect" class="active" title="Selecionar/arrastar (Esc)">Selecionar</button>
  <button id="toolTrack" title="Desenhar trilhas (T)">Trilha</button>
  <button id="toolVia" title="Adicionar via">Via</button>
  <span class="sep"></span>
  <label>W <input id="trackw" type="number" step="0.05" min="0.05" value="0.3" title="largura da trilha (mm)"></label>
  <label>Camada <select id="activelayer"><option>Top</option><option>Bottom</option></select></label>
</div>
```

CSS (junto das regras do `#header`):

```css
  #toolbar{display:flex; align-items:center; gap:8px; height:34px; padding:0 12px;
    background:var(--panel); border-bottom:1px solid var(--border); font-size:12px;}
  #toolbar .sep{width:1px; height:18px; background:var(--border);}
  #toolbar label{color:var(--fg-dim); display:flex; align-items:center; gap:4px;}
  #toolbar input[type=number]{width:60px; background:var(--panel2); color:var(--fg);
    border:1px solid var(--border); border-radius:3px; padding:2px 4px;}
  #toolbar select{background:var(--panel2); color:var(--fg); border:1px solid var(--border); border-radius:3px; padding:2px;}
```

e ajustar `#main{display:flex; height:calc(100% - 42px);}` para `calc(100% - 76px)`.

Formulário da via, dentro de `#canvaswrap` (após `#annform`):

```html
      <div id="viaform" style="display:none; position:absolute; top:10px; right:10px; z-index:15;
           background:var(--panel2); border:1px solid var(--border); border-radius:4px; padding:8px; width:220px;">
        <div style="display:flex; gap:6px; margin-bottom:6px;">
          <label style="flex:1">size <input id="viasize" type="number" step="0.05" min="0.1" value="0.6" style="width:100%"></label>
          <label style="flex:1">drill <input id="viadrill" type="number" step="0.05" min="0.05" value="0.3" style="width:100%"></label>
        </div>
        <input id="vianet" list="netlist-dl" placeholder="net (opcional)" style="width:100%; margin-bottom:6px;">
        <datalist id="netlist-dl"></datalist>
        <div style="display:flex; gap:6px; justify-content:flex-end;">
          <button id="viaok">OK</button>
          <button id="viacancel">Cancelar</button>
        </div>
      </div>
```

(inputs do viaform herdam o estilo global de `input` — se ficarem sem estilo, aplicar o mesmo inline do `#anntext`).

- [ ] **Step 2: state machine + trilha + via no `pcbframe.js`** — substituir o stub `let tool...` da Task 4 por:

```js
/* ------- ferramentas Trilha e Via ------- */
let tool = 'select';
let trackChain = null;   /* { last:{x,y}, net } */
let hoverW = null;       /* posicao do mouse em mundo, p/ rubber-band */
let viaPending = null;

function setTool(t){
  tool = t;
  trackChain = null; viaPending = null;
  document.getElementById('viaform').style.display = 'none';
  for (const [id, name] of [['toolSelect','select'],['toolTrack','track'],['toolVia','via']])
    document.getElementById(id).classList.toggle('active', tool === name);
  cv.style.cursor = tool === 'select' ? 'crosshair' : 'copy';
  draw();
}
document.getElementById('toolSelect').addEventListener('click', () => setTool('select'));
document.getElementById('toolTrack').addEventListener('click', () => setTool('track'));
document.getElementById('toolVia').addEventListener('click', () => setTool('via'));

function padSnap(w){   /* centro de pad proximo (prioridade sobre a grade) */
  const tolp = 8 / view.scale;
  for (const m of model.comps){
    const d = m.changed ? compDelta(m) : null;
    for (const p of m.src.pads){
      let px = p.x, py = p.y;
      if (d){ const q = xfPoint(d, p.x, p.y); px = q.x; py = q.y; }
      if (Math.hypot(w.x - px, w.y - py) <= Math.max(p.w, p.h) / 2 + tolp)
        return { x:r4(px), y:r4(py), net:p.net || '' };
    }
  }
  return null;
}
function toolPoint(w, ev){
  const ps = padSnap(w);
  if (ps) return ps;
  return { x:r4(snapVal(w.x, ev)), y:r4(snapVal(w.y, ev)), net:'' };
}
function trackClick(w, ev){
  const p = toolPoint(w, ev);
  if (!trackChain){ trackChain = { last:p, net:p.net }; draw(); return; }
  const c = { op:'track_add', layer:document.getElementById('activelayer').value,
              x1:trackChain.last.x, y1:trackChain.last.y, x2:p.x, y2:p.y,
              w:+document.getElementById('trackw').value || 0.3, note:'desenhada no hub' };
  const net = trackChain.net || p.net;
  if (net) c.net = net;
  CH.push(c);
  trackChain = { last:p, net:net };
  commit();
}
function viaClick(w, ev){
  viaPending = toolPoint(w, ev);
  document.getElementById('vianet').value = viaPending.net || '';
  document.getElementById('viaform').style.display = 'block';
  document.getElementById('viasize').focus();
}
document.getElementById('viaok').addEventListener('click', () => {
  if (!viaPending) return;
  const c = { op:'via_add', x:viaPending.x, y:viaPending.y,
              size:+document.getElementById('viasize').value || 0.6,
              drill:+document.getElementById('viadrill').value || 0.3, note:'via adicionada no hub' };
  const net = document.getElementById('vianet').value.trim();
  if (net) c.net = net;
  document.getElementById('viaform').style.display = 'none';
  viaPending = null;
  CH.push(c);
  commit();
});
document.getElementById('viacancel').addEventListener('click', () => {
  document.getElementById('viaform').style.display = 'none'; viaPending = null;
});
```

- [ ] **Step 3: integração nos handlers** — no `click` do canvas, depois do intercept do `annTool`:

```js
  if (tool === 'track'){ trackClick(screenToWorld(e.offsetX, e.offsetY), e); return; }
  if (tool === 'via'){ viaClick(screenToWorld(e.offsetX, e.offsetY), e); return; }
```

No `mousemove`, gravar `hoverW = w;` (sempre) e, quando `tool === 'track' && trackChain`, chamar `draw()` para o rubber-band. Botão direito encerra a corrente: `cv.addEventListener('contextmenu', e => { e.preventDefault(); if (trackChain){ trackChain = null; draw(); } });` — o ramo `Escape` da Task 4 já chama `setTool('select')`, que zera a corrente. No `draw()`, após `drawAnnotations();`:

```js
  if (tool === 'track' && trackChain && hoverW){
    ctx.save();
    ctx.strokeStyle = lcolor(document.getElementById('activelayer').value);
    ctx.globalAlpha = 0.6; ctx.setLineDash([0.5, 0.35]);
    strokeSeg(trackChain.last.x, trackChain.last.y, hoverW.x, hoverW.y, +document.getElementById('trackw').value || 0.3);
    ctx.restore();
  }
```

Popular o datalist de nets no init: `document.getElementById('netlist-dl').innerHTML = (B.nets || []).map(n => '<option value="' + n + '">').join('');`
Atalho `T`: junto dos `else if` do keydown: `else if (k === 't') setTool(tool === 'track' ? 'select' : 'track');`

- [ ] **Step 4: Verify** — `node --check pcbframe.js`; manual (pendência): desenhar 2 segmentos encadeados com snap em pad (herda a net), via com dialog, rubber-band visível, Esc volta a selecionar.

- [ ] **Step 5: Commit**

```bash
git add pcbframe.html pcbframe.js
git commit -m "Vista PCB: ferramentas Trilha (T) e Via com snap a pads/grade e rubber-band

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Propriedades por duplo clique + hit-test de textos + preview de comp_attr

**Files:**
- Modify: `pcbframe.js`, `pcbframe.html` (form de propriedades)

**Interfaces:**
- Consumes: commits da Task 4, `commit()`, op `comp_attr` (Task 1).
- Produces: `openProps(m)`; hitTest passa a retornar textos (`m.kind === 'text'`).

- [ ] **Step 1: form no `pcbframe.html`** — dentro de `#canvaswrap`, após `#viaform`:

```html
      <div id="propform" style="display:none; position:absolute; top:10px; right:10px; z-index:16;
           background:var(--panel2); border:1px solid var(--border); border-radius:4px; padding:8px; width:250px;">
        <div id="proptitle" style="color:var(--accent); font-size:12px; margin-bottom:6px;"></div>
        <div id="proprows"></div>
        <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:6px;">
          <button id="propok">OK</button>
          <button id="propcancel">Cancelar</button>
        </div>
      </div>
```

CSS junto das regras existentes:

```css
  #proprows label{display:flex; align-items:center; gap:6px; margin:3px 0; font-size:12px; color:var(--fg-dim);}
  #proprows label span{width:80px;}
  #proprows input, #proprows select{flex:1; background:var(--panel); color:var(--fg);
    border:1px solid var(--border); border-radius:3px; padding:3px 5px; font-size:12px; min-width:0;}
```

- [ ] **Step 2: hit-test de textos** — em `hitTest`, entre o loop de arcos e o de componentes:

```js
  for (const m of model.texts){
    const e = m.eff, oc = m.src.owner ? model.compByRef[m.src.owner] : null;
    let txt = e.text || '';
    if (m.src.designator && oc) txt = oc.eff.designator || oc.src.ref;
    if (m.src.comment && oc) txt = (oc.eff.comment !== undefined ? oc.eff.comment : (oc.src.comment || txt));
    if (!txt || !show.layers[e.layer]) continue;
    const hw = textWidth(txt, e.h || 1) / 2, hh = (e.h || 1) / 2;   /* bbox sem rotacao (aproximacao) */
    if (x >= e.x - hw - tol && x <= e.x + hw + tol && y >= e.y - hh - tol && y <= e.y + hh + tol) return m;
  }
```

Em `hoverLabel`: `if (m.kind==='text') return m.src.designator ? `designator ${m.src.owner}` : (m.src.comment ? `comment ${m.src.owner}` : `texto ${m.src.id}`);`

- [ ] **Step 3: preview de comp_attr** — em `drawTextItem`, trocar as duas linhas do owner por:

```js
  if (t.designator && ownerComp) txt = ownerComp.eff.designator || ownerComp.src.ref;
  if (t.comment && ownerComp) txt = (ownerComp.eff.comment !== undefined ? ownerComp.eff.comment : (ownerComp.src.comment || txt));
```

Em `tableRows`, trocar `ref:m.src.ref, footprint:..., comment:m.src.comment` por `ref:(m.eff.designator || m.src.ref), footprint:m.src.footprint, comment:(m.eff.comment !== undefined ? m.eff.comment : m.src.comment)`, e em `renderTable` destacar: célula `ref` com `.chg` quando `m.attrChanged && m.eff.designator`, célula `comment` quando `m.attrChanged && m.eff.comment !== undefined`; linha `.moved` quando `r.m.changed || r.m.attrChanged`.

- [ ] **Step 4: openProps** — adicionar após o bloco da Task 5:

```js
/* ------- propriedades (duplo clique) ------- */
let propTarget = null;
function escAttr(v){ return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function propRow(key, label, value, type){
  return `<label><span>${label}</span><input data-k="${key}" type="${type || 'number'}" step="any" value="${escAttr(value)}"></label>`;
}
function propSelect(key, label, value, opts){
  return `<label><span>${label}</span><select data-k="${key}">` +
    opts.map(o => `<option${o === value ? ' selected' : ''}>${o}</option>`).join('') + '</select></label>';
}
function openProps(m){
  propTarget = m;
  const rows = document.getElementById('proprows');
  const title = document.getElementById('proptitle');
  const e = m.eff;
  if (m.kind === 'comp'){
    title.textContent = 'Componente ' + m.src.ref;
    rows.innerHTML = propRow('designator', 'designator', e.designator || m.src.ref, 'text') +
      propRow('comment', 'comment', (e.comment !== undefined ? e.comment : (m.src.comment || '')), 'text') +
      propRow('x', 'x (mm)', e.x) + propRow('y', 'y (mm)', e.y) + propRow('rot', 'rot (°)', e.rot) +
      propSelect('layer', 'camada', e.layer, ['Top', 'Bottom']);
  } else if (m.kind === 'track'){
    title.textContent = 'Trilha ' + (m.added ? e.id : m.src.id);
    rows.innerHTML = propRow('x1','x1',e.x1) + propRow('y1','y1',e.y1) + propRow('x2','x2',e.x2) +
      propRow('y2','y2',e.y2) + propRow('w','largura',e.w) + propSelect('layer','camada',e.layer,['Top','Bottom']) +
      propRow('net','net',e.net || '','text');
  } else if (m.kind === 'via'){
    title.textContent = 'Via ' + (m.added ? e.id : m.src.id);
    rows.innerHTML = propRow('x','x',e.x) + propRow('y','y',e.y) + propRow('size','size',e.size) + propRow('drill','drill',e.drill);
  } else if (m.kind === 'arc'){
    title.textContent = 'Arco ' + (m.added ? e.id : m.src.id);
    rows.innerHTML = propRow('cx','cx',e.cx) + propRow('cy','cy',e.cy) + propRow('r','raio',e.r) +
      propRow('sa','âng. inicial',e.sa) + propRow('ea','âng. final',e.ea) + propRow('w','largura',e.w) +
      propSelect('layer','camada',e.layer,['Top','Bottom']);
  } else if (m.kind === 'text' && !m.src.designator && !m.src.comment){
    title.textContent = 'Texto ' + m.src.id;
    rows.innerHTML = propRow('text','texto',e.text || '','text') + propRow('x','x (centro)',e.x) +
      propRow('y','y (centro)',e.y) + propRow('h','altura',e.h || 1) + propRow('rot','rot (°)',e.rot || 0);
  } else if (m.kind === 'text' && m.src.designator){
    title.textContent = 'Designator de ' + m.src.owner;
    rows.innerHTML = propRow('x','x (centro)',e.x) + propRow('y','y (centro)',e.y) +
      propRow('h','altura',e.h || 1) + propRow('rot','rot (°)',e.rot || 0);
  } else return;   /* comment de componente: posicao nao editavel (sem op) */
  document.getElementById('propform').style.display = 'block';
}
function propValues(){
  const out = {};
  document.querySelectorAll('#proprows [data-k]').forEach(el => { out[el.dataset.k] = el.value; });
  return out;
}
document.getElementById('propok').addEventListener('click', () => {
  const m = propTarget, v = propValues();
  document.getElementById('propform').style.display = 'none';
  if (!m) return;
  const num = k => +v[k];
  if (m.kind === 'comp'){
    m.eff.x = num('x'); m.eff.y = num('y'); m.eff.rot = num('rot'); m.eff.layer = v.layer;
    commitCompMove(m);                                   /* ja faz commit() */
    const newDes = v.designator.trim().replace(/"/g, "'");
    const newCom = v.comment.replace(/"/g, "'");
    const desChanged = newDes && newDes !== m.src.ref, comChanged = newCom !== (m.src.comment || '');
    let c = CH.find(c => c.op === 'comp_attr' && c.ref === m.src.ref);
    if (!desChanged && !comChanged){ if (c){ CH.splice(CH.indexOf(c), 1); commit(); } }
    else {
      if (!c){ c = { op:'comp_attr', ref:m.src.ref, orig_designator:m.src.ref, orig_comment:(m.src.comment || ''), note:'atributos no hub' }; CH.push(c); }
      if (desChanged) c.designator = newDes; else delete c.designator;
      c.comment = newCom;
      commit();
    }
  } else if (m.kind === 'track'){
    upsertEdit(m, 'track_edit', { x1:r4(num('x1')), y1:r4(num('y1')), x2:r4(num('x2')), y2:r4(num('y2')),
      w:num('w'), layer:v.layer, ...(v.net.trim() ? { net:v.net.trim() } : {}) }, ['x1','y1','x2','y2','w','layer']);
  } else if (m.kind === 'via'){
    upsertEdit(m, 'via_edit', { x:r4(num('x')), y:r4(num('y')), size:num('size'), drill:num('drill') }, ['x','y']);
  } else if (m.kind === 'arc'){
    upsertEdit(m, 'arc_edit', { cx:r4(num('cx')), cy:r4(num('cy')), r:num('r'), sa:num('sa'), ea:num('ea'),
      w:num('w'), layer:v.layer }, ['cx','cy','r','sa','ea','layer']);
  } else if (m.kind === 'text' && !m.src.designator && !m.src.comment){
    let c = CH.find(c => c.op === 'text_edit' && c.id === m.src.id);
    if (!c){ c = { op:'text_edit', id:m.src.id, orig_x:m.src.x, orig_y:m.src.y, orig_text:m.src.text, orig_layer:m.src.layer, note:'texto no hub' }; CH.push(c); }
    c.text = v.text.replace(/"/g, "'"); c.x = r4(num('x')); c.y = r4(num('y')); c.h = num('h'); c.rot = num('rot');
    commit();
  } else if (m.kind === 'text' && m.src.designator){
    let c = CH.find(c => c.op === 'designator_move' && c.ref === m.src.owner);
    if (!c){ c = { op:'designator_move', ref:m.src.owner, orig_x:m.src.x, orig_y:m.src.y, note:'designator no hub' }; CH.push(c); }
    c.x = r4(num('x')); c.y = r4(num('y')); c.h = num('h'); c.rot = num('rot');
    commit();
  }
  propTarget = null;
});
document.getElementById('propcancel').addEventListener('click', () => {
  document.getElementById('propform').style.display = 'none'; propTarget = null; reapply();
});
cv.addEventListener('dblclick', e => {
  if (tool !== 'select' || annTool) return;
  const w = screenToWorld(e.offsetX, e.offsetY);
  const h = hitTest(w.x, w.y);
  if (h && h.kind !== 'pad' && h.kind !== 'ann') openProps(h);
});
```

(Nota: `commitCompMove` no ramo comp faz um `commit()`; o ajuste de atributos na sequência faz outro — dois níveis de undo para uma edição mista de posição+atributo é aceitável e documentado no help.)

- [ ] **Step 5: rótulo no painel de mudanças** — em `chLabel(ch)`, acrescentar junto dos demais cases:

```js
    case 'comp_attr': return `atributos ${ch.ref}${ch.designator ? ` → ${ch.designator}` : ''}${typeof ch.comment === 'string' ? ` (${ch.comment})` : ''}`;
```

- [ ] **Step 6: Verify** — `node --check pcbframe.js`; `node tests/test-apply.js && node tests/test-serialize.js` seguem OK; manual (pendência): duplo clique em componente edita designator → PCB List destaca; duplo clique em trilha ajusta w; texto livre e designator reposicionáveis.

- [ ] **Step 7: Commit**

```bash
git add pcbframe.html pcbframe.js
git commit -m "Vista PCB: propriedades por duplo clique, hit-test de textos e preview de comp_attr

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Documentação + verificação final

**Files:**
- Modify: `pcbframe.html` (help overlay), `README.md`, `AI-GUIDE.md`

- [ ] **Step 1: help do pcbframe** — no overlay `#help`, na seção "Navegação", acrescentar:

```html
        <h3>Edição</h3>
        <ul>
          <li>Arrastar objeto move (solte para gravar a mudança) · <kbd>Espaço</kbd> rotaciona componente durante o arrasto · <kbd>Ctrl</kbd> desliga o snap</li>
          <li><kbd>T</kbd> trilha (cliques encadeados; botão direito/<kbd>Esc</kbd> encerra) · botão Via · <kbd>Delete</kbd> remove · duplo clique: propriedades</li>
          <li><kbd>Ctrl+Z</kbd>/<kbd>Ctrl+Y</kbd> desfazer/refazer · <b>Salvar changes</b> grava o changes.js</li>
        </ul>
```

- [ ] **Step 2: README** — na tabela "O que é editável", acrescentar a linha `| Designator/Comment (texto) | comp_attr (editar pelo duplo clique no hub) |` e, na seção do hub (vista PCB), uma frase: "A vista PCB agora **edita**: arrastar move objetos, `T` desenha trilhas, duplo clique abre propriedades (inclusive designator/comment), `Ctrl+Z` desfaz e **Salvar changes** grava o `changes.js` — com aviso se a IA tiver gravado o arquivo em paralelo."

- [ ] **Step 3: AI-GUIDE** — (a) na tabela de ops da Parte B, acrescentar a linha:

```markdown
| `comp_attr` | `ref`, `orig_designator`, `orig_comment` | `designator` (novo texto), `comment` (novo texto), `note` |
```

com a nota: "aplicado **por último** pelo ApplyChanges (renomear cedo quebraria os `ref` das ops seguintes); renomear na PCB dessincroniza do esquema — o ECO vai acusar." (b) Na nota "Dois escritores" da Parte B, trocar "(hoje manualmente; a edição pelo hub chega nas próximas fases)" por "(pelo hub — vista PCB — ou manualmente)". (c) Na Parte C item 4, trocar "(sinalizadores pelo hub; os demais, manualmente por enquanto)" por "(sinalizadores e changes.js pelo hub; schematic.js manualmente por enquanto)".

- [ ] **Step 4: Verificação final** — `node tests/test-geom.js && node tests/test-apply.js && node tests/test-serialize.js` OK; `node --check` nos 6 .js; `python -m py_compile hubserver.py`; `git status` limpo.

- [ ] **Step 5: Commit**

```bash
git add pcbframe.html README.md AI-GUIDE.md
git commit -m "Docs: edicao na vista PCB (comp_attr, atalhos) no README, AI-GUIDE e help

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
