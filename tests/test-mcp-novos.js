/* Objetos e componentes criados pelo changes.js, pelo MCP (NexoEletric 1.49.0), numa CÓPIA de
   Projects/LM555 astável (os Projects reais nunca são gravados) — pedido de uma sessão de IA que
   montou a PCB1:
     - pcb_apagar/pcb_editar aceitam os ids "new-…" que o pcb_consultar mostra (trilha, via, texto);
     - o id do objeto acrescentado não muda quando outra linha sai (uid na linha *_add);
     - componente de comp_add: pcb_mover/pcb_mover_lote editam a linha dele, pcb_apagar refs a tira, e o
       comp_move/designator_move antigos que vinham depois dela são juntados nela;
     - o componente que saiu por comp_del e voltou por comp_add com o mesmo nome;
     - comp_attr num componente de comp_add;
     - pcb_mudancas com filtros; resposta resumida de lote grande;
     - regras_definir: a prioridade pedida vence o empate;
     - regras_casa_verificar: o parafuso da ÁREA vale no furo dela.
   node tests/test-mcp-novos.js */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'mcp', 'eletrichub-mcp.js');
const PROJ = 'LM555 astável';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eletrichub-novos-'));
const PROJETOS = path.join(TMP, 'Projects');
fs.mkdirSync(PROJETOS);
fs.cpSync(path.join(RAIZ, 'Projects', PROJ), path.join(PROJETOS, PROJ), { recursive: true });
const hc = require('../hub-core.js');
const CH = path.join(PROJETOS, PROJ, 'changes.js');
fs.writeFileSync(CH, hc.serializeChanges([]).text);
const lerChanges = () => require('../mcp/lib/arquivo-linhas.js').ArquivoLinhas.abrir('changes', CH).itens;

function cliente() {
  const p = spawn(process.execPath, [SCRIPT, '--root', RAIZ, '--projetos', PROJETOS], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', erro = '', id = 0;
  const espera = new Map();
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!l.trim()) continue;
      const m = JSON.parse(l); const w = espera.get(m.id); if (w) { espera.delete(m.id); w(m); }
    }
  });
  p.stderr.on('data', d => { erro += d; });
  const pede = (method, params) => new Promise((ok, falha) => {
    const n = ++id;
    const t = setTimeout(() => falha(new Error('sem resposta a ' + method + '\n' + erro)), 60000);
    espera.set(n, m => { clearTimeout(t); ok(m); });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  });
  return { p, pede, avisa: (method, params) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'), fim: () => p.stdin.end() };
}

(async () => {
  const c = cliente();
  const chama = async (name, args) => {
    const r = await c.pede('tools/call', { name, arguments: args });
    assert.ok(r.result, name + ': ' + JSON.stringify(r.error));
    return { j: JSON.parse(r.result.content[0].text), texto: r.result.content[0].text };
  };
  await c.pede('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '0' } });
  c.avisa('notifications/initialized', {});
  const P = PROJ;
  const idsNaCaixa = async (tipo, x1, y1, x2, y2) => (await chama('pcb_consultar', { projeto: P, tipo, caixa: { x1, y1, x2, y2 } })).j.itens.map(o => o.id);

  /* ---------- trilha, via e texto criados: apagar e editar pelo id "new-…" ---------- */
  let r = await chama('pcb_aplicar', { projeto: P, ops: [
    { op: 'track_add', layer: 'Bottom', x1: 70, y1: 20, x2: 72, y2: 20, w: 0.3, net: 'GND' },
    { op: 'track_add', layer: 'Bottom', x1: 70, y1: 22, x2: 72, y2: 22, w: 0.3, net: 'GND' },
    { op: 'via_add', x: 70, y: 25, size: 0.8, drill: 0.4, net: 'GND' },
    { op: 'text_add', layer: 'TopOverlay', text: 'Rev. B', x: 71, y: 28, h: 1 },
  ] });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  assert.ok(lerChanges().every(x => /^u[a-z0-9]+$/.test(x.uid)), 'cada *_add ganhou um uid: ' + JSON.stringify(lerChanges()));
  const [t1] = await idsNaCaixa('trilhas', 69, 19.5, 73, 20.5);
  const [t2] = await idsNaCaixa('trilhas', 69, 21.5, 73, 22.5);
  const [v1] = await idsNaCaixa('vias', 69, 24, 71, 26);
  const [x1] = await idsNaCaixa('textos', 69, 27, 73, 29);
  assert.ok([t1, t2, v1, x1].every(id => /^new-[tvx]u/.test(id)), [t1, t2, v1, x1].join(' '));

  r = await chama('pcb_apagar', { projeto: P, ids: [t1, v1] });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  assert.strictEqual(lerChanges().length, 2, 'as linhas da trilha e da via saíram');
  assert.deepStrictEqual(await idsNaCaixa('trilhas', 69, 21.5, 73, 22.5), [t2], 'o id da outra trilha não mudou');

  r = await chama('pcb_editar', { projeto: P, id: t2, campos: { w: 0.5, y1: 23, y2: 23 } });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  let ln = lerChanges().find(x => x.op === 'track_add');
  assert.ok(ln.w === 0.5 && ln.y1 === 23 && !('orig_w' in ln), 'a linha track_add foi editada: ' + JSON.stringify(ln));
  r = await chama('pcb_editar', { projeto: P, id: x1, campos: { text: 'Rev. C' } });
  assert.ok(r.j.ok && lerChanges().find(x => x.op === 'text_add').text === 'Rev. C', r.texto);
  r = await chama('pcb_apagar', { projeto: P, ids: ['new-tzz9'] });
  assert.ok(r.j.ok === false && /new-tzz9/.test(r.j.erro), r.texto);

  /* ---------- componente de comp_add ---------- */
  r = await chama('pcb_colocar', { projeto: P, ref: 'J9', footprint: 'RES 1206', x: 70, y: 40 });
  assert.ok(r.j.gravado, r.texto);
  r = await chama('pcb_aplicar', { projeto: P, ops: [{ op: 'designator_move', ref: 'J9', x: 70, y: 42 }] });
  assert.ok(r.j.ok, r.texto);
  r = await chama('pcb_mover', { projeto: P, ref: 'J9', dx: 1 });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  let J = lerChanges().filter(x => x.ref === 'J9');
  assert.deepStrictEqual(J.map(x => x.op), ['comp_add'], 'mover e o designator ficam na linha do comp_add');
  assert.ok(J[0].x === 71 && Math.abs(J[0].des_x - 71) < 1e-6 && Math.abs(J[0].des_y - 42) < 1e-6, JSON.stringify(J[0]));
  r = await chama('pcb_aplicar', { projeto: P, ops: [{ op: 'comp_attr', ref: 'J9', designator: 'J10', comment: 'jumper' }] });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  J = lerChanges().filter(x => x.op === 'comp_add');
  assert.ok(J.length === 1 && J[0].ref === 'J10' && J[0].comment === 'jumper', JSON.stringify(J));
  r = await chama('pcb_apagar', { projeto: P, refs: ['J10'] });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  assert.ok(!lerChanges().some(x => x.ref === 'J10' || x.ref === 'J9'), 'o comp_add saiu');

  /* o que a vista e MCPs antigos escreviam: comp_add + comp_move + designator_move em linhas próprias */
  const antigas = lerChanges().concat([
    { op: 'comp_add', ref: 'J5', footprint: 'RES 1206', x: 70, y: 50, rot: 0, layer: 'Top' },
    { op: 'comp_move', ref: 'J5', x: 71, y: 50, rot: 0, layer: 'Top', orig_x: 70, orig_y: 50, orig_rot: 0, orig_layer: 'Top' },
  ]);
  fs.writeFileSync(CH, hc.serializeChanges(antigas).text);
  r = await chama('pcb_mover_lote', { projeto: P, movimentos: [{ ref: 'J5', dy: 2 }], checar: false });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  J = lerChanges().filter(x => x.ref === 'J5');
  assert.deepStrictEqual(J.map(x => x.op), ['comp_add'], 'a comp_move antiga foi juntada: ' + JSON.stringify(J));
  assert.ok(J[0].x === 71 && J[0].y === 52, JSON.stringify(J[0]));

  /* o componente do board.js que saiu por comp_del e voltou por comp_add com o mesmo nome */
  r = await chama('pcb_aplicar', { projeto: P, ops: [{ op: 'comp_del', ref: 'R1' }, { op: 'comp_add', ref: 'R1', footprint: 'RES 1206', x: 90.2, y: 47.4, rot: 0, layer: 'Top' }] });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  r = await chama('pcb_mover_lote', { projeto: P, movimentos: [{ ref: 'R1', dx: 0.5 }], checar: false });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  const R1 = lerChanges().filter(x => x.ref === 'R1');
  assert.deepStrictEqual(R1.map(x => x.op), ['comp_del', 'comp_add'], 'o comp_del ficou intacto e o comp_add andou');
  assert.ok(Math.abs(R1[1].x - 90.7) < 1e-6, JSON.stringify(R1));
  r = await chama('pcb_aplicar', { projeto: P, ops: [{ op: 'designator_move', ref: 'R1', x: 90.7, y: 49 }] });
  assert.ok(r.j.ok && !lerChanges().some(x => x.op === 'designator_move' && x.ref === 'R1'), 'o designator vai para des_* do comp_add: ' + r.texto);
  assert.strictEqual(lerChanges().find(x => x.op === 'comp_add' && x.ref === 'R1').des_y, 49);
  r = await chama('pcb_resumo', { projeto: P });
  assert.strictEqual(r.j.validacao.erros, 0, JSON.stringify(r.j.validacao));

  /* ---------- pcb_mudancas com filtros ---------- */
  r = await chama('pcb_mudancas', { projeto: P, ref: 'R1', curto: true });
  assert.deepStrictEqual(r.j.mudancas.map(x => x.op), ['comp_del', 'comp_add']);
  r = await chama('pcb_mudancas', { projeto: P, id: t2 });
  assert.ok(r.j.total === 1 && r.j.mudancas[0].id_na_placa === t2, r.texto);
  r = await chama('pcb_mudancas', { projeto: P, op: 'comp_', caixa: { x1: 69, y1: 45, x2: 75, y2: 55 } });
  assert.deepStrictEqual(r.j.mudancas.map(x => x.op.ref), ['J5']);

  /* ---------- lote grande: resposta resumida ---------- */
  const muitas = [];
  for (let i = 0; i < 45; i++) muitas.push({ op: 'track_add', layer: 'Bottom', x1: 60, y1: 10 + i * 0.5, x2: 62, y2: 10 + i * 0.5, w: 0.2, net: '' });
  r = await chama('pcb_aplicar', { projeto: P, ops: muitas, simular: true });
  assert.ok(r.j.ok && r.j.linhas_total === 45 && r.j.linhas.length <= 40 && r.j.linhas_por_op.track_add === 45, r.texto.slice(0, 400));

  /* ---------- regras_definir: a prioridade pedida vence o empate ---------- */
  r = await chama('regras_ler', { projeto: P, tipo: 'HoleSize' });
  const hs = (r.j.regras || r.j.rules || []).filter(x => (x.kind || x.tipo) === 'HoleSize');
  r = await chama('regras_definir', { projeto: P, regras: [{ kind: 'HoleSize', name: 'HoleSize_M3', scope1: "InComponent('MH1')", priority: 1, min: 0.3, max: 3.5 }] });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  const pr = r.j.prioridades.find(x => x.name === 'HoleSize_M3');
  assert.strictEqual(pr.priority, 1, 'a regra nova ficou com a prioridade pedida: ' + JSON.stringify(r.j.prioridades) + ' (antes: ' + hs.length + ')');
  assert.ok(r.j.prioridades.filter(x => x.name !== 'HoleSize_M3').every(x => x.priority > 1));

  /* ---------- regras da casa: o parafuso da área vale no furo dela ---------- */
  r = await chama('regras_casa_definir', { projeto: P, areas: [{ nome: 'furo isolado 1 mm', caixa: { x1: 74, y1: 58, x2: 80, y2: 63 }, parametros: { parafuso: 1 } }] });
  assert.ok(r.j.gravado, r.texto);
  r = await chama('regras_casa_verificar', { projeto: P, regras: ['parafuso'], furos: [[77, 60.5, 3.4], [88, 33, 3.4]] });
  const fs2 = r.j.furos_parafuso;
  const lado = f => Math.round((f.quadrado.x2 - f.quadrado.x1) * 1000) / 1000;
  assert.strictEqual(lado(fs2.find(f => f.x === 77)), 5.4, 'na área: furo + 1 mm de cada lado: ' + JSON.stringify(fs2));
  assert.strictEqual(lado(fs2.find(f => f.x === 88)), 9.4, 'fora da área: furo + 3 mm');

  c.fim();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-mcp-novos: ok');
})().catch(e => { console.error(e); process.exit(1); });
