/* O 3D do footprint da biblioteca segue os pads do componente na placa (2026-10-30). O footprint com o
   MESMO nome pode ter a origem (ou o giro) diferente na biblioteca e na placa: o ESP32-WROOM-32D da
   biblioteca do hub tem a origem 2,4 mm longe da do footprint que o PcbDoc do MIRBC trouxe, e o corpo,
   posto na origem da biblioteca, saia deslocado dos pads nas duas placas. O HubPcb3dModelo leva o corpo
   pelo encaixe dos pads (pelo nome) da biblioteca nos do componente; forma diferente nao se encaixa e o
   corpo fica como antes.
   Rode: node tests/test-pcb3d-origem.js */
'use strict';
const assert = require('assert');
const M = require('../hub-pcb3d-modelo.js');
const HF = require('../hub-fplib.js');

const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol || 1e-6), (msg || '') + ' ' + a + ' != ' + b);
const T = m => [m[12], m[13], m[14]];
const giro = (x, y, g) => { const a = g * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };

/* a biblioteca: pads em volta da origem dela; o corpo STEP no centro dos pads */
const padsLib = [
  { name:'1', x:-7.448, y:7.454, w:2, h:0.9 }, { name:'38', x:9.552, y:7.454, w:2, h:0.9 },
  { name:'15', x:-1.198, y:-10.0, w:0.9, h:2 }, { name:'39', x:-1.783, y:1.789, w:1.33, h:1.33 },
  { name:'39', x:0.0, y:1.789, w:1.33, h:1.33 },
];
const corpoLib = { kind:'step', model:'ESP', matrix:[1,0,0,0, 0,1,0,0, 0,0,1,0, 1.052,2.194,0,1] };
const hub = { footprints:[{ name:'ESP', pads:padsLib, silk:[], bodies:[corpoLib] }], models:{ ESP:{ file:'3d/esp.step' } } };
const L3 = HF.lib3d(hub);
assert.ok(Array.isArray(L3.footprints.ESP.pads) && L3.footprints.ESP.pads.length === padsLib.length, 'lib3d leva os pads (nome, x, y)');

/* o footprint da placa: o mesmo desenho com a origem deslocada (dx, dy) e girado g graus em relacao ao
   da biblioteca; o componente posto em (X, Y, rot) no lado dado. Devolve os pads ABSOLUTOS na placa */
function compDe(ref, { dx = 0, dy = 0, g = 0, X = 50, Y = 40, rot = 0, layer = 'Top', esp = 1.6, pads = padsLib } = {}){
  const abs = pads.map(p => {
    let [x, y] = giro(p.x + dx, p.y + dy, g);          /* local da placa */
    if (layer === 'Bottom') y = -y;                     /* Sy da convencao do HubCore */
    const [u, v] = giro(x, y, rot);
    return Object.assign({}, p, { x:X + u, y:Y + v });
  });
  return { ref, footprint:'ESP', x:X, y:Y, rot, layer, pads:abs };
}
const corposDe = (c, esp) => M.corpos({ components:[c] }, null, { pcblib3dHub:L3, placeholder:false, thickness:esp || 1.6 });

/* 1. mesma origem: nada muda (o corpo na pose de sempre) */
{
  const [b] = corposDe(compDe('U1', { rot:90 }));
  const [x, y] = giro(1.052, 2.194, 90);
  perto(T(b.matrix)[0], 50 + x, 1e-6, 'x'); perto(T(b.matrix)[1], 40 + y, 1e-6, 'y');
  assert.ok(!b.ajuste, 'sem ajuste quando as origens batem');
}
/* 2. a origem da placa 1,052/2,194 mm longe (o caso do ESP32 do MIRBC): o corpo vai para a origem do componente */
for (const rot of [0, 90, 180, 270]) {
  const [b] = corposDe(compDe('MD3', { dx:-1.052, dy:-2.194, rot, X:86.9, Y:52 }));
  perto(T(b.matrix)[0], 86.9, 1e-4, 'rot ' + rot + ' x'); perto(T(b.matrix)[1], 52, 1e-4, 'rot ' + rot + ' y');
  assert.ok(b.ajuste && b.ajuste.pads >= 3, 'o ajuste diz quantos pads casaram: ' + JSON.stringify(b.ajuste));
}
/* 3. no Bottom tambem */
{
  const esp = 1.6, [b] = corposDe(compDe('MD4', { dx:-1.052, dy:-2.194, rot:90, layer:'Bottom', X:20, Y:30 }), esp);
  perto(T(b.matrix)[0], 20, 1e-4, 'bottom x'); perto(T(b.matrix)[1], 30, 1e-4, 'bottom y'); perto(T(b.matrix)[2], -esp, 1e-6, 'bottom z');
}
/* 4. o footprint da placa girado 90 graus em relacao ao da biblioteca: o corpo gira junto */
{
  const [b] = corposDe(compDe('U2', { g:90, rot:0, X:10, Y:10 }));
  const [x, y] = giro(1.052, 2.194, 90);
  perto(T(b.matrix)[0], 10 + x, 1e-4, 'giro x'); perto(T(b.matrix)[1], 10 + y, 1e-4, 'giro y');
  perto(b.matrix[0], 0, 1e-6, 'eixo X do corpo girado'); perto(b.matrix[1], 1, 1e-6, 'eixo X do corpo girado');
}
/* 5. forma diferente (um pad noutro lugar): nao se encaixa, o corpo fica na pose de sempre */
{
  const outro = padsLib.map(p => p.name === '38' ? Object.assign({}, p, { x:p.x + 3 }) : p);
  const [b] = corposDe(compDe('U3', { dx:-1, dy:0, pads:outro, X:0, Y:0 }));
  perto(T(b.matrix)[0], 1.052, 1e-6, 'sem encaixe x'); perto(T(b.matrix)[1], 2.194, 1e-6, 'sem encaixe y');
  assert.ok(!b.ajuste);
}
/* 6. biblioteca sem pads (o lib3d antigo, o teste da solda): o corpo fica na pose de sempre */
{
  const L = { footprints:{ ESP:{ bodies:[corpoLib] } }, models:{} };
  const [b] = M.corpos({ components:[compDe('U4', { dx:-1.052, dy:-2.194, X:0, Y:0 })] }, null, { pcblib3dHub:L, placeholder:false });
  perto(T(b.matrix)[0], 1.052, 1e-6); perto(T(b.matrix)[1], 2.194, 1e-6);
}
console.log('test-pcb3d-origem: ok');
