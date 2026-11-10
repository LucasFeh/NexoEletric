/* O corpo 3D da biblioteca achado pelo nome do footprint com caractere especial (1.92.1).
   O dono (2026-11-10): "o 3D mesmo posicionado nao aparece no footprint, como e o caso do ESP32-WROOM-32D -
   pads 1-38 com expansao de mascara 0,05 mm (ponte de mascara 0,27 mm no passo 1,27)" e "verifica se nao e
   caractere especial". O nome com virgula, parenteses, barra, acento, °, µ, Ω, ±, &, #, %, + e aspas casa
   byte a byte e o modelo sai com a URL do STEP (o arquivo e 3d/<checksum>.step: o nome do modelo nao entra
   no caminho). O que nao casava byte a byte -- NBSP, zero-width, BOM, espaco no fim ou repetido, acento
   decomposto (NFD) -- agora casa pelo nome normalizado; maiuscula e pontuacao continuam valendo.
   (A outra metade do caso -- o STEP apagado do cache do %TEMP% -- e o tests/test_lib3d_servidor.py.)
   Rode: node tests/test-pcb3d-nomes.js */
'use strict';
const assert = require('assert');
const M = require('../hub-pcb3d-modelo.js');
const FL = require('../hub-fplib.js');

let ok = 0;
const t = (nome, fn) => { try { fn(); ok++; } catch (e) { e.message = nome + ': ' + e.message; throw e; } };

const ESP32 = 'ESP32-WROOM-32D - pads 1-38 com expansao de mascara 0,05 mm (ponte de mascara 0,27 mm no passo 1,27)';
const NOMES = [ESP32, 'FP-ESP32-WROOM-32D-MFG', 'TO–220AB', 'CONE MKDS 1,5/ 4-5,08', 'TSSOP-14_P0.65 (PW)', 'BOBINA POLARIZAÇÃO',
  'RES 5W 10Ω ±5% (85°C) µ #1 & 2+3;x', 'DISPLAY OLED 256X64 3.2"', "CAP 'A'", 'BC-337/548/558', 'BARRA\\2'];
const corpo = (mid) => ({ kind:'step', side:'top', model:mid, name:mid + '.STEP', color:'#808080', opacity:1,
  raw:{ x2d:1.0639, y2d:2.3817, rot2d:0, rotx:0, roty:0, rotz:360, dz:0 } });
const lib = { format:'pcblib3d-v1', footprints:{}, models:{} };
NOMES.forEach((n, i) => {
  lib.footprints[n] = { bodies:[corpo('{M' + i + '}')] };
  lib.models['{M' + i + '}'] = { file:'3d/' + (2475317612 + i) + '.step', name:n + ' (modelo, ç, 1,27).STEP' };
});
const comp = (fp, ref) => ({ ref:ref || 'U1', footprint:fp, x:10, y:20, rot:0, layer:'Top', pads:[] });
const um = (fp, op) => M.corpos({ components:[comp(fp)] }, null, Object.assign({ pcblib3d:lib, placeholder:false }, op || {}));

t('cada nome com caractere especial acha o corpo e a URL do STEP', () => {
  NOMES.forEach((n, i) => {
    const L = um(n);
    assert.strictEqual(L.length, 1, JSON.stringify(n));
    assert.strictEqual(L[0].kind, 'step');
    assert.strictEqual(L[0].modelUrl, 'Libs/3d/' + (2475317612 + i) + '.step', 'o caminho e o checksum, nunca o nome do modelo');
    assert.strictEqual(L[0].origem, 'biblioteca');
  });
});
t('NBSP, zero-width, BOM, espaco no fim e repetido casam pelo nome normalizado', () => {
  for (const v of ['ESP32-WROOM-32D - pads 1-38 com expansao de mascara 0,05 mm (ponte de mascara 0,27 mm no passo 1,27)',
                   '﻿' + ESP32, ESP32 + ' ', ESP32.replace(' - ', '  -  '), ESP32.replace('pads', 'pa​ds')]) {
    const L = um(v);
    assert.strictEqual(L.length, 1, JSON.stringify(v));
    assert.strictEqual(L[0].modelUrl, 'Libs/3d/2475317612.step');
  }
});
t('acento decomposto (NFD) casa com o composto (NFC)', () => {
  const L = um('BOBINA POLARIZAÇÃO');
  assert.strictEqual(L.length, 1);
  assert.strictEqual(L[0].modelUrl, 'Libs/3d/' + (2475317612 + 5) + '.step');
});
t('maiuscula e pontuacao continuam diferentes (sem corpo de outro footprint)', () => {
  assert.strictEqual(um('esp32-wroom-32d - pads 1-38 com expansao de mascara 0,05 mm (ponte de mascara 0,27 mm no passo 1,27)').length, 0);
  assert.strictEqual(um('CONE MKDS 1.5/ 4-5.08').length, 0);
  assert.strictEqual(um('TO-220AB').length, 0, 'hifen nao e o travessao');
});
t('o nome exato vence o normalizado', () => {
  const l2 = { footprints:{ 'A B':{ bodies:[corpo('{X}')] }, 'A B':{ bodies:[corpo('{Y}')] } }, models:{ '{X}':{ file:'3d/1.step' }, '{Y}':{ file:'3d/2.step' } } };
  assert.strictEqual(M.corpos({ components:[comp('A B')] }, null, { pcblib3d:l2, placeholder:false })[0].modelUrl, 'Libs/3d/2.step');
  assert.strictEqual(M.corpos({ components:[comp('A B')] }, null, { pcblib3d:l2, placeholder:false })[0].modelUrl, 'Libs/3d/1.step');
});
t('o footprint do hub (pcblib-hub.js) com o nome longo e a solda tambem casam', () => {
  const hub = FL.lib3d({ footprints:[{ name:ESP32, pads:[], bodies:[corpo('{H}')], solda:true }], models:{ '{H}':{ file:'3d-hub/abc.step', name:'Peça (1,5) °µΩ.step' } } });
  const c = Object.assign(comp(ESP32 + ' '), { pads:[{ name:'1', x:10, y:20, w:1.6, h:1.6, drill:0.9, type:'th', layer:'Multi' }] });
  const L = M.corpos({ components:[c] }, null, { pcblib3dHub:hub, placeholder:false });
  const s = L.find(b => b.kind === 'step');
  assert.ok(s, JSON.stringify(L));
  assert.strictEqual(s.modelUrl, 'Libs/3d-hub/abc.step');
  assert.strictEqual(s.origem, 'hub');
  assert.ok(L.some(b => b.kind === 'solda'), 'a solda do footprint do hub tambem vale pelo nome normalizado');
});
t('achaNome: nada para nome vazio, nulo ou mapa vazio', () => {
  assert.strictEqual(M.achaNome(null, 'x'), null);
  assert.strictEqual(M.achaNome({ x:1 }, ''), null);
  assert.strictEqual(M.achaNome({ x:1 }, null), null);
  assert.strictEqual(M.achaNome({ '': 1 }, '​'), null);
  assert.strictEqual(M.achaNome({ toString:1 }, 'hasOwnProperty'), null, 'nada do prototipo');
});
console.log('test-pcb3d-nomes: ' + ok + ' ok');
