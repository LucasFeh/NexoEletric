const assert = require('assert');

/* ═══════════ trocar o SÍMBOLO de uma PARTE sem perder as outras ═══════════
   O /api/symbols/save substitui a lista de partes e recalcula o partcount pelo que recebe
   (symserver.py » _salva_espelho). Mandar só a parte escolhida apaga as demais no espelho E
   na .SchLib, em todos os projetos — e o servidor aprova, porque confere o gravado contra o
   que foi PEDIDO. São 43 dos 401 componentes da casa; o CONE PADRAO tem 80 partes.
   Este arquivo é a trava: se ele cair, o recurso apaga trabalho. */

const SF = require('../schframe.js');
const { applyLibSymbol } = require('../hub-symed.js').pure;
const { loadVar } = require('./load');
const monta = (c, n, s) => SF.montaPartsTrocando(c, n, s, applyLibSymbol);

const pino = (num, x) => ({ num: String(num), name: 'P' + num, x, y: 0, len: 100, orient: 0, type: 'Passive' });
const parte = (n, k) => ({ part: n, pins: Array.from({ length: k }, (_, i) => pino(i + 1, i * 100)),
                           graphics: [{ g: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, w: 10 }] });

/* ── o caso que destrói: componente de 3 partes, troca só a do meio ── */
{
  const comp = { name: 'TRES', parts: [parte(1, 2), parte(2, 2), parte(3, 2)] };
  const sim = { name: 'NOVO', pins: [pino(9, 555), pino(8, 666)],
                graphics: [{ g: 'line', x1: 1, y1: 2, x2: 3, y2: 4, w: 10 }] };
  const r = monta(comp, 2, sim);
  assert.ok(!r.erro, 'contagem bate: não pode recusar');
  assert.strictEqual(r.parts.length, 3, 'AS TRÊS PARTES VOLTAM — é a razão de este arquivo existir');
  assert.deepStrictEqual(r.parts.map(p => p.part), [1, 2, 3], 'na ordem e com a numeração original');
  assert.strictEqual(r.trocada, 2);
  assert.strictEqual(r.intactas, 2);
  /* as outras duas voltam pelo MESMO objeto: nada foi tocado nelas */
  assert.strictEqual(r.parts[0], comp.parts[0], 'parte 1 intacta, e pela mesma referência');
  assert.strictEqual(r.parts[2], comp.parts[2], 'parte 3 intacta, e pela mesma referência');
  /* a trocada leva o desenho novo e mantém a identidade dos pinos */
  assert.notStrictEqual(r.parts[1], comp.parts[1], 'a parte 2 é um objeto NOVO (não muta o espelho)');
  assert.deepStrictEqual(r.parts[1].graphics, sim.graphics, 'gráficos vieram do símbolo');
  assert.deepStrictEqual(r.parts[1].pins.map(p => p.x), [555, 666], 'posições vieram do símbolo');
  assert.deepStrictEqual(r.parts[1].pins.map(p => p.num), ['1', '2'], 'número do pino é do COMPONENTE');
  assert.deepStrictEqual(r.parts[1].pins.map(p => p.name), ['P1', 'P2'], 'nome do pino é do COMPONENTE');
}

/* ── pinagem não muda: contagem diferente é RECUSA, não aviso ── */
{
  const comp = { name: 'UM', parts: [parte(1, 4)] };
  const r = monta(comp, 1, { name: 'S', pins: [pino(1, 0), pino(2, 10)], graphics: [] });
  assert.ok(r.erro, 'contagem diferente tem de recusar');
  assert.ok(/2 pinos/.test(r.erro) && /tem 4/.test(r.erro), 'o motivo diz os dois números: ' + r.erro);
  assert.ok(!r.parts, 'recusa não devolve parts');
}

/* ── parte inexistente, e componente sem parte nenhuma ── */
{
  const comp = { name: 'UM', parts: [parte(1, 1)] };
  assert.ok(/parte 7 não existe/.test(monta(comp, 7, { pins: [pino(1, 0)] }).erro));
  assert.ok(/nenhuma parte/.test(monta({ name: 'X', parts: [] }, 1, { pins: [] }).erro));
}

/* ── aceita símbolo em schlib-v2 (parts[]) além do symlib-v1 (pins na raiz) ── */
{
  const comp = { name: 'UM', parts: [parte(1, 1)] };
  const r = monta(comp, 1, { name: 'S', parts: [{ part: 1, pins: [pino(5, 42)], graphics: [] }] });
  assert.ok(!r.erro, r.erro);
  assert.strictEqual(r.parts[0].pins[0].x, 42);
}

/* ── o CONE PADRAO de verdade: 80 partes, e 80 têm de voltar ── */
{
  const schlib = loadVar('Libs/schlib.js', 'schlib');
  const cone = schlib.symbols.find(s => s.name === 'CONE PADRAO');
  assert.ok(cone, 'CONE PADRAO tem de existir no espelho da casa');
  assert.strictEqual(cone.parts.length, 80, 'e ter as 80 partes');
  const alvo = cone.parts.find(p => p.part === 3);
  const sim = { name: 'EMPRESTADO', graphics: [{ g: 'rect', x1: -50, y1: -50, x2: 50, y2: 50, w: 10 }],
                pins: alvo.pins.map((p, i) => Object.assign({}, p, { x: 900 + i, num: 'zzz', name: 'zzz' })) };
  const r = monta(cone, 3, sim);
  assert.ok(!r.erro, r.erro);
  assert.strictEqual(r.parts.length, 80, 'AS 80 PARTES VOLTAM');
  assert.deepStrictEqual(r.parts.map(p => p.part), cone.parts.map(p => p.part), 'numeração preservada');
  assert.strictEqual(r.intactas, 79);
  assert.deepStrictEqual(r.parts[2].pins.map(p => p.num), alvo.pins.map(p => p.num),
                        'o número do pino continua o do componente, não o do símbolo');
  /* e o espelho em memória não foi tocado */
  assert.notStrictEqual(r.parts[2], cone.parts[2]);
  assert.strictEqual(cone.parts[2].pins[0].x, alvo.pins[0].x, 'o componente original ficou intacto');
}

console.log('test-symparts OK (3 partes, recusa por pinagem, parte inexistente, schlib-v2, CONE PADRAO com 80)');
