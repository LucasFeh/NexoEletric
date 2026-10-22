'use strict';
// lib/armazem.js (1.14.0): o NexoEletric nao guarda nada. Contra o NexoBD DE VERDADE (..\..\NexoBD, ou NEXOBD_REPO),
// numa pasta temporaria e porta aleatoria: a pasta de trabalho sobe projetos, biblioteca e scripts; outra pasta
// (outro PC, ou a mesma apagada) recebe tudo de volta; o "excluir projeto" do hub apaga no NexoBD.
// Sem o repositorio do NexoBD na maquina, os testes pulam.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const REPO_BD = [process.env.NEXOBD_REPO, path.join(__dirname, '..', '..', '..', 'NexoBD')].filter(Boolean)
  .find((d) => fs.existsSync(path.join(d, 'server', 'servidor.mjs')));
const pula = REPO_BD ? false : 'sem o repositório do NexoBD ao lado (NEXOBD_REPO)';

const armazem = require('../lib/armazem');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'armazem-'));
const escreve = (dir, rel, txt) => { const a = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, txt); };
const le = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8');

let bd, cliente;
test.before(async () => {
  if (pula) return;
  const { iniciarServidor } = await import(pathToFileURL(path.join(REPO_BD, 'server', 'servidor.mjs')).href);
  bd = await iniciarServidor({ dados: path.join(tmp, 'bd'), porta: 0, host: '127.0.0.1', ponteiro: false, backupDiario: false, keepAliveMs: 300 });
  const { criarCliente } = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'nexohub-cliente.mjs')).href);
  cliente = criarCliente({ url: bd.url, app: 'nexoeletric' });
});
test.after(async () => { await bd?.fechar(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('ligado: padrão sim; não numa pasta de desenvolvedor, nem desligado nas configurações, nem nos testes sem NEXOHUB_URL', () => {
  assert.equal(armazem.ligado({}, false, {}), true);
  assert.equal(armazem.ligado({ nexobd: false }, false, {}), false);
  assert.equal(armazem.ligado({}, true, {}), false);
  assert.equal(armazem.ligado({}, false, { ALTIUMHUB_SMOKE: '1' }), false);
  assert.equal(armazem.ligado({}, false, { ALTIUMHUB_SMOKE: '1', NEXOHUB_URL: 'http://x' }), true);
  assert.equal(armazem.aceitaLib('3d/abc.step'), false);
  assert.equal(armazem.aceitaLib('pcblib-3d.js'), false);
  assert.equal(armazem.aceitaLib('Almox/ALMOX.DbLib'), true);
});

test('a pasta de trabalho sobe tudo; outra pasta recebe; nada fica no catálogo', { skip: pula }, async () => {
  const ws = path.join(tmp, 'ws1'), bundle = path.join(tmp, 'bundle');
  for (const f of armazem.SCRIPTS) escreve(bundle, f, `conteúdo de ${f}`);
  escreve(bundle, 'hub.html', '<html>');
  escreve(ws, 'Libs/schlib.js', 'var schlib={}');
  escreve(ws, 'Libs/almox-parts.json', '{}');
  escreve(ws, 'Libs/3d/cache.step', 'cache');
  escreve(ws, 'Projects/TCMS_Reader/schematic.js', 'var schematic={}');
  escreve(ws, 'Projects/TCMS_Reader/Gerber/TCMS.GTL', 'G04*');
  const est1 = {};
  const r = await armazem.rodada({ ws, bundle, cliente, estado: est1 });
  assert.equal(r.scripts.rev, 1);
  assert.equal(r.biblioteca.rev, 1);
  assert.deepEqual(Object.keys(r.projetos.projetos), ['TCMS_Reader']);
  const scripts = await cliente.chave('nexoeletric-scripts', 'altium');
  assert.deepEqual(Object.values(scripts.arquivos).map((a) => a.nome).sort(), [...armazem.SCRIPTS].sort());
  const lib = await cliente.chave('nexoeletric-biblioteca', 'principal');
  assert.deepEqual(Object.values(lib.arquivos).map((a) => a.nome).sort(), ['almox-parts.json', 'schlib.js'], 'o cache do 3D fica fora');
  assert.equal((await cliente.itens()).total, 0, 'projetos, biblioteca e scripts não aparecem no catálogo');

  // outro PC (ou a mesma pasta apagada): tudo volta do NexoBD
  const ws2 = path.join(tmp, 'ws2');
  await armazem.rodada({ ws: ws2, bundle: '', cliente, estado: {} });
  assert.equal(le(ws2, 'Libs/schlib.js'), 'var schlib={}');
  assert.equal(le(ws2, 'Projects/TCMS_Reader/Gerber/TCMS.GTL'), 'G04*');

  // o sincronismo do Odoo mexeu na biblioteca daqui: sobe; o outro recebe
  escreve(ws, 'Libs/almox-parts.json', '{"R1":"PN-0001"}');
  await armazem.rodada({ ws, bundle, cliente, estado: est1, scripts: false });
  const est2 = {};
  await armazem.rodada({ ws: ws2, bundle: '', cliente, estado: est2 });
  assert.equal(le(ws2, 'Libs/almox-parts.json'), '{"R1":"PN-0001"}');

  // o hub apagou o projeto (Trash + nota): a rodada apaga no NexoBD e tira a nota
  fs.renameSync(path.join(ws, 'Projects', 'TCMS_Reader'), path.join(tmp, 'lixo-TCMS'));
  fs.mkdirSync(path.join(ws, '.altiumhub'), { recursive: true });
  fs.writeFileSync(armazem.ARQ_APAGAR(ws), JSON.stringify(['TCMS_Reader']));
  const r3 = await armazem.rodada({ ws, bundle, cliente, estado: est1, scripts: false });
  assert.deepEqual(r3.projetos.apagadosNoNexoBD, ['TCMS_Reader']);
  assert.equal(fs.existsSync(armazem.ARQ_APAGAR(ws)), false);
  assert.equal(await cliente.chave('nexoeletric-projeto', 'TCMS_Reader'), null);
  assert.equal(fs.existsSync(path.join(ws, 'Projects', 'TCMS_Reader')), false, 'não volta do NexoBD');
  // e no outro PC sai também (para a lixeira dele)
  const r4 = await armazem.rodada({ ws: ws2, bundle: '', cliente, estado: est2 });
  assert.deepEqual(r4.projetos.removidosDaqui, ['TCMS_Reader']);
});
