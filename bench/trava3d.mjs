// Travadas ao entrar no 3D (tecla 3) num app ja aberto (WebView2/Electron com --remote-debugging-port):
// cada tarefa longa da pagina (inicio e duracao), os modelos STEP chegando e o perfil de CPU.
// Uso: node trava3d.mjs --cdp 9335 --projeto PRJ-UR-DI261924 --out pasta [--segundos 25]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const CDP = +arg('cdp', 9335), PROJ = arg('projeto'), OUT = arg('out'), SEG = +arg('segundos', 25);
mkdirSync(OUT, { recursive: true });
const dorme = ms => new Promise(r => setTimeout(r, ms));

let page;
for (let i = 0; i < 300 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).find(x => x.type === 'page' && x.url.startsWith('http://127.0.0.1')); } catch { }
  if (!page) await dorme(100);
}
const ws = new WebSocket(page.webSocketDebuggerUrl); let seq = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); }).then(m => m.result);
const ev = async (expr, espera = false) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: espera });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

const W = `(() => { for (const f of document.querySelectorAll('iframe')) { try { const w = f.contentWindow; if (/pcbframe\\.html/.test(w.location.href) && !/lean=1/.test(w.location.search) && new URLSearchParams(w.location.search).get('p') === ${JSON.stringify(PROJ)} && w.__hubPcb && w.__hubPcb.alvos().length) return w; } catch (e) {} } return null; })()`;
for (let i = 0; i < 600; i++) { if (await ev(`!!${W}`)) break; await dorme(100); }
await dorme(3000);   // a vista assenta
await ev(`(() => { const w = ${W}; w.__longas = [];
  new w.PerformanceObserver(l => { for (const e of l.getEntries()) w.__longas.push([+e.startTime.toFixed(0), +e.duration.toFixed(0)]); }).observe({ entryTypes: ['longtask'] });
  const H = w.HubPcb3dVista, cria = H.cria;
  H.cria = async function (...a) { const v = await cria.apply(this, a); w.__V = v; return v; };
  return 1; })()`);
await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 500 });
await send('Profiler.start');
const MODO = arg('modo');
if (MODO) await ev(`localStorage.setItem('altiumhub.v3d', JSON.stringify({ modo: ${JSON.stringify(MODO)} }))`);
const t0 = await ev(`(() => { const w = ${W}; const t = performance.now(); w.__t3 = t; w.__hubPcb.fazAcao('vista3d'); return t; })()`);
const linha = [];
for (let i = 0; i < SEG * 5; i++) {
  await dorme(200);
  const s = await ev(`(() => { const w = ${W}; const e = w.__V && w.__V.estado ? w.__V.estado() : null; return { t: +(performance.now() - w.__t3).toFixed(0), steps: e ? e.steps : null, corpos: e ? e.corpos : null, falhas: e ? e.falhas.length : null }; })()`);
  linha.push(s);
}
const prof = (await send('Profiler.stop')).profile;
const longas = (await ev(`${W}.__longas`)).map(([s, d]) => [+(s - t0).toFixed(0), d]).filter(([s]) => s >= -50);

// perfil: tempo proprio por funcao (sem ocioso)
const porNo = new Map(prof.nodes.map(n => [n.id, n]));
const dt = (prof.endTime - prof.startTime) / prof.samples.length / 1000;
const fn = new Map();
for (const s of prof.samples) {
  const cf = porNo.get(s).callFrame, a = (cf.url || cf.functionName).split('/').pop();
  if (a === '(idle)') continue;
  const k = `${cf.functionName || '(anon)'}  ${a}:${cf.lineNumber + 1}`;
  fn.set(k, (fn.get(k) || 0) + dt);
}
const top = [...fn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => [k, +v.toFixed(0)]);
const out = {
  longas_total_ms: longas.reduce((a, [, d]) => a + d, 0), longas_n: longas.length, maior_ms: Math.max(0, ...longas.map(([, d]) => d)),
  longas, linha: linha.filter((x, i) => i % 5 === 4 || i < 10), cpu_top: top,
};
writeFileSync(join(OUT, 'trava3d.json'), JSON.stringify(out, null, 1));
writeFileSync(join(OUT, 'trava3d.cpuprofile'), JSON.stringify(prof));
console.log(JSON.stringify({ longas_total_ms: out.longas_total_ms, longas_n: out.longas_n, maior_ms: out.maior_ms, fim: linha[linha.length - 1] }));
ws.close(); process.exit(0);
