// hub-pcb3d-real.js: a cor do STEP vira o material certo (calibrado nos .p2m do SolidWorks) e as
// HDRIs do Blender (CC0) estao no vendor no formato que o leitor espera.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(path.join(R, 'hub-pcb3d-real.js')).href);

assert.strictEqual(M.classifica(0.78, 0.78, 0.80, true), 'estanho', 'pino cinza-claro do fabricante = estanho');
assert.strictEqual(M.classifica(0.95, 0.95, 0.95, true), 'prata');
assert.strictEqual(M.classifica(1, 0.82, 0.3, true), 'ouro', 'contato dourado');
assert.strictEqual(M.classifica(0.85, 0.5, 0.35, true), 'cobre');
assert.strictEqual(M.classifica(0.08, 0.08, 0.09, true), 'epoxi', 'corpo preto de CI');
assert.strictEqual(M.classifica(0.15, 0.35, 0.85, true), 'brilho', 'plastico colorido (eletrolitico azul)');
assert.strictEqual(M.classifica(0.5, 0.5, 0.5, false), 'fosco', 'sem cor no STEP: plastico fosco, nunca metal');
assert.ok(M.MATERIAIS.estanho.metal === 1 && M.MATERIAIS.fosco.metal === 0);

for (const n of ['studio', 'interior']) {
  const b = fs.readFileSync(path.join(R, 'vendor', 'hdri', n + '.rgbe'));
  assert.strictEqual(b.subarray(0, 4).toString('latin1'), 'RGBE', n + ': cabecalho');
  const w = b.readUInt32LE(4), h = b.readUInt32LE(8);
  assert.ok(w === 2 * h && b.length === 12 + w * h * 4, n + ': ' + w + 'x' + h + ' equiretangular');
}
assert.ok(/CC0/.test(fs.readFileSync(path.join(R, 'vendor', 'hdri', 'LICENSE-CC0.txt'), 'utf8')), 'a licenca das HDRIs viaja junto');
console.log('test-pcb3d-real OK (classificacao dos materiais, HDRIs CC0)');
