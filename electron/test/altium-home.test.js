'use strict';
// home.txt no formato que os .pas leem (HomeCfgGet/HomeCfgSet em ExportProject.pas).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function carrega() {
  const pd = fs.mkdtempSync(path.join(os.tmpdir(), 'ahpd-'));
  process.env.ProgramData = pd;
  delete require.cache[require.resolve('../lib/altium-home')];
  return { ah: require('../lib/altium-home'), pd };
}

test('arquivo novo: cabecalho dos .pas, BOM e CRLF', () => {
  const { ah, pd } = carrega();
  assert.strictEqual(ah.ARQ, path.join(pd, 'AltiumPCBMirror', 'home.txt'));
  assert.strictEqual(ah.get(), '');
  ah.set('C:\\AltiumHub');
  const bruto = fs.readFileSync(ah.ARQ);
  assert.deepStrictEqual([...bruto.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 com BOM');
  const txt = bruto.toString('utf8').slice(1);
  assert.ok(txt.startsWith(';'), 'primeira linha e comentario (um BOM nao entendido nao estraga a chave)');
  assert.ok(!/[^\r]\n/.test(txt), 'so CRLF');
  assert.strictEqual(ah.get(), 'C:\\AltiumHub');
});

test('preserva as outras linhas, troca a primeira home= e some com as repetidas', () => {
  const { ah } = carrega();
  fs.mkdirSync(path.dirname(ah.ARQ), { recursive: true });
  fs.writeFileSync(ah.ARQ, '\ufeff; comentario do usuario\r\nhome=D:\\antigo\r\nschlib=Y:\\lib.SchLib\r\n# outro\r\nHOME=E:\\repetida\r\n');
  assert.strictEqual(ah.get(), 'E:\\repetida', 'a ULTIMA vence, como no HomeCfgGet');
  ah.set('C:\\AltiumHub');
  const linhas = fs.readFileSync(ah.ARQ, 'utf8').slice(1).split('\r\n').filter(Boolean);
  assert.deepStrictEqual(linhas, ['; comentario do usuario', 'home=C:\\AltiumHub', 'schlib=Y:\\lib.SchLib', '# outro']);
  assert.strictEqual(ah.get('schlib'), 'Y:\\lib.SchLib');
});

test('status sabe se aponta para ca, sem tocar em caminho de rede', () => {
  const { ah } = carrega();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ahws-'));
  fs.writeFileSync(path.join(ws, 'AI-GUIDE.md'), '#');
  ah.set(ws);
  let s = ah.status(ws);
  assert.ok(s.apontaParaCa && s.homeValida === true);
  ah.set(ah.SERVIDOR);
  s = ah.status(ws);
  assert.ok(!s.apontaParaCa);
  assert.strictEqual(s.homeValida, null, 'share nao e conferido (timeout de SMB travaria o app)');
});

test('caminhos aposentados, que os .pas trocam sozinhos pelo servidor', () => {
  const { ah } = carrega();
  assert.ok(ah.aposentada('D:\\MICROCONTROLLER_DEV\\AltiumIA\\AltiumPCBMirror'));
  assert.ok(ah.aposentada('d:\\microcontroller_dev\\altiumia\\altiumpcbmirror\\'));
  assert.ok(!ah.aposentada('C:\\AltiumHub'));
});
