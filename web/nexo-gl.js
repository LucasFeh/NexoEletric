/* NexoEletric (Rust) - nexo-gl.js: a placa da vista PCB no WebGL2.
   A malha sai do nucleo Rust (nexo_wasm.wasm, o mesmo nexo_core::scene do app nativo) a partir da
   placa efetiva (EB) que a vista ja calculou, uma vez por mudanca da placa. Cada quadro so muda um
   uniform e emite ~2 chamadas por camada visivel -- o Canvas 2D rasterizava milhares de caminhos
   a cada quadro. Trilhas, serigrafia, texto de traco, arcos, pads redondos, vias e furos sao
   capsulas desenhadas por distancia (nitidas em qualquer zoom); o resto sao triangulos.
   O 2D da vista continua por cima, transparente, com o que e interativo. */
(function () {
'use strict';
const WASM_URL = '/nexo/nexo_wasm.wasm';
let wasm = null, carregando = null;
const avisos = [];

function carrega() {
  if (carregando) return carregando;
  carregando = (async () => {
    const r = await fetch(WASM_URL);
    const { instance } = await WebAssembly.instantiateStreaming(r, {});
    wasm = instance.exports;
    for (const f of avisos.splice(0)) try { f(); } catch (e) {}
  })().catch(e => { console.warn('nexo-gl: WASM nao carregou, a vista segue no Canvas 2D', e); });
  return carregando;
}
carrega();
/* o worker da malha nasce JA (o nexo-gl.js entra no <head> da vista): o WASM compila enquanto os
   outros scripts da vista baixam, e o primeiro pedido de malha nao espera por ele */
let WORKER = null;
try { WORKER = new Worker('/nexo/nexo-gl-worker.js'); } catch (e) { WORKER = null; }

const VS_TRI = `#version 300 es
layout(location=0) in vec2 pos;
layout(location=1) in vec4 cor;
uniform vec4 xf;
out vec4 vCor; out vec2 vMundo;
void main(){ vCor = cor; vMundo = pos; gl_Position = vec4(pos * xf.xy + xf.zw, 0.0, 1.0); }`;
const FS_TRI = `#version 300 es
precision highp float;
in vec4 vCor; in vec2 vMundo; out vec4 o;
void main(){ o = vCor; }`;
// a placa: preta, com a grade so nela (como no Altium), calculada aqui
const FS_PLACA = `#version 300 es
precision highp float;
in vec4 vCor; in vec2 vMundo; out vec4 o;
uniform vec4 px; uniform vec4 g1; uniform vec4 g2;
void main(){
  vec4 c = vCor;
  if (px.y > 0.0) {
    vec2 g = vMundo / px.y;
    vec2 d = abs(fract(g - 0.5) - 0.5) * px.y / px.x;
    vec2 k = abs(round(g) - 10.0 * round(g / 10.0));
    if (d.x < 0.5) c = (k.x < 0.5) ? g2 : g1;
    if (d.y < 0.5) { vec4 cy = (k.y < 0.5) ? g2 : g1; if (d.x >= 0.5 || cy.r > c.r) c = cy; }
  }
  o = c;
}`;
const VS_CAP = `#version 300 es
layout(location=0) in vec2 p0;
layout(location=1) in vec2 p1;
layout(location=2) in float w;
layout(location=3) in vec4 cor;
uniform vec4 xf; uniform vec4 px;
out vec2 vLocal; flat out float vMeio; flat out float vRaio; out vec4 vCor;
const vec2 C[6] = vec2[6](vec2(-1.,-1.), vec2(1.,-1.), vec2(1.,1.), vec2(-1.,-1.), vec2(1.,1.), vec2(-1.,1.));
void main(){
  float p = px.x;
  float r = (w < 0.0) ? -w * p * 0.5 : max(w, p) * 0.5;
  vec2 d = p1 - p0; float len = length(d);
  vec2 dir = len > 1e-7 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float m = r + p;
  vec2 c = C[gl_VertexID];
  float hl = len * 0.5;
  float lx = c.x * (hl + m), ly = c.y * m;
  vec2 mundo = (p0 + p1) * 0.5 + dir * lx + nrm * ly;
  gl_Position = vec4(mundo * xf.xy + xf.zw, 0.0, 1.0);
  vLocal = vec2(lx, ly); vMeio = hl; vRaio = r; vCor = cor;
}`;
const FS_CAP = `#version 300 es
precision highp float;
in vec2 vLocal; flat in float vMeio; flat in float vRaio; in vec4 vCor; out vec4 o;
uniform vec4 px;
void main(){
  vec2 q = vec2(max(abs(vLocal.x) - vMeio, 0.0), vLocal.y);
  float a = clamp(0.5 - (length(q) - vRaio) / px.x, 0.0, 1.0);
  if (a <= 0.0) discard;
  o = vec4(vCor.rgb, vCor.a * a);
}`;

function compila(gl, vs, fs) {
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; for (const n of ['xf', 'px', 'g1', 'g2']) u[n] = gl.getUniformLocation(p, n);
  return { p, u };
}
const corGl = hex => { const h = String(hex || '#000').replace('#', ''); const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [parseInt(f.slice(0, 2), 16) / 255, parseInt(f.slice(2, 4), 16) / 255, parseInt(f.slice(4, 6), 16) / 255, 1]; };

function cria(cv, aoPronto) {
  if (!cv || !cv.parentNode) return null;
  const gc = document.createElement('canvas');
  gc.className = 'nexo-gl';
  gc.style.cssText = 'position:absolute; pointer-events:none; display:block;';
  cv.parentNode.insertBefore(gc, cv);
  const gl = gc.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) { gc.remove(); return null; }
  let pTri, pPlaca, pCap;
  try { pTri = compila(gl, VS_TRI, FS_TRI); pPlaca = compila(gl, VS_TRI, FS_PLACA); pCap = compila(gl, VS_CAP, FS_CAP); }
  catch (e) { console.warn('nexo-gl: shader', e); gc.remove(); return null; }
  const vaoTri = gl.createVertexArray(), vaoCap = gl.createVertexArray();
  const vbuf = gl.createBuffer(), ibuf = gl.createBuffer(), cbuf = gl.createBuffer();
  gl.bindVertexArray(vaoTri);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 12, 8);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
  gl.bindVertexArray(vaoCap);
  gl.bindBuffer(gl.ARRAY_BUFFER, cbuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 8);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 16);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 24, 20);
  for (let i = 0; i < 4; i++) gl.vertexAttribDivisor(i, 1);
  gl.bindVertexArray(null);

  let meta = null, perdido = false;
  gc.addEventListener('webglcontextlost', e => { e.preventDefault(); perdido = true; });
  if (!wasm && aoPronto) avisos.push(aoPronto);

  let quebrado = false;
  function monta(entrada) {
    if (!wasm || perdido || quebrado) return false;
    try { return montaJa(entrada); }
    catch (e) { quebrado = true; console.warn('nexo-gl: a malha falhou, a vista segue no Canvas 2D', e); return false; }
  }
  function montaJa(entrada) {
    const t0 = performance.now();
    const bytes = new TextEncoder().encode(JSON.stringify(entrada));
    const p = wasm.nx_alloc(bytes.length);
    new Uint8Array(wasm.memory.buffer, p, bytes.length).set(bytes);
    // a memoria do WASM cresce durante a montagem: o buffer so e lido DEPOIS da chamada
    const pc = wasm.nx_cena(p, bytes.length);
    const cab = new Uint32Array(wasm.memory.buffer, pc, 9).slice();
    wasm.nx_free(p, bytes.length);
    const mem = wasm.memory.buffer;
    const m = JSON.parse(new TextDecoder().decode(new Uint8Array(mem, cab[7], cab[8])));
    if (!cab[0]) { console.warn('nexo-gl:', m.erro); return false; }
    gl.bindBuffer(gl.ARRAY_BUFFER, vbuf); gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(mem, cab[1], cab[2] * 12), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mem, cab[3], cab[4]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, cbuf); gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(mem, cab[5], cab[6] * 24), gl.STATIC_DRAW);
    meta = m;
    meta.ms = performance.now() - t0;
    return true;
  }

  /* A malha montada FORA da thread da pagina (nexo-gl-worker.js): a vista pede e segue abrindo;
     quando a malha chega, sobe para a GPU e a vista redesenha (aoPronto). Enquanto uma malha nova
     esta a caminho, a anterior continua na tela. Sem Worker: a montagem direta de sempre. */
  let worker = null, seq = 0, pedida = '', atual = '';
  worker = WORKER; WORKER = null;            /* uma vista por pagina: o worker e dela */
  if (!worker) { try { worker = new Worker('/nexo/nexo-gl-worker.js'); } catch (e) { worker = null; } }
  if (worker) {
    worker.onmessage = (e) => {
      const r = e.data;
      if (r.id !== seq) return;               /* chegou uma mais velha que a ultima pedida */
      if (!r.ok) { quebrado = true; console.warn('nexo-gl: a malha falhou, a vista segue no Canvas 2D', r.erro); if (aoPronto) aoPronto(); return; }
      if (perdido) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, vbuf); gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(r.verts), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(r.idx), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, cbuf); gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(r.caps), gl.STATIC_DRAW);
      meta = r.meta; atual = pedida;
      if (aoPronto) aoPronto();
    };
    worker.onerror = (e) => { worker = null; console.warn('nexo-gl: worker', e.message); if (aoPronto) aoPronto(); };
  }
  function pedeMalha(fazEntrada, chave) {
    if (quebrado || perdido) return;
    if (chave === atual && meta) return;
    if (chave === pedida && worker) return;
    pedida = chave;
    if (worker) { seq++; worker.postMessage({ id:seq, entrada:fazEntrada() }); return; }
    if (monta(fazEntrada())) atual = chave;
  }

  function desenha(v) {
    if (!meta || perdido) return false;
    // o canvas do WebGL embaixo do 2D, do mesmo tamanho
    const r = cv.getBoundingClientRect(), pr = cv.parentNode.getBoundingClientRect();
    const st = gc.style, l = (r.left - pr.left) + 'px', t = (r.top - pr.top) + 'px';
    if (st.left !== l) st.left = l; if (st.top !== t) st.top = t;
    if (st.width !== r.width + 'px') st.width = r.width + 'px';
    if (st.height !== r.height + 'px') st.height = r.height + 'px';
    if (gc.width !== v.W) gc.width = v.W; if (gc.height !== v.H) gc.height = v.H;
    if (st.display !== 'block') st.display = 'block';
    gl.viewport(0, 0, v.W, v.H);
    const f = corGl(v.fundo); gl.clearColor(f[0], f[1], f[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // mundo (mm, Y para cima) -> NDC: a mesma conta do transformaMundo() da vista
    const fx = v.flip ? -1 : 1, s = v.scale * v.DPR;
    const sx = 2 * s * fx / v.W, sy = 2 * s / v.H;
    const xf = [sx, sy, -v.cx * sx, -v.cy * sy], px = [1 / s, v.grade || 0, 0, 1];
    const g1 = corGl('#1c1c1c'), g2 = corGl('#303030');
    const usa = (pr2) => { gl.useProgram(pr2.p); gl.uniform4fv(pr2.u.xf, xf); if (pr2.u.px) gl.uniform4fv(pr2.u.px, px);
      if (pr2.u.g1) { gl.uniform4fv(pr2.u.g1, g1); gl.uniform4fv(pr2.u.g2, g2); } };
    const faixa = (fx4, placa) => {
      if (!fx4) return;
      const [t0, t1, c0, c1] = fx4;
      if (t1 > t0) { usa(placa ? pPlaca : pTri); gl.bindVertexArray(vaoTri); gl.drawElements(gl.TRIANGLES, t1 - t0, gl.UNSIGNED_INT, t0 * 4); }
      if (c1 > c0) { usa(pCap); gl.bindVertexArray(vaoCap);
        // instancias a partir de c0: reposiciona os atributos (WebGL2 nao tem baseInstance)
        gl.bindBuffer(gl.ARRAY_BUFFER, cbuf);
        const b = c0 * 24;
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, b); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, b + 8);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, b + 16); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 24, b + 20);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, c1 - c0); }
    };
    faixa(meta.placa, true);
    for (const k of v.ordem) faixa(meta.camadas[k], false);
    faixa(meta.furos, false);
    faixa(meta.contorno, false);
    gl.bindVertexArray(null);
    return true;
  }

  return {
    pronto: () => !!wasm && !perdido && !quebrado,
    usavel: () => !perdido && !quebrado,
    temMalha: () => !!meta && !perdido && !quebrado,
    monta, pedeMalha, desenha,
    esconde() { if (gc.style.display !== 'none') gc.style.display = 'none'; },
    info: () => meta && { triangulos: meta.triangulos, capsulas: meta.capsulas, montar_ms: meta.ms },
  };
}

/* a placa solida do 3D (nexo_core::solido): uma triangulacao das tampas com todos os furos e as
   paredes, em arrays prontos para BufferGeometry. null = sem WASM (quem chama faz do jeito antigo) */
function placa3d(entrada) {
  if (!wasm) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(entrada));
  const p = wasm.nx_alloc(bytes.length);
  new Uint8Array(wasm.memory.buffer, p, bytes.length).set(bytes);
  const pc = wasm.nx_placa3d(p, bytes.length);
  wasm.nx_free(p, bytes.length);
  const mem = wasm.memory.buffer;           // lido DEPOIS da chamada (a memoria pode ter crescido)
  const c = new Uint32Array(mem, pc, 10).slice();
  if (!c[0]) return null;
  return {
    tampaXY: new Float32Array(mem, c[1], c[2] * 2).slice(),
    tampaIdx: new Uint32Array(mem, c[3], c[4]).slice(),
    ladoPos: new Float32Array(mem, c[5], c[6] * 3).slice(),
    ladoNor: new Float32Array(mem, c[7], c[6] * 3).slice(),
    ladoIdx: new Uint32Array(mem, c[8], c[9]).slice(),
  };
}

window.NexoGL = { cria, carrega, placa3d };
})();
