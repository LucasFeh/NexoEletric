/* AltiumPCBMirror v2 - hub-pcbcotas.js — a régua da vista PCB (Ctrl+M) e as cotas que ficam na placa.

   Pedido do dono (2026-10-29): "o Ctrl+M, pra medir distância entre 2 pontos, queria que fosse igual
   ao do NexoCAD: você marca 2 pontos — centros, tangentes, centros de borda de círculo, qualquer
   coisa —, solta e arrasta e fica lá marcando; pode esconder essas cotas ou mostrar, com um botão na
   barra de ferramenta".

   Este módulo é a parte sem tela (testável em Node, tests/test-pcbcotas.js):
     indice(eb, op)          os pontos de agarre da placa efetiva (cache por placa)
     agarra(idx, w, tol, op) o agarre sob o cursor: ponto (centro, ponta, meio, quadrante, vértice,
                             canto, origem) > borda/tangente/sobre a linha > dentro de pad ou via (centro)
     geometria(cota)         a cota pronta para desenhar: pontas resolvidas (a tangente encosta no
                             círculo do lado da outra ponta, como a Cota inteligente do NexoCAD),
                             modo (alinhada, horizontal, vertical), linha de cota, valor e texto
     desenha / desenhaAgarre o canvas, com as contas da vista injetadas (px, mundo→tela, DPR)

   Cota = { id, a, b, modo:'auto'|'alinhada'|'h'|'v', q:{x,y} }. a/b = { x, y, tipo, circ?:{cx,cy,r},
   cond?:'perto'|'longe'|'centro' } — com circ, a ponta é a tangente do círculo (cond 'perto' = a
   mais próxima da outra ponta, 'longe' = a do lado oposto, 'centro' = o centro). q = por onde passa
   a linha de cota (o arrasto depois do 2º ponto). Tudo em mm, no referencial da placa.

   UMD como o hub-pcbicones.js: module.exports em Node, global HubPcbCotas no navegador. */
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubPcbCotas = m;
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const isNum = v => typeof v === 'number' && isFinite(v);
const RAD = Math.PI / 180;
const ROTULO = {
  centro:'centro', furo:'centro do furo', ponta:'ponta', meio:'meio', quadrante:'quadrante (borda do círculo)',
  vertice:'vértice', canto:'canto', borda:'borda do cobre', tangente:'tangente', sobre:'sobre a linha',
  origem:'origem do componente', dentro:'centro (dentro)', grade:'grade', livre:'livre',
};
const MODOS = { auto:'automática', alinhada:'alinhada', h:'horizontal', v:'vertical' };

function gira(x, y, rot){
  if (!rot) return [x, y];
  const c = Math.cos(rot * RAD), s = Math.sin(rot * RAD);
  return [x * c - y * s, x * s + y * c];
}
/* o arco (sa -> ea, anti-horário) passa pelo ângulo g? */
function noArco(sa, ea, g){
  if (Math.abs(ea - sa) >= 359.999) return true;
  const sw = (((ea - sa) % 360) + 360) % 360, d = (((g - sa) % 360) + 360) % 360;
  return d <= sw + 1e-9;
}
function pertoNoSeg(x, y, x1, y1, x2, y2){
  const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((x - x1) * dx + (y - y1) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return [x1 + t * dx, y1 + t * dy];
}
function distSeg(x, y, x1, y1, x2, y2){ const q = pertoNoSeg(x, y, x1, y1, x2, y2); return Math.hypot(x - q[0], y - q[1]); }
/* um contorno de pontos que é um círculo (o furo de fixação do Altium vem assim): centro e raio */
function circuloDosPontos(pts){
  if (!Array.isArray(pts) || pts.length < 12) return null;
  let sx = 0, sy = 0, n = 0;
  for (const p of pts) if (p && isNum(p[0]) && isNum(p[1])) { sx += p[0]; sy += p[1]; n++; }
  if (n < 12) return null;
  const cx = sx / n, cy = sy / n;
  let sr = 0, mn = Infinity, mx = 0;
  for (const p of pts) { const r = Math.hypot(p[0] - cx, p[1] - cy); sr += r; mn = Math.min(mn, r); mx = Math.max(mx, r); }
  const r = sr / n;
  return r > 0 && (mx - mn) <= r * 0.03 ? { cx, cy, r } : null;
}

/* ============================== o índice dos agarres ==============================
   op: { centroCobre(p) -> [x,y] (o furo deslocado), ehTH(p), recortes:[{pts}] (os furos de
   fixação e recortes da placa) }. As camadas: a do objeto; pad passante e via = 'Multi'; contorno
   e recortes = '_placa' (sempre à vista). */
const CACHE = typeof WeakMap === 'function' ? new WeakMap() : null;
function indice(eb, op){
  op = op || {};
  if (!eb || typeof eb !== 'object') return { pts:[], segs:[], circs:[], areas:[] };
  if (CACHE && CACHE.has(eb) && !op.semCache) return CACHE.get(eb);
  const pts = [], segs = [], circs = [], areas = [];
  const P = (x, y, t, l) => { if (isNum(x) && isNum(y)) pts.push({ x, y, t, l }); };
  const S = (x1, y1, x2, y2, l, w) => { if ([x1, y1, x2, y2].every(isNum) && (x1 !== x2 || y1 !== y2)) segs.push({ x1, y1, x2, y2, l, w:w > 0 ? w : 0 }); };
  const C = (cx, cy, r, l, sa, ea) => { if (isNum(cx) && isNum(cy) && r > 0) circs.push({ cx, cy, r, l, sa:isNum(sa) ? sa : 0, ea:isNum(ea) ? ea : 360 }); };
  const quadrantes = (cx, cy, r, l, sa, ea) => {
    for (const g of [0, 90, 180, 270]) if (sa === undefined || noArco(sa, ea, g)) P(cx + r * Math.cos(g * RAD), cy + r * Math.sin(g * RAD), 'quadrante', l);
  };
  const poli = (lista, l, fechado) => {
    if (!Array.isArray(lista) || lista.length < 2) return;
    const n = lista.length;
    for (let i = 0; i < n; i++) {
      const a = lista[i]; if (!a) continue;
      P(a[0], a[1], 'vertice', l);
      if (!fechado && i === n - 1) break;
      const b = lista[(i + 1) % n]; if (!b) continue;
      S(a[0], a[1], b[0], b[1], l, 0);
      if (n <= 64) P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 'meio', l);
    }
    const c = fechado ? circuloDosPontos(lista) : null;
    if (c) { P(c.cx, c.cy, 'centro', l); C(c.cx, c.cy, c.r, l); quadrantes(c.cx, c.cy, c.r, l); }
  };
  const linha = (o, l, comBorda) => {
    if (!o) return;
    if (o.kind === 'arc' || isNum(o.cx)) {
      if (!(isNum(o.cx) && isNum(o.cy) && o.r > 0 && isNum(o.sa) && isNum(o.ea))) return;
      const cheio = Math.abs(o.ea - o.sa) >= 359.999;
      P(o.cx, o.cy, 'centro', l);
      if (cheio) quadrantes(o.cx, o.cy, o.r, l);
      else {
        P(o.cx + o.r * Math.cos(o.sa * RAD), o.cy + o.r * Math.sin(o.sa * RAD), 'ponta', l);
        P(o.cx + o.r * Math.cos(o.ea * RAD), o.cy + o.r * Math.sin(o.ea * RAD), 'ponta', l);
        const sw = (((o.ea - o.sa) % 360) + 360) % 360, gm = o.sa + sw / 2;
        P(o.cx + o.r * Math.cos(gm * RAD), o.cy + o.r * Math.sin(gm * RAD), 'meio', l);
        quadrantes(o.cx, o.cy, o.r, l, o.sa, o.ea);
      }
      C(o.cx, o.cy, o.r, l, cheio ? 0 : o.sa, cheio ? 360 : o.ea);
      return;
    }
    if (![o.x1, o.y1, o.x2, o.y2].every(isNum)) return;
    P(o.x1, o.y1, 'ponta', l); P(o.x2, o.y2, 'ponta', l);
    P((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2, 'meio', l);
    S(o.x1, o.y1, o.x2, o.y2, l, comBorda ? o.w : 0);
  };
  const pad = p => {
    if (!p || !isNum(p.x) || !isNum(p.y)) return;
    const l = (op.ehTH ? op.ehTH(p) : p.layer === 'Multi') ? 'Multi' : (p.layer || 'Top');
    const c = op.centroCobre ? op.centroCobre(p) : [p.x, p.y];
    const forma = String(p.shape || 'rect').toLowerCase(), W = p.w, H = p.h, rot = isNum(p.rot) ? p.rot : 0;
    P(c[0], c[1], 'centro', l);
    if (p.drill > 0 && Math.hypot(c[0] - p.x, c[1] - p.y) > 1e-6) P(p.x, p.y, 'furo', l);
    if (!(W > 0 && H > 0)) return;
    areas.push({ x:c[0], y:c[1], r:Math.min(W, H) / 2, l });
    if ((forma === 'circle' || forma === 'round') && Math.abs(W - H) < 1e-9) { C(c[0], c[1], W / 2, l); quadrantes(c[0], c[1], W / 2, l); return; }
    const em = (lx, ly) => { const g = gira(lx, ly, rot); return [c[0] + g[0], c[1] + g[1]]; };
    for (const q of [[W / 2, 0], [-W / 2, 0], [0, H / 2], [0, -H / 2]]) { const e = em(q[0], q[1]); P(e[0], e[1], 'meio', l); }
    const ponta = forma === 'circle' || forma === 'round' || forma === 'oval' || forma === 'oblong' || forma === 'obround';
    if (ponta) {
      /* o oblongo: os dois semicírculos das pontas (tangente) e os dois lados retos */
      const r = Math.min(W, H) / 2, d = Math.abs(W - H) / 2, eixoX = W >= H;
      for (const s of [1, -1]) {
        const e = eixoX ? em(s * d, 0) : em(0, s * d);
        C(e[0], e[1], r, l);
        const a = eixoX ? em(-d, s * r) : em(s * r, -d), b = eixoX ? em(d, s * r) : em(s * r, d);
        S(a[0], a[1], b[0], b[1], l, 0);
      }
      return;
    }
    const k = [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]].map(q => em(q[0], q[1]));
    for (let i = 0; i < 4; i++) { P(k[i][0], k[i][1], 'canto', l); S(k[i][0], k[i][1], k[(i + 1) % 4][0], k[(i + 1) % 4][1], l, 0); }
  };
  for (const c of eb.components || []) {
    if (!c) continue;
    for (const p of c.pads || []) pad(p);
    if (isNum(c.x) && isNum(c.y)) P(c.x, c.y, 'origem', c.layer === 'Bottom' ? 'Bottom' : 'Top');
  }
  for (const p of eb.freepads || []) pad(p);
  for (const v of eb.vias || []) {
    if (!v || !isNum(v.x) || !isNum(v.y)) continue;
    P(v.x, v.y, 'centro', 'Multi');
    const r = (v.size || 0) / 2;
    if (r > 0) { C(v.x, v.y, r, 'Multi'); quadrantes(v.x, v.y, r, 'Multi'); areas.push({ x:v.x, y:v.y, r, l:'Multi' }); }
  }
  for (const o of eb.tracks || []) if (o && !o.keepout) linha(o, o.layer, true);
  for (const o of eb.arcs || []) if (o && !o.keepout) linha(Object.assign({ kind:'arc' }, o), o.layer, false);
  for (const o of eb.silk || []) if (o) linha(o, o.layer, false);
  for (const o of eb.lines || []) if (o) linha(o, o.layer, false);
  for (const f of eb.fills || []) {
    if (!f || ![f.x1, f.y1, f.x2, f.y2].every(isNum)) continue;
    const cx = (f.x1 + f.x2) / 2, cy = (f.y1 + f.y2) / 2, W = Math.abs(f.x2 - f.x1), H = Math.abs(f.y2 - f.y1), rot = isNum(f.rot) ? f.rot : 0;
    P(cx, cy, 'centro', f.layer);
    const k = [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]].map(q => { const g = gira(q[0], q[1], rot); return [cx + g[0], cy + g[1]]; });
    for (let i = 0; i < 4; i++) {
      const a = k[i], b = k[(i + 1) % 4];
      P(a[0], a[1], 'canto', f.layer); P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 'meio', f.layer); S(a[0], a[1], b[0], b[1], f.layer, 0);
    }
  }
  for (const g of eb.regions || []) if (g && Array.isArray(g.points)) poli(g.points, g.layer, true);
  for (const g of eb.polygons || []) if (g && Array.isArray(g.pts || g.points)) poli(g.pts || g.points, g.layer, true);
  for (const k of op.recortes || []) if (k && Array.isArray(k.pts)) poli(k.pts, '_placa', true);
  const bd = eb.board || {};
  for (const s of bd.outline || []) linha(s, '_placa', false);
  const idx = { pts, segs, circs, areas };
  if (CACHE && !op.semCache) CACHE.set(eb, idx);
  return idx;
}

/* ============================== o agarre sob o cursor ==============================
   tol em mm (a vista passa 10 px). op.visivel(camada) filtra as camadas escondidas; '_placa' vale
   sempre. Devolve { x, y, tipo, circ? } ou null (a vista cai na grade). */
function agarra(idx, w, tol, op){
  if (!idx || !w || !isNum(w.x) || !isNum(w.y)) return null;
  op = op || {};
  const vis = l => l === '_placa' || !op.visivel || op.visivel(l);
  let melhor = null, dm = Infinity;
  for (const p of idx.pts) {
    const d = Math.hypot(w.x - p.x, w.y - p.y);
    if (d <= tol && d < dm && vis(p.l)) { dm = d; melhor = { x:p.x, y:p.y, tipo:p.t }; }
  }
  if (melhor) return melhor;
  for (const c of idx.circs) {
    const dc = Math.hypot(w.x - c.cx, w.y - c.cy), d = Math.abs(dc - c.r);
    if (d > tol || d >= dm || dc < 1e-12 || !vis(c.l)) continue;
    const g = Math.atan2(w.y - c.cy, w.x - c.cx) / RAD;
    if (!noArco(c.sa, c.ea, g)) continue;
    dm = d;
    melhor = { x:c.cx + (w.x - c.cx) / dc * c.r, y:c.cy + (w.y - c.cy) / dc * c.r, tipo:'tangente', circ:{ cx:c.cx, cy:c.cy, r:c.r } };
  }
  for (const s of idx.segs) {
    if (!vis(s.l)) continue;
    const mx = Math.min(s.x1, s.x2) - tol - s.w, Mx = Math.max(s.x1, s.x2) + tol + s.w;
    const my = Math.min(s.y1, s.y2) - tol - s.w, My = Math.max(s.y1, s.y2) + tol + s.w;
    if (w.x < mx || w.x > Mx || w.y < my || w.y > My) continue;
    const q = pertoNoSeg(w.x, w.y, s.x1, s.y1, s.x2, s.y2), d = Math.hypot(w.x - q[0], w.y - q[1]);
    if (d <= tol && d < dm) { dm = d; melhor = { x:q[0], y:q[1], tipo:'sobre' }; }
    /* a borda do cobre da trilha: a linha do centro deslocada de meia largura, do lado do cursor */
    if (s.w > 0 && d > 1e-9) {
      const de = Math.abs(d - s.w / 2);
      if (de <= tol && de < dm) { dm = de; melhor = { x:q[0] + (w.x - q[0]) / d * s.w / 2, y:q[1] + (w.y - q[1]) / d * s.w / 2, tipo:'borda' }; }
    }
  }
  if (melhor) return melhor;
  /* dentro de um pad ou via grande, longe de tudo: o centro dele */
  let ra = Infinity;
  for (const a of idx.areas) {
    const d = Math.hypot(w.x - a.x, w.y - a.y);
    if (d <= a.r && a.r < ra && vis(a.l)) { ra = a.r; melhor = { x:a.x, y:a.y, tipo:'dentro' }; }
  }
  return melhor;
}

/* ============================== a geometria da cota ============================== */
const condDe = p => (p && p.circ) ? (p.cond === 'longe' || p.cond === 'centro' ? p.cond : 'perto') : null;
/* o ponto de referência de uma ponta: o centro do círculo (a tangente se resolve a partir dele) */
const refDe = p => (p.circ ? { x:p.circ.cx, y:p.circ.cy } : { x:p.x, y:p.y });
function sinal(v){ return v > 0 ? 1 : v < 0 ? -1 : 1; }
/* as pontas de verdade, para um modo: a tangente encosta no círculo do lado da outra ponta (perto) ou
   do lado oposto (longe); 'centro' fica no centro. Alinhada: na reta entre os centros; horizontal e
   vertical: no extremo do círculo naquele eixo. */
function resolve(c, modo){
  const pa = refDe(c.a), pb = refDe(c.b), ca = condDe(c.a), cb = condDe(c.b);
  let A = { x:pa.x, y:pa.y }, B = { x:pb.x, y:pb.y };
  if (modo === 'h' || modo === 'v') {
    const k = modo === 'h' ? 'x' : 'y';
    if (ca && ca !== 'centro') A[k] = pa[k] + sinal(pb[k] - pa[k]) * c.a.circ.r * (ca === 'longe' ? -1 : 1);
    if (cb && cb !== 'centro') B[k] = pb[k] + sinal(pa[k] - pb[k]) * c.b.circ.r * (cb === 'longe' ? -1 : 1);
    return { A, B };
  }
  const dx = pb.x - pa.x, dy = pb.y - pa.y, L = Math.hypot(dx, dy);
  const ux = L > 1e-12 ? dx / L : 1, uy = L > 1e-12 ? dy / L : 0;
  if (ca && ca !== 'centro') { const s = c.a.circ.r * (ca === 'longe' ? -1 : 1); A = { x:pa.x + ux * s, y:pa.y + uy * s }; }
  if (cb && cb !== 'centro') { const s = c.b.circ.r * (cb === 'longe' ? -1 : 1); B = { x:pb.x - ux * s, y:pb.y - uy * s }; }
  return { A, B };
}
/* o modo automático (o da Cota inteligente): o cursor acima ou abaixo dos dois pontos dá a
   horizontal, ao lado dá a vertical, no meio ou na diagonal dá a alinhada */
function modoAuto(c, q){
  const r = resolve(c, 'alinhada'), A = r.A, B = r.B;
  if (!q) return 'alinhada';
  const dx = Math.abs(B.x - A.x), dy = Math.abs(B.y - A.y);
  if (dx < 1e-9 && dy < 1e-9) return 'alinhada';
  if (dy < 1e-9) return 'h';
  if (dx < 1e-9) return 'v';
  const dentroX = q.x >= Math.min(A.x, B.x) && q.x <= Math.max(A.x, B.x);
  const dentroY = q.y >= Math.min(A.y, B.y) && q.y <= Math.max(A.y, B.y);
  if (dentroX && !dentroY) return 'h';
  if (dentroY && !dentroX) return 'v';
  return 'alinhada';
}
function geometria(c){
  if (!c || !c.a || !c.b) return null;
  const q = c.q || null;
  const modo = c.modo === 'alinhada' || c.modo === 'h' || c.modo === 'v' ? c.modo : modoAuto(c, q);
  const { A, B } = resolve(c, modo);
  let D1, D2, valor;
  if (modo === 'h') {
    const y0 = q ? q.y : Math.max(A.y, B.y);
    D1 = { x:A.x, y:y0 }; D2 = { x:B.x, y:y0 }; valor = Math.abs(B.x - A.x);
  } else if (modo === 'v') {
    const x0 = q ? q.x : Math.max(A.x, B.x);
    D1 = { x:x0, y:A.y }; D2 = { x:x0, y:B.y }; valor = Math.abs(B.y - A.y);
  } else {
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
    valor = L;
    if (L < 1e-12) { D1 = { x:A.x, y:A.y }; D2 = { x:B.x, y:B.y }; }
    else {
      const nx = -dy / L, ny = dx / L, off = q ? (q.x - A.x) * nx + (q.y - A.y) * ny : 0;
      D1 = { x:A.x + nx * off, y:A.y + ny * off }; D2 = { x:B.x + nx * off, y:B.y + ny * off };
    }
  }
  return { modo, A, B, D1, D2, valor, T:{ x:(D1.x + D2.x) / 2, y:(D1.y + D2.y) / 2 },
           dx:Math.abs(B.x - A.x), dy:Math.abs(B.y - A.y), dist:Math.hypot(B.x - A.x, B.y - A.y) };
}
/* o cursor toca a cota? (a linha de cota, as de chamada, ou o texto: raioTexto em mm) */
function toca(g, w, tol, raioTexto){
  if (!g || !w) return false;
  if (distSeg(w.x, w.y, g.D1.x, g.D1.y, g.D2.x, g.D2.y) <= tol) return true;
  if (Math.hypot(w.x - g.T.x, w.y - g.T.y) <= (raioTexto || tol)) return true;
  if (distSeg(w.x, w.y, g.A.x, g.A.y, g.D1.x, g.D1.y) <= tol * 0.6) return true;
  return distSeg(w.x, w.y, g.B.x, g.B.y, g.D2.x, g.D2.y) <= tol * 0.6;
}

/* ============================== o desenho ==============================
   op: { px(n) -> mm, aTela(x,y) -> {x,y} em px CSS, DPR, voltaMundo(), texto(g) -> string, cor,
   forte (selecionada), fonte, fundo }. Linhas no mundo; o texto na tela, sempre de pé. */
function desenha(ctx, g, op){
  if (!g) return;
  const px = op.px, cor = op.cor || '#4fc3f7';
  ctx.save();
  ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = cor; ctx.fillStyle = cor;
  /* as linhas de chamada: um respiro na ponta e um pouco além da linha de cota */
  ctx.globalAlpha = 0.75; ctx.lineWidth = px(op.forte ? 1.4 : 1);
  ctx.beginPath();
  for (const [P, D] of [[g.A, g.D1], [g.B, g.D2]]) {
    const vx = D.x - P.x, vy = D.y - P.y, L = Math.hypot(vx, vy);
    if (L <= px(2)) continue;
    const ux = vx / L, uy = vy / L;
    ctx.moveTo(P.x + ux * px(3), P.y + uy * px(3)); ctx.lineTo(D.x + ux * px(5), D.y + uy * px(5));
  }
  ctx.stroke();
  /* a linha de cota e as setas (por dentro; curta demais, por fora) */
  ctx.globalAlpha = 1; ctx.lineWidth = px(op.forte ? 2 : 1.3);
  const vx = g.D2.x - g.D1.x, vy = g.D2.y - g.D1.y, L = Math.hypot(vx, vy);
  const ux = L > 1e-12 ? vx / L : 1, uy = L > 1e-12 ? vy / L : 0, nx = -uy, ny = ux;
  const al = px(9), aw = px(3.2), fora = L < al * 2.6;
  ctx.beginPath();
  if (fora) { ctx.moveTo(g.D1.x - ux * al * 2, g.D1.y - uy * al * 2); ctx.lineTo(g.D2.x + ux * al * 2, g.D2.y + uy * al * 2); }
  else { ctx.moveTo(g.D1.x, g.D1.y); ctx.lineTo(g.D2.x, g.D2.y); }
  ctx.stroke();
  const seta = (T, sx, sy) => {
    ctx.beginPath(); ctx.moveTo(T.x, T.y);
    ctx.lineTo(T.x + sx * al + nx * aw, T.y + sy * al + ny * aw); ctx.lineTo(T.x + sx * al - nx * aw, T.y + sy * al - ny * aw);
    ctx.closePath(); ctx.fill();
  };
  if (L > 1e-12) { const s = fora ? -1 : 1; seta(g.D1, ux * s, uy * s); seta(g.D2, -ux * s, -uy * s); }
  for (const P of [g.A, g.B]) { ctx.beginPath(); ctx.arc(P.x, P.y, px(2.2), 0, 2 * Math.PI); ctx.fill(); }
  /* o valor, na tela, ao longo da linha e de pé */
  const s1 = op.aTela(g.D1.x, g.D1.y), s2 = op.aTela(g.D2.x, g.D2.y), sm = op.aTela(g.T.x, g.T.y);
  let ang = Math.hypot(s2.x - s1.x, s2.y - s1.y) > 1 ? Math.atan2(s2.y - s1.y, s2.x - s1.x) : 0;
  if (ang > Math.PI / 2) ang -= Math.PI; else if (ang <= -Math.PI / 2) ang += Math.PI;
  const txt = op.texto ? op.texto(g) : String(g.valor);
  const D = op.DPR || 1;
  ctx.setTransform(D, 0, 0, D, 0, 0);
  ctx.translate(sm.x, sm.y); ctx.rotate(ang);
  ctx.font = (op.forte ? '700 ' : '600 ') + '12px ' + (op.fonte || 'sans-serif');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(txt).width;
  ctx.globalAlpha = 1;
  ctx.fillStyle = op.fundo || 'rgba(0,0,0,0.78)';
  ctx.fillRect(-tw / 2 - 5, -19, tw + 10, 17);
  if (op.forte) { ctx.strokeStyle = cor; ctx.lineWidth = 1; ctx.strokeRect(-tw / 2 - 5, -19, tw + 10, 17); }
  ctx.fillStyle = cor; ctx.fillText(txt, 0, -10);
  ctx.restore();
  if (op.voltaMundo) op.voltaMundo();
  return tw;
}
/* o marcador do agarre (o símbolo de cada tipo, como no CAD) e o nome dele perto do cursor */
function desenhaAgarre(ctx, s, op){
  if (!s || s.tipo === 'grade' || s.tipo === 'livre') return;
  const px = op.px, r = px(6), cor = op.cor || '#00e5ff';
  ctx.save();
  ctx.setLineDash([]); ctx.strokeStyle = cor; ctx.fillStyle = cor; ctx.lineWidth = px(1.6); ctx.globalAlpha = 1;
  ctx.beginPath();
  switch (s.tipo) {
    case 'centro': case 'furo': case 'dentro':
      ctx.arc(s.x, s.y, r, 0, 2 * Math.PI); ctx.moveTo(s.x - r * 1.5, s.y); ctx.lineTo(s.x + r * 1.5, s.y); ctx.moveTo(s.x, s.y - r * 1.5); ctx.lineTo(s.x, s.y + r * 1.5); break;
    case 'ponta': case 'vertice': case 'canto': case 'origem':
      ctx.rect(s.x - r, s.y - r, 2 * r, 2 * r); break;
    case 'meio':
      ctx.moveTo(s.x, s.y + r * 1.15); ctx.lineTo(s.x + r, s.y - r * 0.6); ctx.lineTo(s.x - r, s.y - r * 0.6); ctx.closePath(); break;
    case 'quadrante':
      ctx.moveTo(s.x, s.y + r); ctx.lineTo(s.x + r, s.y); ctx.lineTo(s.x, s.y - r); ctx.lineTo(s.x - r, s.y); ctx.closePath(); break;
    case 'tangente':
      ctx.arc(s.x, s.y, r * 0.8, 0, 2 * Math.PI); break;
    default:
      ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x + r, s.y + r); ctx.moveTo(s.x - r, s.y + r); ctx.lineTo(s.x + r, s.y - r);
  }
  ctx.stroke();
  if (s.tipo === 'tangente' && s.circ) {
    ctx.globalAlpha = 0.55; ctx.lineWidth = px(1); ctx.setLineDash([px(4), px(3)]);
    ctx.beginPath(); ctx.arc(s.circ.cx, s.circ.cy, s.circ.r, 0, 2 * Math.PI); ctx.stroke();
    /* a reta tangente no ponto */
    const ux = (s.x - s.circ.cx) / s.circ.r, uy = (s.y - s.circ.cy) / s.circ.r;
    ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.lineWidth = px(1.4);
    ctx.beginPath(); ctx.moveTo(s.x - uy * r * 2, s.y + ux * r * 2); ctx.lineTo(s.x + uy * r * 2, s.y - ux * r * 2); ctx.stroke();
  }
  /* o nome do agarre, embaixo e à direita do cursor */
  const t = op.aTela(s.x, s.y), D = op.DPR || 1, nome = ROTULO[s.tipo] || s.tipo;
  ctx.setTransform(D, 0, 0, D, 0, 0); ctx.setLineDash([]); ctx.globalAlpha = 1;
  ctx.font = '11px ' + (op.fonte || 'sans-serif'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(nome).width;
  ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(t.x + 12, t.y + 10, tw + 8, 15);
  ctx.fillStyle = cor; ctx.fillText(nome, t.x + 16, t.y + 18);
  ctx.restore();
  if (op.voltaMundo) op.voltaMundo();
}

return { ROTULO, MODOS, indice, agarra, resolve, modoAuto, geometria, toca, desenha, desenhaAgarre, circuloDosPontos, noArco };
});
