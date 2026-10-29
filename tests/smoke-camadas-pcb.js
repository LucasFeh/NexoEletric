/* Smoke das camadas e do desempenho na VISTA PCB de verdade (Chrome headless por CDP, hub temporário
   em 127.0.0.1:8004, projeto "E2E Rele" do test-e2e-placas):
     node tests/smoke-camadas-pcb.js
   Pedido do dono (2026-10-29): "o software tá muito travado ... quero poder ver só o layer que eu
   marquei ... opção de não ver componente 3D ... fácil de adicionar e remover layers, configurar
   espessura de layer e camada da via e pad; pad configura camada pelo footprint, só clicar nele".
     1. o menu Camadas no canto: desmarcar esconde, e a escolha volta ao reabrir;
     2. Desempenho: Componentes 3D desligado fica gravado;
     3. a pilha: 4 camadas pelo painel, espessura editada, + camada, tirar, voltar à do Altium;
     4. a via: o vão (de/até) na ferramenta e na ficha;
     5. o pad de componente: camadas pelo footprint (biblioteca do hub + atualizar os componentes). */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PORTA = +(process.env.PORTA || 8004);
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(f => fs.existsSync(f));
const PYTHON = process.env.PYTHON || ['python', 'C:\\Program Files\\NexoEletric\\resources\\python\\python.exe'].find(p => {
  try { execFileSync(p, ['-c', 'import flask'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
});
if (!CHROME || !PYTHON) { console.log('smoke-camadas-pcb: sem ' + (!CHROME ? 'Chrome' : 'Python com Flask') + ' — pulei'); process.exit(0); }
const espera = ms => new Promise(r => setTimeout(r, ms));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-camadas-'));
const HUB = path.join(TMP, 'hub');
fs.mkdirSync(path.join(HUB, 'Libs'), { recursive: true });
for (const f of fs.readdirSync(RAIZ)) if (/\.(js|html|css|py)$/.test(f)) fs.copyFileSync(path.join(RAIZ, f), path.join(HUB, f));
for (const d of ['mcp', 'vendor', 'tools']) fs.cpSync(path.join(RAIZ, d), path.join(HUB, d), { recursive: true, filter: s => !/__pycache__/.test(s) });
for (const f of fs.readdirSync(path.join(RAIZ, 'Libs'))) if (/\.(js|json)$/.test(f) && f !== 'pcblib-hub.js') fs.copyFileSync(path.join(RAIZ, 'Libs', f), path.join(HUB, 'Libs', f));
const e2e = execFileSync(process.execPath, [path.join(__dirname, 'test-e2e-placas.js')], { env: Object.assign({}, process.env, { E2E_MANTER: '1' }), encoding: 'utf8' });
const dirE2E = /placas em (.+)/.exec(e2e)[1].trim();
const PROJ = 'E2E Rele';
fs.cpSync(path.join(dirE2E, PROJ), path.join(HUB, 'Projects', PROJ), { recursive: true });
fs.rmSync(path.dirname(dirE2E), { recursive: true, force: true });
fs.writeFileSync(path.join(HUB, 'projects.js'), 'var projects = [\n' + JSON.stringify({ name: PROJ, files: { schematic: true, board: true, changes: true, annotations: true } }) + '\n];\n');

const filhos = [];
const fim = (codigo) => { for (const p of filhos) try { p.kill(); } catch (e) {} try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} process.exit(codigo); };

(async () => {
  filhos.push(spawn(PYTHON, [path.join(HUB, 'hubserver.py'), '--port', String(PORTA), '--host', '127.0.0.1'], { cwd: HUB, stdio: 'ignore' }));
  let no = false;
  for (let i = 0; i < 60 && !no; i++) { await espera(250); try { const r = await fetch(`http://127.0.0.1:${PORTA}/pcbframe.html`); await r.arrayBuffer(); no = r.ok; } catch (e) { /* subindo */ } }
  assert.ok(no, 'o hub temporário não subiu na ' + PORTA);
  const ud = fs.mkdtempSync(path.join(TMP, 'chrome-'));
  filhos.push(spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9336', '--user-data-dir=' + ud, 'about:blank'], { stdio: 'ignore' }));
  let alvo = null;
  for (let i = 0; i < 60 && !alvo; i++) { await espera(250); try { alvo = (await (await fetch('http://127.0.0.1:9336/json/list')).json()).find(t => t.type === 'page'); } catch (e) { /* subindo */ } }
  assert.ok(alvo, 'o Chrome não abriu o DevTools');
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((ok, falha) => { ws.onopen = ok; ws.onerror = falha; });
  const erros = [];
  let id = 0; const pend = new Map();
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
    else if (d.method === 'Page.javascriptDialogOpening') ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    else if (d.method === 'Runtime.exceptionThrown') erros.push('exceção: ' + JSON.stringify(d.params.exceptionDetails).slice(0, 400));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') erros.push(d.params.args.map(a => a.value || a.description).join(' ').slice(0, 300));
  };
  const cdp = (method, params) => new Promise(ok => { const n = ++id; pend.set(n, ok); ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
  const js = async s => { const r = await cdp('Runtime.evaluate', { expression: s, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(s.slice(0, 60) + ': ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
  const print = async nome => { if (!process.env.SMOKE_PRINT) return; const r = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(process.env.SMOKE_PRINT, nome + '.png'), Buffer.from(r.result.data, 'base64')); };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  const abre = async () => {
    await cdp('Page.navigate', { url: `http://127.0.0.1:${PORTA}/pcbframe.html?p=` + encodeURIComponent(PROJ) });
    await espera(500);
    for (let i = 0; i < 80 && !(await js('!!window.__hubPcb').catch(() => false)); i++) await espera(250);
    await espera(1200);
  };
  const V = 'window.__hubPcb';
  const vis = async k => (await js(`${V}.camadas().find(c => c.key === '${k}')`) || {}).vis;
  const ops = async op => (await js(`${V}.changes()`)).filter(o => o.op === op);
  const okModal = async () => { for (let i = 0; i < 20; i++) { const b = await js(`(() => { const b = document.querySelector('.hd-btns button.ok'); if (b) { b.click(); return true; } return false; })()`); if (b) return true; await espera(100); } return false; };
  await abre();

  /* ---- 1. o menu Camadas no canto ---- */
  const caixas = await js(`[...document.querySelectorAll('#pcbcamadas input[data-k]')].map(c => c.dataset.k)`);
  assert.ok(caixas[0] === '*' && caixas.includes('Top') && caixas.includes('Bottom') && caixas.includes('TopOverlay'), 'o menu Camadas com Todas e as camadas: ' + caixas);
  await js(`document.querySelector('#pcbcamadas input[data-k="TopOverlay"]').click()`);
  assert.strictEqual(await vis('TopOverlay'), false, 'desmarcar esconde a camada');
  assert.strictEqual(await js(`document.querySelector('#pcbcamadas input[data-k="*"]').indeterminate`), true, 'Todas fica parcial');
  await print('1-menu-camadas');
  await abre();
  assert.strictEqual(await vis('TopOverlay'), false, 'a camada escondida continua escondida ao reabrir');
  assert.strictEqual(await js(`document.querySelector('#pcbcamadas input[data-k="TopOverlay"]').checked`), false);
  await js(`document.querySelector('#pcbcamadas label:has(input[data-k="Bottom"]) .so').click()`);
  assert.deepStrictEqual((await js(`${V}.camadas()`)).filter(c => c.vis).map(c => c.key), ['Bottom'], '"só" deixa só a Bottom');
  await js(`document.querySelector('#pcbcamadas input[data-k="*"]').click()`);
  assert.ok((await js(`${V}.camadas()`)).every(c => c.vis), 'Todas mostra tudo de volta');

  /* ---- 2. Desempenho ---- */
  await js(`${V}.selecionar([])`); await espera(200);
  const clicaCaixa = async rot => js(`(() => { const l = [...document.querySelectorAll('#props label.pr-bool')].find(x => x.textContent.trim() === ${JSON.stringify(rot)}); if (!l) return false; l.querySelector('input').click(); return true; })()`);
  assert.ok(await clicaCaixa('Componentes 3D'), 'a caixa Componentes 3D nas Propriedades da placa');
  assert.strictEqual((await js(`${V}.opc3d()`)).corpos, false, 'Componentes 3D desligado');
  await print('2-desempenho');
  await abre();
  assert.strictEqual((await js(`${V}.opc3d()`)).corpos, false, 'e continua desligado ao reabrir');
  await js(`${V}.selecionar([])`); await espera(150);
  await clicaCaixa('Componentes 3D');
  assert.strictEqual((await js(`${V}.opc3d()`)).corpos, true);

  /* ---- 3. a pilha de camadas ---- */
  await js(`document.querySelector('#props .subtab[data-aba="camadas"]').click()`); await espera(200);
  assert.ok(await js(`!!document.querySelector('#props .pl-lista')`), 'a pilha no topo da aba Camadas');
  assert.strictEqual(await js(`document.querySelectorAll('#props .pl-lista .pl-cu').length`), 2, 'placa de 2 camadas');
  await js(`[...document.querySelectorAll('#props .seg button')].find(b => b.textContent === '4').click()`); await espera(300);
  let st = await ops('stack_set');
  assert.strictEqual(st.length, 1, 'uma linha stack_set');
  assert.deepStrictEqual(st[0].layers.map(l => l.key), ['Top', 'Mid1', 'Mid2', 'Bottom'], 'pilha de 4');
  assert.ok((await js(`${V}.camadas()`)).some(c => c.key === 'Mid1'), 'a Mid1 virou aba');
  assert.ok(await js(`!!document.querySelector('#pcbcamadas input[data-k="Mid2"]')`), 'e entrou no menu do canto');
  /* a espessura do dielétrico de cima pelo campo */
  await js(`(() => { const i = document.querySelector('#props .pl-die .pl-num'); i.value = '0,3'; i.dispatchEvent(new Event('change')); })()`); await espera(300);
  st = await ops('stack_set');
  assert.strictEqual(st.length, 1, 'continua UMA linha (editada no lugar)');
  assert.ok(Math.abs(st[0].layers[0].dielectric - 0.3) < 1e-9, 'dielétrico da Top = 0,3: ' + st[0].layers[0].dielectric);
  const esp = await js(`${V}.pilha.ver().espessura`);
  assert.ok(Math.abs(esp - (0.3 + 1.065 + 0.2 + 4 * 0.035)) < 1e-6, 'espessura total: ' + esp);
  await print('3-pilha-4');
  /* + camada e tirar */
  await js(`[...document.querySelectorAll('#props button.btn')].find(b => /Camada de cobre/.test(b.textContent)).click()`); await espera(300);
  st = await ops('stack_set');
  assert.strictEqual(st[0].layers.length, 5, '+ camada: 5 de cobre');
  assert.ok(Math.abs((await js(`${V}.pilha.ver().espessura`)) - esp - 0.035) < 1e-6, 'a nova só soma o cobre (divide o dielétrico)');
  await js(`[...document.querySelectorAll('#props .pl-x')].find(b => !b.disabled && /Mid-Layer 3|Mid3/.test(b.title)).click()`); await espera(300);
  assert.strictEqual((await ops('stack_set'))[0].layers.length, 4, 'tirou a Mid3');

  /* ---- 4. o vão da via ---- */
  const B = await js(`(() => { const e = ${V}.estado(); return e.view; })()`);
  await js(`${V}.setTool('via')`);
  await js(`${V}.editar('tool.viaAte', 'Mid1')`);
  const placa = JSON.parse(fs.readFileSync(path.join(HUB, 'Projects', PROJ, 'board.js'), 'utf8').replace(/^[^{]*/, '').replace(/;\s*$/, ''));
  const bb = placa.board.bbox;
  const p = [bb.x1 + 2.5, bb.y2 - 2.5];
  await js(`${V}.setView(${p[0]}, ${p[1]}, 14)`); await espera(200);
  const rect = await js('(() => { const r = document.getElementById("cv").getBoundingClientRect(); return { left: r.left, top: r.top }; })()');
  const s = await js(`${V}.telaDe(${p[0]}, ${p[1]})`);
  const mouse = (type, x, y, extra) => cdp('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'none', buttons: 0, clickCount: 0 }, extra || {}));
  await mouse('mouseMoved', rect.left + s.x, rect.top + s.y); await espera(80);
  await mouse('mousePressed', rect.left + s.x, rect.top + s.y, { button: 'left', buttons: 1, clickCount: 1 });
  await mouse('mouseReleased', rect.left + s.x, rect.top + s.y, { button: 'left', clickCount: 1 }); await espera(300);
  const vias = await ops('via_add');
  assert.ok(vias.length, 'a ferramenta Via pôs a via');
  assert.deepStrictEqual([vias[vias.length - 1].from, vias[vias.length - 1].to], ['Top', 'Mid1'], 'com o vão da ferramenta (Top → Mid1)');
  await js(`${V}.setTool('select')`);
  const va = await js(`(() => { const a = ${V}.alvos().find(x => x.t === 'via' && x.m && x.m.added); ${V}.selecionar([a]); return !!a; })()`);
  assert.ok(va, 'a via nova selecionada');
  assert.ok((await js(`${V}.ficha().campos.filter(c => c.k === 'from' || c.k === 'to').map(c => c.v)`)).join() === 'Top,Mid1', 'a ficha da via com De/Até');
  await js(`${V}.editar('to', 'Mid2')`);
  assert.strictEqual((await ops('via_add')).slice(-1)[0].to, 'Mid2', 'mudar o Até na ficha (a via nova muda a própria linha)');
  /* a pilha não deixa tirar a Mid2 com a via passando nela */
  await js(`${V}.pilha.pronta(2)`); await espera(200);
  assert.strictEqual((await ops('stack_set'))[0].layers.length, 4, 'voltar a 2 camadas com via na Mid2 é recusado');

  /* ---- 5. o pad do componente pelo footprint ---- */
  const padInfo = await js(`(() => { const a = ${V}.alvos().find(x => x.t === 'pad' && x.comp && x.eb); if (!a) return null; ${V}.selecionar([a]); return { ref:a.comp.src.ref, fp:a.comp.src.footprint, nome:a.eb.name, th:a.eb.layer === 'Multi' || a.eb.type === 'th' }; })()`);
  assert.ok(padInfo, 'um pad de componente');
  const campo = await js(`${V}.ficha().campos.find(c => c.k === 'fp.camadas')`);
  assert.ok(campo && campo.v === (padInfo.th ? 'th' : 'smd:Top'), 'a ficha do pad com as Camadas dele: ' + JSON.stringify(campo));
  const quer = padInfo.th ? 'smd:Top' : 'smd:Bottom';
  await print('5-pad-camadas');
  const antes = (await ops('comp_add')).length;
  await js(`${V}.editar('fp.camadas', '${quer}')`);
  assert.ok(await okModal(), 'a confirmação aparece');
  await espera(1200);
  const lib = fs.readFileSync(path.join(HUB, 'Libs', 'pcblib-hub.js'), 'utf8');
  const linha = lib.split('\n').find(l => l.includes('"name":' + JSON.stringify(padInfo.fp) + ','));
  assert.ok(linha, 'o footprint foi para a biblioteca do hub');
  const fp = JSON.parse(linha.replace(/^,/, ''));
  assert.ok(fp.pads.some(q => String(q.name) === String(padInfo.nome) && q.type === 'smd' && q.layer === (padInfo.th ? 'Top' : 'Bottom') && !('drill' in q)), 'o pad mudou no footprint: ' + JSON.stringify(fp.pads.find(q => String(q.name) === String(padInfo.nome))));
  assert.ok((await ops('comp_add')).length > antes, 'os componentes com o footprint foram atualizados (comp_del + comp_add)');
  const pad2 = await js(`(() => { const a = ${V}.alvos().find(x => x.t === 'pad' && x.comp && x.comp.src.ref === ${JSON.stringify(padInfo.ref)} && String(x.eb.name) === ${JSON.stringify(String(padInfo.nome))}); return a ? { layer:a.eb.layer, comp:a.comp.eff.layer } : null; })()`);
  assert.ok(pad2 && (padInfo.th ? pad2.layer === pad2.comp : pad2.layer !== pad2.comp), 'na placa, o pad mudou de camada: ' + JSON.stringify(pad2));
  assert.deepStrictEqual((await js(`${V}.valida()`)).filter(v => v.status === 'err'), [], 'as ops validam');

  assert.deepStrictEqual(erros, [], 'nenhum erro de script na página');
  console.log('smoke-camadas-pcb OK (menu Camadas lembrado, Componentes 3D, pilha 2→4→5→4, vão da via, pad pelo footprint)');
  fim(0);
})().catch(err => { console.error(err && err.stack || err); fim(1); });
