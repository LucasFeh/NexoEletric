/* O servidor MCP do NexoEletric (mcp/), provado como um cliente o usaria.

   1. Conversa JSON-RPC COMPLETA por stdio com o servidor num processo filho:
      initialize -> notifications/initialized -> tools/list -> tools/call -> resources -> prompts.
   2. Ferramentas reais contra uma CÓPIA de Projects/LM555 astável num diretório temporário
      (--projetos aponta para a cópia; os Projects reais nunca são gravados): mover componente,
      adicionar trilha, apagar, validar, rotear, gerar Gerber, desfazer, esquema, sinalizadores.
   3. O transporte HTTP Streamable (POST /mcp) e o recuo de versão do protocolo.

   Os módulos que ainda não chegaram (hub-pcbdrc.js...) têm de responder "módulo ausente" sem
   derrubar nada. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'mcp', 'eletrichub-mcp.js');
const PROJ = 'LM555 astável';
const ORIGEM = path.join(RAIZ, 'Projects', PROJ);

/* ---------- a cópia temporária (nunca os Projects reais) ---------- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'eletrichub-mcp-'));
const PROJETOS = path.join(TMP, 'Projects');
fs.mkdirSync(PROJETOS);
fs.cpSync(ORIGEM, path.join(PROJETOS, PROJ), { recursive: true });
const D = path.join(PROJETOS, PROJ);
for (const f of ['changes.js', 'annotations.js']) {   /* começa do zero, sem depender do estado do repo */
  const ser = require('../hub-core.js')[f === 'changes.js' ? 'serializeChanges' : 'serializeAnnotations']([]);
  fs.writeFileSync(path.join(D, f), '// comentario do usuario que tem de sobreviver\n' + ser.text);
}
const realAntes = fs.readFileSync(path.join(ORIGEM, 'board.js'), 'utf8');
const indiceAntes = fs.readFileSync(path.join(RAIZ, 'projects.js'), 'utf8');
const pastasAntes = fs.readdirSync(path.join(RAIZ, 'Projects')).join('|');
/* o indice da c\u00F3pia, com o \u00FAltimo objeto SEM v\u00EDrgula, como o do repo: acrescentar depois dele n\u00E3o
   pode quebrar o JS */
fs.writeFileSync(path.join(TMP, 'projects.js'), 'var projects = [\n{"name":"LM555 ast\\u00E1vel","files":{}}\n];\n');

/* ---------- cliente stdio ---------- */
function cliente() {
  const p = spawn(process.execPath, [SCRIPT, '--projetos', PROJETOS], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', erro = '';
  const espera = new Map();
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!l.trim()) continue;
      const m = JSON.parse(l);                                      /* stdout tem de ser só protocolo */
      const w = espera.get(m.id); if (w) { espera.delete(m.id); w(m); }
    }
  });
  p.stderr.on('data', d => { erro += d; });
  let id = 0;
  const pede = (method, params) => new Promise((ok, falha) => {
    const n = ++id;
    const t = setTimeout(() => falha(new Error('sem resposta a ' + method + '\n' + erro)), 60000);
    espera.set(n, m => { clearTimeout(t); ok(m); });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  });
  const avisa = (method, params) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  return { p, pede, avisa, fim: () => p.stdin.end(), erro: () => erro };
}
const texto = r => JSON.parse(r.result.content[0].text);

(async () => {
  const c = cliente();
  const chama = async (name, args) => {
    const r = await c.pede('tools/call', { name, arguments: args });
    assert.ok(r.result, name + ': ' + JSON.stringify(r.error));
    return { r, j: texto(r), erro: r.result.isError };
  };

  /* ---- 1. handshake ---- */
  const ini = await c.pede('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '0' } });
  assert.strictEqual(ini.result.protocolVersion, '2025-06-18');
  assert.strictEqual(ini.result.serverInfo.name, 'nexoeletric');
  assert.ok(ini.result.capabilities.tools && ini.result.capabilities.resources && ini.result.capabilities.prompts);
  assert.ok(/changes\.js/.test(ini.result.instructions));
  c.avisa('notifications/initialized', {});
  const ping = await c.pede('ping', {});
  assert.deepStrictEqual(ping.result, {});

  const lista = (await c.pede('tools/list', {})).result.tools;
  const nomes = lista.map(t => t.name);
  for (const n of ['projeto_listar', 'projeto_criar', 'sch_adicionar', 'sch_ligar', 'pcb_mover', 'pcb_aplicar', 'pcb_trilha', 'pcb_rotear',
                   'pcb_apagar', 'pcb_validar', 'pcb_render', 'gerber_gerar', 'drc_rodar', 'nets_ratsnest', 'pour_despejar', 'teardrop_aplicar',
                   'eco_comparar', 'pdf_layout', 'sinal_listar', 'sinal_responder', 'hub_status', 'list_commands', 'vista_screenshot'])
    assert.ok(nomes.includes(n), 'falta a ferramenta ' + n);
  for (const t of lista) {
    assert.strictEqual(t.inputSchema.type, 'object', t.name);
    assert.ok(t.description && t.description.length > 30, t.name + ' sem descrição que ensine');
    assert.ok(t.annotations && typeof t.annotations.readOnlyHint === 'boolean', t.name);
  }
  assert.strictEqual((await c.pede('metodo/inexistente', {})).error.code, -32601);
  const desc = await c.pede('tools/call', { name: 'nao_existe', arguments: {} });
  assert.strictEqual(desc.error.code, -32602);

  /* ---- recursos e prompts ---- */
  const recs = (await c.pede('resources/list', {})).result.resources;
  assert.ok(recs.some(r => r.uri === 'eletrichub://guia/ai-guide'));
  const guia = await c.pede('resources/read', { uri: 'eletrichub://guia/ai-guide' });
  assert.ok(/Parte B/.test(guia.result.contents[0].text));
  const fmt = await c.pede('resources/read', { uri: 'eletrichub://formato/changes' });
  assert.ok(/comp_move: obrigatórios .*orig_x/.test(fmt.result.contents[0].text));
  const pr = await c.pede('prompts/get', { name: 'fluxo_pcb', arguments: { projeto: PROJ } });
  assert.ok(pr.result.messages[0].content.text.includes(PROJ));

  /* ---- 2. ferramentas na cópia ---- */
  let { j } = await chama('projeto_listar', {});
  assert.deepStrictEqual(j.projetos.map(p => p.nome), [PROJ]);
  ({ j } = await chama('projeto_resumo', { projeto: 'lm555 astavel' }));        /* sem acento e em minúsculas: casa */
  assert.strictEqual(j.projeto, PROJ);
  assert.strictEqual(j.placa.contagem.componentes, 9);

  /* mover: os orig_* saem do board.js sozinhos */
  const board = require('../mcp/lib/arquivo-linhas.js').lerVar(path.join(D, 'board.js'), 'pcbmirror');
  const ci1 = board.components.find(x => x.ref === 'CI1');
  ({ j } = await chama('pcb_mover', { projeto: PROJ, ref: 'CI1', dx: 1.27, note: 'teste do MCP' }));
  assert.ok(j.ok && j.gravado, JSON.stringify(j.erros));
  let ch = fs.readFileSync(path.join(D, 'changes.js'), 'utf8');
  assert.ok(ch.startsWith('// comentario do usuario que tem de sobreviver'), 'o comentário do usuário sumiu');
  let linhas = ch.split('\n').filter(l => l.startsWith('{'));
  assert.strictEqual(linhas.length, 1);
  let op = JSON.parse(linhas[0].replace(/,$/, ''));
  assert.strictEqual(op.op, 'comp_move');
  assert.strictEqual(op.orig_x, ci1.x); assert.strictEqual(op.orig_y, ci1.y); assert.strictEqual(op.orig_rot, ci1.rot); assert.strictEqual(op.orig_layer, ci1.layer);
  assert.ok(Math.abs(op.x - (ci1.x + 1.27)) < 1e-6);
  assert.ok(j.componente && Math.abs(j.componente.x - op.x) < 1e-9, 'a resposta traz o estado novo');

  /* mexer de novo no mesmo componente EDITA a linha (uma linha por objeto) */
  ({ j } = await chama('pcb_mover', { projeto: PROJ, ref: 'CI1', rot: 90 }));
  assert.ok(j.ok);
  linhas = fs.readFileSync(path.join(D, 'changes.js'), 'utf8').split('\n').filter(l => l.startsWith('{'));
  assert.strictEqual(linhas.length, 1, 'virou duas linhas para o mesmo componente');
  op = JSON.parse(linhas[0].replace(/,$/, ''));
  assert.strictEqual(op.rot, 90); assert.strictEqual(op.orig_x, ci1.x); assert.strictEqual(op.note, 'teste do MCP');

  /* trilha nova, de pad a ponto, com a net do pad */
  ({ j } = await chama('pcb_trilha', { projeto: PROJ, layer: 'Bottom', pts: ['R1.1', [80, 35]], w: 0.4 }));
  assert.ok(j.ok && j.gravado, JSON.stringify(j));
  const r1p1 = board.components.find(x => x.ref === 'R1').pads.find(p => p.name === '1');
  assert.ok(j.linhas[0].linha.includes('"net":"' + r1p1.net + '"'), 'a trilha herdou a net do pad');

  /* erro de validação: nada é gravado */
  const antesErro = fs.readFileSync(path.join(D, 'changes.js'), 'utf8');
  ({ j } = await chama('pcb_aplicar', { projeto: PROJ, ops: [{ op: 'track_add', layer: 'Multi', x1: 1, y1: 1, x2: 2, y2: 2, w: 0.3 }] }));
  assert.strictEqual(j.ok, false); assert.strictEqual(j.gravado, false); assert.ok(j.erros.length);
  assert.strictEqual(fs.readFileSync(path.join(D, 'changes.js'), 'utf8'), antesErro);
  /* objeto inexistente: erro claro */
  const inex = await chama('pcb_apagar', { projeto: PROJ, ids: ['t99999'] });
  assert.ok(inex.erro && /não existe/.test(inex.j.erro));

  /* apagar por id: track_del com os orig_* do board.js */
  const t1 = board.tracks[0];
  ({ j } = await chama('pcb_apagar', { projeto: PROJ, ids: [t1.id] }));
  assert.ok(j.ok, JSON.stringify(j.erros));
  op = JSON.parse(j.linhas[0].linha);
  assert.deepStrictEqual([op.op, op.orig_x1, op.orig_y1, op.orig_x2, op.orig_y2, op.orig_w, op.orig_layer], ['track_del', t1.x1, t1.y1, t1.x2, t1.y2, t1.w, t1.layer]);

  /* via com a net do ponto; validar; mudanças */
  ({ j } = await chama('pcb_via', { projeto: PROJ, x: 80, y: 35 }));
  assert.ok(j.ok && j.linhas[0].linha.includes('"net":"' + r1p1.net + '"'), JSON.stringify(j));
  ({ j } = await chama('pcb_validar', { projeto: PROJ }));
  assert.strictEqual(j.ok, true, JSON.stringify(j));
  assert.strictEqual(j.mudancas, 4);
  ({ j } = await chama('pcb_mudancas', { projeto: PROJ }));
  assert.deepStrictEqual(j.mudancas.map(m => m.op.op), ['comp_move', 'track_add', 'track_del', 'via_add']);

  /* remover a linha da via e desfazer a remoção */
  ({ j } = await chama('pcb_mudanca_remover', { projeto: PROJ, indices: [3] }));
  assert.strictEqual(j.mudancas_no_arquivo, 3);
  ({ j } = await chama('projeto_desfazer', { projeto: PROJ }));
  assert.ok(j.ok);
  ({ j } = await chama('pcb_mudancas', { projeto: PROJ }));
  assert.strictEqual(j.total, 4, 'o desfazer devolveu a via');

  /* roteador walkaround (hub-roteador.js): grava trilhas que passam no motor */
  const rot = await chama('pcb_rotear', { projeto: PROJ, layer: 'Top', de: [76, 33], ate: [91, 33], w: 0.3, net: 'GND' });
  assert.ok(!rot.erro, JSON.stringify(rot.j));
  assert.ok(rot.j.pontos.length >= 2);
  if (rot.j.gravacao) assert.ok(rot.j.gravacao.ok, JSON.stringify(rot.j.gravacao.erros));

  /* consultas e imagem */
  ({ j } = await chama('pcb_consultar', { projeto: PROJ, tipo: 'pads', ref: 'CI1' }));
  assert.strictEqual(j.total, 8);
  ({ j } = await chama('nets_ratsnest', { projeto: PROJ }));
  assert.ok(j.nets_total > 0 && typeof j.ligacoes_faltando === 'number');
  const img = await chama('pcb_render', { projeto: PROJ, largura: 400, ratsnest: true });
  const im = img.r.result.content.find(x => x.type === 'image');
  assert.ok(im && Buffer.from(im.data, 'base64').slice(1, 4).toString() === 'PNG', 'pcb_render devolve PNG');

  /* Gerber: Projects/<p>/Gerber/ + gerber.json, como a rota /api/gerber */
  const nMud = (await chama('pcb_mudancas', { projeto: PROJ })).j.total;
  ({ j } = await chama('gerber_gerar', { projeto: PROJ }));
  assert.ok(j.ok, JSON.stringify(j).slice(0, 500));
  const gdir = path.join(D, 'Gerber');
  const man = JSON.parse(fs.readFileSync(path.join(gdir, 'gerber.json'), 'utf8'));
  assert.strictEqual(man.arquivos.length, j.arquivos.length);
  for (const a of man.arquivos) assert.ok(fs.existsSync(path.join(gdir, a.nome)), a.nome);
  assert.ok(man.arquivos.some(a => /copper_signal_top/i.test(a.nome)));
  assert.strictEqual(man.mudancas, nMud);
  ({ j } = await chama('gerber_salvo', { projeto: PROJ, conferir: true }));
  assert.ok(j.conferencia.every(x => x.ok), JSON.stringify(j.conferencia));

  /* esquema: pinos, ligar, adicionar com ref automático, validar */
  ({ j } = await chama('sch_componentes', { projeto: PROJ, ref: 'R1' }));
  const pinos = j.componentes[0].pinos;
  assert.ok(pinos.length === 2 && pinos.every(p => typeof p.x === 'number'));
  const schAntes = fs.readFileSync(path.join(D, 'schematic.js'), 'utf8');
  ({ j } = await chama('sch_ligar', { projeto: PROJ, de: 'R1.' + pinos[0].num, para: [pinos[0].x - 300, pinos[0].y - 200] }));
  assert.ok(j.ok && j.gravado, JSON.stringify(j));
  const w = j.tocados[0].item;
  assert.deepStrictEqual(w.pts[0], [pinos[0].x, pinos[0].y], 'o fio começa na ponta quente');
  const schDepois = fs.readFileSync(path.join(D, 'schematic.js'), 'utf8');
  assert.ok(schDepois.startsWith(schAntes.replace(/\]\};\s*$/, '')), 'as linhas antigas do schematic.js ficaram intactas');
  const sym = (await chama('sch_buscar_simbolo', { busca: 'res' })).j.simbolos[0];
  assert.ok(sym && sym.sym);
  ({ j } = await chama('sch_adicionar', { projeto: PROJ, itens: [{ t: 'comp', sym: sym.sym, ref: 'R?', x: 1000, y: 1000 }], simular: true }));
  assert.ok(j.simulado && /^R\d+$|^[A-Z]+\d+$/.test(j.tocados[0].item.ref));
  ({ j } = await chama('sch_nets', { projeto: PROJ }));
  assert.ok(j.total > 0);

  /* sinalizadores: criar e responder sem apagar */
  ({ j } = await chama('sinal_criar', { projeto: PROJ, view: 'pcb', x: 80, y: 40, msg: 'conferir a via', severity: 'warn' }));
  assert.strictEqual(j.sinalizador.id, 'n1');
  ({ j } = await chama('sinal_responder', { projeto: PROJ, id: 'n1', reply: 'via conferida' }));
  assert.strictEqual(j.sinalizador.status, 'resolved');
  ({ j } = await chama('sinal_listar', { projeto: PROJ, status: 'todos' }));
  assert.strictEqual(j.total, 1);
  assert.ok(fs.readFileSync(path.join(D, 'annotations.js'), 'utf8').startsWith('// comentario do usuario'));

  /* ECO de reserva, BOM, módulos ausentes respondem sem quebrar */
  ({ j } = await chama('eco_comparar', { projeto: PROJ }));
  assert.ok(Array.isArray(j.acoes || j.faltam_na_placa), JSON.stringify(j).slice(0, 300));
  ({ j } = await chama('bom_listar', { projeto: PROJ }));
  assert.strictEqual(j.componentes, 9);
  for (const [n, arq] of [['drc_rodar', 'hub-pcbdrc.js'], ['pdf_layout', 'hub-pcbpdf.js'], ['pour_despejar', 'hub-pcbpour.js'], ['teardrop_aplicar', 'hub-pcbteardrop.js'], ['regras_ler', 'hub-pcbregras.js']]) {
    const r = await chama(n, { projeto: PROJ, simular: true });
    if (!fs.existsSync(path.join(RAIZ, arq))) assert.ok(r.erro && /módulo ausente/.test(r.j.erro), n + ': ' + JSON.stringify(r.j));
    else assert.ok(!r.erro || r.j.ok === false && r.j.gravado === false, n + ': ' + JSON.stringify(r.j).slice(0, 600));
  }
  const aus = await chama('hub_modulo_chamar', { modulo: 'hub-naoexiste.js', funcao: 'x' });
  assert.ok(aus.erro && /módulo ausente/.test(aus.j.erro), 'módulo que não existe responde "módulo ausente"');
  ({ j } = await chama('hub_modulos', {}));
  assert.ok(j.modulos.find(m => m.arquivo === 'hub-core.js').presente);
  ({ j } = await chama('hub_modulo_chamar', { modulo: 'hub-core.js', funcao: 'boardLayers', args: ['$placa'], projeto: PROJ }));
  assert.ok(Array.isArray(j.resultado) && j.resultado.some(l => l.key === 'Top'));
  ({ j } = await chama('list_commands', {}));
  assert.ok(j.grupos.length >= 7 && !j.erros_de_registro.length);

  /* projeto novo dentro da cópia */
  ({ j } = await chama('projeto_criar', { nome: 'Teste MCP', folha: 'A3' }));
  assert.ok(j.ok && fs.existsSync(path.join(PROJETOS, 'Teste MCP', 'schematic.js')));
  const idx = require('../mcp/lib/arquivo-linhas.js').lerVar(path.join(TMP, 'projects.js'), 'projects');
  assert.deepStrictEqual(idx.map(x => x.name), [PROJ, 'Teste MCP'], 'o projects.js da cópia ganhou a entrada e continua JS válido');
  ({ j } = await chama('sch_validar', { projeto: 'Teste MCP' }));
  assert.ok(j.ok, JSON.stringify(j));

  c.fim();
  await new Promise(ok => c.p.on('exit', ok));

  /* ---- 3. HTTP + versão antiga ---- */
  const { montaServidor, servidorHttp } = require('../mcp/eletrichub-mcp.js');
  const srv = montaServidor({ projetos: PROJETOS, log: () => {} });
  const h = servidorHttp(srv, { http: 0, host: '127.0.0.1' });
  await new Promise(ok => h.once('listening', ok));
  const url = `http://127.0.0.1:${h.address().port}/mcp`;
  const post = (corpo, extra) => fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, extra || {}), body: JSON.stringify(corpo) });
  let resp = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  assert.strictEqual(resp.status, 200);
  assert.ok(resp.headers.get('mcp-session-id'));
  assert.strictEqual((await resp.json()).result.protocolVersion, '2024-11-05', 'recuo para a versão do cliente');
  resp = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.strictEqual(resp.status, 202);
  resp = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'pcb_resumo', arguments: { projeto: PROJ } } });
  assert.strictEqual(JSON.parse((await resp.json()).result.content[0].text).contagem.components, 9);
  resp = await post({ jsonrpc: '2.0', id: 3, method: 'ping' }, { Origin: 'http://evil.example' });
  assert.strictEqual(resp.status, 403, 'Origin de fora recusado');
  h.close();

  assert.strictEqual(fs.readFileSync(path.join(ORIGEM, 'board.js'), 'utf8'), realAntes, 'o projeto real não pode mudar');
  assert.strictEqual(fs.readFileSync(path.join(RAIZ, 'projects.js'), 'utf8'), indiceAntes, 'o projects.js real não pode mudar');
  assert.strictEqual(fs.readdirSync(path.join(RAIZ, 'Projects')).join('|'), pastasAntes, 'nenhuma pasta nova em Projects/ real');
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`test-mcp OK (${nomes.length} ferramentas; stdio, HTTP e as ferramentas na cópia de "${PROJ}")`);
})().catch(e => { console.error(e); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
