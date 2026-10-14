/* Fidelidade do hub-pcbpour contra o despejo do Altium.

     node tools/pour/compara.js <saida-do-pour_extrai.json> [...]

   Para cada placa: monta a placa efetiva (HubCore), tira as regions poly:true do espelho (o
   despejo velho, que nao pode ser obstaculo de si mesmo), despeja todos os poligonos na ordem e
   compara, poligono a poligono, com as regioes que o Altium gravou para ele (Regions6 com o indice
   do poligono): area do Altium, area do hub, XOR (mm² e % da area do Altium) e o tempo. */
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..', '..');
const HubCore = require(path.join(RAIZ, 'hub-core.js'));
const Pour = require(path.join(RAIZ, 'hub-pcbpour.js'));
const C = require(path.join(RAIZ, 'hub-clipper.js'));
const ESC = 1e4;

const paraC = pts => pts.map(p => ({ X: Math.round(p[0] * ESC), Y: Math.round(p[1] * ESC) }));
function conj(regs, pk, hk) {
  const out = [];
  for (const g of regs) {
    const o = paraC(g[pk]); if (C.Clipper.Area(o) < 0) o.reverse(); out.push(o);
    for (const h of g[hk] || []) { const q = paraC(h); if (C.Clipper.Area(q) > 0) q.reverse(); out.push(q); }
  }
  return out;
}
function op(tipo, a, b) {
  const c = new C.Clipper();
  c.AddPaths(a, C.PolyType.ptSubject, true);
  c.AddPaths(b, C.PolyType.ptClip, true);
  const o = new C.Paths();
  c.Execute(tipo, o, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return o;
}
const area = ps => ps.reduce((s, p) => s + C.Clipper.Area(p), 0) / (ESC * ESC);

function compara(arq) {
  const J = JSON.parse(fs.readFileSync(arq, 'utf8'));
  const board = J.board;
  const m = HubCore.applyPcbChanges(board, []);
  const eb = HubCore.effectiveBoard(board, m);
  eb.regions = eb.regions.filter(g => !g.poly);
  eb.polygons = J.polygons;
  const R = Pour.despejaTodos(eb);
  const linhas = [];
  for (const a of J.altium) {
    const pol = J.polygons.find(p => p.id === a.de);
    const r = R.porPoligono[a.de];
    const A = conj(a.regioes, 'pts', 'holes'), H = conj(r.regioes, 'pts', 'holes');
    const aA = area(op(C.ClipType.ctUnion, A, [])), aH = area(op(C.ClipType.ctUnion, H, []));
    const x = area(op(C.ClipType.ctXor, A, H));
    const so = area(op(C.ClipType.ctDifference, H, A)), falta = area(op(C.ClipType.ctDifference, A, H));
    linhas.push({ id: a.de, nome: pol.nome, layer: a.layer, net: a.net, ordem: pol.ordem, aAltium: +aA.toFixed(3), aHub: +aH.toFixed(3),
                  xor: +x.toFixed(3), pct: aA > 0 ? +(100 * x / aA).toFixed(2) : null, sobra: +so.toFixed(3), falta: +falta.toFixed(3),
                  ilhasA: a.regioes.length, ilhasH: r.regioes.length, ms: r.ms });
  }
  return { arq: path.basename(arq), fonte: J.fonte, ms: R.ms, linhas, avisos: R.avisos };
}

if (require.main === module) {
  for (const a of process.argv.slice(2)) {
    try {
      const r = compara(a);
      console.log('== ' + r.arq + '  ' + r.fonte.slice(-90) + '  total ' + r.ms + ' ms');
      for (const l of r.linhas) console.log('  ' + JSON.stringify(l));
      if (r.avisos.length) console.log('  avisos: ' + [...new Set(r.avisos)].join(' | '));
    } catch (e) { console.log('== ' + a + ' ERRO ' + (e.stack || e)); }
  }
}
module.exports = { compara };
