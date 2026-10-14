/* Conectividade de cobre, linhas de conexao e realce de net (hub-pcbnets.js), sem navegador.

   Parte 1: placas de brinquedo, uma regra do Altium por bloco.
   Parte 2: o acervo (os board.js de Projects): todo projeto roda, o tempo do maior fica abaixo da
   meta (100 ms por recalculo) e tirar as trilhas faz as linhas de conexao aparecerem. Os numeros
   dependem de cada board.js e sao procurados a cada rodada, nao presos aqui. */
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { loadVar } = require('./load.js');
const N = require('../hub-pcbnets.js');
const C = require('../hub-core.js');

let ok = 0;
const t = (nome, fn) => { fn(); ok++; };
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-6);

const pad = (id, x, y, net, o) => Object.assign({ id, name: id, layer: 'Top', type: 'smd', shape: 'rect', x, y, w: 1, h: 1, rot: 0, net }, o || {});
const th = (id, x, y, net, o) => pad(id, x, y, net, Object.assign({ layer: 'Multi', type: 'th', shape: 'circle', w: 1.6, h: 1.6, drill: 0.8, plated: true }, o || {}));
const trk = (id, x1, y1, x2, y2, net, o) => Object.assign({ id, layer: 'Top', x1, y1, x2, y2, w: 0.3, net }, o || {});
const placa = o => Object.assign({ nets: [], components: [], freepads: [], tracks: [], arcs: [], vias: [], fills: [], regions: [] }, o);
const comp = (ref, pads) => ({ id: 'c' + ref, ref, layer: 'Top', x: 0, y: 0, rot: 0, pads });

/* ============================== parte 1 ============================== */

t('dois pads da mesma net sem trilha: uma linha, de centro a centro', () => {
  const B = placa({ nets: ['A'], components: [comp('R1', [pad('p1', 0, 0, 'A'), pad('p2', 5, 0, 'A')])] });
  const c = N.conexoes(B);
  assert.strictEqual(c.linhas.length, 1);
  const l = c.linhas[0];
  assert.deepStrictEqual([l.x1, l.y1, l.x2, l.y2].map(Math.abs).sort(), [0, 0, 0, 5]);
  assert.strictEqual(l.net, 'A');
  assert.deepStrictEqual(N.naoRoteadas(B).total, 1);
});

t('trilha terminando DENTRO do pad (nao no centro) liga', () => {
  const B = placa({ nets: ['A'], freepads: [pad('p1', 0, 0, 'A'), pad('p2', 5, 0, 'A')],
                    tracks: [trk('t1', 0.4, 0.2, 4.7, 0.2, 'A')] });
  assert.strictEqual(N.naoRoteadas(B).total, 0);
});

t('trilha que para a 0,2 mm do pad nao liga; a linha vai da ponta da trilha ao pad', () => {
  const B = placa({ nets: ['A'], freepads: [pad('p1', 0, 0, 'A'), pad('p2', 5, 0, 'A')],
                    tracks: [trk('t1', 0, 0, 4.15, 0, 'A')] });   /* borda do pad em 4,5; ponta+w/2 = 4,3 */
  const c = N.conexoes(B);
  assert.strictEqual(c.linhas.length, 1);
  const l = c.linhas[0], ids = [l.de.id, l.para.id].sort();
  assert.deepStrictEqual(ids, ['p2', 't1']);
  assert.ok(near(Math.hypot(l.x2 - l.x1, l.y2 - l.y1), 0.85, 1e-9));
});

t('sobreposicao de cobre basta: trilhas que se cruzam em T, sem ponta igual', () => {
  const B = placa({ nets: ['A'], freepads: [pad('p1', 0, 0, 'A'), pad('p2', 10, 5, 'A')],
                    tracks: [trk('t1', 0, 0, 10, 0, 'A'), trk('t2', 6, -0.1, 6, 2, 'A', { w: 0.3 }), trk('t3', 6, 2, 10, 5, 'A')] });
  assert.strictEqual(N.naoRoteadas(B).total, 0);
});

t('SMD do Top nao liga trilha do Bottom; passante liga as duas; via liga as camadas', () => {
  const smd = placa({ nets: ['A'], freepads: [pad('p1', 0, 0, 'A'), pad('p2', 5, 0, 'A', { layer: 'Bottom' })],
                      tracks: [trk('t1', 0, 0, 5, 0, 'A', { layer: 'Bottom' })] });
  assert.strictEqual(N.naoRoteadas(smd).conexoes, 1);
  const pth = placa({ nets: ['A'], freepads: [th('p1', 0, 0, 'A'), pad('p2', 5, 0, 'A', { layer: 'Bottom' })],
                      tracks: [trk('t1', 0, 0, 5, 0, 'A', { layer: 'Bottom' })] });
  assert.strictEqual(N.naoRoteadas(pth).conexoes, 0);
  const via = placa({ nets: ['A'], freepads: [pad('p1', 0, 0, 'A'), pad('p2', 10, 0, 'A', { layer: 'Bottom' })],
                      tracks: [trk('t1', 0, 0, 5, 0, 'A'), trk('t2', 5, 0, 10, 0, 'A', { layer: 'Bottom' })],
                      vias: [{ id: 'v1', x: 5, y: 0, size: 0.6, drill: 0.3, from: 'Top', to: 'Bottom', net: 'A' }] });
  assert.strictEqual(N.naoRoteadas(via).conexoes, 0);
  via.vias[0].x = 6;    /* via fora da ponta da trilha do Top (borda a 0,3; ponta a 0,15) */
  assert.strictEqual(N.naoRoteadas(Object.assign({}, via)).conexoes, 1);
});

t('passante com pilha de baixo menor: a forma de baixo vale na Bottom', () => {
  const p = th('p1', 0, 0, 'A', { w: 3, h: 3, bot: { w: 1, h: 1, shape: 'circle' } });
  const B = placa({ nets: ['A'], freepads: [p, pad('p2', 5, 0, 'A', { layer: 'Bottom' })],
                    tracks: [trk('t1', 1.2, 0, 5, 0, 'A', { layer: 'Bottom' })] });   /* toca o anel de 3, nao o de 1 */
  assert.strictEqual(N.naoRoteadas(B).conexoes, 1);
  B.tracks[0].layer = 'Top';
  B.freepads[1].layer = 'Top';
  assert.strictEqual(N.naoRoteadas(Object.assign({}, B)).conexoes, 0);
});

t('region e fill de cobre ligam; furo da region nao; poly:true conta; keepout nao e cobre', () => {
  const reg = { id: 'g1', layer: 'Top', net: 'A', poly: true, points: [[-1, -1], [11, -1], [11, 1], [-1, 1]] };
  const B = placa({ nets: ['A'], freepads: [pad('p1', 0, 0, 'A'), pad('p2', 10, 0, 'A')], regions: [reg] });
  assert.strictEqual(N.naoRoteadas(B).conexoes, 0);
  const furo = Object.assign({}, reg, { holes: [[[8, -2], [12, -2], [12, 2], [8, 2]]] });
  assert.strictEqual(N.naoRoteadas(placa({ nets: ['A'], freepads: B.freepads, regions: [furo] })).conexoes, 1);
  const ko = Object.assign({}, reg, { keepout: true });
  assert.strictEqual(N.naoRoteadas(placa({ nets: ['A'], freepads: B.freepads, regions: [ko] })).conexoes, 1);
  const fill = { id: 'f1', layer: 'Top', net: 'A', x1: -0.2, y1: -0.2, x2: 10.2, y2: 0.2, rot: 0 };
  assert.strictEqual(N.naoRoteadas(placa({ nets: ['A'], freepads: B.freepads, fills: [fill] })).conexoes, 0);
});

t('arco liga pelas pontas e pelo corpo', () => {
  const B = placa({ nets: ['A'], freepads: [pad('p1', 5, 0, 'A'), pad('p2', 0, 5, 'A')],
                    arcs: [{ id: 'a1', layer: 'Top', cx: 0, cy: 0, r: 5, sa: 0, ea: 90, w: 0.3, net: 'A' }] });
  assert.strictEqual(N.naoRoteadas(B).conexoes, 0);
});

t('arvore minima "Shortest": 4 ilhas em linha -> 3 linhas entre vizinhos', () => {
  const B = placa({ nets: ['A'], freepads: [pad('p1', 0, 0, 'A'), pad('p2', 30, 0, 'A'), pad('p3', 10, 0, 'A'), pad('p4', 20, 0, 'A')] });
  const L = N.conexoes(B).linhas;
  assert.strictEqual(L.length, 3);
  for (const l of L) assert.ok(near(Math.hypot(l.x2 - l.x1, l.y2 - l.y1), 10));
});

t('o ponto mais perto entre ilhas: trilha comprida chega perto do pad de longe', () => {
  const B = placa({ nets: ['A'], freepads: [pad('p1', 0, 0, 'A'), pad('p2', 20, 3, 'A')], tracks: [trk('t1', 0, 0, 18, 0, 'A')] });
  const l = N.conexoes(B).linhas[0];
  assert.deepStrictEqual([l.de.id, l.para.id].sort(), ['p2', 't1']);
  assert.ok(near(Math.hypot(l.x2 - l.x1, l.y2 - l.y1), Math.hypot(2, 3)));
});

t('curto: nets diferentes se tocando; e cobre sem net encostando em duas nets', () => {
  const B = placa({ nets: ['A', 'B'], freepads: [pad('p1', 0, 0, 'A'), pad('p2', 5, 0, 'B')], tracks: [trk('t1', 0, 0, 5, 0, 'A')] });
  const c = N.curtos(B);
  assert.strictEqual(c.length, 1);
  assert.deepStrictEqual([c[0].netA, c[0].netB].sort(), ['A', 'B']);
  const S = placa({ nets: ['A', 'B'], freepads: [pad('p1', 0, 0, 'A'), pad('p2', 5, 0, 'B')], tracks: [trk('t1', 0, 0, 5, 0, '')] });
  const s = N.curtos(S);
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].via.id, 't1');
  /* sem net nao leva net nenhuma: A e B continuam sem ligacao (nao ha ratsnest entre nets) */
  assert.strictEqual(N.naoRoteadas(S).conexoes, 0);
});

t('objetosDaNet e netEm (o Ctrl+clique)', () => {
  const B = placa({ nets: ['A', 'B'], freepads: [pad('p1', 0, 0, 'A'), pad('p2', 5, 0, 'A'), th('p3', 0, 5, 'B')],
                    tracks: [trk('t1', 0, 0, 5, 0, 'A')],
                    vias: [{ id: 'v1', x: 2, y: 0, size: 0.6, drill: 0.3, from: 'Top', to: 'Bottom', net: 'A' }] });
  const o = N.objetosDaNet(B, 'A');
  assert.deepStrictEqual(o.ids.sort(), ['p1', 'p2', 't1', 'v1']);
  assert.deepStrictEqual(o.vias, ['v1']);
  assert.strictEqual(N.netEm(B, 'Top', 2.5, 0.1).id, 't1');
  assert.strictEqual(N.netEm(B, 'Top', 2, 0).id, 'v1');          /* via ganha da trilha */
  assert.strictEqual(N.netEm(B, 'Top', 0.1, 0.1).id, 'p1');      /* pad ganha de tudo */
  assert.strictEqual(N.netEm(B, 'Bottom', 0, 5.5).net, 'B');     /* passante na Bottom */
  assert.strictEqual(N.netEm(B, null, 0, 5.5).net, 'B');
  assert.strictEqual(N.netEm(B, 'Top', 3, 3), null);
});

t('cache: o mesmo eb devolve o mesmo modelo; eb novo recalcula', () => {
  const B = placa({ nets: ['A'], freepads: [pad('p1', 0, 0, 'A'), pad('p2', 5, 0, 'A')] });
  assert.strictEqual(N.analisa(B), N.analisa(B));
  const B2 = Object.assign({}, B, { tracks: [trk('t1', 0, 0, 5, 0, 'A')] });
  assert.strictEqual(N.naoRoteadas(B2).total, 0);
  assert.strictEqual(N.naoRoteadas(B).total, 1);
});

t('placa efetiva: track_del no motor faz a linha de conexao aparecer', () => {
  const B = placa({ nets: ['A'], freepads: [pad('p1', 0, 0, 'A'), pad('p2', 5, 0, 'A')], tracks: [trk('t1', 0, 0, 5, 0, 'A')] });
  const eb0 = C.effectiveBoard(B, C.applyPcbChanges(B, []));
  assert.strictEqual(N.naoRoteadas(eb0).total, 0);
  const ch = [{ op: 'track_del', id: 't1', orig_x1: 0, orig_y1: 0, orig_x2: 5, orig_y2: 0, orig_w: 0.3, orig_layer: 'Top' }];
  const eb1 = C.effectiveBoard(B, C.applyPcbChanges(B, ch));
  assert.strictEqual(N.naoRoteadas(eb1).total, 1);
});

/* ============================== parte 2: o acervo ============================== */

const dir = path.join(__dirname, '..', 'Projects');
const ms = fn => { const t0 = process.hrtime.bigint(); const r = fn(); return [r, Number(process.hrtime.bigint() - t0) / 1e6]; };
let maior = null;
const linhas = [];
for (const d of (fs.existsSync(dir) ? fs.readdirSync(dir) : [])) {
  const f = path.join(dir, d, 'board.js');
  if (!fs.existsSync(f)) continue;
  const B = loadVar(path.relative(path.join(__dirname, '..'), f), 'pcbmirror');
  const eb = C.effectiveBoard(B, C.applyPcbChanges(B, []));
  N.limpaCache();
  const [R, frio] = ms(() => N.naoRoteadas(eb));
  const eb2 = C.effectiveBoard(B, C.applyPcbChanges(B, []));
  const [, quente] = ms(() => N.naoRoteadas(eb2));
  const nobj = N.analisa(eb2).objs.length;
  assert.ok(Array.isArray(N.curtos(eb2)));
  linhas.push(`  ${d.slice(0, 48).padEnd(48)} ${String(nobj).padStart(5)} obj  ${frio.toFixed(1).padStart(6)} ms frio ${quente.toFixed(1).padStart(6)} ms  incompletas ${R.total}`);
  if (!maior || nobj > maior.nobj) maior = { d, nobj, frio, quente, B };
  ok++;
}
if (maior) {
  /* meta: < 100 ms por recalculo no maior projeto (o recalculo da tela e o "quente") */
  assert.ok(maior.quente < 100, `recalculo do ${maior.d} levou ${maior.quente.toFixed(1)} ms`);
  /* sem trilhas, arcos e vias, a placa roteada vira so linhas de conexao */
  const sem = Object.assign({}, maior.B, { tracks: [], arcs: [], vias: [] });
  const R = N.naoRoteadas(sem);
  assert.ok(R.total > 0 && R.conexoes >= R.total);
  for (const l of N.conexoes(sem).linhas) assert.ok(typeof l.net === 'string' && l.de && l.para);
  ok++;
  console.log(linhas.join('\n'));
  console.log(`  maior: ${maior.d} (${maior.nobj} objetos) em ${maior.quente.toFixed(1)} ms; sem cobre de roteamento: ${R.total} nets, ${R.conexoes} linhas`);
}
console.log(`test-pcbnets: ${ok} ok`);
