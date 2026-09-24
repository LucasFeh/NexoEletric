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
const { contextBridge, ipcRenderer } = require('electron');

const CHAMADAS = new Set([
  'boot:estado', 'boot:tentar', 'boot:log', 'boot:config',
  'config:ler', 'config:escolherPasta', 'config:avaliarPasta', 'config:testarServidor', 'config:salvar',
  'config:verificarAtualizacoes',
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
