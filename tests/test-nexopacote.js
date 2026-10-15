// hub-nexopacote.js: o pacote da placa para o NexoCAD (eletrichub-placa-v1, docs/INTEGRACAO-NEXOCAD.md §4)
//   - da placa efetiva do _DemoKit (board.js + changes.js pelo HubCore): contorno, furos, componentes;
//   - Z = 0 na face de BAIXO: corpo de Top sobe a espessura, corpo de Bottom fica entre 0 e -altura;
//   - contorno com arco vira bulge (o mesmo do outline_set) e o circulo inteiro, duas meias-voltas;
//   - corpo STEP leva a chave do modelo e o modelo entra uma vez so em `modelos`, com a url do hub;
//   - conector: pelo designador (J, CN, X, P, USB, CON) ou pad passante que passa da borda.
const assert = require('assert');
const path = require('path');
const R = path.join(__dirname, '..');
const { loadVar } = require('./load.js');
const HC = require(path.join(R, 'hub-core.js'));
const M3 = require(path.join(R, 'hub-pcb3d-modelo.js'));
const NP = require(path.join(R, 'hub-nexopacote.js'));
const HN = require(path.join(R, 'hub-nexo.js'));
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, (m || '') + ': ' + a + ' != ' + b);

/* ---- o _DemoKit ---- */
const board = loadVar('Projects/_DemoKit/board.js', 'pcbmirror');
const changes = loadVar('Projects/_DemoKit/changes.js', 'changes');
const eb = HC.effectiveBoard(board, HC.applyPcbChanges(board, changes));
const { pacote, avisos } = NP.monta(eb, { projeto:'_DemoKit', corpos:M3.corpos(eb, null, {}), gerado:'2026-10-15T13:00:00Z' });
assert.strictEqual(pacote.format, 'eletrichub-placa-v1');
assert.strictEqual(pacote.espessura, 1.6);
assert.deepStrictEqual(pacote.contorno, [[[0, 0], [30, 0], [30, 20], [0, 20]]]);
assert.strictEqual(pacote.componentes.length, eb.components.length);
const p1 = pacote.componentes.find(c => c.ref === 'P1');
assert.strictEqual(p1.conector, true, 'P1 e conector pelo designador');
assert.strictEqual(pacote.componentes.find(c => c.ref === 'R1').conector, false);
assert.strictEqual(pacote.furos.filter(f => f.tipo === 'pth').length, 2, 'os dois pads passantes do P1');
assert.strictEqual(pacote.furos.some(f => f.tipo === 'via'), false, 'via fica de fora por padrao');
assert.ok(NP.monta(eb, { vias:true }).pacote.furos.some(f => f.tipo === 'via'), 'vias:true as poe');
assert.ok(p1.corpos.length === 1 && p1.corpos[0].tipo === 'extrudado' && p1.corpos[0].z0 === 1.6, 'placeholder de Top a partir da face de cima (z=esp)');
assert.deepStrictEqual(avisos, []);
JSON.parse(JSON.stringify(pacote));

/* ---- contorno com arco e circulo ---- */
const outline = [
  { kind:'line', x1:0, y1:0, x2:80, y2:0 },
  { kind:'line', x1:80, y1:0, x2:80, y2:55 },
  { kind:'arc', cx:75, cy:55, r:5, sa:0, ea:90 },          /* canto arredondado */
  { kind:'line', x1:0, y1:60, x2:75, y2:60 },               /* sentido invertido de proposito */
  { kind:'line', x1:0, y1:60, x2:0, y2:0 },
  { kind:'arc', cx:40, cy:30, r:3, sa:0, ea:360 },          /* furo redondo no contorno */
];
const L = NP.contornoDe(outline);
assert.strictEqual(L.length, 2);
assert.strictEqual(L[0].length, 5, 'externo primeiro');
const comBulge = L[0].find(v => v.length === 3);
near(Math.abs(comBulge[2]), Math.tan(Math.PI / 8), 'bulge do canto de 90');
assert.ok(comBulge[0] === 80 && comBulge[1] === 55 && comBulge[2] > 0, 'anti-horario, partindo de (80,55)');
const pts = HC.ptsToOutline(L[0]);
const arco = pts.find(s => s.kind === 'arc');
near(arco.cx, 75, 'o bulge volta ao mesmo arco'); near(arco.cy, 55); near(arco.r, 5);
assert.strictEqual(L[1].length, 2); assert.ok(L[1].every(v => v[2] === 1), 'circulo = duas meias-voltas de bulge 1');

/* ---- corpos STEP, Top e Bottom, com o NexoCAD por cima ---- */
const nx = HN.resolvedorDe({ revisao:1, itens:[{ id:'el-x', nome:'X', categoria:'Eletrônicos', rev:3, arquivos:{ step:'s' }, eletronico:{ footprints:['SOT23'] } }] });
const raw = { x2d:0, y2d:0, rot2d:0, rotx:0, roty:0, rotz:0, dz:0 };
const hub = { footprints:{ R0805:{ bodies:[{ kind:'step', model:'abc', name:'R0805.step', side:'top', raw }] } }, models:{ abc:{ file:'3d-hub/abc.step', name:'R0805.step' } } };
const eb2 = { board:{ bbox:{ x1:0, y1:0, x2:30, y2:20 }, outline:outline.slice(0, 5).map(s => s) },
  cutouts:[{ id:'k1', layer:'Multi', points:[[10, 10], [12, 10], [12, 12], [10, 12]] }, { id:'k2', layer:'Multi', kindn:-1, points:[[0, 0], [1, 0], [1, 1]] }],
  freepads:[{ id:'p1', type:'th', x:3.5, y:3.5, w:3.2, h:3.2, drill:3.2 }],
  components:[
    { ref:'R1', footprint:'R0805', x:10, y:10, rot:0, layer:'Top', pads:[] },
    { ref:'R2', footprint:'R0805', x:20, y:10, rot:0, layer:'Bottom', pads:[] },
    { ref:'U1', footprint:'SOT23', x:5, y:15, rot:90, layer:'Top', pads:[] },
    { ref:'K1', footprint:'BORNE', x:79, y:30, rot:0, layer:'Top', bbox:{ x1:76, y1:27, x2:83, y2:33 }, pads:[{ type:'th', layer:'Multi', x:79, y:30, w:2, h:2, drill:1.2 }] },
  ] };
const c2 = M3.corpos(eb2, null, { pcblib3dHub:hub, nexo:nx, baseLib:'Libs/' });
const r2 = NP.monta(eb2, { projeto:'P', corpos:c2, espessura:1.6 });
const P2 = r2.pacote;
const cr = ref => P2.componentes.find(c => c.ref === ref);
assert.strictEqual(cr('R1').corpos[0].modelo, '3d-hub/abc.step');
near(cr('R1').corpos[0].matriz[14], 1.6, 'Top: a origem do corpo na face de cima (z = espessura)');
near(cr('R2').corpos[0].matriz[14], 0, 'Bottom: na face de baixo (z = 0)');
near(cr('R2').corpos[0].matriz[10], -1, 'Bottom: virado (Rx 180)');
assert.strictEqual(Object.keys(P2.modelos).length, 2, 'um modelo por chave, nao por instancia');
assert.strictEqual(P2.modelos['3d-hub/abc.step'].url, '/Libs/3d-hub/abc.step');
assert.ok(/^modelos\/R0805\.step$/.test(P2.modelos['3d-hub/abc.step'].arquivo));
assert.strictEqual(cr('U1').corpos[0].modelo, 'nexo:el-x', 'U1 pelo vinculo do footprint');
assert.strictEqual(P2.modelos['nexo:el-x'].url, '/api/nexo/arquivo/el-x/modelo.step');
assert.strictEqual(cr('K1').conector, true, 'pad passante que passa da borda');
assert.deepStrictEqual(P2.recortes, [[[10, 10], [12, 10], [12, 12], [10, 12]]], 'o recorte da placa inteira (kindn -1) fica de fora');
assert.deepStrictEqual(P2.furos.find(f => f.x === 3.5), { x:3.5, y:3.5, d:3.2, tipo:'npth' }, 'furo do tamanho do cobre = fixacao (npth)');
assert.strictEqual(NP.monta(eb2, { corpos:[{ owner:'R1', kind:'step', model:'q', matrix:new Array(16).fill(0) }] }).avisos.length, 1, 'STEP sem arquivo vira aviso');

console.log('test-nexopacote: ok');
