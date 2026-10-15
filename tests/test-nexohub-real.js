// O sincronizador contra o Nexo Hub DE VERDADE (..\nexohub\server\index.mjs, ou NEXOHUB_SERVIDOR), numa
// pasta de dados temporaria e numa porta de teste (8341), sem gravar o ponteiro dos clientes.
//   node tests/test-nexohub-real.js
// Sem o servidor na maquina, o teste diz que pulou e sai com 0. Confere so pela API (o que um cliente ve):
//   - 1a vez: 3 modelos rev 1 (step + origem), placa rev 1 com modelos {item, rev}, vinculos usa;
//   - 2a vez: nenhum evento de revisao;
//   - o NexoCAD grava a rev 2 de um modelo: o sincronizador nao cria a 3, a placa ganha a 2.
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const R = path.join(__dirname, '..');
const SERVIDOR = process.env.NEXOHUB_SERVIDOR || path.join(R, '..', 'nexohub', 'server', 'index.mjs');
if (!fs.existsSync(SERVIDOR)) { console.log('test-nexohub-real: pulado (sem ' + SERVIDOR + ')'); process.exit(0); }

const STEP = n => Buffer.from(`ISO-10303-21;\nHEADER;\nFILE_NAME('${n}');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n`);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nexohub-real-'));
const ROOT = path.join(TMP, 'hub');
fs.mkdirSync(path.join(ROOT, 'Libs', '3d-hub'), { recursive: true });
for (const f of fs.readdirSync(R)) if (/^hub-.*\.js$/.test(f)) fs.copyFileSync(path.join(R, f), path.join(ROOT, f));
fs.cpSync(path.join(R, 'mcp'), path.join(ROOT, 'mcp'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'Projects'));
fs.cpSync(path.join(R, 'Projects', 'LM555 astável'), path.join(ROOT, 'Projects', 'LM555 astável'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'Libs', '3d-hub', 'aaa.step'), STEP('dip8'));
fs.writeFileSync(path.join(ROOT, 'Libs', '3d-hub', 'bbb.step'), STEP('res'));
const raw = { x2d: 0, y2d: 0, rot2d: 0, rotx: 0, roty: 0, rotz: 0, dz: 0 };
fs.writeFileSync(path.join(ROOT, 'Libs', 'pcblib-hub.js'), 'var pcblibHub = ' + JSON.stringify({ format: 'pcblib-hub-v1', units: 'mm',
  models: { m1: { file: '3d-hub/aaa.step', name: 'DIP8.step' }, m2: { file: '3d-hub/bbb.step', name: 'R1206.step' } },
  footprints: [{ name: 'DIP8', pads: [], silk: [], bodies: [{ kind: 'step', model: 'm1', name: 'DIP8.step', side: 'top', raw }] },
               { name: 'RES 1206', pads: [], silk: [], bodies: [{ kind: 'step', model: 'm2', name: 'R1206.step', side: 'top', raw }] }] }) + ';\n');
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const lib3d = { format: 'pcblib3d-v1', units: 'mm',
  footprints: { 'TO-92': { bodies: [{ side: 'top', kind: 'step', model: '{G1}', name: 'TO-92.STEP', matrix: I, raw }] } },
  models: { '{G1}': { file: '3d/123.step', name: 'TO-92.STEP' } } };
const hub = http.createServer((q, r) => {
  if (q.url === '/Libs/pcblib-3d.js') { r.end('var pcblib3d = ' + JSON.stringify(lib3d) + ';\n'); return; }
  if (q.url === '/Libs/3d/123.step') { r.end(STEP('to92')); return; }
  r.statusCode = 404; r.end('nao');
});

(async () => {
  const porta = Number(process.env.TESTE_PORTA_NH || 8341);
  const srv = spawn(process.execPath, [SERVIDOR, '--dados', path.join(TMP, 'dados'), '--porta', String(porta), '--host', '127.0.0.1', '--sem-ponteiro', '--sem-backup'], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${porta}`;
  const fim = () => { try { srv.kill(); } catch (_) { /* */ } hub.close(); };
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(url + '/api/v1/saude')).ok) break; } catch (_) { /* subindo */ } await new Promise(ok => setTimeout(ok, 100)); }
    await new Promise(ok => hub.listen(0, '127.0.0.1', ok));
    const hubUrl = `http://127.0.0.1:${hub.address().port}`;
    const S = require(path.join(ROOT, 'mcp', 'lib', 'nexohub-sync.js'));
    const NH = require(path.join(ROOT, 'mcp', 'lib', 'nexohub.js'));
    const c = NH.cliente({ url, token: '' });
    const roda = (o) => S.sincroniza(Object.assign({ root: ROOT, hubUrl, cliente: c }, o || {}));
    const revisoes = async () => (await c.eventos(0)).eventos.filter(e => e.tipo === 'item.revisao').length;

    let r = await roda();
    assert.strictEqual(r.modelos.enviados, 3, JSON.stringify(r.modelos)); assert.strictEqual(r.placas.publicadas, 1, JSON.stringify(r.placas));
    const res = await c.resolver('nexoeletric-modelo', ['3d-hub/aaa.step', '3d-hub/bbb.step', '3d/123.step']);
    assert.strictEqual(Object.keys(res).length, 3);
    for (const v of Object.values(res)) assert.strictEqual(v.rev, 1);
    const dip = await c.item(res['3d-hub/aaa.step'].id);
    assert.strictEqual(dip.tipo, 'modelo3d'); assert.strictEqual(dip.categoria, 'eletronicos/modelos-3d');
    assert.deepStrictEqual(Object.keys(dip.arquivos).sort(), ['origem', 'step']); assert.strictEqual(dip.arquivos.step.sha256, dip.arquivos.origem.sha256);
    assert.ok(dip.vinculos.some(v => v.relacao === 'footprint' && v.para_ref === 'DIP8'));
    const pr = (await c.resolver('nexoeletric-placa', ['LM555 astável']))['LM555 astável'];
    assert.ok(pr && pr.rev === 1);
    const pac = JSON.parse((await c.baixa(pr.id, 'placa')).toString('utf8'));
    assert.deepStrictEqual(pac.modelos['3d/123.step'], { item: res['3d/123.step'].id, rev: 1, nome: 'TO-92.STEP' });
    const placa = await c.item(pr.id);
    assert.strictEqual(placa.atributos.pacote_sha, S.shaPacote(pac));
    assert.strictEqual(placa.vinculos.filter(v => v.relacao === 'usa').length, 3);

    const n0 = await revisoes();
    r = await roda();
    assert.strictEqual(await revisoes(), n0, 'a 2a vez nao cria revisao nenhuma');
    assert.strictEqual(r.modelos.existentes, 3); assert.strictEqual(r.placas.iguais, 1);

    /* o NexoCAD grava a rev 2 do DIP8 */
    const b = await c.sobeBlob(Buffer.from('ISO-10303-21;\n/* editado */\nEND-ISO-10303-21;\n'), 'modelo.step');
    await c.novaRevisao(dip.id, { arquivos: { step: b.sha256, nexo: b.sha256 }, herdar: true, base: 1, app: 'nexocad' });
    r = await roda();
    assert.strictEqual((await c.item(dip.id)).rev, 2, 'o sincronizador nao cria a rev 3');
    assert.strictEqual(r.placas.publicadas, 1);
    const p2 = (await c.resolver('nexoeletric-placa', ['LM555 astável']))['LM555 astável'];
    assert.strictEqual(p2.rev, 2);
    const pac2 = JSON.parse((await c.baixa(p2.id, 'placa')).toString('utf8'));
    assert.deepStrictEqual(pac2.modelos['3d-hub/aaa.step'], { item: dip.id, rev: 2, nome: 'DIP8.step' });
    const ind = await S.indiceDoNexoHub(c);
    assert.deepStrictEqual(ind.itens.find(i => i.id === dip.id).substitui, ['3d-hub/aaa.step']);
    console.log('test-nexohub-real: ok (' + url + ')');
  } finally { fim(); setTimeout(() => fs.rmSync(TMP, { recursive: true, force: true }), 500); }
})().catch(e => { console.error(e); process.exit(1); });
