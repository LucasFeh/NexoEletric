/* AltiumPCBMirror v2 - hub-roteador.js — o roteador que CONTORNA, como o Walkaround do Altium.

   O pedido do dono (2026-10-02): "trilha de mesma camada não podem se cruzar, se forem se cruzar
   o software não deixa, e tenta fazer sozinho a curva em um caminho possivel até o outro lado, mas
   sem mexer na trilha que já ta colocada" — e, logo depois: "na vdd elas só se encontram se forem
   trilhas de mesma NET, caso contrario não". Em regra de software:

     - cobre de nets DIFERENTES nunca se encontra na mesma camada: nem cruza, nem fica mais perto
       que a folga da regra;
     - da MESMA net pode encontrar, encostar e cruzar — é ligação; sem net contra sem net também
       não tem folga (o DRC não confere esse par), só o furo NPTH continua obstáculo;
     - com a trilha na mão, se o L direto até o cursor violaria a regra, o motor acha sozinho um
       caminho em volta do obstáculo. Nada que já está na placa se mexe (nada de Push/HugNPush);
     - sem caminho, a trilha para ANTES do obstáculo.

   AS REGRAS SÃO AS DO DRC (2026-10-22, pedido do dono: "as regras precisam ser a mesma, a lógica de
   roteamento também"). Com o conjunto de regras na cena (opts.regras, o rules.js do projeto), cada
   par (o que está na mão, o objeto da placa) tem a folga da Clearance VENCEDORA para ele — escopo,
   prioridade e matriz de objetos, pela mesma conta do hub-pcbdrc.js (HubPcbRegras.folgaEntre) —; o
   contorno e os recortes, a da Board Outline Clearance; a largura e a via da rota, a preferida da
   Width / Routing Via Style da net (o "Rule Preferred" do Altium, presa à faixa da regra quando
   alguém escolhe outro valor); e a camada que a Routing Layers da net não permite não recebe rota.
   tests/test-roteador-regras.js confere roteador x DRC par a par, também nas placas do acervo. Sem
   opts.regras, a folga única de antes (opts.clearance, board.rules.clearance ou 10 mil, a regra de
   95 de 111 projetos da casa).

   Este arquivo é PURO — não conhece tela, mouse nem DOM — e por isso roda em Node
   (tests/test-roteador.js). Quem liga ao mouse e desenha é o pcbframe.js.

   API (contrato de 2026-10-02, regras em 2026-10-22):
     cena(eb, opts)                    a placa efetiva (HubCore.effectiveBoard) pronta para consulta;
                                       opts {regras, clearance, placa:{lacos, recortes}, textoGeo, res}
     netEm(cena, layer, x, y)          a net do cobre que CONTÉM o ponto ('' se nenhum)
     folgaTrilha(cena, layer, seg, o)  seg {x1,y1,x2,y2,w}; o {net, ignora}
     folgaArco(cena, layer, arco, o)   arco {cx,cy,r,sa,ea,w}
     folgaVia(cena, via, o)            via {x,y,size}, em toda camada de cobre
                                       -> {ok, conflitos:[{id, net, tipo, dist, folga(, layer)}]}
                                       `dist` é a FOLGA de cobre a cobre que sobrou, em mm
                                       (negativa = os cobres se sobrepõem); `folga` é a que a regra
                                       pede para o par; conflito é dist < folga. A lista vem da pior
                                       folga para a melhor.
     rota(cena, req)                   o caminho da trilha na mão até o cursor (ver `rota`); sem
                                       req.w, a largura da regra Width da net
     larguraDaRegra(cena, net, layer)  {pref, min, max, regra}  a Width vencedora
     viaDaRegra(cena, net)             {size, drill, ..., regra}  a Routing Via Style vencedora
     limitaLargura(cena, net, layer, w) / limitaVia(cena, net, size, drill)
                                       o valor escolhido preso à faixa da regra ({..., ajustada})
     camadaPermitida(cena, net, layer) a Routing Layers da net deixa?
     motor                             as peças internas (índice, regra, estado do nó, trecho livre,
                                       suavização) para o hub-autoroteador.js montar o roteador de
                                       várias camadas com vias em cima das mesmas contas (2026-10-28)

   AS FOLGAS SÃO EXATAS. Cada obstáculo vira primitivas com distância fechada: cápsula (trilha,
   traço de texto, aresta de região/borda com raio 0), arco de verdade, caixa girada de cantos
   redondos (pad, fill, via) e área (dentro de polígono com furos). Não há amostragem: "encostar
   exatamente na folga" passa (tolerância de 1e-6 mm) e um micro a menos não passa. O arco é a
   curva mesmo, e não cordas com a flecha somada: a distância segmento-arco e arco-arco têm forma
   fechada, e com cordas o arco "encostado exatamente" sairia acusado por até a flecha.

   O A* corre numa grade ANCORADA no ponto de partida (passo `res`), e cada nó tem um de três
   estados: LIVRE (o ponto fica a folga + res·√2/2 de tudo: qualquer passo entre dois livres
   vizinhos é livre, sem testar o passo), BANDA (o ponto em si respeita a folga, mas a margem não;
   o passo que encosta nele é conferido exato) e BLOQUEADO. A banda é o que deixa a rota passar
   num corredor tão estreito quanto a regra permite — sem ela, a margem da grade fecharia saídas
   de pad em passo fino que a geometria exata deixa. A rota final é conferida exata perna a perna.

   Três decisões além do que se vê na tela:
     - o FURO do pad passante também é obstáculo (cobre não passa por cima de furo). No pad
       metalizado ele está dentro do cobre e não muda nada; no NPTH é o obstáculo inteiro;
     - a regra de NÃO PIORAR (a mão começou perto demais de outra net) vale pela distância COM
       SINAL: começou dentro do cobre dela, só pode ir para mais raso. É exata também dentro de
       polígono despejado (ver fundoNaArea);
     - o cursor EM CIMA de outra net (ou encostado nela) não é alvo: a busca mira o lugar livre
       mais perto dele, e a trilha para ali — do lado de onde veio, quando os dois lados empatam. */
"use strict";
const HubRoteador = (function(){

/* ============================== constantes ============================== */

const TOL = 1e-6;            /* mm: encostar EXATAMENTE na folga vale */
const FOLGA_PADRAO = 0.254;  /* 10 mil: a regra de 95 de 111 projetos da casa */
const LARGURA_PADRAO = 0.254;/* trilha sem largura no pedido e sem rules.width */
const RES_MIN = 0.1;         /* mm: o passo da grade do A* numa placa normal */
const MAX_NOS = 2.5e6;       /* nós da grade na caixa da placa; acima disso o passo cresce */
const MARGEM = 2;            /* mm em volta da placa, na grade e no índice */
const BALDE = 1;             /* mm: lado do balde do índice espacial */
const MAX_BALDES = 250000;
const CURVA = 0.35;          /* custo de cada troca de direção, em passos: rota limpa, poucos cantos */
const ORCAMENTO = 80000;     /* nós expandidos por busca */
const RAIO_ALVO = 3;         /* mm: cursor dentro do proibido -> mira o lugar livre mais perto dele */
const EPS_ANG = 1e-6;        /* mm: "é reto" e "é o mesmo ponto", a mesma tolerância do HubFio */
const EPS_PT = 1e-9;         /* mm: ponto repetido de verdade (ruído de float) */
const SQ2 = Math.SQRT2, DOISPI = 2 * Math.PI, RAD = Math.PI / 180;

/* tipos de primitiva e o que cada uma guarda em `geo` (G números por primitiva):
     SEG    cápsula       x1 y1 x2 y2 r
     ARCO   arco grosso   cx cy R sa sw r sx sy ex ey   (sa e sw em radianos; sw = 2π é círculo)
     CAIXA  caixa girada  cx cy a b rr cos sin          (a,b = meia-largura do miolo, rr = raio
                                                         do canto: a caixa é o miolo inflado de rr)
     AREA   dentro de     índice no `areas` da camada   (as arestas vão à parte, como SEG de raio 0) */
const K_SEG = 1, K_ARCO = 2, K_CAIXA = 3, K_AREA = 4;
const G = 10;
/* estado de um nó da grade */
const LIVRE = 1, BANDA = 2, BLOQ = 3;
/* as 8 direções: 0 = +X e anti-horário; ímpar = diagonal */
const DI = [1, 1, 0, -1, -1, -1, 0, 1], DJ = [0, 1, 1, 1, 0, -1, -1, -1];
const SEM_DIR = 8;

const isNum = v => typeof v === 'number' && isFinite(v);
const RE_COBRE = /^(Top|Bottom|Mid\d+|Plane\d+)$/;
const ehCobre = k => typeof k === 'string' && RE_COBRE.test(k);
const agora = (typeof performance === 'object' && performance && typeof performance.now === 'function')
  ? () => performance.now() : () => Date.now();

/* cosseno e seno com os múltiplos de 90 exatos — o 6e-17 do Math.cos(90°) tiraria do lugar o
   "encostar exatamente". A mesma conta (e a mesma tolerância) do hub-gerber.js. */
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

/* ============================== geometria exata ============================== */

/* ponto -> segmento */
function dPS(px, py, x1, y1, x2, y2){
  const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
  let t = 0;
  if (L2 > 0) { t = ((px - x1) * dx + (py - y1) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; }
  const qx = x1 + t * dx - px, qy = y1 + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}
/* os dois segmentos se cruzam de verdade (cada um troca de lado do outro)? O toque e o colinear
   saem com distância zero nas contas de ponta a segmento, e por isso não precisam estar aqui */
function cruzam(ax, ay, bx, by, cx, cy, dx, dy){
  const o1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const o2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  if (!((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0))) return false;
  const o3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const o4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return (o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0);
}
/* segmento -> segmento: zero se cruzam, senão a menor das quatro ponta-a-segmento */
function dSS(ax, ay, bx, by, cx, cy, dx, dy){
  if (cruzam(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  let d = dPS(ax, ay, cx, cy, dx, dy), e = dPS(bx, by, cx, cy, dx, dy);
  if (e < d) d = e;
  e = dPS(cx, cy, ax, ay, bx, by); if (e < d) d = e;
  e = dPS(dx, dy, ax, ay, bx, by); if (e < d) d = e;
  return d;
}
/* a direção (vx,vy) cai na varredura sa..sa+sw (radianos, anti-horário)? */
function naVarredura(vx, vy, sa, sw){
  if (sw >= DOISPI) return true;
  let a = (Math.atan2(vy, vx) - sa) % DOISPI;
  if (a < 0) a += DOISPI;
  if (a > DOISPI - 1e-12) a = 0;
  return a <= sw + 1e-12;
}
/* ponto -> arco (a curva, sem a largura). Com a direção dentro da varredura, o ponto mais perto
   do círculo inteiro é do arco; fora dela a distância só cresce até as pontas, e a menor é a de
   uma das pontas. */
function dPA(px, py, cx, cy, R, sa, sw, sx, sy, ex, ey){
  const vx = px - cx, vy = py - cy;
  if (naVarredura(vx, vy, sa, sw)) return Math.abs(Math.sqrt(vx * vx + vy * vy) - R);
  const d1 = Math.hypot(px - sx, py - sy), d2 = Math.hypot(px - ex, py - ey);
  return d1 < d2 ? d1 : d2;
}
/* segmento -> arco, exata. Os candidatos a par mais perto: as pontas de cada um contra o outro;
   o cruzamento da reta com o círculo dentro da varredura (zero); e o pé da perpendicular do centro
   na reta, com o ponto do círculo na mesma direção (o único par de interiores em que a linha que
   os liga é normal aos dois). */
function dSA(ax, ay, bx, by, cx, cy, R, sa, sw, sx, sy, ex, ey){
  let d = dPA(ax, ay, cx, cy, R, sa, sw, sx, sy, ex, ey), e = dPA(bx, by, cx, cy, R, sa, sw, sx, sy, ex, ey);
  if (e < d) d = e;
  e = dPS(sx, sy, ax, ay, bx, by); if (e < d) d = e;
  e = dPS(ex, ey, ax, ay, bx, by); if (e < d) d = e;
  if (d === 0) return 0;
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
/* arco -> arco, exata: as pontas de cada um contra o outro, os cruzamentos dos dois círculos
   dentro das duas varreduras (zero) e os pares na linha dos centros — o único lugar onde dois
   pontos de interior podem ser o par mais perto. Centros iguais: as pontas já bastam. */
function dAA(a, b){
  let d = dPA(a.sx, a.sy, b.cx, b.cy, b.R, b.sa, b.sw, b.sx, b.sy, b.ex, b.ey);
  let e = dPA(a.ex, a.ey, b.cx, b.cy, b.R, b.sa, b.sw, b.sx, b.sy, b.ex, b.ey); if (e < d) d = e;
  e = dPA(b.sx, b.sy, a.cx, a.cy, a.R, a.sa, a.sw, a.sx, a.sy, a.ex, a.ey); if (e < d) d = e;
  e = dPA(b.ex, b.ey, a.cx, a.cy, a.R, a.sa, a.sw, a.sx, a.sy, a.ex, a.ey); if (e < d) d = e;
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
  }
  return d;
}

/* caixa girada de cantos redondos (o miolo [-a,a]x[-b,b] inflado de rr): distância COM SINAL do
   ponto à borda — negativa dentro. É a conta de sempre do retângulo, menos o raio do canto: o
   círculo (a = b = 0) e o oblongo (a ou b = 0) saem da mesma fórmula. */
function sdPontoCaixa(g, o, x, y){
  const ux = x - g[o], uy = y - g[o + 1], co = g[o + 5], si = g[o + 6];
  let lx = ux * co + uy * si, ly = uy * co - ux * si;
  if (lx < 0) lx = -lx;
  if (ly < 0) ly = -ly;
  const qx = lx - g[o + 2], qy = ly - g[o + 3];
  if (qx <= 0 && qy <= 0) return (qx > qy ? qx : qy) - g[o + 4];
  const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
  return Math.sqrt(ox * ox + oy * oy) - g[o + 4];
}
function maxAbs(x, y, a, b){ const p = (x < 0 ? -x : x) - a, q = (y < 0 ? -y : y) - b; return p > q ? p : q; }
/* a MENOR distância com sinal de um segmento à caixa, exata. Dentro do miolo a distância com sinal
   é max(|x|-a, |y|-b): convexa e linear por partes ao longo do segmento, então o mínimo cai numa
   ponta ou numa quebra (x = 0, y = 0, |x|-a = |y|-b). Se esse mínimo não é positivo o segmento
   entra no miolo e ele é a resposta; senão o segmento fica fora e vale a distância euclidiana às
   quatro arestas. */
function sdSegCaixa(g, o, ax, ay, bx, by){
  const cx = g[o], cy = g[o + 1], a = g[o + 2], b = g[o + 3], rr = g[o + 4], co = g[o + 5], si = g[o + 6];
  let ux = ax - cx, uy = ay - cy;
  const x1 = ux * co + uy * si, y1 = uy * co - ux * si;
  ux = bx - cx; uy = by - cy;
  const x2 = ux * co + uy * si, y2 = uy * co - ux * si;
  const dx = x2 - x1, dy = y2 - y1;
  let m = maxAbs(x1, y1, a, b), e = maxAbs(x2, y2, a, b), t;
  if (e < m) m = e;
  if (dx !== 0) { t = -x1 / dx; if (t > 0 && t < 1) { e = maxAbs(x1 + t * dx, y1 + t * dy, a, b); if (e < m) m = e; } }
  if (dy !== 0) { t = -y1 / dy; if (t > 0 && t < 1) { e = maxAbs(x1 + t * dx, y1 + t * dy, a, b); if (e < m) m = e; } }
  for (let sx = -1; sx <= 1; sx += 2) for (let sy = -1; sy <= 1; sy += 2) {
    const den = sx * dx - sy * dy;
    if (den === 0) continue;
    t = (a - b - sx * x1 + sy * y1) / den;
    if (t > 0 && t < 1) { e = maxAbs(x1 + t * dx, y1 + t * dy, a, b); if (e < m) m = e; }
  }
  if (m <= 0) return m - rr;
  let d;
  if (a > 0 && b > 0) {
    d = dSS(x1, y1, x2, y2, -a, -b, a, -b);
    e = dSS(x1, y1, x2, y2, a, -b, a, b); if (e < d) d = e;
    e = dSS(x1, y1, x2, y2, a, b, -a, b); if (e < d) d = e;
    e = dSS(x1, y1, x2, y2, -a, b, -a, -b); if (e < d) d = e;
  } else d = dSS(x1, y1, x2, y2, -a, -b, a, b);   /* miolo degenerado: um segmento ou um ponto */
  return d - rr;
}

/* ============================== polígonos ============================== */

/* os pontos de um anel sem repetido em sequência e sem o fechamento explícito; null se < 3 */
function limpaAnel(pts, escala){
  const out = [];
  const k = escala || 1;
  for (const q of Array.isArray(pts) ? pts : []) {
    if (!Array.isArray(q) || !isNum(q[0]) || !isNum(q[1])) continue;
    const x = q[0] * k, y = q[1] * k, u = out[out.length - 1];
    if (u && Math.abs(u[0] - x) <= EPS_PT && Math.abs(u[1] - y) <= EPS_PT) continue;
    out.push([x, y]);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) <= EPS_PT && Math.abs(out[0][1] - out[out.length - 1][1]) <= EPS_PT) out.pop();
  return out.length >= 3 ? out : null;
}
/* um anel pronto para "o ponto está dentro?" por par/ímpar. Polígono despejado tem milhares de
   arestas: com muitas, um índice de faixas horizontais deixa na conta só as arestas que
   atravessam a faixa do ponto. */
function novoAnel(pts, buraco){
  const n = pts.length, xs = new Float64Array(n), ys = new Float64Array(n);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pts[i][0], y = pts[i][1];
    xs[i] = x; ys[i] = y;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const A = { xs, ys, n, buraco: !!buraco, x0, y0, x1, y1, nf: 0, fh: 0, fini: null, fidx: null };
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
function distAnel(A, x, y){
  const xs = A.xs, ys = A.ys, n = A.n;
  let d = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) { const e = dPS(x, y, xs[j], ys[j], xs[i], ys[i]); if (e < d) d = e; }
  return d;
}
/* área de cobre: dentro de algum anel escuro e de nenhum furo. É a regra do Gerber (escuras
   primeiro, os miolos claros por cima), e não par/ímpar entre anéis — dois contornos escuros que
   se sobrepõem continuam cobre, e um recorte desenhado duas vezes (o DMB tem) continua furo. */
function dentroArea(Ar, x, y){
  if (x < Ar.x0 || x > Ar.x1 || y < Ar.y0 || y > Ar.y1) return false;
  const E = Ar.escuros, F = Ar.furos;
  let esc = false;
  for (let i = 0; i < E.length; i++) if (dentroAnel(E[i], x, y)) { esc = true; break; }
  if (!esc) return false;
  for (let i = 0; i < F.length; i++) if (dentroAnel(F[i], x, y)) return false;
  return true;
}
function distArea(Ar, x, y){
  let d = Infinity;
  for (const A of Ar.escuros) { const e = distAnel(A, x, y); if (e < d) d = e; }
  for (const A of Ar.furos) { const e = distAnel(A, x, y); if (e < d) d = e; }
  return d;
}
/* a placa: par/ímpar entre os laços do contorno (um laço dentro do maior é furo, como o
   pathPlaca da tela pinta) */
function dentroPlaca(P, x, y){
  if (x < P.x0 || x > P.x1 || y < P.y0 || y > P.y1) return false;
  let c = false;
  for (let i = 0; i < P.aneis.length; i++) if (dentroAnel(P.aneis[i], x, y)) c = !c;
  return c;
}

/* ============================== a cena e o índice ============================== */

function idDaNet(cena, net, cria){
  const s = typeof net === 'string' ? net : (net == null ? '' : String(net));
  if (!s) return 0;
  let id = cena._nets.get(s);
  if (id === undefined) {
    if (!cria) return -1;          /* net que nenhum obstáculo tem: todo cobre com net é de outra */
    id = cena._nets.size + 1;
    cena._nets.set(s, id);
  }
  return id;
}

/* O MONTADOR junta as primitivas de uma camada em arrays comuns; o `finaliza` passa tudo para
   arrays tipados e monta os baldes. Um OBSTÁCULO é um objeto da placa (trilha, pad, região...):
   tem id, net, tipo, e uma ou mais primitivas. */
function novoMontador(cena){ return { cena, kind: [], dono: [], geo: [], caixa: [], obst: [], areas: [], oBorda: -1 }; }
/* `desc` é o descritor de query do objeto, NO FORMATO DO DRC (hub-pcbdrc.js » descritor): é com
   ele que a regra de Clearance do par se resolve, e o mesmo par tem de dar a mesma folga aqui e lá */
function novoObst(M, id, net, tipo, sempre, desc){
  const s = typeof net === 'string' ? net : '';
  const ident = id == null ? tipo + '#' + M.obst.length : String(id);
  M.obst.push({ id: ident, net: sempre ? '' : s,
                netId: sempre ? 0 : idDaNet(M.cena, s, true), tipo, sempre: !!sempre, prims: [],
                desc: desc ? Object.assign({ net: '', layer: '', comp: '', footprint: '', smd: false, poly: false, pad: '', keepout: false, id: ident }, desc) : null });
  return M.obst.length - 1;
}
function poePrim(M, oi, k, geo, x1, y1, x2, y2){
  const i = M.kind.length;
  M.kind.push(k); M.dono.push(oi);
  for (let q = 0; q < G; q++) M.geo.push(q < geo.length ? geo[q] : 0);
  M.caixa.push(x1, y1, x2, y2);
  M.obst[oi].prims.push(i);
  return i;
}
function addSeg(M, oi, x1, y1, x2, y2, r){
  if (![x1, y1, x2, y2].every(isNum)) return;
  r = r > 0 ? r : 0;
  poePrim(M, oi, K_SEG, [x1, y1, x2, y2, r], Math.min(x1, x2) - r, Math.min(y1, y2) - r, Math.max(x1, x2) + r, Math.max(y1, y2) + r);
}
/* o arco do board.js (graus, sa -> ea anti-horário; |ea-sa| >= 359,999 é círculo, como a tela) */
function arcoDe(cx, cy, R, saG, eaG){
  if (![cx, cy, R, saG, eaG].every(isNum) || !(R > 0)) return null;
  const cheio = Math.abs(eaG - saG) >= 359.999;
  let swG = ((eaG - saG) % 360 + 360) % 360;
  const sw = cheio ? DOISPI : swG * RAD;
  let sa = (saG % 360 + 360) % 360 * RAD;
  const cs = cosSen(saG), ce = cheio ? cs : cosSen(eaG);
  const A = { cx, cy, R, sa, sw, sx: cx + R * cs[0], sy: cy + R * cs[1], ex: cx + R * ce[0], ey: cy + R * ce[1] };
  /* caixa do arco: as pontas e os extremos de eixo que a varredura cruza */
  let x1 = Math.min(A.sx, A.ex), x2 = Math.max(A.sx, A.ex), y1 = Math.min(A.sy, A.ey), y2 = Math.max(A.sy, A.ey);
  for (let q = 0; q < 4; q++) {
    const vx = q === 0 ? 1 : q === 2 ? -1 : 0, vy = q === 1 ? 1 : q === 3 ? -1 : 0;
    if (naVarredura(vx, vy, sa, sw)) { x1 = Math.min(x1, cx + R * vx); x2 = Math.max(x2, cx + R * vx); y1 = Math.min(y1, cy + R * vy); y2 = Math.max(y2, cy + R * vy); }
  }
  A.x1 = x1; A.y1 = y1; A.x2 = x2; A.y2 = y2;
  return A;
}
function addArco(M, oi, cx, cy, R, saG, eaG, r){
  const A = arcoDe(cx, cy, R, saG, eaG);
  if (!A) return;
  r = r > 0 ? r : 0;
  poePrim(M, oi, K_ARCO, [A.cx, A.cy, A.R, A.sa, A.sw, r, A.sx, A.sy, A.ex, A.ey], A.x1 - r, A.y1 - r, A.x2 + r, A.y2 + r);
}
function addCaixa(M, oi, cx, cy, hx, hy, rr, rotG){
  if (![cx, cy, hx, hy].every(isNum) || !(hx > 0) || !(hy > 0)) return;
  rr = Math.max(0, Math.min(isNum(rr) ? rr : 0, hx, hy));
  const cs = cosSen(rotG), a = hx - rr, b = hy - rr;
  const ex = Math.abs(a * cs[0]) + Math.abs(b * cs[1]) + rr, ey = Math.abs(a * cs[1]) + Math.abs(b * cs[0]) + rr;
  poePrim(M, oi, K_CAIXA, [cx, cy, a, b, rr, cs[0], cs[1]], cx - ex, cy - ey, cx + ex, cy + ey);
}
/* área: os anéis escuros e os furos; as arestas entram como cápsulas de raio 0 do mesmo obstáculo
   (são elas que dão a distância de fora e pegam o cruzamento) */
function addArea(M, oi, escuros, furos){
  const E = (escuros || []).map(p => limpaAnel(p)).filter(Boolean), F = (furos || []).map(p => limpaAnel(p)).filter(Boolean);
  if (!E.length) return;
  const Ar = { escuros: E.map(p => novoAnel(p, false)), furos: F.map(p => novoAnel(p, true)), x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  Ar.todos = Ar.escuros.concat(Ar.furos);
  for (const A of Ar.escuros) { Ar.x0 = Math.min(Ar.x0, A.x0); Ar.y0 = Math.min(Ar.y0, A.y0); Ar.x1 = Math.max(Ar.x1, A.x1); Ar.y1 = Math.max(Ar.y1, A.y1); }
  M.areas.push(Ar);
  poePrim(M, oi, K_AREA, [M.areas.length - 1], Ar.x0, Ar.y0, Ar.x1, Ar.y1);
  for (const p of E.concat(F)) for (let i = 0, j = p.length - 1; i < p.length; j = i++) addSeg(M, oi, p[j][0], p[j][1], p[i][0], p[i][1], 0);
}

/* ---- as formas de pad: as MESMAS convenções do hub-gerber.js (geoPad) e da tela (pForma) ---- */
const ehTH = p => p.layer === 'Multi' || (!p.layer && p.type === 'th');
function formaLado(p, bottom){
  if (bottom && ehTH(p)) {
    const b = p.bot && typeof p.bot === 'object' ? p.bot : null;
    if (b) return { shape: b.shape || p.shape, w: isNum(b.w) ? b.w : p.w, h: isNum(b.h) ? b.h : p.h, radius: isNum(b.radius) ? b.radius : p.radius };
    if ('bw' in p || 'bh' in p || 'bshape' in p)
      return { shape: p.bshape || p.shape, w: isNum(p.bw) ? p.bw : p.w, h: isNum(p.bh) ? p.bh : p.h, radius: isNum(p.bradius) ? p.bradius : p.radius };
  }
  return { shape: p.shape, w: p.w, h: p.h, radius: p.radius };
}
/* {hx, hy, rr} da forma: circle/round com w == h é círculo, senão oval; oval/oblong/obround é
   cantos redondos de raio min/2; roundrect usa o radius (sem ele, min/8) limitado a min/2;
   rect, octogono (conservador: o retângulo cobre o octógono) e o resto, cantos vivos */
function caixaDaForma(f){
  const W = f && f.w, H = f && f.h;
  if (!(W > 0) || !(H > 0)) return null;
  let s = String((f && f.shape) || 'rect').toLowerCase();
  const mesmo = Math.round(W * 1e5) === Math.round(H * 1e5);
  if (s === 'circle' || s === 'round') { if (mesmo) return { hx: W / 2, hy: W / 2, rr: W / 2 }; s = 'oval'; }
  if (s === 'oval' || s === 'oblong' || s === 'obround') return { hx: W / 2, hy: H / 2, rr: Math.min(W, H) / 2 };
  if (s === 'roundrect') {
    const r = Math.min(isNum(f.radius) ? f.radius : Math.min(W, H) / 8, Math.min(W, H) / 2);
    if (r > 0) return { hx: W / 2, hy: H / 2, rr: r };
  }
  return { hx: W / 2, hy: H / 2, rr: 0 };
}
/* o furo fica em (x,y); o "furo deslocado" do Altium desloca o COBRE, no referencial do pad */
function centroCobre(p){
  if ((isNum(p.hox) && p.hox) || (isNum(p.hoy) && p.hoy)) {
    const c = cosSen(p.rot || 0), hx = p.hox || 0, hy = p.hoy || 0;
    return [p.x + hx * c[0] - hy * c[1], p.y + hx * c[1] + hy * c[0]];
  }
  return [p.x, p.y];
}
function poePad(M, p, layer, comp){
  if (!p || !isNum(p.x) || !isNum(p.y)) return;
  const th = ehTH(p);
  if (!th && p.layer !== layer) return;
  const ref = comp && comp.ref ? String(comp.ref) : '', fp = comp && comp.footprint ? String(comp.footprint) : '';
  /* o pad SEM anel de cobre (NPTH) é, para a regra, um objeto "Hole" sem net — como o DRC o monta */
  const fTopo = caixaDaForma(formaLado(p, false));
  const anel = !th || !(p.drill > 0) ? !!fTopo : !!fTopo && (fTopo.rr < fTopo.hx || fTopo.hx !== fTopo.hy || fTopo.hx > p.drill / 2 + 1e-6);
  if (th && !anel) {
    const oh = novoObst(M, p.id, '', 'furo', false, { tipo: 'hole', layer: 'Multi', comp: ref, footprint: fp });
    poeFuro(M, oh, p, null);
    return;
  }
  const oi = novoObst(M, p.id, p.net, 'pad', false, { tipo: 'pad', net: p.net || '', layer: th ? 'Multi' : p.layer, comp: ref, footprint: fp,
                                                    smd: !th, pad: ref + '-' + (p.name != null ? p.name : '') });
  const c = centroCobre(p), f = caixaDaForma(formaLado(p, th && layer === 'Bottom'));
  if (f) addCaixa(M, oi, c[0], c[1], f.hx, f.hy, f.rr, p.rot || 0);
  if (th && p.drill > 0) poeFuro(M, oi, p, f);
}
/* o furo também é obstáculo (cobre não passa por cima de furo): no pad metalizado ele já está
   dentro do cobre, mas o de cobre menor que o furo só tem o furo */
function poeFuro(M, oi, p, f){
  const d = p.drill, dw = p.drillw, forma = String(p.drillshape || 'circle').toLowerCase();
  const rot = (isNum(p.rot) ? p.rot : 0) + (isNum(p.holerot) ? p.holerot : 0);
  if ((forma === 'rect' || forma === 'square') && dw > 0) addCaixa(M, oi, p.x, p.y, dw / 2, d / 2, 0, rot);
  else if ((forma === 'oblong' || forma === 'slot') && dw > 0) addCaixa(M, oi, p.x, p.y, dw / 2, d / 2, Math.min(dw, d) / 2, rot);
  else {
    const g = M.geo, k = M.obst[oi].prims[0];
    const dentro = f && k !== undefined && sdPontoCaixa(g, k * G, p.x, p.y) <= -d / 2;
    if (!dentro) addCaixa(M, oi, p.x, p.y, d / 2, d / 2, d / 2, 0);
  }
}
/* texto: a geometria do HubGerber.geometriaTexto (quem chama passa em opts.textoGeo). O contorno
   exato (regioes) de lá sai em unidades de 0,00001 mm, e os traços em mm: a escala certa é a que
   põe o contorno em cima do texto. */
function poeTexto(M, t, textoGeo){
  let g = null;
  try { g = textoGeo(t); } catch (e) { g = null; }
  if (!g) return;
  const oi = novoObst(M, t.id, '', 'texto', false, { tipo: 'text', layer: t.layer, comp: t.owner || '' });
  if (Array.isArray(g.regioes) && g.regioes.length) {
    let k = 1;
    if (isNum(t.x) && isNum(t.y)) {
      let sx = 0, sy = 0, n = 0;
      for (const r of g.regioes) for (const q of (r && r.pts) || []) if (Array.isArray(q) && isNum(q[0]) && isNum(q[1])) { sx += q[0]; sy += q[1]; n++; }
      if (n) {
        const cx = sx / n, cy = sy / n, lim = Math.max(10, 10 * (t.h || 0));
        if (Math.hypot(cx - t.x, cy - t.y) > 1000 && Math.hypot(cx * 1e-5 - t.x, cy * 1e-5 - t.y) < lim) k = 1e-5;
      }
    }
    const E = [], F = [];
    for (const r of g.regioes) { const p = r && limpaAnel(r.pts, k); if (p) (r.hole ? F : E).push(p); }
    addArea(M, oi, E, F);
  }
  if (Array.isArray(g.tracos)) {
    const r = (g.w > 0 ? g.w : 0) / 2;
    for (const s of g.tracos) for (let i = 1; i < (s || []).length; i++) addSeg(M, oi, s[i - 1][0], s[i - 1][1], s[i][0], s[i][1], r);
  }
}

/* A camada pronta para consulta, montada só na primeira vez que alguém pergunta por ela */
function camada(cena, layer){
  let L = cena._camadas.get(layer);
  if (!L) { L = montaCamada(cena, layer); cena._camadas.set(layer, L); }
  return L;
}
function montaCamada(cena, layer){
  const M = novoMontador(cena), E = cena.eb;
  if (ehCobre(layer)) {
    /* a borda: o contorno (o "fora" é conferido à parte, em dentroPlaca) e cada recorte */
    if (cena.placa) {
      M.oBorda = novoObst(M, 'borda', '', 'borda', true);
      for (const A of cena.placa.aneis)
        for (let i = 0, j = A.n - 1; i < A.n; j = i++) addSeg(M, M.oBorda, A.xs[j], A.ys[j], A.xs[i], A.ys[i], 0);
    }
    cena.recortes.forEach((k, i) => addArea(M, novoObst(M, k.id || 'recorte' + (i + 1), '', 'borda', true), [k.pts], []));
    /* keepout: a camada KeepOut barra todo cobre; o keepout:true, só a camada dele */
    const ko = (o, mesma) => o && (o.layer === 'KeepOut' || (mesma && o.layer === layer && o.keepout));
    const dK = (tipo, o) => ({ tipo, net: '', layer: o.layer, comp: o.owner || '', keepout: true });
    const dC = (tipo, o, extra) => Object.assign({ tipo, net: o.net || '', layer: o.layer, comp: o.owner || '' }, extra || {});
    for (const s of E.lines || []) if (ko(s, true)) {
      const oi = novoObst(M, s.id, '', 'keepout', true, dK(s.kind === 'arc' ? 'arc' : 'track', s));
      if (s.kind === 'arc') addArco(M, oi, s.cx, s.cy, s.r, s.sa, s.ea, (s.w || 0) / 2);
      else addSeg(M, oi, s.x1, s.y1, s.x2, s.y2, (s.w || 0) / 2);
    }
    for (const t of E.tracks || []) if (t && (t.layer === layer || ko(t, false))) {
      const k = ko(t, true), oi = novoObst(M, t.id, t.net, k ? 'keepout' : 'trilha', k, k ? dK('track', t) : dC('track', t));
      addSeg(M, oi, t.x1, t.y1, t.x2, t.y2, (t.w || 0) / 2);
    }
    for (const a of E.arcs || []) if (a && (a.layer === layer || ko(a, false))) {
      const k = ko(a, true), oi = novoObst(M, a.id, a.net, k ? 'keepout' : 'arco', k, k ? dK('arc', a) : dC('arc', a));
      addArco(M, oi, a.cx, a.cy, a.r, a.sa, a.ea, (a.w || 0) / 2);
    }
    for (const f of E.fills || []) if (f && (f.layer === layer || ko(f, false)) && [f.x1, f.y1, f.x2, f.y2].every(isNum)) {
      const k = ko(f, true), oi = novoObst(M, f.id, f.net, k ? 'keepout' : 'fill', k, k ? dK('fill', f) : dC('fill', f));
      addCaixa(M, oi, (f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2, Math.abs(f.x2 - f.x1) / 2, Math.abs(f.y2 - f.y1) / 2, 0, f.rot || 0);
    }
    for (const g of E.regions || []) if (g && (g.layer === layer || ko(g, false)) && Array.isArray(g.points)) {
      const k = ko(g, true), oi = novoObst(M, g.id, g.net, k ? 'keepout' : 'regiao', k, k ? dK('region', g) : dC('region', g, { poly: !!g.poly }));
      addArea(M, oi, [g.points], Array.isArray(g.holes) ? g.holes : []);
    }
    if (typeof cena.textoGeo === 'function')
      for (const t of E.texts || []) if (t && t.layer === layer && !t.hidden) poeTexto(M, t, cena.textoGeo);
    for (const c of E.components || []) for (const p of (c && c.pads) || []) poePad(M, p, layer, c);
    for (const p of E.freepads || []) poePad(M, p, layer, null);
    for (const v of E.vias || []) if (v && isNum(v.x) && isNum(v.y) && v.size > 0) {
      const oi = novoObst(M, v.id, v.net, 'via', false, { tipo: 'via', net: v.net || '', layer: 'Multi' });
      addCaixa(M, oi, v.x, v.y, v.size / 2, v.size / 2, v.size / 2, 0);
    }
  }
  return finaliza(M, cena, layer);
}
/* A CAMADA EXTRA (2026-10-28, para o hub-autoroteador.js): o cobre que um roteador em lote acabou
   de pôr, num índice à parte e refeito barato a cada mudança — o índice da placa (montaCamada) é
   caro de refazer, e o lote acrescenta e arranca rotas centenas de vezes. Pendurada numa regra
   (R.extra = regraBase(..., montaExtra(...), ...)), ela entra no segLivre e no estadoPonto da regra
   da placa; sem R.extra (a rota da mão, a Trilha da vista) nada muda.
   objs = [{id, tipo:'trilha'|'via', net, layer, x1,y1,x2,y2,w | x,y,size}]: as trilhas só da camada
   pedida, a via (passante) em todas. O índice tem o formato do da placa — regraBase, estadoPonto,
   segLivre e conflitosSeg servem nele —, e cada obstáculo tem o descritor de query do DRC, para a
   folga do par sair da mesma Clearance. Os descritores vêm de um cache da cena por tipo|net|camada:
   o resolvedor de regras guarda a resposta por descritor, e o mesmo par não se resolve de novo a
   cada refação. */
function montaExtra(cena, layer, objs){
  const M = novoMontador(cena);
  const D = cena._descExtra || (cena._descExtra = new Map());
  const descDe = (tipo, net, lay) => {
    const k = tipo + '|' + net + '|' + lay;
    let d = D.get(k);
    if (!d) { d = { tipo, net, layer: lay, comp: '', footprint: '', smd: false, poly: false, pad: '', keepout: false, id: '' }; D.set(k, d); }
    return d;
  };
  for (const o of objs || []) {
    if (!o) continue;
    const net = typeof o.net === 'string' ? o.net : '', via = o.tipo === 'via';
    if (via ? !(o.size > 0) || !isNum(o.x) || !isNum(o.y) : o.layer !== layer) continue;
    M.obst.push({ id: String(o.id), net, netId: idDaNet(cena, net, true), tipo: via ? 'via' : 'trilha', sempre: false, prims: [],
                  desc: descDe(via ? 'via' : 'track', net, via ? 'Multi' : layer) });
    const oi = M.obst.length - 1;
    if (via) addCaixa(M, oi, o.x, o.y, o.size / 2, o.size / 2, o.size / 2, 0);
    else addSeg(M, oi, o.x1, o.y1, o.x2, o.y2, (o.w || 0) / 2);
  }
  return finaliza(M, cena, layer);
}
function finaliza(M, cena, layer){
  const n = M.kind.length, nObs = M.obst.length;
  const L = { nome: layer, n, kind: Uint8Array.from(M.kind), dono: Int32Array.from(M.dono), geo: Float64Array.from(M.geo),
              cx: Float64Array.from(M.caixa), areas: M.areas, oBorda: M.oBorda, marca: new Int32Array(n), qid: 0,
              marca2: new Int32Array(n), qid2: 0,
              obst: M.obst.map(o => ({ id: o.id, net: o.net, netId: o.netId, tipo: o.tipo, sempre: o.sempre, desc: o.desc })),
              _gaps: new Map() };
  /* as primitivas de cada obstáculo (CSR): a distância com sinal do OBJETO é a menor delas */
  const oIni = new Int32Array(nObs + 1);
  for (let i = 0; i < nObs; i++) oIni[i + 1] = oIni[i] + M.obst[i].prims.length;
  const oPrim = new Int32Array(oIni[nObs]);
  for (let i = 0; i < nObs; i++) oPrim.set(M.obst[i].prims, oIni[i]);
  L.oIni = oIni; L.oPrim = oPrim;
  /* os baldes: quadrados de BALDE mm sobre a caixa da grade; o que está fora cai no balde da beira
     (a consulta também é presa à beira, então os dois lados concordam) */
  const gb = cena.bbox, W = gb.x2 - gb.x1, H = gb.y2 - gb.y1;
  let bs = BALDE;
  if ((W / bs) * (H / bs) > MAX_BALDES) bs = Math.sqrt(W * H / MAX_BALDES);
  const nbx = Math.max(1, Math.ceil(W / bs)), nby = Math.max(1, Math.ceil(H / bs)), nb = nbx * nby;
  Object.assign(L, { ox: gb.x1, oy: gb.y1, bs, nbx, nby, bmarca: new Int32Array(nb) });
  let pb = new Int32Array(Math.max(1024, n * 4)), pp = new Int32Array(pb.length), np = 0;
  const ultimo = new Int32Array(nb).fill(-1);
  const bxDe = x => { const b = Math.floor((x - gb.x1) / bs); return b < 0 ? 0 : b >= nbx ? nbx - 1 : b; };
  const byDe = y => { const b = Math.floor((y - gb.y1) / bs); return b < 0 ? 0 : b >= nby ? nby - 1 : b; };
  const poe = (k, x1, y1, x2, y2) => {
    const a0 = bxDe(x1), a1 = bxDe(x2), b0 = byDe(y1), b1 = byDe(y2);
    for (let by = b0; by <= b1; by++) for (let bx = a0; bx <= a1; bx++) {
      const c = by * nbx + bx;
      if (ultimo[c] === k) continue;
      ultimo[c] = k;
      if (np === pb.length) { const q = new Int32Array(np * 2); q.set(pb); pb = q; const r = new Int32Array(np * 2); r.set(pp); pp = r; }
      pb[np] = c; pp[np] = k; np++;
    }
  };
  const g = L.geo;
  for (let k = 0; k < n; k++) {
    const o = k * G, kk = L.kind[k];
    if (kk === K_SEG) {
      /* segmento comprido (aresta de borda, trilha longa na diagonal) vai em pedaços: a caixa
         inteira dele encheria de falsos candidatos os baldes por onde ele não passa */
      const x1 = g[o], y1 = g[o + 1], x2 = g[o + 2], y2 = g[o + 3], r = g[o + 4];
      const np2 = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / bs));
      for (let s = 0; s < np2; s++) {
        const ax = x1 + (x2 - x1) * s / np2, ay = y1 + (y2 - y1) * s / np2;
        const bx = x1 + (x2 - x1) * (s + 1) / np2, by = y1 + (y2 - y1) * (s + 1) / np2;
        poe(k, Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r);
      }
    } else if (kk === K_ARCO) {
      const cx = g[o], cy = g[o + 1], R = g[o + 2], sa = g[o + 3], sw = g[o + 4], r = g[o + 5];
      const passo = Math.min(Math.PI / 8, R > bs / 2 ? 2 * Math.asin(Math.min(1, bs / (2 * R))) : Math.PI / 8);
      const npa = Math.max(1, Math.ceil(sw / passo)), d = sw / npa, sag = R * (1 - Math.cos(d / 2)) + r;
      for (let s = 0; s < npa; s++) {
        const a0 = sa + d * s, a1 = a0 + d;
        const ax = cx + R * Math.cos(a0), ay = cy + R * Math.sin(a0), bx = cx + R * Math.cos(a1), by = cy + R * Math.sin(a1);
        poe(k, Math.min(ax, bx) - sag, Math.min(ay, by) - sag, Math.max(ax, bx) + sag, Math.max(ay, by) + sag);
      }
    } else poe(k, L.cx[k * 4], L.cx[k * 4 + 1], L.cx[k * 4 + 2], L.cx[k * 4 + 3]);
  }
  const ini = new Int32Array(nb + 1);
  for (let q = 0; q < np; q++) ini[pb[q] + 1]++;
  for (let c = 0; c < nb; c++) ini[c + 1] += ini[c];
  const pos = ini.slice(0, nb), itens = new Int32Array(np);
  for (let q = 0; q < np; q++) itens[pos[pb[q]]++] = pp[q];
  L.ini = ini; L.itens = itens;
  return L;
}
function carimbo(L){
  if (++L.qid >= 0x7fffffff) { L.marca.fill(0); L.bmarca.fill(0); L.qid = 1; }
  return L.qid;
}
/* as primitivas cujos baldes tocam o retângulo, cada uma uma vez (fora do caminho quente) */
function cadaPrim(L, x1, y1, x2, y2, fn){
  if (!L.n) return;
  const bs = L.bs, nbx = L.nbx, nby = L.nby;
  let a0 = Math.floor((x1 - L.ox) / bs), a1 = Math.floor((x2 - L.ox) / bs), b0 = Math.floor((y1 - L.oy) / bs), b1 = Math.floor((y2 - L.oy) / bs);
  a0 = a0 < 0 ? 0 : a0 >= nbx ? nbx - 1 : a0; a1 = a1 < 0 ? 0 : a1 >= nbx ? nbx - 1 : a1;
  b0 = b0 < 0 ? 0 : b0 >= nby ? nby - 1 : b0; b1 = b1 < 0 ? 0 : b1 >= nby ? nby - 1 : b1;
  const q = carimbo(L), ini = L.ini, itens = L.itens, marca = L.marca;
  const vistos = [];
  for (let by = b0; by <= b1; by++) for (let bx = a0; bx <= a1; bx++) {
    const c = by * nbx + bx;
    for (let p = ini[c], pf = ini[c + 1]; p < pf; p++) { const k = itens[p]; if (marca[k] !== q) { marca[k] = q; vistos.push(k); } }
  }
  /* a lista primeiro e o fn depois: o fn pode fazer outra consulta (e trocar o carimbo) */
  for (const k of vistos) fn(k);
}

/* ============================== distâncias por primitiva ============================== */

/* ponto: distância com sinal da primitiva. Área: dentro e `fundo` -> menos a distância à borda;
   dentro sem `fundo` -> -Infinity (quem só quer saber se bloqueia não paga a conta das arestas) */
function sdPonto(L, k, x, y, fundo){
  const g = L.geo, o = k * G;
  switch (L.kind[k]) {
    case K_SEG: return dPS(x, y, g[o], g[o + 1], g[o + 2], g[o + 3]) - g[o + 4];
    case K_ARCO: return dPA(x, y, g[o], g[o + 1], g[o + 2], g[o + 3], g[o + 4], g[o + 6], g[o + 7], g[o + 8], g[o + 9]) - g[o + 5];
    case K_CAIXA: return sdPontoCaixa(g, o, x, y);
    default: {
      const Ar = L.areas[g[o]];
      if (!dentroArea(Ar, x, y)) return Infinity;
      return fundo ? -distArea(Ar, x, y) : -Infinity;
    }
  }
}
/* segmento: a MENOR distância com sinal ao longo dele (área: só o "começa dentro"; o cruzamento
   da borda dela é pego pelas arestas, que são primitivas do mesmo obstáculo) */
function sdSeg(L, k, ax, ay, bx, by, fundo){
  const g = L.geo, o = k * G;
  switch (L.kind[k]) {
    case K_SEG: return dSS(ax, ay, bx, by, g[o], g[o + 1], g[o + 2], g[o + 3]) - g[o + 4];
    case K_ARCO: return dSA(ax, ay, bx, by, g[o], g[o + 1], g[o + 2], g[o + 3], g[o + 4], g[o + 6], g[o + 7], g[o + 8], g[o + 9]) - g[o + 5];
    case K_CAIXA: return sdSegCaixa(g, o, ax, ay, bx, by);
    default: {
      const Ar = L.areas[g[o]];
      if (!dentroArea(Ar, ax, ay)) return Infinity;
      return fundo ? -distArea(Ar, ax, ay) : -Infinity;
    }
  }
}
function arcoPrim(g, o){ return { cx: g[o], cy: g[o + 1], R: g[o + 2], sa: g[o + 3], sw: g[o + 4], sx: g[o + 6], sy: g[o + 7], ex: g[o + 8], ey: g[o + 9] }; }
/* arco consultado (o da folgaArco): distância da CURVA à primitiva (sem a largura do arco) */
function sdArco(L, k, Q, fundo){
  const g = L.geo, o = k * G;
  switch (L.kind[k]) {
    case K_SEG: return dSA(g[o], g[o + 1], g[o + 2], g[o + 3], Q.cx, Q.cy, Q.R, Q.sa, Q.sw, Q.sx, Q.sy, Q.ex, Q.ey) - g[o + 4];
    case K_ARCO: return dAA(Q, arcoPrim(g, o)) - g[o + 5];
    case K_CAIXA: {
      /* o arco no referencial da caixa: dentro do miolo -> 0; senão a menor distância às arestas */
      const co = g[o + 5], si = g[o + 6], a = g[o + 2], b = g[o + 3], th = Math.atan2(si, co);
      const loc = (x, y) => { const ux = x - g[o], uy = y - g[o + 1]; return [ux * co + uy * si, uy * co - ux * si]; };
      const c = loc(Q.cx, Q.cy), s = loc(Q.sx, Q.sy), e = loc(Q.ex, Q.ey);
      let sa = (Q.sa - th) % DOISPI; if (sa < 0) sa += DOISPI;
      const A = { cx: c[0], cy: c[1], R: Q.R, sa, sw: Q.sw, sx: s[0], sy: s[1], ex: e[0], ey: e[1] };
      const den = (p) => Math.abs(p[0]) <= a && Math.abs(p[1]) <= b;
      let d;
      if (den(s) || den(e)) d = 0;
      else if (a > 0 && b > 0) {
        d = Math.min(dSA(-a, -b, a, -b, A.cx, A.cy, A.R, A.sa, A.sw, A.sx, A.sy, A.ex, A.ey),
                     dSA(a, -b, a, b, A.cx, A.cy, A.R, A.sa, A.sw, A.sx, A.sy, A.ex, A.ey),
                     dSA(a, b, -a, b, A.cx, A.cy, A.R, A.sa, A.sw, A.sx, A.sy, A.ex, A.ey),
                     dSA(-a, b, -a, -b, A.cx, A.cy, A.R, A.sa, A.sw, A.sx, A.sy, A.ex, A.ey));
      } else d = dSA(-a, -b, a, b, A.cx, A.cy, A.R, A.sa, A.sw, A.sx, A.sy, A.ex, A.ey);
      return d - g[o + 4];
    }
    default: {
      const Ar = L.areas[g[o]];
      if (!dentroArea(Ar, Q.sx, Q.sy)) return Infinity;
      return fundo ? -distArea(Ar, Q.sx, Q.sy) : -Infinity;
    }
  }
}
/* a distância com sinal do OBJETO inteiro a um ponto: a menor das primitivas dele; a borda da
   placa fica negativa fora da placa */
function sdObst(L, P, oi, x, y){
  let d = Infinity;
  for (let q = L.oIni[oi], f = L.oIni[oi + 1]; q < f; q++) { const e = sdPonto(L, L.oPrim[q], x, y, true); if (e < d) d = e; }
  if (oi === L.oBorda && P && !dentroPlaca(P, x, y)) d = -d;
  return d;
}
/* O intervalo de t em [0,1] em que o ponto A + t·D fica a no máximo rho do segmento PQ, em
   saida[0..1]; false se nenhum. A cápsula é convexa, então é um intervalo só: a união do que a
   reta corta do retângulo (PQ varrido de ±rho) e dos dois discos das pontas. */
function intervaloCapsula(ax, ay, dx, dy, px, py, qx, qy, rho, saida){
  let t0 = Infinity, t1 = -Infinity;
  const A2 = dx * dx + dy * dy;
  for (let q = 0; q < 2; q++) {
    const cx = q ? qx : px, cy = q ? qy : py, fx = ax - cx, fy = ay - cy;
    const B = fx * dx + fy * dy, C = fx * fx + fy * fy - rho * rho, disc = B * B - A2 * C;
    if (disc >= 0) { const s = Math.sqrt(disc), a = (-B - s) / A2, b = (-B + s) / A2; if (a < t0) t0 = a; if (b > t1) t1 = b; }
  }
  const ex = qx - px, ey = qy - py, el = Math.sqrt(ex * ex + ey * ey);
  if (el > 0) {
    const ux = ex / el, uy = ey / el;
    const u0 = (ax - px) * ux + (ay - py) * uy, du = dx * ux + dy * uy;
    const v0 = (ay - py) * ux - (ax - px) * uy, dv = dy * ux - dx * uy;
    let lo = -Infinity, hi = Infinity;
    if (du === 0) { if (u0 < 0 || u0 > el) hi = -Infinity; }
    else { let a = -u0 / du, b = (el - u0) / du; if (a > b) { const t = a; a = b; b = t; } if (a > lo) lo = a; if (b < hi) hi = b; }
    if (dv === 0) { if (v0 < -rho || v0 > rho) hi = -Infinity; }
    else { let a = (-rho - v0) / dv, b = (rho - v0) / dv; if (a > b) { const t = a; a = b; b = t; } if (a > lo) lo = a; if (b < hi) hi = b; }
    if (lo <= hi) { if (lo < t0) t0 = lo; if (hi > t1) t1 = hi; }
  }
  if (!(t0 <= t1)) return false;
  saida[0] = t0 < 0 ? 0 : t0; saida[1] = t1 > 1 ? 1 : t1;
  return saida[0] <= saida[1];
}
/* As arestas (as SEG) do obstáculo oi cujos baldes tocam o retângulo. Tem carimbo próprio
   (marca2): estas consultas acontecem DENTRO das outras, que estão usando o carimbo principal. */
function cadaAresta(L, oi, x1, y1, x2, y2, fn){
  if (!L.n) return;
  const bs = L.bs, nbx = L.nbx, nby = L.nby;
  let a0 = Math.floor((x1 - L.ox) / bs), a1 = Math.floor((x2 - L.ox) / bs), b0 = Math.floor((y1 - L.oy) / bs), b1 = Math.floor((y2 - L.oy) / bs);
  a0 = a0 < 0 ? 0 : a0 >= nbx ? nbx - 1 : a0; a1 = a1 < 0 ? 0 : a1 >= nbx ? nbx - 1 : a1;
  b0 = b0 < 0 ? 0 : b0 >= nby ? nby - 1 : b0; b1 = b1 < 0 ? 0 : b1 >= nby ? nby - 1 : b1;
  if (++L.qid2 >= 0x7fffffff) { L.marca2.fill(0); L.qid2 = 1; }
  const q = L.qid2, ini = L.ini, itens = L.itens, marca2 = L.marca2, dono = L.dono, kind = L.kind;
  for (let by = b0; by <= b1; by++) for (let bx = a0; bx <= a1; bx++) {
    const c = by * nbx + bx;
    for (let p = ini[c], pf = ini[c + 1]; p < pf; p++) {
      const k = itens[p];
      if (dono[k] !== oi || kind[k] !== K_SEG || marca2[k] === q) continue;
      marca2[k] = q;
      fn(k);
    }
  }
}
/* a profundidade de (x,y) na área do obstáculo oi — a distância à aresta mais perto —, se ela não
   passa de rmax; acima disso, Infinity. Só os baldes até rmax entram: um polígono despejado tem
   milhares de arestas, e quem pergunta só precisa saber se o ponto fica raso o bastante. */
function fundoLocal(L, oi, x, y, rmax){
  let d = Infinity;
  const g = L.geo;
  cadaAresta(L, oi, x - rmax, y - rmax, x + rmax, y + rmax, k => {
    const o = k * G, e = dPS(x, y, g[o], g[o + 1], g[o + 2], g[o + 3]);
    if (e < d) d = e;
  });
  return d <= rmax ? d : Infinity;
}
/* a profundidade com todas as arestas (só para relatar quanto furou) */
function fundoTotal(L, oi, x, y){
  let d = Infinity;
  const g = L.geo;
  for (let q = L.oIni[oi], f = L.oIni[oi + 1]; q < f; q++) {
    const k = L.oPrim[q];
    if (L.kind[k] !== K_SEG) continue;
    const o = k * G, e = dPS(x, y, g[o], g[o + 1], g[o + 2], g[o + 3]);
    if (e < d) d = e;
  }
  return d;
}
/* A REGRA DE NÃO PIORAR dentro de uma área (a partida já estava dentro do cobre de outra net, ou
   fora da placa): o segmento AB pode andar por dentro, mas só a no máximo `r` da borda — nunca
   mais fundo que a partida. Exata: os intervalos de t em que AB fica a <= r de alguma aresta (só
   as arestas perto de AB podem cobrir alguma coisa) cobrem um pedaço de [0,1]; numa LACUNA da
   cobertura não há cruzamento de borda (o ponto do cruzamento está a 0 de uma aresta), então ela é
   toda dentro ou toda fora — e o meio dela diz qual. Devolve null (ok) ou a distância com sinal do
   ponto que fura (negativa). `dentro` diz o que é "dentro" do obstáculo. */
function fundoNaArea(L, oi, dentro, ax, ay, bx, by, r){
  const dx = bx - ax, dy = by - ay, lim = r + TOL;
  if (dx === 0 && dy === 0) {
    if (!dentro(ax, ay) || fundoLocal(L, oi, ax, ay, lim) !== Infinity) return null;
    return -fundoTotal(L, oi, ax, ay);
  }
  const iv = [], s = [0, 0], g = L.geo;
  cadaAresta(L, oi, Math.min(ax, bx) - lim, Math.min(ay, by) - lim, Math.max(ax, bx) + lim, Math.max(ay, by) + lim, k => {
    const o = k * G;
    if (intervaloCapsula(ax, ay, dx, dy, g[o], g[o + 1], g[o + 2], g[o + 3], lim, s)) iv.push([s[0], s[1]]);
  });
  iv.sort((a, b) => a[0] - b[0]);
  let t = 0;
  const lacuna = (g0, g1) => {
    if (!(g1 > g0)) return null;
    const m = (g0 + g1) / 2, x = ax + dx * m, y = ay + dy * m;
    return dentro(x, y) ? -fundoTotal(L, oi, x, y) : null;
  };
  for (const [a, b] of iv) {
    if (a > t) { const v = lacuna(t, a); if (v !== null) return v; }
    if (b > t) t = b;
  }
  return t < 1 ? lacuna(t, 1) : null;
}
/* a menor distância com sinal ao longo de AB da área da primitiva k quando o limiar é <= 0:
   `l` se ela não fica mais funda que isso, senão a do ponto que fura */
function areaRelaxada(L, k, ax, ay, bx, by, l){
  const Ar = L.areas[L.geo[k * G]];
  const v = fundoNaArea(L, L.dono[k], (x, y) => dentroArea(Ar, x, y), ax, ay, bx, by, -l);
  return v === null ? l : v;
}
/* o mesmo para o lado de fora da placa (a partida estava fora dela) */
function foraRelaxado(R, ax, ay, bx, by, l){
  const v = fundoNaArea(R.L, R.L.oBorda, (x, y) => !dentroPlaca(R.P, x, y), ax, ay, bx, by, -l);
  return v === null ? l : v;
}

/* ============================== regras e consultas ============================== */

/* A REGRA de uma consulta: quem bloqueia (`bloq` por obstáculo) e a que distância (`lim`, do
   EIXO da trilha ao cobre do obstáculo: meia largura + folga, ou menos pela regra de não piorar).
   `limBorda` é o limiar do lado de fora da placa. */
/* quem bloqueia a mão de net N: a borda e o keepout sempre; cobre de outra net; cobre sem net
   contra a mão com net. Sem net contra sem net só o furo bloqueia — o DRC não confere folga entre
   dois cobres sem net (hub-pcbdrc.js: o logotipo de trilhas soltas se toca de propósito) */
function bloqueia(o, N, ig){
  if (ig && ig.has(o.id)) return false;
  if (o.sempre) return true;
  if (o.netId === 0) return N !== 0 || o.tipo === 'furo';
  return o.netId !== N;
}
/* O QUE ESTÁ NA MÃO (a trilha, o arco ou a via que se roteia), como descritor de query:
   {tipo:'track'|'arc'|'via', net, layer}. É o "objeto A" do par da regra. */
function descMao(tipo, net, layer){
  return { tipo: tipo || 'track', net: typeof net === 'string' ? net : '', layer: tipo === 'via' ? 'Multi' : (layer || ''),
           comp: '', footprint: '', smd: false, poly: false, pad: '', keepout: false, id: '' };
}
/* abaixo disto dois cobres de nets com nome estão "se tocando" para o DRC (hub-pcbdrc.js » TOQUE):
   folga 0 pela regra ainda não deixa encostar */
const TOQUE_DRC = 1e-4;
/* AS FOLGAS DA REGRA, por obstáculo, para o que está na mão: o mesmo par (mão, obstáculo) que o DRC
   resolve, pela mesma conta (hub-pcbregras.js » folgaEntre: a Clearance vencedora do par, com a
   matriz de objetos). Sem conjunto de regras na cena, a folga única de antes (cena.clearance). O
   contorno e os recortes vão pela Board Outline Clearance da mão — a mesma que o DRC confere.
   Fica guardado na camada por mão (tipo|net|camada): o DRC pergunta pelos mesmos pares milhares
   de vezes, e a rota também. */
function folgasDaMao(cena, L, mao){
  const chave = mao.tipo + '|' + mao.net + '|' + mao.layer;
  let F = L._gaps.get(chave);
  if (F) return F;
  const nObs = L.obst.length, gap = new Float64Array(nObs);
  const RES = cena.regras;
  let borda = cena.clearance;
  if (!RES) gap.fill(cena.clearance);
  else {
    const rB = RES.regraPara('BoardOutlineClearance', mao);
    borda = rB && isNum(rB.gap) && rB.gap > 0 ? rB.gap : 0;
    const RG = cena.RG;
    for (let i = 0; i < nObs; i++) {
      const o = L.obst[i];
      if (o.tipo === 'borda') { gap[i] = borda; continue; }
      if (!o.desc) { gap[i] = cena.clearance; continue; }
      const f = RG.folgaEntre(RES, mao, o.desc);
      let g = f && isNum(f.gap) ? f.gap : 0;
      if (g < TOQUE_DRC * 2) g = TOQUE_DRC * 2;
      gap[i] = g;
    }
  }
  if (L._gaps.size > 64) L._gaps.clear();
  F = { gap, borda };
  L._gaps.set(chave, F);
  return F;
}
function regraBase(cena, L, N, ig, meia, mao){
  const nObs = L.obst.length, bloq = new Uint8Array(nObs), lim = new Float64Array(nObs);
  const F = folgasDaMao(cena, L, mao || descMao('track', '', L.nome));
  let T = meia + F.borda;
  for (let i = 0; i < nObs; i++) {
    bloq[i] = bloqueia(L.obst[i], N, ig) ? 1 : 0;
    lim[i] = meia + F.gap[i];
    if (bloq[i] && lim[i] > T) T = lim[i];
  }
  const bordaFora = L.oBorda >= 0 && !(ig && ig.has('borda'));
  /* extra: null = sem a camada extra do lote (motor.montaExtra); o campo nasce aqui para toda regra ter
     a mesma forma no caminho quente (segLivre/estadoPonto) */
  return { cena, L, P: bordaFora ? cena.placa : null, bloq, lim, T, m: 0, limBorda: meia + F.borda, extra: null };
}
function conjunto(v){
  if (!v) return null;
  if (v instanceof Set) return v.size ? v : null;
  if (Array.isArray(v)) return v.length ? new Set(v.map(String)) : null;
  return null;
}

/* o segmento AB é livre pela regra R? (exato; para no primeiro obstáculo que viola) */
function segLivre(R, ax, ay, bx, by){
  const L = R.L;
  if (L.n) {
    const T = R.T, bs = L.bs, nbx = L.nbx, nby = L.nby, ox = L.ox, oy = L.oy;
    const ini = L.ini, itens = L.itens, marca = L.marca, bmarca = L.bmarca, dono = L.dono, kind = L.kind, geo = L.geo, cx = L.cx;
    const bloq = R.bloq, lim = R.lim;
    const xmin = ax < bx ? ax : bx, xmax = ax < bx ? bx : ax, ymin = ay < by ? ay : by, ymax = ay < by ? by : ay;
    const q = carimbo(L);
    const len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    const npc = len > bs ? Math.ceil(len / bs) : 1;
    for (let s = 0; s < npc; s++) {
      const px0 = ax + (bx - ax) * s / npc, py0 = ay + (by - ay) * s / npc;
      const px1 = ax + (bx - ax) * (s + 1) / npc, py1 = ay + (by - ay) * (s + 1) / npc;
      let a0 = Math.floor(((px0 < px1 ? px0 : px1) - T - ox) / bs), a1 = Math.floor(((px0 < px1 ? px1 : px0) + T - ox) / bs);
      let b0 = Math.floor(((py0 < py1 ? py0 : py1) - T - oy) / bs), b1 = Math.floor(((py0 < py1 ? py1 : py0) + T - oy) / bs);
      if (a0 < 0) a0 = 0; if (a1 >= nbx) a1 = nbx - 1; if (b0 < 0) b0 = 0; if (b1 >= nby) b1 = nby - 1;
      if (a0 >= nbx) a0 = nbx - 1; if (a1 < 0) a1 = 0; if (b0 >= nby) b0 = nby - 1; if (b1 < 0) b1 = 0;
      for (let byy = b0; byy <= b1; byy++) {
        const lin = byy * nbx;
        for (let bxx = a0; bxx <= a1; bxx++) {
          const c = lin + bxx;
          if (bmarca[c] === q) continue;
          bmarca[c] = q;
          for (let p = ini[c], pf = ini[c + 1]; p < pf; p++) {
            const k = itens[p];
            if (marca[k] === q) continue;
            marca[k] = q;
            const oi = dono[k];
            if (bloq[oi] === 0) continue;
            const l = lim[oi], k4 = k << 2;
            if (cx[k4] > xmax + l || cx[k4 + 2] < xmin - l || cx[k4 + 1] > ymax + l || cx[k4 + 3] < ymin - l) continue;
            const kk = kind[k], o = k * G;
            let d;
            if (kk === K_SEG) d = dSS(ax, ay, bx, by, geo[o], geo[o + 1], geo[o + 2], geo[o + 3]) - geo[o + 4];
            else if (kk === K_CAIXA) d = sdSegCaixa(geo, o, ax, ay, bx, by);
            else if (kk === K_AREA && l <= TOL) d = areaRelaxada(L, k, ax, ay, bx, by, l);
            else d = sdSeg(L, k, ax, ay, bx, by, false);
            if (d < l - TOL) return false;
          }
        }
      }
    }
  }
  /* limiar até TOL vai pela conta exata: com ele a aresta (distância 0) não acusa o cruzamento */
  if (R.P) {
    if (R.limBorda > TOL) { if (!dentroPlaca(R.P, ax, ay)) return false; }
    else if (foraRelaxado(R, ax, ay, bx, by, R.limBorda) < R.limBorda - TOL) return false;
  }
  /* a camada EXTRA (motor.montaExtra): o cobre que um roteador em lote acabou de pôr, num índice à
     parte. Só existe na regra que o hub-autoroteador.js monta; a rota da mão nunca tem */
  if (R.extra && !segLivre(R.extra, ax, ay, bx, by)) return false;
  return true;
}
/* os conflitos de um segmento pela regra R: Map obstáculo -> a menor distância com sinal */
function conflitosSeg(R, ax, ay, bx, by, achados){
  const L = R.L, T = R.T;
  const xmin = Math.min(ax, bx), xmax = Math.max(ax, bx), ymin = Math.min(ay, by), ymax = Math.max(ay, by);
  cadaPrim(L, xmin - T, ymin - T, xmax + T, ymax + T, k => {
    const oi = L.dono[k];
    if (!R.bloq[oi]) return;
    const l = R.lim[oi], d = (L.kind[k] === K_AREA && l <= TOL) ? areaRelaxada(L, k, ax, ay, bx, by, l) : sdSeg(L, k, ax, ay, bx, by, true);
    if (d < l - TOL) { const a = achados.get(oi); if (a === undefined || d < a) achados.set(oi, d); }
  });
  if (R.P) {
    let d = Infinity;
    if (R.limBorda > TOL) { if (!dentroPlaca(R.P, ax, ay)) d = sdObst(L, R.P, L.oBorda, ax, ay); }
    else d = foraRelaxado(R, ax, ay, bx, by, R.limBorda);
    if (d < R.limBorda - TOL) { const a = achados.get(L.oBorda); if (a === undefined || d < a) achados.set(L.oBorda, d); }
  }
  return achados;
}
function conflitosPonto(R, x, y, achados){
  const L = R.L, T = R.T;
  cadaPrim(L, x - T, y - T, x + T, y + T, k => {
    const oi = L.dono[k];
    if (!R.bloq[oi]) return;
    const d = sdPonto(L, k, x, y, true);
    if (d < R.lim[oi] - TOL) { const a = achados.get(oi); if (a === undefined || d < a) achados.set(oi, d); }
  });
  if (R.P && !dentroPlaca(R.P, x, y)) {
    const d = sdObst(L, R.P, L.oBorda, x, y);
    if (d < R.limBorda - TOL) { const a = achados.get(L.oBorda); if (a === undefined || d < a) achados.set(L.oBorda, d); }
  }
  return achados;
}
function conflitosArco(R, Q, achados){
  const L = R.L, T = R.T;
  cadaPrim(L, Q.x1 - T, Q.y1 - T, Q.x2 + T, Q.y2 + T, k => {
    const oi = L.dono[k];
    if (!R.bloq[oi]) return;
    const d = sdArco(L, k, Q, true);
    if (d < R.lim[oi] - TOL) { const a = achados.get(oi); if (a === undefined || d < a) achados.set(oi, d); }
  });
  if (R.P && !dentroPlaca(R.P, Q.sx, Q.sy)) {
    const d = sdObst(L, R.P, L.oBorda, Q.sx, Q.sy);
    if (d < R.limBorda - TOL) { const a = achados.get(L.oBorda); if (a === undefined || d < a) achados.set(L.oBorda, d); }
  }
  return achados;
}
/* Map obstáculo -> distância do EIXO  =>  [{id, net, tipo, dist}], dist = folga de cobre a cobre */
function listaConflitos(L, achados, meia, layer, R){
  const out = [];
  for (const [oi, d] of achados) {
    const o = L.obst[oi], c = { id: o.id, net: o.net, tipo: o.tipo, dist: d - meia };
    /* a folga que a regra pede para este par (a do contorno, na borda) */
    if (R) c.folga = (oi === L.oBorda ? R.limBorda : R.lim[oi]) - meia;
    if (layer) c.layer = layer;
    out.push(c);
  }
  return out;
}
const porDist = (a, b) => a.dist - b.dist || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/* ============================== API: folgas e net ============================== */

/* A net do cobre que CONTÉM o ponto na camada ('' se nenhum): a partida no meio de uma trilha
   adota a net dela, como no Altium. Entre dois cobres com net, o mais "fundo" ganha. */
function netEm(cena, layer, x, y){
  if (!ehCobre(layer) || !isNum(x) || !isNum(y)) return '';
  const L = camada(cena, layer);
  let net = '', fundo = Infinity;
  cadaPrim(L, x, y, x, y, k => {
    const o = L.obst[L.dono[k]];
    if (o.sempre || !o.net) return;
    const d = sdPonto(L, k, x, y, true);
    if (d <= TOL && d < fundo) { fundo = d; net = o.net; }
  });
  return net;
}
function folgaTrilha(cena, layer, seg, o){
  const s = seg || {}, w = s.w > 0 ? s.w : 0;
  if (!ehCobre(layer) || ![s.x1, s.y1, s.x2, s.y2].every(isNum)) return { ok: true, conflitos: [] };
  const L = camada(cena, layer), R = regraBase(cena, L, idDaNet(cena, o && o.net, false), conjunto(o && o.ignora), w / 2, descMao('track', o && o.net, layer));
  const c = listaConflitos(L, conflitosSeg(R, s.x1, s.y1, s.x2, s.y2, new Map()), w / 2, null, R).sort(porDist);
  return { ok: !c.length, conflitos: c };
}
function folgaArco(cena, layer, arco, o){
  const a = arco || {}, w = a.w > 0 ? a.w : 0;
  const Q = ehCobre(layer) ? arcoDe(a.cx, a.cy, a.r, a.sa, a.ea) : null;
  if (!Q) return { ok: true, conflitos: [] };
  const L = camada(cena, layer), R = regraBase(cena, L, idDaNet(cena, o && o.net, false), conjunto(o && o.ignora), w / 2, descMao('arc', o && o.net, layer));
  const c = listaConflitos(L, conflitosArco(R, Q, new Map()), w / 2, null, R).sort(porDist);
  return { ok: !c.length, conflitos: c };
}
function folgaVia(cena, via, o){
  const v = via || {};
  if (!isNum(v.x) || !isNum(v.y)) return { ok: true, conflitos: [] };
  const meia = v.size > 0 ? v.size / 2 : 0, ig = conjunto(o && o.ignora), mao = descMao('via', o && o.net);
  /* todas as camadas montadas ANTES de traduzir a net: uma net que só existe numa camada ainda
     não montada sairia como "net de ninguém" e o cobre dela bloquearia a própria via */
  for (const layer of cena.camadas) camada(cena, layer);
  const N = idDaNet(cena, o && o.net, false);
  let c = [];
  for (const layer of cena.camadas) {
    const L = camada(cena, layer), R = regraBase(cena, L, N, ig, meia, mao);
    c = c.concat(listaConflitos(L, conflitosPonto(R, v.x, v.y, new Map()), meia, layer, R));
  }
  c.sort(porDist);
  return { ok: !c.length, conflitos: c };
}

/* ============================== o contexto da rota ============================== */

/* O CONTEXTO é tudo o que decide se um nó da grade é livre: camada, net efetiva, largura, ponto
   de partida, o que se ignora e os isentos da chegada. Enquanto ele não muda (o mouse andando no
   mesmo trecho), o estado dos nós já testados vale e a busca seguinte não o refaz. */
function contexto(cena, L, layer, N, w, de, ig, isentos, net){
  /* a net vai pelo NOME na chave: duas nets que nenhum objeto tem dividem o id -1, mas não as
     regras (a Clearance de InNet('HV') não é a da net ao lado) */
  const chave = layer + '|' + N + '|' + (net || '') + '|' + w + '|' + de[0] + ',' + de[1] + '|' + (ig ? [...ig].sort().join(',') : '') + '|' + isentos.join(',');
  if (cena._ctx && cena._ctx.chave === chave) return cena._ctx;
  const R = regraBase(cena, L, N, ig, w / 2, descMao('track', net, layer)), T = R.T;
  for (const oi of isentos) R.bloq[oi] = 0;
  /* PARTIDA. Objeto sem net que contém `de` (a trilha começou nele) não bloqueia este trecho. O
     que já viola a folga em `de` vale pela regra de NÃO PIORAR: o caminho pode ficar à mesma
     distância dele ou se afastar, nunca chegar mais perto — senão nada sairia do lugar, e
     ignorá-lo de vez deixaria a trilha atravessá-lo mais adiante. */
  const perto = new Set();
  cadaPrim(L, de[0] - T, de[1] - T, de[0] + T, de[1] + T, k => { if (R.bloq[L.dono[k]]) perto.add(L.dono[k]); });
  if (R.P && L.oBorda >= 0) perto.add(L.oBorda);
  for (const oi of perto) {
    const o = L.obst[oi], d0 = sdObst(L, R.P || cena.placa, oi, de[0], de[1]);
    if (!o.sempre && o.netId === 0 && d0 <= TOL) { R.bloq[oi] = 0; continue; }
    if (oi === L.oBorda) {
      if (d0 < R.limBorda - TOL) { R.lim[oi] = d0; R.limBorda = d0; }
    } else if (d0 < R.lim[oi] - TOL) R.lim[oi] = d0;
  }
  /* a grade: ancorada em `de`, cobrindo a caixa da cena (e o próprio `de`, se ele está fora) */
  const res = cena.res, gb = cena.bbox;
  const iMin = Math.min(0, Math.floor((gb.x1 - de[0]) / res)), iMax = Math.max(0, Math.ceil((gb.x2 - de[0]) / res));
  const jMin = Math.min(0, Math.floor((gb.y1 - de[1]) / res)), jMax = Math.max(0, Math.ceil((gb.y2 - de[1]) / res));
  const NI = iMax - iMin + 1, NJ = jMax - jMin + 1;
  const ctx = Object.assign(R, { chave, layer, N, netNome: net || '', w, res, m: res * SQ2 / 2, dx: de[0], dy: de[1],
                                 iMin, jMin, NI, NJ, s0: (0 - jMin) * NI + (0 - iMin), B: null });
  cena._ctx = ctx;
  return ctx;
}
/* Os arrays tipados da busca (custo, direção de chegada, carimbo de geração, estado dos nós e das
   arestas, o heap) são UM conjunto do módulo, reaproveitado entre chamadas e entre cenas: cada
   edição troca a cena, e realocar ~16 MB a cada uma só daria trabalho ao coletor. O conjunto tem
   DONO — o contexto cujo estado ele guarda —; outro contexto que o pega limpa o estado antes. */
let POOL = null;
function posse(ctx){
  const nn = ctx.NI * ctx.NJ;
  if (!POOL || POOL.cap < nn) {
    const cap = Math.max(nn, POOL ? POOL.cap : 0);
    POOL = { cap, estado: new Uint8Array(cap), arSab: new Uint8Array(cap), arOk: new Uint8Array(cap),
             g: new Float32Array(cap), marca: new Uint32Array(cap), dirIn: new Uint8Array(cap),
             hn: new Int32Array(1 << 16), hk: new Float64Array(1 << 16), hlen: 0, gen: 0, dono: null };
  }
  if (POOL.dono !== ctx) { POOL.estado.fill(0, 0, nn); POOL.arSab.fill(0, 0, nn); POOL.dono = ctx; }
  ctx.B = POOL;
  return ctx;
}
/* os isentos da CHEGADA: objeto sem net que contém `ate`, quando o snap foi elétrico (ligar num
   pad sem net não junta duas nets) */
function isentosChegada(cena, L, N, ig, ate){
  const out = new Set();
  cadaPrim(L, ate[0], ate[1], ate[0], ate[1], k => {
    const oi = L.dono[k], o = L.obst[oi];
    if (o.sempre || o.netId !== 0 || !bloqueia(o, N, ig) || out.has(oi)) return;
    if (sdObst(L, cena.placa, oi, ate[0], ate[1]) <= TOL) out.add(oi);
  });
  return [...out].sort((a, b) => a - b);
}

/* estado de um ponto: LIVRE (folga + margem de tudo), BANDA (só a folga) ou BLOQ */
function estadoPonto(R, x, y){
  const L = R.L, m = R.m;
  let banda = false;
  if (L.n) {
    const Rq = R.T + m, bs = L.bs, nbx = L.nbx, nby = L.nby;
    let a0 = Math.floor((x - Rq - L.ox) / bs), a1 = Math.floor((x + Rq - L.ox) / bs);
    let b0 = Math.floor((y - Rq - L.oy) / bs), b1 = Math.floor((y + Rq - L.oy) / bs);
    if (a0 < 0) a0 = 0; if (a1 >= nbx) a1 = nbx - 1; if (b0 < 0) b0 = 0; if (b1 >= nby) b1 = nby - 1;
    if (a0 >= nbx) a0 = nbx - 1; if (a1 < 0) a1 = 0; if (b0 >= nby) b0 = nby - 1; if (b1 < 0) b1 = 0;
    const ini = L.ini, itens = L.itens, marca = L.marca, dono = L.dono, kind = L.kind, geo = L.geo, cx = L.cx;
    const bloq = R.bloq, lim = R.lim, T = R.T;
    const q = carimbo(L);
    for (let by = b0; by <= b1; by++) {
      const lin = by * nbx;
      for (let bx = a0; bx <= a1; bx++) {
        const c = lin + bx;
        for (let p = ini[c], pf = ini[c + 1]; p < pf; p++) {
          const k = itens[p];
          if (marca[k] === q) continue;
          marca[k] = q;
          const oi = dono[k];
          if (bloq[oi] === 0) continue;
          const l = lim[oi], lm = l + m, k4 = k << 2;
          if (x < cx[k4] - lm || x > cx[k4 + 2] + lm || y < cx[k4 + 1] - lm || y > cx[k4 + 3] + lm) continue;
          const kk = kind[k], o = k * G;
          let d;
          if (kk === K_SEG) d = dPS(x, y, geo[o], geo[o + 1], geo[o + 2], geo[o + 3]) - geo[o + 4];
          else if (kk === K_CAIXA) d = sdPontoCaixa(geo, o, x, y);
          else if (kk === K_AREA) {
            /* dentro da área: bloqueia, a não ser que a partida já estivesse dentro dela (limiar
               <= 0) e o ponto fique no máximo tão fundo quanto ela */
            if (!dentroArea(L.areas[geo[o]], x, y)) continue;
            if (l > TOL) return BLOQ;
            const f = fundoLocal(L, oi, x, y, TOL - l);
            if (f === Infinity) return BLOQ;
            d = -f;
          }
          else d = sdPonto(L, k, x, y, false);
          if (d < l - TOL) return BLOQ;
          if (d < lm) banda = true;
        }
      }
    }
  }
  if (R.P && !dentroPlaca(R.P, x, y)) {
    if (R.limBorda > TOL) return BLOQ;
    const f = fundoLocal(L, L.oBorda, x, y, TOL - R.limBorda);
    if (f === Infinity) return BLOQ;
    if (-f < R.limBorda + m) banda = true;
  }
  /* a camada EXTRA (ver segLivre): o pior dos dois estados */
  if (R.extra) {
    const e = estadoPonto(R.extra, x, y);
    if (e === BLOQ) return BLOQ;
    if (e === BANDA) banda = true;
  }
  return banda ? BANDA : LIVRE;
}
function estadoNo(ctx, n){
  const E = ctx.B.estado;
  let s = E[n];
  if (s) return s;
  const i = n % ctx.NI, j = (n - i) / ctx.NI;
  s = estadoPonto(ctx, ctx.dx + (i + ctx.iMin) * ctx.res, ctx.dy + (j + ctx.jMin) * ctx.res);
  E[n] = s;
  return s;
}
const xNo = (ctx, n) => ctx.dx + ((n % ctx.NI) + ctx.iMin) * ctx.res;
const yNo = (ctx, n) => ctx.dy + (((n - n % ctx.NI) / ctx.NI) + ctx.jMin) * ctx.res;
/* o passo n -> m (direção d) conferido exato, com o resultado guardado nos dois nós */
function arestaLivre(ctx, n, d, m){
  const B = ctx.B, bit = 1 << d;
  if (B.arSab[n] & bit) return (B.arOk[n] & bit) !== 0;
  const ok = segLivre(ctx, xNo(ctx, n), yNo(ctx, n), xNo(ctx, m), yNo(ctx, m));
  const bitR = 1 << ((d + 4) & 7);
  B.arSab[n] |= bit; B.arSab[m] |= bitR;
  if (ok) { B.arOk[n] |= bit; B.arOk[m] |= bitR; }
  else { B.arOk[n] &= ~bit; B.arOk[m] &= ~bitR; }
  return ok;
}

/* ============================== o A* ============================== */

function heapPush(B, n, f){
  let i = B.hlen++;
  if (i >= B.hn.length) {
    const hn = new Int32Array(B.hn.length * 2); hn.set(B.hn); B.hn = hn;
    const hk = new Float64Array(B.hk.length * 2); hk.set(B.hk); B.hk = hk;
  }
  const hn = B.hn, hk = B.hk;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (hk[p] <= f) break;
    hn[i] = hn[p]; hk[i] = hk[p]; i = p;
  }
  hn[i] = n; hk[i] = f;
}
function heapPop(B){
  const hn = B.hn, hk = B.hk, top = hn[0], n = --B.hlen;
  if (n > 0) {
    const ln = hn[n], lk = hk[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && hk[c + 1] < hk[c]) c++;
      if (hk[c] >= lk) break;
      hn[i] = hn[c]; hk[i] = hk[c]; i = c;
    }
    hn[i] = ln; hk[i] = lk;
  }
  return top;
}
/* A busca: do nó de `de` até o nó-alvo (ou, com `raioAlvo2` > 0, até qualquer nó a essa
   distância ao quadrado de `ate`). Custo: reta 1, diagonal √2, + CURVA a cada troca de direção;
   heurística octil (8 vizinhos) ou Manhattan (4). Devolve o nó em que parou: o alvo, ou o nó
   EXPANDIDO mais perto de `ate`. */
function aEstrela(ctx, alvo, ate, raioAlvo2, orcamento, oito){
  const B = ctx.B, NI = ctx.NI, NJ = ctx.NJ, g = B.g, marca = B.marca, dirIn = B.dirIn;
  let gen = ++B.gen;
  if (gen >= 0x7ffffff0) { marca.fill(0); B.gen = gen = 1; }
  const ABERTO = gen * 2, FECHADO = ABERTO + 1;
  const ti = alvo % NI, tj = (alvo - ti) / NI;
  const res = ctx.res, ax = ate[0], ay = ate[1], x0 = ctx.dx + ctx.iMin * res, y0 = ctx.dy + ctx.jMin * res;
  const passoDir = oito ? 1 : 2, K2 = SQ2 - 2;
  const h = (i, j) => {
    const a = i > ti ? i - ti : ti - i, b = j > tj ? j - tj : tj - j;
    return oito ? (a + b + K2 * (a < b ? a : b)) * 1.0001 : (a + b) * 1.0001;
  };
  B.hlen = 0;
  const s0 = ctx.s0;
  g[s0] = 0; marca[s0] = ABERTO; dirIn[s0] = SEM_DIR;
  heapPush(B, s0, h(s0 % NI, (s0 - s0 % NI) / NI));
  let nos = 0, melhor = s0, melhorD = Infinity, achou = false;
  while (B.hlen > 0) {
    const n = heapPop(B);
    if (marca[n] === FECHADO) continue;
    marca[n] = FECHADO;
    nos++;
    const i = n % NI, j = (n - i) / NI;
    const px = x0 + i * res - ax, py = y0 + j * res - ay, dd = px * px + py * py;
    if (dd < melhorD) { melhorD = dd; melhor = n; }
    if (raioAlvo2 > 0 ? dd <= raioAlvo2 : n === alvo) { achou = true; melhor = n; break; }
    if (nos >= orcamento) break;
    const sn = estadoNo(ctx, n), gn = g[n], din = dirIn[n];
    for (let d = 0; d < 8; d += passoDir) {
      const ii = i + DI[d], jj = j + DJ[d];
      if (ii < 0 || ii >= NI || jj < 0 || jj >= NJ) continue;
      const m = n + DI[d] + DJ[d] * NI;
      if (marca[m] === FECHADO) continue;
      const sm = estadoNo(ctx, m);
      if (sm === BLOQ) continue;
      if ((sn !== LIVRE || sm !== LIVRE) && !arestaLivre(ctx, n, d, m)) continue;
      const ng = gn + ((d & 1) ? SQ2 : 1) + (din !== SEM_DIR && din !== d ? CURVA : 0);
      if (marca[m] !== ABERTO || ng < g[m]) {
        g[m] = ng; dirIn[m] = d; marca[m] = ABERTO;
        heapPush(B, m, ng + h(ii, jj));
      }
    }
  }
  return { achou, fim: melhor, nos, esgotou: !achou && B.hlen === 0 };
}
/* os vértices do caminho até `fim`: a partida, cada nó onde a direção muda e o fim */
function verticesDoCaminho(ctx, fim){
  const B = ctx.B, NI = ctx.NI, V = [];
  let n = fim, dSai = -1, guarda = ctx.NI * ctx.NJ;
  V.push([xNo(ctx, n), yNo(ctx, n)]);
  while (n !== ctx.s0 && guarda-- > 0) {
    const d = B.dirIn[n];
    if (d === SEM_DIR) break;
    if (dSai !== -1 && d !== dSai) V.push([xNo(ctx, n), yNo(ctx, n)]);
    dSai = d;
    n -= DI[d] + DJ[d] * NI;
  }
  if (V.length > 1 || fim !== ctx.s0) V.push([ctx.dx, ctx.dy]);
  V.reverse();
  return V;
}
/* o nó livre mais perto de `ate` em volta do nó-alvo (que está no proibido), até RAIO_ALVO */
function distLivreMaisPerto(ctx, ti, tj, ate){
  const NI = ctx.NI, NJ = ctx.NJ, res = ctx.res, maxR = Math.ceil(RAIO_ALVO / res);
  let melhor = Infinity, achouEm = -1;
  const ve = (i, j) => {
    if (i < 0 || i >= NI || j < 0 || j >= NJ) return;
    const n = j * NI + i;
    if (estadoNo(ctx, n) === BLOQ) return;
    const dx = xNo(ctx, n) - ate[0], dy = yNo(ctx, n) - ate[1], d = dx * dx + dy * dy;
    if (d < melhor) melhor = d;
  };
  for (let r = 1; r <= maxR; r++) {
    if (achouEm >= 0 && r > achouEm + 1) break;
    for (let a = -r; a <= r; a++) { ve(ti + a, tj - r); ve(ti + a, tj + r); }
    for (let b = -r + 1; b <= r - 1; b++) { ve(ti - r, tj + b); ve(ti + r, tj + b); }
    if (achouEm < 0 && melhor < Infinity) achouEm = r;
  }
  return melhor < Infinity ? Math.sqrt(melhor) : -1;
}

/* ============================== o L e a suavização ============================== */

const igual = (a, b) => Math.abs(a[0] - b[0]) <= EPS_ANG && Math.abs(a[1] - b[1]) <= EPS_ANG;
/* o canto do L do HubFio (hub-fio.js » canto), refeito aqui para o motor não depender dele:
   '45' 'diag' = a diagonal sai do ponto e a reta chega no cursor ('orto' o contrário); '90' 'h' =
   sai na horizontal ('v' na vertical); 'livre' = uma perna só */
function canto(A, C, modo, primeiro){
  if (modo === 'livre') return null;
  if (modo === '45') {
    const dx = C[0] - A[0], dy = C[1] - A[1], d = Math.min(Math.abs(dx), Math.abs(dy));
    const dg = [Math.sign(dx) * d, Math.sign(dy) * d];
    return primeiro === 'diag' ? [A[0] + dg[0], A[1] + dg[1]] : [C[0] - dg[0], C[1] - dg[1]];
  }
  return primeiro === 'h' ? [C[0], A[1]] : [A[0], C[1]];
}
/* o L direto do HubFio como lista de pontos (as pernas do HubFio.pernas, perna 1 e perna 2) */
function lDireto(A, C, modo, primeiro){
  if (igual(A, C)) return [[A[0], A[1]]];
  const K = canto(A, C, modo, primeiro);
  if (!K || igual(K, A) || igual(K, C)) return [[A[0], A[1]], [C[0], C[1]]];
  return [[A[0], A[1]], K, [C[0], C[1]]];
}
function caminhoLivre(R, pts){
  for (let k = 0; k + 1 < pts.length; k++) if (!segLivre(R, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1])) return false;
  return true;
}
/* o pedaço inicial livre de uma polilinha (busca binária na perna que bate) e o obstáculo que a
   barra: {s (comprimento livre), bloqueio:{id, net, tipo, x, y}} ou null se ela é toda livre */
function prefixoLivre(R, pts){
  let acum = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const A = pts[k], B = pts[k + 1], len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (segLivre(R, A[0], A[1], B[0], B[1])) { acum += len; continue; }
    const ux = (B[0] - A[0]) / len, uy = (B[1] - A[1]) / len;
    let lo = 0, hi = len;
    for (let it = 0; it < 48 && hi - lo > 1e-7; it++) {
      const mid = (lo + hi) / 2;
      if (segLivre(R, A[0], A[1], A[0] + ux * mid, A[1] + uy * mid)) lo = mid; else hi = mid;
    }
    /* quem viola logo depois do ponto livre: o de menor folga relativa ao seu limiar */
    const ach = conflitosSeg(R, A[0], A[1], A[0] + ux * hi, A[1] + uy * hi, new Map());
    let pior = -1, pv = Infinity;
    for (const [oi, d] of ach) { const v = d - R.lim[oi]; if (v < pv) { pv = v; pior = oi; } }
    const o = pior >= 0 ? R.L.obst[pior] : null;
    return { s: acum + lo, bloqueio: o ? { id: o.id, net: o.net, tipo: o.tipo, x: A[0] + ux * lo, y: A[1] + uy * lo } : null };
  }
  return null;
}
/* os pontos da polilinha até o comprimento s */
function corta(pts, s){
  const out = [[pts[0][0], pts[0][1]]];
  let resta = s;
  for (let k = 0; k + 1 < pts.length; k++) {
    const A = pts[k], B = pts[k + 1], len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (resta >= len - EPS_PT) { out.push([B[0], B[1]]); resta -= len; continue; }
    if (resta > EPS_PT) out.push([A[0] + (B[0] - A[0]) * resta / len, A[1] + (B[1] - A[1]) * resta / len]);
    break;
  }
  return out;
}
/* liga A a B com as formas que o modo deixa, toda perna conferida exata: [] = reta, [K] = um
   cotovelo, null = não liga. 45°: reta se já é 0/45/90, senão diagonal + reta nas duas ordens
   (primeiro a da mão); 90°: reta se é horizontal/vertical, senão o L nas duas ordens; livre: reta. */
function conecta(R, A, B, modo, primeiro){
  const dx = B[0] - A[0], dy = B[1] - A[1], adx = Math.abs(dx), ady = Math.abs(dy);
  if (modo === 'livre') return segLivre(R, A[0], A[1], B[0], B[1]) ? [] : null;
  if (adx <= EPS_ANG || ady <= EPS_ANG || (modo === '45' && Math.abs(adx - ady) <= EPS_ANG))
    return segLivre(R, A[0], A[1], B[0], B[1]) ? [] : null;
  let K1, K2;
  if (modo === '45') {
    const d = Math.min(adx, ady), sx = Math.sign(dx) * d, sy = Math.sign(dy) * d;
    const Kd = [A[0] + sx, A[1] + sy], Ko = [B[0] - sx, B[1] - sy];
    if (primeiro === 'diag') { K1 = Kd; K2 = Ko; } else { K1 = Ko; K2 = Kd; }
  } else {
    const Kh = [B[0], A[1]], Kv = [A[0], B[1]];
    if (primeiro === 'h') { K1 = Kh; K2 = Kv; } else { K1 = Kv; K2 = Kh; }
  }
  if (segLivre(R, A[0], A[1], K1[0], K1[1]) && segLivre(R, K1[0], K1[1], B[0], B[1])) return [K1];
  if (segLivre(R, A[0], A[1], K2[0], K2[1]) && segLivre(R, K2[0], K2[1], B[0], B[1])) return [K2];
  return null;
}
/* A SUAVIZAÇÃO, a cara do Altium: do vértice atual, o vértice MAIS DISTANTE que se alcança com
   uma forma permitida (toda perna exata). O passo cru do A* entre dois vértices seguidos é sempre
   aceito — ele é livre por construção —, menos a perna final até `ate`, que não é da grade. */
function suaviza(R, V, ultimaCrua, modo, primeiro){
  const out = [[V[0][0], V[0][1]]], n = V.length;
  let i = 0;
  while (i < n - 1) {
    let foi = false;
    for (let j = n - 1; j > i; j--) {
      if (j === i + 1 && (j < n - 1 || ultimaCrua)) { out.push([V[j][0], V[j][1]]); i = j; foi = true; break; }
      const K = conecta(R, V[i], V[j], modo, primeiro);
      if (K) { for (const p of K) out.push([p[0], p[1]]); out.push([V[j][0], V[j][1]]); i = j; foi = true; break; }
    }
    if (!foi) break;
  }
  return { pts: out, chegou: i === n - 1 };
}
/* OS DEGRAUS. A grade do A* nasce na partida, e o cursor (na grade de 5 mil da tela, ou no centro
   de um pad) quase nunca cai num nó dela: o encaixe da última perna, e o de um canto no meio da
   rota, saíam com um "degrau" de 0,001 a 0,1 mm que ninguém desenharia — 1 rota de contorno em 4
   no DMB, e cada degrau é um track_add a mais no changes.js. Uma perna mais curta que DEGRAU passos
   da grade sai deslizando uma vizinha sobre a própria reta, SEM mudar a direção de perna nenhuma
   (os ângulos do modo continuam valendo), com as pernas novas conferidas exatas:
     M  as duas vizinhas se encontram direto: o canto vira a interseção delas;
     P  a perna de antes anda paralela a si mesma até terminar onde o degrau terminava;
     N  a de depois anda paralela até começar onde o degrau começava;
     S  um dos dois vértices sai, se a reta que sobra é um ângulo do modo.
   A partida e o fim nunca andam, e cada troca tira um vértice: o laço acaba sozinho. */
const DEGRAU = 1.25;
function encontro(A, u, B, v){
  const cr = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(cr) <= 1e-12 * Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1])) return null;
  const wx = B[0] - A[0], wy = B[1] - A[1];
  const s = (wx * v[1] - wy * v[0]) / cr, t = (wx * u[1] - wy * u[0]) / cr;
  return { s, t, X: [A[0] + s * u[0], A[1] + s * u[1]] };
}
function anguloDoModo(A, B, modo){
  if (modo === 'livre') return true;
  const dx = Math.abs(B[0] - A[0]), dy = Math.abs(B[1] - A[1]);
  return dx <= EPS_ANG || dy <= EPS_ANG || (modo === '45' && Math.abs(dx - dy) <= EPS_ANG);
}
function tiraDegraus(R, pts, modo, lim){
  let P = pts.map(p => [p[0], p[1]]);
  const dir = (a, b) => [b[0] - a[0], b[1] - a[1]];
  const livre = (a, b) => segLivre(R, a[0], a[1], b[0], b[1]);
  /* uma troca so mexe na vizinhança: a varredura segue dali (dois vértices antes), e não do começo
     — numa escada de centenas de degraus, recomeçar a cada troca seria quadrático */
  let mudou = true;
  for (let passada = 0; mudou && passada < 4; passada++) {
    mudou = false;
    for (let k = 0; k + 1 < P.length; k++) {
      if (Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]) >= lim) continue;
      const m = P.length - 1;
      let novo = null;
      /* M: a perna de antes (k-1 -> k) e a de depois (k+1 -> k+2) se encontram */
      if (k >= 1 && k + 2 <= m) {
        const e = encontro(P[k - 1], dir(P[k - 1], P[k]), P[k + 2], dir(P[k + 1], P[k + 2]));
        if (e && e.s > EPS_PT && e.t < -EPS_PT && livre(P[k - 1], e.X) && livre(e.X, P[k + 2]))
          novo = P.slice(0, k).concat([e.X], P.slice(k + 2));
      }
      /* P: a perna de antes anda paralela, deslizando sobre a anterior a ela (k-2 -> k-1) */
      if (!novo && k >= 2) {
        const e = encontro(P[k - 2], dir(P[k - 2], P[k - 1]), P[k + 1], dir(P[k - 1], P[k]));
        if (e && e.s > EPS_PT && e.t < -EPS_PT && livre(P[k - 2], e.X) && livre(e.X, P[k + 1]))
          novo = P.slice(0, k - 1).concat([e.X], P.slice(k + 1));
      }
      /* N: a perna de depois anda paralela, deslizando sobre a seguinte a ela (k+2 -> k+3) */
      if (!novo && k + 3 <= m) {
        const e = encontro(P[k], dir(P[k + 1], P[k + 2]), P[k + 3], dir(P[k + 2], P[k + 3]));
        if (e && e.s > EPS_PT && e.t < -EPS_PT && livre(P[k], e.X) && livre(e.X, P[k + 3]))
          novo = P.slice(0, k + 1).concat([e.X], P.slice(k + 3));
      }
      /* S: sai um dos vértices do degrau */
      if (!novo && k >= 1 && anguloDoModo(P[k - 1], P[k + 1], modo) && livre(P[k - 1], P[k + 1]))
        novo = P.slice(0, k).concat(P.slice(k + 1));
      if (!novo && k + 2 <= m && anguloDoModo(P[k], P[k + 2], modo) && livre(P[k], P[k + 2]))
        novo = P.slice(0, k + 1).concat(P.slice(k + 2));
      if (novo) { P = limpa(novo); mudou = true; k = Math.max(-1, k - 3); }
    }
  }
  return P;
}
/* sem ponto repetido e sem vértice no meio de uma reta que SEGUE em frente (o HubFio.limpa, com a
   tolerância do desvio, não do produto vetorial: juntar só o que fica a 1e-9 mm da reta) */
function limpa(pts){
  const out = [];
  for (const p of pts) {
    const u = out[out.length - 1];
    if (!u || Math.abs(u[0] - p[0]) > EPS_PT || Math.abs(u[1] - p[1]) > EPS_PT) out.push([p[0], p[1]]);
  }
  for (let i = 1; i < out.length - 1;) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const cruz = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const segue = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) > 0;
    if (segue && Math.abs(cruz) <= EPS_PT * Math.hypot(c[0] - a[0], c[1] - a[1])) out.splice(i, 1); else i++;
  }
  return out;
}

/* ============================== API: a rota ============================== */

/* A ROTA da trilha na mão, do último ponto fixado (`de`) até o cursor (`ate`):
     1. 'ignorar': o L do HubFio, sem conferir nada;
     2. o L direto, conferido exato: livre -> ele mesmo ('livre'). Em área livre o comportamento
        é o de sempre, inclusive o canto que o Espaço escolheu;
     3. 'parar': o maior pedaço inicial livre do L, arredondado para baixo no passo da grade;
     4. 'contornar': A* na grade ancorada em `de`, a suavização e a retirada dos degraus (ver
        tiraDegraus); sem caminho, até o nó expandido mais perto do cursor. A rota volta com
        pts[0] = `de`, sem ponto repetido nem colinear.
   A net efetiva é `req.net`, ou — sem ela — a do alvo elétrico (a trilha sem net que chega num
   pad adota a net dele). Pad/via/ponta de OUTRA net no alvo é obstáculo: a rota para antes.
   req = {layer, w, net, de:[x,y], ate:[x,y], alvo:{eletrico, net}, modo:'45'|'90'|'livre',
          primeiro (o do HubFio), conflito:'contornar'|'parar'|'ignorar', ignora, orcamento}
   ->   {pts, completa, motivo:'livre'|'contorno'|'bloqueado'|'sem-caminho'|'orcamento'|'ignorado'|
                                'camada-proibida' (a Routing Layers da net não deixa),
         bloqueio:{id, net, tipo, x, y} (o 1o obstáculo do L direto; x,y = o ponto do L em que ele
         passa a encostar) | null, nos (expandidos pelo A*), ms,
         violacoes:[conflito] — o que o caminho leva abaixo da folga da regra por causa da partida
         que já estava em conflito (a regra de não piorar); [] = limpo para o DRC} */
function rota(cena, req){
  const t0 = agora(), r = req || {};
  const de = [Number(r.de && r.de[0]), Number(r.de && r.de[1])], ate = [Number(r.ate && r.ate[0]), Number(r.ate && r.ate[1])];
  const modo = r.modo === '45' || r.modo === 'livre' ? r.modo : '90';
  const primeiro = r.primeiro || (modo === '45' ? 'diag' : 'v');
  const conflito = r.conflito === 'parar' || r.conflito === 'ignorar' ? r.conflito : 'contornar';
  const fim = o => { o.nos = o.nos || 0; o.ms = agora() - t0; if (!o.violacoes) o.violacoes = []; return o; };
  if (![de[0], de[1], ate[0], ate[1]].every(isNum)) return fim({ pts: [], completa: false, motivo: 'sem-caminho', bloqueio: null });
  const L0 = limpa(lDireto(de, ate, modo, primeiro));
  if (conflito === 'ignorar') return fim({ pts: L0, completa: true, motivo: 'ignorado', bloqueio: null });
  if (!ehCobre(r.layer)) return fim({ pts: L0, completa: true, motivo: 'livre', bloqueio: null });

  const alvo = r.alvo || {};
  const net = (typeof r.net === 'string' && r.net) ? r.net : (alvo.eletrico && typeof alvo.net === 'string' ? alvo.net : '');
  /* Routing Layers: a camada que a regra da net não permite não recebe trilha (o Altium nem deixa
     começar a rota nela) */
  if (!camadaPermitida(cena, net, r.layer)) return fim({ pts: [[de[0], de[1]]], completa: false, motivo: 'camada-proibida', bloqueio: null });
  const w = r.w > 0 ? r.w : larguraDaRegra(cena, net, r.layer).pref;
  const ig = conjunto(r.ignora), L = camada(cena, r.layer), N = idDaNet(cena, net, false);
  const isentos = alvo.eletrico ? isentosChegada(cena, L, N, ig, ate) : [];
  const ctx = contexto(cena, L, r.layer, N, w, de, ig, isentos, net);

  if (caminhoLivre(ctx, L0)) return fim({ pts: L0, completa: true, motivo: 'livre', bloqueio: null, violacoes: violacoesHerdadas(cena, ctx, L0) });
  const pre = prefixoLivre(ctx, L0);
  const bloqueio = pre ? pre.bloqueio : null;
  if (conflito === 'parar') {
    const s = pre ? Math.floor(pre.s / ctx.res + 1e-9) * ctx.res : 0;
    const pp = limpa(corta(L0, Math.min(s, pre ? pre.s : 0)));
    return fim({ pts: pp, completa: false, motivo: 'bloqueado', bloqueio, violacoes: violacoesHerdadas(cena, ctx, pp) });
  }

  /* contornar. A partida muito longe da placa (a grade iria dela até a placa inteira) não tem
     grade: fica o pedaço livre do L, como no 'parar' */
  const orc = r.orcamento > 0 ? r.orcamento : ORCAMENTO, oito = modo !== '90', NI = ctx.NI, NJ = ctx.NJ;
  const normal = (Math.ceil((cena.bbox.x2 - cena.bbox.x1) / ctx.res) + 1) * (Math.ceil((cena.bbox.y2 - cena.bbox.y1) / ctx.res) + 1);
  if (NI * NJ > normal * 1.25 + 1e5)
    { const pp = limpa(corta(L0, pre ? pre.s : 0)); return fim({ pts: pp, completa: false, motivo: 'sem-caminho', bloqueio, violacoes: violacoesHerdadas(cena, ctx, pp) }); }
  posse(ctx);
  let ti = Math.round((ate[0] - de[0]) / ctx.res) - ctx.iMin, tj = Math.round((ate[1] - de[1]) / ctx.res) - ctx.jMin;
  ti = ti < 0 ? 0 : ti >= NI ? NI - 1 : ti; tj = tj < 0 ? 0 : tj >= NJ ? NJ - 1 : tj;
  const alvoNo = tj * NI + ti;
  /* o cursor no proibido (em cima de outra net, encostado nela): mira o lugar livre mais perto
     dele. Empatados (o cursor no meio de uma trilha, os dois lados à mesma distância), a busca
     chega primeiro no mais barato — o lado de onde a trilha vem. */
  let raio2 = 0, desviado = false;
  if (alvoNo !== ctx.s0 && estadoNo(ctx, alvoNo) === BLOQ) {
    desviado = true;
    const dl = distLivreMaisPerto(ctx, ti, tj, ate);
    if (dl >= 0) { const rr = dl + 1e-6; raio2 = rr * rr; }
  }
  const b = aEstrela(ctx, alvoNo, ate, raio2, orc, oito);
  const V = verticesDoCaminho(ctx, b.fim);
  const chegouNo = b.achou && !desviado;
  /* a perna do último nó até `ate` não é da grade: entra conferida (só o ruído de float é trocado) */
  let ultimaCrua = true;
  if (chegouNo) {
    const u = V[V.length - 1];
    if (Math.abs(u[0] - ate[0]) <= EPS_PT && Math.abs(u[1] - ate[1]) <= EPS_PT) V[V.length - 1] = [ate[0], ate[1]];
    else { V.push([ate[0], ate[1]]); ultimaCrua = false; }
  }
  const sv = V.length > 1 ? suaviza(ctx, V, ultimaCrua, modo, primeiro) : { pts: [V[0]], chegou: true };
  const pts = limpa(tiraDegraus(ctx, limpa(sv.pts), modo, DEGRAU * ctx.res));
  const completa = chegouNo && sv.chegou;
  const motivo = completa ? 'contorno' : (b.achou || b.esgotou ? 'sem-caminho' : (b.nos >= orc ? 'orcamento' : 'sem-caminho'));
  return fim({ pts, completa, motivo, bloqueio, nos: b.nos, violacoes: violacoesHerdadas(cena, ctx, pts) });
}
/* O QUE A ROTA LEVA DE VIOLAÇÃO PELA REGRA DE NÃO PIORAR: a partida que já estava perto demais de
   outro cobre (o pad de passo fino com a largura da regra que não cabe entre os vizinhos, a ponta
   antiga encostada em outra net) sai à mesma distância — a rota não piora, mas também não fica
   dentro da regra, e o DRC acusa. A lista é a dos obstáculos que o caminho deixa abaixo da folga
   da regra, conferida SEM o alívio da partida: [] = a rota é limpa para o DRC. */
function violacoesHerdadas(cena, ctx, pts){
  if (!ctx || !pts || pts.length < 2) return [];
  /* a mesma regra do contexto (quem bloqueia já tem o ignora e as isenções da partida e da
     chegada), com os limites de antes do alívio */
  const R = regraBase(cena, ctx.L, ctx.N, null, ctx.w / 2, descMao('track', ctx.netNome || '', ctx.layer));
  let relaxou = false;
  for (let i = 0; i < R.lim.length; i++) {
    R.bloq[i] = ctx.bloq[i];
    if (ctx.lim[i] < R.lim[i] - TOL) relaxou = true;
  }
  if (ctx.limBorda < R.limBorda - TOL) relaxou = true;
  if (!relaxou) return [];
  const ach = new Map();
  for (let k = 1; k < pts.length; k++) conflitosSeg(R, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1], ach);
  return listaConflitos(ctx.L, ach, ctx.w / 2, null, R).sort(porDist);
}

/* ============================== API: o que a regra pede para a mão ============================== */

/* O "Rule Preferred" do Altium (Preferences » Interactive Routing » Track Width / Via Size Mode):
   a largura e a via de uma rota nova saem da regra Width / Routing Via Style VENCEDORA para a net
   (e a camada) que se roteia, e não de um valor da placa inteira. Sem conjunto de regras na cena,
   o board.rules do espelho. Devolvem também a regra, para quem quer mostrar de onde veio. */
function larguraDaRegra(cena, net, layer){
  const R = cena && cena.regras, eb = (cena && cena.eb) || {};
  const r = R ? R.regraPara('Width', descMao('track', net, layer)) : null;
  if (r) {
    const pc = (r.porCamada && r.porCamada[layer]) || {};
    const mn = isNum(pc.min) ? pc.min : r.min, mx = isNum(pc.max) ? pc.max : r.max;
    let p = isNum(pc.pref) ? pc.pref : (isNum(r.pref) ? r.pref : mn);
    if (isNum(mn) && p < mn) p = mn;
    if (isNum(mx) && p > mx) p = mx;
    if (p > 0) return { pref: p, min: isNum(mn) ? mn : null, max: isNum(mx) ? mx : null, regra: r.name };
  }
  const w = eb.rules && eb.rules.width > 0 ? eb.rules.width : LARGURA_PADRAO;
  return { pref: w, min: null, max: null, regra: null };
}
function viaDaRegra(cena, net){
  const R = cena && cena.regras, eb = (cena && cena.eb) || {};
  const r = R ? R.regraPara('RoutingVias', descMao('via', net)) : null;
  if (r && r.pref > 0) {
    const size = r.pref, drill = r.holePref > 0 && r.holePref < size ? r.holePref : size / 2;
    return { size, drill, min: r.min, max: r.max, holeMin: r.holeMin, holeMax: r.holeMax, regra: r.name };
  }
  const rr = eb.rules || {};
  const size = rr.viaSize > 0 ? rr.viaSize : 0.6, drill = rr.viaDrill > 0 && rr.viaDrill < size ? rr.viaDrill : Math.min(0.3, size / 2);
  return { size, drill, regra: null };
}
/* a largura / via que o usuário escolheu, presa à faixa da regra da net (o Altium não deixa a rota
   sair da faixa da Width / Routing Via Style: o valor digitado fora dela vira o limite) */
function limitaLargura(cena, net, layer, w){
  const r = larguraDaRegra(cena, net, layer);
  let v = w > 0 ? w : r.pref;
  if (isNum(r.min) && v < r.min) v = r.min;
  if (isNum(r.max) && v > r.max) v = r.max;
  return { w: v, ajustada: Math.abs(v - (w > 0 ? w : r.pref)) > 1e-9, regra: r.regra, min: r.min, max: r.max };
}
function limitaVia(cena, net, size, drill){
  const r = viaDaRegra(cena, net);
  let s = size > 0 ? size : r.size, d = drill > 0 ? drill : r.drill;
  if (isNum(r.min) && s < r.min) s = r.min;
  if (isNum(r.max) && s > r.max) s = r.max;
  if (isNum(r.holeMin) && d < r.holeMin) d = r.holeMin;
  if (isNum(r.holeMax) && d > r.holeMax) d = r.holeMax;
  /* presa nas pontas, a via pode ficar sem anel (o padrão da casa tem diâmetro e furo mínimos
     iguais, 0,1 mm): mantém o anel da via preferida da regra, crescendo o diâmetro ou, no teto,
     encolhendo o furo */
  if (d >= s) {
    const anel = r.size > r.drill ? r.size - r.drill : 0.2;
    s = isNum(r.max) ? Math.min(r.max, d + anel) : d + anel;
    if (d >= s) d = Math.max(isNum(r.holeMin) ? r.holeMin : 0, s - anel);
  }
  const ajustada = Math.abs(s - (size > 0 ? size : r.size)) > 1e-9 || Math.abs(d - (drill > 0 ? drill : r.drill)) > 1e-9;
  return { size: s, drill: d, ajustada, regra: r.regra };
}
function camadaPermitida(cena, net, layer){
  const R = cena && cena.regras;
  if (!R || !ehCobre(layer)) return true;
  const r = R.regraPara('RoutingLayers', descMao('track', net, layer));
  return !(r && r.layers && r.layers[layer] === false);
}

/* ============================== API: a cena ============================== */

/* o hub-pcbregras.js: global no navegador, require no Node; sem ele a cena fica na folga única */
function moduloRegras(){
  if (typeof HubPcbRegras !== 'undefined' && HubPcbRegras && typeof HubPcbRegras.resolvedor === 'function') return HubPcbRegras;
  try { if (typeof require === 'function') return require('./hub-pcbregras.js'); } catch (e) { /* sem o módulo */ }
  return null;
}

/* A CENA: o EB e as opções, com o índice de cada camada montado só na primeira consulta dela.
   É descartável — o EB mudou, cena nova.
   opts.regras = o conjunto de regras do projeto (HubPcbRegras: o rules.js lido, ou o doBoard) ou um
   resolvedor já montado. Com ele, cada par (mão, obstáculo) tem a folga da Clearance vencedora com
   a matriz de objetos, o contorno a da Board Outline Clearance, e a largura/via/camada da rota
   saem das regras Width / Routing Via Style / Routing Layers — as MESMAS que o DRC confere. Sem
   ele, a folga única (opts.clearance, ou board.rules.clearance, ou 10 mil) vale para tudo, como
   antes. */
function cena(eb, opts){
  const E = eb || {}, o = opts || {}, regras = (E.rules && typeof E.rules === 'object') ? E.rules : {};
  let RES = null, RG = null;
  if (o.regras && typeof o.regras === 'object') {
    RG = moduloRegras();
    if (RG) RES = typeof o.regras.regraPara === 'function' ? o.regras : RG.resolvedor(o.regras.rules ? o.regras : RG.normaliza(o.regras), { board: E });
  }
  /* a folga "da placa" (a Clearance de escopo All x All): é a que a tela mostra e a que vale para
     obstáculo sem descritor */
  let clearance = isNum(o.clearance) && o.clearance >= 0 ? o.clearance
                : (isNum(regras.clearance) && regras.clearance > 0 ? regras.clearance : FOLGA_PADRAO);
  if (RES && !(isNum(o.clearance) && o.clearance >= 0)) {
    const g = RG.folgaEntre(RES, descMao('track', '\u0001a', 'Top'), descMao('track', '\u0001b', 'Top'));
    if (g && isNum(g.gap) && g.gap > 0) clearance = g.gap;
  }
  const bd = (E.board && typeof E.board === 'object') ? E.board : {}, bb0 = bd.bbox;
  const temBB = bb0 && [bb0.x1, bb0.y1, bb0.x2, bb0.y2].every(isNum) && bb0.x2 > bb0.x1 && bb0.y2 > bb0.y1;
  /* a placa: os laços do contorno (sem eles, o bbox como retângulo) e os furos de verdade */
  let lacos = [];
  if (o.placa && Array.isArray(o.placa.lacos)) lacos = o.placa.lacos.map(l => limpaAnel(l)).filter(Boolean);
  if (!lacos.length && temBB) lacos = [[[bb0.x1, bb0.y1], [bb0.x2, bb0.y1], [bb0.x2, bb0.y2], [bb0.x1, bb0.y2]]];
  const recortes = [];
  for (const k of (o.placa && Array.isArray(o.placa.recortes)) ? o.placa.recortes : []) {
    const pts = limpaAnel(Array.isArray(k) ? k : (k && k.pts));
    if (pts) recortes.push({ pts, id: (k && !Array.isArray(k) && k.o && k.o.id != null) ? String(k.o.id) : (k && k.id != null ? String(k.id) : null) });
  }
  let placa = null;
  if (lacos.length) {
    placa = { aneis: lacos.map(l => novoAnel(l, false)), x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const A of placa.aneis) { placa.x0 = Math.min(placa.x0, A.x0); placa.y0 = Math.min(placa.y0, A.y0); placa.x1 = Math.max(placa.x1, A.x1); placa.y1 = Math.max(placa.y1, A.y1); }
  }
  /* a caixa da grade: a da placa (+2 mm); sem placa nenhuma, a dos objetos */
  let x1, y1, x2, y2;
  if (placa) { x1 = placa.x0; y1 = placa.y0; x2 = placa.x1; y2 = placa.y1; }
  else {
    x1 = y1 = Infinity; x2 = y2 = -Infinity;
    const pt = (x, y) => { if (isNum(x) && isNum(y)) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y); } };
    for (const t of E.tracks || []) if (t) { pt(t.x1, t.y1); pt(t.x2, t.y2); }
    for (const a of E.arcs || []) if (a && a.r > 0) { pt(a.cx - a.r, a.cy - a.r); pt(a.cx + a.r, a.cy + a.r); }
    for (const v of E.vias || []) if (v) pt(v.x, v.y);
    for (const c of E.components || []) for (const p of (c && c.pads) || []) if (p) pt(p.x, p.y);
    for (const p of E.freepads || []) if (p) pt(p.x, p.y);
    for (const f of E.fills || []) if (f) { pt(f.x1, f.y1); pt(f.x2, f.y2); }
    for (const g of E.regions || []) for (const q of (g && g.points) || []) if (q) pt(q[0], q[1]);
    if (!(x1 <= x2)) { x1 = y1 = 0; x2 = y2 = 10; }
  }
  const bbox = { x1: x1 - MARGEM, y1: y1 - MARGEM, x2: x2 + MARGEM, y2: y2 + MARGEM };
  const W = bbox.x2 - bbox.x1, H = bbox.y2 - bbox.y1;
  const res = isNum(o.res) && o.res > 0 ? o.res : Math.max(RES_MIN, Math.sqrt(W * H / MAX_NOS));
  /* as camadas de cobre da placa (a via atravessa todas): Top e Bottom sempre, e as internas que
     têm objeto ou estão na pilha */
  const cam = new Set(['Top', 'Bottom']);
  for (const l of Array.isArray(E.layers) ? E.layers : []) if (l && ehCobre(l.key)) cam.add(l.key);
  for (const k of ['tracks', 'arcs', 'fills', 'regions', 'texts']) for (const x of E[k] || []) if (x && ehCobre(x.layer)) cam.add(x.layer);
  for (const c of E.components || []) for (const p of (c && c.pads) || []) if (p && ehCobre(p.layer)) cam.add(p.layer);
  for (const p of E.freepads || []) if (p && ehCobre(p.layer)) cam.add(p.layer);
  const ordem = k => k === 'Top' ? 0 : k === 'Bottom' ? 1000 : /^Mid/.test(k) ? parseInt(k.slice(3), 10) : 100 + parseInt(k.slice(5), 10);
  return { eb: E, clearance, res, bbox, placa, recortes, textoGeo: typeof o.textoGeo === 'function' ? o.textoGeo : null,
           regras: RES, RG, camadas: [...cam].sort((a, b) => ordem(a) - ordem(b)),
           _camadas: new Map(), _nets: new Map(), _ctx: null };
}

/* O MOTOR POR DENTRO (2026-10-28): as peças com que se monta outro roteador em cima destas mesmas
   contas exatas e destas mesmas regras — o hub-autoroteador.js (várias camadas, vias, lote com
   arranca-e-refaz). É acréscimo: nada aqui muda o que a API de cima faz.
     camada(cena, layer)             o índice da camada (montado na primeira consulta)
     montaExtra(cena, layer, objs)   o índice do cobre posto pelo lote (ver montaExtra)
     regraBase(cena, L, N, ig, meia, mao)  a regra de uma consulta: quem bloqueia (bloq) e a que
                                     distância do eixo (lim); `mao` = descMao(tipo, net, layer)
     idDaNet(cena, net, cria)        o número da net no índice (monte as camadas antes)
     estadoPonto(R, x, y)            LIVRE | BANDA | BLOQ, com a margem R.m (0 = o ponto exato)
     segLivre(R, ax, ay, bx, by)     o segmento é livre pela regra, exato
     conflitosSeg / conflitosPonto(R, ..., achados)  Map obstáculo -> distância com sinal
     suaviza / tiraDegraus / limpa   a suavização da rota (as mesmas da rota da mão)
     caixaDaForma / formaLado / centroCobre / sdPontoCaixa / cosSen  as formas de pad do Gerber
     dentroObst(L, oi, x, y)         o ponto está DENTRO da área (região, polígono despejado) do
                                     obstáculo? (2026-10-29: o custo de atravessar um plano) */
function dentroObst(L, oi, x, y){
  for (let p = L.oIni[oi], pf = L.oIni[oi + 1]; p < pf; p++) {
    const k = L.oPrim[p];
    if (L.kind[k] === K_AREA && dentroArea(L.areas[L.geo[k * G]], x, y)) return true;
  }
  return false;
}
const motor = { camada, montaExtra, regraBase, descMao, idDaNet, conjunto, estadoPonto, segLivre, conflitosSeg, conflitosPonto,
                listaConflitos, suaviza, tiraDegraus, limpa, sdObst, cadaPrim, caixaDaForma, formaLado, centroCobre, sdPontoCaixa, dentroObst,
                cosSen, ehCobre, LIVRE, BANDA, BLOQ, CURVA, DEGRAU, TOL, SQ2, EPS_PT };

return { cena, netEm, folgaTrilha, folgaArco, folgaVia, rota, canto, larguraDaRegra, viaDaRegra, limitaLargura, limitaVia, camadaPermitida, FOLGA_PADRAO, TOL, motor };
})();
if (typeof module === 'object' && module.exports) module.exports = HubRoteador;
