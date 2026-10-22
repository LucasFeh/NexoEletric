/* NexoEletric MCP - grupo "nexobd": os projetos guardados no NexoBD (o banco da rede Nexo).

   Desde o NexoEletric 1.14 nada mora so no PC: cada pasta de Projects/ e copia de um item 'projeto'
   do NexoBD (chave nexoeletric-projeto = nome da pasta; electron/lib/armazem.js sincroniza), e cada
   salvamento e uma revisao. Daqui a IA ve o que esta no banco, o historico de um projeto e volta
   uma revisao antiga (os arquivos dela voltam para a pasta e o app sobe como revisao nova). */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ErroMcp } = require('../lib/contexto.js');
const NH = require('../lib/nexohub.js');

const SISTEMA = 'nexoeletric-projeto';
const cliente = () => NH.cliente({ app: 'nexoeletric-mcp' });
const relSeguro = n => { const r = String(n || '').replace(/\\/g, '/').replace(/^\/+/, ''); return r && !/^[a-z]:/i.test(r) && !r.split('/').some(t => !t || t === '.' || t === '..') ? r : null; };
const tolera = e => { throw new ErroMcp(String(e && e.message || e)); };

async function itemDoProjeto(c, nome) {
  const j = await c.itens({ tipo: 'projeto', sistema: SISTEMA, chave: nome, limite: 5 }).catch(tolera);
  const it = (j.itens || [])[0];
  if (!it) throw new ErroMcp(`o projeto "${nome}" não está no NexoBD (nexo_projetos lista; o app sobe as pastas novas sozinho)`);
  return it;
}
const arquivosDe = arqs => Object.entries(arqs || {}).filter(([p]) => p !== 'thumb' && !p.startsWith('saida/'))
  .map(([papel, a]) => ({ rel: relSeguro(a && a.nome) || relSeguro(papel), papel, sha: a && (a.sha256 || a.sha), tamanho: a && a.tamanho })).filter(x => x.rel);

module.exports = {
  grupo: 'nexobd',
  ordem: 85,
  titulo: 'NexoBD — os projetos no banco da rede Nexo (lista, histórico, voltar revisão)',
  ferramentas: [
    {
      nome: 'nexo_projetos', titulo: 'Projetos no NexoBD', leitura: true,
      descricao: 'Os projetos do NexoEletric guardados no NexoBD (fora do catálogo: só o NexoEletric os mostra), com a revisão atual, quando mudou e se a pasta já está nesta máquina.',
      entrada: { type: 'object', properties: { busca: { type: 'string' } } },
      executa: async (a, ctx) => {
        const c = cliente();
        const { itens } = await c.todos({ tipo: 'projeto', sistema: SISTEMA }).catch(tolera);
        const locais = new Set(ctx.listaProjetos());
        const b = String(a.busca || '').toLowerCase();
        const L = itens.map(it => { const ch = (it.chaves || []).find(k => k.sistema === SISTEMA); return { nome: ch ? ch.chave : it.nome, id: it.id, rev: it.rev, atualizado: it.atualizado_em, arquivos: Object.keys(it.arquivos || {}).length }; })
          .filter(x => !b || x.nome.toLowerCase().includes(b))
          .map(x => Object.assign(x, { nestaMaquina: locais.has(x.nome) }));
        return { nexo: c.url, total: L.length, projetos: L.sort((x, y) => String(y.atualizado).localeCompare(String(x.atualizado))) };
      },
    },
    {
      nome: 'nexo_projeto_historico', titulo: 'Histórico do projeto no NexoBD', leitura: true,
      descricao: 'As revisões de um projeto no NexoBD: número, quando, de qual programa (nexoeletric = o app; nexohub-altium = o Altium pela pasta do Nexo Hub), a nota e os arquivos que mudaram em relação à anterior.',
      entrada: { type: 'object', properties: { projeto: { type: 'string' }, limite: { type: 'integer', minimum: 1, maximum: 200 } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const c = cliente();
        const it = await itemDoProjeto(c, a.projeto);
        const j = await c.pede('GET', `/api/v1/itens/${encodeURIComponent(it.id)}/revisoes`).catch(tolera);
        const revs = (j.revisoes || j || []).slice().sort((x, y) => x.numero - y.numero);
        let antes = {};
        const out = revs.map(r => {
          const agora = Object.fromEntries(arquivosDe(r.arquivos).map(x => [x.rel, x.sha]));
          const mud = Object.keys(Object.assign({}, antes, agora)).filter(k => antes[k] !== agora[k]);
          antes = agora;
          return { rev: r.numero, quando: r.criado_em, app: r.app, nota: r.nota || '', arquivos: Object.keys(agora).length, mudaram: mud.slice(0, 20), mudaram_total: mud.length };
        }).reverse();
        return { projeto: a.projeto, item: it.id, rev_atual: it.rev, revisoes: out.slice(0, a.limite || 30) };
      },
    },
    {
      nome: 'nexo_projeto_restaurar', titulo: 'Voltar o projeto a uma revisão do NexoBD', destrutiva: true,
      descricao: 'Põe na pasta do projeto os arquivos de uma revisão antiga do NexoBD (os que não existiam nela saem da pasta). O app NexoEletric sobe isso como uma revisão NOVA — nada do histórico se perde. Confira antes com nexo_projeto_historico.',
      entrada: { type: 'object', properties: { projeto: { type: 'string' }, rev: { type: 'integer', minimum: 1 } }, required: ['projeto', 'rev'] },
      executa: async (a, ctx) => {
        const c = cliente();
        const it = await itemDoProjeto(c, a.projeto);
        const j = await c.pede('GET', `/api/v1/itens/${encodeURIComponent(it.id)}/revisoes`).catch(tolera);
        const rv = (j.revisoes || j || []).find(r => r.numero === a.rev);
        if (!rv) throw new ErroMcp(`o projeto não tem a revisão ${a.rev} (nexo_projeto_historico)`);
        const alvo = arquivosDe(rv.arquivos);
        const atual = arquivosDe(it.arquivos);
        const dir = path.join(ctx.dirProjetos(), a.projeto);
        fs.mkdirSync(dir, { recursive: true });
        const escritos = [], apagados = [];
        for (const x of alvo) {
          const r = await c.pede('GET', '/api/v1/blobs/' + x.sha, undefined, { cru: true, timeout: 600000 }).catch(tolera);
          if (!r.ok) throw new ErroMcp(`não baixei ${x.rel} (HTTP ${r.status})`);
          const abs = path.join(dir, ...x.rel.split('/'));
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs + '.tmp', Buffer.from(await r.arrayBuffer()));
          fs.renameSync(abs + '.tmp', abs);
          escritos.push(x.rel);
        }
        const fica = new Set(alvo.map(x => x.rel));
        for (const x of atual) if (!fica.has(x.rel)) { try { fs.rmSync(path.join(dir, ...x.rel.split('/')), { force: true }); apagados.push(x.rel); } catch (_) { /* segue */ } }
        return { projeto: a.projeto, voltou_para: a.rev, era: it.rev, escritos: escritos.length, apagados, nota: 'o app NexoEletric sobe isto como revisão nova em poucos segundos (ou ao abrir)' };
      },
    },
  ],
};
