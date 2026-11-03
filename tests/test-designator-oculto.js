/* Designator e comment ocultos (1.57.0): designator_move/comment_move com hidden e o des_hidden do
   comp_add. O texto fica no componente e sai marcado hidden na placa efetiva (a tela, o Gerber e o
   DRC ja pulam texto hidden); hidden:false mostra de novo; valor que nao e booleano e erro. O campo
   que a op nao tem aparece no camposSobrando do MCP. */
const assert = require('assert');
const C = require('../hub-core.js');
const ops = require('../mcp/lib/pcb-ops.js');

let ok = 0;
const t = (nome, fn) => { fn(); ok++; };
const pad = { id: 'p1', name: '1', layer: 'Top', type: 'smd', shape: 'rect', x: 10, y: 10, w: 1, h: 1, rot: 0, net: '' };
const placa = () => ({
  exporter: 'teste', nets: [], freepads: [], tracks: [], arcs: [], vias: [], fills: [], regions: [], silk: [], lines: [],
  board: { bbox: { x1: 0, y1: 0, x2: 50, y2: 50 }, outline: [] },
  components: [{ ref: 'R1', footprint: 'R0805', comment: '10k', x: 10, y: 10, rot: 0, layer: 'Top', bbox: { x1: 9, y1: 9, x2: 11, y2: 11 }, pads: [pad] }],
  texts: [
    { id: 'x1', layer: 'TopOverlay', x: 10, y: 12, text: 'R1', h: 1, w: 0.15, rot: 0, designator: true, comment: false, owner: 'R1' },
    { id: 'x2', layer: 'TopOverlay', x: 10, y: 8, text: '10k', h: 1, w: 0.15, rot: 0, designator: false, comment: true, owner: 'R1' },
  ],
});
const erros = m => m.validation.filter(v => v.level === 'err');
const texto = (B, ch, qual) => C.effectiveBoard(B, C.applyPcbChanges(B, ch)).texts.find(x => x[qual] && x.owner === 'R1');

t('designator_move hidden:true oculta', () => {
  const B = placa(), ch = [{ op: 'designator_move', ref: 'R1', orig_x: 10, orig_y: 12, hidden: true }];
  assert.deepStrictEqual(erros(C.applyPcbChanges(B, ch)), []);
  const d = texto(B, ch, 'designator');
  assert.strictEqual(d.hidden, true);
  assert.strictEqual(d.x, 10, 'sem x/y o lugar fica');
});
t('hidden:false mostra', () => {
  const B = placa();
  assert.ok(!texto(B, [{ op: 'designator_move', ref: 'R1', orig_x: 10, orig_y: 12, hidden: false }], 'designator').hidden);
});
t('comment_move hidden e traço', () => {
  const B = placa(), cm = texto(B, [{ op: 'comment_move', ref: 'R1', orig_x: 10, orig_y: 8, hidden: true, w: 0.2 }], 'comment');
  assert.strictEqual(cm.hidden, true);
  assert.strictEqual(cm.w, 0.2);
});
t('hidden que não é booleano é erro', () => {
  const B = placa(), m = C.applyPcbChanges(B, [{ op: 'designator_move', ref: 'R1', orig_x: 10, orig_y: 12, hidden: 'sim' }]);
  assert.ok(/hidden deve ser true/.test(erros(m)[0].msg), JSON.stringify(m.validation));
});
t('comp_add com des_hidden', () => {
  const B = placa();
  const ch = [{ op: 'comp_add', ref: 'R2', footprint: 'R0805', x: 30, y: 30, des_hidden: true }];
  const m = C.applyPcbChanges(B, ch);
  assert.deepStrictEqual(erros(m), []);
  const d = C.effectiveBoard(B, m).texts.find(x => x.designator && x.owner === 'R2');
  assert.strictEqual(d.hidden, true);
  assert.ok(/des_hidden deve ser/.test(erros(C.applyPcbChanges(B, [Object.assign({}, ch[0], { des_hidden: 1 })]))[0].msg));
});
t('MCP: campo que a op não tem', () => {
  assert.deepStrictEqual(ops.camposSobrando({ op: 'designator_move', ref: 'R1', orig_x: 1, orig_y: 2, x: 3, oculto: true, note: 'n' }), ['oculto']);
  assert.deepStrictEqual(ops.camposSobrando({ op: 'designator_move', ref: 'R1', hidden: true, uid: 'u1' }), []);
  assert.deepStrictEqual(ops.camposSobrando({ op: 'poly_add', qualquer: 1 }), [], 'op fora da tabela não é conferida');
});

console.log('test-designator-oculto: ' + ok + ' ok');
