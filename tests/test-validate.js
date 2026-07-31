const assert = require('assert');
const { loadVar } = require('./load');
const Core = require('../hub-core.js');

const sch = loadVar('Projects/_DemoKit/schematic.js', 'schematic');
const slib = loadVar('Libs/schlib.js', 'schlib');
const plib = loadVar('Libs/pcblib.js', 'pcblib');

// demo valida limpo
const v = Core.validateSchematic(sch, slib, plib);
assert.strictEqual(v.errors.length, 0, 'erros: ' + v.errors.join(' | '));
assert.strictEqual(v.warnings.length, 0, 'warnings: ' + v.warnings.join(' | '));

const base = (items) => ({ format:'schmirror-v2', project:'t', units:'mil',
  items:[{ t:'sheet', name:'m', size:'A4' }, ...items] });
const comp = (over) => ({ t:'comp', sheet:'m', ref:'R1', sym:'RES', part:1,
  x:1000, y:1000, rot:0, mirror:false, footprint:'R0805', ...over });

// simbolo inexistente
assert.ok(Core.validateSchematic(base([comp({ sym:'NAOEXISTE' })]), slib, plib)
  .errors.some(e => e.includes('NAOEXISTE')));
// footprint inexistente
assert.ok(Core.validateSchematic(base([comp({ footprint:'NAOEXISTE' })]), slib, plib)
  .errors.some(e => e.includes('NAOEXISTE')));
// footprint ausente
assert.ok(Core.validateSchematic(base([comp({ footprint:undefined })]), slib, plib)
  .errors.some(e => e.includes('footprint')));
// ref duplicado
assert.ok(Core.validateSchematic(base([comp({}), comp({ x:2000 })]), slib, plib)
  .errors.some(e => e.includes('duplicado')));
// pino sem pad correspondente (LED A/K num footprint 1/2)
assert.ok(Core.validateSchematic(base([comp({ sym:'LED', footprint:'R0805' })]), slib, plib)
  .warnings.some(w => w.includes('sem pad')));
// fora da grade
assert.ok(Core.validateSchematic(base([comp({ x:1015 })]), slib, plib)
  .warnings.some(w => w.includes('grade')));
// wire invalido
assert.ok(Core.validateSchematic(base([{ t:'wire', sheet:'m', pts:[[0,0]] }]), slib, plib)
  .errors.some(e => e.includes('pts')));
// rot invalida
assert.ok(Core.validateSchematic(base([comp({ rot:45 })]), slib, plib)
  .errors.some(e => e.includes('rot')));

// deriveStatus
assert.strictEqual(Core.deriveStatus({ files:{ schematic:true } }), 'esquema');
assert.strictEqual(Core.deriveStatus({ files:{ schematic:true, board:true } }), 'eco');
assert.strictEqual(Core.deriveStatus({ files:{ schematic:true, board:true } }, { changesCount:3 }), 'roteada');
assert.strictEqual(Core.deriveStatus({ files:{ applyreport:true } }), 'aplicada');

console.log('test-validate OK');
