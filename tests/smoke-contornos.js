/* Os CONTORNOS do DRC do esquema (1.95.1): em todos os projetos (cópias), nenhum contorno de "fora do almoxarifado"
   desproporcional. Mede, folha por folha, na vista Esquema de verdade (Chrome/Edge headless), a caixa de cada componente
   como a 1.95.0 a juntava (a união de todas as partes do designador) e os contornos da 1.95.1 (o corpo + pinos de cada
   parte, as partes vizinhas juntas, as distantes separadas, com o limite de sanidade), e lista os maiores dos dois.
     node tests/smoke-contornos.js   (CONTORNOS_DE=<pasta Projects>[;<outra>] — padrão: os Projects do repositório;
                                      ALMOX_DE como no smoke-erc.js) */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PORTA = +(process.env.PORTA || 8033);
const DEVTOOLS = +(process.env.DEVTOOLS || 9353);
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(f => fs.existsSync(f));
const PYTHON = [process.env.PYTHON, 'python', 'C:\\Program Files\\NexoEletric\\resources\\python\\python.exe'].filter(Boolean).find(p => {
  try { execFileSync(p, ['-c', 'import flask'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
});
if (!CHROME || !PYTHON) { console.log('smoke-contornos: sem ' + (!CHROME ? 'Chrome/Edge' : 'Python com Flask') + ' — pulei'); process.exit(0); }
const ORIGENS = (process.env.CONTORNOS_DE || path.join(RAIZ, 'Projects')).split(';').filter(Boolean);
const espera = ms => new Promise(r => setTimeout(r, ms));
const HC = require('../hub-core.js');
const PRINT = process.env.SMOKE_PRINT || '';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-contornos-'));
const HUB = path.join(TMP, 'hub');
fs.mkdirSync(path.join(HUB, 'Libs'), { recursive: true });
for (const f of fs.readdirSync(RAIZ)) if (/\.(js|html|css|py)$/.test(f)) fs.copyFileSync(path.join(RAIZ, f), path.join(HUB, f));
for (const d of ['mcp', 'vendor', 'tools']) fs.cpSync(path.join(RAIZ, d), path.join(HUB, d), { recursive: true, filter: s => !/__pycache__/.test(s) });
for (const f of fs.readdirSync(path.join(RAIZ, 'Libs'))) if (/\.(js|json)$/.test(f) && f !== 'pcb-artes.json') fs.copyFileSync(path.join(RAIZ, 'Libs', f), path.join(HUB, 'Libs', f));
const PROJS = [];
for (const raiz of ORIGENS) for (const p of fs.readdirSync(raiz)) {
  const o = path.join(raiz, p);
  if (!fs.existsSync(path.join(o, 'schematic.js')) || PROJS.includes(p)) continue;
  const d = path.join(HUB, 'Projects', p);
  fs.mkdirSync(d, { recursive: true });
  for (const f of ['schematic.js', 'board.js', 'annotations.js', 'rules.js']) if (fs.existsSync(path.join(o, f))) fs.copyFileSync(path.join(o, f), path.join(d, f));
  fs.writeFileSync(path.join(d, 'changes.js'), HC.serializeChanges([]).text);
  PROJS.push(p);
}
const NL = String.fromCharCode(10);
fs.writeFileSync(path.join(HUB, 'projects.js'), 'var projects = [' + NL + PROJS.map(p => JSON.stringify({ name: p, files: { board: fs.existsSync(path.join(HUB, 'Projects', p, 'board.js')), changes: true } })).join(',' + NL) + NL + '];' + NL);
/* o espelho do almoxarifado da máquina (C:\AltiumHub\Libs ou ALMOX_DE), COPIADO para a pasta temporária: sem ele a regra
   do fora do almoxarifado não afirma nada */
const ALMOX_DE = process.env.ALMOX_DE || path.join('C:', path.sep, 'AltiumHub', 'Libs');
let comAlmox = false;
for (const f of ['almox-index.js', 'almox-basicos.js', 'almox-especiais.js', 'almox-locais.js'])
  if (fs.existsSync(path.join(ALMOX_DE, f))) { fs.copyFileSync(path.join(ALMOX_DE, f), path.join(HUB, 'Libs', f)); comAlmox = true; }
const filhos = [];
const fim = (codigo) => { for (const p of filhos) try { p.kill(); } catch (e) {} try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} process.exit(codigo); };

(async () => {
  const env = Object.assign({}, process.env, { NEXOHUB_URL: 'http://127.0.0.1:9', NEXO_CATALOGO: path.join(TMP, 'catalogo-de-teste-inexistente.xlsx') });
  const srv = spawn(PYTHON, [path.join(HUB, 'hubserver.py'), '--port', String(PORTA), '--host', '127.0.0.1'], { cwd: HUB, stdio: 'ignore', env });
  filhos.push(srv);
  let no = false;
  for (let i = 0; i < 80 && !no; i++) { await espera(250); try { const r = await fetch(`http://127.0.0.1:${PORTA}/schframe.html`); await r.arrayBuffer(); no = r.ok; } catch (e) { /* subindo */ } }
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
  const print = async (nome, clip) => { if (!PRINT) return; const r = await cdp('Page.captureScreenshot', Object.assign({ format: 'png' }, clip ? { clip: Object.assign({ scale: 1 }, clip) } : {})); fs.writeFileSync(path.join(PRINT, nome + '.png'), Buffer.from(r.result.data, 'base64')); };
  const ate = async (expr, ms, msg) => { const t0 = Date.now(); for (;;) { const v = await js(expr).catch(() => null); if (v) return v; if (Date.now() - t0 > ms) throw new Error('tempo esgotado: ' + msg); await espera(150); } };
  const clica = async (x, y, mods) => {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers: mods || 0 });
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers: mods || 0 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers: mods || 0 });
    await espera(250);
  };
  const tecla = async (key, code, vk, mods) => { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers: mods || 0 }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: mods || 0 }); await espera(250); };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  const area = b => (b.x2 - b.x1) * (b.y2 - b.y1);
  const lado = b => Math.max(b.x2 - b.x1, b.y2 - b.y1);
  const antes = [], depois = [];
  for (const P of PROJS) {
    await cdp('Page.navigate', { url: `http://127.0.0.1:${PORTA}/schframe.html?p=` + encodeURIComponent(P) });
    const okv = await ate(`!!window.HubMcpVista && !!HubMcpVista.contornosErc`, 40000, 'a vista de ' + P).catch(() => false);
    if (!okv) { console.log('  (não abriu: ' + P + ')'); continue; }
    await espera(900);
    const nf = await js(`document.querySelectorAll('#sheetcards .sheetcard').length || 1`);
    for (let f = 0; f < nf; f++) {
      await js(`HubMcpVista.selecionar({ folha: ${f} })`);
      await espera(150);
      for (const r of await js(`HubMcpVista.contornosErc()`)) {
        const u = r.caixas.reduce((u, b) => ({ x1:Math.min(u.x1, b.x1), y1:Math.min(u.y1, b.y1), x2:Math.max(u.x2, b.x2), y2:Math.max(u.y2, b.y2) }));
        antes.push({ P, f, ref: r.ref, b: u, n: r.caixas.length });
        for (const b of r.contornos) depois.push({ P, f, ref: r.ref, b, n: r.contornos.length });
      }
    }
  }
  const fmt = x => x.P + ' · folha ' + (x.f + 1) + ' · ' + x.ref + ' · ' + Math.round(x.b.x2 - x.b.x1) + '×' + Math.round(x.b.y2 - x.b.y1) + ' mil' + (x.n > 1 ? ' (' + x.n + ')' : '');
  antes.sort((p, q) => lado(q.b) - lado(p.b)); depois.sort((p, q) => lado(q.b) - lado(p.b));
  console.log('ANTES (a união das partes, o contorno da 1.95.0) — os maiores:'); for (const x of antes.slice(0, 8)) console.log('  ' + fmt(x));
  console.log('DEPOIS (1.95.1) — os maiores:'); for (const x of depois.slice(0, 8)) console.log('  ' + fmt(x));
  assert.ok(depois.length, 'nenhum contorno medido');
  /* desproporcional = maior que o maior símbolo real da casa (o PIC18F4620 tem 7100 mil de altura) com folga */
  assert.ok(depois.every(x => lado(x.b) <= 8000), 'contorno desproporcional: ' + depois.filter(x => lado(x.b) > 8000).map(fmt).join(' | '));
  /* nenhum contorno de várias partes atravessa a folha: as partes distantes ficam separadas */
  assert.ok(depois.every(x => x.b.x2 - x.b.x1 <= 6000 || x.n === 1 && antes.some(a => a.P === x.P && a.ref === x.ref && a.n === 1)), 'contorno largo de partes juntadas');
  assert.deepStrictEqual(erros.filter(e => !/schematic\.js não encontrado/.test(e)), [], 'erros na página: ' + erros.join(' || '));
  console.log('smoke-contornos OK (' + PROJS.length + ' projetos, ' + depois.length + ' contornos)');
  ws.close();
  fim(0);
})().catch(e => { console.error(e); fim(1); });
setTimeout(() => { console.error('smoke-contornos: tempo esgotado'); fim(2); }, 900000);
