/* AltiumPCBMirror - hub-schpdf.js
   O PDF do esquema (pedido do dono, 2026-11-03: "exportar PDF o esquema"), VETORIAL, desenhado pelo MESMO
   desenhista da tela: um "contexto 2D" de mentira que grava no hub-pdfwriter.js em vez de pintar pixel. A vista
   Esquema chama a mesma desenhaFolha(ctx, ...) da tela e das miniaturas com este contexto, uma pagina por folha
   — o PDF nao tem um segundo desenho do simbolo, do fio, do port ou do carimbo para discordar da tela.

   O que o contexto entende (o que o schframe.js, o hub-draw.js, o hub-overbar.js e o hub-schtemplate.js usam):
     caminhos: beginPath moveTo lineTo bezierCurveTo quadraticCurveTo arc arcTo ellipse rect closePath
     pintura:  stroke fill(evenodd) strokeRect fillRect clearRect (ignorado), strokeStyle fillStyle lineWidth
               lineCap lineJoin setLineDash globalAlpha (0 = nao pinta; o resto pinta opaco)
     matriz:   save restore translate rotate scale transform setTransform resetTransform getTransform
     texto:    fillText measureText font textAlign textBaseline (Helvetica do PDF, larguras do AFM)
     imagem:   drawImage(img|canvas, x, y[, w, h]) (o logo do carimbo), com a transparencia
   A semantica e a do canvas: o ponto do caminho e levado pela matriz NA HORA da chamada, e a espessura pela
   matriz na hora do stroke. O "aparelho" e o do canvas (Y para baixo), em unidades `unidade` mm cada: quem
   desenha poe o mesmo setTransform Y-para-cima que poe na tela, e o PDF sai do lado certo.

   API (global HubSchPdf; em node, module.exports — tests/test-schpdf.js)
     HubSchPdf.contexto(doc, pg, { largura, altura, unidade })   largura/altura = do aparelho; unidade = mm por
                                                                unidade do aparelho -> o contexto
     HubSchPdf.gera({ folhas:[{ largura, altura, desenha(ctx) }], unidade, titulo, autor }) -> Promise<Uint8Array>
       largura/altura da folha em unidades do aparelho (o esquema: mil, unidade 0,0254) */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HubSchPdf = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

const W = () => (typeof HubPdfWriter !== 'undefined' ? HubPdfWriter : (typeof require === 'function' ? require('./hub-pdfwriter.js') : null));

/* ---------- matriz 2D [a b c d e f] (a do canvas: x' = a x + c y + e, y' = b x + d y + f) ---------- */
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
                       m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apl = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const inv = m => { const d = m[0] * m[3] - m[1] * m[2] || 1e-30;
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };
const escalaDe = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

/* ---------- cor: '#rgb' '#rrggbb' 'rgb()' 'rgba()' e os nomes (pelo navegador) -> {hex, a} ---------- */
const NOMES = { black:'#000000', white:'#ffffff', red:'#ff0000', green:'#008000', blue:'#0000ff', yellow:'#ffff00',
                gray:'#808080', grey:'#808080', transparent:'#000000' };
let sondaCor = null;
function cor(v){
  if (v == null) return { hex:'#000000', a:1 };
  let s = String(v).trim().toLowerCase();
  if (s === 'transparent') return { hex:'#000000', a:0 };
  if (NOMES[s]) s = NOMES[s];
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/.exec(s);
  if (m) return { hex:'#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3], a:m[4] ? parseInt(m[4] + m[4], 16) / 255 : 1 };
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return { hex:'#' + m[1], a:m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const h = x => Math.max(0, Math.min(255, Math.round(+x))).toString(16).padStart(2, '0');
    const a = m[4] == null ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : +m[4];
    return { hex:'#' + h(m[1]) + h(m[2]) + h(m[3]), a };
  }
  /* nome CSS que nao esta na tabela: o navegador normaliza */
  try {
    if (!sondaCor && typeof document !== 'undefined') sondaCor = document.createElement('canvas').getContext('2d');
    if (sondaCor) { sondaCor.fillStyle = '#000000'; sondaCor.fillStyle = s; if (sondaCor.fillStyle !== s) return cor(sondaCor.fillStyle); }
  } catch (e) { /* sem DOM */ }
  return { hex:'#000000', a:1 };
}

/* ---------- fonte: '600 55px "Segoe UI", sans-serif' -> {tam, fonte do PDF} ---------- */
function fonteDe(css){
  const s = String(css || '10px sans-serif');
  const m = /(\d+(?:\.\d+)?)px/.exec(s);
  const tam = m ? +m[1] : 10;
  const negrito = /\bbold\b|\b[6-9]00\b/.test(s);
  const serifa = /\bserif\b/.test(s.replace(/sans-serif/g, '')) || /times/i.test(s);
  return { tam, fonte:serifa ? 'Times-Roman' : negrito ? 'Helvetica-Bold' : 'Helvetica' };
}
const ALINHA = { left:'esq', start:'esq', center:'centro', right:'dir', end:'dir' };
const BASE = { middle:'meio', top:'topo', hanging:'topo', bottom:'baixo', ideographic:'baixo', alphabetic:'base' };

/* ---------- o arco do canvas em Bezier (fatias de ate 90 graus), no espaco do usuario ---------- */
function arcoBezier(cx, cy, rx, ry, rot, a0, a1, antihorario){
  const TAU = 2 * Math.PI;
  let d = a1 - a0;
  if (!antihorario) { if (d >= TAU) d = TAU; else if (d < 0) d = ((d % TAU) + TAU) % TAU; }
  else { if (d <= -TAU) d = -TAU; else if (d > 0) d = -(((-d % TAU) + TAU) % TAU); }
  const n = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 2) - 1e-9));
  const passo = d / n, k = (4 / 3) * Math.tan(passo / 4);
  const cr = Math.cos(rot || 0), sr = Math.sin(rot || 0);
  const P = (t, dx, dy) => { const x = rx * (Math.cos(t) + dx), y = ry * (Math.sin(t) + dy); return [cx + x * cr - y * sr, cy + x * sr + y * cr]; };
  const ini = P(a0, 0, 0), seg = [];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + i * passo, t1 = t0 + passo;
    seg.push([P(t0, -k * Math.sin(t0), k * Math.cos(t0)), P(t1, k * Math.sin(t1), -k * Math.cos(t1)), P(t1, 0, 0)]);
  }
  return { ini, seg };
}

function contexto(doc, pg, o){
  o = o || {};
  const un = o.unidade || 1, H = (o.altura || 0) * un;
  /* aparelho (Y para baixo, unidades `un` mm) -> pagina do PDF (mm, Y para cima) */
  const BASEM = [un, 0, 0, -un, 0, H];
  let st = { m:BASEM.slice(), stroke:'#000000', fill:'#000000', lw:1, cap:'butt', join:'miter', dash:[], font:'10px sans-serif',
             align:'start', base:'alphabetic', alpha:1 };
  const pilha = [];
  let cam = [], cur = null, ini = null;        /* o caminho em coordenadas da PAGINA */
  const imagens = new Map();
  const pt = (x, y) => apl(st.m, x, y);
  const novoSub = (p) => { cam.push(['m', p]); cur = p; ini = p; };

  const ctx = {
    canvas: { width:o.largura || 0, height:o.altura || 0 },
    get strokeStyle(){ return st.stroke; }, set strokeStyle(v){ st.stroke = v; },
    get fillStyle(){ return st.fill; }, set fillStyle(v){ st.fill = v; },
    get lineWidth(){ return st.lw; }, set lineWidth(v){ if (isFinite(v) && v > 0) st.lw = +v; },
    get lineCap(){ return st.cap; }, set lineCap(v){ st.cap = v; },
    get lineJoin(){ return st.join; }, set lineJoin(v){ st.join = v; },
    get font(){ return st.font; }, set font(v){ st.font = v; },
    get textAlign(){ return st.align; }, set textAlign(v){ st.align = v; },
    get textBaseline(){ return st.base; }, set textBaseline(v){ st.base = v; },
    get globalAlpha(){ return st.alpha; }, set globalAlpha(v){ if (isFinite(v)) st.alpha = Math.max(0, Math.min(1, +v)); },
    imageSmoothingEnabled:true, imageSmoothingQuality:'high', globalCompositeOperation:'source-over',
    shadowBlur:0, shadowColor:'transparent', miterLimit:10, lineDashOffset:0,

    save(){ pilha.push(Object.assign({}, st, { m:st.m.slice(), dash:st.dash.slice() })); },
    restore(){ if (pilha.length) st = pilha.pop(); },
    translate(x, y){ st.m = mul(st.m, [1, 0, 0, 1, x, y]); },
    scale(x, y){ st.m = mul(st.m, [x, 0, 0, y, 0, 0]); },
    rotate(a){ const c = Math.cos(a), s = Math.sin(a); st.m = mul(st.m, [c, s, -s, c, 0, 0]); },
    transform(a, b, c, d, e, f){ st.m = mul(st.m, [a, b, c, d, e, f]); },
    setTransform(a, b, c, d, e, f){
      if (a && typeof a === 'object') ({ a, b, c, d, e, f } = a);
      st.m = mul(BASEM, [a, b, c, d, e, f]);
    },
    resetTransform(){ st.m = BASEM.slice(); },
    getTransform(){ const u = mul(inv(BASEM), st.m); return { a:u[0], b:u[1], c:u[2], d:u[3], e:u[4], f:u[5], is2D:true }; },
    setLineDash(v){ st.dash = Array.isArray(v) ? v.map(Number).filter(x => isFinite(x) && x >= 0) : []; },
    getLineDash(){ return st.dash.slice(); },

    beginPath(){ cam = []; cur = null; ini = null; },
    moveTo(x, y){ novoSub(pt(x, y)); },
    lineTo(x, y){ const p = pt(x, y); if (!cur) novoSub(p); else { cam.push(['l', p]); cur = p; } },
    closePath(){ if (cur) { cam.push(['h']); cur = ini; } },
    bezierCurveTo(x1, y1, x2, y2, x, y){
      if (!cur) novoSub(pt(x1, y1));
      const p = pt(x, y); cam.push(['c', pt(x1, y1), pt(x2, y2), p]); cur = p;
    },
    quadraticCurveTo(qx, qy, x, y){
      if (!cur) novoSub(pt(qx, qy));
      const iu = inv(st.m), p0 = apl(iu, cur[0], cur[1]);
      ctx.bezierCurveTo(p0[0] + (2 / 3) * (qx - p0[0]), p0[1] + (2 / 3) * (qy - p0[1]), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
    },
    arc(x, y, r, a0, a1, ccw){ ctx.ellipse(x, y, r, r, 0, a0, a1, ccw); },
    ellipse(x, y, rx, ry, rot, a0, a1, ccw){
      if (!(rx > 0) || !(ry > 0)) return;
      const a = arcoBezier(x, y, rx, ry, rot, a0, a1, !!ccw);
      const p = pt(a.ini[0], a.ini[1]);
      if (!cur) novoSub(p); else { cam.push(['l', p]); cur = p; }
      for (const s of a.seg) { const q = pt(s[2][0], s[2][1]); cam.push(['c', pt(s[0][0], s[0][1]), pt(s[1][0], s[1][1]), q]); cur = q; }
    },
    arcTo(x1, y1, x2, y2, r){
      if (!cur) { ctx.moveTo(x1, y1); return; }
      const p0 = apl(inv(st.m), cur[0], cur[1]);
      const v1 = [p0[0] - x1, p0[1] - y1], v2 = [x2 - x1, y2 - y1];
      const l1 = Math.hypot(v1[0], v1[1]), l2 = Math.hypot(v2[0], v2[1]);
      const cruz = v1[0] * v2[1] - v1[1] * v2[0];
      if (!(r > 0) || l1 < 1e-12 || l2 < 1e-12 || Math.abs(cruz) < 1e-12) { ctx.lineTo(x1, y1); return; }
      const ang = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2))));
      const t = r / Math.tan(ang / 2);
      const u1 = [v1[0] / l1, v1[1] / l1], u2 = [v2[0] / l2, v2[1] / l2];
      const a = [x1 + u1[0] * t, y1 + u1[1] * t], b = [x1 + u2[0] * t, y1 + u2[1] * t];
      const bis = [u1[0] + u2[0], u1[1] + u2[1]], lb = Math.hypot(bis[0], bis[1]);
      const dc = r / Math.sin(ang / 2), c = [x1 + bis[0] / lb * dc, y1 + bis[1] / lb * dc];
      const t0 = Math.atan2(a[1] - c[1], a[0] - c[0]), t1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
      ctx.lineTo(a[0], a[1]);
      ctx.arc(c[0], c[1], r, t0, t1, cruz > 0);
    },
    rect(x, y, w, h){ ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); },
    roundRect(x, y, w, h, r){
      const rr = Math.max(0, Math.min(Array.isArray(r) ? +r[0] || 0 : +r || 0, Math.abs(w) / 2, Math.abs(h) / 2));
      if (!rr) return ctx.rect(x, y, w, h);
      ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
    },

    stroke(){ pinta('S'); },
    fill(regra){ pinta(regra === 'evenodd' ? 'f*' : 'f'); },
    clip(){ /* o desenho da folha nao recorta; ignorado */ },
    strokeRect(x, y, w, h){ const sv = [cam, cur, ini]; ctx.beginPath(); ctx.rect(x, y, w, h); pinta('S'); [cam, cur, ini] = sv; },
    fillRect(x, y, w, h){ const sv = [cam, cur, ini]; ctx.beginPath(); ctx.rect(x, y, w, h); pinta('f'); [cam, cur, ini] = sv; },
    clearRect(){ /* papel branco: nada a limpar */ },

    measureText(s){
      const f = fonteDe(st.font), wr = W();
      const w = wr ? wr.larguraTexto(String(s), f.fonte, f.tam) : String(s).length * f.tam * 0.55;
      return { width:w, actualBoundingBoxAscent:f.tam * 0.72, actualBoundingBoxDescent:f.tam * 0.21, fontBoundingBoxAscent:f.tam * 0.8, fontBoundingBoxDescent:f.tam * 0.2 };
    },
    fillText(s, x, y){
      const c = cor(st.fill);
      if (c.a * st.alpha <= 0.01 || s == null || s === '') return;
      const f = fonteDe(st.font);
      /* o glifo do PDF cresce para cima; o do canvas, para cima NO APARELHO (Y para baixo): vira Y antes */
      const m = mul(st.m, [1, 0, 0, -1, x, y]);
      pg.salva(); pg.matriz(m[0], m[1], m[2], m[3], m[4], m[5]);
      pg.texto(0, 0, String(s), { fonte:f.fonte, tam:f.tam, cor:c.hex, alinha:ALINHA[st.align] || 'esq', base:BASE[st.base] || 'base' });
      pg.restaura();
    },
    strokeText(s, x, y){ ctx.fillText(s, x, y); },
    drawImage(img, a, b, c, d, e, f, g, h){
      let x, y, w, hh;
      if (arguments.length >= 9) { x = e; y = f; w = g; hh = h; }       /* o recorte da origem e ignorado */
      else { x = a; y = b; w = c; hh = d; }
      const iw = img && (img.naturalWidth || img.width), ih = img && (img.naturalHeight || img.height);
      if (!iw || !ih) return;
      if (w == null) { w = iw; hh = ih; }
      const nome = nomeImagem(img, iw, ih);
      if (!nome) return;
      const m = mul(st.m, [w, 0, 0, -hh, x, y + hh]);
      pg.salva(); pg.matriz(m[0], m[1], m[2], m[3], m[4], m[5]); pg.imagem(nome, 0, 0, 1, 1); pg.restaura();
    },
  };

  function nomeImagem(img, iw, ih){
    if (imagens.has(img)) return imagens.get(img);
    let nome = null;
    try {
      const L = Math.min(iw, 1600), A = Math.round(ih * L / iw);
      const cv = document.createElement('canvas');
      cv.width = L; cv.height = A;
      const c2 = cv.getContext('2d');
      c2.drawImage(img, 0, 0, L, A);
      const px = c2.getImageData(0, 0, L, A).data;
      const rgb = new Uint8Array(L * A * 3), alfa = new Uint8Array(L * A);
      let temAlfa = false;
      for (let i = 0, j = 0, k = 0; i < px.length; i += 4) { rgb[j++] = px[i]; rgb[j++] = px[i + 1]; rgb[j++] = px[i + 2]; alfa[k] = px[i + 3]; if (px[i + 3] < 255) temAlfa = true; k++; }
      nome = doc.imagem(temAlfa ? { rgb, w:L, h:A, alfa } : { rgb, w:L, h:A });
    } catch (e) { nome = null; }       /* imagem de outra origem (canvas sujo) ou sem DOM: fica de fora */
    imagens.set(img, nome);
    return nome;
  }

  function pinta(op){
    if (!cam.length) return;
    const c = cor(op === 'S' ? st.stroke : st.fill);
    if (c.a * st.alpha <= 0.01) return;
    const esc = escalaDe(st.m);
    if (op === 'S') {
      pg.corTraco(c.hex);
      pg.espessura(st.lw * esc);
      pg.pontas(st.cap === 'round' ? 'redonda' : st.cap === 'square' ? 'quadrada' : 'reta');
      pg.tracejado(st.dash.length ? (st.dash.length % 2 ? st.dash.concat(st.dash) : st.dash).map(v => v * esc) : []);
    } else pg.corFundo(c.hex);
    for (const s of cam) {
      if (s[0] === 'm') pg.move(s[1][0], s[1][1]);
      else if (s[0] === 'l') pg.reta(s[1][0], s[1][1]);
      else if (s[0] === 'c') pg.curva(s[1][0], s[1][1], s[2][0], s[2][1], s[3][0], s[3][1]);
      else pg.fecha();
    }
    if (op === 'S') pg.traca(); else pg.preenche(op === 'f*');
  }
  return ctx;
}

async function gera(o){
  const wr = W();
  if (!wr) throw new Error('o hub-pdfwriter.js não carregou');
  const un = o.unidade || 1;
  const doc = wr.novo({ titulo:o.titulo || 'Esquema', autor:o.autor || '', assunto:o.assunto || 'Esquema elétrico', criador:'NexoEletric' });
  for (const f of o.folhas || []) {
    const pg = doc.pagina(f.largura * un, f.altura * un);
    pg.corFundo('#ffffff').retangulo(0, 0, f.largura * un, f.altura * un).preenche();
    const ctx = contexto(doc, pg, { largura:f.largura, altura:f.altura, unidade:un });
    f.desenha(ctx);
  }
  return doc.bytesAsync ? doc.bytesAsync() : doc.bytes();
}

return { contexto, gera, cor, fonteDe, arcoBezier };
});
