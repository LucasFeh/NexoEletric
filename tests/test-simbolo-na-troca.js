/* O símbolo da folha na troca de componente (schframe.js » casoDoSimbolo, partesDaDecisao).

   Pedido do dono (2026-10-30): no "Converter para o almoxarifado" o símbolo da folha às vezes já
   está certo e o componente é que está errado. A troca pergunta, quando os desenhos são
   diferentes, se o símbolo da folha substitui o do componente ou vira uma parte nova dele. Aqui
   se prova a regra pura: o que é "o mesmo desenho", quando não se pergunta, e as partes que
   cada decisão grava na biblioteca.

   Roda em Node, sem DOM: schframe.js sai no module.exports antes de tocar em document. */
const assert = require('assert');
const SF = require('../schframe.js');

const pino = (num, x, y, extra) => Object.assign({ num: String(num), name: 'P' + num, x, y, len: 100, orient: 180, type: 'Passive' }, extra || {});
const resistor = (n) => ({ part: n || 1, pins: [pino(1, -200, 0), pino(2, 200, 0, { orient: 0 })],
                           graphics: [{ g: 'rect', x1: -100, y1: -40, x2: 100, y2: 40, w: 10 }] });
const zigue = (n) => ({ part: n || 1, pins: [pino(1, -200, 0), pino(2, 200, 0, { orient: 0 })],
                        graphics: [{ g: 'polyline', pts: [[-100, 0], [-60, 40], [-20, -40], [20, 40], [60, -40], [100, 0]], w: 10 }] });

/* ── 1. o mesmo desenho ──
   A espessura, o nome do pino e o número da parte não fazem outro desenho: o mesmo símbolo vem
   do Altium e do espelho do almoxarifado com essas diferenças. A ordem também não. */
{
  const a = resistor(1);
  const b = { part: 3, pins: [Object.assign({}, a.pins[1], { name: 'B', hideName: true }), Object.assign({}, a.pins[0], { name: 'A' })],
              graphics: [Object.assign({}, a.graphics[0], { w: 4 })] };
  assert.ok(SF.desenhoIgual(a, b), 'espessura, nome do pino, ordem e número da parte não mudam o desenho');
  assert.ok(!SF.desenhoIgual(resistor(), zigue()), 'retângulo e zigue-zague são desenhos diferentes');
  const andou = resistor(); andou.pins[0].x = -300;
  assert.ok(!SF.desenhoIgual(resistor(), andou), 'pino em outro lugar é outro desenho (a fiação liga pela ponta)');
  const outroNum = resistor(); outroNum.pins[0].num = '3';
  assert.ok(!SF.desenhoIgual(resistor(), outroNum), 'número de pino é ligação: outro número é outro desenho');
  const preenchido = resistor(); preenchido.graphics[0].solid = true;
  assert.ok(!SF.desenhoIgual(resistor(), preenchido), 'corpo preenchido é outro desenho');
  assert.ok(!SF.desenhoIgual(null, resistor()), 'sem desenho não é igual a nada');
}

/* ── 2. quando NÃO se pergunta ── */
{
  assert.deepStrictEqual(SF.casoDoSimbolo(zigue(), [zigue(1)]), { caso: 'igual', parte: 1 },
    'o componente novo já tem o desenho da folha: mantém, sem perguntar');
  assert.deepStrictEqual(SF.casoDoSimbolo(zigue(), [resistor(1), zigue(2)]), { caso: 'igual', parte: 2 },
    'a parte que um "criar parte" de antes fez: a troca usa ela, sem perguntar de novo');
  assert.deepStrictEqual(SF.casoDoSimbolo(null, [resistor(1)]), { caso: 'sem-desenho' },
    'quadrado vermelho (símbolo sem desenho) não tem o que oferecer');
  assert.deepStrictEqual(SF.casoDoSimbolo({ pins: [], graphics: [] }, [resistor(1)]), { caso: 'sem-desenho' });
  assert.deepStrictEqual(SF.casoDoSimbolo(zigue(), [resistor(1)]), { caso: 'diferente' }, 'diferente pergunta');
}

/* ── 3. as partes que cada decisão grava ── */
{
  /* substituir: a parte 1 vira o desenho da folha; as outras ficam */
  const s = SF.partesDaDecisao([resistor(1), resistor(2)], zigue(7), 'substituir');
  assert.strictEqual(s.parte, 1);
  assert.strictEqual(s.parts.length, 2, 'substituir não apaga as outras partes');
  assert.ok(SF.desenhoIgual(s.parts[0], zigue()) && s.parts[0].part === 1);
  assert.ok(SF.desenhoIgual(s.parts[1], resistor()) && s.parts[1].part === 2);
  /* valor sem desenho próprio (herda o da família): passa a ter o dele */
  const s0 = SF.partesDaDecisao([], zigue(), 'substituir');
  assert.deepStrictEqual(s0.parts.map(p => p.part), [1]);

  /* parte: entra como a seguinte, com o número certo; a 1 fica */
  const p = SF.partesDaDecisao([resistor(1)], zigue(), 'parte');
  assert.strictEqual(p.parte, 2);
  assert.deepStrictEqual(p.parts.map(x => x.part), [1, 2]);
  assert.ok(SF.desenhoIgual(p.parts[0], resistor()) && SF.desenhoIgual(p.parts[1], zigue()));
  /* a mesma folha trocada de novo não cria a parte 3 igual à 2 */
  const p2 = SF.partesDaDecisao(p.parts, zigue(), 'parte');
  assert.strictEqual(p2.parte, 2);
  assert.strictEqual(p2.parts.length, 2);

  /* o que vai para o /save-almox: só part, pins e graphics, em cópia (o espelho não muda por baixo) */
  const fonte = zigue(); fonte.extra = 'x';
  const q = SF.partesDaDecisao([resistor(1)], fonte, 'parte');
  assert.deepStrictEqual(Object.keys(q.parts[1]).sort(), ['graphics', 'part', 'pins']);
  q.parts[1].pins[0].x = 999;
  assert.strictEqual(fonte.pins[0].x, -200, 'a parte gravada é cópia, não o desenho da folha');

  assert.deepStrictEqual(SF.partesDaDecisao([resistor(1)], zigue(), 'manter'), { parts: null, parte: null });
}

console.log('test-simbolo-na-troca OK (mesmo desenho, quando não pergunta, substituir e criar parte)');
