/* O acervo de um componente da folha (schframe.js » montaAcervos + acervoDoComp, 1.90.0).

   Bug do dono (2026-11-10): "mesmo o produto estando no acervo correto, aparece como biblioteca do
   altium". O acervo saía só do NOME DO SÍMBOLO, e o nome é do desenho: o conector de 80 vias do
   CBM-DI251876, vinculado ao almoxarifado (OdooId=3193 nos params), continuava desenhado pelo CONE PADRAO
   da SchLib do Altium e a ficha o pintava de vermelho, "vincule ao almoxarifado". Medido nos 25 projetos
   com esquema da pasta de trabalho: 25 designadores com OdooId de um acervo da casa caíam no acervo errado
   (6 deles no "▲ Biblioteca do Altium" vermelho, o resto em "—").
   Aqui: a identidade da peça (LocalId, depois OdooId) vem antes do nome; sem ela, o nome decide como
   antes — inclusive o "o do Altium ganha em caso de xará". */
const assert = require('assert');
global.HubCore = require('../hub-core.js');
const SF = require('../schframe.js');

const parte = { part: 1, pins: [{ num: '1', name: 'A', x: 0, y: 0, len: 100, orient: 0 }], graphics: [] };
const schlib = { title: 'Biblioteca do Altium', symbols: [
  { name: 'CONE PADRAO', parts: [parte] },
  { name: 'CAP EL [ PTH ]', parts: [parte] },
] };
const basicos = { title: 'Almoxarifado — Básicos', symbols: [
  { name: 'CONECTOR [PTH]', parts: [parte], valores: [
    { id: 1, altium: 'Conector RTELECS 80 vias', label: '80 vias', itens: [{ odoo: '3193', tmpl: '3190', nome: 'Conector 80' }] },
  ] },
] };
const especiais = { title: 'Almoxarifado — Especiais', symbols: [
  { name: 'ESP32 [MOD]', parts: [parte], valores: [
    { id: 1, altium: 'ESP32 WROOM', label: 'WROOM', itens: [{ odoo: '76', tmpl: '75', nome: 'ESP32' }] },
  ] },
] };
const locais = { title: 'Componentes criados localmente', symbols: [
  { name: 'TB005-762-12BE', parts: [parte], criadoLocal: { id: 'L5' }, valores: [{ id: 1, altium: 'Bloco 12 vias', label: '12 vias', itens: [] }] },
] };
const m = SF.montaAcervos({ schlib, almoxBasicos: basicos, almoxEspeciais: especiais, almoxLocais: locais });

assert.strictEqual(m.acervoPorOdoo.get('3193').id, 'almox-basicos', 'o OdooId de cada item aponta o acervo dele');
assert.strictEqual(m.acervoPorOdoo.get('76').id, 'almox-especiais');
assert.strictEqual(m.acervoPorLocal.get('L5').id, 'almox-locais', 'o id do componente criado localmente também');

const sym = n => m.symbols.find(s => s.name === n) || null;
const ac = (comp, nomeSym) => SF.acervoDoComp(comp, sym(nomeSym || comp.sym), m);

/* 1. O CASO DO BUG: desenhado pelo símbolo do Altium, vinculado ao almoxarifado pelo OdooId */
const cn1 = { t: 'comp', ref: 'CN1', sym: 'CONECTOR PADRÃO',
              params: 'Comment=2.54-5/80 RTELECS 80 PIN;OdooId=3193;Estoque=3;Local=CX-12' };
let r = ac(cn1, 'CONE PADRAO');
assert.strictEqual(r.acervo.id, 'almox-basicos', 'vinculado pelo OdooId: o acervo é o do almoxarifado, não o do desenho');
assert.strictEqual(r.por, 'odoo');
assert.strictEqual(r.odoo, '3193');
/* era assim antes (o nome do símbolo): é o que a ficha dizia, em vermelho */
assert.strictEqual(m.acervoDe.get('CONE PADRAO').id, 'altium');

/* 2. OdooId com espaço/vários ids: vale o primeiro que um acervo conhece */
r = ac({ ref: 'MD2', sym: 'ESP32', params: 'OdooId = 999999, 76' }, null);
assert.strictEqual(r.acervo.id, 'almox-especiais');

/* 3. LocalId passa na frente de tudo */
r = ac({ ref: 'CN9', sym: 'CONE PADRAO', params: 'LocalId=L5;OdooId=3193' });
assert.strictEqual(r.acervo.id, 'almox-locais');
assert.strictEqual(r.por, 'local');

/* 4. SEM IDENTIDADE nada muda: o nome decide, e o do Altium continua sendo Altium (o C3 do DMB: sem OdooId,
   sem valor do almoxarifado com o nome dele — o aviso vermelho ali é verdadeiro) */
r = ac({ ref: 'C3', sym: 'CAP EL [ PTH ]', params: 'Value=10uF' });
assert.strictEqual(r.acervo.id, 'altium');
assert.strictEqual(r.por, 'nome');
/* o alias por valor do almoxarifado, pelo nome, como sempre */
r = ac({ ref: 'CN2', sym: 'Conector RTELECS 80 vias', params: '' });
assert.strictEqual(r.acervo.id, 'almox-basicos');
assert.strictEqual(r.por, 'nome');

/* 5. OdooId que o espelho não conhece (produto novo, sem sincronizar): cai no nome, não inventa acervo */
r = ac({ ref: 'CN3', sym: 'CONE PADRAO', params: 'OdooId=424242' }, 'CONE PADRAO');
assert.strictEqual(r.acervo.id, 'altium');

/* 6. o símbolo resolvido por outro nome (renomeação): o nome RESOLVIDO conta, como antes */
r = ac({ ref: 'CN4', sym: 'CONECTOR PADRÃO', params: '' }, 'CONE PADRAO');
assert.strictEqual(r.acervo.id, 'altium');

/* 7. nada: null, sem exceção */
assert.strictEqual(ac({ ref: 'X1', sym: 'NAO EXISTE', params: '' }), null);
assert.strictEqual(SF.acervoDoComp(null, null, m), null);
assert.strictEqual(SF.acervoDoComp(cn1, null, null), null);

console.log('ok - acervo do componente: OdooId/LocalId antes do nome do desenho');
