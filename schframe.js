/* AltiumPCBMirror v2 - schframe.js — vista Esquema (le globals: schematic, schlib, pcblib). */
"use strict";
(function(){

const fatal = m => { const f = document.getElementById('fatal'); f.style.display = 'flex'; f.textContent = m; };
if (typeof schematic === 'undefined') { fatal('schematic.js não encontrado para o projeto "' + SCH_P + '".'); return; }
const SLIB = typeof schlib  !== 'undefined' ? schlib  : { symbols:[] };
const PLIB = typeof pcblib  !== 'undefined' ? pcblib  : { footprints:[] };

const model = HubCore.buildSchModel(schematic);
const nets  = HubCore.extractNets(model, SLIB);
const val   = HubCore.validateSchematic(schematic, SLIB, PLIB);
let sheetIdx = 0, selNet = '', selComp = null;
const showState = { grid:true };

document.getElementById('meta').textContent =
  `${schematic.project} · ${model.sheets.length} folha(s) · ${nets.nets.length} nets`;

/* ---------- desenho ---------- */
const D = HubDraw;
function sheetBBox(){
  const s = model.sheets[sheetIdx];
  const sz = HubCore.SHEET_SIZES[s.size] || HubCore.SHEET_SIZES.A4;
  return { x1:0, y1:0, x2:sz[0], y2:sz[1] };
}
function drawWorld(ctx, cam){
  const s = model.sheets[sheetIdx];
  const bb = sheetBBox();
  ctx.fillStyle = D.SCH.sheet;
  ctx.fillRect(bb.x1, bb.y1, bb.x2-bb.x1, bb.y2-bb.y1);
  if (showState.grid && cam.scale > 0.045) {
    ctx.strokeStyle = D.SCH.grid; ctx.lineWidth = 1/cam.scale;
    ctx.beginPath();
    for (let x = 0; x <= bb.x2; x += 100) { ctx.moveTo(x, 0); ctx.lineTo(x, bb.y2); }
    for (let y = 0; y <= bb.y2; y += 100) { ctx.moveTo(0, y); ctx.lineTo(bb.x2, y); }
    ctx.stroke();
  }
  ctx.strokeStyle = D.SCH.border; ctx.lineWidth = 8;
  ctx.strokeRect(bb.x1, bb.y1, bb.x2-bb.x1, bb.y2-bb.y1);

  /* fios */
  s.wires.forEach((w, wi) => {
    const hl = selNet && nets.wireNet[sheetIdx][wi] === selNet;
    ctx.strokeStyle = hl ? D.SCH.hl : D.SCH.wire;
    ctx.lineWidth = hl ? 14 : 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    (w.pts || []).forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.stroke();
  });
  /* junctions explicitas + automaticas */
  for (const j of s.junctions) D.drawJunction(ctx, j.x, j.y);
  for (const j of nets.autoJunctions) if (j.sheet === sheetIdx) D.drawJunction(ctx, j.x, j.y);

  /* componentes */
  for (const c of s.comps) {
    const sym = HubCore.symbolOf(SLIB, c.sym);
    const part = HubCore.partOf(sym, c.part);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(((((c.rot||0)%360)+360)%360) * Math.PI/180);
    if (c.mirror) ctx.scale(-1, 1);
    if (part) D.drawSymbolPart(ctx, part, { stroke: selComp === c.ref ? D.SCH.hl : undefined });
    else { ctx.strokeStyle = '#ff5252'; ctx.strokeRect(-100, -100, 200, 200); }
    ctx.restore();
    const bbref = part ? D.symBBox(part) : { x1:-100, y1:-100, x2:100, y2:100 };
    D.worldText(ctx, c.ref, c.x, c.y + Math.max(Math.abs(bbref.y1), Math.abs(bbref.y2)) + 70, 60, 0,
      selComp === c.ref ? D.SCH.hl : '#000000', 'center');
    if (c.comment)
      D.worldText(ctx, c.comment, c.x, c.y - Math.max(Math.abs(bbref.y1), Math.abs(bbref.y2)) - 70, 55, 0, '#333366', 'center');
  }
  /* pinos destacados da net selecionada */
  if (selNet) {
    for (const c of s.comps) {
      const pins = HubCore.compPinsWorld(c, SLIB) || [];
      for (const p of pins)
        if (nets.pinNet[c.ref + '-' + p.num] === selNet) {
          ctx.strokeStyle = D.SCH.hl; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(p.x, p.y, 35, 0, 2*Math.PI); ctx.stroke();
        }
    }
  }
  /* rotulos e power */
  for (const l of s.netlabels) D.drawNetLabel(ctx, l, selNet === l.net ? D.SCH.hl : undefined);
  for (const p of s.powers)    D.drawPowerPort(ctx, p, selNet === p.net ? D.SCH.hl : undefined);
  for (const t of s.texts)     D.worldText(ctx, t.s || '', t.x, t.y, (t.h || 10) * 6, t.rot || 0, D.SCH.text, 'left');
}
const cam = D.mkCamera(document.getElementById('cv'), drawWorld, {
  bg:'#3a3a34',
  onMove: w => {
    document.getElementById('sx').textContent = w.x.toFixed(0);
    document.getElementById('sy').textContent = w.y.toFixed(0);
    const h = hitTest(w.x, w.y);
    document.getElementById('shover').textContent =
      h ? (h.kind === 'pin' ? `${h.ref}-${h.num} · ${nets.pinNet[h.ref + '-' + h.num] || 'sem net'}`
                            : h.kind === 'wire' ? (nets.wireNet[sheetIdx][h.wi] || 'fio') : h.ref) : '';
  },
  onClick: w => {
    const h = hitTest(w.x, w.y);
    if (!h) { setNet(''); setComp(null); return; }
    if (h.kind === 'pin')  { setComp(h.ref); setNet(nets.pinNet[h.ref + '-' + h.num] || ''); }
    if (h.kind === 'wire') setNet(nets.wireNet[sheetIdx][h.wi] || '');
    if (h.kind === 'comp') { setComp(h.ref); setNet(''); }
  }
});

function hitTest(x, y){
  const s = model.sheets[sheetIdx];
  const tol = 8 / cam.cam.scale;
  for (const c of s.comps) {
    const pins = HubCore.compPinsWorld(c, SLIB) || [];
    for (const p of pins)
      if (Math.hypot(x - p.x, y - p.y) <= Math.max(tol, 30)) return { kind:'pin', ref:c.ref, num:p.num };
  }
  for (let wi = 0; wi < s.wires.length; wi++) {
    const pts = s.wires[wi].pts || [];
    for (let i = 0; i < pts.length - 1; i++)
      if (HubCore.distSeg(x, y, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]) <= Math.max(tol, 20))
        return { kind:'wire', wi };
  }
  for (const c of s.comps) {
    const sym = HubCore.symbolOf(SLIB, c.sym);
    const part = HubCore.partOf(sym, c.part);
    const bb = part ? D.symBBox(part) : { x1:-100, y1:-100, x2:100, y2:100 };
    const r = Math.max(bb.x2 - bb.x1, bb.y2 - bb.y1) / 2 + 50;
    if (Math.hypot(x - c.x, y - c.y) <= r) return { kind:'comp', ref:c.ref };
  }
  return null;
}

/* ---------- paineis ---------- */
function setNet(n){ selNet = n; buildNetList(); cam.draw(); }
function setComp(r){ selComp = r; buildCompTable(); cam.draw(); }
function buildCompTable(){
  const tb = document.querySelector('#comptable tbody');
  tb.innerHTML = '';
  for (const s of model.sheets) for (const c of s.comps) {
    const tr = document.createElement('tr');
    if (c.ref === selComp) tr.className = 'sel';
    tr.innerHTML = `<td>${c.ref}</td><td>${c.sym}</td><td>${c.footprint || '—'}</td><td>${c.comment || ''}</td>`;
    tr.addEventListener('click', () => {
      selComp = c.ref; buildCompTable();
      cam.fit({ x1:c.x-800, y1:c.y-800, x2:c.x+800, y2:c.y+800 });
    });
    tb.appendChild(tr);
  }
}
function buildNetList(){
  document.getElementById('netcount').textContent = nets.nets.length;
  const list = document.getElementById('netlist');
  list.innerHTML = '';
  for (const n of nets.nets) {
    const div = document.createElement('div');
    div.className = 'netitem' + (n.name === selNet ? ' sel' : '');
    div.textContent = `${n.name}${n.auto ? ' (auto)' : ''} — ${n.pins.join(', ')}`;
    div.addEventListener('click', () => setNet(n.name === selNet ? '' : n.name));
    list.appendChild(div);
  }
}
function buildValList(){
  const list = document.getElementById('vallist');
  list.innerHTML = '';
  const items = val.errors.map(m => ({ level:'err', m }))
    .concat(val.warnings.map(m => ({ level:'warn', m })))
    .concat(nets.warnings.map(m => ({ level:'warn', m })));
  if (!items.length) { list.innerHTML = '<div style="color:var(--ok)">✓ sem problemas</div>'; return; }
  for (const it of items) {
    const div = document.createElement('div');
    div.className = 'valitem ' + it.level;
    div.textContent = it.m;
    list.appendChild(div);
  }
}
function buildSheetSel(){
  const sel = document.getElementById('sheetsel');
  sel.innerHTML = '';
  model.sheets.forEach((s, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = `folha: ${s.name} (${s.size})`;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => { sheetIdx = +sel.value; cam.fit(sheetBBox()); });
}

document.getElementById('btnFit').addEventListener('click', () => cam.fit(sheetBBox()));
document.getElementById('btnGrid').addEventListener('click', e => {
  showState.grid = !showState.grid; e.target.classList.toggle('active'); cam.draw();
});

buildSheetSel(); buildCompTable(); buildNetList(); buildValList();
cam.resize(); cam.fit(sheetBBox());

})();
