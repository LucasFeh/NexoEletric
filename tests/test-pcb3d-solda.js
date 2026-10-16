/* A solda na outra face (pedido do dono, 2026-10-16): o footprint marcado com solda (fp.solda, do
   editor de footprint ou do fp_solda do MCP) mostra no 3D o pino só do lado do componente, e na
   face oposta o ponto de solda de cada pad passante. Aqui, a parte pura: o HubPcb3dModelo marca os
   corpos com o corte e manda o corpo kind 'solda'; o HubFpLib.lib3d leva a marca.
   Rode: node tests/test-pcb3d-solda.js */
'use strict';
const assert = require('assert');
const M = require('../hub-pcb3d-modelo.js');
const HF = require('../hub-fplib.js');

const pads = [
  { name:'1', x:10, y:5, w:1.8, h:1.8, drill:1.0, layer:'Multi' },
  { name:'2', x:12.54, y:5, w:1.8, h:1.2, drill:0.9, layer:'Multi', hox:0.2, hoy:0, rot:90 },
  { name:'3', x:15, y:5, w:1.5, h:0.6, layer:'Top' },                 /* SMD: sem solda */
];
const corpo = { kind:'extruded', side:'top', pts:[[-2, -1], [4, -1], [4, 1], [-2, 1]], standoff:0, height:8, color:'#334455' };
const hub = { footprints:[{ name:'CONN', pads:[], silk:[], bodies:[corpo], solda:true },
                          { name:'SEM', pads:[], silk:[], bodies:[corpo] },
                          { name:'SO_SOLDA', pads:[], silk:[], bodies:[], solda:true }], models:{} };
const L3 = HF.lib3d(hub);
assert.strictEqual(L3.footprints.CONN.solda, true, 'lib3d leva a marca');
assert.ok(!('solda' in L3.footprints.SEM), 'sem marca, nada muda');
assert.ok(L3.footprints.SO_SOLDA && L3.footprints.SO_SOLDA.solda && L3.footprints.SO_SOLDA.bodies.length === 0,
  'a marca vale mesmo sem corpo próprio do hub (o corpo vem do PcbDoc ou da biblioteca)');

const comp = (ref, fp, layer) => ({ ref, footprint:fp, x:12, y:5, rot:0, layer, pads });
const corposDe = c => M.corpos({ components:[c] }, null, { pcblib3dHub:L3, placeholder:true, thickness:1.6 });

/* componente em cima: os corpos dele cortados abaixo da face de baixo; a solda nos 2 pads passantes */
{
  const out = corposDe(comp('J1', 'CONN', 'Top'));
  const cs = out.filter(b => b.kind !== 'solda'), sd = out.filter(b => b.kind === 'solda');
  assert.ok(cs.length >= 1 && cs.every(b => b.corte === 'abaixo'), 'Top: corte abaixo em todo corpo');
  assert.strictEqual(sd.length, 1, 'um corpo de solda por componente');
  const s = sd[0];
  assert.strictEqual(s.owner, 'J1'); assert.strictEqual(s.side, 'top'); assert.strictEqual(s.esp, 1.6);
  assert.strictEqual(s.furos.length, 2, 'só os pads passantes');
  assert.deepStrictEqual(s.furos[0], { x:10, y:5, r:0.9, rf:0.5 });
  /* o furo deslocado desloca o cobre: hox 0,2 girado 90 graus vira +0,2 em Y */
  assert.ok(Math.abs(s.furos[1].x - 12.54) < 1e-6 && Math.abs(s.furos[1].y - 5.2) < 1e-6, 'centro do cobre: ' + JSON.stringify(s.furos[1]));
  assert.strictEqual(s.furos[1].r, 0.6, 'o raio é o do menor lado do pad');
}
/* componente embaixo: o corte é acima da face de cima */
{
  const out = corposDe(comp('J2', 'CONN', 'Bottom'));
  assert.ok(out.filter(b => b.kind !== 'solda').every(b => b.corte === 'acima'), 'Bottom: corte acima');
  assert.strictEqual(out.find(b => b.kind === 'solda').side, 'bottom');
}
/* sem a marca: como antes, sem corte e sem solda */
{
  const out = corposDe(comp('J3', 'SEM', 'Top'));
  assert.ok(out.every(b => b.kind !== 'solda' && !b.corte), 'sem marca nada muda');
}
/* marca sem corpo próprio: o placeholder é cortado e a solda aparece */
{
  const out = corposDe(comp('J4', 'SO_SOLDA', 'Top'));
  assert.ok(out.some(b => b.placeholder && b.corte === 'abaixo'), 'o placeholder também é cortado');
  assert.ok(out.some(b => b.kind === 'solda'));
}
/* opcoes.solda(nome) também liga (para quem não usa a biblioteca do hub) */
{
  const out = M.corpos({ components:[comp('J5', 'SEM', 'Top')] }, null, { pcblib3dHub:L3, solda:n => n === 'SEM' });
  assert.ok(out.some(b => b.kind === 'solda'));
}
/* footprint só SMD: corte sim (nada atravessa mesmo), solda não */
{
  const c = Object.assign(comp('U1', 'CONN', 'Top'), { pads:[pads[2]] });
  assert.ok(!corposDe(c).some(b => b.kind === 'solda'), 'sem pad passante, sem solda');
}
console.log('test-pcb3d-solda OK');
