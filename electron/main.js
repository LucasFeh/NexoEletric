'use strict';
// EletricHUB desktop: o hub do AltiumPCBMirror numa janela propria.
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
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell, clipboard } = require('electron');

// Testes/automacao: pasta de dados propria ANTES de qualquer uso do userData.
if (process.env.ALTIUMHUB_USERDATA) {
  app.setPath('userData', process.env.ALTIUMHUB_USERDATA);
} else {
  // O app se chamava AltiumHub ate a 1.0.2, e o userData segue o nome do produto: sem isto a
  // atualizacao abriria como instalacao nova -- sem a pasta de trabalho configurada e sem as
  // preferencias do hub (o localStorage mora ali). A pasta antiga muda de nome uma vez; se
  // o Windows recusar (algo ainda segurando um arquivo), o app continua usando a antiga.
  const appData = app.getPath('appData');
  const nova = path.join(appData, app.getName());                                   // EletricHUB
  const antiga = path.join(appData, app.getName().replace(/^EletricHUB/, 'AltiumHub')); // AltiumHub
  try {
    if (antiga !== nova && !fs.existsSync(nova) && fs.existsSync(antiga)) fs.renameSync(antiga, nova);
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

web.registrarEsquemas();

const UI_DIR = path.join(__dirname, 'ui');
const UI_URL = pathToFileURL(UI_DIR).href;
const PRELOAD_UI = path.join(UI_DIR, 'preload.js');
const EMBUTIDO = app.isPackaged;
const PYTHON = process.env.ALTIUMHUB_PYTHON ||
  (EMBUTIDO ? path.join(process.resourcesPath, 'python', 'python.exe') : path.join(__dirname, 'build', 'python', 'python.exe'));
const BUNDLE = EMBUTIDO ? path.join(process.resourcesPath, 'hub') : path.join(__dirname, 'build', 'hub');
const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const SMOKE = process.env.ALTIUMHUB_SMOKE || '';

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
let avisoSync = '';             // o que a sincronizacao da pasta de trabalho precisa dizer
// A biblioteca do HUB QUE ESTA NO AR e a do servidor? E o que o guarda do sincronismo e a
// importacao seguem, e nao a configuracao salva: um reinicio recusado (vista com edicao
// pendente) deixa as duas diferentes, e um hub sem o libremota.py ignora a variavel.
let libRemotaNoAr = false;

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
    title: 'EletricHUB',
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
  esta.webContents.on('page-title-updated', (e, t) => {
    e.preventDefault();
    // o hub (hub-shell.js) ja poe "Projeto · Documento — EletricHUB" no titulo
    esta.setTitle(t ? (/EletricHUB/.test(t) ? t : `${t} — EletricHUB`) : 'EletricHUB');
  });
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
  // no hubserver (libremota.py). A decisao e uma so, a de lib/lib-remota.js.
  Object.assign(env, libRemota.envDoHub(s, dev(ws)));
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
      `(${r.falhas.slice(0, 3).join(', ')}${r.falhas.length > 3 ? '…' : ''}). Feche o Altium e reabra o EletricHUB.`);
  }
  if (r.maisNova) {
    avisos.push(`a pasta de trabalho está com o código da versão ${r.maisNova}, mais nova que este app ` +
      `(${app.getVersion()}): atualize o EletricHUB nesta conta do Windows.`);
  }
  avisoSync = avisos.join(' ');

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
    title: 'Configurações — EletricHUB', icon: web.ICONE, backgroundColor: '#14161a', show: false,
    autoHideMenuBar: true,
    webPreferences: { ...web.webPreferencesHub(), preload: PRELOAD_UI },
  });
  janelaConfig.removeMenu();
  janelaConfig.once('ready-to-show', () => janelaConfig.show());
  janelaConfig.on('closed', () => { janelaConfig = null; });
  janelaConfig.loadFile(path.join(UI_DIR, 'config.html'), { query: { modo: 'config' } });
}

function aviso(message, detail) {
  dialog.showMessageBox(janela || undefined, { type: 'info', title: 'EletricHUB', message, detail, buttons: ['OK'], noLink: true });
}

function abrirImportacao(opts = {}) {
  const s = settings.load();
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
    title: 'Importar do servidor — EletricHUB', icon: web.ICONE, backgroundColor: '#14161a', show: false,
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
  if (!s.syncGuard || dev(s.workspace)) return true;
  const wc = d.webContents;
  const win = (wc && BrowserWindow.fromWebContents(wc)) || janela;
  const pergunta = (message, detail) => dialog.showMessageBox(win, {
    type: 'warning', title: 'EletricHUB', message,
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
        { label: 'Importar do servidor…', click: () => abrirImportacao() },
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
        { label: 'Sobre o EletricHUB', click: () => sobre() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function novaJanela() {
  if (!origem) return null;
  const w = new BrowserWindow({
    width: 1400, height: 900, icon: web.ICONE, backgroundColor: '#14161a',
    webPreferences: web.webPreferencesHub(),
  });
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
    aviso('O hub não está rodando.', 'Reinicie o EletricHUB para abrir as configurações do hub.');
    return;
  }
  for (let i = 0; i < 40 && !w.isDestroyed(); i++) {
    await new Promise((r) => setTimeout(r, 300));
    if (await tentaConfigDoHub(w)) return;
  }
}

/* O MCP do EletricHUB (mcp/ do hub): da a IA (Claude Code, Claude Desktop) as ferramentas para
   operar projeto, esquema, PCB, regras/DRC, pour, ECO, Gerber e PDF. O servidor roda no proprio
   Electron como Node (ELECTRON_RUN_AS_NODE), sobre a pasta de trabalho do app. */
function conectarIA() {
  const ws = settings.load().workspace;
  let c = null, erro = '';
  try {
    const reg = require(path.join(ws, 'mcp', 'registrar.js'));
    c = reg.configuracoes({ electron: true, node: process.execPath, root: ws, hub: 'http://127.0.0.1:8200' });
  } catch (e) { erro = String(e && e.message || e); }
  const w = focada();
  if (!c) {
    dialog.showMessageBox(w, { type: 'warning', title: 'Conectar IA (MCP)', message: 'O MCP ainda não está na pasta de trabalho.',
      detail: 'Falta ' + path.join(ws, 'mcp', 'registrar.js') + ' — atualize o app.\n\n' + erro, buttons: ['Fechar'] });
    return;
  }
  dialog.showMessageBox(w, {
    type: 'info', title: 'Conectar IA (MCP)', message: 'Registrar o EletricHUB como servidor MCP',
    detail: 'Claude Code (cole num terminal):\n' + c.claudeCode +
      '\n\nClaude Desktop: acrescente em ' + c.claudeDesktopArquivo + ':\n' + JSON.stringify(c.claudeDesktop, null, 2),
    buttons: ['Copiar comando do Claude Code', 'Copiar JSON do Claude Desktop', 'Fechar'], defaultId: 0, cancelId: 2,
  }).then(r => {
    if (r.response === 0) clipboard.writeText(c.claudeCode);
    else if (r.response === 1) clipboard.writeText(JSON.stringify(c.claudeDesktop, null, 2));
  });
}

function sobre() {
  const b = buildInfo.get();
  const s = settings.load();
  const u = updater.status();
  dialog.showMessageBox(focada(), {
    type: 'info', title: 'Sobre o EletricHUB', message: `EletricHUB ${b.version}`,
    detail: [
      `commit ${b.commit ? b.commit.slice(0, 10) : '?'}${b.builtAt ? ` · build ${b.builtAt.slice(0, 16).replace('T', ' ')}` : ''}`,
      `Python ${b.python || '3.12 (embutido)'} · Electron ${process.versions.electron}`,
      '',
      `pasta de trabalho: ${s.workspace}${dev(s.workspace) ? '  (repositório git: modo desenvolvedor)' : ''}`,
      `hub: ${origem || '—'}${s.lan ? '  (compartilhado na rede)' : ''}`,
      `servidor central: ${s.serverUrl}`,
      `biblioteca: ${libRemotaNoAr ? 'a do servidor (esta pasta guarda a cópia para leitura)' : 'a desta pasta de trabalho'}`,
      `Odoo: ${s.odooUrl} (${s.odooDb})`,
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
  const r = await dialog.showMessageBox(w, { type: st.fase === 'erro' ? 'warning' : 'info', title: 'EletricHUB', message: msg[0], detail: msg[1], buttons: botoes, noLink: true });
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
      ultimaImportacao: s.workspace ? importer.ultimaImportacao(s.workspace) : '',
      atualizacao: updater.status(),
      tokenEmbutido: Boolean(b.updateToken),
    };
  });
  handle('config:escolherPasta', async (e, atual) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Pasta de trabalho do EletricHUB', defaultPath: atual || settings.workspacePadrao(),
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    });
    return r.canceled ? '' : r.filePaths[0];
  });
  handle('config:avaliarPasta', (_e, ws) => workspace.avaliar(ws));
  handle('config:testarServidor', (_e, url) => importer.testar(url));
  handle('config:salvar', async (e, d) => salvarConfig(e, d));
  handle('config:verificarAtualizacoes', async () => updater.verificar(opcoesUpdater, true));

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
        'Há edições não salvas numa vista. Salve-as e reabra o EletricHUB para aplicar a mudança.');
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
