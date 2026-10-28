const assert = require('assert');
const HubCore = require('../hub-core.js');
const PV = require('../hub-placaviva.js');

/* hub-placaviva.js: a placa que Laser, Neoden e BOM usam e a da vista PCB (board.js + changes.js),
   nao o board.js cru. Placa SINTETICA escrita aqui. */

const board = {
  format: 'pcbmirror-v1', exporter: 'teste', units: 'mm', axis: 'y-up',
  board: { outline: [
    { kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 }, { kind: 'line', x1: 50, y1: 0, x2: 50, y2: 30 },
    { kind: 'line', x1: 50, y1: 30, x2: 0, y2: 30 }, { kind: 'line', x1: 0, y1: 30, x2: 0, y2: 0 } ] },
  nets: ['GND', 'VCC'], layers: [], rules: {},
  components: [
    { ref: 'R1', footprint: 'RES 1206', comment: '10K', layer: 'Top', x: 10, y: 10, rot: 0,
      bbox: { x1: 8, y1: 9, x2: 12, y2: 11 },
      pads: [ { id: 'p1', name: '1', type: 'smd', shape: 'rect', x: 8.5, y: 10, w: 1, h: 1.6, rot: 0, layer: 'Top', net: 'VCC' },
              { id: 'p2', name: '2', type: 'smd', shape: 'rect', x: 11.5, y: 10, w: 1, h: 1.6, rot: 0, layer: 'Top', net: 'GND' } ] },
    { ref: 'C1', footprint: 'CAP 1206', comment: '1uF', layer: 'Top', x: 30, y: 10, rot: 0,
      bbox: { x1: 28, y1: 9, x2: 32, y2: 11 },
      pads: [ { id: 'p3', name: '1', type: 'smd', shape: 'rect', x: 28.5, y: 10, w: 1, h: 1.6, rot: 0, layer: 'Top', net: 'VCC' },
              { id: 'p4', name: '2', type: 'smd', shape: 'rect', x: 31.5, y: 10, w: 1, h: 1.6, rot: 0, layer: 'Top', net: 'GND' } ] },
  ],
  freepads: [], tracks: [], arcs: [], vias: [], texts: [], silk: [], regions: [], cutouts: [],
};

/* 1. leChanges le o arquivo como a vista (var changes = [...] com comentarios) */
const txt = '// AltiumPCBMirror - arquivo de mudancas.\nvar changes = [\n{"op":"comp_move","ref":"R1","x":20,"y":20,"orig_x":10,"orig_y":10,"orig_rot":0,"orig_layer":"Top"},\n];\n';
const ch = PV.leChanges(txt);
assert.strictEqual(ch.length, 1, 'uma mudanca lida');
assert.deepStrictEqual(PV.leChanges(''), []);
assert.deepStrictEqual(PV.leChanges('isto nao e js ('), [], 'arquivo quebrado = sem mudancas, sem excecao');
assert.strictEqual(PV.precisaLib(ch), false);
assert.strictEqual(PV.precisaLib([{ op: 'comp_add' }]), true);

/* 2. efetiva aplica o changes.js: o componente movido sai no lugar novo, com os pads junto */
const eb = PV.efetiva({ board, changes: ch, HubCore });
const r1 = eb.components.find(c => c.ref === 'R1');
assert.ok(Math.abs(r1.x - 20) < 1e-6 && Math.abs(r1.y - 20) < 1e-6, 'R1 no lugar novo: ' + r1.x + ',' + r1.y);
assert.ok(Math.abs(r1.pads[0].x - 18.5) < 1e-6, 'o pad anda com o componente: ' + r1.pads[0].x);
assert.strictEqual(board.components[0].x, 10, 'o board.js cru nao e tocado');
assert.strictEqual(PV.efetiva({ board: null, HubCore }), null);

/* 3. mesclaEsquema: o comment do esquema mais novo vale onde a PCB nao mexeu; onde mexeu, vale a PCB */
const servidor = JSON.parse(JSON.stringify(board));
servidor.components[0].comment = '22K';       /* o esquema trocou o R1 */
servidor.components[1].comment = '2,2uF';     /* e o C1 */
const ebAttr = PV.efetiva({ board, changes: [{ op: 'comp_attr', ref: 'C1', orig_designator: 'C1', orig_comment: '1uF', comment: '4,7uF' }], HubCore });
const m = PV.mesclaEsquema(ebAttr, board, servidor);
assert.strictEqual(m.components.find(c => c.ref === 'R1').comment, '22K', 'R1: o do esquema');
assert.strictEqual(m.components.find(c => c.ref === 'C1').comment, '4,7uF', 'C1: o da PCB (comp_attr)');
assert.strictEqual(ebAttr.components.find(c => c.ref === 'R1').comment, '10K', 'mesclaEsquema nao muda a efetiva');

console.log('test-placaviva: ok');
