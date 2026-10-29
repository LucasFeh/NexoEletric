/* A SUAVIZAÇÃO A 45° SEM SOLTAR RAMO (hub-suaviza45.js, P3 item 21) e a CHECAGEM DE POSICIONAMENTO
   (hub-posiciona.js, P3 item 22), em placas sintéticas:
     node tests/test-suaviza45.js

   21  uma rota em escada (o A* de grade) com um RAMO que chega no meio de um degrau e uma VIA pendurada
       no meio de outro: a suavização encurta a rota e tira os vértices, e o ramo e a via continuam
       tocando — uma ilha só, nenhuma ponta solta (NetAntennae), DRC sem violação nova. A suavização
       ingênua (a rota inteira puxada de ponta a ponta) solta os dois — é o que o teste mostra antes;
       modo chanfro: os cantos de 90° viram chanfros de 45°, nada mais; a trilha nova não passa por cima
       de pad da mesma net que ela não tocava; trecho que já violava folga fica como está;
   22  confere: colisão pela ComponentClearance (sobrepostos e perto demais), só do mesmo lado, só os
       pares dos refs pedidos, fora da placa e sobre recorte; novas = só o que o lote criou. */
'use strict';
const assert = require('assert');
const SV = require('../hub-suaviza45.js');
const PS = require('../hub-posiciona.js');
const HR = require('../hub-roteador.js');
const RG = require('../hub-pcbregras.js');
const DRC = require('../hub-pcbdrc.js');
const NETS = require('../hub-pcbnets.js');

let falhou = 0;
function caso(nome, fn){
  try { fn(); console.log('ok  ' + nome); }
  catch (e) { falhou++; console.log('FALHOU  ' + nome + '\n   ' + (e && e.stack || e).toString().split('\n').slice(0, 6).join('\n   ')); }
}
let seq = 0;
const id = p => p + (++seq);
function placaBase(W, H){
  const out = [[0, 0, W, 0], [W, 0, W, H], [W, H, 0, H], [0, H, 0, 0]].map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2 }));
  return { board: { bbox: { x1: 0, y1: 0, x2: W, y2: H }, outline: out }, layers: [{ key: 'Top' }, { key: 'Bottom' }],
           components: [], tracks: [], arcs: [], vias: [], fills: [], regions: [], texts: [], lines: [], silk: [], freepads: [], nets: ['S', 'X'], polygons: [], cutouts: [] };
}
function comp(eb, ref, x, y, o){
  const c = Object.assign({ id: id('c'), ref, footprint: 'FP', layer: 'Top', x, y, rot: 0, pads: [] }, o || {});
  eb.components.push(c);
  return c;
}
function pad(eb, ref, x, y, net, o){
  const c = comp(eb, ref, x, y);
  c.pads.push(Object.assign({ id: id('p'), name: '1', x, y, w: 1.2, h: 1.2, shape: 'rect', layer: 'Top', type: 'smd', drill: 0, rot: 0, net }, o || {}));
  return c.pads[0];
}
const CASA = () => RG.normaliza(RG.padroesCasa());
/* a placa com as ops (track_del tira, track_add põe) */
function comOps(eb, ops){
  const sai = new Set(ops.filter(o => o.op === 'track_del').map(o => String(o.id)));
  return Object.assign({}, eb, { tracks: eb.tracks.filter(t => !sai.has(String(t.id))).concat(ops.filter(o => o.op === 'track_add').map((o, i) => Object.assign({ id: 'n' + i }, o))) });
}
const ilhas = (eb, net) => NETS.conexoes(eb).nets[net].ilhas.length;
const antenas = (eb, S) => DRC.rodar(eb, S, { modo: 'lote', tipos: ['NetAntennae'] }).violacoes.length;
const TIPOS = ['Clearance', 'ShortCircuit', 'Width', 'BoardOutlineClearance', 'NetAntennae'];
const chaveV = v => v.tipo + '|' + v.msg;

/* a escada de A (2,2) até B (30,20), um ramo de C que chega no meio do degrau horizontal de y=12, e uma
   via no meio do degrau vertical de x=18 */
function placaEscada(){
  const eb = placaBase(40, 30);
  pad(eb, 'A', 2, 2, 'S'); pad(eb, 'B', 30, 20, 'S'); pad(eb, 'C', 14, 26, 'S');
  const P = [[2, 2]];
  let x = 2, y = 2;
  while (x < 30 || y < 20) { if (x < 30) { x = Math.min(30, x + 2); P.push([x, y]); } if (y < 20) { y = Math.min(20, y + 2); P.push([x, y]); } }
  for (let i = 1; i < P.length; i++) eb.tracks.push({ id: id('t'), layer: 'Top', x1: P[i - 1][0], y1: P[i - 1][1], x2: P[i][0], y2: P[i][1], w: 0.3, net: 'S' });
  const deg = eb.tracks.find(t => t.y1 === t.y2 && t.y1 === 12);
  const xm = (deg.x1 + deg.x2) / 2;
  eb.tracks.push({ id: 'ramo1', layer: 'Top', x1: 14, y1: 26, x2: 14, y2: 20, w: 0.3, net: 'S' });
  eb.tracks.push({ id: 'ramo2', layer: 'Top', x1: 14, y1: 20, x2: xm, y2: 12, w: 0.3, net: 'S' });
  const dv = eb.tracks.find(t => t.x1 === t.x2 && t.x1 === 18);
  eb.vias.push({ id: 'v1', x: 18, y: (dv.y1 + dv.y2) / 2, size: 0.6, drill: 0.3, net: 'S', from: 'Top', to: 'Bottom' });
  return { eb, escada: P, ramoEm: [xm, 12], via: [18, (dv.y1 + dv.y2) / 2] };
}

caso('21: a escada suaviza e o ramo e a via continuam ligados (a ingênua os soltava)', () => {
  const S = CASA();
  const { eb, escada, ramoEm, via } = placaEscada();
  assert.strictEqual(ilhas(eb, 'S'), 1); assert.strictEqual(antenas(eb, S), 0);
  /* a INGÊNUA: a escada inteira puxada de ponta a ponta (o que a IA do relato fez) */
  const cena = HR.cena(eb, { regras: S }), M = HR.motor;
  const R = M.regraBase(cena, M.camada(cena, 'Top'), M.idDaNet(cena, 'S', false), null, 0.15, M.descMao('track', 'S', 'Top'));
  const ing = M.limpa(M.tiraDegraus(R, M.limpa(M.suaviza(R, escada, true, '45', 'diag').pts), '45', 0.3));
  const idsEscada = eb.tracks.filter(t => !String(t.id).startsWith('ramo')).map(t => ({ op: 'track_del', id: t.id }));
  const ebIng = comOps(eb, idsEscada.concat(ing.slice(1).map((p, i) => ({ op: 'track_add', layer: 'Top', x1: ing[i][0], y1: ing[i][1], x2: p[0], y2: p[1], w: 0.3, net: 'S' }))));
  const soltasIng = antenas(ebIng, S), ilhasIng = ilhas(ebIng, 'S');
  assert.ok(soltasIng > 0 || ilhasIng > 1, 'a ingênua devia soltar o ramo ou a via');
  /* a de verdade */
  const r = SV.suaviza(eb, { regras: S, nets: ['S'] });
  assert.ok(r.suavizadas >= 2 && r.ops.length, JSON.stringify(r));
  assert.deepStrictEqual(r.revertidas, []);
  const ebD = comOps(eb, r.ops);
  assert.strictEqual(ilhas(ebD, 'S'), 1, 'a net S partiu');
  assert.strictEqual(antenas(ebD, S), 0, 'ficou ponta solta');
  assert.ok(r.comprimento.depois < r.comprimento.antes - 5 && r.vertices.depois < r.vertices.antes / 2, JSON.stringify([r.comprimento, r.vertices]));
  /* o ponto do ramo e o da via continuam sobre a rota */
  const naRota = q => ebD.tracks.some(t => t.net === 'S' && Math.hypot(...(() => { const dx = t.x2 - t.x1, dy = t.y2 - t.y1, L2 = dx * dx + dy * dy; let u = L2 ? ((q[0] - t.x1) * dx + (q[1] - t.y1) * dy) / L2 : 0; u = Math.max(0, Math.min(1, u)); return [t.x1 + u * dx - q[0], t.y1 + u * dy - q[1]]; })()) < 1e-6);
  assert.ok(naRota(ramoEm), 'o ponto em que o ramo chegava saiu da rota');
  assert.ok(naRota(via), 'a via ficou fora da rota');
  /* só ângulos de 0/45/90 nas trilhas novas da escada */
  for (const o of r.ops.filter(x => x.op === 'track_add')) {
    const dx = Math.abs(o.x2 - o.x1), dy = Math.abs(o.y2 - o.y1);
    assert.ok(dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-5, 'perna fora de 45°: ' + JSON.stringify(o));
  }
  const d0 = new Set(DRC.rodar(eb, S, { modo: 'lote', tipos: TIPOS }).violacoes.map(chaveV));
  const nv = DRC.rodar(ebD, S, { modo: 'lote', tipos: TIPOS }).violacoes.filter(v => !d0.has(chaveV(v)));
  assert.deepStrictEqual(nv.map(v => v.msg), []);
  console.log(`    ingênua: ${ilhasIng} ilha(s), ${soltasIng} ponta(s) solta(s); hub: ${r.cadeias} cadeias, ${r.suavizadas} suavizadas, ${r.vertices.antes} -> ${r.vertices.depois} vértices, ${r.comprimento.antes} -> ${r.comprimento.depois} mm, 1 ilha, 0 soltas`);
});

caso('21: modo chanfro — só os cantos de 90° viram 45°', () => {
  const S = CASA();
  const eb = placaBase(30, 20);
  pad(eb, 'A', 2, 2, 'S'); pad(eb, 'B', 20, 15, 'S');
  for (const [x1, y1, x2, y2] of [[2, 2, 12, 2], [12, 2, 12, 15], [12, 15, 20, 15]]) eb.tracks.push({ id: id('t'), layer: 'Top', x1, y1, x2, y2, w: 0.3, net: 'S' });
  const r = SV.suaviza(eb, { regras: S, modo: 'chanfro', chanfro: 1 });
  const novas = r.ops.filter(o => o.op === 'track_add');
  assert.strictEqual(novas.length, 5, JSON.stringify(novas));
  const diag = novas.filter(o => Math.abs(Math.abs(o.x2 - o.x1) - Math.abs(o.y2 - o.y1)) < 1e-6 && Math.abs(o.x2 - o.x1) > 0);
  assert.strictEqual(diag.length, 2);
  assert.ok(diag.every(o => Math.abs(Math.abs(o.x2 - o.x1) - 1) < 1e-6), 'perna do chanfro de 1 mm');
  assert.strictEqual(ilhas(comOps(eb, r.ops), 'S'), 1);
});

caso('21: não passa por cima de pad da mesma net que não tocava; trecho em conflito fica', () => {
  const S = CASA();
  const eb = placaBase(30, 20);
  pad(eb, 'A', 2, 2, 'S'); pad(eb, 'B', 12, 12, 'S');
  /* um pad S no caminho da diagonal: a rota em L passa longe dele; puxar o fio passaria por cima */
  pad(eb, 'P', 7, 7, 'S', { w: 1.5, h: 1.5 });
  for (const [x1, y1, x2, y2] of [[2, 2, 12, 2], [12, 2, 12, 12]]) eb.tracks.push({ id: id('t'), layer: 'Top', x1, y1, x2, y2, w: 0.3, net: 'S' });
  const r = SV.suaviza(eb, { regras: S, nets: ['S'] });
  const ebD = comOps(eb, r.ops);
  const P = eb.components.find(c => c.ref === 'P').pads[0];
  for (const t of ebD.tracks) {
    const dx = t.x2 - t.x1, dy = t.y2 - t.y1, L2 = dx * dx + dy * dy;
    const u = Math.max(0, Math.min(1, ((P.x - t.x1) * dx + (P.y - t.y1) * dy) / L2));
    const qx = t.x1 + u * dx, qy = t.y1 + u * dy;
    assert.ok(Math.abs(qx - P.x) > P.w / 2 + t.w / 2 - 1e-6 || Math.abs(qy - P.y) > P.h / 2 + t.w / 2 - 1e-6, 'trilha por cima do pad P: ' + JSON.stringify(t));
  }
  /* o trecho que já viola a folga de outra net não muda */
  const eb2 = placaBase(30, 20);
  pad(eb2, 'A', 2, 2, 'S'); pad(eb2, 'B', 12, 12, 'S');
  for (const [x1, y1, x2, y2] of [[2, 2, 12, 2], [12, 2, 12, 12]]) eb2.tracks.push({ id: id('t'), layer: 'Top', x1, y1, x2, y2, w: 0.3, net: 'S' });
  eb2.tracks.push({ id: 'tx', layer: 'Top', x1: 4, y1: 2.3, x2: 9, y2: 2.3, w: 0.2, net: 'X' });
  const r2 = SV.suaviza(eb2, { regras: S, nets: ['S'] });
  assert.strictEqual(r2.suavizadas, 0); assert.strictEqual(r2.ops.length, 0);
  assert.strictEqual(r2.puladas['ja-em-conflito'], 1);
});

/* ---------------- 22 ---------------- */
caso('22: posicionamento — colisão, folga da regra, só do mesmo lado, refs, fora da placa e recorte', () => {
  const eb = placaBase(40, 30);
  const box = (x, y, w, h) => ({ x1: x - w / 2, y1: y - h / 2, x2: x + w / 2, y2: y + h / 2 });
  comp(eb, 'R1', 5, 5, { bbox: box(5, 5, 2, 1) });
  comp(eb, 'R2', 6, 5, { bbox: box(6, 5, 2, 1) });            /* sobreposto a R1 */
  comp(eb, 'R3', 8.1, 5, { bbox: box(8.1, 5, 2, 1) });        /* 0,1 mm de R2: perto demais para 0,254 */
  comp(eb, 'R4', 6, 5, { bbox: box(6, 5, 2, 1), layer: 'Bottom' });   /* do outro lado: não conta */
  comp(eb, 'R5', 39.5, 15, { bbox: box(39.5, 15, 2, 1) });    /* sai pela direita */
  comp(eb, 'R6', 20, 20, { bbox: box(20, 20, 4, 4) });        /* em cima de um furo */
  eb.cutouts.push({ points: [[19.5, 19.5], [20.5, 19.5], [20.5, 20.5], [19.5, 20.5]] });
  const r = PS.confere(eb, {});
  const pares = r.colisoes.map(c => c.a + '-' + c.b + (c.sobrepostos ? '!' : ''));
  assert.deepStrictEqual(pares.sort(), ['R1-R2!', 'R2-R3'].sort(), JSON.stringify(r.colisoes));
  assert.deepStrictEqual(r.fora.map(f => f.ref).sort(), ['R5', 'R6']);
  /* a ComponentClearance das regras (10 mil) e a folga dada */
  const S = CASA();
  assert.strictEqual(PS.confere(eb, { regras: S }).colisoes.length, 2);
  assert.strictEqual(PS.confere(eb, { folga: 0.05 }).colisoes.length, 1, 'com 0,05 mm só a sobreposição');
  /* refs: só os pares que tocam R3 */
  assert.deepStrictEqual(PS.confere(eb, { refs: ['R3'] }).colisoes.map(c => c.a + '-' + c.b), ['R2-R3']);
  /* novas: o que o "lote" criou */
  const antes = PS.confere(eb, {});
  const eb2 = JSON.parse(JSON.stringify(eb));
  const c3 = eb2.components.find(c => c.ref === 'R3'); c3.bbox = box(30, 5, 2, 1);
  const c1 = eb2.components.find(c => c.ref === 'R1'); c1.bbox = box(20, 25, 2, 1);
  const r6 = eb2.components.find(c => c.ref === 'R6'); r6.bbox = box(20.5, 25, 4, 4);   /* agora em cima de R1 */
  const nv = PS.novas(antes, PS.confere(eb2, {}));
  assert.deepStrictEqual(nv.colisoes.map(c => c.a + '-' + c.b), ['R1-R6']);
  assert.deepStrictEqual(nv.fora, []);
});

if (falhou) { console.log(`test-suaviza45 FALHOU (${falhou})`); process.exit(1); }
console.log('test-suaviza45 OK');
