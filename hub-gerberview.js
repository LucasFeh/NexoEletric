/* AltiumPCBMirror v2 - hub-gerberview.js
   Visualizador de Gerber (RS-274X e X2) e de Excellon do hub.

   Duas metades num arquivo so, como o hub-font.js:
   - PURA (roda em Node; tests/test-gerberview.js): parse, parseExcellon, camadaDe, lerZip,
     contornoDaAbertura e a geometria que a tela usa (contornoDaPlaca, objetoEm). Tudo sai em MM,
     Y para cima, com a polaridade de cada objeto (escuro/claro) e a abertura ja resolvida: quem
     desenha nao precisa saber nada de formato de arquivo.
   - TELA (so no navegador, dentro de montar()): canvas com pan/zoom, lista de camadas com cor,
     olho e opacidade, vista de cima/baixo, modo realista e a comparacao de dois conjuntos.

   O hub gera Gerber X2 (hub-gerber.js) como o Altium 21 gera para a JLCPCB; esta vista mostra o
   resultado e abre Gerber de qualquer origem para comparar: o X2 do Altium (mm, 4.5, macros
   ROUNDEDRECT, G36/G37, G75), a reexportacao do CAMtastic (polegada, zeros a direita omitidos,
   coordenada modal), Protel (.GTL...), KiCad e Eagle.

   O que o parse entende (e o que so aceita sem quebrar) esta no comentario de parse(). O que
   nao entende vira uma linha em camada.avisos - nunca uma excecao. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HubGerberView = factory();
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const MM_POR_POL = 25.4;
const TAU = Math.PI * 2;
const RAD = Math.PI / 180;
/* erro maximo de corda ao achatar arco (mm): bem abaixo da resolucao de qualquer Gerber */
const ERRO_CORDA = 0.0025;
/* Limites. A contagem vem do arquivo (vertices de um P, aneis de um moire, copias de um %SR,
   repeticoes de um R do Excellon), e uma linha malformada bastava para derrubar a aba por falta
   de memoria. Acima deles o parse corta e AVISA - nunca uma excecao. */
const LIMITE_OBJETOS = 1000000;             /* objetos gerados por repeticao (%SR, R do Excellon) */
const LIMITE_ANEIS = 100;                   /* aneis de um moire (primitiva 6) */
const LIMITE_ARQUIVO = 80 * 1024 * 1024;    /* bytes de um arquivo, solto ou descompactado do .zip */
const LIMITE_ZIP_DENTRO = 4;                /* niveis de .zip dentro de .zip */

/* ============================== 1. geometria basica ============================== */

/* cosseno/seno com os multiplos de 90 graus EXATOS (o ROUNDEDRECT do Altium gira 90/270) */
function cosSen(graus) {
  const g = ((graus % 360) + 360) % 360;
  if (g === 0) return [1, 0];
  if (g === 90) return [0, 1];
  if (g === 180) return [-1, 0];
  if (g === 270) return [0, -1];
  const a = g * RAD;
  return [Math.cos(a), Math.sin(a)];
}
function rotaciona(x, y, graus) {
  if (!graus) return [x, y];
  const cs = cosSen(graus);
  return [x * cs[0] - y * cs[1], x * cs[1] + y * cs[0]];
}
/* area com sinal (shoelace): > 0 = anti-horario com Y para cima */
function areaComSinal(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}
function antiHorario(pts) { return areaComSinal(pts) < 0 ? pts.slice().reverse() : pts; }
function horario(pts) { return areaComSinal(pts) > 0 ? pts.slice().reverse() : pts; }

/* quantos segmentos para um arco de raio r e varredura sw (rad) com erro de corda <= ERRO_CORDA */
function passosArco(r, sw) {
  sw = Math.abs(sw);
  if (!(r > 0) || !(sw > 0)) return 1;
  const d = r <= ERRO_CORDA ? Math.PI / 4 : Math.min(Math.PI / 4, 2 * Math.acos(1 - ERRO_CORDA / r));
  return Math.max(1, Math.min(720, Math.ceil(sw / d)));
}
/* angulo varrido de a0 ate a1 no sentido dado (cw = horario), em [0, 2pi) */
function varredura(a0, a1, cw) {
  let d = cw ? a0 - a1 : a1 - a0;
  d %= TAU;
  if (d < 0) d += TAU;
  return d;
}
/* pontos de um arco, SEM o inicial e COM o final (cheio = volta inteira) */
function pontosArco(x1, y1, x2, y2, cx, cy, cw, cheio) {
  const r = Math.hypot(x1 - cx, y1 - cy);
  const a0 = Math.atan2(y1 - cy, x1 - cx);
  const sw = cheio ? TAU : varredura(a0, Math.atan2(y2 - cy, x2 - cx), cw);
  const n = passosArco(r, sw);
  const out = [];
  for (let k = 1; k < n; k++) {
    const a = a0 + (cw ? -1 : 1) * sw * k / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  out.push([x2, y2]);
  return out;
}
/* caixa de um arco: as pontas e os extremos dos eixos que caem dentro da varredura */
function caixaArco(x1, y1, x2, y2, cx, cy, cw, cheio) {
  const r = Math.hypot(x1 - cx, y1 - cy);
  if (cheio) return [cx - r, cy - r, cx + r, cy + r];
  let bx1 = Math.min(x1, x2), by1 = Math.min(y1, y2), bx2 = Math.max(x1, x2), by2 = Math.max(y1, y2);
  const a0 = Math.atan2(y1 - cy, x1 - cx);
  const sw = varredura(a0, Math.atan2(y2 - cy, x2 - cx), cw);
  for (let q = 0; q < 4; q++) {
    const aq = q * Math.PI / 2;
    if (varredura(a0, aq, cw) <= sw) {
      const px = cx + r * Math.cos(aq), py = cy + r * Math.sin(aq);
      if (px < bx1) bx1 = px; if (px > bx2) bx2 = px;
      if (py < by1) by1 = py; if (py > by2) by2 = py;
    }
  }
  return [bx1, by1, bx2, by2];
}
function circuloPts(cx, cy, r) {
  const n = Math.max(16, passosArco(r, TAU));
  const out = [];
  for (let k = 0; k < n; k++) { const a = TAU * k / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}
/* oblongo (estadio) w x h girado de rot graus em torno do proprio centro, anti-horario */
function oblongoPts(f) {
  const w = f.w, h = f.h;
  if (Math.abs(w - h) < 1e-12) return circuloPts(f.cx, f.cy, w / 2);
  const r = Math.min(w, h) / 2, meio = (Math.max(w, h) - Math.min(w, h)) / 2;
  const horiz = w > h;
  /* em coordenadas locais: centros das pontas em +-meio no eixo longo */
  const loc = [];
  const n = Math.max(8, passosArco(r, Math.PI));
  const c1 = horiz ? [meio, 0] : [0, meio], c2 = horiz ? [-meio, 0] : [0, -meio];
  const ini1 = horiz ? -Math.PI / 2 : 0, ini2 = ini1 + Math.PI;
  for (let k = 0; k <= n; k++) { const a = ini1 + Math.PI * k / n; loc.push([c1[0] + r * Math.cos(a), c1[1] + r * Math.sin(a)]); }
  for (let k = 0; k <= n; k++) { const a = ini2 + Math.PI * k / n; loc.push([c2[0] + r * Math.cos(a), c2[1] + r * Math.sin(a)]); }
  return loc.map(q => { const p = rotaciona(q[0], q[1], f.rot || 0); return [p[0] + f.cx, p[1] + f.cy]; });
}
function retangulo(cx, cy, w, h) {
  const a = w / 2, b = h / 2;
  return [[cx - a, cy - b], [cx + a, cy - b], [cx + a, cy + b], [cx - a, cy + b]];   /* anti-horario */
}
function poligonoRegular(cx, cy, r, n, rot) {
  /* a spec vai de 3 a 12 vertices (abertura P e primitiva 5); o parse ja avisou de quem passou */
  n = Math.max(3, Math.min(12, Math.round(n) || 3));
  const out = [];
  for (let k = 0; k < n; k++) {
    const cs = cosSen((rot || 0) + 360 * k / n);
    out.push([cx + r * cs[0], cy + r * cs[1]]);
  }
  return out;
}
/* casco convexo (cadeia monotona), anti-horario */
function cascoConvexo(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const baixo = [], cima = [];
  for (const q of p) { while (baixo.length >= 2 && cruz(baixo[baixo.length - 2], baixo[baixo.length - 1], q) <= 0) baixo.pop(); baixo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (cima.length >= 2 && cruz(cima[cima.length - 2], cima[cima.length - 1], q) <= 0) cima.pop(); cima.push(q); }
  baixo.pop(); cima.pop();
  return baixo.concat(cima);
}
/* Sutherland-Hodgman: o pedaco do poligono suj que cai dentro do poligono CONVEXO jan
   (anti-horario). Devolve [] quando nao sobra nada. */
function recortaConvexo(suj, jan) {
  let out = suj;
  for (let i = 0; i < jan.length && out.length; i++) {
    const a = jan[i], b = jan[(i + 1) % jan.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const lado = q => ex * (q[1] - a[1]) - ey * (q[0] - a[0]);          /* >= 0: a esquerda = dentro */
    const ent = out;
    out = [];
    for (let k = 0; k < ent.length; k++) {
      const p = ent[k], q = ent[(k + 1) % ent.length];
      const sp = lado(p), sq = lado(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
  }
  return out;
}
function dentroDoPoligono(x, y, pts) {
  let dentro = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) dentro = !dentro;
  }
  return dentro;
}
function distSegmento(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function distBorda(px, py, pts) {
  let d = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const v = distSegmento(px, py, pts[j][0], pts[j][1], pts[i][0], pts[i][1]);
    if (v < d) d = v;
  }
  return d;
}

/* ============================== 2. expressoes de macro ============================== */

/* Aritmetica do %AM: + - x X / com parenteses, menos unario e variaveis $n (indefinida = 0).
   'x' e 'X' sao a multiplicacao (o Gerber nao usa '*', que e o fim de bloco). */
function avaliaExpr(txt, vars) {
  const s = String(txt);
  const n = s.length;
  let i = 0;
  const esp = () => { while (i < n && (s[i] === ' ' || s[i] === '\t')) i++; };
  function fator() {
    esp();
    const c = s[i];
    if (c === '(') { i++; const v = soma(); esp(); if (s[i] !== ')') throw new Error('falta ")" em "' + s + '"'); i++; return v; }
    if (c === '+') { i++; return fator(); }
    if (c === '-') { i++; return -fator(); }
    if (c === '$') {
      i++;
      const j = i;
      while (i < n && s[i] >= '0' && s[i] <= '9') i++;
      if (j === i) throw new Error('variavel sem numero em "' + s + '"');
      const v = vars ? vars[+s.slice(j, i)] : undefined;
      return v === undefined ? 0 : v;
    }
    const j = i;
    while (i < n && ((s[i] >= '0' && s[i] <= '9') || s[i] === '.')) i++;
    if (j === i) throw new Error('expressao invalida "' + s + '"');
    const v = parseFloat(s.slice(j, i));
    if (isNaN(v)) throw new Error('numero invalido em "' + s + '"');
    return v;
  }
  function produto() {
    let v = fator();
    for (;;) {
      esp();
      const c = s[i];
      if (c === 'x' || c === 'X') { i++; v *= fator(); }
      else if (c === '/') { i++; v /= fator(); }
      else return v;
    }
  }
  function soma() {
    let v = produto();
    for (;;) {
      esp();
      const c = s[i];
      if (c === '+') { i++; v += produto(); }
      else if (c === '-') { i++; v -= produto(); }
      else return v;
    }
  }
  const v = soma();
  esp();
  if (i < n) throw new Error('sobra "' + s.slice(i) + '" em "' + s + '"');
  return v;
}

/* quais modificadores de cada primitiva sao COMPRIMENTO (convertem de unidade); o resto e
   exposicao, contagem ou angulo */
const COMPRIMENTOS = {
  1: [1, 2, 3], 2: [1, 2, 3, 4, 5], 20: [1, 2, 3, 4, 5], 21: [1, 2, 3, 4], 22: [1, 2, 3, 4],
  5: [2, 3, 4], 6: [0, 1, 2, 3, 4, 6, 7], 7: [0, 1, 2, 3, 4],
};
function indicesComprimento(c, mods) {
  if (c === 4) {
    /* as coordenadas dos n+1 vertices - nunca alem do que o bloco traz (o n vem do arquivo) */
    const n = Math.max(0, Math.round(mods[1]) || 0), out = [];
    const fim = Math.min(2 + 2 * (n + 1), mods.length);
    for (let i = 2; i < fim; i++) out.push(i);
    return out;
  }
  return COMPRIMENTOS[c] || null;
}
/* Confere uma primitiva ja avaliada contra a spec e corrige o que passaria do limite (mexe em m);
   devolve o aviso, ou null. Sem isto um "5,1,1000000000,..." ou um contorno que declara 3e8
   vertices e traz 3 derrubava a aba. */
function normalizaPrimitiva(c, m) {
  if (c === 4) {
    const n = Math.round(m[1]);
    const traz = Math.max(0, Math.floor((m.length - 3) / 2) - 1);     /* vertices escritos (sem o que fecha) */
    if (n > traz) { m[1] = traz; return 'contorno (4) declara ' + n + ' vértices e traz ' + traz + ': usados os que vieram'; }
    return null;
  }
  if (c === 5) {
    const n = m[1];
    if (n >= 3 && n <= 12 && n === Math.round(n)) return null;
    const v = Math.min(12, Math.max(3, Math.round(n) || 3));
    m[1] = v;
    return 'polígono (5) com ' + n + ' vértices (a spec vai de 3 a 12): desenhado com ' + v;
  }
  if (c === 6) {
    const avisos = [];
    if (m[4] < 0) { m[4] = 0; avisos.push('moiré com vão negativo: tratado como 0'); }
    const r = (m[2] || 0) / 2, esp = m[3] || 0, vao = m[4] || 0;
    const pedidos = Math.max(0, Math.round(m[5] || 0));
    const cabem = esp > 0 && r > 0 ? Math.ceil(r / (esp + vao)) : 0;
    const aneis = Math.min(pedidos, cabem);
    if (aneis > LIMITE_ANEIS) { m[5] = LIMITE_ANEIS; avisos.push('moiré com ' + aneis + ' anéis: desenhados os ' + LIMITE_ANEIS + ' de fora'); }
    return avisos.length ? avisos.join('; ') : null;
  }
  return null;
}
/* avalia o corpo de uma macro com os parametros do %AD: -> [{codigo, mods}] com os
   comprimentos ja em mm (u = mm por unidade do arquivo) */
function avaliaMacro(mac, params, u, avisa) {
  const vars = {};
  for (let k = 0; k < params.length; k++) vars[k + 1] = params[k];
  const out = [];
  for (const it of mac.itens) {
    try {
      if (it.v !== undefined) { vars[it.v] = avaliaExpr(it.e, vars); continue; }
      const mods = it.e.map(e => avaliaExpr(e, vars));
      if (mods.some(v => !isFinite(v))) { avisa('macro ' + mac.nome + ': primitiva ' + it.c + ' com valor que não é número finito: ignorada'); continue; }
      const motivo = normalizaPrimitiva(it.c, mods);
      if (motivo) avisa('macro ' + mac.nome + ': ' + motivo);
      const L = indicesComprimento(it.c, mods);
      if (!L) { avisa('macro ' + mac.nome + ': primitiva ' + it.c + ' nao suportada'); continue; }
      const mm = mods.slice();
      for (const i of L) if (i < mm.length) mm[i] = mm[i] * u;
      out.push({ codigo: it.c, mods: mm });
    } catch (e) {
      avisa('macro ' + mac.nome + ': ' + e.message);
    }
  }
  return out;
}

/* ============================== 3. formas das aberturas ============================== */

/* Formas de uma abertura, em mm, relativas ao ponto do flash:
     {t:'circ', cx, cy, r} | {t:'poli', pts} | {t:'obl', cx, cy, w, h, rot} | {t:'anel', cx, cy, r1, r2}
   claro:true = exposicao desligada de macro: apaga o que a MESMA abertura ja pintou, entao a
                abertura tem de ser pintada em sequencia (a tela usa um canvas de rascunho);
   furo:true  = furo de abertura padrao: fica sempre dentro da forma, sai no mesmo caminho com o
                enrolamento invertido (regra nonzero) e nao apaga o que esta embaixo. Furo maior
                que a forma (fora da spec) entra so com o pedaco que cai dentro dela. */
function formaEFuro(ap) {
  const p = ap.params || [];
  let forma = null, furo = null;
  switch (ap.tipo) {
    case 'C': if (p[0] > 0) forma = { t: 'circ', cx: 0, cy: 0, r: p[0] / 2 }; break;
    case 'R': if (p[0] > 0 && p[1] > 0) forma = { t: 'poli', pts: retangulo(0, 0, p[0], p[1]) }; break;
    case 'O': if (p[0] > 0 && p[1] > 0) forma = { t: 'obl', cx: 0, cy: 0, w: p[0], h: p[1], rot: 0 }; break;
    case 'P': if (p[0] > 0) forma = { t: 'poli', pts: poligonoRegular(0, 0, p[0] / 2, p[1], p[2] || 0) }; break;
  }
  const f = ap.furo;
  if (forma && f) {
    if (f.length === 1 && f[0] > 0) furo = { t: 'circ', cx: 0, cy: 0, r: f[0] / 2, furo: true };
    else if (f.length >= 2 && f[0] > 0 && f[1] > 0) furo = { t: 'poli', pts: horario(retangulo(0, 0, f[0], f[1])), furo: true };
  }
  return { forma, furo };
}
/* poligono anti-horario de uma forma (circulo e oblongo achatados) */
function poligonoDaForma(f) {
  if (f.t === 'circ') return circuloPts(f.cx, f.cy, f.r);
  if (f.t === 'obl') return antiHorario(oblongoPts(f));
  return antiHorario(f.pts);
}
/* o ponto (x, y) esta na forma convexa f, com folga e? */
function naForma(f, x, y, e) {
  if (f.t === 'circ') return Math.hypot(x - f.cx, y - f.cy) <= f.r + e;
  if (f.t === 'obl') {
    const r = Math.min(f.w, f.h) / 2, m = Math.abs(f.w - f.h) / 2;
    const a = ((f.rot || 0) + (f.w >= f.h ? 0 : 90)) * RAD;
    const ux = Math.cos(a) * m, uy = Math.sin(a) * m;
    return distSegmento(x, y, f.cx - ux, f.cy - uy, f.cx + ux, f.cy + uy) <= r + e;
  }
  return dentroDoPoligono(x, y, f.pts) || distBorda(x, y, f.pts) <= e;
}
/* o furo cabe na forma? Toda abertura padrao e convexa e centrada na origem, como o furo: o
   redondo cabe se nao passa do raio inscrito; o retangular, se os 4 cantos caem dentro. */
function furoCabe(forma, furo) {
  const e = 1e-9;
  if (furo.t === 'circ') {
    const ri = forma.t === 'circ' ? forma.r : forma.t === 'obl' ? Math.min(forma.w, forma.h) / 2 : distBorda(0, 0, forma.pts);
    return furo.r <= ri + e;
  }
  return furo.pts.every(q => naForma(forma, q[0], q[1], e));
}
function formasPadrao(ap) {
  const ff = formaEFuro(ap);
  if (!ff.forma) return [];
  const out = [ff.forma], h = ff.furo;
  if (h && furoCabe(ff.forma, h)) out.push(h);
  else if (h) {
    /* O furo so tira da PROPRIA abertura. No mesmo caminho e com o enrolamento invertido, a sobra
       dele fora da forma ficava com enrolamento -1, e a regra nonzero a PINTAVA (e apagava o que
       estivesse embaixo). Entra so o pedaco do furo que cai dentro da forma. */
    const sp = poligonoDaForma(ff.forma);
    const corte = recortaConvexo(h.t === 'circ' ? circuloPts(h.cx, h.cy, h.r) : antiHorario(h.pts), sp);
    if (corte.length >= 3) {
      if (Math.abs(areaComSinal(corte)) >= Math.abs(areaComSinal(sp)) * (1 - 1e-9)) return [];   /* o furo engole a abertura */
      out.push({ t: 'poli', pts: horario(corte), furo: true });
    }
  }
  return out;
}
/* as 4 fatias do termico (primitiva 7) com centro na origem e sem rotacao */
function fatiasTermico(ro, ri, g) {
  const out = [];
  if (!(ro > 0) || !(ro > ri)) return out;
  if (g >= ro / Math.SQRT2) return out;                 /* o vao engoliu o anel */
  const base = [];
  const a0 = Math.asin(Math.min(1, g / ro)), a1 = Math.PI / 2 - a0;
  const n = passosArco(ro, a1 - a0);
  for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; base.push([ro * Math.cos(a), ro * Math.sin(a)]); }
  if (ri > g * Math.SQRT2) {
    const b0 = Math.asin(g / ri), b1 = Math.PI / 2 - b0;
    const m = passosArco(ri, b1 - b0);
    for (let k = 0; k <= m; k++) { const a = b1 - (b1 - b0) * k / m; base.push([ri * Math.cos(a), ri * Math.sin(a)]); }
  } else base.push([g, g]);
  for (let q = 0; q < 4; q++) out.push(base.map(p => rotaciona(p[0], p[1], 90 * q)));
  return out;
}
/* Formas das primitivas ja avaliadas de uma macro. Toda rotacao de primitiva e em torno da
   ORIGEM da macro (spec 2016+), inclusive a do centro do circulo e do termico. */
function formasMacro(prims) {
  const out = [];
  const giraTodos = (pts, rot) => (rot ? pts.map(q => rotaciona(q[0], q[1], rot)) : pts);
  for (const p of prims) {
    const m = p.mods;
    const claro = m[0] === 0;
    switch (p.codigo) {
      case 1: {
        if (!(m[1] > 0)) break;
        const c = rotaciona(m[2] || 0, m[3] || 0, m[4] || 0);
        out.push({ t: 'circ', cx: c[0], cy: c[1], r: m[1] / 2, claro });
        break;
      }
      case 2: case 20: {
        const w = m[1], x1 = m[2] || 0, y1 = m[3] || 0, x2 = m[4] || 0, y2 = m[5] || 0;
        const L = Math.hypot(x2 - x1, y2 - y1);
        if (!(w > 0) || !(L > 0)) break;
        const nx = -(y2 - y1) / L * w / 2, ny = (x2 - x1) / L * w / 2;
        const pts = [[x1 - nx, y1 - ny], [x2 - nx, y2 - ny], [x2 + nx, y2 + ny], [x1 + nx, y1 + ny]];
        out.push({ t: 'poli', pts: antiHorario(giraTodos(pts, m[6] || 0)), claro });
        break;
      }
      case 21: {
        if (!(m[1] > 0 && m[2] > 0)) break;
        out.push({ t: 'poli', pts: antiHorario(giraTodos(retangulo(m[3] || 0, m[4] || 0, m[1], m[2]), m[5] || 0)), claro });
        break;
      }
      case 22: {
        if (!(m[1] > 0 && m[2] > 0)) break;
        const x = m[3] || 0, y = m[4] || 0;
        const pts = [[x, y], [x + m[1], y], [x + m[1], y + m[2]], [x, y + m[2]]];
        out.push({ t: 'poli', pts: antiHorario(giraTodos(pts, m[5] || 0)), claro });
        break;
      }
      case 4: {
        /* o parse ja ajustou n ao que o bloco traz; o teto aqui protege quem monta a abertura a mao */
        const nd = Math.max(0, Math.round(m[1]) || 0);
        const n = Math.min(nd, Math.floor((m.length - 2) / 2));
        const pts = [];
        for (let k = 0; k <= n; k++) {
          const x = m[2 + 2 * k], y = m[3 + 2 * k];
          if (typeof x === 'number' && typeof y === 'number' && !isNaN(x) && !isNaN(y)) pts.push([x, y]);
        }
        if (pts.length > 1) {
          const a = pts[0], b = pts[pts.length - 1];
          if (Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12) pts.pop();
        }
        if (pts.length < 3) break;
        out.push({ t: 'poli', pts: antiHorario(giraTodos(pts, m[2 + 2 * (nd + 1)] || 0)), claro });
        break;
      }
      case 5: {
        if (!(m[4] > 0)) break;
        out.push({ t: 'poli', pts: antiHorario(giraTodos(poligonoRegular(m[2] || 0, m[3] || 0, m[4] / 2, m[1], 0), m[5] || 0)), claro });
        break;
      }
      case 6: {
        /* moire: aneis concentricos + mira; centro e mira giram em torno da origem */
        const cx = m[0] || 0, cy = m[1] || 0, rot = m[8] || 0;
        const c = rotaciona(cx, cy, rot);
        let r1 = (m[2] || 0) / 2;
        const esp = m[3] || 0, vao = Math.max(0, m[4] || 0), nmax = Math.max(0, Math.round(m[5] || 0));
        /* o parse ja cortou nmax no limite; o teto e a parada sem encolher protegem a abertura feita a mao */
        for (let k = 0; k < nmax && k < LIMITE_ANEIS && r1 > 0 && esp > 0; k++) {
          const r2 = Math.max(0, r1 - esp);
          out.push({ t: 'anel', cx: c[0], cy: c[1], r1, r2 });
          const prox = r2 - vao;
          if (!(prox < r1)) break;
          r1 = prox;
        }
        const ce = m[6] || 0, cl = m[7] || 0;
        if (ce > 0 && cl > 0) {
          out.push({ t: 'poli', pts: antiHorario(giraTodos(retangulo(cx, cy, cl, ce), rot)) });
          out.push({ t: 'poli', pts: antiHorario(giraTodos(retangulo(cx, cy, ce, cl), rot)) });
        }
        break;
      }
      case 7: {
        const cx = m[0] || 0, cy = m[1] || 0, rot = m[5] || 0;
        for (const fatia of fatiasTermico((m[2] || 0) / 2, (m[3] || 0) / 2, (m[4] || 0) / 2))
          out.push({ t: 'poli', pts: antiHorario(giraTodos(fatia.map(q => [q[0] + cx, q[1] + cy]), rot)) });
        break;
      }
    }
  }
  return out;
}
/* %LM / %LR / %LS: espelho, depois rotacao, depois escala, em torno do ponto do flash */
function transformaFormas(fs, espelho, rot, esc) {
  const mx = /X/.test(espelho || '') ? -1 : 1, my = /Y/.test(espelho || '') ? -1 : 1;
  const e = esc || 1;
  const tp = (x, y) => rotaciona(x * mx * e, y * my * e, rot || 0);
  const inverte = mx * my < 0;
  return fs.map(f => {
    switch (f.t) {
      case 'circ': { const c = tp(f.cx, f.cy); return Object.assign({}, f, { cx: c[0], cy: c[1], r: f.r * e }); }
      case 'anel': { const c = tp(f.cx, f.cy); return Object.assign({}, f, { cx: c[0], cy: c[1], r1: f.r1 * e, r2: f.r2 * e }); }
      case 'obl': {
        const c = tp(f.cx, f.cy);
        return Object.assign({}, f, { cx: c[0], cy: c[1], w: f.w * e, h: f.h * e, rot: (inverte ? -(f.rot || 0) : (f.rot || 0)) + (rot || 0) });
      }
      default: {
        const pts = f.pts.map(q => tp(q[0], q[1]));
        return Object.assign({}, f, { pts: f.furo ? horario(pts) : antiHorario(pts) });
      }
    }
  });
}
const cacheFormas = new WeakMap();
function formasDe(ap) {
  if (!ap) return [];
  let f = cacheFormas.get(ap);
  if (f) return f;
  f = ap.tipo === 'M' ? formasMacro(ap.macro || []) : formasPadrao(ap);
  if (ap.transf) f = transformaFormas(f, ap.transf.espelho, ap.transf.rot, ap.transf.escala);
  cacheFormas.set(ap, f);
  return f;
}
/* abertura que precisa de pintura em sequencia: alguma exposicao desligada depois de uma ligada */
function ehSequencial(fs) {
  let viuLigada = false;
  for (const f of fs) {
    if (f.claro) { if (viuLigada) return true; }
    else viuLigada = true;
  }
  return false;
}
/* caixa local [x1,y1,x2,y2] da abertura (das formas ligadas) */
const cacheExt = new WeakMap();
function extensao(ap) {
  if (!ap) return [0, 0, 0, 0];
  let e = cacheExt.get(ap);
  if (e) return e;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const inclui = (x, y) => { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; };
  for (const f of formasDe(ap)) {
    if (f.claro || f.furo) continue;
    if (f.t === 'circ') { inclui(f.cx - f.r, f.cy - f.r); inclui(f.cx + f.r, f.cy + f.r); }
    else if (f.t === 'anel') { inclui(f.cx - f.r1, f.cy - f.r1); inclui(f.cx + f.r1, f.cy + f.r1); }
    else if (f.t === 'obl') { for (const q of oblongoPts(f)) inclui(q[0], q[1]); }
    else for (const q of f.pts) inclui(q[0], q[1]);
  }
  e = x1 === Infinity ? [0, 0, 0, 0] : [x1, y1, x2, y2];
  cacheExt.set(ap, e);
  return e;
}
/* meia largura do traco que a abertura faz num D01 (circulo: o raio; o resto: metade do menor
   lado - so o circulo e garantido pela spec para arcos) */
function meiaLargura(ap) {
  if (!ap) return 0;
  const esc = ap.transf && ap.transf.escala || 1;
  if (ap.tipo === 'C') return (ap.params[0] || 0) * esc / 2;
  const e = extensao(ap);
  return Math.min(e[2] - e[0], e[3] - e[1]) / 2;
}
/* Poligono(s) da abertura posta em (x, y), em mm - para hit-test e medidas. Lista em ORDEM de
   pintura: {pts:[[x,y],...], claro}. claro = furo ou exposicao desligada: um ponto e escuro se o
   ULTIMO poligono que o contem nao e claro. */
function contornoDaAbertura(ap, x, y) {
  x = x || 0; y = y || 0;
  const out = [];
  const mv = pts => pts.map(q => [q[0] + x, q[1] + y]);
  for (const f of formasDe(ap)) {
    const claro = !!(f.claro || f.furo);
    if (f.t === 'circ') out.push({ pts: circuloPts(f.cx + x, f.cy + y, f.r), claro });
    else if (f.t === 'obl') out.push({ pts: mv(oblongoPts(f)), claro });
    else if (f.t === 'anel') {
      out.push({ pts: circuloPts(f.cx + x, f.cy + y, f.r1), claro });
      if (f.r2 > 0) out.push({ pts: circuloPts(f.cx + x, f.cy + y, f.r2), claro: true });
    } else out.push({ pts: mv(f.pts), claro });
  }
  return out;
}

/* ============================== 4. avisos e linhas ============================== */

/* lista de avisos sem repeticao: a mesma frase conta as vezes em vez de encher a lista */
function criaAvisos(lista, linhaAtual, max) {
  max = max || 60;
  const vistos = new Map();
  return function avisa(msg) {
    const v = vistos.get(msg);
    if (v) {
      v.n++;
      if (v.i >= 0) lista[v.i] = v.texto + ' (' + v.n + 'x)';
      return;
    }
    const linha = linhaAtual ? linhaAtual() : 0;
    const texto = msg + (linha ? ' - linha ' + linha : '');
    let i = -1;
    if (lista.length < max) { i = lista.length; lista.push(texto); }
    else if (lista.length === max) lista.push('... mais avisos omitidos');
    vistos.set(msg, { n: 1, i, texto });
  };
}
/* numero da linha de uma posicao do texto, contando de onde parou (as posicoes so crescem) */
function contadorDeLinhas(texto) {
  let p = 0, n = 1;
  return function (pos) {
    if (pos < p) { p = 0; n = 1; }
    for (; p < pos && p < texto.length; p++) if (texto.charCodeAt(p) === 10) n++;
    return n;
  };
}

/* ============================== 5. Gerber ============================== */

function desloca(p, dx, dy) {
  const q = Object.assign({}, p);
  switch (p.k) {
    case 'flash': q.x += dx; q.y += dy; break;
    case 'line': q.x1 += dx; q.y1 += dy; q.x2 += dx; q.y2 += dy; break;
    case 'arc': q.x1 += dx; q.y1 += dy; q.x2 += dx; q.y2 += dy; q.cx += dx; q.cy += dy; break;
    case 'region': q.contornos = p.contornos.map(c => c.map(v => [v[0] + dx, v[1] + dy])); break;
  }
  return q;
}
/* caixa [x1,y1,x2,y2] de um objeto, com a largura da abertura */
function caixaDe(p) {
  switch (p.k) {
    case 'flash': { const e = extensao(p.ap); return [p.x + e[0], p.y + e[1], p.x + e[2], p.y + e[3]]; }
    case 'line': {
      if (p.ap && p.ap.tipo !== 'C') {
        const e = extensao(p.ap);
        return [Math.min(p.x1, p.x2) + e[0], Math.min(p.y1, p.y2) + e[1], Math.max(p.x1, p.x2) + e[2], Math.max(p.y1, p.y2) + e[3]];
      }
      const h = meiaLargura(p.ap);
      return [Math.min(p.x1, p.x2) - h, Math.min(p.y1, p.y2) - h, Math.max(p.x1, p.x2) + h, Math.max(p.y1, p.y2) + h];
    }
    case 'arc': {
      const b = caixaArco(p.x1, p.y1, p.x2, p.y2, p.cx, p.cy, p.cw, p.circulo);
      const h = meiaLargura(p.ap);
      return [b[0] - h, b[1] - h, b[2] + h, b[3] + h];
    }
    case 'region': {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const c of p.contornos) for (const q of c) {
        if (q[0] < x1) x1 = q[0]; if (q[0] > x2) x2 = q[0];
        if (q[1] < y1) y1 = q[1]; if (q[1] > y2) y2 = q[1];
      }
      return [x1, y1, x2, y2];
    }
  }
  return null;
}
function caixaDosPrims(prims) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of prims) {
    if (!p.escuro) continue;
    const b = caixaDe(p);
    if (!b || !isFinite(b[0])) continue;
    if (b[0] < x1) x1 = b[0]; if (b[1] < y1) y1 = b[1];
    if (b[2] > x2) x2 = b[2]; if (b[3] > y2) y2 = b[3];
  }
  return x1 === Infinity ? null : { x1, y1, x2, y2 };
}

/* parse(texto, nome) -> camada em mm:
     { nome, funcao, unidades:'mm', prims, bbox, avisos, atributos, formato:'gerber', negativo?, corAltium? }
   corAltium = '#rrggbb' do comentario G04 Layer_Color do Altium (so quando o arquivo tem).
   prims: {k:'flash', x, y, ap} | {k:'line', x1,y1,x2,y2, ap} | {k:'arc', x1,y1,x2,y2, cx,cy, cw, ap, circulo?}
        | {k:'region', contornos:[[[x,y],...],...]} - todos com escuro (LPD/LPC), aperFunction (do
          %TA.AperFunction da abertura, ou o em vigor no G36 para regiao) e obj (os %TO) quando houver.
   ap: {d, tipo:'C'|'R'|'O'|'P'|'M', params, furo?, macro?, nomeMacro?, funcao?, transf?} - params
       em mm (P: [diametro, vertices, rotacao]); macro = primitivas avaliadas {codigo, mods} com os
       comprimentos ja em mm; furo = [diametro] ou [w, h] (furo retangular antigo).
   Entende: %FS (L/T, A/I, X23..X66), %MO e G70/G71, %AD (C R O P e macro), %AM (primitivas 0 1 2
   4 5 6 7 20 21 22, $n, atribuicao e aritmetica), D01/D02/D03 (e coordenada sem D = o D anterior),
   G01/G02/G03, G74/G75, G36/G37 (com arcos), %LP, %LM/%LR/%LS, %SR, G54Dnn, G90/G91,
   M00/M01/M02, %TF/%TA/%TO/%TD e o G04 #@! do X2. Aceita %IP (NEG marca negativo), %SF e %OF
   (aplicados), %MI e %AS (aplicados), %IN/%LN/%IR/%IJ/%IO/%PF/%KO (ignorados com aviso quando
   mudam algo). %AB (abertura em bloco) nao e desenhado: vira aviso. */
function parse(texto, nome) {
  texto = String(texto == null ? '' : texto);
  const cam = { nome: nome == null ? '' : String(nome), funcao: null, unidades: 'mm', prims: [], bbox: null, avisos: [], atributos: {}, formato: 'gerber' };
  let pos = 0;
  const linhaDe = contadorDeLinhas(texto);
  const avisa = criaAvisos(cam.avisos, () => linhaDe(pos));

  let fmt = null;              /* {zeros:'L'|'T', xi, xd, yi, yd} */
  let unid = null;             /* 'MM' | 'IN' */
  let absoluto = true;
  let interp = 1, quad = 0;    /* quad: 0 = nao declarado, 74 ou 75 */
  let ux = 0, uy = 0;          /* ponto corrente em mm, ANTES dos parametros de imagem */
  let apAtual = null, ultimoD = 0;
  let escuro = true;
  let lm = 'N', lr = 0, ls = 1;
  let regiao = null;           /* {contornos, atual, af} */
  let sr = null;               /* {nx, ny, dx, dy, buf} */
  let ta = {}, to = {}, objAttr = null;
  let emBloco = 0;             /* dentro de %ABDnn ... %AB: nada e desenhado */
  let fim = false;
  const img = { troca: false, sx: 1, sy: 1, mx: false, my: false, ox: 0, oy: 0, ident: true };
  const aps = new Map(), macros = new Map(), indef = new Map(), variantes = new WeakMap();

  function fator() {
    if (!unid) { avisa('sem %MO (unidade): assumido polegada'); unid = 'IN'; }
    return unid === 'IN' ? MM_POR_POL : 1;
  }
  function formato() {
    if (!fmt) { avisa('sem %FS (formato das coordenadas): assumido 2.4 com zeros a esquerda omitidos'); fmt = { zeros: 'L', xi: 2, xd: 4, yi: 2, yd: 4 }; }
    return fmt;
  }
  /* o numero de uma coordenada; NaN quando o texto nao e numero ("", ".", "-", "1.2.3"): quem
     chama avisa e mantem a anterior, em vez de o NaN virar coordenada modal e sumir com objetos */
  function numero(s, ni, nd) {
    if (s.indexOf('.') >= 0) return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : NaN;
    if (!/^[+-]?\d+$/.test(s)) return NaN;
    let neg = false, t = s;
    const c0 = t.charCodeAt(0);
    if (c0 === 43 || c0 === 45) { neg = c0 === 45; t = t.slice(1); }
    let v;
    if (fmt.zeros === 'T') {
      if (t.length < ni + nd) t += '0'.repeat(ni + nd - t.length);
      v = parseInt(t, 10) / Math.pow(10, t.length - ni);
    } else v = parseInt(t, 10) / Math.pow(10, nd);
    return neg ? -v : v;
  }
  function atualizaIdent() {
    img.ident = !img.troca && img.sx === 1 && img.sy === 1 && !img.mx && !img.my && img.ox === 0 && img.oy === 0;
  }
  function imagem(x, y, comDesloc) {
    if (img.ident) return [x, y];
    if (img.troca) { const t = x; x = y; y = t; }
    x *= img.sx; y *= img.sy;
    if (img.mx) x = -x;
    if (img.my) y = -y;
    if (comDesloc) { x += img.ox; y += img.oy; }
    return [x, y];
  }
  function emite(p) {
    if (emBloco) return;
    p.escuro = escuro;
    if (objAttr) p.obj = objAttr;
    if (sr) sr.buf.push(p); else cam.prims.push(p);
  }
  function indefinida(d) {
    let ap = indef.get(d);
    if (!ap) { ap = { d, tipo: 'C', params: [0], indefinida: true }; indef.set(d, ap); }
    return ap;
  }
  function abertura() {
    if (!apAtual) { avisa('desenho sem abertura selecionada (Dnn)'); apAtual = indefinida(0); }
    if (lm === 'N' && !lr && ls === 1) return apAtual;
    const k = lm + '|' + lr + '|' + ls;
    let mapa = variantes.get(apAtual);
    if (!mapa) { mapa = new Map(); variantes.set(apAtual, mapa); }
    let v = mapa.get(k);
    if (!v) { v = Object.assign({}, apAtual, { transf: { espelho: lm, rot: lr, escala: ls } }); mapa.set(k, v); }
    return v;
  }
  function comFuncao(p, ap) { if (ap.funcao) p.aperFunction = ap.funcao; return p; }

  /* ---- regiao ---- */
  function linhaRegiao(x0, y0, x1, y1) {
    const c = regiao.atual;
    if (!c.length) c.push([x0, y0]);
    const u = c[c.length - 1];
    if (u[0] !== x1 || u[1] !== y1) c.push([x1, y1]);
  }
  function arcoRegiao(x0, y0, x1, y1, cx, cy, cw, cheio) {
    const c = regiao.atual;
    if (!c.length) c.push([x0, y0]);
    for (const q of pontosArco(x0, y0, x1, y1, cx, cy, cw, cheio)) c.push(q);
  }
  function fechaContorno() {
    const c = regiao.atual;
    regiao.atual = [];
    if (c.length < 3) return;
    const a = c[0], b = c[c.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) c.pop();
    else if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-4) avisa('contorno de regiao nao fechado: fechado assim mesmo');
    if (c.length >= 3) regiao.contornos.push(c);
  }
  function fechaRegiao() {
    fechaContorno();
    const r = regiao;
    regiao = null;
    if (!r.contornos.length) return;
    const p = { k: 'region', contornos: r.contornos };
    const af = r.af || ta.AperFunction;
    if (af) p.aperFunction = af;
    emite(p);
  }

  /* ---- passo e repeticao ---- */
  function fechaSR() {
    const s = sr;
    sr = null;
    if (!s || !s.buf.length) return;
    /* nx x ny vem do arquivo: %SRX100000Y100000 sao 1e10 copias. Corta no limite de objetos. */
    const maxCopias = Math.max(1, Math.floor(LIMITE_OBJETOS / s.buf.length));
    if (s.nx * s.ny > maxCopias)
      avisa('passo e repetição de ' + s.nx + ' × ' + s.ny + ' com ' + s.buf.length + ' objeto(s) passa do limite de 1 milhão de objetos: desenhadas só as ' + maxCopias + ' primeiras cópias');
    let feitas = 0;
    for (let b = 0; b < s.ny && feitas < maxCopias; b++) for (let a = 0; a < s.nx && feitas < maxCopias; a++, feitas++) {
      const dx = a * s.dx, dy = b * s.dy;
      for (const p of s.buf) cam.prims.push(a === 0 && b === 0 ? p : desloca(p, dx, dy));
    }
  }
  function passoRepeticao(s) {
    if (sr) fechaSR();
    if (!s) return;
    const x = /X(\d+)/.exec(s), y = /Y(\d+)/.exec(s), i = /I([-+]?[\d.]+)/.exec(s), j = /J([-+]?[\d.]+)/.exec(s);
    const nx = x ? +x[1] : 1, ny = y ? +y[1] : 1;
    if (nx <= 1 && ny <= 1) return;
    const u = fator();
    const passo = m => { const v = m ? +m[1] * u : 0; if (isFinite(v)) return v; avisa('passo de %SR inválido "' + m[1] + '": tratado como 0'); return 0; };
    sr = { nx: Math.max(1, nx), ny: Math.max(1, ny), dx: passo(i), dy: passo(j), buf: [] };
  }

  /* ---- uma operacao D01/D02/D03 ---- */
  let avisouSemQuad = false, avisou74Neg = false;
  function operar(d, nx, ny, iv, jv) {
    const p0 = imagem(ux, uy, true);
    ux = nx; uy = ny;
    const p1 = imagem(nx, ny, true);
    const x0 = p0[0], y0 = p0[1], x1 = p1[0], y1 = p1[1];
    if (d === 2) { if (regiao) fechaContorno(); return; }
    if (d === 3) {
      if (regiao) { avisa('flash (D03) dentro de regiao: ignorado'); return; }
      const ap = abertura();
      emite(comFuncao({ k: 'flash', x: x1, y: y1, ap }, ap));
      return;
    }
    if (interp === 1) {
      if (regiao) { linhaRegiao(x0, y0, x1, y1); return; }
      const ap = abertura();
      emite(comFuncao({ k: 'line', x1: x0, y1: y0, x2: x1, y2: y1, ap }, ap));
      return;
    }
    /* arco: espelho (ou troca de eixos) inverte o sentido */
    let cw = interp === 2;
    if (img.troca !== (img.mx !== img.my)) cw = !cw;
    const tij = imagem(iv, jv, false);
    let modo = quad;
    if (!modo) {
      if (!avisouSemQuad) { avisouSemQuad = true; avisa('arco sem G74/G75: assumido G74 (quadrante unico), ou G75 se I/J tem sinal'); }
      modo = (iv < 0 || jv < 0) ? 75 : 74;
    } else if (modo === 74 && (iv < 0 || jv < 0)) {
      if (!avisou74Neg) { avisou74Neg = true; avisa('G74 com I/J negativo: tratado como G75'); }
      modo = 75;
    }
    const mesmo = Math.abs(x1 - x0) < 1e-9 && Math.abs(y1 - y0) < 1e-9;
    let cx, cy, cheio = false;
    if (modo === 75) {
      cx = x0 + tij[0]; cy = y0 + tij[1];
      cheio = mesmo;
    } else {
      if (mesmo) {
        /* G74 com inicio = fim: arco de comprimento zero */
        if (regiao) return;
        const ap = abertura();
        emite(comFuncao({ k: 'line', x1: x0, y1: y0, x2: x1, y2: y1, ap }, ap));
        return;
      }
      const ai = Math.abs(tij[0]), aj = Math.abs(tij[1]);
      let melhor = null;
      for (const s of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ccx = x0 + s[0] * ai, ccy = y0 + s[1] * aj;
        const r0 = Math.hypot(x0 - ccx, y0 - ccy), r1 = Math.hypot(x1 - ccx, y1 - ccy);
        const sw = varredura(Math.atan2(y0 - ccy, x0 - ccx), Math.atan2(y1 - ccy, x1 - ccx), cw);
        const nota = Math.abs(r0 - r1) + (sw <= Math.PI / 2 + 1e-3 ? 0 : 1e6);
        if (!melhor || nota < melhor.nota) melhor = { cx: ccx, cy: ccy, nota };
      }
      if (melhor.nota >= 1e6) avisa('arco G74 sem centro que de ate 90 graus: usado o mais proximo');
      cx = melhor.cx; cy = melhor.cy;
    }
    if (regiao) { arcoRegiao(x0, y0, x1, y1, cx, cy, cw, cheio); return; }
    const ap = abertura();
    const p = { k: 'arc', x1: x0, y1: y0, x2: x1, y2: y1, cx, cy, cw, ap };
    if (cheio) p.circulo = true;
    emite(comFuncao(p, ap));
  }

  /* ---- codigos G ---- */
  function codigoG(g) {
    switch (g) {
      case 1: interp = 1; break;
      case 2: interp = 2; break;
      case 3: interp = 3; break;
      case 10: case 11: case 12: interp = 1; avisa('G' + g + ' (interpolacao com escala, obsoleto) tratado como G01'); break;
      case 36:
        if (regiao) { avisa('G36 dentro de regiao'); fechaRegiao(); }
        regiao = { contornos: [], atual: [], af: ta.AperFunction };
        break;
      case 37:
        if (!regiao) { avisa('G37 sem G36'); break; }
        fechaRegiao();
        break;
      case 54: case 55: break;
      case 70: unid = 'IN'; break;
      case 71: unid = 'MM'; break;
      case 74: quad = 74; break;
      case 75: quad = 75; break;
      case 90: absoluto = true; break;
      case 91: absoluto = false; break;
      default: avisa('codigo G' + g + ' desconhecido: ignorado');
    }
  }

  /* ---- atributos X2 ---- */
  function atributo(p) {
    const tipo = p.slice(0, 2), resto = p.slice(2);
    if (tipo === 'TD') {
      const n = resto.replace(/^\./, '');
      if (!n) { ta = {}; to = {}; objAttr = null; return; }
      if (n in ta) { ta = Object.assign({}, ta); delete ta[n]; }
      if (n in to) { to = Object.assign({}, to); delete to[n]; objAttr = Object.keys(to).length ? to : null; }
      return;
    }
    const v = resto.indexOf(',');
    const n = (v < 0 ? resto : resto.slice(0, v)).replace(/^\./, '');
    const valor = v < 0 ? '' : resto.slice(v + 1);
    if (!n) { avisa('atributo %' + tipo + ' sem nome'); return; }
    if (tipo === 'TF') { cam.atributos[n] = valor; if (n === 'FileFunction') cam.funcao = valor; }
    else if (tipo === 'TA') { ta = Object.assign({}, ta); ta[n] = valor; }
    else if (tipo === 'TO') { to = Object.assign({}, to); to[n] = valor; objAttr = to; }
  }
  function comentario(t) {
    const m = /^#@!\s*(T[FAOD].*)$/.exec(t);
    if (m) { atributo(m[1].trim()); return; }
    /* G04 Layer_Color=<TColor>: o Altium escreve a cor da camada (BGR em decimal). Marca o
       arquivo como do Altium mesmo sem o TF.GenerationSoftware (o .GML dele e a Multi-Layer). */
    const c = /^Layer_Color=(\d+)$/.exec(t);
    if (c) cam.corAltium = bgrParaHex(+c[1]);
  }

  /* ---- aberturas e macros ---- */
  function defineMacro(nomeM, blocos) {
    const itens = [];
    for (const b of blocos) {
      const t = b.trim();
      if (!t) continue;
      if (/^0(\s|$)/.test(t) || (t[0] === '0' && t.length > 1 && !/[\d,.]/.test(t[1]))) continue;   /* comentario */
      const s = t.replace(/\s+/g, '');
      let m;
      if ((m = /^\$(\d+)=(.+)$/.exec(s))) { itens.push({ v: +m[1], e: m[2] }); continue; }
      if ((m = /^(\d+),(.*)$/.exec(s))) { itens.push({ c: +m[1], e: m[2].split(',') }); continue; }
      if (/^\d+$/.test(s)) { itens.push({ c: +s, e: [] }); continue; }
      avisa('macro ' + nomeM + ': bloco nao entendido "' + t + '"');
    }
    if (!nomeM) { avisa('%AM sem nome'); return; }
    macros.set(nomeM, { nome: nomeM, itens });
  }
  function defineAbertura(p) {
    const m = /^ADD(\d+)([^,]*)(?:,(.*))?$/.exec(p);
    if (!m) { avisa('%AD malformado: ' + p); return; }
    const d = parseInt(m[1], 10), modelo = m[2];
    let nums = m[3] != null && m[3] !== '' ? m[3].split(/[Xx]/).map(Number) : [];
    if (nums.some(v => !isFinite(v))) {
      /* "abc" e NaN, "1e999" e Infinity: os dois passavam calados (e o Infinity virava forma) */
      avisa('D' + d + ': parâmetro que não é número finito em "' + p + '": tratado como 0');
      nums = nums.map(v => (isFinite(v) ? v : 0));
    }
    const u = fator();
    let ap;
    if (modelo === 'C' || modelo === 'R' || modelo === 'O' || modelo === 'P') {
      const tamanhos = modelo === 'R' || modelo === 'O' ? 2 : 1;
      for (let k = 0; k < tamanhos; k++) if (nums[k] < 0) { avisa('D' + d + ': tamanho negativo em "' + p + '": abertura vazia'); nums[k] = 0; }
      let params, furo;
      if (modelo === 'C') { params = [(nums[0] || 0) * u]; furo = nums.slice(1); }
      else if (modelo === 'P') {
        /* vertices: a spec vai de 3 a 12, e o numero vem do arquivo (P,1X10000000 derrubava a aba) */
        let nv = nums[1];
        if (!(nv >= 3 && nv <= 12 && nv === Math.round(nv))) {
          const v = Math.min(12, Math.max(3, Math.round(nv) || 3));
          avisa('D' + d + ': polígono ' + (nv === undefined ? 'sem o número de vértices' : 'com ' + nv + ' vértices') + ' (a spec vai de 3 a 12): desenhado com ' + v);
          nv = v;
        }
        params = [(nums[0] || 0) * u, nv, nums[2] || 0]; furo = nums.slice(3);
      } else { params = [(nums[0] || 0) * u, (nums[1] || 0) * u]; furo = nums.slice(2); }
      ap = { d, tipo: modelo, params };
      if (furo.length) ap.furo = furo.map(v => v * u);
      if (ap.furo) {
        const ff = formaEFuro(ap);
        if (ff.forma && ff.furo && !furoCabe(ff.forma, ff.furo)) avisa('D' + d + ': furo maior que a abertura (fora da spec): só o pedaço dele que cai dentro dela fica vazado');
      }
    } else {
      const mac = macros.get(modelo);
      ap = { d, tipo: 'M', params: nums, nomeMacro: modelo, macro: [] };
      if (!mac) { avisa('macro "' + modelo + '" nao definida (D' + d + ')'); ap.indefinida = true; }
      else ap.macro = avaliaMacro(mac, nums, u, avisa);
    }
    if (ta.AperFunction) ap.funcao = ta.AperFunction;
    if (aps.has(d)) avisa('D' + d + ' redefinida');
    aps.set(d, ap);
  }
  function selecionaAbertura(d) {
    let ap = aps.get(d);
    if (!ap) { avisa('D' + d + ' usada sem %AD'); ap = indefinida(d); }
    apAtual = ap;
  }

  /* ---- comandos estendidos (%...%) ---- */
  function parametro(p) {
    const cod = p.slice(0, 2);
    switch (cod) {
      case 'FS': {
        const m = /^FS([LTD]?)([AI]?)(.*)$/.exec(p);
        const x = /X(\d)(\d)/.exec(m[3]), y = /Y(\d)(\d)/.exec(m[3]);
        if (!x || !y) avisa('%FS sem X/Y: ' + p);
        fmt = {
          zeros: m[1] === 'T' ? 'T' : 'L',
          xi: x ? +x[1] : 2, xd: x ? +x[2] : 4,
          yi: y ? +y[1] : (x ? +x[1] : 2), yd: y ? +y[2] : (x ? +x[2] : 4),
        };
        if (m[2] === 'I') absoluto = false;
        break;
      }
      case 'MO':
        if (/^MOIN/.test(p)) unid = 'IN';
        else if (/^MOMM/.test(p)) unid = 'MM';
        else avisa('%MO desconhecido: ' + p);
        break;
      case 'AD': defineAbertura(p); break;
      case 'LP': escuro = p[2] !== 'C'; break;
      case 'LM': lm = p.slice(2) || 'N'; break;
      case 'LR': {
        const v = parseFloat(p.slice(2));
        lr = isFinite(v) ? v : 0;
        if (v === Infinity || v === -Infinity) avisa('%LR com rotação infinita: tratada como 0');
        break;
      }
      case 'LS': {
        const v = parseFloat(p.slice(2));
        ls = v > 0 && isFinite(v) ? v : 1;
        if (v === Infinity) avisa('%LS com escala infinita: tratada como 1');
        break;
      }
      case 'SR': passoRepeticao(p.slice(2)); break;
      case 'TF': case 'TA': case 'TO': case 'TD': atributo(p); break;
      case 'IP':
        if (/NEG/.test(p)) { cam.negativo = true; avisa('%IPNEG: imagem negativa (obsoleto)'); }
        break;
      case 'SF': {
        const a = /A([-+]?[\d.]+)/.exec(p), b = /B([-+]?[\d.]+)/.exec(p);
        img.sx = a ? +a[1] || 1 : 1; img.sy = b ? +b[1] || 1 : 1;
        atualizaIdent();
        if (img.sx !== 1 || img.sy !== 1) avisa('%SF (escala, obsoleto) aplicado as coordenadas');
        break;
      }
      case 'OF': {
        const a = /A([-+]?[\d.]+)/.exec(p), b = /B([-+]?[\d.]+)/.exec(p);
        const u = fator();
        img.ox = a ? +a[1] * u || 0 : 0; img.oy = b ? +b[1] * u || 0 : 0;
        atualizaIdent();
        if (img.ox || img.oy) avisa('%OF (deslocamento, obsoleto) aplicado');
        break;
      }
      case 'MI':
        img.mx = /A1/.test(p); img.my = /B1/.test(p);
        atualizaIdent();
        if (img.mx || img.my) avisa('%MI (espelho, obsoleto) aplicado as coordenadas');
        break;
      case 'AS':
        img.troca = /^ASAY/.test(p);
        atualizaIdent();
        if (img.troca) avisa('%AS (troca de eixos, obsoleto) aplicado');
        break;
      case 'IR': if (parseFloat(p.slice(2))) avisa('%IR (rotacao da imagem, obsoleto) nao suportado: ignorado'); break;
      case 'IN': case 'LN': break;
      case 'IJ': case 'IO': case 'PF': case 'KO': avisa('%' + cod + ' (obsoleto) ignorado'); break;
      case 'AB': {
        const m = /^ABD(\d+)/.exec(p);
        if (m) { emBloco++; aps.set(+m[1], indefinida(+m[1])); avisa('%AB (abertura em bloco) nao suportado: D' + m[1] + ' fica vazia'); }
        else if (emBloco) emBloco--;
        break;
      }
      default: avisa('comando %' + cod + ' desconhecido: ignorado');
    }
  }
  function estendido(conteudo) {
    const c = conteudo.replace(/[\r\n]/g, '');
    const partes = c.split('*');
    const primeira = partes[0].trim();
    if (primeira.slice(0, 2) === 'AM') { defineMacro(primeira.slice(2).trim(), partes.slice(1)); return; }
    for (const p of partes) { const t = p.trim(); if (t) parametro(t); }
  }

  /* ---- bloco de dados (entre '*') ---- */
  function bloco(s) {
    if (s.charCodeAt(0) === 71 && /^G0*4(?![0-9])/.test(s)) { comentario(s.replace(/[\r\n]/g, '').replace(/^G0*4/, '').trim()); return; }
    s = s.replace(/\s+/g, '');
    if (!s) return;
    let gs = null, d = -1, m = -1, xs = null, ys = null, is = null, js = null;
    const L = s.length;
    let k = 0;
    while (k < L) {
      const ch = s.charCodeAt(k++);
      let j = k;
      const c2 = s.charCodeAt(j);
      if (c2 === 43 || c2 === 45) j++;
      while (j < L) { const c3 = s.charCodeAt(j); if ((c3 >= 48 && c3 <= 57) || c3 === 46) j++; else break; }
      const num = s.slice(k, j);
      k = j;
      switch (ch) {
        case 71: (gs || (gs = [])).push(parseInt(num, 10)); break;       /* G */
        case 68: d = parseInt(num, 10); break;                             /* D */
        case 77: m = parseInt(num, 10); break;                             /* M */
        case 88: xs = num; break;                                          /* X */
        case 89: ys = num; break;                                          /* Y */
        case 73: is = num; break;                                          /* I */
        case 74: js = num; break;                                          /* J */
        case 78: break;                                                    /* N: numero de sequencia */
        default: avisa('caractere inesperado "' + String.fromCharCode(ch) + '" num bloco de dados');
      }
    }
    if (gs) for (const g of gs) { if (isNaN(g)) avisa('codigo G sem numero'); else codigoG(g); }
    if (m >= 0) {
      if (m === 2 || m === 0) fim = true;
      else if (m !== 1) avisa('codigo M' + m + ' ignorado');
      return;
    }
    const temCoord = xs !== null || ys !== null || is !== null || js !== null;
    if (d >= 10) { selecionaAbertura(d); if (!temCoord) return; d = -1; }
    else if (d === 0 || d > 3) { avisa('codigo D' + d + ' reservado: ignorado'); return; }
    if (!temCoord && d < 0) return;
    let op = d > 0 ? d : ultimoD;
    if (!op) { avisa('coordenada sem D01/D02/D03: tratada como D02'); op = 2; }
    ultimoD = op;
    const f = formato(), u = fator();
    /* coordenada que nao e numero ("X.", "Y-"): avisa, e vale a anterior (X/Y) ou 0 (I/J) */
    const le = (s, ni, nd, eixo) => {
      const v = numero(s, ni, nd);
      if (isFinite(v)) return v * u;
      avisa('coordenada ' + eixo + ' inválida "' + s + '": ' + (eixo === 'X' || eixo === 'Y' ? 'mantida a anterior' : 'tratada como 0'));
      return null;
    };
    let nx = ux, ny = uy;
    if (xs !== null) { const v = le(xs, f.xi, f.xd, 'X'); if (v !== null) nx = absoluto ? v : ux + v; }
    if (ys !== null) { const v = le(ys, f.yi, f.yd, 'Y'); if (v !== null) ny = absoluto ? v : uy + v; }
    const iv = is !== null ? le(is, f.xi, f.xd, 'I') || 0 : 0;
    const jv = js !== null ? le(js, f.yi, f.yd, 'J') || 0 : 0;
    operar(op, nx, ny, iv, jv);
  }

  /* ---- varredura do texto ---- */
  const n = texto.length;
  /* G04 com '%' no texto: a spec nao deixa, mas o gerbv e o KiCad leem o comentario ate o '*', e
     no pior caso so ele se perde. O '%' so e o comeco do proximo comando quando abre a linha (um
     G04 que perdeu o '*'). Antes, "G04 escala 100% *" levava o arquivo inteiro junto. */
  const ehG04 = k => texto.charCodeAt(k) === 71 && /^G0*4(?![0-9])/.test(texto.slice(k, k + 12));
  function abreLinha(p, ini) {
    for (let k = p - 1; k > ini; k--) {
      const c = texto.charCodeAt(k);
      if (c === 10 || c === 13) return true;
      if (c !== 32 && c !== 9) return false;
    }
    return false;
  }
  /* comentario que embrulha um comando (G04 %ADD99C,5*%*): vai ate o '*' depois do '%' da mesma linha */
  function fimDoG04(j) {
    let k = j + 1;
    while (k < n && (texto.charCodeAt(k) === 32 || texto.charCodeAt(k) === 9)) k++;
    if (texto.charCodeAt(k) !== 37) return j;
    for (let q = k + 1; q < n; q++) {
      const c = texto.charCodeAt(q);
      if (c === 10 || c === 13) return j;
      if (c === 42) return q;
    }
    return j;
  }
  let i = 0;
  let proxPct = texto.indexOf('%');                    /* o proximo '%' (achado uma vez so) */
  if (proxPct < 0) proxPct = n;
  while (i < n && !fim) {
    const c = texto.charCodeAt(i);
    if (c === 10 || c === 13 || c === 32 || c === 9) { i++; continue; }
    pos = i;
    if (c === 37) {                                    /* % ... % */
      let j = texto.indexOf('%', i + 1);
      if (j < 0) { avisa('comando % sem fechamento'); j = n; }
      estendido(texto.slice(i + 1, j));
      i = j + 1;
      proxPct = texto.indexOf('%', i);
      if (proxPct < 0) proxPct = n;
      continue;
    }
    let j = texto.indexOf('*', i);
    if (j < 0) j = n;
    if (proxPct < j && ehG04(i) && !abreLinha(proxPct, i)) {
      j = fimDoG04(j);
      bloco(texto.slice(i, j));
      i = j + 1;
      proxPct = texto.indexOf('%', i);
      if (proxPct < 0) proxPct = n;
      continue;
    }
    /* um % no meio de um bloco sem * e o comeco do proximo comando */
    if (proxPct < j) { avisa('bloco sem "*" antes de %'); bloco(texto.slice(i, proxPct)); i = proxPct; continue; }
    bloco(texto.slice(i, j));
    i = j + 1;
  }
  if (regiao) { avisa('arquivo terminou dentro de regiao (G36 sem G37)'); fechaRegiao(); }
  if (sr) fechaSR();
  if (!fim && texto.trim()) { pos = n; avisa('arquivo sem M02 (fim)'); }
  cam.bbox = caixaDosPrims(cam.prims);
  return cam;
}

/* ============================== 6. Excellon ============================== */

/* parseExcellon(texto, nome) -> o mesmo formato do parse(): furo = flash de abertura circular
   ('C' com o diametro da ferramenta), slot (G85 ou fresagem G00/M15/G01/G02/G03/M16) = line/arc.
   Entende M48, METRIC/INCH (e M71/M72), LZ/TZ, formato (000.000, ;FILE_FORMAT=2:5, FORMAT={3:3/...}),
   T com C<diametro>, coordenada modal, G90/G91 e ICI, R (repeticao), G93, e os atributos
   "; #@! TF..." do X2 e ";TYPE=PLATED/NON_PLATED" do Altium. */
function parseExcellon(texto, nome) {
  texto = String(texto == null ? '' : texto);
  const cam = { nome: nome == null ? '' : String(nome), funcao: null, unidades: 'mm', prims: [], bbox: null, avisos: [], atributos: {}, formato: 'excellon' };
  let nl = 0;
  const avisa = criaAvisos(cam.avisos, () => nl);
  let unid = null, zeros = null, ni = null, nd = null;
  let absoluto = true, cabecalho = false;
  let rota = false, desce = false, gRota = 1;
  let x = 0, y = 0, ox = 0, oy = 0;
  let t = null, tipoFuro = null;
  const ferr = new Map(), aps = new Map();
  const temM15 = /^\s*M15\b/m.test(texto);
  let ultimoFuro = null;

  function fatorU() {
    if (!unid) { avisa('sem METRIC/INCH: assumido polegada'); unid = 'IN'; }
    return unid === 'IN' ? MM_POR_POL : 1;
  }
  function digitos() {
    if (ni == null || nd == null) {
      if (unid === 'MM') { ni = ni == null ? 3 : ni; nd = nd == null ? 3 : nd; }
      else { ni = ni == null ? 2 : ni; nd = nd == null ? 4 : nd; }
    }
  }
  /* zeros nao declarados: decide pelos numeros do arquivo (zero a esquerda = LZ) */
  function adivinhaZeros() {
    let esq = 0, dir = 0;
    const re = /[XY][-+]?(\d+)(?![\d.])/g;
    let m, k = 0;
    while ((m = re.exec(texto)) && k++ < 5000) {
      const s = m[1];
      if (s.length > 1 && s[0] === '0') esq++;
      if (s.length > 1 && s[s.length - 1] === '0') dir++;
    }
    zeros = esq >= dir ? 'LZ' : 'TZ';
    avisa('zeros (LZ/TZ) nao declarados: assumido ' + zeros);
  }
  /* digitos do formato: vem do arquivo (FILE_FORMAT=500000000:0 pedia uma string de 500 MB) */
  function poeDigitos(a, b) {
    if (a > 9 || b > 9) { avisa('formato ' + a + ':' + b + ' fora do comum: limitado a 9 dígitos de cada lado'); a = Math.min(a, 9); b = Math.min(b, 9); }
    ni = a; nd = b;
  }
  /* valor de uma coordenada em mm; null quando ausente ou quando nao e numero (".", "-", "1.2.3"):
     com aviso, e quem chama fica com o anterior - antes o NaN virava coordenada modal calado */
  function val(s) {
    if (s == null || s === '') return null;
    const u = fatorU();
    if (s.indexOf('.') >= 0) {
      if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s)) return parseFloat(s) * u;
      avisa('número inválido "' + s + '": ignorado (vale o anterior)');
      return null;
    }
    if (!/^[+-]?\d+$/.test(s)) { avisa('número inválido "' + s + '": ignorado (vale o anterior)'); return null; }
    digitos();
    if (!zeros) adivinhaZeros();
    let neg = false, q = s;
    if (q[0] === '+' || q[0] === '-') { neg = q[0] === '-'; q = q.slice(1); }
    let v;
    if (zeros === 'LZ') {                     /* zeros a esquerda presentes: os da direita faltam */
      if (q.length < ni + nd) q += '0'.repeat(ni + nd - q.length);
      v = parseInt(q, 10) / Math.pow(10, q.length - ni);
    } else v = parseInt(q, 10) / Math.pow(10, nd);
    return (neg ? -v : v) * u;
  }
  function ferramenta(n) {
    let ap = aps.get(n);
    if (!ap) {
      const d = ferr.get(n);
      if (d === undefined) avisa('ferramenta T' + n + ' sem diametro: desenhada com 0');
      ap = { d: n, tipo: 'C', params: [(d || 0) * fatorU()], ferramenta: n };
      aps.set(n, ap);
    }
    return ap;
  }
  function apAtual() {
    if (!t) { avisa('furo sem ferramenta selecionada'); t = ferramenta(0); }
    return t;
  }
  function furo(px, py) {
    const p = { k: 'flash', x: px, y: py, ap: apAtual(), escuro: true };
    cam.prims.push(p);
    ultimoFuro = p;
  }
  function unidades(L) {
    unid = /^METRIC/.test(L) ? 'MM' : 'IN';
    if (/,\s*LZ/.test(L)) zeros = 'LZ';
    else if (/,\s*TZ/.test(L)) zeros = 'TZ';
    const f = /,\s*(0+)\.(0+)/.exec(L);
    if (f) poeDigitos(f[1].length, f[2].length);
  }
  function comentarioExc(c) {
    let m;
    if ((m = /^#@!\s*TF\.([^,]+),?(.*)$/.exec(c))) {
      cam.atributos[m[1]] = m[2].trim();
      if (m[1] === 'FileFunction') cam.funcao = m[2].trim();
      return;
    }
    if ((m = /FILE_FORMAT\s*=\s*(\d+)\s*:\s*(\d+)/i.exec(c))) { poeDigitos(+m[1], +m[2]); return; }
    if ((m = /TYPE\s*=\s*(NON_PLATED|PLATED)/i.exec(c))) { tipoFuro = m[1].toUpperCase(); cam.atributos.TYPE = tipoFuro; return; }
    if ((m = /FORMAT\s*=\s*\{([^}]*)\}/i.exec(c))) {
      const f = m[1].toLowerCase();
      const dg = /(\d+)\s*:\s*(\d+)/.exec(f);
      if (dg) poeDigitos(+dg[1], +dg[2]);
      if (/metric/.test(f)) unid = unid || 'MM';
      else if (/inch/.test(f)) unid = unid || 'IN';
      if (/suppress\s+trailing/.test(f)) zeros = 'LZ';
      else if (/suppress\s+leading/.test(f)) zeros = 'TZ';
      else if (/keep\s+zeros/.test(f)) zeros = zeros || 'LZ';
    }
  }
  function arcoRota(x0, y0, x1, y1, g, toks) {
    const cw = g === 2;
    let cx, cy;
    if (toks.A != null && toks.A !== '') {
      const r = Math.abs(val(toks.A));
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, dx = x1 - x0, dy = y1 - y0, dd = Math.hypot(dx, dy);
      if (!(dd > 0) || r < dd / 2 - 1e-9) {
        avisa('arco de fresagem com raio impossivel: virou reta');
        cam.prims.push({ k: 'line', x1: x0, y1: y0, x2: x1, y2: y1, ap: apAtual(), escuro: true });
        return;
      }
      const h = Math.sqrt(Math.max(0, r * r - dd * dd / 4));
      const lx = -dy / dd, ly = dx / dd;                 /* normal a esquerda do sentido */
      const s = cw ? -1 : 1;                             /* arco curto: centro a direita no horario */
      cx = mx + s * h * lx; cy = my + s * h * ly;
    } else {
      cx = x0 + (val(toks.I) || 0); cy = y0 + (val(toks.J) || 0);
    }
    cam.prims.push({ k: 'arc', x1: x0, y1: y0, x2: x1, y2: y1, cx, cy, cw, ap: apAtual(), escuro: true });
  }
  function coord(toks) {
    let nx = x, ny = y;
    const vx = val(toks.X), vy = val(toks.Y);
    if (vx != null) nx = absoluto ? vx + ox : x + vx;
    if (vy != null) ny = absoluto ? vy + oy : y + vy;
    return [nx, ny];
  }

  const linhas = texto.split(/\r\n|\r|\n/);
  for (nl = 1; nl <= linhas.length; nl++) {
    let l = linhas[nl - 1].trim();
    if (!l) continue;
    if (l[0] === ';') { comentarioExc(l.slice(1).trim()); continue; }
    const sc = l.indexOf(';');
    if (sc > 0) l = l.slice(0, sc).trim();
    const L = l.toUpperCase();
    if (L === 'M48') { cabecalho = true; continue; }
    if (L === '%' || L === 'M95') { cabecalho = false; continue; }
    if (/^(METRIC|INCH)\b/.test(L)) { unidades(L); continue; }
    if (L === 'M71') { unid = 'MM'; continue; }
    if (L === 'M72') { unid = 'IN'; continue; }
    if (L === 'M30' || L === 'M00') break;
    if (L === 'G90') { absoluto = true; continue; }
    if (L === 'G91') { absoluto = false; continue; }
    if (/^ICI/.test(L)) { absoluto = !/ON/.test(L) && L !== 'ICI'; continue; }
    if (L === 'G05' || L === 'G81') { rota = false; desce = false; continue; }
    if (L === 'M15') { desce = true; continue; }
    if (L === 'M16' || L === 'M17') { desce = false; continue; }
    if (L === 'G92') continue;                         /* o CAMtastic abre o arquivo com um G92 solto */
    if (/^G4[012]$/.test(L) || L === 'G07' || L === 'G32' || L === 'G33' || L === 'G34' || L === 'G35') continue;
    if (/^(VER|FMAT|DETECT|ATC|AFS|BLKD|CCW|CP|DN|DTMDIST|EXDA|FSB|HPCK|NCSL|OM48|OSTOP|OTCLMP|PCKPARAM|PF|PPR|PVS|RC|RCP|RRT|RSB|SBK|SG|SI|TCST|THCK|TOOLLOAD|UP|UPCK|ZA|ZC|ZS|ZZ|M47|M97|M98|M99|M25|M31|M01|M02|M06|M08|M09|M50|M51|M52|M60|M70|M73|M74|M80|M90|M93|M94)\b/.test(L)) {
      if (/^M(97|98|25|31|02|08|50|51|52|60|70|80|90|93)/.test(L)) avisa('comando ' + L.slice(0, 3) + ' (padrao/texto de Excellon) ignorado');
      continue;
    }
    let m;
    if ((m = /^T(\d+)(.*)$/.exec(L)) && !/[XY]/.test(m[2])) {
      const n = parseInt(m[1], 10);
      /* o CAMtastic num Windows em pt-BR escreve o diametro com virgula: T01C0,0315 */
      const mc = /C\s*([-+]?\d*[.,]?\d+)/.exec(m[2]);
      if (mc) { ferr.set(n, parseFloat(mc[1].replace(',', '.'))); aps.delete(n); }
      if (!cabecalho) t = n === 0 ? null : ferramenta(n);
      else if (!mc) avisa('ferramenta T' + n + ' sem diametro no cabecalho');
      continue;
    }
    if (/^G93/.test(L)) {
      const tk = {};
      L.replace(/([XY])([-+]?[\d.]+)/g, (a, k, v) => { tk[k] = v; });
      ox = val(tk.X) || 0; oy = val(tk.Y) || 0;
      continue;
    }
    if (cabecalho) { avisa('linha de cabecalho ignorada: ' + L.slice(0, 24)); continue; }
    /* slot G85: X..Y..G85X..Y.. */
    const i85 = L.indexOf('G85');
    if (i85 >= 0) {
      const tk1 = {}, tk2 = {};
      L.slice(0, i85).replace(/([XY])([-+]?[\d.]+)/g, (a, k, v) => { tk1[k] = v; });
      L.slice(i85 + 3).replace(/([XY])([-+]?[\d.]+)/g, (a, k, v) => { tk2[k] = v; });
      const a = coord(tk1);
      x = a[0]; y = a[1];
      const b = coord(tk2);
      cam.prims.push({ k: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], ap: apAtual(), escuro: true });
      x = b[0]; y = b[1];
      continue;
    }
    /* T junto da coordenada (X..Y..T01) */
    const mt = /T(\d+)/.exec(L);
    if (mt) t = +mt[1] === 0 ? null : ferramenta(+mt[1]);
    const toks = {};
    let g = null, bad = false;
    L.replace(/T\d+/, '').replace(/([A-Z])([-+]?[\d.]*)/g, (a, k, v) => {
      if (k === 'G') g = parseInt(v, 10);
      else if ('XYIJAR'.indexOf(k) >= 0) toks[k] = v;
      else if (k === 'M') { if (v === '15') desce = true; else if (v === '16' || v === '17') desce = false; }
      else bad = true;
      return '';
    });
    if (bad) avisa('linha nao entendida: ' + L.slice(0, 32));
    if (toks.R != null && toks.R !== '' && !g) {
      /* repeticao: R<n>X<dx>Y<dy> repete o ultimo furo n vezes - com teto: R999999999 derrubava a aba */
      let nrep = parseInt(toks.R, 10) || 0;
      const resta = Math.max(0, LIMITE_OBJETOS - cam.prims.length);
      if (nrep > resta) { avisa('repetição R' + toks.R + ' passa do limite de 1 milhão de objetos: cortada em ' + resta); nrep = resta; }
      const dx = val(toks.X) || 0, dy = val(toks.Y) || 0;
      for (let k = 0; k < nrep; k++) { x += dx; y += dy; furo(x, y); }
      continue;
    }
    if (toks.X == null && toks.Y == null && g == null) continue;
    if (g === 0) { rota = true; desce = false; const p = coord(toks); x = p[0]; y = p[1]; continue; }
    if (g === 1 || g === 2 || g === 3) { rota = true; gRota = g; }
    else if (g != null) { avisa('codigo G' + g + ' de Excellon ignorado'); if (toks.X == null && toks.Y == null) continue; }
    const p = coord(toks);
    if (rota) {
      if (desce || !temM15) {
        if (gRota === 1) cam.prims.push({ k: 'line', x1: x, y1: y, x2: p[0], y2: p[1], ap: apAtual(), escuro: true });
        else arcoRota(x, y, p[0], p[1], gRota, toks);
      }
      x = p[0]; y = p[1];
      continue;
    }
    x = p[0]; y = p[1];
    furo(x, y);
  }
  if (!cam.funcao && tipoFuro) cam.funcao = tipoFuro === 'PLATED' ? 'Plated,1,2,PTH' : 'NonPlated,1,2,NPTH';
  cam.bbox = caixaDosPrims(cam.prims);
  return cam;
}

/* ============================== 7. camadas ============================== */

/* Cores. Camada que existe no board.js (Top, Mid1, TopOverlay, Mech13...) tem a cor da tabela da
   vista PCB - HubCore.PCB_LAYERS, contrato secao 1b: as medidas no G04 Layer_Color dos Gerbers da
   casa -, para a mesma camada ter a mesma cor nas duas vistas. corPadrao e a copia dessa tabela
   para quando o hub-core nao esta carregado (o contrato 1b, e para o resto as paletas dele). As
   camadas que so existem no Gerber (pads, perfil, furos) tem cor propria, aqui.
   ordem = ordem de PINTURA na vista de cima (baixo primeiro, perfil e furos por ultimo). */
const COR = { pads: '#c0c0c0', perfil: '#e0e0e0', pth: '#ffffff', npth: '#00e5ff', outro: '#9a9a9a' };
const COR_1B = {
  Top: '#ff0000', Bottom: '#0000ff', Mid1: '#bc8e00', Mid2: '#70dbfa', TopOverlay: '#ffff00', BottomOverlay: '#808000',
  TopPaste: '#808080', BottomPaste: '#800000', TopSolder: '#800080', BottomSolder: '#ff00ff', DrillGuide: '#800000',
  KeepOut: '#ff00ff', DrillDrawing: '#ff002a', Mech1: '#ff00ff', Mech13: '#ff00ff', Mech15: '#008000', Multi: '#c0c0c0',
};
/* as mecanicas sem medida: a lista do hub-core (MECH_CORES), de Mech2 em diante */
const MECH_CORES = ['#00ffff', '#ff8000', '#80ff00', '#00ff80', '#0080ff', '#8000ff', '#ff0080',
                    '#00c0c0', '#c08000', '#80c000', '#00c060', '#4060ff', '#c060ff', '#ff6060', '#60ffc0'];
const PALETA_MEC = ['#ff00ff', '#b4b4ff', '#00ff80', '#ffb400', '#7f7fff', '#ff7f7f', '#7fff7f', '#c0a0ff'];
const LADO_NOME = { top: 'cima', bottom: 'baixo' };
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  const x = v => ('0' + Math.round(v * 255).toString(16)).slice(-2);
  return '#' + x(f(0)) + x(f(8)) + x(f(4));
}
/* a cor da tabela da vista PCB sem o hub-core: as do contrato 1b e, para o resto, as paletas dele
   (Mid3.. e planos pelo angulo aureo, mecanicas pela lista). null = a chave nao e do board.js */
function corPadrao(chave) {
  if (COR_1B[chave]) return COR_1B[chave];
  const m = /^(Mid|Plane|Mech)(\d+)$/.exec(String(chave));
  if (!m || !(+m[2] >= 1)) return null;
  const i = +m[2];
  if (m[1] === 'Mid') return hslHex((30 + (i - 1) * 137.508) % 360, 90, i % 2 ? 60 : 48);
  if (m[1] === 'Plane') return hslHex((150 + (i - 1) * 137.508) % 360, 55, 38);
  return MECH_CORES[(i - 2 + MECH_CORES.length) % MECH_CORES.length];
}
/* a tabela da vista PCB: o HubCore global (navegador, o pcbframe carrega o hub-core.js) ou o
   hub-core.js do lado (Node). Sem nenhum dos dois, corPadrao. */
let hcNode;
function hubCore() {
  const g = typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : null;
  const hc = g && g.HubCore;
  if (hc && typeof hc.pcbLayer === 'function') return hc;
  if (hcNode === undefined) {
    hcNode = null;
    try {
      if (typeof module === 'object' && module && module.exports && typeof require === 'function') {
        const m = require('./hub-core.js');
        if (m && typeof m.pcbLayer === 'function') hcNode = m;
      }
    } catch (e) { hcNode = null; }
  }
  return hcNode;
}
function corDe(chave) {
  let r = null;
  try { const hc = hubCore(); r = hc ? hc.pcbLayer(chave) : null; } catch (e) { r = null; }
  return (r && r.color) || corPadrao(chave) || COR.outro;
}
/* TColor do Altium (BGR em decimal, do G04 Layer_Color) -> '#rrggbb' */
function bgrParaHex(d) {
  const x = v => ('0' + (v & 255).toString(16)).slice(-2);
  return '#' + x(d) + x(d >> 8) + x(d >> 16);
}

function info(chave, nome, cor, ordem, lado, tipo) { return { chave, nome, cor, ordem, lado, tipo }; }
const C = {
  cobre: l => l === 'bottom' ? info('Bottom', 'Cobre (baixo)', corDe('Bottom'), 130, 'bottom', 'cobre') : info('Top', 'Cobre (cima)', corDe('Top'), 200, 'top', 'cobre'),
  interno: (n, plano) => {
    n = Math.max(1, n | 0);
    const k = (plano ? 'Plane' : 'Mid') + n;
    return info(k, (plano ? 'Plano interno ' : 'Cobre interno ') + n, corDe(k), 200 - n, null, 'cobre');
  },
  pads: l => l === 'bottom' ? info('PadsBottom', 'Pads (baixo)', COR.pads, 125, 'bottom', 'pads') : info('PadsTop', 'Pads (cima)', COR.pads, 205, 'top', 'pads'),
  legenda: l => l === 'bottom' ? info('BottomOverlay', 'Serigrafia (baixo)', corDe('BottomOverlay'), 100, 'bottom', 'legenda') : info('TopOverlay', 'Serigrafia (cima)', corDe('TopOverlay'), 230, 'top', 'legenda'),
  mascara: l => l === 'bottom' ? info('BottomSolder', 'Máscara (baixo)', corDe('BottomSolder'), 120, 'bottom', 'mascara') : info('TopSolder', 'Máscara (cima)', corDe('TopSolder'), 210, 'top', 'mascara'),
  pasta: l => l === 'bottom' ? info('BottomPaste', 'Pasta (baixo)', corDe('BottomPaste'), 110, 'bottom', 'pasta') : info('TopPaste', 'Pasta (cima)', corDe('TopPaste'), 220, 'top', 'pasta'),
  perfil: () => info('Profile', 'Perfil (contorno)', COR.perfil, 400, null, 'perfil'),
  pth: () => info('DrillPTH', 'Furos metalizados (PTH)', COR.pth, 420, null, 'furo'),
  npth: () => info('DrillNPTH', 'Furos não metalizados (NPTH)', COR.npth, 410, null, 'furo'),
  furos: () => info('Drill', 'Furos', COR.pth, 420, null, 'furo'),
  mec: n => { n = Math.max(1, n | 0); const k = 'Mech' + n; return info(k, 'Mecânica ' + n, corDe(k), 300 + n, null, 'mecanica'); },
  keepout: () => info('KeepOut', 'Keep-Out', corDe('KeepOut'), 350, null, 'mecanica'),
  desenho: () => info('DrillDrawing', 'Desenho de furos', corDe('DrillDrawing'), 330, null, 'mecanica'),
  guia: () => info('DrillGuide', 'Guia de furos', corDe('DrillGuide'), 331, null, 'mecanica'),
  livre: () => info('Drawing', 'Desenho', PALETA_MEC[1], 332, null, 'mecanica'),
  /* a Multi-Layer do Altium (o .GML dele): pads e vias passantes, dos dois lados - por isso nao e
     camada de lado e pinta por cima do cobre nas duas vistas */
  multi: () => info('Multi', 'Multi-Layer (passantes)', corDe('Multi'), 240, null, 'multi'),
  /* o -BoardEdgeRout.TXT do Altium: o caminho da fresa do contorno (Excellon), nem perfil nem furo */
  rota: () => info('BoardEdgeRout', 'Fresagem do contorno', PALETA_MEC[5], 339, null, 'mecanica'),
  outro: nome => info('Other', nome || 'Outra camada', COR.outro, 360, null, 'outro'),
};
function ladoDe(s) {
  s = String(s || '').toLowerCase();
  return s === 'top' ? 'top' : /^bot/.test(s) ? 'bottom' : null;
}
/* pela %TF.FileFunction do X2 */
function porFuncao(f) {
  const p = String(f).split(',').map(s => s.trim());
  const k = p[0].toLowerCase();
  const lado = ladoDe(p[1]);
  switch (k) {
    case 'copper': {
      const l = ladoDe(p[2]);
      if (l) return C.cobre(l);
      const n = parseInt(String(p[1] || '').replace(/^L/i, ''), 10);
      return C.interno(n > 1 ? n - 1 : 1, /plane/i.test(p[3] || ''));
    }
    case 'pads': return C.pads(lado);
    case 'legend': return C.legenda(lado);
    case 'soldermask': return C.mascara(lado);
    case 'paste': return C.pasta(lado);
    case 'profile': return C.perfil();
    case 'plated': return C.pth();
    case 'nonplated': return C.npth();
    case 'mixedplating': return C.furos();
    case 'keep-out': case 'keepout': return C.keepout();
    case 'drillmap': return C.desenho();
    case 'fabricationdrawing': return info('FabDrawing', 'Desenho de fabricação', PALETA_MEC[2], 332, null, 'mecanica');
    case 'arraydrawing': return info('ArrayDrawing', 'Desenho do painel', PALETA_MEC[3], 333, null, 'mecanica');
    case 'assemblydrawing': return info(lado === 'bottom' ? 'BottomAssembly' : 'TopAssembly', 'Montagem (' + (LADO_NOME[lado] || 'cima') + ')', PALETA_MEC[4], 334, lado, 'mecanica');
    case 'component': return info(lado === 'bottom' ? 'BottomComponent' : 'TopComponent', 'Componentes (' + (LADO_NOME[lado] || 'cima') + ')', COR.outro, 361, lado, 'outro');
    case 'glue': return info(lado === 'bottom' ? 'BottomGlue' : 'TopGlue', 'Cola (' + (LADO_NOME[lado] || 'cima') + ')', COR.outro, 362, lado, 'outro');
    case 'vcut': return info('VCut', 'V-cut', PALETA_MEC[5], 335, null, 'mecanica');
    case 'depthrout': return info('DepthRout', 'Fresagem parcial', PALETA_MEC[6], 336, null, 'mecanica');
    case 'viafill': return info('ViaFill', 'Preenchimento de vias', COR.outro, 363, null, 'outro');
    case 'carbonmask': case 'goldmask': case 'heatsinkmask': case 'peelablemask': case 'silvermask': case 'tinmask':
      return info(p[0] + (lado === 'bottom' ? 'Bot' : 'Top'), p[0] + ' (' + (LADO_NOME[lado] || 'cima') + ')', COR.outro, 364, lado, 'outro');
    case 'drawing': case 'otherdrawing': return C.livre();
    case 'other': {
      /* o X2 do Altium poe as mecanicas aqui: Other,Mechanical_1 / Other,Mechanical_13 */
      const resto = p.slice(1).join(',');
      const mm = /mech(?:anical)?[_\s-]*(\d+)/i.exec(resto);
      if (mm) return C.mec(+mm[1]);
      if (/keep[_\s-]*out/i.test(resto)) return C.keepout();
      return C.outro('Outro: ' + resto);
    }
    default: return null;
  }
}
const SEP = '(?:^|[\\s_.\\-])';
const LADO = '(top|bot|bottom)';
const RX = (s) => new RegExp(s, 'i');
/* Cada padrao casa o SUFIXO do nome (sem a extensao), ancorado no fim: e ali que o Altium, o
   CAMtastic e o KiCad poem a camada (<base>_<Camada>.gbr, <proj>-<Camada>.gbr). Palavra no nome
   do PROJETO nao decide nada: "LT1021-7 SMD_TO_PTH_Profile" e o perfil, nao a furacao PTH (pacote
   real da ISS), "OUTLINE_SENSOR_Keep-Out" e o keep-out e "DEPTH_SENSOR.TXT" e furacao comum. */
const PADROES_NOME = [
  /* KiCad: proj-F_Cu, -B_SilkS, -In1_Cu, -Edge_Cuts, -PTH.drl, -PTH-drl_map */
  [RX(SEP + 'f[_.]cu$'), () => C.cobre('top')],
  [RX(SEP + 'b[_.]cu$'), () => C.cobre('bottom')],
  [RX(SEP + 'in(\\d+)[_.]cu$'), m => C.interno(+m[1], false)],
  [RX(SEP + 'f[_.]silk(?:s|screen)?$'), () => C.legenda('top')],
  [RX(SEP + 'b[_.]silk(?:s|screen)?$'), () => C.legenda('bottom')],
  [RX(SEP + 'f[_.]mask$'), () => C.mascara('top')],
  [RX(SEP + 'b[_.]mask$'), () => C.mascara('bottom')],
  [RX(SEP + 'f[_.]paste$'), () => C.pasta('top')],
  [RX(SEP + 'b[_.]paste$'), () => C.pasta('bottom')],
  [RX('edge[_.]cuts$'), () => C.perfil()],
  [RX(SEP + '([fb])[_.]fab$'), m => info(m[1].toLowerCase() === 'b' ? 'BottomFab' : 'TopFab', 'Fabricação (' + (m[1].toLowerCase() === 'b' ? 'baixo' : 'cima') + ')', PALETA_MEC[4], 337, m[1].toLowerCase() === 'b' ? 'bottom' : 'top', 'mecanica')],
  [RX(SEP + '([fb])[_.](?:courtyard|crtyd)$'), m => info(m[1].toLowerCase() === 'b' ? 'BottomCourtyard' : 'TopCourtyard', 'Courtyard (' + (m[1].toLowerCase() === 'b' ? 'baixo' : 'cima') + ')', PALETA_MEC[6], 338, m[1].toLowerCase() === 'b' ? 'bottom' : 'top', 'mecanica')],
  [RX(SEP + '(?:dwgs|cmts|eco\\d)[_.]user$|' + SEP + 'user[_.]\\d+$|' + SEP + 'margin$'), () => C.outro('Desenho do usuário')],
  /* Altium X2 e CAMtastic: _Copper_Signal_Top, _Legend_Bot, _Soldermask_Top... */
  [RX('copper[_\\s-]*(?:signal|plane|mixed|hatched)?[_\\s-]*' + LADO + '$'), m => C.cobre(ladoDe(m[1]))],
  /* interna: o Altium (e o hub-gerber) escreve _Copper_Signal_1, _2... = a camada fisica menos 1:
     _1 e o Copper,L2 e _2 o L3 no X2 do acervo (Mid1 e Mid2 numa placa so de sinais). _L<n>, com
     o L, e a propria camada fisica (L2 = Mid1). */
  [RX('copper[_\\s-]*(signal|plane|mixed|hatched)?[_\\s-]*(?:inr|int|inner|in|mid)?[_\\s-]*l(\\d+)$'), m => C.interno(+m[2] > 1 ? +m[2] - 1 : 1, /plane/i.test(m[1] || ''))],
  [RX('copper[_\\s-]*(signal|plane|mixed|hatched)?[_\\s-]*(?:inr|int|inner|in|mid)?[_\\s-]*(\\d+)$'), m => C.interno(+m[2], /plane/i.test(m[1] || ''))],
  [RX(SEP + 'pads?[_\\s-]*' + LADO + '$'), m => C.pads(ladoDe(m[1]))],
  [RX('(?:legend|silk(?:screen)?s?|overlay)[_\\s-]*' + LADO + '$'), m => C.legenda(ladoDe(m[1]))],
  [RX(SEP + LADO + '[_\\s-]*(?:legend|silk(?:screen)?s?|overlay)$'), m => C.legenda(ladoDe(m[1]))],
  [RX('(?:solder[_\\s-]*mask|mask)[_\\s-]*' + LADO + '$'), m => C.mascara(ladoDe(m[1]))],
  [RX(SEP + LADO + '[_\\s-]*(?:solder[_\\s-]*mask|mask|solder)$'), m => C.mascara(ladoDe(m[1]))],
  [RX('(?:paste|cream)[_\\s-]*' + LADO + '$'), m => C.pasta(ladoDe(m[1]))],
  [RX(SEP + LADO + '[_\\s-]*(?:paste|cream)$'), m => C.pasta(ladoDe(m[1]))],
  [RX(SEP + LADO + '[_\\s-]*(?:layer|copper)$'), m => C.cobre(ladoDe(m[1]))],
  /* furacao: _NPTH_Drill / _PTH_Drill (X2), -NPTH / -PTH (KiCad), -NonPlated / -Plated (.TXT do Altium) */
  [RX(SEP + '(?:npth|non[_\\s-]*plated)(?:[_\\s-]*drill)?$'), () => C.npth()],
  [RX(SEP + '(?:pth|plated)(?:[_\\s-]*drill)?$'), () => C.pth()],
  [RX(SEP + 'board[_\\s-]*edge[_\\s-]*rout$'), () => C.rota()],
  [RX(SEP + '(?:board[_\\s-]*)?(?:profile|outline|edge|contorno)$'), () => C.perfil()],
  [RX(SEP + 'mech(?:anical)?[_\\s-]*(\\d+)$'), m => C.mec(+m[1])],
  [RX(SEP + 'keep[_\\s-]*out(?:[_\\s-]*layer)?$'), () => C.keepout()],
  [RX(SEP + '(?:drill[_\\s-]*(?:drawing|map)|drl[_\\s-]*map)(?:[_\\s-]*\\d+)?$'), () => C.desenho()],
  [RX(SEP + 'drill[_\\s-]*guide(?:[_\\s-]*\\d+)?$'), () => C.guia()],
  [RX(SEP + 'drawing(?:[_\\s-]*\\d+)?$'), () => C.livre()],
  [RX(SEP + '(?:nc[_\\s-]*)?(?:drill|drl|furos?|(?:round|slot)?[_\\s-]*holes?)$'), () => C.furos()],
];
/* extensoes Protel (Altium antigo) e Eagle: decidem sozinhas. O .GML e a Multi-Layer no Altium e
   o contorno (camada Dimension/Milling) no Eagle: quem desempata e o conteudo (altium). */
function porExtensao(ext, altium) {
  let m;
  switch (ext) {
    case 'gtl': case 'cmp': return C.cobre('top');
    case 'gbl': case 'sol': return C.cobre('bottom');
    case 'gto': case 'plc': return C.legenda('top');
    case 'gbo': case 'pls': return C.legenda('bottom');
    case 'gts': case 'stc': return C.mascara('top');
    case 'gbs': case 'sts': return C.mascara('bottom');
    case 'gtp': case 'crc': return C.pasta('top');
    case 'gbp': case 'crs': return C.pasta('bottom');
    case 'gpt': return C.pads('top');
    case 'gpb': return C.pads('bottom');
    case 'gko': return C.keepout();
    case 'gml': return altium ? C.multi() : C.perfil();
    case 'dim': case 'mil': case 'gm': return C.perfil();
  }
  if ((m = /^gm(\d+)$/.exec(ext))) return C.mec(+m[1]);
  if ((m = /^gd(\d+)$/.exec(ext))) return C.desenho();
  if ((m = /^gg(\d+)$/.exec(ext))) return C.guia();
  if ((m = /^gp(\d+)$/.exec(ext))) return C.interno(+m[1], true);
  if ((m = /^g(\d+)$/.exec(ext))) return C.interno(+m[1], false);
  /* PTH/NPTH ja passaram pelos sufixos (PADROES_NOME); aqui sobra a furacao sem lado */
  if (/^(txt|drl|xln|exc|drd|nc|ncd|tap|rte)$/.test(ext)) return C.furos();
  return null;
}
/* o arquivo e do Altium? (G04 Layer_Color ou o TF.GenerationSoftware que ele escreve) */
function deAltium(cam) {
  return !!(cam && (cam.corAltium || /altium/i.test(String((cam.atributos && cam.atributos.GenerationSoftware) || ''))));
}
/* camadaDe(nome, funcao, cam?) -> {chave, nome, cor, ordem, lado, tipo}
   A %TF.FileFunction (X2) manda; sem ela, o SUFIXO do nome do arquivo: Altium X2 e CAMtastic
   (..._Copper_Signal_Top), KiCad (-F_Cu), e as extensoes Protel (.GTL) e Eagle (.cmp). cam (a
   camada lida, opcional) desempata o .GML: Multi-Layer quando o arquivo e do Altium.
   chave = a do board.js/HubCore.PCB_LAYERS quando existe (Top, Bottom, TopOverlay, TopSolder,
   TopPaste, Mech1, KeepOut, Multi...); as so do Gerber: PadsTop/PadsBottom, Profile, DrillPTH,
   DrillNPTH, Drill, BoardEdgeRout, Other.
   tipo: cobre | pads | legenda | mascara | pasta | perfil | furo | mecanica | multi | outro */
function camadaDe(nome, funcao, cam) {
  if (funcao) { const r = porFuncao(funcao); if (r) return r; }
  const base = String(nome || '').split(/[\\/]/).pop();
  const b = base.toLowerCase();
  const me = /\.([a-z0-9]+)$/.exec(b);
  const ext = me ? me[1] : '';
  /* "x_Profile (1).gbr": o navegador numera a copia baixada de novo; e o mesmo arquivo */
  const sem = (me ? b.slice(0, -me[0].length) : b).replace(/\s*\(\d+\)$/, '');
  const altium = deAltium(cam);
  const genericas = /^(gbr|gbx|ger|pho|art|gb|g|txt|drl|xln|exc|drd|nc|ncd|tap|rte|)$/;
  if (!genericas.test(ext)) { const r = porExtensao(ext, altium); if (r) return r; }
  for (const pd of PADROES_NOME) { const m = pd[0].exec(sem); if (m) return pd[1](m); }
  const r = porExtensao(ext, altium);
  if (r) return r;
  return C.outro(base ? 'Outra camada' : '');
}

/* ============================== 8. arquivos e conjuntos ============================== */

/* 'gerber' | 'excellon' | null pelo conteudo (o nome so desempata) */
function tipoDeArquivo(nome, texto) {
  const t = String(texto || '');
  const ini = t.slice(0, 40000);
  if (/%FS[LTD]?[AI]?/.test(ini) || /%MO(IN|MM)\*%/.test(ini)) return 'gerber';
  if (/^\s*M48\s*$/m.test(ini)) return 'excellon';
  const coordExc = /^\s*(?:T\d+\s*)?[XY][-+]?\d+(\.\d+)?([XY][-+]?\d+(\.\d+)?)?\s*$/m.test(t);
  if (/^\s*(METRIC|INCH)\b/m.test(ini) && coordExc) return 'excellon';
  if (/^\s*T\d+\s*(F\d+\s*)?(S\d+\s*)?C\s*\d*\.?\d+/m.test(ini) && coordExc) return 'excellon';
  if (/(^|[\n*])\s*(G0?[123])?(X[-+]?\d+)?(Y[-+]?\d+)?D0?[123]\*/.test(ini) && /M0?2\*/.test(t)) return 'gerber';
  const ext = (/\.([a-z0-9]+)$/i.exec(String(nome || '')) || [, ''])[1].toLowerCase();
  if (/^(drl|xln|exc|drd)$/.test(ext) && coordExc) return 'excellon';
  return null;
}
/* lerConjunto({titulo, arquivos:[{nome, texto}]}) -> {titulo, camadas:[{arquivo, cam, info}], ignorados}
   arquivo que nao e Gerber nem Excellon (relatorio, .apr, .pdf...) vai para ignorados */
function lerConjunto(conj) {
  const camadas = [], ignorados = [];
  for (const a of (conj && conj.arquivos) || []) {
    const tipo = tipoDeArquivo(a.nome, a.texto);
    if (!tipo) { ignorados.push(a.nome); continue; }
    let cam;
    try { cam = tipo === 'excellon' ? parseExcellon(a.texto, a.nome) : parse(a.texto, a.nome); }
    catch (e) { ignorados.push(a.nome + ' (erro: ' + (e && e.message || e) + ')'); continue; }
    camadas.push({ arquivo: a.nome, cam, info: camadaDe(a.nome, cam.funcao, cam) });
  }
  return { titulo: (conj && conj.titulo) || '', camadas, ignorados };
}

/* ---- avisos de leitura (o mesmo texto na tela e nos testes) ---- */
const COMPACTADO = /\.(rar|7z|tar|gz|tgz|bz2|xz)$/i;
const tamanhoTxt = b => (b >= 1048576 ? Math.round(b / 1048576) + ' MB' : b + ' bytes');
/* .rar/.7z: o navegador nao abre - o mesmo texto para o solto e para o que vem dentro do .zip */
function avisoCompactado(nome) {
  const ext = String(nome).split('.').pop().toUpperCase();
  return '“' + nome + '” é um ' + ext + ', e o navegador não abre esse formato. Extraia os arquivos e escolha os .gbr/.drl (pode escolher vários de uma vez), ou compacte-os em .zip.';
}
/* o que dizer quando a leitura nao deu camada nenhuma: o titulo, quantos ficaram de fora (nao sao
   Gerber nem Excellon) e os avisos da leitura - o .rar dentro do .zip, o .zip vazio. Sem os
   avisos, soltar um .zip so com o .rar da FABRICACAO nao dava retorno nenhum. */
function semCamadas(titulo, ignorados, avisos) {
  let s = 'Nenhum Gerber ou Excellon em “' + (titulo || 'arquivos') + '”';
  if (ignorados && ignorados.length) s += ' (' + ignorados.length + ' arquivo(s) ignorado(s))';
  s += '.';
  const a = avisos || [];
  if (a.length) s += '\n' + a.slice(0, 5).join('\n') + (a.length > 5 ? '\n… e mais ' + (a.length - 5) + ' aviso(s).' : '');
  return s;
}

/* ---- .zip ---- */
/* CP850: a pagina OEM do Windows em pt-BR, onde o Explorer e o 7-Zip gravam o nome quando o .zip
   nao marca UTF-8 */
const CP850 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00ad±‗¾¶§÷¸°¨·¹³²■\u00a0';
function deCP850(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i] < 128 ? String.fromCharCode(b[i]) : CP850[b[i] - 128];
  return s;
}
function deUTF8(b) { return new TextDecoder('utf-8').decode(b); }
/* nome de um arquivo dentro do .zip. Com a marca 0x800, UTF-8. Sem ela, UTF-8 ESTRITO primeiro (ha
   quem grave UTF-8 sem marcar, e nome em CP850 com acento quase nunca e UTF-8 valido) e, se nao
   for, CP850 - nao a CP437 da spec, que trocava o A-til de "FABRICACAO" por um desenho de caixa. */
function nomeNoZip(nb, flags) {
  if (flags & 0x800) return deUTF8(nb);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(nb); } catch (e) { return deCP850(nb); }
}
async function inflarRaw(dados, limite) {
  if (typeof DecompressionStream === 'undefined') throw new Error('este navegador não descompacta .zip (sem DecompressionStream)');
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  w.write(dados).catch(() => {});
  w.close().catch(() => {});
  const r = ds.readable.getReader();
  const partes = [];
  let total = 0;
  for (;;) {
    const x = await r.read();
    if (x.done) break;
    total += x.value.length;
    /* um .zip-bomba (1 MB que vira 1 GB) acabaria com a memoria da aba */
    if (limite && total > limite) {
      try { await r.cancel(); } catch (e) { /* ja fechado */ }
      throw new Error('passa de ' + tamanhoTxt(limite) + ' descompactado: ficou de fora');
    }
    partes.push(x.value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}
/* lerZip(arrayBuffer, opcoes?) -> Promise<[{nome, texto}]>, com .avisos no array.
   Le pelo diretorio central (o cabecalho local pode vir com tamanho 0 quando ha descritor de
   dados). Metodos 0 (store) e 8 (deflate). Pasta e ignorada; .zip dentro do .zip e aberto (ate 4
   niveis); .rar/.7z dentro dele, arquivo binario (tem byte 0) e arquivo que passa de
   opcoes.limite bytes descompactado (padrao 80 MB) sao pulados com aviso. */
async function lerZip(buf, opcoes) {
  const limite = opcoes && opcoes.limite > 0 ? opcoes.limite : LIMITE_ARQUIVO;
  return lerZipEm(buf, '', 0, limite);
}
async function lerZipEm(buf, prefixo, nivel, limite) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out = [];
  out.avisos = [];
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('não é um .zip válido (fim do diretório não encontrado)');
  let total = dv.getUint16(eocd + 10, true);
  let cdOff = dv.getUint32(eocd + 16, true);
  if ((cdOff === 0xffffffff || total === 0xffff) && eocd >= 20 && dv.getUint32(eocd - 20, true) === 0x07064b50) {
    const z = Number(dv.getBigUint64(eocd - 12, true));
    if (dv.getUint32(z, true) === 0x06064b50) { total = Number(dv.getBigUint64(z + 32, true)); cdOff = Number(dv.getBigUint64(z + 48, true)); }
  }
  let p = cdOff;
  for (let k = 0; k < total; k++) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) { out.avisos.push('diretório do .zip corrompido'); break; }
    const flags = dv.getUint16(p + 8, true), metodo = dv.getUint16(p + 10, true);
    let csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    let loff = dv.getUint32(p + 42, true);
    const nb = u8.subarray(p + 46, p + 46 + nlen);
    if (csize === 0xffffffff || loff === 0xffffffff) {
      /* extra ZIP64 (id 1): usize, csize, loff - so os que estao em 0xffffffff */
      let e = p + 46 + nlen;
      const efim = e + xlen;
      while (e + 4 <= efim) {
        const id = dv.getUint16(e, true), sz = dv.getUint16(e + 2, true);
        if (id === 1) {
          let q = e + 4;
          if (dv.getUint32(p + 24, true) === 0xffffffff) q += 8;
          if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
          if (loff === 0xffffffff) { loff = Number(dv.getBigUint64(q, true)); }
        }
        e += 4 + sz;
      }
    }
    const nome = prefixo + nomeNoZip(nb, flags);
    p += 46 + nlen + xlen + clen;
    if (/[\\/]$/.test(nome)) continue;
    if (COMPACTADO.test(nome)) { out.avisos.push(avisoCompactado(nome)); continue; }
    if (flags & 1) { out.avisos.push(nome + ': protegido por senha'); continue; }
    if (loff + 30 > u8.length || dv.getUint32(loff, true) !== 0x04034b50) { out.avisos.push(nome + ': cabeçalho local não encontrado'); continue; }
    const ini = loff + 30 + dv.getUint16(loff + 26, true) + dv.getUint16(loff + 28, true);
    const dados = u8.subarray(ini, ini + csize);
    let bytes;
    try {
      if (metodo === 0) {
        if (dados.length > limite) { out.avisos.push(nome + ': passa de ' + tamanhoTxt(limite) + ': ficou de fora'); continue; }
        bytes = dados;
      } else if (metodo === 8) bytes = await inflarRaw(dados, limite);
      else { out.avisos.push(nome + ': compressão ' + metodo + ' não suportada'); continue; }
    } catch (e) { out.avisos.push(nome + ': ' + e.message); continue; }
    if (/\.zip$/i.test(nome)) {
      /* um .zip que se contem (quine) desceria para sempre */
      if (nivel + 1 > LIMITE_ZIP_DENTRO) { out.avisos.push(nome + ': .zip dentro de .zip em mais de ' + LIMITE_ZIP_DENTRO + ' níveis: ignorado'); continue; }
      try {
        const dentro = await lerZipEm(bytes, nome + '/', nivel + 1, limite);
        for (const a of dentro) out.push(a);
        for (const a of dentro.avisos) out.avisos.push(a);
      } catch (e) { out.avisos.push(nome + ': ' + e.message); }
      continue;
    }
    const amostra = bytes.subarray(0, 4096);
    if (amostra.indexOf(0) >= 0) { out.avisos.push(nome + ': binário, ignorado'); continue; }
    out.push({ nome, texto: deUTF8(bytes) });
  }
  return out;
}

/* ============================== 9. geometria para a tela ============================== */

/* contornoDaPlaca(camada, tol) -> {lacos, recortes, abertos}: os tracos (linhas e arcos) do perfil
   encadeados em lacos fechados (o de fora e a placa; os de dentro, preenchidos com par-impar, sao
   recortes), e as regioes da camada como recortes (o X2 do Altium desenha os furos de fixacao do
   Board Cutout como regiao no Profile). abertos = trechos que nao fecharam.
   Encadeia por GRAFO, nao de forma gulosa: as pontas a menos de tol viram o mesmo no; segmento
   repetido (o mesmo, nos dois sentidos) conta uma vez; galho que nao fecha (uma cota encostada
   num vertice) e podado antes; e num no com mais de dois caminhos segue o mais reto. Antes, um
   segmento duplicado fechava um "laco" de ida e volta e deixava o resto do perfil aberto. */
function contornoDaPlaca(cam, tol) {
  tol = tol || 0.05;
  const segs = [], recortes = [];
  for (const p of (cam && cam.prims) || []) {
    if (p.k === 'line') { if (p.x1 !== p.x2 || p.y1 !== p.y2) segs.push([[p.x1, p.y1], [p.x2, p.y2]]); }
    else if (p.k === 'arc') segs.push([[p.x1, p.y1]].concat(pontosArco(p.x1, p.y1, p.x2, p.y2, p.cx, p.cy, p.cw, p.circulo)));
    else if (p.k === 'region' && p.escuro) for (const c of p.contornos) recortes.push(c);
  }
  /* 1. nos: pontas a menos de tol uma da outra */
  const nos = [], grade = new Map();
  function no(q) {
    const gx = Math.round(q[0] / tol), gy = Math.round(q[1] / tol);
    let melhor = -1, md = Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const l = grade.get((gx + a) + ',' + (gy + b));
      if (l) for (const i of l) { const d = Math.hypot(nos[i][0] - q[0], nos[i][1] - q[1]); if (d <= tol && d < md) { md = d; melhor = i; } }
    }
    if (melhor >= 0) return melhor;
    nos.push([q[0], q[1]]);
    const k = gx + ',' + gy;
    let l = grade.get(k);
    if (!l) grade.set(k, l = []);
    l.push(nos.length - 1);
    return nos.length - 1;
  }
  /* 2. arestas, sem as repetidas e sem as que sao so um ponto */
  const arestas = [], porPar = new Map();
  for (const s of segs) {
    const a = no(s[0]), b = no(s[s.length - 1]);
    let cx = 0, cy = 0;
    for (const q of s) { cx += q[0]; cy += q[1]; }
    cx /= s.length; cy /= s.length;
    if (a === b) {
      let longe = 0;
      for (const q of s) longe = Math.max(longe, Math.hypot(q[0] - nos[a][0], q[1] - nos[a][1]));
      if (longe <= tol) continue;                       /* menor que a tolerancia: e um ponto */
    }
    const kp = a < b ? a + ',' + b : b + ',' + a;
    let mesmas = porPar.get(kp);
    if (mesmas && mesmas.some(e => Math.hypot(e.cx - cx, e.cy - cy) <= tol)) continue;   /* repetida */
    const e = { a, b, pts: s, cx, cy, viva: true, usada: false };
    if (!mesmas) porPar.set(kp, mesmas = []);
    mesmas.push(e);
    arestas.push(e);
  }
  const adj = nos.map(() => []);
  for (const e of arestas) { adj[e.a].push(e); adj[e.b].push(e); }    /* laco em si: entra 2x */
  /* 3. poda: no com um caminho so e ponta solta; sai, e o vizinho pode virar ponta tambem */
  const grau = adj.map(l => l.length);
  const fila = [];
  grau.forEach((g, i) => { if (g === 1) fila.push(i); });
  const podadas = [];
  while (fila.length) {
    const v = fila.pop();
    if (grau[v] !== 1) continue;
    const e = adj[v].find(x => x.viva);
    if (!e) continue;
    e.viva = false;
    podadas.push(e);
    grau[e.a]--; grau[e.b]--;
    const w = e.a === v ? e.b : e.a;
    if (grau[w] === 1) fila.push(w);
  }
  /* trechos podados ligados entre si contam como um aberto */
  const pai = nos.map((_, i) => i);
  const raiz = x => { while (pai[x] !== x) x = pai[x] = pai[pai[x]]; return x; };
  for (const e of podadas) pai[raiz(e.a)] = raiz(e.b);
  let abertos = new Set(podadas.map(e => raiz(e.a))).size;
  /* 4. lacos: anda pelas arestas vivas; num no com varias saidas, a mais reta */
  const lacos = [];
  for (const e0 of arestas) {
    if (!e0.viva || e0.usada) continue;
    e0.usada = true;
    const ini = e0.a;
    const cad = e0.pts.slice();
    let v = e0.b;
    while (v !== ini) {
      const ult = cad[cad.length - 1], pen = cad[cad.length - 2];
      const dx = ult[0] - pen[0], dy = ult[1] - pen[1];
      let melhor = null, mc = -Infinity;
      for (const e of adj[v]) {
        if (!e.viva || e.usada) continue;
        const p0 = e.a === v ? e.pts[0] : e.pts[e.pts.length - 1];
        const p1 = e.a === v ? e.pts[1] : e.pts[e.pts.length - 2];
        const ox = p1[0] - p0[0], oy = p1[1] - p0[1];
        const c = (dx * ox + dy * oy) / ((Math.hypot(dx, dy) * Math.hypot(ox, oy)) || 1);
        if (c > mc) { mc = c; melhor = e; }
      }
      if (!melhor) break;
      melhor.usada = true;
      const pts = melhor.a === v ? melhor.pts : melhor.pts.slice().reverse();
      for (let k = 1; k < pts.length; k++) cad.push(pts[k]);
      v = melhor.a === v ? melhor.b : melhor.a;
    }
    if (v !== ini) { abertos++; continue; }
    cad.pop();                                          /* o ultimo ponto e o primeiro */
    if (cad.length >= 3 && Math.abs(areaComSinal(cad)) > tol * tol) lacos.push(cad);
  }
  return { lacos, recortes, abertos };
}
/* placaDoConjunto(camadas) -> {lacos, recortes, camada, como, aviso?}: a placa do modo realista.
   camadas = as de lerConjunto ({arquivo, cam, info}). O contorno vem da primeira camada que fecha
   um laco, nesta ordem: Perfil, Keep-Out, Mecanica 1 (dessas duas, so o maior laco - elas costumam
   ter cota e desenho fechado por dentro). So conta camada com traco ou regiao: o .GML do Altium,
   so de pads, nao e contorno.
   como: 'contorno' - os lacos; os de dentro e as regioes do perfil sao recortes;
         'regioes'  - perfil sem traco nenhum, so regioes: elas sao a placa;
         'casco'    - o contorno tem tracos que nao fecham: o casco convexo deles, com AVISO (antes
                      as regioes - os furos de fixacao - viravam a placa, e a placa sumia);
         null       - nenhuma camada de contorno: quem desenha usa a caixa dos arquivos. */
function placaDoConjunto(camadas) {
  const lista = camadas || [];
  const prioridade = k => (k.info.tipo === 'perfil' ? 0 : k.info.chave === 'KeepOut' ? 1 : k.info.chave === 'Mech1' ? 2 : -1);
  const temSeg = k => k.cam.prims.some(p => p.k === 'line' || p.k === 'arc');
  const temReg = k => k.cam.prims.some(p => p.k === 'region' && p.escuro);
  const cands = lista.filter(k => prioridade(k) >= 0 && (temSeg(k) || temReg(k))).sort((a, b) => prioridade(a) - prioridade(b));
  let aberto = null;
  for (const k of cands) {
    const perfil = k.info.tipo === 'perfil';
    const pl = contornoDaPlaca(k.cam);
    if (!temSeg(k)) {
      if (perfil) return { lacos: pl.recortes, recortes: [], camada: k, como: 'regioes' };
      continue;                                         /* regiao no Keep-Out/Mecanica nao e a placa */
    }
    if (pl.lacos.length) {
      if (perfil) return { lacos: pl.lacos, recortes: pl.recortes, camada: k, como: 'contorno' };
      let maior = pl.lacos[0];
      for (const l of pl.lacos) if (Math.abs(areaComSinal(l)) > Math.abs(areaComSinal(maior))) maior = l;
      return { lacos: [maior], recortes: [], camada: k, como: 'contorno' };
    }
    if (!aberto) aberto = { k, pl, perfil };
  }
  if (aberto) {
    const pts = [];
    for (const p of aberto.k.cam.prims) {
      if (p.k === 'line') pts.push([p.x1, p.y1], [p.x2, p.y2]);
      else if (p.k === 'arc') { pts.push([p.x1, p.y1]); for (const q of pontosArco(p.x1, p.y1, p.x2, p.y2, p.cx, p.cy, p.cw, p.circulo)) pts.push(q); }
    }
    const casco = cascoConvexo(pts);
    if (casco.length >= 3) {
      const arq = String(aberto.k.arquivo || aberto.k.info.nome).split(/[\\/]/).pop();
      return {
        lacos: [casco], recortes: aberto.perfil ? aberto.pl.recortes : [], camada: aberto.k, como: 'casco',
        aviso: 'O contorno da placa em “' + arq + '” não fecha (' + aberto.pl.abertos + ' trecho(s) aberto(s)): o modo realista desenha a placa pelo casco convexo dele.',
      };
    }
  }
  return { lacos: [], recortes: [], camada: null, como: null };
}

/* indice espacial por camada (grade), montado na primeira consulta */
const cacheIndice = new WeakMap();
function indiceDe(cam) {
  let ix = cacheIndice.get(cam);
  if (ix) return ix;
  const prims = cam.prims, n = prims.length;
  const caixas = new Float64Array(n * 4);
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (let i = 0; i < n; i++) {
    const b = caixaDe(prims[i]) || [0, 0, 0, 0];
    caixas[i * 4] = b[0]; caixas[i * 4 + 1] = b[1]; caixas[i * 4 + 2] = b[2]; caixas[i * 4 + 3] = b[3];
    if (b[0] < x1) x1 = b[0]; if (b[1] < y1) y1 = b[1]; if (b[2] > x2) x2 = b[2]; if (b[3] > y2) y2 = b[3];
  }
  const area = n && isFinite(x1) ? Math.max(1, (x2 - x1) * (y2 - y1)) : 1;
  const cel = Math.min(10, Math.max(0.25, Math.sqrt(area / Math.max(1, n)) * 1.5));
  const grade = new Map(), grandes = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor(caixas[i * 4] / cel), b = Math.floor(caixas[i * 4 + 1] / cel);
    const c = Math.floor(caixas[i * 4 + 2] / cel), d = Math.floor(caixas[i * 4 + 3] / cel);
    if ((c - a + 1) * (d - b + 1) > 400) { grandes.push(i); continue; }
    for (let gx = a; gx <= c; gx++) for (let gy = b; gy <= d; gy++) {
      const k = gx + ',' + gy;
      let l = grade.get(k);
      if (!l) grade.set(k, l = []);
      l.push(i);
    }
  }
  ix = { cel, grade, grandes, caixas };
  cacheIndice.set(cam, ix);
  return ix;
}
const cachePoligonos = new WeakMap();
function poligonosLocais(ap) {
  let p = cachePoligonos.get(ap);
  if (!p) { p = contornoDaAbertura(ap, 0, 0); cachePoligonos.set(ap, p); }
  return p;
}
/* o ponto (x, y) esta no objeto p (com folga tol, em mm)? */
function contem(p, x, y, tol) {
  switch (p.k) {
    case 'flash': {
      const lx = x - p.x, ly = y - p.y;
      let escuro = false, perto = false;
      for (const pg of poligonosLocais(p.ap)) {
        if (dentroDoPoligono(lx, ly, pg.pts)) escuro = !pg.claro;
        else if (!pg.claro && tol > 0 && distBorda(lx, ly, pg.pts) <= tol) perto = true;
      }
      if (!poligonosLocais(p.ap).length) return Math.hypot(lx, ly) <= tol;
      return escuro || perto;
    }
    case 'line': {
      const h = p.ap && p.ap.tipo !== 'C' ? Math.max.apply(null, extensao(p.ap).map(Math.abs)) : meiaLargura(p.ap);
      return distSegmento(x, y, p.x1, p.y1, p.x2, p.y2) <= h + tol;
    }
    case 'arc': {
      const h = meiaLargura(p.ap) + tol;
      const r = Math.hypot(p.x1 - p.cx, p.y1 - p.cy), d = Math.hypot(x - p.cx, y - p.cy);
      if (Math.abs(d - r) <= h) {
        if (p.circulo) return true;
        const a0 = Math.atan2(p.y1 - p.cy, p.x1 - p.cx);
        if (varredura(a0, Math.atan2(y - p.cy, x - p.cx), p.cw) <= varredura(a0, Math.atan2(p.y2 - p.cy, p.x2 - p.cx), p.cw)) return true;
      }
      return Math.hypot(x - p.x1, y - p.y1) <= h || Math.hypot(x - p.x2, y - p.y2) <= h;
    }
    case 'region': {
      for (const c of p.contornos) {
        if (dentroDoPoligono(x, y, c)) return true;
        if (tol > 0 && distBorda(x, y, c) <= tol) return true;
      }
      return false;
    }
  }
  return false;
}
/* objetoEm(camada, x, y, tol) -> o objeto de cima que cobre o ponto, ou null. Respeita a
   polaridade: se o ultimo objeto que cobre o ponto e claro (LPC), o ponto esta vazio. */
function objetoEm(cam, x, y, tol) {
  if (!cam || !cam.prims.length) return null;
  tol = tol || 0;
  const ix = indiceDe(cam);
  const gx = Math.floor(x / ix.cel), gy = Math.floor(y / ix.cel);
  const cand = [];
  const r = Math.max(0, Math.ceil(tol / ix.cel));
  for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
    const l = ix.grade.get((gx + a) + ',' + (gy + b));
    if (l) for (const i of l) cand.push(i);
  }
  for (const i of ix.grandes) cand.push(i);
  cand.sort((a, b) => b - a);
  let ultimo = -1;
  for (const i of cand) {
    if (i === ultimo) continue;
    ultimo = i;
    const c = ix.caixas;
    if (x < c[i * 4] - tol || x > c[i * 4 + 2] + tol || y < c[i * 4 + 1] - tol || y > c[i * 4 + 3] + tol) continue;
    const p = cam.prims[i];
    if (contem(p, x, y, p.escuro ? tol : 0)) return p.escuro ? p : null;
  }
  return null;
}

/* ============================== 10. pintura (so navegador) ============================== */

/* fundo da vista: o preto da placa do Altium, em qualquer tema - as cores das camadas sao as
   dele e foram feitas para esse fundo. Cor fixa so no DESENHO; a interface usa os tokens. */
const FUNDO = '#060708';
const CIANO_B = '#00ffff';
const SEL = '#2979ff';
const REAL = { mascara: '#0e5a2c', cobreSob: '#2e8a47', ouro: '#d8a83e', fr4: '#a39257', silk: '#f4f4ee', aro: 'rgba(255,255,255,0.85)' };

function poligonoNoCaminho(pa, pts) {
  if (!pts.length) return;
  pa.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) pa.lineTo(pts[i][0], pts[i][1]);
  pa.closePath();
}
/* uma forma de abertura posta em (x, y) no caminho; furo sai com o enrolamento invertido */
function tracaForma(pa, f, x, y) {
  switch (f.t) {
    case 'circ': {
      const cx = x + f.cx, cy = y + f.cy;
      pa.moveTo(cx + f.r, cy);
      if (f.furo) pa.arc(cx, cy, f.r, 0, -TAU, true); else pa.arc(cx, cy, f.r, 0, TAU, false);
      pa.closePath();
      break;
    }
    case 'anel': {
      const cx = x + f.cx, cy = y + f.cy;
      pa.moveTo(cx + f.r1, cy); pa.arc(cx, cy, f.r1, 0, TAU, false); pa.closePath();
      if (f.r2 > 0) { pa.moveTo(cx + f.r2, cy); pa.arc(cx, cy, f.r2, 0, -TAU, true); pa.closePath(); }
      break;
    }
    case 'obl': {
      const cx = x + f.cx, cy = y + f.cy;
      if (Math.abs(f.w - f.h) < 1e-12) { pa.moveTo(cx + f.w / 2, cy); pa.arc(cx, cy, f.w / 2, 0, TAU, false); pa.closePath(); break; }
      const r = Math.min(f.w, f.h) / 2, m = Math.abs(f.w - f.h) / 2;
      const a = ((f.rot || 0) + (f.w > f.h ? 0 : 90)) * RAD;
      const ux = Math.cos(a), uy = Math.sin(a);
      const c1x = cx + ux * m, c1y = cy + uy * m, c2x = cx - ux * m, c2y = cy - uy * m;
      pa.moveTo(c1x + r * Math.cos(a - Math.PI / 2), c1y + r * Math.sin(a - Math.PI / 2));
      pa.arc(c1x, c1y, r, a - Math.PI / 2, a + Math.PI / 2, false);
      pa.arc(c2x, c2y, r, a + Math.PI / 2, a + 3 * Math.PI / 2, false);
      pa.closePath();
      break;
    }
    default: {
      const p = f.pts;
      pa.moveTo(x + p[0][0], y + p[0][1]);
      for (let i = 1; i < p.length; i++) pa.lineTo(x + p[i][0], y + p[i][1]);
      pa.closePath();
    }
  }
}
function arcoNoCaminho(pa, p) {
  const r = Math.hypot(p.x1 - p.cx, p.y1 - p.cy);
  const a0 = Math.atan2(p.y1 - p.cy, p.x1 - p.cx);
  /* com Y para cima, angulo crescente = anti-horario: o 'anticlockwise' do canvas e o cw do Gerber */
  if (p.circulo) pa.arc(p.cx, p.cy, r, a0, a0 + (p.cw ? -TAU : TAU), p.cw);
  else pa.arc(p.cx, p.cy, r, a0, Math.atan2(p.y2 - p.cy, p.x2 - p.cx), p.cw);
}
const cacheCasco = new WeakMap();
function cascoLocal(ap) {
  let c = cacheCasco.get(ap);
  if (!c) {
    const pts = [];
    for (const pg of contornoDaAbertura(ap, 0, 0)) if (!pg.claro) for (const q of pg.pts) pts.push(q);
    c = cascoConvexo(pts);
    cacheCasco.set(ap, c);
  }
  return c;
}
/* O plano de pintura de uma camada, montado UMA vez: os objetos em sequencia de polaridade
   (cada troca LPD/LPC abre um "lance"), e dentro do lance tudo agrupado num punhado de Path2D:
   um caminho de preenchimento (flashes, regioes, traco de abertura nao circular) e um caminho
   de traco por largura. A serigrafia real tem ~10 mil objetos; redesenhar no zoom e so trocar a
   matriz e mandar estes poucos caminhos de novo. */
function planoDe(k) {
  if (k.plano) return k.plano;
  const lances = [];
  let l = null;
  for (const p of k.cam.prims) {
    if (!l || l.escuro !== p.escuro) { l = { escuro: p.escuro, preench: null, tracos: new Map(), seq: new Map() }; lances.push(l); }
    if (p.k === 'flash') {
      const fs = formasDe(p.ap);
      if (!fs.length) continue;
      if (ehSequencial(fs)) {
        let gr = l.seq.get(p.ap);
        if (!gr) l.seq.set(p.ap, gr = { pontos: [], caminhos: null });
        gr.pontos.push(p.x, p.y);
      } else {
        const pa = l.preench || (l.preench = new Path2D());
        for (const f of fs) tracaForma(pa, f, p.x, p.y);
      }
    } else if (p.k === 'region') {
      const pa = l.preench || (l.preench = new Path2D());
      for (const c of p.contornos) poligonoNoCaminho(pa, antiHorario(c));
    } else {
      const ap = p.ap;
      if (p.k === 'line' && ap && ap.tipo !== 'C') {
        /* traco com abertura retangular (ou outra convexa): o casco das duas pontas */
        const h = cascoLocal(ap);
        if (h.length >= 3) {
          const pts = cascoConvexo(h.map(q => [q[0] + p.x1, q[1] + p.y1]).concat(h.map(q => [q[0] + p.x2, q[1] + p.y2])));
          poligonoNoCaminho(l.preench || (l.preench = new Path2D()), pts);
          continue;
        }
      }
      const w = 2 * meiaLargura(ap);
      let pa = l.tracos.get(w);
      if (!pa) l.tracos.set(w, pa = new Path2D());
      pa.moveTo(p.x1, p.y1);
      if (p.k === 'line') pa.lineTo(p.x2, p.y2);
      else arcoNoCaminho(pa, p);
    }
  }
  k.plano = lances;
  return lances;
}
/* contorno dos furos (o aro branco do furo PTH, que e desenhado como buraco) */
function aroDe(k) {
  if (k.aro) return k.aro;
  const pa = new Path2D();
  for (const p of k.cam.prims) {
    if (p.k === 'flash') { for (const f of formasDe(p.ap)) if (!f.claro) tracaForma(pa, f, p.x, p.y); }
    else if (p.k === 'line') {
      const d = 2 * meiaLargura(p.ap), L = Math.hypot(p.x2 - p.x1, p.y2 - p.y1);
      if (d > 0) tracaForma(pa, { t: 'obl', cx: (p.x1 + p.x2) / 2, cy: (p.y1 + p.y2) / 2, w: L + d, h: d, rot: Math.atan2(p.y2 - p.y1, p.x2 - p.x1) / RAD }, 0, 0);
    } else if (p.k === 'region') for (const c of p.contornos) poligonoNoCaminho(pa, c);
  }
  k.aro = pa;
  return pa;
}
/* contorno de UM objeto, para marcar o que esta sob o cursor ou selecionado */
function contornoDoObjeto(p) {
  const pa = new Path2D();
  if (p.k === 'flash') { for (const f of formasDe(p.ap)) if (!f.claro) tracaForma(pa, f, p.x, p.y); }
  else if (p.k === 'line') {
    const d = 2 * meiaLargura(p.ap), L = Math.hypot(p.x2 - p.x1, p.y2 - p.y1);
    if (p.ap && p.ap.tipo !== 'C' && cascoLocal(p.ap).length >= 3) {
      const h = cascoLocal(p.ap);
      poligonoNoCaminho(pa, cascoConvexo(h.map(q => [q[0] + p.x1, q[1] + p.y1]).concat(h.map(q => [q[0] + p.x2, q[1] + p.y2]))));
    } else tracaForma(pa, { t: 'obl', cx: (p.x1 + p.x2) / 2, cy: (p.y1 + p.y2) / 2, w: L + d, h: d, rot: Math.atan2(p.y2 - p.y1, p.x2 - p.x1) / RAD }, 0, 0);
  } else if (p.k === 'region') for (const c of p.contornos) poligonoNoCaminho(pa, c);
  return pa;
}

/* ============================== 11. a tela ============================== */

const ICONES = {
  abrir: 'M2 4 H6.5 L8 5.5 H14 V13 H2 Z',
  comparar: 'r:2,2,8,8|r:6,6,8,8',
  enquadrar: 'M2 6 V2 H6 M10 2 H14 V6 M14 10 V14 H10 M6 14 H2 V10',
  olho: 'M1.5 8 C3.5 4.6 5.8 3 8 3 C10.2 3 12.5 4.6 14.5 8 C12.5 11.4 10.2 13 8 13 C5.8 13 3.5 11.4 1.5 8 Z|c:8,8,2.2',
  olhoFechado: 'M1.5 8 C3.5 4.6 5.8 3 8 3 C10.2 3 12.5 4.6 14.5 8 C12.5 11.4 10.2 13 8 13 C5.8 13 3.5 11.4 1.5 8 Z|c:8,8,2.2|M2.5 13.5 L13.5 2.5',
  fechar: 'M4 4 L12 12 M12 4 L4 12',
  gerar: 'M13 8 A5 5 0 1 1 10.5 3.7 M10.5 1.2 V3.7 H13',
  baixar: 'M8 2 V10.5 M4.5 7 L8 10.5 L11.5 7|M2.5 13.5 H13.5',
  salvar: 'M2.5 2.5 H11.5 L13.5 4.5 V13.5 H2.5 Z|M5 2.5 V6 H10.5 V2.5|r:5,9,6,4.5',
  salvo: 'M3 1.5 H10 L13 4.5 V14.5 H3 Z|M5.5 9 L7.3 10.8 L10.5 7.5',
  carrinho: 'M1.5 2.5 H3.5 L5 10.5 H12.5 L14 5 H4.2|c:6,13,1|c:11.5,13,1',
  camadas: 'M8 2 L14 5 L8 8 L2 5 Z|M2 8 L8 11 L14 8|M2 11 L8 14 L14 11',
  virar: 'M2 5 H11 M8.5 2.5 L11 5 L8.5 7.5|M14 11 H5 M7.5 8.5 L5 11 L7.5 13.5',
  menu: 'M2.5 4 H13.5 M2.5 8 H13.5 M2.5 12 H13.5',
  opcoes: 'c:8,8,2.3|M8 1.5 V3.5 M8 12.5 V14.5 M1.5 8 H3.5 M12.5 8 H14.5 M3.4 3.4 L4.8 4.8 M11.2 11.2 L12.6 12.6 M3.4 12.6 L4.8 11.2 M11.2 4.8 L12.6 3.4',
  aviso: 'M8 2 L14.5 13.5 H1.5 Z|M8 6.5 V9.5|M8 11.6 V11.7',
  recolher: 'M4 10 L8 6 L12 10',
  expandir: 'M4 6 L8 10 L12 6',
};
function icone(nome) {
  const partes = ICONES[nome].split('|').map(p => {
    if (p.slice(0, 2) === 'r:') { const v = p.slice(2).split(','); return '<rect x="' + v[0] + '" y="' + v[1] + '" width="' + v[2] + '" height="' + v[3] + '" rx="1"/>'; }
    if (p.slice(0, 2) === 'c:') { const v = p.slice(2).split(','); return '<circle cx="' + v[0] + '" cy="' + v[1] + '" r="' + v[2] + '"/>'; }
    return '<path d="' + p + '"/>';
  });
  return '<svg viewBox="0 0 16 16" aria-hidden="true">' + partes.join('') + '</svg>';
}
/* o icone para quem monta em volta (a vista PCB pendura as opcoes dela no menu) */
const iconeDe = nome => (ICONES[nome] ? icone(nome) : '');
const ACEITA = '.gbr,.gbx,.ger,.pho,.art,.gtl,.gbl,.gto,.gbo,.gts,.gbs,.gtp,.gbp,.gko,.gml,.gpt,.gpb,.gm1,.gm2,.gm3,.gm4,.gm13,.gm15,.gd1,.gg1,.g1,.g2,.gp1,.gp2,' +
  '.drl,.txt,.xln,.exc,.drd,.cmp,.sol,.plc,.pls,.stc,.sts,.crc,.crs,.dim,.zip,.rar';

/* NO TEMA DO HUB: as cores da interface sao os tokens do hub-tema.css (a cor depois da virgula
   so vale numa pagina sem os tokens). Cor fixa (hex) so no desenho: o fundo preto da placa e o
   ciano do conjunto B. Nada de crase aqui dentro - ela fecha esta string. */
const CSS = `
.gv-raiz{position:relative; width:100%; height:100%; min-height:0; display:flex; flex-direction:column; overflow:hidden; outline:none;
  background:var(--bg,#0f0f11); color:var(--text,#f2f2f3); font:12px/1.4 var(--font,system-ui,"Segoe UI",sans-serif);}
.gv-raiz *{box-sizing:border-box;}
.gv-raiz [hidden]{display:none !important;}
.gv-raiz button{font:inherit; font-size:12px; color:var(--text-2,#a8a8ae); background:transparent; border:1px solid transparent;
  border-radius:var(--r-sm,5px); height:26px; padding:0 8px; display:inline-flex; align-items:center; gap:5px; cursor:pointer; white-space:nowrap; flex:none;}
.gv-raiz button:hover:not(:disabled){color:var(--text,#f2f2f3); background:rgba(var(--tint,242,242,243),.08); border-color:var(--edge,#2a2a2e);}
.gv-raiz button:disabled{opacity:.4; cursor:not-allowed;}
.gv-raiz button:focus-visible{outline:2px solid var(--hi,#d8d8dd); outline-offset:1px;}
.gv-raiz svg{width:16px; height:16px; flex:none; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round;}
.gv-raiz select{font:inherit; font-size:12px; color:var(--text,#f2f2f3); background:var(--surface,#1a1a1d); border:1px solid var(--edge,#2a2a2e);
  border-radius:var(--r-sm,5px); height:26px; padding:0 4px; max-width:260px;}
.gv-barra{flex:none; display:flex; align-items:center; gap:3px; padding:5px 8px; background:var(--surface-2,#161619);
  border-bottom:1px solid var(--edge,#2a2a2e); overflow-x:auto; overflow-y:hidden;}
.gv-tit{flex:0 1 auto; min-width:60px; max-width:320px; font-weight:600; color:var(--text,#f2f2f3); overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; margin-right:6px;}
.gv-extra{display:inline-flex; gap:3px; flex:none;}
.gv-extra:empty{display:none;}
.gv-raiz button.gv-prim{color:var(--hi,#d8d8dd); border-color:var(--hi,#d8d8dd);}
.gv-sep{flex:none; width:1px; height:18px; background:var(--edge,#2a2a2e); margin:0 4px;}
.gv-flex{flex:1 1 auto; min-width:8px;}
.gv-seg{display:inline-flex; flex:none; border:1px solid var(--edge,#2a2a2e); border-radius:var(--r-sm,5px); overflow:hidden;}
.gv-raiz .gv-seg button{border:0; border-radius:0; height:24px;}
.gv-raiz .gv-seg button + button{border-left:1px solid var(--edge,#2a2a2e);}
.gv-raiz .gv-seg button[aria-pressed="true"]{background:var(--hi,#d8d8dd); color:var(--on-hi,#10120f);}
.gv-corpo{flex:1 1 auto; display:flex; min-height:0;}
.gv-tela{flex:1 1 auto; position:relative; min-width:0; background:${FUNDO}; overflow:hidden;}
.gv-cv{position:absolute; inset:0; width:100%; height:100%; display:block; background:${FUNDO}; cursor:crosshair; touch-action:none;}
.gv-cv.gv-arrasta{cursor:grabbing;}
.gv-vazio{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:24px; text-align:center;
  white-space:pre-line; color:var(--text-3,#7a7a80); font-size:13px; pointer-events:none;}
.gv-raiz.gv-solta .gv-tela{outline:2px dashed var(--hi,#d8d8dd); outline-offset:-6px;}
.gv-menu{position:absolute; left:10px; top:10px; z-index:4; width:196px; max-height:calc(100% - 20px); overflow:auto; display:flex; flex-direction:column;
  padding:4px; border-radius:var(--r-md,8px); background:rgba(22,22,25,.72); -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);
  box-shadow:0 0 0 1px rgba(255,255,255,.08), 0 10px 28px rgba(0,0,0,.45); color:var(--text,#f2f2f3);}
.gv-menu-cab{display:flex; align-items:center; gap:4px; padding:2px 2px 4px 6px;}
.gv-menu-cab .gv-tit{flex:1 1 auto; min-width:0; max-width:none; margin:0; font-size:12px;}
.gv-menu-cab .gv-tit select{max-width:100%;}
.gv-raiz .gv-menu button{width:100%; justify-content:flex-start; height:26px; padding:0 8px; color:var(--text-2,#c8c8ce);}
.gv-raiz .gv-menu .gv-menu-cab button{width:26px; padding:0; justify-content:center; flex:none;}
.gv-raiz .gv-menu button.gv-prim{color:var(--hi,#d8d8dd); border-color:transparent;}
.gv-menu .gv-extra{display:flex; flex-direction:column; gap:0;}
.gv-menu .gv-sep{width:auto; height:1px; margin:4px 6px;}
.gv-menu-linha{display:flex; align-items:center; gap:6px; padding:2px 8px; height:28px; color:var(--text-2,#c8c8ce);}
.gv-menu-linha .gv-seg{flex:1;}
.gv-raiz .gv-menu-linha .gv-seg button{flex:1; width:auto; justify-content:center; padding:0 4px; height:22px;}
.gv-menu-corpo{display:flex; flex-direction:column;}
.gv-menu.gv-recolhido .gv-menu-corpo{display:none;}
.gv-menu.gv-recolhido{width:auto; max-width:260px;}
.gv-menu-extra:empty{display:none;}
.gv-com-menu .gv-faixa{left:216px;}
.gv-faixa{position:absolute; left:10px; right:10px; top:10px; z-index:3; display:flex; gap:8px; align-items:flex-start; padding:8px 10px;
  background:var(--surface,#1a1a1d); color:var(--text,#f2f2f3); border-left:3px solid var(--warn,#d6a75a); border-radius:var(--r-sm,5px);
  box-shadow:var(--shadow-menu,0 8px 24px rgba(0,0,0,.5));}
.gv-faixa.gv-err{border-left-color:var(--err,#e0555a);}
.gv-faixa.gv-info{border-left-color:var(--hi,#d8d8dd);}
.gv-faixa span{flex:1; white-space:pre-wrap; word-break:break-word;}
.gv-raiz .gv-faixa button{height:20px; width:22px; padding:0; justify-content:center;}
.gv-ocupado{position:absolute; right:12px; bottom:10px; z-index:2; padding:4px 10px; border-radius:var(--r-sm,5px);
  background:var(--surface,#1a1a1d); color:var(--text-2,#a8a8ae); box-shadow:var(--shadow-menu,0 8px 24px rgba(0,0,0,.5));}
.gv-painel{flex:none; width:260px; display:flex; flex-direction:column; gap:12px; padding:8px; overflow-y:auto;
  background:var(--surface-2,#161619); border-left:1px solid var(--edge,#2a2a2e);}
.gv-rot{font-size:10.5px; color:var(--text-3,#7a7a80); text-transform:uppercase; letter-spacing:.05em;}
.gv-comp{display:flex; flex-direction:column; gap:6px;}
.gv-comp .gv-linha{display:flex; align-items:center; gap:6px; flex-wrap:wrap;}
.gv-comp select{flex:1; min-width:0;}
.gv-grupo{display:flex; flex-direction:column; gap:3px;}
.gv-gcab{display:flex; align-items:center; gap:6px; min-height:24px;}
.gv-letra{flex:none; width:18px; height:18px; border-radius:4px; display:inline-flex; align-items:center; justify-content:center;
  font-size:11px; font-weight:600; background:var(--surface,#1a1a1d); color:var(--text,#f2f2f3); border:1px solid var(--edge,#2a2a2e);}
.gv-letra.gv-b{background:${CIANO_B}; color:#062a2a; border-color:${CIANO_B};}
.gv-gtit{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; color:var(--text,#f2f2f3);}
.gv-raiz .gv-gcab button{height:20px; padding:0 5px; font-size:11px;}
.gv-lista{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:1px;}
.gv-cam{display:flex; align-items:center; gap:6px; padding:2px 4px; border-radius:var(--r-sm,5px); cursor:pointer; border:1px solid transparent;}
.gv-cam:hover{background:rgba(var(--tint,242,242,243),.06);}
.gv-cam.gv-dest{border-color:var(--hi,#d8d8dd); background:rgba(var(--tint,242,242,243),.08);}
.gv-cam.gv-oculta .gv-nome, .gv-cam.gv-oculta .gv-qtd, .gv-cam.gv-oculta .gv-amostra{opacity:.4;}
.gv-amostra{flex:none; width:12px; height:12px; border-radius:2px; box-shadow:0 0 0 1px rgba(var(--tint,242,242,243),.3) inset;}
.gv-raiz .gv-olho{height:22px; width:24px; padding:0; justify-content:center;}
.gv-nome{flex:1; min-width:0; display:flex; flex-direction:column; line-height:1.25;}
.gv-nome b{font-weight:500; color:var(--text,#f2f2f3); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.gv-nome small{font-size:10.5px; color:var(--text-3,#7a7a80); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.gv-qtd{flex:none; font:10.5px var(--mono,monospace); color:var(--text-3,#7a7a80); font-variant-numeric:tabular-nums;}
.gv-qtd.gv-av{color:var(--warn,#d6a75a);}
.gv-ign{font-size:11px; color:var(--text-3,#7a7a80); padding:2px 4px;}
.gv-opac{display:flex; align-items:center; gap:8px; color:var(--text-2,#a8a8ae);}
.gv-opac input{flex:1; min-width:0; accent-color:var(--hi,#d8d8dd);}
.gv-opac output{font:11px var(--mono,monospace); width:36px; text-align:right;}
.gv-avisos{font-size:11px; color:var(--text-2,#a8a8ae);}
.gv-avisos summary{cursor:pointer; color:var(--warn,#d6a75a);}
.gv-avisos ul{margin:6px 0 0; padding-left:16px; display:flex; flex-direction:column; gap:3px; word-break:break-word;}
.gv-avisos li b{color:var(--text,#f2f2f3); font-weight:500;}
.gv-dica{font-size:11px; color:var(--text-3,#7a7a80); line-height:1.5;}
.gv-rodape{flex:none; display:flex; align-items:center; gap:18px; padding:3px 10px; min-height:22px; overflow:hidden; white-space:nowrap;
  background:var(--surface-2,#161619); border-top:1px solid var(--edge,#2a2a2e); font:11px/1.5 var(--mono,monospace); color:var(--text-2,#a8a8ae);}
.gv-rodape .gv-obj{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; color:var(--text,#f2f2f3);}
@media (max-width:760px){ .gv-painel{width:200px;} }
`;
let cssPosto = false;
function injetaCSS() {
  if (cssPosto) return;
  cssPosto = true;
  if (document.getElementById('hub-gerberview-css')) return;
  const s = document.createElement('style');
  s.id = 'hub-gerberview-css';
  s.textContent = CSS;
  (document.head || document.documentElement).appendChild(s);
}

/* paleta de pt-BR para o rodape */
const TIPO_OBJ = { flash: 'flash', line: 'traço', arc: 'arco', region: 'região' };
const fmtN = v => (Math.round(v * 10000) / 10000).toString();
function descreveAbertura(ap) {
  if (!ap) return '';
  const d = ap.ferramenta != null ? 'T' + ap.ferramenta : 'D' + ap.d;
  const p = ap.params || [];
  let s;
  switch (ap.tipo) {
    case 'C': s = d + ' ⌀' + fmtN(p[0] || 0); break;
    case 'R': s = d + ' R ' + fmtN(p[0]) + '×' + fmtN(p[1]); break;
    case 'O': s = d + ' O ' + fmtN(p[0]) + '×' + fmtN(p[1]); break;
    case 'P': s = d + ' P ⌀' + fmtN(p[0]) + ' ' + p[1] + ' lados'; break;
    default: s = d + ' ' + (ap.nomeMacro || 'macro');
  }
  if (ap.furo) s += ' furo ' + ap.furo.map(fmtN).join('×');
  if (ap.indefinida) s += ' (sem %AD)';
  return s;
}

/* montar(el, opcoes) -> controlador:
     carregar(conjuntos)      troca tudo (com 2 conjuntos, o segundo e o B da comparacao) e enquadra
     mostrar(i)               o conjunto i vira o A
     comparar(i)              o conjunto i vira o B (modo A+B)
     adicionar(conj, comoB)   soma um conjunto e mostra (ou compara)
     substituir(i, conj)      troca o conjunto i mantendo a vista e o olho de cada camada (ex.: Gerar de novo)
     redesenhar(), enquadrar(), avisar(msg, tipo), destruir()
     elemento, botoesExtra, estado (fotografia: conjuntos, camadas, vista, modo, zoom)
   opcoes = { conjuntos:[{titulo, arquivos:[{nome, texto}]}], aoFechar(ctrl),
              barraExtra:[{rotulo, titulo, acao(ctrl, ev), primario?, desabilitado?, curto?, ic?}],
              vista:'cima'|'baixo', modo:'camadas'|'realista', menu?:true }
   menu:true = no lugar da barra de cima, um menu translucido no canto superior esquerdo da tela, em
   lista: icone + rotulo curto (o `curto` da barraExtra; `ic` = um dos ICONES), recolhivel pelo
   cabecalho. ctrl.menuExtra e a gaveta dele para o chamador pendurar o que quiser (opcoes, avisos).
   acao que devolve Promise trava o proprio botao ate terminar. O el precisa ter tamanho (a vista
   ocupa 100% dele); escondido, ela espera aparecer para enquadrar. */
function montar(el, opcoes) {
  if (typeof document === 'undefined') throw new Error('HubGerberView.montar: só no navegador');
  if (!el) throw new Error('HubGerberView.montar: falta o elemento');
  opcoes = opcoes || {};
  injetaCSS();

  const st = {
    conjuntos: [], ia: -1, ib: -1, comp: 'A',
    vista: opcoes.vista === 'baixo' ? 'baixo' : 'cima',
    modo: opcoes.modo === 'realista' ? 'realista' : 'camadas',
    opac: 0.85, destaque: null,
    view: { scale: 4, cx: 0, cy: 0 }, enquadrar: true,
    hover: null, sel: null, mouse: null, ultimoXY: null,
  };
  let destruido = false;

  const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const botao = (rot, titulo, ic) => {
    const b = mk('button');
    b.type = 'button';
    if (ic) b.innerHTML = icone(ic);
    if (rot) b.appendChild(document.createTextNode(rot));
    if (titulo) b.title = titulo;
    return b;
  };
  function segmento(opcs, aoMudar) {
    const s = mk('div', 'gv-seg');
    const bs = opcs.map(o => { const b = botao(o[1], o[2]); b.dataset.v = o[0]; b.addEventListener('click', () => aoMudar(o[0])); s.appendChild(b); return b; });
    return { el: s, set: v => bs.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v))) };
  }

  /* ---- DOM ---- */
  const raiz = mk('div', 'gv-raiz');
  raiz.tabIndex = -1;
  const barra = mk('div', 'gv-barra');
  const tit = mk('div', 'gv-tit');
  const extra = mk('div', 'gv-extra');
  const bAbrir = botao('Abrir Gerber…', 'Abrir arquivos Gerber/Excellon ou um .zip (também dá para arrastá-los para a tela)', 'abrir');
  const bComparar = botao('Comparar com…', 'Abrir um segundo conjunto para comparar com este (arrastar com Shift também)', 'comparar');
  const bEnq = botao('', 'Enquadrar (F)', 'enquadrar');
  const segVista = segmento([['cima', 'Cima', 'Vista de cima (V alterna)'], ['baixo', 'Baixo', 'Vista de baixo, espelhada como o Flip Board do Altium (V alterna)']], v => { st.vista = v; atualiza(); });
  const segModo = segmento([['camadas', 'Camadas', 'Cada camada na sua cor (R alterna)'], ['realista', 'Realista', 'Máscara verde, cobre exposto dourado, serigrafia branca, furos vazados (R alterna)']], v => { st.modo = v; atualiza(); });
  const bFechar = botao('Fechar', 'Fechar (Esc)', 'fechar');
  bFechar.hidden = typeof opcoes.aoFechar !== 'function';
  const inAbrir = mk('input'), inComp = mk('input');
  for (const i of [inAbrir, inComp]) { i.type = 'file'; i.multiple = true; i.hidden = true; i.accept = ACEITA; }
  const menu = opcoes.menu ? mk('div', 'gv-menu') : null, menuExtra = mk('div', 'gv-menu-extra');
  if (menu) {
    /* os mesmos botoes, em lista: icone + rotulo curto */
    const curto = (b, txt) => { for (const n of Array.from(b.childNodes)) if (n.nodeType === 3) n.remove(); b.appendChild(document.createTextNode(txt)); };
    curto(bAbrir, 'Abrir…'); curto(bComparar, 'Comparar…'); bEnq.appendChild(document.createTextNode('Enquadrar'));
    const cab = mk('div', 'gv-menu-cab'), bRec = botao('', 'Recolher o menu');
    const corpo0 = mk('div', 'gv-menu-corpo');
    const linha = (ic, el, titulo) => { const l = mk('div', 'gv-menu-linha'); l.innerHTML = icone(ic); if (titulo) l.title = titulo; l.appendChild(el); return l; };
    cab.append(tit, bRec);
    corpo0.append(extra, mk('span', 'gv-sep'), bAbrir, bComparar, bEnq, linha('virar', segVista.el, 'Vista (V)'), linha('camadas', segModo.el, 'Cores (R)'),
      menuExtra, mk('span', 'gv-sep'), bFechar);
    menu.append(cab, corpo0, inAbrir, inComp);
    let recolhido = false;
    try { recolhido = localStorage.getItem('hubgerberview.menu') === 'recolhido'; } catch (_) { /* sem storage */ }
    const pinta = () => { menu.classList.toggle('gv-recolhido', recolhido); bRec.innerHTML = icone(recolhido ? 'expandir' : 'recolher'); bRec.title = recolhido ? 'Abrir o menu' : 'Recolher o menu'; };
    bRec.addEventListener('click', () => { recolhido = !recolhido; pinta(); try { localStorage.setItem('hubgerberview.menu', recolhido ? 'recolhido' : 'aberto'); } catch (_) { /* sem storage */ } });
    pinta();
  } else barra.append(tit, extra, mk('span', 'gv-sep'), bAbrir, bComparar, mk('span', 'gv-sep'), bEnq, segVista.el, segModo.el, mk('span', 'gv-flex'), bFechar, inAbrir, inComp);

  const corpo = mk('div', 'gv-corpo');
  const tela = mk('div', 'gv-tela');
  const cv = mk('canvas', 'gv-cv');
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', 'Visualização do Gerber');
  const vazio = mk('div', 'gv-vazio', 'Nenhum Gerber aberto.\nUse “Abrir Gerber…” ou arraste para cá os .gbr/.drl ou um .zip.');
  const faixa = mk('div', 'gv-faixa'), faixaTxt = mk('span'), faixaX = botao('', 'Fechar o aviso', 'fechar');
  faixa.append(faixaTxt, faixaX);
  faixa.hidden = true;
  const ocupado = mk('div', 'gv-ocupado', 'Lendo arquivos…');
  ocupado.hidden = true;
  tela.append(cv, vazio, faixa, ocupado);
  if (menu) tela.appendChild(menu);

  const painel = mk('aside', 'gv-painel');
  const comp = mk('div', 'gv-comp');
  const segComp = segmento([['A', 'A', 'Só o conjunto A'], ['B', 'B', 'Só o conjunto B'], ['AB', 'A+B', 'A nas cores das camadas e B por cima em ciano translúcido']], v => { st.comp = v; st.hover = null; atualiza(); });
  const selB = mk('select');
  selB.title = 'Conjunto B';
  const bParar = botao('Parar', 'Parar de comparar');
  const linhaComp = mk('div', 'gv-linha');
  linhaComp.append(segComp.el, bParar);
  comp.append(mk('div', 'gv-rot', 'Comparação (C alterna)'), linhaComp, selB);
  const grupos = mk('div');
  grupos.style.cssText = 'display:flex;flex-direction:column;gap:12px';
  const opac = mk('label', 'gv-opac');
  const opIn = mk('input'), opOut = mk('output');
  opIn.type = 'range'; opIn.min = '10'; opIn.max = '100'; opIn.value = String(Math.round(st.opac * 100));
  opac.append(document.createTextNode('Opacidade'), opIn, opOut);
  const avisos = mk('details', 'gv-avisos');
  const dica = mk('div', 'gv-dica', 'Clique numa camada para destacá-la; Shift+clique no olho mostra só ela. Arraste com qualquer botão para mover, roda para ampliar.');
  painel.append(comp, grupos, opac, avisos, dica);
  corpo.append(tela, painel);

  const rodapeEl = mk('div', 'gv-rodape');
  const xyEl = mk('span'), zoomEl = mk('span'), objEl = mk('span', 'gv-obj');
  rodapeEl.append(xyEl, zoomEl, objEl);
  if (menu) raiz.classList.add('gv-com-menu');
  raiz.append(...(menu ? [] : [barra]), corpo, rodapeEl);
  el.appendChild(raiz);

  /* ---- barra do chamador ---- */
  const botoesExtra = (opcoes.barraExtra || []).map(def => {
    const b = botao(menu && def.curto ? def.curto : (def.rotulo || ''), def.titulo || def.rotulo || '', menu && def.ic && ICONES[def.ic] ? def.ic : null);
    if (def.primario) b.classList.add('gv-prim');
    if (def.desabilitado) b.disabled = true;
    b.addEventListener('click', ev => {
      if (typeof def.acao !== 'function') return;
      let r;
      try { r = def.acao(ctrl, ev); } catch (e) { avisar((def.rotulo || 'Ação') + ': ' + (e && e.message || e), 'err'); return; }
      if (r && typeof r.then === 'function') {
        b.disabled = true;
        r.then(() => {}, e => avisar((def.rotulo || 'Ação') + ': ' + (e && e.message || e), 'err')).then(() => { if (!destruido) b.disabled = !!def.desabilitado; });
      }
    });
    extra.appendChild(b);
    return b;
  });

  /* ---- avisos: o toast do hub quando existe; senao a faixa na propria tela ---- */
  let faixaT = 0;
  function avisar(msg, tipo) {
    tipo = tipo || 'warn';
    const HD = typeof window !== 'undefined' ? window.HubDialog : null;
    if (HD && typeof HD.toast === 'function') { HD.toast(msg, tipo, tipo === 'err' ? 0 : 9000); return; }
    faixaTxt.textContent = msg;
    faixa.className = 'gv-faixa' + (tipo === 'err' ? ' gv-err' : tipo === 'info' || tipo === 'ok' ? ' gv-info' : '');
    faixa.hidden = false;
    clearTimeout(faixaT);
    if (tipo !== 'err') faixaT = setTimeout(() => { faixa.hidden = true; }, 12000);
  }
  faixaX.addEventListener('click', () => { faixa.hidden = true; });

  /* ---- canvas e matriz ---- */
  const ctx = cv.getContext('2d');
  let DPR = window.devicePixelRatio || 1, W = 0, H = 0;
  const pool = new Map();
  function folha(nome) {
    let c = pool.get(nome);
    if (!c) { c = document.createElement('canvas'); pool.set(nome, c); }
    if (c.width !== cv.width || c.height !== cv.height) { c.width = cv.width; c.height = cv.height; }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, c.width, c.height);
    return c;
  }
  function mede() {
    DPR = window.devicePixelRatio || 1;
    W = tela.clientWidth; H = tela.clientHeight;
    const w = Math.max(1, Math.round(W * DPR)), h = Math.max(1, Math.round(H * DPR));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  }
  const fx = () => (st.vista === 'baixo' ? -1 : 1);
  function matriz() {
    const s = st.view.scale, f = fx();
    return [DPR * s * f, 0, 0, -DPR * s, DPR * (W / 2 - st.view.cx * s * f), DPR * (H / 2 + st.view.cy * s)];
  }
  const aplica = (g, T) => g.setTransform(T[0], T[1], T[2], T[3], T[4], T[5]);
  function telaParaMundo(sx, sy) {
    const s = st.view.scale;
    return { x: (sx - W / 2) / (s * fx()) + st.view.cx, y: (H / 2 - sy) / s + st.view.cy };
  }

  /* ---- conjuntos ---- */
  const conjunto = i => (i >= 0 && i < st.conjuntos.length ? st.conjuntos[i] : null);
  function naTela() {
    const A = conjunto(st.ia), B = conjunto(st.ib), out = [];
    if (st.comp === 'B' && B) out.push([B, 'B']);
    else { if (A) out.push([A, 'A']); if (st.comp === 'AB' && B) out.push([B, 'B']); }
    return out;
  }
  const LATERAIS = { cobre: 1, pads: 1, mascara: 1, pasta: 1, legenda: 1 };
  function ordemPintura(k) {
    if (!LATERAIS[k.info.tipo]) return 2000 + k.info.ordem;
    return st.vista === 'baixo' ? 1000 - k.info.ordem : k.info.ordem;
  }
  const ordemLista = i => (LATERAIS[i.tipo] ? 1000 - i.ordem : 2000 + i.ordem);
  const visiveis = conj => conj.camadas.filter(k => k.visivel).sort((a, b) => ordemPintura(a) - ordemPintura(b));
  const ehBuraco = k => k.info.tipo === 'furo' && k.info.chave !== 'DrillNPTH';
  function prepara(conj, avisosExtra) {
    const r = lerConjunto(conj);
    r.camadas.forEach(k => { k.visivel = true; });
    r.camadas.sort((a, b) => ordemLista(a.info) - ordemLista(b.info));
    r.avisosExtra = (avisosExtra || []).slice();
    /* o contorno da placa do modo realista (puro; o Path2D sai na hora de pintar) */
    r.contorno = placaDoConjunto(r.camadas);
    if (r.contorno.aviso) r.avisosExtra.push(r.contorno.aviso);
    return r;
  }
  function caixaDoConjunto(conj, soVisiveis) {
    let lista = conj.camadas.filter(k => k.cam.bbox && (!soVisiveis || k.visivel));
    if (!lista.length) lista = conj.camadas.filter(k => k.cam.bbox);
    if (!lista.length) return null;
    const b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    for (const k of lista) {
      const c = k.cam.bbox;
      b.x1 = Math.min(b.x1, c.x1); b.y1 = Math.min(b.y1, c.y1); b.x2 = Math.max(b.x2, c.x2); b.y2 = Math.max(b.y2, c.y2);
    }
    return b;
  }
  function placaDe(conj) {
    if (conj.placa) return conj.placa;
    /* qual camada e o contorno, e o que fazer quando ele nao fecha: placaDoConjunto (puro) */
    const pc = conj.contorno || placaDoConjunto(conj.camadas);
    let path = null, recortes = null;
    if (pc.lacos.length) {
      path = new Path2D();
      for (const l of pc.lacos) poligonoNoCaminho(path, l);
      if (pc.recortes.length) { recortes = new Path2D(); for (const r of pc.recortes) poligonoNoCaminho(recortes, antiHorario(r)); }
    }
    if (!path) {
      const b = caixaDoConjunto(conj, false);
      if (b) { path = new Path2D(); path.rect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); }
    }
    conj.placa = { path, recortes };
    return conj.placa;
  }

  /* ---- pintura ---- */
  function pintaSeq(g, ap, grupo, escuro, cor) {
    const fs = formasDe(ap);
    if (!grupo.caminhos) {
      grupo.caminhos = fs.map(f => {
        const pa = new Path2D(), c = grupo.pontos;
        for (let i = 0; i < c.length; i += 2) tracaForma(pa, f, c[i], c[i + 1]);
        return pa;
      });
    }
    const r = folha('rascunho'), rg = r.getContext('2d');
    rg.setTransform(g.getTransform());
    rg.fillStyle = cor;
    fs.forEach((f, i) => { rg.globalCompositeOperation = f.claro ? 'destination-out' : 'source-over'; rg.fill(grupo.caminhos[i], 'nonzero'); });
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = escuro ? 'source-over' : 'destination-out';
    g.drawImage(r, 0, 0);
    g.restore();
  }
  /* uma camada num contexto com a matriz ja posta: escuro pinta, claro (LPC) apaga */
  function pintaCamada(g, k, cor) {
    const plano = planoDe(k);
    const minW = 1 / st.view.scale;                     /* traco fino nunca some: 1 px no minimo */
    g.fillStyle = cor; g.strokeStyle = cor; g.lineCap = 'round'; g.lineJoin = 'round';
    const neg = !!k.cam.negativo;
    if (neg && k.cam.bbox) {
      const b = k.cam.bbox;
      g.globalCompositeOperation = 'source-over';
      g.fillRect(b.x1 - 1, b.y1 - 1, b.x2 - b.x1 + 2, b.y2 - b.y1 + 2);
    }
    for (const l of plano) {
      const escuro = neg ? !l.escuro : l.escuro;
      g.globalCompositeOperation = escuro ? 'source-over' : 'destination-out';
      if (l.preench) g.fill(l.preench, 'nonzero');
      for (const [w, pa] of l.tracos) { g.lineWidth = Math.max(w, minW); g.stroke(pa); }
      for (const [ap, grupo] of l.seq) pintaSeq(g, ap, grupo, escuro, cor);
    }
    g.globalCompositeOperation = 'source-over';
  }
  /* o destaque vale para a MESMA camada nos dois conjuntos (A e B), para comparar uma de cada vez */
  const destacada = k => !st.destaque || k === st.destaque || (k.info.chave !== 'Other' && k.info.chave === st.destaque.info.chave);
  const alfa = k => st.opac * (destacada(k) ? 1 : 0.15);
  function camadaNaFolha(nome, k, cor, T) {
    const f = folha(nome), g = f.getContext('2d');
    aplica(g, T);
    pintaCamada(g, k, cor);
    return f;
  }
  function pintaCamadas(conj, T) {
    const g = ctx;
    for (const k of visiveis(conj)) {
      const f = camadaNaFolha('camada', k, k.info.cor, T);
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (ehBuraco(k)) {
        /* furo metalizado: buraco de verdade no que ja foi pintado, com um aro para ser visto */
        g.globalCompositeOperation = 'destination-out';
        g.globalAlpha = 1;
        g.drawImage(f, 0, 0);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = alfa(k);
        aplica(g, T);
        g.strokeStyle = REAL.aro;
        g.lineWidth = 1 / st.view.scale;
        g.stroke(aroDe(k));
        g.setTransform(1, 0, 0, 1, 0, 0);
      } else {
        g.globalAlpha = alfa(k);
        g.drawImage(f, 0, 0);
      }
      g.globalAlpha = 1;
    }
  }
  /* o conjunto B por cima, em ciano translucido: o que so um dos dois tem salta aos olhos */
  function pintaSobre(conj, T) {
    for (const k of visiveis(conj)) {
      const f = camadaNaFolha('camada', k, CIANO_B, T);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.55 * alfa(k);
      ctx.drawImage(f, 0, 0);
      ctx.globalAlpha = 1;
    }
  }
  /* realista: substrato com mascara dentro do perfil, cobre sob a mascara em verde claro, cobre
     exposto (cobre e abertura da mascara) dourado, serigrafia branca cortada nas aberturas,
     furos vazados */
  function pintaRealista(conj, T) {
    const g = ctx;
    const lado = st.vista === 'baixo' ? 'bottom' : 'top';
    const vis = conj.camadas.filter(k => k.visivel);
    const de = tipo => vis.find(k => k.info.tipo === tipo && k.info.lado === lado);
    const cobre = de('cobre'), masc = de('mascara'), leg = de('legenda');
    const furos = vis.filter(k => k.info.tipo === 'furo');
    const placa = placaDe(conj);
    if (!placa.path) return;
    const tinta = (src, cor, recorte, modo) => {
      const t = folha('tinta'), c = t.getContext('2d');
      c.drawImage(src, 0, 0);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = cor;
      c.fillRect(0, 0, t.width, t.height);
      if (recorte) { c.globalCompositeOperation = modo; c.drawImage(recorte, 0, 0); }
      c.globalCompositeOperation = 'source-over';
      return t;
    };
    const naPlaca = img => {
      g.save();
      aplica(g, T);
      g.clip(placa.path, 'evenodd');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(img, 0, 0);
      g.restore();
    };
    aplica(g, T);
    g.fillStyle = masc ? REAL.mascara : REAL.fr4;
    g.fill(placa.path, 'evenodd');
    g.setTransform(1, 0, 0, 1, 0, 0);
    const fc = cobre ? camadaNaFolha('cobre', cobre, '#ffffff', T) : null;
    const fm = masc ? camadaNaFolha('mascara', masc, '#ffffff', T) : null;
    if (fc) naPlaca(tinta(fc, masc ? REAL.cobreSob : REAL.ouro));
    if (fm) {
      naPlaca(tinta(fm, REAL.fr4));
      if (fc) naPlaca(tinta(fc, REAL.ouro, fm, 'destination-in'));
    }
    if (leg) naPlaca(tinta(camadaNaFolha('camada', leg, '#ffffff', T), REAL.silk, fm, 'destination-out'));
    for (const k of furos) {
      const f = camadaNaFolha('camada', k, '#ffffff', T);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(f, 0, 0);
      g.globalCompositeOperation = 'source-over';
    }
    if (placa.recortes) {
      aplica(g, T);
      g.globalCompositeOperation = 'destination-out';
      g.fill(placa.recortes, 'nonzero');
      g.globalCompositeOperation = 'source-over';
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
  function marcas(T) {
    const g = ctx, um = 1 / st.view.scale;
    aplica(g, T);
    for (const m of [[st.sel, SEL, 2.2], [st.hover, 'rgba(255,255,255,0.92)', 1.2]]) {
      const a = m[0];
      if (!a || !a.p) continue;
      g.strokeStyle = m[1];
      if (a.p.k === 'arc') {
        const pa = new Path2D();
        pa.moveTo(a.p.x1, a.p.y1);
        arcoNoCaminho(pa, a.p);
        g.globalAlpha = 0.45;
        g.lineCap = 'round';
        g.lineWidth = 2 * meiaLargura(a.p.ap) + 3 * um;
        g.stroke(pa);
        g.globalAlpha = 1;
        continue;
      }
      g.lineWidth = m[2] * um;
      g.stroke(contornoDoObjeto(a.p));
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  let quadro = 0;
  function agenda() { if (!quadro && !destruido) quadro = requestAnimationFrame(desenha); }
  function desenha() {
    quadro = 0;
    if (destruido) return;
    mede();
    const g = ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, cv.width, cv.height);
    const A = conjunto(st.ia), B = conjunto(st.ib);
    vazio.hidden = !!A;
    if (!W || !H || !A) { rodape(); return; }
    if (st.enquadrar) { st.enquadrar = false; enquadrar(); }
    const T = matriz();
    if (st.modo === 'realista') {
      pintaRealista(st.comp === 'B' && B ? B : A, T);
      if (st.comp === 'AB' && B) pintaSobre(B, T);
    } else if (st.comp === 'B' && B) pintaCamadas(B, T);
    else {
      pintaCamadas(A, T);
      if (st.comp === 'AB' && B) pintaSobre(B, T);
    }
    marcas(T);
    rodape();
    /* a vista mudou com o mouse parado (tecla, enquadrar, troca de modo): o objeto sob ele tambem */
    if (st.mouse && !arrasto && !hoverQ) hoverQ = requestAnimationFrame(atualizaHover);
  }
  function enquadrar() {
    if (!W || !H) { st.enquadrar = true; return; }
    const cx = naTela().map(c => caixaDoConjunto(c[0], true)).filter(Boolean);
    if (!cx.length) return;
    const x1 = Math.min.apply(null, cx.map(b => b.x1)), y1 = Math.min.apply(null, cx.map(b => b.y1));
    const x2 = Math.max.apply(null, cx.map(b => b.x2)), y2 = Math.max.apply(null, cx.map(b => b.y2));
    const w = Math.max(x2 - x1, 1), h = Math.max(y2 - y1, 1);
    st.view.cx = (x1 + x2) / 2;
    st.view.cy = (y1 + y2) / 2;
    st.view.scale = Math.max(0.05, Math.min(W / (w * 1.08), H / (h * 1.08)));
  }
  function zoomEm(sx, sy, f) {
    const w = telaParaMundo(sx, sy);
    st.view.scale = Math.min(20000, Math.max(0.05, st.view.scale * f));
    st.view.cx = w.x - (sx - W / 2) / (st.view.scale * fx());
    st.view.cy = w.y + (sy - H / 2) / st.view.scale;
    agenda();
  }

  /* ---- rodape e objeto sob o cursor ---- */
  function descreve(a) {
    const p = a.p, partes = [];
    if (st.ib >= 0) partes.push(a.letra);
    partes.push(a.k.info.nome);
    partes.push(TIPO_OBJ[p.k] + (p.k === 'line' && p.ap && p.ap.ferramenta != null ? ' (rasgo)' : ''));
    if (p.ap && p.k !== 'region') partes.push(descreveAbertura(p.ap));
    if (p.k === 'line') partes.push(fmtN(Math.hypot(p.x2 - p.x1, p.y2 - p.y1)) + ' mm');
    if (p.k === 'region') partes.push(p.contornos.reduce((s, c) => s + c.length, 0) + ' vértices');
    if (p.aperFunction) partes.push(p.aperFunction);
    if (p.obj) {
      if (p.obj.N) partes.push('net ' + p.obj.N);
      if (p.obj.C) partes.push(p.obj.C);
      if (p.obj.P) partes.push('pino ' + String(p.obj.P).split(',').slice(0, 2).join('-'));
    }
    if (!p.escuro) partes.push('claro (LPC)');
    return partes.join(' · ');
  }
  function rodape() {
    const w = st.ultimoXY;
    xyEl.textContent = w ? 'X ' + w.x.toFixed(4) + '  Y ' + w.y.toFixed(4) + ' mm · ' + (w.x / 0.0254).toFixed(1) + ' / ' + (w.y / 0.0254).toFixed(1) + ' mil' : 'X —  Y —';
    zoomEl.textContent = st.view.scale.toFixed(1) + ' px/mm';
    const a = st.hover || st.sel;
    objEl.textContent = a ? descreve(a) : '';
    objEl.title = objEl.textContent;
  }
  let hoverQ = 0;
  function atualizaHover() {
    hoverQ = 0;
    if (destruido) return;
    const m = st.mouse;
    let achou = null;
    if (m) {
      const w = telaParaMundo(m.x, m.y);
      st.ultimoXY = w;
      const tol = 3 / st.view.scale;
      const lado = st.vista === 'baixo' ? 'bottom' : 'top';
      const conjs = naTela().reverse();
      for (const c of conjs) {
        let lista = visiveis(c[0]).reverse();
        if (st.modo === 'realista') lista = lista.filter(k => k.info.tipo === 'furo' || ((k.info.tipo === 'cobre' || k.info.tipo === 'mascara' || k.info.tipo === 'legenda') && k.info.lado === lado));
        for (const k of lista) {
          const p = objetoEm(k.cam, w.x, w.y, tol);
          if (p) { achou = { k, p, letra: c[1] }; break; }
        }
        if (achou) break;
      }
    }
    const mudou = (st.hover && st.hover.p) !== (achou && achou.p);
    st.hover = achou;
    rodape();
    if (mudou) agenda();
  }

  /* ---- painel ---- */
  function montaTitulo() {
    tit.textContent = '';
    if (st.conjuntos.length > 1) {
      const s = mk('select');
      s.title = 'Conjunto mostrado (A)';
      st.conjuntos.forEach((c, i) => { const o = mk('option', null, c.titulo || 'Conjunto ' + (i + 1)); o.value = String(i); o.selected = i === st.ia; s.appendChild(o); });
      s.addEventListener('change', () => mostrar(+s.value));
      tit.appendChild(s);
    } else {
      const c = conjunto(st.ia);
      tit.textContent = c ? (c.titulo || 'Gerber') : 'Gerber';
      tit.title = tit.textContent;
    }
  }
  function montaPainel() {
    const A = conjunto(st.ia), B = conjunto(st.ib);
    comp.hidden = !B;
    if (B) {
      segComp.set(st.comp);
      selB.textContent = '';
      selB.hidden = st.conjuntos.length < 3;
      st.conjuntos.forEach((c, i) => { if (i === st.ia) return; const o = mk('option', null, 'B: ' + (c.titulo || 'Conjunto ' + (i + 1))); o.value = String(i); o.selected = i === st.ib; selB.appendChild(o); });
    }
    grupos.textContent = '';
    for (const [c, letra, ci] of [[A, 'A', st.ia], [B, 'B', st.ib]]) {
      if (!c) continue;
      const g = mk('div', 'gv-grupo');
      const cab = mk('div', 'gv-gcab');
      if (B) cab.appendChild(mk('span', 'gv-letra' + (letra === 'B' ? ' gv-b' : ''), letra));
      const t = mk('span', 'gv-gtit', c.titulo || 'Conjunto ' + (ci + 1));
      t.title = (c.titulo || '') + ' — ' + c.camadas.length + ' camada(s)';
      const bT = botao('todas', 'Mostrar todas as camadas'), bN = botao('nenhuma', 'Ocultar todas as camadas');
      bT.dataset.a = 'todas'; bN.dataset.a = 'nenhuma'; bT.dataset.c = bN.dataset.c = String(ci);
      cab.append(t, bT, bN);
      const ul = mk('ul', 'gv-lista');
      c.camadas.forEach((k, i) => {
        const li = mk('li', 'gv-cam' + (k.visivel ? '' : ' gv-oculta') + (st.destaque && destacada(k) ? ' gv-dest' : ''));
        li.dataset.c = String(ci); li.dataset.i = String(i);
        li.title = k.arquivo + (k.cam.funcao ? '\n' + k.cam.funcao : '') + (k.cam.atributos.FilePolarity === 'Negative' ? '\n(arquivo negativo: o desenhado são as aberturas)' : '') +
          (k.cam.avisos.length ? '\n' + k.cam.avisos.length + ' aviso(s): veja abaixo' : '');
        const am = mk('span', 'gv-amostra');
        am.style.background = letra === 'B' && st.comp === 'AB' ? CIANO_B : k.info.cor;
        const ol = botao('', 'Mostrar/ocultar (Shift+clique: só esta)', k.visivel ? 'olho' : 'olhoFechado');
        ol.classList.add('gv-olho');
        ol.dataset.a = 'olho';
        ol.setAttribute('aria-pressed', String(k.visivel));
        const nm = mk('span', 'gv-nome');
        nm.append(mk('b', null, k.info.nome), mk('small', null, String(k.arquivo).split(/[\\/]/).pop()));
        const q = mk('span', 'gv-qtd' + (k.cam.avisos.length ? ' gv-av' : ''), k.cam.prims.length.toLocaleString('pt-BR'));
        q.title = k.cam.prims.length + ' objeto(s)';
        li.append(am, ol, nm, q);
        ul.appendChild(li);
      });
      g.append(cab, ul);
      if (c.ignorados.length) {
        const ig = mk('div', 'gv-ign', c.ignorados.length + ' arquivo(s) que não são Gerber nem Excellon ficaram de fora');
        ig.title = c.ignorados.join('\n');
        g.appendChild(ig);
      }
      grupos.appendChild(g);
    }
    opOut.textContent = Math.round(st.opac * 100) + '%';
    /* avisos do parse (e do .zip) dos conjuntos na tela */
    avisos.textContent = '';
    const itens = [];
    for (const [c] of [[A], [B]]) {
      if (!c) continue;
      for (const a of c.avisosExtra || []) itens.push([c.titulo, a]);
      for (const k of c.camadas) for (const a of k.cam.avisos) itens.push([String(k.arquivo).split(/[\\/]/).pop(), a]);
    }
    avisos.hidden = !itens.length;
    if (itens.length) {
      const sm = mk('summary', null, 'Avisos de leitura (' + itens.length + ')');
      const ul = mk('ul');
      for (const it of itens.slice(0, 200)) { const li = mk('li'); li.append(mk('b', null, it[0] + ': '), document.createTextNode(it[1])); ul.appendChild(li); }
      avisos.append(sm, ul);
    }
  }
  function atualiza() {
    montaTitulo();
    montaPainel();
    segVista.set(st.vista);
    segModo.set(st.modo);
    agenda();
  }
  grupos.addEventListener('click', e => {
    const alvo = e.target.closest('[data-a], .gv-cam');
    if (!alvo) return;
    const ci = +(alvo.dataset.c != null ? alvo.dataset.c : alvo.closest('.gv-cam').dataset.c);
    const c = conjunto(ci);
    if (!c) return;
    const a = alvo.dataset.a;
    if (a === 'todas' || a === 'nenhuma') { c.camadas.forEach(k => { k.visivel = a === 'todas'; }); atualiza(); return; }
    const li = alvo.closest('.gv-cam');
    const k = c.camadas[+li.dataset.i];
    if (!k) return;
    if (a === 'olho') {
      if (e.shiftKey) {
        const so = c.camadas.every(x => x === k ? x.visivel : !x.visivel);
        c.camadas.forEach(x => { x.visivel = so ? true : x === k; });
      } else k.visivel = !k.visivel;
    } else st.destaque = st.destaque === k ? null : k;
    atualiza();
  });
  opIn.addEventListener('input', () => { st.opac = (+opIn.value || 85) / 100; opOut.textContent = opIn.value + '%'; agenda(); });
  selB.addEventListener('change', () => comparar(+selB.value));
  bParar.addEventListener('click', () => { st.ib = -1; st.comp = 'A'; st.hover = null; st.sel = null; atualiza(); });

  /* ---- arquivos do usuario ---- */
  function tituloDe(arquivos) {
    const nomes = arquivos.map(a => String(a.nome).split(/[\\/]/).pop());
    if (nomes.length === 1) return nomes[0];
    let p = nomes[0];
    for (const n of nomes) while (p && n.toLowerCase().indexOf(p.toLowerCase()) !== 0) p = p.slice(0, -1);
    p = p.replace(/[\s_.-]+$/, '');
    return p.length >= 3 ? p : nomes.length + ' arquivos';
  }
  async function abrirArquivos(lista, comoB) {
    if (!lista || !lista.length) return;
    const arquivos = [], extras = [];
    let titulo = '';
    ocupado.hidden = false;
    try {
      for (const f of lista) {
        const nome = f.name || 'arquivo';
        if (COMPACTADO.test(nome)) { avisar(avisoCompactado(nome), 'warn'); continue; }
        if (/\.zip$/i.test(nome)) {
          try {
            const lidos = await lerZip(await f.arrayBuffer());
            for (const a of lidos) arquivos.push(a);
            for (const a of lidos.avisos) extras.push(a);
            if (!lidos.length && !lidos.avisos.length) extras.push('“' + nome + '” está vazio.');
            if (!titulo) titulo = nome.replace(/\.zip$/i, '');
          } catch (e) { avisar(nome + ': ' + (e && e.message || e), 'err'); }
          continue;
        }
        if (f.size > LIMITE_ARQUIVO) { avisar(nome + ' tem ' + Math.round(f.size / 1048576) + ' MB: grande demais para um Gerber, ficou de fora.', 'warn'); continue; }
        arquivos.push({ nome, texto: await f.text() });
      }
    } finally { ocupado.hidden = true; }
    /* nada legivel: diz o porque (o .rar dentro do .zip, o .zip vazio) em vez de sair calado */
    if (!arquivos.length) { if (extras.length) avisar(semCamadas(titulo, [], extras), 'warn'); return; }
    adicionar({ titulo: titulo || tituloDe(arquivos), arquivos }, comoB, extras);
  }
  bAbrir.addEventListener('click', () => inAbrir.click());
  bComparar.addEventListener('click', () => inComp.click());
  inAbrir.addEventListener('change', () => { const l = Array.from(inAbrir.files || []); inAbrir.value = ''; abrirArquivos(l, false); });
  inComp.addEventListener('change', () => { const l = Array.from(inComp.files || []); inComp.value = ''; abrirArquivos(l, st.ia >= 0); });
  const temArquivos = e => !!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0);
  raiz.addEventListener('dragover', e => { if (!temArquivos(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; raiz.classList.add('gv-solta'); });
  raiz.addEventListener('dragleave', e => { if (!e.relatedTarget || !raiz.contains(e.relatedTarget)) raiz.classList.remove('gv-solta'); });
  raiz.addEventListener('drop', e => {
    if (!temArquivos(e)) return;
    e.preventDefault();
    raiz.classList.remove('gv-solta');
    abrirArquivos(Array.from(e.dataTransfer.files || []), e.shiftKey && st.ia >= 0);
  });

  /* ---- mouse ---- */
  let arrasto = null;
  cv.addEventListener('pointerdown', e => {
    try { raiz.focus({ preventScroll: true }); } catch (_) { raiz.focus(); }
    if (e.button > 2) return;
    arrasto = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: st.view.cx, cy: st.view.cy, moveu: false, botao: e.button };
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* sem captura */ }
    if (e.button !== 0) e.preventDefault();
  });
  cv.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });   /* sem o autoscroll do Windows */
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect();
    st.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (arrasto && arrasto.id === e.pointerId) {
      const dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y;
      if (!arrasto.moveu && Math.hypot(dx, dy) > 3) { arrasto.moveu = true; cv.classList.add('gv-arrasta'); }
      if (arrasto.moveu) {
        st.view.cx = arrasto.cx - dx / (st.view.scale * fx());
        st.view.cy = arrasto.cy + dy / st.view.scale;
        agenda();
      }
    }
    if (!hoverQ) hoverQ = requestAnimationFrame(atualizaHover);
  });
  function soltar(e, cancelou) {
    if (!arrasto || arrasto.id !== e.pointerId) return;
    const a = arrasto;
    arrasto = null;
    cv.classList.remove('gv-arrasta');
    try { cv.releasePointerCapture(e.pointerId); } catch (_) { /* ja solto */ }
    if (!cancelou && !a.moveu && a.botao === 0) { st.sel = st.hover ? Object.assign({}, st.hover) : null; rodape(); agenda(); }
  }
  cv.addEventListener('pointerup', e => soltar(e, false));
  cv.addEventListener('pointercancel', e => soltar(e, true));
  cv.addEventListener('pointerleave', () => { if (arrasto) return; st.mouse = null; if (st.hover) { st.hover = null; agenda(); } rodape(); });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    if (!conjunto(st.ia)) return;
    if (e.shiftKey) {
      /* Shift + roda: anda para os lados, sem ampliar (como a vista PCB) */
      const d = (e.deltaX || e.deltaY) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      st.view.cx += d / (st.view.scale * fx());
      agenda();
      return;
    }
    if (!e.deltaY) return;
    zoomEm(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.18 : 1 / 1.18);
    if (!hoverQ) hoverQ = requestAnimationFrame(atualizaHover);
  }, { passive: false });

  /* ---- teclado (so com o foco aqui dentro: a vista de baixo nao recebe a tecla) ---- */
  function trocaVista() { st.vista = st.vista === 'cima' ? 'baixo' : 'cima'; atualiza(); }
  function trocaModo() { st.modo = st.modo === 'camadas' ? 'realista' : 'camadas'; atualiza(); }
  raiz.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) {
      if (e.key === 'Escape') { t.blur(); raiz.focus(); e.stopPropagation(); }
      return;
    }
    const k = e.key;
    let feito = true;
    if (k === 'f' || k === 'F') { enquadrar(); agenda(); }
    else if (k === 'v' || k === 'V') trocaVista();
    else if (k === 'r' || k === 'R') trocaModo();
    else if ((k === 'c' || k === 'C') && st.ib >= 0) { st.comp = st.comp === 'A' ? 'B' : st.comp === 'B' ? 'AB' : 'A'; st.hover = null; atualiza(); }
    else if (k === '+' || k === '=') zoomEm(W / 2, H / 2, 1.18);
    else if (k === '-' || k === '_') zoomEm(W / 2, H / 2, 1 / 1.18);
    else if (k === 'Escape') {
      if (typeof opcoes.aoFechar === 'function') opcoes.aoFechar(ctrl);
      else { st.sel = null; rodape(); agenda(); }
    } else feito = false;
    if (feito) e.preventDefault();
    e.stopPropagation();
  });
  bEnq.addEventListener('click', () => { enquadrar(); agenda(); });
  bFechar.addEventListener('click', () => { if (typeof opcoes.aoFechar === 'function') opcoes.aoFechar(ctrl); });

  /* ---- tamanho ---- */
  let ro = null;
  const aoRedimensionar = () => { mede(); agenda(); };
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(aoRedimensionar); ro.observe(tela); }
  window.addEventListener('resize', aoRedimensionar);

  /* ---- API ---- */
  function carregar(conjuntos) {
    st.conjuntos = (conjuntos || []).map(c => prepara(c));
    st.ia = st.conjuntos.length ? 0 : -1;
    st.ib = st.conjuntos.length > 1 ? 1 : -1;
    st.comp = st.ib >= 0 ? 'AB' : 'A';
    st.destaque = null; st.hover = null; st.sel = null;
    st.enquadrar = true;
    atualiza();
    return ctrl;
  }
  function mostrar(i) {
    if (!conjunto(i)) return ctrl;
    if (st.ia < 0) st.enquadrar = true;
    st.ia = i;
    if (st.ib === i) { st.ib = -1; st.comp = 'A'; }
    if (st.comp === 'B' && st.ib < 0) st.comp = 'A';
    st.hover = null; st.sel = null; st.destaque = null;
    atualiza();
    return ctrl;
  }
  function comparar(i) {
    if (!conjunto(i) || i === st.ia) return ctrl;
    st.ib = i;
    st.comp = 'AB';
    st.hover = null; st.sel = null;
    atualiza();
    return ctrl;
  }
  function adicionar(conj, comoB, avisosExtra) {
    const p = prepara(conj, avisosExtra);
    if (!p.camadas.length) { avisar(semCamadas(p.titulo, p.ignorados, p.avisosExtra), 'warn'); return ctrl; }
    st.conjuntos.push(p);
    const i = st.conjuntos.length - 1;
    if (comoB && st.ia >= 0) return comparar(i);
    st.enquadrar = true;
    st.ia = -1;
    return mostrar(i);
  }
  function substituir(i, conj) {
    const velho = conjunto(i);
    if (!velho) return adicionar(conj, false);
    const novo = prepara(conj);
    for (const k of novo.camadas) {
      const v = velho.camadas.find(x => x.info.chave === k.info.chave && x.arquivo === k.arquivo) || velho.camadas.find(x => x.info.chave === k.info.chave);
      if (v) k.visivel = v.visivel;
    }
    st.conjuntos[i] = novo;
    if (st.destaque && velho.camadas.indexOf(st.destaque) >= 0) st.destaque = null;
    st.hover = null; st.sel = null;
    atualiza();
    return ctrl;
  }
  function destruir() {
    if (destruido) return;
    destruido = true;
    if (quadro) cancelAnimationFrame(quadro);
    if (hoverQ) cancelAnimationFrame(hoverQ);
    clearTimeout(faixaT);
    if (ro) ro.disconnect();
    window.removeEventListener('resize', aoRedimensionar);
    pool.clear();
    raiz.remove();
  }
  const ctrl = {
    elemento: raiz, botoesExtra, menuExtra,
    carregar, mostrar, comparar, adicionar, substituir, destruir,
    redesenhar() { mede(); agenda(); return ctrl; },
    enquadrar() { enquadrar(); agenda(); return ctrl; },
    avisar,
    get estado() {
      return { ia: st.ia, ib: st.ib, comp: st.comp, vista: st.vista, modo: st.modo, view: Object.assign({}, st.view),
        conjuntos: st.conjuntos.map(c => ({ titulo: c.titulo, ignorados: c.ignorados.slice(),
          camadas: c.camadas.map(k => ({ arquivo: k.arquivo, chave: k.info.chave, nome: k.info.nome, visivel: k.visivel, objetos: k.cam.prims.length, avisos: k.cam.avisos.length })) })) };
    },
  };
  mede();
  carregar(opcoes.conjuntos || []);
  try { raiz.focus({ preventScroll: true }); } catch (_) { /* foco opcional */ }
  return ctrl;
}

return {
  parse, parseExcellon, camadaDe, lerZip, contornoDaAbertura, montar, icone: iconeDe,
  lerConjunto, tipoDeArquivo, contornoDaPlaca, placaDoConjunto, objetoEm, caixaDe, avaliaExpr,
  /* para os testes e para quem desenha */
  formasDe, ehSequencial, pontosArco, areaComSinal, corPadrao, semCamadas,
};
});
