/* A busca do "Trocar componente" (hub-almoxpick.js), em Node.
 *
 *     node tests/test-almoxpick.js
 *
 * Busca que não acha não levanta exceção: devolve vazio e a tela diz "nenhuma família do
 * almoxarifado casa com esta busca" — indistinguível de a peça não existir. Foi assim que
 * procurar `SZMMSZ5240BT1G` voltava vazio tendo a resposta dentro (o part number está no
 * DIODO ZENER [PTH], no componente "PTH 10V 0.5W"). Por isso a regra é testada, e não
 * conferida no olho.
 *
 * O que este arquivo prende:
 *  1. o MPN é campo de busca — 956 dos 2513 valores do almoxarifado o têm;
 *  2. part number casa com ou sem separador, porque se escreve dos dois jeitos;
 *  3. as DUAS listas (famílias à esquerda, valores à direita) usam o MESMO predicado —
 *     enquanto foram duas cópias, acrescentar um campo numa fazia a família aparecer e a
 *     direita dizer "nenhum componente desta família passa no filtro";
 *  4. o filtro de saldo continua valendo junto com a busca.
 */
const assert = require('assert');
const A = require('../hub-almoxpick.js');

const it = (nome, rotulo, pkg, mpn, saldo) => ({ nome, rotulo, pkg, mpn, saldo });

const zener = { familia: 'DIODO ZENER [PTH]', valores: [
  it('PTH 10V 0.5W', 'PTH 10V 0.5W', 'DO-35', 'SZMMSZ5240BT1G', 12),
  it('PTH DO-35 20V 0.5W', '20V 0.5W', 'DO-35', 'SZMMSZ5250BT1G', 0),
]};
const cap = { familia: 'CAPACITOR CERAMICO [SMD]', valores: [
  it('SMD 0805 100nF', '0.1uF / 100nF 16V', '0805', '', 175),
  it('SMD 0805 1uF', '1uF 25V', '0805', 'CL21A105KBFNNNE', 0),
]};
const tvs = { familia: 'DIODO TVS UNIDIR [PTH]', valores: [
  it('(TVS) CDSOT23-SM712', 'CDSOT23-SM712', 'SOT-23', 'CDSOT23-SM712', 3),
]};
const TODOS = [zener, cap, tvs];
const nomes = r => r.map(x => x.g.familia);
const vistos = r => r.reduce((a, x) => a.concat(x.vis.map(v => v.nome)), []);

/* ── (1) o MPN acha o componente que o rótulo não acha ─────────────────────── */
let r = A.filtra(TODOS, 'SZMMSZ5240BT1G', 'all');
assert.deepStrictEqual(nomes(r), ['DIODO ZENER [PTH]'], 'o part number tem de achar a família');
assert.deepStrictEqual(vistos(r), ['PTH 10V 0.5W'],
  'e SÓ o componente que o carrega — não a família inteira');
/* o caso real que originou isto: nem o rótulo nem o nome contêm essas letras */
assert.ok(!/SZMMSZ/i.test('PTH 10V 0.5W'), 'o rótulo não tem o part number; é por isso que o campo era necessário');
console.log('(1) SZMMSZ5240BT1G acha "PTH 10V 0.5W" em DIODO ZENER [PTH]');

/* ── (2) com e sem separador ───────────────────────────────────────────────── */
for (const q of ['CDSOT23-SM712', 'CDSOT23SM712', 'cdsot23sm712', 'CDSOT23 SM712']){
  const v = vistos(A.filtra(TODOS, q, 'all'));
  assert.ok(v.includes('(TVS) CDSOT23-SM712'), 'não achou com ' + JSON.stringify(q) + ': ' + JSON.stringify(v));
}
assert.strictEqual(A.semSep('CDSOT23-SM712'), 'CDSOT23SM712');
/* O caminho SEM SEPARADOR não vale para busca curta. O teste tem de usar um caso em que só
   ele poderia casar — com `SM` o casamento vem do literal ('CDSOT23-SM712' contém 'SM'),
   que é o mesmo comportamento dos outros campos e continua valendo. */
const cur = it('x', 'x', '', 'A-BC', 1);
assert.strictEqual(A.valorCasa(cur, 'AB', A.semSep('AB')), false,
  'dois caracteres não disparam a comparação sem separador');
assert.strictEqual(A.valorCasa(cur, 'ABC', A.semSep('ABC')), true,
  'três já disparam: "ABC" acha o MPN "A-BC"');
/* e o literal continua valendo para trecho curto, como nos outros campos */
assert.strictEqual(A.valorCasa(it('x', 'x', '', 'CDSOT23-SM712', 1), 'SM', A.semSep('SM')), true,
  'o caminho literal não tem piso — quem digita "SM" está filtrando, não procurando');
console.log('(2) part number casa com hífen, sem hífen, com espaço e em minúscula');

/* ── (3) o mesmo predicado nas duas listas ─────────────────────────────────── */
/* é o teste que impede a volta do bug de origem: a família aparecer à esquerda e a lista
   da direita, com outra cópia da condição, dizer que não há componente nenhum */
for (const q of ['SZMMSZ5240BT1G', 'CDSOT23SM712', '100nF', 'zener', '0805']){
  const qq = q.toUpperCase(), qSem = A.semSep(qq);
  for (const linha of A.filtra(TODOS, q, 'all')){
    const famCasa = linha.g.familia.toUpperCase().indexOf(qq) >= 0;
    const daDireita = linha.g.valores.filter(x => famCasa || A.valorCasa(x, qq, qSem));
    assert.ok(daDireita.length, 'busca ' + JSON.stringify(q) + ': "' + linha.g.familia
      + '" entrou à esquerda e a direita ficaria vazia');
    assert.deepStrictEqual(daDireita.map(x => x.nome), linha.vis.map(x => x.nome),
      'as duas listas têm de ver os MESMOS componentes para ' + JSON.stringify(q));
  }
}
console.log('(3) as duas listas veem os mesmos componentes — um predicado só');

/* ── (4) busca e filtro de saldo valem juntos ──────────────────────────────── */
assert.deepStrictEqual(vistos(A.filtra(TODOS, 'SZMMSZ', 'all')), ['PTH 10V 0.5W', 'PTH DO-35 20V 0.5W']);
assert.deepStrictEqual(vistos(A.filtra(TODOS, 'SZMMSZ', 'stock')), ['PTH 10V 0.5W'], 'só o que tem saldo');
assert.deepStrictEqual(vistos(A.filtra(TODOS, 'SZMMSZ', 'nostock')), ['PTH DO-35 20V 0.5W'], 'só os zerados');
console.log('(4) o filtro de saldo continua valendo junto com a busca');

/* ── (5) o que não deve mudar ──────────────────────────────────────────────── */
assert.strictEqual(A.filtra(TODOS, 'NAOEXISTENADA', 'all').length, 0);
assert.strictEqual(A.filtra(TODOS, '', 'all').length, 3, 'sem busca, todas as famílias');
assert.strictEqual(A.filtra(TODOS, '   ', 'all').length, 3, 'só espaço é o mesmo que nada');
assert.deepStrictEqual(nomes(A.filtra(TODOS, 'ceramico', 'all')), ['CAPACITOR CERAMICO [SMD]'],
  'busca por família continua trazendo a família inteira');
assert.strictEqual(A.filtra(TODOS, 'ceramico', 'all')[0].vis.length, 2);
/* valor sem MPN não quebra nada */
assert.ok(A.valorCasa(it('SMD 0805 100nF', '0.1uF / 100nF 16V', '0805', '', 1), '100NF', '100NF'));
assert.strictEqual(A.valorCasa(it('x', 'x', '', undefined, 1), 'ABC', 'ABC'), false, 'mpn ausente não explode');
console.log('(5) busca vazia, por família e valor sem MPN continuam como eram');

console.log('\ntest-almoxpick OK (MPN na busca, com e sem separador, um predicado para as '
          + 'duas listas, saldo junto)');
