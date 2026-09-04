/* AltiumPCBMirror v2 - schframe.js — vista Esquema (le globals: schematic, schlib, pcblib). */
"use strict";
(function(){

const $ = id => document.getElementById(id);
const fatal = m => { const f = $('fatal'); f.style.display = 'flex'; f.textContent = m; };
if (typeof schematic === 'undefined') { fatal('schematic.js não encontrado para o projeto "' + SCH_P + '".'); return; }
function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

/* ------- acervos -------
   A folha pode referenciar simbolo da SchLib do Altium OU das bibliotecas do
   almoxarifado. SLIB precisa conter todos: e ele que o desenho, a extracao de nets e a
   validacao consultam — um simbolo de fora viraria quadrado vermelho e erro de
   validacao. O modal de adicionar e que separa por acervo, na hora de escolher. */
const _acervo = (g, id, titulo) => (g && g.symbols && g.symbols.length)
  ? { id, titulo: g.title || titulo, syms: g.symbols, almox: id !== 'altium' } : null;
const ACERVOS = [
  _acervo(typeof schlib         !== 'undefined' ? schlib         : null, 'altium', 'Biblioteca do Altium'),
  _acervo(typeof almoxBasicos   !== 'undefined' ? almoxBasicos   : null, 'almox-basicos', 'Almoxarifado — Básicos'),
  _acervo(typeof almoxEspeciais !== 'undefined' ? almoxEspeciais : null, 'almox-especiais', 'Almoxarifado — Especiais'),
].filter(Boolean);

const SLIB = { symbols: [] };
const ACERVO_DE = new Map();
for (const a of ACERVOS) for (const sy of a.syms) {
  if (ACERVO_DE.has(sy.name)) continue;      /* o do Altium ganha em caso de xara */
  ACERVO_DE.set(sy.name, a);
  SLIB.symbols.push(sy);
}

/* Na conversao para o Altium cada VALOR virou um componente proprio, com nome
   "SMD 0805 10K 1/8W". E esse nome que o schematic.js grava, porque e ele que existe
   la dentro. Aqui registramos cada um como um simbolo que REAPROVEITA a geometria da
   familia (mesma referencia de objeto, sem copia), para o hub desenhar, extrair nets e
   validar sem precisar saber da diferenca. */
const VALOR_DE = new Map();
for (const a of ACERVOS) {
  if (!a.almox) continue;
  for (const sy of a.syms) for (const v of (sy.valores || [])) {
    if (!v.altium || ACERVO_DE.has(v.altium)) continue;
    const alias = {
      name: v.altium, description: (v.itens && v.itens[0] && v.itens[0].nome) || v.label,
      designator: sy.designator, familia: sy.familia, partcount: 1,
      /* a geometria da familia, compartilhada — a nao ser que o VALOR traga a dele: e assim
         que o PNP deixa de ser desenhado com a seta do NPN sem partir a familia em duas */
      parts: v.parts || sy.parts,
      footprints: v.footprint ? [{ name: v.footprint, current: true, incurrentlib: true }]
                              : (sy.footprints || []),
      valores: [v], deValor: true,
    };
    ACERVO_DE.set(alias.name, a);
    VALOR_DE.set(alias.name, { sym: sy, valor: v });
    SLIB.symbols.push(alias);
  }
}
const PLIB = typeof pcblib  !== 'undefined' ? pcblib  : { footprints:[] };
/* antes de qualquer symbolOf: sem as tabelas o resolvedor casa so por nome exato e por
   chave, e metade dos componentes viraria quadrado vermelho na folha */
HubCore.setLibTables(typeof renameMap !== 'undefined' ? renameMap : null,
                     typeof libSubs   !== 'undefined' ? libSubs   : null);

let model = HubCore.buildSchModel(schematic);
let nets  = HubCore.extractNets(model, SLIB);
let val   = HubCore.validateSchematic(schematic, SLIB, PLIB);
let sheetIdx = 0, selNet = '';
const showState = { grid:true };
const ANN = (typeof annotations !== 'undefined' && Array.isArray(annotations))
  ? annotations.map(a => ({ ...a })) : [];
const ANN_COLORS = { err:'#ff5252', warn:'#ffd54f', info:'#4fc3f7' };
let annTool = false, annDirty = false, annPending = null, staleWorkspace = false;

/* ------- travamento de edicao -------
   Abre em LEITURA; editar exige o lapis. Igual ao pcbframe: o bloqueio fica nos pontos de
   ENTRADA (arrasto, modal, Delete, teclado), nunca no commit — nada chega a ser mexido na
   tela para depois ser recusado. Editar aqui e MOVER: componentes, fios e o resto do que
   esta na folha. Fio, label, power e texto novos quem escreve e a IA, no schematic.js. */
let editOn = false;

/* ------- selecao -------
   `sel` guarda os proprios objetos de schematic.items (comp, wire, netlabel, power,
   junction, text): e por identidade que o desenho, o arrasto e o Delete sabem quem esta
   marcado. O buildSchModel nao copia os itens, so os agrupa por folha, entao a identidade
   sobrevive ao reapply — mas nao ao undo, que reconstroi tudo do JSON (restoreItems limpa). */
const sel = new Set();
const SEL = '#2979ff';   /* azul da selecao — so no contorno tracejado, nunca no objeto */
let schDirty = false, schDiskSnapshot = null;
const undoStack = [JSON.stringify(schematic.items)], redoStack = [];
function snap100(v){ return Math.round(v / 100) * 100; }
const D = HubDraw;
const cv = $('cv');

function updateMeta(){
  $('meta').textContent = `${schematic.project} · ${model.sheets.length} folha(s) · ${nets.nets.length} nets`;
}
function reapply(){
  model = HubCore.buildSchModel(schematic);
  nets  = HubCore.extractNets(model, SLIB);
  val   = HubCore.validateSchematic(schematic, SLIB, PLIB);
  if (sheetIdx >= model.sheets.length) sheetIdx = 0;
  for (const it of Array.from(sel)) if (schematic.items.indexOf(it) < 0) sel.delete(it);
  /* a net em foco tambem pode ter deixado de existir (apagou o fio, desfez): destaque
     apontando para uma net que sumiu e cor sem dono na tela */
  if (selNet && !nets.nets.some(n => n.name === selNet)) selNet = '';
  buildCompTable(); buildNetList(); buildValList(); updateMeta(); updateSelStatus(); renderProps();
  cam.draw();
}
/* um Salvar so: grava o que estiver alterado, esquema e/ou sinalizadores */
function updateSaveBtn(){
  const d = schDirty || annDirty;
  $('btnSave').classList.toggle('active', d);
  $('btnSaveLbl').textContent = d ? 'Salvar *' : 'Salvar';
  $('savehint').textContent = d
    ? 'alterado: ' + [schDirty && 'esquema', annDirty && 'sinalizadores'].filter(Boolean).join(' e ')
    : 'nada pendente';
}
function setSchDirty(v){ schDirty = v; updateSaveBtn(); }
function setAnnDirty(v){ annDirty = v; updateSaveBtn(); }
function commit(){
  undoStack.push(JSON.stringify(schematic.items));
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  setSchDirty(true);
  reapply();
}
function restoreItems(json){
  schematic.items.length = 0;
  for (const it of JSON.parse(json)) schematic.items.push(it);
  sel.clear();
  selNet = '';         /* os itens sao outros objetos: o foco antigo nao tem mais dono */
  setSchDirty(true);
  reapply();
}
function undo(){ if (undoStack.length < 2) return; redoStack.push(undoStack.pop()); restoreItems(undoStack[undoStack.length - 1]); }
function redo(){ if (!redoStack.length) return; const s = redoStack.pop(); undoStack.push(s); restoreItems(s); }

/* ------- geometria da selecao ------- */
function sheetItems(){
  const s = model.sheets[sheetIdx];
  return [].concat(s.comps, s.wires, s.netlabels, s.powers, s.junctions, s.texts);
}
const onSheet = it => it.sheet === model.sheets[sheetIdx].name;
function compBBox(c){
  const sym = HubCore.symbolOf(SLIB, c.sym), part = HubCore.partOf(sym, c.part);
  const bb = part ? D.symBBox(part) : { x1:-100, y1:-100, x2:100, y2:100 };
  const tf = HubCore.compTransform(c);
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  for (const [lx, ly] of [[bb.x1, bb.y1], [bb.x2, bb.y1], [bb.x2, bb.y2], [bb.x1, bb.y2]]){
    const w = tf.map(lx, ly);
    if (w.x < x1) x1 = w.x; if (w.x > x2) x2 = w.x; if (w.y < y1) y1 = w.y; if (w.y > y2) y2 = w.y;
  }
  return { x1, y1, x2, y2 };
}
/* caixa de cada tipo de item, em mil — o mesmo alcance que o hitTest usa */
function itemBBox(it){
  switch (it.t){
    case 'comp': return compBBox(it);
    case 'wire': {
      let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
      for (const p of (it.pts || [])){ if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0]; if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1]; }
      return x1 > x2 ? { x1:0, y1:0, x2:0, y2:0 } : { x1, y1, x2, y2 };
    }
    case 'netlabel': return { x1:it.x - 20, y1:it.y - 20, x2:it.x + Math.max((it.net || '').length * 40, 120), y2:it.y + 80 };
    case 'power':    return { x1:it.x - 150, y1:it.y - 150, x2:it.x + 150, y2:it.y + 150 };
    case 'junction': return { x1:it.x - 35, y1:it.y - 35, x2:it.x + 35, y2:it.y + 35 };
    case 'text': {
      const h = (it.h || 10) * 4;
      return { x1:it.x - 20, y1:it.y - h, x2:it.x + Math.max((it.s || '').length * (it.h || 10) * 4, 120), y2:it.y + h };
    }
  }
  return { x1:it.x || 0, y1:it.y || 0, x2:it.x || 0, y2:it.y || 0 };
}
const bbInside = (a, r) => a.x1 >= r.x1 && a.x2 <= r.x2 && a.y1 >= r.y1 && a.y2 <= r.y2;
const bbTouch  = (a, r) => a.x1 <= r.x2 && a.x2 >= r.x1 && a.y1 <= r.y2 && a.y2 >= r.y1;
function unionBBox(items){
  let u = null;
  for (const it of items){
    const b = itemBBox(it);
    u = u ? { x1:Math.min(u.x1, b.x1), y1:Math.min(u.y1, b.y1), x2:Math.max(u.x2, b.x2), y2:Math.max(u.y2, b.y2) } : b;
  }
  return u;
}
/* posicao de partida de cada item selecionado: o arrasto e sempre "base + delta", nunca
   acumulado, para o snap de 100 mil nao andar sozinho */
function baseOf(items){
  const m = new Map();
  for (const it of items) m.set(it, it.t === 'wire' ? (it.pts || []).map(p => [p[0], p[1]]) : { x:it.x, y:it.y });
  return m;
}
function applyMove(base, dx, dy){
  for (const [it, b] of base){
    if (it.t === 'wire') it.pts = b.map(p => [p[0] + dx, p[1] + dy]);
    else { it.x = b.x + dx; it.y = b.y + dy; }
  }
}
function describe(it){
  return it.t === 'comp' ? it.ref : it.t === 'wire' ? 'fio' : it.t === 'netlabel' ? 'label ' + (it.net || '')
       : it.t === 'power' ? 'power ' + (it.net || '') : it.t === 'junction' ? 'junção' : 'texto';
}
function updateSelStatus(){
  const n = sel.size;
  const s = !n ? '' : n === 1 ? describe(sel.values().next().value) + ' selecionado' : n + ' selecionados';
  /* o laranja precisa de dono escrito: sem isso a net acesa nao tem nome nem jeito obvio de
     apagar, e a cor parece travada na folha */
  $('ssel').textContent = selNet ? (s ? s + ' · net ' + selNet : 'net ' + selNet) : s;
}

/* ------- selecao e foco de net, um escritor so -------
   Sao dois estados que tem que andar juntos: 'sel' (o que esta marcado) e 'selNet' (a net
   acesa em laranja). Enquanto cada caminho mexia num e esquecia o outro — Escape, tabela,
   retangulo, troca de folha, undo, Ctrl+A — a folha ficava laranja sem nada selecionado e
   sem gesto para desligar. Agora quem mexe na selecao diz, na MESMA chamada, que net fica
   em foco; nao ha caminho que escreva 'selNet' por fora. */
let netListDe = null;                    /* de que selNet a lista lateral foi desenhada */
function aplicaSel(net){
  /* net sem linha no painel nao tem interruptor: acender pintaria a folha sem jeito de
     apagar (grupo de um pino so ganha nome automatico e nao entra em nets.nets) */
  selNet = net && nets.nets.some(n => n.name === net) ? net : '';
  buildCompTable(); updateSelStatus(); renderProps(); mostraProps();
  if (netListDe !== selNet) buildNetList();
  cam.draw();
}
function limpaSel(){ sel.clear(); aplicaSel(''); }
/* que net o alvo do clique representa; '' quando o alvo nao e de net (componente, texto) */
function netDoAlvo(h){
  if (!h) return '';
  if (h.kind === 'pin')  return nets.pinNet[h.ref + '-' + h.num] || '';
  if (h.kind === 'wire') return nets.wireNet[sheetIdx][h.wi] || '';
  /* rotulo, power e junção sao objetos DE net: clicar neles acende a net, nao apaga */
  if (h.kind === 'netlabel' || h.kind === 'power') return h.item.net || '';
  if (h.kind === 'junction') return netEm(h.item.x, h.item.y);
  return '';
}
/* a net que passa por um ponto da folha — o fio que encosta nele manda */
function netEm(x, y){
  const s = model.sheets[sheetIdx];
  for (let wi = 0; wi < s.wires.length; wi++){
    const pts = s.wires[wi].pts || [];
    for (let i = 0; i < pts.length - 1; i++)
      if (HubCore.distSeg(x, y, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]) <= 1)
        return nets.wireNet[sheetIdx][wi] || '';
  }
  return '';
}
function selectOnly(items){ sel.clear(); for (const it of items) sel.add(it); aplicaSel(''); }
function rotateSel(){
  const comps = Array.from(sel).filter(it => it.t === 'comp');
  if (!comps.length) return;
  for (const c of comps) c.rot = (((c.rot || 0) + 90) % 360);
  if (mouse && mouse.mode === 'move') cam.draw(); else commit();
}
function mirrorSel(){
  const comps = Array.from(sel).filter(it => it.t === 'comp');
  if (!comps.length) return;
  for (const c of comps){ if (c.mirror) delete c.mirror; else c.mirror = true; }
  if (mouse && mouse.mode === 'move') cam.draw(); else commit();
}
function deleteSel(){
  if (!sel.size) return;
  for (const it of sel){ const i = schematic.items.indexOf(it); if (i >= 0) schematic.items.splice(i, 1); }
  sel.clear();
  selNet = '';        /* os fios da net podem ter ido junto; o reapply do commit revalida */
  commit();
}

/* ------- ferramentas da barra -------
   So o que a MAO faz nesta vista: escolher/mover, puxar fio e pousar um terra ou um trilho
   de alimentacao. Rotulo, texto, junção e troca de valor/footprint sao da IA, no
   schematic.js — por isso nao existem botoes para eles. */
let tool = 'select';        /* 'select' | 'wire' | 'power' */
let toolPower = null;       /* { net, style, rot } quando tool === 'power' */
let wireDraw = null;        /* { pts:[[x,y],...] } enquanto o fio esta sendo puxado */
let snapHit = null;         /* ponto magnetico sob o cursor: { x, y, kind, label } */

/* O IMA: enquanto uma ferramenta esta ativa, o cursor procura um ponto de conexao por
   perto — ponta quente de pino primeiro, depois vertice de fio, junção e power. 60 mil e
   meia grade: perto o bastante para nao roubar o clique de quem quer o ponto livre. */
const SNAP_MIL = 60;
function snapPoint(w){
  const s = model.sheets[sheetIdx];
  let best = null;
  const tenta = (x, y, kind, label, peso) => {
    const d = Math.hypot(w.x - x, w.y - y);
    if (d > SNAP_MIL) return;
    if (!best || peso < best.peso || (peso === best.peso && d < best.d)) best = { x, y, d, kind, label, peso };
  };
  for (const c of s.comps){
    const pins = HubCore.compPinsWorld(c, SLIB) || [];
    for (const p of pins) tenta(p.x, p.y, 'pin', c.ref + '-' + p.num + (p.name && p.name !== p.num ? ' (' + p.name + ')' : ''), 0);
  }
  for (const j of s.junctions) tenta(j.x, j.y, 'junction', 'junção', 1);
  for (const p of s.powers)    tenta(p.x, p.y, 'power', p.net || 'power', 1);
  for (const wi of s.wires) for (const p of (wi.pts || [])) tenta(p[0], p[1], 'wire', 'fio', 2);
  return best;
}
/* proximo ponto do fio: o ima ganha; sem ima, grade de 100 mil e traçado ortogonal */
function wirePoint(w){
  const hs = snapPoint(w);
  if (hs) return { pt:[hs.x, hs.y], snap:hs };
  const gx = snap100(w.x), gy = snap100(w.y);
  if (!wireDraw || !wireDraw.pts.length) return { pt:[gx, gy], snap:null };
  const last = wireDraw.pts[wireDraw.pts.length - 1];
  return { pt: (Math.abs(gx - last[0]) >= Math.abs(gy - last[1])) ? [gx, last[1]] : [last[0], gy], snap:null };
}
function wireClick(w){
  const r = wirePoint(w);
  if (!wireDraw){ wireDraw = { pts:[r.pt] }; cam.draw(); return; }
  const last = wireDraw.pts[wireDraw.pts.length - 1];
  const [x, y] = r.pt;
  if (x === last[0] && y === last[1]) return;
  /* ponto magnetico fora do eixo: entra um canto, como o Altium faz */
  if (x !== last[0] && y !== last[1]) wireDraw.pts.push([x, last[1]]);
  wireDraw.pts.push([x, y]);
  /* encostou num pino: o fio acabou ali */
  if (r.snap && r.snap.kind === 'pin') endWire(); else cam.draw();
}
function endWire(){
  const d = wireDraw; wireDraw = null;
  if (d && d.pts.length >= 2){
    schematic.items.push({ t:'wire', sheet:model.sheets[sheetIdx].name, pts:d.pts });
    commit();
  } else cam.draw();
}
function placePower(w){
  const hs = snapPoint(w);
  const p = toolPower;
  schematic.items.push({ t:'power', sheet:model.sheets[sheetIdx].name, net:p.net, style:p.style,
                         x: hs ? hs.x : snap100(w.x), y: hs ? hs.y : snap100(w.y), rot:p.rot });
  commit();
}
function setTool(t, pw){
  /* pegar uma ferramenta E dizer que se quer editar: obrigar a achar o lapis antes seria
     um passo a toa, e o gesto ja e deliberado */
  if (t !== 'select'){
    if (!editOn) setEdit(true);
    if (annTool) setAnnTool(false);
  }
  tool = t; toolPower = pw || null; wireDraw = null; snapHit = null;
  $('tbSel').setAttribute('aria-pressed', String(t === 'select'));
  $('tbWire').setAttribute('aria-pressed', String(t === 'wire'));
  for (const b of document.querySelectorAll('#schtb .pw'))
    b.setAttribute('aria-pressed', String(t === 'power' && !!pw && b.dataset.net === pw.net));
  cv.style.cursor = t !== 'select' ? 'crosshair' : (annTool ? 'copy' : 'default');
  cam.draw();
}
$('tbSel').addEventListener('click', () => setTool('select'));
$('tbWire').addEventListener('click', () => setTool(tool === 'wire' ? 'select' : 'wire'));
for (const b of document.querySelectorAll('#schtb .pw'))
  b.addEventListener('click', () => {
    const igual = tool === 'power' && toolPower && toolPower.net === b.dataset.net;
    /* o terra aponta para baixo, o trilho de alimentacao para cima — como no Altium */
    setTool(igual ? 'select' : 'power', igual ? null
      : { net:b.dataset.net, style:b.dataset.style, rot: b.dataset.style === 'Bar' ? 90 : 270 });
  });

/* ------- mouse: esquerdo seleciona e move, direito arrasta a tela -------
   O mkCamera (hub-draw.js) arrasta a tela com QUALQUER botao e nao sabe de selecao. Em vez
   de mexer nele — e mudar junto o PCB, as previews da Biblioteca e o laser —, os eventos do
   botao esquerdo sao interceptados aqui: ouvintes de CAPTURA, registrados ANTES da camera
   existir, que param o evento ali (stopImmediatePropagation). O direito e o do meio passam
   direto e viram o pan de sempre; a roda continua sendo o zoom da camera. */
let hoverW = null;          /* cursor em coords do mundo */
let mouse = null;           /* gesto do esquerdo em curso: { mode:'move'|'box'|'none', start, moved, base, shift } */
let lastDown = null;        /* o que o ultimo mousedown acertou, para o Shift+clique saber se tira */
let boxRect = null;         /* retangulo de selecao em curso (mundo) */
let swallowClick = false;   /* o click que fecha um arrasto nao e um clique */
let panning = false, panFrom = null, panMoved = false;

function worldOf(e){ const r = cv.getBoundingClientRect(); return cam.toWorld(e.clientX - r.left, e.clientY - r.top); }

window.addEventListener('mousedown', () => { panning = false; }, true);
cv.addEventListener('mousedown', e => {
  if (e.button !== 0){                                  /* direito/meio: pan da camera */
    panning = true; panMoved = false; panFrom = { x:e.clientX, y:e.clientY };
    cv.style.cursor = 'grabbing'; return;
  }
  e.stopImmediatePropagation();
  leftDown(e);
}, true);
cv.addEventListener('click', e => { e.stopImmediatePropagation(); leftClick(e); }, true);
cv.addEventListener('contextmenu', e => e.preventDefault());
/* soltar o direito fora do canvas dispararia o menu do navegador em cima do painel.
   Direito SEM arrastar encerra o fio, como no Altium; com arrasto, foi so um pan. */
window.addEventListener('contextmenu', e => {
  if (!panning) return;
  e.preventDefault();
  const arrastou = panMoved;
  panning = false; panMoved = false;
  if (!arrastou && wireDraw) endWire();
});
window.addEventListener('mousemove', e => {
  if (mouse){ leftMove(e); return; }
  if (panning && panFrom && Math.hypot(e.clientX - panFrom.x, e.clientY - panFrom.y) > 4) panMoved = true;
});
window.addEventListener('mouseup', e => {
  if (e.button === 0){ leftUp(e); return; }
  cv.style.cursor = annTool ? 'copy' : 'default';
  if (e.button !== 2) panning = false;      /* o direito espera o contextmenu para zerar */
});
window.addEventListener('blur', () => {
  if (!mouse) return;
  if (mouse.mode === 'move') applyMove(mouse.base, 0, 0);
  mouse = null; boxRect = null; cam.draw();
});

function leftDown(e){
  const w = worldOf(e);
  swallowClick = false;
  lastDown = null;        /* o click deste gesto so pode ver o que ESTE mousedown acertou */
  /* com uma ferramenta na mao o esquerdo nao seleciona nem arrasta: ele coloca */
  if (annTool || tool !== 'select'){ mouse = { mode:'none', start:w, moved:false }; return; }
  const h = hitTest(w.x, w.y);
  if (!h){
    mouse = { mode:'box', start:w, moved:false, shift:e.shiftKey };
    lastDown = null;
    return;
  }
  const it = h.item, wasSel = sel.has(it);
  if (!wasSel){ if (!e.shiftKey) sel.clear(); sel.add(it); }
  lastDown = { item:it, wasSel };
  /* em leitura o clique so marca; e no modo edicao que o mesmo gesto vira arrasto */
  mouse = { mode: editOn ? 'move' : 'none', start:w, moved:false, base: editOn ? baseOf(sel) : null };
  /* a net entra em foco AQUI, e nao no click: todo arrasto engole o click (swallowClick), e
     a net anterior ficava acesa por cima de uma selecao que ja era outra */
  aplicaSel(e.shiftKey && sel.size > 1 ? '' : netDoAlvo(h));
}
function leftMove(e){
  const d = mouse, w = worldOf(e);
  const dx = w.x - d.start.x, dy = w.y - d.start.y;
  if (!d.moved && Math.hypot(dx, dy) * cam.cam.scale < 3) return;   /* 3 px de folga: clique nao vira arrasto */
  d.moved = true;
  if (d.mode === 'move'){ applyMove(d.base, snap100(dx), snap100(dy)); cam.draw(); }
  else if (d.mode === 'box'){ boxRect = { x1:d.start.x, y1:d.start.y, x2:w.x, y2:w.y }; cam.draw(); }
  else if (!editOn && !d.avisou){
    /* arrastar travado nao pode ser silencio: e a diferenca entre "nao funciona" e "esta em leitura" */
    d.avisou = true;
    HubDialog.toast('Só leitura — tecle E ou clique no lápis (Configurações) para mover.', 'warn');
  }
}
function leftUp(){
  const d = mouse; if (!d) return;
  mouse = null;
  swallowClick = d.moved;
  if (d.mode === 'move' && d.moved){
    /* arrasto que voltou para a mesma grade nao e mudanca — nao entra no undo */
    const mudou = Array.from(d.base).some(([it, b]) => it.t === 'wire'
      ? (it.pts[0] && (it.pts[0][0] !== b[0][0] || it.pts[0][1] !== b[0][1]))
      : (it.x !== b.x || it.y !== b.y));
    if (mudou) commit(); else cam.draw();
    return;
  }
  if (d.mode === 'box' && d.moved && boxRect){
    const r = boxRect; boxRect = null;
    const n = { x1:Math.min(r.x1, r.x2), y1:Math.min(r.y1, r.y2), x2:Math.max(r.x1, r.x2), y2:Math.max(r.y1, r.y2) };
    /* esquerda→direita pega so quem cabe inteiro; direita→esquerda pega quem encosta (como no Altium) */
    const inteiro = r.x2 >= r.x1;
    if (!d.shift) sel.clear();
    for (const it of sheetItems()){ const bb = itemBBox(it); if (inteiro ? bbInside(bb, n) : bbTouch(bb, n)) sel.add(it); }
    aplicaSel('');     /* selecao de varios nao tem uma net so: apaga o foco anterior */
    return;
  }
  boxRect = null; cam.draw();
}
function leftClick(e){
  if (swallowClick){ swallowClick = false; return; }
  const w = worldOf(e);
  if (annTool){ openAnnForm(w); return; }
  if (tool === 'wire'){ wireClick(w); return; }
  if (tool === 'power'){ placePower(w); return; }
  /* O alvo foi resolvido no mousedown (lastDown) e NAO se refaz o hitTest aqui: entre o
     mousedown e o click a ficha abriu e o canvas mudou de largura, entao o mesmo ponto de
     tela cai em outro ponto do mundo, "erra" o componente que acabou de ser marcado e
     limpava a selecao — era isso que fazia a ficha abrir e fechar no mesmo clique. */
  if (!lastDown){ if (!e.shiftKey) limpaSel(); return; }
  if (e.shiftKey && lastDown.wasSel){
    sel.delete(lastDown.item);
    aplicaSel('');            /* saiu da selecao: a net dele sai junto */
  }
}
/* duplo clique com o fio na mao encerra o traçado (o Altium faz igual); no resto, nada:
   a ficha da direita e so de leitura, e quem edita propriedade e a IA no schematic.js */
cv.addEventListener('dblclick', () => { if (wireDraw) endWire(); });

/* liga/desliga o modo edicao e reflete o estado em tudo que edita */
function setEdit(v){
  editOn = !!v;
  if (!editOn){
    if (annTool) setAnnTool(false);
    if (tool !== 'select') setTool('select');
    if (mouse && mouse.mode === 'move'){ applyMove(mouse.base, 0, 0); mouse = null; }
    closeAdd();
  }
  const b = $('btnEdit');
  b.classList.toggle('active', editOn);
  b.title = editOn ? 'Editando — clique para voltar à leitura (E)' : 'Editar: mover componentes e fios (E)';
  $('edithint').textContent = editOn ? 'editando: arraste o que estiver selecionado' : 'só leitura — o lápis destrava';
  const sm = $('smode');
  sm.textContent = editOn ? 'editando' : 'leitura · E edita';
  sm.classList.toggle('edit', editOn);
  /* o Salvar fica de fora de proposito: a trava e para NAO deixar alterar, e travar de
     volta com alteracoes pendentes nao pode impedir de grava-las. */
  $('btnAdd').disabled = $('btnAnn').disabled = !editOn;
  cam.draw();
}

/* ------- adicionar componentes (modal) -------
   E a aba Biblioteca do hub com uma troca: a ficha da direita virou a LISTA do que vai
   para o esquema. Escolher um a um e ja posicionar cada um quebra o raciocinio de quem
   esta montando o circuito; aqui a escolha (simbolo + valor + footprint + quantidade)
   vai se juntando, e Finalizar joga tudo na folha de uma vez, em grade, para depois ser
   arrastado e ligado. A lista mora na memoria da vista; o que persiste e o schematic.js. */
let pick = null;                    /* { sym, valorId, part, fpShown } — o que esta em foco no modal */
let cart = [];
const addState = { baixo:'val' };   /* painel de baixo no almoxarifado: 'val' | 'fp' */
let addDrawSym = null, addDrawFp = null;
const camSym = D.mkCamera($('addSymCv'), ctx => { if (addDrawSym) D.drawSymbolPart(ctx, addDrawSym, {}); }, { bg:D.SCH.sheet });
const camFp  = D.mkCamera($('addFpCv'),  ctx => { if (addDrawFp)  D.drawFootprint(ctx, addDrawFp, {}); },  { bg:'#0b0b0d' });

function refPrefixOf(name){
  /* o simbolo do almoxarifado carrega o designador ("R", "C", "DS"...); so o do Altium
     precisa do palpite pela primeira letra do nome */
  const sy = SLIB.symbols.find(x => x.name === name);
  if (sy && sy.designator) return String(sy.designator).toUpperCase();
  const m = String(name || '').match(/^[A-Za-z]+/);
  return m ? m[0].toUpperCase() : 'U';
}
function allComps(){ const out = []; for (const s of model.sheets) for (const c of s.comps) out.push(c); return out; }
function nextRef(symName){
  const comps = allComps();
  const same = comps.filter(c => c.sym === symName);
  let prefix = same.length ? refPrefixOf(same[0].ref) : refPrefixOf(symName);
  let mx = 0;
  for (const c of comps){
    const m = String(c.ref).match(/^([A-Za-z]+)(\d+)$/);
    if (m && m[1].toUpperCase() === prefix && +m[2] > mx) mx = +m[2];
  }
  return prefix + (mx + 1);
}
function acervoAtual(){
  const id = $('addSrc').value;
  return ACERVOS.find(a => a.id === id) || ACERVOS[0];
}
const qtdFmt = n => (Math.round((n || 0) * 100) / 100).toLocaleString('pt-BR');
/* No acervo do almoxarifado o simbolo tem UMA parte e uma lista de VALORES; cada valor
   e um conjunto de parametros (Comment, Value, MPN, Mouser, Estoque, Local). O que se
   escolhe no modal e o valor, nao a parte. */
const valoresDe = sy => (sy && sy.valores) || [];
const estoqueDe = sy => valoresDe(sy).reduce((a, p) => a + (p.estoque || 0), 0);
/* os parametros viram um campo plano "K=V;K=V" no schematic.js: o parser do
   BuildSchematic le linha a linha e nao aguenta objeto aninhado */
const limpaPar = t => String(t == null ? '' : t).replace(/[;=|]/g, ',').trim();
function paramsDoValor(v){
  if (!v) return '';
  const pares = [];
  for (const q of (v.params || [])) if (q.v) pares.push(limpaPar(q.n) + '=' + limpaPar(q.v));
  pares.push('ValorId=' + v.id);
  return pares.join(';');
}
function buildAddSrc(){
  const s = $('addSrc');
  if (s.options.length) return;
  for (const a of ACERVOS){ const o = document.createElement('option'); o.value = a.id; o.textContent = a.titulo; s.appendChild(o); }
}
/* no acervo do almoxarifado a busca tambem entra nos VALORES: e assim que se acha "10k"
   ou um codigo Mouser sem saber em que familia ele mora */
function addFiltered(){
  const q = $('addSearch').value.trim().toLowerCase(), ac = acervoAtual();
  if (!q) return ac.syms.slice();           /* ac.syms = familias, sem os alias por valor */
  return ac.syms.filter(s => (s.name + ' ' + (s.description || '') + ' '
    + (ac.almox ? valoresDe(s).slice(0, 400).map(p => p.label + ' ' + (p.mpn || '') + ' ' + (p.mouser || '')).join(' ') : '')
  ).toLowerCase().includes(q));
}
function setPick(s){
  const v0 = valoresDe(s)[0] || null;
  pick = { sym:s, valorId: v0 ? v0.id : 0, part:1, fpShown:null };
  $('addValSearch').value = '';
  $('addComment').value = v0 ? v0.label : '';
  $('addQtd').value = 1;
}
function buildAddList(){
  const ac = acervoAtual(), q = $('addSearch').value.trim();
  const lista = addFiltered();
  /* a busca serve para CHEGAR num componente: se o escolhido saiu dos resultados, a lista e
     o preview seguem o primeiro (mesma regra da aba Biblioteca) */
  if (pick && lista.length && !lista.includes(pick.sym)) setPick(lista[0]);

  const sum = $('addSum'); sum.textContent = '';
  const stat = (n, label, tone) => {
    const s = el('span'); const b = el('b', null, String(n));
    if (tone) b.style.color = 'var(--' + tone + ')';
    s.append(b, document.createTextNode(' ' + label)); sum.append(s);
  };
  if (ac.almox){
    const soma = lista.reduce((a, sy) => {
      const vs = valoresDe(sy);
      a.vals += vs.length; a.pecas += estoqueDe(sy);
      a.zerados += vs.filter(v => !((v.estoque || 0) > 0)).length;
      return a;
    }, { vals:0, pecas:0, zerados:0 });
    stat(lista.length, 'símbolos'); stat(soma.vals, 'valores');
    stat(qtdFmt(soma.pecas), 'peças em estoque', soma.pecas > 0 ? 'ok' : 'warn');
    stat(soma.zerados, 'valores zerados', soma.zerados ? 'warn' : null);
  } else {
    const semFp = lista.filter(s => !(s.footprints || []).some(f => f.incurrentlib)).length;
    stat(lista.length, 'símbolos'); stat((PLIB.footprints || []).length, 'footprints');
    stat(semFp, 'sem footprint', semFp ? 'warn' : null);
  }
  if (lista.length !== ac.syms.length) sum.append(el('span', null, 'de ' + ac.syms.length + ' no acervo'));

  const list = $('addList'); list.textContent = '';
  const frag = document.createDocumentFragment();
  const MAX = 400, vis = lista.slice(0, MAX);
  const row = (s, extra) => {
    const b = el('button', 'lib-row'); b.type = 'button';
    b.setAttribute('aria-selected', String(!!pick && pick.sym === s));
    b.title = s.description || s.name;
    b.append(el('span', 'nm', s.name));
    extra(b);
    b.addEventListener('click', () => { setPick(s); buildAddList(); renderAddPreview(); });
    frag.append(b);
  };
  if (ac.almox){
    /* agrupada por familia — e assim que se procura um componente */
    let fam = null;
    for (const s of vis){
      if (s.familia !== fam){
        fam = s.familia;
        const n = lista.filter(x => x.familia === fam).length;
        frag.append(el('div', 'lib-head', (fam || 'sem família') + (n > 1 ? ' (' + n + ')' : '')));
      }
      row(s, b => {
        const nv = valoresDe(s).length;
        if (nv > 1) b.append(el('span', 'pill', nv + ' val'));
        if (!(s.footprints || []).length) b.append(el('span', 'pill warn', 'sem encap'));
        const est = estoqueDe(s), q2 = el('span', 'mt', qtdFmt(est));
        q2.style.color = est > 0 ? 'var(--ok)' : 'var(--text-4)';
        b.append(q2);
      });
    }
  } else {
    frag.append(el('div', 'lib-head', 'símbolos (' + lista.length + (q ? ' de ' + ac.syms.length : '') + ')'));
    for (const s of vis) row(s, b => {
      const part = HubCore.partOf(s, 1);
      if (!(s.footprints || []).some(f => f.incurrentlib)) b.append(el('span', 'pill warn', 'sem fp'));
      b.append(el('span', 'mt', ((part && part.pins && part.pins.length) || 0) + 'p'));
    });
  }
  if (lista.length > MAX) frag.append(el('div', 'lib-head', 'mostrando ' + MAX + ' de ' + lista.length + ' — refine a busca'));
  if (!lista.length) frag.append(el('div', 'lib-head', q ? 'nada com "' + q + '"' : 'nada aqui'));
  list.append(frag);
}
/* as previews sao canvases dentro de um modal que abre e fecha: o fit so vale com o canvas
   medido, entao a caixa fica guardada e o ajuste acontece no proximo frame, com tamanho */
function fitPreview(c, bb){ c.__bb = bb || null; }
function ajustaPreviews(cams){
  for (const c of cams){
    const cvs = c.ctx.canvas;
    if (!cvs.clientWidth || !cvs.clientHeight) continue;
    c.resize();
    if (c.__bb) c.fit(c.__bb, 1.35); else c.draw();
  }
}
function refitPreviews(){ ajustaPreviews([camSym, camFp]); }
function renderAddPreview(){
  const ac = acervoAtual(), almox = !!ac.almox;
  const s = pick && pick.sym;
  /* Dois corpos disputam a metade de baixo: o footprint e a lista de valores. A lista so
     existe no acervo do almoxarifado, e e o padrao la — e ela que responde "tem esse valor?". */
  const modo = almox ? addState.baixo : 'fp';
  $('addFpVp').hidden = modo !== 'fp'; $('addValBox').hidden = modo !== 'val';
  $('addBotTtl').textContent = modo === 'val' ? 'valores' : 'footprint';
  const seg = $('addBotSeg'); seg.textContent = ''; seg.hidden = !almox;
  if (almox) for (const [k, rot] of [['val', 'valores'], ['fp', 'footprint']]){
    const b = el('button', null, rot); b.type = 'button';
    b.setAttribute('aria-pressed', String(k === modo));
    b.title = k === 'fp' ? 'o footprint do valor escolhido' : 'os valores deste componente no almoxarifado';
    b.addEventListener('click', () => { addState.baixo = k; renderAddPreview(); });
    seg.append(b);
  }
  for (const id of ['addFp', 'addPart', 'addQtd', 'addComment', 'addOk']) $(id).disabled = !s;
  if (!s){
    addDrawSym = null; addDrawFp = null; fitPreview(camSym, null); fitPreview(camFp, null);
    $('addSymMeta').textContent = '—'; $('addBotMeta').textContent = '—';
    $('addSymHint').textContent = 'escolha um item na lista'; $('addFpHint').textContent = '';
    $('addValList').textContent = ''; $('addValCount').textContent = '';
    $('addFp').textContent = ''; $('addPartLab').hidden = true;
    requestAnimationFrame(refitPreviews);
    return;
  }
  const vals = valoresDe(s);
  const v = vals.find(x => x.id === pick.valorId) || vals[0] || null;
  const nparts = s.partcount || (s.parts || []).length || 1;
  /* o simbolo do almoxarifado tem UMA geometria; o valor escolhido e so um conjunto de parametros */
  const part = vals.length ? (s.parts || [])[0] : HubCore.partOf(s, pick.part || 1);
  addDrawSym = part || null;
  fitPreview(camSym, part ? D.symBBox(part) : null);
  $('addSymHint').textContent = part && (part.graphics || []).length ? '' : 'símbolo sem geometria na lib';
  $('addSymMeta').textContent = s.name + ' · ' + ((part && part.pins) || []).length + ' pinos'
    + (v ? ' · valor ' + (vals.indexOf(v) + 1) + '/' + vals.length : nparts > 1 ? ' · parte ' + pick.part + '/' + nparts : '');

  /* parte: so no simbolo multi-part da schlib do Altium */
  const pl = $('addPartLab'); pl.hidden = !!vals.length || nparts <= 1;
  if (!pl.hidden){
    const ps = $('addPart'); ps.textContent = '';
    for (let i = 1; i <= nparts; i++){ const o = document.createElement('option'); o.value = i; o.textContent = i + '/' + nparts; if (i === pick.part) o.selected = true; ps.append(o); }
  }

  /* footprint: o do VALOR primeiro (um resistor 0805 e um 2512 dividem o mesmo simbolo e nao
     tem nada a ver na placa), depois os modelos do simbolo, depois a PcbLib inteira */
  const fpSel = $('addFp'); fpSel.textContent = '';
  const models = (v && v.footprint)
    ? [{ name:v.footprint, current:true }].concat((s.footprints || []).filter(m => m.name !== v.footprint))
    : (s.footprints || []);
  const want = pick.fpShown || ((models.find(m => m.current) || models[0] || {}).name) || '';
  const seen = new Set();
  const addOpt = (name, mark) => {
    if (!name || seen.has(name)) return; seen.add(name);
    const o = document.createElement('option'); o.value = name; o.textContent = name + (mark || '');
    if (name === want) o.selected = true;
    fpSel.append(o);
  };
  for (const m of models) addOpt(m.name, m.current ? ' ✓' : '');
  for (const f of (PLIB.footprints || [])) addOpt(f.name, '');
  if (!seen.size){ const o = document.createElement('option'); o.value = ''; o.textContent = '— nenhum —'; fpSel.append(o); }

  const fpName = fpSel.value;
  const fp = fpName ? HubCore.footprintOf(PLIB, fpName) : null;
  addDrawFp = fp || null;
  fitPreview(camFp, fp && fp.bbox ? fp.bbox : null);
  $('addFpHint').textContent = fp ? '' : (fpName ? 'footprint "' + fpName + '" não está na PcbLib espelhada' : 'sem footprint');
  $('addBotMeta').textContent = modo === 'val' ? s.name : (fpName || '—');

  /* lista de valores (almoxarifado) */
  if (almox){
    const vq = $('addValSearch').value.trim().toLowerCase();
    const vis = vals.filter(p => !vq ||
      (p.label + ' ' + (p.mpn || '') + ' ' + (p.mouser || '') + ' ' + (p.pkgs || []).join(' ')).toLowerCase().includes(vq));
    $('addValCount').textContent = vis.length === vals.length ? vals.length + ' valores' : vis.length + ' de ' + vals.length;
    const vl = $('addValList'); vl.textContent = '';
    const frag = document.createDocumentFragment();
    for (const p of vis){
      const b = el('button', 'alx-row'); b.type = 'button';
      b.setAttribute('aria-selected', String(!!v && p.id === v.id));
      b.title = (p.itens && p.itens[0] && p.itens[0].nome) || p.label;
      const lb = el('span', 'lb', p.label);
      if (p.fora){ lb.append(el('i', null, 'fora')); b.title = 'não está mais no Odoo — a part continua na lib para não renumerar as outras'; }
      /* o numero e o id do valor: e a chave dele no .DbLib e no schematic.js */
      const ix = el('span', 'ix', String(p.id)); ix.title = 'id ' + p.id + ' no catálogo';
      b.append(ix, lb, el('span', 'pk', (p.pkgs || []).join(' · ')));
      b.append(el('span', 'qt' + (p.estoque > 0 ? '' : ' zero'), qtdFmt(p.estoque)));
      /* o encapsulamento fixado era do valor ANTERIOR: mantê-lo poria um 0805 na ficha de um 2512 */
      b.addEventListener('click', () => { pick.valorId = p.id; pick.fpShown = null; $('addComment').value = p.label; renderAddPreview(); });
      frag.append(b);
    }
    if (!vis.length) frag.append(el('div', 'alx-empty', 'nenhum valor com "' + $('addValSearch').value + '"'));
    vl.append(frag);
  }
  requestAnimationFrame(refitPreviews);
}
function openAdd(){
  if (!editOn) return;
  buildAddSrc();
  $('addmodal').classList.add('on');
  buildAddList(); renderAddPreview(); cartRender();
  $('addSearch').focus();
}
function closeAdd(){ $('addmodal').classList.remove('on'); }
const addOpen = () => $('addmodal').classList.contains('on');

/* ------- a lista (o que vai para o esquema) ------- */
const cartCount = () => cart.reduce((a, c) => a + c.qtd, 0);
function cartAdd(){
  if (!pick) return;
  const s = pick.sym, vals = valoresDe(s), v = vals.find(x => x.id === pick.valorId) || vals[0] || null;
  const qtd = Math.max(1, Math.min(99, Math.round(+$('addQtd').value) || 1));
  const part = v ? 1 : (pick.part || 1);
  const item = {
    /* o nome do componente no Altium: cada valor e um componente proprio na lib da
       familia ("SMD 0805 10K 1/8W"). O espelho do hub continua por familia. */
    sym: (v && v.altium) || s.name,
    part,
    footprint: $('addFp').value,
    comment: ($('addComment').value.trim() || (v && v.label) || '').replace(/"/g, "'"),
    params: paramsDoValor(v),
    rotulo: (v && v.label) || (s.name + (part > 1 ? ' · parte ' + part : '')),
    estoque: v && typeof v.estoque === 'number' ? v.estoque : null,
    qtd,
  };
  const igual = cart.find(c => c.sym === item.sym && c.part === item.part && c.footprint === item.footprint && c.comment === item.comment);
  if (igual) igual.qtd += qtd; else cart.push(item);
  cartRender();
}
function cartRender(){
  const n = cartCount();
  $('addBtnN').textContent = n ? '(' + n + ')' : '';
  $('cartInfo').textContent = n ? n + ' peça(s) · ' + cart.length + ' tipo(s)' : 'vazia';
  $('cartDone').disabled = !cart.length; $('cartClear').disabled = !cart.length;
  const box = $('cartList'); box.textContent = '';
  if (!cart.length){
    box.append(el('div', 'cart-empty', 'Escolha um componente à esquerda, confira o valor e o footprint no meio '
      + 'e clique em Adicionar. Quando a lista estiver pronta, Finalizar coloca tudo na folha ativa, em grade, '
      + 'para arrastar e ligar depois.'));
    return;
  }
  const mk = (txt, title, fn) => { const b = el('button', 'btn btn-secondary', txt); b.type = 'button'; b.title = title; b.addEventListener('click', fn); return b; };
  cart.forEach((c, i) => {
    const row = el('div', 'cart-row');
    const t = el('div', 't'); t.title = c.rotulo;
    if (c.qtd > 1) t.append(el('b', null, c.qtd + '× '));
    t.append(document.createTextNode(c.rotulo));
    row.append(t,
      mk('−', 'uma a menos', () => { if (--cart[i].qtd <= 0) cart.splice(i, 1); cartRender(); }),
      mk('+', 'uma a mais', () => { cart[i].qtd++; cartRender(); }),
      mk('✕', 'tirar da lista', () => { cart.splice(i, 1); cartRender(); }));
    const s = el('div', 's', c.sym + ' · ' + (c.footprint || 'sem footprint'));
    if (c.estoque !== null && c.estoque < c.qtd) s.append(el('span', 'w', '  ⚠ saldo ' + qtdFmt(c.estoque)));
    row.append(s);
    box.append(row);
  });
}
/* joga a lista inteira na folha, em grade, a partir de um canto livre, e deixa tudo
   selecionado: o proximo gesto natural e arrastar para o lugar */
function finalizar(){
  if (!editOn || !cart.length) return;
  const folha = model.sheets[sheetIdx];
  const usados = folha.comps || [];
  /* comeca abaixo do que ja existe, para nao cair em cima do circuito */
  let y0 = 6200, x0 = 800;
  if (usados.length){
    const minY = Math.min.apply(null, usados.map(c => c.y));
    y0 = snap100(minY - 900);
  }
  const PASSO_X = 700, PASSO_Y = 800, LARGURA = 9;
  let i = 0; const novos = [];
  for (const item of cart){
    for (let k = 0; k < item.qtd; k++){
      const c = {
        t: 'comp', sheet: folha.name, ref: nextRef(item.sym), sym: item.sym,
        x: snap100(x0 + (i % LARGURA) * PASSO_X),
        y: snap100(y0 - Math.floor(i / LARGURA) * PASSO_Y),
        rot: 0, footprint: item.footprint,
      };
      if (item.part !== 1) c.part = item.part;
      if (item.comment) c.comment = item.comment;
      if (item.params) c.params = item.params;
      schematic.items.push(c); novos.push(c);
      /* o model precisa enxergar o que acabou de entrar, senao o nextRef repete o ref */
      model = HubCore.buildSchModel(schematic);
      i++;
    }
  }
  cart = []; cartRender(); closeAdd();
  sel.clear(); for (const c of novos) sel.add(c);
  selNet = '';        /* componentes novos nao pertencem a net nenhuma ainda */
  commit();
  const bb = unionBBox(novos);
  if (bb) cam.fit({ x1:bb.x1 - 600, y1:bb.y1 - 600, x2:bb.x2 + 600, y2:bb.y2 + 600 });
  HubDialog.toast(novos.length + ' componente(s) na folha "' + folha.name + '" — arraste para o lugar e salve', 'ok');
}

$('addSearch').addEventListener('input', () => { buildAddList(); renderAddPreview(); });
$('addSrc').addEventListener('change', () => { pick = null; buildAddList(); renderAddPreview(); });
$('addValSearch').addEventListener('input', renderAddPreview);
$('addFp').addEventListener('change', () => { if (pick){ pick.fpShown = $('addFp').value; renderAddPreview(); } });
$('addPart').addEventListener('change', () => { if (pick){ pick.part = +$('addPart').value || 1; renderAddPreview(); } });
$('addOk').addEventListener('click', cartAdd);
$('addClose').addEventListener('click', closeAdd);
$('addmodal').addEventListener('click', e => { if (e.target === $('addmodal')) closeAdd(); });
$('cartClear').addEventListener('click', async () => {
  if (cart.length && !(await HubDialog.confirm('Esvaziar a lista de componentes? O que já estava nela se perde.',
      { title:'Limpar lista', ok:'Esvaziar', danger:true }))) return;
  cart = []; cartRender();
});
$('cartDone').addEventListener('click', finalizar);
$('btnAdd').addEventListener('click', openAdd);

/* ------- painel de propriedades (direita, so leitura) -------
   A ficha do que esta selecionado, no espirito do painel Properties do Altium: o que o
   componente E, de onde ele veio, onde ele esta e em que pinos as nets caem — com o simbolo
   e o footprint desenhados no rodape. Nada aqui e editavel de proposito: esta vista serve
   para OLHAR e para posicionar; valor, footprint e parametro sao da IA, no schematic.js. */
let prSym = null, prFp = null;
const camPrSym = D.mkCamera($('prSymCv'), ctx => { if (prSym) D.drawSymbolPart(ctx, prSym, {}); }, { bg:D.SCH.sheet });
const camPrFp  = D.mkCamera($('prFpCv'),  ctx => { if (prFp)  D.drawFootprint(ctx, prFp, {}); },  { bg:'#0b0b0d' });
function refitProps(){ ajustaPreviews([camPrSym, camPrFp]); }

/* ------- quando a ficha aparece -------
   Ela nao fica ocupando a tela o tempo todo: entra com a selecao e sai com ela. O alfinete
   no canto da ficha prende ela aberta; fechada, ela vira o botao de paineis no canto
   inferior esquerdo da folha. O alfinete fica lembrado nesta maquina. */
let propsPin = false, painelProps = null;
try { propsPin = localStorage.getItem('schframe.propsPin') === '1'; } catch (e) {}
function salvaPin(){ try { localStorage.setItem('schframe.propsPin', propsPin ? '1' : '0'); } catch (e) {} }
function mostraProps(){
  const ver = propsPin || sel.size > 0;
  /* a ficha fechada pela divisoria tem largura zero: reabrir sem devolver largura mostraria
     uma fatia de nada */
  if (ver && painelProps) painelProps.abre();
  $('props').hidden = !ver;
  $('splitR').hidden = !ver;
  $('btnPaineis').hidden = ver;
  $('btnPin').setAttribute('aria-pressed', String(propsPin));
  /* o canvas mudou de largura; os previews so enquadram depois de medidos */
  if (ver) requestAnimationFrame(refitProps);
}
$('btnPin').addEventListener('click', () => { propsPin = !propsPin; salvaPin(); mostraProps(); });
/* o botao de paineis so existe com a ficha fechada, entao ele SEMPRE prende: abrir para
   fechar sozinho no proximo clique no vazio seria um botao que nao faz nada */
$('btnPaineis').addEventListener('click', () => { propsPin = true; salvaPin(); mostraProps(); });

function prSec(titulo){ const d = el('div', 'pr-sec'); if (titulo) d.append(el('h3', null, titulo)); return d; }
function prKv(box, k, v, cls){
  const g = box.__kv || (box.__kv = (() => { const x = el('div', 'pr-kv'); box.append(x); return x; })());
  g.append(el('span', 'k', k), el('span', 'v' + (cls ? ' ' + cls : ''), v == null || v === '' ? '—' : String(v)));
}
/* os parametros viajam num campo plano "K=V;K=V" (o parser do BuildSchematic le linha a linha) */
function prParams(s){
  const out = [];
  for (const par of String(s || '').split(';')){
    const i = par.indexOf('=');
    if (i > 0 && par.slice(0, i).trim()) out.push([par.slice(0, i).trim(), par.slice(i + 1).trim()]);
  }
  return out;
}
function prPreview(sym, part, fpNome){
  prSym = part || null;
  fitPreview(camPrSym, part ? D.symBBox(part) : null);
  $('prSymHint').textContent = part ? '' : (sym === false ? '' : 'sem geometria na biblioteca');
  const fp = fpNome ? HubCore.footprintOf(PLIB, fpNome) : null;
  prFp = fp || null;
  fitPreview(camPrFp, fp && fp.bbox ? fp.bbox : null);
  $('prFpHint').textContent = fp ? ''
    : fpNome ? '"' + fpNome + '" não está na PcbLib espelhada' : (sym === false ? '' : 'sem footprint');
  requestAnimationFrame(refitProps);
}
function renderProps(){
  const body = $('prBody');
  body.textContent = '';
  const itens = Array.from(sel).filter(onSheet);
  if (!itens.length){
    const s = prSec(null);
    s.append(el('p', 'pr-empty', 'Clique num componente, fio ou pouso de alimentação para ver a ficha dele. '
      + 'A ficha é só de leitura: aqui se olha e se posiciona. Valor, footprint e parâmetro são editados '
      + 'pela IA, no schematic.js.'));
    body.append(s);
    return prPreview(false, null, null);
  }
  if (itens.length > 1){
    const s = prSec('seleção');
    s.append(el('div', 'pr-title', itens.length + ' itens'));
    const cont = {};
    for (const it of itens) cont[it.t] = (cont[it.t] || 0) + 1;
    const NOME = { comp:'componente', wire:'fio', netlabel:'net label', power:'power port', junction:'junção', text:'texto' };
    for (const [k, n] of Object.entries(cont)) prKv(s, (NOME[k] || k) + (n > 1 ? 's' : ''), n);
    body.append(s);
    return prPreview(false, null, null);
  }

  const it = itens[0];
  if (it.t !== 'comp'){
    const NOME = { wire:'fio', netlabel:'net label', power:'power port', junction:'junção', text:'texto' };
    const s = prSec(NOME[it.t] || it.t);
    if (it.t === 'wire'){
      const wi = model.sheets[sheetIdx].wires.indexOf(it);
      s.append(el('div', 'pr-title', (wi >= 0 && nets.wireNet[sheetIdx][wi]) || 'sem net'));
      prKv(s, 'Vértices', (it.pts || []).length);
      const p0 = (it.pts || [])[0] || [0, 0], pn = (it.pts || [])[(it.pts || []).length - 1] || [0, 0];
      prKv(s, 'Início', p0[0] + ' , ' + p0[1] + ' mil', 'mono');
      prKv(s, 'Fim', pn[0] + ' , ' + pn[1] + ' mil', 'mono');
    } else {
      s.append(el('div', 'pr-title', it.net || it.s || (NOME[it.t] || it.t)));
      if (it.style) prKv(s, 'Estilo', it.style);
      if (it.t === 'text') prKv(s, 'Altura', (it.h || 10) + ' mil');
      prKv(s, 'Posição', it.x + ' , ' + it.y + ' mil', 'mono');
      if (it.rot != null) prKv(s, 'Rotação', (((it.rot % 360) + 360) % 360) + '°');
    }
    prKv(s, 'Folha', it.sheet);
    body.append(s);
    return prPreview(false, null, null);
  }

  /* ── componente ── */
  const sym = HubCore.symbolOf(SLIB, it.sym);
  const part = HubCore.partOf(sym, it.part);
  const ac = ACERVO_DE.get(it.sym) || (sym && ACERVO_DE.get(sym.name)) || null;
  const nparts = sym ? (sym.partcount || (sym.parts || []).length || 1) : 1;
  const fpNome = it.footprint || '';

  const g = prSec('geral');
  g.append(el('div', 'pr-title', it.ref));
  if (it.comment) g.append(el('div', 'pr-sub', it.comment));
  prKv(g, 'Comment', it.comment, it.comment ? null : 'dim');
  prKv(g, 'Parte', nparts > 1 ? (it.part || 1) + ' de ' + nparts : '1 de 1');
  prKv(g, 'Descrição', sym && sym.description, sym && sym.description ? null : 'dim');
  prKv(g, 'Designador', sym && sym.designator, sym && sym.designator ? null : 'dim');
  prKv(g, 'Símbolo', it.sym, 'mono');
  /* o resolvedor pode ter entregue outro simbolo (apelido/substituto): dizer qual, senao a
     ficha afirma um nome e o desenho mostra outro */
  if (sym && sym.name !== it.sym) prKv(g, 'Resolvido em', sym.name, 'mono');
  prKv(g, 'Acervo', ac ? ac.titulo : (sym ? '—' : 'ausente na biblioteca'), ac ? null : 'warn');
  prKv(g, 'Footprint', fpNome, fpNome ? 'mono' : 'warn');
  if (fpNome && !HubCore.footprintOf(PLIB, fpNome)) prKv(g, '', 'não está na PcbLib espelhada', 'warn');
  body.append(g);

  const p = prSec('posição');
  prKv(p, 'X', it.x + ' mil', 'mono');
  prKv(p, 'Y', it.y + ' mil', 'mono');
  prKv(p, 'Rotação', ((((it.rot || 0) % 360) + 360) % 360) + '°');
  prKv(p, 'Espelhado', it.mirror ? 'sim' : 'não');
  prKv(p, 'Folha', it.sheet);
  body.append(p);

  const pars = prParams(it.params);
  if (pars.length){
    const s = prSec('parâmetros');
    for (const [k, v] of pars) prKv(s, k, v);
    body.append(s);
  }

  const pins = HubCore.compPinsWorld(it, SLIB) || [];
  const s = prSec('pinos (' + pins.length + ')');
  if (!pins.length) s.append(el('p', 'pr-empty', sym ? 'a parte não tem pinos' : 'símbolo ausente — sem pinagem para mostrar'));
  else {
    const t = el('table', 'pr-tab');
    const th = el('tr');
    for (const c of ['#', 'nome', 'net']) th.append(el('th', null, c));
    t.append(el('thead', null).appendChild(th).parentNode);
    const tb = el('tbody');
    for (const pin of pins){
      const tr = el('tr');
      const rede = nets.pinNet[it.ref + '-' + pin.num] || '';
      tr.append(el('td', 'n', pin.num), el('td', null, pin.name || '—'));
      const td = el('td', 'net' + (rede ? '' : ' sem'), rede || 'sem net');
      td.title = rede || 'sem net';
      tr.append(td);
      tb.append(tr);
    }
    t.append(tb);
    s.append(t);
  }
  body.append(s);

  prPreview(sym, part, fpNome);
}

/* ------- salvar ------- */
const SCH_REL = 'Projects/' + SCH_P + '/schematic.js';
const ANN_REL = 'Projects/' + SCH_P + '/annotations.js';
(async () => { if (HubIO.canPost) try { schDiskSnapshot = await HubIO.fetchText(SCH_REL); } catch (e) {} })();

/* as perguntas de seguranca dos dois escritores viram modal; o resultado, notificacao */
const SOBRESCREVER = { title:'Salvar', ok:'Sobrescrever', danger:true };
async function falhaSalvar(err, nome, texto){
  if (await HubDialog.confirm('Salvar no servidor falhou: ' + err.message + '\nBaixar o arquivo em vez disso?',
      { title:'Falha ao salvar', ok:'Baixar' }))
    HubIO.download(nome, texto);
}
async function saveSchematic(){
  if (staleWorkspace && !(await HubDialog.confirm('O workspace mudou desde o carregamento — salvar vai sobrescrever o schematic.js do disco. Continuar?', SOBRESCREVER))) return null;
  const out = HubCore.serializeSchematic(schematic);
  if (!out.text){ await HubDialog.alert(out.errors.map(e => e.msg).join('\n'), { title:'Esquema inválido' }); return null; }
  if (HubIO.canPost){
    try {
      const cur = await HubIO.fetchText(SCH_REL);
      if ((schDiskSnapshot === null || cur !== schDiskSnapshot) &&
          !(await HubDialog.confirm('schematic.js mudou no disco desde o carregamento (outro escritor — a IA?). Sobrescrever mesmo assim?', SOBRESCREVER))) return null;
    } catch (e) {}
  }
  try {
    const r = await HubIO.saveFile(SCH_REL, out.text);
    setSchDirty(false);
    staleWorkspace = false;
    schDiskSnapshot = out.text;
    return r.mode === 'server' ? { m:'schematic.js salvo', k:'ok' } : { m:'arquivo baixado — substitua ' + SCH_REL, k:'warn' };
  } catch (err) { await falhaSalvar(err, 'schematic.js', out.text); return null; }
}
async function saveAnnotations(){
  if (staleWorkspace && !(await HubDialog.confirm('O workspace mudou desde o carregamento — salvar vai sobrescrever o annotations.js do disco. Continuar?', SOBRESCREVER))) return null;
  const out = HubCore.serializeAnnotations(ANN);
  if (!out.text){ await HubDialog.alert(out.errors.map(e => e.msg).join('\n'), { title:'Sinalizadores inválidos' }); return null; }
  try {
    const r = await HubIO.saveFile(ANN_REL, out.text);
    setAnnDirty(false);
    staleWorkspace = false;
    return r.mode === 'server' ? { m:'sinalizadores salvos', k:'ok' } : { m:'arquivo baixado — substitua ' + ANN_REL, k:'warn' };
  } catch (err) { await falhaSalvar(err, 'annotations.js', out.text); return null; }
}
/* grava o que estiver alterado; sem nada pendente, grava o esquema (o que o botao antigo fazia) */
async function saveAll(){
  if (schDirty || !annDirty){ const r = await saveSchematic(); if (r) HubDialog.toast(r.m, r.k); }
  if (annDirty){ const r = await saveAnnotations(); if (r) HubDialog.toast(r.m, r.k); }
}
$('btnSave').addEventListener('click', saveAll);

/* ---------- desenho ---------- */
function sheetBBox(){
  const s = model.sheets[sheetIdx];
  const sz = HubCore.SHEET_SIZES[s.size] || HubCore.SHEET_SIZES.A4;
  return { x1:0, y1:0, x2:sz[0], y2:sz[1] };
}
function drawWorld(ctx, cam){
  const s = model.sheets[sheetIdx];
  const bb = sheetBBox();
  ctx.fillStyle = D.SCH.sheet;
  ctx.fillRect(bb.x1, bb.y1, bb.x2-bb.x1, bb.y2-bb.y1);
  if (showState.grid && cam.scale > 0.045) {
    ctx.strokeStyle = D.SCH.grid; ctx.lineWidth = 1/cam.scale;
    ctx.beginPath();
    for (let x = 0; x <= bb.x2; x += 100) { ctx.moveTo(x, 0); ctx.lineTo(x, bb.y2); }
    for (let y = 0; y <= bb.y2; y += 100) { ctx.moveTo(0, y); ctx.lineTo(bb.x2, y); }
    ctx.stroke();
  }
  ctx.strokeStyle = D.SCH.border; ctx.lineWidth = 8;
  ctx.strokeRect(bb.x1, bb.y1, bb.x2-bb.x1, bb.y2-bb.y1);

  /* A COR E A IDENTIDADE ELETRICA, NAO A SELECAO.
     Um fio sai laranja quando pertence a net em foco e azul-escuro quando nao — e so. Quem
     esta selecionado ganha o contorno tracejado do drawSelection, por cima, como na vista
     PCB e como no Altium. Enquanto a selecao RECOLORIA, clicar num fio deixava o fio azul e
     os companheiros de net laranja: uma net com duas cores, que se lia como cor travada. */
  s.wires.forEach((w, wi) => {
    const hl = selNet && nets.wireNet[sheetIdx][wi] === selNet;
    ctx.strokeStyle = hl ? D.SCH.hl : D.SCH.wire;
    ctx.lineWidth = hl ? 14 : 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    (w.pts || []).forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.stroke();
  });
  /* junctions explicitas + automaticas: sao pontos DA net, entao acendem com ela */
  for (const j of s.junctions)
    D.drawJunction(ctx, j.x, j.y, selNet && netEm(j.x, j.y) === selNet ? D.SCH.hl : undefined);
  for (const j of nets.autoJunctions) if (j.sheet === sheetIdx)
    D.drawJunction(ctx, j.x, j.y, selNet && netEm(j.x, j.y) === selNet ? D.SCH.hl : undefined);

  /* componentes */
  /* o simbolo tambem nao muda de cor por estar selecionado: o azul entrava por cima dos
     PINOS junto com o corpo (o stroke do hub-draw vale para os dois), e pinos de outras nets
     ficavam azuis sem motivo. Quem marca o componente e o contorno tracejado. */
  for (const c of s.comps) {
    const sym = HubCore.symbolOf(SLIB, c.sym);
    const part = HubCore.partOf(sym, c.part);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(((((c.rot||0)%360)+360)%360) * Math.PI/180);
    if (c.mirror) ctx.scale(-1, 1);
    if (part) D.drawSymbolPart(ctx, part, {});
    else { ctx.strokeStyle = '#ff5252'; ctx.strokeRect(-100, -100, 200, 200); }
    ctx.restore();
    const bbref = part ? D.symBBox(part) : { x1:-100, y1:-100, x2:100, y2:100 };
    D.worldText(ctx, c.ref, c.x, c.y + Math.max(Math.abs(bbref.y1), Math.abs(bbref.y2)) + 70, 60, 0, '#000000', 'center');
    if (c.comment)
      D.worldText(ctx, c.comment, c.x, c.y - Math.max(Math.abs(bbref.y1), Math.abs(bbref.y2)) - 70, 55, 0, '#333366', 'center');
  }
  /* pinos destacados da net selecionada */
  if (selNet) {
    for (const c of s.comps) {
      const pins = HubCore.compPinsWorld(c, SLIB) || [];
      for (const p of pins)
        if (nets.pinNet[c.ref + '-' + p.num] === selNet) {
          ctx.strokeStyle = D.SCH.hl; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(p.x, p.y, 35, 0, 2*Math.PI); ctx.stroke();
        }
    }
  }
  /* rotulos e power: acendem com a net deles. A guarda `selNet &&` importa — sem ela, com o
     foco vazio um rotulo de net vazia casava com '' e acendia sozinho. */
  for (const l of s.netlabels) D.drawNetLabel(ctx, l, selNet && selNet === l.net ? D.SCH.hl : undefined);
  for (const p of s.powers)    D.drawPowerPort(ctx, p, selNet && selNet === p.net ? D.SCH.hl : undefined);
  for (const t of s.texts)     D.worldText(ctx, t.s || '', t.x, t.y, (t.h || 10) * 6, t.rot || 0, D.SCH.text, 'left');

  /* sinalizadores da folha ativa */
  for (const a of ANN){
    if (a.view !== 'sch' || a.sheet !== s.name) continue;
    const c = ANN_COLORS[a.severity] || ANN_COLORS.info;
    const sz = 16 / cam.scale;
    ctx.save();
    ctx.globalAlpha = a.status === 'resolved' ? 0.45 : 1;
    ctx.strokeStyle = c; ctx.fillStyle = c;
    ctx.lineWidth = 2.5 / cam.scale; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, a.y + sz * 1.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.x, a.y + sz * 1.6); ctx.lineTo(a.x + sz * 1.1, a.y + sz * 1.25);
    ctx.lineTo(a.x, a.y + sz * 0.9); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(a.x, a.y, 3 / cam.scale, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  drawSelection(ctx, cam);
  drawFerramenta(ctx, cam);
}
/* o que a ferramenta na mao esta prestes a fazer: o fio em elastico, o pouso de
   alimentacao em fantasma e o alvo do ima */
function drawFerramenta(ctx, cam){
  const px = 1 / cam.scale;
  if (wireDraw && wireDraw.pts.length){
    const last = wireDraw.pts[wireDraw.pts.length - 1];
    ctx.save();
    ctx.strokeStyle = D.SCH.wire; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    wireDraw.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.stroke();
    if (hoverW){
      const r = wirePoint(hoverW);
      ctx.globalAlpha = 0.7; ctx.setLineDash([30, 20]);
      ctx.beginPath(); ctx.moveTo(last[0], last[1]);
      if (r.pt[0] !== last[0] && r.pt[1] !== last[1]) ctx.lineTo(r.pt[0], last[1]);
      ctx.lineTo(r.pt[0], r.pt[1]);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (tool === 'power' && toolPower && hoverW){
    const x = snapHit ? snapHit.x : snap100(hoverW.x), y = snapHit ? snapHit.y : snap100(hoverW.y);
    ctx.save(); ctx.globalAlpha = 0.6;
    D.drawPowerPort(ctx, { x, y, net:toolPower.net, style:toolPower.style, rot:toolPower.rot });
    ctx.restore();
  }
  /* o ima: alvo laranja no ponto de conexao que vai grudar */
  if (tool !== 'select' && snapHit){
    const r = 7 * px;
    ctx.save();
    ctx.strokeStyle = D.SCH.hl; ctx.lineWidth = 2 * px; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(snapHit.x, snapHit.y, r, 0, 2 * Math.PI); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(snapHit.x - r * 2.1, snapHit.y); ctx.lineTo(snapHit.x - r * 1.2, snapHit.y);
    ctx.moveTo(snapHit.x + r * 1.2, snapHit.y); ctx.lineTo(snapHit.x + r * 2.1, snapHit.y);
    ctx.moveTo(snapHit.x, snapHit.y - r * 2.1); ctx.lineTo(snapHit.x, snapHit.y - r * 1.2);
    ctx.moveTo(snapHit.x, snapHit.y + r * 1.2); ctx.lineTo(snapHit.x, snapHit.y + r * 2.1);
    ctx.stroke();
    ctx.restore();
  }
}
/* as bordinhas: caixa tracejada com alcas nos cantos em cada item marcado (nos fios, tambem
   em cada vertice) e o retangulo de selecao enquanto ele e arrastado */
function drawSelection(ctx, cam){
  const px = 1 / cam.scale, hs = 3.5 * px, m = 40;
  ctx.save();
  for (const it of sel){
    if (!onSheet(it)) continue;
    const bb = itemBBox(it);
    const x = bb.x1 - m, y = bb.y1 - m, w = (bb.x2 - bb.x1) + 2*m, h = (bb.y2 - bb.y1) + 2*m;
    ctx.strokeStyle = SEL; ctx.lineWidth = 1.5 * px; ctx.setLineDash([6 * px, 4 * px]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = SEL;
    for (const [cx, cy] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) ctx.fillRect(cx - hs, cy - hs, 2*hs, 2*hs);
    if (it.t === 'wire') for (const p of (it.pts || [])) ctx.fillRect(p[0] - hs, p[1] - hs, 2*hs, 2*hs);
  }
  if (boxRect){
    const r = boxRect;
    ctx.fillStyle = 'rgba(41,121,255,0.12)'; ctx.strokeStyle = SEL; ctx.lineWidth = px;
    if (r.x2 < r.x1) ctx.setLineDash([5 * px, 4 * px]);     /* direita→esquerda: "quem encosta" */
    ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
    ctx.strokeRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
  }
  ctx.restore();
}
const cam = D.mkCamera(cv, drawWorld, {
  bg:'#3a3a34',
  onMove: w => {
    hoverW = w;
    $('sx').textContent = w.x.toFixed(0);
    $('sy').textContent = w.y.toFixed(0);
    /* com ferramenta na mao o que interessa e o ima, nao o que esta sob o cursor */
    if (tool !== 'select'){
      snapHit = panning ? null : snapPoint(w);
      $('shover').textContent = snapHit ? '⊙ ' + snapHit.label
        : (tool === 'wire' ? (wireDraw ? 'clique para o próximo ponto · botão direito encerra' : 'clique para começar o fio')
                           : 'clique para pousar ' + (toolPower ? toolPower.net : ''));
      cam.draw();
      return;
    }
    if (mouse || panning) return;      /* durante um gesto o hover nao manda no cursor nem no texto */
    const h = hitTest(w.x, w.y);
    $('shover').textContent =
      h ? (h.kind === 'pin' ? `${h.ref}-${h.num} · ${nets.pinNet[h.ref + '-' + h.num] || 'sem net'}`
                            : h.kind === 'wire' ? (nets.wireNet[sheetIdx][h.wi] || 'fio') : describe(h.item)) : '';
    cv.style.cursor = annTool ? 'copy' : 'default';   /* seta normal; so o pan (agarrando) e o sinalizador mudam */
  }
});

function hitTest(x, y){
  const s = model.sheets[sheetIdx];
  const tol = 8 / cam.cam.scale;
  for (const c of s.comps) {
    const pins = HubCore.compPinsWorld(c, SLIB) || [];
    for (const p of pins)
      if (Math.hypot(x - p.x, y - p.y) <= Math.max(tol, 30)) return { kind:'pin', ref:c.ref, num:p.num, item:c };
  }
  for (const j of s.junctions)
    if (Math.hypot(x - j.x, y - j.y) <= Math.max(tol, 35)) return { kind:'junction', item:j };
  for (const l of s.netlabels)
    if (x >= l.x - 20 && x <= l.x + Math.max((l.net || '').length * 40, 120) && y >= l.y - 20 && y <= l.y + 80)
      return { kind:'netlabel', item:l };
  for (const p of s.powers)
    if (Math.hypot(x - p.x, y - p.y) <= Math.max(tol, 140)) return { kind:'power', item:p };
  for (const t of s.texts)
    if (x >= t.x - 20 && x <= t.x + Math.max((t.s || '').length * (t.h || 10) * 4, 120) &&
        y >= t.y - (t.h || 10) * 4 && y <= t.y + (t.h || 10) * 4)
      return { kind:'text', item:t };
  for (let wi = 0; wi < s.wires.length; wi++) {
    const pts = s.wires[wi].pts || [];
    for (let i = 0; i < pts.length - 1; i++)
      if (HubCore.distSeg(x, y, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]) <= Math.max(tol, 20))
        return { kind:'wire', wi, item:s.wires[wi] };
  }
  for (const c of s.comps) {
    const sym = HubCore.symbolOf(SLIB, c.sym);
    const part = HubCore.partOf(sym, c.part);
    const bb = part ? D.symBBox(part) : { x1:-100, y1:-100, x2:100, y2:100 };
    const r = Math.max(bb.x2 - bb.x1, bb.y2 - bb.y1) / 2 + 50;
    if (Math.hypot(x - c.x, y - c.y) <= r) return { kind:'comp', ref:c.ref, item:c };
  }
  return null;
}

/* ------- sinalizadores ------- */
function setAnnTool(v){
  if (v && !editOn) return;
  if (v && tool !== 'select') setTool('select');   /* uma ferramenta de cada vez na mao */
  annTool = v;
  $('btnAnn').classList.toggle('active', v);
  cv.style.cursor = v ? 'copy' : 'default';
  if (!v) hideAnnForm();
}
function hideAnnForm(){ $('annform').style.display = 'none'; annPending = null; }
function openAnnForm(w){
  annPending = { x: Math.round(w.x), y: Math.round(w.y) };
  $('anntext').value = '';
  $('annform').style.display = 'block';
  $('anntext').focus();
}
function annNextId(){
  let mx = 0;
  for (const a of ANN){ const n = parseInt(String(a.id || '').replace(/^n/, ''), 10); if (isFinite(n) && n > mx) mx = n; }
  return 'n' + (mx + 1);
}
function nowStr(){
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function annChanged(){ setAnnDirty(true); buildAnnPanel(); cam.draw(); }
function buildAnnPanel(){
  const list = $('annlist');
  const mine = ANN.filter(a => a.view === 'sch');
  $('anncount').textContent = mine.length;
  list.innerHTML = mine.length ? '' : '<div style="color:var(--fg-dim)">nenhum — use ⚑ Sinalizar (Configurações)</div>';
  for (const a of mine){
    const div = document.createElement('div');
    div.className = 'annitem ' + a.severity + (a.status === 'resolved' ? ' resolved' : '');
    const x = document.createElement('span');
    x.className = 'annx'; x.textContent = '✕'; x.title = 'apagar';
    x.addEventListener('click', ev => { ev.stopPropagation(); if (!editOn) return; ANN.splice(ANN.indexOf(a), 1); annChanged(); });
    div.appendChild(x);
    div.appendChild(document.createTextNode(
      `${a.id} [${a.sheet}]: ${a.msg}` + (a.status === 'resolved' ? (a.reply ? ` ✓ ${a.reply}` : ' ✓') : '')));
    div.addEventListener('click', () => {
      const si = model.sheets.findIndex(sh => sh.name === a.sheet);
      if (si >= 0 && si !== sheetIdx){ sheetIdx = si; $('sheetsel').value = si; limpaSel(); }
      cam.fit({ x1: a.x - 900, y1: a.y - 900, x2: a.x + 900, y2: a.y + 900 });
    });
    list.appendChild(div);
  }
}
$('annok').addEventListener('click', () => {
  const msg = $('anntext').value.trim().replace(/"/g, "'");
  if (!msg || !annPending) return;
  ANN.push({ id: annNextId(), view: 'sch', sheet: model.sheets[sheetIdx].name,
             x: annPending.x, y: annPending.y, severity: $('annsev').value,
             msg, ref: '', status: 'open', created: nowStr(), reply: '' });
  hideAnnForm(); annChanged();
});
$('anncancel').addEventListener('click', hideAnnForm);
$('btnAnn').addEventListener('click', () => setAnnTool(!annTool));

/* ------- teclado ------- */
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (addOpen()){ closeAdd(); return; }
    if (wireDraw){ wireDraw = null; cam.draw(); return; }
    if (tool !== 'select'){ setTool('select'); return; }
    if (mouse){
      if (mouse.mode === 'move') applyMove(mouse.base, 0, 0);
      mouse = null; boxRect = null; swallowClick = true; cam.draw(); return;
    }
    if (annTool){ setAnnTool(false); return; }
    /* Escape e o botao de panico: larga a selecao E o foco de net. Enquanto largava so a
       selecao, a folha ficava laranja sem nada marcado — a "cor travada". */
    if (sel.size || selNet) limpaSel();
    return;
  }
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (addOpen()) return;                       /* os atalhos da folha nao valem dentro do modal */
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 'z'){ e.preventDefault(); if (editOn) undo(); return; }
  if (e.ctrlKey && k === 'y'){ e.preventDefault(); if (editOn) redo(); return; }
  if (e.ctrlKey && k === 'a'){ e.preventDefault(); selectOnly(sheetItems()); return; }
  /* Ctrl+W e do NAVEGADOR (fecha a aba) e nenhuma pagina consegue interceptar — o atalho do
     fio e o W sozinho. Isto aqui so pega onde o Ctrl+W chega mesmo (janela de aplicativo). */
  if (e.ctrlKey && k === 'w'){ e.preventDefault(); setTool(tool === 'wire' ? 'select' : 'wire'); return; }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (k === 'e'){ setEdit(!editOn); return; }
  if (k === 'c'){ openAdd(); return; }
  if (k === 'n'){ setAnnTool(!annTool); return; }
  if (k === 'w'){ setTool(tool === 'wire' ? 'select' : 'wire'); return; }
  if (k === 'g'){ setTool(tool === 'power' && toolPower && toolPower.net === 'GND' ? 'select' : 'power',
                          { net:'GND', style:'GndPower', rot:270 }); return; }
  if (!editOn) return;
  if (e.key === 'Delete'){ deleteSel(); return; }
  if (e.key === ' ' && sel.size){ e.preventDefault(); rotateSel(); return; }
  if (k === 'x' && sel.size){ mirrorSel(); return; }
});
window.__hubOnChange = function(){
  if (!annDirty && !schDirty){ location.reload(); return; }
  staleWorkspace = true;
  $('annmsg').textContent = '⚠ workspace mudou — salve e recarregue (F5)';
  HubDialog.toast('O workspace mudou com edições pendentes aqui — salve e recarregue (F5).', 'warn', 0);
};
window.__hubDirty = function(){ return annDirty || schDirty; };
window.__hubSelectComp = function(ref){
  for (const s of model.sheets){ const c = s.comps.find(c => c.ref === ref); if (c){ focusComp(c); return; } }
};
window.addEventListener('beforeunload', e => { if (annDirty || schDirty){ e.preventDefault(); e.returnValue = ''; } });

/* ---------- paineis ---------- */
function focusComp(c){
  const si = model.sheets.findIndex(sh => sh.name === c.sheet);
  if (si >= 0 && si !== sheetIdx){ sheetIdx = si; $('sheetsel').value = si; }
  sel.clear(); sel.add(c);
  /* a porta de entrada do hub (__hubSelectComp) tambem passa por aqui: nao pode deixar a net
     anterior acesa por baixo do componente novo */
  aplicaSel('');
  cam.fit({ x1:c.x-800, y1:c.y-800, x2:c.x+800, y2:c.y+800 });
}
function buildCompTable(){
  const tb = document.querySelector('#comptable tbody');
  tb.innerHTML = '';
  let n = 0;
  for (const s of model.sheets) for (const c of s.comps) {
    n++;
    const tr = document.createElement('tr');
    if (sel.has(c)) tr.className = 'sel';
    for (const v of [c.ref, c.sym, c.footprint || '—', c.comment || '']) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    tr.addEventListener('click', () => focusComp(c));
    tb.appendChild(tr);
  }
  $('compcount').textContent = n;
}
function buildNetList(){
  $('netcount').textContent = nets.nets.length;
  const list = $('netlist');
  list.innerHTML = '';
  for (const n of nets.nets) {
    const div = document.createElement('div');
    div.className = 'netitem' + (n.name === selNet ? ' sel' : '');
    div.textContent = `${n.name}${n.auto ? ' (auto)' : ''} — ${n.pins.join(', ')}`;
    /* escolher a net pela lista tambem larga a selecao: um foco de cada vez na tela */
    div.addEventListener('click', () => { sel.clear(); aplicaSel(n.name === selNet ? '' : n.name); });
    list.appendChild(div);
  }
  netListDe = selNet;
}
function buildValList(){
  const list = $('vallist');
  list.innerHTML = '';
  const items = val.errors.map(m => ({ level:'err', m }))
    .concat(val.warnings.map(m => ({ level:'warn', m })))
    .concat(nets.warnings.map(m => ({ level:'warn', m })));
  if (!items.length) { list.innerHTML = '<div style="color:var(--ok)">✓ sem problemas</div>'; return; }
  for (const it of items) {
    const div = document.createElement('div');
    div.className = 'valitem ' + it.level;
    div.textContent = it.m;
    list.appendChild(div);
  }
}
function buildSheetSel(){
  const s = $('sheetsel');
  s.innerHTML = '';
  model.sheets.forEach((sh, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = `folha: ${sh.name} (${sh.size})`;
    s.appendChild(o);
  });
  /* a net acesa e da folha antiga: levar o laranja junto pintaria fios de outra folha */
  s.addEventListener('change', () => { sheetIdx = +s.value; limpaSel(); cam.fit(sheetBBox()); });
}
/* sub-abas do painel: a ultima aberta fica lembrada nesta maquina */
function showPane(id){
  document.querySelectorAll('#side .subtab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pane === id)));
  $('pane-comps').classList.toggle('on', id === 'comps');
  $('pane-cfg').classList.toggle('on', id === 'cfg');
  try { localStorage.setItem('schframe.pane', id); } catch (e) {}
}
document.querySelectorAll('#side .subtab').forEach(b => b.addEventListener('click', () => showPane(b.dataset.pane)));
let pane0 = 'comps';
try { pane0 = localStorage.getItem('schframe.pane') || 'comps'; } catch (e) {}
showPane(pane0 === 'cfg' ? 'cfg' : 'comps');

/* ------- divisorias dos dois paineis -------
   Mesmo gesto das abas Laser e BOM do hub: arrastar redimensiona, soltar perto da borda
   fecha, duplo clique fecha/abre. A largura fica lembrada nesta maquina. O canvas nao
   precisa de aviso: o mkCamera observa o proprio elemento e redesenha quando ele muda —
   so os previews da ficha e que precisam refazer o enquadramento. */
const SIDE_SNAP = 90, SIDE_VIEW_MIN = 240;   /* os mesmos limites do hub */
function mkPainel(o){
  let larg = o.padrao;
  try { const v = localStorage.getItem(o.chave); if (v !== null && isFinite(+v)) larg = Math.max(0, +v); } catch (e) {}
  const aplica = () => {
    document.documentElement.style.setProperty(o.varCss, larg + 'px');
    /* o painel da esquerda some pela propria largura; o da direita nao — la quem manda em
       estar na tela e o [hidden], que segue a selecao, e display inline atropelaria isso */
    if (!o.porHidden) $(o.el).style.display = larg ? '' : 'none';
    if (o.aoMudar) o.aoMudar(larg);
  };
  const salva = () => { try { localStorage.setItem(o.chave, String(larg)); } catch (e) {} };
  const sp = $(o.split);
  sp.addEventListener('pointerdown', e => {
    const total = $('main').getBoundingClientRect().width;
    const teto = Math.max(SIDE_SNAP, total - SIDE_VIEW_MIN - 12);
    const x0 = e.clientX, w0 = larg;
    sp.classList.add('on');
    sp.setPointerCapture(e.pointerId);
    /* o painel da direita cresce para o lado contrario do ponteiro */
    const move = ev => { const w = w0 + (ev.clientX - x0) * (o.lado === 'r' ? -1 : 1);
                         larg = w < SIDE_SNAP ? 0 : Math.min(w, teto); aplica(); };
    const up = () => {
      sp.classList.remove('on');
      sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); sp.removeEventListener('pointercancel', up);
      salva();
    };
    sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up); sp.addEventListener('pointercancel', up);
    e.preventDefault();
  });
  sp.addEventListener('dblclick', () => { larg = larg ? 0 : o.padrao; aplica(); salva(); });
  aplica();
  return { larg: () => larg, abre(){ if (!larg){ larg = o.padrao; aplica(); salva(); } } };
}
mkPainel({ chave:'schframe.sideW', varCss:'--side-w', el:'side', split:'split', padrao:330, lado:'l' });
/* arrastar a divisoria da ficha ate o fim e o mesmo que soltar o alfinete: some agora e
   volta quando alguma coisa for selecionada (ou pelo botao de paineis) */
painelProps = mkPainel({ chave:'schframe.propsW', varCss:'--props-w', el:'props', split:'splitR',
  padrao:320, lado:'r', porHidden:true,
  aoMudar: w => { if (!w && propsPin){ propsPin = false; salvaPin(); } mostraProps(); } });
mostraProps();

$('btnFit').addEventListener('click', () => cam.fit(sheetBBox()));
$('btnGrid').addEventListener('click', () => {
  showState.grid = !showState.grid; $('btnGrid').classList.toggle('active', showState.grid); cam.draw();
});
$('btnEdit').addEventListener('click', () => setEdit(!editOn));

buildSheetSel(); buildCompTable(); buildNetList(); buildValList(); buildAnnPanel();
updateMeta(); updateSaveBtn(); updateSelStatus(); cartRender(); renderProps();
cam.resize(); cam.fit(sheetBBox());
setEdit(false);   /* abre travado; tambem ja desabilita o que edita */

})();
