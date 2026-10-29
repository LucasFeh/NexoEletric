/* Serigrafia e despejo pelo MCP (NexoEletric 1.36.0), provados como um cliente os usaria, numa CÓPIA
   de Projects/LM555 astável (os Projects reais nunca são gravados):
     - designator_move no referencial EFETIVO (padrão): o x/y pedido é onde o texto fica, mesmo com o
       componente movido e girado; "original" grava como veio; a resposta traz a posição efetiva;
     - w (traço) no designator_move;
     - texto fora do contorno: aviso no pcb_aplicar e a checagem SilkOutsideBoard do DRC;
     - designator de componente criado por comp_add (vai na linha do comp_add e anda com ele);
     - pcb_consultar com campos e arquivo;
     - o despejo do polígono com a folga por classe das regras (HubPcbPour.comRegras).
     node tests/test-mcp-serigrafia.js */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'mcp', 'eletrichub-mcp.js');
const PROJ = 'LM555 astável';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eletrichub-silk-'));
const PROJETOS = path.join(TMP, 'Projects');
fs.mkdirSync(PROJETOS);
fs.cpSync(path.join(RAIZ, 'Projects', PROJ), path.join(PROJETOS, PROJ), { recursive: true });
const hc = require('../hub-core.js');
fs.writeFileSync(path.join(PROJETOS, PROJ, 'changes.js'), hc.serializeChanges([]).text);
const realAntes = fs.readFileSync(path.join(RAIZ, 'Projects', PROJ, 'board.js'), 'utf8');
const lerChanges = () => require('../mcp/lib/arquivo-linhas.js').ArquivoLinhas.abrir('changes', path.join(PROJETOS, PROJ, 'changes.js')).itens;
const perto = (a, b, t) => Math.abs(a - b) <= (t || 1e-3);

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

/* ---------- o despejo com as regras por classe (puro, sem MCP) ---------- */
function testaPourRegras() {
  const P = require('../hub-pcbpour.js'), RG = require('../hub-pcbregras.js');
  const eb = {
    board: { bbox: { x1: 0, y1: 0, x2: 40, y2: 20 }, outline: [
      { x1: 0, y1: 0, x2: 40, y2: 0 }, { x1: 40, y1: 0, x2: 40, y2: 20 }, { x1: 40, y1: 20, x2: 0, y2: 20 }, { x1: 0, y1: 20, x2: 0, y2: 0 }] },
    tracks: [{ id: 't1', layer: 'Top', net: 'FASE', x1: 10, y1: 10, x2: 30, y2: 10, w: 0.5 },
             { id: 't2', layer: 'Top', net: 'SINAL', x1: 10, y1: 4, x2: 30, y2: 4, w: 0.5 }],
    polygons: [{ id: 'pg1', layer: 'Top', net: 'GND', pts: [[1, 1], [39, 1], [39, 19], [1, 19]], pour: 'solid', clearance: 0.2 }],
  };
  const S = RG.padroes();
  const r = RG.novaRegra(S, 'Clearance');
  Object.assign(r, { name: 'Fase x resto', priority: 1, scope1: "InNet('FASE')", scope2: 'All', gap: 1.5 });
  S.rules.unshift(r);                      /* na frente da geral: prioridade 1 depois do normaliza */
  const R = RG.normaliza(S);
  const eb2 = P.comRegras(eb, R);
  const pol = eb2.polygons[0];
  assert.ok(pol.clearanceNet && pol.clearanceNet.FASE && perto(pol.clearanceNet.FASE.track, 1.5), 'a folga da classe no polígono: ' + JSON.stringify(pol.clearanceNet));
  assert.ok(!pol.clearanceNet.SINAL || !(pol.clearanceNet.SINAL.track > 0.2 + 1e-9) || perto(pol.clearanceNet.SINAL.track, RG.folgaEntre(R, { tipo: 'region', poly: true, net: 'GND', layer: 'Top' }, { tipo: 'track', net: 'SINAL', layer: 'Top' }).gap),
    'SINAL fica com a regra geral');
  assert.strictEqual(eb.polygons[0].clearanceNet, undefined, 'não mexe na placa de entrada');
  /* o despejo respeita: nenhum ponto do cobre a menos de 1,5 mm da borda da trilha FASE */
  /* a folga do cobre até a borda da trilha FASE (y = 10, meia largura 0,25), pelo contorno e pelos furos */
  const folgaFase = d => {
    let min = Infinity;
    for (const g of d.regioes) for (const anel of [g.pts].concat(g.holes || []))
      for (const [x, y] of anel) if (x >= 10 - 1e-6 && x <= 30 + 1e-6 && Math.abs(y - 10) < 3) min = Math.min(min, Math.abs(y - 10) - 0.25);
    return min;
  };
  const f = folgaFase(P.despeja(eb2, pol));
  assert.ok(f >= 1.5 - 0.02 && f < 1.6, 'cobre a ' + f.toFixed(3) + ' mm da trilha FASE (regra 1,5)');
  /* sem as regras, a folga do polígono (0,2) */
  const f0 = folgaFase(P.despeja(eb, eb.polygons[0]));
  assert.ok(f0 < 0.3, 'sem regras o despejo fica na folga do polígono: ' + f0);
}

(async () => {
  testaPourRegras();

  const c = cliente();
  const chama = async (name, args) => {
    const r = await c.pede('tools/call', { name, arguments: args });
    assert.ok(r.result, name + ': ' + JSON.stringify(r.error));
    return { j: JSON.parse(r.result.content[0].text), erro: !!r.result.isError };
  };
  await c.pede('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '0' } });
  c.avisa('notifications/initialized', {});

  /* R4 anda 2 mm e gira 90 graus */
  let { j, erro } = await chama('pcb_mover', { projeto: PROJ, ref: 'R4', dx: 2, drot: 90 });
  assert.ok(!erro && j.gravado, 'pcb_mover: ' + JSON.stringify(j).slice(0, 300));
  const R4 = j.componente;

  /* 1. designator no referencial efetivo: fica onde foi pedido */
  const alvo = { x: R4.x + 0.3, y: R4.y + 2.2 };
  ({ j, erro } = await chama('pcb_aplicar', { projeto: PROJ, ops: [{ op: 'designator_move', ref: 'R4', x: alvo.x, y: alvo.y, h: 0.7, w: 0.12 }] }));
  assert.ok(!erro && j.ok && j.gravado, 'designator_move: ' + JSON.stringify(j).slice(0, 500));
  assert.ok(Array.isArray(j.textos) && j.textos.length === 1, 'a resposta traz a posição efetiva');
  const t = j.textos[0];
  assert.ok(perto(t.efetivo.x, alvo.x) && perto(t.efetivo.y, alvo.y), `ficou em ${JSON.stringify(t.efetivo)}, pedido ${JSON.stringify(alvo)}`);
  assert.strictEqual(t.diferenca_mm, undefined, 'sem diferença entre pedido e efetivo');
  assert.ok(perto(t.efetivo.h, 0.7) && perto(t.efetivo.w, 0.12), 'h e w no texto: ' + JSON.stringify(t.efetivo));
  assert.notStrictEqual(t.fora_da_placa, true);
  let ch = lerChanges();
  const iDes = ch.findIndex(x => x.op === 'designator_move' && x.ref === 'R4'), iMov = ch.findIndex(x => x.op === 'comp_move' && x.ref === 'R4');
  assert.ok(iDes >= 0 && iMov > iDes, 'designator_move antes do comp_move');
  assert.ok(perto(ch[iDes].w, 0.12), 'w gravado na linha');
  assert.ok(!('referencial' in ch[iDes]), 'o campo referencial não vai para o changes.js');

  /* 2. referencial original: grava como veio (e a resposta mostra a diferença) */
  ({ j } = await chama('pcb_aplicar', { projeto: PROJ, simular: true, ops: [{ op: 'designator_move', ref: 'R4', x: alvo.x, y: alvo.y, referencial: 'original' }] }));
  assert.ok(j.simulado && j.textos[0].diferenca_mm > 0.1, 'original: o texto anda com o componente depois: ' + JSON.stringify(j.textos));
  ({ j, erro } = await chama('pcb_aplicar', { projeto: PROJ, simular: true, ops: [{ op: 'designator_move', ref: 'R4', x: 1, y: 1, referencial: 'banana' }] }));
  assert.ok(erro, 'referencial inválido é recusado');

  /* 3. fora da placa: o pcb_aplicar avisa e o DRC acusa */
  ({ j, erro } = await chama('pcb_aplicar', { projeto: PROJ, ops: [{ op: 'designator_move', ref: 'R3', x: 200, y: 200 }] }));
  assert.ok(!erro && j.gravado && j.textos[0].fora_da_placa === true && /FORA do contorno/.test(j.avisos_textos), 'aviso de fora da placa: ' + JSON.stringify(j).slice(0, 400));
  ({ j } = await chama('drc_rodar', { projeto: PROJ, tipos: ['SilkOutsideBoard'] }));
  const fora = (j.violacoes || []).filter(v => v.tipo === 'SilkOutsideBoard');
  assert.ok(fora.length >= 1 && fora.some(v => /R3/.test(v.msg)), 'DRC SilkOutsideBoard: ' + JSON.stringify(j).slice(0, 600));
  ({ j } = await chama('regras_casa_verificar', { projeto: PROJ, regras: ['serigrafia'] }));
  assert.ok((j.violacoes || []).some(v => /"R3"/.test(v.msg) && /borda da placa/.test(v.msg)), 'regras da casa: R3 fora da placa');

  /* 4. componente criado por comp_add: o designator vai na linha do comp_add e anda com ele */
  const R1 = (await chama('pcb_componente', { projeto: PROJ, ref: 'R1' })).j;
  ({ j, erro } = await chama('pcb_aplicar', { projeto: PROJ, ops: [{ op: 'comp_add', ref: 'R9', footprint: R1.footprint, x: 78, y: 34, rot: 0, layer: 'Top' }] }));
  assert.ok(!erro && j.ok, 'comp_add: ' + JSON.stringify(j).slice(0, 400));
  ({ j, erro } = await chama('pcb_aplicar', { projeto: PROJ, ops: [{ op: 'designator_move', ref: 'R9', x: 78, y: 36.5, h: 0.8, w: 0.1 }] }));
  assert.ok(!erro && j.ok, 'designator de comp_add: ' + JSON.stringify(j).slice(0, 400));
  assert.ok(perto(j.textos[0].efetivo.x, 78) && perto(j.textos[0].efetivo.y, 36.5), 'R9 onde foi pedido: ' + JSON.stringify(j.textos[0]));
  ch = lerChanges();
  const add = ch.find(x => x.op === 'comp_add' && x.ref === 'R9');
  assert.ok(add && perto(add.des_x, 78) && perto(add.des_y, 36.5) && perto(add.des_h, 0.8) && perto(add.des_w, 0.1), 'des_* na linha do comp_add: ' + JSON.stringify(add));
  assert.ok(!ch.some(x => x.op === 'designator_move' && x.ref === 'R9'), 'nenhum designator_move para o R9');
  ({ j, erro } = await chama('pcb_mover', { projeto: PROJ, ref: 'R9', dx: 1 }));
  assert.ok(!erro && j.gravado, 'mover R9');
  const add2 = lerChanges().find(x => x.op === 'comp_add' && x.ref === 'R9');
  assert.ok(perto(add2.des_x, 79) && perto(add2.des_y, 36.5), 'o designator anda com o comp_add: ' + JSON.stringify(add2));

  /* 8. pcb_consultar: campos e arquivo */
  ({ j } = await chama('pcb_consultar', { projeto: PROJ, tipo: 'pads', campos: ['id', 'x', 'y'], limite: 3 }));
  assert.ok(j.itens.length === 3 && Object.keys(j.itens[0]).every(k => ['id', 'x', 'y'].includes(k)), 'campos: ' + JSON.stringify(j.itens[0]));
  ({ j } = await chama('pcb_consultar', { projeto: PROJ, tipo: 'pads', arquivo: true }));
  assert.ok(j.arquivo && fs.existsSync(j.arquivo) && j.total > 3 && !j.itens, 'arquivo: ' + JSON.stringify(j).slice(0, 300));
  assert.strictEqual(JSON.parse(fs.readFileSync(j.arquivo, 'utf8')).itens.length, j.total);
  fs.rmSync(j.arquivo, { force: true });

  /* ===== etapa 2 (1.37.0) ===== */
  /* 7. regras da casa do projeto: sem arquivo vale o padrão; definir grava e o verificador segue */
  ({ j } = await chama('regras_casa_ler', { projeto: PROJ }));
  assert.ok(j.existe === false && j.valendo.texto_h_min === 1 && j.subregras.includes('serigrafia_trilha'), 'regras_casa_ler sem arquivo: ' + JSON.stringify(j).slice(0, 300));
  ({ j, erro } = await chama('regras_casa_definir', { projeto: PROJ, parametros: { banana: 1 } }));
  assert.ok(erro && /banana/.test(JSON.stringify(j)), 'parâmetro desconhecido é recusado');
  /* o R4 de 0,7 mm (item 1) viola a altura mínima da casa... */
  ({ j } = await chama('regras_casa_verificar', { projeto: PROJ, regras: ['serigrafia'] }));
  assert.ok(j.violacoes.some(v => v.sub === 'texto_tamanho' && /"R4"/.test(v.msg)), 'altura mínima acusada: ' + JSON.stringify(j.violacoes.map(v => v.msg)).slice(0, 500));
  /* ...até o projeto liberar */
  ({ j, erro } = await chama('regras_casa_definir', { projeto: PROJ, parametros: { texto_h_min: 0.6, texto_w_min: 0.1 }, note: 'teste' }));
  assert.ok(!erro && j.gravado && fs.existsSync(path.join(PROJETOS, PROJ, 'regras-casa.json')), 'regras_casa_definir grava');
  ({ j } = await chama('regras_casa_verificar', { projeto: PROJ, regras: ['serigrafia'] }));
  assert.ok(!j.violacoes.some(v => v.sub === 'texto_tamanho' && /"R4"/.test(v.msg)) && j.regras_do_projeto, 'liberado no projeto');
  /* a borda só acusa o que está perto da borda (1.36.0 somava os traços sobrepostos da fonte e
     acusava quase todo texto): o designator do CI1, no meio da placa, não */
  assert.ok(!j.violacoes.some(v => v.sub === 'serigrafia_borda' && /"CI1"/.test(v.msg)), 'borda falsa: ' + JSON.stringify(j.violacoes.filter(v => v.sub === 'serigrafia_borda').map(v => v.msg)));

  /* 6. serigrafia_checar: um lugar em cima de um pad do CI1 viola; a área que desliga libera */
  const CI1 = (await chama('pcb_componente', { projeto: PROJ, ref: 'CI1' })).j;
  const pad = CI1.pads[0];
  ({ j } = await chama('serigrafia_checar', { projeto: PROJ, textos: [{ ref: 'T1', x: pad.x, y: pad.y }] }));
  assert.ok(!j.ok && j.textos[0].violacoes.some(v => v.regra === 'serigrafia_pad'), 'em cima do pad: ' + JSON.stringify(j).slice(0, 400));
  assert.ok(j.ms < 5000, 'checagem rápida: ' + j.ms + ' ms');
  ({ j, erro } = await chama('regras_casa_definir', { projeto: PROJ, areas: [{ nome: 'teste', caixa: { x1: pad.x - 3, y1: pad.y - 3, x2: pad.x + 3, y2: pad.y + 3 }, desligar: ['serigrafia_pad', 'serigrafia_silk', 'serigrafia_trilha'] }] }));
  assert.ok(!erro, 'área: ' + JSON.stringify(j).slice(0, 300));
  ({ j } = await chama('serigrafia_checar', { projeto: PROJ, textos: [{ ref: 'T1', x: pad.x, y: pad.y }] }));
  assert.ok(!j.textos[0].violacoes.some(v => v.regra === 'serigrafia_pad'), 'a área libera pad: ' + JSON.stringify(j.textos[0]));
  ({ j } = await chama('regras_casa_definir', { projeto: PROJ, areas: [] }));

  /* 5. serigrafia_posicionar: o R3 (fora da placa, item 3) ganha um lugar livre; simula por padrão */
  const antesCh = fs.readFileSync(path.join(PROJETOS, PROJ, 'changes.js'), 'utf8');
  ({ j, erro } = await chama('serigrafia_posicionar', { projeto: PROJ, refs: ['R3'], todos: true, altura_min: 0.8, altura_max: 1 }));
  assert.ok(!erro && j.movidos === 1 && j.gravado === false, 'posicionar simula: ' + JSON.stringify(j).slice(0, 700));
  assert.strictEqual(fs.readFileSync(path.join(PROJETOS, PROJ, 'changes.js'), 'utf8'), antesCh, 'simular não grava');
  const novo = j.posicoes[0].para;
  assert.ok(novo.h >= 0.8 - 1e-9 && novo.h <= 1 + 1e-9, 'altura dentro da faixa');
  /* o lugar escolhido passa no serigrafia_checar (mesma conta), com corpo e ambiguidade */
  ({ j } = await chama('serigrafia_checar', { projeto: PROJ, textos: [{ ref: 'R3', x: novo.x, y: novo.y, h: novo.h, w: novo.w, rot: novo.rot }], corpo: 'todos', ambiguidade: true }));
  assert.ok(j.ok, 'o lugar do posicionador é limpo: ' + JSON.stringify(j.textos[0]));
  ({ j, erro } = await chama('serigrafia_posicionar', { projeto: PROJ, refs: ['R3'], todos: true, altura_min: 0.8, altura_max: 1, gravar: true }));
  assert.ok(!erro && j.gravado, 'posicionar grava: ' + JSON.stringify(j).slice(0, 500));
  ({ j } = await chama('regras_casa_verificar', { projeto: PROJ, regras: ['serigrafia'] }));
  assert.ok(!j.violacoes.some(v => v.objeto && v.objeto.owner === 'R3' && v.objeto.tipo === 'texto'), 'R3 limpo no verificador: ' + JSON.stringify(j.violacoes.filter(v => v.objeto && v.objeto.owner === 'R3')));
  ({ j } = await chama('pcb_componente', { projeto: PROJ, ref: 'R3' }));
  const desR3 = j.textos.find(t => t.designator);
  assert.ok(perto(desR3.x, novo.x) && perto(desR3.y, novo.y), 'R3 no lugar escolhido: ' + JSON.stringify(desR3));
  /* modo fileira roda (R1/R2 são do mesmo footprint) */
  ({ j, erro } = await chama('serigrafia_posicionar', { projeto: PROJ, refs: ['R1', 'R2'], todos: true, modo: 'fileira' }));
  assert.ok(!erro && j.modo === 'fileira' && j.analisados === 2, 'fileira: ' + JSON.stringify(j).slice(0, 400));
  /* refs que não existem voltam em nao_achados */
  ({ j } = await chama('serigrafia_posicionar', { projeto: PROJ, refs: ['ZZ9'] }));
  assert.deepStrictEqual(j.nao_achados, ['ZZ9']);

  /* 6b. pcb_aplicar drc:true: a trilha nova por cima de um pad de outra net aparece em "novas" */
  const outro = CI1.pads.find(q => q.net && q.net !== pad.net) || CI1.pads[1];
  ({ j, erro } = await chama('pcb_aplicar', { projeto: PROJ, simular: true, drc: true,
    ops: [{ op: 'track_add', layer: 'Top', x1: outro.x - 2, y1: outro.y, x2: outro.x + 2, y2: outro.y, w: 0.3, net: 'NETX_TESTE' }] }));
  assert.ok(!erro && j.drc && j.drc.novas >= 1 && j.drc.depois > j.drc.antes - j.drc.sairam - 1, 'drc antes/depois: ' + JSON.stringify(j.drc || j).slice(0, 500));

  c.fim();
  assert.strictEqual(fs.readFileSync(path.join(RAIZ, 'Projects', PROJ, 'board.js'), 'utf8'), realAntes, 'o Projects real foi tocado');
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-mcp-serigrafia: ok');
})().catch(e => { console.error(e); process.exit(1); });
