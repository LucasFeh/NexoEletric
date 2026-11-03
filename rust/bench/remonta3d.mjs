// Quantas vezes a cena 3D e remontada (vista.cena) com o 3D aberto e parado, e por que (a revisao da
// biblioteca da rede Nexo). Uso: node remonta3d.mjs --cdp 9335 --projeto P --segundos 60
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const CDP = +arg('cdp', 9335), PROJ = arg('projeto'), SEG = +arg('segundos', 60);
const dorme = ms => new Promise(r => setTimeout(r, ms));
let page;
for (let i = 0; i < 300 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).find(x => x.type === 'page' && x.url.startsWith('http://127.0.0.1')); } catch { } if (!page) await dorme(100); }
const ws = new WebSocket(page.webSocketDebuggerUrl); let seq = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); }).then(m => m.result);
const ev = async (e, a = false) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: a }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const W = `(() => { for (const f of document.querySelectorAll('iframe')) { try { const w = f.contentWindow; if (/pcbframe\.html/.test(w.location.href) && !/lean=1/.test(w.location.search) && new URLSearchParams(w.location.search).get('p') === ${JSON.stringify(PROJ)} && w.__hubPcb && w.__hubPcb.alvos().length) return w; } catch (e) {} } return null; })()`;
for (let i = 0; i < 600; i++) { if (await ev(`!!${W}`)) break; await dorme(100); }
await dorme(2000);
await ev(`(() => { const w = ${W}; w.__ev = [];
  const H = w.HubPcb3dVista, cria = H.cria;
  H.cria = async function (...a) { const v = await cria.apply(this, a); const c = v.cena, k = v.corpos;
    v.cena = function (...b) { w.__ev.push(['cena', Math.round(performance.now()), w.HubNexo && w.HubNexo.indice() ? w.HubNexo.indice().revisao : null]); return c.apply(this, b); };
    v.corpos = function (...b) { w.__ev.push(['corpos', Math.round(performance.now())]); return k.apply(this, b); };
    w.__V = v; return v; };
  w.__t0 = performance.now(); w.__hubPcb.fazAcao('vista3d'); return 1; })()`);
await dorme(SEG * 1000);
const r = await ev(`(() => { const w = ${W}; return w.__ev.map(e => [e[0], e[1] - Math.round(w.__t0), e[2]]); })()`);
console.log(JSON.stringify({ segundos: SEG, eventos: r }));
ws.close(); process.exit(0);
