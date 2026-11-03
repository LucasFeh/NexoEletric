// Foto do 3D com os componentes (pose isometrica) e a conta de desenho, num app ja aberto com --cdp.
// Uso: node foto3d.mjs --cdp 9335 --projeto PRJ-UR-DI261924 --out foto.png
import { writeFileSync } from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const CDP = +arg('cdp', 9335), PROJ = arg('projeto'), OUT = arg('out');
const dorme = ms => new Promise(r => setTimeout(r, ms));
let page;
for (let i = 0; i < 300 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).find(x => x.type === 'page' && x.url.startsWith('http://127.0.0.1')); } catch { } if (!page) await dorme(100); }
const ws = new WebSocket(page.webSocketDebuggerUrl); let seq = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); }).then(m => m.result);
const ev = async (e, a = false) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: a }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const W = `(() => { for (const f of document.querySelectorAll('iframe')) { try { const w = f.contentWindow; if (/pcbframe\\.html/.test(w.location.href) && !/lean=1/.test(w.location.search) && new URLSearchParams(w.location.search).get('p') === ${JSON.stringify(PROJ)} && w.__hubPcb && w.__hubPcb.alvos().length) return w; } catch (e) {} } return null; })()`;
for (let i = 0; i < 600; i++) { if (await ev(`!!${W}`)) break; await dorme(100); }
await dorme(2000);
const MODO = arg('modo');
if (MODO) await ev(`localStorage.setItem('altiumhub.v3d', JSON.stringify({ modo: ${JSON.stringify(MODO)} }))`);
const r = await ev(`(async () => { const w = ${W};
  const H = w.HubPcb3dVista, cria = H.cria; H.cria = async function (...a) { const v = await cria.apply(this, a); w.__V = v; return v; };
  const P = w.WebGL2RenderingContext.prototype; let draws = 0; const de = P.drawElements, da = P.drawArrays;
  P.drawElements = function (...a) { draws++; return de.apply(this, a); }; P.drawArrays = function (...a) { draws++; return da.apply(this, a); };
  const t0 = performance.now(); w.__hubPcb.fazAcao('vista3d');
  let est = null; for (let i = 0; i < 300; i++) { await new Promise(r => setTimeout(r, 100)); est = w.__V && w.__V.estado(); if (est && est.corpos && est.steps + est.falhas.length >= 129) break; }
  const pronto = performance.now() - t0;
  w.__V.pose('iso'); await new Promise(r => w.requestAnimationFrame(() => w.requestAnimationFrame(r)));
  let malhas = 0, mats = new Set(), geos = new Set(); w.__V._cena.traverse(o => { if (o.isMesh) { malhas++; geos.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m)); } });
  draws = 0; w.__V.gira(1); await new Promise(r => w.requestAnimationFrame(() => w.requestAnimationFrame(r))); const porQuadro = draws;
  w.__V.gira(-1); await new Promise(r => w.requestAnimationFrame(() => w.requestAnimationFrame(r)));
  let n = 0; const t1 = performance.now(); await new Promise(res => { const f = () => { w.__V.gira(0.5); n++; if (performance.now() - t1 < 3000) w.requestAnimationFrame(f); else res(); }; w.requestAnimationFrame(f); });
  w.__V.pose('iso'); await new Promise(r => w.requestAnimationFrame(() => w.requestAnimationFrame(r)));
  return { modelos_prontos_ms: +pronto.toFixed(0), estado: { corpos: est.corpos, steps: est.steps, falhas: est.falhas.length }, malhas, geometrias: geos.size, materiais: mats.size, desenhos_por_quadro: porQuadro, girando_fps: +(n / 3).toFixed(1) };
})()`, true);
await dorme(500);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log(JSON.stringify(r));
ws.close(); process.exit(0);
