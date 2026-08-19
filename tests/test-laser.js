const assert = require('assert');
const Laser = require('../hub-laser.js');

const approx = (a, b, t) => Math.abs(a - b) <= (t || 1e-6);
const ringArea = r => {                       /* area com sinal (shoelace) */
  let s = 0;
  for (let i = 0; i < r.length - 1; i++) s += r[i][0]*r[i+1][1] - r[i+1][0]*r[i][1];
  return s / 2;
};

/* Placa de teste: quadrado de 20x20 mm com origem em (0,0). */
const OUTLINE = [
  { kind:'line', x1:0,  y1:0,  x2:20, y2:0  },
  { kind:'line', x1:20, y1:0,  x2:20, y2:20 },
  { kind:'line', x1:20, y1:20, x2:0,  y2:20 },
  { kind:'line', x1:0,  y1:20, x2:0,  y2:0  },
];
const board = (over) => Object.assign({
  board: { bbox:{ x1:0, y1:0, x2:20, y2:20 }, outline: OUTLINE },
  components: [], freepads: [], tracks: [], arcs: [], vias: [], regions: [],
  silk: [], texts: [],
}, over);

/* ═══════════════ collect(): o que entra na arte ═══════════════ */

/* trilha entra no seu lado e some no outro */
const bTrk = board({ tracks:[ { id:'t1', layer:'Top', x1:2, y1:2, x2:8, y2:2, w:0.5 } ] });
assert.strictEqual(Laser.collect(bTrk, { side:'Top'    }).copper.length, 1);
assert.strictEqual(Laser.collect(bTrk, { side:'Bottom' }).copper.length, 0);

const trk = Laser.collect(bTrk, { side:'Top' }).copper[0];
assert.strictEqual(trk.k, 'path');
assert.strictEqual(trk.w, 0.5);
assert.deepStrictEqual(trk.pts, [[2,2],[8,2]]);

/* pad Multi (PTH) aparece nos DOIS lados; pad Top so no Top - mesmo criterio da Neoden */
const bPad = board({ components:[ { id:'c1', ref:'R1', layer:'Top', x:5, y:5, pads:[
  { id:'c1p1', layer:'Multi', shape:'circle', x:5, y:5, w:2, h:2, rot:0, drill:0.8 },
  { id:'c1p2', layer:'Top',   shape:'rect',   x:9, y:5, w:2, h:1, rot:0 },
] } ] });
assert.strictEqual(Laser.collect(bPad, { side:'Top'    }).copper.length, 2);
assert.strictEqual(Laser.collect(bPad, { side:'Bottom' }).copper.length, 1);
assert.strictEqual(Laser.collect(bPad, { side:'Bottom' }).copper[0].k, 'disc');

/* forma do pad -> primitiva */
const pads = Laser.collect(bPad, { side:'Top' }).copper;
assert.strictEqual(pads[0].k, 'disc');
assert.strictEqual(pads[0].r, 1);                       /* w/2 */
assert.strictEqual(pads[1].k, 'rect');
assert.strictEqual(pads[1].w, 2);
assert.strictEqual(pads[1].h, 1);

/* via atravessa: entra nos dois lados */
const bVia = board({ vias:[ { id:'v1', x:10, y:10, size:1.2, drill:0.6 } ] });
assert.strictEqual(Laser.collect(bVia, { side:'Top'    }).copper.length, 1);
assert.strictEqual(Laser.collect(bVia, { side:'Bottom' }).copper.length, 1);
assert.strictEqual(Laser.collect(bVia, { side:'Top' }).copper[0].r, 0.6);

/* o padrao e o furo REAL: uma marca de 0,3 mm num pad de 1,8 mm nao parece a placa */
assert.strictEqual(Laser.defaults().holes, 'drill');

/* furos: 'mark' subtrai o diametro da marca, 'drill' subtrai a broca real, 'none' nada */
const hMark  = Laser.collect(bPad, { side:'Top', holes:'mark',  markD:0.3 }).holes;
const hDrill = Laser.collect(bPad, { side:'Top', holes:'drill' }).holes;
const hNone  = Laser.collect(bPad, { side:'Top', holes:'none'  }).holes;
assert.strictEqual(hMark.length, 1);                    /* so o pad furado */
assert.strictEqual(hMark[0].r, 0.15);
assert.strictEqual(hDrill[0].r, 0.4);
assert.strictEqual(hNone.length, 0);

/* ── furo FIEL: drillshape/drillw/holerot, como o pcbframe.drawPad honra ──
   VDCB-DI251879 tem pad de furo retangular girado; tratar tudo como circulo erra a
   area em 27% naquele furo. */
const padFuro = (over) => board({ components:[ { id:'c1', ref:'J1', layer:'Top', x:5, y:5,
  pads:[ Object.assign({ id:'c1p1', layer:'Multi', type:'th', shape:'rect',
                         x:5, y:5, w:2.1, h:2.1, rot:0, drill:1.5 }, over) ] } ] });

/* furo retangular: drillw x drill, girado por holerot */
const hRect = Laser.collect(padFuro({ drillshape:'rect', drillw:1.2, holerot:90 }),
                            { side:'Top', holes:'drill' }).holes;
assert.strictEqual(hRect.length, 1);
assert.strictEqual(hRect[0].k, 'rect', 'furo retangular nao pode virar disco');
assert.strictEqual(hRect[0].w, 1.2);
assert.strictEqual(hRect[0].h, 1.5);
assert.strictEqual(hRect[0].rot, 90, 'holerot tem que ser respeitado');
assert.strictEqual(hRect[0].r, 0, 'furo rect tem canto vivo');

/* furo oblongo: retangulo de canta redonda, raio = menor/2 */
const hObl = Laser.collect(padFuro({ drillshape:'oblong', drillw:2.4, holerot:0 }),
                           { side:'Top', holes:'drill' }).holes;
assert.strictEqual(hObl[0].k, 'rect');
assert.strictEqual(hObl[0].r, 0.75, 'oblongo arredonda pelo menor lado / 2');

/* sem holerot, o furo herda a rotacao do PAD (regra do pcbframe) */
const hHerda = Laser.collect(padFuro({ drillshape:'rect', drillw:1.2, rot:35 }),
                             { side:'Top', holes:'drill' }).holes;
assert.strictEqual(hHerda[0].rot, 35, 'sem holerot o furo gira com o pad');

/* furo circular continua disco, e a marca de centro e sempre um disco */
assert.strictEqual(Laser.collect(padFuro({ drillshape:'circle' }), { side:'Top', holes:'drill' }).holes[0].k, 'disc');
const hMk = Laser.collect(padFuro({ drillshape:'rect', drillw:1.2, holerot:90 }),
                          { side:'Top', holes:'mark', markD:0.3 }).holes;
assert.strictEqual(hMk[0].k, 'disc', 'marca de centro e um ponto, nao a forma do furo');
assert.strictEqual(hMk[0].r, 0.15);

/* pad SMD nunca e furado, mesmo que venha com drill no board.js */
const hSmd = Laser.collect(board({ components:[ { id:'c1', ref:'R1', layer:'Top', x:5, y:5,
  pads:[ { id:'c1p1', layer:'Top', type:'smd', shape:'rect', x:5, y:5, w:2, h:1, rot:0, drill:0.8 } ] } ] }),
  { side:'Top', holes:'drill' }).holes;
assert.strictEqual(hSmd.length, 0, 'furo so em pad through-hole');

/* a area do furo retangular chega na arte */
const aFuroR = Laser.art(padFuro({ drillshape:'rect', drillw:1.2, holerot:90 }),
                         { side:'Top', res:0.01, holes:'drill' });
const buraco = aFuroR.copper.find(r => ringArea(r) < 0);
assert.ok(buraco, 'o furo retangular vira buraco no cobre');
assert.ok(approx(Math.abs(ringArea(buraco)), 1.2*1.5, 1.2*1.5*0.03),
          'area do furo retangular: ' + Math.abs(ringArea(buraco)) + ' (esperado 1.8)');

/* ── regioes e planos andam junto com trilhas e arcos, num toggle so ── */
const bReg = board({
  tracks:[ { id:'t1', layer:'Top', x1:2, y1:2, x2:8, y2:2, w:0.5 } ],
  regions:[ { id:'g1', layer:'Top', points:[[12,12],[16,12],[16,16],[12,16]] } ],
});
assert.strictEqual(Laser.collect(bReg, { side:'Top' }).copper.length, 2,
                   'por padrao trilha e regiao entram');
assert.strictEqual(Laser.collect(bReg, { side:'Top', show:{ tracks:false } }).copper.length, 0,
                   'desligar trilhas tem que levar as regioes junto');
assert.ok(!('regions' in Laser.defaults().show), 'nao existe mais toggle separado de regioes');

/* toggles desligam grupos inteiros */
assert.strictEqual(Laser.collect(bTrk, { side:'Top', show:{ tracks:false } }).copper.length, 0);
assert.strictEqual(Laser.collect(bVia, { side:'Top', show:{ vias:false   } }).copper.length, 0);

/* contorno vira polilinha FECHADA e encadeada, nao 4 segmentos soltos */
const oc = Laser.collect(board({}), { side:'Top' }).outline;
assert.strictEqual(oc.length, 1, 'os segmentos do contorno viram um laco so');
assert.strictEqual(oc[0].length, 5, 'quadrado fechado = 5 pontos');
assert.deepStrictEqual(oc[0][0], oc[0][4]);

/* ── contorno com canto em arco: placa real usa (SD-DI251838, VDCB-DI251879) ──
   Sem achatar o arco o laco nao fecha, e o negativo queimaria um retangulo no lugar
   da placa. */
const bArc = board({ board:{ bbox:{ x1:0, y1:0, x2:20, y2:20 }, outline:[
  { kind:'arc',  cx:2, cy:2, r:2, sa:180, ea:270 },       /* canto inferior esquerdo */
  { kind:'line', x1:2,  y1:0,  x2:20, y2:0  },
  { kind:'line', x1:20, y1:0,  x2:20, y2:20 },
  { kind:'line', x1:20, y1:20, x2:0,  y2:20 },
  { kind:'line', x1:0,  y1:20, x2:0,  y2:2  },
] } });
const oArc = Laser.collect(bArc, { side:'Top' }).outline;
assert.strictEqual(oArc.length, 1, 'o arco tem que encadear junto com as linhas');
assert.ok(approx(oArc[0][0][0], oArc[0][oArc[0].length-1][0], 1e-3) &&
          approx(oArc[0][0][1], oArc[0][oArc[0].length-1][1], 1e-3), 'o laco fecha');

/* e o negativo respeita o canto arredondado: area = 400 - (4 - pi) */
const aArc = Laser.art(bArc, { side:'Top', res:0.02, invert:true, margin:1 });
assert.strictEqual(aArc.warnings.length, 0, 'nao pode avisar falta de contorno: ' + aArc.warnings);
const areaArc = 400 - (4 - Math.PI);
assert.ok(approx(ringArea(aArc.copper[0]), areaArc, areaArc*0.005),
          'o negativo tem que seguir o canto em arco: ' + ringArea(aArc.copper[0]));

/* serigrafia segue o lado pelo sufixo Overlay */
const bSilk = board({ silk:[
  { id:'s1', layer:'TopOverlay',    kind:'line', x1:1, y1:9, x2:5, y2:9, w:0.2 },
  { id:'s2', layer:'BottomOverlay', kind:'line', x1:1, y1:7, x2:5, y2:7, w:0.2 },
] });
assert.strictEqual(Laser.collect(bSilk, { side:'Top',    show:{ silk:true } }).silk.length, 1);
assert.strictEqual(Laser.collect(bSilk, { side:'Bottom', show:{ silk:true } }).silk.length, 1);
assert.strictEqual(Laser.collect(bSilk, { side:'Top' }).silk.length, 0, 'silk desligada por padrao');

/* designator vira o ref do dono, como o pcbframe ja faz no canvas */
const bTxt = board({
  components:[ { id:'c1', ref:'R7', comment:'10k', layer:'Top', x:5, y:5, pads:[] } ],
  texts:[ { id:'x1', layer:'TopOverlay', x:5, y:5, text:'.Designator', h:1, rot:0,
            mirror:false, designator:true, owner:'R7' } ],
});
const txt = Laser.collect(bTxt, { side:'Top', show:{ silk:true, texts:true } });
assert.ok(txt.silk.length > 0, 'texto vira primitivas de serigrafia');
assert.strictEqual(txt.silk[0].k, 'path');

/* ═══════════════ union(): o cobre sai como UMA geometria ═══════════════
   O LightBurn nao grava a area comum de formas que se sobrepoem parcialmente na mesma
   camada de Fill. Se estes testes quebrarem, a arte volta a ter buraco em cada junção. */

const RES = { res:0.02 };

/* disco isolado: um anel, area = pi r^2 */
const d1 = Laser.union([{ k:'disc', x:5, y:5, r:2 }], [], RES);
assert.strictEqual(d1.length, 1);
assert.ok(approx(ringArea(d1[0]), Math.PI*4, Math.PI*4*0.015),
          'area do disco fora de 1,5%: ' + ringArea(d1[0]));
assert.ok(ringArea(d1[0]) > 0, 'anel externo e CCW (area positiva)');

/* o anel fecha e fica centrado onde a primitiva esta */
assert.deepStrictEqual(d1[0][0], d1[0][d1[0].length-1]);
const cx = d1[0].reduce((s,p) => s+p[0], 0) / d1[0].length;
assert.ok(approx(cx, 5, 0.05), 'centro em x = 5');

/* ── O TESTE QUE IMPORTA: duas capsulas cruzadas viram UM anel ── */
const cross = Laser.union([
  { k:'path', pts:[[2,10],[18,10]], w:1 },
  { k:'path', pts:[[10,2],[10,18]], w:1 },
], [], RES);
assert.strictEqual(cross.length, 1,
  'trilhas que se cruzam tem que virar um anel so - senao o LightBurn abre buraco na junção');
/* area = 2 capsulas (barra 16x1 + um disco de ponta cada) - a intersecao 1x1 */
const areaCruz = 2*(16*1 + Math.PI*0.25) - 1*1;
assert.ok(approx(ringArea(cross[0]), areaCruz, areaCruz*0.01),
          'area da cruz: ' + ringArea(cross[0]) + ' (exato ' + areaCruz + ')');

/* o erro e discretizacao de 1a ordem, nao viés: cai junto com res. Se este teste
   quebrar, alguma etapa passou a deslocar o contorno de forma independente da grade. */
const errDisco = res => Math.abs(ringArea(Laser.union([{ k:'disc', x:5, y:5, r:2 }], [], { res })[0])
                                 / (Math.PI*4) - 1);
assert.ok(errDisco(0.01) < errDisco(0.05) / 3, 'o erro tem que convergir com res');
assert.ok(errDisco(0.025) < 0.01, 'no res padrao o erro de area fica sob 1%');

/* ── O SEGUNDO TESTE QUE IMPORTA: orientacao nao pode cancelar ──
   1170 das 1232 regioes do repo sao HORARIAS (CW); capsula, disco e retangulo que eu gero
   sao ANTI-horarios. Com regra nonzero numa lista so, CW sobre CCW soma 0 e abre um buraco
   branco exatamente na junção trilha/pad. A uniao tem que ignorar o sentido do poligono. */
const regiaoCW = [[10,10],[10,14],[14,14],[14,10]];        /* area com sinal = -16 */
assert.ok(ringArea(regiaoCW.concat([regiaoCW[0]])) < 0, 'a fixture tem que ser mesmo horaria');

const mix = Laser.union([
  { k:'poly', pts:regiaoCW },                               /* regiao horaria */
  { k:'path', pts:[[8,12],[16,12]], w:1 },                  /* trilha atravessando */
], [], RES);
assert.strictEqual(mix.length, 1,
  'regiao horaria + trilha tem que dar UM anel cheio - sem buraco na junção');
/* 16 (quadrado) + 8.785 (capsula) - 4 (sobreposicao) */
const areaMix = 16 + (8*1 + Math.PI*0.25) - 4;
assert.ok(approx(ringArea(mix[0]), areaMix, areaMix*0.02),
          'area da uniao: ' + ringArea(mix[0]) + ' (exato ' + areaMix.toFixed(3) + ')');
assert.ok(mix.every(r => ringArea(r) > 0), 'nenhum buraco deve aparecer');

/* o mesmo desenho com a regiao anti-horaria da o mesmo resultado */
const mixCCW = Laser.union([
  { k:'poly', pts:regiaoCW.slice().reverse() },
  { k:'path', pts:[[8,12],[16,12]], w:1 },
], [], RES);
assert.strictEqual(mixCCW.length, 1);
assert.ok(approx(ringArea(mixCCW[0]), ringArea(mix[0]), 0.05),
          'o sentido do poligono nao pode mudar a arte');

/* duas formas separadas continuam dois aneis */
const sep = Laser.union([{ k:'disc', x:3, y:3, r:1 }, { k:'disc', x:12, y:12, r:1 }], [], RES);
assert.strictEqual(sep.length, 2);

/* ── furo: o pad com marca vira anel externo + buraco, com orientacao invertida ── */
const holed = Laser.union([{ k:'disc', x:5, y:5, r:1 }],
                          [{ k:'disc', x:5, y:5, r:0.15 }], RES);
assert.strictEqual(holed.length, 2, 'pad furado = anel externo + buraco');
const outer = holed.find(r => ringArea(r) > 0), inner = holed.find(r => ringArea(r) < 0);
assert.ok(outer && inner, 'o buraco tem orientacao invertida (area negativa)');
assert.ok(approx(Math.abs(ringArea(inner)), Math.PI*0.0225, Math.PI*0.0225*0.12),
          'area do buraco: ' + ringArea(inner));

/* ── expand: dilata por offset exato, area cresce ~ perimetro * expand ── */
const e0 = Laser.union([{ k:'disc', x:5, y:5, r:1 }], [], RES);
const e1 = Laser.union([{ k:'disc', x:5, y:5, r:1 }], [], Object.assign({ expand:0.2 }, RES));
assert.ok(approx(ringArea(e1[0]), Math.PI*1.44, Math.PI*1.44*0.02),
          'disco dilatado deve ter r = 1,2: ' + ringArea(e1[0]));
assert.ok(ringArea(e1[0]) > ringArea(e0[0]));

/* retangulo rotacionado 45 graus mantem a area */
const rr = Laser.union([{ k:'rect', cx:6, cy:6, w:4, h:2, rot:45, r:0 }], [], RES);
assert.ok(approx(ringArea(rr[0]), 8, 8*0.02), 'area do retangulo: ' + ringArea(rr[0]));

/* poligono cheio sai com a propria area */
const pg = Laser.union([{ k:'poly', pts:[[2,2],[6,2],[6,5],[2,5]] }], [], RES);
assert.ok(approx(ringArea(pg[0]), 12, 12*0.02), 'area do poligono: ' + ringArea(pg[0]));

/* ═══════════════ art(): pipeline completo ═══════════════ */

const bArt = board({ vias:[ { id:'v1', x:10, y:10, size:4, drill:0 } ] });   /* disco r=2 */
const aPos = Laser.art(bArt, { side:'Top', res:0.02, margin:2, holes:'none' });

/* positivo: o cobre e o cobre */
assert.strictEqual(aPos.copper.length, 1);
assert.ok(approx(ringArea(aPos.copper[0]), Math.PI*4, Math.PI*4*0.015));

/* a area util do arquivo e o bbox da placa + margem */
assert.deepStrictEqual(aPos.bbox, { x1:-2, y1:-2, x2:22, y2:22 });
assert.deepStrictEqual(aPos.size, { w:24, h:24 });

/* ── negativo: o fundo vira a peca e o cobre vira buraco ── */
const aNeg = Laser.art(bArt, { side:'Top', res:0.02, margin:2, holes:'none', invert:true });
assert.strictEqual(aNeg.copper.length, 2, 'negativo = contorno da placa + o cobre como buraco');
const nOut = aNeg.copper.find(r => ringArea(r) > 0), nIn = aNeg.copper.find(r => ringArea(r) < 0);
assert.ok(approx(ringArea(nOut), 400, 400*0.01), 'anel externo = a placa 20x20: ' + ringArea(nOut));
assert.ok(approx(Math.abs(ringArea(nIn)), Math.PI*4, Math.PI*4*0.02), 'o cobre virou buraco');

/* o negativo NAO invade a margem - o burn para no contorno da placa */
const xsNeg = nOut.map(p => p[0]);
assert.ok(Math.min(...xsNeg) > -0.1 && Math.max(...xsNeg) < 20.1,
          'o negativo tem que parar no contorno, nao na margem');

/* ── recorte: cobre que passa do contorno e cortado ── */
const bOver = board({ tracks:[ { id:'t1', layer:'Top', x1:10, y1:10, x2:40, y2:10, w:2 } ] });
const aOver = Laser.art(bOver, { side:'Top', res:0.02, margin:2 });
assert.ok(Math.max(...aOver.copper[0].map(p => p[0])) < 20.1,
          'a trilha tem que ser cortada no contorno da placa');

/* ── sem contorno no board.js: cai no bbox e avisa ── */
const bNoOut = board({ board:{ bbox:{ x1:0, y1:0, x2:20, y2:20 }, outline:[] },
                       vias:[ { id:'v1', x:10, y:10, size:4, drill:0 } ] });
const aNo = Laser.art(bNoOut, { side:'Top', res:0.05 });
assert.ok(aNo.warnings.some(w => /contorno/i.test(w)), 'tem que avisar que nao ha contorno');
assert.strictEqual(aNo.copper.length, 1);

/* ── serigrafia: 'line' devolve o eixo do traco; 'fill' devolve a largura real ── */
const bS = board({ silk:[ { id:'s1', layer:'TopOverlay', kind:'line',
                            x1:4, y1:10, x2:14, y2:10, w:0.3 } ] });
const sLine = Laser.art(bS, { side:'Top', res:0.02, show:{ silk:true }, silkMode:'line' });
assert.deepStrictEqual(sLine.silkLines, [[[4,10],[14,10]]]);
assert.strictEqual(sLine.silk, null);

const sFill = Laser.art(bS, { side:'Top', res:0.02, show:{ silk:true }, silkMode:'fill' });
assert.strictEqual(sFill.silkLines, null);
assert.strictEqual(sFill.silk.length, 1);
assert.ok(approx(ringArea(sFill.silk[0]), 10*0.3 + Math.PI*0.15*0.15, 0.05),
          'serigrafia em fill tem a largura real: ' + ringArea(sFill.silk[0]));

/* a serigrafia NAO entra na uniao do cobre */
assert.strictEqual(sFill.copper.length, 0);

/* ── res absurdo e limitado, com aviso, em vez de estourar a memoria ── */
const aBig = Laser.art(bArt, { side:'Top', res:0.00005 });
assert.ok(aBig.warnings.some(w => /resolu/i.test(w)), 'tem que avisar que baixou a resolucao');
assert.ok(aBig.opts.res > 0.00005);

/* ═══════════════ svg(): 1:1 em mm e as cores exatas do LightBurn ═══════════════ */

/* config de duas camadas, que e o caso simples: preenchimento + borda */
const DUAS = [ { src:'fill', ci:0, name:'cobre' }, { src:'board', ci:2, name:'borda' } ];
const svgPos = Laser.svg(aPos, Object.assign({}, aPos.opts, { layers:DUAS }));

/* escala fisica declarada: e isso que mata a ambiguidade 72 vs 96 DPI no import */
assert.ok(/width="24mm"/.test(svgPos),  'width em mm');
assert.ok(/height="24mm"/.test(svgPos), 'height em mm');
assert.ok(/viewBox="0 0 24 24"/.test(svgPos), 'viewBox 1:1 com o tamanho fisico');

/* cores da paleta, exatas - o LightBurn so casa cor->camada com o valor exato */
assert.strictEqual(Laser.LB.copper,  '#000000');   /* C00 */
assert.strictEqual(Laser.LB.silk,    '#0000FF');   /* C01 */
assert.strictEqual(Laser.LB.outline, '#FF0000');   /* C02 */
assert.ok(svgPos.includes('fill="#000000"'), 'cobre preenchido em C00');
assert.ok(svgPos.includes('stroke="#FF0000"'), 'contorno tracado em C02');
assert.ok(svgPos.includes('fill="none"'), 'o contorno nao pode ser preenchido');

/* o cobre e UM caminho composto com evenodd - os aneis ja vem orientados */
assert.ok(/fill-rule="evenodd"/.test(svgPos));
assert.strictEqual((svgPos.match(/<path/g) || []).length, 2, "um caminho composto por camada");

/* ── Y para baixo no SVG: o topo da placa vira y=0 ── */
const num = s => s.split(/[ ,LMZ]+/).filter(t => t && !isNaN(+t)).map(Number);
const dCopper = svgPos.match(/fill="#000000"[^>]*d="([^"]+)"/)[1];
const dOut = svgPos.match(/stroke="#FF0000"[^>]*d="([^"]+)"/)[1];
const oy = num(dOut).filter((_, i) => i % 2 === 1);
assert.ok(approx(Math.min(...oy), 2, 0.01), 'y=20 (topo da placa) vira 2 no SVG (margem 2)');
assert.ok(approx(Math.max(...oy), 22, 0.01), 'y=0 (base da placa) vira 22');

/* x nao inverte sem espelho: o disco fica centrado em 12 (10 + margem 2) */
const cxPos = num(dCopper).filter((_, i) => i % 2 === 0);
assert.ok(approx((Math.min(...cxPos) + Math.max(...cxPos))/2, 12, 0.05));

/* ── espelho: x inverte, y fica, area preservada ── */
const svgMir = Laser.svg(aPos, Object.assign({}, aPos.opts, { mirror:true, layers:DUAS }));
const dMir = svgMir.match(/fill="#000000"[^>]*d="([^"]+)"/)[1];
const cxMir = num(dMir).filter((_, i) => i % 2 === 0);
assert.ok(approx((Math.min(...cxMir) + Math.max(...cxMir))/2, 12, 0.05),
          'disco centrado espelha em si mesmo');

const bOff = board({ vias:[ { id:'v1', x:4, y:10, size:2, drill:0 } ] });   /* fora do centro */
const aOff = Laser.art(bOff, { side:'Top', res:0.02, margin:2, holes:'none' });
const xOf = s => { const d = s.match(/fill="#000000"[^>]*d="([^"]+)"/)[1];
                   const v = num(d).filter((_, i) => i % 2 === 0);
                   return (Math.min(...v) + Math.max(...v))/2; };
assert.ok(approx(xOf(Laser.svg(aOff, Object.assign({}, aOff.opts, { layers:DUAS }))), 6, 0.05), "sem espelho: x = 4 + margem 2");
assert.ok(approx(xOf(Laser.svg(aOff, Object.assign({}, aOff.opts, { mirror:true, layers:DUAS }))), 18, 0.05),
          'com espelho: x = 24 - 6');

/* ── serigrafia sai na C01, tracada quando e centerline ── */
/* a serigrafia nao esta na lista padrao da bancada; entra quando o usuario a adiciona */
const svgSilk = Laser.svg(sLine, Object.assign({}, sLine.opts, {
  layers:[ { src:'silk', ci:1, name:'serigrafia', cut:{ type:'Cut' } } ] }));
assert.ok(svgSilk.includes('stroke="#0000FF"'), 'serigrafia em C01');

/* ── exportSvg + nome do arquivo ── */
const ex = Laser.exportSvg(bArt, { side:'Bottom', invert:true, mirror:true, res:0.05 });
assert.ok(ex.svg.startsWith('<svg') || ex.svg.startsWith('<?xml'));
assert.ok(ex.art.copper.length > 0);
assert.strictEqual(Laser.filename('TCMS_Reader', { side:'Bottom', invert:true, mirror:true }),
                   'TCMS_Reader-LASER-Bottom-negativo-espelhado.svg');
assert.strictEqual(Laser.filename('TCMS_Reader', { side:'Top' }),
                   'TCMS_Reader-LASER-Top.svg');

/* ── checkOpts: combinacoes que geram geometria valida mas fisicamente errada ──
   O caso perigoso: negativo sem nenhum grupo de cobre marcado sai como um retangulo
   cheio - o laser queimaria a placa inteira. */
const noShow = { tracks:false, pads:false, vias:false, regions:false,
                 silk:false, texts:false, outline:false };
assert.deepStrictEqual(Laser.checkOpts({ side:'Top' }), [], 'o padrao nao gera aviso');
assert.ok(/vazio/.test(Laser.checkOpts({ show:noShow })[0]), 'nada marcado avisa');
assert.ok(/queimaria a placa/.test(
            Laser.checkOpts({ invert:true, show:Object.assign({}, noShow, { outline:true }) })[0]),
          'negativo sem cobre avisa que queima a placa toda');
assert.strictEqual(Laser.checkOpts({ invert:true, show:Object.assign({}, noShow, { pads:true }) }).length, 0,
                   'negativo com pads marcados esta ok');
assert.strictEqual(Laser.checkOpts({ invert:false, show:Object.assign({}, noShow, { silk:true }) }).length, 0,
                   'positivo so de serigrafia e legitimo');

/* e a arte confirma o perigo: negativo sem cobre = a placa inteira preenchida */
const bomba = Laser.art(bArt, { side:'Top', res:0.05, invert:true,
                                show:Object.assign({}, noShow, { outline:true }) });
assert.ok(approx(ringArea(bomba.copper[0]), 400, 8), 'sem cobre o negativo vira a placa cheia');

/* ═══════════════ camadas configuraveis ═══════════════
   O arquivo nao tem um conjunto fixo de camadas: o usuario monta a lista, escolhe a cor
   (= camada do LightBurn) de cada uma e pode REPETIR a mesma geometria em varias camadas,
   para rodar duas passadas com parametros diferentes. */

/* a paleta do LightBurn, com o valor exato - o import so casa cor->camada assim */
assert.strictEqual(Laser.PALETTE.length, 30);
assert.strictEqual(Laser.PALETTE[0],  '#000000');   /* C00 preto */
assert.strictEqual(Laser.PALETTE[1],  '#0000FF');   /* C01 azul */
assert.strictEqual(Laser.PALETTE[2],  '#FF0000');   /* C02 vermelho */
assert.strictEqual(Laser.PALETTE[3],  '#00E000');   /* C03 verde */

/* fontes de geometria disponiveis para uma camada */
assert.deepStrictEqual(Laser.SOURCES.map(s => s.id).sort(),
                       ['board', 'copperEdge', 'drills', 'fill', 'padEdge', 'silk']);

/* A lista padrao e a sequencia da bancada, e a ordem dos Cxx E a ordem de execucao
   (o `priority` sai do indice). Repare que a "3a passada" roda ANTES da "2a": e o
   processo do usuario, nao engano de digitacao. */
const LD = Laser.defaultLayers();
assert.deepStrictEqual(LD.map(l => l.ci), [0, 1, 2, 3, 4, 5, 6]);
assert.deepStrictEqual(LD.map(l => l.src),
  ['drills', 'fill', 'board', 'fill', 'fill', 'copperEdge', 'padEdge']);
assert.strictEqual(LD.filter(l => l.src === 'fill').length, 3,
                   'tres passadas de retirada de cobre, em camadas separadas');

const cut = i => LD[i].cut;

/* C00 furos - modo corte */
assert.strictEqual(cut(0).type, 'Cut');
assert.strictEqual(cut(0).speed, 80);
assert.strictEqual(cut(0).maxPower, 95);
assert.strictEqual(cut(0).globalPasses, 16, 'furos: 16 passagens GLOBAIS');
assert.strictEqual(cut(0).frequency, 40, 'nao pedido: mantem 40 kHz');
assert.strictEqual(cut(0).qPulse, 200, 'nao pedido: mantem 200 ns');

/* C01 retirada de cobre, 1a passada */
assert.strictEqual(cut(1).type, 'Scan');
assert.strictEqual(cut(1).maxPower, 55);
assert.strictEqual(cut(1).frequency, 45);
assert.strictEqual(cut(1).qPulse, 200);
assert.strictEqual(cut(1).crossHatch, true);
assert.strictEqual(cut(1).speed, 1000, 'nao pedido: mantem 1000 mm/s');
assert.strictEqual(cut(1).globalPasses, 1, 'nao pedido: mantem 1');
assert.strictEqual(cut(1).bidir, true, 'nao pedido: mantem bidirecional');
assert.strictEqual(cut(1).angle, 45, 'nao pedido: mantem 45 graus');
assert.strictEqual(cut(1).interval, 0.05, 'nao pedido: mantem 0,05 mm');

/* C02 corte da borda - nao foi pedida mudanca, fica como estava */
assert.strictEqual(cut(2).type, 'Cut');
assert.strictEqual(cut(2).speed, 100);
assert.strictEqual(cut(2).maxPower, 100);
assert.strictEqual(cut(2).frequency, 40);
assert.strictEqual(cut(2).globalPasses, 20);

/* C03 retirada de cobre (limpeza), 3a passada: SO a potencia muda */
assert.strictEqual(cut(3).maxPower, 20);
assert.deepStrictEqual(Object.assign({}, cut(3), { maxPower: cut(1).maxPower }), cut(1),
                       'a 3a passada so difere da 1a na potencia');

/* C04 retirada de cobre, 2a passada: identica a 1a */
assert.deepStrictEqual(cut(4), cut(1), 'a 2a passada usa os mesmos parametros da 1a');

/* C05 contorno do cobre (limpeza) */
assert.strictEqual(cut(5).type, 'Scan');
assert.strictEqual(cut(5).speed, 1000);
assert.strictEqual(cut(5).maxPower, 20);
assert.strictEqual(cut(5).frequency, 45);
assert.strictEqual(cut(5).qPulse, 200);
assert.strictEqual(cut(5).crossHatch, true);
assert.strictEqual(cut(5).angle, 45);
assert.strictEqual(cut(5).globalPasses, 1, 'nao pedido: mantem 1');
assert.strictEqual(cut(5).bidir, true, 'nao pedido: mantem bidirecional');

/* C06 destaque das bordas de pad e via (depois da tinta UV): mesma config da limpeza */
assert.deepStrictEqual(cut(6), cut(5), 'usa a configuracao da limpeza do contorno');
assert.strictEqual(LD[6].src, 'padEdge');

/* configs salvas antes do rename: numPasses (nome antigo do campo da bancada) migra para
   globalPasses ao ler - o valor sempre significou passagens globais, so o nome estava errado */
assert.strictEqual(Laser.cutOf({ numPasses: 20 }).globalPasses, 20);
assert.strictEqual(Laser.cutOf({ numPasses: 20 }).numPasses, undefined,
                   'o nome antigo nao sobrevive - senao viraria numPasses no arquivo de novo');
assert.strictEqual(Laser.layerCut({ src: 'drills', cut: { numPasses: 7 } }).globalPasses, 7);
assert.strictEqual(Laser.cutOf({ globalPasses: 3, numPasses: 2 }).globalPasses, 3,
                   'valor explicito ganha do legado');

/* o MODO manda no traco: Scan sai preenchido, Cut sai so contornado. Antes quem decidia
   era a fonte de geometria, o que ignorava a escolha da bancada. */
const svgModo = Laser.svg(aPos, Object.assign({}, aPos.opts, { layers:[
  { src:'copperEdge', ci:4, name:'limpeza', cut:{ type:'Scan' } },
  { src:'board',      ci:2, name:'borda',   cut:{ type:'Cut'  } },
] }));
assert.ok(/fill="#D0D000"/.test(svgModo), 'camada em modo preencher sai com fill');
assert.ok(/stroke="#FF0000"/.test(svgModo) && /fill="none"/.test(svgModo),
          'camada em modo linha sai so com stroke');

/* ── contorno SO de pads e vias: a camada de destaque depois da tinta UV ──
   Mesma configuracao da limpeza do contorno, mas ignorando trilha e regiao: o que se
   quer expor e o anel do pad e da via, nao a trilha inteira. */
const bPV = board({
  tracks:[ { id:'t1', layer:'Top', x1:2, y1:2, x2:12, y2:2, w:1 } ],
  components:[ { id:'c1', ref:'J1', layer:'Top', x:15, y:15, pads:[
    { id:'c1p1', layer:'Top', type:'smd', shape:'circle', x:15, y:15, w:2, h:2, rot:0 } ] } ],
  vias:[ { id:'v1', x:6, y:10, size:2, drill:0 } ],
});
const aPV = Laser.art(bPV, { side:'Top', res:0.02 });
assert.strictEqual(aPV.copperEdge.length, 3, 'trilha + pad + via');
assert.strictEqual(aPV.padEdge.length, 2, 'so o pad e a via - a trilha fica de fora');
const areaPV = aPV.padEdge.map(ringArea).sort((a, b) => a - b);
assert.ok(approx(areaPV[0], Math.PI, Math.PI*0.02) && approx(areaPV[1], Math.PI, Math.PI*0.02),
          'cada um e um disco de raio 1: ' + areaPV);

/* a fonte existe na lista de escolhas da aba */
assert.ok(Laser.SOURCES.some(s => s.id === 'padEdge'), 'padEdge disponivel como fonte');
assert.ok(Laser.geomFor(aPV, 'padEdge').rings.length === 2);

/* pad e via furados: o contorno segue o cobre COM o furo ja descontado */
const aPVf = Laser.art(board({ vias:[ { id:'v1', x:10, y:10, size:2, drill:1 } ] }),
                       { side:'Top', res:0.02, holes:'drill' });
assert.strictEqual(aPVf.padEdge.length, 2, 'anel externo da via + o furo');
assert.ok(aPVf.padEdge.some(r => ringArea(r) < 0), 'o furo entra como buraco');

/* ── indice livre: duas camadas no mesmo Cxx se FUNDEM no LightBurn, entao somar ou
      duplicar tem que cair sempre num indice que ninguem esta usando ── */
assert.strictEqual(Laser.freeCi([]), 0);
assert.strictEqual(Laser.freeCi([{ ci:0 }]), 1);
assert.strictEqual(Laser.freeCi([{ ci:0 }, { ci:1 }, { ci:3 }]), 2, 'usa o primeiro buraco');
assert.strictEqual(Laser.freeCi(LD), 7, 'a lista padrao usa C00..C06');
/* lista cheia: nao inventa indice fora da paleta */
const cheia = Array.from({ length:30 }, (_, i) => ({ ci:i }));
assert.ok(Laser.freeCi(cheia) >= 0 && Laser.freeCi(cheia) < 30);

/* ── art() entrega as geometrias que as camadas consomem ── */
const bLay = board({
  tracks:[ { id:'t1', layer:'Top', x1:4, y1:10, x2:14, y2:10, w:1 } ],
  components:[ { id:'c1', ref:'J1', layer:'Top', x:16, y:10, pads:[
    { id:'c1p1', layer:'Multi', type:'th', shape:'circle', x:16, y:10, w:3, h:3, rot:0, drill:1.2 } ] } ],
});
const aL = Laser.art(bLay, { side:'Top', res:0.02 });
assert.ok(aL.copper.length > 0, 'area de preenchimento');
assert.ok(aL.copperEdge.length > 0, 'contorno do cobre, para a limpeza');
assert.strictEqual(aL.drills.length, 1, 'um furo na camada de furos');
assert.strictEqual(aL.drills[0].k, 'disc');
assert.strictEqual(aL.drills[0].r, 0.6, 'a camada de furos usa o diametro REAL da broca');

/* o contorno do cobre e sempre o do COBRE, mesmo no negativo (onde o fill e o inverso) */
const aLneg = Laser.art(bLay, { side:'Top', res:0.02, invert:true });
assert.ok(approx(Math.abs(ringArea(aLneg.copperEdge[0])),
                 Math.abs(ringArea(aL.copperEdge[0])), 0.3),
          'a limpeza segue o cobre nos dois modos, nao o preenchimento');

/* a camada de furos existe mesmo com o furo desligado no cobre - sao coisas ortogonais */
const aLnone = Laser.art(bLay, { side:'Top', res:0.02, holes:'none' });
assert.strictEqual(aLnone.drills.length, 1, 'furo continua disponivel como camada propria');
assert.ok(aLnone.copper.every(r => ringArea(r) > 0), 'mas nao foi subtraido do cobre');

/* ── o SVG emite um grupo por camada configurada, com a cor da paleta ── */
const svgL = Laser.svg(aL, Object.assign({}, aL.opts, { layers:[
  { src:'fill',       ci:0, name:'retirada' },
  { src:'copperEdge', ci:4, name:'limpeza 1' },
  { src:'copperEdge', ci:5, name:'limpeza 2' },      /* mesma geometria, outra camada */
  { src:'drills',     ci:3, name:'furos' },
  { src:'board',      ci:2, name:'borda' },
] }));
assert.strictEqual((svgL.match(/<g /g) || []).length, 5, 'cinco grupos, um por camada');
assert.ok(svgL.includes('#D0D000'), 'limpeza 1 na C04');
assert.ok(svgL.includes('#FF8000'), 'limpeza 2 na C05');
assert.ok(svgL.includes('#00E000'), 'furos na C03');
assert.ok(/<circle/.test(svgL), 'furo circular sai como circulo, nao poligonizado');
assert.ok(/data-lb-layer="C04"/.test(svgL), 'cada grupo diz a que camada pertence');

/* camada sem geometria nao vira grupo vazio */
const svgVazio = Laser.svg(aL, Object.assign({}, aL.opts, { layers:[
  { src:'silk', ci:1, name:'serigrafia' }, { src:'fill', ci:0, name:'retirada' } ] }));
assert.strictEqual((svgVazio.match(/<g /g) || []).length, 1);

/* ═══════════════ .lbrn: formato nativo, com os parametros dentro ═══════════════
   Esquema conferido contra um arquivo real de MOPA 60W (Color_Test_60W_MOPA.lbrn2):
   frequency em Hz, QPulseWidth em ns, booleanos como 1/0. */

const LAYS = [
  { src:'drills',     ci:0, name:'furos',
    cut:{ type:'Cut',  speed:100,  maxPower:100, frequency:40, globalPasses:20, qPulse:200 } },
  { src:'fill',       ci:1, name:'retirada de cobre',
    cut:{ type:'Scan', speed:1000, maxPower:85,  frequency:35, globalPasses:1,  qPulse:200,
          bidir:true, crossHatch:true, angle:45, interval:0.01 } },
  { src:'board',      ci:2, name:'borda' ,
    cut:{ type:'Cut',  speed:100,  maxPower:100, frequency:40, globalPasses:20, qPulse:200 } },
];
const lb = Laser.lbrn(aL, Object.assign({}, aL.opts, { layers:LAYS }));

assert.ok(lb.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'cabecalho XML');
assert.ok(/<LightBurnProject [^>]*FormatVersion="1"/.test(lb), 'raiz LightBurnProject');
assert.ok(/AppVersion="1.6.00"/.test(lb),
          'globalRepeat e campo da era 1.5+ - o cabecalho nao pode dizer 1.4.00');
assert.ok(/MirrorX="False"/.test(lb) && /MirrorY="False"/.test(lb));

/* uma CutSetting por camada, com o indice = Cxx */
assert.strictEqual((lb.match(/<CutSetting /g) || []).length, 3);
assert.ok(/<CutSetting type="Cut">[\s\S]*?<index Value="0"\/>/.test(lb),  'C00 furos = Cut');
assert.ok(/<CutSetting type="Scan">[\s\S]*?<index Value="1"\/>/.test(lb), 'C01 cobre = Scan');

const bloco = ci => lb.match(new RegExp('<CutSetting[^>]*>(?:(?!</CutSetting>)[\\s\\S])*?' +
                                        '<index Value="' + ci + '"\\/>[\\s\\S]*?</CutSetting>'))[0];
const val = (b, k) => { const m = b.match(new RegExp('<' + k + ' Value="([^"]+)"')); return m && m[1]; };

const b0 = bloco(0), b1 = bloco(1);
assert.strictEqual(val(b0, 'name'), 'furos');
assert.strictEqual(val(b0, 'speed'), '100');
assert.strictEqual(val(b0, 'maxPower'), '100');
assert.strictEqual(val(b0, 'frequency'), '40000', 'kHz da UI vira Hz no arquivo');
assert.strictEqual(val(b0, 'QPulseWidth'), '200');
/* "passagens globais" da bancada = <globalRepeat> no galvo (nome conferido nas strings do
   binario LightBurn 1.6.04). <numPasses> e o "Numero de Passagens" DA SUB-CAMADA - 20 ali
   fazia o LightBurn carregar 20 no campo errado. */
assert.strictEqual(val(b0, 'globalRepeat'), '20');
assert.strictEqual(val(b0, 'numPasses'), null, 'numPasses nao pode voltar a sair');

assert.strictEqual(val(b1, 'speed'), '1000');
assert.strictEqual(val(b1, 'maxPower'), '85');
assert.strictEqual(val(b1, 'frequency'), '35000');
assert.strictEqual(val(b1, 'crossHatch'), '1', 'booleano vira 1/0');
assert.strictEqual(val(b1, 'bidir'), '1');
assert.strictEqual(val(b1, 'angle'), '45');
assert.strictEqual(val(b1, 'interval'), '0.01');
/* sem rampa: uma potencia so na UI vira minPower = maxPower */
assert.strictEqual(val(b1, 'minPower'), val(b1, 'maxPower'));

/* ── FORMA CONDENSADA: e a unica que o FormatVersion="1" le ──
   O arquivo de referencia (.lbrn2) tem 50 VertList/PrimList e ZERO "<V vx=" ou "<P T=".
   Emitir o formato legado dentro de FormatVersion="1" gera um arquivo que abre com as
   camadas certas e NENHUMA geometria. */
assert.ok(/<Shape Type="Path" CutIndex="1">/.test(lb), 'preenchimento como Path na C01');
assert.ok(/<VertList>/.test(lb) && /<PrimList>/.test(lb), 'lista condensada');
assert.ok(!/<V vx=/.test(lb), 'nao pode sair vertice no formato legado');
assert.ok(!/<P T=/.test(lb), 'nao pode sair primitiva no formato legado');
assert.ok(/<XForm>1 0 0 1 0 0<\/XForm>/.test(lb), 'coordenadas absolutas, XForm identidade');

/* sintaxe do VertList: V<x> <y> e os marcadores de "sem bezier" */
const vl = lb.match(/<VertList>([^<]*)<\/VertList>/)[1];
assert.ok(/^V-?[\d.]+ -?[\d.]+c0x1c1x1V/.test(vl), 'VertList mal formado: ' + vl.slice(0, 60));

/* PrimList liga os vertices em sequencia e FECHA o laco no primeiro */
const pl = lb.match(/<PrimList>([^<]*)<\/PrimList>/)[1];
const nv = (vl.match(/V-?[\d.]+ /g) || []).length;
assert.ok(/^L0 1L1 2/.test(pl), 'PrimList mal formado: ' + pl.slice(0, 40));
assert.ok(pl.endsWith('L' + (nv - 1) + ' 0'), 'o ultimo segmento fecha no vertice 0');

/* o furo tambem sai como Path: Ellipse nao esta no arquivo de referencia, e nao da para
   confirmar o atributo. Poligono no caminho ja provado vale mais que elegancia. */
assert.ok(/<Shape Type="Path" CutIndex="0">/.test(lb), 'furo sai como Path, na C00');
assert.ok(!/Type="Ellipse"/.test(lb));

/* ── Y NAO inverte no .lbrn: o LightBurn usa Y para cima, o SVG para baixo ── */
const lbY = Laser.lbrn(aPos, Object.assign({}, aPos.opts, { layers:[
  { src:'board', ci:2, name:'borda', cut:{ type:'Cut' } } ] }));
const vert = s => [...s.matchAll(/V(-?[\d.]+) (-?[\d.]+)c/g)].map(m => [+m[1], +m[2]]);
const ys = vert(lbY).map(p => p[1]);
assert.ok(approx(Math.max(...ys), 22, 0.01), 'topo da placa (y=20) vira 22, e nao 2');
assert.ok(approx(Math.min(...ys), 2, 0.01), 'base da placa (y=0) vira 2');

/* espelho continua valendo em X */
const lbM = Laser.lbrn(aOff, Object.assign({}, aOff.opts, { mirror:true, layers:[
  { src:'fill', ci:1, name:'cobre', cut:{ type:'Scan' } } ] }));
const xs2 = vert(lbM).map(p => p[0]);
assert.ok(approx((Math.min(...xs2) + Math.max(...xs2))/2, 18, 0.06), 'espelhado: x = 24 - 6');

/* nome do arquivo */
assert.strictEqual(Laser.filename('TCMS_Reader', { side:'Top' }, 'lbrn2'),
                   'TCMS_Reader-LASER-Top.lbrn2');

/* ── espelho e auto-marcado ao escolher Bottom, mas continua editavel ── */
assert.strictEqual(Laser.defaults().mirror, false);
assert.strictEqual(Laser.autoMirror('Bottom'), true);
assert.strictEqual(Laser.autoMirror('Top'), false);

/* ═══════════════ placa real ═══════════════
   A TCMS_Reader tem contorno chanfrado, pads Multi, vias e regioes - e onde as
   suposicoes do gerador encostam em dado de verdade. */

const path = require('path'), fs = require('fs');
const real = path.join(__dirname, '..', 'Projects', 'TCMS_Reader', 'board.js');
if (fs.existsSync(real)){
  const B = require('./load.js').loadVar('Projects/TCMS_Reader/board.js', 'pcbmirror');

  const aR = Laser.art(B, { side:'Top', res:0.05 });
  assert.strictEqual(aR.warnings.length, 0, 'placa real nao deve gerar aviso: ' + aR.warnings);
  assert.ok(aR.copper.length > 0, 'gerou cobre');
  assert.ok(aR.outline.length === 1 && aR.outline[0].length > 4, 'contorno chanfrado encadeado');

  /* nada de cobre fora da placa */
  const xs = aR.copper.flat().map(p => p[0]), ys = aR.copper.flat().map(p => p[1]);
  assert.ok(Math.min(...xs) >= B.board.bbox.x1 - 0.1 && Math.max(...xs) <= B.board.bbox.x2 + 0.1);
  assert.ok(Math.min(...ys) >= B.board.bbox.y1 - 0.1 && Math.max(...ys) <= B.board.bbox.y2 + 0.1);

  /* o negativo cobre a placa toda menos o cobre: um anel externo grande e muitos buracos */
  const nR = Laser.art(B, { side:'Top', res:0.05, invert:true });
  const outs = nR.copper.filter(r => ringArea(r) > 0);
  const bigger = Math.max(...outs.map(ringArea));
  assert.ok(bigger > 3000, 'o anel externo do negativo e a placa inteira: ' + bigger);
  assert.ok(nR.copper.some(r => ringArea(r) < 0), 'o cobre virou buraco no negativo');

  /* bottom espelhado gera e continua 1:1 */
  const eb = Laser.exportSvg(B, { side:'Bottom', mirror:true, res:0.05 });
  const wmm = eb.svg.match(/width="([\d.]+)mm"/)[1];
  const vb = eb.svg.match(/viewBox="0 0 ([\d.]+) /)[1];
  assert.strictEqual(wmm, vb, 'width em mm e viewBox tem que bater = escala 1:1');

  /* serigrafia real, com designator substituido */
  const sR = Laser.art(B, { side:'Top', res:0.05, show:{ silk:true, texts:true } });
  assert.ok(sR.silkLines.length > 100, 'serigrafia da placa real saiu');
}

console.log('test-laser OK');
