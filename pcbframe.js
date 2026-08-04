/* AltiumPCBMirror v2 - pcbframe.js — vista PCB (le globals: pcbmirror, changes).
   Motor de changes: HubCore.applyPcbChanges (hub-core.js). Aqui: so renderer + UI. */
"use strict";
(function(){
/* ============================== dados de entrada ============================== */

const fatal = (m)=>{ const f=document.getElementById('fatal'); f.style.display='flex'; f.textContent=m; };
if (typeof pcbmirror === 'undefined') {
  fatal('board.js não encontrado (ou inválido). Rode o ExportBoard no Altium nesta pasta.');
  throw new Error('no board.js');
}
const B = pcbmirror;
const CH = (typeof changes !== 'undefined' && Array.isArray(changes)) ? changes : [];
const ANN = (typeof annotations !== 'undefined' && Array.isArray(annotations))
  ? annotations.map(a => ({ ...a })) : [];
const ANN_COLORS = { err:'#ff5252', warn:'#ffd54f', info:'#4fc3f7' };
/* ------- ferramenta Sinalizar + persistencia ------- */
let annTool = false, annDirty = false, annPending = null, staleWorkspace = false;

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
  if (staleWorkspace && !confirm('O workspace mudou desde o carregamento — salvar vai sobrescrever o annotations.js do disco. Continuar?')) return;
  const out = HubCore.serializeAnnotations(ANN);
  if (!out.text){ alert('Sinalizadores inválidos:\n' + out.errors.map(e => e.msg).join('\n')); return; }
  const rel = PCB_P ? 'Projects/' + PCB_P + '/annotations.js' : 'annotations.js';
  const msg = document.getElementById('annmsg');
  try {
    const r = await HubIO.saveFile(rel, out.text);
    setAnnDirty(false);
    staleWorkspace = false;
    msg.textContent = r.mode === 'server' ? '✓ sinalizadores salvos' : '↓ arquivo baixado — substitua ' + rel;
  } catch (err) {
    if (confirm('Salvar no servidor falhou: ' + err.message + '\nBaixar o arquivo em vez disso?'))
      HubIO.download('annotations.js', out.text);
  }
}
document.getElementById('btnAnn').addEventListener('click', () => setAnnTool(!annTool));
document.getElementById('btnAnnSave').addEventListener('click', saveAnnotations);
document.getElementById('btnChSave').addEventListener('click', saveChanges);

/* reload escopado do hubserver + aviso ao fechar com trabalho nao salvo */
window.__hubOnChange = function(){
  if (!annDirty && !chDirty){ location.reload(); return; }
  staleWorkspace = true;
  document.getElementById('annmsg').textContent = '⚠ workspace mudou — salve e recarregue (F5)';
};
window.__hubDirty = function(){ return annDirty || chDirty; };
window.addEventListener('beforeunload', e => { if (annDirty || chDirty){ e.preventDefault(); e.returnValue = ''; } });

const MM2MIL = 1/0.0254;
const isNum = HubCore.isNum, distSeg = HubCore.distSeg;
const near = HubCore.near, nearAng = HubCore.nearAng;

/* modelo efetivo (board + changes) — motor unico, testado em tests/test-apply.js */
let model = HubCore.applyPcbChanges(B, CH);

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

/* transformacao de preview p/ primitivas de componente movido (HubCore) */
const compDelta = HubCore.compDelta, xfPoint = HubCore.xfPoint, xfAngle = HubCore.xfAngle;
const ownerDelta = (ref) => HubCore.ownerDelta(model, ref);
const effLayerForOwner = (ref, layer) => HubCore.effLayerForOwner(model, ref, layer);
/* Cores padrão do ambiente 2D do Altium */
const LAYER_COLORS = {
  Top:'#ff0000', Bottom:'#0a0aff', TopOverlay:'#ffff00', BottomOverlay:'#b4b400',
  Multi:'#c0c0c0', Mech1:'#ff00ff', KeepOut:'#c800c8'
};
const COLOR_BOARD='#101010', COLOR_OUTLINE='#9e9e9e', COLOR_GRID='#262626', COLOR_GRID2='#333333',
      COLOR_ORIGIN='#e0e0e0', COLOR_HOLE='#000000', COLOR_ADD='#00e676', COLOR_DEL='#ff5252',
      COLOR_SEL='#ffffff';

/* ============================== fonte vetorial (stroke) ============================== */
/* Dados de fonte do InteractiveHtmlBom (MIT). Convenção: Y negativo = para cima; escala = altura do caractere. */
const FONTDATA = {"0":{"l":[[[0.428571,-1.047619],[0.52381,-1.047619],[0.619048,-1],[0.666667,-0.952381],[0.714286,-0.857143],[0.761905,-0.666667],[0.761905,-0.428571],[0.714286,-0.238095],[0.666667,-0.142857],[0.619048,-0.095238],[0.52381,-0.047619],[0.428571,-0.047619],[0.333333,-0.095238],[0.285714,-0.142857],[0.238095,-0.238095],[0.190476,-0.428571],[0.190476,-0.666667],[0.238095,-0.857143],[0.285714,-0.952381],[0.333333,-1],[0.428571,-1.047619]]],"w":0.952381},"1":{"l":[[[0.761905,-0.047619],[0.190476,-0.047619]],[[0.47619,-0.047619],[0.47619,-1.047619],[0.380952,-0.904762],[0.285714,-0.809524],[0.190476,-0.761905]]],"w":0.952381},"2":{"l":[[[0.190476,-0.952381],[0.238095,-1],[0.333333,-1.047619],[0.571429,-1.047619],[0.666667,-1],[0.714286,-0.952381],[0.761905,-0.857143],[0.761905,-0.761905],[0.714286,-0.619048],[0.142857,-0.047619],[0.761905,-0.047619]]],"w":0.952381},"3":{"l":[[[0.142857,-1.047619],[0.761905,-1.047619],[0.428571,-0.666667],[0.571429,-0.666667],[0.666667,-0.619048],[0.714286,-0.571429],[0.761905,-0.47619],[0.761905,-0.238095],[0.714286,-0.142857],[0.666667,-0.095238],[0.571429,-0.047619],[0.285714,-0.047619],[0.190476,-0.095238],[0.142857,-0.142857]]],"w":0.952381},"4":{"l":[[[0.666667,-0.714286],[0.666667,-0.047619]],[[0.428571,-1.095238],[0.190476,-0.380952],[0.809524,-0.380952]]],"w":0.952381},"5":{"l":[[[0.714286,-1.047619],[0.238095,-1.047619],[0.190476,-0.571429],[0.238095,-0.619048],[0.333333,-0.666667],[0.571429,-0.666667],[0.666667,-0.619048],[0.714286,-0.571429],[0.761905,-0.47619],[0.761905,-0.238095],[0.714286,-0.142857],[0.666667,-0.095238],[0.571429,-0.047619],[0.333333,-0.047619],[0.238095,-0.095238],[0.190476,-0.142857]]],"w":0.952381},"6":{"l":[[[0.666667,-1.047619],[0.47619,-1.047619],[0.380952,-1],[0.333333,-0.952381],[0.238095,-0.809524],[0.190476,-0.619048],[0.190476,-0.238095],[0.238095,-0.142857],[0.285714,-0.095238],[0.380952,-0.047619],[0.571429,-0.047619],[0.666667,-0.095238],[0.714286,-0.142857],[0.761905,-0.238095],[0.761905,-0.47619],[0.714286,-0.571429],[0.666667,-0.619048],[0.571429,-0.666667],[0.380952,-0.666667],[0.285714,-0.619048],[0.238095,-0.571429],[0.190476,-0.47619]]],"w":0.952381},"7":{"l":[[[0.142857,-1.047619],[0.809524,-1.047619],[0.380952,-0.047619]]],"w":0.952381},"8":{"l":[[[0.380952,-0.619048],[0.285714,-0.666667],[0.238095,-0.714286],[0.190476,-0.809524],[0.190476,-0.857143],[0.238095,-0.952381],[0.285714,-1],[0.380952,-1.047619],[0.571429,-1.047619],[0.666667,-1],[0.714286,-0.952381],[0.761905,-0.857143],[0.761905,-0.809524],[0.714286,-0.714286],[0.666667,-0.666667],[0.571429,-0.619048],[0.380952,-0.619048],[0.285714,-0.571429],[0.238095,-0.52381],[0.190476,-0.428571],[0.190476,-0.238095],[0.238095,-0.142857],[0.285714,-0.095238],[0.380952,-0.047619],[0.571429,-0.047619],[0.666667,-0.095238],[0.714286,-0.142857],[0.761905,-0.238095],[0.761905,-0.428571],[0.714286,-0.52381],[0.666667,-0.571429],[0.571429,-0.619048]]],"w":0.952381},"9":{"l":[[[0.285714,-0.047619],[0.47619,-0.047619],[0.571429,-0.095238],[0.619048,-0.142857],[0.714286,-0.285714],[0.761905,-0.47619],[0.761905,-0.857143],[0.714286,-0.952381],[0.666667,-1],[0.571429,-1.047619],[0.380952,-1.047619],[0.285714,-1],[0.238095,-0.952381],[0.190476,-0.857143],[0.190476,-0.619048],[0.238095,-0.52381],[0.285714,-0.47619],[0.380952,-0.428571],[0.571429,-0.428571],[0.666667,-0.47619],[0.714286,-0.52381],[0.761905,-0.619048]]],"w":0.952381},"V":{"l":[[[0.095238,-1.047619],[0.428571,-0.047619],[0.761905,-1.047619]]],"w":0.857143},"-":{"l":[[[0.238095,-0.428571],[1,-0.428571]]],"w":1.238095},",":{"l":[[[0.285714,-0.095238],[0.285714,-0.047619],[0.238095,0.047619],[0.190476,0.095238]]],"w":0.47619},"/":{"l":[[[0.952381,-1.095238],[0.095238,0.190476]]],"w":1.047619},".":{"l":[[[0.238095,-0.142857],[0.285714,-0.095238],[0.238095,-0.047619],[0.190476,-0.095238],[0.238095,-0.142857],[0.238095,-0.047619]]],"w":0.47619},"µ":{"l":[[[0.238095,-0.714286],[0.238095,0.285714]],[[0.714286,-0.190476],[0.761905,-0.095238],[0.857143,-0.047619]],[[0.238095,-0.190476],[0.285714,-0.095238],[0.380952,-0.047619],[0.571429,-0.047619],[0.666667,-0.095238],[0.714286,-0.190476],[0.714286,-0.714286]]],"w":1.047619},"A":{"l":[[[0.190476,-0.333333],[0.666667,-0.333333]],[[0.095238,-0.047619],[0.428571,-1.047619],[0.761905,-0.047619]]],"w":0.857143},"C":{"l":[[[0.809524,-0.142857],[0.761905,-0.095238],[0.619048,-0.047619],[0.52381,-0.047619],[0.380952,-0.095238],[0.285714,-0.190476],[0.238095,-0.285714],[0.190476,-0.47619],[0.190476,-0.619048],[0.238095,-0.809524],[0.285714,-0.904762],[0.380952,-1],[0.52381,-1.047619],[0.619048,-1.047619],[0.761905,-1],[0.809524,-0.952381]]],"w":1},"B":{"l":[[[0.571429,-0.571429],[0.714286,-0.52381],[0.761905,-0.47619],[0.809524,-0.380952],[0.809524,-0.238095],[0.761905,-0.142857],[0.714286,-0.095238],[0.619048,-0.047619],[0.238095,-0.047619],[0.238095,-1.047619],[0.571429,-1.047619],[0.666667,-1],[0.714286,-0.952381],[0.761905,-0.857143],[0.761905,-0.761905],[0.714286,-0.666667],[0.666667,-0.619048],[0.571429,-0.571429],[0.238095,-0.571429]]],"w":1},"E":{"l":[[[0.238095,-0.571429],[0.571429,-0.571429]],[[0.714286,-0.047619],[0.238095,-0.047619],[0.238095,-1.047619],[0.714286,-1.047619]]],"w":0.904762},"D":{"l":[[[0.238095,-0.047619],[0.238095,-1.047619],[0.47619,-1.047619],[0.619048,-1],[0.714286,-0.904762],[0.761905,-0.809524],[0.809524,-0.619048],[0.809524,-0.47619],[0.761905,-0.285714],[0.714286,-0.190476],[0.619048,-0.095238],[0.47619,-0.047619],[0.238095,-0.047619]]],"w":1},"G":{"l":[[[0.761905,-1],[0.666667,-1.047619],[0.52381,-1.047619],[0.380952,-1],[0.285714,-0.904762],[0.238095,-0.809524],[0.190476,-0.619048],[0.190476,-0.47619],[0.238095,-0.285714],[0.285714,-0.190476],[0.380952,-0.095238],[0.52381,-0.047619],[0.619048,-0.047619],[0.761905,-0.095238],[0.809524,-0.142857],[0.809524,-0.47619],[0.619048,-0.47619]]],"w":1},"F":{"l":[[[0.571429,-0.571429],[0.238095,-0.571429]],[[0.238095,-0.047619],[0.238095,-1.047619],[0.714286,-1.047619]]],"w":0.857143},"I":{"l":[[[0.238095,-0.047619],[0.238095,-1.047619]]],"w":0.47619},"H":{"l":[[[0.238095,-0.047619],[0.238095,-1.047619]],[[0.238095,-0.571429],[0.809524,-0.571429]],[[0.809524,-0.047619],[0.809524,-1.047619]]],"w":1.047619},"K":{"l":[[[0.238095,-0.047619],[0.238095,-1.047619]],[[0.809524,-0.047619],[0.380952,-0.619048]],[[0.809524,-1.047619],[0.238095,-0.47619]]],"w":1},"J":{"l":[[[0.52381,-1.047619],[0.52381,-0.333333],[0.47619,-0.190476],[0.380952,-0.095238],[0.238095,-0.047619],[0.142857,-0.047619]]],"w":0.761905},"M":{"l":[[[0.238095,-0.047619],[0.238095,-1.047619],[0.571429,-0.333333],[0.904762,-1.047619],[0.904762,-0.047619]]],"w":1.142857},"L":{"l":[[[0.714286,-0.047619],[0.238095,-0.047619],[0.238095,-1.047619]]],"w":0.809524},"O":{"l":[[[0.428571,-1.047619],[0.619048,-1.047619],[0.714286,-1],[0.809524,-0.904762],[0.857143,-0.714286],[0.857143,-0.380952],[0.809524,-0.190476],[0.714286,-0.095238],[0.619048,-0.047619],[0.428571,-0.047619],[0.333333,-0.095238],[0.238095,-0.190476],[0.190476,-0.380952],[0.190476,-0.714286],[0.238095,-0.904762],[0.333333,-1],[0.428571,-1.047619]]],"w":1.047619},"N":{"l":[[[0.238095,-0.047619],[0.238095,-1.047619],[0.809524,-0.047619],[0.809524,-1.047619]]],"w":1.047619},"Q":{"l":[[[0.904762,0.047619],[0.809524,0],[0.714286,-0.095238],[0.571429,-0.238095],[0.47619,-0.285714],[0.380952,-0.285714]],[[0.428571,-0.047619],[0.333333,-0.095238],[0.238095,-0.190476],[0.190476,-0.380952],[0.190476,-0.714286],[0.238095,-0.904762],[0.333333,-1],[0.428571,-1.047619],[0.619048,-1.047619],[0.714286,-1],[0.809524,-0.904762],[0.857143,-0.714286],[0.857143,-0.380952],[0.809524,-0.190476],[0.714286,-0.095238],[0.619048,-0.047619],[0.428571,-0.047619]]],"w":1.047619},"P":{"l":[[[0.238095,-0.047619],[0.238095,-1.047619],[0.619048,-1.047619],[0.714286,-1],[0.761905,-0.952381],[0.809524,-0.857143],[0.809524,-0.714286],[0.761905,-0.619048],[0.714286,-0.571429],[0.619048,-0.52381],[0.238095,-0.52381]]],"w":1},"S":{"l":[[[0.190476,-0.095238],[0.333333,-0.047619],[0.571429,-0.047619],[0.666667,-0.095238],[0.714286,-0.142857],[0.761905,-0.238095],[0.761905,-0.333333],[0.714286,-0.428571],[0.666667,-0.47619],[0.571429,-0.52381],[0.380952,-0.571429],[0.285714,-0.619048],[0.238095,-0.666667],[0.190476,-0.761905],[0.190476,-0.857143],[0.238095,-0.952381],[0.285714,-1],[0.380952,-1.047619],[0.619048,-1.047619],[0.761905,-1]]],"w":0.952381},"R":{"l":[[[0.809524,-0.047619],[0.47619,-0.52381]],[[0.238095,-0.047619],[0.238095,-1.047619],[0.619048,-1.047619],[0.714286,-1],[0.761905,-0.952381],[0.809524,-0.857143],[0.809524,-0.714286],[0.761905,-0.619048],[0.714286,-0.571429],[0.619048,-0.52381],[0.238095,-0.52381]]],"w":1},"U":{"l":[[[0.238095,-1.047619],[0.238095,-0.238095],[0.285714,-0.142857],[0.333333,-0.095238],[0.428571,-0.047619],[0.619048,-0.047619],[0.714286,-0.095238],[0.761905,-0.142857],[0.809524,-0.238095],[0.809524,-1.047619]]],"w":1.047619},"T":{"l":[[[0.095238,-1.047619],[0.666667,-1.047619]],[[0.380952,-0.047619],[0.380952,-1.047619]]],"w":0.761905},"W":{"l":[[[0.142857,-1.047619],[0.380952,-0.047619],[0.571429,-0.761905],[0.761905,-0.047619],[1,-1.047619]]],"w":1.142857},"Y":{"l":[[[0.428571,-0.52381],[0.428571,-0.047619]],[[0.095238,-1.047619],[0.428571,-0.52381],[0.761905,-1.047619]]],"w":0.857143},"_":{"l":[[[0,0.047619],[0.761905,0.047619]]],"w":0.761905},"n":{"l":[[[0.238095,-0.714286],[0.238095,-0.047619]],[[0.238095,-0.619048],[0.285714,-0.666667],[0.380952,-0.714286],[0.52381,-0.714286],[0.619048,-0.666667],[0.666667,-0.571429],[0.666667,-0.047619]]],"w":0.904762},"u":{"l":[[[0.666667,-0.714286],[0.666667,-0.047619]],[[0.238095,-0.714286],[0.238095,-0.190476],[0.285714,-0.095238],[0.380952,-0.047619],[0.52381,-0.047619],[0.619048,-0.095238],[0.666667,-0.142857]]],"w":0.904762},"x":{"l":[[[0.142857,-0.047619],[0.666667,-0.714286]],[[0.142857,-0.714286],[0.666667,-0.047619]]],"w":0.809524}};

/* ============================== estado de vista / canvas ============================== */

const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
let DPR = window.devicePixelRatio || 1, CW = 0, CHH = 0;
const view = { scale: 10, cx: 0, cy: 0, flip:false };
const show = { grid:true, ghost:true, layers:{} };
for (const k of Object.keys(LAYER_COLORS)) show.layers[k]=true;
let selected = null, hover = null;

function resize(){
  DPR = window.devicePixelRatio || 1;
  CW = cv.clientWidth; CHH = cv.clientHeight;
  cv.width = Math.round(CW*DPR); cv.height = Math.round(CHH*DPR);
  draw();
}
window.addEventListener('resize', resize);

function fitBoard(){
  const bb = B.board && B.board.bbox;
  if (!bb) return;
  const w = Math.max(bb.x2-bb.x1, 1), h = Math.max(bb.y2-bb.y1, 1);
  view.cx = (bb.x1+bb.x2)/2; view.cy = (bb.y1+bb.y2)/2;
  view.scale = Math.min(CW/(w*1.15), CHH/(h*1.15));
}
function worldTransform(){
  const fx = view.flip ? -1 : 1;
  ctx.setTransform(DPR*view.scale*fx, 0, 0, -DPR*view.scale,
    DPR*(CW/2 - view.cx*view.scale*fx), DPR*(CHH/2 + view.cy*view.scale));
}
function screenToWorld(sx, sy){
  const fx = view.flip ? -1 : 1;
  return { x:(sx - CW/2)/(view.scale*fx) + view.cx, y:(CHH/2 - sy)/view.scale + view.cy };
}

/* ============================== desenho ============================== */

function layerAlpha(layer){
  const topSide = ['Top','TopOverlay'], botSide=['Bottom','BottomOverlay'];
  if (layer==='Multi'||layer==='Mech1'||layer==='KeepOut') return 1;
  const nearSide = view.flip ? botSide : topSide;
  return nearSide.includes(layer) ? 1 : 0.45;
}
function lcolor(layer){ return LAYER_COLORS[layer] || '#888888'; }

function outlinePath(){
  ctx.beginPath();
  let started=false;
  for (const s of (model.outline || B.board.outline || [])) {
    if (s.kind==='line') {
      if (!started){ ctx.moveTo(s.x1,s.y1); started=true; }
      ctx.lineTo(s.x1,s.y1); ctx.lineTo(s.x2,s.y2);
    } else {
      ctx.arc(s.cx, s.cy, s.r, s.sa*Math.PI/180, s.ea*Math.PI/180, false);
      started=true;
    }
  }
  if (started) ctx.closePath();
}

function drawGrid(){
  if (!show.grid) return;
  const bb=B.board.bbox, pad=10;
  const steps=[0.1,0.5,1,5,10,25,50];
  let step=steps[steps.length-1];
  for (const s of steps){ if (s*view.scale >= 12){ step=s; break; } }
  ctx.lineWidth = 1/(view.scale*DPR)*DPR; /* ~1px */
  const x0=Math.floor((bb.x1-pad)/step)*step, x1=bb.x2+pad, y0=Math.floor((bb.y1-pad)/step)*step, y1=bb.y2+pad;
  ctx.beginPath();
  for (let x=x0;x<=x1;x+=step){ ctx.moveTo(x,bb.y1-pad); ctx.lineTo(x,y1); }
  for (let y=y0;y<=y1;y+=step){ ctx.moveTo(bb.x1-pad,y); ctx.lineTo(x1,y); }
  ctx.strokeStyle = COLOR_GRID; ctx.stroke();
  /* origem */
  ctx.beginPath();
  ctx.moveTo(-2,0); ctx.lineTo(2,0); ctx.moveTo(0,-2); ctx.lineTo(0,2);
  ctx.strokeStyle=COLOR_ORIGIN; ctx.lineWidth=2/view.scale; ctx.stroke();
  ctx.beginPath(); ctx.arc(0,0,1.2,0,Math.PI*2); ctx.stroke();
}

function strokeSeg(x1,y1,x2,y2,w){
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
  ctx.lineWidth=Math.max(w,0.01); ctx.lineCap='round'; ctx.stroke();
}
function strokeArc(cx,cy,r,sa,ea,w){
  ctx.beginPath(); ctx.arc(cx,cy,r,sa*Math.PI/180,ea*Math.PI/180,false);
  ctx.lineWidth=Math.max(w,0.01); ctx.lineCap='round'; ctx.stroke();
}

function drawTrackObj(m){
  const e=m.eff;
  if (!show.layers[e.layer]) return;
  if (m.deleted){ if (show.ghost){ ctx.save(); ctx.globalAlpha=0.5; ctx.strokeStyle=COLOR_DEL;
      ctx.setLineDash([0.6,0.4]); strokeSeg(e.x1,e.y1,e.x2,e.y2,e.w); ctx.restore(); } return; }
  ctx.save();
  ctx.globalAlpha=layerAlpha(e.layer);
  ctx.strokeStyle=lcolor(e.layer);
  strokeSeg(e.x1,e.y1,e.x2,e.y2,e.w);
  if (m.added){ ctx.globalAlpha=1; ctx.strokeStyle=COLOR_ADD; ctx.setLineDash([0.4,0.3]);
    strokeSeg(e.x1,e.y1,e.x2,e.y2,Math.max(e.w*0.3,0.05)); }
  ctx.restore();
  if (m.changed && show.ghost && m.src){
    ctx.save(); ctx.globalAlpha=0.45; ctx.strokeStyle=lcolor(m.src.layer);
    ctx.setLineDash([0.6,0.4]); strokeSeg(m.src.x1,m.src.y1,m.src.x2,m.src.y2,m.src.w); ctx.restore();
  }
}
function drawArcObj(m){
  const e=m.eff;
  if (!show.layers[e.layer]) return;
  if (m.deleted){ if (show.ghost){ ctx.save(); ctx.globalAlpha=0.5; ctx.strokeStyle=COLOR_DEL;
      ctx.setLineDash([0.6,0.4]); strokeArc(e.cx,e.cy,e.r,e.sa,e.ea,e.w); ctx.restore(); } return; }
  ctx.save();
  ctx.globalAlpha=layerAlpha(e.layer);
  ctx.strokeStyle=lcolor(e.layer);
  strokeArc(e.cx,e.cy,e.r,e.sa,e.ea,e.w);
  if (m.added){ ctx.globalAlpha=1; ctx.strokeStyle=COLOR_ADD; ctx.setLineDash([0.4,0.3]);
    strokeArc(e.cx,e.cy,e.r,e.sa,e.ea,Math.max(e.w*0.3,0.05)); }
  ctx.restore();
  if (m.changed && show.ghost && m.src){
    ctx.save(); ctx.globalAlpha=0.45; ctx.strokeStyle=lcolor(m.src.layer);
    ctx.setLineDash([0.6,0.4]); strokeArc(m.src.cx,m.src.cy,m.src.r,m.src.sa,m.src.ea,m.src.w); ctx.restore();
  }
}
function drawViaObj(m){
  const e=m.eff;
  if (m.deleted){ if (show.ghost){ ctx.save(); ctx.globalAlpha=0.6; ctx.strokeStyle=COLOR_DEL;
      ctx.lineWidth=0.08; ctx.beginPath(); ctx.arc(e.x,e.y,e.size/2,0,Math.PI*2); ctx.stroke();
      const r=e.size/2; ctx.beginPath(); ctx.moveTo(e.x-r,e.y-r); ctx.lineTo(e.x+r,e.y+r);
      ctx.moveTo(e.x-r,e.y+r); ctx.lineTo(e.x+r,e.y-r); ctx.stroke(); ctx.restore(); } return; }
  ctx.save();
  ctx.fillStyle=lcolor('Multi');
  ctx.beginPath(); ctx.arc(e.x,e.y,e.size/2,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=COLOR_HOLE;
  ctx.beginPath(); ctx.arc(e.x,e.y,e.drill/2,0,Math.PI*2); ctx.fill();
  if (m.added){ ctx.strokeStyle=COLOR_ADD; ctx.lineWidth=0.07; ctx.setLineDash([0.3,0.25]);
    ctx.beginPath(); ctx.arc(e.x,e.y,e.size/2+0.12,0,Math.PI*2); ctx.stroke(); }
  ctx.restore();
  if (m.changed && show.ghost && m.src){
    ctx.save(); ctx.globalAlpha=0.5; ctx.strokeStyle=lcolor('Multi'); ctx.setLineDash([0.4,0.3]);
    ctx.lineWidth=0.07; ctx.beginPath(); ctx.arc(m.src.x,m.src.y,m.src.size/2,0,Math.PI*2); ctx.stroke(); ctx.restore();
  }
}

function padPath(x,y,w,h,rot,shape,radius){
  /* o caminho fica gravado ja transformado; o restore antes do fill e seguro */
  ctx.save();
  ctx.translate(x,y); ctx.rotate(rot*Math.PI/180);
  ctx.beginPath();
  const hw=w/2, hh=h/2;
  if (shape==='circle'){ ctx.arc(0,0,Math.max(hw,hh),0,Math.PI*2); }
  else if (shape==='oval'){ const r=Math.min(hw,hh);
    roundRectPath(-hw,-hh,w,h,r); }
  else if (shape==='roundrect'){ roundRectPath(-hw,-hh,w,h,Math.min(radius||Math.min(hw,hh)*0.25, Math.min(hw,hh))); }
  else if (shape==='octagon'){ const c=Math.min(hw,hh)*0.4142;
    ctx.moveTo(-hw+c,-hh); ctx.lineTo(hw-c,-hh); ctx.lineTo(hw,-hh+c); ctx.lineTo(hw,hh-c);
    ctx.lineTo(hw-c,hh); ctx.lineTo(-hw+c,hh); ctx.lineTo(-hw,hh-c); ctx.lineTo(-hw,-hh+c); ctx.closePath(); }
  else { ctx.rect(-hw,-hh,w,h); }
  ctx.restore();
}
function roundRectPath(x,y,w,h,r){
  ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
  ctx.closePath();
}
function drawPad(p, d, ownerRef){
  let x=p.x, y=p.y, rot=p.rot, layer=p.layer;
  if (d){ const q=xfPoint(d,p.x,p.y); x=q.x; y=q.y; rot=xfAngle(d,p.rot); layer=effLayerForOwner(ownerRef,p.layer); }
  const isTH = p.type==='th' || layer==='Multi';
  const color = isTH ? lcolor('Multi') : lcolor(layer);
  if (!isTH && !show.layers[layer]) return;
  if (isTH && !show.layers['Multi']) return;
  ctx.save();
  ctx.globalAlpha = isTH ? 1 : layerAlpha(layer);
  padPath(x,y,p.w,p.h,rot,p.shape,p.radius);
  ctx.fillStyle=color; ctx.fill();
  ctx.restore();
  if (isTH && p.drill){
    ctx.save();
    ctx.translate(x,y); ctx.rotate(((p.holerot!=null?p.holerot:rot))*Math.PI/180);
    ctx.fillStyle=COLOR_HOLE;
    ctx.beginPath();
    if (p.drillshape==='oblong' && p.drillw){
      const dw=p.drillw, dh=p.drill; const r=Math.min(dw,dh)/2;
      roundRectPath(-dw/2,-dh/2,dw,dh,r);
    } else if (p.drillshape==='rect' && p.drillw){
      ctx.rect(-p.drillw/2,-p.drill/2,p.drillw,p.drill);
    } else {
      ctx.arc(0,0,p.drill/2,0,Math.PI*2);
    }
    ctx.fill();
    ctx.restore();
  }
}

function drawSilkItem(s){
  const d = ownerDelta(s.owner);
  const layer = d ? effLayerForOwner(s.owner, s.layer) : s.layer;
  if (!show.layers[layer]) return;
  ctx.save();
  ctx.globalAlpha=layerAlpha(layer);
  ctx.strokeStyle=lcolor(layer);
  if (s.kind==='line'){
    let p1={x:s.x1,y:s.y1}, p2={x:s.x2,y:s.y2};
    if (d){ p1=xfPoint(d,s.x1,s.y1); p2=xfPoint(d,s.x2,s.y2); }
    strokeSeg(p1.x,p1.y,p2.x,p2.y,s.w);
  } else {
    let c={x:s.cx,y:s.cy}, sa=s.sa, ea=s.ea;
    if (d){ c=xfPoint(d,s.cx,s.cy);
      if (d.flip){ const t=180-ea+d.dr; ea=180-sa+d.dr; sa=t; } else { sa+=d.dr; ea+=d.dr; } }
    strokeArc(c.x,c.y,s.r,sa,ea,s.w);
  }
  ctx.restore();
}

function glyphFor(chr){ return FONTDATA[chr] || FONTDATA[chr.toUpperCase()] || null; }
function textWidth(txt,h){
  let w=0;
  for (const c of txt){ if (c===' '){ w+=0.5*h; continue; } const g=glyphFor(c); w += (g? g.w:0.9)*h; }
  return w;
}
function drawStrokeText(txt, x, y, h, rot, mirror, color, alpha){
  ctx.save();
  ctx.translate(x,y);
  ctx.rotate(rot*Math.PI/180);
  if (mirror) ctx.scale(-1,1);
  ctx.strokeStyle=color; ctx.globalAlpha=alpha!=null?alpha:1;
  ctx.lineWidth=h*0.13; ctx.lineCap='round'; ctx.lineJoin='round';
  let cx0 = -textWidth(txt,h)/2;
  const baseY = -h*0.5;
  for (const c of txt){
    if (c===' '){ cx0 += 0.5*h; continue; }
    const g=glyphFor(c);
    if (!g){ ctx.strokeRect(cx0+0.15*h, baseY, 0.6*h, h); cx0 += 0.9*h; continue; }
    for (const stroke of g.l){
      ctx.beginPath();
      stroke.forEach((pt,i)=>{
        /* pt[1] é negativo p/ cima (convenção ibom Y-down) -> mundo Y-up: -pt[1] */
        const px = cx0 + pt[0]*h, py = baseY + (-pt[1])*h;
        if (i===0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    cx0 += g.w*h;
  }
  ctx.restore();
}

function drawTextItem(t){
  const d = ownerDelta(t.owner);
  const layer = d ? effLayerForOwner(t.owner, t.layer) : t.layer;
  if (!show.layers[layer]) return;
  let x=t.x, y=t.y, rot=t.rot, mirror=t.mirror;
  if (d){ const q=xfPoint(d,t.x,t.y); x=q.x; y=q.y; rot=xfAngle(d,t.rot);
    if (d.flip) mirror=!mirror; }
  let txt=t.text||'';
  const ownerComp = t.owner ? model.compByRef[t.owner] : null;
  if (t.designator && ownerComp) txt = ownerComp.src.ref;
  if (t.comment && ownerComp) txt = ownerComp.src.comment || txt;
  if (!txt) return;
  drawStrokeText(txt, x, y, t.h||1, rot, mirror, lcolor(layer), layerAlpha(layer));
}

function drawTextObj(m){
  /* texto do modelo efetivo; se mudou, fantasma do original + seta ate o novo centro */
  if (m.changed && show.ghost){
    let gt = m.src.text||'';
    const oc = m.src.owner ? model.compByRef[m.src.owner] : null;
    if (m.src.designator && oc) gt = oc.src.ref;
    if (m.src.comment && oc) gt = oc.src.comment || gt;
    if (gt){
      drawStrokeText(gt, m.src.x, m.src.y, m.src.h||1, m.src.rot||0, m.src.mirror,
                     lcolor(m.src.layer), 0.25*layerAlpha(m.src.layer));
      ctx.save();
      ctx.beginPath(); ctx.moveTo(m.src.x,m.src.y); ctx.lineTo(m.eff.x,m.eff.y);
      ctx.globalAlpha=0.7; ctx.strokeStyle=COLOR_CHGARROW; ctx.lineWidth=0.06; ctx.stroke();
      ctx.restore();
    }
  }
  drawTextItem(m.eff);
}

function drawRegion(g){
  if (!show.layers[g.layer]) return;
  if (!g.points || g.points.length<3) return;
  ctx.save();
  ctx.globalAlpha=0.28*layerAlpha(g.layer);
  ctx.fillStyle=lcolor(g.layer);
  ctx.beginPath();
  g.points.forEach((p,i)=>{ if(i===0) ctx.moveTo(p[0],p[1]); else ctx.lineTo(p[0],p[1]); });
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha=0.6*layerAlpha(g.layer);
  ctx.lineWidth=0.03; ctx.strokeStyle=lcolor(g.layer); ctx.stroke();
  ctx.restore();
}

function drawCompOverlay(m){
  /* bbox fantasma do original + destaque do movido */
  if (!m.changed) return;
  const b=m.src.bbox, d=compDelta(m);
  if (show.ghost && b){
    ctx.save();
    ctx.strokeStyle=lcolor(m.src.layer==='Top'?'Top':'Bottom');
    ctx.globalAlpha=0.55; ctx.setLineDash([0.7,0.5]); ctx.lineWidth=0.08;
    ctx.strokeRect(b.x1,b.y1,b.x2-b.x1,b.y2-b.y1);
    ctx.setLineDash([]);
    /* seta origem -> destino */
    ctx.beginPath(); ctx.moveTo(m.src.x,m.src.y); ctx.lineTo(m.eff.x,m.eff.y);
    ctx.globalAlpha=0.7; ctx.strokeStyle=COLOR_CHGARROW; ctx.lineWidth=0.06; ctx.stroke();
    ctx.restore();
  }
  if (b){
    /* bbox transformado na posicao nova */
    const corners=[[b.x1,b.y1],[b.x2,b.y1],[b.x2,b.y2],[b.x1,b.y2]].map(p=>xfPoint(d,p[0],p[1]));
    ctx.save();
    ctx.strokeStyle=COLOR_CHGARROW; ctx.globalAlpha=0.9; ctx.lineWidth=0.06;
    ctx.beginPath();
    corners.forEach((p,i)=>{ if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); });
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
}
const COLOR_CHGARROW = '#ffd54f';

function drawSelection(){
  const m = selected;
  if (!m) return;
  ctx.save();
  ctx.strokeStyle=COLOR_SEL; ctx.lineWidth=0.06; ctx.setLineDash([0.35,0.25]);
  ctx.globalAlpha=0.95;
  if (m.kind==='comp'){
    const b=m.src.bbox, d=m.changed?compDelta(m):null;
    const corners=[[b.x1,b.y1],[b.x2,b.y1],[b.x2,b.y2],[b.x1,b.y2]]
      .map(p=> d? xfPoint(d,p[0],p[1]) : {x:p[0],y:p[1]});
    ctx.beginPath();
    corners.forEach((p,i)=>{ if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); });
    ctx.closePath(); ctx.stroke();
  } else if (m.kind==='track'){
    const e=m.eff; strokeSeg(e.x1,e.y1,e.x2,e.y2,e.w+0.15);
  } else if (m.kind==='via'){
    const e=m.eff; ctx.beginPath(); ctx.arc(e.x,e.y,e.size/2+0.15,0,Math.PI*2); ctx.stroke();
  } else if (m.kind==='arc'){
    const e=m.eff; strokeArc(e.cx,e.cy,e.r,e.sa,e.ea,e.w+0.15);
  } else if (m.kind==='pad'){
    const p=m.pad; ctx.beginPath(); ctx.arc(m.x,m.y,Math.max(p.w,p.h)/2+0.15,0,Math.PI*2); ctx.stroke();
  }
  ctx.restore();
}

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

function draw(){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle='#000000';
  ctx.fillRect(0,0,cv.width,cv.height);
  worldTransform();

  /* placa */
  outlinePath();
  ctx.fillStyle=COLOR_BOARD; ctx.fill();
  drawGrid();

  /* zonas de cobre */
  for (const g of (B.regions||[])) drawRegion(g);

  /* cobre: lado oposto primeiro */
  const far = view.flip ? 'Top':'Bottom', nearL = view.flip? 'Bottom':'Top';
  for (const m of model.tracks) if (m.eff.layer===far) drawTrackObj(m);
  for (const m of model.arcs)  if (m.eff.layer===far) drawArcObj(m);
  for (const m of model.tracks) if (m.eff.layer===nearL) drawTrackObj(m);
  for (const m of model.arcs)  if (m.eff.layer===nearL) drawArcObj(m);
  for (const m of model.added) {
    if (m.kind==='track') drawTrackObj(m);
    else if (m.kind==='arc') drawArcObj(m);
  }

  /* pads (componentes + livres) */
  for (const m of model.comps){
    const d = m.changed ? compDelta(m) : null;
    for (const p of m.src.pads) drawPad(p, d, m.src.ref);
  }
  for (const p of (B.freepads||[])) drawPad(p, null, null);

  /* vias */
  for (const m of model.vias) drawViaObj(m);
  for (const m of model.added) if (m.kind==='via') drawViaObj(m);

  /* silkscreen + textos */
  for (const s of (B.silk||[])) drawSilkItem(s);
  for (const m of model.texts) drawTextObj(m);

  /* contorno */
  outlinePath();
  ctx.strokeStyle=COLOR_OUTLINE; ctx.lineWidth=0.06; ctx.stroke();

  /* overlays de mudanca de componentes */
  if (true) for (const m of model.comps) drawCompOverlay(m);

  drawSelection();
  drawAnnotations();
}

/* ============================== interação ============================== */

let dragging=false, dragMoved=false, lastX=0, lastY=0;
let objDrag = null; /* { m, startW, base, moved } */
let tool = 'select'; let setTool = t => { tool = t; };
cv.addEventListener('mousedown', e => {
  dragging = false; dragMoved = false; lastX = e.offsetX; lastY = e.offsetY;
  if (annTool || tool !== 'select' || e.button !== 0){ dragging = true; return; }
  const w = screenToWorld(e.offsetX, e.offsetY);
  const h = hitTest(w.x, w.y);
  if (h && ['comp','track','via','arc'].includes(h.kind) && !h.deleted){
    objDrag = { m:h, startW:w, base:JSON.parse(JSON.stringify(h.eff)), moved:false };
  } else dragging = true;
});
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
cv.addEventListener('mousemove', e=>{
  const w = screenToWorld(e.offsetX, e.offsetY);
  document.getElementById('sx').textContent = w.x.toFixed(4);
  document.getElementById('sy').textContent = w.y.toFixed(4);
  document.getElementById('sxm').textContent = (w.x*MM2MIL).toFixed(2);
  document.getElementById('sym').textContent = (w.y*MM2MIL).toFixed(2);
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
  if (dragging){
    const fx = view.flip ? -1 : 1;
    view.cx -= (e.offsetX-lastX)/(view.scale*fx);
    view.cy += (e.offsetY-lastY)/view.scale;
    lastX=e.offsetX; lastY=e.offsetY; dragMoved=true;
    draw();
    return;
  }
  hover = hitTest(w.x, w.y);
  document.getElementById('shover').textContent = hover ? hoverLabel(hover) : '';
  cv.style.cursor = hover ? 'pointer' : 'crosshair';
});
cv.addEventListener('wheel', e=>{
  e.preventDefault();
  const w = screenToWorld(e.offsetX, e.offsetY);
  const f = e.deltaY<0 ? 1.18 : 1/1.18;
  view.scale *= f;
  /* mantem o ponto sob o cursor */
  const fx = view.flip ? -1 : 1;
  view.cx = w.x - (e.offsetX - CW/2)/(view.scale*fx);
  view.cy = w.y + (e.offsetY - CHH/2)/view.scale;
  updateZoomLabel(); draw();
}, {passive:false});
cv.addEventListener('click', e=>{
  if (dragMoved) return;
  if (annTool){ openAnnForm(screenToWorld(e.offsetX, e.offsetY)); return; }
  const w = screenToWorld(e.offsetX, e.offsetY);
  selected = hitTest(w.x, w.y);
  showInfo(selected);
  syncTableSel();
  draw();
});

function hitTest(x,y){
  for (const a of ANN){
    if (a.view === 'pcb' && Math.hypot(x - a.x, y - a.y) <= 12 / view.scale)
      return { kind:'ann', ann:a };
  }
  const tol = 6/view.scale;
  /* pads primeiro (mais especificos) */
  for (const m of model.comps){
    const d = m.changed ? compDelta(m) : null;
    for (const p of m.src.pads){
      let px=p.x, py=p.y;
      if (d){ const q=xfPoint(d,p.x,p.y); px=q.x; py=q.y; }
      if (Math.hypot(x-px,y-py) <= Math.max(p.w,p.h)/2+tol*0.3)
        return {kind:'pad', pad:p, comp:m, x:px, y:py};
    }
  }
  for (const m of model.vias){ if (m.deleted) continue;
    if (Math.hypot(x-m.eff.x,y-m.eff.y) <= m.eff.size/2+tol*0.3) return m; }
  for (const m of model.added){ if (m.kind==='via' &&
    Math.hypot(x-m.eff.x,y-m.eff.y) <= m.eff.size/2+tol*0.3) return m; }
  const trackHit = (m)=> !m.deleted && show.layers[m.eff.layer] &&
    distSeg(x,y,m.eff.x1,m.eff.y1,m.eff.x2,m.eff.y2) <= m.eff.w/2+tol*0.5;
  for (const m of model.tracks) if (trackHit(m)) return m;
  for (const m of model.added) if (m.kind==='track' && trackHit(m)) return m;
  for (const m of model.arcs){ if (m.deleted) continue;
    const e=m.eff;
    if (Math.abs(Math.hypot(x-e.cx,y-e.cy)-e.r) <= e.w/2+tol*0.5) return m; }
  /* componentes por bbox */
  for (const m of model.comps){
    const b=m.src.bbox; if (!b) continue;
    if (m.changed){
      const d=compDelta(m);
      /* teste no referencial original */
      let lx=x-d.nx, ly=y-d.ny;
      const c=Math.cos(-d.dr*Math.PI/180), s=Math.sin(-d.dr*Math.PI/180);
      let rx=lx*c-ly*s, ry=lx*s+ly*c;
      if (d.flip) rx=-rx;
      rx+=d.ox; ry+=d.oy;
      if (rx>=b.x1-tol&&rx<=b.x2+tol&&ry>=b.y1-tol&&ry<=b.y2+tol) return m;
    } else {
      if (x>=b.x1-tol&&x<=b.x2+tol&&y>=b.y1-tol&&y<=b.y2+tol) return m;
    }
  }
  return null;
}
function hoverLabel(m){
  if (m.kind==='comp') return `${m.src.ref} (${m.src.footprint})`;
  if (m.kind==='pad') return `${m.comp.src.ref}.${m.pad.name} ${m.pad.net?'· '+m.pad.net:''}`;
  if (m.kind==='track') return `${m.eff.id||'trilha nova'} ${m.eff.net?'· '+m.eff.net:''}`;
  if (m.kind==='via') return `${m.eff.id||'via nova'} ${m.eff.net?'· '+m.eff.net:''}`;
  if (m.kind==='arc') return `${m.eff.id||'arco novo'} ${m.eff.net?'· '+m.eff.net:''}`;
  if (m.kind==='ann') return `⚑ ${m.ann.id}: ${m.ann.msg}`;
  return '';
}
function showInfo(m){
  const el=document.getElementById('infopanel');
  if (!m){ el.textContent='— clique em um objeto —'; return; }
  let obj;
  if (m.kind==='pad') obj={ tipo:'pad', comp:m.comp.src.ref, ...m.pad };
  else if (m.kind==='ann') obj={ tipo:'sinalizador', ...m.ann };
  else obj={ tipo:m.kind, ...(m.eff||{}), ...(m.added?{ADICIONADO:true}:{}),
             ...(m.deleted?{REMOVIDO:true}:{}),
             ...(m.changed&&m.src?{original:m.src}:{}) };
  el.textContent = JSON.stringify(obj, null, 1);
}

/* ============================== paineis laterais ============================== */

function buildLayerPanel(){
  const sec=document.getElementById('layersec');
  for (const k of Object.keys(LAYER_COLORS)){
    const row=document.createElement('label'); row.className='layerrow';
    const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=true;
    cb.addEventListener('change',()=>{ show.layers[k]=cb.checked; draw(); });
    const sw=document.createElement('span'); sw.className='swatch'; sw.style.background=LAYER_COLORS[k];
    const tx=document.createElement('span'); tx.textContent=k;
    row.append(cb,sw,tx); sec.appendChild(row);
  }
}
function zoomToObj(m){
  if (!m) return;
  let x,y,r=4;
  if (m.kind==='comp'){ const b=m.src.bbox; const d=m.changed?compDelta(m):null;
    if (d){ const q=xfPoint(d,(b.x1+b.x2)/2,(b.y1+b.y2)/2); x=q.x; y=q.y; }
    else { x=(b.x1+b.x2)/2; y=(b.y1+b.y2)/2; }
    r=Math.max(b.x2-b.x1,b.y2-b.y1)*1.6+2; }
  else if (m.kind==='track'){ x=(m.eff.x1+m.eff.x2)/2; y=(m.eff.y1+m.eff.y2)/2;
    r=Math.hypot(m.eff.x2-m.eff.x1,m.eff.y2-m.eff.y1)*1.6+2; }
  else if (m.kind==='via'){ x=m.eff.x; y=m.eff.y; r=m.eff.size*8+2; }
  else if (m.kind==='arc'){ x=m.eff.cx; y=m.eff.cy; r=m.eff.r*2.6+2; }
  else if (m.kind==='pad'){ x=m.x; y=m.y; r=Math.max(m.pad.w,m.pad.h)*8+1; }
  else if (m.kind==='text'){ x=m.eff.x; y=m.eff.y; r=(m.eff.h||1)*8+2; }
  else if (m.kind==='ann'){ x=m.ann.x; y=m.ann.y; r=8; }
  else return;
  view.cx=x; view.cy=y;
  view.scale=Math.min(CW,CHH)/Math.max(r,0.5);
  updateZoomLabel(); draw();
}
function chLabel(ch){
  switch(ch.op){
    case 'comp_move': return `mover ${ch.ref} → (${fmt(ch.x)}, ${fmt(ch.y)}) rot ${fmt(ch.rot)}${ch.layer?' '+ch.layer:''}`;
    case 'track_edit': return `editar trilha ${ch.id}`;
    case 'track_add': return `nova trilha ${ch.layer} (${fmt(ch.x1)},${fmt(ch.y1)})–(${fmt(ch.x2)},${fmt(ch.y2)})`;
    case 'track_del': return `remover trilha ${ch.id}`;
    case 'via_edit': return `editar via ${ch.id}`;
    case 'via_add': return `nova via (${fmt(ch.x)}, ${fmt(ch.y)})`;
    case 'via_del': return `remover via ${ch.id}`;
    case 'arc_edit': return `editar arco ${ch.id}`;
    case 'text_edit': return `editar texto ${ch.id}${typeof ch.text==='string'?` → "${ch.text}"`:''} (${fmt(ch.x)}, ${fmt(ch.y)})`;
    case 'designator_move': return `designator ${ch.ref} → (${fmt(ch.x)}, ${fmt(ch.y)})`;
    case 'arc_add': return `novo arco ${ch.layer}`;
    case 'arc_del': return `remover arco ${ch.id}`;
    case 'outline_set': return `novo contorno da placa (${Array.isArray(ch.pts)?ch.pts.length:'?'} vértices)`;
    default: return `?? ${ch.op}`;
  }
}
function fmt(v){ return isNum(v) ? (+v.toFixed(4)).toString() : '—'; }
function buildChangePanel(){
  document.getElementById('chcount').textContent = CH.length;
  const list = document.getElementById('changelist');
  list.innerHTML = CH.length ? '' : '<div style="color:var(--fg-dim)">nenhuma — edite na tela ou no changes.js</div>';
  for (const item of model.changeItems){
    const div=document.createElement('div');
    div.className='changeitem '+item.status;
    div.textContent = chLabel(item.ch) + (item.msg? ' ⚠ '+item.msg : '');
    div.addEventListener('click',()=>{ if(item.target){ selected=item.target; showInfo(selected); syncTableSel(); zoomToObj(item.target);} });
    list.appendChild(div);
  }
  const val=document.getElementById('vallist');
  val.innerHTML = model.validation.length ? '' : '<div style="color:var(--ok)">✓ sem problemas</div>';
  for (const v of model.validation){
    const div=document.createElement('div'); div.className='valitem '+v.level;
    div.textContent=v.msg;
    div.addEventListener('click',()=>{ if(v.target){ selected=v.target; zoomToObj(v.target);} });
    val.appendChild(div);
  }
}
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

/* ============================== PCB List (tabela) ============================== */

let sortKey='ref', sortAsc=true;
function natCmp(a,b){
  return String(a).localeCompare(String(b), undefined, {numeric:true, sensitivity:'base'});
}
function tableRows(){
  const f=(document.getElementById('filter').value||'').toLowerCase();
  let rows = model.comps.map(m=>({
    m, ref:m.src.ref, footprint:m.src.footprint, comment:m.src.comment,
    layer:m.eff.layer, x:m.eff.x, y:m.eff.y, rot:m.eff.rot
  }));
  if (f) rows=rows.filter(r=> (r.ref+' '+r.footprint+' '+r.comment).toLowerCase().includes(f));
  rows.sort((a,b)=>{
    const va=a[sortKey], vb=b[sortKey];
    const c = (typeof va==='number'&&typeof vb==='number') ? va-vb : natCmp(va,vb);
    return sortAsc? c : -c;
  });
  return rows;
}
function renderTable(){
  const tb=document.querySelector('#pcblist tbody');
  tb.innerHTML='';
  for (const r of tableRows()){
    const tr=document.createElement('tr');
    if (r.m===selected) tr.className='sel';
    if (r.m.changed) tr.classList.add('moved');
    const cells=[
      ['ref',r.ref,false],['footprint',r.footprint,false],['comment',r.comment,false],
      ['layer',r.layer, r.m.changed && r.m.eff.layer!==r.m.src.layer],
      ['x',r.x.toFixed(4), r.m.changed && !near(r.m.eff.x,r.m.src.x)],
      ['y',r.y.toFixed(4), r.m.changed && !near(r.m.eff.y,r.m.src.y)],
      ['rot',fmt(r.rot), r.m.changed && !nearAng(r.m.eff.rot,r.m.src.rot)]
    ];
    for (const [k,v,chg] of cells){
      const td=document.createElement('td');
      td.textContent=v;
      if (['x','y','rot'].includes(k)) td.className='num';
      if (chg) td.classList.add('chg');
      tr.appendChild(td);
    }
    tr.addEventListener('click',()=>{ selected=r.m; showInfo(r.m); zoomToObj(r.m); renderTable(); draw(); });
    tb.appendChild(tr);
  }
}
function syncTableSel(){ renderTable(); }
document.getElementById('filter').addEventListener('input', renderTable);
document.querySelectorAll('#pcblist th').forEach(th=>{
  th.addEventListener('click',()=>{
    const k=th.dataset.k;
    if (sortKey===k) sortAsc=!sortAsc; else { sortKey=k; sortAsc=true; }
    renderTable();
  });
});

function exportCsv(){
  const lines=['Designator\tFootprint\tComment\tLayer\tX_mm\tY_mm\tRotation'];
  for (const m of model.comps)
    lines.push([m.src.ref,m.src.footprint,m.src.comment,m.eff.layer,
      m.eff.x.toFixed(4),m.eff.y.toFixed(4),fmt(m.eff.rot)].join('\t'));
  const blob=new Blob([lines.join('\r\n')],{type:'text/tab-separated-values'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='pcb-list-updated.csv'; a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================== toolbar / teclado ============================== */

function updateZoomLabel(){
  document.getElementById('szoom').textContent = view.scale.toFixed(1)+' px/mm';
}
function toggleFlip(){
  view.flip=!view.flip;
  document.getElementById('btnFlip').textContent = 'Vista: ' + (view.flip?'Bottom':'Top');
  draw();
}
document.getElementById('btnFit').addEventListener('click',()=>{ fitBoard(); updateZoomLabel(); draw(); });
document.getElementById('btnFlip').addEventListener('click',toggleFlip);
document.getElementById('btnGrid').addEventListener('click',e=>{ show.grid=!show.grid; e.target.classList.toggle('active'); draw(); });
document.getElementById('btnGhost').addEventListener('click',e=>{ show.ghost=!show.ghost; e.target.classList.toggle('active'); draw(); });
document.getElementById('btnCsv').addEventListener('click',exportCsv);
const helpEl=document.getElementById('help');
function toggleHelp(){ helpEl.style.display = helpEl.style.display==='block'?'none':'block'; }
document.getElementById('btnHelp').addEventListener('click',toggleHelp);
helpEl.addEventListener('click',toggleHelp);
window.addEventListener('keydown',e=>{
  if (e.key === 'Escape') { if (objDrag){ objDrag = null; reapply(); } setAnnTool(false); setTool('select'); return; }
  if (e.key === ' ' && objDrag && objDrag.m.kind === 'comp'){ e.preventDefault(); objDrag.m.eff.rot = (objDrag.m.eff.rot + 90) % 360; objDrag.moved = true; dragMoved = true; draw(); return; }
  if (e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA' || e.target.tagName==='SELECT') return;
  const k=e.key.toLowerCase();
  if (e.ctrlKey && k === 'z'){ e.preventDefault(); undo(); return; }
  if (e.ctrlKey && k === 'y'){ e.preventDefault(); redo(); return; }
  if (k==='f'){ fitBoard(); updateZoomLabel(); draw(); }
  else if (k==='v') toggleFlip();
  else if (k==='g'){ show.grid=!show.grid; document.getElementById('btnGrid').classList.toggle('active'); draw(); }
  else if (k==='d'){ show.ghost=!show.ghost; document.getElementById('btnGhost').classList.toggle('active'); draw(); }
  else if (k==='h') toggleHelp();
  else if (k==='n') setAnnTool(!annTool);
  else if (e.key === 'Delete') deleteSelected();
});

/* ============================== init ============================== */

document.getElementById('meta').textContent =
  `${B.source||''} · exportado ${B.generated||'?'} · ${(B.components||[]).length} comps, ` +
  `${(B.tracks||[]).length} trilhas, ${(B.vias||[]).length} vias · ${CH.length} mudanças`;

buildLayerPanel();
buildChangePanel();
buildAnnPanel();
renderTable();
resize();
fitBoard();
updateZoomLabel();
draw();

})();
