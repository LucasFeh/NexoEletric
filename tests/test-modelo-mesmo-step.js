// O mesmo STEP nao vira dois itens na biblioteca (1.63.0), contra o Nexo Hub de mentira (tests/nexohub-falso.js).
//   node tests/test-modelo-mesmo-step.js
// O corpo 3D de uma placa tem a chave "projeto:<p>/3d/<n>.step", diferente em cada projeto (ate MIRBC_DI251885b e
// MIRBC_DI251885B eram duas). O garanteModelo so procurava pela chave, entao cada placa enviada criava um item novo
// com o MESMO arquivo: medido em 2026-11-04, 144 itens a mais em 67 grupos na categoria Modelos 3D da PcbLib (o
// "step_temp" do CAP EL SMD 12.7mm D10 cinco vezes). Agora, sem item na chave, o STEP de mesmo sha256 que ja esta
// no Nexo Hub e reaproveitado: a chave nova passa a apontar para ele e os footprints se juntam.
'use strict';
const assert = require('assert');
const path = require('path');
const F = require('./nexohub-falso.js');
const S = require('../mcp/lib/nexohub-sync.js');
const NH = require('../mcp/lib/nexohub.js');

const STEP = n => Buffer.from(`ISO-10303-21;\nHEADER;\nFILE_NAME('${n}');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n`);

(async () => {
  const nh = await F.inicia({ porta: Number(process.env.TESTE_PORTA_NH || 8331) });
  let ok = 0;
  try {
    const cliente = NH.cliente({ url: nh.url, token: '' });
    const modelos = async () => (await cliente.todos({ tipo: 'modelo3d' })).itens;
    let lidos = 0;
    const ler = b => () => { lidos++; return b; };
    const cap = STEP('step_temp');

    /* 1. a biblioteca publica o modelo pela chave da PcbLib */
    const a = await S.garanteModelo(cliente, { file: '3d/2519432797.step', nome: 'step_temp.STEP', origem: 'pcblib-3d', footprints: ['CAP EL SMD 12.7mm D10'] }, ler(cap), 't');
    assert.ok(a.criado && a.rev === 1, 'o primeiro cria');
    ok++;

    /* 2. duas placas com o mesmo arquivo, chaves de projeto: reaproveitam o item, sem item novo */
    const b = await S.garanteModelo(cliente, { file: 'projeto:MIRBC_DI251885/3d/2519432797.step', nome: 'step_temp.STEP', origem: 'projeto', footprints: ['CAP EL SMD 12.7mm D10'] }, ler(cap), 't');
    const c = await S.garanteModelo(cliente, { file: 'projeto:MIRBC_DI251885B/3d/2519432797.step', nome: 'step_temp.STEP', origem: 'projeto', footprints: ['CAP EL SMD 12.7mm D10 B'] }, ler(cap), 't');
    assert.strictEqual(b.id, a.id, 'a placa 1 reaproveita o item da biblioteca');
    assert.strictEqual(c.id, a.id, 'a placa 2 tambem');
    assert.ok(!b.criado && !c.criado && !b.enviado && !c.enviado, 'nada criado, nada enviado');
    assert.strictEqual((await modelos()).length, 1, 'um item so');
    ok++;

    /* 3. a chave do projeto passa a resolver para o item (a proxima vez nem le o arquivo) */
    const res = await cliente.resolver('nexoeletric-modelo', ['projeto:MIRBC_DI251885/3d/2519432797.step', 'projeto:MIRBC_DI251885B/3d/2519432797.step']);
    assert.strictEqual(res['projeto:MIRBC_DI251885/3d/2519432797.step'].id, a.id);
    assert.strictEqual(res['projeto:MIRBC_DI251885B/3d/2519432797.step'].id, a.id);
    lidos = 0;
    await S.garanteModelo(cliente, { file: 'projeto:MIRBC_DI251885/3d/2519432797.step', nome: 'step_temp.STEP', origem: 'projeto', footprints: [] }, ler(cap), 't');
    assert.strictEqual(lidos, 0, 'chave conhecida nao le o STEP');
    ok++;

    /* 4. os footprints se juntam no item reaproveitado */
    const it = (await modelos())[0];
    assert.deepStrictEqual([...it.atributos.footprints].sort(), ['CAP EL SMD 12.7mm D10', 'CAP EL SMD 12.7mm D10 B']);
    ok++;

    /* 5. STEP diferente continua sendo item proprio */
    const d = await S.garanteModelo(cliente, { file: 'projeto:X/3d/1.step', nome: 'outro.step', origem: 'projeto', footprints: ['R'] }, ler(STEP('outro')), 't');
    assert.ok(d.criado && d.id !== a.id);
    assert.strictEqual((await modelos()).length, 2);
    ok++;

    /* 6. ao mesmo tempo (o sincronizador roda em lotes paralelos): o mesmo arquivo em duas chaves novas vira UM item */
    const novo = STEP('paralelo');
    const [p, q] = await Promise.all([
      S.garanteModelo(cliente, { file: 'projeto:A/3d/9.step', nome: 'p.step', origem: 'projeto', footprints: ['P'] }, ler(novo), 't'),
      S.garanteModelo(cliente, { file: 'projeto:B/3d/9.step', nome: 'p.step', origem: 'projeto', footprints: ['P'] }, ler(novo), 't'),
    ]);
    assert.strictEqual(p.id, q.id, 'em paralelo tambem um item so');
    assert.strictEqual((await modelos()).length, 3);
    ok++;
  } finally {
    await nh.fecha();
  }
  console.log('test-modelo-mesmo-step: ' + ok + ' ok');
})().catch(e => { console.error(e); process.exit(1); });
