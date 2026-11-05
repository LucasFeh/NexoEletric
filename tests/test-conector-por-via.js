/* O conector uma parte por via (HubCore.simboloPorVia / migraConectoresPorVia, schframe.js » montaAcervos).

   node tests/test-conector-por-via.js

   Pedido do dono (2026-11-05): todo conector do almoxarifado no símbolo "Conector 1 via", uma parte por pino, numeradas
   de 1 a N com o mesmo designador. O que não pode quebrar: o conector já colocado com o desenho de antes (um símbolo com
   todos os pinos) vira N partes com a ponta de cada pino EXATAMENTE onde estava — as nets da folha são as mesmas. */
const assert = require('assert');
const H = require('../hub-core.js');
global.HubCore = H;
const SF = require('../schframe.js');

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

/* o desenho de antes: 4 pinos à esquerda de um retângulo (como o CONECTOR BARRA DE PINOS do gerador) */
const antigo = [{ part: 1, pins: [1, 2, 3, 4].map(k => ({ num: String(k), name: String(k), x: -100, y: 150 - 100 * (k - 1), len: 100, orient: 180, type: 'Passive', hideName: true })),
                  graphics: [{ g: 'rect', x1: -100, y1: -200, x2: 100, y2: 200, w: 10 }] }];
const familia = { name: 'CONECTOR BARRA DE PINOS', familia: 'CONECTOR BARRA DE PINOS', designator: 'J', parts: antigo,
  valores: [{ id: 1, altium: '1x4 4 vias P2.54mm Macho 180°', label: '1x4 4 vias', conn: { subtipo: 'BARRA DE PINOS', vias: 4 }, parts: antigo },
            { id: 2, altium: 'RES 10K', label: '10K' }] };

/* ── 1. as partes por via ── */
{
  const p = H.partesPorVia(antigo, 4);
  eq(p.length, 4, 'uma parte por pino');
  eq(p.map(x => x.part), [1, 2, 3, 4]);
  eq(p.map(x => x.pins[0].num), ['1', '2', '3', '4'], 'o número do pino de antes (o footprint casa pad a pad)');
  eq(p[0].graphics, H.CONECTOR_VIA.graphics, 'o desenho do Conector 1 via');
  eq(H.partesPorVia([], 3).map(x => x.pins[0].num), ['1', '2', '3'], 'sem desenho: as vias do conector');
  eq(H.partesPorVia([{ part: 1, pins: [{ num: '10' }, { num: '2' }, { num: '1' }] }], 0).map(x => x.pins[0].num), ['1', '2', '10'], 'ordem numérica');
  eq(H.partesPorVia([{ part: 1, pins: [{ num: '1' }, { num: '2' }] }], 5).length, 5, 'desenho com menos pinos que as vias: completa até as vias');
  eq(H.partesPorVia([{ part: 1, pins: ['VBUS', 'D-', 'D+', 'GND'].map(num => ({ num })) }], 4).length, 4, 'pinos com nome e as vias batendo: não inventa número');
  const molde = H.moldeConectorVia({ symbols: [{ name: 'Conector 1 via', pins: [{ num: '1', x: 0, y: 0, len: 50, orient: 0 }], graphics: [{ g: 'line' }] }] });
  eq(molde.graphics, [{ g: 'line' }], 'o molde vem da Biblioteca de símbolos quando ela tem');
  eq(H.moldeConectorVia(null), H.CONECTOR_VIA, 'senão a cópia');
}

/* ── 2. a montagem dos acervos: só o conector muda ── */
const m = SF.montaAcervos({ almoxBasicos: { format: 'schlib-v2', title: 'Básicos', symbols: [familia] } });
const con = m.symbols.find(s => s.name === '1x4 4 vias P2.54mm Macho 180°');
const res = m.symbols.find(s => s.name === 'RES 10K');
eq(con.porVia, 4, 'o conector tem 4 vias');
eq(con.partcount, 4);
eq(con.partesAntigas, antigo, 'guarda o desenho de antes');
ok(!res.porVia && res.parts === familia.parts, 'o que não é conector fica como era');
const SLIB = { symbols: m.symbols };

/* ── 3. o conector colocado com o desenho de antes vira uma parte por via, sem soltar fio ── */
for (const pose of [{ rot: 0, mirror: false }, { rot: 90, mirror: false }, { rot: 180, mirror: true }, { rot: 270, mirror: true }]) {
  const velho = Object.assign({ t: 'comp', sheet: 'F1', ref: 'J7', sym: con.name, part: 1, x: 1000, y: 2000, footprint: 'BARRA 4', comment: '1x4', refdx: 10, refdy: 20 }, pose);
  const libVelha = { symbols: [Object.assign({}, con, { parts: antigo })] };
  const pontas = H.compPinsWorld(velho, libVelha).map(p => p.num + '@' + Math.round(p.x) + ',' + Math.round(p.y)).sort();
  /* um fio em cada pino: as nets antes e depois tem de ser as mesmas */
  const fios = H.compPinsWorld(velho, libVelha).map(p => ({ t: 'wire', sheet: 'F1', pts: [[p.x, p.y], [p.x + 0, p.y + 1000 + 300 * +p.num]] }));
  const sch = { project: 'X', items: [{ t: 'sheet', name: 'F1', size: 'A4' }, velho].concat(fios) };
  const netsAntes = H.extractNets(H.buildSchModel(JSON.parse(JSON.stringify(sch))), libVelha).nets.map(x => x.pins.join(',')).sort();
  const feitos = H.migraConectoresPorVia(sch, SLIB);
  eq(feitos, [{ ref: 'J7', sym: con.name, vias: 4 }], 'converteu (' + JSON.stringify(pose) + ')');
  const partes = sch.items.filter(i => i.t === 'comp');
  eq(partes.map(p => p.part), [1, 2, 3, 4], 'as 4 partes no lugar do componente');
  ok(partes.every(p => p.ref === 'J7' && p.porVia === true && p.footprint === 'BARRA 4' && p.comment === '1x4'), 'mesmo designador, footprint e comment');
  const depois = [].concat(...partes.map(p => H.compPinsWorld(p, SLIB))).map(p => p.num + '@' + Math.round(p.x) + ',' + Math.round(p.y)).sort();
  eq(depois, pontas, 'a ponta de cada pino onde estava');
  const netsDepois = H.extractNets(H.buildSchModel(sch), SLIB).nets.map(x => x.pins.join(',')).sort();
  eq(netsDepois, netsAntes, 'as nets não mudam');
  eq(H.migraConectoresPorVia(sch, SLIB), [], 'não converte de novo');
}

console.log('test-conector-por-via: ' + n + ' verificações ok');
