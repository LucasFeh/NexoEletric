'use strict';
// O projeto ABERTO e a revisao que chega de outra maquina pelo NexoBD (1.85.0).
//
// Pedido do dono (2026-11-09): "quando eu estiver fazendo alguma alteracao no meu projeto, se outro colaborador ou admin
// estiver com o projeto aberto, avise pra ele que o projeto dele ta desatualizado, e pergunta se quiser sincronizar o
// nexohub dele e atualizar o projeto pra ficar com a ultima versao".
//
// Ate a 1.84.0 a revisao de fora entrava calada na proxima rodada (a de 2 min: o evento do NexoBD de outro NexoEletric
// era ignorado) e a vista aberta recarregava sozinha, ou, com edicao pendente, pedia F5 e perguntava "sobrescrever?" ao
// salvar. Agora, para projeto aberto em alguma janela desta maquina (a pagina avisa, .altiumhub/nexobd-abertos.json):
//   - a revisao nova que nao foi feita AQUI (a maquina vai na nota da revisao: "NexoEletric @<maquina>") fica SEGURADA:
//     a rodada ve o item como estava (a revisao que esta pasta ja tem), nada baixa e nada sobe dele;
//   - o motor escreve o aviso em .altiumhub/nexobd-desatualizados.json: quem (o autor da revisao = o login), onde (a
//     maquina), quando, o que mudou (as linhas novas do Historico/<id>.jsonl que vieram na revisao, o historico com
//     autor da 1.84.0), os arquivos, o que mudou aqui e ainda nao subiu, e o que mudou dos dois lados (conflito);
//   - "Sincronizar e atualizar" (a pagina pede em .altiumhub/nexobd-sincronizar.json) libera o projeto numa rodada: o
//     espelho de sempre junta as duas pontas (o que mudou so aqui sobe, o que mudou so la desce; mudou dos dois lados,
//     vale o daqui e o de la fica em .altiumhub/conflitos-nexobd/).
// Projeto que nao esta aberto continua sincronizando sozinho.
const fs = require('node:fs');
const path = require('node:path');

const ABERTO_VALE = 45000;
const DIR = (ws) => path.join(ws, '.altiumhub');
const ARQ_ABERTOS = (ws) => path.join(DIR(ws), 'nexobd-abertos.json');
const ARQ_DESATUALIZADOS = (ws) => path.join(DIR(ws), 'nexobd-desatualizados.json');
const ARQ_PEDIDO = (ws) => path.join(DIR(ws), 'nexobd-sincronizar.json');
const HISTORICO = /^Historico\/[^/]+\.jsonl$/;

function lerJson(arq, padrao) {
  try { const d = JSON.parse(fs.readFileSync(arq, 'utf8')); return d && typeof d === 'object' ? d : padrao; } catch { return padrao; }
}
function gravarJson(arq, d) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const tmp = `${arq}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(d));
  fs.renameSync(tmp, arq);
}

/** Os projetos abertos em alguma janela desta maquina (o "quando" da pagina vem em segundos, do Python). */
function abertos(ws, agora = Date.now()) {
  const out = new Set();
  for (const j of Object.values(lerJson(ARQ_ABERTOS(ws), {}))) {
    if (j && agora - Number(j.quando || 0) * 1000 <= ABERTO_VALE) for (const p of j.projetos || []) if (p) out.add(String(p));
  }
  return out;
}

/** "NexoEletric @PC-OFICINA" → "PC-OFICINA" */
const maquinaDaNota = (nota) => { const m = /@([^\s@]+)\s*$/.exec(String(nota || '')); return m ? m[1] : ''; };
const notaComMaquina = (nota, maquina) => (maquina && !maquinaDaNota(nota) ? `${nota || 'NexoEletric'} @${maquina}` : nota);

/**
 * O cliente da rodada dos projetos, com os ABERTOS segurados: a revisao de fora de um projeto aberto aparece como a que
 * esta pasta ja tem (o item "congelado" na base do espelho) e a revisao nova daqui nao sobe (ela seria em cima da velha).
 * segurados (Map, saida): nome → {it (o item de verdade), revs (as revisoes de fora)}.
 */
function segurando({ cliente, estadoProjetos, abertos: abertosAgora, liberar = new Set(), maquina, segurados, sistema }) {
  const congela = (it, est) => ({ ...it, rev: est.rev, arquivos: Object.fromEntries(Object.entries(est.base || {}).map(([rel, sha]) => [rel, { nome: rel, sha256: sha }])) });
  const decide = async (it) => {
    if (!it || it.apagado_em) return it;
    const ch = (it.chaves || []).find((c) => c.sistema === sistema);
    const nome = ch && ch.chave;
    if (!nome || !abertosAgora.has(nome) || liberar.has(nome)) return it;
    const est = (estadoProjetos() || {})[nome];
    if (!est || !est.item || est.item !== it.id || !(Number(it.rev) > Number(est.rev || 0))) return it;
    let revs = null;
    try { revs = (await cliente.revisoes(it.id)).filter((r) => Number(r.numero) > Number(est.rev || 0)).sort((a, b) => a.numero - b.numero); } catch { revs = null; }
    // tudo feito nesta maquina (a rodada caiu depois de subir, antes de gravar o estado): nao e mudanca de fora
    if (revs && revs.length && revs.every((r) => maquinaDaNota(r.nota) === maquina)) return it;
    segurados.set(nome, { it, revs: revs || [] });
    return congela(it, est);
  };
  const ids = () => new Set([...segurados.values()].map((s) => s.it.id));
  return Object.assign(Object.create(Object.getPrototypeOf(cliente)), cliente, {
    async itens(f) {
      const r = await cliente.itens(f);
      if (!f || f.sistema !== sistema || !r || !Array.isArray(r.itens)) return r;
      const itens = [];
      for (const it of r.itens) itens.push(await decide(it));
      return { ...r, itens };
    },
    async chave(s, c) {
      const it = await cliente.chave(s, c);
      return s === sistema && it ? decide(it) : it;
    },
    async novaRevisao(id, c) {
      if (ids().has(id)) { const e = new Error('projeto segurado: desatualizado e aberto nesta máquina'); e.codigo = 'conflito'; throw e; }
      return cliente.novaRevisao(id, c);
    },
  });
}

function linhasJsonl(txt) {
  const out = [];
  for (const l of String(txt || '').split(/\r?\n/)) { const t = l.trim(); if (!t) continue; try { out.push(JSON.parse(t)); } catch { /* linha quebrada */ } }
  return out;
}

/**
 * O aviso de um projeto segurado: quem mudou, onde, quando, o que (o historico com autor que veio na revisao), os
 * arquivos, o que mudou aqui e ainda nao subiu, e os conflitos (mudou dos dois lados).
 */
async function montaAviso({ cliente, espelho, pasta, nome, est, it, revs }) {
  const remoto = espelho.arquivosDoItem(it);
  const base = est.base || {};
  const local = espelho.lerPasta(pasta, { cache: JSON.parse(JSON.stringify(est.cache || {})) });
  const nomes = new Set([...Object.keys(remoto), ...Object.keys(base), ...Object.keys(local)]);
  const mudaramLa = [], mudaramAqui = [], conflitos = [];
  for (const rel of nomes) {
    const r = remoto[rel]?.sha, b = base[rel], l = local[rel]?.sha;
    const la = r !== b, aqui = l !== b && !(est.local && est.local[rel] === l);
    if (la) mudaramLa.push(rel);
    if (aqui) mudaramAqui.push(rel);
    if (la && aqui && r !== l) conflitos.push(rel);
  }
  const entradas = [];
  for (const rel of mudaramLa.filter((x) => HISTORICO.test(x) && remoto[x])) {
    try {
      const txtR = Buffer.from(await cliente.blob(remoto[rel].sha)).toString('utf8');
      let txtL = '';
      try { txtL = fs.readFileSync(path.join(pasta, ...rel.split('/')), 'utf8'); } catch { /* ainda nao tinha */ }
      const chave = (e) => `${e.id}|${e.ate}|${e.gravacoes}`;
      const vistas = new Set(linhasJsonl(txtL).map(chave));
      for (const e of linhasJsonl(txtR)) if (!vistas.has(chave(e))) entradas.push(e);
    } catch { /* sem o blob: fica a lista de arquivos */ }
  }
  entradas.sort((a, b) => String(b.ate || b.quando || '').localeCompare(String(a.ate || a.quando || '')));
  const rv = (revs || []).map((r) => ({ numero: r.numero, autor: r.autor || '', maquina: maquinaDaNota(r.nota), quando: r.criado_em || '', app: r.app || '' }));
  const ult = rv[rv.length - 1] || {};
  const semHist = (l) => l.filter((x) => !HISTORICO.test(x)).sort();
  return {
    projeto: nome, rev: it.rev, desde: est.rev || 0, revisoes: rv,
    autor: ult.autor || '', maquina: ult.maquina || '', quando: ult.quando || it.alterado_em || '',
    arquivos: semHist(mudaramLa), entradas: entradas.slice(0, 40), locais: semHist(mudaramAqui), conflitos: semHist(conflitos),
  };
}

/** Os pedidos de "Sincronizar e atualizar" que a pagina deixou (e que saem do arquivo ao serem lidos). */
function lerPedidos(ws) {
  const arq = ARQ_PEDIDO(ws);
  const d = lerJson(arq, null);
  if (!d) return [];
  try { fs.rmSync(arq, { force: true }); } catch { /* fica para a proxima */ }
  return (d.pedidos || []).filter((p) => p && typeof p.projeto === 'string');
}

/** O arquivo que a pagina le: os avisos de agora e os "sincronizado" recentes. */
function gravarAvisos(ws, { avisos = {}, sincronizados = {} }) {
  const antes = lerJson(ARQ_DESATUALIZADOS(ws), {});
  const s = { ...(antes.sincronizados || {}), ...sincronizados };
  for (const k of Object.keys(s).sort((a, b) => (s[a].quando || 0) - (s[b].quando || 0)).slice(0, Math.max(0, Object.keys(s).length - 30))) delete s[k];
  const d = { ligado: true, quando: Date.now(), avisos, sincronizados: s };
  gravarJson(ARQ_DESATUALIZADOS(ws), d);
  return d;
}

module.exports = { abertos, maquinaDaNota, notaComMaquina, segurando, montaAviso, lerPedidos, gravarAvisos, lerJson, gravarJson,
  ARQ_ABERTOS, ARQ_DESATUALIZADOS, ARQ_PEDIDO, ABERTO_VALE };
