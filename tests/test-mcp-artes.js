/* As artes de overlay pelo MCP (1.91.0), como um cliente as usaria, numa CÓPIA de Projects/LM555 astável:
     - pcb_artes lista as duas da casa (com o tamanho e os campos);
     - pcb_arte_colocar simula por padrão, e com gravar:true escreve o comp_add com o desenho (ARTE1);
     - pcb_artes com o projeto mostra a arte na placa com os textos JÁ resolvidos (o código da placa e a revisão);
     - pcb_mover vira a arte para baixo: Bottom Overlay;
     - arte que não existe: erro com a lista.
     node tests/test-mcp-artes.js */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'mcp', 'eletrichub-mcp.js');
const PROJ = 'LM555 astável';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eletrichub-artes-'));
const PROJETOS = path.join(TMP, 'Projects');
fs.mkdirSync(PROJETOS);
fs.cpSync(path.join(RAIZ, 'Projects', PROJ), path.join(PROJETOS, PROJ), { recursive: true });
const hc = require('../hub-core.js');
fs.writeFileSync(path.join(PROJETOS, PROJ, 'changes.js'), hc.serializeChanges([]).text);
/* o projeto definido: o código da placa e a revisão no cabeçalho do esquema (a cópia) */
{
  const f = path.join(PROJETOS, PROJ, 'schematic.js');
  const s = new Function(fs.readFileSync(f, 'utf8') + ';return schematic;')();
  s.params = 'CodigoDaPlaca=PLM-DI261999;Revisao=REV. B';
  fs.writeFileSync(f, 'var schematic = ' + JSON.stringify(s) + ';\n');
}
const lerChanges = () => require('../mcp/lib/arquivo-linhas.js').ArquivoLinhas.abrir('changes', path.join(PROJETOS, PROJ, 'changes.js')).itens;

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
  const lista = await c.pede('tools/list', {});
  const nomes = lista.result.tools.map(t => t.name);
  assert.ok(nomes.includes('pcb_artes') && nomes.includes('pcb_arte_colocar'), 'as ferramentas novas');
  assert.ok(nomes.includes('pcb_colocar') && nomes.includes('serigrafia_imagem'), 'as de antes continuam');

  let r = await chama('pcb_artes', {});
  assert.ok(!r.erro, r.texto);
  assert.deepStrictEqual(r.j.artes.map(a => a.id), ['dieletrons-logo-qr', 'codigo-revisao']);
  assert.deepStrictEqual(r.j.artes[1].campos, ['CodigoDaPlaca', 'Revisao']);
  assert.ok(r.j.artes[0].tamanho_mm[0] > 34 && r.j.artes[0].tamanho_mm[0] < 36, 'a logo + QR ~35 mm: ' + r.j.artes[0].tamanho_mm);

  /* 1.92.2: a placa sem o código da placa na serigrafia */
  r = await chama('pcb_artes', { projeto: PROJ });
  assert.strictEqual(r.j.codigo_na_placa.estado, 'falta', 'sem o código na serigrafia: ' + JSON.stringify(r.j.codigo_na_placa));
  r = await chama('pcb_arte_colocar', { projeto: PROJ, arte: 'codigo-revisao', x: 20, y: 10 });
  assert.ok(!r.erro, r.texto);
  assert.strictEqual(r.j.gravado, false, 'simula por padrão');
  assert.strictEqual(lerChanges().length, 0, 'nada gravado');

  r = await chama('pcb_arte_colocar', { projeto: PROJ, arte: 'codigo-revisao', x: 20, y: 10, gravar: true });
  assert.ok(!r.erro, r.texto);
  assert.strictEqual(r.j.ref, 'ARTE1');
  const ch = lerChanges();
  assert.deepStrictEqual(ch.map(o => [o.op, o.ref, o.arte && o.arte.id]), [['comp_add', 'ARTE1', 'codigo-revisao']]);

  r = await chama('pcb_artes', { projeto: PROJ });
  assert.deepStrictEqual(r.j.na_placa.map(a => [a.ref, a.arte, a.face, a.textos]), [['ARTE1', 'codigo-revisao', 'TopOverlay', ['PLM-DI261999', 'REV. B']]],
    'a arte na placa com o código e a revisão do projeto: ' + JSON.stringify(r.j.na_placa));
  assert.strictEqual(r.j.codigo_na_placa.estado, 'ok', 'com a arte, o código está na placa');

  r = await chama('pcb_mover', { projeto: PROJ, ref: 'ARTE1', layer: 'Bottom', rot: 180 });
  assert.ok(!r.erro, r.texto);
  r = await chama('pcb_artes', { projeto: PROJ });
  assert.strictEqual(r.j.na_placa[0].face, 'BottomOverlay', 'virada para baixo: ' + JSON.stringify(r.j.na_placa));

  r = await chama('pcb_arte_colocar', { projeto: PROJ, arte: 'nao-existe', x: 0, y: 0 });
  assert.ok(r.erro && /dieletrons-logo-qr/.test(r.texto), 'erro com a lista: ' + r.texto);

  c.fim();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });   /* o MCP filho ainda segura arquivos um instante depois do fim */
  console.log('test-mcp-artes: ok');
})().catch(e => { console.error(e); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
