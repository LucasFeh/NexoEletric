/* As guias do arrasto (hub-guias.js): alinhamento, espaço igual e a distância ao vizinho.

   O motor é puro — quem diz o que se move e o que está parado é o schframe.js —, então tudo
   aqui é geometria sintética, pequena e explícita. A escala 1 quer dizer "1 px de tela por
   mil": o raio de captura (SNAP_PX) vale SNAP_PX mil, e dá para raciocinar sem conta. */
const assert = require('assert');
const HG = require('../hub-guias.js');

const TOL = HG.SNAP_PX;                                /* na escala 1 */
const cx = (x1, y1, x2, y2, nome, extra) => Object.assign({ x1, y1, x2, y2, nome, tipo:'comp', pontos:[] }, extra || {});
const semGrade = v => v;
const grade100 = v => Math.round(v / 100) * 100;
const R = (G, dx, dy, o) => HG.resolve(G, dx, dy, Object.assign({ escala:1, grade:semGrade, fmt:v => String(v) }, o || {}));
const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || '') + ' — esperado ' + b + ', veio ' + a);

/* ── 1. alinhamento de borda: a caixa a 3 mil da borda de cima do vizinho gruda nela ── */
{
  const G = HG.prepara({ caixa:{ x1:300, y1:3, x2:400, y2:103 }, tipoCaixa:'comp', nome:'R2' },
                       { caixas:[cx(0, 0, 100, 100, 'R1')] }, { eps:0.1 });
  const r = R(G, 0, 0);
  assert.strictEqual(r.gy, true, 'o Y devia grudar');
  perto(r.dy, -3, 'dy');
  perto(r.ly, -3, 'o pouso do eixo grudado é a guia, não a grade');
  assert.strictEqual(r.gx, false);
  assert.ok(/alinhado com R1/.test(r.rotulo), 'rotulo: ' + r.rotulo);
  /* a guia horizontal em y=0 e em y=100 (as duas bordas coincidem) e no centro y=50 */
  const ys = r.cena.guias.filter(g => g.eixo === 'y').map(g => g.v).sort((a, b) => a - b);
  assert.deepStrictEqual(ys, [0, 50, 100]);
  const g0 = r.cena.guias.find(g => g.eixo === 'y' && g.v === 0);
  perto(g0.lo, 0); perto(g0.hi, 400, 'a guia vai de uma caixa até a outra');
  assert.ok(g0.marcas.length >= 4, 'um × em cada ponta de cada borda');
}

/* ── 2. fora do raio não gruda; com zoom menor (escala 0,1) o mesmo vão gruda ── */
{
  const G = HG.prepara({ caixa:{ x1:300, y1:20, x2:400, y2:120 }, tipoCaixa:'comp' },
                       { caixas:[cx(0, 0, 100, 100, 'R1')] }, { eps:0.1 });
  assert.strictEqual(R(G, 0, 0).gy, false, '20 mil a escala 1 é longe demais');
  const r = R(G, 0, 0, { escala:0.1 });
  assert.strictEqual(r.gy, true, 'com zoom 0,1 o raio é 60 mil');
  perto(r.dy, -20);
}

/* ── 3. pino com pino: é o que deixa o fio reto ── */
{
  const G = HG.prepara({ pontos:[{ x:300, y:1003, nome:'R5-1' }] },
                       { caixas:[cx(0, 900, 100, 1100, 'R3', { pontos:[{ x:100, y:1000, nome:'R3-2' }] })] }, { eps:0.1 });
  const r = R(G, 0, 0);
  assert.strictEqual(r.gy, true);
  perto(r.dy, -3);
  assert.strictEqual(r.rotulo, 'R5-1 alinhado com R3-2');
  assert.strictEqual(r.porY, 'el');
  const g = r.cena.guias.find(g => g.eixo === 'y');
  perto(g.v, 1000);
  assert.deepStrictEqual(g.marcas.map(m => m.map(v => Math.round(v))), [[100, 1000], [300, 1000]]);
  /* pino com pino gruda MESMO fora da grade: é o que liga o fio numa folha métrica */
  const rg = R(G, 0, 0, { grade:grade100 });
  assert.strictEqual(rg.gy, true); perto(rg.ly, -3, 'o ponto de conexão pode tirar da grade');
  /* e o pino NÃO gruda na borda da caixa, que é de outro mundo */
  const G2 = HG.prepara({ pontos:[{ x:300, y:903, nome:'R5-1' }] },
                        { caixas:[cx(0, 900, 100, 1100, 'R3')] }, { eps:0.1 });
  assert.strictEqual(R(G2, 0, 0).gy, false, 'pino não alinha com borda de corpo');
}

/* ── 4. centralizado entre dois vizinhos ── */
{
  /* L termina em 100, R começa em 1000, a caixa tem 200: o meio é x1 = 450 */
  const G = HG.prepara({ caixa:{ x1:447, y1:2000, x2:647, y2:2100 }, tipoCaixa:'comp' },
                       { caixas:[cx(0, 2010, 100, 2090, 'R1'), cx(1000, 1990, 1100, 2110, 'R2')] }, { eps:0.1 });
  const r = R(G, 0, 0);
  assert.strictEqual(r.gx, true);
  perto(r.dx, 3);
  /* o centro em Y coincide com o do R1 (2050), mas a 347 mil o R1 está fora da vizinhança
     (PERTO_PX) do alinhamento; o espaço igual vai até ALCANCE_PX e o pega */
  assert.strictEqual(r.rotulo, 'centralizado entre R1 e R2');
  const mx = r.cena.medidas.filter(m => m.eixo === 'x');
  assert.strictEqual(mx.length, 2);
  assert.ok(mx.every(m => m.igual), 'os dois vãos iguais vêm marcados');
  mx.forEach(m => perto(m.valor, 350));
}

/* ── 5. enfileirar: o mesmo vão que a fila já tem ── */
{
  /* LL 0..100, L 300..400 (vão 200): a próxima caixa (largura 100) pousa em 600 */
  const G = HG.prepara({ caixa:{ x1:603, y1:0, x2:703, y2:100 }, tipoCaixa:'comp' },
                       { caixas:[cx(0, 0, 100, 100, 'R1'), cx(300, 0, 400, 100, 'R2')] }, { eps:0.1 });
  const r = R(G, 0, 0);
  assert.strictEqual(r.gx, true);
  perto(r.dx, -3);
  assert.ok(/mesmo vão de R1–R2/.test(r.rotulo), r.rotulo);
  const iguais = r.cena.medidas.filter(m => m.eixo === 'x' && m.igual).map(m => [m.a, m.b]);
  assert.deepStrictEqual(iguais.sort((a, b) => a[0] - b[0]), [[100, 300], [400, 600]]);
  /* do outro lado também: a caixa ANTES da fila */
  const G2 = HG.prepara({ caixa:{ x1:-302, y1:0, x2:-202, y2:100 }, tipoCaixa:'comp' },
                        { caixas:[cx(0, 0, 100, 100, 'R1'), cx(300, 0, 400, 100, 'R2')] }, { eps:0.1 });
  const r2 = R(G2, 0, 0);
  perto(r2.dx, 2, 'pousa em -300, com o vão de 200 antes do R1');
}

/* ── 6. a distância ao vizinho de cada lado, só na mesma fila ── */
{
  const G = HG.prepara({ caixa:{ x1:500, y1:500, x2:600, y2:600 }, tipoCaixa:'comp' },
                       { caixas:[cx(100, 520, 200, 580, 'E'),     /* esquerda, vão 300 */
                                 cx(750, 450, 850, 650, 'D'),     /* direita, vão 150 */
                                 cx(520, 900, 580, 1000, 'C'),    /* em cima, vão 300 */
                                 cx(2000, 2000, 2100, 2100, 'X')] }, { eps:0.1 });   /* fora da fila */
  const r = R(G, 0, 0, { grade:grade100 });
  const vals = r.cena.medidas.map(m => m.eixo + ':' + m.valor).sort();
  assert.deepStrictEqual(vals, ['x:150', 'x:300', 'y:300']);
  assert.ok(r.cena.medidas.every(m => !m.igual), 'nenhum vão é igual a outro');
}

/* ── 7. Ctrl: nem gruda nem desenha, e o pouso é a grade ── */
{
  const G = HG.prepara({ caixa:{ x1:300, y1:3, x2:400, y2:103 }, tipoCaixa:'comp' },
                       { caixas:[cx(0, 0, 100, 100, 'R1')] }, { eps:0.1 });
  const r = R(G, 37, 64, { desliga:true, grade:grade100 });
  assert.strictEqual(r.gx || r.gy, false);
  assert.strictEqual(r.cena, null);
  assert.strictEqual(r.dx, 37); assert.strictEqual(r.dy, 64);
  assert.strictEqual(r.lx, 0);  assert.strictEqual(r.ly, 100);
}

/* ── 8. com o ímã decidindo (trava), a guia só mostra o que já coincide ── */
{
  const G = HG.prepara({ caixa:{ x1:300, y1:3, x2:400, y2:103 }, tipoCaixa:'comp' },
                       { caixas:[cx(0, 0, 100, 100, 'R1')] }, { eps:0.1 });
  const r = R(G, 5, 5, { trava:{ dx:10, dy:-3 } });
  perto(r.dx, 10); perto(r.dy, -3); perto(r.lx, 10); perto(r.ly, -3);
  assert.ok(r.cena && r.cena.guias.some(g => g.eixo === 'y' && g.v === 0), 'mostra o alinhamento que o ímã produziu');
  const r2 = R(G, 5, 5, { trava:{ dx:10, dy:-1 } });
  assert.ok(!r2.cena || !r2.cena.guias.some(g => g.eixo === 'y'), 'não inventa alinhamento a 2 mil');
}

/* ── 9. o ÍMÃ: a guia de caixa gruda mesmo fora da grade (pedido de 2026-09-24) ── */
{
  const G = HG.prepara({ caixa:{ x1:300, y1:3, x2:400, y2:103 }, tipoCaixa:'comp' },
                       { caixas:[cx(0, 0, 100, 100, 'R1')] }, { eps:0.1 });
  /* borda a 3 mil: alinhar exige delta -3, fora do passo de 100 — e gruda assim mesmo */
  const r = R(G, 34, 1, { grade:grade100 });
  assert.strictEqual(r.gy, true); perto(r.ly, -3, 'o eixo com guia pousa na guia');
  assert.strictEqual(r.gx, false);
  assert.strictEqual(r.dx, 34, 'durante o arrasto o eixo livre segue o cursor');
  perto(r.lx, 0, 'ao soltar, o eixo livre vai para a grade');
}

/* ── 9b. mesma-borda: esquerda só alinha com esquerda (encostar caixas não é guia) ── */
{
  /* a esquerda da caixa móvel a 2 mil da DIREITA do R1: encostaria — não gruda */
  const G = HG.prepara({ caixa:{ x1:102, y1:300, x2:202, y2:400 }, tipoCaixa:'comp' },
                       { caixas:[cx(0, 0, 100, 100, 'R1')] }, { eps:0.1 });
  assert.strictEqual(R(G, 0, 0).gx, false, 'esquerda com direita não é alinhamento');
  /* a esquerda a 2 mil da esquerda do R1: gruda */
  const G2 = HG.prepara({ caixa:{ x1:2, y1:300, x2:102, y2:400 }, tipoCaixa:'comp' },
                        { caixas:[cx(0, 0, 100, 100, 'R1')] }, { eps:0.1 });
  const r2 = R(G2, 0, 0);
  assert.strictEqual(r2.gx, true); perto(r2.dx, -2);
}

/* ── 9c. gruda no que estiver mais perto do cursor: centro de caixa ou pino ── */
{
  /* D1: corpo centrado nos pinos (y 4000). S1: o centro do corpo está 25 mil acima dos pinos:
     centro com centro pede -325, pino com pino pede -300 */
  const D1 = cx(1900, 3950, 2100, 4050, 'D1', { pontos:[{ x:1900, y:4000, nome:'D1-1' }, { x:2100, y:4000, nome:'D1-2' }] });
  const G = HG.prepara({ caixa:{ x1:2900, y1:4250, x2:3100, y2:4400 }, tipoCaixa:'comp',
                         pontos:[{ x:2900, y:4300, nome:'S1-1' }, { x:3100, y:4300, nome:'S1-2' }] },
                       { caixas:[D1] }, { eps:0.1 });
  const r = R(G, 0, -322, { escala:0.13, grade:grade100 });
  perto(r.ly, -325); assert.strictEqual(r.porY, 'vis', r.rotulo);
  /* chegando no pino, o pino toma o lugar — mesmo com o centro ainda preso na travada */
  const r2 = R(G, 0, -302, { escala:0.13, grade:grade100 });
  perto(r2.ly, -300, 'os pinos pousam em linha com os do D1'); assert.strictEqual(r2.porY, 'el', r2.rotulo);
}

/* ── 9d. o centro da folha também é ímã ── */
{
  const G = HG.prepara({ caixa:{ x1:5700, y1:100, x2:5900, y2:200 }, tipoCaixa:'comp' },
                       { folha:{ x1:0, y1:0, x2:11693, y2:8268 } }, { eps:0.1 });
  const r = R(G, 45, 0, { escala:0.13, grade:grade100 });
  assert.strictEqual(r.porX, 'folha', r.rotulo); perto(r.lx, 46.5);
}

/* ── 9e. A TRAVADA: pega a SNAP_PX, só solta a SOLTA_PX ── */
{
  const nova = () => HG.prepara({ caixa:{ x1:300, y1:3, x2:400, y2:103 }, tipoCaixa:'comp' },
                                { caixas:[cx(0, 0, 100, 100, 'R1')] }, { eps:0.1 });
  const G = nova();
  assert.ok(HG.SOLTA_PX > HG.SNAP_PX + 4, 'a travada tem de ser maior que a pegada');
  perto(R(G, 0, 0).dy, -3, 'pegou');
  /* 10 px de tela da guia: fora do raio de pegar, dentro do de soltar — continua presa */
  const r1 = R(G, 0, 7);
  assert.strictEqual(r1.gy, true, 'a travada segura'); perto(r1.dy, -3);
  /* 13 px: soltou */
  const r2 = R(G, 0, 10);
  assert.strictEqual(r2.gy, false, 'passou do raio de soltar'); assert.strictEqual(r2.dy, 10);
  /* sem ter pego antes, os mesmos 10 px não pegam: é histerese, não um raio maior */
  assert.strictEqual(R(nova(), 0, 7).gy, false);
  /* o Ctrl zera a travada: depois dele, 10 px não seguram mais */
  const G2 = nova();
  R(G2, 0, 0); R(G2, 0, 7, { desliga:true });
  assert.strictEqual(R(G2, 0, 7).gy, false, 'o Ctrl soltou a travada');
  /* o ímã do pino também */
  const G3 = nova();
  R(G3, 0, 0); R(G3, 0, 7, { trava:{ dx:50, dy:50 } });
  assert.strictEqual(R(G3, 0, 7).gy, false, 'o ímã soltou a travada');
}

/* ── 9f. a travada não bloqueia: uma guia MAIS PERTO do cursor toma o lugar ── */
{
  /* R1 alinha em -3, R3 em +7; com o cursor em 6 o R1 ainda está na travada (9 px), mas o
     R3 está a 1 px — ganha o R3 */
  const G = HG.prepara({ caixa:{ x1:300, y1:3, x2:400, y2:103 }, tipoCaixa:'comp' },
                       { caixas:[cx(0, 0, 100, 100, 'R1'), cx(600, 10, 700, 110, 'R3')] }, { eps:0.1 });
  perto(R(G, 0, 0).dy, -3);
  const r = R(G, 0, 6);
  perto(r.dy, 7, 'trocou de guia'); assert.ok(/R3/.test(r.rotulo), r.rotulo);
}

/* ── 9g. o espaço igual também trava ── */
{
  /* LL 0..100, L 300..400 (vão 200): a caixa (largura 100) pousa em 600 */
  const G = HG.prepara({ caixa:{ x1:603, y1:0, x2:703, y2:100 }, tipoCaixa:'comp' },
                       { caixas:[cx(0, 0, 100, 100, 'R1'), cx(300, 0, 400, 100, 'R2')] }, { eps:0.1 });
  perto(R(G, 0, 0).dx, -3, 'pegou o mesmo vão');
  const r = R(G, 6, 0);
  assert.strictEqual(r.porX, 'espaco', 'a 9 px ainda preso: ' + r.rotulo); perto(r.dx, -3);
  assert.strictEqual(R(G, 12, 0).gx, false, 'a 15 px soltou');
}

/* ── 9h. o SHIFT: o eixo fixo não sai do lugar, o outro anda (e acha guia) ── */
{
  /* R1 à esquerda (centro Y 50), R2 acima (centro X 350): a caixa móvel alinha o centro Y
     com o R1 e, andando em X preso nesse trilho, acha o centro X do R2 */
  const G = HG.prepara({ caixa:{ x1:300, y1:3, x2:400, y2:103 }, tipoCaixa:'comp' },
                       { caixas:[cx(0, 0, 100, 100, 'R1'), cx(292, 250, 392, 350, 'R2')] }, { eps:0.1 });
  const r0 = R(G, 0, 0);
  perto(r0.dy, -3); assert.ok(r0.guia.y, 'a guia que o Shift vai prender');
  /* o cursor sobe 40 mil (bem fora da travada): com o Shift, o Y não sai do trilho */
  const r1 = R(G, 20, 40, { fixo:{ y:r0.guia.y } });
  perto(r1.dy, -3, 'o trilho segura'); perto(r1.ly, -3); assert.strictEqual(r1.dx, 20, 'o outro eixo anda livre');
  assert.ok(/alinhado com R1/.test(r1.rotulo), 'a barra ainda diz em que trilho está: ' + r1.rotulo);
  /* no trilho, o X acha o centro do R2 (delta -8) */
  const r2 = R(G, -6, 40, { fixo:{ y:r0.guia.y } });
  perto(r2.dx, -8); perto(r2.dy, -3); assert.strictEqual(r2.porX, 'vis');
  /* com o Ctrl (guias soltas) o trilho continua, e o eixo livre vai para a grade */
  const r3 = R(G, 37, 40, { fixo:{ y:r0.guia.y }, desliga:true, grade:grade100 });
  perto(r3.ly, -3, 'o Ctrl solta a guia, não o trilho'); perto(r3.lx, 0);
  /* "anda reto" sem guia: o eixo fica no zero (onde o componente estava) */
  const r4 = R(G, 70, 90, { fixo:{ y:{ tipo:'fixo', delta:0 } }, grade:grade100 });
  assert.strictEqual(r4.ly, 0); assert.strictEqual(r4.porY, 'fixo'); assert.strictEqual(r4.lx, 100);
}

/* ── 10. a vizinhança: alinhado mas longe demais não gruda ── */
{
  const G = HG.prepara({ caixa:{ x1:0, y1:3, x2:100, y2:103 }, tipoCaixa:'comp' },
                       { caixas:[cx(HG.PERTO_PX + 200, 0, HG.PERTO_PX + 300, 100, 'LONGE')] }, { eps:0.1 });
  assert.strictEqual(R(G, 0, 0).gy, false, 'a mais de PERTO_PX de tela não é vizinho');
  /* afastar o zoom traz o mesmo objeto para dentro da vizinhança */
  assert.strictEqual(R(G, 0, 0, { escala:0.5 }).gy, true);
}

/* ── 11. só os K mais perto: o K+1-ésimo alinhado não gruda ── */
{
  const cs = [];
  for (let i = 0; i < HG.K_CAIXAS; i++) cs.push(cx(0, 300 + i * 10, 20, 305 + i * 10, 'P' + i));  /* perto, sem alinhar */
  cs.push(cx(0, 3000, 100, 3100, 'ALINHADO'));   /* mais longe (mas dentro de PERTO_PX), alinhado a 3 mil */
  const G = HG.prepara({ caixa:{ x1:200, y1:3003, x2:300, y2:3103 }, tipoCaixa:'comp' }, { caixas:cs }, { eps:0.1 });
  /* sem os P mais perto dele, o ALINHADO é vizinho e gruda */
  const Gs = HG.prepara({ caixa:{ x1:200, y1:3003, x2:300, y2:3103 }, tipoCaixa:'comp' }, { caixas:[cs[cs.length - 1]] }, { eps:0.1 });
  assert.strictEqual(R(Gs, 0, 0).gy, true);
  /* os P estão a ~2700 mil e o ALINHADO a 100: é ele que fica entre os K */
  assert.strictEqual(R(G, 0, 0, { escala:0.1 }).gy, true, 'o mais perto é vizinho mesmo com a folha cheia');
  /* agora o contrário: K caixas mais perto que o alinhado */
  const cs2 = [];
  for (let i = 0; i < HG.K_CAIXAS; i++) cs2.push(cx(310 + i * 30, 3500, 320 + i * 30, 3510, 'Q' + i));
  cs2.push(cx(1500, 3000, 1600, 3100, 'ALINHADO'));
  const G2 = HG.prepara({ caixa:{ x1:200, y1:3003, x2:300, y2:3103 }, tipoCaixa:'comp' }, { caixas:cs2 }, { eps:0.1 });
  const r2 = R(G2, 0, 0, { escala:0.2 });
  assert.ok(!(r2.gy && /ALINHADO/.test(r2.rotulo)), 'o nono vizinho não entra: ' + r2.rotulo);
}

/* ── 12. o trecho de fio que só anda em Y não ganha guia em X ── */
{
  const G = HG.prepara({ pontos:[{ x:103, y:500, nome:'fio', eixos:'y' }, { x:303, y:500, nome:'fio', eixos:'y' }] },
                       { sempre:[{ x:100, y:800, nome:'fio' }] }, { eps:0.1 });
  const r = R(G, 0, 0);
  assert.strictEqual(r.gx, false, 'o X do trecho horizontal é travado — guia em X seria mentira');
  assert.strictEqual(r.cena, null);
}

/* ── 13. os vértices parados do fio que anda entram SEMPRE, mesmo longe ── */
{
  const G = HG.prepara({ pontos:[{ x:5000, y:1002, nome:'fio' }] },
                       { sempre:[{ x:0, y:1000, nome:'fio' }], pontos:[{ x:4800, y:1001, nome:'GND' }] }, { eps:0.1 });
  const r = R(G, 0, 0);
  assert.strictEqual(r.gy, true);
  perto(r.dy, -1, 'o GND está mais perto e vence');
  const r2 = R(HG.prepara({ pontos:[{ x:5000, y:1002, nome:'fio' }] }, { sempre:[{ x:0, y:1000, nome:'fio' }] }, { eps:0.1 }), 0, 0);
  perto(r2.dy, -2, 'o vértice a 5000 mil ainda vale');
}

/* ── 14. o centro da folha ── */
{
  const G = HG.prepara({ caixa:{ x1:4902, y1:100, x2:5102, y2:200 }, tipoCaixa:'comp' },
                       { folha:{ x1:0, y1:0, x2:10000, y2:8000 } }, { eps:0.1 });
  const r = R(G, 0, 0);
  assert.strictEqual(r.gx, true);
  perto(r.dx, -2);
  assert.strictEqual(r.rotulo, 'no centro da folha');
  const g = r.cena.guias.find(g => g.eixo === 'x');
  perto(g.lo, 0); perto(g.hi, 8000, 'a guia do centro atravessa a folha');
}

/* ── 15. texto alinha com texto e não entra em fila ── */
{
  const G = HG.prepara({ caixa:{ x1:1003, y1:0, x2:1100, y2:60 }, tipoCaixa:'texto', nome:'R2' },
                       { caixas:[{ x1:1000, y1:200, x2:1080, y2:260, nome:'R1', tipo:'texto', pontos:[] }] }, { eps:0.1 });
  const r = R(G, 0, 0);
  assert.strictEqual(r.gx, true); perto(r.dx, -3);
  assert.ok(r.cena.medidas.length === 0, 'texto não mede vão');
}

/* ── 16. o arredondamento: a coordenada não junta sujeira de float ── */
{
  const G = HG.prepara({ caixa:{ x1:0.1 + 0.2, y1:0, x2:100.3, y2:100 }, tipoCaixa:'comp' },
                       { caixas:[cx(0.30000000000000004 + 39.3700787402 * 3, 250, 200, 350, 'R1')] }, { eps:0.1 });
  const r = R(G, 118.1102, 0);
  assert.strictEqual(r.gx, true);
  assert.strictEqual(r.dx, Math.round(r.dx * 1e4) / 1e4, 'o delta sai em 4 casas');
}

/* ── 16b. espaço igual só com vizinho ao alcance: vão que não é desenhado não gruda ── */
{
  /* J1 e J2 a milhares de mil: o meio exato existe, mas a cota não caberia na tela */
  const G = HG.prepara({ caixa:{ x1:5580, y1:4000, x2:5980, y2:4100 }, tipoCaixa:'comp' },
                       { caixas:[cx(1000, 3950, 1400, 4150, 'J1'), cx(10200, 3900, 10600, 4200, 'J2')] }, { eps:0.1 });
  const r = R(G, 10, 0, { escala:0.26 });
  assert.ok(!(r.gx && r.porX === 'espaco'), 'gruda num vão invisível: ' + r.rotulo);
  /* a fila 'mesmo vão' também: vão de referência de 19900 mil */
  const G2 = HG.prepara({ caixa:{ x1:40003, y1:0, x2:40103, y2:100 }, tipoCaixa:'comp' },
                        { caixas:[cx(0, 0, 100, 100, 'LL'), cx(20000, 0, 20100, 100, 'L')] }, { eps:0.1 });
  assert.strictEqual(R(G2, 0, 0).gx, false);
}

/* ── 16c. a fila é medida onde a caixa POUSA no outro eixo, e não no cursor ── */
{
  /* L só pega a faixa de Y do cursor (45..145), não a do pouso na grade (0..100) */
  const G = HG.prepara({ caixa:{ x1:500, y1:0, x2:700, y2:100 }, tipoCaixa:'comp' },
                       { caixas:[cx(0, 120, 100, 400, 'L'), cx(1300, -400, 1400, 380, 'R')] }, { eps:0.1 });
  const r = R(G, 97, 45, { grade:grade100 });
  assert.ok(!/centralizado/.test(r.rotulo), 'L nem está na fila no pouso: ' + r.rotulo);
  /* e quando está, gruda — e a cota igual aparece */
  const r2 = R(G, 97, 130, { grade:grade100 });
  assert.ok(/centralizado entre L e R/.test(r2.rotulo), r2.rotulo);
  perto(r2.lx, 100); perto(r2.ly, 100);
  assert.strictEqual(r2.cena.medidas.filter(m => m.eixo === 'x' && m.igual).length, 2);
}

/* ── 16c'. a garantia é um ponto fixo: reverter um eixo refaz a medida do outro ── */
{
  /* testemunha da segunda revisão: X revertido tirava T2 da coluna, e o Y ficava
     "centralizado entre B1 e T2" conferido contra a medida velha */
  const grade50 = v => Math.round(Math.round(v / 50) * 50 * 1e4) / 1e4;
  const G = HG.prepara({ caixa:{ x1:0, y1:0, x2:100, y2:100 }, tipoCaixa:'comp' },
                       { caixas:[cx(-300, 90, -180, 190, 'L1'), cx(380, 140, 400, 170, 'R1'), cx(-20, -380, 60, -300, 'B1'),
                                 cx(30, 490, 140, 600, 'T1'), cx(130, 400, 320, 530, 'T2')] }, { eps:0.1 });
  const r = R(G, 20, 30, { escala:0.13, grade:grade50 });
  for (const [eixo, por] of [['x', r.porX], ['y', r.porY]])
    if (por === 'espaco') assert.ok(r.cena && r.cena.medidas.some(m => m.eixo === eixo && m.igual),
                                    'espaço igual em ' + eixo + ' sem cota igual: ' + r.rotulo);
}

/* ── 16d. vão de referência entre caixas que não dividem a faixa não vale ── */
{
  /* M é alta e pega LL e L, mas LL e L estão em alturas diferentes: não são uma fila */
  const G = HG.prepara({ caixa:{ x1:603, y1:0, x2:703, y2:1000 }, tipoCaixa:'comp' },
                       { caixas:[cx(0, 800, 100, 900, 'LL'), cx(300, 0, 400, 100, 'L')] }, { eps:0.1 });
  const r = R(G, 0, 0);
  assert.ok(!/mesmo vão/.test(r.rotulo), r.rotulo);
  assert.ok(!r.cena || r.cena.medidas.every(m => m.hi >= m.lo), 'cota com faixa de altura negativa');
}

/* ── 16e. vãos iguais saem com o mesmo número; grupos diferentes, cada um com o seu ── */
{
  /* 0,09 mil de diferença: iguais, e a pílula não pode dizer "400" e "400,1" */
  const G = HG.prepara({ caixa:{ x1:500.04, y1:0, x2:600, y2:100 }, tipoCaixa:'comp' },
                       { caixas:[cx(0, 0, 100, 100, 'L'), cx(1000.13, 0, 1100, 100, 'R')] }, { eps:0.1 });
  const ms = R(G, 0, 0, { trava:{ dx:0, dy:0 } }).cena.medidas.filter(m => m.eixo === 'x');
  assert.ok(ms.length === 2 && ms.every(m => m.igual));
  assert.strictEqual(ms[0].valor, ms[1].valor);
  /* esquerda igual à fila da esquerda (200), direita igual à da direita (300): dois grupos */
  const G2 = HG.prepara({ caixa:{ x1:600, y1:0, x2:700, y2:100 }, tipoCaixa:'comp' },
                        { caixas:[cx(0, 0, 100, 100, 'LL'), cx(300, 0, 400, 100, 'L'),
                                  cx(1000, 0, 1100, 100, 'R'), cx(1400, 0, 1500, 100, 'RR')] }, { eps:0.1 });
  const m2 = R(G2, 0, 0, { trava:{ dx:0, dy:0 } }).cena.medidas.filter(m => m.eixo === 'x');
  const por = a => m2.find(m => Math.abs(m.a - a) < 1e-6);
  assert.strictEqual(por(400).valor, 200); assert.strictEqual(por(700).valor, 300);
  assert.ok(m2.every(m => m.igual));
}

/* ── 17. o topo de K: inserção mantém a ordem e o tamanho ── */
{
  const top = [];
  [5, 1, 9, 3, 7, 2, 8].forEach((d, i) => HG._int.poeNoTopo(top, 4, i, d));
  assert.deepStrictEqual(top.map(t => t.d), [1, 2, 3, 5]);
}

/* ── 18. desenho: rótulo com o número da medida, e nada quebra sem cena ── */
{
  const chamadas = [];
  const ctx = new Proxy({}, { get: (t, k) => {
    if (k === 'getTransform') return () => ({ a:2, b:0, c:0, d:-2, e:10, f:20 });
    if (k === 'measureText') return s => ({ width: String(s).length * 6 });
    if (k in t) return t[k];
    return (...a) => { chamadas.push([k, a]); };
  }, set: (t, k, v) => { t[k] = v; return true; } });
  HG.desenha(ctx, null, {});
  assert.strictEqual(chamadas.length, 0);
  HG.desenha(ctx, { guias:[{ eixo:'x', v:10, lo:0, hi:100, marcas:[[10, 0]] }],
                    medidas:[{ eixo:'x', a:0, b:100, em:50, lo:0, hi:100, valor:100, igual:true }] },
             { escala:2, fmt:v => v + ' mil' });
  const txt = chamadas.filter(c => c[0] === 'fillText').map(c => c[1][0]);
  assert.deepStrictEqual(txt, ['100 mil']);
  assert.ok(chamadas.some(c => c[0] === 'fillRect'), 'a faixa do espaço igual');
  const ft = chamadas.find(c => c[0] === 'fillText');
  /* o centro da cota (50,50) na tela: 2*50+10 = 110, -2*50+20 = -80 (+0,5 de ajuste óptico) */
  perto(ft[1][1], 110); perto(ft[1][2], -79.5);
}

/* ── 19. desempenho: folha grande, mil movimentos ── */
{
  const caixas = [], pontos = [];
  for (let i = 0; i < 400; i++){
    const x = (i % 20) * 600, y = Math.floor(i / 20) * 400;
    const pins = [];
    for (let p = 0; p < 12; p++) pins.push({ x: x + (p % 2 ? 300 : 0), y: y + 50 * Math.floor(p / 2), nome:'U' + i + '-' + p });
    caixas.push(cx(x, y, x + 300, y + 300, 'U' + i, { pontos:pins }));
  }
  for (let i = 0; i < 3000; i++) pontos.push({ x:(i * 37) % 12000, y:(i * 53) % 8000, nome:'fio' });
  const pinosMov = [];
  for (let p = 0; p < 40; p++) pinosMov.push({ x: 3000 + (p % 2 ? 400 : 0), y: 3000 + 50 * Math.floor(p / 2), nome:'U999-' + p });
  const t0 = process.hrtime.bigint();
  const G = HG.prepara({ caixa:{ x1:3000, y1:3000, x2:3400, y2:4000 }, tipoCaixa:'comp', pontos:pinosMov },
                       { caixas, pontos, folha:{ x1:0, y1:0, x2:12000, y2:8000 } }, { eps:0.1 });
  const t1 = process.hrtime.bigint();
  let n = 0;
  for (let i = 0; i < 1000; i++){
    const r = HG.resolve(G, (i * 7) % 3000 - 1500, (i * 11) % 2000 - 1000, { escala:0.1, grade:grade100, fmt:String });
    if (r.gx || r.gy) n++;
  }
  const t2 = process.hrtime.bigint();
  const prep = Number(t1 - t0) / 1e6, porMov = Number(t2 - t1) / 1e6 / 1000;
  console.log('  desempenho: prepara ' + prep.toFixed(1) + ' ms, ' + porMov.toFixed(3) + ' ms por movimento (' + n + '/1000 grudaram)');
  assert.ok(porMov < 2, 'um movimento tem de caber folgado num quadro: ' + porMov + ' ms');
}

console.log('test-guias OK');
