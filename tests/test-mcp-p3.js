/* O P3 pelo MCP (pcb_mover_lote, pcb_posicao_conferir, pcb_suavizar), como um cliente o usaria (o
   servidor no mesmo processo), numa CÓPIA temporária de uma placa do acervo — os Projects reais nunca
   são gravados:
     node tests/test-mcp-p3.js

   22  pcb_posicao_conferir lista as colisões; pcb_mover_lote move TODOS os componentes numa gravação só
       (sem colisão nova: grava, uma linha comp_move por componente); um lote que põe um componente em
       cima de outro não grava nada (a colisão nova vem na resposta) e com forcar:true grava;
   21  pcb_suavizar: as trilhas de uma net refeitas com um calombo de 90° (pcb_trilha: são linhas
       track_add do changes.js) — a simulação acha o que suavizar, sem violação nova de DRC e sem nada
       gravado; gravar:true troca as linhas track_add pelas novas e a net continua ligada. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');

process.env.ELETRICHUB_SEM_RELATO = '1';
const RAIZ = path.join(__dirname, '..');
const PROJ = 'PRJ - IT - DI221705 (Alimentação)';
const ORIGEM = path.join(RAIZ, 'Projects', PROJ);
let falhou = 0;
const ok = (c, m) => { if (c) console.log('ok  ' + m); else { falhou++; console.log('FALHOU  ' + m); } };

if (!fs.existsSync(path.join(ORIGEM, 'board.js'))) { console.log('test-mcp-p3: a placa do acervo não está aqui — pulado'); process.exit(0); }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-p3-'));
const PROJETOS = path.join(TMP, 'Projects');
fs.mkdirSync(PROJETOS);
fs.cpSync(ORIGEM, path.join(PROJETOS, PROJ), { recursive: true });
const D = path.join(PROJETOS, PROJ);
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
const linhas = () => fs.readFileSync(path.join(D, 'changes.js'), 'utf8').split('\n').filter(l => l.startsWith('{'));

(async () => {
  const lista = (await srv.atende({ jsonrpc: '2.0', id: ++seq, method: 'tools/list', params: {} })).result.tools;
  for (const n of ['pcb_mover_lote', 'pcb_posicao_conferir', 'pcb_suavizar']) ok(lista.some(t => t.name === n), n + ' no tools/list');
  const board = require('../mcp/lib/arquivo-linhas.js').lerVar(path.join(D, 'board.js'), 'pcbmirror');

  /* ---------- 22 ---------- */
  let { j } = await chama('pcb_posicao_conferir', { projeto: PROJ });
  ok(Array.isArray(j.colisoes) && Array.isArray(j.fora) && j.componentes === board.components.length,
     `pcb_posicao_conferir: ${j.componentes} componentes, ${j.n_colisoes} colisão(ões), ${j.n_fora} fora (${j.ms} ms)`);
  const colisoes0 = j.n_colisoes;
  /* todos os componentes, cada um girado 0° e no mesmo lugar: nada novo, grava numa transação só */
  const todos = board.components.map(c => ({ ref: c.ref, dx: 0, dy: 0 }));
  let t0 = Date.now();
  ({ j } = await chama('pcb_mover_lote', { projeto: PROJ, movimentos: todos, note: 'teste lote' }));
  const ms = Date.now() - t0;
  ok(j.gravado && j.ok && j.movimentos === todos.length && j.posicionamento && j.posicionamento.n_novas_colisoes === 0,
     `pcb_mover_lote: ${j.movimentos} movimentos gravados numa chamada em ${ms} ms (colisões ${j.posicionamento && j.posicionamento.colisoes_antes} -> ${j.posicionamento && j.posicionamento.colisoes_depois})` + (j.gravado ? '' : ': ' + JSON.stringify(j).slice(0, 400)));
  ok(linhas().filter(l => /"op":"comp_move"/.test(l)).length === todos.length, 'uma linha comp_move por componente');
  /* um componente em cima de outro: nada gravado */
  const [A, B] = board.components.filter(c => c.layer === 'Top' && c.bbox).slice(0, 2);
  const antesL = fs.readFileSync(path.join(D, 'changes.js'), 'utf8');
  ({ j } = await chama('pcb_mover_lote', { projeto: PROJ, movimentos: [{ ref: A.ref, x: B.x, y: B.y }] }));
  ok(!j.gravado && j.posicionamento.n_novas_colisoes >= 1 && j.posicionamento.novas_colisoes.some(c => [c.a, c.b].includes(A.ref)) && /nada foi gravado/.test(j.dica || ''),
     `${A.ref} em cima de ${B.ref}: ${j.posicionamento.n_novas_colisoes} colisão nova, nada gravado`);
  ok(fs.readFileSync(path.join(D, 'changes.js'), 'utf8') === antesL, 'o changes.js não mudou');
  ({ j } = await chama('pcb_mover_lote', { projeto: PROJ, movimentos: [{ ref: A.ref, x: B.x, y: B.y }], forcar: true }));
  ok(j.gravado, 'com forcar:true grava');
  ({ j } = await chama('pcb_posicao_conferir', { projeto: PROJ, refs: [A.ref] }));
  ok(j.n_colisoes >= 1, `pcb_posicao_conferir {refs:[${A.ref}]}: ${j.n_colisoes} colisão(ões)`);
  /* desfaz: volta ao lugar */
  ({ j } = await chama('pcb_mover_lote', { projeto: PROJ, movimentos: [{ ref: A.ref, x: A.x, y: A.y }] }));
  ok(j.gravado, 'o lote de volta grava');
  ({ j } = await chama('pcb_posicao_conferir', { projeto: PROJ }));
  ok(j.n_colisoes === colisoes0, 'as colisões voltaram ao que eram');
  ({ j } = await chama('pcb_mover_lote', { projeto: PROJ, movimentos: [{ ref: 'NAO_EXISTE', dx: 1 }] }).catch(e => ({ j: { erro: String(e) } })));
  ok(JSON.stringify(j).includes('NAO_EXISTE'), 'ref que não existe: erro, nada gravado');

  /* ---------- 21 ---------- */
  const NET = 'NetL2_1';
  const ids = board.tracks.filter(t => t.net === NET && !t.owner).map(t => t.id);
  ({ j } = await chama('pcb_apagar', { projeto: PROJ, ids, note: 'teste: refazer com calombo' }));
  ok(j.gravado, `pcb_apagar tirou as ${ids.length} trilhas de ${NET}`);
  ({ j } = await chama('pcb_trilha', { projeto: PROJ, layer: 'Bottom', pts: ['R1.2', [111, 113.6], [111, 112.4], [113, 112.4], [113, 113.5], 'L2.1'], w: 0.5, note: 'calombo' }));
  ok(j.gravado, 'pcb_trilha desenhou a net com um calombo de 90° (linhas track_add)' + (j.gravado ? '' : ': ' + JSON.stringify(j.erros || j).slice(0, 300)));
  const calombo = linhas().filter(l => /"note":"calombo"/.test(l)).length;
  ({ j } = await chama('nets_ratsnest', { projeto: PROJ }));
  const faltam0 = (j.nets.find(n => n.net === NET) || { faltam: 0 }).faltam;
  const antesS = fs.readFileSync(path.join(D, 'changes.js'), 'utf8');
  ({ j } = await chama('pcb_suavizar', { projeto: PROJ, nets: [NET] }));
  ok(j.suavizadas >= 1 && j.trilhas.saem === calombo && j.drc && j.drc.novas === 0 && !(j.gravacao && j.gravacao.gravado),
     `pcb_suavizar simulado: ${j.suavizadas} trecho(s), vértices ${JSON.stringify(j.vertices)}, ${j.trilhas.saem} trilhas saem / ${j.trilhas.entram} entram, DRC novas ${j.drc && j.drc.novas}` + (j.suavizadas ? '' : ': ' + JSON.stringify(j).slice(0, 500)));
  ok(fs.readFileSync(path.join(D, 'changes.js'), 'utf8') === antesS, 'a simulação não gravou');
  ({ j } = await chama('pcb_suavizar', { projeto: PROJ, nets: [NET], gravar: true }));
  ok(j.gravacao && j.gravacao.gravado, 'gravar:true grava' + (j.gravacao && j.gravacao.gravado ? '' : ': ' + JSON.stringify(j.gravacao || j).slice(0, 400)));
  const L = linhas();
  ok(L.filter(l => /"note":"calombo"/.test(l)).length === 0 && L.filter(l => /"note":"suavizar 45"/.test(l)).length === j.trilhas.entram,
     `as ${calombo} linhas do calombo saíram e entraram ${j.trilhas.entram} trilhas suavizadas`);
  ({ j } = await chama('nets_ratsnest', { projeto: PROJ }));
  ok((j.nets.find(n => n.net === NET) || { faltam: 0 }).faltam === faltam0, `${NET} continua como estava no ratsnest (${faltam0} faltando)`);
  ({ j } = await chama('pcb_validar', { projeto: PROJ }));
  ok(j.ok, 'pcb_validar passa');
  ({ j } = await chama('pcb_suavizar', { projeto: PROJ, nets: [NET] }));
  ok(j.suavizadas === 0, 'de novo: nada a suavizar');

  ok(fs.readFileSync(path.join(ORIGEM, 'board.js'), 'utf8') === realAntes, 'o projeto real não mudou');
  fs.rmSync(TMP, { recursive: true, force: true });
  if (falhou) { console.log(`test-mcp-p3 FALHOU (${falhou})`); process.exit(1); }
  console.log('test-mcp-p3 OK');
})().catch(e => { console.error(e); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
