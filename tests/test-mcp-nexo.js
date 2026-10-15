// MCP, grupo "nexo" (mcp/ferramentas/nexocad.js): o Nexo Hub de mentira (tests/nexohub-falso.js, pelo
// NEXOHUB_URL) e o NexoCAD um servidor de mentira (NEXOCAD_SESSION) que grava os comandos. O exe
// instalado nunca e aberto (NEXOCAD_NAO_ABRIR) e o hub e procurado numa porta sem ninguem.
//   - nexo_estado / nexo_biblioteca leem do Nexo Hub;
//   - nexo_editar_modelo: item que veste o footprint -> biblioteca_abrir {id}; chave ja publicada ->
//     biblioteca_editar_modelo {id, chave, geometria}; footprint sem STEP + novo -> {novo, geometria};
//   - nexo_enviar_placa: publica o item placa do _DemoKit (so leitura do projeto) -> pcb_importar {item};
//   - nexo_sincronizar: so as placas (a biblioteca do repo nao tem 3D);
//   - nexo_vincular_footprint: atributos.footprints + vinculo, direto no Nexo Hub.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const R = path.join(__dirname, '..');
const F = require('./nexohub-falso.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-nexo-'));
process.env.NEXOCAD_SESSION = path.join(TMP, 'session.json');
process.env.NEXOCAD_NAO_ABRIR = '1';
process.env.NEXOHUB_CONEXAO = path.join(TMP, 'nao-existe.json');
const STEP = 'ISO-10303-21;\nEND-ISO-10303-21;\n';

const recebidos = [];
const nx = http.createServer((q, r) => {
  let b = ''; q.on('data', d => { b += d; });
  q.on('end', () => {
    r.setHeader('Content-Type', 'application/json');
    if (q.headers.authorization !== 'Bearer tk') { r.statusCode = 401; r.end('{"ok":false}'); return; }
    if (q.method === 'GET') { r.end(JSON.stringify({ ok:true, version:'teste' })); return; }
    const j = JSON.parse(b); recebidos.push(j);
    r.end(JSON.stringify({ ok:true, result:{ id:'el-novo', criado:true, nome:'x', aberto:true } }));
  });
});

(async () => {
  const nh = await F.inicia({ porta:Number(process.env.TESTE_PORTA_NH || 8323) });
  process.env.NEXOHUB_URL = nh.url;
  await new Promise(ok => nx.listen(0, '127.0.0.1', ok));
  const NH = require(path.join(R, 'mcp', 'lib', 'nexohub.js'));
  const c0 = NH.cliente();
  /* o que o NexoCAD ja gravou: um componente que veste o R0805, um modelo da chave 3d-hub/abc.step, um mecanico */
  const b = await c0.sobeBlob(Buffer.from(STEP), 'm.step');
  const el = await c0.criaItem({ tipo:'componente', categoria:'eletronicos', nome:'R0805 casa', atributos:{ footprints:['R0805'] } });
  await c0.novaRevisao(el.id, { arquivos:{ step:b.sha256 }, base:0 });
  const mo = await c0.criaItem({ tipo:'modelo3d', categoria:'eletronicos/modelos-3d', nome:'abc', chaves:[{ sistema:'nexoeletric-modelo', chave:'3d-hub/abc.step' }] });
  await c0.novaRevisao(mo.id, { arquivos:{ step:b.sha256, origem:b.sha256 }, base:0 });
  const me = await c0.criaItem({ tipo:'peca', categoria:'mecanicos', nome:'Espaçador' });

  const { Contexto } = require(path.join(R, 'mcp', 'lib', 'contexto.js'));
  const { Registro } = require(path.join(R, 'mcp', 'lib', 'registro.js'));
  const ctx = new Contexto({ root:R, hubUrl:'http://127.0.0.1:8309' });
  const reg = new Registro().carregar();
  assert.deepStrictEqual(reg.erros, []);
  const chama = (n, a) => reg.get(n).executa(a || {}, ctx);

  let r = await chama('nexo_estado');
  assert.strictEqual(r.nexohub.online, true); assert.strictEqual(r.nexohub.itens, 3); assert.strictEqual(r.nexocad.aberto, false); assert.strictEqual(r.hub, null);
  await assert.rejects(chama('nexo_editar_modelo', { id:el.id }), /executável não foi encontrado/, 'sem NexoCAD e sem exe: erro claro');

  fs.writeFileSync(process.env.NEXOCAD_SESSION, JSON.stringify({ port:nx.address().port, token:'tk', pid:1 }));
  r = await chama('nexo_estado');
  assert.strictEqual(r.nexocad.aberto, true); assert.strictEqual(r.nexocad.versao, 'teste');

  r = await chama('nexo_biblioteca');
  assert.deepStrictEqual(r.itens.map(i => i.id).sort(), [el.id, mo.id].sort(), 'padrao: Eletronicos (com os Modelos 3D)');
  assert.ok(r.itens.find(i => i.id === el.id).step.endsWith('/arquivo/step'));
  assert.deepStrictEqual(r.itens.find(i => i.id === mo.id).substitui, [], 'rev 1 nao substitui');
  r = await chama('nexo_biblioteca', { categoria:'*', texto:'espacador' });
  assert.deepStrictEqual(r.itens.map(i => i.id), [me.id], 'busca sem acento, todas as categorias');
  r = await chama('nexo_biblioteca', { id:mo.id });
  assert.deepStrictEqual(r.item.chaves, ['3d-hub/abc.step']); assert.strictEqual(r.revisoes.length, 1);

  await chama('nexo_editar_modelo', { chave:'3d-hub/abc.step' });
  let c = recebidos.pop();
  assert.strictEqual(c.command, 'biblioteca_editar_modelo'); assert.strictEqual(c.params.id, mo.id, 'a chave ja e um item: o NexoCAD abre ele');
  assert.strictEqual(c.params.chave, '3d-hub/abc.step');
  await chama('nexo_editar_modelo', { footprint:'R0805_NAO_EXISTE', novo:true });
  c = recebidos.pop();
  assert.strictEqual(c.command, 'biblioteca_editar_modelo'); assert.strictEqual(c.params.novo, true); assert.strictEqual(c.source, 'eletrichub');
  await chama('nexo_editar_modelo', { projeto:'_DemoKit', ref:'R1' });
  c = recebidos.pop();
  assert.ok(c.command === 'biblioteca_abrir' && c.params.id === el.id, 'R1 (R0805) veste o item componente: abre ele');
  await assert.rejects(chama('nexo_editar_modelo', { projeto:'_DemoKit', ref:'C1' }), /novo:true/, 'sem STEP e sem novo: diz o que fazer');
  await chama('nexo_editar_modelo', { projeto:'_DemoKit', ref:'C1', novo:true });
  c = recebidos.pop();
  assert.strictEqual(c.params.footprint, 'C0805');
  assert.ok(c.params.geometria && c.params.geometria.pads.length === 2, 'geometria dos pads, local ao footprint');
  assert.ok(Math.abs(Math.abs(c.params.geometria.pads[0].x) - Math.abs(c.params.geometria.pads[1].x)) < 1e-6, 'pads simetricos em torno da origem do footprint');

  r = await chama('nexo_enviar_placa', { projeto:'_DemoKit', so_pacote:true });
  assert.strictEqual(r.pacote.format, 'eletrichub-placa-v1'); assert.strictEqual(r.pacote.componentes.length, 4);
  const antes = fs.readFileSync(path.join(R, 'Projects', '_DemoKit', 'changes.js'), 'utf8');
  r = await chama('nexo_enviar_placa', { projeto:'_DemoKit' });
  c = recebidos.pop();
  assert.strictEqual(c.command, 'pcb_importar'); assert.strictEqual(c.params.item, r.item);
  assert.strictEqual(r.rev, 1); assert.strictEqual(r.mudou, true);
  const placa = nh.estado.itens.get(r.item);
  assert.strictEqual(placa.tipo, 'placa');
  const pac = JSON.parse(nh.estado.blobs.get(placa.revisoes[0].arquivos.placa.sha).dados.toString('utf8'));
  assert.strictEqual(pac.projeto, '_DemoKit');
  assert.deepStrictEqual(pac.modelos['nexo:' + el.id], { item:el.id, rev:1, nome:'R0805 casa' }, JSON.stringify(pac.modelos));
  r = await chama('nexo_enviar_placa', { projeto:'_DemoKit', so_publicar:true });
  assert.strictEqual(r.mudou, false, 'o mesmo pacote: sem revisao nova');
  assert.strictEqual(recebidos.length, 0, 'so_publicar nao chama o NexoCAD');
  r = await chama('nexo_sincronizar', { modelos:false, placas:['_DemoKit'] });
  assert.strictEqual(r.resumo.placas.iguais, 1);
  assert.strictEqual(fs.readFileSync(path.join(R, 'Projects', '_DemoKit', 'changes.js'), 'utf8'), antes, 'o projeto so foi lido');

  r = await chama('nexo_vincular_footprint', { item:el.id, footprint:'R1206' });
  assert.deepStrictEqual(r.footprints, ['R0805', 'R1206']);
  assert.deepStrictEqual(nh.estado.itens.get(el.id).atributos.footprints, ['R0805', 'R1206']);
  assert.ok(nh.estado.vinculos.some(v => v.de_item === el.id && v.para_ref === 'R1206'));
  r = await chama('nexo_vincular_footprint', { item:el.id, footprint:'R1206', remover:true });
  assert.deepStrictEqual(nh.estado.itens.get(el.id).atributos.footprints, ['R0805']);
  assert.ok(!nh.estado.vinculos.some(v => v.de_item === el.id && v.para_ref === 'R1206'));

  await nh.fecha();
  await assert.rejects(chama('nexo_biblioteca'), /não respondeu/, 'Nexo Hub fora: erro claro');
  nx.close();
  fs.rmSync(TMP, { recursive:true, force:true });
  console.log('test-mcp-nexo: ok');
})().catch(e => { nx.close(); fs.rmSync(TMP, { recursive:true, force:true }); console.error(e); process.exit(1); });
