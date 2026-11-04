/* NexoEletric - hub-mcpskills.js: o menu "MCP" no canto de cima à direita, com as skills da casa.

   Pedido do dono (2026-11-04): "dentro do NexoEletric eu quero poder ver todas as skills em 'MCP' no canto superior
   direito". As skills são os processos que a IA segue (mcp/skills/*.md: projeto novo, componente novo, enviar à JLC,
   boas práticas de PCB…). Aqui a pessoa vê a lista e lê cada uma, sem a IA. Só leitura.

   Rotas (mcp/rotas_hub.py): GET /api/mcp/skills -> {skills:[{nome, titulo, descricao, arquivo}]},
   GET /api/mcp/skills/<nome> -> {skill:{…, corpo}}. Entra na casca com uma linha de script e o vão
   <span id="skillsLanc"></span> (o hub-shell.js o leva para o canto da fileira das abas, ao lado do "IA"). */
(function () {
'use strict';
if (typeof window === 'undefined' || window.__hubMcpSkills) return;
window.__hubMcpSkills = true;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CSS = `
.sk-bt { display:inline-flex; align-items:center; gap:6px; height:26px; padding:0 9px 0 7px; border-radius:13px; margin-right:6px;
  border:1px solid var(--edge,#2a2a2e); background:var(--surface,#1a1a1d); color:var(--text-2,#a8a8ae);
  font:500 11.5px var(--font,sans-serif); cursor:pointer; white-space:nowrap; }
.sk-bt:hover, .sk-bt[aria-expanded="true"] { color:var(--text,#eee); border-color:var(--text-3,#777); }
.sk-bt svg { width:15px; height:15px; flex:none; }
.sk-painel { position:fixed; z-index:2147482000; width:440px; max-width:calc(100vw - 20px); max-height:calc(100vh - 90px); overflow:auto;
  background:var(--surface,#1a1a1d); color:var(--text,#eee); border:1px solid var(--edge,#2a2a2e); border-radius:8px;
  box-shadow:var(--shadow-menu,0 16px 40px rgba(0,0,0,.6)); font:12.5px/1.45 var(--font,sans-serif); padding:8px; }
.sk-painel .sk-cab { display:flex; align-items:center; gap:8px; padding:4px 6px 8px; font-weight:600; font-size:13px; }
.sk-painel .sk-cab span { font-weight:400; color:var(--text-3,#888); font-size:11.5px; }
.sk-item { display:block; width:100%; text-align:left; padding:7px 8px; border:0; border-radius:6px; background:transparent;
  color:var(--text,#eee); cursor:pointer; font:inherit; }
.sk-item:hover, .sk-item:focus-visible { background:rgba(var(--tint,255,255,255),.07); outline:none; }
.sk-item b { display:block; font-weight:600; font-size:12.5px; }
.sk-item small { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; color:var(--text-3,#888); font-size:11.5px; }
.sk-item code { font:11px var(--mono,monospace); color:var(--text-2,#aaa); }
.sk-vazio { padding:10px; color:var(--text-3,#888); }
.sk-fundo { position:fixed; inset:0; z-index:2147482100; background:var(--scrim,rgba(0,0,0,.55)); display:flex; align-items:center; justify-content:center; padding:20px; }
.sk-modal { width:min(820px,100%); max-height:100%; display:flex; flex-direction:column; background:var(--bg,#0f0f11); color:var(--text,#eee);
  border:1px solid var(--edge,#2a2a2e); border-radius:10px; box-shadow:var(--shadow-menu,0 16px 40px rgba(0,0,0,.6)); font:13px/1.55 var(--font,sans-serif); }
.sk-modal header { display:flex; align-items:center; gap:10px; padding:12px 16px; border-bottom:1px solid var(--edge,#2a2a2e); }
.sk-modal header h3 { flex:1; margin:0; font-size:14.5px; }
.sk-modal header code { font:11.5px var(--mono,monospace); color:var(--text-3,#888); }
.sk-modal header button { width:28px; height:28px; border-radius:6px; border:1px solid transparent; background:transparent; color:var(--text-2,#aaa); cursor:pointer; font-size:16px; }
.sk-modal header button:hover { border-color:var(--edge,#2a2a2e); color:var(--text,#eee); }
.sk-corpo { overflow:auto; padding:6px 22px 20px; }
.sk-corpo h1, .sk-corpo h2, .sk-corpo h3 { margin:16px 0 6px; line-height:1.3; }
.sk-corpo h1 { font-size:17px; } .sk-corpo h2 { font-size:14.5px; } .sk-corpo h3 { font-size:13px; }
.sk-corpo p { margin:6px 0; }
.sk-corpo ul, .sk-corpo ol { margin:4px 0 6px; padding-left:22px; }
.sk-corpo li { margin:2px 0; }
.sk-corpo code { font:12px var(--mono,monospace); background:rgba(var(--tint,255,255,255),.07); padding:1px 4px; border-radius:4px; }
.sk-corpo pre { background:rgba(var(--tint,255,255,255),.05); padding:8px 10px; border-radius:6px; overflow:auto; }
.sk-corpo pre code { background:transparent; padding:0; }
.sk-corpo .sk-desc { color:var(--text-2,#aaa); border-left:2px solid var(--hi,#ff8a1f); padding:2px 0 2px 10px; margin:12px 0 4px; }
`;
const ICONE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M3 2.5h7.5l2.5 2.5v8.5H3z"/><path d="M10.5 2.5V5H13"/><path d="M5.5 7.5h5M5.5 10h5M5.5 12.5h3"/></svg>';

/* markdown das skills -> HTML (o texto é escapado antes: nada do arquivo vira tag) */
function inline(s) {
  return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
}
function markdown(md) {
  const L = String(md || '').replace(/\r/g, '').split('\n');
  const out = [];
  let lista = null, pre = null, par = [];
  const fechaPar = () => { if (par.length) { out.push('<p>' + inline(par.join(' ')) + '</p>'); par = []; } };
  const fechaLista = () => { while (lista && lista.length) out.push('</' + lista.pop().t + '>'); lista = null; };
  for (const l of L) {
    if (pre) { if (/^```/.test(l)) { out.push('<pre><code>' + esc(pre.join('\n')) + '</code></pre>'); pre = null; } else pre.push(l); continue; }
    if (/^```/.test(l)) { fechaPar(); fechaLista(); pre = []; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) { fechaPar(); fechaLista(); out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); continue; }
    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(l);
    if (li) {
      fechaPar();
      const nivel = Math.floor(li[1].length / 2), t = /\d/.test(li[2]) ? 'ol' : 'ul';
      lista = lista || [];
      while (lista.length > nivel + 1) out.push('</' + lista.pop().t + '>');
      if (lista.length < nivel + 1) { out.push('<' + t + '>'); lista.push({ t }); }
      out.push('<li>' + inline(li[3]) + '</li>');
      continue;
    }
    if (!l.trim()) { fechaPar(); fechaLista(); continue; }
    if (lista && /^\s{2,}/.test(l)) { out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ' ' + inline(l.trim()) + '</li>'); continue; }
    fechaLista();
    par.push(l.trim());
  }
  fechaPar(); fechaLista();
  if (pre) out.push('<pre><code>' + esc(pre.join('\n')) + '</code></pre>');
  return out.join('\n');
}

let btn = null, painel = null;
async function pega(url) {
  try { const r = await fetch(url, { cache: 'no-store' }); return await r.json(); } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
function fechaPainel() { if (painel) { painel.remove(); painel = null; } if (btn) btn.setAttribute('aria-expanded', 'false'); }
async function abrePainel() {
  fechaPainel();
  painel = document.createElement('div');
  painel.className = 'sk-painel';
  painel.setAttribute('role', 'menu');
  const r = btn.getBoundingClientRect();
  painel.style.top = Math.round(r.bottom + 6) + 'px';
  painel.style.right = Math.max(10, Math.round(innerWidth - r.right)) + 'px';
  painel.innerHTML = '<div class="sk-cab">Skills do MCP <span>os processos que a IA segue</span></div><div class="sk-vazio">carregando…</div>';
  document.body.append(painel);
  btn.setAttribute('aria-expanded', 'true');
  const j = await pega('/api/mcp/skills');
  if (!painel) return;
  const lista = (j && j.ok && j.skills) || [];
  const corpo = document.createElement('div');
  if (!lista.length) corpo.innerHTML = '<div class="sk-vazio">' + esc(j && j.ok ? 'nenhuma skill em mcp/skills' : 'não consegui ler as skills: ' + ((j && j.error) || 'sem servidor')) + '</div>';
  for (const s of lista) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sk-item'; b.setAttribute('role', 'menuitem');
    b.innerHTML = '<b>' + esc(s.titulo) + '</b><small>' + esc(s.descricao) + '</small>';
    b.title = s.nome;
    b.onclick = () => { fechaPainel(); abreSkill(s.nome); };
    corpo.append(b);
  }
  painel.querySelector('.sk-vazio').replaceWith(corpo);
  const pri = painel.querySelector('.sk-item'); if (pri) pri.focus();
}
async function abreSkill(nome) {
  const j = await pega('/api/mcp/skills/' + encodeURIComponent(nome));
  const s = j && j.ok && j.skill;
  const fundo = document.createElement('div');
  fundo.className = 'sk-fundo';
  const m = document.createElement('div');
  m.className = 'sk-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
  m.innerHTML = '<header><h3></h3><code></code><button type="button" title="Fechar (Esc)">✕</button></header><div class="sk-corpo"></div>';
  m.querySelector('h3').textContent = s ? s.titulo : nome;
  m.querySelector('code').textContent = s ? 'mcp/skills/' + s.arquivo : '';
  m.querySelector('.sk-corpo').innerHTML = s ? '<div class="sk-desc">' + inline(s.descricao) + '</div>' + markdown(s.corpo)
    : '<p>' + esc('não consegui abrir a skill: ' + ((j && j.error) || 'sem servidor')) + '</p>';
  fundo.append(m);
  document.body.append(fundo);
  const fecha = () => { fundo.remove(); document.removeEventListener('keydown', tecla, true); if (btn) btn.focus(); };
  const tecla = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecha(); } };
  document.addEventListener('keydown', tecla, true);
  m.querySelector('header button').onclick = fecha;
  m.querySelector('header button').focus();
}

function monta() {
  const vao = document.getElementById('skillsLanc');
  if (!vao || btn) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'sk-bt';
  btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
  btn.title = 'As skills do MCP: os processos da casa que a IA segue (clique para ver e ler)';
  btn.innerHTML = ICONE + '<span>MCP</span>';
  btn.onclick = e => { e.stopPropagation(); painel ? fechaPainel() : abrePainel(); };
  vao.append(btn);
  document.addEventListener('click', e => { if (painel && !painel.contains(e.target) && e.target !== btn) fechaPainel(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && painel) fechaPainel(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', monta); else monta();
window.HubMcpSkills = { markdown };
})();
