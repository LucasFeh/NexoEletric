/* NexoEletric - catalogo-fila.js: o catálogo de produtos editado por várias pessoas ao mesmo tempo, mesmo com a planilha
   aberta no Excel (1.89.0).

   Pedido do dono (2026-11-09): "hoje não tá deixando editar se o excel tiver sendo usado, isso n pode acontecer, tem que
   ser assincrono, mais de uma pessoa pode editar ao mesmo tempo".

   Até a 1.88.0 o cadastro e a edição gravavam direto na planilha (catalogo.js » registra/edita): com o Excel aberto o
   Windows nega abrir para escrita e a tela dizia "o catálogo está aberto em outro programa (Excel?): feche e tente de
   novo"; com um programa segurando o arquivo em uso exclusivo nem o Definir projeto abria (EBUSY).

   A FILA mora no NexoBD (a central da rede, a mesma do resto do NexoEletric): um item oculto (categoria interna
   "nexoeletric"), chave nexoeletric-catalogo = "fila-<sha1 do caminho da planilha>", com o arquivo `fila` (fila.json):
     {formato, arquivo, trava: null | {maquina, pid, token, desde, ate}, ops: [op]}
     op = {id, acao:'registra'|'edita', estado:'pendente'|'gravado'|'conflito'|'descartado', erro?, por:{nome, login,
           maquina}, criado_em, tentativas, tentado_em, gravado_em, linha,
           registra: item, codigo, sigla, ano, nome, tipo, cliente, vinculo
           edita:    item, de:{codigo?, nome?, tipo?}, para:{...o mesmo...}, forcar?}
   Toda mudança na fila é uma revisão nova com `base` = a revisão lida: duas máquinas mexendo juntas, a segunda leva 409
   (conflito), relê e refaz a conta. Assim o PRÓXIMO NÚMERO (sigla + DI + ano + item) é o maior entre a planilha e a fila
   (pendentes, em conflito e os gravados dos últimos 7 dias) + 1, e nenhum código ou item sai repetido entre máquinas.
   Código e nome repetidos continuam recusados contra a planilha + a fila.

   A LEITURA (lista, prévia, busca) = a planilha (ou a cópia da última leitura, se ela estiver travada) com a fila por cima:
   o item cadastrado aparece na hora, com a marca `fila` ({estado, erro, por}) que a tela mostra como "aguardando gravar
   na planilha"; a edição pendente aparece com o valor novo.

   O GRAVADOR (grava): qualquer máquina com o NexoEletric aberto (o hubserver roda a cada 45 s, e logo depois de cada
   mudança). Só grava com a planilha livre; pega a TRAVA dentro da própria fila (com validade de 2 min: máquina que cai não
   prende a fila), relê a planilha de verdade e aplica as pendentes na ordem:
     registra: o código já está na planilha -> gravado (nunca duplica); o número do item já foi usado por outra linha
               (alguém cadastrou direto no Excel) -> conflito; senão acrescenta a linha;
     edita:    só se o valor de agora ainda é o de quando foi pedido (de) -- senão conflito, para alguém resolver
               ("Gravar por cima" ou "Descartar"); se já está com o valor novo, gravado.
   Grava uma vez, relê para conferir e só então marca gravado (e solta a trava). Falha que não é trava (arquivo torto, a
   pasta sumiu...) fica na op como `erro`, visível na tela, e tenta de novo na rodada seguinte.

   Sem o NexoBD (o Nexo Hub fora do ar) vale o caminho de antes: direto na planilha, se ela estiver livre.
   Desligada nos testes que usam um catálogo de mentira (NEXO_CATALOGO) sem um NexoBD de mentira (NEXOHUB_URL) e com
   NEXO_FILA=0. NEXO_MAQUINA troca o nome da máquina (os testes de "duas máquinas"). */
'use strict';
const os = require('node:os');
const crypto = require('node:crypto');
const C = require('./catalogo.js');

const SISTEMA = 'nexoeletric-catalogo';
const FORMATO = 'nexoeletric-catalogo-fila-1';
const PAPEL = 'fila';
const TRAVA_MS = 120000;
const GUARDA_MS = 7 * 24 * 3600 * 1000;      /* os gravados ficam 7 dias na fila (o número seguinte conta com eles) */
const MAX_GUARDADOS = 300;
const CATEGORIA = { id: 'nexoeletric', nome: 'NexoEletric (interno)', ordem: 90, oculta: true,
  descricao: 'Guardado pelo NexoEletric e mostrado só nele: a biblioteca de símbolos (sincronizada com o Odoo) e os scripts do Altium' };

const normCod = C.normCod;
const limpa = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const agora = () => new Date().toISOString();
const novoId = () => 'f' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const maquina = () => process.env.NEXO_MAQUINA || os.hostname();
const espera = ms => new Promise(r => setTimeout(r, ms));
const arquivoDe = a => a || process.env.NEXO_CATALOGO || C.PADRAO;
const chaveDe = arq => 'fila-' + crypto.createHash('sha1').update(String(arq).replace(/\//g, '\\').toLowerCase()).digest('hex').slice(0, 16);

function desligada(env) {
  env = env || process.env;
  if (env.NEXO_FILA === '0') return 'NEXO_FILA=0';
  if (env.NEXO_CATALOGO && !env.NEXOHUB_URL) return 'catálogo de teste (NEXO_CATALOGO) sem um NexoBD de teste (NEXOHUB_URL)';
  return '';
}
const vazia = arq => ({ formato: FORMATO, arquivo: arq, trava: null, ops: [] });
function normaliza(f, arq) {
  const out = vazia(arq);
  if (f && typeof f === 'object') {
    out.trava = f.trava && typeof f.trava === 'object' ? f.trava : null;
    out.ops = Array.isArray(f.ops) ? f.ops.filter(o => o && o.id && (o.acao === 'registra' || o.acao === 'edita')) : [];
  }
  return out;
}
const travaAtiva = f => Boolean(f.trava && Date.parse(f.trava.ate) > Date.now());
const daFila = e => Object.assign(e instanceof Error ? e : new Error(String(e)), { daFila: true });

/* ============================== a fila no NexoBD ============================== */
function noNexoBD(arq, o) {
  o = o || {};
  const NH = require('./nexohub.js');
  const cli = o.cliente || new NH.NexoHub({ timeout: 10000 });
  const chave = chaveDe(arq);
  let id = null;
  const enc = encodeURIComponent;
  async function acha(criar) {
    if (id) return id;
    let it = null;
    try { it = await cli.pede('GET', '/api/v1/chaves/' + enc(SISTEMA) + '/' + enc(chave)); } catch (e) { if (e.status !== 404) throw e; }
    if (it && it.item && !it.id) it = it.item;
    if (it && it.apagado_em) it = null;
    if (!it && criar) {
      try { await cli.pede('POST', '/api/v1/categorias', CATEGORIA); } catch (e) { if (e.status !== 409) throw e; }
      it = await cli.criaItem({ tipo: 'outro', categoria: CATEGORIA.id, nome: 'Fila do catálogo de produtos (NexoEletric)',
        descricao: 'O que o Definir projeto cadastrou ou mudou e ainda não foi gravado na planilha ' + arq + ' (ela estava aberta no Excel)',
        atributos: { programa: 'nexoeletric', arquivo: arq }, chaves: [{ sistema: SISTEMA, chave }] });
    }
    if (it) id = it.id;
    return id;
  }
  return {
    chave,
    async ler(criar) {
      try {
        const i = await acha(criar !== false);
        if (!i) return { rev: 0, fila: vazia(arq) };
        const it = await cli.item(i);
        const a = it.arquivos && it.arquivos[PAPEL];
        if (!a || !it.rev) return { rev: it.rev || 0, fila: vazia(arq) };
        const b = await cli.baixa(i, PAPEL, it.rev);
        let j = null;
        try { j = JSON.parse(b.toString('utf8')); } catch (_) { j = null; }
        return { rev: it.rev, fila: normaliza(j, arq) };
      } catch (e) { throw daFila(e); }
    },
    async gravar(fila, base, nota) {
      let i;
      try { i = await acha(true); } catch (e) { throw daFila(e); }
      const b = Buffer.from(JSON.stringify(fila));
      const sha = crypto.createHash('sha256').update(b).digest('hex');
      try {
        if (!(await cli.temBlob(sha))) await cli.sobeBlob(b, 'fila.json');
        await cli.novaRevisao(i, { arquivos: { [PAPEL]: { sha256: sha, nome: 'fila.json' } }, base, nota: nota || 'fila do catálogo' });
      } catch (e) {
        if (e.status === 409) throw Object.assign(new Error('conflito'), { conflito: true });
        throw daFila(e);
      }
    },
  };
}

/* muda a fila com a revisão lida como base; quem perde a corrida (409) relê e refaz. fn(fila) muda a fila no lugar e
   devolve o resultado; {semMudar:true, valor} = não grava nada */
async function mudar(be, fn, nota) {
  for (let t = 0; t < 15; t++) {
    const { rev, fila } = await be.ler(true);
    const r = await fn(fila);
    if (r && r.semMudar) return r.valor;
    try { await be.gravar(fila, rev, nota); return r; } catch (e) {
      if (!e.conflito) throw e;
      await espera(40 + Math.random() * 120 * (t + 1));
    }
  }
  throw daFila(new Error('a fila do catálogo no NexoBD está muito disputada agora: tente de novo'));
}

/* ============================== a leitura: a planilha com a fila por cima ============================== */
const marca = op => ({ id: op.id, acao: op.acao, estado: op.estado, erro: op.erro || '', por: op.por || null, em: op.criado_em,
  para: op.acao === 'edita' ? op.para : undefined, de: op.acao === 'edita' ? op.de : undefined });
const crua = op => ({ linha: op.linha || null, item: op.item, tipo: op.tipo, nome: op.nome, cliente: op.cliente || '', modelo: op.codigo, vinculo: op.vinculo || '' });
/* -> {itens (os crus da planilha, os da fila com .fila), ultimo (o maior número usado: planilha + fila)} */
function sobrepoe(c, fila) {
  const itens = c.itens.map(i => Object.assign({}, i));
  let ultimo = c.ultimo;
  /* o gravado só vale por cima quando a planilha lida é a cópia de ANTES da gravação (travada); na planilha de verdade ele
     já está (e o que alguém mudou depois no Excel vale) */
  const daCopia = op => Boolean(c.copia && Date.parse(c.copia.de) < Date.parse(op.gravado_em || 0));
  const poe = (alvo, p) => {
    if (p.codigo != null) alvo.modelo = p.codigo;
    if (p.nome != null) alvo.nome = p.nome;
    if (p.tipo != null) alvo.tipo = p.tipo;
  };
  for (const op of fila.ops) {
    if (op.estado === 'descartado') continue;
    if (op.acao === 'registra') {
      ultimo = Math.max(ultimo, Number(op.item) || 0);         /* o número: também os gravados (nunca repete) */
      if (itens.some(i => normCod(i.modelo) === normCod(op.codigo))) continue;      /* já está na planilha */
      if (op.estado === 'gravado') { if (daCopia(op)) itens.push(crua(op)); continue; }
      itens.push(Object.assign(crua(op), { fila: marca(op) }));
    } else {
      const alvo = itens.find(i => i.item === Number(op.item) && normCod(i.modelo) === normCod((op.de || {}).codigo));
      if (!alvo) continue;
      if (op.estado === 'gravado') { if (daCopia(op)) poe(alvo, op.para || {}); continue; }
      if (op.estado === 'pendente') poe(alvo, op.para || {});
      alvo.fila = marca(op);
    }
  }
  return { itens, ultimo };
}
function resumo(fila, c, extra) {
  const ops = fila.ops.filter(o => o.estado !== 'descartado' && o.estado !== 'gravado');
  return Object.assign({ ligada: true, pendentes: ops.filter(o => o.estado === 'pendente').length,
    conflitos: ops.filter(o => o.estado === 'conflito').length, erros: ops.filter(o => o.erro).length,
    travada: Boolean(C.emUso(c.arquivo)), copia: c.copia || null, gravando: travaAtiva(fila) ? fila.trava.maquina : '' }, extra || {});
}

/* a fila lida (sem criar o item no NexoBD) e a planilha; sem o NexoBD, {fila:null, motivo} */
async function leTudo(o) {
  const arq = arquivoDe(o && o.arquivo);
  const off = desligada();
  if (off) return { c: C.abre(arq), fila: null, motivo: off };
  /* a fila ANTES da planilha: o gravador grava a planilha antes de tirar da fila, então nada escapa das duas leituras */
  let fila = null, motivo = '';
  try { fila = (await ((o && o.be) || noNexoBD(arq, o)).ler(false)).fila; } catch (e) {
    if (!e.daFila) throw e;
    motivo = 'o NexoBD (Nexo Hub) não respondeu: ' + e.message;
  }
  return { c: C.abre(arq), fila, motivo };
}

async function lista(o) {
  const { c, fila, motivo } = await leTudo(o);
  if (!fila) return Object.assign(C.listaDe(c, c.itens), { fila: { ligada: false, motivo, travada: Boolean(C.emUso(c.arquivo)), copia: c.copia || null } });
  const { itens, ultimo } = sobrepoe(c, fila);
  return Object.assign(C.listaDe(c, itens, ultimo), { fila: resumo(fila, c) });
}
async function previa(o) {
  o = o || {};
  const { c, fila } = await leTudo(o);
  if (!fila) return C.previaDe(c, c.itens, c.ultimo, o);
  const { itens, ultimo } = sobrepoe(c, fila);
  return C.previaDe(c, itens, ultimo, o);
}
async function busca(o) {
  const cod = normCod(o && o.codigo);
  if (!cod) return { achou: null };
  const { c, fila } = await leTudo(o);
  const itens = fila ? sobrepoe(c, fila).itens : c.itens;
  const num = (/DI\d+$/.exec(cod) || [''])[0];
  const i = itens.find(x => normCod(x.modelo) === cod) || (num && itens.find(x => normCod(x.modelo).endsWith('-' + num))) || null;
  return { achou: i };
}

/* ============================== as mudanças ============================== */
const quem = o => ({ nome: limpa(o && o.por && o.por.nome), login: limpa(o && o.por && o.por.login), maquina: maquina() });
function semFila(e, fn) {
  try { return Object.assign(fn(), { fila: null, pendente: false }); } catch (e2) {
    if (e2.travado) throw new Error('a planilha está aberta em outro programa (Excel?) e o NexoBD (Nexo Hub) não respondeu (' + e.message + '): sem a fila, não dá para gravar agora — confira o Nexo Hub ou feche a planilha');
    throw e2;
  }
}
/* o resultado de uma op para quem pediu, depois da tentativa de gravar */
async function depois(be, arq, op) {
  let g = null;
  try { g = await grava({ arquivo: arq, be }); } catch (e) { g = { erro: e.message }; }
  const r = (g && g.ops && g.ops[op.id]) || null;
  const estado = r ? r.estado : op.estado;
  return { pendente: estado !== 'gravado', fila: { id: op.id, acao: op.acao, estado, erro: (r && r.erro) || '', por: op.por || null, em: op.criado_em, travada: Boolean(g && g.travada), gravando: (g && g.ocupado) || '' }, linha: (r && r.linha) || null };
}

/* registra (como catalogo.js » registra): {nome, tipo, cliente, vinculo, sigla, por:{nome, login}, arquivo?}
   -> {item, codigo, sigla, ano, nome, tipo, linha, pendente, fila:{id, estado, erro}} */
async function registra(o) {
  o = o || {};
  const arq = arquivoDe(o.arquivo);
  if (desligada()) return Object.assign(C.registra(Object.assign({}, o, { arquivo: arq })), { fila: null, pendente: false });
  const be = o.be || noNexoBD(arq, o);
  let c = null, op;
  try {
    op = await mudar(be, async fila => {
      c = C.abre(arq);
      const { itens, ultimo } = sobrepoe(c, fila);
      const d = C.novoRegistro(itens, o, c.ano, ultimo + 1);
      const nova = Object.assign({ id: novoId(), acao: 'registra', estado: 'pendente', criado_em: agora(), por: quem(o), tentativas: 0 }, d);
      fila.ops.push(nova);
      return nova;
    }, 'cadastro ' + limpa(o.nome).toUpperCase());
  } catch (e) {
    if (!e.daFila) throw e;
    return semFila(e, () => C.registra(Object.assign({}, o, { arquivo: arq })));
  }
  const r = await depois(be, arq, op);
  return Object.assign({ item: op.item, codigo: op.codigo, sigla: op.sigla, ano: op.ano, nome: op.nome, tipo: op.tipo, arquivo: c.arquivo }, r);
}

/* edita (como catalogo.js » edita): {item, codigo (o de agora), nome?, tipo? (o que a pessoa viu: outra pessoa mudou antes
   -> recusa na hora), novoCodigo?, novoNome?, novoGrupo?, por} -> {item, codigo, nome, tipo, grupo, pendente, fila} */
async function edita(o) {
  o = o || {};
  const arq = arquivoDe(o.arquivo);
  if (desligada()) return Object.assign(C.edita(Object.assign({}, o, { arquivo: arq })), { fila: null, pendente: false });
  const be = o.be || noNexoBD(arq, o);
  let res;
  try {
    res = await mudar(be, async fila => {
      const c = C.abre(arq);
      const { itens } = sobrepoe(c, fila);
      const it = itens.find(i => i.item === Number(o.item) && normCod(i.modelo) === normCod(o.codigo));
      if (!it) throw Object.assign(new Error('o item ' + o.item + ' (' + (o.codigo || '?') + ') não está mais no catálogo assim (outra pessoa mudou agora há pouco?): abra de novo o Definir projeto'), { conflito: true });
      if (o.nome != null && limpa(o.nome).toUpperCase() !== limpa(it.nome).toUpperCase())
        throw Object.assign(new Error('outra pessoa mudou o nome do item ' + it.item + ' agora há pouco: está "' + it.nome + '" (você viu "' + limpa(o.nome) + '"): confira e tente de novo'), { conflito: true });
      if (o.tipo != null && limpa(o.tipo).toUpperCase() !== limpa(it.tipo).toUpperCase())
        throw Object.assign(new Error('outra pessoa mudou a categoria do item ' + it.item + ' agora há pouco: está "' + it.tipo + '": confira e tente de novo'), { conflito: true });
      const m = C.validaEdicao(itens, it, o);
      const pend = it.fila && it.fila.acao === 'registra' && it.fila.estado === 'pendente' && !travaAtiva(fila) ? fila.ops.find(x => x.id === it.fila.id) : null;
      if (pend) {
        /* o cadastro ainda não foi para a planilha: muda nele mesmo (uma linha só, já com o valor novo) */
        if (m.codigo != null) pend.codigo = m.codigo;
        if (m.nome != null) pend.nome = m.nome;
        if (m.tipo != null) pend.tipo = m.tipo;
        pend.editado_em = agora();
        return { op: pend, it, m };
      }
      const de = {};
      for (const k of Object.keys(m)) de[k] = k === 'codigo' ? it.modelo : it[k];
      if (de.codigo == null) de.codigo = it.modelo;            /* a linha é achada pelo item + o código de agora */
      const nova = { id: novoId(), acao: 'edita', estado: 'pendente', criado_em: agora(), por: quem(o), tentativas: 0, item: it.item, de, para: m };
      fila.ops.push(nova);
      return { op: nova, it, m };
    }, 'edição do item ' + o.item);
  } catch (e) {
    if (!e.daFila) throw e;
    return semFila(e, () => C.edita(Object.assign({}, o, { arquivo: arq })));
  }
  const r = await depois(be, arq, res.op);
  const tipo = res.m.tipo != null ? res.m.tipo : res.it.tipo;
  return Object.assign({ item: res.it.item, codigo: res.m.codigo != null ? res.m.codigo : res.it.modelo, nome: res.m.nome != null ? res.m.nome : res.it.nome,
    tipo, grupo: C.grupo(tipo) }, r);
}

/* o que fazer com uma op em conflito (ou pendente): {id, como: 'descartar' | 'tentar' | 'por-cima', por} */
async function resolve(o) {
  o = o || {};
  const arq = arquivoDe(o.arquivo);
  if (desligada()) throw new Error('a fila do catálogo está desligada aqui (' + desligada() + ')');
  const be = o.be || noNexoBD(arq, o);
  const op = await mudar(be, async fila => {
    const x = fila.ops.find(y => y.id === String(o.id || ''));
    if (!x) throw new Error('essa mudança não está mais na fila');
    if (x.estado === 'gravado') throw new Error('essa mudança já foi gravada na planilha');
    if (o.como === 'descartar') {
      if (x.estado === 'pendente' && travaAtiva(fila)) throw new Error('a máquina ' + fila.trava.maquina + ' está gravando a planilha agora: tente de novo em instantes');
      Object.assign(x, { estado: 'descartado', descartado_em: agora(), descartado_por: quem(o) });
    } else if (o.como === 'tentar' || o.como === 'por-cima') {
      if (o.como === 'por-cima' && x.acao !== 'edita') throw new Error('"gravar por cima" é de uma edição');
      Object.assign(x, { estado: 'pendente', erro: '' });
      if (o.como === 'por-cima') x.forcar = true;
    } else throw new Error('como resolver? descartar, tentar ou por-cima');
    return x;
  }, 'fila: ' + o.como + ' ' + o.id);
  if (op.estado === 'pendente') return Object.assign({ id: op.id }, await depois(be, arq, op));
  return { id: op.id, estado: op.estado, pendente: false };
}

/* ============================== o gravador ============================== */
const igual = (a, b) => limpa(a).toUpperCase() === limpa(b).toUpperCase();
function poda(fila) {
  const t = Date.now();
  const velho = op => (op.estado === 'gravado' || op.estado === 'descartado') && t - Date.parse(op.gravado_em || op.descartado_em || op.criado_em) > GUARDA_MS;
  fila.ops = fila.ops.filter(op => !velho(op));
  const feitos = fila.ops.filter(op => op.estado === 'gravado' || op.estado === 'descartado');
  if (feitos.length > MAX_GUARDADOS) { const fora = new Set(feitos.slice(0, feitos.length - MAX_GUARDADOS).map(x => x.id)); fila.ops = fila.ops.filter(op => !fora.has(op.id)); }
}
/* uma op aplicada no catálogo em memória: {c, r: {estado, erro?, linha?}, gravar: texto que a planilha tem de ter} */
function aplica(c, op) {
  if (op.acao === 'registra') {
    const ja = c.itens.find(i => normCod(i.modelo) === normCod(op.codigo));
    if (ja) return { c, r: { estado: 'gravado', linha: ja.linha, nota: 'já estava na planilha' } };
    const mesmo = c.itens.find(i => i.item === Number(op.item));
    if (mesmo) return { c, r: { estado: 'conflito', erro: 'o item ' + op.item + ' já foi usado na planilha por ' + mesmo.modelo + ' (' + mesmo.nome + ') — cadastrado direto no Excel? ' + op.codigo + ' não foi gravado: descarte e cadastre de novo' } };
    const { xml, linha } = C.acrescenta(c, { item: Number(op.item), tipo: op.tipo, nome: op.nome, cliente: op.cliente || '', codigo: op.codigo, vinculo: op.vinculo || '' });
    return { c: C.refaz(c, xml), r: { estado: 'gravado', linha }, gravar: op.codigo };
  }
  const de = op.de || {}, para = op.para || {};
  const valor = (i, k) => (k === 'codigo' ? i.modelo : i[k]);
  let it = c.itens.find(i => i.item === Number(op.item) && normCod(i.modelo) === normCod(de.codigo));
  if (!it) {
    const feito = c.itens.find(i => i.item === Number(op.item) && Object.keys(para).every(k => igual(valor(i, k), para[k])));
    if (feito) return { c, r: { estado: 'gravado', linha: feito.linha, nota: 'já estava assim na planilha' } };
    const agoraE = c.itens.filter(i => i.item === Number(op.item)).map(i => i.modelo).join(', ');
    return { c, r: { estado: 'conflito', erro: 'na planilha o item ' + op.item + ' não tem mais o código ' + de.codigo + (agoraE ? ' (agora: ' + agoraE + ')' : ' (a linha sumiu)') + ' — alguém mudou direto no Excel' } };
  }
  const m = {}, dif = [];
  for (const k of Object.keys(para)) {
    const atual = valor(it, k);
    if (igual(atual, para[k])) continue;
    if (!op.forcar && de[k] != null && !igual(atual, de[k])) dif.push((k === 'codigo' ? 'o código' : k === 'nome' ? 'o nome' : 'a categoria') + ' está "' + atual + '" (era "' + de[k] + '" quando pediram "' + para[k] + '")');
    m[k] = para[k];
  }
  if (dif.length) return { c, r: { estado: 'conflito', erro: 'na planilha ' + dif.join('; ') + ' — alguém mudou direto no Excel ou em outra máquina' } };
  if (m.codigo != null) {
    const outro = c.itens.find(i => i !== it && normCod(i.modelo) === normCod(m.codigo));
    if (outro) return { c, r: { estado: 'conflito', erro: 'o código ' + m.codigo + ' já é do item ' + outro.item + ' na planilha' } };
  }
  if (!Object.keys(m).length) return { c, r: { estado: 'gravado', linha: it.linha, nota: 'já estava assim na planilha' } };
  return { c: C.refaz(c, C.mudaLinha(c, it, m)), r: { estado: 'gravado', linha: it.linha }, gravar: m.codigo != null ? m.codigo : m.nome != null ? m.nome : m.tipo };
}

/* grava as pendentes na planilha (uma máquina por vez). -> {nada} | {travada} | {ocupado: maquina} |
   {gravados, conflitos, erros, ops: {id: {estado, erro?, linha?}}} */
async function grava(o) {
  o = o || {};
  const arq = arquivoDe(o.arquivo);
  const off = desligada();
  if (off) return { desligada: off };
  const be = o.be || noNexoBD(arq, o);
  const { fila } = await be.ler(false);
  if (!fila.ops.some(op => op.estado === 'pendente')) return { nada: true };
  if (C.emUso(arq)) return { travada: true, pendentes: fila.ops.filter(op => op.estado === 'pendente').length };
  const eu = { maquina: maquina(), pid: process.pid, token: novoId() };
  const pegou = await mudar(be, async f => {
    if (travaAtiva(f) && f.trava.token !== eu.token) return { semMudar: true, valor: false };
    f.trava = Object.assign({}, eu, { desde: agora(), ate: new Date(Date.now() + TRAVA_MS).toISOString() });
    return true;
  }, 'trava do gravador (' + eu.maquina + ')');
  if (!pegou) { const { fila: f } = await be.ler(false); return { ocupado: (f.trava && f.trava.maquina) || '?' }; }
  const solta = () => mudar(be, async f => {
    if (!(f.trava && f.trava.token === eu.token)) return { semMudar: true, valor: false };
    f.trava = null; return true;
  }, 'trava solta').catch(() => false);
  const res = {};
  let travou = false;
  try {
    const { fila: f2 } = await be.ler(false);                /* as pendentes de agora, com a trava na mão */
    const pend = f2.ops.filter(op => op.estado === 'pendente');
    if (!pend.length) { await solta(); return { nada: true }; }   /* outra máquina gravou antes de a trava vir para cá */
    let c;
    try { c = C.abre(arq, { semCopia: true }); } catch (e) {
      if (e.travado) { travou = true; throw e; }
      for (const op of pend) res[op.id] = { estado: 'pendente', erro: 'não gravou na planilha: ' + e.message };
      c = null;
    }
    if (c) {
      const textos = [], feitos = [];
      for (const op of pend) {
        try {
          const a = aplica(c, op);
          c = a.c; res[op.id] = a.r;
          if (a.gravar != null) { textos.push(a.gravar); feitos.push(op); }
        } catch (e) { res[op.id] = { estado: 'pendente', erro: 'não gravou na planilha: ' + e.message }; }
      }
      if (textos.length) {
        try { C.gravaPlanilha(c, c.xml, textos); } catch (e) {
          for (const op of feitos) res[op.id] = e.travado ? null : { estado: 'pendente', erro: 'não gravou na planilha: ' + e.message };
          if (e.travado) travou = true;
        }
        if (!travou) {
          /* confere relendo: só sai da fila o que está mesmo na planilha */
          let v = null;
          try { v = C.abre(arq, { semCopia: true }); } catch (_) { v = null; }
          for (const op of feitos) {
            if (!res[op.id] || res[op.id].estado !== 'gravado') continue;
            const ok = v && (op.acao === 'registra' ? v.itens.some(i => normCod(i.modelo) === normCod(op.codigo))
              : v.itens.some(i => i.item === Number(op.item) && Object.keys(op.para || {}).every(k => igual(k === 'codigo' ? i.modelo : i[k], op.para[k]))));
            if (!ok) res[op.id] = { estado: 'pendente', erro: 'gravei, mas a conferência não achou a mudança na planilha: tento de novo' };
          }
        }
      }
    }
    await mudar(be, async f => {
      for (const op of f.ops) {
        const r = res[op.id];
        if (!r || op.estado !== 'pendente') continue;
        op.tentativas = (op.tentativas || 0) + 1; op.tentado_em = agora();
        if (r.estado === 'gravado') { Object.assign(op, { estado: 'gravado', gravado_em: agora(), gravado_por: eu.maquina, linha: r.linha || op.linha || null }); delete op.erro; delete op.forcar; }
        else if (r.estado === 'conflito') Object.assign(op, { estado: 'conflito', erro: r.erro });
        else if (r.erro) op.erro = r.erro;
      }
      if (f.trava && f.trava.token === eu.token) f.trava = null;
      poda(f);
      return true;
    }, 'gravador (' + eu.maquina + ')');
  } catch (e) {
    await solta();
    if (travou || e.travado) return { travada: true };
    throw e;
  }
  const lst = Object.values(res).filter(Boolean);
  return { gravados: lst.filter(r => r.estado === 'gravado').length, conflitos: lst.filter(r => r.estado === 'conflito').length,
           erros: lst.filter(r => r.erro && r.estado === 'pendente').length, travada: travou, ops: res };
}

/* a fila como está (o painel e os testes) */
async function estado(o) {
  const { c, fila, motivo } = await leTudo(o);
  if (!fila) return { ligada: false, motivo };
  return Object.assign(resumo(fila, c), { trava: fila.trava, ops: fila.ops.map(op => Object.assign({}, op)) });
}

module.exports = { SISTEMA, FORMATO, TRAVA_MS, chaveDe, desligada, noNexoBD, sobrepoe, lista, previa, busca, registra, edita, resolve, grava, estado, aplica };
