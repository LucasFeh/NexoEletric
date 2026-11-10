/* NexoEletric - hub-qr.js — QR code (ISO/IEC 18004) a partir de um texto, como MATRIZ de módulos: sem imagem.

   Pedido do dono (2026-11-10): a logo da casa vai com o QR code do site da Dieletrons, e o Studio de artes de overlay
   gera QR "de verdade" a partir de uma URL/texto — os módulos viram quadrados de serigrafia (hub-pcbartes.js), não uma
   imagem colada. O QR das placas da casa (o da DMB - DI231765_P2, decodificado: "www.dieletrons.com", nível L, versão 2)
   sai igual por aqui.

   Só o modo byte (UTF-8), que é o que uma URL usa; versões 1 a 40; níveis de correção L, M, Q, H; a máscara de menor
   penalidade (as quatro regras da norma). Puro: roda no navegador e no Node (o MCP e os testes).

   HubQR.gera(texto, {ec:'L'|'M'|'Q'|'H' (padrão 'M'), versaoMin:1, versaoMax:40, mascara:-1 (auto)})
     -> {n, versao, ec, mascara, mod(x, y) -> bool, linhas:[[0|1...]]}   (y = 0 é a linha de CIMA, como o QR é lido)
   Lança Error se o texto não couber na versaoMax. */
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubQR = m;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const NIVEIS = { L: 0, M: 1, Q: 2, H: 3 };
/* bits do formato por nível (a ordem da norma: L=01, M=00, Q=11, H=10) */
const BITS_NIVEL = [1, 0, 3, 2];
/* palavras de correção por bloco e número de blocos, por nível (L, M, Q, H) e versão (índice 0 sem uso) */
const ECC_POR_BLOCO = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCOS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

/* módulos de dados (sem as funções) de uma versão */
function modulosDeDados(v) {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const na = Math.floor(v / 7) + 2;
    r -= (25 * na - 10) * na - 55;
    if (v >= 7) r -= 36;
  }
  return r;
}
const palavrasDeDados = (v, n) => Math.floor(modulosDeDados(v) / 8) - ECC_POR_BLOCO[n][v] * NUM_BLOCOS[n][v];

/* os centros dos padrões de alinhamento */
function alinhamentos(v) {
  if (v === 1) return [];
  const na = Math.floor(v / 7) + 2;
  const passo = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (na * 2 - 2)) * 2;
  const out = [6];
  for (let p = v * 4 + 10; out.length < na; p -= passo) out.splice(1, 0, p);
  return out;
}

/* Reed-Solomon sobre GF(256), polinômio 0x11D */
function rsMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xFF;
}
function rsDivisor(grau) {
  const r = new Array(grau).fill(0);
  r[grau - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grau; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = rsMul(r[j], raiz);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    raiz = rsMul(raiz, 0x02);
  }
  return r;
}
function rsResto(dados, div) {
  const r = div.map(() => 0);
  for (const b of dados) {
    const f = b ^ r.shift();
    r.push(0);
    div.forEach((c, i) => { r[i] ^= rsMul(c, f); });
  }
  return r;
}

function utf8(texto) {
  const s = unescape(encodeURIComponent(String(texto)));
  const out = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  return out;
}

/* os dados com os blocos de correção intercalados */
function intercala(dados, v, n) {
  const nb = NUM_BLOCOS[n][v], ecl = ECC_POR_BLOCO[n][v];
  const brutos = Math.floor(modulosDeDados(v) / 8);
  const curtos = nb - brutos % nb, lenCurto = Math.floor(brutos / nb);
  const blocos = [], div = rsDivisor(ecl);
  for (let i = 0, k = 0; i < nb; i++) {
    const d = dados.slice(k, k + lenCurto - ecl + (i < curtos ? 0 : 1));
    k += d.length;
    const ecc = rsResto(d, div);
    if (i < curtos) d.push(0);
    blocos.push(d.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocos[0].length; i++)
    blocos.forEach((b, j) => { if (i !== lenCurto - ecl || j >= curtos) out.push(b[i]); });
  return out;
}

function gera(texto, opts) {
  opts = opts || {};
  const nivel = String(opts.ec || 'M').toUpperCase();
  if (!(nivel in NIVEIS)) throw new Error('nível de correção "' + opts.ec + '" inválido (L, M, Q ou H)');
  const n = NIVEIS[nivel];
  const bytes = utf8(texto);
  const vMin = Math.max(1, opts.versaoMin | 0 || 1), vMax = Math.min(40, opts.versaoMax | 0 || 40);
  let v = vMin, bitsUsados = 0;
  for (;; v++) {
    const cc = v < 10 ? 8 : 16;
    bitsUsados = 4 + cc + bytes.length * 8;
    if (bytes.length < (1 << cc) && bitsUsados <= palavrasDeDados(v, n) * 8) break;
    if (v >= vMax) throw new Error('o texto (' + bytes.length + ' bytes) não cabe num QR até a versão ' + vMax + ' no nível ' + nivel);
  }
  /* os bits: modo byte (0100), a contagem, os bytes, o terminador e o enchimento */
  const bits = [];
  const poe = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  poe(4, 4); poe(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) poe(b, 8);
  const cap = palavrasDeDados(v, n) * 8;
  poe(0, Math.min(4, cap - bits.length));
  poe(0, (8 - bits.length % 8) % 8);
  for (let p = 0xEC; bits.length < cap; p ^= 0xEC ^ 0x11) poe(p, 8);
  const dados = [];
  for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; dados.push(b); }
  const palavras = intercala(dados, v, n);

  const tam = v * 4 + 17;
  const mod = [], func = [];
  for (let y = 0; y < tam; y++) { mod.push(new Array(tam).fill(false)); func.push(new Array(tam).fill(false)); }
  const poeF = (x, y, escuro) => { mod[y][x] = escuro; func[y][x] = true; };
  /* temporização, localizadores, alinhamentos */
  for (let i = 0; i < tam; i++) { poeF(6, i, i % 2 === 0); poeF(i, 6, i % 2 === 0); }
  const localizador = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < tam && y >= 0 && y < tam) poeF(x, y, d !== 2 && d !== 4);
    }
  };
  localizador(3, 3); localizador(tam - 4, 3); localizador(3, tam - 4);
  const al = alinhamentos(v);
  al.forEach((ay, i) => al.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) poeF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  /* formato (reservado agora, escrito com a máscara) e versão */
  const formato = (masc) => {
    const d = (BITS_NIVEL[n] << 3) | masc;
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) poeF(8, i, ((b >>> i) & 1) !== 0);
    poeF(8, 7, ((b >>> 6) & 1) !== 0); poeF(8, 8, ((b >>> 7) & 1) !== 0); poeF(7, 8, ((b >>> 8) & 1) !== 0);
    for (let i = 9; i < 15; i++) poeF(14 - i, 8, ((b >>> i) & 1) !== 0);
    for (let i = 0; i < 8; i++) poeF(tam - 1 - i, 8, ((b >>> i) & 1) !== 0);
    for (let i = 8; i < 15; i++) poeF(8, tam - 15 + i, ((b >>> i) & 1) !== 0);
    poeF(8, tam - 8, true);
  };
  formato(0);
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) {
      const bit = ((b >>> i) & 1) !== 0, a = tam - 11 + i % 3, c = Math.floor(i / 3);
      poeF(a, c, bit); poeF(c, a, bit);
    }
  }
  /* os dados em zigue-zague, de baixo para cima, duas colunas por vez */
  let i = 0;
  for (let dir = tam - 1; dir >= 1; dir -= 2) {
    if (dir === 6) dir = 5;
    for (let vert = 0; vert < tam; vert++) for (let j = 0; j < 2; j++) {
      const x = dir - j, sobe = ((dir + 1) & 2) === 0, y = sobe ? tam - 1 - vert : vert;
      if (!func[y][x] && i < palavras.length * 8) { mod[y][x] = ((palavras[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
    }
  }
  const mascara = (k) => {
    for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) {
      if (func[y][x]) continue;
      let inv;
      switch (k) {
        case 0: inv = (x + y) % 2 === 0; break;
        case 1: inv = y % 2 === 0; break;
        case 2: inv = x % 3 === 0; break;
        case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: inv = x * y % 2 + x * y % 3 === 0; break;
        case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break;
        default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0;
      }
      if (inv) mod[y][x] = !mod[y][x];
    }
  };
  let escolhida = opts.mascara >= 0 && opts.mascara <= 7 ? opts.mascara | 0 : -1;
  if (escolhida < 0) {
    let melhor = Infinity;
    for (let k = 0; k < 8; k++) {
      mascara(k); formato(k);
      const p = penalidade(mod, tam);
      if (p < melhor) { melhor = p; escolhida = k; }
      mascara(k);
    }
  }
  mascara(escolhida); formato(escolhida);
  const linhas = mod.map(l => l.map(b => (b ? 1 : 0)));
  return { n: tam, versao: v, ec: nivel, mascara: escolhida, linhas, mod: (x, y) => x >= 0 && y >= 0 && x < tam && y < tam && linhas[y][x] === 1 };
}

/* as quatro regras de penalidade da norma */
function penalidade(mod, tam) {
  let r = 0;
  const N1 = 3, N2 = 3, N3 = 40, N4 = 10;
  const linha = (get) => {
    let cor = false, corrida = 0;
    const hist = [0, 0, 0, 0, 0, 0, 0];
    const empurra = (c) => { if (hist[0] === 0) c += tam; hist.pop(); hist.unshift(c); };
    const conta = () => {
      const k = hist[1], core = k > 0 && hist[2] === k && hist[3] === k * 3 && hist[4] === k && hist[5] === k;
      return (core && hist[0] >= k * 4 && hist[6] >= k ? 1 : 0) + (core && hist[6] >= k * 4 && hist[0] >= k ? 1 : 0);
    };
    for (let i = 0; i < tam; i++) {
      if (get(i) === cor) { corrida++; if (corrida === 5) r += N1; else if (corrida > 5) r++; }
      else { empurra(corrida); if (!cor) r += conta() * N3; cor = get(i); corrida = 1; }
    }
    if (cor) { empurra(corrida); corrida = 0; }
    corrida += tam; empurra(corrida);
    r += conta() * N3;
  };
  for (let y = 0; y < tam; y++) linha(x => mod[y][x]);
  for (let x = 0; x < tam; x++) linha(y => mod[y][x]);
  for (let y = 0; y < tam - 1; y++) for (let x = 0; x < tam - 1; x++) {
    const c = mod[y][x];
    if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) r += N2;
  }
  let escuros = 0;
  for (const l of mod) for (const b of l) if (b) escuros++;
  const total = tam * tam;
  const k = Math.ceil(Math.abs(escuros * 20 - total * 10) / total) - 1;
  r += k * N4;
  return r;
}

return { gera, NIVEIS: Object.keys(NIVEIS) };
});
