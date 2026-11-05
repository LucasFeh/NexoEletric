/* A impressão elétrica do esquema (mcp/lib/impressao-eletrica.js), a base da assinatura da aprovação desde a 1.80.0:
   mover e mexer no layout não muda; trocar componente ou ligação muda (2026-11-05: "só muda revisão no esquema se troca
   realmente componente ou altera algo relevante na ligação"). */
const assert = require('assert');
const { loadVar } = require('./load');
const Core = require('../hub-core.js');
const IE = require('../mcp/lib/impressao-eletrica.js');

const lib = loadVar('Libs/schlib.js', 'schlib');
/* duas resistências ligadas por um fio com rótulo, e uma terceira solta (o "RES [SMD]" da biblioteca: pinos em x-250 e x+150) */
const base = () => ({ format:'schmirror-v2', project:'t', units:'mil', items:[
  { t:'sheet', name:'m', size:'A4' },
  { t:'comp', sheet:'m', ref:'R1', sym:'RES [SMD]', part:1, x:1000, y:1000, rot:0, mirror:false, footprint:'R0805', comment:'1k', params:'Value=1k' },
  { t:'comp', sheet:'m', ref:'R2', sym:'RES [SMD]', part:1, x:1800, y:1000, rot:0, mirror:false, footprint:'R0805', comment:'2k2' },
  { t:'comp', sheet:'m', ref:'R3', sym:'RES [SMD]', part:1, x:1000, y:2000, rot:0, mirror:false, footprint:'R0805', comment:'10k' },
  { t:'wire', sheet:'m', pts:[[1150,1000],[1550,1000]] },
  { t:'wire', sheet:'m', pts:[[1950,1000],[1950,2000],[1150,2000]] },
  { t:'netlabel', sheet:'m', net:'SINAL', x:1350, y:1000, rot:0 },
]});
const libs = { schlib: lib };
const h = s => IE.hash(s, libs, Core);
const h0 = h(base());
assert.deepStrictEqual(IE.impressao(base(), libs, Core).nets, [['SINAL', 'R1-2,R2-1'], ['', 'R2-2,R3-2']], 'as duas nets do exemplo');

/* 1. a folha inteira andou 500 mil (componentes, fios, rótulos, portas, textos): igual */
{
  const s = base();
  for (const it of s.items) {
    if (typeof it.x === 'number') it.x += 500;
    if (typeof it.y === 'number') it.y += 500;
    if (Array.isArray(it.pts)) it.pts = it.pts.map(([x, y]) => [x + 500, y + 500]);
  }
  assert.strictEqual(h(s), h0, 'mover tudo não muda a impressão');
}

/* 2. o texto do designador mudou de lugar, o estoque e o custo vieram do almoxarifado: igual */
{
  const s = base();
  const c = s.items.find(i => i.t === 'comp');
  c.refdx = (c.refdx || 0) + 120; c.comdy = (c.comdy || 0) - 80;
  c.params = (c.params ? c.params + ';' : '') + 'Estoque=12;Custo=3,50;Local=A1';
  assert.strictEqual(h(s), h0, 'layout do texto e dados do almoxarifado não contam');
}

/* 3. trocou o componente (footprint, valor) ou o símbolo: muda */
{
  const s = base(); s.items.find(i => i.t === 'comp').footprint = 'OUTRO_FP';
  assert.notStrictEqual(h(s), h0, 'footprint trocado muda');
  const t = base(); const c = t.items.find(i => i.t === 'comp'); c.comment = (c.comment || '') + ' 10k';
  assert.notStrictEqual(h(t), h0, 'valor trocado muda');
  const u = base(); u.items.find(i => i.t === 'comp').params = 'MPN=XYZ123';
  assert.notStrictEqual(h(u), h0, 'MPN muda');
}

/* 4. tirou um fio (a ligação mudou): muda */
{
  const s = base();
  const i = s.items.findIndex(x => x.t === 'wire');
  s.items.splice(i, 1);
  assert.notStrictEqual(h(s), h0, 'ligação mudou');
}

/* 5. o nome de uma net com rótulo mudou: muda */
{
  const s = base();
  const r = s.items.find(x => (x.t === 'netlabel' || x.t === 'power') && x.net);
  if (r) { r.net = r.net + '_X'; assert.notStrictEqual(h(s), h0, 'nome da net mudou'); }
}

assert.deepStrictEqual(IE.paramsEletricos('Value=10k;Estoque=3;MPN=A;Descricao=x;Custo=1'), ['MPN=A', 'Value=10k']);
console.log('test-impressao-eletrica: ok');
