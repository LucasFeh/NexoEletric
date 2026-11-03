/* Recortes do board.js saem por region_del (1.57.0): o Board Cutout e o Polygon Pour Cutout (kindn 1)
   que vieram do Altium -- no MIRBC, 12 recortes das Mid1/Mid2 ficaram na posicao antiga da placa e
   nao havia como tira-los. O de componente anda com ele (recusado); orig_* errado e aviso; apagar
   duas vezes e erro; o pcb-ops do MCP monta a op com os orig_* do recorte. */
const assert = require('assert');
const C = require('../hub-core.js');
const ops = require('../mcp/lib/pcb-ops.js');

let ok = 0;
const t = (nome, fn) => { fn(); ok++; };
const quad = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const placa = () => ({
  exporter: 'teste', nets: [], components: [], freepads: [], tracks: [], arcs: [], vias: [], fills: [], regions: [],
  board: { bbox: { x1: 0, y1: 0, x2: 50, y2: 50 }, outline: [] },
  cutouts: [
    { id: 'k1', layer: 'Multi', incomp: false, points: quad(0, 0, 50), kindn: -1 },
    { id: 'k2', layer: 'Mid1', incomp: false, points: quad(60, 60, 4), kindn: 1 },
    { id: 'k3', layer: 'Multi', incomp: false, points: quad(10, 10, 3), kindn: 0 },
    { id: 'k4', layer: 'Multi', incomp: false, points: quad(20, 20, 2), kindn: 0, owner: 'J1' },
  ],
});
const del = k => ({ op: 'region_del', id: k.id, orig_layer: k.layer, orig_n: k.points.length, orig_x0: k.points[0][0], orig_y0: k.points[0][1] });
const erros = m => m.validation.filter(v => v.level === 'err');
const ids = (B, m) => C.effectiveBoard(B, m).cutouts.map(k => k.id).join(',');

t('recorte de polígono do board.js sai', () => {
  const B = placa(), m = C.applyPcbChanges(B, [del(B.cutouts[1])]);
  assert.deepStrictEqual(erros(m), []);
  assert.strictEqual(ids(B, m), 'k1,k3,k4');
});
t('Board Cutout do board.js sai', () => {
  const B = placa(), m = C.applyPcbChanges(B, [del(B.cutouts[2])]);
  assert.deepStrictEqual(erros(m), []);
  assert.strictEqual(ids(B, m), 'k1,k2,k4');
});
t('recorte de componente é recusado', () => {
  const B = placa(), m = C.applyPcbChanges(B, [del(B.cutouts[3])]);
  assert.ok(/pertence ao componente J1/.test(erros(m)[0].msg), erros(m)[0].msg);
  assert.strictEqual(ids(B, m), 'k1,k2,k3,k4');
});
t('apagar duas vezes é erro', () => {
  const B = placa(), m = C.applyPcbChanges(B, [del(B.cutouts[1]), del(B.cutouts[1])]);
  assert.ok(/já foi removida/.test(erros(m)[0].msg), erros(m)[0].msg);
});
t('orig_* que não confere é aviso', () => {
  const B = placa(), m = C.applyPcbChanges(B, [Object.assign(del(B.cutouts[1]), { orig_x0: 1 })]);
  assert.ok(m.validation.some(v => v.level === 'warn' && /orig_\* não confere/.test(v.msg)));
});
t('sem mudança os recortes ficam', () => {
  const B = placa();
  assert.strictEqual(ids(B, C.applyPcbChanges(B, [])), 'k1,k2,k3,k4');
});
t('MCP: region_del de um recorte leva os orig_* dele', () => {
  const B = placa(), o = ops.origDe({ op: 'region_del', id: 'k2' }, B);
  assert.deepStrictEqual(o, { op: 'region_del', id: 'k2', orig_layer: 'Mid1', orig_n: 4, orig_x0: 60, orig_y0: 60 });
  assert.strictEqual(ops.tipoDoObjeto(ops.achaObjeto(B, 'k2')), 'cutouts');
});

console.log('test-recorte-apagar: ' + ok + ' ok');
