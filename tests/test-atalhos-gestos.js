/* A tabela de gestos do editor de atalhos (hub-atalhos.js » GESTOS) diz o que o canvas faz, e
   o canvas não lê essa tabela — ela pode mentir calada. Foi o que aconteceu em 2026-09-24: o
   fio passou a ser pego em dois cliques, como no Altium, e a tabela seguiu mandando dar
   "Clique duplo" para pegar o fio inteiro. Rode: node tests/test-atalhos-gestos.js */
'use strict';
const assert = require('assert');
const path = require('path');
const A = require(path.join(__dirname, '..', 'hub-atalhos.js'));

const G = A.GESTOS;
assert.ok(Array.isArray(G) && G.length, 'GESTOS exportado');

/* o fio: o primeiro clique pega o fio inteiro, o segundo o trecho; duplo clique não é gesto */
assert.ok(!G.some(g => g.teclas.includes('Clique duplo')), 'nenhum gesto de clique duplo');
assert.ok(G.some(g => /fio inteiro/.test(g.rotulo) && g.teclas.join('+') === 'Clique'), 'clique = fio inteiro');
assert.ok(G.some(g => /trecho/.test(g.rotulo) && g.teclas.join('+') === 'Segundo clique'), 'segundo clique = trecho');
/* a net só acende com Alt */
assert.ok(G.some(g => /net/.test(g.rotulo) && g.teclas.join('+') === 'Alt+Clique'), 'Alt+Clique acende a net');

/* as teclas do fio valem SÓ com o fio na mão: sem o `quando`, o editor diria que o Espaço da
   vista inverte o canto, e ele gira a seleção */
const doFio = G.filter(g => g.teclas.some(t => t === 'Espaço' || t === 'Backspace'));
assert.ok(doFio.length >= 3, 'as teclas do fio estão na tabela');
for (const g of doFio) assert.ok(/fio na mão/.test(g.quando || ''), g.rotulo + ': quando = fio na mão');
for (const g of G) assert.ok(g.quando === undefined || (typeof g.quando === 'string' && g.quando), g.rotulo + ': quando é texto');

console.log('test-atalhos-gestos: OK');
