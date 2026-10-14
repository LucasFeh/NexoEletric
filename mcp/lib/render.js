/* EletricHUB MCP - render.js
   Uma imagem PNG da placa EFETIVA, desenhada aqui mesmo em Node (sem canvas, sem dependencia):
   e o "screenshot" que sempre funciona, com ou sem o hub aberto. Rasteriza poligonos (pad,
   trilha como capsula, via, fill, regiao com furos, texto pela geometria do Gerber) nas cores
   das camadas do Altium (HubCore.PCB_LAYERS / board.layers), com transparencia no cobre para
   se ver a sobreposicao. Nao e a vista do hub: e o suficiente para a IA conferir onde as coisas
   ficaram. A tela de verdade vem do vista_screenshot. */
'use strict';
const zlib = require('node:zlib');
const { poligonoPad, pontosArco } = require('./geometria.js');

const isNum = v => typeof v === 'number' && isFinite(v);

/* ---------------- PNG ---------------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function bloco(tipo, dados) {
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
  const td = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}
function png(W, H, rgba) {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 6; ih[10] = 0; ih[11] = 0; ih[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ih), bloco('IDAT', zlib.deflateSync(raw, { level: 6 })), bloco('IEND', Buffer.alloc(0))]);
}

/* ---------------- tela ---------------- */
class Tela {
  constructor(W, H, fundo) {
    this.W = W; this.H = H; this.px = Buffer.alloc(W * H * 4);
    const [r, g, b] = fundo; for (let i = 0; i < W * H; i++) { this.px[i * 4] = r; this.px[i * 4 + 1] = g; this.px[i * 4 + 2] = b; this.px[i * 4 + 3] = 255; }
  }
  /* aneis em pixels, regra par-impar (furos = aneis internos) */
  poligono(aneis, cor, alfa) {
    const W = this.W, H = this.H;
    let y0 = Infinity, y1 = -Infinity;
    for (const A of aneis) for (const p of A) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(H - 1, Math.ceil(y1));
    const [r, g, b] = cor, a = alfa == null ? 1 : alfa;
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5, xs = [];
      for (const A of aneis) for (let i = 0, j = A.length - 1; i < A.length; j = i++) {
        const p = A[i], q = A[j];
        if ((p[1] > yc) !== (q[1] > yc)) xs.push(p[0] + (yc - p[1]) * (q[0] - p[0]) / (q[1] - p[1]));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.round(xs[k])), xb = Math.min(W - 1, Math.round(xs[k + 1]) - 1);
        for (let x = xa; x <= xb; x++) {
          const o = (y * W + x) * 4;
          this.px[o] = this.px[o] * (1 - a) + r * a; this.px[o + 1] = this.px[o + 1] * (1 - a) + g * a; this.px[o + 2] = this.px[o + 2] * (1 - a) + b * a;
        }
      }
    }
  }
}
const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); const n = m ? parseInt(m[1], 16) : 0x888888; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

function capsula(x1, y1, x2, y2, w, n) {
  const r = Math.max(w / 2, 1e-4), a = Math.atan2(y2 - y1, x2 - x1), k = n || 6, P = [];
  for (let i = 0; i <= k; i++) { const t = a + Math.PI / 2 + i * Math.PI / k; P.push([x2 + r * Math.cos(t - Math.PI), y2 + r * Math.sin(t - Math.PI)]); }
  for (let i = 0; i <= k; i++) { const t = a + Math.PI / 2 + i * Math.PI / k; P.push([x1 + r * Math.cos(t), y1 + r * Math.sin(t)]); }
  return P;
}
function circulo(cx, cy, r, n) { const P = [], k = n || 20; for (let i = 0; i < k; i++) { const t = i * 2 * Math.PI / k; P.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); } return P; }

/* Desenha. opts: {largura (px), lado:'top'|'bottom', caixa:{x1..y2}, camadas:[...], net (destaque),
   rats:[{x1,y1,x2,y2}], marcas:[{x,y,rotulo}]} */
function desenha(hc, eb, opts) {
  const o = opts || {};
  const bb = (eb.board && eb.board.bbox) || null;
  let cx = o.caixa || bb;
  if (!cx || ![cx.x1, cx.y1, cx.x2, cx.y2].every(isNum)) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const c of eb.components || []) if (c.bbox) { x1 = Math.min(x1, c.bbox.x1); y1 = Math.min(y1, c.bbox.y1); x2 = Math.max(x2, c.bbox.x2); y2 = Math.max(y2, c.bbox.y2); }
    cx = isFinite(x1) ? { x1, y1, x2, y2 } : { x1: 0, y1: 0, x2: 50, y2: 50 };
  }
  const m = Math.max(0.5, 0.03 * Math.max(cx.x2 - cx.x1, cx.y2 - cx.y1));
  const X1 = Math.min(cx.x1, cx.x2) - m, X2 = Math.max(cx.x1, cx.x2) + m, Y1 = Math.min(cx.y1, cx.y2) - m, Y2 = Math.max(cx.y1, cx.y2) + m;
  const W = Math.max(200, Math.min(2400, o.largura || 1000));
  const esc = W / (X2 - X1), H = Math.max(100, Math.min(2400, Math.round((Y2 - Y1) * esc)));
  const baixo = o.lado === 'bottom';
  const P = ([x, y]) => [baixo ? (X2 - x) * esc : (x - X1) * esc, (Y2 - y) * esc];
  const T = new Tela(W, H, [16, 20, 26]);
  const cores = {};
  for (const l of hc.boardLayers(eb)) cores[l.key] = hex(l.color);
  for (const l of hc.PCB_LAYERS) if (!cores[l.key]) cores[l.key] = hex(l.color);
  const quer = k => !o.camadas || !o.camadas.length || o.camadas.includes(k);
  const netOk = n => !o.net || n === o.net;
  const alfaNet = n => o.net ? (n === o.net ? 1 : 0.18) : 0.85;
  const poli = (aneis, k, a) => { if (quer(k)) T.poligono(aneis.map(A => A.map(P)), cores[k] || [136, 136, 136], a); };

  /* a pilha: o lado de longe primeiro */
  const cobre = hc.boardLayers(eb).filter(l => l.kind === 'signal' || l.kind === 'plane').map(l => l.key);
  const ordemCobre = baixo ? cobre.slice().reverse().filter(k => k !== 'Bottom').concat(['Bottom']) : cobre.filter(k => k !== 'Top').concat(['Top']);
  const ladoOver = baixo ? 'BottomOverlay' : 'TopOverlay';
  const mech = hc.boardLayers(eb).filter(l => l.kind === 'mech' || l.kind === 'keepout').map(l => l.key);
  const ordem = mech.concat(ordemCobre, [ladoOver]);
  if (o.camadas) for (const k of o.camadas) if (!ordem.includes(k)) ordem.push(k);

  const texto = t => {
    let g = null;
    try { g = o.textoGeo ? o.textoGeo(t) : null; } catch (_) { g = null; }
    if (!g) return;
    if (g.regioes) poli(g.regioes.map(r => r.pts), t.layer, 0.9);
    if (g.tracos) for (const tr of g.tracos) for (let i = 1; i < tr.length; i++) poli([capsula(tr[i - 1][0], tr[i - 1][1], tr[i][0], tr[i][1], g.w || 0.15, 3)], t.layer, 0.9);
  };
  for (const k of ordem) {
    const a = l => hc.isCopper(k) ? alfaNet(l) : 0.9;
    for (const f of eb.fills || []) if (f && f.layer === k) poli([[[f.x1, f.y1], [f.x2, f.y1], [f.x2, f.y2], [f.x1, f.y2]]], k, a(f.net));
    for (const g of eb.regions || []) if (g && g.layer === k && Array.isArray(g.points)) poli([g.points].concat(g.holes || []), k, a(g.net));
    for (const t of eb.tracks || []) if (t && t.layer === k) poli([capsula(t.x1, t.y1, t.x2, t.y2, t.w || 0.1)], k, a(t.net));
    for (const s of [].concat(eb.silk || [], eb.lines || [])) if (s && s.layer === k) {
      if (s.kind === 'arc') { const Q = pontosArco(s, 10); for (let i = 1; i < Q.length; i++) poli([capsula(Q[i - 1][0], Q[i - 1][1], Q[i][0], Q[i][1], s.w || 0.1, 3)], k, 0.9); }
      else if ([s.x1, s.y1, s.x2, s.y2].every(isNum)) poli([capsula(s.x1, s.y1, s.x2, s.y2, s.w || 0.1, 3)], k, 0.9);
    }
    for (const r of eb.arcs || []) if (r && r.layer === k) { const Q = pontosArco(r, 8); for (let i = 1; i < Q.length; i++) poli([capsula(Q[i - 1][0], Q[i - 1][1], Q[i][0], Q[i][1], r.w || 0.1, 3)], k, a(r.net)); }
    for (const t of eb.texts || []) if (t && t.layer === k && !t.hidden) texto(t);
    /* pads SMD da camada */
    for (const c of eb.components || []) for (const p of (c.pads || [])) if (p && p.type !== 'th' && p.layer === k) poli([poligonoPad(p)], k, a(p.net));
    for (const p of eb.freepads || []) if (p && p.type !== 'th' && p.layer === k) poli([poligonoPad(p)], k, a(p.net));
  }
  /* Multi: pads passantes e vias, com o furo */
  const multi = [192, 192, 192];
  const furo = [8, 10, 14];
  const passa = p => p && (p.type === 'th' || p.layer === 'Multi');
  const pads = [].concat(...(eb.components || []).map(c => c.pads || []), eb.freepads || []).filter(passa);
  for (const p of pads) { if (!o.camadas || quer('Multi')) T.poligono([poligonoPad(p).map(P)], o.net && p.net !== o.net ? [70, 70, 70] : multi, 0.95); }
  for (const v of eb.vias || []) if (v && (!o.camadas || quer('Multi'))) T.poligono([circulo(v.x, v.y, (v.size || 0.6) / 2).map(P)], o.net && v.net !== o.net ? [70, 70, 70] : [200, 170, 60], 0.95);
  for (const p of pads) if (isNum(p.drill) && p.drill > 0) T.poligono([circulo(p.x + (p.hox || 0), p.y + (p.hoy || 0), p.drill / 2, 14).map(P)], furo, 1);
  for (const v of eb.vias || []) if (v && isNum(v.drill)) T.poligono([circulo(v.x, v.y, v.drill / 2, 12).map(P)], furo, 1);
  /* contorno da placa e recortes */
  const out = [];
  for (const s of (eb.board && eb.board.outline) || []) {
    if (s.kind === 'arc') { const Q = pontosArco(s, 6); for (let i = 1; i < Q.length; i++) out.push([Q[i - 1], Q[i]]); }
    else if ([s.x1, s.y1, s.x2, s.y2].every(isNum)) out.push([[s.x1, s.y1], [s.x2, s.y2]]);
  }
  const lw = Math.max(0.15, 1.5 / esc);
  for (const [p, q] of out) T.poligono([capsula(p[0], p[1], q[0], q[1], lw, 2).map(P)], [230, 230, 230], 0.9);
  for (const k of eb.cutouts || []) if (k && Array.isArray(k.points) && k.points.length > 2 && k.kindn !== -1 && k.kindn !== 1) {
    const Q = k.points; for (let i = 0; i < Q.length; i++) { const p = Q[i], q = Q[(i + 1) % Q.length]; T.poligono([capsula(p[0], p[1], q[0], q[1], lw, 2).map(P)], [230, 230, 230], 0.9); }
  }
  for (const r of o.rats || []) T.poligono([capsula(r.x1, r.y1, r.x2, r.y2, Math.max(0.05, 1 / esc), 2).map(P)], [255, 240, 120], 1);
  for (const mk of o.marcas || []) T.poligono([circulo(mk.x, mk.y, Math.max(0.3, 5 / esc), 12).map(P)], [255, 60, 200], 0.8);
  return { png: png(W, H, T.px), largura: W, altura: H, mm_por_px: Math.round(1e5 / esc) / 1e5, janela: { x1: X1, y1: Y1, x2: X2, y2: Y2 }, lado: baixo ? 'bottom' : 'top' };
}

module.exports = { desenha, png, crc32 };
