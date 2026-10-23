const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Pour = require('../hub-pcbpour.js');
const HubCore = require('../hub-core.js');
const G = require('../hub-gerber.js');

/* O polygon pour do hub (hub-pcbpour.js), numa placa SINTETICA escrita aqui: folga para cobre de
   outra net (trilha, arco, via, pad girado), termico (vazio + raios) e direct, recorte da placa e
   de poligono, keepout, cobre morto, ilha pequena, pescoco, ordem entre poligonos, camada que nao e
   de cobre, a assinatura ("modified") e o caminho ate o Gerber. A fidelidade contra o Altium e o
   tools/pour/compara.js (precisa do acervo); se POUR_JSON apontar para uma saida do
   tools/pour/pour_extrai.py, ela roda aqui tambem. */

const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ': ' + a + ' != ' + b);
function dentroPoli(p, x, y) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
const cobre = (regs, x, y) => regs.some(g => dentroPoli(g.pts, x, y) && !(g.holes || []).some(h => dentroPoli(h, x, y)));
const area = regs => regs.reduce((s, g) => {
  const a = p => { let t = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) t += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(t) / 2; };
  return s + a(g.pts) - (g.holes || []).reduce((u, h) => u + a(h), 0);
}, 0);

function placa(extra) {
  const B = {
    format: 'pcbmirror-v1', exporter: 'teste', units: 'mm',
    board: { bbox: { x1: 0, y1: 0, x2: 40, y2: 30 },
             outline: [{ kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 }, { kind: 'line', x1: 40, y1: 0, x2: 40, y2: 30 },
                       { kind: 'line', x1: 40, y1: 30, x2: 0, y2: 30 }, { kind: 'line', x1: 0, y1: 30, x2: 0, y2: 0 }] },
    nets: ['GND', 'SIG', 'VCC'], layers: [], rules: { clearance: 0.254 },
    components: [], freepads: [], tracks: [], arcs: [], vias: [], texts: [], silk: [], regions: [], cutouts: [], fills: [], lines: [],
  };
  for (const k of Object.keys(extra || {})) B[k] = extra[k];
  return HubCore.effectiveBoard(B, HubCore.applyPcbChanges(B, []));
}
const POL = (o) => Object.assign({ id: 'p1', nome: 'GND_L01_P000', layer: 'Top', net: 'GND',
  pts: [[1, 1], [39, 1], [39, 29], [1, 29]], pour: 'solid', ordem: 0, pourOver: 'all', removeDead: false,
  removeNecks: true, neck: 0.127, minArea: 1.6129, arco: 0.0127, clearance: 0.254, clearanceBorda: 0,
  conexao: { tipo: 'relief', condutores: 4, largura: 0.254, gap: 0.254, angulo: 90 } }, o || {});

/* ---- 1. vazio: so o contorno ---- */
{
  const eb = placa();
  const r = Pour.despeja(eb, POL());
  assert.strictEqual(r.regioes.length, 1);
  perto(r.area, 38 * 28, 1e-3, 'area do contorno');
  const g = r.regioes[0];
  assert.deepStrictEqual([g.layer, g.net, g.poly, g.de], ['Top', 'GND', true, 'p1']);
  assert.ok(Array.isArray(g.holes) && g.holes.length === 0);
  /* contorno maior que a placa: corta na placa (e na folga da borda) */
  const r2 = Pour.despeja(eb, POL({ pts: [[-5, -5], [45, -5], [45, 35], [-5, 35]], clearanceBorda: 0.5 }));
  perto(r2.area, 39 * 29, 0.01, 'contorno cortado pela placa menos a folga');
  console.log('  contorno e placa ok');
}

/* ---- 2. folga para cobre de outra net ---- */
{
  const eb = placa({
    tracks: [{ id: 't1', layer: 'Top', x1: 5, y1: 15, x2: 35, y2: 15, w: 0.5, net: 'SIG' },
             { id: 't2', layer: 'Bottom', x1: 5, y1: 20, x2: 35, y2: 20, w: 0.5, net: 'SIG' }],
    vias: [{ id: 'v1', x: 10, y: 25, size: 0.8, drill: 0.4, from: 'Top', to: 'Bottom', net: 'SIG' }],
    arcs: [{ id: 'a1', layer: 'Top', cx: 30, cy: 24, r: 2, sa: 0, ea: 180, w: 0.3, net: 'VCC' }],
    components: [{ id: 'c1', ref: 'U1', x: 20, y: 7, rot: 30, layer: 'Top',
                   pads: [{ id: 'c1p1', name: '1', layer: 'Top', type: 'smd', shape: 'rect', x: 20, y: 7, w: 3, h: 1, rot: 30, net: 'SIG' }] }],
  });
  const r = Pour.despeja(eb, POL());
  const R = r.regioes;
  assert.ok(!cobre(R, 20, 15), 'em cima da trilha');
  assert.ok(!cobre(R, 20, 15 + 0.25 + 0.2), 'dentro da folga');
  assert.ok(cobre(R, 20, 15 + 0.25 + 0.3), 'fora da folga');
  assert.ok(cobre(R, 20, 20), 'trilha de outra camada nao conta');
  assert.ok(!cobre(R, 10, 25 + 0.4 + 0.24), 'folga da via');
  assert.ok(cobre(R, 10, 25 + 0.4 + 0.3), 'fora da folga da via');
  assert.ok(!cobre(R, 30, 26.3), 'arco');
  assert.ok(cobre(R, 30, 24), 'centro do arco tem cobre');
  /* pad retangular girado 30 graus: a ponta do eixo maior (1,5 mm) + folga */
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  assert.ok(!cobre(R, 20 + c * 1.7, 7 + s * 1.7), 'pad girado: dentro da folga na ponta');
  assert.ok(cobre(R, 20 + c * 1.8, 7 + s * 1.8), 'pad girado: fora da folga na ponta');
  assert.ok(cobre(R, 20 + c * 1.6 - s * 0.9, 7 + s * 1.6 + c * 0.9), 'pad girado: ao lado');
  /* folga por tipo e por net (a matriz e as regras por net do Altium) */
  const r2 = Pour.despeja(eb, POL({ clearanceTipo: { track: 0.6 } }));
  assert.ok(!cobre(r2.regioes, 20, 15 + 0.25 + 0.5), 'clearanceTipo.track');
  const r3 = Pour.despeja(eb, POL({ clearanceNet: { VCC: { '*': 1 } } }));
  assert.ok(!cobre(r3.regioes, 30, 24 + 2 + 0.15 + 0.9), 'clearanceNet');
  assert.ok(cobre(r3.regioes, 20, 15 + 0.25 + 0.3), 'clearanceNet nao mexe nas outras');
  console.log('  folgas ok (trilha, via, arco, pad girado, por tipo e por net)');
}

/* ---- 3. mesma net: termico e direct ---- */
{
  const eb = placa({
    components: [{ id: 'c1', ref: 'J1', x: 10, y: 10, rot: 0, layer: 'Top',
                   pads: [{ id: 'c1p1', name: '1', layer: 'Multi', type: 'th', shape: 'circle', x: 10, y: 10, w: 2, h: 2, rot: 0, drill: 1, net: 'GND' },
                          { id: 'c1p2', name: '2', layer: 'Multi', type: 'th', shape: 'circle', x: 20, y: 10, w: 2, h: 2, rot: 0, drill: 1, net: 'GND' }] }],
    vias: [{ id: 'v1', x: 30, y: 10, size: 1, drill: 0.5, from: 'Top', to: 'Bottom', net: 'GND' }],
  });
  const pol = POL({ conexaoVia: { tipo: 'direct' }, conexaoObj: { c1p2: { tipo: 'relief', condutores: 4, largura: 0.3, gap: 0.3, angulo: 45 } } });
  const R = Pour.despeja(eb, pol).regioes;
  assert.ok(cobre(R, 10 + 1.13, 10), 'raio a 0 grau');
  assert.ok(cobre(R, 10, 10 + 1.13), 'raio a 90 graus');
  const d = 1.13 / Math.SQRT2;
  assert.ok(!cobre(R, 10 + d, 10 + d), 'vazio a 45 graus');
  assert.ok(cobre(R, 10 + 1.4, 10 + 1.4), 'fora do vazio');
  /* o outro pad: 45 graus, largura e gap proprios (conexaoObj) */
  assert.ok(cobre(R, 20 + 1.15 * Math.SQRT1_2, 10 + 1.15 * Math.SQRT1_2), 'raio a 45 graus');
  assert.ok(!cobre(R, 20 + 1.15, 10), 'vazio a 0 grau no pad de 45');
  /* via direct: cobre por cima */
  assert.ok(cobre(R, 30, 10) && cobre(R, 30.6, 10), 'via direct');
  /* tudo direct */
  const R2 = Pour.despeja(eb, POL({ conexao: { tipo: 'direct' } })).regioes;
  assert.ok(cobre(R2, 10 + 1.13 / Math.SQRT2, 10 + 1.13 / Math.SQRT2), 'direct sem vazio');
  /* 2 condutores */
  const R3 = Pour.despeja(eb, POL({ conexao: { tipo: 'relief', condutores: 2, largura: 0.254, gap: 0.254, angulo: 90 } })).regioes;
  assert.ok(cobre(R3, 10 + 1.13, 10) && !cobre(R3, 10, 10 + 1.13), '2 condutores: 0 e 180');
  /* raio que nao chega a cobre nenhum nao entra: pad cercado de trilha de outra net por cima */
  const eb4 = placa({
    components: [{ id: 'c1', ref: 'J1', x: 10, y: 10, rot: 0, layer: 'Top',
                   pads: [{ id: 'c1p1', name: '1', layer: 'Multi', type: 'th', shape: 'circle', x: 10, y: 10, w: 2, h: 2, rot: 0, drill: 1, net: 'GND' }] }],
    tracks: [{ id: 't1', layer: 'Top', x1: 5, y1: 11.7, x2: 15, y2: 11.7, w: 0.5, net: 'SIG' }],
  });
  const R4 = Pour.despeja(eb4, POL()).regioes;
  assert.ok(!cobre(R4, 10, 11.15), 'raio bloqueado por trilha de outra net');
  assert.ok(cobre(R4, 11.15, 10), 'os outros raios ficam');
  console.log('  termico e direct ok (pad, via, por objeto, 45 graus, 2 condutores, raio bloqueado)');
}

/* ---- 4. recortes, keepout, camada sem cobre ---- */
{
  const quad = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
  const eb = placa({
    cutouts: [{ id: 'k1', layer: 'Multi', incomp: false, points: quad(10, 10, 1), kindn: 3 },
              { id: 'k2', layer: 'Top', incomp: false, points: quad(20, 10, 1), kindn: 1 },
              { id: 'k3', layer: 'Bottom', incomp: false, points: quad(30, 10, 1), kindn: 1 },
              { id: 'k4', layer: 'Multi', incomp: false, points: quad(20, 15, 30), kindn: -1 }],
    tracks: [{ id: 't1', layer: 'KeepOut', x1: 5, y1: 22, x2: 35, y2: 22, w: 0.2, net: '', keepout: true }],
    regions: [{ id: 'g1', layer: 'TopOverlay', points: quad(30, 25, 1) }],
  });
  const R = Pour.despeja(eb, POL({ clearanceBorda: 0.3 })).regioes;
  assert.ok(!cobre(R, 10, 10) && !cobre(R, 11.2, 10) && cobre(R, 11.4, 10), 'board cutout com a folga da borda');
  assert.ok(!cobre(R, 20, 10) && cobre(R, 21.1, 10), 'recorte de poligono na camada');
  assert.ok(cobre(R, 30, 10), 'recorte de poligono de outra camada');
  assert.ok(cobre(R, 20, 15), 'a regiao da placa (kindn -1) nao e furo');
  assert.ok(!cobre(R, 20, 22) && !cobre(R, 20, 22.3) && cobre(R, 20, 22.4), 'keepout');
  assert.ok(cobre(R, 30, 25), 'serigrafia nao e obstaculo de cobre');
  /* poligono na serigrafia: so contorno e recortes */
  const S = Pour.despeja(eb, POL({ layer: 'TopOverlay', net: '' })).regioes;
  assert.ok(cobre(S, 30, 25) && cobre(S, 20, 22) && !cobre(S, 10, 10), 'poligono fora do cobre');
  assert.strictEqual(S[0].net, '');
  console.log('  recortes, keepout e camada sem cobre ok');
}

/* ---- 5. cobre morto, ilha pequena, pescoco ---- */
{
  /* duas trilhas de outra net cortam a placa: a faixa do meio nao tem pad GND */
  const eb = placa({
    tracks: [{ id: 't1', layer: 'Top', x1: 0, y1: 10, x2: 40, y2: 10, w: 0.5, net: 'SIG' },
             { id: 't2', layer: 'Top', x1: 0, y1: 20, x2: 40, y2: 20, w: 0.5, net: 'SIG' },
             { id: 't3', layer: 'Top', x1: 0, y1: 26, x2: 40, y2: 26, w: 0.5, net: 'SIG' },
             { id: 't4', layer: 'Top', x1: 0, y1: 27.4, x2: 40, y2: 27.4, w: 0.5, net: 'SIG' }],
    vias: [{ id: 'v1', x: 5, y: 5, size: 0.8, drill: 0.4, from: 'Top', to: 'Bottom', net: 'GND' }],
  });
  const vivo = Pour.despeja(eb, POL({ removeDead: false, minArea: 0, removeNecks: false })).regioes;
  assert.strictEqual(vivo.length, 5, 'cinco faixas');
  const morto = Pour.despeja(eb, POL({ removeDead: true, minArea: 0, removeNecks: false })).regioes;
  assert.strictEqual(morto.length, 1, 'so a faixa com a via');
  assert.ok(cobre(morto, 5, 3) && !cobre(morto, 5, 15));
  /* a faixa entre 26 e 27,4 (0,4 - 2 x 0,254 - 0,5 = estreita): o pescoco a tira */
  const comPescoco = Pour.despeja(eb, POL({ removeDead: false, minArea: 0, removeNecks: true, neck: 0.5 })).regioes;
  assert.ok(!cobre(comPescoco, 20, 26.7), 'faixa mais estreita que o pescoco sai');
  /* ilha pequena: a faixa de cima (27,9 .. 29) tem 38 x 1,1 mm = 42 mm²; com minArea 45 sai */
  const semIlha = Pour.despeja(eb, POL({ removeDead: false, minArea: 45, removeNecks: false })).regioes;
  assert.ok(!cobre(semIlha, 20, 28.5) && cobre(semIlha, 20, 15), 'ilha menor que minArea');
  /* trilha da mesma net: no 'all' o cobre passa por cima; no 'none' com relief, vira obstaculo */
  const eb2 = placa({ tracks: [{ id: 't1', layer: 'Top', x1: 5, y1: 15, x2: 35, y2: 15, w: 0.5, net: 'GND' }] });
  assert.ok(cobre(Pour.despeja(eb2, POL()).regioes, 20, 15), 'pourOver all');
  assert.ok(!cobre(Pour.despeja(eb2, POL({ pourOver: 'none' })).regioes, 20, 15.4), 'pourOver none + relief');
  assert.ok(cobre(Pour.despeja(eb2, POL({ pourOver: 'polygons', conexao: { tipo: 'direct' } })).regioes, 20, 15), 'polygons + direct');
  console.log('  cobre morto, pescoco, ilha e mesma net ok');
}

/* ---- 6. ordem entre poligonos e assinatura ---- */
{
  const eb = placa({ tracks: [{ id: 't1', layer: 'Top', x1: 5, y1: 15, x2: 35, y2: 15, w: 0.5, net: 'SIG' }] });
  eb.polygons = [
    POL({ id: 'p2', net: 'GND', ordem: 1 }),
    POL({ id: 'p1', net: 'VCC', ordem: 0, pts: [[20, 1], [39, 1], [39, 29], [20, 29]] }),
  ];
  const T = Pour.despejaTodos(eb);
  const vcc = T.porPoligono.p1.regioes, gnd = T.porPoligono.p2.regioes;
  assert.ok(cobre(vcc, 30, 5) && !cobre(gnd, 30, 5), 'o de ordem menor fica com a area');
  assert.ok(!cobre(gnd, 19.8, 5) && cobre(gnd, 19.6, 5), 'o seguinte o evita com a folga');
  assert.strictEqual(T.regioes.length, vcc.length + gnd.length);
  assert.ok(T.regioes.every(g => g.de === 'p1' || g.de === 'p2'));
  /* despeja() sozinho despeja antes os de ordem menor */
  const so = Pour.despeja(eb, eb.polygons[0]).regioes;
  perto(area(so), area(gnd), 1e-6, 'despeja sozinho = despejaTodos');
  /* assinatura: muda com trilha perto, nao com objeto longe ou em outra camada */
  const pol = eb.polygons[0];
  pol.hash = Pour.assinatura(eb, pol);
  assert.strictEqual(T.porPoligono.p2.hash, pol.hash);
  assert.ok(!Pour.desatualizado(eb, pol));
  const longe = JSON.parse(JSON.stringify(eb)); longe.tracks.push({ id: 't9', layer: 'Bottom', x1: 1, y1: 1, x2: 2, y2: 2, w: 0.2, net: 'SIG' });
  assert.ok(!Pour.desatualizado(longe, pol), 'trilha em outra camada');
  const mexeu = JSON.parse(JSON.stringify(eb)); mexeu.tracks[0].y1 = mexeu.tracks[0].y2 = 16;
  assert.ok(Pour.desatualizado(mexeu, pol), 'trilha movida');
  const outroPol = JSON.parse(JSON.stringify(eb)); outroPol.polygons[1].pts[0][0] = 21;
  assert.ok(Pour.desatualizado(outroPol, pol), 'poligono anterior mudou');
  assert.ok(Pour.desatualizado(eb, Object.assign({}, pol, { clearance: 0.3 })), 'regra do proprio poligono');
  assert.ok(Pour.desatualizado(eb, Object.assign({}, pol, { hash: undefined })), 'sem hash = desatualizado');
  /* arquivado (Shelved) nao despeja */
  assert.strictEqual(Pour.despeja(eb, POL({ pour: 'none' })).regioes.length, 0);
  console.log('  ordem e assinatura ok');
}

/* ---- 7. do despejo ao Gerber ---- */
{
  const B = {
    format: 'pcbmirror-v1', exporter: 'teste', units: 'mm', source: 'C:\\teste.PcbDoc',
    board: { bbox: { x1: 0, y1: 0, x2: 40, y2: 30 },
             outline: [{ kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 }, { kind: 'line', x1: 40, y1: 0, x2: 40, y2: 30 },
                       { kind: 'line', x1: 40, y1: 30, x2: 0, y2: 30 }, { kind: 'line', x1: 0, y1: 30, x2: 0, y2: 0 }] },
    nets: ['GND', 'SIG'], layers: [], rules: {},
    components: [], freepads: [], arcs: [], vias: [], texts: [], silk: [], cutouts: [], fills: [], lines: [],
    tracks: [{ id: 't1', layer: 'Top', x1: 5, y1: 15, x2: 35, y2: 15, w: 0.5, net: 'SIG' }],
    /* o despejo velho do espelho: um retangulo que a trilha atravessa (o curto do G3) */
    regions: [{ id: 'g1', layer: 'Top', net: 'GND', points: [[1, 1], [39, 1], [39, 29], [1, 29]], poly: true }],
  };
  const eb = HubCore.effectiveBoard(B, HubCore.applyPcbChanges(B, []));
  eb.polygons = [POL()];
  const T = Pour.despejaTodos(eb);
  const nova = Pour.placaSemDespejoVelho(eb, T.regioes);
  assert.ok(!nova.regions.some(g => g.id === 'g1'), 'o despejo velho saiu');
  assert.strictEqual(nova.regions.filter(g => g.poly).length, T.regioes.length);
  assert.ok(nova.regions.every(g => Array.isArray(g.points)));
  const out = G.gerar(nova, { guid: '00000000-1111-4222-8333-444444444444' });
  const top = out.arquivos.find(a => /copper_signal_top/i.test(a.nome));
  assert.ok(top && top.contagens.regioes >= 1, 'regiao no cobre de cima');
  console.log('  placa para o Gerber ok (' + top.contagens.regioes + ' regioes no Top)');
}

/* ---- 8. desempenho: placa tipica (300 pads, 800 trilhas, 100 vias) < 1 s ---- */
{
  const comps = [], tracks = [], vias = [];
  let k = 0;
  for (let i = 0; i < 30; i++) for (let j = 0; j < 10; j++) {
    const x = 5 + i * 3, y = 5 + j * 6, net = (i + j) % 3 === 0 ? 'GND' : 'N' + (k % 40);
    comps.push({ id: 'c' + k, ref: 'R' + k, x, y, rot: 0, layer: 'Top',
                 pads: [{ id: 'c' + k + 'p1', name: '1', layer: 'Top', type: 'smd', shape: 'roundrect', radius: 0.1, x, y, w: 0.9, h: 1.2, rot: (i * 15) % 90, net }] });
    k++;
  }
  /* 800 trilhas curtas em faixas (roteamento de verdade nao se cruza na mesma camada) */
  for (let i = 0; i < 800; i++) { const x = 2.5 + (i % 32) * 3, y = 2.2 + Math.floor(i / 32) * 2.6;
    tracks.push({ id: 't' + i, layer: 'Top', x1: x, y1: y, x2: x + 2, y2: y + (i % 3 ? 0 : 1), w: 0.25, net: 'N' + (i % 40) }); }
  for (let i = 0; i < 100; i++) vias.push({ id: 'v' + i, x: 3 + (i * 9) % 95, y: 3 + (i * 13) % 60, size: 0.6, drill: 0.3, from: 'Top', to: 'Bottom', net: i % 4 ? 'N' + i % 40 : 'GND' });
  const B = {
    format: 'pcbmirror-v1', exporter: 'teste', units: 'mm',
    board: { bbox: { x1: 0, y1: 0, x2: 100, y2: 70 },
             outline: [{ kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 }, { kind: 'line', x1: 100, y1: 0, x2: 100, y2: 70 },
                       { kind: 'line', x1: 100, y1: 70, x2: 0, y2: 70 }, { kind: 'line', x1: 0, y1: 70, x2: 0, y2: 0 }] },
    nets: [], layers: [], rules: {}, components: comps, freepads: [], tracks, arcs: [], vias, texts: [], silk: [], regions: [], cutouts: [], fills: [], lines: [],
  };
  const eb = HubCore.effectiveBoard(B, HubCore.applyPcbChanges(B, []));
  Pour.despeja(eb, POL({ pts: [[1, 1], [99, 1], [99, 69], [1, 69]] }));          /* aquece o JIT */
  const t0 = Date.now();
  const r = Pour.despeja(eb, POL({ pts: [[1, 1], [99, 1], [99, 69], [1, 69]], removeDead: true }));
  const ms = Date.now() - t0;
  assert.ok(r.regioes.length >= 1);
  assert.ok(ms < 1000, 'despejo em ' + ms + ' ms');
  console.log('  desempenho ok (' + ms + ' ms, ' + r.regioes.length + ' regioes)');
}

/* ---- 8b. o "sem plano" da vista: region_add polycut (o Polygon Pour Cutout do Altium) ---- */
{
  const B = {
    format: 'pcbmirror-v1', exporter: 'teste', units: 'mm',
    board: { bbox: { x1: 0, y1: 0, x2: 40, y2: 30 },
             outline: [{ kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 }, { kind: 'line', x1: 40, y1: 0, x2: 40, y2: 30 },
                       { kind: 'line', x1: 40, y1: 30, x2: 0, y2: 30 }, { kind: 'line', x1: 0, y1: 30, x2: 0, y2: 0 }] },
    nets: ['GND', 'SIG'], layers: [], rules: { clearance: 0.254 },
    components: [], freepads: [], arcs: [], vias: [], texts: [], silk: [], regions: [], cutouts: [], fills: [], lines: [],
    tracks: [{ id: 't1', layer: 'Top', x1: 12, y1: 15, x2: 28, y2: 15, w: 0.3, net: 'SIG' }],
  };
  const sem = pts => ({ op: 'region_add', polycut: true, layer: 'Top', pts });
  const plano = { op: 'poly_add', layer: 'Top', net: 'GND', removeDead: false, pts: [[1, 1], [39, 1], [39, 29], [1, 29]] };
  const ch = [plano, sem([[10, 10], [30, 10], [30, 20], [10, 20]]), Object.assign(sem([[2, 2], [6, 2], [6, 6], [2, 6]]), { layer: 'Multi' })];
  const M = HubCore.applyPcbChanges(B, ch);
  assert.deepStrictEqual(M.changeItems.map(i => i.status), ['ok', 'ok', 'ok'], JSON.stringify(M.changeItems.map(i => i.msg)));
  const eb = HubCore.effectiveBoard(B, M);
  const k = eb.cutouts.filter(c => c.kindn === 1);
  assert.deepStrictEqual(k.map(c => c.layer), ['Top', 'Multi'], 'o sem plano vira recorte de poligono (kindn 1) na camada pedida');
  const r = Pour.despeja(eb, eb.polygons[0]);
  assert.ok(!cobre(r.regioes, 20, 18), 'o plano nao entra no sem plano');
  assert.ok(!cobre(r.regioes, 4, 4), 'nem no sem plano da Multi');
  assert.ok(cobre(r.regioes, 35, 25), 'fora dele o plano continua');
  /* nao e furo: o laser/PDF e o Gerber nao cortam, e a trilha que passa no meio nao e violacao */
  const L = require('../hub-laser.js');
  assert.strictEqual(L.boardCutouts(eb).length, 0, 'recorte de poligono nao e furo da placa');
  const D = require('../hub-pcbdrc.js');
  const d = D.rodar(eb, null, { tipos: ['BoardOutlineClearance'] });
  assert.strictEqual(d.total, 0, 'a trilha no sem plano nao e violacao de contorno: ' + d.violacoes.map(v => v.msg).join(' | '));
  /* camada que nao e cobre: recusa */
  const ruim = HubCore.applyPcbChanges(B, [Object.assign(sem([[2, 2], [6, 2], [6, 6]]), { layer: 'TopOverlay' })]);
  assert.strictEqual(ruim.changeItems[0].status, 'err');
  console.log('  sem plano (polycut) ok');
}

/* ---- 9. opcional: uma placa real extraida pelo tools/pour/pour_extrai.py ---- */
if (process.env.POUR_JSON && fs.existsSync(process.env.POUR_JSON)) {
  const { compara } = require(path.join(__dirname, '..', 'tools', 'pour', 'compara.js'));
  const r = compara(process.env.POUR_JSON);
  for (const l of r.linhas) {
    assert.ok(l.pct !== null && l.pct < 2, l.id + ' XOR ' + l.pct + '%');
    console.log('  ' + r.arq + ' ' + l.id + ' ' + l.nome + ': XOR ' + l.pct + '% (' + l.ms + ' ms)');
  }
} else console.log('  placa real PULADA (POUR_JSON nao definido)');

console.log('test-pcbpour: ok');
