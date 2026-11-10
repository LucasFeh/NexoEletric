/* Smoke da FERRAMENTA PORT (1.94.0) na vista Esquema de verdade (schframe.html num Chrome/Edge headless, pelo DevTools
   Protocol), no molde do tests/smoke-folha.js:
     node tests/smoke-port.js   (CHROME, PYTHON, PORTA; SMOKE_PRINT=<pasta> grava as telas;
                                 SMOKE_PROJ=<pasta de um projeto> usa a cópia dele no lugar da DMB do repositório)
   Numa CÓPIA do projeto (os Projects reais nunca são tocados):
     1. a gaveta dos pousos tem a Port (ao lado da net);
     2. pousar 11 ports empilhadas (como na imagem do dono: SLCK, C4, C3, C2, SDN, RST, WDT_UB, L1, L4, L3, SENSOR VP) —
        no estilo da casa (borda azul escura, fundo branco, texto azul centralizado, ponta à direita);
     3. marcar todas e dar a mesma largura fixa pela ficha (vale para todas de uma vez, um Ctrl+Z);
     4. estilizar uma diferente (borda, fundo, texto à esquerda, tamanho, fonte, cor do texto);
     5. Espaço gira a port (em pé) e o Ctrl+Z volta;
     6. nenhum erro de script, nenhum diálogo do navegador. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PORTA = +(process.env.PORTA || 8029);
const DEVTOOLS = +(process.env.DEVTOOLS || 9349);
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(f => fs.existsSync(f));
const PYTHON = [process.env.PYTHON, 'python', 'C:\\Program Files\\NexoEletric\\resources\\python\\python.exe'].filter(Boolean).find(p => {
  try { execFileSync(p, ['-c', 'import flask'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
});
if (!CHROME || !PYTHON) { console.log('smoke-port: sem ' + (!CHROME ? 'Chrome/Edge' : 'Python com Flask') + ' — pulei'); process.exit(0); }
const ORIGEM = process.env.SMOKE_PROJ || path.join(RAIZ, 'Projects', 'DMB - DI231765_P2');
const PROJ = path.basename(ORIGEM);
if (!fs.existsSync(path.join(ORIGEM, 'schematic.js'))) { console.log('smoke-port: o projeto não está aqui — pulei'); process.exit(0); }
const espera = ms => new Promise(r => setTimeout(r, ms));
const HC = require('../hub-core.js');
const PRINT = process.env.SMOKE_PRINT || '';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-port-'));
const HUB = path.join(TMP, 'hub');
fs.mkdirSync(path.join(HUB, 'Libs'), { recursive: true });
for (const f of fs.readdirSync(RAIZ)) if (/\.(js|html|css|py)$/.test(f)) fs.copyFileSync(path.join(RAIZ, f), path.join(HUB, f));
for (const d of ['mcp', 'vendor', 'tools']) fs.cpSync(path.join(RAIZ, d), path.join(HUB, d), { recursive: true, filter: s => !/__pycache__/.test(s) });
for (const f of fs.readdirSync(path.join(RAIZ, 'Libs'))) if (/\.(js|json)$/.test(f) && f !== 'pcb-artes.json') fs.copyFileSync(path.join(RAIZ, 'Libs', f), path.join(HUB, 'Libs', f));
const DP = path.join(HUB, 'Projects', PROJ);
fs.mkdirSync(DP, { recursive: true });
for (const f of ['board.js', 'schematic.js', 'annotations.js', 'rules.js', 'board3d.js']) if (fs.existsSync(path.join(ORIGEM, f))) fs.copyFileSync(path.join(ORIGEM, f), path.join(DP, f));
fs.writeFileSync(path.join(DP, 'changes.js'), HC.serializeChanges([]).text);
fs.writeFileSync(path.join(HUB, 'projects.js'), 'var projects = [\n' + JSON.stringify({ name: PROJ, files: { board: fs.existsSync(path.join(DP, 'board.js')), changes: true } }) + '\n];\n');
const schAntes = fs.readFileSync(path.join(ORIGEM, 'schematic.js'), 'utf8');

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
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORTA}/schframe.html?p=` + encodeURIComponent(PROJ) });
  await ate(`!!document.getElementById('tbPort') && !!window.HubMcpVista`, 40000, 'a vista Esquema não abriu (sem o botão Port)');
  await espera(1500);
  /* o centro do canvas, em px da página: focar(x, y) põe o mundo (x, y) ali */
  const centro = await js(`(() => { const r = HubMcpVista.captura().getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const ports = () => js(`schematic.items.filter(i => i && i.t === 'port').map(p => Object.assign({}, p))`);

  /* 1. a gaveta com a Port */
  await js(`document.getElementById('tbPousoSeta').click()`);
  await espera(300);
  const gav = await js(`[...document.querySelectorAll('#gavPousoLista button')].map(b => b.querySelector('.lb').textContent)`);
  assert.ok(gav.includes('port') && gav.indexOf('port') === gav.indexOf('net') + 1, 'a Port logo depois da net: ' + gav.join(' | '));
  if (PRINT) {
    const r = await js(`(() => { const a = document.getElementById('schtb').getBoundingClientRect(), b = document.getElementById('gavPousoLista').getBoundingClientRect(); return { x: Math.max(0, a.left - 6), y: Math.max(0, a.top - 6), width: Math.max(a.right, b.right) - a.left + 12, height: Math.max(a.bottom, b.bottom) - a.top + 12 }; })()`);
    await print('port-1-barra-com-port', r);
  }
  await js(`document.getElementById('tbPousoSeta').click()`);
  await espera(200);

  /* 2. as 11 ports empilhadas */
  const NOMES = ['SLCK', 'C4', 'C3', 'C2', 'SDN', 'RST', 'WDT_UB', 'L1', 'L4', 'L3', 'SENSOR VP'];
  const X0 = 9400, Y0 = 2600, PASSO = 100;
  for (let k = 0; k < NOMES.length; k++) {
    if (await js(`document.getElementById('tbPort').getAttribute('aria-pressed') === 'true'`)) await js(`document.getElementById('tbPort').click()`);
    await js(`document.getElementById('tbPort').click()`);
    await ate(`document.getElementById('netform').style.display === 'block'`, 3000, 'o campo do nome não abriu');
    if (k === 0) assert.ok(/port/.test(await js(`document.getElementById('netformTit').textContent`)), 'o campo fala de port');
    await js(`(() => { const i = document.getElementById('nettext'); i.value = ${JSON.stringify(NOMES[k])}; document.getElementById('netok').click(); })()`);
    await espera(150);
    assert.strictEqual(await js(`document.getElementById('tbPort').getAttribute('aria-pressed')`), 'true', 'a ferramenta Port armada');
    await js(`HubMcpVista.focar(${X0}, ${Y0 - k * PASSO}, 900)`);
    await espera(200);
    await clica(centro.x, centro.y);
  }
  await tecla('Escape', 'Escape', 27);
  let P = await ports();
  const novas = P.filter(p => NOMES.includes(p.net));
  assert.strictEqual(novas.length, NOMES.length, 'as 11 ports: ' + novas.map(p => p.net).join(','));
  assert.ok(novas.every(p => p.seta === 'direita' && p.fill === '#ffffff' && p.color === '#1f3a93' && p.textColor === '#1f4fd1' && p.alinha === 'centro' && p.style === 2),
    'no estilo da casa: ' + JSON.stringify(novas[0]));
  assert.deepStrictEqual(novas.map(p => [p.x, p.y]), NOMES.map((_, k) => [X0, Y0 - k * PASSO]), 'pousadas onde o clique mandou (na grade)');

  /* 3. marcar todas (clique + Shift) e dar a mesma largura pela ficha */
  const pega = async (net, mods) => {
    const p = (await ports()).find(q => q.net === net);
    const w = await js(`HubDraw.portGeom(${JSON.stringify(p)}).w`);
    await js(`HubMcpVista.focar(${p.x + w / 2}, ${p.y}, 900)`);
    await espera(150);
    await clica(centro.x, centro.y, mods);
  };
  await pega(NOMES[0]);
  for (const nm of NOMES.slice(1)) await pega(nm, 8);
  await js(`HubMcpVista.focar(${X0 + 300}, ${Y0 - 5 * PASSO}, 1100)`);
  await espera(300);
  await ate(`/11 ports/.test((document.querySelector('#prBody .pr-title') || {}).textContent || '')`, 4000, 'a ficha das 11 ports');
  const muda = async (titulo, v) => js(`(() => { const s = [...document.querySelectorAll('#prBody .pr-port select, #prBody .pr-port input')].find(x => x.title === ${JSON.stringify(titulo)}); if (!s) return false; s.value = ${JSON.stringify(String(v))}; s.dispatchEvent(new Event('change')); return true; })()`);
  assert.ok(await muda('automática acompanha o nome', 'fixa'), 'o seletor de largura');
  await espera(300);
  assert.ok(await muda('largura fixa, em mil (Enter grava)', '600'), 'o campo da largura');
  await espera(400);
  P = await ports();
  assert.ok(P.filter(p => NOMES.includes(p.net)).every(p => p.w === 600 && p.larguraAuto === false), 'as 11 com 600 mil');
  if (PRINT) {
    await print('port-3-painel-de-estilo-11-ports');
    const r = await js(`(() => { const a = document.getElementById('props').getBoundingClientRect(); return { x: a.left, y: a.top, width: a.width, height: Math.min(1000 - a.top, a.height) }; })()`);
    await print('port-3b-ficha-da-port', r);
  }
  await tecla('Escape', 'Escape', 27);
  await js(`HubMcpVista.focar(${X0 + 300}, ${Y0 - 5 * PASSO}, 1000)`);
  await espera(400);
  await print('port-2-ports-empilhadas');

  /* 4. uma estilizada diferente: SENSOR VP */
  await pega('SENSOR VP');
  await ate(`(document.querySelector('#prBody .pr-port') || null) !== null`, 3000, 'a ficha da port');
  const cor = async (titulo, v) => js(`(() => { const s = [...document.querySelectorAll('#prBody .pr-port input[type=color]')].find(x => x.title === ${JSON.stringify(titulo)}); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); return true; })()`);
  await cor('cor da borda', '#c62828'); await espera(250);
  await muda('espessura da borda', '10'); await espera(250);
  await cor('cor do fundo', '#fff59d'); await espera(250);
  await muda('posição do texto na barra', 'esquerda'); await espera(250);
  await muda('tamanho do texto, em mil', '55'); await espera(250);
  await muda('a fonte do nome', 'Times New Roman'); await espera(250);
  await cor('cor do texto', '#b71c1c'); await espera(250);
  await muda('onde vai a ponta (esquerda = a ponta que liga)', 'ambos'); await espera(300);
  const sv = (await ports()).find(p => p.net === 'SENSOR VP');
  assert.deepStrictEqual([sv.color, sv.bordaW, sv.fill, sv.alinha, sv.txtH, sv.fonte, sv.textColor, sv.seta, sv.style],
    ['#c62828', 10, '#fff59d', 'esquerda', 55, 'Times New Roman', '#b71c1c', 'ambos', 3], 'a SENSOR VP estilizada: ' + JSON.stringify(sv));
  assert.ok((await ports()).filter(p => p.net === 'L3').every(p => p.fill === '#ffffff'), 'as outras ficaram como estavam');
  if (PRINT) {
    const r = await js(`(() => { const a = document.getElementById('props').getBoundingClientRect(); return { x: a.left, y: a.top, width: a.width, height: Math.min(1000 - a.top, a.height) }; })()`);
    await print('port-4b-ficha-port-estilizada', r);
  }
  await tecla('Escape', 'Escape', 27);
  await js(`HubMcpVista.focar(${X0 + 300}, ${Y0 - 5 * PASSO}, 1000)`);
  await espera(400);
  await print('port-4-port-estilizada-diferente');

  /* 5. Espaço gira (em pé) e Ctrl+Z volta */
  await pega('RST');
  await tecla(' ', 'Space', 32);
  let rst = (await ports()).find(p => p.net === 'RST');
  assert.strictEqual(rst.style, 5, 'em pé, a ponta em cima (ePortTop): ' + rst.style);
  await tecla('z', 'KeyZ', 90, 2);
  rst = (await ports()).find(p => p.net === 'RST');
  assert.strictEqual(rst.style, 2, 'Ctrl+Z volta deitada');

  assert.deepStrictEqual(erros, [], 'erros na página: ' + erros.join(' || '));
  assert.strictEqual(fs.readFileSync(path.join(ORIGEM, 'schematic.js'), 'utf8'), schAntes, 'o projeto de origem não muda');
  console.log('smoke-port OK (' + PROJ + ')');
  ws.close();
  fim(0);
})().catch(e => { console.error(e); fim(1); });
setTimeout(() => { console.error('smoke-port: tempo esgotado'); fim(2); }, 300000);
