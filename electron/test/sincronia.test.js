'use strict';
// lib/sincronia.js + lib/armazem.js (1.85.0): a revisao de fora de um projeto ABERTO nesta maquina nao entra calada.
// Contra o NexoBD DE VERDADE (..\..\NexoBD, ou NEXOBD_REPO), duas "maquinas" (duas pastas de trabalho, PC-A e PC-B):
// A grava, B esta com o projeto aberto e so recebe quando pede; projeto fechado sincroniza sozinho; a mudanca feita na
// propria maquina nao avisa. Sem o repositorio do NexoBD na maquina, os testes pulam.
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
const sincronia = require('../lib/sincronia');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sincronia-'));
const escreve = (dir, rel, txt) => { const a = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, txt); };
const le = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8');
/* a pagina dizendo que o projeto esta aberto (o que o tools/rotas/sincronia.py grava; quando em segundos) */
const abre = (ws, ...projetos) => escreve(ws, '.altiumhub/nexobd-abertos.json', JSON.stringify({ j1: { projetos, quando: Date.now() / 1000 } }));
const fecha = (ws) => escreve(ws, '.altiumhub/nexobd-abertos.json', '{}');

let bd, cliente;
test.before(async () => {
  if (pula) return;
  const { iniciarServidor } = await import(pathToFileURL(path.join(REPO_BD, 'server', 'servidor.mjs')).href);
  bd = await iniciarServidor({ dados: path.join(tmp, 'bd'), porta: 0, host: '127.0.0.1', ponteiro: false, backupDiario: false, keepAliveMs: 300 });
  const { criarCliente } = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'nexohub-cliente.mjs')).href);
  cliente = criarCliente({ url: bd.url, app: 'nexoeletric' });
});
test.after(async () => { await bd?.fechar(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('a nota da revisão leva a máquina', () => {
  assert.equal(sincronia.notaComMaquina('NexoEletric', 'PC-A'), 'NexoEletric @PC-A');
  assert.equal(sincronia.maquinaDaNota('NexoEletric @PC-OFICINA'), 'PC-OFICINA');
  assert.equal(sincronia.maquinaDaNota('NexoEletric'), '');
  assert.equal(sincronia.notaComMaquina('NexoEletric @PC-B', 'PC-A'), 'NexoEletric @PC-B', 'quem já pôs a máquina fica');
});

test('abertos: só o que a página avisou há pouco', () => {
  const ws = path.join(tmp, 'ab');
  escreve(ws, '.altiumhub/nexobd-abertos.json', JSON.stringify({ j1: { projetos: ['P1'], quando: Date.now() / 1000 }, j2: { projetos: ['P2'], quando: Date.now() / 1000 - 600 } }));
  assert.deepEqual([...sincronia.abertos(ws)], ['P1']);
});

test('projeto aberto: a revisão de fora fica segurada, o aviso diz quem/onde/o que, e o "Sincronizar" aplica', { skip: pula }, async () => {
  const A = path.join(tmp, 'A'), B = path.join(tmp, 'B');
  const cliA = armazem.comAutor(cliente, 'paula');
  escreve(A, 'Projects/P1/schematic.js', 'var schematic={v:1}');
  escreve(A, 'Projects/P2/schematic.js', 'var schematic={p2:1}');
  const eA = {}, eB = {};
  await armazem.rodada({ ws: A, bundle: '', cliente: cliA, estado: eA, maquina: 'PC-A' });
  await armazem.rodada({ ws: B, bundle: '', cliente, estado: eB, maquina: 'PC-B', segurar: { abertos: sincronia.abertos(B), liberar: new Set() } });
  assert.equal(le(B, 'Projects/P1/schematic.js'), 'var schematic={v:1}', 'B recebeu a primeira versão');

  // B abre o P1; A muda o P1 e o P2 (com o histórico com autor da 1.84.0)
  abre(B, 'P1');
  escreve(A, 'Projects/P1/schematic.js', 'var schematic={v:2}');
  escreve(A, 'Projects/P1/Historico/u-paula.jsonl', JSON.stringify({ id: 'e1', quando: '2026-11-09T10:00:00', ate: '2026-11-09T10:02:00',
    usuario: { id: 'u-paula', login: 'paula', nome: 'Paula Prado' }, origem: 'app', arquivo: 'schematic.js', tipo: 'esquema', mudancas: ['R5: valor 10k → 22k'], gravacoes: 2 }) + '\n');
  escreve(A, 'Projects/P2/schematic.js', 'var schematic={p2:2}');
  await armazem.rodada({ ws: A, bundle: '', cliente: cliA, estado: eA, maquina: 'PC-A' });
  const revs = (await cliente.revisoes(eA.projetos.projetos.P1.item)).sort((a, b) => a.numero - b.numero);
  assert.equal(sincronia.maquinaDaNota(revs[revs.length - 1].nota), 'PC-A', 'a revisão leva a máquina');
  assert.equal(revs[revs.length - 1].autor, 'paula', 'e o autor');

  // B: a rodada segura o P1 (aberto) e aplica o P2 (fechado)
  const r = await armazem.rodada({ ws: B, bundle: '', cliente, estado: eB, maquina: 'PC-B', segurar: { abertos: sincronia.abertos(B), liberar: new Set() } });
  assert.equal(le(B, 'Projects/P1/schematic.js'), 'var schematic={v:1}', 'não aplica calado no projeto aberto');
  assert.equal(fs.existsSync(path.join(B, 'Projects/P1/Historico/u-paula.jsonl')), false);
  assert.equal(le(B, 'Projects/P2/schematic.js'), 'var schematic={p2:2}', 'projeto fechado sincroniza sozinho');
  const av = r.avisos.P1;
  assert.ok(av, 'aviso do P1');
  assert.deepEqual([av.autor, av.maquina, av.arquivos], ['paula', 'PC-A', ['schematic.js']]);
  assert.deepEqual(av.entradas.map((e) => e.mudancas[0]), ['R5: valor 10k → 22k'], 'o que mudou: as linhas do histórico que vieram');
  assert.deepEqual(av.conflitos, []);
  assert.equal(r.avisos.P2, undefined);

  // B salva algo no P1 enquanto segurado: não sobe (subiria em cima da revisão velha), e o aviso conta
  escreve(B, 'Projects/P1/annotations.js', 'var annotations=[1]');
  const r2 = await armazem.rodada({ ws: B, bundle: '', cliente, estado: eB, maquina: 'PC-B', segurar: { abertos: sincronia.abertos(B), liberar: new Set() } });
  assert.deepEqual(r2.avisos.P1.locais, ['annotations.js']);
  assert.equal((await cliente.chave('nexoeletric-projeto', 'P1')).rev, revs[revs.length - 1].numero, 'nada subiu do segurado');

  // "Sincronizar e atualizar": libera o P1 numa rodada; o daqui (annotations) sobe junto, o de lá desce
  const r3 = await armazem.rodada({ ws: B, bundle: '', cliente, estado: eB, maquina: 'PC-B', segurar: { abertos: sincronia.abertos(B), liberar: new Set(['P1']) } });
  assert.equal(r3.avisos.P1, undefined, 'o selo some');
  assert.equal(le(B, 'Projects/P1/schematic.js'), 'var schematic={v:2}');
  assert.ok(fs.existsSync(path.join(B, 'Projects/P1/Historico/u-paula.jsonl')));
  const it = await cliente.chave('nexoeletric-projeto', 'P1');
  assert.ok(Object.values(it.arquivos).some((a) => a.nome === 'annotations.js'), 'o que B salvou subiu');

  // A muda de novo e B FECHA o projeto: a próxima rodada aplica sozinha
  escreve(A, 'Projects/P1/schematic.js', 'var schematic={v:3}');
  await armazem.rodada({ ws: A, bundle: '', cliente: cliA, estado: eA, maquina: 'PC-A' });
  fecha(B);
  const r4 = await armazem.rodada({ ws: B, bundle: '', cliente, estado: eB, maquina: 'PC-B', segurar: { abertos: sincronia.abertos(B), liberar: new Set() } });
  assert.equal(r4.avisos.P1, undefined);
  assert.equal(le(B, 'Projects/P1/schematic.js'), 'var schematic={v:3}');
});

test('mudança feita nesta mesma máquina não avisa; conflito dos dois lados aparece no aviso', { skip: pula }, async () => {
  const A = path.join(tmp, 'mA'), B = path.join(tmp, 'mB');
  escreve(A, 'Projects/Q/schematic.js', 'var schematic={q:1}');
  const eA = {}, eB = {};
  await armazem.rodada({ ws: A, bundle: '', cliente, estado: eA, maquina: 'PC-X' });
  await armazem.rodada({ ws: B, bundle: '', cliente, estado: eB, maquina: 'PC-X' });
  abre(B, 'Q');
  escreve(A, 'Projects/Q/schematic.js', 'var schematic={q:2}');
  await armazem.rodada({ ws: A, bundle: '', cliente, estado: eA, maquina: 'PC-X' });
  const r = await armazem.rodada({ ws: B, bundle: '', cliente, estado: eB, maquina: 'PC-X', segurar: { abertos: sincronia.abertos(B), liberar: new Set() } });
  assert.equal(r.avisos.Q, undefined, 'a revisão é desta máquina (outra janela/pasta): entra');
  assert.equal(le(B, 'Projects/Q/schematic.js'), 'var schematic={q:2}');

  // agora de outra máquina, e B mexeu no mesmo arquivo: conflito
  escreve(A, 'Projects/Q/schematic.js', 'var schematic={q:3}');
  await armazem.rodada({ ws: A, bundle: '', cliente, estado: eA, maquina: 'PC-Y' });
  escreve(B, 'Projects/Q/schematic.js', 'var schematic={q:"meu"}');
  const r2 = await armazem.rodada({ ws: B, bundle: '', cliente, estado: eB, maquina: 'PC-X', segurar: { abertos: sincronia.abertos(B), liberar: new Set() } });
  assert.deepEqual([r2.avisos.Q.maquina, r2.avisos.Q.conflitos, r2.avisos.Q.locais], ['PC-Y', ['schematic.js'], ['schematic.js']]);
  // sincronizar: vale o daqui, o de lá vai para os conflitos (a regra de sempre do espelho)
  const r3 = await armazem.rodada({ ws: B, bundle: '', cliente, estado: eB, maquina: 'PC-X', segurar: { abertos: sincronia.abertos(B), liberar: new Set(['Q']) } });
  assert.equal(le(B, 'Projects/Q/schematic.js'), 'var schematic={q:"meu"}');
  assert.equal(r3.projetos.projetos.Q.conflitos.length, 1);
});

test('o pedido da página e o arquivo de avisos', () => {
  const ws = path.join(tmp, 'ped');
  escreve(ws, '.altiumhub/nexobd-sincronizar.json', JSON.stringify({ pedidos: [{ projeto: 'P1', id: 'abc' }] }));
  assert.deepEqual(sincronia.lerPedidos(ws).map((p) => [p.projeto, p.id]), [['P1', 'abc']]);
  assert.equal(fs.existsSync(sincronia.ARQ_PEDIDO(ws)), false, 'o pedido sai ao ser lido');
  const d = sincronia.gravarAvisos(ws, { avisos: { P1: { rev: 3 } }, sincronizados: { P2: { id: 'x', quando: 1 } } });
  assert.deepEqual([d.ligado, Object.keys(d.avisos), d.sincronizados.P2.id], [true, ['P1'], 'x']);
});
