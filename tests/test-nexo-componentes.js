// Uma biblioteca so (1.13): os componentes do NexoCAD (itens `componente` do Nexo Hub com
// atributos.footprints) entram na biblioteca de footprints (Libs/pcblib-hub.js) como o corpo 3D
// nexo:<id> desses footprints -- mcp/lib/nexohub-sync.js » trazComponentes / tiraComponente.
//   node tests/test-nexo-componentes.js
// A pasta do hub e uma copia temporaria: nada grava no repositorio.
//   - footprint so do Altium: entra como copia dele (pads/silk) com o corpo do item, sem os STEP antigos
//   - footprint que ja e da biblioteca: ganha o corpo (o resto fica)
//   - footprint que nao existe: semFootprint (nao inventa pads); item modelo3d e item sem revisao: ignorados
//   - outro item ja veste o footprint: conflito, nao troca
//   - 2a rodada: nada muda, o arquivo nao e regravado
//   - tiraComponente desfaz; o MCP (contexto.libs) ve os footprints da biblioteca junto com os do Altium
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const R = path.join(__dirname, '..');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-componentes-'));
const ROOT = path.join(TMP, 'hub');
fs.mkdirSync(path.join(ROOT, 'Libs'), { recursive: true });
for (const f of fs.readdirSync(R)) if (/^hub-.*\.js$/.test(f)) fs.copyFileSync(path.join(R, f), path.join(ROOT, f));
fs.cpSync(path.join(R, 'mcp'), path.join(ROOT, 'mcp'), { recursive: true });

const raw = { x2d: 0, y2d: 0, rot2d: 0, rotx: 0, roty: 0, rotz: 0, dz: 0 };
const pad = (n, x) => ({ name: n, type: 'smd', shape: 'rect', x, y: 0, w: 1, h: 1.2, rot: 0, layer: 'Top' });
fs.writeFileSync(path.join(ROOT, 'Libs', 'pcblib.js'), 'var pcblib = ' + JSON.stringify({ format: 'pcblib-v2', units: 'mm', footprints: [
  { name: 'R0805', description: 'resistor 0805', pads: [pad('1', -1), pad('2', 1)], silk: [] },
  { name: 'SOT23', description: 'sot-23', pads: [pad('1', -1), pad('2', 1), pad('3', 0)], silk: [] },
] }) + ';\n');
fs.writeFileSync(path.join(ROOT, 'Libs', 'pcblib-hub.js'), 'var pcblibHub = ' + JSON.stringify({ format: 'pcblib-hub-v1', units: 'mm',
  models: { m1: { file: '3d-hub/aaa.step', name: 'DIP8.step', bytes: 10 } },
  footprints: [
    { name: 'DIP8', description: 'dip', pads: [pad('1', 0)], silk: [], bodies: [{ kind: 'extruded', pts: [[0, 0], [1, 0], [1, 1]], standoff: 0, height: 1 }], hub: { criado: 'x' } },
    { name: 'QFN16', description: 'qfn', pads: [pad('1', 0)], silk: [], bodies: [{ kind: 'step', model: 'nexo:outro', name: 'outro', side: 'top', raw }], hub: { criado: 'x' } },
  ] }) + ';\n');

const { Contexto } = require(path.join(ROOT, 'mcp', 'lib', 'contexto.js'));
const SY = require(path.join(ROOT, 'mcp', 'lib', 'nexohub-sync.js'));
const ctx = new Contexto({ root: ROOT });
const arq = path.join(ROOT, 'Libs', 'pcblib-hub.js');
const le = () => ctx.lib('pcblib-hub.js', 'pcblibHub');
const comp = (id, fps, extra) => Object.assign({ id, nome: 'Peça ' + id, tipo: 'componente', rev: 2, atributos: { footprints: fps } }, extra || {});

(async () => {
  /* o MCP antes: so os do Altium + os da biblioteca */
  const antes = ctx.libs().pcblib.footprints.map(f => f.name).sort();
  assert.deepStrictEqual(antes, ['DIP8', 'QFN16', 'R0805', 'SOT23'], 'contexto.libs mescla a biblioteca com o Altium');

  const itens = [
    comp('el-r', ['R0805']),                       // so no Altium -> copia + corpo
    comp('el-dip', ['DIP8']),                      // ja na biblioteca -> ganha o corpo
    comp('el-novo', ['TO220']),                    // nao existe
    comp('el-qfn', ['QFN16']),                     // conflito com nexo:outro
    comp('el-semrev', ['SOT23'], { rev: 0 }),      // sem revisao: ignora
    { id: 'mod', nome: 'modelo', tipo: 'modelo3d', rev: 1, atributos: { footprints: ['SOT23'] } },   // modelo3d: ignora
  ];
  const cliente = { todos: async (q) => { assert.strictEqual(q.tipo, 'componente'); return { itens }; } };
  const r = await SY.trazComponentes({ ctx, cliente });
  assert.deepStrictEqual(r.adicionados.map(a => a.footprint).sort(), ['DIP8', 'R0805']);
  assert.deepStrictEqual(r.semFootprint.map(s => s.footprint), ['TO220']);
  assert.deepStrictEqual(r.conflitos.map(c => [c.footprint, c.ja]), [['QFN16', 'outro']]);
  assert.strictEqual(r.componentes, 4, 'sem revisao e modelo3d ficam de fora');

  const L = le();
  const r0805 = L.footprints.find(f => f.name === 'R0805');
  assert.ok(r0805, 'o footprint do Altium entrou na biblioteca');
  assert.strictEqual(r0805.pads.length, 2, 'com os pads do Altium');
  assert.deepStrictEqual(r0805.bodies.map(b => [b.kind, b.model]), [['step', 'nexo:el-r']]);
  assert.deepStrictEqual(r0805.bodies[0].raw, raw, 'na identidade do footprint (contrato §1)');
  assert.strictEqual(r0805.hub.por, 'nexocad'); assert.strictEqual(r0805.hub.nexo, 'el-r'); assert.strictEqual(r0805.hub.base, 'R0805');
  assert.deepStrictEqual(L.models['nexo:el-r'], { file: 'nexo:el-r', name: 'Peça el-r', nexo: 'el-r' });
  const dip = L.footprints.find(f => f.name === 'DIP8');
  assert.deepStrictEqual(dip.bodies.map(b => b.kind), ['extruded', 'step'], 'o corpo que nao e STEP fica');
  assert.strictEqual(L.footprints.find(f => f.name === 'QFN16').bodies[0].model, 'nexo:outro', 'conflito nao troca');
  assert.ok(!L.footprints.some(f => f.name === 'TO220'), 'nao inventa footprint');
  assert.ok(L.models.m1, 'os modelos que ja existiam ficam');

  /* idempotente: a 2a rodada nao regrava */
  const mt = fs.statSync(arq).mtimeMs, txt = fs.readFileSync(arq, 'utf8');
  const r2 = await SY.trazComponentes({ ctx, cliente });
  assert.strictEqual(r2.adicionados.length, 0); assert.strictEqual(r2.jaEstavam, 2);
  assert.strictEqual(fs.readFileSync(arq, 'utf8'), txt); assert.strictEqual(fs.statSync(arq).mtimeMs, mt);

  /* os modelos nexo: nao voltam ao Nexo Hub como modelo3d */
  assert.ok(!SY.coletaModelos(le(), null).some(m => /^nexo:/.test(m.file)));

  /* o MCP ve o R0805 da biblioteca (com o corpo do NexoCAD) no lugar do do Altium */
  const p = ctx.libs().pcblib;
  assert.strictEqual(p.footprints.find(f => f.name === 'R0805').bodies[0].model, 'nexo:el-r');
  assert.strictEqual(p.footprints.filter(f => f.name === 'R0805').length, 1, 'um R0805 so');

  /* desfazer: o corpo sai, o footprint fica, o modelo sem uso sai do indice */
  assert.strictEqual(SY.tiraComponente(ctx, 'el-r', 'R0805'), true);
  const L3 = le();
  assert.deepStrictEqual(L3.footprints.find(f => f.name === 'R0805').bodies, []);
  assert.ok(!L3.models['nexo:el-r']);
  assert.strictEqual(SY.tiraComponente(ctx, 'el-r', 'R0805'), false, 'nada a tirar');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-nexo-componentes: ok');
})().catch(e => { console.error(e); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(1); });
