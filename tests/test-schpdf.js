// hub-schpdf.js: o contexto 2D que grava no hub-pdfwriter.js (o PDF do esquema).  node tests/test-schpdf.js
'use strict';
const assert = require('assert');
const path = require('path');
const R = path.join(__dirname, '..');
global.HubPdfWriter = require(path.join(R, 'hub-pdfwriter.js'));
const S = require(path.join(R, 'hub-schpdf.js'));

/* uma pagina A4 em mil (11693 x 8268), unidade 0,0254 mm: o que o schframe faz */
const doc = HubPdfWriter.novo({ titulo: 't' });
const pg = doc.pagina(11693 * 0.0254, 8268 * 0.0254);
const ctx = S.contexto(doc, pg, { largura: 11693, altura: 8268, unidade: 0.0254 });
ctx.setTransform(1, 0, 0, -1, 0, 8268);         // Y para cima, como a camera do esquema

// um fio de (1000,1000) a (2000,1000): em mm, (25.4, 25.4) a (50.8, 25.4), Y para cima
ctx.strokeStyle = '#000080'; ctx.lineWidth = 10; ctx.lineCap = 'round';
ctx.beginPath(); ctx.moveTo(1000, 1000); ctx.lineTo(2000, 1000); ctx.stroke();
const ops = pg.ops.join('\n');
assert.ok(/25\.4 25\.4 m\n50\.8 25\.4 l\nS/.test(ops), ops.slice(-200));
assert.ok(ops.includes('0.254 w'), 'a espessura vai pela escala: 10 mil = 0,254 mm');
assert.ok(ops.includes('1 J 1 j'), 'ponta redonda');
console.log('  ok  caminho e espessura levados pela matriz do canvas');

// a matriz empilhada: save/translate/rotate/restore
ctx.save(); ctx.translate(3000, 3000); ctx.rotate(Math.PI / 2);
ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(100, 0); ctx.stroke();
ctx.restore();
const ult = pg.ops.slice(-3).join(' ');
assert.ok(/76\.2 76\.2 m 76\.2 78\.74 l S/.test(ult), ult);
console.log('  ok  translate + rotate + restore');

// arco completo: 4 Beziers e o raio certo (100 mil = 2,54 mm)
const n0 = pg.ops.length;
ctx.beginPath(); ctx.arc(5000, 5000, 100, 0, 2 * Math.PI); ctx.fill();
const cs = pg.ops.slice(n0).filter(o => / c$/.test(o));
assert.strictEqual(cs.length, 4);
const fim = cs[3].split(' ').map(Number);
assert.ok(Math.abs(fim[4] - 129.54) < 1e-3 && Math.abs(fim[5] - 127) < 1e-3, cs[3]);
console.log('  ok  arco em 4 Beziers, raio certo');

// arcTo (o canto arredondado do port): termina no ponto tangente
ctx.beginPath(); ctx.moveTo(0, 0); ctx.arcTo(100, 0, 100, 100, 20); ctx.lineTo(100, 100); ctx.stroke();
console.log('  ok  arcTo');

// texto: worldText do hub-draw (translate, scale(1,-1), fillText) sai de pe
ctx.save(); ctx.translate(1000, 2000); ctx.scale(1, -1); ctx.font = '60px "Segoe UI", sans-serif'; ctx.fillStyle = '#123456';
ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('R1 10K', 0, 0); ctx.restore();
const tx = pg.ops.filter(o => /Tj ET$/.test(o)).pop();
assert.ok(tx.includes('(R1 10K) Tj'), tx);
assert.ok(/\/F\d+ 60 Tf/.test(tx), 'tamanho na unidade do usuario: ' + tx);
const cm = pg.ops[pg.ops.indexOf(tx) - 1].split(' ').map(Number);
// a matriz do texto: escala positiva nos dois eixos (de pe, sem espelho) e no lugar (25,4 ; 50,8)
assert.ok(cm[0] > 0 && cm[3] > 0 && Math.abs(cm[4] - 25.4) < 1e-3 && Math.abs(cm[5] - 50.8) < 1e-3, 'texto de pe: ' + cm.join(' '));
ctx.font = '60px sans-serif';
assert.ok(Math.abs(ctx.measureText('R1 10K').width - 200.1) < 0.5, 'a largura do AFM, na unidade do usuario');
console.log('  ok  texto de pe, no lugar, com a cor e o tamanho');

// cor transparente e alpha zero nao pintam; rgba vira hex
const n1 = pg.ops.length;
ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0, 0, 10, 10);
ctx.globalAlpha = 0; ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 10, 10); ctx.globalAlpha = 1;
assert.strictEqual(pg.ops.length, n1, 'nada pintado');
assert.deepStrictEqual(S.cor('rgba(255, 128, 0, 0.5)'), { hex: '#ff8000', a: 0.5 });
assert.deepStrictEqual(S.cor('#abc'), { hex: '#aabbcc', a: 1 });
console.log('  ok  transparente nao pinta; cores normalizadas');

// tracejado na escala
ctx.setLineDash([18, 14]); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 0); ctx.stroke(); ctx.setLineDash([]);
assert.ok(pg.ops.some(o => o === '[0.4572 0.3556] 0 d'), 'tracejado em mm');
console.log('  ok  tracejado');

// o documento inteiro: duas paginas, le de volta
(async () => {
  const b = await S.gera({ unidade: 0.0254, titulo: 'Esquema T', folhas: [
    { largura: 11693, altura: 8268, desenha: c => { c.setTransform(1, 0, 0, -1, 0, 8268); c.strokeRect(0, 0, 11693, 8268); } },
    { largura: 16535, altura: 11693, desenha: c => { c.setTransform(1, 0, 0, -1, 0, 11693); c.fillText('folha 2', 100, 100); } }] });
  const lido = HubPdfWriter.le(b);
  assert.strictEqual(lido.paginas.length, 2, JSON.stringify(lido.erros));
  assert.ok(lido.xrefOk && !lido.erros.length, 'xref: ' + JSON.stringify(lido.erros));
  const mb = lido.paginas.map(p => p.mediaBox.slice(2).map(v => Math.round(v)));
  assert.deepStrictEqual(mb, [[842, 595], [1191, 842]], 'A4 e A3 em pontos: ' + JSON.stringify(mb));
  console.log('  ok  duas folhas, duas paginas, o PDF le de volta');
  console.log('test-schpdf: ok');
})().catch(e => { console.error(e); process.exit(1); });
