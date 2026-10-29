/* Smoke da régua, da gaveta do Polygon Pour, do cadeado no painel e do sinalizador, na VISTA PCB de
   verdade (pcbframe.html num Chrome headless, pelo DevTools Protocol, com cliques no canvas):
     node tests/smoke-regua-pcb.js
   Mesmo esquema do smoke-vista-pcb.js (hub temporário em 127.0.0.1, porta 8002; projeto "E2E Rele").
   Pedido do dono (2026-10-29):
     1. Polygon Pour em retângulo e em polígono juntos numa gaveta, como as formas;
     2. o cadeado "só leitura" sai da barra e vai para as Propriedades da placa (nada selecionado);
     3. o sinalizador: pôr E tirar (clique na bandeira + Delete, sem destravar);
     4. o Ctrl+M como no NexoCAD: dois pontos com agarre (centro, quadrante, tangente...), a linha no
        arrasto, a cota fica na placa; um botão na barra esconde e mostra. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PORTA = +(process.env.PORTA || 8002);
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(f => fs.existsSync(f));
const PYTHON = process.env.PYTHON || ['python', 'C:\\Program Files\\NexoEletric\\resources\\python\\python.exe'].find(p => {
  try { execFileSync(p, ['-c', 'import flask'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
});
if (!CHROME || !PYTHON) { console.log('smoke-regua-pcb: sem ' + (!CHROME ? 'Chrome' : 'Python com Flask') + ' — pulei'); process.exit(0); }
const espera = ms => new Promise(r => setTimeout(r, ms));
const lerVar = (f, v) => new Function(fs.readFileSync(f, 'utf8') + ';return ' + v + ';')();

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-regua-'));
const HUB = path.join(TMP, 'hub');
fs.mkdirSync(path.join(HUB, 'Libs'), { recursive: true });
for (const f of fs.readdirSync(RAIZ)) if (/\.(js|html|css|py)$/.test(f)) fs.copyFileSync(path.join(RAIZ, f), path.join(HUB, f));
for (const d of ['mcp', 'vendor', 'tools']) fs.cpSync(path.join(RAIZ, d), path.join(HUB, d), { recursive: true, filter: s => !/__pycache__/.test(s) });
for (const f of fs.readdirSync(path.join(RAIZ, 'Libs'))) if (/\.(js|json)$/.test(f)) fs.copyFileSync(path.join(RAIZ, 'Libs', f), path.join(HUB, 'Libs', f));
const e2e = execFileSync(process.execPath, [path.join(__dirname, 'test-e2e-placas.js')], { env: Object.assign({}, process.env, { E2E_MANTER: '1' }), encoding: 'utf8' });
const dirE2E = /placas em (.+)/.exec(e2e)[1].trim();
const PROJ = 'E2E Rele';
fs.cpSync(path.join(dirE2E, PROJ), path.join(HUB, 'Projects', PROJ), { recursive: true });
fs.rmSync(path.dirname(dirE2E), { recursive: true, force: true });
fs.writeFileSync(path.join(HUB, 'projects.js'), 'var projects = [\n' + JSON.stringify({ name: PROJ, files: { schematic: true, board: true, changes: true, annotations: true } }) + '\n];\n');

const filhos = [];
const fim = (codigo) => { for (const p of filhos) try { p.kill(); } catch (e) {} try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} process.exit(codigo); };

(async () => {
  const srv = spawn(PYTHON, [path.join(HUB, 'hubserver.py'), '--port', String(PORTA), '--host', '127.0.0.1'], { cwd: HUB, stdio: 'ignore' });
  filhos.push(srv);
  let no = false;
  for (let i = 0; i < 60 && !no; i++) { await espera(250); try { const r = await fetch(`http://127.0.0.1:${PORTA}/pcbframe.html`); await r.arrayBuffer(); no = r.ok; } catch (e) { /* subindo */ } }
  assert.ok(no, 'o hub temporário não subiu na ' + PORTA);
  const ud = fs.mkdtempSync(path.join(TMP, 'chrome-'));
  const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9334', '--user-data-dir=' + ud, 'about:blank'], { stdio: 'ignore' });
  filhos.push(ch);
  let alvo = null;
  for (let i = 0; i < 60 && !alvo; i++) { await espera(250); try { alvo = (await (await fetch('http://127.0.0.1:9334/json/list')).json()).find(t => t.type === 'page'); } catch (e) { /* subindo */ } }
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
    await espera(1500);
  };
  await abre();
  const V = 'window.__hubPcb';
  const est = () => js(V + '.estado()');

  /* ---- 1. a gaveta do Polygon Pour ---- */
  assert.strictEqual(await js(`!!document.getElementById('tb-editar')`), false, 'o cadeado saiu da barra');
  assert.ok(await js(`!!document.querySelector('#tb-planos .gseta')`), 'a gaveta do Polygon Pour existe');
  assert.deepStrictEqual(await js(`[...document.querySelectorAll('#tb-planos .gaveta button')].map(b => b.id)`), ['tb-pourRet', 'tb-pourLivre'], 'retângulo e polígono na gaveta');
  await js(`document.querySelector('#tb-planos .gseta').click()`);
  assert.strictEqual(await js(`document.querySelector('#tb-planos .gaveta').hidden`), false, 'a setinha abre a gaveta');
  await espera(120); await print('1-gaveta-pour');
  await js(`document.getElementById('tb-pourLivre').click()`);
  let e = await est();
  assert.strictEqual(e.tool, 'pour', 'o polígono da gaveta pega o Polygon Pour');
  assert.strictEqual(await js(`${V}.ficha().campos.find(c => c.k === 'tool.pourForma').v`), 'livre', 'na forma polígono livre');
  assert.strictEqual(await js(`document.getElementById('tb-pourLivre').getAttribute('aria-pressed')`), 'true');
  assert.strictEqual(await js(`document.getElementById('tb-pourRet').getAttribute('aria-pressed')`), 'false', 'só o da forma na mão fica apertado');
  assert.strictEqual(await js(`document.querySelector('#tb-planos .gaveta').hidden`), true, 'escolher fecha a gaveta');
  /* o principal do grupo mostra a forma escolhida; clicar nele de novo larga */
  await js(`document.querySelector('#tb-planos .gseta').click()`);
  await js(`document.getElementById('tb-pourRet').click()`);
  assert.strictEqual(await js(`${V}.ficha().campos.find(c => c.k === 'tool.pourForma').v`), 'retangulo', 'troca para retângulo com a ferramenta na mão');
  assert.strictEqual((await est()).tool, 'pour');
  await js(`document.querySelector('#tb-planos .gprin').click()`);
  assert.strictEqual((await est()).tool, 'select', 'o botão do grupo, de novo, larga a ferramenta');
  await js(`${V}.fazAcao('pour')`);
  assert.strictEqual((await est()).tool, 'pour', 'o atalho do pour continua');
  await js(`${V}.setTool('select')`);

  /* ---- 2. o cadeado nas Propriedades da placa ---- */
  await js(`${V}.setEdit(false)`); await js(`${V}.selecionar([])`); await espera(150);
  assert.strictEqual(await js(`!!document.querySelector('#props .pp-trava')`), false, 'o "só leitura" saiu do cabeçalho do painel');
  assert.ok(await js(`/Só leitura/.test(document.querySelector('#props .pp-cadeado').textContent)`), 'o cadeado nas Propriedades, com nada selecionado');
  await js(`document.querySelector('#props .pp-cadeado').click()`); await espera(100);
  assert.strictEqual((await est()).editOn, true, 'o cadeado do painel destrava');
  assert.ok(await js(`/Editando/.test(document.querySelector('#props .pp-cadeado').textContent)`));
  await print('2-cadeado-painel');
  await js(`document.querySelector('#props .pp-cadeado').click()`); await espera(100);
  assert.strictEqual((await est()).editOn, false, 'e trava de novo');

  /* ---- 3. a régua ---- */
  const B = lerVar(path.join(HUB, 'Projects', PROJ, 'board.js'), 'pcbmirror');
  const HC = require('../hub-core.js');
  HC.setPcbLib(lerVar(path.join(RAIZ, 'Libs', 'pcblib.js'), 'pcblib'));
  const eb = HC.effectiveBoard(B, HC.applyPcbChanges(B, lerVar(path.join(HUB, 'Projects', PROJ, 'changes.js'), 'changes')));
  const pads = eb.components.flatMap(c => (c.pads || []).map(p => Object.assign({ ref: c.ref }, p)));
  const p1 = pads.find(p => p.ref === 'J1'), p2 = pads.find(p => p.ref === 'K1');
  assert.ok(p1 && p2, 'os pads do J1 e do K1');
  const rect = await js('(() => { const r = document.getElementById("cv").getBoundingClientRect(); return { left: r.left, top: r.top }; })()');
  const tela = async (x, y) => { const s = await js(`${V}.telaDe(${x}, ${y})`); return [rect.left + s.x, rect.top + s.y]; };
  const mouse = (type, x, y, extra) => cdp('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'none', buttons: 0, clickCount: 0 }, extra || {}));
  const clicaTela = async (sx, sy) => { await mouse('mouseMoved', sx, sy); await espera(80); await mouse('mousePressed', sx, sy, { button: 'left', buttons: 1, clickCount: 1 }); await mouse('mouseReleased', sx, sy, { button: 'left', clickCount: 1 }); await espera(200); };
  const clica = async (x, y) => { const [sx, sy] = await tela(x, y); await clicaTela(sx, sy); };
  const tecla = async (key, code, vk) => { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }); await espera(150); };
  const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
  await js(`${V}.setView(${cx}, ${cy}, 14)`); await espera(300);
  /* o agarre: centro do pad */
  const ag = await js(`${V}.agarreMedida(${p1.x + 0.05}, ${p1.y + 0.03})`);
  assert.strictEqual(ag.tipo, 'centro', 'perto do centro do pad, agarra o centro: ' + JSON.stringify(ag));
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'm', code: 'KeyM', windowsVirtualKeyCode: 77, modifiers: 2 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'm', code: 'KeyM', windowsVirtualKeyCode: 77, modifiers: 2 });
  await espera(200);
  assert.strictEqual((await est()).tool, 'medir', 'Ctrl+M pega a régua');
  assert.strictEqual((await est()).editOn, false, 'a régua não destrava a edição');
  /* a retícula longe de tudo (pedido do dono: "no Ctrl+M, quando não tem medida, a retícula some"): a
     cruz do sistema some no preto, então a régua desenha a dela -- o braço da direita é branco */
  {
    const longe = await js(`(() => { for (let i = 0; i < 400; i++) { const x = ${cx} + (i % 20 - 10) * 0.9, y = ${cy} + (Math.floor(i / 20) - 10) * 0.9; if (${V}.agarreMedida(x, y).tipo === 'grade') return { x, y }; } return null; })()`);
    assert.ok(longe, 'um ponto sem agarre perto');
    const [sx, sy] = await tela(longe.x, longe.y);
    await mouse('mouseMoved', sx, sy); await espera(150);
    assert.strictEqual(await js(`document.getElementById('cv').style.cursor`), 'none', 'a régua esconde a cruz do sistema (desenha a dela)');
    const px = await js(`(() => { const c = document.getElementById('cv'), d = window.devicePixelRatio || 1, r = c.getBoundingClientRect();
      const p = c.getContext('2d').getImageData(Math.round((${sx} - r.left + 7) * d), Math.round((${sy} - r.top - 2) * d), 1, Math.round(5 * d)).data; let m = [0, 0, 0]; for (let i = 0; i < p.length; i += 4) if (p[i] + p[i + 1] + p[i + 2] > m[0] + m[1] + m[2]) m = [p[i], p[i + 1], p[i + 2]]; return m; })()`);
    assert.ok(px.every(v => v > 200), 'a retícula da régua aparece longe de qualquer agarre: pixel ' + px);
    await print('3a-reticula-longe');
    await mouse('mouseMoved', rect.left - 5, rect.top + 300); await espera(150);
    const px2 = await js(`(() => { const c = document.getElementById('cv'), d = window.devicePixelRatio || 1, r = c.getBoundingClientRect();
      const p = c.getContext('2d').getImageData(Math.round((${sx} - r.left + 7) * d), Math.round((${sy} - r.top - 2) * d), 1, Math.round(5 * d)).data; let m = [0, 0, 0]; for (let i = 0; i < p.length; i += 4) if (p[i] + p[i + 1] + p[i + 2] > m[0] + m[1] + m[2]) m = [p[i], p[i + 1], p[i + 2]]; return m; })()`);
    assert.ok(!px2.every(v => v > 200), 'o mouse fora da placa leva a retícula junto');
  }
  /* 3a. dois cliques nos centros, a linha um pouco ao lado (no meio = alinhada), clique fixa */
  await clica(p1.x + 0.02, p1.y + 0.02);
  await clica(p2.x - 0.02, p2.y + 0.02);
  const dx = p2.x - p1.x, dy = p2.y - p1.y, L = Math.hypot(dx, dy);
  const nx = -dy / L, ny = dx / L;
  const q = [cx + nx * 0.3, cy + ny * 0.3];
  { const [sx, sy] = await tela(q[0], q[1]); await mouse('mouseMoved', sx, sy); await espera(120); }
  assert.ok(/medida/.test(await js(`${V}.medida()`)), 'a medida ao vivo no rodapé');
  await print('3-regua-na-mao');
  await clica(q[0], q[1]);
  let cotas = await js(`${V}.cotas()`);
  assert.strictEqual(cotas.length, 1, 'a cota ficou na placa');
  const esperado = cotas[0].modo === 'h' ? Math.abs(dx) : cotas[0].modo === 'v' ? Math.abs(dy) : L;
  assert.ok(Math.abs(cotas[0].valor - esperado) < 1e-3, 'o valor da cota (' + cotas[0].modo + '): ' + cotas[0].valor + ' ≠ ' + esperado);
  assert.strictEqual(cotas[0].a.tipo, 'centro'); assert.strictEqual(cotas[0].b.tipo, 'centro');
  /* 3b. aperta num, arrasta e solta no outro; a linha acima dos dois = horizontal */
  {
    const [ax, ay] = await tela(p1.x, p1.y), [bx, by] = await tela(p2.x, p2.y);
    await mouse('mouseMoved', ax, ay); await espera(80);
    await mouse('mousePressed', ax, ay, { button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', ax + (bx - ax) * i / 8, ay + (by - ay) * i / 8, { button: 'left', buttons: 1 }); await espera(25); }
    await mouse('mouseReleased', bx, by, { button: 'left', clickCount: 1 });
    await espera(200);
    const topo = Math.max(p1.y, p2.y) + 3;
    await clica(cx, topo);
  }
  cotas = await js(`${V}.cotas()`);
  assert.strictEqual(cotas.length, 2, 'o arrasto de ponto a ponto também cota');
  if (Math.abs(dx) > 0.5 && Math.abs(dy) > 0.5) assert.strictEqual(cotas[1].modo, 'h', 'linha acima dos pontos = horizontal');
  await print('4-duas-cotas');
  /* 3c. Esc larga a régua; o olho da barra esconde e mostra */
  await tecla('Escape', 'Escape', 27);
  assert.strictEqual((await est()).tool, 'select', 'Esc larga a régua');
  const meio = [cx + nx * 0.3, cy + ny * 0.3];
  assert.ok((await js(`${V}.hitsEm(${meio[0]}, ${meio[1]})`)).includes('m:m1'), 'a cota se pega com o clique');
  await js(`document.getElementById('tb-cotas').click()`);
  assert.strictEqual(await js(`${V}.cotasVer()`), false, 'o botão da barra esconde as cotas');
  assert.ok(!(await js(`${V}.hitsEm(${meio[0]}, ${meio[1]})`)).includes('m:m1'), 'escondida, não se pega');
  assert.strictEqual(await js(`document.getElementById('tb-cotas').getAttribute('aria-pressed')`), 'false');
  await print('5-cotas-escondidas');
  await js(`document.getElementById('tb-cotas').click()`);
  assert.strictEqual(await js(`${V}.cotasVer()`), true, 'e mostra de novo');
  /* 3d. a cota fica depois de reabrir a vista (nesta máquina, com o projeto) */
  await abre();
  assert.strictEqual((await js(`${V}.cotas()`)).length, 2, 'as cotas voltam ao reabrir');
  /* 3e. clicar na cota e Delete apaga, sem destravar a edição */
  await js(`${V}.setEdit(false)`);
  await js(`${V}.setView(${cx}, ${cy}, 14)`); await espera(250);
  await clica(meio[0], meio[1]);
  assert.deepStrictEqual((await est()).sel, ['m:m1'], 'o clique pega a cota');
  assert.ok(/Cota/.test(await js(`${V}.ficha().titulo`)), 'a ficha da cota no painel');
  await tecla('Delete', 'Delete', 46);
  assert.strictEqual((await js(`${V}.cotas()`)).length, 1, 'Delete apaga a cota (sem destravar)');
  assert.strictEqual((await est()).editOn, false);

  /* ---- 4. o sinalizador: pôr e tirar ---- */
  const bb = B.board.bbox;
  const fx = bb.x1 + 2, fy = bb.y1 + 2;
  await js(`${V}.poeSinalizador(${fx}, ${fy}, 'smoke')`);
  await js(`${V}.setView(${fx}, ${fy}, 20)`); await espera(250);
  /* o clique na BANDEIRA (18 px acima da base), não no ponto */
  { const [sx, sy] = await tela(fx, fy); await clicaTela(sx + 6, sy - 18); }
  e = await est();
  assert.strictEqual(e.sel.length, 1, 'o clique na bandeira pega o sinalizador: ' + JSON.stringify(e.sel));
  assert.ok(/^n:/.test(e.sel[0]));
  assert.ok((await js(`${V}.ficha().campos.find(c => c.botoes)`)).botoes.some(b => b.id === 'apagar'), 'Apagar sinalizador no painel');
  await print('6-sinalizador');
  await tecla('Delete', 'Delete', 46);
  assert.strictEqual((await js(`${V}.sinalizadores()`)).length, 0, 'Delete tira o sinalizador, sem destravar');
  /* com a ferramenta Sinalizar, clicar numa bandeira que já existe pega ela (não põe outra) */
  await js(`${V}.poeSinalizador(${fx}, ${fy}, 'outro')`);
  await js(`${V}.setTool('sinalizar')`);
  { const [sx, sy] = await tela(fx, fy); await clicaTela(sx + 6, sy - 18); }
  e = await est();
  assert.strictEqual(e.tool, 'select', 'a ferramenta Sinalizar numa bandeira existente: seleciona');
  assert.ok(/^n:/.test(e.sel[0] || ''), 'com a bandeira selecionada');
  assert.strictEqual((await js(`${V}.sinalizadores()`)).length, 1, 'e não pôs outra');
  await js(`${V}.acao('apagar')`);
  assert.strictEqual((await js(`${V}.sinalizadores()`)).length, 0, 'o botão Apagar do painel tira');

  assert.deepStrictEqual(erros, [], 'nenhum erro de script na página');
  console.log('smoke-regua-pcb OK (gaveta do pour, cadeado no painel, 2 cotas com agarre, olho da barra, Delete na cota e no sinalizador)');
  fim(0);
})().catch(err => { console.error(err && err.stack || err); fim(1); });
