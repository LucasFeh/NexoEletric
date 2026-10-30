// Quanto custa ABRIR a vista 3D (tecla 3) e a 2D, num Edge headless contra um hub (Python ou Rust):
// marca o tempo de cada etapa e grava o perfil de CPU de cada uma.
// Uso: node perfil3d.mjs --hub http://127.0.0.1:8250 --projeto PRJ-DI161455 --out pasta [--gpu]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const HUB = arg('hub'), PROJ = arg('projeto'), OUT = arg('out');
const PORTA = 9446;
mkdirSync(OUT, { recursive: true });
const dorme = ms => new Promise(r => setTimeout(r, ms));
const flags = ['--headless=new', `--remote-debugging-port=${PORTA}`, `--user-data-dir=${arg('perfil') || mkdtempSync(join(tmpdir(), 'nx-p3d-'))}`,
  '--window-size=1600,1000', '--no-first-run', 'about:blank'];
if (process.argv.includes('--gpu')) flags.unshift('--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist');
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', flags, { stdio: 'ignore' });

function resumo(perfil, top = 25) {
  const porNo = new Map(perfil.nodes.map(n => [n.id, n]));
  const dt = (perfil.endTime - perfil.startTime) / Math.max(perfil.samples.length, 1) / 1000;
  const fn = new Map(), arq = new Map();
  for (const s of perfil.samples) {
    const cf = porNo.get(s).callFrame;
    const a = (cf.url || cf.functionName || '?').split('/').pop();
    if (a === '(idle)') continue;
    arq.set(a, (arq.get(a) || 0) + dt);
    const k = `${cf.functionName || '(anon)'}  ${a}:${cf.lineNumber + 1}`;
    fn.set(k, (fn.get(k) || 0) + dt);
  }
  const ord = m => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, top).map(([k, v]) => [k, +v.toFixed(1)]);
  return { cpu_ms: +[...arq.values()].reduce((a, b) => a + b, 0).toFixed(0), por_arquivo: ord(arq), por_funcao: ord(fn) };
}

try {
  let page;
  for (let i = 0; i < 100 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORTA}/json`)).json()).find(x => x.type === 'page'); } catch { } await dorme(100); }
  const ws = new WebSocket(page.webSocketDebuggerUrl); let seq = 0; const pend = new Map();
  const erros = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') erros.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
    else if (m.method === 'Runtime.consoleAPICalled' && /warn|error/.test(m.params.type)) erros.push(m.params.type + ' ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 400)); };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}) => new Promise(r => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); }).then(m => m.result);
  const ev = async (expr, espera = false) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: espera }); if (r.exceptionDetails) throw new Error('avaliar: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result && r.result.value; };
  await send('Runtime.enable'); await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 200 });

  // ---- 2D: do pedido de abrir ate a placa pronta ----
  await send('Page.enable');
  if (process.argv.includes('--sem-pre3d')) await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('altiumhub.pcb.3d.antes', '0'); } catch (e) {}` });
  await send('Page.navigate', { url: `${HUB}/` });
  for (let i = 0; i < 300; i++) { if (await ev(`!!document.querySelector('iframe') || document.readyState === 'complete'`)) break; await dorme(50); }
  await dorme(500);
  await send('Profiler.start');
  const t2d = Date.now();
  // abre pelo mesmo pedido que o MCP (vista_abrir) faz ao hub
  for (let i = 0; i < 300; i++) {
    const r = await fetch(`${HUB}/api/mcp/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alvo: 'hub', proj: '*', acao: 'abrir', args: { projeto: PROJ, aba: 'pcb' } }) }).then(r => r.json()).catch(() => null);
    if (r && r.ok) break;
    await dorme(50);
  }
  const W = `(() => { for (const f of document.querySelectorAll('iframe')) { try { const w = f.contentWindow; if (/pcbframe\\.html/.test(w.location.href) && !/lean=1/.test(w.location.search) && new URLSearchParams(w.location.search).get('p') === ${JSON.stringify(PROJ)} && w.__hubPcb && w.__hubPcb.alvos().length) return w; } catch (e) {} } return null; })()`;
  for (let i = 0; i < 600; i++) { if (await ev(`!!${W}`)) break; await dorme(20); }
  const pronto2d = Date.now() - t2d;
  const tempos2d = await ev(`(() => { const w = ${W}; const n = w.performance.getEntriesByType('navigation')[0];
    const rs = w.performance.getEntriesByType('resource');
    const js = rs.filter(r => r.name.split('?')[0].endsWith('.js'));
    const proj = rs.filter(r => r.name.includes('Projects/')).map(r => [r.name.split('/').pop(), +r.startTime.toFixed(0), +r.responseEnd.toFixed(0), r.transferSize]);
    return { iframe_inicio_desde_hub: +(w.performance.timeOrigin - performance.timeOrigin).toFixed(0), html_resposta: +n.responseEnd.toFixed(0),
             dom_interativo: +n.domInteractive.toFixed(0), dcl: +n.domContentLoadedEventEnd.toFixed(0), load: +n.loadEventEnd.toFixed(0),
             pronto: +w.performance.now().toFixed(0), scripts: js.length, scripts_ultimo_fim: +Math.max(...js.map(r => r.responseEnd)).toFixed(0),
             scripts_kb: +(js.reduce((a, r) => a + r.encodedBodySize, 0) / 1024).toFixed(0), scripts_cache: js.filter(r => r.transferSize === 0).length, projeto: proj }; })()`);
  // a placa de fato na tela: no hibrido, o canvas do WebGL visivel; no original, ja no pronto
  for (let i = 0; i < 200; i++) {
    const g = await ev(`(() => { const w = ${W}; const c = w.document.querySelector('canvas.nexo-gl'); return c ? (c.style.display === 'block' ? +w.performance.now().toFixed(0) : 0) : -1; })()`);
    if (g !== 0) { tempos2d.gl_visivel = g; break; }
    await dorme(5);
  }
  console.log('tempos2d', JSON.stringify(tempos2d));
  await ev(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`, true);
  const quadro2d = Date.now() - t2d;
  await dorme(2000);
  const p2d = (await send('Profiler.stop')).profile;
  writeFileSync(join(OUT, 'abrir2d.cpuprofile'), JSON.stringify(p2d));

  // ---- 3D: tecla 3 ate a cena assentar (corpos carregados, sem tarefa longa por 1,5 s) ----
  await ev(`(() => { const w = ${W}; w.__t3 = {}; w.__longas = 0; w.__ultLonga = performance.now();
    try { new w.PerformanceObserver(l => { for (const e of l.getEntries()) { w.__longas += e.duration; w.__ultLonga = e.startTime + e.duration; } }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
    const H = w.HubPcb3dVista, cria = H.cria;
    H.cria = async function (...a) { w.__t3.criaIni = performance.now(); const v = await cria.apply(this, a); w.__t3.criaFim = performance.now(); w.__V = v;
      const cena = v.cena; v.cena = function (...b) { w.__t3.cenaIni = performance.now(); const r = cena.apply(this, b); w.__t3.cenaRet = performance.now(); Promise.resolve(r).then(() => { w.__t3.cenaFim = performance.now(); }); return r; };
      return v; };
    return 1; })()`);
  await send('Profiler.start');
  const t3 = await ev(`(() => { const w = ${W}; w.__t3.tecla = performance.now(); w.__hubPcb.fazAcao('vista3d'); return w.__t3.tecla; })()`);
  let estado = null, ultSteps = -1, tSteps = 0;
  for (let i = 0; i < 1200; i++) {
    const s = await ev(`(() => { const w = ${W}; const v = w.__V; return { t: w.__t3, agora: performance.now(), ult: w.__ultLonga, longas: w.__longas, est: v && v.estado ? v.estado() : null }; })()`);
    estado = s;
    const st = s.est ? s.est.steps + s.est.falhas.length : 0;
    if (st !== ultSteps) { ultSteps = st; tSteps = s.agora; }
    if (s.t.cenaFim && s.agora - Math.max(s.ult, s.t.cenaFim) > 1500 && s.agora - tSteps > 3000) break;
    await dorme(50);
  }
  const p3d = (await send('Profiler.stop')).profile;
  writeFileSync(join(OUT, 'abrir3d.cpuprofile'), JSON.stringify(p3d));
  const t = estado.t, rel = k => t[k] != null ? +(t[k] - t3).toFixed(0) : null;
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, 'vista3d.png'), Buffer.from(shot.data, 'base64'));
  const out = {
    hub: HUB,
    d2: { placa_pronta_ms: pronto2d, tempos: tempos2d, primeiro_quadro_ms: quadro2d, cpu: resumo(p2d) },
    d3: { cria_pronta_ms: rel('criaFim'), cena_chamada_ms: rel('cenaIni'), cena_retornou_ms: rel('cenaRet'), cena_resolvida_ms: rel('cenaFim'),
          erros: erros.slice(0, 40), assentou_ms: +(Math.max(estado.ult, t.cenaFim || 0, tSteps) - t3).toFixed(0), tarefas_longas_ms: +estado.longas.toFixed(0), estado: estado.est, cpu: resumo(p3d) },
  };
  writeFileSync(join(OUT, 'perfil3d.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ d2: { pronta: out.d2.placa_pronta_ms, cpu: out.d2.cpu.cpu_ms }, d3: { ...out.d3, cpu: out.d3.cpu.cpu_ms } }));
  ws.close();
} catch (e) { console.error('ERRO', e && e.stack || e); } finally { edge.kill(); process.exit(0); }
