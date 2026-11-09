// O login do Nexo Hub no NexoEletric (1.83.0): as casas carregam o componente do Hub antes de tudo, as copias
// do cliente/ do repositorio nexohub continuam sem mudanca, e a ponte do app oferece o garantirHub.
// node tests/test-nexohub-login.js
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = path.resolve(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(R, f), 'utf8');
let n = 0;
const ok = (nome, f) => { f(); n++; console.log('ok -', nome); };

ok('hub.html carrega o login ANTES do hub-core.js (o teclado para antes dos atalhos)', () => {
  const s = ler('hub.html');
  const a = s.indexOf('<script src="nexohub-sessao.js">');
  const b = s.indexOf('<script src="hub-nexohub-login.js">');
  const c = s.indexOf('<script src="hub-core.js">');
  assert.ok(a > 0 && b > a && c > b, `ordem errada: sessao ${a}, login ${b}, core ${c}`);
});

ok('as vistas abertas numa janela a parte tambem pedem o login', () => {
  for (const f of ['schframe.html', 'pcbframe.html']) {
    const s = ler(f);
    assert.ok(s.includes('<script src="nexohub-sessao.js"></script><script src="hub-nexohub-login.js"></script>'), f);
  }
});

ok('as copias do cliente do Nexo Hub sao identicas as do repositorio nexohub (quando ele existe aqui)', () => {
  const hub = process.env.NEXOHUB_REPO || 'D:\\Pessoal\\NexoHub';
  const pares = [['nexohub-sessao.js', 'cliente/nexohub-sessao.js'], ['electron/lib/nexohub-abrir.mjs', 'cliente/nexohub-abrir.mjs']];
  for (const [nosso, dele] of pares) {
    assert.ok(fs.existsSync(path.join(R, nosso)), 'falta ' + nosso);
    const orig = path.join(hub, dele);
    if (!fs.existsSync(orig)) { console.log('   (sem o repositorio nexohub em ' + hub + ': so confere que existe)'); continue; }
    const tira = (t) => t.replace(/\r\n/g, '\n');
    assert.strictEqual(tira(ler(nosso)), tira(fs.readFileSync(orig, 'utf8')), nosso + ' mudou: copie de novo do cliente/ do nexohub, sem editar');
  }
});

ok('fora do navegador o modulo nao faz nada (e o hub web, sem a ponte, tambem nao)', () => {
  const m = require(path.join(R, 'hub-nexohub-login.js'));
  assert.deepStrictEqual(m, {});
  const s = ler('hub-nexohub-login.js');
  assert.ok(/if \(!ponte \|\| typeof window\.NexoHubSessao === 'undefined'\) return;/.test(s), 'sem a ponte do app, nada de login');
});

ok('a ponte do app oferece garantirHub nas duas janelas (Rust e Electron) e o motor responde', () => {
  assert.ok(ler('rust/crates/nexoeletric-web/src/main.rs').includes('garantirHub: function ()'), 'PONTE da janela Rust');
  assert.ok(ler('electron/ui/preload.js').includes("garantirHub: () => ipcRenderer.invoke('nexohub:garantir')"), 'preload da janela Electron');
  const main = ler('electron/main.js');
  assert.ok(main.includes("ipcMain.handle('nexohub:garantir'"), 'o tratador da janela Electron');
  assert.ok(main.includes('nexohubGarantir: () => garantirNexoHub()'), 'o menu que a janela Rust manda');
  assert.ok(/if \(!SMOKE\) garantirNexoHub\(\);/.test(main), 'a abertura confere (e abre) o Hub');
});

console.log(`\n${n} testes ok`);
