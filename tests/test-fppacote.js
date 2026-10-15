// hub-fppacote.js (o assistente de footprint): numeracao do Altium, pads no lugar, corpo 3D,
// e recusa do que nao fecha.
const assert = require('assert');
const path = require('path');
const P = require(path.join(__dirname, '..', 'hub-fppacote.js'));
const HF = require(path.join(__dirname, '..', 'hub-fplib.js'));

const pad = (fp, n) => fp.pads.find(p => p.name === String(n));

/* SOIC-8: pino 1 no alto da esquerda, anti-horario; 5 embaixo a direita */
const so = P.gera('soic', {});
assert.strictEqual(so.name, 'SOIC-8_P1.27');
assert.strictEqual(so.pads.length, 8);
assert.deepStrictEqual([pad(so, 1).x, pad(so, 1).y], [-2.7, 1.905]);
assert.deepStrictEqual([pad(so, 4).x, pad(so, 4).y], [-2.7, -1.905]);
assert.deepStrictEqual([pad(so, 5).x, pad(so, 5).y], [2.7, -1.905]);
assert.deepStrictEqual([pad(so, 8).x, pad(so, 8).y], [2.7, 1.905]);
assert.ok(pad(so, 1).type === 'smd' && pad(so, 1).layer === 'Top');
assert.strictEqual(so.bodies.length, 1);
assert.strictEqual(so.bodies[0].kind, 'extruded');
assert.deepStrictEqual(HF.valida(so), [], 'o editor aceita');

/* DIP: PTH, pino 1 quadrado, os outros redondos, furo */
const dip = P.gera('dip', { n:14 });
assert.strictEqual(dip.name, 'DIP-14');
assert.strictEqual(pad(dip, 1).shape, 'rect');
assert.strictEqual(pad(dip, 2).shape, 'circle');
assert.strictEqual(pad(dip, 1).layer, 'Multi');
assert.strictEqual(pad(dip, 1).drill, 0.8);
assert.deepStrictEqual(HF.valida(dip), []);

/* QFP-32: 8 por lado; 9 embaixo (pad deitado), 17 a direita, 25 em cima */
const q = P.gera('qfp', {});
assert.strictEqual(q.pads.length, 32);
assert.ok(pad(q, 1).x < 0 && pad(q, 1).y > 0);
assert.ok(pad(q, 9).y < 0 && pad(q, 9).w < pad(q, 9).h, 'lado de baixo: pad deitado');
assert.ok(pad(q, 17).x > 0 && pad(q, 17).y < 0);
assert.ok(pad(q, 25).y > 0 && pad(q, 25).x > 0);
assert.deepStrictEqual(HF.valida(q), []);

/* SOT-23-3 e -5 */
const s3 = P.gera('sot23', {});
assert.deepStrictEqual(s3.pads.map(p => [p.x, p.y]), [[-0.95, -1.1], [0.95, -1.1], [0, 1.1]]);
assert.strictEqual(P.gera('sot23', { n:5 }).pads.length, 5);

/* chip e barra de pinos */
const ch = P.gera('chip', { passo:1.6, padX:0.9, padY:0.95, cx:1.6, cy:0.8 });
assert.strictEqual(ch.name, 'CHIP_1.6x0.8');
assert.deepStrictEqual([pad(ch, 1).x, pad(ch, 2).x], [-0.8, 0.8]);
const h = P.gera('header', { n:6, fil:2 });
assert.strictEqual(h.name, 'HDR_2x3_P2.54');
assert.ok(pad(h, 1).y > 0 && pad(h, 2).y < 0 && pad(h, 1).x === pad(h, 2).x, 'zigue-zague');
assert.ok(pad(h, 3).x > pad(h, 1).x);

/* recusas */
assert.throws(() => P.gera('soic', { n:7 }), /par/);
assert.throws(() => P.gera('qfp', { n:30 }), /múltiplo de 4/);
assert.throws(() => P.gera('dip', { furo:2 }), /furo/);
assert.throws(() => P.gera('xyz', {}), /desconhecido/);

console.log('test-fppacote OK (SOIC, DIP, QFP, SOT-23, chip, barra de pinos, recusas)');
