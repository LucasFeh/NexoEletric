/* O DRC DO ESQUEMA (1.95.0, hub-scherc.js): as regras, a severidade, a variante, o desenho na tela e o MCP sch_erc.
     node tests/test-scherc.js
   Numa cópia temporária para o MCP (os Projects reais nunca são gravados). */
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
const comp = (ref, x, extra) => Object.assign({ t:'comp', sheet:'m', ref, sym:SYM, part:1, x, y:1000, rot:0, mirror:false, footprint:'FP-OK' }, extra || {});
const sch = items => ({ format:'schmirror-v2', project:'PX - DI261999', units:'mil', items:[{ t:'sheet', name:'m', size:'A4' }].concat(items) });
const roda = (s, o) => E.rodar(Object.assign({ hc:HC, schematic:s, slib:lib, footprintExiste: nome => nome === 'FP-OK' }, o || {}));
const regras = r => r.violacoes.map(v => v.regra);

/* ── 1. o esquema limpo: D1 e D2 ligados pelos dois pinos ── */
const limpo = sch([comp('D1', 1000), comp('D2', 2000),
  { t:'wire', sheet:'m', pts:[[1200, 1000], [1800, 1000]] },
  { t:'wire', sheet:'m', pts:[[800, 1000], [800, 1500], [2200, 1500], [2200, 1000]] }]);
let r = roda(limpo);
eq([r.total, r.erros, r.avisos], [0, 0, 0], 'nada errado: ' + r.violacoes.map(v => v.msg).join(' | '));

/* ── 2. pino desconectado (o triângulo), No ERC e pino NC ── */
const solto = sch([comp('D1', 1000), comp('D2', 2000), { t:'wire', sheet:'m', pts:[[1200, 1000], [1800, 1000]] }]);
r = roda(solto);
const ps = r.violacoes.filter(v => v.regra === 'pino-solto');
eq(ps.map(v => [v.ref, v.pino, v.x, v.y, v.sev]).sort(), [['D1', '1', 800, 1000, 'aviso'], ['D2', '2', 2200, 1000, 'aviso']], 'os dois pinos soltos, na ponta, como aviso');
r = roda(sch(solto.items.slice(1).concat([{ t:'noerc', sheet:'m', x:800, y:1000 }])));
eq(r.violacoes.filter(v => v.regra === 'pino-solto').map(v => v.ref), ['D2'], 'No ERC na ponta: de propósito');
ok(E.ehNC('NC') && E.ehNC('N.C.') && E.ehNC('nc') && !E.ehNC('NCS'), 'o pino chamado NC');

/* ── 3. fora do almoxarifado (a regra injetada) e a variante ── */
r = roda(limpo, { foraDoAlmox: c => c.ref === 'D2', caixaDoComp: c => ({ x1:c.x - 250, y1:c.y - 100, x2:c.x + 250, y2:c.y + 100 }) });
const fa = r.violacoes.filter(v => v.regra === 'fora-almox');
eq(fa.map(v => [v.ref, v.sev, v.x, v.y]), [['D2', 'erro', 2000, 1000]], 'D2 fora do almoxarifado, erro, no centro da caixa');
ok(fa[0].caixa && fa[0].caixa.x1 === 1750, 'com a caixa (o contorno vermelho)');
r = roda(solto, { foraDoAlmox: c => c.ref === 'D2', suprimidos: new Set(['D2']) });
eq(regras(r).sort(), ['pino-solto'], 'D2 suprimido na variante: nem fora do almoxarifado nem pino solto dele');
eq(r.violacoes[0].ref, 'D1', 'só o D1');

/* ── 4. designador duplicado e não numerado ── */
r = roda(sch([comp('D1', 1000), comp('D1', 3000), comp('R?', 5000),
  { t:'wire', sheet:'m', pts:[[1200, 1000], [2800, 1000]] }, { t:'wire', sheet:'m', pts:[[800, 1000], [800, 1500], [3200, 1500], [3200, 1000]] }]));
eq(r.violacoes.filter(v => v.regra === 'ref-duplicado').length, 2, 'as duas cópias do D1');
eq(r.violacoes.filter(v => v.regra === 'ref-sem-numero').map(v => v.ref), ['R?'], 'o R?');
ok(r.violacoes.slice(0, r.erros).every(v => v.sev === 'erro'), 'os erros vêm primeiro');

/* ── 5. footprint: sem e inexistente ── */
r = roda(sch([comp('D1', 1000, { footprint:'' }), comp('D2', 2000, { footprint:'NAO-EXISTE' }),
  { t:'wire', sheet:'m', pts:[[1200, 1000], [1800, 1000]] }, { t:'wire', sheet:'m', pts:[[800, 1000], [800, 1500], [2200, 1500], [2200, 1000]] }]));
eq(r.violacoes.filter(v => v.regra === 'sem-footprint').map(v => [v.ref, v.sev]), [['D1', 'aviso']], 'D1 sem footprint (aviso)');
eq(r.violacoes.filter(v => v.regra === 'footprint-inexistente').map(v => [v.ref, v.sev]), [['D2', 'erro']], 'D2 com footprint fora da PcbLib (erro)');

/* ── 6. net com um pino só, rótulo/port solto ── */
r = roda(sch([comp('D1', 1000), comp('D2', 2000), { t:'wire', sheet:'m', pts:[[1200, 1000], [1800, 1000]] },
  { t:'wire', sheet:'m', pts:[[800, 1000], [600, 1000]] }, { t:'netlabel', sheet:'m', net:'SDA', x:600, y:1000, rot:0 },
  { t:'wire', sheet:'m', pts:[[2200, 1000], [2400, 1000]] }, { t:'port', sheet:'m', net:'SCL', x:2400, y:1000, style:2, w:400 },
  { t:'port', sheet:'m', net:'SOLTA', x:5000, y:5000, w:400 }]));
const um = r.violacoes.filter(v => v.regra === 'net-um-pino');
ok(um.some(v => v.net === 'SDA' && v.x === 800 && v.y === 1000), 'a net SDA liga só o D1.1 (no pino): ' + JSON.stringify(um));
ok(um.some(v => v.net === 'SCL'), 'a port SCL liga um pino só');
ok(um.some(v => v.net === 'SOLTA' && /port SOLTA está solto/.test(v.msg) && v.x === 5000), 'a port solta');
ok(!r.violacoes.some(v => v.regra === 'pino-solto'), 'pino com rótulo não é "desconectado"');

/* ── 7. projeto não definido e os avisos do botão Parâmetros ── */
r = roda(limpo, { projetoNaoDefinido: true, avisosDoComp: c => c.ref === 'D1' ? [{ t:'Desenho: emprestado', nivel:'warn' }, { t:'Acervo: pendente', nivel:'err' }] : [] });
eq(r.violacoes.filter(v => v.regra === 'projeto-nao-definido').map(v => [v.sev, v.x]), [['erro', null]], 'projeto não definido (sem lugar)');
eq(r.violacoes.filter(v => v.regra === 'componente').map(v => [v.ref, v.sev]).sort(), [['D1', 'aviso'], ['D1', 'erro']], 'os avisos do Parâmetros, com o nível deles');
eq(r.porRegra.map(c => c.regra), ['projeto-nao-definido', 'componente'], 'o resumo por regra');
/* severidade trocada pelo chamador */
r = roda(solto, { severidades: { 'pino-solto': 'erro' } });
ok(r.violacoes.every(v => v.sev === 'erro') && r.erros === 2, 'severidade configurável');

/* ── 8. o desenho na tela ── */
const log = [];
const ctx = { save(){}, restore(){}, beginPath(){}, moveTo(){}, lineTo(){}, closePath(){}, arc(){}, translate(){}, scale(){}, setLineDash(){},
  fill(){ log.push(['fill', this.fillStyle]); }, stroke(){ log.push(['stroke', this.strokeStyle]); }, fillRect(){ log.push(['rect', this.fillStyle]); },
  strokeRect(){ log.push(['srect', this.strokeStyle]); }, fillText(t){ log.push(['text', t]); }, measureText(t){ return { width: t.length * 10 }; } };
E.triangulo(ctx, 800, 1000, 2);
ok(log.some(l => l[0] === 'fill' && l[1] === '#facc15'), 'o triângulo amarelo');
log.length = 0;
E.foraDoAlmox(ctx, { x1:0, y1:0, x2:500, y2:200 }, 2);
ok(log.some(l => l[0] === 'srect' && l[1] === '#ef4444') && log.some(l => l[0] === 'text' && l[1] === 'fora do almoxarifado'), 'o contorno vermelho e a etiqueta');

/* ── 9. o MCP sch_erc ── */
(async () => {
  const PROJ = 'LM555 astável';
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nexoeletric-erc-'));
  const PROJETOS = path.join(TMP, 'Projects');
  fs.mkdirSync(PROJETOS);
  fs.cpSync(path.join(RAIZ, 'Projects', PROJ), path.join(PROJETOS, PROJ), { recursive: true });
  fs.writeFileSync(path.join(PROJETOS, PROJ, 'changes.js'), HC.serializeChanges([]).text);
  const pr = spawn(process.execPath, [path.join(RAIZ, 'mcp', 'eletrichub-mcp.js'), '--root', RAIZ, '--projetos', PROJETOS], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', erro = '', id = 0;
  const espera = new Map();
  pr.stdout.setEncoding('utf8');
  pr.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; const m = JSON.parse(l); const w = espera.get(m.id); if (w) { espera.delete(m.id); w(m); } } });
  pr.stderr.on('data', d => { erro += d; });
  const pede = (method, params) => new Promise((res, rej) => { const k = ++id; const t = setTimeout(() => rej(new Error('sem resposta ' + method + '\n' + erro)), 120000); espera.set(k, m => { clearTimeout(t); res(m); }); pr.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:k, method, params }) + '\n'); });
  const chama = async (name, args) => { const q = await pede('tools/call', { name, arguments: args }); assert.ok(q.result, name + ': ' + JSON.stringify(q.error)); return { j: JSON.parse(q.result.content[0].text), texto: q.result.content[0].text, erro: !!q.result.isError }; };
  try {
    await pede('initialize', { protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{ name:'teste', version:'0' } });
    pr.stdin.write(JSON.stringify({ jsonrpc:'2.0', method:'notifications/initialized', params:{} }) + '\n');
    let q = await chama('sch_erc', { projeto: PROJ });
    ok(!q.erro && typeof q.j.erros === 'number' && Array.isArray(q.j.violacoes), 'sch_erc responde: ' + q.texto.slice(0, 200));
    ok(q.j.violacoes.some(v => v.regra === 'projeto-nao-definido'), 'o LM555 não tem o código da placa');
    /* um pino solto de propósito: apaga um fio e confere */
    await chama('sch_adicionar', { projeto: PROJ, itens: [{ t:'comp', sym:SYM, x:9000, y:6000, ref:'D90', footprint:'' }] });
    q = await chama('sch_erc', { projeto: PROJ, regras: ['pino-solto', 'sem-footprint'] });
    ok(q.j.violacoes.filter(v => v.ref === 'D90' && v.regra === 'pino-solto').length === 2, 'o D90 novo tem os dois pinos soltos');
    ok(q.j.violacoes.some(v => v.ref === 'D90' && v.regra === 'sem-footprint'), 'e está sem footprint');
    ok(q.j.violacoes.every(v => v.regra === 'pino-solto' || v.regra === 'sem-footprint'), 'o filtro de regras');
    q = await chama('sch_erc', { projeto: PROJ, regras: ['pino-solto'], suprimidos: ['D90'] });
    ok(!q.j.violacoes.some(v => v.ref === 'D90'), 'suprimido: não conta');
  } finally {
    pr.stdin.end(); try { pr.kill(); } catch (e) {}
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('test-scherc: ' + n + ' verificações ok');
})().catch(e => { console.error(e); process.exit(1); });
