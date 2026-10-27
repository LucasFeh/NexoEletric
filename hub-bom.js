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
  /* verde do que JA FOI MONTADO: e nas PROPRIAS formas da peça que ele entra - pad,
     serigrafia e contorno - em vez de um retangulo por cima, que escondia justamente o que
     se quer conferir. Mais fundo que o `alvo` de proposito: o realce e o alvo de agora (uma
     peça, e ja passa) e tem que ganhar do que ficou para tras. */
  feito:'#1db954',
  /* o furo da peça montada continua sendo FURO: verde bem mais escuro que o pad, senao o
     pad passante vira uma bolota verde sem buraco no meio */
  feitoFuro:'#0d5c2c',
  /* o disco do tique de montado: claro para se ler tanto sobre a placa escura do 2D quanto
     sobre o verde da mascara na vista 3D */
  selo:'#f6faf7',
};

/* Icones da barra. Sao poucos tracos de proposito: a 21x14 px o que se le e a SILHUETA -
   uma placa com a peça em cima (frente), a mesma tracejada com a peça do outro lado (verso),
   duas placas (as duas faces), tres linhas (a lista), duas trilhas com uma via (o cobre) e os
   cursores (ajustes). */
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
  trilhas:'<svg viewBox="0 0 21 14" width="21" height="14" aria-hidden="true">' +
          '<path d="M1.4 4.6H6.2L9.4 1.4H19.6"/>' +
          '<path d="M1.4 11.4H8.2L11.4 8.2H19.6"/>' +
          '<circle class="f" cx="15.4" cy="8.2" r="1.7"/></svg>',
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

  /* De quem e este primitivo. O board.js diz o designador (`owner`) e a pagina guarda o
     INDICE do componente - e por ele que o desenho pinta de verde a serigrafia da peça ja
     montada, do mesmo jeito que o pad ja fazia pelo `c`. Sai do objeto quando nao ha dono,
     para nao inchar o JSON da placa inteira com um campo vazio. */
  const comDono = (it, o) => {
    const d = o && o.owner != null ? idxPorRef[o.owner] : null;
    if (d != null) it.c = d;
    return it;
  };
  (B.silk || []).forEach(s => {
    const l = ladoDe(s.layer);
    if (l === null) return;
    if (s.kind === 'arc') silk.push(comDono({ s:l, k:'a', x:r3(s.cx), y:r3(s.cy), r:r3(s.r),
                                      a:r3(s.sa || 0), b:r3(s.ea == null ? 360 : s.ea), w:r3(s.w || 0.15) }, s));
    else silk.push(comDono({ s:l, k:'l', p:[[r3(s.x1), r3(s.y1)], [r3(s.x2), r3(s.y2)]], w:r3(s.w || 0.15) }, s));
  });
  (B.texts || []).forEach(t => {
    const l = ladoDe(t.layer);
    if (l === null) return;
    const w = r3(t.w > 0 ? t.w : (t.h || 1) * 0.13);
    /* o designador vira uma marca a parte: e o que o montador liga e desliga para achar a
       peça sem o resto da serigrafia por cima */
    const d = t.designator ? 1 : 0;
    textoPolys(t).forEach(p => silk.push(comDono({ s:l, k:'l', p, w, d }, t)));
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
/* a data/empresa/rev se alinha pela linha de baixo do titulo (as contas), e nao pelo
   meio do bloco: duas legendas de 12px na mesma base leem como uma faixa so */
header>.meta{align-self:flex-end}
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
.gv-ajuda{font-size:11.5px;line-height:1.9;color:var(--fg2)}
.gv-ajuda kbd{font:inherit;font-size:10.5px;padding:1px 5px;border:1px solid var(--linha);
  border-bottom-width:2px;border-radius:4px;background:var(--bg);color:var(--fg)}
/* menu do clique direito rapido, no ponto onde se clicou */
#menu3{position:fixed;z-index:25;display:none;min-width:158px;padding:4px;
  background:var(--pane);border:1px solid var(--linha);border-radius:8px;
  box-shadow:0 10px 30px rgba(0,0,0,.28)}
#menu3.on{display:block}
#menu3 button{display:block;width:100%;text-align:left;font:inherit;font-size:12.5px;
  padding:6px 10px;border:0;border-radius:5px;background:none;color:var(--fg);cursor:pointer}
#menu3 button:hover{background:color-mix(in srgb,var(--hi) 16%,transparent)}
#menu3 button.pai{display:flex;justify-content:space-between;align-items:center}
#menu3 button.pai span{color:var(--fg2);font-size:11px;transition:transform .12s}
#menu3 button.pai[aria-expanded="true"] span{transform:rotate(90deg)}
/* o submenu abre DENTRO do menu, e nao flutuando ao lado: um painel que se desdobra nao
   depende de saber para que lado ha espaco na tela, e funciona igual no toque */
#sub3{display:none;margin:2px 0 0 8px;padding-left:6px;border-left:1px solid var(--linha)}
#sub3.on{display:block}
.gv-seg{display:flex;gap:6px}
.gv-seg button{flex:1}

/* ── modal: a mesma linguagem da pagina, e nao a caixa cinza do navegador ── */
#semrede{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:31;
  background:#7a1420;color:#fff;padding:8px 14px;border-radius:6px;font-size:13px;
  box-shadow:0 2px 12px rgba(0,0,0,.4)}
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
.bom-bar .fte{flex:none;width:30px;font-weight:700;line-height:1;padding:4px 0;text-align:center}
.bom-bar .fte[data-fonte="p"]{font-size:10px}
.bom-bar .fte[data-fonte="m"]{font-size:12.5px}
.bom-bar .fte[data-fonte="g"]{font-size:15px}
#bomRolo{flex:1;overflow:auto;min-height:0}
.cv{position:relative;flex:1 1 0;min-width:0;background:var(--pane);border:1px solid var(--linha);
  border-radius:8px;overflow:hidden}
.cv.oculta{display:none}
.cv canvas{width:100%;height:100%;display:block;touch-action:none;cursor:crosshair}
.cv .lbl{position:absolute;top:6px;left:8px;font-size:11px;color:var(--fg2);
  background:var(--pane);padding:1px 6px;border-radius:5px;opacity:.9;pointer-events:none}
/* o quadradinho que troca 2D<->3D, no canto de cada vista */
.cv .d3{position:absolute;top:6px;right:6px;width:26px;height:22px;padding:0;
  font:600 10px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.02em;
  border:1px solid var(--linha);border-radius:5px;background:var(--pane);color:var(--fg2);
  cursor:pointer;opacity:.92}
.cv .d3:hover{color:var(--fg);border-color:var(--hi)}
#placas.tres-d .cv{display:none}
#placas.tres-d .cv3{display:block}
.cv3{display:none}
.cv3 canvas{cursor:grab}
.cv3 canvas:active{cursor:grabbing}
#bom{flex:0 0 var(--bomw,420px);min-width:200px;background:var(--pane);
  border-left:1px solid var(--linha);display:flex;flex-direction:column;min-height:0}
main.esq #bom{border-left:0;border-right:1px solid var(--linha)}
/* sem desenho na tela a lista deixa de ter largura fixa e toma tudo - senao ela ficaria
   presa nos 420 px com o resto da janela vazio */
#placas.só-bom~#bom{flex:1 1 auto}
/* O tamanho da lista sai de UMA medida: as colunas menores (cabeçalho, designadores, a
   etiqueta de lado) e o respiro das linhas derivam dela. Assim os tres modos mudam a lista
   inteira em proporcao, em vez de deixar um pedaço grande ao lado de outro miudo. */
#bom{--fte:12px;--resp:5px}
#bom.f-m{--fte:13.5px;--resp:7px}
#bom.f-g{--fte:15.5px;--resp:10px}
table{border-collapse:collapse;width:100%;font-size:var(--fte)}
th,td{text-align:left;padding:var(--resp) 8px;border-bottom:1px solid var(--linha);vertical-align:top}
th{position:sticky;top:0;background:var(--pane);z-index:1;font-weight:600;color:var(--fg2);
  font-size:calc(var(--fte) - 1px);text-transform:uppercase;letter-spacing:.04em}
tbody tr{cursor:pointer}
tbody tr:hover{background:color-mix(in srgb,var(--hi) 10%,transparent)}
tbody tr[aria-selected="true"]{background:color-mix(in srgb,var(--hi) 20%,transparent)}
tbody tr.feito td:not(.cx){opacity:.45;text-decoration:line-through}
td.q,td.n{text-align:right;font-variant-numeric:tabular-nums;color:var(--fg2)}
td.n{width:30px;padding-right:4px;opacity:.65}
td.refs{font-family:ui-monospace,Consolas,monospace;font-size:calc(var(--fte) - 1px);
  word-break:break-word}
td.cx{width:26px;text-align:center}
.lado{display:inline-block;font-size:calc(var(--fte) - 2px);padding:0 5px;border-radius:4px;border:1px solid var(--linha);
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
var fonte = 'p';   /* p | m | g - o tamanho de sempre e o 'p'; os outros dois crescem */
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

/* ---- vistos da bancada ------------------------------------------------------------
   Com servidor (pagina servida por /bom/<id>) os vistos sao COMPARTILHADOS: quem monta
   esta no tablet e quem confere esta no PC, e os dois tem que ver a mesma lista. Sem
   servidor cai no localStorage, que era o comportamento de quando o BOM era um arquivo.

   O que sobe e sempre um DELTA do que mudou, nunca o mapa inteiro: duas pessoas marcando
   pecas diferentes ao mesmo tempo se somam em vez de a ultima apagar o trabalho da outra.
   O "enviados" e o espelho do que o servidor confirmou; a diferenca contra "feitos"
   e o delta a mandar. */
var API = D.api || '';
var enviados = {}, revVistos = D.rev || 0, enviando = 0, _k;

if (API){
  feitos = D.vistos || {};
  for (_k in feitos) if (feitos[_k]) enviados[_k] = true;
} else {
  try { feitos = JSON.parse(localStorage.getItem(CHAVE) || '{}') || {}; } catch (e) { feitos = {}; }
}

/* Se o servidor cair no meio da montagem, quem esta na bancada TEM que saber: os vistos
   que ele marcar dali em diante nao existem para mais ninguem. Silencio aqui seria pior
   que o erro. */
function avisaRede(msg){
  var a = document.getElementById('semrede');
  if (!a) return;
  a.textContent = msg;
  a.hidden = false;
}
function semAviso(){ var a = document.getElementById('semrede'); if (a) a.hidden = true; }

/* O servidor e a verdade para o que os OUTROS marcaram - mas so quando nao ha nada voando
   daqui, senao uma resposta que saiu antes do ultimo clique o apagaria da tela. */
function absorve(vistos, rev){
  if (enviando) return false;
  var k, mudou = false;
  for (k in vistos) if (vistos[k] && !feitos[k]) { feitos[k] = true; mudou = true; }
  for (k in feitos) if (feitos[k] && !vistos[k]) { delete feitos[k]; mudou = true; }
  enviados = {};
  for (k in vistos) if (vistos[k]) enviados[k] = true;
  revVistos = rev || 0;
  return mudou;
}

function salvaFeitos(op){
  if (!API){
    try { localStorage.setItem(CHAVE, JSON.stringify(feitos)); } catch (e) {}
    return;
  }
  var corpo, k, n = 0;
  if (op && op.limpar){
    corpo = { clear: true };            /* uma chamada, e nao um "false" por peca da placa */
  } else {
    var delta = {};
    for (k in feitos) if (feitos[k] && !enviados[k]) { delta[k] = true; n++; }
    for (k in enviados) if (enviados[k] && !feitos[k]) { delta[k] = false; n++; }
    if (!n) return;
    corpo = { set: delta };
  }
  enviando++;
  fetch(API + '/vistos', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify(corpo) })
    .then(function (r){ return r.ok ? r.json() : null; })
    .then(function (j){
      enviando--;
      if (!j || !j.ok) return avisaRede('o servidor recusou o visto - ele nao esta salvo');
      enviados = {};
      for (var k2 in j.vistos) if (j.vistos[k2]) enviados[k2] = true;
      revVistos = j.rev || 0;
      semAviso();
    })
    .catch(function (){
      enviando--;
      avisaRede('servidor fora do ar - os vistos nao estao sendo salvos');
    });
}

/* Esta peça esta montada? O visto e por GRUPO ou por PEÇA conforme a vista aberta, e as duas
   granularidades convivem no mesmo mapa - mesmo critério do contas(). Somar as duas aqui
   pintaria de verde peça que a lista aberta mostra desmarcada. */
function feitoComp(i){
  var c = D.comps[i];
  if (!c) return false;
  if (modo !== 'grupo') return !!feitos['c' + c.ref];
  var g = D.groups[c.g];
  return !!(g && feitos['g' + g.k]);
}
/* nada marcado, nada a marcar: com a placa limpa nem o pad nem a serigrafia precisam
   perguntar de quem sao, e sao milhares deles por quadro vezes duas faces */
function temFeitos(){ for (var k in feitos) if (feitos[k]) return true; return false; }
/* o mesmo, para o primitivo que sabe de quem e: pad e serigrafia trazem o indice em c */
function feitoDe(i){ return i != null && feitoComp(i); }

/* Traz o que mudou no servidor. Uma edicao no esquema ou na PCB refaz a pagina inteira:
   desenho, valores e agrupamento precisam nascer da mesma revisao. */
function sincroniza(){
  if (!API || enviando) return;
  fetch(API + '/vistos', { cache: 'no-store' })
    .then(function (r){ return r.ok ? r.json() : null; })
    .then(function (j){
      if (!j || !j.ok) return;
      semAviso();
      if (D.sourceRev && j.sourceRev && j.sourceRev !== D.sourceRev){ location.reload(); return; }
      if (j.rev === revVistos) return;
      if (absorve(j.vistos, j.rev)) vistoMudou();
    })
    .catch(function (){ avisaRede('servidor fora do ar - os vistos nao estao sendo salvos'); });
}
if (API){
  setInterval(sincroniza, 4000);
  /* volta do bolso / troca de aba: olha na hora, sem esperar o intervalo */
  document.addEventListener('visibilitychange', function (){
    if (!document.hidden) sincroniza();
  });
}
try {
  var ui = JSON.parse(localStorage.getItem(CHAVE + '.ui') || 'null');
  if (ui && typeof ui === 'object'){
    lado = ui.lado === 'esq' ? 'esq' : 'dir';
    largLista = (typeof ui.w === 'number' && ui.w > 0) ? ui.w : 0;
    if (typeof ui.guiada === 'boolean') guiada = ui.guiada;
    if (ui.fonte === 'p' || ui.fonte === 'm' || ui.fonte === 'g') fonte = ui.fonte;
  }
} catch (e) {}
function salvaUI(){
  try {
    localStorage.setItem(CHAVE + '.ui',
      JSON.stringify({ lado:lado, w:largLista, guiada:guiada, fonte:fonte }));
  } catch (e) {}
}

/* O tamanho aplicado na LISTA e no proprio botao de uma vez. O botao sai daqui, e nao do HTML
   emitido: gravado "grande" e reaberto, ele mostraria o A pequeno com a lista grande - foi
   exatamente o que aconteceu com a caixa da visao guiada. */
var NOME_FTE = { p:'pequena', m:'m\u00e9dia', g:'grande' };
function aplicaFonte(){
  var bom = document.getElementById('bom'), bt = document.getElementById('btFonte');
  bom.classList.toggle('f-m', fonte === 'm');
  bom.classList.toggle('f-g', fonte === 'g');
  bt.setAttribute('data-fonte', fonte);
  bt.title = 'fonte da lista: ' + NOME_FTE[fonte] + ' \u2014 clique para trocar';
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
  var W = c.cv.clientWidth, H = c.cv.clientHeight;
  /* Canvas dentro de pai display:none mede ZERO, e enquadrar nesse estado gravava uma escala
     de lixo (1/(largura+4)) que sobrevivia depois. Era o que fazia sair do 3D devolver as
     duas telas 2D com a placa em menos de um pixel: com a vista 3D aberta as 2D estao
     escondidas, e tanto o resize da janela quanto o aplicaLayout da visao guiada chamavam
     este ajuste nelas. Sem tamanho nao ha enquadramento possivel - a camera anterior, que
     estava certa, e o melhor que se tem. */
  if (!W || !H) return;
  var w = (b.x2 - b.x1) + m*2, h = (b.y2 - b.y1) + m*2;
  c.esc = Math.min(W / w, H / h) || 1;
  c.cx = (b.x1 + b.x2) / 2; c.cy = (b.y1 + b.y2) / 2;
}
function redim(){
  var dpr = window.devicePixelRatio || 1;
  cams.concat([v3]).forEach(function (c){
    if (!c || !c.cv) return;
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

/* mundo -> pixel do canvas, na camera de um lado. E o inverso do c.mundo, e sai em pixel de
   DISPOSITIVO (o mesmo em que o desenho da placa acontece). */
function telaDe(c, x, y){
  var k = c.esc * c.dpr;
  return [c.cv.width/2 + (x - c.cx) * (c.lado ? -k : k), c.cv.height/2 - (y - c.cy) * k];
}
/* O "confere" de quem ja montou a peça: disco claro com o tique verde. O disco e claro de
   proposito - em cima do verde da placa da vista 3D um tique verde sozinho desaparece, e o
   que tem que se ler de longe e "essa ja esta pronta". */
function confere(ctx, x, y, R){
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.fillStyle = D.cores.selo;
  ctx.beginPath(); ctx.arc(x, y, R, 0, 6.2831853); ctx.fill();
  ctx.strokeStyle = D.cores.feito; ctx.lineWidth = Math.max(0.9, R * 0.2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - R*0.46, y + R*0.02);
  ctx.lineTo(x - R*0.10, y + R*0.40);
  ctx.lineTo(x + R*0.48, y - R*0.38);
  ctx.strokeStyle = D.cores.feito; ctx.lineWidth = Math.max(1.3, R * 0.32); ctx.stroke();
  ctx.restore();
}
/* A marca de montado e instrumento de TELA, como a esfera do pivo da vista 3D: escrita em
   milimetros ela sairia espelhada no verso, de cabeça para baixo (o Y do canvas aponta para o
   outro lado) e mudaria de tamanho a cada zoom. Por isso quem chama entrega a projecao
   pronta: proj leva mundo -> pixel, ppmm e quantos pixels vale um milimetro ali, fy o quanto
   aquela projecao achata a vertical (1 no 2D) e k quantos pixels tem um pixel de CSS - e
   nele que o teto e o piso do tamanho estao escritos. */
function marcaFeitos(ctx, L, proj, ppmm, fy, k){
  D.comps.forEach(function (cp, i){
    if ((cp.s !== L && !cp.t) || !feitoComp(i)) return;
    var bw = cp.bb ? cp.bb[2] - cp.bb[0] : 1.6, bh = cp.bb ? cp.bb[3] - cp.bb[1] : 1.6;
    var p = proj(cp.bb ? (cp.bb[0] + cp.bb[2]) / 2 : cp.x,
                 cp.bb ? (cp.bb[1] + cp.bb[3]) / 2 : cp.y);
    /* o raio acompanha a peça, com teto e piso: sem teto um conector ganharia um disco do
       tamanho dele, e sem piso a placa inteira na tela nao mostraria marca nenhuma */
    confere(ctx, p[0], p[1],
            Math.max(3*k, Math.min(7*k, 0.28 * Math.min(bw, bh * fy) * ppmm)));
  });
}
/* O ENTORNO da peça montada, no sistema da PLACA (bbox em mm). So o contorno: o corpo dela
   ja esta verde nas proprias formas, e um retangulo cheio por cima escondia o pad, a
   serigrafia e o furo - que e exatamente o que a bancada precisa ver para conferir. */
function contornoFeitos(ctx, L, quadro, larg){
  ctx.strokeStyle = D.cores.feito; ctx.lineWidth = larg;
  D.comps.forEach(function (cp, i){
    if (!cp.bb || (cp.s !== L && !cp.t) || !feitoComp(i)) return;
    quadro(cp.bb);
  });
}

function desenha(c){
  /* canvas dentro de um pai display:none tem largura zero - desenhar nele e trabalho jogado
     fora, e com a visao guiada mostrando uma face por vez isso vale metade do desenho */
  if (!c || !c.cv.clientWidth) return;
  var ctx = c.ctx, W = c.cv.width, H = c.cv.height, L = c.lado, P = D.cores[L];
  /* uma pergunta por quadro, e nao uma por pad: com a placa sem nenhum visto o desenho segue
     exatamente o caminho de antes */
  var temF = temFeitos();
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
      /* o pad da peça montada sai verde: e a forma dela, e nao uma tarja por cima */
      preencheTodos(ctx, p.p, temF && feitoDe(p.c) ? D.cores.feito
                              : p.th ? D.cores.th : P.pad);
    });
    if (mostra.drills) D.pads.forEach(function (p){
      if (p.h && (p.s === -1 || p.s === L))
        preencheTodos(ctx, p.h, temF && feitoDe(p.c) ? D.cores.feitoFuro : D.cores.furo);
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
    ctx.strokeStyle = temF && feitoDe(s.c) ? D.cores.feito : P.silk;
    ctx.lineWidth = s.w;
    ctx.beginPath();
    if (s.k === 'a') ctx.arc(s.x, s.y, s.r, s.a*Math.PI/180, s.b*Math.PI/180);
    else { for (var i = 0; i < s.p.length; i++){
      if (i) ctx.lineTo(s.p[i][0], s.p[i][1]); else ctx.moveTo(s.p[i][0], s.p[i][1]); } }
    ctx.stroke();
  });

  /* e o entorno dela fecha o recado - quem esta na bancada acha em UM olhar o que falta, sem
     varrer a lista peça por peça. Entra antes da net e do realce: e o estado do que ja
     passou, e nao o alvo de agora. */
  if (temF) contornoFeitos(ctx, L, function (bb){
    ctx.strokeRect(bb[0], bb[1], bb[2]-bb[0], bb[3]-bb[1]);
  }, Math.max(0.1, 1.4/c.esc));

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
  /* o tique vem depois do restore, e por isso depois de tudo: e o unico desenho que tem que
     continuar legivel mesmo com a peça selecionada acesa por cima */
  if (temF)
    marcaFeitos(ctx, L, function (x, y){ return telaDe(c, x, y); }, c.esc * c.dpr, 1, c.dpr);
}
function pinta(){ if (v3.on) desenha3(); else cams.forEach(desenha); }

/* ═══════════════ vista 3D ═══════════════
   Sem biblioteca nenhuma, e nao por teimosia: uma PCB e 2,5D - tudo mora em TRES alturas
   (cobre do verso, substrato, cobre da frente). Com isso o algoritmo do pintor resolve a
   oclusao inteira sem z-buffer: desenha-se a parede, depois a face que se ve, depois o cobre
   dela. Nao ha o que se intersectar, entao nao ha o que ordenar por triangulo.

   Projecao ORTOGRAFICA: numa placa plana a perspectiva quase nao acrescenta e custa exatidao
   de medida - o que se quer aqui e reconhecer a peça, nao simular uma foto.

   ESP e a espessura: o board.js nao traz esse dado, entao vale o 1,6 mm de FR4 padrao. */
var ESP = 1.6;
var v3 = { on:false, yaw:-0.55, pitch:0.95, esc:1, cx:0, cy:0, cv:null, lado:0,
           piv:null };   /* piv = ponto do mundo em torno do qual se gira, enquanto se segura */

/* verde de mascara, metal exposto nos pads: e o que a placa e de verdade, e a trilha sob a
   mascara aparece como o relevo mais claro que ela realmente tem */
var C3 = { topo:'#176a32', parede:'#0d4a22', trilha:'#23833f',
           metal:'#d7d9de', silk:'#f4f4f4', furo:'#08120b' };

/* de que lado se esta olhando: pitch positivo ve a frente, negativo ve o verso */
function ladoV3(){ return v3.pitch >= 0 ? 0 : 1; }

/* mundo (mm, Z para cima) -> plano projetado (mm). Gira em torno de Z e inclina. */
function pr3(x, y, z){
  var ca = Math.cos(v3.yaw), sa = Math.sin(v3.yaw);
  var X = x*ca - y*sa, Y = x*sa + y*ca;
  return [X, Y*Math.sin(v3.pitch) + z*Math.cos(v3.pitch)];
}
function tela3(ctx, W, H, p){
  return [W/2 + (p[0] - v3.cx) * v3.esc, H/2 - (p[1] - v3.cy) * v3.esc];
}
/* px do canvas -> plano projetado (mm) */
function planoDe(cv, ev){
  var r = cv.getBoundingClientRect();
  var W = cv.clientWidth || 1, H = cv.clientHeight || 1;
  return [ (ev.clientX - r.left - W/2) / v3.esc + v3.cx,
           -(ev.clientY - r.top - H/2) / v3.esc + v3.cy ];
}
/* plano projetado -> mundo, no plano MEDIO da placa (z = 0).
   A projecao e ortografica, entao um ponto da tela e uma reta no espaço; escolher z = 0 da o
   ponto sobre a placa, que e o que a pessoa esta mirando quando aponta para ela. */
function mundo3(p){
  var sp = Math.sin(v3.pitch);
  if (Math.abs(sp) < 0.05) return null;       /* de lado a placa vira uma linha: nao ha ponto */
  var X = p[0], Y = p[1] / sp;
  var ca = Math.cos(v3.yaw), sa = Math.sin(v3.yaw);
  return [ X*ca + Y*sa, -X*sa + Y*ca ];       /* gira de volta por -yaw */
}

/* enquadra a placa inteira na vista 3D, com a caixa JA projetada - girada, a placa ocupa
   outro retangulo na tela, e enquadrar pela caixa do mundo deixaria sobra dos dois lados */
function ajusta3(){
  var b = bbox(), x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  [b.x1, b.x2].forEach(function (x){
    [b.y1, b.y2].forEach(function (y){
      [-ESP/2, ESP/2].forEach(function (z){
        var p = pr3(x, y, z);
        x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]);
        x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]);
      });
    });
  });
  var cv = v3.cv, W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;                    /* mesmo motivo do ajusta() das vistas 2D */
  v3.cx = (x1 + x2) / 2; v3.cy = (y1 + y2) / 2;
  v3.esc = Math.min(W / (x2 - x1 + 4), H / (y2 - y1 + 4)) || 1;
}

function poly3(ctx, W, H, pts, z){
  ctx.beginPath();
  for (var i = 0; i < pts.length; i++){
    var p = tela3(ctx, W, H, pr3(pts[i][0], pts[i][1], z));
    if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
  }
}
/* Traco em LOTE, agrupado por espessura.

   O caro aqui nao e a conta da projecao, e a chamada: um beginPath/stroke por segmento dava
   8.746 tracos so de serigrafia na maior placa do acervo, a cada quadro da orbita. Como a
   espessura e o unico atributo que muda entre eles, um caminho por espessura resolve - viram
   meia duzia de chamadas, com o mesmo desenho na tela. Traco nao tem regra de preenchimento,
   entao juntar segmentos num caminho so nao muda o resultado (ao contrario do fill, onde o
   sentido do poligono importa - por isso o preenchimento continua um a um). */
function lote(){ return { por:{}, n:0 }; }
function poeLinha(L, a, b, z, larg){
  var k = larg.toFixed(3);
  (L.por[k] = L.por[k] || []).push([a, b, z]);
  L.n++;
}
function traçaLote(ctx, W, H, L, cor){
  ctx.strokeStyle = cor;
  for (var k in L.por){
    var segs = L.por[k];
    ctx.lineWidth = Math.max(0.8, parseFloat(k) * v3.esc);
    ctx.beginPath();
    for (var i = 0; i < segs.length; i++){
      var p = tela3(ctx, W, H, pr3(segs[i][0][0], segs[i][0][1], segs[i][2]));
      var q = tela3(ctx, W, H, pr3(segs[i][1][0], segs[i][1][1], segs[i][2]));
      ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
    }
    ctx.stroke();
  }
}

function desenha3(){
  var cv = v3.cv;
  if (!cv || !cv.clientWidth) return;
  var ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  var dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.scale(dpr, dpr);
  W = W / dpr; H = H / dpr;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  var L = ladoV3(), zf = L ? -ESP/2 : ESP/2;      /* a face que se ve */
  var zt = -zf;                                    /* a de tras */
  var temF = temFeitos();

  /* 1. as paredes do FR4 - a espessura que faz a placa parecer uma placa */
  D.outline.forEach(function (loop){
    for (var i = 0; i + 1 < loop.length; i++){
      var a = loop[i], b = loop[i+1];
      var p1 = tela3(ctx, W, H, pr3(a[0], a[1], -ESP/2)),
          p2 = tela3(ctx, W, H, pr3(b[0], b[1], -ESP/2)),
          p3 = tela3(ctx, W, H, pr3(b[0], b[1],  ESP/2)),
          p4 = tela3(ctx, W, H, pr3(a[0], a[1],  ESP/2));
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]);
      ctx.lineTo(p3[0], p3[1]); ctx.lineTo(p4[0], p4[1]); ctx.closePath();
      ctx.fillStyle = C3.parede; ctx.fill();
    }
  });

  /* 2. a face de cima, com os recortes vazados (par-impar, como no 2D) */
  ctx.beginPath();
  D.outline.forEach(function (loop){
    for (var i = 0; i < loop.length; i++){
      var p = tela3(ctx, W, H, pr3(loop[i][0], loop[i][1], zf));
      if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
    }
    ctx.closePath();
  });
  ctx.fillStyle = C3.topo; ctx.fill('evenodd');

  /* 3. o cobre daquela face. Plano e trilha ficam SOB a mascara - por isso saem em verde
     mais claro, que e como aparecem na placa de verdade; pad e via sao metal exposto. */
  if (mostra.regions) D.regions.forEach(function (g){
    if (g.s !== L) return;
    poly3(ctx, W, H, g.p, zf); ctx.closePath();
    ctx.fillStyle = C3.trilha; ctx.fill();
  });
  if (mostra.tracks){
    var lt = lote();
    D.tracks.forEach(function (t){
      if (t.s !== L) return;
      if (t.k === 'a'){
        var pa = arco3(t.x, t.y, t.r, t.a, t.b);
        for (var i = 0; i + 1 < pa.length; i++) poeLinha(lt, pa[i], pa[i+1], zf, t.w);
        return;
      }
      poeLinha(lt, t.p[0], t.p[1], zf, t.w);
    });
    traçaLote(ctx, W, H, lt, C3.trilha);
  }
  if (mostra.pads){
    D.pads.forEach(function (p){
      if (p.s !== -1 && p.s !== L) return;
      ctx.fillStyle = temF && feitoDe(p.c) ? D.cores.feito : C3.metal;
      p.p.forEach(function (poly){ poly3(ctx, W, H, poly, zf); ctx.closePath(); ctx.fill(); });
    });
    D.vias.forEach(function (v){
      poly3(ctx, W, H, circ3(v.x, v.y, v.r), zf); ctx.closePath();
      ctx.fillStyle = C3.metal; ctx.fill();
    });
    if (mostra.drills){
      D.pads.forEach(function (p){
        if (!p.h || (p.s !== -1 && p.s !== L)) return;
        ctx.fillStyle = temF && feitoDe(p.c) ? D.cores.feitoFuro : C3.furo;
        p.h.forEach(function (poly){ poly3(ctx, W, H, poly, zf); ctx.closePath(); ctx.fill(); });
      });
      D.vias.forEach(function (v){
        if (!(v.d > 0)) return;
        poly3(ctx, W, H, circ3(v.x, v.y, v.d), zf); ctx.closePath();
        ctx.fillStyle = C3.furo; ctx.fill();
      });
    }
  }

  /* 4. serigrafia */
  if (mostra.silk){
    /* dois lotes, e nao uma cor por segmento: o traço em lote e o que faz a orbita rodar em
       placa grande, e a serigrafia da peça montada e so mais um lote - o da outra cor */
    var ls = lote(), lf = lote();
    D.silk.forEach(function (sk){
      if (sk.s !== L || (sk.d && !mostra.refs)) return;
      var pts = sk.k === 'a' ? arco3(sk.x, sk.y, sk.r, sk.a, sk.b) : sk.p;
      var qual = temF && feitoDe(sk.c) ? lf : ls;
      for (var i = 0; i + 1 < pts.length; i++) poeLinha(qual, pts[i], pts[i+1], zf, sk.w);
    });
    traçaLote(ctx, W, H, ls, C3.silk);
    if (lf.n) traçaLote(ctx, W, H, lf, D.cores.feito);
  }

  /* 5. o entorno do que ja foi montado (o corpo dela ja saiu verde nas proprias formas, la
     em cima), antes do realce - estado, e nao alvo */
  if (temF) contornoFeitos(ctx, L, function (bb){
    poly3(ctx, W, H, [[bb[0],bb[1]],[bb[2],bb[1]],[bb[2],bb[3]],[bb[0],bb[3]]], zf);
    ctx.closePath(); ctx.stroke();
  }, 1.4);

  /* 6. o realce, por cima de tudo */
  if (realce.length){
    realce.forEach(function (i){
      var cp = D.comps[i];
      if (!cp || !cp.bb || (cp.s !== L && !cp.t)) return;
      poly3(ctx, W, H, [[cp.bb[0],cp.bb[1]],[cp.bb[2],cp.bb[1]],
                        [cp.bb[2],cp.bb[3]],[cp.bb[0],cp.bb[3]]], zf);
      ctx.closePath();
      ctx.fillStyle = D.cores.alvo; ctx.globalAlpha = 0.4; ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = D.cores.alvo;
      ctx.lineWidth = 1.5; ctx.stroke();
    });
  }
  /* 7. o tique de montado - depois do realce, pelo mesmo motivo do 2D. O tela3 ja devolve
     pixel de CSS (o ctx foi escalado pelo dpr aqui em cima), e a projecao achata a vertical
     pelo seno da inclinacao: de lado, um disco do tamanho da peça nao caberia nela. */
  if (temF)
    marcaFeitos(ctx, L, function (x, y){ return tela3(ctx, W, H, pr3(x, y, zf)); },
                v3.esc, Math.max(0.2, Math.abs(Math.sin(v3.pitch))), 1);
  /* 8. a esfera com a cruz, no ponto em torno do qual se esta girando. Fica em PIXEIS, e nao
     em mm: e um instrumento da tela, e tem que ter o mesmo tamanho perto ou longe. */
  if (v3.piv){
    var g = tela3(ctx, W, H, pr3(v3.piv[0], v3.piv[1], 0)), R = 26;
    ctx.save();
    ctx.strokeStyle = '#eaeaea'; ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(g[0], g[1], R, 0, 6.2831853); ctx.fill(); ctx.stroke();
    /* duas elipses dao o volume de esfera - por scale, e nao por ctx.ellipse, que nem todo
       host de canvas implementa */
    [[1, 0.38], [0.38, 1]].forEach(function (e){
      ctx.save(); ctx.translate(g[0], g[1]); ctx.scale(e[0], e[1]);
      ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.2831853); ctx.stroke(); ctx.restore();
    });
    ctx.beginPath();
    ctx.moveTo(g[0] - R - 7, g[1]); ctx.lineTo(g[0] + R + 7, g[1]);
    ctx.moveTo(g[0], g[1] - R - 7); ctx.lineTo(g[0], g[1] + R + 7);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}
/* Arco -> polilinha. A pagina recebe arco como centro/raio/angulos, e em 3D um arco no plano
   da placa vira uma elipse na tela - ctx.arc nao serve. Sao 390 arcos de serigrafia no acervo
   (metade deles no PRJ-UR-DI261924), entao descarta-los deixava a placa visivelmente
   diferente da vista 2D. O passo segue o zoom, como no circ3. */
function arco3(cx, cy, r, sa, ea){
  var a0 = sa * Math.PI/180, a1 = ea * Math.PI/180;
  while (a1 <= a0) a1 += 6.2831853;
  var n = Math.max(4, Math.min(64, Math.round((a1 - a0) * r * v3.esc / 3)));
  var out = [];
  for (var i = 0; i <= n; i++){
    var a = a0 + (a1 - a0) * i / n;
    out.push([cx + r*Math.cos(a), cy + r*Math.sin(a)]);
  }
  return out;
}
/* circulo achatado, so para via e furo: o resto ja chega em poligono do gerador */
function circ3(cx, cy, r){
  var n = Math.max(8, Math.min(28, Math.round(r * v3.esc))), out = [];
  for (var i = 0; i <= n; i++){
    var a = i / n * 6.2831853;
    out.push([cx + r*Math.cos(a), cy + r*Math.sin(a)]);
  }
  return out;
}

/* Recoloca a camera para que o PIVO continue no mesmo pixel depois de girar. E a mesma conta
   do zoom ancorado no cursor: projeta o ponto com os angulos novos e desloca o centro pela
   diferenca. Sem isto, girar afastaria a placa do cursor e a pessoa perderia o que mirava. */
function ancoraPivo(cv, telaPiv){
  if (!v3.piv) return;
  var W = cv.clientWidth || 1, H = cv.clientHeight || 1;
  var p = pr3(v3.piv[0], v3.piv[1], 0);
  v3.cx = p[0] - (telaPiv[0] - W/2) / v3.esc;
  v3.cy = p[1] + (telaPiv[1] - H/2) / v3.esc;
}

/* Navegacao no molde do Altium: o botao ESQUERDO move a vista, o DIREITO gira - e gira em
   torno do ponto onde se clicou, marcado por uma esfera com uma cruz enquanto se segura.
   Girar sempre pelo centro da placa obriga a reenquadrar a cada volta; girando pelo ponto que
   se esta olhando, o que interessa fica parado na tela. */
function ligaV3(){
  var cv = v3.cv, modo = null, px = 0, py = 0, ox = 0, oy = 0, telaPiv = [0, 0];
  cv.addEventListener('contextmenu', function (ev){ ev.preventDefault(); });
  cv.addEventListener('pointerdown', function (ev){
    anim = null;
    fechaMenu3();
    px = ox = ev.clientX; py = oy = ev.clientY;
    cv.setPointerCapture(ev.pointerId);
    if (ev.button === 2){
      modo = 'girar';
      var r = cv.getBoundingClientRect();
      telaPiv = [ev.clientX - r.left, ev.clientY - r.top];
      /* De perfil nao existe ponto da placa sob o cursor. Fingir que existe (usando o centro
         dela) fazia a esfera aparecer longe do cursor e, no primeiro pixel de arrasto, a
         ancora arrastava a placa inteira para debaixo do clique. Sem pivo, gira-se sem
         ancorar - que e o comportamento honesto. */
      v3.piv = mundo3(planoDe(cv, ev));
      desenha3();
    } else {
      modo = 'mover';
    }
    if (ev.preventDefault) ev.preventDefault();
  });
  cv.addEventListener('pointermove', function (ev){
    if (!modo) return;
    var dx = ev.clientX - px, dy = ev.clientY - py;
    if (modo === 'mover'){
      v3.cx -= dx / v3.esc; v3.cy += dy / v3.esc;
    } else {
      v3.yaw += dx * 0.01;
      /* o pitch atravessa o zero e mostra o VERSO: e o gesto de virar a placa na mao */
      /* o limite e o proprio topo (pi/2): menos que isso e a pose de origem ficaria fora do
         alcance do arrasto, e o primeiro movimento depois de centralizar daria um tranco */
      v3.pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, v3.pitch - dy * 0.01));
      if (v3.piv) ancoraPivo(cv, telaPiv);
    }
    px = ev.clientX; py = ev.clientY;
    desenha3();
  });
  var solta = function (ev){
    /* direito SEM arrasto e um clique, e clique abre menu - o mesmo gesto do Altium. O
       limiar mede ate onde o botao desceu, e nao ate o ultimo movimento. */
    var clique = modo === 'girar' && ev && ev.clientX != null &&
                 Math.abs(ev.clientX - ox) <= 4 && Math.abs(ev.clientY - oy) <= 4;
    modo = null; v3.piv = null;
    if (clique) abreMenu3(ev.clientX, ev.clientY);
    desenha3();
  };
  cv.addEventListener('pointerup', solta);
  cv.addEventListener('pointercancel', solta);
  cv.addEventListener('wheel', function (ev){
    ev.preventDefault();
    anim = null;
    /* Shift + roda anda para os lados, como nas outras vistas */
    if (ev.shiftKey){
      var d = (ev.deltaX || ev.deltaY) * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1);
      v3.cx += d / v3.esc;
      desenha3();
      return;
    }
    /* amplia no CURSOR, como as vistas 2D fazem: o ponto sob o ponteiro nao sai do lugar */
    var antes = planoDe(cv, ev);
    var dy = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1);
    v3.esc *= Math.exp(-dy * 0.0016);
    var dep = planoDe(cv, ev);
    /* so ancora se a conta fechar: um evento sem coordenada levaria NaN para o centro da
       camera, e dali em diante a placa simplesmente nao apareceria mais */
    var ax = antes[0] - dep[0], ay = antes[1] - dep[1];
    if (isFinite(ax) && isFinite(ay)){ v3.cx += ax; v3.cy += ay; }
    desenha3();
  }, { passive:false });
}

/* Centralizar e virar a face: as duas coisas que se faz o tempo todo olhando uma placa em
   3D, e que sem atalho viram um passeio ate a barra.

   Centralizar RECOLOCA a placa, e nao so reenquadra: depois de tombar a vista, reenquadrar no
   angulo tombado devolve a placa torta no meio da tela, que nao e "centralizar" para quem
   pediu. Ela volta reta e de frente - a mesma pose da vista 2D, so que em 3D. A FACE e
   preservada: quem esta conferindo o verso nao quer ser jogado para a frente; para trocar de
   face existe o Ctrl+F e o "Espelhar" do menu. */
/* A pose de origem: placa reta, virada para cima, centrada e enquadrada. E onde a vista 3D
   ABRE e para onde o "Centralizar" volta - abrir de esguelha ja obrigava a centralizar antes
   de olhar qualquer coisa. */
function pose3(){
  v3.yaw = 0;
  v3.pitch = v3.pitch < 0 ? -Math.PI/2 : Math.PI/2;
  ajusta3();
}
function centra3(){ pose3(); desenha3(); }
/* Poe a placa numa pose de bancada: gira em torno da propria normal para o angulo pedido,
   mantendo a face e a inclinacao. Reenquadra porque, girada, ela ocupa outro retangulo. */
function posiciona3(graus){
  v3.yaw = graus * Math.PI / 180;
  ajusta3(); desenha3();
}
/* Onde o centro da placa cai na tela, e como recoloca-lo num pixel dado.

   pr3() gira em torno de (0,0) do MUNDO, e o board.js entrega coordenadas relativas a origem
   da placa - que fica longe do centro dela (86 mm no TCMS_Reader). Entao qualquer mudanca de
   angulo faz a placa ORBITAR em vez de girar no lugar. Todo comando que mexe no angulo tem
   que reenquadrar (ajusta3) ou reancorar por aqui; foi o que faltou no "Virar 360". */
function telaCentro3(){
  var cv = v3.cv, W = cv.clientWidth || 1, H = cv.clientHeight || 1;
  var b = bbox(), p = pr3((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, 0);
  return [W/2 + (p[0] - v3.cx) * v3.esc, H/2 - (p[1] - v3.cy) * v3.esc];
}
function ancoraCentro3(sx, sy){
  var cv = v3.cv, W = cv.clientWidth || 1, H = cv.clientHeight || 1;
  var b = bbox(), p = pr3((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, 0);
  v3.cx = p[0] - (sx - W/2) / v3.esc;
  v3.cy = p[1] + (sy - H/2) / v3.esc;
}

/* Trocar de face NAO pode mover a placa na tela.

   O sinal do pitch e a face, mas inverte-lo espelha o eixo Y da projecao: uma placa centrada
   em Y = 40 mm pula para -40, ou seja o dobro da distancia ate o centro. Quem apertou Ctrl+F
   queria ver o outro lado do que estava olhando, e nao caçar a placa de novo. Entao aqui se
   guarda onde o centro dela estava na TELA e se recoloca a camera para ele cair no mesmo
   pixel - a mesma conta da ancora do pivo e da roda. */
/* Virar a placa e DOIS movimentos, e nao um: ela troca de face e da meia volta, como a mao
   faz ao virar uma placa sobre a bancada. So inverter a inclinacao espelharia o eixo Y; com a
   meia volta junto, o espelho cai no X - que e a mesma convencao da vista "Verso" 2D. Sem
   isso, a mesma placa aparecia espelhada de um jeito no 2D e de outro no 3D.

   E ela VIRA na tela, em vez de trocar de imagem entre dois quadros: a inclinacao caminha de
   +p ate -p passando pelo ZERO, que e a placa de perfil - o mesmo caminho que o arrasto com o
   botao direito percorre na mao. E no perfil, quando ela e uma linha de 1,6 mm na tela, que a
   meia volta entra: ali ela nao se ve, e o giro em torno da normal - que seria um rodopio
   estranho no meio da virada - nao aparece.

   Chamar com anima=false pula tudo isso: a visao guiada vira a face e ja manda a camera
   viajar ate a peça, e duas animacoes disputando o mesmo comando deixariam a placa parada no
   meio da virada. */
var VIRA_MS = 300;      /* uma meia volta. Rapida o bastante para nao virar espera, longa o
                           bastante para se ver a placa passar de perfil */
var vira = null;        /* a virada em andamento, para o proximo Ctrl+F saber que ha uma */

function viraFace3(anima){
  var p0 = v3.pitch;
  /* de perfil nao ha o que tombar, e quem pediu para nao animar nao anima */
  if (anima === false || !p0 || semAnimacao()){
    var ja = telaCentro3();
    v3.yaw += Math.PI; v3.pitch = -p0;
    ancoraCentro3(ja[0], ja[1]);
    desenha3();
    return;
  }
  /* Ctrl+F no meio de uma virada EMENDA outra meia volta, em vez de virar dali. Virar do
     ponto em que ela esta ia ficando cada vez menor - dois toques seguidos deixavam a placa
     balançando de perfil, sem nunca completar a volta. Assim ela roda enquanto se aperta.
     O teto e para a tecla repetida (segurar o Ctrl+F dispara dezenas): a placa acompanha a
     mao e para logo depois, em vez de girar sozinha por quinze segundos. */
  if (vira && vira.meu === anim){
    vira.restam = Math.min(vira.restam + 1, 3);
    return;
  }
  /* a placa fica onde estava a CADA quadro: pr3 gira em torno da origem do mundo, entao sem
     reancorar ela sairia orbitando pela tela enquanto tomba */
  var onde = telaCentro3();
  var meu = anim = {}, t0 = null, meia = false, de = p0;
  vira = { meu:meu, restam:0 };
  requestAnimationFrame(function passo(ts){
    /* a mao manda: quem pegou a placa interrompe a virada. So limpa o vira se ele ainda for
       DESTE laço - senao um quadro atrasado apagaria a virada que ja comecou depois */
    if (meu !== anim){ if (vira && vira.meu === meu) vira = null; return; }
    /* host sem relogio de quadro: acaba de uma vez, em vez de girar sem avançar */
    var t = typeof ts !== 'number' ? 1
          : t0 === null ? (t0 = ts, 0) : Math.min(1, (ts - t0) / VIRA_MS);
    var e = t < 0.5 ? 2*t*t : 1 - 2*(1-t)*(1-t);
    if (!meia && e >= 0.5){ meia = true; v3.yaw += Math.PI; }
    v3.pitch = de - 2*de*e;
    ancoraCentro3(onde[0], onde[1]);
    desenha3();
    if (t < 1) return requestAnimationFrame(passo);
    if (!meia) v3.yaw += Math.PI;
    if (vira.restam > 0){
      vira.restam--;
      de = v3.pitch; meia = false;
      /* o tempo que passou do fim da meia volta entra na proxima, em vez de se perder: sem
         isso cada emenda comia um quadro parado e a rotacao andava aos trancos */
      t0 = typeof ts === 'number' ? ts - Math.max(0, (ts - t0) - VIRA_MS) : null;
      return requestAnimationFrame(passo);
    }
    vira = null; anim = null;
  });
}
function abreMenu3(x, y){
  var m = document.getElementById('menu3');
  m.style.left = x + 'px'; m.style.top = y + 'px';
  m.classList.add('on');
}
function fechaMenu3(){
  document.getElementById('menu3').classList.remove('on');
  /* o submenu fecha junto: reabrir o menu com ele ja desdobrado esconde os itens de cima */
  var sub = document.getElementById('sub3');
  if (sub) sub.classList.remove('on');
  var pai = document.querySelector('[data-m3="pos"]');
  if (pai) pai.setAttribute('aria-expanded', 'false');
}

function poe3D(on){
  v3.on = !!on;
  document.getElementById('placas').classList.toggle('tres-d', v3.on);
  requestAnimationFrame(function (){
    redim();
    if (v3.on) pose3();     /* abre reta e centrada, e nao no angulo em que ficou da ultima vez */
    pinta();
  });
}

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
    td('n', String(++n));
    var cx = td('cx', '');
    var box = document.createElement('input');
    box.type = 'checkbox'; box.checked = !!feitos[r.k];
    box.onclick = function (ev){
      ev.stopPropagation();
      if (box.checked) feitos[r.k] = 1; else delete feitos[r.k];
      salvaFeitos(); tr.className = box.checked ? 'feito' : ''; contas();
      pinta();          /* o verde e o tique na placa sao este visto, do outro lado da tela */
    };
    cx.appendChild(box);
    td('q', String(r.qtd));
    var refs = td('refs', r.refs.join(', '));
    td('f', r.fp || '—');
    td('v', r.val || '—');
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
/* A lista e o desenho mostram o MESMO visto, em duas linguagens: mexeu num, redesenha o
   outro. O filtro fica de fora de proposito - ele muda a lista, e nao o que esta montado. */
function vistoMudou(){ montaBom(); pinta(); }
/* Onde a camera de um lado teria que estar para mostrar as peças pedidas. DEVOLVE o alvo em
   vez de aplica-lo: entre o de agora e este e que a transicao acontece. Mesma folga do
   zoomToObj da vista PCB (a peça ocupa ~1/1,6 da tela), para quem usa as duas telas ver a
   mesma coisa. */
function alvoDoLado(c, lista){
  var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, achou = false;
  var tresD = c === v3, L = tresD ? ladoV3() : c.lado;
  lista.forEach(function (i){
    var cp = D.comps[i];
    if (!cp || !cp.bb || (cp.s !== L && !cp.t)) return;
    achou = true;
    /* em 3D a caixa da peça e a PROJETADA: a mesma peça ocupa outro retangulo na tela
       conforme o angulo, e mirar pela caixa do mundo erraria o alvo */
    if (tresD){
      var z = L ? -ESP/2 : ESP/2;
      [[cp.bb[0],cp.bb[1]],[cp.bb[2],cp.bb[1]],[cp.bb[2],cp.bb[3]],[cp.bb[0],cp.bb[3]]]
        .forEach(function (q){
          var p = pr3(q[0], q[1], z);
          x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]);
          x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]);
        });
      return;
    }
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
  if (v3.on){
    /* em 3D a "tela" e uma so: se a peça esta na face escondida, vira a placa - senao o
       alvoDoLado nao acha nada, o realce tambem e descartado, e escolher na lista pareceria
       nao fazer nada */
    var precisa = quais.length === 1 ? (quais[0] === '0' ? 0 : 1) : null;
    if (precisa !== null && precisa !== ladoV3() && !lista.some(function (i){
      return D.comps[i] && D.comps[i].t;         /* passante ja aparece dos dois lados */
    })) viraFace3(false);   /* a viagem da camera vem logo em seguida, e o comando e um so */
  }
  else if (quais.length === 1) aplicaLayout(quais[0] === '0' ? 'f' : 'b');
  else if (quais.length > 1 && layoutAtual !== 'lr') aplicaLayout('lr');
  requestAnimationFrame(function (){
    var pares = [];
    (v3.on ? [v3] : cams).forEach(function (c){
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
    /* Shift + roda anda para os lados; c.lado inverte, porque o verso e espelhado */
    if (ev.shiftKey){
      var d = (ev.deltaX || ev.deltaY) * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1);
      c.cx += (c.lado ? -1 : 1) * d / c.esc;
      desenha(c);
      return;
    }
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
  /* a mesma opcao serve de botao na barra (trilhas) e de caixa na gaveta (as outras camadas):
     o estado e um so, e quem le/escreve muda conforme o elemento */
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
  document.getElementById('btRefresh').onclick = function (){ location.reload(); };
  document.getElementById('gavetaFecha').onclick = function (){ abreGaveta(false); };
  gvBg.onclick = function (){ abreGaveta(false); };
  document.addEventListener('keydown', function (ev){
    if (ev.key === 'Escape'){
      if (document.getElementById('modalBg').classList.contains('on')) fechaModal();
      else { fechaMenu3(); abreGaveta(false); }
      return;
    }
    if (!v3.on) return;
    /* quem esta digitando no filtro nao esta dando atalho: "c" ali e a letra c */
    var t = ev.target && ev.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    if ((ev.key === 'f' || ev.key === 'F') && (ev.ctrlKey || ev.metaKey)){
      if (ev.preventDefault) ev.preventDefault();   /* Ctrl+F e a busca do navegador */
      fechaMenu3(); viraFace3();
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === 'c' || ev.key === 'C'){ fechaMenu3(); centra3(); }
  });
  [].forEach.call(document.querySelectorAll('[data-layout]'), function (b){
    b.onclick = function (){
      if (v3.on) poe3D(false);
      aplicaLayout(b.dataset.layout);
    };
  });
  document.getElementById('btFace').onclick = function (){
    if (v3.on) poe3D(false);      /* escolher um layout 2D sai do 3D */
    aplicaLayout(layoutAtual === 'f' ? 'b' : layoutAtual === 'b' ? 'f' : faceAtual);
  };
  v3.cv = document.getElementById('cv3');
  ligaV3();
  /* o quadradinho da frente entra pelo lado de cima; o do verso, olhando por baixo */
  document.getElementById('d3f').onclick = function (){ v3.pitch = Math.abs(v3.pitch); poe3D(true); };
  document.getElementById('d3b').onclick = function (){ v3.pitch = -Math.abs(v3.pitch); poe3D(true); };
  document.getElementById('d3off').onclick = function (){ poe3D(false); };
  [].forEach.call(document.querySelectorAll('[data-m3]'), function (b){
    b.onclick = function (){
      var k = b.dataset.m3;
      if (k === 'pos'){                       /* so desdobra: nao e uma acao */
        var sub = document.getElementById('sub3');
        var abriu = !sub.classList.contains('on');
        sub.classList.toggle('on', abriu);
        b.setAttribute('aria-expanded', String(abriu));
        return;
      }
      fechaMenu3();
      if (k === 'centrar') centra3();
      else if (k === 'esp') viraFace3();      /* mesmo gesto do Ctrl+F: nao tira do lugar */
      else posiciona3(parseInt(k.slice(1), 10));
    };
  });
  /* clicar em qualquer outro lugar fecha o menu, como todo menu de contexto faz */
  document.addEventListener('pointerdown', function (ev){
    var m = document.getElementById('menu3');
    if (m.classList.contains('on') && ev.target !== m && !(ev.target && ev.target.dataset &&
        ev.target.dataset.m3)) fechaMenu3();
  });
  document.getElementById('btFonte').onclick = function (){
    /* cicla nos tres: um botao so, e o gesto e sempre o mesmo */
    fonte = fonte === 'p' ? 'm' : fonte === 'm' ? 'g' : 'p';
    aplicaFonte(); salvaUI();
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
      /* e o verde da placa muda junto: o visto de um grupo nao e o visto de cada peça dele */
      vistoMudou();
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
             function (){ feitos = {}; salvaFeitos({ limpar: true }); vistoMudou(); });
  };
  window.addEventListener('resize', function (){
    aplicaLateral();
    redim(); cams.forEach(function (c){ if (c) ajusta(c); }); pinta();
  });
  montaBom();
  aplicaFonte();
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
    /* Servida por /bom/<id>, a pagina fala com o servidor e os vistos da bancada passam a
       ser COMPARTILHADOS por quem abrir o link. Vazio = pagina sem servidor (aberta de um
       arquivo), e o estado volta para o localStorage de quem esta olhando. */
    api: me.api || '',
    vistos: me.vistos || null,
    rev: me.rev || 0,
    sourceRev: me.sourceRev || '',
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
  const d3bt = id =>
    '<button class="d3" id="' + id + '" title="ver a placa em 3D">3D</button>';
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
  L.push('<button class="t" id="btRefresh" title="buscar alterações no esquema e na PCB">↻ Refresh</button>');
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
  /* Trilhas e a unica camada que se liga e desliga NA bancada - para ver por onde o sinal
     anda antes de soldar - entao ela mora na barra, e nao na gaveta com o que se ajusta uma
     vez e nao se mexe mais. A barrinha antes e depois a separa dos tres layouts: encostada
     neles, um botao que fica aceso seria lido como um quarto jeito de mostrar a placa. */
  L.push(icone('data-ver', 'tracks', 'Trilhas', SVG.trilhas, o.tracks));
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
  L.push('<div class="cv"><span class="lbl">Frente</span>' + d3bt('d3f') + '<canvas id="cv0"></canvas></div>');
  L.push('<div class="cv"><span class="lbl">Verso</span>' + d3bt('d3b') + '<canvas id="cv1"></canvas></div>');
  /* a vista 3D e UMA so: em tres dimensoes nao ha "canvas da frente" e "canvas do verso",
     ha uma placa que se gira */
  L.push('<div class="cv cv3"><span class="lbl">3D — arraste move · botão direito gira</span>' +
         '<button class="d3" id="d3off" title="voltar para 2D">2D</button>' +
         '<canvas id="cv3"></canvas></div>');
  L.push('</div>');
  L.push('<div id="hsplit" title="arraste para redimensionar a lista"></div>');
  /* a busca e o "limpar" moram COM a lista: e nela que se procura, e atravessar a tela ate
     a barra de cima para filtrar era um vai-e-vem sem motivo */
  L.push('<div id="bom">');
  L.push('<div class="bom-bar">' +
         '<input type="search" id="filtro" placeholder="filtrar…">' +
         '<button class="t" id="limpar">Limpar vistos</button>' +
         /* o proprio A cresce a cada clique: o botao MOSTRA o tamanho em que a lista esta,
            em vez de nomea-lo - e o rotulo estaria sempre um passo atras do que se ve */
         '<button class="t fte" id="btFonte" data-fonte="p">A</button></div>');
  /* O # fica na PONTA, do outro lado do visto: encostado na Qtd, dois números seguidos e
     alinhados à direita eram lidos como um so. E os designadores vem primeiro entre os tres
     campos, porque e por eles que se procura a peça na placa - o comentário e o que menos
     serve de busca. */
  L.push('<div id="bomRolo"><table><thead><tr>' +
         '<th>#</th><th></th><th>Qtd</th><th>Designadores</th><th>Footprint</th><th>Comentário</th>' +
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

         '<div class="gv-tit">atalhos da vista 3D</div>' +
         '<div class="gv-ajuda">' +
         '<div><kbd>C</kbd> centralizar a placa</div>' +
         '<div><kbd>Ctrl</kbd>+<kbd>F</kbd> virar a face</div>' +
         '<div>arrastar: mover a vista</div>' +
         '<div>botão direito: girar pelo ponto clicado</div>' +
         '<div>clique direito rápido: menu (posicionar, centralizar)</div>' +
         '<div>roda: aproximar</div>' +
         '</div>' +
         '<div class="gv-tit">aparência</div>' +
         '<label class="gv-item"><input type="checkbox" id="escuro"' +
         (o.dark ? ' checked' : '') + '>Tema escuro</label>' +
         '</aside>');

  L.push('<div id="menu3">' +
         '<button data-m3="centrar">Centralizar</button>' +
         '<button data-m3="pos" class="pai">Posicionar<span>▸</span></button>' +
         '<div id="sub3">' +
         '<button data-m3="p90">90°</button>' +
         '<button data-m3="p180">180°</button>' +
         '<button data-m3="p270">270°</button>' +
         '<button data-m3="esp">Espelhar</button>' +
         '</div></div>');
  L.push('<div id="modalBg"><div class="modal" role="dialog" aria-modal="true">' +
         '<h2 id="modalTit"></h2><p id="modalTxt"></p>' +
         '<div class="acoes"><button class="t" id="modalNao">Não</button>' +
         '<button class="t primario" id="modalSim">Sim</button></div></div></div>');
  /* O aviso de "servidor fora do ar" nasce no HTML, escondido, em vez de ser criado por
     JS: quem esta montando a placa precisa saber na hora que os vistos pararam de ser
     salvos, e todo id que o runtime procura tem que existir no documento. */
  L.push('<div id="semrede" hidden></div>');
  L.push('<script>var D = ' + jsonSeguro(D) + ';</' + 'script>');
  L.push('<script>' + JS + '</' + 'script>');
  L.push('</body></html>');
  return L.join('\n');
}

const sane = s => String(s).replace(/[\\/:*?"<>|]/g, '_');
const filename = proj => sane(proj || 'placa') + '-BOM.html';

/* ---- o link do BOM ----------------------------------------------------------------
   O BOM nao e mais um arquivo que se baixa: cada projeto tem uma URL fixa, /bom/<id>, que
   o servidor monta na hora com ESTE gerador - por isso melhorar o gerador melhora o BOM
   de todos os projetos de uma vez, sem regerar nada.

   Copiar o link grava antes as opcoes da aba, para quem abrir do outro lado da rede ver o
   que quem gerou escolheu. */
const linkDe = projId => '/bom/' + encodeURIComponent(projId || '');

/* O endereco do BOM de REFERENCIA quando ele mora noutro lugar: no app desktop, o do NexoBD
   (1.31.0, hubserver.py » _bom_base_nexobd), que e onde a bancada abre e marca os vistos. null =
   o BOM e deste hub mesmo (o caso do servidor), e vale o linkDe relativo. Sem conferencia
   no servidor (verificar=0): serve para o rodape e o "abrir", que nao podem esperar a rede. */
/* O que o hub diz do link (1.31.0: no app desktop, o do NexoBD): {ok, url, externo, nexobd, error}, ou null se o hub
   nao respondeu. Sem o Nexo Hub conectado vem ok:false com o motivo: o painel avisa em vez de dar um link morto. */
async function linkInfo(projId){
  try {
    const r = await fetch('/api/bom/' + encodeURIComponent(projId || '') + '/link?verificar=0');
    return await r.json();
  } catch (e) { return null; }
}

async function linkRef(projId){
  try {
    const r = await fetch('/api/bom/' + encodeURIComponent(projId || '') + '/link?verificar=0');
    const j = r.ok ? await r.json() : null;
    return j && j.ok && j.externo ? j.url : null;
  } catch (e) { return null; }
}

/* navigator.clipboard existe so em contexto seguro, e o hub aberto pelo IP da rede
   (http://192.168.x.x:8001) NAO e um - que e exatamente o caso de quem abre do tablet.
   Por isso o textarea + execCommand continua aqui: nao e legado, e o caminho principal
   fora do localhost. */
async function paraAreaDeTransferencia(txt){
  try {
    if (navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(txt);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, txt.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) { return false; }
}

async function copiarLink(projId, opts){
  if (!projId) return { ok: false, error: 'sem projeto selecionado' };
  if (!location.protocol.startsWith('http'))
    return { ok: false, error: 'o link precisa do hub servido por hubserver.py, nao por file://' };
  const base = '/api/bom/' + encodeURIComponent(projId);
  if (opts){
    /* as opcoes sao conforto: se a gravacao falhar, o link ainda abre - no padrao */
    try {
      await fetch(base + '/opts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ opts }) });
    } catch (e) {}
  }
  let j = null;
  try {
    const r = await fetch(base + '/link');
    if (r.status === 404)
      return { ok: false, error: 'este servidor nao tem a rota do link - reinicie o hubserver.py' };
    j = await r.json();
  } catch (e) { return { ok: false, error: 'servidor nao respondeu: ' + e.message }; }
  if (!j || !j.ok) return { ok: false, error: (j && j.error) || 'nao consegui montar o link' };
  return { ok: true, url: j.url, copiou: await paraAreaDeTransferencia(j.url), lan: !!j.lan,
           externo: !!j.externo, aviso: j.aviso || '' };
}

/* porta unica da aba: do board.js ao arquivo, num passo */
function gerar(board, opts, meta){
  const m = model(board, opts);
  return { html: html(m, meta), model: m, warnings: m.warnings };
}

return { defaults, model, html, filename, gerar, copiarLink, linkDe, linkRef, linkInfo,
         textoPolys, padGeom, ladoDe, natural, COR };
});
