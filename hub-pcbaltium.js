/* AltiumPCBMirror v2 - hub-pcbaltium.js — os menus e as Preferences do editor PCB do Altium 21.

   Pedido do dono (2026-10-14): "deixar a visualizacao do electron na criacao de PCB identica ao
   do altium, quando clica no componente o menu de opcao, as configuracoes de ferramentas
   atalhos ... mantendo a identidade visual dele, mas os menu de configuracao, iguais ao do
   altium". Tudo aqui sai do proprio Altium:
   - os MENUS (barra de cima, botao direito, as teclas que abrem menu: P, D, T, U...) sao as
     arvores do AdvPcb.rcs, lidas pelo hub-altiumdna.js: `MNPCBMenu` (a barra), `MNPCB_Primitive`
     ("Right Mouse Click Primitive", AdvPcb.rcs l. 2290) e `MNPCB_FreeSpace` ("Right Mouse Click
     Free Space", l. 2258), com a mesma ordem, os mesmos separadores e os mesmos rotulos;
   - as PREFERENCES (Tools » Preferences, T,P) seguem as paginas "PCB Editor" do Altium, com os
     rotulos dos formularios Delphi gravados no Advpcb.dll (TSystemOptions_Frame,
     TRoutingSystemOptions_Frame, TMouseConfigurationOptions_Frame, TSystemDefaultPrimitives_Frame,
     TSystemOptionsLayerColors_Frame -- docs/altium-dna/README.md, "As Preferences").
   A cara e a do hub (hub-tema.css): so a estrutura e as palavras sao do Altium.

   Comando do Altium que o hub faz vira a acao do hub (o MAPA, plid -> acao da vista); o que o hub
   ainda nao faz aparece CINZA, com o porque na dica -- como o Altium acinzenta o que nao cabe.
   Submenu de contexto sem nada que funcione some (o EmptyAction=Hide das arvores).

   HubPcbAltium.instala(V) -> { contexto(sx, sy, ctx), popup(letra, sx, sy), aberto(), fecha(),
                                preferencias(pagina?), barra(el) }
   V: fazAcao(id), teclaDe(id), ctx() (o estado: sel, comp, net, edit, grade...), grades(),
      prefs() / aplicaPrefs(p) / prefsPadrao(), camadas(), toast(t, tipo). */
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubPcbAltium = m;
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

/* ============================== o mapa: comando do Altium -> acao do hub ==============================
   q = o que precisa existir para valer: 'sel' (alguma selecao), 'comp' (componente na selecao),
   'net' (objeto com net), 'edit' (nao vale no lean). Sem q, vale sempre. */
const A = (a, q) => ({ a, q });
const MAPA = {
  /* File */
  'PLWorkspaceManager:SaveDocument': A('salvar'), 'PLWorkspaceManager:SaveAll': A('salvar'),
  'PLWorkspaceManager:ExportToPDF': A('pdf'), 'PLWorkspaceManager:NewPCB': A('novaPlaca'),
  /* Edit */
  'PLPCB:Undo': A('desfazer'), 'PLPCB:Redo': A('refazer'),
  'PLPCB:Cut': A('recortar', 'sel'), 'PLPCB:Copy': A('copiar', 'sel'), 'PLPCB:Paste': A('colar'),
  'PLPCB:DeleteObjects': A('apagar', 'sel'), 'PLPCB:RubberStamp': A('duplicar', 'sel'),
  'PLPCB:SelectAll': A('tudo'), 'PLPCB:DeSelectAll': A('desselecionar', 'sel'),
  'PLPCB:SelectNet': A('selNet', 'net'), 'PLPCB:SelectComponentNets': A('selNetsComp', 'comp'),
  'PLPCB:SelectSingleComponentNets': A('selNetsComp', 'comp'),
  'PLPCB:RotateSelectedObjects': A('girar', 'sel'), 'PLPCB:FlipSelectedObjects': A('virarSel', 'comp'),
  'PLPCB:FindSimilarObjects': null, 'PLPCB:FindSimilarObjectsUnderCursor': null,
  'PLPCB:ClearFilter': A('limparFiltro'),
  'PLPCB:MoveComponentOriginToGrid': A('compNaGrade', 'comp'), 'PLPCB:MoveComponentsToGrid': A('compNaGrade', 'comp'),
  'PLPCB:PopupMoveComponentsToGrid': A('compNaGrade', 'comp'),
  /* Align (o menu Edit e o popup A tem plids diferentes para o mesmo comando) */
  'PLPCB:AlignComponentsLeft': A('alinharEsq', 'sel'), 'PLPCB:PopupAlignComponentsLeft': A('alinharEsq', 'sel'),
  'PLPCB:AlignComponentsRight': A('alinharDir', 'sel'), 'PLPCB:PopupAlignComponentsRight': A('alinharDir', 'sel'),
  'PLPCB:AlignComponentsTop': A('alinharTopo', 'sel'), 'PLPCB:PopupAlignComponentsTop': A('alinharTopo', 'sel'),
  'PLPCB:AlignComponentsBottom': A('alinharBase', 'sel'), 'PLPCB:PopupAlignComponentsBottom': A('alinharBase', 'sel'),
  'PLPCB:AlignComponentsCenterHorizontal': A('alinharCentroH', 'sel'), 'PLPCB:PopupAlignComponentsCenterHorizontal': A('alinharCentroH', 'sel'),
  'PLPCB:AlignComponentsCenterVertical': A('alinharCentroV', 'sel'), 'PLPCB:PopupAlignComponentsCenterVertical': A('alinharCentroV', 'sel'),
  'PLPCB:AlignComponentsSpreadHorizontal': A('distribuirH', 'sel'), 'PLPCB:PopupAlignComponentsSpreadHorizontal': A('distribuirH', 'sel'),
  'PLPCB:AlignComponentsSpreadVertical': A('distribuirV', 'sel'), 'PLPCB:PopupAlignComponentsSpreadVertical': A('distribuirV', 'sel'),
  /* View */
  'PLPCB:ViewFitBoard': A('enquadrar'), 'PLPCB:ViewFitDocument': A('enquadrar'),
  'PLPCB:ViewSelectedObjects': A('enquadrarSel', 'sel'), 'PLPCB:PopupRightMouseFitSelected': A('enquadrarSel', 'sel'),
  'PLPCB:ViewZoomIn': A('zoomIn'), 'PLPCB:PopupRightMouseZoomIn': A('zoomIn'),
  'PLPCB:ViewZoomOut': A('zoomOut'), 'PLPCB:PopupRightMouseZoomOut': A('zoomOut'),
  'PLPCB:FlipBoard': A('virar'), 'PLPCB:ToggleUnits': A('unidade'), 'PLPCB:ToggleVisibleGridKind': A('grade'),
  'PLPCB:ShowAllNets': A('conexoesOn'), 'PLPCB:PopupShowConnectionsAll': A('conexoesOn'),
  'PLPCB:HideAllNets': A('conexoesOff'), 'PLPCB:PopupHideConnectionsAll': A('conexoesOff'),
  'PLPCB:ShowNet': A('realcarNet', 'net'), 'PLPCB:PopupShowConnectionsNet': A('realcarNet', 'net'),
  'PLPCB:PopupShowConnectionsOnSingleNet': A('realcarNet', 'net'),
  'PLPCB:DifferenceOverlayShowHide': A('diff'),
  'PLPCB:ToggleSingleLayerMode': A('camadaUnica'),
  'PLPCB:PopupSnapGridOther': A('painelGrade'), 'PLPCB:RunGridPropertiesEditor': A('painelGrade'),
  /* Place */
  'PLManRoute:Track': A('trilha', 'edit'), 'PLManRoute:AdvancedRouting': A('trilha', 'edit'),
  'PLPCB:PlaceVia': A('via', 'edit'), 'PLManRoute:PlaceLine': A('linha', 'edit'),
  'PLPCB:PlaceArcCenter': A('arco', 'edit'), 'PLPCB:PlaceArcEdge': A('arco', 'edit'), 'PLPCB:PlaceArcAnyAngle': A('arco', 'edit'),
  'PLPCB:PlaceFullCircle': A('circulo', 'edit'),
  'PLPCB:PlaceFill': A('fill', 'edit'), 'PLPCB:PlaceSolidRegion': A('solidRegion', 'edit'),
  'PLPCB:PlaceRectangle': A('retanguloContorno', 'edit'),
  'PLPCB:PlaceString': A('texto', 'edit'), 'PLPCB:PlacePad': A('pad', 'edit'),
  'PLPCB:PlacePolygonPlane': A('pour', 'edit'),
  'PLPCB:PlaceBoardCutout': A('furo', 'edit'), 'PLPCB:PlaceBoardCutoutBPM': A('furo', 'edit'),
  'PLPCB:RedefineBoardShape': A('contorno', 'edit'),
  'PLPCB:CreateCommentThread': A('sinalizar', 'edit'),
  /* Design / Tools / Reports */
  'PLPCB:CompareAndUpdateMe': A('atualizarPcb', 'edit'), 'PLPCB:DesignRules': A('regras'),
  'PLPCB:DesignRuleCheck': A('drc'),
  'PLPCB:RepourAllPolygonsNoContext': A('repour', 'edit'), 'PLPCB:RepourPolygonsNoContext': A('repour', 'edit'),
  'PLPCB:RepourModified': A('repour', 'edit'),
  'PLPCB:TearDrops': A('teardrops', 'edit'),
  'PLPCB:SetupPreferences': A('preferencias'), 'PLPCB:PopupOptionsPreferences': A('preferencias'),
  'PLPCB:MeasureDistance': A('medir'), 'PLPCB:ReportBoardSpecs': A('boardInfo'),
  'PLPCB:PopupRightMouseProperties': A('propriedades'),
  /* Toolbars » Customize e Help */
  'PLClient:CustomizeResources': A('atalhos'), 'PLClient:HelpShortcutKeys': A('ajuda'), 'PLClient:HelpAbout': A('sobre'),
};
/* a vista Esquema (schframe.js » fazAcao): os comandos do Altium que ela ja faz */
const MAPA_SCH = {
  'PLWorkspaceManager:SaveDocument': A('salvar'), 'PLWorkspaceManager:SaveAll': A('salvar'),
  'PLSch:Undo': A('desfazer'), 'PLSch:Redo': A('refazer'),
  'PLSch:SelectAllObjects': A('tudo'), 'PLSch:DeleteObjects': A('apagar', 'sel'),
  'PLSch:RotateSelectedObjectsCCW': A('girar', 'sel'),
  'PLSch:ZoomAll': A('enquadrar'), 'PLSch:ZoomDocument': A('enquadrar'),
  'PLSch:ToggleVisibleGrid': A('grade'),
  'PLSch:PlacePart': A('add'), 'PLSch:PlacePowerPort': A('terra'), 'PLSch:PlaceWire': A('fio'),
  'PLSch:PlaceNetLabel': A('rotulo'), 'PLSch:PlaceNoERCGeneric': A('noerc'),
  'PLSch:SetTemplateFromLocal': A('template'), 'PLSch:DocumentPreferencesSchDocumentOptions': A('folha'),
};
/* o rotulo no idioma do hub (hub-menutrad.js); sem o modulo, o do Altium */
const TR = r => (typeof HubMenuTrad !== 'undefined' ? HubMenuTrad.t(r) : r);
/* o porque do cinza, quando nao e so "ainda nao existe" */
const PORQUE = {
  'PLPCB:PlaceComponent': 'componente entra pelo esquema: Design » Import Changes (D,I)',
  'PLPCB:FindSimilarObjects': 'ainda não existe no EletricHUB — use o filtro de seleção do painel',
  'PLPCB:FindSimilarObjectsUnderCursor': 'ainda não existe no EletricHUB — use o filtro de seleção do painel',
};
const NAO_TEM = 'ainda não existe no EletricHUB';
/* comandos que o Altium so mostra em situacao propria (o rotulo e o nome interno, sem espaco:
   DeleteWIP, NewRTF, AddImporter...) -- la eles nao aparecem no uso comum, aqui tambem nao */
const INTERNO = r => /^[A-Z][a-z]+[A-Z]\w*$/.test(r) && r !== 'ActiveRoute';
const OCULTOS = new Set(['PLPCB:TASKINGPinSwap', 'PLPCB:ConvertToGeneric']);
/* Fabrication Outputs e Assembly Outputs sao listas dinamicas no Altium (os outputers instalados):
   aqui entram as saidas que o hub gera */
const DINAMICOS = {
  'Fabrication Outputs': [{ rotulo:'Gerber Files', acao:'gerber' }, { rotulo:'NC Drill Files', acao:'gerber' }],
  'Assembly Outputs': [{ rotulo:'Assembly Drawings', acao:'pdf' }],
  'Export': [{ rotulo:'Gerber (.zip)', acao:'gerber' }, { rotulo:'PDF (layout)', acao:'pdf' }],
};

/* ============================== CSS (no tema do hub) ============================== */
const CSS = `
#apMenubar, .apbarra{flex:none; display:flex; align-items:stretch; height:26px; padding:0 4px; background:var(--panel, var(--surface-2));
  border-bottom:1px solid var(--border, var(--edge)); user-select:none; font:12.5px var(--font);}
.apbarra .apb{padding:0 9px; border:0; background:transparent; color:var(--fg, var(--text)); cursor:default; font:inherit; border-radius:3px; margin:2px 0;}
.apbarra .apb:hover, .apbarra .apb.on{background:rgba(var(--tint),0.10);}
.apbarra .apb u{text-decoration:none;}
.apbarra.alt .apb u{text-decoration:underline;}
.apm{position:fixed; z-index:70; min-width:220px; max-width:420px; max-height:calc(100vh - 12px); overflow-y:auto; padding:3px;
  background:var(--panel, var(--surface-2)); border:1px solid var(--border, var(--edge)); border-radius:5px;
  box-shadow:var(--shadow-menu); font:12.5px var(--font); color:var(--fg, var(--text)); user-select:none;}
.apm .api{display:grid; grid-template-columns:18px minmax(0,1fr) auto 12px; align-items:center; gap:6px; padding:3px 6px 3px 4px;
  border-radius:3px; white-space:nowrap; cursor:default; line-height:18px;}
.apm .api .ck{font-size:11px; text-align:center; color:var(--hi);}
.apm .api .rt{overflow:hidden; text-overflow:ellipsis;}
.apm .api .tk{font:11px var(--mono); color:var(--fg-dim, var(--text-2)); padding-left:18px;}
.apm .api .sb{font-size:9px; color:var(--fg-dim, var(--text-2)); text-align:right;}
.apm .api.ativo{background:rgba(var(--tint),0.11);}
.apm .api.off{opacity:.42;}
.apm .api.off.ativo{background:rgba(var(--tint),0.05);}
.apm .aps{height:1px; margin:3px 6px; background:var(--border, var(--edge));}
.apm .apt{padding:4px 8px 3px 28px; font-size:10px; letter-spacing:.07em; text-transform:uppercase; color:var(--fg-dim, var(--text-2));
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.apm u{text-decoration:underline; text-underline-offset:2px;}

/* Preferences: a janela do Altium (arvore a esquerda, pagina a direita, botoes embaixo) */
.apf-fundo{position:fixed; inset:0; z-index:80; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; padding:16px;}
.apf{width:min(980px, 100%); height:min(680px, 100%); display:flex; flex-direction:column; background:var(--panel2, var(--surface));
  border:1px solid var(--border, var(--edge)); border-radius:8px; box-shadow:var(--shadow-menu); font:12.5px/1.45 var(--font);
  color:var(--fg, var(--text)); overflow:hidden;}
.apf-tit{flex:none; display:flex; align-items:center; gap:8px; padding:9px 12px; border-bottom:1px solid var(--border, var(--edge));
  background:var(--panel, var(--surface-2)); font-weight:600;}
.apf-tit .x{margin-left:auto; width:26px; height:24px; border:0; border-radius:4px; background:transparent; color:var(--fg-dim, var(--text-2)); cursor:pointer; font-size:15px;}
.apf-tit .x:hover{background:rgba(var(--tint),0.1); color:var(--fg, var(--text));}
.apf-corpo{flex:1; min-height:0; display:flex;}
.apf-arv{flex:none; width:230px; overflow:auto; padding:6px 4px; border-right:1px solid var(--border, var(--edge)); background:var(--panel, var(--surface-2));}
.apf-arv .no{display:flex; align-items:center; gap:5px; padding:3px 6px; border-radius:3px; cursor:pointer; white-space:nowrap;}
.apf-arv .no:hover{background:rgba(var(--tint),0.07);}
.apf-arv .no.on{background:rgba(var(--tint),0.13); box-shadow:inset 2px 0 0 var(--hi);}
.apf-arv .no.pasta{font-weight:600;}
.apf-arv .no.pasta .tri{display:inline-block; width:10px; font-size:9px; color:var(--fg-dim, var(--text-2));}
.apf-arv .no.folha{padding-left:24px;}
.apf-arv .no.cinza{color:var(--fg-dim, var(--text-2)); cursor:default;}
.apf-arv .no.cinza:hover{background:transparent;}
.apf-pag{flex:1; min-width:0; overflow:auto; padding:12px 16px 18px;}
.apf-pag h2{font-size:14px; font-weight:600; margin:0 0 10px; color:var(--fg, var(--text));}
.apf-grp{border:1px solid var(--border, var(--edge)); border-radius:5px; margin:0 0 12px; padding:8px 10px 10px;}
.apf-grp > .gt{font-size:11px; font-weight:600; letter-spacing:.02em; color:var(--fg, var(--text)); margin:0 0 6px;}
.apf-col{display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:3px 18px;}
.apf .ck{display:flex; align-items:center; gap:7px; padding:2px 0; cursor:pointer;}
.apf .ck input{accent-color:var(--hi); margin:0;}
.apf .ck.off{opacity:.45; cursor:not-allowed;}
.apf .lin{display:grid; grid-template-columns:190px minmax(0, 240px) auto; align-items:center; gap:4px 10px; margin:3px 0;}
.apf .lin > .k{color:var(--fg-dim, var(--text-2));}
.apf .lin .un{font-size:11px; color:var(--fg-dim, var(--text-2));}
.apf input[type=text], .apf select{width:100%; box-sizing:border-box; background:var(--panel, var(--surface-2)); color:var(--fg, var(--text));
  border:1px solid var(--border, var(--edge)); border-radius:3px; padding:3px 6px; font:12px var(--font);}
.apf input[type=text]{font-family:var(--mono);}
.apf input[type=text]:focus, .apf select:focus{outline:none; border-color:var(--hi);}
.apf .nota{font-size:11px; color:var(--fg-dim, var(--text-2)); margin:4px 0 0; line-height:1.4;}
.apf table{border-collapse:collapse; width:100%;}
.apf th, .apf td{border-bottom:1px solid var(--border, var(--edge)); padding:4px 8px; text-align:left; white-space:nowrap;}
.apf th{font-weight:600; color:var(--fg-dim, var(--text-2)); font-size:11px;}
.apf td.c, .apf th.c{text-align:center;}
.apf td input[type=checkbox]{accent-color:var(--hi);}
.apf .cor{display:inline-flex; align-items:center; gap:8px;}
.apf .cor input[type=color]{width:34px; height:20px; padding:0; border:1px solid var(--border, var(--edge)); border-radius:3px; background:transparent; cursor:pointer;}
.apf .cor .sw{width:14px; height:14px; border-radius:2px; box-shadow:0 0 0 1px var(--line);}
.apf .btn{display:inline-flex; align-items:center; gap:6px; padding:4px 12px; font:12px var(--font); border-radius:4px; background:transparent;
  color:var(--fg, var(--text)); border:1px solid var(--border, var(--edge)); cursor:pointer;}
.apf .btn:hover{border-color:var(--hi);}
.apf .btn.pri{background:var(--hi); color:var(--on-hi); border-color:var(--hi);}
.apf .btn:disabled{opacity:.4; cursor:not-allowed;}
.apf-rod{flex:none; display:flex; align-items:center; gap:8px; padding:9px 12px; border-top:1px solid var(--border, var(--edge)); background:var(--panel, var(--surface-2));}
.apf-rod .esp{flex:1;}
.apf-pag .hat{margin:-4px -6px 0;}
`;
function poeCss() {
  if (document.getElementById('hubPcbAltiumCss')) return;
  const s = document.createElement('style');
  s.id = 'hubPcbAltiumCss';
  s.textContent = CSS;
  document.head.append(s);
}
function el(tag, cls, txt) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
}
const produto = s => String(s || '').replace(/%PRODUCTNAME%/gi, 'EletricHUB');
/* o rotulo com a letra do acelerador sublinhada (a primeira ocorrencia, como o & do Windows) */
function rotuloComLetra(rot, letra) {
  const f = document.createDocumentFragment();
  const i = letra ? rot.toUpperCase().indexOf(letra.toUpperCase()) : -1;
  if (i < 0) { f.append(rot); return f; }
  const u = el('u', null, rot[i]);
  f.append(rot.slice(0, i), u, rot.slice(i + 1));
  return f;
}
const ultimaLetra = acel => { const p = String(acel || '').split(','); const l = p[p.length - 1]; return l && l.length === 1 ? l : ''; };

/* ============================== preferencias: o que existe e o padrao ============================== */
/* A roda do mouse: as quatro acoes que o hub faz, com as teclas que as escolhem. O padrao da casa
   e o de sempre (roda = zoom, Shift = andar para o lado, Ctrl+Shift = trocar de camada); o do
   Altium vem pelo botao (Ctrl+roda = zoom, roda = rolar na vertical). */
const RODA = [
  { id:'zoom',       rot:'Zoom Main Window' },
  { id:'vertical',   rot:'Vertical Scroll' },
  { id:'horizontal', rot:'Horizontal Scroll' },
  { id:'camada',     rot:'Change Layer' },
];
const RODA_CASA = { zoom:'', vertical:'Alt', horizontal:'Shift', camada:'Ctrl+Shift' };
const RODA_ALTIUM = { zoom:'Ctrl', vertical:'', horizontal:'Shift', camada:'Ctrl+Shift+Alt' };
const CURSORES = [['small90', 'Small 90'], ['large90', 'Large 90'], ['small45', 'Small 45'], ['tiny45', 'Tiny 45']];
const CONFLITO_ALTIUM = [
  ['ignorar', 'Ignore Obstacles'], ['contornar', 'Walkaround Obstacles'], ['empurrar', 'Push Obstacles'],
  ['abraçar', 'Hug And Push Obstacles'], ['parar', 'Stop At First Obstacle'],
  ['autoAtual', 'AutoRoute On Current Layer'], ['autoMulti', 'AutoRoute On Multiple Layers'],
];
const CONFLITO_TEM = new Set(['ignorar', 'contornar', 'parar']);

/* ============================== o modulo ============================== */
function instala(V) {
  poeCss();
  const DNA = (typeof HubAltiumDNA !== 'undefined') ? HubAltiumDNA : null;
  const VISTA = V.vista || 'pcb';
  const MAP = VISTA === 'sch' ? MAPA_SCH : MAPA;
  const pilha = [];                 /* os niveis abertos: {el, itens, idx} */
  let barraEl = null, barraAberta = -1, porTeclado = false;

  /* ---------------- do DNA para itens de menu ---------------- */
  function condicaoOk(q, c) {
    if (!q) return true;
    if (q === 'sel') return c.sel > 0;
    if (q === 'comp') return !!c.comp;
    if (q === 'net') return !!c.net;
    if (q === 'edit') return !c.lean;
    return true;
  }
  function gradeDoPlid(plid) {
    if (!DNA || !/PopupSnapGrid(X|Y)?[\d.]+(Mil|mm)$/i.test(plid) || /PopupSnapGrid[XY]/.test(plid)) return null;
    const c = DNA.comando('pcb', plid);
    const m = c && /Size\s*=\s*([\d.]+)\s*(mil|mm)/i.exec(c.params || '');
    if (!m) return null;
    const mm = /mil/i.test(m[2]) ? parseFloat(m[1]) * 0.0254 : parseFloat(m[1]);
    const g = (V.grades() || []).find(x => Math.abs(x.mm - mm) < 1e-6);
    return g ? g.id : '';
  }
  function itemDoPlid(n, c, modo) {
    const rot = produto(TR(n.rotulo));
    const it = { rot, letra:ultimaLetra(n.acelerador), plid:n.plid, dica:'' };
    const gid = gradeDoPlid(n.plid);
    if (gid !== null) {
      if (gid) { it.f = () => V.fazAcao('gradeId', gid); it.check = V.ctx().grade === gid; }
      else { it.off = true; it.dica = 'passo de grade que o hub não tem'; }
      return it;
    }
    const m = MAP[n.plid];
    if (m) {
      const ok = condicaoOk(m.q, c);
      const t = V.teclaDe(m.a) || '';
      it.tecla = t.indexOf(',') >= 0 ? '' : t;          /* a sequencia ja e a letra sublinhada; a coluna e da tecla direta, como no Altium */
      it.acao = m.a;
      if (ok) it.f = () => V.fazAcao(m.a);
      else { it.off = true; it.dica = m.q === 'sel' ? 'precisa de uma seleção' : m.q === 'comp' ? 'precisa de um componente' : m.q === 'net' ? 'precisa de um objeto com net' : 'só no editor'; }
      if (m.a === 'conexoesOn') it.check = c.conexoes;
      if (m.a === 'diff') it.check = c.ghost;
      if (m.a === 'virar') it.check = c.flip;
      if (m.a === 'camadaUnica') it.check = c.unica;
    } else {
      it.off = true;
      it.dica = PORQUE[n.plid] || NAO_TEM;
      const t = (n.teclas || [])[0];
      if (t && modo !== 'contexto') it.teclaAltium = t;
    }
    return it;
  }
  /* converte uma lista do DNA; `modo` 'barra' (tudo, o que nao funciona cinza) ou 'contexto' (o
     submenu sem nada que funcione some, o EmptyAction=Hide) */
  function converte(lista, c, modo) {
    const out = [];
    for (const n of lista || []) {
      if (n.separador) { if (out.length && out[out.length - 1] !== '-') out.push('-'); continue; }
      if (n.dinamico) continue;
      if (n.filhos) {
        const ing = produto(n.rotulo), rot = produto(TR(n.rotulo));
        if (modo === 'contexto') {
          if (ing === 'Component Actions' && !c.comp) continue;
          if (ing === 'Net Actions' && !c.net) continue;
          if (ing === 'Polygon Actions' && !c.poly) continue;
          if (ing === 'Align' && !c.sel) continue;
        }
        let filhos = converte(n.filhos, c, modo);
        const din = VISTA === 'pcb' ? DINAMICOS[ing] : null;
        if (din) {
          const extra = din.map(d => ({ rot:TR(d.rotulo), f:() => V.fazAcao(d.acao), tecla:V.teclaDe(d.acao) || '', acao:d.acao }));
          filhos = extra.concat(filhos.length && filhos[0] !== '-' ? ['-'] : [], filhos);
        }
        filhos = limpaSep(filhos);
        const vivos = filhos.filter(x => x !== '-' && !x.off);
        if (modo === 'contexto' && !vivos.length) continue;
        out.push({ rot, letra:ultimaLetra(n.acelerador), filhos });
        continue;
      }
      if (!n.plid || OCULTOS.has(n.plid) || INTERNO(n.rotulo)) continue;
      out.push(itemDoPlid(n, c, modo));
    }
    return limpaSep(out);
  }
  function limpaSep(l) {
    const o = [], vistos = new Set();
    for (const x of l) {
      if (x === '-' && (!o.length || o[o.length - 1] === '-')) continue;
      /* o Altium mostra so uma das variantes de mesmo nome (Save to Server..., Discard Local Changes) */
      if (x !== '-' && !x.filhos && x.off && vistos.has(x.rot)) continue;
      if (x !== '-') vistos.add(x.rot);
      o.push(x);
    }
    while (o.length && o[o.length - 1] === '-') o.pop();
    return o;
  }

  /* ---------------- desenho dos niveis ---------------- */
  function fechaDe(n) {
    while (pilha.length > n) { const p = pilha.pop(); clearTimeout(p.timer); p.el.remove(); }
    if (!pilha.length && barraEl) { barraAberta = -1; pintaBarra(); }
  }
  function fecha() { fechaDe(0); porTeclado = false; modoAlt(false); }
  function aberto() { return pilha.length > 0; }
  function mostraNivel(itens, x, y, opt) {
    opt = opt || {};
    const nivel = pilha.length;
    const m = el('div', 'apm');
    m.setAttribute('role', 'menu');
    const reg = { el:m, itens:[], idx:-1, timer:null };
    if (opt.titulo) m.append(el('div', 'apt', opt.titulo));
    for (const it of itens) {
      if (it === '-') { m.append(el('div', 'aps')); continue; }
      const d = el('div', 'api' + (it.off ? ' off' : ''));
      d.setAttribute('role', 'menuitem');
      d.append(el('span', 'ck', it.check ? '✓' : ''));
      const r = el('span', 'rt'); r.append(rotuloComLetra(it.rot, it.letra)); d.append(r);
      d.append(el('span', 'tk', it.filhos ? '' : (it.tecla || '')));
      d.append(el('span', 'sb', it.filhos ? '▶' : ''));
      const dica = [it.dica, it.teclaAltium ? 'no Altium: ' + it.teclaAltium : ''].filter(Boolean).join(' · ');
      if (dica) d.title = dica;
      const i = reg.itens.length;
      reg.itens.push({ it, d });
      d.addEventListener('mouseenter', () => {
        marca(reg, i);
        clearTimeout(reg.timer);
        reg.timer = setTimeout(() => { if (it.filhos) abreSub(nivel, i); else fechaDe(nivel + 1); }, it.filhos ? 120 : 200);
      });
      d.addEventListener('mousedown', e => e.preventDefault());
      d.addEventListener('click', e => { e.stopPropagation(); ativa(nivel, i); });
      m.append(d);
    }
    document.body.append(m);
    const R = m.getBoundingClientRect();
    let px = x, py = y;
    if (opt.lado) {                    /* submenu: a direita do item; sem espaco, a esquerda */
      px = opt.lado.right - 2; py = opt.lado.top - 4;
      if (px + R.width > innerWidth - 4) px = Math.max(4, opt.lado.left - R.width + 2);
    } else if (px + R.width > innerWidth - 4) px = Math.max(4, innerWidth - R.width - 4);
    if (py + R.height > innerHeight - 4) py = Math.max(4, innerHeight - R.height - 4);
    m.style.left = px + 'px'; m.style.top = py + 'px';
    pilha.push(reg);
    if (opt.teclado) primeiro(reg);
    return reg;
  }
  function marca(reg, i) {
    reg.itens.forEach((x, k) => x.d.classList.toggle('ativo', k === i));
    reg.idx = i;
    const x = reg.itens[i]; if (x) x.d.scrollIntoView({ block:'nearest' });
  }
  function primeiro(reg) { const i = reg.itens.findIndex(x => !x.it.off); if (i >= 0) marca(reg, i); }
  function abreSub(nivel, i) {
    const reg = pilha[nivel]; if (!reg) return null;
    const x = reg.itens[i]; if (!x || !x.it.filhos) return null;
    if (pilha[nivel + 1] && pilha[nivel + 1].dono === i) return pilha[nivel + 1];
    fechaDe(nivel + 1);
    if (!x.it.filhos.length) return null;
    const sub = mostraNivel(x.it.filhos, 0, 0, { lado:x.d.getBoundingClientRect() });
    sub.dono = i;
    return sub;
  }
  function ativa(nivel, i) {
    const reg = pilha[nivel]; if (!reg) return;
    const x = reg.itens[i]; if (!x) return;
    if (x.it.filhos) { const s = abreSub(nivel, i); if (s && porTeclado) primeiro(s); return; }
    if (x.it.off || !x.it.f) { if (x.it.dica) V.toast(x.it.rot + ': ' + x.it.dica, 'info', 2600); return; }
    fecha();
    x.it.f();
  }

  /* ---------------- teclado com menu aberto: setas, Enter, Esc e a letra sublinhada ---------------- */
  let altSolo = false;
  /* a vista embutida no hub do desktop nao tem barra propria: Alt+letra e F10 abrem a do topo */
  function paraOTopo(e) {
    if (!(e.key === 'F10' || (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1))) return false;
    let topo = null;
    try { topo = window.parent !== window && window.parent.EletricMenubar; } catch (er) { topo = null; }
    if (!topo || !topo.tecla(e)) return false;
    e.preventDefault(); e.stopPropagation();
    return true;
  }
  function modoAlt(v) { if (barraEl) barraEl.classList.toggle('alt', !!v); }
  document.addEventListener('keyup', e => {
    if (e.key === 'Alt' && altSolo && barraEl && !pilha.length) { e.preventDefault(); modoAlt(!barraEl.classList.contains('alt')); }
    altSolo = false;
  }, true);
  function tecla(e) {
    altSolo = e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey;
    if (!pilha.length) {
      if (!barraEl) return paraOTopo(e);
      if (e.key === 'F10' && !e.ctrlKey && !e.altKey) { e.preventDefault(); porTeclado = true; abreBarra(0, true); return true; }
      const naAlt = barraEl.classList.contains('alt');
      if ((naAlt || (e.altKey && !e.ctrlKey)) && e.key.length === 1) {
        const L = e.key.toUpperCase();
        const i = botoesBarra.findIndex(x => (x.n.letra || '').toUpperCase() === L);
        modoAlt(false);
        if (i >= 0) { e.preventDefault(); e.stopPropagation(); porTeclado = true; abreBarra(i, true); return true; }
        return false;
      }
      if (naAlt && e.key === 'Escape') { modoAlt(false); e.preventDefault(); e.stopPropagation(); return true; }
      if (naAlt && e.key !== 'Alt') modoAlt(false);
      return false;
    }
    const nivel = pilha.length - 1, reg = pilha[nivel];
    const vivos = reg.itens.map((x, k) => x.it.off ? -1 : k).filter(k => k >= 0);
    const k = e.key;
    porTeclado = true;
    const para = () => { e.preventDefault(); e.stopPropagation(); return true; };
    if (k === 'Escape') {
      if (nivel > 0) fechaDe(nivel); else fecha();
      return para();
    }
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      const todos = reg.itens.map((x, kk) => kk);
      if (!todos.length) return para();
      let p = todos.indexOf(reg.idx);
      p = k === 'ArrowDown' ? (p + 1) % todos.length : (p <= 0 ? todos.length - 1 : p - 1);
      marca(reg, todos[p]);
      return para();
    }
    if (k === 'ArrowRight') {
      const x = reg.itens[reg.idx];
      if (x && x.it.filhos) { const s = abreSub(nivel, reg.idx); if (s) primeiro(s); }
      else if (barraAberta >= 0) abreBarra((barraAberta + 1) % botoesBarra.length, true);
      return para();
    }
    if (k === 'ArrowLeft') {
      if (nivel > 0) fechaDe(nivel);
      else if (barraAberta >= 0) abreBarra((barraAberta - 1 + botoesBarra.length) % botoesBarra.length, true);
      return para();
    }
    if (k === 'Enter' || k === ' ') { if (reg.idx >= 0) ativa(nivel, reg.idx); return para(); }
    if (k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const L = k.toUpperCase();
      const i = reg.itens.findIndex(x => (x.it.letra || '').toUpperCase() === L);
      if (i < 0) { fecha(); return para(); }          /* letra de ninguem: o menu some, como no Altium */
      marca(reg, i);
      ativa(nivel, i);
      return para();
    }
    if (k === 'Tab') return para();
    return false;
  }
  document.addEventListener('keydown', e => { tecla(e); }, true);
  document.addEventListener('mousedown', e => {
    if (!pilha.length) return;
    if (pilha.some(p => p.el.contains(e.target))) return;
    if (barraEl && barraEl.contains(e.target)) return;
    fecha();
  }, true);
  window.addEventListener('blur', () => fecha());
  window.addEventListener('resize', () => fecha());

  /* ---------------- o botao direito ---------------- */
  function arvore(qual, rotulo) {
    if (!DNA) return null;
    const pop = DNA.menu(VISTA, 'popups') || [];
    const n = pop.find(x => x.rotulo === rotulo);
    return n ? n.filhos : null;
  }
  /* o: { primitivo, extras:[itens do hub, no fim] }. Os itens que o hub nao faz ficam cinza no
     lugar (a mesma ordem do Altium); so o submenu inteiro sem nada some */
  function contexto(sx, sy, o) {
    fecha();
    const c = V.ctx();
    const lista = arvore('popups', o && o.primitivo ? 'Right Mouse Click Primitive' : 'Right Mouse Click Free Space');
    let itens = lista ? converte(lista, c, 'contexto') : [];
    if (o && o.extras && o.extras.length) itens = itens.concat(['-'], o.extras);
    mostraNivel(limpaSep(itens), sx, sy, {});
  }
  /* a tecla que abre menu no cursor (o Popup='P' das arvores): P, D, T, U, R, V, E, F, C, J, M, S,
     X, A, G, N, O, Z, Y... o menu inteiro, com as letras sublinhadas */
  function popupDaTecla(letra) {
    if (!DNA) return null;
    const L = String(letra || '').toUpperCase();
    const busca = (lista) => {
      for (const n of lista || []) {
        if (n.filhos && String(n.popup || '').toUpperCase() === L) return n;
      }
      for (const n of lista || []) {
        if (n.filhos) { const r = busca(n.filhos); if (r) return r; }
      }
      return null;
    };
    const principal = DNA.menu(VISTA, 'principal') || [];
    let n = principal.find(x => String(x.popup || '').toUpperCase() === L) || null;
    if (!n) {
      const pops = (DNA.menu(VISTA, 'popups') || []).filter(x => !/^Right Mouse/.test(x.rotulo));
      n = busca(pops) || busca(principal);
    }
    return n;
  }
  function popup(letra, sx, sy) {
    const n = popupDaTecla(letra);
    if (!n) return false;
    fecha();
    porTeclado = true;
    const itens = converte(n.filhos, V.ctx(), 'barra');
    const r = mostraNivel(itens, sx, sy, { titulo:produto(TR(n.rotulo)) });
    primeiro(r);
    return true;
  }

  /* ---------------- a barra de menus (File Edit View Project Place Design Tools Route Reports Window Help) ---------------- */
  let botoesBarra = [], fonteBarra = null;
  /* os menus de cima da vista: [{ ing, rot, letra, filhos }] -- 'ing' e o nome do Altium (a chave
     da fusao com os menus do app), 'rot' o do idioma da vez, 'letra' a do Altium (F, E, V...) */
  function itensBarra() {
    if (!DNA) return [];
    return (DNA.menu(VISTA, 'principal') || []).map(n => ({ ing:produto(n.rotulo), rot:produto(TR(n.rotulo)),
      letra:ultimaLetra(n.acelerador) || n.rotulo[0], filhos:converte(n.filhos, V.ctx(), 'barra') }));
  }
  /* fonte: funcao que devolve a lista de cima (o topo do hub passa a sua); sem ela, a da vista */
  function barra(box, fonte) {
    if (!box) return;
    barraEl = box;
    fonteBarra = typeof fonte === 'function' ? fonte : itensBarra;
    box.id = box.id || 'apMenubar';
    box.classList.add('apbarra');
    box.setAttribute('role', 'menubar');
    redesenhaBarra();
  }
  function redesenhaBarra() {
    if (!barraEl) return;
    fecha();
    barraEl.textContent = '';
    botoesBarra = (fonteBarra() || []).map((x, i) => {
      const b = el('button', 'apb');
      b.type = 'button';
      b.append(rotuloComLetra(x.rot, x.letra));
      if (x.letra && x.rot.toUpperCase().indexOf(x.letra.toUpperCase()) < 0) b.title = 'Alt+' + x.letra + ' (' + x.ing + ')';
      b.addEventListener('mousedown', e => { e.preventDefault(); if (barraAberta === i) fecha(); else { porTeclado = false; abreBarra(i, false); } });
      b.addEventListener('mouseenter', () => { if (barraAberta >= 0 && barraAberta !== i) abreBarra(i, false); });
      barraEl.append(b);
      return { b, n:x };
    });
  }
  function abreBarra(i, teclado) {
    fechaDe(0);
    const lista = fonteBarra ? fonteBarra() : [];
    const x = botoesBarra[i], dado = lista[i]; if (!x || !dado) return;
    barraAberta = i;
    pintaBarra();
    const r = x.b.getBoundingClientRect();
    const reg = mostraNivel(dado.filhos || [], r.left, r.bottom + 1);
    if (teclado) primeiro(reg);
  }
  function pintaBarra() { botoesBarra.forEach((x, k) => x.b.classList.toggle('on', k === barraAberta)); }

  /* ============================== Preferences ============================== */
  const PAGINAS = [
    { id:'General', rot:'General' },
    { id:'Display', rot:'Display' },
    { id:'Board Insight Display', rot:'Board Insight Display', cinza:true },
    { id:'Interactive Routing', rot:'Interactive Routing' },
    { id:'True Type Fonts', rot:'True Type Fonts', cinza:true },
    { id:'Mouse Wheel Configuration', rot:'Mouse Wheel Configuration' },
    { id:'Defaults', rot:'Defaults' },
    { id:'Reports', rot:'Reports', cinza:true },
    { id:'Layer Colors', rot:'Layer Colors' },
  ];
  let prefAberta = null;
  function preferencias(pagina) {
    if (prefAberta) { prefAberta.vai(pagina || prefAberta.pagina); return; }
    fecha();
    let P = JSON.parse(JSON.stringify(V.prefs()));        /* o rascunho: so vale no OK/Apply */
    let sujo = false;
    const fundo = el('div', 'apf-fundo');
    const jan = el('div', 'apf');
    jan.setAttribute('role', 'dialog'); jan.setAttribute('aria-label', 'Preferences');
    const tit = el('div', 'apf-tit');
    tit.append(el('span', null, 'Preferences'));
    const x = el('button', 'x', '✕'); x.type = 'button'; x.title = 'Cancel (Esc)';
    tit.append(x);
    const corpo = el('div', 'apf-corpo');
    const arv = el('div', 'apf-arv'), pag = el('div', 'apf-pag');
    corpo.append(arv, pag);
    const rod = el('div', 'apf-rod');
    const padroes = el('button', 'btn', 'Set To Defaults'); padroes.type = 'button';
    padroes.title = 'Volta esta página para o padrão do EletricHUB';
    const esp = el('span', 'esp');
    const ok = el('button', 'btn pri', 'OK'), cancel = el('button', 'btn', 'Cancel'), apply = el('button', 'btn', 'Apply');
    [ok, cancel, apply].forEach(b => { b.type = 'button'; });
    rod.append(padroes, esp, ok, cancel, apply);
    jan.append(tit, corpo, rod);
    fundo.append(jan);
    document.body.append(fundo);

    const st = { pagina:pagina || 'General' };
    const marcaSujo = () => { sujo = true; apply.disabled = false; };
    apply.disabled = true;
    function arvore() {
      arv.textContent = '';
      const pasta = (rot, aberta, cinza) => { const n = el('div', 'no pasta' + (cinza ? ' cinza' : '')); n.append(el('span', 'tri', aberta ? '▼' : '▶'), el('span', null, rot)); arv.append(n); return n; };
      pasta('System', true);
      const sc = el('div', 'no folha' + (st.pagina === 'Shortcuts' ? ' on' : ''), 'Keyboard Shortcuts');
      sc.addEventListener('click', () => vai('Shortcuts'));
      arv.append(sc);
      for (const nome of ['Data Management', 'Schematic']) pasta(nome, false, true).title = 'Fora da vista PCB';
      pasta('PCB Editor', true);
      for (const p of PAGINAS) {
        const n = el('div', 'no folha' + (p.cinza ? ' cinza' : '') + (st.pagina === p.id ? ' on' : ''), p.rot);
        if (p.cinza) n.title = NAO_TEM;
        else n.addEventListener('click', () => vai(p.id));
        arv.append(n);
      }
      for (const nome of ['Text Editors', 'Scripting System', 'CAM Editor', 'Simulation', 'Draftsman', 'Multi-board Schematic', 'Multi-board Assembly'])
        pasta(nome, false, true).title = 'Fora da vista PCB';
    }
    function vai(p) { st.pagina = p; arvore(); desenha(); }
    /* pecas de pagina */
    const grupo = (titulo) => { const g = el('div', 'apf-grp'); if (titulo) g.append(el('div', 'gt', titulo)); pag.append(g); return g; };
    const caixa = (box, rot, chave, o) => {
      o = o || {};
      const l = el('label', 'ck' + (o.off ? ' off' : ''));
      const i = el('input'); i.type = 'checkbox';
      i.checked = o.off ? !!o.valor : !!P[chave]; i.disabled = !!o.off;
      if (o.dica || o.off) l.title = o.dica || NAO_TEM;
      i.addEventListener('change', () => { P[chave] = i.checked; marcaSujo(); if (o.depois) o.depois(); });
      l.append(i, el('span', null, rot));
      box.append(l);
      return i;
    };
    const linha = (box, rot, ctrl, un) => { const l = el('div', 'lin'); l.append(el('span', 'k', rot), ctrl, el('span', 'un', un || '')); box.append(l); return l; };
    const escolha = (opcoes, valor, muda) => {
      const s = el('select');
      for (const [v, r, off] of opcoes) { const o = el('option', null, r); o.value = v; if (off) { o.disabled = true; o.textContent = r + ' — ' + NAO_TEM; } if (v === valor) o.selected = true; s.append(o); }
      s.addEventListener('change', () => { muda(s.value); marcaSujo(); });
      return s;
    };
    const distancia = (chave) => {
      const i = el('input'); i.type = 'text'; i.spellcheck = false;
      i.value = V.fmtDist(P.defaults[chave]);
      i.addEventListener('change', () => {
        const v = V.parseDist(i.value);
        if (v === null || !(v > 0)) { V.toast('valor inválido: "' + i.value + '"', 'warn'); i.value = V.fmtDist(P.defaults[chave]); return; }
        P.defaults[chave] = v; marcaSujo();
      });
      return i;
    };
    function desenha() {
      pag.textContent = '';
      const nomePag = st.pagina === 'Shortcuts' ? 'System – Keyboard Shortcuts' : 'PCB Editor – ' + st.pagina;
      pag.append(el('h2', null, nomePag));
      padroes.disabled = st.pagina === 'Shortcuts';
      switch (st.pagina) {
        case 'General': {
          const g1 = grupo('Editing Options');
          const c1 = el('div', 'apf-col'); g1.append(c1);
          caixa(c1, 'Online DRC', 'drcOnline', { dica:'confere as regras a cada edição e marca as violações na placa' });
          caixa(c1, 'Snap To Center', 'x', { off:true, valor:true, dica:'sempre ligado: centro de pad e de via ganham da grade' });
          caixa(c1, 'Smart Component Snap', 'x', { off:true });
          caixa(c1, 'Snap To Room Hot Spots', 'x', { off:true });
          caixa(c1, 'Remove Duplicates', 'x', { off:true });
          caixa(c1, 'Confirm Global Edit', 'x', { off:true });
          caixa(c1, 'Protect Locked Objects', 'x', { off:true });
          caixa(c1, 'Confirm Selection Memory Clear', 'x', { off:true });
          caixa(c1, 'Click Clears Selection', 'x', { off:true, valor:true, dica:'sempre ligado: clicar no vazio limpa a seleção' });
          caixa(c1, 'Shift Click To Select', 'x', { off:true });
          caixa(c1, 'Smart Track Ends', 'x', { off:true });
          caixa(c1, 'Double Click Runs Interactive Properties', 'duploClique', { dica:'duplo clique num objeto abre o painel Properties nele' });
          caixa(c1, 'Display popup selection dialog', 'x', { off:true, dica:'o 2º clique no mesmo ponto pega o objeto de baixo' });
          const g2 = grupo('Other');
          linha(g2, 'Rotation Step', (() => { const i = el('input'); i.type = 'text'; i.value = '90.000'; i.disabled = true; i.title = 'o hub gira de 90° em 90°'; return i; })(), '°');
          linha(g2, 'Cursor Type', escolha(CURSORES.map(([v, r]) => [v, r]), P.cursor, v => { P.cursor = v; }));
          linha(g2, 'Comp Drag', escolha([['nada', 'None'], ['trilhas', 'Connected Tracks', true]], 'nada', () => {}));
          const g3 = grupo('Autopan Options');
          caixa(g3, 'Enable Auto Pan', 'x', { off:true });
          const g4 = grupo('Polygon Rebuild');
          caixa(g4, 'Repour Polygons After Modification', 'x', { off:true, dica:'Tools » Polygon Pours » Repour All (T,G,A) refaz os polígonos' });
          break;
        }
        case 'Display': {
          const g1 = grupo('Display Options');
          const c1 = el('div', 'apf-col'); g1.append(c1);
          caixa(c1, 'Show Grid', 'grade', { dica:'a grade da placa (View » Grids)' });
          caixa(c1, 'Show Connection Lines', 'conexoes', { dica:'as linhas de conexão (ratsnest) do que falta rotear' });
          caixa(c1, 'Show Difference Overlay', 'fantasmas', { dica:'os fantasmas das mudanças do changes.js (View » Differences)' });
          caixa(c1, 'Use Animation', 'x', { off:true });
          caixa(c1, 'Use Flyover Zoom', 'x', { off:true });
          caixa(c1, 'Draw Shadows in 3D', 'x', { off:true });
          const g2 = grupo('Highlighting Options');
          const c2 = el('div', 'apf-col'); g2.append(c2);
          caixa(c2, 'Highlight in Full', 'x', { off:true, valor:true });
          caixa(c2, 'Use Transparent Mode When Masking', 'x', { off:true, valor:true });
          caixa(c2, 'Show All Primitives In Highlighted Nets', 'x', { off:true, valor:true });
          caixa(c2, 'Apply Mask During Interactive Editing', 'x', { off:true });
          caixa(c2, 'Apply Highlight During Interactive Editing', 'x', { off:true });
          break;
        }
        case 'Interactive Routing': {
          const g1 = grupo('Routing Conflict Resolution');
          const c1 = el('div', 'apf-col'); g1.append(c1);
          for (const [v, r] of CONFLITO_ALTIUM) {
            const tem = CONFLITO_TEM.has(v);
            const l = el('label', 'ck' + (tem ? '' : ' off'));
            const i = el('input'); i.type = 'checkbox';
            i.checked = tem && P.conflitosCiclo.indexOf(v) >= 0; i.disabled = !tem;
            l.title = tem ? 'entra no ciclo do Shift+R' : NAO_TEM + ' (nada que já está na placa se mexe)';
            i.addEventListener('change', () => {
              const s = new Set(P.conflitosCiclo);
              if (i.checked) s.add(v); else s.delete(v);
              if (!s.size) { i.checked = true; V.toast('pelo menos um modo fica no ciclo', 'warn'); return; }
              P.conflitosCiclo = CONFLITO_ALTIUM.map(x => x[0]).filter(k => s.has(k));
              if (P.conflitosCiclo.indexOf(P.conflito) < 0) P.conflito = P.conflitosCiclo[0];
              marcaSujo(); desenha();
            });
            l.append(i, el('span', null, r));
            c1.append(l);
          }
          linha(g1, 'Current Mode', escolha(CONFLITO_ALTIUM.filter(x => P.conflitosCiclo.indexOf(x[0]) >= 0).map(([v, r]) => [v, r.replace(' Obstacles', ' Conflicting Object').replace('Stop At First Obstacle', 'Stop At First Conflicting Object')]),
            P.conflito, v => { P.conflito = v; }));
          const g2 = grupo('Interactive Routing Options');
          const c2 = el('div', 'apf-col'); g2.append(c2);
          caixa(c2, 'Automatically Terminate Routing', 'x', { off:true });
          caixa(c2, 'Automatically Remove Loops', 'x', { off:true });
          caixa(c2, 'Allow Via Pushing', 'x', { off:true });
          caixa(c2, 'Display Clearance Boundaries', 'x', { off:true });
          const g3 = grupo('Interactive Routing Width Sources');
          caixa(g3, 'Pickup Track Width From Existing Routes', 'larguraDaTrilha', { dica:'começar a rota numa trilha pega a largura dela' });
          linha(g3, 'Track Width Mode', escolha([['default', 'Default'], ['regra', 'Preferred'], ['min', 'Min', true], ['max', 'Max', true]], P.larguraModo,
            v => { P.larguraModo = v; }));
          linha(g3, 'Via Size Mode', escolha([['default', 'Default'], ['regra', 'Preferred'], ['min', 'Min', true], ['max', 'Max', true]], P.viaModo,
            v => { P.viaModo = v; }));
          g3.append(el('div', 'nota', 'Default = a página Defaults destas Preferences; Preferred = a regra Width/RoutingVias da placa (rules.js ou o espelho).'));
          const g4 = grupo('General');
          linha(g4, 'Corner Style (Shift+Space)', escolha([['45', '45 Degree'], ['90', '90 Degree'], ['livre', 'Any Angle']], P.canto, v => { P.canto = v; }));
          break;
        }
        case 'Mouse Wheel Configuration': {
          const g = grupo('Mouse Wheel Configuration');
          const t = el('table');
          const th = el('tr');
          for (const [h, c] of [['Action', ''], ['Ctrl', 'c'], ['Shift', 'c'], ['Alt', 'c'], ['Mouse', '']]) th.append(el('th', c || null, h));
          t.append(th);
          for (const r of RODA) {
            const tr = el('tr');
            tr.append(el('td', null, r.rot));
            const mods = String(P.roda[r.id] || '').split('+').filter(Boolean);
            for (const md of ['Ctrl', 'Shift', 'Alt']) {
              const td = el('td', 'c'); const i = el('input'); i.type = 'checkbox'; i.checked = mods.indexOf(md) >= 0;
              i.addEventListener('change', () => {
                const s = new Set(String(P.roda[r.id] || '').split('+').filter(Boolean));
                if (i.checked) s.add(md); else s.delete(md);
                P.roda[r.id] = ['Ctrl', 'Shift', 'Alt'].filter(x => s.has(x)).join('+');
                marcaSujo();
                const rep = RODA.filter(o => o.id !== r.id && (P.roda[o.id] || '') === P.roda[r.id]);
                if (rep.length) V.toast('a mesma combinação já é de ' + rep.map(o => o.rot).join(', ') + ' — vale a de cima da tabela', 'warn', 3200);
              });
              td.append(i); tr.append(td);
            }
            tr.append(el('td', null, 'Wheel'));
            t.append(tr);
          }
          g.append(t);
          const bt = el('div'); bt.style.cssText = 'display:flex; gap:8px; margin-top:10px;';
          const casa = el('button', 'btn', 'Padrão EletricHUB'), alt = el('button', 'btn', 'Padrão Altium');
          casa.type = alt.type = 'button';
          casa.title = 'roda = zoom · Shift = para o lado · Ctrl+Shift = camada';
          alt.title = 'Ctrl+roda = zoom · roda = rolar · Shift = para o lado';
          casa.addEventListener('click', () => { P.roda = Object.assign({}, RODA_CASA); marcaSujo(); desenha(); });
          alt.addEventListener('click', () => { P.roda = Object.assign({}, RODA_ALTIUM); marcaSujo(); desenha(); });
          bt.append(casa, alt); g.append(bt);
          g.append(el('div', 'nota', 'Combinação que não está na tabela cai no zoom. Ctrl+roda é sempre da vista (o navegador não aproxima a página).'));
          break;
        }
        case 'Defaults': {
          const g = grupo('Primitives');
          const t = el('table');
          const th = el('tr'); th.append(el('th', null, 'Primitive'), el('th', null, 'Property'), el('th', null, 'Value (' + V.unidade() + ')')); t.append(th);
          const L = [
            ['Track', 'Width', 'wTrilha'], ['Line', 'Width', 'wLinha'],
            ['Via', 'Diameter', 'viaSize'], ['Via', 'Hole Size', 'viaDrill'],
            ['Pad', 'X/Y Size', 'padW'], ['Pad', 'Hole Size', 'padFuro'],
            ['String', 'Text Height', 'hTexto'], ['String', 'Stroke Width', 'wTexto'],
            ['Board Cutout', 'Diameter', 'furo'],
          ];
          for (const [p, prop, k] of L) {
            const tr = el('tr'); tr.append(el('td', null, p), el('td', null, prop));
            const td = el('td'); td.append(distancia(k)); tr.append(td); t.append(tr);
          }
          g.append(t);
          g.append(el('div', 'nota', 'Os valores com que cada ferramenta nasce (o Tab com a ferramenta na mão muda só a da vez). Valem nas próximas aberturas também.'));
          break;
        }
        case 'Layer Colors': {
          const g = grupo('Layer Colors');
          const t = el('table');
          const th = el('tr'); th.append(el('th', null, 'Layers'), el('th', null, 'Color'), el('th', null, '')); t.append(th);
          for (const l of V.camadas()) {
            const tr = el('tr');
            tr.append(el('td', null, l.rot));
            const td = el('td'); const w = el('span', 'cor');
            const i = el('input'); i.type = 'color';
            const atual = P.cores[l.key] || l.padrao;
            i.value = /^#[0-9a-f]{6}$/i.test(atual) ? atual : '#888888';
            i.addEventListener('input', () => { P.cores[l.key] = i.value; marcaSujo(); });
            w.append(i, el('span', null, i.value)); td.append(w); tr.append(td);
            const tdr = el('td'); const rb = el('button', 'btn', 'Reset'); rb.type = 'button'; rb.disabled = !P.cores[l.key];
            rb.addEventListener('click', () => { delete P.cores[l.key]; marcaSujo(); desenha(); });
            i.addEventListener('input', () => { rb.disabled = false; w.lastChild.textContent = i.value; });
            tdr.append(rb); tr.append(tdr);
            t.append(tr);
          }
          g.append(t);
          const ra = el('button', 'btn', 'Reset All'); ra.type = 'button'; ra.style.marginTop = '10px';
          ra.addEventListener('click', () => { P.cores = {}; marcaSujo(); desenha(); });
          g.append(ra);
          g.append(el('div', 'nota', 'O perfil de fábrica são as cores medidas nos Gerbers da casa (as do Altium). O canvas fica fora do tema do hub, como no Altium.'));
          break;
        }
        case 'Shortcuts': {
          const box = el('div');
          pag.append(box);
          if (typeof HubAtalhos !== 'undefined' && typeof HubAtalhos.pane === 'function') {
            HubAtalhos.pane(box, { toast:(t, tipo) => V.toast(t, tipo) });
            pag.append(el('div', 'nota', 'As teclas valem na hora, nesta vista e no hub. "Padrão Altium" em cada grupo põe as teclas e as sequências do Altium (P,T · T,D · D,R…); com elas, P, D, T, U... abrem o menu no cursor, como no Altium.'));
          } else pag.append(el('div', 'nota', 'O editor de atalhos (hub-atalhos.js) não carregou nesta página.'));
          break;
        }
      }
    }
    function aplica() { V.aplicaPrefs(JSON.parse(JSON.stringify(P))); sujo = false; apply.disabled = true; }
    function sai() { fundo.remove(); document.removeEventListener('keydown', teclaPref, true); prefAberta = null; }
    function teclaPref(e) {
      if (e.key === 'Escape') {
        if (e.target && e.target.closest && e.target.closest('.hat') && st.pagina === 'Shortcuts') return;   /* o Esc da gravacao de tecla e do editor */
        e.preventDefault(); e.stopPropagation(); sai();
      }
    }
    padroes.addEventListener('click', () => {
      const D = V.prefsPadrao();
      const porPagina = {
        'General': ['drcOnline', 'duploClique', 'cursor'], 'Display': ['grade', 'conexoes', 'fantasmas'],
        'Interactive Routing': ['conflitosCiclo', 'conflito', 'larguraDaTrilha', 'larguraModo', 'viaModo', 'canto'],
        'Mouse Wheel Configuration': ['roda'], 'Defaults': ['defaults'], 'Layer Colors': ['cores'],
      };
      for (const k of porPagina[st.pagina] || []) P[k] = JSON.parse(JSON.stringify(D[k]));
      marcaSujo(); desenha();
    });
    ok.addEventListener('click', () => { if (sujo) aplica(); sai(); });
    cancel.addEventListener('click', sai);
    x.addEventListener('click', sai);
    apply.addEventListener('click', aplica);
    fundo.addEventListener('mousedown', e => { if (e.target === fundo) sai(); });
    document.addEventListener('keydown', teclaPref, true);
    prefAberta = { vai, get pagina(){ return st.pagina; } };
    vai(st.pagina);
  }

  return { contexto, popup, aberto, fecha, preferencias, barra, redesenhaBarra, itensBarra, tecla, temPopup:l => !!popupDaTecla(l),
           abre:(itens, x, y, opt) => { fecha(); return mostraNivel(itens, x, y, opt || {}); }, vista:VISTA };
}

return { instala, MAPA, MAPA_SCH, RODA, RODA_CASA, RODA_ALTIUM, CURSORES, CONFLITO_ALTIUM };
});
