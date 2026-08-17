const assert = require('assert');
const Font = require('../hub-font.js');

/* A fonte vetorial vinha presa no pcbframe.js, acoplada ao ctx do canvas. Aqui ela e
   geometria pura: textPolylines devolve polilinhas em coordenadas LOCAIS (centradas em
   x, Y para cima), e quem chama aplica rotacao/espelho/translacao. */

/* ── avanco ── */
assert.strictEqual(Font.textWidth('A', 1), 0.857143);          /* w do glifo 'A' */
assert.strictEqual(Font.textWidth('A', 2), 0.857143 * 2);      /* escala com h */
assert.strictEqual(Font.textWidth('', 1), 0);

/* espaco avanca 0.5*h sem desenhar nada */
assert.strictEqual(Font.textWidth(' A', 1), 0.5 + 0.857143);
assert.strictEqual(Font.textPolylines(' ', 1).length, 0);

/* ── 'A' tem dois tracos: a barra e o bico ── */
const a = Font.textPolylines('A', 1);
assert.strictEqual(a.length, 2);
assert.strictEqual(a[0].length, 2);                            /* barra: 2 pontos */
assert.strictEqual(a[1].length, 3);                            /* bico: 3 pontos */

/* ── centrado em x: o texto fica simetrico em torno de zero ── */
const xs = a.flat().map(p => p[0]);
assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs)) < 1e-9,
          'texto deve ficar centrado em x=0');

/* ── Y para cima: o FONTDATA usa Y negativo p/ cima (convencao ibom), a saida inverte ── */
const ys = a.flat().map(p => p[1]);
assert.ok(Math.max(...ys) > 0 && Math.min(...ys) < 0, 'altura deve cruzar y=0');
assert.ok(Math.abs((Math.max(...ys) - Math.min(...ys)) - 1) < 1e-6,
          "altura do 'A' deve ser h");

/* ── escala: dobrar h dobra todas as coordenadas ── */
const a2 = Font.textPolylines('A', 2);
assert.ok(a2.flat().every((p, i) => Math.abs(p[0] - a.flat()[i][0] * 2) < 1e-9 &&
                                    Math.abs(p[1] - a.flat()[i][1] * 2) < 1e-9));

/* ── minuscula sem glifo proprio cai na maiuscula (como glyphFor sempre fez) ── */
assert.deepStrictEqual(Font.textPolylines('a', 1), Font.textPolylines('A', 1));

/* ── glifo ausente vira caixa fechada, e nao some ── */
const box = Font.textPolylines('€', 1);                   /* euro: nao existe no FONTDATA */
assert.strictEqual(box.length, 1);
assert.strictEqual(box[0].length, 5, 'caixa fechada = 5 pontos');
assert.deepStrictEqual(box[0][0], box[0][4], 'a caixa fecha no ponto inicial');
assert.strictEqual(Font.textWidth('€', 1), 0.9);          /* avanco do fallback */

/* ── varios caracteres avancam em sequencia, sem sobrepor ── */
const cc = Font.textPolylines('II', 1);                        /* 'I' = um traco vertical */
assert.strictEqual(cc.length, 2);
assert.ok(cc[1][0][0] > cc[0][0][0], 'o segundo caractere fica a direita do primeiro');

console.log('test-font OK');
