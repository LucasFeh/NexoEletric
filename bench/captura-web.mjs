// Foto da vista PCB num Edge headless (para conferir o WebGL contra o Canvas 2D original).
// Uso: node captura-web.mjs --hub http://127.0.0.1:8250 --projeto NOME --out foto.png [--zoom 4 --x mm --y mm]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const HUB = arg('hub'), PROJ = arg('projeto'), OUT = arg('out'), ZOOM = +arg('zoom', 0), X = arg('x'), Y = arg('y');
const PORTA = 9445;
const dorme = ms => new Promise(r => setTimeout(r, ms));
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', `--remote-debugging-port=${PORTA}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nx-cap-'))}`, '--window-size=1600,1000', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
try {
  let page;
  for (let i = 0; i < 100 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORTA}/json`)).json()).find(x => x.type === 'page'); } catch { } await dorme(100); }
  const ws = new WebSocket(page.webSocketDebuggerUrl); let seq = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}) => new Promise(r => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send('Page.navigate', { url: `${HUB}/` });
  for (let i = 0; i < 300; i++) {
    const r = await fetch(`${HUB}/api/mcp/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alvo: 'hub', proj: '*', acao: 'abrir', args: { projeto: PROJ, aba: 'pcb' } }) }).then(r => r.json()).catch(() => null);
    if (r && r.ok) { const q = await fetch(`${HUB}/api/mcp/resposta/${r.id}?espera=15`).then(r => r.json()).catch(() => null); if (q && q.ok) break; }
    await dorme(100);
  }
  const W = `(() => { for (const f of document.querySelectorAll('iframe')) { try { const w = f.contentWindow; if (/pcbframe\\.html/.test(w.location.href) && !/lean=1/.test(w.location.search) && w.__hubPcb && w.__hubPcb.alvos().length) return w; } catch (e) {} } return null; })()`;
  for (let i = 0; i < 300; i++) { const v = await send('Runtime.evaluate', { expression: `!!${W}`, returnByValue: true }); if (v.result.value) break; await dorme(100); }
  await dorme(2500);
  if (ZOOM) await send('Runtime.evaluate', { expression: `(() => { const w = ${W}; const v = w.__hubPcb.estado().view; w.__hubPcb.setView(${X ?? 'v.cx'}, ${Y ?? 'v.cy'}, v.scale * ${ZOOM}); })()` });
  await dorme(800);
  const img = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT, Buffer.from(img.data, 'base64'));
  console.log('ok', OUT);
  ws.close();
} finally { edge.kill(); }
