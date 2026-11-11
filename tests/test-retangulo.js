/* O RETÂNGULO FECHADO (1.99.0, hub-core.js » retanguloDeLinhas / esticaRetangulo): o lado clicado de um retângulo de 4
   segmentos (o silk do editor de footprint, as trilhas da vista PCB) estica arrastando.
     node tests/test-retangulo.js
   A tela de verdade: tests/smoke-retangulo.js. */
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const H = require('../hub-core.js');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const L = c => c.map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2 }));
const ret = () => L([[0, 0, 10, 0], [10, 0, 10, 5], [10, 5, 0, 5], [0, 5, 0, 0]]);

/* acha o retângulo e o lado */
{
  const l = ret();
  for (const [i, lado] of [[0, 'y1'], [1, 'x2'], [2, 'y2'], [3, 'x1']]) {
    const R = H.retanguloDeLinhas(l, l[i]);
    ok(R && R.lado === lado && R.linhas.length === 4, 'o lado ' + lado);
    eq(R.bb, [0, 0, 10, 5], 'a caixa');
  }
}
/* as linhas fora de ordem e com as pontas trocadas também */
{
  const l = L([[0, 5, 0, 0], [10, 5, 10, 0], [10, 0, 0, 0], [0, 5, 10, 5]]);
  ok(H.retanguloDeLinhas(l, l[1]), 'fora de ordem e invertidas: ainda é o retângulo');
}
/* não é retângulo solto: uma linha a mais no canto, aberto, diagonal, três lados, outras linhas longe não atrapalham */
{
  const l = ret().concat(L([[0, 0, -2, 0]]));
  eq(H.retanguloDeLinhas(l, l[0]), null, 'uma linha a mais no canto (o traço do pino 1): não estica, move');
  const ab = L([[0, 0, 10, 0], [10, 0, 10, 5], [10, 5, 0, 5], [0, 5, 0, 1]]);
  eq(H.retanguloDeLinhas(ab, ab[0]), null, 'aberto');
  const tri = L([[0, 0, 10, 0], [10, 0, 5, 5], [5, 5, 0, 0]]);
  eq(H.retanguloDeLinhas(tri, tri[0]), null, 'triângulo');
  const lo = ret().concat(L([[50, 50, 60, 50]]));
  ok(H.retanguloDeLinhas(lo, lo[0]), 'uma linha longe não atrapalha');
  const dois = ret().concat(L([[0, 0, 10, 0]]));
  eq(H.retanguloDeLinhas(dois, dois[1]), null, 'lado duplicado: ambíguo');
}
/* esticar: o lado anda, os vizinhos esticam, o oposto fica; não passa do oposto */
{
  const l = ret(), R = H.retanguloDeLinhas(l, l[1]);
  eq(H.esticaRetangulo(R, 'x2', 14), 14);
  eq(l.map(s => [s.x1, s.y1, s.x2, s.y2]), [[0, 0, 14, 0], [14, 0, 14, 5], [14, 5, 0, 5], [0, 5, 0, 0]], 'o lado direito em 14');
  eq(R.bb, [0, 0, 14, 5], 'a caixa acompanha');
  eq(H.esticaRetangulo(R, 'x2', -3, 0.5), 0.5, 'não passa do lado oposto: fica a 0,5 dele');
  const l2 = ret(), R2 = H.retanguloDeLinhas(l2, l2[0]);
  H.esticaRetangulo(R2, 'y1', -2);
  eq(l2.map(s => [s.x1, s.y1, s.x2, s.y2]), [[0, -2, 10, -2], [10, -2, 10, 5], [10, 5, 0, 5], [0, 5, 0, -2]], 'o lado de baixo em -2');
}
/* a ligação nas duas telas */
{
  const fe = fs.readFileSync(path.join(__dirname, '..', 'hub-fpeditor.js'), 'utf8');
  ok(/retanguloDoSilk\(alvo\)/.test(fe) && /a\.estica/.test(fe), 'o editor de footprint estica pelo lado');
  const pf = fs.readFileSync(path.join(__dirname, '..', 'pcbframe.js'), 'utf8');
  ok(/function alcaDoRetangulo/.test(pf) && /alcaDoRetangulo\(g\.topo, g\.pegaSel\)/.test(pf), 'a vista PCB estica pelo lado');
  ok(/if \(!lay \|\| cobre\(lay\)\) return null/.test(pf), 'no cobre não (lá vale o Drag do Altium)');
}
console.log('test-retangulo: ' + n + ' verificações ok');
