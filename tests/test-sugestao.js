/* suggestSym: achar um simbolo do almoxarifado para um componente que veio de outra
   biblioteca do Altium e nao resolve pelo nome.

   Os tres primeiros testes existem porque os tres bugs correspondentes eram SILENCIOSOS —
   a funcao devolvia lista, so que errada ou vazia, e so uma medicao contra os projetos
   reais mostrou. Sem eles aqui, voltam sem ninguem notar. */
const assert = require('assert');
const { loadVar } = require('./load');
const Core = require('../hub-core.js');

/* acervo sintetico: pequeno, explicito e independente do que houver em Libs/ hoje */
const val = (nome, extra) => Object.assign({ altium: nome, label: nome, itens: [] }, extra || {});
const ACERVO = [
  { name: 'DIODO RETIFICADOR [SMD]', familia: 'DIODO RETIFICADOR', designator: 'D',
    description: 'diodo retificador', footprints: [{ name: 'SOT-23' }],
    parts: [{ pins: [{ num: '1' }, { num: '2' }] }],
    valores: [val('SMD BAW56'), val('SMD BAV70'), val('SMD 1A 1000V M7 1n4007')] },
  { name: 'DIODO SCHOTTKY', familia: 'DIODO', designator: 'D',
    parts: [{ pins: [{ num: '1' }, { num: '2' }] }],
    valores: [val('PTH Schottky 30V 200mA BAT85')] },
  { name: 'CAPACITOR CERAMICO [SMD]', familia: 'CAPACITOR CERAMICO', designator: 'C',
    footprints: [{ name: 'CAP 0805' }], parts: [{ pins: [{ num: '1' }, { num: '2' }] }],
    valores: [val('SMD 0805 0.1uF 100nF 50V X7R')] },
  { name: 'CONECTOR 20V', familia: 'CONECTOR', designator: 'J',
    parts: [{ pins: Array.from({ length: 20 }, (_, i) => ({ num: String(i + 1) })) }], valores: [] },
  { name: 'CONECTOR 6V', familia: 'CONECTOR', designator: 'J',
    parts: [{ pins: Array.from({ length: 6 }, (_, i) => ({ num: String(i + 1) })) }], valores: [] },
  { name: 'CIRCUITO INTEGRADO [20P]', familia: 'CIRCUITO INTEGRADO', designator: 'U',
    parts: [{ pins: Array.from({ length: 20 }, (_, i) => ({ num: String(i + 1) })) }], valores: [] },
];
/* o alias por VALOR, do jeito que o schframe monta o SLIB */
const LISTA = ACERVO.slice();
for (const sy of ACERVO) for (const v of sy.valores)
  LISTA.push({ name: v.altium, designator: sy.designator, familia: sy.familia,
               description: sy.description, footprints: sy.footprints, parts: sy.parts,
               valores: [v], deValor: true });

const nomes = r => r.map(x => x.name);
const topo = (comp, n) => nomes(Core.suggestSym(comp, LISTA, { limit: n || 1 }));

/* ---- 1. TOKENIZACAO: normKey COLA a frase inteira ("Conector 2 Filas 20pin" vira
     "CONECTOR2FILAS20PIN"). Quebrar depois do normKey nao acha nada — foi assim que os
     120 conectores de um projeto real ficaram sem candidato NENHUM. ---- */
const conector = { sym: 'Conector 2 Filas 20pin', ref: 'CN1',
                   comment: 'Conector 2 Filas 20pin', footprint: 'CONN20_250-710_WAG' };
const rc = Core.suggestSym(conector, LISTA, { limit: 5 });
assert.ok(rc.length, 'nome com varias palavras TEM que achar candidato (bug da tokenizacao)');
assert.ok(nomes(rc).includes('CONECTOR 20V'),
  'devia sugerir CONECTOR 20V; veio ' + JSON.stringify(nomes(rc)));

/* ---- 2. DESIGNADOR: prefixo INTEIRO, nao prefixo-de-prefixo. "CN1" da "CN", que NAO e
     o "C" de capacitor — com startsWith, os conectores casavam com CAPACITOR. ---- */
assert.ok(!Core.suggestSym(conector, LISTA, { limit: 3 })
  .some(x => /CAPACITOR/.test(x.name) && x.porque.some(p => /designador/.test(p))),
  'CN nao pode ganhar bonus de designador de C (capacitor)');
const rd = Core.suggestSym({ sym: 'DIODO', ref: 'D3', comment: 'BAW56', footprint: 'SOT-23' }, LISTA, { limit: 4 });
assert.ok(rd.some(x => x.porque.includes('designador D')), 'D deve casar com designador D');

/* ---- 3. PINAGEM: so o MAIOR numero, e so com outro sinal junto. Em
     "CONE FIO 15P - 5.08" os numeros eram 15, 5 e 8, e o 5 casava com qualquer peca de 5
     pinos — ruido puro. E pinagem sozinha, sem nenhuma palavra em comum, nao identifica
     nada. ---- */
assert.ok(!Core.suggestSym({ sym: 'Coisa Nenhuma', ref: 'X1', comment: '', footprint: 'ZZZ_20' }, LISTA, { limit: 3 })
  .some(x => x.porque.some(p => /pinos/.test(p))),
  'pinagem sozinha, sem texto em comum, nao pode pontuar');
assert.ok(rc[0].porque.some(p => /20 pinos/.test(p)) || nomes(rc).includes('CONECTOR 20V'),
  'o 20 de "20pin"/"CONN20" tem que ser lido como pinagem');

/* ---- 4. COMENTARIO COLADO: o acervo grava "BAT85" e o Altium manda "BAT 85". ---- */
assert.strictEqual(topo({ sym: 'Diodo', ref: 'D1', comment: 'BAT 85', footprint: 'DO-34' })[0],
  'PTH Schottky 30V 200mA BAT85', 'comment com espaco tem que achar o nome colado');

/* ---- 5. O VALOR ganha da FAMILIA no empate: e a peca, nao a gaveta. ---- */
const rv = Core.suggestSym({ sym: 'DIODO', ref: 'D3', comment: 'BAW56', footprint: 'SOT-23' }, LISTA, { limit: 2 });
assert.strictEqual(rv[0].name, 'SMD BAW56',
  'o valor especifico vem antes da familia; veio ' + JSON.stringify(nomes(rv)));

/* ---- 6. FORMULA nao resolvida do Altium nao pode envenenar a busca ---- */
for (const f of ['=Value', "=Value + ' ' + Voltage", "=Value + '-' + Volts"]) {
  const r = Core.suggestSym({ sym: 'Cap Ceramico SMD', ref: 'C1', comment: f, footprint: 'CAP 0805' }, LISTA, { limit: 3 });
  assert.ok(!r.some(x => x.porque.some(p => /comment/.test(p))),
    `"${f}" e formula, nao pode contar como comment`);
}
/* mas o resto do componente ainda serve */
assert.ok(topo({ sym: 'Cap Ceramico SMD', ref: 'C1', comment: '=Value', footprint: 'CAP 0805' }, 3).length,
  'sem comment util, nome e footprint ainda tem que sugerir algo');

/* ---- 7. suggestSym SUGERE, nao resolve: nao pode mexer no que resolveLib devolve ---- */
assert.strictEqual(Core.symbolOf({ symbols: LISTA }, 'Conector 2 Filas 20pin'), null,
  'sugerir nao pode virar resolver — quem confirma e a pessoa, via lib-subs.js');

/* ---- 8. contrato da devolucao ---- */
const r8 = Core.suggestSym({ sym: 'DIODO', ref: 'D1', comment: 'BAW56' }, LISTA, { limit: 3 });
assert.ok(r8.length <= 3, 'limit respeitado');
for (const x of r8) {
  assert.ok(typeof x.name === 'string' && x.item && typeof x.pontos === 'number' && Array.isArray(x.porque),
    'cada candidato tem name/item/pontos/porque');
  assert.ok(x.pontos > 0, 'candidato com 0 ponto nao entra na lista');
}
for (let i = 1; i < r8.length; i++)
  assert.ok(r8[i - 1].pontos >= r8[i].pontos, 'a lista sai ordenada por pontos');

/* entrada vazia nao pode explodir */
for (const ruim of [null, {}, { sym: '' }, { sym: null, comment: null, ref: null, footprint: null }])
  assert.ok(Array.isArray(Core.suggestSym(ruim, LISTA, { limit: 3 })), 'entrada ' + JSON.stringify(ruim) + ' devolve array');
assert.deepStrictEqual(Core.suggestSym({ sym: 'X' }, null), [], 'lista ausente devolve vazio');

/* ---- 9. contra o acervo REAL: nao e sobre a nota, e sobre nao regredir a cobertura ---- */
const schlib = loadVar('Libs/schlib.js', 'schlib');
let real = schlib.symbols.slice();
for (const arq of [['Libs/almox-basicos.js', 'almoxBasicos'], ['Libs/almox-especiais.js', 'almoxEspeciais']]) {
  let g = null; try { g = loadVar(arq[0], arq[1]); } catch (e) { /* espelho pode nao estar sincronizado */ }
  if (g && g.symbols) real = real.concat(g.symbols);
}
const rr = Core.suggestSym({ sym: 'DIODO', ref: 'D1', comment: 'BAW56', footprint: 'SOT-23' }, real, { limit: 5 });
assert.ok(rr.length, 'o acervo real tem que sugerir algo para um BAW56');

console.log('test-sugestao OK');
