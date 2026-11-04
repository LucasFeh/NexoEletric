/* O componente posto depois do Altium (comp_add) pega o corpo 3D do irmao de mesmo footprint na placa (1.64.0).
   No PLACAB_DI251885B o IC16 (TMCS1123A1AQDVGR, comp_add) saia como caixa generica e o IC1/IC12-14 (o mesmo
   footprint, vindos do Altium) com o corpo do board3d.js: o board3d so tem corpo para quem veio do Altium, o
   footprint do hub nao tinha corpo e a PcbLib 3D da casa nao tinha o footprint. Agora, sem corpo proprio, o
   componente usa o corpo de um irmao da mesma placa com o mesmo footprint, levado da pose do irmao para a dele.
   Rode: node tests/test-pcb3d-irmao.js */
'use strict';
const assert = require('assert');
const M = require('../hub-pcb3d-modelo.js');

const perto = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-6, (msg || '') + ' ' + a + ' != ' + b);
let ok = 0;
const t = (nome, fn) => { fn(); ok++; };

/* o corpo do IC1 no board3d: um STEP 2 mm a direita da origem do componente (em coordenadas da placa) */
const IC1 = { x:10, y:20, rot:0, layer:'Top', footprint:'TMCS' };
const d3 = {
  format:'pcb3d-v1', units:'mm', thickness:1.6,
  componentes:{ IC1 },
  bodies:[{ owner:'IC1', side:'top', kind:'step', layer:'Mech1', model:'{G}', name:'TMCS.stp', color:'#808080', opacity:1,
            matrix:[1,0,0,0, 0,1,0,0, 0,0,1,0, 12,20,0,1] }],
  models:{ '{G}':{ file:'3d/123.step', name:'TMCS.stp' } },
};
const eb = c16 => ({ components:[Object.assign({ ref:'IC1' }, IC1), Object.assign({ ref:'IC16', footprint:'TMCS', layer:'Top' }, c16)] });
const de = (L, ref) => L.filter(b => b.owner === ref);

t('o comp_add de mesmo footprint ganha o corpo do irmao, na pose dele', () => {
  const L = M.corpos(eb({ x:50, y:40, rot:0 }), d3, { placeholder:false });
  const [b] = de(L, 'IC16');
  assert.ok(b, 'o IC16 tem corpo: ' + JSON.stringify(L.map(x => x.owner)));
  assert.strictEqual(b.kind, 'step');
  assert.strictEqual(b.modeloChave || b.model, de(L, 'IC1')[0].modeloChave || de(L, 'IC1')[0].model, 'o mesmo modelo do IC1');
  perto(b.matrix[12], 52, 'x: 2 mm a direita da origem do IC16'); perto(b.matrix[13], 40, 'y');
});
t('girado: o deslocamento gira junto', () => {
  const [b] = de(M.corpos(eb({ x:50, y:40, rot:90 }), d3, { placeholder:false }), 'IC16');
  perto(b.matrix[12], 50, 'x'); perto(b.matrix[13], 42, 'y: os 2 mm viram +Y');
});
t('em baixo: o corpo vai para a outra face', () => {
  const [b] = de(M.corpos(eb({ x:50, y:40, rot:0, layer:'Bottom' }), d3, { placeholder:false }), 'IC16');
  assert.strictEqual(b.side, 'bottom');
  perto(b.matrix[14], -1.6, 'z: a face de baixo');
});
t('footprint diferente nao empresta (sem corpo, sem placeholder)', () => {
  const L = M.corpos({ components:[Object.assign({ ref:'IC1' }, IC1), { ref:'U9', footprint:'OUTRO', x:5, y:5, rot:0, layer:'Top' }] }, d3, { placeholder:false });
  assert.strictEqual(de(L, 'U9').length, 0);
});
t('o corpo do proprio componente continua mandando', () => {
  const L = M.corpos({ components:[Object.assign({ ref:'IC1' }, IC1)] }, d3, { placeholder:false });
  const [b] = de(L, 'IC1');
  perto(b.matrix[12], 12); assert.strictEqual(b.origem, 'board3d');
});
console.log('test-pcb3d-irmao: ' + ok + ' ok');
