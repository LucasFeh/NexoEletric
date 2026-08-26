const assert = require('assert');
const Core = require('../hub-core.js');

const comps = [
  { ref:'C1', comment:'100nF', footprint:'C0805', layer:'Top', x:10, y:20, rot:90,
    bbox:{ x1:9, y1:19, x2:11, y2:21 } },
  { ref:'U1', comment:'MCU', footprint:'LQFP48', layer:'Top', x:30, y:40, rot:0,
    bbox:{ x1:26, y1:36, x2:34, y2:44 } },
  { ref:'R1', comment:'10R - 1/4w', footprint:'R0603', layer:'Bottom', x:50, y:60, rot:180 },
];

/* referencia vira (0,0); demais relativos; referencia primeiro na lista */
const t1 = Core.neodenTransform(comps, { refDes:'U1' });
assert.strictEqual(t1.error, null);
assert.strictEqual(t1.rows[0].des, 'U1');
assert.strictEqual(t1.rows[0].x, 0);
assert.strictEqual(t1.rows[0].y, 0);
assert.strictEqual(t1.rows[1].des, 'C1');           /* mid do bbox: (10,20) - (30,40) */
assert.strictEqual(t1.rows[1].x, -20);
assert.strictEqual(t1.rows[1].y, -20);
assert.strictEqual(t1.rows[2].x, 20);               /* R1 sem bbox: usa x,y */
assert.strictEqual(t1.rows[2].y, 20);

/* Mid X/Y = origem do componente (Location X/Y do Altium), nunca o centro do bbox
   de cobre: o bbox gira junto com o componente, entao o desvio origem->bbox cai em
   eixos diferentes conforme a rotacao e nao se cancela ao subtrair a referencia.
   Caso real do TCMS_Reader: J2 (rot 270) e J8 (rot 0), mesmo footprint JUMPER_3VIAS,
   bbox 0.127mm (5 mil) fora da origem -> erro de (-0.127, -0.127) em J8. */
const jum = [
  { ref:'J2', comment:'', footprint:'JUMPER_3VIAS', layer:'Top', x:31.75,  y:49.276, rot:270,
    bbox:{ x1:30.75,  y1:48.403, x2:32.75,  y2:50.403 } },   /* mid = (31.750, 49.403) */
  { ref:'J8', comment:'', footprint:'JUMPER_3VIAS', layer:'Top', x:88.011, y:41.91,  rot:0,
    bbox:{ x1:86.884, y1:40.910, x2:88.884, y2:42.910 } },   /* mid = (87.884, 41.910) */
];
const tj = Core.neodenTransform(jum, { refDes:'J2', off:{ x:31.75, y:49.276 } });
assert.ok(Math.abs(tj.rows[0].x - 31.75)  < 1e-9, 'J2 = coordenada de maquina informada');
assert.ok(Math.abs(tj.rows[0].y - 49.276) < 1e-9);
assert.ok(Math.abs(tj.rows[1].x - 88.011) < 1e-9, 'J8 X deve casar com o Altium (88.011), nao 87.884');
assert.ok(Math.abs(tj.rows[1].y - 41.91)  < 1e-9, 'J8 Y deve casar com o Altium (41.91), nao 41.783');

/* offset de maquina (paridade com -o 100 140) */
const t2 = Core.neodenTransform(comps, { refDes:'U1', off:{ x:100, y:140 } });
assert.strictEqual(t2.rows[0].x, 100);
assert.strictEqual(t2.rows[0].y, 140);
assert.strictEqual(t2.rows[1].x, 80);

/* rotacao 90 CCW em torno de (0,0) apos relativo: (-20,-20) -> (20,-20) */
const t3 = Core.neodenTransform(comps, { refDes:'U1', rot:{ ox:0, oy:0, angle:90 } });
assert.ok(Math.abs(t3.rows[1].x - 20) < 1e-9);
assert.ok(Math.abs(t3.rows[1].y + 20) < 1e-9);
/* Rotation do componente nao muda */
assert.strictEqual(t3.rows[1].rot, 90);

/* move-pos-N: indice > n (0-based, igual ao script): n=1 move so o indice 2 */
const t4 = Core.neodenTransform(comps, { refDes:'U1', move:{ dx:5, dy:0, n:1 } });
assert.strictEqual(t4.rows[1].x, -20);
assert.strictEqual(t4.rows[2].x, 25);

/* referencia inexistente = erro */
assert.ok(Core.neodenTransform(comps, { refDes:'Z9' }).error);

/* sem refDes: ordem original, sem relativo */
const t5 = Core.neodenTransform(comps, {});
assert.strictEqual(t5.rows[0].des, 'C1');
assert.strictEqual(t5.rows[0].x, 10);

/* CSV: header + linha vazia + filtro por lado + formato NN.NNmm + Layer literal T + virgula vira _ */
const csv = Core.neodenCsv(t2.rows, 'Top');
assert.ok(csv.indexOf('\r\n') >= 0, 'CSV usa CRLF');
const lines = csv.trim().split(/\r?\n/);
assert.strictEqual(lines[0], 'Designator,Footprint,Mid X,Mid Y,Layer,Rotation,Comment');
assert.strictEqual(lines[1], ',,,,,,');
assert.strictEqual(lines[2], 'U1,LQFP48,100.00mm,140.00mm,T,0,MCU');
assert.strictEqual(lines[3], 'C1,C0805,80.00mm,120.00mm,T,90,100nF');
assert.strictEqual(lines.length, 4);                /* R1 e Bottom, fica fora */
const csvB = Core.neodenCsv(Core.neodenTransform(comps, { refDes:'U1' }).rows, 'Bottom');
assert.ok(csvB.indexOf('R1,R0603,20.00mm,20.00mm,T,180,10R - 1/4w') >= 0);
const csvComma = Core.neodenCsv(Core.neodenTransform(
  [{ ref:'X1', comment:'a,b', footprint:'F,P', layer:'Top', x:1, y:2, rot:0 }], {}).rows, 'Top');
assert.ok(csvComma.indexOf('X1,F_P,1.00mm,2.00mm,T,0,a_b') >= 0);

/* ── tipo de montagem: sai do pads[].type do board.js, sem heuristica de footprint ── */
const padded = [
  { ref:'U1',  footprint:'LQFP48',  comment:'MCU',  layer:'Top', x:0,  y:0, rot:0,
    pads:[{ type:'smd' }, { type:'smd' }] },
  { ref:'J1',  footprint:'HDR2X5',  comment:'CONN', layer:'Top', x:10, y:0, rot:0,
    pads:[{ type:'th' }, { type:'th' }] },
  { ref:'MD4', footprint:'ESP32-H2',comment:'MOD',  layer:'Top', x:20, y:0, rot:0,
    pads:[{ type:'smd' }, { type:'th' }] },     /* caso real do VDCB-DI251879 */
  { ref:'FID1',footprint:'FIDUCIAL',comment:'',     layer:'Top', x:30, y:0, rot:0 },
];
assert.strictEqual(Core.neodenKind(padded[0]), 'smd');
assert.strictEqual(Core.neodenKind(padded[1]), 'pth');
assert.strictEqual(Core.neodenKind(padded[2]), 'misto', 'smd+th e categoria propria, nao pth');
assert.strictEqual(Core.neodenKind(padded[3]), '?', 'sem pads = indefinido, nunca chutar smd');
assert.strictEqual(Core.neodenKind({ ref:'X', pads:[] }), '?');

/* ── exclusao: sai do CSV, fica na previa ── */
const tx = Core.neodenTransform(padded, { refDes:'U1', exclude:['J1'] });
const xd = d => tx.rows.find(r => r.des === d);
assert.strictEqual(tx.rows.length, 4, 'excluido continua nas linhas (previa riscada)');
assert.strictEqual(xd('J1').excluded, true);
assert.strictEqual(xd('J1').kind, 'pth');
assert.strictEqual(xd('J1').x, 10, 'excluido ainda recebe relativo/rotacao/offset');
assert.strictEqual(xd('U1').excluded, false);

/* indice de exportacao renumera sobre os incluidos; excluido nao tem indice */
assert.strictEqual(xd('J1').idx, null);
assert.strictEqual(xd('U1').idx, 0);
assert.strictEqual(xd('MD4').idx, 1, 'MD4 assume o indice 1 que era do J1');
assert.strictEqual(xd('FID1').idx, 2);

const csvX = Core.neodenCsv(tx.rows, 'Top');
assert.ok(csvX.indexOf('J1,') < 0, 'excluido nao vai pro CSV');
assert.ok(csvX.indexOf('MD4,') >= 0);
assert.strictEqual(csvX.trim().split(/\r?\n/).length, 5);   /* header + vazia + 3 */

/* ── mover-apos-N conta so os incluidos (senao o painel sai deslocado) ── */
const m0 = Core.neodenTransform(padded, { refDes:'U1', move:{ dx:100, dy:0, n:1 } });
assert.strictEqual(m0.rows[1].x, 10,  'J1 esta no indice 1, nao move');
assert.strictEqual(m0.rows[2].x, 120, 'MD4 no indice 2 move');
const m1 = Core.neodenTransform(padded, { refDes:'U1', exclude:['J1'], move:{ dx:100, dy:0, n:1 } });
const md = d => m1.rows.find(r => r.des === d);
assert.strictEqual(md('MD4').x, 20,   'com J1 fora, MD4 vira indice 1 e nao move mais');
assert.strictEqual(md('FID1').x, 130, 'FID1 vira indice 2 e passa a mover');
assert.strictEqual(md('J1').x, 10,    'excluido nao entra no move');

/* ── a referencia nunca sai da lista, mesmo pedida na exclusao ── */
const ti = Core.neodenTransform(padded, { refDes:'U1', exclude:['U1', 'J1'] });
assert.strictEqual(ti.rows.find(r => r.des === 'U1').excluded, false);
assert.strictEqual(ti.rows.find(r => r.des === 'U1').idx, 0);
assert.ok(Core.neodenCsv(ti.rows, 'Top').indexOf('U1,') >= 0);

/* designator inexistente na exclusao e ignorado, sem erro */
const tg = Core.neodenTransform(padded, { refDes:'U1', exclude:['NAO_EXISTE'] });
assert.strictEqual(tg.error, null);
assert.strictEqual(tg.rows.filter(r => r.excluded).length, 0);

/* ── retrocompatibilidade: sem exclude, tudo incluido e idx = posicao ── */
const bc = Core.neodenTransform(comps, { refDes:'U1' });
assert.ok(bc.rows.every(r => r.excluded === false));
bc.rows.forEach((r, i) => assert.strictEqual(r.idx, i));

/* ══ agrupamento por classe+package: menos troca de bico na Neoden ══════════════ */

/* Nomes de footprint do acervo real, deliberadamente inconsistentes: "RES 1206" e
   "1206 resistor" sao o mesmo componente fisico (96 e 35 ocorrencias em Projects/).
   Agrupar pela string crua os separaria — por isso a classe sai do designator. */
const mix = [
  { ref:'C2', footprint:'CAP 0805',      comment:'', layer:'Top', x:0, y:0, rot:0 },
  { ref:'R1', footprint:'RES 1206',      comment:'', layer:'Top', x:1, y:0, rot:0 },
  { ref:'C1', footprint:'CAP 1206',      comment:'', layer:'Top', x:2, y:0, rot:0 },
  { ref:'R2', footprint:'1206 resistor', comment:'', layer:'Top', x:3, y:0, rot:0 },
  { ref:'R3', footprint:'RES 0805',      comment:'', layer:'Top', x:4, y:0, rot:0 },
];
const g1 = Core.neodenTransform(mix, { group:true });
assert.strictEqual(g1.error, null);
assert.deepStrictEqual(g1.rows.map(r => r.des), ['R3', 'R1', 'R2', 'C2', 'C1'],
  'R antes de C; 0805 antes de 1206 dentro da classe; "RES 1206" e "1206 resistor" no mesmo grupo');

/* A classe e o prefixo de letras INTEIRO do designator: CN e conector, nao capacitor.
   Com prefixo de uma letra so, o CN1 cai como "C" e parte o bloco dos capacitores em
   dois — duas trocas de bico onde deveria haver uma. */
const pref = [
  { ref:'C1',  footprint:'CAP 1206',       comment:'', layer:'Top', x:0, y:0, rot:0 },
  { ref:'CN1', footprint:'BARRA 4P',       comment:'', layer:'Top', x:1, y:0, rot:0 },
  { ref:'C2',  footprint:'CAP EL SMD 4MM', comment:'', layer:'Top', x:2, y:0, rot:0 },
];
assert.deepStrictEqual(Core.neodenTransform(pref, { group:true }).rows.map(r => r.des),
  ['C1', 'C2', 'CN1'], 'o conector nao pode partir o bloco dos capacitores');

/* Dentro do grupo, designator em ordem NATURAL: R2 antes de R10. A ordem alfabetica
   daria R1, R10, R2 e a lista deixaria de casar com a placa na conferencia. */
const nat = [
  { ref:'R10', footprint:'RES 1206', comment:'', layer:'Top', x:0, y:0, rot:0 },
  { ref:'R2',  footprint:'RES 1206', comment:'', layer:'Top', x:1, y:0, rot:0 },
  { ref:'R1',  footprint:'RES 1206', comment:'', layer:'Top', x:2, y:0, rot:0 },
];
assert.deepStrictEqual(Core.neodenTransform(nat, { group:true }).rows.map(r => r.des),
  ['R1', 'R2', 'R10'], 'designator em ordem natural dentro do grupo');

/* A referencia fica FIXA na linha 1, fora do agrupamento: e a origem do mapeamento e o
   primeiro componente que o operador localiza na maquina.
   REGRESSAO: o relativo lia rows[0] assumindo que a referencia estava ali. Com a
   ordenacao a referencia sai da posicao 0, e sem tratar isso TODAS as coordenadas
   passariam a ser relativas a outro componente — sem erro, sem aviso, so a placa errada. */
const anc = [
  { ref:'R1', footprint:'RES 1206', comment:'', layer:'Top', x:10, y:10, rot:0 },
  { ref:'U9', footprint:'SOT-23',   comment:'', layer:'Top', x:50, y:50, rot:0 },
  { ref:'R2', footprint:'RES 1206', comment:'', layer:'Top', x:20, y:10, rot:0 },
];
const g4 = Core.neodenTransform(anc, { group:true, refDes:'U9' });
const anch = d => g4.rows.find(r => r.des === d);
assert.deepStrictEqual(g4.rows.map(r => r.des), ['U9', 'R1', 'R2'],
  'a referencia nao entra no agrupamento — fica na linha 1');
assert.strictEqual(g4.rows[0].x, 0);
assert.strictEqual(g4.rows[0].y, 0);
assert.strictEqual(anch('R1').x, -40, 'relativo sai da REFERENCIA, nao da linha 0 pos-ordenacao');
assert.strictEqual(anch('R1').y, -40);
assert.strictEqual(anch('R2').x, -30);

/* Travas de regressao (nao dirigiram codigo novo — o idx ja e atribuido depois da
   ordenacao — mas prendem a interacao entre agrupar, excluir e mover-apos-N). */

/* o "#" e o corte do painel contam na ordem NOVA, e o excluido continua sem indice */
const gi = [
  { ref:'R2', footprint:'RES 1206', comment:'', layer:'Top', x:0, y:0, rot:0, pads:[{ type:'smd' }] },
  { ref:'J1', footprint:'HDR2X5',   comment:'', layer:'Top', x:1, y:0, rot:0, pads:[{ type:'th'  }] },
  { ref:'R1', footprint:'RES 1206', comment:'', layer:'Top', x:2, y:0, rot:0, pads:[{ type:'smd' }] },
];
const g5 = Core.neodenTransform(gi, { group:true, exclude:['J1'], move:{ dx:100, dy:0, n:0 } });
const gd = d => g5.rows.find(r => r.des === d);
assert.deepStrictEqual(g5.rows.map(r => r.des), ['R1', 'R2', 'J1']);
assert.strictEqual(gd('R1').idx, 0);
assert.strictEqual(gd('R2').idx, 1);
assert.strictEqual(gd('J1').idx, null, 'excluido nao recebe indice, mesmo agrupado');
assert.strictEqual(gd('R1').x, 2,   'idx 0 nao passa do corte');
assert.strictEqual(gd('R2').x, 100, 'idx 1 passa do corte e move');

/* sem a flag, a ordem e byte-identica a de hoje — e o que protege quem nao ligar a opcao */
assert.deepStrictEqual(Core.neodenTransform(mix, {}).rows.map(r => r.des),
  mix.map(c => c.ref), 'sem group:true, ordem original do board.js');
assert.deepStrictEqual(Core.neodenTransform(mix, { refDes:'C1' }).rows.map(r => r.des),
  ['C1', 'C2', 'R1', 'R2', 'R3'], 'sem group:true, so a referencia sobe para a linha 1');

console.log('test-neoden OK');
