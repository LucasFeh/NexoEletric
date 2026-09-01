/* AltiumPCBMirror v2 - hub-bom.js
   BOM interativo: uma pagina HTML AUTOSSUFICIENTE com a placa desenhada dos dois lados e a
   lista de componentes ao lado. E para montar a placa na mao - clicar na linha acende as
   peças no desenho, clicar na peça acha a linha, e o visto de cada linha fica salvo. Mesma
   ideia do InteractiveHtmlBom, construida sobre o board.js que o ExportPcb ja gera.

   POR QUE A GEOMETRIA SAI ACHATADA: o arquivo tem que abrir sozinho, em qualquer pasta, sem
   internet e sem os .js do espelho ao lado. Entao a pagina NAO carrega hub-font.js nem
   hub-laser.js - ela recebe a geometria ja resolvida (pad virou poligono, texto virou
   polilinha) e so precisa saber preencher poligono e traçar linha. E o que mantem UMA
   implementacao de forma de pad e UMA de fonte no projeto - as que ja estao sob teste - em
   vez de abrir uma terceira copia dentro do template.

   Contrato de coordenadas: o mesmo do board.js (mm, Y para cima, relativo a origem da
   placa). O verso e espelhado em X na HORA DE DESENHAR, nao aqui: o dado continua sendo o
   da placa, e quem olha por baixo e a camera. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./hub-font.js'), require('./hub-laser.js'));
  else root.HubBom = factory(root.HubFont, root.HubLaser);
})(typeof self !== 'undefined' ? self : this, function (HubFont, HubLaser) {
"use strict";

/* mesma paleta da vista PCB do hub: quem monta a placa olha as duas telas no mesmo dia */
const COR = {
  0: { pad:'#ff5252', silk:'#ffe14d', trilha:'#c0392b', regiao:'#7a2620' },  /* frente */
  1: { pad:'#4d7cff', silk:'#c9c04d', trilha:'#2c4bb0', regiao:'#22306e' },  /* verso  */
  th:'#c9c9c9', furo:'#0d0d0d', borda:'#e8e8ea', alvo:'#25d07d', net:'#ff9d2e',
};

/* Icones da barra. Sao poucos tracos de proposito: a 21x14 px o que se le e a SILHUETA -
   uma placa com a peça em cima (frente), a mesma tracejada com a peça do outro lado (verso),
   duas placas (as duas faces), tres linhas (a lista) e os cursores (ajustes). */
const SVG = {
  frente: '<svg viewBox="0 0 21 14" width="21" height="14" aria-hidden="true">' +
          '<rect x="0.6" y="0.6" width="19.8" height="12.8" rx="2"/>' +
          '<rect class="f" x="4" y="4" width="7" height="4" rx="1"/></svg>',
  verso:  '<svg viewBox="0 0 21 14" width="21" height="14" aria-hidden="true">' +
          '<rect x="0.6" y="0.6" width="19.8" height="12.8" rx="2" stroke-dasharray="3 2"/>' +
          '<rect class="f" x="10" y="6" width="7" height="4" rx="1"/></svg>',
  ambos:  '<svg viewBox="0 0 21 14" width="21" height="14" aria-hidden="true">' +
          '<rect x="0.6" y="1.6" width="8.8" height="10.8" rx="2"/>' +
          '<rect x="11.6" y="1.6" width="8.8" height="10.8" rx="2" stroke-dasharray="3 2"/></svg>',
  lista:  '<svg viewBox="0 0 21 14" width="21" height="14" aria-hidden="true">' +
          '<line x1="2" y1="3" x2="19" y2="3"/><line x1="2" y1="7" x2="19" y2="7"/>' +
          '<line x1="2" y1="11" x2="19" y2="11"/></svg>',
  ajustes:'<svg viewBox="0 0 21 14" width="21" height="14" aria-hidden="true">' +
          '<line x1="2" y1="4" x2="19" y2="4"/><line x1="2" y1="10" x2="19" y2="10"/>' +
          '<circle class="f" cx="7" cy="4" r="2.2"/><circle class="f" cx="14" cy="10" r="2.2"/></svg>',
};

const TOL = 0.01;          /* mm - flecha ao achatar arco de pad em poligono */
const LADO = ['Frente', 'Verso'];

function defaults(){
  return {
    /* o que a pagina mostra ao abrir; tudo continua alternavel la dentro */
    pads:true, silk:true, refs:true, tracks:false, regions:false, drills:true,
    /* visao guiada: escolher na lista leva a camera ate a peça, como a aba Neoden faz na
       vista PCB. Desligada por padrao - quem quer ver a placa inteira enquanto confere nao
       quer que ela pule a cada linha. */
    guided:false,
    layout:'lr',            /* lr = frente e verso lado a lado | f | b | bom */
    dark:true,
    empresa:'', revisao:'',
  };
}
const norm = o => Object.assign(defaults(), o || {});

/* Top/TopOverlay -> 0 (frente), Bottom/BottomOverlay -> 1 (verso), resto -> null.
   Camada interna nao aparece no BOM: quem monta a placa nao alcança ela. */
function ladoDe(layer){
  if (layer === 'Top' || layer === 'TopOverlay') return 0;
  if (layer === 'Bottom' || layer === 'BottomOverlay') return 1;
  return null;
}

const r3 = v => Math.round(v * 1000) / 1000;
const poly3 = p => p.map(q => [r3(q[0]), r3(q[1])]);

/* ordem natural de designador: R2 antes de R10, e nao depois */
const natural = (a, b) =>
  String(a).localeCompare(String(b), undefined, { numeric:true, sensitivity:'base' });

/* Texto da serigrafia -> polilinhas no mundo. Repete a transformacao do pcbframe
   (translate, rotate, espelho em X) sobre o que o HubFont entrega em coordenadas locais. */
function textoPolys(t){
  const txt = String(t.text == null ? '' : t.text);
  if (!txt) return [];
  const rot = ((t.rot || 0) * Math.PI) / 180;
  const co = Math.cos(rot), si = Math.sin(rot), mx = t.mirror ? -1 : 1;
  return HubFont.textPolylines(txt, t.h || 1).map(poly =>
    poly.map(pt => {
      const lx = pt[0] * mx, ly = pt[1];
      return [r3(t.x + lx*co - ly*si), r3(t.y + lx*si + ly*co)];
    }));
}

/* pad -> { p:[poligonos], h:[poligonos]|null }. A forma vem do hub-laser, que ja resolve
   circulo, oval, roundrect, octogono e retangulo, e o furo com drillshape/holerot.

   POR QUE UMA LISTA E NAO UM POLIGONO: o primPolys devolve pedaços que se SOBREPOEM, e a
   forma do pad e a UNIAO deles - o hub-laser une depois, no raster. Ficar so com o primeiro
   desenha o retangulo INTERNO de um roundrect (sai menor 2x o raio) e, num oval vertical,
   so o disco de uma das pontas, 0,25 mm fora do centro: 132 dos 2398 pads do acervo sairiam
   errados. Como todos vao pintados da MESMA cor, preencher um por um entrega a uniao de
   graça, sem precisar do unificador aqui dentro. */
function padGeom(p, isTH){
  const pr = HubLaser.padPrim(p, null);
  const polys = HubLaser.primPolys(pr, 0, TOL).filter(q => q && q.length > 2);
  if (!polys.length) return null;
  const out = { p: polys.map(poly3) };
  const dp = HubLaser.drillPrim(p, isTH);
  if (dp){
    const hp = HubLaser.primPolys(dp, 0, TOL).filter(q => q && q.length > 2);
    if (hp.length) out.h = hp.map(poly3);
  }
  return out;
}

const padTH = p => p.type === 'th' || p.layer === 'Multi';

/* ═══════════════ modelo ═══════════════
   Uma volta so pelo board.js: sai a geometria por lado, a lista de componentes e os grupos
   do BOM. O que a pagina recebe e exatamente isto, serializado. */
function model(board, opts){
  const o = norm(opts);
  const B = board || {};
  const avisos = [];

  /* ── componentes e grupos ── */
  const comps = [];
  (B.components || []).forEach(c => {
    const s = ladoDe(c.layer);
    if (s === null){ avisos.push('componente ' + (c.ref || '?') + ' em camada inesperada: ' + c.layer); return; }
    comps.push({ ref: c.ref || '?', val: c.comment || '', fp: c.footprint || '',
                 s, x: r3(c.x || 0), y: r3(c.y || 0),
                 bb: c.bbox ? [r3(c.bbox.x1), r3(c.bbox.y1), r3(c.bbox.x2), r3(c.bbox.y2)] : null });
  });
  comps.sort((a, b) => natural(a.ref, b.ref));
  const idxPorRef = {};
  comps.forEach((c, i) => { idxPorRef[c.ref] = i; });

  /* Agrupa por valor + footprint, e NAO por lado: quem compra quer uma linha por peça, e a
     coluna de lado ja diz onde cada uma cai. Dois componentes iguais em faces diferentes
     sao a mesma compra. */
  const porChave = new Map();
  comps.forEach((c, i) => {
    const k = c.val + '\u0000' + c.fp;
    if (!porChave.has(k)) porChave.set(k, { val:c.val, fp:c.fp, refs:[] });
    porChave.get(k).refs.push(i);
  });
  const groups = [...porChave.values()];
  /* `k` e a identidade ESTAVEL do grupo, e e por ela que o visto da bancada e gravado. Pelo
     indice seria mais curto e estaria errado: regerar o BOM depois de acrescentar um
     componente reordena a lista, e os vistos passariam a apontar para outra peça - sem nada
     na tela dizendo que trocaram de dono. */
  groups.forEach(g => { g.qty = g.refs.length; g.k = g.val + '\u001f' + g.fp; });
  /* ordena pelo primeiro designador do grupo: a lista sai na ordem em que a bancada procura */
  groups.sort((a, b) => natural(comps[a.refs[0]].ref, comps[b.refs[0]].ref));
  groups.forEach((g, gi) => g.refs.forEach(i => { comps[i].g = gi; }));

  /* ── geometria ── */
  const pads = [], silk = [], tracks = [], regions = [], vias = [];

  const comeuPad = (p, dono) => {
    const th = padTH(p);
    const s = th ? -1 : ladoDe(p.layer);       /* -1 = passante: aparece nos dois lados */
    if (s === null) return;
    const g = padGeom(p, th);
    if (!g) return;
    g.s = s; g.th = th ? 1 : 0;
    if (dono != null) g.c = dono;
    if (p.net) g.n = p.net;
    pads.push(g);
    /* o componente ATRAVESSA a placa: os pads dele aparecem na outra face, entao ele tem que
       ser clicavel e realçavel la tambem. Numa placa toda passante (a TCMS_Reader tem 74 dos
       100 pads assim) sem isto o verso mostra os pads e nao responde a nada. */
    if (th && dono != null) comps[dono].t = 1;
  };
  (B.components || []).forEach(c => {
    const i = idxPorRef[c.ref];
    (c.pads || []).forEach(p => comeuPad(p, i == null ? null : i));
  });
  (B.freepads || []).forEach(p => comeuPad(p, null));

  (B.silk || []).forEach(s => {
    const l = ladoDe(s.layer);
    if (l === null) return;
    if (s.kind === 'arc') silk.push({ s:l, k:'a', x:r3(s.cx), y:r3(s.cy), r:r3(s.r),
                                      a:r3(s.sa || 0), b:r3(s.ea == null ? 360 : s.ea), w:r3(s.w || 0.15) });
    else silk.push({ s:l, k:'l', p:[[r3(s.x1), r3(s.y1)], [r3(s.x2), r3(s.y2)]], w:r3(s.w || 0.15) });
  });
  (B.texts || []).forEach(t => {
    const l = ladoDe(t.layer);
    if (l === null) return;
    const w = r3(t.w > 0 ? t.w : (t.h || 1) * 0.13);
    /* o designador vira uma marca a parte: e o que o montador liga e desliga para achar a
       peça sem o resto da serigrafia por cima */
    const d = t.designator ? 1 : 0;
    textoPolys(t).forEach(p => silk.push({ s:l, k:'l', p, w, d }));
  });

  (B.tracks || []).forEach(t => {
    const l = ladoDe(t.layer);
    if (l === null) return;
    tracks.push({ s:l, p:[[r3(t.x1), r3(t.y1)], [r3(t.x2), r3(t.y2)]], w:r3(t.w || 0.2), n:t.net });
  });
  (B.arcs || []).forEach(a => {
    const l = ladoDe(a.layer);
    if (l === null) return;
    tracks.push({ s:l, k:'a', x:r3(a.cx), y:r3(a.cy), r:r3(a.r),
                  a:r3(a.sa || 0), b:r3(a.ea == null ? 360 : a.ea), w:r3(a.w || 0.2), n:a.net });
  });
  (B.regions || []).forEach(g => {
    const l = ladoDe(g.layer);
    if (l === null || !(g.points || []).length) return;
    regions.push({ s:l, p:poly3(g.points), n:g.net });
  });
  (B.vias || []).forEach(v => {
    vias.push({ x:r3(v.x), y:r3(v.y), r:r3((v.size || 0) / 2), d:r3((v.drill || 0) / 2), n:v.net });
  });

  /* contorno da placa: os segmentos soltos viram lacos, igual ao gerador do laser faz -
     placa de canto arredondado tem que fechar */
  const segs = [];
  for (const e of ((B.board && B.board.outline) || [])){
    if (e.kind === 'arc') segs.push(HubLaser.arcPts(e.cx, e.cy, e.r, e.sa, e.ea));
    else segs.push([[e.x1, e.y1], [e.x2, e.y2]]);
  }
  const outline = HubLaser.chainSegments(segs).map(poly3);

  const bb = (B.board && B.board.bbox) || null;
  if (!bb) avisos.push('board.js sem bbox da placa - o enquadramento usa a extensao do desenho');

  const stats = {
    comps: comps.length,
    frente: comps.filter(c => c.s === 0).length,
    verso: comps.filter(c => c.s === 1).length,
    grupos: groups.length,
    pads: pads.length, silk: silk.length, tracks: tracks.length,
  };
  return { bbox: bb ? { x1:r3(bb.x1), y1:r3(bb.y1), x2:r3(bb.x2), y2:r3(bb.y2) } : null,
           outline, pads, silk, tracks, regions, vias, comps, groups, stats,
           warnings: avisos, opts:o };
}

/* ═══════════════ pagina ═══════════════ */

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* JSON dentro de <script>: "</script>" no meio de um valor fecharia a tag e derrubaria a
   pagina, e o U+2028/2029 e quebra de linha para o parser de JS. */
const jsonSeguro = v => JSON.stringify(v)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const CSS = `
:root{--bg:#f6f6f7;--fg:#17171a;--fg2:#5c5c66;--pane:#fff;--linha:#e3e3e8;--hi:#2f6feb;--ok:#1f9d5b}
body.escuro{--bg:#131316;--fg:#eceef2;--fg2:#9a9aa6;--pane:#1b1b20;--linha:#2c2c34;--hi:#5b8dff;--ok:#25d07d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.45 "Segoe UI",Inter,system-ui,sans-serif}
header{padding:10px 14px;border-bottom:1px solid var(--linha);background:var(--pane);
  display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;position:sticky;top:0;z-index:5}
h1{font-size:15px;margin:0;font-weight:600}
.meta{color:var(--fg2);font-size:12px}
.tools{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-left:auto}
button.t{font:inherit;font-size:12px;padding:3px 9px;border:1px solid var(--linha);
  background:var(--pane);color:var(--fg);border-radius:6px;cursor:pointer}
button.t[aria-pressed="true"]{background:var(--hi);border-color:var(--hi);color:#fff}
input[type=search]{font:inherit;font-size:12px;padding:4px 8px;border:1px solid var(--linha);
  border-radius:6px;background:var(--pane);color:var(--fg);width:150px}
/* a lista fica a direita por padrao; main.esq inverte a ORDEM das tres colunas de uma vez
   - inclusive a divisoria, que continua entre as duas sem nenhuma conta a mais */
main{display:flex;height:calc(100vh - 52px);align-items:stretch}
main.esq{flex-direction:row-reverse}
#placas{display:flex;flex:1 1 auto;min-width:0;gap:6px;padding:6px}
#placas.só-bom{display:none}
#hsplit{flex:0 0 6px;cursor:col-resize;position:relative;touch-action:none}
#hsplit.oculta{display:none}
#hsplit::after{content:'';position:absolute;top:0;bottom:0;left:50%;width:2px;
  transform:translateX(-50%);background:transparent;transition:background .12s}
#hsplit:hover::after,#hsplit.on::after{background:var(--hi)}
button.ic{display:inline-flex;align-items:center;padding:4px 7px;line-height:0}
button.ic svg *{fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round}
button.ic svg .f{fill:currentColor;stroke:none;opacity:.8}
button.ic.esq svg{transform:scaleX(-1)}
.face .sv-b,.face.verso .sv-f{display:none}
.face.verso .sv-b{display:inline}
.sep{width:1px;align-self:stretch;background:var(--linha);margin:0 2px}

/* ── gaveta: o que se ajusta uma vez e nao se mexe mais sai da barra e vem para ca ── */
#gaveta{position:fixed;top:0;right:0;bottom:0;width:250px;z-index:20;overflow:auto;
  padding:16px 18px;background:var(--pane);border-left:1px solid var(--linha);
  box-shadow:-10px 0 30px rgba(0,0,0,.18);transform:translateX(100%);
  transition:transform .18s ease}
#gaveta.on{transform:none}
#gavetaBg{position:fixed;inset:0;z-index:19;background:rgba(0,0,0,.28);
  opacity:0;pointer-events:none;transition:opacity .18s}
#gavetaBg.on{opacity:1;pointer-events:auto}
.gv-cab{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.gv-cab h2{font-size:13px;margin:0;font-weight:600}
.gv-tit{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--fg2);
  margin:16px 0 6px}
.gv-item{display:flex;align-items:center;gap:9px;padding:5px 0;cursor:pointer;font-size:13px}
.gv-item input{accent-color:var(--hi);width:15px;height:15px;cursor:pointer}
.gv-nota{margin:4px 0 0;font-size:11.5px;line-height:1.4;color:var(--fg2)}
.gv-seg{display:flex;gap:6px}
.gv-seg button{flex:1}

/* ── modal: a mesma linguagem da pagina, e nao a caixa cinza do navegador ── */
#modalBg{position:fixed;inset:0;z-index:30;background:rgba(0,0,0,.42);
  display:none;align-items:center;justify-content:center;padding:16px}
#modalBg.on{display:flex}
.modal{background:var(--pane);color:var(--fg);border:1px solid var(--linha);border-radius:12px;
  padding:18px 20px 16px;max-width:340px;box-shadow:0 16px 48px rgba(0,0,0,.34)}
.modal h2{font-size:14px;margin:0 0 6px;font-weight:600}
.modal p{margin:0 0 16px;font-size:12.5px;color:var(--fg2)}
.modal .acoes{display:flex;gap:8px;justify-content:flex-end}
.modal .acoes button{padding:5px 14px}
button.t.primario{background:var(--hi);border-color:var(--hi);color:#fff}

/* ── a busca acompanha a lista, colada acima dela ── */
.bom-bar{flex:none;display:flex;gap:6px;align-items:center;padding:8px;
  background:var(--pane);border-bottom:1px solid var(--linha)}
.bom-bar input[type=search]{flex:1;width:auto;min-width:0}
#bomRolo{flex:1;overflow:auto;min-height:0}
.cv{position:relative;flex:1 1 0;min-width:0;background:var(--pane);border:1px solid var(--linha);
  border-radius:8px;overflow:hidden}
.cv.oculta{display:none}
.cv canvas{width:100%;height:100%;display:block;touch-action:none;cursor:crosshair}
.cv .lbl{position:absolute;top:6px;left:8px;font-size:11px;color:var(--fg2);
  background:var(--pane);padding:1px 6px;border-radius:5px;opacity:.9;pointer-events:none}
#bom{flex:0 0 var(--bomw,420px);min-width:200px;background:var(--pane);
  border-left:1px solid var(--linha);display:flex;flex-direction:column;min-height:0}
main.esq #bom{border-left:0;border-right:1px solid var(--linha)}
/* sem desenho na tela a lista deixa de ter largura fixa e toma tudo - senao ela ficaria
   presa nos 420 px com o resto da janela vazio */
#placas.só-bom~#bom{flex:1 1 auto}
table{border-collapse:collapse;width:100%;font-size:12px}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--linha);vertical-align:top}
th{position:sticky;top:0;background:var(--pane);z-index:1;font-weight:600;color:var(--fg2);
  font-size:11px;text-transform:uppercase;letter-spacing:.04em}
tbody tr{cursor:pointer}
tbody tr:hover{background:color-mix(in srgb,var(--hi) 10%,transparent)}
tbody tr[aria-selected="true"]{background:color-mix(in srgb,var(--hi) 20%,transparent)}
tbody tr.feito td:not(.cx){opacity:.45;text-decoration:line-through}
td.q,td.n{text-align:right;font-variant-numeric:tabular-nums;color:var(--fg2)}
td.refs{font-family:ui-monospace,Consolas,monospace;font-size:11px;word-break:break-word}
td.cx{width:26px;text-align:center}
.lado{display:inline-block;font-size:10px;padding:0 5px;border-radius:4px;border:1px solid var(--linha);
  color:var(--fg2);margin-left:5px}
#vazio{padding:20px;color:var(--fg2)}
`;

/* Runtime da pagina. Recebe D (o modelo) e nao depende de mais nada - nem de fonte, nem de
   forma de pad: tudo ja chegou achatado. */
const JS = `
/* realce e uma LISTA de indices de componente, e nao um indice de grupo: e o que deixa a
   mesma funcao de desenho servir para a linha agrupada (varias peças), para a linha por peça
   (uma so) e para o clique no desenho. selKey e so quem esta com a linha marcada. */
var cams = [null, null], realce = [], selKey = '', netSel = '';
var modo = 'grupo', filtro = '', feitos = {}, guiada = !!D.guiada, layoutAtual = D.layout;
/* a ultima face escolhida: e para onde o icone volta quando se esta em "as duas" ou "so a
   lista", em vez de assumir a frente sempre */
var faceAtual = D.layout === 'b' ? 'b' : 'f';
/* o estado inicial vem das opcoes da aba (D.ver), e nao de um literal aqui: era assim que
   marcar "trilhas" na aba gerava uma pagina que abria sem trilha nenhuma */
var mostra = D.ver;
var CHAVE = 'altiumbom.' + D.proj;
/* lado e largura da lista: preferencia de quem esta montando, e por isso mora no navegador
   dele. largura 0 = ainda nao escolheu, e o primeiro desenho tira do tamanho da janela. */
var lado = 'dir', largLista = 0;

try { feitos = JSON.parse(localStorage.getItem(CHAVE) || '{}') || {}; } catch (e) { feitos = {}; }
function salvaFeitos(){ try { localStorage.setItem(CHAVE, JSON.stringify(feitos)); } catch (e) {} }
try {
  var ui = JSON.parse(localStorage.getItem(CHAVE + '.ui') || 'null');
  if (ui && typeof ui === 'object'){
    lado = ui.lado === 'esq' ? 'esq' : 'dir';
    largLista = (typeof ui.w === 'number' && ui.w > 0) ? ui.w : 0;
    if (typeof ui.guiada === 'boolean') guiada = ui.guiada;
  }
} catch (e) {}
function salvaUI(){
  try {
    localStorage.setItem(CHAVE + '.ui',
      JSON.stringify({ lado:lado, w:largLista, guiada:guiada }));
  } catch (e) {}
}

/* teto e piso da lista: nem ela nem o desenho podem sumir por arrasto */
function limitaLarg(w){
  var total = document.querySelector('main').getBoundingClientRect().width || 900;
  return Math.max(200, Math.min(w, Math.max(200, total - 240 - 6)));
}
function aplicaLateral(){
  var mn = document.querySelector('main');
  mn.classList.toggle('esq', lado === 'esq');
  document.getElementById('ladoLista').classList.toggle('esq', lado === 'esq');
  if (!largLista) largLista = limitaLarg(Math.round((mn.getBoundingClientRect().width || 900) * 0.42));
  mn.style.setProperty('--bomw', limitaLarg(largLista) + 'px');
}
/* a area do desenho mudou de tamanho: o canvas precisa de novo tamanho de buffer, mas o
   zoom de quem esta olhando NAO pode ser refeito - so o redim, nunca o ajusta */
var rafLat = 0;
function relayout(){
  if (rafLat) return;
  rafLat = requestAnimationFrame(function (){ rafLat = 0; redim(); pinta(); });
}

function bbox(){
  if (D.bbox) return D.bbox;
  var b = null;
  var eat = function (x, y){
    if (!b) b = { x1:x, y1:y, x2:x, y2:y };
    else { b.x1 = Math.min(b.x1, x); b.y1 = Math.min(b.y1, y);
           b.x2 = Math.max(b.x2, x); b.y2 = Math.max(b.y2, y); }
  };
  D.outline.forEach(function (p){ p.forEach(function (q){ eat(q[0], q[1]); }); });
  D.comps.forEach(function (c){ if (c.bb){ eat(c.bb[0], c.bb[1]); eat(c.bb[2], c.bb[3]); } });
  return b || { x1:0, y1:0, x2:10, y2:10 };
}

/* uma camera por lado. O verso espelha X: e a placa virada na mao, nao vista atraves. */
function novaCam(cv, lado){
  var c = { cv:cv, ctx:cv.getContext('2d'), lado:lado, cx:0, cy:0, esc:1, dpr:1 };
  c.mundo = function (sx, sy){
    var W = cv.width / c.dpr, H = cv.height / c.dpr;
    var mx = (sx - W/2) / c.esc, my = (H/2 - sy) / c.esc;
    return { x: c.cx + (lado ? -mx : mx), y: c.cy + my };
  };
  return c;
}
function ajusta(c){
  var b = bbox(), m = 2;
  var W = c.cv.clientWidth || 1, H = c.cv.clientHeight || 1;
  var w = (b.x2 - b.x1) + m*2, h = (b.y2 - b.y1) + m*2;
  c.esc = Math.min(W / w, H / h) || 1;
  c.cx = (b.x1 + b.x2) / 2; c.cy = (b.y1 + b.y2) / 2;
}
function redim(){
  cams.forEach(function (c){
    if (!c) return;
    var dpr = window.devicePixelRatio || 1;
    c.dpr = dpr;
    c.cv.width = Math.max(1, Math.round(c.cv.clientWidth * dpr));
    c.cv.height = Math.max(1, Math.round(c.cv.clientHeight * dpr));
  });
}

function traco(ctx, pts){
  ctx.beginPath();
  for (var i = 0; i < pts.length; i++){
    if (i) ctx.lineTo(pts[i][0], pts[i][1]); else ctx.moveTo(pts[i][0], pts[i][1]);
  }
}
/* ponto dentro de QUALQUER um dos poligonos do pad (o pad e a uniao deles) */
function dentro(polys, x, y){
  for (var k = 0; k < polys.length; k++){
    var p = polys[k], d = false;
    for (var i = 0, j = p.length - 1; i < p.length; j = i++){
      if ((p[i][1] > y) !== (p[j][1] > y) &&
          x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) d = !d;
    }
    if (d) return true;
  }
  return false;
}

function preenche(ctx, pts, cor){
  traco(ctx, pts); ctx.closePath(); ctx.fillStyle = cor; ctx.fill();
}
/* pad = varios poligonos sobrepostos; pintados um a um na mesma cor, o que aparece e a
   uniao deles - que e a forma de verdade */
function preencheTodos(ctx, polys, cor){
  ctx.fillStyle = cor;
  for (var i = 0; i < polys.length; i++){ traco(ctx, polys[i]); ctx.closePath(); ctx.fill(); }
}

function desenha(c){
  /* canvas dentro de um pai display:none tem largura zero - desenhar nele e trabalho jogado
     fora, e com a visao guiada mostrando uma face por vez isso vale metade do desenho */
  if (!c || !c.cv.clientWidth) return;
  var ctx = c.ctx, W = c.cv.width, H = c.cv.height, L = c.lado, P = D.cores[L];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W/2, H/2);
  /* Y para baixo no canvas contra Y para cima da placa; o verso ainda inverte X */
  ctx.scale((L ? -1 : 1) * c.esc * c.dpr, -c.esc * c.dpr);
  ctx.translate(-c.cx, -c.cy);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  if (mostra.regions) D.regions.forEach(function (g){
    if (g.s !== L) return; preenche(ctx, g.p, P.regiao);
  });
  if (mostra.tracks) D.tracks.forEach(function (t){
    if (t.s !== L) return;
    ctx.strokeStyle = P.trilha; ctx.lineWidth = t.w;
    ctx.beginPath();
    if (t.k === 'a') ctx.arc(t.x, t.y, t.r, t.a*Math.PI/180, t.b*Math.PI/180);
    else { ctx.moveTo(t.p[0][0], t.p[0][1]); ctx.lineTo(t.p[1][0], t.p[1][1]); }
    ctx.stroke();
  });

  D.outline.forEach(function (p){
    traco(ctx, p);
    ctx.strokeStyle = D.cores.borda; ctx.lineWidth = Math.max(0.12, 1/c.esc); ctx.stroke();
  });

  if (mostra.pads){
    D.pads.forEach(function (p){
      if (p.s !== -1 && p.s !== L) return;
      preencheTodos(ctx, p.p, p.th ? D.cores.th : P.pad);
    });
    if (mostra.drills) D.pads.forEach(function (p){
      if (p.h && (p.s === -1 || p.s === L)) preencheTodos(ctx, p.h, D.cores.furo);
    });
    D.vias.forEach(function (v){
      ctx.beginPath(); ctx.arc(v.x, v.y, v.r, 0, 6.2832);
      ctx.fillStyle = D.cores.th; ctx.fill();
      if (mostra.drills && v.d > 0){
        ctx.beginPath(); ctx.arc(v.x, v.y, v.d, 0, 6.2832);
        ctx.fillStyle = D.cores.furo; ctx.fill();
      }
    });
  }

  if (mostra.silk) D.silk.forEach(function (s){
    if (s.s !== L) return;
    if (s.d && !mostra.refs) return;
    ctx.strokeStyle = P.silk; ctx.lineWidth = s.w;
    ctx.beginPath();
    if (s.k === 'a') ctx.arc(s.x, s.y, s.r, s.a*Math.PI/180, s.b*Math.PI/180);
    else { for (var i = 0; i < s.p.length; i++){
      if (i) ctx.lineTo(s.p[i][0], s.p[i][1]); else ctx.moveTo(s.p[i][0], s.p[i][1]); } }
    ctx.stroke();
  });

  /* a net acesa vem antes do realce de peça: e contexto (por onde o sinal anda), enquanto o
     realce e o alvo. Acende o cobre inteiro daquela net, inclusive o que esta sob a peça. */
  if (netSel){
    ctx.strokeStyle = D.cores.net; ctx.fillStyle = D.cores.net;
    D.tracks.forEach(function (t){
      if (t.s !== L || t.n !== netSel) return;
      ctx.lineWidth = t.w;
      ctx.beginPath();
      if (t.k === 'a') ctx.arc(t.x, t.y, t.r, t.a*Math.PI/180, t.b*Math.PI/180);
      else { ctx.moveTo(t.p[0][0], t.p[0][1]); ctx.lineTo(t.p[1][0], t.p[1][1]); }
      ctx.stroke();
    });
    D.regions.forEach(function (g){ if (g.s === L && g.n === netSel) preenche(ctx, g.p, D.cores.net); });
    D.pads.forEach(function (p){
      if (p.n === netSel && (p.s === -1 || p.s === L)) preencheTodos(ctx, p.p, D.cores.net);
    });
    D.vias.forEach(function (v){
      if (v.n !== netSel) return;
      ctx.beginPath(); ctx.arc(v.x, v.y, v.r, 0, 6.2832); ctx.fillStyle = D.cores.net; ctx.fill();
    });
  }

  /* o realce por ultimo, por cima de tudo: e o que a pessoa esta procurando */
  if (realce.length){
    ctx.lineWidth = Math.max(0.18, 2/c.esc);
    realce.forEach(function (i){
      var cp = D.comps[i];
      if (!cp || !cp.bb || (cp.s !== L && !cp.t)) return;   /* passante aparece nas duas faces */
      ctx.fillStyle = D.cores.alvo; ctx.globalAlpha = 0.35;
      ctx.fillRect(cp.bb[0], cp.bb[1], cp.bb[2]-cp.bb[0], cp.bb[3]-cp.bb[1]);
      ctx.globalAlpha = 1; ctx.strokeStyle = D.cores.alvo;
      ctx.strokeRect(cp.bb[0], cp.bb[1], cp.bb[2]-cp.bb[0], cp.bb[3]-cp.bb[1]);
    });
  }
  ctx.restore();
}
function pinta(){ cams.forEach(desenha); }

/* ── BOM ──
   Duas vistas sobre os MESMOS dados: agrupada (uma linha por compra) e por peça (uma linha
   por designador, que e como se confere a placa peça a peça). A linha, nas duas, e descrita
   pelo mesmo objeto - chave estavel, o que realçar, e o que casa com o filtro. */
function linhas(){
  var q = filtro.trim().toLowerCase();
  var out = [];
  if (modo === 'grupo'){
    D.groups.forEach(function (g, gi){
      out.push({ k:'g' + g.k, qtd:g.qty, val:g.val, fp:g.fp, realce:g.refs,
                 refs:g.refs.map(function (i){ return D.comps[i].ref; }),
                 lados:g.refs.map(function (i){ return D.comps[i].s; }) });
    });
  } else {
    D.comps.forEach(function (c, i){
      out.push({ k:'c' + c.ref, qtd:1, val:c.val, fp:c.fp, realce:[i], refs:[c.ref], lados:[c.s] });
    });
  }
  if (!q) return out;
  return out.filter(function (r){
    return (r.val + ' ' + r.fp + ' ' + r.refs.join(' ')).toLowerCase().indexOf(q) >= 0;
  });
}
function montaBom(){
  var tb = document.getElementById('linhas');
  tb.textContent = '';
  var vis = linhas(), n = 0;
  vis.forEach(function (r){
    var tr = document.createElement('tr');
    tr.dataset.k = r.k;
    tr.setAttribute('aria-selected', String(r.k === selKey));
    if (feitos[r.k]) tr.className = 'feito';
    var td = function (cls, txt){ var e = document.createElement('td'); if (cls) e.className = cls;
                                  e.textContent = txt; tr.appendChild(e); return e; };
    var cx = td('cx', '');
    var box = document.createElement('input');
    box.type = 'checkbox'; box.checked = !!feitos[r.k];
    box.onclick = function (ev){
      ev.stopPropagation();
      if (box.checked) feitos[r.k] = 1; else delete feitos[r.k];
      salvaFeitos(); tr.className = box.checked ? 'feito' : ''; contas();
    };
    cx.appendChild(box);
    td('n', String(++n));
    td('q', String(r.qtd));
    td('v', r.val || '—');
    td('f', r.fp || '—');
    var refs = td('refs', r.refs.join(', '));
    var lados = {};
    r.lados.forEach(function (s){ lados[s] = 1; });
    Object.keys(lados).sort().forEach(function (s){
      var b = document.createElement('span'); b.className = 'lado';
      b.textContent = D.lados[s]; refs.appendChild(b);
    });
    tr.onclick = function (){
      if (r.k === selKey) escolhe('', [], false); else escolhe(r.k, r.realce, false, true);
    };
    tb.appendChild(tr);
  });
  document.getElementById('vazio').style.display = vis.length ? 'none' : '';
  contas();
}
/* Onde a camera de um lado teria que estar para mostrar as peças pedidas. DEVOLVE o alvo em
   vez de aplica-lo: entre o de agora e este e que a transicao acontece. Mesma folga do
   zoomToObj da vista PCB (a peça ocupa ~1/1,6 da tela), para quem usa as duas telas ver a
   mesma coisa. */
function alvoDoLado(c, lista){
  var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, achou = false;
  lista.forEach(function (i){
    var cp = D.comps[i];
    if (!cp || !cp.bb || (cp.s !== c.lado && !cp.t)) return;
    achou = true;
    x1 = Math.min(x1, cp.bb[0]); y1 = Math.min(y1, cp.bb[1]);
    x2 = Math.max(x2, cp.bb[2]); y2 = Math.max(y2, cp.bb[3]);
  });
  if (!achou) return null;
  var W = c.cv.clientWidth || 1, H = c.cv.clientHeight || 1;
  var r = Math.max(x2 - x1, y2 - y1) * 1.6 + 2;
  return { cx:(x1 + x2) / 2, cy:(y1 + y2) / 2, esc: Math.min(W, H) / Math.max(r, 0.5) };
}
function poeCam(c, a){ c.cx = a.cx; c.cy = a.cy; c.esc = a.esc; }

/* ── a transicao ──
   Curva de Van Wijk & Nuij (2003), a mesma do d3.interpolateZoom. Interpolar centro e zoom
   em linha reta passaria o mundo inteiro voando de lado na tela; esta curva AFASTA a camera
   na medida da distancia a percorrer - pulo curto quase nao tira o zoom, pulo longo abre a
   placa antes de descer no destino. E o que deixa o olho seguir o caminho de D1 ate D2 em
   vez de perder a referencia num corte seco.

   w e o tamanho do campo de visao em mm (min(largura,altura) da tela dividido pela escala);
   e nele que a curva trabalha, e nao na escala. */
var RHO = 1.4142135623730951, RHO2 = 2, RHO4 = 4;
function caminho(x0, y0, w0, x1, y1, w1){
  var dx = x1 - x0, dy = y1 - y0, d2 = dx*dx + dy*dy, S, em;
  if (d2 < 1e-12){
    /* mesmo ponto: so o zoom muda, e ele anda em passo geometrico */
    S = Math.abs(Math.log(w1 / w0)) / RHO;
    em = function (t){ return [x0, y0, w0 * Math.pow(w1 / w0, t)]; };
  } else {
    var d1 = Math.sqrt(d2),
        b0 = (w1*w1 - w0*w0 + RHO4*d2) / (2*w0*RHO2*d1),
        b1 = (w1*w1 - w0*w0 - RHO4*d2) / (2*w1*RHO2*d1),
        r0 = Math.log(Math.sqrt(b0*b0 + 1) - b0),
        r1 = Math.log(Math.sqrt(b1*b1 + 1) - b1);
    S = (r1 - r0) / RHO;
    em = function (t){
      var s = t * S, ch0 = Math.cosh(r0);
      var u = w0 / (RHO2 * d1) * (ch0 * Math.tanh(RHO*s + r0) - Math.sinh(r0));
      return [x0 + u*dx, y0 + u*dy, w0 * ch0 / Math.cosh(RHO*s + r0)];
    };
  }
  return { em: em, dur: Math.abs(S) * 420 };
}

/* Quem pediu para nao animar, nao anima: a preferencia do sistema vale mais que o efeito. */
function semAnimacao(){
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (e) { return false; }
}

var anim = null;   /* o laço compara com este objeto: uma escolha nova assume o comando */
function animaAte(pares){
  var partes = [], dur = 0, ok = true;
  pares.forEach(function (p){
    var c = p.c, V = Math.min(c.cv.clientWidth || 1, c.cv.clientHeight || 1);
    var w0 = V / c.esc, w1 = V / p.alvo.esc;
    if (!(w0 > 0) || !(w1 > 0)){ ok = false; return; }
    var cam = caminho(c.cx, c.cy, w0, p.alvo.cx, p.alvo.cy, w1);
    dur = Math.max(dur, cam.dur);
    partes.push({ c:c, V:V, cam:cam });
  });
  var poe = function (t){
    partes.forEach(function (p){
      var v = p.cam.em(t);
      p.c.cx = v[0]; p.c.cy = v[1]; p.c.esc = p.V / v[2];
    });
    pinta();
  };
  if (!ok || !partes.length || semAnimacao()){
    pares.forEach(function (p){ poeCam(p.c, p.alvo); });
    anim = null; pinta(); return;
  }
  dur = Math.min(700, Math.max(180, dur));
  var meu = anim = {}, t0 = null;
  requestAnimationFrame(function passo(ts){
    if (meu !== anim) return;                    /* outra escolha assumiu o comando */
    /* sem relogio de quadro (host que nao passa o timestamp) a transicao acaba no primeiro
       passo, em vez de girar sem avançar */
    if (typeof ts !== 'number'){ poe(1); anim = null; return; }
    if (t0 === null) t0 = ts;
    var t = Math.min(1, (ts - t0) / dur);
    poe(t);
    if (t < 1) requestAnimationFrame(passo); else anim = null;
  });
}
/* Leva a camera ate as peças, e leva a TELA junto: peça do verso poe a vista no verso, peça
   da frente poe na frente. E o lado de MONTAGEM que manda, mesmo num passante que aparece nos
   dois - e daquele lado que ela vai ser soldada. So quando a escolha mistura as duas faces e
   que as duas ficam na tela, porque ai nao ha uma face certa.

   O enquadramento espera um quadro: o aplicaLayout re-ajusta as cameras no proximo frame, e
   faria o zoom voltar para a placa inteira se fizessemos agora. */
function enquadra(lista){
  if (!guiada || !lista || !lista.length) return;
  var faces = {};
  lista.forEach(function (i){ var c = D.comps[i]; if (c) faces[c.s] = 1; });
  var quais = Object.keys(faces);
  if (quais.length === 1) aplicaLayout(quais[0] === '0' ? 'f' : 'b');
  else if (quais.length > 1 && layoutAtual !== 'lr') aplicaLayout('lr');
  requestAnimationFrame(function (){
    var pares = [];
    cams.forEach(function (c){
      if (!c) return;
      var alvo = alvoDoLado(c, lista);
      if (!alvo) return;
      /* camera escondida nao tem de onde sair: entra ja no lugar, e a transicao seria um
         desenho que ninguem ve */
      if (!c.cv.clientWidth) poeCam(c, alvo); else pares.push({ c:c, alvo:alvo });
    });
    if (pares.length) animaAte(pares); else pinta();
  });
}

/* mover diz se a camera acompanha - so quem escolhe PELA LISTA move a placa. Clicar no
   proprio desenho ja esta olhando para o lugar certo, e dar zoom ali seria arrancar a vista
   da mao de quem clicou. foco mira num alvo mais estreito que o realce (o designador
   exato que se digitou, dentro de um grupo inteiro aceso). */
function escolhe(k, refs, rolar, mover, foco){
  /* qualquer escolha explicita desarma o tiro pendente do filtro. Sem isto, digitar "R" e
     clicar numa peça dentro dos 350 ms fazia o timer atropelar a escolha um terço de segundo
     depois - e ainda mover a camera, quebrando a promessa de que clicar no desenho nao mexe
     na vista. */
  paraFiltro();
  selKey = k; realce = refs || [];
  var tb = document.getElementById('linhas');
  [].forEach.call(tb.children, function (tr){
    var eh = tr.dataset.k === k;
    tr.setAttribute('aria-selected', String(eh));
    if (eh && rolar) tr.scrollIntoView({ block:'nearest' });
  });
  if (mover) enquadra((foco && foco.length) ? foco : realce);
  pinta();
}
/* seleciona a linha que contem este componente, na vista que estiver aberta */
function escolheComp(i, mover){
  if (i < 0) return escolhe('', [], false);
  var c = D.comps[i];
  if (modo === 'grupo'){
    var g = D.groups[c.g];
    escolhe('g' + g.k, g.refs, true, mover, [i]);
  } else {
    escolhe('c' + c.ref, [i], true, mover);
  }
}

/* o tiro pendente do filtro vive fora do inicia() para que qualquer escolha o desarme */
var fTimer = 0;
function paraFiltro(){ if (fTimer) { clearTimeout(fTimer); fTimer = 0; } }

/* O filtro tambem guia: digitar um designador leva ate ele. O designador EXATO ganha do
   primeiro da lista - quem escreve "D1" quer o D1, e nao o grupo em que ele caiu. */
function focoDoFiltro(){
  if (!guiada) return;
  var q = filtro.trim().toLowerCase();
  if (!q) return;
  for (var i = 0; i < D.comps.length; i++){
    if (D.comps[i].ref.toLowerCase() === q) return escolheComp(i, true);
  }
  var vis = linhas();
  if (vis.length) escolhe(vis[0].k, vis[0].realce, true, true);
}
function contas(){
  /* conta o que esta marcado NA VISTA ABERTA: as duas granularidades convivem no mesmo
     mapa, e somar as duas contaria a mesma peça duas vezes */
  var f = 0;
  if (modo === 'grupo') D.groups.forEach(function (g){ if (feitos['g' + g.k]) f += g.qty; });
  else D.comps.forEach(function (c){ if (feitos['c' + c.ref]) f++; });
  document.getElementById('contas').textContent =
    D.stats.comps + ' comps · ' + D.stats.grupos + ' grupos · ' +
    D.stats.frente + ' frente / ' + D.stats.verso + ' verso · ' + f + ' montados'
    + (netSel ? ' · net ' + netSel : '');
}

/* Modal proprio, no tema da pagina: o confirm() do navegador chega em ingles, com a cara do
   sistema e sem dizer de que placa se trata - no meio de uma bancada isso e ruido. */
function fechaModal(){
  var bg = document.getElementById('modalBg');
  bg.classList.remove('on');
  document.getElementById('modalSim').onclick = null;
  document.getElementById('modalNao').onclick = null;
}
function pergunta(titulo, texto, aoSim){
  var bg = document.getElementById('modalBg');
  document.getElementById('modalTit').textContent = titulo;
  document.getElementById('modalTxt').textContent = texto;
  bg.classList.add('on');
  document.getElementById('modalSim').onclick = function (){ fechaModal(); aoSim(); };
  document.getElementById('modalNao').onclick = fechaModal;
  bg.onclick = function (ev){ if (ev.target === bg) fechaModal(); };
}

/* clique no desenho: o PAD sob o cursor acende a net (e e por onde se segue um sinal na
   bancada); fora de pad, o componente sob o cursor - o menor bbox que contem o ponto, para
   peça pequena dentro de peça grande nao ficar inalcançavel. */
function achaNoPonto(c, ev){
  var r = c.cv.getBoundingClientRect();
  var m = c.mundo(ev.clientX - r.left, ev.clientY - r.top);
  var pad = null;
  if (mostra.pads){
    for (var k = 0; k < D.pads.length; k++){
      var p = D.pads[k];
      if (p.s !== -1 && p.s !== c.lado) continue;
      if (dentro(p.p, m.x, m.y)){ pad = p; break; }
    }
  }
  var achou = -1, area = Infinity;
  D.comps.forEach(function (cp, i){
    if (!cp.bb || (cp.s !== c.lado && !cp.t)) return;
    if (m.x < cp.bb[0] || m.x > cp.bb[2] || m.y < cp.bb[1] || m.y > cp.bb[3]) return;
    var a = (cp.bb[2]-cp.bb[0]) * (cp.bb[3]-cp.bb[1]);
    if (a < area){ area = a; achou = i; }
  });
  /* o pad manda no componente: clicando num pad de conector, quem interessa e o dono dele */
  if (pad && pad.c != null) achou = pad.c;
  return { comp: achou, net: pad ? (pad.n || '') : '' };
}

function liga(c){
  /* px/py andam com o ponteiro (e o passo do pan); ox/oy ficam onde o botao DESCEU. Medir o
     arrasto por px/py compararia com o ultimo move, que esta sempre a 1 px de distancia -
     todo pan terminaria como clique e trocaria a peça selecionada no fim do arrasto. */
  var arr = false, px = 0, py = 0, ox = 0, oy = 0;
  c.cv.addEventListener('pointerdown', function (ev){
    anim = null;                 /* a mao manda: quem pegou a placa interrompe a viagem */
    arr = true; px = ox = ev.clientX; py = oy = ev.clientY;
    c.cv.setPointerCapture(ev.pointerId);
  });
  c.cv.addEventListener('pointermove', function (ev){
    if (!arr || !(ev.buttons & 1)) return;
    var dx = (ev.clientX - px) / c.esc, dy = (ev.clientY - py) / c.esc;
    c.cx -= c.lado ? -dx : dx; c.cy += dy;
    px = ev.clientX; py = ev.clientY;
    desenha(c);
  });
  c.cv.addEventListener('pointerup', function (ev){
    arr = false;
    if (Math.abs(ev.clientX - ox) > 3 || Math.abs(ev.clientY - oy) > 3) return;
    var hit = achaNoPonto(c, ev);
    netSel = hit.net;
    escolheComp(hit.comp, false);   /* clicou no desenho: ja esta olhando para o lugar certo */
    contas();
  });
  c.cv.addEventListener('wheel', function (ev){
    ev.preventDefault();
    anim = null;
    var r = c.cv.getBoundingClientRect();
    var antes = c.mundo(ev.clientX - r.left, ev.clientY - r.top);
    /* deltaMode: 0 = pixel (Chrome), 1 = linha (Firefox, ~3 por entalhe), 2 = pagina.
       Sem converter, um entalhe no Firefox daria 0,5% de zoom em vez de 15%. */
    var dy = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1);
    c.esc *= Math.exp(-dy * 0.0016);
    var dep = c.mundo(ev.clientX - r.left, ev.clientY - r.top);
    c.cx += antes.x - dep.x; c.cy += antes.y - dep.y;
    desenha(c);
  }, { passive:false });
}

function aplicaLayout(l){
  layoutAtual = l;
  if (l === 'f' || l === 'b') faceAtual = l;
  document.getElementById('placas').classList.toggle('só-bom', l === 'bom');
  /* sem desenho nao ha o que dividir - e uma divisoria solta na borda so confunde */
  document.getElementById('hsplit').classList.toggle('oculta', l === 'bom');
  document.getElementById('cv0').parentNode.classList.toggle('oculta', l === 'b');
  document.getElementById('cv1').parentNode.classList.toggle('oculta', l === 'f');
  [].forEach.call(document.querySelectorAll('[data-layout]'), function (b){
    b.setAttribute('aria-pressed', String(b.dataset.layout === l));
  });
  /* o icone mostra a face que ESTA na tela; fora de uma face, a que ele traria. O title diz
     o que o clique faz, que e o que a pessoa quer saber antes de clicar. */
  var bf = document.getElementById('btFace');
  var naFace = l === 'f' || l === 'b';
  var mostrando = naFace ? l : faceAtual;
  var proxima = l === 'f' ? 'b' : l === 'b' ? 'f' : faceAtual;
  bf.classList.toggle('verso', mostrando === 'b');
  bf.setAttribute('aria-pressed', String(naFace));
  bf.title = 'mostrar s\u00f3 ' + (proxima === 'f' ? 'a frente' : 'o verso');
  requestAnimationFrame(function (){ redim(); cams.forEach(function (c){ if (c) ajusta(c); }); pinta(); });
}

function inicia(){
  cams[0] = novaCam(document.getElementById('cv0'), 0);
  cams[1] = novaCam(document.getElementById('cv1'), 1);
  cams.forEach(liga);
  /* a mesma opcao aparece como botao na barra e como caixa na gaveta - o estado e um so, e
     quem le/escreve muda conforme o elemento */
  [].forEach.call(document.querySelectorAll('[data-ver]'), function (b){
    var k = b.dataset.ver, caixa = b.type === 'checkbox';
    if (caixa) b.checked = !!mostra[k];
    else b.setAttribute('aria-pressed', String(!!mostra[k]));
    b.onclick = function (){
      mostra[k] = caixa ? (b.checked ? 1 : 0) : (mostra[k] ? 0 : 1);
      if (!caixa) b.setAttribute('aria-pressed', String(!!mostra[k]));
      pinta();
    };
  });
  var gv = document.getElementById('gaveta'), gvBg = document.getElementById('gavetaBg');
  var abreGaveta = function (v){ gv.classList.toggle('on', v); gvBg.classList.toggle('on', v); };
  document.getElementById('btGaveta').onclick = function (){ abreGaveta(!gv.classList.contains('on')); };
  document.getElementById('gavetaFecha').onclick = function (){ abreGaveta(false); };
  gvBg.onclick = function (){ abreGaveta(false); };
  document.addEventListener('keydown', function (ev){
    if (ev.key !== 'Escape') return;
    if (document.getElementById('modalBg').classList.contains('on')) fechaModal();
    else abreGaveta(false);
  });
  [].forEach.call(document.querySelectorAll('[data-layout]'), function (b){
    b.onclick = function (){ aplicaLayout(b.dataset.layout); };
  });
  document.getElementById('btFace').onclick = function (){
    aplicaLayout(layoutAtual === 'f' ? 'b' : layoutAtual === 'b' ? 'f' : faceAtual);
  };
  [].forEach.call(document.querySelectorAll('[data-modo]'), function (b){
    b.setAttribute('aria-pressed', String(b.dataset.modo === modo));
    b.onclick = function (){
      modo = b.dataset.modo;
      [].forEach.call(document.querySelectorAll('[data-modo]'), function (o){
        o.setAttribute('aria-pressed', String(o.dataset.modo === modo));
      });
      /* a linha selecionada nao existe na outra vista: quem continua valendo e o REALCE */
      selKey = '';
      montaBom();
    };
  });
  var sp = document.getElementById('hsplit');
  sp.addEventListener('pointerdown', function (e){
    var x0 = e.clientX, w0 = limitaLarg(largLista);
    sp.classList.add('on');
    sp.setPointerCapture(e.pointerId);
    function mv(ev){
      /* com a lista na esquerda, arrastar para a direita AUMENTA a lista; na direita, o
         contrario - e o mesmo gesto nos dois casos, que e o que a mao espera */
      largLista = limitaLarg(w0 + (ev.clientX - x0) * (lado === 'esq' ? 1 : -1));
      document.querySelector('main').style.setProperty('--bomw', largLista + 'px');
      relayout();
    }
    function up(){
      sp.classList.remove('on');
      sp.removeEventListener('pointermove', mv);
      sp.removeEventListener('pointerup', up);
      sp.removeEventListener('pointercancel', up);
      salvaUI();
    }
    sp.addEventListener('pointermove', mv);
    sp.addEventListener('pointerup', up);
    sp.addEventListener('pointercancel', up);
    e.preventDefault();
  });
  document.getElementById('ladoLista').onclick = function (){
    lado = lado === 'dir' ? 'esq' : 'dir';
    aplicaLateral(); salvaUI(); relayout();
  };
  var fCampo = document.getElementById('filtro');
  fCampo.oninput = function (e){
    filtro = e.target.value; montaBom();
    /* espera a digitacao parar: mirar a cada tecla faria a placa pular de "D" para "D1" */
    paraFiltro();
    fTimer = setTimeout(function (){ fTimer = 0; focoDoFiltro(); }, 350);
  };
  fCampo.onkeydown = function (ev){
    if (ev.key !== 'Enter') return;
    paraFiltro();
    focoDoFiltro();
  };
  /* a caixa tem que mostrar o estado RESTAURADO, e nao o que estava no HTML: gerada
     desligada e ligada na bancada, ela reabria desmarcada com a guiada ligada - e o primeiro
     clique so remarcava a caixa, sem desligar nada */
  document.getElementById('cbGuiada').checked = guiada;
  document.getElementById('cbGuiada').onclick = function (){
    guiada = !!document.getElementById('cbGuiada').checked;
    salvaUI();
    if (guiada) enquadra(realce);   /* liga e ja mostra onde esta o que estava selecionado */
  };
  var cbEscuro = document.getElementById('escuro');
  cbEscuro.onclick = function (){ document.body.classList.toggle('escuro', !!cbEscuro.checked); };
  document.getElementById('limpar').onclick = function (){
    pergunta('Limpar vistos', 'Isso desmarca tudo que j\u00e1 foi montado nesta placa. Continuar?',
             function (){ feitos = {}; salvaFeitos(); montaBom(); });
  };
  window.addEventListener('resize', function (){
    aplicaLateral();
    redim(); cams.forEach(function (c){ if (c) ajusta(c); }); pinta();
  });
  montaBom();
  aplicaLateral();
  aplicaLayout(D.layout);
}
document.addEventListener('DOMContentLoaded', inicia);
`;

/* Monta a pagina inteira. Tudo inline de proposito: o arquivo tem que abrir de qualquer
   pasta, sem os .js do espelho e sem internet. */
function html(m, meta){
  const o = norm(m && m.opts);
  const me = meta || {};
  const D = {
    proj: me.proj || 'placa',
    lados: LADO, cores: COR,
    layout: o.layout,
    guiada: o.guided ? 1 : 0,
    /* o estado em que a pagina abre - o runtime le daqui, nao de um literal */
    ver: { pads: o.pads ? 1 : 0, silk: o.silk ? 1 : 0, refs: o.refs ? 1 : 0,
           tracks: o.tracks ? 1 : 0, regions: o.regions ? 1 : 0, drills: o.drills ? 1 : 0 },
    bbox: m.bbox, outline: m.outline, pads: m.pads, silk: m.silk, tracks: m.tracks,
    regions: m.regions, vias: m.vias, comps: m.comps, groups: m.groups, stats: m.stats,
  };
  const botao = (attr, val, rot, on) =>
    '<button class="t" ' + attr + '="' + val + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + rot + '</button>';
  const icone = (attr, val, tit, svg, on) =>
    '<button class="t ic" ' + attr + '="' + val + '" title="' + esc(tit) + '" aria-pressed="' +
    (on ? 'true' : 'false') + '">' + svg + '</button>';
  /* na gaveta a opcao vira caixa de marcar de verdade: e o gesto de uma lista de ajustes,
     nao o de uma barra de ferramentas */
  const check = (val, rot, on) =>
    '<label class="gv-item"><input type="checkbox" data-ver="' + val + '"' +
    (on ? ' checked' : '') + '>' + rot + '</label>';

  const L = [];
  L.push('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">');
  L.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  L.push('<title>BOM — ' + esc(D.proj) + '</title>');
  L.push('<style>' + CSS + '</style></head>');
  L.push('<body' + (o.dark ? ' class="escuro"' : '') + '>');
  L.push('<header>');
  L.push('<div><h1>' + esc(D.proj) + '</h1><div class="meta" id="contas"></div></div>');
  L.push('<div class="meta">' + esc(me.generated || '') +
         (o.empresa ? ' · ' + esc(o.empresa) : '') +
         (o.revisao ? ' · rev ' + esc(o.revisao) : '') + '</div>');
  L.push('<div class="tools">');
  /* Os quatro layouts sao icones: a barra fica curta e o desenho de cada um diz o que vai
     acontecer sem depender de leitura. O `title` continua nomeando, para quem passar o mouse. */
  /* UM icone para as duas faces: clicar troca de uma para a outra, e o desenho mostra a que
     esta na tela. Dois botoes para um par que se exclui gastavam o dobro da barra para dizer
     a mesma coisa. Os dois SVG saem no HTML e o CSS mostra so um - assim trocar de face nao
     precisa de marcacao vinda do runtime. */
  L.push('<button class="t ic face" id="btFace" title="mostrar só o verso" aria-pressed="' +
         (o.layout === 'f' || o.layout === 'b' ? 'true' : 'false') + '">' +
         '<span class="sv-f">' + SVG.frente + '</span>' +
         '<span class="sv-b">' + SVG.verso + '</span></button>');
  L.push(icone('data-layout', 'lr', 'Frente e verso', SVG.ambos, o.layout === 'lr'));
  L.push(icone('data-layout', 'bom', 'Só a lista', SVG.lista, o.layout === 'bom'));
  L.push('<span class="sep"></span>');
  /* icone de layout: dois paineis, o estreito e a lista. Clicar troca o lado, e o proprio
     icone espelha junto - assim ele mostra o que vai acontecer, e nao um rotulo a decorar */
  L.push('<button class="t ic" id="ladoLista" title="trocar o lado da lista">' +
         '<svg viewBox="0 0 21 14" width="21" height="14" aria-hidden="true">' +
         '<rect x="0.6" y="0.6" width="12.8" height="12.8" rx="2"/>' +
         '<rect class="f" x="15.4" y="0.6" width="5" height="12.8" rx="1.5"/>' +
         '</svg></button>');
  L.push('<button class="t ic" id="btGaveta" title="mais opções">' + SVG.ajustes + '</button>');
  L.push('</div></header>');
  L.push('<main><div id="placas">');
  L.push('<div class="cv"><span class="lbl">Frente</span><canvas id="cv0"></canvas></div>');
  L.push('<div class="cv"><span class="lbl">Verso</span><canvas id="cv1"></canvas></div>');
  L.push('</div>');
  L.push('<div id="hsplit" title="arraste para redimensionar a lista"></div>');
  /* a busca e o "limpar" moram COM a lista: e nela que se procura, e atravessar a tela ate
     a barra de cima para filtrar era um vai-e-vem sem motivo */
  L.push('<div id="bom">');
  L.push('<div class="bom-bar">' +
         '<input type="search" id="filtro" placeholder="filtrar…">' +
         '<button class="t" id="limpar">Limpar vistos</button></div>');
  L.push('<div id="bomRolo"><table><thead><tr>' +
         '<th></th><th>#</th><th>Qtd</th><th>Comentário</th><th>Footprint</th><th>Designadores</th>' +
         '</tr></thead><tbody id="linhas"></tbody></table>' +
         '<div id="vazio" style="display:none">nada com esse filtro</div></div>');
  L.push('</div>');
  L.push('</main>');

  L.push('<div id="gavetaBg"></div>');
  L.push('<aside id="gaveta">' +
         '<div class="gv-cab"><h2>Opções</h2>' +
         '<button class="t" id="gavetaFecha" title="fechar">✕</button></div>' +
         '<div class="gv-tit">camadas</div>' +
         check('pads', 'Pads', o.pads) +
         check('silk', 'Serigrafia', o.silk) +
         check('refs', 'Designadores', o.refs) +
         check('tracks', 'Trilhas', o.tracks) +
         check('regions', 'Planos', o.regions) +
         check('drills', 'Furos', o.drills) +
         '<div class="gv-tit">navegação</div>' +
         '<label class="gv-item"><input type="checkbox" id="cbGuiada"' +
         (o.guided ? ' checked' : '') + '>Visão guiada</label>' +
         '<p class="gv-nota">escolher na lista leva a câmera até a peça e dá zoom. ' +
         'No filtro, digitar um designador (“D1”) já mira nele.</p>' +
         '<div class="gv-tit">lista</div>' +
         '<div class="gv-seg">' +
         botao('data-modo', 'grupo', 'Agrupado', true) +
         botao('data-modo', 'peca', 'Por peça', false) +
         '</div>' +
         '<div class="gv-tit">aparência</div>' +
         '<label class="gv-item"><input type="checkbox" id="escuro"' +
         (o.dark ? ' checked' : '') + '>Tema escuro</label>' +
         '</aside>');

  L.push('<div id="modalBg"><div class="modal" role="dialog" aria-modal="true">' +
         '<h2 id="modalTit"></h2><p id="modalTxt"></p>' +
         '<div class="acoes"><button class="t" id="modalNao">Não</button>' +
         '<button class="t primario" id="modalSim">Sim</button></div></div></div>');
  L.push('<script>var D = ' + jsonSeguro(D) + ';</' + 'script>');
  L.push('<script>' + JS + '</' + 'script>');
  L.push('</body></html>');
  return L.join('\n');
}

const sane = s => String(s).replace(/[\\/:*?"<>|]/g, '_');
const filename = proj => sane(proj || 'placa') + '-BOM.html';

/* porta unica da aba: do board.js ao arquivo, num passo */
function gerar(board, opts, meta){
  const m = model(board, opts);
  return { html: html(m, meta), model: m, warnings: m.warnings };
}

return { defaults, model, html, filename, gerar, textoPolys, padGeom, ladoDe, natural, COR };
});
