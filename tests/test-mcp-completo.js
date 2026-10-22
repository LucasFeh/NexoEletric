/* As ferramentas novas do MCP (NexoEletric 1.16): raiz achada sozinha, símbolos (gerar, salvar no
   projeto, usar no esquema, renomear, apagar), 3D do disco no footprint, componente avulso na placa,
   lote com "$id.campo", e o relato ao hub (o indicador "IA" no topo).
     node tests/test-mcp-completo.js
   Roda numa pasta temporária com cópia do hub e do "LM555 astável": nada do repositório é gravado. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

const RAIZ = path.join(__dirname, '..');
delete process.env.ELETRICHUB_SEM_RELATO;    /* este teste confere o relato ao hub */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-completo-'));
const ROOT = path.join(TMP, 'hub');
fs.mkdirSync(path.join(ROOT, 'Libs'), { recursive: true });
for (const f of fs.readdirSync(RAIZ)) if (/^hub-.*\.js$/.test(f)) fs.copyFileSync(path.join(RAIZ, f), path.join(ROOT, f));
for (const f of fs.readdirSync(path.join(RAIZ, 'Libs'))) if (/\.(js|json)$/.test(f)) fs.copyFileSync(path.join(RAIZ, 'Libs', f), path.join(ROOT, 'Libs', f));
const PROJ = 'LM555 astável';
fs.cpSync(path.join(RAIZ, 'Projects', PROJ), path.join(ROOT, 'Projects', PROJ), { recursive: true });
const hc = require('../hub-core.js');
fs.writeFileSync(path.join(ROOT, 'Projects', PROJ, 'changes.js'), hc.serializeChanges([]).text);

/* um hub falso: responde como o hubserver (index e status do MCP) e guarda o que o relato manda */
const recebidos = [];
const hub = http.createServer((q, r) => {
  let corpo = '';
  q.on('data', d => { corpo += d; });
  q.on('end', () => {
    r.setHeader('Content-Type', 'application/json');
    if (q.url === '/api/index.json') return r.end(JSON.stringify({ projects: [] }));
    if (q.url === '/api/mcp/status') return r.end(JSON.stringify({ ok: true, root: ROOT, vistas: [] }));
    if (q.url === '/api/mcp/ola' || q.url === '/api/mcp/atividade') { recebidos.push({ url: q.url, corpo: JSON.parse(corpo) }); return r.end('{"ok":true}'); }
    r.statusCode = 404; r.end('{}');
  });
});

(async () => {
  await new Promise(ok => hub.listen(0, '127.0.0.1', ok));
  const HUB = 'http://127.0.0.1:' + hub.address().port;

  /* ---------- a raiz: --root errado não derruba; cai na pasta de trabalho do app ---------- */
  const { resolveRaiz } = require('../mcp/lib/contexto.js');
  const appdata = path.join(TMP, 'appdata');
  fs.mkdirSync(path.join(appdata, 'NexoEletric'), { recursive: true });
  fs.writeFileSync(path.join(appdata, 'NexoEletric', 'settings.json'), JSON.stringify({ workspace: ROOT }));
  const antes = { APPDATA: process.env.APPDATA, S: process.env.NEXOELETRIC_SESSION };
  process.env.APPDATA = appdata;
  process.env.NEXOELETRIC_SESSION = path.join(TMP, 'sem-sessao.json');
  const r0 = resolveRaiz(path.join(TMP, 'NexoEletric-que-nao-existe'));
  assert.strictEqual(r0.root, path.resolve(ROOT), 'cai na pasta de trabalho do settings.json');
  assert.match(r0.aviso, /ignorado/);
  /* com o app aberto, o session.json manda (e o hub dele) */
  fs.writeFileSync(process.env.NEXOELETRIC_SESSION, JSON.stringify({ root: ROOT, hub: HUB, pid: process.pid }));
  const r1 = resolveRaiz(null);
  assert.strictEqual(r1.origem, 'app aberto (session.json)');

  const { montaServidor } = require('../mcp/eletrichub-mcp.js');
  const srv = montaServidor({ log: () => {} });
  assert.strictEqual(srv.ctx.root, path.resolve(ROOT));
  assert.strictEqual(srv.ctx.hubUrl, HUB, 'o hub vem do session.json');
  let id = 0;
  const chama = async (name, args) => {
    const r = await srv.atende({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const o = JSON.parse(r.result.content[0].text);
    if (r.result.isError) throw new Error(name + ': ' + (o.erro || JSON.stringify(o)));
    return o;
  };
  await srv.atende({ jsonrpc: '2.0', id: ++id, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code', version: '2.1' } } });

  /* ---------- símbolo: gerar um CI, salvar no projeto, usar no esquema ---------- */
  const pcblib = require('../mcp/lib/arquivo-linhas.js').lerVar(path.join(ROOT, 'Libs', 'pcblib.js'), 'pcblib');
  const FP = pcblib.footprints.find(f => (f.pads || []).length >= 8).name;
  const g = await chama('sym_gerar', { nome: 'CI-TESTE-8P', designador: 'U?', distribuir: 'auto', footprint: FP,
    pinos: [{ num: '1', nome: 'GND', tipo: 'Power' }, { num: '2', nome: 'IN', tipo: 'Input' }, { num: '3', nome: 'OUT', tipo: 'Output' }, { num: '8', nome: 'VCC', tipo: 'Power' }],
    salvar_em: 'projeto', projeto: PROJ });
  assert.ok(g.gravado, 'sym_gerar com salvar_em grava no projeto');
  const sch = require('../mcp/lib/arquivo-linhas.js').lerVar(path.join(ROOT, 'Projects', PROJ, 'schematic.js'), 'schematic');
  assert.ok(sch.symbols.some(s => s.name === 'CI-TESTE-8P'), 'o símbolo está no schematic.js');
  const lido = await chama('sym_ler', { nome: 'CI-TESTE-8P', projeto: PROJ });
  assert.strictEqual(lido.origem, 'projeto');
  assert.strictEqual(lido.simbolo.parts[0].pins.length, 4);
  const vcc = lido.simbolo.parts[0].pins.find(p => p.name === 'VCC');
  assert.strictEqual(vcc.orient, 90, 'alimentação em cima');
  const add = await chama('sch_adicionar', { projeto: PROJ, itens: [{ t: 'comp', sym: 'CI-TESTE-8P', ref: 'U?', x: 8000, y: 6000 }] });
  assert.ok(add.gravado, 'o componente com o símbolo do projeto entra no esquema: ' + JSON.stringify(add.erros));
  const ref = add.tocados[0].item.ref;
  const comp = await chama('sch_componentes', { projeto: PROJ, refs: [ref] }).catch(() => null);
  if (comp) assert.ok(JSON.stringify(comp).includes('VCC'));
  await assert.rejects(chama('sym_apagar', { nome: 'CI-TESTE-8P', destino: 'projeto', projeto: PROJ }), /usam/);
  const ren = await chama('sym_renomear', { nome: 'CI-TESTE-8P', novo: 'CI-TESTE-8P-B', destino: 'projeto', projeto: PROJ });
  assert.strictEqual(ren.componentes_atualizados, 1);
  await assert.rejects(chama('sym_salvar', { destino: 'projeto', projeto: PROJ, simbolo: { name: 'RUIM', pins: [{ num: '1', name: 'A', x: 0, y: 0, len: 200, orient: 45, type: 'Passive' }], graphics: [] } }), /orient/);

  /* ---------- footprint + STEP do disco ---------- */
  await chama('fp_pacote', { tipo: 'chip', parametros: {}, nome: 'CHIP-TESTE' }).catch(async () => {
    await chama('fp_salvar', { footprint: { name: 'CHIP-TESTE', pads: [{ name: '1', type: 'smd', shape: 'rect', x: -0.8, y: 0, w: 0.8, h: 1, layer: 'Top' }, { name: '2', type: 'smd', shape: 'rect', x: 0.8, y: 0, w: 0.8, h: 1, layer: 'Top' }] } });
  });
  const step = path.join(TMP, 'peca.step');
  fs.writeFileSync(step, 'ISO-10303-21;\nHEADER;\nFILE_NAME(\'peca\');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');
  const f3 = await chama('fp_3d_importar', { footprint: 'CHIP-TESTE', arquivo: step, rotx: 90 });
  assert.ok(f3.corpos3d >= 1);
  assert.ok(fs.existsSync(path.join(ROOT, 'Libs', '3d-hub', f3.modelo.id + '.step')), 'o STEP foi para Libs/3d-hub');
  const fl = await chama('fp_ler', { nome: 'CHIP-TESTE' });
  assert.ok(JSON.stringify(fl).includes(f3.modelo.id), 'o footprint usa o modelo novo');
  assert.strictEqual(JSON.stringify(fl).split('"kind":"step"').length - 1, 1, 'um STEP só (o anterior sai)');
  await assert.rejects(chama('fp_3d_importar', { footprint: 'CHIP-TESTE', arquivo: path.join(RAIZ, 'README.md') }), /não é STEP/);

  /* ---------- componente avulso na placa ---------- */
  const resumo = await chama('pcb_resumo', { projeto: PROJ });
  const bb = resumo.bbox || (resumo.placa && resumo.placa.bbox) || { x1: 0, y1: 0, x2: 50, y2: 50 };
  const cx = ((bb.x1 || 0) + (bb.x2 || 50)) / 2, cy = ((bb.y1 || 0) + (bb.y2 || 50)) / 2;
  const col = await chama('pcb_colocar', { projeto: PROJ, ref: 'J99', footprint: 'CHIP-TESTE', x: cx, y: cy, nets: { 1: 'GND' } });
  assert.ok(col.gravado, 'pcb_colocar grava: ' + JSON.stringify(col.erros || col));
  await assert.rejects(chama('pcb_colocar', { projeto: PROJ, ref: 'J99', footprint: 'CHIP-TESTE', x: cx, y: cy }).then(() => chama('pcb_colocar', { projeto: PROJ, ref: 'J99', footprint: 'CHIP-TESTE', x: 0, y: 0 })), /já tem|J99/);

  /* ---------- lote com referência ao passo anterior ---------- */
  const lote = await chama('lote', { passos: [
    { id: 'g', ferramenta: 'sym_gerar', args: { nome: 'CON-2', designador: 'J?', pinos: ['A', 'B'] } },
    { id: 's', ferramenta: 'sym_salvar', args: { simbolo: '$g.simbolo', destino: 'projeto', projeto: PROJ } },
    { ferramenta: 'sym_ler', args: { nome: '$s.simbolo', projeto: PROJ } },
  ] });
  assert.ok(lote.ok, JSON.stringify(lote));
  assert.strictEqual(lote.resultados[2].resultado.origem, 'projeto');
  const loteRuim = await chama('lote', { passos: [{ ferramenta: 'nao_existe' }, { ferramenta: 'app_status' }] }).catch(e => ({ erro: e.message }));
  assert.ok(loteRuim.erro || loteRuim.falhas === 1, 'para no primeiro erro');

  /* ---------- o relato chegou ao hub (o topo do app mostra) ---------- */
  await new Promise(ok => setTimeout(ok, 600));
  const ola = recebidos.find(x => x.url === '/api/mcp/ola');
  assert.ok(ola, 'initialize avisa o hub');
  assert.match(ola.corpo.cliente, /claude-code/);
  const ativ = recebidos.filter(x => x.url === '/api/mcp/atividade').map(x => x.corpo);
  assert.ok(ativ.some(a => a.ferramenta === 'pcb_colocar' && a.ok && a.escrita && a.projeto === PROJ), 'cada chamada vai para o histórico');
  assert.ok(ativ.some(a => a.ferramenta === 'sym_apagar' && !a.ok && a.erro), 'o erro também');
  assert.ok(ativ.some(a => a.ferramenta === 'sym_gerar'), 'os passos do lote também aparecem');

  srv.relato && srv.relato.fecha();
  process.env.APPDATA = antes.APPDATA;
  if (antes.S === undefined) delete process.env.NEXOELETRIC_SESSION; else process.env.NEXOELETRIC_SESSION = antes.S;
  hub.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-mcp-completo OK (' + srv.registro.todas().length + ' ferramentas)');
})().catch(e => { console.error(e); hub.close(); process.exitCode = 1; });
