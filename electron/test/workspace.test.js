'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const workspace = require('../lib/workspace');

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

// Um pacote de mentira no formato do scripts/stage-hub.mjs.
function pacote(dir, versao, code, seed) {
  fs.rmSync(dir, { recursive: true, force: true });
  const m = { format: 'altiumhub-manifest-1', appVersion: versao, commit: 'c' + versao, dirs: ['Projects', 'Trash'], code: [], seed: [] };
  for (const [lista, arqs] of [[m.code, code], [m.seed, seed]]) {
    for (const [rel, txt] of Object.entries(arqs)) {
      const f = path.join(dir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, txt);
      lista.push({ p: rel, size: Buffer.byteLength(txt), sha1: sha1(txt) });
    }
  }
  fs.writeFileSync(path.join(dir, 'altiumhub-manifest.json'), JSON.stringify(m));
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ahws-'));
}

const ler = (ws, rel) => fs.readFileSync(path.join(ws, ...rel.split('/')), 'utf8');

test('instalacao nova: codigo, estado semeado e pastas de runtime', () => {
  const base = tmp();
  const pk = path.join(base, 'pk');
  const ws = path.join(base, 'ws');
  pacote(pk, '1.0.0', { 'hubserver.py': 'v1', 'tools/a.py': 'a1' }, { 'Libs/almox-parts.json': '{"x":1}' });
  const r = workspace.sync(ws, pk);
  assert.strictEqual(r.copied, 2);
  assert.strictEqual(r.seeded, 1);
  assert.strictEqual(ler(ws, 'hubserver.py'), 'v1');
  assert.ok(fs.statSync(path.join(ws, 'Projects')).isDirectory());
  assert.ok(fs.statSync(path.join(ws, 'Trash')).isDirectory());
  // segunda abertura, mesma versao: nada a fazer
  const r2 = workspace.sync(ws, pk);
  assert.strictEqual(r2.copied + r2.seeded + r2.removed, 0);
});

test('atualizacao troca o codigo, nunca o estado, e so apaga codigo que ninguem editou', () => {
  const base = tmp();
  const pk = path.join(base, 'pk');
  const ws = path.join(base, 'ws');
  pacote(pk, '1.0.0', { 'hubserver.py': 'v1', 'velho.py': 'x', 'editado.py': 'e1' }, { 'Libs/almox-parts.json': '{"x":1}' });
  workspace.sync(ws, pk);
  // o usuario trabalhou: mudou o estado e editou um arquivo de codigo
  fs.writeFileSync(path.join(ws, 'Libs', 'almox-parts.json'), '{"x":2,"local":true}');
  fs.writeFileSync(path.join(ws, 'editado.py'), 'e1 + mudanca a mao');
  fs.mkdirSync(path.join(ws, 'Projects', 'P1'));
  fs.writeFileSync(path.join(ws, 'Projects', 'P1', 'board.js'), 'var board = {};');

  pacote(pk, '1.1.0', { 'hubserver.py': 'v2' }, { 'Libs/almox-parts.json': '{"x":99}' });
  const r = workspace.sync(ws, pk);
  assert.strictEqual(ler(ws, 'hubserver.py'), 'v2', 'codigo novo entrou');
  assert.strictEqual(ler(ws, 'Libs/almox-parts.json'), '{"x":2,"local":true}', 'livro-razao local intocado');
  assert.ok(!fs.existsSync(path.join(ws, 'velho.py')), 'codigo que saiu do app e nao foi editado: apagado');
  assert.ok(fs.existsSync(path.join(ws, 'editado.py')), 'codigo editado a mao: fica');
  assert.deepStrictEqual(r.kept, ['editado.py']);
  assert.strictEqual(ler(ws, 'Projects/P1/board.js'), 'var board = {};', 'projeto intocado');
});

test('estado apagado pelo usuario e semeado de novo', () => {
  const base = tmp();
  const pk = path.join(base, 'pk');
  const ws = path.join(base, 'ws');
  pacote(pk, '1.0.0', { 'hubserver.py': 'v1' }, { 'projects.js': 'var projects = [];' });
  workspace.sync(ws, pk);
  fs.rmSync(path.join(ws, 'projects.js'));
  assert.strictEqual(workspace.sync(ws, pk).seeded, 1);
});

test('arquivo em uso nao derruba a sincronizacao e a proxima abertura tenta de novo', () => {
  const base = tmp();
  const pk = path.join(base, 'pk');
  const ws = path.join(base, 'ws');
  pacote(pk, '1.0.0', { 'hubserver.py': 'v1', 'ApplyChanges.pas': 'p1' }, {});
  workspace.sync(ws, pk);
  pacote(pk, '1.1.0', { 'hubserver.py': 'v2', 'ApplyChanges.pas': 'p2' }, {});
  // simula o Altium segurando o .pas: um DIRETORIO no lugar do .tmp faz o copy falhar
  fs.mkdirSync(path.join(ws, 'ApplyChanges.pas.altiumhub-tmp'));
  const r = workspace.sync(ws, pk);
  assert.strictEqual(r.falhas.length, 1);
  assert.match(r.falhas[0], /^ApplyChanges\.pas/);
  assert.strictEqual(ler(ws, 'hubserver.py'), 'v2', 'o resto atualizou');
  assert.strictEqual(ler(ws, 'ApplyChanges.pas'), 'p1', 'o travado ficou como estava');
  fs.rmSync(path.join(ws, 'ApplyChanges.pas.altiumhub-tmp'), { recursive: true });
  const r2 = workspace.sync(ws, pk);
  assert.strictEqual(r2.falhas.length, 0);
  assert.strictEqual(ler(ws, 'ApplyChanges.pas'), 'p2', 'destravado, atualiza na abertura seguinte');
});

test('pasta com .git e de desenvolvedor: nada e copiado', () => {
  const base = tmp();
  const pk = path.join(base, 'pk');
  const ws = path.join(base, 'ws');
  pacote(pk, '1.0.0', { 'hubserver.py': 'v1' }, {});
  fs.mkdirSync(ws);
  fs.writeFileSync(path.join(ws, '.git'), 'gitdir: ../x');
  fs.writeFileSync(path.join(ws, 'hubserver.py'), 'do repositorio');
  const r = workspace.sync(ws, pk);
  assert.ok(r.dev);
  assert.strictEqual(ler(ws, 'hubserver.py'), 'do repositorio');
});

test('manifesto adulterado nao escreve fora da pasta', () => {
  const base = tmp();
  const pk = path.join(base, 'pk');
  pacote(pk, '1.0.0', { 'hubserver.py': 'v1' }, {});
  const m = JSON.parse(fs.readFileSync(path.join(pk, 'altiumhub-manifest.json'), 'utf8'));
  m.code.push({ p: '../fora.txt', size: 1, sha1: 'x' });
  fs.writeFileSync(path.join(pk, 'altiumhub-manifest.json'), JSON.stringify(m));
  assert.throws(() => workspace.sync(path.join(base, 'ws'), pk), /fora da pasta/);
  assert.ok(!fs.existsSync(path.join(base, 'fora.txt')));
});

test('avaliar: pasta de rede, acento, pasta alheia', () => {
  assert.strictEqual(workspace.avaliar('').ok, false);
  assert.strictEqual(workspace.avaliar('relativa\\x').ok, false);
  assert.strictEqual(workspace.avaliar('\\\\192.168.15.192\\altiumhub\\current').ok, false);
  const base = tmp();
  const nova = workspace.avaliar(path.join(base, 'João'));
  assert.ok(nova.ok && nova.nova && /acento/.test(nova.aviso));
  fs.writeFileSync(path.join(base, 'documento.txt'), 'x');
  assert.strictEqual(workspace.avaliar(base).ok, false, 'pasta com arquivos de outra coisa');
});

test('hub-almox.json semeado so com servidor e base, e so uma vez', () => {
  const ws = tmp();
  assert.ok(workspace.seedOdoo(ws, { odooUrl: 'http://192.168.15.192:8070', odooDb: 'odoo_db' }));
  const cfg = JSON.parse(fs.readFileSync(path.join(ws, 'hub-almox.json'), 'utf8'));
  assert.deepStrictEqual(cfg, { url: 'http://192.168.15.192:8070', db: 'odoo_db' });
  fs.writeFileSync(path.join(ws, 'hub-almox.json'), '{"url":"http://outro","login":"a","senha":"b"}');
  assert.ok(!workspace.seedOdoo(ws, { odooUrl: 'x', odooDb: 'y' }), 'credencial existente nao e tocada');
  assert.match(fs.readFileSync(path.join(ws, 'hub-almox.json'), 'utf8'), /senha/);
});
