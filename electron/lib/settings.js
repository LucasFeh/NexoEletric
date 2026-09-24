'use strict';
// Configuracao da MAQUINA, em %APPDATA%\EletricHUB\settings.json.
//
// Fica fora da pasta de trabalho de proposito: e ela que diz ONDE a pasta de trabalho
// esta. Os segredos (token de atualizacao, chave da API do chat) vao cifrados com o
// safeStorage (DPAPI do Windows): o arquivo copiado para outra conta ou maquina nao os
// revela.
const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

const PADRAO = {
  // Pasta de trabalho: o equivalente ao "current" do servidor. Codigo do hub + Projects/,
  // Libs/, credenciais. C:\EletricHUB, e nao o perfil do usuario, por tres motivos:
  //   - o C:\ProgramData\AltiumPCBMirror\home.txt dos scripts do Altium e UM por maquina,
  //     entao a pasta que ele aponta tambem tem de ser da maquina, nao de um usuario;
  //   - caminho sem acento: um perfil "C:\Users\João" entraria no ALMOX.DbLib e no
  //     ConnectionString do ODBC, que o Altium le como ANSI;
  //   - fora de Documentos, que costuma ir para o OneDrive (300 MB sincronizando a cada
  //     export do Altium).
  workspace: '',
  // Porta fixa, e nao "qualquer livre": o localStorage do hub (preferencias, abas, zoom)
  // e por ORIGEM, e origem inclui a porta. Porta que muda a cada abertura zera tudo.
  // 8200 nao colide com as do repositorio (8000 principal, 8001 homologacao, 8100 servidor).
  port: 8200,
  // Escutar na rede local. Desligado por padrao: o hub tem rotas que gravam sem senha
  // (tools/deploy/PENDENCIAS.md, grupo 1), e exige senha mestre propria (main.js »
  // salvarConfig). O BOM nao precisa disto: o link copiado e o do servidor (serverUrl).
  lan: false,
  // O hub central: de onde o "Importar do servidor" puxa projetos e bibliotecas, e o
  // endereco do link do BOM (ALTIUMHUB_BOM_LINK).
  serverUrl: 'http://192.168.15.192:8100',
  // O Odoo de producao: e o que o sincronismo do almoxarifado consulta. So semeia o
  // hub-almox.json quando ele ainda nao existe; login e senha o usuario poe no hub.
  odooUrl: 'http://192.168.15.192:8070',
  odooDb: 'odoo_db',
  autoUpdate: true,
  // Antes de cada sincronismo do almoxarifado, trazer do servidor o estado que numera
  // (livro-razao de part numbers). Desligar faz deste PC uma segunda autoridade.
  syncGuard: true,
  // Senha mestre do hub (excluir projeto, chat). Vazia = a padrao do hubserver.py.
  masterPassword: '',
  updateToken: '',          // cifrado (safeStorage), em base64
  anthropicKey: '',         // cifrado; liga o motor "api" do chat (tools/chat/claude_api.py)
  window: null,             // {x,y,width,height,maximized}
  setupDone: false,
};

const SEGREDOS = ['updateToken', 'anthropicKey'];

let cache = null;

function arquivo() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function workspacePadrao() {
  return path.join(process.env.SystemDrive ? process.env.SystemDrive + '\\' : 'C:\\', 'EletricHUB');
}

function load() {
  if (cache) return cache;
  let lido = {};
  try {
    lido = JSON.parse(fs.readFileSync(arquivo(), 'utf8'));
  } catch {
    lido = {};
  }
  cache = { ...PADRAO, ...(lido && typeof lido === 'object' ? lido : {}) };
  return cache;
}

function save(patch) {
  const atual = load();
  cache = { ...atual, ...patch };
  const f = arquivo();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(f + '.tmp', f);
  return cache;
}

function getSegredo(nome) {
  const v = load()[nome];
  if (!v) return '';
  try {
    if (!safeStorage.isEncryptionAvailable()) return '';
    return safeStorage.decryptString(Buffer.from(v, 'base64'));
  } catch {
    return '';
  }
}

function setSegredo(nome, valor) {
  if (!SEGREDOS.includes(nome)) throw new Error('segredo desconhecido: ' + nome);
  const t = String(valor || '').trim();
  if (!t) return save({ [nome]: '' });
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('o Windows nao ofereceu cifragem (DPAPI) para guardar o segredo');
  }
  return save({ [nome]: safeStorage.encryptString(t).toString('base64') });
}

const getUpdateToken = () => getSegredo('updateToken');
const setUpdateToken = (t) => setSegredo('updateToken', t);

// A visao que as telas recebem: nunca um segredo, so se ha um.
function publicView() {
  const s = load();
  const v = { ...s, workspacePadrao: workspacePadrao() };
  for (const k of SEGREDOS) delete v[k];
  v.temToken = Boolean(s.updateToken);
  v.temChaveApi = Boolean(s.anthropicKey);
  return v;
}

module.exports = {
  load, save, getSegredo, setSegredo, getUpdateToken, setUpdateToken, publicView, workspacePadrao, PADRAO,
};
