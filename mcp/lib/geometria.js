/* NexoEletric MCP - geometria.js
   Contas pequenas sobre a placa EFETIVA (HubCore.effectiveBoard): forma de pad, ponto no
   poligono, e a conectividade de reserva que o nets_ratsnest usa enquanto o hub-pcbnets.js
   (HubPcbNets, o motor de verdade) nao chega.

   A conectividade aqui e a de bancada, nao a do DRC: liga o que ENCOSTA (ponta de trilha
   dentro do pad, da via, sobre outra trilha da mesma camada, dentro de fill/regiao de cobre).
   Serve para dizer "falta ligar R1.1 a C2.2" e onde; a palavra final e do motor do hub e do
   DRC do Altium. */
'use strict';
const isNum = v => typeof v === 'number' && isFinite(v);

function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x1 + t * dx - px, y1 + t * dy - py);
}
function noPoligono(pts, x, y) {
  let d = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) d = !d;
  }
  return d;
}
/* o ponto (x,y) cai no pad (com folga `tol`)? */
function noPad(p, x, y, tol) {
  tol = tol || 0;
  const a = -(p.rot || 0) * Math.PI / 180;
  const dx = x - p.x, dy = y - p.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
  const w = (p.w || 0) / 2 + tol, h = (p.h || p.w || 0) / 2 + tol;
  const sh = String(p.shape || 'rect').toLowerCase();
  if (sh === 'circle' || sh === 'round' || sh === 'oval' || sh === 'oblong' || sh === 'obround') {
    const r = Math.min(w, h), cx = Math.max(0, w - r), cy = Math.max(0, h - r);
    return Math.hypot(Math.max(0, Math.abs(lx) - cx), Math.max(0, Math.abs(ly) - cy)) <= r;
  }
  return Math.abs(lx) <= w && Math.abs(ly) <= h;
}
/* o contorno do pad como poligono (para desenhar) */
function poligonoPad(p, n) {
  const w = (p.w || 0) / 2, h = (p.h || p.w || 0) / 2;
  const sh = String(p.shape || 'rect').toLowerCase();
  const loc = [];
  if (sh === 'circle' || sh === 'round' || sh === 'oval' || sh === 'oblong' || sh === 'obround' || sh === 'roundrect') {
    const r = sh === 'roundrect' ? Math.min(w, h) * ((isNum(p.radius) ? p.radius : 50) / 100) : Math.min(w, h);
    const cx = w - r, cy = h - r, k = n || 8;
    const canto = (ox, oy, a0) => { for (let i = 0; i <= k; i++) { const a = a0 + i * Math.PI / 2 / k; loc.push([ox + r * Math.cos(a), oy + r * Math.sin(a)]); } };
    canto(cx, cy, 0); canto(-cx, cy, Math.PI / 2); canto(-cx, -cy, Math.PI); canto(cx, -cy, 1.5 * Math.PI);
  } else if (sh === 'octagon' || sh === 'octagonal') {
    const c = Math.min(w, h) * 0.4142;
    loc.push([w, h - c], [w - c, h], [-w + c, h], [-w, h - c], [-w, -h + c], [-w + c, -h], [w - c, -h], [w, -h + c]);
  } else loc.push([w, h], [-w, h], [-w, -h], [w, -h]);
  const a = (p.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return loc.map(([x, y]) => [p.x + x * c - y * s, p.y + x * s + y * c]);
}
function pontosArco(a, passo) {
  let sa = a.sa, ea = a.ea;
  if (!(ea > sa)) ea += 360;
  const n = Math.max(4, Math.ceil((ea - sa) / (passo || 10)));
  const out = [];
  for (let i = 0; i <= n; i++) { const t = (sa + (ea - sa) * i / n) * Math.PI / 180; out.push([a.cx + a.r * Math.cos(t), a.cy + a.r * Math.sin(t)]); }
  return out;
}

/* ---------------- conectividade de reserva ---------------- */
function ehCobre(hc, k) { return hc.isCopper(k); }

function conectividade(hc, eb) {
  const itens = [];
  const add = o => { o.i = itens.length; itens.push(o); return o; };
  const pads = [];
  for (const c of eb.components || []) for (const p of (c && c.pads) || []) if (p) pads.push(add({ k: 'pad', p, ref: c.ref, nome: c.ref + '.' + p.name, net: p.net || '', camadas: p.type === 'th' || p.layer === 'Multi' ? null : [p.layer] }));
  for (const p of eb.freepads || []) if (p) pads.push(add({ k: 'pad', p, ref: '', nome: (p.id || 'pad') + '', net: p.net || '', camadas: p.type === 'th' || p.layer === 'Multi' ? null : [p.layer] }));
  const vias = (eb.vias || []).filter(Boolean).map(v => add({ k: 'via', v, net: v.net || '', camadas: null }));
  const tr = [];
  for (const t of eb.tracks || []) if (t && ehCobre(hc, t.layer) && !t.keepout) tr.push(add({ k: 'trilha', t, camadas: [t.layer], net: t.net || '', segs: [[t.x1, t.y1, t.x2, t.y2]], pontas: [[t.x1, t.y1], [t.x2, t.y2]], w: t.w || 0 }));
  for (const a of eb.arcs || []) if (a && ehCobre(hc, a.layer) && !a.keepout) {
    const P = pontosArco(a, 15), segs = [];
    for (let i = 1; i < P.length; i++) segs.push([P[i - 1][0], P[i - 1][1], P[i][0], P[i][1]]);
    tr.push(add({ k: 'arco', t: a, camadas: [a.layer], net: a.net || '', segs, pontas: [P[0], P[P.length - 1]], w: a.w || 0 }));
  }
  const areas = [];
  for (const f of eb.fills || []) if (f && ehCobre(hc, f.layer) && !f.keepout) areas.push(add({ k: 'fill', camadas: [f.layer], net: f.net || '', pts: [[f.x1, f.y1], [f.x2, f.y1], [f.x2, f.y2], [f.x1, f.y2]] }));
  for (const g of eb.regions || []) if (g && ehCobre(hc, g.layer) && !g.keepout && Array.isArray(g.points)) areas.push(add({ k: 'regiao', camadas: [g.layer], net: g.net || '', pts: g.points }));

  const pai = itens.map((_, i) => i);
  const acha = i => { while (pai[i] !== i) { pai[i] = pai[pai[i]]; i = pai[i]; } return i; };
  const une = (a, b) => { a = acha(a); b = acha(b); if (a !== b) pai[b] = a; };
  const mesmaCamada = (A, B) => !A.camadas || !B.camadas || A.camadas.some(x => B.camadas.includes(x));
  const TOL = 1e-3;

  for (const T of tr) {
    for (const [x, y] of T.pontas) {
      for (const P of pads) if (mesmaCamada(T, P) && noPad(P.p, x, y, TOL)) une(T.i, P.i);
      for (const V of vias) if (Math.hypot(V.v.x - x, V.v.y - y) <= (V.v.size || 0) / 2 + TOL) une(T.i, V.i);
      for (const U of tr) if (U !== T && mesmaCamada(T, U) && U.segs.some(s => distSeg(x, y, s[0], s[1], s[2], s[3]) <= U.w / 2 + TOL)) une(T.i, U.i);
      for (const A of areas) if (mesmaCamada(T, A) && noPoligono(A.pts, x, y)) une(T.i, A.i);
    }
  }
  for (const V of vias) {
    for (const P of pads) if (noPad(P.p, V.v.x, V.v.y, TOL)) une(V.i, P.i);
    for (const A of areas) if (noPoligono(A.pts, V.v.x, V.v.y)) une(V.i, A.i);
  }
  for (const P of pads) for (const A of areas) if (mesmaCamada(P, A) && noPoligono(A.pts, P.p.x, P.p.y)) une(P.i, A.i);

  /* por net: os grupos de pads e as ligacoes que faltam (arvore minima entre os grupos) */
  const porNet = new Map();
  for (const P of pads) { if (!P.net) continue; if (!porNet.has(P.net)) porNet.set(P.net, []); porNet.get(P.net).push(P); }
  const nets = [];
  let faltam = 0;
  for (const [net, L] of porNet) {
    const grupos = new Map();
    for (const P of L) { const r = acha(P.i); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(P); }
    const G = [...grupos.values()];
    const rats = [];
    if (G.length > 1) {
      const dentro = new Set([0]);
      while (dentro.size < G.length) {
        let best = null;
        for (const gi of dentro) for (let gj = 0; gj < G.length; gj++) {
          if (dentro.has(gj)) continue;
          for (const a of G[gi]) for (const b of G[gj]) {
            const d = Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y);
            if (!best || d < best.d) best = { d, a, b, gj };
          }
        }
        dentro.add(best.gj);
        rats.push({ de: best.a.nome, para: best.b.nome, x1: best.a.p.x, y1: best.a.p.y, x2: best.b.p.x, y2: best.b.p.y, dist: Math.round(best.d * 1e4) / 1e4 });
      }
    }
    faltam += rats.length;
    nets.push({ net, pads: L.length, grupos: G.length, roteada: G.length <= 1, faltam: rats });
  }
  /* curto: dois pads de nets diferentes no mesmo grupo */
  const curtos = [];
  const netDoGrupo = new Map();
  for (const P of pads) {
    if (!P.net) continue;
    const r = acha(P.i);
    if (!netDoGrupo.has(r)) netDoGrupo.set(r, P);
    else if (netDoGrupo.get(r).net !== P.net) curtos.push({ a: netDoGrupo.get(r).nome, netA: netDoGrupo.get(r).net, b: P.nome, netB: P.net });
  }
  nets.sort((a, b) => b.faltam.length - a.faltam.length || a.net.localeCompare(b.net));
  return { motor: 'reserva do MCP (encostar = ligar)', nets_total: nets.length, nets_roteadas: nets.filter(n => n.roteada).length, ligacoes_faltando: faltam, nets, curtos: curtos.slice(0, 50) };
}

module.exports = { distSeg, noPoligono, noPad, poligonoPad, pontosArco, conectividade };
