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


/* ══════════════════════════════════════════════════════════════════════════════
   O CONECTOR POR SUBTIPO (2026-09-22)

   A lista da esquerda era uma linha por SÍMBOLO, e o símbolo se parte por número de
   pinos: procurar um bloco terminal Phoenix de 4 vias queria dizer adivinhar as vias
   primeiro, achar "CONECTOR 4V" entre 25 irmãs ordenadas 10V, 12V, 13V, 2V, 20V… e só
   então ler 25 rótulos quase iguais. Agora a linha é a FAMÍLIA (= o subtipo) e as vias
   descem para o rótulo do valor.

   O que este bloco prende:
    6. a chave do grupo junta os símbolos da família e NÃO junta o que a montagem separa;
    7. a linha do conector é montada dos campos, e campo que o Odoo não diz não aparece;
    8. a busca por vias continua funcionando — ela dependia do nome do símbolo, que saiu
       da lista da esquerda;
    9. a ordem da direita é por vias, não alfabética.
   ══════════════════════════════════════════════════════════════════════════════ */

/* ── (6) a chave do grupo ──────────────────────────────────────────────────── */
const sym = (name, familia, grupo, montagem) => ({ name, familia, grupo, montagem });
assert.strictEqual(A.chaveDoGrupo(sym('CONECTOR BLOCO TERMINAL 4V', 'CONECTOR BLOCO TERMINAL', 'basicos', '')),
  'CONECTOR BLOCO TERMINAL', 'o número de vias sai da linha da esquerda');
assert.strictEqual(A.chaveDoGrupo(sym('CONECTOR BLOCO TERMINAL 12V', 'CONECTOR BLOCO TERMINAL', 'basicos', '')),
  'CONECTOR BLOCO TERMINAL', 'e 4V e 12V caem na MESMA linha');
assert.strictEqual(A.chaveDoGrupo(sym('RESISTOR [SMD]', 'RESISTOR', 'basicos', 'SMD')),
  'RESISTOR [SMD]', 'a montagem continua separando — o símbolo é mesmo partido por ela');
assert.strictEqual(A.chaveDoGrupo(sym('RESISTOR [PTH]', 'RESISTOR', 'basicos', 'PTH')),
  'RESISTOR [PTH]', 'e SMD não se mistura com PTH');
assert.strictEqual(A.chaveDoGrupo(sym('CIRCUITO INTEGRADO [8P]', 'CIRCUITO INTEGRADO', 'especiais', 'PTH')),
  'CIRCUITO INTEGRADO',
  'nos especiais a montagem é só a do primeiro item que criou o símbolo: dividir por ela é dividir por acaso');
console.log('(6) a chave do grupo junta por família e respeita a montagem dos básicos');

/* ── (7) a linha do conector ───────────────────────────────────────────────── */
assert.strictEqual(A.linhaConn({ vias: 4, matriz: '', passo: 3.81, angulo: 180, genero: 'femea' }),
  '4 vias 3.81 180° femea', 'o pedido do usuário, na ordem pedida');
assert.strictEqual(A.linhaConn({ vias: 26, matriz: '2x13', passo: 2.54, angulo: 180, genero: '' }),
  '26 vias (2x13) 2.54 180°',
  'a matriz fica: 1x8 e 2x4 têm oito vias os dois e footprints diferentes');
assert.strictEqual(A.linhaConn({ vias: 4, matriz: '', passo: null, angulo: 0, genero: '' }), '4 vias',
  'em circular MIL o passo e o ângulo não existem como propriedade — campo vazio não aparece');
assert.strictEqual(A.linhaConn({ vias: 1, matriz: '', passo: null, angulo: 0, genero: '' }), '1 via',
  'uma via não é "1 vias"');
assert.strictEqual(A.linhaConn(null), '', 'valor que não é conector não tem linha');
console.log('(7) a linha do conector sai dos campos, e o que o Odoo não diz não aparece');

/* ── (8) a busca por vias sobrevive à saída do número da esquerda ──────────── */
const conn = (nome, rotulo, c, symName) => ({
  nome, rotulo, pkg: '', mpn: '', saldo: 1, conn: c, linha: A.linhaConn(c),
  tipo: (c && c.tipo) || '', sym: { name: symName },
});
const bt4 = conn('Bloco Terminal MC 1,5/ 4-STF-3,81', 'Bloco Terminal MC 1,5/ 4-STF-3,81',
  { vias: 4, matriz: '', passo: 3.81, angulo: 0, genero: 'femea', tipo: 'MC 1,5/ 4-STF-3,81' },
  'CONECTOR BLOCO TERMINAL 4V');
const bt2 = conn('Bloco Terminal MSTB 2,5/ 2-GF-5,08', 'Bloco Terminal MSTB 2,5/ 2-GF-5,08',
  { vias: 2, matriz: '', passo: 5.08, angulo: 0, genero: 'macho', tipo: 'MSTB 2,5/ 2-GF-5,08' },
  'CONECTOR BLOCO TERMINAL 2V');
const blocos = { familia: 'CONECTOR BLOCO TERMINAL', valores: [bt4, bt2] };

assert.deepStrictEqual(vistos(A.filtra([blocos], '4 vias', 'all')), [bt4.nome],
  '"4 vias" tem de achar — a linha da esquerda não traz mais o número');
assert.deepStrictEqual(vistos(A.filtra([blocos], '4V', 'all')), [bt4.nome],
  '"4V" também, pelo nome do símbolo, que é o costume de quem usava a lista antiga');
assert.deepStrictEqual(vistos(A.filtra([blocos], '5.08', 'all')), [bt2.nome], 'busca por passo');
assert.deepStrictEqual(vistos(A.filtra([blocos], 'macho', 'all')), [bt2.nome], 'busca por gênero');
assert.deepStrictEqual(vistos(A.filtra([blocos], 'MC 1,5/ 4-STF-3,81', 'all')), [bt4.nome],
  'busca pelo código do fabricante, que é o que se tem na mão olhando a peça');
assert.deepStrictEqual(vistos(A.filtra([blocos], 'MC1,54STF3,81', 'all')), [bt4.nome],
  'e sem os separadores, como já valia para o MPN');
assert.deepStrictEqual(vistos(A.filtra([blocos], 'MC 1.5/ 4-STF-3.81', 'all')), [bt4.nome],
  'o MESMO codigo escrito com PONTO: o Odoo cadastra as duas formas do mesmo bloco '
  + 'terminal Phoenix, e quem digita le o codigo da peca, nao do cadastro');
assert.strictEqual(A.semSep('MC 1,5/ 4-STF-3,81'), A.semSep('MC 1.5/ 4-STF-3.81'),
  'virgula e ponto tem de colapsar no mesmo texto');
assert.deepStrictEqual(vistos(A.filtra([blocos], 'BLOCO TERMINAL', 'all')), [bt4.nome, bt2.nome],
  'buscar a família traz a família inteira');
console.log('(8) a busca por vias, passo, gênero e código do fabricante');

/* ── (9) a ordem da direita ────────────────────────────────────────────────── */
const ordenados = [bt4, bt2].slice().sort(A.comparaValor).map(x => x.conn.vias);
assert.deepStrictEqual(ordenados, [2, 4], 'do menor número de vias para o maior');
const semVias = conn('X', 'X', { vias: 0, matriz: '', passo: null, angulo: 0, genero: '', tipo: '' }, 'S');
assert.strictEqual([bt4, semVias, bt2].slice().sort(A.comparaValor)[0], semVias,
  'quem não tem vias legível fica no começo, junto — não espalhado pela lista');
console.log('(9) a lista da direita ordena por vias, não alfabeticamente');

/* ── (10) a busca por PALAVRAS SOLTAS ──────────────────────────────────────
   "10 conector 2.54 bloco terminal": metade da frase descreve a FAMILIA e a outra metade o
   COMPONENTE, e nenhum campo contem a frase inteira. Cada palavra e uma exigencia a parte e
   pode ser satisfeita pela familia OU pelo valor. */
const bt10 = conn('Bloco Terminal MSTB 2,5/10-GF-5,08', 'Bloco Terminal MSTB 2,5/10-GF-5,08',
  { vias: 10, matriz: '', passo: 2.54, angulo: 180, genero: 'macho', tipo: 'MSTB 2,5/10-GF-5,08' },
  'CONECTOR BLOCO TERMINAL');
const bt10b = conn('Bloco Terminal MC 1,5/10-ST-3,81', 'Bloco Terminal MC 1,5/10-ST-3,81',
  { vias: 10, matriz: '', passo: 3.81, angulo: 180, genero: 'femea', tipo: 'MC 1,5/10-ST-3,81' },
  'CONECTOR BLOCO TERMINAL');
const latch10 = conn('Latch 10 vias', 'Latch 10 vias',
  { vias: 10, matriz: '2x5', passo: 2.54, angulo: 180, genero: '', tipo: '' }, 'CONECTOR LATCH');
const acervo = [
  { familia: 'CONECTOR BLOCO TERMINAL', valores: [bt4, bt2, bt10, bt10b] },
  { familia: 'CONECTOR LATCH', valores: [latch10] },
];

assert.deepStrictEqual(vistos(A.filtra(acervo, '10 conector 2.54 bloco terminal', 'all')),
  [bt10.nome],
  'as cinco palavras juntas: 10 vias E passo 2.54 E da familia bloco terminal');
assert.deepStrictEqual(vistos(A.filtra(acervo, 'conector 10', 'all')),
  [bt10.nome, bt10b.nome, latch10.nome],
  '"conector 10" pega os tres de 10 vias, de duas familias');
assert.deepStrictEqual(vistos(A.filtra(acervo, 'latch 10', 'all')), [latch10.nome],
  'a palavra da familia estreita para uma so');
assert.deepStrictEqual(vistos(A.filtra(acervo, '2.54 10 latch', 'all')), [latch10.nome],
  'a ordem das palavras nao importa');
assert.deepStrictEqual(vistos(A.filtra(acervo, '10 2x5', 'all')), [latch10.nome],
  'a montagem da matriz (2 linhas x 5 colunas) tambem e palavra de busca');
assert.deepStrictEqual(vistos(A.filtra(acervo, 'bloco terminal 10 femea', 'all')), [bt10b.nome],
  'genero entra na conjuncao como qualquer outra palavra');
assert.deepStrictEqual(vistos(A.filtra(acervo, '10 conector 9.5', 'all')), [],
  'palavra que nao casa nada derruba a linha inteira — e conjuncao, nao soma');
/* e a busca de UMA palavra continua sendo o que era */
assert.deepStrictEqual(vistos(A.filtra(acervo, 'BLOCO TERMINAL', 'all')),
  [bt4.nome, bt2.nome, bt10.nome, bt10b.nome], 'duas palavras que sao a familia: familia inteira');
console.log('(10) a busca conjuga palavras soltas: familia + vias + passo + matriz + genero');

/* ── (11) numero procurado e numero INTEIRO ────────────────────────────────
   Achado no navegador, nao aqui: "10 conector 2.54 bloco terminal" devolvia um conector de
   4 vias e passo 5,08. O "10" casava dentro do numero de pedido (0710196) e o "2.54" casava
   pelo caminho sem separadores, onde "2,5/ 4" (bitola + vias) colapsa em "254". */
const pedido = conn('Bloco Terminal Header DFK-MSTB 2,5/ 4-GF-5,08 (0710196)',
  'Bloco Terminal Header DFK-MSTB 2,5/ 4-GF-5,08 (0710196)',
  { vias: 4, matriz: '', passo: 5.08, angulo: 0, genero: 'macho', tipo: 'DFK-MSTB 2,5/ 4-GF-5,08' },
  'CONECTOR BLOCO TERMINAL');
const so = [{ familia: 'CONECTOR BLOCO TERMINAL', valores: [pedido] }];
assert.deepStrictEqual(vistos(A.filtra(so, '10', 'all')), [],
  'o "10" de dentro de "(0710196)" nao e dez vias');
assert.deepStrictEqual(vistos(A.filtra(so, '2.54', 'all')), [],
  'nem o "254" que sai de colapsar "2,5/ 4" — esse caminho e so para part number');
assert.deepStrictEqual(vistos(A.filtra(so, '4', 'all')), [pedido.nome], 'as 4 vias de verdade casam');
assert.deepStrictEqual(vistos(A.filtra(so, '5.08', 'all')), [pedido.nome], 'e o passo de verdade');
assert.deepStrictEqual(vistos(A.filtra(so, 'DFK-MSTB 2,5/ 4-GF-5,08', 'all')), [pedido.nome],
  'o codigo colado inteiro continua achando — o termo tem letra');
/* a fronteira e de DIGITO, nao de palavra: o numero dentro de um codigo continua valendo */
assert.ok(A.valorCasa(it('PTH DIP8 LM555', 'DIP8 LM555', '', '', 1), '555', '555'),
  '"555" acha "LM555": o que veio antes e letra, nao digito');
assert.strictEqual(A.valorCasa(it('SMD 0805 100nF', '100nF 16V', '0805', '', 1), '10', '10'), false,
  '"10" nao acha "100nF"');
assert.ok(A.valorCasa(it('SMD 0805 10K', '10K 1%', '0805', '', 1), '10', '10'), '"10" acha "10K"');
console.log('(11) numero e numero inteiro: nao casa pedaco de outro numero');


/* ── (12) o filtro FORA ────────────────────────────────────────────────────
   `fora` e `zerado` nao sao a mesma coisa e o olho nao separa: os dois mostram 0 de saldo.
   Zerado e peca do catalogo que acabou e volta na proxima compra; FORA e peca que saiu do
   Odoo -- ou que perdeu a marca "e componente eletronico" -- e so volta se alguem mexer no
   cadastro. Quem esta caçando o que sumiu precisa de uma lista so com esses. */
const iF = (nome, saldo, fora) => ({ nome, rotulo: nome, pkg: '', mpn: '', saldo, fora });
const mix = [{ familia: 'CAPACITOR', valores: [
  iF('com saldo', 12, false),
  iF('zerado', 0, false),
  iF('saiu do odoo', 0, true),
  iF('saiu mas tinha saldo', 7, true),
]}];
assert.deepStrictEqual(vistos(A.filtra(mix, '', 'all')).length, 4, 'Tudo mostra os quatro');
assert.deepStrictEqual(vistos(A.filtra(mix, '', 'fora')), ['saiu do odoo', 'saiu mas tinha saldo'],
  'o filtro Fora traz SO os que sairam, com saldo ou sem');
assert.deepStrictEqual(vistos(A.filtra(mix, '', 'nostock')), ['zerado'],
  'Zerados nao pode mais trazer os que sairam: eram dois tipos de zero no mesmo balde');
assert.deepStrictEqual(vistos(A.filtra(mix, '', 'stock')), ['com saldo'],
  'e Com saldo nao traz quem saiu, mesmo que o saldo ainda nao tenha zerado');

const c = A.contagens(mix);
assert.strictEqual(c.tudo, 4);
assert.strictEqual(c.fora, 2, 'a contagem do botao Fora');
assert.strictEqual(c.comSaldo, 1, 'e as outras duas nao contam quem saiu');
assert.strictEqual(c.zerados, 1);
assert.strictEqual(c.comSaldo + c.zerados + c.fora, c.tudo, 'os tres botoes somam o total');

/* a busca continua valendo junto com o filtro */
assert.deepStrictEqual(vistos(A.filtra(mix, 'odoo', 'fora')), ['saiu do odoo']);
console.log('(12) o filtro Fora separa quem saiu do Odoo de quem so esta zerado');

/* (13) O MESMO PRODUTO DO ODOO EM MAIS DE UM COMPONENTE (2026-09-29). O TMAG5131A1 ficou nº 4
   `fora` com o nome antigo e nº 46 vivo com o novo, os dois com o produto 1523. A regra e a do
   servidor (almox2lib.duplicados_odoo): aqui ela marca a linha. */
{
  const zumbi = { id: 4, altium: 'Hall / Magnetico TMAG5131A1', fora: true, itens: [{ odoo: '1523' }] };
  const vivo = { id: 46, altium: 'Hall Magnetico TMAG5131A1', itens: [{ odoo: 1523 }, { odoo: '1523' }] };
  const so = { id: 7, altium: 'Sozinho', itens: [{ odoo: '900' }] };
  const semId = { id: 8, altium: 'Sem id', itens: [{}] };
  const noutro = { id: 1, altium: 'Outra familia', itens: [{ odoo: '1523' }, { odoo: '77' }] };
  const syms = [{ name: 'SENSOR', valores: [zumbi, vivo, so, semId] }, { name: 'CI', valores: [noutro] }];
  assert.deepStrictEqual(A.idsOdooDoValor(vivo), ['1523'], 'numero e texto sao o mesmo id, uma vez so');
  const d = A.duplicadosOdoo(syms);
  assert.deepStrictEqual([...d.keys()], ['1523'], 'so o produto que aparece mais de uma vez');
  assert.strictEqual(d.get('1523').length, 3);
  assert.deepStrictEqual(A.gemeosDe(zumbi, d).map(x => x.v.id), [46, 1], 'os outros, nunca ele mesmo');
  assert.deepStrictEqual(A.gemeosDe(noutro, d).map(x => [x.v.id, x.sym.name, x.odoo]),
                         [[4, 'SENSOR', '1523'], [46, 'SENSOR', '1523']], 'atravessa familia');
  assert.deepStrictEqual(A.gemeosDe(so, d), [], 'sem gemeo, nada');
  assert.deepStrictEqual(A.gemeosDe(semId, d), [], 'sem id, nada');
  assert.strictEqual(A.duplicadosOdoo([]).size, 0);
  console.log('(13) o mesmo produto do Odoo em dois componentes e apontado, atravessando familia');
}



console.log('\ntest-almoxpick OK (MPN na busca com e sem separador, um predicado '
          + 'para as duas listas, saldo junto, e o conector por subtipo: chave do '
          + 'grupo, linha dos campos, busca por vias/passo/genero/codigo, ordem por vias)');
