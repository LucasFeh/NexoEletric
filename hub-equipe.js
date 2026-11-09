/* NexoEletric - hub-equipe.js — quem está logado, a EQUIPE do projeto e o histórico de MODIFICAÇÕES com autor (1.84.0).

   Pedido do dono (2026-11-09): "o carimbo é feito a partir do login [...] alguém que é responsável por um projeto pode
   convidar um 'colaborador' pra mexer no projeto junto (perfis admin conseguem mexer em tudo sem ser convidado). E no
   histórico de modificação, agora fala exatamente o que foi modificado e quem modificou, a partir do login da pessoa,
   com a fotinha dela e o nome também."

   O servidor decide tudo (tools/rotas/equipe.py: ele pergunta ao Nexo Hub quem está logado; o /api/save do Python e o
   do Rust recusam quem não é da equipe). Aqui só a tela, no hub e nas vistas Esquema/PCB:
     HubEquipe.abre(projeto)                 o diálogo "Equipe do projeto" (responsável, colaboradores, convidar)
     HubEquipe.tagArvore(nome)               o indicador na árvore: meu / colaborador / somente leitura
     HubEquipe.pintaModificacoes(el, proj)   a aba "Modificações" do Histórico (foto, nome, quando, o que mudou)
     HubEquipe.cracha(usuario, o)            a foto redonda (ou as iniciais) + o nome
     HubEquipe.sessao() / ouve(fn)           quem está logado (o que o servidor vê: GET /api/sessao)
     HubEquipe.somenteLeitura() / bloqueia(relPath)   a vista (?p=) de um projeto em que a pessoa não mexe: a faixa no
                                             topo, o Salvar recusa na hora e o autosave não grava (hub-io.js, hub-autosave.js)
   Nada de alert/confirm/prompt: modal no tema e toast (HubDialog nas vistas; o toast do hub no hub). */
(function (root) {
'use strict';
if (typeof window === 'undefined' || typeof document === 'undefined') { if (typeof module !== 'undefined') module.exports = {}; return; }

const CSS = `
.eq-ov{position:fixed; inset:0; z-index:72; background:var(--scrim, rgba(11,11,13,.6)); display:flex; align-items:center;
  justify-content:center; color:var(--text, #d8d8d8); font:13px/1.45 var(--font, "Segoe UI", system-ui, sans-serif);}
.eq-box{background:var(--surface, #2d2d2d); border:1px solid var(--line, #444); border-radius:var(--r-md, 8px); width:min(560px, 94vw);
  max-height:88vh; display:flex; flex-direction:column; box-shadow:var(--shadow-menu, 0 8px 30px rgba(0,0,0,.5));}
.eq-hd{display:flex; align-items:baseline; gap:8px; padding:12px 14px 10px; border-bottom:1px solid var(--line, #444);}
.eq-hd h2{font-size:14px; font-weight:600; margin:0;}
.eq-dim{font-size:11.5px; color:var(--text-3, #999);}
.eq-corpo{overflow:auto; padding:12px 14px; display:flex; flex-direction:column; gap:10px;}
.eq-pe{display:flex; gap:8px; align-items:center; padding:10px 14px; border-top:1px solid var(--line, #444);}
.eq-pe .eq-sp{flex:1;}
.eq-sec{font-size:10.5px; text-transform:uppercase; letter-spacing:.09em; color:var(--text-3, #999); margin-top:2px;}
.eq-lin{display:flex; align-items:center; gap:10px; padding:7px 9px; border:1px solid var(--line, #444); border-radius:var(--r-sm, 6px);}
.eq-lin .eq-quem{flex:1; min-width:0;}
.eq-vazio{font-size:12px; color:var(--text-3, #999); padding:4px 2px;}
.eq-box button, .eq-faixa button{cursor:pointer; padding:4px 11px; border-radius:var(--r-sm, 6px); border:1px solid var(--line, #444);
  background:var(--surface-2, #2a2a2a); color:var(--text, #ddd); font:12px var(--font, sans-serif); white-space:nowrap;}
.eq-box button:hover:not(:disabled){border-color:var(--hi, #3b82f6);}
.eq-box button:disabled{opacity:.45; cursor:default;}
.eq-box button.eq-forte{background:var(--hi, #3b82f6); border-color:var(--hi, #3b82f6); color:var(--on-hi, #fff);}
.eq-box button.eq-perigo:hover{color:var(--err, #f87171); border-color:var(--err, #f87171);}
.eq-box input[type=search]{background:var(--sunken, #1e1e1e); color:var(--text, #ddd); border:1px solid var(--line, #444);
  border-radius:var(--r-sm, 6px); padding:5px 8px; font:12px var(--font, sans-serif); width:100%; box-sizing:border-box;}
.eq-box input:focus{outline:none; border-color:var(--hi, #3b82f6);}
.eq-lista{display:flex; flex-direction:column; gap:4px; max-height:220px; overflow:auto;}
.eq-erro{font-size:12px; color:var(--err, #f87171); min-height:1em;}
.eq-cr{display:inline-flex; align-items:center; gap:8px; min-width:0; max-width:100%; vertical-align:middle;}
.eq-av{flex:none; border-radius:50%; overflow:hidden; display:inline-flex; align-items:center; justify-content:center;
  background:var(--surface-2, #333); border:1px solid var(--line, #444); color:var(--text-2, #ccc); font-weight:600;
  letter-spacing:.02em; box-sizing:border-box;}
.eq-av img{width:100%; height:100%; object-fit:cover; display:block;}
.eq-cr-txt{display:flex; flex-direction:column; min-width:0; line-height:1.25;}
.eq-cr-nome{font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.eq-cr-sub{font-size:11px; color:var(--text-3, #999); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.eq-chip{font-size:10px; padding:1px 7px; border-radius:9px; border:1px solid var(--line, #555); color:var(--text-2, #bbb);
  white-space:nowrap; font-weight:500; flex:none;}
.eq-chip.ok{border-color:var(--ok, #4ade80); color:var(--ok, #4ade80);}
.eq-chip.adm{border-color:var(--warn, #d6a75a); color:var(--warn, #d6a75a);}
.eq-chip.ia{border-color:var(--hi, #888); color:var(--hi, #ddd);}
.eq-tag{font-size:9.5px; font-weight:600; margin-left:5px; padding:0 5px; border-radius:7px; white-space:nowrap; flex:none;
  border:1px solid var(--line, #555); color:var(--text-3, #999); line-height:14px; display:inline-flex; align-items:center; gap:3px;}
.eq-tag svg{width:9px; height:9px; fill:none; stroke:currentColor; stroke-width:1.6;}
.eq-tag.meu{color:var(--ok, #4ade80); border-color:color-mix(in srgb, var(--ok, #4ade80) 55%, transparent);}
.eq-tag.colab{color:var(--text-2, #ccc);}
.eq-tag.leitura{color:var(--warn, #d6a75a); border-color:color-mix(in srgb, var(--warn, #d6a75a) 55%, transparent);}
.eq-faixa{position:fixed; top:88px; left:50%; transform:translateX(-50%); z-index:60; display:flex; align-items:center; gap:10px;
  padding:6px 8px 6px 12px; border-radius:18px; background:var(--surface, #2a2a2a); border:1px solid var(--warn, #d6a75a);
  color:var(--text, #ddd); font:12.5px var(--font, sans-serif); box-shadow:var(--shadow-menu, 0 6px 22px rgba(0,0,0,.45)); max-width:92vw;}
.eq-faixa b{color:var(--warn, #d6a75a); font-weight:600;}
.eq-faixa svg{width:14px; height:14px; fill:none; stroke:var(--warn, #d6a75a); stroke-width:1.6; flex:none;}
.eq-faixa span{white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.md-corpo[hidden], .rv-corpo[hidden]{display:none !important;}
.md-corpo{padding:12px; display:flex; flex-direction:column; gap:8px; max-width:980px;}
.md-dia{font-size:10.5px; text-transform:uppercase; letter-spacing:.09em; color:var(--text-3, #999); margin:8px 0 0;}
.md-card{display:grid; grid-template-columns:34px minmax(0,1fr); gap:10px; padding:10px 12px; border:1px solid var(--line, #333);
  border-radius:var(--r-md, 8px); background:var(--surface, #1c1c1c);}
.md-cab{display:flex; align-items:baseline; gap:8px; flex-wrap:wrap;}
.md-nome{font-weight:600; font-size:13px;}
.md-meta{font-size:11.5px; color:var(--text-3, #999);}
.md-card ul{margin:5px 0 0; padding-left:17px; font-size:12.5px; color:var(--text-2, #bbb); line-height:1.55;}
.md-card li{word-break:break-word;}
.md-mais{font-size:11.5px; color:var(--text-3, #999); cursor:pointer; background:none; border:0; padding:2px 0 0 17px; text-decoration:underline;}
.md-vazio{font-size:12px; color:var(--text-3, #999); padding:6px 0;}
`;
function css() {
  if (document.getElementById('eq-css')) return;
  const s = document.createElement('style'); s.id = 'eq-css'; s.textContent = CSS; document.head.append(s);
}
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
function botao(txt, titulo, fn, cls) { const b = el('button', cls || null, txt); b.type = 'button'; if (titulo) b.title = titulo; b.addEventListener('click', fn); return b; }
function toast(txt, tipo, ms) {
  if (root.HubDialog && root.HubDialog.toast) return root.HubDialog.toast(txt, tipo || 'info', ms);
  if (typeof root.toast === 'function') return root.toast(txt, tipo === 'err' ? 'err' : tipo === 'warn' ? 'warn' : 'ok');
}
async function api(url, corpo) {
  try {
    const r = await fetch(url, corpo === undefined ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    let j = {};
    try { j = await r.json(); } catch (_) { /* sem corpo */ }
    if (!r.ok && j.ok !== false) j = { ok: false, error: 'HTTP ' + r.status };
    j.status = r.status;
    return j;
  } catch (e) { return { ok: false, error: String(e && e.message || e), rede: true }; }
}
const enc = encodeURIComponent;
const topo = (() => { try { return window.top !== window && window.top.HubEquipe ? window.top : null; } catch (_) { return null; } });

/* ─── quem está logado (o que o servidor vê) ─── */
let ses = { modo: 'carregando', usuario: null, carregado: false };
let sesQuando = 0, sesPedido = null;
const ouvintes = new Set();
function ouve(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
function avisa() { for (const fn of ouvintes) try { fn(ses); } catch (_) { /* um ouvinte quebrado não derruba os outros */ } }
function sessao(forcar) {
  if (!forcar && ses.carregado && Date.now() - sesQuando < 3000) return Promise.resolve(ses);
  if (!sesPedido) {
    sesPedido = api('/api/sessao').then(j => {
      const antes = JSON.stringify([ses.modo, ses.usuario]);
      if (j.ok) ses = { modo: j.modo, usuario: j.usuario || null, carregado: true };
      sesQuando = Date.now();
      if (JSON.stringify([ses.modo, ses.usuario]) !== antes) avisa();
      return ses;
    }).finally(() => { sesPedido = null; });
  }
  return sesPedido;
}
/* o login trocou no Nexo Hub (hub-nexohub-login.js, na janela de cima): todo mundo relê */
try {
  (window.top || window).addEventListener('nexohub:sessao', () => {
    setTimeout(() => { sessao(true); equipes = null; leEquipes(); if (vista.projeto) confereVista(); }, 300);
  });
} catch (_) { /* outra origem */ }

/* as fotos: pela equipe do Hub (a foto tem o sha, então o navegador guarda); quem não está nela, pelo id */
let time_ = null, timePedido = null;
function equipeDoHub() {
  if (time_) return Promise.resolve(time_);
  if (!timePedido) timePedido = api('/api/sessao/usuarios').then(j => { time_ = j.ok ? j.usuarios || [] : []; return time_; })
    .finally(() => { timePedido = null; });
  return timePedido;
}
function iniciais(nome) {
  const p = String(nome || '?').trim().split(/\s+/).filter(Boolean);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
function avatar(u, px) {
  css();
  const a = el('span', 'eq-av');
  a.style.width = a.style.height = px + 'px';
  a.style.fontSize = Math.max(8, Math.round(px * 0.4)) + 'px';
  const nome = (u && (u.nome || u.login)) || '';
  a.textContent = u ? iniciais(nome) : 'IA';
  a.title = nome;
  if (!u || !u.id) return a;
  const poe = foto => {
    if (foto === null) return;                       // a pessoa não tem foto: ficam as iniciais
    const img = new Image(); img.alt = ''; img.decoding = 'async';
    img.onload = () => { a.textContent = ''; a.append(img); };
    img.src = '/api/sessao/foto?id=' + enc(u.id) + (foto ? '&v=' + enc(foto) : '');
  };
  if (u.foto !== undefined) poe(u.foto);
  else equipeDoHub().then(l => { const x = l.find(y => y.id === u.id); poe(x ? x.foto : ''); });
  return a;
}
/* a foto + o nome (+ a linha de baixo e as tags) */
function cracha(u, o) {
  o = o || {};
  css();
  const c = el('span', 'eq-cr');
  c.append(avatar(u, o.px || 28));
  const t = el('span', 'eq-cr-txt');
  const n = el('span', 'eq-cr-nome', u ? (u.nome || u.login) : (o.semNome || 'ninguém'));
  t.append(n);
  if (o.sub) t.append(el('span', 'eq-cr-sub', o.sub));
  c.append(t);
  if (o.tags && u) {
    if (u.admin) c.append(el('span', 'eq-chip adm', 'Administrador'));
    if (u.aprovador) c.append(el('span', 'eq-chip ok', 'Aprovador'));
  }
  return c;
}

/* ─── o modal ─── */
function modal(titulo, sub) {
  css();
  const ov = el('div', 'eq-ov'), bx = el('div', 'eq-box');
  bx.setAttribute('role', 'dialog'); bx.setAttribute('aria-modal', 'true');
  const hd = el('div', 'eq-hd'); hd.append(el('h2', null, titulo)); if (sub) hd.append(el('span', 'eq-dim', sub));
  const corpo = el('div', 'eq-corpo'), pe = el('div', 'eq-pe');
  bx.append(hd, corpo, pe); ov.append(bx); document.body.append(ov);
  let aoFechar = null;
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); fecha(); } };
  function fecha() { ov.remove(); document.removeEventListener('keydown', esc, true); if (aoFechar) aoFechar(); }
  document.addEventListener('keydown', esc, true);
  ov.addEventListener('mousedown', e => { if (e.target === ov) fecha(); });
  return { ov, bx, corpo, pe, fecha, aoFechar: fn => { aoFechar = fn; } };
}
function confirma(titulo, texto, ok, perigo) {
  return new Promise(res => {
    const m = modal(titulo);
    let feito = false;
    m.aoFechar(() => { if (!feito) res(false); });
    m.corpo.append(el('div', null, texto));
    const b = botao(ok || 'OK', null, () => { feito = true; m.fecha(); res(true); }, perigo ? 'eq-perigo' : 'eq-forte');
    m.pe.append(el('span', 'eq-sp'), botao('Cancelar', null, () => m.fecha()), b);
    b.focus();
  });
}
function quandoCurto(iso) {
  const d = new Date(String(iso || '').replace(' ', 'T'));
  if (isNaN(d)) return '';
  const z = n => String(n).padStart(2, '0');
  return z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + z(d.getFullYear() % 100);
}

/* ─── o diálogo "Equipe do projeto" ─── */
function abre(projeto) {
  const t = topo();
  if (t && t.HubEquipe && t.HubEquipe.abre !== abre) return t.HubEquipe.abre(projeto);
  if (!projeto) { toast('abra um projeto primeiro', 'warn'); return; }
  const m = modal('Equipe do projeto', projeto);
  const erro = el('div', 'eq-erro');
  let st = null, escolhendo = null;   // escolhendo: null | 'convidar' | 'responsavel'
  const pinta = () => {
    m.corpo.replaceChildren();
    if (!st) { m.corpo.append(el('div', 'eq-vazio', 'carregando…')); return; }
    if (!st.ok) { m.corpo.append(el('div', 'eq-erro', 'a equipe não abriu: ' + (st.error || 'sem resposta'))); return; }
    const p = st.permissao || {}, eq = st.equipe || {}, eu = st.usuario;
    if (st.modo === 'legado' || st.modo === 'fora')
      m.corpo.append(el('div', 'eq-erro', st.modo === 'legado' ? 'Atualize o Nexo Hub para 2.26.0+: a equipe do projeto vem do login dele.'
        : 'O Nexo Hub não respondeu: sem ele não dá para saber quem está logado.'));
    m.corpo.append(el('div', 'eq-sec', 'Responsável'));
    const lr = el('div', 'eq-lin');
    if (eq.responsavel) {
      lr.append(Object.assign(cracha(eq.responsavel, { px: 34, sub: '@' + (eq.responsavel.login || '') + (eu && eu.id === eq.responsavel.id ? ' · você' : '') }), { className: 'eq-cr eq-quem' }));
    } else {
      const q = el('div', 'eq-quem'); q.append(el('div', null, 'Sem responsável'), el('div', 'eq-cr-sub', 'projeto antigo: qualquer pessoa logada mexe nele'));
      lr.append(q);
    }
    if (p.assumir) lr.append(botao(eq.responsavel ? 'Assumir' : 'Assumir o projeto', 'você passa a ser o responsável (e o desenhista no quadro de título da folha)', assumir, eq.responsavel ? null : 'eq-forte'));
    if (p.trocarResponsavel) lr.append(botao('Trocar…', 'escolher outro responsável (só o administrador)', () => { escolhendo = escolhendo === 'responsavel' ? null : 'responsavel'; pinta(); }));
    m.corpo.append(lr);
    if (escolhendo === 'responsavel') m.corpo.append(seletor('responsavel'));
    m.corpo.append(el('div', 'eq-sec', 'Colaboradores'));
    const cs = eq.colaboradores || [];
    if (!cs.length) m.corpo.append(el('div', 'eq-vazio', eq.responsavel ? 'Ninguém convidado ainda: só o responsável e os administradores mexem.' : 'Ninguém convidado.'));
    for (const c of cs) {
      const l = el('div', 'eq-lin');
      const sub = (c.convidado_por ? 'convidado por ' + c.convidado_por.nome : '') + (c.em ? ' em ' + quandoCurto(c.em) : '') + (eu && eu.id === c.id ? ' · você' : '');
      l.append(Object.assign(cracha(c, { px: 30, sub }), { className: 'eq-cr eq-quem' }));
      if (p.gerir) l.append(botao('Remover', 'tirar ' + c.nome + ' da equipe', () => remove(c, false), 'eq-perigo'));
      else if (eu && eu.id === c.id) l.append(botao('Sair da equipe', 'você deixa de mexer neste projeto', () => remove(c, true), 'eq-perigo'));
      m.corpo.append(l);
    }
    if (p.gerir) {
      if (escolhendo === 'convidar') m.corpo.append(seletor('convidar'));
      else m.corpo.append(Object.assign(botao('Convidar colaborador…', 'escolher alguém da equipe do Nexo Hub', () => { escolhendo = 'convidar'; pinta(); }), { style: 'align-self:flex-start' }));
    } else if (eq.responsavel && p.papel !== 'admin') {
      m.corpo.append(el('div', 'eq-vazio', 'Só ' + eq.responsavel.nome + ' (o responsável) e os administradores convidam colaboradores.'));
    }
    m.corpo.append(erro);
    // o rodapé: quem é você (definido no Nexo Hub)
    m.pe.replaceChildren();
    const voce = el('div', 'eq-sp');
    if (eu) voce.append(cracha(eu, { px: 24, tags: true, sub: 'você · definido no Nexo Hub' }));
    else voce.append(el('span', 'eq-dim', st.modo === 'deslogado' ? 'ninguém logado no Nexo Hub' : ''));
    m.pe.append(voce, botao('Fechar', null, () => m.fecha()));
  };
  function seletor(modo) {
    const caixa = el('div'); caixa.style.cssText = 'display:flex; flex-direction:column; gap:6px; padding:8px; border:1px dashed var(--line, #555); border-radius:var(--r-sm, 6px)';
    const busca = el('input'); busca.type = 'search'; busca.placeholder = modo === 'convidar' ? 'convidar quem? (nome, login ou e-mail)' : 'o novo responsável (nome ou login)';
    const lista = el('div', 'eq-lista');
    caixa.append(busca, lista);
    const eq = st.equipe || {};
    const fora = new Set([...(eq.colaboradores || []).map(c => c.id), eq.responsavel && eq.responsavel.id].filter(Boolean));
    let todos = null;
    const pintaLista = () => {
      lista.replaceChildren();
      if (!todos) { lista.append(el('div', 'eq-vazio', 'carregando a equipe do Nexo Hub…')); return; }
      const q = busca.value.trim().toLowerCase();
      const l = todos.filter(u => (modo === 'responsavel' ? !(eq.responsavel && eq.responsavel.id === u.id) : !fora.has(u.id))
        && (!q || (u.nome + ' ' + u.login).toLowerCase().includes(q)));
      if (!l.length) lista.append(el('div', 'eq-vazio', q ? 'ninguém com "' + busca.value.trim() + '"' : 'todo mundo da equipe já está no projeto'));
      for (const u of l) {
        const lin = el('div', 'eq-lin');
        lin.append(Object.assign(cracha(u, { px: 26, sub: '@' + u.login, tags: true }), { className: 'eq-cr eq-quem' }));
        lin.append(botao(modo === 'convidar' ? 'Convidar' : 'Tornar responsável', null, () => escolhe(modo, u), 'eq-forte'));
        lista.append(lin);
      }
    };
    busca.addEventListener('input', pintaLista);
    pintaLista();
    time_ = null;
    equipeDoHub().then(l => { todos = l; if (!l.length) lista.replaceChildren(el('div', 'eq-erro', 'a equipe do Nexo Hub não veio (logado? Hub 2.26.0+?)')); else pintaLista(); });
    setTimeout(() => busca.focus(), 0);
    return caixa;
  }
  async function carrega() { st = await api('/api/equipe?projeto=' + enc(projeto)); pinta(); }
  async function posta(rota, corpo, okMsg) {
    erro.textContent = '';
    const j = await api(rota, Object.assign({ projeto }, corpo));
    if (!j.ok) { erro.textContent = j.error || 'não deu'; return false; }
    st = j; escolhendo = null; pinta();
    if (okMsg) toast(okMsg, 'ok');
    depoisDeMudar(projeto);
    return true;
  }
  const escolhe = (modo, u) => modo === 'convidar'
    ? posta('/api/equipe/convidar', { id: u.id }, u.nome + ' agora é colaborador de ' + projeto)
    : posta('/api/equipe/responsavel', { id: u.id }, u.nome + ' agora é o responsável por ' + projeto);
  async function remove(c, euMesmo) {
    if (!(await confirma(euMesmo ? 'Sair da equipe' : 'Tirar da equipe', euMesmo ? 'Você deixa de mexer em ' + projeto + ' (o projeto fica só para leitura para você).'
      : c.nome + ' deixa de mexer em ' + projeto + '.', euMesmo ? 'Sair' : 'Remover', true))) return;
    posta('/api/equipe/remover', { id: c.id }, euMesmo ? 'você saiu da equipe de ' + projeto : c.nome + ' saiu da equipe');
  }
  async function assumir() {
    if (await assumirProjeto(projeto, (st.equipe || {}).responsavel)) await carrega();
  }
  pinta(); carrega();
}
/* ASSUMIR O PROJETO (o que era do carimbo, agora do login): quem está logado vira o responsável (equipe.json) e o
   desenhista no quadro de título (nome do login, data de hoje). O administrador sempre; os outros, só num projeto sem
   responsável (o responsável passa o projeto pelo diálogo Equipe). Sem senha. */
async function assumirProjeto(projeto, resp) {
  if (!projeto) { toast('abra um projeto para assumir', 'warn'); return false; }
  if (resp === undefined) { const j = await api('/api/equipe?projeto=' + enc(projeto)); resp = j.ok ? (j.equipe || {}).responsavel : null; }
  if (!(await confirma('Assumir o projeto', 'Você passa a ser o responsável por ' + projeto + (resp ? ' (no lugar de ' + resp.nome + ')' : '')
    + ' e o desenhista no quadro de título da folha, com a data de hoje. A partir daí só você, os colaboradores que convidar e os administradores mexem nele.', 'Assumir'))) return false;
  // a vista Esquema aberta deste projeto assume (salva o que está pendente e adota o cabeçalho novo, sem recarregar)
  let r = null;
  if (typeof root.__hubAssumirProjeto === 'function') r = await root.__hubAssumirProjeto(projeto);
  else { const j = await api('/api/equipe/assumir', { projeto }); r = j.ok; if (!j.ok) toast('não assumiu: ' + (j.error || 'falhou'), 'err', 7000); }
  if (r) depoisDeMudar(projeto);
  return Boolean(r);
}
/* o "Assumir projeto…" do menu Arquivo: {pode, dica} pelo que já se sabe (o servidor confere de novo) */
function podeAssumir(projeto) {
  const u = ses.usuario;
  if (!projeto) return { pode: false, dica: 'abra um projeto' };
  if (!u) return { pode: false, dica: ses.modo === 'legado' ? 'atualize o Nexo Hub para 2.26.0+' : 'entre no Nexo Hub' };
  const e = equipes && equipes[projeto];
  if (e && e.papel === 'responsavel') return { pode: false, dica: 'você já é o responsável por este projeto' };
  if (u.admin || !e || !e.responsavel) return { pode: true, dica: '' };
  return { pode: false, dica: 'só o administrador ou um projeto sem responsável (o responsável passa o projeto pelo diálogo Equipe)' };
}
function depoisDeMudar(projeto) {
  equipes = null; leEquipes();
  try {
    for (const f of document.querySelectorAll('iframe')) {
      const w = f.contentWindow;
      if (w && w.HubEquipe && w.HubEquipe._vista && w.HubEquipe._vista() === projeto) w.HubEquipe._confere();
    }
  } catch (_) { /* outra origem */ }
}

/* ─── a árvore de projetos: meu / colaborador / somente leitura ─── */
let equipes = null, consulta = null, assinatura = '';
async function leEquipes() {
  if (document.hidden) return;
  const j = await api('/api/equipes');
  if (!j.ok) return;
  const s = JSON.stringify(j.projetos || {});
  equipes = j.projetos || {};
  if (s === assinatura) return;
  assinatura = s;
  if (root.EletricShell && typeof root.EletricShell.render === 'function') root.EletricShell.render();
}
const LOCK = '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="2" y="4.5" width="6" height="4.5" rx="1"/><path d="M3.5 4.5V3a1.5 1.5 0 0 1 3 0v1.5"/></svg>';
function tagArvore(nome) {
  if (!consulta) { css(); consulta = setInterval(leEquipes, 8000); leEquipes(); }
  const e = equipes && equipes[nome];
  if (!e) return null;
  let t = null;
  if (e.papel === 'responsavel') { t = el('span', 'eq-tag meu', 'meu'); t.title = 'você é o responsável por este projeto'; }
  else if (e.papel === 'colaborador') { t = el('span', 'eq-tag colab', 'colab.'); t.title = 'você foi convidado por ' + ((e.responsavel || {}).nome || 'responsável') + ' para mexer neste projeto'; }
  else if (e.papel === 'leitura') { t = el('span', 'eq-tag leitura'); t.innerHTML = LOCK; t.setAttribute('aria-label', 'somente leitura'); t.title = 'somente leitura: o responsável é ' + ((e.responsavel || {}).nome || '—') + '. Peça um convite.'; }
  return t;
}

/* ─── a vista de um projeto (?p=): somente leitura para quem não é da equipe ─── */
const vista = { projeto: null, pode: true, st: null, faixa: null, timer: null };
function projetoDaVista() {
  if (window.top === window && !/frame\.html$/i.test(location.pathname)) return null;
  try { return new URLSearchParams(location.search).get('p') || null; } catch (_) { return null; }
}
async function confereVista() {
  if (!vista.projeto) return;
  const j = await api('/api/equipe?projeto=' + enc(vista.projeto));
  if (!j.ok) return;
  vista.st = j;
  const pode = !(j.permissao && j.permissao.pode === false);
  if (pode === vista.pode && (pode || vista.faixa)) return;
  vista.pode = pode;
  pintaFaixa();
}
function pintaFaixa() {
  css();
  const salvar = document.getElementById('btnSave');
  if (vista.pode) {
    if (vista.faixa) { vista.faixa.remove(); vista.faixa = null; toast('agora você mexe neste projeto', 'ok'); }
    if (salvar && salvar.dataset.eqTitulo !== undefined) { salvar.disabled = false; salvar.title = salvar.dataset.eqTitulo; delete salvar.dataset.eqTitulo; }
    return;
  }
  const resp = (vista.st && vista.st.permissao && vista.st.permissao.responsavel) || {};
  if (!vista.faixa) {
    vista.faixa = el('div', 'eq-faixa');
    vista.faixa.setAttribute('role', 'status');
    document.body.append(vista.faixa);
  }
  vista.faixa.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
  const t = el('span'); t.append(el('b', null, 'Somente leitura'), ' — responsável ' + (resp.nome || '—') + '. Peça um convite.');
  vista.faixa.append(t, botao('Equipe…', 'ver quem mexe neste projeto', () => abre(vista.projeto)));
  if (salvar && salvar.dataset.eqTitulo === undefined) { salvar.dataset.eqTitulo = salvar.title || ''; salvar.disabled = true; salvar.title = 'somente leitura: só a equipe do projeto salva'; }
}
function somenteLeitura() { return Boolean(vista.projeto && !vista.pode); }
function bloqueia(relPath) {
  if (!somenteLeitura()) return null;
  const partes = String(relPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (partes[0] !== 'Projects' || partes[1] !== vista.projeto) return null;
  const resp = (vista.st && vista.st.permissao && vista.st.permissao.responsavel) || {};
  return 'Somente leitura: só o responsável (' + (resp.nome || '—') + ') e os colaboradores convidados mexem neste projeto. Peça um convite.';
}
/* o servidor recusou (o convite caiu enquanto a vista estava aberta): a vista vira somente leitura na hora */
function recusado(j) {
  if (!vista.projeto) return;
  vista.pode = false;
  vista.st = { permissao: { pode: false, responsavel: j && j.responsavel } };
  pintaFaixa();
  confereVista();
}
function iniciaVista() {
  vista.projeto = projetoDaVista();
  if (!vista.projeto) return;
  const vai = () => { confereVista(); vista.timer = setInterval(() => { if (!document.hidden) confereVista(); }, 8000); };
  if (document.body) vai(); else document.addEventListener('DOMContentLoaded', vai, { once: true });
}

/* ─── a aba "Modificações" do Histórico (hub-revisoes.js chama) ─── */
const TIPO_ROT = { esquema: 'Esquema', pcb: 'PCB', regras: 'Regras', anotacoes: 'Sinalizadores', aprovacao: 'Aprovação', revisao: 'Revisões', equipe: 'Equipe' };
function haQuanto(iso) {
  const d = new Date(String(iso || '').replace(' ', 'T'));
  if (isNaN(d)) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 50) return 'agora';
  if (s < 3600) return 'há ' + Math.max(1, Math.round(s / 60)) + ' min';
  if (s < 6 * 3600) return 'há ' + Math.round(s / 3600) + ' h';
  const z = n => String(n).padStart(2, '0');
  return z(d.getHours()) + ':' + z(d.getMinutes());
}
function dia(iso) {
  const d = new Date(String(iso || '').replace(' ', 'T'));
  if (isNaN(d)) return '';
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const d0 = new Date(d); d0.setHours(0, 0, 0, 0);
  const n = Math.round((hoje - d0) / 86400000);
  if (n === 0) return 'Hoje';
  if (n === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}
let seqMd = 0;
async function pintaModificacoes(corpo, projeto) {
  css();
  const n = ++seqMd;
  corpo.classList.add('md-corpo');
  if (!projeto) { corpo.replaceChildren(el('div', 'md-vazio', 'nenhum projeto aberto')); return; }
  if (!corpo.childNodes.length) corpo.append(el('div', 'md-vazio', 'carregando…'));
  const j = await api('/api/historico?projeto=' + enc(projeto) + '&limite=400');
  if (n !== seqMd) return;
  if (!j.ok) { corpo.replaceChildren(el('div', 'md-vazio', 'as modificações não abriram: ' + (j.error || 'sem resposta'))); return; }
  const out = [];
  const ent = j.entradas || [];
  if (!ent.length) out.push(el('div', 'md-vazio', 'Nenhuma modificação registrada ainda. Cada vez que alguém salva o esquema, a PCB ou as regras (ou a IA mexe), aparece aqui quem foi e o que mudou.'));
  let diaAtual = '';
  for (const e of ent) {
    const dd = dia(e.ate || e.quando);
    if (dd !== diaAtual) { diaAtual = dd; out.push(el('div', 'md-dia', dd)); }
    const c = el('div', 'md-card');
    c.append(avatar(e.usuario, 32));
    const dir = el('div');
    const cab = el('div', 'md-cab');
    cab.append(el('span', 'md-nome', e.usuario ? (e.usuario.nome || e.usuario.login) : 'sem login'));
    if (e.origem === 'ia') { const ia = el('span', 'eq-chip ia', 'pela IA'); ia.title = 'gravado pela IA (MCP) para ' + (e.usuario ? e.usuario.nome : 'quem estava logado') + ((e.ferramentas || []).length ? ': ' + e.ferramentas.join(', ') : ''); cab.append(ia); }
    const quando = haQuanto(e.ate || e.quando);
    const meta = el('span', 'md-meta', [TIPO_ROT[e.tipo] || e.arquivo || '', quando, (e.gravacoes || 1) > 1 ? e.gravacoes + ' gravações' : ''].filter(Boolean).join(' · '));
    meta.title = (e.quando && e.ate && e.quando !== e.ate ? 'de ' + e.quando.replace('T', ' ') + ' a ' + e.ate.replace('T', ' ') : (e.ate || e.quando || '').replace('T', ' '))
      + (e.arquivo ? ' · ' + e.arquivo : '');
    cab.append(meta);
    dir.append(cab);
    const ul = el('ul');
    const ms = e.mudancas || [];
    const LIM = 8;
    for (const m of ms.slice(0, LIM)) ul.append(el('li', null, m));
    dir.append(ul);
    if (ms.length > LIM) {
      const mais = el('button', 'md-mais', 'mais ' + (ms.length - LIM)); mais.type = 'button';
      mais.addEventListener('click', () => { for (const m of ms.slice(LIM)) ul.append(el('li', null, m)); mais.remove(); });
      dir.append(mais);
    }
    c.append(dir);
    out.push(c);
  }
  corpo.replaceChildren(...out);
}

/* ─── excluir projeto (1.86.0: sem senha mestre; o diálogo é o do hub.html » openDeleteDialog) ───
   O "Excluir projeto…" do botão direito na árvore (hub-shell.js) pergunta aqui, pelo que já se sabe (/api/equipes), se
   quem está logado exclui: o administrador do Nexo Hub ou o responsável pelo projeto. {pode, dica}; o servidor confere
   de novo (403 sem_permissao). */
function podeExcluir(projeto) {
  const u = ses.usuario;
  if (!projeto) return { pode: false, dica: 'abra um projeto' };
  const e = equipes && equipes[projeto];
  if (e && typeof e.apagar === 'boolean') return { pode: e.apagar, dica: e.apagar ? '' : (e.motivoApagar || 'só o administrador ou o responsável pelo projeto exclui') };
  if (!ses.carregado || !equipes) return { pode: true, dica: '' };          /* ainda não sabe: o diálogo explica */
  if (!u) return { pode: false, dica: ses.modo === 'legado' ? 'atualize o Nexo Hub para 2.26.0+' : 'entre no Nexo Hub: só o administrador ou o responsável pelo projeto exclui' };
  return { pode: Boolean(u.admin), dica: u.admin ? '' : 'só o administrador ou o responsável pelo projeto exclui' };
}

/* o "Equipe do projeto…" do menu Arquivo do hub (hub-menubar.js) e do clique direito na árvore (hub-shell.js) */
function projetoAberto() { try { const p = typeof proj === 'function' ? proj() : null; return p ? p.name : ''; } catch (_) { return ''; } }   // eslint-disable-line no-undef

root.HubEquipe = { abre, assumir: assumirProjeto, podeAssumir, podeExcluir, tagArvore, pintaModificacoes, cracha, avatar, sessao, ouve, somenteLeitura, bloqueia, recusado, confirma,
                   haQuanto, _vista: () => vista.projeto, _confere: confereVista };
if (window.top === window) {
  root.__hubEquipeProjeto = nome => abre(nome || projetoAberto());
  root.__hubEquipeAssumir = nome => assumirProjeto(nome || projetoAberto());
  root.__hubEquipePodeAssumir = nome => podeAssumir(nome || projetoAberto());
  setTimeout(leEquipes, 800);
}
iniciaVista();
sessao();
})(typeof window !== 'undefined' ? window : globalThis);
