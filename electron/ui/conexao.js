'use strict';
/* Conectar IA (Ajuda › Conectar IA (MCP)…, o indicador IA no topo do hub e Configurações › Nexo Hub): o MCP do
   NexoEletric e a conexão com o Nexo Hub, no desenho da tela do NexoCAD. Fala com o processo principal só pela ponte
   do preload (window.altiumhub). Ao vivo: pergunta a cada 3 s enquanto a janela está visível. */
const api = window.altiumhub;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hora = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('pt-BR'); };
const quando = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toDateString() === new Date().toDateString() ? 'às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : 'em ' + d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

let toastT = 0;
function toast(msg, tipo = 'ok', ms = 3600) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'on ' + tipo;
  clearTimeout(toastT);
  if (ms) toastT = setTimeout(() => { t.className = ''; }, ms);
}
const erroIpc = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/* uma linha de estado: bolinha (on | off | warn | busy | vazio = cinza), título e detalhe */
function linha(id, classe, titulo, detalhe, dica) {
  const el = $(id);
  el.className = 'net' + (classe ? ' ' + classe : '');
  el.querySelector('.t').textContent = titulo;
  el.querySelector('.d').textContent = detalhe || '';
  el.title = dica || detalhe || '';
}

let ultimo = null;
let registro = null;

/* Só o Nexo Hub, como no NexoCAD (pedido do dono: "não precisa, na interface do nexoeletric, mostrar o DB, nem nada
   além do hub"). Conectado = o Hub respondeu e está com os dados; sem isso o NexoEletric fica vazio (sem projetos e sem
   biblioteca). A última sincronização entra no detalhe da linha; erro dela, no aviso. */
function pintaHub(e) {
  const h = e.hub;
  const a = e.armazem;
  const s = e.nexoSync;
  if (h.conectado) {
    const sinc = !a.ligado ? (a.dev ? 'pasta de desenvolvedor (git)' : '')
      : a.fase === 'sincronizando' || s.fase === 'sincronizando' ? 'sincronizando…'
      : a.fase === 'em dia' ? `sincronizado ${quando(a.ultimo)}`
      : a.fase === 'erro' ? 'a última sincronização falhou' : '';
    const falhou = (a.ligado && a.fase === 'erro') || s.fase === 'erro';
    linha('eHub', a.fase === 'sincronizando' ? 'busy' : falhou ? 'warn' : 'on', 'Nexo Hub conectado',
      [h.url, h.versao && 'versão ' + h.versao, sinc].filter(Boolean).join(' · '),
      `Nexo Hub em ${h.url}${h.maquina ? ' (' + h.maquina + ')' : ''}${h.versao ? '\nVersão ' + h.versao : ''}${h.revisao != null ? '\nRevisão ' + h.revisao : ''}`);
  } else {
    linha('eHub', 'off', 'Nexo Hub desconectado', h.erro || h.url);
  }

  $('hubDir').textContent = `${h.url}  ·  ${h.origem === 'padrão' ? 'endereço padrão (esta máquina)' : h.origem}`;
  $('hubDir').title = 'O mesmo endereço para o NexoCAD e os outros programas da rede\n' + (h.arquivo || '');

  const av = $('hubAviso');
  if (!h.conectado) {
    av.className = 'aviso err';
    av.innerHTML = '<b>Sem conexão com o Nexo Hub:</b> os projetos e a biblioteca só aparecem com ele conectado. Abra o aplicativo <b>Nexo Hub</b> (ícone na bandeja) ou confira a conexão, e clique em <b>Tentar de novo</b>.';
  } else if ((a.ligado && a.fase === 'erro') || s.fase === 'erro') {
    av.className = 'aviso warn';
    av.innerHTML = 'A última sincronização com o Nexo Hub falhou. Clique em <b>Tentar de novo</b>; o detalhe fica no <a id="aLogs">log do app</a>.';
    const l = $('aLogs'); if (l) l.onclick = () => api.chamar('conexao:pastaLogs');
  } else {
    av.className = 'aviso'; av.textContent = '';
  }
  $('bAbrirHub').hidden = h.conectado || h.respondeu;
}

function pintaLocal(e) {
  const st = $('stLocal');
  const ses = e.mcp.sessoes || [];
  const nomes = ses.map((s) => s.cliente).filter(Boolean);
  st.classList.toggle('on', Boolean(e.hubLocal));
  st.querySelector('span').textContent = e.hubLocal
    ? `Hub local: ativo em ${e.hubLocal.replace(/^https?:\/\//, '')} · ${ses.length ? plural(ses.length, 'IA conectada', 'IAs conectadas') + (nomes.length ? ' (' + nomes.join(', ') + ')' : '') : 'nenhuma IA conectada agora'}`
    : 'Hub local: parado — as ferramentas de arquivo do MCP funcionam mesmo assim';
}

function pintaRegistro(r, instalado) {
  if (!r) return;
  const c = r.claudeCode;
  if (c.estado === 'em dia') linha('rCode', 'on', 'Claude Code', 'registrado (escopo do usuário)', c.arquivo);
  else if (c.estado === 'diferente') linha('rCode', 'warn', 'Claude Code', 'registrado com outro caminho: ' + ((c.atual && c.atual.command) || '?'), c.arquivo);
  else linha('rCode', '', 'Claude Code', 'não registrado', c.arquivo);
  const d = r.claudeDesktop || [];
  if (!d.length) linha('rDesk', '', 'Claude Desktop', 'não instalado nesta conta do Windows');
  else if (d.every((x) => x.estado === 'em dia')) linha('rDesk', 'on', 'Claude Desktop', 'registrado', d.map((x) => x.arquivo).join('\n'));
  else if (d.some((x) => x.estado === 'diferente')) linha('rDesk', 'warn', 'Claude Desktop', 'registrado com outro caminho', d.map((x) => x.arquivo).join('\n'));
  else linha('rDesk', '', 'Claude Desktop', 'não registrado', d.map((x) => x.arquivo).join('\n'));
  const tudo = c.estado === 'em dia' && d.every((x) => x.estado === 'em dia');
  $('bRegistrar').textContent = tudo ? 'Registrar de novo' : 'Registrar no Claude Code e no Claude Desktop';
  $('bRegistrar').classList.toggle('primario', !tudo);
  $('regNota').textContent = instalado
    ? 'O Nexo Hub também registra sozinho o MCP de todos os programas da atmosfera (bandeja do Nexo Hub › Conectar a IA). Depois de registrar, reinicie o cliente de IA.'
    : 'Desenvolvimento: o registro aponta para o Electron e o mcp/ deste repositório. O Nexo Hub volta a apontar para o NexoEletric instalado quando sincronizar os MCPs.';
}

function pintaAtividade(e) {
  const el = $('aiLog');
  const itens = (e.mcp.atividade || []).slice(-40).reverse();
  if (!e.hubLocal) { el.innerHTML = '<div class="vazio">O hub local está parado: a atividade aparece quando ele subir.</div>'; return; }
  if (!e.mcp.rotaAtividade) { el.innerHTML = '<div class="vazio">Este hub não mostra a atividade da IA (rotas do MCP ausentes na pasta de trabalho).</div>'; return; }
  el.innerHTML = itens.length
    ? itens.map((a) => `<div class="${a.ok ? '' : 'err'}"><time>${esc(new Date(a.t * 1000).toLocaleTimeString('pt-BR'))}</time><b title="${esc(a.ferramenta)}">${esc(a.ferramenta)}</b><span title="${esc(a.ok ? (a.resumo || a.titulo || '') : a.erro)}">${esc(a.ok ? [a.projeto, a.resumo || a.titulo].filter(Boolean).join(' · ') : a.erro)}</span></div>`).join('')
    : '<div class="vazio">Nenhum comando de IA ainda.</div>';
}

function pinta(e) {
  ultimo = e;
  pintaLocal(e);
  pintaHub(e);
  if (e.mcp.registro) registro = e.mcp.registro;
  pintaRegistro(registro, e.mcp.instalado);
  if ($('cCode').textContent !== e.mcp.claudeCode) $('cCode').textContent = e.mcp.claudeCode;
  if ($('cJson').textContent !== e.mcp.json) $('cJson').textContent = e.mcp.json;
  pintaAtividade(e);
}

let voltas = 0, timer = 0, lendo = false;
async function atualiza(comRegistro) {
  if (lendo) return;
  lendo = true;
  try {
    pinta(await api.chamar('conexao:estado', Boolean(comRegistro) || voltas % 5 === 0));
    voltas++;
  } catch (e) {
    toast('não consegui ler o estado: ' + erroIpc(e), 'err', 0);
  } finally {
    lendo = false;
  }
}
function agenda(ms = 3000) {
  clearTimeout(timer);
  timer = setTimeout(async () => { if (!document.hidden) await atualiza(); agenda(); }, ms);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { atualiza(); agenda(); } });

// ── ações ──
$('bFechar').onclick = () => window.close();
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (!$('fConexao').hidden) { $('fConexao').hidden = true; return; }
  window.close();
});

$('bTentar').onclick = async () => {
  const b = $('bTentar');
  b.disabled = true;
  const rot = b.lastChild.textContent;
  b.lastChild.textContent = 'Tentando…';
  linha('eHub', 'busy', 'Nexo Hub', 'sincronizando…');
  try {
    const r = await api.chamar('conexao:tentar');
    const p = r.projetos;
    if (p && !p.ok) toast('Nexo Hub: ' + p.erro, 'err', 7000);
    else if (r.nexoSync && !r.nexoSync.ok) toast('Nexo Hub: ' + (r.nexoSync.erro || 'não sincronizou'), 'warn', 7000);
    else if (p) toast(`Em dia: ${plural(p.resumo.projetos, 'projeto', 'projetos')} · ${plural(p.resumo.baixados, 'arquivo baixado', 'arquivos baixados')}, ${plural(p.resumo.subidos, 'subido', 'subidos')}`, 'ok');
    else toast('Sincronizado com o Nexo Hub', 'ok');
  } catch (e) {
    toast(erroIpc(e), 'err', 0);
  } finally {
    b.disabled = false;
    b.lastChild.textContent = rot;
    atualiza();
  }
};

$('bConexao').onclick = () => {
  const f = $('fConexao');
  f.hidden = !f.hidden;
  if (f.hidden) return;
  $('cUrl').value = (ultimo && ultimo.hub.url) || 'http://127.0.0.1:47800';
  $('cToken').value = '';
  $('cToken').placeholder = ultimo && ultimo.hub.temToken ? 'há um token gravado (digite outro para trocar)' : '';
  $('cUrl').focus();
  $('cUrl').select();
};
$('cCancelar').onclick = () => { $('fConexao').hidden = true; };
$('fConexao').onsubmit = async (ev) => {
  ev.preventDefault();
  const b = $('cConectar');
  b.disabled = true;
  try {
    const r = await api.chamar('conexao:gravar', { url: $('cUrl').value.trim(), token: $('cToken').value });
    toast(r.conectado ? `Conectado a ${r.url}` : `Gravado, mas ${r.url} não respondeu`, r.conectado ? 'ok' : 'err', r.conectado ? 3600 : 7000);
    $('fConexao').hidden = true;
    atualiza();
  } catch (e) {
    toast(erroIpc(e), 'err', 0);
  } finally {
    b.disabled = false;
  }
};

$('bAbrirHub').onclick = async () => {
  try {
    await api.chamar('conexao:abrirHub');
    toast('Abrindo o Nexo Hub…', 'ok');
    // a ponte leva uns segundos: pergunta mais vezes logo depois
    for (const ms of [2000, 4000, 7000, 11000]) setTimeout(() => atualiza(), ms);
  } catch (e) {
    toast(erroIpc(e), 'err', 0);
  }
};

$('bRegistrar').onclick = async () => {
  const b = $('bRegistrar');
  b.disabled = true;
  try {
    const r = await api.chamar('conexao:registrar');
    const desk = r.claudeDesktop.length ? r.claudeDesktop.map((d) => d.estado).join(', ') : 'não instalado';
    toast(`Claude Code: ${r.claudeCode.estado} · Claude Desktop: ${desk}`, 'ok', 6000);
    await atualiza(true);
  } catch (e) {
    toast('Não consegui registrar: ' + erroIpc(e), 'err', 0);
  } finally {
    b.disabled = false;
  }
};

document.querySelectorAll('[data-copiar]').forEach((b) => {
  b.onclick = async () => {
    try { await api.chamar('conexao:copiar', $(b.dataset.copiar).textContent); toast('Copiado', 'ok', 1600); } catch (e) { toast(erroIpc(e), 'err'); }
  };
});

atualiza(true).then(() => agenda());
