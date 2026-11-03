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

/* ── minusculas de verdade (newstroke do KiCad): "dieletrons.com" saia "DIELETROnS.COM", porque so
   o n/u/x tinham glifo e o resto caia na maiuscula ── */
for (let k = 97; k <= 122; k++) {
  const c = String.fromCharCode(k);
  assert.ok(Font.FONTDATA[c], "falta o glifo '" + c + "'");
  assert.notDeepStrictEqual(Font.textPolylines(c, 1), Font.textPolylines(c.toUpperCase(), 1), c + ' igual a maiuscula');
}
assert.notDeepStrictEqual(Font.textPolylines('dieletrons.com', 1), Font.textPolylines('DIELETRONS.COM', 1));
for (const c of 'dieletrons.com') assert.strictEqual(Font.glyphFor(c), Font.FONTDATA[c], c + ': o glifo dele, nao o da maiuscula');
/* o n/u/x de "nF"/"uF" ficam como eram (o 'x' tem 2/3 h de altura: e o que o teste do Gerber mede) */
assert.deepStrictEqual(Font.FONTDATA.n, {"l":[[[0.238095,-0.714286],[0.238095,-0.047619]],[[0.238095,-0.619048],[0.285714,-0.666667],[0.380952,-0.714286],[0.52381,-0.714286],[0.619048,-0.666667],[0.666667,-0.571429],[0.666667,-0.047619]]],"w":0.904762});
assert.deepStrictEqual(Font.FONTDATA.x, {"l":[[[0.142857,-0.047619],[0.666667,-0.714286]],[[0.142857,-0.714286],[0.666667,-0.047619]]],"w":0.809524});
assert.deepStrictEqual(Font.FONTDATA.u, {"l":[[[0.666667,-0.714286],[0.666667,-0.047619]],[[0.238095,-0.714286],[0.238095,-0.190476],[0.285714,-0.095238],[0.380952,-0.047619],[0.52381,-0.047619],[0.619048,-0.095238],[0.666667,-0.142857]]],"w":0.904762});
/* a minuscula cai na maiuscula so se nao tiver glifo proprio: o 'ç' nao tem nem ele nem o 'Ç' (caixa) */
assert.strictEqual(Font.glyphFor('ç'), null);

/* ── o complemento na grade do Altium ('+' de polaridade, X, Z, simbolos), que morava so no
   hub-gerber.js: agora a HubFont o desenha, e o laser e o BOM param de por caixa no lugar ── */
for (const c of '+XZ*=<>?%():') {
  assert.ok(Font.GLIFOS_EXTRA[c], c);
  assert.strictEqual(Font.glyphFor(c), Font.GLIFOS_EXTRA[c], c + ': o do complemento');
}
assert.strictEqual(Font.textPolylines('+', 1).length, 2, "'+': dois tracos, nao a caixa");
/* o 'z' minusculo e o da newstroke, nao o 'Z' do complemento */
assert.strictEqual(Font.glyphFor('z'), Font.FONTDATA.z);

/* ── a janela Rust desenha com a mesma tabela (rust/crates/nexo-core/src/font.json) ── */
{
  const path = require('path'), fs = require('fs');
  const arq = path.join(__dirname, '..', 'rust', 'crates', 'nexo-core', 'src', 'font.json');
  if (fs.existsSync(arq)) {
    const rs = JSON.parse(fs.readFileSync(arq, 'utf8'));
    assert.deepStrictEqual(Object.keys(rs).sort(), Object.keys(Font.GLIFOS).sort(), 'font.json: as mesmas chaves da HubFont.GLIFOS');
    for (const c of Object.keys(rs)) assert.deepStrictEqual(rs[c], Font.GLIFOS[c], 'font.json: o glifo ' + c + ' da HubFont');
  }
}

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
