# pcbframe como shell fino — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar `pcbframe.html` (53 KB, viewer v1 inline) num shell fino que usa o motor de changes único do `hub-core.js` + um novo `pcbframe.js`, e remover o `viewer.html` órfão da raiz.

**Architecture:** É um refactor de *mover*, não reescrever. O `buildModel` inline do `pcbframe.html` é um fork byte-a-byte do `HubCore.applyPcbChanges` (única diferença: não seta `outlineChanged`) — a troca é drop-in. Os 5 helpers de geometria de preview migram para o `hub-core.js` (com `model` como parâmetro, para serem puros/testáveis); o renderer+UI (~650 linhas, incl. FONTDATA) migra para `pcbframe.js` via script de montagem determinístico por faixas de linha. Wrappers locais no glue (`ownerDelta = ref => HubCore.ownerDelta(model, ref)`) preservam TODOS os call sites do renderer sem edição.

**Tech Stack:** JS vanilla (sem build, sem deps, roda em `file://`), node só para testes/verificação. Spec: `docs/superpowers/specs/2026-08-03-pcbframe-shell-fino-design.md`.

**Estado de partida obrigatório:** branch `v2-esquema`, working tree com UMA modificação: `pcbframe.html` (diff pendente do `outline_set`). Os números de linha das tasks referem-se a esse working tree (arquivo com 1020 linhas).

---

## Mapa do pcbframe.html atual (1020 linhas)

| Linhas | Conteúdo | Destino |
|---|---|---|
| 1–153 | HTML + CSS + markup do body | fica no `pcbframe.html` |
| 154–163 | loader `?p=` (`document.write` dos dados) | fica no `pcbframe.html` |
| 164–166 | `<script>` + `"use strict";` | some (vira IIFE no `pcbframe.js`) |
| 167–175 | `fatal()`, guarda do `board.js`, `B`, `CH` | copia p/ `pcbframe.js` |
| 177–178 | `TOL`/`TOL_ANG` (177) e `MM2MIL` (178) | 177 morre (HubCore tem); `MM2MIL` recriado no glue |
| 180–191 | cores + FONTDATA | copia p/ `pcbframe.js` |
| 193–323 | `model` + `near/nearAng/isNum` + `buildModel()` | **morre** (fork do `applyPcbChanges`) |
| 325–350 | `compDelta/xfPoint/xfAngle/ownerDelta/effLayerForOwner` | **migra** p/ `hub-core.js` (Task 2) |
| 352–774 | vista/canvas/desenho (até antes do `distSeg` local) | copia p/ `pcbframe.js` |
| 775–781 | `distSeg` local | **morre** (HubCore exporta `distSeg`) |
| 782–1017 | hitTest, painéis, PCB List, CSV, toolbar, init | copia p/ `pcbframe.js` |
| 1018–1020 | `</script></body></html>` | substituído pelas tags novas |

---

### Task 1: Commitar o diff pendente do outline_set

**Files:**
- Commit: `pcbframe.html` (modificação já existente no working tree — NÃO alterar nada)

- [ ] **Step 1: Confirmar que o único diff é o esperado**

Run: `git status --short` e `git diff --stat`
Expected: apenas ` M pcbframe.html` / `1 file changed, 15 insertions(+), 2 deletions(-)`. Se houver mais coisa suja, PARAR e perguntar ao usuário.

- [ ] **Step 2: Commit**

```bash
git add pcbframe.html
git commit -m "pcbframe.html: preview do outline_set portado do hub-core

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Helpers de geometria de preview no hub-core.js (TDD)

**Files:**
- Test: `tests/test-geom.js` (novo)
- Modify: `hub-core.js` (inserir após o fim de `applyPcbChanges`, linha 157; editar o `return` da linha 407)

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/test-geom.js` com exatamente:

```js
const assert = require('assert');
const Core = require('../hub-core.js');

// comp em (10,20) rot 0 Top movido p/ (30,40) rot 90 Bottom (flip)
const board = { components:[{ ref:'R1', x:10, y:20, rot:0, layer:'Top' }] };
const moved = Core.applyPcbChanges(board, [{ op:'comp_move', ref:'R1',
  x:30, y:40, rot:90, layer:'Bottom', orig_x:10, orig_y:20, orig_rot:0, orig_layer:'Top' }]);

const d = Core.compDelta(moved.compByRef['R1']);
assert.strictEqual(d.ox, 10); assert.strictEqual(d.nx, 30);
assert.strictEqual(d.dr, 90); assert.strictEqual(d.flip, true);

// ponto 1mm a direita do centro: flip inverte X local -> (-1,0); rot 90 -> (0,-1)
const p = Core.xfPoint(d, 11, 20);
assert.ok(Math.abs(p.x - 30) < 1e-9, 'x esperado 30, veio ' + p.x);
assert.ok(Math.abs(p.y - 39) < 1e-9, 'y esperado 39, veio ' + p.y);

// angulo com flip: 180 - ang + dr
assert.strictEqual(Core.xfAngle(d, 0), 270);

// ownerDelta: null p/ ref vazio, null p/ comp nao movido, delta p/ movido
assert.strictEqual(Core.ownerDelta(moved, ''), null);
const still = Core.applyPcbChanges(board, []);
assert.strictEqual(Core.ownerDelta(still, 'R1'), null);
assert.ok(Core.ownerDelta(moved, 'R1'));

// effLayerForOwner: espelha camadas de overlay quando o dono flipou de lado
assert.strictEqual(Core.effLayerForOwner(moved, 'R1', 'TopOverlay'), 'BottomOverlay');
assert.strictEqual(Core.effLayerForOwner(moved, 'R1', 'Multi'), 'Multi');
assert.strictEqual(Core.effLayerForOwner(still, 'R1', 'TopOverlay'), 'TopOverlay');

console.log('test-geom OK');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/test-geom.js`
Expected: FAIL — `TypeError: Core.compDelta is not a function`

- [ ] **Step 3: Implementar no hub-core.js**

Inserir após a linha 157 (`}` que fecha `applyPcbChanges`, antes do comentário `/* ============ Esquema: ... */` da linha 159). É o código das linhas 325–350 do `pcbframe.html`, com `ownerDelta`/`effLayerForOwner` ganhando `model` como 1º parâmetro (no inline eles fechavam sobre o global `model`):

```js
/* ---- preview de comp movido: transform p/ primitivas do dono (vista PCB) ---- */
function compDelta(m){
  const dr = m.eff.rot - m.src.rot;
  const flip = m.eff.layer !== m.src.layer;
  return { ox:m.src.x, oy:m.src.y, nx:m.eff.x, ny:m.eff.y, dr, flip,
           cos:Math.cos(dr*Math.PI/180), sin:Math.sin(dr*Math.PI/180) };
}
function xfPoint(d, x, y){
  let lx = x - d.ox, ly = y - d.oy;
  if (d.flip) lx = -lx;
  return { x: d.nx + lx*d.cos - ly*d.sin, y: d.ny + lx*d.sin + ly*d.cos };
}
function xfAngle(d, ang){ return d.flip ? (180 - ang + d.dr) : (ang + d.dr); }
function ownerDelta(model, ref){
  if (!ref) return null;
  const m = model.compByRef[ref];
  if (!m || !m.changed) return null;
  return compDelta(m);
}
function effLayerForOwner(model, ref, layer){
  const m = ref ? model.compByRef[ref] : null;
  if (!m || !m.changed) return layer;
  if (m.eff.layer === m.src.layer) return layer;
  const map = { Top:'Bottom', Bottom:'Top', TopOverlay:'BottomOverlay', BottomOverlay:'TopOverlay' };
  return map[layer] || layer;
}
```

No `return` do final do arquivo (linha ~407, que hoje termina com `applyPcbChanges, deriveStatus };`), trocar:

```js
         applyPcbChanges, deriveStatus };
```

por:

```js
         applyPcbChanges, deriveStatus,
         compDelta, xfPoint, xfAngle, ownerDelta, effLayerForOwner };
```

- [ ] **Step 4: Rodar TODOS os testes**

Run: `node tests/test-geom.js && node tests/test-apply.js && node tests/test-netextract.js && node tests/test-validate.js`
Expected: `test-geom OK`, `test-apply OK`, `test-netextract OK`, `test-validate OK`

- [ ] **Step 5: Commit**

```bash
git add hub-core.js tests/test-geom.js
git commit -m "hub-core.js: helpers de preview de comp movido (compDelta/xfPoint/xfAngle/ownerDelta/effLayerForOwner) + teste

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Criar pcbframe.js (montagem por faixas de linha)

**Files:**
- Create: `pcbframe.js`
- Read-only: `pcbframe.html` (fonte das faixas; NÃO modificar nesta task)

- [ ] **Step 1: Verificar as fronteiras de corte**

Run: `sed -n '770,785p' pcbframe.html`
Expected: `function distSeg(` na linha **775**, o `}` que o fecha na **781**, e `function hitTest(` na **782**. Conferir também: `sed -n '1016,1020p' pcbframe.html` → `draw();` na **1017**, `</script>` na **1018**.
Se os números divergirem (ex.: linha 774 for um comentário exclusivo do distSeg), ajustar as constantes de faixa no script do Step 2 de acordo — as âncoras semânticas são: fim do bloco de desenho = linha imediatamente anterior ao `function distSeg`; retomada = linha do `function hitTest`; fim do código = linha do `draw();` final.

- [ ] **Step 2: Rodar o script de montagem**

Salvar como `montar-pcbframe.js` no **scratchpad** (não no repo) e rodar de `z:\AltiumPCBMirror`:

```js
const fs = require('fs');
const L = fs.readFileSync('pcbframe.html', 'utf8').split('\n'); // L[0] = linha 1
const take = (a, b) => L.slice(a - 1, b).join('\n');

const header = `/* AltiumPCBMirror v2 - pcbframe.js — vista PCB (le globals: pcbmirror, changes).
   Motor de changes: HubCore.applyPcbChanges (hub-core.js). Aqui: so renderer + UI. */
"use strict";
(function(){
`;

const glue = `
const MM2MIL = 1/0.0254;
const isNum = HubCore.isNum, distSeg = HubCore.distSeg;

/* modelo efetivo (board + changes) — motor unico, testado em tests/test-apply.js */
const model = HubCore.applyPcbChanges(B, CH);

/* transformacao de preview p/ primitivas de componente movido (HubCore) */
const compDelta = HubCore.compDelta, xfPoint = HubCore.xfPoint, xfAngle = HubCore.xfAngle;
const ownerDelta = (ref) => HubCore.ownerDelta(model, ref);
const effLayerForOwner = (ref, layer) => HubCore.effLayerForOwner(model, ref, layer);
`;

const out = header
  + take(167, 175)          // "dados de entrada": fatal(), guarda do board.js, B, CH
  + '\n' + glue
  + take(180, 191)          // cores padrao + FONTDATA
  + '\n\n' + take(352, 774) // vista/canvas/desenho (ate antes do distSeg local)
  + '\n' + take(782, 1017)  // hitTest ... init (sem o distSeg duplicado)
  + '\n\n})();\n';
fs.writeFileSync('pcbframe.js', out);
console.log('pcbframe.js gerado:', out.split('\n').length, 'linhas');
```

Por que wrappers no glue: `ownerDelta`/`effLayerForOwner` ganharam `model` como parâmetro no HubCore; os wrappers de 1 linha mantêm os ~10 call sites do renderer (linhas 519, 548–549, 601–602, ...) intocados.

- [ ] **Step 3: Checar sintaxe**

Run: `node --check pcbframe.js`
Expected: sem saída (exit 0).

- [ ] **Step 4: Checagens de conteúdo**

Run (cada um com o resultado esperado):
- `grep -c "function buildModel" pcbframe.js` → `0`
- `grep -c "não existe no board.js" pcbframe.js` → `0` (mensagens do motor só existem no hub-core.js)
- `grep -c "applyPcbChanges" pcbframe.js` → `1`
- `grep -c "FONTDATA" pcbframe.js` → deve ser ≥ 2 (a definição e os usos `glyphFor`/`drawStrokeText`)
- `grep -c "function distSeg" pcbframe.js` → `0`

- [ ] **Step 5: Commit**

```bash
git add pcbframe.js
git commit -m "pcbframe.js: renderer e UI da vista PCB extraidos do pcbframe.html, motor via HubCore

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Esvaziar o pcbframe.html (shell fino)

**Files:**
- Modify: `pcbframe.html` (mantém linhas 1–163; substitui 164–1020)

- [ ] **Step 1: Reescrever o arquivo**

Rodar de `z:\AltiumPCBMirror` (script no scratchpad, ex. `esvaziar-pcbframe.js`):

```js
const fs = require('fs');
const L = fs.readFileSync('pcbframe.html', 'utf8').split('\n');
const head = L.slice(0, 163).join('\n'); // linhas 1-163: HTML+CSS+markup+loader ?p=
const tail = `<script src="hub-core.js"></script>
<script src="hub-draw.js"></script>
<script src="pcbframe.js"></script>
</body>
</html>
`;
fs.writeFileSync('pcbframe.html', head + '\n' + tail);
console.log('pcbframe.html enxuto:', (head + '\n' + tail).length, 'bytes');
```

Ordem de execução resultante no browser: loader (154–163) → `document.write` injeta `board.js`/`changes.js` (executam em ordem de documento) → `hub-core.js` → `hub-draw.js` → `pcbframe.js` (que lê os globals `pcbmirror`/`changes` e `HubCore`). Nota: `hub-draw.js` entra por decisão do spec (simetria com `schframe.html`), embora o renderer da PCB não o use hoje.

- [ ] **Step 2: Checagens**

Run (com resultado esperado):
- `grep -c "FONTDATA\|buildModel" pcbframe.html` → `0`
- `grep -c "document.write" pcbframe.html` → `4` (o loader intacto: 2 branches × 2 arquivos)
- `wc -l pcbframe.html` → `168` (163 linhas mantidas + 5 do tail novo)

- [ ] **Step 3: Verificação visual (com o usuário ou navegador local)**

Abrir `hub.html` por duplo clique → card `_DemoKit` → botão **PCB**. Conferir contra o comportamento pré-refactor:
1. placa renderiza (outline, trilhas, vias, pads, silk);
2. fantasma tracejado do `D1` na posição original (o demo tem `comp_move` de D1);
3. painel de mudanças com os itens do `changes.js` do demo, sem erro;
4. tabela PCB List preenchida e ordenável; botão CSV baixa;
5. atalhos: zoom com roda, pan com arrasto, `F` (flip), clique seleciona objeto.

- [ ] **Step 4: Commit**

```bash
git add pcbframe.html
git commit -m "pcbframe.html: shell fino — codigo movido para pcbframe.js, motor unico no hub-core

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Remover viewer.html da raiz e atualizar docs

**Files:**
- Delete: `viewer.html` (SÓ o da raiz — `example/viewer.html` é intocável)
- Modify: `README.md:57-60`, `README.md:100`
- Modify: `AI-GUIDE.md:211-212`

- [ ] **Step 1: Apagar o viewer.html da raiz**

```bash
git rm viewer.html
```

Run: `git status --short example/`
Expected: vazio (nada em `example\` foi tocado).

- [ ] **Step 2: README — estrutura do workspace**

Na tabela de estrutura (linhas 57–60), trocar:

```
├── pcbframe.html            vista PCB (viewer v1 + loader por projeto, em iframe)
├── hub-core.js              lógica pura (parsing, validação, extração de nets, apply)
├── hub-draw.js              renderers canvas compartilhados (símbolo, footprint, PCB)
├── viewer.html              visualizador PCB standalone (usado por example\ e fonte do pcbframe)
```

por:

```
├── pcbframe.html            vista PCB (shell fino, em iframe pelo hub)
├── pcbframe.js              lógica da vista PCB (renderer, painéis, PCB List, CSV)
├── hub-core.js              lógica pura (parsing, validação, nets, motor único de changes)
├── hub-draw.js              renderers canvas compartilhados (símbolo, footprint, PCB)
```

- [ ] **Step 3: README — descrição da vista PCB**

Na linha 100, trocar:

```
- **PCB** — a vista do `viewer.html` v1 integrada, lendo `Projects\<nome>\board.js` e
```

por:

```
- **PCB** — a vista PCB (`pcbframe.html` + `pcbframe.js`; motor no `hub-core.js`), lendo `Projects\<nome>\board.js` e
```

- [ ] **Step 4: AI-GUIDE — fluxo de conferência**

Nas linhas 211–212, trocar:

```
4. Peça ao usuário para conferir no `hub.html` (vista **PCB**, ou `viewer.html` do
   `example\`) — ele valida `orig_*`, mostra o diff e a tabela PCB List pós-mudanças.
```

por:

```
4. Peça ao usuário para conferir no `hub.html` (vista **PCB**) — ele valida `orig_*`,
   mostra o diff e a tabela PCB List pós-mudanças.
```

- [ ] **Step 5: Commit**

```bash
git add README.md AI-GUIDE.md
git commit -m "Remove viewer.html orfao da raiz; docs citam pcbframe.js e motor unico

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Verificação final (critérios de aceite do spec)

- [ ] **Step 1: Suite completa**

Run: `node tests/test-geom.js && node tests/test-apply.js && node tests/test-netextract.js && node tests/test-validate.js && node --check pcbframe.js && node --check hub-core.js`
Expected: 4× OK e nenhum erro de sintaxe.

- [ ] **Step 2: Motor único (aceite do spec)**

Run: `grep -l "não existe no board.js" *.js *.html`
Expected: somente `hub-core.js`. (No `pcbframe.js`, strings de ops como `outline_set` podem aparecer apenas em rótulo de UI — `chLabel` —, nunca num `switch` de aplicação.)

- [ ] **Step 3: Integridade do restante**

Run: `git status --short` (deve estar limpo) e `git log --oneline -6` (deve mostrar os 5 commits das Tasks 1–5 sobre o `f49ccfd` do spec).
Conferir também que `example/viewer.html` ainda existe (`ls example/`) e que abre por
duplo clique renderizando a placa sintética (demo v1 congelada, não usa nada da raiz).

- [ ] **Step 4: Verificação visual final** — repetir o roteiro do Task 4 Step 3 no `hub.html` (vista PCB do `_DemoKit`) e, se disponível, num projeto real re-exportado pelo `ExportBoard`.
