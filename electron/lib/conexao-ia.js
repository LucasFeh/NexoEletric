'use strict';
// A tela "Conectar IA" (ui/conexao.html), no desenho da do NexoCAD (Avaliar › Conectar IA): o MCP do NexoEletric e a
// conexao com o Nexo Hub. Aqui fica o que nao depende do Electron, para os testes (test/conexao-ia.test.js).
//
//   entradaMcp     -> {command, args, env}: a MESMA entrada que o Nexo Hub grava nos clientes de IA a partir do
//                     nexo-programa.json (NexoEletric.exe + resources\hub\mcp\eletrichub-mcp.js com ELECTRON_RUN_AS_NODE).
//                     Se as duas fossem diferentes, o Hub e o app ficariam trocando o registro um do outro.
//   estadoRegistro -> o MCP "nexoeletric" esta no Claude Code (~/.claude.json) e no Claude Desktop? igual, diferente, ausente
//   registrar      -> grava nos dois (claude mcp add-json -s user; sem o CLI, no ~/.claude.json; Desktop sem o "type")
//   saudeHub       -> GET /api/v1/saude do Nexo Hub. "Conectado" = o Hub respondeu E esta com os dados (bd.ok);
//                     a interface so fala do Hub (pedido do dono), entao o resto nao sai daqui.
//   gravarConexao  -> C:\Users\Public\NexoHub\conexao.json (o mesmo arquivo do NexoCAD e dos outros programas)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const NOME = 'nexoeletric';
const URL_PADRAO = 'http://127.0.0.1:47800';

function arqConexao(env = process.env) {
  if (env.NEXOHUB_CONEXAO) return env.NEXOHUB_CONEXAO;
  const pub = env.PUBLIC || 'C:\\Users\\Public';
  return path.join(pub.replace(/[\\/]+$/, ''), 'NexoHub', 'conexao.json');
}

const limpaUrl = (u) => String(u || '').trim().replace(/\/+$/, '');

/** Onde esta o Nexo Hub: NEXOHUB_URL > conexao.json > padrao (a mesma ordem do nexohub-cliente.mjs). */
function lerConexao(env = process.env) {
  const arquivo = arqConexao(env);
  if (env.NEXOHUB_URL) return { url: limpaUrl(env.NEXOHUB_URL), token: env.NEXOHUB_TOKEN || '', origem: 'variável NEXOHUB_URL', arquivo };
  try {
    const j = JSON.parse(fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, ''));
    if (j && j.url) return { url: limpaUrl(j.url), token: env.NEXOHUB_TOKEN || j.token || '', origem: arquivo, arquivo };
  } catch { /* sem arquivo: vale o padrao */ }
  return { url: URL_PADRAO, token: env.NEXOHUB_TOKEN || '', origem: 'padrão', arquivo };
}

/** Grava o endereco do Nexo Hub para todos os programas desta maquina. url vazia = esta maquina. */
function gravarConexao({ url, token } = {}, env = process.env) {
  const u = limpaUrl(url) || URL_PADRAO;
  if (!/^https?:\/\/[^\s/]+/i.test(u)) throw new Error(`endereço inválido: ${url} (ex.: http://servidor:47800)`);
  const arquivo = arqConexao(env);
  let atual = {};
  try { atual = JSON.parse(fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '')) || {}; } catch { /* novo */ }
  // token em branco mantem o que ja estava (o campo nao mostra o token gravado)
  const tok = token == null || token === '' ? (atual.url && limpaUrl(atual.url) === u ? atual.token || '' : '') : String(token);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...atual, url: u, token: tok }, null, 1));
  fs.renameSync(tmp, arquivo);
  return lerConexao(env);
}

/**
 * Pergunta ao Nexo Hub como ele esta. Nunca lanca: {conectado, respondeu, url, versao, revisao, maquina, erro, ms}.
 * conectado = respondeu E o /api/v1/saude veio com bd.ok === true (com os dados). Respondeu sem os dados: para a
 * pessoa e "Nexo Hub desconectado" (semDados: true), sem falar do que ha atras dele.
 */
async function saudeHub({ url, token, timeout = 2500, fetch: f = globalThis.fetch } = {}) {
  const c = url ? { url: limpaUrl(url), token: token || '' } : lerConexao();
  const t0 = Date.now();
  const fora = (erro, extra = {}) => ({ conectado: false, respondeu: false, semDados: false, url: c.url, erro, ms: Date.now() - t0, ...extra });
  try {
    const h = {};
    if (c.token) h.Authorization = `Bearer ${c.token}`;
    h['X-App'] = NOME;
    const r = await f(c.url + '/api/v1/saude', { headers: h, signal: AbortSignal.timeout(timeout) });
    let j = null;
    try { j = await r.json(); } catch { /* corpo nao-JSON */ }
    if (!r.ok || !j) {
      return fora(r.status === 401 ? 'o Nexo Hub pediu um token (Conexão com o Nexo Hub…)' : (j && j.erro) || `o Nexo Hub respondeu HTTP ${r.status}`,
        { respondeu: true });
    }
    const info = { url: c.url, versao: j.versao || '', revisao: j.revisao == null ? null : j.revisao, maquina: j.maquina || '', ms: Date.now() - t0 };
    if (!(j.bd && j.bd.ok === true)) return { ...fora('o Nexo Hub respondeu, mas está sem os dados agora', { respondeu: true, semDados: true }), ...info };
    return { conectado: true, respondeu: true, semDados: false, erro: '', ...info };
  } catch (err) {
    const tempo = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return fora(tempo ? `o Nexo Hub não respondeu em ${timeout / 1000} s` : `o Nexo Hub não responde em ${c.url}`);
  }
}

/**
 * A entrada do MCP nesta instalacao. Instalado: o proprio NexoEletric.exe roda o servidor como Node
 * (nao precisa instalar Node.js), com o script de resources\hub\mcp -- o mesmo do nexo-programa.json.
 * Desenvolvimento: o electron.exe com o mcp/ do repositorio.
 */
function entradaMcp({ packaged, exe, resourcesPath, repo }) {
  const script = packaged
    ? path.join(resourcesPath, 'hub', 'mcp', 'eletrichub-mcp.js')
    : path.join(repo, 'mcp', 'eletrichub-mcp.js');
  return { command: exe, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

const q = (s) => (/[\s"']/.test(s) ? '"' + String(s).replace(/"/g, '\\"') + '"' : String(s));

/** Os textos que a tela mostra para copiar: o comando do Claude Code e o JSON dos outros clientes. */
function textosMcp(e) {
  const envFlags = Object.entries(e.env || {}).map(([k, v]) => `-e ${k}=${v} `).join('');
  return {
    claudeCode: `claude mcp add --scope user ${envFlags}${NOME} -- ${[e.command, ...e.args].map(q).join(' ')}`,
    json: JSON.stringify({ mcpServers: { [NOME]: e } }, null, 2),
  };
}

/** Arquivos do Claude Desktop nesta conta (o normal e o da Microsoft Store) -- os mesmos que o Nexo Hub atualiza. */
function configsDesktop({ home = os.homedir(), env = process.env } = {}) {
  const out = [];
  const appdata = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  if (fs.existsSync(path.join(appdata, 'Claude'))) out.push(path.join(appdata, 'Claude', 'claude_desktop_config.json'));
  try {
    for (const d of fs.readdirSync(path.join(local, 'Packages')).filter((x) => /^Claude_/i.test(x))) {
      const pasta = path.join(local, 'Packages', d, 'LocalCache', 'Roaming', 'Claude');
      if (fs.existsSync(pasta)) out.push(path.join(pasta, 'claude_desktop_config.json'));
    }
  } catch { /* sem Microsoft Store */ }
  return out;
}

const lerJson = (arq) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const mesma = (a, e) => Boolean(a) && a.command === e.command && JSON.stringify(a.args || []) === JSON.stringify(e.args || [])
  && JSON.stringify(a.env || {}) === JSON.stringify(e.env || {});

/** {claudeCode: {estado, arquivo, atual}, claudeDesktop: [{estado, arquivo}]}; estado = 'em dia' | 'diferente' | 'ausente' */
function estadoRegistro(e, { home = os.homedir(), env = process.env } = {}) {
  const arqCode = path.join(home, '.claude.json');
  const j = lerJson(arqCode);
  const atual = j && j.mcpServers && j.mcpServers[NOME];
  const claudeCode = { arquivo: arqCode, estado: !atual ? 'ausente' : mesma(atual, e) ? 'em dia' : 'diferente', atual: atual || null };
  const claudeDesktop = configsDesktop({ home, env }).map((arq) => {
    const d = lerJson(arq);
    const a = d && d.mcpServers && d.mcpServers[NOME];
    return { arquivo: arq, estado: !a ? 'ausente' : mesma(a, e) ? 'em dia' : 'diferente' };
  });
  return { claudeCode, claudeDesktop };
}

function gravaJson(arq, obj) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const tmp = `${arq}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, arq);
}

const executa = (cmd, args, op = {}) => new Promise((res) => execFile(cmd, args, { windowsHide: true, timeout: 60000, maxBuffer: 8 << 20, ...op },
  (err, out, errout) => res({ ok: !err, out: String(out || ''), err: String(errout || (err && err.message) || '') })));

/** O claude.exe do Claude Code, se houver (o mesmo lugar onde o Nexo Hub procura). '' = editar o ~/.claude.json. */
function acharClaudeCli(home, env = process.env) {
  if (env.NEXOELETRIC_CLAUDE_CLI !== undefined) return env.NEXOELETRIC_CLAUDE_CLI;   // "" = nao usar (testes)
  const c = path.join(home, '.local', 'bin', 'claude.exe');
  return fs.existsSync(c) ? c : '';
}

/** Registra o MCP no Claude Code (escopo do usuario) e no Claude Desktop. -> {claudeCode: {estado}, claudeDesktop: [{arquivo, estado}]} */
async function registrar(e, { home = os.homedir(), env = process.env, desktop } = {}) {
  const arqCode = path.join(home, '.claude.json');
  const j = lerJson(arqCode);
  const atual = j && j.mcpServers && j.mcpServers[NOME];
  const out = { claudeCode: null, claudeDesktop: [] };
  const comTipo = { type: 'stdio', ...e };
  if (mesma(atual, e)) out.claudeCode = { arquivo: arqCode, estado: 'em dia' };
  else {
    const cli = acharClaudeCli(home, env);
    let feito = false;
    // so o .exe: um .cmd passaria pelo cmd.exe, que estraga as aspas do JSON
    if (cli && !/\.cmd$/i.test(cli)) {
      if (atual) await executa(cli, ['mcp', 'remove', '-s', 'user', NOME], { cwd: home });
      const r = await executa(cli, ['mcp', 'add-json', '-s', 'user', NOME, JSON.stringify(comTipo)], { cwd: home });
      const depois = lerJson(arqCode);
      feito = r.ok && mesma(depois && depois.mcpServers && depois.mcpServers[NOME], e);
    }
    if (!feito) {
      const k = lerJson(arqCode) || {};
      k.mcpServers = { ...(k.mcpServers || {}), [NOME]: comTipo };
      gravaJson(arqCode, k);
    }
    out.claudeCode = { arquivo: arqCode, estado: atual ? 'atualizado' : 'adicionado' };
  }
  const arqs = desktop || configsDesktop({ home, env });
  for (const arq of arqs) {
    const d = lerJson(arq) || {};
    if (mesma(d.mcpServers && d.mcpServers[NOME], e)) { out.claudeDesktop.push({ arquivo: arq, estado: 'em dia' }); continue; }
    if (fs.existsSync(arq) && !fs.existsSync(arq + '.antes-nexoeletric')) fs.copyFileSync(arq, arq + '.antes-nexoeletric');
    d.mcpServers = { ...(d.mcpServers || {}), [NOME]: e };
    gravaJson(arq, d);
    out.claudeDesktop.push({ arquivo: arq, estado: 'atualizado (reinicie o Claude Desktop)' });
  }
  return out;
}

module.exports = {
  NOME, URL_PADRAO, arqConexao, lerConexao, gravarConexao, saudeHub, entradaMcp, textosMcp,
  configsDesktop, estadoRegistro, registrar,
};
