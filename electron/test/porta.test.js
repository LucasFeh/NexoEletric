'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pidsEscutando, mesmoArquivo } = require('../lib/porta');

// Saida real do netstat -ano de um Windows em portugues: o estado vem traduzido, e por isso
// a regra e o endereco remoto (0.0.0.0:0 / [::]:0), nunca o texto do estado.
const NETSTAT = `
Conexões ativas

  Proto  Endereço local         Endereço externo       Estado          PID
  TCP    0.0.0.0:135            0.0.0.0:0              ESCUTANDO       1024
  TCP    0.0.0.0:8200           0.0.0.0:0              ESCUTANDO       5120
  TCP    127.0.0.1:8200         0.0.0.0:0              LISTENING       7777
  TCP    127.0.0.1:8200         127.0.0.1:53011        ESTABELECIDO    7777
  TCP    127.0.0.1:53011        127.0.0.1:8200         ESTABELECIDO    9000
  TCP    127.0.0.1:18200        0.0.0.0:0              ESCUTANDO       4242
  TCP    [::]:8200              [::]:0                 ESCUTANDO       6000
  UDP    0.0.0.0:8200           *:*                                    3333
`;

test('so os sockets ESCUTANDO na porta exata entram', () => {
  assert.deepStrictEqual(pidsEscutando(NETSTAT, 8200).sort(), [5120, 6000, 7777]);
  assert.deepStrictEqual(pidsEscutando(NETSTAT, 18200), [4242], '18200 nao casa com 8200');
  assert.deepStrictEqual(pidsEscutando(NETSTAT, 135), [1024]);
  assert.deepStrictEqual(pidsEscutando(NETSTAT, 9999), []);
  assert.deepStrictEqual(pidsEscutando('', 8200), []);
});

test('mesmo arquivo ignora caixa e separador', () => {
  assert.ok(mesmoArquivo('C:\\Apps\\AltiumHub\\resources\\python\\python.exe', 'c:/apps/altiumhub/resources/python/python.exe'));
  assert.ok(!mesmoArquivo('C:\\Python312\\python.exe', 'C:\\Apps\\AltiumHub\\resources\\python\\python.exe'));
  assert.ok(!mesmoArquivo('', 'C:\\x'));
});
