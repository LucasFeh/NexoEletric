/* Furos, recortes, faixa proibida e os padrões do autoroteador (NexoEletric 1.50.0), pedidos por uma
   sessão de IA que montou a PCB1 (trilho de 2 mm + furos M3):
     - footprint com furo sem cobre: type "npth" (ou plated:false) passa na validação; o furo do tamanho
       do pad metalizado dá a mensagem certa; o assistente faz o furo de fixação (fp_pacote tipo "furo");
     - pcb_furo (pad_add NPTH) e pcb_recorte (region_add cutout) pelo MCP;
     - pcb_faixa_borda: as regiões na KeepOut, o polígono que não entra nelas, o texto que a regra da
       casa acusa dentro delas e o que já estava lá;
     - pcb_autorotear: sem `camadas`, a camada interna vazia fica de fora (e a resposta diz).
   Numa CÓPIA de Projects/LM555 astável (os Projects reais nunca são gravados).
   node tests/test-mcp-furos.js */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'mcp', 'eletrichub-mcp.js');
const PROJ = 'LM555 astável';
const hc = require('../hub-core.js');

/* ---------- o footprint, puro ---------- */
{
  const HF = require('../hub-fplib.js'), PK = require('../hub-fppacote.js');
  const fp = HF.normalizaPads({ name: 'M3', pads: [{ name: '1', type: 'npth', x: 0, y: 0, drill: 3.4 }], silk: [], bodies: [] });
  assert.deepStrictEqual([fp.pads[0].type, fp.pads[0].plated, fp.pads[0].w, fp.pads[0].layer], ['th', false, 3.4, 'Multi']);
  assert.deepStrictEqual(HF.valida(fp), []);
  const igual = HF.valida({ name: 'X', pads: [{ name: '1', type: 'th', shape: 'circle', x: 0, y: 0, w: 3.4, h: 3.4, drill: 3.4 }], silk: [], bodies: [] });
  assert.ok(/do tamanho do pad/.test(igual[0]) && /npth/.test(igual[0]), igual[0]);
  const plated = HF.valida({ name: 'Y', pads: [{ name: '1', type: 'th', plated: false, shape: 'circle', x: 0, y: 0, w: 3.42, h: 3.42, drill: 3.4 }], silk: [], bodies: [] });
  assert.deepStrictEqual(plated, []);
  const f = PK.gera('furo', {});
  assert.strictEqual(f.name, 'FURO_3.2_NPTH');
  assert.ok(f.pads.length === 1 && f.pads[0].plated === false && f.pads[0].drill === 3.2 && f.silk.length === 1);
  assert.deepStrictEqual(HF.valida(f), []);
  const pth = PK.gera('furo', { furo: 3.2, padX: 6 });
  assert.ok(pth.name === 'FURO_3.2_PTH_6' && pth.pads[0].plated === undefined && pth.pads[0].w === 6);
  assert.throws(() => PK.gera('furo', { furo: 3.2, padX: 3 }), /anel/);
}

/* ---------- o polígono não entra na KeepOut (mesmo sem a marca keepout:true) ---------- */
{
  const P = require('../hub-pcbpour.js');
  const eb = {
    board: { bbox: { x1: 0, y1: 0, x2: 40, y2: 20 }, outline: [
      { x1: 0, y1: 0, x2: 40, y2: 0 }, { x1: 40, y1: 0, x2: 40, y2: 20 }, { x1: 40, y1: 20, x2: 0, y2: 20 }, { x1: 0, y1: 20, x2: 0, y2: 0 }] },
    tracks: [], arcs: [], vias: [], fills: [], components: [], freepads: [], cutouts: [],
    regions: [{ id: 'k1', layer: 'KeepOut', points: [[0, 18], [40, 18], [40, 20], [0, 20]] }],
    polygons: [{ id: 'pg1', layer: 'Top', net: 'GND', pts: [[0.5, 0.5], [39.5, 0.5], [39.5, 19.5], [0.5, 19.5]], pour: 'solid', clearance: 0.2 }],
  };
  const r = P.despeja(eb, eb.polygons[0]);
  const ymax = Math.max(...[].concat(...r.regioes.map(g => g.pts.map(q => q[1]))));
  assert.ok(ymax <= 18 - 0.19, 'o plano para antes da faixa: y máx ' + ymax);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eletrichub-furos-'));
const PROJETOS = path.join(TMP, 'Projects');
fs.mkdirSync(PROJETOS);
fs.cpSync(path.join(RAIZ, 'Projects', PROJ), path.join(PROJETOS, PROJ), { recursive: true });
const CH = path.join(PROJETOS, PROJ, 'changes.js');
fs.writeFileSync(CH, hc.serializeChanges([]).text);
const lerChanges = () => require('../mcp/lib/arquivo-linhas.js').ArquivoLinhas.abrir('changes', CH).itens;

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
    return { j: JSON.parse(r.result.content[0].text), texto: r.result.content[0].text };
  };
  await c.pede('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '0' } });
  c.avisa('notifications/initialized', {});
  const P = PROJ;

  /* ---------- pcb_furo e pcb_recorte ---------- */
  let r = await chama('pcb_furo', { projeto: P, x: 76, y: 33, diametro: 3.2, nome: 'H1' });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  let ln = lerChanges()[0];
  assert.deepStrictEqual([ln.op, ln.type, ln.drill, ln.w], ['pad_add', 'npth', 3.2, 3.2]);
  r = await chama('pcb_consultar', { projeto: P, tipo: 'pads', caixa: { x1: 75, y1: 32, x2: 77, y2: 34 } });
  assert.ok(r.j.itens.some(q => q.drill === 3.2 && q.plated === false), r.texto.slice(0, 600));
  r = await chama('pcb_furo', { projeto: P, x: 76, y: 60, diametro: 3.2, metalizado: true, anel: 3 });
  assert.ok(r.j.ok === false && /anel/.test(r.j.erro), r.texto);
  r = await chama('pcb_recorte', { projeto: P, x: 90, y: 33, diametro: 3.2 });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  ln = lerChanges()[1];
  assert.ok(ln.op === 'region_add' && ln.cutout === true && ln.pts.length === 48, JSON.stringify(ln).slice(0, 200));
  r = await chama('pcb_resumo', { projeto: P });
  assert.strictEqual(r.j.validacao.erros, 0, JSON.stringify(r.j.validacao));

  /* ---------- faixa proibida em cima e embaixo ---------- */
  r = await chama('pcb_faixa_borda', { projeto: P, lados: ['cima', 'baixo'], largura: 2 });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  const faixas = lerChanges().filter(x => x.op === 'region_add' && x.layer === 'KeepOut');
  assert.strictEqual(faixas.length, 2);
  const cima = r.j.faixas.find(f => f.lado === 'cima').caixa, baixo = r.j.faixas.find(f => f.lado === 'baixo').caixa;
  assert.ok(Math.abs(cima.y2 - 62.484) < 0.05 && Math.abs(cima.y1 - 60.484) < 0.05, JSON.stringify(cima));
  assert.ok(Math.abs(baixo.y1 - 30.861) < 0.05 && Math.abs(baixo.y2 - 32.861) < 0.05, JSON.stringify(baixo));
  /* de novo com substituir: as duas de antes saem, entram as novas */
  r = await chama('pcb_faixa_borda', { projeto: P, lados: ['cima', 'baixo'], largura: 1.5, substituir: true });
  assert.strictEqual(lerChanges().filter(x => x.op === 'region_add' && x.layer === 'KeepOut').length, 2);
  /* um texto dentro da faixa de cima: a regra da casa acusa */
  r = await chama('pcb_aplicar', { projeto: P, ops: [{ op: 'text_add', layer: 'TopOverlay', text: 'TRILHO', x: 83, y: 61.8, h: 1, w: 0.15 }] });
  assert.ok(r.j.ok, r.texto);
  r = await chama('regras_casa_verificar', { projeto: P, regras: ['serigrafia'] });
  assert.ok((r.j.violacoes || []).some(v => v.sub === 'serigrafia_keepout'), 'texto na faixa: ' + r.texto.slice(0, 800));

  /* ---------- autoroteador: a camada interna vazia fica de fora ---------- */
  r = await chama('pcb_aplicar', { projeto: P, ops: [{ op: 'stack_set', layers: [{ key: 'Top', dielectric: 0.2 }, { key: 'Mid1', dielectric: 1.2 }, { key: 'Mid2', dielectric: 0.2 }, { key: 'Bottom' }] },
    { op: 'track_del', id: 't1' }] });
  assert.ok(r.j.ok && r.j.gravado, r.texto);
  r = await chama('pcb_autorotear', { projeto: P, nets: ['NetC1_2'] });
  assert.ok(!r.j.parametros.camadas.includes('Mid1') && !r.j.parametros.camadas.includes('Mid2'), JSON.stringify(r.j.parametros));
  assert.deepStrictEqual(r.j.parametros.camadas_ignoradas, ['Mid1', 'Mid2']);
  assert.ok((r.j.dicas || []).some(d => /camadas internas vazias/.test(d)), r.texto.slice(0, 600));
  r = await chama('pcb_autorotear', { projeto: P, nets: ['NetC1_2'], camadas: ['Top', 'Mid1', 'Bottom'] });
  assert.ok(r.j.parametros.camadas.includes('Mid1') && !r.j.parametros.camadas_ignoradas, JSON.stringify(r.j.parametros));

  c.fim();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-mcp-furos: ok');
})().catch(e => { console.error(e); process.exit(1); });
