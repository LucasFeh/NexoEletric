/* sch_copiar (NexoEletric 1.48.0): um circuito de um projeto para outro, pelo MCP, em projetos
   temporários (os Projects reais nunca são gravados):
     - por refs: só o que é das nets dos pinos escolhidos; o fio que passa pela caixa vem inteiro
       (fios_estendidos) e o rótulo/power pousado nele vem junto; o circuito vizinho na caixa não vem;
     - designador que já existe no destino ganha o próximo livre; refs_novos escolhe;
     - nets troca o nome (0V -> 0VCC);
     - o símbolo que só existe no esquema de origem vai para o `symbols` do destino (arquivo
       reserializado: o cabeçalho é gravado);
     - erro que o componente já tinha na origem (footprint fora da PcbLib) não trava (erros_herdados);
     - por caixa: o que está dentro, fio que sai fica de fora (fios_cortados);
     - posicao acerta a grade; simular não grava.
   node tests/test-sch-copiar.js */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const HC = require('../hub-core.js');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'mcp', 'eletrichub-mcp.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eletrichub-schcopia-'));
const PROJETOS = path.join(TMP, 'Projects');

const pino = (num, x, orient) => ({ num, name: num, x, y: 0, len: 100, orient, type: 'Passive' });
const RDOC = { name: 'RTESTE_DOC', designator: 'R', partcount: 1, parts: [{ part: 1, pins: [pino('1', -100, 180), pino('2', 100, 0)] }] };
const comp = (sheet, ref, x, y, fp) => ({ t: 'comp', sheet, ref, sym: 'RTESTE_DOC', part: 1, x, y, rot: 0, mirror: false, footprint: fp == null ? '' : fp });
const grava = (nome, s) => { fs.mkdirSync(path.join(PROJETOS, nome), { recursive: true }); fs.writeFileSync(path.join(PROJETOS, nome, 'schematic.js'), HC.serializeSchematic(s).text); };

const S = 'S1';
grava('ORIGEM', { format: 'schmirror-v2', project: 'ORIGEM', units: 'mil', symbols: [RDOC], items: [
  { t: 'sheet', name: S, size: 'A3' },
  comp(S, 'R1', 1000, 1000, 'NAO_EXISTE'), comp(S, 'R2', 2000, 1000),
  comp(S, 'R9', 9200, 600),                                                  // fora: pendurado no barramento
  comp(S, 'R4', 1500, 1300),                                                 // na caixa, outra net
  { t: 'wire', sheet: S, pts: [[1200, 1000], [1800, 1000]] },                // R1.2 - R2.1
  { t: 'wire', sheet: S, pts: [[800, 1000], [800, 700]] },                   // R1.1 - 0V
  { t: 'power', sheet: S, net: '0V', style: 'GndPower', x: 800, y: 700, rot: 0 },
  { t: 'wire', sheet: S, pts: [[2200, 1000], [2200, 600], [9000, 600]] },    // R2.2 - barramento até R9
  { t: 'netlabel', sheet: S, net: 'SAIDA', x: 5000, y: 600, rot: 0 },        // no barramento, fora da caixa
  { t: 'wire', sheet: S, pts: [[1700, 1300], [1700, 1400]] },                // R4.2 - OUTRA
  { t: 'netlabel', sheet: S, net: 'OUTRA', x: 1700, y: 1400, rot: 0 },
] });
grava('DESTINO', { format: 'schmirror-v2', project: 'DESTINO', units: 'mil', symbols: [RDOC], items: [
  { t: 'sheet', name: 'F1', size: 'A4' }, comp('F1', 'R1', 500, 5000),
] });
/* o arquivo como o hub o lê (o JSON de volta: objeto de dentro do vm tem outro protótipo) */
const lerDestino = () => {
  const vm = require('vm'); const c = {}; vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(PROJETOS, 'DESTINO', 'schematic.js'), 'utf8') + ';this.s=JSON.stringify(schematic)', c);
  return JSON.parse(c.s);
};

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

  /* erros de entrada */
  let r = await chama('sch_copiar', { de: 'ORIGEM', para: 'ORIGEM', refs: ['R1'] });
  assert.ok(r.j.ok === false && /mesmo projeto/.test(r.j.erro), r.texto);
  r = await chama('sch_copiar', { de: 'ORIGEM', para: 'DESTINO', refs: ['R1', 'R77'] });
  assert.ok(r.j.ok === false && /R77/.test(r.j.erro), r.texto);
  r = await chama('sch_copiar', { de: 'ORIGEM', para: 'DESTINO' });
  assert.ok(r.j.ok === false && /refs .* ou caixa/.test(r.j.erro), r.texto);

  /* simular não grava */
  const antes = fs.readFileSync(path.join(PROJETOS, 'DESTINO', 'schematic.js'), 'utf8');
  r = await chama('sch_copiar', { de: 'ORIGEM', para: 'DESTINO', refs: ['R1', 'R2'], simular: true });
  assert.ok(r.j.ok && r.j.simulado && !r.j.gravado, r.texto);
  assert.strictEqual(fs.readFileSync(path.join(PROJETOS, 'DESTINO', 'schematic.js'), 'utf8'), antes);

  /* por refs, com a troca de net e um lugar novo */
  r = await chama('sch_copiar', { de: 'ORIGEM', para: 'DESTINO', refs: ['R1', 'R2'], nets: { '0V': '0VCC' }, posicao: [3000, 3000] });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  assert.deepStrictEqual(r.j.copiados, { componentes: 2, fios: 3, outros: 2 }, 'R1, R2; os três fios deles; o power e o rótulo do barramento — R4 e o OUTRA não');
  assert.strictEqual(r.j.fios_estendidos, 1, 'o barramento passa da caixa e vem inteiro');
  assert.deepStrictEqual(r.j.refs, { R1: 'R2', R2: 'R3' }, 'R1 já existe no destino');
  assert.deepStrictEqual(r.j.deslocamento, [2200, 2000], 'canto dos componentes (800,1000) -> (3000,3000)');
  assert.ok((r.j.erros_herdados || []).some(e => /comp R2: footprint "NAO_EXISTE"/.test(e)), 'o footprint que já faltava na origem não trava: ' + r.texto);
  assert.ok(!r.j.simbolos_copiados, 'o destino já tinha o RTESTE_DOC');
  assert.ok(r.j.avisos_novos.some(w => /ponta de fio solta .*\(11200,2600\)/.test(w)), 'o barramento terminava no R9, que não veio: ' + r.texto);
  let d = lerDestino();
  const L = { symbols: [RDOC] };
  let n = HC.extractNets(d, L);
  const net = (ref, num) => n.pinNet[ref + '-' + num];
  assert.strictEqual(net('R2', '1'), '0VCC', 'o 0V virou 0VCC');
  assert.strictEqual(net('R2', '2'), net('R3', '1'), 'R1.2-R2.1 da origem continua ligado');
  assert.strictEqual(net('R3', '2'), 'SAIDA', 'o rótulo do barramento veio com ele');
  assert.ok(d.items.some(i => i.t === 'comp' && i.ref === 'R1' && i.x === 500), 'o R1 do destino ficou');
  assert.ok(!d.items.some(i => i.net === 'OUTRA'), 'o circuito vizinho não veio');

  /* por caixa, numa folha nova, com refs_novos e o símbolo indo para o destino */
  fs.writeFileSync(path.join(PROJETOS, 'DESTINO', 'schematic.js'), HC.serializeSchematic({ format: 'schmirror-v2', project: 'DESTINO', units: 'mil',
    items: [{ t: 'sheet', name: 'F1', size: 'A4' }] }).text);
  r = await chama('sch_copiar', { de: 'ORIGEM', para: 'DESTINO', caixa: { x1: 600, y1: 500, x2: 2400, y2: 1500 }, folha_destino: 'FONTE', refs_novos: { R4: 'R40' } });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  assert.strictEqual(r.j.folha_criada, 'FONTE');
  assert.strictEqual(r.j.fios_cortados, 1, 'o barramento sai da caixa');
  assert.deepStrictEqual(r.j.refs, { R4: 'R40' });
  assert.deepStrictEqual(r.j.simbolos_copiados, ['RTESTE_DOC']);
  d = lerDestino();
  assert.deepStrictEqual((d.symbols || []).map(s => s.name), ['RTESTE_DOC'], 'o cabeçalho foi gravado com o símbolo: ' + fs.readFileSync(path.join(PROJETOS, 'DESTINO', 'schematic.js'), 'utf8').slice(0, 400));
  assert.ok(d.items.some(i => i.t === 'sheet' && i.name === 'FONTE' && i.size === 'A3'));
  assert.deepStrictEqual(d.items.filter(i => i.t === 'comp').map(i => i.ref).sort(), ['R1', 'R2', 'R40']);
  assert.ok(d.items.some(i => i.net === 'OUTRA') && d.items.some(i => i.net === '0V'));
  r = await chama('sch_validar', { projeto: 'DESTINO' });
  assert.ok(!r.j.erros.some(e => /símbolo/.test(e)), 'o símbolo copiado resolve: ' + r.texto);

  c.fim();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-sch-copiar: ok');
})().catch(e => { console.error(e); process.exit(1); });
