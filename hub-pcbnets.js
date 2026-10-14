/* AltiumPCBMirror v2 - hub-pcbnets.js
   Conectividade de cobre da vista PCB, como o Altium a ve: o que esta ligado em cada net, as
   LINHAS DE CONEXAO que faltam (o ratsnest) e o realce de net. Logica pura, sem DOM: navegador
   (global HubPcbNets) e node (tests/test-pcbnets.js).

   Entra a placa EFETIVA no formato do board.js (HubCore.effectiveBoard(board, model): as mudancas
   ja assadas; um board.js sem mudancas ja e uma). Nada aqui escreve na placa.

   O grafo, objeto a objeto:
     pad       de componente e livre. Passante (layer 'Multi') liga TODAS as camadas de cobre, com
               a forma de baixo (bot) na Bottom; SMD so a sua camada. Furo deslocado (hox/hoy)
               desloca o cobre, como no Gerber.
     via       todas as camadas de cobre entre from e to (na ordem do stack).
     trilha    capsula (segmento + w/2); arco vira poligonal de capsulas.
     fill      retangulo girado; region = poligono (com furos), inclusive o pedaco de polygon pour
               despejado (poly:true) e o teardrop do espelho.
     keepout:true NAO e cobre e fica de fora.
   Dois objetos de cobre da MESMA camada se ligam quando o cobre se toca ou se sobrepoe (folga
   <= TOL), nao so quando a ponta e igual: trilha que termina dentro do pad, via no meio da
   trilha, teardrop sobre o pad, poligono que engole a via.

   As nets sao as do board. O que liga e cobre da MESMA net; cobre de nets diferentes se tocando
   e curto (curtos()); cobre sem net nao entra nas ilhas de nenhuma net (o Altium tambem nao da a
   net a uma trilha solta), mas a trilha sem net que encosta em duas nets e curto potencial.

   Linhas de conexao: em cada net, as ilhas (componentes conexos) sao ligadas pela arvore geradora
   minima com a distancia ponto-a-ponto mais curta entre ilhas -- o modo "Shortest" do Altium
   (Design >> Classes / regra RoutingTopology padrao). Os pontos de ligacao sao os do Altium: o
   centro do pad e da via, as pontas da trilha e do arco; fill e region so entram com um ponto
   quando a ilha nao tem outro.

   API
     HubPcbNets.analisa(eb, opcoes)  -> o modelo (cacheado por eb; o mesmo eb devolve o mesmo)
     HubPcbNets.conexoes(eb)         -> { linhas:[{net,x1,y1,x2,y2,de:{tipo,id},para:{tipo,id}}],
                                          nets:{ NET:{ ilhas:[[{tipo,id}]], linhas:[...] } } }
     HubPcbNets.naoRoteadas(eb)      -> { nets:[{net, ilhas, faltam}], total, conexoes }
     HubPcbNets.objetosDaNet(eb,net) -> { ids:[...], pads, vias, tracks, arcs, fills, regions }
     HubPcbNets.netEm(eb, layer, x, y) -> { net, tipo, id, layer } | null
     HubPcbNets.curtos(eb)           -> [{ netA, netB, a:{tipo,id}, b:{tipo,id}, layer, x, y, via? }]
     HubPcbNets.camadasCobre(eb)     -> ['Top', 'Mid1'.., 'Bottom'] na ordem do stack
     HubPcbNets.limpaCache()
   tipo: 'pad' | 'via' | 'track' | 'arc' | 'fill' | 'region'.

   Custo: o grafo e refeito a cada eb novo (o effectiveBoard devolve um a cada edicao), mas a
   forma de cada objeto vem de um cache pela assinatura dele -- o que nao mudou nao e refeito. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HubPcbNets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const TOL = 1e-3;          /* mm: cobre a ate 1 micro de distancia encosta (a TOL do motor) */
const CELULA = 2;          /* mm: lado da celula da grade espacial */
const PASSO_ARCO = 10;     /* graus por capsula do arco (erro de corda < 0,4% do raio) */
const RE_COBRE = /^(Top|Bottom|Mid\d+|Plane\d+)$/;
const TIPOS = ['pad', 'via', 'track', 'arc', 'fill', 'region'];
const PRIOR = { pad: 0, via: 1, track: 2, arc: 3, fill: 4, region: 5 };

function isNum(v){ return typeof v === 'number' && isFinite(v); }
function netDe(o){ return (o && typeof o.net === 'string') ? o.net : ''; }

/* ============================== camadas ============================== */

function ordemCobre(k){
  if (k === 'Top') return 0;
  let m = /^Mid(\d+)$/.exec(k); if (m) return +m[1];
  m = /^Plane(\d+)$/.exec(k); if (m) return 100 + +m[1];   /* plano: entre os mid e a Bottom */
  if (k === 'Bottom') return 1000;
  return 2000;
}
/* as camadas de cobre da placa: o stack do board.layers (espelho novo) mais o que aparece usado */
function camadasCobre(eb){
  const S = new Set(['Top', 'Bottom']);
  const usa = k => { if (typeof k === 'string' && RE_COBRE.test(k)) S.add(k); };
  for (const l of (Array.isArray(eb && eb.layers) ? eb.layers : [])) if (l && isNum(l.stack)) usa(l.key);
  for (const k of ['tracks', 'arcs', 'fills', 'regions']) for (const o of (eb && eb[k]) || []) if (o) usa(o.layer);
  for (const c of (eb && eb.components) || []) for (const p of (c && c.pads) || []) if (p) usa(p.layer);
  for (const p of (eb && eb.freepads) || []) if (p) usa(p.layer);
  for (const v of (eb && eb.vias) || []) if (v) { usa(v.from); usa(v.to); }
  return [...S].sort((a, b) => ordemCobre(a) - ordemCobre(b));
}

/* ============================== formas ==============================
   Toda forma e um "nucleo" (ponto, segmento, poligonal aberta ou poligono fechado) inflado por um
   raio r: circulo = ponto + r; capsula = segmento + r; caixa de cantos redondos = retangulo
   encolhido + r; poligono = fechado com r 0. Assim um teste de distancia serve para tudo. */

function giraEm(cx, cy, c, s, x, y){ return [cx + x * c - y * s, cy + x * s + y * c]; }
function cs(g){
  const a = ((g % 360) + 360) % 360;
  if (a === 0) return [1, 0]; if (a === 90) return [0, 1]; if (a === 180) return [-1, 0]; if (a === 270) return [0, -1];
  const t = a * Math.PI / 180; return [Math.cos(t), Math.sin(t)];
}
function caixaBB(pts, r){
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) { if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0]; if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1]; }
  return [x1 - r, y1 - r, x2 + r, y2 + r];
}
function forma(pts, r, fechado, furos){
  const f = { pts, r, fechado: !!fechado && pts.length >= 3, bb: caixaBB(pts, r) };
  if (furos && furos.length) f.furos = furos;
  return f;
}
/* caixa (hx, hy) de cantos rr girada em (cx, cy): o nucleo e o retangulo encolhido de rr */
function formaCaixa(cx, cy, hx, hy, rr, rot){
  rr = Math.max(0, Math.min(rr, hx, hy));
  const ax = hx - rr, ay = hy - rr, [c, s] = cs(rot || 0);
  let pts;
  if (ax < 1e-9 && ay < 1e-9) pts = [[cx, cy]];
  else if (ay < 1e-9) pts = [giraEm(cx, cy, c, s, -ax, 0), giraEm(cx, cy, c, s, ax, 0)];
  else if (ax < 1e-9) pts = [giraEm(cx, cy, c, s, 0, -ay), giraEm(cx, cy, c, s, 0, ay)];
  else pts = [giraEm(cx, cy, c, s, -ax, -ay), giraEm(cx, cy, c, s, ax, -ay), giraEm(cx, cy, c, s, ax, ay), giraEm(cx, cy, c, s, -ax, ay)];
  return forma(pts, rr, pts.length >= 3);
}
const ehTH = p => p.layer === 'Multi' || (!p.layer && p.type === 'th');
/* a forma do pad no lado pedido (a mesma regra do hub-gerber: bot:{} ou bw/bh/bshape) */
function formaLado(p, bottom){
  if (bottom && ehTH(p)) {
    const b = p.bot && typeof p.bot === 'object' ? p.bot : null;
    if (b) return { shape: b.shape || p.shape, w: isNum(b.w) ? b.w : p.w, h: isNum(b.h) ? b.h : p.h, radius: isNum(b.radius) ? b.radius : p.radius };
    if ('bw' in p || 'bh' in p || 'bshape' in p)
      return { shape: p.bshape || p.shape, w: isNum(p.bw) ? p.bw : p.w, h: isNum(p.bh) ? p.bh : p.h, radius: isNum(p.bradius) ? p.bradius : p.radius };
  }
  return { shape: p.shape, w: p.w, h: p.h, radius: p.radius };
}
/* {hx, hy, rr}: circle com w == h e circulo, senao oval; roundrect usa o radius (sem ele, min/8);
   octogono e o resto: cantos vivos (o retangulo cobre o octogono) */
function caixaDaForma(f){
  const W = f && f.w, H = f && f.h;
  if (!(W > 0) || !(H > 0)) return null;
  let s = String((f && f.shape) || 'rect').toLowerCase();
  if (s === 'circle' || s === 'round') { if (Math.abs(W - H) < 1e-6) return { hx: W / 2, hy: W / 2, rr: W / 2 }; s = 'oval'; }
  if (s === 'oval' || s === 'oblong' || s === 'obround') return { hx: W / 2, hy: H / 2, rr: Math.min(W, H) / 2 };
  if (s === 'roundrect') {
    const r = Math.min(isNum(f.radius) ? f.radius : Math.min(W, H) / 8, Math.min(W, H) / 2);
    if (r > 0) return { hx: W / 2, hy: H / 2, rr: r };
  }
  return { hx: W / 2, hy: H / 2, rr: 0 };
}
function centroCobre(p){
  if ((isNum(p.hox) && p.hox) || (isNum(p.hoy) && p.hoy)) {
    const [c, s] = cs(p.rot || 0), hx = p.hox || 0, hy = p.hoy || 0;
    return [p.x + hx * c - hy * s, p.y + hx * s + hy * c];
  }
  return [p.x, p.y];
}
function formaPad(p, bottom){
  const f = caixaDaForma(formaLado(p, bottom));
  if (!f) return null;
  const c = centroCobre(p);
  return formaCaixa(c[0], c[1], f.hx, f.hy, f.rr, p.rot || 0);
}
function pontosArco(a){
  const sa = a.sa, sw0 = ((a.ea - a.sa) % 360 + 360) % 360;
  const sw = (Math.abs(a.ea - a.sa) >= 360 || (sw0 === 0 && a.ea !== a.sa)) ? 360 : sw0;
  const n = Math.max(1, Math.ceil(sw / PASSO_ARCO)), pts = [];
  for (let i = 0; i <= n; i++) {
    const g = (sa + sw * i / n) * Math.PI / 180;
    pts.push([a.cx + a.r * Math.cos(g), a.cy + a.r * Math.sin(g)]);
  }
  return pts;
}
function formaFill(f){
  const x1 = Math.min(f.x1, f.x2), x2 = Math.max(f.x1, f.x2), y1 = Math.min(f.y1, f.y2), y2 = Math.max(f.y1, f.y2);
  return formaCaixa((x1 + x2) / 2, (y1 + y2) / 2, (x2 - x1) / 2, (y2 - y1) / 2, 0, f.rot || 0);
}
function anel(pts){
  const out = [];
  for (const p of (Array.isArray(pts) ? pts : [])) {
    if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) continue;
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 1e-9 && Math.abs(q[1] - p[1]) < 1e-9) continue;
    out.push([p[0], p[1]]);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-9 && Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-9) out.pop();
  return out;
}

/* ============================== distancias ============================== */

function dPS(px, py, ax, ay, bx, by){
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return Math.sqrt(x * x + y * y);
}
function cruza(ax, ay, bx, by, cx, cy, dx, dy){
  const o1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), o2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const o3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), o4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return ((o1 > 0) !== (o2 > 0)) && ((o3 > 0) !== (o4 > 0)) && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}
function dSS(ax, ay, bx, by, cx, cy, dx, dy){
  if (cruza(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(dPS(ax, ay, cx, cy, dx, dy), dPS(bx, by, cx, cy, dx, dy), dPS(cx, cy, ax, ay, bx, by), dPS(dx, dy, ax, ay, bx, by));
}
function dentroAnel(pts, x, y){
  let d = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) d = !d;
  }
  return d;
}
function dentroForma(f, x, y){
  if (!f.fechado || !dentroAnel(f.pts, x, y)) return false;
  if (f.furos) for (const h of f.furos) if (dentroAnel(h, x, y)) return false;
  return true;
}
/* os segmentos do nucleo (fechado inclui o de volta; ponto vira segmento degenerado) */
function cadaSeg(f, bb, fn){
  const P = f.pts, n = P.length;
  if (n === 1) return fn(P[0][0], P[0][1], P[0][0], P[0][1]);
  const m = f.fechado ? n : n - 1;
  const aneis = f.furos ? [P, ...f.furos] : [P];
  for (const A of aneis) {
    const k = A === P ? m : A.length;
    for (let i = 0; i < k; i++) {
      const a = A[i], b = A[(i + 1) % A.length];
      if (bb && (Math.max(a[0], b[0]) < bb[0] || Math.min(a[0], b[0]) > bb[2] || Math.max(a[1], b[1]) < bb[1] || Math.min(a[1], b[1]) > bb[3])) continue;
      if (fn(a[0], a[1], b[0], b[1])) return true;
    }
  }
  return false;
}
/* encostam? distancia entre nucleos <= rA + rB + tol */
function tocam(A, B, tol){
  const lim = A.r + B.r + tol;
  if (B.fechado && dentroForma(B, A.pts[0][0], A.pts[0][1])) return true;
  if (A.fechado && dentroForma(A, B.pts[0][0], B.pts[0][1])) return true;
  /* so os segmentos perto da caixa do outro interessam (poligono de despejo tem centenas) */
  const bbB = [B.bb[0] - A.r - tol, B.bb[1] - A.r - tol, B.bb[2] + A.r + tol, B.bb[3] + A.r + tol];
  const bbA = [A.bb[0] - B.r - tol, A.bb[1] - B.r - tol, A.bb[2] + B.r + tol, A.bb[3] + B.r + tol];
  return cadaSeg(A, bbB, (ax, ay, bx, by) =>
    cadaSeg(B, bbA, (cx, cy, dx, dy) => dSS(ax, ay, bx, by, cx, cy, dx, dy) <= lim));
}
function noPonto(f, x, y, tol){
  if (x < f.bb[0] - tol || x > f.bb[2] + tol || y < f.bb[1] - tol || y > f.bb[3] + tol) return false;
  if (f.fechado && dentroForma(f, x, y)) return true;
  return cadaSeg(f, null, (ax, ay, bx, by) => dPS(x, y, ax, ay, bx, by) <= f.r + tol);
}

/* ============================== o modelo ============================== */

/* cache de forma pela assinatura do objeto: o eb e novo a cada edicao, os objetos quase todos nao */
let CACHE_FORMA = new Map();
const MAX_CACHE = 200000;
function assinatura(tipo, o, extra){
  let s = tipo + '|' + (extra || '');
  for (const k in o) { const v = o[k]; if (typeof v !== 'object' || v === null) s += '|' + k + ':' + v; }
  if (tipo === 'region') s += '|' + JSON.stringify(o.points) + (o.holes ? JSON.stringify(o.holes) : '');
  if (tipo === 'pad' && o.bot) s += '|' + JSON.stringify(o.bot);
  return s;
}
function memo(tipo, o, extra, fazer){
  const k = assinatura(tipo, o, extra);
  let v = CACHE_FORMA.get(k);
  if (v === undefined) { v = fazer(); if (CACHE_FORMA.size > MAX_CACHE) CACHE_FORMA = new Map(); CACHE_FORMA.set(k, v); }
  return v;
}

/* objetos de cobre: {tipo, id, net, src, formas:[{layer, f}], pts:[[x,y]] (pontos de ligacao)} */
function coleta(eb, cam){
  const objs = [];
  const idx = new Map(cam.map((k, i) => [k, i]));
  const add = (tipo, o, formas, pts) => {
    const ok = formas.filter(x => x && x.f);
    if (!ok.length) return;
    objs.push({ tipo, id: o.id, net: netDe(o), src: o, formas: ok, pts, n: objs.length });
  };
  const pads = [];
  for (const c of eb.components || []) for (const p of (c && c.pads) || []) if (p) pads.push(p);
  for (const p of eb.freepads || []) if (p) pads.push(p);
  for (const p of pads) {
    if (!isNum(p.x) || !isNum(p.y)) continue;
    /* furo sem cobre (NPTH sem anel e sem net) nao liga nada */
    if (p.plated === false && !netDe(p) && !(Math.min(p.w, p.h) > (p.drill || 0) + 1e-6)) continue;
    const fs = memo('pad', p, ehTH(p) ? cam.join(',') : '', () => {
      if (ehTH(p)) {
        const fTop = formaPad(p, false), fBot = formaPad(p, true);
        return cam.map(k => ({ layer: k, f: k === 'Bottom' ? fBot : fTop }));
      }
      return RE_COBRE.test(p.layer) ? [{ layer: p.layer, f: formaPad(p, false) }] : [];
    });
    add('pad', p, ehTH(p) ? fs.filter(x => idx.has(x.layer)) : fs, [[p.x, p.y]]);
  }
  for (const v of eb.vias || []) {
    if (!v || !isNum(v.x) || !isNum(v.y) || !(v.size > 0)) continue;
    const i1 = idx.has(v.from) ? idx.get(v.from) : 0, i2 = idx.has(v.to) ? idx.get(v.to) : cam.length - 1;
    const f = memo('via', v, '', () => formaCaixa(v.x, v.y, v.size / 2, v.size / 2, v.size / 2, 0));
    const fs = [];
    for (let i = Math.min(i1, i2); i <= Math.max(i1, i2); i++) fs.push({ layer: cam[i], f });
    add('via', v, fs, [[v.x, v.y]]);
  }
  for (const t of eb.tracks || []) {
    if (!t || t.keepout || !RE_COBRE.test(t.layer) || !isNum(t.x1) || !isNum(t.y2)) continue;
    const f = memo('track', t, '', () => forma([[t.x1, t.y1], [t.x2, t.y2]], Math.max(0, (t.w || 0) / 2), false));
    add('track', t, [{ layer: t.layer, f }], [[t.x1, t.y1], [t.x2, t.y2]]);
  }
  for (const a of eb.arcs || []) {
    if (!a || a.keepout || !RE_COBRE.test(a.layer) || !isNum(a.cx) || !(a.r > 0)) continue;
    const f = memo('arc', a, '', () => forma(pontosArco(a), Math.max(0, (a.w || 0) / 2), false));
    add('arc', a, [{ layer: a.layer, f }], [f.pts[0], f.pts[f.pts.length - 1]]);
  }
  for (const g of eb.fills || []) {
    if (!g || g.keepout || !RE_COBRE.test(g.layer) || !isNum(g.x1)) continue;
    const f = memo('fill', g, '', () => formaFill(g));
    add('fill', g, [{ layer: g.layer, f }], []);
  }
  for (const g of eb.regions || []) {
    if (!g || g.keepout || !RE_COBRE.test(g.layer)) continue;
    const f = memo('region', g, '', () => {
      const P = anel(g.points);
      if (P.length < 3) return null;
      const H = (Array.isArray(g.holes) ? g.holes : []).map(anel).filter(h => h.length >= 3);
      return forma(P, 0, true, H);
    });
    add('region', g, [{ layer: g.layer, f }], []);
  }
  return objs;
}

/* grade espacial por camada: cada forma em todas as celulas da caixa dela */
function grade(objs, cam, tol){
  const G = new Map();
  for (const k of cam) G.set(k, new Map());
  for (const o of objs) for (const fl of o.formas) {
    const M = G.get(fl.layer); if (!M) continue;
    const b = fl.f.bb;
    const i1 = Math.floor((b[0] - tol) / CELULA), i2 = Math.floor((b[2] + tol) / CELULA);
    const j1 = Math.floor((b[1] - tol) / CELULA), j2 = Math.floor((b[3] + tol) / CELULA);
    for (let i = i1; i <= i2; i++) for (let j = j1; j <= j2; j++) {
      const key = i * 100003 + j;
      let L = M.get(key); if (!L) M.set(key, L = []);
      L.push({ o, f: fl.f });
    }
  }
  return G;
}

function UF(n){
  const p = new Int32Array(n); for (let i = 0; i < n; i++) p[i] = i;
  const find = x => { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; };
  return { find, une(a, b){ a = find(a); b = find(b); if (a !== b) p[a] = b; } };
}

const CACHE = new WeakMap();
function analisa(eb, opcoes){
  if (!eb || typeof eb !== 'object') throw new Error('HubPcbNets: placa efetiva ausente');
  const hit = CACHE.get(eb);
  if (hit && !opcoes) return hit;
  const tol = (opcoes && isNum(opcoes.tol)) ? opcoes.tol : TOL;
  const cam = camadasCobre(eb);
  const objs = coleta(eb, cam);
  const G = grade(objs, cam, tol);
  const uf = UF(objs.length);
  const contatoOutraNet = [];        /* [a, b, layer] com nets diferentes (ou um sem net) */
  /* cada par testado uma vez: so na celula do canto de baixo da intersecao das caixas */
  for (const [layer, M] of G) for (const [key, L] of M) {
    if (L.length < 2) continue;
    for (let i = 0; i < L.length; i++) {
      const A = L[i], ba = A.f.bb;
      for (let j = i + 1; j < L.length; j++) {
        const B = L[j], bb = B.f.bb;
        if (A.o === B.o) continue;
        if (ba[0] > bb[2] + tol || bb[0] > ba[2] + tol || ba[1] > bb[3] + tol || bb[1] > ba[3] + tol) continue;
        const ci = Math.floor((Math.max(ba[0], bb[0]) - tol) / CELULA), cj = Math.floor((Math.max(ba[1], bb[1]) - tol) / CELULA);
        if (ci * 100003 + cj !== key) continue;
        const mesma = A.o.net === B.o.net && A.o.net !== '';
        if (mesma && uf.find(A.o.n) === uf.find(B.o.n)) continue;  /* ja ligados: nao precisa medir */
        if (!tocam(A.f, B.f, tol)) continue;
        if (mesma) uf.une(A.o.n, B.o.n);
        else contatoOutraNet.push([A.o, B.o, layer]);
      }
    }
  }
  /* ilhas por net */
  const porNet = new Map();
  const nomes = Array.isArray(eb.nets) ? eb.nets.filter(n => typeof n === 'string' && n) : [];
  for (const n of nomes) porNet.set(n, []);
  for (const o of objs) if (o.net) { if (!porNet.has(o.net)) porNet.set(o.net, []); porNet.get(o.net).push(o); }
  const ilhas = new Map();
  for (const [net, L] of porNet) {
    const m = new Map();
    for (const o of L) { const r = uf.find(o.n); let I = m.get(r); if (!I) m.set(r, I = []); I.push(o); }
    ilhas.set(net, [...m.values()]);
  }
  const A = { eb, cam, objs, G, uf, ilhas, contatoOutraNet, tol, _linhas: null };
  if (!opcoes) CACHE.set(eb, A);
  return A;
}

/* ============================== linhas de conexao ============================== */

function ref(o){ return { tipo: o.tipo, id: o.id }; }
/* pontos de ligacao da ilha; ilha so de fill/region ganha o centro da caixa da primeira forma */
function pontosIlha(I){
  const P = [];
  for (const o of I) for (const p of o.pts) P.push({ x: p[0], y: p[1], o });
  if (!P.length && I.length) { const b = I[0].formas[0].f.bb; P.push({ x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, o: I[0] }); }
  return P;
}
/* Prim sobre os pontos: a ilha entra inteira de uma vez (custo zero dentro da ilha). O(n^2) sem
   montar arestas: n = pontos da net (o GND inteiro de uma placa grande sao poucos milhares). */
function arvore(net, I){
  if (I.length < 2) return [];
  const P = [], ilhaDe = [];
  I.forEach((ilha, k) => { for (const p of pontosIlha(ilha)) { P.push(p); ilhaDe.push(k); } });
  const n = P.length, dist = new Float64Array(n).fill(Infinity), de = new Int32Array(n).fill(-1);
  const naArvore = new Uint8Array(I.length), linhas = [];
  const entra = k => {
    naArvore[k] = 1;
    for (let i = 0; i < n; i++) if (ilhaDe[i] === k) {
      const xi = P[i].x, yi = P[i].y;
      for (let j = 0; j < n; j++) if (!naArvore[ilhaDe[j]]) {
        const dx = P[j].x - xi, dy = P[j].y - yi, d = dx * dx + dy * dy;
        if (d < dist[j]) { dist[j] = d; de[j] = i; }
      }
    }
  };
  entra(0);
  for (let passo = 1; passo < I.length; passo++) {
    let m = -1, md = Infinity;
    for (let j = 0; j < n; j++) if (!naArvore[ilhaDe[j]] && dist[j] < md) { md = dist[j]; m = j; }
    if (m < 0) break;
    const a = P[de[m]], b = P[m];
    linhas.push({ net, x1: a.x, y1: a.y, x2: b.x, y2: b.y, de: ref(a.o), para: ref(b.o) });
    entra(ilhaDe[m]);
  }
  return linhas;
}
function conexoes(eb){
  const A = analisa(eb);
  if (A._linhas) return A._linhas;
  const nets = {}, linhas = [];
  for (const [net, I] of A.ilhas) {
    const L = arvore(net, I);
    nets[net] = { ilhas: I.map(ilha => ilha.map(ref)), linhas: L };
    for (const l of L) linhas.push(l);
  }
  return (A._linhas = { linhas, nets });
}
function naoRoteadas(eb){
  const C = conexoes(eb), nets = [];
  let conexoesN = 0;
  for (const net of Object.keys(C.nets)) {
    const x = C.nets[net];
    if (x.linhas.length) { nets.push({ net, ilhas: x.ilhas.length, faltam: x.linhas.length, linhas: x.linhas }); conexoesN += x.linhas.length; }
  }
  return { nets, total: nets.length, conexoes: conexoesN };
}

/* ============================== realce e consulta ============================== */

function objetosDaNet(eb, net){
  const A = analisa(eb);
  const out = { ids: [], pads: [], vias: [], tracks: [], arcs: [], fills: [], regions: [] };
  const chave = { pad: 'pads', via: 'vias', track: 'tracks', arc: 'arcs', fill: 'fills', region: 'regions' };
  if (typeof net !== 'string' || !net) return out;
  for (const o of A.objs) if (o.net === net && o.id != null) { out.ids.push(o.id); out[chave[o.tipo]].push(o.id); }
  return out;
}
/* a net do cobre no ponto: na camada dada (cobre) ou, sem camada/Multi/nao-cobre, em todas, a de
   cima primeiro. Pad ganha de via, que ganha de trilha... (a ordem do clique do Altium) */
function netEm(eb, layer, x, y){
  if (!isNum(x) || !isNum(y)) return null;
  const A = analisa(eb);
  const cams = (typeof layer === 'string' && RE_COBRE.test(layer)) ? [layer] : A.cam;
  const key = Math.floor(x / CELULA) * 100003 + Math.floor(y / CELULA);
  let best = null;
  for (const k of cams) {
    const L = A.G.get(k) && A.G.get(k).get(key);
    if (!L) continue;
    for (const it of L) {
      if (!noPonto(it.f, x, y, A.tol)) continue;
      if (!best || PRIOR[it.o.tipo] < PRIOR[best.o.tipo]) best = { o: it.o, layer: k };
    }
    if (best) break;
  }
  return best ? { net: best.o.net, tipo: best.o.tipo, id: best.o.id, layer: best.layer } : null;
}

/* ============================== curtos ============================== */

function pontoContato(a, b){
  const x1 = Math.max(a[0], b[0]), x2 = Math.min(a[2], b[2]), y1 = Math.max(a[1], b[1]), y2 = Math.min(a[3], b[3]);
  return [+((x1 + x2) / 2).toFixed(4), +((y1 + y2) / 2).toFixed(4)];
}
function curtos(eb){
  const A = analisa(eb);
  if (A._curtos) return A._curtos;
  const out = [], visto = new Set();
  const fOf = (o, layer) => (o.formas.find(x => x.layer === layer) || o.formas[0]).f;
  /* cobre de nets diferentes se tocando */
  for (const [a, b, layer] of A.contatoOutraNet) {
    if (!a.net || !b.net) continue;
    const k = [a.tipo + a.id, b.tipo + b.id].sort().join('~');
    if (visto.has(k)) continue; visto.add(k);
    const p = pontoContato(fOf(a, layer).bb, fOf(b, layer).bb);
    out.push({ netA: a.net, netB: b.net, a: ref(a), b: ref(b), layer, x: p[0], y: p[1] });
  }
  /* cobre sem net encostando em duas nets (ou mais): o grupo sem net e a ponte */
  const sem = A.objs.filter(o => !o.net);
  if (sem.length) {
    const uf = UF(A.objs.length);
    const toques = new Map();
    for (const [a, b] of A.contatoOutraNet) {
      if (!a.net && !b.net) uf.une(a.n, b.n);
    }
    for (const [a, b, layer] of A.contatoOutraNet) {
      if (!!a.net === !!b.net) continue;
      const s = a.net ? b : a, c = a.net ? a : b, r = uf.find(s.n);
      let m = toques.get(r); if (!m) toques.set(r, m = new Map());
      if (!m.has(c.net)) m.set(c.net, { o: c, s, layer });
    }
    for (const m of toques.values()) {
      if (m.size < 2) continue;
      const L = [...m.entries()];
      for (let i = 1; i < L.length; i++) {
        const [na, A1] = L[0], [nb, B1] = L[i];
        const p = pontoContato(fOf(A1.s, A1.layer).bb, fOf(A1.s, A1.layer).bb);
        out.push({ netA: na, netB: nb, a: ref(A1.o), b: ref(B1.o), layer: A1.layer, x: p[0], y: p[1], via: ref(A1.s) });
      }
    }
  }
  return (A._curtos = out);
}

function limpaCache(){ CACHE_FORMA = new Map(); }

return { analisa, conexoes, naoRoteadas, objetosDaNet, netEm, curtos, camadasCobre, limpaCache,
         _int: { tocam, forma, formaCaixa, formaPad, caixaDaForma, formaLado, dPS, dentroAnel, TOL } };
});
