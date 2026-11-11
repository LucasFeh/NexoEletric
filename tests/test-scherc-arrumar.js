/* O ARRUMAR DO DRC DO ESQUEMA (1.98.0, hub-scherc.js » arrumar e o MCP sch_arrumar).
     node tests/test-scherc-arrumar.js
   Pedido do dono: "componente desconectado às vezes é só dar uma arredadinha pro lado" — o componente que veio do
   Altium deslocado dos fios (o símbolo da biblioteca com a origem noutro lugar: os resistores do PRJ-DI221694D 50 mil
   fora). O motor arreda até os pinos encaixarem nas pontas, e recusa o que soltaria, juntaria net ou é coincidência.
   O MCP numa cópia temporária (os Projects reais nunca são gravados). */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { loadVar } = require('./load');
const HC = require('../hub-core.js');
const E = require('../hub-scherc.js');
const RAIZ = path.join(__dirname, '..');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const lib = loadVar('Libs/schlib.js', 'schlib');
const SYM = 'DIODO TVS BIDIR [SMD]';          /* 2 pinos: 1 em (-200,0), 2 em (+200,0) do componente */
ok(HC.symbolOf(lib, SYM), 'o símbolo de teste existe');
const comp = (ref, x, y, extra) => Object.assign({ t:'comp', sheet:'m', ref, sym:SYM, part:1, x, y, rot:0, mirror:false, footprint:'FP-OK' }, extra || {});
const sch = items => ({ format:'schmirror-v2', project:'PX - DI261999', units:'mil', items:[{ t:'sheet', name:'m', size:'A4' }].concat(items) });
const arr = (s, o) => E.arrumar(Object.assign({ hc:HC, schematic:s, slib:lib }, o || {}));
const soltos = s => HC.extractNets(s, lib).pinosSoltos.map(p => p.ref + '.' + p.num).sort();
const fios = () => [{ t:'wire', sheet:'m', pts:[[1200, 1000], [1800, 1000]] },                         /* D1.2 — D2.1 */
                    { t:'wire', sheet:'m', pts:[[800, 1000], [800, 1500], [2200, 1500], [2200, 1000]] }];  /* D1.1 — D2.2 */

/* ── 1. a arredadinha: D1 50 mil para a direita (o pino 2 desliza no meio do fio, o 1 fica solto) ── */
{
  const s = sch([comp('D1', 1050, 1000), comp('D2', 2000, 1000)].concat(fios()));
  eq(soltos(s), ['D1.1', 'D2.2'], 'antes: o D1.1 solto (o D1.2 liga no meio do fio), e o D2.2 sozinho na outra ponta');
  const antes = JSON.stringify(s.items);
  const r = arr(s);
  eq(r.movimentos.map(m => [m.ref, m.dx, m.dy, m.liga]), [['D1', -50, 0, ['1']]], 'arreda o D1 50 mil para a esquerda e liga o pino 1');
  eq([r.soltosAntes, r.soltosDepois], [2, 0], 'os pinos soltos: 2 → 0');
  eq(JSON.stringify(s.items), antes, 'sem aplicar: o esquema não muda');
  arr(s, { aplicar:true });
  eq([s.items[1].x, s.items[1].y], [1000, 1000], 'aplicado: o D1 no lugar');
  eq(soltos(s), [], 'nenhum pino solto');
}
/* ── 2. dois pinos soltos no mesmo vetor, longe (200 mil): vale ── */
{
  const s = sch([comp('D1', 1000, 800), comp('D2', 2000, 1000)].concat(fios()));
  const r = arr(s, { aplicar:true });
  eq(r.movimentos.map(m => [m.ref, m.dx, m.dy, m.liga.sort()]), [['D1', 0, 200, ['1', '2']]], 'D1 200 mil abaixo: os dois pinos encaixam juntos');
  eq(soltos(s), [], 'ligado');
}
/* ── 3. um pino só, longe: coincidência, não mexe ── */
{
  const s = sch([comp('D1', 1000, 1000), { t:'wire', sheet:'m', pts:[[650, 1150], [500, 1150]] }]);
  const r = arr(s);
  eq(r.movimentos, [], 'não move');
  ok(r.pulados.length === 1 && /longe|coincid/.test(r.pulados[0].motivo), 'pulado com o motivo: ' + JSON.stringify(r.pulados));
}
/* ── 4. curto: o encaixe poria os dois pinos do D3 no mesmo fio ── */
{
  const s = sch([comp('D3', 5000, 1000), { t:'wire', sheet:'m', pts:[[4850, 1000], [4850, 1300], [5250, 1300], [5250, 1000]] }]);
  const r = arr(s);
  eq(r.movimentos, [], 'não fecha os dois pinos do próprio componente');
  ok(/fecharia|curto/.test((r.pulados[0] || {}).motivo || ''), 'o motivo: ' + JSON.stringify(r.pulados));
}
/* ── 5. soltaria um pino ligado: o encaixe de +50 mil põe os dois pinos do D4 em pontas de fio, mas tira o D4.1 da
   net A (e o D5.1 ficaria sozinho) ── */
{
  const s = sch([comp('D4', 1000, 3000), comp('D5', 3000, 3000),
    { t:'wire', sheet:'m', pts:[[800, 3000], [800, 3300], [2800, 3300], [2800, 3000]] },   /* A: D4.1 — D5.1 */
    { t:'wire', sheet:'m', pts:[[850, 3000], [850, 2800]] },                              /* ponta solta */
    { t:'wire', sheet:'m', pts:[[1250, 3000], [1400, 3000]] },                            /* ponta solta */
    { t:'wire', sheet:'m', pts:[[3200, 3000], [3400, 3000]] }]);
  const r = arr(s);
  ok(!r.movimentos.some(m => m.ref === 'D4'), 'o D4 fica: ' + JSON.stringify(r.movimentos));
  ok(/soltaria|tiraria/.test((r.pulados.find(x => x.ref === 'D4') || {}).motivo || ''), 'o motivo: ' + JSON.stringify(r.pulados));
}
/* ── 6. ambíguo: o mesmo encaixe para os dois lados ── */
{
  /* rótulos de net 50 mil à esquerda dos dois pinos E 50 mil à direita: os dois encaixes ligam os dois pinos */
  const lb = (net, x) => ({ t:'netlabel', sheet:'m', net, x, y:5000, rot:0 });
  const s = sch([comp('D7', 1000, 5000), lb('A', 750), lb('B', 1150), lb('C', 850), lb('D', 1250)]);
  const r = arr(s);
  eq(r.movimentos, [], 'empate para a esquerda e para a direita: não mexe');
  ok(/ambíguo/.test((r.pulados[0] || {}).motivo || ''), 'o motivo: ' + JSON.stringify(r.pulados));
}
/* ── 7. o suprimido da variante não se mexe ── */
{
  const s = sch([comp('D1', 1050, 1000), comp('D2', 2000, 1000)].concat(fios()));
  eq(arr(s, { suprimidos:new Set(['D1']) }).movimentos, [], 'o D1 suprimido fica');
}
/* ── 8. o painel tem o botão (só com a função do chamador) ── */
{
  const src = fs.readFileSync(path.join(RAIZ, 'hub-scherc.js'), 'utf8');
  ok(/'Arrumar'/.test(src) && /opts\.arrumar/.test(src), 'o botão Arrumar no painel');
  const sf = fs.readFileSync(path.join(RAIZ, 'schframe.js'), 'utf8');
  ok(/arrumar: \(\) => ercArrumar\(\)/.test(sf) && /function ercArrumar\(\)\{[\s\S]{0,400}aplicar: true[\s\S]{0,600}commit\(\)/.test(sf), 'a vista aplica num commit (um desfazer)');
  ok(/function ercArrumar\(\)\{[\s\S]{0,200}VAR\.on/.test(sf), 'na variante não mexe');
}

/* ── 9. o MCP sch_arrumar numa cópia ── */
(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sch-arrumar-'));
  const PROJ = 'TESTE ARRUMAR';
  try {
    const DP = path.join(TMP, PROJ);
    fs.mkdirSync(DP, { recursive: true });
    const s = sch([comp('D1', 1050, 1000), comp('D2', 2000, 1000)].concat(fios()));
    fs.writeFileSync(path.join(DP, 'schematic.js'), HC.serializeSchematic(s).text);
    const pr = spawn(process.execPath, [path.join(RAIZ, 'mcp', 'eletrichub-mcp.js'), '--root', RAIZ, '--projetos', TMP], {
      stdio: ['pipe', 'pipe', 'pipe'], env: Object.assign({}, process.env, { ELETRICHUB_URL: 'http://127.0.0.1:9', NEXOHUB_URL: 'http://127.0.0.1:9' }) });
    let buf = ''; const pend = new Map(); let id = 0;
    pr.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; try { const m = JSON.parse(l); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } } catch (e) {} } });
    const rpc = (method, params) => new Promise(ok2 => { const k = ++id; pend.set(k, ok2); pr.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:k, method, params }) + '\n'); });
    const chama = async (nome, args) => { const m = await rpc('tools/call', { name:nome, arguments:args }); const t = m.result && m.result.content && m.result.content[0] && m.result.content[0].text; return { m, j: t ? JSON.parse(t) : null }; };
    try {
      await rpc('initialize', { protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{ name:'teste', version:'0' } });
      const lista = await rpc('tools/list', {});
      ok(lista.result.tools.some(t => t.name === 'sch_arrumar'), 'sch_arrumar está na lista do MCP');
      let q = await chama('sch_arrumar', { projeto: PROJ, simular: true });
      ok(q.j && q.j.simulado && q.j.movimentos.length === 1 && q.j.movimentos[0].ref === 'D1' && q.j.movimentos[0].dx === -50, 'simulado: o D1 −50 mil: ' + JSON.stringify(q.j));
      ok(/"x":1050/.test(fs.readFileSync(path.join(DP, 'schematic.js'), 'utf8')), 'simular não grava');
      q = await chama('sch_arrumar', { projeto: PROJ });
      ok(q.j && q.j.gravado, 'gravou: ' + JSON.stringify(q.j));
      eq(q.j.soltos, { antes: 2, depois: 0 }, 'soltos 2 → 0');
      const s2 = new Function(fs.readFileSync(path.join(DP, 'schematic.js'), 'utf8') + ';return schematic;')();
      eq(s2.items.find(i => i.ref === 'D1').x, 1000, 'no arquivo: o D1 em x=1000');
      eq(soltos(s2), [], 'no arquivo: nada solto');
      q = await chama('sch_arrumar', { projeto: PROJ });
      ok(q.j && q.j.movimentos.length === 0 && q.j.nota, 'de novo: nada para arrumar');
    } finally { pr.stdin.end(); try { pr.kill(); } catch (e) {} }
  } finally { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} }
  console.log('test-scherc-arrumar: ' + n + ' verificações ok');
})().catch(e => { console.error(e); process.exit(1); });
