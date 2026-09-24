'use strict';
// O hub de verdade (build/hub) no Python do app (build/python).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Backend } = require('../lib/backend');
const porta = require('../lib/porta');
const workspace = require('../lib/workspace');

const APP = path.resolve(__dirname, '..');
const PYTHON = path.join(APP, 'build', 'python', 'python.exe');
const BUNDLE = path.join(APP, 'build', 'hub');
const PRONTO = fs.existsSync(PYTHON) && fs.existsSync(path.join(BUNDLE, 'altiumhub-manifest.json'));
const SKIP = !PRONTO && 'rode npm run build:prep antes';

function tmp(p) { return fs.mkdtempSync(path.join(os.tmpdir(), p)); }

function get(port, caminho, host) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: caminho, headers: host ? { Host: host } : {} }, (res) => {
      let corpo = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { corpo += c; });
      res.on('end', () => resolve({ status: res.statusCode, corpo }));
    });
    req.on('error', reject);
  });
}

test('sobe o hub so no loopback, com as rotas todas e o Host travado', { skip: SKIP }, async (t) => {
  const ws = tmp('ahbk-');
  workspace.sync(ws, BUNDLE);
  // Ambiente do usuario com PYTHON* que quebrariam o hub: PYTHONSAFEPATH tira a pasta do
  // script do sys.path (e o envio da lista ao Odoo some); o backend tem de limpar.
  const antes = { ...process.env };
  process.env.PYTHONSAFEPATH = '1';
  process.env.PYTHONPATH = 'C:\\nao\\existe';
  t.after(() => { for (const k of ['PYTHONSAFEPATH', 'PYTHONPATH']) { if (k in antes) process.env[k] = antes[k]; else delete process.env[k]; } });

  const hub = new Backend({ python: PYTHON, workspace: ws, logDir: tmp('ahbklog-') });
  const p = await hub.start({ port: 18360, lan: false });
  t.after(() => hub.stop());
  assert.strictEqual(p, 18360);
  assert.strictEqual(hub.host, '127.0.0.1');

  assert.strictEqual((await get(p, '/__live.js')).status, 200);
  const idx = await get(p, '/api/index.json');
  assert.strictEqual(idx.status, 200);
  assert.deepStrictEqual(JSON.parse(idx.corpo).projects, [], 'pasta nova, sem projetos (e sem cair no DEMO)');
  assert.strictEqual((await get(p, '/api/lista/config')).status, 200, 'odoolista_server carregou (a pasta do script esta no sys.path)');
  assert.strictEqual((await get(p, '/api/symbols/footprints')).status, 200, 'symserver carregou');
  assert.strictEqual((await get(p, '/hub.html')).status, 200);
  assert.strictEqual((await get(p, '/__live.js', 'evil.example.com:' + p)).status, 400, 'DNS rebinding barrado');
  assert.ok(!hub.tail.some((l) => /envio da lista ao Odoo desligado/.test(l)), hub.tail.join('\n'));
});

test('um hub orfao desta instalacao e encerrado, e o novo fica com a mesma porta', { skip: SKIP }, async (t) => {
  const ws = tmp('ahor-');
  workspace.sync(ws, BUNDLE);
  const logDir = tmp('ahorlog-');
  const pidFile = path.join(logDir, 'hub.pid');

  // "sessao anterior": sobe e nunca e derrubada pelo app (Gerenciador de Tarefas no Electron)
  const velho = new Backend({ python: PYTHON, workspace: ws, logDir, pidFile });
  const p = await velho.start({ port: 18370, lan: false });
  const pidVelho = velho.proc.pid;
  velho.removeAllListeners('exit');
  assert.ok(fs.existsSync(pidFile), 'pid gravado');

  const novo = new Backend({ python: PYTHON, workspace: ws, logDir, pidFile });
  const p2 = await novo.start({ port: 18370, lan: false });
  t.after(() => novo.stop());
  assert.strictEqual(p2, p, 'mesma porta: a origem (e o localStorage do hub) nao muda');
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(!porta.vivo(pidVelho), 'o orfao morreu');
  assert.ok(novo.tail.some((l) => /sessao anterior/.test(l)), novo.tail.join('\n'));

  await novo.stop();
  assert.ok(!fs.existsSync(pidFile), 'parada limpa apaga o pid');
});

test('porta de OUTRO programa e pulada, nunca encerrada', { skip: SKIP }, async (t) => {
  const ws = tmp('ahout-');
  workspace.sync(ws, BUNDLE);
  const alheio = http.createServer((q, r) => r.end('alheio'));
  await new Promise((r) => alheio.listen(18380, '0.0.0.0', r));
  t.after(() => alheio.close());
  const hub = new Backend({ python: PYTHON, workspace: ws, logDir: tmp('ahoutlog-') });
  const p = await hub.start({ port: 18380, lan: false });
  t.after(() => hub.stop());
  assert.strictEqual(p, 18381, 'escutando em 0.0.0.0 o alheio nao e visto pelo teste de bind do Node; o netstat ve');
  assert.strictEqual((await get(18380, '/')).corpo, 'alheio', 'o outro programa continua vivo');
});
