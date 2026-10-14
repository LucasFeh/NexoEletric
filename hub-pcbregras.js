/* AltiumPCBMirror v2 - hub-pcbregras.js — as REGRAS DE PROJETO (Design Rules) do Altium 21.

   O L1 do docs/PCB-MIGRACAO.md: sem regra não há DRC, e sem DRC largar o Altium é mandar a placa
   para a fábrica sem verificação. Este módulo é o MODELO — as categorias e os tipos de regra do
   "PCB Rules and Constraints Editor", os valores padrão, a linguagem de escopo (a "query" do
   Altium) e a resolução da regra vencedora por prioridade. Quem confere a placa é o
   hub-pcbdrc.js; quem desenha o editor é o hub-pcbregrasui.js.

   Lógica pura, sem DOM: navegador (global HubPcbRegras) e Node (tests/test-pcbregras.js).

   OS VALORES PADRÃO FORAM MEDIDOS, não lembrados (2026-10-13). O stream Rules6/Data de três
   fontes, lido pelo tools/pcbdoc:
     * Altium de fábrica: o A4.PCBDOC do LegacyLocalTemplates.zip que vem com o AD21
       (C:\Users\Public\Documents\Altium\AD21\Templates). É o que o Altium põe numa placa nova:
       Clearance 10 mil, Width 10/10/10 mil, via 50/28 mil (mín = pref = máx), furo 1..100 mil,
       Polygon Connect em Relief (4 condutores de 10 mil a 90°, folga 10 mil), plano 20 mil,
       máscara 4 mil, pasta 0, furo-a-furo 10 mil, sliver 10 mil, silk-máscara 10 mil (escopo
       IsPad, até o cobre exposto), silk-silk 10 mil, antena 0, componente-componente 10 mil.
     * a casa: o template DieletronsAltium (PCB/PCB.PcbDoc), igual ao de fábrica menos Width
       5/10/118,1102 mil (0,127/0,254/3 mm), via 0,5/0,3 mm com faixa 0,1..3 mm, furo até 5 mm,
       Polygon Connect Direct, e a matriz de Clearance com o furo (Hole) a 0.
     * os 11 PcbDoc do acervo que a rede deixou ler (as fontes dos board.js de Projects): Clearance
       10 mil em 8, 0,2 mm em 3 (PACI, PRJ - DI261930, PRJ-UR); largura por net em 1 (PRJ-UR: 35
       regras "Schematic Width Constraint", InNet('0V') duas vezes, prioridades 1..36); a matriz
       de objetos (OBJECTCLEARANCES) personalizada em 4.
   Os nomes dos tipos e os títulos do editor são os da tabela do Advpcb.dll do AD21 (UTF-16:
   "Clearance Constraint", "Un-Routed Net Constraint"...). BoardOutlineClearance e UnConnectedPin
   existem no AD21 mas não estão em nenhum dos PcbDoc medidos (as placas da casa nasceram antes do
   AD20): o padrão deles aqui é decisão, não medida — está dito no campo `nota` de cada um.

   API
     HubPcbRegras.CATEGORIAS                 [{id, nome, tipos:[kind...]}] (a árvore do editor)
     HubPcbRegras.TIPOS                      {kind: {cat, nome, titulo, binaria, campos:[...], drc}}
     HubPcbRegras.padroesAltium()            o conjunto de fábrica do AD21 (A4.PCBDOC)
     HubPcbRegras.padroesCasa()              o template DieletronsAltium (o padrão do hub)
     HubPcbRegras.padroes()                  = padroesCasa()
     HubPcbRegras.doBoard(board, base?)      base (padrão: casa) + o board.rules do espelho
     HubPcbRegras.deAltium(registros, classes?) os registros crus do Rules6 (o que o
                                             pcbdoc2board --regras grava em "altium") -> conjunto
     HubPcbRegras.ler(texto|objeto)          o rules.js (var pcbrules = {...};) -> conjunto
     HubPcbRegras.serializa(conjunto)        conjunto -> texto do rules.js (uma regra por linha)
     HubPcbRegras.normaliza(conjunto)        completa campos, ordena, renumera prioridades
     HubPcbRegras.compila(expr)              {ok, erro, desconhecidas, avalia(desc, ctx)}
     HubPcbRegras.avaliaEscopo(expr, desc, ctx) true | false | null (null = função que não sei)
     HubPcbRegras.resolvedor(conjunto)       {regraPara(kind, a, b?), regras(kind), avisos}
     HubPcbRegras.regraPara(conjunto, kind, a, b?)  a regra vencedora (atalho sem cache)
     HubPcbRegras.folgaEntre(conjunto|resolvedor, descA, descB) -> {gap, regra}  a folga de
                                             Clearance que vale para o par, com a matriz de objetos
                                             (o polygon pour usa para recuar o cobre)
     HubPcbRegras.paraMm('10mil') / mil(mm) / fmt(mm, 'mm'|'mil')
     HubPcbRegras.chaveCamada(nome, board?)  'Top Layer' / 'TopLayer' / 'Top' -> 'Top'
     HubPcbRegras.descritores(eb)            os descritores de query da placa (o "casa N" do editor)
     HubPcbRegras.verifica(conjunto, kind, 'lote'|'online')  o "Rules To Check" do DRC
     conjunto.verificar = {lote:[kind], online:[kind]}: medido no Design Rule Checker Options6 do
       PcbDoc (índices na tabela KINDS_AD21); o lote da casa NÃO confere silk nem componente

   O descritor de objeto (desc) que o escopo avalia:
     {tipo:'track'|'arc'|'via'|'pad'|'fill'|'region'|'text'|'comp'|'hole'|'silk',
      net, layer, comp (designator do dono), footprint, smd (pad SMD), poly (pedaço de polígono
      despejado), pad ('U1-3', para InPadClass), keepout, id}
   ctx = {classes:{net:{nome:[nets]}, comp:{nome:[refs]}, pad:{nome:['U1-3']}}, board}

   O que a linguagem de escopo entende (o resto devolve null: a regra fica de fora e o aviso diz
   qual função faltou — o mesmo que o leitor de PcbDoc faz):
     All, InNet('x'), InNetClass('x'), InComponent('U1'), InComponentClass('x'), InPadClass('x'),
     HasFootprint('x'), OnLayer('Top Layer'|'Top'), IsVia, IsPad, IsSMDPad, IsThruHole (IsTHPad),
     IsTrack, IsArc, IsFill, IsRegion, IsText, IsPolygon/InPolygon, IsKeepOut, InAnyNet,
     IsComponent; and/or/not (também &&, ||, !) e parênteses. Comparação ("CompPinCount < 5",
     "Width > 10 AsMils") é entendida na sintaxe, mas o valor é null (o hub não modela). As superclasses 'All Nets',
     'All Components' e 'All Pads' existem sozinhas, como no Altium. */
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubPcbRegras = m;
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const FORMATO = 'pcbrules-v1';
const MIL = 0.0254;
const isNum = v => typeof v === 'number' && isFinite(v);
const r6 = v => { const x = Math.round(v * 1e6) / 1e6; return x === 0 ? 0 : x; };
/* o Rules6 grava mil com 4 casas (3 mm = 118.1102mil): 5 casas em mm devolvem o número redondo */
const r5 = v => { const x = Math.round(v * 1e5) / 1e5; return x === 0 ? 0 : x; };
const mm = mils => r5(mils * MIL);
const dcopy = v => (v == null || typeof v !== 'object') ? v : JSON.parse(JSON.stringify(v));

/* '10mil' | '0.2mm' | '0.254' | 0.254 -> mm. Número cru = mm (é a unidade do rules.js). O Rules6
   grava sempre em mil, com até 4 casas ('3149.6063mil' = 80 mm). */
function paraMm(v){
  if (isNum(v)) return v;
  if (typeof v !== 'string') return NaN;
  const s = v.trim().toLowerCase().replace(',', '.');
  const m1 = /^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(mil|mm|in|um)?$/.exec(s);
  if (!m1) return NaN;
  const n = parseFloat(m1[1]), u = m1[2] || 'mm';
  return u === 'mil' ? mm(n) : u === 'in' ? r6(n * 25.4) : u === 'um' ? r6(n / 1000) : n;
}
const mil = v => isNum(v) ? Math.round(v / MIL * 1e4) / 1e4 : NaN;
/* o número no editor: mm com até 4 casas, mil com até 3 (sem zeros à toa) */
function fmt(v, un){
  if (!isNum(v)) return '';
  if (un === 'mil') return String(Math.round(v / MIL * 1000) / 1000) + 'mil';
  return String(Math.round(v * 1e4) / 1e4) + 'mm';
}
const bool = s => typeof s === 'boolean' ? s : String(s).toUpperCase() === 'TRUE';

/* ============================== camadas ============================== */

/* as chaves do board.js (HubCore.PCB_LAYERS) e o nome que o Altium dá na query */
function nomeAltium(k){
  if (k === 'Top') return 'Top Layer';
  if (k === 'Bottom') return 'Bottom Layer';
  let m1 = /^Mid(\d+)$/.exec(k); if (m1) return 'Mid-Layer ' + m1[1];
  m1 = /^Plane(\d+)$/.exec(k); if (m1) return 'Internal Plane ' + m1[1];
  m1 = /^Mech(\d+)$/.exec(k); if (m1) return 'Mechanical ' + m1[1];
  return { TopOverlay:'Top Overlay', BottomOverlay:'Bottom Overlay', TopPaste:'Top Paste', BottomPaste:'Bottom Paste',
           TopSolder:'Top Solder', BottomSolder:'Bottom Solder', DrillGuide:'Drill Guide', KeepOut:'Keep-Out Layer',
           DrillDrawing:'Drill Drawing', Multi:'Multi-Layer' }[k] || k;
}
const achata = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
const CAMADA_ACHATADA = Object.create(null);
(function(){
  const chaves = ['Top', 'Bottom', 'TopOverlay', 'BottomOverlay', 'TopPaste', 'BottomPaste', 'TopSolder', 'BottomSolder',
                  'DrillGuide', 'KeepOut', 'DrillDrawing', 'Multi'];
  for (let i = 1; i <= 30; i++) chaves.push('Mid' + i);
  for (let i = 1; i <= 16; i++) chaves.push('Plane' + i);
  for (let i = 1; i <= 32; i++) chaves.push('Mech' + i);
  for (const k of chaves) { CAMADA_ACHATADA[achata(k)] = k; CAMADA_ACHATADA[achata(nomeAltium(k))] = k; }
  Object.assign(CAMADA_ACHATADA, { multilayer:'Multi', midlayer:'Mid1', keepoutlayer:'KeepOut', toplayer:'Top', bottomlayer:'Bottom' });
  for (let i = 1; i <= 30; i++) CAMADA_ACHATADA['midlayer' + i] = 'Mid' + i;
  for (let i = 1; i <= 16; i++) CAMADA_ACHATADA['internalplane' + i] = 'Plane' + i;
})();
/* o nome de camada da query -> a chave do board.js; o nome que a placa dá (board.layers[].name:
   "Top 3D Body"...) também vale */
function chaveCamada(nome, board){
  const a = achata(nome);
  if (a in CAMADA_ACHATADA) return CAMADA_ACHATADA[a];
  const L = board && Array.isArray(board.layers) ? board.layers : [];
  for (const l of L) if (l && achata(l.name) === a) return l.key;
  return null;
}

/* ============================== tipos e categorias ============================== */

/* campo: {k, rotulo, un:'len'|'int'|'deg'|'bool'|'enum'|'pct', opcoes?} — 'len' guarda mm */
const C = (k, rotulo, un, opcoes) => opcoes ? { k, rotulo, un, opcoes } : { k, rotulo, un };
const TIPOS = {
  /* Electrical */
  Clearance:       { cat:'Electrical', nome:'Clearance', titulo:'Clearance Constraint', binaria:true, drc:true,
                     campos:[C('gap', 'Folga mínima', 'len'), C('netscope', 'Nets', 'enum', ['DifferentNets', 'SameNet', 'AnyNet']),
                             C('layerkind', 'Camadas', 'enum', ['SameLayer', 'AdjacentLayers']),
                             C('ignorePadToPad', 'Ignorar pad-a-pad no mesmo footprint', 'bool')] },
  ShortCircuit:    { cat:'Electrical', nome:'Short-Circuit', titulo:'Short-Circuit Constraint', binaria:true, drc:true,
                     campos:[C('allowed', 'Permitir curto', 'bool')] },
  UnRoutedNet:     { cat:'Electrical', nome:'Un-Routed Net', titulo:'Un-Routed Net Constraint', binaria:false, drc:true, campos:[] },
  UnConnectedPin:  { cat:'Electrical', nome:'Un-Connected Pin', titulo:'Un-Connected Pin Constraint', binaria:false, drc:true, campos:[] },
  /* Routing */
  Width:           { cat:'Routing', nome:'Width', titulo:'Width Constraint', binaria:false, drc:true,
                     campos:[C('min', 'Mínima', 'len'), C('pref', 'Preferida', 'len'), C('max', 'Máxima', 'len')] },
  RoutingVias:     { cat:'Routing', nome:'Routing Via Style', titulo:'Routing Via Style', binaria:false, drc:true,
                     campos:[C('min', 'Diâmetro mín.', 'len'), C('pref', 'Diâmetro pref.', 'len'), C('max', 'Diâmetro máx.', 'len'),
                             C('holeMin', 'Furo mín.', 'len'), C('holePref', 'Furo pref.', 'len'), C('holeMax', 'Furo máx.', 'len')] },
  RoutingCorners:  { cat:'Routing', nome:'Routing Corners', titulo:'Routing Corners', binaria:false, drc:false,
                     campos:[C('style', 'Estilo', 'enum', ['45-Degree', '90-Degree', 'Rounded']),
                             C('setbackMin', 'Recuo mín.', 'len'), C('setbackMax', 'Recuo máx.', 'len')] },
  RoutingLayers:   { cat:'Routing', nome:'Routing Layers', titulo:'Routing Layers', binaria:false, drc:true,
                     campos:[C('layers', 'Camadas permitidas', 'layers')] },
  /* Plane / Polygon */
  PolygonConnect:  { cat:'Plane', nome:'Polygon Connect Style', titulo:'Polygon Connect Style', binaria:true, drc:false,
                     campos:[C('style', 'Conexão', 'enum', ['Relief', 'Direct', 'NoConnect']), C('conductors', 'Condutores', 'enum', [2, 4]),
                             C('width', 'Largura do condutor', 'len'), C('angle', 'Ângulo', 'enum', [90, 45]), C('airgap', 'Folga (air gap)', 'len')] },
  PlaneClearance:  { cat:'Plane', nome:'Power Plane Clearance', titulo:'Power Plane Clearance', binaria:false, drc:false,
                     campos:[C('gap', 'Folga', 'len')] },
  /* Mask */
  SolderMaskExpansion: { cat:'Mask', nome:'Solder Mask Expansion', titulo:'Solder Mask Expansion', binaria:false, drc:false,
                     campos:[C('expansion', 'Expansão', 'len'), C('tentTop', 'Tampar no Top', 'bool'), C('tentBottom', 'Tampar no Bottom', 'bool')] },
  PasteMaskExpansion: { cat:'Mask', nome:'Paste Mask Expansion', titulo:'Paste Mask Expansion', binaria:false, drc:false,
                     campos:[C('expansion', 'Expansão', 'len')] },
  /* Manufacturing */
  HoleSize:        { cat:'Manufacturing', nome:'Hole Size', titulo:'Hole Size Constraint', binaria:false, drc:true,
                     campos:[C('min', 'Furo mínimo', 'len'), C('max', 'Furo máximo', 'len')] },
  HoleToHoleClearance: { cat:'Manufacturing', nome:'Hole To Hole Clearance', titulo:'Hole To Hole Clearance Constraint', binaria:true, drc:true,
                     campos:[C('gap', 'Folga', 'len'), C('allowStackedMicrovias', 'Permitir microvias empilhadas', 'bool')] },
  MinimumSolderMaskSliver: { cat:'Manufacturing', nome:'Minimum Solder Mask Sliver', titulo:'Minimum Solder Mask Sliver Constraint', binaria:true, drc:true,
                     campos:[C('min', 'Ponte mínima', 'len')] },
  SilkToSolderMaskClearance: { cat:'Manufacturing', nome:'Silk To Solder Mask Clearance', titulo:'Silk To Solder Mask Clearance Constraint', binaria:true, drc:true,
                     campos:[C('gap', 'Folga', 'len'), C('exposedCopper', 'Medir até o cobre exposto (senão, até a abertura)', 'bool')] },
  SilkToSilkClearance: { cat:'Manufacturing', nome:'Silk To Silk Clearance', titulo:'Silk To Silk Clearance Constraint', binaria:true, drc:true,
                     campos:[C('gap', 'Folga', 'len')] },
  BoardOutlineClearance: { cat:'Manufacturing', nome:'Board Outline Clearance', titulo:'Board Outline Clearance', binaria:false, drc:true,
                     campos:[C('gap', 'Folga ao contorno', 'len')] },
  NetAntennae:     { cat:'Manufacturing', nome:'Net Antennae', titulo:'Net Antennae', binaria:false, drc:true,
                     campos:[C('tolerance', 'Tolerância', 'len')] },
  /* Placement */
  ComponentClearance: { cat:'Placement', nome:'Component Clearance', titulo:'Component Clearance Constraint', binaria:true, drc:true,
                     campos:[C('gap', 'Folga horizontal', 'len'), C('verticalGap', 'Folga vertical', 'len')] },
};
const CATEGORIAS = [
  { id:'Electrical', nome:'Electrical', tipos:['Clearance', 'ShortCircuit', 'UnRoutedNet', 'UnConnectedPin'] },
  { id:'Routing', nome:'Routing', tipos:['Width', 'RoutingVias', 'RoutingCorners', 'RoutingLayers'] },
  { id:'Plane', nome:'Plane / Polygon', tipos:['PolygonConnect', 'PlaneClearance'] },
  { id:'Mask', nome:'Mask', tipos:['SolderMaskExpansion', 'PasteMaskExpansion'] },
  { id:'Manufacturing', nome:'Manufacturing', tipos:['HoleSize', 'HoleToHoleClearance', 'MinimumSolderMaskSliver',
                                                   'SilkToSolderMaskClearance', 'SilkToSilkClearance', 'BoardOutlineClearance', 'NetAntennae'] },
  { id:'Placement', nome:'Placement', tipos:['ComponentClearance'] },
  { id:'Outras', nome:'Outras (do Altium)', tipos:[] },
];
/* a tabela de RULEKIND do AD21, na ordem do Advpcb.dll: é o índice que o "Rules To Check" do DRC
   grava no PcbDoc (Design Rule Checker Options6: RULESETTOCHECK = lote, ONLINERULESETTOCHECK =
   online). Conferida contra os relatórios .drc do acervo: o que está no RULESETTOCHECK é
   exatamente o que o "Processing Rule" do relatório lista. */
const KINDS_AD21 = ['Clearance', 'ParallelSegment', 'Width', 'Length', 'MatchedLengths', 'StubLength', 'PlaneConnect',
  'RoutingTopology', 'RoutingPriority', 'RoutingLayers', 'RoutingCorners', 'RoutingVias', 'PlaneClearance', 'SolderMaskExpansion',
  'PasteMaskExpansion', 'ShortCircuit', 'UnRoutedNet', 'ViasUnderSMD', 'MaximumViaCount', 'MinimumAnnularRing', 'PolygonConnect',
  'AcuteAngle', 'RoomDefinition', 'SMDToCorner', 'ComponentClearance', 'ComponentOrientations', 'PermittedLayers', 'NetsToIgnore',
  'SignalStimulus', 'OvershootFalling', 'OvershootRising', 'UndershootFalling', 'UndershootRising', 'MaxMinImpedance',
  'SignalTopValue', 'SignalBaseValue', 'FlightTimeRising', 'FlightTimeFalling', 'LayerStack', 'SlopeRising', 'SlopeFalling',
  'SupplyNets', 'HoleSize', 'FabricationTestpoint', 'FabricationTestPointUsage', 'UnConnectedPin', 'SMDToPlane', 'SMDNeckDown',
  'LayerPairs', 'FanoutControl', 'Height', 'DiffPairsRouting', 'HoleToHoleClearance', 'MinimumSolderMaskSliver',
  'SilkToSolderMaskClearance', 'SilkToSilkClearance', 'NetAntennae', 'AssemblyTestpoint', 'AssemblyTestPointUsage',
  'SilkToBoardRegionClearance', 'SMDEntry', 'None', 'UnpouredPolygon', 'BoardOutlineClearance', 'BackDrilling', 'Creepage', 'ReturnPath'];
const deIndices = txt => String(txt || '').split(',').map(s => parseInt(s, 10)).filter(i => i >= 0 && i < KINDS_AD21.length).map(i => KINDS_AD21[i]);
const paraIndices = lista => lista.map(k => KINDS_AD21.indexOf(k)).filter(i => i >= 0).sort((a, b) => a - b).join(',');
/* o "Rules To Check" medido: o do template da casa é o de 12 dos 13 PcbDoc lidos (os outros só
   tiram ou põem o sliver e as duas de silk); o A4.PCBDOC de fábrica é mais curto */
const VERIFICAR_CASA = { lote: deIndices('0,1,2,3,4,5,6,15,16,18,19,21,22,23,26,42,45,46,47,50,52,53,56,60,62,63,64'),
                         online: deIndices('0,1,2,3,4,5,9,11,15,17,18,22,23,24,45,46,47,50,51,60,62') };
const VERIFICAR_FABRICA = { lote: deIndices('0,1,2,3,4,5,15,16,18,19,21,22,23,42,45,46,47'), online: deIndices('0,1,22,23,24,48') };

/* os tipos do objeto na matriz de folgas do Clearance (OBJECTCLEARANCES do AD19+) */
const OBJ_MATRIZ = ['Track', 'Arc', 'SMDPad', 'THPad', 'Via', 'Fill', 'Poly', 'Region', 'Text', 'Hole'];

/* ============================== os padrões ============================== */

const TODAS_CAMADAS = () => { const o = { Top:true, Bottom:true }; for (let i = 1; i <= 30; i++) o['Mid' + i] = true; return o; };
const R = (kind, name, campos, extra) => Object.assign({ name, kind, enabled:true, priority:1, scope1:'All', scope2:'All', comment:'' }, campos, extra || {});

/* o A4.PCBDOC do AD21 (Altium de fábrica), campo a campo */
function padroesAltium(){
  return normaliza({ format:FORMATO, units:'mm', origem:'Altium 21 (padrão de fábrica: A4.PCBDOC do AD21)', classes:{ net:{}, comp:{}, pad:{} },
                     verificar:dcopy(VERIFICAR_FABRICA), rules:brutoAltium() });
}
function brutoAltium(){
  return [
    R('Clearance', 'Clearance', { gap:mm(10), netscope:'DifferentNets', layerkind:'SameLayer', ignorePadToPad:false, matrix:{} }),
    R('ShortCircuit', 'ShortCircuit', { allowed:false }),
    R('UnRoutedNet', 'UnRoutedNet', {}),
    R('Width', 'Width', { min:mm(10), pref:mm(10), max:mm(10) }),
    R('RoutingVias', 'RoutingVias', { min:mm(50), pref:mm(50), max:mm(50), holeMin:mm(28), holePref:mm(28), holeMax:mm(28), style:'Through Hole' }),
    R('RoutingCorners', 'RoutingCorners', { style:'45-Degree', setbackMin:mm(100), setbackMax:mm(100) }),
    R('RoutingLayers', 'RoutingLayers', { layers:TODAS_CAMADAS() }),
    R('PolygonConnect', 'PolygonConnect', { style:'Relief', conductors:4, width:mm(10), angle:90, airgap:mm(10) }),
    R('PlaneClearance', 'PlaneClearance', { gap:mm(20) }),
    R('SolderMaskExpansion', 'SolderMaskExpansion', { expansion:mm(4), tentTop:false, tentBottom:false }),
    R('PasteMaskExpansion', 'PasteMaskExpansion', { expansion:0 }),
    R('HoleSize', 'HoleSize', { min:mm(1), max:mm(100), absolute:true, minPct:20, maxPct:80 }),
    R('HoleToHoleClearance', 'HoleToHoleClearance', { gap:mm(10), allowStackedMicrovias:true }),
    R('MinimumSolderMaskSliver', 'MinimumSolderMaskSliver', { min:mm(10) }),
    R('SilkToSolderMaskClearance', 'SilkscreenOverComponentPads', { gap:mm(10), exposedCopper:true }, { scope1:'IsPad' }),
    R('SilkToSilkClearance', 'SilkToSilkClearance', { gap:mm(10) }),
    R('NetAntennae', 'NetAntennae', { tolerance:0 }),
    R('ComponentClearance', 'ComponentClearance', { gap:mm(10), verticalGap:mm(10) }),
    /* não está em nenhum PcbDoc medido (nem no A4.PCBDOC): decisão do hub, ver `nota` */
    R('BoardOutlineClearance', 'BoardOutlineClearance', { gap:0 }, { nota:'não medido: nenhum PcbDoc da casa tem a regra (nasceram antes do AD20). 0 mm = só acusa cobre que cruza o contorno ou cai num recorte' }),
  ];
}
/* o template DieletronsAltium: o de fábrica com as mudanças medidas no PCB.PcbDoc dele */
function padroesCasa(){
  const S = padroesAltium();
  S.origem = 'template DieletronsAltium (AD21)';
  S.verificar = dcopy(VERIFICAR_CASA);
  const por = k => S.rules.find(r => r.kind === k);
  Object.assign(por('Width'), { min:mm(5), pref:mm(10), max:mm(118.1102) });
  Object.assign(por('RoutingVias'), { min:mm(3.937), pref:mm(19.685), max:mm(118.1102), holeMin:mm(3.937), holePref:mm(11.811), holeMax:mm(118.1102) });
  Object.assign(por('HoleSize'), { max:mm(196.8504) });
  Object.assign(por('PolygonConnect'), { style:'Direct' });
  const m0 = {};
  for (const o of OBJ_MATRIZ) if (o !== 'Hole') m0[o + '-Hole'] = 0;
  por('Clearance').matrix = m0;
  por('SilkToSolderMaskClearance').name = 'SilkToSolderMaskClearance';
  return S;
}
const padroes = padroesCasa;

/* campos e valores de cada tipo, para completar regra nova ou incompleta */
function camposPadrao(kind){
  const base = brutoAltium().find(r => r.kind === kind);
  const o = {};
  if (base) for (const k of Object.keys(base)) if (!['name', 'kind', 'enabled', 'priority', 'scope1', 'scope2', 'comment', 'nota'].includes(k)) o[k] = dcopy(base[k]);
  if (kind === 'UnConnectedPin') return {};
  return o;
}
/* regra nova do tipo (o "New Rule..." do editor): nome livre na lista do tipo, prioridade 1 */
function novaRegra(conjunto, kind){
  const nomes = new Set((conjunto.rules || []).map(r => r.name));
  let n = kind, i = 1;
  while (nomes.has(n)) n = kind + '_' + (i++);
  return Object.assign({ name:n, kind, enabled:true, priority:1, scope1:'All', scope2:'All', comment:'' }, camposPadrao(kind));
}

/* ============================== conjunto: ler, normalizar, gravar ============================== */

/* prioridade como o Altium: 1..n sem buraco dentro de cada tipo, na ordem atual */
function normaliza(S){
  const out = { format:FORMATO, units:'mm', origem: S && S.origem || '', classes:{ net:{}, comp:{}, pad:{} }, verificar:null, rules:[] };
  /* o "Rules To Check": sem ele, o da casa */
  const V = S && S.verificar;
  out.verificar = (V && Array.isArray(V.lote) && Array.isArray(V.online))
    ? { lote: V.lote.filter(k => typeof k === 'string'), online: V.online.filter(k => typeof k === 'string') } : dcopy(VERIFICAR_CASA);
  if (S && S.classes && typeof S.classes === 'object')
    for (const g of ['net', 'comp', 'pad']) if (S.classes[g] && typeof S.classes[g] === 'object')
      for (const [k, v] of Object.entries(S.classes[g])) if (Array.isArray(v)) out.classes[g][k] = v.map(String);
  const lista = (S && Array.isArray(S.rules) ? S.rules : []).filter(r => r && typeof r.kind === 'string');
  for (const r of lista) {
    const o = Object.assign({ name: String(r.name || r.kind), kind:r.kind, enabled: r.enabled !== false,
                              priority: isNum(r.priority) ? r.priority : 1, scope1: r.scope1 || 'All', scope2: r.scope2 || 'All',
                              comment: r.comment || '' }, TIPOS[r.kind] ? camposPadrao(r.kind) : {});
    for (const k of Object.keys(r)) if (!(k in { name:1, kind:1, enabled:1, priority:1, scope1:1, scope2:1, comment:1 })) o[k] = dcopy(r[k]);
    out.rules.push(o);
  }
  const porTipo = new Map();
  out.rules.forEach((r, i) => { if (!porTipo.has(r.kind)) porTipo.set(r.kind, []); porTipo.get(r.kind).push([r, i]); });
  for (const L of porTipo.values()) {
    L.sort((a, b) => a[0].priority - b[0].priority || a[1] - b[1]);
    L.forEach((p, i) => { p[0].priority = i + 1; });
  }
  /* a ordem da lista: a das categorias, depois a prioridade */
  const ordem = k => { let n = 0; for (const c of CATEGORIAS) { const i = c.tipos.indexOf(k); if (i >= 0) return n + i; n += 50; } return 999; };
  out.rules.sort((a, b) => ordem(a.kind) - ordem(b.kind) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.priority - b.priority);
  return out;
}

/* board.js -> conjunto: a base (padrão: a casa) com o board.rules do espelho por cima
   ({sm, pm, clearance, width, viaSize, viaDrill} em mm: a regra de escopo All de cada tipo,
   que é o que o ExportBoard e o pcbdoc2board leem). Se o board.js trouxer o conjunto inteiro
   (board.pcbrules, reservado para o leitor de PcbDoc), ele manda. */
function doBoard(board, base){
  const B = board || {};
  if (B.pcbrules && typeof B.pcbrules === 'object') return ler(B.pcbrules);
  const S = normaliza(base || padroesCasa());
  const r = B.rules && typeof B.rules === 'object' ? B.rules : null;
  if (!r) return S;
  const geral = k => S.rules.find(x => x.kind === k && /^all$/i.test(x.scope1) && /^all$/i.test(x.scope2));
  let g;
  if (isNum(r.clearance) && (g = geral('Clearance'))) g.gap = r.clearance;
  if (isNum(r.width) && (g = geral('Width'))) { g.pref = r.width; if (g.max < r.width) g.max = r.width; if (g.min > r.width) g.min = r.width; }
  if (isNum(r.viaSize) && (g = geral('RoutingVias'))) { g.pref = r.viaSize; if (g.max < r.viaSize) g.max = r.viaSize; if (g.min > r.viaSize) g.min = r.viaSize; }
  if (isNum(r.viaDrill) && (g = geral('RoutingVias'))) { g.holePref = r.viaDrill; if (g.holeMax < r.viaDrill) g.holeMax = r.viaDrill; if (g.holeMin > r.viaDrill) g.holeMin = r.viaDrill; }
  if (isNum(r.sm) && (g = geral('SolderMaskExpansion'))) g.expansion = r.sm;
  if (isNum(r.pm) && (g = geral('PasteMaskExpansion'))) g.expansion = r.pm;
  S.origem = (S.origem ? S.origem + ' + ' : '') + 'board.rules do espelho';
  return S;
}

/* ---- os registros crus do Rules6 -> o formato do rules.js ----
   O PcbDoc guarda cada regra como |CHAVE=VALOR|...; o pcbdoc2board --regras os grava sem
   tradução (o lado Python não precisa saber o que cada campo quer dizer: quem sabe é este
   módulo, num lugar só). Tipo que o hub não modela atravessa com os campos crus em `altium`. */
function deAltium(registros, classes, drc){
  const avisos = [];
  const regras = [];
  for (const p of Array.isArray(registros) ? registros : []) {
    if (!p || typeof p !== 'object' || !p.RULEKIND) continue;
    const k = p.RULEKIND, L = v => paraMm(v);
    const r = { name:p.NAME || k, kind:k, enabled: p.ENABLED == null ? true : bool(p.ENABLED),
                priority: parseInt(p.PRIORITY, 10) || 1, scope1: p.SCOPE1EXPRESSION || 'All', scope2: p.SCOPE2EXPRESSION || 'All',
                comment: p.COMMENT || '' };
    if (k === 'Clearance') {
      Object.assign(r, { gap:L(p.GAP || p.GENERICCLEARANCE), netscope:p.NETSCOPE || 'DifferentNets', layerkind:p.LAYERKIND || 'SameLayer',
                         ignorePadToPad: bool(p.IGNOREPADTOPADCLEARANCEINFOOTPRINT || 'FALSE'), matrix:{} });
      /* "ClearanceObj_Track-ClearanceObj_Hole:0;..." em 1/10000 mil */
      for (const par of String(p.OBJECTCLEARANCES || '').split(';')) {
        const m1 = /^ClearanceObj_(\w+)-ClearanceObj_(\w+):(-?\d+(?:\.\d+)?)$/.exec(par.trim());
        if (m1) r.matrix[m1[1] + '-' + m1[2]] = mm(parseFloat(m1[3]) / 10000);
      }
    } else if (k === 'ShortCircuit') r.allowed = bool(p.ALLOWED || 'FALSE');
    else if (k === 'UnRoutedNet' || k === 'UnConnectedPin') { /* sem parâmetro */ }
    else if (k === 'Width') {
      Object.assign(r, { min:L(p.MINLIMIT), pref:L(p.PREFEREDWIDTH), max:L(p.MAXLIMIT) });
      /* a tabela por camada (Layer Attributes): o Altium só grava a camada cujo valor difere do
         geral — MIDLAYER1_MINWIDTH sem MIDLAYER1_MAXWIDTH quer dizer máx. = o geral (MIF) */
      const por = {};
      for (const [ch, v] of Object.entries(p)) {
        const m1 = /^(TOPLAYER|BOTTOMLAYER|MIDLAYER(\d+))_(MIN|PREF|MAX)WIDTH$/.exec(ch);
        if (!m1) continue;
        const cam = m1[1] === 'TOPLAYER' ? 'Top' : m1[1] === 'BOTTOMLAYER' ? 'Bottom' : 'Mid' + m1[2];
        (por[cam] = por[cam] || {})[{ MIN:'min', PREF:'pref', MAX:'max' }[m1[3]]] = L(v);
      }
      if (Object.keys(por).length) r.porCamada = por;
    } else if (k === 'RoutingVias') {
      Object.assign(r, { min:L(p.MINWIDTH), pref:L(p.WIDTH), max:L(p.MAXWIDTH), holeMin:L(p.MINHOLEWIDTH), holePref:L(p.HOLEWIDTH),
                         holeMax:L(p.MAXHOLEWIDTH), style:p.VIASTYLE || 'Through Hole' });
    } else if (k === 'RoutingCorners') Object.assign(r, { style:p.CORNERSTYLE || '45-Degree', setbackMin:L(p.MINSETBACK), setbackMax:L(p.MAXSETBACK) });
    else if (k === 'RoutingLayers') {
      const camadas = {};
      for (const [ch, v] of Object.entries(p)) {
        const m1 = /^(TOP LAYER|BOTTOM LAYER|MID LAYER (\d+))_V5$/.exec(ch);
        if (m1) camadas[m1[1] === 'TOP LAYER' ? 'Top' : m1[1] === 'BOTTOM LAYER' ? 'Bottom' : 'Mid' + m1[2]] = bool(v);
      }
      r.layers = Object.keys(camadas).length ? camadas : TODAS_CAMADAS();
    } else if (k === 'PolygonConnect') {
      Object.assign(r, { style:p.CONNECTSTYLE || 'Relief', conductors:parseInt(p.RELIEFENTRIES, 10) || 4, width:L(p.RELIEFCONDUCTORWIDTH),
                         angle: /45/.test(p.POLYGONRELIEFANGLE || '') ? 45 : 90, airgap:L(p.AIRGAPWIDTH) });
    } else if (k === 'PlaneClearance') r.gap = L(p.CLEARANCE);
    else if (k === 'SolderMaskExpansion') Object.assign(r, { expansion:L(p.EXPANSION), tentTop:bool(p.ISTENTINGTOP || 'FALSE'), tentBottom:bool(p.ISTENTINGBOTTOM || 'FALSE') });
    else if (k === 'PasteMaskExpansion') r.expansion = L(p.EXPANSION);
    else if (k === 'HoleSize') Object.assign(r, { min:L(p.MINLIMIT), max:L(p.MAXLIMIT), absolute:bool(p.ABSOLUTEVALUES || 'TRUE'),
                                                 minPct:parseFloat(p.MINPERCENT) || 20, maxPct:parseFloat(p.MAXPERCENT) || 80 });
    else if (k === 'HoleToHoleClearance') Object.assign(r, { gap:L(p.GAP), allowStackedMicrovias:bool(p.ALLOWSTACKEDMICROVIAS || 'TRUE') });
    else if (k === 'MinimumSolderMaskSliver') r.min = L(p.MINSOLDERMASKWIDTH);
    else if (k === 'SilkToSolderMaskClearance') Object.assign(r, { gap:L(p.MINSILKSCREENTOMASKGAP), exposedCopper:bool(p.CLEARANCETOEXPOSEDCOPPER || 'TRUE') });
    else if (k === 'SilkToSilkClearance') r.gap = L(p.SILKTOSILKCLEARANCE);
    else if (k === 'NetAntennae') r.tolerance = L(p.NETANTENNAETOLERANCE || '0mil');
    else if (k === 'ComponentClearance') Object.assign(r, { gap:L(p.GAP), verticalGap:L(p.VERTICALGAP || p.GAP) });
    else if (k === 'BoardOutlineClearance') r.gap = L(p.GAP || p.CLEARANCE || p.BOARDOUTLINECLEARANCE || '0mil');
    else {
      /* tipo que o hub não modela: guarda o resto cru, para a volta ao Altium não perder nada */
      const raw = {};
      for (const [ch, v] of Object.entries(p))
        if (!['SELECTION', 'LAYER', 'LOCKED', 'POLYGONOUTLINE', 'USERROUTED', 'KEEPOUT', 'UNIONINDEX', 'RULEKIND', 'NAME', 'ENABLED', 'PRIORITY',
              'SCOPE1EXPRESSION', 'SCOPE2EXPRESSION', 'COMMENT'].includes(ch)) raw[ch] = v;
      r.altium = raw;
    }
    for (const [ch, v] of Object.entries(r)) if (typeof v === 'number' && !isFinite(v)) { avisos.push('regra "' + r.name + '": ' + ch + ' ilegível'); delete r[ch]; }
    regras.push(r);
  }
  let verificar = null;
  if (drc && typeof drc === 'object' && (drc.RULESETTOCHECK != null || drc.ONLINERULESETTOCHECK != null))
    verificar = { lote: deIndices(drc.RULESETTOCHECK), online: deIndices(drc.ONLINERULESETTOCHECK) };
  return Object.assign(normaliza({ origem:'Rules6 do .PcbDoc', classes:deClasses(classes), verificar, rules:regras }), { avisos });
}
/* Classes6 cru ({KIND, NAME, SUPERCLASS, M0, M1...}) ou já no formato {net:{...}} */
function deClasses(c){
  const out = { net:{}, comp:{}, pad:{} };
  if (!c) return out;
  if (!Array.isArray(c)) { for (const g of ['net', 'comp', 'pad']) if (c[g]) Object.assign(out[g], c[g]); return out; }
  for (const k of c) {
    if (!k || bool(k.SUPERCLASS || 'FALSE')) continue;
    const g = { 0:'net', 1:'comp', 3:'pad' }[String(k.KIND)];
    if (!g) continue;
    const membros = Object.keys(k).filter(x => /^M\d+$/.test(x)).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10)).map(x => k[x]);
    out[g][k.NAME || ''] = membros;
  }
  return out;
}

/* o rules.js: texto (var pcbrules = {...};) ou o objeto já carregado. Com "altium" (os
   registros crus do pcbdoc2board) e sem "rules", traduz. */
function ler(fonte){
  let o = fonte;
  if (typeof fonte === 'string') {
    const s = fonte.replace(/^\uFEFF/, '');
    const i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i < 0 || j < i) throw new Error('rules.js: não achei o objeto');
    o = JSON.parse(s.slice(i, j + 1));
  }
  if (!o || typeof o !== 'object') throw new Error('rules.js: vazio');
  if (!Array.isArray(o.rules) && Array.isArray(o.altium)) {
    const S = deAltium(o.altium, o.classes, o.drc);
    if (o.origem) S.origem = o.origem;
    return S;
  }
  return normaliza(o);
}
/* uma regra por linha, como o changes.js: o diff de quem mexeu fica legível */
function serializa(S){
  const N = normaliza(S);
  const linhas = ['// regras de projeto do hub (HubPcbRegras): mm, uma regra por linha; prioridade 1 = vence',
                  'var pcbrules = {',
                  '"format":' + JSON.stringify(FORMATO) + ',',
                  '"units":"mm",',
                  '"origem":' + JSON.stringify(N.origem || '') + ',',
                  '"classes":' + JSON.stringify(N.classes) + ',',
                  '"verificar":' + JSON.stringify(N.verificar) + ',',
                  '"rules":['];
  N.rules.forEach((r, i) => linhas.push(JSON.stringify(r) + (i < N.rules.length - 1 ? ',' : '')));
  linhas.push(']};', '');
  return linhas.join('\n');
}

/* ============================== a linguagem de escopo ============================== */

const RX_TOK = /\s*(\(|\)|'(?:[^']|'')*'|"[^"]*"|&&|\|\||!=|<=|>=|<>|!|=|<|>|,|[A-Za-z_][A-Za-z0-9_]*|[-+]?\d+(?:\.\d+)?)/y;
function tokens(s){
  const out = [];
  RX_TOK.lastIndex = 0;
  let i = 0;
  const t = String(s == null ? '' : s);
  while (i < t.length) {
    if (/^\s*$/.test(t.slice(i))) break;
    RX_TOK.lastIndex = i;
    const m1 = RX_TOK.exec(t);
    if (!m1 || m1.index !== i) throw new Error('caractere inesperado em "' + t.slice(i, i + 12) + '"');
    out.push(m1[1]);
    i = RX_TOK.lastIndex;
  }
  return out;
}
const str = tk => (tk[0] === "'" ? tk.slice(1, -1).replace(/''/g, "'") : tk[0] === '"' ? tk.slice(1, -1) : tk);

/* as funções: nome em minúsculas -> (args, desc, ctx) -> bool. Ausente = null (não sei). */
const ci = (a, b) => String(a == null ? '' : a).toLowerCase() === String(b == null ? '' : b).toLowerCase();
const naClasse = (ctx, g, nome, valor) => {
  const C0 = ctx && ctx.classes && ctx.classes[g];
  if (!C0) return false;
  for (const [k, membros] of Object.entries(C0)) if (ci(k, nome)) return membros.some(m1 => ci(m1, valor));
  return false;
};
const FUNCOES = {
  all: () => true,
  innet: (a, d) => !!d.net && ci(d.net, a[0]),
  inanynet: (a, d) => !!d.net,
  innetclass: (a, d, ctx) => !!d.net && (ci(a[0], 'All Nets') || naClasse(ctx, 'net', a[0], d.net)),
  incomponent: (a, d) => !!d.comp && ci(d.comp, a[0]),
  incomponentclass: (a, d, ctx) => !!d.comp && (ci(a[0], 'All Components') || naClasse(ctx, 'comp', a[0], d.comp)),
  inpadclass: (a, d, ctx) => d.tipo === 'pad' && (ci(a[0], 'All Pads') || naClasse(ctx, 'pad', a[0], d.pad)),
  hasfootprint: (a, d) => !!d.footprint && ci(d.footprint, a[0]),
  onlayer: (a, d, ctx) => { const k = chaveCamada(a[0], ctx && ctx.board); return !!k && d.layer === k; },
  isvia: (a, d) => d.tipo === 'via',
  ispad: (a, d) => d.tipo === 'pad',
  issmdpad: (a, d) => d.tipo === 'pad' && !!d.smd,
  issmtpad: (a, d) => d.tipo === 'pad' && !!d.smd,
  isthruhole: (a, d) => d.tipo === 'pad' && !d.smd,
  isthpad: (a, d) => d.tipo === 'pad' && !d.smd,
  ispadth: (a, d) => d.tipo === 'pad' && !d.smd,
  istrack: (a, d) => d.tipo === 'track',
  isarc: (a, d) => d.tipo === 'arc',
  isfill: (a, d) => d.tipo === 'fill',
  isregion: (a, d) => d.tipo === 'region',
  istext: (a, d) => d.tipo === 'text',
  ispolygon: (a, d) => !!d.poly,
  inpolygon: (a, d) => !!d.poly,
  iskeepout: (a, d) => !!d.keepout,
  iscomponent: (a, d) => d.tipo === 'comp',
  ishole: (a, d) => d.tipo === 'hole',
};
const ARIDADE = { innet:1, innetclass:1, incomponent:1, incomponentclass:1, inpadclass:1, hasfootprint:1, onlayer:1 };

/* expressão -> árvore {op:'and'|'or'|'not'|'fn'|'const', ...} */
function parse(expr){
  const T = tokens(expr);
  let i = 0;
  const pega = () => T[i];
  const low = () => (T[i] || '').toLowerCase();
  const desconhecidas = new Set();
  function ou(){
    let a = e();
    while (low() === 'or' || T[i] === '||') { i++; a = { op:'or', a, b:e() }; }
    return a;
  }
  function e(){
    let a = nao();
    while (low() === 'and' || T[i] === '&&') { i++; a = { op:'and', a, b:nao() }; }
    return a;
  }
  function nao(){
    if (low() === 'not' || T[i] === '!') { i++; return { op:'not', a:nao() }; }
    return atomo();
  }
  function atomo(){
    const t = pega();
    if (t === undefined) throw new Error('a expressão terminou no meio');
    if (t === '(') { i++; const v = ou(); if (pega() !== ')') throw new Error('falta ")"'); i++; return v; }
    if (!/^[A-Za-z_]/.test(t)) throw new Error('esperava uma função e veio "' + t + '"');
    i++;
    const nome = t.toLowerCase();
    if (nome === 'true') return { op:'const', v:true };
    if (nome === 'false') return { op:'const', v:false };
    const args = [];
    if (pega() === '(') {
      i++;
      while (pega() !== ')') {
        if (pega() === undefined) throw new Error('falta ")" em ' + t);
        if (pega() !== ',') args.push(str(pega()));
        i++;
      }
      i++;
    }
    /* comparação (CompPinCount < 5, NetName = 'GND'): o hub não modela — vira desconhecida */
    if (pega() && /^(=|<>|!=|<|>|<=|>=)$/.test(pega())) {
      i += 2;
      /* o valor pode vir com unidade: "Width > 10 AsMils" (o MIRBC tem) */
      if (/^as(mils|mm|inches)$/i.test(pega() || '')) i++;
      desconhecidas.add(t); return { op:'fn', nome:'?', t, args };
    }
    if (!(nome in FUNCOES)) desconhecidas.add(t);
    else if (ARIDADE[nome] && args.length < ARIDADE[nome]) throw new Error(t + ' precisa de um argumento entre aspas simples');
    return { op:'fn', nome: nome in FUNCOES ? nome : '?', t, args };
  }
  const arv = ou();
  if (i !== T.length) throw new Error('sobrou "' + T.slice(i).join(' ') + '"');
  return { arv, desconhecidas:[...desconhecidas] };
}
/* lógica de três valores: null = não sei (o Altium sabe, o hub não) */
function avaliaArv(n, d, ctx){
  switch (n.op) {
    case 'const': return n.v;
    case 'not': { const v = avaliaArv(n.a, d, ctx); return v === null ? null : !v; }
    case 'and': { const a = avaliaArv(n.a, d, ctx); if (a === false) return false; const b = avaliaArv(n.b, d, ctx);
                  return b === false ? false : (a === null || b === null) ? null : true; }
    case 'or':  { const a = avaliaArv(n.a, d, ctx); if (a === true) return true; const b = avaliaArv(n.b, d, ctx);
                  return b === true ? true : (a === null || b === null) ? null : false; }
    case 'fn':  return n.nome === '?' ? null : !!FUNCOES[n.nome](n.args, d || {}, ctx);
  }
  return null;
}
const CACHE = new Map();
function compila(expr){
  const k = String(expr == null || String(expr).trim() === '' ? 'All' : expr);
  let c = CACHE.get(k);
  if (c) return c;
  try {
    const p = parse(k);
    c = { ok:true, erro:'', expr:k, desconhecidas:p.desconhecidas, avalia:(d, ctx) => avaliaArv(p.arv, d, ctx) };
  } catch (e) {
    c = { ok:false, erro:e.message, expr:k, desconhecidas:[], avalia:() => null };
  }
  if (CACHE.size > 5000) CACHE.clear();
  CACHE.set(k, c);
  return c;
}
const avaliaEscopo = (expr, d, ctx) => compila(expr).avalia(d, ctx);

/* ============================== a regra vencedora ============================== */

/* Como o Altium: das regras HABILITADAS do tipo, a de menor número de prioridade cujo escopo
   casa. Regra binária (Clearance, ShortCircuit...) casa o par em qualquer ordem: escopo 1 com A
   e 2 com B, ou 1 com B e 2 com A. Escopo que o hub não entende (null) tira a regra da conta, e
   o aviso diz qual — como o leitor de PcbDoc faz. */
function resolvedor(conjunto, ctx0){
  const S = conjunto && conjunto.rules ? conjunto : normaliza(conjunto || {});
  const ctx = Object.assign({ classes:S.classes || {} }, ctx0 || {});
  const avisos = [];
  const avisado = new Set();
  const porTipo = new Map();
  for (const r of S.rules) {
    if (!r.enabled) continue;
    if (!porTipo.has(r.kind)) porTipo.set(r.kind, []);
    porTipo.get(r.kind).push({ r, s1:compila(r.scope1), s2:compila(r.scope2) });
  }
  for (const L of porTipo.values()) L.sort((a, b) => a.r.priority - b.r.priority);
  const avisa = (x, qual) => {
    const k = x.r.kind + '|' + x.r.name + '|' + qual;
    if (avisado.has(k)) return;
    avisado.add(k);
    const c = qual === 1 ? x.s1 : x.s2;
    avisos.push('regra ' + x.r.kind + ' "' + x.r.name + '": ' + (c.ok ? 'o hub não entende ' + c.desconhecidas.join(', ') : 'escopo inválido (' + c.erro + ')') +
                ' no escopo ' + qual + ' — fica de fora do DRC');
  };
  /* cache por descritor (o DRC pergunta milhares de vezes pelos mesmos objetos) */
  const memo = new WeakMap();
  const casa = (x, qual, d) => {
    let m1 = memo.get(d);
    if (!m1) { m1 = new Map(); memo.set(d, m1); }
    const k = x.r.kind + '\u0001' + x.r.name + '\u0001' + qual;
    if (m1.has(k)) return m1.get(k);
    const v = (qual === 1 ? x.s1 : x.s2).avalia(d, ctx);
    if (v === null) avisa(x, qual);
    m1.set(k, v);
    return v;
  };
  function regraPara(kind, a, b){
    const L = porTipo.get(kind);
    if (!L) return null;
    for (const x of L) {
      if (b === undefined || b === null || !TIPOS[kind] || !TIPOS[kind].binaria) {
        if (casa(x, 1, a) === true) return x.r;
      } else {
        if ((casa(x, 1, a) === true && casa(x, 2, b) === true) || (casa(x, 1, b) === true && casa(x, 2, a) === true)) return x.r;
      }
    }
    return null;
  }
  return { regraPara, regras: kind => (porTipo.get(kind) || []).map(x => x.r), tem: kind => porTipo.has(kind), avisos, ctx };
}
const regraPara = (conjunto, kind, a, b) => resolvedor(conjunto).regraPara(kind, a, b);

/* os descritores de query de toda a placa (o "N objetos casam" do editor de regras): pads, vias,
   trilhas, arcos, fills, regiões e textos, no mesmo formato que o DRC monta */
function descritores(eb){
  const B = eb || {}, out = [];
  const cob = k => typeof k === 'string' && /^(Top|Bottom|Mid\d+|Plane\d+)$/.test(k);
  for (const c of B.components || []) {
    if (!c) continue;
    out.push({ tipo:'comp', comp:c.ref, footprint:c.footprint || '', layer:c.layer, net:'', id:c.id });
    for (const p of c.pads || []) if (p) {
      const th = p.layer === 'Multi' || p.type === 'th';
      out.push({ tipo:'pad', net:p.net || '', layer:th ? 'Multi' : p.layer, comp:c.ref, footprint:c.footprint || '', smd:!th,
                 pad:c.ref + '-' + p.name, id:p.id });
    }
  }
  for (const p of B.freepads || []) if (p) out.push({ tipo:'pad', net:p.net || '', layer:p.layer, smd:p.type !== 'th', id:p.id, comp:'', footprint:'' });
  for (const v of B.vias || []) if (v) out.push({ tipo:'via', net:v.net || '', layer:'Multi', id:v.id });
  for (const t of B.tracks || []) if (t && cob(t.layer)) out.push({ tipo:'track', net:t.net || '', layer:t.layer, comp:t.owner || '', keepout:!!t.keepout, id:t.id });
  for (const a of B.arcs || []) if (a && cob(a.layer)) out.push({ tipo:'arc', net:a.net || '', layer:a.layer, comp:a.owner || '', keepout:!!a.keepout, id:a.id });
  for (const f of B.fills || []) if (f) out.push({ tipo:'fill', net:f.net || '', layer:f.layer, comp:f.owner || '', keepout:!!f.keepout, id:f.id });
  for (const g of B.regions || []) if (g) out.push({ tipo:'region', net:g.net || '', layer:g.layer, poly:!!g.poly, comp:g.owner || '', keepout:!!g.keepout, id:g.id });
  for (const t of B.texts || []) if (t) out.push({ tipo:'text', net:'', layer:t.layer, comp:t.owner || '', id:t.id });
  return out;
}

/* a checagem do tipo roda no modo ('lote' = o DRC inteiro, 'online' = durante a edição)? */
const verifica = (conjunto, kind, modo) => {
  const V = conjunto && conjunto.verificar;
  if (!V || !Array.isArray(V[modo || 'lote'])) return true;
  return V[modo || 'lote'].indexOf(kind) >= 0;
};

/* o tipo do objeto na matriz de folgas do Clearance, pelo descritor */
function tipoMatriz(d){
  const t = d && d.tipo;
  if (t === 'pad') return d.smd ? 'SMDPad' : 'THPad';
  if (t === 'region') return d.poly ? 'Poly' : 'Region';
  return { track:'Track', arc:'Arc', via:'Via', fill:'Fill', text:'Text', hole:'Hole' }[t] || 'Track';
}
/* A FOLGA VENCEDORA entre dois objetos (descritores), como o DRC confere: a regra Clearance de
   maior prioridade que casa o par, com a matriz de objetos. É o que o polygon pour usa para
   recuar o cobre de cada objeto. `fonte` = o conjunto ou um resolvedor já montado (mais rápido
   em laço). Devolve {gap, regra} (gap em mm; regra null = nenhuma casou, gap 0), ou gap null
   quando a regra é de mesma net (SameNet) e o par é de nets diferentes, ou vice-versa. */
function folgaEntre(fonte, a, b){
  const res = fonte && typeof fonte.regraPara === 'function' ? fonte : resolvedor(fonte);
  const r = res.regraPara('Clearance', a, b);
  if (!r) return { gap:0, regra:null };
  const mesma = !!(a && b && a.net && a.net === b.net);
  if ((r.netscope === 'DifferentNets' && mesma) || (r.netscope === 'SameNet' && !mesma)) return { gap:null, regra:r };
  const ta = tipoMatriz(a), tb = tipoMatriz(b), M = r.matrix || {};
  const v = isNum(M[ta + '-' + tb]) ? M[ta + '-' + tb] : isNum(M[tb + '-' + ta]) ? M[tb + '-' + ta] : r.gap;
  return { gap: isNum(v) ? v : 0, regra:r };
}

/* o maior valor de folga de um tipo (o DRC usa para o raio da busca no índice) */
function maiorFolga(conjunto, kind, campo){
  let m1 = 0;
  for (const r of (conjunto && conjunto.rules) || []) {
    if (!r.enabled || r.kind !== kind) continue;
    if (isNum(r[campo])) m1 = Math.max(m1, r[campo]);
    if (r.matrix) for (const v of Object.values(r.matrix)) if (isNum(v)) m1 = Math.max(m1, v);
  }
  return m1;
}

return {
  FORMATO, CATEGORIAS, TIPOS, OBJ_MATRIZ, KINDS_AD21, VERIFICAR_CASA, VERIFICAR_FABRICA, verifica, deIndices, paraIndices,
  padroesAltium, padroesCasa, padroes, novaRegra, camposPadrao,
  normaliza, doBoard, deAltium, deClasses, ler, serializa,
  compila, avaliaEscopo, resolvedor, regraPara, folgaEntre, tipoMatriz, maiorFolga, descritores,
  paraMm, mil, fmt, chaveCamada, nomeAltium,
};
});
