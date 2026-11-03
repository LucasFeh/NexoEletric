/* NexoEletric (Rust) - nexo-gl-worker.js: a malha da placa (nucleo Rust em WASM) montada FORA da
   thread da pagina. A vista manda a placa efetiva e o que ja resolveu (cores, regras, textos); volta
   a malha em arrays transferidos (sem copia). Enquanto isso a vista segue abrindo. */
'use strict';
let wasm = null;
const pronto = WebAssembly.instantiateStreaming(fetch('/nexo/nexo_wasm.wasm'), {}).then(r => { wasm = r.instance.exports; });

self.onmessage = async (e) => {
  const { id, entrada } = e.data;
  try {
    await pronto;
    const t0 = performance.now();
    const bytes = new TextEncoder().encode(JSON.stringify(entrada));
    const p = wasm.nx_alloc(bytes.length);
    new Uint8Array(wasm.memory.buffer, p, bytes.length).set(bytes);
    const pc = wasm.nx_cena(p, bytes.length);
    wasm.nx_free(p, bytes.length);
    const mem = wasm.memory.buffer;           // lido DEPOIS da chamada (a memoria pode ter crescido)
    const cab = new Uint32Array(mem, pc, 9).slice();
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(mem, cab[7], cab[8])));
    if (!cab[0]) { self.postMessage({ id, ok: false, erro: meta.erro }); return; }
    const verts = new Uint8Array(mem, cab[1], cab[2] * 12).slice().buffer;
    const idx = new Uint32Array(mem, cab[3], cab[4]).slice().buffer;
    const caps = new Uint8Array(mem, cab[5], cab[6] * 24).slice().buffer;
    meta.ms = performance.now() - t0;
    self.postMessage({ id, ok: true, meta, verts, idx, caps }, [verts, idx, caps]);
  } catch (err) {
    self.postMessage({ id, ok: false, erro: String(err && err.message || err) });
  }
};
