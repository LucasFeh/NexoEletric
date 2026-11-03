/* O tracejado so na tela (pcbframe.js » recortador, 1.56.4): o zoom numa trilha travava a vista porque o
   Chrome tracejava a geometria inteira (2 s por quadro na CBM, 3.595 linhas no changes.js).

     node tests/test-pcb-recorte.js

   Le as funcoes direto do pcbframe.js (ele e um script de pagina) e confere: o segmento cortado no
   retangulo, a polilinha continua sem moveTo a mais, o que esta fora some, o arco inteiro passa como arco
   e o arco em parte vira pontos no circulo dentro do retangulo; o gravador refaz as mesmas chamadas. E que
   nenhuma dessas funcoes tem o nome de outra do arquivo (a primeira versao chamou o "refaz" do Ctrl+Y). */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pcbframe.js'), 'utf8');
const NOMES = ['recorteSeg', 'recortador', 'gravador', 'refazCaminho', 'retanguloDaTela', 'zoomRecorta', 'caminhoTracejado', 'tracoK'];
for (const n of NOMES) {
  const k = SRC.split(new RegExp('function ' + n + '\\(')).length - 1;
  assert.strictEqual(k, 1, 'function ' + n + ' aparece ' + k + ' vez(es) no pcbframe.js');
}
function pega(nome) {
  const i = SRC.indexOf('function ' + nome + '(');
  let d = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    if (SRC[k] === '{') d++;
    else if (SRC[k] === '}' && !--d) return SRC.slice(i, k + 1);
  }
  throw new Error('sem ' + nome);
}
/* um Path2D de mentira: grava as chamadas */
class Path2D { constructor() { this.c = []; } moveTo(x, y) { this.c.push(['M', x, y]); } lineTo(x, y) { this.c.push(['L', x, y]); }
  arc(...a) { this.c.push(['A', ...a]); } closePath() { this.c.push(['Z']); } }
const ESCALA = 100;   /* px por mm */
const M = new Function('Path2D', 'px', ['recorteSeg', 'recortador', 'gravador', 'refazCaminho'].map(pega).join('\n') +
  '\nreturn { recorteSeg, recortador, gravador, refazCaminho };')(Path2D, n => n / ESCALA);

const R = { x1:0, y1:0, x2:10, y2:10 };
const perto = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

/* 1. o segmento que cruza o retangulo sai cortado nas bordas */
let Q = M.recortador(R); Q.moveTo(-10, 5); Q.lineTo(20, 5);
assert.deepStrictEqual(Q.P.c, [['M', 0, 5], ['L', 10, 5]]);
/* 2. dentro: a polilinha continua, sem moveTo no meio */
Q = M.recortador(R); Q.moveTo(1, 1); Q.lineTo(5, 1); Q.lineTo(5, 5); Q.closePath();
assert.deepStrictEqual(Q.P.c.map(c => c[0]).join(''), 'MLLL', 'um moveTo so');
/* 3. fora: nada */
Q = M.recortador(R); Q.moveTo(20, 20); Q.lineTo(30, 25); Q.lineTo(30, -5);
assert.deepStrictEqual(Q.P.c, []);
/* 4. sai e volta: dois pedacos */
Q = M.recortador(R); Q.moveTo(5, 5); Q.lineTo(15, 5); Q.lineTo(15, 8); Q.lineTo(5, 8);
assert.deepStrictEqual(Q.P.c, [['M', 5, 5], ['L', 10, 5], ['M', 10, 8], ['L', 5, 8]]);
/* 5. o arco inteiro dentro passa como arco; em parte vira pontos no circulo, dentro do retangulo */
Q = M.recortador(R); Q.moveTo(7, 5); Q.arc(5, 5, 2, 0, Math.PI, false);
assert.strictEqual(Q.P.c.filter(c => c[0] === 'A').length, 1);
Q = M.recortador(R); Q.moveTo(10 + 3, 5); Q.arc(10, 5, 3, 0, 2 * Math.PI, false);
const pts = Q.P.c.filter(c => c[0] !== 'A');
assert.ok(pts.length > 10, 'virou polilinha');
for (const [, x, y] of pts) {
  assert.ok(x >= R.x1 - 1e-9 && x <= R.x2 + 1e-9 && y >= R.y1 - 1e-9 && y <= R.y2 + 1e-9, 'dentro: ' + x + ',' + y);
  const r = Math.hypot(x - 10, y - 5);
  assert.ok(r <= 3 + 1e-9 && r >= 3 - 0.5 / ESCALA, 'no circulo (corda de ~0,25 px): ' + r);
}
assert.ok(pts.some(c => perto(c[1], 10)), 'corta na borda x = 10');
/* 6. o arco todo fora: so anda */
Q = M.recortador(R); Q.moveTo(50, 50); Q.arc(50, 50, 1, 0, Math.PI, false); Q.lineTo(5, 5);
assert.ok(Q.P.c.every(c => c[0] !== 'A'));
/* 7. o gravador faz no Path2D e refaz as mesmas chamadas noutro */
const P = new Path2D(), ops = [];
const g = M.gravador(P, ops); g.moveTo(1, 2); g.lineTo(3, 4); g.arc(5, 5, 1, 0, 1, true); g.closePath();
const P2 = new Path2D();
M.refazCaminho(ops, P2);
assert.deepStrictEqual(P2.c, P.c);
/* 8. a ponta do traco cortado fica fora da tela (folga = 24 px + meia largura): retanguloDaTela */
const ret = new Function('telaParaMundo', 'px', 'CW', 'CHH', pega('retanguloDaTela') + '\nreturn retanguloDaTela;')(
  (x, y) => ({ x:x / ESCALA, y:-y / ESCALA }), n => n / ESCALA, 1000, 500);
const r8 = ret(24, 2);
assert.ok(perto(r8.x1, -0.24 - 1) && perto(r8.x2, 10 + 0.24 + 1) && perto(r8.y1, -5 - 1.24) && perto(r8.y2, 1.24));

console.log('test-pcb-recorte: ok');
