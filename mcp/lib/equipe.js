/* NexoEletric MCP - equipe.js — a equipe do projeto e o historico com autor nas escritas da IA (1.84.0).

   A regra é a do servidor (tools/rotas/equipe.py): quem está logado no Nexo Hub desta máquina (GET <hub>/api/v1/sessao,
   o login é um só por máquina) é quem a IA está ajudando. Pode gravar no projeto: o admin, o responsável, um
   colaborador convidado, ou qualquer um num projeto sem responsável (Projects/<p>/equipe.json). Hub antigo (404) ou
   fora do ar: liberado (quem barra sem Hub é o gate-hub.js).

   A sessão é lida ANTES de cada ferramenta (protocolo.js » executa, assíncrono, cache de 2 s) e conferida na gravação
   (contexto.js » grava, que é síncrona). Depois de gravar, o histórico: a escrita vai ao servidor do app aberto nesta
   pasta (POST /api/historico/registra, com o conteúdo anterior e origem "ia"; o diff do que mudou mora lá). Sem o app
   aberto, uma linha simples vai direto para Projects/<p>/Historico/<id>.jsonl ("<arquivo> alterado pela IA"). */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { conexao } = require('./nexohub.js');

const CACHE = 2000;
const TIPOS = { 'schematic.js': 'esquema', 'changes.js': 'pcb', 'rules.js': 'regras', 'annotations.js': 'anotacoes' };
let ultima = null;          // {quando, modo, usuario}
let provedor = null;        // testes: () => resposta do /api/v1/sessao | {status: 404}

function publico(u) {
  if (!u || !u.id) return null;
  return { id: String(u.id), login: String(u.login || ''), nome: String(u.nome || u.login || ''), admin: !!u.admin, aprovador: !!u.aprovador };
}

async function sessao(forcar) {
  if (!provedor && !forcar && ultima && Date.now() - ultima.quando < CACHE) return ultima;
  let modo = 'fora', usuario = null;
  try {
    let j, st;
    if (provedor) { j = provedor(); st = j && j.status ? j.status : 200; }
    else {
      const c = conexao();
      const r = await fetch(c.url + '/api/v1/sessao', { headers: { 'X-App': 'nexoeletric' }, signal: AbortSignal.timeout(3000) });
      st = r.status; j = r.ok ? await r.json().catch(() => null) : null;
    }
    if (st === 404) modo = 'legado';
    else if (st === 200 && j) { usuario = j.logado ? publico(j.usuario) : null; modo = usuario ? 'login' : 'deslogado'; }
  } catch (_) { modo = 'fora'; }
  ultima = { quando: Date.now(), modo, usuario };
  return ultima;
}

function leEquipe(pdir) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(pdir, 'equipe.json'), 'utf8'));
    return { responsavel: d && d.responsavel && d.responsavel.id ? d.responsavel : null, colaboradores: Array.isArray(d && d.colaboradores) ? d.colaboradores : [] };
  } catch (_) { return { responsavel: null, colaboradores: [] }; }
}

/* null = pode gravar; senão a mensagem de recusa */
function recusa(pdir, s) {
  s = s || ultima || { modo: 'fora', usuario: null };
  const e = leEquipe(pdir);
  if (!e.responsavel || s.modo === 'legado' || s.modo === 'fora') return null;
  const u = s.usuario;
  if (u && (u.admin || u.id === String(e.responsavel.id) || e.colaboradores.some(c => String(c.id) === u.id))) return null;
  return `Só o responsável (${e.responsavel.nome || '—'}) e os colaboradores convidados mexem neste projeto` +
    (u ? ` (você está logado no Nexo Hub como ${u.nome})` : ' (ninguém está logado no Nexo Hub)');
}

/* o projeto e o arquivo de um caminho absoluto: {pdir, projeto, arquivo} | null */
function doProjeto(ctx, abs) {
  const rel = path.relative(ctx.dirProjetos(), abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const partes = rel.split(path.sep);
  if (partes.length < 2) return null;
  return { pdir: path.join(ctx.dirProjetos(), partes[0]), projeto: partes[0], arquivo: partes.length === 2 ? partes[1] : partes.slice(1).join('/') };
}

/* o servidor do app aberto NESTA pasta (para o diff do historico morar num lugar so); cache de 30 s */
let hubCache = null;
async function hubDaPasta(ctx) {
  if (hubCache && Date.now() - hubCache.quando < 30000) return hubCache.url;
  let url = null;
  try {
    const { hubNoAr } = require('./util.js');
    const h = await hubNoAr(ctx);
    if (h && h.ok && h.mesmaRaiz) url = h.url;
  } catch (_) { url = null; }
  hubCache = { quando: Date.now(), url };
  return url;
}

function linhaSimples(pdir, arquivo, ferramenta, usuario) {
  const d = path.join(pdir, 'Historico');
  const nome = String(usuario ? usuario.id : 'sem-login').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|[._]+$/g, '') || 'sem-login';
  const agora = new Date();
  const iso = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  const e = { id: crypto.randomBytes(6).toString('hex'), quando: iso, ate: iso,
    usuario: usuario ? { id: usuario.id, login: usuario.login, nome: usuario.nome } : null, origem: 'ia', arquivo,
    tipo: TIPOS[arquivo] || 'outro', mudancas: [`${arquivo} alterado pela IA${ferramenta ? ' (' + ferramenta + ')' : ''}`], gravacoes: 1 };
  if (ferramenta) e.ferramentas = [ferramenta];
  fs.mkdirSync(d, { recursive: true });
  fs.appendFileSync(path.join(d, nome + '.jsonl'), JSON.stringify(e) + '\n', 'utf8');
}

/* depois de gravar (não espera: a ferramenta responde na hora) */
function registraHistorico(ctx, onde, antes, ferramenta) {
  if (!onde || !TIPOS[onde.arquivo] || process.env.ELETRICHUB_SEM_HISTORICO === '1') return Promise.resolve(false);
  const usuario = ultima && ultima.usuario;
  return (async () => {
    const url = await hubDaPasta(ctx);
    if (url) {
      try {
        const r = await fetch(url.replace(/\/+$/, '') + '/api/historico/registra', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
          body: JSON.stringify({ projeto: onde.projeto, arquivo: onde.arquivo, antes, origem: 'ia', ferramenta: ferramenta || '' }) });
        if (r.ok) return true;
      } catch (_) { /* o app fechou: a linha simples */ }
    }
    linhaSimples(onde.pdir, onde.arquivo, ferramenta, usuario);
    return true;
  })().catch(e => { ctx.log('histórico: ' + (e && e.message || e)); return false; });
}

/* o projeto que a IA acabou de criar: quem está logado é o responsável */
function nova(pdir) {
  const u = ultima && ultima.usuario;
  if (!u) return false;
  fs.writeFileSync(path.join(pdir, 'equipe.json'), JSON.stringify({ formato: 'nexoeletric-equipe-1',
    responsavel: { id: u.id, login: u.login, nome: u.nome }, colaboradores: [] }, null, 1) + '\n', 'utf8');
  return true;
}

module.exports = { sessao, recusa, doProjeto, registraHistorico, nova, leEquipe, TIPOS,
  usuario: () => (ultima && ultima.usuario) || null,
  _provedor: f => { provedor = f; ultima = null; }, _zera: () => { ultima = null; hubCache = null; } };
