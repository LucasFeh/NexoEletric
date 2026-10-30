/* Validação do esquema e as ferramentas de esquema do MCP (NexoEletric 1.47.0), pedidas por uma
   sessão de IA que montou uma placa (2026-10-29):
     - pino sem ligação e ponta de fio solta (No ERC = de propósito);
     - pad do footprint sem pino no símbolo (a aba térmica do DDPAK-5);
     - símbolo que só casa trocando maiúsculas ("Varistor" -> "VARISTOR");
     - a cópia do símbolo guardada no esquema com outras pontas de pino: vale a da biblioteca, e o
       aviso conta qual dos dois desenhos os fios seguem;
     - sch_componentes por prefixo/refs/pinos soltos, sch_ler sem o desenho dos símbolos no
       cabeçalho e com campos, sch_apagar/sch_editar pelo lugar, sch_simbolo com avisos.
   Numa cópia temporária (os Projects reais nunca são gravados). node tests/test-sch-validacao.js */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const HC = require('../hub-core.js');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'mcp', 'eletrichub-mcp.js');

/* ---------- o motor, puro ---------- */
/* resistor de 2 pinos: corpo em +-100, pino de 100 -> pontas quentes em -200 e +200 */
const pino = (num, x, orient) => ({ num, name: num, x, y: 0, len: 100, orient, type: 'Passive' });
const RES = { name: 'RTESTE', designator: 'R', parts: [{ part: 1, pins: [pino('1', -100, 180), pino('2', 100, 0)] }], footprints: [{ name: 'FP2', current: true }] };
/* o mesmo nome, outras pontas: -250/+150 */
const RES_OUTRA = { name: 'RTESTE', designator: 'R', parts: [{ part: 1, pins: [pino('1', -150, 180), pino('2', 50, 0)] }] };
const REG = { name: 'REG5', designator: 'U', parts: [{ part: 1, pins: [1, 2, 3, 4, 5].map(n => pino(String(n), -100, 180)) }], footprints: [{ name: 'DDPAK-5', current: true }] };
const VAR = { name: 'VARISTOR', designator: 'RV', parts: [{ part: 1, pins: [pino('1', -100, 180), pino('2', 100, 0)] }], footprints: [{ name: 'FP2', current: true }] };
const schlib = { symbols: [RES, REG, VAR] };
const pcblib = { footprints: [
  { name: 'FP2', pads: [{ name: '1', type: 'smd' }, { name: '2', type: 'smd' }] },
  { name: 'DDPAK-5', pads: [1, 2, 3, 4, 5, 6].map(n => ({ name: String(n), type: 'smd' })) },
] };
const S = 'main';
const comp = (ref, sym, x, y, fp) => ({ t: 'comp', sheet: S, ref, sym, part: 1, x, y, rot: 0, mirror: false, footprint: fp || 'FP2' });
const base = () => ({ format: 'schmirror-v2', project: 'T', units: 'mil', items: [
  { t: 'sheet', name: S, size: 'A4' },
  comp('R1', 'RTESTE', 1000, 1000), comp('R2', 'RTESTE', 2000, 1000), comp('R3', 'RTESTE', 1000, 3000),
  comp('U1', 'REG5', 4000, 1000, 'DDPAK-5'),
  { t: 'wire', sheet: S, pts: [[1200, 1000], [1800, 1000]] },             // R1.2 -> R2.1
  { t: 'wire', sheet: S, pts: [[2200, 1000], [2500, 1000], [2500, 1500]] }, // R2.2 -> ponta solta em (2500,1500)
  { t: 'netlabel', sheet: S, net: 'VIN', x: 800, y: 1000 },                // R1.1 nomeado
  { t: 'noerc', sheet: S, x: 800, y: 3000 },                               // R3.1 solto de propósito
] });

{
  const s = base();
  const n = HC.extractNets(s, schlib);
  const soltos = n.pinosSoltos.map(p => p.ref + '.' + p.num).sort();
  /* R3.2 e U1 (os 5 pinos, todos na mesma ponta (-200,0): um pino com outro) */
  assert.ok(soltos.includes('R3.2'), 'R3.2 sem ligação: ' + soltos);
  assert.ok(!soltos.includes('R3.1'), 'R3.1 tem No ERC na ponta');
  assert.ok(!soltos.includes('R1.1') && !soltos.includes('R1.2') && !soltos.includes('R2.1'), soltos);
  assert.deepStrictEqual(n.pontasSoltas.map(p => [p.x, p.y]), [[2500, 1500]]);
  const v = HC.validateSchematic(s, schlib, pcblib, n);
  const w = v.warnings.join('\n');
  assert.ok(/comp R3: pino 2 sem ligação/.test(w), w);
  assert.ok(/1 ponta de fio solta .*\(2500,1500\)/.test(w), w);
  assert.ok(/comp U1: pad "6" do footprint DDPAK-5 sem pino no símbolo/.test(w), w);
  assert.ok(!/comp R1: pad/.test(w), 'FP2 tem os dois pads com pino');
  /* sem as nets, o validador continua como antes (não acusa pino solto) */
  assert.ok(!/sem ligação/.test(HC.validateSchematic(s, schlib, pcblib).warnings.join('\n')));
}
{
  /* R2.2 com fio que não leva a nada: o pino conta como sem ligação (o grupo só tem ele) */
  const n = HC.extractNets(base(), schlib);
  assert.ok(n.pinosSoltos.some(p => p.ref === 'R2' && p.num === '2' && p.fio), 'R2.2 pendurado num fio solto');
}
{
  /* No ERC na ponta solta do fio: de propósito */
  const s = base(); s.items.push({ t: 'noerc', sheet: S, x: 2500, y: 1500 });
  assert.strictEqual(HC.extractNets(s, schlib).pontasSoltas.length, 0);
  /* a ponta que pousa no MEIO de outro fio (T) liga */
  const t = base(); t.items.push({ t: 'wire', sheet: S, pts: [[1500, 1000], [1500, 600]] }, { t: 'netlabel', sheet: S, net: 'X', x: 1500, y: 600 });
  assert.ok(!HC.extractNets(t, schlib).pontasSoltas.some(p => p.x === 1500), 'a ponta em T no meio do fio liga');
}
{
  /* nome que só casa pela chave */
  const s = base(); s.items.push(comp('RV1', 'Varistor', 6000, 1000));
  const w = HC.validateSchematic(s, schlib, pcblib).warnings.join('\n');
  assert.ok(/símbolo "Varistor" não existe com esse nome; casou com "VARISTOR"/.test(w), w);
}
{
  /* a cópia do esquema com outras pontas: a biblioteca continua mandando, o aviso conta os dois lados */
  const s = base(); s.symbols = [RES_OUTRA];
  const d = HC.simbolosDoDocumento(schlib, s.symbols);
  assert.deepStrictEqual(d.divergentes, [{ nome: 'RTESTE', biblioteca: 'RTESTE' }]);
  assert.strictEqual(HC.symbolOf(d.schlib, 'RTESTE'), RES, 'vale a da biblioteca');
  const w = HC.validateSchematic(s, d.schlib, pcblib).warnings.join('\n');
  assert.ok(/cópia guardada no esquema tem pinos diferentes da biblioteca \("RTESTE"\), e vale a da biblioteca — 4 de 6 pinos encostam em fio com ela; com a cópia, 1/.test(w), w);  // R2.1 da cópia (1750) cai no meio do fio
  /* os fios desenhados na cópia: o aviso diz */
  const c = base(); c.symbols = [RES_OUTRA];
  c.items = c.items.filter(i => i.t !== 'wire' && i.t !== 'netlabel').concat([
    { t: 'wire', sheet: S, pts: [[1150, 1000], [1150, 600]] }, { t: 'wire', sheet: S, pts: [[1750, 1000], [1750, 600]] }]);  // nas pontas da cópia
  const w2 = HC.validateSchematic(c, d.schlib, pcblib).warnings.join('\n');
  assert.ok(/Os fios parecem desenhados na cópia/.test(w2), w2);
  /* mesma pinagem: nada a dizer, nada acrescentado */
  const igual = HC.simbolosDoDocumento(schlib, [Object.assign({}, RES)]);
  assert.strictEqual(igual.schlib, schlib);
  /* nome que a biblioteca não tem: entra (como sempre) */
  const novo = HC.simbolosDoDocumento(schlib, [Object.assign({}, RES, { name: 'SO_NO_ESQUEMA' })]);
  assert.ok(HC.symbolOf(novo.schlib, 'SO_NO_ESQUEMA').doDocumento);
}

/* ---------- as ferramentas, pelo MCP ---------- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eletrichub-schval-'));
const PROJETOS = path.join(TMP, 'Projects');
const PROJ = 'TesteValidacao';
fs.mkdirSync(path.join(PROJETOS, PROJ), { recursive: true });
{
  const s = base();
  s.project = PROJ;
  s.symbols = [Object.assign({}, RES, { name: 'RTESTE_DOC' })];
  s.items = s.items.filter(i => i.t !== 'comp' || i.ref !== 'U1').map(i => i.t === 'comp' ? Object.assign({}, i, { sym: 'RTESTE_DOC', footprint: '' }) : i);
  s.items.push(Object.assign(comp('RV1', 'RTESTE_DOC', 6000, 1000), { footprint: '' }));
  fs.writeFileSync(path.join(PROJETOS, PROJ, 'schematic.js'), HC.serializeSchematic(s).text);
}

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
    return { j: JSON.parse(r.result.content[0].text), erro: !!r.result.isError, texto: r.result.content[0].text };
  };
  await c.pede('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '0' } });
  c.avisa('notifications/initialized', {});

  /* sch_validar: pino sem ligação e ponta solta, com as contagens */
  let r = await chama('sch_validar', { projeto: PROJ });
  assert.ok(!r.erro, r.texto);
  assert.strictEqual(r.j.pontas_soltas, 1);
  assert.ok(r.j.pinos_sem_ligacao >= 1);
  assert.ok(r.j.avisos.some(w => /comp R3: pino 2 sem ligação/.test(w)), r.j.avisos.join('\n'));

  /* sch_componentes: prefixo "R" pega R1..R3 e não RV1; pinos soltos; campos */
  r = await chama('sch_componentes', { projeto: PROJ, prefixo: 'R', pinos: 'nenhum', campos: ['sym'] });
  assert.deepStrictEqual(r.j.componentes.map(x => x.ref).sort(), ['R1', 'R2', 'R3']);
  assert.deepStrictEqual(Object.keys(r.j.componentes[0]).sort(), ['ref', 'sym']);
  r = await chama('sch_componentes', { projeto: PROJ, pinos: 'soltos' });
  assert.ok(r.j.componentes.some(x => x.ref === 'R3' && x.pinos.length === 1 && x.pinos[0].num === '2'), r.texto);
  assert.ok(!r.j.componentes.some(x => x.ref === 'R1'), 'R1 não tem pino solto');
  r = await chama('sch_componentes', { projeto: PROJ, refs: ['RV1'] });
  assert.deepStrictEqual(r.j.componentes.map(x => x.ref), ['RV1']);
  r = await chama('sch_componentes', { projeto: PROJ, prefixo: 'Q' });
  assert.ok(r.j.ok === false && /prefixo "Q"/.test(r.j.erro), r.texto);

  /* sch_ler: o cabeçalho sem o desenho dos símbolos (só os nomes); "nenhum"; campos; prefixo */
  r = await chama('sch_ler', { projeto: PROJ, tipo: 'comp', prefixo: 'R', campos: ['ref'] });
  assert.deepStrictEqual(r.j.cabecalho.simbolos_guardados, ['RTESTE_DOC']);
  assert.ok(!('symbols' in r.j.cabecalho));
  assert.deepStrictEqual(r.j.itens.map(x => x.item.ref).sort(), ['R1', 'R2', 'R3']);
  assert.deepStrictEqual(Object.keys(r.j.itens[0].item).sort(), ['ref', 'sheet', 't']);
  r = await chama('sch_ler', { projeto: PROJ, cabecalho: 'nenhum', tipo: 'netlabel' });
  assert.ok(!('cabecalho' in r.j) && r.j.total === 1);
  r = await chama('sch_ler', { projeto: PROJ, cabecalho: 'completo', limite: 1 });
  assert.ok(Array.isArray(r.j.cabecalho.symbols) && r.j.cabecalho.symbols[0].parts);
  r = await chama('sch_ler', { projeto: PROJ, net: 'VIN', cabecalho: 'nenhum' });
  assert.strictEqual(r.j.total, 1);

  /* sch_editar pelo lugar: o rótulo em (800,1000) */
  r = await chama('sch_editar', { projeto: PROJ, em: { t: 'netlabel', x: 800, y: 1000 }, campos: { net: 'VIN2' } });
  assert.ok(r.j.gravado, r.texto);
  r = await chama('sch_ler', { projeto: PROJ, net: 'VIN2', cabecalho: 'nenhum' });
  assert.strictEqual(r.j.total, 1);
  /* "em" sem tipo num ponto com dois itens (o vértice do fio e um rótulo pousado nele) não edita */
  r = await chama('sch_adicionar', { projeto: PROJ, itens: [{ t: 'netlabel', net: 'N1', x: 2500, y: 1000 }] });
  assert.ok(r.j.gravado, r.texto);
  r = await chama('sch_editar', { projeto: PROJ, em: { x: 2500, y: 1000 }, campos: { net: 'N2' }, simular: true });
  assert.ok(r.j.ok === false && /achou 2 itens/.test(r.j.erro), r.texto);
  r = await chama('sch_apagar', { projeto: PROJ, em: [{ t: 'netlabel', x: 2500, y: 1000 }] });
  assert.ok(r.j.gravado && r.j.removidos.length === 1, r.texto);

  /* sch_apagar pelo lugar, duas vezes seguidas, sem reler índices */
  r = await chama('sch_apagar', { projeto: PROJ, em: [{ t: 'wire', x: 2500, y: 1200 }] });
  assert.ok(r.j.gravado && r.j.removidos.length === 1 && r.j.removidos[0].t === 'wire', r.texto);
  r = await chama('sch_apagar', { projeto: PROJ, em: [{ t: 'noerc', x: 800, y: 3000 }, { t: 'wire', x: 1500, y: 1000 }] });
  assert.ok(r.j.gravado && r.j.removidos.length === 2, r.texto);
  r = await chama('sch_apagar', { projeto: PROJ, em: [{ t: 'wire', x: 9999, y: 9999 }] });
  assert.ok(r.j.ok === false && /nada em/.test(r.j.erro), r.texto);
  r = await chama('sch_validar', { projeto: PROJ });
  assert.strictEqual(r.j.pontas_soltas, 0, 'o fio solto saiu');
  assert.ok(r.j.avisos.some(w => /comp R3: pinos 1, 2 sem ligação|comp R3: pinos 2, 1 sem ligação/.test(w)), 'sem o No ERC, R3.1 também: ' + r.j.avisos.join('\n'));

  /* sch_simbolo: nome que só casa pela chave avisa; pinos fora da grade avisam */
  r = await chama('sch_simbolo', { nome: 'res [smd]' });
  assert.ok(!r.erro, r.texto);
  assert.strictEqual(r.j.casou_por, 'chave');
  assert.strictEqual(r.j.pedido, 'res [smd]');
  assert.ok(r.j.avisos.some(a => /casou com "RES \[SMD\]"/.test(a)), r.texto);
  assert.ok(r.j.avisos.some(a => /fora da grade de 100 mil/.test(a)), 'RES [SMD] tem pontas em -250/+150: ' + r.texto);
  r = await chama('sch_simbolo', { nome: 'RES [SMD]' });
  assert.strictEqual(r.j.casou_por, 'exato');

  c.fim();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-sch-validacao: ok');
})().catch(e => { console.error(e); process.exit(1); });
