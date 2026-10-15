/* AltiumPCBMirror - hub-fpeditor.js
   O editor de footprint do hub: o "PCB Library" do Altium (PcbLib aberta) trazido para o hub, no
   tema dele. Abre por cima da vista PCB e da vista Esquema (o mesmo modulo nas duas) e grava na
   biblioteca do hub (hub-fplib.js, Libs/pcblib-hub.js) -- o espelho do Altium nao muda.

   Como no Altium:
     painel PCB Library (esquerda)  a lista de footprints, filtro, Add / Duplicate / Delete
     area de trabalho (centro)      2D com a grade, as camadas Top/Bottom/Multi-Layer/Top Overlay e
                                    o contorno dos corpos 3D; tecla 3 = 3D (o footprint numa placa,
                                    com os corpos), 2 = volta
     Properties (direita)           do objeto selecionado; sem selecao, do footprint (nome,
                                    descricao, e a lista de corpos 3D)
   Teclas (o molde do Altium): P,P pad  P,L linha  P,A arco  P,B corpo 3D (STEP)  P,E corpo extrudado
     Espaco gira 90  Delete apaga  setas andam um passo da grade  Ctrl+Z/Ctrl+Y  Ctrl+A  Ctrl+D duplica
     Q mm/mil  G troca a grade  F (ou V,F) enquadra  Ctrl+S grava  Esc larga a ferramenta (fechar e no X)
   Mouse: clique seleciona (Shift soma), arrastar move, arrastar no vazio = janela, botao direito
   arrasta a tela (sem arrastar: larga a ferramenta), roda aproxima no cursor.

   API (global HubFpEditor)
     HubFpEditor.abre({nome, fp, pcblib, titulo, aoSalvar(fp, lib)}) -> Promise<{salvos:[nomes]}>
       nome    o footprint a abrir (da biblioteca do hub; senao do Altium; senao `fp`)
       fp      geometria de reserva (o footprint tirado do componente na placa)
       pcblib  o espelho do Altium (Libs/pcblib.js) para a lista; sem ele, so os do hub
       host    EMBUTIDO: o editor mora dentro deste elemento (a sub-aba Biblioteca » Footprints do
               hub), sem o fundo escuro por cima da tela; o desenho segue a vista de footprint do
               hub (fundo --sunken, cores do HubDraw). Sem host e o modal de sempre (PCB e Esquema).
       semLista  esconde o painel PCB Library da esquerda (no hub a lista e a galeria da sub-aba)
       fechaTxt  o rotulo do botao de fechar (embutido: "Voltar a galeria")
       botoes  [{txt, titulo, pri, fn(ctrl)}] botoes a mais na barra de titulo (ex.: Aplicar ao
               componente); ctrl = {fp(), sujo(), salvar(), fechar()}
       aoMontar(ctrl)  chamado com o controle assim que o editor existe
*/
(function (root) {
'use strict';

const CSS = `
.fpe-fundo{position:fixed; inset:0; z-index:85; background:rgba(0,0,0,.5); display:flex; padding:10px;}
.fpe{flex:1; min-width:0; display:flex; flex-direction:column; background:var(--surface); color:var(--text);
  border:1px solid var(--edge); border-radius:8px; box-shadow:var(--shadow-menu); overflow:hidden; font:12.5px/1.4 var(--font);}
.fpe button{font:inherit;}
.fpe-tit{flex:none; display:flex; align-items:center; gap:8px; padding:7px 10px; background:var(--surface-2); border-bottom:1px solid var(--edge);}
.fpe-tit b{font-weight:600;}
.fpe-tit .nm{font:12px var(--mono); color:var(--text-2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.fpe-tit .sujo{color:var(--warn);}
.fpe-tit .dir{margin-left:auto; display:flex; gap:6px; align-items:center;}
.fpe-b{height:26px; padding:0 10px; border:1px solid var(--edge); border-radius:5px; background:transparent; color:var(--text); cursor:pointer; white-space:nowrap;}
.fpe-b:hover:not(:disabled){border-color:var(--hi);}
.fpe-b:disabled{opacity:.4; cursor:not-allowed;}
.fpe-b.pri{background:var(--hi); border-color:var(--hi); color:var(--on-hi);}
.fpe-b.peq{height:22px; padding:0 7px; font-size:11.5px;}
.fpe-seg{display:inline-flex; border:1px solid var(--edge); border-radius:5px; overflow:hidden;}
.fpe-seg button{height:24px; padding:0 10px; border:0; background:transparent; color:var(--text-2); cursor:pointer;}
.fpe-seg button.on{background:var(--hi); color:var(--on-hi);}
.fpe-x{width:28px; height:26px; border:0; border-radius:5px; background:transparent; color:var(--text-2); cursor:pointer; font-size:16px;}
.fpe-x:hover{background:rgba(var(--tint),.1); color:var(--text);}
.fpe-corpo{flex:1; min-height:0; display:flex;}
.fpe-lib{flex:none; width:250px; display:flex; flex-direction:column; border-right:1px solid var(--edge); background:var(--surface-2); min-height:0;}
.fpe-lib .cab{padding:8px; display:flex; flex-direction:column; gap:6px; border-bottom:1px solid var(--edge);}
.fpe-lib .cab .t{font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--text-2);}
.fpe-lib input{width:100%; height:26px; padding:0 8px; background:var(--surface); color:var(--text); border:1px solid var(--edge); border-radius:4px;}
.fpe-lib input:focus{outline:none; border-color:var(--hi);}
.fpe-lib .acoes{display:flex; gap:4px; flex-wrap:wrap;}
.fpe-lista{flex:1; overflow:auto; padding:3px 0;}
.fpe-it{display:flex; align-items:center; gap:6px; padding:3px 10px; cursor:pointer; white-space:nowrap; font:12px var(--mono);}
.fpe-it:hover{background:rgba(var(--tint),.07);}
.fpe-it.on{background:rgba(var(--tint),.14); box-shadow:inset 2px 0 0 var(--hi);}
.fpe-it .n{flex:1; overflow:hidden; text-overflow:ellipsis;}
.fpe-it .tag{font:10px var(--font); padding:0 5px; border-radius:8px; background:rgba(var(--tint),.12); color:var(--text-2);}
.fpe-it .tag.hub{background:var(--hi); color:var(--on-hi);}
.fpe-it .tag.d3{background:transparent; border:1px solid var(--edge);}
.fpe-lib .rod{flex:none; padding:5px 10px; font-size:11px; color:var(--text-2); border-top:1px solid var(--edge);}
.fpe-centro{flex:1; min-width:0; display:flex; flex-direction:column;}
.fpe-barra{flex:none; display:flex; align-items:center; gap:2px; padding:4px 6px; border-bottom:1px solid var(--edge); background:var(--surface-2); flex-wrap:wrap;}
.fpe-barra .sep{width:1px; height:20px; background:var(--edge); margin:0 4px;}
.fpe-barra button{height:26px; padding:0 8px; border:1px solid transparent; border-radius:4px; background:transparent; color:var(--text-2); cursor:pointer; display:inline-flex; align-items:center; gap:5px;}
.fpe-barra button:hover{color:var(--text); border-color:var(--edge);}
.fpe-barra button.on{background:var(--hi); border-color:var(--hi); color:var(--on-hi);}
.fpe-barra kbd{font:10px var(--mono); opacity:.7;}
.fpe-barra select{height:24px; background:var(--surface); color:var(--text); border:1px solid var(--edge); border-radius:4px; font-size:11.5px;}
.fpe-vp{flex:1; min-height:0; position:relative; background:#000;}
.fpe-vp canvas.c2{position:absolute; inset:0; width:100%; height:100%; display:block; outline:none;}
.fpe-v3{position:absolute; inset:0;}
.fpe-dica{position:absolute; left:8px; bottom:6px; font:11px var(--mono); color:#9aa; pointer-events:none; text-shadow:0 1px 2px #000;}
.fpe-abas{flex:none; display:flex; height:26px; background:var(--surface-2); border-top:1px solid var(--edge);}
.fpe-abas button{display:inline-flex; align-items:center; gap:6px; padding:0 10px; border:0; border-right:1px solid var(--edge); background:transparent; color:var(--text-2); cursor:pointer; font-size:11.5px;}
.fpe-abas button.on{color:var(--text); font-weight:600; box-shadow:inset 0 -2px 0 var(--cor, var(--hi));}
.fpe-abas .sw{width:10px; height:10px; border-radius:2px;}
.fpe-st{flex:none; height:22px; display:flex; gap:14px; align-items:center; padding:0 10px; font:11.5px var(--mono); color:var(--text-2); background:var(--surface-2); border-top:1px solid var(--edge); white-space:nowrap; overflow:hidden;}
.fpe-st .m{margin-left:auto; color:var(--warn); overflow:hidden; text-overflow:ellipsis;}
.fpe-prop{flex:none; width:300px; border-left:1px solid var(--edge); background:var(--surface-2); overflow:auto;}
.fpe-prop .cab{padding:8px 10px; font-weight:600; border-bottom:1px solid var(--edge); display:flex; align-items:center; gap:6px;}
.fpe-prop .cab .k{font-weight:normal; font-size:11px; color:var(--text-2); margin-left:auto;}
.fpe-sec{border-bottom:1px solid var(--edge);}
.fpe-sec > .st{padding:6px 10px; font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--text-2); background:rgba(var(--tint),.04);}
.fpe-sec > .cx{padding:6px 10px; display:grid; grid-template-columns:100px 1fr; gap:5px 8px; align-items:center;}
.fpe-sec label{color:var(--text-2); font-size:12px;}
.fpe-sec input, .fpe-sec select, .fpe-sec textarea{width:100%; min-width:0; height:24px; padding:0 6px; background:var(--surface); color:var(--text);
  border:1px solid var(--edge); border-radius:4px; font:12px var(--font);}
.fpe-sec textarea{height:54px; padding:4px 6px; font:11.5px var(--mono); resize:vertical;}
.fpe-sec input[type=color]{padding:0 2px;}
.fpe-sec input:focus, .fpe-sec select:focus, .fpe-sec textarea:focus{outline:none; border-color:var(--hi);}
.fpe-sec .lin{grid-column:1 / -1; display:flex; gap:5px; flex-wrap:wrap;}
.fpe-sec .nota{grid-column:1 / -1; font-size:11px; color:var(--text-2);}
.fpe-corpos .c{display:flex; align-items:center; gap:6px; padding:4px 10px; cursor:pointer;}
.fpe-corpos .c:hover{background:rgba(var(--tint),.07);}
.fpe-corpos .c .sw{width:12px; height:12px; border-radius:3px; flex:none;}
.fpe-corpos .c .n{flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.fpe-corpos .vazio{padding:6px 10px; color:var(--text-2); font-size:11.5px;}
.fpe-menu{position:fixed; z-index:95; min-width:190px; padding:4px; background:var(--surface-2); border:1px solid var(--edge); border-radius:6px; box-shadow:var(--shadow-menu);}
.fpe-menu button{display:flex; width:100%; gap:8px; padding:5px 8px; border:0; border-radius:4px; background:transparent; color:var(--text); text-align:left; cursor:pointer; font-size:12px;}
.fpe-menu button:hover{background:rgba(var(--tint),.09);}
.fpe-menu kbd{margin-left:auto; font:10.5px var(--mono); color:var(--text-2);}
/* EMBUTIDO na sub-aba Footprints da Biblioteca: ocupa o corpo da vista, sem moldura de janela */
.fpe-embut{display:flex; flex:1; min-height:0; min-width:0;}
.fpe-embut[hidden]{display:none !important;}
.fpe-lib[hidden]{display:none !important;}
.fpe-embut > .fpe{min-width:0; max-width:100%;}
.fpe-embut .fpe-tit{flex-wrap:wrap; row-gap:4px;}
.fpe-embut .fpe-tit .dir{flex-wrap:wrap; justify-content:flex-end;}
.fpe-embut .fpe-prop{width:270px;}
/* LAYOUT HUB (Biblioteca » Footprints): a grade e as pecas sao as do editor de simbolos
   (hub.html: .symed-grid, .lib-left, .symed-mid, .symed-toolbox, .symed-ib); aqui so o que e do
   footprint -- o fundo escuro do desenho e a ficha no tom do aside */
.fpe-hub > .fpe-hubbox{flex:1; min-width:0; display:block;}
.fpe-hubbox .fpe-grid{height:100%;}
.fpe-hubbox .symed-mid{grid-template-rows:auto minmax(0,1fr) auto auto;}
.fpe-hubbox .fpe-vp{position:relative; background:var(--sunken,#1b1b1b); border-radius:var(--r-md,6px); overflow:hidden;}
.fpe-hubbox .fpe-vazio{color:var(--text-3);}
.fpe-hubbox .fpe-vazio[hidden]{display:none;}
.fpe-hubbox .fpe-abas{margin:2px 12px 0; height:24px; background:transparent; border-top:0;}
.fpe-hubbox .fpe-abas button{border-right:0; border-radius:var(--r-sm,4px);}
.fpe-hubbox .symed-foot .m{color:var(--warn);}
.fpe-hubbox .fpe-seg2 button{padding:2px 9px;}
.fpe-hubbox .symed-hist{display:flex; align-items:center;}
.fpe-hubbox .symed-name .sujo{color:var(--warn);}
.fpe-lista-hub .fpe-row canvas{flex:none; width:54px; height:36px; border-radius:3px; background:var(--sunken,#14161a);}
.fpe-lista-hub .fpe-row .pill.hub{color:var(--hi);}
.fpe-aside .symed-toolbox .symed-tb + .symed-tb{margin-top:4px;}
.fpe-prop-hub{width:auto; border:0; background:transparent; overflow:visible;}
.fpe-prop-hub .cab{padding:2px 0 4px; border:0; font-size:10px; letter-spacing:.1em; text-transform:uppercase; font-weight:normal; color:var(--text-3);}
.fpe-prop-hub .cab .k{text-transform:none; letter-spacing:0;}
.fpe-prop-hub .fpe-ajuda{font-size:12px; line-height:1.5; color:var(--text-2); margin:6px 0 0;}
.fpe-aside .fpe-esconde{display:none !important;}
.fpe-prop-hub .cab .k{font-size:12px; color:var(--text-3);}
.fpe-prop-hub .fpe-sec{border:0;}
.fpe-prop-hub .fpe-sec > .st{padding:10px 0 4px; background:transparent; font-size:10px; letter-spacing:.1em; color:var(--text-3);}
.fpe-prop-hub .fpe-sec > .cx{padding:2px 0; grid-template-columns:96px minmax(0,1fr);}
.fpe-prop-hub .fpe-sec label{font-size:11px; color:var(--text-3);}
.fpe-prop-hub .fpe-sec input, .fpe-prop-hub .fpe-sec select{min-height:26px; height:26px; border-color:var(--line,var(--edge)); border-radius:var(--r-sm,4px);}
.fpe-prop-hub .fpe-corpos .c{padding:4px 0;}
.fpe-prop-hub .fpe-corpos .vazio{padding:4px 0; font-size:12px;}
.fpe-prop-hub .fpe-corpos > div[style]{padding:6px 0 4px !important;}
.fpe-acoes-hub{display:flex; flex-wrap:wrap; gap:6px; margin-top:2px;}
.fpe-embut > .fpe{border:0; border-radius:0; box-shadow:none;}
.fpe-embut .fpe-vp{background:var(--sunken, #1b1b1b);}
.fpe-embut .fpe-x{width:auto; padding:0 10px; font-size:12px; border:1px solid var(--edge);}
`;

/* as cores das camadas sao as de fabrica do Altium (o desenho nao segue o tema, como a vista PCB) */
const CORES = { fundo:'#000000', grade:'#1f1f1f', gradeF:'#333333', Top:'#ff0000', Bottom:'#0000ff', Multi:'#c0c0c0',
              furo:'#3a3a3a', silk:'#ffff00', corpo:'#00c8d2', sel:'#ffffff', origem:'#ffffff', janela:'#3d8bff' };
const CAMADAS = [['Top', 'Top Layer'], ['Bottom', 'Bottom Layer'], ['Multi', 'Multi-Layer'], ['TopOverlay', 'Top Overlay'], ['Corpo', 'Mechanical (3D)']];
const GRADES = [[0.01, '0.01 mm'], [0.05, '0.05 mm'], [0.1, '0.1 mm'], [0.25, '0.25 mm'], [0.5, '0.5 mm'], [1, '1 mm'],
                [0.127, '5 mil'], [0.254, '10 mil'], [0.635, '25 mil'], [1.27, '50 mil'], [2.54, '100 mil']];
const FORMAS = [['rect', 'Rectangular'], ['roundrect', 'Rounded Rectangle'], ['circle', 'Round'], ['oval', 'Oval'], ['octagon', 'Octagonal']];
const MIL = 0.0254, RAD = Math.PI / 180;
const isNum = v => typeof v === 'number' && isFinite(v);
const r4 = v => { const x = Math.round(v * 1e4) / 1e4; return x === 0 ? 0 : x; };
function el(tag, cls, txt){ const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function bt(cls, txt, fn, titulo){ const b = el('button', cls, txt); b.type = 'button'; if (fn) b.addEventListener('click', fn); if (titulo) b.title = titulo; return b; }
const dlg = () => (typeof HubDialog !== 'undefined' ? HubDialog : null);
const toast = (m, k, ms) => { const d = dlg(); if (d) d.toast(m, k || 'info', ms || 2400); };

function corDoHub(){
  const tk = n => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); } catch (e) { return ; } };
  const P = (root.HubDraw && root.HubDraw.PCB) || {};
  return Object.assign({}, CORES, { fundo:tk('--sunken') || P.bg || '#1b1b1b', grade:'rgba(255,255,255,0.06)', gradeF:'rgba(255,255,255,0.13)',
    Top:P.Top || CORES.Top, Bottom:P.Bottom || CORES.Bottom, Multi:P.Multi || CORES.Multi, silk:P.TopOverlay || CORES.silk,
    janela:tk('--hi') || CORES.janela });
}

/* os icones da caixa FERRAMENTAS (layout hub): 16 px, traco na cor do texto, como os do
   editor de simbolos */
const svgI = (d, cheio) => '<svg width="16" height="16" viewBox="0 0 16 16" fill="' + (cheio ? 'currentColor' : 'none') +
  '" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>';
const ICONES = {
  sel:svgI('M3.5 2l8.5 5-3.8 1.1L6.4 13z'), pad:svgI('M4 4h8v8H4z', true), linha:svgI('M3 13L13 3'),
  arco:svgI('M3 13a10 10 0 0 1 10-10'), step:svgI('M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7zM2.5 4.5L8 7.5l5.5-3M8 7.5v7'),
  extrude:svgI('M2.5 6h8v7.5h-8zM2.5 6l3-3h8l-3 3M13.5 3v7.5l-3 3'),
  cyl:svgI('M3 4a5 2 0 1 0 10 0a5 2 0 1 0-10 0M3 4v8a5 2 0 0 0 10 0V4'),
  del:svgI('M3 4.5h10M6 4.5V2.5h4v2M4.5 4.5l.7 9h5.6l.7-9'), rot:svgI('M13 8a5 5 0 1 1-1.5-3.6M12.5 1.8v3h-3'),
  dup:svgI('M5.5 5.5h8v8h-8zM3 10.5V2.5h8'), fit:svgI('M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4'),
  undo:svgI('M6 4L2.5 7.5 6 11M3 7.5h7a3.5 3.5 0 0 1 0 7H8'), redo:svgI('M10 4l3.5 3.5L10 11M13 7.5H6a3.5 3.5 0 0 0 0 7h2'),
};

let cssPosto = false;
function poeCss(){ if (cssPosto) return; cssPosto = true; const s = el('style'); s.textContent = CSS; document.head.append(s); }

/* ======================================================================================== */
function abre(opcoes){
  const o = opcoes || {};
  poeCss();
  return new Promise(resolve => { inicia(o, resolve); });
}

async function inicia(o, resolve){
  const HF = root.HubFpLib;
  const embutido = !!(o.host && o.host.nodeType === 1);
  /* embutido, o desenho e o da vista de footprint do hub (hub.html » libFpCv): fundo --sunken e
     as camadas do HubDraw; no modal fica o preto de fabrica do Altium, como a vista PCB */
  const COR = embutido ? corDoHub() : CORES;
  const lib = HF ? await HF.carrega() : { footprints:[], models:{} };
  const alt = o.pcblib || root.pcblib || { footprints:[] };
  const salvos = [];

  /* ---------- estado ---------- */
  const E = {
    fp:null, nome0:'', deHub:false, sujo:false, sel:new Set(), tool:'sel', modo:'2d',
    view:{ s:30, cx:0, cy:0 }, grade:0.1, unid:'mm', cam:'Top', undo:[], redo:[],
    draft:null, arr:null, janela:null, mouse:null, padModelo:{ type:'smd', shape:'rect', w:1.5, h:1, drill:0.9, layer:'Top', rot:0 },
    linhaW:0.2, filtro:'', v3:null, prefixo:null, bbStep:new Map(),
  };
  try { const g = parseFloat(localStorage.getItem('altiumhub.fpe.grade')); if (g > 0) E.grade = g; if (localStorage.getItem('altiumhub.fpe.unid') === 'mil') E.unid = 'mil'; } catch (e) { /* sem storage */ }

  /* ---------- DOM ---------- */
  /* DOIS LAYOUTS. O de sempre (modal da PCB e do Esquema, o "PCB Library" do Altium: lista a
     esquerda, barra de ferramentas em cima, Properties a direita) e o HUB, o da Biblioteca »
     Footprints: o MESMO molde da vista Simbolos (hub-symed.js) -- busca e "+ Novo footprint" no
     topo da coluna da esquerda com a lista (miniatura + nome), o editor no meio com desfazer e
     refazer no canto da barra e unidade/grade no rodape, e a direita a caixa FERRAMENTAS de
     botoes-icone com a ficha embaixo. Pedido do dono, 2026-10-14: "deixe todas as abas
     identicas a aba de simbolo em questao de layout, inclusive o footprints". As classes sao
     as do hub.html (symed-grid, lib-left, symed-mid, symed-ib...), nao copias delas. */
  const HUB = embutido && o.layout === 'hub';
  const fundo = el('div', embutido ? 'fpe-embut' + (HUB ? ' fpe-hub' : '') : 'fpe-fundo');
  const caixa = el('div', HUB ? 'fpe-hubbox' : 'fpe'); fundo.append(caixa);
  const tNome = el('span', HUB ? 'meta symed-name' : 'nm');
  const b2 = bt('', '2D', () => modo('2d'), 'Modo 2D (2)'), b3 = bt('', '3D', () => modo('3d'), 'Modo 3D (3)');
  const bSalvar = bt(HUB ? 'btn btn-primary' : 'fpe-b pri', 'Salvar', () => salvar(), 'Grava na biblioteca do hub (Ctrl+S)');
  const bSalvarComo = bt(HUB ? 'btn btn-secondary' : 'fpe-b', 'Salvar como…', () => salvarComo());
  const bFecha = bt('fpe-x', o.fechaTxt || '✕', () => fechar(), embutido ? 'Fecha o editor' : 'Fechar');
  const ctrl = { fp:() => E.fp, sujo:() => E.sujo, salvar:n => salvar(n), fechar:f => fechar(f), podeSair:() => podeSair(),
                 carregaFp:(n, reserva) => carregaFp(n, reserva), novo:() => novoFp(), modo:m => modo(m), host:o.host || null,
                 atualiza:() => { titulo(); status(); }, lib:() => lib, recarregaLista:() => { listaChave = ''; montaLista(); } };
  const bExtras = [];
  for (const x of (o.botoes || [])) {
    if (!x || !x.txt) continue;
    const b = bt((HUB ? 'btn' : 'fpe-b') + (x.pri ? (HUB ? ' btn-primary' : ' pri') : ''), x.txt, () => x.fn && x.fn(ctrl), x.titulo || '');
    b._x = x; bExtras.push(b);
  }
  const busca = el('input', HUB ? 'input' : null); busca.type = 'text';
  busca.placeholder = HUB ? 'filtrar footprints (nome)' : 'Mask (filtrar footprints)';
  const lista = el('div', HUB ? 'scroll lib-list fpe-lista-hub' : 'fpe-lista');
  const plRod = el('div', HUB ? 'lib-sum' : 'rod');
  const barra = el('div', HUB ? 'symed-toolbox' : 'fpe-barra');
  const vp = el('div', HUB ? 'viewport fpe-vp' : 'fpe-vp');
  const cv = el('canvas', 'c2'); cv.tabIndex = 0;
  const v3host = el('div', 'fpe-v3'); v3host.hidden = true;
  const dica = el('div', 'fpe-dica');
  const vazioHint = el('div', 'hint fpe-vazio', 'escolha um footprint à esquerda, ou crie um com "+ Novo footprint"'); vazioHint.hidden = true;
  vp.append(cv, v3host, dica, vazioHint);
  const abas = el('div', 'fpe-abas');
  const st = el('div', HUB ? 'symed-foot' : 'fpe-st');
  const stXY = el('span'), stGrade = el('span'), stCont = el('span'), stMsg = el('span', 'm');
  const pr = el('div', HUB ? 'fpe-prop fpe-prop-hub' : 'fpe-prop');
  const arquivo = el('input'); arquivo.type = 'file'; arquivo.accept = '.step,.stp,.STEP,.STP'; arquivo.hidden = true;
  let uSel = null, gSel = null, bUndo = null, bRedo = null;
  if (!HUB) {
    const tit = el('div', 'fpe-tit');
    const seg = el('div', 'fpe-seg'); seg.append(b2, b3);
    const dir = el('div', 'dir'); dir.append(seg, bSalvarComo, bSalvar, ...bExtras, bFecha);
    tit.append(el('b', null, o.titulo || 'PCB Library'), tNome, dir);
    const corpo = el('div', 'fpe-corpo');
    const pl = el('div', 'fpe-lib');
    const plCab = el('div', 'cab');
    const acoes = el('div', 'acoes');
    acoes.append(bt('fpe-b peq', 'Add', () => novoFp(), 'Novo footprint vazio'),
                 bt('fpe-b peq', 'Duplicate', () => duplicarFp(), 'Cópia do footprint aberto, com outro nome'),
                 bt('fpe-b peq', 'Delete', () => apagarFp(), 'Apaga da biblioteca do hub (o do Altium volta a valer)'));
    plCab.append(el('div', 't', 'Footprints'), busca, acoes);
    pl.append(plCab, lista, plRod);
    const centro = el('div', 'fpe-centro');
    st.append(stXY, stGrade, stCont, stMsg);
    centro.append(barra, vp, abas, st);
    if (o.semLista) pl.hidden = true;
    corpo.append(pl, centro, pr);
    caixa.append(tit, corpo, arquivo);
  } else {
    const grid = el('div', 'symed-grid fpe-grid');
    /* esquerda: busca e "+ Novo footprint" · kicker · resumo · lista */
    const left = el('div', 'lib-left');
    const bar = el('div', 'lib-bar');
    bar.append(busca, bt('btn btn-primary btn-sm', '+ Novo footprint', () => novoFp(), 'desenha um footprint novo: pads, serigrafia e corpo 3D (STEP)'));
    left.append(bar, el('div', 'kicker symed-kicker', 'footprints · biblioteca de footprints'), plRod, lista);
    /* meio: barra (editor · nome · 2D/3D · desfazer/refazer) · canvas · camadas · rodape */
    const mid = el('div', 'symed-mid');
    const cb = el('div', 'canvas-bar');
    const hist = el('div', 'right symed-hist');
    const seg = el('div', 'seg fpe-seg2'); seg.append(b2, b3);
    bUndo = ibt('undo', 'Desfazer (Ctrl+Z)', () => volta(E.undo, E.redo));
    bRedo = ibt('redo', 'Refazer (Ctrl+Y)', () => volta(E.redo, E.undo));
    hist.append(seg, bUndo, bRedo);
    cb.append(el('span', 'ttl', 'editor'), tNome, hist);
    const fr = el('div', 'right');
    uSel = el('select', 'input'); uSel.title = 'unidade (Q)';
    for (const u of ['mm', 'mil']) { const op = el('option', null, u); op.value = u; uSel.append(op); }
    uSel.addEventListener('change', () => { if (uSel.value !== E.unid) trocaUnid(); });
    gSel = el('select', 'input'); gSel.title = 'grade (G)';
    for (const [v, r] of GRADES) { const op = el('option', null, r); op.value = String(v); gSel.append(op); }
    gSel.addEventListener('change', () => { E.grade = +gSel.value; gravaPref(); pede(); status(); });
    fr.append(el('span', null, 'unidade'), uSel, el('span', null, 'grade'), gSel);
    st.append(stXY, stCont, stMsg, fr);
    mid.append(cb, vp, abas, st);
    /* direita: FERRAMENTAS (montaBarra) · a ficha · salvar */
    const aside = el('aside', 'symed-aside fpe-aside');
    const sv = el('div', 'symed-save');
    sv.append(bSalvar, bSalvarComo);
    const ac = el('div', 'fpe-acoes-hub');
    ac.append(bt('btn btn-secondary btn-sm', 'Duplicar…', () => duplicarFp(), 'cópia do footprint aberto, com outro nome'),
              bt('btn btn-secondary btn-sm', 'Apagar', () => apagarFp(), 'apaga da biblioteca do hub (o do Altium com o mesmo nome volta a valer)'),
              ...bExtras);
    aside.append(barra, pr, sv, ac);
    const split = l => { const s = el('div', 'split'); s.dataset.split = l; return s; };
    grid.append(left, split('l'), mid, split('r'), aside);
    caixa.append(grid, arquivo);
  }
  (embutido ? o.host : document.body).append(fundo);

  /* ---------- barra de ferramentas ---------- */
  const FERR = [
    ['sel', 'Selecionar', 'Esc'], ['pad', 'Pad', 'P,P'], ['linha', 'Linha', 'P,L'], ['arco', 'Arco', 'P,A'],
  ];
  const bTool = {};
  function ibt(ic, titulo, fn){
    const b = el('button', 'symed-ib'); b.type = 'button'; b.title = titulo; b.addEventListener('click', fn);
    b.innerHTML = ICONES[ic] || ''; return b;
  }
  function montaBarra(){
    barra.textContent = '';
    if (HUB) {
      barra.append(el('div', 'kicker', 'ferramentas'));
      const tb = el('div', 'symed-tb');
      for (const [id, rot, k] of FERR) {
        const b = ibt(id, rot + ' (' + k + ')', () => ferramenta(id));
        b.setAttribute('aria-pressed', String(E.tool === id)); bTool[id] = b; tb.append(b);
      }
      tb.append(ibt('step', 'Corpo 3D: o modelo STEP do fabricante (P,B)', () => poeStep()),
                ibt('extrude', 'Corpo 3D extrudado: uma caixa com o contorno dos pads (P,E)', () => poeCorpo('extruded')),
                ibt('cyl', 'Corpo 3D cilíndrico (capacitor eletrolítico, LED)', () => poeCorpo('cylinder')),
                ibt('del', 'Apagar a seleção (Delete)', () => apaga()));
      const tb2 = el('div', 'symed-tb');
      tb2.append(ibt('rot', 'Girar a seleção 90° (Espaço)', () => gira90()),
                 ibt('dup', 'Duplicar a seleção (Ctrl+D)', () => duplica()),
                 ibt('fit', 'Enquadrar (F)', () => enquadra()));
      barra.append(tb, tb2);
      if (uSel) uSel.value = E.unid;
      if (gSel) { const g = GRADES.find(x => Math.abs(x[0] - E.grade) < 1e-9); gSel.value = g ? String(g[0]) : String(E.grade); }
      return;
    }
    for (const [id, rot, k] of FERR) {
      const b = bt(E.tool === id ? 'on' : '', '', () => ferramenta(id), rot + ' (' + k + ')');
      b.append(document.createTextNode(rot), el('kbd', null, k));
      bTool[id] = b; barra.append(b);
    }
    barra.append(el('span', 'sep'));
    const b3d = bt('', '', () => poeStep(), 'Place » 3D Body: um modelo STEP preso ao footprint (P,B)');
    b3d.append(document.createTextNode('3D Body (STEP)'), el('kbd', null, 'P,B'));
    const bEx = bt('', '', () => poeCorpo('extruded'), 'Place » Extruded 3D Body: uma caixa com o contorno dos pads (P,E)');
    bEx.append(document.createTextNode('Extruded'), el('kbd', null, 'P,E'));
    barra.append(b3d, bEx, bt('', 'Cylinder', () => poeCorpo('cylinder'), 'Corpo 3D cilíndrico (capacitor eletrolítico, LED)'));
    barra.append(el('span', 'sep'));
    const sg = el('select'); sg.title = 'Grade (G)';
    for (const [v, r] of GRADES) { const op = el('option', null, r); op.value = String(v); if (Math.abs(v - E.grade) < 1e-9) op.selected = true; sg.append(op); }
    sg.addEventListener('change', () => { E.grade = +sg.value; gravaPref(); pede(); status(); });
    barra.append(sg);
    barra.append(bt('', E.unid === 'mm' ? 'mm' : 'mil', () => trocaUnid(), 'Unidade (Q)'));
    barra.append(bt('', 'Enquadrar', () => enquadra(), 'View » Fit Document (F)'));
  }
  function gravaPref(){ try { localStorage.setItem('altiumhub.fpe.grade', String(E.grade)); localStorage.setItem('altiumhub.fpe.unid', E.unid); } catch (e) { /* ok */ } }
  function trocaUnid(){ E.unid = E.unid === 'mm' ? 'mil' : 'mm'; gravaPref(); montaBarra(); props(); status(); }
  function montaAbas(){
    abas.textContent = '';
    for (const [k, n] of CAMADAS) {
      const b = bt(E.cam === k ? 'on' : '', '', () => { E.cam = k; if (E.padModelo && (k === 'Top' || k === 'Bottom')) E.padModelo.layer = k; montaAbas(); });
      const sw = el('span', 'sw'); sw.style.background = k === 'TopOverlay' ? COR.silk : k === 'Corpo' ? COR.corpo : COR[k];
      b.style.setProperty('--cor', sw.style.background);
      b.append(sw, document.createTextNode(n)); abas.append(b);
    }
  }

  /* ---------- unidade ---------- */
  const mostra = v => isNum(v) ? (E.unid === 'mil' ? String(r4(v / MIL)) : String(r4(v))) : '';
  const fmt = v => isNum(v) ? (E.unid === 'mil' ? r4(v / MIL) + 'mil' : r4(v) + 'mm') : '—';
  function le(txt){
    const s = String(txt || '').trim().toLowerCase().replace(',', '.');
    const m = s.match(/^(-?[\d.]+)\s*(mm|mil)?$/);
    if (!m) return NaN;
    const v = parseFloat(m[1]);
    const u = m[2] || E.unid;
    return u === 'mil' ? r4(v * MIL) : r4(v);
  }

  /* ---------- carregar um footprint ---------- */
  const acharAlt = nome => ((alt.footprints) || []).find(f => f && f.name === nome) || null;
  function carregaFp(nome, reserva){
    const h = HF ? HF.acha(lib, nome) : null;
    const a = h ? null : acharAlt(nome);
    const fonte = h || a || reserva || null;
    E.fp = fonte ? JSON.parse(JSON.stringify(fonte)) : { name:nome || 'NOVO_FOOTPRINT', description:'', pads:[], silk:[], bodies:[] };
    if (!E.fp.name) E.fp.name = nome || 'NOVO_FOOTPRINT';
    for (const k of ['pads', 'silk', 'bodies']) if (!Array.isArray(E.fp[k])) E.fp[k] = [];
    E.nome0 = E.fp.name; E.deHub = !!h;
    /* no layout hub o editor nasce sem nada aberto, como o de simbolos: a dica no canvas pede
       para escolher na lista ou criar. Desenhar ali mesmo vira um footprint novo. */
    E.vazio = HUB && !fonte;
    E.sel.clear(); E.undo = []; E.redo = []; E.sujo = !h && !a && !!reserva;
    E.bbStep.clear();
    for (const b of E.fp.bodies) if (b && b.kind === 'step') medeStep(b);
    titulo(); montaLista(); props(); enquadra(); status(); if (E.modo === '3d') cena3d();
  }
  function titulo(){
    tNome.textContent = '';
    if (HUB) {
      if (E.vazio) { tNome.textContent = '—'; return; }
      tNome.append(document.createTextNode(E.fp.name + (E.deHub ? ' · biblioteca do hub' : acharAlt(E.fp.name) ? ' · do Altium (salvar cria a cópia do hub)' : ' · novo')));
      if (E.sujo) tNome.append(el('span', 'sujo', '  ● não salvo'));
      return;
    }
    tNome.append(document.createTextNode(E.fp.name + (E.deHub ? ' — biblioteca do hub' : acharAlt(E.fp.name) ? ' — do Altium (salvar cria a cópia do hub)' : ' — novo')));
    if (E.sujo) tNome.append(el('span', 'sujo', '  ● não salvo'));
  }

  /* ---------- lista da biblioteca ---------- */
  let listaChave = '', listaIO = null, listaFiltro = null;
  const geoDe = n => (HF && HF.acha(lib, n)) || acharAlt(n);
  /* a miniatura da linha (54x36, como a da lista de simbolos), no fundo escuro do footprint */
  function desenhaMini(c, fp){
    const DPR = window.devicePixelRatio || 1, W = 54 * DPR, H = 36 * DPR;
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = COR.fundo; x.fillRect(0, 0, W, H);
    if (!fp || !root.HubDraw) return;
    const bb = fp.bbox || (HF ? HF.bbox(fp) : null); if (!bb) return;
    const w = Math.max(bb.x2 - bb.x1, 0.1), h = Math.max(bb.y2 - bb.y1, 0.1);
    const k = Math.min(W / (w * 1.25), H / (h * 1.25));
    x.setTransform(k, 0, 0, -k, W / 2 - k * (bb.x1 + bb.x2) / 2, H / 2 + k * (bb.y1 + bb.y2) / 2);
    try { root.HubDraw.drawFootprint(x, fp, { showPadNames:false }); } catch (e) { /* miniatura vazia */ }
  }
  function marcaLinha(){
    for (const b of lista.querySelectorAll('.fpe-row')) b.setAttribute('aria-selected', String(!E.vazio && !!E.fp && b.dataset.n === E.fp.name));
  }
  function montaListaHub(it, q){
    const hubs = lib.footprints || [];
    const chave = [q, it.length, hubs.map(f => f.name + ':' + (f.pads || []).length + ':' + (f.bodies || []).length).join('|')].join('§');
    if (chave === listaChave) { marcaLinha(); return; }
    listaChave = chave;
    const total = new Set([...hubs.map(f => f.name), ...((alt.footprints) || []).filter(Boolean).map(f => f.name)]).size;
    plRod.textContent = '';
    const stat = (n, r) => { const sp = el('span'); sp.append(el('b', null, String(n)), document.createTextNode(' ' + r)); plRod.append(sp); };
    stat(total, 'footprints'); stat(hubs.length, 'do hub'); stat(hubs.filter(f => (f.bodies || []).length).length, 'com modelo 3D');
    const topo = listaFiltro === q ? lista.scrollTop : 0;
    listaFiltro = q;
    if (listaIO) listaIO.disconnect();
    listaIO = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { desenhaMini(e.target, geoDe(e.target._n)); listaIO.unobserve(e.target); } }, { root:lista, rootMargin:'160px' })
      : null;
    lista.textContent = '';
    const frag = document.createDocumentFragment();
    frag.append(el('div', 'lib-head', it.length ? 'footprints (' + it.length + (it.length !== total ? ' de ' + total : '') + ')'
                                                : (q ? 'nada com "' + E.filtro.trim() + '"' : 'biblioteca vazia')));
    const pend = [];
    for (const [n, i] of it) {
      const g = geoDe(n);
      const b = el('button', 'lib-row symed-librow fpe-row'); b.type = 'button'; b.dataset.n = n;
      const c = el('canvas'); c.width = 54; c.height = 36; c._n = n;
      b.append(c, el('span', 'nm', n));
      if (i.hub) b.append(el('span', 'pill hub', i.d3 ? 'hub · 3D' : 'hub'));
      b.append(el('span', 'mt', ((g && g.pads) || []).length + ' pads'));
      b.title = n + (g && g.description ? '\n' + g.description : '') + (i.hub ? '\nbiblioteca do hub (Libs/pcblib-hub.js)' : '\nPcbLib do Altium (Libs/pcblib.js)');
      b.addEventListener('click', () => trocaPara(n));
      frag.append(b); pend.push(c);
    }
    lista.append(frag);
    for (const c of pend) { if (listaIO) listaIO.observe(c); else desenhaMini(c, geoDe(c._n)); }
    if (topo) lista.scrollTop = topo;
    marcaLinha();
  }
  function montaLista(){
    const q = E.filtro.trim().toLowerCase();
    const nomes = new Map();
    for (const f of (lib.footprints || [])) if (f && f.name) nomes.set(f.name, { hub:true, d3:(f.bodies || []).length > 0 });
    for (const f of (alt.footprints || [])) if (f && f.name && !nomes.has(f.name)) nomes.set(f.name, { hub:false, d3:false });
    const it = [...nomes].filter(([n]) => !q || n.toLowerCase().indexOf(q) >= 0).sort((a, b) => (b[1].hub - a[1].hub) || a[0].localeCompare(b[0]));
    if (HUB) return montaListaHub(it, q);
    lista.textContent = '';
    const MAX = 400;
    for (const [n, i] of it.slice(0, MAX)) {
      const d = el('div', 'fpe-it' + (E.fp && n === E.fp.name ? ' on' : ''));
      d.append(el('span', 'n', n));
      if (i.d3) d.append(el('span', 'tag d3', '3D'));
      if (i.hub) d.append(el('span', 'tag hub', 'hub'));
      d.title = n + (i.hub ? '\nna biblioteca do hub' : '\ndo Altium (Libs/pcblib.js)');
      d.addEventListener('click', () => trocaPara(n));
      lista.append(d);
    }
    plRod.textContent = it.length + ' footprint(s)' + (it.length > MAX ? ' — refine o filtro (mostrando ' + MAX + ')' : '') +
      ' · ' + (lib.footprints || []).length + ' no hub';
  }
  busca.addEventListener('input', () => { E.filtro = busca.value; montaLista(); });
  async function podeSair(){
    if (!E.sujo) return true;
    const d = dlg();
    return d ? d.confirm('O footprint "' + E.fp.name + '" tem alterações não salvas. Descartar?', { title:'PCB Library', ok:'Descartar', danger:true }) : true;
  }
  async function trocaPara(nome){
    if (E.fp && nome === E.fp.name && !E.sujo) return;
    if (!(await podeSair())) return;
    carregaFp(nome);
  }
  async function pedeNome(sugestao, titulo){
    /* sem prompt() nativo: um campo no proprio painel */
    return new Promise(ok => {
      const d = el('div', 'fpe-menu');
      d.style.left = '50%'; d.style.top = '30%'; d.style.transform = 'translateX(-50%)'; d.style.padding = '10px'; d.style.width = '320px';
      const t = el('div', null, titulo); t.style.marginBottom = '6px'; t.style.fontWeight = '600';
      const i = el('input'); i.value = sugestao; i.style.cssText = 'width:100%;height:26px;padding:0 8px;background:var(--surface);color:var(--text);border:1px solid var(--hi);border-radius:4px;font:12px var(--mono);';
      const l = el('div'); l.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;margin-top:8px;';
      const fim = v => { d.remove(); document.removeEventListener('keydown', tk, true); ok(v); };
      const tk = e => { if (e.target !== i) return; e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); fim(i.value.trim() || null); } else if (e.key === 'Escape') { e.preventDefault(); fim(null); } };
      l.append(bt('fpe-b', 'Cancelar', () => fim(null)), bt('fpe-b pri', 'OK', () => fim(i.value.trim() || null)));
      d.append(t, i, l); fundo.append(d);
      document.addEventListener('keydown', tk, true);
      i.focus(); i.select();
    });
  }
  const existe = n => !!((HF && HF.acha(lib, n)) || acharAlt(n));
  async function novoFp(){
    if (!(await podeSair())) return;
    let n = 'NOVO_FOOTPRINT', k = 1;
    while (existe(n)) n = 'NOVO_FOOTPRINT_' + (++k);
    const nome = await pedeNome(n, 'Nome do footprint novo');
    if (!nome) return;
    if (existe(nome)) { toast('já existe um footprint "' + nome + '"', 'warn'); return; }
    carregaFp(null, { name:nome, description:'', pads:[], silk:[], bodies:[] });
    E.fp.name = nome; E.nome0 = nome; E.sujo = true; titulo();
  }
  async function duplicarFp(){
    let n = E.fp.name + '_COPIA', k = 1;
    while (existe(n)) n = E.fp.name + '_COPIA' + (++k);
    const nome = await pedeNome(n, 'Nome da cópia');
    if (!nome) return;
    if (existe(nome)) { toast('já existe um footprint "' + nome + '"', 'warn'); return; }
    const c = JSON.parse(JSON.stringify(E.fp)); c.name = nome; delete c.hub;
    E.fp = c; E.nome0 = nome; E.deHub = false; E.sujo = true; E.sel.clear();
    titulo(); montaLista(); props(); status();
  }
  async function apagarFp(){
    if (!HF || !HF.acha(lib, E.fp.name)) { toast('só o que está na biblioteca do hub pode ser apagado — os do Altium vêm do Libs/pcblib.js', 'warn', 4000); return; }
    const d = dlg();
    const volta = acharAlt(E.fp.name);
    if (d && !(await d.confirm('Apagar "' + E.fp.name + '" da biblioteca do hub?' + (volta ? ' O footprint do Altium com esse nome volta a valer.' : ''), { title:'PCB Library', ok:'Apagar', danger:true }))) return;
    HF.tira(lib, E.fp.name);
    try { await HF.grava(lib); } catch (e) { if (d) d.alert('Não gravou: ' + (e && e.message || e), { title:'PCB Library' }); return; }
    salvos.push(E.fp.name);
    toast('apagado da biblioteca do hub', 'ok');
    E.sujo = false;
    carregaFp(volta ? E.fp.name : ((alt.footprints || [])[0] || {}).name);
  }

  /* ---------- desfazer ---------- */
  function antes(){ E.undo.push(JSON.stringify(E.fp)); if (E.undo.length > 200) E.undo.shift(); E.redo = []; }
  function mudou(){ E.vazio = false; E.sujo = true; titulo(); props(); status(); pede(); if (E.modo === '3d') cena3d(); }
  function volta(de, para){
    if (!de.length) return;
    para.push(JSON.stringify(E.fp));
    const sel = [...E.sel].map(x => ({ t:tipo(x), i:arr(tipo(x)).indexOf(x) }));
    E.fp = JSON.parse(de.pop());
    E.sel = new Set(sel.map(s => arr(s.t)[s.i]).filter(Boolean));
    mudou();
  }
  const tipo = x => E.fp.pads.indexOf(x) >= 0 ? 'pad' : E.fp.silk.indexOf(x) >= 0 ? 'silk' : E.fp.bodies.indexOf(x) >= 0 ? 'body' : '';
  const arr = t => t === 'pad' ? E.fp.pads : t === 'silk' ? E.fp.silk : t === 'body' ? E.fp.bodies : [];

  /* ---------- 2D: camera ---------- */
  const ctx = cv.getContext('2d');
  let DPR = 1, W = 0, H = 0, ag = 0;
  function mede(){
    DPR = window.devicePixelRatio || 1;
    W = vp.clientWidth; H = vp.clientHeight;
    cv.width = Math.max(1, Math.round(W * DPR)); cv.height = Math.max(1, Math.round(H * DPR));
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { mede(); pede(); if (E.v3) E.v3.redimensiona(); }) : null;
  if (ro) ro.observe(vp);
  function pede(){ if (!ag) ag = requestAnimationFrame(desenha); }
  const tela = (x, y) => [(x - E.view.cx) * E.view.s + W / 2, (E.view.cy - y) * E.view.s + H / 2];
  const mundo = (sx, sy) => [(sx - W / 2) / E.view.s + E.view.cx, E.view.cy - (sy - H / 2) / E.view.s];
  const snap = v => r4(Math.round(v / E.grade) * E.grade);
  function caixaFp(){
    const b = HF ? HF.bbox(E.fp) : { x1:-1, y1:-1, x2:1, y2:1 };
    for (const c of E.fp.bodies) { const q = contornoCorpo(c); for (const p of q) { b.x1 = Math.min(b.x1, p[0]); b.y1 = Math.min(b.y1, p[1]); b.x2 = Math.max(b.x2, p[0]); b.y2 = Math.max(b.y2, p[1]); } }
    return b;
  }
  function enquadra(){
    if (E.modo === '3d' && E.v3) { E.v3.enquadra(); return; }
    if (!W) mede();
    const b = caixaFp();
    const w = Math.max(2, b.x2 - b.x1), h = Math.max(2, b.y2 - b.y1);
    E.view.cx = (b.x1 + b.x2) / 2; E.view.cy = (b.y1 + b.y2) / 2;
    E.view.s = Math.max(2, Math.min(400, Math.min((W || 600) / (w * 1.35), (H || 400) / (h * 1.35))));
    pede();
  }

  /* ---------- 2D: desenho ---------- */
  function caminhoPad(P, p, extra){
    const e = extra || 0;
    const w = p.w + 2 * e, h = p.h + 2 * e, f = String(p.shape || 'rect').toLowerCase();
    P.save(); P.translate(p.x, p.y); P.rotate((p.rot || 0) * RAD);
    P.beginPath();
    if (f === 'circle' || f === 'round' || f === 'oval') {
      const r = Math.min(w, h) / 2;
      if (Math.abs(w - h) < 1e-6) P.arc(0, 0, r, 0, 2 * Math.PI);
      else if (w > h) { P.moveTo(-w / 2 + r, -r); P.lineTo(w / 2 - r, -r); P.arc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2); P.lineTo(-w / 2 + r, r); P.arc(-w / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5); }
      else { P.moveTo(r, -h / 2 + r); P.lineTo(r, h / 2 - r); P.arc(0, h / 2 - r, r, 0, Math.PI); P.lineTo(-r, -h / 2 + r); P.arc(0, -h / 2 + r, r, Math.PI, 0); }
    } else if (f === 'roundrect') {
      const r = Math.min(isNum(p.radius) ? p.radius + e : Math.min(w, h) / 4, Math.min(w, h) / 2);
      P.moveTo(-w / 2 + r, -h / 2); P.arcTo(w / 2, -h / 2, w / 2, h / 2, r); P.arcTo(w / 2, h / 2, -w / 2, h / 2, r);
      P.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r); P.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r);
    } else if (f === 'octagon') {
      const c = Math.min(w, h) / 4;
      P.moveTo(-w / 2 + c, -h / 2); P.lineTo(w / 2 - c, -h / 2); P.lineTo(w / 2, -h / 2 + c); P.lineTo(w / 2, h / 2 - c);
      P.lineTo(w / 2 - c, h / 2); P.lineTo(-w / 2 + c, h / 2); P.lineTo(-w / 2, h / 2 - c); P.lineTo(-w / 2, -h / 2 + c);
    } else P.rect(-w / 2, -h / 2, w, h);
    P.closePath();
    P.restore();
  }
  function caminhoFuro(P, p){
    P.save(); P.translate(p.x, p.y); P.rotate(((p.holerot || 0) + (p.rot || 0)) * RAD);
    P.beginPath();
    const r = p.drill / 2;
    if (p.drillw > p.drill) { const L = p.drillw / 2 - r; P.moveTo(-L, -r); P.lineTo(L, -r); P.arc(L, 0, r, -Math.PI / 2, Math.PI / 2); P.lineTo(-L, r); P.arc(-L, 0, r, Math.PI / 2, Math.PI * 1.5); }
    else P.arc(0, 0, r, 0, 2 * Math.PI);
    P.closePath(); P.restore();
  }
  /* o contorno 2D de um corpo 3D (no plano do footprint) */
  function contornoCorpo(b){
    if (!b) return [];
    if (b.kind === 'extruded') return (b.pts || []).slice();
    const raw = b.raw || {};
    const x = raw.x2d || 0, y = raw.y2d || 0;
    if (b.kind === 'cylinder' || b.kind === 'sphere') {
      const r = b.radius || 0.5, q = [];
      for (let i = 0; i < 24; i++) q.push([x + r * Math.cos(i * Math.PI / 12), y + r * Math.sin(i * Math.PI / 12)]);
      return q;
    }
    const bb = E.bbStep.get(b);
    if (bb) return [[bb.x1, bb.y1], [bb.x2, bb.y1], [bb.x2, bb.y2], [bb.x1, bb.y2]];
    return [[x - 0.5, y - 0.5], [x + 0.5, y - 0.5], [x + 0.5, y + 0.5], [x - 0.5, y + 0.5]];
  }
  function desenha(){
    ag = 0;
    if (E.modo !== '2d') return;
    if (!W) mede();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COR.fundo; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    /* grade: linhas finas a cada passo e mais fortes a cada 10, sumindo quando ficam apertadas */
    const passo = E.grade, s = E.view.s;
    const [x0, y1] = mundo(0, 0), [x1, y0] = mundo(W, H);
    for (const [p, cor] of [[passo, COR.grade], [passo * 10, COR.gradeF]]) {
      if (p * s < 6) continue;
      ctx.strokeStyle = cor; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = Math.ceil(x0 / p) * p; x <= x1; x += p) { const X = Math.round(tela(x, 0)[0]) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, H); }
      for (let y = Math.ceil(y0 / p) * p; y <= y1; y += p) { const Y = Math.round(tela(0, y)[1]) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(W, Y); }
      ctx.stroke();
    }
    /* mundo em mm, Y para cima */
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(s, -s); ctx.translate(-E.view.cx, -E.view.cy);
    const px = n => n / s;
    /* corpos 3D (Mechanical): o contorno, translucido */
    for (const b of E.fp.bodies) {
      const q = contornoCorpo(b);
      if (q.length < 2) continue;
      ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); for (let i = 1; i < q.length; i++) ctx.lineTo(q[i][0], q[i][1]); ctx.closePath();
      ctx.fillStyle = 'rgba(0,200,210,0.10)'; ctx.fill();
      ctx.strokeStyle = E.sel.has(b) ? COR.sel : COR.corpo; ctx.lineWidth = px(E.sel.has(b) ? 2 : 1.2);
      ctx.setLineDash([px(6), px(4)]); ctx.stroke(); ctx.setLineDash([]);
    }
    /* pads: Bottom, depois Top, depois Multi */
    const ordem = { Bottom:0, Top:1, Multi:2 };
    const pads = E.fp.pads.slice().sort((a, b) => (ordem[a.layer] || 0) - (ordem[b.layer] || 0));
    for (const p of pads) {
      ctx.fillStyle = COR[p.layer] || COR.Top;
      caminhoPad(ctx, p); ctx.fill();
      if (p.drill > 0) { ctx.fillStyle = COR.furo; caminhoFuro(ctx, p); ctx.fill(); }
    }
    /* serigrafia (Top Overlay) */
    ctx.strokeStyle = COR.silk; ctx.lineCap = 'round';
    for (const o of E.fp.silk) {
      ctx.lineWidth = Math.max(o.w || 0.1, px(1));
      ctx.beginPath();
      if (o.kind === 'arc') { ctx.arc(o.cx, o.cy, o.r, o.sa * RAD, o.ea * RAD, false); }
      else { ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); }
      ctx.stroke();
    }
    /* selecao */
    ctx.strokeStyle = COR.sel; ctx.lineWidth = px(1.5);
    for (const x of E.sel) {
      const t = tipo(x);
      if (t === 'pad') { caminhoPad(ctx, x, px(2)); ctx.stroke(); }
      else if (t === 'silk') {
        ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = Math.max(x.w || 0.1, px(1)) + px(3);
        ctx.globalAlpha = 0.45; ctx.beginPath();
        if (x.kind === 'arc') ctx.arc(x.cx, x.cy, x.r, x.sa * RAD, x.ea * RAD, false); else { ctx.moveTo(x.x1, x.y1); ctx.lineTo(x.x2, x.y2); }
        ctx.stroke(); ctx.restore();
      }
    }
    /* rascunho da ferramenta */
    const d = E.draft;
    if (d && E.mouse) {
      ctx.strokeStyle = COR.silk; ctx.lineWidth = Math.max(E.linhaW, px(1)); ctx.globalAlpha = 0.8;
      if (E.tool === 'linha' && d.p0) { ctx.beginPath(); ctx.moveTo(d.p0[0], d.p0[1]); ctx.lineTo(E.mouse[0], E.mouse[1]); ctx.stroke(); }
      if (E.tool === 'arco' && d.c) {
        const r = d.r || Math.hypot(E.mouse[0] - d.c[0], E.mouse[1] - d.c[1]);
        ctx.beginPath();
        if (d.r) { const a0 = d.sa * RAD, a1 = Math.atan2(E.mouse[1] - d.c[1], E.mouse[0] - d.c[0]); ctx.arc(d.c[0], d.c[1], r, a0, a1, false); }
        else ctx.arc(d.c[0], d.c[1], r, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (E.tool === 'pad' && E.mouse) {
      ctx.globalAlpha = 0.6; const m = E.padModelo;
      const p = { x:E.mouse[0], y:E.mouse[1], w:m.w, h:m.h, rot:m.rot, shape:m.shape, radius:m.radius };
      ctx.fillStyle = m.type === 'th' ? COR.Multi : COR[m.layer] || COR.Top; caminhoPad(ctx, p); ctx.fill();
      ctx.globalAlpha = 1;
    }
    /* origem do footprint: a cruz do Altium */
    ctx.strokeStyle = COR.origem; ctx.lineWidth = px(1);
    const c = px(8); ctx.beginPath(); ctx.moveTo(-c, 0); ctx.lineTo(c, 0); ctx.moveTo(0, -c); ctx.lineTo(0, c); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, px(4), 0, 2 * Math.PI); ctx.stroke();
    ctx.restore();
    /* designador dos pads, em tela (texto reto) */
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of E.fp.pads) {
      const t = String(p.name || ''); if (!t) continue;
      const tam = Math.min(p.w, p.h) * s * 0.55;
      if (tam < 7) continue;
      ctx.font = Math.min(18, tam) + 'px ' + getComputedStyle(caixa).fontFamily;
      const [X, Y] = tela(p.x, p.y);
      ctx.fillText(t, X, Y);
    }
    /* janela de selecao */
    if (E.janela) {
      const j = E.janela, a = tela(j.x0, j.y0), b = tela(j.x1, j.y1);
      ctx.strokeStyle = COR.janela; ctx.fillStyle = 'rgba(61,139,255,0.12)'; ctx.lineWidth = 1;
      if (j.x1 < j.x0) ctx.setLineDash([4, 3]);
      ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.setLineDash([]);
    }
  }

  /* ---------- 2D: o que esta sob o cursor ---------- */
  function dentroPoli(q, x, y){ let d = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) { if ((q[i][1] > y) !== (q[j][1] > y) && x < (q[j][0] - q[i][0]) * (y - q[i][1]) / (q[j][1] - q[i][1]) + q[i][0]) d = !d; } return d; }
  function distSeg(px_, py, x1, y1, x2, y2){ const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy; let t = L ? ((px_ - x1) * dx + (py - y1) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px_ - x1 - t * dx, py - y1 - t * dy); }
  function naArco(o, x, y){
    let a = Math.atan2(y - o.cy, x - o.cx) / RAD; a = (a + 360) % 360;
    const sa = ((o.sa % 360) + 360) % 360, ea = ((o.ea % 360) + 360) % 360;
    if (Math.abs(o.ea - o.sa) >= 359.99) return true;
    return sa <= ea ? (a >= sa && a <= ea) : (a >= sa || a <= ea);
  }
  function sob(x, y){
    const tol = 4 / E.view.s, out = [];
    for (const p of E.fp.pads) {
      const a = -(p.rot || 0) * RAD, dx = x - p.x, dy = y - p.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= p.w / 2 + tol && Math.abs(ly) <= p.h / 2 + tol) out.push(p);
    }
    for (const o of E.fp.silk) {
      const w = (o.w || 0.1) / 2 + tol;
      if (o.kind === 'arc') { if (Math.abs(Math.hypot(x - o.cx, y - o.cy) - o.r) <= w && naArco(o, x, y)) out.push(o); }
      else if (distSeg(x, y, o.x1, o.y1, o.x2, o.y2) <= w) out.push(o);
    }
    for (const b of E.fp.bodies) { const q = contornoCorpo(b); if (q.length >= 3 && dentroPoli(q, x, y)) out.push(b); }
    return out;
  }
  function naJanela(j){
    const xa = Math.min(j.x0, j.x1), xb = Math.max(j.x0, j.x1), ya = Math.min(j.y0, j.y1), yb = Math.max(j.y0, j.y1);
    const toca = j.x1 < j.x0;
    const dentro = q => q.every(p => p[0] >= xa && p[0] <= xb && p[1] >= ya && p[1] <= yb);
    const algum = q => q.some(p => p[0] >= xa && p[0] <= xb && p[1] >= ya && p[1] <= yb);
    const out = [];
    for (const p of E.fp.pads) { const q = HF ? HF.cantosPad(p) : [[p.x, p.y]]; if (toca ? algum(q) : dentro(q)) out.push(p); }
    for (const o of E.fp.silk) { const q = o.kind === 'arc' ? [[o.cx - o.r, o.cy], [o.cx + o.r, o.cy], [o.cx, o.cy - o.r], [o.cx, o.cy + o.r]] : [[o.x1, o.y1], [o.x2, o.y2]]; if (toca ? algum(q) : dentro(q)) out.push(o); }
    for (const b of E.fp.bodies) { const q = contornoCorpo(b); if (q.length && (toca ? algum(q) : dentro(q))) out.push(b); }
    return out;
  }

  /* ---------- 2D: mexer ---------- */
  function move(x, dx, dy){
    const t = tipo(x);
    if (t === 'pad') { x.x = r4(x.x + dx); x.y = r4(x.y + dy); }
    else if (t === 'silk') { if (x.kind === 'arc') { x.cx = r4(x.cx + dx); x.cy = r4(x.cy + dy); } else { x.x1 = r4(x.x1 + dx); x.y1 = r4(x.y1 + dy); x.x2 = r4(x.x2 + dx); x.y2 = r4(x.y2 + dy); } }
    else if (t === 'body') {
      if (x.kind === 'extruded') x.pts = x.pts.map(p => [r4(p[0] + dx), r4(p[1] + dy)]);
      else { x.raw = x.raw || {}; x.raw.x2d = r4((x.raw.x2d || 0) + dx); x.raw.y2d = r4((x.raw.y2d || 0) + dy); }
      if (x.kind === 'step') { const bb = E.bbStep.get(x); if (bb) E.bbStep.set(x, { x1:bb.x1 + dx, y1:bb.y1 + dy, x2:bb.x2 + dx, y2:bb.y2 + dy, z0:bb.z0, z1:bb.z1 }); }
    }
  }
  function gira90(){
    if (!E.sel.size) { if (E.tool === 'pad') { E.padModelo.rot = ((E.padModelo.rot || 0) + 90) % 360; pede(); } return; }
    antes();
    const xs = [], ys = [];
    for (const x of E.sel) for (const p of contornoDe(x)) { xs.push(p[0]); ys.push(p[1]); }
    const cx = snap((Math.min(...xs) + Math.max(...xs)) / 2), cy = snap((Math.min(...ys) + Math.max(...ys)) / 2);
    const g = (x, y) => [r4(cx - (y - cy)), r4(cy + (x - cx))];
    for (const x of E.sel) {
      const t = tipo(x);
      if (t === 'pad') { [x.x, x.y] = g(x.x, x.y); x.rot = ((x.rot || 0) + 90) % 360; }
      else if (t === 'silk') {
        if (x.kind === 'arc') { [x.cx, x.cy] = g(x.cx, x.cy); x.sa = (x.sa + 90) % 360; x.ea = (x.ea + 90) % 360; if (x.ea === 0 && x.sa > 0) x.ea = 360; }
        else { [x.x1, x.y1] = g(x.x1, x.y1); [x.x2, x.y2] = g(x.x2, x.y2); }
      } else if (t === 'body') {
        if (x.kind === 'extruded') x.pts = x.pts.map(p => g(p[0], p[1]));
        else { x.raw = x.raw || {}; [x.raw.x2d, x.raw.y2d] = g(x.raw.x2d || 0, x.raw.y2d || 0); x.raw.rotz = (((x.raw.rotz || 0) + 90) % 360); if (x.kind === 'step') medeStep(x); }
      }
    }
    mudou();
  }
  function contornoDe(x){
    const t = tipo(x);
    if (t === 'pad') return HF ? HF.cantosPad(x) : [[x.x, x.y]];
    if (t === 'silk') return x.kind === 'arc' ? [[x.cx - x.r, x.cy - x.r], [x.cx + x.r, x.cy + x.r]] : [[x.x1, x.y1], [x.x2, x.y2]];
    return contornoCorpo(x);
  }
  function apaga(){
    if (!E.sel.size) return;
    antes();
    E.fp.pads = E.fp.pads.filter(x => !E.sel.has(x));
    E.fp.silk = E.fp.silk.filter(x => !E.sel.has(x));
    E.fp.bodies = E.fp.bodies.filter(x => !E.sel.has(x));
    E.sel.clear(); mudou();
  }
  function duplica(){
    if (!E.sel.size) return;
    antes();
    const novos = [];
    for (const x of E.sel) {
      const t = tipo(x), c = JSON.parse(JSON.stringify(x));
      arr(t).push(c); move(c, E.grade * 5, -E.grade * 5); novos.push(c);
      if (t === 'pad') c.name = proximoPad();
      if (c.kind === 'step') medeStep(c);
    }
    E.sel = new Set(novos); mudou();
  }
  function proximoPad(){
    let n = 0;
    for (const p of E.fp.pads) { const v = parseInt(p.name, 10); if (String(v) === String(p.name) && v > n) n = v; }
    return String(n + 1);
  }
  function ferramenta(id){
    E.tool = id; E.draft = null;
    if (id !== 'sel') E.sel.clear();
    for (const k in bTool) { bTool[k].classList.toggle('on', k === id); bTool[k].setAttribute('aria-pressed', String(k === id)); }
    cv.style.cursor = id === 'sel' ? 'default' : 'crosshair';
    dica.textContent = id === 'pad' ? 'clique põe o pad · Espaço gira · Tab: as propriedades do pad · Esc larga'
      : id === 'linha' ? 'clique começa · cliques seguintes encadeiam · botão direito/Esc termina'
      : id === 'arco' ? 'clique no centro · clique no começo do arco · clique no fim'
      : '';
    props(); pede();
  }

  /* ---------- mouse ---------- */
  function ptDe(ev){ const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
  cv.addEventListener('contextmenu', ev => ev.preventDefault());
  cv.addEventListener('pointerdown', ev => {
    cv.focus();
    const [sx, sy] = ptDe(ev), w = mundo(sx, sy), g = [snap(w[0]), snap(w[1])];
    if (ev.button === 2) { E.arr = { pan:true, sx, sy, cx:E.view.cx, cy:E.view.cy, andou:false, id:ev.pointerId }; try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* ok */ } return; }
    if (ev.button !== 0) return;
    if (E.tool === 'pad') {
      antes();
      const m = E.padModelo;
      const p = { name:proximoPad(), type:m.type, shape:m.shape, x:g[0], y:g[1], w:m.w, h:m.h, rot:m.rot || 0, layer:m.type === 'th' ? 'Multi' : m.layer };
      if (m.shape === 'roundrect' && isNum(m.radius)) p.radius = m.radius;
      if (m.type === 'th') { p.drill = m.drill; p.drillshape = 'circle'; p.holerot = 0; }
      E.fp.pads.push(p); mudou(); return;
    }
    if (E.tool === 'linha') {
      if (!E.draft || !E.draft.p0) { E.draft = { p0:g }; pede(); return; }
      if (g[0] === E.draft.p0[0] && g[1] === E.draft.p0[1]) return;
      antes();
      E.fp.silk.push({ kind:'line', x1:E.draft.p0[0], y1:E.draft.p0[1], x2:g[0], y2:g[1], w:E.linhaW });
      E.draft = { p0:g }; mudou(); return;
    }
    if (E.tool === 'arco') {
      const d = E.draft || (E.draft = {});
      if (!d.c) { d.c = g; pede(); return; }
      if (!d.r) { d.r = r4(Math.hypot(g[0] - d.c[0], g[1] - d.c[1])); d.sa = r4((Math.atan2(g[1] - d.c[1], g[0] - d.c[0]) / RAD + 360) % 360); if (!(d.r > 0)) d.r = 0; pede(); return; }
      let ea = r4((Math.atan2(g[1] - d.c[1], g[0] - d.c[0]) / RAD + 360) % 360);
      if (Math.abs(ea - d.sa) < 0.01) ea = d.sa + 360;
      antes();
      E.fp.silk.push({ kind:'arc', cx:d.c[0], cy:d.c[1], r:d.r, sa:d.sa, ea:ea < d.sa ? ea + 360 : ea, w:E.linhaW });
      E.draft = null; mudou(); return;
    }
    /* selecionar / arrastar */
    const em = sob(w[0], w[1]);
    let alvo = null;
    if (em.length) {
      /* segundo clique no mesmo ponto pega o de baixo, como na vista PCB */
      const i = em.findIndex(x => E.sel.has(x));
      alvo = (i >= 0 && !ev.shiftKey && E.sel.size === 1 && em.length > 1 && E.ultimoClique && Math.hypot(sx - E.ultimoClique[0], sy - E.ultimoClique[1]) < 3) ? em[(i + 1) % em.length] : (i >= 0 ? em[i] : em[0]);
    }
    E.ultimoClique = [sx, sy];
    if (alvo) {
      if (ev.shiftKey) { if (E.sel.has(alvo)) E.sel.delete(alvo); else E.sel.add(alvo); }
      else if (!E.sel.has(alvo)) { E.sel.clear(); E.sel.add(alvo); }
      E.arr = { mover:true, w0:g, ult:g, andou:false, id:ev.pointerId };
    } else {
      if (!ev.shiftKey) E.sel.clear();
      E.janela = null;
      E.arr = { janela:true, w0:w, id:ev.pointerId };
    }
    try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* ok */ }
    props(); pede();
  });
  cv.addEventListener('pointermove', ev => {
    const [sx, sy] = ptDe(ev), w = mundo(sx, sy), g = [snap(w[0]), snap(w[1])];
    E.mouse = E.tool === 'sel' ? w : g;
    stXY.textContent = 'X ' + fmt(g[0]) + '  Y ' + fmt(g[1]);
    const a = E.arr;
    if (a && a.pan) {
      if (Math.hypot(sx - a.sx, sy - a.sy) > 3) a.andou = true;
      E.view.cx = a.cx - (sx - a.sx) / E.view.s; E.view.cy = a.cy + (sy - a.sy) / E.view.s; pede(); return;
    }
    if (a && a.mover) {
      const dx = r4(g[0] - a.ult[0]), dy = r4(g[1] - a.ult[1]);
      if (dx || dy) { if (!a.andou) { antes(); a.andou = true; } for (const x of E.sel) move(x, dx, dy); a.ult = g; E.sujo = true; titulo(); pede(); }
      return;
    }
    if (a && a.janela) { E.janela = { x0:a.w0[0], y0:a.w0[1], x1:w[0], y1:w[1] }; pede(); return; }
    if (E.tool !== 'sel') pede();
  });
  cv.addEventListener('pointerup', ev => {
    const a = E.arr; E.arr = null;
    try { cv.releasePointerCapture(ev.pointerId); } catch (e) { /* ok */ }
    if (!a) return;
    if (a.pan && !a.andou) {
      if (E.tool !== 'sel') { if (E.draft) { E.draft = null; pede(); } else ferramenta('sel'); return; }
      menu(ev); return;
    }
    if (a.mover && a.andou) { mudou(); return; }
    if (a.janela && E.janela) {
      const j = E.janela; E.janela = null;
      if (Math.abs(j.x1 - j.x0) * E.view.s > 3 || Math.abs(j.y1 - j.y0) * E.view.s > 3) for (const x of naJanela(j)) E.sel.add(x);
      props(); pede();
    }
  });
  cv.addEventListener('dblclick', () => { const f = pr.querySelector('input, select'); if (f && E.sel.size) f.focus(); });
  cv.addEventListener('wheel', ev => {
    ev.preventDefault();
    const [sx, sy] = ptDe(ev), w = mundo(sx, sy);
    if (ev.shiftKey) { E.view.cx += ev.deltaY / E.view.s; pede(); return; }
    const f = Math.pow(1.0018, -ev.deltaY);
    E.view.s = Math.max(1, Math.min(3000, E.view.s * f));
    E.view.cx = w[0] - (sx - W / 2) / E.view.s; E.view.cy = w[1] + (sy - H / 2) / E.view.s;
    pede();
  }, { passive:false });

  /* o botao direito sem arrastar: o menu do Altium, reduzido ao que o editor faz */
  let menuAberto = null;
  const sepMenu = () => { const d = el('div'); d.style.cssText = 'height:1px;background:var(--edge);margin:3px 4px;'; return d; };
  function fechaMenu(){ if (menuAberto) { menuAberto.remove(); menuAberto = null; } }
  function menu(ev){
    fechaMenu();
    const m = el('div', 'fpe-menu');
    const item = (rot, k, fn, off) => { const b = bt('', '', () => { fechaMenu(); fn(); }); b.append(document.createTextNode(rot)); if (k) b.append(el('kbd', null, k)); if (off) b.disabled = true; m.append(b); };
    item('Place Pad', 'P,P', () => ferramenta('pad'));
    item('Place Line', 'P,L', () => ferramenta('linha'));
    item('Place Arc', 'P,A', () => ferramenta('arco'));
    item('Place 3D Body (STEP)…', 'P,B', () => poeStep());
    item('Place Extruded 3D Body', 'P,E', () => poeCorpo('extruded'));
    m.append(sepMenu());
    item('Rotate Selection', 'Espaço', gira90, !E.sel.size);
    item('Duplicate', 'Ctrl+D', duplica, !E.sel.size);
    item('Delete', 'Delete', apaga, !E.sel.size);
    item('Select All', 'Ctrl+A', () => { E.sel = new Set([...E.fp.pads, ...E.fp.silk, ...E.fp.bodies]); props(); pede(); });
    m.append(sepMenu());
    item('Fit Document', 'F', enquadra);
    item('3D Layout Mode', '3', () => modo('3d'));
    m.style.left = Math.min(ev.clientX, innerWidth - 220) + 'px'; m.style.top = Math.min(ev.clientY, innerHeight - 330) + 'px';
    fundo.append(m); menuAberto = m;
  }
  fundo.addEventListener('pointerdown', ev => { if (menuAberto && !menuAberto.contains(ev.target)) fechaMenu(); }, true);

  /* ---------- corpos 3D ---------- */
  function centroPads(){
    const b = E.fp.pads.length ? HF.bbox({ pads:E.fp.pads, silk:[] }) : HF.bbox(E.fp);
    return { x:r4((b.x1 + b.x2) / 2), y:r4((b.y1 + b.y2) / 2), b };
  }
  function poeCorpo(kind){
    antes();
    const c = centroPads(), b = c.b;
    let corpo;
    if (kind === 'extruded') {
      const m = 0.1;
      corpo = { kind:'extruded', side:'top', pts:[[r4(b.x1 + m), r4(b.y1 + m)], [r4(b.x2 - m), r4(b.y1 + m)], [r4(b.x2 - m), r4(b.y2 - m)], [r4(b.x1 + m), r4(b.y2 - m)]],
                standoff:0, height:1, color:'#2b2b2b', opacity:1 };
    } else if (kind === 'cylinder') {
      corpo = { kind:'cylinder', side:'top', radius:r4(Math.max(0.5, Math.min(b.x2 - b.x1, b.y2 - b.y1) / 2)), height:8, raw:{ x2d:c.x, y2d:c.y, rot2d:0, rotx:0, roty:0, rotz:0, dz:0 }, color:'#2a3f8c', opacity:1 };
    } else return;
    E.fp.bodies.push(corpo);
    E.sel = new Set([corpo]);
    mudou();
  }
  function poeStep(){
    if (!HF) return;
    arquivo.value = '';
    arquivo.onchange = () => { const f = arquivo.files && arquivo.files[0]; if (f) recebeStep(f); };
    arquivo.click();
  }
  /* o STEP escolhido (ou solto na area de trabalho): sobe para Libs/3d-hub/ e vira um corpo do footprint */
  async function recebeStep(f){
    stMsg.textContent = 'enviando ' + f.name + '…';
    let r;
    try { r = await HF.sobeStep(f, f.name); }
    catch (e) { stMsg.textContent = ''; const d = dlg(); if (d) d.alert(String(e && e.message || e), { title:'3D Body' }); return; }
    lib.models[r.id] = { file:r.file, name:r.name, bytes:r.bytes };
    antes();
    const c = centroPads();
    const corpo = { kind:'step', model:r.id, name:r.name, side:'top', raw:{ x2d:c.x, y2d:c.y, rot2d:0, rotx:0, roty:0, rotz:0, dz:0 }, color:'#9a9a9a', opacity:1 };
    E.fp.bodies.push(corpo);
    E.sel = new Set([corpo]);
    stMsg.textContent = 'lendo o STEP…';
    await medeStep(corpo, r.buffer, true);
    stMsg.textContent = '';
    mudou();
    toast('modelo ' + r.name + ' preso ao footprint — confira a rotação em Properties', 'ok', 3500);
  }
  /* soltar um .step na area de trabalho: o mesmo que P,B */
  vp.addEventListener('dragover', ev => { if (ev.dataTransfer && [...(ev.dataTransfer.items || [])].some(i => i.kind === 'file')) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } });
  vp.addEventListener('drop', ev => {
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (!f) return;
    ev.preventDefault();
    if (!/\.(step|stp)$/i.test(f.name)) { toast('só STEP (.step / .stp) vira corpo 3D', 'warn'); return; }
    recebeStep(f);
  });
  /* a caixa do STEP no referencial do footprint (com a rotacao do corpo); encaixa = poe em cima
     dos pads (centro XY) e assentado na placa (Z minimo = 0), o "Snap to board" do Altium */
  const malhasStep = new Map();
  async function medeStep(b, buffer, encaixa){
    if (!b || b.kind !== 'step' || typeof HubPcb3dStep === 'undefined') return;
    const m = lib.models[b.model];
    if (!m) return;
    let malhas = malhasStep.get(b.model);
    if (!malhas) {
      try {
        const r = await HubPcb3dStep.carrega('Libs/' + m.file, { chave:b.model, buffer:buffer ? buffer.slice(0) : undefined });
        malhas = r.malhas; malhasStep.set(b.model, malhas);
      } catch (e) { stMsg.textContent = 'STEP: ' + (e && e.message || e); return; }
    }
    const raw = b.raw || (b.raw = { x2d:0, y2d:0, rot2d:0, rotx:0, roty:0, rotz:0, dz:0 });
    const R = rotacao(raw);
    let x1 = Infinity, y1 = Infinity, z1 = Infinity, x2 = -Infinity, y2 = -Infinity, z2 = -Infinity;
    for (const mm of malhas) {
      const P = mm.pos;
      const passo = Math.max(1, Math.floor(P.length / 3 / 60000));
      for (let i = 0; i < P.length; i += 3 * passo) {
        const x = P[i], y = P[i + 1], z = P[i + 2];
        const X = R[0] * x + R[1] * y + R[2] * z, Y = R[3] * x + R[4] * y + R[5] * z, Z = R[6] * x + R[7] * y + R[8] * z;
        if (X < x1) x1 = X; if (X > x2) x2 = X; if (Y < y1) y1 = Y; if (Y > y2) y2 = Y; if (Z < z1) z1 = Z; if (Z > z2) z2 = Z;
      }
    }
    if (!isFinite(x1)) return;
    if (encaixa) {
      const c = centroPads();
      raw.x2d = r4(c.x - (x1 + x2) / 2); raw.y2d = r4(c.y - (y1 + y2) / 2); raw.dz = r4(-z1);
    }
    E.bbStep.set(b, { x1:x1 + raw.x2d, y1:y1 + raw.y2d, x2:x2 + raw.x2d, y2:y2 + raw.y2d, z0:z1 + raw.dz, z1:z2 + raw.dz });
    pede(); if (E.sel.has(b)) props();
  }
  /* Rz(rotz) . Ry(roty) . Rx(rotx), a conta do HubPcb3dModelo */
  function rotacao(raw){
    const c = g => Math.cos(g * RAD), s = g => Math.sin(g * RAD);
    const az = (raw.rot2d || 0) + (raw.rotz || 0), ay = raw.roty || 0, ax = raw.rotx || 0;
    const Rz = [c(az), -s(az), 0, s(az), c(az), 0, 0, 0, 1], Ry = [c(ay), 0, s(ay), 0, 1, 0, -s(ay), 0, c(ay)], Rx = [1, 0, 0, 0, c(ax), -s(ax), 0, s(ax), c(ax)];
    const mul = (A, B) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return o; };
    return mul(mul(Rz, Ry), Rx);
  }

  /* ---------- Properties ---------- */
  function sec(titulo){ const s = el('div', 'fpe-sec'); s.append(el('div', 'st', titulo)); const c = el('div', 'cx'); s.append(c); pr.append(s); return c; }
  function campo(box, rot, valor, aplica, o){
    o = o || {};
    box.append(Object.assign(el('label', null, rot), { title:o.dica || '' }));
    let i;
    if (o.opcoes) { i = el('select'); for (const [v, r] of o.opcoes) { const op = el('option', null, r); op.value = v; if (String(v) === String(valor)) op.selected = true; i.append(op); } }
    else if (o.area) { i = el('textarea'); i.value = valor; }
    else { i = el('input'); i.type = o.cor ? 'color' : 'text'; i.value = valor; }
    if (o.dica) i.title = o.dica;
    if (o.off) i.disabled = true;
    const vai = () => { const r = aplica(i.value); if (r === false) i.style.borderColor = 'var(--err)'; else i.style.borderColor = ''; };
    i.addEventListener('change', vai);
    i.addEventListener('keydown', e => { if (e.key === 'Enter' && !o.area) { e.preventDefault(); vai(); i.blur(); } });
    box.append(i);
    return i;
  }
  const num = (alvo, k, f) => v => { const x = le(v); if (!isNum(x)) return false; antes(); alvo[k] = f ? f(x) : x; mudou(); return true; };
  const ang = (alvo, k) => v => { const x = parseFloat(String(v).replace(',', '.')); if (!isFinite(x)) return false; antes(); alvo[k] = r4(((x % 360) + 360) % 360); mudou(); return true; };
  function props(){
    const rolar = pr.scrollTop;
    pr.textContent = '';
    const sel = [...E.sel];
    const cab = el('div', 'cab');
    pr.append(cab);
    if (!sel.length && E.tool === 'pad') { cab.append(document.createTextNode('Pad (modelo)')); cab.append(el('span', 'k', 'o próximo pad')); propsPad(E.padModelo, true); }
    else if (!sel.length && (E.tool === 'linha' || E.tool === 'arco')) {
      cab.append(document.createTextNode(E.tool === 'linha' ? 'Line (modelo)' : 'Arc (modelo)'));
      const b = sec('Properties');
      campo(b, 'Width', mostra(E.linhaW), v => { const x = le(v); if (!(x > 0)) return false; E.linhaW = x; return true; });
      campo(b, 'Layer', 'Top Overlay', () => true, { off:true });
    }
    else if (!sel.length && E.vazio) {
      cab.append(document.createTextNode('editor de footprints'));
      pr.append(el('p', 'fpe-ajuda', 'Escolha um footprint na lista da esquerda para editar os pads, a serigrafia e o modelo 3D, '
        + 'ou crie um com "+ Novo footprint". Salvar grava na biblioteca de footprints do hub (Libs/pcblib-hub.js); o '
        + 'footprint do Altium com o mesmo nome continua no Libs/pcblib.js e o do hub passa na frente dele. Os componentes '
        + 'recebem o footprint na aba Componentes, faixa Footprints ("Aplicar footprint ao componente").'));
    }
    else if (!sel.length) { cab.append(document.createTextNode('Footprint')); propsFp(); }
    else if (sel.length > 1) { cab.append(document.createTextNode(sel.length + ' objetos')); const b = sec('Seleção'); b.append(el('div', 'nota', 'Espaço gira, Delete apaga, setas andam um passo da grade. Clique num só para ver as propriedades.')); }
    else {
      const x = sel[0], t = tipo(x);
      if (t === 'pad') { cab.append(document.createTextNode('Pad')); cab.append(el('span', 'k', x.name)); propsPad(x, false); }
      else if (t === 'silk') { cab.append(document.createTextNode(x.kind === 'arc' ? 'Arc' : 'Track')); cab.append(el('span', 'k', 'Top Overlay')); propsSilk(x); }
      else if (t === 'body') { cab.append(document.createTextNode('3D Body')); propsCorpo(x); }
    }
    pr.scrollTop = rolar;
  }
  function propsFp(){
    const b = sec('Footprint');
    campo(b, 'Name', E.fp.name, v => { v = String(v).trim(); if (!v || /["\\]/.test(v)) return false; if (v !== E.fp.name && existe(v) && v !== E.nome0) { toast('já existe "' + v + '"', 'warn'); return false; } antes(); E.fp.name = v; mudou(); return true; },
      { dica:'Mudar o nome cria outro footprint ao salvar; o de antes continua onde estava' });
    campo(b, 'Description', E.fp.description || '', v => { antes(); E.fp.description = v; mudou(); return true; });
    const bb = HF ? HF.bbox(E.fp) : null;
    if (bb) b.append(el('div', 'nota', 'Pads: ' + E.fp.pads.length + ' · Linhas: ' + E.fp.silk.length + ' · Caixa ' + fmt(bb.x2 - bb.x1) + ' × ' + fmt(bb.y2 - bb.y1)));
    const r = repetidosPads();
    if (r.length) b.append(el('div', 'nota', 'Designadores repetidos: ' + r.join(', ')));
    /* os corpos 3D: Component Body do Altium */
    const s = el('div', 'fpe-sec fpe-corpos'); s.append(el('div', 'st', '3D Bodies')); pr.append(s);
    if (!E.fp.bodies.length) s.append(el('div', 'vazio', 'Nenhum corpo 3D. Use "3D Body (STEP)" para prender o modelo do fabricante, ou "Extruded" para uma caixa.'));
    E.fp.bodies.forEach((c, i) => {
      const d = el('div', 'c');
      const sw = el('span', 'sw'); sw.style.background = c.color || '#888';
      const n = c.kind === 'step' ? (c.name || (lib.models[c.model] || {}).name || 'STEP') : c.kind === 'extruded' ? 'Extruded' : c.kind === 'cylinder' ? 'Cylinder' : 'Sphere';
      d.append(sw, el('span', 'n', (i + 1) + '. ' + n));
      d.addEventListener('click', () => { E.sel = new Set([c]); props(); pede(); });
      s.append(d);
    });
    const l = el('div'); l.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;padding:6px 10px 10px;';
    l.append(bt('fpe-b peq', '+ STEP…', () => poeStep()), bt('fpe-b peq', '+ Extruded', () => poeCorpo('extruded')), bt('fpe-b peq', '+ Cylinder', () => poeCorpo('cylinder')));
    s.append(l);
  }
  function repetidosPads(){ return HF ? HF.repetidos(E.fp) : []; }
  function propsPad(p, modelo){
    const ap = modelo ? (k, f) => v => { const x = le(v); if (!isNum(x)) return false; p[k] = f ? f(x) : x; pede(); return true; } : (k, f) => num(p, k, f);
    const muda = modelo ? (fn) => v => { fn(v); props(); pede(); return true; } : (fn) => v => { antes(); fn(v); mudou(); return true; };
    if (!modelo) {
      const b = sec('Properties');
      campo(b, 'Designator', p.name || '', v => { antes(); p.name = String(v).trim(); mudou(); return true; });
      campo(b, 'Layer', p.type === 'th' ? 'Multi' : p.layer, muda(v => { if (v === 'Multi') { p.type = 'th'; p.layer = 'Multi'; if (!(p.drill > 0)) { p.drill = r4(Math.min(p.w, p.h) * 0.55); p.drillshape = 'circle'; p.holerot = 0; } } else { p.type = 'smd'; p.layer = v; delete p.drill; delete p.drillshape; delete p.holerot; delete p.drillw; } }),
        { opcoes:[['Top', 'Top Layer'], ['Bottom', 'Bottom Layer'], ['Multi', 'Multi-Layer (passante)']] });
      const l = sec('Location');
      campo(l, 'X', mostra(p.x), ap('x'));
      campo(l, 'Y', mostra(p.y), ap('y'));
      campo(l, 'Rotation', String(p.rot || 0), modelo ? v => { p.rot = parseFloat(v) || 0; return true; } : ang(p, 'rot'));
    } else {
      const b = sec('Properties');
      campo(b, 'Layer', p.type === 'th' ? 'Multi' : p.layer, muda(v => { if (v === 'Multi') { p.type = 'th'; } else { p.type = 'smd'; p.layer = v; } }),
        { opcoes:[['Top', 'Top Layer'], ['Bottom', 'Bottom Layer'], ['Multi', 'Multi-Layer (passante)']] });
      campo(b, 'Rotation', String(p.rot || 0), v => { p.rot = parseFloat(v) || 0; pede(); return true; });
    }
    const s = sec('Size and Shape');
    campo(s, 'Shape', p.shape || 'rect', muda(v => { p.shape = v; if (v === 'roundrect' && !isNum(p.radius)) p.radius = r4(Math.min(p.w, p.h) / 4); }), { opcoes:FORMAS });
    campo(s, 'X Size', mostra(p.w), ap('w', x => Math.max(0.01, x)));
    campo(s, 'Y Size', mostra(p.h), ap('h', x => Math.max(0.01, x)));
    if (p.shape === 'roundrect') campo(s, 'Corner Radius', mostra(p.radius), ap('radius', x => Math.max(0, x)));
    if (p.type === 'th') {
      const h = sec('Hole Information');
      campo(h, 'Hole Size', mostra(p.drill), ap('drill', x => Math.max(0.05, x)));
      campo(h, 'Shape', p.drillw > p.drill ? 'slot' : 'round', muda(v => { if (v === 'slot') { p.drillw = r4(p.drill * 2); p.drillshape = 'slot'; } else { delete p.drillw; p.drillshape = 'circle'; } }),
        { opcoes:[['round', 'Round'], ['slot', 'Slot']] });
      if (p.drillw > p.drill) campo(h, 'Slot Length', mostra(p.drillw), ap('drillw'));
    }
  }
  function propsSilk(o){
    const b = sec('Location');
    if (o.kind === 'arc') {
      campo(b, 'Center X', mostra(o.cx), num(o, 'cx'));
      campo(b, 'Center Y', mostra(o.cy), num(o, 'cy'));
      campo(b, 'Radius', mostra(o.r), num(o, 'r', x => Math.max(0.01, x)));
      campo(b, 'Start Angle', String(o.sa), v => { const x = parseFloat(v); if (!isFinite(x)) return false; antes(); o.sa = r4(x); if (o.ea <= o.sa) o.ea += 360; mudou(); return true; });
      campo(b, 'End Angle', String(o.ea), v => { const x = parseFloat(v); if (!isFinite(x)) return false; antes(); o.ea = r4(x); if (o.ea <= o.sa) o.ea += 360; mudou(); return true; });
    } else {
      campo(b, 'Start X', mostra(o.x1), num(o, 'x1')); campo(b, 'Start Y', mostra(o.y1), num(o, 'y1'));
      campo(b, 'End X', mostra(o.x2), num(o, 'x2')); campo(b, 'End Y', mostra(o.y2), num(o, 'y2'));
    }
    const p = sec('Properties');
    campo(p, 'Width', mostra(o.w), num(o, 'w', x => Math.max(0.01, x)));
  }
  function propsCorpo(c){
    const tipos = [['step', 'Generic (STEP)'], ['extruded', 'Extruded'], ['cylinder', 'Cylinder'], ['sphere', 'Sphere']];
    const b = sec('3D Model Type');
    campo(b, 'Type', c.kind, () => true, { opcoes:tipos, off:true });
    if (c.kind === 'step') {
      const m = lib.models[c.model] || {};
      b.append(el('div', 'nota', (c.name || m.name || c.model) + (m.bytes ? ' · ' + (m.bytes >= 1048576 ? (m.bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(m.bytes / 1024)) + ' KB') : '')));
      const bb = E.bbStep.get(c);
      if (bb) b.append(el('div', 'nota', 'Caixa: ' + fmt(bb.x2 - bb.x1) + ' × ' + fmt(bb.y2 - bb.y1) + ' × ' + fmt(bb.z1 - bb.z0) + ' (altura)'));
    }
    const raw = c.raw || (c.raw = { x2d:0, y2d:0, rot2d:0, rotx:0, roty:0, rotz:0, dz:0 });
    const re = () => { if (c.kind === 'step') medeStep(c); };
    const numR = (k) => v => { const x = le(v); if (!isNum(x)) return false; antes(); raw[k] = x; re(); mudou(); return true; };
    const angR = (k) => v => { const x = parseFloat(String(v).replace(',', '.')); if (!isFinite(x)) return false; antes(); raw[k] = r4(((x % 360) + 360) % 360); re(); mudou(); return true; };
    if (c.kind === 'extruded') {
      const xs = c.pts.map(p => p[0]), ys = c.pts.map(p => p[1]);
      const cx = r4((Math.min(...xs) + Math.max(...xs)) / 2), cy = r4((Math.min(...ys) + Math.max(...ys)) / 2);
      const w = r4(Math.max(...xs) - Math.min(...xs)), h = r4(Math.max(...ys) - Math.min(...ys));
      const ret = (X, Y, Wd, Ht) => [[r4(X - Wd / 2), r4(Y - Ht / 2)], [r4(X + Wd / 2), r4(Y - Ht / 2)], [r4(X + Wd / 2), r4(Y + Ht / 2)], [r4(X - Wd / 2), r4(Y + Ht / 2)]];
      const l = sec('Location / Size');
      const reg = (k) => v => { const x = le(v); if (!isNum(x)) return false; antes(); const o = { cx, cy, w, h }; o[k] = x; c.pts = ret(o.cx, o.cy, Math.max(0.01, o.w), Math.max(0.01, o.h)); mudou(); return true; };
      campo(l, 'Center X', mostra(cx), reg('cx')); campo(l, 'Center Y', mostra(cy), reg('cy'));
      campo(l, 'Width (X)', mostra(w), reg('w')); campo(l, 'Length (Y)', mostra(h), reg('h'));
      campo(l, 'Outline', c.pts.map(p => mostra(p[0]) + ',' + mostra(p[1])).join('; '), v => {
        const pts = String(v).split(';').map(t => t.split(',').map(le)).filter(q => q.length === 2 && q.every(isNum));
        if (pts.length < 3) return false; antes(); c.pts = pts; mudou(); return true;
      }, { area:true, dica:'x,y; x,y; ... (o contorno do corpo, na unidade atual)' });
      const z = sec('Height');
      campo(z, 'Overall Height', mostra(c.height), num(c, 'height', x => Math.max(0.01, x)), { dica:'do lado da placa até o topo do corpo' });
      campo(z, 'Standoff Height', mostra(c.standoff || 0), num(c, 'standoff', x => Math.max(0, x)), { dica:'do lado da placa até a base do corpo' });
    } else {
      const l = sec('Location');
      campo(l, 'X', mostra(raw.x2d || 0), numR('x2d'));
      campo(l, 'Y', mostra(raw.y2d || 0), numR('y2d'));
      campo(l, c.kind === 'step' ? 'Z Offset' : 'Standoff', mostra(raw.dz || 0), numR('dz'), { dica:'a altura da origem do modelo acima da placa' });
      if (c.kind === 'step') {
        const r = sec('Rotation');
        campo(r, 'Rotation X', String(raw.rotx || 0), angR('rotx'));
        campo(r, 'Rotation Y', String(raw.roty || 0), angR('roty'));
        campo(r, 'Rotation Z', String(raw.rotz || 0), angR('rotz'));
        const ln = el('div', 'lin');
        const gira = (k) => () => { antes(); raw[k] = ((raw[k] || 0) + 90) % 360; medeStep(c).then(() => mudou()); };
        ln.append(bt('fpe-b peq', 'X +90°', gira('rotx')), bt('fpe-b peq', 'Y +90°', gira('roty')), bt('fpe-b peq', 'Z +90°', gira('rotz')),
          bt('fpe-b peq', 'Encaixar nos pads', () => { antes(); medeStep(c, null, true).then(() => mudou()); }));
        r.append(ln);
        r.append(el('div', 'nota', '"Encaixar" centraliza o modelo sobre os pads e o assenta na placa (o Z mínimo vira 0).'));
      } else {
        const s = sec('Size');
        campo(s, 'Radius', mostra(c.radius), num(c, 'radius', x => Math.max(0.01, x)));
        if (c.kind === 'cylinder') campo(s, 'Height', mostra(c.height), num(c, 'height', x => Math.max(0.01, x)));
      }
    }
    const a = sec('Appearance');
    campo(a, 'Color', c.color || '#808080', v => { antes(); c.color = v; mudou(); return true; }, { cor:true });
    campo(a, 'Opacity', String(isNum(c.opacity) ? Math.round(c.opacity * 100) : 100), v => { const x = parseFloat(v); if (!isFinite(x)) return false; antes(); c.opacity = Math.max(0.05, Math.min(1, x / 100)); mudou(); return true; }, { dica:'0 a 100 %' });
    const d = sec('Ações');
    const ln = el('div', 'lin'); ln.append(bt('fpe-b peq', 'Apagar o corpo', () => { E.sel = new Set([c]); apaga(); }), bt('fpe-b peq', 'Ver em 3D', () => modo('3d')));
    d.append(ln);
  }

  /* ---------- 3D ---------- */
  async function modo(m){
    if (m === E.modo && (m === '2d' || E.v3)) return;
    if (m === '3d') {
      if (typeof HubPcb3dVista === 'undefined' || !HubPcb3dVista.disponivel()) { toast('esta máquina não tem WebGL: a vista 3D não abre', 'warn', 4000); return; }
      E.modo = '3d'; cv.hidden = true; v3host.hidden = false; dica.textContent = 'arrastar gira · botão direito arrasta · roda aproxima · 0 topo · 8 isométrica · 2 volta ao 2D';
      if (!E.v3) {
        try { E.v3 = await HubPcb3dVista.cria(v3host, {}); }
        catch (e) { toast('a vista 3D não abriu: ' + (e && e.message || e), 'err', 5000); E.modo = '2d'; cv.hidden = false; v3host.hidden = true; return; }
      }
      cena3d(); E.v3.pose('iso');
    } else {
      E.modo = '2d'; cv.hidden = false; v3host.hidden = true; dica.textContent = ''; ferramenta(E.tool); mede(); pede();
    }
    b2.classList.toggle('on', E.modo === '2d'); b3.classList.toggle('on', E.modo === '3d');
    b2.setAttribute('aria-pressed', String(E.modo === '2d')); b3.setAttribute('aria-pressed', String(E.modo === '3d'));
    status();
  }
  function cena3d(){
    if (!E.v3 || typeof HubPcb3dModelo === 'undefined') return;
    const bb = caixaFp(), m = 1.5;
    const B = { x1:bb.x1 - m, y1:bb.y1 - m, x2:bb.x2 + m, y2:bb.y2 + m };
    const fp = E.fp;
    const comp = { ref:'FP', footprint:'__fpe__', x:0, y:0, rot:0, layer:'Top', pads:fp.pads };
    const corpos = HubPcb3dModelo.corpos({ components:[comp] }, null, {
      pcblib3dHub:{ footprints:{ __fpe__:{ bodies:fp.bodies } }, models:lib.models }, baseLib:'Libs/', placeholder:false });
    E.v3.cena({
      lacos:[[[B.x1, B.y1], [B.x2, B.y1], [B.x2, B.y2], [B.x1, B.y2]]], esp:1.6, bbox:B,
      furos:fp.pads.filter(p => p.drill > 0).map(p => ({ x:p.x, y:p.y, r:p.drill / 2 })),
      pintaFace(c, lado){
        c.fillStyle = '#1d6b34'; c.fillRect(B.x1, B.y1, B.x2 - B.x1, B.y2 - B.y1);
        c.fillStyle = '#d7d9de';
        for (const p of fp.pads) if (p.layer === 'Multi' || p.type === 'th' || (lado === 'top' ? p.layer === 'Top' : p.layer === 'Bottom')) { caminhoPad(c, p); c.fill(); }
        if (lado === 'top') {
          c.strokeStyle = '#f4f4f4'; c.lineCap = 'round';
          for (const o of fp.silk) { c.lineWidth = o.w || 0.15; c.beginPath(); if (o.kind === 'arc') c.arc(o.cx, o.cy, o.r, o.sa * RAD, o.ea * RAD, false); else { c.moveTo(o.x1, o.y1); c.lineTo(o.x2, o.y2); } c.stroke(); }
        }
      },
      corpos,
    });
  }

  /* ---------- status ---------- */
  function status(){
    stGrade.textContent = 'Grade ' + (GRADES.find(g => Math.abs(g[0] - E.grade) < 1e-9) || [0, fmt(E.grade)])[1];
    stCont.textContent = E.fp.pads.length + ' pads · ' + E.fp.bodies.length + ' corpo(s) 3D';
    bSalvar.disabled = !E.sujo;
    if (bUndo) bUndo.disabled = !E.undo.length;
    if (bRedo) bRedo.disabled = !E.redo.length;
    vazioHint.hidden = !E.vazio || E.modo === '3d';
    if (HUB) for (const x of caixa.querySelectorAll('.symed-save, .fpe-acoes-hub')) x.classList.toggle('fpe-esconde', !!E.vazio);
    if (HUB) marcaLinha();
    for (const b of bExtras) {
      if (typeof b._x.rotulo === 'function') { try { b.textContent = b._x.rotulo(ctrl); } catch (e) { /* ok */ } }
      if (typeof b._x.ativo === 'function') { try { b.disabled = !b._x.ativo(ctrl); } catch (e) { /* ok */ } }
    }
  }

  /* ---------- salvar / fechar ---------- */
  async function salvar(nomeNovo){
    if (!HF) return false;
    const d = dlg();
    const fp = JSON.parse(JSON.stringify(E.fp));
    if (nomeNovo) fp.name = nomeNovo;
    const erros = HF.valida(fp);
    if (erros.length) { if (d) await d.alert(erros.join('\n'), { title:'O footprint não pode ser salvo' }); return false; }
    const ja = HF.acha(lib, fp.name);
    if (fp.name !== E.nome0 && (ja || acharAlt(fp.name)) && d &&
        !(await d.confirm('Já existe um footprint "' + fp.name + '"' + (ja ? ' na biblioteca do hub' : ' no Altium') + '. Substituir no hub?', { title:'Salvar', ok:'Substituir' }))) return false;
    const agora = new Date().toISOString();
    fp.hub = Object.assign({}, fp.hub || {}, { editado:agora });
    if (!fp.hub.criado) fp.hub.criado = agora;
    if (!fp.hub.base && acharAlt(E.nome0)) fp.hub.base = E.nome0;
    fp.bbox = HF.bbox(fp);
    HF.poe(lib, fp);
    try { await HF.grava(lib); }
    catch (e) { if (d) await d.alert('Não gravou o Libs/pcblib-hub.js: ' + (e && e.message || e), { title:'Salvar' }); return false; }
    E.fp = fp; E.nome0 = fp.name; E.deHub = true; E.sujo = false; E.sel.clear();
    salvos.push(fp.name);
    titulo(); montaLista(); props(); status();
    toast('footprint "' + fp.name + '" salvo na biblioteca do hub', 'ok');
    if (typeof o.aoSalvar === 'function') { try { await o.aoSalvar(fp, lib); } catch (e) { console.warn('aoSalvar', e); } }
    return true;
  }
  async function salvarComo(){
    const nome = await pedeNome(E.fp.name, 'Salvar como (nome do footprint)');
    if (!nome) return;
    await salvar(nome);
  }
  async function fechar(forca){
    if (forca !== true && !(await podeSair())) return false;
    document.removeEventListener('keydown', tecla, true);
    if (root.HubFpEditor.atual && root.HubFpEditor.atual.E === E) root.HubFpEditor.atual = null;
    if (ro) ro.disconnect();
    if (E.v3) E.v3.destroi();
    fundo.remove();
    resolve({ salvos, lib });
    return true;
  }

  /* ---------- teclado (captura: a vista de baixo nao ve nada enquanto o editor esta aberto) ---------- */
  function tecla(e){
    const scrim = document.querySelector('.hd-scrim');
    if (scrim && !scrim.hidden) return;                  /* um modal do hub por cima: e dele */
    /* embutido, o resto do hub continua na tela: so e do editor a tecla com o foco DENTRO dele
       (o canvas pega o foco no clique) -- a busca da esquerda e as outras abas seguem com as suas */
    if (embutido && (!fundo.isConnected || fundo.hidden || !fundo.contains(document.activeElement))) return;
    e.stopPropagation();
    const t = e.target;
    const campoTxt = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (k === 's' || k === 'S')) { e.preventDefault(); salvar(); return; }
    if (campoTxt) { if (k === 'Escape') { t.blur(); e.preventDefault(); } return; }
    if (k === 'Escape') {
      e.preventDefault();
      if (menuAberto) { fechaMenu(); return; }
      if (E.prefixo) { E.prefixo = null; stMsg.textContent = ''; return; }
      if (E.draft) { E.draft = null; pede(); return; }
      if (E.tool !== 'sel') { ferramenta('sel'); return; }
      if (E.sel.size) { E.sel.clear(); props(); pede(); return; }
      /* o Esc nao fecha o editor: no Altium ele so cancela, e e a tecla mais apertada em
         sequencia -- fechar e no X */
      return;
    }
    if (ctrl && (k === 'z' || k === 'Z')) { e.preventDefault(); volta(E.undo, E.redo); return; }
    if (ctrl && (k === 'y' || k === 'Y')) { e.preventDefault(); volta(E.redo, E.undo); return; }
    if (ctrl && (k === 'a' || k === 'A')) { e.preventDefault(); E.sel = new Set([...E.fp.pads, ...E.fp.silk, ...E.fp.bodies]); props(); pede(); return; }
    if (ctrl && (k === 'd' || k === 'D')) { e.preventDefault(); duplica(); return; }
    if (ctrl) return;
    const L = k.length === 1 ? k.toUpperCase() : k;
    /* as sequencias do Altium: P,P P,L P,A P,B P,E e V,F */
    if (E.prefixo) {
      const p = E.prefixo; E.prefixo = null; stMsg.textContent = '';
      e.preventDefault();
      if (p === 'P') { if (L === 'P') ferramenta('pad'); else if (L === 'L') ferramenta('linha'); else if (L === 'A') ferramenta('arco'); else if (L === 'B') poeStep(); else if (L === 'E') poeCorpo('extruded'); }
      else if (p === 'V' && L === 'F') enquadra();
      return;
    }
    if (L === 'P' || L === 'V') { E.prefixo = L; stMsg.textContent = L + ', …'; e.preventDefault(); return; }
    if (E.modo === '3d' && E.v3) {
      if (k === '0') { E.v3.pose('topo'); return; }
      if (k === '8') { E.v3.pose('iso'); return; }
      if (k === '9') { E.v3.gira(90); return; }
    }
    if (k === '2') { modo('2d'); return; }
    if (k === '3') { modo('3d'); return; }
    if (L === 'F') { enquadra(); return; }
    if (L === 'Q') { trocaUnid(); return; }
    if (L === 'G') { const i = GRADES.findIndex(g => Math.abs(g[0] - E.grade) < 1e-9); E.grade = GRADES[(i + 1) % GRADES.length][0]; gravaPref(); montaBarra(); status(); pede(); return; }
    if (k === ' ') { e.preventDefault(); gira90(); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); apaga(); return; }
    if (k === 'Tab' && E.tool !== 'sel') { e.preventDefault(); const f = pr.querySelector('input, select'); if (f) f.focus(); return; }
    const setas = { ArrowLeft:[-1, 0], ArrowRight:[1, 0], ArrowUp:[0, 1], ArrowDown:[0, -1] };
    if (setas[k] && E.sel.size) {
      e.preventDefault(); antes();
      const f = e.shiftKey ? 10 : 1;
      for (const x of E.sel) move(x, setas[k][0] * E.grade * f, setas[k][1] * E.grade * f);
      mudou(); return;
    }
  }
  document.addEventListener('keydown', tecla, true);

  /* ---------- comeco ---------- */
  montaBarra(); montaAbas();
  b2.classList.add('on'); b2.setAttribute('aria-pressed', 'true'); b3.setAttribute('aria-pressed', 'false');
  carregaFp(o.nome || (o.fp && o.fp.name) || null, o.fp || null);
  mede(); enquadra();
  setTimeout(() => cv.focus(), 30);
  if (o.modo3d) modo('3d');
  if (typeof o.aoMontar === 'function') { try { o.aoMontar(ctrl); } catch (e) { console.warn('aoMontar', e); } }
  /* gancho de teste (o smoke por CDP), como o __hubPcb da vista PCB: nao e contrato */
  root.HubFpEditor.atual = { E, recebeStep, modo, salvar, fechar, ferramenta, carregaFp:n => carregaFp(n),
    estado:() => ({ nome:E.fp.name, sujo:E.sujo, modo:E.modo, tool:E.tool, pads:E.fp.pads.length, silk:E.fp.silk.length,
                    corpos:E.fp.bodies.map(b => ({ kind:b.kind, raw:b.raw, model:b.model, bb:E.bbStep.get(b) || null })),
                    v3:E.v3 ? E.v3.estado() : null }) };
}

root.HubFpEditor = { abre };
})(typeof self !== 'undefined' ? self : this);
