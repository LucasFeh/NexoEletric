/* Smoke da IMAGEM OU TEXTO -> SERIGRAFIA na vista PCB de verdade (pcbframe.html num Chrome/Edge headless, pelo
   DevTools Protocol), no molde do tests/smoke-teardrops.js:
     node tests/smoke-serigrafia.js            (CHROME, PYTHON, PORTA; SMOKE_PRINT=<pasta> grava as telas)
   Fora do `test-*.js` de propósito: precisa do navegador e do Python do hub (Flask). Sobe um hub temporário numa
   cópia de uma placa do acervo — os Projects reais nunca são tocados.
     1. o botão da barra abre o diálogo (hub-pcbsilkgen.js) com o motor (hub-silkgen.js) carregado;
     2. aba Texto: o texto vira region_add na TopOverlay, com holes nos miolos, e a prévia mostra o tamanho;
     3. Colocar: as regiões entram no changes, ficam selecionadas e validam;
     4. girar a seleção (Espaço) gira as regiões com os furos; Ctrl+Z desfaz o giro e a colocação;
     5. nenhum erro de script, nenhum diálogo do navegador. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PORTA = +(process.env.PORTA || 8017);
const DEVTOOLS = +(process.env.DEVTOOLS || 9339);
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(f => fs.existsSync(f));
const PYTHON = [process.env.PYTHON, 'python', 'C:\\Program Files\\NexoEletric\\resources\\python\\python.exe'].filter(Boolean).find(p => {
  try { execFileSync(p, ['-c', 'import flask'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
});
if (!CHROME || !PYTHON) { console.log('smoke-serigrafia: sem ' + (!CHROME ? 'Chrome/Edge' : 'Python com Flask') + ' — pulei'); process.exit(0); }
const PROJ = 'PRJ - DI261930';
if (!fs.existsSync(path.join(RAIZ, 'Projects', PROJ, 'board.js'))) { console.log('smoke-serigrafia: a placa do acervo não está aqui — pulei'); process.exit(0); }
const espera = ms => new Promise(r => setTimeout(r, ms));
const lerVar = (f, v) => new Function(fs.readFileSync(f, 'utf8') + ';return ' + v + ';')();
const HC = require('../hub-core.js');

/* ---- o hub temporário: o código daqui + a cópia da placa, com três nets sem trilha ---- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-serigrafia-'));
const HUB = path.join(TMP, 'hub');
fs.mkdirSync(path.join(HUB, 'Libs'), { recursive: true });
for (const f of fs.readdirSync(RAIZ)) if (/\.(js|html|css|py)$/.test(f)) fs.copyFileSync(path.join(RAIZ, f), path.join(HUB, f));
for (const d of ['mcp', 'vendor', 'tools']) fs.cpSync(path.join(RAIZ, d), path.join(HUB, d), { recursive: true, filter: s => !/__pycache__/.test(s) });
for (const f of fs.readdirSync(path.join(RAIZ, 'Libs'))) if (/\.(js|json)$/.test(f)) fs.copyFileSync(path.join(RAIZ, 'Libs', f), path.join(HUB, 'Libs', f));
const DP = path.join(HUB, 'Projects', PROJ);
fs.cpSync(path.join(RAIZ, 'Projects', PROJ), DP, { recursive: true });
fs.rmSync(path.join(DP, 'Gerber'), { recursive: true, force: true });
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
  await js(`${P}.destravar()`);

  /* 1. o botão da barra abre o diálogo */
  const tit = await js(`(document.getElementById('tb-serigrafia') || {}).title || ''`);
  assert.ok(/serigrafia/.test(tit), 'o botão na barra: ' + tit);
  assert.ok(await js('typeof HubSilkGen === "object" && typeof HubPcbSilkGen === "object"'), 'o motor e o diálogo carregados');
  await js(`document.getElementById('tb-serigrafia').click()`);
  await ate('!!document.querySelector(".sg-box")', 5000, 'o diálogo não abriu');

  /* 2. aba Texto */
  await js(`[...document.querySelectorAll('.sg-abas button')].find(b => b.textContent === 'Texto').click()`);
  await js(`(() => { const t = document.querySelector('.sg-ctl textarea'); t.value = 'DIEletrons 08'; t.dispatchEvent(new Event('input')); })()`);
  await ate('/mm ·/.test(document.querySelector(".sg-info").textContent) && !document.querySelector(".sg-btns .ok").disabled', 8000, 'a prévia não saiu');
  const info = await js('document.querySelector(".sg-info").textContent');
  await print('serigrafia-1-dialogo');

  /* 3. Colocar */
  await js(`document.querySelector('.sg-btns .ok').click()`);
  await ate(`!document.querySelector('.sg-scrim') && ${P}.changes().length > 0`, 8000, 'Colocar não escreveu');
  await espera(500);
  const sg = await js(`${P}.changes()`);
  assert.ok(sg.length >= 10, 'uma região por letra: ' + sg.length);
  assert.ok(sg.every(c => c.op === 'region_add' && c.layer === 'TopOverlay' && /serigrafia de texto/.test(c.note || '')), 'region_add na TopOverlay com a nota');
  const comFuro = sg.filter(c => Array.isArray(c.holes) && c.holes.length).length;
  assert.ok(comFuro >= 4, 'os miolos (D, e, o, 0, 8) são holes: ' + comFuro);
  assert.strictEqual(await js(`${P}.sel().length`), sg.length, 'as regiões ficam selecionadas');
  assert.strictEqual(await js(`${P}.validacao().filter(v => v.level === 'err').length`), 0, 'validam: ' + JSON.stringify(await js(`${P}.validacao()`)).slice(0, 300));
  await print('serigrafia-2-colocado');

  /* 4. girar a selecao e desfazer */
  const antes = JSON.stringify(sg);
  await js(`HubMcpVista.comando('girar')`);
  await espera(600);
  const sg2 = await js(`${P}.changes()`);
  assert.strictEqual(sg2.length, sg.length, 'girar edita as mesmas linhas');
  assert.notStrictEqual(JSON.stringify(sg2), antes, 'as regiões giraram');
  assert.strictEqual(sg2.filter(c => Array.isArray(c.holes) && c.holes.length).length, comFuro, 'os furos giram junto');
  await js(`HubMcpVista.comando('desfazer')`); await espera(400);
  assert.strictEqual(JSON.stringify(await js(`${P}.changes()`)), antes, 'Ctrl+Z desfaz o giro');
  await js(`HubMcpVista.comando('desfazer')`); await espera(400);
  assert.strictEqual(await js(`${P}.changes().length`), 0, 'Ctrl+Z desfaz a colocação');

  /* 5. sem erro de script, sem diálogo do navegador */
  assert.deepStrictEqual(erros, [], 'erros na página: ' + erros.join(' || '));
  assert.strictEqual(fs.readFileSync(path.join(RAIZ, 'Projects', PROJ, 'board.js'), 'utf8'), realAntes, 'o projeto real não muda');
  console.log(`smoke-serigrafia OK (${sg.length} regiões, ${comFuro} com furo; prévia: ${info})`);
  ws.close();
  fim(0);
})().catch(e => { console.error(e); fim(1); });
setTimeout(() => { console.error('smoke-serigrafia: tempo esgotado'); fim(2); }, 240000);
