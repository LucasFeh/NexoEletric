/* AltiumPCBMirror v2 - hub-pdfwriter.js
   Escritor de PDF vetorial proprio do hub, sem biblioteca: o hub roda offline (o servidor .192 e o
   EletricHUB) e o PDF de layout tem que sair dele como o Gerber sai do hub-gerber.js.

   Logica pura, sem DOM: navegador (global HubPdfWriter) e node (tests/test-pcbpdf.js).

   O que escreve (PDF 1.4, o que qualquer leitor abre):
   - paginas de qualquer tamanho (A4/A3 paisagem pelo FOLHAS), coordenadas em MM com a origem no
     canto INFERIOR esquerdo e Y para cima - a mesma conta da placa (board.js) e do Draftsman;
   - caminhos: reta, arco (Bezier cubica em fatias de ate 90 graus, erro < 0,03% do raio),
     retangulo, circulo, poligono; traco, preenchimento (nao-zero ou par-impar: poligono com
     furos sai certo com evenodd) e recorte; cor RGB, espessura, ponta/junta redonda; q/Q e cm;
   - texto nas fontes padrao do PDF (Helvetica, Helvetica-Bold, Times-Roman), com WinAnsiEncoding:
     os acentos do pt-BR (a tabela Latin-1 inteira) e as aspas/travessao/euro de 0x80-0x9F. As
     larguras sao as do AFM da Adobe, para alinhar a direita/centro sem a fonte embutida;
   - imagens: JPEG cru (DCTDecode, o que o canvas.toDataURL('image/jpeg') da), RGB cru (comprimido
     na saida) com mascara alfa opcional (SMask), ou um stream ja comprimido (o logo do carimbo
     vem assim do tools/draftsman/carimbo.py);
   - compressao Flate dos streams: no node o zlib (sincrono); no navegador o CompressionStream
     ('deflate' = zlib, o que o FlateDecode quer), so na saida assincrona. Sem nenhum dos dois, sai
     sem compressao - o arquivo e maior, mas e o mesmo PDF.

   API
     const doc = HubPdfWriter.novo({ titulo, autor, assunto, criador })
     const pg  = doc.pagina(wMm, hMm)            pagina nova (o fim da lista)
       pg.corTraco('#rrggbb') pg.corFundo('#rrggbb') pg.espessura(mm) pg.pontas('redonda'|'reta')
       pg.salva() pg.restaura() pg.matriz(a,b,c,d,e,f)
       pg.move(x,y) pg.reta(x,y) pg.curva(x1,y1,x2,y2,x,y) pg.fecha()
       pg.arco(cx,cy,r,graus0,graus1, horario, novo)  continua o caminho com uma reta ate o inicio
                                                (novo, ou sem caminho aberto: comeca um subcaminho)
       pg.retangulo(x,y,w,h) pg.circulo(cx,cy,r) pg.poligono(pts) pg.polilinha(pts)
       pg.traca() pg.preenche(parImpar) pg.preencheTraca(parImpar) pg.recorta(parImpar)
       pg.texto(x,y,s,{fonte, tam(mm), cor, alinha:'esq'|'centro'|'dir', base:'base'|'meio'|'topo'|'baixo', rot(graus)})
       pg.imagem(nome, x, y, w, h)
     doc.imagem({ jpeg, w, h } | { rgb, w, h, alfa? } | { flate, w, h, alfaFlate? }) -> nome
     doc.bytes({ deflate })  -> Uint8Array   deflate: (Uint8Array) -> Uint8Array; omitido = zlib no node
     doc.bytesAsync()        -> Promise<Uint8Array>  (CompressionStream no navegador)
     HubPdfWriter.larguraTexto(s, fonte, tam) -> mm
     HubPdfWriter.FOLHAS = { A4:{w:297,h:210}, A3:{w:420,h:297} }   (paisagem)
     HubPdfWriter.le(bytes) -> {versao, objetos, raiz, paginas, xrefOk, erros}  leitor minimo, para os
       testes conferirem xref/trailer sem biblioteca */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.HubPdfWriter = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
"use strict";

const PT = 72 / 25.4;               /* pontos por mm: a pagina e escrita em mm com um cm na frente */
const FOLHAS = Object.freeze({ A4: Object.freeze({ w: 297, h: 210 }), A3: Object.freeze({ w: 420, h: 297 }) });

/* ============================== fontes padrao ============================== */

/* larguras (1/1000 em) do AFM da Adobe, ASCII 32..126; o Latin-1 acentuado cai na letra base
   (no AFM, Aacute = A, ccedilla = c...), e o resto tem tabela propria abaixo */
const AFM = {
  'Helvetica': [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584],
  'Helvetica-Bold': [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584],
  'Times-Roman': [250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541],
};
/* simbolos do Latin-1/WinAnsi que nao tem letra base (Helvetica / Times; a Bold usa a da Helvetica) */
const AFM_EXTRA = {
  '°': [400, 400], 'º': [365, 310], 'ª': [370, 276], '±': [584, 564], '²': [333, 300],
  '³': [333, 300], '¹': [333, 300], 'µ': [556, 500], '×': [584, 564], '÷': [584, 564],
  '§': [556, 500], '©': [737, 760], '®': [737, 760], '«': [556, 500], '»': [556, 500],
  ' ': [278, 250], '½': [834, 750], '¼': [834, 750], '¾': [834, 750], '·': [278, 250],
  'ß': [611, 500], 'æ': [889, 667], 'Æ': [1000, 889], 'ø': [611, 500], 'Ø': [778, 722],
  '€': [556, 500], '–': [556, 500], '—': [1000, 1000], '‘': [222, 333], '’': [222, 333],
  '“': [333, 444], '”': [333, 444], '•': [350, 350], '…': [1000, 1000], '¿': [611, 444],
  '¡': [333, 333], '£': [556, 500], '¢': [556, 500], '¥': [556, 500], '¬': [584, 564],
};
/* WinAnsi 0x80-0x9F (o resto do Latin-1 e o proprio codigo) */
const WIN_ALTO = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86,
  '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
const NOMES_FONTE = { 'Helvetica': 'F1', 'Helvetica-Bold': 'F2', 'Times-Roman': 'F3' };

function fonteValida(f) { return Object.prototype.hasOwnProperty.call(NOMES_FONTE, f) ? f : 'Helvetica'; }
/* o codigo WinAnsi do caractere; fora da tabela, a letra base (NFD) ou '?' */
function codigoWin(c) {
  const u = c.codePointAt(0);
  if (u >= 32 && u <= 126) return u;
  if (u >= 0xa0 && u <= 0xff) return u;
  if (WIN_ALTO[c]) return WIN_ALTO[c];
  if (c === '\t') return 32;
  const b = c.normalize ? c.normalize('NFD')[0] : c;
  if (b && b !== c) return codigoWin(b);
  return 63;
}
function larguraCaractere(c, fonte) {
  const tab = AFM[fonte] || AFM.Helvetica, times = fonte === 'Times-Roman';
  const u = c.codePointAt(0);
  if (u >= 32 && u <= 126) return tab[u - 32];
  if (AFM_EXTRA[c]) return AFM_EXTRA[c][times ? 1 : 0];
  const b = c.normalize ? c.normalize('NFD')[0] : c;
  if (b && b !== c && b.codePointAt(0) >= 32 && b.codePointAt(0) <= 126) return tab[b.codePointAt(0) - 32];
  return tab['?'.charCodeAt(0) - 32];
}
/* largura do texto em mm, no tamanho tam (mm de corpo) */
function larguraTexto(s, fonte, tam) {
  fonte = fonteValida(fonte);
  let w = 0;
  for (const c of String(s == null ? '' : s)) w += larguraCaractere(c, fonte);
  return w / 1000 * tam;
}
/* a string do PDF entre parenteses, ja em WinAnsi: o que nao e ASCII imprimivel sai em octal */
function stringPdf(s) {
  let out = '(';
  for (const c of String(s == null ? '' : s)) {
    const k = codigoWin(c);
    if (k === 40 || k === 41 || k === 92) out += '\\' + String.fromCharCode(k);
    else if (k < 32 || k > 126) out += '\\' + ('00' + k.toString(8)).slice(-3);
    else out += String.fromCharCode(k);
  }
  return out + ')';
}

/* ============================== numeros e cores ============================== */

/* numero curto: 4 casas (0,1 um em mm), sem zeros a direita, nunca expoente */
function n(v) {
  if (!isFinite(v)) return '0';
  const s = (Math.round(v * 1e4) / 1e4).toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}
function rgb(cor) {
  let m = /^#?([0-9a-f]{6})$/i.exec(String(cor || ''));
  if (m) { const v = parseInt(m[1], 16); return [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; }
  m = /^#?([0-9a-f]{3})$/i.exec(String(cor || ''));
  if (m) return m[1].split('').map(h => parseInt(h + h, 16) / 255);
  if (Array.isArray(cor) && cor.length >= 3) return cor.slice(0, 3).map(v => Math.max(0, Math.min(1, +v || 0)));
  return [0, 0, 0];
}
function corOps(cor, op) { const c = rgb(cor); return n(c[0]) + ' ' + n(c[1]) + ' ' + n(c[2]) + ' ' + op; }

/* ============================== bytes ============================== */

function bytesAscii(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
  return b;
}
function junta(partes) {
  let t = 0;
  for (const p of partes) t += p.length;
  const out = new Uint8Array(t);
  let o = 0;
  for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}
function zlibNode() {
  try {
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      const z = require('zlib');
      return b => new Uint8Array(z.deflateSync(b, { level: 9 }));
    }
  } catch (_) { /* sem zlib: sem compressao */ }
  return null;
}
async function deflateNavegador(b) {
  const CS = root && root.CompressionStream;
  if (typeof CS !== 'function') return null;
  const s = new Blob([b]).stream().pipeThrough(new CS('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/* ============================== pagina ============================== */

/* angulos de arco em fatias de ate 90 graus; cada fatia e uma cubica com k = 4/3 tan(t/4) */
function fatiasArco(cx, cy, r, a0, a1, horario) {
  const RAD = Math.PI / 180;
  let ini = a0 * RAD, fim = a1 * RAD;
  if (horario) { while (fim >= ini) fim -= 2 * Math.PI; } else { while (fim <= ini) fim += 2 * Math.PI; }
  const varre = fim - ini, nf = Math.max(1, Math.ceil(Math.abs(varre) / (Math.PI / 2) - 1e-9));
  const d = varre / nf, k = 4 / 3 * Math.tan(d / 4), out = [];
  for (let i = 0; i < nf; i++) {
    const t0 = ini + d * i, t1 = t0 + d;
    const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
    out.push([cx + r * (c0 - k * s0), cy + r * (s0 + k * c0), cx + r * (c1 + k * s1), cy + r * (s1 - k * c1), cx + r * c1, cy + r * s1]);
  }
  return { ini: [cx + r * Math.cos(ini), cy + r * Math.sin(ini)], fatias: out };
}

function novaPagina(doc, w, h) {
  const ops = [];
  let aberto = false;
  const usadas = { fontes: new Set(), imagens: new Set() };
  const pg = {
    w, h, ops, usadas,
    op(s) { ops.push(s); return pg; },
    corTraco(c) { ops.push(corOps(c, 'RG')); return pg; },
    corFundo(c) { ops.push(corOps(c, 'rg')); return pg; },
    espessura(mm) { ops.push(n(Math.max(0, mm)) + ' w'); return pg; },
    pontas(tipo) { ops.push(tipo === 'reta' ? '0 J 0 j' : tipo === 'quadrada' ? '2 J 0 j' : '1 J 1 j'); return pg; },
    tracejado(padrao) { ops.push('[' + (padrao || []).map(n).join(' ') + '] 0 d'); return pg; },
    salva() { ops.push('q'); return pg; },
    restaura() { ops.push('Q'); return pg; },
    matriz(a, b, c, d, e, f) { ops.push([a, b, c, d, e, f].map(n).join(' ') + ' cm'); return pg; },
    move(x, y) { ops.push(n(x) + ' ' + n(y) + ' m'); aberto = true; return pg; },
    reta(x, y) { ops.push(n(x) + ' ' + n(y) + ' l'); return pg; },
    curva(x1, y1, x2, y2, x, y) { ops.push([x1, y1, x2, y2, x, y].map(n).join(' ') + ' c'); return pg; },
    fecha() { ops.push('h'); return pg; },
    arco(cx, cy, r, g0, g1, horario, novo) {
      if (!(r > 0)) return pg;
      const a = fatiasArco(cx, cy, r, g0, g1, !!horario);
      if (aberto && !novo) pg.reta(a.ini[0], a.ini[1]); else pg.move(a.ini[0], a.ini[1]);
      for (const f of a.fatias) pg.curva(f[0], f[1], f[2], f[3], f[4], f[5]);
      return pg;
    },
    retangulo(x, y, ww, hh) { ops.push([x, y, ww, hh].map(n).join(' ') + ' re'); aberto = true; return pg; },
    circulo(cx, cy, r) {
      if (!(r > 0)) return pg;
      const a = fatiasArco(cx, cy, r, 0, 360, false);
      pg.move(a.ini[0], a.ini[1]);
      for (const f of a.fatias) pg.curva(f[0], f[1], f[2], f[3], f[4], f[5]);
      return pg.fecha();
    },
    polilinha(pts) {
      if (!pts || !pts.length) return pg;
      pg.move(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) pg.reta(pts[i][0], pts[i][1]);
      return pg;
    },
    poligono(pts) { if (pts && pts.length >= 2) pg.polilinha(pts).fecha(); return pg; },
    traca() { ops.push('S'); aberto = false; return pg; },
    preenche(parImpar) { ops.push(parImpar ? 'f*' : 'f'); aberto = false; return pg; },
    preencheTraca(parImpar) { ops.push(parImpar ? 'B*' : 'B'); aberto = false; return pg; },
    recorta(parImpar) { ops.push(parImpar ? 'W* n' : 'W n'); aberto = false; return pg; },
    descarta() { ops.push('n'); aberto = false; return pg; },
    /* texto: x,y e o ponto de ancora; alinha e base dizem que ponto do texto cai nele. As
       alturas sao as do AFM (maiuscula ~0,72 em; descendente ~0,21 em) */
    texto(x, y, s, o) {
      o = o || {};
      const fonte = fonteValida(o.fonte), tam = o.tam > 0 ? o.tam : 3;
      const txt = String(s == null ? '' : s);
      if (!txt) return pg;
      usadas.fontes.add(fonte);
      const lw = larguraTexto(txt, fonte, tam);
      const dx = o.alinha === 'centro' ? -lw / 2 : o.alinha === 'dir' ? -lw : 0;
      const cap = 0.718 * tam, desc = 0.207 * tam;
      const dy = o.base === 'meio' ? -cap / 2 : o.base === 'topo' ? -cap : o.base === 'baixo' ? desc : 0;
      const g = (o.rot || 0) * Math.PI / 180, co = Math.cos(g), si = Math.sin(g);
      const tx = x + dx * co - dy * si, ty = y + dx * si + dy * co;
      ops.push('BT /' + NOMES_FONTE[fonte] + ' ' + n(tam) + ' Tf ' + (o.cor ? corOps(o.cor, 'rg') + ' ' : '') +
               [co, si, -si, co, tx, ty].map(n).join(' ') + ' Tm ' + stringPdf(txt) + ' Tj ET');
      return pg;
    },
    imagem(nome, x, y, ww, hh) {
      if (!doc.imagens.has(nome)) throw new Error('HubPdfWriter: imagem desconhecida ' + nome);
      usadas.imagens.add(nome);
      ops.push('q ' + [ww, 0, 0, hh, x, y].map(n).join(' ') + ' cm /' + nome + ' Do Q');
      return pg;
    },
  };
  return pg;
}

/* ============================== documento ============================== */

function dataPdf(d) {
  const z = v => ('0' + v).slice(-2);
  return 'D:' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds());
}

function novo(meta) {
  meta = meta || {};
  const doc = { paginas: [], imagens: new Map(), meta };
  doc.pagina = (w, h) => {
    const pg = novaPagina(doc, w > 0 ? w : FOLHAS.A4.w, h > 0 ? h : FOLHAS.A4.h);
    doc.paginas.push(pg);
    return pg;
  };
  /* imagem -> nome do XObject. jpeg: os bytes do .jpg (w/h obrigatorios). rgb: w*h*3 bytes, alfa
     opcional (w*h). flate: o RGB ja comprimido em zlib (alfaFlate idem). */
  doc.imagem = (im) => {
    if (!im || !(im.w > 0) || !(im.h > 0)) throw new Error('HubPdfWriter.imagem: falta w/h');
    if (im.rgb && im.rgb.length < im.w * im.h * 3) throw new Error('HubPdfWriter.imagem: rgb curto');
    const nome = 'Im' + (doc.imagens.size + 1);
    doc.imagens.set(nome, im);
    return nome;
  };
  doc.bytes = (o) => montaBytes(doc, (o && 'deflate' in o) ? o.deflate : zlibNode());
  doc.bytesAsync = async () => {
    const z = zlibNode();
    if (z) return montaBytes(doc, z);
    /* CompressionStream e assincrono: comprime os streams antes e monta sincrono depois */
    const cache = new Map();
    const pre = await coletaStreams(doc);
    for (const b of pre) { try { const c = await deflateNavegador(b); if (c) cache.set(b, c); } catch (_) { /* fica cru */ } }
    return montaBytes(doc, b => cache.get(b) || null);
  };
  return doc;
}

/* os conteudos que seriam comprimidos (para o caminho assincrono comprimir antes) */
async function coletaStreams(doc) {
  const out = [];
  for (const pg of doc.paginas) { pg.__cont = bytesAscii(cabecalhoPagina(pg) + pg.ops.join('\n') + '\n'); out.push(pg.__cont); }
  for (const im of doc.imagens.values()) {
    if (im.rgb && !im.__rgb) im.__rgb = im.rgb.subarray(0, im.w * im.h * 3);
    if (im.rgb) out.push(im.__rgb);
    if (im.alfa) out.push(im.alfa);
  }
  return out;
}
function cabecalhoPagina(pg) { return n(PT) + ' 0 0 ' + n(PT) + ' 0 0 cm\n'; }

function montaBytes(doc, deflate) {
  const objs = [];                        /* [ [dicionario, streamBytes|null], ... ] (1-based no PDF) */
  const novoObj = () => { objs.push(null); return objs.length; };
  const poe = (k, dic, stream) => { objs[k - 1] = [dic, stream || null]; };
  const comprime = (b) => {
    if (!deflate || b.length < 64) return null;
    try { const c = deflate(b); return c && c.length < b.length ? c : null; } catch (_) { return null; }
  };
  const streamDe = (b, extra) => {
    const c = comprime(b);
    return c ? ['<< /Length ' + c.length + ' /Filter /FlateDecode' + (extra || '') + ' >>', c]
             : ['<< /Length ' + b.length + (extra || '') + ' >>', b];
  };

  const catalogo = novoObj(), paginas = novoObj(), info = novoObj();
  /* fontes usadas em qualquer pagina */
  const fontesObj = {};
  for (const pg of doc.paginas) for (const f of pg.usadas.fontes) if (!fontesObj[f]) fontesObj[f] = novoObj();
  for (const f of Object.keys(fontesObj))
    poe(fontesObj[f], '<< /Type /Font /Subtype /Type1 /BaseFont /' + f + ' /Encoding /WinAnsiEncoding >>');
  /* imagens */
  const imgObj = {};
  for (const [nome, im] of doc.imagens) {
    const k = novoObj();
    imgObj[nome] = k;
    let smask = '';
    if (im.alfa || im.alfaFlate) {
      const ka = novoObj();
      const base = '<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceGray /BitsPerComponent 8';
      if (im.alfaFlate) poe(ka, base + ' /Length ' + im.alfaFlate.length + ' /Filter /FlateDecode >>', im.alfaFlate);
      else { const s = streamDe(im.alfa); poe(ka, base + s[0].slice(2, -2) + ' >>', s[1]); }
      smask = ' /SMask ' + ka + ' 0 R';
    }
    const base = '<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8' + smask;
    if (im.jpeg) poe(k, base + ' /Length ' + im.jpeg.length + ' /Filter /DCTDecode >>', im.jpeg);
    else if (im.flate) poe(k, base + ' /Length ' + im.flate.length + ' /Filter /FlateDecode >>', im.flate);
    else {
      const s = streamDe(im.__rgb || im.rgb.subarray(0, im.w * im.h * 3));
      poe(k, base + s[0].slice(2, -2) + ' >>', s[1]);
    }
  }
  /* paginas */
  const kids = [];
  for (const pg of doc.paginas) {
    const kp = novoObj(), kc = novoObj();
    kids.push(kp);
    const cont = pg.__cont || bytesAscii(cabecalhoPagina(pg) + pg.ops.join('\n') + '\n');
    const s = streamDe(cont);
    poe(kc, s[0], s[1]);
    const f = [...pg.usadas.fontes].map(x => '/' + NOMES_FONTE[x] + ' ' + fontesObj[x] + ' 0 R').join(' ');
    const im = [...pg.usadas.imagens].map(x => '/' + x + ' ' + imgObj[x] + ' 0 R').join(' ');
    poe(kp, '<< /Type /Page /Parent ' + paginas + ' 0 R /MediaBox [0 0 ' + n(pg.w * PT) + ' ' + n(pg.h * PT) + ']' +
            ' /Resources << /ProcSet [/PDF /Text /ImageB /ImageC]' + (f ? ' /Font << ' + f + ' >>' : '') +
            (im ? ' /XObject << ' + im + ' >>' : '') + ' >> /Contents ' + kc + ' 0 R >>');
  }
  poe(paginas, '<< /Type /Pages /Kids [' + kids.map(k => k + ' 0 R').join(' ') + '] /Count ' + kids.length + ' >>');
  poe(catalogo, '<< /Type /Catalog /Pages ' + paginas + ' 0 R >>');
  const m = doc.meta || {}, agora = dataPdf(m.data instanceof Date ? m.data : new Date());
  poe(info, '<< /Producer ' + stringPdf('EletricHUB hub-pdfwriter') + ' /Creator ' + stringPdf(m.criador || 'EletricHUB') +
            (m.titulo ? ' /Title ' + stringPdf(m.titulo) : '') + (m.autor ? ' /Author ' + stringPdf(m.autor) : '') +
            (m.assunto ? ' /Subject ' + stringPdf(m.assunto) : '') + ' /CreationDate ' + stringPdf(agora) + ' >>');

  /* serializa com o xref de offsets exatos */
  const partes = [bytesAscii('%PDF-1.4\n'), new Uint8Array([37, 0xe2, 0xe3, 0xcf, 0xd3, 10])];
  let pos = partes[0].length + partes[1].length;
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(pos);
    const cab = bytesAscii((i + 1) + ' 0 obj\n' + o[0] + (o[1] ? '\nstream\n' : '\n'));
    partes.push(cab); pos += cab.length;
    if (o[1]) {
      partes.push(o[1]); pos += o[1].length;
      const fim = bytesAscii('\nendstream\n'); partes.push(fim); pos += fim.length;
    }
    const e = bytesAscii('endobj\n'); partes.push(e); pos += e.length;
  });
  let x = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  for (const o of offs) x += ('0000000000' + o).slice(-10) + ' 00000 n \n';
  x += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalogo + ' 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + pos + '\n%%EOF\n';
  partes.push(bytesAscii(x));
  for (const pg of doc.paginas) delete pg.__cont;
  return junta(partes);
}

/* ============================== leitor minimo (testes) ============================== */

/* Le a estrutura de volta, sem biblioteca: confere o startxref, cada entrada do xref contra o
   "N 0 obj" no offset dito, o trailer (/Size, /Root), o /Length de cada stream contra o
   endstream e a arvore Catalog -> Pages -> Page. Nao interpreta conteudo. */
function le(bytes) {
  const s = Array.from(bytes, b => String.fromCharCode(b)).join('');
  const erros = [];
  const out = { versao: null, objetos: {}, raiz: null, paginas: [], xrefOk: false, erros };
  const v = /^%PDF-(\d\.\d)/.exec(s);
  if (!v) { erros.push('sem cabecalho %PDF'); return out; }
  out.versao = v[1];
  if (!/%%EOF\s*$/.test(s)) erros.push('sem %%EOF no fim');
  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(s);
  if (!sx) { erros.push('sem startxref'); return out; }
  const xpos = +sx[1];
  if (s.substr(xpos, 4) !== 'xref') { erros.push('startxref nao aponta para xref'); return out; }
  const xm = /^xref\s+(\d+)\s+(\d+)\s*\n/.exec(s.slice(xpos));
  if (!xm) { erros.push('xref malformado'); return out; }
  const n0 = +xm[1], cnt = +xm[2];
  let p = xpos + xm[0].length;
  const ofs = [];
  for (let i = 0; i < cnt; i++) {
    const linha = s.substr(p, 20);
    if (!/^\d{10} \d{5} [nf] ?\r?\n?$/.test(linha)) { erros.push('entrada xref ' + i + ' com ' + JSON.stringify(linha)); return out; }
    ofs.push([+linha.slice(0, 10), linha[17]]);
    p += 20;
  }
  const tm = /trailer\s*<<([\s\S]*?)>>\s*startxref/.exec(s.slice(p));
  if (!tm) { erros.push('sem trailer'); return out; }
  const tam = /\/Size (\d+)/.exec(tm[1]), raiz = /\/Root (\d+) 0 R/.exec(tm[1]);
  if (!tam || +tam[1] !== n0 + cnt) erros.push('/Size do trailer nao bate com o xref');
  for (let i = 1; i < cnt; i++) {
    const o = ofs[i];
    if (o[1] !== 'n') continue;
    const cab = new RegExp('^' + (n0 + i) + ' 0 obj\\s*').exec(s.slice(o[0], o[0] + 20));
    if (!cab) { erros.push('objeto ' + (n0 + i) + ' fora do offset do xref'); continue; }
    const ini = o[0] + cab[0].length, fimObj = s.indexOf('endobj', ini);
    let corpo = s.slice(ini, fimObj);
    const st = corpo.indexOf('stream\n');
    const obj = { dic: st >= 0 ? corpo.slice(0, st) : corpo, stream: null };
    if (st >= 0) {
      const L = /\/Length (\d+)/.exec(obj.dic);
      const a = ini + st + 7;
      if (!L) erros.push('stream sem /Length no objeto ' + (n0 + i));
      else {
        obj.stream = bytes.subarray(a, a + +L[1]);
        if (s.substr(a + +L[1], 10) !== '\nendstream') erros.push('/Length errado no objeto ' + (n0 + i));
      }
    }
    out.objetos[n0 + i] = obj;
  }
  out.xrefOk = !erros.length;
  if (!raiz || !out.objetos[raiz[1]]) { erros.push('/Root nao existe'); return out; }
  out.raiz = +raiz[1];
  const pgs = /\/Pages (\d+) 0 R/.exec(out.objetos[raiz[1]].dic);
  const nodo = pgs && out.objetos[pgs[1]];
  if (!nodo || !/\/Type \/Pages/.test(nodo.dic)) { erros.push('catalogo sem /Pages'); return out; }
  const kids = /\/Kids \[([^\]]*)\]/.exec(nodo.dic);
  for (const k of (kids ? kids[1].match(/\d+ 0 R/g) || [] : [])) {
    const id = parseInt(k, 10), pg = out.objetos[id];
    if (!pg || !/\/Type \/Page\b/.test(pg.dic)) { erros.push('kid ' + id + ' nao e pagina'); continue; }
    const mb = /\/MediaBox \[([^\]]*)\]/.exec(pg.dic), c = /\/Contents (\d+) 0 R/.exec(pg.dic);
    out.paginas.push({ id, mediaBox: mb ? mb[1].trim().split(/\s+/).map(Number) : null, conteudo: c ? +c[1] : null, dic: pg.dic });
  }
  const cnt2 = /\/Count (\d+)/.exec(nodo.dic);
  if (!cnt2 || +cnt2[1] !== out.paginas.length) erros.push('/Count nao bate com as paginas');
  return out;
}

return { novo, le, larguraTexto, stringPdf, codigoWin, FOLHAS, PT, rgb, fatiasArco };
});
