'use strict';
// Ponte entre as telas locais do app (ui/*.html, file://) e o processo principal.
//
// Este preload tambem roda na janela principal quando ela mostra o HUB (http://127.0.0.1),
// porque e a mesma janela que antes mostrou a tela de abertura. Por isso a ponte so e
// exposta em file://: uma pagina servida pelo hub nunca a enxerga -- nem se alguem da rede
// gravar um lib-subs.js malicioso com o "compartilhar na rede" ligado. O processo principal
// confere a origem de novo a cada chamada (main.js » daUi).
//
// Nada de expor `module`, `require` ou `process`: os hub-*.js sao UMD e mudariam de
// comportamento ao ver qualquer um deles.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CHAMADAS = new Set([
  'boot:estado', 'boot:tentar', 'boot:log', 'boot:config',
  'config:ler', 'config:escolherPasta', 'config:avaliarPasta', 'config:testarServidor', 'config:salvar',
  'config:verificarAtualizacoes', 'config:conectarIA',
  'conexao:estado', 'conexao:tentar', 'conexao:registrar', 'conexao:gravar', 'conexao:abrirHub', 'conexao:copiar',
  'conexao:pastaLogs',
  'import:iniciar', 'import:cancelar', 'import:abrirPasta',
  'picker:fontes', 'picker:escolher',
]);
const EVENTOS = new Set(['boot:status', 'import:progresso']);

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('altiumhub', {
    chamar: (canal, ...args) => {
      if (!CHAMADAS.has(canal)) return Promise.reject(new Error('canal desconhecido: ' + canal));
      return ipcRenderer.invoke(canal, ...args);
    },
    ouvir: (canal, fn) => {
      if (!EVENTOS.has(canal)) return () => {};
      const f = (_e, dado) => fn(dado);
      ipcRenderer.on(canal, f);
      return () => ipcRenderer.removeListener(canal, f);
    },
  });
}

// A barra de menus da pagina do hub (hub-menubar.js, 2026-10-14): o menu do app saiu da barra
// nativa para o topo da pagina. A pagina do hub (http://127.0.0.1) ganha UMA chamada, com os
// nomes da lista fechada abaixo e sem argumento -- recarregar, zoom, tela cheia, abrir as
// configuracoes, sair: nada que leia ou grave arquivo. O main.js confere a origem de novo.
const MENU = new Set([
  'novaJanela', 'abrirPasta', 'importar', 'configHub', 'configApp', 'sair',
  'recarregar', 'recarregarSemCache', 'zoomMais', 'zoomMenos', 'zoom0', 'painelProjetos',
  'telaCheia', 'devtools', 'atualizacoes', 'log', 'pastaLogs', 'conectarIA', 'sobre', 'nexoSync', 'nexobd',
]);
if ((location.protocol === 'http:' || location.protocol === 'https:') &&
    (location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
  contextBridge.exposeInMainWorld('eletricApp', {
    menu: (id) => (MENU.has(id) ? ipcRenderer.invoke('menu:acao', id) : Promise.reject(new Error('comando desconhecido: ' + id))),
    // O caminho no disco de um arquivo que a pessoa ARRASTOU ou ESCOLHEU (File da pagina): e o que
    // deixa o .PrjPcb abrir com as folhas e a placa que ele cita (hub-altiumabrir.js). So le o
    // nome que o Chromium ja tem; quem abre o arquivo e o hubserver, que so aceita caminho de
    // .SchDoc/.PcbDoc/.PrjPcb vindo do proprio PC.
    caminho: (arquivo) => { try { return webUtils.getPathForFile(arquivo) || ''; } catch { return ''; } },
  });
}
