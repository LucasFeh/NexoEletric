/* Teardrops pelo MCP (1.42.0), como um cliente o usaria (o servidor no mesmo processo), numa CÓPIA
   temporária de uma placa do acervo — os Projects reais nunca são gravados:
     node tests/test-mcp-teardrop.js

   1. teardrop_remover {simular} não grava; sem simular, os teardrops do espelho ganham um region_del;
   2. teardrop_aplicar põe de novo, também os de junção em T (em_t); de novo, nada a pôr;
   3. teardrop_remover tira os do hub (as linhas region_add saem); de novo, nada a tirar.
   (fs.cpSync derruba o Node 22.23 desta máquina sem mensagem, código 127: rode com o Node 24) */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');

process.env.ELETRICHUB_SEM_RELATO = '1';
const RAIZ = path.join(__dirname, '..');
const PROJ = 'PRJ - DI261930';
const ORIGEM = path.join(RAIZ, 'Projects', PROJ);
let falhou = 0;
const ok = (c, m) => { if (c) console.log('ok  ' + m); else { falhou++; console.log('FALHOU  ' + m); } };

if (!fs.existsSync(path.join(ORIGEM, 'board.js'))) { console.log('test-mcp-teardrop: a placa do acervo não está aqui — pulado'); process.exit(0); }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-td-'));
const PROJETOS = path.join(TMP, 'Projects');
fs.mkdirSync(PROJETOS);
fs.cpSync(ORIGEM, path.join(PROJETOS, PROJ), { recursive: true });
const D = path.join(PROJETOS, PROJ);
/* o acervo é todo de espelho antigo (sem "exporter"), em que region_del é recusado: a CÓPIA ganha a marca
   do ExportBoard novo para os teardrops do espelho poderem sair */
const bj = path.join(D, 'board.js');
fs.writeFileSync(bj, fs.readFileSync(bj, 'utf8').replace(/var pcbmirror = \{/, 'var pcbmirror = {\n"exporter":"ExportBoard 2026-10 (teste)",'));
fs.writeFileSync(path.join(D, 'changes.js'), require('../hub-core.js').serializeChanges([]).text);
fs.writeFileSync(path.join(TMP, 'projects.js'), 'var projects = [\n];\n');
const realAntes = fs.readFileSync(path.join(ORIGEM, 'board.js'), 'utf8');

const { montaServidor } = require('../mcp/eletrichub-mcp.js');
const srv = montaServidor({ root: RAIZ, projetos: PROJETOS, log: () => {} });
let seq = 0;
async function chama(name, args) {
  const r = await srv.atende({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } });
  return { j: JSON.parse(r.result.content[0].text), erro: !!r.result.isError };
}
const texto = () => fs.readFileSync(path.join(D, 'changes.js'), 'utf8');
const linhas = () => texto().split('\n').filter(l => l.startsWith('{'));

(async () => {
  const lista = (await srv.atende({ jsonrpc: '2.0', id: ++seq, method: 'tools/list', params: {} })).result.tools;
  ok(lista.some(t => t.name === 'teardrop_remover'), 'teardrop_remover no tools/list');

  /* 1. os do espelho saem (region_del) */
  const antes = texto();
  let { j } = await chama('teardrop_remover', { projeto: PROJ, simular: true });
  ok(j.simulado && j.do_espelho > 0 && texto() === antes, `teardrop_remover simulado: ${j.do_espelho} do espelho, nada gravado`);
  const espelho = j.do_espelho;
  ({ j } = await chama('teardrop_remover', { projeto: PROJ, camadas: ['Bottom'], simular: true }));
  ok(j.simulado && j.tirados > 0 && j.tirados < espelho, `só Bottom: ${j.tirados} de ${espelho}`);
  ({ j } = await chama('teardrop_remover', { projeto: PROJ }));
  ok(j.gravado && j.do_espelho === espelho && !j.ficaram && !(j.erros || []).length, `teardrop_remover: ${j.tirados} tirados do espelho` + (j.gravado ? '' : ': ' + JSON.stringify(j).slice(0, 400)));
  ok(linhas().filter(l => /"op":"region_del"/.test(l)).length === espelho, 'um region_del por teardrop do espelho');

  /* 2. o hub põe de novo, com os de junção em T */
  ({ j } = await chama('teardrop_aplicar', { projeto: PROJ }));
  ok(j.gravado && j.postos > 0 && j.em_t > 0, `teardrop_aplicar: ${j.postos} postos, ${j.em_t} em T` + (j.gravado ? '' : ': ' + JSON.stringify(j).slice(0, 400)));
  const postos = j.postos;
  ok(linhas().filter(l => /"note":"teardrop do hub"/.test(l)).length === postos, 'uma linha region_add por teardrop');
  ({ j } = await chama('teardrop_aplicar', { projeto: PROJ }));
  ok(j.postos === 0, 'de novo: nada a pôr (' + j.postos + ')');

  /* 3. os do hub saem tirando as linhas */
  ({ j } = await chama('teardrop_remover', { projeto: PROJ }));
  ok(j.gravado && j.do_hub === postos && j.do_espelho === 0, `teardrop_remover: ${j.do_hub} do hub` + (j.gravado ? '' : ': ' + JSON.stringify(j).slice(0, 400)));
  ok(!linhas().some(l => /"note":"teardrop do hub"/.test(l)) && linhas().length === espelho, 'as linhas do hub saíram; ficam só os region_del');
  ({ j } = await chama('pcb_validar', { projeto: PROJ }));
  ok(j.ok, 'pcb_validar passa');
  ({ j } = await chama('teardrop_remover', { projeto: PROJ }));
  ok(!j.tirados, 'de novo: nenhum teardrop na placa (' + JSON.stringify(j).slice(0, 160) + ')');

  ok(fs.readFileSync(path.join(ORIGEM, 'board.js'), 'utf8') === realAntes, 'o projeto real não mudou');
  fs.rmSync(TMP, { recursive: true, force: true });
  if (falhou) { console.log(`test-mcp-teardrop FALHOU (${falhou})`); process.exit(1); }
  console.log('test-mcp-teardrop OK');
})().catch(e => { console.error(e); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
