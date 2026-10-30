// Dirige a instancia de teste do NexoEletric (Electron) pelo DevTools Protocol, no mesmo roteiro
// do `NexoEletric --bench` do Rust: abre a placa, marca "parado" quando ela esta na tela, espera,
// marca "animando" e anda pela placa com a MESMA formula de camera (zoom 1x..12x e pan), chamando
// o draw() original do pcbframe a cada quadro; no fim grava as medidas e marca "fim".
//
// Uso: node electron.mjs --cdp 9333 --hub 8371 --projeto NOME --idle 20 --secs 30
//                        --board board.js --fase fase.txt --out resultado.json --t0 <epoch ms do lancamento>
import { readFileSync, writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const CDP = +arg('cdp', 9333), HUB = +arg('hub', 8371), PROJ = arg('projeto'), IDLE = +arg('idle', 20), SECS = +arg('secs', 30);
const BOARD = arg('board');
const FASE = arg('fase'), OUT = arg('out'), T0 = +arg('t0', Date.now());
const marca = f => FASE && writeFileSync(FASE, f);
const dorme = ms => new Promise(r => setTimeout(r, ms));

async function alvo() {
  for (let i = 0; i < 600; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
      const p = l.find(x => x.type === 'page' && x.url.startsWith(`http://127.0.0.1:${HUB}`));
      if (p) return p;
    } catch { /* ainda subindo */ }
    await dorme(100);
  }
  throw new Error('a pagina do hub nao apareceu');
}

function conecta(url) {
  const ws = new WebSocket(url);
  let seq = 0;
  const pend = new Map(), ctxs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const { ok, ko } = pend.get(m.id); pend.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result); }
    else if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
    else if (m.method === 'Runtime.executionContextDestroyed') { const i = ctxs.findIndex(c => c.id === m.params.executionContextId); if (i >= 0) ctxs.splice(i, 1); }
    else if (m.method === 'Runtime.executionContextsCleared') ctxs.length = 0;
  };
  const send = (method, params = {}) => new Promise((ok, ko) => { const id = ++seq; pend.set(id, { ok, ko }); ws.send(JSON.stringify({ id, method, params })); });
  return new Promise(r => { ws.onopen = () => r({ send, ctxs, ws }); });
}

const page = await alvo();
const c = await conecta(page.webSocketDebuggerUrl);
await c.send('Runtime.enable');
await c.send('Page.enable');
const pronto_hub = Date.now();

// janela maximizada, como a do Rust (o dominio Browser e da conexao do navegador)
try {
  const v = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json();
  const b = await conecta(v.webSocketDebuggerUrl);
  const { windowId } = await b.send('Browser.getWindowForTarget', { targetId: page.id });
  await b.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
  b.ws.close();
} catch (e) { console.log('maximizar:', e.message); }

// abrir a placa: o mesmo pedido que o MCP (vista_abrir) faz ao hub
for (let i = 0; i < 100; i++) {
  try {
    const r = await (await fetch(`http://127.0.0.1:${HUB}/api/mcp/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alvo: 'hub', proj: '*', acao: 'abrir', args: { projeto: PROJ, aba: 'pcb' } }) })).json();
    if (r.ok) break;
  } catch { /* hub subindo */ }
  await dorme(200);
}

// o contexto do iframe da vista PCB (o pcbframe.html sem lean)
const avalia = async (ctxId, expr, espera = false) => {
  const r = await c.send('Runtime.evaluate', { contextId: ctxId, expression: expr, returnByValue: true, awaitPromise: espera });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
// a caixa da placa pelo contorno do board.js -- a mesma conta do Rust (Board::extents)
const board = new Function(readFileSync(BOARD, 'utf8') + ';return pcbmirror;')();
let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
const pt = (x, y) => { if (isFinite(x) && isFinite(y)) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); } };
for (const s of ((board.board && board.board.outline) || [])) {
  if (s.kind === 'arc') { pt(s.cx - s.r, s.cy - s.r); pt(s.cx + s.r, s.cy + s.r); } else { pt(s.x1, s.y1); pt(s.x2, s.y2); }
}
if (!(x1 <= x2)) { const bb = board.board.bbox; x1 = bb.x1; y1 = bb.y1; x2 = bb.x2; y2 = bb.y2; }

// o contexto do iframe da vista PCB: o gancho de teste window.__hubPcb com a placa indexada
const PRONTA = `location.pathname.endsWith('pcbframe.html') && !/lean=1/.test(location.search) && !!window.__hubPcb && __hubPcb.alvos().length > 0 && document.getElementById('cv').clientWidth > 0 ? 1 : 0`;
let ctx = null;
for (let i = 0; i < 1200 && !ctx; i++) {
  for (const k of c.ctxs.filter(k => k.auxData?.isDefault)) {
    try {
      if (await avalia(k.id, PRONTA)) { ctx = k.id; break; }
    } catch { /* outro contexto */ }
  }
  if (!ctx) await dorme(100);
}
if (!ctx) throw new Error('a vista PCB nao carregou a placa');
// espera um quadro desenhado
await avalia(ctx, `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`, true);
const pronto = Date.now();
marca('parado');
const info = await avalia(ctx, `({ alvos: __hubPcb.alvos().length, CW: document.getElementById('cv').clientWidth, CHH: document.getElementById('cv').clientHeight, DPR: devicePixelRatio, url: location.href })`);
console.log('placa na tela', ((pronto - T0) / 1000).toFixed(2), 's', JSON.stringify(info));

// parado: a placa ajustada (a mesma conta do Rust), nada mais pedido
const W = x2 - x1, H = y2 - y1, CX = (x1 + x2) / 2, CY = (y1 + y2) / 2;
await avalia(ctx, `(() => { const cv = document.getElementById('cv');
  const base = Math.max(Math.min(cv.clientWidth / ${Math.max(W, 1)}, cv.clientHeight / ${Math.max(H, 1)}) * 0.92, 0.3);
  __hubPcb.setView(${CX}, ${CY}, base); return base; })()`);
await dorme(IDLE * 1000);

marca('animando');
// cada quadro: a camera da formula (setView agenda o draw() da vista no quadro seguinte)
const res = await avalia(ctx, `new Promise(res => {
  const cv = document.getElementById('cv');
  const w = ${W}, h = ${H}, cx = ${CX}, cy = ${CY};
  const base = Math.max(Math.min(cv.clientWidth / Math.max(w, 1), cv.clientHeight / Math.max(h, 1)) * 0.92, 0.3);
  const fr = [];
  let t0 = null, last = null;
  function passo(now) {
    if (t0 === null) t0 = now;
    const t = (now - t0) / 1000;
    if (last !== null && t > 0.5) fr.push(now - last);
    last = now;
    __hubPcb.setView(cx + w * 0.35 * Math.sin(t * 0.55), cy + h * 0.35 * Math.cos(t * 0.37), base * (1 + 5.5 * (1 - Math.cos(t * 0.9))));
    if (t >= ${SECS}) return res({ fr, area: [cv.clientWidth, cv.clientHeight] });
    requestAnimationFrame(passo);
  }
  requestAnimationFrame(passo);
})`, true);
marca('fim');

const est = v => {
  const s = [...v].sort((a, b) => a - b), n = Math.max(s.length, 1);
  const p = q => s[Math.round((n - 1) * q)] || 0;
  const m = s.reduce((a, b) => a + b, 0) / n;
  return { medio: m, p50: p(0.5), p95: p(0.95), p99: p(0.99), max: s[s.length - 1] || 0 };
};
const q = est(res.fr);
const out = {
  app: 'NexoEletric-electron',
  projeto: PROJ,
  abrir_ms: pronto - T0,
  hub_ms: pronto_hub - T0,
  area_px: res.area,
  segundos: SECS,
  quadros: res.fr.length,
  fps_medio: q.medio > 0 ? 1000 / q.medio : 0,
  quadro_ms: q,
};
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
c.ws.close();
