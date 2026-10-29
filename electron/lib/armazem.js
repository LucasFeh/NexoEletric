'use strict';
// O NexoEletric nao guarda nada (1.14.0): projetos, biblioteca e os scripts do Altium moram no NexoBD, pelo Nexo
// Hub desta maquina. A pasta de trabalho continua existindo, mas como COPIA: o hubserver, as vistas, o MCP e o
// sincronismo do Odoo leem e gravam arquivos ali, e este modulo mantem a copia igual ao NexoBD.
//   Projects/<projeto>/  ⇄ um item 'projeto' por pasta (fora do catalogo; so o NexoEletric mostra)
//   Libs/                ⇄ o item "Biblioteca do NexoEletric" (simbolos, footprints e o almoxarifado do Odoo)
//   scripts do Altium    → o item "Scripts do Altium" (os do instalador; o Nexo Hub os poe na pasta do Altium dele)
//   .chat/               ⇄ o item "Chat do NexoEletric" (as conversas do chat do hub; 1.31.0)
// O trabalho e do electron/lib/espelho-nexobd.mjs (copia do cliente/ do repositorio nexohub, o mesmo que o Hub usa).
// Pasta apagada nao apaga nada: volta do NexoBD. Projeto apagado no hub (senha mestre) vai para o Trash/ e o hubserver
// anota em .altiumhub/nexobd-apagar.json; a rodada seguinte o apaga no NexoBD.
//
// A BOM (1.31.0; NexoBD 1.9.0, contrato §9): o NexoBD serve a pagina de montagem para a rede local, sem token.
//   a pagina (bom-pagina.html + hub-bom.js, hub-font.js, hub-laser.js do instalador) → o item "App web da BOM"
//     (chave nexoeletric-web = bom), a cada versao (uma versao mais velha nao sobrescreve a de uma mais nova);
//   cada projeto com board.js → o item "BOM: <projeto>" (chave nexoeletric-bom = o slug do link, o _proj_id do
//     hubserver): fonte.json (a fonte da BOM, gerada pelo hubserver -- o mesmo gerador do painel --, com as mudancas da PCB, quando o
//     board.js, o schematic.js ou o changes.js mudam), opts.json (o bom-opts.json do projeto: as opcoes do "Copiar link") e,
//     so na criacao, os vistos que o projeto ja tinha (bom-vistos.json). Os vistos da bancada gravam no NexoBD.
//
// Roda: antes de o hub abrir (a primeira, com espera curta), quando Projects/ ou Libs/ mudam (3 s depois), quando um
// item nosso muda no NexoBD (o Altium exportou pela pasta do Hub), a cada 2 min, e antes do sincronismo do Odoo.
// Desligado: numa pasta de desenvolvedor (git), com settings.nexobd === false e nos testes sem NEXOHUB_URL.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { PY_FLAGS } = require('./python-flags');

const ESPERA = 3000;
const ESPERA_EVENTO = 1500;
const PERIODO = 120000;
const APP = 'nexoeletric';

// Os scripts do Altium que vao para o NexoBD (do instalador, a pasta resources/hub). AI-GUIDE.md e a marca que o
// HubHome dos .pas procura para aceitar a pasta.
const SCRIPTS = ['AltiumPCBMirror.PrjScr', 'ExportProject.pas', 'ExportBoard.pas', 'BuildSchematic.pas', 'ApplyChanges.pas', 'AI-GUIDE.md'];

// A BOM servida pelo NexoBD (1.31.0)
const SISTEMA_BOM = 'nexoeletric-bom';
const ARQ_WEB_BOM = ['bom-pagina.html', 'hub-bom.js', 'hub-font.js', 'hub-laser.js'];
const ALVO_WEB_BOM = {
  sistema: 'nexoeletric-web', chave: 'bom',
  criar: { tipo: 'outro', categoria: 'nexoeletric', nome: 'App web da BOM (NexoEletric)', descricao: 'A página de montagem da placa que o NexoBD serve para a rede local (/bom/<projeto>)', atributos: { programa: 'nexoeletric' } },
};
// As conversas e o caderno do chat do hub (.chat/ na pasta de trabalho, tools/chat/chatserver.py): no NexoBD tambem
// (1.31.0), um item so para todas as maquinas (cada conversa e um arquivo com id unico).
const ALVO_CHAT = {
  sistema: 'nexoeletric-chat', chave: 'conversas',
  criar: { tipo: 'outro', categoria: 'nexoeletric', nome: 'Chat do NexoEletric', descricao: 'As conversas e o caderno do chat do hub (a pasta .chat)', atributos: { programa: 'nexoeletric', pasta: '.chat' } },
};
/** O slug do projeto no link da BOM: o mesmo _proj_id do hubserver.py. */
const slugProjeto = (nome) => String(nome || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'proj';
const cmpVersao = (a, b) => {
  const x = String(a || '0').split(/[.-]/).map((n) => parseInt(n, 10) || 0), y = String(b || '0').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
};
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const sha256Arq = (arq) => { try { return sha256(fs.readFileSync(arq)); } catch { return null; } };
const jsonCanonico = (v) => {
  const ord = (x) => (Array.isArray(x) ? x.map(ord) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, ord(x[k])])) : x);
  return JSON.stringify(ord(v));
};

// O gerador da biblioteca a partir do Odoo (o guardiao + almox2lib) roda no NexoBD (1.29.0: Odoo -> NexoBD -> Nexo Hub
// -> NexoEletric). O codigo dele continua sendo deste repositorio: sobe do instalador para o item "Ferramentas do Odoo",
// que o NexoBD usa na hora de sincronizar (cada versao do NexoEletric leva a sua).
const ALVO_FERRAMENTAS = {
  sistema: 'nexoeletric-ferramentas', chave: 'odoo',
  criar: { tipo: 'outro', categoria: 'nexoeletric', nome: 'Ferramentas do Odoo (NexoEletric)', descricao: 'O gerador da biblioteca a partir do Odoo (guardião + almox2lib): o NexoBD roda com ele o sincronismo do Odoo', atributos: { programa: 'nexoeletric' } },
};
const FERRAMENTAS_DIRS = ['tools/almox', 'tools/symbols', 'tools/pcblib', 'tools/pcbdoc'];
function aceitaFerramenta(rel) {
  if (rel.endsWith('/')) return rel === 'tools/' || FERRAMENTAS_DIRS.includes(rel.slice(0, -1));
  if (rel === 'tools/libpath.py') return true;
  const d = rel.slice(0, rel.lastIndexOf('/'));
  return FERRAMENTAS_DIRS.includes(d) && /\.(py|json|csv)$/i.test(rel) && !/(^|\/)(test_|config\.json$)/i.test(rel);
}

// Fora da biblioteca: o cache dos STEP extraidos da PcbLib (refeito sob demanda pelo hubserver).
function aceitaLib(rel) {
  return !/^3d(\/|$)/i.test(rel) && rel !== 'pcblib-3d.js';
}

// Os footprints (Libs/pcblib.js, o que o hub, as vistas e o MCP leem) saem da PcbLib da casa que veio do NexoBD,
// e nao mais de um pcblib.js gerado no Altium a partir de uma pasta de rede e congelado no instalador (1.29.0).
// tools/pcblib/pcblib2js.py le a PcbLib sem o Altium; a saida e deterministica (a data vem do save da PcbLib), entao
// toda maquina gera o mesmo arquivo e o espelho nao cria revisao a toa. Roda quando a PcbLib, o rename-map.js ou o
// gerador mudam -- inclusive sem o NexoBD no ar, para a primeira abertura depois da atualizacao.
const PCBLIB_CASA = ['Libs', 'Almox', 'FOOTPRINTS ALMOX.PcbLib'];
const GERADOR_PCBLIB = 'pcblib2js/1';
const ARQ_PCBLIB = (ws) => path.join(ws, '.altiumhub', 'pcblib.json');

function marca(arq) {
  try { const st = fs.statSync(arq); return `${st.size}:${Math.trunc(st.mtimeMs)}`; } catch { return '-'; }
}

/** Refaz o Libs/pcblib.js a partir da PcbLib, se ela mudou. → {gerado, footprints?} | null (nada a fazer) */
function atualizarPcblib({ ws, python, log = () => {}, forcar = false }) {
  const pcblib = path.join(ws, ...PCBLIB_CASA);
  const script = path.join(ws, 'tools', 'pcblib', 'pcblib2js.py');
  const saida = path.join(ws, 'Libs', 'pcblib.js');
  if (!python || !fs.existsSync(pcblib) || !fs.existsSync(script)) return Promise.resolve(null);
  const chave = [GERADOR_PCBLIB, marca(pcblib), marca(path.join(ws, 'Libs', 'rename-map.js'))].join('|');
  if (!forcar && lerJson(ARQ_PCBLIB(ws), {}).chave === chave && fs.existsSync(saida)) return Promise.resolve(null);
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^PYTHON/i.test(k) && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONHOME = path.dirname(python);
  const args = [...PY_FLAGS, script, pcblib, saida, '--fonte', 'NexoBD: Libs/Almox/FOOTPRINTS ALMOX.PcbLib'];
  return new Promise((resolve, reject) => {
    execFile(python, args, { cwd: ws, env, timeout: 180000, windowsHide: true, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`pcblib.js não foi gerado: ${String(stderr || err.message).trim().split('\n').pop()}`));
      const m = /^(\d+) footprint/m.exec(stdout);
      for (const l of String(stdout).split('\n')) if (l.startsWith('aviso: ')) log(`pcblib.js: ${l.slice(7)}`);
      fs.mkdirSync(path.dirname(ARQ_PCBLIB(ws)), { recursive: true });
      fs.writeFileSync(ARQ_PCBLIB(ws), JSON.stringify({ chave, footprints: m ? Number(m[1]) : null, em: new Date().toISOString() }));
      resolve({ gerado: true, footprints: m ? Number(m[1]) : null });
    });
  });
}

const ARQ_ESTADO = (ws) => path.join(ws, '.altiumhub', 'nexobd.json');
const ARQ_APAGAR = (ws) => path.join(ws, '.altiumhub', 'nexobd-apagar.json');
const ARQ_RENOMEAR = (ws) => path.join(ws, '.altiumhub', 'nexobd-renomear.json');
const CONFLITOS = (ws) => path.join(ws, '.altiumhub', 'conflitos-nexobd');

function desligado(env = process.env) {
  if (env.NEXOHUB_DESLIGADO === '1') return 'NEXOHUB_DESLIGADO=1';
  if ((env.ALTIUMHUB_SMOKE || env.ALTIUMHUB_USERDATA) && !env.NEXOHUB_URL) return 'teste/automação sem NEXOHUB_URL';
  return '';
}

/** O armazem vale para esta pasta? Fora da pasta de desenvolvedor (git), sempre (1.31.0: um "nexobd": false antigo
 *  nas configuracoes nao desliga mais -- nada do NexoEletric fica so nesta maquina); o ambiente dos testes decide. */
function ligado(s, ehDev, env = process.env) {
  return Boolean(s) && !ehDev && !desligado(env);
}

let mods = null;
function modulos() {
  if (!mods) {
    mods = Promise.all([
      import(pathToFileURL(path.join(__dirname, 'nexohub-cliente.mjs')).href),
      import(pathToFileURL(path.join(__dirname, 'espelho-nexobd.mjs')).href),
    ]).then(([cliente, espelho]) => ({ cliente, espelho }));
  }
  return mods;
}

function lerJson(arq, padrao) {
  try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; }
}

/**
 * O app web da BOM (a pagina e os scripts do instalador) no NexoBD. So sobe se o item nao for de uma versao mais nova
 * do NexoEletric (duas maquinas com versoes diferentes nao ficam trocando a pagina).
 */
async function publicarWebBom({ cliente, bundle, versao, estado, log = () => {} }) {
  const { espelho } = await modulos();
  if (!bundle || !ARQ_WEB_BOM.every((f) => fs.existsSync(path.join(bundle, f)))) return null;
  const it = await cliente.chave(ALVO_WEB_BOM.sistema, ALVO_WEB_BOM.chave);
  const deLa = it && !it.apagado_em ? (it.atributos || {}).versao : '';
  if (deLa && versao && cmpVersao(deLa, versao) > 0) return { item: it.id, rev: it.rev, pulado: `versão ${deLa} no NexoBD` };
  const so = new Set(ARQ_WEB_BOM);
  const r = await espelho.espelhar({ cliente, pasta: bundle, alvo: ALVO_WEB_BOM, estado, modo: 'subir', aceita: (rel) => so.has(rel), app: APP, log, nota: `página da BOM do NexoEletric ${versao || ''}`.trim() });
  if (r.item && versao && deLa !== versao) await cliente.alterarItem(r.item, { atributos: { programa: 'nexoeletric', versao } });
  return r;
}

/**
 * A BOM de cada projeto no NexoBD. fonte(nome, slug) → {ok, board} (o /api/bom/<slug>/source do hubserver) ou null
 * (hub fora: fica para a rodada seguinte). estado = {nome: {item, board, sch, opts}} (mudado aqui).
 * → {atualizados: [nomes], pendentes: [nomes], erros: [{nome, erro}]}
 */
async function espelharBoms({ cliente, ws, nomes, estado, fonte, versao = '', apagados = [], log = () => {} }) {
  const out = { atualizados: [], pendentes: [], erros: [] };
  for (const nome of apagados) {
    try {
      const it = await cliente.chave(SISTEMA_BOM, slugProjeto(nome));
      if (it && !it.apagado_em && (it.atributos || {}).projeto === nome) { await cliente.apagarItem(it.id); log(`- BOM ${nome}: apagada no NexoBD`); }
    } catch (err) { out.erros.push({ nome, erro: err.message }); }
    delete estado[nome];
  }
  for (const nome of nomes) {
    const pasta = path.join(ws, 'Projects', nome);
    const shaB = sha256Arq(path.join(pasta, 'board.js'));
    if (!shaB) continue;                                       // sem board.js nao ha BOM
    const shaS = sha256Arq(path.join(pasta, 'schematic.js'));
    const shaC = sha256Arq(path.join(pasta, 'changes.js'));   // a PCB mexida no hub tambem muda a BOM (1.33.0)
    let optsTxt = null;
    try { const o = JSON.parse(fs.readFileSync(path.join(pasta, 'bom-opts.json'), 'utf8')); if (o && typeof o === 'object' && !Array.isArray(o)) optsTxt = jsonCanonico(o); } catch { /* sem opcoes */ }
    const shaO = optsTxt ? sha256(optsTxt) : null;
    const e = estado[nome] || (estado[nome] = {});
    if (e.item && e.board === shaB && e.sch === shaS && (e.changes || null) === shaC && e.opts === shaO) continue;
    const slug = slugProjeto(nome);
    try {
      let it = await cliente.chave(SISTEMA_BOM, slug);
      if (it && it.apagado_em) it = null;
      if (!it) {
        it = await cliente.criarItem({ tipo: 'outro', categoria: 'nexoeletric', nome: `BOM: ${nome}`, descricao: 'A BOM do projeto para a bancada: o NexoBD serve em /bom/' + slug,
          atributos: { programa: 'nexoeletric', projeto: nome, id: slug }, chaves: [{ sistema: SISTEMA_BOM, chave: slug }], app: APP });
        log(`+ BOM ${nome}: item ${it.id} criado no NexoBD`);
      }
      const arqs = it.arquivos || {};
      const arquivos = {};
      let fonteAtual = null;
      if (arqs['fonte.json']) { try { fonteAtual = JSON.parse(Buffer.from(await cliente.blob(arqs['fonte.json'].sha256)).toString('utf8')); } catch { fonteAtual = null; } }
      const fontes = { board: shaB, schematic: shaS, changes: shaC };
      let pendente = false;
      if (!fonteAtual || !fonteAtual.fontes || fonteAtual.fontes.board !== shaB || (fonteAtual.fontes.schematic || null) !== shaS ||
          (fonteAtual.fontes.changes || null) !== shaC) {
        const f = await fonte(nome, slug);
        if (f && f.ok && f.board) {
          const tag = sha256(`${shaB}|${shaS || ''}|${shaC || ''}`).slice(0, 12);
          arquivos['fonte.json'] = { bytes: Buffer.from(JSON.stringify({ ok: true, projeto: nome, board: f.board, sourceRev: tag, fontes, gerado_em: new Date().toISOString(), gerador: `NexoEletric ${versao}`.trim() })), nome: 'fonte.json' };
        } else pendente = true;
      }
      if (optsTxt && (!arqs['opts.json'] || arqs['opts.json'].sha256 !== shaO)) arquivos['opts.json'] = { bytes: Buffer.from(optsTxt), nome: 'opts.json' };
      if (!arqs['vistos.json']) {
        try {
          const v = JSON.parse(fs.readFileSync(path.join(pasta, 'bom-vistos.json'), 'utf8'));
          if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) arquivos['vistos.json'] = { bytes: Buffer.from(jsonCanonico(v)), nome: 'vistos.json' };
        } catch { /* sem vistos antigos */ }
      }
      if (Object.keys(arquivos).length) {
        const rv = await cliente.novaRevisao(it.id, { arquivos, herdar: true, base: it.rev || 0, forcar: true, nota: `BOM de ${nome} (${Object.keys(arquivos).join(', ')})`, app: APP });
        log(`^ BOM ${nome}: revisão ${rv.numero || rv.rev} (${Object.keys(arquivos).join(', ')})`);
        out.atualizados.push(nome);
      }
      if (pendente) { out.pendentes.push(nome); e.item = it.id; delete e.board; continue; }
      Object.assign(e, { item: it.id, board: shaB, sch: shaS, changes: shaC, opts: shaO });
    } catch (err) { out.erros.push({ nome, erro: err.message }); }
  }
  return out;
}

/** A fonte da BOM pelo hubserver no ar (o mesmo gerador do painel BOM e da pagina antiga). */
function fonteDoHub(origem) {
  return async (_nome, slug) => {
    if (!origem) return null;
    try {
      const r = await fetch(`${origem}/api/bom/${encodeURIComponent(slug)}/source`, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  };
}

/**
 * A fonte da BOM com as mudancas da PCB (1.33.0, pedido do dono: "quando a PCB atualiza, BOM, laser e Neoden andam
 * junto"). O hubserver devolve o board.js com os dados de compra do esquema; por cima, o changes.js do projeto pela
 * mesma conta da vista PCB (hub-placaviva.js » efetiva: comp_add com a biblioteca, teardrops, planos despejados).
 * hubDir = a pasta com os hub-*.js (a do instalador); falhou alguma coisa, fica a fonte do hubserver como veio.
 */
function fonteEfetiva(hubDir, ws, fonte) {
  return async (nome, slug) => {
    const f = await fonte(nome, slug);
    if (!f || !f.ok || !f.board || !hubDir) return f;
    try {
      const req = (arq) => require(path.join(hubDir, arq));
      const PV = req('hub-placaviva.js');
      const chTxt = (() => { try { return fs.readFileSync(path.join(ws, 'Projects', nome, 'changes.js'), 'utf8'); } catch { return ''; } })();
      const changes = PV.leChanges(chTxt);
      if (!changes.length) return f;
      let pcblib = null;
      if (PV.precisaLib(changes)) {
        const vm = require('node:vm');
        const le = (arq, nomeVar) => { try { const c = {}; vm.createContext(c); vm.runInContext(fs.readFileSync(path.join(ws, 'Libs', arq), 'utf8') + `;this.__v=typeof ${nomeVar}!=='undefined'?${nomeVar}:null`, c); return c.__v; } catch { return null; } };
        const alt = le('pcblib.js', 'pcblib'), hub = le('pcblib-hub.js', 'pcblibHub');
        let FL = null; try { FL = req('hub-fplib.js'); } catch { FL = null; }
        const h = FL && hub ? FL.normaliza(hub) : null;
        pcblib = h && h.footprints && h.footprints.length ? FL.mescla(alt, h) : alt;
      }
      let T = null, P = null;
      try { T = req('hub-pcbteardrop.js'); } catch { T = null; }
      try { P = req('hub-pcbpour.js'); } catch { P = null; }
      f.board = PV.efetiva({ board: f.board, changes, HubCore: req('hub-core.js'), pcblib, Teardrop: T, Pour: P });
    } catch { /* fica a fonte do hubserver */ }
    return f;
  };
}

/**
 * Projeto renomeado (1.45.0). O nome do projeto e a chave dele no NexoBD (nexoeletric-projeto = nome da pasta), entao
 * renomear a pasta, sem mais nada, seria para o espelho um projeto novo (sobe) e um projeto sem pasta (baixa de volta).
 *  - aqui: o hubserver anota {de, para} em .altiumhub/nexobd-renomear.json ANTES de renomear a pasta; a chave e o nome
 *    do MESMO item trocam (o historico de revisoes fica) e a BOM o acompanha;
 *  - nas outras maquinas: o item que esta pasta conhecia agora tem outra chave; a pasta e renomeada aqui tambem, com a
 *    memoria do espelho junto (nada e baixado de novo, e o que estava por subir sobe).
 * estado = o de espelharProjetos ({bd, projetos: {nome: ...}}); boms = o de espelharBoms. → nomes da nota que foram feitos
 */
async function renomearProjetos({ cliente, raiz, renomear = [], estado, boms = {}, lixeira, log = () => {} }) {
  const { espelho } = await modulos();
  const S = espelho.SISTEMA_PROJETO;
  // outro NexoBD (ou a primeira rodada): a memoria nao vale la (espelharProjetos a zera), so a chave do item troca
  const mesmoBD = estado.bd === await espelho.identidadeBD(cliente);
  estado.projetos ??= {};
  const vivos = await espelho.listarProjetos(cliente);
  const existe = (nome) => fs.existsSync(path.join(raiz, nome));
  const moveEstado = (de, para) => {
    if (estado.projetos[de]) { estado.projetos[para] = estado.projetos[de]; delete estado.projetos[de]; }
    if (boms[de]) { boms[para] = boms[de]; delete boms[de]; }
  };
  const tirar = async (fn) => { try { await fn(); } catch { /* chave que ja nao existe */ } };
  const feitos = [], locais = [];
  for (const r of renomear) {
    const { de, para } = r;
    if (!espelho.nomeDePastaOk(de) || !espelho.nomeDePastaOk(para) || de === para) { feitos.push(r); continue; }
    const it = vivos.get(de), outro = vivos.get(para);
    if (it) {
      if (outro && outro.id !== it.id) {
        // uma rodada correu entre o rename e esta nota e subiu a pasta nova como projeto novo: fica o antigo (o historico)
        await cliente.apagarItem(outro.id);
        log(`− ${para}: cópia subida no meio do renomear, apagada (fica o item ${it.id})`);
      }
      await cliente.definirChave(S, para, it.id);
      await tirar(() => cliente.apagarChave(S, de));
      await cliente.alterarItem(it.id, { nome: para, atributos: { pasta: para } });
      vivos.delete(de); vivos.set(para, it);
      log(`↔ ${de} → ${para}: renomeado no NexoBD (item ${it.id})`);
      try {
        const b = await cliente.chave(SISTEMA_BOM, slugProjeto(de));
        if (b && !b.apagado_em && (b.atributos || {}).projeto === de) {
          const slug = slugProjeto(para);
          if (slug !== slugProjeto(de)) { await cliente.definirChave(SISTEMA_BOM, slug, b.id); await tirar(() => cliente.apagarChave(SISTEMA_BOM, slugProjeto(de))); }
          await cliente.alterarItem(b.id, { nome: `BOM: ${para}`, descricao: 'A BOM do projeto para a bancada: o NexoBD serve em /bom/' + slug, atributos: { projeto: para, id: slug } });
        }
      } catch (err) { log(`BOM ${de} → ${para}: ${err.message}`); }
    }
    moveEstado(de, para);
    // a rodada que correu no meio pode ter baixado a pasta antiga de volta: ela e a mesma coisa que a nova
    if (existe(de) && existe(para) && de.toLowerCase() !== para.toLowerCase()) {
      fs.mkdirSync(lixeira, { recursive: true });
      fs.renameSync(path.join(raiz, de), path.join(lixeira, `${de}-renomeado-${Date.now()}`));
    } else if (existe(de) && !existe(para)) fs.renameSync(path.join(raiz, de), path.join(raiz, para));
    feitos.push(r);
  }
  // o que outra maquina renomeou: a pasta daqui ainda tem o nome velho e a memoria aponta para o item que mudou de chave
  const porId = new Map([...vivos].map(([nome, it]) => [it.id, nome]));
  for (const [de, est] of mesmoBD ? Object.entries(estado.projetos) : []) {
    if (!est || !est.item || vivos.has(de)) continue;
    const para = porId.get(est.item);
    if (!para || para === de || estado.projetos[para] || !existe(de) || existe(para) || !espelho.nomeDePastaOk(para)) continue;
    try {
      fs.renameSync(path.join(raiz, de), path.join(raiz, para));
      moveEstado(de, para);
      locais.push({ de, para });
      log(`↔ ${de} → ${para}: renomeado em outra máquina, a pasta daqui acompanhou`);
    } catch (err) { log(`${de} → ${para}: a pasta não deu para renomear (${err.message}); vai pela lixeira`); }
  }
  return { feitos, locais };
}

/**
 * Uma rodada (sem agenda; os testes chamam direto).
 * op: {ws, bundle (a pasta com os scripts do instalador, ou ''), cliente, estado, log}
 * → {scripts, biblioteca, projetos}
 */
async function rodada({ ws, bundle, cliente, estado, log = () => {}, scripts = true, fonte = null, versao = '' }) {
  const { espelho } = await modulos();
  await espelho.garantirCategoriaInterna(cliente);
  const conflitos = CONFLITOS(ws);
  let rScripts = null;
  if (scripts && bundle && fs.existsSync(path.join(bundle, 'ExportProject.pas'))) {
    const so = new Set(SCRIPTS);
    rScripts = await espelho.espelhar({ cliente, pasta: bundle, alvo: espelho.ALVO_SCRIPTS, estado: (estado.scripts ??= {}), modo: 'subir', aceita: (rel) => so.has(rel), app: APP, log, nota: 'scripts do instalador do NexoEletric' });
    await espelho.espelhar({ cliente, pasta: bundle, alvo: ALVO_FERRAMENTAS, estado: (estado.ferramentas ??= {}), modo: 'subir', aceita: aceitaFerramenta, app: APP, log, nota: 'gerador do Odoo do instalador do NexoEletric' });
    try { await publicarWebBom({ cliente, bundle, versao, estado: (estado.webBom ??= {}), log }); }
    catch (err) { log(`página da BOM não subiu: ${err.message}`); }
  }
  const biblioteca = await espelho.espelharComRetentativa({
    cliente, pasta: path.join(ws, 'Libs'), alvo: espelho.ALVO_BIBLIOTECA, estado: (estado.biblioteca ??= {}),
    modo: 'ambos', aceita: aceitaLib, conflitos: path.join(conflitos, 'Libs'), app: APP, log, nota: 'NexoEletric',
  });
  let chat = null;
  try {
    chat = await espelho.espelharComRetentativa({ cliente, pasta: path.join(ws, '.chat'), alvo: ALVO_CHAT, estado: (estado.chat ??= {}), modo: 'ambos', conflitos: path.join(conflitos, 'chat'), app: APP, log, nota: 'chat do NexoEletric' });
  } catch (err) { log(`chat: ${err.message}`); }
  // os projetos renomeados (aqui pelo hub, ou em outra maquina): antes do espelho, senao ele os toma por novo + sumido
  const renomear = lerJson(ARQ_RENOMEAR(ws), []).filter((r) => r && typeof r.de === 'string' && typeof r.para === 'string');
  const ren = await renomearProjetos({ cliente, raiz: path.join(ws, 'Projects'), renomear, estado: (estado.projetos ??= {}),
    boms: (estado.boms ??= {}), lixeira: path.join(ws, 'Trash'), log });
  if (renomear.length) {
    const resto = lerJson(ARQ_RENOMEAR(ws), []).filter((r) => !ren.feitos.some((f) => f.de === r.de && f.para === r.para));
    if (resto.length) fs.writeFileSync(ARQ_RENOMEAR(ws), JSON.stringify(resto)); else fs.rmSync(ARQ_RENOMEAR(ws), { force: true });
  }
  // os projetos que o hub mandou para a lixeira: apagar no NexoBD (a lista so sai do arquivo depois de feito)
  const apagar = lerJson(ARQ_APAGAR(ws), []).filter((n) => typeof n === 'string');
  const projetos = await espelho.espelharProjetos({
    cliente, raiz: path.join(ws, 'Projects'), estado: (estado.projetos ??= {}), modo: 'ambos', apagar,
    lixeira: path.join(ws, 'Trash'), conflitos, app: APP, log, nota: 'NexoEletric',
  });
  if (apagar.length) {
    const resto = lerJson(ARQ_APAGAR(ws), []).filter((n) => !apagar.includes(n));
    if (resto.length) fs.writeFileSync(ARQ_APAGAR(ws), JSON.stringify(resto)); else fs.rmSync(ARQ_APAGAR(ws), { force: true });
  }
  // a BOM de cada projeto (fonte, opcoes) para o NexoBD servir na rede; sem o gerador (hub fora), fica para depois
  let boms = null;
  if (fonte) {
    boms = await espelharBoms({ cliente, ws, nomes: Object.keys(projetos.projetos), estado: (estado.boms ??= {}), fonte, versao, apagados: projetos.apagadosNoNexoBD || [], log });
    for (const e of boms.erros) log(`BOM ${e.nome}: ${e.erro}`);
  }
  return { scripts: rScripts, biblioteca, projetos, boms, chat };
}

class Armazem {
  constructor({ log, bundle, python, versao } = {}) {
    this.log = log || console;
    this.bundle = bundle || '';
    this.python = python || '';
    this.versao = versao || '';
    this.hub = '';
    this.ws = '';
    this.estado = null;
    this.rodando = null;
    this.pendente = false;
    this.timer = null;
    this.periodo = null;
    this.vigias = [];
    this.ouvinte = null;
    this.nossos = new Set();
    this.scriptsFeitos = false;
    this.est = { fase: 'parado', erro: '', ultimo: '', resumo: null, url: '' };
  }

  status() { return { ...this.est }; }

  /** O hubserver no ar (a fonte da BOM sai dele). */
  definirHub(origem) { this.hub = origem || ''; }

  resumoTexto() {
    const e = this.est;
    if (e.fase === 'parado') return 'desligado';
    if (e.fase === 'erro') return `erro: ${e.erro}`;
    const r = e.resumo;
    return r ? `${r.projetos} projeto(s), biblioteca ${r.biblioteca}${e.ultimo ? ` · em dia às ${new Date(e.ultimo).toLocaleTimeString('pt-BR')}` : ''}` : e.fase;
  }

  /** Liga para a pasta de trabalho. Devolve a primeira rodada (quem chama decide quanto espera por ela). */
  iniciar(ws) {
    if (this.ws !== ws) {
      this.parar();
      this.ws = ws;
      this.estado = lerJson(ARQ_ESTADO(ws), {});
      this.vigiar();
      this.periodo = setInterval(() => this.agora('periódica'), PERIODO);
    }
    return this.agora('abertura');
  }

  parar() {
    clearTimeout(this.timer); this.timer = null;
    clearInterval(this.periodo); this.periodo = null;
    for (const v of this.vigias) { try { v.close(); } catch { /* ja fechado */ } }
    this.vigias = [];
    if (this.ouvinte) { this.ouvinte.fechar(); this.ouvinte = null; }
    this.ws = '';
    this.est.fase = 'parado';
  }

  agendar(ms, motivo) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.agora(motivo).catch(() => {}); }, ms);
  }

  /** Uma rodada ja (ou a que esta em curso + uma depois dela). → {ok, erro?, resumo} */
  async agora(motivo = 'pedido') {
    if (!this.ws) return { ok: false, erro: 'armazém desligado' };
    if (this.rodando) { this.pendente = true; return this.rodando; }
    const ws = this.ws;
    this.est.fase = 'sincronizando';
    this.rodando = (async () => {
      try {
        const { cliente: c } = await modulos();
        const cliente = c.criarCliente({ app: APP });
        this.est.url = (await cliente.conexao()).url;
        const log = (l) => this.log.info(`[nexobd] ${l}`);
        const r = await rodada({ ws, bundle: this.bundle, cliente, estado: this.estado, log, scripts: !this.scriptsFeitos, fonte: fonteEfetiva(this.bundle || ws, ws, fonteDoHub(this.hub)), versao: this.versao });
        if (r.scripts) this.scriptsFeitos = true;
        fs.mkdirSync(path.dirname(ARQ_ESTADO(ws)), { recursive: true });
        const tmp = ARQ_ESTADO(ws) + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.estado));
        fs.renameSync(tmp, ARQ_ESTADO(ws));
        const proj = Object.values(r.projetos.projetos);
        for (const x of [r.biblioteca.item, r.scripts && r.scripts.item, ...proj.map((p) => p.item)]) if (x) this.nossos.add(x);
        const todos = [r.biblioteca, ...proj];
        this.est.resumo = {
          projetos: proj.length,
          biblioteca: r.biblioteca.item ? `rev ${r.biblioteca.rev}` : 'vazia',
          scripts: r.scripts ? `rev ${r.scripts.rev}` : '',
          baixados: todos.reduce((a, x) => a + x.baixados.length, 0),
          subidos: todos.reduce((a, x) => a + x.subidos.length, 0),
          conflitos: todos.flatMap((x) => x.conflitos),
          erros: r.projetos.erros,
          falhas: todos.flatMap((x) => x.falhas),
        };
        for (const e of r.projetos.erros) this.log.warn(`[nexobd] ${e.nome}: ${e.erro}`);
        for (const f of this.est.resumo.falhas) this.log.warn(`[nexobd] ${f.rel}: ${f.erro}`);
        for (const x of this.est.resumo.conflitos) this.log.warn(`[nexobd] conflito em ${x.rel}: a versão do NexoBD ficou em ${x.guardado}`);
        if (this.est.resumo.baixados || this.est.resumo.subidos) {
          this.log.info(`[nexobd] ${motivo}: ${this.est.resumo.baixados} arquivo(s) baixado(s), ${this.est.resumo.subidos} subido(s)`);
        }
        this.est.fase = 'em dia'; this.est.erro = ''; this.est.ultimo = new Date().toISOString();
        this.ouvir(cliente);
        return { ok: true, resumo: this.est.resumo };
      } catch (err) {
        // para o usuario so existe o Nexo Hub: o "NexoBD fora do ar" que a ponte repassa vira "sem os dados"
        const txt = /NexoBD|nexobd_fora/i.test(err.message) ? 'o Nexo Hub está sem os dados agora' : err.message;
        this.est.fase = 'erro'; this.est.erro = txt;
        this.log.warn(`[nexobd] ${motivo}: ${err.message}`);
        return { ok: false, erro: txt };
      } finally {
        // com ou sem o NexoBD: a PcbLib desta copia e a que vale para os footprints
        try {
          const g = await atualizarPcblib({ ws, python: this.python, log: (l) => this.log.warn(`[nexobd] ${l}`) });
          if (g) this.log.info(`[nexobd] footprints: Libs/pcblib.js refeito da PcbLib do NexoBD (${g.footprints} footprints)`);
        } catch (e) {
          this.log.warn(`[nexobd] ${e.message}`);
        }
        this.rodando = null;
        if (this.pendente && this.ws) { this.pendente = false; this.agendar(500, 'pendente'); }
      }
    })();
    return this.rodando;
  }

  // Projects/ e Libs/ mudaram (o hub salvou, o sincronismo do Odoo escreveu, o MCP editou): espera assentar.
  vigiar() {
    for (const sub of ['Projects', 'Libs']) {
      const raiz = path.join(this.ws, sub);
      try {
        fs.mkdirSync(raiz, { recursive: true });
        const v = fs.watch(raiz, { recursive: true }, (_t, nome) => {
          const n = String(nome || '').replace(/\\/g, '/');
          if (/(^|\/)[.~]|\.tmp$/i.test(n)) return;                // temporarios e travas
          if (sub === 'Libs' && !aceitaLib(n)) return;              // cache do 3D
          this.agendar(ESPERA, `${sub} mudou`);
        });
        v.on('error', () => {});
        this.vigias.push(v);
      } catch (e) {
        this.log.warn(`[nexobd] sem vigia em ${raiz}: ${e.message}`);
      }
    }
  }

  // Um item nosso mudou no NexoBD por outro programa (a pasta do Altium no Nexo Hub, outra maquina).
  ouvir(cliente) {
    if (this.ouvinte) return;
    this.ouvinte = cliente.eventos(null, (ev) => {
      if (!ev || !ev.tipo || ev.app === APP) return;
      const nosso = ev.tipo.startsWith('item.') ? this.nossos.has(ev.item_id) || (ev.dados && ev.dados.tipo === 'projeto')
        : ev.tipo === 'chave' && ev.dados && /^nexoeletric-(projeto|biblioteca)$/.test(ev.dados.sistema);
      if (nosso) this.agendar(ESPERA_EVENTO, 'NexoBD mudou');
    });
  }
}

module.exports = { Armazem, rodada, ligado, desligado, aceitaLib, aceitaFerramenta, ALVO_FERRAMENTAS, atualizarPcblib, SCRIPTS, ARQ_APAGAR, ARQ_RENOMEAR, ARQ_ESTADO, ARQ_PCBLIB, renomearProjetos,
  espelharBoms, publicarWebBom, fonteDoHub, fonteEfetiva, slugProjeto, SISTEMA_BOM, ALVO_WEB_BOM, ARQ_WEB_BOM, ALVO_CHAT };
