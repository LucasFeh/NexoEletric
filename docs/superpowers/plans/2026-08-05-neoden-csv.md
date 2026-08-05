# Interface Neoden 4 no hub — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba **Neoden** no hub v2 que gera o CSV da Neoden 4 direto das coordenadas do `board.js` (sem o CSV intermediário do Altium), com paridade exata de pipeline e formato com o `neodenAltium.py` do usuário: referência → relativo → rotação → offset de máquina → move-pós-N → um CSV por lado.

**Architecture:** Transformação/serialização como funções puras em `hub-core.js` (testáveis em node); a aba no `hub.html` (que passa a carregar `hub-core.js`) lê `S.detail.board.components`, mantém o formulário no estado `S.neoden`, mostra a prévia transformada ao vivo e baixa os CSVs via Blob. Visualização fiel + ponto "0" já existem na aba PCB (hook `__hubSelectComp` destaca a referência lá).

**Spec:** `docs/superpowers/specs/2026-08-05-neoden-csv-design.md`. Original de paridade: `D:\MICROCONTROLLER_DEV\MSC - CODIGOS\Neoden4-Altium\neodenAltium.py`.

## Global Constraints

- **Paridade com o script**: ordem relativo→rotação→offset→move; fórmula de rotação idêntica; move-pós-N usa `índice > n` (0-based, igual ao `counter > _move[2]` do script); Rotation do componente NÃO muda com a rotação da placa; saída `Designator,Footprint,Mid X,Mid Y,Layer,Rotation,Comment` + linha `,,,,,,`, X/Y `toFixed(2)+'mm'`, coluna Layer literal `T`, arquivo `<nome>-NEODEN-TopLayer.csv`/`-BottomLayer.csv`.
- Mid X/Y = centro do `bbox` (fallback `x,y`), convenção única documentada na UI.
- Vírgulas em valores viram `_` (paridade com o saneamento de entrada do script).
- Hub: nenhum hex fora do `:root`; sem libs externas; só o painel da aba rola.
- Cadeia: node geom/apply/serialize + novo `tests/test-neoden.js` + `python tests/test_hubapi.py`; `node --check` nos tocados.
- Commits com trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `neodenTransform`/`neodenCsv` no hub-core (TDD)

**Files:**
- Modify: `hub-core.js` (bloco novo antes da seção de status; exports)
- Create: `tests/test-neoden.js`

**Interfaces:**
- Produces: `HubCore.neodenTransform(components, opts) -> { rows, error }` com `opts = { refDes, rot:{ox,oy,angle}?, off:{x,y}?, move:{dx,dy,n}? }` (rows: `{des, footprint, x, y, layer, rot, comment}`, referência em primeiro); `HubCore.neodenCsv(rows, side) -> string` (side `'Top'|'Bottom'`).

- [ ] **Step 1: teste que falha** — criar `tests/test-neoden.js`:

```js
const assert = require('assert');
const Core = require('../hub-core.js');

const comps = [
  { ref:'C1', comment:'100nF', footprint:'C0805', layer:'Top', x:10, y:20, rot:90,
    bbox:{ x1:9, y1:19, x2:11, y2:21 } },
  { ref:'U1', comment:'MCU', footprint:'LQFP48', layer:'Top', x:30, y:40, rot:0,
    bbox:{ x1:26, y1:36, x2:34, y2:44 } },
  { ref:'R1', comment:'10R - 1/4w', footprint:'R0603', layer:'Bottom', x:50, y:60, rot:180 },
];

/* referencia vira (0,0); demais relativos; referencia primeiro na lista */
const t1 = Core.neodenTransform(comps, { refDes:'U1' });
assert.strictEqual(t1.error, null);
assert.strictEqual(t1.rows[0].des, 'U1');
assert.strictEqual(t1.rows[0].x, 0);
assert.strictEqual(t1.rows[0].y, 0);
assert.strictEqual(t1.rows[1].des, 'C1');           /* mid do bbox: (10,20) - (30,40) */
assert.strictEqual(t1.rows[1].x, -20);
assert.strictEqual(t1.rows[1].y, -20);
assert.strictEqual(t1.rows[2].x, 20);               /* R1 sem bbox: usa x,y */
assert.strictEqual(t1.rows[2].y, 20);

/* offset de maquina (paridade com -o 100 140) */
const t2 = Core.neodenTransform(comps, { refDes:'U1', off:{ x:100, y:140 } });
assert.strictEqual(t2.rows[0].x, 100);
assert.strictEqual(t2.rows[0].y, 140);
assert.strictEqual(t2.rows[1].x, 80);

/* rotacao 90 CCW em torno de (0,0) apos relativo: (-20,-20) -> (20,-20) */
const t3 = Core.neodenTransform(comps, { refDes:'U1', rot:{ ox:0, oy:0, angle:90 } });
assert.ok(Math.abs(t3.rows[1].x - 20) < 1e-9);
assert.ok(Math.abs(t3.rows[1].y + 20) < 1e-9);
/* Rotation do componente nao muda */
assert.strictEqual(t3.rows[1].rot, 90);

/* move-pos-N: indice > n (0-based, igual ao script): n=1 move so o indice 2 */
const t4 = Core.neodenTransform(comps, { refDes:'U1', move:{ dx:5, dy:0, n:1 } });
assert.strictEqual(t4.rows[1].x, -20);
assert.strictEqual(t4.rows[2].x, 25);

/* referencia inexistente = erro */
assert.ok(Core.neodenTransform(comps, { refDes:'Z9' }).error);

/* sem refDes: ordem original, sem relativo */
const t5 = Core.neodenTransform(comps, {});
assert.strictEqual(t5.rows[0].des, 'C1');
assert.strictEqual(t5.rows[0].x, 10);

/* CSV: header + linha vazia + filtro por lado + formato NN.NNmm + Layer literal T + virgula vira _ */
const csv = Core.neodenCsv(t2.rows, 'Top');
const lines = csv.trim().split('\n');
assert.strictEqual(lines[0], 'Designator,Footprint,Mid X,Mid Y,Layer,Rotation,Comment');
assert.strictEqual(lines[1], ',,,,,,');
assert.strictEqual(lines[2], 'U1,LQFP48,100.00mm,140.00mm,T,0,MCU');
assert.strictEqual(lines[3], 'C1,C0805,80.00mm,120.00mm,T,90,100nF');
assert.strictEqual(lines.length, 4);                /* R1 e Bottom, fica fora */
const csvB = Core.neodenCsv(Core.neodenTransform(comps, { refDes:'U1' }).rows, 'Bottom');
assert.ok(csvB.indexOf('R1,R0603,20.00mm,20.00mm,T,180,10R - 1/4w') >= 0);
const csvComma = Core.neodenCsv(Core.neodenTransform(
  [{ ref:'X1', comment:'a,b', footprint:'F,P', layer:'Top', x:1, y:2, rot:0 }], {}).rows, 'Top');
assert.ok(csvComma.indexOf('X1,F_P,1.00mm,2.00mm,T,0,a_b') >= 0);

console.log('test-neoden OK');
```

- [ ] **Step 2: rodar e ver falhar** — `node tests/test-neoden.js` → `neodenTransform is not a function`.
- [ ] **Step 3: implementar** — em `hub-core.js`, antes de `/* ============ status do projeto na esteira ============ */`:

```js
/* ============ Neoden 4: pick-and-place (paridade com neodenAltium.py) ============ */

function neodenMid(c){
  const b = c.bbox;
  if (b && isNum(b.x1) && isNum(b.y1) && isNum(b.x2) && isNum(b.y2))
    return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
  return { x: c.x, y: c.y };
}
function neodenRotatePt(ox, oy, px, py, angle){
  const a = angle * Math.PI / 180;
  return { x: ox + Math.cos(a) * (px - ox) - Math.sin(a) * (py - oy),
           y: oy + Math.sin(a) * (px - ox) + Math.cos(a) * (py - oy) };
}
function neodenTransform(components, opts){
  const o = opts || {};
  const comps = (components || []).slice();
  let ordered = comps;
  if (o.refDes){
    const ref = comps.find(c => c.ref === o.refDes);
    if (!ref) return { rows: null, error: `referência "${o.refDes}" não existe no board.js` };
    ordered = [ref].concat(comps.filter(c => c !== ref));
  }
  const rows = ordered.map(c => {
    const m = neodenMid(c);
    return { des: c.ref, footprint: c.footprint || '', x: m.x, y: m.y,
             layer: c.layer, rot: c.rot || 0, comment: c.comment || '' };
  });
  if (o.refDes){                                       /* -r: relativo à referência */
    const rx = rows[0].x, ry = rows[0].y;
    for (const r of rows){ r.x -= rx; r.y -= ry; }
  }
  if (o.rot && isNum(o.rot.angle) && o.rot.angle){     /* -a ox oy ang */
    for (const r of rows){
      const q = neodenRotatePt(o.rot.ox || 0, o.rot.oy || 0, r.x, r.y, o.rot.angle);
      r.x = q.x; r.y = q.y;
    }
  }
  if (o.off && (isNum(o.off.x) || isNum(o.off.y))){    /* -o x y */
    for (const r of rows){ r.x += o.off.x || 0; r.y += o.off.y || 0; }
  }
  if (o.move && isNum(o.move.n) && (isNum(o.move.dx) || isNum(o.move.dy))){  /* -m dx dy n */
    rows.forEach((r, i) => { if (i > o.move.n){ r.x += o.move.dx || 0; r.y += o.move.dy || 0; } });
  }
  return { rows, error: null };
}
function neodenCsv(rows, side){
  const clean = v => String(v).replace(/,/g, '_');
  const L = ['Designator,Footprint,Mid X,Mid Y,Layer,Rotation,Comment', ',,,,,,'];
  for (const r of (rows || [])){
    if (r.layer !== side) continue;
    L.push([clean(r.des), clean(r.footprint), r.x.toFixed(2) + 'mm', r.y.toFixed(2) + 'mm',
            'T', clean(r.rot), clean(r.comment)].join(','));
  }
  return L.join('\n') + '\n';
}
```

Exports: acrescentar `neodenTransform, neodenCsv,` ao `return` final.
- [ ] **Step 4: verde + cadeia** — `node tests/test-neoden.js && node tests/test-geom.js && node tests/test-apply.js && node tests/test-serialize.js` OK.
- [ ] **Step 5: Commit** — `hub-core: transformacao e CSV Neoden 4 (paridade com neodenAltium.py)` + trailer.

---

### Task 2: Aba Neoden no hub

**Files:**
- Modify: `hub.html`

- [ ] **Step 1: carregar o motor** — no `<head>` do hub.html, após o `<link>` da fonte: `<script src="hub-core.js"></script>` (file://-safe; expõe `HubCore`).
- [ ] **Step 2: aba + pane** — em `TABS`, após `fp`: `{ id:'neoden', label:'Neoden' }`. No `<main>`, após o pane `fp`:

```html
    <div class="pane" data-pane="neoden">
      <div class="comp-grid">
        <div class="comp-left">
          <div class="comp-bar" style="flex-wrap:wrap; gap:8px 10px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-3)">referência
              <select id="ndRef" class="input" style="width:130px;min-height:30px"></select></label>
            <button class="btn btn-secondary btn-sm" id="ndSee">Ver no PCB</button>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-3)">máquina X
              <input id="ndOffX" class="input mono" type="number" step="any" value="0" style="width:90px;min-height:30px"></label>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-3)">Y
              <input id="ndOffY" class="input mono" type="number" step="any" value="0" style="width:90px;min-height:30px"></label>
            <span class="count" id="ndCount"></span>
            <button class="btn btn-primary btn-sm" style="margin-left:auto" id="ndTop">Baixar TopLayer</button>
            <button class="btn btn-secondary btn-sm" id="ndBottom">Baixar BottomLayer</button>
          </div>
          <div class="comp-bar" style="padding-top:0">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-3)">rotação
              <input id="ndRotAng" class="input mono" type="number" step="any" value="0" style="width:70px;min-height:30px" title="ângulo CCW (graus)"></label>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-3)">em torno de
              <input id="ndRotOx" class="input mono" type="number" step="any" value="0" style="width:70px;min-height:30px">
              <input id="ndRotOy" class="input mono" type="number" step="any" value="0" style="width:70px;min-height:30px"></label>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-3)">mover dx/dy após N
              <input id="ndMvDx" class="input mono" type="number" step="any" value="0" style="width:70px;min-height:30px">
              <input id="ndMvDy" class="input mono" type="number" step="any" value="0" style="width:70px;min-height:30px">
              <input id="ndMvN" class="input mono" type="number" step="1" value="0" style="width:56px;min-height:30px" title="índices > N movem (0 = todos menos a referência), igual ao -m do script"></label>
          </div>
          <div class="scroll" style="padding:0 6px 18px 18px">
            <table>
              <thead><tr>
                <th style="width:78px">Desig.</th><th>Footprint</th><th class="r" style="width:96px">Mid X</th>
                <th class="r" style="width:96px">Mid Y</th><th style="width:56px">Lado</th>
                <th class="r" style="width:56px">Rot</th><th style="width:120px">Comment</th>
              </tr></thead>
              <tbody id="ndRows"></tbody>
            </table>
          </div>
        </div>
        <aside id="ndAside"></aside>
      </div>
    </div>
```

- [ ] **Step 3: render + download** — no script do hub.html:
  - Estado: `neoden: { refDes:null }` em `S` (os demais valores são lidos dos inputs a cada render — sem estado duplicado).
  - `neodenOpts()`: monta `{ refDes:S.neoden.refDes, off:{x:+ndOffX.value||0, y:+ndOffY.value||0}, rot:(+ndRotAng.value ? { ox:+ndRotOx.value||0, oy:+ndRotOy.value||0, angle:+ndRotAng.value } : null), move:((+ndMvDx.value||+ndMvDy.value) ? { dx:+ndMvDx.value||0, dy:+ndMvDy.value||0, n:+ndMvN.value||0 } : null) }`.
  - `renderNeoden()`: comps = `(S.detail.board && S.detail.board.components) || []`. Vazio → pane mostra `.empty` com tag `sem board.js` e frase "Rode ExportPcb no Altium para gerar as coordenadas." e retorna. Senão: popular `#ndRef` (options = refs; default `S.neoden.refDes` ou o primeiro ref), rodar `HubCore.neodenTransform(comps, neodenOpts())`, exibir erro (se houver) no `#ndCount`, senão preencher `#ndRows` (des mono, x/y `toFixed(2)`, lado, rot, comment — células por `textContent`) e `#ndCount` = `N componentes · referência <ref> = (offX, offY)`. `#ndAside`: kicker `neoden`, resumo do pipeline (relativo → rotação → offset → move) com os valores atuais e a nota "Mid X/Y = centro do bbox de cobre; ponto 0 da placa visível na aba PCB (origem)".
  - Listeners: `change`/`input` nos 8 inputs → `renderNeoden()`; `#ndRef` change atualiza `S.neoden.refDes`; `#ndSee` → `S.tab='pcb'; renderTabs(); renderPanes();` + chamada `__hubSelectComp(S.neoden.refDes)` no iframe (mesmo padrão try/catch + onload dos botões "Ver no PCB" existentes); `#ndTop`/`#ndBottom` → `neodenCsv(rows, 'Top'|'Bottom')` + Blob download `sanitizeName(proj().name) + '-NEODEN-TopLayer.csv'` (sanitize: `replace(/[\\/:*?"<>|]/g,'_')`).
  - `renderPanes()`: ramo `if (S.tab === 'neoden') return renderNeoden();`.
  - Ao trocar de projeto (`loadProject`): `S.neoden.refDes = null` (re-derivado no próximo render).
- [ ] **Step 4: Verify** — `node --check` no script extraído; vm/jsdom harness: pane renderiza com dados reais do MID (166 comps), transform reage aos inputs, CSV baixável bate com `neodenCsv` puro; projeto sem board mostra o estado vazio.
- [ ] **Step 5: Commit** — `Hub v2: aba Neoden (referencia, offset de maquina, rotacao, CSV por lado)` + trailer.

---

### Task 3: Docs + verificação final

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** README — na seção do hub v2, acrescentar a aba Neoden: gera o CSV da Neoden 4 direto do espelho (sem Pick&Place intermediário), com referência escolhida + coordenadas de máquina, rotação e move-pós-N — paridade com o `neodenAltium.py`; arquivos `<nome>-NEODEN-<lado>.csv`.
- [ ] **Step 2:** cadeia completa: node geom/apply/serialize/neoden + `python tests/test_hubapi.py` + `node --check` + `py_compile`; `git status` limpo (exceto os arquivos do usuário em `Projects/TCMS_Reader_V2/`, que não são nossos).
- [ ] **Step 3: Commit** — `Docs: aba Neoden no README` + trailer.
