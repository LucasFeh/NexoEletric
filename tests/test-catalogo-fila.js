/* A fila do catálogo (1.89.0, mcp/lib/catalogo-fila.js): cadastrar e editar com a planilha aberta no Excel, várias
   máquinas ao mesmo tempo, um gravador por vez.
     node tests/test-catalogo-fila.js
   Contra um catálogo FALSO (o .xlsx no formato do de verdade) numa pasta temporária e um NexoBD DE MENTIRA
   (tests/nexohub-falso.js). O "Excel aberto" é um PowerShell segurando o arquivo (FileShare.Read: os outros leem, ninguém
   grava; FileShare.None: nem ler). O catálogo de verdade (no NAS) e o Nexo Hub desta máquina nunca são tocados. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawn, execFile } = require('child_process');

if (process.platform !== 'win32') { console.log('test-catalogo-fila: pulado (a trava do Excel é do Windows)'); process.exit(0); }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'test-catfila-'));
const ARQ = path.join(TMP, 'CATALOGAÇÃO TODOS OS PRODUTOS .xlsx');
const MOTOR = path.join(__dirname, '..', 'mcp', 'lib', 'catalogo.js');
process.env.NEXO_CATALOGO = ARQ;
delete process.env.NEXO_FILA;
const C = require('../mcp/lib/catalogo.js');
const F = require('../mcp/lib/catalogo-fila.js');
const FALSO = require('./nexohub-falso.js');

/* ---- o catálogo falso: duas placas, um equipamento, um cabo (o Definir não mostra) e as sobras ---- */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const strings = ['TABELA', 'ITEM ', 'TIPO', 'NOME', 'CLIENTE ', 'MODELO', 'VÍNCULO',
  'PLACA', 'PLACA ADAPTADORA ENCODER LINEAR', 'USIMINAS', 'PAEL-DI261940', 'EQUIPAMENTO', 'ENCODER LINEAR', 'EEL-DI261941', 'CABO', 'CABO SERIAL', 'CS-DI261942'];
const s = i => '<c r="%" s="44" t="s"><v>' + i + '</v></c>';
const n = v => '<c r="%" s="44"><v>' + v + '</v></c>';
const linha = (r, cels) => '<row r="' + r + '" spans="1:6" ht="30.75">' + cels.map(([k, v]) => v.replace('%', k + r)).join('') + '</row>';
const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:F8"/><sheetData>'
  + linha(1, [['A', s(0)]]) + linha(2, [['A', s(1)], ['B', s(2)], ['C', s(3)], ['D', s(4)], ['E', s(5)], ['F', s(6)]])
  + linha(3, [['A', n(1940)], ['B', s(7)], ['C', s(8)], ['D', s(9)], ['E', s(10)]])
  + linha(4, [['A', n(1941)], ['B', s(11)], ['C', s(12)], ['D', s(9)], ['E', s(13)]])
  + linha(5, [['A', n(1942)], ['B', s(14)], ['C', s(15)], ['E', s(16)]])
  + '<row r="6" spans="1:6"><c r="A6" s="44"><v>1942</v></c></row><row r="7" spans="1:6"><c r="A7" s="44"><v>1942</v></c></row>'
  + '</sheetData></worksheet>';
const ents = [
  ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
  ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Planilha1" sheetId="1" r:id="rId1"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
  ['xl/worksheets/sheet1.xml', sheet],
  ['xl/sharedStrings.xml', '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + strings.map(x => '<si><t>' + esc(x) + '</t></si>').join('') + '</sst>'],
].map(([nome, t]) => ({ nome, dados: Buffer.from(t, 'utf8') }));
fs.writeFileSync(ARQ, C.escreverZip(ents));

const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const espera = ms => new Promise(r => setTimeout(r, ms));
/* o "Excel": segura o arquivo até ser morto */
function trava(modo) {
  return new Promise((ok, falha) => {
    const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `$f = [System.IO.File]::Open('${ARQ.replace(/'/g, "''")}', 'Open', 'ReadWrite', [System.IO.FileShare]::${modo}); Write-Output travado; Start-Sleep -Seconds 300; $f.Close()`],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let saida = '';
    ps.stdout.on('data', d => { saida += d; if (/travado/.test(saida)) ok({ solta: () => new Promise(r => { ps.once('exit', r); ps.kill(); }) }); });
    ps.on('exit', c => { if (!/travado/.test(saida)) falha(new Error('a trava não pegou (' + c + ')')); });
  });
}
/* o motor como o hubserver o roda (outra "máquina" = outro processo com outro NEXO_MAQUINA) */
function cli(entrada, maquina) {
  return new Promise((ok, falha) => {
    const p = execFile(process.execPath, [MOTOR, '--cli'], { env: Object.assign({}, process.env, { NEXO_MAQUINA: maquina || 'PC-TESTE' }), windowsHide: true },
      (e, out) => { const l = String(out).trim().split('\n').pop(); try { ok(JSON.parse(l)); } catch (_) { falha(e || new Error('saída: ' + out)); } });
    p.stdin.end(JSON.stringify(entrada));
  });
}
const linhasDoCodigo = cod => C.abre(ARQ).itens.filter(i => C.normCod(i.modelo) === C.normCod(cod)).length;

(async () => {
  const srv = await FALSO.inicia({ porta: 0 });
  process.env.NEXOHUB_URL = srv.url;
  process.env.NEXOHUB_TOKEN = 'teste';
  let excel = null;
  try {
    /* ---- 0. desligada sem NexoBD de teste (os outros testes): o caminho de antes ---- */
    assert.ok(F.desligada({ NEXO_CATALOGO: 'x' }), 'catálogo de teste sem NEXOHUB_URL: desligada');
    assert.strictEqual(F.desligada({ NEXO_CATALOGO: 'x', NEXOHUB_URL: 'http://x' }), '');
    assert.ok(F.desligada({ NEXO_FILA: '0' }));

    /* ---- 1. a lista com a planilha livre: a fila ligada, vazia (e nenhum item criado no NexoBD só para ler) ---- */
    let L = await F.lista();
    assert.strictEqual(L.fila.ligada, true, JSON.stringify(L.fila));
    assert.deepStrictEqual([L.fila.pendentes, L.fila.travada, L.ultimo], [0, false, 1942]);
    assert.strictEqual(srv.estado.itens.size, 0, 'ler não cria a fila no NexoBD');
    console.log('  lista com a fila ligada ok');

    /* ---- 2. o Excel aberto (FileShare.Read, como o Excel): cadastrar vai para a fila, responde na hora ---- */
    excel = await trava('Read');
    assert.ok(C.emUso(ARQ), 'o arquivo está em uso');
    assert.throws(() => C.registra({ nome: 'Placa que falhava' }), /aberto em outro programa/, 'o caminho de antes recusava (1.88.0)');
    const sha0 = sha(ARQ);
    const r1 = await F.registra({ nome: 'Placa sensor de nível', tipo: 'PLACA', por: { nome: 'Caio Lima', login: 'caio' } });
    assert.strictEqual(r1.pendente, true, JSON.stringify(r1));
    assert.strictEqual(r1.item, 1943);
    assert.strictEqual(r1.codigo, 'PSN-DI' + C.abre().ano + '1943');
    assert.strictEqual(r1.fila.travada, true, 'a tentativa de gravar viu a planilha travada');
    assert.strictEqual(sha(ARQ), sha0, 'a planilha não mudou');
    L = await F.lista();
    const novo = L.itens.find(i => i.modelo === r1.codigo);
    assert.ok(novo && novo.fila && novo.fila.estado === 'pendente' && novo.fila.por.nome === 'Caio Lima', 'aparece na lista, com a marca da fila: ' + JSON.stringify(novo));
    assert.deepStrictEqual([L.ultimo, L.proximo, L.fila.pendentes, L.fila.travada], [1943, 1944, 1, true]);
    const it = [...srv.estado.itens.values()][0];
    assert.deepStrictEqual([it.categoria, it.tipo, srv.estado.categorias.find(c => c.id === 'nexoeletric').oculta], ['nexoeletric', 'outro', true], 'a fila é um item oculto do NexoEletric');
    assert.strictEqual((await F.previa({ nome: 'Outra placa' })).proximo, 1944, 'a prévia conta com a fila');
    assert.strictEqual((await F.busca({ codigo: r1.codigo })).achou.nome, 'PLACA SENSOR DE NÍVEL', 'a busca acha o da fila');
    /* repetido contra a fila: nome e código */
    await assert.rejects(F.registra({ nome: 'Placa sensor de nível', tipo: 'PLACA' }), /já está no catálogo com o código PSN-DI\d+1943/);
    await assert.rejects(F.edita({ item: 1940, codigo: 'PAEL-DI261940', novoCodigo: r1.codigo }), /já é do item 1943/);
    console.log('  Excel aberto: o cadastro vai para a fila e aparece na lista ok');

    /* ---- 3. duas máquinas cadastrando juntas (processos de verdade, ao mesmo tempo): nenhum código ou item repetido ---- */
    const pedidos = [];
    for (let k = 0; k < 4; k++) {
      pedidos.push(cli({ acao: 'registra', nome: 'Placa da maquina A numero ' + k, tipo: 'PLACA' }, 'PC-A'));
      pedidos.push(cli({ acao: 'registra', nome: 'Equipamento da maquina B numero ' + k, tipo: 'EQUIPAMENTO' }, 'PC-B'));
    }
    const rs = await Promise.all(pedidos);
    for (const r of rs) assert.ok(r.ok && r.pendente, JSON.stringify(r));
    const itens = rs.map(r => r.item), cods = rs.map(r => r.codigo);
    assert.strictEqual(new Set(itens).size, 8, 'itens únicos: ' + itens);
    assert.strictEqual(new Set(cods).size, 8, 'códigos únicos: ' + cods);
    assert.deepStrictEqual(itens.slice().sort((a, b) => a - b), [1944, 1945, 1946, 1947, 1948, 1949, 1950, 1951], 'em sequência, depois do da fila');
    assert.strictEqual(sha(ARQ), sha0, 'a planilha continua igual');
    const est = await F.estado();
    assert.deepStrictEqual([est.pendentes, new Set(est.ops.map(o => o.por.maquina)).size], [9, 3], 'as três máquinas na mesma fila');
    console.log('  duas máquinas ao mesmo tempo: ' + itens.length + ' cadastros sem código/item repetido ok');

    /* ---- 4. edição com a planilha travada; edição concorrente com conflito na hora ---- */
    const e1 = await F.edita({ item: 1941, codigo: 'EEL-DI261941', nome: 'ENCODER LINEAR', novoNome: 'ENCODER LINEAR 2M', por: { nome: 'Caio Lima' } });
    assert.ok(e1.pendente && e1.nome === 'ENCODER LINEAR 2M', JSON.stringify(e1));
    L = await F.lista();
    assert.strictEqual(L.itens.find(i => i.item === 1941).nome, 'ENCODER LINEAR 2M', 'a lista mostra o valor novo');
    /* outra pessoa, que ainda via o nome antigo, muda para outra coisa: conflito na hora */
    await assert.rejects(F.edita({ item: 1941, codigo: 'EEL-DI261941', nome: 'ENCODER LINEAR', novoNome: 'ENCODER LINEAR 5M' }),
      e => e.conflito && /outra pessoa mudou o nome/.test(e.message));
    /* editar um cadastro que ainda está na fila: muda nele mesmo (uma linha só) */
    const e2 = await F.edita({ item: r1.item, codigo: r1.codigo, novoNome: 'Placa sensor de nível v2' });
    assert.ok(e2.pendente);
    assert.strictEqual((await F.estado()).ops.filter(o => o.acao === 'edita').length, 1, 'não criou edição: mudou o cadastro pendente');
    /* a categoria: placa <-> equipamento */
    const e3 = await F.edita({ item: rs[1].item, codigo: rs[1].codigo, novoGrupo: 'placa' }).catch(e => e);
    assert.ok(e3 instanceof Error && /tem que começar com "P"/.test(e3.message), 'equipamento sem P não vira placa');
    /* uma edição que alguém vai atropelar no Excel: muda o código do item 1940 */
    const e4 = await F.edita({ item: 1940, codigo: 'PAEL-DI261940', novoNome: 'PLACA ADAPTADORA ENCODER LINEAR V2' });
    assert.ok(e4.pendente);
    console.log('  edição na fila, conflito na hora para quem viu o valor antigo ok');

    /* ---- 5. o Excel fecha: o gravador grava tudo, uma linha por código; dois gravadores ao mesmo tempo, um grava ---- */
    await excel.solta(); excel = null;
    /* antes: "alguém no Excel" muda o nome do item 1940 (a edição da fila fica em conflito) */
    C.edita({ item: 1940, codigo: 'PAEL-DI261940', novoNome: 'PLACA ADAPTADORA MUDADA NO EXCEL' });
    const g = await Promise.all([cli({ acao: 'fila-gravar' }, 'PC-A'), cli({ acao: 'fila-gravar' }, 'PC-B')]);
    const quemGravou = g.filter(x => x.gravados > 0);
    assert.strictEqual(quemGravou.length, 1, 'um gravador só: ' + JSON.stringify(g.map(x => Object.assign({}, x, { ops: undefined }))));
    assert.ok(g.some(x => x.ocupado || x.nada), 'o outro viu a trava (ou nada mais a fazer)');
    const cat = C.abre(ARQ);
    for (const r of rs.concat([r1])) assert.strictEqual(linhasDoCodigo(r.codigo), 1, r.codigo + ' uma vez só');
    assert.strictEqual(cat.itens.find(i => i.item === 1943).nome, 'Placa sensor de nível v2', 'o cadastro já com o nome editado (como a edição de sempre: o nome como foi digitado)');
    assert.strictEqual(cat.itens.find(i => i.item === 1941).nome, 'ENCODER LINEAR 2M', 'a edição gravada');
    assert.strictEqual(cat.itens.find(i => i.item === 1940).nome, 'PLACA ADAPTADORA MUDADA NO EXCEL', 'o conflito não atropela o Excel');
    let st = await F.estado();
    assert.deepStrictEqual([st.pendentes, st.conflitos, st.trava], [0, 1, null], 'a trava solta; só o conflito sobra');
    const conf = st.ops.find(o => o.estado === 'conflito');
    assert.ok(/MUDADA NO EXCEL/.test(conf.erro), conf.erro);
    L = await F.lista();
    assert.strictEqual(L.itens.find(i => i.item === 1940).fila.estado, 'conflito', 'a lista mostra o conflito');
    assert.ok(!L.itens.some(i => i.fila && i.fila.estado === 'pendente'), 'nada mais aguardando');
    /* gravar de novo não duplica nada */
    assert.ok((await F.grava()).nada);
    /* o conflito: gravar por cima */
    const rc = await F.resolve({ id: conf.id, como: 'por-cima' });
    assert.ok(!rc.pendente, JSON.stringify(rc));
    assert.strictEqual(C.abre(ARQ).itens.find(i => i.item === 1940).nome, 'PLACA ADAPTADORA ENCODER LINEAR V2');
    console.log('  Excel fechado: um gravador grava, sem linha repetida; conflito marcado e resolvido ok');

    /* ---- 6. uma trava de máquina que caiu vence sozinha; a de quem está gravando segura ---- */
    const be = F.noNexoBD(ARQ);
    const poeTrava = async (ate) => { const { rev, fila } = await be.ler(); fila.trava = { maquina: 'PC-CAIU', pid: 1, token: 'x', desde: new Date().toISOString(), ate }; await be.gravar(fila, rev); };
    excel = await trava('Read');
    await F.registra({ nome: 'Equipamento depois da queda', tipo: 'EQUIPAMENTO' });
    await excel.solta(); excel = null;
    await poeTrava(new Date(Date.now() + 60000).toISOString());
    assert.deepStrictEqual(await F.grava(), { ocupado: 'PC-CAIU' }, 'a trava válida de outra máquina segura');
    await poeTrava(new Date(Date.now() - 1000).toISOString());
    const gq = await F.grava();
    assert.strictEqual(gq.gravados, 1, 'a trava vencida não prende: ' + JSON.stringify(gq));
    console.log('  trava com validade (máquina que caiu não prende a fila) ok');

    /* ---- 7. o arquivo em uso exclusivo: a lista sai da cópia da última leitura e o cadastro vai para a fila ---- */
    excel = await trava('None');
    assert.throws(() => C.abre(ARQ, { semCopia: true }), e => e.travado);
    L = await F.lista();
    assert.ok(L.fila.copia && L.fila.copia.de, 'leu a cópia: ' + JSON.stringify(L.fila));
    assert.ok(L.itens.length >= 13);
    const rx = await F.registra({ nome: 'Placa com o arquivo exclusivo', tipo: 'PLACA' });
    assert.ok(rx.pendente && rx.item === 1953, JSON.stringify(rx));
    await excel.solta(); excel = null;
    /* ---- 8. falha que não é trava: fica na fila com o erro visível, e grava quando volta ---- */
    const bom = fs.readFileSync(ARQ);
    fs.writeFileSync(ARQ, 'isto não é um xlsx');
    const ge = await F.grava();
    assert.strictEqual(ge.erros, 1, JSON.stringify(ge));
    st = await F.estado().catch(() => null);
    fs.writeFileSync(ARQ, bom);
    st = await F.estado();
    const opx = st.ops.find(o => o.codigo === rx.codigo);
    assert.ok(opx.estado === 'pendente' && /não gravou na planilha: o catálogo não é um \.xlsx válido/.test(opx.erro), JSON.stringify(opx));
    L = await F.lista();
    assert.ok(/não é um \.xlsx/.test(L.itens.find(i => i.modelo === rx.codigo).fila.erro), 'a tela vê o erro');
    assert.strictEqual((await F.grava()).gravados, 1);
    assert.strictEqual(linhasDoCodigo(rx.codigo), 1);
    st = await F.estado();
    assert.ok(!st.ops.find(o => o.codigo === rx.codigo).erro, 'gravado, o erro sai');
    console.log('  arquivo exclusivo (lê a cópia) e erro que não é trava (visível, grava depois) ok');

    /* ---- 9. descartar um cadastro na fila; o número dele não volta para quem já cadastrou depois ---- */
    excel = await trava('Read');
    const rd = await F.registra({ nome: 'Placa para descartar', tipo: 'PLACA' });
    const rdep = await F.registra({ nome: 'Placa depois da descartada', tipo: 'PLACA' });
    await F.resolve({ id: rd.fila.id, como: 'descartar' });
    L = await F.lista();
    assert.ok(!L.itens.some(i => i.modelo === rd.codigo), 'o descartado sai da lista');
    await excel.solta(); excel = null;
    await F.grava();
    assert.deepStrictEqual([linhasDoCodigo(rd.codigo), linhasDoCodigo(rdep.codigo)], [0, 1]);
    console.log('  descartar ok');

    /* ---- 10. sem o NexoBD no ar: o caminho de antes (direto, com a planilha livre; com ela travada, diz por quê) ---- */
    process.env.NEXOHUB_URL = 'http://127.0.0.1:9';
    const rdir = await F.registra({ nome: 'Placa sem nexobd', tipo: 'PLACA' });
    assert.ok(!rdir.pendente && rdir.fila === null && linhasDoCodigo(rdir.codigo) === 1, JSON.stringify(rdir));
    excel = await trava('Read');
    await assert.rejects(F.registra({ nome: 'Placa sem nexobd travada', tipo: 'PLACA' }), /NexoBD \(Nexo Hub\) não respondeu/);
    L = await F.lista();
    assert.strictEqual(L.fila.ligada, false);
    await excel.solta(); excel = null;
    process.env.NEXOHUB_URL = srv.url;
    console.log('  sem o NexoBD: direto na planilha (como antes) ok');
  } finally {
    if (excel) await excel.solta();
    await srv.fecha();
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-catalogo-fila: ok');
})().catch(e => { console.error(e); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
