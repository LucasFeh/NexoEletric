const assert = require('assert');
const Core = require('../hub-core.js');

// comp em (10,20) rot 0 Top movido p/ (30,40) rot 90 Bottom (flip)
const board = { components:[{ ref:'R1', x:10, y:20, rot:0, layer:'Top' }] };
const moved = Core.applyPcbChanges(board, [{ op:'comp_move', ref:'R1',
  x:30, y:40, rot:90, layer:'Bottom', orig_x:10, orig_y:20, orig_rot:0, orig_layer:'Top' }]);

const d = Core.compDelta(moved.compByRef['R1']);
assert.strictEqual(d.ox, 10); assert.strictEqual(d.nx, 30);
assert.strictEqual(d.dr, 90); assert.strictEqual(d.flip, true);

// ponto 1mm a direita do centro: flip inverte X local -> (-1,0); rot 90 -> (0,-1)
const p = Core.xfPoint(d, 11, 20);
assert.ok(Math.abs(p.x - 30) < 1e-9, 'x esperado 30, veio ' + p.x);
assert.ok(Math.abs(p.y - 39) < 1e-9, 'y esperado 39, veio ' + p.y);

// angulo com flip: 180 - ang + dr
assert.strictEqual(Core.xfAngle(d, 0), 270);

// ownerDelta: null p/ ref vazio, null p/ comp nao movido, delta p/ movido
assert.strictEqual(Core.ownerDelta(moved, ''), null);
const still = Core.applyPcbChanges(board, []);
assert.strictEqual(Core.ownerDelta(still, 'R1'), null);
assert.ok(Core.ownerDelta(moved, 'R1'));

// effLayerForOwner: espelha camadas de overlay quando o dono flipou de lado
assert.strictEqual(Core.effLayerForOwner(moved, 'R1', 'TopOverlay'), 'BottomOverlay');
assert.strictEqual(Core.effLayerForOwner(moved, 'R1', 'Multi'), 'Multi');
assert.strictEqual(Core.effLayerForOwner(still, 'R1', 'TopOverlay'), 'TopOverlay');

console.log('test-geom OK');
