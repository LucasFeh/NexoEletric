/* Mover levando as trilhas, teardrops que acompanham e a colisão pelo cobre (NexoEletric 1.51.0),
   pedidos por uma sessão de IA que montou a PCB1 (descer o ESP32 2 mm soltou 30 trilhas; teardrops do
   hub órfãos barravam via nova; o IND IFDC2525 "colidia" com o D3 pela caixa do footprint):
     - pcb_mover trilhas:"arrastar" estica as trilhas presas nos pads, e a placa continua ligada;
       "apagar" tira as trilhas; "deixar" (padrão) avisa;
     - o teardrop do hub que perde a trilha/via sai sozinho e volta onde o par ainda existe;
     - hub-posiciona: a colisão pela caixa do cobre e da serigrafia (caixa:"componente" = a de antes).
   Numa CÓPIA de Projects/LM555 astável (os Projects reais nunca são gravados).
   node tests/test-mcp-arrasta.js */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'mcp', 'eletrichub-mcp.js');
const PROJ = 'LM555 astável';
const hc = require('../hub-core.js');

/* ---------- a colisão pelo cobre, pura ---------- */
{
  const PS = require('../hub-posiciona.js');
  const comp = (ref, x) => ({ ref, x, y: 0, layer: 'Top', bbox: { x1: x - 6, y1: -6, x2: x + 6, y2: 6 },
    pads: [{ name: '1', x: x - 2, y: 0, w: 1.5, h: 2, rot: 0 }, { name: '2', x: x + 2, y: 0, w: 1.5, h: 2, rot: 0 }] });
  const eb = { board: { bbox: { x1: -20, y1: -20, x2: 40, y2: 20 }, outline: [] }, components: [comp('L1', 0), comp('D3', 9)],
               silk: [{ owner: 'L1', x1: -3, y1: -1.5, x2: 3, y2: -1.5, w: 0.15 }] };
  const cobre = PS.confere(eb, { folga: 0.25 }), caixa = PS.confere(eb, { folga: 0.25, caixa: 'componente' });
  assert.strictEqual(caixa.colisoes.length, 1, 'pela caixa inteira do footprint as duas se sobrepõem');
  assert.strictEqual(cobre.colisoes.length, 0, 'pelo cobre e pela serigrafia há 4,25 mm entre elas: ' + JSON.stringify(cobre.colisoes));
  eb.components[1] = comp('D3', 4.5);
  assert.strictEqual(PS.confere(eb, { folga: 0.25 }).colisoes.length, 1, 'pads a 0,25 mm de distância colidem');
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eletrichub-arrasta-'));
const PROJETOS = path.join(TMP, 'Projects');
fs.mkdirSync(PROJETOS);
fs.cpSync(path.join(RAIZ, 'Projects', PROJ), path.join(PROJETOS, PROJ), { recursive: true });
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
    return { j: JSON.parse(r.result.content[0].text), texto: r.result.content[0].text };
  };
  await c.pede('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '0' } });
  c.avisa('notifications/initialized', {});
  const P = PROJ;
  const abertas = async () => (await chama('nets_ratsnest', { projeto: P })).j.ligacoes_faltando;
  assert.strictEqual(await abertas(), 0, 'a placa começa ligada');

  /* ---------- deixar (padrão): avisa ---------- */
  let r = await chama('pcb_mover', { projeto: P, ref: 'R1', dx: 1, simular: true });
  assert.ok(r.j.ok && !r.j.trilhas, r.texto.slice(0, 400));

  /* ---------- arrastar: as trilhas esticam e a placa continua ligada ---------- */
  const antes = (await chama('pcb_componente', { projeto: P, ref: 'R1' })).j;
  assert.ok(antes.trilhas_nos_pads.length >= 2, 'R1 tem trilhas: ' + JSON.stringify(antes.trilhas_nos_pads));
  r = await chama('pcb_mover', { projeto: P, ref: 'R1', dy: -1, trilhas: 'arrastar' });
  assert.ok(r.j.ok && r.j.gravado, r.texto.slice(0, 600));
  assert.strictEqual(r.j.trilhas.arrastadas, antes.trilhas_nos_pads.length, JSON.stringify(r.j.trilhas));
  /* a g36 do Altium (região em cima da t33, que não é teardrop reconhecido) fica no lugar e é avisada;
     é ela a única ligação aberta depois do arrasto */
  const ficaram = new Set(r.j.trilhas.regioes_que_ficaram || []);
  assert.ok(ficaram.size, JSON.stringify(r.j.trilhas));
  const rats = (await chama('nets_ratsnest', { projeto: P })).j;
  const pontas = [].concat(...rats.nets.map(n => n.ligacoes || [])).map(l => [l.de, l.para]);
  assert.ok(pontas.every(par => par.some(q => q && q.tipo === 'region' && ficaram.has(String(q.id)))),
    'toda ligação aberta é com uma região avisada em regioes_que_ficaram: ' + JSON.stringify(rats).slice(0, 400) + ' / ' + [...ficaram]);
  const base = rats.ligacoes_faltando;   /* o LM555 é espelho antigo: a g36 não se apaga pelo changes.js */
  const depois = (await chama('pcb_componente', { projeto: P, ref: 'R1' })).j;
  const ids1 = new Set(depois.trilhas_nos_pads.map(t => t.id));
  assert.ok(antes.trilhas_nos_pads.every(t => ids1.has(t.id)), 'as trilhas de antes chegam nos pads novos: ' + [...ids1].join(' '));
  assert.ok(lerChanges().some(x => x.op === 'track_edit'), 'track_edit com os orig_* do board.js');

  /* ---------- arrastar de novo a mesma peça: a linha track_edit é editada, não empilhada ---------- */
  const nEd = lerChanges().filter(x => x.op === 'track_edit').length;
  r = await chama('pcb_mover', { projeto: P, ref: 'R1', dy: -0.5, trilhas: 'arrastar' });
  assert.ok(r.j.ok && r.j.gravado, r.texto.slice(0, 600));
  assert.strictEqual(lerChanges().filter(x => x.op === 'track_edit').length, nEd);
  assert.strictEqual(await abertas(), base, 'nada mais se soltou');

  /* ---------- apagar ---------- */
  const r2 = (await chama('pcb_componente', { projeto: P, ref: 'R2' })).j;
  r = await chama('pcb_mover_lote', { projeto: P, movimentos: [{ ref: 'R2', dx: 1 }], trilhas: 'apagar', checar: false });
  assert.ok(r.j.ok && r.j.gravado, r.texto.slice(0, 600));
  assert.strictEqual(r.j.trilhas.apagadas, r2.trilhas_nos_pads.length);
  assert.strictEqual(lerChanges().filter(x => x.op === 'track_del').length, r2.trilhas_nos_pads.length);

  /* ---------- teardrops do hub acompanham ---------- */
  /* o LM555 já tem as gotas do Altium: uma trilha fina nova num pad do C1 ganha a gota do hub */
  const C1 = (await chama('pcb_componente', { projeto: P, ref: 'C1' })).j;
  const pd = C1.pads[0];
  r = await chama('pcb_aplicar', { projeto: P, ops: [{ op: 'track_add', layer: pd.layer === 'Multi' ? 'Bottom' : pd.layer, x1: pd.x, y1: pd.y, x2: pd.x, y2: pd.y - 4, w: 0.2, net: pd.net }] });
  assert.ok(r.j.ok, r.texto.slice(0, 400));
  r = await chama('teardrop_aplicar', { projeto: P });
  assert.ok(r.j.ok && r.j.postos > 0, r.texto.slice(0, 400));
  const nTd = () => lerChanges().filter(x => x.op === 'region_add' && /^teardrop/.test(x.note || '')).length;
  const td0 = nTd();
  r = await chama('pcb_mover', { projeto: P, ref: 'C1', dx: -0.8, trilhas: 'arrastar' });
  assert.ok(r.j.ok && r.j.gravado, r.texto.slice(0, 600));
  assert.ok(r.j.teardrops && r.j.teardrops.tirados > 0 && r.j.teardrops.refeitos > 0, 'a gota do C1 saiu e voltou no lugar novo: ' + JSON.stringify(r.j.teardrops));
  assert.strictEqual(nTd(), td0 - r.j.teardrops.tirados + r.j.teardrops.refeitos);
  /* apagar a trilha nova: a gota dela sai e não volta */
  const nova = (await chama('pcb_mudancas', { projeto: P, op: 'track_add', curto: true })).j.mudancas[0].id;
  const td1 = nTd();
  r = await chama('pcb_apagar', { projeto: P, ids: [nova] });
  assert.ok(r.j.ok && r.j.gravado && r.j.teardrops && r.j.teardrops.tirados > 0 && !r.j.teardrops.refeitos, r.texto.slice(0, 600));
  assert.ok(nTd() < td1, 'a gota da trilha apagada saiu');
  r = await chama('pcb_resumo', { projeto: P });
  assert.strictEqual(r.j.validacao.erros, 0, JSON.stringify(r.j.validacao));

  c.fim();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-mcp-arrasta: ok');
})().catch(e => { console.error(e); process.exit(1); });
