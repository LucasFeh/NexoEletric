const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const GV = require('../hub-gerberview.js');

/* O visualizador de Gerber le o que o hub gera (X2 como o Altium 21 para a JLCPCB) e o que
   vier de fora: aqui so Gerber SINTETICO, escrito no proprio teste. No fim, um bloco opcional
   confere contra os arquivos reais da rede (projeto de cliente: lidos, nunca copiados). */

const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol == null ? 1e-6 : tol), (msg || '') + ': ' + a + ' != ' + b);
const flashes = c => c.prims.filter(p => p.k === 'flash');
const linhas = c => c.prims.filter(p => p.k === 'line');
/* area escura de uma abertura: soma dos poligonos, furo/claro subtrai (vale com o furo por dentro) */
const areaAb = ap => GV.contornoDaAbertura(ap, 0, 0).reduce((s, pg) => s + (pg.claro ? -1 : 1) * Math.abs(GV.areaComSinal(pg.pts)), 0);
const MM = '%FSLAX46Y46*%\n%MOMM*%\n';

(async () => {

/* ── %FS: zeros a esquerda omitidos (L), polegada ── */
{
  const c = GV.parse('%FSLAX24Y24*%\n%MOIN*%\n%ADD10C,0.010*%\nD10*\nX10000Y5000D03*\nM02*\n', 'l.gbr');
  assert.deepStrictEqual(c.avisos, []);
  assert.strictEqual(c.unidades, 'mm');
  const f = flashes(c)[0];
  perto(f.x, 25.4, 1e-9, 'X10000 em 2.4 = 1 pol'); perto(f.y, 12.7, 1e-9);
  perto(f.ap.params[0], 0.254, 1e-12, 'MOIN: abertura em mm');
  assert.strictEqual(f.escuro, true);
}
/* ── %FS: zeros a DIREITA omitidos (T), como a reexportacao do CAMtastic; coordenada modal ── */
{
  const c = GV.parse('%FSTAX23Y23*%\n%MOIN*%\n%SFA1B1*%\n\n%IPPOS*%\n%ADD10C,0.010*%\n%LNteste-1*%\n%LPD*%\nG54D10*\nX0326Y-00201D03*\nX03235D03*\nX0Y0D03*\nM02*', 't.gbr');
  assert.deepStrictEqual(c.avisos, [], 'SF/IP/LN aceitos sem aviso');
  const [a, b, z] = flashes(c);
  perto(a.x, 3.26 * 25.4, 1e-9, 'X0326 em 2.3 com T = 03.260'); perto(a.y, -0.201 * 25.4, 1e-9);
  perto(b.x, 3.235 * 25.4, 1e-9); perto(b.y, a.y, 1e-12, 'Y modal');
  perto(z.x, 0); perto(z.y, 0);
}
/* ── outros formatos e numero com ponto decimal ── */
{
  const c = GV.parse('%FSLAX66Y66*%\n%MOMM*%\n%ADD10C,0.1*%\nD10*\nX1500000Y-2500D03*\nX1.5Y2.25D03*\nM02*', 'f66.gbr');
  perto(flashes(c)[0].x, 1.5); perto(flashes(c)[0].y, -0.0025);
  perto(flashes(c)[1].x, 1.5); perto(flashes(c)[1].y, 2.25);
  const d = GV.parse('%FSLAX36Y36*%\n%MOMM*%\n%ADD10C,0.1*%\nD10*\nX1500000Y1D03*\nM02*', 'f36.gbr');
  perto(flashes(d)[0].x, 1.5); perto(flashes(d)[0].y, 0.000001);
  /* X45 do Altium */
  const e = GV.parse('%FSLAX45Y45*%\n%MOMM*%\n%ADD10C,0.1*%\nD10*\nX9327486Y-511402D03*\nM02*', 'f45.gbr');
  perto(flashes(e)[0].x, 93.27486); perto(flashes(e)[0].y, -5.11402);
}
/* ── bloco estendido combinado (RS-274X antigo) e o cabecalho do Eagle (G70 antes do %FS, OC8) ── */
{
  const c = GV.parse('%FSLAX24Y24*MOIN*IPPOS*%\n%ADD10C,0.01*%\nD10*\nX10000Y0D03*\nM02*', 'comb.gbr');
  assert.deepStrictEqual(c.avisos, []);
  perto(flashes(c)[0].x, 25.4);
  const e = GV.parse('G75*\nG70*\n%OFA0B0*%\n%FSLAX24Y24*%\n%IPPOS*%\n%LPD*%\n%AMOC8*\n5,1,8,0,0,1.08239X$1,22.5*\n%\n%ADD10OC8,0.0600*%\nD10*\nX1000Y1000D03*\nM02*\n', 'placa.cmp');
  assert.deepStrictEqual(e.avisos, []);
  const f = flashes(e)[0];
  const b = GV.caixaDe(f);
  perto(b[2] - b[0], 0.06 * 25.4, 1e-4, 'octogono do Eagle: 0.060 pol entre faces'); perto(b[3] - b[1], 0.06 * 25.4, 1e-4);
  perto((b[0] + b[2]) / 2, 2.54, 1e-9);
  assert.strictEqual(GV.camadaDe('placa.cmp', e.funcao).chave, 'Top');
}
/* ── o X2 do KiCad: macro RoundRect com comentarios "0 ..." e parametros negativos; Excellon decimal ── */
{
  const rr = '%AMRoundRect*\n0 Rectangle with rounded corners*\n0 $1 Rounding radius*\n0 $2 $3 $4 $5 $6 $7 $8 $9 X,Y pos of 4 corners*\n' +
    '4,1,4,$2,$3,$4,$5,$6,$7,$8,$9,$2,$3,0*\n1,1,$1+$1,$2,$3*\n1,1,$1+$1,$4,$5*\n1,1,$1+$1,$6,$7*\n1,1,$1+$1,$8,$9*\n' +
    '20,1,$1+$1,$2,$3,$4,$5,0*\n20,1,$1+$1,$4,$5,$6,$7,0*\n20,1,$1+$1,$6,$7,$8,$9,0*\n20,1,$1+$1,$8,$9,$2,$3,0*%\n';
  const c = GV.parse('%TF.GenerationSoftware,KiCad,Pcbnew,7.0.0*%\n%TF.FileFunction,Copper,L1,Top*%\n%TF.FilePolarity,Positive*%\n%FSLAX46Y46*%\n' +
    'G04 Gerber Fmt 4.6, Leading zero omitted, Abs format (unit mm)*\n%MOMM*%\n%LPD*%\nG01*\nG04 APERTURE LIST*\n' + rr +
    '%TA.AperFunction,SMDPad,CuDef*%\n%ADD10RoundRect,0.250000X-0.450000X-0.350000X0.450000X-0.350000X0.450000X0.350000X-0.450000X0.350000X0*%\n%TD*%\n' +
    '%TO.C,R1*%\n%TO.P,R1,1*%\n%TO.N,GND*%\nD10*\nX100000000Y-80000000D03*\n%TD*%\nM02*\n', 'proj-F_Cu.gbr');
  assert.deepStrictEqual(c.avisos, []);
  const f = flashes(c)[0];
  assert.strictEqual(f.ap.macro.length, 9, 'os comentarios nao viram primitiva');
  const b = GV.caixaDe(f);
  perto(b[0], 100 - 0.7, 1e-9); perto(b[2], 100 + 0.7, 1e-9); perto(b[1], -80 - 0.6, 1e-9); perto(b[3], -80 + 0.6, 1e-9);
  assert.strictEqual(f.aperFunction, 'SMDPad,CuDef');
  assert.deepStrictEqual(f.obj, { C: 'R1', P: 'R1,1', N: 'GND' });
  assert.strictEqual(GV.camadaDe(c.nome, c.funcao).chave, 'Top');
  const d = GV.parseExcellon('M48\n; DRILL file {KiCad 7.0.0} date 2023-01-01T00:00:00+0000\n; FORMAT={-:-/ absolute / metric / decimal}\n' +
    '; #@! TF.FileFunction,MixedPlating,1,2\nFMAT,2\nMETRIC\n; #@! TA.AperFunction,Plated,PTH,ViaDrill\nT1C0.400\nT2C1.000\n%\nG90\nG05\nT1\nX120.65Y-80.01\nT2\nX127.0Y-88.9\nT0\nM30\n', 'proj.drl');
  assert.deepStrictEqual(d.avisos, []);
  assert.deepStrictEqual(flashes(d).map(p => [p.x, p.y, p.ap.params[0]]), [[120.65, -80.01, 0.4], [127, -88.9, 1]]);
  assert.strictEqual(GV.camadaDe(d.nome, d.funcao).chave, 'Drill');
}
/* ── G70/G71 e G90/G91 ── */
{
  const c = GV.parse('%FSLAX24Y24*%\nG70*\n%ADD10C,0.01*%\nD10*\nX10000Y0D03*\nG91*\nX10000Y10000D03*\nG90*\nG71*\nX10000Y0D03*\nM02*', 'g7x.gbr');
  const [a, b, d] = flashes(c);
  perto(a.x, 25.4); perto(b.x, 50.8, 1e-9, 'G91 soma ao ponto corrente'); perto(b.y, 25.4);
  perto(d.x, 1, 1e-9, 'G71 passa a mm');
}

/* ── %AD: C, R, O, P, com e sem furo ── */
{
  const c = GV.parse(MM + '%ADD10C,1.0X0.4*%\n%ADD11R,2.0X1.0*%\n%ADD12R,2.0X1.0X0.5*%\n%ADD13O,3.0X1.0*%\n%ADD14P,2.0X6X30*%\n%ADD15P,2.0X4X0X0.5*%\n' +
    'D10*X0Y0D03*\nD11*X0Y0D03*\nD12*X0Y0D03*\nD13*X0Y0D03*\nD14*X0Y0D03*\nD15*X0Y0D03*\nM02*', 'ad.gbr');
  assert.deepStrictEqual(c.avisos, []);
  const ap = flashes(c).map(f => f.ap);
  assert.deepStrictEqual(ap.map(a => a.tipo), ['C', 'R', 'R', 'O', 'P', 'P']);
  assert.deepStrictEqual(ap.map(a => a.d), [10, 11, 12, 13, 14, 15]);
  assert.deepStrictEqual(ap[0].furo, [0.4]);
  assert.deepStrictEqual(ap[4].params, [2, 6, 30], 'P: diametro, vertices, rotacao');
  perto(areaAb(ap[0]), Math.PI * (0.25 - 0.04), 0.02, 'circulo com furo (poligono inscrito)');
  perto(areaAb(ap[1]), 2, 1e-9, 'retangulo');
  perto(areaAb(ap[2]), 2 - Math.PI * 0.0625, 0.02, 'retangulo com furo');
  perto(areaAb(ap[3]), 2 + Math.PI * 0.25, 0.02, 'oblongo = retangulo + 2 meios circulos');
  perto(areaAb(ap[4]), 3 * Math.sqrt(3) / 2, 1e-9, 'hexagono de raio 1');
  perto(areaAb(ap[5]), 2 - Math.PI * 0.0625, 0.02, 'losango com furo');
  /* o hexagono girado 30 graus tem um vertice em 30 graus */
  const hx = GV.contornoDaAbertura(ap[4], 0, 0)[0].pts;
  perto(hx[0][0], Math.cos(Math.PI / 6)); perto(hx[0][1], 0.5);
  /* contornoDaAbertura desloca para o ponto do flash */
  const r = GV.contornoDaAbertura(ap[1], 10, 20)[0].pts;
  assert.deepStrictEqual(r, [[9, 19.5], [11, 19.5], [11, 20.5], [9, 20.5]]);
  /* o furo da abertura padrao NAO apaga em sequencia: entra no mesmo caminho */
  assert.strictEqual(GV.ehSequencial(GV.formasDe(ap[0])), false);
  assert.ok(GV.formasDe(ap[0])[1].furo);
}

/* ── macro ROUNDEDRECT do Altium 21 (a forma exata do X2) ── */
{
  const rr = '%AMROUNDEDRECTD17*\n21,1,2.60278,0.00000,0,0,270.0*\n21,1,1.98065,0.62213,0,0,270.0*\n1,1,0.62213,0.00000,-0.99033*\n1,1,0.62213,0.00000,0.99033*\n1,1,0.62213,0.00000,0.99033*\n1,1,0.62213,0.00000,-0.99033*\n%\n%ADD17ROUNDEDRECTD17*%\n';
  const c = GV.parse('%FSLAX45Y45*%\n%MOMM*%\n%TA.AperFunction,SMDPad,CuDef*%\n' + rr + 'D17*\nX7073900Y7263750D02*\nD03*\nM02*', 'rr.gbr');
  assert.deepStrictEqual(c.avisos, []);
  const f = flashes(c)[0];
  assert.strictEqual(f.ap.tipo, 'M');
  assert.strictEqual(f.ap.nomeMacro, 'ROUNDEDRECTD17');
  assert.strictEqual(f.ap.macro.length, 6, 'as 6 primitivas avaliadas');
  assert.deepStrictEqual(f.ap.macro.map(p => p.codigo), [21, 21, 1, 1, 1, 1]);
  assert.strictEqual(f.aperFunction, 'SMDPad,CuDef', 'a funcao vem do %TA em vigor no %AD');
  perto(f.x, 70.739); perto(f.y, 72.6375);
  /* retangulo girado 270 em pe + 2 circulos nas pontas: estadio 0.622 x 2.603 */
  const b = GV.caixaDe(f);
  perto(b[0], 70.739 - 0.311065, 1e-6); perto(b[2], 70.739 + 0.311065, 1e-6);
  perto(b[1], 72.6375 - 1.301395, 1e-6); perto(b[3], 72.6375 + 1.301395, 1e-6);
  assert.strictEqual(GV.formasDe(f.ap).length, 5, 'o retangulo de altura 0 nao vira forma');
  /* a mesma pastilha como o CAMtastic reescreve: contorno (4) com 8 vertices, em polegada */
  const cam = GV.parse('%FSTAX23Y23*%\n%MOIN*%\n%AMD17*\n4,1,8,0.012200,-0.039000,0.012200,0.039000,0.000000,0.051200,0.000000,0.051200,-0.012200,0.039000,-0.012200,-0.039000,0.000000,-0.051200,0.000000,-0.051200,0.012200,-0.039000,0.0*\n1,1,0.024494,0.000000,-0.039000*\n1,1,0.024494,0.000000,0.039000*\n%\n%ADD17D17*%\nG54D17*\nX02785Y02859D03*\nM02*', 'rr-cam.gbr');
  assert.deepStrictEqual(cam.avisos, []);
  const g = flashes(cam)[0];
  assert.strictEqual(g.ap.macro[0].codigo, 4);
  perto(g.ap.macro[0].mods[2], 0.0122 * 25.4, 1e-9, 'vertice do contorno convertido para mm');
  const bc = GV.caixaDe(g);
  perto(bc[2] - bc[0], 0.024494 * 25.4, 1e-6, 'largura da pastilha'); perto(bc[3] - bc[1], (0.078 + 0.024494) * 25.4, 1e-6);
}

/* ── macro com variaveis, atribuicao, expressoes e exposicao desligada ── */
{
  assert.strictEqual(GV.avaliaExpr('1+2x3'), 7);
  assert.strictEqual(GV.avaliaExpr('(1+2)X3'), 9);
  assert.strictEqual(GV.avaliaExpr('2/4x2'), 1, 'esquerda para a direita');
  assert.strictEqual(GV.avaliaExpr('-(2)'), -2);
  assert.strictEqual(GV.avaliaExpr('--1'), 1);
  assert.strictEqual(GV.avaliaExpr('1.5+.5'), 2);
  assert.strictEqual(GV.avaliaExpr('$1x$2-$3', { 1: 3, 2: 4, 3: 2 }), 10);
  assert.strictEqual(GV.avaliaExpr('$9+1', {}), 1, 'variavel indefinida vale 0');
  assert.throws(() => GV.avaliaExpr('1+'));
  assert.throws(() => GV.avaliaExpr('(1+2'));
  const c = GV.parse(MM + '%AMTESTE*\n0 macro de teste com variaveis*\n$4=$1x0.5*\n1,1,$1,0,0*\n21,1,$2,$3,$4+(1-1),0,45*\n$5=($2+$3)/2X-1*\n1,0,$4,$5x0,0*\n%\n' +
    '%ADD20TESTE,1.0X2X0.5*%\nD20*\nX10000000Y10000000D03*\nM02*', 'var.gbr');
  assert.deepStrictEqual(c.avisos, []);
  const ap = flashes(c)[0].ap;
  assert.deepStrictEqual(ap.params, [1, 2, 0.5]);
  assert.strictEqual(ap.macro.length, 3);
  assert.deepStrictEqual(ap.macro[0], { codigo: 1, mods: [1, 1, 0, 0] });
  assert.deepStrictEqual(ap.macro[1].mods, [1, 2, 0.5, 0.5, 0, 45], '$4 = $1x0.5');
  assert.strictEqual(ap.macro[2].mods[0], 0, 'exposicao desligada');
  perto(ap.macro[2].mods[1], 0.5);
  /* o centro do retangulo gira em torno da ORIGEM da macro */
  const fs2 = GV.formasDe(ap);
  const cx = fs2[1].pts.reduce((s, q) => s + q[0], 0) / 4, cy = fs2[1].pts.reduce((s, q) => s + q[1], 0) / 4;
  perto(cx, 0.5 * Math.SQRT1_2, 1e-9); perto(cy, 0.5 * Math.SQRT1_2, 1e-9);
  assert.strictEqual(GV.ehSequencial(fs2), true, 'exposicao desligada depois de ligada = pintura em sequencia');
  /* no centro, o circulo desligado vence; a 0.4 mm dele, o circulo ligado */
  assert.strictEqual(GV.objetoEm(c, 10, 10, 0), null);
  assert.strictEqual(GV.objetoEm(c, 10.4, 10, 0), c.prims[0]);
  /* primitivas 4, 5, 7, 20, 22 e 6 geram area */
  const d = GV.parse(MM + '%AMOUTRAS*\n4,1,3,0,0,1,0,1,1,0,0,0*\n%\n%AMPOLI*\n5,1,8,0,0,2,22.5*\n%\n%AMTERM*\n7,0,0,2,1.2,0.2,0*\n%\n' +
    '%AMVET*\n20,1,0.5,0,0,2,0,0*\n%\n%AMCANTO*\n22,1,2,1,0,0,0*\n%\n%AMMOIRE*\n6,0,0,2,0.2,0.2,2,0.05,2.4,0*\n%\n' +
    '%ADD30OUTRAS*%\n%ADD31POLI*%\n%ADD32TERM*%\n%ADD33VET*%\n%ADD34CANTO*%\n%ADD35MOIRE*%\nD30*X0Y0D03*\nD31*X0Y0D03*\nD32*X0Y0D03*\nD33*X0Y0D03*\nD34*X0Y0D03*\nD35*X0Y0D03*\nM02*', 'prims.gbr');
  assert.deepStrictEqual(d.avisos, []);
  const [o4, o5, o7, o20, o22, o6] = flashes(d).map(f => f.ap);
  perto(areaAb(o4), 0.5, 1e-9, 'contorno: triangulo retangulo de catetos 1');
  perto(areaAb(o5), 2 * Math.SQRT2 * 1, 1e-9, 'octogono de raio 1');
  const anel = Math.PI * (1 - 0.36);
  assert.ok(areaAb(o7) < anel && areaAb(o7) > anel - 4 * 0.2 * 0.4 - 0.05, 'termico = anel menos 4 vaos: ' + areaAb(o7));
  assert.strictEqual(GV.formasDe(o7).length, 4, 'termico em 4 fatias');
  perto(areaAb(o20), 1, 1e-9, 'linha vetor 2 x 0.5');
  perto(areaAb(o22), 2, 1e-9, 'linha canto 2 x 1');
  assert.strictEqual(GV.formasDe(o6).filter(f => f.t === 'anel').length, 2, 'moire: 2 aneis');
  const b22 = GV.caixaDe(flashes(d)[4]);
  assert.deepStrictEqual(b22, [0, 0, 2, 1], 'primitiva 22 ancora no canto inferior esquerdo');
}

/* ── regiao com arco, e com dois contornos ── */
{
  const c = GV.parse('%FSLAX45Y45*%\n%MOMM*%\nG75*\n%TA.AperFunction,Conductor*%\nG36*\nX0Y0D02*\nG01*\nX1000000Y0D01*\nG03*\nX0Y1000000I-1000000J0D01*\nG01*\nX0Y0D01*\nG37*\n' +
    'G36*\nX0Y0D02*\nX100000Y0D01*\nX100000Y100000D01*\nX0Y100000D01*\nX0Y0D01*\nX200000Y0D02*\nX300000Y0D01*\nX300000Y100000D01*\nX200000Y0D01*\nD02*\nG37*\nM02*', 'reg.gbr');
  assert.deepStrictEqual(c.avisos, []);
  assert.strictEqual(c.prims.length, 2);
  const r = c.prims[0];
  assert.strictEqual(r.k, 'region');
  assert.strictEqual(r.aperFunction, 'Conductor');
  assert.strictEqual(r.contornos.length, 1);
  perto(GV.areaComSinal(r.contornos[0]), Math.PI * 100 / 4, 0.05, 'quarto de circulo de raio 10 (achatado com corda de 2.5 um)');
  assert.deepStrictEqual(GV.caixaDe(r).map(v => Math.round(v * 1e6) / 1e6), [0, 0, 10, 10]);
  assert.strictEqual(c.prims[1].contornos.length, 2, 'D02 dentro da regiao abre outro contorno');
  assert.deepStrictEqual(c.prims[1].contornos.map(k => k.length), [4, 3], 'o ponto que fecha nao se repete');
  assert.ok(GV.objetoEm(c, 5, 1, 0) === r, 'ponto dentro do quarto de circulo');
  assert.strictEqual(GV.objetoEm(c, 9, 9, 0), null, 'fora do arco');
}

/* ── G74 (quadrante unico, I/J sem sinal) x G75 (multi, I/J com sinal); circulo cheio ── */
{
  const c = GV.parse(MM.replace('46Y46', '45Y45') + '%ADD10C,0.2*%\nD10*\n' +
    'G75*\nX0Y1000000D02*\nG02*\nX1000000Y0I0J-1000000D01*\n' +      /* horario, centro (0,0) */
    'G74*\nX1000000Y0D02*\nG03*\nX0Y1000000I1000000J0D01*\n' +       /* anti-horario: o centro ingenuo (20,0) daria errado */
    'G75*\nX0Y1000000D02*\nG02*\nX0Y-1000000I0J-1000000D01*\n' +      /* meia volta passando por (10,0) */
    'X1000000Y0D02*\nG03*\nX1000000Y0I-1000000J0D01*\n' +             /* inicio = fim em G75: circulo */
    'G74*\nX1000000Y0D02*\nX1000000Y0I1000000J0D01*\n' +              /* inicio = fim em G74: ponto */
    'M02*', 'arcos.gbr');
  assert.deepStrictEqual(c.avisos, []);
  const [a, b, d, e, z] = c.prims;
  assert.strictEqual(a.k, 'arc'); assert.strictEqual(a.cw, true);
  perto(a.cx, 0); perto(a.cy, 0);
  assert.strictEqual(b.cw, false);
  perto(b.cx, 0, 1e-9, 'G74 escolhe o quadrante que da <= 90 graus'); perto(b.cy, 0, 1e-9);
  const bd = GV.caixaDe(d);
  perto(bd[2], 10.1, 1e-9, 'a meia volta passa por x = 10'); perto(bd[1], -10.1, 1e-9);
  assert.strictEqual(e.circulo, true);
  assert.deepStrictEqual(GV.caixaDe(e).map(v => Math.round(v * 1e9) / 1e9), [-10.1, -10.1, 10.1, 10.1]);
  assert.strictEqual(z.k, 'line', 'em G74 inicio = fim nao e circulo');
  assert.strictEqual(z.x1, z.x2);
  /* arco sem G74/G75 declarado: avisa e decide pelo sinal */
  const s = GV.parse(MM + '%ADD10C,0.2*%\nD10*\nX0Y1000000D02*\nG02*\nX1000000Y0I0J-1000000D01*\nM02*', 'semquad.gbr');
  assert.strictEqual(s.avisos.length, 1);
  perto(s.prims[0].cy, 0);
}

/* ── polaridade: %LPC apaga ── */
{
  const c = GV.parse(MM + '%ADD10R,4X4*%\n%ADD11C,1*%\nD10*\nX0Y0D03*\n%LPC*%\nD11*\nX0Y0D03*\n%LPD*%\nX5000000Y0D03*\nM02*', 'lpc.gbr');
  assert.deepStrictEqual(c.prims.map(p => p.escuro), [true, false, true]);
  assert.strictEqual(GV.objetoEm(c, 0, 0, 0), null, 'no furo claro nao ha nada');
  assert.strictEqual(GV.objetoEm(c, 1.5, 0, 0), c.prims[0]);
  assert.strictEqual(GV.objetoEm(c, 5, 0, 0), c.prims[2]);
  assert.deepStrictEqual([c.bbox.x1, c.bbox.y1, c.bbox.x2, c.bbox.y2], [-2, -2, 5.5, 2], 'o claro nao entra na caixa');
}

/* ── %SR passo e repeticao ── */
{
  const c = GV.parse(MM + '%ADD10C,0.5*%\n%SRX3Y2I5.0J4.0*%\nD10*\nX0Y0D03*\nX1000000Y0D02*\nX2000000Y0D01*\n%SR*%\nX0Y-10000000D03*\nM02*', 'sr.gbr');
  assert.strictEqual(c.prims.length, 13);
  const pos = flashes(c).map(f => [f.x, f.y]);
  assert.deepStrictEqual(pos.slice(0, 6), [[0, 0], [5, 0], [10, 0], [0, 4], [5, 4], [10, 4]]);
  assert.deepStrictEqual(pos[6], [0, -10], 'depois do %SR* nada mais se repete');
  const l = linhas(c);
  assert.strictEqual(l.length, 6);
  assert.deepStrictEqual([l[5].x1, l[5].y1, l[5].x2, l[5].y2], [11, 4, 12, 4]);
}

/* ── coordenada e D modais, D01 sem coordenada, G54 ── */
{
  const c = GV.parse('%FSLAX24Y24*%\n%MOIN*%\n%ADD10C,0.01*%\n%ADD11R,0.02X0.04*%\nD10*\nX1000Y2000D02*\nX3000D01*\nY4000*\nD01*\nG54D11*\nX0Y0D03*\nM02*', 'modal.gbr');
  assert.deepStrictEqual(c.avisos, []);
  const l = linhas(c);
  assert.strictEqual(l.length, 3);
  perto(l[0].x1, 2.54); perto(l[0].y1, 5.08); perto(l[0].x2, 7.62); perto(l[0].y2, 5.08);
  perto(l[1].x1, 7.62); perto(l[1].y2, 10.16, 1e-9, 'Y sozinho com o D01 anterior');
  assert.ok(l[2].x1 === l[2].x2 && l[2].y1 === l[2].y2, 'D01 sem coordenada = traco de comprimento zero');
  assert.strictEqual(flashes(c)[0].ap.d, 11, 'G54D11 seleciona D11');
}

/* ── atributos X2: %TF, %TA, %TO, %TD e G04 #@! ── */
{
  const c = GV.parse('G04 #@! TF.FileFunction,Copper,L1,Top*\n%TF.GenerationSoftware,Teste,EletricHUB,1*%\n' + MM +
    '%TA.AperFunction,SMDPad,CuDef*%\n%ADD10R,1X0.5*%\n%TD*%\n%ADD12C,0.3*%\n%TA.AperFunction,Conductor*%\n%ADD11C,0.25*%\n' +
    '%TO.N,GND*%\n%TO.C,R1*%\nD10*\nX0Y0D03*\n%TD.N*%\nD11*\nX0Y0D02*\nX1000000Y0D01*\n%TD*%\nD12*\nX0Y0D03*\nM02*', 'attr.gbr');
  assert.deepStrictEqual(c.avisos, []);
  assert.strictEqual(c.funcao, 'Copper,L1,Top');
  assert.strictEqual(c.atributos.GenerationSoftware, 'Teste,EletricHUB,1');
  assert.strictEqual(c.prims[0].aperFunction, 'SMDPad,CuDef');
  assert.deepStrictEqual(c.prims[0].obj, { N: 'GND', C: 'R1' });
  assert.strictEqual(c.prims[1].aperFunction, 'Conductor');
  assert.deepStrictEqual(c.prims[1].obj, { C: 'R1' }, '%TD.N tira so a net');
  assert.strictEqual(c.prims[2].aperFunction, undefined, 'abertura definida depois do %TD nao tem funcao');
  assert.strictEqual(c.prims[2].obj, undefined);
  assert.strictEqual(GV.camadaDe('attr.gbr', c.funcao).chave, 'Top');
}

/* ── obsoletos: aceitos; os que mudam algo sao aplicados e avisam ── */
{
  const c = GV.parse('%FSLAX24Y24*%\n%MOIN*%\n%INteste*%\n%LNcamada*%\n%IPPOS*%\n%ASAXBY*%\n%MIA0B0*%\n%OFA0B0*%\n%SFA1.0B1.0*%\n%ADD10C,0.01*%\nD10*\nX10000Y0D03*\nM02*', 'obs.gbr');
  assert.deepStrictEqual(c.avisos, []);
  const d = GV.parse('%FSLAX24Y24*%\n%MOIN*%\n%OFA1.0B2.0*%\n%SFA2B1*%\n%ADD10C,0.01*%\nD10*\nX10000Y10000D03*\nM02*', 'obs2.gbr');
  perto(flashes(d)[0].x, (2 + 1) * 25.4, 1e-9, 'SF escala, depois OF desloca'); perto(flashes(d)[0].y, 3 * 25.4, 1e-9);
  assert.strictEqual(d.avisos.length, 2);
  const e = GV.parse('%FSLAX24Y24*%\n%MOIN*%\n%IPNEG*%\n%ADD10C,0.01*%\nD10*\nX0Y0D03*\nM02*', 'neg.gbr');
  assert.strictEqual(e.negativo, true);
  /* comando desconhecido e caractere estranho: avisam e seguem */
  const f = GV.parse(MM + '%XY123*%\n%ADD10C,0.1*%\nD10*\nQ5*\nX0Y0D03*\nD99*\nX0Y0D03*\nM02*\nX1Y1D03*', 'ruim.gbr');
  assert.strictEqual(f.prims.length, 2, 'depois do M02 nada e lido');
  assert.ok(f.avisos.some(a => /%XY/.test(a)));
  assert.ok(f.avisos.some(a => /D99/.test(a)));
  assert.strictEqual(f.prims[1].ap.indefinida, true);
  /* sem %FS e sem %MO: avisa e assume */
  const g = GV.parse('%ADD10C,0.01*%\nD10*\nX10000Y0D03*\nM02*', 'nada.gbr');
  assert.strictEqual(g.avisos.length, 2);
  perto(flashes(g)[0].x, 25.4);
}

/* ── %LM / %LR / %LS transformam o flash ── */
{
  const c = GV.parse(MM + '%ADD10R,2X1*%\nD10*\n%LR90*%\nX0Y0D03*\n%LR0*%\n%LS2*%\nX0Y0D03*\n%LS1*%\n%LMX*%\nX0Y0D03*\nM02*', 'lx.gbr');
  const [a, b, d] = flashes(c);
  assert.deepStrictEqual(GV.caixaDe(a).map(v => Math.round(v * 1e9) / 1e9), [-0.5, -1, 0.5, 1], 'girado 90');
  assert.deepStrictEqual(GV.caixaDe(b), [-2, -1, 2, 1], 'escala 2');
  assert.deepStrictEqual(GV.caixaDe(d), [-1, -0.5, 1, 0.5], 'espelho do retangulo e ele mesmo');
  assert.notStrictEqual(a.ap, b.ap, 'cada transformacao e uma variante da abertura');
}

/* ── Excellon ── */
{
  const c = GV.parseExcellon('M48\n; #@! TF.FileFunction,Plated,1,2,PTH\nMETRIC,TZ,000.000\nT1C0.800\nT2C1.000\n%\nT1\nX1500Y2500\nX3000\nT2\nX1.5Y1.0\nX1000Y1000G85X2000Y1000\nM30\n', 'placa.drl');
  assert.deepStrictEqual(c.avisos, []);
  assert.strictEqual(c.funcao, 'Plated,1,2,PTH');
  const f = flashes(c);
  assert.strictEqual(f.length, 3);
  perto(f[0].x, 1.5); perto(f[0].y, 2.5); perto(f[1].x, 3); perto(f[1].y, 2.5, 1e-12, 'Y modal');
  perto(f[0].ap.params[0], 0.8); perto(f[2].ap.params[0], 1.0);
  assert.strictEqual(f[2].ap.tipo, 'C');
  const s = linhas(c)[0];
  assert.deepStrictEqual([s.x1, s.y1, s.x2, s.y2], [1, 1, 2, 1], 'slot G85');
  perto(s.ap.params[0], 1.0);
  /* INCH,LZ: zeros a esquerda presentes, os da direita faltam (2.4) */
  const d = GV.parseExcellon('M48\nINCH,LZ\nT01C0.0350\n%\nT01\nX01Y015\nX-0005Y00025\nM30\n', 'pol.txt');
  assert.deepStrictEqual(d.avisos, []);
  perto(flashes(d)[0].x, 25.4); perto(flashes(d)[0].y, 1.5 * 25.4);
  perto(flashes(d)[1].x, -0.05 * 25.4, 1e-9); perto(flashes(d)[1].y, 0.025 * 25.4, 1e-9);
  perto(flashes(d)[0].ap.params[0], 0.035 * 25.4, 1e-12);
  /* INCH,TZ com formato do Altium */
  const e = GV.parseExcellon('M48\n;FILE_FORMAT=2:5\n;TYPE=NON_PLATED\nINCH,TZ\nT1F00S00C0.12500\n%\nT01\nX125000Y-250\nM30\n', 'np.txt');
  perto(flashes(e)[0].x, 1.25 * 25.4, 1e-9); perto(flashes(e)[0].y, -0.0025 * 25.4, 1e-9);
  assert.strictEqual(e.funcao, 'NonPlated,1,2,NPTH');
  assert.strictEqual(GV.camadaDe(e.nome, e.funcao).chave, 'DrillNPTH');
  /* fresagem: G00 move, M15 desce, G01 reta, G03 arco com I/J, M16 sobe, G05 volta a furar */
  const r = GV.parseExcellon('M48\nMETRIC\nT3C2.0\n%\nT3\nG00X10.0Y10.0\nM15\nG01X20.0Y10.0\nG03X20.0Y20.0I0.0J5.0\nM16\nG05\nX5.0Y5.0\nM30\n', 'rota.drl');
  assert.deepStrictEqual(r.prims.map(p => p.k), ['line', 'arc', 'flash']);
  const arco = r.prims[1];
  perto(arco.cx, 20); perto(arco.cy, 15); assert.strictEqual(arco.cw, false);
  /* raio A no lugar de I/J: o arco curto */
  const a = GV.parseExcellon('M48\nMETRIC\nT1C1.0\n%\nT1\nG00X0Y0\nM15\nG02X10.0Y0A5.0\nM16\nM30\n', 'raio.drl');
  perto(a.prims[0].cx, 5); perto(a.prims[0].cy, 0, 1e-9);
  /* a reexportacao do CAMtastic num Windows em pt-BR: G92 solto na linha 1 e diametro com virgula */
  const v = GV.parseExcellon('G92\nM48\nINCH,LZ\nFMAT,2\nT01C0,0315\nT02C0,0354\nDETECT,ON\n%\nT01\nX0361469Y0453\nX03695\nT02\nY04435\nM30\n', 'cam.drl');
  assert.deepStrictEqual(v.avisos, []);
  assert.deepStrictEqual(flashes(v).map(p => +(p.ap.params[0] / 25.4).toFixed(4)), [0.0315, 0.0315, 0.0354], 'diametro com virgula decimal');
  perto(flashes(v)[0].x, 3.61469 * 25.4, 1e-9, 'LZ com mais digitos que o formato'); perto(flashes(v)[1].y, 4.53 * 25.4, 1e-9);
  perto(flashes(v)[2].x, 3.695 * 25.4, 1e-9); perto(flashes(v)[2].y, 4.435 * 25.4, 1e-9);
  assert.strictEqual(GV.camadaDe('cam.rte').chave, 'Drill', '.rte do CAMtastic e furacao');
  /* o que nao entende vira aviso */
  const z = GV.parseExcellon('M48\nMETRIC\n%\nX1.0Y1.0\nM30\n', 'semT.drl');
  assert.ok(z.avisos.some(v => /ferramenta/.test(v)));
}

/* .zip montado no proprio teste: [{nome: Buffer, dados: Buffer, metodo: 0|8, utf8?}] */
const crc32 = b => {
  let crc = 0xffffffff;
  for (let n = 0; n < b.length; n++) { let c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
};
const abDe = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
const zip = entradas => {
  const partes = [], central = [];
  let off = 0;
  for (const e of entradas) {
    const comp = e.metodo === 8 ? zlib.deflateRawSync(e.dados) : e.dados;
    const fl = e.utf8 ? 0x800 : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(fl, 6); lh.writeUInt16LE(e.metodo, 8);
    lh.writeUInt32LE(crc32(e.dados), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(e.dados.length, 22);
    lh.writeUInt16LE(e.nome.length, 26);
    partes.push(lh, e.nome, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(fl, 8); ch.writeUInt16LE(e.metodo, 10);
    ch.writeUInt32LE(crc32(e.dados), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(e.dados.length, 24);
    ch.writeUInt16LE(e.nome.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, e.nome);
    off += 30 + e.nome.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(entradas.length, 8); fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(off, 16);
  return Buffer.concat(partes.concat([cd, fim]));
};
const GTL = '%FSLAX46Y46*%\n%MOMM*%\n%ADD10C,0.5*%\nD10*\nX0Y0D03*\nM02*\n';

/* ── lerZip: store e deflate, pasta ignorada, nome sem marca (CP850) e UTF-8, .zip dentro, binario ── */
{
  const gtl = GTL;
  const drl = 'M48\nMETRIC\nT1C0.8\n%\nT1\nX1.0Y1.0\nM30\n';
  const dentro = zip([{ nome: Buffer.from('in.gko'), dados: Buffer.from(gtl), metodo: 8 }]);
  const z = zip([
    { nome: Buffer.from('pasta/'), dados: Buffer.alloc(0), metodo: 0 },
    { nome: Buffer.from('pasta/placa.GTL'), dados: Buffer.from(gtl), metodo: 0 },
    { nome: Buffer.from([0x66, 0x75, 0x72, 0x61, 0x87, 0xa0, 0x6f, 0x2e, 0x64, 0x72, 0x6c]), dados: Buffer.from(drl), metodo: 8 },  /* 'furaçáo.drl' sem a marca (ç e á: os mesmos bytes na CP437 e na CP850) */
    { nome: Buffer.from('furação.gbr', 'utf8'), dados: Buffer.from(gtl.repeat(3)), metodo: 8, utf8: true },
    { nome: Buffer.from('foto.png'), dados: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), metodo: 0 },
    { nome: Buffer.from('outro.zip'), dados: dentro, metodo: 0 },
  ]);
  const ab = z.buffer.slice(z.byteOffset, z.byteOffset + z.length);
  const lidos = await GV.lerZip(ab);
  assert.deepStrictEqual(lidos.map(a => a.nome), ['pasta/placa.GTL', 'furaçáo.drl', 'furação.gbr', 'outro.zip/in.gko']);
  assert.strictEqual(lidos[0].texto, gtl);
  assert.strictEqual(lidos[1].texto, drl, 'deflate');
  assert.strictEqual(lidos[2].texto, gtl.repeat(3));
  assert.strictEqual(lidos[3].texto, gtl, '.zip dentro do .zip');
  assert.ok(lidos.avisos.some(a => /foto\.png/.test(a)), 'binario e pulado com aviso');
  await assert.rejects(() => GV.lerZip(new Uint8Array(100).buffer), /zip/);
  /* o conjunto lido do zip: GTL e DRL viram camadas; o que nao e Gerber fica de fora */
  const cj = GV.lerConjunto({ titulo: 'z', arquivos: lidos.concat([{ nome: 'leia-me.txt', texto: 'Gerber para a JLCPCB\n' }]) });
  assert.deepStrictEqual(cj.camadas.map(k => k.info.chave), ['Top', 'Drill', 'Other', 'KeepOut']);
  assert.deepStrictEqual(cj.ignorados, ['leia-me.txt']);
}

/* ── camadaDe: X2 pela funcao e os 4 esquemas de nome ── */
{
  const ch = (n, f) => GV.camadaDe(n, f).chave;
  /* X2 */
  assert.strictEqual(ch('a.gbr', 'Copper,L1,Top,Signal'), 'Top');
  assert.strictEqual(ch('a.gbr', 'Copper,L4,Bot,Signal'), 'Bottom');
  assert.strictEqual(ch('a.gbr', 'Copper,L2,Inr,Signal'), 'Mid1');
  assert.strictEqual(ch('a.gbr', 'Copper,L3,Inr,Plane'), 'Plane2');
  assert.strictEqual(ch('a.gbr', 'Soldermask,Bot'), 'BottomSolder');
  assert.strictEqual(ch('a.gbr', 'Legend,Top'), 'TopOverlay');
  assert.strictEqual(ch('a.gbr', 'Profile,NP'), 'Profile');
  assert.strictEqual(ch('a.gbr', 'Plated,1,2,PTH,Drill'), 'DrillPTH');
  assert.strictEqual(ch('a.gbr', 'NonPlated,1,2,NPTH,Drill'), 'DrillNPTH');
  assert.strictEqual(ch('PCB_Mechanical_13.gbr', 'Other,Mechanical_13'), 'Mech13', 'o X2 do Altium poe a mecanica em Other');
  assert.strictEqual(ch('PCB_Drawing_1.gbr', 'Drawing'), 'Drawing');
  assert.strictEqual(ch('a.gbr', 'Other,Qualquer coisa'), 'Other');
  /* Altium X2 (o conjunto que vai para a JLCPCB) */
  const alt = { Copper_Signal_Top: 'Top', Copper_Signal_Bot: 'Bottom', Pads_Top: 'PadsTop', Pads_Bot: 'PadsBottom', Legend_Top: 'TopOverlay',
    Legend_Bot: 'BottomOverlay', Soldermask_Top: 'TopSolder', Soldermask_Bot: 'BottomSolder', Paste_Top: 'TopPaste', Paste_Bot: 'BottomPaste',
    Profile: 'Profile', PTH_Drill: 'DrillPTH', NPTH_Drill: 'DrillNPTH' };
  for (const k of Object.keys(alt)) {
    assert.strictEqual(ch('PDMB - DI000000_P2_' + k + '.gbr'), alt[k], k);
    assert.strictEqual(ch(('pdmb_-_di000000_p2_' + k + '.gbr').toLowerCase()), alt[k], 'CAMtastic ' + k);
  }
  /* Protel */
  const pro = { GTL: 'Top', GBL: 'Bottom', GTO: 'TopOverlay', GBO: 'BottomOverlay', GTS: 'TopSolder', GBS: 'BottomSolder', GTP: 'TopPaste',
    GBP: 'BottomPaste', GKO: 'KeepOut', GM1: 'Mech1', GM13: 'Mech13', GD1: 'DrillDrawing', GG1: 'DrillGuide', G1: 'Mid1', GP2: 'Plane2', TXT: 'Drill', DRL: 'Drill' };
  for (const k of Object.keys(pro)) assert.strictEqual(ch('placa.' + k), pro[k], k);
  assert.strictEqual(ch('placa-Plated.TXT'), 'DrillPTH');
  assert.strictEqual(ch('placa-NonPlated.TXT'), 'DrillNPTH');
  /* KiCad */
  const ki = { F_Cu: 'Top', B_Cu: 'Bottom', In1_Cu: 'Mid1', F_Silkscreen: 'TopOverlay', B_SilkS: 'BottomOverlay', F_Mask: 'TopSolder',
    B_Mask: 'BottomSolder', F_Paste: 'TopPaste', B_Paste: 'BottomPaste', Edge_Cuts: 'Profile' };
  for (const k of Object.keys(ki)) assert.strictEqual(ch('projeto-' + k + '.gbr'), ki[k], k);
  assert.strictEqual(ch('projeto-PTH.drl'), 'DrillPTH');
  assert.strictEqual(ch('projeto-NPTH.drl'), 'DrillNPTH');
  /* Eagle */
  assert.strictEqual(ch('placa.cmp'), 'Top'); assert.strictEqual(ch('placa.sol'), 'Bottom'); assert.strictEqual(ch('placa.plc'), 'TopOverlay');
  assert.strictEqual(ch('placa.stc'), 'TopSolder'); assert.strictEqual(ch('placa.crc'), 'TopPaste'); assert.strictEqual(ch('placa.dim'), 'Profile');
  assert.strictEqual(ch('nada.gbr'), 'Other');
  /* cores do Altium (contrato 1b: as medidas no G04 Layer_Color) e ordem de pintura: baixo
     primeiro, perfil e furos por ultimo */
  const cor = (n, f) => GV.camadaDe(n, f).cor;
  assert.strictEqual(cor('x.GTL'), '#ff0000'); assert.strictEqual(cor('x.GBL'), '#0000ff');
  assert.strictEqual(cor('x.GTO'), '#ffff00'); assert.strictEqual(cor('x.GBO'), '#808000');
  assert.strictEqual(cor('x.GTS'), '#800080'); assert.strictEqual(cor('x.GBS'), '#ff00ff');
  assert.strictEqual(cor('x.GTP'), '#808080'); assert.strictEqual(cor('x.GBP'), '#800000');
  assert.strictEqual(cor('x_Pads_Top.gbr'), '#c0c0c0'); assert.strictEqual(cor('x_Profile.gbr'), '#e0e0e0');
  assert.strictEqual(cor('x_PTH_Drill.gbr'), '#ffffff'); assert.strictEqual(cor('x_NPTH_Drill.gbr'), '#00e5ff');
  const ordem = ['x.GBO', 'x.GBS', 'x.GBL', 'x.GTL', 'x.GTS', 'x.GTO', 'x_Profile.gbr', 'x_PTH_Drill.gbr'].map(n => GV.camadaDe(n).ordem);
  assert.deepStrictEqual(ordem.slice().sort((a, b) => a - b), ordem);
  assert.strictEqual(GV.camadaDe('x.GTL').lado, 'top'); assert.strictEqual(GV.camadaDe('x.GBS').lado, 'bottom');
  assert.strictEqual(GV.camadaDe('x_Profile.gbr').lado, null);
  assert.deepStrictEqual(['x.GTL', 'x_Pads_Top.gbr', 'x.GTO', 'x.GTS', 'x.GTP', 'x_Profile.gbr', 'x.TXT', 'x.GM1', 'nada.gbr'].map(n => GV.camadaDe(n).tipo),
    ['cobre', 'pads', 'legenda', 'mascara', 'pasta', 'perfil', 'furo', 'mecanica', 'outro']);
}

/* ── tipo de arquivo e contorno da placa ── */
{
  assert.strictEqual(GV.tipoDeArquivo('a.gbr', MM + 'M02*'), 'gerber');
  assert.strictEqual(GV.tipoDeArquivo('a.txt', 'M48\nINCH\nT1C0.03\n%\nT1\nX01Y01\nM30'), 'excellon');
  assert.strictEqual(GV.tipoDeArquivo('a.apr', 'D10   RECTANGULAR   32.283   16.142'), null);
  assert.strictEqual(GV.tipoDeArquivo('m.APR_LIB', '%AMROUNDEDRECTD17*\n21,1,2,0,0,0,270.0*\n%\n'), null, 'biblioteca de macros do Altium nao e camada');
  /* quadrado de 10 mm em 4 tracos fora de ordem + um furo de fixacao como regiao */
  const c = GV.parse(MM + '%ADD10C,0.1*%\nD10*\nX10000000Y0D02*\nX10000000Y10000000D01*\nX0Y0D02*\nX10000000Y0D01*\nX0Y10000000D02*\nX0Y0D01*\nX10000000Y10000000D02*\nX0Y10000000D01*\n' +
    'G36*\nX5000000Y5000000D02*\nX6000000Y5000000D01*\nX6000000Y6000000D01*\nX5000000Y5000000D01*\nG37*\nM02*', 'perfil.gbr');
  const pl = GV.contornoDaPlaca(c);
  assert.strictEqual(pl.lacos.length, 1);
  perto(Math.abs(GV.areaComSinal(pl.lacos[0])), 100, 1e-9);
  assert.strictEqual(pl.recortes.length, 1);
  assert.strictEqual(pl.abertos, 0);
}

/* ══════════════ regressoes do testador adversarial (2026-10-02), um bloco por defeito ══════════════ */

/* ── 1. a camada sai do SUFIXO do nome; palavra no nome do PROJETO nao decide nada ── */
{
  const ch = n => GV.camadaDe(n).chave;
  /* o perfil do pacote real da ISS ("LT1021-7 SMD_TO_PTH") virava furacao PTH e era pintado como furo */
  assert.strictEqual(ch('lt1201-7-smd_to_pth_profile.gbr'), 'Profile');
  assert.strictEqual(ch('adaptador-plated_profile.gbr'), 'Profile');
  assert.strictEqual(ch('placa-pth_Mechanical_13.gbr'), 'Mech13');
  assert.strictEqual(ch('placa_pth_mechanical_1.gbr'), 'Mech1');
  assert.strictEqual(ch('outline_sensor_mechanical_1.gbr'), 'Mech1');
  assert.strictEqual(ch('outline_sensor_keep-out.gbr'), 'KeepOut');
  assert.strictEqual(ch('mech2_keep-out.gbr'), 'KeepOut');
  assert.strictEqual(ch('DEPTH_SENSOR.TXT'), 'Drill', 'DEPTH nao e PTH');
  /* a pasta FABRICACAO da ISS inteira: um PTH so, e o perfil e perfil */
  const iss = ['copper_signal_bot.gbr', 'copper_signal_top.gbr', 'legend_bot.gbo', 'legend_top.gto', 'paste_top.gbr', 'profile.gbr', 'pth_drill.gbr', 'soldermask_bot.gbr', 'soldermask_top.gbr'];
  assert.deepStrictEqual(iss.map(s => ch('lt1201-7-smd_to_pth_' + s)), ['Bottom', 'Top', 'BottomOverlay', 'TopOverlay', 'TopPaste', 'Profile', 'DrillPTH', 'BottomSolder', 'TopSolder']);
  /* o sufixo de verdade continua valendo */
  assert.strictEqual(ch('x_PTH_Drill.gbr'), 'DrillPTH'); assert.strictEqual(ch('x_NPTH_Drill.gbr'), 'DrillNPTH');
  assert.strictEqual(ch('lt1201-7-smd_to_pth_npth_drill.gbr'), 'DrillNPTH');
  /* interna do CAMtastic (sem %TF): no X2 do Altium _1 e o Copper,L2 e _2 o L3 = Mid1 e Mid2 (antes, as duas Mid1) */
  assert.strictEqual(ch('pcb_-_di241785_copper_signal_1.gbr'), 'Mid1');
  assert.strictEqual(ch('pcb_-_di241785_copper_signal_2.gbr'), 'Mid2');
  assert.strictEqual(ch('x_Copper_Signal_L3.gbr'), 'Mid2', 'com o L, e a camada fisica');
  /* sufixos que antes so casavam por acaso, no meio do nome */
  assert.strictEqual(ch('PCB1-BoardEdgeRout.TXT'), 'BoardEdgeRout', 'fresagem do contorno do Altium: nem perfil nem furo');
  assert.strictEqual(ch('PCB1-RoundHoles.TXT'), 'Drill');
  assert.strictEqual(ch('proj-PTH-drl_map.gbr'), 'DrillDrawing', 'mapa de furos do KiCad');
  assert.strictEqual(ch('PCB_Drillmap_1.gbr'), 'DrillDrawing');
  assert.strictEqual(ch('x_Profile (1).gbr'), 'Profile', 'copia baixada de novo pelo navegador');
}

/* ── 2. contagem que vem do arquivo tem teto, com aviso (antes: a aba morria sem memoria) ── */
{
  const M45 = '%FSLAX45Y45*%\n%MOMM*%\n';
  const flash = (def, nome) => GV.parse(M45 + def + 'D10*\nX0Y0D03*\nM02*\n', nome);
  /* P com 1e7 vertices: a spec vai de 3 a 12 */
  let c = flash('%ADD10P,1X10000000*%\n', 'p.gbr');
  assert.strictEqual(c.prims[0].ap.params[1], 12);
  assert.strictEqual(GV.formasDe(c.prims[0].ap)[0].pts.length, 12);
  assert.ok(c.avisos.some(a => /3 a 12/.test(a)), c.avisos.join(' | '));
  c = flash('%ADD10P,1X1e999*%\n', 'pinf.gbr');
  assert.ok(GV.formasDe(c.prims[0].ap)[0].pts.length <= 12 && c.avisos.length >= 1);
  /* primitiva 5 com 1e9 vertices */
  c = flash('%AMA*\n5,1,1000000000,0,0,1,0*\n%\n%ADD10A*%\n', 'm5.gbr');
  assert.strictEqual(GV.formasDe(c.prims[0].ap)[0].pts.length, 12);
  assert.ok(c.avisos.some(a => /polígono \(5\)/.test(a)), c.avisos.join(' | '));
  /* primitiva 4 que declara 3e8 vertices e traz 3: usa os que vieram */
  c = flash('%AMA*\n4,1,300000000,0,0,1,0,0,1,0,0,0*\n%\n%ADD10A*%\n', 'm4.gbr');
  assert.strictEqual(c.prims[0].ap.macro[0].mods[1], 3);
  perto(areaAb(c.prims[0].ap), 0.5, 1e-9, 'o triangulo que veio');
  assert.ok(c.avisos.some(a => /contorno \(4\)/.test(a)), c.avisos.join(' | '));
  /* moire: vao negativo (o raio nunca diminuia) e espessura de 1e-9 (1e8 aneis) */
  c = flash('%AMA*\n6,0,0,2,0.1,-0.1,1000000000,0,0,0*\n%\n%ADD10A*%\n', 'm6.gbr');
  const an = GV.formasDe(c.prims[0].ap).filter(f => f.t === 'anel').length;
  assert.ok(an >= 1 && an <= 100, 'aneis: ' + an);
  assert.ok(c.avisos.some(a => /vão negativo/.test(a)), c.avisos.join(' | '));
  c = flash('%AMA*\n6,0,0,2,0.000000001,0,100000000,0,0,0*\n%\n%ADD10A*%\n', 'm6b.gbr');
  assert.strictEqual(GV.formasDe(c.prims[0].ap).filter(f => f.t === 'anel').length, 100);
  assert.ok(c.avisos.some(a => /anéis/.test(a)), c.avisos.join(' | '));
  /* %SR de 100000 x 100000 (1e10 copias): corta em 1 milhao de objetos */
  c = GV.parse(M45 + '%ADD10C,0.1*%\nD10*\n%SRX100000Y100000I1J1*%\nX0Y0D03*\n%SR*%\nM02*\n', 'sr.gbr');
  assert.strictEqual(c.prims.length, 1000000);
  assert.ok(c.avisos.some(a => /passo e repetição/.test(a)), c.avisos.join(' | '));
  /* R999999999 do Excellon */
  c = GV.parseExcellon('M48\nMETRIC\nT1C1.0\n%\nT1\nX1.0Y1.0\nR999999999X0.1Y0\nM30\n', 'r.drl');
  assert.strictEqual(c.prims.length, 1000000);
  assert.ok(c.avisos.some(a => /repetição/.test(a)), c.avisos.join(' | '));
  /* formato de digitos absurdo no Excellon (pedia uma string de 500 MB) */
  c = GV.parseExcellon('M48\n;FILE_FORMAT=500000000:0\nINCH,LZ\nT1C0.03\n%\nT1\nX01Y01\nM30\n', 'fmt.drl');
  assert.ok(c.avisos.some(a => /formato/.test(a)), c.avisos.join(' | '));
  assert.strictEqual(c.prims.length, 1);
  /* .zip-bomba (limite do descompactado; aqui pequeno) e .zip dentro de .zip demais */
  const grande = zip([{ nome: Buffer.from('grande.gbr'), dados: Buffer.alloc(5000, 0x41), metodo: 8 }, { nome: Buffer.from('cru.gbr'), dados: Buffer.alloc(5000, 0x41), metodo: 0 }]);
  const lg = await GV.lerZip(abDe(grande), { limite: 1000 });
  assert.strictEqual(lg.length, 0);
  assert.ok(lg.avisos.some(a => /grande\.gbr/.test(a) && /1000 bytes/.test(a)) && lg.avisos.some(a => /cru\.gbr/.test(a)), lg.avisos.join(' | '));
  let z = zip([{ nome: Buffer.from('in.gtl'), dados: Buffer.from(GTL), metodo: 0 }]);
  for (let k = 0; k < 6; k++) z = zip([{ nome: Buffer.from('n' + k + '.zip'), dados: z, metodo: 0 }]);
  const lz = await GV.lerZip(abDe(z));
  assert.strictEqual(lz.length, 0);
  assert.ok(lz.avisos.some(a => /níveis/.test(a)), lz.avisos.join(' | '));
}

/* ── 3. modo realista: contorno com segmento repetido, galho e perfil aberto ── */
{
  const q = (x1, y1, x2, y2) => 'X' + x1 * 1e5 + 'Y' + y1 * 1e5 + 'D02*\nX' + x2 * 1e5 + 'Y' + y2 * 1e5 + 'D01*\n';
  const base = '%FSLAX45Y45*%\n%MOMM*%\n%ADD10C,0.1*%\nD10*\nG01*\n';
  const furo = 'G36*\nX400000Y400000D02*\nX600000Y400000D01*\nX600000Y600000D01*\nX400000Y400000D01*\nG37*\n';
  const quadrado = q(0, 0, 10, 0) + q(10, 0, 10, 10) + q(10, 10, 0, 10) + q(0, 10, 0, 0);
  const perfil = txt => GV.parse(base + txt + 'M02*\n', 'x_Profile.gbr');
  /* um lado repetido ao contrario, logo no comeco (o caso montado no DMB): antes, 0 lacos */
  let pl = GV.contornoDaPlaca(perfil(q(10, 0, 0, 0) + quadrado + furo));
  assert.strictEqual(pl.lacos.length, 1);
  perto(Math.abs(GV.areaComSinal(pl.lacos[0])), 100, 1e-9);
  assert.strictEqual(pl.abertos, 0);
  /* cota saindo do vertice do meio do lado de baixo */
  pl = GV.contornoDaPlaca(perfil(q(0, 0, 5, 0) + q(5, 0, 5, -3) + q(5, 0, 10, 0) + q(10, 0, 10, 10) + q(10, 10, 0, 10) + q(0, 10, 0, 0)));
  assert.strictEqual(pl.lacos.length, 1);
  perto(Math.abs(GV.areaComSinal(pl.lacos[0])), 100, 1e-9);
  assert.strictEqual(pl.abertos, 1, 'a cota e o trecho aberto');
  /* placaDoConjunto: o perfil fecha -> a placa e o laco, a regiao e recorte */
  const conj = arqs => GV.lerConjunto({ arquivos: arqs }).camadas;
  let pc = GV.placaDoConjunto(conj([{ nome: 'x_Profile.gbr', texto: base + q(10, 0, 0, 0) + quadrado + furo + 'M02*\n' }]));
  assert.strictEqual(pc.como, 'contorno');
  assert.strictEqual(pc.lacos.length, 1); assert.strictEqual(pc.recortes.length, 1); assert.strictEqual(pc.aviso, undefined);
  /* perfil ABERTO (falta um lado) com o furo de fixacao como regiao: antes a regiao virava a placa
     e, apagada pela furacao, a placa sumia. Agora: o casco do contorno, o furo como recorte, e aviso */
  pc = GV.placaDoConjunto(conj([{ nome: 'x_Profile.gbr', texto: base + q(0, 0, 10, 0) + q(10, 0, 10, 10) + q(10, 10, 0, 10) + furo + 'M02*\n' }]));
  assert.strictEqual(pc.como, 'casco');
  perto(Math.abs(GV.areaComSinal(pc.lacos[0])), 100, 1e-9, 'o casco do contorno aberto');
  assert.strictEqual(pc.recortes.length, 1, 'o furo continua recorte');
  assert.ok(/não fecha/.test(pc.aviso), pc.aviso);
  /* perfil so de regioes (o contorno exportado como regiao): ai sim a regiao e a placa */
  pc = GV.placaDoConjunto(conj([{ nome: 'x_Profile.gbr', texto: base + 'G36*\nX0Y0D02*\nX1000000Y0D01*\nX1000000Y1000000D01*\nX0Y1000000D01*\nX0Y0D01*\nG37*\nM02*\n' }]));
  assert.strictEqual(pc.como, 'regioes'); assert.strictEqual(pc.lacos.length, 1);
  /* perfil aberto cede ao Keep-Out que fecha */
  pc = GV.placaDoConjunto(conj([{ nome: 'x_Profile.gbr', texto: base + q(0, 0, 10, 0) + 'M02*\n' }, { nome: 'x.GKO', texto: base + quadrado + 'M02*\n' }]));
  assert.strictEqual(pc.como, 'contorno'); assert.strictEqual(pc.camada.info.chave, 'KeepOut');
  assert.strictEqual(GV.placaDoConjunto([]).como, null, 'sem camada de contorno: a tela usa a caixa');
}

/* ── 4. '%' dentro de um G04 nao descarrila o arquivo ── */
{
  const corpo = '%FSLAX45Y45*%\n%MOMM*%\n%ADD10C,0.5*%\nD10*\nX1000000Y1000000D03*\nM02*\n';
  let c = GV.parse('G04 escala 100% *\n' + corpo, 'g04.gbr');
  assert.deepStrictEqual(c.avisos, []);
  assert.strictEqual(flashes(c).length, 1); perto(flashes(c)[0].x, 10);
  /* no meio do arquivo, depois do %MO */
  c = GV.parse('%FSLAX45Y45*%\n%MOMM*%\nG04 50% de cobre*\n%ADD10C,0.5*%\nD10*\nX1000000Y1000000D03*\nM02*\n', 'g04b.gbr');
  assert.deepStrictEqual(c.avisos, []); assert.strictEqual(flashes(c).length, 1);
  /* comentario que embrulha um comando: ele inteiro e comentario, a D99 nao existe */
  c = GV.parse('%FSLAX45Y45*%\n%MOMM*%\nG04 %ADD99C,5*%*\n%ADD10C,0.5*%\nD10*\nX1000000Y1000000D03*\nM02*\n', 'g04c.gbr');
  assert.deepStrictEqual(c.avisos, []); assert.strictEqual(flashes(c).length, 1); assert.strictEqual(flashes(c)[0].ap.d, 10);
  /* atributo X2 com '%' no valor chega inteiro */
  c = GV.parse('G04 #@! TF.ProjectId,Placa 100%,abc,1*\n' + corpo, 'g04d.gbr');
  assert.strictEqual(c.atributos.ProjectId, 'Placa 100%,abc,1');
  /* o G04 que perdeu o '*' (o '%' abre a linha de baixo) continua como antes: so ele se perde */
  c = GV.parse('G04 sem estrela\n' + corpo, 'g04e.gbr');
  assert.strictEqual(flashes(c).length, 1); assert.strictEqual(c.avisos.length, 1);
}

/* ── 5. o .GML do Altium e a Multi-Layer (pads passantes), nao o perfil ── */
{
  /* o cabecalho do PCB1.GML real (TTCA, Altium 21.1.1): 106 flashes e nenhum traco */
  const gml = 'G04*\nG04 #@! TF.GenerationSoftware,Altium Limited,Altium Designer,21.1.1 (26)*\nG04*\nG04 Layer_Color=12632256*\n%FSLAX25Y25*%\n%MOIN*%\nG70*\nG01*\nG75*\n' +
    '%ADD78C,0.05634*%\nD78*\nX15748Y15748D02*\nD03*\nY25748D02*\nD03*\nM02*\n';
  const c = GV.parse(gml, 'PCB1.GML');
  assert.deepStrictEqual(c.avisos, []);
  assert.strictEqual(c.corAltium, '#c0c0c0', 'G04 Layer_Color (BGR) lido');
  const info = GV.camadaDe('PCB1.GML', c.funcao, c);
  assert.strictEqual(info.chave, 'Multi'); assert.strictEqual(info.tipo, 'multi'); assert.strictEqual(info.cor, '#c0c0c0');
  /* so com o Layer_Color (sem o TF.GenerationSoftware) tambem e do Altium */
  const so = GV.parse(gml.replace(/G04 #@! TF\.GenerationSoftware[^\n]*\n/, ''), 'PCB1.GML');
  assert.strictEqual(GV.camadaDe('PCB1.GML', so.funcao, so).chave, 'Multi');
  /* o .GML do Eagle (sem marca do Altium) continua o contorno */
  assert.strictEqual(GV.camadaDe('placa.GML').chave, 'Profile');
  const eagle = GV.parse('%FSLAX24Y24*%\n%MOIN*%\n%ADD10C,0.01*%\nD10*\nX0Y0D02*\nX10000Y0D01*\nM02*\n', 'placa.gml');
  assert.strictEqual(GV.camadaDe('placa.gml', eagle.funcao, eagle).chave, 'Profile');
  /* pelo conjunto, como a tela le */
  assert.strictEqual(GV.lerConjunto({ arquivos: [{ nome: 'PCB1.GML', texto: gml }] }).camadas[0].info.chave, 'Multi');
  /* e camada so de flashes nunca e o contorno do realista, mesmo chamada de perfil */
  assert.strictEqual(GV.placaDoConjunto([{ arquivo: 'x_Profile.gbr', cam: c, info: GV.camadaDe('x_Profile.gbr') }]).como, null);
}

/* ── 6. furo maior que a abertura so tira da PROPRIA abertura (pintura = hit-test) ── */
{
  const c = GV.parse(MM + '%ADD10C,1X1.5*%\n%ADD11R,2X1X1.2*%\n%ADD12C,1X0.4*%\nD10*\nX0Y0D03*\nD11*\nX5000000Y0D03*\nD12*\nX10000000Y0D03*\nM02*\n', 'furo.gbr');
  assert.strictEqual(c.avisos.filter(a => /furo maior/.test(a)).length, 2, c.avisos.join(' | '));
  const [fc, fr, fok] = flashes(c);
  /* C 1 com furo 1.5: o furo engole a abertura - nada fica escuro, nem fora dela (antes: um anel por fora) */
  assert.deepStrictEqual(GV.formasDe(fc.ap), []);
  assert.strictEqual(GV.objetoEm(c, 0.65, 0, 0), null);
  /* R 2x1 com furo 1.2: so o pedaco do furo que cai dentro do retangulo (antes: duas "orelhas" pintadas) */
  const fs = GV.formasDe(fr.ap);
  assert.strictEqual(fs.length, 2);
  assert.ok(fs[1].furo && fs[1].pts.every(p => Math.abs(p[0]) <= 1 + 1e-9 && Math.abs(p[1]) <= 0.5 + 1e-9), 'nenhum ponto do furo fora do retangulo');
  /* area escura = retangulo menos a parte do circulo de raio 0.6 dentro dele */
  let dentro = 0;
  for (let i = 0, n = 20000; i < n; i++) { const x = -0.6 + 1.2 * (i + 0.5) / n; dentro += Math.min(2 * Math.sqrt(0.36 - x * x), 1) * 1.2 / n; }
  perto(areaAb(fr.ap), 2 - dentro, 0.01, 'retangulo menos o pedaco do furo');
  assert.strictEqual(GV.objetoEm(c, 5, 0.58, 0), null, 'fora do R e dentro do furo: vazio');
  assert.strictEqual(GV.objetoEm(c, 5, 0, 0), null, 'no furo: vazio');
  assert.strictEqual(GV.objetoEm(c, 5.9, 0.3, 0), fr, 'no R, fora do furo: escuro');
  /* furo que cabe: o mesmo de sempre, circulo exato e sem aviso */
  assert.deepStrictEqual(GV.formasDe(fok.ap).map(f => f.t), ['circ', 'circ']);
  assert.ok(GV.formasDe(fok.ap)[1].furo);
}

/* ── 7. nome dentro do .zip sem a marca UTF-8: UTF-8 estrito, senao CP850 (Windows pt-BR) ── */
{
  const em850 = s => Buffer.from(Array.from(s, ch => ({ 'Ç': 0x80, 'ç': 0x87, 'ã': 0xc6, 'Ã': 0xc7, 'õ': 0xe4, 'Õ': 0xe5, 'é': 0x82, 'Á': 0xb5 })[ch] || ch.charCodeAt(0)));
  const z = zip([
    { nome: em850('FABRICAÇÃO/placa_ção.gbr'), dados: Buffer.from(GTL), metodo: 0 },            /* o que o Explorer e o 7-Zip gravam */
    { nome: Buffer.from('Tomada Padrão 10A.gtl', 'utf8'), dados: Buffer.from(GTL), metodo: 0 },  /* UTF-8 sem marcar */
    { nome: Buffer.from('LIGAÇÕES.gbr', 'utf8'), dados: Buffer.from(GTL), metodo: 0, utf8: true },
  ]);
  const l = await GV.lerZip(abDe(z));
  assert.deepStrictEqual(l.map(a => a.nome), ['FABRICAÇÃO/placa_ção.gbr', 'Tomada Padrão 10A.gtl', 'LIGAÇÕES.gbr']);
}

/* ── 8. .zip so com o .rar da FABRICACAO: diz o que fazer (antes, nenhum retorno) ── */
{
  const rar = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00, 0, 0, 0, 0, 1, 2, 3]);
  const z = zip([{ nome: Buffer.from('FABRICAÇÃO/PDMB - DI231765_P2_C.rar', 'utf8'), dados: rar, metodo: 0, utf8: true }]);
  const l = await GV.lerZip(abDe(z));
  assert.strictEqual(l.length, 0);
  assert.ok(l.avisos.some(a => /PDMB - DI231765_P2_C\.rar/.test(a) && /RAR/.test(a) && /Extraia/.test(a)), l.avisos.join(' | '));
  /* o texto que a tela mostra quando nao sobra camada nenhuma traz o porque */
  const msg = GV.semCamadas('fabricacao', [], l.avisos);
  assert.ok(/Nenhum Gerber ou Excellon em “fabricacao”/.test(msg) && /PDMB - DI231765_P2_C\.rar/.test(msg), msg);
  assert.ok(/1 arquivo\(s\) ignorado\(s\)/.test(GV.semCamadas('texto', ['leia-me.txt'], [])));
}

/* ── 9. cores = contrato 1b = a tabela da vista PCB (HubCore.PCB_LAYERS) ── */
{
  const HC = require('../hub-core.js');
  const B1 = { Top: '#ff0000', Bottom: '#0000ff', Mid1: '#bc8e00', Mid2: '#70dbfa', TopOverlay: '#ffff00', BottomOverlay: '#808000',
    TopPaste: '#808080', BottomPaste: '#800000', TopSolder: '#800080', BottomSolder: '#ff00ff', DrillGuide: '#800000', KeepOut: '#ff00ff',
    DrillDrawing: '#ff002a', Mech1: '#ff00ff', Mech13: '#ff00ff', Mech15: '#008000', Multi: '#c0c0c0' };
  const amostra = { Top: ['x.GTL'], Bottom: ['x.GBL'], Mid1: ['x.gbr', 'Copper,L2,Inr,Signal'], Mid2: ['x.gbr', 'Copper,L3,Inr,Signal'],
    TopOverlay: ['x.GTO'], BottomOverlay: ['x.GBO'], TopPaste: ['x.GTP'], BottomPaste: ['x.GBP'], TopSolder: ['x.GTS'], BottomSolder: ['x.GBS'],
    DrillGuide: ['x.GG1'], KeepOut: ['x.GKO'], DrillDrawing: ['x.GD1'], Mech1: ['x.GM1'], Mech13: ['x.GM13'], Mech15: ['x.GM15'] };
  for (const k of Object.keys(amostra)) {
    const info = GV.camadaDe(amostra[k][0], amostra[k][1]);
    assert.strictEqual(info.chave, k);
    assert.strictEqual(info.cor.toLowerCase(), B1[k], k + ': cor do contrato 1b');
    assert.strictEqual(info.cor, HC.pcbLayer(k).color, k + ': a mesma da vista PCB');
  }
  /* a copia (vale sem o hub-core carregado) e a tabela do hub-core, inclusive Mid/Plane/Mech sem medida */
  for (const k of Object.keys(B1)) assert.strictEqual(GV.corPadrao(k), B1[k], k);
  for (const k of ['Mid3', 'Mid4', 'Mid7', 'Mid30', 'Plane1', 'Plane2', 'Plane16', 'Mech2', 'Mech3', 'Mech14', 'Mech16'])
    assert.strictEqual(GV.corPadrao(k), HC.pcbLayer(k).color, k);
  assert.strictEqual(GV.camadaDe('x.G3').cor, HC.pcbLayer('Mid3').color);
  assert.strictEqual(GV.camadaDe('x.GP1').cor, HC.pcbLayer('Plane1').color);
  assert.strictEqual(GV.camadaDe('x.GM3').cor, HC.pcbLayer('Mech3').color);
}

/* ── 10. coordenada que nao e numero avisa e mantem a anterior; parametro fora da spec avisa ── */
{
  const c = GV.parse('%FSLAX45Y45*%\n%MOMM*%\n%ADD10C,0.5*%\nD10*\nX100000Y100000D03*\nX.Y200000D03*\nY300000D03*\nM02*\n', 'nan.gbr');
  assert.deepStrictEqual(flashes(c).map(p => [p.x, p.y]), [[1, 1], [1, 2], [1, 3]], 'o X invalido nao vira NaN modal');
  assert.ok(c.avisos.some(a => /coordenada X inválida/.test(a)), c.avisos.join(' | '));
  assert.ok(c.bbox && isFinite(c.bbox.x1) && c.bbox.y2 > 3);
  const e = GV.parseExcellon('M48\nMETRIC\nT1C1.0\n%\nT1\nX1.0Y1.0\nX.Y2.0\nY3.0\nX-Y4.0\nM30\n', 'nan.drl');
  assert.deepStrictEqual(flashes(e).map(p => [p.x, p.y]), [[1, 1], [1, 2], [1, 3], [1, 4]]);
  assert.ok(e.avisos.some(a => /inválido/.test(a)), e.avisos.join(' | '));
  /* parametro fora da spec, que passava calado */
  let d = GV.parse(MM + '%ADD10P,1X13*%\nD10*\nX0Y0D03*\nM02*\n', 'p13.gbr');
  assert.ok(d.avisos.some(a => /13 vértices/.test(a)), d.avisos.join(' | '));
  assert.strictEqual(GV.formasDe(flashes(d)[0].ap)[0].pts.length, 12);
  d = GV.parse(MM + '%ADD10C,1e999*%\nD10*\nX0Y0D03*\nM02*\n', 'cinf.gbr');
  assert.ok(d.avisos.some(a => /número finito/.test(a)), d.avisos.join(' | '));
  d = GV.parse(MM + '%ADD10C,-1*%\nD10*\nX0Y0D03*\nM02*\n', 'cneg.gbr');
  assert.ok(d.avisos.some(a => /negativo/.test(a)), d.avisos.join(' | '));
  /* o que e valido continua sem aviso: com sinal, decimal sem zero a esquerda */
  d = GV.parse(MM + '%ADD10C,0.1*%\nD10*\nX+100Y-200D03*\nX1.5Y.5D03*\nM02*\n', 'ok.gbr');
  assert.deepStrictEqual(d.avisos, []);
  assert.deepStrictEqual(flashes(d).map(p => [p.x, p.y]), [[0.0001, -0.0002], [1.5, 0.5]]);
}

/* ── bloco opcional: os arquivos reais (rede). Pula calado se o caminho nao existir ── */
{
  const BASE = 'Y:/EQUIPAMENTOS_REVISADOS/DMB - DI231765 - DISPLAY ASCII PARA MARCAÇÃO DE BOBINAS/PCB E SCH/PDMB - DI231765_P2 (Microntrolladora)';
  const X2 = BASE + '/Project Outputs for DMB - DI231765_P2', CAMT = BASE + '/FABRICAÇÃO';
  let ok = false;
  try { ok = fs.statSync(X2).isDirectory() && fs.statSync(CAMT).isDirectory(); } catch (e) { ok = false; }
  if (ok) {
    const le = dir => GV.lerConjunto({ arquivos: fs.readdirSync(dir).map(n => ({ nome: n, texto: fs.readFileSync(path.join(dir, n), 'latin1') })) });
    const a = le(X2), b = le(CAMT);
    assert.strictEqual(a.camadas.length, 13, 'os 13 arquivos do X2 do Altium');
    for (const k of a.camadas) assert.deepStrictEqual(k.cam.avisos, [], k.arquivo);
    for (const k of b.camadas) assert.deepStrictEqual(k.cam.avisos, [], k.arquivo);
    const conta = c => { const r = { flash: 0, line: 0, arc: 0, region: 0, claro: 0 }; for (const p of c.prims) { r[p.k]++; if (!p.escuro) r.claro++; } return r; };
    let pares = 0;
    for (const ka of a.camadas) {
      const kb = b.camadas.find(x => x.info.chave === ka.info.chave);
      if (!kb) { assert.strictEqual(ka.info.chave, 'BottomPaste', 'so a pasta de baixo (vazia) falta no CAMtastic'); continue; }
      pares++;
      const ca = conta(ka.cam), cb = conta(kb.cam);
      assert.strictEqual(ca.flash, cb.flash, ka.info.chave + ' flashes');
      assert.strictEqual(ca.region, cb.region, ka.info.chave + ' regioes');
      assert.strictEqual(ca.claro, cb.claro, ka.info.chave + ' objetos claros');
      /* o CAMtastic quebra arco em retas: sem arco, os tracos batem um a um */
      if (ca.arc === 0) assert.strictEqual(ca.line, cb.line, ka.info.chave + ' tracos');
      else assert.ok(cb.line >= ca.line + ca.arc, ka.info.chave + ' arcos viraram retas');
    }
    assert.strictEqual(pares, 12);
    /* o perfil: 0..101.755 em X e ate 118.284 em Y; embaixo a aba do furo de fixacao desce a -8.176 */
    const pf = a.camadas.find(k => k.info.chave === 'Profile').cam;
    const meia = 0.0254 / 2;
    perto(pf.bbox.x1 + meia, 0, 1e-6); perto(pf.bbox.x2 - meia, 101.755, 1e-6);
    perto(pf.bbox.y2 - meia, 118.284, 1e-6); perto(pf.bbox.y1 + meia, -5.11402 - 3.06168, 1e-6);
    const pl = GV.contornoDaPlaca(pf);
    assert.strictEqual(pl.lacos.length, 1, 'o contorno fecha num laco so');
    assert.strictEqual(pl.recortes.length, 6, 'os 6 furos de fixacao (Board Cutout) como regiao');
    console.log('test-gerberview: arquivos reais conferidos (' + pares + ' pares de camadas)');
  }   /* sem a rede: pula calado */
}
/* ── opcional: os dois casos reais do testador (rede, so leitura). Pula calado sem acesso ── */
{
  const le = dir => GV.lerConjunto({ arquivos: fs.readdirSync(dir).filter(n => fs.statSync(path.join(dir, n)).isFile()).map(n => ({ nome: n, texto: fs.readFileSync(path.join(dir, n), 'latin1') })) });
  const existe = d => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } };
  /* ISS: "SMD_TO_PTH" no nome do projeto fazia do perfil uma furacao PTH, e o realista perdia a placa */
  const ISS = 'Y:/EQUIPAMENTOS ATUALIZADOS/ISS - DI221674 - ISOLADOR DE SINAIS SIMPLES - ALCOA ALUMAR (NACIONALIZAÇÃO DUAL SLOPE ISOLATOR)/PCB E SCH/Placa nova/LT1021-7 SMD_TO_PTH/FABRICAÇÃO';
  if (existe(ISS)) {
    const c = le(ISS);
    const pf = c.camadas.find(k => /_profile\.gbr$/i.test(k.arquivo));
    assert.strictEqual(pf.info.chave, 'Profile');
    assert.strictEqual(c.camadas.filter(k => k.info.chave === 'DrillPTH').length, 1, 'um PTH so');
    const pc = GV.placaDoConjunto(c.camadas);
    assert.strictEqual(pc.como, 'contorno'); assert.strictEqual(pc.camada, pf);
  }
  /* TTCA: o PCB1.GML do Altium 21 (so pads) e a Multi-Layer, e a placa vem da Mecanica 1 */
  const TTCA = 'Y:/EQUIPAMENTOS ATUALIZADOS/TTCA - DI221684 - TRANSDUTOR DE TENSÃO EM CORRENTE ALTERNADA/PCB E SCH/PROJETO/Project Outputs for Transdutor_ca';
  if (existe(TTCA)) {
    const c = le(TTCA);
    assert.strictEqual(c.camadas.find(k => /\.GML$/i.test(k.arquivo)).info.chave, 'Multi');
    assert.strictEqual(c.camadas.find(k => /BoardEdgeRout/i.test(k.arquivo)).info.chave, 'BoardEdgeRout');
    const pc = GV.placaDoConjunto(c.camadas);
    assert.strictEqual(pc.como, 'contorno'); assert.strictEqual(pc.camada.info.chave, 'Mech1');
  }
}

console.log('test-gerberview OK');
})().catch(e => { console.error(e); process.exit(1); });
