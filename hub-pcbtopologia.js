/* AltiumPCBMirror v2 - hub-pcbtopologia.js
   A topologia das trilhas da vista PCB, como o Altium a usa para SELECIONAR e ARRASTAR. Pedido do
   dono (2026-10-29): "quando eu arrastar a trilha, eu consiga mover ela sem quebrar a trilha, igual
   o Altium, move nao quebra, mantem a trilha conectada; o Tab 1x seleciona toda a trilha ate a via,
   e Tab 2x seleciona tudo conectado, as outras trilhas alem da via". Logica pura, sem DOM:
   navegador (global HubPcbTopologia) e node (tests/test-pcbtopologia.js).

   Entra a placa EFETIVA no formato do board.js (o EB da vista). Nada aqui escreve na placa: as
   funcoes devolvem ids e geometrias, e a vista escreve as ops.

   O que liga, aqui, e PONTA com PONTA (a ligacao que o Altium segue no Tab e no arrasto), nao o
   cobre que se encosta (isso e o hub-pcbnets):
     trilha/arco   a ponta encosta na ponta de outra da MESMA camada (folga TOL), ou cai no MEIO de
                   outra trilha da mesma camada (o T);
     via           a ponta cai dentro do anel (raio size/2), em qualquer camada de cobre;
     pad           a ponta cai dentro do cobre do pad (retangulo girado; passante vale em toda
                   camada, SMD so na dele).
   So entram trilha e arco LIVRES (sem owner) de cobre, que nao sejam keepout: o que tem dono anda
   com o componente.

   API
     HubPcbTopologia.grafo(eb)                    -> o indice (cacheado por eb)
     HubPcbTopologia.trilhaAteVia(eb, sementes)   -> { tracks:[id], arcs:[id] }   o Tab 1x
     HubPcbTopologia.tudoLigado(eb, sementes)     -> { tracks:[id], arcs:[id], vias:[id] }   o Tab 2x
     HubPcbTopologia.planoArrasto(eb, movem, dx, dy)
         -> { mov:{ track:{id:geo}, arc:{id:geo}, via:{id:geo} },   onde cada um que anda fica
              viz:[{ tipo:'track', id, geo }],                      as vizinhas esticadas
              links:[{ layer, w, net, x1, y1, x2, y2 }] }           trilhas novas que seguram a ligacao
   sementes / movem: { tracks:[id], arcs:[id], vias:[id] } (ids como no EB, em texto ou numero).

   O arrasto, como o Drag do Altium:
     - UMA trilha sozinha anda paralela a si mesma: cada ponta com UMA vizinha reta (e nada fixo ali)
       desliza pela direcao da vizinha ate a reta nova -- os cantos de 45/90 graus ficam; a ponta
       solta, ou com varias vizinhas, anda o deslocamento inteiro e as vizinhas esticam;
     - um grupo (o Tab, a janela, a via) anda inteiro e as vizinhas que ficaram de fora esticam a
       ponta que encostava nele;
     - ponta que estava presa em algo que NAO anda (pad, via de fora, arco de fora) ganha uma trilha
       nova do lugar antigo ao novo, na camada, largura e net dela: a ligacao nao se perde;
     - a trilha de fora com a ponta no MEIO da que anda (o T) desliza ate a reta nova tambem. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HubPcbTopologia = factory();
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const TOL = 1e-3;          /* mm: ponta a ate 1 micro de outra encosta (a TOL do motor) */
const CELULA = 1;          /* mm: lado da celula da grade das pontas */
const MIN_LADO = 1e-3;     /* mm: a vizinha que encolheria abaixo disso nao desliza, estica */
const RE_COBRE = /^(Top|Bottom|Mid\d+|Plane\d+)$/;
const RAD = Math.PI / 180;

function isNum(v){ return typeof v === 'number' && isFinite(v); }
const cobre = k => typeof k === 'string' && RE_COBRE.test(k);
const sid = v => String(v);

const arcoCheio = o => Math.abs(o.ea - o.sa) >= 359.999;     /* a mesma conta da vista */
function pontasArco(a){
  return [[a.cx + a.r * Math.cos(a.sa * RAD), a.cy + a.r * Math.sin(a.sa * RAD)],
          [a.cx + a.r * Math.cos(a.ea * RAD), a.cy + a.r * Math.sin(a.ea * RAD)]];
}
function dPS(px, py, ax, ay, bx, by){
  const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
  let t = L > 0 ? ((px - ax) * vx + (py - ay) * vy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}
/* o ponto dentro do cobre do pad (retangulo girado, com a folga) */
function noPad(p, x, y, tol){
  const w = isNum(p.w) ? p.w : 0, h = isNum(p.h) ? p.h : w;
  const c = Math.cos(-(p.rot || 0) * RAD), s = Math.sin(-(p.rot || 0) * RAD);
  const cx = p.x + (isNum(p.hox) ? p.hox : 0), cy = p.y + (isNum(p.hoy) ? p.hoy : 0);
  const lx = (x - cx) * c - (y - cy) * s, ly = (x - cx) * s + (y - cy) * c;
  return Math.abs(lx) <= w / 2 + tol && Math.abs(ly) <= h / 2 + tol;
}
const padNaCamada = (p, layer) => p.layer === 'Multi' || p.type === 'th' || p.layer === layer;

/* ============================== o indice ============================== */

const CACHE = typeof WeakMap === 'function' ? new WeakMap() : null;
function grafo(eb){
  if (CACHE && eb && CACHE.has(eb)) return CACHE.get(eb);
  const segs = [], porChave = new Map();          /* 'track:id' / 'arc:id' -> seg */
  const vias = [], viaPorId = new Map(), pads = [];
  const G = new Map();                             /* celula -> [{ seg, qual }] */
  const GS = new Map();                            /* celula -> [seg] (o corpo da trilha, para o T) */
  const cel = (x, y) => Math.floor(x / CELULA) + ',' + Math.floor(y / CELULA);
  const poe = (M, k, v) => { let l = M.get(k); if (!l) { l = []; M.set(k, l); } l.push(v); };
  for (const [lista, tipo] of [[eb && eb.tracks, 'track'], [eb && eb.arcs, 'arc']]) for (const o of lista || []) {
    if (!o || o.id == null || o.owner != null && o.owner !== '' || o.keepout || !cobre(o.layer)) continue;
    let p;
    if (tipo === 'track') { if (![o.x1, o.y1, o.x2, o.y2].every(isNum)) continue; p = [[o.x1, o.y1], [o.x2, o.y2]]; }
    else { if (![o.cx, o.cy, o.r, o.sa, o.ea].every(isNum) || arcoCheio(o)) continue; p = pontasArco(o); }
    const s = { tipo, id:sid(o.id), o, layer:o.layer, p };
    segs.push(s); porChave.set(tipo + ':' + s.id, s);
    poe(G, cel(p[0][0], p[0][1]), { seg:s, qual:0 });
    poe(G, cel(p[1][0], p[1][1]), { seg:s, qual:1 });
    if (tipo === 'track') {
      const x1 = Math.floor((Math.min(p[0][0], p[1][0]) - TOL) / CELULA), x2 = Math.floor((Math.max(p[0][0], p[1][0]) + TOL) / CELULA);
      const y1 = Math.floor((Math.min(p[0][1], p[1][1]) - TOL) / CELULA), y2 = Math.floor((Math.max(p[0][1], p[1][1]) + TOL) / CELULA);
      if ((x2 - x1 + 1) * (y2 - y1 + 1) <= 40000)
        for (let i = x1; i <= x2; i++) for (let j = y1; j <= y2; j++) poe(GS, i + ',' + j, s);
    }
  }
  for (const v of (eb && eb.vias) || []) {
    if (!v || v.id == null || !isNum(v.x) || !isNum(v.y)) continue;
    const x = { id:sid(v.id), o:v, r:(v.size > 0 ? v.size : 0) / 2 };
    vias.push(x); viaPorId.set(x.id, x);
  }
  for (const c of (eb && eb.components) || []) for (const p of (c && c.pads) || []) if (p && isNum(p.x) && isNum(p.y)) pads.push(p);
  for (const p of (eb && eb.freepads) || []) if (p && isNum(p.x) && isNum(p.y)) pads.push(p);
  /* as pontas de trilha/arco em volta de (x, y), ate a distancia r */
  function pontasEm(x, y, r, layer){
    const out = [], i0 = Math.floor((x - r) / CELULA), i1 = Math.floor((x + r) / CELULA);
    const j0 = Math.floor((y - r) / CELULA), j1 = Math.floor((y + r) / CELULA);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const e of G.get(i + ',' + j) || []) {
      if (layer && e.seg.layer !== layer) continue;
      const q = e.seg.p[e.qual];
      if (Math.hypot(q[0] - x, q[1] - y) <= r) out.push(e);
    }
    return out;
  }
  /* as trilhas (retas) com o CORPO passando por (x, y) na camada, sem contar a ponta */
  function meiosEm(x, y, layer){
    const out = [];
    for (const s of GS.get(cel(x, y)) || []) {
      if (s.layer !== layer) continue;
      const a = s.p[0], b = s.p[1];
      if (Math.hypot(a[0] - x, a[1] - y) <= TOL || Math.hypot(b[0] - x, b[1] - y) <= TOL) continue;
      if (dPS(x, y, a[0], a[1], b[0], b[1]) <= TOL) out.push(s);
    }
    return out;
  }
  /* as pontas de outras que caem no corpo da trilha s (o T visto do tronco) */
  function pontasNoCorpo(s){
    const out = [], vistos = new Set();
    if (s.tipo !== 'track') return out;
    const a = s.p[0], b = s.p[1];
    const i0 = Math.floor((Math.min(a[0], b[0]) - TOL) / CELULA), i1 = Math.floor((Math.max(a[0], b[0]) + TOL) / CELULA);
    const j0 = Math.floor((Math.min(a[1], b[1]) - TOL) / CELULA), j1 = Math.floor((Math.max(a[1], b[1]) + TOL) / CELULA);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 40000) return out;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const e of G.get(i + ',' + j) || []) {
      if (e.seg === s || e.seg.layer !== s.layer) continue;
      const q = e.seg.p[e.qual], k = e.seg.tipo + ':' + e.seg.id + ':' + e.qual;
      if (vistos.has(k)) continue;
      if (Math.hypot(q[0] - a[0], q[1] - a[1]) <= TOL || Math.hypot(q[0] - b[0], q[1] - b[1]) <= TOL) continue;
      if (dPS(q[0], q[1], a[0], a[1], b[0], b[1]) <= TOL) { vistos.add(k); out.push(e); }
    }
    return out;
  }
  const viasEm = (x, y) => vias.filter(v => Math.hypot(v.o.x - x, v.o.y - y) <= v.r + TOL);
  const padsEm = (x, y, layer) => pads.filter(p => padNaCamada(p, layer) && noPad(p, x, y, TOL));
  const g = { segs, porChave, vias, viaPorId, pads, pontasEm, meiosEm, pontasNoCorpo, viasEm, padsEm };
  if (CACHE && eb) CACHE.set(eb, g);
  return g;
}

function sementesDe(g, s){
  const out = [];
  for (const id of (s && s.tracks) || []) { const x = g.porChave.get('track:' + sid(id)); if (x) out.push(x); }
  for (const id of (s && s.arcs) || []) { const x = g.porChave.get('arc:' + sid(id)); if (x) out.push(x); }
  return out;
}
function resposta(segs, vias){
  const r = { tracks:[], arcs:[] };
  for (const s of segs) (s.tipo === 'track' ? r.tracks : r.arcs).push(s.o.id);
  if (vias) r.vias = vias.map(v => v.o.id);
  return r;
}

/* ============================== o Tab ============================== */

/* Tab 1x: as trilhas e arcos ligados ponta com ponta na mesma camada, parando em via e pad
   (o que esta alem deles nao entra; a via e o pad tambem nao) */
function trilhaAteVia(eb, sementes){
  const g = grafo(eb), vistos = new Set(), fila = sementesDe(g, sementes), out = [];
  for (const s of fila) vistos.add(s);
  while (fila.length) {
    const s = fila.shift();
    out.push(s);
    const viz = [];
    for (const p of s.p) {
      if (g.viasEm(p[0], p[1]).length || g.padsEm(p[0], p[1], s.layer).length) continue;
      for (const e of g.pontasEm(p[0], p[1], TOL, s.layer)) viz.push(e.seg);
      for (const m of g.meiosEm(p[0], p[1], s.layer)) viz.push(m);
    }
    for (const e of g.pontasNoCorpo(s)) {
      const q = e.seg.p[e.qual];
      if (!g.viasEm(q[0], q[1]).length && !g.padsEm(q[0], q[1], s.layer).length) viz.push(e.seg);
    }
    for (const v of viz) if (!vistos.has(v)) { vistos.add(v); fila.push(v); }
  }
  return resposta(out);
}
/* Tab 2x: tudo o que se liga ponta com ponta, ATRAVESSANDO as vias (para as outras camadas); para
   no pad, que e do componente */
function tudoLigado(eb, sementes){
  const g = grafo(eb), vistos = new Set(), viasV = new Set(), fila = sementesDe(g, sementes), out = [], vs = [];
  for (const s of fila) vistos.add(s);
  for (const id of (sementes && sementes.vias) || []) { const v = g.viaPorId.get(sid(id)); if (v && !viasV.has(v)) { viasV.add(v); vs.push(v); } }
  const daVia = v => { for (const e of g.pontasEm(v.o.x, v.o.y, v.r + TOL, null)) if (!vistos.has(e.seg)) { vistos.add(e.seg); fila.push(e.seg); } };
  for (const v of vs.slice()) daVia(v);
  while (fila.length) {
    const s = fila.shift();
    out.push(s);
    for (const p of s.p) {
      for (const v of g.viasEm(p[0], p[1])) if (!viasV.has(v)) { viasV.add(v); vs.push(v); daVia(v); }
      if (g.padsEm(p[0], p[1], s.layer).length) continue;
      for (const e of g.pontasEm(p[0], p[1], TOL, s.layer)) if (!vistos.has(e.seg)) { vistos.add(e.seg); fila.push(e.seg); }
      for (const m of g.meiosEm(p[0], p[1], s.layer)) if (!vistos.has(m)) { vistos.add(m); fila.push(m); }
    }
    for (const e of g.pontasNoCorpo(s)) if (!vistos.has(e.seg)) { vistos.add(e.seg); fila.push(e.seg); }
  }
  return resposta(out, vs);
}

/* ============================== o arrasto ============================== */

/* a interseccao da reta (P + t*u) com a reta (A + s*v): t, ou null se paralelas */
function cruzaRetas(P, u, A, v){
  const den = u[0] * v[1] - u[1] * v[0];
  const L = Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]);
  if (!(L > 0) || Math.abs(den) / L < 1e-6) return null;
  return ((A[0] - P[0]) * v[1] - (A[1] - P[1]) * v[0]) / den;
}
const geoTrilha = (o, a, b) => ({ x1:a[0], y1:a[1], x2:b[0], y2:b[1] });
const geoArco = (o, dx, dy) => ({ cx:o.cx + dx, cy:o.cy + dy, r:o.r, sa:o.sa, ea:o.ea });

function planoArrasto(eb, movem, dx, dy){
  const g = grafo(eb);
  const out = { mov:{ track:{}, arc:{}, via:{} }, viz:[], links:[] };
  const mSegs = sementesDe(g, movem), mVias = [];
  for (const id of (movem && movem.vias) || []) { const v = g.viaPorId.get(sid(id)); if (v) mVias.push(v); }
  const anda = new Set(mSegs), andaVia = new Set(mVias);
  const d = [dx, dy];
  const parado = Math.hypot(dx, dy) < 1e-9;
  /* as pontas das vizinhas (de fora) que mudam: 'tipo:id' -> { seg, p:[p0, p1] } */
  const esticadas = new Map();
  const estica = (seg, qual, P) => {
    const k = seg.tipo + ':' + seg.id;
    let e = esticadas.get(k);
    if (!e) { e = { seg, p:[seg.p[0].slice(), seg.p[1].slice()] }; esticadas.set(k, e); }
    e.p[qual] = [P[0], P[1]];
  };
  const link = (s, A, Bp) => {
    if (parado || Math.hypot(Bp[0] - A[0], Bp[1] - A[1]) < MIN_LADO) return;
    out.links.push({ layer:s.layer, w:s.o.w, net:typeof s.o.net === 'string' ? s.o.net : '', x1:A[0], y1:A[1], x2:Bp[0], y2:Bp[1] });
  };
  /* o que esta na ponta P de s (camada de s), sem contar o que anda */
  const naPonta = (s, P) => {
    const segs = [];
    for (const e of g.pontasEm(P[0], P[1], TOL, s.layer)) if (e.seg !== s && !anda.has(e.seg)) segs.push(e);
    const fixo = g.viasEm(P[0], P[1]).some(v => !andaVia.has(v)) || g.padsEm(P[0], P[1], s.layer).length > 0;
    const meios = g.meiosEm(P[0], P[1], s.layer).filter(m => !anda.has(m));
    return { segs, fixo:fixo || meios.length > 0 };
  };

  const sozinha = mSegs.length === 1 && !mVias.length && mSegs[0].tipo === 'track';
  if (sozinha) {
    /* a trilha anda paralela: as pontas acabam na reta nova (A + d, direcao v) */
    const s = mSegs[0], A = s.p[0], Bq = s.p[1], v = [Bq[0] - A[0], Bq[1] - A[1]];
    const An = [A[0] + dx, A[1] + dy];
    const novas = [null, null];
    for (let q = 0; q < 2; q++) {
      const P = s.p[q], Pd = [P[0] + dx, P[1] + dy], np = naPonta(s, P);
      if (np.fixo) { novas[q] = Pd; link(s, P, Pd); continue; }
      const retas = np.segs.filter(e => e.seg.tipo === 'track');
      if (np.segs.length === 1 && retas.length === 1) {
        const e = retas[0], Q = e.seg.p[1 - e.qual], u = [P[0] - Q[0], P[1] - Q[1]];
        const t = cruzaRetas(Q, u, An, v);
        if (t !== null && t * Math.hypot(u[0], u[1]) > MIN_LADO) {
          const N = [Q[0] + t * u[0], Q[1] + t * u[1]];
          novas[q] = N; estica(e.seg, e.qual, N); continue;
        }
      }
      novas[q] = Pd;
      for (const e of np.segs) { if (e.seg.tipo === 'track') estica(e.seg, e.qual, Pd); else link(s, P, Pd); }
    }
    if (Math.hypot(novas[1][0] - novas[0][0], novas[1][1] - novas[0][1]) < MIN_LADO) { novas[0] = An; novas[1] = [Bq[0] + dx, Bq[1] + dy]; }
    out.mov.track[s.id] = geoTrilha(s.o, novas[0], novas[1]);
    /* o T: a ponta de fora no corpo da que anda desliza ate a reta nova */
    for (const e of g.pontasNoCorpo(s)) {
      if (anda.has(e.seg)) continue;
      const P = e.seg.p[e.qual], Pd = [P[0] + dx, P[1] + dy];
      if (e.seg.tipo !== 'track') { link(s, P, Pd); continue; }
      const Q = e.seg.p[1 - e.qual], u = [P[0] - Q[0], P[1] - Q[1]];
      const t = cruzaRetas(Q, u, An, v);
      estica(e.seg, e.qual, t !== null && t * Math.hypot(u[0], u[1]) > MIN_LADO ? [Q[0] + t * u[0], Q[1] + t * u[1]] : Pd);
    }
  } else {
    for (const s of mSegs) {
      if (s.tipo === 'track') out.mov.track[s.id] = geoTrilha(s.o, [s.p[0][0] + dx, s.p[0][1] + dy], [s.p[1][0] + dx, s.p[1][1] + dy]);
      else out.mov.arc[s.id] = geoArco(s.o, dx, dy);
      for (const P of s.p) {
        const Pd = [P[0] + dx, P[1] + dy], np = naPonta(s, P);
        /* a ponta encostada numa via que tambem anda vai com ela */
        if (g.viasEm(P[0], P[1]).some(v => andaVia.has(v)) && !np.fixo) { for (const e of np.segs) if (e.seg.tipo === 'track') estica(e.seg, e.qual, Pd); continue; }
        if (np.fixo) { link(s, P, Pd); continue; }
        for (const e of np.segs) { if (e.seg.tipo === 'track') estica(e.seg, e.qual, Pd); else link(e.seg, P, Pd); }
      }
      for (const e of g.pontasNoCorpo(s)) {
        if (anda.has(e.seg)) continue;
        const P = e.seg.p[e.qual], Pd = [P[0] + dx, P[1] + dy];
        if (e.seg.tipo === 'track') estica(e.seg, e.qual, Pd); else link(e.seg, P, Pd);
      }
    }
    for (const v of mVias) {
      out.mov.via[v.id] = { x:v.o.x + dx, y:v.o.y + dy };
      /* a trilha de fora que chegava na via estica junto (a ponta guarda a distancia ao centro) */
      for (const e of g.pontasEm(v.o.x, v.o.y, v.r + TOL, null)) {
        if (anda.has(e.seg)) continue;
        const P = e.seg.p[e.qual], Pd = [P[0] + dx, P[1] + dy];
        if (e.seg.tipo === 'track') estica(e.seg, e.qual, Pd); else link(e.seg, P, Pd);
      }
    }
  }
  for (const e of esticadas.values()) {
    if (Math.hypot(e.p[1][0] - e.p[0][0], e.p[1][1] - e.p[0][1]) < MIN_LADO) continue;   /* encolheria a nada: fica */
    out.viz.push({ tipo:'track', id:e.seg.o.id, geo:geoTrilha(e.seg.o, e.p[0], e.p[1]) });
  }
  return out;
}

return { TOL, grafo, trilhaAteVia, tudoLigado, planoArrasto };
});
