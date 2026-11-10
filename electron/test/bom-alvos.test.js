'use strict';
// 1.89.4: o link da BOM pela placa e por variante (lib/bom-alvos.js, a mesma regra do hubserver.py » bom_alvos, com os
// mesmos casos de tests/bom-alvos-casos.json), e o armazem publicando uma BOM por variante no NexoBD DE VERDADE
// (..\..\NexoBD, ou NEXOBD_REPO), com o slug antigo da pasta ainda abrindo a padrao. Sem o NexoBD ao lado, a parte do
// NexoBD pula.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const BA = require('../lib/bom-alvos');
const armazem = require('../lib/armazem');

const REPO_BD = [process.env.NEXOBD_REPO, path.join(__dirname, '..', '..', '..', 'NexoBD')].filter(Boolean)
  .find((d) => fs.existsSync(path.join(d, 'server', 'servidor.mjs')));
const pula = REPO_BD ? false : 'sem o repositório do NexoBD ao lado (NEXOBD_REPO)';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bom-alvos-'));
const escreve = (dir, rel, txt) => { const a = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, txt); };

let bd, cliente;
test.before(async () => {
  if (pula) return;
  const { iniciarServidor } = await import(pathToFileURL(path.join(REPO_BD, 'server', 'servidor.mjs')).href);
  bd = await iniciarServidor({ dados: path.join(tmp, 'bd'), porta: 0, host: '127.0.0.1', ponteiro: false, backupDiario: false, keepAliveMs: 300 });
  const { criarCliente } = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'nexohub-cliente.mjs')).href);
  cliente = criarCliente({ url: bd.url, app: 'nexoeletric' });
});
test.after(async () => { await bd?.fechar(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('a regra do link: a mesma do hubserver.py (tests/bom-alvos-casos.json)', () => {
  const { casos } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tests', 'bom-alvos-casos.json'), 'utf8'));
  for (const c of casos) assert.deepStrictEqual(BA.alvos(c.pasta, c.params, c.variantes), c.esperado, c.pasta);
  assert.strictEqual(BA.slugPasta('DMB - DI231765_P2'), armazem.slugProjeto('DMB - DI231765_P2'));
});

const esquema = (codigo, nome) => 'var schematic = ' + JSON.stringify({ format: 'schmirror-v2', params: `CodigoDaPlaca=${codigo};NomeDaPlaca=${nome};CodigoDoEquipamento=DMB-DI231765`, items: [] }) + ';\n';

test('do arquivo: o cabeçalho do schematic.js e o variantes.json da pasta', () => {
  const p = path.join(tmp, 'ws0', 'Projects', 'DMB - DI231765_P2');
  escreve(p, 'schematic.js', esquema('PMD-DI261946', 'PLACA MAE DMB'));
  escreve(p, 'variantes.json', '﻿' + JSON.stringify({ variantes: [{ id: 'v1a2b3c4', nome: ' Sem  display ', codigo: 'dmbsd-di261950' }, { id: 'ruim', nome: 'x', codigo: 'Y' }] }));
  const a = BA.alvosDaPasta(p, 'DMB - DI231765_P2');
  assert.deepStrictEqual(a.map((x) => [x.id, x.nome]), [['pmd-di261946', 'PMD-DI261946 · PLACA MAE DMB'], ['pmd-di261946-sem-display', 'PMD-DI261946 SEM DISPLAY']]);
  assert.deepStrictEqual(a[0].apelidos, ['dmb-di231765-p2']);
});

test('o armazem: uma BOM por variante no NexoBD, o link antigo abre a padrão, a placa nova leva o link junto', { skip: pula }, async () => {
  const ws = path.join(tmp, 'ws1'), nome = 'DMB - DI231765_P2', antigo = armazem.slugProjeto(nome);
  escreve(ws, `Projects/${nome}/board.js`, 'var pcbmirror={"components":[{"ref":"R1"},{"ref":"U3"}]}');
  escreve(ws, `Projects/${nome}/schematic.js`, 'var schematic={"items":[]}');
  escreve(ws, `Projects/${nome}/bom-vistos.json`, '{"cR1":true}');
  const pedidos = [];
  const fonte = async (n, slug, variante) => {
    pedidos.push([n, slug, variante]);
    return { ok: true, board: { components: variante ? [{ ref: 'R1' }] : [{ ref: 'R1' }, { ref: 'U3' }] } };
  };
  const est = {};
  // como a 1.89.3 deixou: a BOM pela pasta, sem placa definida
  await armazem.rodada({ ws, bundle: '', cliente, estado: est, fonte, versao: '1.89.4' });
  const velho = await cliente.chave('nexoeletric-bom', antigo);
  assert.ok(velho, 'sem placa, o link é o da pasta (o de sempre)');
  const base = bd.url;
  const fonteDe = async (id) => (await fetch(`${base}/api/bom/${id}/source`)).json();
  assert.strictEqual((await fonteDe(antigo)).projeto, nome);

  // o Definir projeto escolhe a placa e cria-se uma variante: a padrão ganha o link da placa (o MESMO item: os vistos
  // ficam) e a variante, o seu
  escreve(ws, `Projects/${nome}/schematic.js`, esquema('PMD-DI261946', 'PLACA MAE DMB'));
  escreve(ws, `Projects/${nome}/variantes.json`, JSON.stringify({ variantes: [{ id: 'v1a2b3c4', nome: 'Sem display', codigo: 'DMBSD-DI261950', suprimidos: [{ ref: 'U3' }] }] }));
  pedidos.length = 0;
  const r = await armazem.rodada({ ws, bundle: '', cliente, estado: est, fonte, versao: '1.89.4', scripts: false });
  assert.deepStrictEqual(r.boms.erros, []);
  assert.deepStrictEqual(pedidos.map((p) => p[2]).sort(), ['', 'v1a2b3c4'], 'a fonte é pedida por variante');
  const pad = await cliente.chave('nexoeletric-bom', 'pmd-di261946');
  assert.strictEqual(pad.id, velho.id, 'a padrão continua o mesmo item (histórico e vistos)');
  assert.strictEqual((await cliente.chave('nexoeletric-bom', antigo)).id, velho.id, 'o link antigo abre a padrão');
  const sp = await fonteDe('pmd-di261946');
  assert.strictEqual(sp.projeto, 'PMD-DI261946 · PLACA MAE DMB', 'o nome atual da placa no título');
  assert.strictEqual((await fonteDe(antigo)).projeto, 'PMD-DI261946 · PLACA MAE DMB', 'o link antigo mostra o nome atual');
  assert.deepStrictEqual((await (await fetch(`${base}/api/bom/pmd-di261946/vistos`)).json()).vistos, { cR1: true });
  const va = await cliente.chave('nexoeletric-bom', 'pmd-di261946-sem-display');
  assert.ok(va && va.id !== pad.id, 'a variante tem a BOM dela');
  assert.strictEqual(va.atributos.variante, 'v1a2b3c4');
  const sv = await fonteDe('pmd-di261946-sem-display');
  assert.strictEqual(sv.projeto, 'PMD-DI261946 SEM DISPLAY');
  assert.deepStrictEqual(sv.board.components.map((c) => c.ref), ['R1'], 'sem o suprimido');
  assert.strictEqual((await fetch(`${base}/bom/pmd-di261946-sem-display`)).status, 503, 'a página existe (503 = sem o app web, que este teste não sobe)');

  // de novo, sem mudança: nada
  pedidos.length = 0;
  const r2 = await armazem.rodada({ ws, bundle: '', cliente, estado: est, fonte, versao: '1.89.4', scripts: false });
  assert.deepStrictEqual([pedidos.length, r2.boms.atualizados], [0, []]);

  // a placa trocou de código (Definir projeto de novo): link novo; os dois anteriores continuam abrindo a mesma BOM
  escreve(ws, `Projects/${nome}/schematic.js`, esquema('PMD-DI261999', 'PLACA MAE DMB REV B'));
  await armazem.rodada({ ws, bundle: '', cliente, estado: est, fonte, versao: '1.89.4', scripts: false });
  for (const id of ['pmd-di261999', 'pmd-di261946', antigo]) assert.strictEqual((await cliente.chave('nexoeletric-bom', id)).id, velho.id, id);
  assert.strictEqual((await fonteDe(antigo)).projeto, 'PMD-DI261999 · PLACA MAE DMB REV B');
  assert.strictEqual((await cliente.chave('nexoeletric-bom', 'pmd-di261999-sem-display')).id, va.id, 'a variante leva o link junto');

  // outra pasta com o MESMO código de placa não toma o link de quem já o tem
  escreve(ws, 'Projects/Copia/board.js', 'var pcbmirror={"components":[]}');
  escreve(ws, 'Projects/Copia/schematic.js', esquema('PMD-DI261999', 'COPIA'));
  const r3 = await armazem.rodada({ ws, bundle: '', cliente, estado: est, fonte, versao: '1.89.4', scripts: false });
  assert.strictEqual((await cliente.chave('nexoeletric-bom', 'pmd-di261999')).id, velho.id);
  assert.ok(r3.boms.erros.some((e) => e.nome === 'Copia' && /já é do projeto/.test(e.erro)), JSON.stringify(r3.boms.erros));

  // a variante apagada: a BOM dela sai
  escreve(ws, `Projects/${nome}/variantes.json`, JSON.stringify({ variantes: [] }));
  await armazem.rodada({ ws, bundle: '', cliente, estado: est, fonte, versao: '1.89.4', scripts: false });
  assert.strictEqual(await cliente.chave('nexoeletric-bom', 'pmd-di261999-sem-display').catch(() => null), null);
});
