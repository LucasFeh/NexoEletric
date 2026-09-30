/* A parte no "Adicionar componentes", em qualquer acervo (schframe.js » partesDe, nPartes,
   refDaParte e o alias por valor do montaAcervos).

   O pedido (2026-09-30): "na hora de adicionar um componente novo, em qualquer campo, eu consiga
   selecionar a parte caso tenha". O seletor existia só para a biblioteca do Altium; no
   almoxarifado a família tem uma parte só, mas o VALOR pode ter o desenho dele em várias (o
   "+ parte" do editor grava valores[].parts), e esse entrava sempre com a primeira. E a parte
   escolhida precisa de onde se encaixar: a 2 de um amplificador duplo é o MESMO U1 da parte 1 —
   com designador novo ela nascia U2, sozinha, e a ficha não a deixava virar U1.

   Roda em Node, sem DOM: schframe.js sai no module.exports antes de tocar em document. */
const assert = require('assert');
const SF = require('../schframe.js');

const parte = (n, pinos) => ({ part: n, pins: Array.from({ length: pinos }, (_, i) =>
  ({ num: String(i + 1), name: 'P' + (i + 1), x: 0, y: -100 * i, len: 100, orient: 180 })), graphics: [] });

/* ── 1. quantas partes, e de onde vem o desenho ── */
const rele = { name: 'RELE FINDER', partcount: 3, parts: [parte(1, 2), parte(2, 2), parte(3, 2)] };
assert.strictEqual(SF.nPartes(rele, null), 3, 'símbolo do Altium: as partes são do símbolo');
assert.strictEqual(SF.partesDe(rele, null), rele.parts);

const familia = { name: 'RELE [PTH]', familia: 'RELE', designator: 'K', parts: [parte(1, 5)],
                  valores: [
                    { id: 1, altium: 'RELE 12V 1 CONTATO', label: '12V' },
                    /* desenhado no editor em duas partes: a bobina e o contato */
                    { id: 2, altium: 'RELE 24V 2 CONTATOS', label: '24V', parts: [parte(1, 2), parte(2, 3)] },
                  ] };
assert.strictEqual(SF.nPartes(familia, familia.valores[0]), 1,
  'valor sem desenho próprio usa o da família, que tem uma parte só');
assert.strictEqual(SF.partesDe(familia, familia.valores[0]), familia.parts);
assert.strictEqual(SF.nPartes(familia, familia.valores[1]), 2,
  'valor desenhado em duas partes TEM duas — era isto que o modal escondia');
assert.strictEqual(SF.partesDe(familia, familia.valores[1]), familia.valores[1].parts,
  'o desenho do valor ganha o da família, como na folha');
assert.strictEqual(SF.nPartes({ name: 'VAZIO' }, null), 1, 'sem desenho nenhum ainda conta uma parte');
assert.deepStrictEqual(SF.partesDe({ name: 'VAZIO' }, { id: 1 }), []);

/* ── 2. a FOLHA conta igual ao modal: o alias por valor leva o partcount do desenho dele ── */
const m = SF.montaAcervos({ almoxBasicos: { format: 'schlib-v2', title: 'Almoxarifado — Básicos',
                                            symbols: [familia] } });
const a1 = m.symbols.find(s => s.name === 'RELE 12V 1 CONTATO');
const a2 = m.symbols.find(s => s.name === 'RELE 24V 2 CONTATOS');
assert.strictEqual(a1.partcount, 1);
assert.strictEqual(a1.parts, familia.parts, 'o alias continua reaproveitando a geometria da família');
assert.strictEqual(a2.partcount, 2, 'o 1 cravado no alias fazia a ficha dizer "1 de 1" num relé de duas partes');
assert.strictEqual(a2.parts, familia.valores[1].parts);

/* ── 3. a parte acha o seu componente (refDaParte) ── */
let n = 0;
const novo = () => 'U' + (++n);
const peca = (part, extra) => Object.assign({ sym: 'LM358', part, partes: 2, footprint: 'SO8',
                                              comment: 'LM358' }, extra || {});
const comp = (ref, part, extra) => Object.assign({ t: 'comp', ref, sym: 'LM358', part, footprint: 'SO8',
                                                   comment: 'LM358' }, extra || {});

n = 1;
assert.deepStrictEqual(SF.refDaParte([comp('U1', 1)], peca(2), novo), { ref: 'U1', junto: true },
  'a parte 2 vai para o U1, que só tinha a parte 1');
n = 1;
assert.deepStrictEqual(SF.refDaParte([comp('U1', 1), comp('U1', 2)], peca(2), novo), { ref: 'U2', junto: false },
  'U1 completo: a parte 2 começa outro componente');
n = 1;
assert.deepStrictEqual(SF.refDaParte([comp('U1', 1)], peca(1), novo), { ref: 'U2', junto: false },
  'a mesma parte de novo é outro componente, nunca um ref/part repetido');
n = 1;
assert.deepStrictEqual(SF.refDaParte([comp('U1', 1, { comment: 'LM2904' })], peca(2), novo),
  { ref: 'U2', junto: false }, 'outro comment é outro valor: não se junta');
n = 1;
assert.deepStrictEqual(SF.refDaParte([comp('U1', 1, { footprint: 'DIP8' })], peca(2), novo),
  { ref: 'U2', junto: false }, 'outro footprint é outra peça: não se junta');
n = 12;
assert.deepStrictEqual(SF.refDaParte([comp('U10', 1), comp('U2', 1)], peca(2), novo), { ref: 'U2', junto: true },
  'dois livres: o de menor número, em ordem natural (U2 antes de U10)');
n = 1;
assert.deepStrictEqual(SF.refDaParte([comp('U1', 1), { t: 'comp', ref: 'U1', sym: 'OUTRO', part: 3 }], peca(2), novo),
  { ref: 'U2', junto: false }, 'designador que já mistura outra peça não recebe mais nada');
n = 0;
assert.deepStrictEqual(SF.refDaParte([], peca(2), novo), { ref: 'U1', junto: false }, 'folha vazia: designador novo');

/* componente de UMA parte só nunca se junta a nada — é o caso de todo dia, e ele não muda */
n = 1;
assert.deepStrictEqual(SF.refDaParte([comp('R1', 1, { sym: 'RES', comment: '10K', footprint: '0805' })],
  { sym: 'RES', part: 1, partes: 1, footprint: '0805', comment: '10K' }, () => 'R2'), { ref: 'R2', junto: false });
assert.deepStrictEqual(SF.refDaParte([], { sym: 'RES', part: 1, footprint: '0805' }, () => 'R1'),
  { ref: 'R1', junto: false }, 'item sem `partes` (lista antiga) vale como uma parte');

/* ── 4. o Finalizar inteiro, na ordem da lista: é assim que o modal monta um componente ── */
function finaliza(folha, lista){
  const saiu = [];
  let k = folha.length;
  for (const item of lista) for (let q = 0; q < item.qtd; q++){
    const d = SF.refDaParte(folha.concat(saiu), item, () => 'U' + (++k));
    saiu.push(comp(d.ref, item.part));
  }
  return saiu.map(c => c.ref + '/' + c.part);
}
assert.deepStrictEqual(finaliza([], [Object.assign(peca(1), { qtd: 1 }), Object.assign(peca(2), { qtd: 1 })]),
  ['U1/1', 'U1/2'], 'parte 1 e parte 2 na mesma lista: UM componente');
assert.deepStrictEqual(finaliza([], [Object.assign(peca(2), { qtd: 1 }), Object.assign(peca(1), { qtd: 1 })]),
  ['U1/2', 'U1/1'], 'a ordem da lista não importa');
assert.deepStrictEqual(finaliza([], [Object.assign(peca(1), { qtd: 2 }), Object.assign(peca(2), { qtd: 2 })]),
  ['U1/1', 'U2/1', 'U1/2', 'U2/2'], 'duas de cada: dois componentes completos');

console.log('test-add-partes: ok');
