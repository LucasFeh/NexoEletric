/* AltiumPCBMirror v2 - hub-symed.js — editor de símbolos (sub-abas Componentes e Símbolos da
   Biblioteca: um editor só, em dois modos — ver `modo`).

   Três colunas com divisórias arrastáveis (o mkSplits da casca, como nas abas Laser e BOM):
   a lista à esquerda, o editor no meio e, à direita, a caixa de ferramentas em ícones e a
   ficha. No modo COMPONENTES a lista é a do espelho (que a Biblioteca esconde: ali manda a
   lista da casca) e o meio empilha o canvas e, embaixo, a Biblioteca de símbolos
   (Libs/symbols-lib.js) — corpos genéricos e de CI que se aplicam ao componente aberto com um
   clique, porque o que mais se quer ali é TROCAR O DESENHO sem mexer na pinagem. No modo
   SÍMBOLOS a lista da esquerda é a própria biblioteca de símbolos, a faixa de baixo some e o
   canvas edita o desenho de um símbolo dela.

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
   olho de visibilidade (hideNum/hideName, opcionais no schlib-v2). Pino novo — colocado
   pela ferramenta, vindo de uma linha (K) ou de um tile da biblioteca de símbolos — nasce
   com o NOME escondido: só o número à vista, como todo componente gerado do almoxarifado
   (o nome quase sempre repete o número); o olho o mostra quando fizer falta. K vira linha em pino e
   pino em linha; um tile da biblioteca arrastado para o canvas entra inserido (ou aplicado,
   se a parte está vazia). Os gráficos podem levar `color` (traço) e `fill` (área) — opcionais
   do schlib-v2, "#rrggbb" — e o canvas do editor os desenha ele mesmo; Preencher liga o
   `solid` (círculo completo vira elipse sólida, polilinha vira polígono).

   Coordenadas: mil, Y para cima, pino = ponta do CORPO em (x,y) e ponta quente em
   (x,y) + len·dir(orient) — o mesmo vocabulário schlib-v2 que hub-draw.js desenha. O mm é
   só interface: 1 mm = 39.37007874 mil, e tudo grava com 3 casas de mil. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hub-draw.js'), require('./hub-core.js'));
  else root.HubSymEd = factory(root.HubDraw, root.HubCore);
})(typeof self !== 'undefined' ? self : this, function (HubDraw, HubCore) {
"use strict";
/* normKey do HubCore, com queda para maiuscula crua: se algum dia alguem carregar este
   arquivo sem a casca, a pre-selecao perde o desempate por acento mas a aba nao morre. */
const nk = s => (HubCore && HubCore.normKey) ? HubCore.normKey(s) : String(s == null ? '' : s).toUpperCase();

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
/* espelha em X. A REGRA MORA NO HubDraw.mirrorPart — a mesma que a folha usa para desenhar
   componente espelhado —, para não existirem dois entendimentos de "espelhado" no hub: era
   assim que o desenho e a edição podiam divergir sem ninguém notar. Aqui só entra o que é
   do editor: retângulo volta normalizado (x1 < x2), invariante que o clique e a caixa de
   seleção assumem.
   A LEGENDA NÃO GIRA MAIS: o `rot = 180 - rot` de antes punha um rótulo de rot 0 em 180, de
   cabeça para baixo. Espelhar é virar a POSIÇÃO, não a letra — vale para o rótulo como vale
   para o nome e o número do pino. */
function mirrorAll(part) {
  const o = HubDraw.mirrorPart(part);
  (o.graphics || []).forEach(g => { if (g.g === 'rect') normRect(g); });
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

/* O que o pino DIZ de si: o nome, quando não é só número nem repete o número (A, K, B, C,
   E, +, VCC); senão o número, quando ele é letra (o LED do almoxarifado numera K e A);
   senão nada — o pino "1" que se chama "1" não diz polaridade nenhuma. */
function rotuloPino(p) {
  const nome = String(p && p.name != null ? p.name : '').trim().toUpperCase();
  const num = String(p && p.num != null ? p.num : '').trim().toUpperCase();
  if (nome && !/^\d+$/.test(nome) && nome !== num) return nome;
  if (num && !/^\d+$/.test(num)) return num;
  return '';
}
/* COMO OS PINOS DO SÍMBOLO CASAM COM OS DO COMPONENTE. O número, o nome e o olho de cada pino
   continuam os do componente — o que se decide é QUAL posição do desenho cada um ocupa.
     'nome'     os dois lados dizem o que cada pino é (A/K, B/C/E, G/D/S, +/−, VCC…), com o
                mesmo conjunto: casa pelo nome. É o único casamento que garante polaridade —
                medido nos dados: a família TRANSISTOR numera 1=C 2=B 3=E e o BC817 da
                biblioteca 1=B 2=E 3=C; o DIODO numera 1=A 2=K e há zener com 1=K 2=A.
     'numero'   nenhum lado diz nada (pinos "1", "2"): casa pelo número.
     'confira'  um lado diz e o outro não concorda (o tântalo "1","2" contra um símbolo com
                C/A; nomes que não são o mesmo conjunto): casa pelo número, ou pela ordem, e
                pede conferência — o "Aplicar à categoria" desmarca.
     'ordem'    ninguém diz nada e os números não batem: pela ordem, frágil (a biblioteca
                guarda os pinos ordenados por posição).
     'simbolo'  contagem diferente: sem pares — a pinagem viria do símbolo.
   O servidor tem a MESMA regra (tools/symbols/guardiao.py » casa_pinos): o lote e o clique
   têm de dar o mesmo desenho. */
function casaPinos(libPins, orig) {
  const L = libPins || [], O = orig || [];
  if (!L.length || L.length !== O.length) return { modo: 'simbolo', pares: [] };
  const unicos = a => new Set(a).size === a.length;
  const mesmo = (a, b) => a.slice().sort().join('\u0001') === b.slice().sort().join('\u0001');
  const kl = L.map(rotuloPino), ko = O.map(rotuloPino);
  if (kl.every(Boolean) && ko.every(Boolean) && unicos(kl) && unicos(ko) && mesmo(kl, ko)) {
    const por = new Map(O.map((o, i) => [ko[i], o]));
    return { modo: 'nome', pares: L.map((p, i) => [p, por.get(kl[i])]) };
  }
  const duvida = kl.some(Boolean) || ko.some(Boolean);
  const k = p => String(p.num == null ? '' : p.num).trim();
  const nl = L.map(k), no = O.map(k);
  if (unicos(nl) && unicos(no) && mesmo(nl, no)) {
    const porNum = new Map(O.map(o => [k(o), o]));
    return { modo: duvida ? 'confira' : 'numero', pares: L.map(p => [p, porNum.get(k(p))]) };
  }
  return { modo: duvida ? 'confira' : 'ordem', pares: L.map((p, i) => [p, O[i]]) };
}
/* troca o desenho da parte pelo da biblioteca. Contagem de pinos igual = a pinagem
   (número, nome, tipo, olho) é a do componente — casada pelo número, ou pela ordem quando
   os números não batem (casaPinos); o que muda é a geometria. */
function applyLibSymbol(part, libSym) {
  const pins = clone(libSym.pins || []), graphics = clone(libSym.graphics || []);
  const orig = part.pins || [];
  const casa = casaPinos(pins, orig);
  let note;
  if (casa.modo !== 'simbolo') {
    casa.pares.forEach(([p, o]) => {
      p.num = o.num; p.name = o.name; if (o.type) p.type = o.type;
      /* a visibilidade de número/nome é pinagem, não desenho: fica a do usuário */
      delete p.hideNum; delete p.hideName;
      if (o.hideNum) p.hideNum = true;
      if (o.hideName) p.hideName = true;
    });
    note = 'desenho trocado por "' + (libSym.name || '?') + '" — ' + pins.length + ' pino' + (pins.length > 1 ? 's' : '')
         + ' mantiveram número, nome e tipo'
         + (casa.modo === 'nome' ? ', casados pelo nome.'
          : casa.modo === 'ordem' ? ', casados pela ORDEM (os números não batem com os do símbolo): confira a polaridade.'
          : casa.modo === 'confira' ? ' — CONFIRA a polaridade: os nomes dos pinos do símbolo e do componente não dizem a mesma coisa.'
          : ', casados pelo número.');
  } else {
    /* a pinagem veio da biblioteca: quem não trouxer opinião de visibilidade cai no padrão —
       que hoje só esconde nome vazio ou igual ao número (comPadraoDeVisibilidade) */
    pins.forEach(comPadraoDeVisibilidade);
    note = 'desenho E pinagem vieram de "' + (libSym.name || '?') + '": o símbolo tinha ' + orig.length
         + ' pino' + (orig.length === 1 ? '' : 's') + ' e a biblioteca traz ' + pins.length + '. Confira os números.';
  }
  return { part: Object.assign({}, part, { pins, graphics }), note, modo: casa.modo };
}
/* O QUE O "APLICAR À CATEGORIA" MOSTRA. A categoria do dono ("capacitor eletrolítico") é a
   `familia` do almoxarifado, que se parte em mais de uma linha da lista da esquerda:
   CAPACITOR ELETROLITICO [PTH] (114 componentes) e [SMD] (46). Uma seção por linha, a ABERTA
   primeiro; as outras da mesma família vêm atrás, desmarcadas — a um clique, mas nunca por
   conta própria: numa família larga (CIRCUITO INTEGRADO tem 14 linhas) marcar tudo aplicaria
   um mesmo desenho a peças diferentes.
   Por componente: quantos pinos ele tem hoje (o desenho próprio, ou o da categoria que ele
   herda), como os pinos casariam (casaPinos) e se CABE — mesma contagem que o símbolo.
   NASCE MARCADO só o que é seguro: da seção aberta, que cabe, com os pinos casados pelo nome
   ou pelo número (não 'confira' nem 'ordem', que podem inverter a polaridade), e sem desenho
   próprio do gerador — o PNP da família TRANSISTOR e o conector por vias têm desenho próprio
   de propósito, e marcá-los punha a seta do NPN no PNP. O desenho próprio que VEIO de um
   símbolo da biblioteca (`vinculado(simbolo, componente)`) não conta como próprio.
   `placeholder`: a categoria de pinagem a definir não recebe desenho padrão.
   -> [{ simbolo, aberta, placeholder, linhas: [{componente, pinos, proprio, modo, cabe, marcado}] }] */
function planoCategoria(syms, fam, libSym, vinculado) {
  const nLib = ((libSym && libSym.pins) || []).length;
  const val = x => (x && x.valores) || [];
  const irmas = (syms || []).filter(x => x === fam
    || (fam && fam.familia && x.familia === fam.familia && val(x).length));
  irmas.sort((a, b) => (a === fam ? -1 : b === fam ? 1 : String(a.name).localeCompare(String(b.name))));
  return irmas.map(x => ({
    simbolo: x.name, aberta: x === fam,
    placeholder: /\[\s*PINAGEM A DEFINIR\s*\]\s*$/i.test(String(x.name || '')),
    linhas: val(x).map(v => {
      const nome = v.altium || v.label || '';
      const proprio = !!(v.parts && v.parts.length) && !(vinculado && vinculado(x.name, nome));
      const p0 = (((v.parts && v.parts.length) ? v.parts : x.parts) || [])[0] || {};
      const pins = p0.pins || [];
      const cabe = nLib > 0 && pins.length === nLib;
      const casa = casaPinos(libSym && libSym.pins, pins);
      const modo = casa.modo;
      /* COMO os pinos vão casar, para conferir de olho: "1 → +  2 → −" (o pino do componente
         e o que o símbolo desenha naquela posição) */
      const mapa = casa.pares.map(([p, o]) => String(o.num) + ' → ' + (rotuloPino(p) || String(p.num))).join('  ');
      return { componente: nome, pinos: pins.length, proprio, modo, cabe, mapa,
               marcado: x === fam && cabe && !proprio && (modo === 'nome' || modo === 'numero') };
    }),
  }));
}
/* próximo número livre: o maior numérico + 1 (pinos com letra, tipo "A1", não contam) */
function nextPinNum(pins) {
  let m = 0;
  for (const p of (pins || [])) { const n = parseInt(p.num, 10); if (String(n) === String(p.num).trim() && n > m) m = n; }
  return String(m + 1);
}
/* pino novo: número livre, sem nome, Passive — e com o NOME escondido (hideName). É o padrão
   de todos os componentes: o nome quase sempre repete o número, e à vista ele saía duas
   vezes ao lado de cada pino. O olho da ficha o mostra quando fizer falta. */
function novoPino(pins, x, y, len, orient) {
  return { num: nextPinNum(pins), name: '', x, y, len, orient, type: 'Passive', hideName: true };
}
/* pino que chega de um tile da biblioteca de símbolos (Libs/symbols-lib.js). ATÉ A
   REGENERAÇÃO DE 2026-09-11 a paleta não guardava visibilidade — o extrair.py descartava
   hideNum/hideName ao guardar um corpo — e todo pino chegava sem opinião, ganhando nome
   escondido. Agora o olho do pino vem junto, e "sem flag" deixou de significar "sem opinião":
   no schlib-v2 ausente quer dizer VISÍVEL. Esconder por padrão passou a apagar VCC/A/B/GND na
   hora de jogar o tile no canvas — a miniatura mostrava o nome e o canvas não, porque a
   miniatura desenha o símbolo da lib e o canvas desenha o que passou por aqui.
   O incômodo que criou o padrão continua real, mas só no caso que o motivava: nome vazio ou
   que apenas repete o número, que sairia duas vezes ao lado do pino. Nome de verdade fica à
   vista. Pino que já traz algum flag continua sendo respeitado. */
function comPadraoDeVisibilidade(p) {
  if (!('hideNum' in p) && !('hideName' in p)) {
    const n = String(p.name == null ? '' : p.name).trim();
    p.hideName = !n || n === String(p.num).trim();
  }
  return p;
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
  const pin = novoPino(part.pins, r3(corpo[0]), r3(corpo[1]), len, orient);
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
    const p = comPadraoDeVisibilidade(moveItem(src, x, y));
    if (usados.has(String(p.num).trim())) { const n = nextPinNum(pins); renumerados.push([String(p.num), n]); p.num = n; }
    usados.add(String(p.num).trim());
    selection.push({ kind: 'pin', idx: pins.length }); pins.push(p);
  }
  for (const src of (libSym.graphics || [])) { selection.push({ kind: 'g', idx: graphics.length }); graphics.push(moveItem(src, x, y)); }
  return { part: { pins, graphics }, selection, renumerados, novos: pins.slice(pins.length - (libSym.pins || []).length).map(p => p.num) };
}

/* ── busca da lista de símbolos ──
   O mesmo texto tem DUAS formas: a CRUA, que é o que o arquivo guarda e o que a coluna do
   nome mostra, e a de TELA, sem a marcação de ativo-baixo (R\S\T\ → RST). Consulta e
   palheiro entram nas duas e basta uma casar — é isso que faz "procurar pelo que está
   escrito na tela sempre achar", nos dois sentidos.
   Por que não só a forma de tela, como antes: as regras de barra NORMAL (/O/E, /CS) valem
   para o campo INTEIRO, e dentro de "nome + descrição" a barra fica de pé. Limpar só a
   consulta deixava "/O/E" digitado sem casar com o "/O/E" escrito numa descrição — e a
   symbols-lib acabou de ganhar descrição de verdade, então isso deixou de ser hipótese.
   Limpar nome e descrição SEPARADAMENTE (é
   assim que cada campo aparece na tela) faz o nome "/O/E" casar com quem digita o "OE" que
   lê; o palheiro guarda também o "nome + ' ' + descrição" cru, para a consulta que
   atravessa os dois campos continuar achando.
   E quem decide se HÁ consulta é o CRU: "\" limpava para "" e "" vale "passa tudo" — era
   assim que digitar uma barra listava o acervo inteiro. */
function filtroBusca(q, plain) {
  const txt = v => String(v == null ? '' : v);
  const limpo = v => txt(plain ? plain(txt(v)) : v);
  const uniq = a => a.filter((v, i) => a.indexOf(v) === i);
  const cru = txt(q).trim();
  if (!cru) return () => true;                       /* sem consulta: passa tudo */
  /* cru entra sempre: consulta não vazia nunca vira "passa tudo" por causa da limpeza */
  const alvos = uniq([cru, limpo(cru).trim()].filter(Boolean).map(t => t.toLowerCase()));
  return (nome, desc) => {
    const n = txt(nome), d = txt(desc);
    const hay = uniq([(n + ' ' + d).toLowerCase(), (limpo(n) + ' ' + limpo(d)).toLowerCase()]);
    return hay.some(h => alvos.some(a => h.indexOf(a) >= 0));
  };
}

/* ── busca da biblioteca de símbolos (Libs/symbols-lib.js) ──
   UMA regra para os dois lugares que listam a biblioteca: a faixa de baixo da vista
   Componentes e a lista da esquerda da vista Símbolos — senão a mesma consulta acharia uma
   coisa num e outra no outro. Casa nome, apelidos, kind e descrição, sem caixa. A descrição
   entra porque é o único jeito de achar símbolo cujo NOME é código de catálogo:
   "CMP-0694-00003-2" não diz nada, "RS-485" acha. Devolve uma lista nova, na ordem de entrada. */
function filtraSimbolos(syms, q) {
  const t = String(q == null ? '' : q).trim().toLowerCase();
  const todos = syms || [];
  if (!t) return todos.slice();
  return todos.filter(s => s && ((s.name || '') + ' ' + (s.aliases || []).join(' ') + ' ' + (s.kind || '')
    + ' ' + (s.description || s.desc || '')).toLowerCase().includes(t));
}

/* ── a faixa dirigida de fora: índice e cascata (puras, provadas em Node) ──
   DUAS PASSADAS de propósito: todo `name` primeiro, `aliases` só depois. Numa passada só, o
   apelido de um símbolo sequestra o nome próprio de outro — "Jumper" cairia em "Conector 2
   vias (Jumper)" e "Trimpot" em "Potenciômetro". */
function montaIdxLib(syms) {
  const porNome = new Map(), porChave = new Map(), todos = syms || [];
  const poe = n => n && !porNome.has(n);
  for (const s of todos) if (poe(s && s.name)) porNome.set(s.name, s);
  for (const s of todos) for (const a of (s && s.aliases) || []) if (poe(a)) porNome.set(a, s);
  for (const s of todos) for (const n of [s && s.name].concat((s && s.aliases) || [])) {
    if (!n) continue;
    const k = nk(n), l = porChave.get(k) || [];
    if (l.indexOf(s) < 0) l.push(s);
    porChave.set(k, l);
  }
  return { porNome, porChave };
}
/* O primeiro nome da lista que fechar em UM símbolo ganha. Medido nos acervos reais: só pelo
   nome do COMPONENTE fecha em 30 dos 2513 (1,2%); com a cascata componente → nome da família
   → raiz da família, 1215 (48,3%). No espelho do Altium, 299 de 401 (74,6%). É por isso que
   o alvo útil é a FAMÍLIA, e não o componente — o número decidiu, não o palpite.
   Devolve {s,how:'nome'|'alias'|'chave',nome} | {cands,how:'ambiguo',nome} | null. */
function alvoNaFaixa(idx, nomes) {
  let amb = null;
  for (const n of nomes || []) {
    if (!n) continue;
    const s = idx.porNome.get(n);
    if (s) return { s, how: s.name === n ? 'nome' : 'alias', nome: n };
    const l = idx.porChave.get(nk(n)) || [];
    if (l.length === 1) return { s: l[0], how: 'chave', nome: n };
    /* empate NÃO encerra a cascata: o componente empata e a família costuma desempatar */
    if (l.length > 1 && !amb) amb = { cands: l.slice(), how: 'ambiguo', nome: n };
  }
  return amb;
}

const pure = { snap, pinHot, pinSnapOf, pinsOffGrid, segDist, pointInPoly, angleIn, labelBox, hitTest, hitGraphic,
               filtroBusca, filtraSimbolos,
               moveItem, moveVertex, rotateAll, mirrorAll, bbox, serializeSymbol, applyLibSymbol, nextPinNum, novoPino,
               casaPinos, rotuloPino, planoCategoria,
               comPadraoDeVisibilidade, montaIdxLib, alvoNaFaixa,
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
  /* a faixa dirigida de fora, pelo "Editar simbolo" da vista Esquema */
  libIds: null,       /* restringe a faixa a estes ids (empate); null = biblioteca inteira */
  faixaNota: '',      /* a frase ao lado da contagem: por que ESTE tile esta marcado */
  faixaScroll: null,  /* id a rolar para dentro da vista no proximo refreshLib */
  familia: null,      /* nome da familia quando ST.draft e o desenho de UM valor dela */
  unit: 'mm',         /* unidade da interface (mm | mil); o estado continua em mil */
  snap: UNIT_DEFAULT.mm, grid: true, draw: null, mouse: null, pinRot: 0, note: '', fitPending: false,
  saved: new Set(),   /* salvos nesta sessão; "modificado" = salvo ou o aberto com edição */
  saving: false,      /* POST /save em voo: o botão fica travado mesmo que a ficha seja refeita */
  cam: null,          /* o {scale,cx,cy} da câmera, para quem quer conferir o pan por fora */
  box: null,          /* caixa de seleção em curso (mundo) */
  gesto: null,        /* gesto do botão esquerdo em curso */
  /* o MODO do editor, que é a sub-aba da Biblioteca em que ele está (ver `modo`):
     'componentes' (categoria/componente no canvas) | 'simbolos' (símbolo da biblioteca) */
  modo: 'componentes',
  qSim: '',           /* o filtro da lista de símbolos (modo símbolos); o ST.q é o da outra */
  ultimoLib: null,    /* o símbolo que estava aberto ao sair do modo símbolos: volta com ele */
  /* EDITANDO UM SÍMBOLO DA BIBLIOTECA (Libs/symbols-lib.js), e não um componente: o canvas
     mostra o desenho do símbolo e o Salvar grava na biblioteca (/api/symbols/lib). Símbolo
     não é componente (o dono, 2026-09-25): o componente só RECEBE o desenho, pelo Aplicar.
     Só existe no modo símbolos. { id: 'sNNNN' | null (novo, ainda não salvo) } */
  libEd: null,
  edicoes: 0,         /* conta cada edição (touched): o salvarLib sabe se mexeram durante o POST */
};
/* schlibErro / symlibMissing: carga que falhou fica como null (não como lista vazia) para o
   próximo render() tentar de novo — senão um 404 vira "0 símbolos" até o F5 */
const DATA = { schlib: null, symlib: null, loading: null, libLoading: null, bust: 0, schlibErro: '', symlibMissing: false,
               acervo: null, loadingId: null, cache: {},
               /* quem usa cada símbolo da biblioteca, pelo ledger (/api/symbols/lib-vinculos):
                  { porLib: Map(id → {n, cats:Set}), porComp: Map(categoria␁componente → id),
                    pads: {categoria: id} }. `vincVer` entra na chave do cache dos tiles. */
               vinc: null, vincVer: 0,
               /* a promessa do reload() em curso (null fora dele) — ver aposRecarga */
               recarga: null };
/* A RECARGA QUE A PRÓPRIA GRAVAÇÃO DISPARA: a casca chama reload() a cada escrita em Libs\, e
   por cerca de um segundo a biblioteca e a mesa estão voltando. Os botões de aplicar continuam
   destravados (a faixa é a de antes), e um clique nesse meio achava o tile marcado sem símbolo
   e saía calado — medido: o "Aplicar à categoria" logo depois de um Salvar não abria nada.
   O clique espera a recarga e então age sobre o que voltou. Espera TODAS: uma gravação escreve
   vários arquivos (a .SchLib, o ledger, o backup), a casca pode recarregar mais de uma vez em
   seguida, e agir entre uma e outra é cair de novo na biblioteca zerada. */
const aposRecarga = fn => async (...a) => {
  for (let r = DATA.recarga; r; r = DATA.recarga) {
    await r.catch(() => {});
    if (DATA.recarga === r) break;        /* a mesma: o fim dela é que zera o campo */
  }
  return fn(...a);
};
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
  /* ACERVO COMBINADO ("Almoxarifado — Todos"): não tem arquivo próprio — carrega o de cada
     parte e concatena numa lista só, a mesma receita da aba Biblioteca (hub.html » carregaSch).
     Sem isto o editor recebia `file: null`, o loadVarScript falhava e a aba Símbolos (hoje Componentes) dizia
     "não carregou" justamente no acervo que junta básicos e especiais. */
  const partes = (a.partes && a.partes.length) ? a.partes : null;
  const vem = partes
    ? Promise.all(partes.map(x => loadVarScript(x.file, x.varName))).then(as => {
        const syms = as.reduce((acc, x) => acc.concat((x && x.symbols) || []), []);
        return syms.length ? { symbols: syms, title: a.title,
                               generated: (as.find(x => x && x.generated) || {}).generated || '' } : null;
      })
    : loadVarScript(a.file, a.varName);
  DATA.loading = vem.then(v => {
    const ok = v && v.symbols ? v : null;
    if (ok) DATA.cache[a.id] = ok;
    DATA.schlib = ok;
    DATA.schlibErro = ok ? '' : ('não carregou ' + (partes ? partes.map(x => x.file).join(' + ') : a.file)
      + ' — o servidor está de pé? (troque de aba para tentar de novo)');
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
  /* o simbolo aberto e de outro acervo: nao faz sentido continuar com ele na tela. O simbolo
     da BIBLIOTECA (modo simbolos) nao e de acervo nenhum: esse fica, com a edicao dele */
  if (ST.modo === 'simbolos') return true;
  ST.sel = null; ST.draft = null; ST.selection = []; ST.undo = []; ST.redo = []; ST.dirty = false;
  return true;
}
function loadSymlib() {
  if (DATA.symlib) return Promise.resolve(DATA.symlib);
  if (!DATA.libLoading) DATA.libLoading = loadVarScript('Libs/symbols-lib.js', 'symbolsLib').then(v => {
    DATA.symlib = v && v.symbols ? v : null;
    /* DOIS FORMATOS, UM NOME. O symlib-v1 grava o campo como `desc`; o schlib-v2 — e toda a
       tela, daqui e do hub — lê `description`. Eram 727 descrições invisíveis por causa de
       uma letra. Normaliza na carga, que é o único ponto por onde os 897 passam. */
    IDXLIB = null;
    if (DATA.symlib) DATA.symlib.symbols.forEach(x => { if (x.desc && !x.description) x.description = x.desc; });
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
/* a categoria em que se está trabalhando — o alvo do "Aplicar símbolo à categoria". Até
   2026-10-09 podia ser também a de onde se tinha vindo editar um símbolo; desde que editar
   símbolo virou a vista Símbolos, aplicar só existe na vista Componentes, com ela aberta. */
function familiaDoContexto() {
  return familiaAberta();
}
/* há um COMPONENTE no canvas para receber o desenho de um símbolo? No almoxarifado é o valor
   aberto (ST.familia); na biblioteca da casa o símbolo do espelho É o componente. A categoria
   do almoxarifado sozinha não conta: ela recebe pelo "Aplicar símbolo à categoria". */
const componenteAberto = () => ST.modo === 'componentes' && !ST.libEd && !!ST.draft
  && (!!ST.familia || acervoGravavel());
/* o nome do que está no canvas, para as perguntas ("há edição não salva em X") */
const nomeAberto = () => (ST.draft && ST.draft.name) || ST.sel || '';
const valoresDa = f => (f && f.valores) || [];
const nomeDoValor = v => (v && (v.altium || v.label)) || '';
const valorPorNome = (f, n) => valoresDa(f).find(v => nomeDoValor(v) === n) || null;
/* o valor tem desenho proprio, ou herda o da familia? */
const valorTemGeo = v => !!(v && v.parts && v.parts.length);
/* os produtos do Odoo que estão em mais de um componente do acervo aberto (a regra é do
   HubAlmoxPick.duplicadosOdoo). Refeito só quando a LISTA muda: o loadSchlib troca o array a
   cada carga, e são ~3500 valores para varrer a cada repintura da faixa. */
let DUPS = { de: null, m: new Map() };
function duplicadosDoAcervo() {
  const syms = symbols();
  if (DUPS.de !== syms)
    DUPS = { de: syms, m: (typeof HubAlmoxPick !== 'undefined' && HubAlmoxPick.duplicadosOdoo)
                          ? HubAlmoxPick.duplicadosOdoo(syms) : new Map() };
  return DUPS.m;
}
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
function touched() { ST.dirty = true; ST.edicoes++; }
const isMod = name => ST.saved.has(name) || (ST.dirty && ST.sel === name);
const nMod = () => ST.saved.size + (ST.dirty && ST.sel && !ST.saved.has(ST.sel) ? 1 : 0);
function undo() { if (!ST.undo.length) return; ST.redo.push(snapshot()); restore(ST.undo.pop()); touched(); afterEdit(); }
function redo() { if (!ST.redo.length) return; ST.undo.push(snapshot()); restore(ST.redo.pop()); touched(); afterEdit(); }
function afterEdit() { refreshBar(); refreshAside(); redraw(); }

/* A LINHA DE STATUS é do que está aberto: abrir OUTRA coisa de propósito a limpa (o "salvo"
   do símbolo não pode aparecer na categoria para onde se voltou). Quem reabre a MESMA coisa —
   o reload que a casca dispara a cada gravação, o Aplicar que reabre para mostrar o desenho
   novo — passa `manter`, senão apagaria o resultado que acabou de chegar. */
function limpaStatusSe(outra, manter) { if (UI && outra && !manter) setStatus('', ''); }
async function openSymbol(name, force, manter) {
  /* com um COMPONENTE aberto, ST.sel e o nome dele; pedir a familia de mesmo nome tem que
     passar, senao nao ha volta da edicao do componente para a da familia */
  if (ST.sel === name && ST.draft && !ST.familia && !ST.libEd) return;
  if (ST.dirty && !force) {
    const ok = await confirmar('Há edição não salva em "' + nomeAberto() + '". Descartar e abrir "' + name + '"?', { title: 'Descartar edição?', ok: 'Descartar', danger: true });
    if (!ok) return;
  }
  const s = symByName(name);
  /* Abrir da LISTA LATERAL e sempre abrir um simbolo/familia — nunca um componente. Sem
     zerar isto, depois de editar "(TVS) CDSOT23-SM712" o ST.familia continuava valendo,
     familiaAberta() devolvia a familia velha e clicar em outro simbolo na lista nao
     trocava nada na faixa de componentes nem na ficha. Idem o símbolo da biblioteca em
     edição: abrir uma categoria sai dele. */
  limpaStatusSe(nomeAberto() !== name || !!ST.libEd, manter);
  ST.familia = null; ST.valSel = null; ST.libEd = null;
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
    const d = el('div', 'dialog symed-dlg' + (o.larga ? ' symed-dlg-larga' : ''));
    d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
    d.append(el('h3', null, o.title));
    if (o.msg) d.append(el('p', null, o.msg));
    let inp = null;
    if (o.input) {
      const lab = el('label', null, o.input.label);
      inp = el('input', 'input'); inp.type = 'text'; inp.value = o.input.valor || '';
      lab.append(inp); d.append(lab);
    }
    /* um corpo próprio (a lista do "Aplicar à categoria"): `o.corpo` é o nó, `o.ler()` o valor
       que o OK devolve, e `o.monta({bo})` deixa o corpo mandar no botão OK (rótulo, travado) */
    if (o.corpo) d.append(o.corpo);
    const act = el('div', 'acts');
    const bc = el('button', 'btn btn-ghost', o.cancel || 'Cancelar'); bc.type = 'button';
    const bo = el('button', 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary'), o.ok || 'OK'); bo.type = 'button';
    act.append(bc, bo); d.append(act); bd.append(d);
    if (typeof o.monta === 'function') o.monta({ bo, d });
    const nada = (inp || o.corpo) ? null : false;
    let feito = false, mo = null;
    const fecha = v => {
      if (feito) return; feito = true;
      document.removeEventListener('keydown', tecla, true);
      if (mo) mo.disconnect();
      bd.remove(); modal = null;
      if (antes && typeof antes.focus === 'function') try { antes.focus(); } catch (e) {}
      resolve(v);
    };
    const confirma = () => { if (bo.disabled) return; fecha(inp ? inp.value : (typeof o.ler === 'function' ? o.ler() : true)); };
    /* em captura, parando também os ouvintes irmãos: o Esc não pode chegar ao Esc da casca (que
       esvazia o #overlay) nem ao do editor. Enter em cima do Cancelar cancela — quem chegou lá
       por Tab e apertou Enter quis o botão, não o OK. E o Tab roda só dentro do diálogo: atrás
       do backdrop os botões da página continuam vivos para o teclado. Com corpo próprio, o Tab
       passa por tudo que é focável dentro dele (as caixas de marcar) */
    const foco = () => (o.corpo
      ? [...d.querySelectorAll('input, button, select, textarea')].filter(x => !x.disabled && x.offsetParent !== null)
      : [inp, bc, bo].filter(Boolean));
    const tecla = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fecha(nada); }
      else if (e.key === 'Enter') {
        const a = document.activeElement;
        e.stopImmediatePropagation();
        /* COM CORPO PRÓPRIO o Enter só confirma EM CIMA DO OK. Num botão do corpo ("Desmarcar
           todos") ele aperta aquele botão — o clique nativo, sem preventDefault —, e numa
           caixa de marcar não faz nada. Confirmar ali disparava o lote do "Aplicar à
           categoria" (regravando a .SchLib de 114 componentes) com o foco em "Desmarcar". */
        if (o.corpo && a && d.contains(a) && a !== bo && a !== bc) { if (a.tagName !== 'BUTTON') e.preventDefault(); return; }
        e.preventDefault();
        if (a === bc) fecha(nada); else confirma();
      }
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
    (inp || (bo.disabled ? bc : bo)).focus(); if (inp) inp.select();
  });
}
async function confirmar(msg, o) { o = o || {}; return !!(await abreModal({ title: o.title || 'Confirmar', msg, ok: o.ok, danger: o.danger })); }
async function pedirTexto(title, label, valor) { const v = await abreModal({ title, input: { label, valor }, ok: 'OK' }); return v == null ? null : v; }

/* ═══════════════════════ DOM ═══════════════════════ */

const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
/* nome de pino ativo-baixo (R\S\T\ → RST com barra em cima). Quem carrega o hub-overbar.js
   é a casca, e ele pode chegar DEPOIS deste arquivo: procura de cada vez, nunca referência
   guardada. Sem ele o painel abre igual, só mostrando a notação crua — como antes. */
const OVB = () => (typeof HubOverbar !== 'undefined' && HubOverbar) || null;
const semBarra = t => { const o = OVB(); return o ? o.plain(t) : String(t == null ? '' : t); };
const btn = (cls, txt, on, title) => { const b = el('button', 'btn ' + cls, txt); b.type = 'button'; b.onclick = on; if (title) b.title = title; return b; };
const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* O CSS DA FERRAMENTA DE SÍMBOLOS mora aqui, e não nas cascas: o hub.html da web e o do
   desktop são diferentes de propósito, e o que o editor desenha é igual nos dois. O resto do
   CSS do editor continua nas cascas (é anterior a esta regra).
   SEM CRASE NESTE BLOCO: ele vive num template literal, e uma crase num comentário fecha a
   string — o módulo inteiro morre (e o node --check passa). */
const CSS = `
.symed-dlg.symed-dlg-larga{width:min(760px,100%);}
.symed-apl-topo{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-size:12px;color:var(--text-3,#9a9a9a);}
.symed-apl-topo .n{margin-left:auto;color:var(--text-2,#b8b8b8);}
.symed-apl-topo .btn{min-height:24px;padding:2px 10px;font-size:12px;}
.symed-apl{max-height:min(50vh,440px);overflow:auto;border:1px solid var(--line,#3a3a3a);border-radius:6px;}
.symed-apl-sec + .symed-apl-sec{border-top:1px solid var(--line,#3a3a3a);}
.symed-dlg label.symed-apl-cab{position:sticky;top:0;z-index:1;flex-direction:row;align-items:center;gap:8px;
  padding:6px 10px;background:var(--surface-2,var(--surface,#26282c));font-size:12px;font-weight:600;
  color:var(--text,#d8d8d8);cursor:pointer;}
.symed-apl-cab .q{margin-left:auto;font-weight:400;font-size:11px;color:var(--text-4,#7a7a7a);}
.symed-dlg label.symed-apl-lin{flex-direction:row;align-items:baseline;gap:8px;padding:3px 10px 3px 30px;
  font-size:12px;color:var(--text-2,#b8b8b8);cursor:pointer;}
.symed-apl-lin:hover{background:rgba(var(--tint,79,195,247),.06);}
.symed-apl-lin .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.symed-apl-lin .mt{margin-left:auto;display:flex;gap:8px;font-size:10px;color:var(--text-4,#7a7a7a);white-space:nowrap;}
.symed-apl-lin .mt .av{color:var(--warn,#ffb74d);}
.symed-apl-conf{padding:4px 10px 6px 30px;font-size:11px;line-height:1.45;color:var(--warn,#ffb74d);
  font-family:var(--mono,Consolas,ui-monospace,monospace);white-space:pre-wrap;}
.symed-apl-lin.nao .nm{color:var(--text-4,#7a7a7a);}
.symed-dlg label.symed-apl-pad{flex-direction:row;align-items:flex-start;gap:8px;font-size:12px;line-height:1.45;
  color:var(--text-3,#9a9a9a);cursor:pointer;}
.symed-libmark{display:inline-block;margin-right:6px;padding:0 7px;border:1px solid var(--hi,#4fc3f7);border-radius:999px;
  font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--hi,#4fc3f7);vertical-align:1px;}
.symed-libnota{font-size:11px;color:var(--text-4,#7a7a7a);margin:2px 0 8px;line-height:1.45;}
.symed-comp .mt .lib{color:var(--hi,#4fc3f7);}
.symed-comp .mt .dup{color:var(--warn,#ffb74d);}
/* MODO SIMBOLOS (a vista Simbolos da Biblioteca): a faixa de baixo some. A lista da esquerda
   e a biblioteca de simbolos, e aplicar desenho a componente e coisa da vista Componentes */
.symed-modo-simbolos .symed-libbar,.symed-modo-simbolos .symed-tiles{display:none !important;}
/* a linha da lista de simbolos: a miniatura (o mesmo desenho do tile da faixa) e o nome */
.symed-librow{gap:9px;padding:3px 8px;}
.symed-librow canvas{flex:none;width:54px;height:36px;border-radius:3px;background:var(--sheet,#fff);
  box-shadow:inset 0 0 0 1px var(--edge,rgba(255,255,255,.08));}
.symed-librow.editado .nm::after{content:" ●";color:var(--warn,#ffb74d);}
.symed-librow.novo .nm{font-style:italic;}
.symed-novosim{white-space:nowrap;}
/* o .btn tem display proprio, que ganharia do atributo hidden (a armadilha do .seg na casca) */
.symed-novosim[hidden]{display:none !important;}
.symed-libacts{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px;}
`;
let cssPosto = false;
function poeCss() {
  if (cssPosto || typeof document === 'undefined') return;
  cssPosto = true;
  const st = document.createElement('style');
  st.id = 'symed-css'; st.textContent = CSS;
  document.head.appendChild(st);
}
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
  poeCss();
  UI = { root: rootEl };
  rootEl.textContent = '';
  try { const u = localStorage.getItem(UNIT_KEY); if (u === 'mm' || u === 'mil') { ST.unit = u; ST.snap = UNIT_DEFAULT[u]; } } catch (e) {}
  const grid = el('div', 'symed-grid');

  /* ── esquerda: busca · recorte · kicker · resumo · lista ──
     A mesma coluna serve aos dois modos, cada um com o seu filtro: no modo componentes é a
     lista do espelho (que a Biblioteca esconde) e no modo símbolos a da biblioteca de
     símbolos, com o "+ Novo símbolo" no lugar do recorte Tudo/Sem fp/Modificados. */
  const left = el('div', 'lib-left');
  const bar = el('div', 'lib-bar');
  UI.q = el('input', 'input'); UI.q.type = 'text';
  UI.q.oninput = () => { if (ST.modo === 'simbolos') ST.qSim = UI.q.value; else ST.q = UI.q.value; refreshList(); };
  UI.seg = el('div', 'seg');
  UI.bNovoSim = btn('btn-primary btn-sm symed-novosim', '+ Novo símbolo', novoSimbolo, '');
  bar.append(UI.q, UI.seg, UI.bNovoSim);
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
    /* quem digita quer a biblioteca inteira de volta: o filtro por id e a nota saem */
    ST.libIds = null; ST.faixaNota = '';
    if (ST.faixa === 'componentes') ST.valQ = UI.libQ.value; else ST.libQ = UI.libQ.value;
    libKey = ''; refreshLib();
  };
  UI.libCount = el('span', 'count', '');
  const lr = el('div', 'right');
  /* NESTA FAIXA SÓ SE APLICA (pedido do dono, 2026-10-09: "o único botão na aba do menu
     central agora é aplicar símbolo ao componente e aplicar símbolo à categoria"). Criar,
     editar, renomear e excluir símbolo moraram aqui de 2026-09-25 até então e foram para a
     vista Símbolos. Os dois botões nunca somem: travados, dizem por quê (pintaBotoesLib). */
  UI.bLibApply = btn('btn-primary btn-sm', 'Aplicar símbolo ao componente', aposRecarga(aplicarLib), '');
  UI.bLibCat = btn('btn-secondary btn-sm', 'Aplicar símbolo à categoria…', aposRecarga(() => abrirAplicarCategoria(libById(ST.libSel))), '');
  lr.append(UI.bLibApply, UI.bLibCat);
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
      ST.faixa = k; ST.libIds = null; ST.faixaNota = ''; libKey = '';
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
  /* miniaturas só quando aparecem: 400 canvases de uma vez travam a aba. Um observador para a
     faixa e outro para a lista da vista Símbolos (~900 linhas), cada um com a sua raiz */
  const io = (raiz, margem) => typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(ents => ents.forEach(e => { if (e.isIntersecting) drawTile(e.target); }), { root: raiz, rootMargin: margem || '0px' })
    : null;
  UI.io = io(UI.tiles);
  /* a lista rola mais depressa que a faixa: a margem deixa a linha chegar já desenhada */
  UI.ioList = io(UI.list, '160px');
  pintaModo();
  document.addEventListener('keydown', onKey);
}

/* ═══════════════════════ atualizações ═══════════════════════ */

function refreshAll() { refreshList(); refreshBar(); refreshAside(); refreshLib(); redraw(); }

let listKey = '';
function refreshList() {
  if (!UI) return;
  if (ST.modo === 'simbolos') return refreshListaSimbolos();
  const syms = symbols();
  /* o acervo ENTRA na chave: sem ele, trocar de acervo nao redesenha a lista, e duas
     bibliotecas podem ter a mesma contagem de simbolos e passar batido */
  const key = ['comp', acervoAtual().id, ST.q, ST.kind, ST.sel, nMod(), syms.length, ST.dirty, DATA.schlib ? 1 : 0, DATA.schlibErro].join(SEP);
  if (key === listKey) return;
  listKey = key;
  const semFp = s => !(s.footprints || []).some(f => f.incurrentlib);
  /* os DOIS lados entram nas duas formas — crua e sem marcação: assim "RST" acha R\S\T\,
     quem cola a notação crua do Altium também acha, e o "/O/E" de uma descrição casa com
     quem o digita. A regra (e o teste) estão em filtroBusca. */
  const qCru = ST.q.trim();
  const casa = filtroBusca(qCru, semBarra);
  const hit = s => casa(s.name, s.description);
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
  else if (!rows.length) frag.append(el('div', 'lib-head', qCru ? 'nada com "' + ST.q + '"' : 'nada aqui'));
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

/* A LISTA DA VISTA SÍMBOLOS: a biblioteca de símbolos (Libs/symbols-lib.js), cada linha com a
   miniatura e o nome — o pedido foi "ícone + nome, em forma de lista; você seleciona, edita ou
   salva, ou cria um símbolo novo". A busca é a mesma da faixa (filtraSimbolos). A miniatura só
   é desenhada quando a linha aparece (UI.ioList): são ~900 símbolos.
   A linha aberta é marcada por atributo (marcaLinhaSimbolo), fora da chave: abrir outro
   símbolo não refaz 900 linhas. Renomear, salvar e excluir zeram listKey — o nome ou o
   desenho mudam sem a contagem mudar. */
function refreshListaSimbolos() {
  const all = libSyms(), le = ST.libEd, d = ST.draft;
  const novo = le && !le.id && d ? d.name : '';
  const key = ['sim', ST.qSim, all.length, DATA.symlib ? 1 : 0, DATA.symlibMissing ? 1 : 0, novo, DATA.vincVer, semServidor() ? 1 : 0].join(SEP);
  if (key === listKey) { marcaLinhaSimbolo(); return; }
  listKey = key;
  pintaModo();
  if (UI.kicker) UI.kicker.textContent = 'símbolos · biblioteca de símbolos';
  UI.sum.textContent = '';
  const stat = (n, rot) => { const s = el('span'); s.append(el('b', null, String(n)), document.createTextNode(' ' + rot)); UI.sum.append(s); };
  const emUso = DATA.vinc ? all.filter(s => usoDoSimbolo(s.id)).length : null;
  stat(all.length, 'símbolos');
  if (emUso != null) stat(emUso, 'aplicados a componentes');
  UI.sum.title = DATA.symlib ? 'Libs/symbols-lib.js (' + (DATA.symlib.generated || '—') + ')' : '';
  if (UI.ioList) UI.ioList.disconnect();
  /* refazer por salvar ou renomear não pode jogar a lista para o topo: com o mesmo filtro, a
     rolagem volta para onde estava (com outro, o topo é o certo) */
  const topo = listaFiltro === ST.qSim ? UI.list.scrollTop : 0;
  listaFiltro = ST.qSim;
  UI.list.textContent = '';
  const rows = filtraSimbolos(all, ST.qSim);
  const frag = document.createDocumentFragment();
  /* o símbolo novo ainda não salvo não está na biblioteca, mas está no canvas: a linha dele
     vem primeiro, para a lista não negar o que se está desenhando */
  if (novo) {
    frag.append(el('div', 'lib-head', 'novo, ainda não salvo'));
    const b = el('button', 'lib-row symed-librow novo'); b.type = 'button';
    b.setAttribute('aria-selected', 'true');
    b.title = '"' + novo + '" ainda não está na biblioteca: ele entra no primeiro Salvar';
    b.append(el('span', 'nm', novo), el('span', 'pill', 'não salvo'));
    frag.append(b);
  }
  if (!DATA.symlib) frag.append(el('div', 'lib-head', DATA.symlibMissing
    ? 'a biblioteca de símbolos ainda não foi gerada (Libs/symbols-lib.js não carregou)'
    : 'carregando a biblioteca de símbolos…'));
  else if (!rows.length) frag.append(el('div', 'lib-head', ST.qSim.trim() ? 'nada com "' + ST.qSim.trim() + '"' : 'biblioteca vazia'));
  else frag.append(el('div', 'lib-head', 'símbolos (' + rows.length + (rows.length !== all.length ? ' de ' + all.length : '') + ')'));
  const pend = [];
  rows.forEach(s => {
    const b = el('button', 'lib-row symed-librow'); b.type = 'button'; b.dataset.id = s.id;
    const uso = usoDoSimbolo(s.id);
    b.title = s.name + (s.description ? '\n' + s.description : '') + '\n' + (s.pins || []).length + ' pinos · '
      + (s.kind === 'ci' ? 'CI' : 'genérico') + (uso ? '\naplicado a ' + uso : '')
      + ((s.aliases || []).length ? '\n' + s.aliases.join(', ') : '')
      + '\n(botão direito: renomear, salvar como, excluir)';
    const cv = el('canvas'); cv.width = 54; cv.height = 36;
    cv.dataset.id = s.id; cv.dataset.w = '54'; cv.dataset.h = '36';
    b.append(cv, el('span', 'nm', s.name), el('span', 'mt', (s.kind === 'ci' ? 'CI' : 'gen.') + ' · ' + (s.pins || []).length + 'p'));
    /* clicar no que já está aberto não pergunta nada nem reabre: é o mesmo símbolo */
    b.onclick = () => { if (!(ST.libEd && ST.libEd.id === s.id)) editarLib(s.id); };
    b.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); menuDaLinha(e.clientX, e.clientY, s); });
    frag.append(b);
    pend.push(cv);
  });
  UI.list.append(frag);
  if (topo) UI.list.scrollTop = topo;
  /* observar DEPOIS de entrar no documento: dentro do fragmento a linha não tem caixa */
  pend.forEach(cv => { if (UI.ioList) UI.ioList.observe(cv); else drawTile(cv); });
  marcaUlt = null;
  marcaLinhaSimbolo();
}
let listaFiltro = null;     /* o filtro com que a lista de símbolos foi montada da última vez */
/* a linha do símbolo aberto: marcada, com o ● de edição não salva, e trazida para a vista
   quando o símbolo foi aberto de fora da lista ("Editar na aba Símbolos") — rolando SÓ a
   lista, como o consomeScroll da faixa. Barato: só mexe quando o aberto ou o sujo mudaram.
   Rola uma vez por símbolo aberto (rolouPara), e não a cada refiltro: digitar no filtro
   refaz a lista, e ela pularia para a linha aberta a cada tecla. */
let marcaUlt = null, rolouPara = null;
function marcaLinhaSimbolo() {
  if (!UI || ST.modo !== 'simbolos') return;
  const id = (ST.libEd && ST.libEd.id) || '';
  const k = id + SEP + (ST.dirty ? 1 : 0);
  if (k === marcaUlt) return;
  marcaUlt = k;
  let alvo = null;
  UI.list.querySelectorAll('.symed-librow[data-id]').forEach(r => {
    const eu = !!id && r.dataset.id === id;
    r.setAttribute('aria-selected', String(eu));
    r.classList.toggle('editado', eu && ST.dirty);
    if (eu) alvo = r;
  });
  if (alvo && rolouPara !== id) {
    /* com o editor escondido (a vista ainda não apareceu) a lista mede 0: fica para o
       render() da vista, que zera marcaUlt e passa por aqui de novo */
    const cx = UI.list.getBoundingClientRect(), r = alvo.getBoundingClientRect();
    if (cx.height) {
      rolouPara = id;
      if (r.top < cx.top || r.bottom > cx.bottom) UI.list.scrollTop += (r.top - cx.top) - cx.height / 3;
    }
  }
}
/* o botão direito numa linha da lista de símbolos. "Salvar como…" é do desenho do CANVAS: na
   linha de outro símbolo ele fica travado, dizendo por quê — copiar um símbolo sem mexer não
   tem como, porque a biblioteca guarda cada desenho uma vez só (o servidor recusa o repetido). */
function menuDaLinha(x, y, s) {
  if (typeof HubAlmoxPick === 'undefined' || !HubAlmoxPick.menu) return;
  const aberto = !!(ST.libEd && ST.libEd.id === s.id);
  const sv = semServidor() ? 'abra o hub pelo hubserver.py para gravar' : '';
  const acoes = [
    { rotulo: 'Renomear…', off: sv, onEscolher: () => renomearLib(s) },
    { rotulo: 'Salvar como…', off: sv || (aberto ? '' : 'abra o símbolo e mude o desenho: "Salvar como" grava o desenho do canvas, e uma cópia idêntica a biblioteca recusa'),
      onEscolher: salvarComo },
    { rotulo: 'Excluir símbolo…', perigo: true, off: sv, onEscolher: () => excluirLib(s) },
  ];
  const uso = usoDoSimbolo(s.id);
  HubAlmoxPick.menu(x, y, s.name + (uso ? ' · aplicado a ' + uso : ''), acoes);
}
/* O QUE MUDA NA TELA COM O MODO: a classe da raiz (o CSS esconde a faixa no modo símbolos e a
   Biblioteca abre a coluna da esquerda), o filtro e o texto da busca, e o que fica ao lado
   dela — o recorte da lista do espelho, ou o "+ Novo símbolo". */
function pintaModo() {
  if (!UI) return;
  const sim = ST.modo === 'simbolos';
  UI.root.classList.toggle('symed-modo-simbolos', sim);
  const q = sim ? ST.qSim : ST.q;
  if (UI.q.value !== q) UI.q.value = q;
  UI.q.placeholder = sim ? 'filtrar símbolos (nome, apelido, tipo, descrição)…' : 'Buscar símbolo…';
  UI.seg.hidden = sim;
  UI.bNovoSim.hidden = !sim;
  UI.bNovoSim.disabled = semServidor();
  UI.bNovoSim.title = semServidor() ? 'abra o hub pelo hubserver.py para gravar'
    : 'cria um símbolo em branco na biblioteca de símbolos e abre no canvas para desenhar';
}

function cursorPadrao() {
  if (!UI) return;
  UI.cv.style.cursor = !ST.draft ? 'default' : ST.tool === 'select' ? 'default' : ST.tool === 'delete' ? 'pointer' : 'crosshair';
}
function refreshBar() {
  if (!UI) return;
  const d = ST.draft, p = curPart();
  UI.name.textContent = '';
  if (d && ST.libEd) UI.name.append(el('span', 'symed-libmark', ST.libEd.id ? 'símbolo' : 'símbolo novo'));
  UI.name.append(document.createTextNode(d ? d.name + (ST.dirty ? ' ●' : '') : '—'));
  UI.name.title = d && ST.libEd ? 'editando um SÍMBOLO da biblioteca de símbolos — não um componente' : '';
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
  const vazio = !!d && !p.graphics.length && !p.pins.length;
  /* no modo símbolos o espelho do acervo não importa: o que se espera é a biblioteca de símbolos */
  UI.hint.textContent = ST.modo === 'simbolos'
    ? (!d ? (!DATA.symlib ? (DATA.symlibMissing ? 'a biblioteca de símbolos não carregou (Libs/symbols-lib.js)' : 'carregando a biblioteca de símbolos…')
                          : 'escolha um símbolo à esquerda, ou crie um novo com "+ Novo símbolo"')
          : vazio ? 'símbolo vazio — desenhe com as ferramentas à direita (linha, retângulo, arco, pino…) e salve' : '')
    : !DATA.schlib ? (DATA.schlibErro || 'carregando o espelho…')
    : !d ? 'escolha uma categoria na lista da esquerda — criar ou editar um símbolo da biblioteca é na aba Símbolos'
    : vazio ? 'parte vazia — desenhe, ou aplique um símbolo da biblioteca' : '';
  marcaLinhaSimbolo();
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
    const p = el('p', null, ST.modo === 'simbolos'
      ? 'Escolha um símbolo na lista da esquerda para editar o desenho dele, ou crie um com "+ Novo símbolo". '
        + 'Salvar grava na biblioteca de símbolos (Libs/symbols-lib.js). Os componentes recebem o desenho na aba '
        + 'Componentes ("Aplicar símbolo ao componente" ou "à categoria"); se o símbolo já está aplicado, o Salvar '
        + 'pergunta se leva o desenho novo a eles.'
      : 'Escolha um componente para editar a geometria e os pinos. Salvar grava no espelho '
        + '(Libs/schlib.js) e, marcando Altium, na SchLib real — com backup. A biblioteca de símbolos embaixo do '
        + 'canvas guarda corpos prontos: clique num e aplique, ou arraste um para o canvas. Criar ou editar um '
        + 'símbolo da biblioteca é na aba Símbolos.');
    p.style.cssText = 'font-size:12px;color:var(--text-3);margin:6px 0 12px;line-height:1.5';
    a.append(p);
    return;
  }
  const part = curPart();
  const itens = selItems(), it = itens.length === 1 ? itens[0].item : null;
  /* o NOME CERTO de cada coisa (o dono, 2026-09-25: "SIMBOLO != Componente"): o desenho da
     biblioteca é SÍMBOLO; a linha do almoxarifado na lista é CATEGORIA; a peça é COMPONENTE
     (na biblioteca da casa, símbolo e componente são o mesmo registro — e ele é a peça) */
  const oque = ST.libEd ? 'símbolo da biblioteca' : ST.familia ? 'componente'
    : acervoGravavel() ? 'componente' : 'categoria';
  a.append(el('div', 'kicker', it ? tipoDe(it) : oque));
  const h = el('div', 'det-head'); const nm = el('span', 'd', d.name); nm.style.cssText = 'font-size:16px;word-break:break-word;line-height:1.3'; h.append(nm); a.append(h);
  if (ST.libEd) a.append(fichaDoSimbolo());
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
    /* o componente aberto é uma peça do Odoo: a ficha dele fica a um clique daqui */
    const lk = v && typeof HubOdooLink !== 'undefined' ? HubOdooLink.link(v, { nome: d.name }) : null;
    if (lk) { lk.style.marginLeft = '8px'; via.append(lk); }
    a.append(via);
  }
  if (itens.length) a.append(acoesDaSelecao(itens, it));
  if (it) a.append(fieldsFor(it));
  else if (itens.length > 1) {
    const q = el('p', null, itens.length + ' itens selecionados — Delete apaga, setas empurram, Ctrl+D duplica');
    q.style.cssText = 'font-size:12px;color:var(--text-4);margin:6px 0 10px;line-height:1.45'; a.append(q);
  } else {
    const desc = el('input', 'input'); desc.value = d.description || ''; desc.placeholder = 'descrição';
    desc.title = ST.libEd ? 'descrição do símbolo (a busca da biblioteca acha por ela)' : 'descrição do componente';
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
  UI.bSave = btn('btn-primary', ST.libEd ? 'Salvar símbolo' : 'Salvar', salvar, semServidor() ? 'abra o hub pelo hubserver.py para gravar'
    : ST.libEd ? 'grava o desenho na biblioteca de símbolos (Libs/symbols-lib.js) — os componentes só mudam quando você aplica'
    : 'grava no espelho (Libs/schlib.js) e, se marcado, na SchLib do Altium');
  UI.bSave.disabled = semServidor() || !ST.dirty || ST.saving;
  /* "Salvar como…" só no modo símbolo: o desenho do canvas vira um símbolo NOVO (salvarComo) */
  let bComo = null;
  if (ST.libEd) {
    const vz = !part.pins.length && !part.graphics.length;
    const porque = semServidor() ? 'abra o hub pelo hubserver.py para gravar'
      : ST.saving ? 'gravando…'
      : vz ? 'o símbolo está vazio — desenhe alguma coisa antes de salvar' : '';
    bComo = btn('btn-secondary', 'Salvar como…', salvarComo, porque
      || 'grava o desenho do canvas como um símbolo NOVO, com outro nome, e passa a editar a cópia — o símbolo de origem fica como está gravado. A biblioteca guarda cada desenho uma vez só: uma cópia idêntica é recusada');
    bComo.disabled = !!porque;
  }
  const lab = el('label'); UI.altium = el('input'); UI.altium.type = 'checkbox'; UI.altium.checked = UI.altiumChecked !== false;
  UI.altium.onchange = () => { UI.altiumChecked = UI.altium.checked; };
  lab.append(UI.altium, document.createTextNode('Altium'));
  /* NO MODO SÍMBOLO A CAIXA FICA À VISTA: o símbolo da biblioteca não tem .SchLib, mas ela
     decide se o desenho levado aos componentes (o "Atualizar quem usa" depois do Salvar)
     também vai para a .SchLib. Escondida, ela continuava mandando no lote sem ninguém ver */
  lab.title = ST.libEd
    ? 'quando o Salvar levar o desenho novo aos componentes que usam este símbolo (Atualizar quem usa), grava também a .SchLib deles; desmarcada, só o hub, e a .SchLib recebe no próximo sincronismo'
    : 'também grava na SchLib real (BIBLIOTECA DE ESQUEMA.SchLib), com backup';
  sv.append(UI.bSave);
  if (bComo) sv.append(bComo);
  sv.append(lab);
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
function partSelect(d, val, on, texto) {
  const rot = texto || (pt => 'parte ' + pt.part + ' de ' + d.parts.length);
  return selectOf((d.parts || []).map(pt => [pt.part, rot(pt)]), val, v => on(parseInt(v, 10) || 1));
}

/* sem item marcado: as contagens do símbolo e o seletor da parte aberta */
function fieldsForSymbol(d, part) {
  const box = propsGrid();
  kickerRow(box, 'partes');
  linha(box, [['partes', ro((d.parts || []).length)], ['aberta', partSelect(d, ST.part, abrirParte)]]);
  linha(box, [['pinos', ro(part.pins.length)], ['gráficos', ro(part.graphics.length)]]);
  /* o símbolo da biblioteca tem uma parte só (o formato symlib-v1 guarda pins/graphics no
     topo): sem "+ parte" no modo símbolo */
  if (ST.libEd) return box;
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
  /* ESTE COMBO MOVE, o do cabecalho NAVEGA — e ate 2026-09-15 os dois liam "parte N de M",
     no mesmo canto da ficha. Quem marcava um grafico e trocava ali achando que ia mudar de
     parte via o desenho PULAR para a outra. O rotulo agora diz o verbo, e a vista segue o
     item (ver moverParaParte), que e o que desfaz a sensacao de "sumiu". */
  const partRow = () => {
    kickerRow(box, 'mover para outra parte');
    linha(box, [['mover para', partSelect(d, ST.part, n => moverParaParte(alvo, n),
                                          pt => (pt.part === ST.part ? 'parte ' + pt.part + ' (aqui)' : 'parte ' + pt.part))]]);
  };
  const loc = 'localização (' + U + ')', tam = 'tamanho (' + U + ')';

  if (it.g == null) {
    kickerRow(box, loc);
    linha(box, [['X', medida(it.x, v => apply(o => { o.x = v; }))], ['Y', medida(it.y, v => apply(o => { o.y = v; }))]]);
    corRow();
    partRow();
    kickerRow(box, 'pino');
    linha(box, [['Número', inp(it.num, v => apply(o => { o.num = v; }), { text: true })]], olho('hideNum', 'número'));
    /* o campo guarda o valor CRU (R\S\T\): é ele que vai para a .SchLib, e o usuário precisa
       poder digitar a notação do Altium. A prévia barrada vai no title, com a sobrelinha
       combinante — o atributo é texto puro, não aceita <span>, e a grade da ficha tem 5
       células fixas, sem lugar para um rótulo ao lado. O canvas ali do lado já mostra o
       nome desenhado, e refaz a ficha a cada edição, então o title acompanha. */
    const nomeInp = inp(it.name, v => apply(o => { o.name = v; }), { text: true });
    const ovb = OVB();
    if (ovb && ovb.temBarra(it.name)) nomeInp.title = 'no desenho: ' + ovb.unicode(it.name);
    linha(box, [['Nome', nomeInp]], olho('hideName', 'nome'));
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
  pintaBotoesLib(true);
  if (UI.io) UI.io.disconnect();
  UI.tiles.textContent = '';
  if (!rows.length) { UI.tiles.append(el('div', 'symed-empty', q ? 'nada com "' + ST.valQ + '"' : 'sem componentes')); return; }
  const frag = document.createDocumentFragment();
  const dups = duplicadosDoAcervo();
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
    /* o SÍMBOLO de que o desenho veio, quando ele foi aplicado pela biblioteca */
    const sl = libById(vinculoDe(f && f.name, nome));
    if (sl) { const t = el('span', 'lib', '◆ ' + sl.name); t.title = 'desenho do símbolo "' + sl.name + '" da biblioteca'; meta.append(t); }
    else if (valorTemGeo(v)) meta.append(el('span', 'pill', 'desenho próprio'));
    if (v.footprint) meta.append(el('span', 'fp', v.footprint));
    if (typeof v.estoque === 'number') meta.append(el('span', 'es', v.estoque + ' un'));
    /* O MESMO PRODUTO DO ODOO NOUTRO COMPONENTE: o antigo (fora) de uma renomeação, ou o vivo
       que tem um antigo. A lista de todos e o "apagar os antigos" ficam no aviso da faixa da
       Biblioteca (hub-libview.js). */
    const gem = typeof HubAlmoxPick !== 'undefined' && HubAlmoxPick.gemeosDe ? HubAlmoxPick.gemeosDe(v, dups) : [];
    if (gem.length) {
      const t = el('span', 'dup', v.fora ? '⚠ antigo' : '⚠ duplicado');
      t.title = 'o mesmo produto do Odoo (id ' + gem[0].odoo + ') também está em:\n'
        + gem.map(x => '#' + x.v.id + ' ' + (x.v.altium || x.v.label) + (x.v.fora ? ' (fora)' : '')
                       + (x.sym !== f ? ' — ' + x.sym.name : '')).join('\n')
        + (v.fora ? '\n\neste é o antigo: o nome saiu do Odoo e o produto vive no outro'
                  : '\n\neste é o vivo: o outro é o nome antigo, que pode ser apagado');
      meta.append(t);
    }
    b.append(meta);
    b.onclick = () => abrirValor(nome);
    /* o "Odoo ↗" ao lado do tile, nunca dentro: o tile é um <button> (hub-odoolink » faixa) */
    frag.append(typeof HubOdooLink !== 'undefined' ? HubOdooLink.faixa(b, v, { nome }) : b);
  });
  UI.tiles.append(frag);
}

let IDXLIB = null;                 /* indice da symbols-lib; null = refazer na proxima consulta */
const idxLib = () => (IDXLIB || (IDXLIB = montaIdxLib(libSyms())));

/* O PASSO QUE FALTAVA no "Editar símbolo" da vista Esquema: chegar na aba com o corpo de
   mesmo nome já marcado na faixa. Marcar sozinho não resolve três coisas:
     · ST.faixa é PEGAJOSO — quem esteve em "Componentes" voltaria para lá e nem veria os
       tiles (openSymbol e abrirValor nunca tocam nele);
     · o cache de DOM (libKey) não enxerga libSel nem libIds;
     · o tile pode nascer fora da caixa de 190 px, e aí fica marcado onde ninguém vê — e sem
       desenho, porque o IntersectionObserver só pinta o que está dentro dela. */
function preSelecionarNaFaixa(familia, componente) {
  const f = symByName(familia);
  const alvos = [componente, familia, f && f.familia];
  const r = DATA.symlib ? alvoNaFaixa(idxLib(), alvos) : null;
  ST.faixa = 'simbolos';
  ST.libIds = null;
  /* a busca sai do caminho: com texto velho no filtro, o alvo pode nem estar na lista.
     O input junto, porque o refreshLib nunca reescreve o campo. */
  ST.libQ = ''; if (UI && UI.libQ) UI.libQ.value = '';
  const quem = componente || familia;
  /* SEM COMPONENTE NÃO HÁ O QUE PRÉ-SELECIONAR, e o silêncio é a resposta certa.
     O corpo da biblioteca de símbolos corresponde ao COMPONENTE (a peça: "PTH DIP8 LM555"),
     não à família — e família do almoxarifado é CATEGORIA: "CAPACITOR ELETROLITICO [SMD]",
     "BARRA DE PINOS 6V". Nunca vai existir um corpo com esse nome, então "nenhum corpo com
     o nome X" era uma reclamação garantida, e com toast de 7 s, toda vez que alguém abrisse
     uma família. Virou ruído no dia (2026-09-17) em que a vista Biblioteca passou a abrir a
     família a cada clique na lista da esquerda.
     Com componente a pergunta volta a fazer sentido, e o aviso continua: ali "não achei o
     corpo" é informação de verdade para quem veio do "Editar símbolo" da vista Esquema. */
  const vale = !!componente;
  if (!DATA.symlib) {
    ST.libSel = null;
    ST.faixaNota = vale
      ? 'a biblioteca de símbolos não carregou — procure "' + quem + '" à mão' : '';
  } else if (!r) {
    ST.libSel = null;
    ST.faixaNota = vale
      ? 'nenhum corpo com o nome "' + quem + '" na biblioteca — escolha um abaixo, '
        + 'ou desenhe um na aba Símbolos' : '';
    if (vale && O && O.toast) O.toast(ST.faixaNota, 'warn', 7000);
  } else if (r.how === 'ambiguo') {
    /* EMPATE: mostra os dois e NÃO escolhe. "Aplicar símbolo ao componente" só destrava com
       libSel, então ele não nasce armado com um chute. Só o filtro por id junta os dois: o filtro de
       texto é substring e não dobra acento. */
    ST.libIds = r.cands.map(x => x.id);
    ST.libSel = null; ST.faixaScroll = r.cands[0].id;
    ST.faixaNota = r.cands.length + ' corpos com o nome "' + r.nome + '" — escolha qual '
                 + '(digite na busca para ver a biblioteca inteira)';
    /* a nota fica (ela mostra os candidatos); o TOAST só quando alguém pediu um componente.
       Abrir família não pode gritar — é o que o clique na lista da esquerda faz o tempo todo. */
    if (vale && O && O.toast) O.toast(ST.faixaNota, 'warn', 7000);
  } else {
    ST.libSel = r.s.id; ST.faixaScroll = r.s.id;
    ST.faixaNota = 'pré-selecionado "' + r.s.name + '"'
      + (r.how === 'alias' ? ' (apelido de "' + r.nome + '")'
       : r.how === 'chave' ? ' (mesmo nome que "' + r.nome + '", a menos de acento)' : '')
      + (r.nome !== quem ? ' — pela família' : '');
  }
  libKey = '';       /* o cache nao ve libSel nem libIds: invalidar na mao */
  refreshLib();      /* sem UI ainda, ele volta na hora e o render() aplica depois */
}

/* Rola SÓ a faixa. O scrollIntoView rolaria também os ancestrais, e o ancestral aqui é a
   grade do editor: o canvas daria um pulo que ninguém pediu. */
function consomeScroll() {
  const id = ST.faixaScroll; if (!id || !UI || !UI.tiles) return;
  ST.faixaScroll = null;
  const t = UI.tiles.querySelector('.symed-tile[data-id="' + id + '"]'); if (!t) return;
  const cx = UI.tiles.getBoundingClientRect(), r = t.getBoundingClientRect();
  if (r.top < cx.top || r.bottom > cx.bottom) UI.tiles.scrollTop += (r.top - cx.top) - 4;
  const cv = t.querySelector('canvas');
  if (cv) drawTile(cv);   /* o observer so entrega no proximo quadro; drawTile e idempotente */
}

function refreshLib() {
  if (!UI) return;
  /* no modo simbolos a faixa nao aparece (CSS): refazer ~900 tiles escondidos a cada clique
     nao serve a ninguem. O trocaModo zera libKey, e a volta para Componentes a refaz */
  if (ST.modo === 'simbolos') return;
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
  /* libIds e faixaNota entram na chave: sem isso, mudar so a nota nao redesenha nada; o
     vincVer porque o tooltip diz quantos componentes usam cada símbolo */
  const key = [ST.libQ, (ST.libIds || []).join(','), ST.faixaNota, all.length, L ? 1 : 0, DATA.symlibMissing ? 1 : 0, DATA.vincVer].join(SEP);
  pintaBotoesLib(false);
  if (key === libKey) { markLibSel(); consomeScroll(); return; }
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
  /* a busca é a mesma da lista da vista Símbolos (filtraSimbolos: nome, apelidos, kind e
     descrição — 727 dos 897 símbolos têm descrição) */
  const ids = (ST.libIds && ST.libIds.length) ? new Set(ST.libIds) : null;
  const rows = filtraSimbolos(all, ST.libQ).filter(s => !ids || ids.has(s.id));
  UI.libCount.textContent = rows.length + (rows.length !== all.length ? ' de ' + all.length : '')
    + ' símbolo' + (all.length === 1 ? '' : 's') + (ST.faixaNota ? ' — ' + ST.faixaNota : '');
  if (!rows.length) { UI.tiles.append(el('div', 'symed-empty', q ? 'nada com "' + ST.libQ + '"' : 'biblioteca vazia')); return; }
  const frag = document.createDocumentFragment();
  rows.forEach(s => {
    const t = el('button', 'symed-tile'); t.type = 'button'; t.dataset.id = s.id;
    t.setAttribute('aria-selected', String(ST.libSel === s.id));
    /* a descricao no tooltip: com 897 tiles o nome sozinho nao diz o que a peca e, e
       menos ainda quando o nome e codigo de catalogo (CMP-0694-00003-2) */
    const uso = usoDoSimbolo(s.id);
    t.title = s.name + (s.description ? '\n' + s.description : '') + '\n' + (s.pins || []).length + ' pinos · ' + (s.kind || '') + (s.usos ? ' · ' + s.usos + ' usos' : '')
      + (uso ? '\naplicado a ' + uso : '')
      + ((s.aliases || []).length ? '\n' + s.aliases.join(', ') : '')
      + '\n(botão direito: aplicar ao componente, aplicar à categoria, editar na aba Símbolos)';
    const cv = el('canvas'); cv.width = 96; cv.height = 64; cv.dataset.id = s.id;
    t.append(cv, el('span', 'nm', s.name), el('span', 'k', (s.kind === 'ci' ? 'CI' : 'genérico') + ' · ' + (s.pins || []).length + 'p'));
    t.onclick = () => { if (tileDragged) { tileDragged = false; return; }
      /* so refaz o DOM quando ha nota a apagar — com 897 tiles, refazer a cada clique e o que trava */
      if (ST.faixaNota) { ST.faixaNota = ''; libKey = ''; }
      ST.libSel = ST.libSel === s.id ? null : s.id; refreshLib(); };
    /* duplo clique aplica ao componente aberto — e só a ele: sem componente não faz nada (o
       botão travado da faixa diz por quê), nunca abre o lote da categoria por conta própria */
    t.ondblclick = aposRecarga(() => { ST.libSel = s.id; markLibSel(); pintaBotoesLib(false); if (componenteAberto()) aplicarLib(); });
    /* o botão direito marca o tile e abre o cardápio dele (menuDoSimbolo) */
    t.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      if (ST.libSel !== s.id) { ST.libSel = s.id; refreshLib(); }
      menuDoSimbolo(e.clientX, e.clientY, s);
    });
    t.addEventListener('mousedown', e => tileDown(e, s, cv));
    t.draggable = false;
    frag.append(t);
    if (UI.io) UI.io.observe(cv); else drawTile(cv);
  });
  UI.tiles.append(frag);
  consomeScroll();
}
/* só o destaque muda de tile: atributo em vez de reconstrução */
function markLibSel() {
  if (!UI) return;
  UI.tiles.querySelectorAll('.symed-tile').forEach(t => t.setAttribute('aria-selected', String(t.dataset.id === ST.libSel)));
}
/* a miniatura de um símbolo da biblioteca: o tile da faixa (96×64) e a linha da lista da vista
   Símbolos (54×36, em data-w/data-h) são o mesmo desenho em tamanhos diferentes */
function drawTile(cv) {
  if (cv.dataset.drawn) return;
  const s = libById(cv.dataset.id); if (!s) return;
  cv.dataset.drawn = '1';
  const DPR = window.devicePixelRatio || 1, W = Number(cv.dataset.w) || 96, H = Number(cv.dataset.h) || 64;
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
  /* PREENCHIMENTO VAI PARA TRAS — mesma regra do HubDraw.drawSymbolPart. A ordem do array
     e a que veio do Altium, e o corpo preenchido costuma ser o ULTIMO grafico: desenhando
     cru, o retangulo amarelo cobria os diodos que moram dentro dele. A ordem relativa
     dentro de cada grupo continua a original — dois preenchimentos empilhados continuam
     empilhando na mesma ordem. */
  const gs = graphics || [];
  for (const g of gs.filter(x => x && x.solid).concat(gs.filter(x => !(x && x.solid)))) {
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
   só quando o pino não o esconde (hideNum/hideName do schlib-v2). O nome sai pelo overbar:
   R\S\T\ é RST com a barra em cima, e é aqui que a notação crua vira desenho. */
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
      /* 20 mil, e nao 15: e a MESMA folga que o hub-draw usa na folha (PIN_NOME_FOLGA) e nas
         miniaturas. Enquanto eram dois numeros, o editor desenhava o nome 5 mil mais para
         dentro do corpo do que a folha — quem viesse aqui afastar um nome que estava
         encavalando media contra uma regua errada, e o encavalamento na folha continuava.
         A folga em si e o desenhista quem escolhe (o dado do pino nao guarda posicao de nome:
         nem o espelho, nem o servidor, nem a .SchLib da casa tem onde por isso), entao o
         minimo honesto e que os dois desenhistas escolham igual. */
      HubDraw.worldText(ctx, pin.name, pin.x - d[0] * 20, pin.y - d[1] * 20, 45, vert ? 90 : 0, C.body, align, { overbar: true });
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
    p.pins.push(novoPino(p.pins, s.x, s.y, pinLenDefault(ST.snap, ST.unit), ST.pinRot));
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
async function abrirValor(nome, manter) {
  const f = familiaAberta(); if (!f) return false;
  const v = valorPorNome(f, nome); if (!v) return false;
  if (ST.dirty) {
    const ok = await confirmar('Há edição não salva em "' + nomeAberto() + '". Descartar e abrir "' + nome + '"?',
                               { title: 'Descartar edição?', ok: 'Descartar', danger: true });
    if (!ok) return false;
  }
  limpaStatusSe(nomeAberto() !== nome || !!ST.libEd, manter);
  ST.libEd = null;
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
  if (ST.dirty && !(await confirmar('Há edição não salva em "' + nomeAberto() + '". Descartar?',
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
  const destino = (alvo.kind === 'pin' ? dest.pins : dest.graphics);
  destino.push(clone(it));
  /* A VISTA VAI JUNTO. Antes ela ficava na parte de origem e o item simplesmente sumia da
     tela — indistinguivel de "apaguei sem querer". Agora a tela mostra onde ele foi, com
     ele marcado; o Ctrl+Z devolve tudo, inclusive a parte aberta (o snapshot guarda ST.part). */
  ST.part = n;
  ST.selection = [{ kind: alvo.kind, idx: destino.length - 1 }];
  ST.draw = null; ST.fitPending = true;
  touched(); afterEdit(); fitSeNecessario();
  if (O && O.toast) O.toast(tipoDe(it) + ' movido para a parte ' + n + ' — a tela veio junto; Ctrl+Z desfaz', 'ok');
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
  if (ST.libEd) return salvarLib();
  /* Duas rotas, dois alvos:
       /save        — um simbolo da biblioteca da CASA (Libs/schlib.js + a SchLib da casa);
       /save-almox  — UM componente do almoxarifado, na .SchLib da familia dele.
     Editar a FAMILIA inteira de um acervo do almoxarifado continua sem caminho: o desenho
     dela nasce do gerador, e o que se grava por componente e o `valores[].parts`. */
  if (!acervoGravavel() && !ST.familia) {
    /* a CATEGORIA não se salva desenhando nela: o desenho vai para os componentes. O
       caminho é escolher um símbolo na faixa e "Aplicar símbolo à categoria…" (que troca
       também o padrão dela), ou abrir um componente na faixa Componentes */
    setStatus('a categoria não se salva pelo canvas: escolha um símbolo na faixa de baixo e use '
              + '"Aplicar símbolo à categoria…", ou abra um componente na faixa Componentes', 'err');
    if (O && O.toast) O.toast('para trocar o desenho da categoria inteira, use um símbolo da biblioteca e "Aplicar símbolo à categoria…"', 'warn', 7000);
    return;
  }
  const sym = serializeSymbol(d);
  const altium = !!(UI.altium && UI.altium.checked);
  setStatus('salvando' + (altium ? ' no espelho e no Altium…' : ' no espelho…'), '');
  /* a flag (e não só o nó do botão) porque qualquer edição durante o await refaz a ficha */
  ST.saving = true; UI.bSave.disabled = true;
  const doAlmox = !!ST.familia;
  let status, j;
  try {
    ({ status, j } = doAlmox
      ? await api('save-almox', { familia: ST.familia, componente: sym.name,
                                  parts: sym.parts, description: sym.description, altium })
      : await api('save', { name: sym.name, parts: sym.parts, description: sym.description, altium }));
  } finally { ST.saving = false; }
  /* o espelho em memória passa a ser o que foi gravado: reabrir o símbolo mostra a versão salva */
  const sincroniza = () => {
    if (doAlmox) {
      /* no almoxarifado quem recebe o desenho e o VALOR. Escrever em s.parts pintaria os
         25 componentes da familia de uma vez na tela — o contrario do que se pediu. */
      const f = familiaAberta(), v = f && valorPorNome(f, sym.name);
      if (v) v.parts = clone(sym.parts);
    } else {
      const s = symByName(sym.name);
      if (s) { s.parts = clone(sym.parts); s.partcount = sym.partcount; s.description = sym.description; }
    }
    ST.dirty = false; ST.saved.add(sym.name);
  };
  if (j && j.ok) {
    sincroniza();
    const avisos = (j.avisos || []).length ? ' · ' + j.avisos.join(' · ') : '';
    setStatus('salvo ' + new Date().toLocaleTimeString('pt-BR') + (j.altium ? ' — espelho + Altium' + (j.backup ? ' (backup: ' + j.backup.split(/[\\/]/).pop() + ')' : '') : ' — só o espelho') + avisos, 'ok');
    if (O && O.toast) O.toast((doAlmox ? 'componente "' : 'símbolo "') + sym.name + '" salvo'
      + (j.altium ? ' no espelho e na SchLib' : ' no espelho')
      + (doAlmox && j.protegido === false ? ' — ATENÇÃO: não protegido, o sincronismo pode desfazer' : ''),
      doAlmox && j.protegido === false ? 'warn' : 'ok');
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

/* "Aplicar símbolo ao componente" (e o duplo clique no tile): troca o desenho do componente
   aberto pelo do símbolo marcado. Só no rascunho — o Salvar grava. A categoria tem o botão
   dela (abrirAplicarCategoria); até 2026-10-09 este mesmo botão virava "Aplicar à categoria…"
   ou "Aplicar ao símbolo em edição" conforme o que estava aberto, e agora diz uma coisa só. */
function aplicarLib() {
  const s = libById(ST.libSel); if (!s || !componenteAberto()) return;
  const p = curPart(); if (!p) return;
  pushUndo();
  const r = applyLibSymbol(p, s);
  p.pins = r.part.pins; p.graphics = r.part.graphics;
  ST.note = r.note; ST.selection = []; touched(); afterEdit(); fit();
}
/* "SALVAR COMO…" (vista Símbolos): o desenho do canvas vira um símbolo NOVO, com outro nome, e
   o canvas passa a editar a cópia — como em qualquer editor. O símbolo de origem fica como
   estava gravado: a edição não salva vai só para a cópia. É a rota do primeiro Salvar de um
   símbolo novo (op add), com o kind do de origem. Geometria igual à de outro símbolo o
   servidor recusa (409): a biblioteca guarda cada desenho uma vez só, e copiar sem mexer não
   tem como — o toast diz com quem colidiu.
   Até 2026-10-09 existia o "Guardar como símbolo", que capturava o desenho de um COMPONENTE;
   ele saiu junto com a faixa de botões da vista Componentes. */
async function salvarComo() {
  const d = ST.draft, le = ST.libEd; if (!d || !le || semServidor() || ST.saving) return;
  const p = serializeSymbol({ name: d.name, parts: [d.parts[0] || { part: 1, pins: [], graphics: [] }] }).parts[0];
  if (!p.pins.length && !p.graphics.length) { setStatus('o símbolo está vazio — desenhe alguma coisa antes de salvar', 'err'); return; }
  const nome = await pedirTexto('Salvar como', 'Nome do símbolo novo (o "' + d.name + '" fica como está gravado)', d.name + ' (cópia)');
  if (nome == null || !nome.trim()) return;
  const n = nome.trim();
  if (libSyms().some(x => x.name === n)) { O.toast('já existe um símbolo chamado "' + n + '" — escolha outro nome', 'warn'); return; }
  /* o rascunho pode ter mudado enquanto o nome era pedido: grava-se o que está na mesa agora */
  if (ST.draft !== d || ST.libEd !== le) return;
  const g = serializeSymbol({ name: n, parts: [d.parts[0] || { part: 1, pins: [], graphics: [] }] }).parts[0];
  const orig = le.id ? libById(le.id) : null;
  ST.saving = true; refreshAside();
  setStatus('salvando "' + n + '" na biblioteca de símbolos…', '');
  /* o canvas continua editável durante o POST (como no salvarLib): a marca diz se mexeram */
  const marca = ST.edicoes;
  let r;
  try {
    r = await api('lib', { op: 'add', symbol: Object.assign({ name: n, desc: d.description || '', pins: g.pins, graphics: g.graphics },
                                                          orig && orig.kind ? { kind: orig.kind } : {}) });
  } finally { ST.saving = false; }
  const { status, j } = r;
  if (!j || !j.ok || !j.symbol) {
    const msg = (j && j.error) || ('HTTP ' + status);
    setStatus('não salvou: ' + msg, 'err');
    O.toast('não salvou: ' + msg, status === 409 ? 'warn' : 'err');
    refreshAside();
    return;
  }
  const s = j.symbol;
  if (s.desc && !s.description) s.description = s.desc;
  if (!DATA.symlib) { DATA.symlib = { symbols: [] }; DATA.symlibMissing = false; }
  DATA.symlib.symbols.push(s);
  IDXLIB = null; libKey = ''; listKey = '';
  const criado = 'símbolo "' + s.name + '" criado na biblioteca' + (orig ? ' a partir de "' + orig.name + '"' : '');
  /* SÓ COM A MESA INTACTA o canvas passa para a cópia, no desenho que o servidor gravou
     (arredondado e ordenado). Se mexeram durante o POST, ou abriram outra coisa (outro
     símbolo, a vista Componentes), a cópia só entra na lista — trocar o canvas por baixo
     jogaria fora a edição nova, ou poria um símbolo no modo componentes */
  const intacto = ST.modo === 'simbolos' && ST.libEd === le && ST.draft === d && ST.edicoes === marca && !ST.gesto && !ST.draw;
  if (!intacto) {
    refreshList(); refreshAside();          /* a ficha destrava o "Salvar como…" (gravando…) */
    if (ST.libEd === le) setStatus('a cópia "' + s.name + '" foi gravada SEM a sua última edição: o canvas continua em "'
                                   + d.name + '", com ela ainda não salva', 'err');
    O.toast(criado + ' — está na lista, à esquerda', 'ok');
    return;
  }
  abreNoCanvasComoSimbolo({ id: s.id }, { name: s.name, description: s.description || '', footprints: [],
                                          parts: [{ part: 1, pins: clone(s.pins || []), graphics: clone(s.graphics || []) }] });
  setStatus('salvo como "' + s.name + '" ' + new Date().toLocaleTimeString('pt-BR')
            + (orig ? ' — "' + orig.name + '" ficou como estava gravado' : ''), 'ok');
  O.toast(criado, 'ok');
}
/* renomear/excluir recebem SEMPRE o símbolo: a queda para o tile marcado da faixa era dos
   botões da faixa, que saíram — e, chamada da ficha durante uma recarga, apagaria outro */
async function renomearLib(alvo) {
  const s = (alvo && alvo.id) ? alvo : null; if (!s || semServidor()) return;
  const name = await pedirTexto('Renomear símbolo', 'Novo nome', s.name);
  if (name == null || !name.trim() || name.trim() === s.name) return;
  const { status, j } = await api('lib', { op: 'rename', id: s.id, name: name.trim() });
  if (j && j.ok) {
    /* o objeto da lista pode ter sido trocado por uma recarga durante o POST: o nome vai nos dois */
    const novo = (j.symbol && j.symbol.name) || name.trim();
    s.name = novo; const vivo = libById(s.id); if (vivo) vivo.name = novo;
    IDXLIB = null; libKey = ''; listKey = '';
    /* o símbolo que está no canvas é este: o nome no topo acompanha, e o status também — o
       "salvo como X" de antes continuaria falando de um nome que não existe mais */
    if (ST.libEd && ST.libEd.id === s.id && ST.draft) {
      ST.draft.name = s.name;
      setStatus('renomeado para "' + s.name + '" ' + new Date().toLocaleTimeString('pt-BR'), 'ok');
      refreshBar(); refreshAside();
    }
    refreshLib(); refreshList(); O.toast('renomeado para "' + s.name + '"', 'ok'); return;
  }
  O.toast((j && j.error) || ('não renomeou (HTTP ' + status + ')'), status === 409 ? 'warn' : 'err');
}
/* "Renomear…" da ficha: o símbolo aberto. O que já está na biblioteca vai pelo servidor; o
   símbolo NOVO ainda não salvo só troca o nome do rascunho — ele entra com esse nome no Salvar */
async function renomearAberto() {
  const le = ST.libEd, d = ST.draft; if (!le || !d) return;
  if (le.id) { const s = libById(le.id); if (s) await renomearLib(s); return; }
  const nome = await pedirTexto('Renomear símbolo novo', 'Nome do símbolo (ele entra na biblioteca com este nome no Salvar)', d.name);
  if (nome == null || !nome.trim() || nome.trim() === d.name || ST.draft !== d) return;
  const n = nome.trim();
  if (libSyms().some(x => x.name === n)) { O.toast('já existe um símbolo chamado "' + n + '" — escolha outro nome', 'warn'); return; }
  d.name = n; listKey = '';
  refreshList(); refreshBar(); refreshAside();
}
/* EXCLUIR UM SÍMBOLO — não um componente. Os componentes que receberam o desenho dele ficam
   com o desenho (é cópia, na .SchLib e no espelho); só deixam de estar ligados a ele. E ele
   não volta: o servidor guarda o fingerprint em `excluidos`, que a extração respeita. */
async function excluirLib(alvo) {
  const s = (alvo && alvo.id) ? alvo : null; if (!s || semServidor()) return;
  const uso = usoDoSimbolo(s.id);
  const pads = DATA.vinc ? Object.keys(DATA.vinc.pads).filter(k => DATA.vinc.pads[k] === s.id) : [];
  const ok = await confirmar('Excluir o símbolo "' + s.name + '" da biblioteca de símbolos?'
    + (uso ? '\n\nEle está aplicado a ' + uso + '. Eles continuam com o desenho — só deixam de estar ligados a este símbolo.' : '')
    + (pads.length ? ' ' + (pads.length === 1 ? 'A categoria ' + pads[0] + ' continua' : 'As categorias ' + pads.join(', ') + ' continuam')
        + ' com este desenho como padrão: quem entrar depois ainda vem com ele.' : '')
    + '\n\nA extração não o traz de volta.', { title: 'Excluir símbolo', ok: 'Excluir símbolo', danger: true });
  if (!ok) return;
  const { status, j } = await api('lib', { op: 'delete', id: s.id });
  if (j && j.ok) {
    /* a biblioteca pode estar recarregando (o reload que a própria gravação dispara) */
    if (DATA.symlib) DATA.symlib.symbols = libSyms().filter(x => x.id !== s.id);
    IDXLIB = null;
    if (ST.libSel === s.id) ST.libSel = null;
    if (ST.ultimoLib === s.id) ST.ultimoLib = null;
    libKey = ''; listKey = '';
    /* era o símbolo aberto no canvas: o que está lá vira um símbolo NOVO, ainda não salvo —
       quem excluiu por engano ainda pode salvá-lo de volta. Só com rascunho na mesa: sem
       ele, marcar "edição não salva" deixava o editor sujo sem ter o que salvar */
    if (ST.libEd && ST.libEd.id === s.id && ST.draft) {
      ST.libEd.id = null; ST.dirty = true;
      setStatus('"' + s.name + '" saiu da biblioteca — o desenho continua aqui, como símbolo novo: Salvar o põe de volta', '');
      refreshBar(); refreshAside();
    }
    carregaVinculos(true);
    refreshLib(); refreshList();
    O.toast('símbolo "' + s.name + '" excluído' + (j.desvinculados ? ' — ' + j.desvinculados + ' vínculo(s) desfeito(s)' : ''), 'ok');
    return;
  }
  O.toast((j && j.error) || ('não excluiu (HTTP ' + status + ')'), 'err');
}

/* ═══════════════════════ a ferramenta de símbolos ═══════════════════════
   Pedido do dono (2026-09-25): editar e excluir SÍMBOLOS, criar um do zero e atribuir um
   símbolo a todos os componentes de uma categoria — "ENTENDAAA SIMBOLO != Componente".
   O símbolo é um desenho da Biblioteca de símbolos (Libs/symbols-lib.js); o componente é a
   peça do almoxarifado que o USA. Editar um símbolo abre o desenho dele no canvas e o Salvar
   grava na biblioteca (ST.libEd); aplicar copia o desenho para os componentes e deixa o
   vínculo no ledger — editar o símbolo depois oferece levar o desenho novo a eles.
   Desde 2026-10-09 (pedido do dono) editar é a vista Símbolos e aplicar é a vista
   Componentes: um modo do editor cada uma (abaixo). */

/* ═══ OS DOIS MODOS DO EDITOR ═══
   A vista Componentes da Biblioteca aplica símbolos a componentes; a vista Símbolos "serve
   única e exclusivamente para editar símbolos". O editor é um só (o UI e o ST são deste
   módulo), então as duas vistas são MODOS dele:
     'componentes'  o canvas mostra uma categoria ou um componente; a faixa de baixo tem os
                    símbolos da biblioteca e os dois "Aplicar". ST.libEd nunca existe aqui.
     'simbolos'     o canvas mostra um símbolo da biblioteca (ST.libEd); a coluna da esquerda
                    lista a biblioteca de símbolos, e a faixa de baixo some.
   Nada atravessa a troca: o que estava na mesa é de um modo só. Com edição não salva, o
   modal do tema pergunta antes, e cancelar deixa tudo onde estava.
   Responde `true` NA HORA quando não precisa perguntar, e só devolve Promise quando abre o
   modal: o hub-libview.js troca a vista no mesmo instante em que o editor troca de modo, e
   quem pediu a troca (o #/libsym do hub.html) segue logo com HubSymEd.abrir. */
function modo(m) {
  if (m !== 'componentes' && m !== 'simbolos') return false;
  if (ST.modo === m) return true;
  if (!ST.dirty) { trocaModo(m); return true; }
  return confirmar('Há edição não salva em "' + nomeAberto() + '". Descartar e ir para a aba '
                   + (m === 'simbolos' ? 'Símbolos' : 'Componentes') + '?',
                   { title: 'Descartar edição?', ok: 'Descartar', danger: true })
    .then(ok => { if (ok && ST.modo !== m) trocaModo(m); return ok; });
}
function trocaModo(m) {
  /* o símbolo aberto volta junto quando se voltar para a vista Símbolos */
  if (ST.modo === 'simbolos') ST.ultimoLib = (ST.libEd && ST.libEd.id) || null;
  ST.modo = m;
  ST.libEd = null; ST.familia = null; ST.valSel = null; ST.sel = null; ST.draft = null; ST.part = 1;
  ST.undo = []; ST.redo = []; ST.dirty = false; ST.selection = []; ST.draw = null; ST.note = '';
  ST.gesto = null; ST.box = null;
  /* listaFiltro: a rolagem da lista é a do OUTRO modo, e não volta */
  listKey = ''; libKey = ''; marcaUlt = null; listaFiltro = null; rolouPara = null;
  if (UI) { pintaModo(); setStatus('', ''); UI.list.scrollTop = 0; }
  refreshAll();
  const volta = m === 'simbolos' ? ST.ultimoLib : null;
  if (volta && libById(volta)) editarLib(volta, true);
}
/* "Editar na aba Símbolos" (o botão direito num tile da vista Componentes). Quem troca de
   vista é a Biblioteca (hub-libview.js), que ouve o evento e responde com preventDefault —
   este módulo não a conhece. Sem ninguém ouvindo, o editor troca de modo ele mesmo. */
function pedeEdicao(id) {
  if (!id) return;
  let ev = null;
  try { ev = new CustomEvent('hub:editar-simbolo', { detail: { id }, cancelable: true }); } catch (e) {}
  if (ev && typeof document !== 'undefined' && !document.dispatchEvent(ev)) return;
  Promise.resolve(modo('simbolos')).then(ok => { if (ok) editarLib(id); });
}
/* Só existe no modo símbolos. NÃO zera listKey nem libKey: abrir outro símbolo só remarca a
   linha (a chave da lista já muda sozinha quando entra ou sai o símbolo novo não salvo), e a
   faixa está escondida neste modo — o trocaModo a refaz na volta para Componentes. Zerar as
   duas aqui refazia ~900 linhas e ~900 tiles a cada clique, com as miniaturas piscando. */
function abreNoCanvasComoSimbolo(le, draft, manter) {
  ST.libEd = le;
  ST.familia = null; ST.valSel = null; ST.sel = null;
  ST.draft = draft; ST.part = 1;
  ST.undo = []; ST.redo = []; ST.dirty = false; ST.selection = []; ST.draw = null; ST.note = '';
  ST.faixa = 'simbolos'; ST.libIds = null; ST.faixaNota = '';
  limpaStatusSe(true, manter);
  ST.fitPending = true;
  refreshAll(); fitSeNecessario();
}
/* o símbolo no canvas: a linha da lista da vista Símbolos, ou o "Editar na aba Símbolos" do
   tile (pelo pedeEdicao, que antes troca o modo). Só vale no modo símbolos — no outro, quem
   chama é a casca ou um teste, e o pedido vai pelo mesmo caminho do tile */
async function editarLib(id, force, manter) {
  if (ST.modo !== 'simbolos') { pedeEdicao(id); return false; }
  /* a biblioteca pode estar RECARREGANDO (a casca chama reload() a cada gravação em Libs/ —
     inclusive a do Aplicar de um segundo atrás): os tiles continuam na tela, mas DATA.symlib
     está vazio. Esperar a carga em curso, em vez de não achar o símbolo e não fazer nada */
  if (!libById(id) && DATA.libLoading) await DATA.libLoading;
  /* durante a espera pode-se ter ido para a vista Componentes: lá não existe símbolo em
     edição (o Salvar de lá gravaria na biblioteca de símbolos) */
  if (ST.modo !== 'simbolos') return false;
  const s = libById(id);
  if (!s) { if (O && O.toast) O.toast('o símbolo não está mais na biblioteca', 'warn'); return false; }
  if (ST.dirty && !force) {
    const ok = await confirmar('Há edição não salva em "' + nomeAberto() + '". Descartar e editar o símbolo "' + s.name + '"?',
                               { title: 'Descartar edição?', ok: 'Descartar', danger: true });
    if (!ok || ST.modo !== 'simbolos') return false;
  }
  /* aberto de fora da lista ("Editar na aba Símbolos", a volta à vista) com um filtro que o
     esconde: o filtro sai, senão a linha dele não existe e nada fica marcado */
  if (ST.qSim.trim() && !filtraSimbolos([s], ST.qSim).length) {
    ST.qSim = ''; if (UI && UI.q) UI.q.value = ''; listKey = '';
  }
  abreNoCanvasComoSimbolo({ id: s.id },
    { name: s.name, description: s.description || '', footprints: [],
      parts: [{ part: 1, pins: clone(s.pins || []), graphics: clone(s.graphics || []) }] }, manter);
  return true;
}
/* "+ Novo símbolo" (topo da lista da vista Símbolos): um símbolo em branco, com nome, para
   desenhar do zero. Ele só entra na biblioteca no primeiro Salvar — um símbolo vazio não tem
   o que guardar. */
async function novoSimbolo() {
  if (semServidor() || ST.modo !== 'simbolos') return;
  const nome = await pedirTexto('Novo símbolo', 'Nome do símbolo (é o que a busca da biblioteca acha)', '');
  if (nome == null || !nome.trim()) return;
  const n = nome.trim();
  if (libSyms().some(x => x.name === n)) { O.toast('já existe um símbolo chamado "' + n + '" — escolha outro nome', 'warn'); return; }
  if (ST.dirty && !(await confirmar('Há edição não salva em "' + nomeAberto() + '". Descartar e começar o símbolo "' + n + '"?',
                                    { title: 'Descartar edição?', ok: 'Descartar', danger: true }))) return;
  abreNoCanvasComoSimbolo({ id: null },
    { name: n, description: '', footprints: [], parts: [{ part: 1, pins: [], graphics: [] }] });
  O.toast('símbolo novo "' + n + '": desenhe e salve — ele entra na biblioteca de símbolos', 'ok');
}
/* a ficha do símbolo em edição: o que ele é, quem o usa, e Renomear/Excluir (Salvar e
   "Salvar como…" ficam no pé da ficha, com o Salvar de sempre). O "voltar para a categoria"
   de antes saiu em 2026-10-09: editar símbolo virou uma vista própria, e a categoria está na
   vista Componentes, a um clique na faixa da Biblioteca. */
function fichaDoSimbolo() {
  const box = el('div');
  const le = ST.libEd;
  box.append(el('div', 'symed-libnota', le.id
    ? 'Símbolo da biblioteca — não é um componente. Salvar grava o desenho na biblioteca; os componentes só mudam quando recebem o desenho na aba Componentes (e, se ele já está aplicado, o hub pergunta se leva o desenho novo a eles).'
    : 'Símbolo novo, ainda fora da biblioteca: ele entra no primeiro Salvar.'));
  const uso = le.id ? usoDoSimbolo(le.id) : '';
  if (uso) box.append(el('div', 'symed-libnota', 'Aplicado a ' + uso + '.'));
  const acts = el('div', 'symed-libacts');
  const sv = semServidor() ? 'abra o hub pelo hubserver.py para gravar' : '';
  const bRen = btn('btn-secondary btn-sm', 'Renomear…', renomearAberto, le.id
    ? (sv || 'troca o nome do símbolo na biblioteca — quem o usa continua ligado a ele')
    : 'troca o nome do símbolo novo — ele entra na biblioteca com este nome no Salvar');
  bRen.disabled = !!(le.id && sv);
  if (bRen.disabled) bRen.title = sv;
  const porqueDel = sv || (le.id ? '' : 'símbolo novo, ainda fora da biblioteca: não há o que excluir');
  const bDel = btn('btn-secondary btn-sm', 'Excluir…', () => { const s = libById(le.id); if (s) excluirLib(s); }, porqueDel
    || 'exclui o símbolo da biblioteca — quem o usa fica com o desenho; o canvas o guarda como símbolo novo, para desfazer salvando');
  bDel.disabled = !!porqueDel;
  acts.append(bRen, bDel);
  box.append(acts);
  return box;
}
/* Salvar no modo símbolo: add (novo) ou update (existente) na biblioteca de símbolos */
async function salvarLib(opts) {
  const d = ST.draft, le = ST.libEd; if (!d || !le || semServidor() || ST.saving) return;
  const p = serializeSymbol({ name: d.name, parts: [d.parts[0] || { part: 1, pins: [], graphics: [] }] }).parts[0];
  if (!p.pins.length && !p.graphics.length) { setStatus('o símbolo está vazio — desenhe alguma coisa antes de salvar', 'err'); return; }
  ST.saving = true; if (UI.bSave) UI.bSave.disabled = true;
  setStatus('salvando na biblioteca de símbolos…', '');
  /* o canvas continua editável durante o POST: a marca diz se alguém mexeu (ou abriu outra
     coisa) enquanto ele voava — aí o rascunho da mesa NÃO é trocado pelo que voltou */
  const marca = ST.edicoes;
  let r;
  try {
    r = le.id
      ? await api('lib', { op: 'update', id: le.id, pins: p.pins, graphics: p.graphics, desc: d.description || '' })
      : await api('lib', { op: 'add', symbol: { name: d.name, desc: d.description || '', pins: p.pins, graphics: p.graphics } });
  } finally { ST.saving = false; }
  const { status, j } = r;
  if (!j || !j.ok) {
    const msg = (j && j.error) || ('HTTP ' + status);
    setStatus('não salvou: ' + msg, 'err');
    O.toast('não salvou: ' + msg, status === 409 ? 'warn' : 'err');
    refreshAside();
    return;
  }
  const s = j.symbol;
  if (s.desc && !s.description) s.description = s.desc;
  if (!DATA.symlib) { DATA.symlib = { symbols: [] }; DATA.symlibMissing = false; }
  const lst = DATA.symlib.symbols, i = lst.findIndex(x => x.id === s.id);
  if (i >= 0) lst[i] = s; else lst.push(s);
  /* listKey também: o desenho (a miniatura) e o nome mudam sem a contagem da lista mudar */
  IDXLIB = null; libKey = ''; listKey = ''; le.id = s.id;
  const intacto = ST.libEd === le && ST.draft === d && ST.edicoes === marca && !ST.gesto && !ST.draw;
  if (intacto) {
    /* o canvas passa a mostrar o que foi GRAVADO: o servidor arredonda a 1 mil e ordena os
       pinos, e é essa a versão que os componentes vão receber */
    d.name = s.name; d.description = s.description || '';
    d.parts = [{ part: 1, pins: clone(s.pins || []), graphics: clone(s.graphics || []) }];
    ST.selection = []; ST.undo = []; ST.redo = []; ST.dirty = false;
    setStatus('salvo na biblioteca de símbolos ' + new Date().toLocaleTimeString('pt-BR'), 'ok');
  } else if (ST.libEd === le) {
    setStatus('salvo — mas a versão gravada é a de ANTES da sua última edição, que continua no canvas sem salvar', 'err');
  }
  O.toast('símbolo "' + s.name + '" salvo na biblioteca', 'ok');
  refreshAll();
  if (opts && opts.semPropagar) return;
  const fica = (j.vinculados || []).length + (j.padroes || []).length;
  if (fica || (j.naoCabem || []).length || (j.padroesNaoCabem || []).length) await propagar(s, j);
}
/* O símbolo editado já estava aplicado: levar o desenho novo a quem o usa (ou não). O
   servidor já separou (symserver » _quem_ficou_para_tras): `vinculados`/`padroes` são os que
   ainda têm o desenho de antes e cabem; `naoCabem`/`padroesNaoCabem` teriam a PINAGEM trocada
   (a contagem de pinos mudou) e ficam de fora — dizer quantos, nunca trocar calado. Salvar só
   a descrição não deixa ninguém para trás, e não se pergunta nada. */
async function propagar(s, j) {
  const vinc = j.vinculados || [], pads = j.padroes || [];
  const fora = (j.naoCabem || []).length, padFora = (j.padroesNaoCabem || []).length;
  const n = vinc.length;
  const foraTxt = (fora || padFora)
    ? '\n\n' + (fora ? fora + ' componente' + (fora === 1 ? '' : 's') : '') + (fora && padFora ? ' e ' : '')
      + (padFora ? padFora + ' categoria' + (padFora === 1 ? '' : 's') : '')
      + ' ficam de fora: o símbolo agora tem outra contagem de pinos, e levá-lo trocaria a pinagem deles. '
      + 'Para esses, use "Aplicar à categoria…" e marque à mão.'
    : '';
  if (!n && !pads.length) {
    await confirmar('O símbolo "' + s.name + '" foi salvo.' + foraTxt, { title: 'Quem usa este símbolo', ok: 'Entendi' });
    return;
  }
  const cats = [...new Set(vinc.map(x => x.simbolo).concat(pads))];
  const semSch = UI && UI.altiumChecked === false;
  const ok = await confirmar('O símbolo "' + s.name + '" está aplicado a ' + n + ' componente' + (n === 1 ? '' : 's')
    + ' que ainda têm o desenho de antes'
    + (cats.length ? ' (' + cats.slice(0, 4).join(', ') + (cats.length > 4 ? '…' : '') + ')' : '')
    + (pads.length ? ', e é o desenho padrão de ' + pads.length + ' categoria' + (pads.length === 1 ? '' : 's') : '')
    + '.\n\nLevar o desenho novo para eles agora? Sem isso eles continuam com o desenho de antes.'
    + (semSch ? '\n\nA caixa Altium da ficha está desmarcada: grava só no hub, e a .SchLib recebe no próximo sincronismo.' : '')
    + foraTxt,
    { title: 'Atualizar quem usa este símbolo', ok: n ? 'Atualizar ' + n + ' componente' + (n === 1 ? '' : 's') : 'Atualizar' });
  if (!ok) { setStatus('só o símbolo mudou; os componentes continuam com o desenho de antes', ''); return; }
  await aplicarEmLote(s, vinc.map(x => ({ familia: x.familia, componente: x.componente })), pads);
}
/* O LOTE: um POST /api/symbols/almox-aplicar com todos os alvos. O servidor grava o espelho
   uma vez, cada .SchLib uma vez e o ledger uma vez — e o hub recebe UM aviso de mudança no
   disco, não um por componente. */
async function aplicarEmLote(s, alvos, padroes) {
  if (semServidor()) return null;
  const altium = !UI || UI.altiumChecked !== false;
  const n = alvos.length;
  setStatus('aplicando "' + s.name + '" em ' + n + ' componente' + (n === 1 ? '' : 's') + '…', '');
  const { status, j } = await api('almox-aplicar', { lib: s.id, alvos, padroes: padroes || [], altium });
  if (!j || !j.ok) {
    const msg = (j && j.error) || ('HTTP ' + status);
    const fal = (j && j.falhas) || [];
    setStatus('não aplicou: ' + msg + (fal.length ? ' — ' + fal.slice(0, 3).map(f => (f.componente || f.simbolo) + ': ' + f.erro).join('; ') : ''), 'err');
    O.toast(status === 409 ? msg : 'não aplicou: ' + msg, status === 409 ? 'warn' : 'err');
    return null;
  }
  /* a memória anda junto: o componente e a categoria passam a ter o desenho gravado */
  const porNome = new Map(symbols().map(f => [f.name, f]));
  for (const f of j.feitos) {
    const fam = porNome.get(f.simbolo), v = fam && valorPorNome(fam, f.componente);
    if (v) v.parts = clone(f.parts);
  }
  for (const p of j.padroes) {
    const fam = porNome.get(p.simbolo);
    if (fam) { fam.parts = clone(p.parts); fam.partcount = p.parts.length; }
  }
  carregaVinculos(true);
  const nf = j.feitos.length, nsch = j.feitos.filter(f => f.altium).length;
  const conta = m => j.feitos.filter(f => f.pinagem === m).length;
  /* GRAVES (o que não aconteceu) pintam a ficha de vermelho; LEMBRETES (o que você marcou à
     mão depois de conferir: pinagem trocada, casamento a conferir) ficam no texto, sem alarme */
  const graves = [], lembretes = [];
  if (j.falhas.length) graves.push(j.falhas.length + ' não foram: ' + j.falhas.slice(0, 3).map(f => (f.componente || f.simbolo) + ' (' + f.erro + ')').join('; '));
  if (j.ocupadas.length) graves.push('biblioteca aberta no Altium (' + j.ocupadas.join(', ') + '): o desenho ficou no hub e entra na .SchLib no próximo sincronismo — feche no Altium e aplique de novo para gravar agora');
  graves.push(...(j.avisos || []).slice(0, 2));
  if (conta('simbolo')) lembretes.push(conta('simbolo') + ' com a PINAGEM trocada pela do símbolo: confira pino × pad do footprint');
  if (conta('confira')) lembretes.push(conta('confira') + ' casados pelo número com o símbolo nomeando os pinos: confira a polaridade no desenho');
  if (conta('ordem')) lembretes.push(conta('ordem') + ' casados pela ORDEM: confira a polaridade no desenho');
  const onde = altium ? (nsch === nf ? ' — espelho e .SchLib' : ' — ' + nsch + ' de ' + nf + ' na .SchLib') : ' — só no espelho (a .SchLib recebe no próximo sincronismo)';
  const msg = '"' + s.name + '" aplicado a ' + nf + ' componente' + (nf === 1 ? '' : 's')
    + (j.padroes.length ? ' e virou o padrão de ' + j.padroes.map(p => p.simbolo).join(', ') : '') + onde;
  const partes = graves.concat(lembretes);
  setStatus(msg + (partes.length ? '. ' + partes.join(' · ') : ''), graves.length ? 'err' : 'ok');
  O.toast(msg + (graves.length ? ' — veja os avisos na ficha' : ''), graves.length ? 'warn' : 'ok');
  if (O && O.onSaved) { try { O.onSaved(s.name); } catch (e) {} }
  /* o canvas mostra o desenho novo, se ele é de quem recebeu (e não há edição na mesa) */
  if (!ST.dirty && !ST.libEd) {
    if (ST.familia) { const c = ST.sel; ST.dirty = false; await abrirValor(c, true); }
    else if (ST.sel) { const c = ST.sel; ST.draft = null; await openSymbol(c, true, true); }
  } else { listKey = ''; libKey = ''; refreshAll(); }
  return j;
}
/* "Aplicar à categoria…": a lista dos componentes da categoria (e das irmãs da mesma
   família), marcados como o planoCategoria decide, para o usuário conferir e desmarcar */
async function abrirAplicarCategoria(s) {
  if (!s || semServidor()) return;
  const fam = familiaDoContexto();
  if (!fam || !valoresDa(fam).length) {
    O.toast('abra uma categoria do almoxarifado (na lista da esquerda) para aplicar o símbolo aos componentes dela', 'warn');
    return;
  }
  /* O SÍMBOLO ABERTO COM EDIÇÃO NÃO SALVA: o que se aplica é a versão GRAVADA, e o canvas
     mostra outra. Salvar antes, ou não aplicar — nunca aplicar calado o desenho de antes. */
  if (ST.libEd && ST.libEd.id === s.id && ST.dirty) {
    const ok = await confirmar('O símbolo "' + s.name + '" tem edição não salva no canvas. Aplicar agora levaria aos componentes o desenho GRAVADO, sem essa edição.\n\nSalvar o símbolo e depois aplicar?',
                               { title: 'Salvar antes de aplicar', ok: 'Salvar e aplicar' });
    if (!ok) return;
    await salvarLib({ semPropagar: true });
    if (ST.dirty || !libById(s.id)) return;
    s = libById(s.id);
  }
  const plano = planoCategoria(symbols(), fam, s, (cat, comp) => !!vinculoDe(cat, comp));
  const nLib = (s.pins || []).length;
  const recomendado = ln => ln.cabe && !ln.proprio && (ln.modo === 'nome' || ln.modo === 'numero');
  const corpo = el('div');
  corpo.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-width:0';
  const topo = el('div', 'symed-apl-topo');
  const bTodos = el('button', 'btn btn-ghost', 'Marcar os recomendados'); bTodos.type = 'button';
  bTodos.title = 'marca, em todas as seções, quem tem a mesma contagem de pinos, casa os pinos pelo nome ou pelo número e não tem desenho próprio do gerador';
  const bNenhum = el('button', 'btn btn-ghost', 'Desmarcar todos'); bNenhum.type = 'button';
  const cont = el('span', 'n');
  topo.append(bTodos, bNenhum, cont);
  const lista = el('div', 'symed-apl');
  const caixas = [];              /* {cb, sec, ln} */
  const secs = [];
  const aviso = (txt, tit) => { const a = el('span', 'av', txt); a.title = tit; return a; };
  for (const sec of plano) {
    const box = el('div', 'symed-apl-sec');
    const cab = el('label', 'symed-apl-cab');
    const cbs = el('input'); cbs.type = 'checkbox';
    const q = el('span', 'q');
    cab.append(cbs, el('span', null, sec.simbolo + (sec.aberta ? '' : ' (mesma família)')), q);
    box.append(cab);
    /* A CONFERIR: o símbolo nomeia os pinos (+/−, A/K) e o componente não, ou os nomes não
       batem. A seção diz como eles casam — quase sempre é o mesmo para a categoria inteira —
       para a conferência ser uma olhada, e não 114 caixas */
    const conf = sec.linhas.filter(ln => ln.cabe && (ln.modo === 'confira' || ln.modo === 'ordem'));
    if (conf.length) {
      const mapas = [...new Set(conf.map(ln => ln.mapa))];
      const n = el('div', 'symed-apl-conf');
      n.textContent = conf.length + ' para conferir — os pinos casam assim: ' + mapas.slice(0, 2).join('   |   ')
        + (mapas.length > 2 ? '   (e mais ' + (mapas.length - 2) + ' jeitos)' : '')
        + ' (pino do componente → pino do símbolo). Se estiver certo, marque a seção.';
      box.append(n);
    }
    const minhas = [];
    for (const ln of sec.linhas) {
      const l = el('label', 'symed-apl-lin' + (recomendado(ln) ? '' : ' nao'));
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = ln.marcado;
      const mt = el('span', 'mt');
      if (!ln.cabe) mt.append(aviso(ln.pinos + ' pino' + (ln.pinos === 1 ? '' : 's') + ' ≠ ' + nLib,
        'a contagem de pinos não bate: marcar TROCA a pinagem do componente pela do símbolo (números e nomes)'));
      else if (ln.modo === 'confira') mt.append(aviso('confira a polaridade',
        'os nomes dos pinos do símbolo e do componente não dizem a mesma coisa (A/K, +/−, B/C/E): o casamento pode inverter o componente'));
      else if (ln.modo === 'ordem') mt.append(aviso('pinos pela ordem',
        'os pinos não têm nome e os números não batem com os do símbolo: casam pela ordem — confira a polaridade'));
      const lk = libById(vinculoDe(sec.simbolo, ln.componente));
      if (lk) mt.append(el('span', null, 'hoje: ◆ ' + lk.name));
      else if (ln.proprio) mt.append(aviso('desenho próprio',
        'desenho próprio do componente (o gerador desenha o PNP e o conector por vias): marque só se quiser trocá-lo'));
      l.append(cb, el('span', 'nm', ln.componente), mt);
      l.title = ln.componente;
      box.append(l);
      const c = { cb, sec, ln };
      caixas.push(c); minhas.push(c);
    }
    /* o cabeçalho decide pelas LINHAS, não pelo valor que o navegador acabou de alternar:
       com algo marcado, desmarca a seção; sem nada, marca os recomendados — e, se a seção não
       tem nenhum (é o caso "a conferir" logo acima, conferido de olho), os que cabem e não
       têm desenho próprio. Pelo valor, uma seção com uma linha que não cabe ficava presa em
       "parcial" e não desmarcava mais */
    cbs.onchange = () => {
      const algum = minhas.some(c => c.cb.checked);
      const rec = minhas.filter(c => recomendado(c.ln));
      const alvo = new Set(algum ? [] : (rec.length ? rec : minhas.filter(c => c.ln.cabe && !c.ln.proprio)));
      minhas.forEach(c => { c.cb.checked = alvo.has(c); });
      atualiza();
    };
    secs.push({ sec, cbs, q, minhas });
    lista.append(box);
  }
  const pad = el('label', 'symed-apl-pad');
  const cbPad = el('input'); cbPad.type = 'checkbox'; cbPad.checked = true;
  const padTxt = el('span');
  pad.append(cbPad, padTxt);
  const nota = el('div', 'symed-libnota');
  nota.textContent = 'Grava cada componente marcado no espelho, '
    + (UI && UI.altiumChecked === false ? 'SEM a .SchLib (a caixa Altium está desmarcada: ela entra no próximo sincronismo)' : 'na .SchLib')
    + ' e no ledger, ligado ao símbolo — editar o símbolo depois oferece atualizar todos. Os pinos casam pelo nome (A/K, B/C/E…) ou, sem nome, pelo número; onde isso não é seguro a linha vem desmarcada, com o motivo.';
  corpo.append(topo, lista, pad, nota);
  let bo = null;
  /* a seção "inteira" para o PADRÃO: todos os componentes SEM desenho próprio marcados — o
     padrão é o desenho que eles herdam, e o próprio não herda (guardiao.depois também o
     pula); a categoria de pinagem a definir nunca recebe padrão */
  const inteira = x => !x.sec.placeholder && x.minhas.some(c => c.cb.checked)
    && x.minhas.every(c => c.cb.checked || c.ln.proprio);
  function atualiza() {
    let n = 0, trocam = 0;
    for (const x of secs) {
      const m = x.minhas.filter(c => c.cb.checked).length;
      n += m; trocam += x.minhas.filter(c => c.cb.checked && !c.ln.cabe).length;
      x.cbs.checked = m > 0 && m === x.minhas.length;
      x.cbs.indeterminate = m > 0 && m < x.minhas.length;
      x.q.textContent = m + ' de ' + x.minhas.length + ' marcados';
    }
    cont.textContent = n + ' componente' + (n === 1 ? '' : 's') + ' marcado' + (n === 1 ? '' : 's')
      + (trocam ? ' — ' + trocam + ' com a pinagem TROCADA' : '');
    const inteiras = secs.filter(inteira);
    cbPad.disabled = !inteiras.length;
    pad.style.opacity = inteiras.length ? '' : '.55';
    padTxt.textContent = inteiras.length
      ? 'Também como desenho PADRÃO de ' + inteiras.map(x => x.sec.simbolo).join(', ') + ' — componente que entrar no almoxarifado depois, sem desenho próprio, já vem com este símbolo.'
      : 'Desenho padrão da categoria: só quando todos os componentes dela (fora os de desenho próprio) estão marcados.';
    if (bo) { bo.textContent = n ? 'Aplicar a ' + n + ' componente' + (n === 1 ? '' : 's') : 'Aplicar'; bo.disabled = !n; }
  }
  caixas.forEach(c => { c.cb.onchange = atualiza; });
  bTodos.onclick = () => { caixas.forEach(c => { c.cb.checked = recomendado(c.ln); }); atualiza(); };
  bNenhum.onclick = () => { caixas.forEach(c => { c.cb.checked = false; }); atualiza(); };
  const r = await abreModal({
    title: 'Aplicar "' + s.name + '" à categoria', larga: true,
    msg: 'Os componentes marcados passam a usar o desenho do símbolo "' + s.name + '" (' + nLib + ' pino' + (nLib === 1 ? '' : 's') + ').',
    corpo, ok: 'Aplicar',
    monta: o => { bo = o.bo; atualiza(); },
    ler: () => ({
      /* a linha que não cabe só vai porque o usuário a marcou à mão: é o pedido explícito
         que o servidor exige para trocar a pinagem */
      alvos: caixas.filter(c => c.cb.checked).map(c => Object.assign({ familia: c.sec.simbolo, componente: c.ln.componente },
                                                                      c.ln.cabe ? {} : { trocaPinagem: true })),
      padroes: cbPad.checked && !cbPad.disabled ? secs.filter(inteira).map(x => x.sec.simbolo) : [],
    }),
  });
  if (!r || !r.alvos.length) return;
  await aplicarEmLote(s, r.alvos, r.padroes);
}
/* O BOTÃO DIREITO NUM SÍMBOLO da faixa (vista Componentes). O menu é o HubAlmoxPick.menu
   (hub-almoxpick.js, que as duas cascas carregam); sem ele, os botões da faixa fazem o mesmo.
   Os dois aplicar aparecem SEMPRE, travados com o porquê quando não valem — o mesmo dos
   botões. Renomear e excluir moram na vista Símbolos, para onde o "Editar" leva. */
function menuDoSimbolo(x, y, s) {
  if (typeof HubAlmoxPick === 'undefined' || !HubAlmoxPick.menu || !s) return;
  const pq = porquesAplicar(s, false);
  const fam = familiaDoContexto();
  const acoes = [
    { rotulo: 'Aplicar símbolo ao componente', off: pq.comp,
      onEscolher: aposRecarga(() => { ST.libSel = s.id; markLibSel(); aplicarLib(); pintaBotoesLib(false); }) },
    { rotulo: 'Aplicar símbolo à categoria' + (fam && valoresDa(fam).length ? ' ' + fam.name : '') + '…', off: pq.cat,
      onEscolher: aposRecarga(() => abrirAplicarCategoria(libById(s.id) || s)) },
    { rotulo: 'Editar na aba Símbolos', onEscolher: () => pedeEdicao(s.id) },
  ];
  const uso = usoDoSimbolo(s.id);
  HubAlmoxPick.menu(x, y, s.name + (uso ? ' · aplicado a ' + uso : ''), acoes);
}
/* POR QUE cada aplicar não vale agora ('' = vale), na ordem em que o usuário resolve: o
   símbolo, o componente (ou a categoria), o servidor. Os botões da faixa e o botão direito do
   tile leem daqui, para os dois dizerem a mesma coisa. */
function porquesAplicar(s, emComponentes) {
  const semSim = emComponentes ? 'volte à faixa Símbolos e marque um símbolo'
    : !s ? 'nenhum símbolo marcado — clique num símbolo da faixa' : '';
  const comp = semSim || (componenteAberto() ? ''
    : acervoGravavel() ? 'nenhum componente aberto — escolha um na lista da esquerda'
    : 'nenhum componente aberto — escolha um na faixa Componentes (a categoria inteira recebe pelo "Aplicar símbolo à categoria")');
  const f = familiaDoContexto();
  const cat = semSim
    || (!f ? 'nenhuma categoria aberta — escolha uma na lista da esquerda'
        : !valoresDa(f).length ? 'a categoria "' + f.name + '" não tem componentes por baixo (só as do almoxarifado têm)'
        : semServidor() ? 'abra o hub pelo hubserver.py para gravar' : '');
  return { comp, cat, f };
}
/* OS DOIS APLICAR DA FAIXA: nunca somem — travados, o title diz por quê; destravados, diz em
   QUEM o desenho vai cair */
function pintaBotoesLib(emComponentes) {
  if (!UI || !UI.bLibApply) return;
  const s = libById(ST.libSel);
  const pq = porquesAplicar(s, emComponentes);
  UI.bLibApply.disabled = !!pq.comp;
  UI.bLibApply.title = pq.comp || ('troca o desenho de "' + nomeAberto() + '" pelo do símbolo "' + s.name
    + '" — a pinagem fica quando a contagem bate; Salvar grava');
  UI.bLibCat.disabled = !!pq.cat;
  UI.bLibCat.title = pq.cat || ('escolhe quais componentes de "' + pq.f.name + '" recebem o símbolo "' + s.name
    + '" e grava todos de uma vez');
}

/* ── quem usa cada símbolo (o ledger, por /api/symbols/lib-vinculos) ── */
let vincCarga = null;
function carregaVinculos(forca) {
  if (semServidor() || typeof fetch !== 'function') return Promise.resolve(null);
  if (vincCarga && !forca) return vincCarga;
  vincCarga = fetch('/api/symbols/lib-vinculos').then(r => r.json()).then(j => {
    if (!j || !j.ok) return null;
    const porLib = new Map(), porComp = new Map();
    for (const c of j.componentes || []) {
      porComp.set(c.simbolo + SEP + c.componente, c.lib);
      const u = porLib.get(c.lib) || { n: 0, cats: new Set() };
      u.n++; if (c.simbolo) u.cats.add(c.simbolo);
      porLib.set(c.lib, u);
    }
    DATA.vinc = { porLib, porComp, pads: j.padroes || {} };
    DATA.vincVer++; libKey = '';
    /* a lista da vista Símbolos tem o vincVer na chave: "aplicados a componentes" e os tooltips */
    if (UI) { refreshLib(); refreshList(); if (ST.libEd) refreshAside(); }
    return DATA.vinc;
  }).catch(() => null);
  return vincCarga;
}
const vinculoDe = (categoria, componente) =>
  (DATA.vinc && categoria && componente && DATA.vinc.porComp.get(categoria + SEP + componente)) || null;
/* "14 componentes (2 categorias)" — ou '' quando ninguém usa (ou ainda não se sabe) */
function usoDoSimbolo(id) {
  const u = DATA.vinc && DATA.vinc.porLib.get(id);
  const pads = DATA.vinc ? Object.keys(DATA.vinc.pads).filter(k => DATA.vinc.pads[k] === id) : [];
  if (!u && !pads.length) return '';
  const n = u ? u.n : 0, cats = new Set([...(u ? u.cats : []), ...pads]);
  return n + ' componente' + (n === 1 ? '' : 's') + (cats.size ? ' (' + cats.size + ' categoria' + (cats.size === 1 ? '' : 's') + ')' : '');
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
  /* SO O DELETE APAGA. O Backspace saiu a pedido do usuario em 2026-09-15: ele e a tecla
     de "corrigir o que acabei de digitar", e num editor de desenho essa expectativa nao
     vale — a mao vai nele por reflexo e leva a selecao junto. Delete e a tecla que a
     pessoa aperta querendo apagar. */
  if (k === 'Delete') { if (ST.selection.length && !ST.draw) { e.preventDefault(); deleteSelection(); } return; }
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
  /* a lista da vista Símbolos e a dica do canvas também esperam por esta carga: sem elas, se
     o espelho chegasse antes, as duas ficavam em "carregando…" até alguém trocar de aba */
  if (!DATA.symlib && !DATA.libLoading) loadSymlib().then(() => { libKey = ''; listKey = ''; refreshLib(); refreshList(); refreshBar(); });
  if (!DATA.vinc) carregaVinculos();
  /* a casca chama render() por troca de idioma, mudança no disco, goTab… se o usuário está
     digitando na ficha, refazer a aside apagaria o que ainda não passou pelo onchange. Um
     botão da toolbox com foco não conta: aí a ficha pode e deve acompanhar a seleção */
  const ae = document.activeElement;
  const digitando = !!ae && UI.aside.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
  marcaUlt = null;            /* a linha aberta da lista de símbolos se remarca (e rola, se ainda não rolou) */
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
  novaParte, excluirParte, deleteSelection, duplicarSelecao, undo, redo, nudge, pushUndo, virar, setUnit,
  /* a ferramenta de símbolos — também o que o teste da página (CDP) aperta */
  editarLib, novoSimbolo, salvar, salvarComo, renomearAberto, renomearLib, excluirLib, aplicarLib,
  abrirAplicarCategoria, aplicarEmLote, carregaVinculos, menuDoSimbolo, pedeEdicao, modo };

/* o Libs/schlib.js em disco mudou por fora desta aba (uma sincronizacao, um /save de outra
   janela): zera a carga e reabre o simbolo que estava na tela ja com a versao nova. Edicao nao
   salva se perde, entao quem chama avisa o usuario antes — hoje quem chama e o recarregamento
   por disco da casca (hub.html), nao mais o aviso do Altium, que saiu em 2026-09-15. */
function reload() {
  /* DATA.cache e o que o loadSchlib consulta ANTES de baixar qualquer coisa: zerar so
     DATA.schlib nao recarregava NADA — a linha seguinte devolvia o mesmo objeto do cache e o
     painel continuava na geracao anterior. O cache inteiro sai (os outros acervos tambem
     estao velhos: o guardiao reescreve a familia protegida do almoxarifado junto). */
  DATA.schlib = null; DATA.loading = null; DATA.loadingId = null; DATA.schlibErro = '';
  DATA.cache = {};
  /* a Biblioteca de simbolos de baixo (os tiles, Libs/symbols-lib.js) tambem e um arquivo de
     Libs\ e tambem e reescrita — sem zerar symlib/libLoading os tiles ficavam velhos ate o F5 */
  DATA.symlib = null; DATA.libLoading = null; DATA.symlibMissing = false; IDXLIB = null;
  /* O SÍMBOLO EM EDIÇÃO SOBREVIVE. Salvar um símbolo grava Libs/symbols-lib.js, e a casca
     responde a essa gravação chamando este reload — que reabria só ST.sel (nulo no modo
     símbolo) e deixava o canvas vazio logo depois do Salvar. O símbolo salvo é reaberto da
     versão nova; o símbolo novo ainda não salvo (que por não ter edição chega aqui) fica. */
  const le = ST.libEd, rasc = le ? ST.draft : null;
  /* O QUE ESTAVA ABERTO VOLTA COMO ESTAVA: o componente (ST.sel é o nome DELE, que não é
     símbolo do espelho — reabrir só ST.sel esvaziava o canvas logo depois de um Aplicar ou de
     um Salvar de componente) e o tile marcado. A LINHA DE STATUS nem é tocada: a reabertura
     passa `manter`. Guardá-la aqui e devolvê-la no fim trazia de volta o "aplicando…" por cima
     do resultado do lote, que chega enquanto este reload carrega */
  const fam = ST.familia, val = ST.familia ? ST.sel : null, sel = ST.libSel;
  /* o modo de agora: se ele mudar enquanto a carga voa (trocou-se de vista logo depois de
     salvar), o que estava aberto é de outro modo e não volta — reabri-lo puxaria a vista */
  const modo0 = ST.modo;
  ST.draft = null; ST.dirty = false; ST.selection = []; ST.undo = []; ST.redo = []; ST.draw = null;
  carregaVinculos(true);
  if (!UI) return Promise.resolve();
  /* as duas chaves de cache de DOM fora, senao refreshList/refreshLib acham que nada mudou
     e nao redesenham; o refreshAll refaz lista, barra, ficha E os tiles */
  listKey = ''; libKey = '';
  const devolve = () => {
    if (sel && libById(sel) && ST.libSel !== sel) { ST.libSel = sel; libKey = ''; refreshLib(); }
  };
  const p = Promise.all([loadSchlib(), loadSymlib()]).then(async () => {
    listKey = ''; libKey = ''; refreshAll();
    /* ALGUÉM ABRIU OUTRA COISA ENQUANTO ISTO CARREGAVA (o "Editar" logo depois de um Aplicar,
       que dispara este reload): é o que o usuário pediu por último, e reabrir o de antes por
       cima dele desfazia o clique */
    if (ST.draft || ST.modo !== modo0) return;
    if (le && le.id && libById(le.id)) { ST.libEd = le; await editarLib(le.id, true, true); devolve(); return; }
    if (le && rasc) {
      /* o símbolo sumiu da biblioteca enquanto isto carregava (excluído agora): o desenho da
         mesa fica, como símbolo novo não salvo — quem excluiu por engano ainda o salva */
      const sumiu = !!le.id;
      abreNoCanvasComoSimbolo({ id: null }, rasc, true);
      if (sumiu) { ST.dirty = true; refreshBar(); refreshAside(); }
      devolve(); return;
    }
    ST.libEd = null;
    if (fam && symByName(fam)) {
      await openSymbol(fam, true, true);
      if (val) await abrirValor(val, true);
      devolve(); return;
    }
    if (ST.sel) { await openSymbol(ST.sel, true, true); devolve(); }
  });
  DATA.recarga = p;
  const fim = () => { if (DATA.recarga === p) DATA.recarga = null; };
  p.then(fim, fim);
  return p;
}

/* Abrir um simbolo VINDO DE FORA (o "editar simbolo" do menu de contexto da aba Sch Lib).
   Nao serve mexer em `state.sel` de fora: o unico ponto que honra um ST.sel externo e o
   `.then` do PRIMEIRO loadSchlib dentro de render(), entao isso funcionaria uma vez — com
   a aba nunca aberta — e viraria no-op silencioso depois.
   Espera a schlib chegar antes de abrir, e devolve Promise porque openSymbol pode PARAR
   para perguntar se descarta a edicao nao salva: quem chama nao pode assumir que abriu. */
async function abrir(name, force, componente, acervo) {
  if (!name) return false;
  /* ABRIR CATEGORIA/COMPONENTE É DO MODO COMPONENTES. Quem chama de fora (o #/libsym, o
     "Editar símbolo ↗" da vista Esquema) já pediu a vista Componentes antes, e aí isto não
     faz nada; se o modo ainda é o outro, a troca está esperando a resposta do usuário (ou
     foi recusada) — e abrir por cima misturaria uma categoria com a lista de símbolos */
  if (ST.modo !== 'componentes') {
    const ok = await modo('componentes');
    if (!ok || ST.modo !== 'componentes') return false;
  }
  /* ACERVO PRIMEIRO. Uma familia do almoxarifado nao existe no espelho do Altium: sem trocar
     o acervo, o openSymbol nao acha nada e o sintoma engana — a aba abre, ST.sel fica com o
     nome certo e o desenho vem VAZIO. O setAcervo limpa a selecao de proposito, entao ele
     tem de vir antes de qualquer carga. */
  if (acervo && acervo.id) setAcervo(acervo);
  /* A FAIXA E OUTRO ARQUIVO E OUTRA CARGA. Sem esperar por ela, esta funcao resolve com a
     faixa ainda em "carregando…" e nao ha em que pre-selecionar. Disparada em PARALELO com a
     schlib: nenhuma das duas espera a outra, e o loadSymlib devolve a mesma promessa se ja
     houver carga em voo. */
  const libPronta = loadSymlib().catch(() => null);
  /* E DE NOVO DEPOIS DE CADA ESPERA: a carga do acervo leva segundos (3,2 MB no Almoxarifado
     — Todos), e nesse meio o usuário pode ter ido para a vista Símbolos — que, sem edição,
     troca na hora. Abrir a categoria ali jogaria fora o símbolo que ela acabou de reabrir. */
  const outroModo = () => ST.modo !== 'componentes';
  /* loadSchlib() devolve a MESMA promessa quando ja ha uma carga em voo, entao isto
     cobre os dois casos: nunca carregou, e carregando agora. */
  if (!DATA.schlib) await loadSchlib().catch(() => {});
  if (outroModo()) return false;
  listKey = '';
  await openSymbol(String(name), force);
  if (outroModo()) return false;
  const ok = ST.sel === String(name) && !!ST.draft;
  /* COMPONENTE do almoxarifado (um `valores[].altium`): o abrirValor le familiaAberta(),
     entao a familia precisa ja estar aberta — por isso ele vem DEPOIS do openSymbol, e
     nao no lugar dele. Quem chama de fora manda os dois e nao precisa saber dessa ordem.
     Sem componente, o comportamento e o de antes: abre a familia e para ali. */
  let okv = true;
  if (ok && componente) okv = await abrirValor(String(componente));
  await libPronta;
  if (outroModo()) return false;
  /* POR ULTIMO: o abrirValor chama refreshAll(), que chama refreshLib — o que a pre-selecao
     escrevesse antes dele seria desfeito pelo cache de DOM. */
  if (ok) preSelecionarNaFaixa(String(name), okv ? componente : null);
  return ok && okv;
}

/* TRES estados, de proposito: true = existe no espelho, false = nao existe, null = a
   schlib ainda nao foi carregada e portanto NAO DA PARA SABER. Um booleano so fazia a
   casca desabilitar "editar simbolo" toda vez que a aba Componentes nunca tivesse sido
   aberta — que e justamente o caso comum de quem vem pelo menu de contexto. */
const conhece = name => (DATA.schlib ? !!symByName(String(name || '')) : null);

/* Abrir a faixa de baixo numa aba específica, DE FORA. Existe para a vista Biblioteca
   (hub-libview.js), que desde 2026-09-17 quer a lista de VALORES da família no lugar onde
   ela sempre esteve — a aba "Componentes" — em vez de repetida noutra caixa.

   Não é `state.faixa = x` de fora porque trocar a faixa tem três efeitos além do valor:
   zera o recorte (libIds), apaga a nota e invalida o cache de DOM (libKey). Sem eles a
   faixa troca e a tela não. Mesmo trio que o clique na aba faz (refreshLib » a barra).

   Família sem valores não tem o que mostrar, e o próprio refreshLib já devolve para
   "simbolos" nesse caso — então aqui não se checa nada: quem manda é ele. */
function faixa(qual) {
  if (qual !== 'simbolos' && qual !== 'componentes') return false;
  if (ST.faixa === qual) return true;
  ST.faixa = qual; ST.libIds = null; ST.faixaNota = ''; libKey = '';
  refreshLib();
  return ST.faixa === qual;      /* false = a família não tinha valores e ele voltou */
}

/* `modo` e `editarLib` são o que a Biblioteca (hub-libview.js) usa para as vistas Componentes
   e Símbolos: trocar o modo antes de trocar a vista, e abrir um símbolo na vista Símbolos */
return { render, dirty, reload, pure, abrir, conhece, faixa, modo, editarLib, state: ST, actions,
         cam: () => (CAM ? CAM.cam : null), confirmar, pedirTexto };
});
