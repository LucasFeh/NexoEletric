/* NexoEletric - hub-pcbartes-ui.js — as ARTES DE OVERLAY na vista PCB: a lista de onde se puxa e o Studio.

   Pedido do dono (2026-11-10): "uma logo overlay padrão, onde a gente só puxa e já vem com o código da placa + a
   revisão automática [...] mas pode adicionar novas, criar, é um studio pra criação desse tipo de arte" e "é como se
   fosse uma ferramenta mesmo, na área de PCB, que você cria novas artes e adiciona essas padrão".

   A FERRAMENTA (o botão "Artes" da barra da vista PCB): uma lista flutuante sobre a placa com as artes da biblioteca
   (as duas da casa primeiro), cada uma com a miniatura desenhada pela mesma geometria do Gerber (os campos já com o
   código e a revisão do projeto aberto). ARRASTAR a arte para a placa a larga onde o mouse soltar; CLICAR pega a arte
   na mão (Espaço gira, L troca a face, clique larga, Esc desiste). Na placa ela é UM objeto (pcbframe.js: um comp_add
   com o desenho, HubCore.arteGeom).

   O STUDIO (botão "Studio…" da lista, ou "Editar no Studio…" da arte selecionada): a biblioteca à esquerda, a arte no
   meio (arrastar move o elemento, roda do mouse dá zoom, arrastar no vazio anda, Delete apaga, setas empurram 0,1 mm)
   e os elementos com as propriedades à direita: texto com os campos automáticos (=CodigoDaPlaca, =Revisao, ...),
   linha, retângulo, círculo, QR code de uma URL/texto e imagem/SVG/texto em qualquer fonte convertido em serigrafia
   (o diálogo da ferramenta Imagem → serigrafia, hub-pcbsilkgen.js). Embaixo, os avisos do mínimo da JLC. Salvar grava
   na biblioteca da rede (Libs/pcb-artes.json pelo /api/pcb-artes: tools/rotas/pcb_artes.py). Nova, Duplicar e
   Renomear para todos que editam; Apagar e mudar as artes da casa só o administrador (o servidor confere de novo).

   HubPcbArtesUi.instala(V) -> { alterna(), abreLista(), fechaLista(), abreStudio(id?), lista(), recarrega(), arte(id) }
   V, o que a vista dá:
     wrap, canvas               onde a lista flutua e onde se larga a arte arrastada
     podeEditar()               '' ou o motivo de não poder pôr arte na placa (visualizador, variante, ...)
     comeca(arte)               a arte na mão (a ferramenta de colocar da vista)
     poeEm(arte, sx, sy)        larga a arte no ponto da tela (px do canvas)
     cor()                      a cor da Top Overlay
     toast(t, tipo, ms)
   Nada de alert/confirm/prompt: HubDialog. */
(function (raiz, fabrica) {
  const m = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubPcbArtesUi = m;
})(typeof self !== 'undefined' ? self : this, function (raiz) {
'use strict';

const A = () => raiz.HubPcbArtes;
const isNum = v => typeof v === 'number' && isFinite(v);
const r4 = v => Math.round(v * 1e4) / 1e4;
const nf = (v, c) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: c == null ? 3 : c });
const TIPO_MIME = 'application/x-nexo-arte';

const CSS = `
.ar-lista{position:absolute; top:52px; right:12px; z-index:16; width:286px; max-height:calc(100% - 70px); display:flex; flex-direction:column;
  background:var(--panel, var(--surface-2)); color:var(--fg, var(--text)); border:1px solid var(--border, var(--edge)); border-radius:8px;
  box-shadow:var(--shadow-menu); font:12px/1.4 var(--font); user-select:none;}
.ar-cab{display:flex; align-items:center; gap:6px; padding:8px 8px 7px 11px; border-bottom:1px solid var(--border, var(--edge));}
.ar-cab b{flex:1; font-size:11px; text-transform:uppercase; letter-spacing:.08em; font-weight:500; color:var(--fg-dim, var(--text-2));}
.ar-cab button, .ar-btn{background:transparent; color:var(--fg, var(--text)); border:1px solid var(--border, var(--edge)); border-radius:4px;
  padding:3px 9px; font:12px var(--font); cursor:pointer; white-space:nowrap;}
.ar-cab button:hover:not(:disabled), .ar-btn:hover:not(:disabled){border-color:var(--accent, var(--hi));}
.ar-btn:disabled, .ar-cab button:disabled{opacity:.4; cursor:not-allowed;}
.ar-btn.forte{background:var(--hi); border-color:var(--hi); color:var(--on-hi);}
.ar-btn.perigo:hover:not(:disabled){border-color:var(--err); color:var(--err);}
.ar-x{width:24px; padding:3px 0 !important;}
.ar-dica{padding:6px 11px 2px; font-size:11px; color:var(--fg-dim, var(--text-2));}
.ar-itens{overflow:auto; padding:6px; display:flex; flex-direction:column; gap:6px;}
.ar-card{display:flex; flex-direction:column; gap:4px; padding:6px; border:1px solid var(--border, var(--edge)); border-radius:6px; cursor:grab; background:var(--panel2, var(--surface));}
.ar-card:hover{border-color:var(--accent, var(--hi));}
.ar-card canvas{width:100%; height:64px; display:block; background:#000; border-radius:4px;}
.ar-card .ar-nm{display:flex; align-items:center; gap:6px; min-width:0;}
.ar-card .ar-nm span:first-child{flex:1; min-width:0; overflow-wrap:anywhere;}
.ar-tag{flex:none; font-size:10px; padding:0 6px; border-radius:8px; border:1px solid var(--border, var(--edge)); color:var(--fg-dim, var(--text-2));}
.ar-card .ar-ed{flex:none; padding:1px 7px; font-size:11px;}
.ar-aviso{color:var(--warn); font-size:11px;}
.ar-st{position:fixed; inset:0; z-index:8700; display:flex; align-items:center; justify-content:center; padding:14px;
  background:var(--scrim, rgba(11,11,13,.55)); font:13px/1.45 var(--font); color:var(--text);}
.ar-st-box{width:min(1280px, 100%); height:min(820px, 100%); display:grid; grid-template-rows:auto minmax(0,1fr) auto;
  background:var(--surface); border-radius:var(--r-md, 8px); box-shadow:var(--shadow-menu); overflow:hidden;}
.ar-st-cab{display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid var(--edge);}
.ar-st-cab h3{margin:0; font-size:14px; font-weight:600;}
.ar-st-cab input{flex:1; max-width:380px; background:var(--surface-2); color:var(--text); border:1px solid var(--edge); border-radius:4px; padding:4px 8px; font:inherit;}
.ar-st-cab .ar-sub{color:var(--text-2); font-size:12px;}
.ar-st-meio{display:grid; grid-template-columns:230px minmax(0,1fr) 300px; min-height:0;}
.ar-st-bib{border-right:1px solid var(--edge); display:flex; flex-direction:column; min-height:0;}
.ar-st-bib .ar-itens{flex:1;}
.ar-st-bib .ar-item{padding:5px 8px; border-radius:4px; cursor:pointer; display:flex; gap:6px; align-items:center;}
.ar-st-bib .ar-item span:first-child{flex:1; min-width:0; overflow-wrap:anywhere;}
.ar-st-bib .ar-item:hover{background:rgba(var(--tint),.08);}
.ar-st-bib .ar-item.on{background:rgba(var(--tint),.14); font-weight:600;}
.ar-st-bib .ar-acoes{display:grid; grid-template-columns:1fr 1fr; gap:4px; padding:8px; border-top:1px solid var(--edge);}
.ar-st-cv{position:relative; min-width:0; min-height:0; background:#000;}
.ar-st-cv canvas{position:absolute; inset:0; width:100%; height:100%; display:block; cursor:default;}
.ar-st-cv .ar-hud{position:absolute; left:8px; bottom:6px; font:11px var(--mono); color:#b8b8bd; pointer-events:none;}
.ar-st-lado{border-left:1px solid var(--edge); display:flex; flex-direction:column; min-height:0; overflow:auto;}
.ar-sec{padding:9px 12px; border-bottom:1px solid var(--edge);}
.ar-sec h4{margin:0 0 6px; font-size:10px; text-transform:uppercase; letter-spacing:.09em; color:var(--text-2); font-weight:400;}
.ar-add{display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px;}
.ar-els{display:flex; flex-direction:column; gap:2px; max-height:190px; overflow:auto;}
.ar-el{display:flex; gap:6px; align-items:center; padding:3px 6px; border-radius:4px; cursor:pointer; font-size:12px;}
.ar-el span{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.ar-el:hover{background:rgba(var(--tint),.08);}
.ar-el.on{background:rgba(var(--tint),.16);}
.ar-el i{font-style:normal; color:var(--text-2); font-size:11px;}
.ar-prop{display:grid; grid-template-columns:78px minmax(0,1fr); gap:5px 8px; align-items:center; font-size:12px;}
.ar-prop label{color:var(--text-2);}
.ar-prop input, .ar-prop select, .ar-prop textarea{background:var(--surface-2); color:var(--text); border:1px solid var(--edge); border-radius:4px; padding:3px 6px; font:inherit; min-width:0; width:100%; box-sizing:border-box;}
.ar-prop textarea{resize:vertical; min-height:40px;}
.ar-prop .ar-ck{display:flex; align-items:center; gap:6px;}
.ar-prop .ar-ck input{width:auto;}
.ar-campos{grid-column:1 / -1; display:flex; flex-wrap:wrap; gap:3px;}
.ar-campos button{padding:1px 6px; font-size:11px;}
.ar-st-pe{display:flex; align-items:center; gap:8px; padding:9px 14px; border-top:1px solid var(--edge);}
.ar-st-pe .ar-avs{flex:1; min-width:0; font-size:11.5px; color:var(--warn); max-height:42px; overflow:auto;}
.ar-st-pe .ar-avs.ok{color:var(--ok, #7ac27a);}
`;
let estilo = false;
function poeEstilo() {
  if (estilo || typeof document === 'undefined') return;
  const s = document.createElement('style'); s.textContent = CSS; document.head.append(s); estilo = true;
}
function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function botao(txt, fn, cls, dica) { const b = el('button', 'ar-btn' + (cls ? ' ' + cls : ''), txt); b.type = 'button'; if (dica) b.title = dica; if (fn) b.addEventListener('click', fn); return b; }
const D = () => raiz.HubDialog;
const toast = (V, t, tipo, ms) => { if (V && V.toast) V.toast(t, tipo, ms); else if (D()) D().toast(t, tipo || 'info', ms); };

/* ── desenhar um desenho compilado {l, a, r, t} num canvas 2D, no referencial (cx, cy, s) ── */
function desenhaFp(ctx, fp, T, cor) {
  const X = x => T.ox + x * T.s, Y = y => T.oy - y * T.s;
  ctx.save();
  ctx.fillStyle = cor; ctx.strokeStyle = cor; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const P = new Path2D();
  for (const g of fp.r || []) for (const anel of [g.pts].concat(g.holes || [])) {
    anel.forEach((p, i) => (i ? P.lineTo(X(p[0]), Y(p[1])) : P.moveTo(X(p[0]), Y(p[1]))));
    P.closePath();
  }
  ctx.fill(P, 'evenodd');
  for (const l of fp.l || []) { ctx.lineWidth = Math.max(1, l[4] * T.s); ctx.beginPath(); ctx.moveTo(X(l[0]), Y(l[1])); ctx.lineTo(X(l[2]), Y(l[3])); ctx.stroke(); }
  for (const a of fp.a || []) { ctx.lineWidth = Math.max(1, a[5] * T.s); ctx.beginPath(); ctx.arc(X(a[0]), Y(a[1]), a[2] * T.s, -a[4] * Math.PI / 180, -a[3] * Math.PI / 180); ctx.stroke(); }
  const G = raiz.HubGerber;
  for (const t of fp.t || []) {
    const g = G && G.geometriaTexto ? G.geometriaTexto({ x: t.x, y: t.y, h: t.h, w: t.w, rot: t.rot || 0, text: t.text, kind: 'stroke', layer: 'TopOverlay' }) : null;
    if (!g || !g.tracos) continue;
    ctx.lineWidth = Math.max(1, g.w * T.s);
    ctx.beginPath();
    for (const s of g.tracos) s.forEach((q, i) => (i ? ctx.lineTo(X(q[0]), Y(q[1])) : ctx.moveTo(X(q[0]), Y(q[1]))));
    ctx.stroke();
  }
  ctx.restore();
}
/* a caixa com o texto RESOLVIDO (a da tela) */
function caixaReal(fp) {
  const G = raiz.HubGerber;
  let b = A().caixaDe({ l: fp.l, a: fp.a, r: fp.r, t: [] });
  const poe = (x, y) => { if (!b) b = { x1: x, y1: y, x2: x, y2: y }; else { b.x1 = Math.min(b.x1, x); b.y1 = Math.min(b.y1, y); b.x2 = Math.max(b.x2, x); b.y2 = Math.max(b.y2, y); } };
  for (const t of fp.t || []) {
    const g = G && G.geometriaTexto ? G.geometriaTexto({ x: t.x, y: t.y, h: t.h, w: t.w, rot: t.rot || 0, text: t.text, kind: 'stroke' }) : null;
    if (g && g.tracos && g.tracos.length) for (const s of g.tracos) for (const q of s) { poe(q[0] - g.w / 2, q[1] - g.w / 2); poe(q[0] + g.w / 2, q[1] + g.w / 2); }
    else poe(t.x, t.y);
  }
  return b;
}
function miniatura(cv, arte, cor) {
  const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
  const w = cv.clientWidth || 260, h = cv.clientHeight || 64;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  let c;
  try { c = A().compila(arte); } catch (e) { return; }
  const b = caixaReal(c.fp);
  if (!b) return;
  const s = Math.min((w - 12) / Math.max(1e-3, b.x2 - b.x1), (h - 10) / Math.max(1e-3, b.y2 - b.y1));
  desenhaFp(ctx, c.fp, { s, ox: w / 2 - (b.x1 + b.x2) / 2 * s, oy: h / 2 + (b.y1 + b.y2) / 2 * s }, cor || '#ffff00');
}

function instala(V) {
  poeEstilo();
  const ST = { lib: { artes: [] }, admin: false, visualizador: false, servidor: false, carregado: false, lista: null, studio: null };

  async function recarrega() {
    try {
      const r = await fetch('/api/pcb-artes', { cache: 'no-store' });
      const j = await r.json();
      if (!j || !j.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
      ST.lib = { artes: j.artes || [] }; ST.admin = !!j.admin; ST.visualizador = !!j.visualizador; ST.servidor = true; ST.erro = '';
    } catch (e) {
      ST.servidor = false; ST.erro = 'a biblioteca da rede não respondeu (' + (e && e.message || e) + '): só as artes da casa';
    }
    ST.carregado = true;
    if (ST.lista) pintaLista();
    if (ST.studio) ST.studio.pintaBib();
    return lista();
  }
  const lista = () => A().lista(ST.lib);
  const arte = id => lista().find(a => a.id === id) || null;

  /* ── a lista flutuante ── */
  function abreLista() {
    if (ST.lista) return ST.lista;
    const box = el('div', 'ar-lista'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Artes de overlay');
    const cab = el('div', 'ar-cab');
    cab.append(el('b', null, 'Artes de overlay'), botao('Studio…', () => abreStudio(), '', 'criar e editar artes (texto com campos, QR code, imagem, formas)'));
    const x = botao('×', fechaLista, 'ar-x', 'fechar (Esc)'); cab.append(x);
    const dica = el('div', 'ar-dica', 'Arraste para a placa — ou clique e largue com o mouse (Espaço gira, L troca a face, Esc desiste).');
    const itens = el('div', 'ar-itens');
    box.append(cab, dica, itens);
    (V.wrap || document.body).append(box);
    ST.lista = { box, itens, dica };
    box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); fechaLista(); } });
    pintaLista();
    if (!ST.carregado) recarrega();
    return ST.lista;
  }
  function fechaLista() { if (ST.lista) { ST.lista.box.remove(); ST.lista = null; } }
  function alterna() { if (ST.lista) fechaLista(); else abreLista(); }
  function pintaLista() {
    const L = ST.lista; if (!L) return;
    L.itens.textContent = '';
    const motivo = V.podeEditar ? V.podeEditar() : '';
    L.dica.textContent = motivo ? motivo : 'Arraste para a placa — ou clique e largue com o mouse (Espaço gira, L troca a face, Esc desiste).';
    L.dica.classList.toggle('ar-aviso', !!motivo);
    if (ST.erro) L.itens.append(el('div', 'ar-aviso', ST.erro));
    for (const a of lista()) {
      const card = el('div', 'ar-card'); card.draggable = !motivo; card.title = (a.descricao || a.nome) + (motivo ? '' : '\nArraste para a placa ou clique para pegar');
      const cv = el('canvas');
      const nm = el('div', 'ar-nm'); nm.append(el('span', null, a.nome));
      if (a.padrao) nm.append(el('span', 'ar-tag', 'padrão'));
      const ed = botao('Editar', ev => { ev.stopPropagation(); abreStudio(a.id); }, 'ar-ed', 'abrir esta arte no Studio');
      nm.append(ed);
      card.append(cv, nm);
      card.addEventListener('click', () => { if (motivo) { toast(V, motivo, 'warn', 5000); return; } V.comeca(a); });
      card.addEventListener('dragstart', ev => { ev.dataTransfer.setData(TIPO_MIME, a.id); ev.dataTransfer.setData('text/plain', a.nome); ev.dataTransfer.effectAllowed = 'copy'; });
      L.itens.append(card);
      requestAnimationFrame(() => miniatura(cv, a, V.cor ? V.cor() : '#ffff00'));
    }
  }
  /* largar a arte arrastada da lista na placa */
  if (V.canvas) {
    const temArte = ev => ev.dataTransfer && [...(ev.dataTransfer.types || [])].indexOf(TIPO_MIME) >= 0;
    const alvo = V.canvas.parentNode || V.canvas;
    alvo.addEventListener('dragover', ev => { if (temArte(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } });
    alvo.addEventListener('drop', ev => {
      if (!temArte(ev)) return;
      ev.preventDefault();
      const a = arte(ev.dataTransfer.getData(TIPO_MIME));
      if (!a) return;
      const motivo = V.podeEditar ? V.podeEditar() : '';
      if (motivo) { toast(V, motivo, 'warn', 5000); return; }
      const r = V.canvas.getBoundingClientRect();
      V.poeEm(a, ev.clientX - r.left, ev.clientY - r.top);
    });
  }

  /* ── o Studio ── */
  function abreStudio(id) {
    if (ST.studio) { if (id) ST.studio.abre(id); return ST.studio; }
    const S = { arte: null, base: null, sel: -1, sujo: false, v: { s: 14, cx: 0, cy: 0 }, arr: null };
    const scrim = el('div', 'ar-st'), box = el('div', 'ar-st-box');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Studio de artes de overlay');
    /* cabeçalho */
    const cab = el('div', 'ar-st-cab');
    const nome = el('input'); nome.type = 'text'; nome.placeholder = 'nome da arte'; nome.setAttribute('aria-label', 'nome da arte');
    const sub = el('span', 'ar-sub');
    cab.append(el('h3', null, 'Studio de artes'), nome, sub);
    /* biblioteca */
    const bib = el('div', 'ar-st-bib'), bibItens = el('div', 'ar-itens'), acoes = el('div', 'ar-acoes');
    const bNova = botao('Nova', () => trocaPara(() => nova())), bDup = botao('Duplicar', () => trocaPara(() => duplicar()));
    const bApagar = botao('Apagar…', () => apagar(), 'perigo'), bRest = botao('Restaurar', () => restaurar(), '', 'a arte da casa volta ao desenho do programa (só o administrador)');
    acoes.append(bNova, bDup, bApagar, bRest);
    bib.append(bibItens, acoes);
    /* o desenho */
    const cvw = el('div', 'ar-st-cv'), cv = el('canvas'), hud = el('div', 'ar-hud');
    cv.tabIndex = 0; cvw.append(cv, hud);
    /* o lado: adicionar, elementos, propriedades */
    const lado = el('div', 'ar-st-lado');
    const secAdd = el('div', 'ar-sec'), add = el('div', 'ar-add');
    secAdd.append(el('h4', null, 'Adicionar'), add);
    const secEls = el('div', 'ar-sec'), els = el('div', 'ar-els');
    secEls.append(el('h4', null, 'Elementos'), els);
    const secProp = el('div', 'ar-sec'), prop = el('div', 'ar-prop');
    secProp.append(el('h4', null, 'Propriedades'), prop);
    lado.append(secAdd, secEls, secProp);
    const meio = el('div', 'ar-st-meio'); meio.append(bib, cvw, lado);
    /* rodapé */
    const pe = el('div', 'ar-st-pe'), avs = el('div', 'ar-avs');
    const bColocar = botao('Colocar na placa', () => colocar(), '', 'pega a arte como está agora (sem precisar salvar) e volta para a placa');
    const bSalvar = botao('Salvar', () => salvar(), 'forte'), bFechar = botao('Fechar', () => fecha());
    pe.append(avs, bColocar, bSalvar, bFechar);
    box.append(cab, meio, pe); scrim.append(box);
    document.body.append(scrim);

    const novoEl = {
      texto: () => ({ tipo: 'texto', x: 0, y: 0, texto: '=CodigoDaPlaca', h: 1.5, w: 0.2, rot: 0 }),
      linha: () => ({ tipo: 'linha', x1: -5, y1: 0, x2: 5, y2: 0, w: 0.2 }),
      retangulo: () => ({ tipo: 'retangulo', x: 0, y: 0, larg: 10, alt: 5, w: 0.2, cheio: false }),
      circulo: () => ({ tipo: 'circulo', x: 0, y: 0, r: 2.5, w: 0.2, cheio: false }),
      qr: () => ({ tipo: 'qr', x: 0, y: 0, tam: 10, texto: 'www.dieletrons.com', ec: 'L', borda: 2, invertido: true }),
    };
    const ROT = { texto: 'Texto', linha: 'Linha', retangulo: 'Retângulo', circulo: 'Círculo', qr: 'QR code', regioes: 'Imagem' };
    for (const k of ['texto', 'linha', 'retangulo', 'circulo', 'qr']) add.append(botao(ROT[k], () => poeEl(novoEl[k]())));
    add.append(botao('Imagem…', () => imagem(), '', 'imagem (PNG, JPG, SVG...) ou texto em qualquer fonte → regiões de serigrafia, com limiar'));

    const podeSalvar = () => {
      if (!ST.servidor) return 'a biblioteca da rede não respondeu: não dá para salvar agora';
      if (ST.visualizador) return 'seu usuário é apenas visualizador — peça ao administrador do Nexo Hub';
      if (S.arte && A().ehPadrao(S.arte.id) && !ST.admin) return 'arte padrão da casa: só o administrador muda — use Duplicar para fazer a sua';
      return '';
    };
    function compilado() { try { return A().compila(S.arte); } catch (e) { return { fp: { l: [], a: [], r: [], t: [] }, avisos: [String(e && e.message || e)], caixa: null }; } }
    function pintaBib() {
      bibItens.textContent = '';
      for (const a of lista()) {
        const it = el('div', 'ar-item' + (S.arte && S.arte.id === a.id ? ' on' : ''));
        it.append(el('span', null, a.nome));
        if (a.padrao) it.append(el('span', 'ar-tag', 'padrão'));
        it.addEventListener('click', () => { if (!S.arte || S.arte.id !== a.id) trocaPara(() => carrega(a)); });
        bibItens.append(it);
      }
      if (S.arte && !lista().some(a => a.id === S.arte.id)) {
        const it = el('div', 'ar-item on'); it.append(el('span', null, S.arte.nome + ' (não salva)')); bibItens.append(it);
      }
      const ehPad = S.arte && A().ehPadrao(S.arte.id), salva = S.arte && lista().some(a => a.id === S.arte.id);
      const soAdmin = !ST.admin ? 'só o administrador do Nexo Hub apaga artes' : '';
      bApagar.disabled = !salva || !!soAdmin || !ST.servidor; bApagar.title = soAdmin || (ST.servidor ? 'tirar esta arte da biblioteca da rede' : ST.erro || '');
      bRest.disabled = !ehPad || !ST.admin || !ST.servidor || !(ST.lib.artes || []).some(x => x.id === S.arte.id);
      bRest.hidden = !ehPad;
    }
    function carrega(a) {
      S.arte = JSON.parse(JSON.stringify(a)); S.base = lista().some(x => x.id === a.id) && (ST.lib.artes || []).some(x => x.id === a.id) ? (a.versao || 0) : null;
      S.sel = S.arte.elementos.length ? 0 : -1; S.sujo = false;
      enquadra(); pinta();
    }
    async function trocaPara(fn) {
      if (S.sujo && !(await D().confirm('A arte "' + S.arte.nome + '" tem mudanças não salvas. Descartar?', { title: 'Studio de artes', ok: 'Descartar', danger: true }))) return;
      fn();
    }
    function nova() {
      const a = A().novaArte('Arte nova', lista().map(x => x.id));
      S.arte = a; S.base = null; S.sel = 0; S.sujo = true; enquadra(); pinta();
      nome.focus(); nome.select();
    }
    function duplicar() {
      if (!S.arte) return;
      const c = A().duplica(S.arte, lista().map(x => x.id));
      S.arte = c; S.base = null; S.sujo = true; pinta();
      toast(V, 'cópia criada — salve para ela entrar na biblioteca', 'info', 2600);
    }
    async function apagar() {
      if (!S.arte) return;
      const ok = await D().confirm('Apagar a arte "' + S.arte.nome + '" da biblioteca da rede? As placas que já têm a arte continuam com ela.', { title: 'Apagar arte', ok: 'Apagar', danger: true });
      if (!ok) return;
      const r = await post('/api/pcb-artes/apagar', { id: S.arte.id });
      if (!r.ok) { toast(V, 'não apagou: ' + r.error, 'err', 6000); return; }
      toast(V, 'arte "' + S.arte.nome + '" apagada', 'ok', 2200);
      await recarrega();
      const L = lista(); if (L.length) carrega(L[0]); else nova();
    }
    async function restaurar() {
      if (!S.arte) return;
      const ok = await D().confirm('Voltar "' + S.arte.nome + '" ao desenho que vem com o programa?', { title: 'Restaurar arte da casa', ok: 'Restaurar' });
      if (!ok) return;
      const r = await post('/api/pcb-artes/restaurar', { id: S.arte.id });
      if (!r.ok) { toast(V, 'não restaurou: ' + r.error, 'err', 6000); return; }
      await recarrega();
      const a = arte(S.arte.id); if (a) carrega(a);
    }
    async function salvar() {
      const m = podeSalvar(); if (m) { toast(V, m, 'warn', 6000); return false; }
      const nm = nome.value.trim();
      if (!nm) { toast(V, 'dê um nome à arte', 'warn'); nome.focus(); return false; }
      S.arte.nome = nm;
      /* a arte que ainda não está na biblioteca ganha o id do nome que a pessoa deu (não o do "Arte nova") */
      if (S.base == null && !(ST.lib.artes || []).some(x => x.id === S.arte.id))
        S.arte.id = A().novoId(nm, lista().map(x => x.id).filter(x => x !== S.arte.id));
      if (!S.arte.elementos.length) { toast(V, 'a arte está vazia', 'warn'); return false; }
      const corpo = { arte: { id: S.arte.id, nome: S.arte.nome, descricao: S.arte.descricao, elementos: S.arte.elementos } };
      if (S.base != null) corpo.base = S.base;
      const r = await post('/api/pcb-artes/salvar', corpo);
      if (!r.ok) { toast(V, 'não salvou: ' + r.error, r.status === 409 ? 'warn' : 'err', 8000); return false; }
      S.base = r.arte.versao; S.arte.versao = r.arte.versao; S.sujo = false;
      await recarrega();
      pinta();
      toast(V, 'arte "' + S.arte.nome + '" salva na biblioteca da rede (versão ' + r.arte.versao + ')', 'ok', 2600);
      return true;
    }
    function colocar() {
      const motivo = V.podeEditar ? V.podeEditar() : '';
      if (motivo) { toast(V, motivo, 'warn', 6000); return; }
      const nm = nome.value.trim(); if (nm) S.arte.nome = nm;
      const a = JSON.parse(JSON.stringify(S.arte));
      fecha(true);
      V.comeca(a);
    }
    async function fecha(semPerguntar) {
      if (!semPerguntar && S.sujo && !(await D().confirm('A arte "' + S.arte.nome + '" tem mudanças não salvas. Fechar mesmo assim?', { title: 'Studio de artes', ok: 'Fechar', danger: true }))) return;
      scrim.remove(); document.removeEventListener('keydown', teclas, true); ro.disconnect();
      ST.studio = null;
      if (ST.lista) pintaLista();
    }
    function muda() { S.sujo = true; pinta(); }
    function poeEl(e) { S.arte.elementos.push(e); S.sel = S.arte.elementos.length - 1; muda(); }

    /* a imagem: o diálogo da ferramenta Imagem → serigrafia, com o centro na origem da arte */
    function imagem() {
      const SG = raiz.HubPcbSilkGen;
      if (!SG) { toast(V, 'o conversor de imagem (hub-pcbsilkgen.js) não carregou — atualize com F5', 'warn'); return; }
      SG.abre({
        centro: () => ({ x: 0, y: 0 }), face: () => 'Top', corCamada: () => (V.cor ? V.cor() : '#ffff00'),
        aplica: ops => {
          const regs = (ops || []).filter(o => o && o.op === 'region_add').map(o => ({ pts: o.pts.map(p => [r4(p[0]), r4(p[1])]), holes: (o.holes || []).map(h => h.map(p => [r4(p[0]), r4(p[1])])) }));
          if (!regs.length) return 0;
          poeEl({ tipo: 'regioes', nome: 'imagem', x: 0, y: 0, escala: 1, regioes: regs });
          return regs.length;
        },
        toast: (t, tipo, ms) => toast(V, t, tipo, ms),
      });
    }

    /* ── a lista de elementos e as propriedades ── */
    function rotuloEl(e) {
      if (e.tipo === 'texto') return '"' + e.texto + '"';
      if (e.tipo === 'qr') return e.texto;
      if (e.tipo === 'regioes') return (e.nome || 'imagem') + ' · ' + (e.regioes || []).length + ' regiões';
      if (e.tipo === 'retangulo') return nf(e.larg, 2) + ' × ' + nf(e.alt, 2) + ' mm' + (e.cheio ? ' cheio' : '');
      if (e.tipo === 'circulo') return 'r ' + nf(e.r, 2) + ' mm' + (e.cheio ? ' cheio' : '');
      return nf(Math.hypot(e.x2 - e.x1, e.y2 - e.y1), 2) + ' mm';
    }
    function pintaEls() {
      els.textContent = '';
      S.arte.elementos.forEach((e, i) => {
        const it = el('div', 'ar-el' + (i === S.sel ? ' on' : ''));
        it.append(el('i', null, ROT[e.tipo] || e.tipo), el('span', null, rotuloEl(e)));
        const up = botao('↑', ev => { ev.stopPropagation(); if (i > 0) { const L = S.arte.elementos; [L[i - 1], L[i]] = [L[i], L[i - 1]]; S.sel = i - 1; muda(); } }, 'ar-x', 'subir');
        const del = botao('×', ev => { ev.stopPropagation(); S.arte.elementos.splice(i, 1); S.sel = Math.min(S.sel, S.arte.elementos.length - 1); muda(); }, 'ar-x perigo', 'tirar (Delete)');
        it.append(up, del);
        it.addEventListener('click', () => { S.sel = i; pinta(); });
        els.append(it);
      });
      if (!S.arte.elementos.length) els.append(el('div', 'ar-aviso', 'vazia: adicione um elemento acima'));
    }
    function campoNum(rot, k, e, passo, min) {
      const i = el('input'); i.type = 'number'; i.step = String(passo || 0.1); if (min != null) i.min = String(min);
      i.value = isNum(e[k]) ? String(r4(e[k])) : '';
      i.addEventListener('change', () => { const v = parseFloat(String(i.value).replace(',', '.')); if (!isFinite(v) || (min != null && v < min)) { i.value = String(e[k]); return; } e[k] = v; muda(); });
      prop.append(el('label', null, rot), i);
    }
    function campoCk(rot, k, e, dica) {
      const w = el('label', 'ar-ck'), c = el('input'); c.type = 'checkbox'; c.checked = !!e[k];
      c.addEventListener('change', () => { e[k] = c.checked; muda(); });
      w.append(c, document.createTextNode(rot)); if (dica) w.title = dica;
      prop.append(el('span'), w);
    }
    function pintaProp() {
      prop.textContent = '';
      const e = S.arte.elementos[S.sel];
      if (!e) { prop.append(el('span', 'ar-aviso', 'nenhum elemento selecionado')); return; }
      if (e.tipo === 'texto' || e.tipo === 'qr') {
        const t = el(e.tipo === 'texto' ? 'textarea' : 'input'); if (e.tipo === 'qr') t.type = 'text';
        t.value = e.texto || ''; t.rows = 2; t.spellcheck = false;
        t.addEventListener('input', () => { e.texto = t.value; S.sujo = true; pintaDesenho(); pintaEls(); pintaAvisos(); });
        prop.append(el('label', null, e.tipo === 'qr' ? 'URL/texto' : 'Texto'), t);
        if (e.tipo === 'texto') {
          const cs = el('div', 'ar-campos');
          for (const c of A().CAMPOS) cs.append(botao('=' + c.nome, () => {
            const ini = t.selectionStart != null ? t.selectionStart : t.value.length, fim = t.selectionEnd != null ? t.selectionEnd : ini;
            const antes = t.value.slice(0, ini), sep = antes && !/[\s\n]$/.test(antes) ? ' ' : '';
            t.value = antes + sep + '=' + c.nome + t.value.slice(fim); e.texto = t.value; muda();
          }, '', c.rot + ' (ex.: ' + c.ex + ') — muda sozinho quando o projeto muda'));
          prop.append(cs);
          campoNum('Altura (mm)', 'h', e, 0.1, 0.1); campoNum('Traço (mm)', 'w', e, 0.01, 0.01); campoNum('Rotação (°)', 'rot', e, 90);
        } else {
          const s = el('select');
          for (const [v, r] of [['L', 'L (7%) — o da casa'], ['M', 'M (15%)'], ['Q', 'Q (25%)'], ['H', 'H (30%)']]) { const o = el('option', null, r); o.value = v; s.append(o); }
          s.value = e.ec || 'M';
          s.addEventListener('change', () => { e.ec = s.value; muda(); });
          prop.append(el('label', null, 'Correção'), s);
          campoNum('Lado (mm)', 'tam', e, 0.5, 2); campoNum('Borda (mód.)', 'borda', e, 1, 0);
          campoCk('Invertido', 'invertido', e, 'a serigrafia é a parte CLARA do QR (placa escura, como as da casa)');
          try { const q = A().qrRegioes(e); prop.append(el('span'), el('span', 'ar-sub', 'versão ' + q.versao + ' · ' + q.n + '×' + q.n + ' · módulo ' + nf(q.modulo, 3) + ' mm')); } catch (x) { prop.append(el('span'), el('span', 'ar-aviso', String(x.message || x))); }
        }
      }
      if (e.tipo === 'linha') { campoNum('X1', 'x1', e); campoNum('Y1', 'y1', e); campoNum('X2', 'x2', e); campoNum('Y2', 'y2', e); campoNum('Traço (mm)', 'w', e, 0.01, 0.01); return; }
      if (e.tipo === 'retangulo') { campoNum('Largura', 'larg', e, 0.5, 0.01); campoNum('Altura', 'alt', e, 0.5, 0.01); }
      if (e.tipo === 'circulo') campoNum('Raio', 'r', e, 0.1, 0.01);
      if (e.tipo === 'retangulo' || e.tipo === 'circulo') { campoNum('Traço (mm)', 'w', e, 0.01, 0.01); campoCk('Cheio', 'cheio', e, 'região cheia em vez do contorno'); }
      if (e.tipo === 'regioes') campoNum('Escala', 'escala', e, 0.05, 0.01);
      campoNum('X (mm)', 'x', e); campoNum('Y (mm)', 'y', e);
    }
    function pintaAvisos() {
      const c = compilado(), m = podeSalvar();
      const b = caixaReal(c.fp);
      const tam = b ? nf(b.x2 - b.x1, 2) + ' × ' + nf(b.y2 - b.y1, 2) + ' mm' : 'vazia';
      avs.textContent = c.avisos.length ? '▲ ' + c.avisos.join(' · ') : 'Dentro do mínimo da serigrafia da JLC (traço ≥ 0,15 mm, texto ≥ 0,8 mm).';
      avs.classList.toggle('ok', !c.avisos.length);
      sub.textContent = tam + (S.arte.padrao || A().ehPadrao(S.arte.id) ? ' · padrão da casa' : '') + (S.arte.versao ? ' · versão ' + S.arte.versao : ' · não salva') + (S.sujo ? ' · mudada' : '');
      bSalvar.disabled = !!m; bSalvar.title = m || 'grava na biblioteca da rede (o NexoBD leva para todas as máquinas)';
    }
    function pinta() {
      if (document.activeElement !== nome) nome.value = S.arte.nome || '';
      nome.disabled = !!podeSalvar() && A().ehPadrao(S.arte.id);
      pintaBib(); pintaEls(); pintaProp(); pintaAvisos(); pintaDesenho();
    }
    nome.addEventListener('input', () => { S.arte.nome = nome.value; S.sujo = true; pintaAvisos(); });

    /* ── o desenho ── */
    let W = 0, H = 0;
    const dpr = () => (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
    const T = () => ({ s: S.v.s, ox: W / 2 - S.v.cx * S.v.s, oy: H / 2 + S.v.cy * S.v.s });
    const mundo = (sx, sy) => ({ x: (sx - W / 2) / S.v.s + S.v.cx, y: (H / 2 - sy) / S.v.s + S.v.cy });
    function enquadra() {
      const c = compilado(), b = caixaReal(c.fp) || { x1: -10, y1: -6, x2: 10, y2: 6 };
      S.v.cx = (b.x1 + b.x2) / 2; S.v.cy = (b.y1 + b.y2) / 2;
      S.v.s = Math.max(2, Math.min(200, Math.min((W || 600) * 0.8 / Math.max(2, b.x2 - b.x1), (H || 400) * 0.8 / Math.max(2, b.y2 - b.y1))));
    }
    function caixaEl(e) {
      try { return caixaReal(A().compila({ elementos: [e] }).fp); } catch (x) { return null; }
    }
    function pintaDesenho() {
      const ctx = cv.getContext('2d'), d = dpr();
      cv.width = Math.round(W * d); cv.height = Math.round(H * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      const t = T();
      /* a grade de 1 mm (5 mm mais forte) e a origem (o ponto que a mão segura na placa) */
      let passo = 1; while (passo * S.v.s < 8) passo *= 5;
      const m0 = mundo(0, H), m1 = mundo(W, 0);
      ctx.lineWidth = 1;
      for (let x = Math.floor(m0.x / passo) * passo; x <= m1.x; x += passo) { const sx = Math.round(t.ox + x * t.s) + 0.5; ctx.strokeStyle = Math.abs(x / (passo * 5) - Math.round(x / (passo * 5))) < 1e-6 ? '#26262b' : '#141417'; ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke(); }
      for (let y = Math.floor(m0.y / passo) * passo; y <= m1.y; y += passo) { const sy = Math.round(t.oy - y * t.s) + 0.5; ctx.strokeStyle = Math.abs(y / (passo * 5) - Math.round(y / (passo * 5))) < 1e-6 ? '#26262b' : '#141417'; ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke(); }
      const c = compilado();
      desenhaFp(ctx, c.fp, t, V.cor ? V.cor() : '#ffff00');
      ctx.strokeStyle = '#d04040'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(t.ox - 8, t.oy); ctx.lineTo(t.ox + 8, t.oy); ctx.moveTo(t.ox, t.oy - 8); ctx.lineTo(t.ox, t.oy + 8); ctx.stroke();
      const e = S.arte.elementos[S.sel], b = e ? caixaEl(e) : null;
      if (b) {
        ctx.strokeStyle = '#4aa3ff'; ctx.setLineDash([4, 3]);
        ctx.strokeRect(t.ox + b.x1 * t.s - 3, t.oy - b.y2 * t.s - 3, (b.x2 - b.x1) * t.s + 6, (b.y2 - b.y1) * t.s + 6);
        ctx.setLineDash([]);
      }
      const bt = caixaReal(c.fp);
      hud.textContent = 'grade ' + nf(passo, 2) + ' mm · zoom ' + nf(S.v.s, 1) + ' px/mm' + (bt ? ' · ' + nf(bt.x2 - bt.x1, 2) + ' × ' + nf(bt.y2 - bt.y1, 2) + ' mm' : '') + ' · + vermelha = o ponto que a mão segura';
    }
    const ro = new ResizeObserver(() => { const r = cvw.getBoundingClientRect(); W = r.width; H = r.height; if (S.arte) pintaDesenho(); });
    ro.observe(cvw);
    const acha = (x, y) => {
      for (let i = S.arte.elementos.length - 1; i >= 0; i--) { const b = caixaEl(S.arte.elementos[i]), f = 4 / S.v.s; if (b && x >= b.x1 - f && x <= b.x2 + f && y >= b.y1 - f && y <= b.y2 + f) return i; }
      return -1;
    };
    const snap = (v, sem) => (sem ? r4(v) : Math.round(v / 0.05) * 0.05);
    function moveEl(e, dx, dy) {
      for (const [a, b] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) if (isNum(e[a]) && isNum(e[b])) { e[a] = r4(e[a] + dx); e[b] = r4(e[b] + dy); }
    }
    cv.addEventListener('pointerdown', ev => {
      cv.focus(); cv.setPointerCapture(ev.pointerId);
      const r = cv.getBoundingClientRect(), p = mundo(ev.clientX - r.left, ev.clientY - r.top);
      const i = ev.button === 0 ? acha(p.x, p.y) : -1;
      if (i >= 0) { S.sel = i; S.arr = { tipo: 'el', x0: p.x, y0: p.y, orig: JSON.parse(JSON.stringify(S.arte.elementos[i])) }; pintaEls(); pintaProp(); pintaDesenho(); }
      else S.arr = { tipo: 'pan', sx: ev.clientX, sy: ev.clientY, cx: S.v.cx, cy: S.v.cy };
    });
    cv.addEventListener('pointermove', ev => {
      const r = cv.getBoundingClientRect(), p = mundo(ev.clientX - r.left, ev.clientY - r.top);
      if (!S.arr) { cv.style.cursor = acha(p.x, p.y) >= 0 ? 'move' : 'default'; return; }
      if (S.arr.tipo === 'pan') { S.v.cx = S.arr.cx - (ev.clientX - S.arr.sx) / S.v.s; S.v.cy = S.arr.cy + (ev.clientY - S.arr.sy) / S.v.s; pintaDesenho(); return; }
      const e = S.arte.elementos[S.sel]; if (!e) return;
      const dx = snap(p.x - S.arr.x0, ev.shiftKey), dy = snap(p.y - S.arr.y0, ev.shiftKey);
      Object.assign(e, JSON.parse(JSON.stringify(S.arr.orig))); moveEl(e, dx, dy);
      S.arr.mexeu = S.arr.mexeu || dx !== 0 || dy !== 0;
      pintaDesenho();
    });
    cv.addEventListener('pointerup', () => { const a = S.arr; S.arr = null; if (a && a.tipo === 'el' && a.mexeu) muda(); });
    cv.addEventListener('wheel', ev => {
      ev.preventDefault();
      const r = cv.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top, a = mundo(sx, sy);
      S.v.s = Math.max(1, Math.min(400, S.v.s * (ev.deltaY < 0 ? 1.2 : 1 / 1.2)));
      const b = mundo(sx, sy); S.v.cx += a.x - b.x; S.v.cy += a.y - b.y; pintaDesenho();
    }, { passive: false });
    function teclas(ev) {
      if (!scrim.isConnected || document.querySelector('.sg-scrim:not([hidden]), .hd-scrim:not([hidden])')) return;
      const campo = ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fecha(); return; }
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === 's' || ev.key === 'S')) { ev.preventDefault(); ev.stopPropagation(); salvar(); return; }
      if (campo) return;
      const e = S.arte && S.arte.elementos[S.sel];
      if (e && (ev.key === 'Delete' || ev.key === 'Backspace')) { ev.preventDefault(); ev.stopPropagation(); S.arte.elementos.splice(S.sel, 1); S.sel = Math.min(S.sel, S.arte.elementos.length - 1); muda(); return; }
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[ev.key];
      if (e && d) { ev.preventDefault(); ev.stopPropagation(); const p = ev.shiftKey ? 1 : 0.1; moveEl(e, d[0] * p, d[1] * p); muda(); return; }
      if (ev.key === 'f' || ev.key === 'F') { ev.preventDefault(); ev.stopPropagation(); enquadra(); pintaDesenho(); }
      ev.stopPropagation();
    }
    document.addEventListener('keydown', teclas, true);

    const ctl = { abre: id2 => { const a = arte(id2); if (a) trocaPara(() => carrega(a)); }, pintaBib, fecha: () => fecha(true), estado: () => S, salvar, colocar, poeEl };
    ST.studio = ctl;
    const ini = (id && arte(id)) || lista()[0];
    if (ini) carrega(ini); else nova();
    if (!ST.carregado) recarrega().then(() => { if (id && arte(id) && S.arte && S.arte.id !== id) carrega(arte(id)); });
    requestAnimationFrame(() => { const r = cvw.getBoundingClientRect(); W = r.width; H = r.height; enquadra(); pintaDesenho(); });
    return ctl;
  }

  async function post(url, corpo) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      let j = null; try { j = await r.json(); } catch (e) { j = null; }
      if (!r.ok || !j || !j.ok) return { ok: false, status: r.status, error: (j && j.error) || ('HTTP ' + r.status) };
      return Object.assign({ status: r.status }, j);
    } catch (e) { return { ok: false, status: 0, error: String(e && e.message || e) }; }
  }

  return { alterna, abreLista, fechaLista, abreStudio, lista, recarrega, arte, studio: () => ST.studio, listaAberta: () => !!ST.lista, estado: () => ST };
}

return { instala, desenhaFp, miniatura, caixaReal };
});
