/* O dono do texto na mao (pcbframe.js » donosDoArrasto, 1.61.0): arrastar o designator ou o comment de um
   componente realca o componente dele; texto livre nao realca nada; o componente que anda no mesmo arrasto
   nao se realca de novo; dois textos do mesmo componente realcam uma vez so.

     node tests/test-pcb-dono-designator.js

   Le as funcoes direto do pcbframe.js (ele e um script de pagina). */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pcbframe.js'), 'utf8');
for (const n of ['donosDoArrasto', 'realcaDonosDoArrasto']) {
  const k = SRC.split(new RegExp('function ' + n + '\\(')).length - 1;
  assert.strictEqual(k, 1, 'function ' + n + ' aparece ' + k + ' vez(es) no pcbframe.js');
}
function pega(nome) {
  const i = SRC.indexOf('function ' + nome + '(');
  let d = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    if (SRC[k] === '{') d++;
    else if (SRC[k] === '}' && !--d) return SRC.slice(i, k + 1);
  }
  throw new Error('sem ' + nome);
}
/* o arrasto desenha o realce do dono */
assert.ok(/function desenhaArrasto\(\)[\s\S]*?realcaDonosDoArrasto\(\);[\s\S]*?for \(const a of arrasto\.alvos\)/.test(SRC),
  'desenhaArrasto chama realcaDonosDoArrasto antes da previa');

const R1 = { src:{ ref:'R1' } }, C1 = { src:{ ref:'C1' } };
const aR1 = { t:'comp', m:R1 }, aC1 = { t:'comp', m:C1 };
const model = { compByRef:{ R1, C1 } };
const ALVO_COMP = new Map([[R1, aR1], [C1, aC1]]);
const compDoDono = () => null;
const realces = [];
const realcaAlvo = (a, cor, forte) => realces.push({ a, cor, forte });
const COR = { sel:'#ffffff' };
let arrasto = null;
const F = new Function('model', 'ALVO_COMP', 'compDoDono', 'realcaAlvo', 'COR', 'getArrasto',
  pega('donosDoArrasto') + '\n' + pega('realcaDonosDoArrasto').replace(/arrasto\.alvos/g, 'getArrasto().alvos') +
  '\nreturn { donosDoArrasto, realcaDonosDoArrasto };')(model, ALVO_COMP, compDoDono, realcaAlvo, COR, () => arrasto);

const txt = src => ({ t:'text', m:{ src } });
const desR1 = txt({ id:'x1', designator:true, comment:false, owner:'R1' });
const comR1 = txt({ id:'x2', designator:false, comment:true, owner:'R1' });
const desC1 = txt({ id:'x3', designator:true, comment:false, owner:'C1' });
const livre = txt({ id:'x4', designator:false, comment:false });
const doFp  = txt({ id:'x5', designator:false, comment:false, owner:'R1' });

let ok = 0;
const t = (nome, fn) => { fn(); ok++; };
t('designator arrastado realca o componente dele', () => assert.deepStrictEqual(F.donosDoArrasto([desR1]), [aR1]));
t('comment tambem', () => assert.deepStrictEqual(F.donosDoArrasto([comR1]), [aR1]));
t('designator e comment do mesmo componente: um realce', () => assert.deepStrictEqual(F.donosDoArrasto([desR1, comR1]), [aR1]));
t('dois componentes', () => assert.deepStrictEqual(F.donosDoArrasto([desR1, desC1]), [aR1, aC1]));
t('texto livre e texto do footprint nao realcam', () => assert.deepStrictEqual(F.donosDoArrasto([livre, doFp]), []));
t('componente que anda junto nao se realca', () => assert.deepStrictEqual(F.donosDoArrasto([aR1, desR1, desC1]), [aC1]));
t('dono que nao existe mais', () => assert.deepStrictEqual(F.donosDoArrasto([txt({ designator:true, owner:'U9' })]), []));
t('o desenho usa a cor da selecao, forte', () => {
  arrasto = { alvos:[desR1] }; realces.length = 0;
  F.realcaDonosDoArrasto();
  assert.deepStrictEqual(realces, [{ a:aR1, cor:'#ffffff', forte:true }]);
});
console.log('test-pcb-dono-designator: ' + ok + ' ok');
