/* A caixa do power port e o desenho dele (1.61.1). O power nasce na ancora e cresce SO para o lado da
   rotacao (haste, simbolo e o nome adiante); a caixa era 300x300 centrada na ancora e o clique um raio de
   140 mil, entao no power em cima de um componente (o 0VCC do PBIDP-DI261944, ancora 4300,4800 a 270
   graus, sobre o C25 em 4300,4900) metade da caixa cobria o corpo do componente: a selecao desenhava um
   quadrado gigante e o clique no capacitor pegava o power.

     node tests/test-power-bbox.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const D = require('../hub-draw.js');

const dentro = (b, x, y) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
let ok = 0;
const t = (nome, fn) => { fn(); ok++; };

t('existe e e exportada', () => assert.strictEqual(typeof D.powerBBox, 'function'));

/* o caso da tela: 0VCC PowerGround a 270 graus (para baixo), com o C25 logo acima da ancora */
const ovcc = { net:'0VCC', style:'PowerGround', x:4300, y:4800, rot:270 };
t('nada do outro lado da ancora (o corpo do C25)', () => {
  const b = D.powerBBox(ovcc);
  assert.ok(!dentro(b, 4300, 4900), 'o centro do C25 nao esta na caixa: ' + JSON.stringify(b));
  assert.ok(b.y2 <= 4800 + 10, 'a caixa nao passa da ancora para cima: ' + JSON.stringify(b));
});
t('pega a haste, o simbolo e o nome', () => {
  const b = D.powerBBox(ovcc);
  assert.ok(dentro(b, 4300, 4750), 'haste');
  assert.ok(dentro(b, 4300, 4700), 'barra no fim da haste');
  assert.ok(dentro(b, 4300, 4610), 'o nome, 190 mil adiante');
  assert.ok(dentro(b, 4300 - 60, 4610) && dentro(b, 4300 + 60, 4610), 'o nome inteiro (4 letras)');
});
t('cada rotacao cresce para o seu lado', () => {
  for (const [rot, fora, perto] of [[0, [-60, 0], [60, 0]], [90, [0, -60], [0, 60]], [180, [60, 0], [-60, 0]], [270, [0, 60], [0, -60]]]) {
    const b = D.powerBBox({ net:'GND', style:'Bar', x:1000, y:1000, rot });
    assert.ok(!dentro(b, 1000 + fora[0], 1000 + fora[1]), rot + ' graus: o lado de tras fica fora ' + JSON.stringify(b));
    assert.ok(dentro(b, 1000 + perto[0], 1000 + perto[1]), rot + ' graus: a haste fica dentro ' + JSON.stringify(b));
  }
});
t('terra (Gnd*) tem o nome mais longe', () => {
  const b = D.powerBBox({ net:'GND', style:'GndPower', x:0, y:0, rot:270 });
  assert.ok(dentro(b, 0, -230), 'nome do terra a 230 mil');
});
t('nome comprido alarga a caixa', () => {
  const a = D.powerBBox({ net:'5V', style:'Bar', x:0, y:0, rot:90 });
  const b = D.powerBBox({ net:'+3V3_ANALOGICO', style:'Bar', x:0, y:0, rot:90 });
  assert.ok((b.x2 - b.x1) > (a.x2 - a.x1));
});

/* a vista usa a MESMA caixa no clique e na selecao (nao uma copia da conta) */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'schframe.js'), 'utf8');
t('itemBBox do power vem do desenho', () => assert.ok(/case 'power':\s*return D\.powerBBox\(it\)/.test(SRC)));
t('o clique no power usa a caixa, nao o raio de 140', () => {
  assert.ok(!/Math\.hypot\(x - p\.x, y - p\.y\) <= Math\.max\(tol, 140\)/.test(SRC), 'o raio de 140 mil continua no hitTest');
  assert.ok(/for \(const p of s\.powers\)\{?\s*const b = itemBBox\(p\)/.test(SRC), 'hitTest do power pela itemBBox');
});
console.log('test-power-bbox: ' + ok + ' ok');
