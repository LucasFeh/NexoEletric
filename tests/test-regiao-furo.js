/* region_add com furo (holes): a letra "o", "e", "D" na serigrafia sai numa region so, sem picar em
   pedacos. O motor aceita o furo valido e recusa o que sai da region, encosta noutro, tem menos de 3
   vertices ou vem num recorte; a placa efetiva leva os furos; o Gerber desenha a region escura e o furo
   claro (LPC); o serializeChanges grava numa linha so e o parser de linha do ApplyChanges (ParsePts e
   ParseFuros, copiados aqui em JS) separa o contorno dos furos. */
const assert = require('assert');
const C = require('../hub-core.js');
const G = require('../hub-gerber.js');
const GV = require('../hub-gerberview.js');

let ok = 0;
const t = (nome, fn) => { try { fn(); ok++; } catch (e) { e.message = nome + ': ' + e.message; throw e; } };
const quad = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const placa = () => ({
  exporter: 'teste', nets: [{ name: 'GND' }], components: [], freepads: [], tracks: [], arcs: [], vias: [], fills: [],
  regions: [], cutouts: [], texts: [], silk: [], lines: [],
  board: { bbox: { x1: 0, y1: 0, x2: 50, y2: 50 }, outline: [
    { kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 }, { kind: 'line', x1: 50, y1: 0, x2: 50, y2: 50 },
    { kind: 'line', x1: 50, y1: 50, x2: 0, y2: 50 }, { kind: 'line', x1: 0, y1: 50, x2: 0, y2: 0 }] },
});
/* um "o" quadrado: 10 x 10 com um furo 4 x 4 no meio */
const letraO = (extra) => Object.assign({ op: 'region_add', layer: 'TopOverlay', pts: quad(10, 10, 10), holes: [quad(13, 13, 4)] }, extra || {});
const erros = m => m.validation.filter(v => v.level === 'err').map(v => v.msg);
const aplica = (chs) => { const B = placa(); const m = C.applyPcbChanges(B, chs); return { B, m, eb: C.effectiveBoard(B, m) }; };

t('furo valido entra e a placa efetiva o leva', () => {
  const { m, eb } = aplica([letraO()]);
  assert.deepStrictEqual(erros(m), []);
  const g = eb.regions.find(r => r.layer === 'TopOverlay');
  assert.ok(g, 'region na placa efetiva');
  assert.deepStrictEqual(g.holes, [quad(13, 13, 4)]);
  assert.strictEqual(g.net, undefined, 'serigrafia sem net');
});
t('o eff e a placa efetiva nao dividem array com a linha do changes', () => {
  const ch = letraO(), { m, eb } = aplica([ch]);
  const e = m.added[0].eff;
  assert.notStrictEqual(e.holes, ch.holes);
  assert.notStrictEqual(e.holes[0], ch.holes[0]);
  e.holes[0][0][0] = 99;
  assert.strictEqual(ch.holes[0][0][0], 13);
  assert.notStrictEqual(eb.regions[0].holes, e.holes);
});
t('dois furos (o "B") e furo no cobre com net', () => {
  const { m, eb } = aplica([{ op: 'region_add', layer: 'Top', net: 'GND', pts: quad(0, 0, 20), holes: [quad(2, 2, 5), quad(10, 10, 5)] }]);
  assert.deepStrictEqual(erros(m), []);
  assert.strictEqual(eb.regions[0].holes.length, 2);
  assert.strictEqual(eb.regions[0].net, 'GND');
});
t('holes vazio e o mesmo que sem furo', () => {
  const { m, eb } = aplica([letraO({ holes: [] })]);
  assert.deepStrictEqual(erros(m), []);
  assert.strictEqual(eb.regions[0].holes, undefined);
  assert.strictEqual(m.added[0].eff.holes, undefined);
});
t('furo fora da region e erro', () => {
  assert.ok(erros(aplica([letraO({ holes: [quad(30, 30, 2)] })]).m).some(s => /furo 1 fora da região/.test(s)));
});
t('furo que atravessa o contorno e erro', () => {
  assert.ok(erros(aplica([letraO({ holes: [quad(18, 12, 4)] })]).m).some(s => /furo 1 fora da região/.test(s)));
});
t('furo encostado no contorno e erro', () => {
  assert.ok(erros(aplica([letraO({ holes: [[[10, 12], [14, 12], [14, 16], [10, 16]]] })]).m).some(s => /fora da região/.test(s)));
});
t('furos que se sobrepoem e erro', () => {
  assert.ok(erros(aplica([letraO({ holes: [quad(12, 12, 4), quad(14, 14, 4)] })]).m).some(s => /furos 1 e 2 se sobrepõem/.test(s)));
});
t('furo dentro de furo e erro', () => {
  assert.ok(erros(aplica([letraO({ holes: [quad(11, 11, 8), quad(13, 13, 2)] })]).m).some(s => /furos 1 e 2/.test(s)));
});
t('furo com menos de 3 vertices e erro', () => {
  assert.ok(erros(aplica([letraO({ holes: [[[13, 13], [15, 15]]] })]).m).some(s => /furo 1: holes\[0\].*>= 3 vértices/.test(s)));
});
t('furo que nao e lista de aneis e erro', () => {
  assert.ok(erros(aplica([letraO({ holes: quad(13, 13, 4) })]).m).some(s => /furo 1/.test(s)));
  assert.ok(erros(aplica([letraO({ holes: 'x' })]).m).some(s => /holes deve ser/.test(s)));
});
t('furo auto-intersectante e erro', () => {
  assert.ok(erros(aplica([letraO({ holes: [[[12, 12], [16, 16], [16, 12], [12, 16]]] })]).m).some(s => /furo 1: furo com lados que se cruzam/.test(s)));
});
t('recorte (cutout) e polycut com furo sao erro', () => {
  assert.ok(erros(aplica([letraO({ cutout: true })]).m).some(s => /recorte \(cutout\) não leva furo/.test(s)));
  assert.ok(erros(aplica([letraO({ layer: 'Top', polycut: true })]).m).some(s => /polycut\) não leva furo/.test(s)));
});

t('Gerber: a region da serigrafia sai escura e o furo claro (LPC)', () => {
  const { eb } = aplica([letraO()]);
  const r = G.gerar(eb, { guid: '00000000-1111-4222-8333-444444444444' });
  const a = r.arquivos.find(x => x.camada === 'TopOverlay');
  assert.ok(a, 'arquivo da TopOverlay');
  const L = a.texto.split('\r\n');
  const iC = L.indexOf('%LPC*%');
  assert.ok(iC > 0 && L.indexOf('G36*') < iC && L.indexOf('%LPD*%', iC) > iC, 'escuro, depois o furo em LPC e a volta a LPD');
  const regs = GV.parse(a.texto, 'gto').prims.filter(p => p.k === 'region');
  assert.deepStrictEqual(regs.map(p => p.escuro), [true, false]);
});

t('serializeChanges: holes numa linha so, e volta igual', () => {
  const ch = letraO({ note: 'letra o' });
  const s = C.serializeChanges([ch]);
  assert.deepStrictEqual(s.errors, []);
  const L = s.text.split('\n').filter(l => l.indexOf('"op":"region_add"') >= 0);
  assert.strictEqual(L.length, 1, 'uma linha');
  assert.ok(L[0].indexOf('"holes":[[[') >= 0);
  const volta = new Function(s.text + ';return changes;')();
  assert.deepStrictEqual(volta, [ch]);
});
t('serializeChanges recusa furo invalido e furo em recorte', () => {
  assert.ok(C.serializeChanges([letraO({ holes: [quad(30, 30, 2)] })]).errors.some(e => /region_add: furo 1 fora/.test(e.msg)));
  assert.ok(C.serializeChanges([letraO({ cutout: true })]).errors.some(e => /não leva furo/.test(e.msg)));
});

/* o ParsePts e o ParseFuros do ApplyChanges.pas, linha a linha como la */
function parsePts(line) {
  const out = [], p = line.indexOf('"pts":[');
  if (p < 0) return out;
  let i = p + 7, depth = 1, body = '';
  while (i < line.length && depth > 0) { const c = line[i]; if (c === '[') depth++; else if (c === ']') depth--; if (depth > 0) body += c; i++; }
  let cur = '';
  for (const c of body) {
    if (c === '[') cur = '';
    else if (c === ']') { const k = cur.indexOf(','); if (k > 0) out.push([Number(cur.slice(0, k)), Number(cur.slice(k + 1))]); }
    else if (c !== ' ') cur += c;
  }
  return out;
}
function parseFuros(line) {
  const out = [], p = line.indexOf('"holes":[');
  if (p < 0) return out;
  let i = p + 9, depth = 1, cur = '', anel = null;
  while (i < line.length && depth > 0) {
    const c = line[i];
    if (c === '[') { depth++; if (depth === 2) anel = []; else cur = ''; }
    else if (c === ']') {
      if (depth === 3) { const k = cur.indexOf(','); if (k > 0) anel.push([Number(cur.slice(0, k)), Number(cur.slice(k + 1))]); }
      else if (depth === 2 && anel) { out.push(anel); anel = null; }
      depth--;
    } else if (c !== ' ') cur += c;
    i++;
  }
  return out;
}
t('o parser de linha do ApplyChanges acha o contorno e os furos, em qualquer ordem', () => {
  for (const ch of [letraO(), { op: 'region_add', layer: 'TopOverlay', holes: [quad(13, 13, 4), quad(11, 11, 1)], pts: quad(10, 10, 10) }]) {
    const linha = C.serializeChanges([ch]).text.split('\n').find(l => l.indexOf('region_add') >= 0);
    assert.deepStrictEqual(parsePts(linha), ch.pts);
    assert.deepStrictEqual(parseFuros(linha), ch.holes);
  }
  assert.deepStrictEqual(parseFuros('{"op":"region_add","layer":"Top","pts":[[0,0],[1,0],[1,1]]},'), []);
});

console.log('test-regiao-furo: ' + ok + ' ok');
