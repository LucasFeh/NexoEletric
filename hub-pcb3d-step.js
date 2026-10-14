/* AltiumPCBMirror v2 - hub-pcb3d-step.js
   O leitor de STEP da vista 3D: STEP -> malha (posicoes, normais, indices e as cores das faces),
   lido pelo OpenCascade em WebAssembly (occt-import-js, LGPL-2.1, vendor/occt-import-js/) num Web
   Worker, para a tela nao travar enquanto um conector de 6 MB e triangulado.

   O MESMO arquivo e as duas pontas:
   - na pagina (global HubPcb3dStep) e a fila: cache em IndexedDB pela chave do modelo (o checksum
     que o Altium da ao modelo embutido; sem ele, a URL), um pedido so por chave mesmo que vinte
     componentes usem o mesmo resistor, e um punhado de workers;
   - no worker (new Worker('hub-pcb3d-step.js')) e o leitor: carrega o occt UMA vez (o .wasm vem por
     fetch e entra como wasmBinary - assim o servidor nao precisa saber o MIME do .wasm), le o STEP
     e devolve arrays tipados transferidos (sem copia).

   As URLs (o worker, o .js e o .wasm do occt) saem do endereco deste script, entao o hub funciona
   em qualquer pasta e offline. Node (tests/test-pcb3d.js) usa so converte().

   API (pagina)
     HubPcb3dStep.carrega(url, {chave, sinal}) -> Promise<{malhas, ms, doCache}>
        malhas: [{nome, pos:Float32Array, nor:Float32Array|null, idx:Uint32Array, cor:[r,g,b]|null,
                  faces:[{ini, fim, cor:[r,g,b]|null}]}]   (mm, no referencial do modelo; ini/fim em
                  triangulos, como o brep_faces do occt)
        Erro: Error com mensagem pt-BR que diz O QUE falhou (baixar, ler o STEP, carregar o leitor).
     HubPcb3dStep.converte(resultadoOcct) -> malhas      (puro; o worker e o teste usam)
     HubPcb3dStep.limpaCache() -> Promise
     HubPcb3dStep.config({base, workers, deflexao})      base = a pasta do hub (padrao: a deste script)
     HubPcb3dStep.estado() -> {pendentes, workers, emCache}
*/
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HubPcb3dStep = api;
  if (api.ehWorker) api.iniciaWorker();
})(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

const VERSAO = 1;                         /* muda quando o formato da malha no cache muda */
const BANCO = 'eletrichub-pcb3d', LOJA = 'malhas';
/* deflexao: fracao da caixa do modelo (o padrao do occt e 0,001 da caixa, fino demais para uma
   placa com 300 componentes; 0,003 ainda deixa o pino redondo) e angulo em rad */
let DEFLEXAO = { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.003, angularDeflection: 0.5 };

const ehWorker = typeof importScripts === 'function' && typeof document === 'undefined' && typeof module === 'undefined';

/* -------- puro: o resultado do occt -> malhas com arrays tipados -------- */
function converte(r) {
  if (!r || !r.success) throw new Error('o OpenCascade não leu o STEP (arquivo inválido, vazio ou de outro formato).');
  const out = [];
  for (const m of r.meshes || []) {
    const P = m.attributes && m.attributes.position && m.attributes.position.array;
    const N = m.attributes && m.attributes.normal && m.attributes.normal.array;
    const I = m.index && m.index.array;
    if (!P || !P.length || !I || !I.length) continue;
    const cor = Array.isArray(m.color) && m.color.length >= 3 ? [m.color[0], m.color[1], m.color[2]] : null;
    const faces = [];
    for (const f of m.brep_faces || []) {
      const c = Array.isArray(f.color) && f.color.length >= 3 ? [f.color[0], f.color[1], f.color[2]] : null;
      faces.push({ ini: f.first, fim: f.last, cor: c });
    }
    out.push({
      nome: m.name || '',
      pos: P instanceof Float32Array ? P : Float32Array.from(P),
      nor: N && N.length === P.length ? (N instanceof Float32Array ? N : Float32Array.from(N)) : null,
      idx: I instanceof Uint32Array ? I : Uint32Array.from(I),
      cor, faces,
    });
  }
  if (!out.length) throw new Error('o STEP não tem nenhum sólido com faces (só curvas ou montagem vazia).');
  return out;
}
function transferiveis(malhas) {
  const t = [];
  for (const m of malhas) { t.push(m.pos.buffer, m.idx.buffer); if (m.nor) t.push(m.nor.buffer); }
  return t;
}

/* ================= ponta do worker ================= */
function iniciaWorker() {
  let occt = null;
  const base = String(self.location.href).replace(/[^/]*$/, '');
  async function leitor(vendor) {
    if (occt) return occt;
    const dir = vendor || (base + 'vendor/occt-import-js/');
    try { importScripts(dir + 'occt-import-js.js'); }
    catch (e) { throw new Error('não carregou o leitor de STEP (' + dir + 'occt-import-js.js): ' + (e && e.message || e)); }
    let wasm;
    try {
      const r = await fetch(dir + 'occt-import-js.wasm');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      wasm = await r.arrayBuffer();
    } catch (e) { throw new Error('não baixou o OpenCascade (' + dir + 'occt-import-js.wasm): ' + (e && e.message || e)); }
    /* global occtimportjs */
    occt = await self.occtimportjs({ wasmBinary: wasm, locateFile: p => dir + p });
    return occt;
  }
  self.onmessage = async ev => {
    const q = ev.data || {};
    const t0 = Date.now();
    try {
      const o = await leitor(q.vendor);
      let buf = q.buffer;
      if (!buf) {
        let r;
        try { r = await fetch(q.url); } catch (e) { throw new Error('não baixou o modelo ' + q.url + ': ' + (e && e.message || e)); }
        if (!r.ok) throw new Error('o modelo ' + q.url + ' não está no hub (HTTP ' + r.status + ').');
        buf = await r.arrayBuffer();
      }
      const bytes = new Uint8Array(buf);
      const cab = String.fromCharCode.apply(null, bytes.subarray(0, 64));
      if (!/ISO-10303-21/.test(cab)) throw new Error('o arquivo ' + (q.url || '') + ' não é STEP (não começa com ISO-10303-21).');
      const res = o.ReadStepFile(bytes, q.params || DEFLEXAO);
      const malhas = converte(res);
      self.postMessage({ id: q.id, ok: true, malhas, ms: Date.now() - t0, bytes: bytes.length }, transferiveis(malhas));
    } catch (e) {
      self.postMessage({ id: q.id, ok: false, erro: String(e && e.message || e) });
    }
  };
}

/* ================= ponta da pagina ================= */
let BASE = null;
try {
  if (!ehWorker && typeof document !== 'undefined' && document.currentScript && document.currentScript.src)
    BASE = document.currentScript.src.replace(/[^/]*$/, '');
} catch (_) { /* sem DOM */ }
let MAX_WORKERS = 2;
const workers = [];            /* {w, ocupado} */
const fila = [];               /* {msg, ok, falha} */
const pedidos = new Map();     /* chave -> Promise */
const esperando = new Map();   /* id -> {ok, falha, w} */
let seq = 0;

function base() {
  if (BASE) return BASE;
  if (typeof location !== 'undefined') return String(location.href).replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  return '';
}
function absoluta(u) {
  try { return new URL(u, typeof location !== 'undefined' ? location.href : base()).href; } catch (_) { return u; }
}
function novoWorker() {
  const w = new Worker(base() + 'hub-pcb3d-step.js');
  const reg = { w, ocupado: false };
  w.onmessage = ev => {
    const d = ev.data || {};
    const p = esperando.get(d.id);
    esperando.delete(d.id);
    reg.ocupado = false;
    if (p) { if (d.ok) p.ok(d); else p.falha(new Error(d.erro || 'falha desconhecida no leitor de STEP')); }
    despacha();
  };
  w.onerror = ev => {
    /* erro de carga do proprio worker (script nao achado): falha tudo o que ele tinha */
    ev.preventDefault && ev.preventDefault();
    const msg = 'o leitor de STEP (hub-pcb3d-step.js) não iniciou: ' + (ev.message || 'erro no worker');
    for (const [id, p] of esperando) if (p.w === reg) { esperando.delete(id); p.falha(new Error(msg)); }
    reg.ocupado = false;
    const i = workers.indexOf(reg);
    if (i >= 0) workers.splice(i, 1);
    try { w.terminate(); } catch (_) { /* ja morto */ }
    while (fila.length && !workers.length) { const f = fila.shift(); f.falha(new Error(msg)); }
    despacha();
  };
  workers.push(reg);
  return reg;
}
function despacha() {
  while (fila.length) {
    let reg = workers.find(r => !r.ocupado);
    if (!reg && workers.length < MAX_WORKERS) reg = novoWorker();
    if (!reg) return;
    const f = fila.shift();
    reg.ocupado = true;
    esperando.set(f.msg.id, { ok: f.ok, falha: f.falha, w: reg });
    reg.w.postMessage(f.msg, f.msg.buffer ? [f.msg.buffer] : []);
  }
}
function viaWorker(msg) {
  return new Promise((ok, falha) => { msg.id = ++seq; fila.push({ msg, ok, falha }); despacha(); });
}

/* ---- IndexedDB (tudo opcional: aba anonima ou banco bloqueado = sem cache, e segue) ---- */
let bancoP = null;
function banco() {
  if (bancoP) return bancoP;
  bancoP = new Promise(ok => {
    try {
      if (typeof indexedDB === 'undefined') return ok(null);
      const r = indexedDB.open(BANCO, 1);
      r.onupgradeneeded = () => { try { r.result.createObjectStore(LOJA); } catch (_) { /* ja existe */ } };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ok(null);
      r.onblocked = () => ok(null);
    } catch (_) { ok(null); }
  });
  return bancoP;
}
async function cacheLe(chave) {
  const db = await banco();
  if (!db) return null;
  return new Promise(ok => {
    try {
      const r = db.transaction(LOJA, 'readonly').objectStore(LOJA).get(chave);
      r.onsuccess = () => { const v = r.result; ok(v && v.v === VERSAO ? v : null); };
      r.onerror = () => ok(null);
    } catch (_) { ok(null); }
  });
}
async function cacheGrava(chave, valor) {
  const db = await banco();
  if (!db) return;
  await new Promise(ok => {
    try {
      const tx = db.transaction(LOJA, 'readwrite');
      tx.objectStore(LOJA).put(Object.assign({ v: VERSAO }, valor), chave);
      tx.oncomplete = () => ok(); tx.onerror = () => ok(); tx.onabort = () => ok();
    } catch (_) { ok(); }
  });
}
async function limpaCache() {
  const db = await banco();
  if (!db) return;
  await new Promise(ok => {
    try { const tx = db.transaction(LOJA, 'readwrite'); tx.objectStore(LOJA).clear(); tx.oncomplete = () => ok(); tx.onerror = () => ok(); }
    catch (_) { ok(); }
  });
}

/* carrega(url, {chave, buffer}) - buffer (ArrayBuffer) le um STEP que ja esta na memoria (arquivo
   solto pelo usuario); chave = o checksum do Altium (sem ele, a URL absoluta) */
function carrega(url, opcoes) {
  const o = opcoes || {};
  const abs = url ? absoluta(url) : '';
  const chave = 'step:' + (o.chave || abs);
  if (pedidos.has(chave)) return pedidos.get(chave);
  const p = (async () => {
    const t0 = Date.now();
    const c = await cacheLe(chave);
    if (c && c.malhas) return { malhas: c.malhas, ms: Date.now() - t0, doCache: true };
    if (typeof Worker === 'undefined') throw new Error('este navegador não tem Web Worker: o STEP não pode ser lido.');
    const d = await viaWorker({ url: abs, buffer: o.buffer || null, params: DEFLEXAO, vendor: base() + 'vendor/occt-import-js/' });
    /* grava uma copia: as malhas vao para a cena e o cache e assincrono */
    cacheGrava(chave, { malhas: d.malhas, url: abs, bytes: d.bytes, quando: Date.now() });
    return { malhas: d.malhas, ms: d.ms, doCache: false };
  })();
  pedidos.set(chave, p);
  p.catch(() => pedidos.delete(chave));   /* falhou: a proxima tentativa tenta de novo */
  return p;
}

function config(c) {
  c = c || {};
  if (c.base) BASE = String(c.base).replace(/\/?$/, '/');
  if (c.workers > 0) MAX_WORKERS = Math.min(8, c.workers | 0);
  if (c.deflexao) DEFLEXAO = Object.assign({}, DEFLEXAO, c.deflexao);
}
function estado() {
  return { pendentes: fila.length + esperando.size, workers: workers.length, pedidos: pedidos.size };
}

return { VERSAO, ehWorker, iniciaWorker, converte, carrega, limpaCache, config, estado, get DEFLEXAO() { return DEFLEXAO; } };
});
