/* NexoEletric - hub-pcbborda.js — a BORDA DA PLACA editada com o mouse: as contas (puras, sem DOM).

   Pedido do dono (2026-11-10): "eu também queria que fosse possível expandir a seleção com tab 2x quando selecionar a
   borda da PCB, mas só a borda pra movimentar, também queria que fosse possível arrastar, aumentar e diminuir a borda
   da PCB só com interface de click".

   A borda é o EB.board.outline (retas e arcos, em ordem) e, para editar, os `pts` do outline_set (HubCore.outlineToPts:
   [x, y] ou [x, y, bulge] — o bulge diz o arco do vértice até o próximo). A vista (pcbframe.js) seleciona, desenha as
   alças e grava UM outline_set por gesto (um Ctrl+Z volta tudo); aqui só a geometria:
     cadeia(segs, i)            os índices dos segmentos ligados ao i pelas pontas (o 1º Tab do Altium), em ordem
     caixa(segs)                {x1, y1, x2, y2, w, h} da borda (o arco pelos extremos dele)
     transladaPts(pts, dx, dy)  a borda inteira andando (o bulge fica)
     moveVertice(pts, i, x, y)  um vértice no lugar novo (as duas arestas e os arcos ligados nele acompanham)
     moveAresta(pts, i, d)      a aresta reta i (do vértice i ao i+1) anda d mm pela normal, e as pontas deslizam pelas
                                arestas retas vizinhas (o chanfro de 45° continua de 45°, o canto em esquadro continua em
                                esquadro); vizinha em arco ou paralela: a ponta anda junto, pela normal (o arco estica)
     normalAresta(pts, i)       a normal (para fora quando a borda é anti-horária) da aresta i
     arestaReta(pts, i)         a aresta i é reta (sem bulge)?
     cruza(pts)                 duas arestas (retas, como corda) se cruzam?
     area(pts)                  a área com sinal (positiva = anti-horária) */
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubPcbBorda = m;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const isNum = v => typeof v === 'number' && isFinite(v);
const r6 = v => { const x = Math.round(v * 1e6) / 1e6; return x === 0 ? 0 : x; };
const T = 1e-3;

function pontas(s) {
  if (s.kind === 'arc') {
    const p = g => [s.cx + s.r * Math.cos(g * Math.PI / 180), s.cy + s.r * Math.sin(g * Math.PI / 180)];
    return [p(s.sa), p(s.ea)];
  }
  return [[s.x1, s.y1], [s.x2, s.y2]];
}
const igual = (a, b) => Math.abs(a[0] - b[0]) <= T && Math.abs(a[1] - b[1]) <= T;

/* os segmentos ligados ao i pelas pontas (busca em largura), na ordem do outline */
function cadeia(segs, i) {
  const S = Array.isArray(segs) ? segs : [];
  if (!S[i]) return [];
  const P = S.map(s => (s ? pontas(s) : null));
  const visto = new Set([i]), fila = [i];
  while (fila.length) {
    const k = fila.shift();
    for (let j = 0; j < S.length; j++) {
      if (visto.has(j) || !P[j]) continue;
      if (P[k].some(a => P[j].some(b => igual(a, b)))) { visto.add(j); fila.push(j); }
    }
  }
  return [...visto].sort((a, b) => a - b);
}

function caixa(segs) {
  let b = null;
  const poe = (x, y) => { if (!b) b = { x1: x, y1: y, x2: x, y2: y }; else { b.x1 = Math.min(b.x1, x); b.y1 = Math.min(b.y1, y); b.x2 = Math.max(b.x2, x); b.y2 = Math.max(b.y2, y); } };
  for (const s of segs || []) {
    if (!s) continue;
    if (s.kind === 'arc') {
      for (const p of pontas(s)) poe(p[0], p[1]);
      /* os extremos do círculo que caem dentro do arco */
      let sa = ((s.sa % 360) + 360) % 360, sw = (((s.ea - s.sa) % 360) + 360) % 360;
      if (sw === 0) sw = 360;
      for (const g of [0, 90, 180, 270]) { const d = (((g - sa) % 360) + 360) % 360; if (d <= sw + 1e-9) poe(s.cx + s.r * Math.cos(g * Math.PI / 180), s.cy + s.r * Math.sin(g * Math.PI / 180)); }
    } else { poe(s.x1, s.y1); poe(s.x2, s.y2); }
  }
  if (b) { b.w = r6(b.x2 - b.x1); b.h = r6(b.y2 - b.y1); }
  return b;
}

const copia = p => (isNum(p[2]) && p[2] ? [p[0], p[1], p[2]] : [p[0], p[1]]);
function transladaPts(pts, dx, dy) {
  return pts.map(p => { const q = copia(p); q[0] = r6(p[0] + dx); q[1] = r6(p[1] + dy); return q; });
}
function moveVertice(pts, i, x, y) {
  const out = pts.map(copia);
  out[i][0] = r6(x); out[i][1] = r6(y);
  return out;
}
const arestaReta = (pts, i) => !(isNum(pts[i][2]) && Math.abs(pts[i][2]) > 1e-12);
function area(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
/* a normal unitária da aresta i, para FORA da borda (anti-horária: à direita de quem anda) */
function normalAresta(pts, i) {
  const n = pts.length, a = pts[i], b = pts[(i + 1) % n];
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  if (!(L > 1e-9)) return null;
  const s = area(pts) >= 0 ? 1 : -1;
  return [s * dy / L + 0, -s * dx / L + 0];
}
/* a interseção das retas (p1 + t·d1) e (p2 + u·d2); null se paralelas */
function intersecao(p1, d1, p2, d2) {
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
  return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
}
function moveAresta(pts, i, d) {
  const n = pts.length, out = pts.map(copia);
  const ia = i, ib = (i + 1) % n;
  const nn = normalAresta(pts, i);
  if (!nn || !arestaReta(pts, i)) return null;
  const A = pts[ia], B = pts[ib], dir = [B[0] - A[0], B[1] - A[1]];
  const A2 = [A[0] + nn[0] * d, A[1] + nn[1] * d], B2 = [B[0] + nn[0] * d, B[1] + nn[1] * d];
  /* a ponta A desliza pela aresta anterior (de ia-1 até ia), se ela é reta */
  const ip = (ia - 1 + n) % n, inx = (ib + 1) % n;
  let novaA = A2, novaB = B2;
  if (arestaReta(pts, ip)) { const P = pts[ip]; const q = intersecao(A2, dir, P, [A[0] - P[0], A[1] - P[1]]); if (q) novaA = q; }
  if (arestaReta(pts, ib)) { const N = pts[inx]; const q = intersecao(B2, dir, N, [B[0] - N[0], B[1] - N[1]]); if (q) novaB = q; }
  out[ia][0] = r6(novaA[0]); out[ia][1] = r6(novaA[1]);
  out[ib][0] = r6(novaB[0]); out[ib][1] = r6(novaB[1]);
  return out;
}
function cruza(pts) {
  const n = pts.length;
  const corta = (p1, p2, p3, p4) => {
    const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
    return ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12));
  };
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (corta(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
  }
  return false;
}

return { cadeia, caixa, transladaPts, moveVertice, moveAresta, normalAresta, arestaReta, cruza, area };
});
