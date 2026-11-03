/* Não montar (DNP) pelo MCP (NexoEletric 1.58.0), numa CÓPIA de Projects/LM555 astável:
     - sch_nao_montar marca todas as partes do ref (dnp:true no schematic.js) e desmarca (dnp:false);
     - sch_componentes diz dnp:true; sch_editar recusa dnp que não é booleano;
     - bom_listar (da placa e do esquema) deixa o marcado de fora e o devolve em nao_montar.
   node tests/test-mcp-dnp.js */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'mcp', 'eletrichub-mcp.js');
const PROJ = 'LM555 astável';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eletrichub-dnp-'));
const PROJETOS = path.join(TMP, 'Projects');
fs.mkdirSync(PROJETOS);
fs.cpSync(path.join(RAIZ, 'Projects', PROJ), path.join(PROJETOS, PROJ), { recursive: true });
const hc = require('../hub-core.js');
const CH = path.join(PROJETOS, PROJ, 'changes.js');
fs.writeFileSync(CH, hc.serializeChanges([]).text);

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
  const SCH = path.join(PROJETOS, PROJ, 'schematic.js');
  const lerSch = () => new Function(fs.readFileSync(SCH, 'utf8') + ';return schematic;')();
  const refsBom = j => j.linhas.flatMap(l => l.refs);

  let r = await chama('bom_listar', { projeto: P });
  assert.ok(refsBom(r.j).includes('R1') && !r.j.nao_montar, r.texto);

  /* ---------- marcar ---------- */
  r = await chama('sch_nao_montar', { projeto: P, refs: ['R1', 'C2'] });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  assert.deepStrictEqual(r.j.mudaram.sort(), ['C2', 'R1']);
  assert.ok(lerSch().items.filter(it => it.t === 'comp' && (it.ref === 'R1' || it.ref === 'C2')).every(it => it.dnp === true));
  assert.ok(/"dnp":true/.test(fs.readFileSync(SCH, 'utf8')));
  r = await chama('sch_nao_montar', { projeto: P, refs: ['R1'] });
  assert.ok(r.j.ok && !r.j.mudaram.length && /já estavam/.test(r.j.nota), r.texto);
  r = await chama('sch_nao_montar', { projeto: P, refs: ['R99'] });
  assert.ok(r.erro && /R99/.test(r.texto), r.texto);

  /* ---------- quem lê ---------- */
  r = await chama('sch_componentes', { projeto: P, refs: ['R1', 'R2'], pinos: 'nenhum' });
  const porRef = Object.fromEntries(r.j.componentes.map(x => [x.ref, x]));
  assert.strictEqual(porRef.R1.dnp, true);
  assert.ok(!porRef.R2.dnp);
  for (const fonte of ['placa', 'esquema']) {
    r = await chama('bom_listar', { projeto: P, fonte });
    assert.ok(!refsBom(r.j).includes('R1') && !refsBom(r.j).includes('C2'), fonte + ': ' + r.texto);
    assert.deepStrictEqual(r.j.nao_montar, ['C2', 'R1'], fonte);
  }

  /* ---------- sch_editar ---------- */
  r = await chama('sch_editar', { projeto: P, ref: 'R2', campos: { dnp: 'sim' } });
  assert.ok(r.erro && /dnp deve ser true/.test(r.texto), r.texto);

  /* ---------- desmarcar ---------- */
  r = await chama('sch_nao_montar', { projeto: P, refs: ['R1', 'C2'], dnp: false });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  assert.ok(!/"dnp"/.test(fs.readFileSync(SCH, 'utf8')), 'dnp:false some do arquivo');
  r = await chama('bom_listar', { projeto: P });
  assert.ok(refsBom(r.j).includes('R1') && !r.j.nao_montar, r.texto);

  c.fim();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-mcp-dnp: ok');
})().catch(e => { console.error(e); process.exit(1); });
