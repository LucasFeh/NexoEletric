/* Teardrops do Altium 21 (hub-pcbteardrop.js), sem navegador.

   Parte 1: a geometria medida, em numeros (via 0,7 / trilha 0,254 e pad 2x1,8 / trilha 0,5, os
   casos mais comuns do acervo), e as regras de quando NAO ha teardrop.
   Parte 2: orfaos -- mover/apagar a trilha pela placa efetiva deixa o teardrop do espelho orfao,
   e refaz() troca pelo do mesmo par.
   Parte 3: o acervo. Os board.js nao trazem a marca do Altium, entao a referencia aqui sao os
   teardrops que reconhece() acha no espelho: tira-os, gera de novo e compara forma a forma
   (IoU dos quadrilateros). Contra a marca de verdade do .PcbDoc (bit 0x10 do Regions6, lida com
   o tools/pcbdoc em 14 projetos, 3.087 teardrops, fora do repo) a medicao de 2026-10-13 deu:
   reconhece 2.995 (97%), 0 falso; dos 3.002 quadrilateros, 2.828 refeitos (94%) com IoU medio
   0,964 e erro de area medio 2,3%. */
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { loadVar } = require('./load.js');
const T = require('../hub-pcbteardrop.js');
const N = require('../hub-pcbnets.js');
const C = require('../hub-core.js');

let ok = 0;
const t = (nome, fn) => { fn(); ok++; };
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-4);
const placa = o => Object.assign({ nets: ['A'], components: [], freepads: [], tracks: [], arcs: [], vias: [], fills: [], regions: [] }, o);
const via = (id, x, y, size) => ({ id, x, y, size, drill: 0.3, from: 'Top', to: 'Bottom', net: 'A' });
const trk = (id, x1, y1, x2, y2, w, o) => Object.assign({ id, layer: 'Top', x1, y1, x2, y2, w, net: 'A' }, o || {});
const pad = (id, x, y, w, h, o) => Object.assign({ id, name: '1', layer: 'Top', type: 'smd', shape: 'rect', x, y, w, h, rot: 0, net: 'A' }, o || {});

function area(P){ let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
const ccw = P => area(P) < 0 ? [...P].reverse() : P;
function corta(S, Q){
  let out = S;
  for (let i = 0; i < Q.length && out.length; i++) {
    const a = Q[i], b = Q[(i + 1) % Q.length], inp = out, lado = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], dp = lado(p), dq = lado(q);
      if (dp >= 0) out.push(p);
      if ((dp >= 0) !== (dq >= 0)) { const k = dp / (dp - dq); out.push([p[0] + k * (q[0] - p[0]), p[1] + k * (q[1] - p[1])]); }
    }
  }
  return out;
}
/* IoU de dois quadrilateros convexos */
function iou(A, B){ A = ccw(A); B = ccw(B); const I = corta(A, B); const ai = I.length >= 3 ? Math.abs(area(I)) : 0; return ai / (Math.abs(area(A)) + Math.abs(area(B)) - ai); }

/* ============================== parte 1 ============================== */

t('via 0,7 com trilha 0,254: base no circulo a 70%, ponta 30% alem da saida da borda', () => {
  const B = placa({ vias: [via('v1', 10, 10, 0.7)], tracks: [trk('t1', 10, 10, 15, 10, 0.254)] });
  const g = T.gera(B);
  assert.strictEqual(g.length, 1);
  const r = g[0];
  assert.strictEqual(r.teardrop, true); assert.strictEqual(r.de, 'v1'); assert.strictEqual(r.trilha, 't1');
  assert.strictEqual(r.layer, 'Top'); assert.strictEqual(r.net, 'A'); assert.strictEqual(r.id, 'td:v1:t1:Top');
  /* o Altium grava [[0.5361,-0.127],[0.25,-0.245],[0.25,0.245],[0.5361,0.127]] (VDCB, g4) */
  const loc = r.points.map(p => [p[0] - 10, p[1] - 10]);
  const alt = [[0.5361, -0.127], [0.25, -0.245], [0.25, 0.245], [0.5361, 0.127]];
  loc.forEach((p, i) => { assert.ok(near(p[0], alt[i][0], 2e-4) && near(p[1], alt[i][1], 2e-4), JSON.stringify(loc)); });
});

t('pad 2x1,8 com trilha 0,5: largura 200% e comprimento 100% da trilha', () => {
  const B = placa({ freepads: [pad('p1', 0, 0, 2, 1.8)], tracks: [trk('t1', 0, 0, 5, 0, 0.5)] });
  const [r] = T.gera(B);
  /* Altium: base (0,9939, +-0,5), ponta (1,4969, +-0,25) -- 3 a 6 micros para dentro */
  const [tm, bm, bp, tp] = r.points;
  assert.ok(near(bm[0], 1, 0.007) && near(bm[1], -0.5) && near(bp[1], 0.5));
  assert.ok(near(tm[0], 1.5, 0.004) && near(tm[1], -0.25) && near(tp[1], 0.25));
});

t('pad estreito: a largura para no lado do pad (0,8x0,3 com trilha 0,254)', () => {
  const B = placa({ freepads: [pad('p1', 0, 0, 0.8, 0.3)], tracks: [trk('t1', 0, 0, 3, 0, 0.254)] });
  const [r] = T.gera(B);
  assert.ok(near(Math.abs(r.points[1][1]), 0.147, 2e-4));      /* Altium: 0,147 */
  assert.ok(near(r.points[0][0], 0.654, 4e-3));                /* Altium: 0,6509 */
});

t('pad passante redondo segue a regra da via (70%/30% do diametro)', () => {
  const B = placa({ freepads: [pad('p1', 0, 0, 2.2, 2.2, { layer: 'Multi', type: 'th', shape: 'circle', drill: 1 })],
                    tracks: [trk('t1', 0, 0, 0, -6, 1, { layer: 'Bottom' })] });
  const [r] = T.gera(B);
  assert.strictEqual(r.layer, 'Bottom');
  /* Altium (PRJ-IT): base 0,7856 / meia largura 0,77; ponta 1,6398 */
  assert.ok(near(-r.points[1][1], 0.7856, 2e-4) && near(Math.abs(r.points[1][0]), 0.77, 2e-4));
  assert.ok(near(-r.points[0][1], 1.6398, 2e-4));
});

t('sem teardrop: trilha tao larga quanto o pad, ponta fora do pad, trilha de outra net, keepout', () => {
  assert.strictEqual(T.gera(placa({ vias: [via('v1', 0, 0, 0.5)], tracks: [trk('t1', 0, 0, 5, 0, 0.5)] })).length, 0);
  assert.strictEqual(T.gera(placa({ vias: [via('v1', 0, 0, 0.7)], tracks: [trk('t1', 0.6, 0, 5, 0, 0.254)] })).length, 0);
  assert.strictEqual(T.gera(placa({ vias: [via('v1', 0, 0, 0.7)], tracks: [trk('t1', 0, 0, 5, 0, 0.254, { net: 'B' })] })).length, 0);
  assert.strictEqual(T.gera(placa({ vias: [via('v1', 0, 0, 0.7)], tracks: [trk('t1', 0, 0, 5, 0, 0.254, { keepout: true })] })).length, 0);
});

t('trilha curta: a ponta nao passa da outra ponta da trilha', () => {
  const [r] = T.gera(placa({ vias: [via('v1', 0, 0, 0.7)], tracks: [trk('t1', 0, 0, 0.45, 0, 0.254)] }));
  assert.ok(r.points[0][0] <= 0.45 + 1e-9);
});

t('opcoes: so vias, so ids, estilo curva', () => {
  const B = placa({ vias: [via('v1', 10, 0, 0.7)], freepads: [pad('p1', 0, 0, 2, 1.8)],
                    tracks: [trk('t1', 0, 0, 10, 0, 0.3)] });
  assert.strictEqual(T.gera(B).length, 2);
  assert.deepStrictEqual(T.gera(B, { pads: false }).map(r => r.de), ['v1']);
  assert.deepStrictEqual(T.gera(B, { ids: ['p1'] }).map(r => r.de), ['p1']);
  const c = T.gera(B, { estilo: 'curva', ids: ['v1'] })[0];
  assert.ok(c.points.length > 4);
  const l = T.gera(B, { ids: ['v1'] })[0];
  assert.ok(Math.abs(area(c.points)) < Math.abs(area(l.points)));   /* a curva e concava: menos cobre */
});

/* ============================== parte 1b: junção em T (1.42.0) ============================== */

const soT = g => g.filter(r => r.tipo === 'trilha');
t('T do LM555: principal em dois pedacos emendados, trilha de 0,381 chegando de baixo', () => {
  /* Altium (LM555 astavel, g da t27): [[0,0.1905],[-0.5715,-0.1905],[-0.1905,-0.5715],[0.1905,-0.5715],[0.5715,-0.1905]] */
  const B = placa({ tracks: [trk('t49', -1, 0, 0, 0, 0.381), trk('t46', 0, 0, 1, 0, 0.381), trk('t27', 0, -4, 0, 0, 0.381)] });
  const g = soT(T.gera(B));
  assert.strictEqual(g.length, 1, JSON.stringify(g));
  assert.strictEqual(g[0].trilha, 't27'); assert.strictEqual(g[0].teardrop, true); assert.strictEqual(g[0].net, 'A');
  const alt = [[0, 0.1905], [-0.5715, -0.1905], [-0.1905, -0.5715], [0.1905, -0.5715], [0.5715, -0.1905]];
  g[0].points.forEach((p, i) => assert.ok(near(p[0], alt[i][0], 2e-4) && near(p[1], alt[i][1], 2e-4), JSON.stringify(g[0].points)));
});

t('T do DMB: principal de 1 numa trilha so, trilha de 0,5: a base anda a largura da PRINCIPAL', () => {
  /* Altium (DMB, t159): base em +-1,25 na borda (y 0,5), ponta 0,5 alem, apice em y -0,5 */
  const B = placa({ tracks: [trk('m', -5, 0, 5, 0, 1), trk('b', 0, 0, 0, 6, 0.5)] });
  const [r] = soT(T.gera(B));
  const P = r.points;
  assert.ok(near(P[0][0], 0) && near(P[0][1], -0.5), JSON.stringify(P));
  assert.ok(near(Math.abs(P[1][0]), 1.25) && near(P[1][1], 0.5) && near(Math.abs(P[4][0]), 1.25));
  assert.ok(near(Math.abs(P[2][0]), 0.25) && near(P[2][1], 1.0) && near(P[3][1], 1.0));
});

t('T a 45 graus (PAEL): ponta na borda da trilha, base pela borda da principal', () => {
  /* Altium: [[148.971,64.85527],[148.12602,64.15526],[149.321,63.66029],[150.31095,63.66029],[150.51598,64.15526]] */
  const x0 = 148.971, y0 = 64.50527;
  const B = placa({ tracks: [trk('t15', x0, y0, 154.67527, y0, 0.7), trk('t41', 143.272, y0, x0, y0, 0.7), trk('t16', x0, y0, 150.368, 63.10827, 0.7)] });
  const [r] = soT(T.gera(B));
  const alt = [[148.971, 64.85527], [148.12602, 64.15526], [149.321, 63.66029], [150.31095, 63.66029], [150.51598, 64.15526]];
  const pega = q => r.points.some(p => near(p[0], q[0], 2e-4) && near(p[1], q[1], 2e-4));
  assert.ok(alt.every(pega), JSON.stringify(r.points));
});

t('sem T: canto (L), emenda reta, ponta dentro de via, outra net, tjuncao:false e ids', () => {
  assert.strictEqual(soT(T.gera(placa({ tracks: [trk('a', 0, 0, 5, 0, 0.3), trk('b', 0, 0, 0, 5, 0.3)] }))).length, 0, 'L');
  assert.strictEqual(soT(T.gera(placa({ tracks: [trk('a', 0, 0, 5, 0, 0.3), trk('b', 5, 0, 9, 0.5, 0.3)] }))).length, 0, 'emenda');
  assert.strictEqual(soT(T.gera(placa({ tracks: [trk('a', -5, 0, 5, 0, 0.3), trk('b', 0, 0, 0, 5, 0.3, { net: 'B' })] }))).length, 0, 'outra net');
  const comVia = placa({ vias: [via('v1', 0, 0, 0.7)], tracks: [trk('a', -5, 0, 5, 0, 0.3), trk('b', 0, 0, 0, 5, 0.3)] });
  assert.strictEqual(soT(T.gera(comVia)).length, 0, 'na via');
  const B = placa({ tracks: [trk('a', -5, 0, 5, 0, 0.3), trk('b', 0, 0, 0, 5, 0.3)] });
  assert.strictEqual(soT(T.gera(B)).length, 1);
  assert.strictEqual(soT(T.gera(B, { tjuncao: false })).length, 0);
  assert.strictEqual(soT(T.gera(B, { ids: ['x'] })).length, 0);
  /* perto da ponta da principal a base nao cabe na borda reta: sem T */
  assert.strictEqual(soT(T.gera(placa({ tracks: [trk('a', -0.2, 0, 5, 0, 0.3), trk('b', 0, 0, 0, 5, 0.3)] }))).length, 0, 'na ponta');
});

t('faltam(): o T posto e reconhecido (trilha com trilha) e nao pede de novo; todos() acha os dois lados', () => {
  const B = placa({ vias: [via('v1', 10, 0, 0.7)], tracks: [trk('a', -5, 0, 10, 0, 0.3), trk('b', 0, 0, 0, 5, 0.25)] });
  const f0 = T.faltam(B);
  assert.deepStrictEqual(f0.map(g => g.tipo || 'pad').sort(), ['pad', 'trilha']);
  const ch = f0.map(g => ({ op: 'region_add', layer: g.layer, net: g.net, pts: g.points, note: 'teardrop do hub' }));
  const m = C.applyPcbChanges(B, ch);
  assert.ok(!m.changeItems.some(it => it.status === 'err'), JSON.stringify(m.changeItems.map(it => it.msg)));
  const eb = C.effectiveBoard(B, m);
  const rec = T.reconhece(eb);
  assert.ok(rec.some(r => r.tipo === 'trilha') && rec.some(r => r.tipo === 'pad'), JSON.stringify(rec));
  assert.deepStrictEqual(T.faltam(eb), []);
  /* o do espelho (no board.js cru) e o do hub (na placa efetiva) */
  const B2 = Object.assign({}, B, { regions: [{ id: 'g1', layer: 'Top', net: 'A', points: f0.find(g => g.tipo === 'trilha').points }] });
  const eb2 = C.effectiveBoard(B2, C.applyPcbChanges(B2, ch.filter(c => !/^td:T/.test(c.id || '')).slice(0, 1)));
  const tod = T.todos(eb2, B2);
  assert.ok(tod.some(r => r.id === 'g1' && r.espelho) && tod.some(r => !r.espelho), JSON.stringify(tod));
});

/* ============================== parte 2: orfaos ============================== */

t('trilha movida: o teardrop do espelho fica orfao e refaz() poe o novo no mesmo par', () => {
  const B = placa({ vias: [via('v1', 10, 10, 0.7)], tracks: [trk('t1', 10, 10, 15, 10, 0.254)] });
  const td = T.gera(B)[0];
  B.regions = [{ id: 'g1', layer: td.layer, net: td.net, points: td.points }];   /* como o espelho traz */
  const rec = T.reconhece(B);
  assert.deepStrictEqual(rec.map(r => [r.id, r.de.id, r.trilha]), [['g1', 'v1', 't1']]);
  assert.deepStrictEqual(T.orfaos(C.effectiveBoard(B, C.applyPcbChanges(B, [])), B), []);
  /* a trilha passa a sair da via para cima */
  const ch = [{ op: 'track_edit', id: 't1', x2: 10, y2: 15, orig_x1: 10, orig_y1: 10, orig_x2: 15, orig_y2: 10, orig_w: 0.254, orig_layer: 'Top' }];
  const eb = C.effectiveBoard(B, C.applyPcbChanges(B, ch));
  assert.deepStrictEqual(T.orfaos(eb, B), ['g1']);
  const R = T.refaz(eb, B);
  assert.deepStrictEqual(R.removidos, ['g1']);
  assert.strictEqual(R.gerados.length, 1);
  assert.ok(R.gerados[0].points.every(p => p[1] >= 10 - 0.3));              /* agora para cima */
  assert.deepStrictEqual(R.eb.regions.map(g => g.id), ['td:v1:t1:Top']);
  /* a placa refeita nao tem orfao nem pede de novo */
  assert.deepStrictEqual(T.orfaos(R.eb, R.eb), []);
});

t('trilha apagada: orfao e nada a refazer; region qualquer nao e teardrop', () => {
  const B = placa({ vias: [via('v1', 10, 10, 0.7)], tracks: [trk('t1', 10, 10, 15, 10, 0.254)] });
  const td = T.gera(B)[0];
  B.regions = [{ id: 'g1', layer: 'Top', net: 'A', points: td.points },
               { id: 'g2', layer: 'Top', net: 'A', points: [[0, 0], [1, 0], [1, 1], [0, 1]] },
               { id: 'g3', layer: 'Top', net: 'A', poly: true, points: td.points }];
  assert.deepStrictEqual(T.reconhece(B).map(r => r.id), ['g1']);
  const ch = [{ op: 'track_del', id: 't1', orig_x1: 10, orig_y1: 10, orig_x2: 15, orig_y2: 10, orig_w: 0.254, orig_layer: 'Top' }];
  const eb = C.effectiveBoard(B, C.applyPcbChanges(B, ch));
  const R = T.refaz(eb, B);
  assert.deepStrictEqual(R.removidos, ['g1']);
  assert.strictEqual(R.gerados.length, 0);
  assert.deepStrictEqual(R.eb.regions.map(g => g.id), ['g2', 'g3']);
  /* o Gerber e a tela continuam lendo regions com points */
  assert.ok(R.eb.regions.every(g => Array.isArray(g.points)));
});

/* ============================== parte 3: o acervo ============================== */

const dir = path.join(__dirname, '..', 'Projects');
let soma = 0, casados = 0, total = 0, erroArea = 0;
const linhas = [];
for (const d of (fs.existsSync(dir) ? fs.readdirSync(dir) : [])) {
  const f = path.join(dir, d, 'board.js');
  if (!fs.existsSync(f)) continue;
  const B = loadVar(path.relative(path.join(__dirname, '..'), f), 'pcbmirror');
  const t0 = process.hrtime.bigint();
  const rec = T.reconhece(B).filter(r => r.tipo === 'pad');
  const t1 = process.hrtime.bigint();
  if (!rec.length) continue;
  const ids = new Set(T.reconhece(B).map(r => r.id));
  const sem = Object.assign({}, B, { regions: B.regions.filter(g => !ids.has(g.id)) });
  const t2 = process.hrtime.bigint();
  const gen = T.gera(sem);
  const t3 = process.hrtime.bigint();
  const porPar = new Map(gen.map(g => [g.de + '|' + g.trilha + '|' + g.layer, g]));
  const regs = new Map(B.regions.map(g => [g.id, g]));
  let c = 0, s = 0;
  for (const r of rec) {
    const alt = regs.get(r.id), g = porPar.get(r.de.id + '|' + r.trilha + '|' + r.layer);
    const P = alt.points.filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
    if (!g || P.length !== 4) continue;
    const v = iou(P, g.points);
    c++; s += v; erroArea += Math.abs(Math.abs(area(g.points)) / Math.abs(area(P)) - 1);
  }
  total += rec.length; casados += c; soma += s;
  linhas.push(`  ${d.slice(0, 44).padEnd(44)} ${String(rec.length).padStart(4)} teardrops  refeitos ${String(c).padStart(4)}  IoU ${(s / c).toFixed(3)}  ` +
              `reconhece ${(Number(t1 - t0) / 1e6).toFixed(1)} ms  gera ${(Number(t3 - t2) / 1e6).toFixed(1)} ms`);
  ok++;
}
if (total) {
  const media = soma / casados;
  console.log(linhas.join('\n'));
  console.log(`  acervo: ${casados}/${total} refeitos (${(100 * casados / total).toFixed(1)}%), IoU medio ${media.toFixed(4)}, erro de area medio ${(100 * erroArea / casados).toFixed(2)}%`);
  assert.ok(casados / total > 0.9, 'menos de 90% dos teardrops do espelho refeitos');
  assert.ok(media > 0.93, 'IoU medio abaixo de 0,93');
  ok++;
}
console.log(`test-pcbteardrop: ${ok} ok`);
