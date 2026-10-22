/* NexoEletric MCP - relato.js: o que a IA esta fazendo, contado ao hub aberto.

   A mesma ideia do NexoCAD (cada comando que nao veio da tela aparece no app, e o "Conectar IA"
   mostra o historico): aqui o MCP e um processo a parte e grava os arquivos direto, entao ele
   CONTA ao hub o que fez, e o hub-mcp.js da pagina mostra no topo (o indicador "IA") e nos avisos:

     POST /api/mcp/ola        {sessao, cliente, versao, raiz, ferramentas}   no initialize e a cada 20 s
     POST /api/mcp/atividade  {sessao, ferramenta, ok, erro, ms, projeto, resumo, escrita}

   Tudo "atira e esquece": sem hub no ar (ou um hub antigo, 404) nada acontece e a ferramenta segue.
   O hub e achado como o resto do MCP (ctx.hubUrl: --hub, o session.json do app, as portas). */
'use strict';
const crypto = require('node:crypto');
const { sondaHub } = require('./util.js');

const PULSO = 20000;
const CACHE_HUB = 30000;

class Relato {
  constructor(ctx, o) {
    this.ctx = ctx;
    this.versao = (o && o.versao) || '';
    this.sessao = crypto.randomUUID();
    this.cliente = null;
    this.ferramentas = 0;
    this.hub = null; this.quando = 0;
    this.timer = null;
    this.desligado = process.env.ELETRICHUB_SEM_RELATO === '1';
  }
  async achaHub() {
    if (this.desligado) return null;
    if (this.hub !== null && Date.now() - this.quando < CACHE_HUB) return this.hub;
    let url = '';
    try {
      const l = await sondaHub(this.ctx, 2500);
      const h = l.find(x => x.ok && x.mesmaRaiz) || l.find(x => x.ok && x.mcp) || null;
      url = h ? h.url : '';
    } catch (_) { url = ''; }
    this.hub = url; this.quando = Date.now();
    return url;
  }
  manda(caminho, corpo) {
    return this.achaHub().then(url => {
      if (!url) return;
      return fetch(url + caminho, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ sessao: this.sessao }, corpo)), signal: AbortSignal.timeout(5000) })
        .then(r => { if (r.status === 404) { this.hub = ''; this.quando = Date.now(); } })
        .catch(() => { this.hub = null; });
    }).catch(() => {});
  }
  ola(cliente, ferramentas) {
    if (cliente) this.cliente = cliente;
    if (ferramentas) this.ferramentas = ferramentas;
    const corpo = () => ({ cliente: this.cliente ? [this.cliente.title || this.cliente.name, this.cliente.version].filter(Boolean).join(' ') : 'IA',
      versao: this.versao, raiz: this.ctx.root, ferramentas: this.ferramentas, pid: process.pid });
    this.manda('/api/mcp/ola', corpo());
    if (!this.timer) { this.timer = setInterval(() => this.manda('/api/mcp/ola', corpo()), PULSO); if (this.timer.unref) this.timer.unref(); }
  }
  /* uma chamada de ferramenta terminada */
  chamada(f, args, r, ms) {
    const ok = !(r && r.isError);
    let erro = '';
    if (!ok) { try { erro = JSON.parse(r.content[0].text).erro || ''; } catch (_) { erro = 'falhou'; } }
    this.manda('/api/mcp/atividade', { ferramenta: f.nome, titulo: f.titulo || '', ok, erro: String(erro).slice(0, 300), ms,
      projeto: args && typeof args.projeto === 'string' ? args.projeto : '', resumo: resumo(args), escrita: !f.leitura });
  }
  fecha() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

/* os argumentos em uma linha curta (sem o projeto, que vai a parte; listas viram contagem) */
function resumo(args) {
  if (!args || typeof args !== 'object') return '';
  const partes = [];
  for (const [k, v] of Object.entries(args)) {
    if (k === 'projeto' || v == null || v === '') continue;
    let t;
    if (Array.isArray(v)) t = v.length + ' ' + (v.length === 1 ? 'item' : 'itens');
    else if (typeof v === 'object') t = '{…}';
    else t = String(v);
    partes.push(k + ' ' + (t.length > 40 ? t.slice(0, 39) + '…' : t));
    if (partes.length >= 4) break;
  }
  return partes.join(' · ');
}

module.exports = { Relato, resumo };
