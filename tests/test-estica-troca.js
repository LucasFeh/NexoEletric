/* A troca de simbolo que muda a distancia entre os pinos (1.62.0). O "CAP [PTH] 1-2" tem os pinos a +-100
   mil e o capacitor do almoxarifado a +-150: nenhum deslocamento devolve os dois pinos ao lugar, o encaixe
   religava um e o outro ficava SOLTO sem aviso (C15, C1 e C8 do PBIDP-DI261944, 2026-10-30). Agora o que
   estava ligado no pino antigo vai ate o pino novo, como o arrasto do Altium: a ponta do fio estica (no
   mesmo eixo so anda; fora dele ganha um trecho, em L se preciso), o power/rotulo/porta/No ERC sozinho no
   pino anda junto, e o fio que passava pelo pino (T) ou o pino de outro componente ganham um fio novo.

     node tests/test-estica-troca.js */
'use strict';
const assert = require('assert');
const SF = require('../schframe.js');

let ok = 0;
const t = (nome, fn) => { fn(); ok++; };
const folha = o => Object.assign({ wires: [], powers: [], netlabels: [], ports: [], junctions: [], noercs: [] }, o);

t('existe e e exportada', () => {
  assert.strictEqual(typeof SF.esticaLigacoes, 'function');
  assert.strictEqual(typeof SF.movimentosDosPinos, 'function');
});

t('movimentosDosPinos: so os pinos de mesmo numero que mudaram de lugar', () => {
  const m = SF.movimentosDosPinos([{ num: '1', x: 0, y: 100 }, { num: '2', x: 0, y: -100 }, { num: '3', x: 5, y: 5 }],
                                  [{ num: '1', x: 0, y: 100 }, { num: '2', x: 0, y: -200 }, { num: '9', x: 1, y: 1 }]);
  assert.deepStrictEqual(m, [{ num: '2', de: { x: 0, y: -100 }, para: { x: 0, y: -200 } }]);
});

/* o caso do C15: o power 0VCC sozinho no pino 2 (sem fio) anda ate o pino novo */
t('power sozinho no pino anda junto', () => {
  const pw = { t: 'power', net: '0VCC', x: 1200, y: 4900, rot: 270 };
  const F = folha({ powers: [pw] });
  const r = SF.esticaLigacoes(F, [{ num: '2', de: { x: 1200, y: 4900 }, para: { x: 1200, y: 4800 } }], []);
  assert.deepStrictEqual([pw.x, pw.y], [1200, 4800]);
  assert.strictEqual(r.ligacoes, 1);
  assert.deepStrictEqual(r.novos, []);
});

/* ponta de fio no pino, pino andou no eixo do fio: a ponta so anda (sem vertice novo) */
t('ponta no mesmo eixo so anda, para fora e para dentro', () => {
  const w = { t: 'wire', pts: [[1200, 5400], [1200, 5100]] };
  SF.esticaLigacoes(folha({ wires: [w] }), [{ num: '1', de: { x: 1200, y: 5100 }, para: { x: 1200, y: 5150 } }], []);
  assert.deepStrictEqual(w.pts, [[1200, 5400], [1200, 5150]]);
  const v = { t: 'wire', pts: [[1200, 5400], [1200, 5100]] };
  SF.esticaLigacoes(folha({ wires: [v] }), [{ num: '1', de: { x: 1200, y: 5100 }, para: { x: 1200, y: 5050 } }], []);
  assert.deepStrictEqual(v.pts, [[1200, 5400], [1200, 5050]]);
});

/* ponta de fio horizontal no pino que andou na vertical: o fio ganha um trecho ate o pino */
t('ponta fora do eixo ganha um trecho', () => {
  const w = { t: 'wire', pts: [[800, 5100], [1200, 5100]] };
  SF.esticaLigacoes(folha({ wires: [w] }), [{ num: '1', de: { x: 1200, y: 5100 }, para: { x: 1200, y: 5150 } }], []);
  assert.deepStrictEqual(w.pts, [[800, 5100], [1200, 5100], [1200, 5150]]);
  const v = { t: 'wire', pts: [[1200, 5100], [800, 5100]] };
  SF.esticaLigacoes(folha({ wires: [v] }), [{ num: '1', de: { x: 1200, y: 5100 }, para: { x: 1200, y: 5150 } }], []);
  assert.deepStrictEqual(v.pts, [[1200, 5150], [1200, 5100], [800, 5100]], 'a ponta do comeco tambem');
});
t('deslocamento nos dois eixos sai em L, nunca na diagonal', () => {
  const w = { t: 'wire', pts: [[0, 0], [100, 0]] };
  SF.esticaLigacoes(folha({ wires: [w] }), [{ num: '1', de: { x: 100, y: 0 }, para: { x: 150, y: 50 } }], []);
  for (let i = 1; i < w.pts.length; i++)
    assert.ok(w.pts[i][0] === w.pts[i - 1][0] || w.pts[i][1] === w.pts[i - 1][1], 'trecho diagonal: ' + JSON.stringify(w.pts));
  assert.deepStrictEqual(w.pts[w.pts.length - 1], [150, 50]);
});

/* fio que passa PELO pino (T no meio do trecho): ganha um fio novo do ponto antigo ate o pino */
t('fio que passava pelo pino ganha um fio novo', () => {
  const w = { t: 'wire', pts: [[3800, 3400], [4400, 3400]] };
  const r = SF.esticaLigacoes(folha({ wires: [w], junctions: [{ t: 'junction', x: 4000, y: 3400 }] }),
                              [{ num: '1', de: { x: 4000, y: 3400 }, para: { x: 4000, y: 3350 } }], []);
  assert.deepStrictEqual(w.pts, [[3800, 3400], [4400, 3400]], 'o fio que passa fica');
  assert.deepStrictEqual(r.novos, [{ pts: [[4000, 3400], [4000, 3350]] }]);
  assert.strictEqual(r.ligacoes, 1);
});
t('pino de outro componente encostado ganha um fio novo', () => {
  const r = SF.esticaLigacoes(folha({}), [{ num: '2', de: { x: 500, y: 500 }, para: { x: 500, y: 600 } }], [{ x: 500, y: 500 }]);
  assert.deepStrictEqual(r.novos, [{ pts: [[500, 500], [500, 600]] }]);
});

/* com fio E power no pino: o fio estica; o power fica se o ponto antigo continua no fio, senao anda */
t('power com fio: fica no fio se o ponto antigo ainda e fio, senao anda', () => {
  const pw = { t: 'power', x: 100, y: 0 }, w = { t: 'wire', pts: [[0, 0], [100, 0]] };
  SF.esticaLigacoes(folha({ wires: [w], powers: [pw] }), [{ num: '1', de: { x: 100, y: 0 }, para: { x: 150, y: 0 } }], []);
  assert.deepStrictEqual([pw.x, pw.y], [100, 0], 'o fio esticou para fora: o power continua em cima dele');
  const pv = { t: 'power', x: 100, y: 0 }, v = { t: 'wire', pts: [[0, 0], [100, 0]] };
  SF.esticaLigacoes(folha({ wires: [v], powers: [pv] }), [{ num: '1', de: { x: 100, y: 0 }, para: { x: 50, y: 0 } }], []);
  assert.deepStrictEqual([pv.x, pv.y], [50, 0], 'o fio encolheu: o power vai com a ponta');
});

t('No ERC no pino anda junto; rotulo tambem', () => {
  const n = { t: 'noerc', x: 10, y: 10 }, l = { t: 'netlabel', x: 20, y: 20 };
  SF.esticaLigacoes(folha({ noercs: [n], netlabels: [l] }),
    [{ num: '1', de: { x: 10, y: 10 }, para: { x: 10, y: 60 } }, { num: '2', de: { x: 20, y: 20 }, para: { x: 20, y: 70 } }], []);
  assert.deepStrictEqual([n.x, n.y, l.x, l.y], [10, 60, 20, 70]);
});

t('pino solto (nada ligado) nao cria nada', () => {
  const r = SF.esticaLigacoes(folha({ wires: [{ t: 'wire', pts: [[0, 0], [100, 0]] }] }), [{ num: '1', de: { x: 500, y: 500 }, para: { x: 500, y: 550 } }], []);
  assert.deepStrictEqual(r, { ligacoes: 0, novos: [] });
});

/* dois pinos que trocam de lugar: o plano e feito na folha de ANTES, nada anda duas vezes */
t('pinos que trocam de lugar nao andam duas vezes', () => {
  const a = { t: 'power', x: 0, y: 100 }, b = { t: 'power', x: 0, y: -100 };
  SF.esticaLigacoes(folha({ powers: [a, b] }),
    [{ num: '1', de: { x: 0, y: 100 }, para: { x: 0, y: -100 } }, { num: '2', de: { x: 0, y: -100 }, para: { x: 0, y: 100 } }], []);
  assert.deepStrictEqual([a.y, b.y], [-100, 100]);
});

/* o caso real inteiro: C15 com os pinos de +-100 trocado por +-150, depois do encaixe de -50 */
t('C15 do PBIDP: o encaixe religa o pino 1 e o esticar religa o pino 2', () => {
  const antes = [{ num: '1', x: 1200, y: 5100 }, { num: '2', x: 1200, y: 4900 }];
  const novo = [{ num: '1', x: 1200, y: 5150 }, { num: '2', x: 1200, y: 4850 }];
  const enc = SF.encaixeDaTroca(antes, novo);
  const fim = novo.map(p => ({ num: p.num, x: p.x + enc.dx, y: p.y + enc.dy }));
  const pw = { t: 'power', net: '0VCC', x: 1200, y: 4900, rot: 270 }, w = { t: 'wire', pts: [[800, 5100], [1600, 5100]] };
  const r = SF.esticaLigacoes(folha({ wires: [w], powers: [pw] }), SF.movimentosDosPinos(antes, fim), []);
  assert.strictEqual(r.ligacoes, 1);
  const pinos = fim.map(p => [p.x, p.y]);
  assert.ok(pinos.some(p => p[0] === pw.x && p[1] === pw.y), 'o 0VCC esta num pino: ' + JSON.stringify([pw, pinos]));
});

/* a ponte da vista chama as duas depois do encaixe */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'schframe.js'), 'utf8');
t('__hubAplicaVinculos estica depois do encaixe', () => {
  const i = SRC.indexOf('window.__hubAplicaVinculos = function');
  const corpo = SRC.slice(i, SRC.indexOf('\n};', i));
  assert.ok(corpo.indexOf('encaixeDaTroca(') >= 0 && corpo.indexOf('esticaLigacoes(') > corpo.indexOf('encaixeDaTroca('), 'esticaLigacoes depois do encaixe');
  assert.ok(/esticados/.test(corpo), 'a resposta diz quem foi esticado');
});
console.log('test-estica-troca: ' + ok + ' ok');
