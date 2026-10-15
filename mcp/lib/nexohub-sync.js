/* NexoEletric - nexohub-sync.js: publica no Nexo Hub a biblioteca 3D e as placas do NexoEletric.

   Um codigo so para os dois que sincronizam: o app desktop (electron/lib/nexohub-sync.js roda este
   arquivo num processo Node a parte, para a janela nao travar) e o MCP (nexo_sincronizar).
   Contrato: ..\nexohub\docs\CONTRATO.md §4 e docs/INTEGRACAO-NEXOCAD.md.

   Biblioteca 3D: cada modelo de Libs/pcblib-hub.js (os STEP em Libs/3d-hub/) e da PcbLib da casa
   (Libs/pcblib-3d.js + Libs/3d/, que o hubserver tira da PcbLib sob demanda: vem do hub no ar)
   vira um item `modelo3d` em eletronicos/modelos-3d:
     chave nexoeletric-modelo = o `file` do modelo ('3d-hub/<sha1>.step', '3d/<checksum>.step');
     atributos {footprints:[...], origem:'pcblib-hub'|'pcblib-3d', arquivo};
     vinculos `footprint` (para_ref = o footprint que usa o corpo);
     revisao 1 com os papeis `step` e `origem` (o mesmo blob).
   Idempotente: as chaves se resolvem em lote, so sobe o que falta, e um modelo que ja tem revisao
   NUNCA ganha outra daqui (a 2 em diante e do NexoCAD). Retoma sozinho: item criado sem revisao
   (a sincronizacao caiu no meio) recebe a revisao 1 na proxima. Item que ja existe so tem os
   footprints atualizados (PATCH atributos + vinculos novos), sem revisao.

   Placas: cada projeto com board.js vira um item `placa` (chave nexoeletric-placa = o projeto,
   categoria placas). O papel `placa` e o pacote eletrichub-placa-v1 (hub-nexopacote.js, a placa
   efetiva + os corpos da vista 3D) com os modelos apontando ITENS do Nexo Hub:
     modelos[chave] = {item:'<id>', rev:N, nome}       (sem "arquivo")
   Revisao nova so quando o pacote muda: atributos.pacote_sha = sha256 do pacote canonico (chaves
   em ordem, sem `gerado`). Vinculos `usa` -> cada item de modelo.

   CLI (o que o app desktop roda):
     node mcp/lib/nexohub-sync.js --root <pasta do hub> --hub <url do hub no ar>
          [--nexohub <url>] [--token <t>] [--sem-modelos] [--sem-placas] [--placas "A|B"]
   Uma linha JSON por evento no stdout: {ev:'log',nivel,msg} {ev:'progresso',fase,feitos,total}
   {ev:'fim',ok,resumo|erro}. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const NH = require('./nexohub.js');

const CONCORRENCIA = 4;
const ehStep = b => b && b.length > 20 && b.slice(0, 256).toString('latin1').includes('ISO-10303-21');
const tem = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

/* ---------- as bibliotecas ---------- */
function avaliaVar(txt, nome) {
  const { avaliaVar: av } = require('./arquivo-linhas.js');
  return av(txt, nome);
}
async function lib3dDe(ctx, hubUrl, log) {
  const local = ctx.lib('pcblib-3d.js', 'pcblib3d');
  if (local) return local;
  if (!hubUrl) return null;
  try {
    /* a primeira vez o hubserver le a PcbLib inteira (~10 s): espera bem */
    const r = await fetch(hubUrl.replace(/\/+$/, '') + '/Libs/pcblib-3d.js', { signal: AbortSignal.timeout(300000) });
    if (!r.ok) { if (log) log('warn', `o hub não serviu Libs/pcblib-3d.js (HTTP ${r.status}): a PcbLib 3D fica de fora`); return null; }
    return avaliaVar(await r.text(), 'pcblib3d');
  } catch (e) { if (log) log('warn', 'Libs/pcblib-3d.js: ' + (e && e.message || e)); return null; }
}
function libHubDe(ctx) {
  const v = ctx.lib('pcblib-hub.js', 'pcblibHub');
  return v && typeof v === 'object' ? v : null;
}

/* os modelos das duas bibliotecas: [{file, nome, origem, footprints}] (um por `file`) */
function coletaModelos(libHub, lib3d) {
  const porFile = new Map();
  const poe = (m, origem, fp) => {
    if (!m || typeof m.file !== 'string' || !/\.(step|stp)$/i.test(m.file) || /^nexo:/.test(m.file)) return;
    let e = porFile.get(m.file);
    if (!e) { e = { file: m.file, nome: m.name || m.file.split('/').pop(), origem, footprints: new Set() }; porFile.set(m.file, e); }
    if (fp) e.footprints.add(String(fp));
  };
  if (libHub) {
    const models = libHub.models || {};
    for (const f of (libHub.footprints || [])) for (const b of ((f && f.bodies) || [])) if (b && b.kind === 'step' && tem(models, b.model)) poe(models[b.model], 'pcblib-hub', f.name);
    for (const id of Object.keys(models)) poe(models[id], 'pcblib-hub');
  }
  if (lib3d) {
    const models = lib3d.models || {};
    for (const [nome, f] of Object.entries(lib3d.footprints || {})) for (const b of ((f && f.bodies) || [])) if (b && b.kind === 'step' && tem(models, b.model)) poe(models[b.model], 'pcblib-3d', nome);
    for (const id of Object.keys(models)) poe(models[id], 'pcblib-3d');
  }
  return [...porFile.values()].map(e => Object.assign(e, { footprints: [...e.footprints].sort() }));
}

/* os bytes do STEP de uma chave de modelo: do disco, senao do hub no ar */
async function lerModelo(chave, o) {
  const k = String(chave || '');
  let rel = null, url = null;
  const mp = /^projeto:([^/]+)\/(.+)$/.exec(k);
  if (mp) {
    if (mp[2].split(/[\\/]/).includes('..') || mp[1].includes('..')) throw new Error('chave inválida: ' + k);
    rel = path.join(o.projetosDir || path.join(o.root, 'Projects'), mp[1], ...mp[2].split('/'));
    url = `/Projects/${encodeURIComponent(mp[1])}/${mp[2].split('/').map(encodeURIComponent).join('/')}`;
  } else {
    if (k.split(/[\\/]/).includes('..') || /:/.test(k)) throw new Error('chave inválida: ' + k);
    rel = path.join(o.root, 'Libs', ...k.split('/'));
    url = '/Libs/' + k.split('/').map(encodeURIComponent).join('/');
  }
  try { const b = fs.readFileSync(rel); if (ehStep(b)) return b; } catch (_) { /* sob demanda */ }
  if (!o.hubUrl) throw new Error(`${k}: o STEP não está no disco e o hub não está no ar`);
  const r = await fetch(o.hubUrl.replace(/\/+$/, '') + url, { signal: AbortSignal.timeout(300000) });
  if (!r.ok) throw new Error(`${k}: o hub não serviu o STEP (HTTP ${r.status})`);
  const b = Buffer.from(await r.arrayBuffer());
  if (!ehStep(b)) throw new Error(`${k}: não é um STEP (não começa com ISO-10303-21)`);
  return b;
}

/* ---------- um pool simples ---------- */
async function emLotes(lista, n, f, sinal) {
  let i = 0;
  const trab = async () => {
    while (i < lista.length) {
      if (sinal && sinal.aborted) return;
      const k = i++;
      await f(lista[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, lista.length)) }, trab));
}

const nomeItem = m => String(m.nome || m.file).replace(/\.(step|stp)$/i, '') || m.file;
const iguais = (a, b) => JSON.stringify([...(a || [])].map(String).sort()) === JSON.stringify([...(b || [])].map(String).sort());

/* cria o item (se faltar) e a revisao 1 (se faltar). Devolve {id, rev, criado, enviado} */
async function garanteModelo(cliente, m, ler, nota) {
  let r = (await cliente.resolver(NH.SIS_MODELO, [m.file]))[m.file] || null;
  let criado = false;
  if (!r) {
    const fps = m.footprints || [];
    const it = await cliente.criaItem({
      tipo: 'modelo3d', categoria: NH.CAT_MODELOS, nome: nomeItem(m), descricao: fps.length ? 'Corpo 3D de ' + fps.join(', ') : '',
      tags: ['step', m.origem || 'nexoeletric'], atributos: { footprints: fps, origem: m.origem || '', arquivo: m.nome || '' },
      chaves: [{ sistema: NH.SIS_MODELO, chave: m.file }],
      vinculos: fps.map(f => ({ relacao: 'footprint', para_ref: f })),
    });
    r = { id: it.id, rev: Number(it.rev != null ? it.rev : it.rev_atual) || 0 };
    criado = !it.existente;
  }
  if (r.rev >= 1) return { id: r.id, rev: r.rev, criado, enviado: false };
  const dados = await ler(m);
  const b = await cliente.sobeBlob(dados, m.nome || m.file.split('/').pop());
  try {
    const j = await cliente.novaRevisao(r.id, { arquivos: { step: { sha256: b.sha256, nome: m.nome || '' }, origem: { sha256: b.sha256, nome: m.nome || '' } }, base: 0, nota: nota || 'importado do NexoEletric' });
    return { id: r.id, rev: Number(j.numero) || 1, criado, enviado: true };
  } catch (e) {
    if (e.status === 409) { const x = (await cliente.resolver(NH.SIS_MODELO, [m.file]))[m.file]; return { id: r.id, rev: x ? x.rev : 1, criado, enviado: false }; }
    throw e;
  }
}

/* a biblioteca 3D inteira. modelos = coletaModelos(...); ler(m) -> Buffer */
async function sincronizaModelos(o) {
  const { cliente, modelos, ler } = o;
  const log = o.log || (() => {}), progresso = o.progresso || (() => {});
  const resumo = { total: modelos.length, existentes: 0, criados: 0, enviados: 0, footprints: 0, falhas: [] };
  const res = await cliente.resolver(NH.SIS_MODELO, modelos.map(m => m.file));
  /* os atributos dos que ja existem (para os footprints), numa listagem so */
  const atr = new Map();
  if (Object.keys(res).length) {
    try { for (const it of (await cliente.todos({ sistema: NH.SIS_MODELO })).itens) atr.set(it.id, it); }
    catch (e) { log('warn', 'não li os atributos dos modelos: ' + e.message); }
  }
  const faltam = [], mudar = [];
  for (const m of modelos) {
    const r = res[m.file];
    if (!r || !(r.rev >= 1)) { faltam.push(m); continue; }
    resumo.existentes++;
    const it = atr.get(r.id);
    if (it && !iguais((it.atributos || {}).footprints, m.footprints)) mudar.push({ m, it });
  }
  log('info', `biblioteca 3D: ${modelos.length} modelos, ${resumo.existentes} já no Nexo Hub, ${faltam.length} a enviar, ${mudar.length} com footprints novos`);
  let feitos = 0;
  progresso({ fase: 'modelos', feitos, total: faltam.length });
  await emLotes(faltam, o.concorrencia || CONCORRENCIA, async (m) => {
    try {
      const g = await garanteModelo(cliente, m, ler, `importado do NexoEletric (${m.origem})`);
      if (g.criado) resumo.criados++;
      if (g.enviado) resumo.enviados++; else resumo.existentes++;
    } catch (e) {
      resumo.falhas.push(`${m.file}: ${e && e.message || e}`);
      if (e && e.codigo === 'fora_do_ar') throw e;
    } finally {
      feitos++;
      if (feitos % 10 === 0 || feitos === faltam.length) progresso({ fase: 'modelos', feitos, total: faltam.length });
    }
  }, o.sinal);
  for (const { m, it } of mudar) {
    try {
      const antes = new Set(((it.atributos || {}).footprints || []).map(String));
      const novos = Array.from(new Set([...antes, ...m.footprints])).sort();
      if (iguais(novos, [...antes])) continue;
      await cliente.alteraItem(it.id, { atributos: { footprints: novos } });
      for (const f of m.footprints) if (!antes.has(f)) await cliente.vincula({ de_item: it.id, relacao: 'footprint', para_ref: f });
      resumo.footprints++;
    } catch (e) { resumo.falhas.push(`${m.file} (footprints): ${e.message}`); }
  }
  if (resumo.falhas.length) log('warn', `biblioteca 3D: ${resumo.falhas.length} falha(s): ${resumo.falhas.slice(0, 3).join('; ')}`);
  return resumo;
}

/* ---------- placas ---------- */
/* o JSON canonico: chaves em ordem, sem espaco */
function canonico(v) {
  if (Array.isArray(v)) return '[' + v.map(canonico).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonico(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
function shaPacote(pacote) {
  const p = Object.assign({}, pacote);
  delete p.gerado;
  return sha256(Buffer.from(canonico(p), 'utf8'));
}

/* o indice do hub-nexo.js a partir do Nexo Hub (todos os itens) */
async function indiceDoNexoHub(cliente) {
  const [cats, L] = await Promise.all([cliente.categorias().catch(() => []), cliente.todos({})]);
  return NH.paraIndice(L.itens, cats, L.revisao);
}

/* os corpos 3D da placa (o que a vista 3D desenha), com o Nexo Hub por cima */
function corposDaPlaca(ctx, p, eb, board, o) {
  const M3 = ctx.exige('hub-pcb3d-modelo.js', 'HubPcb3dModelo');
  const HN = ctx.exige('hub-nexo.js', 'HubNexo');
  const HF = ctx.modulo('hub-fplib.js');
  const d3f = p.arq('board3d.js');
  const d3 = fs.existsSync(d3f) ? (ctx.lerVarCache(d3f, 'pcbmirror3d') || null) : null;
  const hub = o.libHub || libHubDe(ctx);
  const esp = d3 && d3.thickness > 0 ? d3.thickness : 1.6;
  const corpos = M3.corpos(eb, d3, { pcblib3d: o.lib3d || null, pcblib3dHub: hub && HF ? HF.lib3d(HF.normaliza(JSON.parse(JSON.stringify(hub)))) : null,
    base: `Projects/${p.nome}/`, baseLib: 'Libs/', thickness: esp, board, nexo: o.indice ? HN.resolvedorDe(o.indice) : null, projeto: p.nome });
  return { corpos, esp };
}

/* a chave do pacote -> o id do item, quando ela ja diz (nexo:<id>, ou a url /api/nexo/arquivo/<id>/) */
function idDaChave(k, m) {
  const a = /^nexo:([^@]+)/.exec(String(k || ''));
  if (a) return a[1];
  const b = /\/api\/nexo\/arquivo\/([^/?]+)\//.exec(String((m && m.url) || ''));
  return b ? decodeURIComponent(b[1]) : null;
}

/* troca os modelos do pacote (arquivo/url) por itens do Nexo Hub e publica o item placa.
   garante(chave, m) -> {id, rev} cria o modelo que falta (ou null). Devolve {item, rev, mudou, avisos, pacote} */
async function publicaPacote(o) {
  const { cliente } = o;
  const pacote = JSON.parse(JSON.stringify(o.pacote));
  const avisos = (o.avisos || []).slice();
  if (!pacote || pacote.format !== 'eletrichub-placa-v1') throw new Error('pacote inválido: falta format "eletrichub-placa-v1"');
  const projeto = String(pacote.projeto || '').trim();
  if (!projeto) throw new Error('pacote sem "projeto"');
  const modelos = pacote.modelos && typeof pacote.modelos === 'object' ? pacote.modelos : {};
  const chaves = Object.keys(modelos);
  const porChave = await cliente.resolver(NH.SIS_MODELO, chaves.filter(k => !idDaChave(k, modelos[k])));
  const saida = {}, falhos = new Set(), revDe = new Map();
  for (const k of chaves) {
    const m = modelos[k] || {};
    let ref = null;
    try {
      const id = idDaChave(k, m);
      if (id) {
        if (!revDe.has(id)) { const it = await cliente.item(id); revDe.set(id, Number(it.rev != null ? it.rev : it.rev_atual) || 0); }
        ref = { id, rev: revDe.get(id) };
      } else if (porChave[k] && porChave[k].rev >= 1) ref = { id: porChave[k].id, rev: porChave[k].rev };
      else if (o.garante) ref = await o.garante(k, m);
    } catch (e) { avisos.push(`${k}: ${e && e.message || e}`); ref = null; }
    if (!ref || !(ref.rev >= 1)) { if (!avisos.some(a => a.startsWith(k + ':'))) avisos.push(`${k}: o modelo não está no Nexo Hub`); falhos.add(k); continue; }
    saida[k] = { item: ref.id, rev: ref.rev, nome: m.nome || k.split('/').pop() };
  }
  pacote.modelos = saida;
  if (falhos.size) for (const c of (pacote.componentes || [])) if (c && Array.isArray(c.corpos)) c.corpos = c.corpos.filter(b => !(b && b.tipo === 'step' && falhos.has(b.modelo)));
  const sha = shaPacote(pacote);

  let r = (await cliente.resolver(NH.SIS_PLACA, [projeto]))[projeto] || null;
  let it;
  if (!r) {
    it = await cliente.criaItem({ tipo: 'placa', categoria: NH.CAT_PLACAS, nome: projeto, descricao: 'Placa do NexoEletric',
      tags: ['pcb'], atributos: { projeto }, chaves: [{ sistema: NH.SIS_PLACA, chave: projeto }] });
  } else it = await cliente.item(r.id);
  const revAtual = Number(it.rev != null ? it.rev : it.rev_atual) || 0;
  if (revAtual >= 1 && (it.atributos || {}).pacote_sha === sha) return { item: it.id, rev: revAtual, mudou: false, avisos, pacote, sha };
  const b = await cliente.sobeBlob(Buffer.from(JSON.stringify(pacote, null, 1), 'utf8'), 'placa.json');
  let numero;
  try { numero = (await cliente.novaRevisao(it.id, { arquivos: { placa: { sha256: b.sha256, nome: 'placa.json' } }, base: revAtual, nota: o.nota || 'placa do NexoEletric' })).numero; }
  catch (e) {
    if (e.status !== 409) throw e;
    const x = await cliente.item(it.id);
    numero = (await cliente.novaRevisao(it.id, { arquivos: { placa: { sha256: b.sha256, nome: 'placa.json' } }, base: Number(x.rev != null ? x.rev : x.rev_atual) || 0, nota: o.nota || 'placa do NexoEletric' })).numero;
  }
  await cliente.alteraItem(it.id, { atributos: { projeto, pacote_sha: sha, componentes: (pacote.componentes || []).length, modelos: Object.keys(saida).length } });
  const usados = [...new Set(Object.values(saida).map(m => m.item))];
  await emLotes(usados, CONCORRENCIA, async (id) => { try { await cliente.vincula({ de_item: it.id, relacao: 'usa', para_item: id }); } catch (e) { avisos.push('vínculo ' + id + ': ' + e.message); } });
  return { item: it.id, rev: Number(numero) || revAtual + 1, mudou: true, avisos, pacote, sha };
}

/* uma placa: board.js + changes.js -> pacote -> item placa */
async function publicaPlaca(o) {
  const { ctx, cliente } = o;
  const NP = ctx.exige('hub-nexopacote.js', 'HubNexoPacote');
  const p = typeof o.projeto === 'string' ? ctx.projeto(o.projeto) : o.projeto;
  const { board, eb } = ctx.placa(p);
  const indice = o.indice || await indiceDoNexoHub(cliente);
  const lib3d = o.lib3d !== undefined ? o.lib3d : await lib3dDe(ctx, o.hubUrl, o.log);
  const { corpos, esp } = corposDaPlaca(ctx, p, eb, board, { lib3d, indice, libHub: o.libHub });
  const { pacote, avisos } = NP.monta(eb, { projeto: p.nome, espessura: esp, corpos, vias: !!o.vias, laser: ctx.modulo('hub-laser.js') });
  const ler = (m) => lerModelo(m.file, { root: ctx.root, projetosDir: ctx.dirProjetos(), hubUrl: o.hubUrl });
  const garante = async (k, m) => {
    const fps = [...new Set((pacote.componentes || []).filter(c => (c.corpos || []).some(b => b.modelo === k)).map(c => c.footprint).filter(Boolean))];
    const origem = /^projeto:/.test(k) ? 'projeto' : /^3d-hub\//.test(k) ? 'pcblib-hub' : /^3d\//.test(k) ? 'pcblib-3d' : 'nexoeletric';
    const g = await garanteModelo(cliente, { file: k, nome: m.nome, origem, footprints: fps }, ler, `importado do NexoEletric (${origem}, placa ${p.nome})`);
    return { id: g.id, rev: g.rev };
  };
  const r = await publicaPacote({ cliente, pacote, avisos, garante, nota: o.nota });
  return Object.assign({ projeto: p.nome }, r);
}

function projetosComPlaca(ctx) {
  return ctx.listaProjetos().filter(n => { try { return fs.statSync(path.join(ctx.dirProjetos(), n, 'board.js')).isFile(); } catch (_) { return false; } });
}

async function sincronizaPlacas(o) {
  const { ctx, cliente } = o;
  const log = o.log || (() => {}), progresso = o.progresso || (() => {});
  const nomes = Array.isArray(o.projetos) && o.projetos.length ? o.projetos.filter(n => projetosComPlaca(ctx).includes(n)) : projetosComPlaca(ctx);
  const resumo = { total: nomes.length, publicadas: 0, iguais: 0, falhas: [], itens: {} };
  if (!nomes.length) return resumo;
  const indice = await indiceDoNexoHub(cliente);
  const lib3d = await lib3dDe(ctx, o.hubUrl, log);
  const libHub = libHubDe(ctx);
  let feitos = 0;
  progresso({ fase: 'placas', feitos, total: nomes.length });
  for (const n of nomes) {
    if (o.sinal && o.sinal.aborted) break;
    try {
      const r = await publicaPlaca({ ctx, cliente, projeto: n, hubUrl: o.hubUrl, indice, lib3d, libHub, log });
      resumo.itens[n] = { item: r.item, rev: r.rev, mudou: r.mudou };
      if (r.mudou) { resumo.publicadas++; log('info', `placa "${n}": revisão ${r.rev} no Nexo Hub (${r.item})${r.avisos.length ? ', ' + r.avisos.length + ' aviso(s)' : ''}`); }
      else resumo.iguais++;
    } catch (e) {
      resumo.falhas.push(`${n}: ${e && e.message || e}`);
      if (e && e.codigo === 'fora_do_ar') throw e;
    }
    progresso({ fase: 'placas', feitos: ++feitos, total: nomes.length });
  }
  if (resumo.falhas.length) log('warn', `placas: ${resumo.falhas.length} falha(s): ${resumo.falhas.slice(0, 3).join('; ')}`);
  return resumo;
}

/* tudo: {root, hubUrl, nexohub:{url, token}|cliente, modelos (true), placas (true | [projetos]), log, progresso} */
async function sincroniza(o) {
  const { Contexto } = require('./contexto.js');
  const log = o.log || (() => {});
  const ctx = o.ctx || new Contexto({ root: o.root, hubUrl: o.hubUrl, projetos: o.projetosDir });
  const cliente = o.cliente || NH.cliente(o.nexohub || {});
  const s = await cliente.saude();
  const resumo = { nexohub: cliente.url, versao: s && s.versao, modelos: null, placas: null };
  if (o.modelos !== false) {
    const lib3d = await lib3dDe(ctx, o.hubUrl, log);
    const modelos = coletaModelos(libHubDe(ctx), lib3d);
    const ler = (m) => lerModelo(m.file, { root: ctx.root, projetosDir: ctx.dirProjetos(), hubUrl: o.hubUrl });
    resumo.modelos = await sincronizaModelos({ cliente, modelos, ler, log, progresso: o.progresso, concorrencia: o.concorrencia, sinal: o.sinal });
  }
  if (o.placas !== false) resumo.placas = await sincronizaPlacas({ ctx, cliente, hubUrl: o.hubUrl, projetos: Array.isArray(o.placas) ? o.placas : null, log, progresso: o.progresso, sinal: o.sinal });
  return resumo;
}

module.exports = { sincroniza, sincronizaModelos, sincronizaPlacas, publicaPlaca, publicaPacote, garanteModelo, coletaModelos,
                   lerModelo, lib3dDe, libHubDe, corposDaPlaca, indiceDoNexoHub, projetosComPlaca, canonico, shaPacote, idDaChave, emLotes };

/* ---------- CLI (o app desktop) ---------- */
if (require.main === module) {
  const a = process.argv.slice(2);
  const val = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const sai = o => process.stdout.write(JSON.stringify(o) + '\n');
  const nexohub = {};
  if (val('--nexohub')) nexohub.url = val('--nexohub');
  if (val('--token')) nexohub.token = val('--token');
  const placas = a.includes('--sem-placas') ? false : (val('--placas') ? val('--placas').split('|').filter(Boolean) : true);
  sincroniza({
    root: val('--root') || path.resolve(__dirname, '..', '..'), hubUrl: val('--hub') || '', nexohub,
    modelos: !a.includes('--sem-modelos'), placas,
    log: (nivel, msg) => sai({ ev: 'log', nivel, msg }),
    progresso: p => sai(Object.assign({ ev: 'progresso' }, p)),
  }).then(resumo => { sai({ ev: 'fim', ok: true, resumo }); process.exit(0); },
          e => { sai({ ev: 'fim', ok: false, erro: String(e && e.message || e), offline: e && e.codigo === 'fora_do_ar' }); process.exit(e && e.codigo === 'fora_do_ar' ? 3 : 1); });
}
