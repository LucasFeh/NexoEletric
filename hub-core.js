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

/* ============ Esquema: libs, transform e extracao de nets (preview) ============ */

function symbolOf(schlib, name){
  return ((schlib && schlib.symbols) || []).find(s => s.name === name) || null;
}
function partOf(sym, part){
  if (!sym || !sym.parts || !sym.parts.length) return null;
  return sym.parts.find(p => p.part === (part || 1)) || null;
}
function footprintOf(pcblib, name){
  return ((pcblib && pcblib.footprints) || []).find(f => f.name === name) || null;
}
/* ponta quente do pino (onde o fio conecta), em coords locais do simbolo */
function pinHot(pin){
  const d = ORIENT_DIR[((pin.orient % 360) + 360) % 360] || [1, 0];
  return { x: pin.x + d[0]*pin.len, y: pin.y + d[1]*pin.len };
}
/* transform local->mundo de um componente: espelha X, rotaciona anti-horario, translada */
function compTransform(comp){
  const rot = (((comp.rot || 0) % 360) + 360) % 360;
  const cos = Math.cos(rot * Math.PI/180), sin = Math.sin(rot * Math.PI/180);
  const mx = comp.mirror ? -1 : 1;
  return {
    map(x, y){ const lx = x*mx, ly = y; return { x: comp.x + lx*cos - ly*sin, y: comp.y + lx*sin + ly*cos }; },
    ang(a){ return ((((comp.mirror ? 180 - a : a) + rot) % 360) + 360) % 360; }
  };
}
/* pontas quentes de todos os pinos do componente, em coords da folha; null se simbolo desconhecido */
function compPinsWorld(comp, schlib){
  const sym = symbolOf(schlib, comp.sym); if (!sym) return null;
  const part = partOf(sym, comp.part);    if (!part) return null;
  const tf = compTransform(comp);
  return (part.pins || []).map(p => {
    const h = pinHot(p), w = tf.map(h.x, h.y);
    return { num: p.num, name: p.name, x: w.x, y: w.y };
  });
}

/* agrupa a lista plana "items" em folhas */
function buildSchModel(schematic){
  const model = { project: (schematic && schematic.project) || '', units: (schematic && schematic.units) || 'mil', sheets: [] };
  const byName = {};
  for (const it of ((schematic && schematic.items) || [])) {
    if (it.t === 'sheet') {
      if (byName[it.name]) continue;
      const s = { name: it.name, size: it.size || 'A4', comps:[], wires:[], netlabels:[], powers:[], junctions:[], texts:[] };
      model.sheets.push(s); byName[it.name] = s;
      continue;
    }
    let s = byName[it.sheet];
    if (!s) {
      s = { name: it.sheet || 'main', size:'A4', comps:[], wires:[], netlabels:[], powers:[], junctions:[], texts:[] };
      model.sheets.push(s); byName[s.name] = s;
    }
    if      (it.t === 'comp')     s.comps.push(it);
    else if (it.t === 'wire')     s.wires.push(it);
    else if (it.t === 'netlabel') s.netlabels.push(it);
    else if (it.t === 'power')    s.powers.push(it);
    else if (it.t === 'junction') s.junctions.push(it);
    else if (it.t === 'text')     s.texts.push(it);
  }
  return model;
}

/* Extracao de nets (PREVIEW - a verdade e o compilador do Altium).
   Regras: pontos coincidentes conectam; ponto de conexao (extremo de fio, pino,
   junction, ancora de rotulo/power) SOBRE um segmento conecta (T); cruzamento sem
   ponto de conexao NAO conecta; netlabel funde grupos por nome; power funde por
   nome globalmente. Nome automatico: Net<ref>_<pino> do menor pino. */
function extractNets(schematicOrModel, schlib){
  const model = schematicOrModel.sheets ? schematicOrModel : buildSchModel(schematicOrModel);
  const warnings = [];
  const parent = [];
  const mk = () => { parent.push(parent.length); return parent.length - 1; };
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

  const nodeMap = {};
  const key = (si, x, y) => si + '|' + Math.round(x*2) + '|' + Math.round(y*2);
  const nodeAt = (si, x, y) => { const k = key(si, x, y); if (!(k in nodeMap)) nodeMap[k] = mk(); return nodeMap[k]; };

  const segs = [], attach = [], pinRecs = [], labelRecs = [], powerRecs = [];
  const wireNet = model.sheets.map(s => s.wires.map(() => ''));

  model.sheets.forEach((s, si) => {
    s.wires.forEach((w, wi) => {
      const pts = w.pts || [];
      for (let i = 0; i < pts.length - 1; i++) {
        const nA = nodeAt(si, pts[i][0], pts[i][1]), nB = nodeAt(si, pts[i+1][0], pts[i+1][1]);
        uni(nA, nB);
        segs.push({ si, wi, x1:pts[i][0], y1:pts[i][1], x2:pts[i+1][0], y2:pts[i+1][1], node:nA });
      }
      pts.forEach(p => attach.push({ si, x:p[0], y:p[1], node:nodeAt(si, p[0], p[1]), kind:'wend' }));
    });
    s.comps.forEach(c => {
      const pins = compPinsWorld(c, schlib);
      if (!pins) { warnings.push(`${c.ref}: símbolo "${c.sym}" desconhecido — pinos ignorados na extração`); return; }
      pins.forEach(p => {
        const n = nodeAt(si, p.x, p.y);
        pinRecs.push({ ref:c.ref, num:p.num, node:n });
        attach.push({ si, x:p.x, y:p.y, node:n, kind:'pin' });
      });
    });
    s.junctions.forEach(j => attach.push({ si, x:j.x, y:j.y, node:nodeAt(si, j.x, j.y), kind:'junction' }));
    s.netlabels.forEach(l => { const n = nodeAt(si, l.x, l.y); labelRecs.push({ net:l.net, node:n, x:l.x, y:l.y }); attach.push({ si, x:l.x, y:l.y, node:n, kind:'label' }); });
    s.powers.forEach(p => { const n = nodeAt(si, p.x, p.y); powerRecs.push({ net:p.net, node:n }); attach.push({ si, x:p.x, y:p.y, node:n, kind:'power' }); });
  });

  /* conexoes em T: ponto de conexao sobre o interior de um segmento */
  const autoJunctions = [];
  for (const a of attach) {
    for (const g of segs) {
      if (g.si !== a.si) continue;
      if ((near(a.x,g.x1,STOL) && near(a.y,g.y1,STOL)) || (near(a.x,g.x2,STOL) && near(a.y,g.y2,STOL))) continue;
      if (distSeg(a.x, a.y, g.x1, g.y1, g.x2, g.y2) <= STOL) {
        uni(a.node, g.node);
        if (a.kind === 'pin' || a.kind === 'wend' || a.kind === 'junction')
          autoJunctions.push({ sheet:a.si, x:a.x, y:a.y });
      }
    }
  }

  /* fusao por nome (netlabel e power) */
  const nameRoot = {};
  for (const rec of labelRecs.concat(powerRecs)) {
    const r = find(rec.node);
    if (rec.net in nameRoot) uni(nameRoot[rec.net], r); else nameRoot[rec.net] = r;
  }

  /* agrupamento e nomeacao */
  const groups = {};
  const gof = n => { const r = find(n); if (!groups[r]) groups[r] = { names:new Set(), pins:[] }; return groups[r]; };
  for (const rec of labelRecs) gof(rec.node).names.add(rec.net);
  for (const rec of powerRecs) gof(rec.node).names.add(rec.net);
  for (const rec of pinRecs)   gof(rec.node).pins.push(rec.ref + '-' + rec.num);
  for (const g of segs) gof(g.node);
  const segRoots = new Set(segs.map(g => find(g.node)));

  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric:true, sensitivity:'base' });
  const netByRoot = {}, nets = [];
  for (const r in groups) {
    const g = groups[r];
    const names = [...g.names].sort(natural);
    let name = '', auto = false;
    if (names.length > 1) warnings.push('nomes de net conflitantes no mesmo grupo: ' + names.join(', '));
    if (names.length) name = names[0];
    else if (g.pins.length) {
      const ps = g.pins.slice().sort(natural);
      name = 'Net' + ps[0].replace('-', '_'); auto = true;
    }
    netByRoot[r] = name;
    /* net so entra na lista se: tem rotulo/power (e algum fio ou pino), ou tem >= 2 pinos.
       Pino solto sem fio NAO vira net (equivale a NetlistSinglePinNets=0 do Altium). */
    if (names.length) {
      if (g.pins.length || segRoots.has(+r))
        nets.push({ name, pins: g.pins.slice().sort(natural), auto: false });
    } else if (g.pins.length >= 2) {
      nets.push({ name, pins: g.pins.slice().sort(natural), auto: true });
    }
    if (!name && !g.pins.length && segRoots.has(+r))
      warnings.push('fio sem conexão (nenhum pino ou rótulo)');
  }
  for (const rec of labelRecs) {
    const r = find(rec.node), g = groups[r];
    if (!segRoots.has(r) && (!g || !g.pins.length))
      warnings.push(`netlabel "${rec.net}" solta em (${rec.x},${rec.y})`);
  }
  nets.sort((a, b) => natural(a.name, b.name));

  const pinNet = {};
  for (const rec of pinRecs) { const nm = netByRoot[find(rec.node)]; if (nm) pinNet[rec.ref + '-' + rec.num] = nm; }
  for (const g of segs) { const nm = netByRoot[find(g.node)]; if (nm) wireNet[g.si][g.wi] = nm; }

  return { nets, pinNet, wireNet, autoJunctions, warnings };
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
         symbolOf, partOf, footprintOf, pinHot, compTransform, compPinsWorld,
         buildSchModel, extractNets,
         applyPcbChanges, deriveStatus };
});
