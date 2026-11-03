/* Não montar (DNP), 1.58.0: a marca do esquema (HubCore.ehDnp / dnpRefs / marcaDnp) e o BOM da bancada
   (HubBom.model) com ela. O componente marcado fica na placa e na lista, mas no grupo dele, no fim, e
   fora da conta dos montados. A marca antiga dos params (DNP=1, Montagem=NAO MONTAR, a que uma sessão de
   IA gravou no MIRBC) vale igual, e desmarcar a tira. */
const assert = require('assert');
const C = require('../hub-core.js');
const HubBom = require('../hub-bom.js');

let ok = 0;
const t = (nome, fn) => { fn(); ok++; };
const comp = (ref, o) => Object.assign({ t: 'comp', sheet: 'main', ref, sym: 'RES', x: 0, y: 0, rot: 0, footprint: 'R0805' }, o || {});

t('a marca: campo dnp e a dos params', () => {
  assert.ok(C.ehDnp(comp('R1', { dnp: true })));
  assert.ok(C.ehDnp(comp('J5', { params: 'Comment=x;Montagem=NAO MONTAR;DNP=1;BOM=NAO' })));
  assert.ok(C.ehDnp(comp('J6', { params: 'DNP=1' })));
  assert.ok(C.ehDnp(comp('J7', { params: 'Montagem=NÃO MONTAR' })));
  assert.ok(!C.ehDnp(comp('R2', { params: 'DNP=0' })));
  assert.ok(!C.ehDnp(comp('R3', { dnp: false })));
  assert.ok(!C.ehDnp(null));
});
t('dnpRefs: uma parte marcada basta', () => {
  const s = { items: [comp('U1', { part: 1 }), comp('U1', { part: 2, dnp: true }), comp('R1'), { t: 'wire', pts: [[0, 0], [1, 1]] }] };
  assert.deepStrictEqual([...C.dnpRefs(s)], ['U1']);
  assert.deepStrictEqual([...C.dnpRefs(null)], []);
});
t('marcaDnp marca todas as partes e diz quem mudou', () => {
  const s = { items: [comp('U1', { part: 1 }), comp('U1', { part: 2 }), comp('R1', { dnp: true })] };
  assert.deepStrictEqual(C.marcaDnp(s, ['U1', 'R1'], true), ['U1']);
  assert.ok(s.items[0].dnp && s.items[1].dnp);
});
t('desmarcar tira a marca dos params', () => {
  const s = { items: [comp('J5', { params: 'Comment=x;Montagem=NAO MONTAR;DNP=1;BOM=NAO' }), comp('J6', { params: 'DNP=1', dnp: true })] };
  assert.deepStrictEqual(C.marcaDnp(s, ['J5', 'J6'], false).sort(), ['J5', 'J6']);
  assert.strictEqual(s.items[0].params, 'Comment=x;BOM=NAO');
  assert.ok(!('params' in s.items[1]) && !('dnp' in s.items[1]));
  assert.strictEqual(C.dnpRefs(s).size, 0);
});
t('o esquema com dnp serializa', () => {
  const s = { format: 'schmirror-v2', project: 'X', units: 'mil', items: [{ t: 'sheet', name: 'main', size: 'A4' }, comp('R1', { dnp: true })] };
  const out = C.serializeSchematic(s);
  assert.ok(out.text && /"dnp":true/.test(out.text), JSON.stringify(out.errors));
});
t('BOM: o não montar fica no grupo dele, no fim, fora da conta', () => {
  const B = { board: { bbox: { x1: 0, y1: 0, x2: 20, y2: 20 }, outline: [] }, components: [
    { ref: 'R1', comment: '10k', footprint: 'R0805', layer: 'Top', x: 1, y: 1, rot: 0, pads: [] },
    { ref: 'R2', comment: '10k', footprint: 'R0805', layer: 'Top', x: 3, y: 1, rot: 0, pads: [], dnp: true },
    { ref: 'R3', comment: '10k', footprint: 'R0805', layer: 'Top', x: 5, y: 1, rot: 0, pads: [] },
  ] };
  const m = HubBom.model(B);
  assert.strictEqual(m.groups.length, 2);
  assert.deepStrictEqual(m.groups[0].refs.map(i => m.comps[i].ref), ['R1', 'R3']);
  assert.strictEqual(m.groups[0].qty, 2);
  assert.ok(m.groups[1].d && m.comps[m.groups[1].refs[0]].ref === 'R2');
  assert.notStrictEqual(m.groups[0].k, m.groups[1].k, 'o visto da bancada não confunde os dois');
  assert.strictEqual(m.stats.dnp, 1);
  assert.ok(/NÃO MONTAR/.test(HubBom.html(m, { proj: 'X' })), 'a página sabe marcar a linha');
});

console.log('test-dnp: ' + ok + ' ok');
