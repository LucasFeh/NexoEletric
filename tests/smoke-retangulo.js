/* Smoke do RETÂNGULO FECHADO (1.99.0) — arrastar o lado regula o tamanho, na vista PCB e no editor de footprint (pedido
   do dono: "na edição de retângulo, tanto na edição de footprint quanto na pcb, se o formato tiver fechado, dá pra regular
   o tamanho dele só clicando nas laterais e arrastando"). Chrome/Edge headless pelo DevTools Protocol, no molde do
   tests/smoke-borda.js:
     node tests/smoke-retangulo.js   (CHROME, PYTHON, PORTA; SMOKE_PRINT=<pasta> grava as telas)
   Numa CÓPIA da placa (os Projects reais nunca são tocados):
     1. PCB: o retângulo de 4 trilhas na Top Overlay; o cursor vira ew-resize em cima do lado direito; apertar no lado
        direito e arrastar 5 mm: o lado anda, os vizinhos esticam, o esquerdo fica; a altura não muda; Ctrl+Z volta;
     2. editor de footprint: o retângulo de 4 linhas de silk; arrastar o lado de cima 1 mm: só a altura cresce; Ctrl+Z;
        com as 4 linhas selecionadas o arrasto move o retângulo inteiro (não estica);
     3. nenhum erro de script, nenhum diálogo do navegador. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PORTA = +(process.env.PORTA || 8037);
const DEVTOOLS = +(process.env.DEVTOOLS || 9357);
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(f => fs.existsSync(f));
const PYTHON = [process.env.PYTHON, 'python', 'C:\\Program Files\\NexoEletric\\resources\\python\\python.exe'].filter(Boolean).find(p => {
  try { execFileSync(p, ['-c', 'import flask'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
});
if (!CHROME || !PYTHON) { console.log('smoke-retangulo: sem ' + (!CHROME ? 'Chrome/Edge' : 'Python com Flask') + ' — pulei'); process.exit(0); }
const ORIGEM = process.env.SMOKE_PROJ || path.join(RAIZ, 'Projects', 'DMB - DI231765_P2');
const PROJ = path.basename(ORIGEM);
if (!fs.existsSync(path.join(ORIGEM, 'board.js'))) { console.log('smoke-retangulo: a placa não está aqui — pulei'); process.exit(0); }
const espera = ms => new Promise(r => setTimeout(r, ms));
const HC = require('../hub-core.js');
const PRINT = process.env.SMOKE_PRINT || '';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-retangulo-'));
const HUB = path.join(TMP, 'hub');
fs.mkdirSync(path.join(HUB, 'Libs'), { recursive: true });
for (const f of fs.readdirSync(RAIZ)) if (/\.(js|html|css|py)$/.test(f)) fs.copyFileSync(path.join(RAIZ, f), path.join(HUB, f));
for (const d of ['mcp', 'vendor', 'tools']) fs.cpSync(path.join(RAIZ, d), path.join(HUB, d), { recursive: true, filter: s => !/__pycache__/.test(s) });
for (const f of fs.readdirSync(path.join(RAIZ, 'Libs'))) if (/\.(js|json)$/.test(f) && f !== 'pcb-artes.json') fs.copyFileSync(path.join(RAIZ, 'Libs', f), path.join(HUB, 'Libs', f));
const DP = path.join(HUB, 'Projects', PROJ);
fs.mkdirSync(DP, { recursive: true });
for (const f of ['board.js', 'schematic.js', 'annotations.js', 'rules.js', 'board3d.js']) if (fs.existsSync(path.join(ORIGEM, f))) fs.copyFileSync(path.join(ORIGEM, f), path.join(DP, f));
/* o retângulo de contorno do hub na Top Overlay: as 4 trilhas que o poeForma faz (fora da placa, em 200..220 × 200..210) */
const RET = [[200, 200, 220, 200], [220, 200, 220, 210], [220, 210, 200, 210], [200, 210, 200, 200]]
  .map(([x1, y1, x2, y2]) => ({ op:'track_add', layer:'TopOverlay', x1, y1, x2, y2, w:0.2, note:'retângulo do hub' }));
fs.writeFileSync(path.join(DP, 'changes.js'), HC.serializeChanges(RET).text);
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
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORTA}/pcbframe.html?p=` + encodeURIComponent(PROJ) });
  await ate('!!window.__hubPcb', 40000, 'a vista não abriu');
  await espera(1800);
  const P = 'window.__hubPcb';
  await js(`${P}.destravar()`);
  const tela = async (x, y) => js(`(() => { const r = document.getElementById('cv').getBoundingClientRect(), t = ${P}.telaDe(${x}, ${y}); return { x: r.left + t.x, y: r.top + t.y }; })()`);
  const ret = () => js(`${P}.changes().filter(c => c.op === 'track_add').map(c => [c.x1, c.y1, c.x2, c.y2])`);
  const caixa = l => { const xs = [].concat(...l.map(s => [s[0], s[2]])), ys = [].concat(...l.map(s => [s[1], s[3]])); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  const fechado = l => l.every((s, i) => { const t = l[(i + 1) % l.length]; return Math.abs(s[2] - t[0]) < 1e-6 && Math.abs(s[3] - t[1]) < 1e-6; });
  const arrasta = async (a, b, n) => {
    const N = n || 8;
    arrastando = true;
    await mouse('mousePressed', a.x, a.y);
    for (let k = 1; k <= N; k++) await mouse('mouseMoved', a.x + (b.x - a.x) * k / N, a.y + (b.y - a.y) * k / N);
    await espera(200);
    await mouse('mouseReleased', b.x, b.y); arrastando = false;
    await espera(500);
  };

  /* ── 1. PCB ── */
  const r0 = await ret();
  assert.strictEqual(r0.length, 4, 'as 4 trilhas do retângulo');
  await js(`${P}.setView(210, 205, 18)`);
  await espera(600);
  const sd = await tela(220, 205), sd2 = await tela(225, 205.6);
  await mouse('mouseMoved', sd.x, sd.y); await espera(200);
  assert.strictEqual(await js(`document.getElementById('cv').style.cursor`), 'ew-resize', 'o cursor de esticar em cima do lado direito');
  await print('ret-1-pcb-antes');
  await arrasta(sd, sd2);
  const r1 = await ret(), b1 = caixa(r1);
  assert.strictEqual(r1.length, 4, 'continuam 4 trilhas');
  assert.ok(Math.abs(b1[0] - 200) < 1e-6 && Math.abs(b1[2] - 225) < 0.06 && Math.abs(b1[1] - 200) < 1e-6 && Math.abs(b1[3] - 210) < 1e-6,
    'o lado direito foi a 225, o esquerdo e a altura ficaram: ' + JSON.stringify(b1));
  assert.ok(fechado(r1), 'continua fechado: ' + JSON.stringify(r1));
  await print('ret-2-pcb-esticado');
  await js(`HubMcpVista.comando('desfazer')`); await espera(400);
  assert.deepStrictEqual(caixa(await ret()), [200, 200, 220, 210], 'Ctrl+Z volta');

  /* ── 2. o editor de footprint ── */
  await js(`HubFpEditor.abre({ nome:'TESTE_RET', titulo:'teste', fp:{ name:'TESTE_RET', pads:[], bodies:[],
    silk:[[-2,-1,2,-1],[2,-1,2,1],[2,1,-2,1],[-2,1,-2,-1]].map(([x1,y1,x2,y2]) => ({ kind:'line', x1, y1, x2, y2, w:0.15 })) } }); true`);
  await ate(`!!(HubFpEditor.atual && HubFpEditor.atual.E && HubFpEditor.atual.E.fp && HubFpEditor.atual.E.fp.silk.length === 4)`, 15000, 'o editor de footprint abriu');
  await espera(800);
  const FE = 'HubFpEditor.atual.E';
  await js(`(() => { const E = ${FE}; E.view.cx = 0; E.view.cy = 0; E.view.s = 60; E.grade = 0.1; return true; })()`);
  /* o canvas do editor: o maior canvas visível que não é o da vista PCB */
  const FCV = `[...document.querySelectorAll('canvas.c2')].filter(c => c.getBoundingClientRect().width > 300).pop()`;
  const ftela = async (x, y) => js(`(() => { const c = ${FCV}, r = c.getBoundingClientRect(), E = ${FE};
    return { x: r.left + (${x} - E.view.cx) * E.view.s + c.parentElement.clientWidth / 2, y: r.top + (E.view.cy - ${y}) * E.view.s + c.parentElement.clientHeight / 2 }; })()`);
  const silk = () => js(`${FE}.fp.silk.map(o => [o.x1, o.y1, o.x2, o.y2])`);
  const st = await ftela(0, 1), st2 = await ftela(0, 2);
  await mouse('mouseMoved', st.x, st.y); await espera(300);
  await print('ret-3-fp-antes');
  assert.strictEqual(await js(`${FCV}.style.cursor`), 'ns-resize', 'o cursor de esticar em cima do lado de cima');
  await print('ret-3-fp-antes');
  await arrasta(st, st2);
  const f1 = await silk(), fb1 = caixa(f1).map(v => Math.round(v * 1e4) / 1e4);
  assert.deepStrictEqual(fb1, [-2, -1, 2, 2], 'o lado de cima foi a y=2, a largura ficou: ' + JSON.stringify(f1));
  assert.ok(fechado(f1), 'o silk continua fechado');
  await print('ret-4-fp-esticado');
  await js(`${FCV}.focus()`);
  await tecla('z', 'KeyZ', 90, 2);
  assert.deepStrictEqual(caixa(await silk()), [-2, -1, 2, 1], 'Ctrl+Z volta');
  /* com as 4 selecionadas: move tudo */
  await js(`(() => { const E = ${FE}; E.sel = new Set(E.fp.silk); return true; })()`);
  const sm = await ftela(2, 0), sm2 = await ftela(3, 0);
  await arrasta(sm, sm2);
  const f2 = caixa(await silk()).map(v => Math.round(v * 1e4) / 1e4);
  assert.deepStrictEqual(f2, [-1, -1, 3, 1], 'as 4 selecionadas: o retângulo inteiro andou 1 mm (não esticou): ' + JSON.stringify(f2));

  assert.deepStrictEqual(erros, [], 'erros na página: ' + erros.join(' || '));
  assert.strictEqual(fs.readFileSync(path.join(ORIGEM, 'board.js'), 'utf8'), boardAntes, 'a placa de origem não muda');
  console.log('smoke-retangulo OK');
  ws.close();
  fim(0);
})().catch(e => { console.error(e); fim(1); });
setTimeout(() => { console.error('smoke-retangulo: tempo esgotado'); fim(2); }, 240000);
