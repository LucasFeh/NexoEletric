/* A borda da placa editada com o mouse (1.92.0): hub-pcbborda.js (as contas) + o caminho até o Gerber (outline_set).

   node tests/test-pcbborda.js

   A interação de verdade (Tab 1x/2x, arrastar a aresta com a medida ao vivo, Ctrl+Z) é o tests/smoke-borda.js. */
const assert = require('assert');
const BD = require('../hub-pcbborda.js');
const H = require('../hub-core.js');
const G = require('../hub-gerber.js');
const GV = require('../hub-gerberview.js');
const { loadVar } = require('./load.js');

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

/* ── retângulo 100 × 60 ── */
{
  const R = [[0, 0], [100, 0], [100, 60], [0, 60]];
  const segs = H.ptsToOutline(R);
  eq(BD.cadeia(segs, 2), [0, 1, 2, 3], 'a cadeia do retângulo é o retângulo');
  eq(BD.caixa(segs), { x1: 0, y1: 0, x2: 100, y2: 60, w: 100, h: 60 }, 'a caixa');
  eq(BD.normalAresta(R, 1), [1, 0], 'a normal da aresta da direita aponta para fora');
  const m = BD.moveAresta(R, 1, 15);
  eq(m, [[0, 0], [115, 0], [115, 60], [0, 60]], 'a aresta da direita anda 15 mm: a placa fica 115 × 60, em esquadro');
  eq(BD.moveAresta(R, 0, 5), [[0, -5], [100, -5], [100, 60], [0, 60]], 'a de baixo anda 5 para fora (para baixo)');
  eq(BD.moveAresta(R, 2, -10), [[0, 0], [100, 0], [100, 50], [0, 50]], 'a de cima entra 10: diminui');
  eq(BD.transladaPts(R, 3, -2), [[3, -2], [103, -2], [103, 58], [3, 58]], 'a borda inteira anda');
  eq(BD.moveVertice(R, 2, 110, 70), [[0, 0], [100, 0], [110, 70], [0, 60]], 'um vértice');
  ok(!BD.cruza(R) && BD.cruza([[0, 0], [10, 10], [10, 0], [0, 10]]), 'cruzamento');
  /* o sentido horário dá a mesma normal para fora */
  eq(BD.moveAresta(R.slice().reverse(), 1, 15).map(p => p[0]), [0, 115, 115, 0], 'horário: a aresta da direita também cresce para fora');
}

/* ── a borda da DMB (chanfros de 45°, a orelha com arco embaixo à direita) ── */
{
  const b = loadVar('Projects/DMB - DI231765_P2/board.js', 'pcbmirror');
  const segs = b.board.outline;
  const pts = H.outlineToPts(segs);
  ok(pts && pts.length === segs.length, 'a borda da DMB vira pts (' + segs.length + ' segmentos)');
  eq(BD.cadeia(segs, 0).length, segs.length, 'a cadeia da DMB é a borda inteira (uma volta só)');
  const c0 = BD.caixa(segs);
  ok(Math.abs(c0.w - 101.755) < 1e-3, 'a largura da DMB: ' + c0.w);
  /* a aresta da esquerda (x = 0, vertical) anda 5 mm para fora: os chanfros continuam de 45° */
  const i = pts.findIndex((p, k) => { const q = pts[(k + 1) % pts.length]; return Math.abs(p[0]) < 1e-6 && Math.abs(q[0]) < 1e-6 && BD.arestaReta(pts, k); });
  ok(i >= 0, 'achou a aresta da esquerda');
  const m = BD.moveAresta(pts, i, 5);
  const s2 = H.ptsToOutline(m);
  const c1 = BD.caixa(s2);
  ok(Math.abs(c1.w - (c0.w + 5)) < 1e-6 && Math.abs(c1.h - c0.h) < 1e-6, 'mais larga 5 mm, mesma altura: ' + c1.w + ' × ' + c1.h);
  ok(H.outlineToPts(s2), 'continua fechada');
  const ang = k => { const p = m[k], q = m[(k + 1) % m.length]; return Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI; };
  const angAntes = k => { const p = pts[k], q = pts[(k + 1) % pts.length]; return Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI; };
  const ip = (i - 1 + pts.length) % pts.length, inx = (i + 1) % pts.length;
  ok(Math.abs(ang(ip) - angAntes(ip)) < 1e-6 && Math.abs(ang(inx) - angAntes(inx)) < 1e-6, 'os chanfros vizinhos mantêm o ângulo');
  ok(!BD.cruza(m), 'sem cruzamento');
  /* o Gerber (Profile) segue a borda nova */
  const op = { op: 'outline_set', pts: m };
  const eb = H.effectiveBoard(b, H.applyPcbChanges(b, [op]));
  eq([r3(eb.board.bbox.x1), r3(eb.board.bbox.x2)], [-5, 101.755], 'a placa efetiva com a borda nova');
  const g = G.gerar(eb, { guid: '00000000-1111-4222-8333-444444444444' });
  const prof = g.arquivos.find(a => a.camada === 'Profile');
  const cam = GV.parse(prof.texto, prof.nome);
  const xs = [].concat(...cam.prims.filter(p => p.k === 'line' || p.k === 'arc').map(p => [p.x1, p.x2]));
  ok(Math.abs(Math.min(...xs) - (-5)) < 1e-3, 'o Profile do Gerber vai até x = -5: ' + Math.min(...xs));
}
function r3(v) { return Math.round(v * 1000) / 1000; }

console.log('test-pcbborda: ' + n + ' verificações ok');
