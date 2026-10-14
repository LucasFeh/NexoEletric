// hub-fplib.js (a biblioteca de footprints do hub) e o corpo 3D dela no HubPcb3dModelo:
//   - mescla: o footprint do hub passa na frente do do Altium com o mesmo nome, o resto do Altium fica;
//   - serializa: volta igual (var pcblibHub = {...}), com o bbox recalculado;
//   - valida: recusa o que o ECO e a vista 3D nao conseguem usar;
//   - tira: o modelo STEP que ninguem mais usa sai do indice;
//   - HubPcb3dModelo.corpos: o corpo do hub vale mais que o board3d e o pcblib3d, e anda com o componente.
const assert = require('assert');
const path = require('path');
const R = path.join(__dirname, '..');
const HF = require(path.join(R, 'hub-fplib.js'));
const M3 = require(path.join(R, 'hub-pcb3d-modelo.js'));

const altium = { format:'pcblib-v2', units:'mm', footprints:[
  { name:'R0805', pads:[{ name:'1', type:'smd', shape:'rect', x:-1, y:0, w:1, h:1.3, rot:0, layer:'Top' }], silk:[] },
  { name:'SOT23', pads:[], silk:[] },
] };
const r0805hub = { name:'R0805', description:'do hub', pads:[
  { name:'1', type:'smd', shape:'rect', x:-0.95, y:0, w:1.1, h:1.4, rot:0, layer:'Top' },
  { name:'2', type:'smd', shape:'rect', x:0.95, y:0, w:1.1, h:1.4, rot:0, layer:'Top' }],
  silk:[{ kind:'line', x1:-0.3, y1:0.8, x2:0.3, y2:0.8, w:0.15 }],
  bodies:[{ kind:'step', model:'abc', name:'r.step', side:'top', raw:{ x2d:0, y2d:0, rot2d:0, rotx:0, roty:0, rotz:0, dz:0 }, color:'#333333', opacity:1 }] };
const hub = HF.normaliza({ footprints:[r0805hub, { name:'SO8_HUB', pads:[], silk:[], bodies:[] }],
                           models:{ abc:{ file:'3d-hub/abc.step', name:'r.step', bytes:10 }, velho:{ file:'3d-hub/velho.step' } } });

/* mescla */
const m = HF.mescla(altium, hub);
assert.strictEqual(m.footprints.filter(f => f.name === 'R0805').length, 1, 'um R0805 so');
assert.strictEqual(m.footprints.find(f => f.name === 'R0805').description, 'do hub', 'o do hub na frente');
assert.ok(m.footprints.some(f => f.name === 'SOT23'), 'o resto do Altium fica');
assert.ok(m.footprints.some(f => f.name === 'SO8_HUB'), 'o novo do hub entra');
assert.strictEqual(altium.footprints.length, 2, 'o espelho do Altium nao muda');
assert.strictEqual(HF.mescla(altium, HF.vazia()), altium, 'hub vazio: o do Altium inteiro');
assert.deepStrictEqual(HF.mescla(m, hub).footprints.map(f => f.name), m.footprints.map(f => f.name), 'mesclar de novo nao duplica');

/* lib3d */
const l3 = HF.lib3d(hub);
assert.deepStrictEqual(Object.keys(l3.footprints), ['R0805'], 'so quem tem corpo');
assert.strictEqual(l3.models.abc.file, '3d-hub/abc.step');

/* bbox */
assert.deepStrictEqual(HF.bbox(r0805hub), { x1:-1.5, y1:-0.7, x2:1.5, y2:0.875 }, "pads + serigrafia (a linha de cima, com a meia largura)");

/* serializa: volta igual */
const txt = HF.serializa(hub);
assert.ok(/^var pcblibHub = \{/.test(txt), 'var pcblibHub');
const volta = new Function(txt + ';return pcblibHub;')();
assert.strictEqual(volta.format, 'pcblib-hub-v1');
assert.deepStrictEqual(volta.footprints.find(f => f.name === 'R0805').pads, r0805hub.pads);
assert.deepStrictEqual(volta.footprints.find(f => f.name === 'R0805').bbox, HF.bbox(r0805hub));
assert.strictEqual(txt.split('\n').filter(l => /"name":"(R0805|SO8_HUB)"/.test(l)).length, 2, 'uma linha por footprint');

/* valida */
assert.deepStrictEqual(HF.valida(r0805hub), []);
assert.ok(HF.valida({ name:'', pads:[] }).some(e => /nome/.test(e)));
assert.ok(HF.valida({ name:'X', pads:[{ name:'1', type:'th', shape:'circle', x:0, y:0, w:1, h:1, layer:'Multi' }] }).some(e => /sem furo/.test(e)));
assert.ok(HF.valida({ name:'X', pads:[{ name:'1', type:'th', shape:'circle', x:0, y:0, w:1, h:1, drill:1.2, layer:'Multi' }] }).some(e => /maior que o pad/.test(e)));
assert.ok(HF.valida({ name:'X', pads:[], bodies:[{ kind:'extruded', pts:[[0, 0], [1, 0]], height:1 }] }).some(e => /3 pontos/.test(e)));
assert.ok(HF.valida({ name:'X', pads:[], bodies:[{ kind:'step' }] }).some(e => /STEP/.test(e)));
assert.deepStrictEqual(HF.repetidos({ pads:[{ name:'1' }, { name:'1' }, { name:'2' }] }), ['1']);

/* poe / tira */
const lib = HF.normaliza(JSON.parse(JSON.stringify(hub)));
HF.poe(lib, { name:'AAA', pads:[], silk:[], bodies:[] });
assert.strictEqual(lib.footprints[0].name, 'AAA', 'em ordem de nome');
HF.poe(lib, Object.assign({}, r0805hub, { description:'trocado' }));
assert.strictEqual(lib.footprints.filter(f => f.name === 'R0805').length, 1);
HF.tira(lib, 'SO8_HUB');
assert.ok(!HF.acha(lib, 'SO8_HUB'));
assert.ok(lib.models.abc && !lib.models.velho, 'modelo sem uso sai do indice, o usado fica');

/* o corpo do hub no HubPcb3dModelo: vale mais que o board3d e anda com o componente */
const eb = { components:[{ ref:'R1', footprint:'R0805', x:10, y:5, rot:90, layer:'Top', pads:[] },
                         { ref:'R2', footprint:'R0805', x:20, y:5, rot:0, layer:'Bottom', pads:[] }] };
const d3 = { thickness:1.6, componentes:{ R1:{ x:10, y:5, rot:90, layer:'Top', footprint:'R0805' } },
             bodies:[{ owner:'R1', side:'top', kind:'extruded', pts:[[0, 0], [1, 0], [1, 1]], standoff:0, height:1 }], models:{} };
const cs = M3.corpos(eb, d3, { pcblib3dHub:l3, baseLib:'Libs/' });
const c1 = cs.filter(c => c.owner === 'R1');
assert.strictEqual(c1.length, 1);
assert.strictEqual(c1[0].origem, 'hub', 'o do hub ganha do board3d');
assert.strictEqual(c1[0].modelUrl, 'Libs/3d-hub/abc.step');
/* rot 90 no Top: a origem do modelo vai para (10, 5, 0) */
const M = c1[0].matrix;
assert.ok(Math.abs(M[12] - 10) < 1e-9 && Math.abs(M[13] - 5) < 1e-9 && Math.abs(M[14]) < 1e-9, 'transladado para o componente');
assert.ok(Math.abs(M[0]) < 1e-9 && Math.abs(M[1] - 1) < 1e-9, 'girado 90 graus');
/* no Bottom: desce a espessura e vira de cabeca para baixo */
const c2 = cs.find(c => c.owner === 'R2');
assert.ok(Math.abs(c2.matrix[14] + 1.6) < 1e-9 && Math.abs(c2.matrix[10] + 1) < 1e-9, 'Bottom: Z = -espessura, eixo Z invertido');
/* sem o hub, o board3d volta a valer */
assert.strictEqual(M3.corpos(eb, d3, {}).find(c => c.owner === 'R1').origem, 'board3d');

console.log('test-fplib: ok');
