/* Smoke dos TEARDROPS na vista PCB de verdade (pcbframe.html num Chrome/Edge headless, pelo DevTools
   Protocol), no molde do tests/smoke-autorotear.js:
     node tests/smoke-teardrops.js            (CHROME, PYTHON, PORTA; SMOKE_PRINT=<pasta> grava as telas)
   Fora do `test-*.js` de propósito: precisa do navegador e do Python do hub (Flask). Sobe um hub
   temporário numa cópia de uma placa do acervo (com a marca do ExportBoard novo) — os Projects reais
   nunca são tocados.

   1. a gaveta Teardrops da barra: Pôr na frente (fixo), Tirar dentro;
   2. Tirar: um region_del por teardrop do espelho;
   3. Pôr: os de pad/via e os de junção em T (1.42.0), validados;
   4. Tirar de novo: as linhas do hub saem; Ctrl+Z devolve;
   5. nenhum erro de script na página. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PORTA = +(process.env.PORTA || 8013);
const DEVTOOLS = +(process.env.DEVTOOLS || 9335);
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(f => fs.existsSync(f));
const PYTHON = [process.env.PYTHON, 'python', 'C:\\Program Files\\NexoEletric\\resources\\python\\python.exe'].filter(Boolean).find(p => {
  try { execFileSync(p, ['-c', 'import flask'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
});
if (!CHROME || !PYTHON) { console.log('smoke-teardrops: sem ' + (!CHROME ? 'Chrome/Edge' : 'Python com Flask') + ' — pulei'); process.exit(0); }
const PROJ = 'PRJ - DI261930';
if (!fs.existsSync(path.join(RAIZ, 'Projects', PROJ, 'board.js'))) { console.log('smoke-teardrops: a placa do acervo não está aqui — pulei'); process.exit(0); }
const espera = ms => new Promise(r => setTimeout(r, ms));
const lerVar = (f, v) => new Function(fs.readFileSync(f, 'utf8') + ';return ' + v + ';')();
const HC = require('../hub-core.js');

/* ---- o hub temporário: o código daqui + a cópia da placa, com três nets sem trilha ---- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-teardrops-'));
const HUB = path.join(TMP, 'hub');
fs.mkdirSync(path.join(HUB, 'Libs'), { recursive: true });
for (const f of fs.readdirSync(RAIZ)) if (/\.(js|html|css|py)$/.test(f)) fs.copyFileSync(path.join(RAIZ, f), path.join(HUB, f));
for (const d of ['mcp', 'vendor', 'tools']) fs.cpSync(path.join(RAIZ, d), path.join(HUB, d), { recursive: true, filter: s => !/__pycache__/.test(s) });
for (const f of fs.readdirSync(path.join(RAIZ, 'Libs'))) if (/\.(js|json)$/.test(f)) fs.copyFileSync(path.join(RAIZ, 'Libs', f), path.join(HUB, 'Libs', f));
const DP = path.join(HUB, 'Projects', PROJ);
fs.cpSync(path.join(RAIZ, 'Projects', PROJ), DP, { recursive: true });
fs.rmSync(path.join(DP, 'Gerber'), { recursive: true, force: true });
/* o acervo é de espelho antigo (sem "exporter"): a CÓPIA ganha a marca do ExportBoard novo para os
   teardrops do espelho poderem sair por region_del */
const BJ = path.join(DP, 'board.js');
fs.writeFileSync(BJ, fs.readFileSync(BJ, 'utf8').replace(/var pcbmirror = \{/, 'var pcbmirror = {\n"exporter":"ExportBoard 2026-10 (teste)",'));
const CHF = path.join(DP, 'changes.js');
fs.writeFileSync(CHF, HC.serializeChanges([]).text);
fs.writeFileSync(path.join(HUB, 'projects.js'), 'var projects = [\n' + JSON.stringify({ name: PROJ, files: { board: true, changes: true } }) + '\n];\n');
const realAntes = fs.readFileSync(path.join(RAIZ, 'Projects', PROJ, 'board.js'), 'utf8');

const filhos = [];
const fim = (codigo) => { for (const p of filhos) try { p.kill(); } catch (e) {} try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} process.exit(codigo); };

(async () => {
  const srv = spawn(PYTHON, [path.join(HUB, 'hubserver.py'), '--port', String(PORTA), '--host', '127.0.0.1'], { cwd: HUB, stdio: 'ignore' });
  filhos.push(srv);
  let no = false;
  for (let i = 0; i < 80 && !no; i++) { await espera(250); try { const r = await fetch(`http://127.0.0.1:${PORTA}/pcbframe.html`); await r.arrayBuffer(); no = r.ok; } catch (e) { /* subindo */ } }
  assert.ok(no, 'o hub temporário não subiu na ' + PORTA);
  const ud = fs.mkdtempSync(path.join(TMP, 'chrome-'));
  const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + DEVTOOLS, '--user-data-dir=' + ud, 'about:blank'], { stdio: 'ignore' });
  filhos.push(ch);
  let alvo = null;
  for (let i = 0; i < 60 && !alvo; i++) { await espera(250); try { alvo = (await (await fetch(`http://127.0.0.1:${DEVTOOLS}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) { /* subindo */ } }
  assert.ok(alvo, 'o navegador não abriu o DevTools');
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((ok, falha) => { ws.onopen = ok; ws.onerror = falha; });
  const erros = [];
  let id = 0; const pend = new Map();
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
    else if (d.method === 'Page.javascriptDialogOpening') { erros.push('diálogo do navegador: ' + d.params.message); ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } })); }
    else if (d.method === 'Runtime.exceptionThrown') erros.push('exceção: ' + JSON.stringify(d.params.exceptionDetails).slice(0, 400));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') erros.push(d.params.args.map(a => a.value || a.description).join(' ').slice(0, 300));
  };
  const cdp = (method, params) => new Promise(ok => { const n = ++id; pend.set(n, ok); ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
  const js = async s => { const r = await cdp('Runtime.evaluate', { expression: s, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(s.slice(0, 80) + ': ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
  const print = async nome => { if (!process.env.SMOKE_PRINT) return; const r = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(process.env.SMOKE_PRINT, nome + '.png'), Buffer.from(r.result.data, 'base64')); };
  const tecla = async (key, code, vk) => { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }); await espera(120); };
  const ate = async (expr, ms, msg) => { const t0 = Date.now(); for (;;) { const v = await js(expr).catch(() => null); if (v) return v; if (Date.now() - t0 > ms) throw new Error('tempo esgotado: ' + msg); await espera(150); } };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORTA}/pcbframe.html?p=` + encodeURIComponent(PROJ) });
  await ate('!!window.__hubPcb', 30000, 'a vista não abriu');
  await espera(1500);
  const P = 'window.__hubPcb';
  assert.strictEqual(await js(`${P}.changes().length`), 0);

  /* 1. a gaveta Teardrops na barra: Pôr na frente, Tirar dentro */
  const bar = await js(`(() => { const g = document.getElementById('tb-teardropsGrupo'); if (!g) return null;
    const p = g.querySelector('.gprin'), t = document.getElementById('tb-teardrops'), x = document.getElementById('tb-tirarTeardrops');
    return { prin: p && p.title, por: t && t.title, tirar: x && x.title, naGaveta: !!(x && x.closest('.gaveta')) }; })()`);
  assert.ok(bar && /Teardrops/.test(bar.prin) && /junções em T/.test(bar.por) && /Tirar teardrops/.test(bar.tirar) && bar.naGaveta, 'a gaveta: ' + JSON.stringify(bar));
  const nEsp = await js(`HubPcbTeardrop.todos(${P}.EB, null).length`);
  assert.ok(nEsp > 0, 'a placa tem teardrops do espelho');
  await js(`${P}.destravar()`);
  await print('teardrops-0-antes');

  /* 2. Tirar: um region_del por teardrop do espelho, e o reconhecimento não acha mais nenhum */
  await js(`document.getElementById('tb-tirarTeardrops').click()`);
  await espera(600);
  const ch1 = await js(`${P}.changes()`);
  assert.strictEqual(ch1.length, nEsp, 'um region_del por teardrop: ' + ch1.length + ' de ' + nEsp);
  assert.ok(ch1.every(c => c.op === 'region_del'));
  assert.deepStrictEqual(await js(`${P}.valida().filter(v => v.status === "err").length`), 0, 'valida');
  assert.strictEqual(await js(`HubPcbTeardrop.todos(${P}.EB, null).length`), 0, 'sem teardrop na tela');
  /* o botão da frente continua sendo o Pôr (grupo fixo) */
  assert.ok(/junções em T/.test(await js(`document.querySelector('#tb-teardropsGrupo .gprin').title`)), 'o botão da frente continua o Pôr');
  await print('teardrops-1-tirados');

  /* 3. Pôr (o botão da frente): os de pad/via e os de junção em T */
  await js(`document.querySelector('#tb-teardropsGrupo .gprin').click()`);
  await espera(800);
  const ch2 = await js(`${P}.changes()`);
  const postos = ch2.filter(c => c.op === 'region_add' && c.note === 'teardrop do hub').length;
  const emT = await js(`HubPcbTeardrop.reconhece(${P}.EB).filter(r => r.tipo === 'trilha').length`);
  assert.ok(postos > 0 && emT > 0, `postos ${postos}, em T ${emT}`);
  assert.deepStrictEqual(await js(`${P}.valida().filter(v => v.status === "err").length`), 0, 'valida');
  await print('teardrops-2-postos');

  /* 4. Tirar de novo: as linhas do hub saem; Ctrl+Z as devolve */
  await js(`document.getElementById('tb-tirarTeardrops').click()`);
  await espera(600);
  const ch3 = await js(`${P}.changes()`);
  assert.strictEqual(ch3.length, nEsp, 'ficam só os region_del');
  await js(`document.getElementById('cv').focus()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await espera(600);
  assert.strictEqual(await js(`${P}.changes().length`), nEsp + postos, 'Ctrl+Z devolve os teardrops do hub');

  /* 5. sem erro de script, sem diálogo do navegador */
  assert.deepStrictEqual(erros, [], 'erros na página: ' + erros.join(' || '));
  assert.strictEqual(fs.readFileSync(path.join(RAIZ, 'Projects', PROJ, 'board.js'), 'utf8'), realAntes, 'o projeto real não muda');
  console.log(`smoke-teardrops OK (${nEsp} do espelho tirados, ${postos} postos pelo hub com ${emT} em T, tirados de novo, Ctrl+Z)`);
  ws.close();
  fim(0);
})().catch(e => { console.error(e); fim(1); });
setTimeout(() => { console.error('smoke-teardrops: tempo esgotado'); fim(2); }, 240000);
