/* NexoEletric MCP - png.js
   Leitor de PNG em Node sem dependencia (so o zlib do Node): o serigrafia_imagem le o logo do disco
   e o hub-silkgen.js o transforma em region_add. Le IHDR, PLTE, tRNS, os IDAT emendados e o pHYs
   (o tamanho fisico, quando a imagem traz em pixels por metro); desfaz os filtros (None, Sub, Up,
   Average, Paeth); tipos de cor 0 (cinza), 2 (RGB), 3 (paleta), 4 (cinza + alfa) e 6 (RGBA), com 1,
   2, 4, 8 e 16 bits (16 -> o byte alto; a chave de transparencia do tRNS compara o valor inteiro).
   Entrelacado (Adam7) nao: a resposta pede para salvar sem entrelacamento. JPEG, GIF, BMP, WebP,
   TIFF e SVG sao reconhecidos para dizer o que e e pedir PNG.
     decodifica(buf, opts) -> {w, h, rgba: Uint8Array (w*h*4), tipo, bits, paleta, mm_por_px|null}
   opts.maxPixels (padrao 40 milhoes). Erro = ErroPng (mensagem pt-BR para a IA/usuario). */
'use strict';
const zlib = require('node:zlib');

class ErroPng extends Error {}
const ASSINATURA = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CANAIS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const BITS_OK = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

/* o formato pelos primeiros bytes, para a mensagem de erro */
function formato(b) {
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'JPEG';
  if (b.length >= 4 && b.toString('latin1', 0, 4) === 'GIF8') return 'GIF';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4D) return 'BMP';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'WebP';
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2A) || (b[0] === 0x4D && b[1] === 0x4D && b[3] === 0x2A))) return 'TIFF';
  const ini = b.toString('utf8', 0, Math.min(b.length, 256)).trimStart().toLowerCase();
  if (ini.startsWith('<svg') || (ini.startsWith('<?xml') && ini.includes('<svg'))) return 'SVG';
  return '';
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodifica(buf, opts) {
  const o = opts || {};
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(ASSINATURA)) {
    const f = formato(buf);
    throw new ErroPng(f ? `o arquivo é ${f}, não PNG: salve a imagem como PNG (sem entrelaçamento) e chame de novo`
                        : 'o arquivo não é PNG (a assinatura não confere): salve a imagem como PNG e chame de novo');
  }
  let pos = 8, ihdr = null, plte = null, trns = null, phys = null, fim = false;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), tipo = buf.toString('latin1', pos + 4, pos + 8);
    if (pos + 12 + len > buf.length) throw new ErroPng(`PNG truncado (o bloco ${tipo} passa do fim do arquivo)`);
    const d = buf.subarray(pos + 8, pos + 8 + len);
    if (tipo === 'IHDR') {
      if (len < 13) throw new ErroPng('PNG com IHDR curto');
      ihdr = { w: d.readUInt32BE(0), h: d.readUInt32BE(4), bits: d[8], cor: d[9], comp: d[10], filtro: d[11], entrelaca: d[12] };
    } else if (tipo === 'PLTE') plte = d;
    else if (tipo === 'tRNS') trns = d;
    else if (tipo === 'pHYs' && len >= 9) phys = { x: d.readUInt32BE(0), y: d.readUInt32BE(4), unidade: d[8] };
    else if (tipo === 'IDAT') idat.push(d);
    else if (tipo === 'IEND') { fim = true; break; }
    pos += 12 + len;
  }
  if (!ihdr) throw new ErroPng('PNG sem IHDR');
  const { w, h, bits, cor } = ihdr;
  if (!(cor in CANAIS)) throw new ErroPng(`PNG com tipo de cor ${cor} desconhecido`);
  if (!BITS_OK[cor].includes(bits)) throw new ErroPng(`PNG com ${bits} bits no tipo de cor ${cor} (combinação inválida)`);
  if (ihdr.comp !== 0 || ihdr.filtro !== 0) throw new ErroPng('PNG com compressão/filtro fora do padrão');
  if (ihdr.entrelaca === 1) throw new ErroPng('PNG entrelaçado (Adam7): salve a imagem de novo SEM entrelaçamento ("interlaced" desligado) e chame de novo');
  if (!(w > 0 && h > 0)) throw new ErroPng('PNG com largura ou altura zero');
  const maxP = o.maxPixels || 40e6;
  if (w * h > maxP) throw new ErroPng(`imagem de ${w} x ${h} pixels passa do máximo (${maxP / 1e6} milhões de pixels): reduza a resolução`);
  if (!idat.length) throw new ErroPng('PNG sem dados (nenhum IDAT)');
  if (cor === 3 && !plte) throw new ErroPng('PNG de paleta sem PLTE');
  if (!fim) { /* sem IEND: le assim mesmo, o que importa sao os IDAT */ }

  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); }
  catch (e) { throw new ErroPng('PNG com os dados comprimidos corrompidos: ' + (e && e.message || e)); }
  const canais = CANAIS[cor];
  const bpp = Math.max(1, (canais * bits) >> 3);
  const linha = Math.ceil(w * canais * bits / 8);
  if (raw.length < h * (linha + 1)) throw new ErroPng('PNG truncado (faltam linhas de pixels)');

  /* desfaz os filtros, linha a linha, no proprio buffer */
  const px = Buffer.alloc(h * linha);
  let ant = Buffer.alloc(linha);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (linha + 1)];
    const src = raw.subarray(y * (linha + 1) + 1, (y + 1) * (linha + 1));
    const cur = px.subarray(y * linha, (y + 1) * linha);
    for (let i = 0; i < linha; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = ant[i], c = i >= bpp ? ant[i - bpp] : 0;
      let v = src[i];
      switch (ft) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: v += paeth(a, b, c); break;
        default: throw new ErroPng(`PNG com filtro ${ft} desconhecido na linha ${y}`);
      }
      cur[i] = v & 255;
    }
    ant = cur;
  }

  /* amostras -> RGBA */
  const rgba = new Uint8Array(w * h * 4);
  const max = (1 << bits) - 1;
  const amostra = (row, k) => {          /* k-esima amostra da linha, no valor cru da profundidade */
    if (bits === 8) return row[k];
    if (bits === 16) return (row[2 * k] << 8) | row[2 * k + 1];
    const bit = k * bits;
    return (row[bit >> 3] >> (8 - bits - (bit & 7))) & max;
  };
  const oito = v => bits === 16 ? v >> 8 : bits === 8 ? v : Math.round(v * 255 / max);
  const chave = trns && (cor === 0 && trns.length >= 2 ? [trns.readUInt16BE(0)] : cor === 2 && trns.length >= 6 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : null);
  const nPal = plte ? Math.floor(plte.length / 3) : 0;
  for (let y = 0; y < h; y++) {
    const row = px.subarray(y * linha, (y + 1) * linha);
    for (let x = 0; x < w; x++) {
      const o4 = (y * w + x) * 4;
      let r, g, b, a = 255;
      if (cor === 0) {
        const v = amostra(row, x); r = g = b = oito(v);
        if (chave && v === chave[0]) a = 0;
      } else if (cor === 2) {
        const R = amostra(row, 3 * x), G = amostra(row, 3 * x + 1), B = amostra(row, 3 * x + 2);
        r = oito(R); g = oito(G); b = oito(B);
        if (chave && R === chave[0] && G === chave[1] && B === chave[2]) a = 0;
      } else if (cor === 3) {
        const i = amostra(row, x);
        if (i < nPal) { r = plte[3 * i]; g = plte[3 * i + 1]; b = plte[3 * i + 2]; } else r = g = b = 0;
        if (trns && i < trns.length) a = trns[i];
      } else if (cor === 4) {
        r = g = b = oito(amostra(row, 2 * x)); a = oito(amostra(row, 2 * x + 1));
      } else {
        r = oito(amostra(row, 4 * x)); g = oito(amostra(row, 4 * x + 1)); b = oito(amostra(row, 4 * x + 2)); a = oito(amostra(row, 4 * x + 3));
      }
      rgba[o4] = r; rgba[o4 + 1] = g; rgba[o4 + 2] = b; rgba[o4 + 3] = a;
    }
  }
  /* pHYs em pixels por metro -> mm por pixel (so quando o X e o Y concordam) */
  const mm = phys && phys.unidade === 1 && phys.x > 0 && phys.x === phys.y ? 1000 / phys.x : null;
  return { w, h, rgba, tipo: cor, bits, paleta: nPal || undefined, mm_por_px: mm };
}

module.exports = { decodifica, formato, ErroPng };
