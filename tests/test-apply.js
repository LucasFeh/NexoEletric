const assert = require('assert');
const { loadVar } = require('./load');
const Core = require('../hub-core.js');

const board   = loadVar('Projects/_DemoKit/board.js', 'pcbmirror');
const changes = loadVar('Projects/_DemoKit/changes.js', 'changes');

// demo aplica limpo
const m = Core.applyPcbChanges(board, changes);
assert.strictEqual(m.validation.filter(v => v.level === 'err').length, 0);
const d1 = m.compByRef['D1'];
assert.ok(d1.changed, 'D1 deve estar marcado como movido');
assert.strictEqual(d1.eff.y, 11);
assert.strictEqual(d1.src.y, 14);
assert.strictEqual(m.added.filter(a => a.kind === 'track').length, 1);
assert.strictEqual(m.added.filter(a => a.kind === 'via').length, 1);

// orig_* divergente gera warning (mesma semantica do viewer v1)
const bad = Core.applyPcbChanges(board,
  [{ op:'comp_move', ref:'R1', x:1, y:1, orig_x:999, orig_y:14, orig_rot:0, orig_layer:'Top' }]);
assert.ok(bad.validation.some(v => v.level === 'warn'));

// ref inexistente gera erro
const err = Core.applyPcbChanges(board,
  [{ op:'comp_move', ref:'Z9', x:1, y:1, orig_x:0, orig_y:0, orig_rot:0, orig_layer:'Top' }]);
assert.ok(err.validation.some(v => v.level === 'err'));

// outline_set valido e invalido
const o = Core.applyPcbChanges(board, [{ op:'outline_set', pts:[[0,0],[40,0],[40,25],[0,25]] }]);
assert.ok(o.outlineChanged);
assert.strictEqual(o.outline.length, 4);
assert.deepStrictEqual(o.outline[1], { kind:'line', x1:40, y1:0, x2:40, y2:25 });
const o2 = Core.applyPcbChanges(board, [{ op:'outline_set', pts:[[0,0],[40,0]] }]);
assert.ok(o2.validation.some(v => v.level === 'err'));

// text_edit: edita texto livre; designator de componente e id inexistente sao erro
const tb = { texts:[
  { id:'x1', layer:'TopOverlay', x:10, y:5, text:'1', h:2, rot:0, mirror:false, designator:false, comment:false },
  { id:'x2', layer:'TopOverlay', x:20, y:5, text:'D1', h:0.7, rot:0, mirror:false, designator:true, comment:false, owner:'D1' },
]};
const tm = Core.applyPcbChanges(tb, [
  { op:'text_edit', id:'x1', text:'27', x:9.8, y:5, orig_x:10, orig_y:5, orig_text:'1', orig_layer:'TopOverlay' },
]);
assert.strictEqual(tm.validation.filter(v => v.level === 'err').length, 0);
assert.strictEqual(tm.texts[0].eff.text, '27');
assert.strictEqual(tm.texts[0].eff.x, 9.8);
assert.ok(tm.texts[0].changed, 'x1 deve estar marcado como mudado');
const tm2 = Core.applyPcbChanges(tb, [
  { op:'text_edit', id:'x2', text:'zz', orig_x:20, orig_y:5, orig_text:'D1', orig_layer:'TopOverlay' },
]);
assert.ok(tm2.validation.some(v => v.level === 'err'), 'designator nao e editavel');
const tm3 = Core.applyPcbChanges(tb, [
  { op:'text_edit', id:'x9', text:'a', orig_x:0, orig_y:0, orig_text:'', orig_layer:'TopOverlay' },
]);
assert.ok(tm3.validation.some(v => v.level === 'err'), 'id inexistente e erro');

// designator_move: acha pelo owner, move o eff; ref sem designator e erro
const dm = Core.applyPcbChanges(tb, [
  { op:'designator_move', ref:'D1', x:21, y:6, orig_x:20, orig_y:5 },
]);
assert.strictEqual(dm.validation.filter(v => v.level === 'err').length, 0);
assert.strictEqual(dm.texts[1].eff.x, 21);
assert.strictEqual(dm.texts[1].eff.y, 6);
assert.ok(dm.texts[1].changed, 'designator D1 deve estar marcado como mudado');
const dm2 = Core.applyPcbChanges(tb, [
  { op:'designator_move', ref:'Z9', x:1, y:1, orig_x:0, orig_y:0 },
]);
assert.ok(dm2.validation.some(v => v.level === 'err'), 'ref sem designator e erro');

// example v1 continua compativel
const exb = loadVar('example/board.js', 'pcbmirror');
const exc = loadVar('example/changes.js', 'changes');
const ex = Core.applyPcbChanges(exb, exc);
assert.strictEqual(ex.validation.filter(v => v.level === 'err').length, 0);
assert.ok(ex.compByRef['R1'].changed);

console.log('test-apply OK');
