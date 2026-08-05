/* AltiumPCBMirror v2 - schframe.js — vista Esquema (le globals: schematic, schlib, pcblib). */
"use strict";
(function(){

const fatal = m => { const f = document.getElementById('fatal'); f.style.display = 'flex'; f.textContent = m; };
if (typeof schematic === 'undefined') { fatal('schematic.js não encontrado para o projeto "' + SCH_P + '".'); return; }
const SLIB = typeof schlib  !== 'undefined' ? schlib  : { symbols:[] };
const PLIB = typeof pcblib  !== 'undefined' ? pcblib  : { footprints:[] };

let model = HubCore.buildSchModel(schematic);
let nets  = HubCore.extractNets(model, SLIB);
let val   = HubCore.validateSchematic(schematic, SLIB, PLIB);
let sheetIdx = 0, selNet = '', selComp = null;
const showState = { grid:true };
const ANN = (typeof annotations !== 'undefined' && Array.isArray(annotations))
  ? annotations.map(a => ({ ...a })) : [];
const ANN_COLORS = { err:'#ff5252', warn:'#ffd54f', info:'#4fc3f7' };
let annTool = false, annDirty = false, annPending = null, staleWorkspace = false;

/* ------- infra de edicao ------- */
let selItem = null;                     /* { kind:'comp|wire|netlabel|power|junction|text', item } */
let dragState = null;                   /* { kind, item, start:{x,y}, base } — arrasto em curso */
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
document.getElementById('toolSelect').addEventListener('click', () => setSchTool('select'));

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
document.getElementById('cv').addEventListener('contextmenu', e => { e.preventDefault(); if (wireDraw) endWire(); });

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
}
const cam = D.mkCamera(document.getElementById('cv'), drawWorld, {
  bg:'#3a3a34',
  onMove: w => {
    hoverW = w; if (placing) cam.draw();
    if (wireDraw) cam.draw();
    document.getElementById('sx').textContent = w.x.toFixed(0);
    document.getElementById('sy').textContent = w.y.toFixed(0);
    const h = hitTest(w.x, w.y);
    document.getElementById('shover').textContent =
      h ? (h.kind === 'pin' ? `${h.ref}-${h.num} · ${nets.pinNet[h.ref + '-' + h.num] || 'sem net'}`
                            : h.kind === 'wire' ? (nets.wireNet[sheetIdx][h.wi] || 'fio') : h.ref) : '';
  },
  onClick: w => {
    if (annTool){ openAnnForm(w); return; }
    if (placing){ placeComp(w); return; }
    if (schTool === 'wire'){ if (!wireDraw) wireDraw = { pts:[] }; wireDraw.pts.push(wirePoint(w)); cam.draw(); return; }
    if (schTool === 'junction'){ schematic.items.push({ t:'junction', sheet:model.sheets[sheetIdx].name, x:snap100(w.x), y:snap100(w.y) }); commit(); return; }
    if ((schTool === 'netlabel' || schTool === 'power' || schTool === 'text') && placeKind){ placeAt(w); return; }
    const h = hitTest(w.x, w.y);
    if (!h) { setNet(''); setComp(null); return; }
    if (h.kind === 'pin')  { setComp(h.ref); setNet(nets.pinNet[h.ref + '-' + h.num] || ''); }
    if (h.kind === 'wire') setNet(nets.wireNet[sheetIdx][h.wi] || '');
    if (h.kind === 'comp') { setComp(h.ref); setNet(''); }
    selItem = h && h.kind !== 'pin' ? { kind:h.kind, item:h.item } : (h && h.kind === 'pin' ? { kind:'comp', item:h.item } : null);
    cam.draw();
  },
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
});

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
  if (staleWorkspace && !confirm('O workspace mudou desde o carregamento — salvar vai sobrescrever o annotations.js do disco. Continuar?')) return;
  const out = HubCore.serializeAnnotations(ANN);
  if (!out.text){ alert('Sinalizadores inválidos:\n' + out.errors.map(e => e.msg).join('\n')); return; }
  const rel = 'Projects/' + SCH_P + '/annotations.js';
  try {
    const r = await HubIO.saveFile(rel, out.text);
    setAnnDirty(false);
    staleWorkspace = false;
    document.getElementById('annmsg').textContent =
      r.mode === 'server' ? '✓ sinalizadores salvos' : '↓ arquivo baixado — substitua ' + rel;
  } catch (err) {
    if (confirm('Salvar no servidor falhou: ' + err.message + '\nBaixar o arquivo em vez disso?'))
      HubIO.download('annotations.js', out.text);
  }
}
document.getElementById('btnAnn').addEventListener('click', () => setAnnTool(!annTool));
document.getElementById('btnAnnSave').addEventListener('click', saveAnnotations);
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (wireDraw){ wireDraw = null; cam.draw(); return; }
    if (document.getElementById('pickform').style.display === 'block'){ closePicker(); return; }
    if (placing){ placing = null; document.getElementById('cv').style.cursor = 'crosshair'; cam.draw(); return; }
    if (dragState){
      const d = dragState; dragState = null;
      if (d.kind === 'wire') d.item.pts = d.base.map(p => [p[0], p[1]]);
      else { d.item.x = d.base.x; d.item.y = d.base.y; }
      cam.draw(); return;
    }
    selItem = null; setSchTool('select');
    setAnnTool(false); return;
  }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 'z'){ e.preventDefault(); undo(); return; }
  if (e.ctrlKey && k === 'y'){ e.preventDefault(); redo(); return; }
  if (e.key === 'Delete' && selItem){
    const i = schematic.items.indexOf(selItem.item);
    if (i >= 0){ schematic.items.splice(i, 1); selItem = null; selComp = null; commit(); }
    return;
  }
  if (e.key === ' ' && placing){ e.preventDefault(); placing.rot = (placing.rot + 90) % 360; cam.draw(); return; }
  if (k === 'x' && placing){ placing.mirror = !placing.mirror; cam.draw(); return; }
  if (k === 'c' && !placing){ openPicker(); return; }
  if (k === 'w') setSchTool(schTool === 'wire' ? 'select' : 'wire');
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
  if (k === 'n') setAnnTool(!annTool);
});
window.__hubOnChange = function(){
  if (!annDirty && !schDirty){ location.reload(); return; }
  staleWorkspace = true;
  document.getElementById('annmsg').textContent = '⚠ workspace mudou — salve e recarregue (F5)';
};
window.__hubDirty = function(){ return annDirty || schDirty; };
window.addEventListener('beforeunload', e => { if (annDirty || schDirty){ e.preventDefault(); e.returnValue = ''; } });

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

buildSheetSel(); buildCompTable(); buildNetList(); buildValList(); buildAnnPanel();
cam.resize(); cam.fit(sheetBBox());

})();
