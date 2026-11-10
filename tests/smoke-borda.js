/* Smoke da BORDA DA PLACA com o mouse (1.92.0) na vista PCB de verdade (pcbframe.html num Chrome/Edge headless, pelo
   DevTools Protocol), no molde do tests/smoke-artes.js:
     node tests/smoke-borda.js     (CHROME, PYTHON, PORTA; SMOKE_PRINT=<pasta> grava as telas;
                                    SMOKE_PROJ=<pasta de um projeto> usa a cópia dele no lugar da DMB do repositório)
   Numa CÓPIA da placa (os Projects reais nunca são tocados):
     1. clicar numa reta da borda e Tab: a cadeia ligada; Tab de novo: a borda INTEIRA — e só a borda;
     2. arrastar a cruz do meio move a borda toda (um outline_set); Ctrl+Z volta num passo;
     3. arrastar o quadrado do meio da aresta da direita para fora: a placa fica mais larga, a mesma altura, o contorno
        fechado e sem cruzamento, com a medida ao vivo; Ctrl+Z volta;
     4. a seta anda a borda inteira um passo da grade;
     5. o Gerber (Profile) acompanha a borda nova;
     6. nenhum erro de script, nenhum diálogo do navegador. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PORTA = +(process.env.PORTA || 8021);
const DEVTOOLS = +(process.env.DEVTOOLS || 9343);
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(f => fs.existsSync(f));
const PYTHON = [process.env.PYTHON, 'python', 'C:\\Program Files\\NexoEletric\\resources\\python\\python.exe'].filter(Boolean).find(p => {
  try { execFileSync(p, ['-c', 'import flask'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
});
if (!CHROME || !PYTHON) { console.log('smoke-borda: sem ' + (!CHROME ? 'Chrome/Edge' : 'Python com Flask') + ' — pulei'); process.exit(0); }
const ORIGEM = process.env.SMOKE_PROJ || path.join(RAIZ, 'Projects', 'DMB - DI231765_P2');
const PROJ = path.basename(ORIGEM);
if (!fs.existsSync(path.join(ORIGEM, 'board.js'))) { console.log('smoke-borda: a placa não está aqui — pulei'); process.exit(0); }
const espera = ms => new Promise(r => setTimeout(r, ms));
const HC = require('../hub-core.js');
const PRINT = process.env.SMOKE_PRINT || '';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-borda-'));
const HUB = path.join(TMP, 'hub');
fs.mkdirSync(path.join(HUB, 'Libs'), { recursive: true });
for (const f of fs.readdirSync(RAIZ)) if (/\.(js|html|css|py)$/.test(f)) fs.copyFileSync(path.join(RAIZ, f), path.join(HUB, f));
for (const d of ['mcp', 'vendor', 'tools']) fs.cpSync(path.join(RAIZ, d), path.join(HUB, d), { recursive: true, filter: s => !/__pycache__/.test(s) });
for (const f of fs.readdirSync(path.join(RAIZ, 'Libs'))) if (/\.(js|json)$/.test(f) && f !== 'pcb-artes.json') fs.copyFileSync(path.join(RAIZ, 'Libs', f), path.join(HUB, 'Libs', f));
const DP = path.join(HUB, 'Projects', PROJ);
fs.mkdirSync(DP, { recursive: true });
for (const f of ['board.js', 'schematic.js', 'annotations.js', 'rules.js', 'board3d.js']) if (fs.existsSync(path.join(ORIGEM, f))) fs.copyFileSync(path.join(ORIGEM, f), path.join(DP, f));
fs.writeFileSync(path.join(DP, 'changes.js'), HC.serializeChanges([]).text);
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
  const B0 = await js(`${P}.borda()`);
  assert.ok(B0.n >= 4 && B0.caixa, 'a borda: ' + JSON.stringify(B0.caixa));
  const cx = (B0.caixa.x1 + B0.caixa.x2) / 2, cy = (B0.caixa.y1 + B0.caixa.y2) / 2;
  await js(`${P}.setView(${cx + 8}, ${cy}, 6.2)`);
  await espera(600);

  /* 1. clica numa reta da borda (a da direita) e Tab, Tab */
  const iDir = B0.pts.findIndex((p, k) => { const q = B0.pts[(k + 1) % B0.pts.length]; return Math.abs(p[0] - B0.caixa.x2) < 1e-6 && Math.abs(q[0] - B0.caixa.x2) < 1e-6; });
  assert.ok(iDir >= 0, 'a reta da direita');
  const meioDir = [B0.caixa.x2, (B0.pts[iDir][1] + B0.pts[(iDir + 1) % B0.pts.length][1]) / 2];
  const sd = await tela(meioDir[0], meioDir[1]);
  await mouse('mousePressed', sd.x, sd.y); await mouse('mouseReleased', sd.x, sd.y); await espera(300);
  let sel = await js(`${P}.estado().sel`);
  if (!(sel.length === 1 && /^b:/.test(sel[0]))) {
    /* a reta é a 2a (ou 3a) coisa debaixo do clique: escolhe pela seleção direta */
    await js(`${P}.selecionar(${P}.alvos().filter(a => a.t === 'contorno' && a.i === ${iDir}))`);
    sel = await js(`${P}.estado().sel`);
  }
  assert.deepStrictEqual(sel, ['b:' + iDir], 'uma reta da borda selecionada');
  await tecla('Tab', 'Tab', 9);
  const s1 = await js(`${P}.estado().sel`);
  assert.ok(s1.length > 1 && s1.every(k => /^b:/.test(k)), 'Tab: a cadeia, só borda: ' + s1.length);
  await tecla('Tab', 'Tab', 9);
  const s2 = await js(`${P}.estado().sel`);
  assert.strictEqual(s2.length, B0.n, 'Tab Tab: a borda inteira');
  assert.ok(s2.every(k => /^b:/.test(k)), 'e só a borda (nada de componente, trilha ou silk)');
  const status = await js(`document.getElementById('ssel').textContent`);
  assert.ok(/borda da placa — \d+ segmentos \(inteira\)/.test(status), 'a contagem na barra de status: ' + status);
  await espera(300);
  await print('borda-1-tab-tab-borda-inteira');

  /* 2. a cruz do meio: a borda toda anda 5 mm para a direita */
  const al = await js(`${P}.alcasBorda()`);
  const meio = al.find(a => a.tipo === 'meio');
  assert.ok(meio, 'a alça do meio');
  const sm = await tela(meio.x, meio.y), sm2 = await tela(meio.x + 5, meio.y);
  arrastando = true;
  await mouse('mousePressed', sm.x, sm.y);
  for (let k = 1; k <= 6; k++) await mouse('mouseMoved', sm.x + (sm2.x - sm.x) * k / 6, sm.y);
  await mouse('mouseReleased', sm2.x, sm2.y); arrastando = false;
  await espera(500);
  let chs = await js(`${P}.changes()`);
  assert.deepStrictEqual(chs.map(c => c.op), ['outline_set'], 'um outline_set');
  let B1 = await js(`${P}.borda()`);
  assert.ok(Math.abs(B1.caixa.x1 - (B0.caixa.x1 + 5)) < 0.06 && Math.abs(B1.caixa.w - B0.caixa.w) < 1e-6, 'a borda andou 5 mm: ' + JSON.stringify(B1.caixa));
  await js(`HubMcpVista.comando('desfazer')`); await espera(400);
  assert.strictEqual((await js(`${P}.changes()`)).length, 0, 'Ctrl+Z volta num passo');

  /* 3. o quadrado do meio da reta da direita: a placa fica 6 mm mais larga, a mesma altura */
  await js(`${P}.selecionar(${P}.alvos().filter(a => a.t === 'contorno'))`); await espera(200);
  const ar = (await js(`${P}.alcasBorda()`)).find(a => a.tipo === 'aresta' && a.i === iDir);
  assert.ok(ar && ar.normal[0] > 0.99, 'a alça da aresta da direita, normal para fora: ' + JSON.stringify(ar));
  const sa = await tela(ar.x, ar.y), sa2 = await tela(ar.x + 6, ar.y);
  arrastando = true;
  await mouse('mousePressed', sa.x, sa.y);
  for (let k = 1; k <= 8; k++) await mouse('mouseMoved', sa.x + (sa2.x - sa.x) * k / 8, sa.y + 20 * k / 8);
  await espera(300);
  const rod = await js(`document.getElementById('smsg').textContent`);
  const lv = /Borda ([\d.,]+) × ([\d.,]+)/.exec(rod), larg = lv ? parseFloat(lv[1].replace(/\./g, '').replace(',', '.')) : NaN;
  assert.ok(Math.abs(larg - (B0.caixa.w + 6)) <= 0.15, 'a medida ao vivo no rodapé (+6 mm, na grade): ' + rod);
  await print('borda-2-arrastando-aresta-medida-ao-vivo');
  await mouse('mouseReleased', sa2.x, sa2.y); arrastando = false;
  await espera(500);
  chs = await js(`${P}.changes()`);
  assert.deepStrictEqual(chs.map(c => c.op), ['outline_set']);
  B1 = await js(`${P}.borda()`);
  assert.ok(Math.abs(B1.caixa.w - larg) < 1e-6 && Math.abs(B1.caixa.h - B0.caixa.h) < 1e-6, 'mais larga (o que a medida ao vivo mostrou), mesma altura: ' + JSON.stringify(B1.caixa));
  assert.strictEqual(B1.n, B0.n, 'o contorno continua com os mesmos segmentos, fechado');
  assert.ok(B1.pts && !(await js(`HubPcbBorda.cruza(${JSON.stringify(B1.pts)})`)), 'fechado e sem cruzamento');
  assert.deepStrictEqual((await js(`${P}.valida()`)).filter(v => v.status === 'err'), [], 'valida');
  /* 5. o Gerber (Profile) acompanha */
  const xmax = await js(`(() => { const b = window.pcbmirror, eb = HubCore.effectiveBoard(b, HubCore.applyPcbChanges(b, ${P}.changes()));
    const g = HubGerber.gerar(eb, {}), p = g.arquivos.find(a => a.camada === 'Profile'), cam = HubGerberView.parse(p.texto, p.nome);
    return Math.max(...[].concat(...cam.prims.filter(q => q.k === 'line' || q.k === 'arc').map(q => [q.x1, q.x2]))); })()`);
  assert.ok(Math.abs(xmax - B1.caixa.x2) < 1e-3, 'o Profile do Gerber vai até a borda nova: ' + xmax);
  await espera(300);
  await print('borda-3-aresta-solta');
  await js(`HubMcpVista.comando('desfazer')`); await espera(400);
  assert.strictEqual((await js(`${P}.changes()`)).length, 0, 'Ctrl+Z volta a aresta num passo');

  /* 3b. (1.92.3) o ímã e as guias de alinhamento na borda, os mesmos do arrasto de sempre ("magnetismo e alinhamento
     com canva, igual o resto"): a aresta da direita levada até um pad gruda nele (⊙ pad); levada até a altura... a x de um
     pad noutra altura, a guia de alinhamento aparece e prende */
  await js(`${P}.selecionar(${P}.alvos().filter(a => a.t === 'contorno'))`); await espera(200);
  const ar2 = (await js(`${P}.alcasBorda()`)).find(a => a.tipo === 'aresta' && a.i === iDir);
  /* o pad mais à direita da placa (dentro dela) */
  const pad = await js(`(() => { const eb = HubCore.effectiveBoard(window.pcbmirror, HubCore.applyPcbChanges(window.pcbmirror, ${P}.changes())); let m = null;
    for (const c of eb.components || []) for (const p of c.pads || []) if (p && isFinite(p.x) && p.x < ${B0.caixa.x2} - 3 && (!m || p.x > m.x)) m = { x:p.x, y:p.y, ref:c.ref + '-' + p.name };
    return m; })()`);
  assert.ok(pad, 'um pad perto da borda da direita');
  const h0 = await tela(ar2.x, ar2.y), hp = await tela(pad.x, pad.y);
  arrastando = true;
  await mouse('mousePressed', h0.x, h0.y);
  for (let k = 1; k <= 10; k++) await mouse('mouseMoved', h0.x + (hp.x - h0.x) * k / 10, h0.y + (hp.y - h0.y) * k / 10);
  await espera(300);
  let ab = await js(`${P}.arrastoBorda()`);
  assert.ok(ab && ab.ima && ab.ima.tipo === 'pad' && Math.abs(ab.ima.x - pad.x) < 1e-6, 'a aresta gruda no pad ' + pad.ref + ': ' + JSON.stringify(ab));
  assert.ok(Math.abs(ab.d - (pad.x - B0.caixa.x2)) < 1e-6, 'a aresta foi até o centro do pad: ' + ab.d);
  assert.ok(!ab.ruim && Math.abs(ab.dim.h - B0.caixa.h) < 1e-6, 'a borda continua válida e com a mesma altura (os chanfros não passam do vértice): ' + JSON.stringify(ab));
  assert.ok(/⊙ pad/.test(await js(`document.getElementById('smsg').textContent`)), 'o rodapé diz o ímã');
  await print('borda-4-ima-no-pad');
  /* sem soltar: a mesma x do pad, mas longe dele em Y (fora do ímã) — a guia de alinhamento pega e prende */
  const hg = await tela(pad.x + 0.04, ar2.y);
  for (let k = 1; k <= 6; k++) await mouse('mouseMoved', hp.x + (hg.x - hp.x) * k / 6, hp.y + (hg.y - hp.y) * k / 6);
  await espera(300);
  ab = await js(`${P}.arrastoBorda()`);
  assert.ok(ab && !ab.ima && ab.cena && /alinhad|vértice|pad|centro|borda/i.test(ab.guia || '') && Math.abs(ab.d - (pad.x - B0.caixa.x2)) < 1e-6,
    'a guia de alinhamento prende a aresta na x do pad: ' + JSON.stringify(ab));
  await print('borda-5-guia-de-alinhamento');
  /* Ctrl solta o snap e as guias */
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hg.x, y: hg.y, button: 'none', buttons: 1, modifiers: 2 });
  await espera(200);
  ab = await js(`${P}.arrastoBorda()`);
  assert.ok(ab && !ab.ima && !ab.cena, 'Ctrl: sem ímã e sem guia: ' + JSON.stringify(ab));
  await tecla('Escape', 'Escape', 27);
  arrastando = false;
  await mouse('mouseReleased', hg.x, hg.y); await espera(300);
  assert.strictEqual((await js(`${P}.changes()`)).length, 0, 'Esc desiste do arrasto');

  /* 4. a seta: a borda inteira anda um passo da grade */
  await js(`${P}.selecionar(${P}.alvos().filter(a => a.t === 'contorno'))`); await espera(200);
  await js(`document.getElementById('cv').focus()`);
  await tecla('ArrowUp', 'ArrowUp', 38);
  B1 = await js(`${P}.borda()`);
  const passo = await js(`${P}.estado().grade`);
  assert.ok(B1.caixa.y1 > B0.caixa.y1 + 1e-6 && Math.abs(B1.caixa.h - B0.caixa.h) < 1e-6, 'a seta sobe a borda (grade ' + passo + '): ' + JSON.stringify(B1.caixa));
  await js(`HubMcpVista.comando('desfazer')`); await espera(300);

  assert.deepStrictEqual(erros, [], 'erros na página: ' + erros.join(' || '));
  assert.strictEqual(fs.readFileSync(path.join(ORIGEM, 'board.js'), 'utf8'), boardAntes, 'o projeto de origem não muda');
  console.log('smoke-borda OK (' + PROJ + ': ' + B0.n + ' segmentos, ' + B0.caixa.w + ' × ' + B0.caixa.h + ' mm)');
  ws.close();
  fim(0);
})().catch(e => { console.error(e); fim(1); });
setTimeout(() => { console.error('smoke-borda: tempo esgotado'); fim(2); }, 300000);
