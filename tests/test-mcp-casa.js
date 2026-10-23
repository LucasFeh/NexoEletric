/* As skills da casa no MCP (mcp/skills/*.md) e o regras_casa_verificar, provados como um cliente
   os usaria: instruções do initialize, ferramentas, recursos, prompts; o verificador numa CÓPIA de
   Projects/LM555 astável (os Projects reais nunca são gravados); e os campos novos do poly_add
   (clearanceTipo, clearanceNet, conexao) no hub-core. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'mcp', 'eletrichub-mcp.js');
const PROJ = 'LM555 astável';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eletrichub-casa-'));
const PROJETOS = path.join(TMP, 'Projects');
fs.mkdirSync(PROJETOS);
fs.cpSync(path.join(RAIZ, 'Projects', PROJ), path.join(PROJETOS, PROJ), { recursive: true });
fs.writeFileSync(path.join(PROJETOS, PROJ, 'changes.js'), require('../hub-core.js').serializeChanges([]).text);
const realAntes = fs.readFileSync(path.join(RAIZ, 'Projects', PROJ, 'board.js'), 'utf8');

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
    return { j: JSON.parse(r.result.content[0].text), erro: !!r.result.isError };
  };
  const SKILLS = ['pcb-parafusos-isolados', 'pcb-plano-folga-pads', 'pcb-serigrafia-livre',
    'pcb-cobre-sem-curto', 'pcb-boas-praticas', 'pcb-verificar-antes-de-entregar', 'pcb-producao-backplane'];

  /* instruções do servidor: o resumo das regras vai para toda IA que conecta */
  const ini = await c.pede('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '0' } });
  assert.ok(/REGRAS DA CASA/.test(ini.result.instructions), 'instruções sem as regras da casa');
  for (const s of SKILLS) assert.ok(ini.result.instructions.includes(s), 'instruções sem ' + s);
  assert.ok(/regras_casa_verificar/.test(ini.result.instructions));
  c.avisa('notifications/initialized', {});

  /* ferramentas */
  const nomes = (await c.pede('tools/list', {})).result.tools.map(t => t.name);
  for (const n of ['skills_listar', 'skill_ler', 'regras_casa_verificar']) assert.ok(nomes.includes(n), 'falta ' + n);
  let { j } = await chama('skills_listar', {});
  for (const s of SKILLS) assert.ok(j.skills.some(x => x.nome === s && x.descricao.length > 40), 'skills_listar sem ' + s);
  ({ j } = await chama('skill_ler', { nome: 'pcb-parafusos-isolados' }));
  assert.ok(/3 mm/.test(j.texto) && /quadrado/i.test(j.texto) && !/^---/.test(j.texto), 'skill_ler: texto sem o cabeçalho e com a regra');
  const nada = await chama('skill_ler', { nome: 'nao-existe' });
  assert.ok(nada.erro, 'skill inexistente tem de dar erro');

  /* recursos e prompts */
  const recs = (await c.pede('resources/list', {})).result.resources.map(r => r.uri);
  for (const s of SKILLS) assert.ok(recs.includes('eletrichub://skill/' + s), 'recurso da skill ' + s);
  const rr = await c.pede('resources/read', { uri: 'eletrichub://skill/pcb-serigrafia-livre' });
  assert.ok(/overlay/i.test(rr.result.contents[0].text));
  const prs = (await c.pede('prompts/list', {})).result.prompts.map(p => p.name);
  assert.ok(prs.includes('skill_pcb_plano_folga_pads') && prs.includes('fluxo_pcb'));
  const pg = await c.pede('prompts/get', { name: 'skill_pcb_plano_folga_pads', arguments: { projeto: PROJ } });
  assert.ok(/1,0 mm/.test(pg.result.messages[0].content.text) && pg.result.messages[0].content.text.includes(PROJ));
  const fl = await c.pede('prompts/get', { name: 'fluxo_pcb', arguments: { projeto: PROJ } });
  assert.ok(/regras_casa_verificar/.test(fl.result.messages[0].content.text), 'fluxo_pcb sem o passo das regras da casa');

  /* o verificador: placa limpa responde; texto em cima de um pad vira violação de serigrafia */
  ({ j } = await chama('regras_casa_verificar', { projeto: PROJ }));
  assert.strictEqual(typeof j.ok, 'boolean'); assert.ok(Array.isArray(j.furos_parafuso)); assert.ok(j.camadas.includes('Top'));
  const antes = j.por_regra.serigrafia || 0;
  const pads = (await chama('pcb_consultar', { projeto: PROJ, tipo: 'pads', limite: 50 })).j.itens.filter(p => p.type === 'th' || p.layer === 'Multi');
  assert.ok(pads.length, 'LM555 sem pad TH');
  const alvo = pads[0];
  let r = await chama('pcb_aplicar', { projeto: PROJ, ops: [{ op: 'text_add', layer: 'TopOverlay', text: 'XYZ', x: alvo.x, y: alvo.y, h: 1.5 }], note: 'teste da casa' });
  assert.ok(!r.erro && r.j.ok, JSON.stringify(r.j).slice(0, 300));
  ({ j } = await chama('regras_casa_verificar', { projeto: PROJ, regras: ['serigrafia'] }));
  assert.ok((j.por_regra.serigrafia || 0) > antes, 'texto em cima do pad não foi apontado');
  assert.ok(j.violacoes.some(v => v.regra === 'serigrafia' && /XYZ/.test(v.msg) && /pad/.test(v.msg)), 'a violação diz o texto e o pad');
  assert.ok(!j.por_regra.parafuso && !j.por_regra.plano_pad, 'regras filtradas');

  /* furo de parafuso informado: trilha cruzando o quadrado vira violação */
  r = await chama('pcb_aplicar', { projeto: PROJ, ops: [{ op: 'track_add', layer: 'Bottom', x1: alvo.x + 20, y1: alvo.y + 20, x2: alvo.x + 40, y2: alvo.y + 20, w: 0.3, net: '' }], note: 'teste da casa' });
  assert.ok(!r.erro && r.j.ok);
  ({ j } = await chama('regras_casa_verificar', { projeto: PROJ, regras: ['parafuso'], furos: [[alvo.x + 30, alvo.y + 20, 3.4]] }));
  assert.ok(j.por_regra.parafuso >= 1 && j.violacoes[0].camada === 'Bottom', 'trilha no quadrado do parafuso');
  assert.deepStrictEqual(j.furos_parafuso.find(f => f.origem === 'informado').quadrado,
    { x1: +(alvo.x + 30 - 4.7).toFixed(3), y1: +(alvo.y + 20 - 4.7).toFixed(3), x2: +(alvo.x + 30 + 4.7).toFixed(3), y2: +(alvo.y + 20 + 4.7).toFixed(3) });

  /* as skills novas: o texto tem a regra */
  ({ j } = await chama('skill_ler', { nome: 'pcb-cobre-sem-curto' }));
  assert.ok(/TODAS as camadas/.test(j.texto) && /meio do vão/i.test(j.texto) && /drc_rodar/.test(j.texto), 'pcb-cobre-sem-curto sem a regra');
  ({ j } = await chama('skill_ler', { nome: 'pcb-boas-praticas' }));
  assert.ok(/IPC-2221/.test(j.texto) && /acid trap/i.test(j.texto) && /Fontes/.test(j.texto), 'pcb-boas-praticas sem o checklist');
  ({ j } = await chama('skill_ler', { nome: 'pcb-verificar-antes-de-entregar' }));
  assert.ok(/aprovado: true/.test(j.texto) && /despejar:false/.test(j.texto), 'pcb-verificar-antes-de-entregar sem a sequência');
  ({ j } = await chama('skill_ler', { nome: 'pcb-producao-backplane' }));
  assert.ok(/CBM-DI251877/.test(j.texto) && /45°/.test(j.texto) && /Sem via/.test(j.texto) && /2,25 mm/.test(j.texto)
    && /furo\/2 \+ 3,05/.test(j.texto) && /regras_casa_verificar/.test(j.texto), 'pcb-producao-backplane sem a técnica');
  assert.ok(/conectores laterais.*0,8 mm/.test(j.texto) && /plano de terra pode passar por baixo do overlay/i.test(j.texto), 'pcb-producao-backplane sem borne em 0,8 / plano sob overlay');
  ({ j } = await chama('skill_ler', { nome: 'pcb-serigrafia-livre' }));
  assert.ok(/plano de terra pode passar por baixo do overlay/i.test(j.texto) && /fill/.test(j.texto), 'pcb-serigrafia-livre sem a liberação do plano');
  ({ j } = await chama('skill_ler', { nome: 'pcb-boas-praticas' }));
  assert.ok(/borne \/ conector lateral/.test(j.texto) && /0,8 mm/.test(j.texto), 'pcb-boas-praticas sem a trilha de borne');

  /* trilha de OUTRA net passando por cima de um pad passante = CURTO (pad_outra_net), em qualquer camada */
  const comNet = pads.find(q => q.net) || alvo;
  const outra = (comNet.net === 'TESTE_OUTRA' ? 'TESTE_OUTRA2' : 'TESTE_OUTRA');
  r = await chama('pcb_aplicar', { projeto: PROJ, ops: [
    { op: 'net_add', net: outra },
    { op: 'track_add', layer: 'Bottom', x1: comNet.x, y1: comNet.y - 3, x2: comNet.x, y2: comNet.y + 3, w: 0.254, net: outra }], note: 'teste da casa: curto' });
  assert.ok(!r.erro && r.j.ok, 'track_add de outra net: ' + JSON.stringify(r.j).slice(0, 400));
  ({ j } = await chama('regras_casa_verificar', { projeto: PROJ, regras: ['pad_outra_net'] }));
  const curto = j.violacoes.find(v => v.regra === 'pad_outra_net' && /CURTO/.test(v.msg) && v.camada === 'Bottom' && Math.abs(v.x - comNet.x) < 1e-3 && Math.abs(v.y - comNet.y) < 1e-3);
  assert.ok(curto, 'trilha de outra net por cima do pad não virou CURTO: ' + JSON.stringify(j.violacoes.slice(0, 3)));
  assert.strictEqual(curto.contra.net, outra);
  assert.ok(typeof j.parametros.folga_cobre === 'number' && j.parametros.folga_cobre > 0, 'folga da Clearance do projeto');
  /* o DRC (com o cobre como a tela) também acusa */
  ({ j } = await chama('drc_rodar', { projeto: PROJ, limite: 500 }));
  assert.ok(!j.aprovado && j.violacoes.some(v => /Clearance|Short/i.test(v.regra)), 'drc_rodar não viu o curto');

  /* trilha da MESMA net cruzando o pad sem terminar nele = trilha_sobre_pad */
  if (comNet.net) {
    r = await chama('pcb_aplicar', { projeto: PROJ, ops: [{ op: 'track_add', layer: 'Top', x1: comNet.x - 3, y1: comNet.y, x2: comNet.x + 3, y2: comNet.y, w: 0.254, net: comNet.net }], note: 'teste da casa: atravessa' });
    assert.ok(!r.erro && r.j.ok, 'track_add da mesma net: ' + JSON.stringify(r.j).slice(0, 400));
    ({ j } = await chama('regras_casa_verificar', { projeto: PROJ, regras: ['trilha_sobre_pad'] }));
    assert.ok(j.violacoes.some(v => v.regra === 'trilha_sobre_pad' && v.camada === 'Top' && /passa reto por cima do pad/.test(v.msg) && Math.abs(v.x - comNet.x) < 1e-3),
      'trilha cruzando o pad da mesma net não foi apontada: ' + JSON.stringify(j.violacoes.slice(0, 3)));
    /* trilha que TERMINA no pad é ligação normal */
    const antesT = j.violacoes.length;
    r = await chama('pcb_aplicar', { projeto: PROJ, ops: [{ op: 'track_add', layer: 'Top', x1: comNet.x, y1: comNet.y, x2: comNet.x, y2: comNet.y - 4, w: 0.254, net: comNet.net }], note: 'teste da casa: termina' });
    assert.ok(!r.erro && r.j.ok);
    ({ j } = await chama('regras_casa_verificar', { projeto: PROJ, regras: ['trilha_sobre_pad'] }));
    assert.strictEqual(j.violacoes.length, antesT, 'trilha que termina no pad não pode virar violação');
  }

  /* poly_add com os campos novos (clearanceTipo, clearanceNet, conexao) e o erro de campo ruim */
  const base = { op: 'poly_add', layer: 'Top', net: 'GND', pts: [[alvo.x - 5, alvo.y - 5], [alvo.x + 5, alvo.y - 5], [alvo.x + 5, alvo.y + 5], [alvo.x - 5, alvo.y + 5]] };
  r = await chama('pcb_aplicar', { projeto: PROJ, simular: true, ops: [Object.assign({ clearanceTipo: { th: 1, smd: 1 }, clearanceNet: { VCC: { '*': 0.5 } }, conexao: { tipo: 'relief', condutores: 4, largura: 0.381, gap: 0.3, angulo: 45 } }, base)] });
  assert.ok(!r.erro && r.j.ok, 'poly_add com clearanceTipo/conexao: ' + JSON.stringify(r.j).slice(0, 400));
  r = await chama('pcb_aplicar', { projeto: PROJ, simular: true, ops: [Object.assign({ clearanceTipo: { banana: 1 } }, base)] });
  assert.ok(r.erro || r.j.ok === false, 'clearanceTipo com tipo desconhecido tem de ser recusado: ' + JSON.stringify(r).slice(0, 700));
  const hc = require('../hub-core.js');
  const B = { board: { bbox: { x1: 0, y1: 0, x2: 100, y2: 100 } }, components: [], tracks: [], arcs: [], vias: [], texts: [], fills: [], regions: [], polygons: [], nets: ['GND'] };
  const ap = hc.applyPcbChanges(B, [Object.assign({ clearanceTipo: { th: 1 }, conexao: { tipo: 'relief', gap: 0.3 } }, base, { pts: [[1, 1], [9, 1], [9, 9], [1, 9]] })]);
  const eb = hc.effectiveBoard(B, ap);
  const pol = (eb.polygons || []).find(q => q.net === 'GND');
  assert.ok(pol, 'polígono no board efetivo');
  assert.deepStrictEqual(pol.clearanceTipo, { th: 1 });
  assert.strictEqual(pol.conexao.tipo, 'relief'); assert.strictEqual(pol.conexao.gap, 0.3);

  /* drc_rodar / nets_ratsnest / pcb_render com os planos despejados como a tela (despejar:false = o jeito antigo) */
  r = await chama('pcb_aplicar', { projeto: PROJ, ops: [Object.assign({}, base, { net: comNet.net || 'GND', pourOver: 'all', removeDead: true })], note: 'teste da casa: plano' });
  assert.ok(!r.erro && r.j.ok, 'poly_add: ' + JSON.stringify(r.j).slice(0, 400));
  ({ j } = await chama('drc_rodar', { projeto: PROJ, limite: 5 }));
  assert.ok(j.despejo && j.despejo.poligonos === 1 && j.despejo.regioes >= 1 && Array.isArray(j.despejo.altium_sem_poligono), 'drc_rodar sem despejo: ' + JSON.stringify(j.despejo));
  ({ j } = await chama('drc_rodar', { projeto: PROJ, limite: 5, despejar: false }));
  assert.ok(/despejar:false/.test(j.despejo), 'drc_rodar despejar:false');
  ({ j } = await chama('nets_ratsnest', { projeto: PROJ }));
  assert.strictEqual(typeof j.nets_pendentes, 'number');
  const img = await c.pede('tools/call', { name: 'pcb_render', arguments: { projeto: PROJ, largura: 300 } });
  assert.ok(img.result && img.result.content.some(x => x.type === 'image'), 'pcb_render com despejo');

  c.fim();
  assert.strictEqual(fs.readFileSync(path.join(RAIZ, 'Projects', PROJ, 'board.js'), 'utf8'), realAntes, 'o Projects real foi tocado');
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-mcp-casa: ok');
})().catch(e => { console.error(e); process.exit(1); });
