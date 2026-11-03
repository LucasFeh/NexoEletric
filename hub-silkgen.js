/* AltiumPCBMirror v2 - hub-silkgen.js
   Imagem ou texto -> serigrafia, como GEOMETRIA PURA: sem canvas, sem DOM. A saida sao linhas
   region_add (com holes: o miolo do "o", do "e", o furo de um logo) na TopOverlay/BottomOverlay,
   ja conferidas com as mesmas contas do motor (HubCore.regiaoErro e HubCore.furosErro). Usado pela
   vista PCB (pcbframe.js) e pelo MCP (serigrafia_imagem, serigrafia_texto).

   O caminho da imagem:
     mascaraDeRGBA(rgba, w, h, opts)  -> {w, h, m: Uint8Array (1 = tinta), n}
         a luminancia (0,299 R + 0,587 G + 0,114 B) abaixo do `limiar` (padrao 128) e tinta;
         `inverter` troca; com `alfa` (padrao true) o pixel transparente (alfa < `limiarAlfa`,
         padrao 128) nunca e tinta, nem invertido (o fundo de um logo PNG).
     contornos(mascara, opts)         -> [{pts, holes, nivel}] em PIXELS (x para a direita, Y PARA
         BAIXO). O pixel (i, j) ocupa [i, i+1] x [j, j+1]; as amostras sao os centros dos pixels e o
         marching squares corta a iso 0,5 no meio do caminho entre dois centros, isto e, nas bordas
         dos pixels (o canto da escada sai chanfrado a 45 graus). Na sela (dois pixels de tinta so
         pela diagonal) a regra e sempre a mesma -- `diagonal:'separa'` (padrao: a tinta nao se liga
         pela quina) ou 'liga' --, entao dois contornos nunca se encostam nem se cruzam. Pontos
         colineares saem. Classificacao pelo aninhamento: profundidade par = contorno de fora,
         impar = furo do pai; a ilha dentro de um furo vira outro poligono. Anel com area menor que
         `areaMin` (px^2, padrao 1: o pixel solto, que e um losango de 0,5) sai.
     paraPlaca(polys, opts)           -> [{pts, holes}] em mm, Y PARA CIMA (o contrato da PCB).
         opts: x, y (onde fica o CENTRO da caixa da tinta, mm); largura OU altura (mm, da caixa da
         tinta; o outro lado segue a proporcao) OU escala (mm por pixel); caixaPx {x1,y1,x2,y2}
         (a caixa de referencia em pixels no lugar da tinta, ex. a imagem inteira {0,0,w,h});
         espelhar (o X local, para a BottomOverlay: lido por baixo); rot (graus, anti-horario, em
         volta do centro; o espelho vem antes do giro, como o texto do HubGerber); simplificar
         (tolerancia do Ramer-Douglas-Peucker, mm, padrao 0,02; no minimo `pixel` x a escala, padrao
         0,5 pixel, que tira a escada dos pixels; pixel:0 e simplificar:0 = sem). Poligono que a simplificacao
         estraga (anel que cruza a si ou a outro, furo que sai) e refeito com a metade da
         tolerancia, ate sem simplificar; anel pequeno demais para a tolerancia fica sem
         simplificar. O array devolvido leva .info = {escala, caixa, refeitos, descartadas}.

   O caminho do texto:
     textoComFonte(font, texto, opts) -> [{pts, holes}] em mm, Y para cima, de uma Font do
         opentype.js (vendor/opentype.min.js). opts: h = ALTURA DA MAIUSCULA em mm (o "H": o
         sCapHeight da OS/2, senao a caixa do glifo "H") -- a mesma ideia do h do texto stroke do
         hub; hRef:'em' faz o h ser o corpo (em) da fonte; x, y = onde fica a caixa da tinta:
         `alinha` 'esquerda' (x = borda esquerda), 'centro' (padrao, x = meio) ou 'direita'
         (x = borda direita); y = meio da caixa da tinta, ou a linha de base da 1a linha com
         ancora:'base'; espelhar, rot como no paraPlaca; tolerancia (mm, padrao h/200, minimo
         0,002) para achatar as curvas; kerning (padrao true); entrelinha (multiplo de h; padrao
         a da fonte). "\n" quebra linha. As fontes misturam as convencoes de sentido (TrueType
         horario, CFF anti-horario, fonte quebrada qualquer um), entao a classificacao e pelo
         aninhamento, como no contornos; com o ClipperLib (hub-clipper.js) ainda se faz a uniao
         NonZero, que junta glifos que se sobrepoem (ligadura, italico) sem criar furo falso.
         O array leva .info = {faltam (caracteres sem glifo), escala, caixa}.

   A saida:
     opsDe(polys, opts) -> {ops, descartadas, avisos, area_mm2, caixa, vertices, furos, finos, vaos}
         ops = [{op:'region_add', layer, pts, holes?, note}] com os numeros em `casas` decimais
         (padrao 4); cada op passa no HubCore.regiaoErro + HubCore.furosErro (o motor; sem ele, as
         contas daqui), quem nao passa vai para descartadas com o motivo. opts: layer
         ('TopOverlay' padrao), note, larguraMin (mm, padrao 0,15, o traco minimo da serigrafia da
         casa: com o ClipperLib, a abertura morfologica acha os tracos mais finos que isso e o
         fechamento os vaos; sem ele, a largura media 2*area/perimetro), maxVertices (padrao 20000:
         acima disso nada sai -- o motor confere cada region_add a cada recalculo da placa, e um
         anel de n vertices custa n^2), maxPorAnel (padrao 3000, so aviso), casas (4 a 6).
         As ops saem na ordem do aninhamento (o pai antes da ilha dentro do furo dele): no Gerber a
         region com furo e escrita escura e o furo em LPC, e o LPC apaga o que veio antes.
   Atalhos: daImagem(rgba, w, h, opts) e daTexto(font, texto, opts) fazem o caminho inteiro e
   devolvem o opsDe + {polys, escala, ...}.

   Dependencias opcionais (sem elas tudo funciona, com contas proprias): HubCore (hub-core.js) e
   ClipperLib (hub-clipper.js), pelos opts (opts.HubCore, opts.ClipperLib), pelo global do
   navegador ou pelo require do Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HubSilkGen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const GLOBAL = typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : {});
const isNum = v => typeof v === 'number' && isFinite(v);

/* modulo opcional: o do opts, o global do navegador ou o require do Node (null se nao ha) */
const cacheDep = {};
function dep(opts, chave, global, arquivo) {
  if (opts && opts[chave]) return opts[chave];
  if (GLOBAL[global]) return GLOBAL[global];
  if (chave in cacheDep) return cacheDep[chave];
  let m = null;
  if (typeof require === 'function') { try { m = require(arquivo); } catch (_) { m = null; } }
  cacheDep[chave] = m;
  return m;
}

/* ================= geometria pequena ================= */

function areaAnel(p) {
  let s = 0;
  for (let i = 0, n = p.length, j = n - 1; i < n; j = i++) s += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return s / 2;
}
function caixaDe(aneis) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const A of aneis) for (const p of A) {
    if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0];
    if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1];
  }
  return isFinite(x1) ? { x1, y1, x2, y2 } : null;
}
const contem = (a, b) => a.x1 <= b.x1 && a.y1 <= b.y1 && a.x2 >= b.x2 && a.y2 >= b.y2;
/* ponto dentro do anel (par-impar) */
function dentro(p, x, y) {
  let d = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) d = !d;
  }
  return d;
}
/* tira vertice repetido em seguida (tambem o fechamento) e o colinear EXATO (produto vetorial 0,
   que no marching squares, com coordenadas em meio pixel, e conta exata) */
function limpaAnel(p, eps) {
  const e = eps || 0;
  const igual = (a, b) => Math.abs(a[0] - b[0]) <= e && Math.abs(a[1] - b[1]) <= e;
  let q = [];
  for (const v of p) if (!q.length || !igual(q[q.length - 1], v)) q.push(v);
  while (q.length > 1 && igual(q[0], q[q.length - 1])) q.pop();
  /* colineares: varre ate nao mudar (o fechamento pode juntar o ultimo com o primeiro) */
  for (let volta = 0; volta < 3 && q.length >= 3; volta++) {
    const r = [];
    const n = q.length;
    for (let i = 0; i < n; i++) {
      const a = r.length ? r[r.length - 1] : q[(i + n - 1) % n], b = q[i], c = q[(i + 1) % n];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const ida = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
      if (cr === 0 && ida > 0) continue;            /* colinear seguindo em frente: b sobra */
      r.push(b);
    }
    if (r.length === n) break;
    q = r;
  }
  return q;
}

/* os lados p1-p2 e p3-p4 se cruzam ou se encostam -- a MESMA conta do HubCore (segCorta) */
const segLado = (a, b, c) => { const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); return Math.abs(v) < 1e-12 ? 0 : (v > 0 ? 1 : -1); };
const segSobre = (a, b, c) => Math.min(a[0], b[0]) - 1e-9 <= c[0] && c[0] <= Math.max(a[0], b[0]) + 1e-9 &&
                              Math.min(a[1], b[1]) - 1e-9 <= c[1] && c[1] <= Math.max(a[1], b[1]) + 1e-9;
function segCorta(p1, p2, p3, p4) {
  const o1 = segLado(p1, p2, p3), o2 = segLado(p1, p2, p4), o3 = segLado(p3, p4, p1), o4 = segLado(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && segSobre(p1, p2, p3)) || (o2 === 0 && segSobre(p1, p2, p4)) ||
         (o3 === 0 && segSobre(p3, p4, p1)) || (o4 === 0 && segSobre(p3, p4, p2));
}
/* algum lado de algum anel cruza/encosta noutro (o vizinho do mesmo anel nao conta: divide a
   ponta)? Varredura em X: so se comparam lados cujas faixas de X se sobrepoem. */
function algumCruzamento(aneis) {
  const S = [];
  aneis.forEach((A, r) => { for (let i = 0; i < A.length; i++) {
    const a = A[i], b = A[(i + 1) % A.length];
    S.push({ a, b, r, i, n: A.length, x1: Math.min(a[0], b[0]), x2: Math.max(a[0], b[0]), y1: Math.min(a[1], b[1]), y2: Math.max(a[1], b[1]) });
  } });
  S.sort((u, v) => u.x1 - v.x1);
  let ativos = [];
  for (const s of S) {
    ativos = ativos.filter(t => t.x2 >= s.x1 - 1e-9);
    for (const t of ativos) {
      if (t.y2 < s.y1 - 1e-9 || s.y2 < t.y1 - 1e-9) continue;
      if (t.r === s.r) {
        const d = Math.abs(t.i - s.i);
        if (d === 1 || d === s.n - 1) continue;
      }
      if (segCorta(s.a, s.b, t.a, t.b)) return { r1: t.r, r2: s.r };
    }
    ativos.push(s);
  }
  return null;
}
/* o poligono [contorno, ...furos] vale como region_add? '' ou o motivo */
function erroPoly(R) {
  for (let k = 0; k < R.length; k++) {
    if (R[k].length < 3 || Math.abs(areaAnel(R[k])) < 1e-12) return k ? `furo ${k} sem área` : 'contorno sem área';
  }
  const c = algumCruzamento(R);
  if (c) return c.r1 === c.r2 ? (c.r1 ? `furo ${c.r1} com lados que se cruzam` : 'contorno com lados que se cruzam')
                              : (c.r1 && c.r2 ? `furos ${c.r1} e ${c.r2} se encostam` : `furo ${c.r1 || c.r2} encosta no contorno`);
  const bbs = R.map(A => caixaDe([A]));
  for (let k = 1; k < R.length; k++) if (!dentro(R[0], R[k][0][0], R[k][0][1])) return `furo ${k} fora do contorno`;
  for (let i = 1; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    const a = bbs[i], b = bbs[j];
    if (a.x2 < b.x1 || b.x2 < a.x1 || a.y2 < b.y1 || b.y2 < a.y1) continue;
    if (dentro(R[i], R[j][0][0], R[j][0][1]) || dentro(R[j], R[i][0][0], R[i][0][1])) return `furo ${i} e furo ${j} um dentro do outro`;
  }
  return '';
}

/* Ramer-Douglas-Peucker de um anel fechado, sem recursao (anel de 100 mil pontos nao estoura a
   pilha): as duas metades entre o ponto mais a esquerda e o mais longe dele */
function rdpAnel(p, tol) {
  const n = p.length;
  if (n < 4 || !(tol > 0)) return p.slice();
  let i0 = 0;
  for (let i = 1; i < n; i++) if (p[i][0] < p[i0][0] || (p[i][0] === p[i0][0] && p[i][1] < p[i0][1])) i0 = i;
  let i1 = i0, dm = -1;
  for (let i = 0; i < n; i++) { const d = (p[i][0] - p[i0][0]) ** 2 + (p[i][1] - p[i0][1]) ** 2; if (d > dm) { dm = d; i1 = i; } }
  const fica = new Uint8Array(n);
  fica[i0] = fica[i1] = 1;
  const t2 = tol * tol;
  const pilha = [[i0, i1], [i1, i0]];
  while (pilha.length) {
    const [a, b] = pilha.pop();
    const len = (b - a + n) % n;
    if (len < 2) continue;
    const A = p[a], B = p[b], dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy;
    let k = -1, dmax = -1;
    for (let s = 1; s < len; s++) {
      const i = (a + s) % n, P = p[i];
      let d;
      if (L2 === 0) d = (P[0] - A[0]) ** 2 + (P[1] - A[1]) ** 2;
      else { const c = (P[0] - A[0]) * dy - (P[1] - A[1]) * dx; d = c * c / L2; }
      if (d > dmax) { dmax = d; k = i; }
    }
    if (dmax > t2) { fica[k] = 1; pilha.push([a, k], [k, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (fica[i]) out.push(p[i]);
  return out;
}

/* simplifica [contorno, ...furos] com tol; se estraga, metade, ate sem simplificar */
function simplificaPoly(R, tol) {
  const tols = [];
  for (let t = tol; t > tol / 16 && t > 0; t /= 2) tols.push(t);
  tols.push(0);
  let ultimo = '';
  for (const t of tols) {
    const S = R.map(A => {
      const base = limpaAnel(A);
      if (!(t > 0)) return base;
      const q = limpaAnel(rdpAnel(base, t));
      return q.length < 3 || Math.abs(areaAnel(q)) < t * t ? base : q;
    });
    const e = erroPoly(S);
    if (!e) return { R: S, tol: t };
    ultimo = e;
  }
  return { erro: ultimo };
}

/* contorno de fora no sentido anti-horario (Y para cima), furos no horario */
function orienta(pts, positivo) {
  const a = areaAnel(pts);
  return (a > 0) === positivo ? pts : pts.slice().reverse();
}

/* aninhamento de aneis que nao se encostam: devolve [{pts, holes, nivel}] (par = fora, impar =
   furo do pai), pais antes das ilhas */
function classifica(aneis, areaMin) {
  const L = aneis.map(pts => ({ pts, area: Math.abs(areaAnel(pts)), bb: caixaDe([pts]), pai: -1, nivel: 0 }))
    .filter(r => r.pts.length >= 3 && r.area > 0);
  L.sort((a, b) => b.area - a.area);
  for (let i = 0; i < L.length; i++) {
    const r = L[i], q = r.pts[0];
    for (let j = i - 1; j >= 0; j--) {
      const s = L[j];
      if (s.area <= r.area || !contem(s.bb, r.bb)) continue;
      if (dentro(s.pts, q[0], q[1])) { r.pai = j; r.nivel = s.nivel + 1; break; }
    }
  }
  const min = isNum(areaMin) ? areaMin : 0;
  const fora = new Map();
  const out = [];
  L.forEach((r, i) => { if (r.nivel % 2 === 0 && r.area >= min) { const o = { pts: r.pts, holes: [], nivel: r.nivel, bb: r.bb }; fora.set(i, o); out.push(o); } });
  L.forEach(r => { if (r.nivel % 2 === 1 && r.area >= min && fora.has(r.pai)) fora.get(r.pai).holes.push(r.pts); });
  out.sort((a, b) => a.nivel - b.nivel || a.bb.y1 - b.bb.y1 || a.bb.x1 - b.bb.x1);
  return out.map(o => ({ pts: o.pts, holes: o.holes, nivel: o.nivel }));
}

/* ================= imagem ================= */

function mascaraDeRGBA(rgba, w, h, opts) {
  const o = opts || {};
  const canais = o.canais === 3 ? 3 : 4;
  if (!(w > 0 && h > 0) || !rgba || rgba.length < w * h * canais) throw new Error(`mascaraDeRGBA: ${w}x${h} pede ${w * h * canais} bytes, vieram ${rgba ? rgba.length : 0}`);
  const lim = isNum(o.limiar) ? o.limiar : 128, inv = !!o.inverter, alfa = o.alfa !== false && canais === 4;
  const limA = isNum(o.limiarAlfa) ? o.limiarAlfa : 128;
  const m = new Uint8Array(w * h);
  let n = 0;
  for (let i = 0, k = 0; i < w * h; i++, k += canais) {
    if (alfa && rgba[k + 3] < limA) continue;
    const L = 0.299 * rgba[k] + 0.587 * rgba[k + 1] + 0.114 * rgba[k + 2];
    if ((L < lim) !== inv) { m[i] = 1; n++; }
  }
  return { w, h, m, n };
}

/* mascara reduzida k vezes (k x k pixels -> 1): tinta quando metade ou mais era tinta */
function reduzMascara(M, k) {
  if (!(k > 1)) return M;
  const w = Math.ceil(M.w / k), h = Math.ceil(M.h / k), m = new Uint8Array(w * h);
  let n = 0;
  for (let J = 0; J < h; J++) for (let I = 0; I < w; I++) {
    let s = 0, t = 0;
    for (let j = J * k; j < Math.min(M.h, (J + 1) * k); j++) for (let i = I * k; i < Math.min(M.w, (I + 1) * k); i++) { s += M.m[j * M.w + i]; t++; }
    if (s * 2 >= t && s) { m[J * w + I] = 1; n++; }
  }
  return { w, h, m, n, k };
}

function contornos(M, opts) {
  const o = opts || {};
  const w = M.w, h = M.h, m = M.m;
  const liga = o.diagonal === 'liga';
  const S = (i, j) => (i >= 0 && j >= 0 && i < w && j < h) ? m[j * w + i] : 0;
  /* vertices = meios de aresta entre duas amostras. H(i,j): entre (i,j) e (i+1,j), i em -1..w-1,
     j em -1..h; V(i,j): entre (i,j) e (i,j+1), i em -1..w, j em -1..h-1 */
  const nH = (w + 1) * (h + 2);
  const idH = (i, j) => (j + 1) * (w + 1) + (i + 1);
  const idV = (i, j) => nH + (j + 1) * (w + 2) + (i + 1);
  const xy = id => {
    if (id < nH) { const j = Math.floor(id / (w + 1)) - 1, i = id % (w + 1) - 1; return [i + 1, j + 0.5]; }
    const q = id - nH, j = Math.floor(q / (w + 2)) - 1, i = q % (w + 2) - 1;
    return [i + 0.5, j + 1];
  };
  const prox = new Map();
  const E = [0, 0, 0, 0], de = [0, 0, 0, 0], pa = [0, 0, 0, 0];
  for (let j = -1; j < h; j++) for (let i = -1; i < w; i++) {
    const a = S(i, j), b = S(i + 1, j), c = S(i + 1, j + 1), d = S(i, j + 1);
    const s = a + b + c + d;
    if (s === 0 || s === 4) continue;
    /* as arestas da celula em sentido horario na tela: cima (a->b), direita (b->c), baixo (c->d),
       esquerda (d->a). Cada uma que sai da tinta (1 -> 0) liga na que entra (0 -> 1): na sela, a
       anterior (separa: corta a quina de tinta) ou a seguinte (liga: corta a quina vazia). O
       vertice e "sai" numa celula e "entra" na vizinha: cada um tem um proximo e um anterior. */
    E[0] = idH(i, j); E[1] = idV(i + 1, j); E[2] = idH(i, j + 1); E[3] = idV(i, j);
    de[0] = a; de[1] = b; de[2] = c; de[3] = d;
    pa[0] = b; pa[1] = c; pa[2] = d; pa[3] = a;
    const sela = s === 2 && a === c;
    for (let k = 0; k < 4; k++) {
      if (!(de[k] === 1 && pa[k] === 0)) continue;
      let k2 = -1;
      if (sela) { const st = liga ? 1 : 3; for (let t = 1; t < 4; t++) { const q = (k + st * t) % 4; if (de[q] === 0 && pa[q] === 1) { k2 = q; break; } } }
      else for (let q = 0; q < 4; q++) if (de[q] === 0 && pa[q] === 1) { k2 = q; break; }
      prox.set(E[k], E[k2]);
    }
  }
  const aneis = [];
  for (const ini of prox.keys()) {
    const pts = [];
    let v = ini, guarda = prox.size + 1;
    while (guarda-- > 0) {
      pts.push(xy(v));
      const n = prox.get(v);
      prox.delete(v);
      if (n === undefined || n === ini) break;
      v = n;
    }
    const q = limpaAnel(pts);
    if (q.length >= 3) aneis.push(q);
  }
  return classifica(aneis, isNum(o.areaMin) ? o.areaMin : 1);
}

/* pixels (Y para baixo) -> mm (Y para cima), centrado em x,y, com escala/espelho/giro e a
   simplificacao que nao estraga o poligono */
function paraPlaca(polys, opts) {
  const o = opts || {};
  const L = (polys || []).filter(p => p && Array.isArray(p.pts) && p.pts.length >= 3);
  const out = [];
  const bbTinta = caixaDe(L.map(p => p.pts));
  const ref = o.caixaPx && [o.caixaPx.x1, o.caixaPx.y1, o.caixaPx.x2, o.caixaPx.y2].every(isNum) ? o.caixaPx : bbTinta;
  out.info = { escala: null, caixa: null, tolerancia: null, refeitos: 0, descartadas: [] };
  if (!ref) return out;
  const bw = ref.x2 - ref.x1, bh = ref.y2 - ref.y1;
  let s;
  if (isNum(o.escala) && o.escala > 0) s = o.escala;
  else if (isNum(o.largura) && o.largura > 0 && bw > 0) s = o.largura / bw;
  else if (isNum(o.altura) && o.altura > 0 && bh > 0) s = o.altura / bh;
  else throw new Error('paraPlaca: dê largura, altura ou escala (mm)');
  const cx = (ref.x1 + ref.x2) / 2, cy = (ref.y1 + ref.y2) / 2;
  const X = isNum(o.x) ? o.x : 0, Y = isNum(o.y) ? o.y : 0, esp = o.espelhar ? -1 : 1;
  const ang = (isNum(o.rot) ? o.rot : 0) * Math.PI / 180, co = Math.cos(ang), si = Math.sin(ang);
  const T = p => { const u = (p[0] - cx) * s * esp, v = -(p[1] - cy) * s; return [X + u * co - v * si, Y + u * si + v * co]; };
  /* a escada do pixel (o chanfro desvia ate ~0,35 px da borda real) tambem sai: a tolerancia e no
     minimo `pixel` (padrao 0,5) pixel */
  const tol = Math.max(isNum(o.simplificar) ? Math.max(0, o.simplificar) : 0.02, (isNum(o.pixel) ? Math.max(0, o.pixel) : 0.5) * s);
  L.forEach((p, i) => {
    const R = [p.pts].concat(p.holes || []).map(A => A.map(T));
    const r = simplificaPoly(R, tol);
    if (r.erro) { out.info.descartadas.push({ motivo: r.erro, indice: i, caixa: caixaDe([R[0]]) }); return; }
    if (r.tol < tol) out.info.refeitos++;
    out.push({ pts: orienta(r.R[0], true), holes: r.R.slice(1).map(A => orienta(A, false)), nivel: p.nivel || 0 });
  });
  out.info.escala = s;
  out.info.tolerancia = tol;
  out.info.caixa = caixaDe(out.map(p => p.pts));
  return out;
}

/* ================= texto ================= */

/* o caminho de uma linha do opentype -> aneis em mm (Y para cima), curvas achatadas com tol */
function aneisDoCaminho(cmds, tol, dy) {
  const aneis = [];
  let A = [], cur = null;
  const fecha = () => { const q = limpaAnel(A); if (q.length >= 3) aneis.push(q); A = []; };
  const poe = (x, y) => { A.push([x, -y + dy]); cur = [x, y]; };
  for (const c of cmds) {
    switch (c.type) {
      case 'M': fecha(); poe(c.x, c.y); break;
      case 'L': poe(c.x, c.y); break;
      case 'Q': {
        if (!cur) { poe(c.x, c.y); break; }
        const [x0, y0] = cur, dd = Math.hypot(x0 - 2 * c.x1 + c.x, y0 - 2 * c.y1 + c.y);
        const n = Math.min(64, Math.max(1, Math.ceil(Math.sqrt(dd / (4 * tol)))));
        for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; poe(u * u * x0 + 2 * u * t * c.x1 + t * t * c.x, u * u * y0 + 2 * u * t * c.y1 + t * t * c.y); }
        break;
      }
      case 'C': {
        if (!cur) { poe(c.x, c.y); break; }
        const [x0, y0] = cur;
        const d1 = Math.hypot(x0 - 2 * c.x1 + c.x2, y0 - 2 * c.y1 + c.y2), d2 = Math.hypot(c.x1 - 2 * c.x2 + c.x, c.y1 - 2 * c.y2 + c.y);
        const n = Math.min(96, Math.max(1, Math.ceil(Math.sqrt(3 * Math.max(d1, d2) / (4 * tol)))));
        for (let k = 1; k <= n; k++) {
          const t = k / n, u = 1 - t;
          poe(u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
              u * u * u * y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y);
        }
        break;
      }
      case 'Z': fecha(); break;
      default: break;
    }
  }
  fecha();
  return aneis;
}

/* aneis de fonte -> poligonos. Profundidade pelo aninhamento; com o Clipper, cada anel orientado
   pela paridade da profundidade e a uniao NonZero (StrictlySimple: furo nunca encosta no contorno
   por um vertice). Sem o Clipper, o aninhamento puro. */
function poligonosDeAneis(aneis, C) {
  const base = classifica(aneis, 0);
  if (!C) return base;
  const E = 1e5;
  const paraC = A => A.map(p => ({ X: Math.round(p[0] * E), Y: Math.round(p[1] * E) }));
  const caminhos = [];
  for (const p of base) {
    caminhos.push(paraC(orienta(p.pts, true)));
    for (const h of p.holes) caminhos.push(paraC(orienta(h, false)));
  }
  const uniao = (paths) => {
    const c = new C.Clipper();
    c.StrictlySimple = true;
    c.AddPaths(paths, C.PolyType.ptSubject, true);
    const t = new C.PolyTree();
    c.Execute(C.ClipType.ctUnion, t, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
    return C.JS.PolyTreeToExPolygons(t);
  };
  const deC = P => limpaAnel(P.map(q => [q.X / E, q.Y / E]));
  const out = [];
  for (const ex of uniao(caminhos)) {
    let R = [deC(ex.outer)].concat(ex.holes.map(deC)).filter(A => A.length >= 3);
    if (!R.length || Math.abs(areaAnel(R[0])) <= 0) continue;
    if (erroPoly(R)) {
      /* ainda encosta (vertice comum): uma erosao de 0,2 um separa o ponto de largura zero */
      const co = new C.ClipperOffset(2, 0.25);
      co.AddPaths([paraC(R[0])].concat(R.slice(1).map(paraC)), C.JoinType.jtMiter, C.EndType.etClosedPolygon);
      const sol = new C.Paths();
      co.Execute(sol, -0.0002 * E);
      for (const ex2 of uniao(sol)) {
        const R2 = [deC(ex2.outer)].concat(ex2.holes.map(deC)).filter(A => A.length >= 3);
        if (R2.length && Math.abs(areaAnel(R2[0])) > 0) out.push({ pts: R2[0], holes: R2.slice(1) });
      }
      continue;
    }
    out.push({ pts: R[0], holes: R.slice(1) });
  }
  return out;
}

function textoComFonte(font, texto, opts) {
  const o = opts || {};
  if (!font || typeof font.getPath !== 'function') throw new Error('textoComFonte: font deve ser uma Font do opentype.js');
  const h = isNum(o.h) && o.h > 0 ? o.h : 1;
  const upm = font.unitsPerEm || 1000;
  let capU = font.tables && font.tables.os2 && font.tables.os2.sCapHeight;
  if (!(capU > 0)) {
    const g = font.charToGlyph('H');
    const bb = g && typeof g.getBoundingBox === 'function' ? g.getBoundingBox() : null;
    capU = bb && bb.y2 > 0 ? bb.y2 : 0.7 * upm;
  }
  const corpo = h * upm / (o.hRef === 'em' ? upm : capU);         /* o em, em mm */
  const tol = isNum(o.tolerancia) && o.tolerancia > 0 ? o.tolerancia : Math.max(0.002, h / 200);
  const kern = o.kerning !== false;
  const hhea = font.tables && font.tables.hhea;
  const passo = isNum(o.entrelinha) && o.entrelinha > 0 ? o.entrelinha * h
    : ((font.ascender || 0.8 * upm) - (font.descender || -0.2 * upm) + ((hhea && hhea.lineGap) || 0)) / upm * corpo;
  const alinha = o.alinha === 'esquerda' || o.alinha === 'direita' ? o.alinha : 'centro';
  const linhas = String(texto == null ? '' : texto).split(/\r\n|\r|\n/);
  const faltam = [];
  let aneis = [];
  linhas.forEach((l, k) => {
    for (const ch of l) if (ch.trim() && font.charToGlyphIndex(ch) === 0 && !faltam.includes(ch)) faltam.push(ch);
    const avanco = font.getAdvanceWidth(l, corpo, { kerning: kern });
    const dx = alinha === 'esquerda' ? 0 : alinha === 'direita' ? -avanco : -avanco / 2;
    const cam = font.getPath(l, dx, 0, corpo, { kerning: kern });
    aneis = aneis.concat(aneisDoCaminho(cam.commands, tol, -k * passo));
  });
  const polys = poligonosDeAneis(aneis, dep(o, 'ClipperLib', 'ClipperLib', './hub-clipper.js'));
  const bb = caixaDe(polys.map(p => p.pts));
  const out = [];
  out.info = { faltam, escala: corpo / upm, corpo_mm: corpo, tolerancia: tol, caixa: null };
  if (!bb) return out;
  /* a ancora: a caixa da tinta (x pelo alinhamento; y pelo meio, ou a linha de base) */
  const ax = alinha === 'esquerda' ? bb.x1 : alinha === 'direita' ? bb.x2 : (bb.x1 + bb.x2) / 2;
  const ay = o.ancora === 'base' ? 0 : (bb.y1 + bb.y2) / 2;
  const X = isNum(o.x) ? o.x : 0, Y = isNum(o.y) ? o.y : 0, esp = o.espelhar ? -1 : 1;
  const ang = (isNum(o.rot) ? o.rot : 0) * Math.PI / 180, co = Math.cos(ang), si = Math.sin(ang);
  const T = p => { const u = (p[0] - ax) * esp, v = p[1] - ay; return [X + u * co - v * si, Y + u * si + v * co]; };
  for (const p of polys) out.push({ pts: orienta(p.pts.map(T), true), holes: p.holes.map(A => orienta(A.map(T), false)) });
  out.info.caixa = caixaDe(out.map(p => p.pts));
  return out;
}

/* ================= saida ================= */

const mmTxt = v => String(Math.round(v * 1e4) / 1e4).replace('.', ',');
const limpaNote = s => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/":/g, '" :');

/* tracos finos e vaos finos: abertura e fechamento morfologicos (Clipper) */
function conferirLargura(polys, larg, C) {
  const E = 1e5, r = larg / 2;
  const paraC = A => A.map(p => ({ X: Math.round(p[0] * E), Y: Math.round(p[1] * E) }));
  const tinta = [];
  for (const p of polys) { tinta.push(paraC(orienta(p.pts, true))); for (const h of p.holes) tinta.push(paraC(orienta(h, false))); }
  const op = (tipo, a, b) => {
    const c = new C.Clipper();
    c.AddPaths(a, C.PolyType.ptSubject, true);
    if (b) c.AddPaths(b, C.PolyType.ptClip, true);
    const t = new C.PolyTree();
    c.Execute(tipo, t, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
    return C.JS.PolyTreeToExPolygons(t);
  };
  const paths = exs => [].concat(...exs.map(ex => [ex.outer].concat(ex.holes)));
  const offset = (P, d) => {
    const co = new C.ClipperOffset(2, Math.max(1, r * 0.05 * E));
    co.AddPaths(P, C.JoinType.jtRound, C.EndType.etClosedPolygon);
    const s = new C.Paths(); co.Execute(s, d * E); return s;
  };
  const U = paths(op(C.ClipType.ctUnion, tinta));
  const pedacos = exs => {
    const L = [];
    for (const ex of exs) {
      const a = (C.Clipper.Area(ex.outer) + ex.holes.reduce((s, h) => s + C.Clipper.Area(h), 0)) / (E * E);
      if (Math.abs(a) <= 3 * r * r) continue;      /* sobra de quina (90 graus: 0,21 r^2) nao conta */
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const q of ex.outer) { x1 = Math.min(x1, q.X); x2 = Math.max(x2, q.X); y1 = Math.min(y1, q.Y); y2 = Math.max(y2, q.Y); }
      L.push({ x: Math.round((x1 + x2) / 2 / E * 1e3) / 1e3, y: Math.round((y1 + y2) / 2 / E * 1e3) / 1e3, area_mm2: Math.round(Math.abs(a) * 1e4) / 1e4 });
    }
    return L.sort((a, b) => b.area_mm2 - a.area_mm2);
  };
  const aberto = offset(offset(U, -r), r);
  const finos = pedacos(op(C.ClipType.ctDifference, U, aberto));
  const fechado = offset(offset(U, r), -r);
  const vaos = pedacos(op(C.ClipType.ctDifference, fechado, U));
  return { finos, vaos };
}

function opsDe(polys, opts) {
  const o = opts || {};
  const layer = typeof o.layer === 'string' && o.layer ? o.layer : 'TopOverlay';
  const casas = isNum(o.casas) ? Math.max(4, Math.min(6, Math.round(o.casas))) : 4;
  const f = Math.pow(10, casas), rd = v => Math.round(v * f) / f;
  const HC = dep(o, 'HubCore', 'HubCore', './hub-core.js');
  const C = dep(o, 'ClipperLib', 'ClipperLib', './hub-clipper.js');
  const regErr = HC && typeof HC.regiaoErro === 'function' ? HC.regiaoErro : (pts => erroPoly([pts]));
  const furErr = HC && typeof HC.furosErro === 'function' ? HC.furosErro : ((pts, holes) => erroPoly([pts].concat(holes)));
  const note = limpaNote(o.note != null ? o.note : 'serigrafia gerada');
  const maxV = isNum(o.maxVertices) ? o.maxVertices : 20000, maxA = isNum(o.maxPorAnel) ? o.maxPorAnel : 3000;
  const larg = isNum(o.larguraMin) ? o.larguraMin : 0.15;
  const res = { ops: [], descartadas: [], avisos: [], area_mm2: 0, caixa: null, vertices: 0, furos: 0, regioes: 0, finos: [], vaos: [] };
  const anel = A => limpaAnel(A.map(p => [rd(p[0]), rd(p[1])]), 0);
  const L = [];
  let grande = 0;
  (polys || []).forEach((p, i) => {
    if (!p || !Array.isArray(p.pts)) return;
    const pts = anel(p.pts);
    if (pts.length < 3) { res.descartadas.push({ motivo: 'contorno degenerou (menos de 3 vértices)', indice: i }); return; }
    const holes = [];
    for (const h of p.holes || []) { const q = anel(h); if (q.length >= 3 && Math.abs(areaAnel(q)) > 0) holes.push(q); else res.avisos.push(`polígono ${i}: um furo pequeno demais sumiu (ficou cheio)`); }
    for (const A of [pts].concat(holes)) if (A.length > maxA) grande++;
    L.push({ i, pts, holes });
    res.vertices += pts.length + holes.reduce((s, h) => s + h.length, 0);
  });
  if (grande) res.avisos.push(`${grande} anel(is) com mais de ${maxA} vértices: o motor confere cada um a cada recálculo da placa (n²) — aumente a simplificação`);
  if (res.vertices > maxV) {
    res.recusado = true;
    res.avisos.push(`${res.vertices} vértices passam do máximo (${maxV}): nada saiu. Aumente a simplificação (simplificar/tolerancia), diminua o tamanho ou a resolução da imagem, ou suba maxVertices`);
    res.caixa = caixaDe(L.map(p => p.pts));
    return res;
  }
  const bons = [];
  for (const p of L) {
    const e = regErr(p.pts) || (p.holes.length ? furErr(p.pts, p.holes) : '');
    if (e) { res.descartadas.push({ motivo: e, indice: p.i, caixa: caixaDe([p.pts]), vertices: p.pts.length }); continue; }
    const op = { op: 'region_add', layer, pts: p.pts };
    if (p.holes.length) op.holes = p.holes;
    if (note) op.note = note;
    res.ops.push(op);
    bons.push(p);
    res.furos += p.holes.length;
    res.area_mm2 += Math.abs(areaAnel(p.pts)) - p.holes.reduce((s, h) => s + Math.abs(areaAnel(h)), 0);
  }
  res.regioes = res.ops.length;
  res.area_mm2 = Math.round(res.area_mm2 * 1e4) / 1e4;
  const bb = caixaDe(bons.map(p => p.pts));
  res.caixa = bb ? { x1: rd(bb.x1), y1: rd(bb.y1), x2: rd(bb.x2), y2: rd(bb.y2) } : null;
  if (res.descartadas.length) res.avisos.push(`${res.descartadas.length} polígono(s) não passaram na conferência do motor e ficaram de fora (veja descartadas)`);
  /* a largura minima da serigrafia */
  if (larg > 0 && bons.length) {
    if (C) {
      try {
        const { finos, vaos } = conferirLargura(bons, larg, C);
        res.finos = finos.slice(0, 20); res.vaos = vaos.slice(0, 20);
        if (finos.length) res.avisos.push(`${finos.length} trecho(s) de tinta mais fino(s) que ${mmTxt(larg)} mm (a serigrafia não imprime): o maior perto de (${mmTxt(finos[0].x)}; ${mmTxt(finos[0].y)}) — aumente o tamanho ou engrosse o desenho`);
        if (vaos.length) res.avisos.push(`${vaos.length} vão(s) mais estreito(s) que ${mmTxt(larg)} mm (a tinta fecha): o maior perto de (${mmTxt(vaos[0].x)}; ${mmTxt(vaos[0].y)})`);
      } catch (e) { res.avisos.push('conferência da largura mínima falhou: ' + (e && e.message || e)); }
    } else {
      let fin = 0;
      for (const p of bons) {
        const R = [p.pts].concat(p.holes);
        const A = Math.abs(areaAnel(p.pts)) - p.holes.reduce((s, h) => s + Math.abs(areaAnel(h)), 0);
        let per = 0;
        for (const Q of R) for (let i = 0; i < Q.length; i++) { const a = Q[i], b = Q[(i + 1) % Q.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
        if (per > 0 && 2 * A / per < larg) fin++;
      }
      if (fin) res.avisos.push(`${fin} polígono(s) com largura média abaixo de ${mmTxt(larg)} mm (estimativa 2·área/perímetro)`);
    }
  }
  return res;
}

/* ================= atalhos ================= */

/* imagem RGBA -> ops. opts: os do mascaraDeRGBA, contornos, paraPlaca e opsDe juntos. Pixel bem
   menor que a tolerancia so pesa: a mascara e reduzida ate o pixel ficar perto de simplificar/2
   (reduzir:false desliga) */
function daImagem(rgba, w, h, opts) {
  const o = opts || {};
  let M = mascaraDeRGBA(rgba, w, h, o);
  const res0 = { pixels: { w, h }, tinta_px: M.n, reduzida: 1 };
  if (!M.n) return Object.assign(opsDe([], o), res0, { polys: [], escala: null, avisos: ['a imagem não tem tinta com esse limiar (tente inverter ou outro limiar)'] });
  /* a escala antes do contorno: a caixa da tinta e a dos pixels de tinta (o contorno passa nas bordas deles) */
  let x1 = w, y1 = h, x2 = 0, y2 = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (M.m[j * w + i]) { if (i < x1) x1 = i; if (i + 1 > x2) x2 = i + 1; if (j < y1) y1 = j; if (j + 1 > y2) y2 = j + 1; }
  const ref = o.caixaPx || { x1, y1, x2, y2 };
  const esc = isNum(o.escala) && o.escala > 0 ? o.escala : isNum(o.largura) && o.largura > 0 ? o.largura / (ref.x2 - ref.x1) : isNum(o.altura) && o.altura > 0 ? o.altura / (ref.y2 - ref.y1) : null;
  const tol = isNum(o.simplificar) ? o.simplificar : 0.02;
  const k = esc ? Math.floor(tol / 2 / esc + 1e-9) : 0;
  let o2 = o;
  if (o.reduzir !== false && k >= 2) {
    M = reduzMascara(M, k);
    o2 = Object.assign({}, o, { areaMin: (isNum(o.areaMin) ? o.areaMin : 1) / (k * k),
      caixaPx: o.caixaPx ? { x1: o.caixaPx.x1 / k, y1: o.caixaPx.y1 / k, x2: o.caixaPx.x2 / k, y2: o.caixaPx.y2 / k } : undefined });
    if (isNum(o.escala)) o2.escala = o.escala * k;
    res0.reduzida = k;
  }
  const pp = paraPlaca(contornos(M, o2), o2);
  const r = opsDe(pp, o);
  r.descartadas = pp.info.descartadas.concat(r.descartadas);
  if (pp.info.refeitos) r.avisos.push(`${pp.info.refeitos} polígono(s) simplificados com tolerância menor (a padrão cruzava os lados)`);
  return Object.assign(r, res0, { polys: pp, escala: pp.info.escala, tolerancia: pp.info.tolerancia });
}

function daTexto(font, texto, opts) {
  const o = opts || {};
  const polys = textoComFonte(font, texto, o);
  const r = opsDe(polys, o);
  if (polys.info.faltam.length) r.avisos.push(`a fonte não tem glifo para: ${polys.info.faltam.join(' ')}`);
  return Object.assign(r, { polys, faltam: polys.info.faltam, corpo_mm: polys.info.corpo_mm });
}

return { mascaraDeRGBA, contornos, paraPlaca, textoComFonte, opsDe, daImagem, daTexto,
         _int: { reduzMascara, limpaAnel, rdpAnel, erroPoly, algumCruzamento, classifica, areaAnel, caixaDe, aneisDoCaminho, conferirLargura } };
});
