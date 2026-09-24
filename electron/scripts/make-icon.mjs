// Gera assets/icon.png (256 px) e assets/icon.ico (16..256 px) sem dependencia nenhuma:
// o desenho e um punhado de retangulos arredondados avaliados por pixel, com
// supersampling 4x4 para a borda sair suave, e o PNG e montado a mao (zlib do Node).
// Um chip visto de cima, nas cores do tema padrao do hub (Grafite escuro).
//
// Uso: node scripts/make-icon.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', 'assets');

const FUNDO = [26, 26, 29];        // --surface
const BORDA = [58, 58, 64];
const CHIP = [216, 216, 221];      // --hi
const PINO = [168, 168, 174];      // --text-2
const MARCA = [75, 191, 123];      // --ok: o pino 1

// distancia assinada de um retangulo arredondado centrado em (cx,cy), meia-largura hw/hh
function rrect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Cor do ponto (x,y) em [0,1]^2, ou null (transparente). Ordem = camadas de baixo para cima.
function cor(x, y) {
  let c = null;
  if (rrect(x, y, 0.5, 0.5, 0.48, 0.48, 0.2) <= 0) c = BORDA;
  if (rrect(x, y, 0.5, 0.5, 0.465, 0.465, 0.19) <= 0) c = FUNDO;
  // pinos: 4 por lado
  const pinos = [0.335, 0.445, 0.555, 0.665];
  for (const p of pinos) {
    if (rrect(x, y, p, 0.17, 0.028, 0.07, 0.012) <= 0) c = PINO;
    if (rrect(x, y, p, 0.83, 0.028, 0.07, 0.012) <= 0) c = PINO;
    if (rrect(x, y, 0.17, p, 0.07, 0.028, 0.012) <= 0) c = PINO;
    if (rrect(x, y, 0.83, p, 0.07, 0.028, 0.012) <= 0) c = PINO;
  }
  if (rrect(x, y, 0.5, 0.5, 0.25, 0.25, 0.045) <= 0) c = CHIP;
  if (Math.hypot(x - 0.35, y - 0.35) <= 0.045) c = MARCA;
  return c;
}

function rasteriza(n) {
  const S = n <= 32 ? 8 : 4;     // mais amostras nos tamanhos pequenos
  const px = Buffer.alloc(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < S; sj++) {
        for (let si = 0; si < S; si++) {
          const c = cor((i + (si + 0.5) / S) / n, (j + (sj + 0.5) / S) / n);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const k = (j * n + i) * 4;
      if (a) {
        px[k] = Math.round(r / a); px[k + 1] = Math.round(g / a); px[k + 2] = Math.round(b / a);
        px[k + 3] = Math.round((255 * a) / (S * S));
      }
    }
  }
  return px;
}

function png(n, rgba) {
  const linhas = Buffer.alloc((n * 4 + 1) * n);
  for (let j = 0; j < n; j++) {
    linhas[j * (n * 4 + 1)] = 0;                       // filtro None
    rgba.copy(linhas, j * (n * 4 + 1) + 1, j * n * 4, (j + 1) * n * 4);
  }
  const chunk = (tipo, dado) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(dado.length);
    const td = Buffer.concat([Buffer.from(tipo, 'ascii'), dado]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(linhas, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ICO com as imagens em PNG (aceito pelo Windows desde o Vista, e pelo electron-builder).
function ico(imagens) {
  const cab = Buffer.alloc(6);
  cab.writeUInt16LE(0, 0); cab.writeUInt16LE(1, 2); cab.writeUInt16LE(imagens.length, 4);
  const dir = Buffer.alloc(16 * imagens.length);
  let off = 6 + dir.length;
  imagens.forEach(({ n, buf }, k) => {
    const e = k * 16;
    dir[e] = n >= 256 ? 0 : n; dir[e + 1] = n >= 256 ? 0 : n;
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(buf.length, e + 8); dir.writeUInt32LE(off, e + 12);
    off += buf.length;
  });
  return Buffer.concat([cab, dir, ...imagens.map((i) => i.buf)]);
}

fs.mkdirSync(OUT, { recursive: true });
const tamanhos = [16, 24, 32, 48, 64, 128, 256];
const imagens = tamanhos.map((n) => ({ n, buf: png(n, rasteriza(n)) }));
fs.writeFileSync(path.join(OUT, 'icon.png'), imagens[imagens.length - 1].buf);
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico(imagens));
console.log('assets/icon.png e assets/icon.ico gerados:', tamanhos.join(', '), 'px');
