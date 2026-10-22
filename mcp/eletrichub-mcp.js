#!/usr/bin/env node
/* NexoEletric MCP - o servidor MCP do hub (AltiumPCBMirror / NexoEletric desktop).

   Uso:
     node mcp/eletrichub-mcp.js [--root <pasta do hub>]                      (stdio)
     node mcp/eletrichub-mcp.js --http 8765 [--host 127.0.0.1] [--token X]    (HTTP Streamable)
     node mcp/eletrichub-mcp.js --listar                                      (imprime as ferramentas)

   --root   a pasta do hub. Opcional: sem ela (ou se ela nao for a pasta do hub) vale ELETRICHUB_ROOT,
            a do app aberto (%USERPROFILE%\.nexoeletric\session.json), a pasta de trabalho do app
            (%APPDATA%\NexoEletric\settings.json) e por fim a pasta acima deste script (o repo).
   --hub    URL do hub HTTP ja no ar (ex.: http://192.168.15.192:8100), para hub_status e
            vista_screenshot; sem ela procura 127.0.0.1 nas portas 8200, 8000, 8100 e 8001.
   --http   sobe o transporte HTTP Streamable em POST /mcp (a resposta e JSON; sem SSE do
            servidor). --host padrao 127.0.0.1. Fora do loopback EXIGE --token (Bearer): estas
            ferramentas gravam nos projetos.

   Sem dependencia externa nenhuma: so o Node (o app desktop leva o dele). Tudo que vai para a
   saida padrao e protocolo; log vai para a saida de erro. */
'use strict';
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { Contexto } = require('./lib/contexto.js');
const { Registro } = require('./lib/registro.js');
const { Servidor } = require('./lib/protocolo.js');
const recursos = require('./lib/recursos.js');
const { Relato } = require('./lib/relato.js');

const VERSAO = '1.1.0';

function args(argv) {
  const a = { root: null, http: null, host: '127.0.0.1', token: process.env.ELETRICHUB_MCP_TOKEN || '', hub: null, listar: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--root') { a.root = v; i++; }
    else if (k === '--http') { a.http = parseInt(v, 10); i++; }
    else if (k === '--host') { a.host = v; i++; }
    else if (k === '--token') { a.token = v; i++; }
    else if (k === '--hub') { a.hub = v; i++; }
    else if (k === '--projetos') { a.projetos = v; i++; }
    else if (k === '--listar') a.listar = true;
    else if (k === '--help' || k === '-h') a.ajuda = true;
  }
  return a;
}

const log = (...m) => process.stderr.write('[eletrichub-mcp] ' + m.join(' ') + '\n');

function montaServidor(opts) {
  const ctx = new Contexto({ root: opts.root, projetos: opts.projetos, hubUrl: opts.hub, log: opts.log || log });
  const reg = new Registro().carregar();
  for (const e of reg.erros) log('ferramenta não registrada: ' + e);
  /* o que a IA faz aparece no hub aberto (o indicador "IA" no topo e os avisos: hub-mcp.js) */
  const relato = opts.semRelato ? null : new Relato(ctx, { versao: VERSAO });
  const srv = new Servidor(ctx, reg, { versao: VERSAO, recursos: recursos.recursos(ctx), prompts: recursos.prompts(ctx),
    aoIniciar: relato ? (cli, n) => relato.ola(cli, n) : null,
    aoChamar: relato ? (f, a, r, ms) => relato.chamada(f, a, r, ms) : null });
  srv.registro = reg;
  srv.relato = relato;
  return srv;
}

/* ---------------- stdio: uma mensagem JSON por linha ---------------- */
function stdio(srv) {
  let buf = '';
  let fila = Promise.resolve();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const linha = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (!linha.trim()) continue;
      fila = fila.then(() => trata(srv, linha)).catch(e => log('erro: ' + (e && e.stack || e)));
    }
  });
  process.stdin.on('end', () => fila.then(() => process.exit(0)));
}
async function trata(srv, linha) {
  let msg;
  try { msg = JSON.parse(linha); }
  catch (_) { return envia({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }); }
  const r = await srv.atende(msg);
  if (r) envia(r);
}
function envia(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

/* ---------------- HTTP Streamable (POST /mcp -> application/json) ---------------- */
function servidorHttp(srv, o) {
  const loop = ['127.0.0.1', 'localhost', '::1'].includes(o.host);
  if (!loop && !o.token) throw new Error('--http fora do loopback exige --token (estas ferramentas gravam nos projetos)');
  const sessoes = new Set();
  const s = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const responde = (code, corpo, extra) => {
      const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra || {});
      res.writeHead(code, h); res.end(corpo == null ? '' : JSON.stringify(corpo));
    };
    if (url.pathname === '/saude') return responde(200, { ok: true, servidor: 'eletrichub-mcp', versao: VERSAO, root: srv.ctx.root });
    if (url.pathname !== '/mcp') return responde(404, { erro: 'use POST /mcp' });
    /* DNS rebinding: com o servidor no loopback, Origin de fora e recusado (exigencia da spec) */
    const origem = req.headers.origin;
    if (origem && loop && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(origem)) return responde(403, { erro: 'Origin recusado' });
    if (o.token) {
      const tk = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const a = Buffer.from(tk), b = Buffer.from(o.token);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return responde(401, { erro: 'token inválido' }, { 'WWW-Authenticate': 'Bearer' });
    }
    if (req.method === 'GET') return responde(405, null, { Allow: 'POST, DELETE' });
    if (req.method === 'DELETE') { sessoes.delete(req.headers['mcp-session-id']); return responde(200, null); }
    if (req.method !== 'POST') return responde(405, null, { Allow: 'POST, DELETE' });
    let corpo = '';
    req.setEncoding('utf8');
    for await (const c of req) { corpo += c; if (corpo.length > 20 * 1024 * 1024) return responde(413, { erro: 'corpo grande demais' }); }
    let msg;
    try { msg = JSON.parse(corpo); } catch (_) { return responde(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }); }
    const extra = {};
    const ehInit = !Array.isArray(msg) && msg && msg.method === 'initialize';
    if (ehInit) { const id = crypto.randomUUID(); sessoes.add(id); extra['Mcp-Session-Id'] = id; }
    const r = await srv.atende(msg);
    if (!r) { res.writeHead(202, { 'Cache-Control': 'no-store' }); return res.end(); }
    return responde(200, r, extra);
  });
  s.listen(o.http, o.host, () => srv.ctx.log(`HTTP em http://${o.host}:${o.http}/mcp (raiz ${srv.ctx.root})`));
  return s;
}

if (require.main === module) {
  const a = args(process.argv.slice(2));
  if (a.ajuda) { process.stdout.write(require('node:fs').readFileSync(__filename, 'utf8').split('*/')[0] + '*/\n'); process.exit(0); }
  let srv;
  try { srv = montaServidor(a); }
  catch (e) { log(String(e && e.message || e)); process.exit(2); }
  if (a.listar) {
    for (const g of srv.registro.grupos) {
      process.stdout.write(`\n# ${g.titulo}\n`);
      for (const f of g.ferramentas) process.stdout.write(`  ${f.nome.padEnd(26)} ${(f.titulo || '')}${f.modulo ? '  [' + f.modulo + ']' : ''}\n`);
    }
    process.exit(0);
  }
  log(`raiz ${srv.ctx.root} (${srv.ctx.origemRaiz}) · ${srv.registro.todas().length} ferramentas`);
  if (srv.ctx.avisoRaiz) log(srv.ctx.avisoRaiz);
  if (a.http) servidorHttp(srv, a);
  else stdio(srv);
}

module.exports = { montaServidor, servidorHttp, VERSAO, args };
