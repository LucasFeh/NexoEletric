// MCP, grupo "nexo" (mcp/ferramentas/nexocad.js), sem o hub no ar: a biblioteca numa pasta temporaria
// (DIELETRONS_BIBLIOTECA) e o NexoCAD um servidor de mentira (NEXOCAD_SESSION) que grava os comandos.
// O exe instalado nunca e aberto (NEXOCAD_NAO_ABRIR) e o hub e procurado numa porta sem ninguem.
//   - nexo_estado / nexo_biblioteca leem do disco;
//   - nexo_editar_modelo: chave que um item substitui -> biblioteca_abrir; footprint sem STEP + novo
//     -> biblioteca_editar_modelo {novo, geometria};
//   - nexo_enviar_placa: o pacote do _DemoKit (so leitura do projeto) -> pcb_importar com o placa.json;
//   - nexo_vincular_footprint -> biblioteca_editar_item (o hub nao grava a biblioteca).
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const R = path.join(__dirname, '..');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-nexo-'));
const BIB = path.join(TMP, 'Biblioteca');
fs.mkdirSync(path.join(BIB, 'itens', 'el-a'), { recursive: true });
fs.writeFileSync(path.join(BIB, 'itens', 'el-a', 'modelo.step'), 'ISO-10303-21;\nEND-ISO-10303-21;\n');
fs.writeFileSync(path.join(BIB, 'biblioteca.json'), JSON.stringify({ format:'dieletrons-biblioteca', version:1, revisao:3, categorias:['Eletrônicos', 'Mecânicos'], itens:[
  { id:'el-a', nome:'R0805 casa', categoria:'Eletrônicos', rev:1, arquivos:{ step:'itens/el-a/modelo.step' }, substitui:['3d-hub/abc.step'], eletronico:{ footprints:['R0805'] } },
  { id:'mec-b', nome:'Espaçador', categoria:'Mecânicos', rev:1, arquivos:{} }] }));
process.env.DIELETRONS_BIBLIOTECA = BIB;
process.env.NEXOCAD_SESSION = path.join(TMP, 'session.json');
process.env.NEXOCAD_NAO_ABRIR = '1';

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
  await new Promise(ok => nx.listen(0, '127.0.0.1', ok));
  const { Contexto } = require(path.join(R, 'mcp', 'lib', 'contexto.js'));
  const { Registro } = require(path.join(R, 'mcp', 'lib', 'registro.js'));
  const ctx = new Contexto({ root:R, hubUrl:'http://127.0.0.1:8309' });
  const reg = new Registro().carregar();
  assert.deepStrictEqual(reg.erros, []);
  const chama = (n, a) => reg.get(n).executa(a || {}, ctx);

  let r = await chama('nexo_estado');
  assert.strictEqual(r.revisao, 3); assert.strictEqual(r.itens, 2); assert.strictEqual(r.nexocad.aberto, false); assert.strictEqual(r.hub, null);
  await assert.rejects(chama('nexo_editar_modelo', { id:'el-a' }), /executável não foi encontrado/, 'sem NexoCAD e sem exe: erro claro');

  fs.writeFileSync(process.env.NEXOCAD_SESSION, JSON.stringify({ port:nx.address().port, token:'tk', pid:1 }));
  r = await chama('nexo_estado');
  assert.strictEqual(r.nexocad.aberto, true); assert.strictEqual(r.nexocad.versao, 'teste');

  r = await chama('nexo_biblioteca');
  assert.deepStrictEqual(r.itens.map(i => i.id), ['el-a'], 'padrao: Eletronicos');
  assert.ok(r.itens[0].step.endsWith('modelo.step'));
  r = await chama('nexo_biblioteca', { categoria:'*', texto:'espacador' });
  assert.deepStrictEqual(r.itens.map(i => i.id), ['mec-b'], 'busca sem acento, todas as categorias');

  r = await chama('nexo_editar_modelo', { chave:'3d-hub/abc.step' });
  assert.strictEqual(recebidos.pop().command, 'biblioteca_abrir', 'chave substituida: abre o item');
  r = await chama('nexo_editar_modelo', { footprint:'R0805_NAO_EXISTE', novo:true });
  let c = recebidos.pop();
  assert.strictEqual(c.command, 'biblioteca_editar_modelo'); assert.strictEqual(c.params.novo, true); assert.strictEqual(c.source, 'eletrichub');
  r = await chama('nexo_editar_modelo', { projeto:'_DemoKit', ref:'R1' });
  c = recebidos.pop();
  assert.ok(c.command === 'biblioteca_abrir' && c.params.id === 'el-a', 'R1 (R0805) veste o item vinculado ao footprint: abre ele');
  await assert.rejects(chama('nexo_editar_modelo', { projeto:'_DemoKit', ref:'C1' }), /novo:true/, 'sem STEP e sem novo: diz o que fazer');
  r = await chama('nexo_editar_modelo', { projeto:'_DemoKit', ref:'C1', novo:true });
  c = recebidos.pop();
  assert.strictEqual(c.params.footprint, 'C0805');
  assert.ok(c.params.geometria && c.params.geometria.pads.length === 2, 'geometria dos pads, local ao footprint');
  assert.ok(Math.abs(Math.abs(c.params.geometria.pads[0].x) - Math.abs(c.params.geometria.pads[1].x)) < 1e-6, 'pads simetricos em torno da origem do footprint');

  r = await chama('nexo_enviar_placa', { projeto:'_DemoKit', so_pacote:true });
  assert.strictEqual(r.pacote.format, 'eletrichub-placa-v1'); assert.strictEqual(r.pacote.componentes.length, 4);
  r = await chama('nexo_enviar_placa', { projeto:'_DemoKit' });
  c = recebidos.pop();
  assert.strictEqual(c.command, 'pcb_importar');
  const pj = JSON.parse(fs.readFileSync(c.params.path, 'utf8'));
  assert.strictEqual(pj.projeto, '_DemoKit');
  fs.rmSync(path.dirname(c.params.path), { recursive:true, force:true });

  r = await chama('nexo_vincular_footprint', { item:'el-a', footprint:'R1206' });
  c = recebidos.pop();
  assert.strictEqual(c.command, 'biblioteca_editar_item');
  assert.deepStrictEqual(c.params.eletronico.footprints, ['R0805', 'R1206']);
  await assert.rejects(chama('nexo_vincular_footprint', { item:'mec-b', footprint:'X' }), /só item Eletrônicos/);

  nx.close();
  fs.rmSync(TMP, { recursive:true, force:true });
  console.log('test-mcp-nexo: ok');
})().catch(e => { nx.close(); fs.rmSync(TMP, { recursive:true, force:true }); console.error(e); process.exit(1); });
