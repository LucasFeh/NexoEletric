// O sincronizador do Nexo Hub (mcp/lib/nexohub-sync.js), contra um Nexo Hub de mentira
// (tests/nexohub-falso.js) e um hub de mentira que serve a PcbLib 3D sob demanda, como o hubserver.
//   node tests/test-nexohub-sync.js
// A pasta do hub e uma copia temporaria (hub-*.js + Libs de teste + o projeto "LM555 astável"):
// nada grava no repositorio.
//   - 1a vez: 3 modelos viram itens modelo3d rev 1 (step + origem), com chaves e vinculos footprint,
//     o da PcbLib vem do hub (nao esta no disco); a placa vira item placa rev 1 com modelos {item, rev}
//   - 2a vez: nada sobe (nenhum blob, nenhuma revisao)
//   - o NexoCAD salva a rev 2 de um modelo: a 3a vez nao cria rev 3 do modelo, e a placa ganha a rev 2
//     (o pacote passou a apontar a rev 2)
//   - retoma: item criado sem revisao (queda no meio) recebe a rev 1; footprint novo de um modelo que
//     ja existe so atualiza atributos/vinculos
//   - CLI (o que o app roda): JSON por linha, fim ok
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const R = path.join(__dirname, '..');
const F = require('./nexohub-falso.js');

const STEP = n => Buffer.from(`ISO-10303-21;\nHEADER;\nFILE_NAME('${n}');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n`);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nexohub-sync-'));
const ROOT = path.join(TMP, 'hub');
fs.mkdirSync(path.join(ROOT, 'Libs', '3d-hub'), { recursive: true });
for (const f of fs.readdirSync(R)) if (/^hub-.*\.js$/.test(f)) fs.copyFileSync(path.join(R, f), path.join(ROOT, f));
fs.cpSync(path.join(R, 'mcp'), path.join(ROOT, 'mcp'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'Projects'));
fs.cpSync(path.join(R, 'Projects', 'LM555 astável'), path.join(ROOT, 'Projects', 'LM555 astável'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'Libs', '3d-hub', 'aaa.step'), STEP('dip8'));
fs.writeFileSync(path.join(ROOT, 'Libs', '3d-hub', 'bbb.step'), STEP('res'));
const raw = { x2d: 0, y2d: 0, rot2d: 0, rotx: 0, roty: 0, rotz: 0, dz: 0 };
const libHub = { format: 'pcblib-hub-v1', units: 'mm',
  models: { m1: { file: '3d-hub/aaa.step', name: 'DIP8.step', bytes: 10 }, m2: { file: '3d-hub/bbb.step', name: 'R1206.step', bytes: 10 } },
  footprints: [
    { name: 'DIP8', pads: [], silk: [], bodies: [{ kind: 'step', model: 'm1', name: 'DIP8.step', side: 'top', raw }] },
    { name: 'RES 1206', pads: [], silk: [], bodies: [{ kind: 'step', model: 'm2', name: 'R1206.step', side: 'top', raw }] }] };
const escreveHub = () => fs.writeFileSync(path.join(ROOT, 'Libs', 'pcblib-hub.js'), 'var pcblibHub = ' + JSON.stringify(libHub) + ';\n');
escreveHub();
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const lib3d = { format: 'pcblib3d-v1', units: 'mm',
  footprints: { 'TO-92': { bodies: [{ owner: '', side: 'top', kind: 'step', layer: 'Mech1', color: '#808080', opacity: 1, model: '{G1}', name: 'TO-92.STEP', matrix: I, raw }] } },
  models: { '{G1}': { file: '3d/123.step', name: 'TO-92.STEP', checksum: 123, bytes: 10 } } };

/* o hub de mentira: a PcbLib 3D sob demanda (nao esta no disco da pasta do hub) */
const servidos = [];
const hub = http.createServer((q, r) => {
  servidos.push(q.url);
  if (q.url === '/Libs/pcblib-3d.js') { r.end('var pcblib3d = ' + JSON.stringify(lib3d) + ';\n'); return; }
  if (q.url === '/Libs/3d/123.step') { r.end(STEP('to92')); return; }
  r.statusCode = 404; r.end('nao');
});

(async () => {
  await new Promise(ok => hub.listen(0, '127.0.0.1', ok));
  const hubUrl = `http://127.0.0.1:${hub.address().port}`;
  const nh = await F.inicia({ porta: Number(process.env.TESTE_PORTA_NH || 8321) });
  const S = require(path.join(ROOT, 'mcp', 'lib', 'nexohub-sync.js'));
  const NH = require(path.join(ROOT, 'mcp', 'lib', 'nexohub.js'));
  const cliente = NH.cliente({ url: nh.url, token: '' });
  const E = nh.estado;
  const itens = () => [...E.itens.values()];
  const porChave = k => E.itens.get(E.chaves.get('nexoeletric-modelo\u0000' + k));
  const logs = [];
  const roda = (o) => S.sincroniza(Object.assign({ root: ROOT, hubUrl, cliente, log: (n, m) => logs.push(n + ' ' + m) }, o || {}));

  /* ---------- 1a vez ---------- */
  let r = await roda();
  assert.strictEqual(r.modelos.total, 3, JSON.stringify(r.modelos));
  assert.strictEqual(r.modelos.criados, 3); assert.strictEqual(r.modelos.enviados, 3); assert.deepStrictEqual(r.modelos.falhas, []);
  const dip = porChave('3d-hub/aaa.step'), to92 = porChave('3d/123.step'), res = porChave('3d-hub/bbb.step');
  for (const it of [dip, to92, res]) {
    assert.ok(it, 'item do modelo'); assert.strictEqual(it.tipo, 'modelo3d'); assert.strictEqual(it.categoria, 'eletronicos/modelos-3d');
    assert.strictEqual(it.rev_atual, 1);
    const a = it.revisoes[0].arquivos;
    assert.ok(a.step && a.origem && a.step.sha === a.origem.sha, 'rev 1 com step e origem (o mesmo blob)');
  }
  assert.deepStrictEqual(to92.atributos, { footprints: ['TO-92'], origem: 'pcblib-3d', arquivo: 'TO-92.STEP' });
  assert.strictEqual(dip.atributos.origem, 'pcblib-hub');
  assert.ok(E.vinculos.some(v => v.de_item === dip.id && v.relacao === 'footprint' && v.para_ref === 'DIP8'));
  assert.ok(servidos.includes('/Libs/3d/123.step'), 'o STEP da PcbLib veio do hub no ar');
  assert.strictEqual(E.blobs.get(to92.revisoes[0].arquivos.step.sha).dados.toString(), STEP('to92').toString());
  assert.strictEqual(r.placas.total, 1); assert.strictEqual(r.placas.publicadas, 1, JSON.stringify(r.placas));
  const placa = E.itens.get(E.chaves.get('nexoeletric-placa\u0000LM555 astável'));
  assert.ok(placa && placa.tipo === 'placa' && placa.categoria === 'placas' && placa.rev_atual === 1);
  const pac1 = JSON.parse(E.blobs.get(placa.revisoes[0].arquivos.placa.sha).dados.toString('utf8'));
  assert.strictEqual(pac1.format, 'eletrichub-placa-v1');
  assert.deepStrictEqual(Object.keys(pac1.modelos).sort(), ['3d-hub/aaa.step', '3d-hub/bbb.step', '3d/123.step']);
  for (const m of Object.values(pac1.modelos)) { assert.ok(m.item && m.rev === 1 && m.nome); assert.ok(!('arquivo' in m) && !('url' in m), 'sem arquivo/url: o modelo e um item'); }
  assert.strictEqual(pac1.modelos['3d/123.step'].item, to92.id);
  assert.strictEqual(pac1.componentes.find(c => c.ref === 'T1').corpos[0].modelo, '3d/123.step');
  assert.strictEqual(placa.atributos.pacote_sha, S.shaPacote(pac1), 'o hash guardado e o do pacote canonico');
  assert.deepStrictEqual(E.vinculos.filter(v => v.de_item === placa.id && v.relacao === 'usa').map(v => v.para_item).sort(), [dip.id, res.id, to92.id].sort());

  /* ---------- 2a vez: nada sobe ---------- */
  let n0 = nh.pedidos.length;
  r = await roda();
  const novos = nh.pedidos.slice(n0);
  assert.strictEqual(novos.filter(p => p.metodo === 'POST' && p.caminho === '/api/v1/blobs').length, 0, 'nenhum blob na 2a vez');
  assert.strictEqual(novos.filter(p => /\/revisoes$/.test(p.caminho) && p.metodo === 'POST').length, 0, 'nenhuma revisao na 2a vez');
  assert.strictEqual(r.modelos.existentes, 3); assert.strictEqual(r.placas.iguais, 1);

  /* ---------- o NexoCAD edita o DIP8 (rev 2) ---------- */
  assert.strictEqual(nh.revisaoNexo(dip.id, 'ISO-10303-21;\n/* editado no NexoCAD */\nEND-ISO-10303-21;\n'), 2);
  r = await roda();
  assert.strictEqual(dip.rev_atual, 2, 'o sincronizador nunca cria a rev 3 de um modelo');
  assert.strictEqual(r.placas.publicadas, 1, 'a placa muda: o pacote aponta a rev 2');
  assert.strictEqual(placa.rev_atual, 2);
  const pac2 = JSON.parse(E.blobs.get(placa.revisoes[1].arquivos.placa.sha).dados.toString('utf8'));
  assert.deepStrictEqual(pac2.modelos['3d-hub/aaa.step'], { item: dip.id, rev: 2, nome: 'DIP8.step' }, JSON.stringify(pac2.modelos));
  r = await roda();
  assert.strictEqual(placa.rev_atual, 2, 'sem mudanca, sem revisao');

  /* ---------- retoma + footprint novo ---------- */
  fs.writeFileSync(path.join(ROOT, 'Libs', '3d-hub', 'ccc.step'), STEP('novo'));
  libHub.models.m3 = { file: '3d-hub/ccc.step', name: 'SOT23.step' };
  libHub.footprints.push({ name: 'SOT23', pads: [], silk: [], bodies: [{ kind: 'step', model: 'm3', side: 'top', raw }] });
  libHub.footprints.push({ name: 'DIP8-LARGO', pads: [], silk: [], bodies: [{ kind: 'step', model: 'm1', side: 'top', raw }] });
  escreveHub();
  const meio = await cliente.criaItem({ tipo: 'modelo3d', categoria: 'eletronicos/modelos-3d', nome: 'SOT23', chaves: [{ sistema: 'nexoeletric-modelo', chave: '3d-hub/ccc.step' }] });
  assert.strictEqual(E.itens.get(meio.id).rev_atual, 0);
  r = await roda({ placas: false });
  assert.strictEqual(E.itens.get(meio.id).rev_atual, 1, 'o item criado sem revisao recebe a rev 1');
  assert.strictEqual(r.modelos.enviados, 1); assert.strictEqual(r.modelos.footprints, 1);
  assert.deepStrictEqual(dip.atributos.footprints, ['DIP8', 'DIP8-LARGO']);
  assert.ok(E.vinculos.some(v => v.de_item === dip.id && v.para_ref === 'DIP8-LARGO'));
  assert.strictEqual(dip.rev_atual, 2, 'footprint novo nao e revisao');

  /* ---------- o indice que o hub-nexo.js le ---------- */
  const ind = await S.indiceDoNexoHub(cliente);
  const di = ind.itens.find(i => i.id === dip.id), ti = ind.itens.find(i => i.id === to92.id);
  assert.deepStrictEqual(di.substitui, ['3d-hub/aaa.step'], 'rev 2: substitui');
  assert.deepStrictEqual(ti.substitui, [], 'rev 1: nao substitui nada');
  assert.strictEqual(ti.eletronico, undefined, 'modelo3d nao veste o footprint inteiro');
  assert.strictEqual(di.categoria, 'Eletrônicos'); assert.strictEqual(di.subcategoria, 'Modelos 3D da PcbLib');

  /* ---------- a CLI (o processo que o app desktop roda) ---------- */
  const filho = spawn(process.execPath, [path.join(ROOT, 'mcp', 'lib', 'nexohub-sync.js'), '--root', ROOT, '--hub', hubUrl, '--nexohub', nh.url],
    { env: Object.assign({}, process.env, { NEXOHUB_CONEXAO: path.join(TMP, 'nao-existe.json') }) });
  let saida = '';
  filho.stdout.on('data', d => { saida += d; });
  filho.stderr.on('data', d => { saida += d; });
  const cod = await new Promise(ok => filho.on('exit', ok));
  const linhas = saida.trim().split('\n').map(l => { try { return JSON.parse(l); } catch (_) { return { cru: l }; } });
  const fim = linhas.find(l => l.ev === 'fim');
  assert.strictEqual(cod, 0, saida); assert.ok(fim && fim.ok, saida);
  assert.strictEqual(fim.resumo.modelos.existentes, 4); assert.strictEqual(fim.resumo.placas.iguais, 1);

  /* ---------- Nexo Hub fora do ar: erro claro (offline), codigo 3 na CLI ---------- */
  await nh.fecha();
  await assert.rejects(roda(), e => e.codigo === 'fora_do_ar');
  const f2 = spawn(process.execPath, [path.join(ROOT, 'mcp', 'lib', 'nexohub-sync.js'), '--root', ROOT, '--nexohub', nh.url, '--sem-placas']);
  assert.strictEqual(await new Promise(ok => f2.on('exit', ok)), 3);

  hub.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-nexohub-sync: ok');
})().catch(e => { console.error(e); process.exit(1); });
