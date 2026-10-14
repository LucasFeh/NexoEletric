/* EletricHUB MCP - registrar.js
   Gera os trechos de configuracao para registrar este servidor MCP nos clientes, ja com os
   caminhos DESTA instalacao. O integrador poe um item no menu do app ("Conectar a IA (MCP)") e
   nas Configuracoes do hub que mostra/copia isto.

     const { configuracoes } = require('./mcp/registrar.js');
     configuracoes({ root: 'C:\\EletricHUB', node: process.execPath })
       -> { claudeCode, claudeDesktop, claudeDesktopArquivo, http, chatCli, comandoStdio }

   Em linha de comando: node mcp/registrar.js [--root <pasta>] [--node <node.exe>] [--json]

   Sobre o `node`: o app desktop leva o Electron, que roda como Node com ELECTRON_RUN_AS_NODE=1
   -- passe { node: process.execPath, electron: true } de dentro do app e o trecho sai com essa
   variavel. Fora do app, "node" do PATH. */
'use strict';
const path = require('node:path');
const os = require('node:os');

function q(s) { return /[\s"']/.test(s) ? '"' + String(s).replace(/"/g, '\\"') + '"' : String(s); }

function configuracoes(opts) {
  const o = opts || {};
  const script = path.resolve(o.script || path.join(__dirname, 'eletrichub-mcp.js'));
  const root = path.resolve(o.root || path.join(__dirname, '..'));
  const node = o.node || 'node';
  const nome = o.nome || 'eletrichub';
  const env = o.electron ? { ELECTRON_RUN_AS_NODE: '1' } : undefined;
  const args = [script, '--root', root].concat(o.hub ? ['--hub', o.hub] : []);
  const porta = o.porta || 8765;
  const servidor = Object.assign({ command: node, args }, env ? { env } : {});

  const envFlags = env ? Object.entries(env).map(([k, v]) => `--env ${k}=${v} `).join('') : '';
  const claudeCode = `claude mcp add --transport stdio --scope user ${envFlags}${nome} -- ${[node].concat(args).map(q).join(' ')}`;
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return {
    comandoStdio: [node].concat(args).map(q).join(' '),
    claudeCode,
    claudeDesktop: { mcpServers: { [nome]: servidor } },
    claudeDesktopArquivo: process.platform === 'win32' ? path.join(appData, 'Claude', 'claude_desktop_config.json')
      : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json'),
    /* .mcp.json na raiz do projeto do Claude Code (escopo de projeto) */
    mcpJson: { mcpServers: { [nome]: Object.assign({ type: 'stdio' }, servidor) } },
    http: {
      subir: [node].concat([script, '--root', root, '--http', String(porta), '--host', '127.0.0.1']).map(q).join(' '),
      url: `http://127.0.0.1:${porta}/mcp`,
      claudeCode: `claude mcp add --transport http ${nome} http://127.0.0.1:${porta}/mcp`,
      nota: 'fora do 127.0.0.1 o servidor exige --token <segredo> e o cliente manda Authorization: Bearer <segredo>',
    },
    /* para o chat do hub (tools/chat/claude_cli.py): o `claude` aceita --mcp-config <json> */
    chatCli: { mcpServers: { [nome]: servidor } },
  };
}

if (require.main === module) {
  const a = process.argv.slice(2);
  const val = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const c = configuracoes({ root: val('--root'), node: val('--node'), hub: val('--hub') });
  if (a.includes('--json')) { process.stdout.write(JSON.stringify(c, null, 2) + '\n'); process.exit(0); }
  process.stdout.write([
    'EletricHUB MCP — como registrar',
    '',
    'Claude Code (terminal):',
    '  ' + c.claudeCode,
    '',
    'Claude Desktop — acrescente em ' + c.claudeDesktopArquivo + ':',
    JSON.stringify(c.claudeDesktop, null, 2).replace(/^/gm, '  '),
    '',
    'HTTP (servidor da rede / outro cliente):',
    '  subir:    ' + c.http.subir,
    '  cliente:  ' + c.http.claudeCode,
    '',
  ].join('\n'));
}

module.exports = { configuracoes };
