'use strict';
// Atualizacao automatica pelos releases do GitHub.
//
// O repositorio e PRIVADO (LucasFeh/AltiumPCBMirror), entao a consulta precisa de um token
// de LEITURA. Ele vem, nesta ordem:
//   1. do que o usuario gravou em Configuracoes (cifrado pelo safeStorage);
//   2. do token embutido no build (gen/build-info.json, escrito por scripts/prepare.mjs a
//      partir de ALTIUMHUB_UPDATE_TOKEN -- nunca versionado).
// Sem token o app funciona igual, so nao se atualiza sozinho, e diz isso.
//
// Use um token de granularidade fina, restrito a este repositorio e so com
// "Contents: Read-only": qualquer um que abra o .exe consegue extrai-lo.
//
// O `private: true` fica de FORA do setFeedURL de proposito: com ele o electron-updater usa
// GH_TOKEN/GITHUB_TOKEN do ambiente do usuario ANTES do token passado aqui (providerFactory),
// e um PC com um GITHUB_TOKEN de outra conta (gh, outra ferramenta) passaria a receber 404.
// Um token nao vazio no setFeedURL ja escolhe o provedor de repositorio privado.
const { app, dialog } = require('electron');
const log = require('electron-log/main');

const REPO = { provider: 'github', owner: 'LucasFeh', repo: 'AltiumPCBMirror' };
// Teste de ponta a ponta sem o GitHub: qualquer servidor HTTP com o latest.yml e o
// instalador que o electron-builder gera (provider "generic"). So existe com a variavel;
// ALTIUMHUB_UPDATE_AUTOINSTALL=1 instala sem perguntar (o teste nao tem quem clique).
const FEED_TESTE = process.env.ALTIUMHUB_UPDATE_FEED || '';
const AUTO_TESTE = process.env.ALTIUMHUB_UPDATE_AUTOINSTALL === '1';
const INTERVALO = 4 * 60 * 60 * 1000;   // de 4 em 4 horas, alem da checagem ao abrir

let autoUpdater = null;
let estado = { fase: 'parado', versao: '', erro: '', progresso: 0 };
let temporizador = null;
let ouvintes = [];
let instalarAoSair = false;      // "Reiniciar agora" pedido; o main.js instala no will-quit

function emite(patch) {
  estado = { ...estado, ...patch };
  for (const f of ouvintes) {
    try { f(estado); } catch { /* janela fechada */ }
  }
}

function onStatus(f) { ouvintes.push(f); }
function status() { return estado; }

function carregar() {
  if (autoUpdater) return autoUpdater;
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => emite({ fase: 'verificando', erro: '' }));
  autoUpdater.on('update-not-available', () => emite({ fase: 'atualizado', erro: '' }));
  autoUpdater.on('update-available', (info) => emite({ fase: 'baixando', versao: info.version, progresso: 0 }));
  autoUpdater.on('download-progress', (p) => emite({ fase: 'baixando', progresso: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => {
    emite({ fase: 'pronto', versao: info.version, progresso: 100 });
    if (AUTO_TESTE) instalarAgora();
    else perguntarReinicio(info.version);
  });
  autoUpdater.on('error', (e) => emite({ fase: 'erro', erro: traduz(e) }));
  return autoUpdater;
}

function traduz(e) {
  const m = String((e && (e.message || e)) || 'erro desconhecido');
  if (/401|Bad credentials/i.test(m)) return 'o GitHub recusou o token de atualizacao (401) — confira em Configuracoes';
  if (/404/.test(m) && /releases/.test(m)) return 'nenhum release publicado ainda, ou o token nao enxerga o repositorio';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::/i.test(m)) return 'sem acesso ao GitHub agora (rede)';
  return m.split('\n')[0].slice(0, 300);
}

function configurar(token) {
  const u = carregar();
  if (FEED_TESTE) u.setFeedURL({ provider: 'generic', url: FEED_TESTE });
  else u.setFeedURL({ ...REPO, token });
  return u;
}

async function perguntarReinicio(versao) {
  const r = await dialog.showMessageBox({
    type: 'info',
    title: 'EletricHUB',
    message: `A versão ${versao} foi baixada.`,
    detail: 'Reiniciar agora para instalar? Se preferir, ela é instalada sozinha quando você fechar o app.',
    buttons: ['Reiniciar agora', 'Depois'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (r.response === 0) await instalarAgora();
}

// "Reiniciar agora" e um app.quit() comum: as janelas perguntam pelo que nao foi salvo, e
// uma que recusar cancela tudo (web.js chama desistirDeInstalar). Quando todas aceitaram,
// o will-quit do main.js derruba o hub e so entao chama instalarSePedido().
function instalarAgora() {
  instalarAoSair = true;
  app.quit();
}

function desistirDeInstalar() { instalarAoSair = false; }

// true = o instalador foi disparado (e ele mesmo encerra o app).
function instalarSePedido() {
  if (!instalarAoSair) return false;
  instalarAoSair = false;       // quitAndInstall nao pode rodar duas vezes
  // isSilent=false mostra o progresso do instalador; isForceRunAfter=true reabre o app.
  carregar().quitAndInstall(false, true);
  return true;
}

/**
 * @param {{token:()=>string, enabled:()=>boolean}} o
 */
function iniciar(o) {
  if (!app.isPackaged) {
    emite({ fase: 'desligado', erro: 'rodando fora do instalador (desenvolvimento)' });
    return;
  }
  const agenda = () => {
    clearInterval(temporizador);
    temporizador = setInterval(() => verificar(o, false), INTERVALO);
  };
  setTimeout(() => verificar(o, false), 8000);
  agenda();
}

// manual=true: pedido pelo menu; responde mesmo quando nao ha nada novo.
async function verificar(o, manual) {
  if (!app.isPackaged) {
    emite({ fase: 'desligado', erro: 'rodando fora do instalador (desenvolvimento)' });
    return estado;
  }
  if (!manual && !o.enabled()) return estado;
  const token = o.token();
  if (!token && !FEED_TESTE) {
    emite({ fase: 'sem-token', erro: 'sem token de leitura do GitHub — informe em Configurações' });
    return estado;
  }
  if (estado.fase === 'baixando' || estado.fase === 'pronto') return estado;
  try {
    await configurar(token).checkForUpdates();
  } catch (e) {
    emite({ fase: 'erro', erro: traduz(e) });
  }
  return estado;
}

module.exports = { iniciar, verificar, instalarAgora, instalarSePedido, desistirDeInstalar, onStatus, status, REPO };
