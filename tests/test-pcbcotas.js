/* hub-pcbcotas.js: a régua da vista PCB (Ctrl+M) — agarres, tangente, modos e o índice do acervo.
   Rode: node tests/test-pcbcotas.js */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const C = require('../hub-pcbcotas.js');
const perto = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= (eps || 1e-6), (msg || '') + ': ' + a + ' ≠ ' + b);

/* ---- uma placa de brinquedo ---- */
const eb = {
  board:{ outline:[{ kind:'line', x1:0, y1:0, x2:50, y2:0 }, { kind:'line', x1:50, y1:0, x2:50, y2:30 }] },
  components:[{ x:10, y:10, layer:'Top', pads:[
    { x:10, y:10, w:2, h:2, shape:'round', layer:'Multi', drill:1 },
    { x:20, y:10, w:2, h:1, shape:'rect', rot:0, layer:'Top' },
  ] }],
  vias:[{ x:30, y:10, size:1, drill:0.5 }],
  tracks:[{ x1:0, y1:20, x2:10, y2:20, w:0.5, layer:'Top' }],
  silk:[{ kind:'arc', cx:40, cy:20, r:3, sa:0, ea:360, w:0.1, layer:'TopOverlay' }],
};
const idx = C.indice(eb, { ehTH:p => p.layer === 'Multi', semCache:true });
const tol = 0.3;

/* pontos ganham das bordas */
let s = C.agarra(idx, { x:10.1, y:10.05 }, tol);
assert.strictEqual(s.tipo, 'centro', 'centro do pad redondo'); perto(s.x, 10); perto(s.y, 10);
s = C.agarra(idx, { x:11.05, y:10 }, tol);
assert.strictEqual(s.tipo, 'quadrante', 'borda do círculo do pad (quadrante)'); perto(s.x, 11);
s = C.agarra(idx, { x:21, y:10.5 }, tol);
assert.strictEqual(s.tipo, 'canto', 'canto do pad retangular');
s = C.agarra(idx, { x:5, y:20.02 }, tol);
assert.strictEqual(s.tipo, 'meio', 'meio da trilha');
s = C.agarra(idx, { x:30.5, y:10 }, tol);
assert.strictEqual(s.tipo, 'quadrante', 'quadrante da via');
s = C.agarra(idx, { x:40, y:20 }, tol);
assert.strictEqual(s.tipo, 'centro', 'centro do círculo de serigrafia');
/* longe dos pontos, na borda de um círculo: tangente, com o círculo junto */
s = C.agarra(idx, { x:40 + 3 * Math.cos(0.6), y:20 + 3 * Math.sin(0.6) }, tol);
assert.strictEqual(s.tipo, 'tangente', 'borda do círculo = tangente');
assert.deepStrictEqual(s.circ, { cx:40, cy:20, r:3 });
/* a borda do cobre da trilha (meia largura do lado do cursor) */
s = C.agarra(idx, { x:3, y:20.27 }, 0.1);
assert.strictEqual(s.tipo, 'borda', 'borda do cobre'); perto(s.y, 20.25);
s = C.agarra(idx, { x:3, y:20.02 }, 0.1);
assert.strictEqual(s.tipo, 'sobre', 'sobre a linha do centro'); perto(s.y, 20);
/* camada escondida não agarra */
s = C.agarra(idx, { x:40, y:20 }, tol, { visivel:l => l !== 'TopOverlay' });
assert.ok(!s || s.tipo !== 'centro' || s.x !== 40, 'serigrafia escondida não agarra');
/* contorno da placa vale sempre */
s = C.agarra(idx, { x:25, y:0.05 }, tol, { visivel:() => false });
assert.strictEqual(s.tipo, 'meio', 'meio do lado do contorno, mesmo com tudo escondido');
/* nada perto: null (a vista cai na grade) */
assert.strictEqual(C.agarra(idx, { x:45, y:5 }, tol), null);

/* ---- a cota: tangente, modos e o automático ---- */
const circA = { cx:0, cy:0, r:1 }, circB = { cx:10, cy:0, r:2 };
let cota = { a:{ x:0, y:1, tipo:'tangente', circ:circA }, b:{ x:10, y:2, tipo:'tangente', circ:circB }, modo:'alinhada', q:{ x:5, y:3 } };
let g = C.geometria(cota);
perto(g.valor, 7, 1e-9, 'tangente-tangente de perto = centro a centro − raios');
perto(g.A.x, 1); perto(g.B.x, 8);
perto(g.D1.y, 3, 1e-9, 'a linha de cota passa por q');
cota.a.cond = 'longe'; cota.b.cond = 'longe';
perto(C.geometria(cota).valor, 13, 1e-9, 'tangente de longe');
cota.a.cond = 'centro'; cota.b.cond = 'centro';
perto(C.geometria(cota).valor, 10, 1e-9, 'centro a centro');
/* tangente contra um ponto */
cota = { a:{ x:3, y:4, tipo:'ponta' }, b:{ x:0, y:-1, tipo:'tangente', circ:{ cx:0, cy:0, r:1 } }, modo:'alinhada' };
perto(C.geometria(cota).valor, 4, 1e-9, 'do ponto (3,4) ao círculo de raio 1 na origem');
/* horizontal e vertical */
cota = { a:{ x:0, y:0 }, b:{ x:4, y:3 }, modo:'h', q:{ x:2, y:6 } };
g = C.geometria(cota); perto(g.valor, 4); perto(g.D1.y, 6); perto(g.D1.x, 0); perto(g.D2.x, 4);
cota.modo = 'v'; g = C.geometria(cota); perto(g.valor, 3); perto(g.D1.x, 2);
cota.modo = 'alinhada'; perto(C.geometria(cota).valor, 5);
/* horizontal com tangente: o extremo do círculo no eixo X, do lado da outra ponta */
cota = { a:{ x:0, y:1, circ:{ cx:0, cy:0, r:1 } }, b:{ x:10, y:5 }, modo:'h', q:{ x:5, y:9 } };
perto(C.geometria(cota).valor, 9, 1e-9, 'horizontal da borda do círculo');
/* automático: acima/abaixo = horizontal, ao lado = vertical, no meio = alinhada */
cota = { a:{ x:0, y:0 }, b:{ x:4, y:3 }, modo:'auto' };
assert.strictEqual(C.modoAuto(cota, { x:2, y:8 }), 'h');
assert.strictEqual(C.modoAuto(cota, { x:2, y:-5 }), 'h');
assert.strictEqual(C.modoAuto(cota, { x:9, y:1 }), 'v');
assert.strictEqual(C.modoAuto(cota, { x:2, y:1 }), 'alinhada');
assert.strictEqual(C.modoAuto(cota, { x:9, y:9 }), 'alinhada');
cota.q = { x:9, y:1 }; assert.strictEqual(C.geometria(cota).modo, 'v', 'geometria usa o automático');
/* tocar a cota: a linha e o texto */
g = C.geometria({ a:{ x:0, y:0 }, b:{ x:10, y:0 }, modo:'alinhada', q:{ x:5, y:2 } });
assert.ok(C.toca(g, { x:3, y:2.05 }, 0.1), 'na linha de cota');
assert.ok(!C.toca(g, { x:3, y:1 }, 0.1), 'longe');
/* círculo de pontos (o furo de fixação do Altium) */
const furo = []; for (let i = 0; i < 32; i++) furo.push([5 + 1.6 * Math.cos(i / 32 * 2 * Math.PI), 7 + 1.6 * Math.sin(i / 32 * 2 * Math.PI)]);
const cf = C.circuloDosPontos(furo); perto(cf.cx, 5); perto(cf.cy, 7); perto(cf.r, 1.6, 1e-3);
assert.strictEqual(C.circuloDosPontos([[0, 0], [1, 0], [1, 1], [0, 1]]), null, 'quadrado não é círculo');

/* ---- o acervo: o índice monta e responde rápido nas placas de verdade ---- */
const proj = path.join(__dirname, '..', 'Projects');
let placas = 0;
for (const d of fs.existsSync(proj) ? fs.readdirSync(proj) : []) {
  const f = path.join(proj, d, 'board.js');
  if (!fs.existsSync(f)) continue;
  const ctx = {}; vm.createContext(ctx);
  try { vm.runInContext(fs.readFileSync(f, 'utf8') + ';this.__b = typeof pcbmirror !== "undefined" ? pcbmirror : null;', ctx); } catch (e) { continue; }
  const b = ctx.__b; if (!b) continue;
  const ebx = Object.assign({}, b, { board:b.board || { outline:b.outline || [] } });
  const t0 = Date.now(), ix = C.indice(ebx, { semCache:true });
  assert.ok(ix.pts.length > 0, d + ': o índice tem pontos');
  const bb = (b.board && b.board.bbox) || { x1:0, y1:0, x2:50, y2:50 };
  const t1 = Date.now();
  for (let i = 0; i < 50; i++) C.agarra(ix, { x:bb.x1 + (bb.x2 - bb.x1) * i / 50, y:bb.y1 + (bb.y2 - bb.y1) * ((i * 7) % 50) / 50 }, 0.3);
  const porAgarre = (Date.now() - t1) / 50;
  assert.ok(porAgarre < 25, d + ': agarre em ' + porAgarre.toFixed(1) + ' ms');
  placas++;
  if (placas === 1 || process.env.VERBOSO) console.log('  ' + d + ': ' + ix.pts.length + ' pontos, ' + ix.segs.length + ' segmentos, ' + ix.circs.length + ' círculos · índice ' + (t1 - t0) + ' ms · agarre ' + porAgarre.toFixed(2) + ' ms');
}
console.log('hub-pcbcotas: ok (' + placas + ' placas do acervo)');
