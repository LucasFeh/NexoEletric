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

console.log('test-neoden OK');
