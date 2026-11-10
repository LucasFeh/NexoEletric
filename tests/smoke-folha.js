/* Smoke do SELETOR DA FOLHA (1.93.0) na vista Esquema de verdade (schframe.html num Chrome/Edge headless, pelo
   DevTools Protocol), no molde do tests/smoke-odoo-bloqueio.js:
     node tests/smoke-folha.js   (CHROME, PYTHON, PORTA; SMOKE_PRINT=<pasta> grava as telas;
                                  SMOKE_PROJ=<pasta de um projeto> usa a cópia dele no lugar da DMB do repositório)
   Numa CÓPIA do projeto e da Libs (os Projects e a Libs reais nunca são tocados):
     1. o menu da folha tem UM seletor (o do template sumiu): "Folha" (A4..A0, só a de verdade, nada do Altium legado) e
        "Folha + template" ("A4 + DiEletrons", "A3 + DiEletrons"); as ações Editar/Novo/Remover template continuam;
     2. "A4 + DiEletrons" aplica a A4 e o template; "A3 + DiEletrons" a A3 ISO e o template A3, de uma vez;
     3. "A4" (sem template) tira o template e fica a A4;
     4. a folha num tamanho legado mostra "A4 legado (atual)" e só oferece as de verdade;
     5. um template novo criado numa A3 aparece como "A3 + <nome>";
     6. nenhum erro de script, nenhum diálogo do navegador. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PORTA = +(process.env.PORTA || 8027);
const DEVTOOLS = +(process.env.DEVTOOLS || 9347);
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(f => fs.existsSync(f));
const PYTHON = [process.env.PYTHON, 'python', 'C:\\Program Files\\NexoEletric\\resources\\python\\python.exe'].filter(Boolean).find(p => {
  try { execFileSync(p, ['-c', 'import flask'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
});
if (!CHROME || !PYTHON) { console.log('smoke-folha: sem ' + (!CHROME ? 'Chrome/Edge' : 'Python com Flask') + ' — pulei'); process.exit(0); }
const ORIGEM = process.env.SMOKE_PROJ || path.join(RAIZ, 'Projects', 'DMB - DI231765_P2');
const PROJ = path.basename(ORIGEM);
if (!fs.existsSync(path.join(ORIGEM, 'schematic.js'))) { console.log('smoke-folha: o projeto não está aqui — pulei'); process.exit(0); }
const espera = ms => new Promise(r => setTimeout(r, ms));
const HC = require('../hub-core.js');
const PRINT = process.env.SMOKE_PRINT || '';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-folha-'));
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
const casaAntes = fs.readFileSync(path.join(RAIZ, 'Libs', 'sch-templates-casa.js'), 'utf8');

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
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORTA}/schframe.html?p=` + encodeURIComponent(PROJ) });
  await ate(`!!document.querySelector('#folhaFmt select')`, 40000, 'a vista Esquema não abriu (sem o seletor da folha)');
  await espera(1500);
  /* o menu da folha aberto */
  await js(`(() => { const m = document.getElementById('sfMenu'); if (m.classList.contains('sf-recolhido')) document.getElementById('sfRec').click(); })()`);
  await espera(400);

  const SEL = `document.querySelector('#folhaFmt select')`;
  const estado = () => js(`(() => { const s = ${SEL}; return {
      n: document.querySelectorAll('#folhaFmt select').length, valor: s.value,
      grupos: [...s.querySelectorAll('optgroup')].map(g => ({ g: g.label, o: [...g.querySelectorAll('option')].map(o => o.textContent) })),
      soltas: [...s.children].filter(c => c.tagName === 'OPTION').map(o => o.textContent),
      acoes: [...document.querySelectorAll('#folhaFmt .sf-acao')].map(b => b.textContent.trim()),
      med: (document.querySelector('#folhaFmt .sf-med') || {}).textContent || '' }; })()`);
  const escolhe = async v => { await js(`(() => { const s = ${SEL}; s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); })()`); await espera(700); };

  /* 1. um seletor só, sem o legado, com os templates dentro */
  let e = await estado();
  assert.strictEqual(e.n, 1, 'um seletor só no menu da folha (o do template sumiu)');
  const todas = [].concat(...e.grupos.map(g => g.o), e.soltas);
  assert.ok(!todas.some(t => /legado|Altium/i.test(t)), 'nada do Altium legado: ' + todas.join(' | '));
  assert.deepStrictEqual(e.grupos.map(g => g.g), ['Folha', 'Folha + template'], 'os grupos');
  assert.deepStrictEqual(e.grupos[0].o, ['A4', 'A3', 'A2', 'A1', 'A0'], 'a folha de verdade');
  assert.ok(e.grupos[1].o.includes('A4 + DiEletrons') && e.grupos[1].o.includes('A3 + DiEletrons'), 'os templates da casa: ' + e.grupos[1].o.join(' | '));
  assert.ok(['Editar cópia…', 'Editar template…'].includes(e.acoes[0]) && e.acoes.includes('Novo template…') && e.acoes.includes('Remover template…'), 'as ações do template: ' + e.acoes.join(' | '));
  assert.strictEqual(e.valor, 'iso:A4', 'a DMB é uma A4 sem template');

  /* 2. A4 + DiEletrons, depois A3 + DiEletrons */
  await escolhe('tpl:casa:A4_DiEletrons');
  e = await estado();
  assert.strictEqual(e.valor, 'tpl:casa:A4_DiEletrons', 'A4 + DiEletrons escolhido');
  assert.ok(/11693×8268 mil/.test(e.med), 'a A4: ' + e.med);
  assert.ok(e.acoes.includes('Editar template…'), 'o template da casa edita no lugar');
  await print('folha-2-A4-DiEletrons');
  await escolhe('tpl:casa:A3_DiEletrons');
  e = await estado();
  assert.strictEqual(e.valor, 'tpl:casa:A3_DiEletrons', 'A3 + DiEletrons escolhido');
  assert.ok(/16535×11693 mil · 420×297 mm/.test(e.med), 'a A3 ISO: ' + e.med);
  const ori = await js(`[...document.querySelectorAll('#folhaFmt .sf-seg button')].map(b => b.disabled)`);
  assert.deepStrictEqual(ori, [true, true], 'com o template, a orientação segue o template');
  await print('folha-3-A3-DiEletrons');
  /* o seletor ABERTO (a lista nativa não sai na captura: vira lista com size) */
  if (PRINT) {
    await js(`(() => { const s = ${SEL}; s.size = s.options.length + s.querySelectorAll('optgroup').length; s.style.height = 'auto'; s.style.position = 'relative'; s.style.zIndex = 50; })()`);
    await espera(300);
    const r = await js(`(() => { const m = document.getElementById('sfMenu').getBoundingClientRect(); return { x: Math.max(0, m.left - 4), y: Math.max(0, m.top - 4), width: m.width + 8, height: Math.min(1000, m.height + 8) }; })()`);
    await print('folha-1-seletor-aberto', r);
    await js(`(() => { const s = ${SEL}; s.size = 0; s.removeAttribute('size'); s.style.height = ''; s.style.position = ''; s.style.zIndex = ''; })()`);
  }

  /* 3. "A4" sem template: tira o template */
  await escolhe('iso:A4');
  e = await estado();
  assert.strictEqual(e.valor, 'iso:A4', 'A4 sem template');
  assert.ok(e.acoes[0] === 'Editar cópia…', 'sem template na folha');

  /* 5. template novo numa A3 → "A3 + <nome>" */
  await escolhe('iso:A3');
  await js(`HubSchTemplateUI.abreEditor({ novo: true })`);
  await ate(`!!document.querySelector('.st-ed input')`, 5000, 'o editor não abriu');
  await js(`(() => { const i = document.querySelector('.st-ed .st-head input'); i.value = 'Painel CLP'; i.dispatchEvent(new Event('input')); })()`);
  await espera(300);
  const rotEd = await js(`document.querySelector('.st-ed .st-comofolha').textContent`);
  assert.strictEqual(rotEd, 'no seletor: A3 + Painel CLP', 'o editor diz como ele vai aparecer');
  if (PRINT) await print('folha-4-editor-template-novo');
  await js(`[...document.querySelectorAll('.st-ed .st-head button')].find(b => /Salvar como template/.test(b.textContent)).click()`);
  await ate(`!!document.querySelector('.hd-btns button.ok')`, 8000, 'a pergunta "usar nesta folha" não veio');
  const pergunta = await js(`document.querySelector('.hd-btns').closest('[class]').parentElement.textContent`);
  assert.ok(/A3 \+ Painel CLP/.test(pergunta), 'a pergunta cita a folha nova: ' + pergunta.slice(0, 200));
  await js(`document.querySelector('.hd-btns button.ok').click()`);
  await espera(900);
  e = await estado();
  assert.ok(e.grupos[1].o.includes('A3 + Painel CLP'), 'o template novo no seletor: ' + e.grupos[1].o.join(' | '));
  assert.strictEqual(e.valor, 'tpl:casa:Painel CLP', 'e na folha');
  const casaTmp = fs.readFileSync(path.join(HUB, 'Libs', 'sch-templates-casa.js'), 'utf8');
  assert.ok(/"casa:Painel CLP"/.test(casaTmp) && /"casa:A3_DiEletrons"/.test(casaTmp), 'gravado no arquivo da casa (o temporário)');
  if (PRINT) {
    await espera(1500);
    await js(`(() => { const s = ${SEL}; s.size = s.options.length + s.querySelectorAll('optgroup').length; s.style.height = 'auto'; })()`);
    await espera(300);
    const r = await js(`(() => { const m = document.getElementById('sfMenu').getBoundingClientRect(); return { x: Math.max(0, m.left - 4), y: Math.max(0, m.top - 4), width: m.width + 8, height: Math.min(1000, m.height + 8) }; })()`);
    await print('folha-5-template-novo-no-seletor', r);
    await js(`(() => { const s = ${SEL}; s.removeAttribute('size'); s.style.height = ''; })()`);
  }

  /* 4. a folha num tamanho legado (como a MIRBC-DI251885MON: 11500×7600) */
  await js(`(() => { const s = ${SEL}; s.value = 'iso:A4'; s.dispatchEvent(new Event('change')); })()`);
  await espera(500);
  const fsch = path.join(DP, 'schematic.js');
  const sch = new Function(fs.readFileSync(fsch, 'utf8') + ';return schematic;')();
  const it = sch.items.find(i => i && i.t === 'sheet');
  Object.assign(it, { size: 'A4', w: 11500, h: 7600 }); delete it.template;
  fs.writeFileSync(fsch, 'var schematic = ' + JSON.stringify(sch) + ';\n');
  await cdp('Page.reload');
  await ate(`!!document.querySelector('#folhaFmt select')`, 40000, 'a vista não voltou');
  await espera(1200);
  e = await estado();
  assert.deepStrictEqual([e.valor, e.soltas], ['', ['A4 legado (atual) · 11500×7600']], 'a legada mostra o tamanho dela');
  assert.ok(!e.grupos.some(g => g.o.some(t => /legado/.test(t))), 'e só oferece a de verdade');
  assert.ok(/11500×7600 mil/.test(e.med), 'e continua desenhando igual: ' + e.med);
  if (PRINT) {
    await js(`(() => { const s = ${SEL}; s.size = s.options.length + s.querySelectorAll('optgroup').length; s.style.height = 'auto'; })()`);
    await espera(300);
    const r = await js(`(() => { const m = document.getElementById('sfMenu').getBoundingClientRect(); return { x: Math.max(0, m.left - 4), y: Math.max(0, m.top - 4), width: m.width + 8, height: Math.min(1000, m.height + 8) }; })()`);
    await print('folha-6-folha-legada', r);
  }

  assert.deepStrictEqual(erros, [], 'erros na página: ' + erros.join(' || '));
  assert.strictEqual(fs.readFileSync(path.join(ORIGEM, 'schematic.js'), 'utf8'), schAntes, 'o projeto de origem não muda');
  assert.strictEqual(fs.readFileSync(path.join(RAIZ, 'Libs', 'sch-templates-casa.js'), 'utf8'), casaAntes, 'a Libs de origem não muda');
  console.log('smoke-folha OK (' + PROJ + ')');
  ws.close();
  fim(0);
})().catch(e => { console.error(e); fim(1); });
setTimeout(() => { console.error('smoke-folha: tempo esgotado'); fim(2); }, 300000);
