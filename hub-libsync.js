/* AltiumPCBMirror v2 - hub-libsync.js — as libs do hub e do Altium andam juntas.

   Quem manda é o Altium. O que foi mudado direto na .SchLib (a da casa, no Y:, ou as do
   almoxarifado em Libs\Almox) vale mais que o espelho do hub, e mais que o que o Odoo
   traria na próxima sincronização. Este módulo é a ponta do hub nessa hierarquia: ao
   entrar na aba Biblioteca pergunta ao servidor (GET /api/symbols/altium-changes) se
   alguma .SchLib mudou desde a última vez que o hub a viu; se mudou, acende um badge na
   fileira de sub-abas, busca o detalhe (deep=1) e, com itens, pergunta num modal do tema
   se é para trazer isso para a lib do hub (POST /api/symbols/altium-apply).

   Convívio: no máximo uma consulta a cada 30 s e nunca duas em paralelo — a casca chama
   verifica() a cada renderPanes(), e o servidor não pode ser consultado a cada clique.
   "Agora não" guarda em sessionStorage a assinatura do que foi visto: as mesmas mudanças
   não perguntam de novo nesta aba, mas o badge continua e reabre o modal. Se o editor de
   símbolos tem edição não salva justamente num símbolo que o Altium mudou, avisa antes.

   UMD como hub-core.js: as funções puras (assinatura, montaLista, throttle...) saem em
   `pure` para tests/test-libsync.js rodar em Node — nada de DOM fora de função. Os textos
   vêm da casca por opts.t (hub-i18n.js, chaves ls.*). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HubLibSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const INTERVALO = 30000;                     /* entre duas consultas ao servidor */
const MAX_LISTA = 12;                        /* nomes no modal; o resto vira "+k" */
const SS_KEY = 'altiumhub.libsync.adiado';
/* o que o servidor sabe dizer que mudou num símbolo; fora disto o rótulo vai cru */
const MUDANCAS = ['geometria', 'descricao', 'footprints', 'flags', 'cores', 'novo'];

/* t() de reserva (Node, ou casca sem i18n): a chave volta como ela mesma, com {n} trocado */
const semT = (k, vars) => !vars ? k : k.replace(/\{(\w+)\}/g, (m, v) => (v in vars ? String(vars[v]) : m));

/* ═══════════════════════ lógica pura ═══════════════════════ */

const chaveItem = it => it && it.acervo === 'almox'
  ? 'almox/' + (it.familia || '') + '/' + (it.componente || it.name || '')
  : 'altium/' + ((it && it.name) || '');

/* Assinatura do que o servidor acusou: os arquivos que mudaram (com mtime/size quando o
   servidor os manda) e os itens com o que mudou em cada um. É o que "Agora não" guarda —
   a mesma assinatura na próxima visita quer dizer "as mesmas mudanças", e aí não se
   pergunta de novo; um símbolo a mais, ou um mtime novo, e a pergunta volta. */
function assinatura(arquivos, itens) {
  const arq = (arquivos || []).filter(a => a && a.mudou)
    .map(a => [a.arquivo || '?', a.mtime == null ? '' : a.mtime, a.size == null ? '' : a.size].join('@')).sort();
  const its = (itens || []).map(it => chaveItem(it) + ':' + (it.mudou || []).slice().sort().join(',')).sort();
  return arq.join('|') + '#' + its.join('|');
}

/* um item do servidor → o que a linha do modal mostra */
function descreveItem(it, t) {
  t = t || semT;
  const mud = ((it && it.mudou) || []).map(m => MUDANCAS.indexOf(m) >= 0 ? t('ls.mud.' + m) : String(m));
  if (it && it.acervo === 'almox')
    return { nome: [it.familia, it.componente].filter(Boolean).join(' / ') || it.name || '?', acervo: t('ls.almox'), mudou: mud };
  return { nome: (it && it.name) || '?', acervo: t('ls.acervoAltium'), mudou: mud };
}
function montaLista(itens, t, max) {
  const lim = max || MAX_LISTA, all = itens || [];
  return { linhas: all.slice(0, lim).map(it => descreveItem(it, t)), sobra: Math.max(0, all.length - lim), total: all.length };
}
function textoIntro(n, t) { t = t || semT; return n === 1 ? t('ls.texto1') : t('ls.texto', { n }); }
function textoPronto(n, t) { t = t || semT; return n === 1 ? t('ls.pronto1') : t('ls.pronto', { n }); }
/* o corpo do altium-apply é a lista como o servidor a mandou: é ele quem sabe o que cada campo é */
function corpoApply(itens) { return { itens: (itens || []).map(it => Object.assign({}, it)) }; }
/* o símbolo aberto no editor está entre os que o Altium mudou? (só o espelho da casa —
   o editor não abre componente do almoxarifado) */
function editorNaLista(itens, sel) { return !!sel && (itens || []).some(it => it && it.acervo !== 'almox' && it.name === sel); }
const arquivosMudados = arquivos => (arquivos || []).filter(a => a && a.mudou)
  .map(a => String(a.arquivo || '').split(/[\\/]/).pop());

/* Throttle com relógio injetável: uma chamada em curso é devolvida a quem pedir de novo;
   fora disso só passa uma a cada `intervalo`. zera() é para depois de aplicar — a
   próxima entrada na aba deve conferir na hora que o ledger ficou limpo. */
function mkThrottle(intervalo, clock) {
  const rel = clock || (() => Date.now());
  /* "nunca rodou" é -Infinity, não 0: com 0 um relógio pequeno (o do teste) contaria a
     primeira chamada como "há menos de 30 s" */
  const T = { ultimo: -Infinity, emCurso: null };
  T.tenta = fn => {
    if (T.emCurso) return T.emCurso;
    if (rel() - T.ultimo < intervalo) return null;
    T.ultimo = rel();
    T.emCurso = Promise.resolve().then(fn).then(v => { T.emCurso = null; return v; },
                                            e => { T.emCurso = null; throw e; });
    return T.emCurso;
  };
  T.zera = () => { T.ultimo = -Infinity; };
  return T;
}

/* "Agora não" vive na sessão da aba: fechar a aba esquece, F5 lembra */
function adiado(assin, store) { try { return !!assin && !!store && store.getItem(SS_KEY) === assin; } catch (e) { return false; } }
function marcaAdiado(assin, store) { try { if (store) store.setItem(SS_KEY, assin); } catch (e) {} }
function limpaAdiado(store) { try { if (store) store.removeItem(SS_KEY); } catch (e) {} }

const pure = { assinatura, chaveItem, descreveItem, montaLista, textoIntro, textoPronto, corpoApply,
               editorNaLista, arquivosMudados, mkThrottle, adiado, marcaAdiado, limpaAdiado,
               INTERVALO, MAX_LISTA, SS_KEY, MUDANCAS };

/* ═══════════════════════ estado e servidor ═══════════════════════ */

const ST = { pendente: false, arquivos: [], itens: null, deep: false, el: null, modal: null };
const thr = mkThrottle(INTERVALO);
let O = {};            /* opts do último verifica(): t, toast, editor(), onApplied() */
const T = (k, v) => (O.t || semT)(k, v);
const ss = () => { try { return window.sessionStorage; } catch (e) { return null; } };
const online = () => typeof location !== 'undefined' && /^http/.test(location.protocol);
const seguro = fn => { try { return fn(); } catch (e) { return null; } };

async function getJson(url) {
  try { const r = await fetch(url); if (!r.ok) return null; return await r.json(); } catch (e) { return null; }
}
async function postJson(url, body) {
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) { return { ok: false, error: 'servidor não respondeu: ' + e.message }; }
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!r.ok) return { ok: false, error: (j && j.error) || ('HTTP ' + r.status) };
  return j || { ok: false, error: 'resposta vazia' };
}

/* A casca chama a cada renderPanes() da Biblioteca. Nunca estoura: um erro aqui não pode
   derrubar a aba — sem servidor, ou servidor sem a rota, simplesmente não há badge. */
function verifica(opts) {
  if (opts) O = opts;
  if (!online()) return null;
  try { return thr.tenta(consulta); } catch (e) { return null; }
}
async function consulta() {
  const r = await getJson('/api/symbols/altium-changes');
  if (!r || !r.ok) { ST.pendente = false; ST.itens = null; refreshBadge(); return r; }
  ST.arquivos = r.arquivos || [];
  ST.pendente = !!r.pendente;
  ST.itens = null;
  refreshBadge();
  if (!ST.pendente) return r;
  /* barato primeiro (mtime/size), o detalhe só quando há o que detalhar */
  ST.deep = true; refreshBadge();
  const d = await getJson('/api/symbols/altium-changes?deep=1');
  ST.deep = false;
  ST.itens = (d && d.ok && Array.isArray(d.itens)) ? d.itens : [];
  if (d && d.ok && Array.isArray(d.arquivos) && d.arquivos.length) ST.arquivos = d.arquivos;
  /* mtime mudou mas o conteúdo é o mesmo do hub: nada a trazer, nada a acusar */
  if (!ST.itens.length) { ST.pendente = false; refreshBadge(); return d; }
  refreshBadge();
  /* pergunta só se a Biblioteca ainda está na tela (a resposta pode chegar depois de a
     pessoa trocar de aba) e se não há outro diálogo aberto por cima */
  if (!adiado(assinatura(ST.arquivos, ST.itens), ss()) && libNaTela() && !overlayOcupado()) abreModal();
  return d;
}

/* ═══════════════════════ DOM ═══════════════════════ */

const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const libNaTela = () => !!document.querySelector('#subtabs .libpick');
const overlayOcupado = () => { const ov = document.getElementById('overlay'); return !!(ov && ov.childElementCount); };
const modalAberto = () => !!(ST.modal && ST.modal.isConnected);

/* O badge é um nó só, reaproveitado: a casca refaz a fileira de sub-abas a cada
   renderTabs() e pede badge() de novo — prepend move o nó, não o duplica. */
function badge() {
  if (!ST.pendente) return null;
  if (!ST.el) {
    const b = el('button', 'libsync-badge'); b.type = 'button';
    b.append(el('i'), el('span'));
    b.onclick = onBadgeClick;
    ST.el = b;
  }
  ST.el.lastChild.textContent = T('ls.badge');
  const arqs = arquivosMudados(ST.arquivos);
  ST.el.title = T('ls.badgeHint') + (arqs.length ? '\n' + arqs.join('\n') : '');
  ST.el.classList.toggle('busy', !!ST.deep);
  ST.el.setAttribute('aria-busy', String(!!ST.deep));
  return ST.el;
}
function refreshBadge() {
  const b = badge();
  if (!b) { if (ST.el && ST.el.isConnected) ST.el.remove(); return; }
  const pick = document.querySelector('#subtabs .libpick');
  if (pick && !b.isConnected) pick.prepend(b);
}
function onBadgeClick() {
  if (ST.itens && ST.itens.length) { abreModal(); return; }
  if (ST.deep) { if (O.toast) O.toast(T('ls.conferindo'), 'warn'); return; }
  thr.zera(); verifica();
}

/* modal de confirmação no tema do hub (o mesmo backdrop + dialog do openDeleteDialog);
   fecha só a si mesmo, porque pode estar por cima do modal principal */
function confirma(msg, o) {
  o = o || {};
  return new Promise(resolve => {
    const ov = document.getElementById('overlay'); if (!ov) { resolve(false); return; }
    const bd = el('div', 'backdrop center');
    const d = el('div', 'dialog libsync-dlg libsync-confirma'); d.setAttribute('role', 'alertdialog');
    d.append(el('h3', null, o.title || T('ls.sujoTitulo')), el('p', 'libsync-p', msg));
    const act = el('div', 'libsync-acoes');
    const nao = el('button', 'btn btn-ghost', T('ls.cancelar')); nao.type = 'button';
    const sim = el('button', 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary'), o.ok || 'OK'); sim.type = 'button';
    const fim = v => { bd.remove(); resolve(v); };
    nao.onclick = () => fim(false); sim.onclick = () => fim(true);
    bd.onclick = e => { if (e.target === bd) fim(false); };
    d.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); fim(false); } };
    act.append(nao, sim); d.append(act); bd.append(d); ov.append(bd);
    sim.focus();
  });
}

function fecha() { if (ST.modal) { ST.modal.remove(); ST.modal = null; } }

function abreModal() {
  if (modalAberto()) return;
  const ov = document.getElementById('overlay'); if (!ov) return;
  const itens = ST.itens || [];
  const bd = el('div', 'backdrop center');
  const d = el('div', 'dialog libsync-dlg'); d.setAttribute('role', 'dialog');
  d.append(el('h3', null, T('ls.titulo')));
  d.append(el('p', 'libsync-p', textoIntro(itens.length, T)));

  const L = montaLista(itens, T);
  const ul = el('div', 'libsync-lista');
  L.linhas.forEach(x => {
    const li = el('div', 'libsync-li');
    li.append(el('span', 'nm', x.nome), el('span', 'ac', x.acervo), el('span', 'mud', x.mudou.join(' · ')));
    li.title = x.nome;
    ul.append(li);
  });
  if (L.sobra) ul.append(el('div', 'libsync-mais', T('ls.mais', { k: L.sobra })));
  d.append(ul);

  const arqs = arquivosMudados(ST.arquivos);
  if (arqs.length) d.append(el('p', 'libsync-arq mono', T('ls.arquivos') + ': ' + arqs.join(' · ')));
  d.append(el('p', 'libsync-p', T('ls.pergunta')));

  const act = el('div', 'libsync-acoes');
  const nao = el('button', 'btn btn-ghost', T('ls.agoraNao')); nao.type = 'button';
  const sim = el('button', 'btn btn-primary', T('ls.atualizar')); sim.type = 'button';
  /* "Agora não" (e clicar fora, e Esc) = não perguntar de novo por ESTAS mudanças */
  const agoraNao = () => { marcaAdiado(assinatura(ST.arquivos, itens), ss()); fecha(); };
  nao.onclick = agoraNao;
  sim.onclick = () => aplica(itens, sim, nao);
  bd.onclick = e => { if (e.target === bd) agoraNao(); };
  d.onkeydown = e => { if (e.key === 'Escape') agoraNao(); };   /* a casca fecha o overlay em seguida */
  act.append(nao, sim); d.append(act); bd.append(d); ov.append(bd);
  ST.modal = bd;
  sim.focus();
}

async function aplica(itens, sim, nao) {
  /* edição não salva no editor de símbolos, no mesmo símbolo que o Altium mudou: a versão
     do Altium vai passar por cima do espelho — quem decide é a pessoa */
  const ed = O.editor ? seguro(O.editor) : null;
  if (ed && ed.dirty && editorNaLista(itens, ed.sel)) {
    const ok = await confirma(T('ls.sujo', { x: ed.sel }), { title: T('ls.sujoTitulo'), ok: T('ls.sujoOk'), danger: true });
    if (!ok) return;
  }
  sim.disabled = true; nao.disabled = true;
  const r = await postJson('/api/symbols/altium-apply', corpoApply(itens));
  sim.disabled = false; nao.disabled = false;
  if (!r || !r.ok) { if (O.toast) O.toast(T('ls.falhou', { e: (r && r.error) || '?' }), 'err'); return; }
  fecha();
  ST.pendente = false; ST.itens = null; limpaAdiado(ss()); thr.zera(); refreshBadge();
  const n = r.aplicados != null ? r.aplicados : itens.length;
  let msg = textoPronto(n, T);
  /* o editor de símbolos guarda o espelho em memória e (hoje) não expõe recarga: se ele já
     carregou a lista, a geometria nova só aparece lá depois de um F5 — melhor dizer */
  const symed = typeof window !== 'undefined' ? window.HubSymEd : null;
  if (ed && ed.carregado && !(symed && typeof symed.reload === 'function')) msg += T('ls.prontoSymed');
  if (O.toast) O.toast(msg, 'ok');
  if (O.onApplied) { try { O.onApplied(r); } catch (e) {} }
}

return { verifica, badge, abreModal, estado: ST, pure };
});
