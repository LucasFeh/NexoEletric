/* Vista PCB nova (contrato 2026-10-02, secoes 1-4): tabela de camadas, ops novas e estendidas
   do changes.js e a placa efetiva (effectiveBoard) que o Gerber consome.

   Os numeros de placa real NAO ficam presos aqui: o espelho dos projetos vai ser reexportado
   pelo ExportBoard novo, e um teste que prende "126 regions no DMB" vira falha-por-dado no dia
   seguinte. Placa real entra so em propriedade que vale para qualquer placa (contagem refeita
   aqui, identidade sem mudancas, idempotencia, a convencao do flip); numero exato so na placa
   sintetica abaixo e na fixture _DemoKit. */
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { loadVar } = require('./load');
const Core = require('../hub-core.js');

const near = (a, b, t) => Math.abs(a - b) <= (t || 1e-6);
const nearPt = (p, x, y, msg) => assert.ok(near(p[0], x) && near(p[1], y), `${msg}: esperado (${x},${y}), veio (${p[0]},${p[1]})`);
const n360 = a => ((a % 360) + 360) % 360;
const mesmoAng = (a, b) => { const d = Math.abs(n360(a) - n360(b)); return d < 1e-6 || d > 360 - 1e-6; };
const erros = m => m.validation.filter(v => v.level === 'err');
const avisos = m => m.validation.filter(v => v.level === 'warn');
const semErro = (m, msg) => assert.strictEqual(erros(m).length, 0, (msg || '') + ' ' + erros(m).map(v => v.msg).join(' | '));
const comErro = (m, re, msg) => assert.ok(erros(m).some(v => re.test(v.msg)), (msg || '') + ' — validacao: ' + m.validation.map(v => v.msg).join(' | '));
const comAviso = (m, re, msg) => assert.ok(avisos(m).some(v => re.test(v.msg)) && !erros(m).length,
  (msg || '') + ' — validacao: ' + m.validation.map(v => v.level + ' ' + v.msg).join(' | '));

/* todas as placas reais do workspace (o que houver hoje), mais o example */
const REAIS = (() => {
  const raiz = path.join(__dirname, '..');
  const dirs = fs.readdirSync(path.join(raiz, 'Projects')).map(d => 'Projects/' + d).concat(['example']);
  return dirs.filter(d => fs.existsSync(path.join(raiz, d, 'board.js')))
             .map(d => ({ nome:d, board:loadVar(d + '/board.js', 'pcbmirror') }));
})();
assert.ok(REAIS.length >= 2, 'acha as placas do workspace');

/* ================= 1. camadas ================= */
const L = Core.PCB_LAYERS;
assert.strictEqual(L.length, 74, 'uma linha por TLayer do Altium (1..74)');
assert.deepStrictEqual(L.map(r => r.altium).slice().sort((a, b) => a - b), Array.from({ length:74 }, (_, i) => i + 1));
assert.deepStrictEqual(L.map(r => r.order), Array.from({ length:74 }, (_, i) => i), 'order = posicao na tabela');
assert.strictEqual(new Set(L.map(r => r.key)).size, 74, 'chaves unicas');
/* ordem das abas do Altium: sinais, planos, mecanicas, overlay, paste, solder, drill guide, keep-out, drill drawing, multi */
assert.deepStrictEqual([L[0].key, L[1].key, L[30].key, L[31].key, L[32].key, L[47].key, L[48].key, L[63].key],
                       ['Top', 'Mid1', 'Mid30', 'Bottom', 'Plane1', 'Plane16', 'Mech1', 'Mech16']);
assert.deepStrictEqual(L.slice(64).map(r => r.key), ['TopOverlay', 'BottomOverlay', 'TopPaste', 'BottomPaste',
  'TopSolder', 'BottomSolder', 'DrillGuide', 'KeepOut', 'DrillDrawing', 'Multi']);
const id = k => Core.pcbLayer(k).altium;
assert.deepStrictEqual([id('Top'), id('Mid1'), id('Mid30'), id('Bottom'), id('TopOverlay'), id('BottomOverlay'), id('TopPaste'),
  id('BottomPaste'), id('TopSolder'), id('BottomSolder'), id('Plane1'), id('Plane16'), id('DrillGuide'), id('KeepOut'),
  id('Mech1'), id('Mech16'), id('DrillDrawing'), id('Multi')],
  [1, 2, 31, 32, 33, 34, 35, 36, 37, 38, 39, 54, 55, 56, 57, 72, 73, 74]);
/* cores = as MEDIDAS nos Gerbers da casa (contrato secao 1b, que vale mais que a tabela antiga:
   Bottom, BottomOverlay e KeepOut deixaram as cores do pcbframe e foram para as do Altium) */
const cor = k => Core.pcbLayer(k).color;
assert.deepStrictEqual(['Top', 'Bottom', 'Mid1', 'Mid2', 'TopOverlay', 'BottomOverlay', 'TopPaste', 'BottomPaste', 'TopSolder',
  'BottomSolder', 'DrillGuide', 'KeepOut', 'DrillDrawing', 'Mech1', 'Mech13', 'Mech15', 'Multi'].map(cor),
  ['#ff0000', '#0000ff', '#bc8e00', '#70dbfa', '#ffff00', '#808000', '#808080', '#800000', '#800080',
   '#ff00ff', '#800000', '#ff00ff', '#ff002a', '#ff00ff', '#ff00ff', '#008000', '#c0c0c0']);
assert.ok(L.every(r => /^#[0-9a-f]{6}$/.test(r.color)), 'toda cor e #rrggbb');
/* paleta propria distinguivel; nas mecanicas, so a repeticao que o proprio Altium tem (Mech13 = Mech1) */
for (const fam of ['Mid', 'Plane', 'Mech']) {
  const cs = L.filter(r => new RegExp('^' + fam + '\\d+$').test(r.key) && r.key !== 'Mech13').map(r => r.color);
  assert.strictEqual(new Set(cs).size, cs.length, 'paleta ' + fam + ' distinguivel: ' + cs.join(' '));
}
assert.strictEqual(Core.pcbLayer('Nada'), null);
assert.strictEqual(Core.pcbLayer(undefined), null);
assert.strictEqual(Core.pcbLayer('toString'), null, 'chave e dado, nao propriedade de objeto');
assert.ok(Object.isFrozen(L) && Object.isFrozen(L[0]), 'a tabela e de todos: congelada');
assert.deepStrictEqual(['Top', 'Mid7', 'Bottom', 'Plane3'].map(Core.isCopper), [true, true, true, true]);
assert.deepStrictEqual(['TopOverlay', 'Multi', 'Mech1', 'KeepOut', 'TopSolder', 'Nada', undefined].map(Core.isCopper),
                       [false, false, false, false, false, false, false]);
assert.deepStrictEqual(['Top', 'Bottom', 'TopOverlay', 'BottomOverlay', 'TopPaste', 'BottomPaste', 'TopSolder', 'BottomSolder'].map(Core.flipLayer),
                       ['Bottom', 'Top', 'BottomOverlay', 'TopOverlay', 'BottomPaste', 'TopPaste', 'BottomSolder', 'TopSolder']);
assert.deepStrictEqual(['Multi', 'KeepOut', 'Mech1', 'Mid3', 'Plane2', 'DrillGuide', 'Nada'].map(Core.flipLayer),
                       ['Multi', 'KeepOut', 'Mech1', 'Mid3', 'Plane2', 'DrillGuide', 'Nada']);
/* par mecanico da PLACA (achado 11: courtyard/3D body viram com o componente quando a placa pareia) */
{
  const b = { layers:[{ key:'Mech15', name:'Top Courtyard', pair:'Mech16' }, { key:'Mech16', name:'Bottom Courtyard' },
                      { key:'Mech13', pair:'Mech15' },              /* Mech15 ja tem par: ignorado */
                      { key:'Top', pair:'Mech1' }, { key:'Mech2', pair:'Top' }] };   /* so mecanica com mecanica */
  assert.deepStrictEqual(['Mech15', 'Mech16', 'Mech13', 'Top', 'Mech2', 'Mech1'].map(k => Core.flipLayer(k, b)),
                         ['Mech16', 'Mech15', 'Mech13', 'Bottom', 'Mech2', 'Mech1']);
  assert.strictEqual(Core.flipLayer('Mech15'), 'Mech15', 'sem a placa, a tabela (mecanica nao tem par fixo)');
}

/* effLayerForOwner passou a usar o flipLayer: as 4 chaves de sempre iguais, e paste/solder agora viram tambem */
{
  const b = { components:[{ ref:'R1', x:10, y:20, rot:0, layer:'Top' }] };
  const vira = Core.applyPcbChanges(b, [{ op:'comp_move', ref:'R1', x:10, y:20, rot:0, layer:'Bottom', orig_x:10, orig_y:20, orig_rot:0, orig_layer:'Top' }]);
  assert.deepStrictEqual(['Top', 'Bottom', 'TopOverlay', 'BottomOverlay', 'Multi', 'TopPaste', 'TopSolder', 'Mech1']
    .map(k => Core.effLayerForOwner(vira, 'R1', k)),
    ['Bottom', 'Top', 'BottomOverlay', 'TopOverlay', 'Multi', 'BottomPaste', 'BottomSolder', 'Mech1']);
  assert.strictEqual(Core.effLayerForOwner(Core.applyPcbChanges(b, []), 'R1', 'TopPaste'), 'TopPaste');
  const bp = Object.assign({ layers:[{ key:'Mech15', pair:'Mech16' }] }, b);
  const vp = Core.applyPcbChanges(bp, [{ op:'comp_move', ref:'R1', x:10, y:20, rot:0, layer:'Bottom', orig_x:10, orig_y:20, orig_rot:0, orig_layer:'Top' }]);
  assert.strictEqual(Core.effLayerForOwner(vp, 'R1', 'Mech15'), 'Mech16', 'com o par da placa, a mecanica vira');
  assert.strictEqual(Core.effLayerForOwner(vp, 'toString', 'Top'), 'Top', 'ref e dado, nao propriedade de objeto');
}

/* ================= 1b. boardLayers ================= */
const SEMPRE = ['Top', 'Bottom', 'TopOverlay', 'BottomOverlay', 'TopPaste', 'BottomPaste', 'TopSolder', 'BottomSolder',
                'DrillGuide', 'KeepOut', 'DrillDrawing', 'Multi'];
const porChave = ls => { const o = {}; for (const l of ls) o[l.key] = l; return o; };
{
  const demo = loadVar('Projects/_DemoKit/board.js', 'pcbmirror');
  const ls = Core.boardLayers(demo), k = porChave(ls);
  assert.deepStrictEqual(ls.map(l => l.key), SEMPRE, 'board antigo: sem mid/plane/mecanica');
  assert.ok(k.Top.used && k.TopOverlay.used && k.Multi.used && !k.Bottom.used && !k.KeepOut.used);
  assert.strictEqual(k.Top.count, 7 + 6, 'Top = 7 trilhas + 6 pads SMD');
  assert.strictEqual(k.TopOverlay.count, 3 + 4, 'TopOverlay = 3 silk + 4 textos');
  assert.strictEqual(k.Multi.count, 2, 'os 2 pads passantes do P1');
  assert.ok(ls.every(l => l.inBoard === false && l.stack === null), 'board antigo nao traz layers');
  assert.strictEqual(k.Top.name, 'Top Layer');
  assert.strictEqual(k.Top.color, '#ff0000');
  ls[0].color = '#000000';
  assert.strictEqual(Core.pcbLayer('Top').color, '#ff0000', 'a lista e copia: mexer nela nao estraga a tabela');
}
/* placas reais: a contagem refeita aqui, sem numero preso (achado 10) */
for (const { nome, board:B } of REAIS) {
  const ls = Core.boardLayers(B), k = porChave(ls);
  const cnt = {};
  const soma = c => { if (c) cnt[c] = (cnt[c] || 0) + 1; };
  for (const a of ['tracks', 'arcs', 'silk', 'lines', 'fills', 'regions', 'texts']) for (const o of (B[a] || [])) soma(o && o.layer);
  for (const c of (B.components || [])) for (const p of (c.pads || [])) soma(p.type === 'th' ? 'Multi' : p.layer);
  for (const p of (B.freepads || [])) soma(p.type === 'th' ? 'Multi' : p.layer);
  for (const v of (B.vias || [])) if (v) soma('Multi');
  for (const s of SEMPRE) assert.ok(k[s], nome + ': a camada fixa ' + s + ' sempre aparece');
  for (const l of ls) {
    assert.strictEqual(l.count, cnt[l.key] || 0, nome + ': contagem de ' + l.key);
    assert.strictEqual(l.used, l.count > 0, nome + ': used de ' + l.key);
    if (SEMPRE.indexOf(l.key) < 0) assert.ok(l.used || l.inBoard, nome + ': ' + l.key + ' so aparece se tem objeto ou esta no board.layers');
  }
  for (const c of Object.keys(cnt)) assert.ok(k[c], nome + ': camada usada ' + c + ' nao pode ficar escondida');
  for (let i = 1; i < ls.length; i++) assert.ok(ls[i].order > ls[i - 1].order, nome + ': lista em ordem');
}
{
  /* board novo: layers com nome/cor da placa, mecanica so quando esta no board ou tem objeto */
  const b = {
    layers:[{ key:'Top', name:'Camada de cima', color:'#FF1111', stack:1 }, { key:'Mech13', name:'Top 3D Body', color:'#123456', pair:'Mech14' },
            { key:'Mech15', name:'Top Courtyard', color:'nao-e-cor' }, { key:'Mid2', name:'Sinal 2', stack:2 }, { key:'Mech40', name:'Extra' }],
    tracks:[{ id:'t1', layer:'Top', x1:0, y1:0, x2:1, y2:0, w:0.2, net:'' }],
    lines:[{ id:'l1', layer:'Mech15', kind:'line', x1:0, y1:0, x2:1, y2:0, w:0.1 }, { id:'l2', layer:'Mech1', kind:'line', x1:0, y1:0, x2:1, y2:0, w:0.1 },
           { id:'l3', layer:'Esquisita', kind:'line', x1:0, y1:0, x2:1, y2:0, w:0.1 }],
    fills:[{ id:'f1', layer:'KeepOut', x1:0, y1:0, x2:1, y2:1, rot:0 }],
    vias:[{ id:'v1', x:0, y:0, size:0.6, drill:0.3 }],
  };
  const ls = Core.boardLayers(b), k = porChave(ls);
  assert.ok(k.Mech13 && k.Mech13.inBoard && !k.Mech13.used, 'Mech13 esta na pilha da placa');
  assert.strictEqual(k.Mech13.name, 'Top 3D Body');
  assert.strictEqual(k.Mech13.color, '#123456', 'cor da placa ganha da paleta');
  assert.strictEqual(k.Mech13.pair, 'Mech14', 'par mecanico que a placa declarou');
  assert.ok(k.Mech15.inBoard && k.Mech15.used && k.Mech15.count === 1 && k.Mech15.pair === null);
  assert.strictEqual(k.Mech15.color, Core.pcbLayer('Mech15').color, 'cor invalida no board cai na da tabela');
  assert.ok(k.Mech1 && k.Mech1.used && !k.Mech1.inBoard, 'mecanica com objeto aparece mesmo fora do layers');
  assert.ok(k.Mid2 && k.Mid2.inBoard && k.Mid2.name === 'Sinal 2');
  assert.deepStrictEqual([k.Top.stack, k.Mid2.stack, k.Bottom.stack], [1, 2, null], 'stack = ordem fisica do cobre, quando vem');
  assert.ok(!k.Mid1 && !k.Plane1 && !k.Mech2, 'o resto das opcionais fica de fora');
  assert.strictEqual(k.Top.name, 'Camada de cima');
  assert.strictEqual(k.Top.color, '#FF1111');
  assert.ok(k.KeepOut.used && k.Multi.used);
  /* chave fora da tabela: entra no fim, para nada usado ficar escondido */
  assert.strictEqual(k.Mech40.kind, 'mech');
  assert.ok(k.Mech40.inBoard && k.Mech40.order >= 74);
  assert.strictEqual(k.Esquisita.kind, 'other');
  assert.ok(k.Esquisita.used && k.Esquisita.order > k.Mech40.order);
  for (let i = 1; i < ls.length; i++) assert.ok(ls[i].order > ls[i - 1].order, 'lista em ordem');
}

/* ================= 2. modelo: silk/linhas/fills/regions livres ================= */
function placa(){
  return {
    format:'pcbmirror-v1', exporter:'ExportBoard 2026-10', units:'mm',
    board:{ bbox:{ x1:0, y1:0, x2:50, y2:40 }, outline:[
      { kind:'line', x1:0, y1:0, x2:50, y2:0 }, { kind:'line', x1:50, y1:0, x2:50, y2:40 },
      { kind:'line', x1:50, y1:40, x2:0, y2:40 }, { kind:'line', x1:0, y1:40, x2:0, y2:0 }] },
    nets:['', 'GND', 'VCC'],
    layers:[{ key:'Top', name:'Top Layer', color:'#FF0000' }, { key:'Mech15', name:'Top Courtyard', color:'#00AA00' }],
    rules:{ sm:0.1016, clearance:0.254 },
    components:[
      { id:'c1', ref:'U1', footprint:'SO2', comment:'CI', layer:'Top', x:10, y:10, rot:0, bbox:{ x1:8, y1:8, x2:12, y2:12 }, pads:[
        { id:'c1p1', name:'1', layer:'Top', type:'smd', shape:'rect', x:11, y:10, w:1, h:0.5, rot:0, net:'GND', sm:0.05, tentTop:false },
        { id:'c1p2', name:'2', layer:'Multi', type:'th', shape:'rect', x:9, y:10, w:1.6, h:1.6, rot:0, drillshape:'oblong', drill:0.8,
          drillw:1.2, holerot:90, net:'VCC', plated:true, bw:2, bh:2, bshape:'circle', tentTop:true, tentBot:false }] },
      { id:'c2', ref:'R2', footprint:'R0805', comment:'1k', layer:'Top', x:30, y:30, rot:0, bbox:{ x1:29, y1:29.5, x2:31, y2:30.5 }, pads:[
        { id:'c2p1', name:'1', layer:'Top', type:'smd', shape:'rect', x:29.5, y:30, w:0.9, h:1.3, rot:0, net:'VCC' }] },
    ],
    freepads:[{ id:'fp1', name:'', layer:'Multi', type:'th', shape:'circle', x:45, y:35, w:3, h:3, rot:0, drillshape:'circle', drill:3, plated:false }],
    tracks:[{ id:'t1', layer:'Top', x1:0, y1:5, x2:10, y2:5, w:0.3, net:'GND' },
            { id:'t2', layer:'Top', x1:11, y1:10, x2:11, y2:12, w:0.25, net:'GND', owner:'U1' }],
    arcs:[{ id:'a1', layer:'Bottom', cx:20, cy:20, r:2, sa:0, ea:90, w:0.2, net:'VCC' }],
    vias:[{ id:'v1', x:5, y:5, size:0.6, drill:0.3, from:'Top', to:'Bottom', net:'GND' }],
    texts:[
      { id:'x1', layer:'TopOverlay', x:10, y:12, text:'U1', h:1, rot:0, mirror:false, designator:true, comment:false, owner:'U1' },
      { id:'x2', layer:'TopOverlay', x:40, y:5, text:'REV A', h:1.5, rot:0, mirror:false, designator:false, comment:false, w:0.15, kind:'stroke' },
      { id:'x3', layer:'BottomOverlay', x:40, y:10, text:'LOGO', h:1, rot:0, mirror:true, designator:false, comment:false }],
    silk:[
      { id:'s1', layer:'TopOverlay', kind:'line', x1:9, y1:11, x2:11, y2:11, w:0.15, owner:'U1' },
      { id:'s2', layer:'TopOverlay', kind:'arc', cx:10, cy:10, r:2, sa:0, ea:360, w:0.1, owner:'U1' },
      { id:'s3', layer:'TopOverlay', kind:'line', x1:20, y1:30, x2:25, y2:30, w:0.2 },
      { id:'s4', layer:'BottomOverlay', kind:'arc', cx:30, cy:10, r:1, sa:90, ea:180, w:0.2 }],
    lines:[
      { id:'l1', layer:'Mech1', kind:'line', x1:0, y1:0, x2:50, y2:0, w:0.1 },
      { id:'l2', layer:'Mech15', kind:'line', x1:8, y1:8, x2:12, y2:8, w:0.05, owner:'U1' },
      { id:'l3', layer:'KeepOut', kind:'arc', cx:25, cy:20, r:5, sa:0, ea:180, w:0.1 },
      { id:'l4', layer:'Top', kind:'line', x1:1, y1:39, x2:49, y2:39, w:0.5, keepout:true }],
    fills:[
      { id:'f1', layer:'TopOverlay', x1:9, y1:8, x2:11, y2:9, rot:0, net:'', owner:'U1' },
      { id:'f2', layer:'Top', x1:30, y1:2, x2:34, y2:4, rot:0, net:'GND' }],
    regions:[
      { id:'g1', layer:'Top', net:'GND', points:[[40, 20], [45, 20], [45, 25], [40, 25]] },
      { id:'g2', layer:'Bottom', net:'GND', points:[[1, 1], [5, 1], [5, 3]], poly:true },
      { id:'g3', layer:'TopSolder', net:'', points:[[9, 9], [11, 9], [11, 11]], owner:'U1' },
      { id:'g4', layer:'Top', net:'', points:[[20, 35], [22, 35], [22, 37]], keepout:true },
      { id:'g5', layer:'Bottom', net:'VCC', points:[[10, 30], [14, 30], [14, 34], [10, 34]], holes:[[[11, 31], [12, 31], [12, 32]]] }],
    cutouts:[{ id:'k1', layer:'Multi', incomp:false, points:[[24, 24], [26, 24], [26, 26], [24, 26]] }],
    stats:{ components:2 },
  };
}
const SB = placa();
const ap = chs => Core.applyPcbChanges(SB, chs);
{
  const m = ap([]);
  semErro(m);
  assert.deepStrictEqual(m.tracks.map(x => x.src.id), ['t1', 't2', 's3', 'l1', 'l4'], 'cobre (todo), silk livre, linha livre (keepout inclusa)');
  assert.deepStrictEqual(m.arcs.map(x => x.src.id), ['a1', 's4', 'l3']);
  assert.deepStrictEqual(m.fills.map(x => x.src.id), ['f2'], 'fill de componente fica fora');
  assert.deepStrictEqual(m.regions.map(x => x.src.id), ['g1', 'g2', 'g5'], 'region de componente e keepout ficam fora; o despejo do Altium sem poligono entra');
  assert.deepStrictEqual(m.regions.map(x => !!x.orfa), [false, true, false], 'g2 (poly:true, sem poligono na placa) entra marcada orfa');
  const s3 = m.tracks[2];
  assert.deepStrictEqual([s3.kind, s3.src.kind, s3.changed, s3.deleted], ['track', 'line', false, false], 'mesmo formato do cobre');
  assert.strictEqual(m.arcs[1].kind, 'arc');
  assert.strictEqual(m.fills[0].kind, 'fill');
  assert.strictEqual(m.regions[0].kind, 'region');
  assert.ok(m.texts.every(t => t.deleted === false), 'texto ganhou deleted (text_del)');
  assert.notStrictEqual(m.regions[0].eff.points, SB.regions[0].points, 'eff da region nao divide os pontos com o board');
  /* achado 9: os furos da region tambem sao copia (antes so os pontos eram) */
  const g5 = m.regions.find(x => x.src.id === 'g5');
  assert.deepStrictEqual(g5.eff.holes, SB.regions[4].holes);
  assert.ok(g5.eff.holes !== SB.regions[4].holes && g5.eff.holes[0] !== SB.regions[4].holes[0] && g5.eff.holes[0][0] !== SB.regions[4].holes[0][0],
            'eff da region nao divide os furos com o board');
  assert.strictEqual(m.board, SB, 'o modelo sabe de que board saiu');
  assert.ok(!Object.keys(m).includes('board') && JSON.stringify(Object.keys(m)) === JSON.stringify(Object.keys(ap([]))), 'sem aparecer nas chaves');
}
/* board antigo (sem os campos novos) monta igual, com as listas novas vazias */
{
  const demo = loadVar('Projects/_DemoKit/board.js', 'pcbmirror');
  const m = Core.applyPcbChanges(demo, loadVar('Projects/_DemoKit/changes.js', 'changes'));
  semErro(m);
  assert.deepStrictEqual([m.fills.length, m.regions.length], [0, 0]);
  assert.strictEqual(m.tracks.length, 7, 'silk do demo e todo de componente: nao entra');
}
/* placas reais: o modelo tem exatamente o que deveria (contado aqui, nao preso) */
for (const { nome, board:B } of REAIS) {
  const m = Core.applyPcbChanges(B, []);
  semErro(m, nome);
  const livre = (arr, k) => (arr || []).filter(s => s && !s.owner && (k === 'arc' ? s.kind === 'arc' : s.kind !== 'arc')).length;
  assert.strictEqual(m.tracks.length, (B.tracks || []).length + livre(B.silk, 'line') + livre(B.lines, 'line'), nome + ': tracks = cobre + silk/linhas livres');
  assert.strictEqual(m.arcs.length, (B.arcs || []).length + livre(B.silk, 'arc') + livre(B.lines, 'arc'), nome + ': arcs = cobre + arcos livres');
  /* achado 4: espelho antigo nao diz de quem e cada region -> nenhuma e editavel */
  const regLivres = (B.regions || []).filter(g => !g.owner && !g.poly && !g.keepout).length;
  assert.strictEqual(m.regions.length, B.exporter ? regLivres : 0, nome + ': regions editaveis');
}

/* ================= 3. operacoes ================= */
const T1 = SB.tracks[0], S3 = SB.silk[2], S4 = SB.silk[3], F2 = SB.fills[1], X2 = SB.texts[1];
const trk = (o, extra) => Object.assign({ id:o.id, orig_x1:o.x1, orig_y1:o.y1, orig_x2:o.x2, orig_y2:o.y2, orig_w:o.w, orig_layer:o.layer }, extra);
const arc = (o, extra) => Object.assign({ id:o.id, orig_cx:o.cx, orig_cy:o.cy, orig_r:o.r, orig_sa:o.sa, orig_ea:o.ea, orig_layer:o.layer }, extra);

/* track_edit em silk livre: edita, troca de camada; molde da mensagem e target */
{
  const m = ap([trk(S3, { op:'track_edit', x2:26, layer:'Mech1' })]);
  semErro(m);
  const it = m.tracks.find(x => x.src === S3);
  assert.deepStrictEqual([it.eff.x2, it.eff.layer, it.changed], [26, 'Mech1', true]);
  assert.strictEqual(m.changeItems[0].target, it, 'target aponta o objeto do modelo');
  const del = ap([trk(S3, { op:'track_del', orig_x1:20.5 })]);
  comAviso(del, /^#1 track_del: orig_\* não confere/, 'orig divergente e aviso, no molde "#n op: ..."');
  assert.ok(del.tracks.find(x => x.src === S3).deleted);
}
/* item de componente: erro dizendo de quem e */
comErro(ap([trk(SB.silk[0], { op:'track_edit', x1:0 })]), /pertence ao componente U1/, 'silk de componente');
comErro(ap([trk(SB.tracks[1], { op:'track_del' })]), /pertence ao componente U1/, 'trilha de cobre do footprint');
comErro(ap([trk(SB.lines[1], { op:'track_edit', w:1 })]), /pertence ao componente U1/, 'linha mecanica do footprint');
comErro(ap([arc(SB.silk[1], { op:'arc_edit', r:3 })]), /pertence ao componente U1/, 'arco de silk do componente');
comErro(ap([trk({ id:'s99', x1:0, y1:0, x2:1, y2:1, w:1, layer:'TopOverlay' }, { op:'track_edit' })]), /trilha id "s99" não existe/);
comErro(ap([trk({ id:'s4', x1:0, y1:0, x2:0, y2:0, w:0, layer:'BottomOverlay' }, { op:'track_edit' })]),
        /trilha id "s4" não existe/, 's4 e arco: track_edit nao o acha');
comErro(ap([trk({ id:'toString', x1:0, y1:0, x2:0, y2:0, w:0, layer:'Top' }, { op:'track_edit' })]), /não existe/, 'id e dado');

/* troca de camada de uma trilha: Top -> Bottom -> TopOverlay */
{
  const m1 = ap([trk(T1, { op:'track_edit', layer:'Bottom' })]);
  semErro(m1);
  assert.deepStrictEqual([m1.tracks[0].eff.layer, m1.tracks[0].eff.net], ['Bottom', 'GND'], 'cobre -> cobre leva a net');
  const m2 = ap([trk(T1, { op:'track_edit', layer:'TopOverlay' })]);
  semErro(m2);
  assert.strictEqual(m2.tracks[0].eff.layer, 'TopOverlay');
  assert.ok(!('net' in m2.tracks[0].eff), 'em overlay a trilha nao leva net');
  const eb = Core.effectiveBoard(SB, m2);
  assert.ok(!eb.tracks.some(t => t.id === 't1'), 'saiu do cobre');
  const s = eb.silk.find(t => t.id === 't1');
  assert.ok(s && s.kind === 'line' && !('net' in s) && s.layer === 'TopOverlay', 'virou silk: ' + JSON.stringify(s));
  /* dois edits encadeados (o segundo com o orig do estado que o primeiro deixou) devolvem a net */
  const m3 = ap([trk(T1, { op:'track_edit', layer:'TopOverlay' }), trk(Object.assign({}, T1, { layer:'TopOverlay' }), { op:'track_edit', layer:'Top' })]);
  semErro(m3);
  assert.deepStrictEqual([m3.tracks[0].eff.layer, m3.tracks[0].eff.net], ['Top', 'GND']);
  comErro(ap([trk(T1, { op:'track_edit', layer:'Multi' })]), /Multi-Layer/);
  comErro(ap([trk(T1, { op:'track_edit', layer:'Nada' })]), /layer "Nada" não existe/);
  const mn = ap([trk(T1, { op:'track_edit', layer:'TopOverlay', net:'VCC' })]);
  comAviso(mn, /net "VCC" só vale em camada de cobre/);
  assert.ok(!('net' in mn.tracks[0].eff));
  const mc = ap([trk(S3, { op:'track_edit', layer:'Bottom', net:'VCC' })]);
  semErro(mc);
  assert.deepStrictEqual([mc.tracks[2].eff.layer, mc.tracks[2].eff.net], ['Bottom', 'VCC'], 'silk que vira cobre aceita net');
}
/* track_add / arc_add em qualquer camada menos Multi */
{
  const m = ap([{ op:'track_add', layer:'TopOverlay', x1:1, y1:1, x2:2, y2:1, w:0.2 },
                { op:'track_add', layer:'Mech5', x1:1, y1:2, x2:2, y2:2, w:0.1, net:'GND' },
                { op:'arc_add', layer:'Mech1', cx:5, cy:5, r:1, sa:0, ea:360, w:0.1 },
                { op:'track_add', layer:'Mid3', x1:0, y1:0, x2:1, y2:0, w:0.2, net:'GND' }]);
  semErro(m);
  comAviso(m, /^#2 track_add: net "GND" só vale em camada de cobre/);
  assert.deepStrictEqual(m.added.map(a => [a.kind, a.eff.layer]), [['track', 'TopOverlay'], ['track', 'Mech5'], ['arc', 'Mech1'], ['track', 'Mid3']]);
  assert.ok(!('net' in m.added[1].eff), 'net descartada do eff fora do cobre');
  assert.strictEqual(m.added[3].eff.net, 'GND');
  assert.strictEqual(m.changeItems[2].target, m.added[2]);
  comErro(ap([{ op:'track_add', layer:'Multi', x1:0, y1:0, x2:1, y2:0, w:0.2 }]), /Multi-Layer/);
  comErro(ap([{ op:'track_add', layer:'Nada', x1:0, y1:0, x2:1, y2:0, w:0.2 }]), /não existe/);
  comErro(ap([{ op:'track_add', x1:0, y1:0, x2:1, y2:0, w:0.2 }]), /falta layer/);
  comErro(ap([{ op:'arc_add', layer:'Multi', cx:0, cy:0, r:1, sa:0, ea:90, w:0.2 }]), /Multi-Layer/);
  comErro(ap([{ op:'arc_add', layer:'Top', cx:0, cy:0, r:0, sa:0, ea:90, w:0.2 }]), /raio r deve ser > 0/);
  comErro(ap([{ op:'arc_add', layer:'Top', cx:0, cy:0, r:1, sa:0, ea:90, w:0 }]), /largura w deve ser > 0/);
}
/* arc_edit/arc_del em arco livre de silk e de linha */
{
  const m = ap([arc(S4, { op:'arc_edit', r:1.5, layer:'BottomPaste' }), arc(SB.lines[2], { op:'arc_del' })]);
  semErro(m);
  assert.deepStrictEqual([m.arcs[1].eff.r, m.arcs[1].eff.layer], [1.5, 'BottomPaste']);
  assert.ok(m.arcs[2].deleted);
  comAviso(ap([arc(S4, { op:'arc_del', orig_r:9 })]), /não confere/);
  comErro(ap([arc({ id:'a77', cx:0, cy:0, r:0, sa:0, ea:0, layer:'Top' }, { op:'arc_del' })]), /arco id "a77" não existe/);
}
/* text_edit ganhou layer e mirror */
{
  const tx = { id:'x2', orig_x:X2.x, orig_y:X2.y, orig_text:X2.text, orig_layer:X2.layer };
  const m = ap([Object.assign({ op:'text_edit', layer:'BottomOverlay', mirror:true }, tx)]);
  semErro(m);
  assert.deepStrictEqual([m.texts[1].eff.layer, m.texts[1].eff.mirror], ['BottomOverlay', true]);
  comErro(ap([Object.assign({ op:'text_edit', layer:'Multi' }, tx)]), /Multi-Layer/);
}
/* text_add / text_del */
{
  const m = ap([{ op:'text_add', layer:'TopOverlay', text:'V1.2', x:20, y:10, h:1.2 }]);
  semErro(m);
  const t = m.added[0];
  /* contrato secao 2: `kind` e o tipo da fonte (stroke/truetype/barcode); `font` e o nome da TrueType */
  assert.deepStrictEqual([t.kind, t.added, t.eff.w, t.eff.rot, t.eff.mirror, t.eff.kind, t.eff.designator, 'font' in t.eff],
                         ['text', true, 0.12, 0, false, 'stroke', false, false]);
  assert.ok(/^new-x\d+$/.test(t.eff.id));
  assert.strictEqual(m.changeItems[0].target, t);
  comErro(ap([{ op:'text_add', layer:'TopOverlay', text:'A', x:0, y:0, h:0 }]), /altura h deve ser > 0/);
  comErro(ap([{ op:'text_add', layer:'TopOverlay', x:0, y:0, h:1 }]), /"text" ausente/);
  comErro(ap([{ op:'text_add', layer:'TopOverlay', text:'A', x:0, y:0, h:1, w:-1 }]), /espessura w/);
  comErro(ap([{ op:'text_add', layer:'Multi', text:'A', x:0, y:0, h:1 }]), /Multi-Layer/);
  const tx = { id:'x2', orig_x:X2.x, orig_y:X2.y, orig_text:X2.text, orig_layer:X2.layer };
  const d = ap([Object.assign({ op:'text_del' }, tx)]);
  semErro(d);
  assert.ok(d.texts[1].deleted);
  assert.strictEqual(d.changeItems[0].target, d.texts[1]);
  comAviso(ap([Object.assign({ op:'text_del' }, tx, { orig_text:'REV B' })]), /não confere/);
  comErro(ap([{ op:'text_del', id:'x1', orig_x:10, orig_y:12, orig_text:'U1', orig_layer:'TopOverlay' }]), /pertence ao componente U1/);
  comErro(ap([{ op:'text_del', id:'x9', orig_x:0, orig_y:0, orig_text:'', orig_layer:'TopOverlay' }]), /texto id "x9" não existe/);
  comErro(ap([{ op:'text_del', id:'x2' }]), /faltam orig_x/);
}
/* fill_add / fill_edit / fill_del */
{
  const m = ap([{ op:'fill_add', layer:'Top', x1:1, y1:1, x2:3, y2:2, net:'GND' },
                { op:'fill_add', layer:'TopOverlay', x1:1, y1:1, x2:3, y2:2, rot:45, net:'GND' }]);
  semErro(m);
  comAviso(m, /^#2 fill_add: net "GND" só vale/);
  assert.deepStrictEqual(m.added.map(a => [a.kind, a.eff.layer, a.eff.rot, a.eff.net]), [['fill', 'Top', 0, 'GND'], ['fill', 'TopOverlay', 45, undefined]]);
  comErro(ap([{ op:'fill_add', layer:'Top', x1:1, y1:1, x2:1, y2:2 }]), /fill sem área/);
  comErro(ap([{ op:'fill_add', layer:'Multi', x1:1, y1:1, x2:2, y2:2 }]), /Multi-Layer/);
  comErro(ap([{ op:'fill_add', layer:'Top', x1:1, y1:1, y2:2 }]), /campo "x2"/);
  const fo = { id:'f2', orig_x1:F2.x1, orig_y1:F2.y1, orig_x2:F2.x2, orig_y2:F2.y2, orig_layer:F2.layer };
  const e = ap([Object.assign({ op:'fill_edit', x1:31, x2:35, layer:'Bottom', rot:90 }, fo)]);
  semErro(e);
  assert.deepStrictEqual([e.fills[0].eff.x1, e.fills[0].eff.x2, e.fills[0].eff.layer, e.fills[0].eff.rot, e.fills[0].changed], [31, 35, 'Bottom', 90, true]);
  assert.strictEqual(e.fills[0].eff.net, 'GND');
  assert.strictEqual(e.changeItems[0].target, e.fills[0]);
  semErro(ap([Object.assign({}, fo, { op:'fill_edit', orig_x1:F2.x2, orig_x2:F2.x1, rot:10 })]), 'cantos trocados sao o mesmo fill');
  assert.strictEqual(avisos(ap([Object.assign({}, fo, { op:'fill_edit', orig_x1:F2.x2, orig_x2:F2.x1, rot:10 })])).length, 0);
  comAviso(ap([Object.assign({}, fo, { op:'fill_edit', orig_y2:9, rot:10 })]), /não confere/);
  comErro(ap([Object.assign({}, fo, { op:'fill_edit', x2:30 })]), /fill sem área/);
  const ov = ap([Object.assign({ op:'fill_edit', layer:'TopOverlay' }, fo)]);
  assert.ok(!('net' in ov.fills[0].eff), 'fill que sai do cobre perde a net');
  comErro(ap([{ op:'fill_edit', id:'f1', orig_x1:9, orig_y1:8, orig_x2:11, orig_y2:9, orig_layer:'TopOverlay', x1:0 }]), /fill id "f1" pertence ao componente U1/);
  comErro(ap([Object.assign({}, fo, { op:'fill_del', id:'f9' })]), /fill id "f9" não existe/);
  const d = ap([Object.assign({ op:'fill_del' }, fo)]);
  semErro(d);
  assert.ok(d.fills[0].deleted);
}
/* region_add / region_del */
{
  const m = ap([{ op:'region_add', layer:'Top', net:'GND', pts:[[0, 0], [2, 0], [1, 2]] },
                { op:'region_add', cutout:true, layer:'Top', pts:[[30, 30], [32, 30], [32, 32], [30, 32]] },
                { op:'region_add', layer:'TopOverlay', net:'GND', pts:[[0, 0], [2, 0], [1, 2]] }]);
  semErro(m);
  comAviso(m, /^#3 region_add: net "GND" só vale/);
  const [r, k, o] = m.added;
  assert.deepStrictEqual([r.kind, r.eff.layer, r.eff.net, r.eff.points], ['region', 'Top', 'GND', [[0, 0], [2, 0], [1, 2]]]);
  assert.deepStrictEqual([k.kind, k.eff.cutout, k.eff.layer], ['region', true, 'Multi'], 'cutout ignora a layer');
  assert.ok(/^new-k\d+$/.test(k.eff.id) && /^new-g\d+$/.test(r.eff.id));
  assert.ok(!('net' in o.eff));
  comErro(ap([{ op:'region_add', layer:'Top', pts:[[0, 0], [1, 1]] }]), /pts deve ser/);
  comErro(ap([{ op:'region_add', layer:'Top', pts:[[0, 0], [1, 1], [2, 2]] }]), /sem área/);
  comErro(ap([{ op:'region_add', layer:'Top', pts:[[0, 0], [1, 0], [0, 0]] }]), /sem área/, 'triangulo degenerado');
  comErro(ap([{ op:'region_add', layer:'Multi', pts:[[0, 0], [2, 0], [1, 2]] }]), /Multi-Layer/);
  const go = { id:'g1', orig_layer:'Top', orig_n:4, orig_x0:40, orig_y0:20 };
  const d = ap([Object.assign({ op:'region_del' }, go)]);
  semErro(d);
  assert.ok(d.regions[0].deleted);
  assert.strictEqual(d.changeItems[0].target, d.regions[0]);
  comAviso(ap([Object.assign({}, go, { op:'region_del', orig_n:5 })]), /não confere/);
  comAviso(ap([Object.assign({}, go, { op:'region_del', orig_x0:41 })]), /não confere/);
  comErro(ap([Object.assign({}, go, { op:'region_del', id:'g99' })]), /região id "g99" não existe/);
  /* despejo do Altium sem poligono na placa (o "altium_sem_poligono" do DRC): o region_del apaga (1.35.0) */
  const d2 = ap([{ op:'region_del', id:'g2', orig_layer:'Bottom', orig_n:3, orig_x0:1, orig_y0:1 }]);
  semErro(d2);
  assert.ok(d2.regions[1].deleted && d2.regions[1].orfa);
  assert.ok(!Core.effectiveBoard(SB, d2).regions.some(g => g.id === 'g2'), 'g2 sai da placa efetiva (tela, DRC, Gerber)');
  /* pedaco de um poligono que ESTA na placa: o hub redespeja, entao continua so de desenho */
  {
    const b = placa();
    b.polygons = [{ id:'pg1', layer:'Bottom', net:'GND', pts:[[0, 0], [6, 0], [6, 4], [0, 4]] }];
    b.regions[1].de = 'pg1';
    const mp = Core.applyPcbChanges(b, []);
    assert.deepStrictEqual(mp.regions.map(x => x.src.id), ['g1', 'g5'], 'pedaco do pg1 fica fora');
    comErro(Core.applyPcbChanges(b, [{ op:'region_del', id:'g2', orig_layer:'Bottom', orig_n:3, orig_x0:1, orig_y0:1 }]), /pedaço do polígono pg1/);
  }
  comErro(ap([Object.assign({}, go, { op:'region_del', id:'g3' })]), /pertence ao componente U1/);
  comErro(ap([Object.assign({}, go, { op:'region_del', id:'g4' })]), /keepout/);
  comErro(ap([{ op:'region_del', id:'g1' }]), /faltam orig_layer/);
}

/* ================= 3b. achados da revisao (2026-10-02) ================= */

/* achado 3: comp_move.layer so Top/Bottom EXATOS (o ApplyChanges ignora o resto calado) */
for (const lay of ['bottom', 'Bot', 'TopOverlay', 'Multi', 1]) {
  const m = ap([{ op:'comp_move', ref:'U1', x:10, y:10, rot:0, layer:lay, orig_x:10, orig_y:10, orig_rot:0, orig_layer:'Top' }]);
  comErro(m, /inválida para componente — use Top ou Bottom/, 'layer ' + lay);
  const eb = Core.effectiveBoard(SB, m);
  assert.deepStrictEqual([eb.components[0].layer, eb.components[0].pads[0].layer, eb.texts[0].layer], ['Top', 'Top', 'TopOverlay'], 'nao virou');
}
semErro(ap([{ op:'comp_move', ref:'U1', x:12, y:10, rot:0, layer:'', orig_x:10, orig_y:10, orig_rot:0, orig_layer:'Top' }]), 'layer vazia = sem layer');
/* o que o ApplyChanges faz diferente da previa vira aviso: eixo faltando vai para 0, flip sem rot */
comAviso(ap([{ op:'comp_move', ref:'U1', x:12, orig_x:10, orig_y:10, orig_rot:0, orig_layer:'Top' }]), /sem y: o ApplyChanges leva o componente para y = 0/);
comAviso(ap([{ op:'comp_move', ref:'U1', rot:90, orig_x:10, orig_y:10, orig_rot:0, orig_layer:'Top' }]), /sem x e y: .* para x = 0, y = 0/);
comAviso(ap([{ op:'comp_move', ref:'U1', x:10, y:10, layer:'Bottom', orig_x:10, orig_y:10, orig_rot:0, orig_layer:'Top' }]), /vira de lado sem rot/);
comErro(ap([{ op:'comp_move', ref:'U1', x:null, y:10, rot:0, orig_x:10, orig_y:10, orig_rot:0, orig_layer:'Top' }]), /campo "x" inválido/);
comErro(ap([{ op:'comp_move', ref:'toString', x:1, y:1, orig_x:0, orig_y:0, orig_rot:0, orig_layer:'Top' }]), /não existe/, 'ref e dado');

/* achado 4: espelho antigo (sem exporter) nao diz de quem e cada region */
{
  const velho = placa(); delete velho.exporter;
  velho.regions.push({ id:'g6', layer:'Top', net:'GND', points:[[10.5, 9.5], [11.5, 9.5], [11.5, 10.5], [10.5, 10.5]] });   /* "pad customizado" do U1 */
  velho.cutouts.push({ id:'k2', layer:'Multi', incomp:true, points:[[9, 11], [9.5, 11], [9.5, 11.5]] });                      /* recorte do U1, sem owner */
  const va = chs => Core.applyPcbChanges(velho, chs);
  assert.deepStrictEqual(va([]).regions, [], 'nenhuma region editavel');
  comErro(va([{ op:'region_del', id:'g1', orig_layer:'Top', orig_n:4, orig_x0:40, orig_y0:20 }]),
          /espelho antigo \(board.js sem "exporter"\).*reexporte a placa/, 'region_del recusado');
  const mv = { op:'comp_move', ref:'U1', x:20, y:10, rot:0, layer:'Top', orig_x:10, orig_y:10, orig_rot:0, orig_layer:'Top' };
  const m = va([mv]);
  comAviso(m, /^#1 comp_move: 1 região\(ões\) e 1 recorte\(s\) dentro de U1 sem dono no board.js \(espelho antigo\)/,
           'conta a g6 e o k2; a g3 tem owner e anda com o U1');
  /* sem dono, a region fica no lugar -- e o aviso e o que conta para o usuario */
  assert.deepStrictEqual(Core.effectiveBoard(velho, m).regions.find(g => g.id === 'g6').points[0], [10.5, 9.5]);
  /* espelho novo: region sem owner E livre de verdade, nada a avisar */
  const novo = placa(); novo.regions.push(velho.regions[5]);
  semErro(Core.applyPcbChanges(novo, [mv]));
  assert.strictEqual(avisos(Core.applyPcbChanges(novo, [mv])).length, 0);
}

/* achado 5: xfObject aceita o kind do proprio modelo ('track') e recusa kind desconhecido */
{
  const mm = ap([{ op:'comp_move', ref:'U1', x:20, y:10, rot:0, orig_x:10, orig_y:10, orig_rot:0, orig_layer:'Top' }]);
  const d = Core.ownerDelta(mm, 'U1');
  assert.deepStrictEqual(Core.xfObject(d, SB.tracks[1], 'track'), Core.xfObject(d, SB.tracks[1], 'line'));
  assert.deepStrictEqual([Core.xfObject(d, SB.tracks[1], 'track').x1, Core.xfObject(d, SB.tracks[1], 'track').y1], [21, 10]);
  for (const k of ['qualquer', 'via', undefined, 'toString'])
    assert.throws(() => Core.xfObject(d, SB.tracks[1], k), /xfObject: kind/, 'kind ' + k);
  assert.throws(() => Core.xfObject(null, SB.tracks[1], 'trilha'), /xfObject: kind/, 'mesmo sem delta: erro de programa aparece cedo');
}

/* achado 6: model de outro board e erro mesmo quando o board nao tem componente, via nem texto */
{
  const B1 = { tracks:[{ id:'t1', layer:'Top', x1:0, y1:0, x2:1, y2:0, w:0.2, net:'' }] };
  const B2 = { tracks:[{ id:'t1', layer:'Top', x1:5, y1:5, x2:9, y2:5, w:0.2, net:'' }] };
  const M1 = Core.applyPcbChanges(B1, [{ op:'track_del', id:'t1', orig_x1:0, orig_y1:0, orig_x2:1, orig_y2:0, orig_w:0.2, orig_layer:'Top' }]);
  assert.throws(() => Core.effectiveBoard(B2, M1), /não foi gerado deste board/);
  assert.deepStrictEqual(Core.effectiveBoard(B1, M1).tracks, [], 'com o board certo, a remocao vale');
  /* copia rasa do modelo (perde a marca): cai na conferencia por identidade, que tambem acha */
  assert.throws(() => Core.effectiveBoard(B2, Object.assign({}, M1)), /não foi gerado deste board/);
  assert.deepStrictEqual(Core.effectiveBoard(B1, Object.assign({}, M1)).tracks, []);
  assert.deepStrictEqual(Core.effectiveBoard(undefined).components, [], 'sem board e sem model nao quebra');
}

/* achado 7: id repetido entre arrays -- o orig_* decide; se nem ele decide, erro */
{
  const b = placa();
  b.silk.push({ id:'t1', layer:'TopOverlay', kind:'line', x1:1, y1:1, x2:2, y2:1, w:0.2 });     /* colide com a trilha t1 */
  b.lines.push({ id:'s3', layer:'Mech1', kind:'line', x1:0, y1:1, x2:5, y2:1, w:0.1 });          /* colide com o silk s3 */
  const silkT1 = b.silk[4], linS3 = b.lines[4];
  const m = Core.applyPcbChanges(b, [trk(silkT1, { op:'track_del' }), trk(linS3, { op:'track_del' })]);
  semErro(m);
  const st = o => m.tracks.find(t => t.src === o);
  assert.deepStrictEqual([st(b.tracks[0]).deleted, st(silkT1).deleted, st(b.silk[2]).deleted, st(linS3).deleted], [false, true, false, true],
                         'apaga o que o orig_* aponta, nao o primeiro do id');
  assert.strictEqual(m.changeItems[0].target, st(silkT1));
  comErro(Core.applyPcbChanges(b, [trk(silkT1, { op:'track_del', orig_w:0.9 })]), /trilha id "t1" aparece 2 vezes no board.js/, 'orig nao decide: erro');
}

/* achado 8: o ApplyChanges aplica em ordem -- o designator (e o texto) de um componente ja movido
   nao esta mais no orig_* */
{
  const B = { components:[{ ref:'U1', x:10, y:10, rot:0, layer:'Top', pads:[] }],
              texts:[{ id:'x1', layer:'TopOverlay', x:10, y:12, text:'U1', h:1, rot:0, mirror:false, designator:true, comment:false, owner:'U1' },
                     { id:'x2', layer:'TopOverlay', x:10, y:8, text:'+', h:1, rot:0, mirror:false, designator:false, comment:false, owner:'U1' }] };
  const mv = { op:'comp_move', ref:'U1', x:20, y:10, rot:0, orig_x:10, orig_y:10, orig_rot:0, orig_layer:'Top' };
  const dm = { op:'designator_move', ref:'U1', x:11, y:13, orig_x:10, orig_y:12 };
  const antes = Core.applyPcbChanges(B, [dm, mv]);
  semErro(antes, 'designator_move ANTES do comp_move');
  const ta = Core.effectiveBoard(B, antes).texts[0];
  assert.deepStrictEqual([ta.x, ta.y], [21, 13], 'move o designator e depois o componente o leva junto');
  const depois = Core.applyPcbChanges(B, [mv, dm]);
  comErro(depois, /^#2 designator_move: o designator de U1 já terá andado com o comp_move #1 .*ponha-o antes do comp_move/);
  const td = Core.effectiveBoard(B, depois).texts[0];
  assert.deepStrictEqual([td.x, td.y], [20, 12], 'a previa mostra o que o Altium faz: o designator so acompanha o componente');
  /* com o orig do lugar novo (o que o ApplyChanges acha), passa -- e o x/y vale no lugar novo:
     o eff guarda no referencial do board.js e a placa efetiva poe o (21,13) pedido */
  const novoLugar = Core.applyPcbChanges(B, [mv, Object.assign({}, dm, { orig_x:20, orig_y:12, x:21, y:13 })]);
  semErro(novoLugar);
  assert.deepStrictEqual([novoLugar.texts[0].eff.x, novoLugar.texts[0].eff.y], [11, 13]);
  const tn = Core.effectiveBoard(B, novoLugar).texts[0];
  assert.deepStrictEqual([tn.x, tn.y], [21, 13]);
  /* idem com o componente virado: posicao, rotacao, camada e espelho pedidos sao os da placa mudada */
  const vira = { op:'comp_move', ref:'U1', x:20, y:10, rot:90, layer:'Bottom', orig_x:10, orig_y:10, orig_rot:0, orig_layer:'Top' };
  const ond = Core.effectiveBoard(B, Core.applyPcbChanges(B, [vira])).texts[1];      /* onde o "+" foi parar */
  const te = { op:'text_edit', id:'x2', x:25, y:11, rot:45, layer:'BottomOverlay', mirror:true,
               orig_x:ond.x, orig_y:ond.y, orig_text:'+', orig_layer:ond.layer };
  const mvt = Core.applyPcbChanges(B, [vira, te]);
  semErro(mvt);
  const t2 = Core.effectiveBoard(B, mvt).texts[1];
  assert.deepStrictEqual([t2.x, t2.y, t2.rot, t2.layer, t2.mirror], [25, 11, 45, 'BottomOverlay', true]);
  assert.deepStrictEqual(Core.xfPointInv(Core.compDelta(mvt.compByRef.U1), 25, 11), { x:mvt.texts[1].eff.x, y:mvt.texts[1].eff.y });
  /* texto de componente que nao e designator: mesma coisa no text_edit */
  comErro(Core.applyPcbChanges(B, [mv, { op:'text_edit', id:'x2', text:'-', orig_x:10, orig_y:8, orig_text:'+', orig_layer:'TopOverlay' }]),
          /orig_\* não confere com o objeto depois da mudança #1/);
  /* duas ops no mesmo objeto: a segunda tem de partir do estado que a primeira deixou */
  comErro(Core.applyPcbChanges(B, [mv, Object.assign({}, mv, { x:30 })]), /^#2 comp_move: orig_\* não confere com o objeto depois da mudança #1/);
  semErro(Core.applyPcbChanges(B, [mv, Object.assign({}, mv, { x:30, orig_x:20 })]), 'encadeado com o orig certo');
  comErro(ap([trk(T1, { op:'track_del' }), trk(T1, { op:'track_edit', w:1 })]), /trilha id "t1" já foi removida pela mudança #1/);
  comErro(ap([{ op:'via_edit', id:'v1', x:6, orig_x:5, orig_y:5 }, { op:'via_del', id:'v1', orig_x:5, orig_y:5 }]), /depois da mudança #1/);
  semErro(ap([trk(T1, { op:'track_edit', net:'VCC' }), trk(T1, { op:'track_edit', w:0.5 })]), 'a primeira nao tirou a trilha do lugar');
}

/* achado 9: validacoes que deixavam passar para a placa efetiva */
{
  comErro(ap([trk(S3, { op:'track_edit', w:-1 })]), /largura w deve ser > 0/, 'w negativo em silk livre');
  comErro(ap([trk(T1, { op:'track_edit', w:0 })]), /largura w deve ser > 0/);
  comErro(ap([trk(T1, { op:'track_edit', x1:null })]), /campo "x1" inválido/, 'null viraria 0 no ApplyChanges');
  comErro(ap([arc(S4, { op:'arc_edit', r:0 })]), /raio r deve ser > 0/);
  comErro(ap([arc(S4, { op:'arc_edit', w:-0.1 })]), /largura w deve ser > 0/);
  comErro(ap([{ op:'via_add', x:1, y:1, size:0, drill:0.3 }]), /size e drill devem ser > 0/);
  comErro(ap([{ op:'via_edit', id:'v1', drill:-1, orig_x:5, orig_y:5 }]), /size e drill devem ser > 0/);
  comErro(ap([{ op:'text_edit', id:'x2', h:0, orig_x:40, orig_y:5, orig_text:'REV A', orig_layer:'TopOverlay' }]), /altura h e espessura w devem ser > 0/);
  /* comp_attr: dois componentes com o mesmo nome e erro; a troca R1<->R2 continua valendo */
  const B6 = { components:[{ ref:'R1', comment:'1k', layer:'Top', x:0, y:0, rot:0, pads:[] }, { ref:'R2', comment:'1k', layer:'Top', x:5, y:0, rot:0, pads:[] },
                           { ref:'R3', comment:'1k', layer:'Top', x:9, y:0, rot:0, pads:[] }] };
  const at = (ref, des) => ({ op:'comp_attr', ref, designator:des, orig_designator:ref, orig_comment:'1k' });
  const m6 = Core.applyPcbChanges(B6, [at('R1', 'R2')]);
  comErro(m6, /designator "R2" já é de outro componente/);
  assert.deepStrictEqual(Core.effectiveBoard(B6, m6).components.map(c => c.ref), ['R1', 'R2', 'R3'], 'o rename recusado nao entra');
  const troca = Core.applyPcbChanges(B6, [at('R1', 'R2'), at('R2', 'R1')]);
  semErro(troca, 'troca R1<->R2');
  assert.deepStrictEqual(Core.effectiveBoard(B6, troca).components.map(c => c.ref), ['R2', 'R1', 'R3']);
  comErro(Core.applyPcbChanges(B6, [at('R1', 'R9'), at('R3', 'R9')]), /designator "R9" também é o nome novo de/);
  semErro(Core.applyPcbChanges(B6, [at('R1', 'R1')]), 'renomear para o proprio nome nao e repeticao');
  /* rot do componente normalizada como a dos pads */
  const eb5 = Core.effectiveBoard(SB, ap([{ op:'comp_move', ref:'U1', x:10, y:10, rot:-90, orig_x:10, orig_y:10, orig_rot:0, orig_layer:'Top' }]));
  assert.deepStrictEqual([eb5.components[0].rot, eb5.components[0].pads[0].rot], [270, 270]);
  /* objeto novo e sempre livre: owner na op e aviso e nao entra no eff */
  const m8 = ap([{ op:'text_add', layer:'TopOverlay', text:'A', x:1, y:1, h:1, owner:'U1' },
                 { op:'track_add', layer:'Top', x1:0, y1:0, x2:1, y2:0, w:0.2, owner:'U1', keepout:true }]);
  comAviso(m8, /^#1 text_add: owner "U1" ignorado — objeto novo é sempre livre/);
  assert.ok(m8.added.every(a => !('owner' in a.eff) && !('keepout' in a.eff)));
  /* region_add: a borboleta e recusada pelo motivo certo, e qualquer auto-intersecao tambem */
  comErro(ap([{ op:'region_add', layer:'Top', pts:[[0, 0], [2, 2], [2, 0], [0, 2]] }]), /lados que se cruzam/, 'borboleta (area assinada 0)');
  comErro(ap([{ op:'region_add', layer:'Top', pts:[[0, 0], [4, 0], [4, 4], [1, -1], [0, 4]] }]), /lados que se cruzam/, 'cruzamento com area');
  comErro(ap([{ op:'region_add', layer:'Top', pts:[[0, 0], [4, 0], [4, 4], [2, 0], [0, 4]] }]), /lados que se cruzam/, 'vertice encostando num lado');
  semErro(ap([{ op:'region_add', layer:'Top', pts:[[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]] }]), 'concavo e valido');
  semErro(ap([{ op:'region_add', layer:'Top', pts:[[0, 0], [2, 0], [1, 2], [0, 0]] }]), 'fechamento repetido a mao e valido');
}

/* ================= 4. flip: a convencao do Altium (achado 1) ================= */
/* Medida nos board.js do workspace: Top r -> O + R(r)*local; Bottom r -> O + R(r)*Sy*local, pad a
   r - a. A conta aqui e escrita do zero, independente do motor, e o motor tem de bater com ela. */
const R = (a, x, y) => { const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180); return [x * c - y * s, x * s + y * c]; };
const local = (c, p) => { const [lx, ly] = R(-c.rot, p.x - c.x, p.y - c.y); return c.layer === 'Bottom' ? [lx, -ly] : [lx, ly]; };
const angLocal = (c, a) => c.layer === 'Bottom' ? c.rot - a : a - c.rot;
const mundo = (c, l) => { const [mx, my] = c.layer === 'Bottom' ? [l[0], -l[1]] : l; const [rx, ry] = R(c.rot, mx, my); return [c.x + rx, c.y + ry]; };
const angMundo = (c, la) => c.layer === 'Bottom' ? c.rot - la : c.rot + la;
{
  /* o caso do revisor: U1 em rot 0 vira para o Bottom sem girar -- o pad (1, 0.5) vai para (1, -0.5) */
  const B = { components:[{ ref:'U1', x:0, y:0, rot:0, layer:'Top', pads:[{ name:'1', layer:'Top', type:'smd', x:1, y:0.5, w:1, h:0.5, rot:0 }] }] };
  const vira = (b, de, para) => Core.applyPcbChanges(b, [Object.assign({ op:'comp_move', ref:'U1', orig_x:de.x, orig_y:de.y, orig_rot:de.rot, orig_layer:de.layer }, para)]);
  const eb1 = Core.effectiveBoard(B, vira(B, B.components[0], { x:0, y:0, rot:0, layer:'Bottom' }));
  assert.deepStrictEqual([eb1.components[0].pads[0].x, eb1.components[0].pads[0].y, eb1.components[0].pads[0].rot, eb1.components[0].pads[0].layer], [1, -0.5, 0, 'Bottom']);
  /* ida e volta (Top 0 -> Bottom 90 -> Top 0) e identidade */
  const eb2 = Core.effectiveBoard(B, vira(B, B.components[0], { x:0, y:0, rot:90, layer:'Bottom' }));
  const eb3 = Core.effectiveBoard(eb2, vira(eb2, eb2.components[0], { x:0, y:0, rot:0, layer:'Top' }));
  assert.deepStrictEqual(eb3.components[0].pads[0], B.components[0].pads[0], 'ida e volta devolve o pad');
}
{
  /* todas as rotacoes de origem e de destino, nos dois sentidos, com pad fora do eixo */
  const pads = [{ name:'1', layer:'Top', type:'smd', x:1.5, y:0.4, w:1, h:0.5, rot:30 }, { name:'2', layer:'Top', type:'smd', x:-0.7, y:-1.1, w:0.6, h:0.3, rot:0 }];
  for (const lado of ['Top', 'Bottom']) for (const r0 of [0, 90, 180, 270, 37]) {
    const c0 = { ref:'Q1', x:5, y:7, rot:r0, layer:lado };
    /* os pads da origem pela convencao, a partir de um local fixo */
    c0.pads = pads.map(p => { const [x, y] = mundo(c0, [p.x, p.y]); return Object.assign({}, p, { x, y, rot:n360(angMundo(c0, p.rot)), layer:lado }); });
    const B = { components:[c0] };
    for (const flip of [false, true]) for (const r1 of [0, 90, 180, 270, 128]) {
      const c1 = { x:12, y:-3, rot:r1, layer:flip ? (lado === 'Top' ? 'Bottom' : 'Top') : lado };
      const M = Core.applyPcbChanges(B, [{ op:'comp_move', ref:'Q1', x:c1.x, y:c1.y, rot:c1.rot, layer:c1.layer, orig_x:5, orig_y:7, orig_rot:r0, orig_layer:lado }]);
      semErro(M);
      const pe = Core.effectiveBoard(B, M).components[0].pads;
      c0.pads.forEach((p, i) => {
        const [ex, ey] = mundo(c1, local(c0, p));
        const msg = `Q1 ${lado} ${r0} -> ${c1.layer} ${r1}, pad ${p.name}`;
        assert.ok(near(pe[i].x, ex, 1e-5) && near(pe[i].y, ey, 1e-5), `${msg}: (${pe[i].x}, ${pe[i].y}) esperado (${ex}, ${ey})`);
        assert.ok(mesmoAng(pe[i].rot, angMundo(c1, angLocal(c0, p.rot))), `${msg}: rot ${pe[i].rot}`);
        assert.strictEqual(pe[i].layer, c1.layer);
      });
    }
  }
}
/* placas reais: virar cada componente (e girar) poe cada pad onde a convencao manda */
for (const { nome, board:B } of REAIS) {
  const nRef = {}; for (const c of (B.components || [])) nRef[c.ref] = (nRef[c.ref] || 0) + 1;
  const comps = (B.components || []).filter(c => c && c.pads && c.pads.length && (c.layer === 'Top' || c.layer === 'Bottom') && nRef[c.ref] === 1);
  for (const r1 of [0, 90, 180, 270]) {
    const CH = comps.map(c => ({ op:'comp_move', ref:c.ref, x:c.x + 1, y:c.y - 2, rot:n360(c.rot + r1), layer:c.layer === 'Top' ? 'Bottom' : 'Top',
                                 orig_x:c.x, orig_y:c.y, orig_rot:c.rot, orig_layer:c.layer }));
    const M = Core.applyPcbChanges(B, CH);
    const EBr = Core.effectiveBoard(B, M);
    const porId = new Map(EBr.components.map(c => [c.id, c]));
    for (const c of comps) {
      const ce = porId.get(c.id), c1 = { x:c.x + 1, y:c.y - 2, rot:n360(c.rot + r1), layer:c.layer === 'Top' ? 'Bottom' : 'Top' };
      c.pads.forEach((p, i) => {
        const [ex, ey] = mundo(c1, local(c, p));
        assert.ok(near(ce.pads[i].x, ex, 2e-6) && near(ce.pads[i].y, ey, 2e-6), `${nome}: ${c.ref}.${p.name} virado para rot ${c1.rot}`);
        /* todo comp_move aqui vira de lado: o pad troca de camada pelo par (ha footprint de Top com pad de Bottom) */
        assert.strictEqual(ce.pads[i].layer, Core.flipLayer(p.layer), `${nome}: ${c.ref}.${p.name} camada`);
        if (typeof p.rot === 'number') assert.ok(mesmoAng(ce.pads[i].rot, angMundo(c1, angLocal(c, p.rot))), `${nome}: ${c.ref}.${p.name} rot`);
      });
    }
  }
}
{
  /* arco no flip: o espelho inverte o sentido. R1 em rot 0 vira sem girar: o quarto de cima-direita
     (0..90 em torno de (1,0)) vai para o de baixo-direita (-90..0) */
  const m = Core.applyPcbChanges({ components:[{ ref:'R1', x:0, y:0, rot:0, layer:'Top' }] },
    [{ op:'comp_move', ref:'R1', x:0, y:0, rot:0, layer:'Bottom', orig_x:0, orig_y:0, orig_rot:0, orig_layer:'Top' }]);
  const d = Core.compDelta(m.compByRef['R1']);
  const a = Core.xfArc(d, { cx:1, cy:0, r:1, sa:0, ea:90 });
  assert.deepStrictEqual([a.cx, a.cy, n360(a.sa), n360(a.ea)], [1, 0, 270, 0]);
  /* o ponto do meio do arco transformado tem de ser o transformado do ponto do meio */
  const meio = Core.xfPoint(d, 1 + Math.cos(Math.PI / 4), Math.sin(Math.PI / 4)), am = (a.sa + a.ea) / 2 * Math.PI / 180;
  assert.ok(near(meio.x, a.cx + Math.cos(am)) && near(meio.y, a.cy + Math.sin(am)));
  /* o caso que o test-geom descreve (R1 (10,20) rot 0 Top -> (30,40) rot 90 Bottom): pela convencao,
     o ponto 1 mm a direita vai para (30, 41) e o angulo 0 para 90 */
  const g = Core.applyPcbChanges({ components:[{ ref:'R1', x:10, y:20, rot:0, layer:'Top' }] },
    [{ op:'comp_move', ref:'R1', x:30, y:40, rot:90, layer:'Bottom', orig_x:10, orig_y:20, orig_rot:0, orig_layer:'Top' }]);
  const dg = Core.compDelta(g.compByRef['R1']), pg = Core.xfPoint(dg, 11, 20);
  assert.deepStrictEqual([dg.dr, dg.phi, dg.flip, pg.x, pg.y, Core.xfAngle(dg, 0)], [90, 90, true, 30, 41, 90]);
}

/* ================= 5. effectiveBoard ================= */
/* U1 andou de (10,10) rot 0 Top para (30,20) rot 90 Bottom, e ganhou o nome U7. Pela convencao,
   p' = (30,20) + R(90)*Sy*(p - (10,10)) = (30 + ly, 20 + lx). */
const MUD = [
  { op:'comp_move', ref:'U1', x:30, y:20, rot:90, layer:'Bottom', orig_x:10, orig_y:10, orig_rot:0, orig_layer:'Top' },
  { op:'comp_attr', ref:'U1', designator:'U7', comment:'CI novo', orig_designator:'U1', orig_comment:'CI' },
  trk(T1, { op:'track_edit', layer:'TopOverlay' }),
  trk(S3, { op:'track_edit', layer:'Mech1', y2:31 }),
  { op:'fill_del', id:'f2', orig_x1:30, orig_y1:2, orig_x2:34, orig_y2:4, orig_layer:'Top' },
  { op:'region_del', id:'g1', orig_layer:'Top', orig_n:4, orig_x0:40, orig_y0:20 },
  { op:'text_edit', id:'x2', text:'REV B', orig_x:40, orig_y:5, orig_text:'REV A', orig_layer:'TopOverlay' },
  { op:'via_del', id:'v1', orig_x:5, orig_y:5 },
  { op:'track_add', layer:'TopOverlay', x1:1, y1:1, x2:2, y2:1, w:0.2 },
  { op:'track_add', layer:'Top', x1:1, y1:3, x2:2, y2:3, w:0.3, net:'GND' },
  { op:'arc_add', layer:'Mech1', cx:5, cy:5, r:1, sa:0, ea:90, w:0.1 },
  { op:'via_add', x:7, y:7, size:0.6, drill:0.3, net:'GND' },
  { op:'fill_add', layer:'Top', x1:1, y1:1, x2:3, y2:2 },
  { op:'region_add', layer:'Bottom', net:'VCC', pts:[[0, 0], [2, 0], [1, 2]] },
  { op:'region_add', cutout:true, pts:[[30, 30], [32, 30], [32, 32], [30, 32]] },
  { op:'text_add', layer:'BottomOverlay', text:'LOTE', x:20, y:2, h:1, mirror:true },
];
const MOD = ap(MUD);
semErro(MOD, 'lista de mudancas da placa sintetica');
const EB = Core.effectiveBoard(SB, MOD);
{
  const u = EB.components.find(c => c.id === 'c1');
  assert.deepStrictEqual([u.ref, u.comment, u.x, u.y, u.rot, u.layer], ['U7', 'CI novo', 30, 20, 90, 'Bottom']);
  assert.deepStrictEqual(u.bbox, { x1:28, y1:18, x2:32, y2:22 }, 'bbox transformado');
  const [p1, p2] = u.pads;
  nearPt([p1.x, p1.y], 30, 21, 'pad SMD');
  assert.deepStrictEqual([p1.layer, p1.rot, p1.sm, 'tentTop' in p1, p1.tentBot], ['Bottom', 90, 0.05, false, false], 'SMD virou para o Bottom, tenting acompanha');
  nearPt([p2.x, p2.y], 30, 19, 'pad passante');
  assert.deepStrictEqual([p2.layer, p2.w, p2.h, p2.shape, p2.bw, p2.bh, p2.bshape, p2.tentTop, p2.tentBot, p2.holerot],
                         ['Multi', 2, 2, 'circle', 1.6, 1.6, 'rect', false, true, 270], 'pilha top/bottom troca no flip; holerot e relativo ao pad');
  assert.deepStrictEqual(EB.components.find(c => c.id === 'c2'), SB.components[1], 'componente parado sai identico');
  /* objetos do componente acompanham: trilha de cobre, silk, arco, linha mecanica, fill, region, designator */
  const t2 = EB.tracks.find(t => t.id === 't2');
  nearPt([t2.x1, t2.y1], 30, 21, 't2 p1'); nearPt([t2.x2, t2.y2], 32, 21, 't2 p2');
  assert.deepStrictEqual([t2.layer, t2.owner, t2.net], ['Bottom', 'U7', 'GND']);
  const s1 = EB.silk.find(s => s.id === 's1');
  nearPt([s1.x1, s1.y1], 31, 19, 's1 p1'); nearPt([s1.x2, s1.y2], 31, 21, 's1 p2');
  assert.deepStrictEqual([s1.layer, s1.owner, s1.kind], ['BottomOverlay', 'U7', 'line']);
  const s2 = EB.silk.find(s => s.id === 's2');
  assert.deepStrictEqual([s2.cx, s2.cy, s2.sa, s2.ea, s2.layer], [30, 20, 0, 360, 'BottomOverlay'], 'circulo continua circulo');
  const l2 = EB.lines.find(s => s.id === 'l2');
  nearPt([l2.x1, l2.y1], 28, 18, 'l2 p1'); nearPt([l2.x2, l2.y2], 28, 22, 'l2 p2');
  assert.strictEqual(l2.layer, 'Mech15', 'mecanica sem par na placa: fica');
  const f1 = EB.fills.find(f => f.id === 'f1');
  assert.deepStrictEqual([f1.x1, f1.y1, f1.x2, f1.y2, f1.rot, f1.layer, f1.owner], [27.5, 19.5, 29.5, 20.5, 90, 'BottomOverlay', 'U7']);
  const g3 = EB.regions.find(g => g.id === 'g3');
  assert.deepStrictEqual([g3.points, g3.layer, g3.owner], [[[29, 19], [29, 21], [31, 21]], 'BottomSolder', 'U7']);
  /* designator acima do U1, lendo para +X: depois do flip le para +Y com o "em pe" para +X ->
     espelhado em rot 270 (o espelho do texto do Altium e o horizontal) */
  const x1 = EB.texts.find(t => t.id === 'x1');
  assert.deepStrictEqual([x1.x, x1.y, x1.rot, x1.mirror, x1.layer, x1.text, x1.owner], [32, 20, 270, true, 'BottomOverlay', 'U7', 'U7']);
  /* livres: efetivos, removidos fora, adicionados dentro, cada um no array da camada */
  assert.ok(!EB.tracks.some(t => t.id === 't1') && EB.silk.some(t => t.id === 't1'));
  const s3 = EB.lines.find(t => t.id === 's3');
  assert.deepStrictEqual([s3.layer, s3.kind, s3.y2], ['Mech1', 'line', 31], 'silk que foi para a Mech1 sai em lines');
  assert.ok(EB.lines.some(t => t.id === 'l4' && t.keepout && t.layer === 'Top'), 'o que nao mudou fica no array de onde veio');
  assert.ok(!EB.fills.some(f => f.id === 'f2') && !EB.regions.some(g => g.id === 'g1') && !EB.vias.some(v => v.id === 'v1'));
  assert.strictEqual(EB.texts.find(t => t.id === 'x2').text, 'REV B');
  const novos = EB.tracks.filter(t => /^new-/.test(t.id));
  assert.deepStrictEqual(novos.map(t => [t.layer, t.net]), [['Top', 'GND']]);
  assert.ok(EB.silk.some(t => /^new-/.test(t.id) && t.kind === 'line' && !('net' in t)));
  assert.ok(EB.lines.some(t => /^new-/.test(t.id) && t.kind === 'arc' && t.layer === 'Mech1'));
  assert.ok(EB.vias.some(v => /^new-/.test(v.id) && v.from === 'Top' && v.to === 'Bottom' && v.net === 'GND'));
  assert.ok(EB.fills.some(f => /^new-/.test(f.id) && f.net === ''), 'fill novo em cobre leva net (vazia)');
  assert.ok(EB.regions.some(g => /^new-/.test(g.id) && g.layer === 'Bottom' && g.net === 'VCC'));
  assert.deepStrictEqual(EB.cutouts.map(k => k.id).length, 2);
  assert.deepStrictEqual(EB.cutouts[1].points, [[30, 30], [32, 30], [32, 32], [30, 32]]);
  const nt = EB.texts.find(t => /^new-/.test(t.id));
  assert.deepStrictEqual([nt.text, nt.layer, nt.mirror, nt.w, nt.kind, 'font' in nt], ['LOTE', 'BottomOverlay', true, 0.1, 'stroke', false]);
  /* intocados: copia identica, mas copia (mexer no efetivo nao estraga o board) */
  assert.deepStrictEqual(EB.arcs, SB.arcs);
  assert.deepStrictEqual(EB.freepads, SB.freepads);
  assert.deepStrictEqual([EB.nets, EB.layers, EB.rules, EB.exporter], [SB.nets, SB.layers, SB.rules, SB.exporter]);
  assert.deepStrictEqual(EB.board, SB.board, 'contorno nao mudou: bbox do espelho');
  EB.arcs[0].r = 99; EB.layers[0].name = 'x';
  assert.strictEqual(SB.arcs[0].r, 2); assert.strictEqual(SB.layers[0].name, 'Top Layer');
  EB.arcs[0].r = 2; EB.layers[0].name = 'Top Layer';
  for (const k of ['components', 'tracks', 'silk', 'lines', 'fills', 'regions', 'cutouts', 'texts', 'vias'])
    assert.strictEqual(EB.stats[k], EB[k].length, 'stats.' + k);
}
/* keepout de cobre que muda continua no array do cobre, com a flag (contrato secao 2, ajuste pos-pesquisa) */
{
  const b = placa(); b.tracks.push({ id:'t3', layer:'Top', x1:2, y1:2, x2:3, y2:2, w:0.3, net:'', keepout:true });
  const eb = Core.effectiveBoard(b, Core.applyPcbChanges(b, [trk(b.tracks[2], { op:'track_edit', x2:4 }), trk(b.lines[3], { op:'track_edit', w:0.6 })]));
  assert.ok(eb.tracks.some(t => t.id === 't3' && t.keepout && t.x2 === 4), 'keepout de cobre editado fica em tracks');
  assert.ok(eb.tracks.some(t => t.id === 'l4' && t.keepout && t.w === 0.6) && !eb.lines.some(t => t.id === 'l4'), 'linha keepout no cobre que muda vai para tracks');
}
/* par mecanico da placa: o courtyard do componente virado vai para a mecanica par (achado 11) */
{
  const b = placa(); b.layers.push({ key:'Mech16', name:'Bottom Courtyard', pair:'Mech15' });
  const eb = Core.effectiveBoard(b, Core.applyPcbChanges(b, [MUD[0]]));
  assert.strictEqual(eb.lines.find(s => s.id === 'l2').layer, 'Mech16');
  assert.strictEqual(Core.xfObject(Core.ownerDelta(Core.applyPcbChanges(b, [MUD[0]]), 'U1'), b.lines[1], 'line').layer, 'Mech16');
}
/* texto com o contorno exato do Altium (polys) e ancora (ax/ay): anda com o componente; se so a
   posicao muda, anda junto; se muda o desenho, sai (a HubFont assume) */
{
  const b = placa();
  b.texts[0].polys = [{ hole:false, pts:[[9.6, 11.6], [10.4, 11.6], [10.4, 12.4]] }]; b.texts[0].ax = 9.6; b.texts[0].ay = 11.6;
  b.texts[1].polys = [{ hole:false, pts:[[39, 4.5], [41, 4.5], [41, 5.5]] }]; b.texts[1].ax = 39; b.texts[1].ay = 4.5;
  b.texts[2].polys = [{ hole:false, pts:[[39.5, 9.5], [40.5, 9.5], [40.5, 10.5]] }];
  const tx = (t, extra) => Object.assign({ op:'text_edit', id:t.id, orig_x:t.x, orig_y:t.y, orig_text:t.text, orig_layer:t.layer }, extra);
  const m = Core.applyPcbChanges(b, [MUD[0], tx(b.texts[1], { x:41, y:6 }), tx(b.texts[2], { h:2 })]);
  semErro(m);
  const eb = Core.effectiveBoard(b, m);
  const [e1, e2, e3] = eb.texts;
  assert.deepStrictEqual([e1.ax, e1.ay, e1.polys[0].pts], [31.6, 19.6, [[31.6, 19.6], [31.6, 20.4], [32.4, 20.4]]], 'contorno do designator anda com o U1 virado');
  assert.deepStrictEqual([e2.ax, e2.ay, e2.polys[0].pts], [40, 5.5, [[40, 5.5], [42, 5.5], [42, 6.5]]], 'so a posicao: anda junto');
  assert.ok(!('polys' in e3) && !('ax' in e3), 'altura mudou: o contorno nao vale mais');
  /* renomear o componente muda o texto do designator: o contorno sai */
  const ebr = Core.effectiveBoard(b, Core.applyPcbChanges(b, [MUD[1]]));
  assert.ok(!('polys' in ebr.texts[0]));
  idem0(b, 'placa com polys');
  /* designator/comment cujo texto cru nao e o ref (o ".Designator" do espelho antigo) nao perde o
     contorno so por sair com o texto efetivo; o comment trocado por comp_attr perde */
  const pr = [{ hole:false, pts:[[29, 31], [31, 31], [31, 32]] }];
  b.texts.push({ id:'x4', layer:'TopOverlay', x:30, y:31.5, text:'.Designator', h:1, rot:0, mirror:false, designator:true, comment:false, owner:'R2', polys:dcp(pr) },
               { id:'x5', layer:'TopOverlay', x:30, y:28.5, text:'1k', h:1, rot:0, mirror:false, designator:false, comment:true, owner:'R2', polys:dcp(pr) });
  const e0 = Core.effectiveBoard(b);
  assert.deepStrictEqual([e0.texts[3].text, e0.texts[3].polys, e0.texts[4].polys], ['R2', pr, pr]);
  const ec = Core.effectiveBoard(b, Core.applyPcbChanges(b, [{ op:'comp_attr', ref:'R2', comment:'2k2', orig_designator:'R2', orig_comment:'1k' }]));
  assert.deepStrictEqual([ec.texts[3].polys, ec.texts[4].text, 'polys' in ec.texts[4]], [pr, '2k2', false]);
  idem0(b, 'placa com polys e .Designator');
}
function idem0(b, nome){ const e0 = Core.effectiveBoard(b); assert.deepStrictEqual(Core.effectiveBoard(e0), e0, 'idempotente sem mudancas: ' + nome); }
function dcp(v){ return JSON.parse(JSON.stringify(v)); }
/* recorte com owner (espelho novo) anda com o componente */
{
  const b = placa(); b.cutouts.push({ id:'k2', layer:'Multi', incomp:true, owner:'U1', points:[[9, 11], [9.5, 11], [9.5, 11.5]] });
  const eb = Core.effectiveBoard(b, Core.applyPcbChanges(b, [MUD[0], MUD[1]]));
  const k2 = eb.cutouts.find(k => k.id === 'k2');
  assert.deepStrictEqual([k2.points, k2.layer, k2.owner], [[[31, 19], [31, 19.5], [31.5, 19.5]], 'Multi', 'U7']);
}
/* xfObject: a mesma conta do effectiveBoard, para a tela desenhar o objeto do componente movido */
{
  const d = Core.ownerDelta(MOD, 'U1');
  assert.ok(d && d.flip);
  const semDono = o => { const c = Object.assign({}, o); delete c.owner; return c; };
  const de = (arr, id) => semDono(EB[arr].find(o => o.id === id));
  assert.deepStrictEqual(Core.xfObject(d, SB.components[0].pads[1], 'pad'), EB.components[0].pads[1]);
  assert.deepStrictEqual(semDono(Core.xfObject(d, SB.silk[0], 'line')), de('silk', 's1'));
  assert.deepStrictEqual(semDono(Core.xfObject(d, SB.silk[1], 'arc')), de('silk', 's2'));
  assert.deepStrictEqual(semDono(Core.xfObject(d, SB.fills[0], 'fill')), de('fills', 'f1'));
  assert.deepStrictEqual(semDono(Core.xfObject(d, SB.regions[2], 'region')), de('regions', 'g3'));
  assert.deepStrictEqual(semDono(Core.xfObject(d, SB.tracks[1], 'track')), de('tracks', 't2'));
  const tx = semDono(Core.xfObject(d, SB.texts[0], 'text'));
  assert.deepStrictEqual(Object.assign(tx, { text:'U7' }), de('texts', 'x1'));
  const copia = Core.xfObject(null, SB.fills[0], 'fill');
  assert.deepStrictEqual(copia, SB.fills[0]);
  assert.notStrictEqual(copia, SB.fills[0], 'sem delta devolve copia, nunca o objeto do board');
  assert.strictEqual(SB.silk[0].x1, 9, 'xfObject nao mexe no original');
  /* pilha do pad na grafia `bot` do contrato */
  const pb = { name:'1', layer:'Multi', type:'th', shape:'rect', x:9, y:10, w:1.6, h:1.6, rot:0, bot:{ w:2, shape:'circle' }, hox:0.2, hoy:0.3 };
  const xb = Core.xfObject(d, pb, 'pad');
  assert.deepStrictEqual([xb.w, xb.h, xb.shape, xb.bot], [2, 1.6, 'circle', { w:1.6, shape:'rect' }]);
  /* furo deslocado (hox/hoy no referencial do pad): o cobre (furo + R(rot)*offset) cai onde a
     transformacao do componente leva o cobre de antes */
  const cobre = p => { const [gx, gy] = R(p.rot, p.hox, p.hoy); return [p.x + gx, p.y + gy]; };
  const ant = Core.xfPoint(d, ...cobre(pb));
  nearPt(cobre(xb), ant.x, ant.y, 'cobre do pad com furo deslocado');
  assert.deepStrictEqual([xb.hox, xb.hoy], [0.2, -0.3]);
}
/* idempotencia: a placa efetiva passada de novo pelo motor, sem mudancas, e a mesma placa */
const idem = (eb, nome) => assert.deepStrictEqual(Core.effectiveBoard(eb, Core.applyPcbChanges(eb, [])), eb, 'idempotente: ' + nome);
idem(EB, 'placa sintetica');
{
  const demo = loadVar('Projects/_DemoKit/board.js', 'pcbmirror');
  const ebd = Core.effectiveBoard(demo, Core.applyPcbChanges(demo, loadVar('Projects/_DemoKit/changes.js', 'changes')));
  idem(ebd, '_DemoKit');
  const d1 = ebd.components.find(c => c.ref === 'D1');
  assert.deepStrictEqual([d1.y, d1.pads[0].y], [11, 11], 'D1 desceu com os pads');
  assert.ok(ebd.tracks.some(t => /^new-/.test(t.id)) && ebd.vias.some(v => /^new-/.test(v.id)));
  assert.deepStrictEqual(ebd.fills, []); assert.deepStrictEqual(ebd.lines, []);
  assert.strictEqual(ebd.texts.find(t => t.owner === 'P1').text, 'P1', 'designator sai com o texto efetivo (a regra da tela)');
}
/* placas reais: sem mudancas sai identica ao board.js (fora o texto de designator/comment, que sai
   efetivo, e o stats, que e recontado); com mudancas, idempotente e sem dividir nada com o board */
for (const { nome, board:B } of REAIS) {
  const eb0 = Core.effectiveBoard(B);
  for (const k of Object.keys(B)) {
    if (k === 'stats') continue;
    /* sem bbox no espelho, a placa efetiva a calcula do contorno: o resto do board tem de bater */
    if (k === 'board' && B.board && !B.board.bbox) { const c = Object.assign({}, eb0.board); delete c.bbox; assert.deepStrictEqual(c, B.board, nome + ': board'); continue; }
    if (k === 'texts') {
      const tira = arr => arr.map(t => { const c = Object.assign({}, t); if (c.designator || c.comment) delete c.text; return c; });
      assert.deepStrictEqual(tira(eb0.texts), tira(B.texts), nome + ': texts');
    } else assert.deepStrictEqual(eb0[k], B[k], nome + ': ' + k);
  }
  const nRef = {}; for (const c of (B.components || [])) nRef[c.ref] = (nRef[c.ref] || 0) + 1;
  const comps = (B.components || []).filter(c => (c.layer === 'Top' || c.layer === 'Bottom') && nRef[c.ref] === 1);
  const livre = (B.silk || []).find(s => !s.owner && s.kind === 'line');
  const ch = comps.slice(0, 3).map((c, i) => ({ op:'comp_move', ref:c.ref, x:c.x + 1, y:c.y, rot:n360(c.rot + 90 * i), layer:i === 1 ? c.layer : (c.layer === 'Top' ? 'Bottom' : 'Top'),
                                                orig_x:c.x, orig_y:c.y, orig_rot:c.rot, orig_layer:c.layer }));
  let nomeNovo = comps[0] ? comps[0].ref + 'N' : '';
  while (nomeNovo && (B.components || []).some(c => c.ref === nomeNovo)) nomeNovo += 'N';
  if (comps[0]) ch.push({ op:'comp_attr', ref:comps[0].ref, designator:nomeNovo, orig_designator:comps[0].ref, orig_comment:comps[0].comment || '' });
  if (livre) ch.push(trk(livre, { op:'track_edit', layer:'BottomOverlay', x1:livre.x1 + 0.5 }));
  ch.push({ op:'outline_set', pts:[[0, 0], [110, 0], [110, 120], [0, 120]] });
  ch.push({ op:'text_add', layer:'TopOverlay', text:'REV D', x:50, y:5, h:1.5 });
  const md = Core.applyPcbChanges(B, ch);
  semErro(md, nome);
  const ebm = Core.effectiveBoard(B, md);
  idem(ebm, nome + ' com mudancas');
  assert.deepStrictEqual(ebm.board.bbox, { x1:0, y1:0, x2:110, y2:120 }, nome + ': contorno mudou, bbox recalculado');
  const doB = new Set(), olha = (o) => { if (o && typeof o === 'object' && !doB.has(o)) { doB.add(o); for (const k in o) olha(o[k]); } };
  olha(B);
  const vaza = [];
  (function anda(o){ if (o && typeof o === 'object') { if (doB.has(o)) vaza.push(o); else for (const k in o) anda(o[k]); } })(ebm);
  assert.strictEqual(vaza.length, 0, nome + ': a placa efetiva nao divide objeto com o board');
}
/* model de outro objeto board: erro claro em vez de mudanca sumindo calada */
assert.throws(() => Core.effectiveBoard(placa(), MOD), /não foi gerado deste board/);
/* sem model = sem mudancas */
assert.deepStrictEqual(Core.effectiveBoard(SB), Core.effectiveBoard(SB, ap([])));
/* board vazio nao quebra */
{
  const e = Core.effectiveBoard({});
  assert.deepStrictEqual([e.components, e.tracks, e.silk, e.lines, e.fills, e.cutouts, e.board.outline], [[], [], [], [], [], [], []]);
  assert.deepStrictEqual(Core.boardLayers({}).map(l => l.key), SEMPRE);
}

/* ================= 6. serializeChanges das ops novas ================= */
{
  const todas = [
    { op:'fill_add', layer:'Top', x1:1, y1:1, x2:2, y2:2, rot:0, net:'GND', note:'retangulo cheio' },
    { op:'fill_edit', id:'f2', x1:31, orig_x1:30, orig_y1:2, orig_x2:34, orig_y2:4, orig_layer:'Top' },
    { op:'fill_del', id:'f2', orig_x1:30, orig_y1:2, orig_x2:34, orig_y2:4, orig_layer:'Top' },
    { op:'region_add', layer:'Top', net:'GND', pts:[[0, 0], [2, 0], [1, 2]], note:'triangulo' },
    { op:'region_add', cutout:true, pts:[[0, 0], [2, 0], [2, 2], [0, 2]] },
    { op:'region_del', id:'g1', orig_layer:'Top', orig_n:4, orig_x0:40, orig_y0:20 },
    { op:'text_add', layer:'TopOverlay', text:'V1', x:1, y:1, h:1, w:0.1, rot:90, mirror:false },
    { op:'text_del', id:'x2', orig_x:40, orig_y:5, orig_text:'REV A', orig_layer:'TopOverlay' },
    { op:'track_add', layer:'Mech1', x1:0, y1:0, x2:1, y2:0, w:0.1 },
    { op:'text_edit', id:'x2', layer:'BottomOverlay', mirror:true, orig_x:40, orig_y:5, orig_text:'REV A', orig_layer:'TopOverlay' },
  ];
  const out = Core.serializeChanges(todas);
  assert.deepStrictEqual(out.errors, []);
  assert.deepStrictEqual(new Function(out.text + ';return changes;')(), todas, 'round-trip das ops novas');
  for (const ln of out.text.trim().split('\n').slice(3, -1)) JSON.parse(ln.slice(0, -1));
  const falha = (ch, re) => { const r = Core.serializeChanges([ch]); assert.strictEqual(r.text, null, JSON.stringify(ch));
                              assert.ok(r.errors.some(e => re.test(e.msg)), r.errors.map(e => e.msg).join(' | ')); };
  falha({ op:'fill_add', layer:'Top', x1:1, y1:1, x2:2 }, /"y2"/);
  falha({ op:'fill_add', x1:1, y1:1, x2:2, y2:2 }, /"layer"/);
  falha({ op:'fill_add', layer:'Top', x1:1, y1:1, x2:1, y2:2 }, /sem area/);
  /* a mesma tolerancia do motor: o que ele recusa o serializador tambem recusa */
  falha({ op:'fill_add', layer:'Top', x1:1, y1:1, x2:1.0005, y2:2 }, /sem area/);
  falha({ op:'fill_edit', id:'f2', orig_x1:30, orig_y1:2, orig_x2:34, orig_layer:'Top' }, /"orig_y2"/);
  falha({ op:'fill_del', orig_x1:30, orig_y1:2, orig_x2:34, orig_y2:4, orig_layer:'Top' }, /"id"/);
  falha({ op:'region_add', layer:'Top', pts:[[0, 0], [1, 1]] }, /pts deve ser/);
  falha({ op:'region_add', layer:'Top', pts:[[0, 0], [1, 'a'], [2, 2]] }, /pts deve ser/);
  falha({ op:'region_add', pts:[[0, 0], [2, 0], [1, 2]] }, /"layer"/);
  falha({ op:'region_del', id:'g1', orig_layer:'Top', orig_x0:1, orig_y0:1 }, /"orig_n"/);
  falha({ op:'text_add', layer:'TopOverlay', text:'A', x:1, y:1, h:0 }, /h deve ser > 0/);
  falha({ op:'text_add', layer:'TopOverlay', text:'A', x:1, y:1, h:1, w:0 }, /w deve ser > 0/);
  falha({ op:'text_add', layer:'TopOverlay', x:1, y:1, h:1 }, /"text"/);
  falha({ op:'text_add', layer:'TopOverlay', text:'a": b', x:1, y:1, h:1 }, /aspas-dois-pontos/);
  falha({ op:'text_del', id:'x2', orig_x:40, orig_y:5, orig_layer:'TopOverlay' }, /"orig_text"/);
}

/* ================= 7. fora da PCB, achado da mesma revisao: FORMULA_RE ================= */
/* o \b do regex tinha virado o caractere de controle 0x08 cru no arquivo, e "Value"/"Voltage" sem
   o "=" nunca era reconhecido como formula do Altium */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'hub-core.js'), 'utf8');
  assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(src), 'hub-core.js sem caractere de controle cru');
  const LISTA = [{ name:'VALUE VOLTAGE', parts:[{ pins:[] }] }];
  for (const f of ["Value + ' ' + Voltage", 'Volts', '=Value']) {
    const r = Core.suggestSym({ sym:'X', ref:'C1', comment:f }, LISTA, { limit:3 });
    assert.ok(!r.some(x => x.porque.some(p => /comment/.test(p))), `"${f}" e formula, nao pode contar como comment`);
  }
  assert.ok(Core.suggestSym({ sym:'X', ref:'C1', comment:'VOLTAGEM VALUES' }, [{ name:'VOLTAGEM VALUES', parts:[{ pins:[] }] }], { limit:3 })
              .some(x => x.porque.some(p => /comment/.test(p))), 'palavra que so comeca igual (VOLTAGEM, VALUES) continua sendo comment');
}

console.log('test-pcb-ops OK');
