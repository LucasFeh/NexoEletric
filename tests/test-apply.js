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

// example v1 continua compativel
const exb = loadVar('example/board.js', 'pcbmirror');
const exc = loadVar('example/changes.js', 'changes');
const ex = Core.applyPcbChanges(exb, exc);
assert.strictEqual(ex.validation.filter(v => v.level === 'err').length, 0);
assert.ok(ex.compByRef['R1'].changed);

console.log('test-apply OK');
