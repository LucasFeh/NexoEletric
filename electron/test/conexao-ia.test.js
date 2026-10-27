'use strict';
// lib/conexao-ia.js: a tela Conectar IA. Registro do MCP nos clientes de IA (numa "home" temporaria, sem o CLI do
// Claude), a conexao com o Nexo Hub (conexao.json temporario) e a saude do Hub com o banco que ELE reporta.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ci = require('../lib/conexao-ia');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conexao-ia-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ENTRADA = ci.entradaMcp({ packaged: true, exe: 'C:\\Program Files\\NexoEletric\\NexoEletric.exe', resourcesPath: 'C:\\Program Files\\NexoEletric\\resources' });

test('entradaMcp instalado = a do nexo-programa.json (a mesma que o Nexo Hub grava)', () => {
  const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'nexo-programa.json'), 'utf8')).mcp;
  const dir = 'C:\\Program Files\\NexoEletric';
  assert.deepStrictEqual(ENTRADA, {
    command: man.comando.replace('{instalacao}', dir),
    args: man.args.map((a) => a.replace('{instalacao}', dir)),
    env: man.env,
  });
  const t = ci.textosMcp(ENTRADA);
  assert.match(t.claudeCode, /^claude mcp add --scope user -e ELECTRON_RUN_AS_NODE=1 nexoeletric -- "C:\\Program Files\\NexoEletric\\NexoEletric.exe" /);
  assert.deepStrictEqual(JSON.parse(t.json).mcpServers.nexoeletric, ENTRADA);
});

test('registrar: Claude Code (~/.claude.json) e Claude Desktop, sem apagar os outros MCPs; depois fica em dia', async () => {
  const home = path.join(tmp, 'home');
  const appdata = path.join(home, 'AppData', 'Roaming');
  const env = { APPDATA: appdata, LOCALAPPDATA: path.join(home, 'AppData', 'Local'), NEXOELETRIC_CLAUDE_CLI: '' };
  fs.mkdirSync(path.join(appdata, 'Claude'), { recursive: true });
  const desk = path.join(appdata, 'Claude', 'claude_desktop_config.json');
  fs.writeFileSync(desk, JSON.stringify({ mcpServers: { outro: { command: 'x' } }, preferencias: { a: 1 } }));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ numStartups: 3, mcpServers: { nexoeletric: { command: 'velho', args: [] } } }));

  let st = ci.estadoRegistro(ENTRADA, { home, env });
  assert.equal(st.claudeCode.estado, 'diferente');
  assert.deepStrictEqual(st.claudeDesktop.map((d) => d.estado), ['ausente']);

  const r = await ci.registrar(ENTRADA, { home, env });
  assert.equal(r.claudeCode.estado, 'atualizado');
  assert.match(r.claudeDesktop[0].estado, /^atualizado/);
  const code = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
  assert.equal(code.numStartups, 3);
  assert.deepStrictEqual(code.mcpServers.nexoeletric, { type: 'stdio', ...ENTRADA });
  const d = JSON.parse(fs.readFileSync(desk, 'utf8'));
  assert.deepStrictEqual(d.mcpServers.nexoeletric, ENTRADA);          // o Desktop sem o "type"
  assert.deepStrictEqual(d.mcpServers.outro, { command: 'x' });
  assert.deepStrictEqual(d.preferencias, { a: 1 });
  assert.ok(fs.existsSync(desk + '.antes-nexoeletric'));

  st = ci.estadoRegistro(ENTRADA, { home, env });
  assert.equal(st.claudeCode.estado, 'em dia');
  assert.deepStrictEqual(st.claudeDesktop.map((x) => x.estado), ['em dia']);
  const deNovo = await ci.registrar(ENTRADA, { home, env });
  assert.equal(deNovo.claudeCode.estado, 'em dia');
});

test('conexao.json: grava o endereço, mantém o token quando o campo vem vazio, recusa endereço inválido', () => {
  const env = { NEXOHUB_CONEXAO: path.join(tmp, 'pub', 'NexoHub', 'conexao.json') };
  assert.equal(ci.lerConexao(env).url, ci.URL_PADRAO);
  assert.equal(ci.lerConexao(env).origem, 'padrão');
  ci.gravarConexao({ url: 'http://servidor:47800/', token: 'segredo' }, env);
  let c = ci.lerConexao(env);
  assert.equal(c.url, 'http://servidor:47800');
  assert.equal(c.token, 'segredo');
  ci.gravarConexao({ url: 'http://servidor:47800', token: '' }, env);
  assert.equal(ci.lerConexao(env).token, 'segredo');
  ci.gravarConexao({ url: '' }, env);
  c = ci.lerConexao(env);
  assert.equal(c.url, ci.URL_PADRAO);
  assert.equal(c.token, '');
  assert.throws(() => ci.gravarConexao({ url: 'servidor sem http' }, env), /endereço inválido/);
});

test('saudeHub: conectado só com os dados (bd.ok); respondeu sem os dados = desconectado; fora do ar; token', async () => {
  let resposta = { ok: true, app: 'nexohub', versao: '2.12.0', revisao: 7, bd: { url: 'http://127.0.0.1:47810', ok: true } };
  let status = 200;
  const srv = http.createServer((req, res) => {
    assert.equal(req.url, '/api/v1/saude');
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status === 200 ? resposta : { ok: false, erro: 'token inválido' }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    let h = await ci.saudeHub({ url });
    assert.equal(h.conectado, true);
    assert.equal(h.versao, '2.12.0');
    assert.equal('bd' in h, false);                                // a interface so fala do Hub
    resposta = { ...resposta, bd: { ok: false, erro: 'recusou' } };
    h = await ci.saudeHub({ url });
    assert.deepStrictEqual([h.conectado, h.respondeu, h.semDados], [false, true, true]);
    assert.doesNotMatch(h.erro, /NexoBD|banco|recusou/i);
    resposta = { ok: true, versao: '1.0.0' };                     // Hub antigo, sem dizer se tem os dados
    assert.equal((await ci.saudeHub({ url })).conectado, false);
    status = 401;
    h = await ci.saudeHub({ url });
    assert.equal(h.conectado, false);
    assert.match(h.erro, /token/);
  } finally {
    await new Promise((r) => srv.close(r));
  }
  const fora = await ci.saudeHub({ url: 'http://127.0.0.1:1' });
  assert.deepStrictEqual([fora.conectado, fora.respondeu], [false, false]);
  assert.match(fora.erro, /não respond/);
});
