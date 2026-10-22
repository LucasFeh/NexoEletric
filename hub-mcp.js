/* AltiumPCBMirror - hub-mcp.js
   A IA (MCP) no topo do hub, como no NexoCAD: o indicador "IA" no canto de cima (no app, ao lado do
   chat, na fileira das abas; no navegador, no cabecalho), um aviso a cada comando que a IA executa
   e o historico no painel que abre com o clique.

   O servidor MCP (mcp/eletrichub-mcp.js) e um processo a parte que grava os arquivos direto; ele
   CONTA ao hub o que fez (mcp/lib/relato.js -> POST /api/mcp/ola e /api/mcp/atividade, rotas de
   mcp/rotas_hub.py) e esta pagina pergunta (GET /api/mcp/atividade?desde=N). Tambem atende o alvo
   "hub" da fila do MCP: a IA pede para abrir um projeto numa aba (vista_abrir) e a casca abre
   (window.__hubAbrirProjeto, do hub.html).

   Entra na casca com UMA linha de script e o vao <span id="mcpLanc"></span>; o resto e daqui. */
(function () {
'use strict';
if (typeof window === 'undefined' || window.__hubMcp) return;
window.__hubMcp = true;

const LS_AVISOS = 'eh.mcp.avisos';             // 'todos' | 'escrita' (padrao) | 'nenhum'
const SILENCIOSAS = /^(list_commands|hub_status|hub_modulos|projeto_listar|projeto_resumo|projeto_ler_arquivo|sch_ler|pcb_consultar|pcb_resumo)$/;
const ler = (k, p) => { try { const v = localStorage.getItem(k); return v == null ? p : v; } catch (e) { return p; } };
const grava = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sem storage */ } };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const hora = t => { const d = new Date(t * 1000); return d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' }); };

const CSS = `
.mcp-ind { display:inline-flex; align-items:center; gap:6px; height:26px; padding:0 9px 0 7px; border-radius:13px;
  border:1px solid var(--edge,#2a2a2e); background:var(--surface,#1a1a1d); color:var(--text-2,#a8a8ae);
  font:500 11.5px var(--font,sans-serif); cursor:pointer; white-space:nowrap; max-width:260px; }
.mcp-ind:hover { color:var(--text,#eee); border-color:var(--text-3,#777); }
.mcp-ind svg { width:15px; height:15px; flex:none; }
.mcp-ind .mcp-dot { width:7px; height:7px; border-radius:50%; background:var(--idle,#4a4a50); flex:none; }
.mcp-ind.on .mcp-dot { background:var(--ok,#4bbf7b); }
.mcp-ind.ativo .mcp-dot { background:var(--hi,#ff8a1f); box-shadow:0 0 0 0 var(--hi,#ff8a1f); animation:mcp-pulso 1s ease-out infinite; }
.mcp-ind.on { color:var(--text,#eee); }
.mcp-ind .mcp-txt { overflow:hidden; text-overflow:ellipsis; }
@keyframes mcp-pulso { 0% { box-shadow:0 0 0 0 rgba(255,138,31,.55); } 100% { box-shadow:0 0 0 7px rgba(255,138,31,0); } }
.mcp-painel { position:fixed; z-index:2147482000; width:430px; max-width:calc(100vw - 20px); max-height:calc(100vh - 90px); overflow:auto;
  background:var(--surface,#1a1a1d); color:var(--text,#eee); border:1px solid var(--edge,#2a2a2e); border-radius:8px;
  box-shadow:var(--shadow-menu,0 16px 40px rgba(0,0,0,.6)); font:12.5px/1.45 var(--font,sans-serif); padding:12px 14px; }
.mcp-painel h4 { margin:12px 0 6px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; color:var(--text-3,#888); }
.mcp-painel .mcp-tit { font-weight:600; font-size:13.5px; display:flex; align-items:center; gap:8px; }
.mcp-painel .mcp-ses { display:flex; gap:8px; align-items:center; padding:4px 0; }
.mcp-painel .mcp-ses b { font-weight:600; }
.mcp-painel .mcp-fraco { color:var(--text-3,#888); }
.mcp-painel .mcp-log > div { display:grid; grid-template-columns:62px 1fr; gap:2px 8px; padding:4px 0; border-top:1px solid var(--edge,#2a2a2e); }
.mcp-painel .mcp-log time { color:var(--text-3,#888); font-variant-numeric:tabular-nums; }
.mcp-painel .mcp-log .f { font-family:var(--mono,monospace); font-size:11.5px; }
.mcp-painel .mcp-log .r { grid-column:2; color:var(--text-3,#888); font-size:11.5px; word-break:break-word; }
.mcp-painel .mcp-log .err .f, .mcp-painel .mcp-log .err .r { color:var(--err,#e0555a); }
.mcp-painel .mcp-bts { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
.mcp-painel select { font:inherit; }
.mcp-avisos { position:fixed; right:14px; top:84px; z-index:2147481000; display:flex; flex-direction:column; gap:6px; pointer-events:none; }
.mcp-aviso { pointer-events:auto; display:flex; align-items:center; gap:8px; max-width:380px; padding:7px 11px; border-radius:7px;
  background:var(--surface,#1a1a1d); color:var(--text,#eee); border:1px solid var(--edge,#2a2a2e); box-shadow:var(--shadow-menu,0 8px 24px rgba(0,0,0,.5));
  font:12px var(--font,sans-serif); transition:opacity .35s, transform .35s; }
.mcp-aviso svg { width:14px; height:14px; flex:none; color:var(--hi,#ff8a1f); }
.mcp-aviso.err { border-color:var(--err,#e0555a); } .mcp-aviso.err svg { color:var(--err,#e0555a); }
.mcp-aviso.sai { opacity:0; transform:translateY(-6px); }
.mcp-aviso .p { color:var(--text-3,#888); }
`;
const ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/></svg>';

let btn = null, painel = null, avisos = null;
let seq = -1, parado = false, sessoes = [], log = [], ultimo = null, ativoAte = 0;

function monta() {
  const vao = document.getElementById('mcpLanc');
  if (!vao || btn) return !!btn;
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'mcp-ind';
  btn.innerHTML = ICONE + '<span class="mcp-dot"></span><span class="mcp-txt">IA</span>';
  btn.onclick = e => { e.stopPropagation(); painel ? fechaPainel() : abrePainel(); };
  vao.append(btn);
  avisos = document.createElement('div'); avisos.className = 'mcp-avisos'; document.body.append(avisos);
  document.addEventListener('click', e => { if (painel && !painel.contains(e.target) && e.target !== btn) fechaPainel(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && painel) fechaPainel(); });
  pinta();
  return true;
}

function nomeCurto(c) { return String(c || 'IA').replace(/^claude-ai$/i, 'Claude').replace(/^claude-code$/i, 'Claude Code').split(' ')[0]; }

function pinta() {
  if (!btn) return;
  const agora = Date.now();
  const ativo = agora < ativoAte && ultimo;
  btn.classList.toggle('on', sessoes.length > 0);
  btn.classList.toggle('ativo', !!ativo);
  const txt = btn.querySelector('.mcp-txt');
  if (ativo) txt.textContent = 'IA · ' + ultimo.ferramenta;
  else if (sessoes.length) txt.textContent = 'IA · ' + (sessoes.length > 1 ? sessoes.length + ' conectadas' : nomeCurto(sessoes[0].cliente));
  else txt.textContent = 'IA';
  btn.title = sessoes.length
    ? 'IA conectada ao NexoEletric (MCP): ' + sessoes.map(s => s.cliente).join(', ') + ' — clique para ver o que ela fez'
    : 'Nenhuma IA conectada ao NexoEletric agora — clique para conectar (MCP) e ver o histórico';
  if (painel) desenhaPainel();
}

function abrePainel() {
  painel = document.createElement('div'); painel.className = 'mcp-painel';
  document.body.append(painel);
  desenhaPainel();
  const r = btn.getBoundingClientRect();
  painel.style.top = (r.bottom + 6) + 'px';
  painel.style.left = Math.max(10, Math.min(window.innerWidth - painel.offsetWidth - 10, r.right - painel.offsetWidth)) + 'px';
}
function fechaPainel() { if (painel) painel.remove(); painel = null; }

function desenhaPainel() {
  const app = window.eletricApp;
  const ses = sessoes.length
    ? sessoes.map(s => `<div class="mcp-ses"><span class="mcp-dot" style="width:7px;height:7px;border-radius:50%;background:var(--ok,#4bbf7b)"></span><b>${esc(s.cliente)}</b><span class="mcp-fraco">MCP ${esc(s.versao)} · ${s.ferramentas || '?'} ferramentas · ${s.chamadas || 0} chamada(s) · desde ${hora(s.desde)}</span></div>`).join('')
    : `<div class="mcp-fraco">Nenhuma IA conectada agora. Registre o MCP do NexoEletric no Claude Code ou no Claude Desktop (o Nexo Hub faz sozinho em “Conectar a IA”) e peça, por exemplo: “abre o projeto X e liga o R1 ao C2”.</div>`;
  const nivel = ler(LS_AVISOS, 'escrita');
  const linhas = log.slice(-60).reverse().map(a => `<div class="${a.ok ? '' : 'err'}"><time>${hora(a.t)}</time><span class="f">${esc(a.ferramenta)}${a.projeto ? ' <span class="mcp-fraco">· ' + esc(a.projeto) + '</span>' : ''}</span><span class="r">${esc(a.ok ? (a.resumo || a.titulo || '') : a.erro)}${a.ms ? ' · ' + Math.round(a.ms) + ' ms' : ''}</span></div>`).join('');
  painel.innerHTML = `<div class="mcp-tit">${ICONE.replace('<svg', '<svg width="16" height="16"')} IA no NexoEletric (MCP)</div>
    <h4>Conexão</h4>${ses}
    <div class="mcp-bts">
      ${app && app.menu ? '<button type="button" class="btn btn-secondary" data-a="conectar">Conectar IA (MCP)…</button>' : ''}
      <label class="mcp-fraco">Avisar: <select data-a="nivel">
        <option value="escrita"${nivel === 'escrita' ? ' selected' : ''}>o que a IA muda</option>
        <option value="todos"${nivel === 'todos' ? ' selected' : ''}>todo comando</option>
        <option value="nenhum"${nivel === 'nenhum' ? ' selected' : ''}>nada</option></select></label>
    </div>
    <h4>Atividade recente da IA</h4>
    <div class="mcp-log">${linhas || '<div class="mcp-fraco" style="border:0">Nenhum comando da IA ainda.</div>'}</div>`;
  const c = painel.querySelector('[data-a="conectar"]');
  if (c) c.onclick = () => { app.menu('conectarIA').catch(() => {}); fechaPainel(); };
  const n = painel.querySelector('[data-a="nivel"]');
  if (n) n.onchange = () => grava(LS_AVISOS, n.value);
}

function aviso(a) {
  const nivel = ler(LS_AVISOS, 'escrita');
  if (nivel === 'nenhum' || !avisos) return;
  if (a.ok && (nivel === 'escrita' ? !a.escrita : SILENCIOSAS.test(a.ferramenta))) return;
  const d = document.createElement('div');
  d.className = 'mcp-aviso' + (a.ok ? '' : ' err');
  d.innerHTML = ICONE + `<span><b>IA</b> · ${esc(a.titulo || a.ferramenta)}${a.projeto ? ' <span class="p">· ' + esc(a.projeto) + '</span>' : ''}${a.ok ? '' : ' — ' + esc(a.erro)}</span>`;
  avisos.append(d);
  while (avisos.children.length > 4) avisos.firstChild.remove();
  setTimeout(() => { d.classList.add('sai'); setTimeout(() => d.remove(), 400); }, a.ok ? 3600 : 7000);
}

function pergunta() {
  if (parado) return;
  fetch('/api/mcp/atividade?desde=' + Math.max(0, seq), { cache: 'no-store' })
    .then(r => { if (r.status === 404) { parado = true; if (btn) btn.parentNode.removeChild(btn); return null; } return r.ok ? r.json() : null; })
    .then(j => {
      if (!j) return;
      sessoes = j.sessoes || [];
      const novos = j.itens || [];
      if (seq >= 0) for (const a of novos) aviso(a);       /* na primeira leitura, so o historico */
      log = log.concat(novos).slice(-200);
      if (novos.length) { ultimo = novos[novos.length - 1]; if (seq >= 0) ativoAte = Date.now() + 4000; }
      seq = j.seq;
      pinta();
    })
    .catch(() => {})
    .then(() => { if (!parado) setTimeout(pergunta, document.visibilityState === 'hidden' ? 5000 : 1500); });
}
/* o tempo do "ativo" passa sem precisar de resposta nova */
setInterval(() => { if (btn && btn.classList.contains('ativo') && Date.now() >= ativoAte) pinta(); }, 500);

/* ── o alvo "hub" da fila do MCP: abrir um projeto numa aba (vista_abrir) ── */
async function executa(p) {
  const a = p.args || {};
  if (p.acao === 'abrir') {
    if (typeof window.__hubAbrirProjeto !== 'function') throw new Error('esta página do hub não abre projeto por pedido (hub.html sem __hubAbrirProjeto)');
    const ok = await window.__hubAbrirProjeto(String(a.projeto || ''), a.aba || '');
    if (!ok) throw new Error('projeto "' + a.projeto + '" não está na lista do hub');
    return { aberto: a.projeto, aba: a.aba || '' };
  }
  throw new Error('a página do hub só atende "abrir"');
}
function fila() {
  if (parado) return;
  fetch('/api/mcp/pedidos?alvo=hub&proj=*', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(j => Promise.all(((j && j.pedidos) || []).map(p => Promise.resolve().then(() => executa(p))
      .then(d => ({ ok: true, dados: d }), e => ({ ok: false, erro: String(e && e.message || e) }))
      .then(c => fetch('/api/mcp/resposta/' + encodeURIComponent(p.id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) })))))
    .catch(() => {})
    .then(() => { if (!parado) setTimeout(fila, document.visibilityState === 'hidden' ? 4000 : 1500); });
}

function liga() {
  if (!/^https?:/.test(location.protocol)) return;
  monta();
  pergunta();
  fila();
  /* a casca do app move o vao para a fileira das abas depois: quando ele aparecer, monta */
  if (!btn) { const t = setInterval(() => { if (monta()) clearInterval(t); }, 500); setTimeout(() => clearInterval(t), 15000); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', liga); else liga();
window.HubMcp = { estado: () => ({ sessoes, log: log.slice(-20), seq }) };
})();
