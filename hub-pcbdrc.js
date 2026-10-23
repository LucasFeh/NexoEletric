/* AltiumPCBMirror v2 - hub-pcbdrc.js — o DRC (Design Rule Check) do hub, como o do Altium 21.

   Entra a placa EFETIVA (HubCore.effectiveBoard(board, model): as mudanças já assadas, no formato
   do board.js) e o conjunto de regras do hub-pcbregras.js; sai a lista de violações no espírito
   do relatório do Altium ("Clearance Constraint: (0.18mm < 0.254mm) Between Pad U1-3(...) on Top
   Layer And Track (...) on Top Layer"). É o que separa "ajustar uma placa do Altium" de "fazer a
   placa no hub" (L1 do docs/PCB-MIGRACAO.md).

   Lógica pura, sem DOM: navegador (global HubPcbDrc) e Node (tests/test-pcbdrc.js). Depende só do
   HubPcbRegras. Não depende do hub-roteador.js (as contas de distância exatas de lá foram
   COPIADAS para cá — cápsula, arco de verdade, caixa girada, polígono com furo — para o DRC rodar
   com ou sem o roteador carregado), nem do HubPcbNets: a conectividade é a própria (união de
   cobres que se tocam, por net, atravessando camadas pelos pads passantes e vias).

   API
     HubPcbDrc.rodar(eb, regras, opts) -> {
        violacoes: [{regra, tipo, titulo, msg, x, y, layer, ids:[...], valor, limite}],
        porRegra:  [{regra, tipo, titulo, n, cortadas}],   (contadores, na ordem das categorias)
        conferidas:[kind]  (os tipos que esta rodada conferiu), modo, regras (o conjunto usado),
        total, tempoMs, objetos, avisos:[texto] }
       regras  o conjunto (HubPcbRegras.padroes(), .ler(rules.js), .doBoard(board)...); sem ele,
               HubPcbRegras.doBoard(eb)
       opts.ids     [id...] — DRC ONLINE: só as violações que envolvem esses objetos (o que acabou
                    de ser movido/desenhado). Ids de componente ('c3' ou o designator) valem pelos
                    pads dele. A conectividade continua sendo da placa inteira.
       opts.modo    'lote' (o DRC inteiro, padrão) | 'online' (padrão quando há ids): qual lista do
                    "Rules To Check" vale (regras.verificar, medido no PcbDoc: o lote da casa NÃO
                    confere silk nem componente-componente, e o online confere via e componente)
       opts.tipos   [kind...] — só essas checagens (passa por cima do Rules To Check)
       opts.textoGeo  t -> {regioes|tracos,w} (HubGerber.geometriaTexto): a forma dos textos. Sem
                    ela os textos ficam de fora das checagens de silk (aviso)
       opts.max     teto de violações por regra (padrão 1000; o resto só conta)
     HubPcbDrc.relatorioTexto(res, info) / relatorioHtml(res, info)  o "DRC Report" do Altium
     HubPcbDrc.geo                         as contas de distância (para os testes)

   O QUE CADA CHECAGEM FAZ (e onde ela difere do Altium, de propósito ou por falta de dado):
     Clearance        cobre a cobre na mesma camada, entre nets diferentes (NETSCOPE), com a matriz
                      de objetos (OBJECTCLEARANCES) quando a regra traz. Cobre sem net contra cobre
                      sem net NÃO é conferido (logotipo e QR de trilhas soltas se tocam de propósito).
                      Furo de pad NPTH (sem anel de cobre) entra como objeto "Hole" — e esse vale
                      também contra cobre sem net (broca atravessando cobre). KEEPOUT (a camada
                      KeepOut em todo cobre; o objeto keepout:true na camada dele) entra contra o
                      cobre de qualquer net pela regra do par, menos o do próprio componente. São as
                      mesmas leituras do hub-roteador.js, que usa as mesmas regras para contornar
                      (tests/test-roteador-regras.js confere os dois par a par).
     ShortCircuit     cobre de duas nets que se toca ou sobrepõe (as duas com nome).
     UnRoutedNet      a net com pads em mais de um grupo de cobre ligado: uma violação por ligação
                      que falta (a árvore mínima entre os grupos, pelo par de pads mais perto).
     UnConnectedPin   pad que não toca cobre nenhum (só com a regra; ela não vem de fábrica).
     Width            trilha e arco fora de [min, max] da regra vencedora (com a tabela por camada).
     RoutingLayers    trilha numa camada que a regra não permite.
     RoutingVias      diâmetro e furo da via fora da faixa.
     HoleSize         todo furo (pad e via) fora da faixa; slot confere a menor e a maior medida.
     HoleToHoleClearance  borda a borda entre furos.
     MinimumSolderMaskSliver  a ponte de máscara entre duas aberturas do mesmo lado: 0 < folga < mín.
                      Aberturas = pad (forma + expansão: o `sm` do pad ou a regra), via sem tenting
                      (o espelho antigo não traz tenting: via aberta, como o hub-gerber faz) e o que
                      está desenhado na camada de máscara.
     SilkToSolderMaskClearance  serigrafia contra a abertura (ou contra o cobre exposto, como a
                      regra de fábrica pede) do mesmo lado.
     SilkToSilkClearance  entre objetos de serigrafia quando um deles é texto, ou quando são de
                      componentes diferentes (o contorno do próprio footprint não briga com ele mesmo).
     BoardOutlineClearance  cobre fora da placa, cruzando o contorno ou dentro de recorte, ou mais
                      perto da borda que a folga.
     NetAntennae      ponta de trilha/arco com net que não encosta em nada da mesma net.
     ComponentClearance  caixas dos componentes do mesmo lado (sem corpo 3D no espelho: a caixa é a
                      do Altium sem nome/comment — pads, silk e desenho —, mais larga que o corpo).

   Desempenho: índice espacial em grade por camada; as distâncias só são calculadas para pares
   cujas caixas ficam a menos da maior folga. Meta: < 2 s na maior placa do acervo, em Node. */
(function (raiz, fabrica) {
  const m = fabrica(typeof module === 'object' && module.exports ? require('./hub-pcbregras.js') : raiz.HubPcbRegras);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubPcbDrc = m;
})(typeof self !== 'undefined' ? self : this, function (HubPcbRegras) {
"use strict";

const RG = HubPcbRegras;
const EPS = 1e-6;            /* mm: encostar EXATAMENTE na folga vale (a mesma do roteador) */
/* mm: o que fica a menos de 1 µm do limite NÃO é violação. O Altium mede em 1/10000 mil e o
   board.js guarda 5 casas em mm: a trilha a 45° que o Altium pôs exatamente a 0,254 mm sai a
   0,253995 na conta daqui. Medido contra os relatórios .drc do acervo (0 violação no Altium):
   com 1e-6 sobravam 57 falsas "(0.254mm < 0.254mm)" em 6 placas, todas abaixo de 1 µm. */
const TOL = 1e-3;
const TOQUE = 1e-4;          /* mm: dois cobres a menos que isto estão ligados */
const RAD = Math.PI / 180, DOISPI = 2 * Math.PI;
const isNum = v => typeof v === 'number' && isFinite(v);
const agora = (typeof performance === 'object' && performance && typeof performance.now === 'function')
  ? () => performance.now() : () => Date.now();
const RE_COBRE = /^(Top|Bottom|Mid\d+|Plane\d+)$/;
const ehCobre = k => typeof k === 'string' && RE_COBRE.test(k);

/* ============================== geometria exata ==============================
   As mesmas contas do hub-roteador.js (copiadas: o DRC não depende dele estar carregado). */

function cosSen(g){
  let v = (isNum(g) ? g : 0) % 360;
  if (v < 0) v += 360;
  const k = Math.round(v / 90);
  if (Math.abs(v - 90 * k) < 1e-4) {
    const q = k % 4;
    return q === 0 ? [1, 0] : q === 1 ? [0, 1] : q === 2 ? [-1, 0] : [0, -1];
  }
  return [Math.cos(v * RAD), Math.sin(v * RAD)];
}
function dPS(px, py, x1, y1, x2, y2){
  const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
  let t = 0;
  if (L2 > 0) { t = ((px - x1) * dx + (py - y1) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; }
  const qx = x1 + t * dx - px, qy = y1 + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}
function cruzam(ax, ay, bx, by, cx, cy, dx, dy){
  const o1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const o2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  if (!((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0))) return false;
  const o3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const o4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return (o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0);
}
function dSS(ax, ay, bx, by, cx, cy, dx, dy){
  if (cruzam(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  let d = dPS(ax, ay, cx, cy, dx, dy), e = dPS(bx, by, cx, cy, dx, dy);
  if (e < d) d = e;
  e = dPS(cx, cy, ax, ay, bx, by); if (e < d) d = e;
  e = dPS(dx, dy, ax, ay, bx, by); if (e < d) d = e;
  return d;
}
function naVarredura(vx, vy, sa, sw){
  if (sw >= DOISPI) return true;
  let a = (Math.atan2(vy, vx) - sa) % DOISPI;
  if (a < 0) a += DOISPI;
  if (a > DOISPI - 1e-12) a = 0;
  return a <= sw + 1e-12;
}
function dPA(px, py, A){
  const vx = px - A.cx, vy = py - A.cy;
  if (naVarredura(vx, vy, A.sa, A.sw)) return Math.abs(Math.sqrt(vx * vx + vy * vy) - A.R);
  const d1 = Math.hypot(px - A.sx, py - A.sy), d2 = Math.hypot(px - A.ex, py - A.ey);
  return d1 < d2 ? d1 : d2;
}
function dSA(ax, ay, bx, by, A){
  let d = dPA(ax, ay, A), e = dPA(bx, by, A);
  if (e < d) d = e;
  e = dPS(A.sx, A.sy, ax, ay, bx, by); if (e < d) d = e;
  e = dPS(A.ex, A.ey, ax, ay, bx, by); if (e < d) d = e;
  if (d === 0) return 0;
  const cx = A.cx, cy = A.cy, R = A.R, sa = A.sa, sw = A.sw;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  if (L2 > 0) {
    const fx = ax - cx, fy = ay - cy;
    const b = fx * dx + fy * dy, c = fx * fx + fy * fy - R * R, disc = b * b - L2 * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc), t1 = (-b - sq) / L2, t2 = (-b + sq) / L2;
      if (t1 >= 0 && t1 <= 1 && naVarredura(fx + t1 * dx, fy + t1 * dy, sa, sw)) return 0;
      if (t2 >= 0 && t2 <= 1 && naVarredura(fx + t2 * dx, fy + t2 * dy, sa, sw)) return 0;
    }
    const t = -b / L2;
    if (t > 0 && t < 1) {
      const qx = fx + t * dx, qy = fy + t * dy, rq = Math.sqrt(qx * qx + qy * qy);
      if (rq > 0) {
        if (naVarredura(qx, qy, sa, sw)) { e = Math.abs(rq - R); if (e < d) d = e; }
        if (naVarredura(-qx, -qy, sa, sw)) { e = rq + R; if (e < d) d = e; }
      }
    }
  }
  return d;
}
function dAA(a, b){
  let d = dPA(a.sx, a.sy, b);
  let e = dPA(a.ex, a.ey, b); if (e < d) d = e;
  e = dPA(b.sx, b.sy, a); if (e < d) d = e;
  e = dPA(b.ex, b.ey, a); if (e < d) d = e;
  if (d === 0) return 0;
  const ux = b.cx - a.cx, uy = b.cy - a.cy, D = Math.sqrt(ux * ux + uy * uy);
  if (D > 1e-12) {
    const nx = ux / D, ny = uy / D;
    if (D <= a.R + b.R && D >= Math.abs(a.R - b.R)) {
      const k = (a.R * a.R - b.R * b.R + D * D) / (2 * D), h2 = a.R * a.R - k * k, h = h2 > 0 ? Math.sqrt(h2) : 0;
      for (let s = -1; s <= 1; s += 2) {
        const px = k * nx - s * h * ny, py = k * ny + s * h * nx;
        if (naVarredura(px, py, a.sa, a.sw) && naVarredura(px - ux, py - uy, b.sa, b.sw)) return 0;
      }
    }
    for (let s1 = -1; s1 <= 1; s1 += 2) {
      if (!naVarredura(s1 * nx, s1 * ny, a.sa, a.sw)) continue;
      for (let s2 = -1; s2 <= 1; s2 += 2) {
        if (!naVarredura(s2 * nx, s2 * ny, b.sa, b.sw)) continue;
        e = Math.hypot(ux + (s2 * b.R - s1 * a.R) * nx, uy + (s2 * b.R - s1 * a.R) * ny);
        if (e < d) d = e;
      }
    }
  } else {
    /* concêntricos: a diferença dos raios, se as varreduras se olham */
    e = Math.abs(a.R - b.R);
    if (e < d) {
      for (const [x, y] of [[a.sx, a.sy], [a.ex, a.ey]]) if (naVarredura(x - b.cx, y - b.cy, b.sa, b.sw)) { d = e; break; }
      for (const [x, y] of [[b.sx, b.sy], [b.ex, b.ey]]) if (naVarredura(x - a.cx, y - a.cy, a.sa, a.sw)) { d = Math.min(d, e); break; }
    }
  }
  return d;
}

/* anel de polígono com índice de faixas (o do roteador): polígono despejado tem milhares de
   arestas e o "ponto está dentro?" não pode ser linear em todas */
function novoAnel(pts){
  const n = pts.length, xs = new Float64Array(n), ys = new Float64Array(n);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pts[i][0], y = pts[i][1];
    xs[i] = x; ys[i] = y;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const A = { xs, ys, n, x0, y0, x1, y1, nf: 0, fh: 0, fini: null, fidx: null };
  if (n > 24 && y1 > y0) {
    const nf = Math.min(4096, Math.ceil(n / 4)), fh = (y1 - y0) / nf;
    const conta = new Int32Array(nf + 1);
    const faixa = y => { let f = Math.floor((y - y0) / fh); return f < 0 ? 0 : f >= nf ? nf - 1 : f; };
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1, f0 = faixa(Math.min(ys[i], ys[j])), f1 = faixa(Math.max(ys[i], ys[j]));
      for (let f = f0; f <= f1; f++) conta[f + 1]++;
    }
    for (let f = 0; f < nf; f++) conta[f + 1] += conta[f];
    const pos = conta.slice(0, nf), fidx = new Int32Array(conta[nf]);
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1, f0 = faixa(Math.min(ys[i], ys[j])), f1 = faixa(Math.max(ys[i], ys[j]));
      for (let f = f0; f <= f1; f++) fidx[pos[f]++] = i;
    }
    A.nf = nf; A.fh = fh; A.fini = conta; A.fidx = fidx;
  }
  return A;
}
function dentroAnel(A, x, y){
  if (x < A.x0 || x > A.x1 || y < A.y0 || y > A.y1) return false;
  const xs = A.xs, ys = A.ys, n = A.n;
  let dentro = false;
  if (A.fini) {
    let f = Math.floor((y - A.y0) / A.fh);
    if (f < 0) f = 0; else if (f >= A.nf) f = A.nf - 1;
    for (let q = A.fini[f], fim = A.fini[f + 1]; q < fim; q++) {
      const i = A.fidx[q], j = i + 1 === n ? 0 : i + 1, yi = ys[i], yj = ys[j];
      if ((yi > y) !== (yj > y) && x < (xs[j] - xs[i]) * (y - yi) / (yj - yi) + xs[i]) dentro = !dentro;
    }
    return dentro;
  }
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = ys[i], yj = ys[j];
    if ((yi > y) !== (yj > y) && x < (xs[j] - xs[i]) * (y - yi) / (yj - yi) + xs[i]) dentro = !dentro;
  }
  return dentro;
}
function limpaAnel(pts){
  const out = [];
  for (const q of Array.isArray(pts) ? pts : []) {
    if (!Array.isArray(q) || !isNum(q[0]) || !isNum(q[1])) continue;
    const u = out[out.length - 1];
    if (u && Math.abs(u[0] - q[0]) <= 1e-9 && Math.abs(u[1] - q[1]) <= 1e-9) continue;
    out.push([q[0], q[1]]);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) <= 1e-9 && Math.abs(out[0][1] - out[out.length - 1][1]) <= 1e-9) out.pop();
  return out.length >= 3 ? out : null;
}

/* ============================== primitivas ==============================
   Toda forma é um MIOLO inflado de r:
     P  ponto (n=1), segmento (n=2) ou polígono cheio (n>=3), em pts [x0,y0,x1,y1...]
     A  arco (a curva), com sa/sw em radianos
     G  área: anéis escuros e furos (região, polígono despejado, recorte)
   A distância entre duas formas é a dos miolos menos os dois r: negativa = se sobrepõem. */
const K_P = 1, K_A = 2, K_G = 3;
function caixaPts(pts, r){
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
  }
  return [x1 - r, y1 - r, x2 + r, y2 + r];
}
function primP(pts, r){
  r = r > 0 ? r : 0;
  return { k:K_P, pts, n: pts.length / 2, fill: pts.length >= 6, r, bb: caixaPts(pts, r), fx: pts[0], fy: pts[1] };
}
const primSeg = (x1, y1, x2, y2, r) => (Math.abs(x1 - x2) < 1e-12 && Math.abs(y1 - y2) < 1e-12) ? primP([x1, y1], r) : primP([x1, y1, x2, y2], r);
const primPonto = (x, y, r) => primP([x, y], r);
function primArco(cx, cy, R, saG, eaG, r){
  if (![cx, cy, R, saG, eaG].every(isNum) || !(R > 0)) return null;
  const cheio = Math.abs(eaG - saG) >= 359.999;
  const swG = ((eaG - saG) % 360 + 360) % 360;
  const sw = cheio ? DOISPI : swG * RAD;
  const sa = (saG % 360 + 360) % 360 * RAD;
  const cs = cosSen(saG), ce = cheio ? cs : cosSen(eaG);
  const A = { k:K_A, cx, cy, R, sa, sw, sx: cx + R * cs[0], sy: cy + R * cs[1], ex: cx + R * ce[0], ey: cy + R * ce[1],
              r: r > 0 ? r : 0, fill:false };
  let x1 = Math.min(A.sx, A.ex), x2 = Math.max(A.sx, A.ex), y1 = Math.min(A.sy, A.ey), y2 = Math.max(A.sy, A.ey);
  for (let q = 0; q < 4; q++) {
    const vx = q === 0 ? 1 : q === 2 ? -1 : 0, vy = q === 1 ? 1 : q === 3 ? -1 : 0;
    if (naVarredura(vx, vy, sa, sw)) { x1 = Math.min(x1, cx + R * vx); x2 = Math.max(x2, cx + R * vx); y1 = Math.min(y1, cy + R * vy); y2 = Math.max(y2, cy + R * vy); }
  }
  A.bb = [x1 - A.r, y1 - A.r, x2 + A.r, y2 + A.r];
  A.fx = A.sx; A.fy = A.sy;
  return A;
}
/* a caixa girada de cantos redondos: o miolo [-a,a]x[-b,b] girado, inflado de rr */
function primCaixa(cx, cy, hx, hy, rr, rotG){
  if (![cx, cy, hx, hy].every(isNum) || !(hx > 0) || !(hy > 0)) return null;
  rr = Math.max(0, Math.min(isNum(rr) ? rr : 0, hx, hy));
  const a = hx - rr, b = hy - rr, cs = cosSen(rotG), co = cs[0], si = cs[1];
  const P = (x, y) => [cx + x * co - y * si, cy + x * si + y * co];
  if (a < 1e-9 && b < 1e-9) return primPonto(cx, cy, rr);
  if (a < 1e-9) { const p = P(0, -b), q = P(0, b); return primSeg(p[0], p[1], q[0], q[1], rr); }
  if (b < 1e-9) { const p = P(-a, 0), q = P(a, 0); return primSeg(p[0], p[1], q[0], q[1], rr); }
  const v = [P(-a, -b), P(a, -b), P(a, b), P(-a, b)];
  return primP([v[0][0], v[0][1], v[1][0], v[1][1], v[2][0], v[2][1], v[3][0], v[3][1]], rr);
}
function primArea(escuros, furos){
  const E = (escuros || []).map(limpaAnel).filter(Boolean), F = (furos || []).map(limpaAnel).filter(Boolean);
  if (!E.length) return null;
  const G = { k:K_G, aneis: E.map(novoAnel), furos: F.map(novoAnel), r:0, fill:true };
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const A of G.aneis) { x1 = Math.min(x1, A.x0); y1 = Math.min(y1, A.y0); x2 = Math.max(x2, A.x1); y2 = Math.max(y2, A.y1); }
  G.bb = [x1, y1, x2, y2];
  G.fx = E[0][0][0]; G.fy = E[0][0][1];
  G.todos = G.aneis.concat(G.furos);
  G.ne = G.todos.reduce((s, A) => s + A.n, 0);
  return G;
}

function dentroP(p, x, y){
  const t = p.pts, n = p.n;
  if (x < p.bb[0] || x > p.bb[2] || y < p.bb[1] || y > p.bb[3]) return false;
  let d = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = t[2 * i + 1], yj = t[2 * j + 1], xi = t[2 * i], xj = t[2 * j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) d = !d;
  }
  return d;
}
function dentroG(G, x, y){
  if (x < G.bb[0] || x > G.bb[2] || y < G.bb[1] || y > G.bb[3]) return false;
  let esc = false;
  for (const A of G.aneis) if (dentroAnel(A, x, y)) { esc = true; break; }
  if (!esc) return false;
  for (const A of G.furos) if (dentroAnel(A, x, y)) return false;
  return true;
}
const dentro = (p, x, y) => p.k === K_G ? dentroG(p, x, y) : (p.k === K_P && p.fill ? dentroP(p, x, y) : false);
const nArestas = p => p.k === K_G ? p.ne : p.k === K_A ? 1 : (p.n >= 3 ? p.n : 1);
/* as arestas de P ou G; com caixa, só as que chegam perto dela */
function arestas(p, cx, fn){
  if (p.k === K_P) {
    const t = p.pts, n = p.n;
    if (n === 1) return fn(t[0], t[1], t[0], t[1]);
    if (n === 2) return fn(t[0], t[1], t[2], t[3]);
    for (let i = 0, j = n - 1; i < n; j = i++) fn(t[2 * j], t[2 * j + 1], t[2 * i], t[2 * i + 1]);
    return;
  }
  for (const A of p.todos) {
    const xs = A.xs, ys = A.ys, n = A.n;
    if (cx && (A.x1 < cx[0] || A.x0 > cx[2] || A.y1 < cx[1] || A.y0 > cx[3])) continue;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const x1 = xs[j], y1 = ys[j], x2 = xs[i], y2 = ys[i];
      if (cx && ((x1 < cx[0] && x2 < cx[0]) || (x1 > cx[2] && x2 > cx[2]) || (y1 < cx[1] && y2 < cx[1]) || (y1 > cx[3] && y2 > cx[3]))) continue;
      fn(x1, y1, x2, y2);
    }
  }
}
const folgaCaixas = (a, b) => {
  const dx = Math.max(a[0] - b[2], b[0] - a[2], 0), dy = Math.max(a[1] - b[3], b[1] - a[3], 0);
  return Math.sqrt(dx * dx + dy * dy);
};
const cresce = (b, m) => [b[0] - m, b[1] - m, b[2] + m, b[3] + m];

/* a distância entre os MIOLOS (0 se se tocam ou um contém o outro). lim: acima disso a conta
   pode parar (devolve >= lim) — é o que deixa um polígono de 5.000 arestas barato */
function dMiolo(p, q, lim){
  if (p.k === K_A && q.k === K_A) return dAA(p, q);
  if (p.k === K_A) { const t = p; p = q; q = t; }
  if (q.k === K_A) {
    if (p.fill && dentro(p, q.sx, q.sy)) return 0;
    let d = Infinity;
    if (p.k === K_P && p.n === 1) return dPA(p.pts[0], p.pts[1], q);
    arestas(p, cresce([q.bb[0] + q.r, q.bb[1] + q.r, q.bb[2] - q.r, q.bb[3] - q.r], lim), (x1, y1, x2, y2) => {
      const e = dSA(x1, y1, x2, y2, q); if (e < d) d = e;
    });
    return d === Infinity ? lim : d;
  }
  if (p.fill && dentro(p, q.fx, q.fy)) return 0;
  if (q.fill && dentro(q, p.fx, p.fy)) return 0;
  let g = p, s = q;
  if (nArestas(p) < nArestas(q)) { g = q; s = p; }
  const cs = cresce([s.bb[0] + s.r, s.bb[1] + s.r, s.bb[2] - s.r, s.bb[3] - s.r], lim);
  let d = Infinity;
  arestas(g, nArestas(g) > 8 ? cs : null, (ax, ay, bx, by) => {
    arestas(s, null, (cx, cy, dx, dy) => { const e = dSS(ax, ay, bx, by, cx, cy, dx, dy); if (e < d) d = e; });
  });
  return d === Infinity ? lim : d;
}
/* distância de borda a borda entre duas primitivas (negativa = sobrepostas) */
const dPrim = (p, q, lim) => dMiolo(p, q, (isNum(lim) ? lim : 1e9) + p.r + q.r) - p.r - q.r;
/* a menor entre duas listas de primitivas; devolve {d, p, q} (as que deram o mínimo) */
function dListas(A, B, lim){
  let best = isNum(lim) ? lim : Infinity, bp = null, bq = null, achou = false;
  for (const p of A) for (const q of B) {
    if (folgaCaixas(p.bb, q.bb) >= best && achou) continue;
    if (!achou && folgaCaixas(p.bb, q.bb) > best) continue;
    const d = dPrim(p, q, best);
    if (!achou || d < best) { best = d; bp = p; bq = q; achou = true; }
  }
  return achou ? { d: best, p: bp, q: bq } : { d: isNum(lim) ? lim : Infinity, p: null, q: null };
}

/* ============================== as formas do board.js ============================== */

const ehTH = p => p.layer === 'Multi' || (!p.layer && p.type === 'th');
/* a forma do lado (a pilha do pad passante pode ter outra forma embaixo) */
function formaLado(p, bottom){
  if (bottom && ehTH(p)) {
    const b = p.bot && typeof p.bot === 'object' ? p.bot : null;
    if (b) return { shape: b.shape || p.shape, w: isNum(b.w) ? b.w : p.w, h: isNum(b.h) ? b.h : p.h, radius: isNum(b.radius) ? b.radius : p.radius };
  }
  return { shape: p.shape, w: p.w, h: p.h, radius: p.radius };
}
function centroCobre(p){
  if ((isNum(p.hox) && p.hox) || (isNum(p.hoy) && p.hoy)) {
    const c = cosSen(p.rot || 0), hx = p.hox || 0, hy = p.hoy || 0;
    return [p.x + hx * c[0] - hy * c[1], p.y + hx * c[1] + hy * c[0]];
  }
  return [p.x, p.y];
}
/* pad -> primitiva, com expansão e (máscara): cantos vivos crescem vivos, redondos crescem
   redondos — a mesma conta da abertura do hub-gerber (geoPad) */
function primPad(p, bottom, e){
  e = e || 0;
  const f = formaLado(p, bottom), W = f.w, H = f.h;
  if (!(W > 0) || !(H > 0)) return null;
  const c = centroCobre(p), rot = p.rot || 0;
  let s = String(f.shape || 'rect').toLowerCase();
  const mesmo = Math.abs(W - H) < 1e-5;
  if (s === 'circle' || s === 'round') { if (mesmo) return primPonto(c[0], c[1], Math.max(0, W / 2 + e)); s = 'oval'; }
  if (s === 'oval' || s === 'oblong' || s === 'obround') {
    const rr = Math.min(W, H) / 2;
    return primCaixa(c[0], c[1], Math.max(1e-6, W / 2 + e), Math.max(1e-6, H / 2 + e), Math.max(0, rr + e), rot);
  }
  if (s === 'roundrect') {
    const r0 = Math.min(isNum(f.radius) ? f.radius : Math.min(W, H) / 8, Math.min(W, H) / 2);
    return primCaixa(c[0], c[1], Math.max(1e-6, W / 2 + e), Math.max(1e-6, H / 2 + e), Math.max(0, r0 + e), rot);
  }
  if (s === 'octagon' || s === 'octagonal') {
    const X = W + 2 * e, Y = H + 2 * e;
    if (!(X > 0) || !(Y > 0)) return null;
    const k = Math.min(X, Y) / 4, hx = X / 2, hy = Y / 2, cs = cosSen(rot);
    const loc = [[-hx + k, -hy], [hx - k, -hy], [hx, -hy + k], [hx, hy - k], [hx - k, hy], [-hx + k, hy], [-hx, hy - k], [-hx, -hy + k]];
    const pts = [];
    for (const q of loc) pts.push(c[0] + q[0] * cs[0] - q[1] * cs[1], c[1] + q[0] * cs[1] + q[1] * cs[0]);
    return primP(pts, 0);
  }
  return primCaixa(c[0], c[1], W / 2 + e, H / 2 + e, 0, rot);
}
/* o furo do pad (ou da via): círculo, slot ou retângulo, girado pelo pad + holerot */
function primFuro(p){
  const d = p.drill;
  if (!(d > 0) || !isNum(p.x) || !isNum(p.y)) return null;
  const forma = String(p.drillshape || 'circle').toLowerCase(), dw = p.drillw;
  const rot = (isNum(p.rot) ? p.rot : 0) + (isNum(p.holerot) ? p.holerot : 0);
  if ((forma === 'rect' || forma === 'square') && dw > 0) return primCaixa(p.x, p.y, dw / 2, d / 2, 0, rot);
  if ((forma === 'oblong' || forma === 'slot') && dw > 0) return primCaixa(p.x, p.y, dw / 2, d / 2, Math.min(dw, d) / 2, rot);
  return primPonto(p.x, p.y, d / 2);
}
function primsFill(f){
  if (![f.x1, f.y1, f.x2, f.y2].every(isNum)) return [];
  const p = primCaixa((f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2, Math.abs(f.x2 - f.x1) / 2, Math.abs(f.y2 - f.y1) / 2, 0, f.rot || 0);
  return p ? [p] : [];
}
function primsRegiao(g){
  const p = Array.isArray(g.points) ? primArea([g.points], Array.isArray(g.holes) ? g.holes : []) : null;
  return p ? [p] : [];
}
function primsLinha(o){
  if (o.kind === 'arc' || (isNum(o.cx) && isNum(o.r) && !isNum(o.x1))) { const a = primArco(o.cx, o.cy, o.r, o.sa, o.ea, (o.w || 0) / 2); return a ? [a] : []; }
  if (![o.x1, o.y1, o.x2, o.y2].every(isNum)) return [];
  return [primSeg(o.x1, o.y1, o.x2, o.y2, (o.w || 0) / 2)];
}
/* o texto pela geometria do HubGerber (contorno exato ou traços da fonte do hub). O contorno de
   lá pode vir em 0,00001 mm: a escala certa é a que põe o contorno em cima do texto */
function primsTexto(t, textoGeo){
  let g = null;
  try { g = textoGeo(t); } catch (e) { g = null; }
  if (!g) return [];
  const out = [];
  if (Array.isArray(g.regioes) && g.regioes.length) {
    let k = 1, sx = 0, sy = 0, n = 0;
    for (const r of g.regioes) for (const q of (r && r.pts) || []) if (Array.isArray(q) && isNum(q[0]) && isNum(q[1])) { sx += q[0]; sy += q[1]; n++; }
    if (n && isNum(t.x) && isNum(t.y)) {
      const cx = sx / n, cy = sy / n, lim = Math.max(10, 10 * (t.h || 0));
      if (Math.hypot(cx - t.x, cy - t.y) > 1000 && Math.hypot(cx * 1e-5 - t.x, cy * 1e-5 - t.y) < lim) k = 1e-5;
    }
    const E = [], F = [];
    for (const r of g.regioes) { const p = r && Array.isArray(r.pts) ? r.pts.map(q => [q[0] * k, q[1] * k]) : null; if (p) (r.hole ? F : E).push(p); }
    const A = primArea(E, F);
    if (A) out.push(A);
  }
  if (Array.isArray(g.tracos)) {
    const r = (g.w > 0 ? g.w : 0) / 2;
    for (const s of g.tracos) for (let i = 1; i < (s || []).length; i++) out.push(primSeg(s[i - 1][0], s[i - 1][1], s[i][0], s[i][1], r));
  }
  return out;
}
const caixaDe = prims => {
  let b = null;
  for (const p of prims) b = b ? [Math.min(b[0], p.bb[0]), Math.min(b[1], p.bb[1]), Math.max(b[2], p.bb[2]), Math.max(b[3], p.bb[3])] : p.bb.slice();
  return b;
};

/* ============================== o índice espacial ============================== */

/* grade uniforme sobre uma caixa; cada objeto entra nas células que a caixa dele toca */
function novaGrade(bb, n){
  const W = Math.max(1, bb[2] - bb[0]), H = Math.max(1, bb[3] - bb[1]);
  let cs = Math.max(0.5, Math.sqrt(W * H / Math.max(64, n)) * 1.5);
  while ((W / cs) * (H / cs) > 250000) cs *= 1.5;
  const nx = Math.max(1, Math.ceil(W / cs)), ny = Math.max(1, Math.ceil(H / cs));
  return { x0: bb[0], y0: bb[1], cs, nx, ny, cel: new Array(nx * ny), marca: null, stamp: 0 };
}
const cx_ = (G, x) => { const i = Math.floor((x - G.x0) / G.cs); return i < 0 ? 0 : i >= G.nx ? G.nx - 1 : i; };
const cy_ = (G, y) => { const j = Math.floor((y - G.y0) / G.cs); return j < 0 ? 0 : j >= G.ny ? G.ny - 1 : j; };
function gradePoe(G, i, b){
  const a0 = cx_(G, b[0]), a1 = cx_(G, b[2]), b0 = cy_(G, b[1]), b1 = cy_(G, b[3]);
  for (let y = b0; y <= b1; y++) for (let x = a0; x <= a1; x++) { const c = y * G.nx + x; (G.cel[c] || (G.cel[c] = [])).push(i); }
}
/* os vizinhos de b (caixa já crescida pela folga); `fn(j)` uma vez por objeto */
function gradeVizinhos(G, b, nObj, fn){
  if (!G.marca || G.marca.length < nObj) G.marca = new Int32Array(nObj);
  if (++G.stamp >= 0x7fffffff) { G.marca.fill(0); G.stamp = 1; }
  const s = G.stamp, M = G.marca;
  const a0 = cx_(G, b[0]), a1 = cx_(G, b[2]), b0 = cy_(G, b[1]), b1 = cy_(G, b[3]);
  for (let y = b0; y <= b1; y++) for (let x = a0; x <= a1; x++) {
    const L = G.cel[y * G.nx + x];
    if (!L) continue;
    for (let k = 0; k < L.length; k++) { const j = L[k]; if (M[j] !== s) { M[j] = s; fn(j); } }
  }
}
/* todos os pares de objetos (i < j) cujas caixas ficam a menos de `raio` */
function cadaPar(objs, raio, fn, so){
  if (!objs.length) return;
  let bb = null;
  for (const o of objs) bb = bb ? [Math.min(bb[0], o.bb[0]), Math.min(bb[1], o.bb[1]), Math.max(bb[2], o.bb[2]), Math.max(bb[3], o.bb[3])] : o.bb.slice();
  const G = novaGrade(bb, objs.length);
  objs.forEach((o, i) => gradePoe(G, i, o.bb));
  for (let i = 0; i < objs.length; i++) {
    const a = objs[i];
    gradeVizinhos(G, cresce(a.bb, raio), objs.length, j => {
      if (j <= i) return;
      const b = objs[j];
      if (so && !so(a, b)) return;
      if (folgaCaixas(a.bb, b.bb) > raio) return;
      fn(a, b);
    });
  }
}

/* ============================== a placa em objetos ============================== */

const fmtN = v => String(Math.round(v * 1000) / 1000);
const pt = (x, y) => '(' + fmtN(x) + 'mm,' + fmtN(y) + 'mm)';
const nomeCam = k => RG.nomeAltium(k);

/* um objeto do DRC: {id, tipo, mt (o tipo da matriz de folgas), net, layer, prims (o cobre /
   a forma), desc (o descritor da query), nome (como o relatório o chama), dono, ...} */
function descritor(o){
  return { tipo:o.tipo, net:o.net || '', layer:o.layer, comp:o.dono || '', footprint:o.footprint || '', smd:!!o.smd,
           poly:!!o.poly, pad:o.padNome || '', keepout:!!o.keepout, id:o.id };
}
function montaObjetos(eb, opts, avisos){
  const comps = Array.isArray(eb.components) ? eb.components : [];
  const cobre = [], furos = [], silk = [], mascara = [], pads = [];
  const camadas = new Set(['Top', 'Bottom']);
  if (Array.isArray(eb.layers)) for (const l of eb.layers) if (l && ehCobre(l.key)) camadas.add(l.key);
  for (const k of ['tracks', 'arcs', 'fills', 'regions']) for (const o of eb[k] || []) if (o && ehCobre(o.layer)) camadas.add(o.layer);
  const pilha = [...camadas].sort((a, b) => ordemCamada(a) - ordemCamada(b));
  const novo = o => { o.desc = descritor(o); return o; };

  /* pads */
  const poePad = (p, c) => {
    if (!p || !isNum(p.x) || !isNum(p.y)) return;
    const th = ehTH(p), ref = c ? c.ref : '';
    const nome = (ref ? ref + '-' : 'Pad ') + (p.name != null ? p.name : '');
    const base = { id:p.id, tipo:'pad', net:p.net || '', dono:ref, footprint:c ? c.footprint : '', smd:!th, padNome: ref + '-' + (p.name != null ? p.name : ''),
                   nome:'Pad ' + nome + pt(p.x, p.y), x:p.x, y:p.y, pad:p, th, comp:c || null };
    const top = primPad(p, false, 0), bot = th ? primPad(p, true, 0) : null;
    const anel = th ? (top && p.drill > 0 ? (top.k === K_P && top.n === 1 ? top.r > p.drill / 2 + 1e-6 : true) : !!top) : !!top;
    if (th && !anel) {
      /* pad sem anel de cobre (NPTH): o furo é o obstáculo */
      const f = primFuro(p);
      if (f) cobre.push(novo(Object.assign({}, base, { tipo:'hole', mt:'Hole', net:'', layer:'Multi', camadas:pilha, prims:[f], primsBot:[f], bb:f.bb.slice(), smd:false, nome:'Hole ' + pt(p.x, p.y) })));
    } else if (top) {
      const o = novo(Object.assign({}, base, { mt: th ? 'THPad' : 'SMDPad', layer: th ? 'Multi' : p.layer, camadas: th ? pilha : [p.layer],
                                               prims:[top], primsBot:[bot || top] }));
      o.bb = caixaDe([top, bot || top]);
      cobre.push(o);
      pads.push(o);
    }
    if (th && p.drill > 0) { const f = primFuro(p); if (f) furos.push(novo({ id:p.id, tipo:'hole', mt:'Hole', net:p.net || '', layer:'Multi', prims:[f], bb:f.bb.slice(),
                                                                             nome:'Pad ' + nome + pt(p.x, p.y), dono:ref, x:p.x, y:p.y, d:p.drill, dw:p.drillw, pad:p })); }
  };
  for (const c of comps) for (const p of (c && c.pads) || []) poePad(p, c);
  for (const p of eb.freepads || []) poePad(p, null);

  /* vias */
  for (const v of eb.vias || []) {
    if (!v || !isNum(v.x) || !isNum(v.y) || !(v.size > 0)) continue;
    const pr = primPonto(v.x, v.y, v.size / 2), de = v.from || 'Top', ate = v.to || 'Bottom';
    const i0 = pilha.indexOf(de), i1 = pilha.indexOf(ate);
    const cams = (i0 >= 0 && i1 >= 0) ? pilha.slice(Math.min(i0, i1), Math.max(i0, i1) + 1) : pilha;
    const o = novo({ id:v.id, tipo:'via', mt:'Via', net:v.net || '', layer:'Multi', camadas:cams, prims:[pr], primsBot:[pr], bb:pr.bb.slice(),
                     nome:'Via ' + pt(v.x, v.y) + ' from ' + nomeCam(de) + ' to ' + nomeCam(ate), x:v.x, y:v.y, via:v });
    cobre.push(o);
    if (v.drill > 0) { const f = primPonto(v.x, v.y, v.drill / 2); furos.push(novo({ id:v.id, tipo:'hole', mt:'Hole', net:v.net || '', layer:'Multi', prims:[f], bb:f.bb.slice(), nome:o.nome, x:v.x, y:v.y, d:v.drill, via:v })); }
  }

  /* trilhas, arcos, fills e regiões de cobre (keepout não é cobre) */
  const poeCobre = (o, tipo, mt, prims, nome, extra) => {
    if (!prims.length) return;
    cobre.push(novo(Object.assign({ id:o.id, tipo, mt, net:o.net || '', layer:o.layer, camadas:[o.layer], prims, primsBot:prims, bb:caixaDe(prims),
                                    nome, dono:o.owner || '', keepout:!!o.keepout, src:o }, extra || {})));
  };
  for (const t of eb.tracks || []) if (t && ehCobre(t.layer) && !t.keepout)
    poeCobre(t, 'track', 'Track', primsLinha(t), 'Track ' + pt(t.x1, t.y1) + pt(t.x2, t.y2) + ' on ' + nomeCam(t.layer));
  for (const a of eb.arcs || []) if (a && ehCobre(a.layer) && !a.keepout)
    poeCobre(a, 'arc', 'Arc', primsLinha(Object.assign({ kind:'arc' }, a)), 'Arc ' + pt(a.cx, a.cy) + ' on ' + nomeCam(a.layer));
  for (const f of eb.fills || []) if (f && ehCobre(f.layer) && !f.keepout)
    poeCobre(f, 'fill', 'Fill', primsFill(f), 'Fill ' + pt(f.x1, f.y1) + pt(f.x2, f.y2) + ' on ' + nomeCam(f.layer));
  for (const g of eb.regions || []) if (g && ehCobre(g.layer) && !g.keepout)
    poeCobre(g, 'region', g.poly ? 'Poly' : 'Region', primsRegiao(g), (g.poly ? 'Polygon Region' : 'Region') + ' (' + ((g.points || []).length) + ' vertices) on ' + nomeCam(g.layer), { poly:!!g.poly });

  /* KEEPOUT: não é cobre (não liga nada nem dá curto), mas barra o cobre de toda net pela regra de
     Clearance, como no Altium ("... And Track (Keepout) on Keep-Out Layer"). A camada KeepOut barra
     todas as camadas de cobre; o objeto com keepout:true, só a camada dele — a mesma leitura do
     hub-roteador.js, que já o trata como obstáculo */
  const keepouts = [];
  const poeKo = (o, tipo, mt, prims, cams) => {
    if (!prims.length) return;
    const nomeK = o.layer === 'KeepOut' ? 'Keep-Out Layer' : nomeCam(o.layer);
    keepouts.push(novo({ id:o.id, tipo, mt, net:'', layer:o.layer, camadas:cams, prims, primsBot:prims, bb:caixaDe(prims), dono:o.owner || '', keepout:true,
                         nome:(tipo === 'arc' ? 'Arc' : tipo === 'fill' ? 'Fill' : tipo === 'region' ? 'Region' : 'Track') + ' (Keepout) on ' + nomeK }));
  };
  const camsKo = o => o.layer === 'KeepOut' ? pilha : (ehCobre(o.layer) && o.keepout ? [o.layer] : null);
  for (const s of (eb.lines || []).concat(eb.tracks || [], eb.arcs || [])) {
    const cams = s && camsKo(s);
    if (cams) { const arco = s.kind === 'arc' || (isNum(s.cx) && isNum(s.r) && !isNum(s.x1)); poeKo(s, arco ? 'arc' : 'track', arco ? 'Arc' : 'Track', primsLinha(s), cams); }
  }
  for (const f of eb.fills || []) { const cams = f && camsKo(f); if (cams) poeKo(f, 'fill', 'Fill', primsFill(f), cams); }
  for (const g of eb.regions || []) { const cams = g && camsKo(g); if (cams) poeKo(g, 'region', 'Region', primsRegiao(g), cams); }

  /* textos: no cobre e na serigrafia, pela geometria do Gerber */
  const tg = typeof opts.textoGeo === 'function' ? opts.textoGeo : null;
  let semGeo = 0;
  for (const t of eb.texts || []) {
    if (!t || t.hidden) continue;
    const L = t.layer;
    if (!ehCobre(L) && L !== 'TopOverlay' && L !== 'BottomOverlay') continue;
    if (!tg) { semGeo++; continue; }
    const prims = primsTexto(t, tg);
    if (!prims.length) continue;
    const o = novo({ id:t.id, tipo:'text', mt:'Text', net:'', layer:L, camadas:[L], prims, primsBot:prims, bb:caixaDe(prims),
                     nome:'Text "' + String(t.text || '').replace(/\s+/g, ' ').slice(0, 40) + '" ' + pt(t.x, t.y) + ' on ' + nomeCam(L),
                     dono:t.owner || '', texto:true, src:t });
    if (ehCobre(L)) cobre.push(o); else silk.push(o);
  }
  if (semGeo) avisos.push(semGeo + ' texto(s) de serigrafia/cobre sem geometria (passe opts.textoGeo = HubGerber.geometriaTexto): ficaram fora das checagens de silk');

  /* serigrafia: linhas, arcos, fills e regiões das camadas Overlay */
  const ehSilk = L => L === 'TopOverlay' || L === 'BottomOverlay';
  for (const s of eb.silk || []) if (s && ehSilk(s.layer)) {
    const prims = primsLinha(s);
    if (prims.length) silk.push(novo({ id:s.id, tipo: s.kind === 'arc' ? 'arc' : 'track', mt:'Track', net:'', layer:s.layer, prims, bb:caixaDe(prims), dono:s.owner || '',
                                       nome:(s.kind === 'arc' ? 'Arc ' + pt(s.cx, s.cy) : 'Track ' + pt(s.x1, s.y1) + pt(s.x2, s.y2)) + ' on ' + nomeCam(s.layer), src:s }));
  }
  for (const f of eb.fills || []) if (f && ehSilk(f.layer)) { const prims = primsFill(f); if (prims.length) silk.push(novo({ id:f.id, tipo:'fill', mt:'Fill', net:'', layer:f.layer, prims, bb:caixaDe(prims), dono:f.owner || '', nome:'Fill ' + pt(f.x1, f.y1) + pt(f.x2, f.y2) + ' on ' + nomeCam(f.layer) })); }
  for (const g of eb.regions || []) if (g && ehSilk(g.layer)) { const prims = primsRegiao(g); if (prims.length) silk.push(novo({ id:g.id, tipo:'region', mt:'Region', net:'', layer:g.layer, prims, bb:caixaDe(prims), dono:g.owner || '', nome:'Region on ' + nomeCam(g.layer) })); }

  /* o que está desenhado direto na máscara é abertura */
  const lado = L => L === 'TopSolder' ? 'Top' : L === 'BottomSolder' ? 'Bottom' : null;
  const poeMasc = (o, tipo, prims, nome) => { if (prims.length) mascara.push(novo({ id:o.id, tipo, mt:tipo === 'region' ? 'Region' : 'Fill', net:'', layer:lado(o.layer), prims, bb:caixaDe(prims), nome, dono:o.owner || '' })); };
  for (const s of (eb.lines || []).concat(eb.tracks || [])) if (s && lado(s.layer)) poeMasc(s, 'track', primsLinha(s), 'Track on ' + nomeCam(s.layer));
  for (const f of eb.fills || []) if (f && lado(f.layer)) poeMasc(f, 'fill', primsFill(f), 'Fill on ' + nomeCam(f.layer));
  for (const g of eb.regions || []) if (g && lado(g.layer)) poeMasc(g, 'region', primsRegiao(g), 'Region on ' + nomeCam(g.layer));

  return { cobre, furos, silk, mascara, pads, pilha, keepouts };
}
function ordemCamada(k){
  if (k === 'Top') return 0;
  if (k === 'Bottom') return 1000;
  let m = /^Mid(\d+)$/.exec(k); if (m) return +m[1];
  m = /^Plane(\d+)$/.exec(k); if (m) return 100 + +m[1];
  return 2000;
}

/* o contorno em anéis (pontos, para o dentro/fora) e em arestas exatas (para a distância) */
function contornoDaPlaca(eb){
  const segs = ((eb.board && eb.board.outline) || []).filter(Boolean);
  const arestas = [], pontosDe = s => {
    if (s.kind === 'arc') {
      const A = primArco(s.cx, s.cy, s.r, s.sa, s.ea, 0);
      if (!A) return null;
      const n = Math.max(2, Math.ceil(A.sw / (Math.PI / 36))), out = [];
      for (let i = 0; i <= n; i++) { const g = A.sa + A.sw * i / n; out.push([A.cx + A.R * Math.cos(g), A.cy + A.R * Math.sin(g)]); }
      return out;
    }
    if (![s.x1, s.y1, s.x2, s.y2].every(isNum)) return null;
    return [[s.x1, s.y1], [s.x2, s.y2]];
  };
  const pedacos = [];
  for (const s of segs) {
    const p = pontosDe(s);
    if (!p) continue;
    pedacos.push(p);
    if (s.kind === 'arc') arestas.push(primArco(s.cx, s.cy, s.r, s.sa, s.ea, 0));
    else arestas.push(primSeg(s.x1, s.y1, s.x2, s.y2, 0));
  }
  /* encadeia os pedaços em laços (a ordem do board.js já vem encadeada quase sempre; o arco
     pode vir de trás para a frente) */
  const T = 1e-3, perto = (a, b) => Math.abs(a[0] - b[0]) <= T && Math.abs(a[1] - b[1]) <= T;
  const usados = new Array(pedacos.length).fill(false), aneis = [];
  for (let i = 0; i < pedacos.length; i++) {
    if (usados[i]) continue;
    usados[i] = true;
    const anel = pedacos[i].slice();
    let mudou = true;
    while (mudou && !perto(anel[0], anel[anel.length - 1])) {
      mudou = false;
      for (let j = 0; j < pedacos.length; j++) {
        if (usados[j]) continue;
        const p = pedacos[j], fim = anel[anel.length - 1];
        if (perto(p[0], fim)) { anel.push(...p.slice(1)); usados[j] = true; mudou = true; break; }
        if (perto(p[p.length - 1], fim)) { anel.push(...p.slice(0, -1).reverse()); usados[j] = true; mudou = true; break; }
      }
    }
    const L = limpaAnel(anel);
    if (L) aneis.push(novoAnel(L));
  }
  return { aneis, arestas: arestas.filter(Boolean) };
}
const dentroDaPlaca = (C, x, y) => { let c = false; for (const A of C.aneis) if (dentroAnel(A, x, y)) c = !c; return c; };
/* os recortes que são furo (o do tamanho da placa é a forma dela: HubLaser.boardCutouts) */
function recortes(eb){
  const bb = eb.board && eb.board.bbox, out = [];
  for (const k of eb.cutouts || []) {
    if (!k || !Array.isArray(k.points) || k.points.length < 3 || k.kindn === -1 || k.kindn === 1) continue;   /* 1 = recorte de polígono: não é furo */
    const xs = k.points.map(q => q[0]), ys = k.points.map(q => q[1]);
    if (bb && Math.min(...xs) <= bb.x1 + 1e-3 && Math.max(...xs) >= bb.x2 - 1e-3 && Math.min(...ys) <= bb.y1 + 1e-3 && Math.max(...ys) >= bb.y2 - 1e-3) continue;
    const g = primArea([k.points], []);
    if (g) out.push({ id:k.id, prims:[g], bb:g.bb, nome:'Board Cutout ' + pt((g.bb[0] + g.bb[2]) / 2, (g.bb[1] + g.bb[3]) / 2) });
  }
  return out;
}

/* união-busca para a conectividade */
function uniao(n){
  const p = new Int32Array(n);
  for (let i = 0; i < n; i++) p[i] = i;
  const acha = i => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };
  return { acha, une: (a, b) => { a = acha(a); b = acha(b); if (a !== b) p[a] = b; } };
}

/* ============================== o DRC ============================== */

const TITULO = k => (RG.TIPOS[k] && RG.TIPOS[k].titulo) || k;

function rodar(eb, regras, opts){
  const t0 = agora();
  opts = opts || {};
  eb = eb || {};
  const S = regras ? (regras.rules ? regras : RG.normaliza(regras)) : RG.doBoard(eb);
  const RES = RG.resolvedor(S, { board: eb });
  const avisos = [];
  /* o "Rules To Check" do Altium: o DRC inteiro roda o conjunto do lote; com opts.ids (a edição)
     o do online. opts.tipos manda por cima dos dois. */
  const modo = opts.modo || (Array.isArray(opts.ids) && opts.ids.length ? 'online' : 'lote');
  const quer = k => RES.tem(k) && (opts.tipos ? opts.tipos.indexOf(k) >= 0 : RG.verifica(S, k, modo));
  const MAX = isNum(opts.max) ? opts.max : 1000;

  /* o filtro do DRC online: ids de objeto (e de componente, que valem pelos pads dele) */
  let so = null;
  if (Array.isArray(opts.ids) && opts.ids.length) {
    so = new Set(opts.ids.map(String));
    for (const c of eb.components || []) if (c && (so.has(c.id) || so.has(c.ref))) for (const p of c.pads || []) if (p) so.add(p.id);
  }
  const envolve = (...os) => !so || os.some(o => o && so.has(String(o.id)));

  const violacoes = [], porRegra = new Map();
  const vistos = new Map();       /* tipo|idA|idB -> índice: o par na Multi-Layer aparece em toda camada */
  const poe = (r, kind, v) => {
    if (so && !(v.ids || []).some(id => so.has(String(id)))) return;
    const chave = kind + '|' + v.ids.slice().sort().join('|') + (v.chaveExtra || '');
    delete v.chaveExtra;
    if (vistos.has(chave)) {
      const i = vistos.get(chave);
      if (i >= 0 && isNum(v.valor) && isNum(violacoes[i].valor) && v.valor < violacoes[i].valor) Object.assign(violacoes[i], v, { regra: violacoes[i].regra });
      return;
    }
    let c = porRegra.get(r.name + '|' + kind);
    if (!c) { c = { regra:r.name, tipo:kind, titulo:TITULO(kind), n:0, cortadas:0 }; porRegra.set(r.name + '|' + kind, c); }
    c.n++;
    if (c.n > MAX) { c.cortadas++; vistos.set(chave, -1); return; }
    v.regra = r.name; v.tipo = kind; v.titulo = TITULO(kind);
    vistos.set(chave, violacoes.length);
    violacoes.push(v);
  };
  const msgPar = (kind, valor, limite, a, b, sinal) =>
    TITULO(kind) + ': (' + (isNum(valor) ? fmtN(Math.max(valor, -999)) + 'mm' : '?') + ' ' + (sinal || '<') + ' ' + fmtN(limite) + 'mm) Between ' + a.nome + (a.layer === 'Multi' ? ' on Multi-Layer' : '') +
    ' And ' + b.nome + (b.layer === 'Multi' ? ' on Multi-Layer' : '');
  const onde = (p, q, d) => {
    if (!p || !q) return [0, 0];
    const m = Math.max(0, d || 0) / 2 + 1e-3;
    const a = cresce(p.bb, m), b = cresce(q.bb, m);
    const x1 = Math.max(a[0], b[0]), x2 = Math.min(a[2], b[2]), y1 = Math.max(a[1], b[1]), y2 = Math.min(a[3], b[3]);
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  };

  const OB = montaObjetos(eb, opts, avisos);
  const { cobre, furos, silk, mascara, pads, pilha, keepouts } = OB;
  cobre.forEach((o, i) => { o.i = i; });
  const U = uniao(cobre.length);
  const tocou = new Uint8Array(cobre.length);

  /* ---- passe do cobre: folga, curto, conectividade e antena, camada por camada ---- */
  const maxFolga = Math.max(RG.maiorFolga(S, 'Clearance', 'gap'), quer('NetAntennae') ? RG.maiorFolga(S, 'NetAntennae', 'tolerance') : 0) + TOQUE;
  const pontas = new Map();       /* trilha/arco com net -> [ponta0 ligada?, ponta1 ligada?] */
  const ptsPonta = o => {
    const s = o.src;
    if (o.tipo === 'track') return [[s.x1, s.y1], [s.x2, s.y2]];
    if (o.tipo === 'arc') { const A = o.prims[0]; return A.sw >= DOISPI ? [] : [[A.sx, A.sy], [A.ex, A.ey]]; }
    return [];
  };
  if (quer('NetAntennae')) for (const o of cobre) if ((o.tipo === 'track' || o.tipo === 'arc') && o.net && envolve(o)) pontas.set(o, ptsPonta(o).map(() => false));
  const marcaPontas = (a, b, L) => {
    const f = pontas.get(a);
    if (!f) return;
    const r = a.prims[0].r, PB = L === 'Bottom' ? b.primsBot : b.prims;
    const tol = (RES.regraPara('NetAntennae', a.desc) || {}).tolerance || 0;
    ptsPonta(a).forEach((q, k) => {
      if (f[k]) return;
      const P = primPonto(q[0], q[1], r);
      for (const pb of PB) if (dPrim(P, pb, tol + TOQUE) <= tol + TOQUE) { f[k] = true; break; }
    });
  };
  const ckClear = quer('Clearance'), ckCurto = quer('ShortCircuit');
  for (const L of pilha) {
    const objs = cobre.filter(o => o.camadas.indexOf(L) >= 0);
    const prims = o => L === 'Bottom' ? o.primsBot : o.prims;
    cadaPar(objs, maxFolga, (a, b) => {
      /* inclui sem-net com sem-net: só conectividade. O furo NPTH não é cobre: não liga nada, e
         o par com ele vai sempre para a folga */
      const mesma = a.net === b.net && a.mt !== 'Hole' && b.mt !== 'Hole';
      /* dois objetos passantes se conferem em toda camada (a pilha pode mudar a forma); o poe()
         junta as repetições do mesmo par e fica com a pior folga */
      if (mesma) {
        if (folgaCaixas(a.bb, b.bb) > maxFolga) return;
        const r = dListas(prims(a), prims(b), maxFolga);
        if (r.d <= TOQUE) { U.une(a.i, b.i); tocou[a.i] = 1; tocou[b.i] = 1; }
        if (a.net && r.d <= maxFolga) { marcaPontas(a, b, L); marcaPontas(b, a, L); }
        return;
      }
      if (!ckClear && !ckCurto && !quer('UnConnectedPin')) return;
      const rC = ckClear ? RES.regraPara('Clearance', a.desc, b.desc) : null;
      let gap = 0;
      if (rC) {
        if (rC.netscope === 'SameNet') return;
        if (rC.ignorePadToPad && a.tipo === 'pad' && b.tipo === 'pad' && a.dono && a.dono === b.dono) gap = -Infinity;
        else gap = gapMatriz(rC, a.mt, b.mt);
      }
      const precisa = Math.max(gap, TOQUE);
      if (folgaCaixas(a.bb, b.bb) > precisa) return;
      const r = dListas(prims(a), prims(b), precisa + EPS);
      if (r.d <= TOQUE) { tocou[a.i] = 1; tocou[b.i] = 1; }
      if (!envolve(a, b)) return;
      if (r.d <= TOQUE && a.net && b.net && ckCurto) {
        const rS = RES.regraPara('ShortCircuit', a.desc, b.desc);
        if (rS && !rS.allowed) {
          const w = onde(r.p, r.q, 0);
          poe(rS, 'ShortCircuit', { msg:'Short-Circuit Constraint: Between ' + a.nome + ' (' + a.net + ') And ' + b.nome + ' (' + b.net + ')',
                                    x:w[0], y:w[1], layer:L, ids:[a.id, b.id], valor:r.d, limite:0, chaveExtra:'' });
        }
      }
      /* sem net contra sem net: fora da folga — menos o FURO, que não é cobre: trilha solta em
         cima de furo NPTH é broca atravessando cobre, com net ou sem */
      if (!a.net && !b.net && a.mt !== 'Hole' && b.mt !== 'Hole') return;
      if (rC && gap > -Infinity && r.d < gap - TOL) {
        const w = onde(r.p, r.q, r.d);
        poe(rC, 'Clearance', { msg:msgPar('Clearance', r.d, gap, a, b), x:w[0], y:w[1], layer:(a.layer === 'Multi' && b.layer === 'Multi') ? 'Multi' : L,
                               ids:[a.id, b.id], valor:Math.max(r.d, 0), limite:gap });
      }
    });
  }

  /* ---- keepout contra cobre: a Clearance do par (keepout sem net, logo "nets diferentes" de todo
     cobre), com a matriz de objetos. O keepout do próprio componente não briga com o cobre dele
     (o keepout de antena de um módulo fica em volta dos pads do próprio módulo) ---- */
  if (ckClear && keepouts.length) for (const L of pilha) {
    const K = keepouts.filter(k => k.camadas.indexOf(L) >= 0);
    if (!K.length) continue;
    const objs = K.concat(cobre.filter(o => o.camadas.indexOf(L) >= 0));
    const prims = o => L === 'Bottom' ? o.primsBot : o.prims;
    cadaPar(objs, maxFolga, (a, b) => {
      if (!!a.keepout === !!b.keepout) return;
      const ko = a.keepout ? a : b, o = a.keepout ? b : a;
      if (ko.dono && ko.dono === o.dono) return;
      if (!envolve(ko, o)) return;
      const rC = RES.regraPara('Clearance', ko.desc, o.desc);
      if (!rC || rC.netscope === 'SameNet') return;
      const gap = gapMatriz(rC, ko.mt, o.mt);
      if (folgaCaixas(ko.bb, o.bb) > gap + EPS) return;
      const r = dListas(prims(ko), prims(o), gap + EPS);
      if (r.d < gap - TOL || r.d <= TOQUE) {
        const w = onde(r.p, r.q, r.d);
        poe(rC, 'Clearance', { msg:msgPar('Clearance', r.d, gap, o, ko), x:w[0], y:w[1], layer:L, ids:[o.id, ko.id], valor:Math.max(r.d, 0), limite:gap, chaveExtra:'ko' });
      }
    });
  }

  /* ---- antena: ponta que não encosta em nada da mesma net ---- */
  for (const [o, f] of pontas) {
    const q = ptsPonta(o);
    f.forEach((lig, k) => {
      if (lig) return;
      const r = RES.regraPara('NetAntennae', o.desc);
      if (!r) return;
      poe(r, 'NetAntennae', { msg:'Net Antennae: ' + o.nome + ' (' + o.net + ') — ponta solta em ' + pt(q[k][0], q[k][1]),
                              x:q[k][0], y:q[k][1], layer:o.layer, ids:[o.id], valor:null, limite:r.tolerance || 0, chaveExtra:'#' + k });
    });
  }

  /* ---- net não roteada: pads da mesma net em grupos de cobre diferentes ---- */
  if (quer('UnRoutedNet')) {
    const porNet = new Map();
    for (const p of pads) if (p.net) { if (!porNet.has(p.net)) porNet.set(p.net, []); porNet.get(p.net).push(p); }
    for (const [net, L] of porNet) {
      if (L.length < 2) continue;
      if (so && !L.some(p => so.has(String(p.id)))) {
        /* online: só a net de algum objeto que mexeu */
        const tem = cobre.some(o => o.net === net && so.has(String(o.id)));
        if (!tem) continue;
      }
      const r = RES.regraPara('UnRoutedNet', L[0].desc);
      if (!r) continue;
      const grupos = new Map();
      for (const p of L) { const g = U.acha(p.i); if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(p); }
      if (grupos.size < 2) continue;
      /* a árvore mínima entre os grupos (Prim), pelo par de pads mais perto: as linhas que o
         ratsnest do Altium mostraria */
      const G = [...grupos.values()], dentroA = new Uint8Array(G.length);
      dentroA[0] = 1;
      const melhor = G.map(() => ({ d: Infinity, a: null, b: null }));
      const atualiza = gi => {
        for (let j = 0; j < G.length; j++) {
          if (dentroA[j]) continue;
          for (const a of G[gi]) for (const b of G[j]) {
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < melhor[j].d) melhor[j] = { d, a, b };
          }
        }
      };
      atualiza(0);
      for (let k = 1; k < G.length; k++) {
        let jm = -1;
        for (let j = 0; j < G.length; j++) if (!dentroA[j] && (jm < 0 || melhor[j].d < melhor[jm].d)) jm = j;
        const m = melhor[jm];
        dentroA[jm] = 1;
        poe(r, 'UnRoutedNet', { msg:'Un-Routed Net Constraint: Net ' + net + ' Between ' + m.a.nome + ' And ' + m.b.nome,
                                x:(m.a.x + m.b.x) / 2, y:(m.a.y + m.b.y) / 2, layer:'', ids:[m.a.id, m.b.id], valor:m.d, limite:0,
                                x1:m.a.x, y1:m.a.y, x2:m.b.x, y2:m.b.y, net });
        atualiza(jm);
      }
    }
  }

  /* ---- pino sem ligação (só com a regra, que não vem de fábrica) ---- */
  if (quer('UnConnectedPin')) for (const p of pads) {
    if (tocou[p.i] || !envolve(p)) continue;
    const r = RES.regraPara('UnConnectedPin', p.desc);
    if (r) poe(r, 'UnConnectedPin', { msg:'Un-Connected Pin Constraint: ' + p.nome, x:p.x, y:p.y, layer:p.layer, ids:[p.id], valor:null, limite:0 });
  }

  /* ---- largura e camada de roteamento ---- */
  for (const o of cobre) {
    if ((o.tipo !== 'track' && o.tipo !== 'arc') || !envolve(o)) continue;
    const w = o.src.w;
    if (quer('Width') && isNum(w)) {
      const r = RES.regraPara('Width', o.desc);
      if (r) {
        const pc = r.porCamada && r.porCamada[o.layer] || {};
        const mn = isNum(pc.min) ? pc.min : r.min, mx = isNum(pc.max) ? pc.max : r.max;
        const c = [(o.bb[0] + o.bb[2]) / 2, (o.bb[1] + o.bb[3]) / 2];
        if (isNum(mn) && w < mn - TOL) poe(r, 'Width', { msg:'Width Constraint: ' + o.nome + ' (' + (o.net || 'No Net') + ') Actual Width = ' + fmtN(w) + 'mm, Target Width = ' + fmtN(mn) + 'mm (mín.)', x:c[0], y:c[1], layer:o.layer, ids:[o.id], valor:w, limite:mn, chaveExtra:'min' });
        else if (isNum(mx) && w > mx + TOL) poe(r, 'Width', { msg:'Width Constraint: ' + o.nome + ' (' + (o.net || 'No Net') + ') Actual Width = ' + fmtN(w) + 'mm, Target Width = ' + fmtN(mx) + 'mm (máx.)', x:c[0], y:c[1], layer:o.layer, ids:[o.id], valor:w, limite:mx, chaveExtra:'max' });
      }
    }
    if (quer('RoutingLayers')) {
      const r = RES.regraPara('RoutingLayers', o.desc);
      if (r && r.layers && r.layers[o.layer] === false) {
        const c = [(o.bb[0] + o.bb[2]) / 2, (o.bb[1] + o.bb[3]) / 2];
        poe(r, 'RoutingLayers', { msg:'Routing Layers: ' + o.nome + ' — camada ' + nomeCam(o.layer) + ' não permitida', x:c[0], y:c[1], layer:o.layer, ids:[o.id], valor:null, limite:null });
      }
    }
  }

  /* ---- via: diâmetro e furo ---- */
  if (quer('RoutingVias')) for (const o of cobre) {
    if (o.tipo !== 'via' || !envolve(o)) continue;
    const r = RES.regraPara('RoutingVias', o.desc), v = o.via;
    if (!r) continue;
    const fora = (val, mn, mx, rot) => {
      if (isNum(mn) && val < mn - TOL) return [rot + ' ' + fmtN(val) + 'mm < ' + fmtN(mn) + 'mm', mn];
      if (isNum(mx) && val > mx + TOL) return [rot + ' ' + fmtN(val) + 'mm > ' + fmtN(mx) + 'mm', mx];
      return null;
    };
    const a = fora(v.size, r.min, r.max, 'diâmetro'), b = isNum(v.drill) ? fora(v.drill, r.holeMin, r.holeMax, 'furo') : null;
    if (a) poe(r, 'RoutingVias', { msg:'Routing Via Style: ' + o.nome + ' — ' + a[0], x:v.x, y:v.y, layer:'Multi', ids:[o.id], valor:v.size, limite:a[1], chaveExtra:'d' });
    if (b) poe(r, 'RoutingVias', { msg:'Routing Via Style: ' + o.nome + ' — ' + b[0], x:v.x, y:v.y, layer:'Multi', ids:[o.id], valor:v.drill, limite:b[1], chaveExtra:'f' });
  }

  /* ---- tamanho de furo ---- */
  if (quer('HoleSize')) for (const h of furos) {
    if (!envolve(h)) continue;
    const r = RES.regraPara('HoleSize', h.desc);
    if (!r) continue;
    const menor = h.dw > 0 ? Math.min(h.d, h.dw) : h.d, maior = h.dw > 0 ? Math.max(h.d, h.dw) : h.d;
    let mn = r.min, mx = r.max;
    if (r.absolute === false && h.pad) { const t = Math.min(h.pad.w || 0, h.pad.h || 0); mn = t * (r.minPct || 0) / 100; mx = t * (r.maxPct || 100) / 100; }
    if (isNum(mn) && menor < mn - TOL) poe(r, 'HoleSize', { msg:'Hole Size Constraint: (' + fmtN(menor) + 'mm < ' + fmtN(mn) + 'mm) ' + h.nome, x:h.x, y:h.y, layer:'Multi', ids:[h.id], valor:menor, limite:mn });
    else if (isNum(mx) && maior > mx + TOL) poe(r, 'HoleSize', { msg:'Hole Size Constraint: (' + fmtN(maior) + 'mm > ' + fmtN(mx) + 'mm) ' + h.nome, x:h.x, y:h.y, layer:'Multi', ids:[h.id], valor:maior, limite:mx });
  }

  /* ---- furo a furo ---- */
  if (quer('HoleToHoleClearance')) {
    const g = RG.maiorFolga(S, 'HoleToHoleClearance', 'gap') + EPS;
    cadaPar(furos, g, (a, b) => {
      if (a.id === b.id || !envolve(a, b)) return;
      const r = RES.regraPara('HoleToHoleClearance', a.desc, b.desc);
      if (!r) return;
      const d = dListas(a.prims, b.prims, r.gap + EPS);
      if (d.d < r.gap - TOL) {
        const w = onde(d.p, d.q, d.d);
        poe(r, 'HoleToHoleClearance', { msg:msgPar('HoleToHoleClearance', d.d, r.gap, a, b), x:w[0], y:w[1], layer:'Multi', ids:[a.id, b.id], valor:Math.max(0, d.d), limite:r.gap });
      }
    });
  }

  /* ---- máscara: aberturas por lado ---- */
  const querSliver = quer('MinimumSolderMaskSliver'), querSilkMasc = quer('SilkToSolderMaskClearance');
  const aberturas = { Top:[], Bottom:[] };
  if (querSliver || querSilkMasc) {
    for (const o of cobre) {
      if (o.tipo !== 'pad' && o.tipo !== 'via') continue;
      for (const lado of ['Top', 'Bottom']) {
        if (o.tipo === 'pad' && !o.th && o.layer !== lado) continue;
        const src = o.tipo === 'pad' ? o.pad : o.via;
        const rM = RES.regraPara('SolderMaskExpansion', o.desc) || {};
        const tamp = lado === 'Top' ? (src.tentTop !== undefined ? src.tentTop === true : (o.tipo === 'via' && rM.tentTop === true))
                                    : (src.tentBot !== undefined ? src.tentBot === true : (o.tipo === 'via' && rM.tentBottom === true));
        if (tamp) continue;
        const e = isNum(src.sm) ? src.sm : (isNum(rM.expansion) ? rM.expansion : 0);
        const p = o.tipo === 'pad' ? primPad(src, lado === 'Bottom', e) : primPonto(src.x, src.y, Math.max(0, src.size / 2 + e));
        if (!p) continue;
        aberturas[lado].push({ id:o.id, tipo:o.tipo, mt:o.mt, net:o.net, layer:lado, prims:[p], cobre: lado === 'Bottom' ? o.primsBot : o.prims, bb:p.bb.slice(),
                               nome:o.nome, desc:o.desc, dono:o.dono });
      }
    }
    for (const m of mascara) if (m.layer) aberturas[m.layer].push(Object.assign({}, m, { cobre:m.prims }));
  }
  if (querSliver) {
    const g = RG.maiorFolga(S, 'MinimumSolderMaskSliver', 'min') + EPS;
    for (const lado of ['Top', 'Bottom']) cadaPar(aberturas[lado], g, (a, b) => {
      if (!envolve(a, b)) return;
      const r = RES.regraPara('MinimumSolderMaskSliver', a.desc, b.desc);
      if (!r || !(r.min > 0)) return;
      const d = dListas(a.prims, b.prims, r.min + EPS);
      if (d.d > TOQUE && d.d < r.min - TOL) {
        const w = onde(d.p, d.q, d.d);
        poe(r, 'MinimumSolderMaskSliver', { msg:'Minimum Solder Mask Sliver Constraint: (' + fmtN(d.d) + 'mm < ' + fmtN(r.min) + 'mm) Between ' + a.nome + ' And ' + b.nome + ' on ' + nomeCam(lado + 'Solder'),
                                            x:w[0], y:w[1], layer:lado + 'Solder', ids:[a.id, b.id], valor:d.d, limite:r.min, chaveExtra:lado });
      }
    });
  }

  /* ---- silk ---- */
  const silkLado = { Top: silk.filter(s => s.layer === 'TopOverlay'), Bottom: silk.filter(s => s.layer === 'BottomOverlay') };
  if (querSilkMasc) {
    const g = RG.maiorFolga(S, 'SilkToSolderMaskClearance', 'gap') + EPS;
    for (const lado of ['Top', 'Bottom']) {
      const A = aberturas[lado], Sk = silkLado[lado];
      if (!A.length || !Sk.length) continue;
      const tudo = A.map(a => Object.assign({}, a, { _ab:true })).concat(Sk);
      cadaPar(tudo, g, (a, b) => {
        if (!!a._ab === !!b._ab) return;
        const ab = a._ab ? a : b, s = a._ab ? b : a;
        if (!envolve(ab, s)) return;
        const r = RES.regraPara('SilkToSolderMaskClearance', ab.desc, s.desc);
        if (!r) return;
        const alvo = r.exposedCopper ? ab.cobre : ab.prims;
        const d = dListas(alvo, s.prims, r.gap + EPS);
        if (d.d < r.gap - TOL) {
          const w = onde(d.p, d.q, d.d);
          poe(r, 'SilkToSolderMaskClearance', { msg:'Silk To Solder Mask Clearance Constraint: (' + (d.d < 0 ? 'Collision < ' : fmtN(d.d) + 'mm < ') + fmtN(r.gap) + 'mm) Between ' + ab.nome + ' And ' + s.nome,
                                                x:w[0], y:w[1], layer:lado + 'Overlay', ids:[ab.id, s.id], valor:Math.max(0, d.d), limite:r.gap });
        }
      });
    }
  }
  if (quer('SilkToSilkClearance')) {
    const g = RG.maiorFolga(S, 'SilkToSilkClearance', 'gap') + EPS;
    for (const lado of ['Top', 'Bottom']) cadaPar(silkLado[lado], g, (a, b) => {
      if (a.id === b.id) return;
      if (!(a.texto || b.texto) && !(a.dono && b.dono && a.dono !== b.dono)) return;
      if (!envolve(a, b)) return;
      const r = RES.regraPara('SilkToSilkClearance', a.desc, b.desc);
      if (!r) return;
      const d = dListas(a.prims, b.prims, r.gap + EPS);
      if (d.d < r.gap - TOL) {
        const w = onde(d.p, d.q, d.d);
        poe(r, 'SilkToSilkClearance', { msg:'Silk To Silk Clearance Constraint: (' + (d.d < 0 ? 'Collision < ' : fmtN(d.d) + 'mm < ') + fmtN(r.gap) + 'mm) Between ' + a.nome + ' And ' + b.nome,
                                        x:w[0], y:w[1], layer:lado + 'Overlay', ids:[a.id, b.id], valor:Math.max(0, d.d), limite:r.gap });
      }
    });
  }

  /* ---- folga ao contorno da placa e aos recortes ---- */
  if (quer('BoardOutlineClearance')) {
    const C = contornoDaPlaca(eb), K = recortes(eb);
    if (C.aneis.length) {
      for (const o of cobre) {
        if (!envolve(o)) continue;
        const r = RES.regraPara('BoardOutlineClearance', o.desc);
        if (!r) continue;
        const gap = r.gap || 0, P = o.prims;
        const c = [(o.bb[0] + o.bb[2]) / 2, (o.bb[1] + o.bb[3]) / 2];
        const fora = !dentroDaPlaca(C, P[0].fx, P[0].fy);
        let d = dListas(P, C.arestas, gap + EPS);
        if (fora || d.d < gap - TOL) {
          const w = fora ? c : onde(d.p, d.q, d.d);
          poe(r, 'BoardOutlineClearance', { msg:'Board Outline Clearance: (' + (fora ? 'fora da placa' : fmtN(Math.max(0, d.d)) + 'mm < ' + fmtN(gap) + 'mm') + ') ' + o.nome,
                                            x:w[0], y:w[1], layer:o.layer, ids:[o.id], valor:fora ? -1 : Math.max(0, d.d), limite:gap, chaveExtra:'borda' });
          continue;
        }
        for (const k of K) {
          if (folgaCaixas(o.bb, k.bb) > gap + EPS) continue;
          d = dListas(P, k.prims, gap + EPS);
          if (d.d < gap - EPS || d.d <= 0) {
            const w = onde(d.p, d.q, d.d);
            poe(r, 'BoardOutlineClearance', { msg:'Board Outline Clearance: (' + (d.d <= 0 ? 'dentro do recorte' : fmtN(d.d) + 'mm < ' + fmtN(gap) + 'mm') + ') ' + o.nome + ' And ' + k.nome,
                                              x:w[0], y:w[1], layer:o.layer, ids:[o.id, k.id], valor:Math.max(0, d.d), limite:gap });
            break;
          }
        }
      }
    } else avisos.push('placa sem contorno: a folga ao contorno não foi conferida');
  }

  /* ---- componente a componente (caixas do mesmo lado) ---- */
  if (quer('ComponentClearance')) {
    const cs = [];
    for (const c of eb.components || []) {
      const b = c && c.bbox;
      if (!b || ![b.x1, b.y1, b.x2, b.y2].every(isNum)) continue;
      const p = primCaixa((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, Math.abs(b.x2 - b.x1) / 2, Math.abs(b.y2 - b.y1) / 2, 0, 0);
      if (!p) continue;
      cs.push({ id:c.id, ref:c.ref, layer:c.layer, prims:[p], bb:p.bb.slice(), nome:'Component ' + c.ref + '-' + (c.footprint || ''),
                desc:{ tipo:'comp', comp:c.ref, footprint:c.footprint || '', layer:c.layer, net:'', id:c.id } });
    }
    const g = RG.maiorFolga(S, 'ComponentClearance', 'gap') + EPS;
    cadaPar(cs, g, (a, b) => {
      if (a.layer !== b.layer) return;
      if (so && !(so.has(String(a.id)) || so.has(String(a.ref)) || so.has(String(b.id)) || so.has(String(b.ref)))) return;
      const r = RES.regraPara('ComponentClearance', a.desc, b.desc);
      if (!r) return;
      const d = dListas(a.prims, b.prims, r.gap + EPS);
      if (d.d < r.gap - TOL) {
        const w = onde(d.p, d.q, d.d);
        const v = { msg:'Component Clearance Constraint: (' + (d.d < 0 ? 'Collision' : fmtN(d.d) + 'mm') + ' < ' + fmtN(r.gap) + 'mm) Between ' + a.nome + ' And ' + b.nome,
                    x:w[0], y:w[1], layer:a.layer, ids:[a.id, b.id], valor:Math.max(0, d.d), limite:r.gap };
        if (so) so.add(String(a.id));
        poe(r, 'ComponentClearance', v);
      }
    });
  }

  for (const a of RES.avisos) avisos.push(a);
  const ordemK = k => { let n = 0; for (const c of RG.CATEGORIAS) { const i = c.tipos.indexOf(k); if (i >= 0) return n + i; n += 50; } return 999; };
  const lista = [...porRegra.values()].sort((a, b) => ordemK(a.tipo) - ordemK(b.tipo) || (a.regra < b.regra ? -1 : 1));
  return { violacoes, porRegra: lista, total: lista.reduce((s, c) => s + c.n, 0), tempoMs: Math.round(agora() - t0),
           objetos: { cobre: cobre.length, furos: furos.length, silk: silk.length, camadas: pilha }, avisos, regras: S, modo,
           conferidas: Object.keys(RG.TIPOS).filter(k => RG.TIPOS[k].drc && quer(k)) };
}
/* a folga da matriz de objetos para o par (a regra traz só o que difere do geral) */
function gapMatriz(r, ta, tb){
  const M = r.matrix;
  if (M) {
    const k1 = ta + '-' + tb, k2 = tb + '-' + ta;
    if (isNum(M[k1])) return M[k1];
    if (isNum(M[k2])) return M[k2];
  }
  return isNum(r.gap) ? r.gap : 0;
}

/* ============================== o relatório ============================== */

/* o "Design Rule Verification Report" do Altium, em texto */
function relatorioTexto(res, info){
  info = info || {};
  const L = [];
  L.push('Design Rule Verification Report');
  L.push('Date     : ' + (info.data || new Date().toLocaleString('pt-BR')));
  if (info.arquivo) L.push('Filename : ' + info.arquivo);
  L.push('');
  L.push('Warnings : ' + (res.avisos || []).length);
  L.push('Rule Violations : ' + res.total);
  L.push('');
  L.push('Summary');
  L.push('Warnings\tCount');
  for (const a of res.avisos || []) L.push(a + '\t1');
  L.push('Total\t' + (res.avisos || []).length);
  L.push('');
  L.push('Rule Violations\tCount');
  const S = res.regras && res.regras.rules ? res.regras.rules : [];
  const n = new Map(res.porRegra.map(c => [c.regra + '|' + c.tipo, c.n]));
  for (const r of conferidas(res)) L.push(descRegra(r) + '\t' + (n.get(r.name + '|' + r.kind) || 0));
  L.push('Total\t' + res.total);
  L.push('');
  for (const c of res.porRegra) {
    L.push('Rule Violations :' + c.n);
    const rr = S.find(x => x.name === c.regra && x.kind === c.tipo);
    L.push('Processing Rule : ' + (rr ? descRegra(rr) : c.titulo + ' (' + c.regra + ')'));
    for (const v of res.violacoes) if (v.regra === c.regra && v.tipo === c.tipo) L.push('   Violation  ' + v.msg);
    if (c.cortadas) L.push('   ... e mais ' + c.cortadas + ' (teto de violações por regra)');
    L.push('');
  }
  L.push('Tempo do DRC: ' + res.tempoMs + ' ms');
  return L.join('\r\n');
}
/* a linha da regra como o "Processing Rule" do .drc do Altium:
   "Clearance Constraint (Gap=0.254mm) (All),(All)", "Width Constraint (Min=0.254mm) (Max=1mm) (Preferred=0.5mm) (All)" */
function descRegra(r){
  const m = v => isNum(v) ? fmtN(v) + 'mm' : '?';
  const esc = '(' + r.scope1 + ')' + (RG.TIPOS[r.kind] && RG.TIPOS[r.kind].binaria ? ',(' + r.scope2 + ')' : '');
  let at;
  switch (r.kind) {
    case 'Clearance': at = '(Gap=' + m(r.gap) + ')'; break;
    case 'ShortCircuit': at = '(Allowed=' + (r.allowed ? 'Yes' : 'No') + ')'; break;
    case 'UnRoutedNet': return TITULO(r.kind) + ' ( ' + esc + ' )';
    case 'Width': at = '(Min=' + m(r.min) + ') (Max=' + m(r.max) + ') (Preferred=' + m(r.pref) + ')'; break;
    case 'RoutingVias': at = '(Min=' + m(r.min) + ') (Max=' + m(r.max) + ') (Hole Min=' + m(r.holeMin) + ') (Hole Max=' + m(r.holeMax) + ')'; break;
    case 'HoleSize': at = '(Min=' + m(r.min) + ') (Max=' + m(r.max) + ')'; break;
    case 'MinimumSolderMaskSliver': at = '(Gap=' + m(r.min) + ')'; break;
    case 'NetAntennae': at = '(Tolerance=' + m(r.tolerance) + ')'; break;
    case 'SilkToSolderMaskClearance': case 'SilkToSilkClearance': at = '(Clearance=' + m(r.gap) + ')'; break;
    default: at = isNum(r.gap) ? '(Gap=' + m(r.gap) + ')' : '';
  }
  return TITULO(r.kind) + (at ? ' ' + at : '') + ' ' + esc;
}
/* as regras que a rodada conferiu (res.conferidas); resultado antigo sem elas: as habilitadas */
const conferidas = res => {
  const S = res.regras && res.regras.rules ? res.regras.rules : [];
  if (Array.isArray(res.conferidas)) return S.filter(r => r.enabled && res.conferidas.indexOf(r.kind) >= 0);
  return S.filter(r => r.enabled && RG.TIPOS[r.kind] && RG.TIPOS[r.kind].drc);
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
/* o mesmo relatório em HTML autônomo (cores neutras: é arquivo para guardar/imprimir, fora do hub) */
function relatorioHtml(res, info){
  info = info || {};
  const S = res.regras && res.regras.rules ? res.regras.rules : [];
  const n = new Map(res.porRegra.map(c => [c.regra + '|' + c.tipo, c.n]));
  let h = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>DRC Report' + (info.arquivo ? ' - ' + esc(info.arquivo) : '') + '</title>' +
    '<style>body{font:13px/1.45 system-ui,Segoe UI,sans-serif;margin:24px;color:#222}h1{font-size:18px}h2{font-size:14px;margin-top:22px}' +
    'table{border-collapse:collapse;margin:6px 0}td,th{border:1px solid #bbb;padding:3px 8px;text-align:left;vertical-align:top}th{background:#eee}' +
    'td.n{text-align:right;font-variant-numeric:tabular-nums}.z{color:#888}.v{font-family:Consolas,monospace;font-size:12px}</style></head><body>';
  h += '<h1>Design Rule Verification Report</h1><table><tr><th>Data</th><td>' + esc(info.data || new Date().toLocaleString('pt-BR')) + '</td></tr>' +
       (info.arquivo ? '<tr><th>Placa</th><td>' + esc(info.arquivo) + '</td></tr>' : '') +
       '<tr><th>Avisos</th><td class="n">' + (res.avisos || []).length + '</td></tr><tr><th>Violações</th><td class="n">' + res.total + '</td></tr></table>';
  h += '<h2>Resumo por regra</h2><table><tr><th>Regra</th><th>Violações</th></tr>';
  for (const r of conferidas(res)) {
    const k = n.get(r.name + '|' + r.kind) || 0;
    h += '<tr' + (k ? '' : ' class="z"') + '><td>' + esc(descRegra(r)) + '</td><td class="n">' + k + '</td></tr>';
  }
  h += '<tr><th>Total</th><th class="n">' + res.total + '</th></tr></table>';
  if ((res.avisos || []).length) { h += '<h2>Avisos</h2><ul>'; for (const a of res.avisos) h += '<li>' + esc(a) + '</li>'; h += '</ul>'; }
  for (const c of res.porRegra) {
    h += '<h2>' + esc(c.titulo + ' (' + c.regra + ')') + ' — ' + c.n + '</h2><table><tr><th>#</th><th>Violação</th><th>x, y (mm)</th></tr>';
    let i = 0;
    for (const v of res.violacoes) if (v.regra === c.regra && v.tipo === c.tipo)
      h += '<tr><td class="n">' + (++i) + '</td><td class="v">' + esc(v.msg) + '</td><td class="n">' + fmtN(v.x) + ', ' + fmtN(v.y) + '</td></tr>';
    if (c.cortadas) h += '<tr><td></td><td class="z">... e mais ' + c.cortadas + '</td><td></td></tr>';
    h += '</table>';
  }
  h += '<p class="z">Gerado pelo NexoEletric (HubPcbDrc) em ' + res.tempoMs + ' ms.</p></body></html>';
  return h;
}

return {
  rodar, relatorioTexto, relatorioHtml, descRegra,
  geo: { primSeg, primPonto, primArco, primCaixa, primArea, primPad, primFuro, dPrim, dListas, dSS, dSA, dAA, dentro, cadaPar, contornoDaPlaca },
};
});
