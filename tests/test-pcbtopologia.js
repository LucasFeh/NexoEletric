/* O Tab e o arrasto que nao quebra a trilha (hub-pcbtopologia.js), sem navegador.

   Parte 1: placas de brinquedo, uma regra do Altium por bloco.
   Parte 2: o acervo (os board.js de Projects): todo projeto roda, e o Tab 2x de uma trilha nunca
   da menos que o Tab 1x dela. */
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { loadVar } = require('./load.js');
const T = require('../hub-pcbtopologia.js');

let ok = 0;
const t = (nome, fn) => { try { fn(); ok++; } catch (e) { console.error('FALHOU: ' + nome); throw e; } };
const near = (a, b) => Math.abs(a - b) <= 1e-6;
const geoIgual = (g, x1, y1, x2, y2, msg) =>
  assert.ok(g && near(g.x1, x1) && near(g.y1, y1) && near(g.x2, x2) && near(g.y2, y2), msg + ': ' + JSON.stringify(g));
const ord = l => l.map(String).sort();

const trk = (id, x1, y1, x2, y2, o) => Object.assign({ id, layer:'Top', x1, y1, x2, y2, w:0.3, net:'A' }, o || {});
const placa = o => Object.assign({ components:[], freepads:[], tracks:[], arcs:[], vias:[] }, o);
const pad = (id, x, y, o) => Object.assign({ id, name:id, layer:'Top', type:'smd', shape:'rect', x, y, w:1, h:1, rot:0, net:'A' }, o || {});

/* pad p1 (0,0) — t1 — t2 (45°) — t3 — via (15,5) — t4 na Bottom — pad passante (20,5) */
const rota = () => placa({
  freepads:[pad('p1', 0, 0), pad('p2', 20, 5, { layer:'Multi', type:'th', shape:'circle', w:1.6, h:1.6 })],
  tracks:[trk('t1', 0, 0, 5, 0), trk('t2', 5, 0, 10, 5), trk('t3', 10, 5, 15, 5), trk('t4', 15, 5, 20, 5, { layer:'Bottom' })],
  vias:[{ id:'v1', x:15, y:5, size:0.6, drill:0.3, net:'A' }],
});

t('Tab 1x: a trilha inteira ate a via, nos dois sentidos, sem a via', () => {
  const r = T.trilhaAteVia(rota(), { tracks:['t2'] });
  assert.deepStrictEqual(ord(r.tracks), ['t1', 't2', 't3']);
  assert.deepStrictEqual(r.arcs, []);
  assert.strictEqual(r.vias, undefined);
  assert.deepStrictEqual(ord(T.trilhaAteVia(rota(), { tracks:['t4'] }).tracks), ['t4'], 'do outro lado da via, so a Bottom');
});

t('Tab 2x: atravessa a via, para no pad', () => {
  const r = T.tudoLigado(rota(), { tracks:['t2'] });
  assert.deepStrictEqual(ord(r.tracks), ['t1', 't2', 't3', 't4']);
  assert.deepStrictEqual(ord(r.vias), ['v1']);
  const B = rota();
  B.tracks.push(trk('t9', 20, 5, 25, 5, { layer:'Top' }));
  assert.ok(T.tudoLigado(B, { tracks:['t2'] }).tracks.indexOf('t9') < 0, 'alem do pad e outra ligacao');
});

t('arrastar UMA trilha: anda paralela, as vizinhas deslizam e o canto de 45° fica', () => {
  const p = T.planoArrasto(rota(), { tracks:['t2'] }, 0, 1);
  geoIgual(p.mov.track.t2, 4, 0, 9, 5, 't2 paralela, uma unidade acima');
  const viz = Object.fromEntries(p.viz.map(v => [v.id, v.geo]));
  geoIgual(viz.t1, 0, 0, 4, 0, 't1 encolhe pela direcao dela');
  geoIgual(viz.t3, 9, 5, 15, 5, 't3 cresce pela direcao dela');
  assert.deepStrictEqual(p.links, [], 'nada se soltou');
});

t('arrastar a trilha presa na via: a via fica e uma trilha nova segura a ligacao', () => {
  const p = T.planoArrasto(rota(), { tracks:['t3'] }, 0, 1);
  geoIgual(p.mov.track.t3, 11, 6, 15, 6, 't3 na reta nova');
  geoIgual(p.viz.find(v => v.id === 't2').geo, 5, 0, 11, 6, 't2 desliza a 45°');
  assert.strictEqual(p.links.length, 1);
  const l = p.links[0];
  assert.ok(near(l.x1, 15) && near(l.y1, 5) && near(l.x2, 15) && near(l.y2, 6) && l.layer === 'Top' && l.net === 'A' && l.w === 0.3, JSON.stringify(l));
});

t('arrastar o grupo do Tab: anda inteiro, e o que ficou preso no pad e na via ganha trilha nova', () => {
  const p = T.planoArrasto(rota(), { tracks:['t1', 't2', 't3'] }, 0, 1);
  geoIgual(p.mov.track.t1, 0, 1, 5, 1, 't1');
  geoIgual(p.mov.track.t3, 10, 6, 15, 6, 't3');
  assert.deepStrictEqual(p.viz, []);
  assert.strictEqual(p.links.length, 2, 'um no pad, um na via');
});

t('arrastar a via: as trilhas das duas camadas esticam junto', () => {
  const p = T.planoArrasto(rota(), { vias:['v1'] }, 1, 0);
  assert.ok(near(p.mov.via.v1.x, 16) && near(p.mov.via.v1.y, 5));
  const viz = Object.fromEntries(p.viz.map(v => [v.id, v.geo]));
  geoIgual(viz.t3, 10, 5, 16, 5, 't3');
  geoIgual(viz.t4, 16, 5, 20, 5, 't4');
});

t('o T: a ponta no meio do tronco entra no Tab e acompanha o arrasto', () => {
  const B = placa({ tracks:[trk('tA', 0, 0, 10, 0), trk('tB', 5, 0, 5, 5)] });
  assert.deepStrictEqual(ord(T.trilhaAteVia(B, { tracks:['tA'] }).tracks), ['tA', 'tB']);
  assert.deepStrictEqual(ord(T.trilhaAteVia(B, { tracks:['tB'] }).tracks), ['tA', 'tB']);
  const p = T.planoArrasto(B, { tracks:['tA'] }, 0.5, 1);
  geoIgual(p.mov.track.tA, 0.5, 1, 10.5, 1, 'tronco sem vizinha nas pontas: anda inteiro');
  geoIgual(p.viz.find(v => v.id === 'tB').geo, 5, 1, 5, 5, 'o galho desliza pela direcao dele');
});

t('camada diferente nao liga; trilha de componente nao entra', () => {
  const B = placa({ tracks:[trk('t1', 0, 0, 5, 0), trk('t2', 5, 0, 9, 0, { layer:'Bottom' }), trk('t3', 0, 0, 0, 5, { owner:'R1' })] });
  assert.deepStrictEqual(ord(T.trilhaAteVia(B, { tracks:['t1'] }).tracks), ['t1']);
  const p = T.planoArrasto(B, { tracks:['t1'] }, 0, 1);
  assert.deepStrictEqual(p.viz, []);
});

t('vizinha paralela (colinear) nao desliza: estica', () => {
  const B = placa({ tracks:[trk('t1', 0, 0, 5, 0), trk('t2', 5, 0, 10, 0)] });
  const p = T.planoArrasto(B, { tracks:['t2'] }, 0, 1);
  geoIgual(p.mov.track.t2, 5, 1, 10, 1, 't2');
  geoIgual(p.viz.find(v => v.id === 't1').geo, 0, 0, 5, 1, 't1 estica ate a ponta nova');
});

t('arco vizinho: nao estica, ganha a trilha nova', () => {
  const B = placa({ tracks:[trk('t1', 0, 0, 5, 0)], arcs:[{ id:'a1', layer:'Top', cx:5, cy:2, r:2, sa:270, ea:360, w:0.3, net:'A' }] });
  const p = T.planoArrasto(B, { tracks:['t1'] }, 0, -1);
  assert.strictEqual(p.links.length, 1);
  assert.deepStrictEqual(ord(T.trilhaAteVia(B, { tracks:['t1'] }).arcs), ['a1']);
});

/* ============================== parte 2: o acervo ============================== */

const PROJ = path.join(__dirname, '..', 'Projects');
let placas = 0;
for (const nome of fs.existsSync(PROJ) ? fs.readdirSync(PROJ) : []) {
  const f = path.join(PROJ, nome, 'board.js');
  if (!fs.existsSync(f)) continue;
  let B;
  try { B = loadVar(path.relative(path.join(__dirname, '..'), f), 'pcbmirror'); } catch (e) { continue; }
  if (!B || !Array.isArray(B.tracks)) continue;
  placas++;
  const livres = B.tracks.filter(o => o && !o.owner && /^(Top|Bottom|Mid\d+)$/.test(o.layer));
  const amostra = livres.filter((_, i) => i % Math.max(1, Math.floor(livres.length / 15)) === 0).slice(0, 15);
  const t0 = Date.now();
  for (const o of amostra) {
    const a = T.trilhaAteVia(B, { tracks:[o.id] }), b = T.tudoLigado(B, { tracks:[o.id] });
    assert.ok(a.tracks.map(String).includes(String(o.id)), nome + ': o Tab leva a propria trilha');
    for (const id of a.tracks) assert.ok(b.tracks.includes(id), nome + ': Tab 2x contem o Tab 1x (' + id + ')');
    const p = T.planoArrasto(B, { tracks:a.tracks, arcs:a.arcs }, 0.1, 0.1);
    assert.strictEqual(Object.keys(p.mov.track).length, a.tracks.length, nome + ': o grupo anda inteiro');
  }
  assert.ok(Date.now() - t0 < 5000, nome + ': rapido o bastante');
}
assert.ok(placas > 0, 'o acervo tem placas');

console.log('test-pcbtopologia: ' + ok + ' casos + ' + placas + ' placas do acervo, OK');
