/* AltiumPCBMirror v2 - hub-overbar.js — nome de pino ativo-baixo (browser e Node).

   O Altium marca o ativo-baixo com uma barra invertida DEPOIS de cada caractere barrado:
   R\S\T\ quer dizer RST com a barra em cima. Hoje a tela mostra a notacao crua.

   O espelho guarda o valor CRU e tem de continuar guardando: tools/almox/schlib_bin.py
   grava o nome do pino com encode('latin-1') para escrever a .SchLib, e U+0305 (a
   sobrelinha) nao existe em latin-1 — converter na LEITURA corromperia a escrita. Por isso
   a conversao mora aqui e acontece so na hora de desenhar. Nada neste arquivo escreve de
   volta no campo `name`.

   Alem da notacao nativa o acervo tem duas grafias herdadas com barra NORMAL: repetida
   (/O/E) e uma so, abrindo o nome inteiro (/CS, /RST, /WP). As duas barram. O que NAO barra
   e a barra no MEIO — IO21/SDA, VP/IO36, N/C — que e separador de funcao alternativa: sao
   258 pinos assim em Libs/schlib.js e 485 em Libs/symbols-lib.js, contra 54 e 128 com a
   notacao nativa. Barrar os separadores seria pior que nao fazer nada.

     HubOverbar.parse('R\S\T\')        -> [{ txt:'RST', bar:true }]
     HubOverbar.plain('R\S\T\')        -> 'RST'            (busca e comparacao)
     HubOverbar.temBarra(nome)          -> boolean
     HubOverbar.canvas(ctx, nome, x, y[, opts])  -> largura desenhada
     HubOverbar.html(nome) / .node(nome)         -> markup escapado / fragmento DOM
     HubOverbar.unicode(nome)           -> 'R̅S̅T̅' (atributo title, que nao aceita markup) */
"use strict";
var HubOverbar = (function () {

const BS = '\\';
const OVL = '̅';                    /* COMBINING OVERLINE */

/* ── a regra, em um lugar so ──
   parse() e o unico lugar que decide o que se ve: canvas, html, node, unicode e plain saem
   todos dele. Por isso ele NUNCA pode devolver vazio para nome nao vazio — um nome feito so
   de marcador ('\', '\\') sumia da tela e da ficha (parse dava [], plain dava '') e isso e
   perda silenciosa de informacao. Sem nada desenhavel, o cru aparece como literal. */
function parse(nome) {
  const s = String(nome == null ? '' : nome);
  if (!s) return [];
  const tr = trechosDe(s);
  return tr.length ? tr : [{ txt: s, bar: false }];   /* (f) o cru, em vez de sumir */
}

function trechosDe(s) {
  const tr = [];
  /* trechos vizinhos de mesmo estado viram um: uma barra so, contínua, em vez de uma por
     caractere — com a fonte proporcional, barras por caractere deixam falha entre elas */
  const push = (txt, bar) => {
    if (!txt) return;
    const u = tr[tr.length - 1];
    if (u && u.bar === bar) u.txt += txt; else tr.push({ txt: txt, bar: bar });
  };

  /* (a) a notacao nativa manda: onde ha barra invertida, a barra normal e letra comum —
     GP3/M\C\L\R\ barra so MCLR e mantem "GP3/" visivel */
  if (s.indexOf(BS) >= 0) {
    /* (b) 13 nomes dos dois espelhos vem com uma barra invertida SOBRANDO na frente
       (\M\C\L\R\, \R\E\S\E\T\, \S\H\D\N\...). Engolir essa faz o malformado desenhar
       igualzinho ao bem formado — inclusive \M\C\L\R\/VPP, cujo gemeo M\C\L\R\/VPP esta
       no mesmo acervo e nao pode sair diferente dele. */
    const c = s.charAt(0) === BS ? s.slice(1) : s;
    for (let i = 0; i < c.length; i++) {
      if (c.charAt(i) === BS) continue;               /* marcador: nunca e desenhado */
      push(c.charAt(i), c.charAt(i + 1) === BS);
    }
    return tr;
  }

  /* (c) /O/E e (d) /CS: a barra normal so barra quando ABRE o nome — inteiro, ou cada
     caractere. Qualquer outro arranjo cai no literal logo abaixo, que e onde mora IO21/SDA. */
  if (/^(?:\/[^/])+$/.test(s) || /^\/[^/]+$/.test(s)) {
    push(s.replace(/\//g, ''), true);
    return tr;
  }

  push(s, false);                                     /* (e) o resto e literal */
  return tr;
}

/* o nome sem marcacao nenhuma: e por aqui que a busca compara, senao procurar RST nunca
   acharia R\S\T\. Nome nao vazio nunca sai vazio daqui (o (f) do parse) — mas quem filtra
   nao pode DEPENDER disso: consulta vazia costuma valer "passa tudo". */
const plain = nome => parse(nome).map(t => t.txt).join('');
const temBarra = nome => parse(nome).some(t => t.bar);

/* ── canvas 2d ── */
/* o px do ctx.font, que e o tamanho em unidades de MUNDO quando quem chama e o worldText:
   a barra tem de escalar junto, senao vira um traco grosso no footprint (fonte 0.3) e um
   fio de cabelo no esquema (fonte 45) */
function tamFonte(ctx) {
  const m = /([\d.]+)px/.exec(String(ctx.font || ''));
  return m ? parseFloat(m[1]) : 10;
}
/* onde comeca a maiuscula. A TextMetrics vem relativa ao textBaseline em vigor, entao a
   mesma conta serve ao 'middle' do worldText e ao 'alphabetic' de quem desenhar cru; medir
   o 'M' (e nao o proprio texto) mantem a barra na mesma altura em OE e em RST. */
function capAltura(ctx, size) {
  const m = ctx.measureText('M');
  const a = m && m.actualBoundingBoxAscent;
  if (typeof a === 'number' && isFinite(a) && a > 0) return a;
  const bl = ctx.textBaseline || 'alphabetic';
  return bl === 'middle' ? size * 0.36 : (bl === 'top' || bl === 'hanging') ? 0 : size * 0.72;
}
/* Canvas nao tem text-decoration: cada trecho e medido e a barra e um fillRect por cima.
   Como o desenho e trecho a trecho, o textAlign do chamador nao pode valer por trecho —
   e resolvido uma vez na largura total e devolvido intacto no fim. */
function canvas(ctx, nome, x, y, opts) {
  const tr = parse(nome);
  if (!tr.length) return 0;
  const o = opts || {};
  const larg = tr.map(t => ctx.measureText(t.txt).width);
  const total = larg.reduce((a, b) => a + b, 0);
  const al = ctx.textAlign || 'start';
  let cx = x - (al === 'center' ? total / 2 : (al === 'right' || al === 'end') ? total : 0);
  const size = o.size || tamFonte(ctx);
  const esp = o.thickness != null ? o.thickness : size * 0.08;
  const folga = o.gap != null ? o.gap : size * 0.10;
  const topo = capAltura(ctx, size);
  const antes = ctx.textAlign;
  ctx.textAlign = 'left';
  for (let i = 0; i < tr.length; i++) {
    ctx.fillText(tr[i].txt, cx, y);
    if (tr[i].bar) ctx.fillRect(cx, y - topo - folga - esp, larg[i], esp);
    cx += larg[i];
  }
  ctx.textAlign = antes;
  return total;
}

/* ── DOM ── */
/* O CSS vem daqui porque hub.html tem dono e uma classe solta la seria a quarta linha de
   casca que este painel pediria. skip-ink desligado: sem isso o Chrome abre buraco na barra
   em cima do til e do acento de nomes acentuados. */
const CSS = '.ovb{text-decoration:overline; text-decoration-thickness:.07em; text-decoration-skip-ink:none;}';
let cssPronto = false;
function injetaCss() {
  if (cssPronto || typeof document === 'undefined' || !document.head) return;
  cssPronto = true;
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
}
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ESC[c]);

function html(nome) {
  injetaCss();
  return parse(nome).map(t => (t.bar ? '<span class="ovb">' + esc(t.txt) + '</span>' : esc(t.txt))).join('');
}
/* o mesmo em DOM, para quem pode montar o no: dispensa innerHTML e, com ele, a necessidade
   de confiar no escape */
function node(nome) {
  injetaCss();
  const frag = document.createDocumentFragment();
  for (const t of parse(nome)) {
    if (!t.bar) { frag.appendChild(document.createTextNode(t.txt)); continue; }
    const s = document.createElement('span');
    s.className = 'ovb'; s.textContent = t.txt;
    frag.appendChild(s);
  }
  return frag;
}
/* sobrelinha combinante: e a unica forma de mostrar a barra onde so cabe texto puro — o
   title de um <input>, por exemplo. Saida de tela, nunca de arquivo: U+0305 nao passa pelo
   latin-1 com que a .SchLib e escrita. */
const unicode = nome => parse(nome)
  .map(t => (t.bar ? Array.from(t.txt).map(c => c + OVL).join('') : t.txt)).join('');

return { parse, plain, temBarra, canvas, html, node, unicode, esc };
})();
if (typeof module === 'object' && module.exports) module.exports = HubOverbar;
