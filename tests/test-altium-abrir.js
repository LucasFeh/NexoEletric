/* Abrir projeto do Altium na janela Rust (1.64.1): o .PrjPcb sozinho abre, pelo Arquivo › Abrir e pelo arrastar.
   Na janela Electron o preload dava o caminho do arquivo no disco (eletricApp.caminho) e o servidor achava as folhas e
   a placa pelo proprio .PrjPcb. Na janela Rust o Abrir era o <input type=file> do navegador (sem caminho nunca) e o
   arrastar entregava o caminho DEPOIS do soltar: os dois caiam no "escolha o .PrjPcb JUNTO com as folhas" e nada
   abria (pedido do dono, 2026-11-04). Agora o Abrir usa a janela de arquivos do Windows (eletricApp.escolheArquivos,
   caminhos completos) e o arrastar espera o caminho chegar (eletricApp.esperaCaminhos).
     node tests/test-altium-abrir.js */
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'hub-altiumabrir.js'), 'utf8');

/* um DOM de mentira: o bastante para o modal do nome (clica "Abrir" sozinho) e o arrastar */
function carrega(eletricApp) {
  const enviados = [], alertas = [];
  const el = tag => ({ tag, style: {}, filhos: [], value: '', textContent: '', className: '',
    append(...c) { this.filhos.push(...c); if (this === body) for (const x of c) clicaAbrir(x); },
    remove() {}, addEventListener() {}, focus() {}, select() {}, click() {} });
  const clicaAbrir = n => { const acha = x => x && (x.tag === 'button' && x.textContent === 'Abrir' ? x : (x.filhos || []).map(acha).find(Boolean));
    const b = acha(n); if (b) setTimeout(() => b.onclick(), 0); };
  const body = el('body');
  const document = { readyState: 'complete', body, createElement: el, addEventListener() {}, querySelectorAll: () => [] };
  const window = { location: { protocol: 'http:' }, eletricApp, addEventListener() {}, document };
  window.top = window;
  const ctx = vm.createContext({ window, self: window, document, location: window.location, console, setTimeout, clearTimeout, Promise,
    HubDialog: { toast() {}, alert: async m => { alertas.push(m); }, confirm: async () => false },
    fetch: async (url, o) => { enviados.push({ url, corpo: JSON.parse(o.body) }); return { status: 200, json: async () => ({ ok: true, projeto: 'P', resumo: { folhas: 1, comp: 1, wire: 1 } }) }; },
    FileReader: function () {} });
  vm.runInContext(SRC, ctx);
  return { H: window.HubAltiumAbrir, enviados, alertas };
}
const PRJ = 'C:\\Projetos\\MIRBC\\MIRBC-DI251885.PrjPcb';
/* o abre que fica esperando para sempre (a janela de arquivos do navegador, que aqui nunca responde) nao pode passar
   calado: o Node sairia com 0 sem chegar ao fim */
let terminou = false;
process.on('exit', c => { if (!terminou && c === 0) { console.error('test-altium-abrir: parou no meio (o abre ficou esperando)'); process.exitCode = 1; } });

(async () => {
  let ok = 0;
  /* 1. Arquivo › Abrir na janela Rust: a janela do Windows devolve o caminho e o .PrjPcb sozinho basta */
  {
    const t = carrega({ caminho: () => '', escolheArquivos: async () => [PRJ], esperaCaminhos: async () => null });
    const r = await t.H.abre({});
    assert.ok(r && r.ok, 'abriu');
    assert.strictEqual(t.enviados.length, 1);
    assert.deepStrictEqual(t.enviados[0].corpo.caminhos, [PRJ], 'manda o caminho do .PrjPcb');
    assert.strictEqual(t.enviados[0].corpo.projeto, 'MIRBC-DI251885', 'o nome sugerido e o do .PrjPcb');
    assert.deepStrictEqual(t.alertas, []);
    ok++;
  }
  /* 2. cancelou a janela do Windows: nada acontece */
  {
    const t = carrega({ caminho: () => '', escolheArquivos: async () => [], esperaCaminhos: async () => null });
    assert.strictEqual(await t.H.abre({}), null);
    assert.strictEqual(t.enviados.length + t.alertas.length, 0);
    ok++;
  }
  /* 3. arrastou: o caminho chega DEPOIS do soltar (a janela Rust repassa um instante depois) e mesmo assim abre */
  {
    let pedidos = 0;
    const t = carrega({ caminho: () => '', esperaCaminhos: (nomes, ms) => { pedidos++; assert.ok(ms >= 1000, 'espera pelo menos 1 s');
      return new Promise(okp => setTimeout(() => okp(nomes.map(n => 'C:\\Projetos\\MIRBC\\' + n)), 120)); } });
    const r = await t.H.abre({ arquivos: [{ name: 'MIRBC-DI251885.PrjPcb', size: 10 }] });
    assert.ok(r && r.ok && pedidos === 1);
    assert.deepStrictEqual(t.enviados[0].corpo.caminhos, [PRJ]);
    ok++;
  }
  /* 4. no navegador (sem a ponte do app) continua pedindo as folhas e a placa junto */
  {
    const t = carrega(undefined);
    assert.strictEqual(await t.H.abre({ arquivos: [{ name: 'X.PrjPcb', size: 10 }] }), null);
    assert.strictEqual(t.enviados.length, 0);
    assert.ok(/JUNTO/.test(t.alertas[0] || ''), 'o aviso de sempre');
    ok++;
  }
  /* 5. a janela Electron (so o caminho sincrono do preload) continua igual */
  {
    const t = carrega({ caminho: f => 'D:\\p\\' + f.name });
    await t.H.abre({ arquivos: [{ name: 'X.PrjPcb', size: 10 }] });
    assert.deepStrictEqual(t.enviados[0].corpo.caminhos, ['D:\\p\\X.PrjPcb']);
    ok++;
  }
  /* 6. a ponte da janela Rust tem as duas funcoes e o Rust as atende */
  {
    const rs = fs.readFileSync(path.join(__dirname, '..', 'rust', 'crates', 'nexoeletric-web', 'src', 'main.rs'), 'utf8');
    assert.ok(/escolheArquivos\s*:/.test(rs) && /esperaCaminhos\s*:/.test(rs), 'a PONTE oferece escolheArquivos e esperaCaminhos');
    assert.ok(/"escolher"/.test(rs) && /rfd::FileDialog/.test(rs), 'o Rust abre a janela de arquivos do Windows');
    assert.ok(/__nexoArrastadosEm/.test(rs), 'o Rust marca quando o arrastado chegou');
    ok++;
    /* 7. a PONTE de verdade (o JS dentro do main.rs) roda: espera o caminho que chega depois, e responde a escolha */
    const ponte = rs.slice(rs.indexOf('const PONTE: &str = r#"') + 'const PONTE: &str = r#"'.length, rs.indexOf('"#;', rs.indexOf('const PONTE')));
    const enviadosIpc = [];
    const w = { location: { protocol: 'http:', hostname: '127.0.0.1' }, ipc: { postMessage: m => enviadosIpc.push(JSON.parse(m)) } };
    w.top = w;
    vm.runInContext(ponte, vm.createContext(Object.assign(w, { window: w, setTimeout, Date, Promise, JSON })));
    const E = w.eletricApp;
    const espera = E.esperaCaminhos(['MIRBC-DI251885.PrjPcb'], 1500);
    setTimeout(() => { w.__nexoArrastados = [PRJ]; w.__nexoArrastadosEm = Date.now(); }, 150);   /* o Rust, depois */
    assert.deepStrictEqual(await espera, [PRJ], 'o caminho que chegou depois do soltar');
    assert.strictEqual(E.caminho({ name: 'MIRBC-DI251885.PrjPcb' }), PRJ, 'o caminho sincrono de sempre');
    w.__nexoArrastadosEm = Date.now() - 60000;
    assert.strictEqual(await E.esperaCaminhos(['MIRBC-DI251885.PrjPcb'], 200), null, 'arraste velho nao vale');
    const esc = E.escolheArquivos();
    assert.deepStrictEqual(enviadosIpc.pop(), { escolher: 1 });
    w.__nexoEscolheu(1, [PRJ]);
    assert.deepStrictEqual(await esc, [PRJ], 'a escolha da janela do Windows volta para quem pediu');
    ok++;
  }
  terminou = true;
  console.log('test-altium-abrir: ' + ok + ' ok');
})().catch(e => { console.error(e); process.exit(1); });
