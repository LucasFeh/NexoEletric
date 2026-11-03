/* serigrafia_texto e serigrafia_imagem pelo MCP (NexoEletric 1.60.0), numa CÓPIA de Projects/LM555 astável:
     - serigrafia_texto simula por padrão (nada no changes.js, imagem e regras da casa na resposta) e com
       gravar:true escreve uma region_add por letra, com os furos (holes) na mesma linha;
     - a placa efetiva (HubCore.effectiveBoard) leva as regiões com furo na TopOverlay;
     - substituir:true refaz no lugar sem duplicar; fonte desconhecida, JPEG e PNG entrelaçado voltam com erro claro;
     - serigrafia_imagem lê um PNG gerado aqui (anel com miolo), espelha na BottomOverlay e grava.
   node tests/test-mcp-silkgen.js */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'mcp', 'eletrichub-mcp.js');
const PROJ = 'LM555 astável';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eletrichub-silkgen-'));
const PROJETOS = path.join(TMP, 'Projects');
fs.mkdirSync(PROJETOS);
fs.cpSync(path.join(RAIZ, 'Projects', PROJ), path.join(PROJETOS, PROJ), { recursive: true });
const hc = require('../hub-core.js');
const { crc32 } = require('../mcp/lib/render.js');
const CH = path.join(PROJETOS, PROJ, 'changes.js');
fs.writeFileSync(CH, hc.serializeChanges([]).text);
const lerChanges = () => require('../mcp/lib/arquivo-linhas.js').ArquivoLinhas.abrir('changes', CH).itens;
const board = new Function(fs.readFileSync(path.join(PROJETOS, PROJ, 'board.js'), 'utf8') + ';return pcbmirror;')();
const placaAgora = () => hc.effectiveBoard(board, hc.applyPcbChanges(board, lerChanges()));
const TEM_ARIAL = fs.existsSync(path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'arial.ttf'));

/* um PNG RGBA (cor 6, 8 bits) de w x h com tinta onde f(x,y) */
function png(w, h, f, entrelaca) {
  const bloco = (tipo, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(tipo, 'ascii'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(f(x, y) ? [0, 0, 0, 255] : [255, 255, 255, 0], y * (w * 4 + 1) + 1 + 4 * x);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6; ih[12] = entrelaca ? 1 : 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ih), bloco('IDAT', zlib.deflateSync(raw)), bloco('IEND', Buffer.alloc(0))]);
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
    const img = r.result.content.find(x => x.type === 'image');
    return { j: JSON.parse(r.result.content[0].text), texto: r.result.content[0].text.slice(0, 3000), erro: !!r.result.isError, img };
  };
  await c.pede('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '0' } });
  c.avisa('notifications/initialized', {});
  const P = PROJ;
  const lista = await c.pede('tools/list', {});
  const nomes = lista.result.tools.map(x => x.name);
  assert.ok(nomes.includes('serigrafia_texto') && nomes.includes('serigrafia_imagem'), 'as ferramentas novas estão no tools/list');
  const silkRegs = layer => (placaAgora().regions || []).filter(g => g.layer === layer && !g.poly);

  /* ---------- serigrafia_texto ---------- */
  if (TEM_ARIAL) {
    let r = await chama('serigrafia_texto', { projeto: P, texto: 'Ode', x: 83.5, y: 33.2, h: 1.6 });
    assert.ok(!r.erro && r.j.ok, r.texto);
    assert.strictEqual(r.j.gravado, false);
    assert.strictEqual(r.j.regioes, 3);
    assert.strictEqual(r.j.furos, 3, 'O, d, e com miolo');
    assert.ok(r.img && r.img.mimeType === 'image/png', 'imagem do lugar');
    assert.ok(r.j.regras_casa && typeof r.j.regras_casa.ok === 'boolean', 'regras da casa conferidas: ' + r.texto);
    assert.ok(Math.abs((r.j.caixa.x1 + r.j.caixa.x2) / 2 - 83.5) < 1e-3, JSON.stringify(r.j.caixa));
    assert.ok(/Arial/i.test(r.j.fonte.nome), JSON.stringify(r.j.fonte));
    assert.ok(!r.j.gravacao.linhas && r.j.gravacao.linhas_resumo.total === 3 && r.j.gravacao.linhas_resumo.por_status.ok === 3, 'a linha inteira não volta, só o resumo: ' + JSON.stringify(r.j.gravacao));
    assert.strictEqual(lerChanges().length, 0, 'simular não grava');

    r = await chama('serigrafia_texto', { projeto: P, texto: 'Ode', x: 83.5, y: 33.2, h: 1.6, gravar: true, imagem: false });
    assert.ok(!r.erro && r.j.gravado, r.texto);
    assert.ok(!r.img);
    let L = lerChanges();
    assert.strictEqual(L.length, 3);
    for (const x of L) {
      assert.strictEqual(x.op, 'region_add'); assert.strictEqual(x.layer, 'TopOverlay');
      assert.strictEqual(x.note, 'serigrafia texto Ode');
      assert.ok(Array.isArray(x.holes) && x.holes.length === 1, JSON.stringify(x).slice(0, 200));
      assert.ok(/^u/.test(x.uid), 'uid gravado');
    }
    const txt = fs.readFileSync(CH, 'utf8').split('\n').filter(l => l.includes('"region_add"'));
    assert.strictEqual(txt.length, 3, 'uma linha por região');
    assert.ok(txt.every(l => l.includes('"pts":[[') && l.includes('"holes":[[[')), 'pts e holes na mesma linha');
    let regs = silkRegs('TopOverlay').filter(g => Array.isArray(g.holes) && g.holes.length);
    assert.strictEqual(regs.length, 3, 'placa efetiva com as 3 regiões furadas');
    assert.ok(hc.applyPcbChanges(board, L).validation.every(v => v.level !== 'err'));

    /* de novo sem substituir: avisa que soma; com substituir: troca */
    r = await chama('serigrafia_texto', { projeto: P, texto: 'Ode', x: 84, y: 33.2, h: 1.6, imagem: false });
    assert.ok(r.j.avisos.some(a => /substituir/.test(a)), r.texto);
    r = await chama('serigrafia_texto', { projeto: P, texto: 'Ode', x: 84, y: 33.2, h: 1.6, substituir: true, gravar: true, imagem: false });
    assert.ok(r.j.gravado && r.j.substituidas === 3, r.texto);
    L = lerChanges();
    assert.strictEqual(L.length, 3, 'substituiu, não somou');
    assert.ok(Math.abs((r.j.caixa.x1 + r.j.caixa.x2) / 2 - 84) < 1e-3);

    /* fonte por nome e erro de fonte */
    r = await chama('serigrafia_texto', { projeto: P, texto: 'B', x: 80, y: 33, h: 1.5, fonte: 'Arial Bold', imagem: false, conferir: false });
    assert.ok(r.j.ok && /bold|negrito/i.test(r.j.fonte.nome + r.j.fonte.arquivo), r.texto);
    assert.strictEqual(r.j.furos, 2, 'o B tem dois miolos');
    r = await chama('serigrafia_texto', { projeto: P, texto: 'X', x: 80, y: 33, h: 1.5, fonte: 'Fonte Que Nao Existe' });
    assert.ok(r.erro && /desconhecida/.test(r.texto), r.texto);
    r = await chama('serigrafia_texto', { projeto: P, texto: 'x', x: 80, y: 33, h: 0.5, imagem: false, conferir: false });
    assert.ok(r.j.avisos.some(a => /fino/.test(a)), 'texto de 0,5 mm é fino: ' + r.texto);
  } else console.log('(sem a Arial do Windows: serigrafia_texto pulado)');

  /* ---------- serigrafia_imagem ---------- */
  const IMG = path.join(TMP, 'logo.png');
  fs.writeFileSync(IMG, png(60, 40, (x, y) => { const d = Math.hypot((x - 30) / 1.5, y - 20); return d < 18 && d > 9; }));
  let r = await chama('serigrafia_imagem', { projeto: P, arquivo: IMG, x: 83, y: 58, largura: 6, layer: 'BottomOverlay' });
  assert.ok(!r.erro && r.j.ok, r.texto);
  assert.strictEqual(r.j.gravado, false);
  assert.strictEqual(r.j.regioes, 1);
  assert.strictEqual(r.j.furos, 1);
  assert.strictEqual(r.j.espelhada, true, 'na BottomOverlay sai espelhada');
  assert.ok(Math.abs(r.j.caixa.x2 - r.j.caixa.x1 - 6) < 0.05, JSON.stringify(r.j.caixa));
  assert.ok(r.img, 'imagem');
  const antes = lerChanges().length;
  r = await chama('serigrafia_imagem', { projeto: P, arquivo: IMG, x: 83, y: 58, largura: 6, layer: 'BottomOverlay', gravar: true, imagem: false });
  assert.ok(r.j.gravado, r.texto);
  const L = lerChanges();
  assert.strictEqual(L.length, antes + 1);
  const g = L[L.length - 1];
  assert.strictEqual(g.layer, 'BottomOverlay');
  assert.strictEqual(g.note, 'serigrafia imagem logo.png');
  assert.strictEqual(g.holes.length, 1);
  const regsB = silkRegs('BottomOverlay').filter(x => Array.isArray(x.holes) && x.holes.length === 1);
  assert.strictEqual(regsB.length, 1, 'placa efetiva com a região furada na BottomOverlay');

  /* formatos recusados */
  const JPG = path.join(TMP, 'foto.jpg');
  fs.writeFileSync(JPG, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 74, 70, 73, 70]));
  r = await chama('serigrafia_imagem', { projeto: P, arquivo: JPG, x: 83, y: 58, largura: 6 });
  assert.ok(r.erro && /JPEG, não PNG/.test(r.texto), r.texto);
  const ENT = path.join(TMP, 'ent.png');
  fs.writeFileSync(ENT, png(8, 8, () => true, true));
  r = await chama('serigrafia_imagem', { projeto: P, arquivo: ENT, x: 83, y: 58, largura: 6 });
  assert.ok(r.erro && /entrelaçado/.test(r.texto), r.texto);
  r = await chama('serigrafia_imagem', { projeto: P, arquivo: IMG, x: 83, y: 58 });
  assert.ok(r.erro && /largura ou altura/.test(r.texto), r.texto);
  r = await chama('serigrafia_imagem', { projeto: P, arquivo: IMG, x: 83, y: 58, largura: 6, inverter: true, alfa: true, imagem: false, conferir: false });
  assert.ok(r.erro && /nada para gravar/.test(r.texto) || r.j.avisos.some(a => /tinta/.test(a)), 'invertido com fundo transparente: sem tinta — ' + r.texto);

  c.fim();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-mcp-silkgen: ok');
})().catch(e => { console.error(e); process.exit(1); });
