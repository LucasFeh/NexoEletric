'use strict';
// "Importar do servidor": traz para a pasta de trabalho local os projetos e as bibliotecas
// do hub central (http://192.168.15.192:8100), pelas mesmas rotas que o navegador usa.
//
// O servidor nao lista diretorio (hubserver.py » _serve devolve 404 para pasta), entao a
// lista de arquivos e montada a partir do que ele publica:
//   - projetos: /api/index.json + os nomes de arquivo que os .pas e o hub escrevem;
//   - bibliotecas do almoxarifado: as chaves "Libs/Almox/..." de Libs/lib-ledger.json »
//     arquivos (o almox-index.js NAO as lista: medido, ele traz nomes legados).
//
// Tres vias, por arquivo: L (local), R (servidor) e B (a base = o que veio do servidor na
// importacao anterior, o que o instalador semeou, ou o que o espelho da biblioteca do
// servidor gravou por ultimo em Libs/). Assim se sabe QUEM mudou:
//   L == R            nada a fazer
//   L == B            so o servidor mudou       -> traz
//   R == B            so o local mudou          -> fica o local
//   os dois mudaram   conflito                  -> depende do grupo:
//     'almox'   o servidor VENCE e o local vai para .altiumhub/backup/<data>/. E o
//               livro-razao dos part numbers: duas autoridades renumeram o almoxarifado.
//     'projeto', 'lib'  o LOCAL fica e a versao do servidor vai para
//               .altiumhub/conflitos/<data>/, e o resumo lista cada um. Nada do trabalho
//               de ninguem some calado.
//
// Com a biblioteca do servidor (1.2.0, lib/lib-remota.js), os grupos 'libs' e 'almox' nao
// chegam aqui: o processo principal os recusa, porque o espelho do hubserver cuida desses
// arquivos. Ficam 'projetos' e 'almoxLibs' (Libs/Almox, que o Altium le e o espelho nao traz).
// Desligada a caixa, eles voltam -- e o que o espelho deixou no disco conta como base.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { MARCA_DIR } = require('./workspace');
const { gravadosPeloEspelho } = require('./lib-remota');

// Arquivos de um projeto, pelos nomes que ExportBoard/ExportProject/BuildSchematic/
// ApplyChanges e o hubserver escrevem. Ficam de fora os de BANCADA do servidor
// (bom-vistos.json, bom-opts.json, odoo-lista.json): sao estado de quem monta a placa la.
const ARQ_PROJETO = ['board.js', 'schematic.js', 'changes.js', 'annotations.js', 'pcb-list.csv',
  'history.jsonl', 'build-report.txt', 'apply-report.txt'];

// O indice classico dos projetos (hub-classic.html), que os scripts do Altium reescrevem. Vem
// com os projetos, e nao com as bibliotecas: com a biblioteca do servidor o grupo 'libs' nao
// existe mais (lib/lib-remota.js), e o indice deixaria de chegar.
const ARQ_INDICE = ['projects.js'];

// Estado do almoxarifado: o que o gerador (tools/almox, tools/symbols/guardiao.py) LE antes de
// numerar. Semear isto do servidor antes de sincronizar localmente e o que evita a
// numeracao de dois PCs divergir (Libs/almox-parts.json: "perder renumera tudo").
const ARQ_ALMOX = ['Libs/almox-parts.json', 'Libs/lib-ledger.json', 'Libs/almox-excluidos.json',
  'Libs/almox-basicos.js', 'Libs/almox-especiais.js', 'Libs/almox-index.js', 'Libs/almox-sync.js',
  'Libs/almox-guardiao.js', 'tools/almox/componentes_odoo.csv'];

// Bibliotecas publicadas (espelhos do Altium, lib da casa, substituicoes).
const ARQ_LIB = ['Libs/schlib.js', 'Libs/pcblib.js', 'Libs/symbols-lib.js', 'Libs/rename-map.js',
  'Libs/lib-subs.js', 'Libs/libs-report.txt', 'Libs/BIBLIOTECA DE ESQUEMA.SchLib'];

// Fora a lista do ledger, o que o gerador escreve em Libs/Almox (almox2lib.py, dblib.py).
const ARQ_ALMOX_DIR_FIXOS = ['Libs/Almox/FOOTPRINTS ALMOX.PcbLib', 'Libs/Almox/ALMOX.DbLib',
  'Libs/Almox/almox.sqlite', 'Libs/Almox/almox.csv'];

const TIMEOUT_MS = 30000;
const PARALELO = 4;

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function sha1File(f) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
  } catch {
    return null;
  }
}

function carimbo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function urlDe(base, rel) {
  return base.replace(/\/+$/, '') + '/' + rel.split('/').map(encodeURIComponent).join('/');
}

// O limite e de INATIVIDADE (30 s sem chegar um byte), nao do arquivo inteiro: a PcbLib do
// almoxarifado tem 63 MB e, num Wi-Fi ou VPN abaixo de ~17 Mbit/s, um teto fixo de 30 s a
// cortaria sempre. Servidor mudo continua sendo pego do mesmo jeito.
async function pega(url, { etag, signal } = {}) {
  const ctl = new AbortController();
  let t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const renova = () => { clearTimeout(t); t = setTimeout(() => ctl.abort(), TIMEOUT_MS); };
  const aborta = () => ctl.abort();
  if (signal) signal.addEventListener('abort', aborta, { once: true });
  try {
    const headers = {};
    if (etag) headers['If-None-Match'] = etag;
    const res = await fetch(url, { headers, signal: ctl.signal, redirect: 'error' });
    renova();
    if (res.status === 304) return { status: 304 };
    if (res.status === 404) return { status: 404 };
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    const partes = [];
    const leitor = res.body.getReader();
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      partes.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
      renova();
    }
    const buf = Buffer.concat(partes);
    return {
      status: 200,
      buf,
      etag: res.headers.get('etag') || '',
      lastModified: res.headers.get('last-modified') || '',
    };
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', aborta);
  }
}

// O servidor responde? E e mesmo um hub? (/__live.js e o batimento dele.)
async function testar(serverUrl) {
  try {
    const r = await pega(urlDe(serverUrl, '__live.js'));
    if (r.status !== 200 || !/EventSource/.test(r.buf.toString('utf8'))) {
      return { ok: false, erro: 'respondeu, mas nao parece o hub do AltiumPCBMirror' };
    }
    const idx = await pega(urlDe(serverUrl, 'api/index.json'));
    const n = idx.status === 200 ? (JSON.parse(idx.buf.toString('utf8')).projects || []).length : 0;
    return { ok: true, projetos: n };
  } catch (e) {
    return { ok: false, erro: e.name === 'AbortError' ? 'sem resposta em 30 s' : e.message };
  }
}

class Estado {
  constructor(ws) {
    this.arq = path.join(ws, MARCA_DIR, 'import-state.json');
    try {
      this.d = JSON.parse(fs.readFileSync(this.arq, 'utf8'));
    } catch {
      this.d = {};
    }
    this.d.files = this.d.files || {};
  }
  get(rel) { return this.d.files[rel] || null; }
  set(rel, v) { this.d.files[rel] = v; }
  salvar(extra) {
    Object.assign(this.d, extra || {});
    fs.mkdirSync(path.dirname(this.arq), { recursive: true });
    fs.writeFileSync(this.arq + '.tmp', JSON.stringify(this.d, null, 1));
    fs.renameSync(this.arq + '.tmp', this.arq);
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Troca atomica, com paciencia para trava passageira: o hub desta maquina le board.js e
// schematic.js a cada recarga (e cada arquivo importado provoca uma), o Altium, o driver
// ODBC (almox.sqlite) e o antivirus seguram arquivos por instantes. EPERM/EBUSY no rename
// quase sempre e isso; so desiste depois de algumas tentativas, e sem deixar o .tmp.
async function escreveAtomico(dest, buf, lastModified) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.altiumhub-tmp';
  fs.writeFileSync(tmp, buf);
  for (let n = 0; ; n++) {
    try {
      fs.renameSync(tmp, dest);
      break;
    } catch (e) {
      if (n < 5 && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { await esperar(150 * (n + 1)); continue; }
      try { fs.rmSync(tmp, { force: true }); } catch { /* segue */ }
      throw e;
    }
  }
  // A data do servidor, e nao "agora": o hub decide o que esta pendente comparando mtimes
  // (changes.js mais novo que apply-report.txt = mudancas por aplicar, hubserver.py »
  // build_index; schematic.js x board.js no BOM). Importar tudo com a hora da copia
  // inventaria pendencia onde nao ha.
  const t = Date.parse(lastModified);
  if (Number.isFinite(t)) {
    try { fs.utimesSync(dest, new Date(), new Date(t)); } catch { /* data e conforto */ }
  }
}

// Caminho vindo do SERVIDOR (nome de projeto do /api/index.json, chave do lib-ledger.json):
// cada pedaco tem de ser um nome que o Windows representa. Um servidor Linux aceita
// "Placa: rev2" (no NTFS o ":" vira fluxo alternativo), "Proj." (o Python le "Proj") e
// CON/AUX; e ".." nunca pode virar caminho aqui.
function relSeguro(rel) {
  const partes = rel.split('/');
  return partes.every((p) => p && p !== '.' && p !== '..' &&
    !/[<>:"|?*\\\x00-\x1f]/.test(p) && !/[. ]$/.test(p) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p));
}

// Os .js importados sao DADOS que o hub carrega com <script src> (hub.html » loadVarScript,
// schframe.html, pcbframe.html). Um arquivo do servidor com codigo dentro rodaria AQUI, na
// origem do hub local -- que le o hub-almox.json com a senha do Odoo deste PC e fala com o
// chat. E o /api/save do servidor grava Libs/lib-subs.js e Projects/*/annotations.js sem
// senha, para qualquer maquina da rede. Entao so entra o formato que o hub escreve:
// `var <nome conhecido> = <JSON>;` (comentarios // em linha propria e virgula antes de ] ou }
// sao aceitos, como no load_var_file do hubserver.py). O nome e fixo de proposito:
// `var location = "javascript:..."` e JSON valido depois do "=" e navegaria a pagina.
const VARS_DE_DADOS = new Set(['pcbmirror', 'schematic', 'changes', 'annotations', 'schlib', 'pcblib',
  'symbolsLib', 'renameMap', 'libSubs', 'projects', 'almoxIndex', 'almoxSync', 'almoxBasicos',
  'almoxEspeciais', 'almoxGuardiao']);

function recusaDeDado(rel, buf) {
  if (!rel.endsWith('.js')) return '';
  // O comentario // do JS acaba em \n, \r, U+2028 ou U+2029, e nao so no \n: com
  // "// nota\rwindow.x=1" o navegador executa o que vem depois do \r. Entao o comentario sai so
  // ate o primeiro desses terminadores, e o resto da linha fica para cair no JSON invalido
  // (mesma regra do libremota.py \u00bb recusa).
  const s = buf.toString('utf8').replace(/^\ufeff/, '')
    .replace(/^[ \t]*\/\/[^\n\r\u2028\u2029]*(\r?\n|$)/gm, '');
  const m = /^\s*var\s+([A-Za-z_$][\w$]*)\s*=/.exec(s);
  if (!m || !VARS_DE_DADOS.has(m[1])) return 'nao e um arquivo de dados do hub (var <nome> = ...)';
  const corpo = s.slice(m[0].length).trim().replace(/;[\s;]*$/, '').trim().replace(/,\s*([\]}])/g, '$1');
  try {
    JSON.parse(corpo);
    return '';
  } catch {
    return 'o conteudo nao e JSON puro (tem codigo)';
  }
}

// Pos-processamento de arquivo que o servidor escreve para a MAQUINA dele. A funcao de
// substituicao (e nao a string "$1...") e de proposito: um caminho com "$" dentro
// (D:\hub$1\...) viraria referencia de grupo.
function ajustar(rel, buf, ctx) {
  if (rel === 'Libs/Almox/ALMOX.DbLib') {
    // O DbLib aponta o SQLite por caminho absoluto (dblib.py » UNC). Vindo do servidor, ele
    // aponta o share; aqui ele tem de apontar a copia local, senao o Altium desta maquina
    // le a tabela do servidor.
    const local = path.join(ctx.ws, 'Libs', 'Almox', 'almox.sqlite');
    const txt = buf.toString('utf8').replace(/(Database=)[^;\r\n]*(;)/, (_m, a, b) => a + local + b);
    return Buffer.from(txt, 'utf8');
  }
  if (rel === 'Libs/almox-index.js') {
    // O link "Odoo ↗" usa o odooUrl do indice. Se o servidor gravou o Odoo como loopback
    // (o compose roda em rede do host), aqui o loopback seria ESTE PC.
    const host = new URL(ctx.serverUrl).hostname;
    const txt = buf.toString('utf8').replace(/http:\/\/(127\.0\.0\.1|localhost)(:\d+)/g,
      (_m, _h, porta) => `http://${host}${porta}`);
    return Buffer.from(txt, 'utf8');
  }
  return buf;
}

// Do que o ajuste dependeu: se a pasta de trabalho mudou de lugar, o DbLib local aponta o
// SQLite antigo -- o 304 do ETag nao pode deixa-lo assim.
function chaveAjuste(rel, ctx) {
  if (rel === 'Libs/Almox/ALMOX.DbLib') return path.join(ctx.ws, 'Libs', 'Almox', 'almox.sqlite');
  if (rel === 'Libs/almox-index.js') return new URL(ctx.serverUrl).hostname;
  return '';
}

// O ledger que diz QUAIS arquivos de Libs/Almox o servidor tem. Com o grupo almox nesta mesma
// importacao, e o local, que acabou de vir de la. Sem ele (biblioteca do servidor, em que o
// grupo nao existe, ou a caixa desmarcada), o local pode ser a semente do instalador ou o
// espelho de antes do ultimo sincronismo, e a lista sairia velha: le o do servidor em
// memoria, sem gravar nada (quem grava o Libs/lib-ledger.json e o espelho do hub). Servidor
// sem o ledger ou com um que nao parseia: fica o local, como antes.
async function ledgerDaLista(ws, serverUrl, comAlmox, signal) {
  if (!comAlmox) {
    try {
      const r = await pega(urlDe(serverUrl, 'Libs/lib-ledger.json'), { signal });
      if (r.status === 200) return JSON.parse(r.buf.toString('utf8'));
    } catch { /* cai no local */ }
  }
  try {
    return JSON.parse(fs.readFileSync(path.join(ws, 'Libs', 'lib-ledger.json'), 'utf8'));
  } catch {
    return null;                          // sem ledger: so os fixos
  }
}

async function comLimite(itens, n, fn) {
  let i = 0;
  const trab = Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length) {
      const k = i++;
      await fn(itens[k], k);
    }
  });
  await Promise.all(trab);
}

/**
 * @param {object} o
 * @param {string} o.ws            pasta de trabalho
 * @param {string} o.serverUrl     hub central
 * @param {string[]} o.grupos      subconjunto de ['projetos','libs','almox','almoxLibs']
 * @param {object} o.seedHashes    {rel: sha1 | sha1[]} do que o app semeou (base de 3 vias; o
 *                                 que o espelho da biblioteca do servidor gravou e lido aqui)
 * @param {(ev:object)=>void} o.progresso
 * @param {AbortSignal} [o.signal]
 */
async function importar(o) {
  const { ws, serverUrl, progresso = () => {}, signal } = o;
  if (!ws || !path.isAbsolute(ws)) throw new Error('pasta de trabalho invalida: ' + ws);
  const grupos = new Set(o.grupos || ['projetos', 'libs', 'almox', 'almoxLibs']);
  const estado = new Estado(ws);
  const quando = carimbo();
  const res = { novos: [], atualizados: [], mantidos: [], conflitos: [], backups: [], erros: [], iguais: 0, ausentes: 0, bytes: 0 };
  const ctx = { ws, serverUrl };
  const seed = o.seedHashes || {};
  // Lido aqui, e nao pelo chamador: a base tem de conhecer o espelho em todo caminho que
  // importa (a tela, o guarda antes do sincronismo). Ver lib/lib-remota.js » gravadosPeloEspelho.
  const espelho = gravadosPeloEspelho(ws);
  const semeados = (rel) => [].concat(seed[rel] || [], espelho[rel] || []);

  progresso({ fase: 'lista', msg: `consultando ${serverUrl}` });
  const lista = [];                      // [{rel, grupo}]
  if (grupos.has('projetos')) {
    const idx = await pega(urlDe(serverUrl, 'api/index.json'), { signal });
    if (idx.status !== 200) throw new Error('o servidor nao devolveu /api/index.json');
    const projetos = JSON.parse(idx.buf.toString('utf8')).projects || [];
    const vistos = new Set();
    for (const p of projetos) {
      const n = p && p.name;
      if (!n) continue;
      if (!relSeguro(`Projects/${n}`)) {
        res.erros.push(`Projects/${n}: nome que o Windows nao representa; renomeie no servidor`);
        continue;
      }
      // PAEL e pael sao a mesma pasta no NTFS: um dos dois seria conflito para sempre
      if (vistos.has(n.toLowerCase())) {
        res.erros.push(`Projects/${n}: repete outro projeto mudando so maiusculas/minusculas; renomeie no servidor`);
        continue;
      }
      vistos.add(n.toLowerCase());
      for (const f of ARQ_PROJETO) lista.push({ rel: `Projects/${n}/${f}`, grupo: 'projeto' });
    }
    for (const rel of ARQ_INDICE) lista.push({ rel, grupo: 'projeto' });
  }
  if (grupos.has('libs')) for (const rel of ARQ_LIB) lista.push({ rel, grupo: 'lib' });
  if (grupos.has('almox')) for (const rel of ARQ_ALMOX) lista.push({ rel, grupo: 'almox' });

  const processa = async ({ rel, grupo }) => {
    if (signal && signal.aborted) return;
    const dest = path.join(ws, ...rel.split('/'));
    const base = estado.get(rel);
    const aj = chaveAjuste(rel, ctx);
    let L = sha1File(dest);
    // ETag so quando o local ainda e o que veio do servidor (e o ajuste local nao mudou de
    // contexto): e o que permite pular os 70 MB de Libs/Almox sem baixar nada.
    const etag = base && L && L === (base.localSha1 || base.sha1) && (base.ajuste || '') === aj ? base.etag : '';
    let r;
    try {
      r = await pega(urlDe(serverUrl, rel), { etag, signal });
    } catch (e) {
      const porque = e.name === 'AbortError' ? (signal && signal.aborted ? 'cancelado' : 'tempo esgotado') : e.message;
      res.erros.push(`${rel}: ${porque}`);
      return;
    }
    if (r.status === 304) { res.iguais++; return; }
    if (r.status === 404) { res.ausentes++; return; }
    const buf = ajustar(rel, r.buf, ctx);
    const recusa = recusaDeDado(rel, buf);
    if (recusa) {
      // sem registra(): na proxima importacao o arquivo e conferido de novo
      res.erros.push(`${rel}: recusado, ${recusa}; ficou o arquivo local`);
      return;
    }
    const R = sha1(r.buf);                // o hash do SERVIDOR (antes do ajuste local)
    const Rl = sha1(buf);                 // o que fica no disco daqui
    res.bytes += r.buf.length;
    // O local pode ter mudado DURANTE o download (um Salvar do hub, um export do Altium).
    // Daqui ate a decisao nao ha await: ela usa o disco de agora.
    L = sha1File(dest);
    const B = base ? (base.localSha1 || base.sha1) : null;
    // Igual a algo que o proprio app semeou (esta versao ou uma anterior), ou ao que o espelho
    // da biblioteca do servidor gravou por ultimo = ninguem mexeu.
    const intocado = Boolean(L && ((B && L === B) || semeados(rel).includes(L)));
    const registra = () => estado.set(rel, { sha1: R, localSha1: Rl, etag: r.etag, em: quando, ajuste: aj });

    try {
      if (!L) {
        await escreveAtomico(dest, buf, r.lastModified);
        res.novos.push(rel);
        registra();
      } else if (L === Rl) {
        res.iguais++;
        registra();
      } else if (intocado) {
        await escreveAtomico(dest, buf, r.lastModified);
        res.atualizados.push(rel);
        registra();
      } else if (base && R === base.sha1) {
        res.mantidos.push(rel);             // so o local mudou: fica
      } else if (grupo === 'almox') {
        const bk = path.join(ws, MARCA_DIR, 'backup', quando, ...rel.split('/'));
        fs.mkdirSync(path.dirname(bk), { recursive: true });
        fs.copyFileSync(dest, bk);
        res.backups.push(rel);              // o backup existe, mesmo que a troca falhe
        await escreveAtomico(dest, buf, r.lastModified);
        res.atualizados.push(rel);
        registra();
      } else {
        const cf = path.join(ws, MARCA_DIR, 'conflitos', quando, ...rel.split('/'));
        fs.mkdirSync(path.dirname(cf), { recursive: true });
        fs.writeFileSync(cf, buf);
        res.conflitos.push(rel);
      }
    } catch (e) {
      // Um arquivo que nao deu para gravar custa UM arquivo, nao a importacao inteira: os
      // outros trabalhadores seguiriam gravando sem ninguem esperar por eles.
      res.erros.push(`${rel}: ${e.code || e.message}`);
    }
  };

  let feitos = 0;
  const total = () => lista.length;
  const um = async (item) => {
    progresso({ fase: 'arquivo', rel: item.rel, feitos, total: total() });
    await processa(item);
    feitos++;
    progresso({ fase: 'arquivo', rel: item.rel, feitos, total: total() });
  };
  try {
    await comLimite(lista, PARALELO, um);

    // A lista de Libs/Almox so e conhecida depois do lib-ledger.json (grupo almox) chegar.
    if (grupos.has('almoxLibs') && !(signal && signal.aborted)) {
      const ledger = await ledgerDaLista(ws, serverUrl, grupos.has('almox'), signal);
      const extra = new Set(ARQ_ALMOX_DIR_FIXOS);
      for (const k of Object.keys((ledger && ledger.arquivos) || {})) {
        if (!k.startsWith('Libs/Almox/')) continue;
        if (!relSeguro(k)) { res.erros.push(`${k}: nome invalido no lib-ledger.json do servidor`); continue; }
        extra.add(k);
        if (k.endsWith('.SchLib')) extra.add(k.replace(/\.SchLib$/, '.LibPkg'));
      }
      const lote = [...extra].map((rel) => ({ rel, grupo: 'almox' }));
      lista.push(...lote);
      await comLimite(lote, PARALELO, um);
    }
  } finally {
    // O que ja foi gravado fica com a base registrada mesmo que algo inesperado estoure.
    estado.salvar({ ultimaImportacao: new Date().toISOString(), servidor: serverUrl });
    if (res.conflitos.length) res.pastaConflitos = path.join(ws, MARCA_DIR, 'conflitos', quando);
    if (res.backups.length) res.pastaBackup = path.join(ws, MARCA_DIR, 'backup', quando);
  }
  if (signal && signal.aborted) res.cancelado = true;
  progresso({ fase: 'fim', res });
  return res;
}

function ultimaImportacao(ws) {
  return new Estado(ws).d.ultimaImportacao || '';
}

module.exports = { importar, testar, ultimaImportacao, recusaDeDado, relSeguro, ARQ_PROJETO, ARQ_INDICE, ARQ_ALMOX, ARQ_LIB };
