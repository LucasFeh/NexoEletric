/* O DRC (hub-pcbdrc.js), provado sem navegador: as contas de distância, cada checagem numa placa
   montada aqui com a resposta conhecida de antemão, o DRC online (ids), o "Rules To Check" e uma
   rodada de desempenho em todo Projects/<p>/board.js que existir (meta: < 2 s cada, em Node).

   A conferência contra o Altium de verdade foi feita à parte (2026-10-13): os 12 PcbDoc do acervo
   que a rede deixou ler, convertidos pelo pcbdoc2board com --regras, deram 0 violação no lote em
   10 deles — o mesmo "Violations Detected : 0" dos relatórios .drc do Altium guardados ao lado.
   Os outros dois: PRJ-UR (35 regras de largura por net importadas DEPOIS do último .drc) e o
   template LM555 (1 sliver, sem .drc para comparar). */
const assert = require('assert');
const fs = require('fs'), path = require('path');
const D = require('../hub-pcbdrc.js');
const R = require('../hub-pcbregras.js');
const G = D.geo;

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const perto = (a, b, m, t) => { assert.ok(Math.abs(a - b) <= (t || 1e-9), m + ': ' + a + ' != ' + b); n++; };

/* ============================== geometria ============================== */
perto(G.dPrim(G.primSeg(0, 0, 10, 0, 0.1), G.primSeg(0, 1, 10, 1, 0.1)), 0.8, 'trilhas paralelas');
perto(G.dPrim(G.primSeg(0, 0, 10, 0, 0.1), G.primSeg(5, -5, 5, 5, 0.1)), -0.2, 'trilhas que cruzam: sobreposição');
perto(G.dPrim(G.primPonto(0, 0, 0.5), G.primPonto(3, 4, 0.5)), 4, 'vias');
perto(G.dPrim(G.primArco(0, 0, 5, 0, 90, 0.1), G.primPonto(0, 0, 1)), 3.9, 'arco ao centro');
perto(G.dPrim(G.primArco(0, 0, 5, 0, 90, 0), G.primPonto(-5, 0, 0)), Math.hypot(5, 5), 'ponto fora da varredura: a ponta');
perto(G.dPrim(G.primArco(0, 0, 5, 0, 90, 0), G.primSeg(6, -10, 6, 10, 0)), 1, 'arco x segmento');
perto(G.dPrim(G.primArco(0, 0, 5, 0, 360, 0), G.primArco(0, 0, 7, 0, 360, 0)), 2, 'círculos concêntricos');
perto(G.dPrim(G.primArco(0, 0, 5, 0, 180, 0), G.primArco(20, 0, 5, 0, 360, 0)), 10, 'arco x círculo');
/* caixa girada: o pad 2x1 a 45° e um ponto no eixo */
const cx = G.primCaixa(0, 0, 1, 0.5, 0, 45);
perto(G.dPrim(cx, G.primPonto(3, 3, 0)), Math.hypot(3, 3) - 1, 'caixa girada: pelo eixo comprido', 1e-9);
perto(G.dPrim(G.primCaixa(0, 0, 1, 1, 0, 0), G.primCaixa(3, 0, 1, 1, 0, 0)), 1, 'caixas lado a lado');
perto(G.dPrim(G.primCaixa(0, 0, 1, 1, 0, 0), G.primCaixa(3, 3, 1, 1, 0, 0)), Math.SQRT2, 'caixas no canto');
perto(G.dPrim(G.primCaixa(0, 0, 1, 1, 0.5, 0), G.primCaixa(3, 3, 1, 1, 0.5, 0)), Math.hypot(2, 2) - 1, 'roundrect no canto');
/* área com furo: o ponto no furo está fora do cobre */
const anel = G.primArea([[[0, 0], [10, 0], [10, 10], [0, 10]]], [[[4, 4], [6, 4], [6, 6], [4, 6]]]);
ok(G.dentro(anel, 1, 1) && !G.dentro(anel, 5, 5) && !G.dentro(anel, 11, 5), 'dentro da área');
perto(G.dPrim(anel, G.primPonto(5, 5, 0.5)), 0.5, 'via no meio do furo da área');
perto(G.dPrim(anel, G.primPonto(12, 5, 0.5)), 1.5, 'via fora da área');
ok(G.dPrim(anel, G.primPonto(2, 2, 0.1)) < 0, 'via dentro do cobre da área: sobreposição');
perto(G.dPrim(G.primPad({ x:0, y:0, w:1, h:1, shape:'rect' }, false, 0.1), G.primPonto(2, 0, 0)), 1.4, 'pad com expansão de máscara');

/* ============================== uma placa de teste ============================== */
/* 20 x 20 mm; tudo em mm. Cada caso põe só o que precisa. */
const placa = extra => Object.assign({
  board:{ bbox:{ x1:0, y1:0, x2:20, y2:20 }, outline:[
    { kind:'line', x1:0, y1:0, x2:20, y2:0 }, { kind:'line', x1:20, y1:0, x2:20, y2:20 },
    { kind:'line', x1:20, y1:20, x2:0, y2:20 }, { kind:'line', x1:0, y1:20, x2:0, y2:0 }] },
  nets:['A', 'B'], components:[], freepads:[], tracks:[], arcs:[], vias:[], texts:[], silk:[], lines:[], fills:[], regions:[], cutouts:[],
}, extra);
const trk = (id, x1, y1, x2, y2, w, net, layer) => ({ id, layer:layer || 'Top', x1, y1, x2, y2, w, net:net || '' });
const pad = (id, x, y, net, o) => Object.assign({ id, name:id, layer:'Top', type:'smd', shape:'rect', x, y, w:1, h:1, rot:0, net }, o || {});
const comp = (id, ref, x, y, pads, layer) => ({ id, ref, footprint:'FP', comment:'', layer:layer || 'Top', x, y, rot:0,
  bbox:{ x1:x - 1, y1:y - 1, x2:x + 1, y2:y + 1 }, pads });
const S = R.padroes();
const roda = (eb, o, regras) => D.rodar(eb, regras || S, Object.assign({ tipos:Object.keys(R.TIPOS) }, o || {}));
const so = (res, k) => res.violacoes.filter(v => v.tipo === k);

/* folga: duas trilhas de nets diferentes, a 0,2 mm de borda a borda (regra 0,254) */
let r = roda(placa({ tracks:[trk('t1', 2, 5, 18, 5, 0.3, 'A'), trk('t2', 2, 5.5, 18, 5.5, 0.3, 'B')] }), { tipos:['Clearance'] });
eq(so(r, 'Clearance').length, 1, 'folga de 0,2 < 0,254');
perto(so(r, 'Clearance')[0].valor, 0.2, 'o valor medido', 1e-9);
eq(so(r, 'Clearance')[0].limite, 0.254, 'o limite');
eq(so(r, 'Clearance')[0].ids.sort(), ['t1', 't2'], 'os dois objetos');
ok(/Clearance Constraint: \(0\.2mm < 0\.254mm\) Between Track/.test(so(r, 'Clearance')[0].msg), 'mensagem no molde do Altium');
ok(Math.abs(so(r, 'Clearance')[0].y - 5.25) < 0.2, 'marcador entre as duas');
/* encostar exatamente na folga não é violação; nem a menos de 1 µm (arredondamento do board.js) */
r = roda(placa({ tracks:[trk('t1', 2, 5, 18, 5, 0.3, 'A'), trk('t2', 2, 5.554, 18, 5.554, 0.3, 'B')] }), { tipos:['Clearance'] });
eq(r.total, 0, 'exatamente na folga');
r = roda(placa({ tracks:[trk('t1', 2, 5, 18, 5, 0.3, 'A'), trk('t2', 2, 5.5535, 18, 5.5535, 0.3, 'B')] }), { tipos:['Clearance'] });
eq(r.total, 0, 'meio micro a menos: arredondamento, não violação');
/* mesma net não confere folga; sem net contra sem net também não */
eq(roda(placa({ tracks:[trk('t1', 2, 5, 18, 5, 0.3, 'A'), trk('t2', 2, 5.4, 18, 5.4, 0.3, 'A')] }), { tipos:['Clearance'] }).total, 0, 'mesma net');
eq(roda(placa({ tracks:[trk('t1', 2, 5, 18, 5, 0.3, ''), trk('t2', 2, 5.4, 18, 5.4, 0.3, '')] }), { tipos:['Clearance'] }).total, 0, 'sem net x sem net');
eq(roda(placa({ tracks:[trk('t1', 2, 5, 18, 5, 0.3, 'A'), trk('t2', 2, 5.4, 18, 5.4, 0.3, '')] }), { tipos:['Clearance'] }).total, 1, 'net x sem net confere');
/* camadas diferentes não se conferem */
eq(roda(placa({ tracks:[trk('t1', 2, 5, 18, 5, 0.3, 'A'), trk('t2', 2, 5.4, 18, 5.4, 0.3, 'B', 'Bottom')] }), { tipos:['Clearance'] }).total, 0, 'Top x Bottom');
/* a via passante encontra a trilha de baixo */
r = roda(placa({ vias:[{ id:'v1', x:10, y:10, size:0.6, drill:0.3, from:'Top', to:'Bottom', net:'A' }], tracks:[trk('t1', 2, 10.5, 18, 10.5, 0.3, 'B', 'Bottom')] }), { tipos:['Clearance'] });
eq(r.total, 1, 'via x trilha no Bottom');
eq(so(r, 'Clearance')[0].layer, 'Bottom', 'na camada da trilha');
/* matriz de objetos: Track-Via a 0,1 deixa passar o mesmo par */
const SM = R.normaliza(JSON.parse(JSON.stringify(S)));
SM.rules.find(x => x.kind === 'Clearance').matrix['Track-Via'] = 0.1;
eq(roda(placa({ vias:[{ id:'v1', x:10, y:10, size:0.6, drill:0.3, net:'A' }], tracks:[trk('t1', 2, 10.6, 18, 10.6, 0.3, 'B', 'Bottom')] }), { tipos:['Clearance'] }, SM).total, 0, 'matriz Track-Via: 0,15 passa na de 0,1');
eq(roda(placa({ vias:[{ id:'v1', x:10, y:10, size:0.6, drill:0.3, net:'A' }], tracks:[trk('t1', 2, 10.6, 18, 10.6, 0.3, 'B', 'Bottom')] }), { tipos:['Clearance'] }).total, 1, 'e não passa na geral de 0,254');
/* regra por net: InNet('A') pede 1 mm e vence a geral */
const SN = R.normaliza(JSON.parse(JSON.stringify(S)));
SN.rules.push({ name:'Alta', kind:'Clearance', enabled:true, priority:0, scope1:"InNet('A')", scope2:'All', gap:1, netscope:'DifferentNets', layerkind:'SameLayer' });
r = roda(placa({ tracks:[trk('t1', 2, 5, 18, 5, 0.3, 'A'), trk('t2', 2, 5.8, 18, 5.8, 0.3, 'B')] }), { tipos:['Clearance'] }, SN);
eq([r.total, r.violacoes[0].regra, r.violacoes[0].limite], [1, 'Alta', 1], 'a regra da net vence');

/* curto: duas nets que se tocam */
r = roda(placa({ tracks:[trk('t1', 2, 5, 18, 5, 0.3, 'A'), trk('t2', 10, 2, 10, 18, 0.3, 'B')] }), { tipos:['ShortCircuit', 'Clearance'] });
eq(so(r, 'ShortCircuit').length, 1, 'curto');
eq(so(r, 'Clearance').length, 1, 'e a folga também, como o Altium');

/* largura */
r = roda(placa({ tracks:[trk('t1', 2, 5, 18, 5, 0.1, 'A'), trk('t2', 2, 9, 18, 9, 3.5, 'B'), trk('t3', 2, 14, 18, 14, 0.5, 'B')] }), { tipos:['Width'] });
eq(so(r, 'Width').map(v => v.ids[0]).sort(), ['t1', 't2'], 'fina demais e grossa demais (casa: 0,127..3 mm)');
/* a tabela por camada */
const SW = R.normaliza(JSON.parse(JSON.stringify(S)));
SW.rules.find(x => x.kind === 'Width').porCamada = { Mid1:{ min:0.4 } };
r = roda(placa({ tracks:[trk('t1', 2, 5, 18, 5, 0.3, 'A', 'Mid1'), trk('t2', 2, 9, 18, 9, 0.3, 'A')] }), { tipos:['Width'] }, SW);
eq(r.violacoes.map(v => v.ids[0]), ['t1'], 'largura mínima só na Mid1');
/* camada de roteamento proibida */
const SL = R.normaliza(JSON.parse(JSON.stringify(S)));
SL.rules.find(x => x.kind === 'RoutingLayers').layers.Bottom = false;
eq(roda(placa({ tracks:[trk('t1', 2, 5, 18, 5, 0.3, 'A', 'Bottom')] }), { tipos:['RoutingLayers'] }, SL).total, 1, 'camada proibida');

/* via, furo e furo a furo */
r = roda(placa({ vias:[{ id:'v1', x:5, y:5, size:4, drill:0.3, net:'A' }, { id:'v2', x:10, y:5, size:0.6, drill:0.05, net:'A' }] }), { tipos:['RoutingVias', 'HoleSize'] });
eq(so(r, 'RoutingVias').map(v => v.ids[0]).sort(), ['v1', 'v2'], 'via fora da faixa (diâmetro e furo)');
eq(so(r, 'HoleSize').length, 0, 'furo de 0,05 passa no HoleSize da casa (mín. 1 mil)');
r = roda(placa({ components:[comp('c1', 'J1', 10, 10, [pad('c1p1', 10, 10, 'A', { layer:'Multi', type:'th', shape:'circle', w:7, h:7, drill:6 })])] }), { tipos:['HoleSize'] });
eq(so(r, 'HoleSize').length, 1, 'furo de 6 mm > 5 mm');
r = roda(placa({ vias:[{ id:'v1', x:5, y:5, size:0.6, drill:0.3, net:'A' }, { id:'v2', x:5.5, y:5, size:0.6, drill:0.3, net:'A' }] }), { tipos:['HoleToHoleClearance'] });
eq(r.total, 1, 'furo a furo: 0,2 < 0,254');
perto(r.violacoes[0].valor, 0.2, 'folga entre os furos', 1e-9);
/* slot: a menor e a maior medida */
r = roda(placa({ components:[comp('c1', 'J1', 10, 10, [pad('c1p1', 10, 10, 'A', { layer:'Multi', type:'th', shape:'oval', w:7, h:2, drill:1, drillw:6, drillshape:'slot' })])] }), { tipos:['HoleSize'] });
eq(r.total, 1, 'slot de 6 mm > 5 mm');

/* máscara: dois pads a 0,3 mm de borda; com 0,1016 de expansão de cada lado a ponte fica com 0,0968 */
const doisPads = d => placa({ components:[comp('c1', 'U1', 10, 10, [pad('c1p1', 10, 10, 'A'), pad('c1p2', 10 + 1 + d, 10, 'B')])] });
r = roda(doisPads(0.3), { tipos:['MinimumSolderMaskSliver'] });
eq(r.total, 1, 'ponte de máscara fina');
perto(r.violacoes[0].valor, 0.3 - 2 * 0.1016, 'a ponte medida', 1e-9);
eq(roda(doisPads(0.15), { tipos:['MinimumSolderMaskSliver'] }).total, 0, 'aberturas que se fundem: sem ponte, sem violação');
eq(roda(doisPads(1), { tipos:['MinimumSolderMaskSliver'] }).total, 0, 'ponte larga');
/* o sm do pad (espelho novo) manda sobre a regra */
r = roda(placa({ components:[comp('c1', 'U1', 10, 10, [pad('c1p1', 10, 10, 'A', { sm:0 }), pad('c1p2', 11.3, 10, 'B', { sm:0 })])] }), { tipos:['MinimumSolderMaskSliver'] });
eq(r.total, 0, 'sm 0 por pad: a ponte é de 0,3 e passa');
/* via tampada não abre a máscara */
r = roda(placa({ vias:[{ id:'v1', x:5, y:5, size:0.6, drill:0.3, net:'A', tentTop:true, tentBot:true }, { id:'v2', x:5.9, y:5, size:0.6, drill:0.3, net:'B', tentTop:true, tentBot:true }] }), { tipos:['MinimumSolderMaskSliver'] });
eq(r.total, 0, 'vias tampadas');

/* silk sobre a máscara (até o cobre exposto) e silk-silk */
const silk = (id, x1, y1, x2, y2, owner) => ({ id, layer:'TopOverlay', kind:'line', x1, y1, x2, y2, w:0.15, owner });
r = roda(placa({ components:[comp('c1', 'U1', 10, 10, [pad('c1p1', 10, 10, 'A')])], silk:[silk('s1', 9, 10.6, 11, 10.6, 'U1'), silk('s2', 2, 2, 4, 2)] }), { tipos:['SilkToSolderMaskClearance'] });
eq(r.violacoes.map(v => v.ids.slice().sort()), [['c1p1', 's1']], 'silk a 0,025 do pad');
const textoGeo = t => ({ tracos:[[[t.x - 1, t.y], [t.x + 1, t.y]]], w:0.15 });
r = roda(placa({ silk:[silk('s1', 2, 5, 8, 5, 'R1'), silk('s2', 2, 5.2, 8, 5.2, 'R1'), silk('s3', 2, 8, 8, 8, 'R1'), silk('s4', 2, 8.2, 8, 8.2, 'R2')],
                 texts:[{ id:'x1', layer:'TopOverlay', x:5, y:5.25, text:'R1', h:1, rot:0, owner:'R1', designator:true }] }), { tipos:['SilkToSilkClearance'], textoGeo });
eq(r.violacoes.map(v => v.ids.slice().sort().join('+')).sort(), ['s1+x1', 's2+x1', 's3+s4'], 'silk-silk: texto contra tudo, e componentes diferentes; o contorno do mesmo footprint não');
r = roda(placa({ texts:[{ id:'x1', layer:'TopOverlay', x:5, y:5, text:'R1', h:1 }] }), { tipos:['SilkToSilkClearance'] });
ok(r.avisos.some(a => /textoGeo/.test(a)), 'sem textoGeo: aviso, não silêncio');

/* folga ao contorno e ao recorte */
const SB = R.normaliza(JSON.parse(JSON.stringify(S)));
SB.rules.find(x => x.kind === 'BoardOutlineClearance').gap = 0.3;
r = roda(placa({ tracks:[trk('t1', 0.2, 5, 0.2, 15, 0.2, 'A'), trk('t2', 25, 5, 30, 5, 0.2, 'A'), trk('t3', 10, 5, 10, 15, 0.2, 'A')],
                 cutouts:[{ id:'k1', layer:'Multi', points:[[9.5, 9], [11, 9], [11, 11], [9.5, 11]] }] }), { tipos:['BoardOutlineClearance'] }, SB);
eq(r.violacoes.map(v => v.ids.join('+')).sort(), ['t1', 't2', 't3+k1'], 'perto da borda, fora da placa e no recorte');
/* o recorte do tamanho da placa é a forma dela, não furo (a regra do HubLaser.boardCutouts) */
r = roda(placa({ tracks:[trk('t3', 10, 5, 10, 15, 0.2, 'A')], cutouts:[{ id:'k0', layer:'Multi', points:[[0, 0], [20, 0], [20, 20], [0, 20]] }] }), { tipos:['BoardOutlineClearance'] });
eq(r.total, 0, 'recorte = placa inteira não conta');

/* componente a componente */
r = roda(placa({ components:[comp('c1', 'U1', 5, 5, []), comp('c2', 'U2', 7.1, 5, []), comp('c3', 'U3', 7.1, 5, [], 'Bottom')] }), { tipos:['ComponentClearance'] });
eq(r.violacoes.map(v => v.ids.join('+')), ['c1+c2'], 'caixas a 0,1 mm no mesmo lado; o de baixo não');

/* conectividade: net não roteada, via ligando as camadas, antena e pino sem ligação */
const P2 = (extra) => placa(Object.assign({ components:[comp('c1', 'R1', 5, 10, [pad('c1p1', 4, 10, 'A'), pad('c1p2', 6, 10, 'B')]),
                                                       comp('c2', 'R2', 15, 10, [pad('c2p1', 14, 10, 'A'), pad('c2p2', 16, 10, 'C')])] }, extra));
r = roda(P2(), { tipos:['UnRoutedNet'] });
eq(r.violacoes.map(v => v.net), ['A'], 'net A sem ligação');
ok(/^Un-Routed Net Constraint: Net A Between Pad R[12]-\S+ And Pad R[12]-/.test(r.violacoes[0].msg), 'mensagem do Altium');
eq([r.violacoes[0].x1, r.violacoes[0].x2].sort((a, b) => a - b), [4, 14], 'a linha que falta');
eq(roda(P2({ tracks:[trk('t1', 4, 10, 4, 14, 0.3, 'A'), trk('t2', 4, 14, 14, 14, 0.3, 'A'), trk('t3', 14, 14, 14, 10, 0.3, 'A')] }), { tipos:['UnRoutedNet'] }).total, 0, 'roteada');
/* pelo Bottom, descendo e subindo por via */
r = roda(P2({ tracks:[trk('t1', 4, 10, 4, 14, 0.3, 'A'), trk('t2', 4, 14, 14, 14, 0.3, 'A', 'Bottom'), trk('t3', 14, 14, 14, 10, 0.3, 'A')],
              vias:[{ id:'v1', x:4, y:14, size:0.6, drill:0.3, net:'A' }] }), { tipos:['UnRoutedNet'] });
eq(r.total, 1, 'falta a segunda via');
r = roda(P2({ tracks:[trk('t1', 4, 10, 4, 14, 0.3, 'A'), trk('t2', 4, 14, 14, 14, 0.3, 'A', 'Bottom'), trk('t3', 14, 14, 14, 10, 0.3, 'A')],
              vias:[{ id:'v1', x:4, y:14, size:0.6, drill:0.3, net:'A' }, { id:'v2', x:14, y:14, size:0.6, drill:0.3, net:'A' }] }), { tipos:['UnRoutedNet', 'NetAntennae'] });
eq(r.total, 0, 'roteada por baixo, sem antena');
/* antena: a trilha que sai do pad e não chega */
r = roda(P2({ tracks:[trk('t1', 4, 10, 4, 14, 0.3, 'A')] }), { tipos:['NetAntennae'] });
eq(r.violacoes.map(v => [v.ids[0], v.x, v.y]), [['t1', 4, 14]], 'a ponta solta');
/* T: a ponta que pousa no meio de outra trilha está ligada */
eq(roda(P2({ tracks:[trk('t1', 4, 10, 4, 14, 0.3, 'A'), trk('t2', 2, 14, 6, 14, 0.3, 'A'), trk('t3', 2, 14, 2, 10, 0.3, 'A'), trk('t4', 6, 14, 6, 12, 0.3, 'A')] }), { tipos:['NetAntennae'] })
   .violacoes.map(v => v.ids[0]).sort(), ['t3', 't4'], 'T ligado: as pontas soltas são só as de t3 (2,10) e t4 (6,12)');
/* pino sem ligação (com a regra, que não vem de fábrica) */
const SU = R.normaliza(JSON.parse(JSON.stringify(S)));
SU.rules.push({ name:'UnConnectedPin', kind:'UnConnectedPin', enabled:true, priority:1, scope1:'All', scope2:'All' });
r = roda(P2({ tracks:[trk('t1', 4, 10, 4, 14, 0.3, 'A')] }), { tipos:['UnConnectedPin'] }, SU);
eq(r.violacoes.map(v => v.ids[0]).sort(), ['c1p2', 'c2p1', 'c2p2'], 'pinos que não tocam nada');

/* ============================== online e Rules To Check ============================== */
const eb = placa({ tracks:[trk('t1', 2, 5, 18, 5, 0.3, 'A'), trk('t2', 2, 5.5, 18, 5.5, 0.3, 'B'), trk('t3', 2, 12, 18, 12, 0.3, 'A'), trk('t4', 2, 12.5, 18, 12.5, 0.3, 'B')] });
eq(D.rodar(eb, S, { tipos:['Clearance'] }).total, 2, 'placa inteira: 2');
eq(D.rodar(eb, S, { tipos:['Clearance'], ids:['t3'] }).violacoes.map(v => v.ids.sort().join('+')), ['t3+t4'], 'online: só o que envolve t3');
eq(D.rodar(placa({ components:[comp('c1', 'U1', 5, 5, []), comp('c2', 'U2', 7.1, 5, [])] }), S).total, 0, 'lote da casa: sem componente-componente');
eq(D.rodar(placa({ components:[comp('c1', 'U1', 5, 5, []), comp('c2', 'U2', 7.1, 5, [])] }), S, { ids:['U2'] }).total, 1, 'online da casa: com componente-componente, pelo designator');
/* regra desligada não confere */
const SD = R.normaliza(JSON.parse(JSON.stringify(S)));
SD.rules.find(x => x.kind === 'Clearance').enabled = false;
eq(D.rodar(eb, SD, { tipos:['Clearance'] }).total, 0, 'regra desligada');
/* a mesma via contra o mesmo pad passante aparece uma vez só (e não uma por camada) */
r = roda(placa({ layers:[{ key:'Mid1' }], vias:[{ id:'v1', x:5, y:5, size:0.6, drill:0.3, net:'A' }],
                 components:[comp('c1', 'J1', 5.6, 5, [pad('c1p1', 5.6, 5, 'B', { layer:'Multi', type:'th', shape:'circle', w:0.6, h:0.6, drill:0.3 })])] }), { tipos:['Clearance'] });
eq(r.total, 1, 'Multi x Multi: uma violação');
eq(r.violacoes[0].layer, 'Multi', 'na Multi-Layer');
/* teto por regra */
const muitas = { tracks:[] };
for (let i = 0; i < 30; i++) muitas.tracks.push(trk('t' + i, 1, 0.5 + i * 0.5, 19, 0.5 + i * 0.5, 0.3, i % 2 ? 'A' : 'B'));
r = D.rodar(placa(muitas), S, { tipos:['Clearance'], max:10 });
eq([r.violacoes.length, r.porRegra[0].n, r.porRegra[0].cortadas], [10, 29, 19], 'teto: lista cortada, contagem inteira');

/* o relatório */
const txt = D.relatorioTexto(r, { arquivo:'placa.PcbDoc', data:'13/10/2026' });
ok(/Design Rule Verification Report/.test(txt) && /Processing Rule : Clearance Constraint \(Gap=0\.254mm\) \(All\),\(All\)/.test(txt) &&
   /Rule Violations :29/.test(txt) && !/Width Constraint/.test(txt), 'relatório .txt no molde do Altium (só o que foi conferido)');
eq(D.descRegra({ kind:'Width', min:0.254, max:1, pref:0.5, scope1:'All' }), 'Width Constraint (Min=0.254mm) (Max=1mm) (Preferred=0.5mm) (All)', 'a linha do .drc do Altium');
const html = D.relatorioHtml(r, { arquivo:'<placa>' });
ok(/<table>/.test(html) && /&lt;placa&gt;/.test(html) && !/<placa>/.test(html), 'relatório .html escapado');

/* ============================== as placas reais (desempenho) ============================== */
const raiz = path.join(__dirname, '..', 'Projects');
let HC = null, HG = null;
try { HC = require('../hub-core.js'); HG = require('../hub-gerber.js'); } catch (e) { HC = null; }
const linhas = [];
if (HC && fs.existsSync(raiz)) {
  const carrega = (f, nome) => new Function(fs.readFileSync(f, 'utf8') + ';return typeof ' + nome + ' !== "undefined" ? ' + nome + ' : null;')();
  let pior = 0;
  for (const p of fs.readdirSync(raiz)) {
    const fb = path.join(raiz, p, 'board.js');
    if (!fs.existsSync(fb)) continue;
    const B = carrega(fb, 'pcbmirror');
    if (!B) continue;
    const fc = path.join(raiz, p, 'changes.js');
    let ch = [];
    try { if (fs.existsSync(fc)) ch = carrega(fc, 'changes') || []; } catch (e) { ch = []; }
    let model;
    try { model = HC.applyPcbChanges(B, ch); } catch (e) { model = HC.applyPcbChanges(B, []); }
    const E = HC.effectiveBoard(B, model);
    const fr = path.join(raiz, p, 'rules.js');
    const regras = fs.existsSync(fr) ? R.ler(fs.readFileSync(fr, 'utf8')) : R.doBoard(E);
    const res = D.rodar(E, regras, { textoGeo: t => HG.geometriaTexto(t), tipos:Object.keys(R.TIPOS) });
    const lote = D.rodar(E, regras, { textoGeo: t => HG.geometriaTexto(t) });
    pior = Math.max(pior, res.tempoMs);
    ok(res.tempoMs < 2000, p + ': DRC completo < 2 s (' + res.tempoMs + ' ms)');
    for (const v of res.violacoes) ok(isFinite(v.x) && isFinite(v.y) && v.ids.length && v.msg, p + ': violação bem formada');
    linhas.push(p.slice(0, 34).padEnd(35) + String(res.tempoMs).padStart(5) + ' ms  todas ' + String(res.total).padStart(4) + '  lote ' + String(lote.total).padStart(3) +
                '  ' + lote.porRegra.map(c => c.tipo + ':' + c.n).join(' '));
  }
  console.log('  ' + linhas.join('\n  '));
  console.log('  pior tempo: ' + pior + ' ms');
}

console.log('test-pcbdrc OK (' + n + ' asserções)');
