/* Smoke do ENVIO AO ODOO BLOQUEADO sem a PCB declarada (1.92.2) na vista Esquema de verdade (schframe.html num
   Chrome/Edge headless, pelo DevTools Protocol), no molde do tests/smoke-borda.js:
     node tests/smoke-odoo-bloqueio.js   (CHROME, PYTHON, PORTA; SMOKE_PRINT=<pasta> grava as telas;
                                          SMOKE_PROJ=<pasta de um projeto> usa a cópia dele no lugar da DMB do repositório)
   Numa CÓPIA do projeto, com o cabeçalho do esquema SEM o código da placa (como antes do Definir projeto). Nada vai ao
   Odoo: o hub temporário não tem credencial e o servidor recusa antes de falar com ele.
     1. o "Enviar lista" fica desligado, com o motivo à vista ("Envio ao Odoo bloqueado: PCB não declarada… Definir projeto");
     2. o servidor recusa o ensaio e o envio (409, semPcb) mesmo chamado direto (a IA, outro cliente);
     3. definido o projeto (o código da placa no cabeçalho), o botão volta sozinho;
     4. nenhum erro de script, nenhum diálogo do navegador. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PORTA = +(process.env.PORTA || 8023);
const DEVTOOLS = +(process.env.DEVTOOLS || 9345);
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(f => fs.existsSync(f));
const PYTHON = [process.env.PYTHON, 'python', 'C:\\Program Files\\NexoEletric\\resources\\python\\python.exe'].filter(Boolean).find(p => {
  try { execFileSync(p, ['-c', 'import flask'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
});
if (!CHROME || !PYTHON) { console.log('smoke-odoo-bloqueio: sem ' + (!CHROME ? 'Chrome/Edge' : 'Python com Flask') + ' — pulei'); process.exit(0); }
const ORIGEM = process.env.SMOKE_PROJ || path.join(RAIZ, 'Projects', 'DMB - DI231765_P2');
const PROJ = path.basename(ORIGEM);
if (!fs.existsSync(path.join(ORIGEM, 'board.js'))) { console.log('smoke-odoo-bloqueio: a placa não está aqui — pulei'); process.exit(0); }
const espera = ms => new Promise(r => setTimeout(r, ms));
const HC = require('../hub-core.js');
const PRINT = process.env.SMOKE_PRINT || '';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-odoo-bloqueio-'));
const HUB = path.join(TMP, 'hub');
fs.mkdirSync(path.join(HUB, 'Libs'), { recursive: true });
for (const f of fs.readdirSync(RAIZ)) if (/\.(js|html|css|py)$/.test(f)) fs.copyFileSync(path.join(RAIZ, f), path.join(HUB, f));
for (const d of ['mcp', 'vendor', 'tools']) fs.cpSync(path.join(RAIZ, d), path.join(HUB, d), { recursive: true, filter: s => !/__pycache__/.test(s) });
for (const f of fs.readdirSync(path.join(RAIZ, 'Libs'))) if (/\.(js|json)$/.test(f) && f !== 'pcb-artes.json') fs.copyFileSync(path.join(RAIZ, 'Libs', f), path.join(HUB, 'Libs', f));
const DP = path.join(HUB, 'Projects', PROJ);
fs.mkdirSync(DP, { recursive: true });
for (const f of ['board.js', 'schematic.js', 'annotations.js', 'rules.js', 'board3d.js']) if (fs.existsSync(path.join(ORIGEM, f))) fs.copyFileSync(path.join(ORIGEM, f), path.join(DP, f));
fs.writeFileSync(path.join(DP, 'changes.js'), HC.serializeChanges([]).text);
/* o cabeçalho do esquema SEM o código da placa (como antes do Definir projeto) */
{
  const f = path.join(DP, 'schematic.js');
  const sch = new Function(fs.readFileSync(f, 'utf8') + ';return schematic;')();
  sch.params = String(sch.params || '').split(';').filter(p => p && !/^\s*CodigoDaPlaca\s*=/i.test(p)).join(';');
  fs.writeFileSync(f, 'var schematic = ' + JSON.stringify(sch) + ';\n');
}
fs.writeFileSync(path.join(HUB, 'projects.js'), 'var projects = [\n' + JSON.stringify({ name: PROJ, files: { board: true, changes: true } }) + '\n];\n');
const boardAntes = fs.readFileSync(path.join(ORIGEM, 'board.js'), 'utf8');

const filhos = [];
const fim = (codigo) => { for (const p of filhos) try { p.kill(); } catch (e) {} try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} process.exit(codigo); };

(async () => {
  const env = Object.assign({}, process.env, { NEXOHUB_URL: 'http://127.0.0.1:9', NEXO_CATALOGO: path.join(TMP, 'catalogo-de-teste-inexistente.xlsx') });
  const srv = spawn(PYTHON, [path.join(HUB, 'hubserver.py'), '--port', String(PORTA), '--host', '127.0.0.1'], { cwd: HUB, stdio: 'ignore', env });
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
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
      const t = d.params.args.map(a => a.value || a.description).join(' ').slice(0, 300);
      if (!/127\.0\.0\.1:9|Failed to load resource|ERR_CONNECTION_REFUSED|fonts\.g/.test(t)) erros.push(t);
    }
  };
  const cdp = (method, params) => new Promise(ok => { const n = ++id; pend.set(n, ok); ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
  const js = async s => { const r = await cdp('Runtime.evaluate', { expression: s, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(s.slice(0, 80) + ': ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
  const print = async nome => { if (!PRINT) return; const r = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(PRINT, nome + '.png'), Buffer.from(r.result.data, 'base64')); };
  const ate = async (expr, ms, msg) => { const t0 = Date.now(); for (;;) { const v = await js(expr).catch(() => null); if (v) return v; if (Date.now() - t0 > ms) throw new Error('tempo esgotado: ' + msg); await espera(150); } };
  const mouse = async (type, x, y) => cdp('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : (type === 'mousePressed' || arrastando ? 1 : 0), clickCount: type === 'mouseMoved' ? 0 : 1 });
  let arrastando = false;
  const tecla = async (key, code, vk, mods) => { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers: mods || 0 }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: mods || 0 }); await espera(250); };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORTA}/schframe.html?p=` + encodeURIComponent(PROJ) });
  await ate(`!!document.getElementById('btnOdooLista')`, 40000, 'a vista Esquema não abriu (sem o botão do Odoo)');
  /* 1. o botão desligado com o motivo */
  await ate(`document.getElementById('btnOdooLista').disabled && /bloqueado/.test((document.getElementById('odooBloqueio') || {}).textContent || '')`, 15000, 'o botão não ficou bloqueado');
  const b = await js(`(() => { const b = document.getElementById('btnOdooLista'), h = document.getElementById('odooBloqueio'), r = h.getBoundingClientRect(); return { dis: b.disabled, tit: b.title, hint: h.textContent, vis: !h.hidden && r.width > 50 && r.height > 5 }; })()`);
  assert.ok(b.dis && b.vis && /PCB não declarada/.test(b.hint) && /Definir projeto/.test(b.hint) && /bloqueado/.test(b.tit), 'o motivo à vista: ' + JSON.stringify(b));
  await espera(500);
  await print('odoo-1-envio-bloqueado-sem-pcb-declarada');
  if (PRINT) {
    const r = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 1180, y: 0, width: 420, height: 1000, scale: 1 } });
    fs.writeFileSync(path.join(PRINT, 'odoo-2-painel-enviar-lista-bloqueado.png'), Buffer.from(r.result.data, 'base64'));
  }
  /* 2. o servidor recusa direto */
  for (const [rota, corpo] of [['ensaio', {}], ['envio', { confirmado: true, uid_externo: 'altium:x:A', total_linhas: 1 }]]) {
    const r = await fetch(`http://127.0.0.1:${PORTA}/api/lista/${rota}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ projeto: PROJ, revisao: 'A' }, corpo)) });
    const j = await r.json();
    assert.ok(r.status === 409 && j.semPcb && /Definir projeto/.test(j.error), rota + ': ' + r.status + ' ' + JSON.stringify(j));
  }
  /* 3. o Definir projeto grava o código: o botão volta sozinho (o foco da página pergunta de novo) */
  const fsch = path.join(DP, 'schematic.js');
  const sch = new Function(fs.readFileSync(fsch, 'utf8') + ';return schematic;')();
  sch.params = 'CodigoDaPlaca=PMD-DI261946;Revisao=REV. C';
  fs.writeFileSync(fsch, 'var schematic = ' + JSON.stringify(sch) + ';\n');
  await js(`window.dispatchEvent(new Event('focus'))`);
  await ate(`!document.getElementById('btnOdooLista').disabled`, 15000, 'o botão não voltou depois do Definir projeto');
  assert.ok(await js(`document.getElementById('odooBloqueio').hidden`), 'o aviso some');
  assert.deepStrictEqual(erros, [], 'erros na página: ' + erros.join(' || '));
  assert.strictEqual(fs.readFileSync(path.join(ORIGEM, 'board.js'), 'utf8'), boardAntes, 'o projeto de origem não muda');
  console.log('smoke-odoo-bloqueio OK (' + PROJ + ')');
  ws.close();
  fim(0);
})().catch(e => { console.error(e); fim(1); });
setTimeout(() => { console.error('smoke-odoo-bloqueio: tempo esgotado'); fim(2); }, 300000);
