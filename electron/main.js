'use strict';
// NexoEletric desktop: o hub do AltiumPCBMirror numa janela propria.
//
// O que o app faz, na ordem:
//   1. garante a pasta de trabalho (lib/workspace.js): o codigo do hub que veio neste
//      instalador + o estado da maquina (Projects/, Libs/, credenciais), que nunca e tocado;
//   2. sobe `python hubserver.py` com o Python embutido (lib/backend.js), nesta maquina e
//      escutando em 127.0.0.1;
//   3. mostra o hub na janela, com o comportamento de aba do Chrome (lib/web.js);
//   4. busca atualizacao nos releases do GitHub (lib/updater.js);
//   5. desde a 1.14.0, nada mora aqui: projetos, biblioteca e scripts do Altium ficam no NexoBD
//      (lib/armazem.js), e a pasta de trabalho e copia; o sincronismo do Odoo roda no NexoBD (1.29.0);
//   6. desde a 1.31.0, a BOM tambem: a pagina e os dados de cada projeto vao para o NexoBD, que a
//      serve para a rede local (o link do painel BOM). O servidor central antigo (192.168.15.192:8100:
//      importar do servidor, biblioteca remota, link do BOM) saiu.
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
const altiumHome = require('./lib/altium-home');
const web = require('./lib/web');
const buildInfo = require('./lib/build-info');
const { NexoHubSync } = require('./lib/nexohub-sync');
const armazemNexoBD = require('./lib/armazem');
const conexaoIA = require('./lib/conexao-ia');
const cascaRust = require('./lib/casca-rust');

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
const armazem = new armazemNexoBD.Armazem({ log, bundle: BUNDLE, python: PYTHON, versao: app.getVersion() });
const ESPERA_PRIMEIRA = 45000;   // quanto a abertura espera a primeira rodada (depois segue sem ela)
// A janela do NexoEletric em Rust (lib/casca-rust.js, 1.54.0): com ela, este processo e o motor de fundo
const CASCA_EXE = cascaRust.caminhoDaCasca({ empacotado: EMBUTIDO, resourcesPath: process.resourcesPath });
let casca = null;               // a janela Rust aberta (CascaRust)
let cascaFalhou = false;        // nao abriu nesta maquina: esta sessao segue na janela Electron
function usaCasca() { return !SMOKE && !cascaFalhou && !!CASCA_EXE && cascaRust.querCasca(settings.load()); }
/* Com a janela Rust este processo nao desenha nada (so as telas de configuracao, quando pedidas): sem a GPU
   do Chromium e sem o renderizador reserva, o motor de fundo deixa de pagar ~100 MB por janelas que nao abre.
   Tem de vir antes do app ficar pronto. */
if (usaCasca()) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess');
}

let janela = null;
let backend = null;
let origem = '';
let bootStatus = { fase: 'inicio', msg: 'iniciando…', erro: '', log: [] };
let saindo = false;
let backendParado = false;
let reinicios = 0;
let janelaConfig = null;
let janelaConexao = null;       // Conectar IA: o MCP e a conexao com o Nexo Hub (ui/conexao.html)
let avisoSync = '';             // o que a sincronizacao da pasta de trabalho precisa dizer
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
    // o atalho clicado de novo com a janela Rust aberta: ela vem para a frente
    if (casca && casca.viva) { casca.focar(); return; }
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
  // Com o NexoBD a biblioteca e os projetos sao os dele: o armazem leva o que o hub grava; o
  // ALTIUMHUB_NEXOBD liga o "sem o Hub, vazio" (nexohub_gate.py), faz o "excluir projeto" anotar o
  // apagar no NexoBD e poe o link da BOM no NexoBD (1.31.0). O servidor central antigo saiu.
  if (noNexoBD(ws)) env.ALTIUMHUB_NEXOBD = '1';
  // Na rede, o chat passa a pedir a senha mestre (tools/chat/chatserver.py): aberto, ele
  // roda o claude nesta maquina a pedido de qualquer um que alcance a porta.
  if (s.lan) env.ALTIUMHUB_CHAT_SENHA = '1';
  // Motor "api" do chat, para quem nao tem o claude instalado (tools/chat/claude_api.py).
  const chave = settings.getSegredo('anthropicKey');
  if (chave) env.ANTHROPIC_API_KEY = chave;
  return env;
}

/* a pasta de trabalho com o codigo do hub deste instalador (as duas janelas, a Electron e a Rust) */
function preparaPasta(s) {
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
  return ws;
}

// So chamada de dentro da fila (emSerie).
async function subirHub({ porta } = {}) {
  const s = settings.load();
  const ws = preparaPasta(s);

  if (noNexoBD(ws)) {
    status('nexobd', 'trazendo os projetos e a biblioteca do Nexo Hub…');
    const r = await Promise.race([
      armazem.iniciar(ws),
      new Promise((res) => setTimeout(() => res({ ok: true, esperando: true }), ESPERA_PRIMEIRA)),
    ]);
    if (r.esperando) log.warn('[nexobd] a primeira rodada passou do tempo: o hub abre e ela segue por trás');
    else if (!r.ok) {
      avisoSync = [avisoSync, `Sem conexão com o Nexo Hub (${r.erro}): os projetos e a biblioteca só aparecem com ele ` +
        'conectado; assim que ele voltar, o hub recarrega sozinho.'].filter(Boolean).join(' ');
    }
  } else {
    armazem.parar();
  }

  status('python', 'subindo o hub…');
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
  // a fonte da BOM de cada projeto sai do hubserver (o mesmo gerador do painel): com ele no ar, uma rodada
  if (noNexoBD(ws)) { armazem.definirHub(origem); armazem.agendar(1500, 'hub no ar'); }
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

/* ── A JANELA RUST (lib/casca-rust.js) ──
   A pasta de trabalho e a sincronia com o NexoBD continuam aqui, como sempre; o hub e a janela sao os da
   casca Rust, que abre na hora (o servidor dela sobe em ~0,1 s e o Python dela so quando uma rota pede).
   A primeira rodada do NexoBD segue em paralelo: o vigia da casca recarrega a pagina quando os arquivos
   chegam. Nao abriu (WebView2 ausente, executavel faltando): esta sessao volta para a janela Electron. */
async function bootCascaImpl() {
  const s = settings.load();
  const ws = preparaPasta(s);
  if (noNexoBD(ws)) {
    armazem.iniciar(ws).then((r) => {
      if (r && !r.ok && casca) casca.toast(`Sem conexão com o Nexo Hub (${r.erro}): os projetos e a biblioteca só aparecem com ` +
        'ele conectado; assim que ele voltar, o hub recarrega sozinho.', 'warn', 12000);
    }).catch((e) => log.warn('[nexobd] primeira rodada: ' + e.message));
  } else {
    armazem.parar();
  }
  status('rust', 'abrindo a janela…');
  const c = new cascaRust.CascaRust({ log, logDir: LOG_DIR });
  c.on('menu', (id) => {
    const f = acoesDoMenu()[id];
    if (f) Promise.resolve().then(f).catch((e) => log.warn(`[rust] menu ${id}: ${e.message}`));
    else log.warn('[rust] menu desconhecido: ' + id);
  });
  c.on('exit', ({ code, cedo, subiu }) => {
    if (casca !== c) return;
    casca = null;
    if (saindo) return;
    if (code !== 0 && (cedo || !subiu)) {
      // nao abriu nesta maquina: a janela Electron de sempre
      log.error(`[rust] a janela Rust saiu com ${code} logo ao abrir: sigo na janela Electron (veja logs/rust.log)`);
      cascaFalhou = true;
      boot();
      return;
    }
    log.info(`[rust] janela fechada (${code}): o NexoEletric sai`);
    // o que foi salvo nos ultimos segundos ainda sobe ao NexoBD (a janela ja sumiu; o motor termina por tras)
    const ultima = noNexoBD(ws) ? Promise.race([armazem.agora('fechando').catch(() => null),
      new Promise((r) => setTimeout(r, 20000))]) : Promise.resolve();
    ultima.finally(() => app.quit());
  });
  casca = c;
  try {
    origem = await c.iniciar({ exe: CASCA_EXE, ws, porta: s.port, python: PYTHON, env: envDoHub(ws), versao: app.getVersion() });
  } catch (e) {
    if (casca === c) {
      casca = null;
      log.error('[rust] ' + e.message + ': sigo na janela Electron');
      cascaFalhou = true;
      await c.parar();
      return bootImpl();
    }
    return undefined;   // o exit ja tratou
  }
  log.info(`[rust] janela aberta, hub em ${origem}`);
  // a tela de configuracao da primeira execucao (ou o splash) sai: a janela agora e a Rust
  if (janela && !janela.isDestroyed()) { const j = janela; janela = null; j.destroy(); }
  nexoSync.iniciar(ws, origem);
  if (noNexoBD(ws)) { armazem.definirHub(origem); armazem.agendar(1500, 'hub no ar'); }
  if (avisoSync) setTimeout(() => { if (casca) casca.toast(avisoSync, 'warn', 15000); }, 3000);
  return undefined;
}

async function bootImpl() {
  if (usaCasca()) return bootCascaImpl();
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
  /* Com a janela Rust, fechar a janela por baixo da pessoa perderia a edicao que ainda nao foi salva (a
     casca nao tem o "Voltar e salvar" do Electron). A configuracao nova vale na proxima abertura. */
  if (casca && casca.viva) {
    aviso('Configurações salvas.', 'Feche e abra o NexoEletric para aplicar (salve antes o que estiver aberto).');
    return Promise.resolve(true);
  }
  return emSerie(async () => {
    const outras = BrowserWindow.getAllWindows().filter((w) => w !== janela && w !== janelaConfig &&
      !pickers.has(w.webContents.id));
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

// 1.31.0: o "Importar do servidor" saiu com o servidor central (projetos e biblioteca vem do Nexo Hub).
function toastNoHub(wc, msg, tipo) {
  // com a janela Rust, o aviso vai para ela (o motor nao tem pagina)
  if (casca && casca.viva) { casca.toast(msg, tipo); return; }
  if (!wc || wc.isDestroyed()) return;
  wc.executeJavaScript(`typeof toast === 'function' && toast(${JSON.stringify(msg)}, ${JSON.stringify(tipo)})`)
    .catch(() => {});
}

// Antes de o hub sincronizar o almoxarifado com o Odoo. Pelo Nexo Hub (1.29.0) o sincronismo roda no
// NexoBD (nexohub_odoo.py repassa o pedido): nao ha estado local a trazer antes; a revisao nova chega
// pelo armazem. Numa pasta de desenvolvedor (git) o sincronismo e o local de sempre. O guarda que trazia
// o livro-razao do servidor central antes (1.2 a 1.30) saiu com ele.
async function antesDoSincronismo() {
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
        { label: 'Nexo Hub: sincronizar projetos e biblioteca', click: () => sincronizarNexoBD() },
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
   conexao: o NexoEletric fala so com o Nexo Hub (conexao.json), e a tela so fala dele (pedido do dono: nada alem do
   Hub na interface). Ate a 1.28 isto era uma caixa de mensagem do Windows. */
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
    if (f === 'erro') toastNoHub(wc, 'Sem conexão com o Nexo Hub: os projetos e a biblioteca só aparecem com ele conectado. Ajuda › Conectar IA (MCP) mostra o estado e tenta de novo.', 'warn');
    else if (era === 'erro') toastNoHub(wc, 'Nexo Hub conectado de novo: projetos e biblioteca em dia', 'ok');
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

// Arquivo › Nexo Hub: sincronizar projetos e biblioteca.
async function sincronizarNexoBD() {
  const wc = focada() && focada().webContents;
  if (!noNexoBD()) { toastNoHub(wc, 'Projetos e biblioteca fora do Nexo Hub nesta pasta de trabalho (pasta de desenvolvedor ou configuração)', 'warn'); return; }
  toastNoHub(wc, 'Nexo Hub: sincronizando projetos e biblioteca…', 'info');
  const r = await armazem.agora('pedido');
  const x = r.resumo;
  if (r.ok) toastNoHub(wc, `Nexo Hub: ${x.projetos} projeto(s), biblioteca ${x.biblioteca} — ${x.baixados} arquivo(s) baixado(s), ${x.subidos} subido(s)` + (x.conflitos.length ? ` · ${x.conflitos.length} conflito(s) guardado(s)` : ''), x.conflitos.length ? 'warn' : 'ok');
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
      `biblioteca: ${noNexoBD(s.workspace) ? 'a do Nexo Hub (esta pasta guarda a cópia)' : 'a desta pasta de trabalho (desenvolvedor)'}`,
      `projetos e biblioteca (pelo Nexo Hub): ${noNexoBD(s.workspace) ? armazem.resumoTexto() : 'desligado'}`,
      `Odoo: ${s.odooUrl} (${s.odooDb})`,
      `Nexo Hub: ${nexoSync.resumoTexto()}`,
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
      altium: altiumHome.status(s.workspace),
      nexobd: s.workspace ? noNexoBD(s.workspace) : s.nexobd !== false,
      nexobdEstado: armazem.resumoTexto(),
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
    odooUrl: validarUrl(d.odooUrl, 'Odoo'),
    odooDb: String(d.odooDb || '').trim() || antes.odooDb,
    autoUpdate: Boolean(d.autoUpdate),
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
  if (armazemNexoBD.ligado({ ...antes, ...novo }, workspace.isDevWorkspace(ws))) d.apontarAltium = false;
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

  // O que entra no env do hub so vale num hub novo. A pasta tambem conta, porque decide o modo desenvolvedor.
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

  if (setup) {
    await apontar();
    await boot();
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
  if (precisaConfigurar()) {
    criarJanela();
    await carregarUi('config.html', { modo: 'setup' });
  } else {
    // com a janela Rust nao ha janela Electron nenhuma: este processo fica de motor, por tras
    if (!usaCasca()) criarJanela();
    await boot();
  }
  updater.iniciar(opcoesUpdater);
});

// a tela de configuracoes (ou o Sobre, o Conectar IA) fechando com a janela Rust aberta nao fecha o app
app.on('window-all-closed', () => { if (!(casca && casca.viva)) app.quit(); });

// will-quit, e nao before-quit: o before-quit vem ANTES de as janelas fecharem, e uma vista
// com edicao pendente ainda pode recusar ("Voltar e salvar") -- com o hub ja derrubado ela
// nao teria onde salvar. O will-quit so vem quando todas aceitaram fechar. So entao o hub
// para e, se "Reiniciar agora" foi pedido, o instalador da atualizacao roda.
app.on('will-quit', (e) => {
  apagaSessao();
  if (casca && casca.viva) { saindo = true; casca.parar(); }
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
