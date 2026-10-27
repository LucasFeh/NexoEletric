/* NexoEletric MCP - sem o Nexo Hub, nada de projeto nem de biblioteca (1.29.0).

   Mesma regra do hubserver (nexohub_gate.py): projetos, esquemas, símbolos e footprints moram no
   NexoBD e chegam pelo Nexo Hub; a pasta de trabalho é só a memória de trabalho do app. Com o Hub
   desconectado (fora do ar, ou no ar sem os dados: saúde sem bd.ok), as ferramentas que leem ou
   gravam projeto/biblioteca recusam com uma mensagem clara, em vez de ler uma cópia velha do disco.
   Seguem livres as que só olham o app/Hub ou ensinam (LIVRES). Pasta de desenvolvedor (git) não tem
   a regra: lá a pasta é o repositório. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { conexao } = require('./nexohub.js');

const LIVRES = new Set(['app_status', 'app_abrir', 'hub_status', 'nexo_estado', 'list_commands', 'lote',
  'skills_listar', 'skill_ler', 'altium_comandos', 'hub_recarregar_ferramentas', 'hub_modulos', 'jlc_login']);
const VALIDADE = 5000;
const MSG = 'Sem conexão com o Nexo Hub: os projetos e a biblioteca do NexoEletric só existem com ele conectado. Abra o Nexo Hub (ou confira a conexão) e tente de novo.';

let cache = null;   // {quando, ok, erro}

async function sonda() {
  const c = conexao();
  try {
    const h = { 'X-App': 'nexoeletric' };
    if (c.token) h.Authorization = 'Bearer ' + c.token;
    const r = await fetch(c.url + '/api/v1/saude', { headers: h, signal: AbortSignal.timeout(3000) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.ok) return { ok: false, erro: `o Nexo Hub em ${c.url} não respondeu bem (HTTP ${r.status})` };
    if (j.bd && j.bd.ok === false) return { ok: false, erro: 'o Nexo Hub está no ar, mas sem os dados' };
    return { ok: true, erro: '' };
  } catch (e) {
    return { ok: false, erro: `Nexo Hub fora do ar em ${c.url}` };
  }
}

async function conectado() {
  if (cache && Date.now() - cache.quando < VALIDADE) return cache;
  cache = Object.assign({ quando: Date.now() }, await sonda());
  return cache;
}

function ehDev(root) { try { return fs.existsSync(path.join(root, '.git')); } catch (_) { return false; } }

/* null = segue; senão a mensagem de recusa */
async function recusa(ferramenta, ctx) {
  if (LIVRES.has(ferramenta) || process.env.ELETRICHUB_SEM_GATE === '1' || (ctx && ehDev(ctx.root))) return null;
  const c = await conectado();
  return c.ok ? null : `${MSG} (${c.erro})`;
}

module.exports = { recusa, conectado, LIVRES, MSG, _zera: () => { cache = null; } };
