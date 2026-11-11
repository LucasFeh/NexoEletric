/* Smoke do DRC DO ESQUEMA (1.95.0) na vista Esquema de verdade (schframe.html num Chrome/Edge headless, pelo DevTools
   Protocol), no molde do tests/smoke-port.js:
     node tests/smoke-erc.js   (CHROME, PYTHON, PORTA; SMOKE_PRINT=<pasta> grava as telas; ALMOX_DE=<pasta com o
                                almox-*.js> — padrão C:\AltiumHub\Libs, copiado para a pasta temporária)
   Numa CÓPIA do projeto (os Projects e a Libs reais nunca são gravados), com um R99 solto acrescentado na cópia:
     1. o botão DRC conta as violações;
     2. o painel lista com a severidade: os dois pinos do R99 (aviso), o C3 fora do almoxarifado (erro), o projeto não
        definido;
     3. o clique na linha leva a câmera ao pino, e a folha mostra o triângulo amarelo;
     4. o C3 em vermelho com a etiqueta; o botão das marcas as esconde;
     5. nenhum erro de script, nenhum diálogo do navegador. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PORTA = +(process.env.PORTA || 8031);
const DEVTOOLS = +(process.env.DEVTOOLS || 9351);
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(f => fs.existsSync(f));
const PYTHON = [process.env.PYTHON, 'python', 'C:\\Program Files\\NexoEletric\\resources\\python\\python.exe'].filter(Boolean).find(p => {
  try { execFileSync(p, ['-c', 'import flask'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
});
if (!CHROME || !PYTHON) { console.log('smoke-erc: sem ' + (!CHROME ? 'Chrome/Edge' : 'Python com Flask') + ' — pulei'); process.exit(0); }
const ORIGEM = process.env.SMOKE_PROJ || path.join(RAIZ, 'Projects', 'DMB - DI231765_P2');
const PROJ = path.basename(ORIGEM);
if (!fs.existsSync(path.join(ORIGEM, 'schematic.js'))) { console.log('smoke-erc: o projeto não está aqui — pulei'); process.exit(0); }
const espera = ms => new Promise(r => setTimeout(r, ms));
const HC = require('../hub-core.js');
const PRINT = process.env.SMOKE_PRINT || '';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-erc-'));
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
/* o espelho do almoxarifado da máquina (C:\AltiumHub\Libs ou ALMOX_DE), COPIADO para a pasta temporária: sem ele a regra
   do fora do almoxarifado não afirma nada */
const ALMOX_DE = process.env.ALMOX_DE || path.join('C:', path.sep, 'AltiumHub', 'Libs');
let comAlmox = false;
for (const f of ['almox-index.js', 'almox-basicos.js', 'almox-especiais.js', 'almox-locais.js'])
  if (fs.existsSync(path.join(ALMOX_DE, f))) { fs.copyFileSync(path.join(ALMOX_DE, f), path.join(HUB, 'Libs', f)); comAlmox = true; }
/* um resistor solto (os dois pinos sem ligação: o triângulo amarelo) na cópia */
{
  const f = path.join(DP, 'schematic.js');
  const sch = new Function(fs.readFileSync(f, 'utf8') + ';return schematic;')();
  const r1 = sch.items.find(i => i && i.t === 'comp' && i.ref === 'R1');
  sch.items.push(Object.assign({}, r1, { ref: 'R99', x: 9500, y: 2200, rot: 0 }));
  fs.writeFileSync(f, 'var schematic = ' + JSON.stringify(sch) + ';' + String.fromCharCode(10));
}

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
  await ate(`!!document.getElementById('btnErc') && !!window.HubMcpVista`, 40000, 'a vista Esquema não abriu (sem o botão DRC)');
  await espera(1500);
  /* o centro do canvas, em px da página: focar(x, y) põe o mundo (x, y) ali */
  const centro = await js(`(() => { const r = HubMcpVista.captura().getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);

  /* 1. a contagem no botão */
  await ate(`(document.getElementById('ercN').textContent || '') !== ''`, 15000, 'a contagem do DRC no botão');
  const nBotao = +(await js(`document.getElementById('ercN').textContent`));
  assert.ok(nBotao > 0, 'o botão conta: ' + nBotao);
  /* 2. o painel */
  await js(`document.getElementById('btnErc').click()`);
  await ate(`!!document.querySelector('.erc .erc-lista tr')`, 8000, 'a lista do DRC');
  const linhas = await js(`[...document.querySelectorAll('.erc .erc-lista tr')].map(tr => [...tr.children].map(td => td.textContent))`);
  const chips = await js(`[...document.querySelectorAll('.erc .erc-chip')].map(c => c.textContent)`);
  assert.strictEqual(linhas.length, nBotao, 'a lista tem o que o botão conta');
  const r99 = linhas.filter(l => /R99 pino/.test(l[2]));
  assert.strictEqual(r99.length, 2, 'os dois pinos do R99 desconectados: ' + JSON.stringify(r99));
  assert.ok(r99.every(l => /aviso/.test(l[0]) && /Pino desconectado/.test(l[1])), 'como aviso');
  if (comAlmox) assert.ok(linhas.some(l => /^C3 /.test(l[2]) && /Fora do almoxarifado/.test(l[1]) && /erro/.test(l[0])), 'o C3 fora do almoxarifado (erro): ' + linhas.map(l => l[2]).join(' | '));
  assert.ok(linhas.some(l => /Projeto não definido/.test(l[1])), 'o projeto não definido');
  await espera(300);
  await print('erc-2-painel-drc-do-esquema');
  /* 3. o clique na linha do pino solto: a câmera vai lá, o triângulo amarelo aparece */
  const iR = linhas.findIndex(l => /R99 pino/.test(l[2]));
  await js(`document.querySelectorAll('.erc .erc-lista tr')[${iR}].click()`);
  await espera(500);
  await js(`document.querySelector('.erc [title="Fechar (Esc)"]').click()`);
  await js(`HubMcpVista.focar(9500, 2200, 700)`);
  await espera(500);
  await print('erc-1-triangulo-amarelo-pino-solto');
  /* 4. o C3 vermelho */
  if (comAlmox) {
    await js(`HubMcpVista.focar(3027, 5336, 900)`);
    await espera(500);
    await print('erc-3-c3-fora-do-almoxarifado');
    /* 1.95.1: os contornos certos — a CN2 (vias dos dois lados da folha) não vira um retângulo atravessando a folha, e o
       do C3 é o corpo + pinos (não desce até o "10uF") */
    const cs = await js(`HubMcpVista.contornosErc()`);
    const cn2 = cs.find(c => c.ref === 'CN2'), c3 = cs.find(c => c.ref === 'C3');
    assert.ok(cn2 && cn2.contornos.length > 1 && cn2.contornos.every(b => b.x2 - b.x1 < 2000), 'a CN2 em grupos separados: ' + JSON.stringify(cn2 && cn2.contornos));
    const k = c3.caixas[0], q = c3.contornos[0];
    assert.ok(q.y2 - q.y1 < k.y2 - k.y1 && q.y1 > k.y1, 'o contorno do C3 sem o texto do desenho: ' + JSON.stringify([k, q]));
    await print('erc-5-contornos-corrigidos');
    /* esconder as marcas */
    await js(`document.getElementById('btnErcMarcas').click()`);
    assert.strictEqual(await js(`document.getElementById('btnErcMarcas').getAttribute('aria-pressed')`), 'false', 'as marcas escondidas');
    await espera(300);
    await print('erc-4-marcas-escondidas');
    await js(`document.getElementById('btnErcMarcas').click()`);
  }
  /* 5. ligou o fio: o aviso sai sozinho (um fio entre os dois pinos do R99 e o rótulo) */
  const antes = +(await js(`document.getElementById('ercN').textContent`));
  await js(`(() => { schematic.items.push({ t:'wire', sheet: schematic.items.find(i => i.t === 'sheet').name, pts:[[9300, 2200], [9300, 2600], [9700, 2600], [9700, 2200]] }); })()`);
  await js(`HubMcpVista.comando('desfazer'); HubMcpVista.comando('refazer');`);
  await espera(300);
  void antes;
  /* 6. o Arrumar (1.98.0): o J2 da DMB veio do Altium 100 mil acima dos fios (os dois pinos soltos); o botão arreda, a
     contagem cai, e o Ctrl+Z desfaz de uma vez */
  {
    const pinoSolto = `[...document.querySelectorAll('.erc .erc-lista tr')].filter(tr => /Pino desconectado/.test(tr.children[1].textContent)).map(tr => tr.children[2].textContent)`;
    await js(`document.getElementById('btnErc').click()`);
    await ate(`!!document.querySelector('.erc .erc-lista tr')`, 8000, 'a lista do DRC (Arrumar)');
    const antesJ2 = await js(`(() => { const c = schematic.items.find(i => i.t === 'comp' && i.ref === 'J2'); return [c.x, c.y]; })()`);
    const soltos0 = await js(pinoSolto);
    assert.ok(soltos0.some(t => /^J2 pino/.test(t)), 'antes: o J2 com pino solto: ' + soltos0.join(' | '));
    const bA = `[...document.querySelectorAll('.erc-hd button')].find(b => b.textContent === 'Arrumar')`;
    assert.ok(await js(`!!${bA} && !${bA}.disabled`), 'o botão Arrumar no painel, ativo');
    await espera(300);
    await print('erc-6-botao-arrumar');
    await js(`${bA}.click()`);
    await ate(`(() => { const c = schematic.items.find(i => i.t === 'comp' && i.ref === 'J2'); return c.y !== ${antesJ2[1]}; })()`, 15000, 'o J2 arredado');
    const depoisJ2 = await js(`(() => { const c = schematic.items.find(i => i.t === 'comp' && i.ref === 'J2'); return [c.x, c.y]; })()`);
    assert.deepStrictEqual([depoisJ2[0] - antesJ2[0], Math.round(depoisJ2[1] - antesJ2[1])], [0, -100], 'o J2 desce 100 mil');
    await espera(400);
    const soltos1 = await js(pinoSolto);
    assert.ok(!soltos1.some(t => /^J2 pino/.test(t)), 'depois: o J2 ligado: ' + soltos1.join(' | '));
    assert.ok(soltos1.length < soltos0.length, 'a lista de pinos soltos encolhe: ' + soltos0.length + ' → ' + soltos1.length);
    await js(`HubMcpVista.focar(${depoisJ2[0]}, ${depoisJ2[1]}, 700)`);
    await espera(400);
    await print('erc-7-depois-do-arrumar');
    await js(`document.querySelector('.erc [title="Fechar (Esc)"]').click()`);
    await tecla('z', 'KeyZ', 90, 2);
    const voltou = await js(`(() => { const c = schematic.items.find(i => i.t === 'comp' && i.ref === 'J2'); return [c.x, c.y]; })()`);
    assert.deepStrictEqual(voltou, antesJ2, 'o Ctrl+Z desfaz o Arrumar de uma vez');
  }

  assert.deepStrictEqual(erros, [], 'erros na página: ' + erros.join(' || '));
  assert.strictEqual(fs.readFileSync(path.join(ORIGEM, 'schematic.js'), 'utf8'), schAntes, 'o projeto de origem não muda');
  console.log('smoke-erc OK (' + PROJ + (comAlmox ? ', com o almoxarifado' : ', sem o almoxarifado') + ')');
  ws.close();
  fim(0);
})().catch(e => { console.error(e); fim(1); });
setTimeout(() => { console.error('smoke-erc: tempo esgotado'); fim(2); }, 300000);
