/* NexoEletric - hub-posiciona.js — a CHECAGEM DE POSICIONAMENTO (P3 do relato de 2026-10-28, item 22).

   O relato: posicionar a placa de potência levou centenas de comp_move, um por chamada, e nada
   dizia se um componente tinha ido parar em cima de outro ou fora da placa. Este arquivo é a conta;
   o lote é a ferramenta pcb_mover_lote do MCP (uma gravação só para todos os movimentos), e
   pcb_posicao_conferir pergunta a qualquer hora.

   O que se confere, nos componentes pedidos (ou em todos):
     colisao  dois componentes do MESMO lado mais perto que a folga de posicionamento — a
              ComponentClearance das regras (HubPcbRegras: a vencedora do par, como o DRC), ou
              `folga` dada; sobrepostos = distância negativa (a sobreposição, em mm). A forma é a
              caixa do COBRE E DA SERIGRAFIA do componente (os pads e o desenho dele no overlay): a
              c.bbox inteira tem tambem o desenho mecanico/courtyard, maior que a peca -- o IND
              IFDC2525 tem bbox de +-6,15 mm com cobre e serigrafia em +-4, e o conferidor acusava
              colisao com o D3 que nao existia (PCB1). caixa:"componente" volta a c.bbox;
     fora     o componente sai do contorno da placa (algum canto da caixa fora dele, ou dentro de um
              recorte) — pela caixa: do lado seguro.
   comparaLotes(antes, depois) -> o que o lote CRIOU (as colisões e os "fora" que não existiam antes).

   Lógica pura, sem DOM: Node (MCP) e navegador (global HubPosiciona).

   API
     confere(eb, opts) -> {colisoes:[{a, b, lado, dist, folga}], fora:[{ref, lado, cantos}], componentes, ms}
        opts {refs (só os pares que tocam estes), folga (mm), regras (o conjunto ou o resolvedor do
              hub-pcbregras; sem ele e sem folga, 0,254), caixa ('cobre' padrão | 'componente')}
     novas(antes, depois) -> {colisoes, fora}   (os resultados do confere de antes e de depois) */
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubPosiciona = m;
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const FOLGA_PADRAO = 0.254;
const isNum = v => typeof v === 'number' && isFinite(v);
const r4 = v => Math.round(v * 1e4) / 1e4;
const agora = (typeof performance === 'object' && performance && typeof performance.now === 'function') ? () => performance.now() : () => Date.now();

function regrasMod(){
  try { if (typeof HubPcbRegras !== 'undefined' && HubPcbRegras) return HubPcbRegras; } catch (e) { /* sem o global */ }
  try { if (typeof require === 'function') return require('./hub-pcbregras.js'); } catch (e) { /* sem o módulo */ }
  return null;
}

/* o contorno da placa como segmentos (o arco vira cordas) e os recortes como anéis */
function contorno(eb){
  const segs = [];
  for (const s of (eb.board && eb.board.outline) || []) {
    if (!s) continue;
    if (s.kind === 'arc' && [s.cx, s.cy, s.r, s.sa, s.ea].every(isNum)) {
      let sa = s.sa, ea = s.ea;
      while (ea <= sa) ea += 360;
      const n = Math.max(4, Math.ceil((ea - sa) / 10));
      let ant = null;
      for (let i = 0; i <= n; i++) {
        const g = (sa + (ea - sa) * i / n) * Math.PI / 180, p = [s.cx + s.r * Math.cos(g), s.cy + s.r * Math.sin(g)];
        if (ant) segs.push([ant, p]);
        ant = p;
      }
    } else if ([s.x1, s.y1, s.x2, s.y2].every(isNum)) segs.push([[s.x1, s.y1], [s.x2, s.y2]]);
  }
  const bb = eb.board && eb.board.bbox;
  const recortes = [];
  for (const k of eb.cutouts || []) {
    if (!k || !Array.isArray(k.points) || k.points.length < 3 || k.kindn === 1 || k.kindn === -1) continue;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const q of k.points) { x1 = Math.min(x1, q[0]); x2 = Math.max(x2, q[0]); y1 = Math.min(y1, q[1]); y2 = Math.max(y2, q[1]); }
    /* o recorte do tamanho da placa é a própria placa (a regra do HubLaser.boardCutouts) */
    if (bb && x1 <= bb.x1 + 1e-3 && x2 >= bb.x2 - 1e-3 && y1 <= bb.y1 + 1e-3 && y2 >= bb.y2 - 1e-3) continue;
    recortes.push(k.points);
  }
  return { segs, recortes };
}
/* par/ímpar sobre os segmentos (não precisa encadear o contorno) */
function dentroSegs(segs, x, y){
  let c = false;
  for (const [a, b] of segs) if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  return c;
}
function dentroAnel(P, x, y){
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++)
    if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
  return c;
}
/* distância entre duas caixas alinhadas (negativa = sobrepostas, pelo menor dos dois cruzamentos) */
function distCaixas(a, b){
  const dx = Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2), dy = Math.max(a.y1, b.y1) - Math.min(a.y2, b.y2);
  if (dx < 0 && dy < 0) return Math.max(dx, dy);
  if (dx >= 0 && dy >= 0) return Math.hypot(dx, dy);
  return Math.max(dx, dy);
}
const ladoDe = c => c && c.layer === 'Bottom' ? 'Bottom' : 'Top';

/* a caixa do cobre e da serigrafia do componente: os cantos de cada pad (girado) e o desenho dele
   no overlay (eb.silk com owner); sem pad, a c.bbox */
function caixasCobre(eb){
  const silkDe = new Map();
  for (const s of eb.silk || []) if (s && s.owner != null) { const k = String(s.owner); if (!silkDe.has(k)) silkDe.set(k, []); silkDe.get(k).push(s); }
  return c => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const poe = (x, y) => { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; };
    for (const p of c.pads || []) {
      if (!p || !isNum(p.x) || !isNum(p.y)) continue;
      const w = (isNum(p.w) ? p.w : 0) / 2, h = (isNum(p.h) ? p.h : 0) / 2, a = (p.rot || 0) * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
      for (const [u, v] of [[-w, -h], [w, -h], [w, h], [-w, h]]) poe(p.x + u * co - v * si, p.y + u * si + v * co);
    }
    if (x1 === Infinity) return c.bbox;
    for (const s of silkDe.get(String(c.ref)) || []) {
      const m = (isNum(s.w) ? s.w : 0) / 2;
      if ([s.x1, s.y1, s.x2, s.y2].every(isNum)) { poe(s.x1 - m, s.y1 - m); poe(s.x2 + m, s.y2 + m); poe(s.x1 + m, s.y1 + m); poe(s.x2 - m, s.y2 - m); }
      else if ([s.cx, s.cy, s.r].every(isNum)) { poe(s.cx - s.r - m, s.cy - s.r - m); poe(s.cx + s.r + m, s.cy + s.r + m); }
    }
    return { x1, y1, x2, y2 };
  };
}

function confere(eb, opts){
  const t0 = agora(), o = opts || {};
  const so = Array.isArray(o.refs) && o.refs.length ? new Set(o.refs.map(String)) : null;
  const caixaDe = o.caixa === 'componente' ? (c => c.bbox) : caixasCobre(eb);
  const cs = (eb.components || []).filter(c => c && c.ref != null && c.bbox && [c.bbox.x1, c.bbox.y1, c.bbox.x2, c.bbox.y2].every(isNum))
    .map(c => { const b = caixaDe(c); return b === c.bbox ? c : Object.assign({}, c, { bbox: b }); });
  /* a folga do par: a dada, ou a ComponentClearance vencedora (a conta do DRC), ou 10 mil */
  let RES = null;
  if (!isNum(o.folga) && o.regras) {
    const RG = regrasMod();
    if (RG) {
      try { RES = typeof o.regras.regraPara === 'function' ? o.regras : RG.resolvedor(o.regras.rules ? o.regras : RG.normaliza(o.regras), { board: eb }); }
      catch (e) { RES = null; }
    }
  }
  const desc = c => ({ tipo: 'comp', comp: String(c.ref), footprint: c.footprint || '', layer: ladoDe(c), net: '', id: c.id });
  const memo = new Map();
  const folgaPar = (a, b) => {
    if (isNum(o.folga)) return o.folga;
    if (!RES) return FOLGA_PADRAO;
    const k = a.ref < b.ref ? a.ref + '|' + b.ref : b.ref + '|' + a.ref;
    let g = memo.get(k);
    if (g === undefined) {
      let r = null;
      try { r = RES.regraPara('ComponentClearance', desc(a), desc(b)); } catch (e) { r = null; }
      g = r && isNum(r.gap) ? r.gap : 0;
      memo.set(k, g);
    }
    return g;
  };
  const colisoes = [];
  const maxF = isNum(o.folga) ? o.folga : 5;
  /* grade de 5 mm pelas caixas: o par só é medido quando as caixas crescidas se tocam */
  const CEL = 5, G = new Map();
  cs.forEach((c, i) => {
    const b = c.bbox;
    for (let x = Math.floor((b.x1 - maxF) / CEL); x <= Math.floor((b.x2 + maxF) / CEL); x++)
      for (let y = Math.floor((b.y1 - maxF) / CEL); y <= Math.floor((b.y2 + maxF) / CEL); y++) {
        const k = x * 100003 + y; let L = G.get(k); if (!L) G.set(k, L = []); L.push(i);
      }
  });
  const visto = new Set();
  for (const L of G.values()) for (let p = 0; p < L.length; p++) for (let q = p + 1; q < L.length; q++) {
    const i = Math.min(L[p], L[q]), j = Math.max(L[p], L[q]), k = i * 1e6 + j;
    if (visto.has(k)) continue;
    visto.add(k);
    const a = cs[i], b = cs[j];
    if (ladoDe(a) !== ladoDe(b)) continue;
    if (so && !so.has(String(a.ref)) && !so.has(String(b.ref))) continue;
    const g = folgaPar(a, b), d = distCaixas(a.bbox, b.bbox);
    if (d < g - 1e-6) {
      const [x, y] = String(a.ref) < String(b.ref) ? [a, b] : [b, a];
      colisoes.push({ a: String(x.ref), b: String(y.ref), lado: ladoDe(a), dist: r4(d), folga: r4(g), sobrepostos: d < 0 });
    }
  }
  colisoes.sort((x, y) => x.dist - y.dist);
  /* fora da placa */
  const C = contorno(eb), fora = [];
  if (C.segs.length >= 3) for (const c of cs) {
    if (so && !so.has(String(c.ref))) continue;
    const b = c.bbox, cantos = [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]];
    const n = cantos.filter(p => !dentroSegs(C.segs, p[0], p[1]) || C.recortes.some(R => dentroAnel(R, p[0], p[1]))).length;
    /* recorte inteiro debaixo do componente: nenhum canto cai nele, o centro do recorte cai na caixa */
    const sobreRecorte = C.recortes.some(R => { const cx = R.reduce((s, q) => s + q[0], 0) / R.length, cy = R.reduce((s, q) => s + q[1], 0) / R.length; return cx > b.x1 && cx < b.x2 && cy > b.y1 && cy < b.y2; });
    if (n || sobreRecorte) fora.push({ ref: String(c.ref), lado: ladoDe(c), cantos: n, sobreRecorte });
  }
  return { colisoes, fora, componentes: so ? cs.filter(c => so.has(String(c.ref))).length : cs.length, ms: Math.round(agora() - t0) };
}

function novas(antes, depois){
  const ka = new Set((antes.colisoes || []).map(c => c.a + '|' + c.b)), fa = new Set((antes.fora || []).map(f => f.ref));
  return { colisoes: (depois.colisoes || []).filter(c => !ka.has(c.a + '|' + c.b)), fora: (depois.fora || []).filter(f => !fa.has(f.ref)) };
}

return { confere, novas, FOLGA_PADRAO };
});
