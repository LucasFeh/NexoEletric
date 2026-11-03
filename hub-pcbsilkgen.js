/* NexoEletric - hub-pcbsilkgen.js — Imagem ou texto -> serigrafia, na vista PCB.

   Pedido do dono (2026-11-03): "Falta uma ferramenta que converta imagem ou texto em serigrafia."
   A conta (mascara, contornos com os miolos, a escala para a placa, as ops) e do motor hub-silkgen.js
   (HubSilkGen), o mesmo que o MCP usa; aqui e so a conversa com a pessoa, no tema do hub e sem
   nenhum dialogo do navegador:
     - aba IMAGEM: um arquivo que o navegador abra (PNG, JPG, SVG, BMP, GIF, WebP...), arrastado para
       o dialogo, escolhido ou colado (Ctrl+V); limiar, inverter, transparente = fundo, e a largura ou
       a altura do desenho na placa (o outro lado segue a proporcao);
     - aba TEXTO: o texto (Enter quebra a linha), a fonte (as do Windows ou qualquer nome instalado),
       negrito/italico e a altura da letra MAIUSCULA em mm. O texto e desenhado num canvas em alta
       resolucao (~20 px por 0,1 mm, com teto) e segue o mesmo caminho da imagem;
     - comum: a face (Top Overlay, ou Bottom Overlay espelhado: le-se certo olhando a placa por
       baixo), o giro e a simplificacao do contorno;
     - a PREVIA: as regioes com os furos (evenodd), o tamanho em mm, as regioes e os vertices, e os
       avisos do motor (traco abaixo de 0,15 mm, pedaco descartado...).
   Colocar escreve as region_add (com holes) no centro da vista, como uma edicao: elas ficam
   selecionadas para arrastar e girar, o Ctrl+Z desfaz e o Salvar/autosave grava o changes.js. Mais
   de LIMITE_VERTICES vertices pergunta antes (HubDialog.confirm).

   HubPcbSilkGen.abre(V) -> o controle { fecha(), aba(id), resultado(), coloca() } (ou null)
   V, o que a vista da:
     centro()      {x, y} em mm, onde a arte nasce (o centro da vista, dentro da placa)
     face()        'Top' | 'Bottom' — a face da camada atual (o padrao do dialogo)
     corCamada(k)  a cor da camada (a previa pinta nela)
     aplica(ops)   escreve as ops como edicao da vista e as seleciona -> quantas entraram
     toast(t, tipo, ms)
     silk          (opcional) o motor; sem ele, o global HubSilkGen
   HubPcbSilkGen.atual() -> o controle aberto (ou null).

   As contas puras (o tamanho do raster do texto e da imagem, a escala px -> mm, a nota das ops, o
   caminho inteiro com o motor) sao exportadas para o tests/test-pcbsilkgen.js, que roda em Node. */
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubPcbSilkGen = m;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* as fontes que todo Windows tem; "Outra" deixa digitar qualquer nome instalado */
const FONTES = ['Arial', 'Calibri', 'Segoe UI', 'Times New Roman', 'Consolas', 'Verdana', 'Tahoma'];
const PX_POR_MM = 200;            /* o texto: ~20 px por 0,1 mm de letra maiuscula */
const LIMITE_VERTICES = 2000;     /* acima disso, pergunta antes de colocar */
const LARGURA_MIN = 0.15;         /* o traco minimo de serigrafia da casa (mm) */
/* a tolerancia do Ramer-Douglas-Peucker do motor (mm); o padrao do motor e 0,02 */
const SIMPLIFICAR = [[0, 'Nenhuma'], [0.005, 'Fina (0,005 mm)'], [0.01, 'Média (0,01 mm)'], [0.02, 'Normal (0,02 mm)'], [0.05, 'Grossa (0,05 mm)']];
const GIROS = [0, 90, 180, 270];
const PREF = 'altiumhub.pcb.serigrafia';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function num(v, d) {
  const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return isFinite(n) ? n : d;
}
const r6 = v => Math.round(v * 1e6) / 1e6;
const nf = (v, casas) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: casas == null ? 2 : casas });

/* ============================== contas puras ============================== */

/* a face de uma camada: tudo que comeca por Bottom e de baixo */
function faceDe(k) { return /^Bottom/.test(String(k || '')) ? 'Bottom' : 'Top'; }
function camadaDaFace(f) { return f === 'Bottom' ? 'BottomOverlay' : 'TopOverlay'; }

/* o ctx.font: o nome da familia entre aspas (sem as aspas, a barra e o ponto e virgula de quem digitou) */
function limpaFamilia(f) { return String(f || '').replace(/["'\\;{}]/g, '').replace(/\s+/g, ' ').trim(); }
function fonteCss(familia, negrito, italico, px) {
  const fam = limpaFamilia(familia) || 'Arial';
  return (italico ? 'italic ' : '') + (negrito ? 'bold ' : '') + Math.max(1, Math.round(px)) + 'px "' + fam + '", sans-serif';
}

/* O raster do texto. med: as medidas da fonte por px de corpo, tomadas num canvas de prova —
     cap      altura da maiuscula ('H') / corpo
     asc,desc a caixa da fonte acima e abaixo da linha de base / corpo
     larguras [a largura de cada linha / corpo] (a maior entre o avanco e a tinta: o italico passa)
   A altura pedida e a da MAIUSCULA (o "texto de 1 mm" de quem mede a placa). O passo e PX_POR_MM
   px por mm de maiuscula, entre capMin e capMax px; se o canvas passar do lado ou da area maxima
   (o canvas do navegador e o getImageData tem teto), a resolucao cai e `reduzido` avisa.
   -> { fontPx, capPx, w, h, margem, linha, base0, mmPorPx, reduzido } | null */
function dimensionaTexto(alturaMm, med, o) {
  o = o || {};
  const h = num(alturaMm, 0);
  if (!(h > 0) || !med) return null;
  const pxmm = o.pxPorMm || PX_POR_MM, capMin = o.capMin || 48, capMax = o.capMax || 480;
  const ladoMax = o.ladoMax || 8192, areaMax = o.areaMax || 24e6;
  const cap = med.cap > 0 ? med.cap : 0.716, asc = med.asc > 0 ? med.asc : 0.905, desc = med.desc >= 0 ? med.desc : 0.212;
  const ls = Array.isArray(med.larguras) && med.larguras.length ? med.larguras : [0];
  const larg = Math.max(0.05, ...ls.map(x => (x > 0 ? x : 0)));
  const n = ls.length;
  const mede = capPx => {
    const fontPx = capPx / cap;
    const margem = Math.ceil(fontPx * 0.15) + 4;
    const linha = Math.max(asc + desc, 1.2) * fontPx;
    const w = Math.ceil(larg * fontPx + 2 * margem);
    const hh = Math.ceil((asc + desc) * fontPx + (n - 1) * linha + 2 * margem);
    return { fontPx, capPx, w, h:hh, margem, linha, base0:margem + asc * fontPx };
  };
  let capPx = clamp(h * pxmm, capMin, capMax), d = mede(capPx), reduzido = false;
  for (let i = 0; i < 6 && (d.w > ladoMax || d.h > ladoMax || d.w * d.h > areaMax); i++) {
    const s = Math.min(ladoMax / d.w, ladoMax / d.h, Math.sqrt(areaMax / (d.w * d.h))) * 0.98;
    capPx = Math.max(6, Math.floor(capPx * s));
    d = mede(capPx); reduzido = true;
    if (capPx === 6) break;
  }
  d.mmPorPx = h / capPx;
  d.reduzido = reduzido;
  return d;
}

/* O raster da imagem: o lado maior entre ladoMin e ladoMax (bitmap pequeno sobe, com suavizacao: o
   limiar de um bitmap ampliado da contorno liso; o grande desce). Vetor (SVG) sempre no ladoMax.
   Sem tamanho natural (SVG so com viewBox), um quadrado. -> { w, h, fator } */
function dimensionaImagem(nw, nh, vetor, o) {
  o = o || {};
  const ladoMax = o.ladoMax || 2048, ladoMin = o.ladoMin || 768;
  if (!(nw > 0 && nh > 0)) { nw = 1; nh = 1; vetor = true; }
  const lado = Math.max(nw, nh);
  const alvo = vetor ? ladoMax : clamp(lado, ladoMin, ladoMax);
  const f = alvo / lado;
  return { w:Math.max(1, Math.round(nw * f)), h:Math.max(1, Math.round(nh * f)), fator:f };
}

/* a caixa dos contornos de fora (os furos estao dentro deles) */
function caixa(polys) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of polys || []) for (const q of (p && p.pts) || []) {
    if (q[0] < x1) x1 = q[0]; if (q[0] > x2) x2 = q[0];
    if (q[1] < y1) y1 = q[1]; if (q[1] > y2) y2 = q[1];
  }
  if (!(x2 >= x1 && y2 >= y1)) return null;
  return { x1, y1, x2, y2, w:x2 - x1, h:y2 - y1 };
}
function contaVertices(polys) {
  let n = 0;
  for (const p of polys || []) {
    n += ((p && p.pts) || []).length;
    for (const f of (p && p.holes) || []) n += (f || []).length;
  }
  return n;
}
/* mm por px da imagem: a largura (ou a altura) pedida sobre a da tinta */
function escalaImagem(bbPx, medida, mm) {
  const v = num(mm, 0);
  if (!bbPx || !(v > 0)) return 0;
  const lado = medida === 'altura' ? bbPx.h : bbPx.w;
  return lado > 0 ? v / lado : 0;
}

/* A garantia do tamanho e do lugar: o lado maior da arte = maxMm e o centro da caixa = (x, y). Se o
   motor ja entregou assim (o normal), nada muda; se a escala dele quisesse dizer outra coisa, a
   arte sai do tamanho pedido do mesmo jeito. Vale para qualquer giro multiplo de 90. */
function normaliza(polys, alvo) {
  const bb = caixa(polys);
  if (!bb || !alvo) return polys || [];
  const lado = Math.max(bb.w, bb.h);
  let f = alvo.maxMm > 0 && lado > 0 ? alvo.maxMm / lado : 1;
  if (Math.abs(f - 1) < 0.01) f = 1;
  const cx = (bb.x1 + bb.x2) / 2, cy = (bb.y1 + bb.y2) / 2, x = num(alvo.x, 0), y = num(alvo.y, 0);
  if (f === 1 && Math.abs(cx - x) < 1e-4 && Math.abs(cy - y) < 1e-4) return polys;
  const t = q => [r6((q[0] - cx) * f + x), r6((q[1] - cy) * f + y)];
  return polys.map(p => {
    const o = Object.assign({}, p, { pts:(p.pts || []).map(t) });
    if (Array.isArray(p.holes)) o.holes = p.holes.map(h => (h || []).map(t));
    return o;
  });
}

/* as ops levadas de (dx, dy): a previa e gerada em (0, 0) e o Colocar a leva ao centro da vista */
function desloca(ops, dx, dy) {
  const t = q => [r6(q[0] + dx), r6(q[1] + dy)];
  return (ops || []).map(op => {
    const o = Object.assign({}, op, { pts:(op.pts || []).map(t) });
    if (Array.isArray(op.holes)) o.holes = op.holes.map(h => (h || []).map(t));
    return o;
  });
}

/* A nota das ops: o que a arte e, sem nada que quebre o leitor de linha do ApplyChanges (a
   sequencia `":`, a barra) — as aspas viram as tipograficas. */
function notaDe(tipo, nome) {
  let s = String(nome == null ? '' : nome).replace(/\r?\n/g, ' / ').replace(/[\u0000-\u001f\u007f"\\]/g, '').replace(/\s+/g, ' ').trim();
  if (s.length > 48) s = s.slice(0, 47).trimEnd() + '…';
  if (tipo === 'texto') return 'serigrafia de texto “' + s + '”';
  return 'serigrafia de imagem' + (s ? ' ' + s : '');
}

/* os avisos do motor e as descartadas, agrupadas por motivo, em portugues de gente */
function avisosDe(r) {
  const out = [];
  for (const a of (r && r.avisos) || []) if (a) out.push(typeof a === 'string' ? a : (a.msg || a.motivo || JSON.stringify(a)));
  const por = new Map();
  for (const d of (r && r.descartadas) || []) {
    const m = (d && (d.motivo || d.msg)) || 'descartada';
    por.set(m, (por.get(m) || 0) + 1);
  }
  for (const [m, n] of por) out.push(n + (n === 1 ? ' pedaço descartado: ' : ' pedaços descartados: ') + m);
  return out;
}

/* O caminho inteiro, com o motor HS: rgba -> mascara -> contornos (px, y para baixo) -> placa (mm, Y
   para cima, no centro x,y) -> region_add. o:
     limiar, inverter, alfa, areaMin   a mascara (imagem; o texto vai preto no branco)
     mmPorPx                           a escala ja conhecida (texto); sem ela, medida+mm (imagem)
     medida ('largura'|'altura'), mm   o tamanho da arte na placa (imagem)
     face, rot, simplificar, x, y      a placa
     nota, larguraMin                  as ops
   -> { ops, polys (as da placa), vertices, regioes, caixa, area_mm2, avisos:[texto], mmPorPx, caixaPx, vazio } */
function gera(HS, fonte, o) {
  o = o || {};
  if (!HS || !fonte || !fonte.rgba) throw new Error('sem motor ou sem imagem');
  const masc = HS.mascaraDeRGBA(fonte.rgba, fonte.w, fonte.h, { limiar:num(o.limiar, 128), inverter:!!o.inverter, alfa:o.alfa !== false });
  const px = HS.contornos(masc, { areaMin:o.areaMin == null ? 4 : o.areaMin }) || [];
  const bb = caixa(px);
  const vazio = { ops:[], polys:[], vertices:0, regioes:0, caixa:null, area_mm2:0, avisos:[], mmPorPx:0, caixaPx:bb, vazio:true };
  if (!bb || !(bb.w > 0) || !(bb.h > 0)) { vazio.avisos.push('nada para virar serigrafia: confira o limiar ou o inverter'); return vazio; }
  const k = o.mmPorPx > 0 ? o.mmPorPx : escalaImagem(bb, o.medida, o.mm);
  if (!(k > 0)) { vazio.avisos.push('diga o tamanho da arte na placa (mm)'); return vazio; }
  const x = num(o.x, 0), y = num(o.y, 0), rot = num(o.rot, 0);
  let mm = HS.paraPlaca(px, { x, y, escala:k, espelhar:o.face === 'Bottom', rot, simplificar:num(o.simplificar, 0) }) || [];
  const info = mm.info || {};
  mm = normaliza(mm, { x, y, maxMm:Math.max(bb.w, bb.h) * k });
  const r = Object.assign({}, HS.opsDe(mm, { layer:camadaDaFace(o.face), note:o.nota || '', larguraMin:o.larguraMin > 0 ? o.larguraMin : LARGURA_MIN }) || {});
  /* o que a simplificacao do paraPlaca ja descartou ou refez conta junto com o do opsDe */
  if (Array.isArray(info.descartadas) && info.descartadas.length) r.descartadas = info.descartadas.concat(r.descartadas || []);
  if (info.refeitos > 0) r.avisos = (r.avisos || []).concat([info.refeitos + ' polígono(s) simplificados com tolerância menor (a pedida cruzava os lados)']);
  const ops = Array.isArray(r.ops) ? r.ops.filter(op => op && op.op === 'region_add' && Array.isArray(op.pts) && op.pts.length >= 3) : [];
  const polys = ops.map(op => ({ pts:op.pts, holes:op.holes || [] }));
  const cx = caixa(polys);
  return { ops, polys, vertices:contaVertices(polys), regioes:ops.length,
           caixa:cx, area_mm2:num(r.area_mm2, 0), avisos:avisosDe(r), mmPorPx:k, caixaPx:bb, vazio:!ops.length };
}

/* ============================== a conversa (navegador) ============================== */

const CSS = `
.sg-scrim{position:fixed; inset:0; z-index:8800; display:flex; align-items:center; justify-content:center; padding:16px;
  background:var(--scrim,rgba(11,11,13,.55)); font:13px/1.45 var(--font,"Segoe UI",system-ui,sans-serif); color:var(--text,#e6e6e6);}
.sg-box{width:min(760px, 100%); max-height:calc(100vh - 32px); overflow:auto; padding:16px 18px 14px; background:var(--surface,#232326);
  color:var(--text,#e6e6e6); border-radius:var(--r-md,8px); box-shadow:var(--shadow-menu, 0 0 0 1px #3a3a3a, 0 18px 44px rgba(0,0,0,.6));}
.sg-box h3{margin:0 0 4px; font-size:14px; font-weight:600; letter-spacing:-.01em;}
.sg-box [hidden]{display:none !important;}
.sg-sub{margin:0 0 10px; color:var(--text-2,#a8a8ae); font-size:12px;}
.sg-un{color:var(--text-2,#a8a8ae); font-size:12px;}
.sg-abas{display:flex; gap:2px; margin:0 0 10px; border-bottom:1px solid var(--edge,#34343a);}
.sg-abas button{background:transparent; border:0; border-bottom:2px solid transparent; color:var(--text-2,#a8a8ae); padding:5px 12px 6px;
  font:inherit; cursor:pointer; margin-bottom:-1px;}
.sg-abas button[aria-selected="true"]{color:var(--text,#e6e6e6); border-bottom-color:var(--hi,#d8d8dd); font-weight:600;}
.sg-abas button:focus-visible{outline:2px solid var(--hi,#d8d8dd); outline-offset:-2px;}
.sg-corpo{display:grid; grid-template-columns:minmax(0,1fr) minmax(0,330px); gap:14px;}
@media (max-width:640px){ .sg-corpo{grid-template-columns:minmax(0,1fr);} }
.sg-ctl{min-width:0;}
.sg-linha{display:flex; align-items:center; gap:8px; margin:0 0 8px; flex-wrap:wrap;}
.sg-linha > label:first-child{flex:0 0 92px; color:var(--text-2,#a8a8ae); font-size:12px;}
.sg-linha select,.sg-linha input[type=text],.sg-linha input[type=number],.sg-ctl textarea{background:var(--surface-2,#1b1b1e); color:var(--text,#e6e6e6);
  border:1px solid var(--edge,#34343a); border-radius:var(--r-sm,4px); padding:4px 7px; font:inherit; min-width:0;}
.sg-linha select{flex:1;}
.sg-linha input[type=number]{width:86px;}
.sg-linha input[type=text]{flex:1;}
.sg-linha input[type=range]{flex:1; min-width:80px; accent-color:var(--hi,#d8d8dd);}
.sg-linha output{width:30px; text-align:right; font-variant-numeric:tabular-nums; color:var(--text-2,#a8a8ae);}
.sg-linha .sg-ck{display:inline-flex; align-items:center; gap:6px; cursor:pointer; color:var(--text,#e6e6e6); font-size:12.5px;}
.sg-linha .sg-ck input{margin:0; accent-color:var(--hi,#d8d8dd);}
.sg-ctl textarea{width:100%; resize:vertical; min-height:46px; margin:0 0 8px; display:block;}
.sg-ctl select:focus-visible,.sg-ctl input:focus-visible,.sg-ctl textarea:focus-visible{outline:2px solid var(--hi,#d8d8dd); outline-offset:1px;}
.sg-arq{display:flex; align-items:center; gap:10px; margin:0 0 10px; padding:10px; border:1px dashed var(--edge,#44444a);
  border-radius:var(--r-sm,4px); background:var(--surface-2,#1b1b1e);}
.sg-arq.arrasta{border-color:var(--hi,#d8d8dd);}
.sg-arq span{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-2,#a8a8ae); font-size:12px;}
.sg-sep{height:1px; background:var(--edge,#34343a); margin:6px 0 10px;}
.sg-prev{display:flex; flex-direction:column; gap:6px; min-width:0;}
.sg-prev canvas{width:100%; height:220px; display:block; border-radius:var(--r-sm,4px); background:#000; box-shadow:0 0 0 1px var(--edge,#34343a);}
.sg-info{margin:0; font-size:12px; font-variant-numeric:tabular-nums; color:var(--text,#e6e6e6);}
.sg-info.vazio{color:var(--text-3,#8a8a90);}
.sg-avisos{margin:0; padding:0 0 0 16px; font-size:11.5px; color:var(--warn,#d6a75a); max-height:110px; overflow:auto;}
.sg-btns{display:flex; gap:8px; justify-content:flex-end; margin-top:12px;}
.sg-btns button,.sg-arq button{background:transparent; color:var(--text,#e6e6e6); border:1px solid var(--edge,#3a3a3a); border-radius:var(--r-sm,4px);
  padding:6px 14px; font:inherit; font-size:12px; cursor:pointer; min-width:84px;}
.sg-btns button:hover:not(:disabled),.sg-arq button:hover{background:rgba(var(--tint,255,255,255),.07);}
.sg-btns button.ok{color:var(--hi,#d8d8dd); border-color:var(--hi,#d8d8dd);}
.sg-btns button:disabled{opacity:.4; cursor:default;}
.sg-btns button:focus-visible,.sg-arq button:focus-visible{outline:2px solid var(--hi,#d8d8dd); outline-offset:1px;}
`;
let estilo = false, atual = null;
function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function botao(txt, cls, fn) { const b = el('button', cls || null, txt); b.type = 'button'; b.addEventListener('click', fn); return b; }
function poeEstilo() { if (estilo) return; estilo = true; const s = el('style'); s.textContent = CSS; document.head.appendChild(s); }
function lePrefs() { try { const o = JSON.parse(localStorage.getItem(PREF) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
function gravaPrefs(o) { try { localStorage.setItem(PREF, JSON.stringify(o)); } catch (e) { /* sem armazenamento: so nao lembra */ } }
const motor = V => (V && V.silk) || (typeof HubSilkGen !== 'undefined' ? HubSilkGen : null);

/* a fonte esta instalada? a largura de uma frase com ela e com o generico de reserva: se as duas
   reservas (mono e serif) dao igual a sem ela, o navegador caiu na reserva */
function fonteExiste(fam) {
  const f = limpaFamilia(fam);
  if (!f) return false;
  try {
    const c = document.createElement('canvas').getContext('2d'), s = 'mmmmmmmmmmlliWWg@#';
    for (const g of ['monospace', 'serif']) {
      c.font = '72px ' + g; const a = c.measureText(s).width;
      c.font = '72px "' + f + '", ' + g; const b = c.measureText(s).width;
      if (Math.abs(a - b) > 0.5) return true;
    }
  } catch (e) { return true; }
  return false;
}

/* o texto em canvas: preto no branco, centrado linha a linha -> { rgba, w, h, mmPorPx, reduzido } | null */
function rasterTexto(txt, fam, negrito, italico, alturaMm) {
  const linhas = String(txt || '').replace(/\r/g, '').split('\n');
  while (linhas.length && !linhas[linhas.length - 1].trim()) linhas.pop();
  if (!linhas.length || !linhas.some(l => l.trim())) return null;
  const P = 100;
  const prova = document.createElement('canvas').getContext('2d');
  prova.font = fonteCss(fam, negrito, italico, P);
  const mH = prova.measureText('H');
  const med = {
    cap:(mH.actualBoundingBoxAscent || 0.716 * P) / P,
    asc:(mH.fontBoundingBoxAscent || 0.905 * P) / P,
    desc:(mH.fontBoundingBoxDescent != null ? mH.fontBoundingBoxDescent : 0.212 * P) / P,
    larguras:linhas.map(l => { const m = prova.measureText(l); return Math.max(m.width, (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0)) / P; }),
  };
  const d = dimensionaTexto(alturaMm, med);
  if (!d) return null;
  const cv = document.createElement('canvas'); cv.width = d.w; cv.height = d.h;
  const c = cv.getContext('2d', { willReadFrequently:true });
  c.fillStyle = '#fff'; c.fillRect(0, 0, d.w, d.h);
  c.fillStyle = '#000'; c.font = fonteCss(fam, negrito, italico, d.fontPx);
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  linhas.forEach((l, i) => c.fillText(l, d.w / 2, d.base0 + i * d.linha));
  return { rgba:c.getImageData(0, 0, d.w, d.h).data, w:d.w, h:d.h, mmPorPx:d.mmPorPx, reduzido:d.reduzido };
}
/* a imagem em canvas, no tamanho do dimensionaImagem; a transparencia fica (o motor decide pelo alfa) */
function rasterImagem(img, vetor) {
  const d = dimensionaImagem(img.naturalWidth || img.width, img.naturalHeight || img.height, vetor);
  const cv = document.createElement('canvas'); cv.width = d.w; cv.height = d.h;
  const c = cv.getContext('2d', { willReadFrequently:true });
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(img, 0, 0, d.w, d.h);
  return { rgba:c.getImageData(0, 0, d.w, d.h).data, w:d.w, h:d.h };
}

/* a previa: as regioes com os furos (evenodd), Y para cima, ajustadas ao canvas */
function desenhaPrevia(cv, polys, cor) {
  const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
  const W = Math.max(1, cv.clientWidth || 320), H = Math.max(1, cv.clientHeight || 220);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const c = cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
  const bb = caixa(polys);
  if (!bb) return;
  const pad = 12, s = Math.min((W - 2 * pad) / Math.max(bb.w, 1e-6), (H - 2 * pad) / Math.max(bb.h, 1e-6));
  const ox = W / 2 - (bb.x1 + bb.x2) / 2 * s, oy = H / 2 + (bb.y1 + bb.y2) / 2 * s;
  c.setTransform(dpr * s, 0, 0, -dpr * s, dpr * ox, dpr * oy);
  c.beginPath();
  const anel = l => { if (!l || l.length < 3) return; c.moveTo(l[0][0], l[0][1]); for (let i = 1; i < l.length; i++) c.lineTo(l[i][0], l[i][1]); c.closePath(); };
  for (const p of polys) { anel(p.pts); for (const f of p.holes || []) anel(f); }
  c.fillStyle = cor || '#ffff00';
  c.fill('evenodd');
}

function abre(V) {
  if (atual) atual.fecha();
  if (typeof document === 'undefined') return null;
  const HS = motor(V);
  if (!HS || typeof HS.mascaraDeRGBA !== 'function' || typeof HS.contornos !== 'function' || typeof HS.paraPlaca !== 'function' || typeof HS.opsDe !== 'function') {
    const t = 'serigrafia: o motor hub-silkgen.js não carregou nesta página — atualize com F5';
    if (V && V.toast) V.toast(t, 'warn'); else if (typeof HubDialog !== 'undefined') HubDialog.toast(t, 'warn');
    return null;
  }
  poeEstilo();
  const P = Object.assign({ aba:'imagem', limiar:128, inverter:false, alfa:true, medida:'largura', mm:10, texto:'', fonte:'Arial', outra:'',
    negrito:false, italico:false, altura:1.5, rot:0, simplificar:0.01 }, lePrefs());
  P.face = V.face ? (V.face() === 'Bottom' ? 'Bottom' : 'Top') : 'Top';
  const S = { img:null, nome:'', vetor:false, rasterImg:null, rasterTxt:null, chaveTxt:'', res:null, erro:'', timer:0, ocupado:false, url:null };
  const C = { fecha:null, aba:null, resultado:() => S.res, coloca:null };

  /* ---------- o DOM ---------- */
  const scrim = el('div', 'sg-scrim');
  const box = el('div', 'sg-box'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Imagem ou texto → serigrafia');
  box.append(el('h3', null, 'Imagem ou texto → serigrafia'),
    el('p', 'sg-sub', 'Um logo ou um texto vira regiões de serigrafia, com os miolos vazados. Nasce no centro da vista, selecionado: arraste para o lugar.'));
  const abas = el('div', 'sg-abas'); abas.setAttribute('role', 'tablist');
  const abaImg = el('button', null, 'Imagem'), abaTxt = el('button', null, 'Texto');
  for (const b of [abaImg, abaTxt]) { b.type = 'button'; b.setAttribute('role', 'tab'); abas.append(b); }
  const corpo = el('div', 'sg-corpo'), ctl = el('div', 'sg-ctl'), prev = el('div', 'sg-prev');
  corpo.append(ctl, prev);

  const linha = (rot, ...filhos) => { const l = el('div', 'sg-linha'); const lb = el('label', null, rot); l.append(lb, ...filhos); return l; };
  const check = (rot, v, dica) => { const lb = el('label', 'sg-ck'); const c = el('input'); c.type = 'checkbox'; c.checked = !!v; lb.append(c, document.createTextNode(rot)); if (dica) lb.title = dica; return { lb, c }; };
  const numero = (v, min, max, passo) => { const i = el('input'); i.type = 'number'; i.min = String(min); i.max = String(max); i.step = String(passo); i.value = String(v); return i; };
  const seletor = (ops, v) => { const s = el('select'); for (const [k, r] of ops) { const o = el('option', null, r); o.value = String(k); s.append(o); } s.value = String(v); return s; };

  /* aba Imagem */
  const secImg = el('div');
  const arq = el('div', 'sg-arq');
  const inpArq = el('input'); inpArq.type = 'file'; inpArq.accept = 'image/*,.svg,.bmp,.ico,.webp'; inpArq.hidden = true;
  const nomeArq = el('span', null, 'arraste, escolha ou cole (Ctrl+V) uma imagem');
  arq.append(botao('Escolher…', null, () => inpArq.click()), nomeArq, inpArq);
  const limiar = el('input'); limiar.type = 'range'; limiar.min = '1'; limiar.max = '254'; limiar.step = '1'; limiar.value = String(P.limiar);
  const limiarV = el('output', null, String(P.limiar));
  const inverter = check('Inverter (o claro vira tinta)', P.inverter, 'Para arte clara sobre fundo escuro');
  const alfa = check('Transparente é fundo', P.alfa, 'O que é transparente no PNG/SVG não vira tinta');
  const medida = seletor([['largura', 'Largura'], ['altura', 'Altura']], P.medida);
  const mm = numero(P.mm, 0.5, 500, 0.5);
  secImg.append(arq, linha('Limiar', limiar, limiarV), linha('', inverter.lb, alfa.lb), linha('Tamanho', medida, mm, el('span', 'sg-un', 'mm')));

  /* aba Texto */
  const secTxt = el('div');
  const txt = el('textarea'); txt.rows = 2; txt.placeholder = 'texto (Enter quebra a linha)'; txt.value = P.texto; txt.spellcheck = false;
  const fonte = seletor(FONTES.map(f => [f, f]).concat([['__outra', 'Outra…']]), FONTES.includes(P.fonte) ? P.fonte : '__outra');
  const outra = el('input'); outra.type = 'text'; outra.placeholder = 'nome da fonte instalada'; outra.value = FONTES.includes(P.fonte) ? P.outra : (P.fonte || P.outra);
  const negrito = check('Negrito', P.negrito), italico = check('Itálico', P.italico);
  const altura = numero(P.altura, 0.3, 100, 0.1);
  const linhaOutra = linha('', outra);
  const avisoFonte = el('p', 'sg-sub'); avisoFonte.hidden = true;
  secTxt.append(txt, linha('Fonte', fonte), linhaOutra, avisoFonte, linha('', negrito.lb, italico.lb),
    linha('Altura', altura, el('span', 'sg-un', 'mm (da maiúscula)')));

  /* comum */
  const face = seletor([['Top', 'Top Overlay (de cima)'], ['Bottom', 'Bottom Overlay (de baixo, espelhado)']], P.face);
  const giro = seletor(GIROS.map(g => [g, g + '°']), GIROS.includes(+P.rot) ? +P.rot : 0);
  const simp = seletor(SIMPLIFICAR, SIMPLIFICAR.some(s => s[0] === +P.simplificar) ? +P.simplificar : 0.01);
  ctl.append(secImg, secTxt, el('div', 'sg-sep'), linha('Face', face), linha('Giro', giro), linha('Simplificar', simp));

  /* a previa */
  const cv = el('canvas'); cv.setAttribute('aria-label', 'prévia da serigrafia');
  const info = el('p', 'sg-info vazio', '—');
  const avisos = el('ul', 'sg-avisos');
  prev.append(cv, info, avisos);

  const btns = el('div', 'sg-btns');
  const ok = botao('Colocar', 'ok', () => coloca());
  btns.append(botao('Cancelar', null, () => C.fecha()), ok);
  box.append(abas, corpo, btns);
  scrim.append(box);
  document.body.append(scrim);

  /* ---------- o estado na tela ---------- */
  const familia = () => (fonte.value === '__outra' ? limpaFamilia(outra.value) : fonte.value);
  function pintaAba() {
    abaImg.setAttribute('aria-selected', String(P.aba === 'imagem')); abaTxt.setAttribute('aria-selected', String(P.aba === 'texto'));
    secImg.hidden = P.aba !== 'imagem'; secTxt.hidden = P.aba !== 'texto';
    linhaOutra.hidden = fonte.value !== '__outra';
  }
  function guarda() {
    Object.assign(P, { limiar:+limiar.value, inverter:inverter.c.checked, alfa:alfa.c.checked, medida:medida.value, mm:num(mm.value, P.mm),
      texto:txt.value, fonte:familia() || 'Arial', outra:outra.value, negrito:negrito.c.checked, italico:italico.c.checked,
      altura:num(altura.value, P.altura), face:face.value, rot:+giro.value, simplificar:+simp.value });
    const p = Object.assign({}, P); delete p.face;       /* a face segue a camada atual da vista */
    gravaPrefs(p);
  }
  function opcoes(x, y, nota) {
    const o = { face:P.face, rot:P.rot, simplificar:P.simplificar, x, y, nota, larguraMin:LARGURA_MIN };
    if (P.aba === 'imagem') return Object.assign(o, { limiar:P.limiar, inverter:P.inverter, alfa:P.alfa, medida:P.medida, mm:P.mm });
    return Object.assign(o, { limiar:128, inverter:false, alfa:false, areaMin:2, mmPorPx:S.rasterTxt ? S.rasterTxt.mmPorPx : 0 });
  }
  function fonteAtual() {
    if (P.aba === 'imagem') {
      if (!S.img) return null;
      if (!S.rasterImg) S.rasterImg = rasterImagem(S.img, S.vetor);
      return S.rasterImg;
    }
    const k = JSON.stringify([P.texto, P.fonte, P.negrito, P.italico, P.altura]);
    if (k !== S.chaveTxt) { S.chaveTxt = k; S.rasterTxt = rasterTexto(P.texto, P.fonte, P.negrito, P.italico, P.altura); }
    return S.rasterTxt;
  }
  function nota() { return P.aba === 'imagem' ? notaDe('imagem', S.nome) : notaDe('texto', P.texto); }
  function regera() {
    S.timer = 0; S.res = null; S.erro = '';
    guarda();
    pintaAba();
    if (P.aba === 'texto') {
      const f = familia();
      avisoFonte.hidden = !f || fonteExiste(f);
      avisoFonte.textContent = f ? 'A fonte "' + f + '" não está instalada nesta máquina: sai na fonte de reserva.' : '';
    }
    let fonteR = null;
    try {
      fonteR = fonteAtual();
      if (fonteR) S.res = gera(HS, fonteR, opcoes(0, 0, nota()));
    } catch (e) { S.erro = 'o motor recusou: ' + (e && e.message || e); }
    pintaResultado(fonteR);
  }
  function pintaResultado(fonteR) {
    const r = S.res;
    avisos.textContent = '';
    const lista = [];
    if (S.erro) lista.push(S.erro);
    if (r) lista.push(...r.avisos);
    if (P.aba === 'texto' && fonteR && fonteR.reduzido) lista.push('texto grande: a resolução foi reduzida para caber no canvas');
    for (const a of lista) avisos.append(el('li', null, a));
    desenhaPrevia(cv, r ? r.polys : [], V.corCamada ? V.corCamada(camadaDaFace(P.face)) : null);
    if (!r || r.vazio) {
      info.className = 'sg-info vazio';
      info.textContent = P.aba === 'imagem' ? (S.img ? 'nada para colocar' : 'nenhuma imagem ainda') : (P.texto.trim() ? 'nada para colocar' : 'digite o texto');
      ok.disabled = true;
      return;
    }
    info.className = 'sg-info';
    const bb = r.caixa;
    info.textContent = nf(bb.w) + ' × ' + nf(bb.h) + ' mm · ' + r.regioes + (r.regioes === 1 ? ' região · ' : ' regiões · ') +
      r.vertices + ' vértices' + (r.area_mm2 > 0 ? ' · ' + nf(r.area_mm2) + ' mm²' : '') + ' · ' + camadaDaFace(P.face);
    ok.disabled = false;
  }
  const agenda = (ms) => { if (S.timer) clearTimeout(S.timer); S.timer = setTimeout(regera, ms == null ? 140 : ms); };

  /* ---------- a imagem ---------- */
  function carrega(arquivo, nome) {
    if (!arquivo) return;
    if (S.url) { try { URL.revokeObjectURL(S.url); } catch (e) { /* ja foi */ } }
    const url = URL.createObjectURL(arquivo);
    S.url = url;
    const img = new Image();
    img.onload = () => {
      if (S.url !== url) return;
      S.img = img; S.nome = nome || arquivo.name || 'imagem'; S.rasterImg = null;
      S.vetor = /svg/i.test(arquivo.type || '') || /\.svg$/i.test(S.nome);
      nomeArq.textContent = S.nome + ' · ' + (img.naturalWidth || '?') + ' × ' + (img.naturalHeight || '?') + ' px';
      P.aba = 'imagem';
      regera();
    };
    img.onerror = () => { if (S.url === url) { S.img = null; nomeArq.textContent = 'não consegui abrir "' + (nome || arquivo.name || 'arquivo') + '" como imagem'; regera(); } };
    img.src = url;
  }
  inpArq.addEventListener('change', () => { const f = inpArq.files && inpArq.files[0]; if (f) carrega(f); inpArq.value = ''; });
  box.addEventListener('dragover', e => { e.preventDefault(); arq.classList.add('arrasta'); });
  box.addEventListener('dragleave', e => { if (e.target === box) arq.classList.remove('arrasta'); });
  box.addEventListener('drop', e => {
    e.preventDefault(); arq.classList.remove('arrasta');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) carrega(f);
  });
  const cola = e => {
    if (S.ocupado) return;
    const itens = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of itens) if (it.kind === 'file' && /^image\//.test(it.type)) {
      e.preventDefault();
      carrega(it.getAsFile(), 'imagem colada');
      return;
    }
  };
  document.addEventListener('paste', cola, true);

  /* ---------- os controles ---------- */
  abaImg.addEventListener('click', () => { P.aba = 'imagem'; regera(); });
  abaTxt.addEventListener('click', () => { P.aba = 'texto'; regera(); txt.focus(); });
  limiar.addEventListener('input', () => { limiarV.textContent = limiar.value; agenda(); });
  for (const x of [mm, txt, outra, altura]) x.addEventListener('input', () => agenda(x === txt || x === outra ? 260 : 180));
  for (const x of [inverter.c, alfa.c, negrito.c, italico.c, medida, face, giro, simp, fonte]) x.addEventListener('change', () => agenda(0));

  /* ---------- Colocar ---------- */
  async function coloca() {
    if (S.ocupado) return false;
    if (S.timer) { clearTimeout(S.timer); regera(); }
    if (!S.res || S.res.vazio) return false;
    /* a previa nasceu em (0, 0): o que vai para a placa e exatamente ela, levada ao centro */
    const c = (V.centro && V.centro()) || { x:0, y:0 };
    const r4 = v => Math.round(num(v, 0) * 1e4) / 1e4;
    const r = Object.assign({}, S.res, { ops:desloca(S.res.ops, r4(c.x), r4(c.y)) });
    if (r.vertices > LIMITE_VERTICES && typeof HubDialog !== 'undefined') {
      S.ocupado = true;
      let sim = false;
      try {
        sim = await HubDialog.confirm('São ' + r.vertices.toLocaleString('pt-BR') + ' vértices em ' + r.regioes + (r.regioes === 1 ? ' região' : ' regiões') +
          '. Serigrafia com muitos vértices pesa no changes.js, no Gerber e no Altium.\n\nUma simplificação maior (ou uma imagem com menos detalhe) diminui. Colocar assim mesmo?',
          { title:'Serigrafia grande', ok:'Colocar', cancel:'Voltar' });
      } finally { S.ocupado = false; }
      if (!sim) return false;
    }
    const n = V.aplica(r.ops);
    if (!n) return false;
    V.toast(n + (n === 1 ? ' região de serigrafia colocada' : ' regiões de serigrafia colocadas') + ' em ' + camadaDaFace(P.face) +
      ' (' + nf(r.caixa.w) + ' × ' + nf(r.caixa.h) + ' mm) — selecionadas: arraste para o lugar', 'ok', 4200);
    C.fecha();
    return true;
  }
  C.coloca = coloca;

  /* ---------- teclas e fechar ---------- */
  const tecla = e => {
    if (S.ocupado || !scrim.isConnected) return;               /* o HubDialog.confirm por cima responde sozinho */
    e.stopPropagation();                                       /* os atalhos da vista nao disparam com o dialogo aberto */
    if (e.key === 'Escape') { e.preventDefault(); C.fecha(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); coloca(); }
  };
  document.addEventListener('keydown', tecla, true);
  scrim.addEventListener('mousedown', e => { if (e.target === scrim) C.fecha(); });
  C.fecha = () => {
    if (S.timer) clearTimeout(S.timer);
    document.removeEventListener('keydown', tecla, true);
    document.removeEventListener('paste', cola, true);
    if (S.url) { try { URL.revokeObjectURL(S.url); } catch (e) { /* ja foi */ } S.url = null; }
    scrim.remove();
    if (atual === C) atual = null;
  };
  C.aba = id => { P.aba = id === 'texto' ? 'texto' : 'imagem'; regera(); };
  atual = C;
  pintaAba();
  regera();
  (P.aba === 'texto' ? txt : abaImg).focus();
  return C;
}

return { abre, atual:() => atual, FONTES, PX_POR_MM, LIMITE_VERTICES, LARGURA_MIN,
         faceDe, camadaDaFace, fonteCss, limpaFamilia, dimensionaTexto, dimensionaImagem, caixa, contaVertices,
         escalaImagem, normaliza, desloca, notaDe, avisosDe, gera };
});
