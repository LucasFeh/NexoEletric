/* Smoke da VISTA PCB de verdade (pcbframe.html num Chrome headless, pelo DevTools Protocol):
     node tests/smoke-vista-pcb.js
   Fora do `test-*.js` de propósito: precisa do Chrome e do Python do hub (Flask), e sobe um hub
   temporário na porta 8001 em 127.0.0.1 (a 8000 é a do dono). Variáveis: CHROME, PYTHON, PORTA.

   O que confere, na tela, com o projeto "E2E Rele" que o test-e2e-placas monta (ECO pelo MCP,
   posicionado, sem trilhas, com as regras Width_VCC 0,5..2 mm e Clearance_CARGA 0,6 mm):
     1. a vista reabre a placa que nasceu no hub: os componentes do ECO (comp_add) aparecem, sem
        "footprint não encontrado" (a biblioteca vem sozinha);
     2. a Trilha clicada de pad a pad sai com a net do pad e a largura da regra Width da net;
     3. as trilhas que a tela fez passam limpas no DRC com as regras do projeto;
     4. nenhum erro de script na página. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PORTA = +(process.env.PORTA || 8001);
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(f => fs.existsSync(f));
const PYTHON = process.env.PYTHON || ['python', 'C:\\Program Files\\NexoEletric\\resources\\python\\python.exe'].find(p => {
  try { execFileSync(p, ['-c', 'import flask'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
});
if (!CHROME || !PYTHON) { console.log('smoke-vista-pcb: sem ' + (!CHROME ? 'Chrome' : 'Python com Flask') + ' — pulei'); process.exit(0); }
const espera = ms => new Promise(r => setTimeout(r, ms));
const lerVar = (f, v) => new Function(fs.readFileSync(f, 'utf8') + ';return ' + v + ';')();

/* ---- o hub temporário: o código daqui + o projeto montado pelo e2e, sem as trilhas ---- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-vista-'));
const HUB = path.join(TMP, 'hub');
fs.mkdirSync(path.join(HUB, 'Libs'), { recursive: true });
for (const f of fs.readdirSync(RAIZ)) if (/\.(js|html|css|py)$/.test(f)) fs.copyFileSync(path.join(RAIZ, f), path.join(HUB, f));
for (const d of ['mcp', 'vendor', 'tools']) fs.cpSync(path.join(RAIZ, d), path.join(HUB, d), { recursive: true, filter: s => !/__pycache__/.test(s) });
for (const f of fs.readdirSync(path.join(RAIZ, 'Libs'))) if (/\.(js|json)$/.test(f)) fs.copyFileSync(path.join(RAIZ, 'Libs', f), path.join(HUB, 'Libs', f));
const e2e = execFileSync(process.execPath, [path.join(__dirname, 'test-e2e-placas.js')], { env: Object.assign({}, process.env, { E2E_MANTER: '1' }), encoding: 'utf8' });
const dirE2E = /placas em (.+)/.exec(e2e)[1].trim();
const PROJ = 'E2E Rele';
fs.cpSync(path.join(dirE2E, PROJ), path.join(HUB, 'Projects', PROJ), { recursive: true });
fs.rmSync(path.join(HUB, 'Projects', PROJ, 'Gerber'), { recursive: true, force: true });
fs.rmSync(path.dirname(dirE2E), { recursive: true, force: true });
const CHF = path.join(HUB, 'Projects', PROJ, 'changes.js');
fs.writeFileSync(CHF, fs.readFileSync(CHF, 'utf8').split('\n').filter(l => !/"op":"(track_add|via_add)"/.test(l)).join('\n'));
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
  const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9333', '--user-data-dir=' + ud, 'about:blank'], { stdio: 'ignore' });
  filhos.push(ch);
  let alvo = null;
  for (let i = 0; i < 60 && !alvo; i++) { await espera(250); try { alvo = (await (await fetch('http://127.0.0.1:9333/json/list')).json()).find(t => t.type === 'page'); } catch (e) { /* subindo */ } }
  assert.ok(alvo, 'o Chrome não abriu o DevTools');
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((ok, falha) => { ws.onopen = ok; ws.onerror = falha; });
  const erros = [];
  let id = 0; const pend = new Map();
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
    else if (d.method === 'Runtime.exceptionThrown') erros.push('exceção: ' + JSON.stringify(d.params.exceptionDetails).slice(0, 400));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') erros.push(d.params.args.map(a => a.value || a.description).join(' ').slice(0, 300));
  };
  const cdp = (method, params) => new Promise(ok => { const n = ++id; pend.set(n, ok); ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
  const js = async s => { const r = await cdp('Runtime.evaluate', { expression: s, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(s.slice(0, 60) + ': ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORTA}/pcbframe.html?p=` + encodeURIComponent(PROJ) });
  for (let i = 0; i < 80 && !(await js('!!window.__hubPcb').catch(() => false)); i++) await espera(250);
  await espera(2000);

  /* 1. a placa do hub reabre inteira */
  const val = await js('window.__hubPcb.valida().filter(v => v.status === "err")');
  assert.deepStrictEqual(val, [], 'a vista reabre a placa do ECO sem erro de footprint: ' + JSON.stringify(val).slice(0, 600));

  /* 2. a Trilha de pad a pad */
  const B = lerVar(path.join(HUB, 'Projects', PROJ, 'board.js'), 'pcbmirror');
  const HC = require('../hub-core.js');
  HC.setPcbLib(lerVar(path.join(RAIZ, 'Libs', 'pcblib.js'), 'pcblib'));
  const CH0 = lerVar(CHF, 'changes');
  const eb = HC.effectiveBoard(B, HC.applyPcbChanges(B, CH0));
  const padNet = (ref, net) => eb.components.find(c => c.ref === ref).pads.find(q => q.net === net);
  const rect = await js('(() => { const r = document.getElementById("cv").getBoundingClientRect(); return { left: r.left, top: r.top }; })()');
  const mouse = (type, x, y, button) => cdp('Input.dispatchMouseEvent', { type, x, y, button: button || 'none', clickCount: type === 'mouseMoved' ? 0 : 1, buttons: type === 'mousePressed' ? 1 : 0 });
  async function clica(x, y) {
    await js(`window.__hubPcb.setView(${x}, ${y}, 0)`);
    await espera(80);
    const s = await js(`window.__hubPcb.telaDe(${x}, ${y})`);
    await mouse('mouseMoved', rect.left + s.x, rect.top + s.y);
    await espera(150);
    await mouse('mousePressed', rect.left + s.x, rect.top + s.y, 'left');
    await mouse('mouseReleased', rect.left + s.x, rect.top + s.y, 'left');
    await espera(300);
  }
  const trilhas = async () => (await js('window.__hubPcb.changes()')).filter(o => o.op === 'track_add');
  await js('window.__hubPcb.destravar()');
  await js('window.__hubPcb.setTool("trilha")');
  await js('window.__hubPcb.setView(35, 25, 14)');
  await espera(400);
  const casos = [['J1', 'K1', 'VCC', 0.8], ['K1', 'J2', 'CARGA', 0.254], ['R1', 'Q1', 'BASE', 0.254]];
  for (const [a, b, net, w] of casos) {
    const antes = (await trilhas()).length;
    const A = padNet(a, net), Bp = padNet(b, net);
    await clica(A.x, A.y);
    await clica(Bp.x, Bp.y);
    const novos = (await trilhas()).slice(antes);
    assert.ok(novos.length, `${net}: a tela não fez a trilha de ${a} a ${b}`);
    for (const t of novos) {
      assert.strictEqual(t.net, net, `${net}: a trilha leva a net do pad`);
      assert.ok(Math.abs(t.w - w) < 1e-6, `${net}: largura ${t.w} (a regra Width da net pede ${w})`);
    }
  }

  /* 3. o DRC nas trilhas que a tela fez */
  const RG = require('../hub-pcbregras.js'), D = require('../hub-pcbdrc.js');
  const CH = await js('window.__hubPcb.changes()');
  const eb2 = HC.effectiveBoard(B, HC.applyPcbChanges(B, CH));
  const S = RG.ler(fs.readFileSync(path.join(HUB, 'Projects', PROJ, 'rules.js'), 'utf8'));
  const d = D.rodar(eb2, S, { ids: eb2.tracks.map(t => t.id), tipos: ['Clearance', 'ShortCircuit', 'Width', 'BoardOutlineClearance'] });
  assert.strictEqual(d.total, 0, 'as trilhas da tela saem limpas no DRC: ' + d.violacoes.map(v => v.msg).join(' | '));

  /* 4. sem erro de script */
  assert.deepStrictEqual(erros, [], 'erros na página: ' + erros.join(' || '));
  console.log(`smoke-vista-pcb OK (${CH.filter(o => o.op === 'track_add').length} trilhas feitas na tela, largura e net pela regra, DRC limpo)`);
  ws.close();
  fim(0);
})().catch(e => { console.error(e); fim(1); });
setTimeout(() => { console.error('smoke-vista-pcb: tempo esgotado'); fim(2); }, 240000);
