/* As regras de projeto (hub-pcbregras.js), provadas sem navegador: os valores padrão MEDIDOS, a
   linguagem de escopo (a query do Altium), a regra vencedora por prioridade, a tradução do Rules6
   cru do PcbDoc e a ida e volta do rules.js.

   Os números dos padrões estão escritos aqui de propósito, em mil, como o Rules6 os grava: se
   alguém "arredondar" um padrão no módulo, o teste diz qual. */
const assert = require('assert');
const R = require('../hub-pcbregras.js');

const mm = mil => Math.round(mil * 0.0254 * 1e5) / 1e5;
const por = (S, k, nome) => S.rules.find(r => r.kind === k && (!nome || r.name === nome));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

/* ============================== unidades ============================== */
eq(R.paraMm('10mil'), 0.254, '10 mil');
eq(R.paraMm('118.1102mil'), 3, '3 mm gravado em mil volta redondo');
eq(R.paraMm('3.937mil'), 0.1, '0,1 mm');
eq(R.paraMm('19.685mil'), 0.5, '0,5 mm');
eq(R.paraMm('0.2mm'), 0.2, 'mm');
eq(R.paraMm(0.3), 0.3, 'número cru é mm');
ok(isNaN(R.paraMm('abc')), 'lixo');
eq(R.fmt(0.254, 'mil'), '10mil', 'fmt mil');
eq(R.chaveCamada('Top Layer'), 'Top', 'Top Layer');
eq(R.chaveCamada('TopLayer'), 'Top', 'TopLayer');
eq(R.chaveCamada('Mid-Layer 2'), 'Mid2', 'Mid-Layer 2');
eq(R.chaveCamada('MultiLayer'), 'Multi', 'MultiLayer');
eq(R.chaveCamada('Top Overlay'), 'TopOverlay', 'Top Overlay');
eq(R.chaveCamada('Mechanical 13'), 'Mech13', 'Mechanical 13');
eq(R.chaveCamada('Top 3D Body', { layers:[{ key:'Mech13', name:'Top 3D Body' }] }), 'Mech13', 'nome da placa');

/* ============================== padrões medidos ============================== */
const A = R.padroesAltium(), C = R.padroesCasa();
/* o A4.PCBDOC do AD21 */
eq(por(A, 'Clearance').gap, mm(10), 'fábrica: clearance 10 mil');
eq(por(A, 'Clearance').netscope, 'DifferentNets', 'fábrica: nets diferentes');
eq([por(A, 'Width').min, por(A, 'Width').pref, por(A, 'Width').max], [mm(10), mm(10), mm(10)], 'fábrica: largura 10/10/10');
eq([por(A, 'RoutingVias').pref, por(A, 'RoutingVias').holePref], [mm(50), mm(28)], 'fábrica: via 50/28');
eq([por(A, 'HoleSize').min, por(A, 'HoleSize').max], [mm(1), mm(100)], 'fábrica: furo 1..100 mil');
eq(por(A, 'PolygonConnect').style, 'Relief', 'fábrica: relief');
eq([por(A, 'PolygonConnect').conductors, por(A, 'PolygonConnect').width, por(A, 'PolygonConnect').angle, por(A, 'PolygonConnect').airgap], [4, mm(10), 90, mm(10)], 'fábrica: relief 4x10 mil a 90, folga 10');
eq(por(A, 'PlaneClearance').gap, mm(20), 'fábrica: plano 20 mil');
eq(por(A, 'SolderMaskExpansion').expansion, mm(4), 'fábrica: máscara 4 mil');
eq(por(A, 'PasteMaskExpansion').expansion, 0, 'fábrica: pasta 0');
eq(por(A, 'HoleToHoleClearance').gap, mm(10), 'fábrica: furo-a-furo 10 mil');
eq(por(A, 'MinimumSolderMaskSliver').min, mm(10), 'fábrica: sliver 10 mil');
eq([por(A, 'SilkToSolderMaskClearance').gap, por(A, 'SilkToSolderMaskClearance').scope1, por(A, 'SilkToSolderMaskClearance').exposedCopper], [mm(10), 'IsPad', true], 'fábrica: silk-máscara');
eq(por(A, 'SilkToSilkClearance').gap, mm(10), 'fábrica: silk-silk');
eq(por(A, 'NetAntennae').tolerance, 0, 'fábrica: antena 0');
eq(por(A, 'ComponentClearance').gap, mm(10), 'fábrica: componente 10 mil');
/* o template DieletronsAltium */
eq([por(C, 'Width').min, por(C, 'Width').pref, por(C, 'Width').max], [mm(5), mm(10), 3], 'casa: largura 5/10 mil..3 mm');
eq([por(C, 'RoutingVias').min, por(C, 'RoutingVias').pref, por(C, 'RoutingVias').max, por(C, 'RoutingVias').holeMin, por(C, 'RoutingVias').holePref, por(C, 'RoutingVias').holeMax],
   [0.1, 0.5, 3, 0.1, 0.3, 3], 'casa: via 0,5/0,3 em 0,1..3');
eq(por(C, 'HoleSize').max, 5, 'casa: furo até 5 mm');
eq(por(C, 'PolygonConnect').style, 'Direct', 'casa: direct');
eq(por(C, 'Clearance').matrix['Track-Hole'], 0, 'casa: furo na matriz a 0');
eq(R.padroes(), C, 'padrão = casa');
/* o Rules To Check: o lote da casa não confere silk nem componente; o online confere via e componente */
ok(R.verifica(C, 'Clearance', 'lote') && R.verifica(C, 'MinimumSolderMaskSliver', 'lote'), 'lote: clearance e sliver');
ok(!R.verifica(C, 'SilkToSolderMaskClearance', 'lote') && !R.verifica(C, 'SilkToSilkClearance', 'lote') && !R.verifica(C, 'ComponentClearance', 'lote'), 'lote sem silk nem componente');
ok(R.verifica(C, 'ComponentClearance', 'online') && R.verifica(C, 'RoutingVias', 'online') && !R.verifica(C, 'RoutingVias', 'lote'), 'online: componente e via');
eq(R.paraIndices(R.VERIFICAR_CASA.lote), '0,1,2,3,4,5,6,15,16,18,19,21,22,23,26,42,45,46,47,50,52,53,56,60,62,63,64', 'índices do lote da casa');
eq(R.KINDS_AD21.indexOf('MinimumSolderMaskSliver'), 53, 'tabela do Advpcb.dll');
/* toda categoria e todo tipo do editor existem */
for (const c of R.CATEGORIAS) for (const k of c.tipos) ok(R.TIPOS[k] && R.TIPOS[k].cat === c.id, 'tipo ' + k + ' na categoria ' + c.id);
for (const k of Object.keys(R.TIPOS)) ok(!!por(A, k) || k === 'UnConnectedPin', 'padrão de fábrica tem ' + k);

/* ============================== a query ============================== */
const pad = { tipo:'pad', net:'GND', layer:'Top', comp:'U1', footprint:'SOIC-8', smd:true, pad:'U1-4', id:'c1p4' };
const th = { tipo:'pad', net:'5V', layer:'Multi', comp:'J1', footprint:'CONN', smd:false, pad:'J1-1', id:'c2p1' };
const via = { tipo:'via', net:'GND', layer:'Multi', id:'v1' };
const trk = { tipo:'track', net:'0V', layer:'Bottom', id:'t1' };
const poly = { tipo:'region', net:'GND', layer:'Top', poly:true, id:'g1' };
const semNet = { tipo:'track', net:'', layer:'Top', id:'t2' };
const ctx = { classes:{ net:{ POWER:['5V', '0V'] }, comp:{ CONECTORES:['J1'] }, pad:{ TESTE:['U1-4'] } } };
const Q = (e, d) => R.avaliaEscopo(e, d, ctx);
eq(Q('All', trk), true, 'All');
eq(Q('', trk), true, 'vazio = All');
eq(Q("InNet('GND')", pad), true, 'InNet');
eq(Q("innet('gnd')", pad), true, 'InNet sem caixa');
eq(Q("InNet('GND')", th), false, 'InNet outra');
eq(Q("InNetClass('POWER')", th), true, 'InNetClass');
eq(Q("InNetClass('All Nets')", trk), true, 'superclasse All Nets');
eq(Q("InNetClass('All Nets')", semNet), false, 'sem net não está em All Nets');
eq(Q('InAnyNet', semNet), false, 'InAnyNet');
eq(Q("InComponent('U1')", pad), true, 'InComponent');
eq(Q("InComponentClass('CONECTORES')", th), true, 'InComponentClass');
eq(Q("InPadClass('TESTE')", pad), true, 'InPadClass');
eq(Q("HasFootprint('SOIC-8')", pad), true, 'HasFootprint');
eq(Q("OnLayer('Top Layer')", pad), true, 'OnLayer nome do Altium');
eq(Q("OnLayer('Bottom')", trk), true, 'OnLayer chave');
eq(Q("OnLayer('MultiLayer')", via), true, 'OnLayer Multi');
eq(Q("OnLayer('Top Layer')", th), false, 'pad passante não é Top');
eq([Q('IsVia', via), Q('IsPad', pad), Q('IsSMDPad', pad), Q('IsSMDPad', th), Q('IsThruHole', th), Q('IsTrack', trk), Q('InPolygon', poly), Q('IsPolygon', pad)],
   [true, true, true, false, true, true, true, false], 'Is*');
eq(Q("IsPad and InNet('GND')", pad), true, 'and');
eq(Q("IsVia or IsPad", trk), false, 'or');
eq(Q("not IsVia", trk), true, 'not');
eq(Q("IsPad || IsVia && InNet('5V')", via), false, 'and antes de or (&& / ||)');
eq(Q("(IsPad || IsVia) && InNet('GND')", via), true, 'parênteses');
eq(Q("!IsVia", via), false, '!');
eq(Q("InNet('O''Brien')", { tipo:'track', net:"O'Brien" }), true, 'aspas dobradas');
/* lógica de três valores: o que o hub não entende fica de fora, sem mentir */
eq(Q('CompPinCount < 5', pad), null, 'comparação: não sei');
eq(Q("TouchesRoom('x')", pad), null, 'função desconhecida: não sei');
eq(Q("TouchesRoom('x') or IsPad", pad), true, 'não sei OU verdade = verdade');
eq(Q("TouchesRoom('x') and IsVia", pad), false, 'não sei E falso = falso');
eq(Q("not TouchesRoom('x')", pad), null, 'não de não sei');
eq(R.compila('CompPinCount < 5').desconhecidas, ['CompPinCount'], 'diz qual não entendeu');
/* comparação com unidade (o MIRBC tem "AsMils"): entende a sintaxe, não o valor — nunca exceção */
const asm = R.compila("(InNet('GND')) and (Width > 10 AsMils)");
eq([asm.ok, asm.avalia({ net:'GND' }, ctx), asm.avalia({ net:'X' }, ctx)], [true, null, false], 'AsMils');
/* erro de sintaxe é erro, não "casa nada" */
for (const ruim of ["InNet('GND'", 'IsPad and', "InNet()", 'IsPad IsVia', '(IsPad']) {
  const c = R.compila(ruim);
  ok(!c.ok && c.erro, 'erro de sintaxe: ' + ruim);
}

/* ============================== a regra vencedora ============================== */
const S = R.normaliza({ rules:[
  { name:'Geral', kind:'Width', priority:3, scope1:'All', min:0.2, pref:0.25, max:3 },
  { name:'Terra', kind:'Width', priority:1, scope1:"InNet('0V')", min:0.5, pref:1, max:3 },
  { name:'Potencia', kind:'Width', priority:2, scope1:"InNetClass('POWER')", min:0.4, pref:0.8, max:3 },
  { name:'Desligada', kind:'Width', priority:1, scope1:'All', min:9, pref:9, max:9, enabled:false },
  { name:'Sala', kind:'Width', priority:1, scope1:"TouchesRoom('A')", min:7, pref:7, max:7 },
  { name:'Geral', kind:'Clearance', priority:2, scope1:'All', scope2:'All', gap:0.254 },
  { name:'PadVia', kind:'Clearance', priority:1, scope1:'IsVia', scope2:"InNet('5V')", gap:0.5 },
], classes:{ net:{ POWER:['5V', '0V'] } } });
/* a normalização renumera 1..n por tipo, na ordem: Desligada(1) Sala(1) Terra(1) Potencia(2) Geral(3) */
eq(S.rules.filter(r => r.kind === 'Width').map(r => r.priority).sort(), [1, 2, 3, 4, 5], 'prioridade 1..n sem buraco');
const RES = R.resolvedor(S);
eq(RES.regraPara('Width', trk).name, 'Terra', 'InNet 0V vence a classe POWER (prioridade)');
eq(RES.regraPara('Width', { tipo:'track', net:'5V', layer:'Top' }).name, 'Potencia', 'classe');
eq(RES.regraPara('Width', { tipo:'track', net:'X', layer:'Top' }).name, 'Geral', 'cai na geral');
ok(RES.avisos.some(a => /TouchesRoom/.test(a) && /Sala/.test(a)), 'aviso da regra que o hub não entende');
eq(RES.regraPara('Clearance', via, th).name, 'PadVia', 'binária: escopo 1 com A e 2 com B');
eq(RES.regraPara('Clearance', th, via).name, 'PadVia', 'binária: na ordem trocada também');
eq(RES.regraPara('Clearance', via, pad).name, 'Geral', 'binária: o par que não casa vai para a geral');
eq(R.regraPara(S, 'HoleSize', pad), null, 'tipo sem regra');
/* a folga do par (o que o polygon pour pergunta) */
const SM = R.normaliza({ rules:[{ name:'C', kind:'Clearance', scope1:'All', scope2:'All', gap:0.254, netscope:'DifferentNets', matrix:{ 'Poly-SMDPad':0.5 } }] });
eq(R.folgaEntre(SM, poly, { tipo:'pad', smd:true, net:'5V' }).gap, 0.5, 'matriz Poly x SMDPad');
eq(R.folgaEntre(SM, poly, trk).gap, 0.254, 'geral');
eq(R.folgaEntre(SM, poly, pad).gap, null, 'mesma net numa regra de nets diferentes: não se aplica');
eq(R.folgaEntre(R.resolvedor(SM), poly, trk).gap, 0.254, 'com o resolvedor pronto');

/* ============================== do Altium (Rules6 cru) ============================== */
const cru = [
  { RULEKIND:'Clearance', NAME:'Clearance', ENABLED:'TRUE', PRIORITY:'1', SCOPE1EXPRESSION:'All', SCOPE2EXPRESSION:'All', NETSCOPE:'DifferentNets',
    LAYERKIND:'SameLayer', GAP:'7.874mil', GENERICCLEARANCE:'7.874mil', IGNOREPADTOPADCLEARANCEINFOOTPRINT:'FALSE',
    OBJECTCLEARANCES:'ClearanceObj_Track-ClearanceObj_Via:100000;ClearanceObj_Arc-ClearanceObj_Hole:0' },
  { RULEKIND:'Width', NAME:'Schematic Width Constraint_11', ENABLED:'TRUE', PRIORITY:'24', SCOPE1EXPRESSION:"InNet('0V')", SCOPE2EXPRESSION:'All',
    MINLIMIT:'15.748mil', PREFEREDWIDTH:'39.3701mil', MAXLIMIT:'78.7402mil', MIDLAYER1_MINWIDTH:'10mil' },
  { RULEKIND:'RoutingVias', NAME:'RoutingVias', ENABLED:'TRUE', PRIORITY:'1', SCOPE1EXPRESSION:'All', SCOPE2EXPRESSION:'All',
    HOLEWIDTH:'28mil', WIDTH:'50mil', MINHOLEWIDTH:'28mil', MINWIDTH:'50mil', MAXHOLEWIDTH:'28mil', MAXWIDTH:'50mil', VIASTYLE:'Through Hole' },
  { RULEKIND:'SilkToSolderMaskClearance', NAME:'S', ENABLED:'FALSE', PRIORITY:'1', SCOPE1EXPRESSION:'IsPad', SCOPE2EXPRESSION:'All',
    MINSILKSCREENTOMASKGAP:'0.3937mil', CLEARANCETOEXPOSEDCOPPER:'TRUE' },
  { RULEKIND:'Height', NAME:'Height', ENABLED:'TRUE', PRIORITY:'1', SCOPE1EXPRESSION:'All', SCOPE2EXPRESSION:'All', MINHEIGHT:'0mil', MAXHEIGHT:'1000mil', SELECTION:'FALSE' },
];
const classes = [{ KIND:'0', NAME:'POWER', SUPERCLASS:'FALSE', M0:'5V', M1:'0V' }, { KIND:'0', NAME:'All Nets', SUPERCLASS:'TRUE' }];
const D = R.deAltium(cru, classes, { RULESETTOCHECK:'0,15,16,53', ONLINERULESETTOCHECK:'0,24' });
eq(por(D, 'Clearance').gap, 0.2, 'GAP em mil -> mm');
eq(por(D, 'Clearance').matrix, { 'Track-Via':0.254, 'Arc-Hole':0 }, 'matriz em 1/10000 mil');
eq([por(D, 'Width').min, por(D, 'Width').pref, por(D, 'Width').max, por(D, 'Width').priority], [0.4, 1, 2, 1], 'largura por net (e a prioridade renumerada)');
eq(por(D, 'Width').porCamada, { Mid1:{ min:0.254 } }, 'tabela por camada: só o que o Altium gravou');
eq([por(D, 'RoutingVias').min, por(D, 'RoutingVias').holeMax], [1.27, 0.7112], 'via');
eq(por(D, 'SilkToSolderMaskClearance').enabled, false, 'desligada atravessa desligada');
eq(por(D, 'Height').altium, { MINHEIGHT:'0mil', MAXHEIGHT:'1000mil' }, 'tipo que o hub não modela: crus, sem os campos de objeto');
eq(D.classes.net, { POWER:['5V', '0V'] }, 'classes (superclasse fica de fora: é embutida)');
eq(D.verificar, { lote:['Clearance', 'ShortCircuit', 'UnRoutedNet', 'MinimumSolderMaskSliver'], online:['Clearance', 'ComponentClearance'] }, 'Rules To Check');

/* ============================== rules.js: ida e volta ============================== */
const txt = R.serializa(D);
ok(/^\/\/ /.test(txt) && /var pcbrules = \{/.test(txt), 'cabeçalho do rules.js');
ok(txt.split('\n').filter(l => l.startsWith('{"name"')).length === D.rules.length, 'uma regra por linha');
const D2 = R.ler(txt);
eq(JSON.stringify(D2.rules), JSON.stringify(R.normaliza(D).rules), 'ida e volta das regras');
eq(D2.verificar, D.verificar, 'ida e volta do Rules To Check');
eq(D2.classes, D.classes, 'ida e volta das classes');
/* o rules.js que o pcbdoc2board --regras grava (crus em "altium") */
const doPy = 'var pcbrules = {\n"format":"pcbrules-v1",\n"origem":"Rules6 de X.PcbDoc",\n"altium":[\n' + cru.map(c => JSON.stringify(c)).join(',\n') +
             '\n],\n"classes":[\n' + classes.map(c => JSON.stringify(c)).join(',\n') + '\n],\n"drc":{"RULESETTOCHECK":"0,15,16,53","ONLINERULESETTOCHECK":"0,24"}\n};\n';
const D3 = R.ler(doPy);
eq(D3.origem, 'Rules6 de X.PcbDoc', 'origem do PcbDoc');
eq(JSON.stringify(D3.rules), JSON.stringify(D.rules), 'o cru do Python traduz igual');
eq(D3.verificar, D.verificar, 'Rules To Check do Python');
assert.throws(() => R.ler('var pcbrules = ;'), /rules\.js/, 'rules.js quebrado');

/* ============================== board.js ============================== */
const B = { rules:{ clearance:0.2, width:0.5, viaSize:0.6, viaDrill:0.3, sm:0.05, pm:0 } };
const DB = R.doBoard(B);
eq([por(DB, 'Clearance').gap, por(DB, 'Width').pref, por(DB, 'RoutingVias').pref, por(DB, 'RoutingVias').holePref, por(DB, 'SolderMaskExpansion').expansion],
   [0.2, 0.5, 0.6, 0.3, 0.05], 'board.rules por cima da casa');
ok(/board\.rules/.test(DB.origem), 'origem diz board.rules');
eq(R.doBoard({}).rules.length, C.rules.length, 'espelho antigo: a casa');
eq(R.doBoard(B, R.padroesAltium()).rules.find(r => r.kind === 'Width').max, 0.5, 'base de fábrica: a largura máxima cresce até a do espelho');

/* novaRegra: nome livre e os campos do tipo */
const nv = R.novaRegra(C, 'Clearance');
eq([nv.name, nv.gap, nv.netscope], ['Clearance_1', 0.254, 'DifferentNets'], 'nova regra');

/* descritores da placa */
const ds = R.descritores({ components:[{ id:'c1', ref:'U1', footprint:'SOIC', layer:'Top', pads:[{ id:'c1p1', name:'1', layer:'Top', type:'smd', net:'GND' }] }],
                           vias:[{ id:'v1', net:'GND' }], tracks:[{ id:'t1', layer:'Top', net:'GND' }, { id:'s1', layer:'TopOverlay' }] });
eq(ds.map(d => d.tipo + ':' + d.id), ['comp:c1', 'pad:c1p1', 'via:v1', 'track:t1'], 'descritores');
eq(ds[1].pad, 'U1-1', 'pad para InPadClass');

console.log('test-pcbregras OK (' + n + ' asserções)');
