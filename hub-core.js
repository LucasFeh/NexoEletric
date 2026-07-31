/* AltiumPCBMirror v2 - hub-core.js
   Logica pura compartilhada pelo hub (browser, global HubCore) e pelos testes (node).
   NAO acessa DOM. Contratos: esquema em mil (Y para cima), PCB em mm (Y para cima).
   A extracao de nets e um PREVIEW - a verdade e sempre o compilador do Altium. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HubCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const TOL = 1e-3, TOL_ANG = 1e-2;  // PCB (mm)
const STOL = 0.5;                   // esquema (mil)

function near(a, b, t){ return Math.abs(a - b) <= (t || TOL); }
function nearAng(a, b){ let d = Math.abs(a - b) % 360; if (d > 180) d = 360 - d; return d <= TOL_ANG; }
function isNum(v){ return typeof v === 'number' && isFinite(v); }
function distSeg(px, py, x1, y1, x2, y2){
  const dx = x2 - x1, dy = y2 - y1, l2 = dx*dx + dy*dy;
  let t = l2 ? ((px-x1)*dx + (py-y1)*dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x1 + t*dx - px, y1 + t*dy - py);
}

/* tamanhos de folha do Altium em mil [largura, altura] */
const SHEET_SIZES = { A4:[11500,7600], A3:[15500,11000], A2:[22000,15500], A1:[31000,22000],
                      A:[9500,7500], B:[15000,9500], C:[20000,15000] };
const ORIENT_DIR = { 0:[1,0], 90:[0,1], 180:[-1,0], 270:[0,-1] };

/* ============ PCB: board + changes -> modelo efetivo (port do viewer v1) ============ */

function applyPcbChanges(board, changes){
  const B = board || {};
  const CH = Array.isArray(changes) ? changes : [];
  const model = { comps:[], compByRef:{}, tracks:[], arcs:[], vias:[], added:[],
                  validation:[], changeItems:[],
                  outline:((B.board && B.board.outline) || []).slice(), outlineChanged:false };
  for (const c of (B.components || [])) {
    const m = { kind:'comp', src:c, eff:{ x:c.x, y:c.y, rot:c.rot, layer:c.layer }, changed:false };
    model.comps.push(m); model.compByRef[c.ref] = m;
  }
  const byId = {};
  for (const t of (B.tracks || [])) { const m = { kind:'track', src:t, eff:{...t}, changed:false, deleted:false }; model.tracks.push(m); byId[t.id] = m; }
  for (const a of (B.arcs  || [])) { const m = { kind:'arc',   src:a, eff:{...a}, changed:false, deleted:false }; model.arcs.push(m);  byId[a.id] = m; }
  for (const v of (B.vias  || [])) { const m = { kind:'via',   src:v, eff:{...v}, changed:false, deleted:false }; model.vias.push(m);  byId[v.id] = m; }

  let addSeq = 0;
  CH.forEach((ch, idx) => {
    const item = { ch, idx, status:'ok', msg:'', target:null };
    model.changeItems.push(item);
    const bad  = (m) => { item.status='err'; item.msg=m; model.validation.push({ level:'err', msg:`#${idx+1} ${ch.op||'?'}: ${m}`, target:item.target }); };
    const warn = (m) => { if (item.status!=='err') item.status='warn'; item.msg=m; model.validation.push({ level:'warn', msg:`#${idx+1} ${ch.op}: ${m}`, target:item.target }); };

    switch (ch.op) {
      case 'comp_move': {
        const m = model.compByRef[ch.ref];
        if (!m) return bad(`componente "${ch.ref}" não existe no board.js`);
        item.target = m;
        if (!isNum(ch.orig_x)||!isNum(ch.orig_y)||!isNum(ch.orig_rot)||!ch.orig_layer)
          return bad('faltam orig_x/orig_y/orig_rot/orig_layer (copie do board.js)');
        if (!near(ch.orig_x,m.src.x)||!near(ch.orig_y,m.src.y)||!nearAng(ch.orig_rot,m.src.rot)||ch.orig_layer!==m.src.layer)
          warn('orig_* não confere com o board.js — espelho pode estar desatualizado');
        if (isNum(ch.x)) m.eff.x = ch.x;
        if (isNum(ch.y)) m.eff.y = ch.y;
        if (isNum(ch.rot)) m.eff.rot = ch.rot;
        if (ch.layer) m.eff.layer = ch.layer;
        m.changed = !(near(m.eff.x,m.src.x)&&near(m.eff.y,m.src.y)&&nearAng(m.eff.rot,m.src.rot)&&m.eff.layer===m.src.layer);
        break;
      }
      case 'track_edit': case 'track_del': {
        let m = ch.id ? byId[ch.id] : null;
        if (m && m.kind!=='track') m = null;
        if (!m) return bad(`trilha id "${ch.id}" não existe no board.js`);
        item.target = m;
        for (const k of ['x1','y1','x2','y2','w'])
          if (!isNum(ch['orig_'+k])) return bad('faltam campos orig_* (copie do board.js)');
        if (!ch.orig_layer) return bad('falta orig_layer');
        const s = m.src;
        const direct = near(ch.orig_x1,s.x1)&&near(ch.orig_y1,s.y1)&&near(ch.orig_x2,s.x2)&&near(ch.orig_y2,s.y2);
        const rev    = near(ch.orig_x1,s.x2)&&near(ch.orig_y1,s.y2)&&near(ch.orig_x2,s.x1)&&near(ch.orig_y2,s.y1);
        if (!(direct||rev) || !near(ch.orig_w,s.w) || ch.orig_layer!==s.layer)
          warn('orig_* não confere com o board.js');
        if (ch.op==='track_del'){ m.deleted = true; break; }
        for (const k of ['x1','y1','x2','y2','w']) if (isNum(ch[k])) m.eff[k] = ch[k];
        if (ch.layer) m.eff.layer = ch.layer;
        if (typeof ch.net==='string') m.eff.net = ch.net;
        m.changed = true;
        break;
      }
      case 'track_add': {
        for (const k of ['x1','y1','x2','y2','w']) if (!isNum(ch[k])) return bad(`campo "${k}" ausente/inválido`);
        if (ch.layer!=='Top' && ch.layer!=='Bottom') return bad('layer deve ser Top ou Bottom');
        if (ch.w<=0) return bad('largura w deve ser > 0');
        const m = { kind:'track', src:null, eff:{ id:'new-t'+(++addSeq), ...ch }, changed:false, added:true };
        model.added.push(m); item.target = m;
        break;
      }
      case 'via_edit': case 'via_del': {
        let m = ch.id ? byId[ch.id] : null;
        if (m && m.kind!=='via') m = null;
        if (!m) return bad(`via id "${ch.id}" não existe no board.js`);
        item.target = m;
        if (!isNum(ch.orig_x)||!isNum(ch.orig_y)) return bad('faltam orig_x/orig_y');
        if (!near(ch.orig_x,m.src.x)||!near(ch.orig_y,m.src.y)) warn('orig_* não confere com o board.js');
        if (ch.op==='via_del'){ m.deleted = true; break; }
        for (const k of ['x','y','size','drill']) if (isNum(ch[k])) m.eff[k] = ch[k];
        m.changed = true;
        break;
      }
      case 'via_add': {
        for (const k of ['x','y','size','drill']) if (!isNum(ch[k])) return bad(`campo "${k}" ausente/inválido`);
        if (ch.drill>=ch.size) warn('drill >= size (anel nulo)');
        const m = { kind:'via', src:null, eff:{ id:'new-v'+(++addSeq), from:'Top', to:'Bottom', ...ch }, changed:false, added:true };
        model.added.push(m); item.target = m;
        break;
      }
      case 'arc_edit': case 'arc_del': {
        let m = ch.id ? byId[ch.id] : null;
        if (m && m.kind!=='arc') m = null;
        if (!m) return bad(`arco id "${ch.id}" não existe no board.js`);
        item.target = m;
        for (const k of ['cx','cy','r','sa','ea']) if (!isNum(ch['orig_'+k])) return bad('faltam campos orig_*');
        if (!ch.orig_layer) return bad('falta orig_layer');
        const s = m.src;
        if (!near(ch.orig_cx,s.cx)||!near(ch.orig_cy,s.cy)||!near(ch.orig_r,s.r)||
            !nearAng(ch.orig_sa,s.sa)||!nearAng(ch.orig_ea,s.ea)||ch.orig_layer!==s.layer)
          warn('orig_* não confere com o board.js');
        if (ch.op==='arc_del'){ m.deleted = true; break; }
        for (const k of ['cx','cy','r','sa','ea','w']) if (isNum(ch[k])) m.eff[k] = ch[k];
        if (ch.layer) m.eff.layer = ch.layer;
        m.changed = true;
        break;
      }
      case 'arc_add': {
        for (const k of ['cx','cy','r','sa','ea','w']) if (!isNum(ch[k])) return bad(`campo "${k}" ausente/inválido`);
        if (ch.layer!=='Top' && ch.layer!=='Bottom') return bad('layer deve ser Top ou Bottom');
        const m = { kind:'arc', src:null, eff:{ id:'new-a'+(++addSeq), ...ch }, changed:false, added:true };
        model.added.push(m); item.target = m;
        break;
      }
      case 'outline_set': {
        if (!Array.isArray(ch.pts) || ch.pts.length < 3 ||
            ch.pts.some(p => !Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])))
          return bad('pts deve ser [[x,y],...] com >= 3 vértices');
        const segs = [];
        for (let i = 0; i < ch.pts.length; i++) {
          const a = ch.pts[i], b = ch.pts[(i+1) % ch.pts.length];
          segs.push({ kind:'line', x1:a[0], y1:a[1], x2:b[0], y2:b[1] });
        }
        model.outline = segs; model.outlineChanged = true;
        break;
      }
      default:
        bad(`operação desconhecida "${ch.op}"`);
    }
  });
  return model;
}

/* ============ status do projeto na esteira ============ */

function deriveStatus(entry, loaded){
  const f = (entry && entry.files) || {};
  if (f.applyreport) return 'aplicada';
  if (loaded && loaded.changesCount > 0 && f.board) return 'roteada';
  if (f.board) return 'eco';
  if (f.schematic) return 'esquema';
  return 'vazio';
}

return { near, nearAng, isNum, distSeg, TOL, STOL, SHEET_SIZES, ORIENT_DIR,
         applyPcbChanges, deriveStatus };
});
