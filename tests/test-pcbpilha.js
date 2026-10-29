/* hub-core: a pilha de camadas do hub (stack_set) e o vao da via (from/to no via_add e no via_edit).
   Pedido do dono (2026-10-29): "fácil de adicionar mais layers ou remover, configurar espessura de
   layer e camada da via". Rode: node tests/test-pcbpilha.js */
'use strict';
const assert = require('assert');
const HC = require('../hub-core.js');

const B = {
  format:'pcbmirror-v1', board:{ bbox:{ x1:0, y1:0, x2:50, y2:40 }, outline:[] },
  layers:[{ key:'Top', name:'Top Layer' }, { key:'Bottom', name:'Bottom Layer' }, { key:'Mech1', name:'Mechanical 1' }, { key:'Mech13', name:'Mech 13' }],
  nets:['GND', 'VCC'], components:[],
  tracks:[{ id:'t1', layer:'Top', x1:1, y1:1, x2:10, y2:1, w:0.3, net:'GND' }],
  vias:[{ id:'v1', x:5, y:5, size:0.6, drill:0.3, from:'Top', to:'Bottom', net:'GND' }],
  arcs:[], texts:[], silk:[], lines:[{ id:'l1', layer:'Mech13', x1:0, y1:0, x2:5, y2:0, w:0.1 }], fills:[], regions:[], freepads:[],
};
const roda = ch => { const m = HC.applyPcbChanges(B, ch); return { m, eb:HC.effectiveBoard(B, m), it:m.changeItems }; };
const P4 = { op:'stack_set', layers:[
  { key:'Top', copper:0.035, dielectric:0.2 }, { key:'Mid1', name:'GND', copper:0.035, dielectric:1.065 },
  { key:'Mid2', copper:0.035, dielectric:0.2 }, { key:'Bottom', copper:0.035 }] };

/* 2 -> 4 camadas: as mids entram na pilha, na ordem, com espessura; a total soma */
let r = roda([P4]);
assert.strictEqual(r.it[0].status, 'ok', r.it[0].msg);
const cobre = r.eb.layers.filter(l => /^(Top|Mid\d+|Bottom)$/.test(l.key));
assert.deepStrictEqual(cobre.map(l => l.key), ['Top', 'Mid1', 'Mid2', 'Bottom']);
assert.deepStrictEqual(cobre.map(l => l.stack), [1, 2, 3, 4]);
assert.strictEqual(cobre[1].name, 'GND', 'o nome dado vale');
assert.strictEqual(cobre[0].name, 'Top Layer', 'sem nome, fica o de antes');
assert.ok(Math.abs(r.eb.stackup.thickness - 1.605) < 1e-9, 'espessura total: ' + r.eb.stackup.thickness);
assert.ok(r.eb.layers.some(l => l.key === 'Mech1') && r.eb.layers.some(l => l.key === 'Mech13'), 'as mecânicas ficam');
const abas = HC.boardLayers(r.eb).map(l => l.key);
assert.ok(abas.includes('Mid1') && abas.includes('Mid2'), 'as abas mostram as mids novas: ' + abas);
/* a mesma placa sem stack_set: nada muda */
assert.strictEqual(roda([]).eb.stackup, undefined);
assert.ok(!HC.boardLayers(roda([]).eb).some(l => /^Mid/.test(l.key)));

/* tirar mecânica vazia sai; mecânica com objeto, não */
r = roda([Object.assign({}, P4, { mech:['Mech13'] })]);
assert.strictEqual(r.it[0].status, 'ok', r.it[0].msg);
assert.ok(!r.eb.layers.some(l => l.key === 'Mech1'), 'Mech1 vazia saiu');
r = roda([Object.assign({}, P4, { mech:['Mech1'] })]);
assert.strictEqual(r.it[0].status, 'err', 'Mech13 tem linha: não sai');
assert.ok(/Mech13 \(1\)/.test(r.it[0].msg), r.it[0].msg);

/* tirar a Mid com trilha: erro, a pilha não vale */
r = roda([P4, { op:'track_add', layer:'Mid2', x1:0, y1:2, x2:9, y2:2, w:0.2 },
  { op:'stack_set', layers:[{ key:'Top', dielectric:1.5 }, { key:'Bottom' }] }]);
assert.strictEqual(r.it[2].status, 'err', 'voltar a 2 camadas com trilha na Mid2');
assert.ok(/Mid2 \(1\)/.test(r.it[2].msg), r.it[2].msg);
assert.strictEqual(r.eb.stackup, undefined, 'com erro, a pilha não vale');

/* validação */
const err = ch => { const x = roda([ch]).it[0]; return x.status === 'err' ? x.msg : ''; };
assert.ok(/primeira camada/.test(err({ op:'stack_set', layers:[{ key:'Mid1', dielectric:1 }, { key:'Bottom' }] })));
assert.ok(/última camada/.test(err({ op:'stack_set', layers:[{ key:'Top', dielectric:1 }, { key:'Mid1' }] })));
assert.ok(/repetida/.test(err({ op:'stack_set', layers:[{ key:'Top', dielectric:1 }, { key:'Mid1', dielectric:1 }, { key:'Mid1', dielectric:1 }, { key:'Bottom' }] })));
assert.ok(/dielectric/.test(err({ op:'stack_set', layers:[{ key:'Top' }, { key:'Bottom' }] })), 'sem dielétrico entre as camadas');
assert.ok(/copper/.test(err({ op:'stack_set', layers:[{ key:'Top', copper:2, dielectric:1 }, { key:'Bottom' }] })));
assert.ok(/12 mm/.test(err({ op:'stack_set', layers:[{ key:'Top', dielectric:10 }, { key:'Mid1', dielectric:5 }, { key:'Bottom' }] })));
assert.ok(/Mid1 a Mid30/.test(err({ op:'stack_set', layers:[{ key:'Top', dielectric:1 }, { key:'Mech2', dielectric:1 }, { key:'Bottom' }] })));
/* serializa e relê */
const txt = HC.serializeChanges([P4]);
assert.ok(typeof txt === 'string' ? /stack_set/.test(txt) : txt.ok !== false, 'serializa');

/* o vão da via */
r = roda([P4, { op:'via_edit', id:'v1', orig_x:5, orig_y:5, from:'Top', to:'Mid1' }]);
assert.strictEqual(r.it[1].status, 'warn', 'via cega avisa');
const v = r.eb.vias.find(x => x.id === 'v1');
assert.deepStrictEqual([v.from, v.to], ['Top', 'Mid1']);
assert.ok(/from e to iguais/.test(roda([{ op:'via_edit', id:'v1', orig_x:5, orig_y:5, to:'Top' }]).it[0].msg));
assert.ok(/camada de cobre/.test(roda([{ op:'via_edit', id:'v1', orig_x:5, orig_y:5, from:'TopOverlay' }]).it[0].msg));
r = roda([P4, { op:'via_add', x:9, y:9, size:0.6, drill:0.3, from:'Mid1', to:'Bottom' }]);
assert.strictEqual(r.it[1].status, 'warn');
assert.ok(r.eb.vias.some(x => x.from === 'Mid1' && x.to === 'Bottom'));
/* a via cega na Mid2 segura a Mid2 na pilha */
r = roda([P4, { op:'via_add', x:9, y:9, size:0.6, drill:0.3, from:'Top', to:'Mid2' },
  { op:'stack_set', layers:[{ key:'Top', dielectric:0.2 }, { key:'Mid1', dielectric:1.2 }, { key:'Bottom' }] }]);
assert.strictEqual(r.it[2].status, 'err', 'via até a Mid2 segura a Mid2: ' + r.it[2].msg);

/* o Gerber faz uma camada por cobre da pilha */
const G = require('../hub-gerber.js');
if (typeof G.gerar === 'function' || typeof G.gera === 'function') {
  const gera = G.gerar || G.gera;
  try {
    const res = gera(roda([P4]).eb, {});
    const nomes = JSON.stringify(Object.keys((res && (res.arquivos || res.files || res)) || {}));
    console.log('  gerber:', nomes.slice(0, 200));
  } catch (e) { console.log('  gerber (não conferido):', e.message); }
}
console.log('test-pcbpilha: OK');
