'use strict';
// 1.89.0: o gravador da fila do catálogo (lib/gravador-catalogo.js): liga só fora dos testes sem NexoBD; roda o motor
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GravadorCatalogo, desligado, periodo } = require('../lib/gravador-catalogo');

test('desligado nos testes sem NexoBD e com NEXO_GRAVADOR=0; ligado no app', () => {
  assert.ok(desligado({ NEXO_GRAVADOR: '0' }));
  assert.ok(desligado({ ALTIUMHUB_USERDATA: 'x' }));
  assert.ok(desligado({ NEXO_CATALOGO: 'x' }));
  assert.strictEqual(desligado({ ALTIUMHUB_USERDATA: 'x', NEXOHUB_URL: 'http://127.0.0.1:1' }), '');
  assert.strictEqual(desligado({}), '');
  assert.deepStrictEqual([periodo({}), periodo({ NEXO_GRAVADOR_S: '8' }), periodo({ NEXO_GRAVADOR_S: '1' })], [45000, 8000, 3000]);
});

test('a rodada roda o motor da pasta de trabalho com {acao: fila-gravar}', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'grav-cat-'));
  fs.mkdirSync(path.join(ws, 'mcp', 'lib'), { recursive: true });
  // um motor de mentira: devolve o que recebeu
  fs.writeFileSync(path.join(ws, 'mcp', 'lib', 'catalogo.js'),
    "let e='';process.stdin.on('data',d=>e+=d);process.stdin.on('end',()=>{const a=JSON.parse(e);process.stdout.write(JSON.stringify({ok:true,acao:a.acao,gravados:1})+String.fromCharCode(10));});");
  const logs = [];
  const g = new GravadorCatalogo({ log: (m) => logs.push(m), env: { NEXOHUB_URL: 'http://127.0.0.1:1', PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  assert.strictEqual(g.iniciar(ws), '');
  const r = await g.rodada();
  g.parar();
  assert.deepStrictEqual([r.ok, r.acao], [true, 'fila-gravar']);
  assert.ok(logs.some((l) => /1 gravado/.test(l)), logs.join('|'));
  fs.rmSync(ws, { recursive: true, force: true });
});
