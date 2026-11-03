/* hub-silkgen.js (1.60.0): imagem ou texto -> serigrafia (region_add com holes).
     - mascara: limiar, inverter, alfa;
     - contornos de mascaras sinteticas: quadrado (1 poligono sem furo), anel (1 com 1 furo), anel com
       ilha (2 poligonos, o de fora antes), xadrez (sela: aneis validos que nao se encostam, nas duas regras);
     - paraPlaca: escala, centro, espelho, giro e a simplificacao que nao estraga o poligono;
     - opsDe: as ops passam no HubCore.applyPcbChanges sem erro; traco fino e vao fino avisam; guarda de vertices;
     - mcp/lib/png.js: PNGs gerados aqui com zlib (cor 2, 3 com paleta e tRNS, 6 com alfa, cinza 1 bit, 16 bits,
       todos os filtros), entrelacado e JPEG recusados com mensagem;
     - textoComFonte com a Arial do Windows: "Ode" sai com furo no O, no d e no e e passa no motor.
   node tests/test-silkgen.js */
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const S = require('../hub-silkgen.js');
const HC = require('../hub-core.js');
const PNG = require('../mcp/lib/png.js');
const { crc32 } = require('../mcp/lib/render.js');

let ok = 0;
const t = (nome, fn) => { try { fn(); ok++; } catch (e) { e.message = nome + ': ' + e.message; throw e; } };
const mascara = (w, h, f) => { const m = new Uint8Array(w * h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) m[j * w + i] = f(i, j) ? 1 : 0; return { w, h, m }; };
const area = p => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return s / 2; };
const placa = () => ({
  exporter: 'teste', nets: [], components: [], freepads: [], tracks: [], arcs: [], vias: [], fills: [], regions: [], cutouts: [], texts: [], silk: [], lines: [],
  board: { bbox: { x1: 0, y1: 0, x2: 60, y2: 60 }, outline: [
    { kind: 'line', x1: 0, y1: 0, x2: 60, y2: 0 }, { kind: 'line', x1: 60, y1: 0, x2: 60, y2: 60 },
    { kind: 'line', x1: 60, y1: 60, x2: 0, y2: 60 }, { kind: 'line', x1: 0, y1: 60, x2: 0, y2: 0 }] },
});
const errosMotor = ops => { const m = HC.applyPcbChanges(placa(), ops); return m.validation.filter(v => v.level === 'err').map(v => v.msg); };
/* cada poligono do contornos/paraPlaca e uma region valida pelas contas do motor */
const valido = polys => { for (const p of polys) { assert.strictEqual(HC.regiaoErro(p.pts), '', 'contorno: ' + JSON.stringify(p.pts).slice(0, 200)); if (p.holes.length) assert.strictEqual(HC.furosErro(p.pts, p.holes), ''); } };

/* ---------- mascara ---------- */
t('mascara: limiar, inverter e alfa', () => {
  const px = Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255, 100, 100, 100, 255, 0, 0, 0, 0]);
  assert.deepStrictEqual([...S.mascaraDeRGBA(px, 4, 1).m], [1, 0, 1, 0], 'escuro = tinta, transparente nunca');
  assert.deepStrictEqual([...S.mascaraDeRGBA(px, 4, 1, { limiar: 90 }).m], [1, 0, 0, 0]);
  assert.deepStrictEqual([...S.mascaraDeRGBA(px, 4, 1, { inverter: true }).m], [0, 1, 0, 0], 'invertido: o transparente continua sem tinta');
  assert.deepStrictEqual([...S.mascaraDeRGBA(px, 4, 1, { alfa: false }).m], [1, 0, 1, 1], 'sem alfa o preto transparente e tinta');
  assert.strictEqual(S.mascaraDeRGBA(px, 4, 1).n, 2);
  assert.throws(() => S.mascaraDeRGBA(px, 5, 1), /pede/);
});

/* ---------- contornos ---------- */
t('quadrado cheio: 1 poligono sem furo, nas bordas dos pixels', () => {
  const P = S.contornos(mascara(6, 6, (i, j) => i >= 1 && i <= 4 && j >= 1 && j <= 4));
  assert.strictEqual(P.length, 1);
  assert.strictEqual(P[0].holes.length, 0);
  const xs = P[0].pts.map(p => p[0]), ys = P[0].pts.map(p => p[1]);
  assert.deepStrictEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [1, 5, 1, 5]);
  assert.strictEqual(P[0].pts.length, 8, 'colineares saem: 4 lados + 4 chanfros');
  assert.strictEqual(Math.abs(area(P[0].pts)), 16 - 4 * 0.125);
  valido(P);
});
t('anel: 1 poligono com 1 furo', () => {
  const P = S.contornos(mascara(9, 9, (i, j) => i >= 1 && i <= 7 && j >= 1 && j <= 7 && !(i >= 3 && i <= 5 && j >= 3 && j <= 5)));
  assert.strictEqual(P.length, 1);
  assert.strictEqual(P[0].holes.length, 1);
  valido(P);
});
t('anel com ilha: 2 poligonos, o de fora primeiro', () => {
  const P = S.contornos(mascara(11, 11, (i, j) => {
    const d = Math.max(Math.abs(i - 5), Math.abs(j - 5));
    return d === 5 || d === 4 || d <= 1;
  }));
  assert.strictEqual(P.length, 2);
  assert.strictEqual(P[0].holes.length, 1);
  assert.strictEqual(P[0].nivel, 0);
  assert.strictEqual(P[1].holes.length, 0);
  assert.strictEqual(P[1].nivel, 2, 'a ilha dentro do furo e nivel 2');
  valido(P);
});
t('xadrez (sela): aneis que nao se encostam, separa e liga', () => {
  const M = mascara(8, 8, (i, j) => (i + j) % 2 === 0);
  const sep = S.contornos(M, { areaMin: 0 });
  assert.strictEqual(sep.length, 32, 'separa: cada pixel um losango');
  assert.ok(sep.every(p => !p.holes.length));
  valido(sep);
  const R = sep.map(p => p.pts);
  assert.strictEqual(S._int.algumCruzamento(R), null, 'nenhum anel encosta noutro');
  const lig = S.contornos(M, { areaMin: 0, diagonal: 'liga' });
  assert.strictEqual(lig.length, 1, 'liga: um bloco so');
  assert.strictEqual(lig[0].holes.length, 18, 'com os 18 vazios de dentro (fora da borda) como furos');
  valido(lig);
  assert.strictEqual(S._int.algumCruzamento([lig[0].pts].concat(lig[0].holes)), null);
});
t('areaMin tira a mancha de um pixel', () => {
  const M = mascara(10, 10, (i, j) => (i >= 1 && i <= 6 && j >= 1 && j <= 6) || (i === 8 && j === 8));
  assert.strictEqual(S.contornos(M).length, 1);
  assert.strictEqual(S.contornos(M, { areaMin: 0 }).length, 2);
});

/* ---------- paraPlaca ---------- */
t('paraPlaca: escala, centro, Y para cima, espelho e giro', () => {
  /* um "L": a perna comprida em baixo na imagem (Y para baixo) */
  const P = S.contornos(mascara(10, 10, (i, j) => (i >= 1 && i <= 2 && j >= 1 && j <= 8) || (i >= 1 && i <= 6 && j >= 7 && j <= 8)));
  const A = S.paraPlaca(P, { x: 20, y: 30, largura: 6, simplificar: 0, pixel: 0 });
  const bb = A.info.caixa;
  assert.ok(Math.abs(bb.x1 - 17) < 1e-9 && Math.abs(bb.x2 - 23) < 1e-9, JSON.stringify(bb));
  assert.ok(Math.abs((bb.y1 + bb.y2) / 2 - 30) < 1e-9);
  assert.ok(Math.abs(A.info.escala - 1) < 1e-12, 'largura 6 mm / 6 px');
  assert.ok(Math.abs(bb.y2 - bb.y1 - 8) < 1e-9, 'a altura segue a proporcao');
  /* a perna de baixo da imagem fica EM BAIXO na placa (Y para cima) */
  const baixo = A[0].pts.filter(p => p[1] < 27);
  assert.ok(baixo.some(p => p[0] > 22), 'perna horizontal em baixo, para a direita');
  const E = S.paraPlaca(P, { x: 20, y: 30, largura: 6, simplificar: 0, pixel: 0, espelhar: true });
  assert.ok(E[0].pts.filter(p => p[1] < 27).some(p => p[0] < 18), 'espelhado: perna para a esquerda');
  const G = S.paraPlaca(P, { x: 0, y: 0, altura: 4, simplificar: 0, pixel: 0, rot: 90 });
  assert.ok(Math.abs(G.info.caixa.x2 - G.info.caixa.x1 - 4) < 1e-9, 'girado 90: a altura vira largura');
  assert.ok(area(A[0].pts) > 0, 'contorno anti-horario');
  assert.throws(() => S.paraPlaca(P, {}), /largura, altura ou escala/);
});
t('paraPlaca: simplificacao reduz vertices e nao estraga', () => {
  /* um disco com furo redondo, 200 px */
  const P = S.contornos(mascara(200, 200, (i, j) => { const r = Math.hypot(i + 0.5 - 100, j + 0.5 - 100); return r < 95 && r > 40; }));
  assert.strictEqual(P.length, 1);
  const bruto = P[0].pts.length;
  const A = S.paraPlaca(P, { x: 30, y: 30, largura: 19, simplificar: 0.02 });
  assert.strictEqual(A.length, 1);
  assert.ok(A[0].pts.length < bruto / 2, `${A[0].pts.length} de ${bruto}`);
  valido(A);
});
t('paraPlaca: tolerancia grande demais refaz menor em vez de cruzar', () => {
  /* dentes finos e um furo colado neles: a tolerancia grosseira faria o furo encostar */
  const P = S.contornos(mascara(40, 20, (i, j) => (j >= 2 && j <= 17 && i >= 2 && i <= 37 && !(i >= 5 && i <= 34 && j >= 5 && j <= 14)) || (j >= 2 && j <= 4 && i % 3 === 0)));
  const A = S.paraPlaca(P, { x: 0, y: 0, escala: 0.05, simplificar: 0.5 });
  assert.strictEqual(A.info.descartadas.length, 0);
  valido(A);
});

/* ---------- opsDe ---------- */
t('opsDe: letra com furo passa no motor sem erro', () => {
  /* um "A" de pixels: triangulo com a barra e o miolo */
  const M = mascara(60, 60, (i, j) => {
    const x = i + 0.5 - 30, y = j + 0.5;
    const meio = Math.abs(x) <= y * 0.45, dentro = Math.abs(x) <= y * 0.45 - 9;
    return j >= 4 && j < 56 && meio && !(dentro && j > 18 && j < 34) && !(dentro && j >= 42);
  });
  const P = S.paraPlaca(S.contornos(M), { x: 25, y: 25, altura: 5 });
  const r = S.opsDe(P, { note: 'logo "teste": a' });
  assert.ok(r.ops.length >= 1);
  assert.ok(r.ops.some(o => o.holes && o.holes.length === 1), 'o miolo do A e furo');
  assert.deepStrictEqual(errosMotor(r.ops), []);
  for (const o of r.ops) {
    assert.strictEqual(o.op, 'region_add'); assert.strictEqual(o.layer, 'TopOverlay');
    assert.ok(!/":/.test(o.note), 'note sem aspas-dois-pontos');
    assert.ok(o.pts.every(p => p.every(v => Math.round(v * 1e4) / 1e4 === v)), '4 casas');
  }
  assert.ok(r.area_mm2 > 0 && r.caixa && r.caixa.x1 < 25 && r.caixa.x2 > 25);
  const ser = HC.serializeChanges(r.ops);
  assert.deepStrictEqual(ser.errors, []);
  assert.ok(ser.text.split('\n').some(l => l.includes('"holes":[[[')), 'holes na mesma linha');
  const b = S.opsDe(P, { layer: 'BottomOverlay' });
  assert.ok(b.ops.every(o => o.layer === 'BottomOverlay'));
});
t('opsDe: descarta o que o motor recusa', () => {
  const r = S.opsDe([{ pts: [[0, 0], [10, 10], [10, 0], [0, 10]], holes: [] }, { pts: [[0, 0], [4, 0], [4, 4], [0, 4]], holes: [[[3, 1], [5, 1], [5, 3], [3, 3]]] },
                     { pts: [[20, 20], [24, 20], [24, 24], [20, 24]], holes: [] }]);
  assert.strictEqual(r.ops.length, 1);
  assert.strictEqual(r.descartadas.length, 2);
  assert.ok(/cruzam/.test(r.descartadas[0].motivo));
  assert.ok(/furo/.test(r.descartadas[1].motivo));
});
t('opsDe: traco fino e vao fino avisam; guarda de vertices', () => {
  const fino = [{ pts: [[0, 0], [10, 0], [10, 0.08], [0, 0.08]], holes: [] }, { pts: [[0, 2], [10, 2], [10, 6], [0, 6]], holes: [] }, { pts: [[0, 6.05], [10, 6.05], [10, 9], [0, 9]], holes: [] }];
  const r = S.opsDe(fino);
  assert.ok(r.finos.length >= 1 && r.finos[0].y < 0.1, JSON.stringify(r.finos));
  assert.ok(r.vaos.length >= 1 && Math.abs(r.vaos[0].y - 6.025) < 0.1, JSON.stringify(r.vaos));
  assert.ok(r.avisos.some(a => /fino/.test(a)) && r.avisos.some(a => /vão/.test(a)));
  assert.ok(!S.opsDe([fino[1]]).avisos.length, 'retangulo largo nao avisa');
  const g = S.opsDe(fino, { maxVertices: 8 });
  assert.ok(g.recusado && !g.ops.length && /máximo/.test(g.avisos.join(' ')));
});
t('daImagem: reduz a mascara quando o pixel e muito menor que a tolerancia', () => {
  const w = 400, h = 400, px = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const o = (j * w + i) * 4, d = Math.hypot(i - 200, j - 200); const v = d < 150 && d > 70 ? 0 : 255; px[o] = px[o + 1] = px[o + 2] = v; px[o + 3] = 255; }
  const r = S.daImagem(px, w, h, { x: 10, y: 10, largura: 3, simplificar: 0.05 });
  assert.ok(r.reduzida >= 2, 'reduzida ' + r.reduzida);
  assert.strictEqual(r.ops.length, 1);
  assert.strictEqual(r.ops[0].holes.length, 1);
  assert.ok(Math.abs(r.caixa.x2 - r.caixa.x1 - 3) < 0.05, JSON.stringify(r.caixa));
  assert.deepStrictEqual(errosMotor(r.ops), []);
});

/* ---------- PNG ---------- */
function bloco(tipo, dados) {
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
  const td = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}
/* linhas = [Buffer da linha crua (sem o byte do filtro)]; filtra com o filtro `ft` (0..4 ou 'varia') */
function filtra(linhas, bpp, ft) {
  const out = [];
  let ant = Buffer.alloc(linhas[0].length);
  linhas.forEach((L, y) => {
    const f = ft === 'varia' ? y % 5 : ft, r = Buffer.alloc(L.length + 1);
    r[0] = f;
    for (let i = 0; i < L.length; i++) {
      const a = i >= bpp ? L[i - bpp] : 0, b = ant[i], c = i >= bpp ? ant[i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pr = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      r[i + 1] = (L[i] - pr) & 255;
    }
    out.push(r); ant = L;
  });
  return Buffer.concat(out);
}
function fazPng(w, h, cor, bits, linhas, extra, opts) {
  const o = opts || {};
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = bits; ih[9] = cor; ih[12] = o.entrelaca ? 1 : 0;
  const canais = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[cor];
  const dados = zlib.deflateSync(filtra(linhas, Math.max(1, (canais * bits) >> 3), o.filtro == null ? 'varia' : o.filtro));
  /* IDAT em dois pedacos: o leitor emenda */
  const meio = dados.length >> 1;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ih)].concat(extra || [],
    [bloco('IDAT', dados.subarray(0, meio)), bloco('IDAT', dados.subarray(meio)), bloco('IEND', Buffer.alloc(0))]));
}
const px = (img, x, y) => Array.from(img.rgba.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4));

t('png: RGB 8 bits com todos os filtros e o pHYs', () => {
  const w = 7, h = 6, L = [];
  for (let y = 0; y < h; y++) { const b = Buffer.alloc(w * 3); for (let x = 0; x < w; x++) { b[3 * x] = x * 30; b[3 * x + 1] = y * 40; b[3 * x + 2] = (x * y * 17) & 255; } L.push(b); }
  const ph = Buffer.alloc(9); ph.writeUInt32BE(10000, 0); ph.writeUInt32BE(10000, 4); ph[8] = 1;
  const img = PNG.decodifica(fazPng(w, h, 2, 8, L, [bloco('pHYs', ph)]));
  assert.strictEqual(img.w, 7); assert.strictEqual(img.h, 6);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) assert.deepStrictEqual(px(img, x, y), [x * 30, y * 40, (x * y * 17) & 255, 255]);
  assert.strictEqual(img.mm_por_px, 0.1, '10000 px/m = 0,1 mm/px');
});
t('png: paleta (cor 3) 2 bits com tRNS', () => {
  const w = 5, h = 2;
  const pal = Buffer.from([0, 0, 0, 255, 255, 255, 200, 10, 10]);
  const idx = [[0, 1, 2, 1, 0], [2, 2, 0, 1, 1]];
  const L = idx.map(r => { const b = Buffer.alloc(Math.ceil(w * 2 / 8)); r.forEach((v, x) => { b[x >> 2] |= v << (6 - 2 * (x & 3)); }); return b; });
  const img = PNG.decodifica(fazPng(w, h, 3, 2, L, [bloco('PLTE', pal), bloco('tRNS', Buffer.from([255, 0]))]));
  assert.deepStrictEqual(px(img, 0, 0), [0, 0, 0, 255]);
  assert.deepStrictEqual(px(img, 1, 0), [255, 255, 255, 0], 'indice 1 transparente');
  assert.deepStrictEqual(px(img, 2, 0), [200, 10, 10, 255], 'indice 2 sem entrada no tRNS: opaco');
  assert.deepStrictEqual(px(img, 4, 1), [255, 255, 255, 0]);
  assert.strictEqual(img.paleta, 3);
});
t('png: RGBA (cor 6) 8 e 16 bits', () => {
  const w = 3, h = 3, L = [], L16 = [];
  for (let y = 0; y < h; y++) {
    const b = Buffer.alloc(w * 4), c = Buffer.alloc(w * 8);
    for (let x = 0; x < w; x++) { const v = [x * 100, y * 100, 50, (x + y) * 60]; v.forEach((q, k) => { b[4 * x + k] = q; c.writeUInt16BE(q * 257 + 3, 8 * x + 2 * k); }); }
    L.push(b); L16.push(c);
  }
  for (const [img, nome] of [[PNG.decodifica(fazPng(w, h, 6, 8, L)), '8'], [PNG.decodifica(fazPng(w, h, 6, 16, L16)), '16']])
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) assert.deepStrictEqual(px(img, x, y), [x * 100, y * 100, 50, (x + y) * 60], nome + ' bits');
});
t('png: cinza 1 bit, cinza 16 com chave tRNS, cinza+alfa', () => {
  const w = 10, h = 2;
  const bits = [[1, 0, 1, 1, 0, 0, 0, 1, 1, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 1]];
  const L = bits.map(r => { const b = Buffer.alloc(2); r.forEach((v, x) => { b[x >> 3] |= v << (7 - (x & 7)); }); return b; });
  const img = PNG.decodifica(fazPng(w, h, 0, 1, L, [], { filtro: 0 }));
  assert.deepStrictEqual(bits[0].map((v, x) => px(img, x, 0)[0]), bits[0].map(v => v * 255));
  assert.strictEqual(px(img, 9, 1)[0], 255);
  /* o "preto e branco" de 1 bit vira tinta onde e preto */
  const M = S.mascaraDeRGBA(img.rgba, w, h);
  assert.deepStrictEqual([...M.m.subarray(0, 10)], bits[0].map(v => 1 - v));
  const g16 = [Buffer.from([0x12, 0x34, 0xff, 0xff])];
  const k = PNG.decodifica(fazPng(2, 1, 0, 16, g16, [bloco('tRNS', Buffer.from([0x12, 0x34]))]));
  assert.deepStrictEqual(px(k, 0, 0), [0x12, 0x12, 0x12, 0]);
  assert.deepStrictEqual(px(k, 1, 0), [255, 255, 255, 255]);
  const ga = PNG.decodifica(fazPng(2, 1, 4, 8, [Buffer.from([10, 20, 200, 255])]));
  assert.deepStrictEqual(px(ga, 0, 0), [10, 10, 10, 20]);
  assert.deepStrictEqual(px(ga, 1, 0), [200, 200, 200, 255]);
});
t('png: entrelacado, JPEG e lixo voltam com mensagem clara', () => {
  assert.throws(() => PNG.decodifica(fazPng(2, 1, 0, 8, [Buffer.from([0, 255])], [], { entrelaca: true })), /entrelaçado.*SEM entrelaçamento/);
  assert.throws(() => PNG.decodifica(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10])), /JPEG, não PNG/);
  assert.throws(() => PNG.decodifica(Buffer.from('GIF89a........')), /GIF/);
  assert.throws(() => PNG.decodifica(Buffer.from('ola mundo')), /não é PNG/);
  const bom = fazPng(2, 2, 0, 8, [Buffer.from([0, 0]), Buffer.from([0, 0])]);
  assert.throws(() => PNG.decodifica(bom.subarray(0, 40)), /truncado|sem dados/);
});
t('png -> serigrafia: o caminho inteiro', () => {
  const w = 40, h = 40, L = [];
  for (let y = 0; y < h; y++) { const b = Buffer.alloc(w * 4); for (let x = 0; x < w; x++) { const d = Math.max(Math.abs(x - 20), Math.abs(y - 20)); const tinta = d <= 15 && d >= 7; b.set(tinta ? [0, 0, 0, 255] : [0, 0, 0, 0], 4 * x); } L.push(b); }
  const img = PNG.decodifica(fazPng(w, h, 6, 8, L));
  const r = S.daImagem(img.rgba, img.w, img.h, { x: 30, y: 30, largura: 6 });
  assert.strictEqual(r.ops.length, 1);
  assert.strictEqual(r.ops[0].holes.length, 1);
  assert.deepStrictEqual(errosMotor(r.ops), []);
});

/* ---------- texto ---------- */
const ARIAL = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'arial.ttf');
if (fs.existsSync(ARIAL)) {
  const ot = require('../vendor/opentype.min.js');
  const b = fs.readFileSync(ARIAL);
  const font = ot.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  t('textoComFonte: "Ode" em Arial tem furo no O, no d e no e', () => {
    const P = S.textoComFonte(font, 'Ode', { h: 2, x: 20, y: 10 });
    assert.strictEqual(P.length, 3);
    assert.deepStrictEqual(P.map(p => p.holes.length), [1, 1, 1]);
    const bb = P.info.caixa;
    assert.ok(Math.abs((bb.x1 + bb.x2) / 2 - 20) < 1e-9 && Math.abs((bb.y1 + bb.y2) / 2 - 10) < 1e-9, 'centro da tinta em x, y');
    /* h = altura da maiuscula: o O (com o overshoot) fica perto de 2 mm */
    const O = S._int.caixaDe([P.slice().sort((a, b2) => S._int.caixaDe([a.pts]).x1 - S._int.caixaDe([b2.pts]).x1)[0].pts]);
    assert.ok(Math.abs(O.y2 - O.y1 - 2) < 0.1, 'altura do O ' + (O.y2 - O.y1));
    valido(P);
    const r = S.opsDe(P, { note: 'texto Ode' });
    assert.strictEqual(r.ops.length, 3);
    assert.strictEqual(r.furos, 3);
    assert.deepStrictEqual(errosMotor(r.ops), []);
    assert.ok(!r.avisos.length, 'h 2 mm em Arial nao e fino: ' + r.avisos.join(' | '));
  });
  t('textoComFonte: alinhamento, espelho, duas linhas, glifo que falta', () => {
    const E = S.textoComFonte(font, 'AB', { h: 1.5, x: 5, y: 5, alinha: 'esquerda' });
    assert.ok(Math.abs(E.info.caixa.x1 - 5) < 1e-9);
    const D = S.textoComFonte(font, 'AB', { h: 1.5, x: 5, y: 5, alinha: 'direita' });
    assert.ok(Math.abs(D.info.caixa.x2 - 5) < 1e-9);
    const M = S.textoComFonte(font, 'R', { h: 2, x: 0, y: 0, espelhar: true });
    const N = S.textoComFonte(font, 'R', { h: 2, x: 0, y: 0 });
    assert.ok(Math.abs(Math.abs(area(M[0].pts)) - Math.abs(area(N[0].pts))) < 1e-6, 'espelho mantem a area');
    const L2 = S.textoComFonte(font, 'A\nA', { h: 1, x: 0, y: 0 });
    assert.strictEqual(L2.length, 2);
    assert.ok(L2.info.caixa.y2 - L2.info.caixa.y1 > 2, 'duas linhas');
    const F = S.daTexto(font, 'A\u4e00', { h: 1.5, x: 0, y: 0 });
    assert.deepStrictEqual(F.faltam, ['\u4e00']);
    assert.ok(F.avisos.some(a => /glifo/.test(a)));
    const fino = S.daTexto(font, 'Teste', { h: 0.6, x: 10, y: 10 });
    assert.ok(fino.avisos.some(a => /fino/.test(a)), 'Arial de 0,6 mm e fina para a serigrafia');
    assert.deepStrictEqual(errosMotor(fino.ops), []);
  });
  t('textoComFonte: frase com acento e numeros passa no motor', () => {
    const r = S.daTexto(font, 'Versão 1.60 — ©DIEletrons 08/2026', { h: 1.2, x: 30, y: 30, rot: 90 });
    assert.ok(r.ops.length > 20);
    assert.deepStrictEqual(r.descartadas, []);
    assert.deepStrictEqual(errosMotor(r.ops), []);
  });
} else console.log('(sem a Arial do Windows: testes de texto pulados)');

console.log(`test-silkgen: ${ok} ok`);
