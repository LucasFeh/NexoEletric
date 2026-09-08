/* AltiumPCBMirror v2 - hub-symed.js — editor de símbolos (sub-aba Símbolos da Biblioteca).

   Três colunas com divisórias arrastáveis (o mkSplits da casca, como nas abas Laser e BOM):
   a lista do espelho do Altium à esquerda, o editor no meio e, à direita, a caixa de
   ferramentas em ícones e a ficha. O meio empilha o canvas e, embaixo, a Biblioteca de
   símbolos (Libs/symbols-lib.js) — corpos genéricos e de CI que se aplicam ao símbolo aberto
   com um clique, porque o que mais se quer aqui é TROCAR O DESENHO sem mexer na pinagem.

   Mouse igual ao da vista Esquema: o esquerdo seleciona (Shift acrescenta), arrasta os
   selecionados ou, em área vazia, desenha a caixa de seleção; direito e meio arrastam a
   tela; a roda dá zoom. A seleção é uma lista de {kind, idx} e vai para o undo junto com a
   geometria. Nada de confirm()/prompt(): as perguntas são modais no tema do hub.

   Contrato com a casca (hub.html): render(opts) pode ser chamado toda vez que a sub-aba
   aparece — o DOM nasce uma vez e só é atualizado; dirty() diz se há edição não salva;
   opts.splits é o mkSplits da casca (sem ele o painel abre igual, só sem arrasto).
   As funções puras (snap, hitTest, moveItem, rotateAll, mirrorAll, serializeSymbol,
   applyLibSymbol, nextPinNum...) ficam em `pure` para tests/test-symed.js rodar em Node —
   por isso nada de DOM fora de função.

   A ficha (aside) segue o painel Properties do Altium: X e Y na mesma linha, a parte, o
   tamanho na unidade da interface — mm por padrão, ou mil — e, no pino, número/nome com o
   olho de visibilidade (hideNum/hideName, opcionais no schlib-v2). K vira linha em pino e
   pino em linha; um tile da biblioteca arrastado para o canvas entra inserido (ou aplicado,
   se a parte está vazia). Os gráficos podem levar `color` (traço) e `fill` (área) — opcionais
   do schlib-v2, "#rrggbb" — e o canvas do editor os desenha ele mesmo; Preencher liga o
   `solid` (círculo completo vira elipse sólida, polilinha vira polígono).

   Coordenadas: mil, Y para cima, pino = ponta do CORPO em (x,y) e ponta quente em
   (x,y) + len·dir(orient) — o mesmo vocabulário schlib-v2 que hub-draw.js desenha. O mm é
   só interface: 1 mm = 39.37007874 mil, e tudo grava com 3 casas de mil. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hub-draw.js'));
  else root.HubSymEd = factory(root.HubDraw);
})(typeof self !== 'undefined' ? self : this, function (HubDraw) {
"use strict";

/* ═══════════════════════ geometria pura (testável em Node) ═══════════════════════ */

const OD = { 0:[1,0], 90:[0,1], 180:[-1,0], 270:[0,-1] };
const norm360 = a => ((a % 360) + 360) % 360;
const clone = o => JSON.parse(JSON.stringify(o));
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : (d || 0); };
/* arredonda a 0.001 mil: o suficiente para o _Frac do Altium e sem lixo de ponto flutuante */
const r3 = v => Math.round(v * 1000) / 1000;
/* cor de traço/área do schlib-v2: só "#rrggbb" minúsculo — é o que o servidor aceita */
const corValida = c => typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c);
/* lado do quadradinho "::" da ponta quente (mil) — metade do que era; o traço do pino não muda */
const PIN_MARK = 16;

/* ── unidade da interface: mm (padrão) ou mil ──
   Por dentro TUDO continua em mil (schlib-v2, espelho, SchLib): o mm é só o que o usuário
   vê e digita. 1 mm = 39.37007874 mil; o que entra pelo mm vira mil com 3 casas, e 3 casas
   de mil (0.0000254 mm) guardam qualquer mm de 3 casas sem perda — é o que o teste prova. */
const MM = 39.37007874;
const mm2mil = mm => r3(num(mm) * MM);
const mil2mm = mil => num(mil) * 0.0254;
/* mm com 2 casas, 3 quando a terceira não é zero; mil com até 3 casas, sem zeros à direita */
function fmtUnit(mil, unit) {
  if (unit === 'mm') { const v = Math.round(mil2mm(mil) * 1000) / 1000; return Math.round(v * 100) / 100 === v ? v.toFixed(2) : v.toFixed(3); }
  return String(r3(num(mil)));
}
const toMil = (v, unit) => (unit === 'mm' ? mm2mil(v) : r3(num(v)));
/* os passos de snap de cada unidade (na unidade) e o passo padrão (em mil) */
const UNIT_SNAPS = { mm: [0.1, 0.5, 1, 2.5], mil: [10, 25, 50, 100] };
const snapMil = (s, unit) => (unit === 'mm' ? s * MM : s);
const UNIT_DEFAULT = { mm: 1 * MM, mil: 100 };

/* o passo pode ser fracionário (1 mm = 39.37007874 mil): o resultado sai com 3 casas */
function snap(v, step) { const s = step > 0 ? step : 1; return r3(Math.round(v / s) * s); }
function pinHot(p) { const d = OD[norm360(p.orient)] || [1, 0]; return { x: p.x + d[0]*p.len, y: p.y + d[1]*p.len }; }
/* em mil o pino prefere múltiplo de 10 (é o inteiro do registro do Altium): o menor múltiplo
   de 10 que ainda é múltiplo do passo escolhido (25 → 50, 5 → 10) — mandar tudo para 100
   fazia o pino ignorar a escolha do usuário por 75 mil; em mm vale o snap escolhido — o
   gravador já grava a fração do pino */
const mdc = (a, b) => (b ? mdc(b, a % b) : a);
function pinSnapOf(step, unit) {
  if (unit === 'mm') return step > 0 ? step : UNIT_DEFAULT.mm;
  if (!(step > 0) || step !== Math.round(step)) return 100;
  return step % 10 ? step * 10 / mdc(step, 10) : step;
}
/* comprimento com que um pino novo nasce: 100 mil (2.54 mm) em mil; em mm, o múltiplo do snap
   de pino mais perto de 2.54 mm (1 mm → 3 mm; 0.5 e 2.5 → 2.5 mm) — com 100 mil fixos a ponta
   quente já nascia fora do snap e o aviso amarelo acendia no fluxo normal, não no de erro */
function pinLenDefault(step, unit) {
  if (unit !== 'mm') return 100;
  const s = pinSnapOf(step, unit);
  return r3(Math.max(1, Math.round(100 / s)) * s);
}
/* ponta quente fora do snap atual: é onde o fio tem de encostar — daí o aviso amarelo.
   Tolerância de 2 milésimos de mil: as coordenadas vivem com 3 casas */
function pinsOffGrid(pins, step) {
  const s = step > 0 ? step : 100;
  const off = v => Math.abs(v - Math.round(v / s) * s) > 0.002;
  return (pins || []).filter(p => { const h = pinHot(p); return off(h.x) || off(h.y); });
}

function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx*dx + dy*dy;
  let t = l2 ? ((px - x1)*dx + (py - y1)*dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t*dx), py - (y1 + t*dy));
}
function pointInPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function angleIn(a, sa, ea) {
  a = norm360(a); sa = norm360(sa); let sweep = norm360(ea - sa);
  if (sweep === 0) sweep = 360;            /* sa == ea = círculo inteiro, como o canvas desenha */
  return norm360(a - sa) <= sweep + 1e-9;
}
/* largura estimada do rótulo: Segoe/Inter têm ~0.55 em por caractere; serve para clicar */
function labelBox(g) {
  const h = (g.size || 8) * 10, w = Math.max(h, String(g.text || '').length * h * 0.55);
  const vert = norm360(g.rot || 0) % 180 === 90;
  return { x1: g.x - (vert ? h : w)/2, y1: g.y - (vert ? w : h)/2, x2: g.x + (vert ? h : w)/2, y2: g.y + (vert ? w : h)/2 };
}
function vertexAt(pts, x, y, tol) {
  for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i][0] - x, pts[i][1] - y) <= tol) return i;
  return -1;
}
function hitGraphic(g, x, y, tol) {
  const edges = (pts, closed) => {
    for (let i = 0; i + 1 < pts.length; i++) if (segDist(x, y, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]) <= tol) return true;
    if (closed && pts.length > 2) { const a = pts[pts.length-1], b = pts[0]; if (segDist(x, y, a[0], a[1], b[0], b[1]) <= tol) return true; }
    return false;
  };
  switch (g.g) {
    case 'line': return segDist(x, y, g.x1, g.y1, g.x2, g.y2) <= tol;
    case 'rect': {
      const x1 = Math.min(g.x1, g.x2), x2 = Math.max(g.x1, g.x2), y1 = Math.min(g.y1, g.y2), y2 = Math.max(g.y1, g.y2);
      if (g.solid && x >= x1 && x <= x2 && y >= y1 && y <= y2) return true;
      return edges([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], true);
    }
    case 'arc': {
      const d = Math.hypot(x - g.cx, y - g.cy);
      if (Math.abs(d - g.r) > tol) return false;
      return angleIn(Math.atan2(y - g.cy, x - g.cx) * 180 / Math.PI, g.sa || 0, g.ea == null ? 360 : g.ea);
    }
    case 'ellipse': {
      if (!g.rx || !g.ry) return false;
      const d = Math.hypot((x - g.cx) / g.rx, (y - g.cy) / g.ry);
      if (g.solid && d <= 1) return true;
      return Math.abs(d - 1) * Math.min(g.rx, g.ry) <= tol;
    }
    case 'poly': return (g.solid && pointInPoly(g.pts || [], x, y)) || edges(g.pts || [], true);
    case 'polyline': return edges(g.pts || [], false);
    case 'label': { const b = labelBox(g); return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2; }
  }
  return false;
}
/* o que está debaixo do ponto: pinos primeiro (ficam por cima), depois gráficos do último
   desenhado para o primeiro. Vértice de polilinha/polígono vem junto para arrastar sozinho. */
function hitTest(part, x, y, tol) {
  const T = tol == null ? 10 : tol;
  const pins = part.pins || [], gs = part.graphics || [];
  for (let i = pins.length - 1; i >= 0; i--) {
    const p = pins[i], h = pinHot(p);
    if (segDist(x, y, p.x, p.y, h.x, h.y) <= T) return { kind: 'pin', idx: i };
  }
  for (let i = gs.length - 1; i >= 0; i--) {
    const g = gs[i];
    if (g.g === 'poly' || g.g === 'polyline') {
      const v = vertexAt(g.pts || [], x, y, T);
      if (v >= 0) return { kind: 'g', idx: i, vertex: v };
    }
    if (hitGraphic(g, x, y, T)) return { kind: 'g', idx: i };
  }
  return null;
}

/* todo deslocamento passa por aqui — e sai com 3 casas: um passo de 1 mm é 39.37007874 mil,
   e somar isso sem arredondar deixaria lixo de ponto flutuante no estado. Com `step`, a
   coordenada que JÁ estava na grade desse passo sai alinhada à grade (snap do RESULTADO, não
   do delta): somar r3 em r3 perdia 0.00008 mil por passo de 1 mm e, na 26ª seta, a ponta
   quente saía do snap sem o usuário ter feito nada. Quem estava fora da grade anda r3(dx). */
function alinhado(v, d, s) {
  if (!(s > 0)) return r3(v + d);
  return Math.abs(v - snap(v, s)) <= 0.002 ? snap(v + d, s) : r3(v + d);
}
function moveItem(item, dx, dy, step) {
  const o = clone(item), X = v => alinhado(v, dx, step), Y = v => alinhado(v, dy, step);
  if (o.g == null) { o.x = X(o.x); o.y = Y(o.y); return o; }          /* pino */
  switch (o.g) {
    case 'line': case 'rect': o.x1 = X(o.x1); o.y1 = Y(o.y1); o.x2 = X(o.x2); o.y2 = Y(o.y2); break;
    case 'arc': case 'ellipse': o.cx = X(o.cx); o.cy = Y(o.cy); break;
    case 'poly': case 'polyline': o.pts = (o.pts || []).map(p => [X(p[0]), Y(p[1])]); break;
    case 'label': o.x = X(o.x); o.y = Y(o.y); break;
  }
  return o;
}
function moveVertex(item, vi, x, y) {
  const o = clone(item);
  if (o.pts && o.pts[vi]) o.pts[vi] = [x, y];
  return o;
}
function normRect(g) {
  const x1 = Math.min(g.x1, g.x2), x2 = Math.max(g.x1, g.x2), y1 = Math.min(g.y1, g.y2), y2 = Math.max(g.y1, g.y2);
  g.x1 = x1; g.y1 = y1; g.x2 = x2; g.y2 = y2; return g;
}
/* gira a parte inteira 90° anti-horário em torno da origem: (x,y) → (-y,x). Ângulos de
   pino, rótulo e arco andam junto; retângulo e elipse não têm ângulo, então trocam eixos. */
function rotateAll(part) {
  const R = (x, y) => [0 - y, x];            /* 0 - y e nao -y: -0 quebra a comparacao dos testes */
  const o = clone(part);
  o.pins = (o.pins || []).map(p => { const [x, y] = R(p.x, p.y); return Object.assign(p, { x, y, orient: norm360((p.orient || 0) + 90) }); });
  o.graphics = (o.graphics || []).map(g => {
    switch (g.g) {
      case 'line': { const a = R(g.x1, g.y1), b = R(g.x2, g.y2); g.x1 = a[0]; g.y1 = a[1]; g.x2 = b[0]; g.y2 = b[1]; break; }
      case 'rect': { const a = R(g.x1, g.y1), b = R(g.x2, g.y2); g.x1 = a[0]; g.y1 = a[1]; g.x2 = b[0]; g.y2 = b[1]; normRect(g); break; }
      case 'arc': { const c = R(g.cx, g.cy); g.cx = c[0]; g.cy = c[1];
        const sa = g.sa || 0, ea = g.ea == null ? 360 : g.ea;
        if (norm360(ea - sa) === 0) break;                     /* círculo inteiro: 0–360 fica */
        g.sa = norm360(sa + 90); g.ea = norm360(ea + 90) || 360; break; }
      case 'ellipse': { const c = R(g.cx, g.cy); g.cx = c[0]; g.cy = c[1]; const t = g.rx; g.rx = g.ry; g.ry = t; break; }
      case 'poly': case 'polyline': g.pts = (g.pts || []).map(p => R(p[0], p[1])); break;
      case 'label': { const c = R(g.x, g.y); g.x = c[0]; g.y = c[1]; g.rot = norm360((g.rot || 0) + 90); break; }
    }
    return g;
  });
  return o;
}
/* espelha em X (mesma regra do AI-GUIDE: ângulo vira 180-a; arco troca início e fim) */
function mirrorAll(part) {
  const o = clone(part);
  const N = v => 0 - v;                       /* idem: nada de -0 */
  o.pins = (o.pins || []).map(p => Object.assign(p, { x: N(p.x), orient: norm360(180 - (p.orient || 0)) }));
  o.graphics = (o.graphics || []).map(g => {
    switch (g.g) {
      case 'line': g.x1 = N(g.x1); g.x2 = N(g.x2); break;
      case 'rect': g.x1 = N(g.x1); g.x2 = N(g.x2); normRect(g); break;
      case 'arc': { g.cx = N(g.cx); const sa = g.sa || 0, ea = g.ea == null ? 360 : g.ea;
        if (norm360(ea - sa) === 0) break;                     /* círculo inteiro fica como está */
        g.sa = norm360(180 - ea); g.ea = norm360(180 - sa); break; }
      case 'ellipse': g.cx = N(g.cx); break;
      case 'poly': case 'polyline': g.pts = (g.pts || []).map(p => [N(p[0]), p[1]]); break;
      case 'label': g.x = N(g.x); g.rot = norm360(180 - (g.rot || 0)); break;
    }
    return g;
  });
  return o;
}
const bbox = part => HubDraw.symBBox(part);

const PIN_TYPES = ['Input', 'IO', 'Output', 'OpenCollector', 'Passive', 'HiZ', 'OpenEmitter', 'Power'];
const WIDTHS = [4, 10, 20, 30];
/* largura só nos quatro valores que o Altium tem (Smallest/Small/Medium/Large) */
function normW(w) { const v = num(w, 10); return WIDTHS.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a, 10); }

/* pino com 3 casas como qualquer coordenada: o gravador do Altium grava a fração (PinFrac).
   hideNum/hideName são opcionais do schlib-v2 — só saem quando escondidos (ausente = visível),
   para o espelho de 401 símbolos mudar só onde há pino escondido */
function cleanPin(p) {
  const o = { num: String(p.num == null ? '' : p.num), name: String(p.name == null ? '' : p.name),
              x: r3(num(p.x)), y: r3(num(p.y)), len: r3(Math.abs(num(p.len, 100))) || 100,
              orient: norm360(Math.round(num(p.orient) / 90) * 90),
              type: PIN_TYPES.indexOf(p.type) >= 0 ? p.type : 'Passive' };
  if (p.hideNum) o.hideNum = true;
  if (p.hideName) o.hideName = true;
  return o;
}
/* arco com sa == ea: o canvas não traça nada e o Altium receberia StartAngle=EndAngle —
   é círculo inteiro, e o leitor grava círculo como 0/360; aqui é a mesma regra */
function normArc(g) {
  if (norm360(num(g.ea, 360) - num(g.sa)) === 0) { g.sa = 0; g.ea = 360; }
  return g;
}
/* rect/ellipse/poly: o leitor não exporta `w` (o ExportLibs nunca exportou), e o PATCH só
   preserva o LineWidth original quando `w` NÃO vem no gráfico. Inventar w=10 aqui engrossava
   a borda de todo retângulo só de abrir e salvar — então w só sai quando existe de verdade. */
const wOpc = g => (g.w == null ? {} : { w: normW(g.w) });
/* color (traço) e fill (área) só saem válidos: "#RRGGBB" vira minúsculo, "red"/"#fff" caem —
   ausente = a cor padrão da casa (o schlib_patch herda a paleta do componente) */
const corOpc = (g, k) => { const c = typeof g[k] === 'string' ? g[k].trim().toLowerCase() : ''; return corValida(c) ? { [k]: c } : {}; };
const cores = (g, area) => Object.assign(corOpc(g, 'color'), area ? corOpc(g, 'fill') : {});
function cleanGraphic(g) {
  switch (g.g) {
    case 'line': return Object.assign({ g: 'line', x1: r3(num(g.x1)), y1: r3(num(g.y1)), x2: r3(num(g.x2)), y2: r3(num(g.y2)), w: normW(g.w) }, cores(g));
    case 'rect': return normRect(Object.assign({ g: 'rect', x1: r3(num(g.x1)), y1: r3(num(g.y1)), x2: r3(num(g.x2)), y2: r3(num(g.y2)) }, wOpc(g), { solid: !!g.solid }, cores(g, true)));
    case 'arc': return normArc(Object.assign({ g: 'arc', cx: r3(num(g.cx)), cy: r3(num(g.cy)), r: r3(Math.abs(num(g.r))), sa: r3(num(g.sa)), ea: r3(g.ea == null ? 360 : num(g.ea)), w: normW(g.w) }, cores(g)));
    case 'ellipse': return Object.assign({ g: 'ellipse', cx: r3(num(g.cx)), cy: r3(num(g.cy)), rx: r3(Math.abs(num(g.rx))), ry: r3(Math.abs(num(g.ry))) }, wOpc(g), { solid: !!g.solid }, cores(g, true));
    case 'poly': return Object.assign({ g: 'poly', pts: (g.pts || []).map(p => [r3(num(p[0])), r3(num(p[1]))]) }, wOpc(g), { solid: !!g.solid }, cores(g, true));
    case 'polyline': return Object.assign({ g: 'polyline', pts: (g.pts || []).map(p => [r3(num(p[0])), r3(num(p[1]))]), w: normW(g.w) }, cores(g));
    case 'label': return Object.assign({ g: 'label', x: r3(num(g.x)), y: r3(num(g.y)), text: String(g.text == null ? '' : g.text),
                           rot: norm360(Math.round(num(g.rot) / 90) * 90), size: Math.max(1, Math.round(num(g.size, 10))) }, cores(g));
  }
  return null;
}
/* ── Preencher ──
   Liga/desliga o `solid` de retângulo, elipse e polígono. Quem não é fechado mas pode virar:
   círculo completo (sa 0 / ea 360) vira elipse sólida (rx = ry = r) e polilinha vira polígono
   fechado sólido; desmarcar numa elipse/polígono só apaga o solid (o Altium tem polígono
   vazado). Linha, arco parcial, texto e pino não têm o que preencher — `fillable` diz por quê. */
function fillable(g) {
  if (!g || g.g == null) return { ok: false, why: 'pino não tem preenchimento' };
  switch (g.g) {
    case 'rect': case 'ellipse': case 'poly': case 'polyline': return { ok: true };
    case 'arc': return norm360(num(g.ea, 360) - num(g.sa)) === 0 ? { ok: true }
      : { ok: false, why: 'arco parcial não fecha área — só o círculo completo (0–360°) vira elipse preenchida' };
    case 'line': return { ok: false, why: 'linha não fecha área — polilinha ou polígono preenchem' };
    case 'label': return { ok: false, why: 'texto não tem preenchimento' };
  }
  return { ok: false, why: 'sem preenchimento' };
}
function setFill(g, on) {
  if (!fillable(g).ok) return null;
  const o = clone(g);
  const leva = n => { if (o.w != null) n.w = o.w; if (o.color) n.color = o.color; if (o.fill) n.fill = o.fill; return n; };
  switch (o.g) {
    case 'rect': case 'ellipse': case 'poly': o.solid = !!on; return o;
    case 'arc': return on ? leva({ g: 'ellipse', cx: o.cx, cy: o.cy, rx: Math.abs(o.r), ry: Math.abs(o.r), solid: true }) : null;
    case 'polyline': return on ? leva({ g: 'poly', pts: clone(o.pts || []), solid: true }) : null;
  }
  return null;
}
/* o que vai para o servidor: só o vocabulário schlib-v2, números limpos, nada do estado do editor */
function serializeSymbol(sym) {
  const parts = (sym.parts || []).map((p, i) => ({
    part: Math.round(num(p.part, i + 1)),
    pins: (p.pins || []).map(cleanPin),
    graphics: (p.graphics || []).map(cleanGraphic).filter(Boolean),
  }));
  const out = { name: String(sym.name || ''), description: String(sym.description || ''),
                partcount: parts.length || 1, parts,
                footprints: clone(sym.footprints || []) };
  return out;
}

/* troca o desenho da parte pelo da biblioteca. Contagem de pinos igual = a pinagem
   (número, nome, tipo) é do símbolo do usuário, na ordem; o que muda é a geometria. */
function applyLibSymbol(part, libSym) {
  const pins = clone(libSym.pins || []), graphics = clone(libSym.graphics || []);
  const orig = part.pins || [];
  let note;
  if (pins.length && pins.length === orig.length) {
    pins.forEach((p, i) => {
      p.num = orig[i].num; p.name = orig[i].name; if (orig[i].type) p.type = orig[i].type;
      /* a visibilidade de número/nome é pinagem, não desenho: fica a do usuário */
      delete p.hideNum; delete p.hideName;
      if (orig[i].hideNum) p.hideNum = true;
      if (orig[i].hideName) p.hideName = true;
    });
    note = 'desenho trocado por "' + (libSym.name || '?') + '" — ' + pins.length + ' pino' + (pins.length > 1 ? 's' : '')
         + ' mantiveram número, nome e tipo.';
  } else {
    note = 'desenho E pinagem vieram de "' + (libSym.name || '?') + '": o símbolo tinha ' + orig.length
         + ' pino' + (orig.length === 1 ? '' : 's') + ' e a biblioteca traz ' + pins.length + '. Confira os números.';
  }
  return { part: Object.assign({}, part, { pins, graphics }), note };
}
/* próximo número livre: o maior numérico + 1 (pinos com letra, tipo "A1", não contam) */
function nextPinNum(pins) {
  let m = 0;
  for (const p of (pins || [])) { const n = parseInt(p.num, 10); if (String(n) === String(p.num).trim() && n > m) m = n; }
  return String(m + 1);
}

/* ── seleção múltipla: caixa de cada item e quem cabe numa caixa de seleção ── */

function ptsBox(pts) {
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  for (const p of pts) { if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0]; if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1]; }
  return x1 > x2 ? { x1: 0, y1: 0, x2: 0, y2: 0 } : { x1, y1, x2, y2 };
}
/* caixa de cada item em mil — é o que a caixa de seleção compara e o que ganha as bordinhas */
function itemBBox(it) {
  if (it.g == null) { const h = pinHot(it); return ptsBox([[it.x, it.y], [h.x, h.y]]); }
  switch (it.g) {
    case 'line': case 'rect': return ptsBox([[it.x1, it.y1], [it.x2, it.y2]]);
    case 'arc': {
      /* só o pedaço desenhado: as pontas e os eixos que o arco cruza */
      const sa = it.sa || 0, ea = it.ea == null ? 360 : it.ea, r = Math.abs(it.r || 0);
      const P = a => [it.cx + r * Math.cos(a * Math.PI / 180), it.cy + r * Math.sin(a * Math.PI / 180)];
      const pts = [P(sa), P(ea)];
      for (const a of [0, 90, 180, 270]) if (angleIn(a, sa, ea)) pts.push(P(a));
      return ptsBox(pts);
    }
    case 'ellipse': return ptsBox([[it.cx - it.rx, it.cy - it.ry], [it.cx + it.rx, it.cy + it.ry]]);
    case 'poly': case 'polyline': return ptsBox(it.pts || []);
    case 'label': return labelBox(it);
  }
  return ptsBox([[it.x || 0, it.y || 0]]);
}
const bbInside = (a, r) => a.x1 >= r.x1 && a.x2 <= r.x2 && a.y1 >= r.y1 && a.y2 <= r.y2;
const bbTouch  = (a, r) => a.x1 <= r.x2 && a.x2 >= r.x1 && a.y1 <= r.y2 && a.y2 >= r.y1;
/* quem a caixa pega: `inteiro` = só quem cabe todo (esquerda→direita), senão quem encosta
   (direita→esquerda) — a mesma regra do Altium e da vista Esquema. rect pode vir invertido. */
function itemsInBox(part, rect, inteiro) {
  const n = { x1: Math.min(rect.x1, rect.x2), y1: Math.min(rect.y1, rect.y2), x2: Math.max(rect.x1, rect.x2), y2: Math.max(rect.y1, rect.y2) };
  const out = [];
  (part.pins || []).forEach((p, i) => { const b = itemBBox(p); if (inteiro ? bbInside(b, n) : bbTouch(b, n)) out.push({ kind: 'pin', idx: i }); });
  (part.graphics || []).forEach((g, i) => { const b = itemBBox(g); if (inteiro ? bbInside(b, n) : bbTouch(b, n)) out.push({ kind: 'g', idx: i }); });
  return out;
}
const selHasIn = (sel, kind, idx) => (sel || []).some(s => s.kind === kind && s.idx === idx);
/* move os itens de `sel`; pinos podem levar um delta próprio (o passo de pino é outro).
   `step`/`pstep` são os passos das grades (gráficos / pinos) para o resultado sair alinhado */
function moveItems(part, sel, dx, dy, pdx, pdy, step, pstep) {
  const px = pdx == null ? dx : pdx, py = pdy == null ? dy : pdy, ps = pstep == null ? step : pstep;
  return {
    pins: (part.pins || []).map((p, i) => selHasIn(sel, 'pin', i) ? moveItem(p, px, py, ps) : clone(p)),
    graphics: (part.graphics || []).map((g, i) => selHasIn(sel, 'g', i) ? moveItem(g, dx, dy, step) : clone(g)),
  };
}
function deleteItems(part, sel) {
  return {
    pins: (part.pins || []).filter((p, i) => !selHasIn(sel, 'pin', i)).map(clone),
    graphics: (part.graphics || []).filter((g, i) => !selHasIn(sel, 'g', i)).map(clone),
  };
}
/* cópias entram no fim (os índices de quem já estava não mudam) e viram a nova seleção;
   pino copiado ganha o próximo número livre — dois pinos "1" não servem para nada */
function duplicateItems(part, sel, dx, dy, pdx, pdy, step, pstep) {
  const px = pdx == null ? dx : pdx, py = pdy == null ? dy : pdy, ps = pstep == null ? step : pstep;
  const pins = (part.pins || []).map(clone), graphics = (part.graphics || []).map(clone), selection = [];
  (part.pins || []).forEach((p, i) => { if (!selHasIn(sel, 'pin', i)) return; const c = moveItem(p, px, py, ps); c.num = nextPinNum(pins); selection.push({ kind: 'pin', idx: pins.length }); pins.push(c); });
  (part.graphics || []).forEach((g, i) => { if (!selHasIn(sel, 'g', i)) return; selection.push({ kind: 'g', idx: graphics.length }); graphics.push(moveItem(g, dx, dy, step)); });
  return { part: { pins, graphics }, selection };
}

/* ── linha ↔ pino ── */

/* linha (ou polilinha de 2 pontos) → pino. A ponta do CORPO é o extremo mais perto do centro
   do que sobra do desenho (sem a própria linha; sem mais nada, a origem); a ponta quente é o
   outro. O Altium só tem 0/90/180/270: linha fora do eixo vira pino axial pelo eixo dominante,
   com `len` = a componente nesse eixo — e `aviso` diz isso. */
function lineToPin(part, idx) {
  const gs = part.graphics || [], g = gs[idx]; if (!g) return null;
  let a, b;
  if (g.g === 'line') { a = [g.x1, g.y1]; b = [g.x2, g.y2]; }
  else if (g.g === 'polyline' && (g.pts || []).length === 2) { a = g.pts[0].slice(); b = g.pts[1].slice(); }
  else return null;
  const resto = gs.filter((x, i) => i !== idx);
  const bb = resto.length ? HubDraw.symBBox({ graphics: resto }) : { x1: 0, y1: 0, x2: 0, y2: 0 };
  const c = [(bb.x1 + bb.x2) / 2, (bb.y1 + bb.y2) / 2];
  const da = Math.hypot(a[0] - c[0], a[1] - c[1]), db = Math.hypot(b[0] - c[0], b[1] - c[1]);
  const corpo = da <= db ? a : b, quente = da <= db ? b : a;
  const dx = quente[0] - corpo[0], dy = quente[1] - corpo[1];
  const horiz = Math.abs(dx) >= Math.abs(dy);
  const len = r3(Math.abs(horiz ? dx : dy));
  if (!len) return null;
  const orient = horiz ? (dx >= 0 ? 0 : 180) : (dy >= 0 ? 90 : 270);
  const pin = { num: nextPinNum(part.pins), name: '', x: r3(corpo[0]), y: r3(corpo[1]), len, orient, type: 'Passive' };
  const pins = (part.pins || []).map(clone).concat([pin]);
  return { part: { pins, graphics: resto.map(clone) }, selection: [{ kind: 'pin', idx: pins.length - 1 }],
           aviso: (dx === 0 || dy === 0) ? '' : 'a linha não era axial: o pino ficou no eixo ' + (horiz ? 'X' : 'Y') + ', com ' + len + ' mil' };
}
/* pino → linha do corpo à ponta quente, w 10 (a largura das linhas do editor) */
function pinToLine(part, idx) {
  const p = (part.pins || [])[idx]; if (!p) return null;
  const h = pinHot(p);
  const graphics = (part.graphics || []).map(clone).concat([{ g: 'line', x1: r3(p.x), y1: r3(p.y), x2: r3(h.x), y2: r3(h.y), w: 10 }]);
  return { part: { pins: (part.pins || []).filter((x, i) => i !== idx).map(clone), graphics },
           selection: [{ kind: 'g', idx: graphics.length - 1 }] };
}
/* o que "Virar pino"/"Virar linha" fazem com o item: 'pino', 'linha' ou nada */
function viravel(it) {
  if (!it) return null;
  if (it.g == null) return 'linha';
  if (it.g === 'line' || (it.g === 'polyline' && (it.pts || []).length === 2)) return 'pino';
  return null;
}

/* símbolo da biblioteca solto no canvas de uma parte que já tem coisa: gráficos e pinos entram
   deslocados para (x,y) (a origem do símbolo cai no ponto), tudo vira a seleção, e pino cujo
   número já existe na parte ganha o próximo livre, em sequência — dois pinos "1" não servem */
function insertLibSymbol(part, libSym, x, y) {
  const pins = (part.pins || []).map(clone), graphics = (part.graphics || []).map(clone), selection = [], renumerados = [];
  const usados = new Set(pins.map(p => String(p.num).trim()));
  for (const src of (libSym.pins || [])) {
    const p = moveItem(src, x, y);
    if (usados.has(String(p.num).trim())) { const n = nextPinNum(pins); renumerados.push([String(p.num), n]); p.num = n; }
    usados.add(String(p.num).trim());
    selection.push({ kind: 'pin', idx: pins.length }); pins.push(p);
  }
  for (const src of (libSym.graphics || [])) { selection.push({ kind: 'g', idx: graphics.length }); graphics.push(moveItem(src, x, y)); }
  return { part: { pins, graphics }, selection, renumerados, novos: pins.slice(pins.length - (libSym.pins || []).length).map(p => p.num) };
}

const pure = { snap, pinHot, pinSnapOf, pinsOffGrid, segDist, pointInPoly, angleIn, labelBox, hitTest, hitGraphic,
               moveItem, moveVertex, rotateAll, mirrorAll, bbox, serializeSymbol, applyLibSymbol, nextPinNum,
               cleanPin, cleanGraphic, normW, normArc, PIN_TYPES, WIDTHS,
               pinLenDefault, alinhado, corValida, fillable, setFill, PIN_MARK,
               itemBBox, itemsInBox, moveItems, deleteItems, duplicateItems,
               MM, mm2mil, mil2mm, fmtUnit, toMil, UNIT_SNAPS, UNIT_DEFAULT, snapMil,
               lineToPin, pinToLine, viravel, insertLibSymbol };

/* ═══════════════════════ estado do painel (fora do DOM) ═══════════════════════ */

const UNIT_KEY = 'altiumhub.symed.unidade';
const SEP = String.fromCharCode(1);   /* separador das chaves de "o que mudou" — nunca aparece num nome */
/* ícones: traços simples em SVG inline (16×16, currentColor) — sem emoji nem fonte de ícone.
   'M…' = path; c:cx,cy,r = círculo; e:cx,cy,rx,ry = elipse; r:x,y,w,h = retângulo; '|' separa */
const ICONS = {
  select: 'M3 2 L3 12.5 L6.2 9.8 L8.4 14 L10.4 13 L8.2 8.8 L12.2 8.4 Z',
  line: 'M3 13 L13 3',
  rect: 'r:2.5,3.5,11,9',
  polyline: 'M2 12 L6 4 L10 10 L14 3',
  poly: 'M8 2 L14 6.5 L11.7 13.5 L4.3 13.5 L2 6.5 Z',
  arc: 'M3 13 A10 10 0 0 1 13 3',
  ellipse: 'e:8,8,6.5,4.5',
  label: 'M3 3.5 H13 M8 3.5 V13',
  pin: 'M2 8 H10|c:12,8,2',
  delete: 'M3 4.5 H13 M6.5 4.5 V3 H9.5 V4.5 M4.5 4.5 L5.2 13.5 H10.8 L11.5 4.5 M7 7 V11 M9 7 V11',
  undo: 'M3 7 H10 A3.5 3.5 0 0 1 10 14 H7 M6 4 L3 7 L6 10',
  redo: 'M13 7 H6 A3.5 3.5 0 0 0 6 14 H9 M10 4 L13 7 L10 10',
  rotate: 'M13 8 A5 5 0 1 1 10.5 3.7 M10.5 1.2 V3.7 H13',
  mirror: 'M8 2 V14 M6 5 L2 8 L6 11 M10 5 L14 8 L10 11',
  fit: 'M2 6 V2 H6 M10 2 H14 V6 M14 10 V14 H10 M6 14 H2 V10',
  grid: 'M5.5 2 V14 M10.5 2 V14 M2 5.5 H14 M2 10.5 H14',
  eye: 'M1.5 8 C3.5 4.6 5.8 3 8 3 C10.2 3 12.5 4.6 14.5 8 C12.5 11.4 10.2 13 8 13 C5.8 13 3.5 11.4 1.5 8 Z|c:8,8,2.2',
  eyeOff: 'M1.5 8 C3.5 4.6 5.8 3 8 3 C10.2 3 12.5 4.6 14.5 8 C12.5 11.4 10.2 13 8 13 C5.8 13 3.5 11.4 1.5 8 Z|c:8,8,2.2|M2.5 13.5 L13.5 2.5',
  flip: 'M2 11 H9|c:11.5,11,2.2|M4 5.5 A4 4 0 0 1 12 5.5 M10 3.5 L12 5.5 L10 7.5',   /* pino com seta: linha ↔ pino */
  duplicate: 'r:2,5.5,8.5,8.5|M6 5.5 V2 H14 V10 H10.5',
};
/* o tipo do item, como a ficha o chama */
const TIPO = { line: 'linha', rect: 'retângulo', arc: 'arco', ellipse: 'elipse', poly: 'polígono', polyline: 'polilinha', label: 'texto' };
const tipoDe = it => (it.g == null ? 'pino' : (TIPO[it.g] || it.g));
const TOOLS = [
  ['select', 'Selecionar (V, Esc) — arrastar move; em área vazia desenha a caixa de seleção'],
  ['line', 'Linha (L)'],
  ['rect', 'Retângulo (R)'],
  ['polyline', 'Polilinha (P) — duplo clique, botão direito ou Enter fecha'],
  ['poly', 'Polígono (G) — duplo clique, botão direito ou Enter fecha'],
  ['arc', 'Arco / círculo (A): centro, depois raio; sa/ea na ficha'],
  ['ellipse', 'Elipse (E): centro, depois canto'],
  ['label', 'Texto (T)'],
  ['pin', 'Pino (N) — R gira durante a colocação'],
  ['delete', 'Excluir o que clicar (Delete apaga a seleção)'],
];
/* selection: lista de {kind:'pin'|'g', idx} — vai inteira para o undo, então nada de Set */
const ST = {
  sel: null, part: 1, tool: 'select', selection: [], undo: [], redo: [], draft: null, dirty: false,
  q: '', kind: 'all', libQ: '', libSel: null,
  /* faixa de baixo: 'simbolos' = os corpos prontos da symbols-lib; 'componentes' = os
     VALORES da familia aberta (so faz sentido num acervo do almoxarifado) */
  faixa: 'simbolos', valSel: null, valQ: '',
  familia: null,      /* nome da familia quando ST.draft e o desenho de UM valor dela */
  unit: 'mm',         /* unidade da interface (mm | mil); o estado continua em mil */
  snap: UNIT_DEFAULT.mm, grid: true, draw: null, mouse: null, pinRot: 0, note: '', fitPending: false,
  saved: new Set(),   /* salvos nesta sessão; "modificado" = salvo ou o aberto com edição */
  saving: false,      /* POST /save em voo: o botão fica travado mesmo que a ficha seja refeita */
  cam: null,          /* o {scale,cx,cy} da câmera, para quem quer conferir o pan por fora */
  box: null,          /* caixa de seleção em curso (mundo) */
  gesto: null,        /* gesto do botão esquerdo em curso */
};
/* schlibErro / symlibMissing: carga que falhou fica como null (não como lista vazia) para o
   próximo render() tentar de novo — senão um 404 vira "0 símbolos" até o F5 */
const DATA = { schlib: null, symlib: null, loading: null, libLoading: null, bust: 0, schlibErro: '', symlibMissing: false,
               acervo: null, loadingId: null, cache: {} };
let O = null;      /* opts do último render: root, toast, onSaved, splits... */
let UI = null;     /* nós do DOM criados uma vez */
let CAM = null;

/* ═══════════════════════ carga dos dados ═══════════════════════ */

/* mesma ideia do loadVarScript da casca (que é interno lá): os arquivos são "var X = ...",
   então entram por <script> e saem pelo global. ?v= porque depois de salvar o arquivo é outro. */
function loadVarScript(src, name) {
  return new Promise(resolve => {
    window[name] = undefined;
    const s = document.createElement('script');
    s.src = src + '?v=' + (++DATA.bust) + '.' + Date.now();
    s.onload = () => { const v = window[name]; window[name] = undefined; s.remove(); resolve(v); };
    s.onerror = () => { s.remove(); resolve(undefined); };
    document.head.appendChild(s);
  });
}
/* ACERVO: qual biblioteca a lista da esquerda mostra. O painel so conhecia
   Libs/schlib.js (o espelho do Altium, 401 simbolos); os acervos do almoxarifado
   (Libs/almox-basicos.js, Libs/almox-especiais.js) sao a MESMA lista que a aba Sch Lib
   ja mostra no mesmo seletor. Quem escolhe e a casca, que passa `acervo` no render(). */
const ACERVO_PADRAO = { id: 'altium', title: 'Espelho do Altium', file: 'Libs/schlib.js', varName: 'schlib' };
function acervoAtual() { return DATA.acervo || ACERVO_PADRAO; }

function loadSchlib() {
  const a = acervoAtual();
  /* cache por acervo: trocar de acervo e voltar nao pode rebaixar a lista para vazia
     enquanto recarrega, nem refazer o download do que ja veio */
  if (DATA.cache[a.id]) { DATA.schlib = DATA.cache[a.id]; DATA.schlibErro = ''; return Promise.resolve(DATA.schlib); }
  if (DATA.loading && DATA.loadingId === a.id) return DATA.loading;
  DATA.loadingId = a.id;
  DATA.loading = loadVarScript(a.file, a.varName).then(v => {
    const ok = v && v.symbols ? v : null;
    if (ok) DATA.cache[a.id] = ok;
    DATA.schlib = ok;
    DATA.schlibErro = ok ? '' : ('não carregou ' + a.file + ' — o servidor está de pé? (troque de aba para tentar de novo)');
    DATA.loading = null;
    return DATA.schlib;
  });
  return DATA.loading;
}

/* Troca o acervo mostrado. Devolve true quando mudou de verdade — a casca so precisa
   redesenhar nesse caso. */
function setAcervo(a) {
  const novo = (a && a.id) ? a : ACERVO_PADRAO;
  if (DATA.acervo && DATA.acervo.id === novo.id) return false;
  DATA.acervo = novo;
  DATA.schlib = DATA.cache[novo.id] || null;
  DATA.schlibErro = '';
  DATA.loading = null; DATA.loadingId = null;
  listKey = '';
  /* o simbolo aberto e de outro acervo: nao faz sentido continuar com ele na tela */
  ST.sel = null; ST.draft = null; ST.selection = []; ST.undo = []; ST.redo = []; ST.dirty = false;
  return true;
}
function loadSymlib() {
  if (DATA.symlib) return Promise.resolve(DATA.symlib);
  if (!DATA.libLoading) DATA.libLoading = loadVarScript('Libs/symbols-lib.js', 'symbolsLib').then(v => {
    DATA.symlib = v && v.symbols ? v : null;
    DATA.symlibMissing = !DATA.symlib;
    DATA.libLoading = null;
    return DATA.symlib;
  });
  return DATA.libLoading;
}
const symbols = () => (DATA.schlib && DATA.schlib.symbols) || [];
/* o acervo do almoxarifado nao e gravavel pelo /api/symbols/save (ele so conhece o
   espelho Libs/schlib.js): dizer isso na cara, e nao deixar o POST falhar com 404 */
const acervoGravavel = () => acervoAtual().id === 'altium';

/* ═══ Componentes de uma familia ═══
   No almoxarifado um "symbol" e uma FAMILIA desenhada (DIODO TVS) e `valores[]` sao os
   componentes de verdade (25 no DIODO TVS). Cada valor pode ter geometria PROPRIA no
   campo `parts` — 12 dos 1550 valores de almox-basicos ja tem — e quem a tem nao usa a
   da familia. E assim que o PNP deixa de ser desenhado com a seta do NPN sem partir a
   familia em duas. */
function familiaAberta() {
  /* com um valor aberto, ST.sel e o nome DO VALOR: a familia fica em ST.familia */
  const nome = ST.familia || ST.sel;
  return nome ? symByName(nome) : null;
}
const valoresDa = f => (f && f.valores) || [];
const nomeDoValor = v => (v && (v.altium || v.label)) || '';
const valorPorNome = (f, n) => valoresDa(f).find(v => nomeDoValor(v) === n) || null;
/* o valor tem desenho proprio, ou herda o da familia? */
const valorTemGeo = v => !!(v && v.parts && v.parts.length);
const symByName = n => symbols().find(s => s.name === n) || null;
const libSyms = () => (DATA.symlib && DATA.symlib.symbols) || [];
const libById = id => libSyms().find(s => s.id === id) || null;
const semServidor = () => typeof location !== 'undefined' && !/^http/.test(location.protocol);

async function api(path, body) {
  let r;
  try {
    r = await fetch('/api/symbols/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  } catch (e) { return { status: 0, j: { ok: false, error: 'servidor não respondeu: ' + e.message } }; }
  let j = null;
  try { j = await r.json(); }
  catch (e) { j = { ok: false, error: (r.status === 404 || r.status === 405) ? 'o servidor não tem /api/symbols — reinicie o hubserver.py' : 'resposta inválida do servidor (HTTP ' + r.status + ')' }; }
  return { status: r.status, j };
}

/* ═══════════════════════ rascunho, undo, seleção ═══════════════════════ */

function curPart() {
  const d = ST.draft; if (!d) return null;
  if (!d.parts || !d.parts.length) d.parts = [{ part: 1, pins: [], graphics: [] }];
  let p = d.parts.find(x => x.part === ST.part);
  if (!p) { p = d.parts[0]; ST.part = p.part; }
  if (!p.pins) p.pins = []; if (!p.graphics) p.graphics = [];
  return p;
}
const selKey = s => s.kind + ':' + s.idx;
const selHas = h => selHasIn(ST.selection, h.kind, h.idx);
function selAdd(h) { if (!selHas(h)) ST.selection.push({ kind: h.kind, idx: h.idx }); }
function selDel(h) { ST.selection = ST.selection.filter(s => !(s.kind === h.kind && s.idx === h.idx)); }
function selClear() { ST.selection = []; }
function itemOf(p, s) { return s.kind === 'pin' ? (p.pins[s.idx] || null) : (p.graphics[s.idx] || null); }
/* a seleção com os itens de verdade; entradas que apontam para fora (item apagado) caem */
function selItems() {
  const p = curPart(); if (!p) return [];
  return ST.selection.map(s => ({ kind: s.kind, idx: s.idx, item: itemOf(p, s) })).filter(x => x.item);
}
const selOnly = () => (ST.selection.length === 1 ? ST.selection[0] : null);
function selItem() { const l = selItems(); return l.length === 1 ? l[0].item : null; }
function setItem(s, item) {
  const p = curPart(); if (!p || !s) return;
  if (s.kind === 'pin') p.pins[s.idx] = item; else p.graphics[s.idx] = item;
}
function pruneSel() { const p = curPart(); ST.selection = p ? ST.selection.filter(s => itemOf(p, s)) : []; }
/* a descrição entra no snapshot porque a ficha a edita pelo mesmo undo dos gráficos; a
   seleção também — desfazer um Delete devolve os itens já marcados */
const snapshot = () => ({ part: ST.part, parts: clone(ST.draft.parts), selection: clone(ST.selection), description: ST.draft.description });
function restore(sn) { ST.draft.parts = sn.parts; ST.part = sn.part; ST.selection = sn.selection || []; ST.draft.description = sn.description; pruneSel(); }
function pushUndo() {
  if (!ST.draft) return;
  ST.undo.push(snapshot()); if (ST.undo.length > 200) ST.undo.shift();
  ST.redo.length = 0;
}
function touched() { ST.dirty = true; }
const isMod = name => ST.saved.has(name) || (ST.dirty && ST.sel === name);
const nMod = () => ST.saved.size + (ST.dirty && ST.sel && !ST.saved.has(ST.sel) ? 1 : 0);
function undo() { if (!ST.undo.length) return; ST.redo.push(snapshot()); restore(ST.undo.pop()); touched(); afterEdit(); }
function redo() { if (!ST.redo.length) return; ST.undo.push(snapshot()); restore(ST.redo.pop()); touched(); afterEdit(); }
function afterEdit() { refreshBar(); refreshAside(); redraw(); }

async function openSymbol(name, force) {
  if (ST.sel === name && ST.draft) return;
  if (ST.dirty && !force) {
    const ok = await confirmar('Há edição não salva em "' + ST.sel + '". Descartar e abrir "' + name + '"?', { title: 'Descartar edição?', ok: 'Descartar', danger: true });
    if (!ok) return;
  }
  const s = symByName(name);
  ST.sel = name; ST.draft = s ? clone(s) : null; ST.part = 1;
  ST.undo = []; ST.redo = []; ST.dirty = false; ST.selection = []; ST.draw = null; ST.note = '';
  ST.fitPending = true;
  refreshAll(); fitSeNecessario();
}

/* ═══════════════════════ modais no tema do hub ═══════════════════════
   confirm()/prompt() do navegador chegam em inglês e travam a aba. Aqui é o mesmo backdrop +
   dialog da casca (#overlay), que devolve Promise; ao fechar sai só o próprio backdrop —
   esvaziar o #overlay inteiro derrubaria um menu da casca que estivesse aberto por baixo. */
let modal = null;
function abreModal(o) {
  const rootEl = document.getElementById('overlay') || document.body;
  /* um de cada vez: um segundo pedido com o diálogo aberto (só chega por código) sai como
     "cancelar" em vez de empilhar dois backdrops que um Esc derrubaria juntos */
  if (modal && modal.isConnected) return Promise.resolve(o.input ? null : false);
  return new Promise(resolve => {
    const antes = document.activeElement;
    const bd = el('div', 'backdrop center');
    const d = el('div', 'dialog symed-dlg');
    d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
    d.append(el('h3', null, o.title));
    if (o.msg) d.append(el('p', null, o.msg));
    let inp = null;
    if (o.input) {
      const lab = el('label', null, o.input.label);
      inp = el('input', 'input'); inp.type = 'text'; inp.value = o.input.valor || '';
      lab.append(inp); d.append(lab);
    }
    const act = el('div', 'acts');
    const bc = el('button', 'btn btn-ghost', o.cancel || 'Cancelar'); bc.type = 'button';
    const bo = el('button', 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary'), o.ok || 'OK'); bo.type = 'button';
    act.append(bc, bo); d.append(act); bd.append(d);
    const nada = inp ? null : false;
    let feito = false, mo = null;
    const fecha = v => {
      if (feito) return; feito = true;
      document.removeEventListener('keydown', tecla, true);
      if (mo) mo.disconnect();
      bd.remove(); modal = null;
      if (antes && typeof antes.focus === 'function') try { antes.focus(); } catch (e) {}
      resolve(v);
    };
    const confirma = () => fecha(inp ? inp.value : true);
    /* em captura, parando também os ouvintes irmãos: o Esc não pode chegar ao Esc da casca (que
       esvazia o #overlay) nem ao do editor. Enter em cima do Cancelar cancela — quem chegou lá
       por Tab e apertou Enter quis o botão, não o OK. E o Tab roda só dentro do diálogo: atrás
       do backdrop os botões da página continuam vivos para o teclado */
    const foco = () => [inp, bc, bo].filter(Boolean);
    const tecla = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fecha(nada); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); if (document.activeElement === bc) fecha(nada); else confirma(); }
      else if (e.key === 'Tab') {
        const f = foco(), n = f.length, i = f.indexOf(document.activeElement);
        e.preventDefault(); e.stopImmediatePropagation();
        f[i < 0 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? n - 1 : 1)) % n].focus();
      }
    };
    bc.onclick = () => fecha(nada);
    bo.onclick = confirma;
    bd.onclick = e => { if (e.target === bd) fecha(nada); };
    document.addEventListener('keydown', tecla, true);
    /* se a casca esvaziar o #overlay por fora (menu da marca, Esc dela), a promessa não fica pendurada */
    if (typeof MutationObserver === 'function') { mo = new MutationObserver(() => { if (!bd.isConnected) fecha(nada); }); mo.observe(rootEl, { childList: true }); }
    rootEl.append(bd); modal = bd;
    (inp || bo).focus(); if (inp) inp.select();
  });
}
async function confirmar(msg, o) { o = o || {}; return !!(await abreModal({ title: o.title || 'Confirmar', msg, ok: o.ok, danger: o.danger })); }
async function pedirTexto(title, label, valor) { const v = await abreModal({ title, input: { label, valor }, ok: 'OK' }); return v == null ? null : v; }

/* ═══════════════════════ DOM ═══════════════════════ */

const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const btn = (cls, txt, on, title) => { const b = el('button', 'btn ' + cls, txt); b.type = 'button'; b.onclick = on; if (title) b.title = title; return b; };
const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const SVG = 'http://www.w3.org/2000/svg';
function icon(spec) {
  const s = document.createElementNS(SVG, 'svg');
  [['viewBox', '0 0 16 16'], ['width', '16'], ['height', '16'], ['fill', 'none'], ['stroke', 'currentColor'],
   ['stroke-width', '1.6'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']].forEach(([k, v]) => s.setAttribute(k, v));
  for (const part of spec.split('|')) {
    const m = part.match(/^([cer]):(.+)$/);
    let n;
    if (!m) { n = document.createElementNS(SVG, 'path'); n.setAttribute('d', part); }
    else {
      const v = m[2].split(',');
      if (m[1] === 'c') { n = document.createElementNS(SVG, 'circle'); n.setAttribute('cx', v[0]); n.setAttribute('cy', v[1]); n.setAttribute('r', v[2]); }
      else if (m[1] === 'e') { n = document.createElementNS(SVG, 'ellipse'); n.setAttribute('cx', v[0]); n.setAttribute('cy', v[1]); n.setAttribute('rx', v[2]); n.setAttribute('ry', v[3]); }
      else { n = document.createElementNS(SVG, 'rect'); n.setAttribute('x', v[0]); n.setAttribute('y', v[1]); n.setAttribute('width', v[2]); n.setAttribute('height', v[3]); }
    }
    s.append(n);
  }
  return s;
}
const ibtn = (ic, title, on) => { const b = el('button', 'symed-ib'); b.type = 'button'; b.title = title; b.append(icon(ICONS[ic])); b.onclick = on; return b; };

/* a caixa de ferramentas mora no topo da ficha (aside) e nasce uma vez: a ficha é refeita a
   cada seleção, mas só reencaixa este nó */
function buildToolbox() {
  const box = el('div', 'symed-toolbox');
  box.append(el('div', 'kicker', 'ferramentas'));
  UI.tools = el('div', 'symed-tb');
  TOOLS.forEach(([id, title]) => { const b = ibtn(id, title, () => setTool(id)); b.dataset.tool = id; UI.tools.append(b); });
  UI.acts = el('div', 'symed-tb');
  UI.bRot = ibtn('rotate', 'Girar tudo 90° anti-horário (Ctrl+R)', girarTudo);
  UI.bMir = ibtn('mirror', 'Espelhar tudo em X (Ctrl+M)', espelharTudo);
  UI.bFit = ibtn('fit', 'Enquadrar o símbolo (F)', () => fit());
  UI.bGrid = ibtn('grid', 'Grade', () => { ST.grid = !ST.grid; refreshBar(); redraw(); });
  UI.acts.append(UI.bRot, UI.bMir, UI.bFit, UI.bGrid);
  box.append(UI.tools, UI.acts);
  return box;
}

/* as opções de snap da unidade atual; o value é o passo em mil */
function fillSnaps() {
  UI.snapSel.textContent = '';
  UNIT_SNAPS[ST.unit].forEach(s => {
    const mil = snapMil(s, ST.unit);
    const o = el('option', null, s + ' ' + ST.unit); o.value = String(mil);
    if (Math.abs(mil - ST.snap) < 1e-6) o.selected = true;
    UI.snapSel.append(o);
  });
}
/* "1 mm" / "100 mil": o nome do snap atual, para o aviso e o rodapé */
function snapLabel() {
  const s = UNIT_SNAPS[ST.unit].find(v => Math.abs(snapMil(v, ST.unit) - ST.snap) < 1e-6);
  return (s != null ? s : fmtUnit(ST.snap, ST.unit)) + ' ' + ST.unit;
}
function setUnit(u) {
  if (u !== 'mm' && u !== 'mil') return;
  ST.unit = u; ST.snap = UNIT_DEFAULT[u];
  try { localStorage.setItem(UNIT_KEY, u); } catch (e) {}
  if (UI) { UI.unitSel.value = u; fillSnaps(); UI.coord.textContent = 'x — · y — ' + u; }
  refreshBar(); refreshAside(); redraw();
}

function build(rootEl) {
  UI = { root: rootEl };
  rootEl.textContent = '';
  try { const u = localStorage.getItem(UNIT_KEY); if (u === 'mm' || u === 'mil') { ST.unit = u; ST.snap = UNIT_DEFAULT[u]; } } catch (e) {}
  const grid = el('div', 'symed-grid');

  /* ── esquerda: busca · recorte · kicker · resumo · lista ── */
  const left = el('div', 'lib-left');
  const bar = el('div', 'lib-bar');
  UI.q = el('input', 'input'); UI.q.type = 'text'; UI.q.placeholder = 'Buscar símbolo…'; UI.q.value = ST.q;
  UI.q.oninput = () => { ST.q = UI.q.value; refreshList(); };
  UI.seg = el('div', 'seg');
  bar.append(UI.q, UI.seg);
  UI.sum = el('div', 'lib-sum');
  UI.list = el('div', 'scroll lib-list');
  UI.kicker = el('div', 'kicker symed-kicker', 'componentes do espelho do Altium');
  left.append(bar, UI.kicker, UI.sum, UI.list);

  const split = lado => { const s = el('div', 'split'); s.dataset.split = lado; s.title = 'arraste para redimensionar · duplo clique fecha/abre'; return s; };

  /* ── meio: barra · canvas · rodapé · biblioteca de símbolos ── */
  const mid = el('div', 'symed-mid');
  const cb = el('div', 'canvas-bar');
  UI.name = el('span', 'meta symed-name', '—');
  UI.partSel = el('select', 'input'); UI.partSel.hidden = true; UI.partSel.title = 'parte do símbolo';
  UI.partSel.onchange = () => abrirParte(parseInt(UI.partSel.value, 10) || 1);
  cb.append(el('span', 'ttl', 'editor'), UI.name, UI.partSel);
  /* desfazer/refazer moram no canto direito da barra do canvas, não na caixa de ferramentas */
  const hist = el('div', 'right symed-hist');
  UI.bUndo = ibtn('undo', 'Desfazer (Ctrl+Z)', undo);
  UI.bRedo = ibtn('redo', 'Refazer (Ctrl+Y)', redo);
  hist.append(UI.bUndo, UI.bRedo);
  cb.append(hist);

  UI.vp = el('div', 'viewport sheet symed-vp');
  UI.cv = el('canvas');
  UI.hint = el('div', 'hint');
  UI.vp.append(UI.cv, UI.hint);
  hookMouse();
  UI.cv.addEventListener('dblclick', e => { e.preventDefault(); if (ST.draw) { descartaJitter(); finishDraw(); } });

  const foot = el('div', 'symed-foot');
  UI.coord = el('span', null, 'x — · y — ' + ST.unit);
  UI.status2 = el('span', null, '');
  const fr = el('div', 'right');
  fr.append(el('span', null, 'unidade'));
  UI.unitSel = el('select', 'input'); UI.unitSel.title = 'unidade da interface — por dentro tudo continua em mil';
  ['mm', 'mil'].forEach(u => { const o = el('option', null, u); o.value = u; if (u === ST.unit) o.selected = true; UI.unitSel.append(o); });
  UI.unitSel.onchange = () => setUnit(UI.unitSel.value);
  fr.append(UI.unitSel, el('span', null, 'snap'));
  UI.snapSel = el('select', 'input');
  fillSnaps();
  UI.snapSel.onchange = () => { ST.snap = parseFloat(UI.snapSel.value) || UNIT_DEFAULT[ST.unit]; refreshBar(); refreshAside(); redraw(); };
  fr.append(UI.snapSel);
  foot.append(UI.coord, UI.status2, fr);

  const lb = el('div', 'symed-libbar');
  UI.libQ = el('input', 'input'); UI.libQ.type = 'text'; UI.libQ.placeholder = 'buscar na biblioteca de símbolos…'; UI.libQ.value = ST.libQ;
  UI.libQ.oninput = () => {
    if (ST.faixa === 'componentes') ST.valQ = UI.libQ.value; else ST.libQ = UI.libQ.value;
    libKey = ''; refreshLib();
  };
  UI.libCount = el('span', 'count', '');
  const lr = el('div', 'right');
  UI.bLibAdd = btn('btn-secondary btn-sm', '+ corpo atual', adicionarCorpo, 'guarda o desenho da parte aberta na biblioteca de símbolos');
  UI.bLibApply = btn('btn-primary btn-sm', 'Aplicar ao símbolo', aplicarLib, 'troca o desenho da parte aberta pelo símbolo escolhido (a pinagem fica se a contagem bater)');
  UI.bLibRen = btn('btn-secondary btn-sm', 'Renomear', renomearLib);
  UI.bLibDel = btn('btn-secondary btn-sm', 'Excluir', excluirLib);
  lr.append(UI.bLibAdd, UI.bLibApply, UI.bLibRen, UI.bLibDel);
  /* sub-aba da faixa: "Símbolos" (os corpos prontos) x "Componentes" (os valores da
     familia aberta). Sem ela nao havia como chegar num componente especifico: a lista da
     esquerda mostra a FAMILIA, e a familia nao e o que se monta na placa. */
  UI.faixaTabs = el('div', 'symed-faixatabs');
  UI.faixaTabs.setAttribute('role', 'tablist');
  [['simbolos', 'Símbolos'], ['componentes', 'Componentes']].forEach(([k, rot]) => {
    const b = el('button', null, rot); b.type = 'button'; b.dataset.faixa = k;
    b.setAttribute('role', 'tab');
    b.onclick = () => {
      if (ST.faixa === k) return;
      ST.faixa = k; libKey = '';
      UI.libQ.value = (k === 'componentes' ? ST.valQ : ST.libQ) || '';
      refreshLib();
    };
    UI.faixaTabs.append(b);
  });
  lb.append(UI.faixaTabs, UI.libQ, UI.libCount, lr);
  UI.tiles = el('div', 'symed-tiles');
  mid.append(cb, UI.vp, foot, lb, UI.tiles);

  /* ── direita: ferramentas + ficha ── */
  UI.aside = el('aside', 'symed-aside');
  UI.toolbox = buildToolbox();

  grid.append(left, split('l'), mid, split('r'), UI.aside);
  rootEl.append(grid);

  /* a câmera só depois dos ouvintes de captura do mouse (hookMouse): o esquerdo tem de parar
     antes de chegar ao arrasto dela */
  CAM = HubDraw.mkCamera(UI.cv, drawWorld, { bg: tok('--sheet') || HubDraw.SCH.sheet, onMove: move });
  ST.cam = CAM.cam;
  /* divisórias como nas abas Laser e BOM: o mkSplits da casca lê o DOM na criação, por isso
     só agora. Sem a casca (render solto) o painel abre igual, só sem arrasto. */
  UI.splits = (O && typeof O.splits === 'function') ? O.splits({
    key: 'altiumhub.symed.panes', grid: '.symed-grid',
    lados: { l: { v: '--symed-l', sel: '.symed-grid > .lib-left' }, r: { v: '--symed-r', sel: '.symed-grid > aside' } },
    onResize: () => { if (CAM) CAM.resize(); },
  }) : null;
  /* miniaturas só quando aparecem: 400 canvases de uma vez travam a aba */
  UI.io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(ents => ents.forEach(e => { if (e.isIntersecting) drawTile(e.target); }), { root: UI.tiles })
    : null;
  document.addEventListener('keydown', onKey);
}

/* ═══════════════════════ atualizações ═══════════════════════ */

function refreshAll() { refreshList(); refreshBar(); refreshAside(); refreshLib(); redraw(); }

let listKey = '';
function refreshList() {
  if (!UI) return;
  const syms = symbols();
  /* o acervo ENTRA na chave: sem ele, trocar de acervo nao redesenha a lista, e duas
     bibliotecas podem ter a mesma contagem de simbolos e passar batido */
  const key = [acervoAtual().id, ST.q, ST.kind, ST.sel, nMod(), syms.length, ST.dirty, DATA.schlib ? 1 : 0, DATA.schlibErro].join(SEP);
  if (key === listKey) return;
  listKey = key;
  const semFp = s => !(s.footprints || []).some(f => f.incurrentlib);
  const q = ST.q.trim().toLowerCase();
  const hit = s => !q || (s.name + ' ' + (s.description || '')).toLowerCase().includes(q);
  const noFp = syms.filter(semFp);

  UI.seg.textContent = '';
  [['all', 'Tudo', syms.length], ['nofp', 'Sem fp', noFp.length], ['mod', 'Modificados', nMod()]].forEach(([k, rot, n]) => {
    const b = el('button', null, rot); b.type = 'button';
    b.setAttribute('aria-pressed', String(ST.kind === k));
    b.append(el('span', 'n', String(n)));
    b.onclick = () => { ST.kind = k; refreshList(); };
    UI.seg.append(b);
  });

  if (UI.kicker) UI.kicker.textContent = 'componentes · ' + acervoAtual().title;
  UI.sum.textContent = '';
  const stat = (n, rot, tone) => { const s = el('span'); const b = el('b', null, String(n)); if (tone) b.style.color = 'var(--' + tone + ')'; s.append(b, document.createTextNode(' ' + rot)); UI.sum.append(s); };
  stat(syms.length, 'símbolos'); stat(noFp.length, 'sem footprint', noFp.length ? 'warn' : null);
  stat(nMod(), 'modificados nesta sessão');
  if (DATA.schlib) UI.sum.title = acervoAtual().file + ': ' + (DATA.schlib.source || '—') + '  (' + (DATA.schlib.generated || '—') + ')';

  const rows = syms.filter(s => hit(s) && (ST.kind === 'all' || (ST.kind === 'nofp' ? semFp(s) : isMod(s.name))));
  UI.list.textContent = '';
  const frag = document.createDocumentFragment();
  if (!DATA.schlib) frag.append(el('div', 'lib-head', DATA.schlibErro || ('carregando ' + acervoAtual().title + '…')));
  else if (!rows.length) frag.append(el('div', 'lib-head', q ? 'nada com "' + ST.q + '"' : 'nada aqui'));
  else frag.append(el('div', 'lib-head', 'símbolos (' + rows.length + (rows.length !== syms.length ? ' de ' + syms.length : '') + ')'));
  rows.forEach(s => {
    const b = el('button', 'lib-row'); b.type = 'button'; b.title = s.name;
    b.setAttribute('aria-selected', String(ST.sel === s.name));
    b.append(el('span', 'nm', s.name));
    if (isMod(s.name)) b.append(el('span', 'pill', ST.dirty && ST.sel === s.name ? '● editado' : 'salvo'));
    if (semFp(s)) b.append(el('span', 'pill warn', 'sem fp'));
    const p0 = (s.parts || [])[0] || {};
    b.append(el('span', 'mt', ((p0.pins || []).length) + 'p' + ((s.partcount || 1) > 1 ? ' · ' + s.partcount + ' partes' : '')));
    b.onclick = () => openSymbol(s.name);
    frag.append(b);
  });
  UI.list.append(frag);
}

function cursorPadrao() {
  if (!UI) return;
  UI.cv.style.cursor = !ST.draft ? 'default' : ST.tool === 'select' ? 'default' : ST.tool === 'delete' ? 'pointer' : 'crosshair';
}
function refreshBar() {
  if (!UI) return;
  const d = ST.draft, p = curPart();
  UI.name.textContent = d ? d.name + (ST.dirty ? ' ●' : '') : '—';
  const n = d ? (d.parts || []).length : 0;
  UI.partSel.hidden = n <= 1;
  if (n > 1) {
    UI.partSel.textContent = '';
    d.parts.forEach(pt => { const o = el('option', null, 'parte ' + pt.part + '/' + n); o.value = String(pt.part); if (pt.part === ST.part) o.selected = true; UI.partSel.append(o); });
  }
  UI.tools.querySelectorAll('button').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.tool === ST.tool)); b.disabled = !d; });
  UI.bUndo.disabled = !ST.undo.length; UI.bRedo.disabled = !ST.redo.length;
  UI.bRot.disabled = UI.bMir.disabled = UI.bFit.disabled = !d;
  UI.bGrid.setAttribute('aria-pressed', String(ST.grid));
  UI.bGrid.title = 'Grade (' + (ST.grid ? 'ligada' : 'desligada') + ')';
  UI.hint.textContent = !DATA.schlib ? (DATA.schlibErro || 'carregando o espelho…') : !d ? 'escolha um símbolo na lista'
    : (!p.graphics.length && !p.pins.length ? 'parte vazia — desenhe, ou aplique um corpo da biblioteca' : '');
  if (!panning) cursorPadrao();
  UI.status2.textContent = ST.draw ? drawHint() : (ST.tool === 'pin' ? 'pino a ' + ST.pinRot + '° — R gira' : '');
}
function drawHint() {
  const d = ST.draw; if (!d) return '';
  const n = d.pts.length;
  if (d.tool === 'polyline' || d.tool === 'poly') return n + ' ponto' + (n === 1 ? '' : 's') + ' — duplo clique, botão direito ou Enter fecha · Esc cancela';
  if (d.tool === 'arc') return 'clique para dar o raio';
  if (d.tool === 'ellipse') return 'clique no canto';
  return 'clique no segundo ponto · Esc cancela';
}

/* ── ficha (aside), no estilo do painel Properties do Altium ──
   Cabeçalho com o tipo do que está marcado e o nome do símbolo; depois Localização (X e Y na
   mesma linha), Parte, Tamanho (na unidade da interface) e, no pino, número/nome com o olho
   de visibilidade. Tudo num grid só — dois pares rótulo/campo por linha mais a coluna do olho. */
function refreshAside() {
  if (!UI) return;
  const a = UI.aside; a.textContent = '';
  a.append(UI.toolbox);
  const d = ST.draft;
  if (!d) {
    a.append(el('div', 'kicker', 'editor de símbolos'));
    const p = el('p', null, 'Escolha um símbolo do espelho para editar a geometria e os pinos. Salvar grava no espelho '
      + '(Libs/schlib.js) e, marcando Altium, na SchLib real — com backup. A biblioteca de símbolos embaixo do '
      + 'canvas guarda corpos prontos: clique num e aplique, ou arraste um para o canvas.');
    p.style.cssText = 'font-size:12px;color:var(--text-3);margin:6px 0 12px;line-height:1.5';
    a.append(p);
    return;
  }
  const part = curPart();
  const itens = selItems(), it = itens.length === 1 ? itens[0].item : null;
  a.append(el('div', 'kicker', it ? tipoDe(it) : (ST.familia ? 'componente' : 'símbolo')));
  const h = el('div', 'det-head'); const nm = el('span', 'd', d.name); nm.style.cssText = 'font-size:16px;word-break:break-word;line-height:1.3'; h.append(nm); a.append(h);
  /* editando UM componente: dizer de que familia ele e, e como voltar. Sem isto o nome no
     topo nao distingue "a familia DIODO TVS" de "o componente (TVS) CDSOT23-SM712". */
  if (ST.familia) {
    const via = el('div', 'symed-viafam');
    via.append(document.createTextNode('de '));
    const volta = el('button', null, ST.familia); volta.type = 'button';
    volta.title = 'voltar para o desenho da família inteira';
    volta.onclick = voltarParaFamilia;
    via.append(volta);
    const f = familiaAberta(), v = f && valorPorNome(f, d.name);
    via.append(el('span', 'q', valorTemGeo(v) ? ' · desenho próprio' : ' · herdando o desenho da família'));
    a.append(via);
  }
  if (itens.length) a.append(acoesDaSelecao(itens, it));
  if (it) a.append(fieldsFor(it));
  else if (itens.length > 1) {
    const q = el('p', null, itens.length + ' itens selecionados — Delete apaga, setas empurram, Ctrl+D duplica');
    q.style.cssText = 'font-size:12px;color:var(--text-4);margin:6px 0 10px;line-height:1.45'; a.append(q);
  } else {
    const desc = el('input', 'input'); desc.value = d.description || ''; desc.placeholder = 'descrição'; desc.title = 'descrição do componente';
    desc.style.cssText = 'margin-top:6px;min-height:26px;font-size:12px';
    desc.onchange = () => { pushUndo(); d.description = desc.value; touched(); refreshBar(); refreshList(); };
    a.append(desc, fieldsForSymbol(d, part));
  }
  const off = pinsOffGrid(part.pins, ST.snap);
  if (off.length) a.append(el('div', 'symed-warn', 'ponta quente fora do snap de ' + snapLabel() + ': pinos ' + off.map(x => x.num).join(', ')
    + ' — o fio não vai encostar no Altium'));
  if (ST.note) a.append(el('div', 'symed-note', ST.note));

  /* salvar */
  const sv = el('div', 'symed-save');
  UI.bSave = btn('btn-primary', 'Salvar', salvar, semServidor() ? 'abra o hub pelo hubserver.py para gravar' : 'grava no espelho (Libs/schlib.js) e, se marcado, na SchLib do Altium');
  UI.bSave.disabled = semServidor() || !ST.dirty || ST.saving;
  const lab = el('label'); UI.altium = el('input'); UI.altium.type = 'checkbox'; UI.altium.checked = UI.altiumChecked !== false;
  UI.altium.onchange = () => { UI.altiumChecked = UI.altium.checked; };
  lab.append(UI.altium, document.createTextNode('Altium'));
  lab.title = 'também grava na SchLib real (BIBLIOTECA DE ESQUEMA.SchLib), com backup';
  sv.append(UI.bSave, lab);
  a.append(sv);
  UI.status = el('div', 'symed-status' + (UI.statusKind ? ' ' + UI.statusKind : ''), UI.statusMsg || (ST.dirty ? 'edição não salva' : ''));
  a.append(UI.status);
}
/* a fileira de ações logo abaixo do nome, só com seleção: virar (K — só linha ou pino, sozinho),
   duplicar (Ctrl+D) e excluir (Delete; com vários, o title diz quantos) — ícones como a caixa
   de ferramentas, no lugar dos botões de texto */
function acoesDaSelecao(itens, it) {
  const acts = el('div', 'symed-acts');
  const v = viravel(it);
  if (v) acts.append(ibtn('flip', 'Virar ' + v + ' (K) — ' + (v === 'pino' ? 'a linha vira pino, ponta quente para fora do corpo' : 'o pino vira linha do corpo à ponta quente'), virar));
  acts.append(ibtn('duplicate', 'Duplicar (Ctrl+D) — cópia deslocada um passo', duplicarSelecao));
  const n = itens.length;
  acts.append(ibtn('delete', n > 1 ? 'Excluir ' + n + ' itens (Delete)' : 'Excluir (Delete)', deleteSelection));
  return acts;
}
function setStatus(msg, kind) { UI.statusMsg = msg; UI.statusKind = kind || ''; if (UI.status) { UI.status.textContent = msg; UI.status.className = 'symed-status ' + (kind || ''); } }

/* ── o grid da ficha: rótulo | campo | rótulo | campo | olho ──
   Cada linha leva exatamente 5 células: 1 ou 2 pares (rótulo, campo) e, no fim, o olho ou um
   vão. Um par sozinho ocupa a linha inteira (grid-column 2/5). */
function propsGrid() { return el('div', 'symed-props'); }
function linha(box, pares, olho) {
  pares.forEach(([rot, node]) => { const l = el('label', null, rot); l.title = rot; box.append(l, node); });
  if (pares.length === 1) pares[0][1].classList.add('wide');
  box.append(olho || el('span'));
}
const ro = v => el('span', 'ro', String(v));
const kickerRow = (box, txt) => box.append(el('div', 'kicker', txt));
/* largura de traço: o Altium só tem 4 (Smallest/Small/Medium/Large), mostradas nas duas unidades */
const wLabel = w => w + ' mil · ' + fmtUnit(w, 'mm') + ' mm';
function selectOf(opts, val, on, rotulo) {
  const s = el('select', 'input');
  opts.forEach(([v, rot]) => { const op = el('option', null, rot == null ? String(v) : rot); op.value = String(v); if (String(v) === String(val)) op.selected = true; s.append(op); });
  s.onchange = () => on(s.value);
  if (rotulo) s.title = rotulo;
  return s;
}
/* seletor de parte: nas fichas do item move o item; sem seleção abre a parte */
function partSelect(d, val, on) {
  return selectOf((d.parts || []).map(pt => [pt.part, 'parte ' + pt.part + ' de ' + d.parts.length]), val, v => on(parseInt(v, 10) || 1));
}

/* sem item marcado: as contagens do símbolo e o seletor da parte aberta */
function fieldsForSymbol(d, part) {
  const box = propsGrid();
  kickerRow(box, 'partes');
  linha(box, [['partes', ro((d.parts || []).length)], ['aberta', partSelect(d, ST.part, abrirParte)]]);
  linha(box, [['pinos', ro(part.pins.length)], ['gráficos', ro(part.graphics.length)]]);
  const acoes = el('span', 'symed-partacoes');
  acoes.append(btn('btn-sm', '+ parte', novaParte, 'cria uma parte nova, vazia — depois escolha o corpo dela na faixa de baixo'),
               btn('btn-sm', 'excluir', excluirParte, 'exclui a parte aberta e renumera as outras'));
  linha(box, [['', acoes]]);
  return box;
}

/* campos editáveis do item selecionado, na unidade da interface; cada mudança passa pelo undo */
function fieldsFor(it) {
  const box = propsGrid(), U = ST.unit, d = ST.draft;
  /* o alvo é o item desta ficha, fixado na construção: o change do <input> só dispara no blur,
     e um mousedown no canvas já trocou a seleção antes disso — resolver por selOnly() na hora
     mandaria a edição para o item recém-clicado */
  const alvo = selOnly();
  const apply = fn => {
    const p = curPart();
    if (!alvo || !p || itemOf(p, alvo) !== it) return;
    /* fn edita a cópia no lugar ou devolve um substituto (Preencher troca o tipo do gráfico) */
    pushUndo(); const o = clone(it); const r = fn(o); setItem(alvo, r || o); touched(); refreshBar(); refreshAside(); redraw();
  };
  /* campo numérico como texto (inputmode decimal): o type=number do Chrome pt-BR mostra
     vírgula e um spinner que come a metade dos 50 px da coluna, e "-1.016" saía cortado.
     Vírgula digitada vale como ponto. Vazio ou lixo ("abc") NÃO grava: antes virava 0 e o item
     teleportava para a origem sem aviso — o valor mostrado volta e um toast diz por quê;
     medida (`pos`: largura, diâmetro, comprimento) ainda exige > 0. */
  const inp = (val, on, o) => {
    const i = el('input', 'input'); i.type = 'text'; i.autocomplete = 'off';
    const texto = !!(o && o.text), pos = !!(o && o.pos);
    if (!texto) { i.inputMode = 'decimal'; i.spellcheck = false; }
    i.value = val == null ? '' : val;
    i.onchange = () => {
      if (texto) { on(i.value); return; }
      const s = i.value.trim().replace(',', '.'), n = s === '' ? NaN : Number(s);
      if (!Number.isFinite(n) || (pos && n <= 0)) {
        i.value = val == null ? '' : val;
        if (O && O.toast) O.toast((!Number.isFinite(n) ? (s ? '"' + s + '" não é número' : 'campo vazio') : 'tem de ser maior que zero') + ' — valor mantido', 'warn');
        return;
      }
      on(s);
    };
    return i;
  };
  /* coordenada/medida em mil mostrada na unidade; o que volta vira mil com 3 casas */
  const medida = (mil, on, o) => inp(fmtUnit(mil, U), v => on(toMil(v, U)), o);
  const POS = { pos: true };
  /* ── Linha [cor][×] · Preencher [☐] [cor][×] ──
     color/fill do schlib-v2 (opcionais): ausente = a cor padrão da casa, que o seletor mostra
     apagado e o × devolve. O pino não tem cor no schlib-v2 (a da SchLib fica) — tudo desabilitado */
  const corInput = (k, padrao, rotulo, off) => {
    const wrap = el('span', 'symed-cor');
    const tem = corValida(it[k]);
    const c = el('input'); c.type = 'color'; c.value = tem ? it[k] : padrao; c.dataset.cor = k;
    if (!tem) c.classList.add('padrao');
    c.disabled = !!off;
    c.title = off ? off : rotulo + (tem ? ': ' + it[k] : ' — cor padrão da casa (clique para escolher)');
    c.onchange = () => apply(o => { o[k] = String(c.value).toLowerCase(); });
    const x = el('button', 'symed-cor-x', '×'); x.type = 'button'; x.title = 'voltar à cor padrão'; x.dataset.corX = k;
    x.disabled = !tem || !!off;
    x.onclick = () => apply(o => { delete o[k]; });
    wrap.append(c, x);
    return wrap;
  };
  const corRow = () => {
    const pino = it.g == null, f = fillable(it);
    const fillWrap = el('span', 'symed-cor');
    const cb = el('input'); cb.type = 'checkbox'; cb.dataset.fill = '1';
    cb.checked = f.ok && !!it.solid; cb.disabled = !f.ok;
    cb.title = f.ok ? (it.g === 'arc' ? 'preencher: o círculo vira elipse sólida' : it.g === 'polyline' ? 'preencher: a polilinha vira polígono fechado' : 'preencher a área (solid)') : f.why;
    cb.onchange = () => { const r = setFill(it, cb.checked); if (!r) { cb.checked = !!it.solid; return; } apply(() => r); };
    fillWrap.append(cb);
    const semFill = pino ? 'pino não tem preenchimento' : !f.ok ? f.why : !it.solid ? 'marque Preencher para escolher a cor da área' : '';
    fillWrap.append(corInput('fill', HubDraw.SCH.fill, 'cor do preenchimento', semFill));
    linha(box, [['Linha', corInput('color', pino ? HubDraw.SCH.pin : it.g === 'label' ? HubDraw.SCH.text : HubDraw.SCH.body, 'cor do traço', pino ? 'a cor do pino é a da SchLib — o schlib-v2 não a guarda' : '')],
                ['Preencher', fillWrap]]);
  };
  const W = () => selectOf(WIDTHS.map(w => [w, wLabel(w)]), normW(it.w), v => apply(o => { o.w = num(v); }));
  /* rect/ellipse/poly sem w é "a largura que já está na SchLib" (o leitor não a exporta);
     só vira número quando o usuário escolhe — daí a opção 'padrão' */
  const PADRAO = 'padrão';
  const Wp = () => selectOf([[PADRAO, PADRAO]].concat(WIDTHS.map(w => [w, wLabel(w)])), it.w == null ? PADRAO : normW(it.w),
                            v => apply(o => { if (v === PADRAO) delete o.w; else o.w = num(v); }));
  const olho = (k, rot) => {
    const vis = !it[k];
    const b = el('button', 'symed-eye'); b.type = 'button';
    b.setAttribute('aria-pressed', String(vis)); b.dataset.eye = k;
    b.title = rot + (vis ? ' visível — clique para esconder' : ' escondido — clique para mostrar');
    b.append(icon(ICONS[vis ? 'eye' : 'eyeOff']));
    b.onclick = () => apply(o => { if (vis) o[k] = true; else delete o[k]; });
    return b;
  };
  const partRow = () => { kickerRow(box, 'parte'); linha(box, [['parte', partSelect(d, ST.part, n => moverParaParte(alvo, n))]]); };
  const loc = 'localização (' + U + ')', tam = 'tamanho (' + U + ')';

  if (it.g == null) {
    kickerRow(box, loc);
    linha(box, [['X', medida(it.x, v => apply(o => { o.x = v; }))], ['Y', medida(it.y, v => apply(o => { o.y = v; }))]]);
    corRow();
    partRow();
    kickerRow(box, 'pino');
    linha(box, [['Número', inp(it.num, v => apply(o => { o.num = v; }), { text: true })]], olho('hideNum', 'número'));
    linha(box, [['Nome', inp(it.name, v => apply(o => { o.name = v; }), { text: true })]], olho('hideName', 'nome'));
    linha(box, [['Comprimento', medida(it.len, v => apply(o => { o.len = Math.abs(v); }), POS)],
                ['Orientação', selectOf([[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']], it.orient, v => apply(o => { o.orient = num(v); }))]]);
    linha(box, [['Tipo elétrico', selectOf(PIN_TYPES.map(t => [t]), it.type, v => apply(o => { o.type = v; }))]]);
    return box;
  }
  kickerRow(box, loc);
  switch (it.g) {
    case 'line':
      linha(box, [['X', medida(it.x1, v => apply(o => { o.x1 = v; }))], ['Y', medida(it.y1, v => apply(o => { o.y1 = v; }))]]);
      linha(box, [['X2', medida(it.x2, v => apply(o => { o.x2 = v; }))], ['Y2', medida(it.y2, v => apply(o => { o.y2 = v; }))]]);
      corRow(); partRow(); kickerRow(box, tam);
      linha(box, [['Comprimento', ro(fmtUnit(Math.hypot(it.x2 - it.x1, it.y2 - it.y1), U))], ['Espessura', W()]]);
      break;
    case 'rect': {
      const x1 = Math.min(it.x1, it.x2), y1 = Math.min(it.y1, it.y2), w = Math.abs(it.x2 - it.x1), hh = Math.abs(it.y2 - it.y1);
      linha(box, [['X', medida(x1, v => apply(o => { Object.assign(o, moveItem(normRect(o), v - x1, 0)); }))],
                  ['Y', medida(y1, v => apply(o => { Object.assign(o, moveItem(normRect(o), 0, v - y1)); }))]]);
      corRow(); partRow(); kickerRow(box, tam);
      linha(box, [['Largura', medida(w, v => apply(o => { normRect(o); o.x2 = r3(o.x1 + Math.abs(v)); normRect(o); }), POS)],
                  ['Altura', medida(hh, v => apply(o => { normRect(o); o.y2 = r3(o.y1 + Math.abs(v)); normRect(o); }), POS)]]);
      linha(box, [['Espessura', Wp()]]);        /* sozinho na linha: "padrão" saía cortado ao lado do Preenchido */
      break;
    }
    case 'arc':
      linha(box, [['X', medida(it.cx, v => apply(o => { o.cx = v; }))], ['Y', medida(it.cy, v => apply(o => { o.cy = v; }))]]);
      corRow(); partRow(); kickerRow(box, tam);
      linha(box, [['Diâmetro', medida(2 * it.r, v => apply(o => { o.r = r3(Math.abs(v) / 2); }), POS)], ['Espessura', W()]]);
      linha(box, [['Início (°)', inp(it.sa || 0, v => apply(o => { o.sa = num(v); normArc(o); }))], ['Fim (°)', inp(it.ea == null ? 360 : it.ea, v => apply(o => { o.ea = num(v); normArc(o); }))]]);
      break;
    case 'ellipse':
      linha(box, [['X', medida(it.cx, v => apply(o => { o.cx = v; }))], ['Y', medida(it.cy, v => apply(o => { o.cy = v; }))]]);
      corRow(); partRow(); kickerRow(box, tam);
      linha(box, [['Ø X', medida(2 * it.rx, v => apply(o => { o.rx = r3(Math.abs(v) / 2); }), POS)], ['Ø Y', medida(2 * it.ry, v => apply(o => { o.ry = r3(Math.abs(v) / 2); }), POS)]]);
      linha(box, [['Espessura', Wp()]]);
      break;
    case 'poly': case 'polyline': {
      const pts = it.pts || [], p0 = pts[0] || [0, 0];
      let len = 0;
      for (let i = 0; i + 1 < pts.length; i++) len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      if (it.g === 'poly' && pts.length > 2) len += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
      linha(box, [['X', medida(p0[0], v => apply(o => { Object.assign(o, moveItem(o, v - p0[0], 0)); }))],
                  ['Y', medida(p0[1], v => apply(o => { Object.assign(o, moveItem(o, 0, v - p0[1])); }))]]);
      linha(box, [['vértices', ro(pts.length)]]);
      corRow(); partRow(); kickerRow(box, tam);
      if (it.g === 'poly') { linha(box, [['Comprimento', ro(fmtUnit(len, U))]]); linha(box, [['Espessura', Wp()]]); }
      else linha(box, [['Comprimento', ro(fmtUnit(len, U))], ['Espessura', W()]]);
      break;
    }
    case 'label':
      linha(box, [['X', medida(it.x, v => apply(o => { o.x = v; }))], ['Y', medida(it.y, v => apply(o => { o.y = v; }))]]);
      corRow(); partRow(); kickerRow(box, 'texto');
      linha(box, [['Texto', inp(it.text, v => apply(o => { o.text = v; }), { text: true })]]);
      linha(box, [['Tamanho (pt)', inp(it.size, v => apply(o => { o.size = Math.max(1, Math.round(num(v, 10))); }), POS)],
                  ['Rotação', selectOf([[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']], it.rot || 0, v => apply(o => { o.rot = num(v); }))]]);
      break;
    default:
      corRow(); partRow();
  }
  return box;
}

/* ── paleta da biblioteca de símbolos ── */
let libKey = '';
/* Os componentes (valores) da familia aberta, na faixa de baixo. Cada um e uma peca de
   verdade do almoxarifado; clicar abre SO o desenho dele para editar. */
function refreshComponentes(f) {
  const vals = valoresDa(f);
  const q = (ST.valQ || '').trim().toLowerCase();
  const rows = vals.filter(v => !q || (nomeDoValor(v) + ' ' + (v.mpn || '') + ' ' + (v.footprint || '')).toLowerCase().includes(q));
  UI.libQ.placeholder = 'buscar componente em ' + (f ? f.name : '') + '…';
  UI.libCount.textContent = rows.length + (rows.length !== vals.length ? ' de ' + vals.length : '')
    + ' componente' + (vals.length === 1 ? '' : 's');
  UI.bLibApply.disabled = !libById(ST.libSel) || !ST.draft;
  UI.bLibAdd.disabled = !ST.draft || semServidor();
  UI.bLibRen.disabled = true; UI.bLibDel.disabled = true;
  if (UI.io) UI.io.disconnect();
  UI.tiles.textContent = '';
  if (!rows.length) { UI.tiles.append(el('div', 'symed-empty', q ? 'nada com "' + ST.valQ + '"' : 'sem componentes')); return; }
  const frag = document.createDocumentFragment();
  rows.forEach(v => {
    const nome = nomeDoValor(v);
    const b = el('button', 'symed-comp'); b.type = 'button';
    b.setAttribute('aria-selected', String(ST.valSel === nome));
    b.title = [nome,
               v.footprint ? 'footprint: ' + v.footprint : '',
               v.mpn ? 'MPN: ' + v.mpn : '',
               valorTemGeo(v) ? 'desenho próprio' : 'usa o desenho da família'].filter(Boolean).join(' · ');
    b.append(el('span', 'nm', nome));
    const meta = el('span', 'mt');
    if (valorTemGeo(v)) meta.append(el('span', 'pill', 'desenho próprio'));
    if (v.footprint) meta.append(el('span', 'fp', v.footprint));
    if (typeof v.estoque === 'number') meta.append(el('span', 'es', v.estoque + ' un'));
    b.append(meta);
    b.onclick = () => abrirValor(nome);
    frag.append(b);
  });
  UI.tiles.append(frag);
}

function refreshLib() {
  if (!UI) return;
  /* a faixa de componentes so existe onde ha valores: no espelho do Altium um simbolo
     nao tem componentes por baixo dele */
  const f = familiaAberta();
  const podeComp = valoresDa(f).length > 0;
  if (UI.faixaTabs) {
    UI.faixaTabs.hidden = false;
    for (const b of UI.faixaTabs.children) {
      const dele = b.dataset.faixa;
      b.disabled = (dele === 'componentes') && !podeComp;
      b.title = b.disabled ? 'este símbolo não tem componentes por baixo (só o almoxarifado tem)' : '';
      b.setAttribute('aria-selected', String(ST.faixa === dele));
    }
  }
  if (ST.faixa === 'componentes' && !podeComp) ST.faixa = 'simbolos';
  if (ST.faixa === 'componentes') return refreshComponentes(f);
  const L = DATA.symlib, all = libSyms();
  /* a seleção fica fora da chave: com 400+ tiles, refazer tudo a cada clique é o que trava */
  const key = [ST.libQ, all.length, L ? 1 : 0, DATA.symlibMissing ? 1 : 0].join(SEP);
  const sel = libById(ST.libSel);
  UI.bLibApply.disabled = !sel || !ST.draft;
  UI.bLibRen.disabled = !sel || semServidor();
  UI.bLibDel.disabled = !sel || semServidor();
  UI.bLibAdd.disabled = !ST.draft || semServidor();
  if (key === libKey) { markLibSel(); return; }
  libKey = key;
  if (UI.io) UI.io.disconnect();          /* os canvases antigos vão embora; observar só os novos */
  UI.tiles.textContent = '';
  if (!L) {
    UI.libCount.textContent = '';
    UI.tiles.append(el('div', 'symed-empty', DATA.symlibMissing
      ? 'biblioteca de símbolos ainda não gerada (Libs/symbols-lib.js não carregou) — rode tools/symbols/extrair.py e troque de aba'
      : 'carregando…'));
    return;
  }
  const q = ST.libQ.trim().toLowerCase();
  const rows = all.filter(s => !q || (s.name + ' ' + (s.aliases || []).join(' ') + ' ' + (s.kind || '')).toLowerCase().includes(q));
  UI.libCount.textContent = rows.length + (rows.length !== all.length ? ' de ' + all.length : '') + ' símbolo' + (all.length === 1 ? '' : 's');
  if (!rows.length) { UI.tiles.append(el('div', 'symed-empty', q ? 'nada com "' + ST.libQ + '"' : 'biblioteca vazia')); return; }
  const frag = document.createDocumentFragment();
  rows.forEach(s => {
    const t = el('button', 'symed-tile'); t.type = 'button'; t.dataset.id = s.id;
    t.setAttribute('aria-selected', String(ST.libSel === s.id));
    t.title = s.name + '\n' + (s.pins || []).length + ' pinos · ' + (s.kind || '') + (s.usos ? ' · ' + s.usos + ' usos' : '')
      + ((s.aliases || []).length ? '\n' + s.aliases.join(', ') : '');
    const cv = el('canvas'); cv.width = 96; cv.height = 64; cv.dataset.id = s.id;
    t.append(cv, el('span', 'nm', s.name), el('span', 'k', (s.kind === 'ci' ? 'CI' : 'genérico') + ' · ' + (s.pins || []).length + 'p'));
    t.onclick = () => { if (tileDragged) { tileDragged = false; return; } ST.libSel = ST.libSel === s.id ? null : s.id; refreshLib(); };
    t.ondblclick = () => { ST.libSel = s.id; aplicarLib(); };
    t.addEventListener('mousedown', e => tileDown(e, s, cv));
    t.draggable = false;
    frag.append(t);
    if (UI.io) UI.io.observe(cv); else drawTile(cv);
  });
  UI.tiles.append(frag);
}
/* só o destaque muda de tile: atributo em vez de reconstrução */
function markLibSel() {
  if (!UI) return;
  UI.tiles.querySelectorAll('.symed-tile').forEach(t => t.setAttribute('aria-selected', String(t.dataset.id === ST.libSel)));
}
function drawTile(cv) {
  if (cv.dataset.drawn) return;
  const s = libById(cv.dataset.id); if (!s) return;
  cv.dataset.drawn = '1';
  const DPR = window.devicePixelRatio || 1, W = 96, H = 64;
  cv.width = W * DPR; cv.height = H * DPR;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = tok('--sheet') || HubDraw.SCH.sheet; ctx.fillRect(0, 0, cv.width, cv.height);
  const bb = HubDraw.symBBox(s);
  const w = Math.max(bb.x2 - bb.x1, 1), hh = Math.max(bb.y2 - bb.y1, 1);
  const sc = Math.min(W / (w * 1.2), H / (hh * 1.2));
  ctx.setTransform(DPR*sc, 0, 0, -DPR*sc, DPR*(W/2 - (bb.x1+bb.x2)/2*sc), DPR*(H/2 + (bb.y1+bb.y2)/2*sc));
  HubDraw.drawSymbolPart(ctx, s, { showPinNums: false });
}

/* ═══════════════════════ canvas ═══════════════════════ */

function redraw() { if (CAM) CAM.draw(); }
function fit() {
  if (!CAM) return;
  CAM.resize();
  const p = curPart();
  if (p) CAM.fit(HubDraw.symBBox(p), 1.4); else CAM.draw();
  ST.fitPending = false;
}
/* enquadra se está pendente E o canvas já tem tamanho (pane escondido mede 0 — aí fica
   pendente e o render() da casca resolve quando a aba aparecer, como o libFit da casca) */
function fitSeNecessario() {
  if (!CAM) return;
  if (ST.fitPending && UI.cv.clientWidth > 0 && UI.cv.clientHeight > 0) fit(); else redraw();
}
function visible(cam) {
  const W = UI.cv.clientWidth, H = UI.cv.clientHeight;
  const a = CAM.toWorld(0, 0), b = CAM.toWorld(W, H);
  return { x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y), W, H };
}
function drawWorld(ctx, cam) {
  const sc = cam.scale, px = 1 / sc;
  const v = visible(cam);
  /* grade: fina no snap (só quando cabe, ≥ 5 px), forte a cada 10 passos em mil / a cada
     5 mm em mm (quando ≥ 8 px) — senão vira mancha */
  if (ST.grid) {
    const gridLines = (step, color, lw) => {
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = lw * px;
      for (let x = Math.floor(v.x1 / step) * step; x <= v.x2; x += step) { ctx.moveTo(x, v.y1); ctx.lineTo(x, v.y2); }
      for (let y = Math.floor(v.y1 / step) * step; y <= v.y2; y += step) { ctx.moveTo(v.x1, y); ctx.lineTo(v.x2, y); }
      ctx.stroke();
    };
    const fino = ST.snap, forte = ST.unit === 'mm' ? 5 * MM : ST.snap * 10;
    if (fino * sc >= 5) gridLines(fino, '#f0eedb', 1);
    if (forte * sc >= 8) gridLines(forte, HubDraw.SCH.grid, 1);
  }
  /* cruz da origem: é a âncora do componente na folha */
  ctx.beginPath(); ctx.strokeStyle = HubDraw.SCH.border; ctx.lineWidth = 1.5 * px;
  ctx.moveTo(-60, 0); ctx.lineTo(60, 0); ctx.moveTo(0, -60); ctx.lineTo(0, 60); ctx.stroke();

  const p = curPart(); if (!p) return;
  drawGraphics(ctx, p.graphics);
  drawPins(ctx, p.pins, px);
  const itens = selItems();
  for (const s of itens) drawHL(ctx, s.item, px);
  drawSel(ctx, itens, px);
  if (ST.draw) drawRubber(ctx, px);
}
/* os gráficos, desenhados aqui e não pelo HubDraw.drawSymbolPart (que é do agente/laser e usa
   cor fixa): a mesma geometria das 7 formas, com g.color/g.fill quando existem e as cores da
   casa (HubDraw.SCH) quando não. As miniaturas da paleta continuam com o drawSymbolPart. */
function drawGraphics(ctx, graphics, opts) {
  const o = opts || {}, C = HubDraw.SCH;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const g of (graphics || [])) {
    ctx.beginPath();
    ctx.lineWidth = g.w || 6;
    ctx.strokeStyle = o.stroke || (corValida(g.color) ? g.color : C.body);
    ctx.fillStyle = corValida(g.fill) ? g.fill : C.fill;
    const poly = () => (g.pts || []).forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    switch (g.g) {
      case 'rect': ctx.rect(g.x1, g.y1, g.x2 - g.x1, g.y2 - g.y1); if (g.solid) ctx.fill(); ctx.stroke(); break;
      case 'line': ctx.moveTo(g.x1, g.y1); ctx.lineTo(g.x2, g.y2); ctx.stroke(); break;
      case 'arc': ctx.arc(g.cx, g.cy, Math.abs(g.r || 0), (g.sa || 0) * Math.PI / 180, (g.ea == null ? 360 : g.ea) * Math.PI / 180); ctx.stroke(); break;
      case 'ellipse': ctx.ellipse(g.cx, g.cy, Math.abs(g.rx || 0), Math.abs(g.ry || 0), 0, 0, 2 * Math.PI); if (g.solid) ctx.fill(); ctx.stroke(); break;
      case 'poly': poly(); ctx.closePath(); if (g.solid) ctx.fill(); ctx.stroke(); break;
      case 'polyline': poly(); ctx.stroke(); break;
      case 'label': HubDraw.worldText(ctx, g.text || '', g.x, g.y, (g.size || 8) * 10, g.rot || 0, o.stroke || (corValida(g.color) ? g.color : C.text), 'center'); break;
    }
  }
}
/* o pino como o Altium o desenha: traço grosso saindo do corpo e, na ponta quente, o
   quadradinho com quatro pontos que marca onde o fio encosta (PIN_MARK de lado; os pontos
   ficam fora da faixa do traço, que tem 8 mil). Número por fora, nome por dentro — cada um
   só quando o pino não o esconde (hideNum/hideName do schlib-v2) */
function drawPins(ctx, pins, px) {
  const C = HubDraw.SCH, m = PIN_MARK / 2, q = PIN_MARK * 0.34, r = PIN_MARK * 0.08;
  for (const pin of (pins || [])) {
    const d = OD[norm360(pin.orient)] || [1, 0], h = pinHot(pin);
    ctx.strokeStyle = C.pin; ctx.lineWidth = 8; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(pin.x, pin.y); ctx.lineTo(h.x, h.y); ctx.stroke();
    ctx.lineWidth = Math.max(1.5, 1.1 * px);
    ctx.strokeRect(h.x - m, h.y - m, PIN_MARK, PIN_MARK);
    ctx.fillStyle = C.pin;
    for (const [ox, oy] of [[-q, -q], [q, -q], [-q, q], [q, q]]) { ctx.beginPath(); ctx.arc(h.x + ox, h.y + oy, r, 0, 2 * Math.PI); ctx.fill(); }
    if (!pin.hideNum) HubDraw.worldText(ctx, String(pin.num), (pin.x + h.x) / 2 + Math.abs(d[1]) * 30, (pin.y + h.y) / 2 + Math.abs(d[0]) * 30, 45, 0, C.pinnum, 'center');
    if (!pin.hideName && pin.name) {
      const vert = d[1] !== 0;
      const align = (d[0] > 0 || d[1] > 0) ? 'right' : 'left';
      HubDraw.worldText(ctx, pin.name, pin.x - d[0] * 15, pin.y - d[1] * 15, 45, vert ? 90 : 0, C.body, align);
    }
  }
}
/* o item marcado, retraçado na cor de destaque — fino: quem diz "selecionado" são as
   bordinhas do drawSel, o traço só mostra qual forma é */
function drawHL(ctx, it, px) {
  const hl = HubDraw.SCH.hl;
  ctx.save();
  if (it.g == null) {
    const h = pinHot(it);
    ctx.strokeStyle = hl; ctx.lineWidth = 8 + px; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(it.x, it.y); ctx.lineTo(h.x, h.y); ctx.stroke();
  } else if (it.g !== 'label') {
    const g = clone(it); g.solid = false;          /* mesma largura, só a cor muda */
    drawGraphics(ctx, [g], { stroke: hl });
  }
  ctx.restore();
}
/* as bordinhas, como na vista Esquema: caixa tracejada com alças nos cantos em cada item
   marcado (nas polilinhas, também em cada vértice) e a caixa de seleção enquanto é arrastada */
function drawSel(ctx, itens, px) {
  const hl = HubDraw.SCH.hl, hs = 3.5 * px, m = 6 * px;
  ctx.save();
  for (const s of itens) {
    const bb = itemBBox(s.item);
    const x = bb.x1 - m, y = bb.y1 - m, w = (bb.x2 - bb.x1) + 2*m, h = (bb.y2 - bb.y1) + 2*m;
    ctx.strokeStyle = hl; ctx.lineWidth = 1.5 * px; ctx.setLineDash([6 * px, 4 * px]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = hl;
    for (const [cx, cy] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) ctx.fillRect(cx - hs, cy - hs, 2*hs, 2*hs);
    if (s.item.pts) for (const p of s.item.pts) ctx.fillRect(p[0] - hs, p[1] - hs, 2*hs, 2*hs);
  }
  if (ST.box) {
    const r = ST.box;
    ctx.fillStyle = 'rgba(255,140,0,0.10)'; ctx.strokeStyle = hl; ctx.lineWidth = px;
    if (r.x2 < r.x1) ctx.setLineDash([5 * px, 4 * px]);     /* direita→esquerda: "quem encosta" */
    ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
    ctx.strokeRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
  }
  ctx.restore();
}
function drawRubber(ctx, px) {
  const d = ST.draw, m = ST.mouse; if (!d || !d.pts.length) return;
  const pts = d.pts.concat(m ? [[m.x, m.y]] : []);
  ctx.save();
  ctx.strokeStyle = HubDraw.SCH.hl; ctx.lineWidth = 2 * px; ctx.setLineDash([8*px, 5*px]);
  ctx.beginPath();
  const a = pts[0], b = pts[pts.length - 1];
  if (d.tool === 'rect') ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  else if (d.tool === 'arc') ctx.arc(a[0], a[1], Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, 0, 2*Math.PI);
  else if (d.tool === 'ellipse') ctx.ellipse(a[0], a[1], Math.abs(b[0] - a[0]) || 1, Math.abs(b[1] - a[1]) || 1, 0, 0, 2*Math.PI);
  else { pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); if (d.tool === 'poly' && pts.length > 2) ctx.closePath(); }
  ctx.stroke();
  ctx.fillStyle = HubDraw.SCH.hl;
  d.pts.forEach(pt => { ctx.beginPath(); ctx.arc(pt[0], pt[1], 3.5 * px, 0, 2*Math.PI); ctx.fill(); });
  ctx.restore();
}

/* ═══════════════════════ mouse: esquerdo seleciona e move, direito arrasta a tela ═══════════════════════
   O mkCamera (hub-draw.js) arrasta a tela com QUALQUER botão e não sabe de seleção. Em vez
   de mexer nele — e mudar junto o PCB, as previews da Biblioteca e o laser —, os eventos do
   botão esquerdo são interceptados aqui: ouvintes de CAPTURA, registrados ANTES da câmera
   existir, que param o evento ali (stopImmediatePropagation). O direito e o do meio passam
   direto e viram o pan de sempre; a roda continua sendo o zoom da câmera. É a mesma receita
   da vista Esquema (schframe.js). */
let lastDown = null;        /* o que o último mousedown acertou, para o Shift+clique saber se tira */
let swallowClick = false;   /* o click que fecha um arrasto não é um clique */
let panning = false;
let rightDown = null;       /* onde o direito desceu: parado fecha a polilinha, arrastado só pana */
let windowHooked = false;

const stepFor = kind => kind === 'pin' ? pinSnapOf(ST.snap, ST.unit) : ST.snap;
const snapPt = (w, kind) => { const s = stepFor(kind); return { x: snap(w.x, s), y: snap(w.y, s) }; };
const tol = () => Math.max(8, 8 / (CAM ? CAM.cam.scale : 1));
function worldOf(e) { const r = UI.cv.getBoundingClientRect(); return CAM.toWorld(e.clientX - r.left, e.clientY - r.top); }

function hookMouse() {
  const cv = UI.cv;
  cv.addEventListener('mousedown', e => {
    if (e.button !== 0) { panning = true; rightDown = { x: e.clientX, y: e.clientY }; cv.style.cursor = 'grabbing'; return; }
    e.stopImmediatePropagation();
    leftDown(e);
  }, true);
  cv.addEventListener('click', e => { e.stopImmediatePropagation(); leftClick(e); }, true);
  cv.addEventListener('contextmenu', e => {
    e.preventDefault();
    /* clique direito parado (< 3 px) fecha o que está sendo desenhado; arrasto direito foi pan */
    if (ST.draw && rightDown && Math.hypot(e.clientX - rightDown.x, e.clientY - rightDown.y) < 3) finishDraw();
    rightDown = null; panning = false; cursorPadrao();
  });
  if (windowHooked) return;
  windowHooked = true;
  window.addEventListener('mousedown', () => { panning = false; }, true);
  /* soltar o direito fora do canvas dispararia o menu do navegador em cima do painel */
  window.addEventListener('contextmenu', e => { if (panning) { e.preventDefault(); panning = false; cursorPadrao(); } });
  window.addEventListener('mousemove', e => { if (tileDrag) tileMove(e); if (ST.gesto) leftMove(e); });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) { tileUp(e); leftUp(e); return; }
    if (e.button !== 2) { panning = false; cursorPadrao(); }   /* o direito espera o contextmenu para zerar */
  });
  window.addEventListener('blur', () => {
    tileCancel();
    const d = ST.gesto; if (!d) return;
    if (d.mode === 'move') applyMove(d.base, 0, 0, 0, 0);
    ST.gesto = null; ST.box = null; redraw();
  });
}
/* posição de partida de cada item selecionado: o arrasto é sempre "base + delta", nunca
   acumulado, para o snap não andar sozinho */
function baseOf() { return selItems().map(s => ({ kind: s.kind, idx: s.idx, orig: clone(s.item) })); }
function applyMove(base, dx, dy, pdx, pdy) {
  const g = stepFor('g'), pn = stepFor('pin');
  for (const b of base) { const pin = b.kind === 'pin'; setItem(b, moveItem(b.orig, pin ? pdx : dx, pin ? pdy : dy, pin ? pn : g)); }
}
function leftDown(e) {
  swallowClick = false; lastDown = null;
  /* campo da ficha ainda com foco: o change dele só sairia no blur, depois de a seleção mudar
     aqui — força o blur agora para a edição cair no item que estava marcado */
  const ae = document.activeElement;
  if (ae && UI.aside.contains(ae)) ae.blur();
  if (!ST.draft || !CAM) return;
  const w = worldOf(e);
  if (ST.tool !== 'select') { ST.gesto = { mode: 'none', start: w, moved: false }; return; }
  const p = curPart(), h = hitTest(p, w.x, w.y, tol());
  if (!h) {
    ST.gesto = { mode: 'box', start: w, moved: false, shift: e.shiftKey };
    lastDown = null;
    return;
  }
  const wasSel = selHas(h);
  if (!wasSel) { if (!e.shiftKey) selClear(); selAdd(h); }
  lastDown = { key: selKey(h), wasSel, hit: h };
  /* vértice de polilinha/polígono só anda sozinho quando o item já estava marcado, sozinho */
  const vertex = (h.vertex != null && wasSel && ST.selection.length === 1) ? h.vertex : null;
  ST.gesto = { mode: 'move', start: w, moved: false, base: baseOf(), vertex, alvo: { kind: h.kind, idx: h.idx }, snap: snapshot() };
  refreshAside(); redraw();
}
function leftMove(e) {
  const d = ST.gesto, w = worldOf(e);
  const dx = w.x - d.start.x, dy = w.y - d.start.y;
  if (!d.moved && Math.hypot(dx, dy) * CAM.cam.scale < 3) return;   /* 3 px de folga: clique não vira arrasto */
  d.moved = true;
  if (d.mode === 'move') {
    if (d.vertex != null) { const s = snapPt(w, 'g'); setItem(d.alvo, moveVertex(d.base[0].orig, d.vertex, s.x, s.y)); }
    else { const g = stepFor('g'), pn = stepFor('pin'); applyMove(d.base, snap(dx, g), snap(dy, g), snap(dx, pn), snap(dy, pn)); }
    redraw();
  } else if (d.mode === 'box') { ST.box = { x1: d.start.x, y1: d.start.y, x2: w.x, y2: w.y }; redraw(); }
}
function leftUp() {
  const d = ST.gesto; if (!d) return;
  ST.gesto = null;
  swallowClick = d.moved;
  if (d.mode === 'move' && d.moved) {
    /* arrasto que voltou para a mesma grade não é mudança — não entra no undo */
    const p = curPart();
    const mudou = d.base.some(b => JSON.stringify(itemOf(p, b)) !== JSON.stringify(b.orig));
    if (mudou) { ST.undo.push(d.snap); ST.redo.length = 0; touched(); afterEdit(); } else redraw();
    return;
  }
  if (d.mode === 'box' && d.moved && ST.box) {
    const r = ST.box; ST.box = null;
    /* esquerda→direita pega só quem cabe inteiro; direita→esquerda pega quem encosta (como no Altium) */
    if (!d.shift) selClear();
    for (const h of itemsInBox(curPart(), r, r.x2 >= r.x1)) selAdd(h);
    refreshAside(); redraw();
    return;
  }
  ST.box = null; redraw();
}
function leftClick(e) {
  if (swallowClick) { swallowClick = false; return; }
  if (!ST.draft || !CAM) return;
  const w = worldOf(e), p = curPart();
  if (ST.tool === 'select') {
    /* vale o que o mousedown acertou: refazer o hitTest no mouseup, um ou dois px adiante,
       erraria um traço fino e desmarcaria o que o mousedown acabou de marcar */
    const h = lastDown ? lastDown.hit : null;
    if (!h) { if (!e.shiftKey) selClear(); refreshAside(); redraw(); return; }
    /* Shift em cima de quem já estava marcado tira da seleção */
    if (e.shiftKey && lastDown && lastDown.key === selKey(h) && lastDown.wasSel) selDel(h);
    refreshAside(); redraw();
    return;
  }
  if (ST.tool === 'delete') {
    const h = hitTest(p, w.x, w.y, tol());
    if (!h) return;
    ST.selection = [{ kind: h.kind, idx: h.idx }];
    deleteSelection();
    return;
  }
  colocar(w, e);
}
function move(w) {
  ST.mouse = ST.draw ? snapPt(w, ST.draw.tool === 'pin' ? 'pin' : 'g') : w;
  if (UI) { const s = snapPt(w, ST.tool === 'pin' ? 'pin' : 'g'); UI.coord.textContent = 'x ' + fmtUnit(s.x, ST.unit) + ' · y ' + fmtUnit(s.y, ST.unit) + ' ' + ST.unit; }
  if (ST.draw) redraw();
}
/* ferramentas de desenho: o clique põe o ponto */
async function colocar(w, e) {
  const p = curPart();
  const s = snapPt(w, ST.tool === 'pin' ? 'pin' : 'g');
  if (ST.tool === 'pin') {
    pushUndo();
    p.pins.push({ num: nextPinNum(p.pins), name: '', x: s.x, y: s.y, len: pinLenDefault(ST.snap, ST.unit), orient: ST.pinRot, type: 'Passive' });
    ST.selection = [{ kind: 'pin', idx: p.pins.length - 1 }];
    touched(); afterEdit();
    return;
  }
  if (ST.tool === 'label') {
    const txt = await pedirTexto('Texto', 'Texto do rótulo', '');
    if (txt == null || !txt.trim() || curPart() !== p) return;
    pushUndo();
    p.graphics.push({ g: 'label', x: s.x, y: s.y, text: txt.trim(), rot: 0, size: 10 });
    ST.selection = [{ kind: 'g', idx: p.graphics.length - 1 }];
    touched(); afterEdit();
    return;
  }
  /* ferramentas de dois cliques ou de vários pontos */
  if (!ST.draw) { ST.draw = { tool: ST.tool, pts: [[s.x, s.y]], at: Date.now() }; refreshBar(); redraw(); return; }
  const last = ST.draw.pts[ST.draw.pts.length - 1];
  if (last[0] === s.x && last[1] === s.y) return;        /* o segundo clique do duplo clique, sem jitter */
  const multi = ST.draw.tool === 'polyline' || ST.draw.tool === 'poly';
  /* detail ≥ 2 = o navegador já casou este clique com o anterior (mesmo lugar, a poucos px):
     em polilinha é o duplo clique que fecha, não um vértice novo. Só nas ferramentas de
     vários pontos — numa linha o segundo clique rápido é o segundo ponto de verdade. */
  if (multi && e && e.detail >= 2) return;
  ST.draw.pts.push([s.x, s.y]); ST.draw.at = Date.now();
  if (multi) { refreshBar(); redraw(); return; }
  finishDraw();
}
/* o primeiro clique do duplo clique pode ter entrado como vértice (quando o anterior já
   ficou velho para o navegador contar como detail 2): se foi há pouco e está colado no
   vértice anterior, é jitter — sai antes de fechar */
function descartaJitter() {
  const d = ST.draw; if (!d || d.pts.length < 2) return;
  if (Date.now() - (d.at || 0) > 500) return;
  const a = d.pts[d.pts.length - 2], b = d.pts[d.pts.length - 1], st = stepFor('g');
  if (Math.abs(a[0] - b[0]) <= st && Math.abs(a[1] - b[1]) <= st) d.pts.pop();
}
function finishDraw() {
  const d = ST.draw; if (!d) return;
  const p = curPart(), pts = d.pts, a = pts[0], b = pts[pts.length - 1];
  let g = null;
  if (d.tool === 'line' && pts.length >= 2) g = { g: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], w: 10 };
  /* rect/ellipse/poly nascem sem w: é a largura padrão do Altium (a mesma da maioria da
     lib); quem quiser outra escolhe na ficha */
  else if (d.tool === 'rect' && pts.length >= 2 && a[0] !== b[0] && a[1] !== b[1]) g = normRect({ g: 'rect', x1: a[0], y1: a[1], x2: b[0], y2: b[1], solid: true });
  else if (d.tool === 'arc' && pts.length >= 2) { const r = Math.hypot(b[0] - a[0], b[1] - a[1]); if (r > 0) g = { g: 'arc', cx: a[0], cy: a[1], r: r3(r), sa: 0, ea: 360, w: 10 }; }
  else if (d.tool === 'ellipse' && pts.length >= 2) { const rx = Math.abs(b[0] - a[0]), ry = Math.abs(b[1] - a[1]); if (rx && ry) g = { g: 'ellipse', cx: a[0], cy: a[1], rx, ry, solid: false }; }
  else if (d.tool === 'polyline' && pts.length >= 2) g = { g: 'polyline', pts: pts.map(x => x.slice()), w: 10 };
  else if (d.tool === 'poly' && pts.length >= 3) g = { g: 'poly', pts: pts.map(x => x.slice()), solid: true };
  ST.draw = null;
  if (!g) { refreshBar(); redraw(); return; }
  pushUndo();
  p.graphics.push(g);
  ST.selection = [{ kind: 'g', idx: p.graphics.length - 1 }];
  touched(); afterEdit();
}
function cancelDraw() { if (ST.draw) { ST.draw = null; refreshBar(); redraw(); } }
function setTool(id) { ST.tool = id; cancelDraw(); refreshBar(); }

/* ═══════════════════════ ações ═══════════════════════ */

function deleteSelection() {
  const p = curPart(); if (!p || !ST.selection.length) return;
  pushUndo();
  Object.assign(p, deleteItems(p, ST.selection));
  selClear(); touched(); afterEdit();
}
function duplicarSelecao() {
  const p = curPart(); if (!p || !ST.selection.length) return;
  pushUndo();
  const g = stepFor('g'), pn = stepFor('pin');
  const r = duplicateItems(p, ST.selection, g, 0 - g, pn, 0 - pn, g, pn);
  Object.assign(p, r.part); ST.selection = r.selection;
  touched(); afterEdit();
}
function girarTudo() {
  const p = curPart(); if (!p) return;
  pushUndo(); Object.assign(p, rotateAll(p)); touched(); afterEdit();
}
/* ═══ Partes de um componente ═══
   Um componente multi-parte do Altium (um quad op-amp, um rele com bobina e contatos) e
   uma lista de partes, cada uma com o SEU desenho. Trocar o desenho de uma parte ja
   funcionava — `aplicarLib()` aplica na parte ABERTA — mas nao havia como CRIAR parte,
   entao um componente com uma parte so ficava com uma para sempre.

   INVARIANTE, e nao e opcional: as partes tem que ser 1..N contiguas. O
   schlib_patch.aplica() recusa antes de escrever ("as partes tem que ser 1..%d, vieram
   %s") porque PartCount e uma CONTAGEM, nao uma lista: uma parte 3 sem a 2 ficaria fora
   dela e o Altium descartaria o desenho. Por isso excluir renumera. */
function novaParte() {
  const d = ST.draft; if (!d) return;
  if (!d.parts) d.parts = [];
  pushUndo();
  const n = d.parts.length + 1;
  d.parts.push({ part: n, pins: [], graphics: [] });
  d.partcount = d.parts.length;
  ST.part = n; ST.selection = []; ST.draw = null; ST.fitPending = true;
  touched(); refreshAll(); fitSeNecessario();
  if (O && O.toast) O.toast('parte ' + n + ' criada — escolha um corpo na faixa de baixo', 'ok');
}

async function excluirParte() {
  const d = ST.draft; if (!d || !d.parts || d.parts.length < 2) {
    if (O && O.toast) O.toast('um componente precisa de ao menos uma parte', 'warn');
    return;
  }
  const alvo = ST.part;
  const p = d.parts.find(x => x.part === alvo);
  const tem = p ? ((p.pins || []).length + (p.graphics || []).length) : 0;
  if (tem && !(await confirmar('Excluir a parte ' + alvo + '? Ela tem ' + tem + ' item(ns) desenhados.',
                               { title: 'Excluir parte', ok: 'Excluir', danger: true }))) return;
  pushUndo();
  d.parts = d.parts.filter(x => x.part !== alvo);
  /* renumera 1..N: sem isso sobraria um buraco e o patch recusaria a gravacao inteira */
  d.parts.forEach((x, i) => { x.part = i + 1; });
  d.partcount = d.parts.length;
  ST.part = Math.min(alvo, d.parts.length);
  ST.selection = []; ST.draw = null; ST.fitPending = true;
  touched(); refreshAll(); fitSeNecessario();
  if (O && O.toast) O.toast('parte ' + alvo + ' excluída — agora são ' + d.parts.length, 'ok');
}

/* Abre UM componente (valor) da familia para editar so o desenho dele. O rascunho vira
   o desenho do VALOR: parts proprias se ele ja tiver, senao uma copia das da familia —
   copia, nao referencia, senao editar o componente mexeria na familia inteira. */
async function abrirValor(nome) {
  const f = familiaAberta(); if (!f) return false;
  const v = valorPorNome(f, nome); if (!v) return false;
  if (ST.dirty) {
    const ok = await confirmar('Há edição não salva em "' + ST.sel + '". Descartar e abrir "' + nome + '"?',
                               { title: 'Descartar edição?', ok: 'Descartar', danger: true });
    if (!ok) return false;
  }
  ST.familia = f.name;
  ST.valSel = nome;
  ST.sel = nome;
  ST.draft = { name: nome, description: v.label || f.description || '',
               parts: clone(valorTemGeo(v) ? v.parts : (f.parts || [{ part: 1, pins: [], graphics: [] }])),
               footprints: clone(v.footprint ? [{ name: v.footprint, current: true }] : (f.footprints || [])) };
  ST.part = 1; ST.undo = []; ST.redo = []; ST.dirty = false; ST.selection = []; ST.draw = null; ST.note = '';
  ST.fitPending = true;
  refreshAll(); fitSeNecessario();
  return true;
}

/* Volta da edicao de um componente para a familia inteira. */
async function voltarParaFamilia() {
  const nome = ST.familia; if (!nome) return;
  if (ST.dirty && !(await confirmar('Há edição não salva em "' + ST.sel + '". Descartar?',
                                    { title: 'Descartar edição?', ok: 'Descartar', danger: true }))) return;
  ST.familia = null; ST.valSel = null; ST.dirty = false;
  await openSymbol(nome, true);
}

function abrirParte(n) {
  if (!ST.draft) return;
  ST.part = n; ST.selection = []; ST.draw = null; ST.fitPending = true; refreshAll(); fitSeNecessario();
}
/* o item marcado sai desta parte e entra no fim da outra; a seleção limpa (a outra parte não
   está na tela). O undo guarda todas as partes, então volta inteiro */
function moverParaParte(alvo, n) {
  const d = ST.draft, p = curPart(); if (!d || !p || !alvo || n === ST.part) return;
  const dest = (d.parts || []).find(x => x.part === n); if (!dest) return;
  const it = itemOf(p, alvo); if (!it) return;
  pushUndo();
  if (!dest.pins) dest.pins = []; if (!dest.graphics) dest.graphics = [];
  Object.assign(p, deleteItems(p, [alvo]));
  (alvo.kind === 'pin' ? dest.pins : dest.graphics).push(clone(it));
  ST.selection = []; touched(); afterEdit();
  if (O && O.toast) O.toast(tipoDe(it) + ' movido para a parte ' + n, 'ok');
}
/* K: linha vira pino, pino vira linha (parte C do brief) */
function virar() {
  const p = curPart(), s = selOnly(); if (!p || !s || ST.draw) return;
  const it = itemOf(p, s), v = viravel(it); if (!v) return;
  const r = v === 'linha' ? pinToLine(p, s.idx) : lineToPin(p, s.idx);
  if (!r) { if (O && O.toast) O.toast('a linha não tem comprimento — nada para virar', 'warn'); return; }
  pushUndo(); Object.assign(p, r.part); ST.selection = r.selection; touched(); afterEdit();
  if (r.aviso && O && O.toast) O.toast(r.aviso, 'warn');
}
/* símbolo da biblioteca solto no canvas: parte vazia recebe o corpo como "Aplicar ao símbolo"
   (na origem); parte com coisa recebe os gráficos e pinos INSERIDOS no ponto, todos marcados,
   para o usuário posicionar ou apagar o corpo antigo */
function soltarLib(s, w) {
  const p = curPart(); if (!s || !p) return;
  const toast = (m, k) => { if (O && O.toast) O.toast(m, k || 'ok'); };
  if (!p.pins.length && !p.graphics.length) {
    pushUndo();
    const r = applyLibSymbol(p, s);
    p.pins = r.part.pins; p.graphics = r.part.graphics;
    ST.note = r.note; ST.selection = []; touched(); afterEdit(); fit();
    toast('"' + s.name + '" aplicado ao símbolo — a parte estava vazia, o corpo entrou na origem');
    return;
  }
  const pt = snapPt(w, 'g');
  pushUndo();
  const r = insertLibSymbol(p, s, pt.x, pt.y);
  Object.assign(p, r.part); ST.selection = r.selection; touched(); afterEdit();
  const np = (s.pins || []).length, ng = (s.graphics || []).length;
  const lista = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1] : a.join('');
  toast('"' + s.name + '" inserido — ' + (np ? np + ' pino' + (np > 1 ? 's' : '') + ' entr' + (np > 1 ? 'aram' : 'ou') + ' com o' + (np > 1 ? 's' : '') + ' número' + (np > 1 ? 's' : '') + ' ' + lista(r.novos)
    + (r.renumerados.length ? ' (renumerado' + (r.renumerados.length > 1 ? 's' : '') + ': ' + lista(r.renumerados.map(x => x[0] + '→' + x[1])) + ')' : '') : 'sem pinos')
    + (ng ? ' · ' + ng + ' gráfico' + (ng > 1 ? 's' : '') : '') + ' — tudo selecionado');
}

/* ── arrastar um tile da paleta até o canvas ──
   Sem HTML5 drag-and-drop: ele não passa pelo canvas com precisão e briga com o mkCamera.
   É um arrasto próprio — mousedown no tile, mais de 4 px de movimento e um "fantasma" (o
   canvas do tile) segue o ponteiro; soltar em cima do canvas do editor entrega o símbolo. */
let tileDrag = null, tileDragged = false;
function tileDown(e, s, cv) {
  if (e.button !== 0) return;
  tileDragged = false;
  tileDrag = { id: s.id, x0: e.clientX, y0: e.clientY, cv, ghost: null, ativo: false };
}
function tileMove(e) {
  const t = tileDrag; if (!t) return;
  if (!t.ativo) {
    if (Math.hypot(e.clientX - t.x0, e.clientY - t.y0) <= 4) return;
    t.ativo = true;
    drawTile(t.cv);
    t.ghost = el('div', 'symed-ghost');
    const c = el('canvas'); c.width = t.cv.width; c.height = t.cv.height;
    try { c.getContext('2d').drawImage(t.cv, 0, 0); } catch (err) {}
    t.ghost.append(c); document.body.append(t.ghost);
    if (UI) UI.cv.style.cursor = 'copy';
  }
  e.preventDefault();
  t.ghost.style.left = (e.clientX + 8) + 'px'; t.ghost.style.top = (e.clientY + 8) + 'px';
}
function tileUp(e) {
  const t = tileDrag; if (!t) return;
  tileDrag = null;
  if (!t.ativo) return;
  tileDragged = true;            /* o click que fecha o arrasto não é um clique no tile */
  if (t.ghost) t.ghost.remove();
  cursorPadrao();
  if (!UI || !CAM || !ST.draft) return;
  const r = UI.cv.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
  soltarLib(libById(t.id), CAM.toWorld(e.clientX - r.left, e.clientY - r.top));
}
function tileCancel() { const t = tileDrag; tileDrag = null; if (t && t.ghost) t.ghost.remove(); if (t && t.ativo) cursorPadrao(); }
function espelharTudo() {
  const p = curPart(); if (!p) return;
  pushUndo(); Object.assign(p, mirrorAll(p)); touched(); afterEdit();
}
function nudge(dx, dy) {
  const p = curPart(); if (!p || !ST.selection.length) return;
  const g = stepFor('g'), pn = stepFor('pin');
  pushUndo(); Object.assign(p, moveItems(p, ST.selection, dx * g, dy * g, dx * pn, dy * pn, g, pn)); touched(); afterEdit();
}

async function salvar() {
  const d = ST.draft; if (!d || semServidor() || ST.saving) return;
  /* O /api/symbols/save so conhece o espelho Libs/schlib.js: para um simbolo do
     almoxarifado ele devolve 404 DEPOIS de a pessoa ter desenhado. Melhor dizer antes,
     e com o motivo. */
  if (!acervoGravavel()) {
    const alvo = ST.familia ? ('o componente “' + ST.sel + '” de ' + ST.familia)
                            : ('“' + acervoAtual().title + '”');
    setStatus('gravar ' + alvo + ' ainda não está ligado — hoje só o espelho do Altium', 'err');
    if (O && O.toast) O.toast('gravar em “' + acervoAtual().title + '” ainda não está ligado', 'warn');
    return;
  }
  const sym = serializeSymbol(d);
  const altium = !!(UI.altium && UI.altium.checked);
  setStatus('salvando' + (altium ? ' no espelho e no Altium…' : ' no espelho…'), '');
  /* a flag (e não só o nó do botão) porque qualquer edição durante o await refaz a ficha */
  ST.saving = true; UI.bSave.disabled = true;
  let status, j;
  try {
    ({ status, j } = await api('save', { name: sym.name, parts: sym.parts, description: sym.description, altium }));
  } finally { ST.saving = false; }
  /* o espelho em memória passa a ser o que foi gravado: reabrir o símbolo mostra a versão salva */
  const sincroniza = () => {
    const s = symByName(sym.name);
    if (s) { s.parts = clone(sym.parts); s.partcount = sym.partcount; s.description = sym.description; }
    ST.dirty = false; ST.saved.add(sym.name);
  };
  if (j && j.ok) {
    sincroniza();
    const avisos = (j.avisos || []).length ? ' · ' + j.avisos.join(' · ') : '';
    setStatus('salvo ' + new Date().toLocaleTimeString('pt-BR') + (j.altium ? ' — espelho + Altium' + (j.backup ? ' (backup: ' + j.backup.split(/[\\/]/).pop() + ')' : '') : ' — só o espelho') + avisos, 'ok');
    if (O && O.toast) O.toast('símbolo "' + sym.name + '" salvo' + (j.altium ? ' no espelho e na SchLib' : ' no espelho'), 'ok');
    if (O && O.onSaved) { try { O.onSaved(sym.name); } catch (e) {} }
    listKey = ''; refreshList(); refreshBar(); refreshAside();
    return;
  }
  const msg = (j && j.error) || ('HTTP ' + status);
  if (j && j.espelho && !j.altium) {
    /* o espelho já mudou: o Altium ficou para trás e é isso que o usuário precisa saber.
       O 423 (lib aberta no Altium) chega por aqui — o servidor grava o espelho antes de
       tentar a SchLib — e merece a dica de fechar a biblioteca */
    sincroniza();
    const ocupada = status === 423;
    setStatus('espelho salvo, mas a SchLib do Altium NÃO: ' + msg, 'err');
    if (O && O.toast) O.toast(ocupada ? 'espelho salvo; a biblioteca está aberta no Altium — feche e salve de novo'
                                      : 'espelho salvo; a SchLib do Altium ficou para trás — ' + msg, 'warn');
  } else {
    setStatus('não salvou: ' + msg, 'err');
    if (O && O.toast) O.toast('não salvou: ' + msg, 'err');
  }
  listKey = ''; refreshList(); refreshBar(); refreshAside();
}

function aplicarLib() {
  const s = libById(ST.libSel), p = curPart(); if (!s || !p) return;
  pushUndo();
  const r = applyLibSymbol(p, s);
  p.pins = r.part.pins; p.graphics = r.part.graphics;
  ST.note = r.note; ST.selection = []; touched(); afterEdit(); fit();
}
async function adicionarCorpo() {
  const p = curPart(); if (!p || semServidor()) return;
  if (!p.pins.length && !p.graphics.length) { O.toast('a parte está vazia — nada para guardar', 'warn'); return; }
  const sugerido = ST.draft.name.replace(/\[\s*(SMD|PTH)\s*\]/gi, '').replace(/\s+/g, ' ').trim();
  const name = await pedirTexto('Guardar corpo na biblioteca', 'Nome do corpo na biblioteca de símbolos', sugerido);
  if (name == null || !name.trim()) return;
  const sym = serializeSymbol({ name, parts: [p] }).parts[0];
  const { status, j } = await api('lib', { op: 'add', symbol: { name: name.trim(), kind: sym.pins.length <= 4 ? 'generico' : 'ci', pins: sym.pins, graphics: sym.graphics } });
  if (j && j.ok && j.symbol) {
    if (!DATA.symlib) { DATA.symlib = { symbols: [] }; DATA.symlibMissing = false; }
    DATA.symlib.symbols.push(j.symbol); ST.libSel = j.symbol.id; ST.libQ = ''; UI.libQ.value = '';
    refreshLib(); O.toast('"' + j.symbol.name + '" entrou na biblioteca de símbolos', 'ok');
    return;
  }
  if (status === 409 && j && j.symbol) { ST.libSel = j.symbol.id; refreshLib(); }
  O.toast((j && j.error) || ('não guardou (HTTP ' + status + ')'), status === 409 ? 'warn' : 'err');
}
async function renomearLib() {
  const s = libById(ST.libSel); if (!s || semServidor()) return;
  const name = await pedirTexto('Renomear', 'Novo nome', s.name);
  if (name == null || !name.trim() || name.trim() === s.name) return;
  const { status, j } = await api('lib', { op: 'rename', id: s.id, name: name.trim() });
  if (j && j.ok) { s.name = (j.symbol && j.symbol.name) || name.trim(); libKey = ''; refreshLib(); O.toast('renomeado', 'ok'); return; }
  O.toast((j && j.error) || ('não renomeou (HTTP ' + status + ')'), status === 409 ? 'warn' : 'err');
}
async function excluirLib() {
  const s = libById(ST.libSel); if (!s || semServidor()) return;
  const ok = await confirmar('Excluir "' + s.name + '" da biblioteca de símbolos? Se a extração o encontrar de novo, ele volta.', { title: 'Excluir da biblioteca', ok: 'Excluir', danger: true });
  if (!ok) return;
  const { status, j } = await api('lib', { op: 'delete', id: s.id });
  if (j && j.ok) { DATA.symlib.symbols = libSyms().filter(x => x.id !== s.id); ST.libSel = null; refreshLib(); O.toast('excluído', 'ok'); return; }
  O.toast((j && j.error) || ('não excluiu (HTTP ' + status + ')'), 'err');
}

/* ═══════════════════════ teclado ═══════════════════════ */

function ativo() { return !!(UI && UI.root.isConnected && UI.root.offsetParent !== null); }
function onKey(e) {
  if (!ativo() || modal) return;
  const tg = e.target, tag = tg && tg.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (tg && tg.isContentEditable)) return;
  const k = e.key, K = k.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && K === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (ctrl && (K === 'y' || (K === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
  /* sem símbolo aberto o Ctrl+R continua sendo o reload do navegador */
  if (ctrl && K === 'r' && ST.draft) { e.preventDefault(); girarTudo(); return; }
  if (ctrl && K === 'm' && ST.draft) { e.preventDefault(); espelharTudo(); return; }
  if (ctrl && K === 'd' && ST.draft) { e.preventDefault(); duplicarSelecao(); return; }
  if (ctrl) return;
  if (k === 'Escape') { if (ST.draw) cancelDraw(); else if (ST.tool !== 'select') setTool('select'); else { selClear(); refreshAside(); redraw(); } return; }
  if (k === 'Enter') { if (ST.draw) { e.preventDefault(); finishDraw(); } return; }
  /* com um desenho em curso, Delete, setas e K ficam de fora: agiriam na seleção antiga por
     baixo do traço que está sendo desenhado (o K, aliás, só na ferramenta Selecionar) */
  if (k === 'Delete' || k === 'Backspace') { if (ST.selection.length && !ST.draw) { e.preventDefault(); deleteSelection(); } return; }
  if (k.indexOf('Arrow') === 0) {
    if (!ST.selection.length || ST.draw) return;
    e.preventDefault();
    const m = e.shiftKey ? 10 : 1;
    nudge(k === 'ArrowLeft' ? -m : k === 'ArrowRight' ? m : 0, k === 'ArrowDown' ? -m : k === 'ArrowUp' ? m : 0);
    return;
  }
  if (K === 'r' && ST.tool === 'pin') { ST.pinRot = norm360(ST.pinRot + 90); refreshBar(); return; }
  if (K === 'f') { fit(); return; }
  if (K === 'k' && ST.draft && ST.tool === 'select' && !ST.draw) { e.preventDefault(); virar(); return; }
  const map ={ v: 'select', l: 'line', r: 'rect', p: 'polyline', g: 'poly', a: 'arc', e: 'ellipse', t: 'label', n: 'pin' };
  if (map[K] && ST.draft) { e.preventDefault(); setTool(map[K]); }
}

/* ═══════════════════════ API para a casca ═══════════════════════ */

function render(opts) {
  O = opts || O || {};
  const rootEl = O.root;
  if (!rootEl) return;
  if (!UI || UI.root !== rootEl) build(rootEl);
  /* a casca manda qual acervo esta escolhido no seletor do topo — o mesmo que a aba
     Sch Lib usa. Sem isto o painel ficava preso no espelho do Altium e o seletor, que
     aparece por cima dele, nao mudava nada aqui: a armadilha visual. */
  if (O.acervo) setAcervo(O.acervo);
  if (!DATA.schlib && !DATA.loading) loadSchlib().then(() => { listKey = ''; refreshAll(); if (ST.sel && !ST.draft) openSymbol(ST.sel, true); });
  if (!DATA.symlib && !DATA.libLoading) loadSymlib().then(() => { libKey = ''; refreshLib(); });
  /* a casca chama render() por troca de idioma, mudança no disco, goTab… se o usuário está
     digitando na ficha, refazer a aside apagaria o que ainda não passou pelo onchange. Um
     botão da toolbox com foco não conta: aí a ficha pode e deve acompanhar a seleção */
  const ae = document.activeElement;
  const digitando = !!ae && UI.aside.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
  refreshList(); refreshBar(); if (!digitando) refreshAside(); refreshLib();
  /* as larguras guardadas das colunas, depois o canvas mede e enquadra */
  if (UI.splits) UI.splits.aplica();
  CAM.resize();
  fitSeNecessario();
}
const dirty = () => !!ST.dirty;
/* ações sem DOM (afterEdit se cala sem UI) — é por aqui que o teste em Node prova que a
   seleção sobrevive a apagar e desfazer */
const actions = {
  novaParte, excluirParte, deleteSelection, duplicarSelecao, undo, redo, nudge, pushUndo, virar, setUnit };

/* a casca aplicou no espelho o que veio do Altium: o Libs/schlib.js em disco e outro. Zera a carga
   e reabre o simbolo que estava na tela ja com a versao nova; edicao nao salva se perde - quem chama
   (hub-libsync) ja avisou o usuario antes. */
function reload() {
  DATA.schlib = null; DATA.loading = null; DATA.schlibErro = '';
  ST.draft = null; ST.dirty = false; ST.selection = []; ST.undo = []; ST.redo = []; ST.draw = null;
  if (!UI) return Promise.resolve();
  return loadSchlib().then(() => { listKey = ''; refreshAll(); if (ST.sel) return openSymbol(ST.sel, true); });
}

/* Abrir um simbolo VINDO DE FORA (o "editar simbolo" do menu de contexto da aba Sch Lib).
   Nao serve mexer em `state.sel` de fora: o unico ponto que honra um ST.sel externo e o
   `.then` do PRIMEIRO loadSchlib dentro de render(), entao isso funcionaria uma vez — com
   a aba nunca aberta — e viraria no-op silencioso depois.
   Espera a schlib chegar antes de abrir, e devolve Promise porque openSymbol pode PARAR
   para perguntar se descarta a edicao nao salva: quem chama nao pode assumir que abriu. */
async function abrir(name, force) {
  if (!name) return false;
  /* loadSchlib() devolve a MESMA promessa quando ja ha uma carga em voo, entao isto
     cobre os dois casos: nunca carregou, e carregando agora. */
  if (!DATA.schlib) await loadSchlib().catch(() => {});
  listKey = '';
  await openSymbol(String(name), force);
  return ST.sel === String(name) && !!ST.draft;
}

/* TRES estados, de proposito: true = existe no espelho, false = nao existe, null = a
   schlib ainda nao foi carregada e portanto NAO DA PARA SABER. Um booleano so fazia a
   casca desabilitar "editar simbolo" toda vez que a aba Simbolos nunca tivesse sido
   aberta — que e justamente o caso comum de quem vem pelo menu de contexto. */
const conhece = name => (DATA.schlib ? !!symByName(String(name || '')) : null);

return { render, dirty, reload, pure, abrir, conhece, state: ST, actions, cam: () => (CAM ? CAM.cam : null), confirmar, pedirTexto };
});
