/* A VARIANTE DE PROJETO (1.88.0) do lado do JS: hub-variantes.js (o que a vista, o hub e o MCP usam), o BOM e a Neoden sem
   o suprimido, o Gerber igual ao da padrão, o rótulo da árvore pelo nome da PCB (hub-catalogo.js), o quadro da folha (o
   NomeDoEquipamento sai; a variante entra no lugar dele) e o MCP (variante_listar/ativar/suprimir, bom_listar e a trava de
   gravação com a variante ativa), numa CÓPIA de Projects/LM555 astável.
     node tests/test-variantes.js */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

const V = require('../hub-variantes.js');
const HC = require('../hub-core.js');
const HubBom = require('../hub-bom.js');
const T = require('../hub-schtemplate.js');

let ok = 0;
const t = (nome, fn) => { fn(); ok++; };
const comp = (ref, o) => Object.assign({ t: 'comp', sheet: 'S1', ref, sym: 'RES', part: 1, x: 0, y: 0, rot: 0, footprint: 'R0805', comment: '10k' }, o || {});
const SCH = { format: 'schmirror-v2', project: 'P', units: 'mil', params: 'CodigoDaPlaca=PAEL-DI261940;NomeDaPlaca=PLACA ADAPTADORA;CodigoDoEquipamento=EQ-DI1;NomeDoEquipamento=ENCODER',
  items: [{ t: 'sheet', name: 'S1' }, comp('R1'), comp('R2'), comp('U3', { sym: 'LM555', footprint: 'SOIC8', part: 1 }), comp('U3', { sym: 'LM555', footprint: 'SOIC8', part: 2 })] };
const VAR = { id: 'v0a1b2c3', nome: 'Sem timer', codigo: 'PAELST-DI261951', suprimidos: [{ ref: 'U3' }, { ref: 'X9' }] };

t('refs: só o que está no esquema; aplica marca todas as partes sem mexer no original', () => {
  assert.deepStrictEqual([...V.refs(SCH, VAR)], ['U3']);
  assert.strictEqual(V.refs(SCH, null).size, 0);
  const a = V.aplica(SCH, VAR);
  assert.deepStrictEqual(a.items.filter(i => i.suprimido).map(i => i.ref + '/' + i.part), ['U3/1', 'U3/2']);
  assert.ok(a.items.filter(i => i.suprimido).every(i => i.dnp === true));
  assert.ok(!SCH.items.some(i => i.dnp || i.suprimido), 'o esquema da padrão não muda');
  assert.deepStrictEqual([...HC.dnpRefs(a)], ['U3'], 'a regra de não montar de todo lugar vê o suprimido');
  assert.strictEqual(V.aplica(SCH, null), SCH);
});
t('códigos: virgem = PCB; montada = PCB na padrão; na variante (1.89.0) montada = código da placa + nome da variante, sem virgem; o equipamento é o da variante', () => {
  assert.deepStrictEqual(V.codigos(SCH, null), { placa: 'PAEL-DI261940', nomePlaca: 'PLACA ADAPTADORA', virgem: 'PAEL-DI261940', virgemVai: true, montada: 'PAEL-DI261940',
    equipamento: 'EQ-DI1', equipamentoProjeto: 'EQ-DI1', variante: null });
  const c = V.codigos(SCH, VAR);
  assert.deepStrictEqual([c.virgem, c.virgemVai, c.montada, c.variante.codigo, c.equipamento, c.equipamentoProjeto],
    ['PAEL-DI261940', false, 'PAEL-DI261940 SEM TIMER', 'PAELST-DI261951', 'PAELST-DI261951', 'EQ-DI1']);
  assert.strictEqual(V.montadaDaVariante('', 'sem  timer'), 'SEM TIMER', 'sem placa definida: só o nome');
  assert.strictEqual(V.codigos({ params: 'CodigoDaPlaca=PROJETO NÃO DEFINIDO' }, null).placa, '');
});
t('proibidos: o código da PCB, o equipamento do projeto (1.89.0) e o das outras variantes', () => {
  const est = { placa: { codigo: 'PAEL-DI261940' }, codigos: { equipamentoProjeto: 'EQ-DI1' }, variantes: [VAR, { id: 'v1', nome: 'B', codigo: 'PB-DI2' }] };
  const p = V.proibidos(est, 'v1');
  assert.ok(/código da PCB/.test(p['PAEL-DI261940']) && /Sem timer/.test(p['PAELST-DI261951']) && !p['PB-DI2']);
  assert.ok(/equipamento do projeto padrão/.test(p['EQ-DI1']));
  assert.strictEqual(V.sufixo(VAR), ' - variante PAELST-DI261951');
  assert.strictEqual(V.sufixo(null), '');
});
t('BOM e Neoden: o suprimido sai; a placa (Gerber) é a mesma da padrão', () => {
  const B = { board: { bbox: { x1: 0, y1: 0, x2: 20, y2: 20 }, outline: [[0, 0], [20, 0], [20, 20], [0, 20]] }, components: [
    { ref: 'R1', comment: '10k', footprint: 'R0805', layer: 'Top', x: 1, y: 1, rot: 0, pads: [] },
    { ref: 'R2', comment: '10k', footprint: 'R0805', layer: 'Top', x: 3, y: 1, rot: 0, pads: [] },
    { ref: 'U3', comment: 'LM555', footprint: 'SOIC8', layer: 'Top', x: 9, y: 9, rot: 0, pads: [] }] };
  const sup = V.refs(SCH, VAR);
  const m = HubBom.model(V.filtraPlaca(B, sup));
  assert.deepStrictEqual(m.comps.map(c => c.ref).sort(), ['R1', 'R2'], 'fora do BOM (não é "não montar": naquele produto ele não existe)');
  assert.strictEqual(B.components.length, 3, 'a placa da padrão não muda');
  const nd = HC.neodenTransform(B.components.map(c => Object.assign({ pads: [{ x: c.x, y: c.y, smd: true }] }, c)), { exclude: [...HC.dnpRefs(V.aplica(SCH, VAR))] });
  if (!nd.error) assert.ok(nd.rows.find(r => r.des === 'U3').excluded, 'fora do CSV da Neoden');
  /* o Gerber sai da placa (board + changes), que a variante nunca toca: o mesmo conjunto */
  const HG = require('../hub-gerber.js');
  const g1 = HG.gerar(B, {}), g2 = HG.gerar(B, {});
  assert.deepStrictEqual(g1.arquivos.map(a => a.nome + a.texto.length), g2.arquivos.map(a => a.nome + a.texto.length));
  assert.ok(!/variante/i.test(fs.readFileSync(path.join(__dirname, '..', 'hub-gerber.js'), 'utf8')), 'o gerador do Gerber não conhece variante');
});
t('árvore: o nome da PCB, o código ao lado, a pasta sem placa', () => {
  global.window = global.window || globalThis;
  require('../hub-catalogo.js');
  const C = globalThis.HubCatalogo;
  const longo = 'PLACA ADAPTADORA ENCODER LINEAR COM UM NOME BEM MAIOR QUE VINTE E SETE CARACTERES';
  let r = C.rotuloProjeto({ name: 'PAEL-DI261940', placa: { codigo: 'PAEL-DI261940', nome: longo } });
  assert.deepStrictEqual([r.nome, r.codigo, r.definida], [longo, 'PAEL-DI261940', true], 'o nome da PCB, sem limite');
  assert.ok(r.busca.includes('encoder') && r.busca.includes('pael-di261940') && r.busca.includes(r.pasta.toLowerCase()), 'a busca acha pelo nome, código e pasta');
  r = C.rotuloProjeto({ name: 'LM555 astável', placa: { codigo: '', nome: '' } });
  assert.deepStrictEqual([r.nome, r.definida], ['LM555 astável', false], 'sem placa: a pasta e a marca "PCB não definida"');
  r = C.rotuloProjeto({ name: 'X', placa: { codigo: 'PX-DI1', nome: '' } });
  assert.ok(r.semNome && r.nome === 'PX-DI1', 'código sem nome: o código até o catálogo responder');
  assert.ok(C.placaSemP({ grupo: 'placa', modelo: 'ISO-DI181526' }) && !C.placaSemP({ grupo: 'placa', modelo: 'PISO-DI1' }) && !C.placaSemP({ grupo: 'cabo', modelo: 'X' }));
});
t('quadro da folha: o nome do equipamento sai; com a variante (1.89.0) o EQUIPAMENTO é o código da variante e a linha VARIANTE sai', () => {
  const c = T.contexto({ proj: SCH.params });
  assert.strictEqual(T.valor('NomeDoEquipamento', c), '', 'só o código do equipamento vai ao quadro');
  assert.strictEqual(T.valor('CodigoDoEquipamento', c), 'EQ-DI1');
  assert.strictEqual(T.valor('CodigoDaPlaca', c), 'PAEL-DI261940');
  T.setVariante(VAR);
  try {
    assert.strictEqual(T.valor('NomeDoEquipamento', T.contexto({ proj: SCH.params })), '', 'a linha "VARIANTE …" saiu (a barra da vista diz o nome)');
    assert.strictEqual(T.valor('CodigoDoEquipamento', T.contexto({ proj: SCH.params })), 'PAELST-DI261951', 'o equipamento da variante');
    assert.strictEqual(T.valor('CodigoDoEquipamento', T.contexto({ proj: SCH.params, variante: null })), 'EQ-DI1', 'na padrão, o do projeto');
    assert.strictEqual(T.valor('CodigoDaPlaca', T.contexto({ proj: SCH.params })), 'PAEL-DI261940', 'a placa é a mesma');
  } finally { T.setVariante(null); }
  assert.strictEqual(T.valor('CodigoDoEquipamento', T.contexto({})), T.NAO_DEFINIDO, 'sem código: PROJETO NÃO DEFINIDO');
});

/* ---------------- o MCP ---------------- */
const RAIZ = path.join(__dirname, '..');
const PROJ = 'LM555 astável';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-variantes-'));
const PROJETOS = path.join(TMP, 'Projects');
fs.mkdirSync(PROJETOS);
fs.cpSync(path.join(RAIZ, 'Projects', PROJ), path.join(PROJETOS, PROJ), { recursive: true });
const PD = path.join(PROJETOS, PROJ);
fs.writeFileSync(path.join(PD, 'changes.js'), HC.serializeChanges([]).text);
for (const f of ['equipe.json', 'variantes.json', '.variante-ativa.json']) try { fs.unlinkSync(path.join(PD, f)); } catch (_) { /* não tinha */ }
const sch0 = new Function(fs.readFileSync(path.join(PD, 'schematic.js'), 'utf8') + ';return schematic;')();
const refsDoEsq = [...new Set(sch0.items.filter(i => i.t === 'comp').map(i => String(i.ref)))];
const ALVO = refsDoEsq[0];
fs.writeFileSync(path.join(PD, 'variantes.json'), JSON.stringify({ formato: V.FORMATO, variantes: [
  { id: 'v0a1b2c3', nome: 'Sem ' + ALVO, codigo: 'PLMST-DI269999', suprimidos: [] }] }));

function cliente() {
  const p = spawn(process.execPath, [path.join(RAIZ, 'mcp', 'eletrichub-mcp.js'), '--root', RAIZ, '--projetos', PROJETOS], { stdio: ['pipe', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { ELETRICHUB_SEM_HISTORICO: '1', NEXOHUB_URL: 'http://127.0.0.1:9' }) });
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
  const pede = (method, params) => new Promise((res, falha) => {
    const n = ++id;
    const tm = setTimeout(() => falha(new Error('sem resposta a ' + method + '\n' + erro)), 120000);
    espera.set(n, m => { clearTimeout(tm); res(m); });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  });
  return { pede, avisa: (method, params) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'), fim: () => p.stdin.end() };
}

(async () => {
  const c = cliente();
  const chama = async (name, args) => {
    const r = await c.pede('tools/call', { name, arguments: args });
    assert.ok(r.result, name + ': ' + JSON.stringify(r.error));
    return { j: (() => { try { return JSON.parse(r.result.content[0].text); } catch (_) { return {}; } })(), texto: r.result.content[0].text, erro: !!r.result.isError };
  };
  await c.pede('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '0' } });
  c.avisa('notifications/initialized', {});
  const refsBom = j => j.linhas.flatMap(l => l.refs);

  let r = await chama('variante_listar', { projeto: PROJ });
  assert.ok(!r.erro && r.j.ativa === null && r.j.variantes.length === 1, r.texto);
  r = await chama('variante_suprimir', { projeto: PROJ, refs: [ALVO] });
  assert.ok(r.erro && /nenhuma variante ativa/.test(r.texto), 'na padrão não se suprime');
  r = await chama('variante_ativar', { projeto: PROJ, id: 'v0a1b2c3' });
  assert.ok(!r.erro && r.j.ativa.codigo === 'PLMST-DI269999' && r.j.codigos.montada === V.montadaDaVariante(r.j.codigos.placa, 'Sem ' + ALVO) && r.j.codigos.virgemVai === false, r.texto);
  r = await chama('variante_suprimir', { projeto: PROJ, refs: [ALVO, 'ZZ999'] });
  assert.ok(r.erro && /não estão no esquema: ZZ999/.test(r.texto), r.texto);
  const schAntes = fs.readFileSync(path.join(PD, 'schematic.js'), 'utf8');
  r = await chama('variante_suprimir', { projeto: PROJ, refs: [ALVO] });
  assert.ok(!r.erro && r.j.mudou[0] === ALVO, r.texto);
  assert.strictEqual(fs.readFileSync(path.join(PD, 'schematic.js'), 'utf8'), schAntes, 'o esquema não muda');
  r = await chama('bom_listar', { projeto: PROJ, fonte: 'esquema' });
  assert.ok(!refsBom(r.j).includes(ALVO) && r.j.suprimidos[0] === ALVO && r.j.variante.codigo === 'PLMST-DI269999', r.texto);
  /* a trava: com a variante ativa a IA não muda o esquema (sch_nao_montar grava o schematic.js) */
  r = await chama('sch_nao_montar', { projeto: PROJ, refs: [refsDoEsq[1] || ALVO] });
  assert.ok(r.erro && /está ativa: a PCB é a mesma/.test(r.texto), r.texto);
  assert.strictEqual(fs.readFileSync(path.join(PD, 'schematic.js'), 'utf8'), schAntes);
  /* a padrão: volta tudo */
  r = await chama('variante_ativar', { projeto: PROJ });
  assert.ok(!r.erro && r.j.ativa === null);
  r = await chama('bom_listar', { projeto: PROJ, fonte: 'esquema' });
  assert.ok(refsBom(r.j).includes(ALVO) && !r.j.suprimidos, r.texto);
  r = await chama('variante_ativar', { projeto: PROJ, id: 'vnaoexiste' });
  assert.ok(r.erro, 'variante que não existe');
  c.fim();
  fs.rmSync(TMP, { recursive: true, force: true });
  ok++;
  console.log('test-variantes: ' + ok + ' ok');
})().catch(e => { console.error(e); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
