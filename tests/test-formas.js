/* As formas de desenho da barra do Esquema (1.82.0, 2026-11-06: "na barra de ferramenta, quero que tenha símbolos
   geométricos (retângulo, reta, círculo, texto, estrela) e outras coisas"): a geometria (hub-draw.js), o Salvar
   (hub-core.js » serializeSchematic) e que elas ficam fora das nets e da impressão elétrica da aprovação. */
const assert = require('assert');
const D = require('../hub-draw.js');
const Core = require('../hub-core.js');
const IE = require('../mcp/lib/impressao-eletrica.js');
const { loadVar } = require('./load');

/* 1. o contorno de cada forma cabe na caixa dos dois pontos */
for (const f of D.FORMAS){
  const it = { t:'forma', forma:f, pts:[[100, 200], [500, 500]] };
  const g = D.formaContorno(it);
  assert.ok(g.pts.length >= 2, f + ': contorno');
  for (const [x, y] of g.pts){
    assert.ok(x >= 100 - 1e-6 && x <= 500 + 1e-6 && y >= 200 - 1e-6 && y <= 500 + 1e-6, f + ': ponto fora da caixa ' + x + ',' + y);
  }
  assert.strictEqual(g.fechada, f !== 'linha' && f !== 'seta', f + ': fechada');
  assert.ok(D.FORMA_NOME[f], f + ': nome');
}
/* a estrela tem 10 pontas (5 de fora, 5 de dentro) e o triangulo aponta para cima (Y para cima) */
assert.strictEqual(D.formaContorno({ forma:'estrela', pts:[[0, 0], [300, 300]] }).pts.length, 10);
{
  const t = D.formaContorno({ forma:'triangulo', pts:[[0, 0], [300, 300]] }).pts;
  assert.deepStrictEqual(t[0].map(Math.round), [150, 300], 'o bico em cima');
  const g = D.formaContorno({ forma:'triangulo', rot:180, pts:[[0, 0], [300, 300]] }).pts;
  assert.deepStrictEqual(g[0].map(Math.round), [150, 0], 'girado 180: o bico embaixo');
}

/* 2. o clique: no traço pega; dentro do retângulo vazio não; dentro do preenchido pega */
{
  const r = { forma:'ret', pts:[[0, 0], [1000, 600]] };
  assert.ok(D.formaPerto(r, 0, 300, 5), 'na borda');
  assert.ok(!D.formaPerto(r, 500, 300, 5), 'no meio do vazio');
  assert.ok(D.formaPerto(Object.assign({ fundo:'#ffeeaa' }, r), 500, 300, 5), 'no meio do preenchido');
  const l = { forma:'linha', pts:[[0, 0], [1000, 0]] };
  assert.ok(D.formaPerto(l, 500, 4, 5) && !D.formaPerto(l, 500, 40, 5), 'a linha');
  const s = { forma:'seta', pts:[[0, 0], [1000, 0]], larg:10 };
  const bb = D.formaBBox(s);
  assert.ok(bb.y1 < -20 && bb.y2 > 20, 'a caixa da seta leva a ponta');
}

/* 3. o Salvar aceita a forma e recusa forma sem os dois pontos */
const base = () => ({ format:'schmirror-v2', project:'t', units:'mil', items:[
  { t:'sheet', name:'m', size:'A4' },
  { t:'comp', sheet:'m', ref:'R1', sym:'RES [SMD]', part:1, x:1000, y:1000, rot:0, mirror:false, footprint:'R0805', comment:'1k' },
  { t:'comp', sheet:'m', ref:'R2', sym:'RES [SMD]', part:1, x:1800, y:1000, rot:0, mirror:false, footprint:'R0805', comment:'2k2' },
  { t:'wire', sheet:'m', pts:[[1150, 1000], [1550, 1000]] },
]});
{
  const s = base();
  s.items.push({ t:'forma', sheet:'m', forma:'estrela', pts:[[100, 100], [400, 400]], cor:'#cc0000', larg:20, fundo:'#ffff00' });
  s.items.push({ t:'text', sheet:'m', x:100, y:900, s:'FONTE 24 V', h:16, rot:0, cor:'#008000' });
  const r = Core.serializeSchematic(s);
  assert.deepStrictEqual(r.errors, [], 'forma e texto gravam');
  assert.ok(r.text.includes('"forma":"estrela"'));
  const m = Core.buildSchModel(s);
  assert.strictEqual(m.sheets[0].formas.length, 1, 'a forma entra no modelo da folha');
  const ruim = base(); ruim.items.push({ t:'forma', sheet:'m', forma:'ret', pts:[[0, 0]] });
  assert.ok(Core.serializeSchematic(ruim).errors.some(e => /forma: pts/.test(e.msg)), 'forma de um ponto não grava');
  const semTipo = base(); semTipo.items.push({ t:'forma', sheet:'m', pts:[[0, 0], [1, 1]] });
  assert.ok(Core.serializeSchematic(semTipo).errors.length, 'forma sem "forma" não grava');
}

/* 4. desenho não é elétrico: uma linha em cima do fio não muda as nets nem a impressão da aprovação */
{
  const libs = { schlib: loadVar('Libs/schlib.js', 'schlib') };
  const a = base(), b = base();
  b.items.push({ t:'forma', sheet:'m', forma:'linha', pts:[[1150, 1000], [1950, 1000]] });
  b.items.push({ t:'forma', sheet:'m', forma:'ret', pts:[[900, 800], [2000, 1200]] });
  assert.deepStrictEqual(Core.extractNets(b, libs.schlib).nets.map(n => n.pins), Core.extractNets(a, libs.schlib).nets.map(n => n.pins));
  assert.strictEqual(IE.hash(b, libs, Core), IE.hash(a, libs, Core), 'a impressão elétrica ignora as formas');
}

/* 5. o desenho num contexto que só grava as chamadas: fecha o contorno, preenche e pinta a ponta da seta */
{
  const log = [];
  const ctx = new Proxy({}, { get: (o, k) => k in o ? o[k] : (...a) => log.push(k), set: (o, k, v) => { o[k] = v; return true; } });
  D.drawForma(ctx, { forma:'ret', pts:[[0, 0], [100, 100]], fundo:'#ffffff' });
  assert.ok(log.includes('closePath') && log.includes('fill') && log.includes('stroke'));
  log.length = 0;
  D.drawForma(ctx, { forma:'seta', pts:[[0, 0], [400, 0]] });
  assert.strictEqual(log.filter(k => k === 'fill').length, 1, 'a ponta da seta é cheia');
}
console.log('test-formas: ok');
