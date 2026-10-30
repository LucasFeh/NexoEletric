// Perfil da interface web do NexoEletric num Edge headless (sem Electron e sem tocar no app da
// pessoa): abre o hub, abre a placa na aba PCB, e grava (1) a rede da abertura, (2) o perfil de CPU
// da abertura e (3) o perfil de CPU de N s de camera andando (__hubPcb.setView).
//
// Uso: node perfil.mjs --hub http://127.0.0.1:8371 --projeto PRJ-DI161455 --out pasta [--anima 10]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const HUB = arg('hub', 'http://127.0.0.1:8371'), PROJ = arg('projeto'), OUT = arg('out'), ANIMA = +arg('anima', 10);
const EDGE = arg('edge', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
const PORTA = 9444;
mkdirSync(OUT, { recursive: true });
const dorme = ms => new Promise(r => setTimeout(r, ms));

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORTA}`, `--user-data-dir=${join(OUT, 'edge-perfil')}`,
  '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

async function alvo() {
  for (let i = 0; i < 200; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORTA}/json`)).json(); const p = l.find(x => x.type === 'page'); if (p) return p; } catch { }
    await dorme(100);
  }
  throw new Error('edge nao subiu');
}
function conecta(url) {
  const ws = new WebSocket(url); let seq = 0; const pend = new Map(), ev = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const { ok, ko } = pend.get(m.id); pend.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result); } else ev.push(m); };
  const send = (method, params = {}) => new Promise((ok, ko) => { const id = ++seq; pend.set(id, { ok, ko }); ws.send(JSON.stringify({ id, method, params })); });
  return new Promise(r => { ws.onopen = () => r({ send, ev, ws }); });
}

// soma o tempo proprio de cada funcao do perfil (amostras x intervalo)
function resumo(perfil, top = 30) {
  const porNo = new Map(perfil.nodes.map(n => [n.id, n]));
  const dt = (perfil.endTime - perfil.startTime) / Math.max(perfil.samples.length, 1) / 1000;
  const self = new Map();
  for (const s of perfil.samples) {
    const n = porNo.get(s); const cf = n.callFrame;
    const k = `${cf.functionName || '(anonima)'}  ${(cf.url || '').split('/').pop()}:${cf.lineNumber + 1}`;
    self.set(k, (self.get(k) || 0) + dt);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  return { total_ms: total, top: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => ({ fn: k, ms: +v.toFixed(1), pct: +(100 * v / total).toFixed(1) })) };
}

try {
  const page = await alvo();
  const c = await conecta(page.webSocketDebuggerUrl);
  await c.send('Network.enable'); await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 200 });
  await c.send('Profiler.start');
  const t0 = Date.now();
  await c.send('Page.navigate', { url: `${HUB}/` });
  // espera o hub, depois pede a placa na aba PCB pelo mesmo canal do MCP
  for (let i = 0; i < 300; i++) {
    const r = await fetch(`${HUB}/api/mcp/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alvo: 'hub', proj: '*', acao: 'abrir', args: { projeto: PROJ, aba: 'pcb' } }) }).then(r => r.json()).catch(() => null);
    if (r && r.ok) { const q = await fetch(`${HUB}/api/mcp/resposta/${r.id}?espera=15`).then(r => r.json()).catch(() => null); if (q && q.ok) break; }
    await dorme(100);
  }
  const tPedido = Date.now();
  // a vista PCB pronta: o iframe com o gancho de teste e a placa indexada
  const PRONTA = `(() => { for (const f of document.querySelectorAll('iframe')) { try { const w = f.contentWindow; if (/pcbframe\\.html/.test(w.location.href) && !/lean=1/.test(w.location.search) && w.__hubPcb && w.__hubPcb.alvos().length > 0) return 1; } catch (e) {} } return 0; })()`;
  let pronto = 0;
  for (let i = 0; i < 600 && !pronto; i++) { pronto = (await c.send('Runtime.evaluate', { expression: PRONTA, returnByValue: true })).result.value; if (!pronto) await dorme(50); }
  const tPronto = Date.now();
  await dorme(1500);
  const glInfo = (await c.send('Runtime.evaluate', { returnByValue: true, expression: `(() => { for (const f of document.querySelectorAll('iframe')) { try { const w = f.contentWindow; if (/pcbframe\.html/.test(w.location.href) && !/lean=1/.test(w.location.search)) { const g = w.document.querySelector('canvas.nexo-gl'); return { gl: !!g, visivel: !!g && g.style.display !== 'none', w: g && g.width, h: g && g.height, nexoGL: typeof w.NexoGL }; } } catch (e) { return { erro: String(e) }; } } return null; })()` })).result.value;
  console.error('webgl:', JSON.stringify(glInfo));
  // um pouco de folga para o trabalho que a vista faz depois de abrir (ratsnest, DRC, despejo...)
  await dorme(3000);
  const pAbrir = (await c.send('Profiler.stop')).profile;
  writeFileSync(join(OUT, 'abrir.cpuprofile'), JSON.stringify(pAbrir));

  // rede: o que a abertura pediu, com o tempo de cada pedido
  const req = new Map();
  for (const m of c.ev) {
    if (m.method === 'Network.requestWillBeSent') req.set(m.params.requestId, { url: m.params.request.url.replace(HUB, ''), t0: m.params.timestamp });
    if (m.method === 'Network.loadingFinished' && req.has(m.params.requestId)) { const r = req.get(m.params.requestId); r.ms = (m.params.timestamp - r.t0) * 1000; r.kb = m.params.encodedDataLength / 1024; }
  }
  const rede = [...req.values()].filter(r => r.ms != null).sort((a, b) => b.ms - a.ms);

  // animacao: a camera andando, com perfil
  await c.send('Profiler.start');
  const anim = await c.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `new Promise(res => {
    let w = null; for (const f of document.querySelectorAll('iframe')) { try { if (/pcbframe\\.html/.test(f.contentWindow.location.href) && !/lean=1/.test(f.contentWindow.location.search)) w = f.contentWindow; } catch (e) {} }
    const v = w.__hubPcb.estado().view, base = v.scale, cx = v.cx, cy = v.cy, fr = [];
    let t0 = null, last = null;
    function passo(now) {
      if (t0 === null) t0 = now; const t = (now - t0) / 1000;
      if (last !== null) fr.push(now - last); last = now;
      w.__hubPcb.setView(cx + 40 * Math.sin(t * 0.55), cy + 20 * Math.cos(t * 0.37), base * (1 + 5.5 * (1 - Math.cos(t * 0.9))));
      if (t >= ${ANIMA}) return res({ quadros: fr.length, medio: fr.reduce((a, b) => a + b, 0) / fr.length });
      w.requestAnimationFrame(passo);
    }
    w.requestAnimationFrame(passo);
  })` });
  const pAnim = (await c.send('Profiler.stop')).profile;
  writeFileSync(join(OUT, 'animar.cpuprofile'), JSON.stringify(pAnim));
  const mem = (await c.send('Runtime.evaluate', { returnByValue: true, expression: `(() => { let w = null; for (const f of document.querySelectorAll('iframe')) { try { if (/pcbframe/.test(f.contentWindow.location.href)) w = f.contentWindow; } catch (e) {} } return { heap_hub_mb: performance.memory.usedJSHeapSize / 1048576, iframes: document.querySelectorAll('iframe').length }; })()` })).result.value;

  const out = {
    abrir: { ate_pedido_aceito_ms: tPedido - t0, ate_placa_pronta_ms: tPronto - t0, cpu: resumo(pAbrir) },
    rede_mais_lentas: rede.map(r => ({ url: r.url, ms: +r.ms.toFixed(0), kb: +(r.kb || 0).toFixed(0) })),
    webgl: glInfo,
    console: c.ev.filter(m => m.method === 'Runtime.exceptionThrown' || (m.method === 'Runtime.consoleAPICalled' && /warn|error/.test(m.params.type))).slice(0, 30).map(m => m.method === 'Runtime.exceptionThrown' ? 'EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300) : m.params.type + ' ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)),
    rede_total: { pedidos: rede.length, kb: +rede.reduce((a, r) => a + (r.kb || 0), 0).toFixed(0) },
    animar: { ...anim.result.value, cpu: resumo(pAnim) },
    memoria: mem,
  };
  writeFileSync(join(OUT, 'perfil.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
  c.ws.close();
} finally {
  edge.kill();
}
