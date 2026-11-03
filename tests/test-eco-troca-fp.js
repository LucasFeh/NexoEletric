/* ECO: troca de footprint pelo esquema (2026-11-03). Relato: "ao trocar o footprint pelo esquema,
   as nets da placa sao substituidas pelas do esquema sem aviso".
   - o componente volta com as nets que os pads tem HOJE na placa (pelo nome do pad);
   - onde o esquema discorda, a diferenca e uma acao de pino propria (dados.troca), marcada;
     desmarcada, o pad fica com a net da placa;
   - pad do footprint velho que o novo nao tem: aviso na troca (sai com a net dele);
   - pad que so o novo tem: acao de pino que depende da troca;
   - o designator vem junto (des_x/des_y/des_h/des_rot/des_hidden no comp_add);
   - a mensagem diz quantos pads mudam de net, e o eco_aplicar do MCP devolve o mesmo.
   Placa: o LM555 do repo (Projects/LM555 astável), com changes.js montado aqui; o MCP grava
   numa COPIA num diretorio temporario. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { loadVar } = require('./load');
const HC = require('../hub-core.js');
const Eco = require('../hub-pcbeco.js');

HC.setLibTables(loadVar('Libs/rename-map.js', 'renameMap'), loadVar('Libs/lib-subs.js', 'libSubs'));
const schlib = loadVar('Libs/schlib.js', 'schlib');
const pcblib0 = loadVar('Libs/pcblib.js', 'pcblib');
const PROJ = 'LM555 astável';
const B = loadVar('Projects/' + PROJ + '/board.js', 'pcbmirror');
const S0 = loadVar('Projects/' + PROJ + '/schematic.js', 'schematic');
const dc = o => JSON.parse(JSON.stringify(o));

/* footprints de teste, por cima da pcblib: o RES 1206 com o pad 2 renomeado para 3 (o 2 some, o 3
   e novo) e o TO-92 sem o pad 3 */
const fp = n => dc(pcblib0.footprints.find(f => f.name === n));
const F13 = Object.assign(fp('RES 1206'), { name:'TESTE ECO 1-3' }); F13.pads.find(p => p.name === '2').name = '3';
const F12 = Object.assign(fp('TO-92'), { name:'TESTE ECO TO92 2P' }); F12.pads = F12.pads.filter(p => p.name !== '3');
const pcblib = Object.assign({}, pcblib0, { footprints:pcblib0.footprints.concat([F13, F12]) });

const comFp = (ref, nome) => { const S = dc(S0); for (const i of S.items) if (i.t === 'comp' && i.ref === ref) i.footprint = nome; return S; };
const netsDe = s => Object.fromEntries(String(s || '').split(';').filter(Boolean).map(x => x.split('=')));
const placaCom = ch => HC.effectiveBoard(B, HC.applyPcbChanges(B, ch, { pcblib }));
const comp = (eb, ref) => eb.components.find(c => c.ref === ref);
const padNets = c => Object.fromEntries(c.pads.map(p => [String(p.name), p.net || '']));
const desig = (eb, ref) => eb.texts.find(t => t.designator && t.owner === ref);
/* executa e confere: as linhas passam no motor sem erro */
function executa(eco, ch){
  const r = Eco.aplica(eco, { pcblib });
  const m = HC.applyPcbChanges(B, ch.concat(r.linhas), { pcblib });
  const ruins = m.changeItems.slice(ch.length).filter(it => it.status === 'err').map(it => it.msg);
  assert.deepStrictEqual(ruins, [], 'linhas do ECO com erro');
  return { r, eb:HC.effectiveBoard(B, m) };
}

/* ---- R1: RES 1206 -> RES 0805; na placa o pad 2 foi para GND (o esquema diz VCC) e o designator
   esta oculto ---- */
const R1 = B.components.find(c => c.ref === 'R1');
const d0 = B.texts.find(t => t.designator && t.owner === 'R1');
const CH = [{ op:'pad_net', ref:'R1', pad:'2', net:'GND', orig_net:'VCC' },
            { op:'designator_move', ref:'R1', hidden:true, orig_x:d0.x, orig_y:d0.y }];
{
  const S = comFp('R1', 'RES 0805');
  const eco = Eco.compara(S, B, { schlib, pcblib, changes:CH });
  const fpA = eco.acoes.filter(a => a.tipo === 'comp_fp');
  assert.deepStrictEqual(fpA.map(a => a.objeto), ['R1']);
  const troca = fpA[0];
  /* as nets do componente novo sao as da placa: o pad 1 fica na NetCI1_7 da placa (a previa do
     esquema a chama de NetR1_1, nome que a placa nao tem), o 2 no GND de hoje */
  assert.deepStrictEqual(troca.dados.nets, { 1:'NetCI1_7', 2:'GND' });
  /* a diferenca do esquema e uma acao propria, marcada, ligada a troca */
  const pinos = eco.acoes.filter(a => a.dados && a.dados.troca === troca.id);
  assert.deepStrictEqual(pinos.map(a => [a.grupo, a.objeto, a.para, a.ativo, a.status]), [['pinAdd', 'R1-2', 'VCC', true, 'ok']]);
  assert.ok(/troca de footprint/.test(pinos[0].msg) && /GND/.test(pinos[0].msg), pinos[0].msg);
  /* a mensagem da troca conta os pads que mudam, e e aviso */
  assert.strictEqual(troca.status, 'warn');
  assert.strictEqual(troca.msg, 'RES 1206 → RES 0805 · 1 pad muda de net: 2 GND→VCC');
  const tf = Eco.trocasFp(eco);
  assert.deepStrictEqual(tf[0].pads_mudam, [{ pad:'2', de:'GND', para:'VCC' }]);
  assert.ok(/1 pad muda de net/.test(Eco.relatorio(eco)), 'o relatorio tambem diz');

  /* aceitar tudo: a placa fica como o esquema, com o designator de antes */
  {
    const { r, eb } = executa(eco, CH);
    const add = r.linhas.find(l => l.op === 'comp_add' && l.ref === 'R1');
    assert.deepStrictEqual(netsDe(add.nets), { 1:'NetCI1_7', 2:'VCC' }, 'o pino marcado entra nas nets do comp_add');
    assert.ok(!r.linhas.some(l => l.op === 'pad_net' && l.ref === 'R1'), 'o pino da troca vai dobrado no comp_add, sem pad_net depois');
    assert.ok(add.x === R1.x && add.y === R1.y && add.rot === R1.rot && add.layer === R1.layer, 'no mesmo lugar');
    assert.ok(add.des_x === d0.x && add.des_y === d0.y && add.des_h === d0.h && add.des_rot === d0.rot && add.des_hidden === true,
              'designator de antes: ' + JSON.stringify(add));
    assert.ok(!('des_w' in add), 'o board.js nao tem o traco: o motor fica com o padrao');
    const c = comp(eb, 'R1');
    assert.strictEqual(c.footprint, 'RES 0805');
    assert.deepStrictEqual(padNets(c), { 1:'NetCI1_7', 2:'VCC' });
    const t = desig(eb, 'R1');
    assert.ok(t.x === d0.x && t.y === d0.y && t.h === d0.h && t.rot === d0.rot && t.hidden === true, 'designator na placa: ' + JSON.stringify(t));
    /* e o ECO de novo nao tem nada a fazer no R1 */
    const eco2 = Eco.compara(S, B, { schlib, pcblib, changes:CH.concat(r.linhas) });
    assert.deepStrictEqual(eco2.acoes.filter(a => a.ativo && /R1\b/.test(a.objeto)).map(a => a.grupo + ' ' + a.objeto), []);
  }
  /* desmarcar o pino: o pad fica com a net da placa, e a troca diz isso */
  {
    pinos[0].ativo = false; Eco.valida(eco);
    assert.strictEqual(troca.status, 'ok', 'nada muda de net: sem aviso');
    assert.strictEqual(troca.msg, 'RES 1206 → RES 0805 · 1 fica com a net da placa: 2 GND');
    assert.deepStrictEqual(Eco.trocasFp(eco)[0].pads_ficam_da_placa, [{ pad:'2', net:'GND', esquema:'VCC' }]);
    const { r, eb } = executa(eco, CH);
    assert.deepStrictEqual(netsDe(r.linhas.find(l => l.op === 'comp_add').nets), { 1:'NetCI1_7', 2:'GND' });
    assert.deepStrictEqual(padNets(comp(eb, 'R1')), { 1:'NetCI1_7', 2:'GND' });
    /* a diferenca continua a vista: o ECO seguinte a propoe de novo, como pino comum */
    const eco2 = Eco.compara(S, B, { schlib, pcblib, changes:CH.concat(r.linhas) });
    assert.deepStrictEqual(eco2.acoes.filter(a => a.ativo && /R1\b/.test(a.objeto)).map(a => a.grupo + ' ' + a.objeto + ' ' + a.para), ['pinAdd R1-2 VCC']);
    pinos[0].ativo = true; Eco.valida(eco);
  }
  /* sem a troca: o pino ainda vale no footprint de hoje (pad_net comum) */
  {
    troca.ativo = false; Eco.valida(eco);
    const { r, eb } = executa(eco, CH);
    assert.deepStrictEqual(r.linhas.filter(l => l.ref === 'R1').map(l => l.op + ' ' + (l.pad || '') + ' ' + (l.net || '')), ['pad_net 2 VCC']);
    assert.strictEqual(comp(eb, 'R1').footprint, 'RES 1206');
    troca.ativo = true; Eco.valida(eco);
  }
}

/* ---- pads que somem: R1 -> footprint com pads 1 e 3 ---- */
{
  const eco = Eco.compara(comFp('R1', F13.name), B, { schlib, pcblib });
  const troca = eco.acoes.find(a => a.tipo === 'comp_fp');
  assert.deepStrictEqual(troca.dados.somem, [{ pad:'2', net:'VCC' }]);
  assert.strictEqual(troca.status, 'warn');
  assert.ok(/1 pad sai \(não existe no TESTE ECO 1-3\): 2 \(VCC\)/.test(troca.msg), troca.msg);
  assert.deepStrictEqual(Eco.trocasFp(eco)[0].pads_saem, [{ pad:'2', net:'VCC' }]);
  /* o pino 2 do esquema nao tem pad no footprint novo: o Unknown Pin, erro, desmarcado */
  const sp = eco.acoes.find(a => a.semPad && a.objeto === 'R1-2');
  assert.ok(sp && sp.status === 'err' && !sp.ativo);
  /* o pad 3 e novo e o esquema nao o liga: nada */
  assert.ok(!eco.acoes.some(a => a.objeto === 'R1-3'));
  const { r, eb } = executa(eco, []);
  assert.deepStrictEqual(netsDe(r.linhas.find(l => l.op === 'comp_add').nets), { 1:'NetCI1_7' });
  assert.deepStrictEqual(padNets(comp(eb, 'R1')), { 1:'NetCI1_7', 3:'' });
  /* sem nada a dizer: as nets da placa ficam */
  const eco0 = Eco.compara(comFp('C1', 'CAP 0805'), B, { schlib, pcblib });
  const t0 = eco0.acoes.find(a => a.tipo === 'comp_fp');
  assert.strictEqual(t0.msg, 'CAP 1206 → CAP 0805 · nets da placa mantidas');
  assert.strictEqual(t0.status, 'ok');
}

/* ---- pad que so o footprint novo tem: o T1 esta na placa num TO-92 sem o pad 3 (o GND), e o
   esquema volta para o TO-92 ---- */
{
  const T1 = B.components.find(c => c.ref === 'T1');
  const ch = [{ op:'comp_del', ref:'T1', orig_x:T1.x, orig_y:T1.y, orig_rot:T1.rot, orig_layer:T1.layer, orig_footprint:T1.footprint },
              { op:'comp_add', ref:'T1', footprint:F12.name, x:T1.x, y:T1.y, rot:T1.rot, layer:T1.layer, nets:'1=NetCN2_1;2=NetR3_1' }];
  const eco = Eco.compara(S0, B, { schlib, pcblib, changes:ch });
  const troca = eco.acoes.find(a => a.tipo === 'comp_fp');
  assert.strictEqual(troca.objeto, 'T1');
  const p3 = eco.acoes.find(a => a.dados && a.dados.troca === troca.id);
  assert.ok(p3 && p3.objeto === 'T1-3' && p3.para === 'GND' && p3.dados.padNovo && p3.ativo && p3.status === 'ok', JSON.stringify(p3));
  assert.ok(/pad novo do TO-92/.test(p3.msg), p3.msg);
  assert.ok(/1 pad muda de net: 3 sem net→GND/.test(troca.msg), troca.msg);
  const { eb } = executa(eco, ch);
  assert.deepStrictEqual(padNets(comp(eb, 'T1')), { 1:'NetCN2_1', 2:'NetR3_1', 3:'GND' });
  /* sem a troca, o pad 3 nao existe: a acao vira erro, e nao executa */
  troca.ativo = false; Eco.valida(eco);
  assert.ok(p3.status === 'err' && /depende de "Trocar footprint T1"/.test(p3.msgValida), p3.msgValida);
  const r2 = Eco.aplica(eco, { pcblib });
  assert.ok(!r2.linhas.some(l => l.ref === 'T1') && r2.puladas.some(p => p.acao === p3));
}

/* ---- o MCP: eco_aplicar devolve as trocas com os pads que mudam ---- */
(async () => {
  const RAIZ = path.join(__dirname, '..');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eletrichub-eco-fp-'));
  const PROJETOS = path.join(TMP, 'Projects'), D = path.join(PROJETOS, PROJ);
  fs.mkdirSync(PROJETOS);
  fs.cpSync(path.join(RAIZ, 'Projects', PROJ), D, { recursive:true });
  fs.writeFileSync(path.join(TMP, 'projects.js'), 'var projects = [\n{"name":"LM555 ast\\u00E1vel","files":{}}\n];\n');
  fs.writeFileSync(path.join(D, 'changes.js'), HC.serializeChanges(CH).text);
  const sch = fs.readFileSync(path.join(D, 'schematic.js'), 'utf8').split('\n')
    .map(l => /"ref":"R1"/.test(l) ? l.replace('"footprint":"RES 1206"', '"footprint":"RES 0805"') : l).join('\n');
  fs.writeFileSync(path.join(D, 'schematic.js'), sch);

  const p = spawn(process.execPath, [path.join(RAIZ, 'mcp', 'eletrichub-mcp.js'), '--root', RAIZ, '--projetos', PROJETOS], { stdio:['pipe', 'pipe', 'pipe'] });
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
    p.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:n, method, params }) + '\n');
  });
  const chama = async (name, args) => {
    const r = await pede('tools/call', { name, arguments:args });
    assert.ok(r.result && !r.result.isError, name + ': ' + JSON.stringify(r.error || r.result));
    return JSON.parse(r.result.content[0].text);
  };
  try {
    await pede('initialize', { protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{ name:'teste', version:'0' } });
    p.stdin.write(JSON.stringify({ jsonrpc:'2.0', method:'notifications/initialized' }) + '\n');
    const cmp = await chama('eco_comparar', { projeto:PROJ });
    const t = (cmp.trocas_footprint || [])[0];
    assert.ok(t && t.ref === 'R1' && t.status === 'warn' && /1 pad muda de net: 2 GND→VCC/.test(t.msg), JSON.stringify(cmp.trocas_footprint));
    const fpId = cmp.acoes.find(a => a.tipo === 'comp_fp').id;
    /* tudo (simulado): o pino entra nas nets */
    let j = await chama('eco_aplicar', { projeto:PROJ, refs:['R1'], simular:true });
    assert.deepStrictEqual(j.trocas_footprint.map(x => [x.ref, x.pads_mudam]), [['R1', [{ pad:'2', de:'GND', para:'VCC' }]]]);
    /* a resposta traz cada linha gravada como texto (o jline do arquivo) */
    let add = j.linhas.filter(l => l.op === 'comp_add').map(l => JSON.parse(l.linha)).find(l => l.ref === 'R1');
    assert.deepStrictEqual(netsDe(add.nets), { 1:'NetCI1_7', 2:'VCC' });
    assert.ok(add.des_x === d0.x && add.des_y === d0.y && add.des_hidden === true, JSON.stringify(add));
    /* so a troca: o pad 2 fica no GND da placa, e a resposta diz */
    j = await chama('eco_aplicar', { projeto:PROJ, ids:[fpId] });
    assert.ok(j.gravado, JSON.stringify(j).slice(0, 600));
    assert.deepStrictEqual(j.trocas_footprint[0].pads_mudam, []);
    assert.deepStrictEqual(j.trocas_footprint[0].pads_ficam_da_placa, [{ pad:'2', net:'GND', esquema:'VCC' }]);
    const gravado = new Function(fs.readFileSync(path.join(D, 'changes.js'), 'utf8') + ';return changes;')();
    add = gravado.find(l => l.op === 'comp_add' && l.ref === 'R1');
    assert.deepStrictEqual(netsDe(add.nets), { 1:'NetCI1_7', 2:'GND' });
    assert.ok(add.des_x === d0.x && add.des_y === d0.y && add.des_hidden === true, JSON.stringify(add));
  } finally {
    p.stdin.end();
    await new Promise(ok => { p.on('exit', ok); setTimeout(ok, 5000); });
    try { fs.rmSync(TMP, { recursive:true, force:true }); } catch (e) { /* o Windows segura o arquivo as vezes */ }
  }
  console.log('test-eco-troca-fp: ok');
})().catch(e => { console.error(e); process.exit(1); });
