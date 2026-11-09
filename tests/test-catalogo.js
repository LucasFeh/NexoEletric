/* O catálogo de produtos da casa (mcp/lib/catalogo.js): o código da placa nova, a linha no .xlsx e o projeto novo
   pelo MCP (catalogo_previa, projeto_criar {produto}).
     node tests/test-catalogo.js
   Contra um catálogo FALSO montado aqui (o .xlsx no formato do de verdade: título, cabeçalho, produtos e as linhas de
   sobra com só o ITEM repetido), numa pasta temporária. O catálogo de verdade (no NAS) nunca é tocado. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'test-catalogo-'));
const ARQ = path.join(TMP, 'CATALOGAÇÃO TODOS OS PRODUTOS .xlsx');
process.env.NEXO_CATALOGO = ARQ;
const C = require('../mcp/lib/catalogo.js');

/* ---- o catálogo falso ---- */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const strings = ['TABELA DE PRODUTOS DI-ELÉTRONS', 'ITEM ', 'TIPO', 'NOME', 'CLIENTE ', 'MODELO', 'VÍNCULO',
  'PLACA', 'PLACA ADAPTADORA ENCODER LINEAR', 'USIMINAS', 'PAEL-DI261940', 'PLACA ENCODER ABSOLUTO PARA TRENA', 'PAEAT - DI261941'];
const s = i => '<c r="%" s="44" t="s"><v>' + i + '</v></c>';
const linha = (r, cels) => '<row r="' + r + '" spans="1:6" ht="30.75">' + cels.map(([k, v]) => v.replace('%', k + r)).join('') + '</row>';
const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:F7"/><sheetData>'
  + linha(1, [['A', s(0)]]) + linha(2, [['A', s(1)], ['B', s(2)], ['C', s(3)], ['D', s(4)], ['E', s(5)], ['F', s(6)]])
  + linha(3, [['A', '<c r="%" s="44"><v>1940</v></c>'], ['B', s(7)], ['C', s(8)], ['D', s(9)], ['E', s(10)]])
  + linha(4, [['A', '<c r="%" s="44"><v>1941</v></c>'], ['B', s(7)], ['C', s(11)], ['D', s(9)], ['E', s(12)]])
  + '<row r="5" spans="1:6"><c r="A5" s="44"><v>1941</v></c></row><row r="6" spans="1:6"><c r="A6" s="44"><v>1941</v></c></row>'
  + '</sheetData></worksheet>';
const ents = [
  ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'],
  ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Planilha1" sheetId="1" r:id="rId1"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'],
  ['xl/worksheets/sheet1.xml', sheet],
  ['xl/sharedStrings.xml', '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + strings.length + '" uniqueCount="' + strings.length + '">' + strings.map(x => '<si><t>' + esc(x) + '</t></si>').join('') + '</sst>'],
].map(([nome, t]) => ({ nome, dados: Buffer.from(t, 'utf8') }));
fs.writeFileSync(ARQ, C.escreverZip(ents));
const outros = C.lerZip(fs.readFileSync(ARQ)).filter(e => e.nome !== 'xl/worksheets/sheet1.xml').map(e => e.nome + ':' + e.dados.toString('base64'));

(async () => {
  /* ---- 1. a sigla: o costume do catálogo de 2026 ---- */
  for (const [n, sg] of [['PLACA UNIDADE SENSOR INCLINÔMETRO', 'PUSI'], ['DISPOSITIVO DE COMSSIONAMENTO PARA DRIVERS', 'PDCD'],
                         ['PLACA ADAPTADORA ENCODER LINEAR', 'PAEL'], ['PLACA DISPLAY DO INDICADOR DIGITAL (POTENCIOMETRO)', 'PDIDP'],
                         ['PLACA - ENCODER EIXO VAZADO', 'PEEV'], ['Cartão base do rack', 'PBR']])
    assert.strictEqual(C.sigla(n, 'PLACA'), sg, n);
  assert.strictEqual(C.codigo('PAEL', '26', 1940), 'PAEL-DI261940');
  console.log('  sigla e código ok');

  /* ---- 2. ler, a prévia e a busca ---- */
  const c = C.abre();
  assert.deepStrictEqual([c.itens.length, c.ultimo, c.proximo], [2, 1941, 1942], 'as linhas de sobra (só o ITEM) não contam');
  const pv = C.previa({ nome: 'Placa medidora de nível' });
  assert.strictEqual(pv.codigo, 'PMN-DI' + C.abre().ano + '1942');
  assert.strictEqual(pv.ultimo.modelo, 'PAEAT - DI261941');
  assert.strictEqual(C.busca({ codigo: 'PAEAT-DI261941' }).achou.nome, 'PLACA ENCODER ABSOLUTO PARA TRENA', 'espaços no código não contam');
  assert.strictEqual(C.busca({ codigo: 'XX-DI999999' }).achou, null);
  console.log('  leitura, prévia e busca ok');

  /* ---- 3. registrar: a linha nova na primeira sobra, o resto do .xlsx igual ---- */
  const r = C.registra({ nome: 'Placa medidora de nível', cliente: 'alumar', vinculo: 'silo & nível <2>' });
  assert.strictEqual(r.item, 1942); assert.strictEqual(r.linha, 5);
  const d = C.abre();
  const novo = d.itens.find(i => i.item === 1942);
  assert.deepStrictEqual([novo.tipo, novo.nome, novo.cliente, novo.modelo, novo.vinculo],
    ['PLACA', 'PLACA MEDIDORA DE NÍVEL', 'ALUMAR', r.codigo, 'silo & nível <2>'], 'a linha, com o texto escapado');
  assert.ok(d.linhas.some(l => l.r === 6 && l.cel.A.v === '1941'), 'a sobra seguinte continua lá');
  assert.ok(/<c r="A5" s="44"><v>1942<\/v>/.test(d.xml), 'o ITEM é número, com o estilo da linha anterior');
  assert.ok(/<row r="5" spans="1:6" ht="30.75" customHeight="1">/.test(d.xml), 'a altura da linha anterior');
  assert.deepStrictEqual(C.lerZip(fs.readFileSync(ARQ)).filter(e => e.nome !== 'xl/worksheets/sheet1.xml').map(e => e.nome + ':' + e.dados.toString('base64')), outros,
    'sharedStrings, workbook e o resto do .xlsx não mudam');
  assert.ok(fs.existsSync(r.copia), 'a cópia de antes ficou guardada');
  assert.throws(() => C.registra({ nome: 'X', sigla: '1ab' }), /sigla inválida/);
  /* a mesma placa outra vez é recusada (2026-11-05: "não pode deixar repetir"), dizendo o código que já existe; outro
     nome ganha o número seguinte */
  assert.throws(() => C.registra({ nome: 'Placa medidora de nível' }), /já está no catálogo com o código PMN-DI\d+1942/);
  /* 1.88.0 (pedido do dono: "pode remover o limite de caracter no nome"): sem limite de tamanho, placa ou equipamento */
  assert.strictEqual(C.NOME_MAX, undefined, 'o limite de 27 saiu');
  const r43 = C.registra({ nome: 'Placa medidora de temperatura com nome bem comprido, mais de 27 caracteres' });
  assert.strictEqual(r43.item, 1943);
  assert.ok(r43.codigo.startsWith('P'), 'placa nova começa com P');
  const L0codigo = () => r43.codigo;
  /* 1.88.0: as categorias — produto e equipamento viram uma coisa só (Equipamento); cabo, software, sistema, acessório e
     nacionalização são categorias próprias; TIPO desconhecido vira uma categoria com o próprio nome */
  assert.deepStrictEqual(['PLACA', 'Placa', 'PCB', 'Equipamento', 'EQUIAPAMENTO', 'Equipmaento', 'Equiapamento/Nacion.', 'Revenda Equipamento', 'Produto',
                          'Sistema', 'Nacionalização', 'Acessórios', 'ASSESORIO', 'CABO', 'Software', 'Ferramenta', ''].map(C.grupo),
    ['placa', 'placa', 'placa', 'equipamento', 'equipamento', 'equipamento', 'equipamento', 'equipamento', 'equipamento',
     'sistema', 'nacionalizacao', 'acessorio', 'acessorio', 'cabo', 'software', 'ferramenta', 'equipamento']);
  const cats = C.categoriasDe([{ grupo: 'placa' }, { grupo: 'cabo' }, { grupo: 'ferramenta', tipo: 'Ferramenta' }]);
  assert.deepStrictEqual(cats.map(c => c.id), ['placa', 'equipamento', 'sistema', 'cabo', 'software', 'acessorio', 'nacionalizacao', 'ferramenta']);
  assert.ok(!cats.some(c => c.id === 'produto'), 'o filtro Produtos saiu');
  /* a placa começa com "P": cadastro recusado; a antiga sem P fica marcada (codigoErrado) */
  assert.throws(() => C.registra({ nome: 'Placa sem pe', sigla: 'XSP' }), /tem que começar com "P"/);
  assert.ok(C.registra({ nome: 'Cabo sem pe', tipo: 'CABO', sigla: 'XSP' }).codigo.startsWith('XSP-'), 'cabo não precisa do P');
  assert.ok(C.codigoDePlacaOk('pael - di261940') && !C.codigoDePlacaOk('ISO-DI181526'));
  /* mudar o nome e o código de um item (o botão direito do Definir projeto): na mesma linha, sem repetir código */
  const e1 = C.edita({ item: 1943, codigo: L0codigo(), novoNome: 'Placa med. temperatura v2 — também sem limite de tamanho' });
  assert.strictEqual(e1.nome, 'Placa med. temperatura v2 — também sem limite de tamanho');
  assert.throws(() => C.edita({ item: 1943, codigo: e1.codigo, novoCodigo: C.abre().itens.find(i => i.item === 1942).modelo }), /já é do item 1942/);
  assert.throws(() => C.edita({ item: 1943, codigo: 'OUTRO-DI000000', novoNome: 'x' }), /não está mais no catálogo/);
  const e2 = C.edita({ item: 1943, codigo: e1.codigo, novoCodigo: 'pmtv-di261943' });
  assert.strictEqual(e2.codigo, 'PMTV-DI261943');
  const depois = C.abre().itens.find(i => i.item === 1943);
  assert.deepStrictEqual([depois.nome, depois.modelo], ['Placa med. temperatura v2 — também sem limite de tamanho', 'PMTV-DI261943'], 'gravado na planilha');
  /* placa: o código novo sem o P é recusado */
  assert.throws(() => C.edita({ item: 1943, codigo: 'PMTV-DI261943', novoCodigo: 'MTV-DI261943' }), /tem que começar com "P"/);
  /* mudar a categoria (a coluna TIPO), sem mexer no código; "produto" agora é equipamento */
  const e3 = C.edita({ item: 1943, codigo: 'PMTV-DI261943', novoGrupo: 'produto' });
  assert.deepStrictEqual([e3.tipo, e3.grupo, e3.codigo], ['Equipamento', 'equipamento', 'PMTV-DI261943']);
  assert.throws(() => C.edita({ item: 1943, codigo: 'PMTV-DI261943', novoGrupo: 'equipamento' }), /já é dessa categoria/);
  assert.throws(() => C.edita({ item: 1943, codigo: 'PMTV-DI261943', novoGrupo: 'outra' }), /categoria desconhecida/);
  const e5 = C.edita({ item: 1943, codigo: 'PMTV-DI261943', novoGrupo: 'cabo' });
  assert.deepStrictEqual([e5.tipo, e5.grupo], ['Cabo', 'cabo']);
  assert.deepStrictEqual([C.tipoDoGrupo('equipamento', 'EQUIAPAMENTO'), C.tipoDoGrupo('cabo', 'CABO'), C.tipoDoGrupo('placa', 'CABO'), C.tipoDoGrupo('produto', 'Produto')],
    ['EQUIAPAMENTO', 'CABO', 'Placa', 'Produto']);
  const e4 = C.edita({ item: 1943, codigo: 'PMTV-DI261943', novoGrupo: 'placa' });
  assert.deepStrictEqual([e4.tipo, e4.grupo], ['Placa', 'placa']);
  /* um item com código sem P não vira placa */
  const cabo = C.abre().itens.find(i => i.tipo === 'CABO');
  assert.throws(() => C.edita({ item: cabo.item, codigo: cabo.modelo, novoGrupo: 'placa' }), /tem que começar com "P"/);
  const L = C.lista();
  assert.deepStrictEqual(L.itens.filter(i => i.item <= 1943).map(i => [i.item, i.grupo]).slice(-2), [[1942, 'placa'], [1943, 'placa']]);
  assert.ok(L.categorias.some(c => c.id === 'cabo' && c.n === 1) && !('nomeMax' in L));
  console.log('  registrar: linha nova, estilos, o resto do .xlsx intacto ok');

  /* ---- 4. o template preenchido ---- */
  const pt = C.paramsTemplate({ codigo: 'PAEL-DI261940', nome: 'placa adaptadora', iniciador: 'Ana', data: new Date(2026, 10, 4) });
  assert.deepStrictEqual([pt.CodigoDaPlaca, pt.Arquivo, pt.Equipamento_linha_um, pt.Desenhista_DiEletrons, pt.Data_desenho],
    ['PAEL-DI261940', undefined, undefined, 'Ana', '04/11/26'], 'o código da placa; o Arquivo é o nome da folha');
  const T = require('../hub-schtemplate.js');
  assert.deepStrictEqual(T.codigoDoProjeto('PDCD-DI261939 (PTYPE)'), { codigo: 'PDCD-DI261939', numero: 'DI261939' });
  assert.deepStrictEqual(T.codigoDoProjeto('PAEAT - DI261941'), { codigo: 'PAEAT-DI261941', numero: 'DI261941' });
  assert.strictEqual(T.codigoDoProjeto('LM555 astável'), null);
  const ctx = T.contexto({ projeto: 'PDCD-DI261939 (PTYPE)', formato: 'A3' });
  assert.deepStrictEqual([T.valor('Arquivo', ctx), T.valor('CodigoDaPlaca', ctx), T.valor('Formato', ctx)], ['SCH-DI261939', 'PDCD-DI261939', 'A3'],
    'o carimbo se completa pelo nome do projeto e pela folha');
  assert.strictEqual(T.valor('Arquivo', T.contexto({ projeto: 'PDCD-DI261939', proj: 'Arquivo=OUTRO', folhaNome: 'SCH-X' })), 'SCH-X',
    'o Arquivo é o nome da folha, o que o projeto grava não conta');
  console.log('  carimbo: params do projeto novo e o preenchimento sozinho ok');

  /* ---- 5. pelo MCP: catalogo_previa e projeto_criar {produto} ---- */
  const PROJETOS = path.join(TMP, 'Projects');
  fs.mkdirSync(PROJETOS);
  const { montaServidor, servidorHttp } = require('../mcp/eletrichub-mcp.js');
  /* 1.84.0: o Nexo Hub desta máquina fica de fora (logado, o desenhista seria o login): aqui o Hub "antigo", sem login */
  require('../mcp/lib/equipe.js')._provedor(() => ({ status: 404 }));
  const srv = montaServidor({ root: path.join(__dirname, '..'), projetos: PROJETOS, log: () => {} });
  const h = servidorHttp(srv, { http: 0, host: '127.0.0.1' });
  await new Promise(ok => h.once('listening', ok));
  const url = `http://127.0.0.1:${h.address().port}/mcp`;
  let id = 0;
  const chama = async (name, args) => {
    const r2 = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) });
    const j = await r2.json();
    return { erro: j.result && j.result.isError, j: JSON.parse(j.result.content[0].text) };
  };
  let x = await chama('catalogo_previa', { nome: 'Placa de teste do MCP' });
  assert.ok(!x.erro && x.j.codigo === 'PTM-DI' + d.ano + '1945', JSON.stringify(x.j));
  x = await chama('projeto_criar', { produto: { nome: 'Placa de teste do MCP' } });
  assert.ok(x.erro && /iniciador/.test(JSON.stringify(x.j)), 'sem quem iniciou: recusa');
  assert.strictEqual(C.abre().ultimo, 1944, 'e nada foi registrado');
  x = await chama('projeto_criar', { produto: { nome: 'Placa de teste do MCP', iniciador: 'Ana Teste', cliente: 'usiminas' } });
  assert.ok(!x.erro && x.j.ok, JSON.stringify(x.j));
  assert.strictEqual(x.j.projeto, 'PTM-DI' + d.ano + '1945', 'o código vira o nome do projeto');
  assert.strictEqual(x.j.catalogo.item, 1945);
  const sch = fs.readFileSync(path.join(PROJETOS, x.j.projeto, 'schematic.js'), 'utf8');
  assert.ok(/"template":"casa:A4_DiEletrons"/.test(sch.replace(/\s/g, '')), 'a folha no template da casa');
  assert.ok(/Desenhista_DiEletrons=Ana Teste/.test(sch) && /Cliente=USIMINAS/.test(sch) && /CodigoDaPlaca=PTM-DI\d+1945/.test(sch), sch);
  assert.ok(/NomeDaPlaca=PLACA DE TESTE DO MCP/.test(sch), '1.88.0: o nome da PCB no cabeçalho (a árvore)');
  assert.ok(/"name":"SCH-DI\d+1945"/.test(sch.replace(/\s/g, '')), 'a folha com o nome do arquivo do carimbo');
  x = await chama('sch_validar', { projeto: 'PTM-DI' + d.ano + '1945' });
  assert.ok(!x.erro, JSON.stringify(x.j));
  x = await chama('catalogo_previa', { codigo: 'PTM-DI' + d.ano + '1945' });
  assert.strictEqual(x.j.achou.cliente, 'USIMINAS');
  /* o template do esquema: o que não existe é recusado ANTES de registrar; "" cria a folha sem template */
  x = await chama('projeto_criar', { produto: { nome: 'Outra placa', iniciador: 'Ana' }, template: 'casa:nao-existe' });
  assert.ok(x.erro && /não existe/.test(JSON.stringify(x.j)), JSON.stringify(x.j));
  assert.strictEqual(C.abre().ultimo, 1945, 'template errado: nada registrado');
  x = await chama('projeto_criar', { produto: { nome: 'Outra placa', iniciador: 'Ana' }, template: '' });
  assert.ok(!x.erro && x.j.ok, JSON.stringify(x.j));
  assert.ok(!/"template"/.test(fs.readFileSync(path.join(PROJETOS, x.j.projeto, 'schematic.js'), 'utf8')), 'sem template');
  h.close();
  console.log('  MCP: catalogo_previa, projeto_criar {produto} (registra, nome = código, carimbo) ok');

  /* ---- 6. o catálogo que não existe: erro que diz o quê ---- */
  assert.throws(() => C.abre(path.join(TMP, 'nao-existe.xlsx')), /NAS 192\.168\.15\.31/);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-catalogo: ok');
})().catch(e => { console.error(e); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
