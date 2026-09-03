/* AltiumPCBMirror v2 - hub-symed.js — editor de símbolos (sub-aba Símbolos da Biblioteca).

   Três colunas, como a sub-aba Sch Lib: a lista do espelho à esquerda, o editor no meio e a
   ficha à direita. O meio empilha o canvas com as ferramentas e, embaixo, a Biblioteca de
   símbolos (Libs/symbols-lib.js) — corpos genéricos e de CI que se aplicam ao símbolo aberto
   com um clique, porque o que mais se quer aqui é TROCAR O DESENHO sem mexer na pinagem.

   Contrato com a casca (hub.html): render(opts) pode ser chamado toda vez que a sub-aba
   aparece — o DOM nasce uma vez e só é atualizado; dirty() diz se há edição não salva.
   As funções puras (snap, hitTest, moveItem, rotateAll, mirrorAll, serializeSymbol,
   applyLibSymbol, nextPinNum...) ficam em `pure` para tests/test-symed.js rodar em Node —
   por isso nada de DOM fora de função.

   Coordenadas: mil, Y para cima, pino = ponta do CORPO em (x,y) e ponta quente em
   (x,y) + len·dir(orient) — o mesmo vocabulário schlib-v2 que hub-draw.js desenha. */
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

function snap(v, step) { const s = step > 0 ? step : 1; return Math.round(v / s) * s; }
function pinHot(p) { const d = OD[norm360(p.orient)] || [1, 0]; return { x: p.x + d[0]*p.len, y: p.y + d[1]*p.len }; }
/* pinos vivem em múltiplo de 10 mil (o Altium guarda 10 mil + fração); a grade da folha é
   100 e é onde a ponta quente tem de cair para o fio conectar — daí o aviso amarelo */
function pinSnapOf(step) { return (step > 0 && step % 10 === 0) ? step : 100; }
function pinsOffGrid(pins) {
  return (pins || []).filter(p => { const h = pinHot(p); return Math.abs(h.x % 100) > 1e-6 || Math.abs(h.y % 100) > 1e-6; });
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

function moveItem(item, dx, dy) {
  const o = clone(item);
  if (o.g == null) { o.x += dx; o.y += dy; return o; }          /* pino */
  switch (o.g) {
    case 'line': case 'rect': o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; break;
    case 'arc': case 'ellipse': o.cx += dx; o.cy += dy; break;
    case 'poly': case 'polyline': o.pts = (o.pts || []).map(p => [p[0] + dx, p[1] + dy]); break;
    case 'label': o.x += dx; o.y += dy; break;
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

/* o registro binário do pino só guarda inteiros de 10 mil: o que sair daqui fora disso o
   PATCH arredondaria sozinho e o espelho ficaria diferente da SchLib até o próximo --espelho */
const mil10 = v => Math.round(num(v) / 10) * 10;
function cleanPin(p) {
  return { num: String(p.num == null ? '' : p.num), name: String(p.name == null ? '' : p.name),
           x: mil10(p.x), y: mil10(p.y), len: mil10(num(p.len, 100)),
           orient: norm360(Math.round(num(p.orient) / 90) * 90),
           type: PIN_TYPES.indexOf(p.type) >= 0 ? p.type : 'Passive' };
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
function cleanGraphic(g) {
  switch (g.g) {
    case 'line': return { g: 'line', x1: r3(num(g.x1)), y1: r3(num(g.y1)), x2: r3(num(g.x2)), y2: r3(num(g.y2)), w: normW(g.w) };
    case 'rect': return normRect(Object.assign({ g: 'rect', x1: r3(num(g.x1)), y1: r3(num(g.y1)), x2: r3(num(g.x2)), y2: r3(num(g.y2)) }, wOpc(g), { solid: !!g.solid }));
    case 'arc': return normArc({ g: 'arc', cx: r3(num(g.cx)), cy: r3(num(g.cy)), r: r3(Math.abs(num(g.r))), sa: r3(num(g.sa)), ea: r3(g.ea == null ? 360 : num(g.ea)), w: normW(g.w) });
    case 'ellipse': return Object.assign({ g: 'ellipse', cx: r3(num(g.cx)), cy: r3(num(g.cy)), rx: r3(Math.abs(num(g.rx))), ry: r3(Math.abs(num(g.ry))) }, wOpc(g), { solid: !!g.solid });
    case 'poly': return Object.assign({ g: 'poly', pts: (g.pts || []).map(p => [r3(num(p[0])), r3(num(p[1]))]) }, wOpc(g), { solid: !!g.solid });
    case 'polyline': return { g: 'polyline', pts: (g.pts || []).map(p => [r3(num(p[0])), r3(num(p[1]))]), w: normW(g.w) };
    case 'label': return { g: 'label', x: r3(num(g.x)), y: r3(num(g.y)), text: String(g.text == null ? '' : g.text),
                           rot: norm360(Math.round(num(g.rot) / 90) * 90), size: Math.max(1, Math.round(num(g.size, 10))) };
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
    pins.forEach((p, i) => { p.num = orig[i].num; p.name = orig[i].name; if (orig[i].type) p.type = orig[i].type; });
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

const pure = { snap, pinHot, pinSnapOf, pinsOffGrid, segDist, pointInPoly, angleIn, labelBox, hitTest, hitGraphic,
               moveItem, moveVertex, rotateAll, mirrorAll, bbox, serializeSymbol, applyLibSymbol, nextPinNum,
               cleanPin, cleanGraphic, normW, normArc, mil10, PIN_TYPES, WIDTHS };

/* ═══════════════════════ estado do painel (fora do DOM) ═══════════════════════ */

const SNAPS = [10, 25, 50, 100];
const SEP = String.fromCharCode(1);   /* separador das chaves de "o que mudou" — nunca aparece num nome */
const TOOLS = [
  ['select', 'Sel', 'V', 'selecionar / mover (V, Esc)'],
  ['line', 'Lin', 'L', 'linha (L)'],
  ['rect', 'Ret', 'R', 'retângulo (R)'],
  ['polyline', 'Pol', 'P', 'polilinha (P) — duplo clique, botão direito ou Enter fecha'],
  ['poly', 'Plg', 'G', 'polígono (G) — duplo clique, botão direito ou Enter fecha'],
  ['arc', 'Arc', 'A', 'arco / círculo (A): centro, depois raio; sa/ea na ficha'],
  ['ellipse', 'Eli', 'E', 'elipse (E): centro, depois canto'],
  ['label', 'Txt', 'T', 'texto (T)'],
  ['pin', 'Pin', 'N', 'pino (N) — R gira durante a colocação'],
  ['delete', 'Exc', 'Del', 'excluir o que clicar (Delete apaga a seleção)'],
];
const ST = {
  sel: null, part: 1, tool: 'select', selection: null, undo: [], redo: [], draft: null, dirty: false,
  q: '', kind: 'all', libQ: '', libSel: null,
  snap: 100, grid: true, draw: null, mouse: null, pinRot: 0, note: '', fitPending: false,
  drag: null, saved: new Set(),   /* salvos nesta sessão; "modificado" = salvo ou o aberto com edição */
  saving: false,                  /* POST /save em voo: o botão fica travado mesmo que a ficha seja refeita */
};
/* schlibErro / symlibMissing: carga que falhou fica como null (não como lista vazia) para o
   próximo render() tentar de novo — senão um 404 vira "0 símbolos" até o F5 */
const DATA = { schlib: null, symlib: null, loading: null, libLoading: null, bust: 0, schlibErro: '', symlibMissing: false };
let O = null;      /* opts do último render: root, toast, onSaved... */
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
function loadSchlib() {
  if (DATA.schlib) return Promise.resolve(DATA.schlib);
  if (!DATA.loading) DATA.loading = loadVarScript('Libs/schlib.js', 'schlib').then(v => {
    DATA.schlib = v && v.symbols ? v : null;
    DATA.schlibErro = DATA.schlib ? '' : 'não carregou Libs/schlib.js — o servidor está de pé? (troque de aba para tentar de novo)';
    DATA.loading = null;
    return DATA.schlib;
  });
  return DATA.loading;
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
function selItem() {
  const p = curPart(), s = ST.selection; if (!p || !s) return null;
  return s.kind === 'pin' ? (p.pins[s.idx] || null) : (p.graphics[s.idx] || null);
}
function setItem(item) {
  const p = curPart(), s = ST.selection; if (!p || !s) return;
  if (s.kind === 'pin') p.pins[s.idx] = item; else p.graphics[s.idx] = item;
}
/* a descrição entra no snapshot porque a ficha a edita pelo mesmo undo dos gráficos */
const snapshot = () => ({ part: ST.part, parts: clone(ST.draft.parts), selection: clone(ST.selection), description: ST.draft.description });
function restore(sn) { ST.draft.parts = sn.parts; ST.part = sn.part; ST.selection = sn.selection; ST.draft.description = sn.description; }
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

function openSymbol(name, force) {
  if (ST.sel === name && ST.draft) return;
  if (ST.dirty && !force && !confirm('Há edição não salva em "' + ST.sel + '". Descartar e abrir "' + name + '"?')) return;
  const s = symByName(name);
  ST.sel = name; ST.draft = s ? clone(s) : null; ST.part = 1;
  ST.undo = []; ST.redo = []; ST.dirty = false; ST.selection = null; ST.draw = null; ST.note = '';
  ST.fitPending = true;
  refreshAll(); fitSeNecessario();
}

/* ═══════════════════════ DOM ═══════════════════════ */

const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const btn = (cls, txt, on, title) => { const b = el('button', 'btn ' + cls, txt); b.type = 'button'; b.onclick = on; if (title) b.title = title; return b; };
const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function build(rootEl) {
  UI = { root: rootEl };
  rootEl.textContent = '';
  const grid = el('div', 'lib-grid symed-grid');

  /* ── esquerda: busca · recorte · resumo · lista ── */
  const left = el('div', 'lib-left');
  const bar = el('div', 'lib-bar');
  UI.q = el('input', 'input'); UI.q.type = 'text'; UI.q.placeholder = 'Buscar símbolo…'; UI.q.value = ST.q;
  UI.q.oninput = () => { ST.q = UI.q.value; refreshList(); };
  UI.seg = el('div', 'seg');
  bar.append(UI.q, UI.seg);
  UI.sum = el('div', 'lib-sum');
  UI.list = el('div', 'scroll lib-list');
  left.append(bar, UI.sum, UI.list);

  /* ── meio: barra · canvas · rodapé · biblioteca de símbolos ── */
  const mid = el('div', 'symed-mid');
  const cb = el('div', 'canvas-bar');
  UI.name = el('span', 'meta symed-name', '—');
  UI.partSel = el('select', 'input'); UI.partSel.hidden = true; UI.partSel.title = 'parte do símbolo';
  UI.partSel.onchange = () => { ST.part = parseInt(UI.partSel.value, 10) || 1; ST.selection = null; ST.draw = null; ST.fitPending = true; refreshAll(); fitSeNecessario(); };
  UI.tools = el('div', 'seg symed-tools');
  TOOLS.forEach(([id, rot, key, title]) => {
    const b = el('button', null, rot); b.type = 'button'; b.title = title; b.dataset.tool = id;
    b.append(el('span', 'n', key));
    b.onclick = () => setTool(id);
    UI.tools.append(b);
  });
  cb.append(el('span', 'ttl', 'editor'), UI.name, UI.partSel, UI.tools);

  UI.vp = el('div', 'viewport sheet symed-vp');
  UI.cv = el('canvas');
  UI.hint = el('div', 'hint');
  UI.vp.append(UI.cv, UI.hint);
  UI.cv.addEventListener('contextmenu', e => { e.preventDefault(); if (ST.draw) finishDraw(); });
  UI.cv.addEventListener('dblclick', e => { e.preventDefault(); if (ST.draw) { descartaJitter(); finishDraw(); } });

  const foot = el('div', 'symed-foot');
  UI.coord = el('span', null, 'x — · y — mil');
  UI.status2 = el('span', null, '');
  /* as ações que valem para o símbolo inteiro moram no rodapé, para a barra de cima
     caber numa linha só com as ferramentas */
  const fr = el('div', 'right');
  const acts = el('div', 'seg');
  const act = (rot, on, title) => { const b = el('button', null, rot); b.type = 'button'; b.title = title; b.onclick = on; acts.append(b); return b; };
  UI.bUndo = act('↶', undo, 'desfazer (Ctrl+Z)');
  UI.bRedo = act('↷', redo, 'refazer (Ctrl+Y)');
  act('⟲ 90°', girarTudo, 'girar tudo 90° anti-horário (Ctrl+R)');
  act('⇄', espelharTudo, 'espelhar tudo em X (Ctrl+M)');
  act('ajustar', () => fit(), 'enquadrar o símbolo (F)');
  UI.bGrid = act('grade', () => { ST.grid = !ST.grid; refreshBar(); redraw(); }, 'mostrar / esconder a grade');
  fr.append(el('span', null, 'snap'));
  UI.snapSel = el('select', 'input');
  SNAPS.forEach(s => { const o = el('option', null, s + ' mil'); o.value = String(s); if (s === ST.snap) o.selected = true; UI.snapSel.append(o); });
  UI.snapSel.onchange = () => { ST.snap = parseInt(UI.snapSel.value, 10) || 100; refreshBar(); };
  fr.append(UI.snapSel, acts);
  foot.append(UI.coord, UI.status2, fr);

  const lb = el('div', 'symed-libbar');
  UI.libQ = el('input', 'input'); UI.libQ.type = 'text'; UI.libQ.placeholder = 'buscar na biblioteca de símbolos…'; UI.libQ.value = ST.libQ;
  UI.libQ.oninput = () => { ST.libQ = UI.libQ.value; refreshLib(); };
  UI.libCount = el('span', 'count', '');
  const lr = el('div', 'right');
  UI.bLibAdd = btn('btn-secondary btn-sm', '+ corpo atual', adicionarCorpo, 'guarda o desenho da parte aberta na biblioteca de símbolos');
  UI.bLibApply = btn('btn-primary btn-sm', 'Aplicar ao símbolo', aplicarLib, 'troca o desenho da parte aberta pelo símbolo escolhido (a pinagem fica se a contagem bater)');
  UI.bLibRen = btn('btn-secondary btn-sm', 'Renomear', renomearLib);
  UI.bLibDel = btn('btn-secondary btn-sm', 'Excluir', excluirLib);
  lr.append(UI.bLibAdd, UI.bLibApply, UI.bLibRen, UI.bLibDel);
  lb.append(el('span', 'kicker', 'biblioteca de símbolos'), UI.libQ, UI.libCount, lr);
  UI.tiles = el('div', 'symed-tiles');
  mid.append(cb, UI.vp, foot, lb, UI.tiles);

  /* ── direita: ficha ── */
  UI.aside = el('aside', 'symed-aside');

  grid.append(left, mid, UI.aside);
  rootEl.append(grid);

  CAM = HubDraw.mkCamera(UI.cv, drawWorld, {
    bg: tok('--sheet') || HubDraw.SCH.sheet,
    onDragStart: dragStart, onDrag: dragMove, onDragEnd: dragEnd, onClick: click, onMove: move,
  });
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
  const key = [ST.q, ST.kind, ST.sel, nMod(), syms.length, ST.dirty, DATA.schlib ? 1 : 0, DATA.schlibErro].join(SEP);
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

  UI.sum.textContent = '';
  const stat = (n, rot, tone) => { const s = el('span'); const b = el('b', null, String(n)); if (tone) b.style.color = 'var(--' + tone + ')'; s.append(b, document.createTextNode(' ' + rot)); UI.sum.append(s); };
  stat(syms.length, 'símbolos'); stat(noFp.length, 'sem footprint', noFp.length ? 'warn' : null);
  stat(nMod(), 'modificados nesta sessão');
  if (DATA.schlib) UI.sum.title = 'schlib: ' + (DATA.schlib.source || '—') + '  (' + (DATA.schlib.generated || '—') + ')';

  const rows = syms.filter(s => hit(s) && (ST.kind === 'all' || (ST.kind === 'nofp' ? semFp(s) : isMod(s.name))));
  UI.list.textContent = '';
  const frag = document.createDocumentFragment();
  if (!DATA.schlib) frag.append(el('div', 'lib-head', DATA.schlibErro || 'carregando o espelho…'));
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
  UI.bGrid.setAttribute('aria-pressed', String(ST.grid));
  UI.hint.textContent = !DATA.schlib ? (DATA.schlibErro || 'carregando o espelho…') : !d ? 'escolha um símbolo na lista'
    : (!p.graphics.length && !p.pins.length ? 'parte vazia — desenhe, ou aplique um corpo da biblioteca' : '');
  UI.cv.style.cursor = !d ? 'default' : ST.tool === 'select' ? 'default' : ST.tool === 'delete' ? 'pointer' : 'crosshair';
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

/* ── ficha (aside) ── */
function refreshAside() {
  if (!UI) return;
  const a = UI.aside; a.textContent = '';
  const d = ST.draft;
  const p = el('p'); p.style.cssText = 'font-size:12px;color:var(--text-3);margin:6px 0 12px;line-height:1.5';
  if (!d) {
    a.append(el('div', 'kicker', 'editor de símbolos'));
    p.textContent = 'Escolha um símbolo do espelho para editar a geometria e os pinos. Salvar grava no espelho '
      + '(Libs/schlib.js) e, marcando Altium, na SchLib real — com backup. A biblioteca de símbolos embaixo do '
      + 'canvas guarda corpos prontos: clique num e aplique para trocar o desenho sem mexer na pinagem.';
    a.append(p);
    return;
  }
  const part = curPart();
  a.append(el('div', 'kicker', 'símbolo'));
  const h = el('div', 'det-head'); const nm = el('span', 'd', d.name); nm.style.cssText = 'font-size:16px;word-break:break-word;line-height:1.3'; h.append(nm); a.append(h);
  const desc = el('input', 'input'); desc.value = d.description || ''; desc.placeholder = 'descrição'; desc.title = 'descrição do componente';
  desc.style.cssText = 'margin-top:6px;min-height:28px;font-size:12px';
  desc.onchange = () => { pushUndo(); d.description = desc.value; touched(); refreshBar(); refreshList(); };
  a.append(desc);
  const kvs = el('div'); kvs.style.marginTop = '8px';
  kv(kvs, 'Partes', (d.parts || []).length); kv(kvs, 'Pinos', part.pins.length); kv(kvs, 'Gráficos', part.graphics.length);
  a.append(kvs);
  const fps = d.footprints || [];
  a.append(el('div', 'kicker', 'footprints'));
  const chips = el('div', 'chips'); chips.style.margin = '6px 0 10px';
  if (!fps.length) chips.append(el('span', 'tag', 'nenhum'));
  fps.forEach(f => { const c = el('span', 'tag mono' + (f.incurrentlib ? '' : ' gone'), f.name + (f.current ? ' ✓' : '')); if (!f.incurrentlib) c.style.color = 'var(--err)'; chips.append(c); });
  a.append(chips);

  const off = pinsOffGrid(part.pins);
  if (off.length) {
    const w = el('div', 'symed-warn', 'ponta quente fora da grade de 100 mil: ' + off.map(x => x.num).join(', ')
      + ' — o fio não vai encostar no Altium');
    a.append(w);
  }
  /* pino que veio com fração (PinFrac) ou digitado fora de 10 mil: o que vai para a SchLib é
     o arredondado, e é bom o usuário saber antes de salvar */
  const frac = part.pins.filter(p => ['x', 'y', 'len'].some(k => mil10(p[k]) !== num(p[k])));
  if (frac.length) a.append(el('div', 'symed-warn', 'pino fora da grade de 10 mil: ' + frac.map(x => x.num).join(', ')
    + ' — ao salvar vai arredondado (o Altium só guarda 10 mil no pino)'));
  if (ST.note) a.append(el('div', 'symed-note', ST.note));

  /* seleção */
  a.append(el('div', 'kicker', 'seleção'));
  const it = selItem();
  if (!it) { const q = el('p', null, 'clique num pino ou gráfico do canvas'); q.style.cssText = 'font-size:12px;color:var(--text-4);margin:6px 0 10px'; a.append(q); }
  else a.append(fieldsFor(it));

  const acts = el('div', 'symed-acts');
  acts.append(btn('btn-secondary btn-sm', 'Desfazer', undo), btn('btn-secondary btn-sm', 'Refazer', redo));
  if (it) acts.append(btn('btn-secondary btn-sm', 'Excluir item', deleteSelection));
  a.append(acts);

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
function kv(box, k, v) { const r = el('div', 'kv'); r.append(el('span', 'k', k), el('span', 'v', String(v))); box.append(r); }
function setStatus(msg, kind) { UI.statusMsg = msg; UI.statusKind = kind || ''; if (UI.status) { UI.status.textContent = msg; UI.status.className = 'symed-status ' + (kind || ''); } }

/* campos editáveis do item selecionado; cada mudança passa pelo undo */
function fieldsFor(it) {
  const box = el('div', 'symed-fields');
  const apply = fn => { pushUndo(); const o = clone(selItem()); fn(o); setItem(o); touched(); refreshBar(); refreshAside(); redraw(); };
  const F = (rot, val, on, o) => {
    const l = el('label', null, rot);
    let inp;
    if (o && o.opts) {
      inp = el('select', 'input');
      o.opts.forEach(v => { const op = el('option', null, String(v)); op.value = String(v); if (String(v) === String(val)) op.selected = true; inp.append(op); });
    } else if (o && o.check) { inp = el('input'); inp.type = 'checkbox'; inp.checked = !!val; inp.style.cssText = 'width:15px;height:15px;accent-color:var(--hi)'; }
    else { inp = el('input', 'input'); inp.type = o && o.text ? 'text' : 'number'; inp.value = val == null ? '' : val; if (o && o.step) inp.step = String(o.step); }
    inp.onchange = () => on(o && o.check ? inp.checked : inp.value);
    box.append(l, inp);
  };
  const N = (k, step, fix) => F(k, it[k], v => apply(o => { o[k] = num(v); if (fix) fix(o); }), { step: step || 1 });
  if (it.g == null) {
    /* step é só dica do <input>: quem garante os 10 mil é o mil10 na hora de aplicar */
    const p10 = o => { o.x = mil10(o.x); o.y = mil10(o.y); o.len = mil10(o.len); };
    box.append(el('div', 'kicker', 'pino'), el('span'));
    F('número', it.num, v => apply(o => { o.num = v; }), { text: true });
    F('nome', it.name, v => apply(o => { o.name = v; }), { text: true });
    N('x', 10, p10); N('y', 10, p10); N('len', 10, p10);
    F('orient', it.orient, v => apply(o => { o.orient = num(v); }), { opts: [0, 90, 180, 270] });
    F('tipo', it.type, v => apply(o => { o.type = v; }), { opts: PIN_TYPES });
    return box;
  }
  box.append(el('div', 'kicker', it.g), el('span'));
  const W = () => F('largura', normW(it.w), v => apply(o => { o.w = num(v); }), { opts: WIDTHS });
  /* rect/ellipse/poly sem w é "a largura que já está na SchLib" (o leitor não a exporta);
     só vira número quando o usuário escolhe — daí a opção 'padrão' */
  const PADRAO = 'padrão';
  const Wp = () => F('largura', it.w == null ? PADRAO : normW(it.w), v => apply(o => { if (v === PADRAO) delete o.w; else o.w = num(v); }), { opts: [PADRAO].concat(WIDTHS) });
  const S = () => F('sólido', it.solid, v => apply(o => { o.solid = !!v; }), { check: true });
  switch (it.g) {
    case 'line': N('x1'); N('y1'); N('x2'); N('y2'); W(); break;
    case 'rect': N('x1'); N('y1'); N('x2'); N('y2'); Wp(); S(); break;
    case 'arc': N('cx'); N('cy'); N('r'); N('sa', 1, normArc); N('ea', 1, normArc); W(); break;
    case 'ellipse': N('cx'); N('cy'); N('rx'); N('ry'); Wp(); S(); break;
    case 'poly': F('vértices', (it.pts || []).length, () => {}, { text: true }); Wp(); S(); break;
    case 'polyline': F('vértices', (it.pts || []).length, () => {}, { text: true }); W(); break;
    case 'label':
      F('texto', it.text, v => apply(o => { o.text = v; }), { text: true });
      N('x'); N('y'); N('size');
      F('rot', it.rot || 0, v => apply(o => { o.rot = num(v); }), { opts: [0, 90, 180, 270] });
      break;
  }
  return box;
}

/* ── paleta da biblioteca de símbolos ── */
let libKey = '';
function refreshLib() {
  if (!UI) return;
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
    t.onclick = () => { ST.libSel = ST.libSel === s.id ? null : s.id; refreshLib(); };
    t.ondblclick = () => { ST.libSel = s.id; aplicarLib(); };
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
  /* grade: fina de 10 só quando cabe (≥ 5 px), forte de 100 quando ≥ 8 px — senão vira mancha */
  if (ST.grid) {
    const gridLines = (step, color, lw) => {
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = lw * px;
      for (let x = Math.floor(v.x1 / step) * step; x <= v.x2; x += step) { ctx.moveTo(x, v.y1); ctx.lineTo(x, v.y2); }
      for (let y = Math.floor(v.y1 / step) * step; y <= v.y2; y += step) { ctx.moveTo(v.x1, y); ctx.lineTo(v.x2, y); }
      ctx.stroke();
    };
    if (10 * sc >= 5) gridLines(10, '#f0eedb', 1);
    if (100 * sc >= 8) gridLines(100, HubDraw.SCH.grid, 1);
  }
  /* cruz da origem: é a âncora do componente na folha */
  ctx.beginPath(); ctx.strokeStyle = HubDraw.SCH.border; ctx.lineWidth = 1.5 * px;
  ctx.moveTo(-60, 0); ctx.lineTo(60, 0); ctx.moveTo(0, -60); ctx.lineTo(0, 60); ctx.stroke();

  const p = curPart(); if (!p) return;
  HubDraw.drawSymbolPart(ctx, p);
  /* nome por dentro do corpo, número (o drawSymbolPart já põe) por fora, e a ponta quente marcada */
  for (const pin of p.pins) {
    const d = OD[norm360(pin.orient)] || [1, 0], h = pinHot(pin);
    ctx.fillStyle = '#c00000'; ctx.beginPath(); ctx.arc(h.x, h.y, Math.max(6, 3.5 * px), 0, 2*Math.PI); ctx.fill();
    if (pin.name) {
      const vert = d[1] !== 0;
      const align = (d[0] > 0 || d[1] > 0) ? 'right' : 'left';
      HubDraw.worldText(ctx, pin.name, pin.x - d[0]*15, pin.y - d[1]*15, 45, vert ? 90 : 0, HubDraw.SCH.body, align);
    }
  }
  const it = selItem();
  if (it) drawHL(ctx, it, px);
  if (ST.draw) drawRubber(ctx, px);
}
function drawHL(ctx, it, px) {
  const hl = HubDraw.SCH.hl;
  ctx.save();
  if (it.g == null) {
    const h = pinHot(it);
    ctx.strokeStyle = hl; ctx.lineWidth = 4 + 5 * px; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(it.x, it.y); ctx.lineTo(h.x, h.y); ctx.stroke();
    ctx.fillStyle = hl; ctx.beginPath(); ctx.arc(it.x, it.y, 5 * px, 0, 2*Math.PI); ctx.fill();
  } else if (it.g === 'label') {
    const b = labelBox(it);
    ctx.strokeStyle = hl; ctx.lineWidth = 1.5 * px; ctx.setLineDash([6*px, 4*px]);
    ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
  } else {
    const g = clone(it); g.w = (g.w || 6) + 5 * px; g.solid = false;
    HubDraw.drawSymbolPart(ctx, { graphics: [g] }, { stroke: hl });
    if (g.pts) { ctx.fillStyle = hl; g.pts.forEach(pt => { ctx.beginPath(); ctx.rect(pt[0] - 4*px, pt[1] - 4*px, 8*px, 8*px); ctx.fill(); }); }
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

/* ═══════════════════════ mouse ═══════════════════════ */

const stepFor = kind => kind === 'pin' ? pinSnapOf(ST.snap) : ST.snap;
const snapPt = (w, kind) => { const s = stepFor(kind); return { x: snap(w.x, s), y: snap(w.y, s) }; };
const tol = () => Math.max(8, 8 / (CAM ? CAM.cam.scale : 1));

function dragStart(w) {
  if (!ST.draft || ST.tool !== 'select') return false;
  const p = curPart();
  const h = hitTest(p, w.x, w.y, tol());
  if (!h) return false;
  ST.selection = { kind: h.kind, idx: h.idx };
  const item = selItem();
  ST.drag = { start: w, orig: clone(item), vertex: h.vertex, snap: snapshot() };
  refreshAside(); redraw();
  return true;
}
function dragMove(w) {
  const d = ST.drag; if (!d) return;
  if (d.vertex != null) {
    const s = snapPt(w, 'g');
    setItem(moveVertex(d.orig, d.vertex, s.x, s.y));
  } else {
    const st = stepFor(ST.selection.kind);
    setItem(moveItem(d.orig, snap(w.x - d.start.x, st), snap(w.y - d.start.y, st)));
  }
  redraw();
}
function dragEnd(moved) {
  const d = ST.drag; ST.drag = null; if (!d) return;
  if (!moved) return;
  ST.undo.push(d.snap); ST.redo.length = 0; touched();
  afterEdit();
}
function move(w) {
  ST.mouse = ST.draw ? snapPt(w, ST.draw.tool === 'pin' ? 'pin' : 'g') : w;
  if (UI) { const s = snapPt(w, ST.tool === 'pin' ? 'pin' : 'g'); UI.coord.textContent = 'x ' + s.x + ' · y ' + s.y + ' mil'; }
  if (ST.draw) redraw();
}
function click(w, e) {
  if (!ST.draft) return;
  const p = curPart();
  if (ST.tool === 'select') {
    const h = hitTest(p, w.x, w.y, tol());
    ST.selection = h ? { kind: h.kind, idx: h.idx } : null;
    refreshAside(); redraw();
    return;
  }
  if (ST.tool === 'delete') {
    const h = hitTest(p, w.x, w.y, tol());
    if (!h) return;
    ST.selection = { kind: h.kind, idx: h.idx };
    deleteSelection();
    return;
  }
  const s = snapPt(w, ST.tool === 'pin' ? 'pin' : 'g');
  if (ST.tool === 'pin') {
    pushUndo();
    p.pins.push({ num: nextPinNum(p.pins), name: '', x: s.x, y: s.y, len: 100, orient: ST.pinRot, type: 'Passive' });
    ST.selection = { kind: 'pin', idx: p.pins.length - 1 };
    touched(); afterEdit();
    return;
  }
  if (ST.tool === 'label') {
    const txt = prompt('Texto do rótulo', '');
    if (txt == null || !txt.trim()) return;
    pushUndo();
    p.graphics.push({ g: 'label', x: s.x, y: s.y, text: txt.trim(), rot: 0, size: 10 });
    ST.selection = { kind: 'g', idx: p.graphics.length - 1 };
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
  ST.selection = { kind: 'g', idx: p.graphics.length - 1 };
  touched(); afterEdit();
}
function cancelDraw() { if (ST.draw) { ST.draw = null; refreshBar(); redraw(); } }
function setTool(id) { ST.tool = id; cancelDraw(); refreshBar(); }

/* ═══════════════════════ ações ═══════════════════════ */

function deleteSelection() {
  const p = curPart(), s = ST.selection; if (!p || !s) return;
  pushUndo();
  (s.kind === 'pin' ? p.pins : p.graphics).splice(s.idx, 1);
  ST.selection = null; touched(); afterEdit();
}
function girarTudo() {
  const p = curPart(); if (!p) return;
  pushUndo(); Object.assign(p, rotateAll(p)); touched(); afterEdit();
}
function espelharTudo() {
  const p = curPart(); if (!p) return;
  pushUndo(); Object.assign(p, mirrorAll(p)); touched(); afterEdit();
}
function nudge(dx, dy) {
  const it = selItem(); if (!it) return;
  const st = stepFor(ST.selection.kind);
  pushUndo(); setItem(moveItem(it, dx * st, dy * st)); touched(); afterEdit();
}

async function salvar() {
  const d = ST.draft; if (!d || semServidor() || ST.saving) return;
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
  ST.note = r.note; ST.selection = null; touched(); afterEdit(); fit();
}
async function adicionarCorpo() {
  const p = curPart(); if (!p || semServidor()) return;
  if (!p.pins.length && !p.graphics.length) { O.toast('a parte está vazia — nada para guardar', 'warn'); return; }
  const sugerido = ST.draft.name.replace(/\[\s*(SMD|PTH)\s*\]/gi, '').replace(/\s+/g, ' ').trim();
  const name = prompt('Nome do corpo na biblioteca de símbolos', sugerido);
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
  const name = prompt('Novo nome', s.name);
  if (name == null || !name.trim() || name.trim() === s.name) return;
  const { status, j } = await api('lib', { op: 'rename', id: s.id, name: name.trim() });
  if (j && j.ok) { s.name = (j.symbol && j.symbol.name) || name.trim(); libKey = ''; refreshLib(); O.toast('renomeado', 'ok'); return; }
  O.toast((j && j.error) || ('não renomeou (HTTP ' + status + ')'), status === 409 ? 'warn' : 'err');
}
async function excluirLib() {
  const s = libById(ST.libSel); if (!s || semServidor()) return;
  if (!confirm('Excluir "' + s.name + '" da biblioteca de símbolos? Se a extração o encontrar de novo, ele volta.')) return;
  const { status, j } = await api('lib', { op: 'delete', id: s.id });
  if (j && j.ok) { DATA.symlib.symbols = libSyms().filter(x => x.id !== s.id); ST.libSel = null; refreshLib(); O.toast('excluído', 'ok'); return; }
  O.toast((j && j.error) || ('não excluiu (HTTP ' + status + ')'), 'err');
}

/* ═══════════════════════ teclado ═══════════════════════ */

function ativo() { return !!(UI && UI.root.isConnected && UI.root.offsetParent !== null); }
function onKey(e) {
  if (!ativo()) return;
  const tg = e.target, tag = tg && tg.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (tg && tg.isContentEditable)) return;
  const k = e.key, K = k.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && K === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (ctrl && (K === 'y' || (K === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
  /* sem símbolo aberto o Ctrl+R continua sendo o reload do navegador */
  if (ctrl && K === 'r' && ST.draft) { e.preventDefault(); girarTudo(); return; }
  if (ctrl && K === 'm' && ST.draft) { e.preventDefault(); espelharTudo(); return; }
  if (ctrl) return;
  if (k === 'Escape') { if (ST.draw) cancelDraw(); else if (ST.tool !== 'select') setTool('select'); else { ST.selection = null; refreshAside(); redraw(); } return; }
  if (k === 'Enter') { if (ST.draw) { e.preventDefault(); finishDraw(); } return; }
  if (k === 'Delete' || k === 'Backspace') { if (ST.selection) { e.preventDefault(); deleteSelection(); } return; }
  if (k.indexOf('Arrow') === 0) {
    if (!ST.selection) return;
    e.preventDefault();
    const m = e.shiftKey ? 10 : 1;
    nudge(k === 'ArrowLeft' ? -m : k === 'ArrowRight' ? m : 0, k === 'ArrowDown' ? -m : k === 'ArrowUp' ? m : 0);
    return;
  }
  if (K === 'r' && ST.tool === 'pin') { ST.pinRot = norm360(ST.pinRot + 90); refreshBar(); return; }
  if (K === 'f') { fit(); return; }
  const map = { v: 'select', l: 'line', r: 'rect', p: 'polyline', g: 'poly', a: 'arc', e: 'ellipse', t: 'label', n: 'pin' };
  if (map[K] && ST.draft) { e.preventDefault(); setTool(map[K]); }
}

/* ═══════════════════════ API para a casca ═══════════════════════ */

function render(opts) {
  O = opts || O || {};
  const rootEl = O.root;
  if (!rootEl) return;
  if (!UI || UI.root !== rootEl) build(rootEl);
  if (!DATA.schlib && !DATA.loading) loadSchlib().then(() => { listKey = ''; refreshAll(); if (ST.sel && !ST.draft) openSymbol(ST.sel, true); });
  if (!DATA.symlib && !DATA.libLoading) loadSymlib().then(() => { libKey = ''; refreshLib(); });
  /* a casca chama render() por troca de idioma, mudança no disco, goTab… se o usuário está
     digitando na ficha, refazer a aside apagaria o que ainda não passou pelo onchange */
  const digitando = UI.aside.contains(document.activeElement);
  refreshList(); refreshBar(); if (!digitando) refreshAside(); refreshLib();
  /* o pane acabou de ganhar tamanho: o canvas precisa medir antes de enquadrar */
  CAM.resize();
  fitSeNecessario();
}
const dirty = () => !!ST.dirty;

return { render, dirty, pure, state: ST };
});
