/* Smoke das ARTES DE OVERLAY (1.91.0) na vista PCB de verdade (pcbframe.html num Chrome/Edge headless, pelo DevTools
   Protocol), no molde do tests/smoke-serigrafia.js:
     node tests/smoke-artes.js     (CHROME, PYTHON, PORTA; SMOKE_PRINT=<pasta> grava as telas e o PDF;
                                    SMOKE_PROJ=<pasta de um projeto> usa a cópia dele no lugar da DMB do repositório)
   Fora do `test-*.js` de propósito: precisa do navegador e do Python do hub (Flask). Sobe um hub temporário numa CÓPIA
   da placa — os Projects reais e a Libs/ real nunca são tocados; o Nexo Hub é um endereço morto (NEXOHUB_URL) e o
   catálogo um arquivo que não existe (NEXO_CATALOGO).
     1. o botão "Artes" da barra abre a lista com as duas artes da casa (miniaturas);
     2. clicar no "Código da placa + revisão" pega a arte na mão; o clique na placa larga (um comp_add com o desenho);
     3. arrastar a "Logo DiEletrons + QR" da lista para a placa a larga onde soltou;
     4. as duas validam, viram componentes-arte, e o Gerber tem a logo/QR na legenda de cima;
     5. a ficha da arte no painel (escala); escala 1,5 muda o desenho; Ctrl+Z volta;
     6. o Studio: arte nova com QR + texto com campo, salva na biblioteca (Libs/pcb-artes.json da pasta temporária);
     7. nenhum erro de script, nenhum diálogo do navegador. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PORTA = +(process.env.PORTA || 8019);
const DEVTOOLS = +(process.env.DEVTOOLS || 9341);
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(f => fs.existsSync(f));
const PYTHON = [process.env.PYTHON, 'python', 'C:\\Program Files\\NexoEletric\\resources\\python\\python.exe'].filter(Boolean).find(p => {
  try { execFileSync(p, ['-c', 'import flask'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
});
if (!CHROME || !PYTHON) { console.log('smoke-artes: sem ' + (!CHROME ? 'Chrome/Edge' : 'Python com Flask') + ' — pulei'); process.exit(0); }
const ORIGEM = process.env.SMOKE_PROJ || path.join(RAIZ, 'Projects', 'DMB - DI231765_P2');
const PROJ = path.basename(ORIGEM);
if (!fs.existsSync(path.join(ORIGEM, 'board.js'))) { console.log('smoke-artes: a placa não está aqui — pulei'); process.exit(0); }
const espera = ms => new Promise(r => setTimeout(r, ms));
const HC = require('../hub-core.js');
const PRINT = process.env.SMOKE_PRINT || '';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-artes-'));
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
  const mouse = async (type, x, y, extra) => cdp('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 }, extra || {}));
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORTA}/pcbframe.html?p=` + encodeURIComponent(PROJ) });
  await ate('!!window.__hubPcb', 40000, 'a vista não abriu');
  await espera(1800);
  const P = 'window.__hubPcb';
  await js(`${P}.destravar()`);
  /* a tela de um ponto da placa, em px da página */
  const tela = async (x, y) => js(`(() => { const r = document.getElementById('cv').getBoundingClientRect(), t = ${P}.telaDe(${x}, ${y}); return { x: r.left + t.x, y: r.top + t.y }; })()`);
  const B = await js('(() => { const b = window.pcbmirror.board.bbox; return [b.x1, b.y1, b.x2, b.y2]; })()');
  /* a arte da casa ao lado da feita à mão: na DMB a logo + QR à mão está em x 15,7..50,6, y 101,5..111,6, e o
     "PDMB-DI231765_P2 / REV. C" em volta de (83,9; 22,1) */
  const LOGO = { x: 33.17, y: 92.5 }, COD = { x: 83.88, y: 30 };

  /* 1. a lista */
  const tit = await js(`(document.getElementById('tb-artes') || {}).title || ''`);
  assert.ok(/Artes de overlay/.test(tit), 'o botão na barra: ' + tit);
  await js(`document.getElementById('tb-artes').click()`);
  await ate(`document.querySelectorAll('.ar-lista .ar-card').length >= 2`, 8000, 'a lista não abriu');
  const nomes = await js(`[...document.querySelectorAll('.ar-lista .ar-card .ar-nm span:first-child')].map(s => s.textContent)`);
  assert.deepStrictEqual(nomes.slice(0, 2), ['Logo DiEletrons + QR', 'Código da placa + revisão'], 'as duas da casa primeiro');
  await js(`${P}.setView(${(B[0] + B[2]) / 2}, ${(B[1] + B[3]) / 2}, 7)`);
  await espera(700);
  await print('artes-1-lista-na-vista-pcb');

  /* 2. clicar pega na mão; o clique na placa larga */
  await js(`document.querySelectorAll('.ar-lista .ar-card')[1].click()`);
  assert.strictEqual(await js(`${P}.estado().tool`), 'arte', 'a arte na mão');
  const pc = await tela(COD.x, COD.y);
  await mouse('mouseMoved', pc.x, pc.y); await espera(300);
  await print('artes-2-codigo-na-mao');
  await mouse('mousePressed', pc.x, pc.y); await mouse('mouseReleased', pc.x, pc.y);
  await ate(`${P}.changes().length === 1`, 5000, 'o clique não largou a arte');
  assert.strictEqual(await js(`${P}.estado().tool`), 'select', 'larga e volta ao Selecionar');

  /* 3. arrastar da lista e soltar na placa (o drop de verdade, com o DataTransfer do navegador) */
  const pl = await tela(LOGO.x, LOGO.y);
  await js(`(() => { const dt = new DataTransfer(); dt.setData('application/x-nexo-arte', 'dieletrons-logo-qr');
    const w = document.getElementById('cvwrap');
    w.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: ${pl.x}, clientY: ${pl.y} }));
    w.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: ${pl.x}, clientY: ${pl.y} })); })()`);
  await ate(`${P}.changes().length === 2`, 5000, 'o drop não largou a arte');
  const chs = await js(`${P}.changes().map(c => ({ op: c.op, ref: c.ref, x: c.x, y: c.y, id: c.arte && c.arte.id, r: c.arte && c.arte.fp.r.length, t: c.arte && c.arte.fp.t.map(t => t.text) }))`);
  assert.deepStrictEqual(chs.map(c => [c.op, c.ref, c.id]), [['comp_add', 'ARTE1', 'codigo-revisao'], ['comp_add', 'ARTE2', 'dieletrons-logo-qr']]);
  assert.deepStrictEqual(chs[0].t, ['=CodigoDaPlaca', '=Revisao']);
  assert.ok(Math.abs(chs[1].x - LOGO.x) < 0.6 && Math.abs(chs[1].y - LOGO.y) < 0.6, 'soltou onde o mouse estava: ' + JSON.stringify(chs[1]));
  assert.deepStrictEqual((await js(`${P}.valida()`)).filter(v => v.status === 'err'), [], 'validam');

  /* 4. o Gerber: a logo + QR na legenda de cima, o texto com o código */
  const g = await js(`(() => { const b = window.pcbmirror, ch = ${P}.changes(), eb = HubCore.effectiveBoard(b, HubCore.applyPcbChanges(b, ch));
    const res = HubGerber.gerar(eb, { software: 'NexoEletric' }), gto = res.arquivos.find(a => a.camada === 'TopOverlay');
    const cam = HubGerberView.parse(gto.texto, gto.nome);
    const comps = eb.components.filter(c => c.arte).map(c => c.ref);
    const textos = eb.texts.filter(t => t.owner === 'ARTE1' && !t.designator).map(t => HubCore.resolveEspeciais(t.text));
    return { nome: gto.nome, regioes: cam.prims.filter(p => p.k === 'region').length, comps, textos, avisos: (res.avisos || []).filter(a => /especial/.test(JSON.stringify(a))).length }; })()`);
  assert.deepStrictEqual(g.comps, ['ARTE1', 'ARTE2'], 'componentes-arte');
  assert.ok(g.regioes >= chs[1].r, 'a GTO tem as regiões da logo + QR: ' + g.regioes);
  /* campo sem valor (a DMB do repositório não tem a revisão no cabeçalho) sai cru e o Gerber avisa */
  assert.strictEqual(g.avisos, g.textos.some(t => /=/.test(t)) ? 1 : 0, 'o aviso de campo cru no Gerber só quando há campo sem valor: ' + JSON.stringify(g.textos));
  console.log('  Gerber ' + g.nome + ': ' + g.regioes + ' regiões; código + revisão = ' + JSON.stringify(g.textos));

  await js(`HubPcbArtesUi && document.querySelector('.ar-lista .ar-x') && document.querySelector('.ar-lista .ar-x').click()`);
  await js(`${P}.setView(${LOGO.x}, ${(LOGO.y + 106.5) / 2}, 26)`); await espera(700);
  await print('artes-3-logo-qr-padrao-vs-a-mao');
  await js(`${P}.setView(${COD.x}, ${(COD.y + 22.12) / 2}, 32)`); await espera(700);
  await print('artes-4-codigo-revisao-vs-a-mao');

  /* 5. selecionar a arte: a ficha com a escala; escala 1,5; Ctrl+Z */
  await js(`${P}.selecionar(${P}.alvos().filter(a => a.t === 'comp' && a.m.src.ref === 'ARTE1'))`);
  await espera(400);
  const ficha = await js(`(() => { const f = ${P}.fichaDe(${P}.alvos().find(a => a.t === 'comp' && a.m.src.ref === 'ARTE1')); return { titulo: f.titulo, ks: JSON.stringify(f.campos) }; })()`);
  assert.strictEqual(ficha.titulo, 'Arte de overlay');
  assert.ok(/"escala"/.test(ficha.ks) && /arteStudio/.test(ficha.ks), 'a ficha tem a escala e o Studio');
  await print('artes-5-ficha-da-arte');

  /* 6. o Studio: arte nova com QR e texto com campo, salva na biblioteca da pasta temporária */
  await js(`${P}.fazAcao('arteStudio')`);
  await ate(`!!document.querySelector('.ar-st-box')`, 5000, 'o Studio não abriu');
  await js(`[...document.querySelectorAll('.ar-st-bib .ar-btn')].find(b => b.textContent === 'Nova').click()`);
  await espera(300);
  await js(`(() => { const S = HubPcbArtesUi && ${P}.artes().studio(); const n = document.querySelector('.ar-st-cab input'); n.value = 'Selo de garantia'; n.dispatchEvent(new Event('input'));
    const st = S.estado(); st.arte.elementos = [];
    S.poeEl({ tipo: 'retangulo', x: 0, y: 0, larg: 30, alt: 12, w: 0.2, cheio: false });
    S.poeEl({ tipo: 'qr', x: -9, y: 0, tam: 9, texto: 'https://www.dieletrons.com.br/garantia', ec: 'M', borda: 1, invertido: true });
    S.poeEl({ tipo: 'texto', x: 5.5, y: 2.6, texto: 'GARANTIA', h: 1.8, w: 0.25, rot: 0 });
    S.poeEl({ tipo: 'texto', x: 5.5, y: -0.4, texto: '=CodigoDaPlaca', h: 1.2, w: 0.18, rot: 0 });
    S.poeEl({ tipo: 'texto', x: 5.5, y: -2.8, texto: '=Revisao  =Data', h: 1.0, w: 0.15, rot: 0 }); })()`);
  await espera(500);
  await js(`(() => { const L = document.querySelectorAll('.ar-st-lado .ar-el'); L[3] && L[3].click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true })); })()`);
  await espera(400);
  await print('artes-6-studio-criando-arte');
  await js(`document.querySelector('.ar-st-pe .ar-btn.forte').click()`);
  await ate(`(() => { const s = ${P}.artes().studio(); return s && s.estado().arte.versao === 1 && !s.estado().sujo; })()`, 8000, 'o Studio não salvou');
  const lib = JSON.parse(fs.readFileSync(path.join(HUB, 'Libs', 'pcb-artes.json'), 'utf8'));
  assert.deepStrictEqual(lib.artes.map(a => [a.id, a.nome, a.versao]), [['selo-de-garantia', 'Selo de garantia', 1]], 'gravou na biblioteca (a da pasta temporária)');
  await print('artes-7-studio-salvo');
  /* a arte padrão no Studio: sem ser admin, Salvar fica travado com o motivo */
  await js(`[...document.querySelectorAll('.ar-st-bib .ar-item')].find(i => /Logo DiEletrons/.test(i.textContent)).click()`);
  await espera(400);
  const travado = await js(`(() => { const b = document.querySelector('.ar-st-pe .ar-btn.forte'); return b.disabled && b.title; })()`);
  assert.ok(/administrador/.test(travado || ''), 'arte padrão: só o admin muda — ' + travado);
  await js(`${P}.artes().studio().fecha()`);
  await espera(300);
  /* a arte nova aparece na lista */
  await js(`document.getElementById('tb-artes').click()`);
  await ate(`[...document.querySelectorAll('.ar-lista .ar-card')].some(c => /Selo de garantia/.test(c.textContent))`, 5000, 'a arte nova não entrou na lista');

  /* o PDF da placa com as artes (para a conferência) */
  if (PRINT) {
    const b64 = await js(`(() => { const b = window.pcbmirror, eb = HubCore.effectiveBoard(b, HubCore.applyPcbChanges(b, ${P}.changes()));
      const by = HubPcbPdf.gera(eb, {}); let s = ''; for (let i = 0; i < by.length; i++) s += String.fromCharCode(by[i]); return btoa(s); })()`);
    fs.writeFileSync(path.join(PRINT, 'artes-pcb.pdf'), Buffer.from(b64, 'base64'));
    await js(`document.querySelector('.ar-lista .ar-x') && document.querySelector('.ar-lista .ar-x').click()`);
    await js(`${P}.fazAcao('gerber')`);
    await espera(3500);
    await print('artes-8-gerber');
  }

  assert.deepStrictEqual(erros, [], 'erros na página: ' + erros.join(' || '));
  assert.strictEqual(fs.readFileSync(path.join(ORIGEM, 'board.js'), 'utf8'), boardAntes, 'o projeto de origem não muda');
  assert.ok(!fs.existsSync(path.join(RAIZ, 'Libs', 'pcb-artes.json')), 'a Libs/ do repositório não ganhou biblioteca de artes');
  console.log('smoke-artes OK (' + PROJ + ')');
  ws.close();
  fim(0);
})().catch(e => { console.error(e); fim(1); });
setTimeout(() => { console.error('smoke-artes: tempo esgotado'); fim(2); }, 300000);
