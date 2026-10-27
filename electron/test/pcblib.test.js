'use strict';
// lib/armazem.js » atualizarPcblib (1.29.0): o Libs/pcblib.js sai da PcbLib da casa que veio do NexoBD
// (Libs/Almox/FOOTPRINTS ALMOX.PcbLib), pelo tools/pcblib/pcblib2js.py com o Python do app. Contra a PcbLib DE
// VERDADE desta maquina (a copia da pasta de trabalho, ou ALTIUMHUB_TESTE_PCBLIB); sem ela, ou sem o Python
// embutido (electron/build/python), o teste pula.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const armazem = require('../lib/armazem');

const REPO = path.join(__dirname, '..', '..');
const PYTHON = process.env.ALTIUMHUB_PYTHON || path.join(__dirname, '..', 'build', 'python', 'python.exe');
const PCBLIB = [process.env.ALTIUMHUB_TESTE_PCBLIB, 'C:\\AltiumHub\\Libs\\Almox\\FOOTPRINTS ALMOX.PcbLib']
  .filter(Boolean).find((p) => fs.existsSync(p));
const pula = !fs.existsSync(PYTHON) ? 'sem o Python embutido (electron/build/python)' : !PCBLIB ? 'sem a PcbLib da casa nesta máquina' : false;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcblib-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function pasta(nome) {
  const ws = path.join(tmp, nome);
  for (const d of ['tools/pcblib', 'tools/pcbdoc']) {
    fs.mkdirSync(path.join(ws, d), { recursive: true });
    for (const f of fs.readdirSync(path.join(REPO, d))) if (f.endsWith('.py')) fs.copyFileSync(path.join(REPO, d, f), path.join(ws, d, f));
  }
  fs.mkdirSync(path.join(ws, 'Libs', 'Almox'), { recursive: true });
  const alvo = path.join(ws, 'Libs', 'Almox', 'FOOTPRINTS ALMOX.PcbLib');
  try { fs.linkSync(PCBLIB, alvo); } catch { fs.copyFileSync(PCBLIB, alvo); }
  fs.copyFileSync(path.join(REPO, 'Libs', 'rename-map.js'), path.join(ws, 'Libs', 'rename-map.js'));
  return ws;
}

const ler = (arq) => { const t = fs.readFileSync(arq, 'utf8'); return JSON.parse(t.slice(t.indexOf('{'), t.trimEnd().replace(/;$/, '').lastIndexOf('}') + 1)); };

test('o pcblib.js sai da PcbLib do NexoBD, com os nomes padronizados, e só é refeito quando ela muda', { skip: pula, timeout: 300000 }, async () => {
  const ws = pasta('a');
  const saida = path.join(ws, 'Libs', 'pcblib.js');
  const g = await armazem.atualizarPcblib({ ws, python: PYTHON });
  assert.ok(g && g.gerado && g.footprints > 500, `gerou ${g && g.footprints}`);
  const j = ler(saida);
  assert.equal(j.format, 'pcblib-v2');
  assert.equal(j.source, 'NexoBD: Libs/Almox/FOOTPRINTS ALMOX.PcbLib');
  assert.equal(j.footprints.length, g.footprints);
  const nomes = new Set(j.footprints.map((f) => f.name));
  // a PcbLib guarda 'Fio' e 'SOP8'; o espelho traz o nome do rename-map, como o ExportLibs do Altium trazia
  assert.ok(nomes.has('FIO') && !nomes.has('Fio'));
  const fp = j.footprints.find((f) => f.pads.length && f.silk.length);
  for (const k of ['name', 'description', 'bbox', 'pads', 'silk']) assert.ok(k in fp, k);
  for (const k of ['name', 'type', 'shape', 'x', 'y', 'w', 'h', 'rot', 'layer']) assert.ok(k in fp.pads[0], k);
  // a mesma PcbLib de novo: nada a fazer
  assert.equal(await armazem.atualizarPcblib({ ws, python: PYTHON }), null);
  // outra maquina com a mesma PcbLib gera o mesmo arquivo, byte a byte (o espelho nao cria revisao a toa)
  const ws2 = pasta('b');
  await armazem.atualizarPcblib({ ws: ws2, python: PYTHON });
  assert.equal(fs.readFileSync(path.join(ws2, 'Libs', 'pcblib.js'), 'utf8'), fs.readFileSync(saida, 'utf8'));
  // o rename-map mudou: refaz
  fs.appendFileSync(path.join(ws, 'Libs', 'rename-map.js'), '\n');
  assert.ok(await armazem.atualizarPcblib({ ws, python: PYTHON }));
});

test('sem a PcbLib, sem o gerador ou sem o Python: não mexe no pcblib.js que já está lá', async () => {
  const ws = path.join(tmp, 'vazia');
  fs.mkdirSync(path.join(ws, 'Libs'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'Libs', 'pcblib.js'), 'var pcblib = {"footprints":[]};');
  assert.equal(await armazem.atualizarPcblib({ ws, python: PYTHON }), null);
  assert.equal(await armazem.atualizarPcblib({ ws, python: '' }), null);
  assert.equal(fs.readFileSync(path.join(ws, 'Libs', 'pcblib.js'), 'utf8'), 'var pcblib = {"footprints":[]};');
});
