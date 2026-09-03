const assert = require('assert');

/* ═══════════════ o editor de símbolos (parte pura) ═══════════════
   hub-symed.js tem de carregar em Node sem DOM: tudo de tela mora dentro de função. O que
   se prova aqui é a geometria que o canvas usa — clique acha o item certo, mover/girar/
   espelhar são reversíveis, o que sai para o servidor é schlib-v2 limpo, e aplicar um corpo
   da biblioteca preserva a pinagem quando a contagem bate. */

const M = require('../hub-symed.js');
const P = M.pure;
assert.strictEqual(typeof M.render, 'function');
assert.strictEqual(typeof M.dirty, 'function');
assert.strictEqual(M.dirty(), false, 'nasce limpo');

/* ── snap ── */
assert.strictEqual(P.snap(123, 100), 100);
assert.strictEqual(P.snap(151, 100), 200);
assert.strictEqual(P.snap(-26, 10), -30);
assert.strictEqual(P.snap(7, 0), 7, 'passo 0 não divide por zero');
assert.strictEqual(P.pinSnapOf(25), 100, 'pino nunca cai em 25: vai para 100');
assert.strictEqual(P.pinSnapOf(50), 50);
assert.strictEqual(P.pinSnapOf(10), 10);

/* ── pino: ponta quente e aviso de grade ── */
assert.deepStrictEqual(P.pinHot({ x: -100, y: 0, len: 100, orient: 180 }), { x: -200, y: 0 });
assert.deepStrictEqual(P.pinHot({ x: 0, y: 50, len: 100, orient: 90 }), { x: 0, y: 150 });
assert.deepStrictEqual(P.pinsOffGrid([{ num: '1', x: -100, y: 0, len: 100, orient: 180 },
                                       { num: '2', x: 0, y: 50, len: 100, orient: 90 }]).map(p => p.num), ['2']);

/* ── hitTest: um resistor com dois pinos, um retângulo, uma linha, um arco e um rótulo ── */
const part = {
  part: 1,
  pins: [{ num: '1', name: 'A', x: -100, y: 0, len: 100, orient: 180, type: 'Passive' },
         { num: '2', name: 'B', x: 100, y: 0, len: 100, orient: 0, type: 'Passive' }],
  graphics: [
    { g: 'rect', x1: -100, y1: -40, x2: 100, y2: 40, w: 10, solid: true },
    { g: 'line', x1: -300, y1: 200, x2: 300, y2: 200, w: 10 },
    { g: 'arc', cx: 0, cy: -300, r: 100, sa: 0, ea: 90, w: 10 },
    { g: 'label', x: 0, y: 400, text: 'R?', rot: 0, size: 10 },
    { g: 'polyline', pts: [[-500, -500], [-400, -500], [-400, -400]], w: 10 },
  ],
};
assert.deepStrictEqual(P.hitTest(part, -150, 3, 10), { kind: 'pin', idx: 0 }, 'pino 1 pelo corpo');
assert.deepStrictEqual(P.hitTest(part, 195, 0, 10), { kind: 'pin', idx: 1 }, 'pino 2 perto da ponta quente');
assert.deepStrictEqual(P.hitTest(part, 0, 0, 10), { kind: 'g', idx: 0 }, 'dentro do retângulo sólido');
assert.deepStrictEqual(P.hitTest(part, 0, 38, 10), { kind: 'g', idx: 0 }, 'borda do retângulo');
assert.deepStrictEqual(P.hitTest(part, 250, 205, 10), { kind: 'g', idx: 1 }, 'linha');
assert.deepStrictEqual(P.hitTest(part, 70.7, -300 + 70.7, 10), { kind: 'g', idx: 2 }, 'arco a 45°');
assert.strictEqual(P.hitTest(part, -100, -300, 10), null, 'a 180° o arco de 0–90 não existe');
assert.deepStrictEqual(P.hitTest(part, 10, 405, 10), { kind: 'g', idx: 3 }, 'rótulo pela caixa');
assert.deepStrictEqual(P.hitTest(part, -450, -502, 10), { kind: 'g', idx: 4 }, 'polilinha pelo segmento');
assert.deepStrictEqual(P.hitTest(part, -398, -403, 10), { kind: 'g', idx: 4, vertex: 2 }, 'vértice da polilinha');
assert.strictEqual(P.hitTest(part, 1000, 1000, 10), null, 'longe de tudo');
/* círculo (0–360) acerta em qualquer ângulo */
assert.deepStrictEqual(P.hitTest({ pins: [], graphics: [{ g: 'arc', cx: 0, cy: 0, r: 50, sa: 0, ea: 360 }] }, -50, 0, 5), { kind: 'g', idx: 0 });
/* elipse sólida e vazia */
assert.deepStrictEqual(P.hitTest({ pins: [], graphics: [{ g: 'ellipse', cx: 0, cy: 0, rx: 100, ry: 50 }] }, 0, 0, 5), null, 'elipse vazia: o meio não pega');
assert.deepStrictEqual(P.hitTest({ pins: [], graphics: [{ g: 'ellipse', cx: 0, cy: 0, rx: 100, ry: 50 }] }, 100, 0, 5), { kind: 'g', idx: 0 });
assert.deepStrictEqual(P.hitTest({ pins: [], graphics: [{ g: 'poly', pts: [[0, 0], [100, 0], [0, 100]], solid: true }] }, 20, 20, 5), { kind: 'g', idx: 0 }, 'polígono sólido por dentro');

/* ── moveItem: não muda o original, desloca cada forma do jeito dela ── */
{
  const pin = P.moveItem(part.pins[0], 10, -20);
  assert.deepStrictEqual([pin.x, pin.y], [-90, -20]);
  assert.strictEqual(part.pins[0].x, -100, 'original intacto');
  const r = P.moveItem(part.graphics[0], 5, 5);
  assert.deepStrictEqual([r.x1, r.y1, r.x2, r.y2], [-95, -35, 105, 45]);
  const a = P.moveItem(part.graphics[2], 1, 2);
  assert.deepStrictEqual([a.cx, a.cy, a.r], [1, -298, 100]);
  const pl = P.moveItem(part.graphics[4], 100, 100);
  assert.deepStrictEqual(pl.pts, [[-400, -400], [-300, -400], [-300, -300]]);
  const lb = P.moveItem(part.graphics[3], -1, -1);
  assert.deepStrictEqual([lb.x, lb.y], [-1, 399]);
  const mv = P.moveVertex(part.graphics[4], 1, 7, 8);
  assert.deepStrictEqual(mv.pts[1], [7, 8]);
  assert.deepStrictEqual(part.graphics[4].pts[1], [-400, -500], 'original intacto');
}

/* ── rotateAll: pino gira o orient, arco gira os ângulos, 4× volta ao original ── */
{
  const r1 = P.rotateAll(part);
  assert.deepStrictEqual([r1.pins[0].x, r1.pins[0].y, r1.pins[0].orient], [0, -100, 270], 'pino 1: (-100,0)@180 → (0,-100)@270');
  assert.deepStrictEqual([r1.pins[1].x, r1.pins[1].y, r1.pins[1].orient], [0, 100, 90]);
  assert.deepStrictEqual([r1.graphics[2].sa, r1.graphics[2].ea], [90, 180], 'arco 0–90 → 90–180');
  assert.deepStrictEqual([r1.graphics[0].x1, r1.graphics[0].y1, r1.graphics[0].x2, r1.graphics[0].y2], [-40, -100, 40, 100], 'retângulo renormalizado');
  assert.strictEqual(r1.graphics[3].rot, 90, 'rótulo gira');
  let r = part; for (let i = 0; i < 4; i++) r = P.rotateAll(r);
  assert.deepStrictEqual(r, part, '4 giros = identidade');
  /* círculo inteiro continua 0–360 (girar os ângulos daria 90–90, que o canvas não desenha) */
  const c = P.rotateAll({ pins: [], graphics: [{ g: 'arc', cx: 10, cy: 0, r: 5, sa: 0, ea: 360 }] });
  assert.deepStrictEqual([c.graphics[0].cx, c.graphics[0].cy, c.graphics[0].sa, c.graphics[0].ea], [0, 10, 0, 360]);
}

/* ── mirrorAll: 2× volta; orient vira 180-a; arco troca as pontas ── */
{
  const m1 = P.mirrorAll(part);
  assert.deepStrictEqual([m1.pins[0].x, m1.pins[0].orient], [100, 0]);
  assert.deepStrictEqual([m1.pins[1].x, m1.pins[1].orient], [-100, 180]);
  assert.deepStrictEqual([m1.graphics[2].sa, m1.graphics[2].ea], [90, 180], 'arco 0–90 espelhado em X = 90–180');
  assert.deepStrictEqual(m1.graphics[4].pts, [[500, -500], [400, -500], [400, -400]]);
  assert.deepStrictEqual(P.mirrorAll(m1), part, '2 espelhos = identidade');
  const v = { pins: [{ num: '1', name: '', x: 0, y: 100, len: 100, orient: 90, type: 'Passive' }], graphics: [] };
  assert.strictEqual(P.mirrorAll(v).pins[0].orient, 90, 'pino vertical não muda de orient no espelho X');
}

/* ── bbox ── */
{
  const b = P.bbox(part);
  assert.ok(b.x1 <= -500 && b.x2 >= 300 && b.y1 <= -500 && b.y2 >= 400);
}

/* ── serializeSymbol: schlib-v2 limpo, só as sete formas, números redondos ── */
{
  const sym = {
    name: 'RES [ SMD ]', description: 'resistor', footprints: [{ name: 'RES 0805', incurrentlib: true, current: true }],
    parts: [{ part: 1,
      pins: [{ num: 1, name: null, x: '-100.4', y: 0.2, len: 100, orient: 181, type: 'Foo' }],
      graphics: [
        { g: 'rect', x1: 10, y1: 10, x2: -10, y2: -10, w: 11, solid: 1 },
        { g: 'arc', cx: 0.00049, cy: 0, r: -50, w: 3 },
        { g: 'label', x: 0, y: 0, text: 12, size: 8.4 },
        { g: 'bezier', pts: [] },              /* não é do vocabulário: cai fora */
        { g: 'polyline', pts: [[1.23456, 2]], w: 25 },
      ] }],
  };
  const out = P.serializeSymbol(sym);
  assert.strictEqual(out.name, 'RES [ SMD ]');
  assert.strictEqual(out.description, 'resistor');
  assert.strictEqual(out.partcount, 1);
  assert.deepStrictEqual(out.footprints, sym.footprints);
  assert.notStrictEqual(out.footprints, sym.footprints, 'cópia, não referência');
  const p = out.parts[0];
  assert.strictEqual(p.part, 1);
  assert.deepStrictEqual(p.pins[0], { num: '1', name: '', x: -100, y: 0, len: 100, orient: 180, type: 'Passive' });
  assert.strictEqual(p.graphics.length, 4, 'bezier saiu');
  assert.deepStrictEqual(p.graphics[0], { g: 'rect', x1: -10, y1: -10, x2: 10, y2: 10, w: 10, solid: true });
  assert.deepStrictEqual(p.graphics[1], { g: 'arc', cx: 0, cy: 0, r: 50, sa: 0, ea: 360, w: 4 });
  assert.deepStrictEqual(p.graphics[2], { g: 'label', x: 0, y: 0, text: '12', rot: 0, size: 8 });
  assert.deepStrictEqual(p.graphics[3], { g: 'polyline', pts: [[1.235, 2]], w: 20 });
  /* tipos: tudo que o hub e o servidor esperam */
  for (const pin of p.pins) { assert.strictEqual(typeof pin.num, 'string'); assert.strictEqual(typeof pin.name, 'string'); assert.ok(Number.isInteger(pin.x) && Number.isInteger(pin.y) && Number.isInteger(pin.len)); assert.ok([0, 90, 180, 270].includes(pin.orient)); assert.ok(P.PIN_TYPES.includes(pin.type)); }
  for (const g of p.graphics) { assert.ok(['line', 'rect', 'arc', 'ellipse', 'poly', 'polyline', 'label'].includes(g.g)); if ('w' in g) assert.ok(P.WIDTHS.includes(g.w)); }
  assert.ok(!('parts' in sym.parts[0]), 'sem lixo no original');
  assert.strictEqual(sym.parts[0].pins[0].x, '-100.4', 'original intacto');
  /* símbolo sem partes ainda serializa */
  assert.deepStrictEqual(P.serializeSymbol({ name: 'X' }).parts, []);
  assert.strictEqual(P.serializeSymbol({ name: 'X' }).partcount, 1);
}

/* ── w só quando existe: rect/ellipse/poly do leitor vêm sem w, e o PATCH só preserva o
   LineWidth original da SchLib quando w NÃO vem — inventar 10 engrossava a borda ── */
{
  const r = P.cleanGraphic({ g: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, solid: false });
  assert.ok(!('w' in r), 'rect sem w continua sem w: ' + JSON.stringify(r));
  const e = P.cleanGraphic({ g: 'ellipse', cx: 0, cy: 0, rx: 5, ry: 5 });
  assert.ok(!('w' in e), 'ellipse sem w continua sem w');
  const pg = P.cleanGraphic({ g: 'poly', pts: [[0, 0], [1, 0], [0, 1]], solid: true });
  assert.ok(!('w' in pg), 'poly sem w continua sem w');
  assert.strictEqual(P.cleanGraphic({ g: 'poly', pts: [], w: 22 }).w, 20, 'poly com w escolhido sai na tabela');
  /* line/arc/polyline sempre têm w (o leitor exporta), então o default 10 fica */
  assert.strictEqual(P.cleanGraphic({ g: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }).w, 10);
  assert.strictEqual(P.cleanGraphic({ g: 'polyline', pts: [] }).w, 10);
}

/* ── arco sa == ea é círculo: sai 0/360 como o leitor grava (o canvas não traça 10→10) ── */
{
  const a = P.cleanGraphic({ g: 'arc', cx: 0, cy: 0, r: 50, sa: 10, ea: 10, w: 10 });
  assert.deepStrictEqual([a.sa, a.ea], [0, 360]);
  const b = P.cleanGraphic({ g: 'arc', cx: 0, cy: 0, r: 50, sa: 90, ea: 450, w: 10 });
  assert.deepStrictEqual([b.sa, b.ea], [0, 360], 'volta inteira por qualquer ângulo');
  const c = P.cleanGraphic({ g: 'arc', cx: 0, cy: 0, r: 50, sa: 10, ea: 20, w: 10 });
  assert.deepStrictEqual([c.sa, c.ea], [10, 20], 'arco de verdade não muda');
  const n = P.normArc({ sa: 45, ea: 45 });
  assert.deepStrictEqual([n.sa, n.ea], [0, 360]);
}

/* ── pino só em múltiplo de 10 mil: é o que o registro binário guarda; o espelho não pode
   ficar com x=5 enquanto a SchLib recebe 10 ── */
{
  assert.strictEqual(P.mil10(5), 10); assert.strictEqual(P.mil10(4), 0); assert.strictEqual(P.mil10(-26), -30);
  const p = P.cleanPin({ num: 1, x: 5, y: 3, len: 95, orient: 0 });
  assert.deepStrictEqual([p.x, p.y, p.len], [10, 0, 100]);
  const q = P.cleanPin({ num: 1, x: 390.5515, y: 393.701, len: 100, orient: 0 });
  assert.deepStrictEqual([q.x, q.y], [390, 390], 'PinFrac do leitor cai na grade de 10');
}

/* ── applyLibSymbol: contagem igual mantém num/name/type na ordem; diferente avisa ── */
{
  const lib = { id: 's0001', name: 'Resistor', kind: 'generico',
    pins: [{ num: '1', name: 'P1', x: -200, y: 0, len: 100, orient: 180, type: 'Passive' },
           { num: '2', name: 'P2', x: 200, y: 0, len: 100, orient: 0, type: 'Passive' }],
    graphics: [{ g: 'polyline', pts: [[-100, 0], [-75, 40], [-25, -40], [25, 40], [75, -40], [100, 0]], w: 10 }] };
  const mine = { part: 1,
    pins: [{ num: 'A', name: 'ANODO', x: -100, y: 0, len: 100, orient: 180, type: 'Input' },
           { num: 'K', name: 'CATODO', x: 100, y: 0, len: 100, orient: 0, type: 'Output' }],
    graphics: [{ g: 'rect', x1: -50, y1: -50, x2: 50, y2: 50 }] };
  const r = P.applyLibSymbol(mine, lib);
  assert.strictEqual(r.part.part, 1);
  assert.deepStrictEqual(r.part.graphics, lib.graphics);
  assert.notStrictEqual(r.part.graphics, lib.graphics, 'cópia profunda');
  assert.deepStrictEqual(r.part.pins.map(p => [p.num, p.name, p.type, p.x]), [['A', 'ANODO', 'Input', -200], ['K', 'CATODO', 'Output', 200]], 'pinagem do usuário, geometria da biblioteca');
  assert.ok(/mantiveram/.test(r.note), r.note);
  assert.deepStrictEqual(mine.pins[0].x, -100, 'original intacto');
  assert.strictEqual(lib.pins[0].num, '1', 'biblioteca intacta');
  const r2 = P.applyLibSymbol({ pins: [mine.pins[0]], graphics: [] }, lib);
  assert.deepStrictEqual(r2.part.pins.map(p => p.num), ['1', '2'], 'contagem diferente: pinos da biblioteca');
  assert.ok(/1 pino/.test(r2.note) && /2/.test(r2.note), r2.note);
}

/* ── nextPinNum ── */
assert.strictEqual(P.nextPinNum([]), '1');
assert.strictEqual(P.nextPinNum([{ num: '1' }, { num: '3' }]), '4');
assert.strictEqual(P.nextPinNum([{ num: 'A1' }, { num: '2' }, { num: ' 7 ' }]), '8', 'A1 não conta; espaço em volta é tolerado');
assert.strictEqual(P.nextPinNum([{ num: 'K' }]), '1');

console.log('test-symed OK (snap, hitTest, moveItem, rotateAll, mirrorAll, serializeSymbol, applyLibSymbol, nextPinNum)');
