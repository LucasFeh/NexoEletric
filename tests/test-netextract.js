const assert = require('assert');
const { loadVar } = require('./load');
const Core = require('../hub-core.js');

const sch = loadVar('Projects/_DemoKit/schematic.js', 'schematic');
const lib = loadVar('Libs/schlib.js', 'schlib');

// transform: P1 espelhado -> pino 1 na ponta quente (1400,3100)
const p1 = Core.compPinsWorld(sch.items.find(i => i.ref === 'P1'), lib);
const pin1 = p1.find(p => p.num === '1');
assert.ok(Math.abs(pin1.x - 1400) < 0.5 && Math.abs(pin1.y - 3100) < 0.5,
  `P1-1 esperado (1400,3100), veio (${pin1.x},${pin1.y})`);

// transform: C1 rot 90 -> pino 1 em (1800,2700)
const c1 = Core.compPinsWorld(sch.items.find(i => i.ref === 'C1'), lib);
const c1p1 = c1.find(p => p.num === '1');
assert.ok(Math.abs(c1p1.x - 1800) < 0.5 && Math.abs(c1p1.y - 2700) < 0.5,
  `C1-1 esperado (1800,2700), veio (${c1p1.x},${c1p1.y})`);

// extracao de nets do demo (gabarito da Task 2)
const r = Core.extractNets(sch, lib);
const nets = {};
for (const n of r.nets) nets[n.name] = n.pins.slice().sort().join(',');
assert.strictEqual(nets['VCC'],     'C1-2,P1-1,R1-1');
assert.strictEqual(nets['NET_LED'], 'D1-A,R1-2');
assert.strictEqual(nets['GND'],     'C1-1,D1-K,P1-2');  // 3 ilhas unidas por power ports
assert.strictEqual(r.pinNet['R1-2'], 'NET_LED');
assert.strictEqual(r.warnings.length, 0, 'demo não deve gerar warnings: ' + r.warnings.join(' | '));

// wireNet: primeiro fio da folha 0 e VCC
assert.strictEqual(r.wireNet[0][0], 'VCC');

// nome automatico quando nao ha rotulo
const auto = Core.extractNets({ format:'schmirror-v2', project:'t', units:'mil', items:[
  { t:'sheet', name:'m', size:'A4' },
  { t:'comp', sheet:'m', ref:'R1', sym:'RES', part:1, x:1000, y:1000, rot:0, mirror:false, footprint:'R0805' },
  { t:'comp', sheet:'m', ref:'R2', sym:'RES', part:1, x:1800, y:1000, rot:0, mirror:false, footprint:'R0805' },
  { t:'wire', sheet:'m', pts:[[1200,1000],[1600,1000]] }
]}, lib);
assert.strictEqual(auto.nets.length, 1);
assert.ok(auto.nets[0].auto);
assert.strictEqual(auto.nets[0].name, 'NetR1_2');
assert.deepStrictEqual(auto.nets[0].pins.slice().sort(), ['R1-2','R2-1']);

// cruzamento sem junction NAO conecta; com junction conecta
const cross = (withJ) => Core.extractNets({ format:'schmirror-v2', project:'t', units:'mil', items:[
  { t:'sheet', name:'m', size:'A4' },
  { t:'wire', sheet:'m', pts:[[0,100],[200,100]] },
  { t:'wire', sheet:'m', pts:[[100,0],[100,200]] },
  { t:'netlabel', sheet:'m', net:'A', x:0, y:100, rot:0 },
  { t:'netlabel', sheet:'m', net:'B', x:100, y:0, rot:0 },
  ...(withJ ? [{ t:'junction', sheet:'m', x:100, y:100 }] : [])
]}, lib);
assert.strictEqual(cross(false).nets.length, 2, 'cruzamento sem junction deve dar 2 nets');
assert.strictEqual(cross(true).nets.length, 1, 'junction deve unir as 2 nets');

console.log('test-netextract OK');
