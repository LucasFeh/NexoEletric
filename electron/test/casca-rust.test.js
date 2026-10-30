'use strict';
// A janela Rust (lib/casca-rust.js): quem abre, com que argumentos, e o canal com o motor de fundo.
// O canal inteiro roda contra uma casca FALSA em Node, que fala o mesmo protocolo do main.rs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const C = require('../lib/casca-rust');

test('o executavel da casca: o do instalador, ou o de NEXOELETRIC_RUST_EXE; sem ele, nenhum', () => {
  const existe = (f) => f.endsWith(path.join('rust', 'NexoEletric.exe')) || f === 'X:\\outra.exe';
  assert.strictEqual(C.caminhoDaCasca({ empacotado: true, resourcesPath: 'R:\\res', env: {}, existe }),
    path.join('R:\\res', 'rust', 'NexoEletric.exe'));
  assert.strictEqual(C.caminhoDaCasca({ empacotado: false, resourcesPath: 'R:\\res', env: {}, existe }), '',
    'rodando do repositorio (npm start) a janela e a Electron');
  assert.strictEqual(C.caminhoDaCasca({ empacotado: false, env: { NEXOELETRIC_RUST_EXE: 'X:\\outra.exe' }, existe }), 'X:\\outra.exe');
  assert.strictEqual(C.caminhoDaCasca({ empacotado: true, resourcesPath: 'R:\\res', env: {}, existe: () => false }), '',
    'instalador sem a casca: a janela Electron');
});

test('a janela Electron de volta: settings.casca ou NEXOELETRIC_CASCA', () => {
  assert.strictEqual(C.querCasca({}, {}), true, 'o padrao e a janela Rust');
  assert.strictEqual(C.querCasca({ casca: 'electron' }, {}), false);
  assert.strictEqual(C.querCasca({ casca: 'rust' }, { NEXOELETRIC_CASCA: 'electron' }), false);
});

test('os argumentos e o ambiente da casca', () => {
  const { args, env } = C.comando({ ws: 'C:\\AltiumHub', porta: 8200, python: 'P:\\python.exe', versao: '1.54.0',
    env: { ALTIUMHUB_NEXOBD: '1' }, base: { PATH: 'x', ELECTRON_RUN_AS_NODE: '1' } });
  assert.deepStrictEqual(args, ['--workspace', 'C:\\AltiumHub', '--porta', '8200', '--python', 'P:\\python.exe']);
  assert.strictEqual(env.NEXOELETRIC_MOTOR, '1');
  assert.strictEqual(env.NEXOELETRIC_VERSAO, '1.54.0', 'a versao do app vai para o session.json do MCP');
  assert.strictEqual(env.ALTIUMHUB_NEXOBD, '1');
  assert.strictEqual(env.PATH, 'x');
  assert.ok(!('ELECTRON_RUN_AS_NODE' in env));
  const p = C.comando({ ws: 'W', projeto: 'PRJ-UR', base: {} }).args;
  assert.deepStrictEqual(p.slice(-4), ['--projeto', 'PRJ-UR', '--aba', 'pcb']);
});

test('as linhas do canal', () => {
  assert.strictEqual(C.origemDaLinha('[NexoEletric] hub em http://127.0.0.1:8200/ (pasta C:\\AltiumHub)'), 'http://127.0.0.1:8200');
  assert.strictEqual(C.origemDaLinha('[nexo-hub] porta 8200 ocupada'), '');
  assert.strictEqual(C.menuDaLinha('menu:configApp\r'), 'configApp');
  assert.strictEqual(C.menuDaLinha('menu:; rm -rf'), '', 'id fora do formato nao vira acao');
});

/* a casca falsa: o protocolo do main.rs (NEXOELETRIC_MOTOR=1) */
const FALSA = `
process.stderr.write('[nexo-hub] subindo\\n[NexoEletric] hub em http://127.0.0.1:8299/ (pasta ' + process.argv[3] + ')\\n');
process.stdout.write('menu:configApp\\n');
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  for (const l of buf.split('\\n').slice(0, -1)) {
    if (l === 'focar') process.stdout.write('menu:sobre\\n');
    if (l.startsWith('toast ')) { const t = JSON.parse(l.slice(6)); process.stdout.write('menu:' + (t.tipo === 'warn' ? 'nexobd' : 'x') + '\\n'); }
    if (l === 'sair') process.exit(0);
  }
  buf = buf.slice(buf.lastIndexOf('\\n') + 1);
});
setTimeout(() => process.exit(0), 8000);
`;

test('o canal inteiro com uma casca falsa: origem, menu, focar, toast e a saida', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casca-'));
  const script = path.join(dir, 'falsa.js');
  fs.writeFileSync(script, FALSA);
  const c = new C.CascaRust({ log: { info() {}, warn() {}, error() {} }, logDir: dir });
  const menus = [];
  c.on('menu', (m) => menus.push(m));
  const saiu = new Promise((r) => c.on('exit', r));
  const origem = await c.iniciar({ exe: process.execPath, argsAntes: [script], ws: 'C:\\Teste', porta: 8299,
    env: { ELECTRON_RUN_AS_NODE: '1' } });
  assert.strictEqual(origem, 'http://127.0.0.1:8299');
  assert.ok(c.viva);
  assert.ok(c.focar());
  assert.ok(c.toast('Sem conexão', 'warn'));
  for (let i = 0; i < 50 && menus.length < 3; i++) await new Promise((r) => setTimeout(r, 50));
  assert.deepStrictEqual(menus, ['configApp', 'sobre', 'nexobd']);
  await c.parar();
  const ev = await saiu;
  assert.ok(!c.viva);
  assert.strictEqual(ev.subiu, true, 'a janela tinha aberto: fechar e sair do app, nao cair para a Electron');
  assert.ok(fs.readFileSync(path.join(dir, 'rust.log'), 'utf8').includes('hub em http://127.0.0.1:8299/'), 'o log da casca fica em logs/rust.log');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('casca que sai antes de abrir o hub: rejeita (o motor volta para a janela Electron)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casca-'));
  const script = path.join(dir, 'morre.js');
  fs.writeFileSync(script, "process.stderr.write('WebView2 ausente\\n'); process.exit(3);");
  const c = new C.CascaRust({ logDir: dir });
  const saiu = new Promise((r) => c.on('exit', r));
  await assert.rejects(c.iniciar({ exe: process.execPath, argsAntes: [script], ws: 'W' }), /saiu \(código 3\)/);
  const ev = await saiu;
  assert.strictEqual(ev.code, 3);
  assert.strictEqual(ev.cedo, true);
  assert.strictEqual(ev.subiu, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
