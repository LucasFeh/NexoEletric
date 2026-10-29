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

test('ligado: padrão sim; não numa pasta de desenvolvedor, nem nos testes sem NEXOHUB_URL; "nexobd": false antigo não desliga (1.31.0)', () => {
  assert.equal(armazem.ligado({}, false, {}), true);
  assert.equal(armazem.ligado({ nexobd: false, serverUrl: 'http://192.168.15.192:8100' }, false, {}), true);
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
  for (const f of ['tools/almox/almox2lib.py', 'tools/symbols/guardiao.py', 'tools/libpath.py', 'tools/chat/chatserver.py', 'tools/symbols/config.json']) escreve(bundle, f, `# ${f}`);
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
  // o gerador do Odoo sobe para o NexoBD rodar o sincronismo (so o que ele usa; nada de config da maquina nem do chat)
  const ferr = await cliente.chave('nexoeletric-ferramentas', 'odoo');
  assert.deepEqual(Object.values(ferr.arquivos).map((a) => a.nome).sort(), ['tools/almox/almox2lib.py', 'tools/libpath.py', 'tools/symbols/guardiao.py']);
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

test('renomear projeto (1.45.0): o mesmo item troca de chave e nome, nada volta com o nome velho, a outra máquina acompanha', { skip: pula }, async () => {
  const A = path.join(tmp, 'renA'), B = path.join(tmp, 'renB');
  const eA = {}, eB = {};
  escreve(A, 'Projects/PCB1/schematic.js', 'var schematic={"items":[]}');
  await armazem.rodada({ ws: A, bundle: '', cliente, estado: eA });
  await armazem.rodada({ ws: B, bundle: '', cliente, estado: eB });
  const antes = await cliente.chave('nexoeletric-projeto', 'PCB1');
  assert.ok(antes && fs.existsSync(path.join(B, 'Projects', 'PCB1', 'schematic.js')));
  // o hubserver anota e depois renomeia a pasta (e B edita a dele enquanto isso: não pode perder)
  fs.mkdirSync(path.join(A, '.altiumhub'), { recursive: true });
  fs.writeFileSync(armazem.ARQ_RENOMEAR(A), JSON.stringify([{ de: 'PCB1', para: 'Fonte 24V' }]));
  fs.renameSync(path.join(A, 'Projects', 'PCB1'), path.join(A, 'Projects', 'Fonte 24V'));
  escreve(B, 'Projects/PCB1/changes.js', 'var changes=[]');
  const r = await armazem.rodada({ ws: A, bundle: '', cliente, estado: eA });
  assert.deepEqual(Object.keys(r.projetos.projetos).filter((n) => /PCB1|Fonte/.test(n)), ['Fonte 24V']);
  assert.equal(fs.existsSync(armazem.ARQ_RENOMEAR(A)), false);
  assert.equal(fs.existsSync(path.join(A, 'Projects', 'PCB1')), false, 'o nome velho não volta do NexoBD');
  assert.equal(await cliente.chave('nexoeletric-projeto', 'PCB1'), null);
  const depois = await cliente.chave('nexoeletric-projeto', 'Fonte 24V');
  assert.equal(depois.id, antes.id, 'o mesmo item: o histórico fica');
  assert.equal(depois.nome, 'Fonte 24V');
  // B: a pasta é renomeada (sem lixeira) e a edição dela sobe com o nome novo
  const rB = await armazem.rodada({ ws: B, bundle: '', cliente, estado: eB });
  assert.deepEqual(rB.projetos.removidosDaqui, []);
  assert.equal(fs.existsSync(path.join(B, 'Projects', 'PCB1')), false);
  assert.equal(le(B, 'Projects/Fonte 24V/changes.js'), 'var changes=[]');
  await armazem.rodada({ ws: A, bundle: '', cliente, estado: eA });
  assert.equal(le(A, 'Projects/Fonte 24V/changes.js'), 'var changes=[]');
  assert.equal((await cliente.chave('nexoeletric-projeto', 'Fonte 24V')).id, antes.id);
  // projeto com mais de uma PCB (1.46.0): o grupo.json mora na pasta da PCB e vai junto para a outra máquina
  escreve(A, 'Projects/Fonte 24V/grupo.json', '{"grupo":"Painel"}');
  await armazem.rodada({ ws: A, bundle: '', cliente, estado: eA });
  await armazem.rodada({ ws: B, bundle: '', cliente, estado: eB });
  assert.equal(le(B, 'Projects/Fonte 24V/grupo.json'), '{"grupo":"Painel"}');
});

test('duas máquinas: projeto criado/editado em qualquer uma sobe, e projeto novo no NexoBD aparece na outra; o chat também', { skip: pula }, async () => {
  const A = path.join(tmp, 'maqA'), B = path.join(tmp, 'maqB');
  const eA = {}, eB = {};
  escreve(A, 'Projects/Placa A/board.js', 'var pcbmirror={"components":[]}');
  escreve(B, 'Projects/Placa B/schematic.js', 'var schematic={"items":[]}');
  escreve(A, '.chat/c1.json', '{"id":"c1"}');
  await armazem.rodada({ ws: A, bundle: '', cliente, estado: eA });
  await armazem.rodada({ ws: B, bundle: '', cliente, estado: eB });
  await armazem.rodada({ ws: A, bundle: '', cliente, estado: eA });
  // os dois projetos nas duas máquinas (todos do NexoBD, não só os "desta máquina")
  for (const ws of [A, B]) {
    assert.ok(fs.existsSync(path.join(ws, 'Projects', 'Placa A', 'board.js')), `${ws}: Placa A`);
    assert.ok(fs.existsSync(path.join(ws, 'Projects', 'Placa B', 'schematic.js')), `${ws}: Placa B`);
  }
  assert.equal(le(B, '.chat/c1.json'), '{"id":"c1"}', 'o chat de uma máquina chega na outra');
  assert.ok(await cliente.chave('nexoeletric-chat', 'conversas'));
  // B edita o projeto que A criou: sobe; A recebe
  escreve(B, 'Projects/Placa A/board.js', 'var pcbmirror={"components":[{"ref":"R1"}]}');
  await armazem.rodada({ ws: B, bundle: '', cliente, estado: eB });
  await armazem.rodada({ ws: A, bundle: '', cliente, estado: eA });
  assert.equal(le(A, 'Projects/Placa A/board.js'), 'var pcbmirror={"components":[{"ref":"R1"}]}');
  const revs = await cliente.revisoes((await cliente.chave('nexoeletric-projeto', 'Placa A')).id);
  assert.ok(revs.length >= 2, 'a edição é uma revisão nova (histórico)');
});

test('BOM: a página e a BOM de cada projeto vão para o NexoBD, que serve /bom/<id> sem token e grava os vistos', { skip: pula }, async () => {
  const A = path.join(tmp, 'bomA'), B = path.join(tmp, 'bomB'), bundle = path.join(tmp, 'bundle-bom');
  for (const f of armazem.ARQ_WEB_BOM) escreve(bundle, f, f.endsWith('.html') ? '<!doctype html><title>BOM</title><script src="/bom/_app/hub-bom.js"></script>' : `var x_${f.replace(/\W/g, '_')} = 1;`);
  for (const f of armazem.SCRIPTS) escreve(bundle, f, `conteúdo de ${f}`);
  const nome = 'DMB - DI231765_P2', slug = armazem.slugProjeto(nome);
  assert.equal(slug, 'dmb-di231765-p2');
  assert.equal(armazem.slugProjeto('MIF - DI261898 - Cartão Allen Bradley 1492 - IFM40D24'), 'mif-di261898-cart-o-allen-bradley-1492-ifm40d24');
  escreve(A, `Projects/${nome}/board.js`, 'var pcbmirror={"components":[{"ref":"R1"},{"ref":"C1"}]}');
  escreve(A, `Projects/${nome}/schematic.js`, 'var schematic={"items":[]}');
  escreve(A, `Projects/${nome}/bom-opts.json`, '{"layout":"f","dark":true}');
  escreve(A, `Projects/${nome}/bom-vistos.json`, '{"cR1":true}');
  escreve(A, 'Projects/Sem Placa/schematic.js', 'var schematic={}');
  let chamadas = 0;
  const fonte = async (n) => { if (n === nome) chamadas++; return { ok: true, board: { components: [{ ref: 'R1' }, { ref: 'C1' }], generated: 'hoje', projeto: n } }; };
  const eA = {};
  const r = await armazem.rodada({ ws: A, bundle, cliente, estado: eA, fonte, versao: '1.31.0' });
  assert.ok(r.boms.atualizados.includes(nome) && !r.boms.atualizados.includes('Sem Placa'), 'só o projeto com board.js tem BOM');
  assert.equal(chamadas, 1);
  const web = await cliente.chave('nexoeletric-web', 'bom');
  assert.deepEqual(Object.values(web.arquivos).map((a) => a.nome).sort(), [...armazem.ARQ_WEB_BOM].sort());
  assert.equal(web.atributos.versao, '1.31.0');
  const it = await cliente.chave('nexoeletric-bom', slug);
  assert.deepEqual(Object.keys(it.arquivos).sort(), ['fonte.json', 'opts.json', 'vistos.json']);
  assert.equal(it.atributos.projeto, nome);
  assert.equal((await cliente.itens()).total, 0, 'nada da BOM no catálogo');

  // rodada de novo sem mudança: nada novo; outra máquina recebe o projeto e não regera a fonte
  await armazem.rodada({ ws: A, bundle, cliente, estado: eA, fonte, versao: '1.31.0', scripts: false });
  const eB = {};
  await armazem.rodada({ ws: B, bundle: '', cliente, estado: eB, fonte, versao: '1.31.0' });
  assert.equal(chamadas, 1, 'a fonte só é refeita quando o board.js/schematic.js mudam');
  assert.equal((await cliente.chave('nexoeletric-bom', slug)).rev, it.rev);

  // o NexoBD serve a página e os dados sem token; o visto grava lá
  const base = bd.url;
  const pg = await fetch(`${base}/bom/${slug}`);
  assert.equal(pg.status, 200);
  assert.match(await pg.text(), /_app\/hub-bom\.js/);
  const src = await (await fetch(`${base}/api/bom/${slug}/source`)).json();
  assert.equal(src.board.components.length, 2);
  assert.deepEqual((await (await fetch(`${base}/api/bom/${slug}/opts`)).json()).opts, { dark: true, layout: 'f' });
  assert.deepEqual((await (await fetch(`${base}/api/bom/${slug}/vistos`)).json()).vistos, { cR1: true }, 'os vistos antigos do projeto vieram junto');
  const v = await fetch(`${base}/api/bom/${slug}/vistos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set: { cC1: true } }) });
  assert.deepEqual((await v.json()).vistos, { cC1: true, cR1: true });

  // o esquema mudou na máquina B: a fonte é refeita lá e os vistos da bancada continuam
  escreve(B, `Projects/${nome}/schematic.js`, 'var schematic={"items":[1]}');
  await armazem.rodada({ ws: B, bundle: '', cliente, estado: eB, fonte, versao: '1.31.0' });
  assert.equal(chamadas, 2);
  const depois = await cliente.chave('nexoeletric-bom', slug);
  assert.ok(depois.rev > it.rev);
  assert.deepEqual((await (await fetch(`${base}/api/bom/${slug}/vistos`)).json()).vistos, { cC1: true, cR1: true });

  // uma versão mais velha do NexoEletric não troca a página publicada por uma mais nova
  const velha = await armazem.publicarWebBom({ cliente, bundle, versao: '1.30.9', estado: {} });
  assert.match(velha.pulado, /1\.31\.0/);

  // hub fora (sem fonte): fica pendente e tenta de novo na próxima
  escreve(A, 'Projects/Outra/board.js', 'var pcbmirror={"components":[]}');
  const r2 = await armazem.rodada({ ws: A, bundle: '', cliente, estado: eA, fonte: async () => null, scripts: false });
  assert.deepEqual(r2.boms.pendentes, ['Outra']);
  const r3 = await armazem.rodada({ ws: A, bundle: '', cliente, estado: eA, fonte, scripts: false });
  assert.deepEqual(r3.boms.atualizados, ['Outra']);
});
