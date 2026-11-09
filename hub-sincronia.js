/* NexoEletric - hub-sincronia.js — "o seu projeto está desatualizado" (1.85.0).

   Pedido do dono (2026-11-09): "quando eu estiver fazendo alguma alteração no meu projeto, se outro colaborador ou admin
   estiver com o projeto aberto, avise pra ele que o projeto dele tá desatualizado, e pergunta se quiser sincronizar o
   nexohub dele e atualizar o projeto pra ficar com a última versão".

   Quem sincroniza é o motor (electron/lib/armazem.js + sincronia.js): a revisão que chega de OUTRA máquina para um
   projeto aberto aqui fica segurada (não entra calada) e vira um aviso. Aqui a tela, só na janela de cima do hub:
     - a cada 10 s diz ao servidor qual projeto está aberto nesta janela (POST /api/sincronia/aberto; a vista aberta numa
       janela à parte também diz o dela);
     - a cada 3 s lê os avisos (GET /api/sincronia/estado). Aviso novo do projeto aberto: um modal (um só; mudanças novas
       atualizam o mesmo) com a foto e o nome de quem mudou, onde ("Você, em <máquina>" quando é o mesmo login), quando, o
       que mudou (o histórico com autor que veio na revisão), o que mudou aqui e ainda não subiu, os conflitos e as
       edições não salvas das vistas; e "Seu projeto está desatualizado. Sincronizar e atualizar para a última versão?";
     - "Sincronizar e atualizar" pede ao motor (POST /api/sincronia/sincronizar), espera o "sincronizado" e recarrega o
       projeto e as vistas abertas dele; com edição não salva, o botão é "Descartar as minhas e atualizar";
     - "Agora não" deixa o selo "desatualizado" (na barra da vista e na árvore de projetos), que reabre o aviso.
   HubSincronia.tagArvore(nome) / abre(nome) / estado() */
(function (root) {
'use strict';
if (typeof window === 'undefined' || typeof document === 'undefined') { if (typeof module !== 'undefined') module.exports = {}; return; }
let topo = true;
try { topo = window.top === window; } catch (_) { topo = false; }
if (!topo) return;                         // dentro do hub (iframe da vista): a janela de cima cuida

const CSS = `
.sy-ov{position:fixed; inset:0; z-index:73; background:var(--scrim, rgba(11,11,13,.6)); display:flex; align-items:center;
  justify-content:center; color:var(--text, #d8d8d8); font:13px/1.45 var(--font, "Segoe UI", system-ui, sans-serif);}
.sy-box{background:var(--surface, #2d2d2d); border:1px solid var(--line, #444); border-radius:var(--r-md, 8px); width:min(600px, 94vw);
  max-height:88vh; display:flex; flex-direction:column; box-shadow:var(--shadow-menu, 0 8px 30px rgba(0,0,0,.5));}
.sy-hd{display:flex; align-items:center; gap:8px; padding:12px 14px 10px; border-bottom:1px solid var(--line, #444);}
.sy-hd h2{font-size:14px; font-weight:600; margin:0;}
.sy-hd svg{width:16px; height:16px; fill:none; stroke:var(--warn, #d6a75a); stroke-width:1.6; flex:none;}
.sy-dim{font-size:11.5px; color:var(--text-3, #999);}
.sy-corpo{overflow:auto; padding:12px 14px; display:flex; flex-direction:column; gap:10px;}
.sy-quem{display:flex; align-items:center; gap:10px; padding:9px 10px; border:1px solid var(--line, #444); border-radius:var(--r-sm, 6px);}
.sy-quem .sy-txt{display:flex; flex-direction:column; min-width:0;}
.sy-quem b{font-weight:600;}
.sy-sec{font-size:10.5px; text-transform:uppercase; letter-spacing:.09em; color:var(--text-3, #999); margin-top:2px;}
.sy-ent{display:grid; grid-template-columns:24px minmax(0,1fr); gap:8px; align-items:start;}
.sy-ent ul{margin:2px 0 0; padding-left:16px; font-size:12.5px; color:var(--text-2, #bbb); line-height:1.5;}
.sy-ent .sy-meta{font-size:11.5px; color:var(--text-3, #999);}
.sy-nota{font-size:12px; padding:7px 9px; border-radius:var(--r-sm, 6px); border:1px solid var(--line, #444); color:var(--text-2, #bbb);}
.sy-nota.alerta{border-color:var(--warn, #d6a75a); color:var(--text, #ddd);}
.sy-nota.perigo{border-color:var(--err, #e0555a); color:var(--text, #ddd);}
.sy-pergunta{font-weight:600; font-size:13px;}
.sy-pe{display:flex; gap:8px; align-items:center; padding:10px 14px; border-top:1px solid var(--line, #444);}
.sy-pe .sy-sp{flex:1;}
.sy-box button{cursor:pointer; padding:5px 12px; border-radius:var(--r-sm, 6px); border:1px solid var(--line, #444);
  background:var(--surface-2, #2a2a2a); color:var(--text, #ddd); font:12px var(--font, sans-serif); white-space:nowrap;}
.sy-box button:hover:not(:disabled){border-color:var(--hi, #888);}
.sy-box button:disabled{opacity:.45; cursor:default;}
.sy-box button.sy-forte{background:var(--hi, #ddd); border-color:var(--hi, #ddd); color:var(--on-hi, #111);}
.sy-box button.sy-perigo{border-color:var(--err, #e0555a); color:var(--err, #e0555a);}
.sy-erro{font-size:12px; color:var(--err, #e0555a); min-height:1em;}
.sy-selo{display:inline-flex; align-items:center; gap:5px; cursor:pointer; font:600 11px var(--font, sans-serif);
  color:var(--warn, #d6a75a); border:1px solid var(--warn, #d6a75a); border-radius:10px; padding:1px 9px 1px 7px;
  background:var(--warn-soft, rgba(214,167,90,.12)); white-space:nowrap; margin-right:8px;}
.sy-selo svg{width:11px; height:11px; fill:none; stroke:currentColor; stroke-width:1.7;}
.sy-selo.sy-arv{padding:1px 4px; margin:0 0 0 5px; line-height:12px; flex:none;}
.sy-selo.sy-arv svg{width:9px; height:9px;}
`;
const ICONE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg>';
function css() {
  if (document.getElementById('sy-css')) return;
  const s = document.createElement('style'); s.id = 'sy-css'; s.textContent = CSS; document.head.append(s);
}
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
function botao(txt, fn, cls, titulo) { const b = el('button', cls || null, txt); b.type = 'button'; if (titulo) b.title = titulo; b.addEventListener('click', fn); return b; }
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
    return j;
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
const espera = ms => new Promise(r => setTimeout(r, ms));

/* ─── qual projeto esta aberto nesta janela ─── */
const JANELA = (() => {
  try { let j = sessionStorage.getItem('nexoeletric.janela'); if (!j) { j = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('nexoeletric.janela', j); } return j; }
  catch (_) { return Math.random().toString(36).slice(2, 10); }
})();
const ehVista = /frame\.html$/i.test(location.pathname);
function projetoAberto() {
  if (ehVista) { try { return new URLSearchParams(location.search).get('p') || ''; } catch (_) { return ''; } }
  try { const p = typeof proj === 'function' ? proj() : null; return p && !p.demo ? p.name : ''; } catch (_) { return ''; }   // eslint-disable-line no-undef
}
let ultimoAberto = null;
async function avisaAberto(forcar) {
  const p = projetoAberto();
  if (!forcar && p === ultimoAberto && Date.now() - avisaAberto.quando < 10000) return;
  ultimoAberto = p; avisaAberto.quando = Date.now();
  await api('/api/sincronia/aberto', { janela: JANELA, projetos: p ? [p] : [] });
}
avisaAberto.quando = 0;
window.addEventListener('pagehide', () => {
  try { navigator.sendBeacon('/api/sincronia/aberto', new Blob([JSON.stringify({ janela: JANELA, projetos: [] })], { type: 'application/json' })); } catch (_) { /* sem beacon */ }
});

/* ─── a equipe do Hub (foto e nome pelo login da revisão) ─── */
let time_ = null;
async function usuarioDoLogin(login) {
  if (!login) return null;
  if (!time_) { const j = await api('/api/sessao/usuarios'); time_ = j.ok ? j.usuarios || [] : []; }
  return time_.find(u => u.login === login || u.login.toLowerCase() === String(login).toLowerCase()) || { id: '', login, nome: login };
}

/* ─── os avisos ─── */
let est = { ligado: false, avisos: {}, sincronizados: {} };
const vistos = (() => { try { return JSON.parse(sessionStorage.getItem('nexoeletric.desatualizado.vistos') || '{}'); } catch (_) { return {}; } })();
const guardaVistos = () => { try { sessionStorage.setItem('nexoeletric.desatualizado.vistos', JSON.stringify(vistos)); } catch (_) { /* sem storage */ } };
let assinatura = '', modal = null, sincronizando = false;
async function le() {
  const j = await api('/api/sincronia/estado');
  if (!j.ok) return;
  est = j;
  const s = JSON.stringify(Object.keys(j.avisos || {}).sort().map(k => [k, j.avisos[k].rev]));
  if (s !== assinatura) {
    assinatura = s;
    if (root.EletricShell && typeof root.EletricShell.render === 'function') root.EletricShell.render();
  }
  const p = projetoAberto();
  const a = p && (j.avisos || {})[p];
  if (a && !sincronizando) {
    if (modal && modal.projeto === p) { if (modal.rev !== a.rev) pinta(modal, a); }
    else if (!modal && Number(vistos[p] || 0) < Number(a.rev)) abre(p);
  }
  if (modal && modal.projeto === p && !a && !sincronizando) { modal.fecha(); }
  poeSelo();
}

/* o selo na barra da vista aberta (a do hub: "VISTA ESQUEMA … Abrir em nova aba") */
function selo(nome, arv) {
  css();
  const s = el('span', 'sy-selo' + (arv ? ' sy-arv' : ''));
  s.innerHTML = ICONE;
  if (arv) s.setAttribute('aria-label', 'desatualizado'); else s.append('Projeto desatualizado — sincronizar');
  s.title = 'chegou uma versão mais nova deste projeto de outra máquina: clique para ver o que mudou e atualizar';
  s.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); abre(nome); });
  return s;
}
function poeSelo() {
  const p = projetoAberto();
  const a = p && (est.avisos || {})[p];
  for (const s of document.querySelectorAll('.sy-selo:not(.sy-arv)')) if (!a || s.dataset.p !== p) s.remove();
  if (!a) return;
  const lugar = document.querySelector('.pane.on .canvas-bar .right');
  if (lugar && !lugar.querySelector('.sy-selo')) { const s = selo(p); s.dataset.p = p; lugar.prepend(s); }
}
function tagArvore(nome) { return (est.avisos || {})[nome] ? selo(nome, true) : null; }

/* as vistas abertas do projeto (iframes do hub) e se alguma tem edição não salva */
function vistasDe(nome) {
  return [...document.querySelectorAll('iframe[data-kind]')].filter(f => {
    try { return new URL(f.src, location.href).searchParams.get('p') === nome; } catch (_) { return false; }
  });
}
function naoSalvas(nome) {
  const out = [];
  for (const f of vistasDe(nome)) {
    try { const w = f.contentWindow; if (w && typeof w.__hubDirty === 'function' && w.__hubDirty()) out.push(f.dataset.kind === 'esquema' ? 'Esquema' : f.dataset.kind === 'gerber' ? 'Gerber' : 'PCB'); }
    catch (_) { /* outra origem */ }
  }
  return out;
}

const TIPO = { esquema: 'Esquema', pcb: 'PCB', regras: 'Regras', anotacoes: 'Sinalizadores', aprovacao: 'Aprovação', revisao: 'Revisões', equipe: 'Equipe' };
function haQuanto(iso) { return root.HubEquipe && root.HubEquipe.haQuanto ? root.HubEquipe.haQuanto(iso) : String(iso || '').replace('T', ' ').slice(0, 16); }
function avatar(u, px) {
  if (root.HubEquipe && root.HubEquipe.avatar) return root.HubEquipe.avatar(u, px);
  return el('span', null, (u && u.nome || '?').slice(0, 2).toUpperCase());
}

function abre(nome) {
  const a = (est.avisos || {})[nome];
  if (!a) { toast('o projeto ' + nome + ' está em dia', 'ok'); return; }
  if (modal && modal.projeto === nome) return;
  if (modal) modal.fecha();
  css();
  const ov = el('div', 'sy-ov'), bx = el('div', 'sy-box');
  bx.setAttribute('role', 'dialog'); bx.setAttribute('aria-modal', 'true');
  const hd = el('div', 'sy-hd'); hd.innerHTML = ICONE; hd.append(el('h2', null, 'Projeto desatualizado'), el('span', 'sy-dim', nome));
  const corpo = el('div', 'sy-corpo'), pe = el('div', 'sy-pe');
  bx.append(hd, corpo, pe); ov.append(bx); document.body.append(ov);
  const esc = e => { if (e.key === 'Escape' && !sincronizando) { e.stopPropagation(); e.preventDefault(); agoraNao(); } };
  document.addEventListener('keydown', esc, true);
  const m = { projeto: nome, rev: null, ov, corpo, pe, erro: el('div', 'sy-erro'),
    fecha() { ov.remove(); document.removeEventListener('keydown', esc, true); if (modal === m) modal = null; } };
  function agoraNao() {
    vistos[nome] = Math.max(Number(vistos[nome] || 0), Number(m.rev || 0)); guardaVistos();
    m.fecha(); poeSelo();
    toast('ok — o selo "desatualizado" fica na barra do projeto; clique nele para atualizar depois', 'info', 5000);
  }
  m.agoraNao = agoraNao;
  modal = m;
  pinta(m, a);
}

async function pinta(m, a) {
  m.rev = a.rev;
  const nome = m.projeto;
  const ses = root.HubEquipe ? await root.HubEquipe.sessao() : { usuario: null };
  const eu = ses && ses.usuario;
  const quem = await usuarioDoLogin(a.autor);
  if (modal !== m) return;
  const c = m.corpo;
  c.replaceChildren();
  // quem, onde, quando
  const q = el('div', 'sy-quem');
  q.append(avatar(quem && quem.id ? quem : (quem || null), 38));
  const tx = el('div', 'sy-txt');
  const mesmo = eu && quem && eu.login === quem.login;
  const nomeQuem = mesmo ? 'Você' : quem ? (quem.nome || quem.login) : 'Alguém';
  tx.append(el('b', null, nomeQuem + (a.maquina ? ', em ' + a.maquina : '') + (mesmo ? ' (outra máquina)' : '')));
  const outros = [...new Set((a.revisoes || []).map(r => r.autor).filter(x => x && x !== a.autor))];
  tx.append(el('span', 'sy-dim', 'mudou o projeto ' + haQuanto(a.quando) + ' · revisão ' + a.rev
    + ((a.revisoes || []).length > 1 ? ' (' + a.revisoes.length + ' revisões desde a sua' + (outros.length ? ', também de ' + outros.join(', ') : '') + ')' : '')));
  q.append(tx);
  c.append(q);
  // o que mudou: o historico com autor que veio na revisao; sem ele, os arquivos
  c.append(el('div', 'sy-sec', 'O que mudou'));
  const ents = a.entradas || [];
  if (ents.length) {
    for (const e of ents.slice(0, 8)) {
      const linha = el('div', 'sy-ent');
      linha.append(avatar(e.usuario || null, 22));
      const d = el('div');
      d.append(el('div', 'sy-meta', [(e.usuario && e.usuario.nome) || 'sem login', TIPO[e.tipo] || e.arquivo || '', e.origem === 'ia' ? 'pela IA' : '', haQuanto(e.ate || e.quando)].filter(Boolean).join(' · ')));
      const ul = el('ul');
      for (const t of (e.mudancas || []).slice(0, 6)) ul.append(el('li', null, t));
      if ((e.mudancas || []).length > 6) ul.append(el('li', null, 'e mais ' + (e.mudancas.length - 6)));
      d.append(ul); linha.append(d); c.append(linha);
    }
    if (ents.length > 8) c.append(el('div', 'sy-dim', 'e mais ' + (ents.length - 8) + ' modificações (Histórico › Modificações, depois de atualizar)'));
  } else {
    c.append(el('div', 'sy-dim', (a.arquivos || []).length ? 'Arquivos: ' + a.arquivos.join(', ') : 'Arquivos de apoio do projeto.'));
  }
  // o que tem aqui
  const ns = naoSalvas(nome);
  if ((a.conflitos || []).length) {
    c.append(el('div', 'sy-nota alerta', 'Você também mudou ' + a.conflitos.join(', ') + ' aqui (salvo, ainda não subiu). Ao sincronizar vale o seu; a versão '
      + (mesmo ? 'da outra máquina' : 'de ' + nomeQuem) + ' fica guardada em .altiumhub\\conflitos-nexobd\\ (a regra de sempre do NexoBD).'));
  } else if ((a.locais || []).length) {
    c.append(el('div', 'sy-nota', 'Você tem mudanças salvas aqui que ainda não subiram (' + a.locais.join(', ') + '): não conflitam e sobem junto, antes de puxar.'));
  }
  if (ns.length) c.append(el('div', 'sy-nota perigo', 'Você tem edições NÃO salvas no ' + ns.join(' e no ') + '. Atualizar descarta essas edições — ou responda "Agora não", salve, e atualize depois pelo selo "desatualizado".'));
  c.append(el('div', 'sy-pergunta', 'Seu projeto está desatualizado. Sincronizar e atualizar para a última versão?'));
  c.append(m.erro);
  m.pe.replaceChildren(el('span', 'sy-sp'),
    botao('Agora não', () => m.agoraNao(), null, 'fica o selo "desatualizado" na barra do projeto e na árvore'),
    ns.length ? botao('Descartar as minhas e atualizar', () => sincroniza(m, true), 'sy-perigo')
      : botao('Sincronizar e atualizar', () => sincroniza(m, false), 'sy-forte'));
  const f = m.pe.querySelector('.sy-forte, .sy-perigo'); if (f) f.focus();
}

async function sincroniza(m, descartar) {
  const nome = m.projeto;
  sincronizando = true;
  for (const b of m.pe.querySelectorAll('button')) b.disabled = true;
  m.erro.textContent = '';
  const st = el('div', 'sy-dim', 'Sincronizando com o Nexo Hub…'); m.corpo.append(st);
  try {
    const j = await api('/api/sincronia/sincronizar', { projeto: nome });
    if (!j.ok) throw new Error(j.error || 'não deu');
    let r = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      await espera(700);
      const e = await api('/api/sincronia/estado');
      if (e.ok && e.sincronizados && e.sincronizados[nome] && e.sincronizados[nome].id === j.id) { r = e.sincronizados[nome]; est = e; break; }
    }
    if (!r) throw new Error('o NexoEletric não respondeu em 1 min (o Nexo Hub está conectado?). O pedido fica: ele atualiza quando voltar.');
    if (r.erro) throw new Error(r.erro);
    delete vistos[nome]; guardaVistos();
    sincronizando = false;
    m.fecha();
    await recarrega(nome, descartar);
    toast(nome + ' atualizado — revisão ' + r.rev + (r.subidos ? ' (as suas ' + r.subidos + ' mudanças subiram junto)' : '')
      + (r.conflitos && r.conflitos.length ? '. Conflito em ' + r.conflitos.join(', ') + ': ficou o seu; o outro está em .altiumhub\\conflitos-nexobd\\' : ''),
      r.conflitos && r.conflitos.length ? 'warn' : 'ok', 7000);
    le();
  } catch (e) {
    sincronizando = false;
    st.remove();
    m.erro.textContent = String(e && e.message || e);
    for (const b of m.pe.querySelectorAll('button')) b.disabled = false;
  }
}

/* o projeto e as vistas abertas dele, de novo do disco. A vista nova volta com o que ela guarda sozinha (folha ativa,
   painel, camadas); o iframe é trocado (e não recarregado) para a edição descartada não abrir o "sair sem salvar?". */
async function recarrega(nome) {
  try {
    const ativo = typeof proj === 'function' && proj() && proj().name === nome;   // eslint-disable-line no-undef
    if (ativo && typeof loadProject === 'function') await loadProject(S.projId);    // eslint-disable-line no-undef
  } catch (_) { /* a casca recarrega sozinha no aviso do disco */ }
  for (const f of vistasDe(nome)) { const n = f.cloneNode(false); f.replaceWith(n); }
  if (ehVista) location.reload();
}

/* ─── liga ─── */
function liga() {
  avisaAberto(true);
  setInterval(() => { if (!document.hidden) avisaAberto(); }, 3000);
  setInterval(() => avisaAberto(true), 10000);
  if (ehVista) return;                       // a vista numa janela à parte só diz que está aberta
  setInterval(() => { if (!document.hidden) le(); }, 3000);
  le();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', liga, { once: true }); else liga();

root.HubSincronia = { tagArvore, abre, estado: () => est, _le: le };
})(typeof window !== 'undefined' ? window : globalThis);
