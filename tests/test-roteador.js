/* O roteador que contorna (hub-roteador.js), provado sem navegador.

   O pedido do dono (2026-10-02): trilha de mesma camada não cruza; se for cruzar, o software não
   deixa e tenta sozinho um caminho em volta, sem mexer no que já está colocado — e "na vdd elas
   só se encontram se forem trilhas de mesma NET, caso contrario não".

   O teste não confia no motor para conferir o motor: TODA rota devolvida aqui passa por um
   VERIFICADOR INDEPENDENTE (força bruta: amostra cada perna a cada 0,01 mm e mede a distância de
   cada amostra a cada obstáculo pela geometria CRUA do EB, com contas escritas de outro jeito —
   retângulo por clamp, polígono por número de voltas, arco pelo ângulo em graus).

   A placa real (DMB) é opcional: sem o board.js, a parte dela pula calada. Os números dela não
   ficam presos aqui — os pares de pontos são procurados no board.js a cada rodada. */
const assert = require('assert');
const fs = require('fs'), path = require('path');
const R = require('../hub-roteador.js');
const F = require('../hub-fio.js');

const FOLGA = 0.254;
const near = (a, b, t) => Math.abs(a - b) <= (t || 1e-9);
const D2R = Math.PI / 180;

/* ============================== o verificador independente ============================== */

function dSegV(px, py, ax, ay, bx, by){
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay, L = vx * vx + vy * vy;
  if (L === 0) return Math.hypot(wx, wy);
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / L));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}
/* arco pelo ângulo em graus: dentro da varredura -> |raio - r|; fora -> a ponta mais perto */
function dArcoV(px, py, a){
  const cheio = Math.abs(a.ea - a.sa) >= 359.999;
  const varre = ((a.ea - a.sa) % 360 + 360) % 360;
  const rel = ((Math.atan2(py - a.cy, px - a.cx) / D2R - a.sa) % 360 + 360) % 360;
  if (cheio || rel <= varre + 1e-9) return Math.abs(Math.hypot(px - a.cx, py - a.cy) - a.r);
  const p1 = [a.cx + a.r * Math.cos(a.sa * D2R), a.cy + a.r * Math.sin(a.sa * D2R)];
  const p2 = [a.cx + a.r * Math.cos(a.ea * D2R), a.cy + a.r * Math.sin(a.ea * D2R)];
  return Math.min(Math.hypot(px - p1[0], py - p1[1]), Math.hypot(px - p2[0], py - p2[1]));
}
/* caixa girada de cantos redondos (W x H, raio rr) pelo clamp no miolo */
function dCaixaV(px, py, cx, cy, W, H, rr, rot){
  const t = -(rot || 0) * D2R, ux = px - cx, uy = py - cy;
  const lx = ux * Math.cos(t) - uy * Math.sin(t), ly = ux * Math.sin(t) + uy * Math.cos(t);
  const a = W / 2 - rr, b = H / 2 - rr;
  const qx = Math.max(-a, Math.min(a, lx)), qy = Math.max(-b, Math.min(b, ly));
  const d = Math.hypot(lx - qx, ly - qy);
  if (d > 0) return d - rr;
  return -Math.min(a - Math.abs(lx), b - Math.abs(ly)) - rr;
}
/* polígono por número de voltas */
function voltas(pts, x, y){
  let w = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const lado = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
    if (a[1] <= y) { if (b[1] > y && lado > 0) w++; }
    else if (b[1] <= y && lado < 0) w--;
  }
  return w;
}
function dBordaV(aneis, x, y){
  let d = Infinity;
  for (const p of aneis) for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; d = Math.min(d, dSegV(x, y, a[0], a[1], b[0], b[1])); }
  return d;
}
function sdPoligonoV(escuros, furos, x, y){
  const dentro = escuros.some(p => voltas(p, x, y) !== 0) && !furos.some(p => voltas(p, x, y) !== 0);
  const d = dBordaV(escuros.concat(furos), x, y);
  return dentro ? -d : d;
}
function bbPts(pts, m){
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) { x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]); x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]); }
  return [x1 - (m || 0), y1 - (m || 0), x2 + (m || 0), y2 + (m || 0)];
}
const RE_COBRE_V = /^(Top|Bottom|Mid\d+|Plane\d+)$/;
/* a forma do pad na camada, pelas convenções do contrato (as do hub-gerber.js » geoPad) */
function formaPadV(p, layer){
  const th = p.layer === 'Multi' || (!p.layer && p.type === 'th');
  if (!th && p.layer !== layer) return null;
  let f = { shape: p.shape, w: p.w, h: p.h, radius: p.radius };
  if (th && layer === 'Bottom') {
    if (p.bot) f = { shape: p.bot.shape || p.shape, w: p.bot.w != null ? p.bot.w : p.w, h: p.bot.h != null ? p.bot.h : p.h, radius: p.bot.radius != null ? p.bot.radius : p.radius };
    else if ('bw' in p || 'bh' in p || 'bshape' in p) f = { shape: p.bshape || p.shape, w: p.bw != null ? p.bw : p.w, h: p.bh != null ? p.bh : p.h, radius: p.radius };
  }
  if (!(f.w > 0 && f.h > 0)) return null;
  const s = String(f.shape || 'rect').toLowerCase(), m = Math.min(f.w, f.h);
  let rr = 0;
  if ((s === 'circle' || s === 'round' || s === 'oval' || s === 'oblong' || s === 'obround')) rr = m / 2;
  else if (s === 'roundrect') rr = Math.min(typeof f.radius === 'number' ? f.radius : m / 8, m / 2);
  let cx = p.x, cy = p.y;
  if (p.hox || p.hoy) { const r = (p.rot || 0) * D2R; cx += (p.hox || 0) * Math.cos(r) - (p.hoy || 0) * Math.sin(r); cy += (p.hox || 0) * Math.sin(r) + (p.hoy || 0) * Math.cos(r); }
  return { cx, cy, W: f.w, H: f.h, rr, rot: p.rot || 0 };
}
/* os obstáculos de uma camada pela geometria crua: {id, net, sempre, sd(x,y), bb} */
function obstaculosV(eb, op, layer){
  const out = [];
  if (!RE_COBRE_V.test(layer)) return out;
  const add = (id, net, sempre, sd, bb) => out.push({ id: String(id), net: sempre ? '' : (net || ''), sempre, sd, bb });
  const ko = (o) => o.layer === 'KeepOut' || (o.layer === layer && o.keepout);
  for (const t of eb.tracks || []) if (t.layer === layer || t.layer === 'KeepOut')
    add(t.id, t.net, ko(t), (x, y) => dSegV(x, y, t.x1, t.y1, t.x2, t.y2) - t.w / 2, bbPts([[t.x1, t.y1], [t.x2, t.y2]], t.w / 2));
  for (const l of eb.lines || []) if (l.layer === 'KeepOut') {
    if (l.kind === 'arc') add(l.id, '', true, (x, y) => dArcoV(x, y, l) - (l.w || 0) / 2, [l.cx - l.r - l.w, l.cy - l.r - l.w, l.cx + l.r + l.w, l.cy + l.r + l.w]);
    else add(l.id, '', true, (x, y) => dSegV(x, y, l.x1, l.y1, l.x2, l.y2) - (l.w || 0) / 2, bbPts([[l.x1, l.y1], [l.x2, l.y2]], (l.w || 0) / 2));
  }
  for (const a of eb.arcs || []) if (a.layer === layer || a.layer === 'KeepOut')
    add(a.id, a.net, ko(a), (x, y) => dArcoV(x, y, a) - a.w / 2, [a.cx - a.r - a.w, a.cy - a.r - a.w, a.cx + a.r + a.w, a.cy + a.r + a.w]);
  for (const f of eb.fills || []) if (f.layer === layer || f.layer === 'KeepOut') {
    const W = Math.abs(f.x2 - f.x1), H = Math.abs(f.y2 - f.y1), cx = (f.x1 + f.x2) / 2, cy = (f.y1 + f.y2) / 2, m = Math.hypot(W, H) / 2;
    add(f.id, f.net, ko(f), (x, y) => dCaixaV(x, y, cx, cy, W, H, 0, f.rot), [cx - m, cy - m, cx + m, cy + m]);
  }
  for (const g of eb.regions || []) if (g.layer === layer || g.layer === 'KeepOut') {
    const E = [g.points], H = g.holes || [];
    add(g.id, g.net, ko(g), (x, y) => sdPoligonoV(E, H, x, y), bbPts(g.points));
  }
  for (const t of eb.texts || []) if (t.layer === layer && !t.hidden && op.textoGeo) {
    const geo = op.textoGeo(t);
    if (!geo) continue;
    const E = (geo.regioes || []).filter(r => !r.hole).map(r => r.pts), H = (geo.regioes || []).filter(r => r.hole).map(r => r.pts);
    const tr = geo.tracos || [], w2 = (geo.w || 0) / 2;
    const todos = [].concat(...E, ...tr);
    add(t.id, '', false, (x, y) => {
      let d = E.length ? sdPoligonoV(E, H, x, y) : Infinity;
      for (const s of tr) for (let i = 1; i < s.length; i++) d = Math.min(d, dSegV(x, y, s[i - 1][0], s[i - 1][1], s[i][0], s[i][1]) - w2);
      return d;
    }, bbPts(todos, w2));
  }
  const pads = [];
  for (const c of eb.components || []) for (const p of c.pads || []) pads.push(p);
  for (const p of eb.freepads || []) pads.push(p);
  for (const p of pads) {
    const f = formaPadV(p, layer);
    if (!f) continue;
    const m = Math.hypot(f.W, f.H) / 2;
    add(p.id, p.net, false, (x, y) => dCaixaV(x, y, f.cx, f.cy, f.W, f.H, f.rr, f.rot), [f.cx - m, f.cy - m, f.cx + m, f.cy + m]);
  }
  for (const v of eb.vias || []) add(v.id, v.net, false, (x, y) => Math.hypot(x - v.x, y - v.y) - v.size / 2, [v.x - v.size, v.y - v.size, v.x + v.size, v.y + v.size]);
  /* a borda: fora da placa (par/ímpar entre os laços) é negativo; cada recorte é um furo */
  const bd = eb.board || {};
  const lacos = (op.placa && op.placa.lacos) || (bd.bbox ? [[[bd.bbox.x1, bd.bbox.y1], [bd.bbox.x2, bd.bbox.y1], [bd.bbox.x2, bd.bbox.y2], [bd.bbox.x1, bd.bbox.y2]]] : []);
  if (lacos.length) add('borda', '', true, (x, y) => {
    const dentro = lacos.filter(l => voltas(l, x, y) !== 0).length % 2 === 1;
    const d = dBordaV(lacos, x, y);
    return dentro ? d : -d;
  }, [-Infinity, -Infinity, Infinity, Infinity]);
  ((op.placa && op.placa.recortes) || []).forEach((k, i) => add('recorte' + (i + 1), '', true, (x, y) => sdPoligonoV([k], [], x, y), bbPts(k)));
  return out;
}
/* A ROTA confere? `req` como foi pedido; `op` as opções da cena; `res` o que o motor devolveu */
let ROTAS_VERIFICADAS = 0, AMOSTRAS = 0;
function verifica(eb, op, req, res, nome){
  const pts = res.pts;
  assert.ok(Array.isArray(pts) && pts.length >= 1, nome + ': pts');
  assert.deepStrictEqual(pts[0], [req.de[0], req.de[1]], nome + ': pts[0] === de');
  if (res.completa) assert.deepStrictEqual(pts[pts.length - 1], [req.ate[0], req.ate[1]], nome + ': completa termina em ate');
  for (let i = 1; i < pts.length; i++)
    assert.ok(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) > 1e-9, nome + ': ponto repetido em ' + i);
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const cruz = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const segue = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) > 0;
    assert.ok(!(segue && Math.abs(cruz) <= 1e-12), nome + ': vértice colinear em ' + i);
  }
  /* os ângulos do modo (só quando o motor confere: 'ignorar' é o L puro, que já segue o modo) */
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i][0] - pts[i - 1][0]), dy = Math.abs(pts[i][1] - pts[i - 1][1]);
    if (req.modo === '90') assert.ok(dx <= 1e-6 || dy <= 1e-6, nome + ': perna fora de 90° ' + JSON.stringify([pts[i - 1], pts[i]]));
    if (req.modo === '45') assert.ok(dx <= 1e-6 || dy <= 1e-6 || Math.abs(dx - dy) <= 1e-6, nome + ': perna fora de 45° ' + JSON.stringify([pts[i - 1], pts[i]]));
  }
  if (req.conflito === 'ignorar') { ROTAS_VERIFICADAS++; return; }
  const clear = op.clearance != null ? op.clearance : ((eb.rules && eb.rules.clearance > 0) ? eb.rules.clearance : FOLGA);
  const T = req.w / 2 + clear, alvo = req.alvo || {};
  const N = req.net || (alvo.eletrico && alvo.net ? alvo.net : '');
  const ig = new Set(req.ignora ? [...req.ignora].map(String) : []);
  const obs = obstaculosV(eb, op, req.layer).filter(o => !ig.has(o.id) && (o.sempre || o.net === '' || o.net !== N));
  for (const o of obs) {
    o.lim = T;
    const d0 = o.sd(req.de[0], req.de[1]);
    if (!o.sempre && o.net === '' && d0 <= 1e-6) { o.isento = true; continue; }
    if (alvo.eletrico && !o.sempre && o.net === '' && o.sd(req.ate[0], req.ate[1]) <= 1e-6) { o.isento = true; continue; }
    if (d0 < T - 1e-6) o.lim = d0;
  }
  const vale = obs.filter(o => !o.isento);
  for (let i = 1; i < pts.length; i++) {
    const A = pts[i - 1], B = pts[i], len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const bb = bbPts([A, B], T + 0.01);
    const perto = vale.filter(o => !(o.bb[0] > bb[2] || o.bb[2] < bb[0] || o.bb[1] > bb[3] || o.bb[3] < bb[1]));
    const n = Math.max(1, Math.ceil(len / 0.01));
    for (let s = 0; s <= n; s++) {
      const x = A[0] + (B[0] - A[0]) * s / n, y = A[1] + (B[1] - A[1]) * s / n;
      AMOSTRAS++;
      for (const o of perto) {
        const d = o.sd(x, y);
        if (d < o.lim - 2e-6)
          assert.fail(`${nome}: a perna ${i} passa a ${(d - req.w / 2).toFixed(6)} mm (cobre a cobre) de ${o.id} (net "${o.net}") em (${x.toFixed(4)}, ${y.toFixed(4)}); o limite era ${(o.lim - req.w / 2).toFixed(6)}`);
      }
    }
  }
  ROTAS_VERIFICADAS++;
}

/* ============================== placas sintéticas ============================== */

const placa = (extra) => Object.assign({ board: { bbox: { x1: 0, y1: 0, x2: 20, y2: 20 } }, components: [], freepads: [], tracks: [],
                                         arcs: [], vias: [], texts: [], fills: [], regions: [], lines: [], cutouts: [] }, extra || {});
const pad = (id, net, x, y, w, h, extra) => Object.assign({ id, name: id, layer: 'Top', type: 'smd', shape: 'rect', x, y, w, h, rot: 0, net }, extra || {});
/* a rota com conferência: roda, verifica e devolve */
function rotaV(eb, op, c, req, nome){
  const q = Object.assign({ layer: 'Top', w: 0.25, net: '', alvo: { eletrico: false, net: '' }, modo: '45', primeiro: 'diag', conflito: 'contornar' }, req);
  const r = R.rota(c, q);
  verifica(eb, op, q, r, nome);
  return r;
}
/* a folga de cobre a cobre de um PONTO (trilha de largura 0) a cada obstáculo, com folga enorme */
function distsDoPonto(c, layer, x, y, net){
  const f = R.folgaTrilha(c, layer, { x1: x, y1: y, x2: x, y2: y, w: 0 }, { net: net || 'QUALQUER' });
  const m = {};
  for (const k of f.conflitos) m[k.id] = k.dist;
  return m;
}

/* ============================== 1. geometria exata ============================== */
{
  const eb = placa({
    board: { bbox: { x1: -50, y1: -50, x2: 50, y2: 50 } },
    tracks: [{ id: 't1', layer: 'Top', x1: 0, y1: 0, x2: 10, y2: 0, w: 0.4, net: 'B' }],
    components: [{ ref: 'U1', pads: [
      pad('p_rect', 'B', 20, 0, 2, 1),
      pad('p_rot90', 'B', 20, 10, 2, 1, { rot: 90 }),
      pad('p_rot30', 'B', 20, 20, 2, 1, { rot: 30 }),
      pad('p_oval', 'B', -20, 0, 2, 1, { shape: 'oval' }),
      pad('p_rr', 'B', -20, 10, 2, 1, { shape: 'roundrect', radius: 0.2 }),
      pad('p_rr_sem', 'B', -20, 20, 2, 1.6, { shape: 'roundrect' }),
      pad('p_circ', 'B', -20, -20, 1.5, 1.5, { shape: 'circle' }),
      pad('p_round_oval', 'B', 20, -20, 3, 1, { shape: 'round' }),
    ] }],
    arcs: [{ id: 'a1', layer: 'Top', cx: 0, cy: 30, r: 5, sa: 0, ea: 90, w: 0.2, net: 'B' }],
    vias: [{ id: 'v1', x: 0, y: -30, size: 0.6, drill: 0.3, net: 'B' }],
    regions: [{ id: 'g1', layer: 'Bottom', net: 'B', points: [[0, 0], [4, 0], [4, 4], [0, 4]], holes: [[[1, 1], [3, 1], [3, 3], [1, 3]]] }],
  });
  const c = R.cena(eb, { clearance: 100 });
  const d = (x, y, id, layer) => distsDoPonto(c, layer || 'Top', x, y)[id];
  /* cápsula: 1 acima do eixo, menos meia largura; além da ponta, pela tampa redonda */
  assert.ok(near(d(5, 1, 't1'), 0.8), 'trilha: em cima do meio');
  assert.ok(near(d(13, 4, 't1'), 4.8), 'trilha: depois da ponta (3,4,5)');
  assert.ok(near(d(5, 0.1, 't1'), -0.1), 'trilha: dentro do cobre é negativo');
  /* retângulo 2 x 1: 1 mm à direita da borda; girado 90 vira 1 x 2; girado 30 pela conta fechada */
  assert.ok(near(d(22, 0, 'p_rect'), 1), 'rect');
  assert.ok(near(d(22, 0.5 + 3, 'p_rect'), Math.hypot(1, 3)), 'rect pelo canto');
  assert.ok(near(d(22, 10, 'p_rot90'), 1.5), 'rect girado 90');
  assert.ok(near(d(22, 20, 'p_rot30'), Math.sqrt(4.25 - 2 * Math.sqrt(3))), 'rect girado 30: sqrt((√3-1)² + 1/4)');
  assert.ok(near(d(20, 20, 'p_rot30'), -0.5), 'rect girado 30: o centro fica a meia altura da borda');
  /* oval 2 x 1 = miolo de 1 mm com raio 0,5 */
  assert.ok(near(d(-18, 0, 'p_oval'), 1), 'oval pela ponta');
  assert.ok(near(d(-19.5, 1.5, 'p_oval'), 1), 'oval por cima do centro da tampa');
  assert.ok(near(d(-18.5, 1.5, 'p_oval'), Math.hypot(1, 1.5) - 0.5), 'oval na diagonal');
  /* roundrect 2 x 1 raio 0,2: miolo 1,6 x 0,6 */
  assert.ok(near(d(-18, 11, 'p_rr'), Math.hypot(1.2, 0.7) - 0.2), 'roundrect pelo canto');
  assert.ok(near(d(-18, 10, 'p_rr'), 1), 'roundrect pelo lado');
  /* roundrect sem radius: min/8 = 0,2 (2 x 1,6) */
  assert.ok(near(d(-18, 21.8, 'p_rr_sem'), Math.hypot(1.2, 1.2) - 0.2), 'roundrect sem radius: min(w,h)/8');
  assert.ok(near(d(-20, -18, 'p_circ'), 1.25), 'círculo');
  /* round com w != h é oval (hub-gerber » geoPad) */
  assert.ok(near(d(20, -18.5, 'p_round_oval'), 1), 'round 3 x 1 = oval: de cima');
  assert.ok(near(d(23, -20, 'p_round_oval'), 1.5), 'round 3 x 1 = oval: da ponta');
  /* arco de 0 a 90 graus, raio 5, w 0,2 */
  assert.ok(near(d(0, 30, 'a1'), 4.9), 'arco: do centro');
  assert.ok(near(d(6, 36, 'a1'), Math.hypot(6, 6) - 5 - 0.1), 'arco: na varredura');
  assert.ok(near(d(-3, 30, 'a1'), Math.hypot(3, 5) - 0.1), 'arco: fora da varredura, pela ponta de 90°');
  assert.ok(near(d(0, -30, 'v1'), -0.3) && near(d(1, -30, 'v1'), 0.7), 'via');
  /* polígono com furo (Bottom): no furo, a distância às bordas do furo; no cobre, negativa */
  assert.ok(near(d(2, 2, 'g1', 'Bottom'), 1), 'região: no furo');
  assert.ok(near(d(0.5, 2, 'g1', 'Bottom'), -0.5), 'região: no cobre (negativo)');
  assert.ok(near(d(5, 2, 'g1', 'Bottom'), 1), 'região: fora');
  assert.ok(near(d(7, 8, 'g1', 'Bottom'), 5), 'região: pelo canto (3,4,5)');
  assert.strictEqual(d(2, 2, 'g1'), undefined, 'região do Bottom não existe no Top');
  /* segmento contra segmento: cruzar é zero, menos as meias larguras */
  const f = R.folgaTrilha(c, 'Top', { x1: 5, y1: -3, x2: 5, y2: 3, w: 0.2 }, { net: 'A' });
  assert.ok(near(f.conflitos.find(k => k.id === 't1').dist, -0.3), 'cruzar: -(0,2 + 0,1)');
  /* segmento contra arco: a corda que passa perto da curva */
  const fa = R.folgaTrilha(c, 'Top', { x1: 0, y1: 30, x2: 10, y2: 40, w: 0 }, { net: 'A' });
  assert.ok(near(fa.conflitos.find(k => k.id === 'a1').dist, -0.1), 'segmento cruzando o arco');
  const fb = R.folgaTrilha(c, 'Top', { x1: -10, y1: 37, x2: 10, y2: 37, w: 0 }, { net: 'A' });
  assert.ok(near(fb.conflitos.find(k => k.id === 'a1').dist, 2 - 0.1), 'segmento acima do arco: pelo pé do centro (topo em y 35)');
  /* segmento contra caixa girada: exato pelo canto */
  const fc = R.folgaTrilha(c, 'Top', { x1: 23, y1: -5, x2: 23, y2: 5, w: 0 }, { net: 'A' });
  assert.ok(near(fc.conflitos.find(k => k.id === 'p_rect').dist, 2), 'segmento ao lado da caixa');
}

/* ============================== 2. quem bloqueia quem ============================== */
{
  const eb = placa({
    tracks: [{ id: 'tB', layer: 'Top', x1: 10, y1: 2, x2: 10, y2: 15, w: 0.3, net: 'B' },
             { id: 'tSem', layer: 'Top', x1: 2, y1: 18, x2: 18, y2: 18, w: 0.3, net: '' },
             { id: 'tKO', layer: 'Top', x1: 2, y1: 1, x2: 18, y2: 1, w: 0.3, net: 'A', keepout: true }],
    lines: [{ id: 'lKO', layer: 'KeepOut', kind: 'line', x1: 15, y1: 5, x2: 15, y2: 12, w: 0.1 }],
  });
  const c = R.cena(eb);
  const atravessa = (x1, y1, x2, y2, net, layer) => R.folgaTrilha(c, layer || 'Top', { x1, y1, x2, y2, w: 0.25 }, { net });
  assert.deepStrictEqual(atravessa(8, 8, 12, 8, 'A').conflitos.map(k => [k.id, k.tipo, k.net]), [['tB', 'trilha', 'B']], 'outra net bloqueia');
  assert.ok(atravessa(8, 8, 12, 8, 'B').ok, 'a mesma net não bloqueia');
  assert.ok(!atravessa(8, 8, 12, 8, '').ok, 'sem net na mão: todo cobre bloqueia');
  assert.ok(!atravessa(5, 17, 5, 19, 'A').ok && !atravessa(5, 17, 5, 19, 'B').ok && !atravessa(5, 17, 5, 19, '').ok, 'cobre sem net bloqueia qualquer net');
  const k1 = atravessa(5, 0.6, 5, 2, 'A');
  assert.deepStrictEqual(k1.conflitos.map(k => [k.id, k.tipo]), [['tKO', 'keepout']], 'keepout:true bloqueia até a mesma net');
  const k2 = atravessa(14, 8, 16, 8, 'B');
  assert.deepStrictEqual(k2.conflitos.map(k => [k.id, k.tipo]), [['lKO', 'keepout']], 'a camada KeepOut barra o Top');
  assert.ok(!atravessa(14, 8, 16, 8, 'B', 'Bottom').ok, '... e o Bottom');
  assert.ok(atravessa(8, 8, 12, 8, 'A', 'Bottom').ok, 'trilha do Top não existe no Bottom');
  assert.ok(R.folgaTrilha(c, 'Top', { x1: 8, y1: 8, x2: 12, y2: 8, w: 0.25 }, { net: 'A', ignora: ['tB'] }).ok, 'ignora');
  assert.ok(R.folgaTrilha(c, 'Top', { x1: 8, y1: 8, x2: 12, y2: 8, w: 0.25 }, { net: 'A', ignora: new Set(['tB']) }).ok, 'ignora como Set');
  /* a borda: fora da placa e encostado nela */
  const b1 = atravessa(19, 8, 21, 8, 'A');
  assert.deepStrictEqual(b1.conflitos.map(k => [k.id, k.tipo]), [['borda', 'borda']], 'a borda da placa');
  assert.ok(!atravessa(19.8, 8, 19.8, 9, 'A').ok, 'encostado na borda (0,2 do contorno)');
  assert.ok(atravessa(19.5, 5, 19.5, 9, 'A').ok, 'a 0,5 do contorno com w 0,25: folga 0,375 > 0,254');
  assert.strictEqual(R.netEm(c, 'Top', 10, 5), 'B', 'netEm no meio da trilha');
  assert.strictEqual(R.netEm(c, 'Top', 10.14, 5), 'B', 'netEm na beira da trilha');
  assert.strictEqual(R.netEm(c, 'Top', 10.16, 5), '', 'netEm fora');
  assert.strictEqual(R.netEm(c, 'Top', 5, 18), '', 'netEm: trilha sem net');
  assert.strictEqual(R.netEm(c, 'Top', 5, 1), '', 'netEm: keepout não é cobre de net');
  assert.strictEqual(R.netEm(c, 'Bottom', 10, 5), '', 'netEm: outra camada');
}

/* ============================== 3. folgas: encostar exatamente na folga é ok ============================== */
{
  const eb = placa({
    board: { bbox: { x1: -10, y1: -10, x2: 30, y2: 30 } },
    tracks: [{ id: 't0', layer: 'Top', x1: 0, y1: 0, x2: 10, y2: 0, w: 0.2, net: 'B' }],
    components: [{ ref: 'J1', pads: [pad('pj', 'B', 20, 0, 1, 1, { layer: 'Multi', type: 'th', shape: 'circle', drill: 0.5, bot: { w: 2, h: 2, shape: 'circle' } })] }],
  });
  const c = R.cena(eb);
  /* trilha w 0,2 paralela a t0: folga = y - 0,2 */
  const ft = y => R.folgaTrilha(c, 'Top', { x1: 2, y1: y, x2: 8, y2: y, w: 0.2 }, { net: 'A' });
  assert.ok(ft(0.454).ok, 'trilha: folga exatamente 0,254');
  assert.ok(!ft(0.4539).ok && near(ft(0.4539).conflitos[0].dist, 0.2539, 1e-9), 'trilha: 0,0001 a menos não passa');
  /* arco: o ponto mais baixo (270°) de um arco de raio 2 em (5, y0+2): folga = ...exata */
  const yArco = 0.1 + 0.254 + 0.1 + 2;
  const fa = cy => R.folgaArco(c, 'Top', { cx: 5, cy, r: 2, sa: 180, ea: 360, w: 0.2 }, { net: 'A' });
  assert.ok(fa(yArco).ok, 'arco: folga exatamente 0,254');
  assert.ok(!fa(yArco - 0.0001).ok, 'arco: 0,0001 a menos não passa');
  assert.ok(near(fa(yArco - 0.0001).conflitos[0].dist, 0.2539, 1e-9), 'arco: a folga que sobrou');
  /* arco que passa ao lado da ponta da trilha (varredura de 90 a 180: o ponto mais perto é a ponta do arco) */
  const fa2 = R.folgaArco(c, 'Top', { cx: 10, cy: 3, r: 2, sa: 90, ea: 180, w: 0.2 }, { net: 'A' });
  assert.ok(near(fa2.conflitos.length ? fa2.conflitos[0].dist : Math.hypot(2, 3) - 0.2, Math.hypot(2, 3) - 0.2) && fa2.ok, 'arco longe: ok');
  /* via de 0,6 ao lado do pad passante: no Top o pad tem 1 mm, no Bottom 2 mm (a pilha do bot) */
  const fv = x => R.folgaVia(c, { x, y: 0, size: 0.6 }, { net: 'A' });
  const xTop = 20 + 0.5 + 0.254 + 0.3, xBot = 20 + 1 + 0.254 + 0.3;
  assert.ok(fv(xBot).ok, 'via: folga exatamente 0,254 do pad no Bottom (o maior)');
  const v2 = fv(xBot - 0.0001);
  assert.deepStrictEqual(v2.conflitos.map(k => [k.id, k.layer, k.tipo]), [['pj', 'Bottom', 'pad']], 'via: só o Bottom encosta');
  const v3 = fv(xTop - 0.0001);
  assert.deepStrictEqual(v3.conflitos.map(k => k.layer).sort(), ['Bottom', 'Top'], 'via: mais perto, os dois lados');
  assert.ok(R.folgaVia(c, { x: xTop - 0.2, y: 0, size: 0.6 }, { net: 'B' }).ok, 'via da mesma net encosta à vontade');
  assert.ok(R.folgaVia(c, { x: 5, y: 0.2, size: 0.6 }, { net: 'A', ignora: ['t0'] }).ok, 'via: ignora');
}

/* ============================== 4. rota ============================== */
{
  const eb = placa({
    tracks: [{ id: 'tB', layer: 'Top', x1: 10, y1: 2, x2: 10, y2: 15, w: 0.3, net: 'B' },
             { id: 'tA', layer: 'Top', x1: 4, y1: 3, x2: 4, y2: 17, w: 0.3, net: 'A' }],
  });
  const op = {}, c = R.cena(eb, op);
  /* 4a. L livre: o L do HubFio, com o canto que a mão escolheu */
  for (const [modo, prims] of [['90', ['h', 'v']], ['45', ['diag', 'orto']], ['livre', ['v']]])
    for (const pr of prims) {
      const de = [6, 4], ate = [8.5, 12.3];
      const r = rotaV(eb, op, c, { net: 'A', de, ate, modo, primeiro: pr }, 'L livre ' + modo + ' ' + pr);
      const p = F.pernas(F.novo(de, modo, pr), ate);
      const L = p.perna2 ? [p.perna1[0], p.perna1[1], p.perna2[1]] : p.perna1;
      assert.deepStrictEqual(r.pts, L, 'o L do HubFio ' + modo + ' ' + pr);
      assert.ok(r.completa && r.motivo === 'livre' && r.bloqueio === null, 'livre');
    }
  /* 4b. trilha de outra net atravessada: contorna, nos três modos */
  for (const modo of ['45', '90', 'livre']) {
    const r = rotaV(eb, op, c, { net: 'A', de: [6, 8], ate: [14, 9], modo, primeiro: modo === '90' ? 'h' : 'diag' }, 'contorna ' + modo);
    assert.ok(r.completa && r.motivo === 'contorno', 'contorna ' + modo + ': ' + r.motivo);
    assert.deepStrictEqual(r.bloqueio && [r.bloqueio.id, r.bloqueio.tipo, r.bloqueio.net], ['tB', 'trilha', 'B'], 'o bloqueio é a trilha da net B');
    assert.ok(r.pts.some(p => p[1] > 15), 'passou por cima da ponta da trilha');
    /* o mesmo trecho de novo (o mouse andou no mesmo contexto): o mesmo caminho */
    const r2 = R.rota(c, { layer: 'Top', w: 0.25, net: 'A', de: [6, 8], ate: [14, 9], alvo: { eletrico: false, net: '' }, modo, primeiro: modo === '90' ? 'h' : 'diag', conflito: 'contornar' });
    assert.deepStrictEqual(r2.pts, r.pts, 'com o cache quente, o mesmo caminho');
  }
  /* 4c. a mesma net no caminho: o L direto, cruzando a trilha */
  {
    const r = rotaV(eb, op, c, { net: 'B', de: [6, 8], ate: [14, 9], modo: '90', primeiro: 'h' }, 'mesma net');
    assert.deepStrictEqual(r.pts, [[6, 8], [14, 8], [14, 9]]);
    assert.strictEqual(r.motivo, 'livre');
    /* sem net na mão e o alvo elétrico da net B: a trilha adota a net do alvo */
    const r2 = rotaV(eb, op, c, { net: '', de: [6, 8], ate: [14, 9], modo: '90', primeiro: 'h', alvo: { eletrico: true, net: 'B' } }, 'adota a net do alvo');
    assert.strictEqual(r2.motivo, 'livre');
  }
  /* 4d. 'parar': o maior pedaço inicial livre do L, no passo da grade */
  {
    const req = { net: 'A', de: [6, 8], ate: [14, 9], modo: '90', primeiro: 'h', conflito: 'parar' };
    const r = rotaV(eb, op, c, req, 'parar');
    assert.ok(!r.completa && r.motivo === 'bloqueado' && r.bloqueio.id === 'tB');
    assert.deepStrictEqual(r.pts, [[6, 8], [9.4, 8]], 'para em 9,4 (o limite exato é 10 - 0,15 - 0,254 - 0,125 = 9,471)');
    assert.ok(near(r.bloqueio.x, 9.471, 1e-6) && r.bloqueio.y === 8, 'o ponto exato onde o L passa a encostar');
    assert.ok(!R.folgaTrilha(c, 'Top', { x1: 6, y1: 8, x2: 9.5, y2: 8, w: 0.25 }, { net: 'A' }).ok, 'um passo a mais já encosta');
  }
  /* 4e. 'ignorar': o L, mesmo atravessando */
  {
    const r = rotaV(eb, op, c, { net: 'A', de: [6, 8], ate: [14, 9], modo: '90', primeiro: 'h', conflito: 'ignorar' }, 'ignorar');
    assert.deepStrictEqual(r.pts, [[6, 8], [14, 8], [14, 9]]);
    assert.ok(r.completa && r.motivo === 'ignorado' && r.bloqueio === null);
  }
  /* 4f. o cursor em cima da trilha de outra net: para do lado de onde veio, no ponto livre mais perto */
  {
    const r = rotaV(eb, op, c, { net: 'A', de: [6, 8], ate: [10, 9], modo: '90', primeiro: 'h' }, 'cursor em cima de outra net');
    assert.ok(!r.completa && r.motivo === 'sem-caminho');
    assert.deepStrictEqual(r.pts[r.pts.length - 1], [9.4, 9], 'o ponto livre da grade mais perto do cursor, do lado de cá');
  }
  /* 4g. partida no meio da trilha da mesma net (o Altium começa de qualquer ponto da trilha) */
  {
    assert.strictEqual(R.netEm(c, 'Top', 4, 10), 'A');
    const r = rotaV(eb, op, c, { net: R.netEm(c, 'Top', 4, 10), de: [4, 10], ate: [8, 12], modo: '45', primeiro: 'diag' }, 'partida na trilha A');
    assert.ok(r.completa && r.motivo === 'livre');
  }
  /* 4h. sem DEGRAU: a grade do A* nasce na partida, e o cursor fora dela fazia a rota encaixar no
     fim com um trecho de 0,03 mm — ou passar do ponto e voltar por cima de si mesma
     ([6,1.4] -> [14,1.4] -> [13.97,1.4]). Nenhuma perna menor que 0,05 mm, nenhuma volta. */
  {
    const eb2 = placa({ tracks: [{ id: 'tB', layer: 'Top', x1: 10, y1: 2, x2: 10, y2: 15, w: 0.3, net: 'B' }] });
    const c2 = R.cena(eb2);
    let n = 0;
    for (const de of [[6, 8], [6.03, 8.07], [5.95, 7.33]]) for (const ate of [[14, 9], [14.127, 9.017], [13.97, 8.443], [14.05, 12.31]]) for (const modo of ['45', '90']) {
      c2._ctx = null;
      const r = rotaV(eb2, {}, c2, { net: 'A', de, ate, modo, primeiro: modo === '90' ? 'h' : 'diag' }, 'sem degrau ' + JSON.stringify([de, ate, modo]));
      assert.ok(r.completa && r.motivo === 'contorno', 'contorna: ' + r.motivo);
      const P = r.pts;
      for (let i = 1; i < P.length; i++) {
        assert.ok(Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]) >= 0.05, 'degrau de ' + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]).toFixed(4) + ' mm em ' + JSON.stringify(P));
        if (i + 1 < P.length) {
          const ux = P[i][0] - P[i - 1][0], uy = P[i][1] - P[i - 1][1], vx = P[i + 1][0] - P[i][0], vy = P[i + 1][1] - P[i][1];
          assert.ok(!(Math.abs(ux * vy - uy * vx) <= 1e-9 && ux * vx + uy * vy < 0), 'a rota volta por cima de si mesma em ' + JSON.stringify(P[i]));
        }
      }
      n++;
    }
    assert.strictEqual(n, 24);
  }
}

/* ============================== 5. cercado, alvo elétrico, partida em conflito ============================== */
{
  /* um quadrado fechado de trilhas da net B em volta de (15,15); um pad B e um pad sem net */
  const q = [[13, 13], [17, 13], [17, 17], [13, 17]];
  const eb = placa({
    tracks: q.map((p, i) => ({ id: 'q' + i, layer: 'Top', x1: p[0], y1: p[1], x2: q[(i + 1) % 4][0], y2: q[(i + 1) % 4][1], w: 0.3, net: 'B' }))
      .concat([{ id: 'tPerto', layer: 'Top', x1: 2, y1: 10, x2: 8, y2: 10, w: 0.3, net: 'C' },
               { id: 'tSem', layer: 'Top', x1: 2, y1: 5, x2: 8, y2: 5, w: 0.3, net: '' }]),
    components: [{ ref: 'U1', pads: [pad('pB', 'B', 5, 15, 1, 1), pad('p0', '', 9, 15, 1, 1)] }],
  });
  const op = {}, c = R.cena(eb, op);
  /* 5a. cercado: não completa e para antes (do lado de fora do quadrado) */
  for (const modo of ['45', '90']) {
    const r = rotaV(eb, op, c, { net: 'A', de: [5, 7.5], ate: [15, 15], modo, primeiro: modo === '90' ? 'h' : 'diag' }, 'cercado ' + modo);
    assert.ok(!r.completa && (r.motivo === 'sem-caminho' || r.motivo === 'orcamento'), 'cercado: ' + r.motivo);
    const u = r.pts[r.pts.length - 1];
    assert.ok(!(u[0] > 13 && u[0] < 17 && u[1] > 13 && u[1] < 17), 'parou do lado de fora do quadrado');
    assert.ok(Math.hypot(u[0] - 15, u[1] - 15) < 3, 'parou encostado no quadrado (perto do cursor)');
  }
  /* 5b. pad de outra net como alvo elétrico: não completa */
  {
    const r = rotaV(eb, op, c, { net: 'A', de: [2, 13], ate: [5, 15], modo: '45', alvo: { eletrico: true, net: 'B' } }, 'alvo de outra net');
    assert.ok(!r.completa, 'pad de outra net no alvo: ' + r.motivo);
    const u = r.pts[r.pts.length - 1];
    assert.ok(Math.hypot(u[0] - 5, u[1] - 15) > 0.5 + 0.254, 'parou antes do pad');
  }
  /* 5c. pad sem net como alvo elétrico: completa (ligar num pad sem net não junta nets) */
  {
    const r = rotaV(eb, op, c, { net: 'A', de: [7, 12], ate: [9, 15], modo: '45', alvo: { eletrico: true, net: '' } }, 'alvo sem net');
    assert.ok(r.completa, 'pad sem net no alvo elétrico: ' + r.motivo);
    const r2 = rotaV(eb, op, c, { net: 'A', de: [7, 12], ate: [9, 15], modo: '45', alvo: { eletrico: false, net: '' } }, 'pad sem net, sem snap elétrico');
    assert.ok(!r2.completa, 'sem o snap elétrico, o pad sem net é obstáculo');
  }
  /* 5d. partida em conflito: começou a 0,3 do eixo de uma trilha da net C (precisava 0,529).
     Sai sem chegar mais perto — e o verificador confere amostra a amostra */
  for (const ate of [[5, 13], [5, 10.8], [9.5, 10.3]]) {
    const r = rotaV(eb, op, c, { net: 'A', de: [5, 10.3], ate, modo: '45' }, 'partida em conflito -> ' + ate);
    assert.ok(r.pts.length >= 2, 'saiu do lugar');
  }
  /* indo para DENTRO da trilha: não anda nada para perto */
  {
    const r = rotaV(eb, op, c, { net: 'A', de: [5, 10.3], ate: [5, 10], modo: '45' }, 'partida em conflito, mirando a trilha');
    assert.ok(!r.completa);
  }
  /* 5e. partida dentro de uma trilha sem net (a trilha começou nela): ela não bloqueia */
  {
    const r = rotaV(eb, op, c, { net: '', de: [5, 5], ate: [5, 8], modo: '90', primeiro: 'v' }, 'partida na trilha sem net');
    assert.ok(r.completa && r.motivo === 'livre');
  }
  /* 5f. a própria trilha em curso (sem net) não é obstáculo dela: o trecho que termina em `de`
     já sai pela isenção da partida (ele contém `de`); os anteriores precisam do `ignora` */
  {
    const eb2 = placa({ tracks: [{ id: 'novo1', layer: 'Top', x1: 3, y1: 3, x2: 10, y2: 3, w: 0.25, net: '' },
                                 { id: 'novo2', layer: 'Top', x1: 10, y1: 3, x2: 10, y2: 8, w: 0.25, net: '' }] });
    const c2 = R.cena(eb2);
    const sem = rotaV(eb2, {}, c2, { net: '', de: [10, 8], ate: [5, 3.2], modo: 'livre' }, 'volta por cima de si mesma, sem ignora');
    assert.ok(!sem.completa, 'sem o ignora, o trecho anterior da própria trilha sem net bloqueia');
    const so2 = rotaV(eb2, {}, c2, { net: '', de: [10, 8], ate: [10, 4], modo: 'livre' }, 'por cima do trecho que contém de');
    assert.ok(so2.completa && so2.motivo === 'livre', 'o trecho que contém `de` não bloqueia');
    const com = rotaV(eb2, {}, c2, { net: '', de: [10, 8], ate: [5, 3.2], modo: 'livre', ignora: ['novo1', 'novo2'] }, 'com ignora');
    assert.ok(com.completa && com.motivo === 'livre');
  }
}

/* ============================== 5½. o verificador pega o que tem de pegar ============================== */
{
  /* sem isto, um verificador que aprova tudo passaria despercebido: o L que o 'ignorar' devolve
     atravessa a trilha da net B, e conferido como se fosse 'contornar' tem de cair */
  const eb = placa({ tracks: [{ id: 'tB', layer: 'Top', x1: 10, y1: 2, x2: 10, y2: 15, w: 0.3, net: 'B' }] });
  const c = R.cena(eb);
  const q = { layer: 'Top', w: 0.25, net: 'A', de: [6, 8], ate: [14, 9], alvo: { eletrico: false, net: '' }, modo: '90', primeiro: 'h', conflito: 'ignorar' };
  const r = R.rota(c, q);
  assert.throws(() => verifica(eb, {}, Object.assign({}, q, { conflito: 'contornar' }), r, 'L atravessando'), /tB/, 'o verificador acusa o L que atravessa');
  /* e o que encosta por 0,001 mm (folga de 0,253) também */
  const encosta = { pts: [[6, 8], [9.472, 8]], completa: false, motivo: 'bloqueado' };
  assert.throws(() => verifica(eb, {}, Object.assign({}, q, { conflito: 'parar' }), encosta, 'encostando'), /tB/, 'o verificador acusa 0,001 mm a menos');
  verifica(eb, {}, Object.assign({}, q, { conflito: 'parar' }), { pts: [[6, 8], [9.471, 8]], completa: false }, 'no limite exato');
  ROTAS_VERIFICADAS -= 1;
  /* ângulo errado também cai */
  assert.throws(() => verifica(eb, {}, Object.assign({}, q, { modo: '45', conflito: 'contornar' }), { pts: [[6, 8], [7, 8.5]], completa: false }, 'fora de 45'), /45/);
}

/* ============================== 5¾. partida DENTRO de uma região de outra net ============================== */
{
  /* a mão começou em cima de cobre de outra net (um 'ignorar' de antes deixou a ponta lá): a
     regra de não piorar vale pela distância COM SINAL — dentro, só pode ir para mais raso */
  const eb = placa({ regions: [{ id: 'gC', layer: 'Top', net: 'C', points: [[8, 8], [12, 8], [12, 12], [8, 12]] }],
                     tracks: [{ id: 'tD', layer: 'Top', x1: 2, y1: 15, x2: 18, y2: 15, w: 0.3, net: 'D' }] });
  const op = {}, c = R.cena(eb, op);
  for (const [ate, modo] of [[[10, 4], '90'], [[3, 10], '45'], [[16, 16.5], 'livre'], [[14, 14], '45'], [[10, 10.5], '90']]) {
    const r = rotaV(eb, op, c, { net: 'A', de: [9, 10], ate, modo, primeiro: modo === '90' ? 'v' : 'diag' }, 'partida dentro da região C -> ' + ate);
    if (ate[1] === 10.5) assert.ok(!r.completa, 'mais fundo na região não vai');
    else assert.ok(r.completa, 'sai da região (ficando mais raso a cada passo): ' + r.motivo);
  }
  /* a meio micro do lado de FORA da região (o limiar relaxado fica entre 0 e a tolerância): a
     aresta, a 0 do cruzamento, não acusaria nada — e o L atravessaria a região inteira */
  const r = rotaV(eb, op, c, { net: 'A', de: [8 - 5e-7, 10], ate: [13, 10], modo: 'livre' }, 'partida encostada por fora da região');
  assert.ok(r.motivo !== 'livre' && r.pts.every(p => !(p[0] > 8 && p[0] < 12 && p[1] > 8 && p[1] < 12)), 'não atravessa a região: ' + r.motivo);
}

/* um polígono despejado (400 arestas, com furo) e a partida dentro dele; e a partida fora da placa */
{
  const pts = [], furo = [];
  for (let i = 0; i < 400; i++) { const a = 2 * Math.PI * i / 400, r = 6 + 0.8 * Math.sin(7 * a) + 0.15 * Math.sin(53 * a); pts.push([20 + r * Math.cos(a), 20 + r * Math.sin(a)]); }
  for (let i = 0; i < 60; i++) { const a = -2 * Math.PI * i / 60; furo.push([22 + 1.2 * Math.cos(a), 20 + 1.2 * Math.sin(a)]); }
  const eb = placa({ board: { bbox: { x1: 0, y1: 0, x2: 40, y2: 40 } }, regions: [{ id: 'gP', layer: 'Top', net: 'GND', points: pts, holes: [furo] }],
                     tracks: [{ id: 'tX', layer: 'Top', x1: 3, y1: 32, x2: 37, y2: 32, w: 0.3, net: 'X' }] });
  const op = {}, c = R.cena(eb, op);
  /* [de, ate, modo, completa (null = o verificador decide sozinho)]. (20,24) está a 1,35 da borda
     de fora; (20,23) a 2,35: mais fundo, não vai. (20,20) -> (20,5;20) vai para o furo: mais raso. */
  const casos = [[[18, 21], [18, 35], '90', null], [[20, 20], [20.5, 20], '45', true], [[16, 21], [30, 34], 'livre', null],
                 [[24.2, 20], [30, 25], '45', true], [[20, 24], [20, 23], '90', false]];
  for (const [de, ate, modo, completa] of casos) {
    c._ctx = null;
    const r = rotaV(eb, op, c, { net: 'A', de, ate, modo, primeiro: modo === '90' ? 'v' : 'diag' }, 'partida no despejado ' + JSON.stringify([de, ate, modo]));
    if (completa !== null) assert.strictEqual(r.completa, completa, 'partida no despejado ' + JSON.stringify([de, ate]) + ': ' + r.motivo);
    assert.ok(r.ms < 120, 'partida no despejado: ' + r.ms.toFixed(1) + ' ms');
  }
  /* fora da placa: para dentro vai; para mais longe, não */
  const f1 = rotaV(eb, op, c, { net: 'A', de: [-0.5, 10], ate: [5, 10], modo: '45' }, 'partida fora da placa, para dentro');
  assert.ok(f1.completa);
  const f2 = rotaV(eb, op, c, { net: 'A', de: [-0.5, 10], ate: [-1.5, 10], modo: '45' }, 'partida fora da placa, para fora');
  assert.ok(!f2.completa && f2.pts.length === 1);
}

/* ============================== 5⅞. fuzz determinístico: placas aleatórias, toda rota conferida ============================== */
{
  let semente = 20261002;
  const rnd = () => { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente / 0x7fffffff; };
  const U = (a, b) => a + (b - a) * rnd();
  const FORMAS = ['rect', 'roundrect', 'oval', 'circle', 'round', 'octagon'];
  const MOT = {};
  for (let it = 0; it < 6; it++) {
    const net = () => ['A', 'B', 'C', ''][Math.floor(rnd() * 4)];
    const eb = placa({
      tracks: Array.from({ length: 6 }, (_, i) => { const x = U(2, 18), y = U(2, 18), a = U(0, 6.3), L = U(1, 8);
        return { id: 't' + i, layer: 'Top', x1: x, y1: y, x2: x + L * Math.cos(a), y2: y + L * Math.sin(a), w: U(0.1, 0.6), net: net() }; }),
      arcs: Array.from({ length: 3 }, (_, i) => { const sa = U(-180, 360), sw = rnd() < 0.15 ? 360 : U(5, 350);
        return { id: 'a' + i, layer: 'Top', cx: U(3, 17), cy: U(3, 17), r: U(0.5, 4), sa, ea: sa + sw, w: U(0.1, 0.5), net: net() }; }),
      components: [{ ref: 'U1', pads: Array.from({ length: 6 }, (_, i) => { const s = FORMAS[Math.floor(rnd() * FORMAS.length)], w = U(0.4, 2.5);
        return pad('p' + i, net(), U(2, 18), U(2, 18), w, s === 'circle' && rnd() < 0.6 ? w : U(0.4, 2.5),
                   { shape: s, layer: rnd() < 0.3 ? 'Multi' : 'Top', rot: rnd() < 0.5 ? 90 * Math.floor(rnd() * 4) : U(0, 360), radius: rnd() < 0.5 ? U(0, 0.5) : undefined }); }) }],
      vias: Array.from({ length: 3 }, (_, i) => ({ id: 'v' + i, x: U(2, 18), y: U(2, 18), size: U(0.4, 1), drill: 0.2, net: net() })),
      regions: Array.from({ length: 2 }, (_, i) => { const cx = U(4, 16), cy = U(4, 16), n = 3 + Math.floor(rnd() * 6), pts = [];
        for (let k = 0; k < n; k++) { const a = 2 * Math.PI * k / n + U(-0.3, 0.3), r = U(0.8, 3); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
        return { id: 'g' + i, layer: 'Top', net: net(), points: pts, holes: rnd() < 0.5 ? [[[cx - 0.3, cy - 0.3], [cx + 0.3, cy - 0.3], [cx + 0.3, cy + 0.3], [cx - 0.3, cy + 0.3]]] : [] }; }),
      fills: Array.from({ length: 2 }, (_, i) => { const x = U(2, 16), y = U(2, 16); return { id: 'f' + i, layer: 'Top', x1: x, y1: y, x2: x + U(0.3, 3), y2: y + U(0.3, 3), rot: rnd() < 0.5 ? 0 : U(0, 360), net: net() }; }),
    });
    const op = {}, c = R.cena(eb, op);
    for (let q = 0; q < 12; q++) {
      const modo = ['45', '90', 'livre'][q % 3];
      const r = rotaV(eb, op, c, { net: ['A', 'B', 'C', ''][Math.floor(rnd() * 4)], w: U(0.1, 0.4), de: [U(1, 19), U(1, 19)], ate: [U(1, 19), U(1, 19)], modo,
                                   primeiro: modo === '90' ? (rnd() < 0.5 ? 'h' : 'v') : (rnd() < 0.5 ? 'diag' : 'orto'), conflito: rnd() < 0.15 ? 'parar' : 'contornar' },
                      `fuzz ${it}.${q}`);
      MOT[r.motivo] = (MOT[r.motivo] || 0) + 1;
    }
  }
  assert.ok(MOT.contorno >= 10 && MOT['sem-caminho'] >= 3 && MOT.livre >= 3, 'o fuzz passa por contorno, sem-caminho e livre: ' + JSON.stringify(MOT));
}

/* ============================== 6. arco, região, texto, keepout, recorte e borda na rota ============================== */
{
  const textoGeo = t => t.id === 'xR'
    ? { regioes: [{ pts: [[12, 4], [14, 4], [14, 6], [12, 6]], hole: false }, { pts: [[12.5, 4.5], [13.5, 4.5], [13.5, 5.5], [12.5, 5.5]], hole: true }] }
    : { tracos: [[[12, 13], [14, 13], [14, 15]]], w: 0.2 };
  const eb = placa({
    arcs: [{ id: 'a1', layer: 'Top', cx: 10, cy: 10, r: 3, sa: 30, ea: 330, w: 0.3, net: 'B' }],
    regions: [{ id: 'g1', layer: 'Top', net: 'C', points: [[3, 3], [7, 3], [7, 7], [3, 7]], holes: [[[4, 4], [6, 4], [6, 6], [4, 6]]] }],
    texts: [{ id: 'xR', layer: 'Top', text: 'R', x: 13, y: 5, h: 2 }, { id: 'xT', layer: 'Top', text: 'T', x: 13, y: 14, h: 2 }],
    fills: [{ id: 'f1', layer: 'KeepOut', x1: 16, y1: 2, x2: 18, y2: 8, rot: 0 }],
  });
  const op = { textoGeo, placa: { lacos: [[[0, 0], [20, 0], [20, 20], [0, 20]]], recortes: [[[16, 14], [18, 14], [18, 17], [16, 17]]] } };
  const c = R.cena(eb, op);
  const casos = [
    ['arco: de dentro da boca para fora', [10, 10], [10, 16]],
    ['arco: atravessando', [5, 10], [15, 10]],
    ['região com furo: do furo para fora', [5, 5], [5, 9]],
    ['texto de contorno', [11, 5], [15, 5]],
    ['texto de traço', [13, 12], [13, 16]],
    ['keepout fill', [15, 5], [19, 5]],
    ['recorte', [15, 15.5], [19, 15.5]],
    ['borda', [1, 1], [1, 19]],
  ];
  for (const [nome, de, ate] of casos) for (const modo of ['45', '90', 'livre']) {
    const r = rotaV(eb, op, c, { net: 'A', de, ate, modo, primeiro: modo === '90' ? 'v' : 'diag' }, nome + ' ' + modo);
    assert.ok(r.pts.length >= 1);
  }
  /* o furo do texto e o da região são livres por dentro: a partida no furo da região não sai */
  const r = rotaV(eb, op, c, { net: 'A', de: [5, 5], ate: [5, 9], modo: '90', primeiro: 'v' }, 'furo cercado');
  assert.ok(!r.completa, 'o furo da região C está cercado de cobre C');
  assert.ok(rotaV(eb, op, c, { net: 'C', de: [5, 5], ate: [5, 9], modo: '90', primeiro: 'v' }, 'mesma net sai do furo').completa);
  /* a borda: dentro da placa, a folga do contorno */
  assert.ok(!R.folgaTrilha(c, 'Top', { x1: 0.3, y1: 10, x2: 0.3, y2: 11, w: 0.25 }, { net: 'A' }).ok, 'perto da borda');
  assert.ok(R.folgaTrilha(c, 'Top', { x1: 0.38, y1: 10, x2: 0.38, y2: 11, w: 0.25 }, { net: 'A' }).ok, 'a 0,379 da borda: ok');
  const kr = R.folgaTrilha(c, 'Top', { x1: 17, y1: 13, x2: 17, y2: 18, w: 0.25 }, { net: 'A' });
  assert.deepStrictEqual(kr.conflitos.map(k => [k.id, k.tipo]), [['recorte1', 'borda']], 'o recorte é borda');
}

/* ============================== 7. o contorno exato do texto em unidades do Gerber ============================== */
{
  /* o HubGerber.geometriaTexto devolve o contorno exato (regioes) em 0,00001 mm, e os traços em
     mm: o motor põe na escala que cai em cima do texto */
  const G = require('../hub-gerber.js');
  const t = { id: 'x1', layer: 'Top', text: 'O', x: 10, y: 10, h: 2, w: 0.2, rot: 0,
              polys: [{ pts: [[9, 9], [11, 9], [11, 11], [9, 11]], hole: false }, { pts: [[9.5, 9.5], [10.5, 9.5], [10.5, 10.5], [9.5, 10.5]], hole: true }] };
  const eb = placa({ texts: [t] });
  const c = R.cena(eb, { textoGeo: x => G.geometriaTexto(x) });
  assert.ok(!R.folgaTrilha(c, 'Top', { x1: 8, y1: 10.8, x2: 12, y2: 10.8, w: 0.2 }, { net: 'A' }).ok, 'o texto (contorno exato) é obstáculo no lugar dele');
  assert.ok(R.folgaTrilha(c, 'Top', { x1: 8, y1: 12, x2: 12, y2: 12, w: 0.2 }, { net: 'A' }).ok, 'e só no lugar dele');
}

/* ============================== 8. a placa real (DMB) ============================== */
const DMB = path.join(__dirname, '..', 'Projects', 'DMB - DI231765_P2', 'board.js');
if (fs.existsSync(DMB)) {
  const { loadVar } = require('./load');
  const Core = require('../hub-core.js'), Laser = require('../hub-laser.js'), G = require('../hub-gerber.js');
  const B = loadVar('Projects/DMB - DI231765_P2/board.js', 'pcbmirror');
  const EB = Core.effectiveBoard(B, Core.applyPcbChanges(B, []));
  /* a placa como o pcbframe monta: os laços do contorno (pathPlaca) e os furos (recortesDaTela) */
  const segs = [];
  for (const s of (EB.board && EB.board.outline) || []) {
    if (s.kind === 'arc') segs.push(Laser.arcPts(s.cx, s.cy, s.r, s.sa, s.ea));
    else segs.push([[s.x1, s.y1], [s.x2, s.y2]]);
  }
  const lacos = Laser.chainSegments(segs).filter(l => l.length >= 3);
  const recortes = [];
  for (const k of EB.cutouts || []) {
    if (!k || !Array.isArray(k.points) || k.points.length < 3) continue;
    if (typeof k.kindn === 'number' && (k.kindn === -1 || k.kindn === 1)) continue;
    const f = Laser.boardCutouts({ board: { bbox: EB.board.bbox, outline: EB.board.outline || [] }, cutouts: [k] });
    if (f.length) recortes.push(f[0]);
  }
  const op = { placa: { lacos, recortes }, textoGeo: t => G.geometriaTexto(t) };
  const ms = () => (typeof performance === 'object' ? performance.now() : Date.now());
  const mediana = v => { const s = v.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
  const log = [];

  /* cena + a primeira consulta de uma camada (monta o índice dela) */
  let t0 = ms();
  const c = R.cena(EB, op);
  R.netEm(c, 'Top', 50, 50);
  const tCena = ms() - t0;
  log.push(`cena + 1a consulta do Top: ${tCena.toFixed(2)} ms (limite 60); res ${c.res} mm, folga ${c.clearance} mm`);
  assert.ok(tCena < 60, 'cena + 1a consulta: ' + tCena.toFixed(1) + ' ms');

  /* os pares: no meio de uma trilha comprida, d mm para cada lado; as duas pontas livres; o
     segmento entre elas só encosta naquela trilha */
  const W = 0.254;
  const pares = (mesmaNet) => {
    const out = [];
    for (const t of EB.tracks) {
      const len = Math.hypot(t.x2 - t.x1, t.y2 - t.y1);
      if (len < 3) continue;
      const mx = (t.x1 + t.x2) / 2, my = (t.y1 + t.y2) / 2, nx = -(t.y2 - t.y1) / len, ny = (t.x2 - t.x1) / len;
      const net = mesmaNet ? t.net : 'NOVA';
      for (const d of [1, 1.5, 2, 3]) {
        const de = [+(mx + nx * d).toFixed(4), +(my + ny * d).toFixed(4)], ate = [+(mx - nx * d).toFixed(4), +(my - ny * d).toFixed(4)];
        const ponto = p => R.folgaTrilha(c, t.layer, { x1: p[0], y1: p[1], x2: p[0], y2: p[1], w: W }, { net }).ok;
        if (!ponto(de) || !ponto(ate)) continue;
        const reta = R.folgaTrilha(c, t.layer, { x1: de[0], y1: de[1], x2: ate[0], y2: ate[1], w: W }, { net });
        if (mesmaNet ? !reta.ok : (reta.conflitos.length !== 1 || reta.conflitos[0].id !== t.id)) continue;
        out.push({ t, de, ate, net });
        break;
      }
    }
    return out;
  };
  const outra = pares(false);
  assert.ok(outra.length >= 3, 'acha no DMB pares que atravessam trilha de outra net: ' + outra.length);
  const req = (k, modo, extra) => Object.assign({ layer: k.t.layer, w: W, net: k.net, de: k.de, ate: k.ate, alvo: { eletrico: false, net: '' },
                                                 modo, primeiro: modo === '90' ? 'h' : 'diag', conflito: 'contornar' }, extra || {});
  /* toda rota do DMB também passa pelo verificador */
  let verificadas = 0;
  const rotaD = (q, nome) => { const r = R.rota(c, q); verifica(EB, op, q, r, nome); verificadas++; return r; };
  /* aquece o JIT num par que não entra na medida */
  for (const k of outra.slice(-3)) for (const modo of ['45', '90', 'livre']) rotaD(req(k, modo), `DMB aquece ${k.t.id} ${modo}`);

  /* os contornos: os primeiros pares que contornam no 45, nos três modos, frio e quente */
  const frios = [], quentes = [], contornos = [];
  let paresVistos = 0;
  for (const k of outra) {
    paresVistos++;
    for (const modo of ['45', '90', 'livre']) {
      c._ctx = null;                                   /* frio: contexto novo */
      const q = req(k, modo);
      const r1 = rotaD(q, `DMB ${k.t.id} ${modo}`);
      if (r1.motivo === 'contorno') {
        const r2 = rotaD(q, `DMB ${k.t.id} ${modo} quente`);
        assert.deepStrictEqual(r2.pts, r1.pts, 'quente = frio');
        frios.push(r1.ms); quentes.push(r2.ms);
        if (modo === '45') contornos.push({ k, r: r1 });
      }
    }
    if (contornos.length >= 6 && paresVistos >= 20) break;
  }
  assert.ok(contornos.length >= 3, 'contorna trilha de outra net no DMB: ' + contornos.length + ' pares');
  /* sem degrau no meio da rota (o fim pode precisar de um: o cursor encostado no limite) */
  {
    let degraus = 0, rotas = 0;
    for (const k of outra.slice(0, 40)) for (const modo of ['45', '90']) {
      const r = rotaD(req(k, modo), `DMB degrau ${k.t.id} ${modo}`);
      if (r.motivo !== 'contorno') continue;
      rotas++;
      for (let i = 2; i + 1 < r.pts.length; i++) if (Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]) < 0.05) degraus++;
    }
    log.push(`degrau (< 0,05 mm) no meio de ${rotas} contornos: ${degraus}`);
    assert.strictEqual(degraus, 0, 'degrau no meio da rota no DMB');
  }
  for (const { k, r } of contornos) {
    assert.ok(r.completa && r.bloqueio && r.bloqueio.id === k.t.id, 'o bloqueio é a trilha atravessada');
    log.push(`contorno ${k.t.id} (${k.t.net}, ${k.t.layer}): ${r.pts.length - 1} pernas, ${r.nos} nós, ${r.ms.toFixed(2)} ms`);
  }
  log.push(`pares que atravessam outra net: ${outra.length} achados, ${paresVistos} roteados nos 3 modos; contornos completos: ${frios.length}`);
  log.push(`contorno frio: mediana ${mediana(frios).toFixed(2)} ms, máx ${Math.max(...frios).toFixed(2)} (limite 60)`);
  log.push(`contorno quente: mediana ${mediana(quentes).toFixed(2)} ms, máx ${Math.max(...quentes).toFixed(2)} (limite 15)`);
  assert.ok(Math.max(...frios) < 60, 'contorno frio < 60 ms');
  assert.ok(Math.max(...quentes) < 15, 'contorno quente < 15 ms');

  /* o L direto livre: a mesma net atravessando a própria trilha */
  const mesma = pares(true);
  assert.ok(mesma.length >= 1, 'acha no DMB um par que atravessa trilha da MESMA net');
  const tl = [];
  for (const k of mesma.slice(0, 20)) for (const modo of ['45', '90', 'livre']) {
    const q = req(k, modo);
    const r = rotaD(q, `DMB mesma net ${k.t.id} ${modo}`);
    assert.strictEqual(r.motivo, 'livre', 'mesma net: o L direto ' + k.t.id + ' ' + modo);
    const p = F.pernas(F.novo(k.de, modo, q.primeiro), k.ate);
    assert.deepStrictEqual(r.pts, p.perna2 ? [p.perna1[0], p.perna1[1], p.perna2[1]] : p.perna1, 'o L do HubFio');
    tl.push(rotaD(q, `DMB mesma net ${k.t.id} ${modo} de novo`).ms);
  }
  log.push(`L direto livre (mesma net, ${tl.length} rotas): mediana ${mediana(tl).toFixed(3)} ms, máx ${Math.max(...tl).toFixed(3)} (limite 2)`);
  assert.ok(mediana(tl) < 2, 'L direto livre < 2 ms');

  /* o pior caso: o que esgota o orçamento */
  let pior = null;
  for (const k of outra) {
    c._ctx = null;
    const r = rotaD(req(k, '45'), 'DMB à procura do orçamento ' + k.t.id);
    if (r.motivo === 'orcamento') { pior = r; break; }
  }
  if (pior) {
    log.push(`pior caso (orçamento de ${pior.nos} nós): ${pior.ms.toFixed(2)} ms (limite 120)`);
    assert.ok(pior.ms < 120, 'pior caso < 120 ms');
  } else log.push('pior caso: nenhum par esgotou o orçamento');

  /* partida no meio de uma trilha: netEm dá a net dela */
  const t1 = EB.tracks.find(t => Math.hypot(t.x2 - t.x1, t.y2 - t.y1) > 2);
  assert.strictEqual(R.netEm(c, t1.layer, (t1.x1 + t1.x2) / 2, (t1.y1 + t1.y2) / 2), t1.net, 'netEm no meio de uma trilha do DMB');
  log.push(`rotas do DMB conferidas pelo verificador: ${verificadas}`);
  console.log('  ' + log.join('\n  '));
}

console.log(`test-roteador OK (${ROTAS_VERIFICADAS} rotas conferidas pelo verificador independente, ${AMOSTRAS} amostras)`);
