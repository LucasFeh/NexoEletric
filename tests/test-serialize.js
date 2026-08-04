const assert = require('assert');
const { loadVar } = require('./load');
const Core = require('../hub-core.js');

/* ---- serializeChanges: round-trip com a fixture demo ---- */
const changes = loadVar('Projects/_DemoKit/changes.js', 'changes');
const out = Core.serializeChanges(changes);
assert.strictEqual(out.errors.length, 0);
assert.ok(out.text);
const reloaded = new Function(out.text + ';return changes;')();
assert.deepStrictEqual(reloaded, changes, 'round-trip changes deve preservar tudo');

/* formato: header + um objeto JSON por linha + fechamento */
const lines = out.text.trim().split('\n');
assert.ok(lines[0].startsWith('//'));
assert.strictEqual(lines[2], 'var changes = [');
assert.strictEqual(lines[lines.length - 1], '];');
for (let i = 3; i < lines.length - 1; i++) {
  assert.ok(lines[i].endsWith(','), 'linha de objeto termina com virgula');
  JSON.parse(lines[i].slice(0, -1)); // cada linha e JSON plano valido
}

/* recusa change incompleto: comp_move sem x/y (o parser Pascal moveria p/ (0,0)) */
const bad = Core.serializeChanges([{ op:'comp_move', ref:'R1', orig_x:1, orig_y:2, orig_rot:0, orig_layer:'Top' }]);
assert.strictEqual(bad.text, null);
assert.ok(bad.errors.some(e => /"x"/.test(e.msg)));

/* recusa op desconhecida e a sequencia proibida ": */
assert.ok(Core.serializeChanges([{ op:'zzz' }]).errors.length);
assert.ok(Core.serializeChanges([{ op:'via_add', x:1, y:1, size:0.6, drill:0.3, note:'a": b' }]).errors.length);

/* escapa nao-ASCII como \uXXXX */
const acc = Core.serializeChanges([{ op:'via_add', x:1, y:1, size:0.6, drill:0.3, note:'via de coração' }]);
assert.ok(acc.text.includes('\\u'));
assert.ok(!/[~-￿]/.test(acc.text));

/* ---- serializeSchematic: round-trip com a fixture demo ---- */
const sch = loadVar('Projects/_DemoKit/schematic.js', 'schematic');
const so = Core.serializeSchematic(sch);
assert.strictEqual(so.errors.length, 0);
const schBack = new Function(so.text + ';return schematic;')();
assert.deepStrictEqual(schBack, sch, 'round-trip schematic deve preservar tudo');
const sl = so.text.trim().split('\n');
assert.strictEqual(sl[0], 'var schematic = {');
assert.strictEqual(sl[sl.length - 1], ']};');
/* recusa comp sem footprint */
const sbad = Core.serializeSchematic({ project:'X', items:[{ t:'comp', sheet:'main', ref:'R1', sym:'RES', x:100, y:100 }] });
assert.strictEqual(sbad.text, null);
assert.ok(sbad.errors.some(e => /footprint/.test(e.msg)));
/* recusa wire com pts curto */
assert.ok(Core.serializeSchematic({ project:'X', items:[{ t:'wire', sheet:'main', pts:[[0,0]] }] }).errors.length);
/* recusa ": no cabecalho */
assert.ok(Core.serializeSchematic({ project:'X', generated:'a": b', items:[] }).errors.length);

/* ---- serializeAnnotations ---- */
const anns = [
  { id:'n1', view:'pcb', x:12.5, y:8.3, layer:'Top', severity:'err', msg:'trilha muito proxima', ref:'', status:'open', created:'2026-08-04 10:00', reply:'' },
  { id:'n2', view:'sch', sheet:'main', x:2400, y:3400, severity:'warn', msg:'conferir pull-up', ref:'R3', status:'resolved', created:'2026-08-04 10:05', reply:'trocado para 10k' },
];
const ao = Core.serializeAnnotations(anns);
assert.strictEqual(ao.errors.length, 0);
const annBack = new Function(ao.text + ';return annotations;')();
assert.deepStrictEqual(annBack, anns);
/* recusa sem msg, view invalida, ": no texto */
assert.ok(Core.serializeAnnotations([{ id:'n1', view:'pcb', x:1, y:1, severity:'err', msg:'' }]).errors.length);
assert.ok(Core.serializeAnnotations([{ id:'n1', view:'xx', x:1, y:1, severity:'err', msg:'a' }]).errors.length);
assert.ok(Core.serializeAnnotations([{ id:'n1', view:'pcb', x:1, y:1, severity:'err', msg:'a": b' }]).errors.length);

console.log('test-serialize OK');
