'use strict';
// NexoEletric desktop: o hub do AltiumPCBMirror numa janela propria.
//
// O que o app faz, na ordem:
//   1. garante a pasta de trabalho (lib/workspace.js): o codigo do hub que veio neste
//      instalador + o estado da maquina (Projects/, Libs/, credenciais), que nunca e tocado;
//   2. sobe `python hubserver.py` com o Python embutido (lib/backend.js) -- o MESMO
//      servidor que roda no 192.168.15.192, so que nesta maquina e escutando em 127.0.0.1;
//   3. mostra o hub na janela, com o comportamento de aba do Chrome (lib/web.js);
//   4. busca atualizacao nos releases do GitHub (lib/updater.js);
//   5. importa projetos e bibliotecas do hub central quando pedido (lib/import-server.js),
//      e antes de todo sincronismo do almoxarifado, para a numeracao nao divergir;
//   6. desde a 1.2.0, a biblioteca e a do SERVIDOR (lib/lib-remota.js): o hub daqui repassa
//      a ele as gravacoes de biblioteca e mantem Libs/ como espelho. Nesse modo o item 5 fica
//      so com projetos e Libs/Almox, e o sincronismo roda no servidor, sem guarda aqui.
//   7. desde a 1.14.0, nada mora aqui: projetos, biblioteca e scripts do Altium ficam no NexoBD
//      (lib/armazem.js), e a pasta de trabalho e copia. Com ele ligado (o padrao), os itens 5 e 6
//      ficam de fora e o sincronismo do Odoo roda aqui, sobre a biblioteca trazida do NexoBD.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell, clipboard } = require('electron');

// Testes/automacao: pasta de dados propria ANTES de qualquer uso do userData.
if (process.env.ALTIUMHUB_USERDATA) {
  app.setPath('userData', process.env.ALTIUMHUB_USERDATA);
} else {
  // O app se chamou AltiumHub ate a 1.0.2 e EletricHUB ate a 1.8.x, e o userData segue o nome
  // do produto: sem isto a atualizacao abriria como instalacao nova -- sem a pasta de trabalho
  // configurada e sem as preferencias do hub (o localStorage mora ali). A pasta mais recente
  // dos nomes antigos muda de nome uma vez; se o Windows recusar (algo ainda segurando um
  // arquivo), o app continua usando a antiga.
  const appData = app.getPath('appData');
  const nova = path.join(appData, app.getName());                                   // NexoEletric
  const antigas = ['EletricHUB', 'AltiumHub'].map((n) => path.join(appData, n)).filter((d) => d !== nova);
  const antiga = antigas.find((d) => fs.existsSync(d));
  try {
    if (antiga && !fs.existsSync(nova)) fs.renameSync(antiga, nova);
  } catch {
    app.setPath('userData', antiga);
  }
}
// O hub decide o idioma da casca pelo navigator.language (hub-i18n.js). Os paineis sao
// pt-BR sempre; num Windows em ingles a casca sairia em ingles e o resto nao.
app.commandLine.appendSwitch('lang', 'pt-BR');
app.setAppUserModelId('com.dieletrons.altiumhub');

const log = require('electron-log/main');
log.initialize();

const settings = require('./lib/settings');
const workspace = require('./lib/workspace');
const { Backend } = require('./lib/backend');
const updater = require('./lib/updater');
const importer = require('./lib/import-server');
const altiumHome = require('./lib/altium-home');
const libRemota = require('./lib/lib-remota');
const web = require('./lib/web');
const buildInfo = require('./lib/build-info');
const { NexoHubSync } = require('./lib/nexohub-sync');
const armazemNexoBD = require('./lib/armazem');
const conexaoIA = require('./lib/conexao-ia');

web.registrarEsquemas();

// A rede Nexo Hub: a biblioteca 3D e as placas publicadas no banco comum (lib/nexohub-sync.js)
const nexoSync = new NexoHubSync({ log, versao: app.getVersion() });

const UI_DIR = path.join(__dirname, 'ui');
const UI_URL = pathToFileURL(UI_DIR).href;
const PRELOAD_UI = path.join(UI_DIR, 'preload.js');
const EMBUTIDO = app.isPackaged;
const PYTHON = process.env.ALTIUMHUB_PYTHON ||
  (EMBUTIDO ? path.join(process.resourcesPath, 'python', 'python.exe') : path.join(__dirname, 'build', 'python', 'python.exe'));
const BUNDLE = EMBUTIDO ? path.join(process.resourcesPath, 'hub') : path.join(__dirname, 'build', 'hub');
const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const SMOKE = process.env.ALTIUMHUB_SMOKE || '';
// Projetos, biblioteca e scripts do Altium no NexoBD (lib/armazem.js)
const armazem = new armazemNexoBD.Armazem({ log, bundle: BUNDLE, python: PYTHON });
const ESPERA_PRIMEIRA = 45000;   // quanto a abertura espera a primeira rodada (depois segue sem ela)

let janela = null;
let backend = null;
let origem = '';
let bootStatus = { fase: 'inicio', msg: 'iniciando…', erro: '', log: [] };
let saindo = false;
let backendParado = false;
let reinicios = 0;
let importando = null;          // AbortController da importacao em curso
let importacao = null;          // Promise da importacao em curso (a guarda do sincronismo espera)
let janelaConfig = null;
let janelaImport = null;
let janelaConexao = null;       // Conectar IA: o MCP e a conexao com o Nexo Hub (ui/conexao.html)
let avisoSync = '';             // o que a sincronizacao da pasta de trabalho precisa dizer
// A biblioteca do HUB QUE ESTA NO AR e a do servidor? E o que o guarda do sincronismo e a
// importacao seguem, e nao a configuracao salva: um reinicio recusado (vista com edicao
// pendente) deixa as duas diferentes, e um hub sem o libremota.py ignora a variavel.
let libRemotaNoAr = false;

// O app aberto, para o MCP (mcp/lib/contexto.js » sessaoDoApp): a pasta de trabalho e o hub no ar,
// em ~/.nexoeletric/session.json -- a mesma mecanica do ~/.nexocad/session.json do NexoCAD. Sem
// isso o MCP precisa de --root e acha o hub so sondando portas.
const ARQ_SESSAO = path.join(app.getPath('home'), '.nexoeletric', 'session.json');
function gravaSessao(ws) {
  try {
    fs.mkdirSync(path.dirname(ARQ_SESSAO), { recursive: true });
    fs.writeFileSync(ARQ_SESSAO, JSON.stringify({ app: 'nexoeletric', versao: app.getVersion(), hub: origem, root: ws,
      pid: process.pid, mcp: path.join(ws, 'mcp', 'eletrichub-mcp.js'), exe: process.execPath, iniciado: new Date().toISOString() }, null, 2));
  } catch (e) { log.warn('[mcp] session.json: ' + e.message); }
}
function apagaSessao() {
  try { const s = JSON.parse(fs.readFileSync(ARQ_SESSAO, 'utf8')); if (s.pid === process.pid) fs.rmSync(ARQ_SESSAO, { force: true }); } catch { /* ja saiu */ }
}

// A versao na barra de cima de TODA janela do app (a principal, Nova janela, as vistas abertas a
// parte, configuracoes): "Projeto · Documento — NexoEletric 1.19.0". O hub (hub-shell.js) ja poe
// "Projeto · Documento — NexoEletric" no titulo da pagina; aqui so entra o numero.
const VERSAO_APP = app.getVersion();
function tituloComVersao(t) {
  const s = String(t || '').trim();
  if (!s) return `NexoEletric ${VERSAO_APP}`;
  if (/NexoEletric \d/.test(s)) return s;
  if (/NexoEletric/.test(s)) return s.replace(/NexoEletric/, `NexoEletric ${VERSAO_APP}`);
  return `${s} — NexoEletric ${VERSAO_APP}`;
}
app.on('browser-window-created', (_e, w) => {
  w.setTitle(tituloComVersao(w.getTitle()));
  w.webContents.on('page-title-updated', (e, t) => { e.preventDefault(); if (!w.isDestroyed()) w.setTitle(tituloComVersao(t)); });
});

// ───────────────────────────── instancia unica ─────────────────────────────
// Duas copias disputariam a mesma porta e a mesma pasta de trabalho. Com a janela
// principal fechada e um pop-up do hub ainda aberto, o atalho traz o pop-up.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = (janela && !janela.isDestroyed()) ? janela
      : BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
    if (!w) return;
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  });
}

function logWs(m) { log.info('[workspace] ' + m); }

function status(fase, msg, extra = {}) {
  bootStatus = { ...bootStatus, fase, msg, erro: '', ...extra };
  log.info(`[boot] ${fase}: ${msg}${bootStatus.erro ? ' — ' + bootStatus.erro : ''}`);
  if (janela && !janela.isDestroyed()) janela.webContents.send('boot:status', bootStatus);
}

function dev(ws) { return workspace.isDevWorkspace(ws || settings.load().workspace); }
function noNexoBD(ws) { const s = settings.load(); return armazemNexoBD.ligado(s, dev(ws || s.workspace)); }

// Base das tres vias da importacao: o que o app semeou, nesta versao e nas anteriores.
function seedHashes() { return workspace.seedHashes(settings.load().workspace, BUNDLE); }

// Todo o ciclo de vida do hub (subir, reiniciar, cair e voltar) passa por esta fila. Dois
// "Tentar de novo" seguidos, ou uma queda no meio de um reinicio, nao podem criar dois
// hubservers disputando a mesma porta.
let ciclo = Promise.resolve();
function emSerie(f) {
  const p = ciclo.then(() => f());
  ciclo = p.catch(() => {});
  return p;
}

// ───────────────────────────── janela principal ─────────────────────────────
function criarJanela() {
  const s = settings.load();
  const w = s.window || {};
  janela = new BrowserWindow({
    x: w.x, y: w.y, width: w.width || 1480, height: w.height || 940,
    minWidth: 900, minHeight: 600,
    show: false,
    title: 'NexoEletric',
    icon: web.ICONE,
    backgroundColor: '#14161a',
    webPreferences: { ...web.webPreferencesHub(), preload: PRELOAD_UI },
  });
  if (w.maximized) janela.maximize();
  const esta = janela;
  esta.once('ready-to-show', () => esta.show());
  esta.on('close', () => {
    if (esta.isDestroyed()) return;
    const b = esta.getNormalBounds();
    settings.save({ window: { ...b, maximized: esta.isMaximized() } });
  });
  esta.on('closed', () => { if (janela === esta) janela = null; });
  menuNativoSoForaDoHub(esta);
  esta.webContents.on('render-process-gone', (_e, d) => {
    log.error('renderer caiu: ' + d.reason);
    if (d.reason !== 'clean-exit' && origem && !esta.isDestroyed()) esta.loadURL(origem + '/');
  });
  return janela;
}

async function carregarUi(nome, query = {}) {
  if (!janela || janela.isDestroyed()) criarJanela();
  await janela.loadFile(path.join(UI_DIR, nome), { query });
}

// ───────────────────────────── hub (Python) ─────────────────────────────
function envDoHub(ws) {
  const s = settings.load();
  const env = {};
  // O DbLib gerado AQUI tem de apontar o SQLite daqui (tools/almox/dblib.py). Numa pasta
  // de desenvolvedor (git) vale o comportamento de sempre: nada muda.
  if (!dev(ws)) env.ALTIUMHUB_DBLIB_DIR = path.join(ws, 'Libs', 'Almox');
  if (s.masterPassword) env.ALTIUMHUB_MASTER = s.masterPassword;
  // O BOM de referencia e o do servidor: o "Copiar link" e o "Abrir" do painel BOM apontam
  // para la (hubserver.py » ALTIUMHUB_BOM_LINK), onde a bancada abre e marca os vistos.
  // Este app so facilita o acesso ao hub; o link que circula e sempre o do servidor.
  if (s.serverUrl) env.ALTIUMHUB_BOM_LINK = s.serverUrl;
  // A biblioteca e a do servidor: ALTIUMHUB_LIB_REMOTA=serverUrl liga o repasse e o espelho
  // no hubserver (libremota.py). A decisao e uma so, a de lib/lib-remota.js. Com o NexoBD a
  // biblioteca e a do NexoBD: o hub fica no modo local e o armazem leva o que ele grava; o
  // ALTIUMHUB_NEXOBD faz o "excluir projeto" anotar o apagar no NexoBD.
  if (noNexoBD(ws)) env.ALTIUMHUB_NEXOBD = '1';
  else Object.assign(env, libRemota.envDoHub(s, dev(ws)));
  // Na rede, o chat passa a pedir a senha mestre (tools/chat/chatserver.py): aberto, ele
  // roda o claude nesta maquina a pedido de qualquer um que alcance a porta.
  if (s.lan) env.ALTIUMHUB_CHAT_SENHA = '1';
  // Motor "api" do chat, para quem nao tem o claude instalado (tools/chat/claude_api.py).
  const chave = settings.getSegredo('anthropicKey');
  if (chave) env.ANTHROPIC_API_KEY = chave;
  return env;
}

// O que o hub no ar diz da propria biblioteca (libremota.py). O 404 vem de um hub de antes
// do modo remoto, e em HTML: o json fica null e a decisao e do lib-remota.modoDoHub.
async function statusDaBiblioteca() {
  try {
    const r = await fetch(origem + '/api/lib-remota/status', { signal: AbortSignal.timeout(10000) });
    let json = null;
    try { json = await r.json(); } catch { /* corpo que nao e JSON */ }
    return { status: r.status, json };
  } catch (e) {
    log.warn('[lib-remota] o hub nao respondeu o status da biblioteca: ' + e.message);
    return null;
  }
}

// So chamada de dentro da fila (emSerie).
async function subirHub({ porta } = {}) {
  const s = settings.load();
  const ws = s.workspace;
  status('workspace', 'preparando a pasta de trabalho…');
  const r = workspace.sync(ws, BUNDLE, logWs);
  workspace.seedOdoo(ws, s, logWs);
  if (r.kept.length) log.warn('arquivos de codigo antigos mantidos por terem sido editados: ' + r.kept.join(', '));
  const avisos = [];
  if (r.falhas.length) {
    avisos.push(`${r.falhas.length} arquivo(s) do hub não foram atualizados por estarem em uso ` +
      `(${r.falhas.slice(0, 3).join(', ')}${r.falhas.length > 3 ? '…' : ''}). Feche o Altium e reabra o NexoEletric.`);
  }
  if (r.maisNova) {
    avisos.push(`a pasta de trabalho está com o código da versão ${r.maisNova}, mais nova que este app ` +
      `(${app.getVersion()}): atualize o NexoEletric nesta conta do Windows.`);
  }
  avisoSync = avisos.join(' ');

  if (noNexoBD(ws)) {
    status('nexobd', 'trazendo os projetos e a biblioteca do NexoBD…');
    const r = await Promise.race([
      armazem.iniciar(ws),
      new Promise((res) => setTimeout(() => res({ ok: true, esperando: true }), ESPERA_PRIMEIRA)),
    ]);
    if (r.esperando) log.warn('[nexobd] a primeira rodada passou do tempo: o hub abre e ela segue por trás');
    else if (!r.ok) {
      avisoSync = [avisoSync, `Sem o NexoBD agora (${r.erro}): o hub abre com a última cópia desta pasta, ` +
        'e o que você salvar sobe quando ele voltar.'].filter(Boolean).join(' ');
    }
  } else {
    armazem.parar();
  }

  status('python', 'subindo o hub…');
  libRemotaNoAr = false;
  if (backend) await backend.stop();              // o anterior sai primeiro (saida esperada)
  const envHub = envDoHub(ws);
  const b = new Backend({ python: PYTHON, workspace: ws, logDir: LOG_DIR, env: envHub });
  backend = b;
  backendParado = false;
  let noAr = false;
  // Queda = so do hub ATUAL e so depois de ele ter subido. Falha durante a subida quem
  // trata e quem esperou o start().
  b.on('exit', (ev) => {
    if (noAr && b === backend && !ev.esperado && !saindo) emSerie(() => (b === backend ? aoCairOHub(ev) : null));
  });
  b.on('log', (l) => { bootStatus.log = [...bootStatus.log.slice(-60), l]; });
  await b.start({ port: porta || s.port, lan: s.lan });
  noAr = true;
  origem = b.url();
  if (b.port !== s.port) {
    log.warn(`porta ${s.port} ocupada; o hub subiu na ${b.port} (preferencias do navegador ficam por porta)`);
  }
  const remotaPedida = Boolean(envHub.ALTIUMHUB_LIB_REMOTA);
  libRemotaNoAr = libRemota.modoDoHub(remotaPedida, remotaPedida ? await statusDaBiblioteca() : null);
  if (libRemotaNoAr) {
    log.info('[lib-remota] a biblioteca e a do servidor: ' + envHub.ALTIUMHUB_LIB_REMOTA);
  } else if (remotaPedida) {
    log.warn('[lib-remota] pedida, mas o hub respondeu que esta no modo local (hub sem libremota.py, ou endereco recusado)');
    avisoSync = [avisoSync, 'O hub não ligou a biblioteca do servidor: a biblioteca segue a deste PC ' +
      '(o motivo está em Ajuda › Abrir pasta de logs).'].filter(Boolean).join(' ');
  }
  // O hub cai sozinho no modo DEMO (projetos de mentira) se o /api/index.json falhar
  // (hub.html » API.index). Aquecer aqui garante que a primeira pagina ja o encontra.
  status('indice', 'lendo os projetos…');
  try {
    await fetch(origem + '/api/index.json', { signal: AbortSignal.timeout(30000) });
  } catch (e) {
    log.warn('aquecimento do indice falhou: ' + e.message);
  }
  // o sincronizador precisa do hub no ar (o 3D da PcbLib sai do hubserver sob demanda)
  nexoSync.iniciar(ws, origem);
  if (!SMOKE) gravaSessao(ws);
}

// So chamada de dentro da fila.
async function aoCairOHub({ code }) {
  if (saindo) return;
  log.error(`o hub caiu (codigo ${code})`);
  if (reinicios < 2) {
    reinicios++;
    const antiga = origem;
    const portaAntiga = backend ? backend.port : 0;
    try {
      // a mesma porta de antes, se estiver livre: origem igual = localStorage do hub igual
      await subirHub({ porta: portaAntiga });
      for (const w of BrowserWindow.getAllWindows()) {
        const url = w.webContents.getURL();
        if (!antiga || !web.mesmaOrigem(url, antiga)) continue;
        if (origem === antiga) { w.webContents.reload(); continue; }
        const u = new URL(url);
        w.loadURL(origem + u.pathname + u.search + u.hash);   // mesma pagina, porta nova
      }
      return;
    } catch (e) {
      log.error('reinicio falhou: ' + e.message);
    }
  }
  try {
    await carregarUi('splash.html');
  } catch { /* a pagina recusou sair (edicao pendente): o status fica para quando ela sair */ }
  status('erro', 'o hub parou de responder', { erro: `o processo Python terminou (codigo ${code}). Veja o log abaixo.` });
}

async function bootImpl() {
  reinicios = 0;
  try {
    await carregarUi('splash.html');
    await subirHub();
    status('pronto', 'abrindo o hub…');
    await janela.loadURL(origem + '/');
    if (avisoSync) setTimeout(() => toastNoHub(janela && janela.webContents, avisoSync, 'warn'), 1500);
    if (SMOKE) smoke();
  } catch (e) {
    log.error('boot: ' + (e.stack || e.message));
    status('erro', 'não consegui abrir o hub', { erro: e.message, log: backend ? backend.tail.slice(-60) : [] });
    if (SMOKE) fimSmoke({ ok: false, erro: e.message });
  }
}

function boot() { return emSerie(bootImpl); }

// Primeiro as paginas do hub saem (uma vista com edicao pendente pode recusar -- "Voltar e
// salvar" -- e ai o hub tem de continuar no ar para ela salvar); so depois o servidor para.
// Navegar uma janela cuja pagina recusou o beforeunload rejeita com ERR_ABORTED.
function reiniciarHub() {
  return emSerie(async () => {
    const outras = BrowserWindow.getAllWindows().filter((w) => w !== janela && w !== janelaConfig &&
      w !== janelaImport && !pickers.has(w.webContents.id));
    try {
      await carregarUi('splash.html');
      for (const w of outras) if (!w.isDestroyed()) await w.webContents.loadURL('about:blank');
    } catch (e) {
      log.warn('reinicio cancelado: ' + e.message);
      if (janela && !janela.isDestroyed() && origem && !web.mesmaOrigem(janela.webContents.getURL(), origem)) {
        janela.loadURL(origem + '/').catch(() => {});
      }
      return false;
    }
    for (const w of outras) if (!w.isDestroyed()) w.close();
    if (backend) await backend.stop();
    await bootImpl();
    return true;
  });
}

// ───────────────────────────── primeira execucao ─────────────────────────────
function precisaConfigurar() {
  const s = settings.load();
  if (process.env.ALTIUMHUB_WORKSPACE) {
    settings.save({ workspace: process.env.ALTIUMHUB_WORKSPACE, setupDone: true });
    return false;
  }
  return !s.setupDone || !s.workspace || !workspace.avaliar(s.workspace).ok;
}

// ───────────────────────────── configuracoes / importacao ─────────────────────────────
function abrirConfig() {
  if (janelaConfig && !janelaConfig.isDestroyed()) { janelaConfig.focus(); return; }
  janelaConfig = new BrowserWindow({
    parent: janela || undefined, modal: false, width: 760, height: 860, minWidth: 620, minHeight: 600,
    title: 'Configurações — NexoEletric', icon: web.ICONE, backgroundColor: '#14161a', show: false,
    autoHideMenuBar: true,
    webPreferences: { ...web.webPreferencesHub(), preload: PRELOAD_UI },
  });
  janelaConfig.removeMenu();
  janelaConfig.once('ready-to-show', () => janelaConfig.show());
  janelaConfig.on('closed', () => { janelaConfig = null; });
  janelaConfig.loadFile(path.join(UI_DIR, 'config.html'), { query: { modo: 'config' } });
}

function aviso(message, detail) {
  dialog.showMessageBox(janela || undefined, { type: 'info', title: 'NexoEletric', message, detail, buttons: ['OK'], noLink: true });
}

function abrirImportacao(opts = {}) {
  const s = settings.load();
  if (noNexoBD(s.workspace)) {
    aviso('Os projetos e a biblioteca vêm do NexoBD.',
      'Não há mais o que importar do servidor: o NexoEletric traz tudo do NexoBD sozinho (Arquivo › NexoBD: sincronizar agora).');
    return;
  }
  if (!s.setupDone || !s.workspace) {
    aviso('Escolha a pasta de trabalho primeiro.', 'Conclua a configuração inicial; ela oferece importar do servidor ao final.');
    return;
  }
  if (dev()) {
    aviso('A pasta de trabalho é um repositório git.',
      'Importar do servidor sujaria arquivos versionados. Use uma pasta de trabalho comum (Configurações).');
    return;
  }
  if (janelaImport && !janelaImport.isDestroyed()) { janelaImport.focus(); return; }
  janelaImport = new BrowserWindow({
    parent: janela || undefined, width: 720, height: 620, minWidth: 560, minHeight: 420,
    title: 'Importar do servidor — NexoEletric', icon: web.ICONE, backgroundColor: '#14161a', show: false,
    webPreferences: { ...web.webPreferencesHub(), preload: PRELOAD_UI },
  });
  janelaImport.removeMenu();
  janelaImport.once('ready-to-show', () => janelaImport.show());
  janelaImport.on('closed', () => { janelaImport = null; });
  janelaImport.loadFile(path.join(UI_DIR, 'import.html'), { query: { auto: opts.auto ? '1' : '' } });
}

async function rodarImportacao(grupos, progresso) {
  if (importando) throw new Error('já existe uma importação em andamento');
  const s = settings.load();
  // Sem pasta de trabalho, os caminhos cairiam na pasta do processo (a de instalacao).
  if (!s.setupDone || !s.workspace || !path.isAbsolute(s.workspace)) {
    throw new Error('termine a configuração inicial (pasta de trabalho) antes de importar');
  }
  // Com a biblioteca do servidor, 'libs' e 'almox' sao do espelho do hub: a tela ja os
  // desliga, e aqui e a defesa (uma janela aberta antes de a configuracao mudar ainda os manda).
  const g = libRemota.gruposDaImportacao(grupos, libRemotaNoAr);
  if (g.recusados.length) log.warn(`[import] biblioteca do servidor: grupos recusados ${g.recusados.join(', ')}`);
  if (!g.grupos.length) {
    throw new Error('a biblioteca já é a do servidor: o hub a mantém sozinho, e só projetos e as bibliotecas do almoxarifado para o Altium são importados');
  }
  importando = new AbortController();
  const p = importer.importar({
    ws: s.workspace, serverUrl: s.serverUrl, grupos: g.grupos, seedHashes: seedHashes(),
    progresso, signal: importando.signal,
  });
  importacao = p.catch(() => {});
  try {
    const res = await p;
    res.recusados = g.recusados;
    log.info(`[import] ${res.novos.length} novos, ${res.atualizados.length} atualizados, ` +
      `${res.conflitos.length} conflitos, ${res.erros.length} erros`);
    return res;
  } finally {
    importando = null;
    importacao = null;
  }
}

function toastNoHub(wc, msg, tipo) {
  if (!wc || wc.isDestroyed()) return;
  wc.executeJavaScript(`typeof toast === 'function' && toast(${JSON.stringify(msg)}, ${JSON.stringify(tipo)})`)
    .catch(() => {});
}

async function esperaImportacao(wc) {
  if (importando) toastNoHub(wc, 'esperando a importação em andamento terminar antes de sincronizar…', 'warn');
  while (importando) await importacao;
}

// Antes de o hub sincronizar o almoxarifado com o Odoo: traz do servidor o estado que o
// gerador le para numerar (livro-razao de part numbers, ledger dos desenhos, espelhos).
// Com o mesmo estado e o mesmo Odoo, a numeracao daqui e a do servidor saem iguais; sem
// isso, cada PC que sincroniza vira uma segunda autoridade dos part numbers. Importacao em
// andamento: espera ela terminar (sincronizar no meio dela e justamente numerar do estado
// velho). Nao deu para trazer o estado: pergunta, como quando o servidor nao responde.
//
// Com a biblioteca do servidor nada disso vale: o hub daqui repassa o POST e o sincronismo
// roda NO servidor, com o livro-razao e o Odoo de la. Trazer o estado antes seria um segundo
// escritor nos arquivos do espelho, e o "Sincronizar assim mesmo" nao teria o que oferecer
// (servidor fora, o hub recusa com 503 e nada e gravado).
async function antesDoSincronismo(d) {
  if (libRemotaNoAr) return true;
  const s = settings.load();
  // NexoBD: a biblioteca que numera e a do NexoBD. Traz a versao de la antes (outra maquina pode
  // ter sincronizado); o que o sincronismo gravar sobe sozinho depois.
  if (noNexoBD(s.workspace)) {
    const wc = d.webContents;
    toastNoHub(wc, 'trazendo a biblioteca do NexoBD antes de sincronizar com o Odoo…', 'info');
    const r = await armazem.agora('antes do sincronismo do Odoo');
    if (r.ok) return true;
    const win = (wc && BrowserWindow.fromWebContents(wc)) || janela;
    return dialog.showMessageBox(win, {
      type: 'warning', title: 'NexoEletric', message: 'Não consegui falar com o NexoBD.',
      detail: `${r.erro}\n\nSincronizar agora usa a biblioteca desta cópia; ela sobe para o NexoBD quando ele voltar.`,
      buttons: ['Sincronizar assim mesmo', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true,
    }).then((x) => x.response === 0);
  }
  if (!s.syncGuard || dev(s.workspace)) return true;
  const wc = d.webContents;
  const win = (wc && BrowserWindow.fromWebContents(wc)) || janela;
  const pergunta = (message, detail) => dialog.showMessageBox(win, {
    type: 'warning', title: 'NexoEletric', message,
    detail: `${detail}\n\nSincronizar agora usa só o estado local do almoxarifado. ` +
      'Componentes novos no Odoo podem receber part numbers diferentes dos que o servidor daria.',
    buttons: ['Sincronizar assim mesmo', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true,
  }).then((r) => r.response === 0);

  await esperaImportacao(wc);
  const t = await importer.testar(s.serverUrl);
  if (!t.ok) return pergunta('O servidor central não respondeu.', `${s.serverUrl}: ${t.erro}`);
  toastNoHub(wc, 'atualizando o almoxarifado a partir do servidor antes de sincronizar…', 'warn');
  let falha = '';
  try {
    await esperaImportacao(wc);                    // uma importacao manual comecou durante o teste
    const res = await rodarImportacao(['almox'], () => {});
    const errAlmox = res.erros.filter((e) => importer.ARQ_ALMOX.some((a) => e.startsWith(a + ':')));
    if (errAlmox.length) {
      falha = errAlmox.join('; ');
    } else {
      const n = res.novos.length + res.atualizados.length;
      toastNoHub(wc, n ? `estado do almoxarifado atualizado do servidor (${n} arquivo${n > 1 ? 's' : ''})`
        : 'almoxarifado já estava igual ao do servidor', 'ok');
    }
  } catch (e) {
    log.warn('pre-sincronismo: ' + e.message);
    falha = e.message;
  }
  if (falha) return pergunta('Não consegui trazer do servidor o estado do almoxarifado.', falha);
  return true;
}

// ───────────────────────────── seletor de tela (chat) ─────────────────────────────
// Um por janela que pediu: dois chats capturando ao mesmo tempo nao trocam de resposta.
const pickers = new Map();      // webContents.id do seletor -> {fontes, responde}
function escolherTela(sources, parent) {
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      parent: parent || janela || undefined, modal: true, width: 900, height: 620, minWidth: 600, minHeight: 400,
      title: 'Escolha o que capturar', icon: web.ICONE, backgroundColor: '#14161a', show: false,
      webPreferences: { ...web.webPreferencesHub(), preload: PRELOAD_UI },
    });
    const id = w.webContents.id;
    w.removeMenu();
    let fim = false;
    const responde = (escolha) => {
      if (fim) return;
      fim = true;
      pickers.delete(id);
      resolve(escolha);
      if (!w.isDestroyed()) w.close();
    };
    pickers.set(id, {
      fontes: sources.map((s) => ({ id: s.id, nome: s.name, tela: s.id.startsWith('screen:'), img: s.thumbnail.toDataURL() })),
      responde,
    });
    w.once('ready-to-show', () => w.show());
    w.on('closed', () => responde(null));
    w.loadFile(path.join(UI_DIR, 'picker.html'));
  });
}

// ───────────────────────────── menu ─────────────────────────────
// Atalhos de menu so disparam para tecla que a pagina NAO tratou (medido: com
// preventDefault na pagina, o do menu fica quieto). Por isso o Ctrl+R do editor de
// simbolos (girar) continua dele, e sem rascunho aberto vira recarregar -- como no Chrome.
function focada() {
  return BrowserWindow.getFocusedWindow() || janela;
}

/* Pedido do dono (2026-10-14): o menu do app (Arquivo, Exibir, Ajuda) vai para o topo da pagina,
   fundido com os menus do Altium da vista aberta e no tema do hub (hub-menubar.js). A barra nativa
   do Windows nao segue tema: ela some enquanto a janela mostra o hub e volta na tela de abertura
   (file://), onde nao ha barra na pagina. O menu continua registrado -- e dele que vem F5, F11,
   Ctrl+, e Ctrl+Shift+I. */
function menuNativoSoForaDoHub(w) {
  const ajusta = (url) => { if (!w.isDestroyed()) w.setMenuBarVisibility(!(origem && String(url || '').startsWith(origem))); };
  w.webContents.on('did-navigate', (_e, url) => ajusta(url));
  ajusta(w.webContents.getURL());
}

/* os comandos do menu, por nome: o menu nativo e a barra da pagina chamam os mesmos */
function acoesDoMenu() {
  const wc = () => { const w = focada(); return w ? w.webContents : null; };
  const zoom = (d) => { const c = wc(); if (c) c.setZoomLevel(d === 0 ? 0 : c.getZoomLevel() + d); };
  return {
    novaJanela: () => novaJanela(),
    abrirPasta: () => shell.openPath(settings.load().workspace),
    importar: () => abrirImportacao(),
    configHub: () => abrirConfigDoHub(),
    configApp: () => abrirConfig(),
    sair: () => app.quit(),
    recarregar: () => { const c = wc(); if (c) c.reload(); },
    recarregarSemCache: () => { const c = wc(); if (c) c.reloadIgnoringCache(); },
    zoomMais: () => zoom(0.5), zoomMenos: () => zoom(-0.5), zoom0: () => zoom(0),
    painelProjetos: () => { const c = wc(); if (c) c.executeJavaScript('window.EletricShell && EletricShell.alternarProjetos()').catch(() => {}); },
    telaCheia: () => { const w = focada(); if (w) w.setFullScreen(!w.isFullScreen()); },
    devtools: () => { const c = wc(); if (c) c.toggleDevTools(); },
    atualizacoes: () => verificarAtualizacoes(),
    log: () => shell.openPath(path.join(LOG_DIR, 'hub.log')),
    pastaLogs: () => shell.openPath(LOG_DIR),
    conectarIA: () => conectarIA(),
    nexoSync: () => sincronizarNexoHub(),
    nexobd: () => sincronizarNexoBD(),
    sobre: () => sobre(),
  };
}

function montarMenu() {
  const wc = () => { const w = focada(); return w ? w.webContents : null; };
  const zoom = (d) => { const c = wc(); if (c) c.setZoomLevel(d === 0 ? 0 : c.getZoomLevel() + d); };
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Nova janela', accelerator: 'CmdOrCtrl+Shift+N', click: () => novaJanela() },
        { type: 'separator' },
        { label: 'Abrir pasta de trabalho', click: () => shell.openPath(settings.load().workspace) },
        { label: 'NexoBD: sincronizar agora', click: () => sincronizarNexoBD() },
        { label: 'Importar do servidor…', visible: !noNexoBD(), click: () => abrirImportacao() },
        { label: 'Nexo Hub: sincronizar agora', click: () => sincronizarNexoHub() },
        { type: 'separator' },
        { label: 'Configurações do hub…', click: () => abrirConfigDoHub() },
        { label: 'Configurações do aplicativo…', accelerator: 'CmdOrCtrl+,', click: () => abrirConfig() },
        { type: 'separator' },
        { label: 'Sair', role: 'quit' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { label: 'Recarregar', accelerator: 'F5', click: () => { const c = wc(); if (c) c.reload(); } },
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', visible: false, click: () => { const c = wc(); if (c) c.reload(); } },
        { label: 'Recarregar sem cache', accelerator: 'CmdOrCtrl+F5', click: () => { const c = wc(); if (c) c.reloadIgnoringCache(); } },
        { label: 'Recarregar sem cache', accelerator: 'CmdOrCtrl+Shift+R', visible: false, click: () => { const c = wc(); if (c) c.reloadIgnoringCache(); } },
        { type: 'separator' },
        { label: 'Aumentar zoom', accelerator: 'CmdOrCtrl+=', click: () => zoom(0.5) },
        { label: 'Aumentar zoom', accelerator: 'CmdOrCtrl+Plus', visible: false, click: () => zoom(0.5) },
        { label: 'Diminuir zoom', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) },
        { label: 'Tamanho original', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
        { type: 'separator' },
        { label: 'Painel Projetos', accelerator: 'CmdOrCtrl+Alt+P', click: () => {
          const c = wc();
          if (c) c.executeJavaScript('window.EletricShell && EletricShell.alternarProjetos()').catch(() => {});
        } },
        { type: 'separator' },
        { label: 'Tela cheia', accelerator: 'F11', click: () => { const w = focada(); if (w) w.setFullScreen(!w.isFullScreen()); } },
        { type: 'separator' },
        { label: 'Ferramentas do desenvolvedor', accelerator: 'CmdOrCtrl+Shift+I', click: () => { const c = wc(); if (c) c.toggleDevTools(); } },
        { label: 'Ferramentas do desenvolvedor', accelerator: 'F12', visible: false, click: () => { const c = wc(); if (c) c.toggleDevTools(); } },
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        { label: 'Verificar atualizações…', click: () => verificarAtualizacoes() },
        { type: 'separator' },
        { label: 'Abrir log do hub', click: () => shell.openPath(path.join(LOG_DIR, 'hub.log')) },
        { label: 'Abrir pasta de logs', click: () => shell.openPath(LOG_DIR) },
        { type: 'separator' },
        { label: 'Conectar IA (MCP)…', click: () => conectarIA() },
        { label: 'Sobre o NexoEletric', click: () => sobre() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function novaJanela() {
  if (!origem) return null;
  const w = new BrowserWindow({
    width: 1400, height: 900, icon: web.ICONE, backgroundColor: '#14161a',
    webPreferences: { ...web.webPreferencesHub(), preload: PRELOAD_UI },
  });
  menuNativoSoForaDoHub(w);
  w.loadURL(origem + '/');
  return w;
}

// Arquivo › Configurações do hub… e a UNICA porta das configuracoes do hub dentro do app: o ⚙ do
// canto das abas so existe no navegador (hub-shell.js » NO_APP). Por isso ela procura o hub onde
// ele estiver: a janela em foco, a principal, qualquer "Nova janela" -- trazendo para a frente a
// que abriu. Sem nenhuma (so sobrou um popup da vista Esquema, ou a principal foi fechada), abre
// uma janela nova do hub ja com as configuracoes. A casca pode estar montando (o indice chega
// depois do load), entao o teste exige a casca montada e a janela nova tenta por alguns segundos.
const ABRE_CONFIG_DO_HUB = 'Boolean(window.EletricShell && document.body.classList.contains("eh-shell")'
  + ' && (EletricShell.configuracoes(), true))';
function tentaConfigDoHub(w) {
  if (!w || w.isDestroyed()) return Promise.resolve(false);
  // janela travada ou ainda carregando nao pode segurar o menu para sempre
  return Promise.race([
    w.webContents.executeJavaScript(ABRE_CONFIG_DO_HUB).catch(() => false),
    new Promise((r) => setTimeout(() => r(false), 1500)),
  ]);
}
async function abrirConfigDoHub() {
  const f = focada();
  const ordem = [f, janela, ...BrowserWindow.getAllWindows()]
    .filter((w, i, a) => w && !w.isDestroyed() && a.indexOf(w) === i);
  for (const w of ordem) {
    if (!(await tentaConfigDoHub(w))) continue;
    if (w !== f) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
    return;
  }
  const w = novaJanela();
  if (!w) {
    aviso('O hub não está rodando.', 'Reinicie o NexoEletric para abrir as configurações do hub.');
    return;
  }
  for (let i = 0; i < 40 && !w.isDestroyed(); i++) {
    await new Promise((r) => setTimeout(r, 300));
    if (await tentaConfigDoHub(w)) return;
  }
}

/* O MCP do NexoEletric e a conexao com o Nexo Hub: a tela "Conectar IA" (ui/conexao.html), no desenho da do NexoCAD
   (Avaliar › Conectar IA). O MCP da a IA (Claude Code, Claude Desktop...) as ferramentas para operar projeto, esquema,
   PCB, regras/DRC, pour, ECO, Gerber e PDF; o servidor roda no proprio Electron como Node (ELECTRON_RUN_AS_NODE). A
   conexao: o NexoEletric fala so com o Nexo Hub (conexao.json); o banco (NexoBD) e do Hub, e a tela so mostra o que
   o Hub reporta dele. Ate a 1.28 isto era uma caixa de mensagem do Windows. */
function conectarIA() {
  if (janelaConexao && !janelaConexao.isDestroyed()) { janelaConexao.show(); janelaConexao.focus(); return; }
  janelaConexao = new BrowserWindow({
    parent: janela || undefined, modal: false, width: 800, height: 880, minWidth: 600, minHeight: 520,
    title: 'Conectar IA — NexoEletric', icon: web.ICONE, backgroundColor: '#1a1a1d', show: false,
    autoHideMenuBar: true,
    webPreferences: { ...web.webPreferencesHub(), preload: PRELOAD_UI },
  });
  janelaConexao.removeMenu();
  janelaConexao.once('ready-to-show', () => janelaConexao.show());
  janelaConexao.on('closed', () => { janelaConexao = null; });
  janelaConexao.loadFile(path.join(UI_DIR, 'conexao.html'));
}

function mcpDestaInstalacao() {
  return conexaoIA.entradaMcp({ packaged: EMBUTIDO, exe: process.execPath, resourcesPath: process.resourcesPath, repo: path.join(__dirname, '..') });
}

// O que a tela mostra (ela pergunta a cada 3 s enquanto esta aberta). registro=true tambem le os arquivos dos
// clientes de IA (o ~/.claude.json pode ter megabytes: so na abertura, depois de registrar e de tempos em tempos).
async function estadoConexao(registro) {
  const s = settings.load();
  const entrada = mcpDestaInstalacao();
  const con = conexaoIA.lerConexao();
  const [hub, atividade] = await Promise.all([
    conexaoIA.saudeHub({ url: con.url, token: con.token }),
    origem ? fetch(origem + '/api/mcp/atividade?desde=0', { signal: AbortSignal.timeout(2000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
  ]);
  return {
    versao: app.getVersion(),
    hubLocal: origem,
    hub: { ...hub, origem: con.origem, arquivo: con.arquivo, temToken: Boolean(con.token) },
    armazem: { ligado: s.workspace ? noNexoBD(s.workspace) : false, dev: s.workspace ? dev(s.workspace) : false, ...armazem.status() },
    nexoSync: nexoSync.status(),
    mcp: {
      entrada, ...conexaoIA.textosMcp(entrada), instalado: EMBUTIDO,
      registro: registro ? conexaoIA.estadoRegistro(entrada) : null,
      sessoes: (atividade && atividade.sessoes) || [],
      atividade: ((atividade && atividade.itens) || []).slice(-60),
      rotaAtividade: Boolean(atividade),
    },
  };
}

// "Tentar de novo": uma rodada ja dos projetos/biblioteca e da biblioteca 3D/placas, as duas pelo Nexo Hub.
async function tentarConexao() {
  const s = settings.load();
  const [projetos, sync] = await Promise.all([
    s.workspace && noNexoBD(s.workspace) ? armazem.agora('pedido') : Promise.resolve(null),
    nexoSync.agora().catch((e) => ({ ok: false, erro: e.message })),
  ]);
  return { projetos, nexoSync: sync };
}

// O app Nexo Hub desta maquina (C:\Program Files\NexoHub, pelo nexo-programa.json dele): abrir sobe a ponte.
async function abrirNexoHub() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const exe = [path.join(pf, 'NexoHub', 'NexoHub.exe'), path.join(pf, 'Nexo Hub', 'Nexo Hub.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'NexoHub', 'NexoHub.exe')].find((x) => fs.existsSync(x));
  if (!exe) throw new Error('não achei o Nexo Hub instalado nesta máquina');
  const erro = await shell.openPath(exe);
  if (erro) throw new Error('não consegui abrir o Nexo Hub: ' + erro);
  log.info('[conexao] abrindo o Nexo Hub: ' + exe);
  return { exe };
}

// Fora do ar, o armazem so anotava o erro no log a cada 2 min e a pessoa nao ficava sabendo. A MUDANCA (caiu, voltou)
// vira uma notificacao no hub, uma vez; o estado completo e o "Tentar de novo" ficam na tela Conectar IA.
function vigiarConexao() {
  let antes = '';
  const t = setInterval(() => {
    const st = armazem.status();
    const f = st.fase === 'erro' ? 'erro' : st.fase === 'em dia' ? 'ok' : '';
    if (!f || f === antes) return;
    const era = antes;
    antes = f;
    const wc = janela && !janela.isDestroyed() ? janela.webContents : null;
    if (f === 'erro') toastNoHub(wc, `Projetos e biblioteca sem o Nexo Hub (${st.erro}). Você segue na cópia desta pasta e o que salvar sobe quando ele voltar — Ajuda › Conectar IA (MCP) mostra o estado e tenta de novo.`, 'warn');
    else if (era === 'erro') toastNoHub(wc, 'Nexo Hub de volta: projetos e biblioteca em dia', 'ok');
  }, 5000);
  if (t.unref) t.unref();
}

// Arquivo › Nexo Hub: sincronizar agora. O resultado vai na notificacao do hub e no log.
async function sincronizarNexoHub() {
  const wc = focada() && focada().webContents;
  toastNoHub(wc, 'Nexo Hub: sincronizando a biblioteca 3D e as placas…', 'info');
  const r = await nexoSync.agora();
  const m = r.resumo && r.resumo.modelos, p = r.resumo && r.resumo.placas;
  if (r.ok) toastNoHub(wc, 'Nexo Hub: ' + (m ? m.total + ' modelos (' + m.enviados + ' enviados)' : '') + (p ? ', ' + p.total + ' placas (' + p.publicadas + ' revisões novas)' : ''), 'ok');
  else toastNoHub(wc, 'Nexo Hub: ' + (r.erro || 'não sincronizou'), 'warn');
}

// Arquivo › NexoBD: sincronizar agora (projetos e biblioteca).
async function sincronizarNexoBD() {
  const wc = focada() && focada().webContents;
  if (!noNexoBD()) { toastNoHub(wc, 'NexoBD desligado nesta pasta de trabalho (pasta de desenvolvedor ou configuração)', 'warn'); return; }
  toastNoHub(wc, 'NexoBD: sincronizando projetos e biblioteca…', 'info');
  const r = await armazem.agora('pedido');
  const x = r.resumo;
  if (r.ok) toastNoHub(wc, `NexoBD: ${x.projetos} projeto(s), biblioteca ${x.biblioteca} — ${x.baixados} arquivo(s) baixado(s), ${x.subidos} subido(s)` + (x.conflitos.length ? ` · ${x.conflitos.length} conflito(s) guardado(s)` : ''), x.conflitos.length ? 'warn' : 'ok');
  else toastNoHub(wc, 'Projetos e biblioteca (Nexo Hub): ' + r.erro + ' — Ajuda › Conectar IA (MCP) mostra o estado e tenta de novo', 'warn');
}

function sobre() {
  const b = buildInfo.get();
  const s = settings.load();
  const u = updater.status();
  dialog.showMessageBox(focada(), {
    type: 'info', title: 'Sobre o NexoEletric', message: `NexoEletric ${b.version}`,
    detail: [
      `commit ${b.commit ? b.commit.slice(0, 10) : '?'}${b.builtAt ? ` · build ${b.builtAt.slice(0, 16).replace('T', ' ')}` : ''}`,
      `Python ${b.python || '3.12 (embutido)'} · Electron ${process.versions.electron}`,
      '',
      `pasta de trabalho: ${s.workspace}${dev(s.workspace) ? '  (repositório git: modo desenvolvedor)' : ''}`,
      `hub: ${origem || '—'}${s.lan ? '  (compartilhado na rede)' : ''}`,
      `servidor central: ${s.serverUrl}`,
      `biblioteca: ${noNexoBD(s.workspace) ? 'a do NexoBD (esta pasta guarda a cópia)' : libRemotaNoAr ? 'a do servidor (esta pasta guarda a cópia para leitura)' : 'a desta pasta de trabalho'}`,
      `projetos e biblioteca (pelo Nexo Hub): ${noNexoBD(s.workspace) ? armazem.resumoTexto() : 'desligado'}`,
      `Odoo: ${s.odooUrl} (${s.odooDb})`,
      `Nexo Hub: ${nexoSync.resumoTexto()}`,
      `última importação: ${importer.ultimaImportacao(s.workspace) || 'nunca'}`,
      '',
      `atualização: ${u.fase}${u.versao ? ' ' + u.versao : ''}${u.erro ? ' — ' + u.erro : ''}`,
    ].join('\n'),
    buttons: ['OK'], noLink: true,
  });
}

// A instalacao da atualizacao NAO derruba o hub por conta propria: "Reiniciar agora" vira
// um app.quit() comum, e o hub so para no will-quit (la embaixo), quando todas as janelas
// ja aceitaram fechar. Derrubar antes deixava a vista com edicao pendente sem hub para
// salvar -- e o instalador a matava segundos depois.
const opcoesUpdater = {
  token: () => settings.getUpdateToken() || buildInfo.get().updateToken,
  enabled: () => settings.load().autoUpdate,
};

async function verificarAtualizacoes() {
  const st = await updater.verificar(opcoesUpdater, true);
  const w = focada();
  const msg = {
    atualizado: [`Você está na versão mais recente (${app.getVersion()}).`, ''],
    baixando: [`Baixando a versão ${st.versao}…`, 'Quando terminar, o app pergunta se pode reiniciar.'],
    pronto: [`A versão ${st.versao} já foi baixada.`, 'Ela é instalada quando o app fechar.'],
    'sem-token': ['Atualização automática sem token.', 'Informe um token de leitura do GitHub em Configurações.'],
    desligado: ['Atualização automática indisponível.', st.erro],
    erro: ['Não consegui verificar atualizações.', st.erro],
    verificando: ['Verificando…', ''],
  }[st.fase] || [st.fase, st.erro];
  const botoes = st.fase === 'sem-token' ? ['Abrir configurações', 'Fechar'] : ['OK'];
  const r = await dialog.showMessageBox(w, { type: st.fase === 'erro' ? 'warning' : 'info', title: 'NexoEletric', message: msg[0], detail: msg[1], buttons: botoes, noLink: true });
  if (st.fase === 'sem-token' && r.response === 0) abrirConfig();
}

// ───────────────────────────── IPC das telas locais (ui/) ─────────────────────────────
// So as paginas de ui/ (file://) falam com o processo principal. O hub (http) nunca: o
// preload so expoe a ponte em file://, e aqui cada chamada confere de novo a origem.
function daUi(e) {
  const url = (e.senderFrame && e.senderFrame.url) || '';
  if (!url.startsWith(UI_URL)) throw new Error('chamada recusada: ' + url);
}

function handle(canal, fn) {
  ipcMain.handle(canal, async (e, ...args) => {
    daUi(e);
    return fn(e, ...args);
  });
}

function registrarIpc() {
  ipcMain.handle('menu:acao', (e, id) => {
    const url = (e.senderFrame && e.senderFrame.url) || '';
    if (!origem || !url.startsWith(origem)) throw new Error('chamada recusada: ' + url);
    const f = acoesDoMenu()[id];
    if (typeof f !== 'function') throw new Error('comando desconhecido: ' + id);
    f();
    return true;
  });
  handle('boot:estado', () => bootStatus);
  handle('boot:tentar', () => { boot(); return true; });
  handle('boot:log', () => shell.openPath(path.join(LOG_DIR, 'hub.log')));
  handle('boot:config', () => { abrirConfig(); return true; });

  handle('config:ler', () => {
    const s = settings.load();
    const b = buildInfo.get();
    return {
      ...settings.publicView(),
      versao: b.version,
      commit: b.commit,
      dev: s.workspace ? dev(s.workspace) : false,
      // a do hub no ar (a importacao segue esta); a caixa das configuracoes mostra libRemota
      remota: libRemotaNoAr,
      altium: altiumHome.status(s.workspace),
      nexobd: s.workspace ? noNexoBD(s.workspace) : s.nexobd !== false,
      nexobdEstado: armazem.resumoTexto(),
      ultimaImportacao: s.workspace ? importer.ultimaImportacao(s.workspace) : '',
      atualizacao: updater.status(),
      tokenEmbutido: Boolean(b.updateToken),
    };
  });
  handle('config:escolherPasta', async (e, atual) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Pasta de trabalho do NexoEletric', defaultPath: atual || settings.workspacePadrao(),
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    });
    return r.canceled ? '' : r.filePaths[0];
  });
  handle('config:avaliarPasta', (_e, ws) => workspace.avaliar(ws));
  handle('config:testarServidor', (_e, url) => importer.testar(url));
  handle('config:salvar', async (e, d) => salvarConfig(e, d));
  handle('config:verificarAtualizacoes', async () => updater.verificar(opcoesUpdater, true));
  handle('config:conectarIA', () => { conectarIA(); return true; });

  // a tela Conectar IA (ui/conexao.html)
  handle('conexao:estado', (_e, registro) => estadoConexao(Boolean(registro)));
  handle('conexao:tentar', () => tentarConexao());
  handle('conexao:registrar', async () => {
    const r = await conexaoIA.registrar(mcpDestaInstalacao());
    log.info(`[conexao] MCP registrado: Claude Code ${r.claudeCode.estado}; Claude Desktop ${r.claudeDesktop.map((d) => d.estado).join(', ') || 'não instalado'}`);
    return r;
  });
  handle('conexao:gravar', async (_e, d) => {
    const c = conexaoIA.gravarConexao({ url: d && d.url, token: d && d.token });
    log.info('[conexao] Nexo Hub em ' + c.url + ' (' + c.arquivo + ')');
    const saude = await conexaoIA.saudeHub({ url: c.url, token: c.token });
    if (saude.conectado) tentarConexao().catch(() => {});
    return saude;
  });
  handle('conexao:abrirHub', () => abrirNexoHub());
  handle('conexao:copiar', (_e, texto) => { clipboard.writeText(String(texto || '').slice(0, 20000)); return true; });
  handle('conexao:pastaLogs', () => shell.openPath(LOG_DIR));

  handle('import:iniciar', async (e, grupos) => {
    const wc = e.sender;
    const envia = (ev) => { if (!wc.isDestroyed()) wc.send('import:progresso', ev); };
    return rodarImportacao(grupos, envia);
  });
  handle('import:cancelar', () => { if (importando) importando.abort(); return true; });
  handle('import:abrirPasta', (_e, p) => {
    const ws = settings.load().workspace;
    if (p && path.resolve(p).startsWith(path.resolve(ws))) shell.openPath(p);
    return true;
  });

  handle('picker:fontes', (e) => { const p = pickers.get(e.sender.id); return p ? p.fontes : []; });
  handle('picker:escolher', (e, id) => { const p = pickers.get(e.sender.id); if (p) p.responde(id || null); return true; });
}

function validarUrl(u, nome) {
  let x;
  try { x = new URL(String(u || '').trim()); } catch { throw new Error(`${nome}: endereço inválido`); }
  if (x.protocol !== 'http:' && x.protocol !== 'https:') throw new Error(`${nome}: use http:// ou https://`);
  return x.origin;
}

async function salvarConfig(e, d) {
  const antes = settings.load();
  // Modo boas-vindas = quem pergunta e a janela principal (a unica que carrega config.html
  // ali). So o flag salvo nao basta: um "Começar" que falhou depois de gravar setupDone
  // (home.txt de outra conta, por exemplo) deixaria o segundo clique sem subir nada.
  const setup = !antes.setupDone || Boolean(janela && !janela.isDestroyed() && e.sender === janela.webContents);
  const ws = path.resolve(String(d.workspace || '').trim() || settings.workspacePadrao());
  const av = workspace.avaliar(ws);
  if (!av.ok) throw new Error(av.motivo);
  const port = Number(d.port) || antes.port;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('porta: use um número entre 1024 e 65535');
  const novo = {
    workspace: ws,
    port,
    lan: Boolean(d.lan),
    serverUrl: validarUrl(d.serverUrl, 'servidor central'),
    odooUrl: validarUrl(d.odooUrl, 'Odoo'),
    odooDb: String(d.odooDb || '').trim() || antes.odooDb,
    autoUpdate: Boolean(d.autoUpdate),
    libRemota: d.libRemota !== false,
    // guardado mesmo sem efeito (biblioteca do servidor): volta a valer se ela for desligada
    syncGuard: d.syncGuard !== false,
    masterPassword: typeof d.masterPassword === 'string' ? d.masterPassword.trim() : antes.masterPassword,
    setupDone: true,
  };
  // Na rede, a senha padrao do hub (a que esta no git) trancaria o "Excluir projeto" e o
  // chat contra ninguem.
  if (novo.lan && !novo.masterPassword) {
    throw new Error('para compartilhar na rede, defina uma senha mestre própria (Rede e segurança)');
  }
  // O ApplyChanges/ExportBoard/... reescrevem sozinhos esse home= para o servidor
  // (RaizAposentada nos .pas): apontar para ca duraria ate a primeira exportacao.
  // Com o NexoBD o home.txt e do Nexo Hub (a pasta do Altium dele): o app nao mexe mais nele.
  if (armazemNexoBD.ligado({ ...antes, ...novo }, workspace.isDevWorkspace(ws))) { d.apontarAltium = false; d.voltarAltiumServidor = false; d.importar = false; }
  if (d.apontarAltium && altiumHome.aposentada(ws)) {
    throw new Error(`os scripts do Altium trocam ${ws} pelo servidor sozinhos (caminho aposentado em 2026-09-15); use outra pasta de trabalho`);
  }
  // A pasta aceita gravacao? Melhor saber aqui do que no meio da primeira sincronizacao.
  try {
    fs.mkdirSync(ws, { recursive: true });
    const sonda = path.join(ws, `.altiumhub-sonda-${process.pid}`);
    fs.writeFileSync(sonda, 'ok');
    fs.rmSync(sonda, { force: true });
  } catch (err) {
    throw new Error(`não consigo gravar em ${ws}: ${err.code || err.message}. Escolha outra pasta de trabalho.`);
  }
  const chaveAntes = settings.getSegredo('anthropicKey');
  if (typeof d.updateToken === 'string' && d.updateToken.trim()) settings.setUpdateToken(d.updateToken);
  if (d.apagarToken) settings.setUpdateToken('');
  if (typeof d.anthropicKey === 'string' && d.anthropicKey.trim()) settings.setSegredo('anthropicKey', d.anthropicKey);
  if (d.apagarChaveApi) settings.setSegredo('anthropicKey', '');
  settings.save(novo);

  // serverUrl e libRemota entram no env do hub (ALTIUMHUB_BOM_LINK, ALTIUMHUB_LIB_REMOTA): so
  // valem num hub novo. A pasta tambem conta, porque decide o modo desenvolvedor.
  const reinicia = setup || ws !== antes.workspace || port !== antes.port || novo.lan !== antes.lan ||
    novo.serverUrl !== antes.serverUrl || novo.libRemota !== (antes.libRemota !== false) ||
    novo.masterPassword !== antes.masterPassword || settings.getSegredo('anthropicKey') !== chaveAntes;

  // O home.txt so muda DEPOIS de a pasta ter o AI-GUIDE.md (o HomeValida dos .pas).
  const apontar = async () => {
    if (!d.apontarAltium) return;
    try {
      if (!fs.existsSync(path.join(ws, altiumHome.MARCA))) workspace.sync(ws, BUNDLE, logWs);
      altiumHome.set(ws);
      log.info('home.txt apontado para ' + ws);
    } catch (err) {
      log.error('home.txt: ' + err.message);
      // O ProgramData da a cada arquivo o dono que o criou: se foi outra conta do Windows,
      // esta nao reescreve (EPERM). Dizer isso economiza a caca ao chmod.
      const dica = err.code === 'EPERM' || err.code === 'EACCES'
        ? ' — o arquivo foi criado por outra conta do Windows; peça a ela, ou a um administrador, para editar a linha home='
        : '';
      throw new Error(`não consegui gravar ${altiumHome.ARQ}: ${err.code || err.message}${dica}`);
    }
  };
  if (d.voltarAltiumServidor) altiumHome.set(altiumHome.SERVIDOR);

  if (setup) {
    await apontar();
    await boot();
    if (d.importar && !dev(ws)) abrirImportacao({ auto: true });
    return { ok: true };
  }
  await apontar();
  const w = BrowserWindow.fromWebContents(e.sender);
  if (reinicia) {
    if (w && w !== janela) w.close();
    const ok = await reiniciarHub();
    if (!ok) {
      aviso('Configurações salvas, mas o hub não foi reiniciado.',
        'Há edições não salvas numa vista. Salve-as e reabra o NexoEletric para aplicar a mudança.');
    }
    return { ok: true, reiniciou: ok };
  }
  return { ok: true, reiniciou: false };
}

// ───────────────────────────── smoke test (build) ─────────────────────────────
// ALTIUMHUB_SMOKE=<arquivo.json>: sobe, abre o hub, confere o basico e sai.
async function smoke() {
  const r = { ok: false };
  try {
    await new Promise((res) => setTimeout(res, 4000));
    const wc = janela.webContents;
    r.url = wc.getURL();
    r.page = await wc.executeJavaScript(`(async () => {
      const idx = await fetch('/api/index.json').then(r => r.json());
      await document.fonts.ready;
      return {
        title: document.title,
        demo: typeof S !== 'undefined' ? !!S.demoMode : null,
        projects: idx.projects.map(p => p.name),
        hubCore: typeof HubCore,
        inter: document.fonts.check('12px Inter'),
        lista: (await fetch('/api/lista/config')).status,
        simbolos: (await fetch('/api/symbols/footprints')).status,
        chat: (await fetch('/api/chat/estado', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'})).status,
      };
    })()`);
    r.hubLog = backend ? backend.tail.slice(-30) : [];
    // informativo: o build depois do merge do backend deve dizer true (com a configuracao padrao)
    r.libRemota = libRemotaNoAr;
    r.configPeloMenu = await smokeConfigPeloMenu();
    r.ok = r.page.demo === false && r.page.hubCore === 'object'
      && r.configPeloMenu.principal === true && r.configPeloMenu.semPrincipal === true;
  } catch (e) {
    r.erro = e.message;
  }
  fimSmoke(r);
}

// Arquivo › Configurações do hub…, clicado como pelo menu. Primeiro com a janela principal; depois
// com ela FECHADA e so um popup da vista Esquema aberto -- ali o item tem de abrir uma janela nova
// do hub, e nao ficar calado. Fecha a principal, entao roda por ultimo (o smoke sai logo depois).
async function smokeConfigPeloMenu() {
  const espera = (ms) => new Promise((res) => setTimeout(res, ms));
  const item = Menu.getApplicationMenu().items.find((i) => i.label === 'Arquivo').submenu.items
    .find((i) => i.label === 'Configurações do hub…');
  const temConfig = (w) => w.webContents.executeJavaScript("!!document.querySelector('.cfgm')").catch(() => false);
  const out = {};
  item.click();
  await espera(800);
  out.principal = await temConfig(janela);
  const pop = new BrowserWindow({ show: false, webPreferences: web.webPreferencesHub() });
  await pop.loadURL(origem + '/schframe.html');
  janela.destroy();
  item.click();
  await espera(8000);
  const nova = BrowserWindow.getAllWindows().find((w) => w !== pop && !w.isDestroyed());
  out.semPrincipal = nova ? await temConfig(nova) : false;
  return out;
}

function fimSmoke(r) {
  try { fs.writeFileSync(SMOKE, JSON.stringify(r, null, 2)); } catch { /* sem destino */ }
  saindo = true;
  app.quit();
}

// ───────────────────────────── ciclo de vida ─────────────────────────────
app.whenReady().then(async () => {
  web.preparar(session.defaultSession, {
    origem: () => origem,
    escolherTela,
    antesDoSincronismo,
  });
  app.on('web-contents-created', (_e, wc) => web.endurecer(wc, { origem: () => origem, uiUrl: UI_URL }));
  registrarIpc();
  montarMenu();
  vigiarConexao();
  criarJanela();
  if (precisaConfigurar()) {
    await carregarUi('config.html', { modo: 'setup' });
  } else {
    await boot();
  }
  updater.iniciar(opcoesUpdater);
});

app.on('window-all-closed', () => app.quit());

// will-quit, e nao before-quit: o before-quit vem ANTES de as janelas fecharem, e uma vista
// com edicao pendente ainda pode recusar ("Voltar e salvar") -- com o hub ja derrubado ela
// nao teria onde salvar. O will-quit so vem quando todas aceitaram fechar. So entao o hub
// para e, se "Reiniciar agora" foi pedido, o instalador da atualizacao roda.
app.on('will-quit', (e) => {
  apagaSessao();
  nexoSync.parar();
  armazem.parar();
  if (backendParado || !backend) {
    updater.instalarSePedido();
    return;
  }
  e.preventDefault();
  saindo = true;
  backend.stop().finally(() => {
    backendParado = true;
    if (!updater.instalarSePedido()) app.quit();
  });
});
