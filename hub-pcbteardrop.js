/* AltiumPCBMirror v2 - hub-pcbteardrop.js
   Teardrops como o Altium 21 os faz (Tools >> Teardrops), a partir da placa EFETIVA
   (HubCore.effectiveBoard). Logica pura, sem DOM: navegador (global HubPcbTeardrop, depois do
   hub-pcbnets.js) e node (tests/test-pcbteardrop.js).

   O QUE FOI MEDIDO (14 .PcbDoc do acervo, 3.087 teardrops com a marca do Altium -- o bit 0x10 do
   byte de flags do registro Regions6 -- e os parametros do cabecalho Board6):
   - O teardrop do Altium e uma REGION de cobre da net do pad, na camada da trilha. Em 97% deles e
     um quadrilatero [ponta-, base-, base+, ponta+] (estilo LINHA); os 3% de 6 vertices sao os de
     trilha-com-trilha (T-junction), que este modulo reconhece mas nao refaz.
   - Os parametros sao os mesmos nos 14 projetos (o padrao do AD21, TEARDROPPARAM_* do Board6):
       Via/pad redondo  comprimento 30%, largura 70%  -- do DIAMETRO do pad/via
       pad nao redondo  comprimento 100%, largura 200% -- da LARGURA DA TRILHA
     (o nome no arquivo e PERCENTFORVIAS / PERCENTFORPADS; o pad passante redondo segue a regra da
     via, o retangular/oval segue a do pad -- medido, nao suposto: TH 1,8x1,8 quadrado do LM555 sai
     com a largura da trilha, TH redondo de 2,2 sai com 70% do diametro).
   - Base: os dois pontos onde as retas paralelas a trilha, a +-largura/2, saem do contorno do pad
     (na via, em cima do circulo). Largura limitada ao pad (o lado do pad menos 0,003 mm).
   - Ponta: na borda da trilha (+-w/2), a uma distancia COMPRIMENTO alem do ponto onde a borda da
     trilha sai do pad -- na via 0,7 com trilha 0,254: sqrt(0,35^2 - 0,127^2) + 0,21 = 0,5362, o
     Altium grava 0,5361/0,5362.
   - So existe onde a trilha e mais fina que o teardrop (a base mais larga que a trilha) e a ponta
     da trilha esta dentro do pad.

   O ESPELHO: o board.js (antigo e novo) nao traz a marca de teardrop -- ele chega como uma region
   comum de cobre, sem poly/owner/keepout, com net. reconhece() o identifica pela geometria: 4
   vertices (ou 6, o de trilha), dois deles na borda de uma trilha da mesma net (a +-w/2 da linha
   de centro) e os outros dois em cima do pad/via da mesma net em que a trilha termina. Medido
   contra a marca do Altium nos 14 projetos (veja tests/test-pcbteardrop.js).

   Teardrop ORFAO: o do espelho que nao cabe mais na placa efetiva (a trilha andou, foi apagada ou
   mudou de largura; o pad/via andou) -- o region fica onde estava e faria curto/sujeira no Gerber.

   API
     HubPcbTeardrop.gera(eb, opcoes)   -> [region] os teardrops novos (formato de board.js.regions)
     HubPcbTeardrop.reconhece(eb)      -> [{id, de:{tipo,id}, trilha, layer, net, tipo:'pad'|'trilha'}]
     HubPcbTeardrop.orfaos(eb, base)   -> [id] das regions-teardrop de `base` (o board.js cru; sem
                                          ele, o proprio eb) que nao cabem mais no eb
     HubPcbTeardrop.refaz(eb, base, opcoes) -> { eb (copia rasa com regions trocadas), removidos:[id],
                                          gerados:[region] } -- tira os orfaos e refaz o teardrop do
                                          mesmo par pad/trilha quando ele ainda existe
     HubPcbTeardrop.PADRAO              -> os parametros do Altium 21
   Region gerada: {id:'td:<pad|via>:<trilha>:<camada>', layer, net, points:[[x,y]...], teardrop:true,
                   de:<id do pad/via>, trilha:<id da trilha>} -- o MESMO formato de board.js.regions
                   (points, nao pts), e o que a tela e o hub-gerber ja desenham.

   opcoes de gera(): {estilo:'linha'|'curva', via:{comprimento,largura}, pad:{comprimento,largura},
     vias:true, pads:true, smd:true, th:true, ids:[ids de pad/via] (so esses), trilhas:[ids],
     pula:Set('pad|trilha|camada') (pares que ja tem teardrop), forcar:false (ignora "trilha mais
     fina")}. A curva (o "Curved" do dialogo) e um arco tangente a borda da trilha na ponta, pela
     base -- NAO medida: o acervo inteiro e linha. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hub-pcbnets.js'));
  else root.HubPcbTeardrop = factory(root.HubPcbNets);
})(typeof self !== 'undefined' ? self : this, function (HubPcbNets) {
"use strict";

const N = HubPcbNets, G = N._int;
const PADRAO = Object.freeze({
  estilo: 'linha',
  via: Object.freeze({ comprimento: 30, largura: 70 }),    /* % do diametro (via e pad redondo) */
  pad: Object.freeze({ comprimento: 100, largura: 200 }),  /* % da largura da trilha (os outros) */
});
const EPS_LADO = 0.003;    /* mm: a base fica 3 micros para dentro do lado do pad (medido) */
const TOL_RECONHECE = 0.006;
const PASSOS_CURVA = 8;
const RE_COBRE = /^(Top|Bottom|Mid\d+|Plane\d+)$/;

function isNum(v){ return typeof v === 'number' && isFinite(v); }
const r5 = v => Math.round(v * 1e5) / 1e5;

/* ============================== geometria do pad ============================== */

/* distancia do ponto ao nucleo da forma (0 dentro do poligono) */
function dNucleo(f, x, y){
  if (f.fechado && G.dentroAnel(f.pts, x, y)) return 0;
  const P = f.pts, n = P.length;
  if (n === 1) return Math.hypot(x - P[0][0], y - P[0][1]);
  let d = Infinity;
  const m = f.fechado ? n : n - 1;
  for (let i = 0; i < m; i++) { const a = P[i], b = P[(i + 1) % n]; const q = G.dPS(x, y, a[0], a[1], b[0], b[1]); if (q < d) d = q; }
  return d;
}
const dentro = (f, x, y) => dNucleo(f, x, y) <= f.r + 1e-12;
/* maior u em que E + u.e + v.n ainda esta dentro do pad (a forma e convexa); null se a reta nao
   pega o pad. Ternaria acha o ponto mais fundo da reta, binaria acha a saida. */
function saida(f, E, e, nrm, v){
  const X = u => E[0] + u * e[0] + v * nrm[0], Y = u => E[1] + u * e[1] + v * nrm[1];
  const R = Math.max(f.bb[2] - f.bb[0], f.bb[3] - f.bb[1]) + Math.hypot(f.bb[0] - E[0], f.bb[1] - E[1]) + 1;
  let a = -R, b = R;
  for (let k = 0; k < 80; k++) {
    const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
    if (dNucleo(f, X(m1), Y(m1)) <= dNucleo(f, X(m2), Y(m2))) b = m2; else a = m1;
  }
  let lo = (a + b) / 2;
  if (!dentro(f, X(lo), Y(lo))) return null;
  let hi = R;
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (dentro(f, X(m), Y(m))) lo = m; else hi = m; }
  return lo;
}
/* meia largura do pad na direcao n, medida da linha de centro da trilha (o "suporte") */
function suporte(f, E, nrm, sinal){
  let s = -Infinity;
  for (const p of f.pts) { const q = sinal * ((p[0] - E[0]) * nrm[0] + (p[1] - E[1]) * nrm[1]); if (q > s) s = q; }
  return s + f.r;
}
/* contorno curvo (oval, canto de roundrect): a base nao sobe o arco alem de ANG_BASE graus da
   direcao da trilha -- no acervo ela para num vertice do arco a 45..67,5 graus (o Altium
   poligoniza o arco em passos de 11,25); 56,25 e o do oval 1,8x1,5 do DMB, o caso mais comum.
   Busca binaria em h: o angulo da normal na saida cresce com h. */
const ANG_OVAL = 56.25, ANG_CANTO = 45;   /* oval: 1,8x1,5 do DMB; canto de roundrect: 0,6x1,45 */
function capCurva(f, E, e, nrm, s, h, hw, ANG_BASE){
  if (!(f.r > 1e-6) || !(h > hw)) return h;
  const ang = v => {
    const u = saida(f, E, e, nrm, s * v);
    if (u === null) return 180;
    const x = E[0] + u * e[0] + s * v * nrm[0], y = E[1] + u * e[1] + s * v * nrm[1];
    /* normal = do ponto do nucleo mais perto ate o ponto da saida */
    const q = maisPerto(f, x, y), nx = x - q[0], ny = y - q[1], L = Math.hypot(nx, ny);
    if (L < 1e-9) return 0;
    return Math.acos(Math.max(-1, Math.min(1, (nx * e[0] + ny * e[1]) / L))) * 180 / Math.PI;
  };
  if (ang(h) <= ANG_BASE + 1e-6) return h;
  let lo = hw, hi = h;
  if (ang(lo) > ANG_BASE) return lo;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (ang(m) <= ANG_BASE) lo = m; else hi = m; }
  return lo;
}
/* roundrect de raio menor que meio lado: canto; raio cheio (2,6x0,622 r 0,311 do DMB) e oval */
function cantoVivo(p){
  return String(p.shape || '').toLowerCase() === 'roundrect' && isNum(p.radius) && p.radius < 0.99 * Math.min(p.w, p.h) / 2;
}
function maisPerto(f, x, y){
  const P = f.pts, n = P.length;
  if (n === 1) return P[0];
  let best = null, bd = Infinity;
  const m = f.fechado ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    let t = l2 ? ((x - a[0]) * dx + (y - a[1]) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const q = [a[0] + t * dx, a[1] + t * dy], d = Math.hypot(q[0] - x, q[1] - y);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}
function ehRedondo(p){
  const s = String(p.shape || '').toLowerCase();
  return p._via || ((s === 'circle' || s === 'round') && Math.abs(p.w - p.h) < 1e-6);
}

/* ============================== um teardrop ============================== */

/* pad/via `p` (com forma `f` na camada), trilha `t` com a ponta (ex, ey) dentro do pad e a outra
   em (ox, oy). Devolve os pontos [ponta-, base-, base+, ponta+] ou null. */
function umTeardrop(p, f, t, ex, ey, ox, oy, op){
  const tw = t.w || 0, hw = tw / 2;
  const L0 = Math.hypot(ox - ex, oy - ey);
  if (!(tw > 0) || !(L0 > 1e-6)) return null;
  const e = [(ox - ex) / L0, (oy - ey) / L0], nrm = [-e[1], e[0]], E = [ex, ey];
  const redondo = ehRedondo(p);
  const par = redondo ? op.via : op.pad;
  const D = redondo ? Math.min(p.w, p.h) : tw;
  const comp = D * par.comprimento / 100;
  let hb = D * par.largura / 200;
  const lados = [-1, 1], out = { base: [], ponta: [] }, H = {};
  for (const s of lados) {
    let h = hb;
    if (!redondo) h = capCurva(f, E, e, nrm, s, Math.min(h, suporte(f, E, nrm, s) - EPS_LADO), hw, cantoVivo(p) ? ANG_CANTO : ANG_OVAL);
    H[s] = h;
  }
  /* trilha nao e mais fina que o pad: a base inteira nao e mais larga que a trilha. Um lado so
     pode ficar estreito (trilha chegando perto da quina do pad): o Altium faz o teardrop assim
     mesmo, com a base parada no lado do pad (MIF, 0,7x1 com trilha de 0,5 a 0,3 da borda). */
  if (!(H[-1] + H[1] > tw + 2e-4) && !op.forcar) return null;
  for (const s of lados) {
    const h = H[s];
    if (!(h > 0)) return null;
    const ub = saida(f, E, e, nrm, s * h);
    const ut = saida(f, E, e, nrm, s * hw);
    if (ub === null || ut === null) return null;
    let uT = ut + comp;
    if (uT > L0) uT = L0;                                       /* nao passa da outra ponta da trilha */
    if (uT <= ub + 1e-4) return null;
    out.base.push([ex + ub * e[0] + s * h * nrm[0], ey + ub * e[1] + s * h * nrm[1]]);
    out.ponta.push([ex + uT * e[0] + s * hw * nrm[0], ey + uT * e[1] + s * hw * nrm[1]]);
  }
  const [bm, bp] = out.base, [tm, tp] = out.ponta;
  if (op.estilo === 'curva') return [...lado(tp0(tm), bm, tm, e, -1), ...lado(tp0(tp), bp, tp, e, 1).reverse()];
  return [tm, bm, bp, tp].map(q => [r5(q[0]), r5(q[1])]);
}
function tp0(q){ return q; }
/* curva: arco tangente a borda da trilha na ponta e passando pela base; volta [ponta .. base] */
function lado(tip, base, _t, e, s){
  const du = (base[0] - tip[0]) * e[0] + (base[1] - tip[1]) * e[1];
  const nrm = [-e[1] * s, e[0] * s];
  const dv = (base[0] - tip[0]) * nrm[0] + (base[1] - tip[1]) * nrm[1];
  if (!(dv > 1e-6)) return [tip, base].map(q => [r5(q[0]), r5(q[1])]);
  const rho = (du * du + dv * dv) / (2 * dv);
  const C = [tip[0] + rho * nrm[0], tip[1] + rho * nrm[1]];
  const a0 = Math.atan2(tip[1] - C[1], tip[0] - C[0]), a1 = Math.atan2(base[1] - C[1], base[0] - C[0]);
  let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= PASSOS_CURVA; i++) { const a = a0 + da * i / PASSOS_CURVA; pts.push([r5(C[0] + rho * Math.cos(a)), r5(C[1] + rho * Math.sin(a))]); }
  pts[pts.length - 1] = [r5(base[0]), r5(base[1])];
  return pts;
}

/* ============================== pares pad/via x trilha ============================== */

function opcoesDe(o){
  o = o || {};
  return {
    estilo: o.estilo === 'curva' ? 'curva' : 'linha',
    via: Object.assign({}, PADRAO.via, o.via || {}), pad: Object.assign({}, PADRAO.pad, o.pad || {}),
    vias: o.vias !== false, pads: o.pads !== false, smd: o.smd !== false, th: o.th !== false,
    ids: Array.isArray(o.ids) ? new Set(o.ids) : null, trilhas: Array.isArray(o.trilhas) ? new Set(o.trilhas) : null,
    pula: o.pula instanceof Set ? o.pula : null, forcar: !!o.forcar,
  };
}
/* para cada pad/via e cada trilha da mesma net que TERMINA dentro dele na mesma camada */
function pares(eb, op){
  const A = N.analisa(eb), out = [];
  const trilhasPorCamada = new Map();
  for (const o of A.objs) if (o.tipo === 'track' && o.net) {
    const k = o.formas[0].layer;
    if (!trilhasPorCamada.has(k)) trilhasPorCamada.set(k, []);
    trilhasPorCamada.get(k).push(o);
  }
  for (const o of A.objs) {
    if (o.tipo !== 'pad' && o.tipo !== 'via') continue;
    if (!o.net) continue;
    const p = o.src;
    if (o.tipo === 'via' && !op.vias) continue;
    if (o.tipo === 'pad' && (!op.pads || (p.layer === 'Multi' ? !op.th : !op.smd))) continue;
    if (op.ids && !op.ids.has(o.id)) continue;
    const pad = o.tipo === 'via' ? { _via: true, shape: 'circle', w: p.size, h: p.size, id: p.id } : p;
    for (const fl of o.formas) {
      const T = trilhasPorCamada.get(fl.layer); if (!T) continue;
      const f = fl.f;
      for (const to of T) {
        if (to.net !== o.net) continue;
        const t = to.src;
        if (op.trilhas && !op.trilhas.has(t.id)) continue;
        const tb = to.formas[0].f.bb;
        if (tb[0] > f.bb[2] || tb[2] < f.bb[0] || tb[1] > f.bb[3] || tb[3] < f.bb[1]) continue;
        for (const [ex, ey, ox, oy] of [[t.x1, t.y1, t.x2, t.y2], [t.x2, t.y2, t.x1, t.y1]]) {
          if (!dentro(f, ex, ey)) continue;
          if (dentro(f, ox, oy)) continue;                    /* trilha inteira dentro do pad */
          out.push({ o, pad, f, layer: fl.layer, t, ex, ey, ox, oy });
        }
      }
    }
  }
  return out;
}

function gera(eb, opcoes){
  const op = opcoesDe(opcoes), out = [], visto = new Set();
  for (const q of pares(eb, op)) {
    const chave = q.o.id + '|' + q.t.id + '|' + q.layer;
    if (op.pula && op.pula.has(chave)) continue;
    let id = 'td:' + q.o.id + ':' + q.t.id + ':' + q.layer;
    if (visto.has(id)) id += ':' + (q.ex === q.t.x1 && q.ey === q.t.y1 ? 1 : 2);
    if (visto.has(id)) continue;
    const pts = umTeardrop(q.pad, q.f, q.t, q.ex, q.ey, q.ox, q.oy, op);
    if (!pts) continue;
    visto.add(id);
    out.push({ id, layer: q.layer, net: q.o.net, points: pts, teardrop: true, de: q.o.id, trilha: q.t.id });
  }
  return out;
}

/* ============================== o teardrop do espelho ============================== */

function anel(pts){
  const out = [];
  for (const p of (Array.isArray(pts) ? pts : [])) {
    if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) continue;
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 1e-7 && Math.abs(q[1] - p[1]) < 1e-7) continue;
    out.push(p);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-7 && Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-7) out.pop();
  return out;
}
function candidata(g){
  if (!g || g.poly || g.owner || g.keepout || g.teardrop === false || !RE_COBRE.test(g.layer) || typeof g.net !== 'string' || !g.net) return null;
  if (Array.isArray(g.holes) && g.holes.length) return null;
  const P = anel(g.points);
  return (P.length >= 4 && P.length <= 6) ? P : null;
}
/* a region `g` cabe como teardrop no modelo A? devolve {de, trilha, tipo} ou null */
function encaixa(A, g, P){
  const L = A.G.get(g.layer); if (!L) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of P) { x1 = Math.min(x1, p[0]); x2 = Math.max(x2, p[0]); y1 = Math.min(y1, p[1]); y2 = Math.max(y2, p[1]); }
  const cand = new Set();
  const C = 2;   /* a CELULA do hub-pcbnets */
  for (let i = Math.floor((x1 - 0.01) / C); i <= Math.floor((x2 + 0.01) / C); i++)
    for (let j = Math.floor((y1 - 0.01) / C); j <= Math.floor((y2 + 0.01) / C); j++) {
      const M = L.get(i * 100003 + j); if (M) for (const it of M) if (it.o.net === g.net) cand.add(it);
    }
  const trilhas = [...cand].filter(it => it.o.tipo === 'track'), alvos = [...cand].filter(it => it.o.tipo === 'pad' || it.o.tipo === 'via');
  const naBorda = (t, p) => Math.abs(G.dPS(p[0], p[1], t.x1, t.y1, t.x2, t.y2) - (t.w || 0) / 2) <= TOL_RECONHECE;
  const sobre = (f, p) => dNucleo(f, p[0], p[1]) <= f.r + TOL_RECONHECE;
  if (P.length === 4) {
    for (const it of trilhas) {
      const t = it.o.src;
      const borda = P.map(p => naBorda(t, p));
      if (borda.filter(Boolean).length < 2) continue;
      /* as pontas sao um par vizinho na borda; a base sao os outros dois */
      for (let k = 0; k < 4; k++) {
        const a = k, b = (k + 1) % 4;
        if (!borda[a] || !borda[b]) continue;
        const base = P.filter((_, i) => i !== a && i !== b);
        for (const al of alvos) {
          if (!base.every(p => sobre(al.f, p))) continue;
          /* a trilha tem de terminar dentro do pad/via */
          if (!(dentro(al.f, t.x1, t.y1) || dentro(al.f, t.x2, t.y2))) continue;
          return { de: { tipo: al.o.tipo, id: al.o.id }, trilha: t.id, tipo: 'pad' };
        }
      }
    }
    return null;
  }
  /* 5 ou 6 vertices: trilha com trilha (T-junction / troca de largura): todo vertice em cima de
     uma trilha da net (dentro do cobre dela, com folga) e pelo menos duas trilhas envolvidas */
  const usadas = new Set();
  for (const p of P) {
    let ok = false;
    for (const it of trilhas) {
      const t = it.o.src;
      if (G.dPS(p[0], p[1], t.x1, t.y1, t.x2, t.y2) <= (t.w || 0) / 2 + TOL_RECONHECE) { ok = true; usadas.add(t.id); }
    }
    if (!ok) {
      for (const al of alvos) if (sobre(al.f, p)) { ok = true; usadas.add(al.o.id); }
    }
    if (!ok) return null;
  }
  if (usadas.size < 2) return null;
  return { de: null, trilha: [...usadas][0], tipo: 'trilha', usadas: [...usadas] };
}
function reconhece(eb){
  const A = N.analisa(eb), out = [];
  for (const g of eb.regions || []) {
    const P = candidata(g); if (!P) continue;
    if (g.teardrop === true && g.de) { out.push({ id: g.id, de: { tipo: /^v/.test(g.de) ? 'via' : 'pad', id: g.de }, trilha: g.trilha, layer: g.layer, net: g.net, tipo: 'pad', gerado: true }); continue; }
    const m = encaixa(A, g, P);
    if (m) out.push({ id: g.id, de: m.de, trilha: m.trilha, layer: g.layer, net: g.net, tipo: m.tipo, usadas: m.usadas });
  }
  return out;
}
function orfaos(eb, base){
  const B = base || eb;
  const ja = reconhece(B);
  if (!ja.length) return [];
  const A = N.analisa(eb), porId = new Map((eb.regions || []).map(g => [g.id, g]));
  const out = [];
  for (const r of ja) {
    const g = porId.get(r.id);
    if (!g) continue;                                 /* ja foi apagado */
    const P = candidata(g);
    const m = P && encaixa(A, g, P);
    if (!m) out.push(r.id);
  }
  return out;
}
function refaz(eb, base, opcoes){
  const B = base || eb;
  const ja = reconhece(B);
  const orf = new Set(orfaos(eb, B));
  if (!orf.size) return { eb, removidos: [], gerados: [] };
  /* os pares que perderam o teardrop: refaz so esses (o resto da placa fica como o Altium deixou) */
  const ids = new Set(), trilhas = new Set();
  for (const r of ja) if (orf.has(r.id) && r.tipo === 'pad' && r.de) { ids.add(r.de.id); trilhas.add(r.trilha); }
  const resto = (eb.regions || []).filter(g => !orf.has(g.id));
  const eb1 = Object.assign({}, eb, { regions: resto });
  /* par que ainda tem teardrop valido nao ganha outro */
  const pula = new Set();
  for (const r of reconhece(eb1)) if (r.de) pula.add(r.de.id + '|' + r.trilha + '|' + r.layer);
  const gerados = ids.size ? gera(eb1, Object.assign({}, opcoes || {}, { ids: [...ids], trilhas: [...trilhas], pula })) : [];
  return { eb: Object.assign({}, eb, { regions: resto.concat(gerados) }), removidos: [...orf], gerados };
}

return { gera, reconhece, orfaos, refaz, PADRAO, _int: { umTeardrop, saida, pares, encaixa, candidata } };
});
