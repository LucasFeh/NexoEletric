/* Smoke do AUTO-ROTEAR na vista PCB de verdade (pcbframe.html num Chrome/Edge headless, pelo DevTools
   Protocol), como o tests/smoke-vista-pcb.js:
     node tests/smoke-autorotear.js            (CHROME, PYTHON, PORTA; SMOKE_PRINT=<pasta> grava as telas)
   Fora do `test-*.js` de propósito: precisa do navegador e do Python do hub (Flask); sobe um hub
   temporário em 127.0.0.1 numa cópia de uma placa do acervo (a fonte de alimentação), com as trilhas
   de três nets arrancadas pelo changes.js — os Projects reais nunca são tocados.

   O que confere, na tela:
     1. o botão da barra (com a tecla U,A,A no title) e o menu Route » Auto Route » All aceso;
     2. U, A, A no teclado abre o pedido (pelo menu Route no cursor, como no Altium), com as conexões
        abertas, as camadas e a ordem; Esc fecha sem nada;
     3. Rotear no WORKER: o progresso, a prévia desenhada (trilhas e vias), o resumo (abertas -> 0,
        DRC sem violação nova) e o changes.js intocado; Descartar não deixa nada;
     4. Cancelar no meio (worker e em fatias): nada muda;
     5. EM FATIAS (sem worker): a mesma prévia; com violação nova (forjada), o Aplicar só vale com a
        caixa "aplicar mesmo assim";
     6. Aplicar: as linhas entram no changes.js como edição da vista (validadas), o ratsnest das nets
        fecha, o Ctrl+Z desfaz e o Ctrl+Y refaz;
     7. a placa que muda depois da prévia: o Aplicar recusa;
     8. na casca (hub.html, aba PCB): o mesmo Auto-rotear dentro do iframe, e o desfazer da fileira acende;
     9. nenhum erro de script na página. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PORTA = +(process.env.PORTA || 8012);
const DEVTOOLS = +(process.env.DEVTOOLS || 9334);
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(f => fs.existsSync(f));
const PYTHON = [process.env.PYTHON, 'python', 'C:\\Program Files\\NexoEletric\\resources\\python\\python.exe'].filter(Boolean).find(p => {
  try { execFileSync(p, ['-c', 'import flask'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
});
if (!CHROME || !PYTHON) { console.log('smoke-autorotear: sem ' + (!CHROME ? 'Chrome/Edge' : 'Python com Flask') + ' — pulei'); process.exit(0); }
const PROJ = 'PRJ - IT - DI221705 (Alimentação)';
if (!fs.existsSync(path.join(RAIZ, 'Projects', PROJ, 'board.js'))) { console.log('smoke-autorotear: a placa do acervo não está aqui — pulei'); process.exit(0); }
const espera = ms => new Promise(r => setTimeout(r, ms));
const lerVar = (f, v) => new Function(fs.readFileSync(f, 'utf8') + ';return ' + v + ';')();
const HC = require('../hub-core.js');

/* ---- o hub temporário: o código daqui + a cópia da placa, com três nets sem trilha ---- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-autorota-'));
const HUB = path.join(TMP, 'hub');
fs.mkdirSync(path.join(HUB, 'Libs'), { recursive: true });
for (const f of fs.readdirSync(RAIZ)) if (/\.(js|html|css|py)$/.test(f)) fs.copyFileSync(path.join(RAIZ, f), path.join(HUB, f));
for (const d of ['mcp', 'vendor', 'tools']) fs.cpSync(path.join(RAIZ, d), path.join(HUB, d), { recursive: true, filter: s => !/__pycache__/.test(s) });
for (const f of fs.readdirSync(path.join(RAIZ, 'Libs'))) if (/\.(js|json)$/.test(f)) fs.copyFileSync(path.join(RAIZ, 'Libs', f), path.join(HUB, 'Libs', f));
const DP = path.join(HUB, 'Projects', PROJ);
fs.cpSync(path.join(RAIZ, 'Projects', PROJ), DP, { recursive: true });
fs.rmSync(path.join(DP, 'Gerber'), { recursive: true, force: true });
const B = lerVar(path.join(DP, 'board.js'), 'pcbmirror');
const porNet = {};
for (const t of B.tracks || []) if (t.net && !t.owner) (porNet[t.net] = porNet[t.net] || []).push(t);
const NETS = Object.keys(porNet).sort((a, b) => porNet[b].length - porNet[a].length).slice(1, 4);
const DEL = [].concat(...NETS.map(n => porNet[n])).map(t => ({ op: 'track_del', id: t.id, orig_x1: t.x1, orig_y1: t.y1, orig_x2: t.x2, orig_y2: t.y2, orig_w: t.w, orig_layer: t.layer, note: 'smoke: arrancada' }));
const CHF = path.join(DP, 'changes.js');
fs.writeFileSync(CHF, HC.serializeChanges(DEL).text);
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
  /* o worker é servido como JavaScript (o Chrome recusa worker com outro MIME) */
  const wr = await fetch(`http://127.0.0.1:${PORTA}/hub-autoroteador-worker.js`);
  assert.ok(wr.ok && /javascript/.test(wr.headers.get('content-type') || ''), 'o worker sai como JavaScript: ' + wr.headers.get('content-type'));
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
  const nDel = DEL.length;
  assert.deepStrictEqual(await js(`${P}.valida().filter(v => v.status === "err")`), [], 'a placa com as nets arrancadas valida');
  assert.strictEqual(await js(`${P}.changes().length`), nDel);

  /* 1. a barra e o menu */
  const bt = await js(`(() => { const b = document.getElementById('tb-autorotear'); return b ? { title: b.title, svg: !!b.querySelector('svg') } : null; })()`);
  assert.ok(bt && /Auto-rotear/.test(bt.title) && /U,A,A/.test(bt.title) && bt.svg, 'o botão da barra, com ícone e a tecla: ' + JSON.stringify(bt));
  const menu = await js(`(() => { const r = (window.__hubMenus.itens() || []).find(x => x.ing === 'Route'); if (!r) return null;
    const achar = l => { for (const x of l || []) { if (x && x.acao === 'autorotear') return x; const y = x && achar(x.filhos); if (y) return y; } return null; };
    const it = achar(r.filhos); return it ? { rot: it.rot, off: !!it.off } : null; })()`);
  assert.ok(menu && !menu.off, 'Route » Auto Route » All aceso no menu: ' + JSON.stringify(menu));
  await js(`${P}.destravar()`);

  /* 2. U, A, A no teclado: o pedido (pelo menu Route no cursor) */
  await js(`document.getElementById('cv').focus()`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 450, button: 'none', buttons: 0 });
  await tecla('u', 'KeyU', 85); await tecla('a', 'KeyA', 65); await tecla('a', 'KeyA', 65);
  await ate(`!!document.querySelector('.ar-scrim .ar-box')`, 4000, 'U,A,A não abriu o pedido do Auto-rotear');
  const ped = await js(`(() => { const b = document.querySelector('.ar-box'); return { info: b.querySelector('.ar-info').textContent,
    cams: [...b.querySelectorAll('.ar-camadas input')].map(i => i.value + ':' + i.checked), ordens: [...b.querySelectorAll('#ar-ordem option')].map(o => o.value),
    sel: b.querySelector('input[value="sel"]').disabled }; })()`);
  const abertas0 = await js(`(() => { const r = HubPcbNets.naoRoteadas(${P}.EB); return r.conexoes; })()`);
  assert.ok(abertas0 > 0 && ped.info.includes(String(abertas0)), 'o pedido mostra as conexões abertas (' + abertas0 + '): ' + ped.info);
  assert.deepStrictEqual(ped.cams, ['Top:true', 'Bottom:true'], 'as camadas de sinal, todas marcadas');
  assert.deepStrictEqual(ped.ordens, ['curta', 'longa', 'classe']);
  assert.ok(ped.sel, 'sem seleção, "só as nets da seleção" fica desligado');
  await print('autorotear-1-pedido');
  await tecla('Escape', 'Escape', 27);
  assert.ok(!(await js(`!!document.querySelector('.ar-scrim')`)), 'Esc fecha o pedido');
  assert.strictEqual(await js(`${P}.changes().length`), nDel, 'nada mudou');

  /* 3. Rotear no worker: a prévia e o resumo; o changes.js fica como estava; Descartar */
  const rodaAteAPrevia = async (abre) => {
    await js(abre);
    await ate(`!!document.querySelector('.ar-box .ok')`, 3000, 'o pedido não abriu');
    await js(`document.querySelector('.ar-box .ok').click()`);
    await ate(`(${P}.autoRota() || {}).fase === 'previa'`, 90000, 'a prévia não chegou');
    return js(`${P}.autoRota()`);
  };
  let rs = await rodaAteAPrevia(`${P}.autorotear({})`);
  assert.strictEqual(rs.modo, 'worker', 'rodou no Web Worker');
  assert.ok(rs.ops > 0 && rs.r.depois.doAlvo === 0 && rs.r.antes.conexoes === abertas0, 'a prévia fecha as conexões: ' + JSON.stringify(rs.r));
  assert.ok(rs.drc && rs.drc.nNovas === 0, 'DRC da prévia: nenhuma violação nova ' + JSON.stringify(rs.drc));
  const pv = await js(`${P}.previaAuto()`);
  assert.ok(pv && pv.tracks > 0 && pv.tracks + pv.vias === rs.ops, 'a prévia está desenhada na placa: ' + JSON.stringify(pv));
  assert.strictEqual(await js(`${P}.changes().length`), nDel, 'a prévia não escreve nada');
  const card = await js(`(() => { const c = document.querySelector('.ar-card'); return c ? { t: c.textContent, btn: [...c.querySelectorAll('button')].map(b => b.textContent + (b.disabled ? '(off)' : '')) } : null; })()`);
  assert.ok(card && /Prévia do auto-rotear/.test(card.t) && /nenhuma violação nova/.test(card.t), 'o cartão da prévia: ' + JSON.stringify(card));
  assert.deepStrictEqual(card.btn, ['Descartar', 'Aplicar']);
  await js(`${P}.fazAcao('enquadrar')`); await espera(300);
  await print('autorotear-2-previa');
  await js(`[...document.querySelectorAll('.ar-card button')].find(b => b.textContent === 'Descartar').click()`);
  await espera(200);
  assert.strictEqual(await js(`${P}.previaAuto()`), null, 'Descartar apaga a prévia');
  assert.ok(!(await js(`!!document.querySelector('.ar-card')`)), 'e fecha o cartão');
  assert.strictEqual(await js(`${P}.changes().length`), nDel, 'Descartar não deixa nada');

  /* 4. Cancelar no meio: no worker e em fatias (Rotear e Cancelar na mesma volta do laço) */
  for (const o of ['{}', '{worker:null}']) {
    await js(`${P}.autorotear(${o})`);
    await ate(`!!document.querySelector('.ar-box .ok')`, 3000, 'o pedido não abriu');
    const f = await js(`(() => { document.querySelector('.ar-box .ok').click(); const fase = ${P}.autoRota().fase;
      [...document.querySelectorAll('.ar-card button')].find(b => b.textContent === 'Cancelar').click(); return fase; })()`);
    assert.strictEqual(f, 'rodando', 'estava rodando');
    await espera(1500);
    assert.strictEqual(await js(`${P}.autoRota()`), null, 'Cancelar fecha (' + o + ')');
    assert.strictEqual(await js(`${P}.previaAuto()`), null);
    assert.strictEqual(await js(`${P}.changes().length`), nDel, 'Cancelar não deixa nada (' + o + ')');
  }

  /* 5. em fatias (sem worker): a mesma prévia; e o portão do DRC com uma violação nova forjada */
  rs = await rodaAteAPrevia(`${P}.autorotear({worker:null})`);
  assert.strictEqual(rs.modo, 'fatias');
  assert.ok(rs.ops > 0 && rs.r.depois.doAlvo === 0 && rs.drc && rs.drc.nNovas === 0, 'em fatias, a mesma prévia: ' + JSON.stringify(rs));
  await js(`[...document.querySelectorAll('.ar-card button')].find(b => b.textContent === 'Descartar').click()`);
  await js(`window.__cmpDrc = HubAutoRoteadorWorker.comparaDrc; HubAutoRoteadorWorker.comparaDrc = function(){ const d = window.__cmpDrc.apply(null, arguments);
    return Object.assign({}, d, { nNovas: 1, porTipo: { Clearance: 1 }, novas: [{ tipo: 'Clearance', msg: 'Clearance Constraint: (forjada pelo smoke)' }] }); }`);
  rs = await rodaAteAPrevia(`${P}.autorotear({worker:null})`);
  const gate = await js(`(() => { const c = document.querySelector('.ar-card'), ap = [...c.querySelectorAll('button')].find(b => b.textContent === 'Aplicar');
    return { forcar: !!c.querySelector('.ar-forcar input'), off: ap.disabled, perigo: ap.classList.contains('danger'), t: c.querySelector('.ar-drc').textContent }; })()`);
  assert.ok(gate.forcar && gate.off && gate.perigo && /NOVA/.test(gate.t), 'com violação nova o Aplicar trava até marcar a caixa: ' + JSON.stringify(gate));
  assert.strictEqual(await js(`${P}.autoRota().fase`), 'previa');
  await print('autorotear-3-drc-novo');
  /* o Aplicar pelo controle, sem forçar: recusa */
  assert.strictEqual(await js(`HubPcbAutoRota.atual().aplica(false)`), false, 'sem a caixa, não aplica');
  assert.strictEqual(await js(`${P}.changes().length`), nDel);
  const liga = await js(`(() => { const c = document.querySelector('.ar-card'), x = c.querySelector('.ar-forcar input'); x.click();
    return ![...c.querySelectorAll('button')].find(b => b.textContent === 'Aplicar').disabled; })()`);
  assert.ok(liga, 'a caixa "aplicar mesmo assim" acende o Aplicar');
  await js(`[...document.querySelectorAll('.ar-card button')].find(b => b.textContent === 'Descartar').click()`);
  await js(`HubAutoRoteadorWorker.comparaDrc = window.__cmpDrc`);

  /* 6. Aplicar: as linhas na vista, validadas; o ratsnest fecha; Ctrl+Z / Ctrl+Y */
  rs = await rodaAteAPrevia(`${P}.autorotear({})`);
  const nOps = rs.ops;
  await js(`[...document.querySelectorAll('.ar-card button')].find(b => b.textContent === 'Aplicar').click()`);
  await espera(400);
  const CH = await js(`${P}.changes()`);
  const novas = CH.slice(nDel);
  assert.strictEqual(novas.length, nOps, 'as linhas da prévia entraram no changes da vista');
  assert.ok(novas.every(o => (o.op === 'track_add' || o.op === 'via_add') && o.net && o.note === 'auto-rotear da vista'), 'track_add/via_add com net e note');
  assert.ok(novas.filter(o => o.op === 'track_add').every(o => NETS.includes(o.net)), 'só as nets arrancadas');
  assert.deepStrictEqual(await js(`${P}.valida().filter(v => v.status === "err")`), [], 'tudo valida no motor');
  assert.strictEqual(await js(`${P}.previaAuto()`), null, 'a prévia saiu (o cobre agora é da placa)');
  const ab1 = await js(`(() => { const r = HubPcbNets.naoRoteadas(${P}.EB); return r.nets.filter(n => ${JSON.stringify(NETS)}.includes(n.net)).reduce((s, n) => s + n.faltam, 0); })()`);
  assert.strictEqual(ab1, 0, 'o ratsnest das três nets fechou');
  assert.strictEqual((await js(`${P}.estado()`)).chDirty, true, 'a vista marca o changes.js como sujo (o Salvar grava)');
  await print('autorotear-4-aplicado');
  /* a placa de verdade continua a da cópia: o Aplicar é edição da vista, o arquivo só muda no Salvar */
  assert.strictEqual(lerVar(CHF, 'changes').length, nDel, 'o arquivo só muda no Salvar');
  /* Ctrl+Z e Ctrl+Y */
  await js(`document.getElementById('cv').focus()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await espera(300);
  assert.strictEqual(await js(`${P}.changes().length`), nDel, 'Ctrl+Z desfaz o Auto-rotear inteiro de uma vez');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'y', code: 'KeyY', windowsVirtualKeyCode: 89, modifiers: 2 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'y', code: 'KeyY', windowsVirtualKeyCode: 89, modifiers: 2 });
  await espera(300);
  assert.strictEqual(await js(`${P}.changes().length`), nDel + nOps, 'Ctrl+Y refaz');
  /* salvar pela vista: o changes.js da cópia ganha as linhas (o mesmo caminho de toda edição) */
  await js(`${P}.fazAcao('salvar')`);
  await ate(`!${P}.estado().chDirty`, 8000, 'o Salvar não gravou');
  const gravado = lerVar(CHF, 'changes');
  assert.strictEqual(gravado.length, nDel + nOps, 'o Salvar gravou as linhas do Auto-rotear no changes.js');
  /* desfaz e salva de novo: o arquivo volta às nets arrancadas (a casca, no passo 8, reabre do disco) */
  await js(`${P}.fazAcao('desfazer')`);
  await js(`${P}.fazAcao('salvar')`);
  await ate(`!${P}.estado().chDirty`, 8000, 'o Salvar do desfazer não gravou');
  assert.strictEqual(lerVar(CHF, 'changes').length, nDel, 'o arquivo voltou às nets arrancadas');

  /* 7. a placa mudou depois da prévia: o Aplicar recusa */
  rs = await rodaAteAPrevia(`${P}.autorotear({})`);
  const n7 = await js(`${P}.changes().length`);
  await js(`${P}.changes().push({ op: 'via_add', x: ${B.board.bbox.x1 + 1}, y: ${B.board.bbox.y1 + 1}, size: 0.5, drill: 0.3, note: 'smoke' })`);
  assert.strictEqual(await js(`HubPcbAutoRota.atual().aplica(false)`), false, 'a placa mudou: não aplica');
  assert.strictEqual(await js(`${P}.changes().length`), n7 + 1, 'só a mudança de fora ficou');
  await js(`${P}.changes().pop()`);

  /* 8. na casca (hub.html, aba PCB): o Auto-rotear dentro do iframe, e o desfazer da fileira acende */
  const quadro = `document.querySelector('iframe[data-kind="pcb"]')`;
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORTA}/hub.html#` + encodeURIComponent(PROJ) + '/pcb' });
  await ate(`!!(${quadro} && ${quadro}.contentWindow.__hubPcb && document.querySelector('#subtabs .pcb-desfazer'))`, 40000, 'a casca não abriu a aba PCB');
  await espera(1500);
  const V2 = `${quadro}.contentWindow.__hubPcb`, D2 = `${quadro}.contentDocument`;
  await js(`${V2}.destravar()`);
  const nCasca = await js(`${V2}.changes().length`);
  await js(`${V2}.autorotear({})`);
  await ate(`!!${D2}.querySelector('.ar-box .ok')`, 3000, 'o pedido não abriu na casca');
  await js(`${D2}.querySelector('.ar-box .ok').click()`);
  await ate(`(${V2}.autoRota() || {}).fase === 'previa'`, 90000, 'a prévia não chegou na casca');
  assert.strictEqual((await js(`${V2}.autoRota()`)).modo, 'worker', 'na casca também no worker');
  await print('autorotear-5-casca-previa');
  await js(`[...${D2}.querySelectorAll('.ar-card button')].find(b => b.textContent === 'Aplicar').click()`);
  await espera(400);
  assert.ok((await js(`${V2}.changes().length`)) > nCasca, 'aplicado dentro da casca');
  assert.deepStrictEqual(await js(`[...document.querySelectorAll('#subtabs .pcb-desfazer button')].map(b => b.disabled)`), [false, true], 'o ↶ da fileira acende');
  await js(`document.querySelector('#subtabs .pcb-desfazer button').click()`);
  await espera(300);
  assert.strictEqual(await js(`${V2}.changes().length`), nCasca, 'o ↶ da fileira desfaz o Auto-rotear');

  /* 9. sem erro de script, sem diálogo do navegador */
  assert.deepStrictEqual(erros, [], 'erros na página: ' + erros.join(' || '));
  assert.strictEqual(fs.readFileSync(path.join(RAIZ, 'Projects', PROJ, 'board.js'), 'utf8'), realAntes, 'o projeto real não muda');
  console.log(`smoke-autorotear OK (${abertas0} conexões abertas -> 0, ${nOps} linhas; worker, fatias, Cancelar, DRC, Aplicar/Ctrl+Z/Ctrl+Y/Salvar e a casca)`);
  ws.close();
  fim(0);
})().catch(e => { console.error(e); fim(1); });
setTimeout(() => { console.error('smoke-autorotear: tempo esgotado'); fim(2); }, 420000);
