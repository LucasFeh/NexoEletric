/* NexoEletric - nexohub.js: o cliente do Nexo Hub em Node (CommonJS, sem dependencia).

   O Nexo Hub e o banco da rede "Nexo Hub" (contrato: ..\nexohub\docs\CONTRATO.md). Nenhum programa
   abre o banco direto: tudo passa pela API HTTP v1. Este arquivo e o pedaco do NexoEletric que fala
   com ela; o usam o sincronizador (lib/nexohub-sync.js, rodado pelo app desktop e pelo MCP) e o
   grupo "nexo" do MCP.

   Conexao (contrato §1): NEXOHUB_URL/NEXOHUB_TOKEN > C:\Users\Public\NexoHub\conexao.json
   ({url, token}) > http://127.0.0.1:47800. NEXOHUB_CONEXAO troca o caminho do arquivo (testes).

     const NH = require('./nexohub.js');
     const c = NH.cliente();                     // ou new NH.NexoHub({url, token})
     await c.saude(); await c.resolver('nexoeletric-modelo', ['3d-hub/ab.step'])
     NH.paraIndice(itens, categorias)            // itens do Nexo Hub -> o indice que o hub-nexo.js le */
'use strict';
const fs = require('node:fs');

const CONEXAO = 'C:\\Users\\Public\\NexoHub\\conexao.json';
const PADRAO = 'http://127.0.0.1:47800';
const APP = 'nexoeletric';
const SIS_MODELO = 'nexoeletric-modelo';
const SIS_PLACA = 'nexoeletric-placa';
const CAT_MODELOS = 'eletronicos/modelos-3d';
const CAT_PLACAS = 'placas';

class ErroNexoHub extends Error {
  constructor(msg, status, codigo) { super(msg); this.status = status || 0; this.codigo = codigo || ''; }
}

function conexao() {
  let url = '', token = '';
  try {
    const j = JSON.parse(fs.readFileSync(process.env.NEXOHUB_CONEXAO || CONEXAO, 'utf8').replace(/^\uFEFF/, ''));
    if (j && typeof j.url === 'string') url = j.url.trim();
    if (j && typeof j.token === 'string') token = j.token.trim();
  } catch (_) { /* sem o arquivo: o padrao */ }
  if (process.env.NEXOHUB_URL) url = process.env.NEXOHUB_URL.trim();
  if (process.env.NEXOHUB_TOKEN != null && process.env.NEXOHUB_TOKEN !== '') token = process.env.NEXOHUB_TOKEN.trim();
  return { url: (url || PADRAO).replace(/\/+$/, ''), token };
}

class NexoHub {
  constructor(o) {
    const c = Object.assign(conexao(), o || {});
    this.url = String(c.url || PADRAO).replace(/\/+$/, '');
    this.token = c.token || '';
    this.app = c.app || APP;
    this.timeout = c.timeout || 30000;
  }
  cab(extra) {
    const h = Object.assign({}, extra || {});
    if (this.token) h.Authorization = 'Bearer ' + this.token;
    if (this.app) h['X-App'] = this.app;
    return h;
  }
  async pede(metodo, caminho, corpo, o) {
    o = o || {};
    const op = { method: metodo, headers: this.cab(o.headers), signal: o.signal || AbortSignal.timeout(o.timeout || this.timeout) };
    if (corpo !== undefined) {
      if (Buffer.isBuffer(corpo) || corpo instanceof Uint8Array) { op.body = corpo; op.headers['Content-Type'] = op.headers['Content-Type'] || 'application/octet-stream'; }
      else { op.body = JSON.stringify(corpo); op.headers['Content-Type'] = 'application/json'; }
    }
    let r;
    try { r = await fetch(this.url + caminho, op); }
    catch (e) { throw new ErroNexoHub(`o Nexo Hub (${this.url}) não respondeu: ${e && e.cause && e.cause.code || e && e.message || e}`, 0, 'fora_do_ar'); }
    if (o.cru) return r;
    const txt = await r.text();
    let j = null;
    try { j = txt ? JSON.parse(txt) : {}; } catch (_) { j = null; }
    if (!r.ok) throw new ErroNexoHub(`Nexo Hub: ${(j && (j.erro || j.error)) || ('HTTP ' + r.status)} (${metodo} ${caminho.replace(/\?.*$/, '')})`, r.status, j && j.codigo);
    if (j === null) throw new ErroNexoHub(`Nexo Hub: resposta que não é JSON em ${caminho}`, r.status);
    return j;
  }
  saude(o) { return this.pede('GET', '/api/v1/saude', undefined, Object.assign({ timeout: 3000 }, o)); }
  async categorias() { const j = await this.pede('GET', '/api/v1/categorias'); return Array.isArray(j) ? j : (j.categorias || []); }
  itens(q) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q || {})) if (v != null && v !== '') p.set(k, String(v));
    return this.pede('GET', '/api/v1/itens' + (p.toString() ? '?' + p : ''));
  }
  /* todas as paginas */
  async todos(q) {
    const out = [];
    let revisao = 0;
    for (let pagina = 1; pagina < 1000; pagina++) {
      const j = await this.itens(Object.assign({}, q || {}, { limite: 200, pagina }));
      const L = j.itens || [];
      revisao = j.revisao || revisao;
      out.push(...L);
      if (!L.length || out.length >= (j.total || 0) || L.length < 200) break;
    }
    return { itens: out, revisao };
  }
  async item(id) { const j = await this.pede('GET', '/api/v1/itens/' + encodeURIComponent(id)); return j.item || j; }
  async criaItem(d) {
    const j = await this.pede('POST', '/api/v1/itens', Object.assign({ app: this.app }, d));
    const it = j.item || j;
    if (j.existente != null && it.existente == null) it.existente = j.existente;
    return it;
  }
  async alteraItem(id, d) { const j = await this.pede('PATCH', '/api/v1/itens/' + encodeURIComponent(id), d); return j.item || j; }
  async sobeBlob(dados, nome) {
    const h = { 'Content-Type': 'application/octet-stream' };
    if (nome) h['X-Nome'] = encodeURIComponent(nome);
    return this.pede('POST', '/api/v1/blobs', Buffer.from(dados), { headers: h, timeout: 600000 });
  }
  async temBlob(sha) {
    const r = await this.pede('HEAD', '/api/v1/blobs/' + sha, undefined, { cru: true });
    return r.ok;
  }
  async novaRevisao(id, d) {
    return this.pede('POST', '/api/v1/itens/' + encodeURIComponent(id) + '/revisoes', Object.assign({ app: this.app }, d));
  }
  /* {chave: {id, rev, step_sha}}; as que nao existem ficam de fora. Em lotes de 500. */
  async resolver(sistema, chaves) {
    const out = {};
    const L = [...new Set((chaves || []).filter(Boolean).map(String))];
    for (let i = 0; i < L.length; i += 500) {
      const j = await this.pede('POST', '/api/v1/chaves/resolver', { sistema, chaves: L.slice(i, i + 500) });
      const m = (j && typeof j.resultado === 'object' && j.resultado) || (j && typeof j.chaves === 'object' && !Array.isArray(j.chaves) && j.chaves) || j || {};
      for (const [k, v] of Object.entries(m)) if (v && typeof v === 'object' && v.id) out[k] = v;
    }
    return out;
  }
  async poeChave(sistema, chave, item_id) { return this.pede('PUT', '/api/v1/chaves', { sistema, chave, item_id }); }
  /* o vinculo que ja existe nao e erro */
  async vincula(d) {
    try { return await this.pede('POST', '/api/v1/vinculos', d); }
    catch (e) { if (e.status === 409) return { existente: true }; throw e; }
  }
  eventos(desde) { return this.pede('GET', '/api/v1/eventos?formato=json&desde=' + (desde || 0)); }
  ping(d) { return this.pede('POST', '/api/v1/clientes/ping', Object.assign({ app: this.app }, d), { timeout: 3000 }).catch(() => null); }
  urlArquivo(id, papel, rev) { return `${this.url}/api/v1/itens/${encodeURIComponent(id)}/arquivo/${encodeURIComponent(papel)}${rev ? '?rev=' + rev : ''}`; }
  async baixa(id, papel, rev) {
    const r = await this.pede('GET', `/api/v1/itens/${encodeURIComponent(id)}/arquivo/${encodeURIComponent(papel)}${rev ? '?rev=' + rev : ''}`, undefined, { cru: true, timeout: 600000 });
    if (!r.ok) throw new ErroNexoHub(`Nexo Hub: o item ${id} não tem o arquivo "${papel}" (HTTP ${r.status})`, r.status);
    return Buffer.from(await r.arrayBuffer());
  }
}

function cliente(o) { return new NexoHub(o); }

/* ---------- itens do Nexo Hub -> o indice do hub-nexo.js (contrato do NexoEletric) ----------
   O hub desenha o 3D pelo indice que ele sempre leu (docs/INTEGRACAO-NEXOCAD.md §1):
     substitui  = as chaves nexoeletric-modelo do item, SO quando rev > 1 (foi editado no NexoCAD;
                  a revisao 1 e a copia do proprio STEP do hub e nao troca nada);
     eletronico.footprints = atributos.footprints, SO de item `componente` (o corpo que veste o
                  footprint inteiro, na identidade dele). Um `modelo3d` sincronizado guarda os
                  footprints que o usam em `modelo.footprints`, so informativo. */
const semAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function nomesCategorias(categorias) {
  const porId = new Map();
  const anda = L => { for (const c of (L || [])) { if (!c || !c.id) continue; porId.set(c.id, c); anda(c.filhos || c.subcategorias || c.filhas); } };
  anda(categorias);
  return porId;
}
function paraItem(it, cats) {
  const porId = cats instanceof Map ? cats : nomesCategorias(cats);
  const catId = String(it.categoria || it.categoria_id || 'outros');
  const raizId = catId.split('/')[0];
  const raiz = porId.get(raizId), sub = catId.includes('/') ? porId.get(catId) : null;
  const at = it.atributos && typeof it.atributos === 'object' ? it.atributos : {};
  const ar = it.arquivos && typeof it.arquivos === 'object' ? it.arquivos : {};
  const rev = Number(it.rev != null ? it.rev : it.rev_atual) || 0;
  const chaves = Array.isArray(it.chaves) ? it.chaves : [];
  const modelo = chaves.filter(c => c && c.sistema === SIS_MODELO).map(c => String(c.chave));
  const arquivos = {};
  for (const p of ['step', 'nexo', 'thumb', 'origem', 'placa']) if (ar[p]) arquivos[p] = p;
  const o = {
    id: it.id, nome: it.nome || it.id, tipo: it.tipo || '', categoria: raiz ? raiz.nome : raizId, categoria_id: catId,
    subcategoria: sub ? sub.nome : '', descricao: it.descricao || '', tags: Array.isArray(it.tags) ? it.tags : [],
    rev, atualizado: it.atualizado_em || '', arquivos, bbox: it.bbox || null,
    substitui: rev > 1 ? modelo : [], chaves: modelo,
  };
  if (it.tipo === 'componente') o.eletronico = { footprints: Array.isArray(at.footprints) ? at.footprints.map(String) : [], mpn: at.mpn || '', fabricante: at.fabricante || '', encapsulamento: at.encapsulamento || '' };
  else if (Array.isArray(at.footprints)) o.modelo = { footprints: at.footprints.map(String), origem: at.origem || '' };
  return o;
}
function paraIndice(itens, categorias, revisao) {
  const cats = nomesCategorias(categorias);
  const raizes = [...cats.values()].filter(c => !c.pai_id && !String(c.id).includes('/')).sort((a, b) => (a.ordem || 0) - (b.ordem || 0)).map(c => c.nome);
  return { revisao: revisao || 0, existe: true, categorias: raizes, itens: (itens || []).filter(i => i && i.id).map(i => paraItem(i, cats)) };
}

module.exports = { NexoHub, ErroNexoHub, cliente, conexao, paraItem, paraIndice, nomesCategorias, semAcento,
                   APP, SIS_MODELO, SIS_PLACA, CAT_MODELOS, CAT_PLACAS, PADRAO, CONEXAO };
