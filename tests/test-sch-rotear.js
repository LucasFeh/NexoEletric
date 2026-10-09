/* A tecla D do arrasto: o componente que chega alinhado com a ponta solta de um fio pousa e o fio
   estica até o pino. Pedido do dono em 2026-10-09: "se quando eu estiver movimentando um
   componente entre 2 trilhas e o canvas identificar que existe centralização entre os pinos e as 2
   trilhas eu posso aperta 'D' no teclado e o componente é roteado automaticamente".

   As três contas puras do schframe.js: pontasSoltas (uma vez por gesto), paresDeRota (a cada
   quadro, no pouso) e ligaPonta (no D). O resto (o pouso, o desenho tracejado, o commit único)
   é DOM e se confere no hub.

   schframe.js em Node vale só pela parte pura: o require abaixo morre se alguém puser DOM acima
   do module.exports.
   Rode: node tests/test-sch-rotear.js */
'use strict';
const assert = require('assert');
const SF = require('../schframe.js');

const fio = pts => ({ pts });
const ALC = 2000;

/* O caso do pedido: um fio termina em (1000,2000), outro começa em (1600,2000), e um resistor
   horizontal chega com as pontas quentes em (1100,2000) e (1500,2000). Os pinos apontam para fora
   (o 1 para a esquerda, o 2 para a direita), e a caixa vai de ponta a ponta. */
const A = fio([[500, 2000], [1000, 2000]]);
const B = fio([[1600, 2000], [2100, 2000]]);
const caixaR = { x1:1100, y1:1960, x2:1500, y2:2040 };
const resistor = (dy, comDirecao) => [
  Object.assign({ x:1100, y:2000 + (dy || 0), ref:'R1', num:'1', caixa:0 }, comDirecao === false ? {} : { ox:-1, oy:0 }),
  Object.assign({ x:1500, y:2000 + (dy || 0), ref:'R1', num:'2', caixa:0 }, comDirecao === false ? {} : { ox:1, oy:0 }),
];
const caixaEm = dy => [{ x1:caixaR.x1, y1:caixaR.y1 + dy, x2:caixaR.x2, y2:caixaR.y2 + dy }];
/* os vértices dos fios parados também são ponto elétrico para o trecho novo */
const vertices = fios => [].concat(...fios.map(w => w.pts.map(p => ({ x:p[0], y:p[1] }))));
const nomes = pares => pares.map(r => r.pino.ref + '-' + r.pino.num + '→' + r.ponta.x + ',' + r.ponta.y).join(' ');

/* ── 1. AS PONTAS SOLTAS ── */
{
  const s = SF.pontasSoltas([A, B], []);
  assert.deepStrictEqual(s.map(p => [p.wi, p.i, p.x, p.y]),
    [[0, 0, 500, 2000], [0, 1, 1000, 2000], [1, 0, 1600, 2000], [1, 1, 2100, 2000]],
    'cada fio tem duas pontas soltas, com o índice do fio e da ponta');
}
/* ponta em pino, junção, power ou port (os `pontos`) está ligada */
{
  const s = SF.pontasSoltas([A, B], [{ x:1000, y:2000 }]);
  assert.ok(!s.some(p => p.x === 1000), 'a ponta em cima de um ponto elétrico não é solta');
  assert.strictEqual(s.length, 3);
  /* a tolerância é a do esquema (STOL_SCH = 0,5 mil), a mesma da extração de nets */
  assert.strictEqual(SF.pontasSoltas([A], [{ x:1000.4, y:2000 }]).length, 1, 'a 0,4 mil ainda é o mesmo ponto');
  assert.strictEqual(SF.pontasSoltas([A], [{ x:1001, y:2000 }]).length, 2, 'a 1 mil já não é');
}
/* ponta no vértice ou no MEIO de outro fio (o T) está ligada; o canto em L do próprio fio não conta */
{
  const T = fio([[1000, 1500], [1000, 2500]]);
  const s = SF.pontasSoltas([A, T], []);
  assert.ok(!s.some(p => p.x === 1000 && p.y === 2000), 'a ponta que pousa no meio de outro fio faz T: ligada');
  const C = fio([[1000, 2000], [1600, 2000]]);
  assert.ok(!SF.pontasSoltas([A, C], []).some(p => p.x === 1000), 'duas pontas no mesmo ponto: ligadas');
  const L = fio([[0, 0], [0, 100], [100, 100]]);
  assert.strictEqual(SF.pontasSoltas([L], []).length, 2, 'o fio em L tem as duas pontas soltas');
}
/* o fio fechado em anel, e o que volta sobre si mesmo, não têm ponta solta onde se encostam */
{
  const anel = fio([[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]);
  assert.strictEqual(SF.pontasSoltas([anel], []).length, 0, 'anel: as duas pontas se encostam');
  const gancho = fio([[50, 0], [50, 100], [0, 100], [0, 0], [100, 0]]);
  assert.deepStrictEqual(SF.pontasSoltas([gancho], []).map(p => p.i), [4], 'a ponta 0 pousa no último trecho do próprio fio');
}
/* fio de um ponto só não tem ponta, e entrada vazia não quebra */
assert.deepStrictEqual(SF.pontasSoltas([fio([[0, 0]])], []), []);
assert.deepStrictEqual(SF.pontasSoltas(undefined, undefined), []);

/* ── 2. OS PARES ── */

/* o caso do pedido: dois pares, cada pino no fio do seu lado */
{
  const fios = [A, B];
  const r = SF.paresDeRota(resistor(0), SF.pontasSoltas(fios, []), caixaEm(0), vertices(fios), ALC, fios);
  assert.strictEqual(nomes(r), 'R1-1→1000,2000 R1-2→1600,2000', 'R1-1 no fio da esquerda, R1-2 no da direita');
  assert.deepStrictEqual(r.map(p => p.d), [100, 100]);
  /* sem a direção do pino a caixa decide sozinha, e decide igual */
  const s = SF.paresDeRota(resistor(0, false), SF.pontasSoltas(fios, []), caixaEm(0), vertices(fios), ALC, fios);
  assert.strictEqual(nomes(s), nomes(r), 'sem ox/oy a caixa basta no caso comum');
}
/* desalinhado 30 mil: nenhum par. E até STOL_SCH ainda é alinhado */
{
  const fios = [A, B];
  const pontas = SF.pontasSoltas(fios, []);
  assert.strictEqual(SF.paresDeRota(resistor(30), pontas, caixaEm(30), vertices(fios), ALC, fios).length, 0, '30 mil fora do eixo: nada');
  assert.strictEqual(SF.paresDeRota(resistor(1), pontas, caixaEm(1), vertices(fios), ALC, fios).length, 0, '1 mil fora do eixo: nada');
  assert.strictEqual(SF.paresDeRota(resistor(0.4), pontas, caixaEm(0.4), vertices(fios), ALC, fios).length, 2, '0,4 mil é o mesmo eixo');
}
/* a ponta do lado de DENTRO do componente: o trecho atravessaria o corpo */
{
  const dentro = fio([[1300, 1500], [1300, 2000]]);
  const fios = [dentro];
  const pontas = SF.pontasSoltas(fios, []);
  assert.strictEqual(SF.paresDeRota(resistor(0), pontas, caixaEm(0), vertices(fios), ALC, fios).length, 0,
    'ponta entre os pinos: recusada pela direção do pino');
  assert.strictEqual(SF.paresDeRota(resistor(0, false), pontas, caixaEm(0), vertices(fios), ALC, fios).length, 0,
    'ponta entre os pinos: recusada pela caixa, sem a direção');
  /* o fio da direita, com o componente andando 200 para a direita, cai dentro dele */
  const r = SF.paresDeRota(resistor(0).map(p => Object.assign({}, p, { x:p.x + 200 })), SF.pontasSoltas([A, B], []),
    [{ x1:1300, y1:1960, x2:1700, y2:2040 }], vertices([A, B]), ALC, [A, B]);
  assert.strictEqual(nomes(r), 'R1-1→1000,2000', 'a ponta que ficou dentro fica de fora; a da esquerda ainda vale');
}
/* a caixa alargada por um texto do símbolo além da ponta do pino: o fio que sai reto do pino vale */
{
  const fios = [A, B];
  const larga = [{ x1:1000.8, y1:1960, x2:1599.2, y2:2040 }];
  const pontas = SF.pontasSoltas(fios, []);
  assert.strictEqual(SF.paresDeRota(resistor(0), pontas, larga, vertices(fios), ALC, fios).length, 2,
    'na direção do pino a caixa do próprio componente não conta');
  assert.strictEqual(SF.paresDeRota(resistor(0, false), pontas, larga, vertices(fios), ALC, fios).length, 0,
    'só com a caixa, o texto recusaria os dois');
}
/* a ponta já ligada a outra coisa não entra no jogo */
{
  const fios = [A, B];
  const powers = [{ x:1000, y:2000 }];
  const r = SF.paresDeRota(resistor(0), SF.pontasSoltas(fios, powers), caixaEm(0), powers.concat(vertices(fios)), ALC, fios);
  assert.strictEqual(nomes(r), 'R1-2→1600,2000', 'a ponta com um GND em cima não é oferecida');
}
/* o trecho novo encostando em outro ponto elétrico: recusado */
{
  const fios = [A, B];
  const pontas = SF.pontasSoltas(fios, []);
  const port = [{ x:1050, y:2000 }];
  const r = SF.paresDeRota(resistor(0), pontas, caixaEm(0), port.concat(vertices(fios)), ALC, fios);
  assert.strictEqual(nomes(r), 'R1-2→1600,2000', 'uma port no meio do caminho tira o par da esquerda');
  /* o vértice de um fio parado no caminho também: o fio comprido de 0 a 1000 não pula a ponta 1000 */
  const longe = fio([[0, 2000], [600, 2000]]);
  const s = SF.paresDeRota(resistor(0), SF.pontasSoltas([longe], []), caixaEm(0), vertices([longe]), ALC, [longe]);
  assert.strictEqual(nomes(s), 'R1-1→600,2000', 'a ponta 0 do mesmo eixo, atrás da 600, não é oferecida');
  /* outro pino do que viaja no caminho */
  const tres = resistor(0).concat([{ x:1050, y:2000, ref:'R2', num:'1' }]);
  const t = SF.paresDeRota(tres, pontas, caixaEm(0), vertices(fios), ALC, fios);
  assert.ok(!t.some(p => p.pino.ref === 'R1' && p.pino.num === '1'), 'o pino de R2 no caminho tira o par de R1-1');
}
/* o pino que pousa no MEIO de um fio já está ligado: rotear juntaria duas nets */
{
  const passa = fio([[1100, 1800], [1100, 2200]]);
  const fios = [A, B, passa];
  const r = SF.paresDeRota(resistor(0), SF.pontasSoltas(fios, []), caixaEm(0), vertices(fios), ALC, fios);
  assert.strictEqual(nomes(r), 'R1-2→1600,2000', 'R1-1 já toca um fio: nada a rotear nele');
  /* o próprio fio voltando sobre o pino: o pino cai no último trecho dele */
  const volta = fio([[1300, 2000], [1000, 2000]]);
  const s = SF.paresDeRota([{ x:1100, y:2000, ref:'R1', num:'1', ox:1, oy:0 }], SF.pontasSoltas([volta], []), [],
    vertices([volta]), ALC, [volta]);
  assert.strictEqual(s.length, 0, 'o fio não dobra sobre si mesmo');
}
/* o alcance e a distância mínima */
{
  const fios = [A, B];
  const pontas = SF.pontasSoltas(fios, []);
  assert.strictEqual(SF.paresDeRota(resistor(0), pontas, caixaEm(0), vertices(fios), 99, fios).length, 0, 'fora do alcance: nada');
  assert.strictEqual(SF.paresDeRota(resistor(0), pontas, caixaEm(0), vertices(fios), 100, fios).length, 2, 'no limite do alcance: vale');
  /* o pino em cima da ponta (o ímã já o pôs lá) já está ligado: não é par */
  const r = SF.paresDeRota([{ x:1000, y:2000, ref:'R1', num:'1', ox:-1, oy:0 }], pontas, [], vertices(fios), ALC, fios);
  assert.strictEqual(r.length, 0, 'distância zero não é rota');
}
/* o fio vertical: mesmo X */
{
  const cima = fio([[700, 3000], [700, 2600]]);
  const pino = [{ x:700, y:2400, ref:'C1', num:'1', ox:0, oy:1, caixa:0 }];
  const r = SF.paresDeRota(pino, SF.pontasSoltas([cima], []), [{ x1:660, y1:2000, x2:740, y2:2400 }], vertices([cima]), ALC, [cima]);
  assert.strictEqual(nomes(r), 'C1-1→700,2600', 'mesmo X liga na vertical');
}
/* guloso pelo mais perto: cada pino e cada ponta num par só */
{
  const perto = fio([[900, 2500], [1000, 2500]]);
  const longe = fio([[1000, 3000], [1000, 2800]]);
  const pino = [{ x:1000, y:2000, ref:'J1', num:'1' }, { x:1100, y:2500, ref:'J1', num:'2' }];
  /* a ponta (1000,2500) serve aos dois pinos: J1-2 está a 100, J1-1 a 500. Ganha J1-2, e J1-1 fica
     sem par, porque a ponta (1000,2800) está atrás da (1000,2500) e o trecho passaria por ela */
  const r = SF.paresDeRota(pino, SF.pontasSoltas([perto, longe], []), [], vertices([perto, longe]), ALC, [perto, longe]);
  assert.strictEqual(nomes(r), 'J1-2→1000,2500', 'a ponta mais perto fica com o pino mais perto');
  /* sem a ponta disputada, J1-1 pega a de cima */
  const s = SF.paresDeRota([pino[0]], SF.pontasSoltas([longe], []), [], vertices([longe]), ALC, [longe]);
  assert.strictEqual(nomes(s), 'J1-1→1000,2800');
  /* duas pontas alinhadas com o mesmo pino, uma de cada lado: a mais perto */
  const esq = fio([[600, 2000], [800, 2000]]), dir = fio([[1500, 2000], [1300, 2000]]);
  const t = SF.paresDeRota([{ x:1000, y:2000, ref:'TP1', num:'1' }], SF.pontasSoltas([esq, dir], []), [],
    vertices([esq, dir]), ALC, [esq, dir]);
  assert.strictEqual(nomes(t), 'TP1-1→800,2000', 'um pino, um par');
}
/* a caixa de OUTRO componente que viaja junto também barra o trecho */
{
  const fios = [A];
  const pino = [{ x:1300, y:2000, ref:'R2', num:'1', ox:-1, oy:0, caixa:1 }];
  const caixas = [{ x1:1050, y1:1900, x2:1200, y2:2100 }, { x1:1300, y1:1960, x2:1700, y2:2040 }];
  assert.strictEqual(SF.paresDeRota(pino, SF.pontasSoltas(fios, []), caixas, vertices(fios), ALC, fios).length, 0,
    'o trecho passaria por dentro do outro componente arrastado');
}
assert.deepStrictEqual(SF.paresDeRota(undefined, undefined, undefined, undefined, 0, undefined), []);

/* ── 3. O FIO ESTICADO ── */

/* reto: o último trecho já está no eixo e aponta para o pino — a ponta anda */
assert.deepStrictEqual(SF.ligaPonta(A.pts, 1, 1100, 2000), [[500, 2000], [1100, 2000]], 'a ponta final anda até o pino');
assert.deepStrictEqual(SF.ligaPonta(B.pts, 0, 1500, 2000), [[1500, 2000], [2100, 2000]], 'a ponta inicial anda até o pino');
assert.deepStrictEqual(A.pts, [[500, 2000], [1000, 2000]], 'o fio de entrada não muda');
/* em L: o último trecho chega na vertical e o pino está ao lado — entra o vértice do canto */
assert.deepStrictEqual(SF.ligaPonta([[1000, 1500], [1000, 2000]], 1, 1100, 2000),
  [[1000, 1500], [1000, 2000], [1100, 2000]], 'o L ganha um vértice no fim');
assert.deepStrictEqual(SF.ligaPonta([[1000, 2000], [1000, 2500]], 0, 1100, 2000),
  [[1100, 2000], [1000, 2000], [1000, 2500]], 'e no começo');
/* no eixo mas apontando para o outro lado (o fio não dobra sobre si mesmo andando a ponta) */
assert.deepStrictEqual(SF.ligaPonta([[1300, 2000], [1000, 2000]], 1, 900, 2000), [[1300, 2000], [900, 2000]]);
assert.deepStrictEqual(SF.ligaPonta([[1300, 2000], [1000, 2000]], 1, 1100, 2000),
  [[1300, 2000], [1000, 2000], [1100, 2000]], 'contra o último trecho: vértice novo, e o paresDeRota já o recusa antes');
/* o fio de três pontos, e o índice que não é ponta */
assert.deepStrictEqual(SF.ligaPonta([[0, 0], [0, 100], [100, 100]], 2, 300, 100), [[0, 0], [0, 100], [300, 100]]);
assert.deepStrictEqual(SF.ligaPonta([[0, 0], [0, 100], [100, 100]], 1, 300, 100), [[0, 0], [0, 100], [100, 100]], 'meio não é ponta');
/* as duas pontas do mesmo fio, uma depois da outra: o índice da última é medido na hora */
{
  let p = SF.ligaPonta([[1000, 2500], [1000, 2000]], 0, 900, 2500);
  p = SF.ligaPonta(p, p.length - 1, 1100, 2000);
  assert.deepStrictEqual(p, [[900, 2500], [1000, 2500], [1000, 2000], [1100, 2000]]);
}

console.log('test-sch-rotear: OK');
