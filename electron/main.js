'use strict';
// AltiumHub desktop: o hub do AltiumPCBMirror numa janela propria.
//
// O que o app faz, na ordem:
//   1. garante a pasta de trabalho (lib/workspace.js): o codigo do hub que veio neste
//      instalador + o estado da maquina (Projects/, Libs/, credenciais), que nunca e tocado;
//   2. sobe `python hubserver.py` com o Python embutido (lib/backend.js) -- o MESMO
//      servidor que roda no 192.168.15.192, so que nesta maquina e escutando em 127.0.0.1;
//   3. mostra o hub na janela, com o comportamento de aba do Chrome (lib/web.js);
//   4. busca atualizacao nos releases do GitHub (lib/updater.js);
//   5. importa projetos e bibliotecas do hub central quando pedido (lib/import-server.js),
//      e antes de todo sincronismo do almoxarifado, para a numeracao nao divergir.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');

// Testes/automacao: pasta de dados propria ANTES de qualquer uso do userData.
if (process.env.ALTIUMHUB_USERDATA) app.setPath('userData', process.env.ALTIUMHUB_USERDATA);
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
let janelaConfig = null;
let janelaImport = null;
let avisoSync = '';             // arquivos do hub que a sincronizacao nao conseguiu trocar

// ───────────────────────────── instancia unica ─────────────────────────────
// Duas copias disputariam a mesma porta e a mesma pasta de trabalho.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!janela) return;
    if (janela.isMinimized()) janela.restore();
    janela.focus();
  });
}

function logWs(m) { log.info('[workspace] ' + m); }

function status(fase, msg, extra = {}) {
  bootStatus = { ...bootStatus, fase, msg, erro: '', ...extra };
  log.info(`[boot] ${fase}: ${msg}${bootStatus.erro ? ' — ' + bootStatus.erro : ''}`);
  if (janela && !janela.isDestroyed()) janela.webContents.send('boot:status', bootStatus);
}

function dev(ws) { return workspace.isDevWorkspace(ws || settings.load().workspace); }

function seedHashes() {
  try {
    const m = workspace.lerManifesto(BUNDLE);
    return Object.fromEntries(m.seed.map((e) => [e.p, e.sha1]));
  } catch {
    return {};
  }
}

// ───────────────────────────── janela principal ─────────────────────────────
function criarJanela() {
  const s = settings.load();
  const w = s.window || {};
  janela = new BrowserWindow({
    x: w.x, y: w.y, width: w.width || 1480, height: w.height || 940,
    minWidth: 900, minHeight: 600,
    show: false,
    title: 'AltiumHub',
    icon: web.ICONE,
    backgroundColor: '#14161a',
    webPreferences: { ...web.webPreferencesHub(), preload: PRELOAD_UI },
  });
  if (w.maximized) janela.maximize();
  janela.once('ready-to-show', () => janela.show());
  janela.on('close', () => {
    if (janela.isDestroyed()) return;
    const b = janela.getNormalBounds();
    settings.save({ window: { ...b, maximized: janela.isMaximized() } });
  });
  janela.on('closed', () => { janela = null; });
  janela.webContents.on('page-title-updated', (e, t) => {
    e.preventDefault();
    janela.setTitle(t && !/^AltiumHub/.test(t) ? `${t} — AltiumHub` : 'AltiumHub');
  });
  janela.webContents.on('render-process-gone', (_e, d) => {
    log.error('renderer caiu: ' + d.reason);
    if (d.reason !== 'clean-exit' && origem) janela.loadURL(origem + '/');
  });
  return janela;
}

async function carregarUi(nome, query = {}) {
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
  // Na rede, o chat passa a pedir a senha mestre (tools/chat/chatserver.py): aberto, ele
  // roda o claude nesta maquina a pedido de qualquer um que alcance a porta.
  if (s.lan) env.ALTIUMHUB_CHAT_SENHA = '1';
  // Motor "api" do chat, para quem nao tem o claude instalado (tools/chat/claude_api.py).
  const chave = settings.getSegredo('anthropicKey');
  if (chave) env.ANTHROPIC_API_KEY = chave;
  return env;
}

async function subirHub() {
  const s = settings.load();
  const ws = s.workspace;
  status('workspace', 'preparando a pasta de trabalho…');
  const r = workspace.sync(ws, BUNDLE, logWs);
  workspace.seedOdoo(ws, s, logWs);
  if (r.kept.length) log.warn('arquivos de codigo antigos mantidos por terem sido editados: ' + r.kept.join(', '));
  avisoSync = r.falhas.length
    ? `${r.falhas.length} arquivo(s) do hub não foram atualizados por estarem em uso (${r.falhas.slice(0, 3).join(', ')}` +
      `${r.falhas.length > 3 ? '…' : ''}). Feche o Altium e reabra o AltiumHub.`
    : '';

  status('python', 'subindo o hub…');
  backend = new Backend({ python: PYTHON, workspace: ws, logDir: LOG_DIR, env: envDoHub(ws) });
  backendParado = false;
  backend.on('exit', aoCairOHub);
  backend.on('log', (l) => {
    bootStatus.log = [...bootStatus.log.slice(-60), l];
  });
  await backend.start({ port: s.port, lan: s.lan });
  origem = backend.url();
  if (backend.port !== s.port) {
    log.warn(`porta ${s.port} ocupada; o hub subiu na ${backend.port} (preferencias do navegador ficam por porta)`);
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

async function aoCairOHub({ code, esperado }) {
  if (esperado || saindo) return;
  log.error(`o hub caiu (codigo ${code})`);
  if (reinicios < 2) {
    reinicios++;
    try {
      await subirHub();
      for (const w of BrowserWindow.getAllWindows()) {
        if (web.mesmaOrigem(w.webContents.getURL(), origem)) w.webContents.reload();
      }
      return;
    } catch (e) {
      log.error('reinicio falhou: ' + e.message);
    }
  }
  if (janela && !janela.isDestroyed()) {
    await carregarUi('splash.html');
    status('erro', 'o hub parou de responder', { erro: `o processo Python terminou (codigo ${code}). Veja o log abaixo.` });
  }
}

async function boot() {
  reinicios = 0;
  try {
    if (!janela) criarJanela();
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

async function reiniciarHub() {
  if (backend) await backend.stop();
  for (const w of BrowserWindow.getAllWindows()) {
    if (w !== janela && w !== janelaConfig && w !== janelaImport) w.close();
  }
  await boot();
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
    title: 'Configurações — AltiumHub', icon: web.ICONE, backgroundColor: '#14161a', show: false,
    autoHideMenuBar: true,
    webPreferences: { ...web.webPreferencesHub(), preload: PRELOAD_UI },
  });
  janelaConfig.removeMenu();
  janelaConfig.once('ready-to-show', () => janelaConfig.show());
  janelaConfig.on('closed', () => { janelaConfig = null; });
  janelaConfig.loadFile(path.join(UI_DIR, 'config.html'), { query: { modo: 'config' } });
}

function abrirImportacao(opts = {}) {
  if (dev()) {
    dialog.showMessageBox(janela, {
      type: 'info', title: 'AltiumHub', message: 'A pasta de trabalho é um repositório git.',
      detail: 'Importar do servidor sujaria arquivos versionados. Use uma pasta de trabalho comum (Configurações).',
      buttons: ['OK'], noLink: true,
    });
    return;
  }
  if (janelaImport && !janelaImport.isDestroyed()) { janelaImport.focus(); return; }
  janelaImport = new BrowserWindow({
    parent: janela || undefined, width: 720, height: 620, minWidth: 560, minHeight: 420,
    title: 'Importar do servidor — AltiumHub', icon: web.ICONE, backgroundColor: '#14161a', show: false,
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
  importando = new AbortController();
  try {
    const res = await importer.importar({
      ws: s.workspace, serverUrl: s.serverUrl, grupos, seedHashes: seedHashes(),
      progresso, signal: importando.signal,
    });
    log.info(`[import] ${res.novos.length} novos, ${res.atualizados.length} atualizados, ` +
      `${res.conflitos.length} conflitos, ${res.erros.length} erros`);
    return res;
  } finally {
    importando = null;
  }
}

function toastNoHub(wc, msg, tipo) {
  if (!wc || wc.isDestroyed()) return;
  wc.executeJavaScript(`typeof toast === 'function' && toast(${JSON.stringify(msg)}, ${JSON.stringify(tipo)})`)
    .catch(() => {});
}

// Antes de o hub sincronizar o almoxarifado com o Odoo: traz do servidor o estado que o
// gerador le para numerar (livro-razao de part numbers, ledger dos desenhos, espelhos).
// Com o mesmo estado e o mesmo Odoo, a numeracao daqui e a do servidor saem iguais; sem
// isso, cada PC que sincroniza vira uma segunda autoridade dos part numbers.
async function antesDoSincronismo(d) {
  const s = settings.load();
  if (!s.syncGuard || dev(s.workspace)) return true;
  const wc = d.webContents;
  const win = (wc && BrowserWindow.fromWebContents(wc)) || janela;
  if (importando) return true;
  const t = await importer.testar(s.serverUrl);
  if (!t.ok) {
    const r = await dialog.showMessageBox(win, {
      type: 'warning', title: 'AltiumHub',
      message: 'O servidor central não respondeu.',
      detail: `${s.serverUrl}: ${t.erro}\n\nSincronizar agora usa só o estado local do almoxarifado. ` +
        'Componentes novos no Odoo podem receber part numbers diferentes dos que o servidor daria.',
      buttons: ['Sincronizar assim mesmo', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true,
    });
    return r.response === 0;
  }
  toastNoHub(wc, 'atualizando o almoxarifado a partir do servidor antes de sincronizar…', 'warn');
  try {
    const res = await rodarImportacao(['almox'], () => {});
    const n = res.novos.length + res.atualizados.length;
    toastNoHub(wc, n ? `estado do almoxarifado atualizado do servidor (${n} arquivo${n > 1 ? 's' : ''})`
      : 'almoxarifado já estava igual ao do servidor', res.erros.length ? 'warn' : 'ok');
  } catch (e) {
    log.warn('pre-sincronismo: ' + e.message);
    toastNoHub(wc, 'não consegui atualizar do servidor: ' + e.message, 'warn');
  }
  return true;
}

// ───────────────────────────── seletor de tela (chat) ─────────────────────────────
let pickerPendente = null;
function escolherTela(sources, parent) {
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      parent: parent || janela || undefined, modal: true, width: 900, height: 620, minWidth: 600, minHeight: 400,
      title: 'Escolha o que capturar', icon: web.ICONE, backgroundColor: '#14161a', show: false,
      webPreferences: { ...web.webPreferencesHub(), preload: PRELOAD_UI },
    });
    w.removeMenu();
    let fim = false;
    const responde = (id) => {
      if (fim) return;
      fim = true;
      pickerPendente = null;
      resolve(id);
      if (!w.isDestroyed()) w.close();
    };
    pickerPendente = {
      fontes: sources.map((s) => ({ id: s.id, nome: s.name, tela: s.id.startsWith('screen:'), img: s.thumbnail.toDataURL() })),
      responde,
    };
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
        { label: 'Configurações…', accelerator: 'CmdOrCtrl+,', click: () => abrirConfig() },
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
        { label: 'Sobre o AltiumHub', click: () => sobre() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function novaJanela() {
  if (!origem) return;
  const w = new BrowserWindow({
    width: 1400, height: 900, icon: web.ICONE, backgroundColor: '#14161a',
    webPreferences: web.webPreferencesHub(),
  });
  w.loadURL(origem + '/');
}

function sobre() {
  const b = buildInfo.get();
  const s = settings.load();
  const u = updater.status();
  dialog.showMessageBox(focada(), {
    type: 'info', title: 'Sobre o AltiumHub', message: `AltiumHub ${b.version}`,
    detail: [
      `commit ${b.commit ? b.commit.slice(0, 10) : '?'}${b.builtAt ? ` · build ${b.builtAt.slice(0, 16).replace('T', ' ')}` : ''}`,
      `Python ${b.python || '3.12 (embutido)'} · Electron ${process.versions.electron}`,
      '',
      `pasta de trabalho: ${s.workspace}${dev(s.workspace) ? '  (repositório git: modo desenvolvedor)' : ''}`,
      `hub: ${origem || '—'}${s.lan ? '  (compartilhado na rede)' : ''}`,
      `servidor central: ${s.serverUrl}`,
      `Odoo: ${s.odooUrl} (${s.odooDb})`,
      `última importação: ${importer.ultimaImportacao(s.workspace) || 'nunca'}`,
      '',
      `atualização: ${u.fase}${u.versao ? ' ' + u.versao : ''}${u.erro ? ' — ' + u.erro : ''}`,
    ].join('\n'),
    buttons: ['OK'], noLink: true,
  });
}

const opcoesUpdater = {
  token: () => settings.getUpdateToken() || buildInfo.get().updateToken,
  enabled: () => settings.load().autoUpdate,
  beforeInstall: async () => {
    saindo = true;
    if (backend) await backend.stop();
    backendParado = true;
  },
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
  const r = await dialog.showMessageBox(w, { type: st.fase === 'erro' ? 'warning' : 'info', title: 'AltiumHub', message: msg[0], detail: msg[1], buttons: botoes, noLink: true });
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
      altium: altiumHome.status(s.workspace),
      ultimaImportacao: s.workspace ? importer.ultimaImportacao(s.workspace) : '',
      atualizacao: updater.status(),
      tokenEmbutido: Boolean(b.updateToken),
    };
  });
  handle('config:escolherPasta', async (e, atual) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Pasta de trabalho do AltiumHub', defaultPath: atual || settings.workspacePadrao(),
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

  handle('picker:fontes', () => (pickerPendente ? pickerPendente.fontes : []));
  handle('picker:escolher', (_e, id) => { if (pickerPendente) pickerPendente.responde(id || null); return true; });
}

function validarUrl(u, nome) {
  let x;
  try { x = new URL(String(u || '').trim()); } catch { throw new Error(`${nome}: endereço inválido`); }
  if (x.protocol !== 'http:' && x.protocol !== 'https:') throw new Error(`${nome}: use http:// ou https://`);
  return x.origin;
}

async function salvarConfig(e, d) {
  const antes = settings.load();
  const setup = !antes.setupDone;
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

  const reinicia = setup || ws !== antes.workspace || port !== antes.port || novo.lan !== antes.lan ||
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
    await reiniciarHub();
  }
  return { ok: true, reiniciou: reinicia };
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
    r.ok = r.page.demo === false && r.page.hubCore === 'object';
  } catch (e) {
    r.erro = e.message;
  }
  fimSmoke(r);
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

app.on('before-quit', (e) => {
  if (backendParado || !backend) return;
  e.preventDefault();
  saindo = true;
  backend.stop().finally(() => {
    backendParado = true;
    app.quit();
  });
});
