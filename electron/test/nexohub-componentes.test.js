'use strict';
// NexoHubSync.olharComponentes (1.13): a cada minuto o app olha os itens `componente` do Nexo Hub;
// mudou (o NexoCAD criou/editou um, ou trocou os footprints), agenda so a parte "componentes".
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('olharComponentes agenda só quando os componentes mudam', async () => {
  let itens = [{ id: 'a', rev: 1, atributos: { footprints: ['R0805'] } }];
  let pedidos = 0;
  const srv = http.createServer((req, res) => {
    pedidos++;
    assert.match(req.url, /^\/api\/v1\/itens\?tipo=componente/);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ itens, total: itens.length, revisao: 1 }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const antes = { ...process.env };
  process.env.NEXOHUB_URL = `http://127.0.0.1:${srv.address().port}`;
  delete process.env.ALTIUMHUB_SMOKE; delete process.env.ALTIUMHUB_USERDATA; delete process.env.NEXOHUB_DESLIGADO;
  const { NexoHubSync } = require('../lib/nexohub-sync.js');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'nexohub-comp-'));
  const s = new NexoHubSync({ log: { info() {}, warn() {} } });
  s.ws = ws;                       // sem iniciar(): nada de vigias nem da rodada inteira
  const agendados = [];
  s.agendar = (o) => agendados.push(o);
  try {
    await s.olharComponentes();
    assert.deepStrictEqual(agendados, [], 'a 1a olhada so guarda a marca (a rodada inteira ja traz)');
    await s.olharComponentes();
    assert.deepStrictEqual(agendados, [], 'nada mudou');
    itens = [...itens, { id: 'b', rev: 1, atributos: { footprints: ['SOT23'] } }];
    await s.olharComponentes();
    assert.deepStrictEqual(agendados, [{ componentes: true }], 'componente novo');
    itens[0] = { ...itens[0], rev: 2 };
    await s.olharComponentes();
    assert.strictEqual(agendados.length, 2, 'revisão nova no NexoCAD');
    s.filho = {};                  // rodando: nao olha
    await s.olharComponentes();
    assert.strictEqual(pedidos, 4);
  } finally {
    s.filho = null; s.parar(); srv.close();
    process.env = antes;
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
