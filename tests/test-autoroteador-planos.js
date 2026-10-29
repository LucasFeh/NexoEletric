/* O AUTOROTEADOR E OS PLANOS (hub-autoroteador.js, P2 do relato de 2026-10-28, itens 17 a 20), em placas
   sintéticas com polígonos do hub (despejados pelo hub-pcbpour.js) — provado pelo DRC e pelo ratsnest da
   placa REDESPEJADA:
     node tests/test-autoroteador-planos.js

   17a o pedaço de plano é obstáculo pela folga do PRÓPRIO polígono (0,6 mm, maior que a regra): a rota
       passa a 0,6 mm e o plano redespejado fica com a mesma área (antes ele recuava calado);
   17b + 19  cruzarPlanos: o gate só chega ao MOSFET atravessando o plano de fase — sem a opção, não
       passa; com ela, passa e o plano continua uma peça só; se atravessar PARTIRIA o plano (um pad de
       fase ficaria numa ilha recortada), o lote redespeja, vê a net de fase piorar e desfaz a rota
       (motivo corta-plano);
   17c o pad DENTRO do contorno do polígono mas numa ilha recortada (um anel de outra net em volta) é
       conexão aberta, e o lote a liga;
   18  fanout: 16 pads de GND de um SO-20 + capacitores ganham trilha curta + via ao plano interno, uma
       via longe da outra (furo a furo), DRC sem violação nova, todos no plano depois do redespejo;
   20  via em pad SMD: o padrão tira a via do pad (viaEmPad:true a deixa lá); faixa estreita de plano:
       o fanout não põe via na faixa de 1,9 mm (faixaPlano:0 põe); HubPcbPour.estreitas acha a faixa. */
'use strict';
const assert = require('assert');
const AR = require('../hub-autoroteador.js');
const RG = require('../hub-pcbregras.js');
const DRC = require('../hub-pcbdrc.js');
const NETS = require('../hub-pcbnets.js');
const PO = require('../hub-pcbpour.js');

let falhou = 0;
function caso(nome, fn){
  try { fn(); console.log('ok  ' + nome); }
  catch (e) { falhou++; console.log('FALHOU  ' + nome + '\n   ' + (e && e.stack || e).toString().split('\n').slice(0, 6).join('\n   ')); }
}

/* ---------------- placas sintéticas ---------------- */
let seq = 0;
const id = p => p + (++seq);
function placaBase(W, H, camadas){
  const out = [[0, 0, W, 0], [W, 0, W, H], [W, H, 0, H], [0, H, 0, 0]].map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2 }));
  return { board: { bbox: { x1: 0, y1: 0, x2: W, y2: H }, outline: out }, layers: camadas.map(key => ({ key })),
           components: [], tracks: [], arcs: [], vias: [], fills: [], regions: [], texts: [], lines: [], silk: [], freepads: [], nets: [], polygons: [] };
}
const temNet = (eb, n) => { if (n && !eb.nets.includes(n)) eb.nets.push(n); };
function pad(eb, ref, nome, x, y, o){
  let c = eb.components.find(k => k.ref === ref);
  if (!c) { c = { id: id('c'), ref, footprint: 'FP_' + ref, layer: 'Top', x, y, rot: 0, pads: [] }; eb.components.push(c); }
  const p = Object.assign({ id: id('p'), name: nome, x, y, w: 1.5, h: 1.5, shape: 'rect', layer: 'Top', type: 'smd', drill: 0, rot: 0, net: '' }, o || {});
  c.pads.push(p);
  temNet(eb, p.net);
  return p;
}
const TH = { layer: 'Multi', type: 'th', drill: 0.8, shape: 'circle', w: 1.8, h: 1.8 };
const CASA = () => RG.normaliza(RG.padroesCasa());
const TIPOS = ['Clearance', 'ShortCircuit', 'Width', 'RoutingVias', 'HoleSize', 'HoleToHoleClearance', 'MinimumSolderMaskSliver', 'BoardOutlineClearance'];
/* as violações que as ops criaram, na placa REDESPEJADA (a conta do MCP e da vista) */
function novas(ebAntes, ops, S){
  const d0 = DRC.rodar(ebAntes, S, { modo: 'lote', tipos: TIPOS });
  const d1 = DRC.rodar(AR.redespeja(ebAntes, ops, { regras: S }), S, { modo: 'lote', tipos: TIPOS });
  return AR.novasViolacoes(d0, d1);
}
/* área do cobre de um polígono (contorno - furos) */
function areaPlano(eb, pid){
  const a = P => { let s = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) s += (P[j][0] + P[i][0]) * (P[j][1] - P[i][1]); return Math.abs(s) / 2; };
  return eb.regions.filter(g => g.poly && g.de === pid).reduce((s, g) => s + a(g.points) - (g.holes || []).reduce((t, h) => t + a(h), 0), 0);
}
const ilhasDe = (eb, net) => (((NETS.conexoes(eb).nets || {})[net] || {}).ilhas || []).length;

/* ---------------- 17a: a folga do polígono ---------------- */
caso('17a: a rota respeita a folga do próprio polígono e o plano não recua', () => {
  const S = CASA();
  const eb = placaBase(30, 20, ['Top']);
  pad(eb, 'J1', '1', 2, 9.5, { net: 'S', w: 0.6, h: 0.6 }); pad(eb, 'J2', '1', 28, 9.5, { net: 'S', w: 0.6, h: 0.6 });
  pad(eb, 'J3', '1', 15, 15, Object.assign({ net: 'GND' }, TH));
  eb.tracks.push({ id: 'tx', layer: 'Top', x1: 4, y1: 8, x2: 26, y2: 8, w: 0.5, net: 'X' }); temNet(eb, 'X');
  eb.polygons.push({ id: 'pgG', layer: 'Top', net: 'GND', pts: [[0, 10], [30, 10], [30, 20], [0, 20]], pour: 'solid', clearance: 0.6, conexao: { tipo: 'direct' } });
  const ebP = AR.redespeja(eb, []);
  const r = AR.rotearLote(ebP, { regras: S });
  assert.strictEqual(r.roteadas, 1, JSON.stringify(r.falhas));
  const a0 = areaPlano(ebP, 'pgG'), a1 = areaPlano(AR.redespeja(ebP, r.ops, { regras: S }), 'pgG');
  assert.ok(Math.abs(a0 - a1) < 1e-6, `o plano recuou: ${a0.toFixed(4)} -> ${a1.toFixed(4)} mm²`);
  /* no meio (longe dos pads, onde o plano já recua em volta deles) a borda do plano é y = 10 */
  const meio = r.ops.filter(o => o.op === 'track_add' && Math.min(o.x1, o.x2) < 15 && Math.max(o.x1, o.x2) > 15);
  assert.strictEqual(meio.length, 1);
  const yMax = Math.max(meio[0].y1, meio[0].y2) + meio[0].w / 2;
  assert.ok(10 - yMax >= 0.6 - 1e-6, 'a trilha encostou no plano a ' + (10 - yMax).toFixed(3) + ' mm (folga do polígono 0,6)');
  assert.deepStrictEqual(novas(ebP, r.ops, S).map(v => v.msg), []);
  console.log(`    plano ${a0.toFixed(2)} mm² antes e depois; a trilha a ${(10 - yMax).toFixed(3)} mm dele`);
});

/* ---------------- 17b + 19: o gate pelo plano de fase ---------------- */
function placaFase(yQ2){
  const eb = placaBase(50, 30, ['Top', 'Bottom']);
  pad(eb, 'Q1', '1', 15, 25, Object.assign({ net: 'FASE' }, TH));
  pad(eb, 'Q2', '1', 35, yQ2, Object.assign({ net: 'FASE' }, TH));
  pad(eb, 'U1', '1', 5, 5, { net: 'GATE' });
  pad(eb, 'Q3', 'G', 45, 5, { net: 'GATE' });
  eb.polygons.push({ id: 'pgF', nome: 'FASE', layer: 'Top', net: 'FASE', pts: [[10, -1], [40, -1], [40, 31], [10, 31]], pour: 'solid', removeDead: true, clearance: 0.3, conexao: { tipo: 'direct' } });
  return AR.redespeja(eb, []);
}
caso('19: o gate só chega ao MOSFET cruzando o plano de fase, e o plano não parte', () => {
  const S = CASA();
  const eb = placaFase(25);
  const sem = AR.rotearLote(eb, { regras: S, camadas: ['Top'] });
  assert.strictEqual(sem.roteadas, 0, 'sem cruzarPlanos o gate não devia passar pelo plano');
  const com = AR.rotearLote(eb, { regras: S, camadas: ['Top'], cruzarPlanos: ['FASE'] });
  assert.strictEqual(com.roteadas, 1, JSON.stringify(com.falhas));
  assert.deepStrictEqual(com.rotas[0].cruzaPlanos, ['pgF']);
  const ebD = AR.redespeja(eb, com.ops, { regras: S });
  assert.strictEqual(NETS.naoRoteadas(ebD).conexoes, 0, 'sobrou conexão aberta na placa redespejada');
  assert.strictEqual(ilhasDe(ebD, 'FASE'), 1, 'o plano de fase partiu');
  assert.ok(areaPlano(ebD, 'pgF') < areaPlano(eb, 'pgF') - 1, 'o plano devia recuar em volta do gate');
  assert.deepStrictEqual(novas(eb, com.ops, S).map(v => v.msg), []);
  assert.strictEqual(com.depois.conexoes, 0, 'o "depois" do relatório é o da placa redespejada');
  console.log(`    sem cruzar: ${sem.falhas[0].motivo}; cruzando: ${com.comprimento} mm, plano ${areaPlano(eb, 'pgF').toFixed(1)} -> ${areaPlano(ebD, 'pgF').toFixed(1)} mm², 1 peça`);
});
caso('17b: a rota que partiria o plano (pad de fase numa ilha recortada) é desfeita', () => {
  const S = CASA();
  const eb = placaFase(2);
  const r = AR.rotearLote(eb, { regras: S, camadas: ['Top'], cruzarPlanos: true });
  assert.strictEqual(r.roteadas, 0);
  assert.deepStrictEqual(r.falhas.map(f => f.motivo), ['corta-plano']);
  assert.ok(r.planos.desfeitas >= 1 && r.planos.pioraram.includes('FASE'), JSON.stringify(r.planos));
  assert.strictEqual(r.ops.length, 0);
  console.log(`    ${JSON.stringify(r.planos)}`);
});

/* ---------------- 17c: o pad numa ilha recortada ---------------- */
caso('17c: pad dentro do contorno mas numa ilha recortada é conexão aberta, e o lote a liga', () => {
  const S = CASA();
  const eb = placaBase(30, 20, ['Top', 'Bottom']);
  const P = pad(eb, 'C1', '2', 15, 10, { net: 'GND', w: 1.0, h: 1.0 });
  pad(eb, 'J1', '1', 3, 3, Object.assign({ net: 'GND' }, TH));
  const q = 2.0, anel = [[15 - q, 10 - q], [15 + q, 10 - q], [15 + q, 10 + q], [15 - q, 10 + q]];
  anel.forEach((a, i) => { const b = anel[(i + 1) % 4]; eb.tracks.push({ id: 'ta' + i, layer: 'Top', x1: a[0], y1: a[1], x2: b[0], y2: b[1], w: 0.3, net: 'X' }); });
  temNet(eb, 'X');
  eb.polygons.push({ id: 'pgG', layer: 'Top', net: 'GND', pts: [[0, 0], [30, 0], [30, 20], [0, 20]], pour: 'solid', clearance: 0.3, conexao: { tipo: 'direct' } });
  const ebP = AR.redespeja(eb, []);
  /* o contorno do polígono engole o pad, mas o cobre de dentro do anel é outra ilha */
  const cons = AR.conexoesAbertas(ebP, null, { nets: ['GND'] });
  assert.ok(cons.length >= 1 && cons.some(c => c.a.padId === String(P.id) || c.b.padId === String(P.id) || ilhasDe(ebP, 'GND') > 1),
            'o pad na ilha recortada devia aparecer como conexão aberta: ' + JSON.stringify(cons.map(c => [c.a.nome, c.b.nome])));
  const r = AR.rotearLote(ebP, { regras: S, nets: ['GND'] });
  const ebD = AR.redespeja(ebP, r.ops, { regras: S });
  assert.strictEqual(ilhasDe(ebD, 'GND'), 1, 'GND ainda em ' + ilhasDe(ebD, 'GND') + ' ilhas: ' + JSON.stringify(r.falhas));
  assert.deepStrictEqual(novas(ebP, r.ops, S).map(v => v.msg), []);
  console.log(`    GND em ${ilhasDe(ebP, 'GND')} ilhas -> 1 (${r.vias} vias, ${r.comprimento} mm)`);
});

/* ---------------- 18: o fanout ---------------- */
caso('18: fanout de GND — trilha curta + via ao plano, via longe de via, DRC limpo', () => {
  const S = CASA();
  const eb = placaBase(40, 30, ['Top', 'Mid2', 'Bottom']);
  const c = { id: 'cU1', ref: 'U1', footprint: 'SO20', layer: 'Top', x: 20, y: 15, rot: 0, pads: [] };
  eb.components.push(c);
  let n = 0;
  for (const y of [12.3, 17.7]) for (let i = 0; i < 10; i++) pad(eb, 'U1', String(c.pads.length + 1), 14.285 + i * 1.27, y, { net: i % 2 === 0 ? 'GND' : 'S' + (++n), w: 0.6, h: 1.6 });
  for (let i = 0; i < 6; i++) pad(eb, 'C' + i, '2', 6 + i * 5, 4, { net: 'GND', w: 1.0, h: 1.2 });
  eb.polygons.push({ id: 'pgG', nome: 'GND_Mid2', layer: 'Mid2', net: 'GND', pts: [[0, 0], [40, 0], [40, 30], [0, 30]], pour: 'solid', clearance: 0.3,
                     conexao: { tipo: 'relief', condutores: 4, largura: 0.3, gap: 0.3 } });
  const ebP = AR.redespeja(eb, []);
  const r = AR.fanout(ebP, { regras: S, net: 'GND' });
  assert.strictEqual(r.pads, 16);
  assert.strictEqual(r.feitos, 16, JSON.stringify(r.falhas));
  assert.strictEqual(r.depois.ligados, 16, 'sem plano depois: ' + r.depois.semPlano.join(', '));
  const vias = r.ops.filter(o => o.op === 'via_add');
  let m = Infinity;
  for (let i = 0; i < vias.length; i++) for (let j = i + 1; j < vias.length; j++) m = Math.min(m, Math.hypot(vias[i].x - vias[j].x, vias[i].y - vias[j].y) - vias[i].drill / 2 - vias[j].drill / 2);
  assert.ok(m >= 0.254 - 1e-6, 'furo a furo de ' + m.toFixed(3) + ' mm entre duas vias do fanout');
  /* nenhuma via em pad SMD, e as do SO-20 saem para FORA do componente */
  for (const v of vias) for (const p of [].concat(...eb.components.map(k => k.pads)))
    assert.ok(!(Math.abs(v.x - p.x) < p.w / 2 + v.size / 2 - 1e-6 && Math.abs(v.y - p.y) < p.h / 2 + v.size / 2 - 1e-6), `via ${v.x},${v.y} sobre o pad ${p.name}`);
  const doU1 = vias.filter(v => v.y > 9 && v.y < 21);
  assert.ok(doU1.every(v => Math.abs(v.y - 15) > 2.7 || Math.abs(v.x - 20) > 6), 'via do SO-20 por dentro do componente: ' + JSON.stringify(doU1));
  assert.deepStrictEqual(novas(ebP, r.ops, S).map(v => v.msg), []);
  /* de novo: todos já chegam ao plano */
  const r2 = AR.fanout(AR.redespeja(ebP, r.ops, { regras: S }), { regras: S, net: 'GND' });
  assert.strictEqual(r2.jaLigados, 16); assert.strictEqual(r2.feitos, 0);
  console.log(`    ${r.feitos} vias, ${r.comprimento} mm de trilha, menor furo a furo ${m.toFixed(3)} mm, ${r.ms} ms`);
});

/* ---------------- 20: via em pad SMD e faixa estreita ---------------- */
caso('20: a via não cai no pad SMD (viaEmPad:true deixa)', () => {
  const S = CASA();
  const eb = placaBase(30, 20, ['Top', 'Bottom']);
  /* pads tampados (a ponte de máscara não barra): só a regra nova tira a via do pad */
  const A = pad(eb, 'J1', '1', 5, 10, { net: 'S', w: 1.6, h: 1.6, tentTop: true });
  const B = pad(eb, 'J2', '1', 5, 10, { net: 'S', w: 1.6, h: 1.6, layer: 'Bottom', tentBot: true });
  const q = 2.0, anel = [[5 - q, 10 - q], [5 + q, 10 - q], [5 + q, 10 + q], [5 - q, 10 + q]];
  anel.forEach((a, i) => { const b = anel[(i + 1) % 4]; eb.tracks.push({ id: 'tw' + i, layer: 'Top', x1: a[0], y1: a[1], x2: b[0], y2: b[1], w: 0.3, net: 'X' }); });
  temNet(eb, 'X');
  const emPad = ops => ops.filter(o => o.op === 'via_add' && [A, B].some(p => Math.abs(o.x - p.x) < p.w / 2 + o.size / 2 - 1e-6 && Math.abs(o.y - p.y) < p.h / 2 + o.size / 2 - 1e-6)).length;
  const livre = AR.rotearLote(eb, { regras: S, viaEmPad: true });
  const pad0 = AR.rotearLote(eb, { regras: S });
  assert.strictEqual(livre.roteadas, 1); assert.strictEqual(pad0.roteadas, 1, JSON.stringify(pad0.falhas));
  assert.strictEqual(emPad(livre.ops), 1, 'com viaEmPad:true a via mais barata é no pad');
  assert.strictEqual(emPad(pad0.ops), 0, 'a via caiu no pad SMD');
  console.log(`    viaEmPad:true -> via no pad; padrão -> ${pad0.ops.filter(o => o.op === 'via_add').map(o => o.x + ',' + o.y).join(' ')}`);
});
caso('20: faixa estreita de plano — HubPcbPour.estreitas e o fanout que não fura a faixa', () => {
  const z = PO.estreitas([{ pts: [[0, 0], [20, 0], [20, 4.5], [30, 4.5], [30, 5.5], [20, 5.5], [20, 10], [0, 10]] }], 3, 0.5);
  assert.strictEqual(z.length, 1, 'a faixa de 1 mm é uma zona só');
  const xs = z[0].pts.map(p => p[0]);
  assert.ok(Math.min(...xs) >= 19.4 && Math.max(...xs) <= 30 + 1e-9, 'a zona é a faixa (mais a margem): ' + JSON.stringify([Math.min(...xs), Math.max(...xs)]));
  assert.strictEqual(PO.estreitas([{ pts: [[0, 0], [20, 0], [20, 10], [0, 10]] }], 3, 0.5).length, 0, 'retângulo largo não tem faixa estreita');
  const S = CASA();
  const eb = placaBase(40, 20, ['Top', 'Mid2', 'Bottom']);
  pad(eb, 'C1', '2', 25, 7, { net: 'GND', w: 1.0, h: 1.2 });
  eb.polygons.push({ id: 'pg74', nome: 'P74', layer: 'Mid2', net: 'GND', pts: [[0, 0], [12, 0], [12, 3.05], [38, 3.05], [38, 4.95], [12, 4.95], [12, 20], [0, 20]], pour: 'solid',
                     clearance: 0.3, conexao: { tipo: 'relief', largura: 0.3, gap: 0.3 } });
  const ebP = AR.redespeja(eb, []);
  const r = AR.fanout(ebP, { regras: S, net: 'GND' });
  assert.strictEqual(r.feitos, 0, 'a via caiu na faixa estreita: ' + JSON.stringify(r.ops));
  assert.deepStrictEqual(r.falhas.map(f => f.motivo), ['sem-lugar']);
  const r0 = AR.fanout(ebP, { regras: S, net: 'GND', faixaPlano: 0 });
  assert.strictEqual(r0.feitos, 1, 'sem a regra da faixa a via cabe nela');
  console.log(`    faixa de 1,9 mm: padrão sem via; faixaPlano:0 -> via em ${r0.ops.filter(o => o.op === 'via_add').map(o => o.x + ',' + o.y).join(' ')}`);
});

if (falhou) { console.log(`test-autoroteador-planos FALHOU (${falhou})`); process.exit(1); }
console.log('test-autoroteador-planos OK');
