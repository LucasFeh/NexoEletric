'use strict';
// Tudo o que faz uma janela do Electron se comportar como a aba do Chrome em que o hub
// sempre rodou -- e o que o Electron NAO faz sozinho. Cada item aqui tem um sintoma medido
// no codigo do hub:
//   - pop-up do proprio hub ("Editar simbolo", "abrir vista numa aba", /bom/<id>) precisa
//     abrir: o hub trata window.open() === null como "pop-up bloqueado";
//   - link "Odoo ↗" vai para o navegador do sistema, onde o login do Odoo mora;
//   - arquivo solto fora do chat faria a janela NAVEGAR para file:///, e sem barra de
//     endereco nao ha como voltar ao hub;
//   - beforeunload das vistas (edicao nao salva): o Chrome pergunta, o Electron cancela o
//     fechamento calado -- o X parece quebrado;
//   - getDisplayMedia (captura de tela do chat) e recusado sem um seletor;
//   - download de Blob abre um "Salvar como" a cada arquivo, onde o Chrome grava direto;
//   - campo de texto sem menu de contexto (Recortar/Copiar/Colar);
//   - a fonte Inter vem do Google Fonts, e numa rede sem internet a folha de estilo trava a
//     primeira pintura: servida daqui, de assets/fonts, igual com ou sem rede.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, Notification, desktopCapturer, dialog, protocol, shell } = require('electron');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const ICONE = path.join(__dirname, '..', 'assets', 'icon.ico');

function registrarEsquemas() {
  // Antes do app.ready. "secure" + "corsEnabled": @font-face exige CORS e contexto seguro.
  protocol.registerSchemesAsPrivileged([
    { scheme: 'hubfont', privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true } },
  ]);
}

function webPreferencesHub() {
  // nodeIntegration DESLIGADO nao e so seguranca: os hub-*.js sao UMD e, vendo `module`,
  // exportam para CommonJS em vez de definir o global -- a vista Esquema abre em branco.
  return {
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    spellcheck: false,
    webSecurity: true,
  };
}

function mesmaOrigem(url, origem) {
  try {
    return new URL(url).origin === origem;
  } catch {
    return false;
  }
}

function externo(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

/**
 * Liga os tratamentos de sessao (uma vez) e de cada webContents do hub.
 * @param {object} o
 * @param {() => string} o.origem         http://127.0.0.1:PORTA (muda se a porta mudar)
 * @param {(sources:object[], parent:BrowserWindow) => Promise<string|null>} o.escolherTela
 * @param {(details:object) => Promise<boolean>} o.antesDoSincronismo  false = cancela
 */
function preparar(ses, o) {
  protocol.handle('hubfont', (req) => {
    const nome = path.basename(new URL(req.url).pathname);
    const f = path.join(FONT_DIR, nome);
    if (!/^[\w.-]+$/.test(nome) || !fs.existsSync(f)) return new Response('', { status: 404 });
    return new Response(fs.readFileSync(f), {
      headers: {
        'content-type': nome.endsWith('.css') ? 'text/css' : 'font/woff2',
        'access-control-allow-origin': '*',
      },
    });
  });

  // UM listener por sessao (o Electron guarda so o ultimo), entao fontes e o sincronismo
  // do almoxarifado dividem este. O filtro sem porta casa qualquer porta do 127.0.0.1.
  ses.webRequest.onBeforeRequest({
    urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*',
      'http://127.0.0.1/api/symbols/almox-sync'],
  }, (d, cb) => {
    if (d.url.startsWith('https://fonts.googleapis.com/css')) return cb({ redirectURL: 'hubfont://fonts/inter.css' });
    if (d.url.startsWith('https://fonts.')) return cb({ cancel: true });
    if (d.method === 'POST' && mesmaOrigem(d.url, o.origem())) {
      Promise.resolve(o.antesDoSincronismo(d))
        .then((seguir) => cb(seguir ? {} : { cancel: true }), () => cb({}));
      return;
    }
    cb({});
  });

  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 },
      });
      // quem pediu e a janela em foco: o botao de captura foi clicado nela
      const id = await o.escolherTela(sources, BrowserWindow.getFocusedWindow());
      const src = id && sources.find((s) => s.id === id);
      if (src) callback({ video: src });
      else callback({});
    } catch {
      callback({});
    }
  });

  // Download de Blob: direto para Downloads, com nome unico, como o Chrome faz. O hub ja
  // mostra "baixado" no canto; a notificacao do Windows diz ONDE e abre a pasta no clique.
  ses.on('will-download', (_e, item) => {
    const dir = app.getPath('downloads');
    const nome = item.getFilename() || 'download';
    const ext = path.extname(nome);
    const raiz = nome.slice(0, nome.length - ext.length);
    let dest = path.join(dir, nome);
    for (let n = 1; fs.existsSync(dest); n++) dest = path.join(dir, `${raiz} (${n})${ext}`);
    item.setSavePath(dest);
    item.once('done', (_ev, state) => {
      if (state !== 'completed' || !Notification.isSupported()) return;
      const n = new Notification({ title: 'Baixado', body: path.basename(dest), silent: true, icon: ICONE });
      n.on('click', () => shell.showItemInFolder(dest));
      n.show();
    });
  });

  // Permissoes: o hub ESCREVE na area de transferencia e captura a tela (chat); nada mais.
  // 'media' tambem cobre getUserMedia (microfone e camera), que o hub nao usa: so passa a
  // captura de tela (mediaTypes vazio). Sem o check handler, o padrao do Electron e
  // "concedido" e o enumerateDevices entrega os nomes dos dispositivos.
  const PERMITIDAS = new Set(['clipboard-sanitized-write', 'display-capture', 'media', 'fullscreen']);
  const semMicCam = (tipos) => !(tipos || []).some((t) => t === 'audio' || t === 'video');
  ses.setPermissionRequestHandler((wc, perm, cb, det) => {
    if (!PERMITIDAS.has(perm) || !mesmaOrigem(det.requestingUrl || wc.getURL(), o.origem())) return cb(false);
    cb(perm !== 'media' || semMicCam(det.mediaTypes));
  });
  ses.setPermissionCheckHandler((_wc, perm, origemPedido, det) =>
    PERMITIDAS.has(perm) && mesmaOrigem(origemPedido, o.origem()) &&
    !(perm === 'media' && (det.mediaType === 'audio' || det.mediaType === 'video')));
}

/** Tratamentos por webContents: janela principal, pop-ups e iframes herdam daqui. */
function endurecer(wc, o) {
  wc.setWindowOpenHandler(({ url }) => {
    if (mesmaOrigem(url, o.origem())) {
      return {
        action: 'allow',
        // Como a aba do Chrome: fechar a janela principal nao derruba a vista aberta a parte.
        // Sem isto o Electron DESTROI o pop-up junto (sem beforeunload): edicao perdida.
        outlivesOpener: true,
        overrideBrowserWindowOptions: {
          width: 1400, height: 900, icon: ICONE, backgroundColor: '#14161a', autoHideMenuBar: false,
          webPreferences: webPreferencesHub(),
        },
      };
    }
    if (externo(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  const guarda = (e, url) => {
    if (mesmaOrigem(url, o.origem()) || url.startsWith('about:') || url.startsWith('data:') ||
        url.startsWith('blob:') || url.startsWith(o.uiUrl)) return;
    e.preventDefault();
    if (externo(url)) shell.openExternal(url);
  };
  wc.on('will-navigate', guarda);
  wc.on('will-frame-navigate', (e) => {
    if (e.isMainFrame) return;          // o principal ja passou pelo will-navigate
    guarda(e, e.url);
  });

  // "Sair do site?" do Chrome, em portugues. Sem isto o X e o F5 nao fazem nada com
  // edicao pendente numa vista (schframe.js/pcbframe.js marcam beforeunload).
  wc.on('will-prevent-unload', (e) => {
    const win = BrowserWindow.fromWebContents(wc);
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning',
      title: 'AltiumHub',
      message: 'Há edições não salvas nesta janela.',
      detail: 'Se continuar, o que não foi salvo nas vistas Esquema/PCB se perde.',
      buttons: ['Descartar e continuar', 'Voltar e salvar'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (r === 0) e.preventDefault();
    // "Voltar e salvar" cancelou o fechamento: um "Reiniciar agora" que estava armado nao
    // pode instalar no proximo fechamento comum.
    else require('./updater').desistirDeInstalar();
  });

  wc.on('context-menu', (_e, p) => {
    const itens = [];
    if (p.isEditable) {
      itens.push({ role: 'undo', label: 'Desfazer', enabled: p.editFlags.canUndo },
        { role: 'redo', label: 'Refazer', enabled: p.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar', enabled: p.editFlags.canCut },
        { role: 'copy', label: 'Copiar', enabled: p.editFlags.canCopy },
        { role: 'paste', label: 'Colar', enabled: p.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', label: 'Selecionar tudo' });
    } else if (p.selectionText && p.selectionText.trim()) {
      itens.push({ role: 'copy', label: 'Copiar' });
    }
    if (p.linkURL && externo(p.linkURL) && !mesmaOrigem(p.linkURL, o.origem())) {
      if (itens.length) itens.push({ type: 'separator' });
      itens.push({ label: 'Abrir no navegador', click: () => shell.openExternal(p.linkURL) });
    }
    if (itens.length) Menu.buildFromTemplate(itens).popup({ window: BrowserWindow.fromWebContents(wc) });
  });
}

module.exports = { registrarEsquemas, preparar, endurecer, webPreferencesHub, mesmaOrigem, ICONE };
