// O mapasDaFace no WASM tem de dar os MESMOS bytes que o laco original do hub-pcb3d-real.js.
import { readFileSync } from 'node:fs';
const wasmPath = process.argv[2];
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
const wasm = instance.exports;
// o laco original (copiado do hub-pcb3d-real.js 1.51.0)
const CLASSES = [
  { de:['#1b6233', '#1d6b34', '#1d5e33'], cor:[0.06, 0.29, 0.15], rough:0.42, metal:0, coat:1, alt:60 },
  { de:['#2c8446'],                       cor:[0.13, 0.42, 0.22], rough:0.38, metal:0, coat:1, alt:150 },
  { de:['#b8a76f', '#c9b98a'],            cor:[0.78, 0.71, 0.52], rough:0.82, metal:0, coat:0, alt:0 },
  { de:['#d9d6cf', '#d7d9de', '#d0d2d4'], cor:null,               rough:0.34, metal:1, coat:0, alt:140, pad:true },
  { de:['#f4f4f4', '#ffffff'],            cor:[0.93, 0.93, 0.90], rough:0.88, metal:0, coat:0, alt:200 },
];
const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function original(src, n, metal) {
  const C = new Uint8ClampedArray(n * 4), O = new Uint8ClampedArray(n * 4), K = new Uint8ClampedArray(n * 4), B = new Uint8ClampedArray(n * 4);
  const pal = []; CLASSES.forEach((k, i) => { for (const d of k.de) pal.push([hexRgb(d), i]); });
  const cache = new Map(); let semente = 1234567;
  const rnd = () => { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente / 0x7fffffff; };
  for (let p = 0; p < n; p++) {
    const j = p * 4, a = src[j + 3];
    if (a < 8) { C[j + 3] = 0; O[j + 3] = 255; K[j + 3] = 255; B[j + 3] = 255; continue; }
    const r = src[j], g = src[j + 1], b = src[j + 2], ch = (r << 16) | (g << 8) | b;
    let ci = cache.get(ch);
    if (ci === undefined) { let best = 1e9; ci = 0; for (const [q, i] of pal) { const d = (q[0] - r) ** 2 + (q[1] - g) ** 2 + (q[2] - b) ** 2; if (d < best) { best = d; ci = i; } } cache.set(ch, ci); }
    const k = CLASSES[ci], cor = k.pad ? metal : k.cor;
    const ru = (rnd() - 0.5) * 0.06;
    C[j] = Math.round(cor[0] * 255); C[j + 1] = Math.round(cor[1] * 255); C[j + 2] = Math.round(cor[2] * 255); C[j + 3] = 255;
    O[j] = 255; O[j + 1] = Math.max(0, Math.min(255, Math.round((k.rough + ru) * 255))); O[j + 2] = k.metal * 255; O[j + 3] = 255;
    K[j] = K[j + 1] = K[j + 2] = k.coat * 255; K[j + 3] = 255;
    B[j] = B[j + 1] = B[j + 2] = Math.max(0, Math.min(255, k.alt + Math.round((rnd() - 0.5) * 10))); B[j + 3] = 255;
  }
  return [C, O, K, B];
}
// uma "face" de teste: as cores da paleta, cores perto delas, antialias e transparencia
const n = 3_000_000, src = new Uint8ClampedArray(n * 4);
let s = 7; const r = () => (s = (s * 48271) % 2147483647) / 2147483647;
const cores = ['#1b6233', '#2c8446', '#b8a76f', '#d9d6cf', '#ffffff', '#123456', '#808080'].map(hexRgb);
for (let p = 0; p < n; p++) { const c = cores[(r() * cores.length) | 0]; src[p * 4] = c[0] + ((r() * 9) | 0) - 4; src[p * 4 + 1] = c[1]; src[p * 4 + 2] = c[2]; src[p * 4 + 3] = r() < 0.1 ? 3 : 255; }
const metal = [0.80, 0.81, 0.83];
const t0 = performance.now(); const A = original(src, n, metal); const tJs = performance.now() - t0;
// o caminho do WASM, igual ao NexoGL.mapasFace
const FAIXA = 1 << 20, Bs = [new Uint8ClampedArray(n * 4), new Uint8ClampedArray(n * 4), new Uint8ClampedArray(n * 4), new Uint8ClampedArray(n * 4)];
const t1 = performance.now();
wasm.nx_mapas_ini(metal[0], metal[1], metal[2]);
const p = wasm.nx_alloc(FAIXA * 4);
for (let ini = 0; ini < n; ini += FAIXA) {
  const q = Math.min(FAIXA, n - ini);
  new Uint8Array(wasm.memory.buffer, p, q * 4).set(src.subarray(ini * 4, (ini + q) * 4));
  const pc = wasm.nx_mapas_faixa(p, q); const c = new Uint32Array(wasm.memory.buffer, pc, 4);
  for (let k = 0; k < 4; k++) Bs[k].set(new Uint8Array(wasm.memory.buffer, c[k], q * 4), ini * 4);
}
const tRs = performance.now() - t1;
let dif = 0; for (let k = 0; k < 4; k++) for (let i = 0; i < n * 4; i++) if (A[k][i] !== Bs[k][i]) dif++;
console.log(JSON.stringify({ pixels: n, bytes_diferentes: dif, js_ms: +tJs.toFixed(0), wasm_ms: +tRs.toFixed(0) }));
process.exit(dif ? 1 : 0);
