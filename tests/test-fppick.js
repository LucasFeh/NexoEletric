/* hub-fppick.js: a galeria que troca o footprint de um componente no Esquema.
   O que e puro: o teste "serve" (todo pino do simbolo tem pad) e o filtro da galeria. */
'use strict';
const assert = require('assert');
const P = require('../hub-fppick.js');

const sot23 = { name:'SOT-23', pads:[{ name:'1' }, { name:'2' }, { name:'3' }] };
const r0805 = { name:'RES 0805', pads:[{ name:'1' }, { name:'2' }] };
const vazio = { name:'SO CADASTRADO', pads:[] };

assert.deepStrictEqual(P.faltam(sot23, ['1', '2', '3']), []);
assert.deepStrictEqual(P.faltam(r0805, [1, 2, 3]), ['3'], 'numero ou texto: o pino 3 nao tem pad');
assert.strictEqual(P.serve(sot23, ['1', '2', '3']), true);
assert.strictEqual(P.serve(r0805, ['1', '2', '3']), false);
assert.strictEqual(P.serve(vazio, []), false, 'footprint sem pad nao serve para nada');
assert.strictEqual(P.serve(r0805, []), true, 'sem pinos numerados, qualquer um com pad serve');

const todos = [sot23, r0805, vazio, null, { pads:[] }];
assert.deepStrictEqual(P.filtra(todos, '', null, false).map(f => f.name), ['SOT-23', 'RES 0805', 'SO CADASTRADO'],
  'sem nome nao entra na galeria');
assert.deepStrictEqual(P.filtra(todos, 'res', null, false).map(f => f.name), ['RES 0805'], 'busca sem caixa');
assert.deepStrictEqual(P.filtra(todos, '', ['1', '2', '3'], true).map(f => f.name), ['SOT-23'], 'so os que servem');
assert.deepStrictEqual(P.filtra(todos, '', [], true).map(f => f.name).length, 3, 'sem pinos o filtro nao corta nada');
console.log('test-fppick: ok');
