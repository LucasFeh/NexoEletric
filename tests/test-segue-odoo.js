/* A folha segue o PRODUTO do Odoo, não o nome (schframe.js » seguePeloOdoo).
 *
 *     node tests/test-segue-odoo.js
 *
 * Pedido do dono (2026-09-29): tudo é vinculado pelo ID do Odoo. O `sym` de um componente do
 * almoxarifado é o NOME do valor, e o nome sai do cadastro: renomear o produto deixava a folha
 * apontando para um nome que não existe (quadrado vermelho) ou para o zumbi `fora` que a
 * renomeação deixou — o desenho da família no lugar do símbolo aplicado. O OdooId no `params`
 * não muda; é por ele que a folha acha o nome de hoje.
 *
 * Os acervos são montados pelo montaAcervos e o nome resolvido pelo HubCore.resolveSym de
 * verdade: a regra é provada com o mesmo resolvedor que a folha usa.
 */
'use strict';
const assert = require('assert');
const SF = require('../schframe.js');
const Core = require('../hub-core.js');

const ok = SF.seguePeloOdoo;
assert.strictEqual(typeof ok, 'function', 'seguePeloOdoo tem de sair no PURE');

const par = (n, v) => ({ n, v });
const valor = (id, altium, label, oid, fora) => Object.assign({
  id, altium, label, itens: oid ? [{ odoo: oid }] : [],
  params: [par('Comment', label), par('Value', label), par('OdooId', fora ? '' : (oid || ''))],
}, fora ? { fora: true, estoque: 0 } : {});

const SENSOR = { name: 'SENSOR [PINAGEM A DEFINIR]', designator: 'U', parts: [], valores: [
  valor(4, 'Hall / Magnetico TMAG5131A1', 'Hall / Magnetico TMAG5131A1', '1523', true),   // o zumbi
  valor(46, 'Hall Magnetico TMAG5131A1', 'Hall Magnetico TMAG5131A1', '1523'),            // o vivo
  valor(9, 'Outro sensor', 'Outro sensor', '700'),
]};
const RES = { name: 'RESISTOR [SMD]', designator: 'R', parts: [], valores: [
  valor(1, 'SMD 0805 1K Yageo', '1K Yageo', '101'),
  valor(2, 'SMD 0805 2K2', '2K2', '102'),
  valor(3, 'SMD 0805 10K', '10K', '103'), valor(5, 'SMD 0805 10K bis', '10K bis', '103'),   // dois vivos
]};
const CASA = { name: 'RES [SMD]', parts: [] };            // um símbolo da biblioteca da casa
const monta = () => SF.montaAcervos({ schlib: { symbols: [CASA] },
                                      almoxEspeciais: { symbols: [SENSOR] },
                                      almoxBasicos: { symbols: [RES] } });
const r = monta();
const SLIB = { symbols: r.symbols };
Core.setLibTables(null, null);
const resolve = n => Core.resolveSym(SLIB, n);

const comp = (ref, sym, params, extra) => Object.assign({ t: 'comp', sheet: 's', ref, sym, x: 0, y: 0, rot: 0,
                                                         footprint: 'FP-' + ref, params }, extra || {});
const itens = [
  /* 1. o nome antigo virou zumbi (fora): segue para o vivo, com o comment que era o rótulo */
  comp('U1', 'Hall / Magnetico TMAG5131A1', 'Comment=Hall / Magnetico TMAG5131A1;OdooId=1523;ValorId=4',
       { comment: 'Hall / Magnetico TMAG5131A1' }),
  /* 2. o nome antigo já não existe em lugar nenhum (o zumbi foi apagado): segue também, e o
        comment escrito à mão fica */
  comp('R1', 'SMD 0805 1K', 'Comment=1K;OdooId=101;ValorId=1', { comment: 'resistor de pull-up' }),
  /* 3. já está no nome de hoje: nada */
  comp('R2', 'SMD 0805 2K2', 'Comment=2K2;OdooId=102;ValorId=2'),
  /* 4. o nome resolve para OUTRA peça viva: é escolha de alguém — não mexe */
  comp('U2', 'Outro sensor', 'Comment=x;OdooId=1523'),
  /* 5. o nome resolve para um símbolo da CASA: idem */
  comp('R3', 'RES [SMD]', 'Comment=1K;OdooId=101'),
  /* 6. o id leva a DOIS vivos: dois candidatos não são resposta */
  comp('R4', 'SMD 0805 10K velho', 'Comment=10K;OdooId=103'),
  /* 7. sem OdooId, ou com um id que não vive em lugar nenhum: nada a seguir */
  comp('R5', 'SMD 0805 sumiu', 'Comment=x;ValorId=7'),
  comp('R6', 'SMD 0805 sumiu', 'Comment=x;OdooId=999'),
  { t: 'wire', sheet: 's', pts: [[0, 0], [100, 0]] },
];
const antes = JSON.parse(JSON.stringify(itens));
const ren = ok(itens, r.valorDe, resolve);

assert.deepStrictEqual(ren.map(x => [x.ref, x.de, x.para]), [
  ['U1', 'Hall / Magnetico TMAG5131A1', 'Hall Magnetico TMAG5131A1'],
  ['R1', 'SMD 0805 1K', 'SMD 0805 1K Yageo'],
], 'só o zumbi e o nome que sumiu seguem pelo id');

const [u1, r1] = itens;
assert.strictEqual(u1.sym, 'Hall Magnetico TMAG5131A1');
assert.strictEqual(u1.comment, 'Hall Magnetico TMAG5131A1', 'o comment que era o rótulo antigo vira o de hoje');
assert.ok(/(?:^|;)OdooId=1523(?:;|$)/.test(u1.params) && /ValorId=46$/.test(u1.params),
          'o params é a identidade do valor de hoje: ' + u1.params);
assert.strictEqual(u1.footprint, 'FP-U1', 'o footprint é da peça, e a peça é a mesma');
assert.strictEqual(r1.sym, 'SMD 0805 1K Yageo');
assert.strictEqual(r1.comment, 'resistor de pull-up', 'comment escrito à mão fica');
for (let i = 2; i < itens.length; i++)
  assert.deepStrictEqual(itens[i], antes[i], 'o item ' + (itens[i].ref || itens[i].t) + ' não pode mudar');

/* e o que seguiu resolve agora no vivo, com o desenho dele (não o do zumbi) */
assert.strictEqual(resolve(u1.sym).how, 'exato');
assert.strictEqual(r.valorDe.get(u1.sym).valor.id, 46);

/* segunda passada: nada mais a fazer */
assert.deepStrictEqual(ok(itens, r.valorDe, resolve), [], 'idempotente');
/* sem biblioteca do almoxarifado (acervo caído), nada */
assert.deepStrictEqual(ok(JSON.parse(JSON.stringify(antes)), new Map(), resolve), []);

console.log('test-segue-odoo OK (zumbi e nome sumido seguem o id; escolha, casa, ambíguo e sem id ficam)');
