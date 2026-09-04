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
assert.strictEqual(P.pinSnapOf(25), 50, 'em 25 o pino vai para 50: o menor múltiplo de 10 que ainda é múltiplo do passo');
assert.strictEqual(P.pinSnapOf(50), 50);
assert.strictEqual(P.pinSnapOf(10), 10);
assert.strictEqual(P.pinSnapOf(5, 'mil'), 10);
assert.strictEqual(P.pinSnapOf(0, 'mil'), 100, 'sem passo vale 100');
assert.strictEqual(P.pinSnapOf(12.5, 'mil'), 100, 'passo fracionário em mil não existe: vale 100');

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
  assert.deepStrictEqual(p.pins[0], { num: '1', name: '', x: -100.4, y: 0.2, len: 100, orient: 180, type: 'Passive' }, 'pino com 3 casas, sem hideNum/hideName quando visível');
  assert.strictEqual(p.graphics.length, 4, 'bezier saiu');
  assert.deepStrictEqual(p.graphics[0], { g: 'rect', x1: -10, y1: -10, x2: 10, y2: 10, w: 10, solid: true });
  assert.deepStrictEqual(p.graphics[1], { g: 'arc', cx: 0, cy: 0, r: 50, sa: 0, ea: 360, w: 4 });
  assert.deepStrictEqual(p.graphics[2], { g: 'label', x: 0, y: 0, text: '12', rot: 0, size: 8 });
  assert.deepStrictEqual(p.graphics[3], { g: 'polyline', pts: [[1.235, 2]], w: 20 });
  /* tipos: tudo que o hub e o servidor esperam */
  const tresCasas = v => typeof v === 'number' && Math.round(v * 1000) / 1000 === v;
  for (const pin of p.pins) { assert.strictEqual(typeof pin.num, 'string'); assert.strictEqual(typeof pin.name, 'string'); assert.ok(tresCasas(pin.x) && tresCasas(pin.y) && tresCasas(pin.len)); assert.ok([0, 90, 180, 270].includes(pin.orient)); assert.ok(P.PIN_TYPES.includes(pin.type)); }
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

/* ── pino com 3 casas como qualquer coordenada (o gravador grava a fração); hideNum/hideName
   só saem quando escondidos ── */
{
  const p = P.cleanPin({ num: 1, x: 5, y: 3, len: 95, orient: 0 });
  assert.deepStrictEqual([p.x, p.y, p.len], [5, 3, 95], 'nada de arredondar a 10 mil');
  const q = P.cleanPin({ num: 1, x: 390.5515, y: 393.701, len: 100.0004, orient: 0 });
  assert.deepStrictEqual([q.x, q.y, q.len], [390.552, 393.701, 100], 'PinFrac do leitor fica, com 3 casas');
  assert.ok(!('hideNum' in q) && !('hideName' in q), 'visível = campo ausente');
  const h = P.cleanPin({ num: 1, x: 0, y: 0, len: 100, orient: 0, hideNum: true, hideName: false });
  assert.strictEqual(h.hideNum, true); assert.ok(!('hideName' in h), 'false não sai — só true');
  const h2 = P.cleanPin({ num: 1, x: 0, y: 0, len: 100, orient: 0, hideName: 1 });
  assert.strictEqual(h2.hideName, true);
  /* comprimento negativo invertia a ponta quente e ia como PinLength negativo para a SchLib */
  assert.strictEqual(P.cleanPin({ num: '1', x: 0, y: 0, len: -100, orient: 0, type: 'Passive' }).len, 100, 'len negativo vira positivo');
  assert.strictEqual(P.cleanPin({ num: '1', x: 0, y: 0, len: 0, orient: 0 }).len, 100, 'len zero volta ao padrão');
  assert.strictEqual(P.cleanPin({ num: '1', x: 0, y: 0, len: -118.11, orient: 0 }).len, 118.11);
}

/* ── comprimento padrão do pino na unidade: em mil 100; em mm o múltiplo do snap de pino mais
   perto de 2.54 mm — e a ponta quente do pino novo nasce dentro do snap ── */
{
  assert.strictEqual(P.pinLenDefault(100, 'mil'), 100);
  assert.strictEqual(P.pinLenDefault(25, 'mil'), 100);
  assert.strictEqual(P.pinLenDefault(P.MM, 'mm'), 118.11, 'snap 1 mm → 3 mm');
  assert.strictEqual(P.pinLenDefault(0.5 * P.MM, 'mm'), 98.425, 'snap 0.5 mm → 2.5 mm');
  assert.strictEqual(P.pinLenDefault(2.5 * P.MM, 'mm'), 98.425, 'snap 2.5 mm → 2.5 mm');
  assert.strictEqual(P.pinLenDefault(0.1 * P.MM, 'mm'), 98.425, 'snap 0.1 mm → 2.5 mm');
  for (const s of P.UNIT_SNAPS.mm) {
    const step = s * P.MM, len = P.pinLenDefault(step, 'mm');
    for (const orient of [0, 90, 180, 270]) {
      const pin = { num: '9', x: P.snap(5 * P.MM, step), y: P.snap(-3 * P.MM, step), len, orient };
      assert.deepStrictEqual(P.pinsOffGrid([pin], step), [], 'pino novo com snap ' + s + ' mm a ' + orient + '° nasce dentro do snap');
    }
  }
}

/* ── mover alinhado à grade: quem já estava na grade sai na grade (snap do resultado), quem
   estava fora anda r3(dx); sem passo é o de sempre ── */
{
  assert.strictEqual(P.alinhado(0, P.MM, P.MM), 39.37);
  assert.strictEqual(P.alinhado(1023.62, P.MM, P.MM), 1062.992, 'um valor ligeiramente fora (1023.62 vs 1023.622) volta à grade');
  assert.strictEqual(P.alinhado(200, P.MM, P.MM), 239.37, 'fora da grade de 1 mm: anda r3(dx)');
  assert.strictEqual(P.alinhado(200, P.MM, 0), 239.37, 'sem passo: r3(v + d)');
  const m = P.moveItem({ num: '1', x: 39.37, y: 0, len: 118.11, orient: 0 }, P.MM, 0, P.MM);
  assert.strictEqual(m.x, 78.74);
  const r = P.moveItem({ g: 'rect', x1: 0, y1: 0, x2: 78.74, y2: 39.37 }, 25 * P.MM, -25 * P.MM, P.MM);
  assert.deepStrictEqual([r.x1, r.y1, r.x2, r.y2], [984.252, -984.252, 1062.992, -944.882]);
}

/* ── 30 setas e 30 duplicações em mm sem deriva: x === r3(k·passo) e nenhum pino fora do snap
   (somar r3 em r3 perdia 0.00008 mil por passo e na 26ª seta o aviso amarelo acendia) ── */
{
  const S = M.state, A = M.actions;
  for (const s of [1, 0.1, 2.5]) {
    const step = s * P.MM, len = P.pinLenDefault(step, 'mm');
    S.draft = { name: 'D', parts: [{ part: 1, pins: [{ num: '1', name: '', x: 0, y: 0, len, orient: 0, type: 'Passive' }],
                                               graphics: [{ g: 'rect', x1: 0, y1: 0, x2: P.snap(2 * P.MM, step), y2: P.snap(P.MM, step), solid: false }] }] };
    S.part = 1; S.undo = []; S.redo = []; S.unit = 'mm'; S.snap = step;
    S.selection = [{ kind: 'pin', idx: 0 }, { kind: 'g', idx: 0 }];
    for (let k = 1; k <= 30; k++) {
      A.nudge(1, 0);
      const p = S.draft.parts[0];
      assert.strictEqual(p.pins[0].x, Math.round(k * step * 1000) / 1000, 'seta ' + k + ' (snap ' + s + ' mm): pino em r3(k·passo)');
      assert.strictEqual(p.graphics[0].x1, Math.round(k * step * 1000) / 1000, 'seta ' + k + ': retângulo em r3(k·passo)');
      assert.deepStrictEqual(P.pinsOffGrid(p.pins, step), [], 'seta ' + k + ': ponta quente dentro do snap');
    }
    for (let k = 0; k < 30; k++) A.undo();
    assert.strictEqual(S.draft.parts[0].pins[0].x, 0, 'desfez as 30 setas');
    S.selection = [{ kind: 'pin', idx: 0 }, { kind: 'g', idx: 0 }];
    for (let k = 1; k <= 30; k++) {
      A.duplicarSelecao();
      const p = S.draft.parts[0], pin = p.pins[p.pins.length - 1], g = p.graphics[p.graphics.length - 1];
      assert.strictEqual(pin.x, Math.round(k * step * 1000) / 1000, 'duplicação ' + k + ' (snap ' + s + ' mm): x = r3(k·passo)');
      assert.strictEqual(pin.y, -Math.round(k * step * 1000) / 1000, 'duplicação ' + k + ': y = -r3(k·passo)');
      assert.strictEqual(g.x1, Math.round(k * step * 1000) / 1000);
      assert.deepStrictEqual(P.pinsOffGrid(p.pins, step), [], 'duplicação ' + k + ': nenhum pino fora do snap');
      assert.deepStrictEqual(S.selection, [{ kind: 'pin', idx: k }, { kind: 'g', idx: k }], 'a cópia vira a seleção');
    }
    assert.strictEqual(S.draft.parts[0].pins.length, 31);
  }
  S.draft = null; S.selection = []; S.undo = []; S.redo = []; S.dirty = false; S.unit = 'mm'; S.snap = P.MM;
}

/* ── Preencher: arco completo vira elipse sólida, polilinha vira polígono; desmarcar só apaga
   o solid; quem não fecha área não tem o que preencher ── */
{
  const e = P.setFill({ g: 'arc', cx: 10, cy: 20, r: 50, sa: 0, ea: 360, w: 10, color: '#112233' }, true);
  assert.deepStrictEqual(e, { g: 'ellipse', cx: 10, cy: 20, rx: 50, ry: 50, solid: true, w: 10, color: '#112233' }, 'círculo → elipse sólida, w e cor vão junto');
  assert.strictEqual(P.setFill({ g: 'arc', cx: 0, cy: 0, r: 50, sa: 0, ea: 90, w: 10 }, true), null, 'arco parcial não vira nada');
  assert.strictEqual(P.setFill({ g: 'arc', cx: 0, cy: 0, r: 50, sa: 0, ea: 360, w: 10 }, false), null, 'desmarcar um círculo vazio: nada a fazer');
  const pg = P.setFill({ g: 'polyline', pts: [[0, 0], [10, 0], [0, 10]], w: 20 }, true);
  assert.deepStrictEqual(pg, { g: 'poly', pts: [[0, 0], [10, 0], [0, 10]], solid: true, w: 20 }, 'polilinha → polígono fechado sólido');
  const pv = P.setFill(pg, false);
  assert.deepStrictEqual(pv, { g: 'poly', pts: [[0, 0], [10, 0], [0, 10]], solid: false, w: 20 }, 'desmarcar num polígono: continua polígono, vazado');
  const el = P.setFill(e, false);
  assert.strictEqual(el.g, 'ellipse'); assert.strictEqual(el.solid, false);
  const rc = P.setFill({ g: 'rect', x1: 0, y1: 0, x2: 1, y2: 1, solid: false, fill: '#ffffb0' }, true);
  assert.strictEqual(rc.solid, true); assert.strictEqual(rc.fill, '#ffffb0', 'a cor de área fica');
  assert.strictEqual(P.setFill({ g: 'line', x1: 0, y1: 0, x2: 1, y2: 1, w: 10 }, true), null);
  assert.strictEqual(P.setFill({ g: 'label', x: 0, y: 0, text: 'x' }, true), null);
  assert.strictEqual(P.setFill({ num: '1', x: 0, y: 0, len: 100, orient: 0 }, true), null, 'pino não tem preenchimento');
  assert.strictEqual(P.fillable({ g: 'rect' }).ok, true);
  assert.strictEqual(P.fillable({ g: 'arc', sa: 0, ea: 360 }).ok, true);
  assert.strictEqual(P.fillable({ g: 'arc', sa: 90, ea: 450 }).ok, true, 'volta inteira por qualquer ângulo');
  assert.ok(!P.fillable({ g: 'arc', sa: 0, ea: 90 }).ok && /parcial/.test(P.fillable({ g: 'arc', sa: 0, ea: 90 }).why));
  assert.ok(!P.fillable({ g: 'line' }).ok && !P.fillable({ g: 'label' }).ok && !P.fillable(null).ok && !P.fillable({ num: '1' }).ok);
  /* o conversor não mexe no original */
  const orig = { g: 'arc', cx: 0, cy: 0, r: 5, sa: 0, ea: 360, w: 10 };
  P.setFill(orig, true); assert.strictEqual(orig.g, 'arc');
}

/* ── cores: color/fill saem só quando são "#rrggbb" (maiúscula vira minúscula); o resto cai ── */
{
  assert.ok(P.corValida('#ff0000') && P.corValida('#00008b') && !P.corValida('#FF0000') && !P.corValida('red') && !P.corValida('#fff') && !P.corValida('#ggg000') && !P.corValida(null) && !P.corValida(16711680));
  const r = P.cleanGraphic({ g: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, solid: true, color: '#FF0000', fill: '#ffffb0' });
  assert.deepStrictEqual(r, { g: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, solid: true, color: '#ff0000', fill: '#ffffb0' }, 'maiúscula vira minúscula');
  const bad = P.cleanGraphic({ g: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, solid: true, color: 'red', fill: '#fff' });
  assert.ok(!('color' in bad) && !('fill' in bad), 'cor inválida cai: ' + JSON.stringify(bad));
  const num = P.cleanGraphic({ g: 'line', x1: 0, y1: 0, x2: 1, y2: 1, w: 10, color: 16711680 });
  assert.ok(!('color' in num), 'TColor inteiro não é cor do hub');
  assert.strictEqual(P.cleanGraphic({ g: 'line', x1: 0, y1: 0, x2: 1, y2: 1, w: 10, color: '#0000ff', fill: '#ffffff' }).color, '#0000ff');
  assert.ok(!('fill' in P.cleanGraphic({ g: 'line', x1: 0, y1: 0, x2: 1, y2: 1, w: 10, color: '#0000ff', fill: '#ffffff' })), 'linha não tem área: fill não sai');
  assert.ok(!('fill' in P.cleanGraphic({ g: 'arc', cx: 0, cy: 0, r: 1, w: 10, fill: '#ffffff' })));
  assert.ok(!('fill' in P.cleanGraphic({ g: 'polyline', pts: [], w: 10, fill: '#ffffff' })));
  assert.strictEqual(P.cleanGraphic({ g: 'label', x: 0, y: 0, text: 'a', color: '#800000' }).color, '#800000');
  assert.strictEqual(P.cleanGraphic({ g: 'ellipse', cx: 0, cy: 0, rx: 1, ry: 1, fill: '#ABCDEF' }).fill, '#abcdef');
  assert.strictEqual(P.cleanGraphic({ g: 'poly', pts: [], solid: true, color: ' #123456 ' }).color, '#123456', 'espaço em volta é tolerado');
  const out = P.serializeSymbol({ name: 'C', parts: [{ part: 1, pins: [], graphics: [
    { g: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, solid: true, color: '#ff0000', fill: '#00ff00' },
    { g: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, solid: true, color: 'vermelho', fill: '' },
    { g: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, solid: true } ] }] });
  assert.deepStrictEqual(out.parts[0].graphics.map(g => [g.color, g.fill]), [['#ff0000', '#00ff00'], [undefined, undefined], [undefined, undefined]]);
  assert.ok(!('color' in out.parts[0].graphics[2]) && !('fill' in out.parts[0].graphics[2]), 'sem cor = campo ausente, não undefined');
  /* girar/espelhar/mover levam a cor junto */
  const part = { pins: [], graphics: [{ g: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, solid: true, color: '#ff0000', fill: '#00ff00' }] };
  assert.strictEqual(P.rotateAll(part).graphics[0].fill, '#00ff00');
  assert.strictEqual(P.mirrorAll(part).graphics[0].color, '#ff0000');
  assert.strictEqual(P.moveItem(part.graphics[0], 1, 1).color, '#ff0000');
  assert.strictEqual(typeof P.PIN_MARK, 'number'); assert.ok(P.PIN_MARK >= 14 && P.PIN_MARK <= 16, 'marca do pino com 14–16 mil de lado');
}

/* ── mm ↔ mil sem perda em 3 casas: mm de 3 casas vai a mil (3 casas) e volta igual; mil
   múltiplo do passo de 1 mm volta ao mesmo mil ── */
{
  assert.strictEqual(P.MM, 39.37007874);
  assert.strictEqual(P.mm2mil(1), 39.37);
  assert.strictEqual(P.mm2mil(3), 118.11);
  assert.strictEqual(P.fmtUnit(118.11, 'mm'), '3.00', '2 casas quando a terceira é zero');
  assert.strictEqual(P.fmtUnit(P.mm2mil(1.234), 'mm'), '1.234', '3 casas quando a terceira não é zero');
  assert.strictEqual(P.fmtUnit(-100, 'mm'), '-2.54');
  assert.strictEqual(P.fmtUnit(48.583, 'mil'), '48.583');
  assert.strictEqual(P.fmtUnit(100, 'mil'), '100', 'mil sem zeros à direita');
  assert.strictEqual(P.toMil('3', 'mm'), 118.11);
  assert.strictEqual(P.toMil('118.1104', 'mil'), 118.11);
  assert.strictEqual(P.toMil('x', 'mm'), 0, 'lixo vira 0, não NaN');
  for (let i = 0; i <= 2000; i++) {
    const mm = Math.round((i * 0.007 - 5) * 1000) / 1000;          /* -5.000 … 9.000 em passos de 7 µm */
    const volta = Number(P.fmtUnit(P.mm2mil(mm), 'mm'));
    assert.strictEqual(volta, mm, 'mm ' + mm + ' → mil ' + P.mm2mil(mm) + ' → ' + volta);
  }
  for (let k = -50; k <= 50; k++) {
    const mil = P.snap(k * P.MM + 0.3, P.MM);
    assert.strictEqual(P.toMil(P.fmtUnit(mil, 'mm'), 'mm'), mil, 'mil ' + mil + ' passa pelo mm e volta');
  }
  assert.deepStrictEqual(P.UNIT_SNAPS, { mm: [0.1, 0.5, 1, 2.5], mil: [10, 25, 50, 100] });
  assert.strictEqual(P.UNIT_DEFAULT.mil, 100); assert.strictEqual(P.UNIT_DEFAULT.mm, P.MM);
  assert.strictEqual(P.snapMil(2.5, 'mm'), 2.5 * P.MM); assert.strictEqual(P.snapMil(25, 'mil'), 25);
}

/* ── snap em mm: o passo é fracionário em mil e o resultado sai com 3 casas ── */
{
  assert.strictEqual(P.snap(100, P.MM), 118.11, '100 mil cai em 3 mm');
  assert.strictEqual(P.snap(-20, P.MM), -39.37);
  assert.strictEqual(P.snap(58, P.MM), 39.37, '58 mil = 1.47 mm → 1 mm');
  assert.strictEqual(P.snap(60, P.MM), 78.74, '60 mil = 1.52 mm → 2 mm');
  assert.strictEqual(P.snap(7, 0.5 * P.MM), 0);
  assert.strictEqual(P.pinSnapOf(P.MM, 'mm'), P.MM, 'em mm o pino usa o snap escolhido');
  assert.strictEqual(P.pinSnapOf(0.1 * P.MM, 'mm'), 0.1 * P.MM);
  assert.strictEqual(P.pinSnapOf(25, 'mil'), 50, 'em mil continua preferindo múltiplos de 10 — o mmc com o passo');
  assert.strictEqual(P.pinSnapOf(50, 'mil'), 50);
  /* aviso relativo ao snap: os pinos do RES [SMD] (ponta quente em 150 e -250 mil) caem
     fora do snap de 1 mm, mas dentro do de 50 mil; um pino em 3 mm com 3 mm de comprimento está dentro */
  const res = [{ num: '2', x: 50, y: 0, len: 100, orient: 0 }, { num: '1', x: -150, y: 0, len: 100, orient: 180 }];
  assert.deepStrictEqual(P.pinsOffGrid(res, P.MM).map(p => p.num), ['2', '1']);
  assert.deepStrictEqual(P.pinsOffGrid(res, 50).map(p => p.num), []);
  assert.deepStrictEqual(P.pinsOffGrid(res, 100).map(p => p.num), ['2', '1'], 'sem passo vale 100 (o de sempre)');
  assert.deepStrictEqual(P.pinsOffGrid([{ num: '9', x: 118.11, y: -78.74, len: 118.11, orient: 0 }], P.MM), [], 'ponta quente em 6 mm: dentro');
  assert.deepStrictEqual(P.pinsOffGrid([{ num: '9', x: 118.11, y: 0, len: 100, orient: 90 }], P.MM).map(p => p.num), ['9'], 'len de 100 mil tira do snap de 1 mm');
}

/* ── linha → pino e pino → linha ── */
{
  const base = { pins: [{ num: '1', name: '', x: -100, y: 0, len: 100, orient: 180, type: 'Passive' }],
                 graphics: [{ g: 'rect', x1: -100, y1: -40, x2: 100, y2: 40, solid: false }, { g: 'line', x1: 100, y1: 0, x2: 300, y2: 0, w: 10 }] };
  const r = P.lineToPin(base, 1);
  assert.deepStrictEqual(r.part.graphics, [base.graphics[0]], 'a linha saiu dos gráficos');
  assert.deepStrictEqual(r.part.pins[1], { num: '2', name: '', x: 100, y: 0, len: 200, orient: 0, type: 'Passive' }, 'corpo no extremo perto do retângulo, ponta quente para fora');
  assert.deepStrictEqual(r.selection, [{ kind: 'pin', idx: 1 }]);
  assert.strictEqual(r.aviso, '');
  assert.strictEqual(base.graphics.length, 2, 'original intacto');
  /* a mesma linha desenhada ao contrário dá o mesmo pino */
  const inv = { pins: base.pins, graphics: [base.graphics[0], { g: 'line', x1: 300, y1: 0, x2: 100, y2: 0, w: 10 }] };
  assert.deepStrictEqual(P.lineToPin(inv, 1).part.pins[1], r.part.pins[1]);
  /* vertical para baixo: orient 270 */
  const v = P.lineToPin({ pins: [], graphics: [base.graphics[0], { g: 'line', x1: 0, y1: -40, x2: 0, y2: -240, w: 10 }] }, 1);
  assert.deepStrictEqual([v.part.pins[0].x, v.part.pins[0].y, v.part.pins[0].len, v.part.pins[0].orient, v.part.pins[0].num], [0, -40, 200, 270, '1']);
  /* para a esquerda: 180 */
  const e = P.lineToPin({ pins: [], graphics: [base.graphics[0], { g: 'line', x1: -300, y1: 0, x2: -100, y2: 0, w: 10 }] }, 1);
  assert.deepStrictEqual([e.part.pins[0].x, e.part.pins[0].len, e.part.pins[0].orient], [-100, 200, 180]);
  /* sem mais gráficos o centro é a origem */
  const so = P.lineToPin({ pins: [], graphics: [{ g: 'line', x1: 50, y1: 0, x2: 250, y2: 0, w: 10 }] }, 0);
  assert.deepStrictEqual([so.part.pins[0].x, so.part.pins[0].orient, so.part.graphics.length], [50, 0, 0]);
  /* não axial: eixo dominante, len = componente, aviso */
  const na = P.lineToPin({ pins: [], graphics: [base.graphics[0], { g: 'line', x1: 100, y1: 0, x2: 300, y2: 50, w: 10 }] }, 1);
  assert.deepStrictEqual([na.part.pins[0].x, na.part.pins[0].y, na.part.pins[0].len, na.part.pins[0].orient], [100, 0, 200, 0]);
  assert.ok(/não era axial/.test(na.aviso), na.aviso);
  /* polilinha de 2 pontos serve; de 3 não; retângulo não; linha sem comprimento não */
  const pl = P.lineToPin({ pins: [], graphics: [base.graphics[0], { g: 'polyline', pts: [[100, 0], [300, 0]], w: 10 }] }, 1);
  assert.deepStrictEqual([pl.part.pins[0].x, pl.part.pins[0].len, pl.part.pins[0].orient], [100, 200, 0]);
  assert.strictEqual(P.lineToPin({ pins: [], graphics: [{ g: 'polyline', pts: [[0, 0], [1, 0], [2, 2]], w: 10 }] }, 0), null);
  assert.strictEqual(P.lineToPin(base, 0), null);
  assert.strictEqual(P.lineToPin({ pins: [], graphics: [{ g: 'line', x1: 5, y1: 5, x2: 5, y2: 5, w: 10 }] }, 0), null);
  assert.strictEqual(P.lineToPin(base, 7), null);
  /* pino → linha do corpo à ponta quente, w 10, e o pino some */
  const l = P.pinToLine(base, 0);
  assert.deepStrictEqual(l.part.pins, []);
  assert.deepStrictEqual(l.part.graphics[2], { g: 'line', x1: -100, y1: 0, x2: -200, y2: 0, w: 10 });
  assert.deepStrictEqual(l.selection, [{ kind: 'g', idx: 2 }]);
  assert.strictEqual(base.pins.length, 1, 'original intacto');
  /* ida e volta: o pino que virou linha volta a ser o mesmo pino (o número é o próximo livre) */
  const rt = P.lineToPin(l.part, 2);
  assert.deepStrictEqual([rt.part.pins[0].x, rt.part.pins[0].y, rt.part.pins[0].len, rt.part.pins[0].orient], [-100, 0, 100, 180]);
  assert.strictEqual(P.pinToLine(base, 3), null);
  assert.strictEqual(P.viravel(base.pins[0]), 'linha');
  assert.strictEqual(P.viravel(base.graphics[1]), 'pino');
  assert.strictEqual(P.viravel({ g: 'polyline', pts: [[0, 0], [1, 1]] }), 'pino');
  assert.strictEqual(P.viravel(base.graphics[0]), null);
  assert.strictEqual(P.viravel(null), null);
}

/* ── inserir um símbolo da biblioteca: tudo deslocado para o ponto, tudo selecionado, pino
   com número já usado ganha o próximo livre em sequência ── */
{
  const lib = { id: 's1', name: 'Resistor',
    pins: [{ num: '1', name: '1', x: -100, y: 0, len: 100, orient: 180, type: 'Passive' }, { num: '2', name: '2', x: 100, y: 0, len: 100, orient: 0, type: 'Passive' }],
    graphics: [{ g: 'rect', x1: -100, y1: -40, x2: 100, y2: 40, solid: false }] };
  const res = { pins: [{ num: '2', name: '2', x: 50, y: 0, len: 100, orient: 0, type: 'Passive' }, { num: '1', name: '1', x: -150, y: 0, len: 100, orient: 180, type: 'Passive' }],
                graphics: [{ g: 'rect', x1: -150, y1: -40, x2: 50, y2: 40, solid: false }] };
  const r = P.insertLibSymbol(res, lib, 500, -200);
  assert.strictEqual(r.part.pins.length, 4); assert.strictEqual(r.part.graphics.length, 2);
  assert.deepStrictEqual(r.part.pins.slice(2).map(p => [p.num, p.x, p.y]), [['3', 400, -200], ['4', 600, -200]], 'renumerados 3 e 4, deslocados');
  assert.deepStrictEqual(r.part.graphics[1], { g: 'rect', x1: 400, y1: -240, x2: 600, y2: -160, solid: false });
  assert.deepStrictEqual(r.selection, [{ kind: 'pin', idx: 2 }, { kind: 'pin', idx: 3 }, { kind: 'g', idx: 1 }]);
  assert.deepStrictEqual(r.renumerados, [['1', '3'], ['2', '4']]);
  assert.deepStrictEqual(r.novos, ['3', '4']);
  assert.deepStrictEqual(r.part.pins.slice(0, 2), res.pins, 'os pinos que já estavam ficam');
  assert.strictEqual(res.pins.length, 2, 'original intacto'); assert.strictEqual(lib.pins[0].num, '1', 'biblioteca intacta');
  /* só um número colide: só ele muda, e para o próximo livre depois do maior */
  const r2 = P.insertLibSymbol({ pins: [{ num: '2', x: 0, y: 0, len: 100, orient: 0 }, { num: '7', x: 0, y: 0, len: 100, orient: 0 }], graphics: [] }, lib, 0, 0);
  assert.deepStrictEqual(r2.part.pins.slice(2).map(p => p.num), ['1', '8']);
  assert.deepStrictEqual(r2.renumerados, [['2', '8']]);
  /* parte vazia: nada renumera e a origem cai no ponto */
  const r3 = P.insertLibSymbol({ pins: [], graphics: [] }, lib, 39.37, 0);
  assert.deepStrictEqual(r3.renumerados, []); assert.deepStrictEqual(r3.novos, ['1', '2']);
  assert.deepStrictEqual([r3.part.pins[0].x, r3.part.graphics[0].x1], [-60.63, -60.63]);
  assert.deepStrictEqual(r3.selection, [{ kind: 'pin', idx: 0 }, { kind: 'pin', idx: 1 }, { kind: 'g', idx: 0 }]);
}

/* ── applyLibSymbol leva a visibilidade do pino junto com número/nome ── */
{
  const lib = { name: 'X', pins: [{ num: '1', name: 'a', x: 0, y: 0, len: 100, orient: 0, hideName: true }], graphics: [] };
  const r = P.applyLibSymbol({ pins: [{ num: '9', name: 'Z', x: 5, y: 5, len: 50, orient: 90, hideNum: true }], graphics: [] }, lib);
  assert.deepStrictEqual(r.part.pins[0], { num: '9', name: 'Z', x: 0, y: 0, len: 100, orient: 0, hideNum: true }, 'hideNum do usuário fica, hideName da biblioteca sai');
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

/* ── seleção múltipla: caixa de cada item e quem cai na caixa de seleção ── */
{
  assert.deepStrictEqual(P.itemBBox(part.pins[0]), { x1: -200, y1: 0, x2: -100, y2: 0 }, 'pino: do corpo à ponta quente');
  assert.deepStrictEqual(P.itemBBox(part.graphics[0]), { x1: -100, y1: -40, x2: 100, y2: 40 });
  const a = P.itemBBox(part.graphics[2]);   /* arco 0–90 em (0,-300) r100: só o quadrante */
  assert.ok(Math.abs(a.x1 - 0) < 1e-6 && Math.abs(a.x2 - 100) < 1e-6 && Math.abs(a.y1 + 300) < 1e-6 && Math.abs(a.y2 + 200) < 1e-6, JSON.stringify(a));
  const c = P.itemBBox({ g: 'arc', cx: 10, cy: 10, r: 5, sa: 0, ea: 360 });
  assert.deepStrictEqual([c.x1, c.y1, c.x2, c.y2].map(Math.round), [5, 5, 15, 15], 'círculo inteiro: cx±r');
  assert.deepStrictEqual(P.itemBBox(part.graphics[4]), { x1: -500, y1: -500, x2: -400, y2: -400 });
  /* esquerda→direita só pega quem cabe inteiro: o retângulo; os pinos vazam */
  assert.deepStrictEqual(P.itemsInBox(part, { x1: -150, y1: 50, x2: 150, y2: -50 }, true), [{ kind: 'g', idx: 0 }]);
  /* direita→esquerda pega quem encosta: os dois pinos e o retângulo */
  assert.deepStrictEqual(P.itemsInBox(part, { x1: 150, y1: 50, x2: -150, y2: -50 }, false),
    [{ kind: 'pin', idx: 0 }, { kind: 'pin', idx: 1 }, { kind: 'g', idx: 0 }]);
  assert.deepStrictEqual(P.itemsInBox(part, { x1: -50, y1: 190, x2: 50, y2: 210 }, false), [{ kind: 'g', idx: 1 }], 'a linha só por encostar');
  assert.deepStrictEqual(P.itemsInBox(part, { x1: -50, y1: 190, x2: 50, y2: 210 }, true), [], 'a linha inteira não cabe');
  assert.deepStrictEqual(P.itemsInBox(part, { x1: 900, y1: 900, x2: 1000, y2: 1000 }, false), [], 'longe de tudo');
}

/* ── mover vários: só quem está na seleção anda; pino com o passo dele ── */
{
  const sel = [{ kind: 'pin', idx: 0 }, { kind: 'g', idx: 0 }, { kind: 'g', idx: 4 }];
  const m = P.moveItems(part, sel, 25, -25, 100, -100);
  assert.deepStrictEqual([m.pins[0].x, m.pins[0].y], [0, -100], 'pino andou o passo de pino');
  assert.deepStrictEqual([m.pins[1].x, m.pins[1].y], [100, 0], 'pino fora da seleção ficou');
  assert.deepStrictEqual([m.graphics[0].x1, m.graphics[0].y1], [-75, -65]);
  assert.deepStrictEqual(m.graphics[4].pts[0], [-475, -525]);
  assert.deepStrictEqual(m.graphics[1], part.graphics[1], 'linha fora da seleção ficou');
  assert.strictEqual(part.pins[0].x, -100, 'original intacto');
  const m2 = P.moveItems(part, sel, 10, 10);
  assert.deepStrictEqual([m2.pins[0].x, m2.pins[0].y], [-90, 10], 'sem passo de pino, vale o mesmo delta');
}

/* ── apagar e duplicar: índices de quem fica não mudam; cópia vira a nova seleção ── */
{
  const d = P.deleteItems(part, [{ kind: 'pin', idx: 0 }, { kind: 'g', idx: 1 }, { kind: 'g', idx: 3 }]);
  assert.deepStrictEqual(d.pins.map(p => p.num), ['2']);
  assert.deepStrictEqual(d.graphics.map(g => g.g), ['rect', 'arc', 'polyline']);
  assert.strictEqual(part.pins.length, 2, 'original intacto');
  const r = P.duplicateItems(part, [{ kind: 'pin', idx: 0 }, { kind: 'g', idx: 0 }], 100, -100, 100, -100);
  assert.strictEqual(r.part.pins.length, 3); assert.strictEqual(r.part.graphics.length, 6);
  assert.deepStrictEqual(r.selection, [{ kind: 'pin', idx: 2 }, { kind: 'g', idx: 5 }], 'a seleção passa a ser as cópias');
  assert.deepStrictEqual([r.part.pins[2].x, r.part.pins[2].y, r.part.pins[2].num], [0, -100, '3'], 'pino copiado ganha número livre');
  assert.deepStrictEqual([r.part.graphics[5].x1, r.part.graphics[5].y1], [0, -140]);
  assert.deepStrictEqual(r.part.graphics[0], part.graphics[0], 'o original fica onde estava');
}

/* ── a seleção sobrevive a apagar e desfazer (as ações rodam sem DOM) ── */
{
  const S = M.state, A = M.actions;
  const clone = o => JSON.parse(JSON.stringify(o));
  S.draft = { name: 'T', parts: [Object.assign({ part: 1 }, clone(part))] }; S.part = 1; S.undo = []; S.redo = [];
  S.selection = [{ kind: 'pin', idx: 0 }, { kind: 'g', idx: 1 }];
  const antes = clone(S.draft.parts[0]);
  A.deleteSelection();
  assert.strictEqual(S.draft.parts[0].pins.length, 1); assert.strictEqual(S.draft.parts[0].graphics.length, 4);
  assert.deepStrictEqual(S.selection, [], 'apagou: nada marcado');
  assert.strictEqual(M.dirty(), true);
  A.undo();
  assert.deepStrictEqual(S.draft.parts[0], antes, 'desfazer devolve a geometria');
  assert.deepStrictEqual(S.selection, [{ kind: 'pin', idx: 0 }, { kind: 'g', idx: 1 }], 'e devolve a seleção');
  A.redo();
  assert.strictEqual(S.draft.parts[0].pins.length, 1);
  assert.deepStrictEqual(S.selection, [], 'refazer volta ao estado apagado');
  A.undo();
  /* duplicar: seleção passa às cópias; desfazer volta à seleção de antes */
  A.duplicarSelecao();
  assert.strictEqual(S.draft.parts[0].pins.length, 3); assert.strictEqual(S.draft.parts[0].graphics.length, 6);
  assert.deepStrictEqual(S.selection, [{ kind: 'pin', idx: 2 }, { kind: 'g', idx: 5 }]);
  A.undo();
  assert.deepStrictEqual(S.draft.parts[0], antes);
  assert.deepStrictEqual(S.selection, [{ kind: 'pin', idx: 0 }, { kind: 'g', idx: 1 }]);
  /* empurrar com as setas: um passo de snap (100) para os dois, pino inclusive */
  S.unit = 'mil'; S.snap = 100; A.nudge(1, 0);
  assert.strictEqual(S.draft.parts[0].pins[0].x, 0); assert.strictEqual(S.draft.parts[0].graphics[1].x1, -200);
  assert.strictEqual(S.draft.parts[0].pins[1].x, 100, 'quem não estava marcado não andou');
  A.undo();
  assert.deepStrictEqual(S.draft.parts[0], antes);
  /* em mm, snap de 1 mm: a seta anda 39.37 mil (3 casas) — o pino também */
  S.unit = 'mm'; S.snap = P.MM; A.nudge(0, 1);
  assert.strictEqual(S.draft.parts[0].pins[0].y, 39.37); assert.strictEqual(S.draft.parts[0].graphics[1].y1, 239.37);
  A.undo();
  assert.deepStrictEqual(S.draft.parts[0], antes);
  /* K pela ação: a linha (índice 1) vira pino e volta a linha; o undo desfaz os dois */
  S.selection = [{ kind: 'g', idx: 1 }]; A.virar();
  assert.strictEqual(S.draft.parts[0].graphics.length, 4); assert.strictEqual(S.draft.parts[0].pins.length, 3);
  assert.deepStrictEqual(S.selection, [{ kind: 'pin', idx: 2 }]);
  const novo = S.draft.parts[0].pins[2];
  assert.deepStrictEqual([novo.num, novo.len, novo.type], ['3', 600, 'Passive'], 'a linha de 600 mil virou pino 3');
  A.virar();
  assert.strictEqual(S.draft.parts[0].pins.length, 2); assert.strictEqual(S.draft.parts[0].graphics.length, 5);
  assert.deepStrictEqual(S.selection, [{ kind: 'g', idx: 4 }]);
  A.undo(); A.undo();
  assert.deepStrictEqual(S.draft.parts[0], antes);
  S.selection = [{ kind: 'g', idx: 0 }]; A.virar();
  assert.deepStrictEqual(S.draft.parts[0], antes, 'retângulo não vira nada');
  S.unit = 'mm'; S.snap = P.MM;
  /* seleção apontando para item que já não existe cai fora ao restaurar */
  S.selection = [{ kind: 'g', idx: 99 }]; A.pushUndo(); A.undo();
  assert.deepStrictEqual(S.selection, []);
  S.draft = null; S.selection = []; S.undo = []; S.redo = []; S.dirty = false;
}

/* ── os modais existem como função (o navegador prova o resto) ── */
assert.strictEqual(typeof M.confirmar, 'function');
assert.strictEqual(typeof M.pedirTexto, 'function');
assert.strictEqual(M.cam(), null, 'sem canvas não há câmera');

console.log('test-symed OK (snap, hitTest, moveItem, rotateAll, mirrorAll, serializeSymbol, applyLibSymbol, nextPinNum, itemsInBox, moveItems, duplicateItems, seleção × apagar/desfazer, mm↔mil, snap em mm, linha↔pino, insertLibSymbol, pinSnapOf mmc, len do pino, 30 setas/duplicações sem deriva, Preencher, cores)');
