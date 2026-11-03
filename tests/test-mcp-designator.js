/* Designator e comment pelo MCP (NexoEletric 1.57.0), numa CÓPIA de Projects/LM555 astável — o relato
   de uma sessão de IA que montou a serigrafia de uma placa:
     - pcb_editar num designator (id x…) vira designator_move (h, w, x, y, rot) e o text vira comp_attr;
       antes ia como text_edit e o motor recusava ("só textos livres");
     - hidden:true oculta o designator (o Show Designator do Altium) e some da placa efetiva; false volta;
     - campo que a op não tem (o "oculto" que a IA mandou) volta em campos_ignorados, em vez de sumir;
     - regras_casa_verificar com area e refs devolve só as violações de lá;
     - serigrafia_posicionar continua respondendo (a volta que refaz rótulo em cima de designator velho).
   node tests/test-mcp-designator.js */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'mcp', 'eletrichub-mcp.js');
const PROJ = 'LM555 astável';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eletrichub-designator-'));
const PROJETOS = path.join(TMP, 'Projects');
fs.mkdirSync(PROJETOS);
fs.cpSync(path.join(RAIZ, 'Projects', PROJ), path.join(PROJETOS, PROJ), { recursive: true });
const hc = require('../hub-core.js');
const CH = path.join(PROJETOS, PROJ, 'changes.js');
fs.writeFileSync(CH, hc.serializeChanges([]).text);
const lerChanges = () => require('../mcp/lib/arquivo-linhas.js').ArquivoLinhas.abrir('changes', CH).itens;
const board = new Function(fs.readFileSync(path.join(PROJETOS, PROJ, 'board.js'), 'utf8') + ';return pcbmirror;')();
const placaAgora = () => hc.effectiveBoard(board, hc.applyPcbChanges(board, lerChanges()));

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
    const t = setTimeout(() => falha(new Error('sem resposta a ' + method + '\n' + erro)), 120000);
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
    return { j: JSON.parse(r.result.content[0].text), texto: r.result.content[0].text, erro: !!r.result.isError };
  };
  await c.pede('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '0' } });
  c.avisa('notifications/initialized', {});
  const P = PROJ;
  const des = ref => placaAgora().texts.find(t => t.designator && t.owner === ref);

  /* ---------- pcb_editar num designator: tamanho e traço ---------- */
  const x8 = board.texts.find(t => t.id === 'x8');
  assert.strictEqual(x8.owner, 'R1');
  let r = await chama('pcb_editar', { projeto: P, id: 'x8', campos: { h: 1.2, w: 0.18 } });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  let L = lerChanges();
  assert.strictEqual(L.length, 1);
  assert.strictEqual(L[0].op, 'designator_move');
  assert.strictEqual(L[0].ref, 'R1');
  assert.strictEqual(L[0].h, 1.2);
  assert.strictEqual(L[0].w, 0.18);
  assert.strictEqual(des('R1').h, 1.2);
  assert.strictEqual(des('R1').w, 0.18);

  /* ---------- ocultar e mostrar ---------- */
  r = await chama('pcb_editar', { projeto: P, id: 'x8', campos: { hidden: true } });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  L = lerChanges();
  assert.strictEqual(L.length, 1, 'a mesma linha do designator_move: ' + JSON.stringify(L));
  assert.strictEqual(L[0].hidden, true);
  assert.strictEqual(L[0].h, 1.2, 'o tamanho de antes fica');
  assert.strictEqual(des('R1').hidden, true);
  r = await chama('pcb_editar', { projeto: P, id: 'x8', campos: { hidden: false } });
  assert.ok(r.j.ok, r.texto);
  assert.ok(!des('R1').hidden, 'hidden:false mostra de novo');

  /* ---------- o que não vale num designator ---------- */
  r = await chama('pcb_editar', { projeto: P, id: 'x8', campos: { layer: 'BottomOverlay' } });
  assert.ok(r.erro && /segue a face do componente/.test(r.texto), r.texto);

  /* ---------- o text do designator renomeia o componente (comp_attr) ---------- */
  r = await chama('pcb_editar', { projeto: P, id: 'x7', campos: { text: 'R20' }, simular: true });
  assert.ok(r.j.ok && r.j.simulado, r.texto);
  assert.ok(r.j.linhas.some(l => l.op === 'comp_attr' && /"designator":"R20"/.test(l.linha)), r.texto);

  /* ---------- campo que a op não tem ---------- */
  r = await chama('pcb_aplicar', { projeto: P, ops: [{ op: 'designator_move', ref: 'R2', x: board.texts.find(t => t.id === 'x7').x + 1, oculto: true }] });
  assert.ok(r.j.ok, r.texto);
  assert.ok(r.j.campos_ignorados && r.j.campos_ignorados.linhas.some(l => /designator_move R2: oculto/.test(l)), r.texto);
  /* e o hidden de verdade passa calado */
  r = await chama('pcb_aplicar', { projeto: P, ops: [{ op: 'designator_move', ref: 'R3', hidden: true }] });
  assert.ok(r.j.ok && !r.j.campos_ignorados, r.texto);
  assert.strictEqual(des('R3').hidden, true);

  /* ---------- regras da casa com área e refs ---------- */
  const tudo = (await chama('regras_casa_verificar', { projeto: P, limite: 5000 })).j;
  const so = (await chama('regras_casa_verificar', { projeto: P, refs: ['T1'], limite: 5000 })).j;
  assert.ok(so.filtro && so.filtro.refs[0] === 'T1', JSON.stringify(so.filtro));
  assert.ok(so.total <= tudo.total);
  for (const v of so.violacoes) {
    const refs = [v.objeto, v.contra].filter(Boolean).flatMap(o => [o.ref, o.owner]).filter(Boolean).map(x => String(x).split('.')[0]);
    assert.ok(refs.includes('T1'), 'violação de fora do T1: ' + JSON.stringify(v));
  }
  const bb = board.board.bbox;
  const nada = (await chama('regras_casa_verificar', { projeto: P, area: { x1: bb.x2 + 50, y1: bb.y2 + 50, x2: bb.x2 + 60, y2: bb.y2 + 60 } })).j;
  assert.strictEqual(nada.total, 0, 'área fora da placa não tem violação');
  r = await chama('regras_casa_verificar', { projeto: P, area: { x1: 0 } });
  assert.ok(r.erro && /area/.test(r.texto), r.texto);

  /* ---------- o posicionador continua de pé ---------- */
  r = await chama('serigrafia_posicionar', { projeto: P, todos: true });
  assert.ok(Array.isArray(r.j.posicoes) && Array.isArray(r.j.falhas), r.texto);
  assert.strictEqual(r.j.posicoes.length + r.j.falhas.length, r.j.analisados, 'cada componente ou foi posto ou falhou: ' + r.texto);

  c.fim();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-mcp-designator: ok');
})().catch(e => { console.error(e); process.exit(1); });
