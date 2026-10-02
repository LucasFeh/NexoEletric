const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const G = require('../hub-gerber.js');
const GV = require('../hub-gerberview.js');
const HubCore = require('../hub-core.js');
const { loadVar } = require('./load.js');

/* O gerador de Gerber X2 do hub (hub-gerber.js). Placa SINTETICA escrita aqui, cobrindo cada forma
   de pad e rotacao, via, arco, regiao com furo, fill, texto com e sem contorno, recorte, mascara,
   pasta e camada interna; o que sai e lido de volta pelo parser do visualizador (hub-gerberview.js).
   No fim, a placa real do repo (board.js do DMB) e - se a pasta da rede existir - os 139 pads
   conferidos contra o X2 que o Altium gerou (lido, nunca copiado para o repo). */

const GUID = '00000000-1111-4222-8333-444444444444';
const linhas = t => t.split('\r\n');
const temLinha = (t, l) => linhas(t).indexOf(l) >= 0;
const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol == null ? 1e-9 : tol), (msg || '') + ': ' + a + ' != ' + b);
const contar = cam => {
  const n = { flashes: 0, tracos: 0, arcos: 0, regioes: 0 };
  for (const p of cam.prims) n[p.k === 'flash' ? 'flashes' : p.k === 'line' ? 'tracos' : p.k === 'arc' ? 'arcos' : 'regioes']++;
  return n;
};
/* o corpo de uma macro, sem o numero do D-code (a numeracao e global e muda com a placa) */
function corpoDaMacro(texto, nome, primeira) {
  const L = linhas(texto);
  for (let i = 0; i < L.length; i++) {
    if (!new RegExp('^%AM' + nome + 'D\\d+\\*$').test(L[i])) continue;
    const corpo = [];
    for (let k = i + 1; k < L.length && L[k] !== '%'; k++) corpo.push(L[k]);
    if (!primeira || corpo[0] === primeira) return corpo;
  }
  return null;
}
/* as aberturas de um arquivo: {d -> descricao} e {d -> funcao} */
function aberturas(texto) {
  const out = {}, func = {};
  let f = null;
  for (const l of linhas(texto)) {
    let m;
    if ((m = /^%TA\.AperFunction,(.*)\*%$/.exec(l))) f = m[1];
    else if ((m = /^%ADD(\d+)(.*)\*%$/.exec(l))) { out[m[1]] = m[2]; func[m[1]] = f; }
  }
  return { out, func };
}
const md5Node = s => crypto.createHash('md5').update(Buffer.from(s, 'utf8')).digest('hex');
/* linhas de macro iguais as do Altium a menos de 1,5e-5 mm por numero: o Altium calcula em unidade
   interna (1e-7 pol) e as vezes a 5a casa sai 1 acima (0,01737 onde a conta em mm da 0,0173648) */
function macroPerto(obtido, esperado, msg) {
  assert.ok(obtido, msg + ': macro nao saiu');
  assert.strictEqual(obtido.length, esperado.length, msg + ': linhas');
  obtido.forEach((l, i) => {
    const a = l.replace(/\*$/, '').split(','), b = esperado[i].replace(/\*$/, '').split(',');
    assert.strictEqual(a.length, b.length, msg + ': ' + l);
    a.forEach((v, k) => {
      if (v === b[k]) return;
      assert.ok(Math.abs(+v - +b[k]) <= 1.5e-5 && /\.\d{5}$/.test(v), msg + ': ' + l + ' x ' + esperado[i]);
    });
  });
}

/* ═══════════ placa sintetica ═══════════ */
const OUTLINE = [
  { kind: 'line', x1: 0, y1: 1, x2: 1, y2: 0 },
  { kind: 'line', x1: 1, y1: 0, x2: 30, y2: 0 },
  { kind: 'arc', cx: 30, cy: -2, r: 2, sa: 0, ea: 90 },        /* percorrido do ea para o sa: G02 */
  { kind: 'line', x1: 32, y1: -2, x2: 32, y2: -4 },
  { kind: 'arc', cx: 34, cy: -4, r: 2, sa: 180, ea: 360 },     /* do sa para o ea: G03 */
  { kind: 'line', x1: 36, y1: -4, x2: 36, y2: -2 },
  { kind: 'arc', cx: 38, cy: -2, r: 2, sa: 90, ea: 180 },      /* do ea para o sa: G02 */
  { kind: 'line', x1: 38, y1: 0, x2: 49, y2: 0 },
  { kind: 'line', x1: 49, y1: 0, x2: 50, y2: 1 },
  { kind: 'line', x1: 50, y1: 1, x2: 50, y2: 39 },
  { kind: 'line', x1: 50, y1: 39, x2: 49, y2: 40 },
  { kind: 'line', x1: 49, y1: 40, x2: 1, y2: 40 },
  { kind: 'line', x1: 1, y1: 40, x2: 0, y2: 39 },
  { kind: 'line', x1: 0, y1: 39, x2: 0, y2: 1 },
  { kind: 'line', x1: 0, y1: 1, x2: 0, y2: 1 },                /* o Board6 fecha repetindo o 1o vertice */
];
function placa() {
  const smd = (id, o) => Object.assign({ id, name: id, layer: 'Top', type: 'smd', net: 'A' }, o);
  const th = (id, o) => Object.assign({ id, name: id, layer: 'Multi', type: 'th', net: 'B', holerot: 0 }, o);
  return {
    format: 'pcbmirror-v1', exporter: 'ExportBoard 2026-10', source: 'C:\\proj\\Placa Teste.PcbDoc', units: 'mm',
    board: { bbox: { x1: 0, y1: -6, x2: 50, y2: 40 }, outline: OUTLINE.map(s => Object.assign({}, s)) },
    layers: [{ key: 'Top', name: 'Top Layer', stack: 1 }, { key: 'Mid1', name: 'Mid-Layer 1', stack: 2, color: '#BC8E00' },
             { key: 'Mid2', name: 'Mid-Layer 2', stack: 3 }, { key: 'Bottom', name: 'Bottom Layer', stack: 4 }],
    rules: { sm: 0.1016, pm: 0 },
    nets: ['A', 'B', 'GND'],
    components: [
      { id: 'c1', ref: 'U1', layer: 'Top', x: 10, y: 10, rot: 0, pads: [
        smd('p1', { shape: 'rect', x: 10, y: 10, w: 0.82, h: 0.41, rot: 90 }),
        smd('p2', { shape: 'rect', x: 11, y: 10, w: 0.82, h: 0.41, rot: 0 }),
        smd('p3', { shape: 'rect', x: 12, y: 10, w: 1.6, h: 1.8, rot: 10 }),
        smd('p4', { shape: 'oval', x: 13, y: 10, w: 1.6, h: 1.8, rot: 10 }),
        smd('p5', { shape: 'rect', x: 14, y: 10, w: 2, h: 2, rot: 150 }),
        smd('p6', { shape: 'roundrect', radius: 0.051, x: 15, y: 10, w: 0.6, h: 1.45, rot: 90 }),
        smd('p7', { shape: 'roundrect', radius: 0.31107, x: 16, y: 10, w: 2.60278, h: 0.62213, rot: 270, sm: 0 }),
        smd('p8', { shape: 'roundrect', radius: 0.31107, x: 17, y: 10, w: 2.60278, h: 0.62213, rot: 90, sm: 0 }),
        smd('p9', { shape: 'circle', x: 18, y: 10, w: 1, h: 1, rot: 0, tentTop: true }),
        smd('p10', { shape: 'oval', x: 19, y: 10, w: 1.5, h: 1, rot: 90, nopaste: true }),
        smd('p11', { shape: 'octagon', x: 20, y: 10, w: 2, h: 2, rot: 0 }),
        smd('p12', { shape: 'rect', x: 21, y: 10, w: 1, h: 0.5, rot: 180, pm: -0.1 }),
      ] },
      { id: 'c2', ref: 'J1', layer: 'Top', x: 30, y: 10, rot: 0, pads: [
        th('q1', { shape: 'rect', x: 30, y: 10, w: 2, h: 0.6, rot: 270, drillshape: 'rect', drill: 0.4, drillw: 1.6, plated: true }),
        th('q2', { shape: 'circle', x: 32, y: 10, w: 1.8, h: 1.8, rot: 0, drillshape: 'circle', drill: 0.9, plated: true, bw: 2.4, bh: 2.4, bshape: 'circle' }),
        th('q3', { shape: 'oval', x: 34, y: 10, w: 2, h: 3, rot: 0, drillshape: 'oblong', drill: 1, drillw: 2, plated: true }),
        th('q4', { shape: 'circle', x: 36, y: 10, w: 3, h: 3, rot: 0, drillshape: 'circle', drill: 2, plated: false }),
        th('q5', { shape: 'circle', x: 38, y: 10, w: 1.5, h: 1.5, rot: 45, drillshape: 'circle', drill: 0.8 }),
      ] },
      { id: 'c3', ref: 'U2', layer: 'Bottom', x: 10, y: 30, rot: 0, pads: [
        { id: 'r1', name: '1', layer: 'Bottom', type: 'smd', shape: 'rect', x: 10, y: 30, w: 1, h: 2, rot: 0, sm: 0.05, pm: 0, net: '' },
      ] },
    ],
    freepads: [],
    tracks: [
      { id: 't1', layer: 'Top', x1: 1, y1: 1, x2: 5, y2: 1, w: 0.25, net: 'A' },
      { id: 't2', layer: 'Top', x1: 5, y1: 1, x2: 5, y2: 5, w: 0.25, net: 'A' },
      { id: 't3', layer: 'Top', x1: 6, y1: 6, x2: 6, y2: 6, w: 0.25, net: '' },
      { id: 't4', layer: 'Mid1', x1: 2, y1: 2, x2: 8, y2: 2, w: 0.2, net: '' },
      { id: 't5', layer: 'Bottom', x1: 1, y1: 3, x2: 9, y2: 3, w: 0.5, net: '' },
      { id: 't6', layer: 'Top', x1: 1, y1: 7, x2: 9, y2: 7, w: 0.3, net: '', keepout: true },
    ],
    arcs: [
      { id: 'a1', layer: 'Top', cx: 20, cy: 20, r: 2, sa: 0, ea: 90, w: 0.3, net: '' },
      { id: 'a2', layer: 'Bottom', cx: 25, cy: 20, r: 1, sa: 0, ea: 360, w: 0.2, net: '' },
    ],
    vias: [
      { id: 'v1', x: 5, y: 5, size: 0.5, drill: 0.3, from: 'Top', to: 'Bottom', net: 'A', tentTop: false, tentBot: true },
      { id: 'v2', x: 7, y: 5, size: 0.6, drill: 0.3, from: 'Top', to: 'Mid1', net: '' },
    ],
    texts: [
      { id: 'x1', layer: 'TopOverlay', x: 20, y: 30, text: 'AB', h: 1, rot: 0, mirror: false, w: 0.12, kind: 'stroke', designator: false, comment: false },
      { id: 'x2', layer: 'TopOverlay', x: 20, y: 33, text: 'CD', h: 1, rot: 0, mirror: false, designator: false, comment: false },
      { id: 'x3', layer: 'TopOverlay', x: 25, y: 30, text: 'O', h: 2, rot: 0, mirror: false, kind: 'truetype', font: 'Arial',
        polys: [{ hole: false, pts: [[24, 29], [26, 29], [26, 31], [24, 31]] }, { hole: true, pts: [[24.5, 29.5], [25.5, 29.5], [25.5, 30.5], [24.5, 30.5]] }] },
      { id: 'x4', layer: 'BottomOverlay', x: 17.5, y: 33, text: 'L1\r\nL2', h: 1, rot: 90, mirror: true, w: 0.1, ax: 19, ay: 34 },
      { id: 'x5', layer: 'Top', x: 40, y: 30, text: 'CU', h: 1, rot: 0, mirror: false, w: 0.2 },
    ],
    silk: [
      { id: 's1', layer: 'TopOverlay', kind: 'arc', cx: 30, cy: 30, r: 0.25, sa: 0, ea: 360, w: 0.5 },
      { id: 's2', layer: 'TopOverlay', kind: 'line', x1: 28, y1: 28, x2: 32, y2: 28, w: 0.2 },
      { id: 's3', layer: 'BottomOverlay', kind: 'line', x1: 28, y1: 28, x2: 32, y2: 28, w: 0.2 },
    ],
    lines: [
      { id: 'l1', layer: 'TopSolder', kind: 'line', x1: 40, y1: 5, x2: 44, y2: 5, w: 1 },
      { id: 'l2', layer: 'TopPaste', kind: 'line', x1: 40, y1: 7, x2: 44, y2: 7, w: 0.5 },
      { id: 'l3', layer: 'Mech1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0, w: 0.1 },
    ],
    fills: [
      { id: 'f1', layer: 'TopOverlay', x1: 40, y1: 20, x2: 42, y2: 21, rot: 0 },
      { id: 'f2', layer: 'TopOverlay', x1: 40, y1: 22, x2: 42, y2: 23, rot: 90 },
      { id: 'f3', layer: 'TopOverlay', x1: 40, y1: 24, x2: 42, y2: 25, rot: 30 },
      { id: 'f4', layer: 'Top', x1: 44, y1: 20, x2: 45, y2: 21, rot: 180, net: 'A' },
    ],
    regions: [
      { id: 'g1', layer: 'Top', net: 'GND', points: [[30, 30], [40, 30], [40, 38], [30, 38]], holes: [[[32, 32], [34, 32], [34, 34], [32, 34]]] },
      { id: 'g2', layer: 'Bottom', net: '', points: [[1, 1], [2, 1], [2, 1], [2, 2], [1, 2], [1, 1]] },
      { id: 'g3', layer: 'Top', net: '', points: [[0, 0], [1, 1]] },
    ],
    cutouts: [
      { id: 'k1', layer: 'Multi', incomp: false, points: [[44, 30], [46, 30], [46, 32], [44, 32]] },
      { id: 'k2', layer: 'Multi', incomp: false, points: [[0, -6], [50, -6], [50, 40], [0, 40]] },
      { id: 'k3', layer: 'Top', incomp: false, points: [[44, 34], [46, 34], [46, 36], [44, 36]] },
    ],
  };
}

(async () => {

const B = placa();
const res = G.gerar(B, { guid: GUID, vazias: true });
const porCamada = {};
for (const a of res.arquivos) porCamada[a.camada] = a;

/* ── o conjunto: 4 camadas de cobre, nomes da FABRICACAO (minusculas, espaco -> _) ── */
{
  assert.deepStrictEqual(res.arquivos.map(a => a.nome), [
    'placa_teste_copper_signal_top.gbr', 'placa_teste_copper_signal_1.gbr', 'placa_teste_copper_signal_2.gbr',
    'placa_teste_copper_signal_bot.gbr', 'placa_teste_pads_bot.gbr', 'placa_teste_pads_top.gbr',
    'placa_teste_legend_bot.gbr', 'placa_teste_soldermask_bot.gbr', 'placa_teste_paste_bot.gbr',
    'placa_teste_legend_top.gbr', 'placa_teste_paste_top.gbr', 'placa_teste_soldermask_top.gbr',
    'placa_teste_profile.gbr', 'placa_teste_npth_drill.gbr', 'placa_teste_pth_drill.gbr']);
  const f = {};
  for (const a of res.arquivos) f[a.camada] = a.funcao;
  assert.strictEqual(f.Top, 'Copper,L1,Top,Signal');
  assert.strictEqual(f.Mid1, 'Copper,L2,Inr,Signal');
  assert.strictEqual(f.Mid2, 'Copper,L3,Inr,Signal');
  assert.strictEqual(f.Bottom, 'Copper,L4,Bot,Signal');
  assert.strictEqual(f.DrillPTH, 'Plated,1,4,PTH,Drill');
  assert.strictEqual(f.DrillNPTH, 'NonPlated,1,4,NPTH,Drill');
  assert.strictEqual(f.TopSolder, 'Soldermask,Top');
  assert.strictEqual(f.Profile, 'Profile,NP');
  assert.ok(res.arquivos.every(a => !a.vazio), 'nenhuma camada vazia nesta placa');
}

/* ── cabecalho exatamente na ordem do Altium, CRLF, rodape MD5 + M02 ── */
{
  const t = porCamada.Mid1.texto;
  assert.ok(!/[^\r]\n/.test(t) && t.endsWith('M02*\r\n'), 'CRLF em todas as linhas');
  assert.deepStrictEqual(linhas(t).slice(0, 11), [
    '%TF.GenerationSoftware,Dieletrons,EletricHUB,' + G.VERSAO + '*%',
    'G04 Layer_Physical_Order=2*',
    'G04 Layer_Color=' + (0x008EBC) + '*',                /* #BC8E00 do board.layers em COLORREF */
    '%FSLAX45Y45*%', '%MOMM*%',
    '%TF.SameCoordinates,' + GUID + '*%',
    '%TF.FilePolarity,Positive*%',
    '%TF.FileFunction,Copper,L2,Inr,Signal*%',
    '%TF.Part,Single*%', 'G01*', 'G75*']);
  assert.ok(temLinha(porCamada.TopSolder.texto, '%TF.FilePolarity,Negative*%'), 'mascara e negativa');
  assert.ok(temLinha(porCamada.BottomSolder.texto, '%TF.FilePolarity,Negative*%'));
  assert.ok(temLinha(porCamada.Top.texto, 'G04 Layer_Color=255*'));
  assert.ok(temLinha(porCamada.Bottom.texto, 'G04 Layer_Color=16711680*'));
  assert.ok(temLinha(porCamada.TopSolder.texto, 'G04 Layer_Color=8388736*'));
  assert.ok(temLinha(porCamada.BottomOverlay.texto, 'G04 Layer_Color=32896*'));
  assert.ok(!temLinha(porCamada.TopOverlay.texto, 'G04 Layer_Physical_Order=1*'), 'ordem fisica so no cobre');
  /* MD5: de tudo antes do %TF.MD5, sem CR e sem LF - conferido contra o crypto do node */
  for (const a of res.arquivos) {
    const i = a.texto.indexOf('%TF.MD5,');
    assert.ok(i > 0, a.nome + ' sem MD5');
    const dec = a.texto.slice(i + 8, a.texto.indexOf('*', i));
    assert.strictEqual(dec, md5Node(a.texto.slice(0, i).replace(/[\r\n]/g, '')), a.nome + ': MD5');
    assert.ok(a.texto.slice(i).startsWith('%TF.MD5,' + dec + '*%\r\nM02*\r\n'), a.nome + ': rodape');
  }
  /* determinismo: mesmo GUID, mesmo texto */
  const de2 = G.gerar(placa(), { guid: GUID, vazias: true });
  assert.deepStrictEqual(de2.arquivos.map(a => a.texto), res.arquivos.map(a => a.texto));
}

/* ── md5 proprio = crypto do node (blocos de 55/56/64 bytes, UTF-8) ── */
for (const s of ['', 'a', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'y'.repeat(1000), 'ação %TF*'])
  assert.strictEqual(G.md5(s), md5Node(s), 'md5 de ' + JSON.stringify(s.slice(0, 8)));

/* ── leitura de volta pelo visualizador: contagens batem, nenhum aviso do leitor ── */
for (const a of res.arquivos) {
  const cam = GV.parse(a.texto, a.nome);
  assert.deepStrictEqual(cam.avisos, [], a.nome + ': o leitor reclamou');
  assert.deepStrictEqual(contar(cam), a.contagens, a.nome + ': contagens');
  assert.strictEqual(cam.funcao, a.funcao, a.nome + ': FileFunction');
  const info = GV.camadaDe(a.nome, cam.funcao);
  assert.ok(info && info.chave !== 'Other', a.nome + ': camada reconhecida');
}

/* ── pads: forma, rotacao e troca de w/h (gerber_spec 4.1-4.3) ── */
{
  const t = porCamada.Top.texto, ab = aberturas(t);
  const tem = (desc, func) => Object.keys(ab.out).some(d => ab.out[d] === desc && (!func || ab.func[d] === func));
  assert.ok(tem('R,0.41000X0.82000', 'SMDPad,CuDef'), 'rect a 90: troca w/h');
  assert.ok(tem('R,0.82000X0.41000', 'SMDPad,CuDef'), 'rect a 0');
  assert.ok(tem('R,1.00000X0.50000', 'SMDPad,CuDef'), 'rect a 180: sem troca');
  assert.ok(tem('O,1.00000X1.50000', 'SMDPad,CuDef'), 'oval a 90: troca');
  assert.ok(tem('C,1.00000', 'SMDPad,CuDef'), 'circulo');
  assert.ok(tem('P,2.82843X4X195.0', 'SMDPad,CuDef'), 'quadrado a 150 graus: P lado*raiz2, 4, 150+45');
  assert.ok(tem('R,0.60000X2.00000', 'ComponentPad'), 'PTH a 270');
  assert.ok(tem('C,1.80000', 'ComponentPad'), 'PTH redondo, tamanho de cima');
  assert.ok(tem('C,0.50000', 'ViaPad') && tem('C,0.60000', 'ViaPad'), 'vias');
  assert.ok(tem('C,0.25000', 'Conductor') && tem('C,0.30000', 'Conductor'), 'trilha e arco');
  assert.ok(tem('R,1.00000X1.00000', 'Conductor'), 'fill de cobre: flash R');
  assert.ok(tem('C,0.20000', 'NonConductor'), 'texto em cobre');
  /* ROTATEDRECT e OVAL a 10 graus: as linhas do X2 do Altium (GEP DI231744) */
  macroPerto(corpoDaMacro(t, 'ROTATEDRECT'),
    ['4,1,4,-0.63156,-1.02525,-0.94413,0.74741,0.63156,1.02525,0.94413,-0.74741,-0.63156,-1.02525,0.0*'], 'ROTATEDRECT');
  macroPerto(corpoDaMacro(t, 'OVAL'),
    ['21,1,0.20000,1.60000,0.00000,0.00000,100.0*', '1,1,1.60000,0.01737,-0.09848*', '1,1,1.60000,-0.01737,0.09848*'], 'OVAL');
  /* ROUNDEDRECT: as do DMB, linha a linha (D20 a 90; D17 com raio = Y/2 a 270, que o 90 reaproveita) */
  assert.deepStrictEqual(corpoDaMacro(t, 'ROUNDEDRECT', '21,1,0.60000,1.34800,0,0,90.0*'), [
    '21,1,0.60000,1.34800,0,0,90.0*', '21,1,0.49800,1.45000,0,0,90.0*',
    '1,1,0.10200,0.67400,0.24900*', '1,1,0.10200,0.67400,-0.24900*', '1,1,0.10200,-0.67400,-0.24900*', '1,1,0.10200,-0.67400,0.24900*']);
  assert.deepStrictEqual(corpoDaMacro(t, 'ROUNDEDRECT', '21,1,2.60278,0.00000,0,0,270.0*'), [
    '21,1,2.60278,0.00000,0,0,270.0*', '21,1,1.98065,0.62213,0,0,270.0*',
    '1,1,0.62213,0.00000,-0.99033*', '1,1,0.62213,0.00000,0.99033*', '1,1,0.62213,0.00000,0.99033*', '1,1,0.62213,0.00000,-0.99033*']);
  assert.ok(linhas(t).some(l => l.replace(/DCode=\d+/, 'DCode=N') === 'G04:AMPARAMS|DCode=N|XSize=0.6mm|YSize=1.45mm|CornerRadius=0.051mm|HoleSize=0mm|Usage=FLASHONLY|Rotation=90.000|XOffset=0mm|YOffset=0mm|HoleType=Round|Shape=RoundedRectangle|*'),
    'comentario AMPARAMS como o do Altium');
  assert.strictEqual(corpoDaMacro(t, 'ROUNDEDRECT', '21,1,2.60278,0.00000,0,0,90.0*'), null, 'pad a 90 e a 270 dividem a abertura');
  assert.ok(corpoDaMacro(t, 'OCTAGON'), 'octogono');
  /* a linha em branco depois do AD do OVAL/ROTATEDRECT, como no X2 do Altium */
  const L = linhas(t);
  assert.strictEqual(L[L.findIndex(l => /^%ADD\d+OVALD\d+\*%$/.test(l)) + 1], '');
  /* as aberturas vem em ordem de D-code, com um %TA a cada troca de funcao */
  const ds = L.filter(l => /^%ADD\d+/.test(l)).map(l => +/^%ADD(\d+)/.exec(l)[1]);
  assert.deepStrictEqual(ds, ds.slice().sort((a, b) => a - b));
  /* o leitor ve o ROTATEDRECT com a caixa do retangulo girado */
  const cam = GV.parse(t, 'top'), fl = cam.prims.find(p => p.k === 'flash' && Math.abs(p.x - 12) < 1e-9 && Math.abs(p.y - 10) < 1e-9);
  const cx = GV.caixaDe(fl), c10 = Math.cos(10 * Math.PI / 180), s10 = Math.sin(10 * Math.PI / 180);
  perto(cx[2] - cx[0], 1.6 * c10 + 1.8 * s10, 2e-5, 'largura do ROTATEDRECT');
  perto(cx[3] - cx[1], 1.6 * s10 + 1.8 * c10, 2e-5, 'altura do ROTATEDRECT');
}

/* ── D-codes globais: o mesmo numero na mascara (expansao 0), na pasta e no Pad Master ── */
{
  const dTop = aberturas(porCamada.Top.texto).out, dMask = aberturas(porCamada.TopSolder.texto).out;
  const dDaMacro = (texto, primeira) => {
    const L = linhas(texto), i = L.indexOf(primeira);
    const m = i > 0 && /^%AM[A-Z]+D(\d+)\*$/.exec(L[i - 1]);
    return m ? m[1] : null;
  };
  const d17 = dDaMacro(porCamada.Top.texto, '21,1,2.60278,0.00000,0,0,270.0*');
  assert.ok(d17 && dDaMacro(porCamada.TopSolder.texto, '21,1,2.60278,0.00000,0,0,270.0*') === d17 && dMask[d17] === dTop[d17],
    'pad com sm 0 usa o mesmo D-code no cobre e na mascara');
  assert.notStrictEqual(dDaMacro(porCamada.TopSolder.texto, '21,1,0.80320,1.34800,0,0,90.0*'), null, 'roundrect com a regra: r + e (0,1526)');
  const dPads = aberturas(porCamada.PadsTop.texto).out;
  for (const d of Object.keys(dPads)) assert.strictEqual(dPads[d], dTop[d], 'Pad Master usa os D-codes do cobre');
  const dPaste = aberturas(porCamada.TopPaste.texto).out;
  assert.ok(Object.values(dPaste).indexOf('R,0.80000X0.30000') >= 0, 'pasta com pm -0,1 encolhe');
}

/* ── mascara: expansao do pad > regra, tent, vias abertas por padrao, desenho na camada ── */
{
  const cam = GV.parse(porCamada.TopSolder.texto, 'mt');
  const fl = cam.prims.filter(p => p.k === 'flash');
  assert.strictEqual(fl.length, 11 + 5 + 2, '11 SMD (um tampado) + 5 PTH + 2 vias');
  assert.ok(!fl.some(p => Math.abs(p.x - 18) < 1e-9 && Math.abs(p.y - 10) < 1e-9), 'tentTop: sem abertura');
  const em = (x, y) => fl.find(p => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9);
  assert.deepStrictEqual(em(11, 10).ap.params.map(v => +v.toFixed(5)), [1.0232, 0.6132], 'regra 0,1016 por lado');
  assert.deepStrictEqual(em(5, 5).ap.params.map(v => +v.toFixed(5)), [0.7032], 'via aberta: C 0,5 + 2 x 0,1016');
  assert.strictEqual(cam.prims.filter(p => p.k === 'line').length, 1, 'linha desenhada na Top Solder soma');
  const bot = GV.parse(porCamada.BottomSolder.texto, 'mb');
  const fb = bot.prims.filter(p => p.k === 'flash');
  assert.strictEqual(fb.length, 1 + 5, 'via tampada embaixo (v1) e via cega (v2) nao abrem no bottom');
  const r1 = fb.find(p => Math.abs(p.x - 10) < 1e-9 && Math.abs(p.y - 30) < 1e-9);
  assert.deepStrictEqual(r1.ap.params.map(v => +v.toFixed(5)), [1.1, 2.1], 'sm do pad (0,05) vence a regra');
  assert.ok(fb.some(p => p.ap.tipo === 'C' && Math.abs(p.ap.params[0] - 2.6032) < 1e-6), 'PTH no bottom usa a pilha (bw 2,4)');
}

/* ── pasta: so SMD, nopaste fora, nada de PTH/via; Pad Master sem expansao ── */
{
  const pt = GV.parse(porCamada.TopPaste.texto, 'pt');
  assert.strictEqual(pt.prims.filter(p => p.k === 'flash').length, 11, '12 SMD menos o nopaste');
  assert.ok(!pt.prims.some(p => p.k === 'flash' && Math.abs(p.x - 19) < 1e-9), 'nopaste');
  assert.strictEqual(pt.prims.filter(p => p.k === 'line').length, 1, 'linha desenhada na Top Paste');
  assert.strictEqual(contar(GV.parse(porCamada.BottomPaste.texto, 'pb')).flashes, 1);
  assert.strictEqual(contar(GV.parse(porCamada.PadsTop.texto, 'pdt')).flashes, 12 + 5);
  assert.strictEqual(contar(GV.parse(porCamada.PadsBottom.texto, 'pdb')).flashes, 1 + 5);
}

/* ── cobre: camada + Multi; keepout nunca e cobre; via cega so ate a Mid1; regiao com furo em LPC ── */
{
  const top = GV.parse(porCamada.Top.texto, 'ct');
  const n = contar(top);
  assert.strictEqual(n.flashes, 12 + 5 + 2 + 1, 'SMD + PTH + 2 vias + fill');
  assert.strictEqual(n.arcos, 1);
  assert.ok(!top.prims.some(p => p.k === 'line' && Math.abs(p.y1 - 7) < 1e-9 && Math.abs(p.y2 - 7) < 1e-9 && p.x1 === 1), 'keepout fora');
  const zero = top.prims.find(p => p.k === 'line' && p.x1 === 6 && p.y1 === 6);
  assert.ok(zero && zero.x2 === 6 && zero.y2 === 6, 'trilha de comprimento zero sai como ponto');
  const regs = top.prims.filter(p => p.k === 'region');
  assert.deepStrictEqual(regs.map(r => r.escuro), [true, false], 'regiao escura e o furo dela em LPC');
  const t = porCamada.Top.texto;
  const iTA = linhas(t).indexOf('%TA.AperFunction,Conductor*%', linhas(t).findIndex(l => /^%ADD/.test(l)) + 1);
  assert.ok(iTA > 0 && linhas(t).indexOf('G36*') > iTA, 'as regioes de cobre levam o TA Conductor, nao o ViaPad herdado');
  assert.ok(temLinha(t, '%LPC*%') && temLinha(t, '%LPD*%'));
  assert.ok(linhas(t).indexOf('G36*') < linhas(t).findIndex(l => /^D[1-9]\d+\*$/.test(l)), 'regioes antes de tudo');
  /* trilha: D02 so no comeco da polilinha */
  const L = linhas(t), i = L.indexOf('X100000Y100000D02*');
  assert.deepStrictEqual(L.slice(i, i + 3), ['X100000Y100000D02*', 'X500000D01*', 'Y500000D01*'], 'polilinha continua sem D02, coordenada modal');
  /* arco: D02, G03, fim com X/Y sempre + I/J, G01 */
  const ia = L.indexOf('G03*');
  assert.deepStrictEqual(L.slice(ia - 1, ia + 3), ['X2200000Y2000000D02*', 'G03*', 'X2000000Y2200000I-200000J0D01*', 'G01*']);
  const mid1 = contar(GV.parse(porCamada.Mid1.texto, 'm1')), mid2 = contar(GV.parse(porCamada.Mid2.texto, 'm2'));
  assert.deepStrictEqual([mid1.flashes, mid1.tracos], [5 + 2, 1], 'Mid1: PTH + v1 + v2 (cega Top-Mid1) + trilha');
  assert.deepStrictEqual([mid2.flashes, mid2.tracos], [5 + 1, 0], 'Mid2: PTH + v1');
  const bot = GV.parse(porCamada.Bottom.texto, 'cb');
  const circ = bot.prims.find(p => p.k === 'arc');
  assert.ok(circ && circ.circulo && Math.abs(circ.x1 - 26) < 1e-9 && Math.abs(circ.y1 - 20) < 1e-9, 'arco de 360: inicio = fim no sa');
  const g2 = bot.prims.filter(p => p.k === 'region');
  assert.strictEqual(g2.length, 1);
  assert.strictEqual(g2[0].contornos[0].length, 4, 'vertice repetido e fechamento explicito saem limpos');
  assert.ok(bot.prims.some(p => p.k === 'flash' && p.ap.tipo === 'C' && Math.abs(p.ap.params[0] - 2.4) < 1e-9), 'PTH no cobre de baixo usa bw');
}

/* ── furacao: PTH com retangular/slot girados, NPTH separado, vias com ViaDrill ── */
{
  const pth = porCamada.DrillPTH.texto, ab = aberturas(pth);
  const desc = Object.keys(ab.out).map(d => ab.out[d] + ' ' + ab.func[d]).sort();
  assert.deepStrictEqual(desc, ['C,0.30000 ViaDrill,NotFilled', 'C,0.80000 ComponentDrill', 'C,0.90000 ComponentDrill',
                                'O,2.00000X1.00000 ComponentDrill', 'R,0.40000X1.60000 ComponentDrill']);
  assert.strictEqual(contar(GV.parse(pth, 'pth')).flashes, 4 + 2, '4 furos de pad + 2 de via');
  const npth = GV.parse(porCamada.DrillNPTH.texto, 'npth');
  assert.strictEqual(contar(npth).flashes, 1, 'pad plated:false');
  assert.strictEqual(contar(npth).regioes, 1, 'so o recorte k1: o do tamanho da placa e o de poligono ficam fora');
  assert.ok(temLinha(porCamada.DrillNPTH.texto, '%TD.AperFunction*%'), 'regiao do NPTH sem a funcao do furo de pad');
}

/* ── Profile: recortes primeiro, contorno em C 0,0254 com G02/G03 pelo percurso ── */
{
  const t = porCamada.Profile.texto, L = linhas(t);
  assert.ok(temLinha(t, '%ADD' + Object.keys(aberturas(t).out)[0] + 'C,0.02540*%'));
  const i = L.findIndex(l => /^D[1-9]\d+\*$/.test(l));
  assert.deepStrictEqual(L.slice(i + 1, L.indexOf('%TF.MD5,' + t.split('%TF.MD5,')[1].split('*')[0] + '*%')), [
    'X0Y100000D02*', 'X100000Y0D01*', 'X3000000D01*',
    'D02*', 'G02*', 'X3200000Y-200000I0J-200000D01*', 'G01*',
    'Y-400000D01*',
    'D02*', 'G03*', 'X3600000Y-400000I200000J0D01*', 'G01*',
    'Y-200000D01*',
    'D02*', 'G02*', 'X3800000Y0I200000J0D01*', 'G01*',
    'X4900000D01*', 'X5000000Y100000D01*', 'Y3900000D01*', 'X4900000Y4000000D01*', 'X100000D01*', 'X0Y3900000D01*', 'Y100000D01*']);
  const cam = GV.parse(t, 'pf');
  assert.strictEqual(contar(cam).regioes, 1);
  const cp = GV.contornoDaPlaca(cam);
  assert.strictEqual(cp.lacos.length, 1, 'contorno fecha num laco so');
  assert.strictEqual(cp.abertos, 0, 'nenhuma cadeia aberta');
  assert.strictEqual(cp.recortes.length, 1, 'o recorte k1');
  perto(cam.bbox.y1, -6 - 0.0127, 1e-6, 'a aba desce ate -6 (arco G03 por baixo)');
  /* arco em angulo quebrado: a ponta encosta na reta seguinte (sem D02 no meio) */
  const a = Math.atan2(3, 4) * 180 / Math.PI;
  const cam2 = G.caminhoContorno([
    { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }, { kind: 'arc', cx: 10, cy: 5, r: 5, sa: 270, ea: a },
    { kind: 'line', x1: 14, y1: 8, x2: 0, y2: 8 }, { kind: 'line', x1: 0, y1: 8, x2: 0, y2: 0 }]);
  assert.deepStrictEqual([cam2[1].sx, cam2[1].sy, cam2[1].ex, cam2[1].ey, cam2[1].cw], [10, 0, 14, 8, false]);
}

/* ── legenda: linha, arco, texto com e sem contorno, fills ── */
{
  const t = porCamada.TopOverlay.texto, cam = GV.parse(t, 'lt');
  const fl = cam.prims.filter(p => p.k === 'flash');
  assert.deepStrictEqual(fl.map(p => p.ap.tipo + p.ap.params.map(v => +v.toFixed(5)).join('x')).sort(), ['R1x2', 'R2x1'], 'fill a 0 e a 90 viram flash R');
  const regs = cam.prims.filter(p => p.k === 'region');
  assert.deepStrictEqual(regs.map(r => r.escuro), [true, true, false], 'fill girado (regiao), texto com contorno: escuro, depois o miolo em LPC');
  perto(Math.abs(GV.areaComSinal(regs[0].contornos[0])), 2, 1e-4, 'fill girado mantem a area (cantos em 0,00001 mm)');
  assert.ok(cam.prims.some(p => p.k === 'arc' && p.circulo), 'arco de silk de 360');
  const L = linhas(t), ic = L.indexOf('%LPC*%');
  assert.ok(ic > 0 && L.indexOf('%LPD*%') > ic && L.indexOf('%LPD*%') < L.findIndex(l => /^D[1-9]\d+\*$/.test(l)), 'LPC/LPD so nas regioes');
  /* texto sem contorno: tracos da HubFont com a TINTA centrada no x/y, largura w (ou h x 0,15) */
  const ab = aberturas(t).out;
  assert.ok(Object.values(ab).indexOf('C,0.12000') >= 0, 'w do texto');
  assert.ok(Object.values(ab).indexOf('C,0.15000') >= 0, 'texto sem w: h x 0,15');
  const traco = d => cam.prims.filter(p => p.k === 'line' && Math.abs(p.ap.params[0] - d) < 1e-9);
  const ab1 = traco(0.12), xs = ab1.flatMap(p => [p.x1, p.x2]), ys = ab1.flatMap(p => [p.y1, p.y2]);
  perto((Math.min(...xs) + Math.max(...xs)) / 2, 20, 1e-5, 'texto centrado em x');
  perto((Math.min(...ys) + Math.max(...ys)) / 2, 30, 1e-5, 'texto centrado em y');
  /* texto de duas linhas com ancora, espelhado e a 90 graus: todo a esquerda/abaixo da ancora */
  const lb = GV.parse(porCamada.BottomOverlay.texto, 'lb');
  const tx = lb.prims.filter(p => p.k === 'line' && Math.abs(p.ap.params[0] - 0.1) < 1e-9);
  assert.ok(tx.length > 4, 'as duas linhas de texto');
  for (const p of tx) assert.ok(p.x1 <= 19 + 1e-6 && p.x2 <= 19 + 1e-6 && p.y1 <= 34 + 1e-6 && p.y2 <= 34 + 1e-6, 'espelho no X local antes de girar 90');
}

/* ── texto stroke na HubFont, regressao do teste de ouro (DMB v94 x o X2 do Altium de 22/09): os
   textos abaixo sao os do board.js do DMB, e os numeros esperados sao os tracos do Altium ── */
{
  /* so o texto, numa placa sem mais nada: a caixa das linhas de centro dos tracos */
  const quadrado = [[0, 0, 100, 0], [100, 0, 100, 100], [100, 100, 0, 100], [0, 100, 0, 0]].map(q => ({ kind: 'line', x1: q[0], y1: q[1], x2: q[2], y2: q[3] }));
  const soTexto = t => {
    const r = G.gerar({ exporter: 'x', fills: [], board: { bbox: { x1: 0, y1: 0, x2: 100, y2: 100 }, outline: quadrado }, texts: [t] }, { guid: GUID });
    const cam = GV.parse(r.arquivos.find(a => a.camada === (t.layer || 'TopOverlay')).texto, 'txt');
    const tr = cam.prims.filter(p => p.k === 'line');
    const xs = tr.flatMap(p => [p.x1, p.x2]), ys = tr.flatMap(p => [p.y1, p.y2]);
    return { r, tr, avisos: r.avisos.join('\n'), cx: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  };
  const texto = o => Object.assign({ layer: 'TopOverlay', rot: 0, mirror: false, kind: 'stroke', designator: false, comment: false }, o);

  /* '+' de polaridade (C3): a HubFont nao tem o glifo e saia uma caixa de 0,9 x 1,5 mm. No X2 do
     Altium e uma cruz de 4u x 4u (u = h/6) no x/y: X7419201Y4442485D02* X7317633D01* e
     X7368417Y4391701D02* Y4493268D01* (o Altium usa u = 0,999676 h/6: 0,2 um de diferenca) */
  const mais = soTexto(texto({ id: 'x12', x: 73.68417, y: 44.424845, text: '+', h: 1.524, rot: 180, w: 0.254, ax: 74.19201, ay: 45.1866 }));
  const cruz = [[74.19201, 44.42485, 73.17633, 44.42485], [73.68417, 43.91701, 73.68417, 44.93268]];
  assert.strictEqual(mais.tr.length, 2, "'+': dois tracos, nao a caixa de quatro");
  for (const a of cruz)
    assert.ok(mais.tr.some(p => [[p.x1, p.y1, p.x2, p.y2], [p.x2, p.y2, p.x1, p.y1]].some(q => q.every((v, i) => Math.abs(v - a[i]) <= 3e-4))),
      "'+': o traco " + a.join(',') + ' do X2 do Altium');
  assert.ok(mais.avisos.indexOf('caractere que a fonte do hub não tem') < 0, mais.avisos);
  for (const [c, g] of Object.entries(G.GLIFOS_EXTRA)) {
    assert.ok(g.w > 0 && g.l.length && g.l.every(s => s.length >= 2 && s.every(p => p.length === 2 && isFinite(p[0]) && isFinite(p[1]) && p[0] >= 0 && p[0] <= g.w)),
      'GLIFOS_EXTRA[' + c + '] no formato do FONTDATA');
    const um = soTexto(texto({ id: 'g', x: 50, y: 50, text: c, h: 1.2, w: 0.12 }));
    assert.ok(um.tr.length && um.avisos.indexOf('caractere') < 0, c + ': desenhado, sem caixa');
    perto((um.cx[0] + um.cx[2]) / 2, 50, 1e-5, c + ': centrado em x');
  }
  /* a HubFont manda: o 'x' minusculo e o dela (altura de x, 2/3 h), nao o 'X' do complemento */
  const xm = soTexto(texto({ id: 'xm', x: 50, y: 50, text: 'x', h: 1.5, w: 0.15 }));
  perto(xm.cx[3] - xm.cx[1], 1.5 * (0.714286 - 0.047619), 1e-4, "'x' da HubFont");
  /* o que nem a HubFont nem o complemento tem: a caixa dela, com aviso que diz quais */
  const sem = soTexto(texto({ id: 'g2', x: 50, y: 50, text: 'AΩ#Ω', h: 1, w: 0.1 }));
  assert.ok(sem.avisos.indexOf('1 texto com caractere que a fonte do hub não tem (Ω #): sai uma caixa no lugar.') >= 0, sem.avisos);
  assert.strictEqual(sem.tr.length, 3 + 3 * 4, "o 'A' (3 tracos) e as 3 caixas (4 cada)");

  /* uma linha: a caixa da TINTA centrada no x/y - e o centro do retangulo de selecao do Altium.
     Pela caixa de avanco da HubFont o "T1" saia (-0,0726; +0,0726) e o "GND" a 270 graus +0,0952 */
  for (const t of [texto({ id: 'x44', x: 80.39067, y: 83.210155, text: 'T1', h: 1.524, w: 0.254, ax: 79.375, ay: 82.4484 }),
                   texto({ id: 'x1', x: 88.95668, y: 88.701195, text: 'GND', h: 2, rot: 270, w: 0.2, ax: 87.757, ay: 91.567 }),
                   texto({ id: 'x64', layer: 'BottomOverlay', x: 7.2, y: 3.1, text: 'CN1', h: 0.9, w: 0.157, mirror: true })]) {
    const k = soTexto(t).cx;
    perto((k[0] + k[2]) / 2, t.x, 1e-5, t.text + ': centro da tinta em x');
    perto((k[1] + k[3]) / 2, t.y, 1e-5, t.text + ': centro da tinta em y');
  }
  /* moldura: "DS\r\n" tem quebra de linha (so a do fim) e e moldura no Altium - a tinta comeca em
     ancora + w e a linha de base fica a w acima dela: X2, linhas 26082-26100, tinta de x 14,8320
     e y 14,3240 (saia centrado no x/y da moldura, a 0,13 mm) */
  const ds = soTexto(texto({ id: 'x10', x: 15.494, y: 14.732, text: 'DS\r\n', h: 0.7, w: 0.1, ax: 14.732, ay: 14.224 }));
  perto(ds.cx[0], 14.832, 1e-5, 'DS: borda esquerda = ancora + w');
  perto(ds.cx[1], 14.324, 1e-5, 'DS: linha de base = ancora + w');
  assert.ok(ds.avisos.indexOf('várias linhas') < 0, ds.avisos);
  /* as duas linhas do "PDMB..." comecam em ancora + w = 72,136 no X2 (a margem lateral do 'P' e do
     'R' da HubFont empurrava 0,363 mm), a de baixo com a linha de base em 18,923 */
  const pd = soTexto(texto({ id: 'x4', x: 83.882, y: 22.12256, text: 'PDMB-DI231765_P2\r\nREV. C', h: 1.524, rot: 360, w: 0.254, ax: 71.882, ay: 18.669 }));
  perto(pd.cx[0], 72.136, 1e-5, 'PDMB: borda esquerda');
  perto(pd.cx[1], 18.923, 1e-5, 'PDMB: linha de base da ultima linha');
  const baixo = pd.tr.filter(p => Math.max(p.y1, p.y2) < 20.6), cima = pd.tr.filter(p => Math.min(p.y1, p.y2) > 21);
  assert.ok(baixo.length && cima.length && baixo.length + cima.length === pd.tr.length, 'duas linhas');
  for (const lt of [baixo, cima]) perto(Math.min(...lt.flatMap(p => [p.x1, p.x2])), 72.136, 1e-5, 'cada linha alinhada a esquerda pela tinta');
  /* moldura sem a ancora (espelho antigo): o bloco centrado no x/y, com aviso */
  const sa = soTexto(texto({ id: 'x4', x: 83.882, y: 22.12256, text: 'PDMB-DI231765_P2\r\nREV. C', h: 1.524, w: 0.254 }));
  perto((sa.cx[0] + sa.cx[2]) / 2, 83.882, 1e-5, 'sem ancora: centro em x');
  perto((sa.cx[1] + sa.cx[3]) / 2, 22.12256, 1e-5, 'sem ancora: centro em y');
  assert.ok(sa.avisos.indexOf('1 texto de várias linhas sem a âncora') >= 0, sa.avisos);

  /* string especial que nao virou valor (board.js do leitor sem o .PrjPcb): aviso ALTO, com o nome */
  const esp = soTexto(texto({ id: 'x4', x: 83.882, y: 22.12256, text: 'PDMB-DI231765_P2\r\n.Revisao', h: 1.524, w: 0.254, ax: 71.882, ay: 18.669 }));
  assert.ok(/^ATENÇÃO: 1 texto com string especial sem valor \(\.Revisao\): sai escrito assim/.test(esp.r.avisos[0]), esp.avisos);
  assert.strictEqual(esp.r.avisos.filter(a => a.indexOf('ATENÇÃO') === 0).length, 1, 'o unico aviso alto desta placa');
  for (const s of ['REV. C', '1.5V', 'V.A', 'X.Y.Z', '...', 'ver. 2'])
    assert.ok(soTexto(texto({ id: 'n', x: 50, y: 50, text: s, h: 1, w: 0.1 })).avisos.indexOf('string especial') < 0, s + ' nao e string especial');
  const dois = soTexto(texto({ id: 'n', x: 50, y: 50, text: '.Designator .Revisao', h: 1, w: 0.1 }));
  assert.ok(dois.avisos.indexOf('(.Designator .Revisao)') >= 0, dois.avisos);
}

/* ── avisos: o que o espelho nao trouxe ── */
{
  const av = res.avisos.join('\n');
  for (const k of ['1 via que não atravessa a placa toda (cega/enterrada)', '1 furo de pad sem "plated"', '1 pad octogonal',
                   '1 recorte de polígono em cutouts', '1 texto sem a largura do traço', '1 região com menos de 3 vértices',
                   '1 via sem tenting', '4 textos sem o contorno exato'])
    assert.ok(av.indexOf(k) >= 0, 'aviso de ' + k + ':\n' + av);
  assert.ok(av.indexOf('várias linhas') < 0, 'texto de duas linhas com ancora nao avisa');
  /* texto movido depois do export: o x/y andou, a ancora e o contorno nao */
  const mov = placa();
  const x4 = mov.texts.find(t => t.id === 'x4'), x3 = mov.texts.find(t => t.id === 'x3');
  x4.x += 10; x3.x += 10;
  const rm = G.gerar(mov, { guid: GUID }), avm = rm.avisos.join('\n');
  assert.ok(avm.indexOf('1 texto de várias linhas com a âncora (ax/ay) longe do próprio texto') >= 0, avm);
  assert.ok(avm.indexOf('1 texto com contorno (polys) longe do próprio texto') >= 0, avm);
  const lbm = GV.parse(rm.arquivos.find(a => a.camada === 'BottomOverlay').texto, 'lbm');
  const tm = lbm.prims.filter(p => p.k === 'line' && Math.abs(p.ap.params[0] - 0.1) < 1e-9);
  perto(tm.reduce((s, p) => s + p.x1 + p.x2, 0) / (2 * tm.length), 27.5, 0.6, 'ancora velha: bloco centrado no x/y novo');
  assert.ok(av.indexOf('espelho antigo') < 0 && av.indexOf('regra padrão de 0,1016') < 0, 'espelho novo com regras: sem esses avisos');
  assert.ok(res.resumo.texto.indexOf('placa_teste_pth_drill.gbr') >= 0);
  /* kindn do export novo (o Kind() do Altium): 1 e -1 saem; 3 fica; numero nao medido FICA, com
     aviso (sumir com furo de fixacao de verdade e pior do que sobrar um) */
  const kn = placa();
  kn.cutouts = [
    { id: 'k1', layer: 'Multi', kindn: 3, points: [[44, 30], [46, 30], [46, 32], [44, 32]] },
    { id: 'k2', layer: 'Multi', kindn: -1, points: [[1, 1], [9, 1], [9, 9], [1, 9]] },        /* a regiao da placa (leitor de .PcbDoc) */
    { id: 'k3', layer: 'Multi', kindn: 1, points: [[44, 34], [46, 34], [46, 36], [44, 36]] },  /* recorte de poligono, mesmo na Multi */
    { id: 'k4', layer: 'Multi', kindn: 5, points: [[40, 34], [42, 34], [42, 36], [40, 36]] },
  ];
  const rk = G.gerar(kn, { guid: GUID }), avk = rk.avisos.join('\n');
  for (const c of ['Profile', 'DrillNPTH']) assert.strictEqual(rk.arquivos.find(a => a.camada === c).contagens.regioes, 2, c + ': k1 e k4');
  assert.ok(avk.indexOf('1 recorte de polígono em cutouts') >= 0 && avk.indexOf('1 recorte com kindn ainda não medido') >= 0, avk);
  /* espelho antigo: aviso ALTO e as regras padrao */
  const velho = placa();
  delete velho.exporter; delete velho.rules; delete velho.fills;
  const rv = G.gerar(velho, { guid: GUID });
  assert.ok(/^ATENÇÃO: espelho antigo/.test(rv.avisos[0]), 'aviso alto primeiro');
  assert.ok(rv.avisos.some(a => /não traz fills/.test(a)));
  assert.ok(rv.avisos.some(a => /regra padrão de 0,1016/.test(a)));
}

/* ── opcoes: nomes do Altium, .gto/.gbo, vazias, x2:false ── */
{
  const alt = G.gerar(placa(), { guid: GUID, nomes: 'altium', gtoGbo: true });
  const nomes = alt.arquivos.map(a => a.nome);
  assert.ok(nomes.indexOf('Placa Teste_Copper_Signal_Top.gbr') >= 0 && nomes.indexOf('Placa Teste_Copper_Signal_1.gbr') >= 0);
  assert.ok(nomes.indexOf('Placa Teste_Legend_Top.gto') >= 0 && nomes.indexOf('Placa Teste_Legend_Bot.gbo') >= 0);
  const base = G.gerar(placa(), { guid: GUID, base: 'PDMB - DI231765_P2', gtoGbo: true }).arquivos.map(a => a.nome);
  assert.ok(base.indexOf('pdmb_-_di231765_p2_legend_top.gto') >= 0 && base.indexOf('pdmb_-_di231765_p2_copper_signal_bot.gbr') >= 0);
  /* o nome vai para o disco do servidor: sem acento nem caractere que o POST /api/gerber recusa */
  const ac = G.gerar(placa(), { guid: GUID, base: 'Placa MARCAÇÃO, v2 [final]', nomes: 'altium' });
  assert.ok(ac.arquivos.every(a => /^[A-Za-z0-9 _.()+-]+$/.test(a.nome)), ac.arquivos.map(a => a.nome).join(' '));
  assert.strictEqual(ac.arquivos[0].nome, 'Placa MARCACAO_ v2 _final__Copper_Signal_Top.gbr');
  assert.strictEqual(ac.resumo.zip, 'Placa MARCACAO_ v2 _final_.zip');
  /* placa so com contorno: o pacote padrao descarta as vazias */
  const so = { exporter: 'x', fills: [], board: { bbox: { x1: 0, y1: 0, x2: 10, y2: 10 }, outline: [
    { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }, { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
    { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 }, { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 }] } };
  const r1 = G.gerar(so, { guid: GUID, base: 'v' });
  assert.deepStrictEqual(r1.arquivos.map(a => a.nome), ['v_profile.gbr']);
  assert.strictEqual(r1.resumo.descartadas.length, 12);
  const r2 = G.gerar(so, { guid: GUID, base: 'v', vazias: true });
  assert.strictEqual(r2.arquivos.length, 13);
  const vazio = r2.arquivos.find(a => a.camada === 'BottomPaste');
  assert.ok(vazio.vazio && linhas(vazio.texto).length === 13 && linhas(vazio.texto)[9] === 'G75*', 'arquivo vazio: cabecalho + MD5 + M02 (12 linhas)');
  /* x2:false: sem nenhum atributo, como o CAMtastic */
  const r3 = G.gerar(placa(), { guid: GUID, x2: false });
  for (const a of r3.arquivos) {
    assert.ok(!/%T[FAOD]|G04 Layer_|MD5/.test(a.texto), a.nome + ': x2:false sem atributos');
    assert.ok(a.texto.startsWith('%FSLAX45Y45*%\r\n%MOMM*%\r\nG01*\r\nG75*\r\n'));
    const cam = GV.parse(a.texto, a.nome);
    assert.deepStrictEqual(contar(cam), a.contagens, a.nome + ' (x2:false): contagens');
  }
  /* sem GUID, um por geracao, igual em todos os arquivos */
  const r4 = G.gerar(placa(), {});
  const guids = new Set(r4.arquivos.map(a => /%TF\.SameCoordinates,([0-9A-F-]+)\*%/.exec(a.texto)[1]));
  assert.strictEqual(guids.size, 1);
  assert.ok(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test([...guids][0]));
}

/* ── placa efetiva: HubCore.applyPcbChanges + effectiveBoard (comp_move e via_add) ── */
if (typeof HubCore.effectiveBoard === 'function') {
  const P0 = placa();
  const CH = [
    { op: 'comp_move', ref: 'U2', x: 12, y: 31, rot: 0, layer: 'Bottom', orig_x: 10, orig_y: 30, orig_rot: 0, orig_layer: 'Bottom' },
    { op: 'via_add', x: 45, y: 15, size: 0.8, drill: 0.4, net: '' },
  ];
  const eb = HubCore.effectiveBoard(P0, HubCore.applyPcbChanges(P0, CH));
  const r = G.gerar(eb, { guid: GUID });
  const pb = GV.parse(r.arquivos.find(a => a.camada === 'PadsBottom').texto, 'pb');
  assert.ok(pb.prims.some(p => p.k === 'flash' && Math.abs(p.x - 12) < 1e-9 && Math.abs(p.y - 31) < 1e-9), 'pad do componente movido');
  const pth = GV.parse(r.arquivos.find(a => a.camada === 'DrillPTH').texto, 'pth');
  assert.ok(pth.prims.some(p => p.k === 'flash' && Math.abs(p.x - 45) < 1e-9 && Math.abs(p.ap.params[0] - 0.4) < 1e-9), 'via adicionada fura');
}

/* ── .zip: store (lido de volta aqui) e deflate (zlib.inflateRawSync); o visualizador abre os dois ── */
{
  const arqs = res.arquivos.concat([{ nome: 'Ação Ç.txt', texto: 'nome com acento\r\n' }]);
  const data = new Date(2026, 9, 2, 10, 30, 0);
  for (const deflate of [false, true]) {
    const z = await G.zip(arqs, { deflate, data });
    assert.ok(z instanceof Uint8Array);
    const b = Buffer.from(z.buffer, z.byteOffset, z.byteLength);
    const eocd = b.length - 22;
    assert.strictEqual(b.readUInt32LE(eocd), 0x06054b50, 'fim do diretorio');
    assert.strictEqual(b.readUInt16LE(eocd + 10), arqs.length);
    let p = b.readUInt32LE(eocd + 16);
    assert.strictEqual(p + b.readUInt32LE(eocd + 12), eocd, 'diretorio central termina no EOCD');
    let comprimidos = 0;
    for (const a of arqs) {
      assert.strictEqual(b.readUInt32LE(p), 0x02014b50);
      const metodo = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16), csize = b.readUInt32LE(p + 20), usize = b.readUInt32LE(p + 24);
      const nlen = b.readUInt16LE(p + 28), off = b.readUInt32LE(p + 42), flags = b.readUInt16LE(p + 8);
      const nome = b.slice(p + 46, p + 46 + nlen).toString('utf8');
      assert.strictEqual(nome, a.nome);
      assert.strictEqual(!!(flags & 0x800), /[^\x00-\x7f]/.test(a.nome), 'bit UTF-8 so no nome com acento');
      assert.strictEqual(b.readUInt32LE(off), 0x04034b50, 'cabecalho local');
      assert.strictEqual(b.readUInt16LE(off + 8), metodo);
      assert.strictEqual(b.readUInt32LE(off + 14), crc);
      const ini = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
      const dados = b.slice(ini, ini + csize);
      const cru = metodo === 0 ? dados : zlib.inflateRawSync(dados);
      if (metodo === 8) comprimidos++;
      else assert.strictEqual(metodo, 0);
      assert.strictEqual(cru.length, usize);
      assert.strictEqual(cru.toString('utf8'), a.texto, a.nome + ': conteudo');
      assert.strictEqual(crc, zlib.crc32 ? zlib.crc32(cru) : G.crc32(cru), a.nome + ': crc32');
      assert.strictEqual(G.crc32(cru), crc);
      const dosHora = b.readUInt16LE(off + 10), dosDia = b.readUInt16LE(off + 12);
      assert.deepStrictEqual([dosHora >> 11, (dosHora >> 5) & 63, dosDia >> 9, (dosDia >> 5) & 15, dosDia & 31], [10, 30, 46, 10, 2]);
      p += 46 + nlen + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
    }
    if (deflate && typeof CompressionStream !== 'undefined') assert.ok(comprimidos >= res.arquivos.length, 'deflate de verdade');
    if (!deflate) assert.strictEqual(comprimidos, 0, 'store');
    const lidos = await GV.lerZip(z);
    assert.deepStrictEqual(lidos.avisos, []);
    assert.deepStrictEqual(lidos.map(x => x.nome), arqs.map(a => a.nome));
    assert.deepStrictEqual(lidos.map(x => x.texto), arqs.map(a => a.texto));
  }
  assert.strictEqual(G.crc32(Buffer.from('123456789')), 0xCBF43926, 'crc32 de referencia');
}

/* ── a placa real do repo (board.js do DMB, espelho de 15/09) ── */
{
  const B0 = loadVar('Projects/DMB - DI231765_P2/board.js', 'pcbmirror');
  let CH = [];
  try { CH = loadVar('Projects/DMB - DI231765_P2/changes.js', 'changes') || []; } catch (_) { CH = []; }
  const eb = typeof HubCore.effectiveBoard === 'function' ? HubCore.effectiveBoard(B0, HubCore.applyPcbChanges(B0, CH)) : B0;
  const r = G.gerar(eb, { guid: GUID, base: 'PDMB - DI231765_P2', nomes: 'altium' });
  assert.ok(r.arquivos.length >= 12, 'o conjunto sai');
  assert.ok(r.avisos[0].indexOf('ATENÇÃO: espelho antigo') === 0, 'board.js de 15/09 nao tem exporter');
  for (const a of r.arquivos) {
    const cam = GV.parse(a.texto, a.nome);
    assert.deepStrictEqual(cam.avisos, [], a.nome);
    assert.deepStrictEqual(contar(cam), a.contagens, a.nome);
  }
  const pt = r.arquivos.find(a => a.camada === 'PadsTop');
  assert.strictEqual(contar(GV.parse(pt.texto, 'pt')).flashes, 139, '73 SMD + 66 PTH');

  /* bloco opcional: o X2 que o Altium 21.5.1 gerou em 22/09 (rede, so leitura). Os pads nao mudaram
     desde o board.js de 15/09 - trilhas e vias mudaram, essas nao se comparam. */
  const X2 = 'Y:/EQUIPAMENTOS_REVISADOS/DMB - DI231765 - DISPLAY ASCII PARA MARCAÇÃO DE BOBINAS/PCB E SCH/' +
             'PDMB - DI231765_P2 (Microntrolladora)/Project Outputs for DMB - DI231765_P2';
  let existe = false;
  try { existe = fs.statSync(X2).isDirectory(); } catch (_) { existe = false; }
  if (existe) {
    const leAltium = suf => { const t = fs.readFileSync(path.join(X2, 'PDMB - DI231765_P2' + suf), 'latin1'); return { t, cam: GV.parse(t, suf) }; };
    /* abertura igual pela GEOMETRIA: o Altium e o hub escolhem representantes diferentes para pads
       iguais a 90 e a 270 (D17 do U1 x U2), entao compara tipo, caixa e area das formas */
    const assinatura = ap => {
      const cx = GV.caixaDe({ k: 'flash', x: 0, y: 0, ap });
      const area = GV.contornoDaAbertura(ap, 0, 0).reduce((s, q) => s + (q.claro ? -1 : 1) * Math.abs(GV.areaComSinal(q.pts)), 0);
      return { tipo: ap.tipo, macro: String(ap.nomeMacro || '').replace(/D\d+$/, ''), cx, area };
    };
    const igual = (a, b) => a.tipo === b.tipo && a.macro === b.macro && Math.abs(a.area - b.area) <= 1e-4 * Math.max(1, a.area) &&
                            a.cx.every((v, i) => Math.abs(v - b.cx[i]) <= 2e-5);
    const confere = (suf, camada, filtro) => {
      const A = leAltium(suf).cam.prims.filter(p => p.k === 'flash' && (!filtro || filtro(p)));
      const M = GV.parse(r.arquivos.find(a => a.camada === camada).texto, camada).prims.filter(p => p.k === 'flash' && (!filtro || filtro(p)));
      assert.strictEqual(M.length, A.length, suf + ': quantidade');
      const usado = new Uint8Array(A.length);
      for (const p of M) {
        const sp = assinatura(p.ap);
        const j = A.findIndex((q, i) => !usado[i] && Math.abs(q.x - p.x) <= 1.5e-5 && Math.abs(q.y - p.y) <= 1.5e-5 && igual(sp, assinatura(q.ap)));
        assert.ok(j >= 0, suf + ': pad em (' + p.x + ', ' + p.y + ') sem par no X2 do Altium');
        usado[j] = 1;
      }
      return M.length;
    };
    const semVia = p => p.aperFunction !== 'ViaPad' && p.aperFunction !== 'ViaDrill,NotFilled';
    const n = confere('_Pads_Top.gbr', 'PadsTop') + confere('_Pads_Bot.gbr', 'PadsBottom');
    assert.strictEqual(n, 139 + 66);
    assert.strictEqual(confere('_Copper_Signal_Top.gbr', 'Top', semVia), 139, 'pads no cobre de cima');
    assert.strictEqual(confere('_Copper_Signal_Bot.gbr', 'Bottom', semVia), 66, 'pads no cobre de baixo');
    assert.strictEqual(confere('_Paste_Top.gbr', 'TopPaste'), 73, 'pasta: os 73 SMD');
    assert.strictEqual(confere('_PTH_Drill.gbr', 'DrillPTH', semVia), 66, 'furos dos 66 PTH (16 retangulares)');
    /* o '+' de polaridade do C3 e do C5 (a HubFont nao tem o glifo): a mesma cruz do Altium. O
       board.js de 15/09 nao traz o w do texto, entao a abertura e h x 0,15, nao a 0,254 dele */
    const legA = leAltium('_Legend_Top.gbr').cam, legH = GV.parse(r.arquivos.find(a => a.camada === 'TopOverlay').texto, 'lt');
    const mais = eb.texts.filter(x => x.text === '+' && x.layer === 'TopOverlay');
    assert.deepStrictEqual(mais.map(t => t.owner).sort(), ['C3', 'C5']);
    for (const t of mais) {
      const perto6 = (p, larg) => p.k === 'line' && Math.abs(p.ap.params[0] - larg) < 1e-6 &&
                                  Math.abs((p.x1 + p.x2) / 2 - t.x) < 0.6 && Math.abs((p.y1 + p.y2) / 2 - t.y) < 0.6;
      const A = legA.prims.filter(p => perto6(p, 0.254)), M = legH.prims.filter(p => perto6(p, t.h * 0.15));
      assert.strictEqual(A.length, 2, "'+' do " + t.owner + ' no X2');
      assert.strictEqual(M.length, 2, "'+' do " + t.owner + ': a cruz, nao a caixa');
      for (const a of A)
        assert.ok(M.some(p => [[p.x1, p.y1, p.x2, p.y2], [p.x2, p.y2, p.x1, p.y1]].some(q => q.every((v, i) => Math.abs(v - [a.x1, a.y1, a.x2, a.y2][i]) <= 3e-4))),
          "'+' do " + t.owner + ': traco do Altium sem par');
    }
    /* a regra do MD5 de rodape vale nos 13 arquivos do Altium, com o md5 deste modulo */
    for (const f of fs.readdirSync(X2).filter(f => /\.gbr$/i.test(f))) {
      const t = fs.readFileSync(path.join(X2, f), 'latin1'), i = t.indexOf('%TF.MD5,');
      assert.strictEqual(G.md5(t.slice(0, i).replace(/[\r\n]/g, '')), t.slice(i + 8, t.indexOf('*', i)), f + ': MD5 do Altium');
    }
    console.log('test-gerber: X2 do Altium conferido (205 pads, pasta, furos, MD5 de 13 arquivos)');
  }
}

console.log('test-gerber OK');
})().catch(e => { console.error(e); process.exit(1); });
