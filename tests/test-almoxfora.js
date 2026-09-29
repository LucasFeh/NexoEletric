/* Os "fora" do painel de valores da Biblioteca (hub-almoxfora.js), em Node.
 *
 *     node tests/test-almoxfora.js
 *
 * Pedido do dono (2026-09-29): selecionar todos os fora da categoria e apagar. O que se prende
 * aqui é a regra que erra calada: quem entra na seleção (só fora, pelo nome do Altium), a
 * seleção que se limpa sozinha quando o componente some ou volta ao Odoo, e o texto da pergunta
 * — que tem de dizer quantos, quais ficam de fora e quem vira órfão na folha.
 */
'use strict';
const assert = require('assert');
const F = require('../hub-almoxfora.js');
const { nomesFora, ajusta, textoDaPergunta } = F.pure;

const parts = [
  { altium: 'R velho', fora: true }, { altium: 'R vivo' }, { altium: 'R saiu', fora: true },
  { fora: true },                       /* sem nome: não dá para pedir ao servidor */
  null,
];
assert.deepStrictEqual(nomesFora(parts), ['R velho', 'R saiu'], 'só os fora, e só com nome');
assert.deepStrictEqual(nomesFora(null), []);

const sel = new Set(['R velho', 'R saiu', 'R vivo', 'NAO EXISTE']);
assert.strictEqual(ajusta(sel, parts), sel, 'ajusta no lugar');
assert.deepStrictEqual([...sel], ['R velho', 'R saiu'], 'vivo e sumido saem da seleção sozinhos');
/* o produto voltou ao Odoo: deixa de ser fora, sai da seleção */
ajusta(sel, [{ altium: 'R velho' }, { altium: 'R saiu', fora: true }]);
assert.deepStrictEqual([...sel], ['R saiu']);
console.log('(1) a seleção só guarda fora, e se limpa sozinha');

let t = textoDaPergunta({ alvos: [{}, {}], ignorados: [], usos: [], total: 0, orfaos: 0 }, 'desta categoria (R)');
assert.ok(/^Apagar 2 componentes fora desta categoria \(R\)\?/.test(t), t);
assert.ok(/mesmo número/.test(t) && !/EM USO/.test(t), 'sem uso, não fala de projeto');
t = textoDaPergunta({ alvos: [{}], ignorados: [{ altium: 'R vivo', porque: 'não está fora: voltou ao Odoo' }],
                      usos: [{ projeto: 'P1', refs: ['R1', 'R2'], orfaos: ['R2'] }], total: 2, orfaos: 1 },
                    'da biblioteca inteira');
assert.ok(/^Apagar 1 componente fora da biblioteca inteira\?/.test(t), 'singular: ' + t);
assert.ok(/1 da seleção não entra:\n  · R vivo — não está fora: voltou ao Odoo/.test(t), t);
assert.ok(/EM USO por 2 componente\(s\) nos projetos:\n  · P1: R1, R2/.test(t), t);
assert.ok(/1 fica\(m\) órfão\(s\).*P1: R2\./.test(t) && /Os outros a folha leva sozinha/.test(t), t);
t = textoDaPergunta({ alvos: [{}], ignorados: [], usos: [{ projeto: 'P1', refs: ['U1'], orfaos: [] }], total: 1, orfaos: 0 }, 'x');
assert.ok(/Todos têm o id de um produto que vive noutro componente/.test(t), t);
console.log('(2) a pergunta diz quantos, quem fica de fora e quem vira órfão');

console.log('\ntest-almoxfora OK (só fora na seleção, limpeza sozinha, texto da pergunta)');
