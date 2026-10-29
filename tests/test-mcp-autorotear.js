/* O pcb_autorotear do MCP, como um cliente o usaria (o servidor no mesmo processo, como o
   tests/test-e2e-placas.js), numa CÓPIA temporária de uma placa do acervo — os Projects reais nunca
   são gravados:
     node tests/test-mcp-autorotear.js

   1. pcb_apagar tira as trilhas de três nets de sinal (track_del com os orig_* do board.js, como a IA
      faria) e o nets_ratsnest mostra as conexões abertas;
   2. pcb_autorotear em simulação (o padrão): o relatório (antes/depois, por net, vias, comprimento,
      DRC com as violações NOVAS = 0) e NADA gravado;
   3. pcb_autorotear {gravar:true}: os track_add/via_add vão para o changes.js pelo caminho validado, o
      pcb_validar passa, o nets_ratsnest fecha as nets e o drc_rodar não piora;
   4. as nets pedidas já fechadas: nada a fazer, nada gravado;
   5. pcb_fanout (P2, item 18): um plano de GND no Bottom (pour_definir), as trilhas de GND fora, e o
      fanout liga os pads SMD de GND do Top ao plano por trilha curta + via — simulado, DRC sem violação
      nova, os pads chegam ao plano na placa redespejada; gravar:true escreve as linhas com o note. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');

process.env.ELETRICHUB_SEM_RELATO = '1';
const RAIZ = path.join(__dirname, '..');
const PROJ = 'PRJ - IT - DI221705 (Alimentação)';
const ORIGEM = path.join(RAIZ, 'Projects', PROJ);
let falhou = 0;
const ok = (c, m) => { if (c) console.log('ok  ' + m); else { falhou++; console.log('FALHOU  ' + m); } };

if (!fs.existsSync(path.join(ORIGEM, 'board.js'))) { console.log('test-mcp-autorotear: a placa do acervo não está aqui — pulado'); process.exit(0); }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-autorotear-'));
const PROJETOS = path.join(TMP, 'Projects');
fs.mkdirSync(PROJETOS);
fs.cpSync(ORIGEM, path.join(PROJETOS, PROJ), { recursive: true });
const D = path.join(PROJETOS, PROJ);
fs.writeFileSync(path.join(D, 'changes.js'), '// comentario do usuario que tem de sobreviver\n' + require('../hub-core.js').serializeChanges([]).text);
fs.writeFileSync(path.join(TMP, 'projects.js'), 'var projects = [\n];\n');
const realAntes = fs.readFileSync(path.join(ORIGEM, 'board.js'), 'utf8');
const realCh = fs.existsSync(path.join(ORIGEM, 'changes.js')) ? fs.readFileSync(path.join(ORIGEM, 'changes.js'), 'utf8') : null;

const { montaServidor } = require('../mcp/eletrichub-mcp.js');
const srv = montaServidor({ root: RAIZ, projetos: PROJETOS, log: () => {} });
let seq = 0;
async function chama(name, args) {
  const r = await srv.atende({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } });
  return { j: JSON.parse(r.result.content[0].text), erro: !!r.result.isError };
}

(async () => {
  /* a ferramenta está registrada e listada */
  const lista = (await srv.atende({ jsonrpc: '2.0', id: ++seq, method: 'tools/list', params: {} })).result.tools;
  const t = lista.find(x => x.name === 'pcb_autorotear');
  ok(t && t.inputSchema.properties.gravar && t.inputSchema.properties.nets && t.inputSchema.properties.ordem && t.annotations && t.annotations.readOnlyHint === false,
     'pcb_autorotear no tools/list, com nets/ordem/gravar');
  let { j } = await chama('list_commands', {});
  ok(JSON.stringify(j).includes('pcb_autorotear'), 'list_commands lista o pcb_autorotear');

  /* 1. tira as trilhas de três nets de sinal */
  const board = require('../mcp/lib/arquivo-linhas.js').lerVar(path.join(D, 'board.js'), 'pcbmirror');
  const porNet = {};
  for (const tr of board.tracks || []) if (tr.net && !tr.owner) (porNet[tr.net] = porNet[tr.net] || []).push(tr.id);
  const nets = Object.keys(porNet).sort((a, b) => porNet[b].length - porNet[a].length).slice(1, 4);
  ({ j } = await chama('pcb_apagar', { projeto: PROJ, ids: [].concat(...nets.map(n => porNet[n])), note: 'teste: arrancar para autorotear' }));
  ok(j.ok && j.gravado, 'pcb_apagar tirou ' + nets.map(n => n + ' (' + porNet[n].length + ')').join(', '));
  ({ j } = await chama('nets_ratsnest', { projeto: PROJ }));
  const abertasAntes = j.ligacoes_faltando;
  const dasNets = j.nets.filter(n => nets.includes(n.net)).reduce((s, n) => s + n.faltam, 0);
  ok(dasNets > 0, `ratsnest: ${abertasAntes} conexões abertas, ${dasNets} nas três nets`);
  const drcAntes = (await chama('drc_rodar', { projeto: PROJ })).j.total;

  /* 2. simulação */
  const chAntes = fs.readFileSync(path.join(D, 'changes.js'), 'utf8');
  const sim = await chama('pcb_autorotear', { projeto: PROJ, nets });
  j = sim.j;
  ok(!sim.erro, 'pcb_autorotear simulado responde sem erro' + (sim.erro ? ': ' + JSON.stringify(j).slice(0, 400) : ''));
  ok(j.conexoes_abertas && j.conexoes_abertas.das_nets_pedidas.antes === dasNets && j.conexoes_abertas.das_nets_pedidas.depois < dasNets,
     `simulação: das nets pedidas ${dasNets} -> ${j.conexoes_abertas && j.conexoes_abertas.das_nets_pedidas.depois} abertas (${j.vias} vias, ${j.comprimento_mm} mm, ${j.ms} ms)`);
  ok(j.conexoes_abertas && j.conexoes_abertas.na_placa_depois === j.conexoes_abertas.depois, 'o ratsnest da placa simulada (com os planos) bate com o relatório');
  ok(j.drc && j.drc.novas === 0, 'DRC da simulação: nenhuma violação nova (' + JSON.stringify(j.drc && j.drc.novas_lista && j.drc.novas_lista.slice(0, 3)) + ')');
  ok(j.gravacao && j.gravacao.gravado === false && j.gravacao.simulado === true && j.gravacao.ok, 'simulação valida e não grava');
  ok(fs.readFileSync(path.join(D, 'changes.js'), 'utf8') === chAntes, 'o changes.js não mudou na simulação');
  ok(Array.isArray(j.por_net) && j.por_net.length === nets.length && j.parametros && j.orcamento && j.orcamento.tempoMs > 0, 'relatório com por_net, parâmetros e orçamento');

  /* 3. gravar */
  const gr = await chama('pcb_autorotear', { projeto: PROJ, nets, gravar: true });
  j = gr.j;
  ok(!gr.erro && j.gravacao && j.gravacao.gravado && j.gravacao.ok, 'gravar:true grava validado' + (gr.erro || !j.gravacao.gravado ? ': ' + JSON.stringify(j.gravacao || j).slice(0, 500) : ''));
  const ch = fs.readFileSync(path.join(D, 'changes.js'), 'utf8');
  const linhas = ch.split('\n').filter(l => l.startsWith('{'));
  const adds = linhas.filter(l => /"op":"(track_add|via_add)"/.test(l));
  ok(ch.startsWith('// comentario do usuario que tem de sobreviver'), 'o comentário do usuário ficou');
  ok(adds.length === j.trilhas + j.vias && adds.every(l => l.includes('"note":"pcb_autorotear"') && /"net":"/.test(l)), `${adds.length} linhas novas (track_add/via_add), com net e note`);
  ({ j } = await chama('pcb_validar', { projeto: PROJ }));
  ok(j.ok, 'pcb_validar passa: ' + JSON.stringify(j.validacao && j.validacao.mensagens && j.validacao.mensagens.slice(0, 3)));
  ({ j } = await chama('nets_ratsnest', { projeto: PROJ }));
  const restam = j.nets.filter(n => nets.includes(n.net)).reduce((s, n) => s + n.faltam, 0);
  ok(restam < dasNets && j.ligacoes_faltando < abertasAntes, `nets_ratsnest depois: ${j.ligacoes_faltando} abertas na placa (${restam} nas três nets)`);
  const drcDepois = (await chama('drc_rodar', { projeto: PROJ })).j.total;
  ok(drcDepois <= drcAntes, `drc_rodar não piora: ${drcAntes} -> ${drcDepois}`);

  /* 4. de novo: as nets já fecharam, nada a fazer */
  ({ j } = await chama('pcb_autorotear', { projeto: PROJ, nets, gravar: true }));
  ok(j.gravacao && j.gravacao.gravado === false && (restam > 0 || /nada a ligar/.test(j.gravacao.nota || '')), 'as nets fechadas: nada gravado');
  ok(fs.readFileSync(path.join(D, 'changes.js'), 'utf8') === ch, 'o changes.js ficou como estava');

  /* 5. o fanout de GND */
  const tf = lista.find(x => x.name === 'pcb_fanout');
  ok(tf && tf.inputSchema.properties.net && tf.inputSchema.required.includes('net'), 'pcb_fanout no tools/list, com net obrigatória');
  const bb = board.board.bbox;
  ({ j } = await chama('pour_definir', { projeto: PROJ, layer: 'Bottom', net: 'GND', nome: 'GND_teste',
    pts: [[bb.x1, bb.y1], [bb.x2, bb.y1], [bb.x2, bb.y2], [bb.x1, bb.y2]], opcoes: { removeDead: true } }));
  ok(j.ok !== false && !(j.erros && j.erros.length), 'pour_definir: plano de GND no Bottom' + (j.erros && j.erros.length ? ': ' + JSON.stringify(j.erros).slice(0, 300) : ''));
  const gndTr = (board.tracks || []).filter(tr => tr.net === 'GND' && !tr.owner).map(tr => tr.id);
  if (gndTr.length) ({ j } = await chama('pcb_apagar', { projeto: PROJ, ids: gndTr, note: 'teste: GND sem trilha para o fanout' }));
  const fs1 = await chama('pcb_fanout', { projeto: PROJ, net: 'GND' });
  j = fs1.j;
  ok(!fs1.erro && j.feitos > 0 && j.vias === j.feitos, `pcb_fanout simulado: ${j.pads_smd} pads SMD, ${j.ja_chegavam_ao_plano} já no plano, ${j.feitos} com via, falhas ${JSON.stringify(j.falhas)}` + (fs1.erro ? ': ' + JSON.stringify(j).slice(0, 400) : ''));
  ok(j.depois && j.depois.ligados === j.pads_smd - j.falhas.length, `depois, na placa redespejada: ${j.depois && j.depois.ligados} de ${j.pads_smd} pads chegam ao plano`);
  ok(j.drc && j.drc.novas === 0, 'fanout sem violação nova de DRC ' + JSON.stringify(j.drc && j.drc.novas_lista && j.drc.novas_lista.slice(0, 3)));
  ok(j.gravacao && j.gravacao.simulado === true && j.gravacao.gravado === false, 'fanout simulado não grava');
  const fg = await chama('pcb_fanout', { projeto: PROJ, net: 'GND', gravar: true });
  const chF = fs.readFileSync(path.join(D, 'changes.js'), 'utf8').split('\n').filter(l => /"note":"fanout GND"/.test(l));
  ok(fg.j.gravacao && fg.j.gravacao.gravado && chF.length === 2 * fg.j.feitos, `fanout gravado: ${chF.length} linhas com o note "fanout GND"`);
  ({ j } = await chama('pcb_fanout', { projeto: PROJ, net: 'GND' }));
  ok(j.feitos === 0 && j.ja_chegavam_ao_plano === j.pads_smd - j.falhas.length, 'de novo: todos os pads já chegam ao plano, nada a fazer');

  ok(fs.readFileSync(path.join(ORIGEM, 'board.js'), 'utf8') === realAntes && (realCh === null || fs.readFileSync(path.join(ORIGEM, 'changes.js'), 'utf8') === realCh),
     'o projeto real não mudou');
  fs.rmSync(TMP, { recursive: true, force: true });
  if (falhou) { console.log(`test-mcp-autorotear FALHOU (${falhou})`); process.exit(1); }
  console.log('test-mcp-autorotear OK');
})().catch(e => { console.error(e); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
