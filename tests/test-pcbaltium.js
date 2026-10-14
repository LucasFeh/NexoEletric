// hub-pcbaltium.js: o mapa comando do Altium -> acao da vista PCB.
//   - todo plid do MAPA existe no Altium (hub-altiumdna.js, lido do AdvPcb.rcs/WorkspaceManager.rcs/dxp.rcs);
//   - toda acao do MAPA e um `case` do fazAcao do pcbframe.js (senao o item fica verde e nao faz nada);
//   - os dois menus do botao direito existem no DNA com os grupos que o modulo trata.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const DNA = require(path.join(R, 'hub-altiumdna.js'));
const ALT = require(path.join(R, 'hub-pcbaltium.js'));
const frame = fs.readFileSync(path.join(R, 'pcbframe.js'), 'utf8');

const corpo = frame.slice(frame.indexOf('function fazAcao(id, arg){'));
const casos = new Set(Array.from(corpo.slice(0, corpo.indexOf('\n}\n')).matchAll(/case '([^']+)'/g), m => m[1]));
let n = 0;
for (const [plid, m] of Object.entries(ALT.MAPA)) {
  if (!m) continue;
  const c = DNA.comando('pcb', plid);
  assert.ok(c, 'plid fora do Altium: ' + plid);
  assert.ok(casos.has(m.a), 'acao sem case no fazAcao: ' + m.a + ' (' + plid + ')');
  n++;
}
for (const a of ['gerber', 'pdf', 'gradeId', 'preferencias', 'atalhos']) assert.ok(casos.has(a), 'acao sem case: ' + a);

const pops = DNA.menu('pcb', 'popups');
const prim = pops.find(x => x.rotulo === 'Right Mouse Click Primitive');
const livre = pops.find(x => x.rotulo === 'Right Mouse Click Free Space');
assert.ok(prim && livre, 'menus do botao direito no DNA');
const rots = l => l.filter(x => x.rotulo).map(x => x.rotulo);
for (const g of ['Place', 'Component Actions', 'Net Actions', 'Align']) assert.ok(rots(prim.filhos).includes(g), 'falta ' + g);
assert.deepStrictEqual(rots(DNA.menu('pcb', 'principal')),
  ['File', 'Edit', 'View', 'Project', 'Place', 'Design', 'Tools', 'Route', 'Reports', 'Window', 'Help']);

// as preferencias padrao nao mudam o comportamento de antes
assert.deepStrictEqual(ALT.RODA_CASA, { zoom:'', vertical:'Alt', horizontal:'Shift', camada:'Ctrl+Shift' });
assert.ok(/zoom:'', vertical:'Alt', horizontal:'Shift', camada:'Ctrl\+Shift'/.test(frame), 'PREFS_PADRAO da roda = o de sempre');
console.log('ok — ' + n + ' comandos do Altium ligados a ' + new Set(Object.values(ALT.MAPA).filter(Boolean).map(m => m.a)).size + ' acoes');
