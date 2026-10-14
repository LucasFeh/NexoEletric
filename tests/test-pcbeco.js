/* Placa nova e ECO (2026-10-13): as ops novas do changes.js (comp_add, comp_del, pad_net,
   net_add/net_del/net_rename, pad_add/pad_edit/pad_del, comment_move, outline_set com arco,
   poly_add/poly_edit/poly_del), o ECO do hub-pcbeco contra os projetos reais e a placa nova do
   hub-pcbnova de ponta a ponta com o LM555.

   Como no test-pcb-ops: numero exato so em placa sintetica; placa real entra em propriedade que
   vale para qualquer placa (idempotencia, o ECO sem erro de execucao, o que ele NAO pode acusar). */
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { loadVar } = require('./load');
const HC = require('../hub-core.js');
const Eco = require('../hub-pcbeco.js');
const Nova = require('../hub-pcbnova.js');

const near = (a, b, t) => Math.abs(a - b) <= (t || 1e-6);
const erros = m => m.validation.filter(v => v.level === 'err');
const avisos = m => m.validation.filter(v => v.level === 'warn');
const semErro = (m, msg) => assert.strictEqual(erros(m).length, 0, (msg || '') + ' ' + erros(m).map(v => v.msg).join(' | '));
const comErro = (m, re, msg) => assert.ok(erros(m).some(v => re.test(v.msg)), (msg || '') + ' — ' + m.validation.map(v => v.msg).join(' | '));
const comAviso = (m, re, msg) => assert.ok(avisos(m).some(v => re.test(v.msg)), (msg || '') + ' — ' + m.validation.map(v => v.level + ' ' + v.msg).join(' | '));
const idem = (eb, nome) => assert.deepStrictEqual(HC.effectiveBoard(eb, HC.applyPcbChanges(eb, [])), eb, 'idempotente: ' + nome);
/* serializa, le de volta como o parser do hub, e confere uma linha por objeto */
function ida(changes){
  const s = HC.serializeChanges(changes);
  assert.deepStrictEqual(s.errors, [], JSON.stringify(s.errors));
  const corpo = s.text.split('\n').filter(l => l.startsWith('{'));
  assert.strictEqual(corpo.length, changes.length, 'uma linha por objeto');
  for (const l of corpo) assert.ok(l.endsWith('},') && !/\n/.test(l));
  return new Function(s.text + ';return changes;')();
}

HC.setLibTables(loadVar('Libs/rename-map.js', 'renameMap'), loadVar('Libs/lib-subs.js', 'libSubs'));
const pcblib = loadVar('Libs/pcblib.js', 'pcblib');
const schlib = loadVar('Libs/schlib.js', 'schlib');

/* ---------- placa sintetica ---------- */
const FP = { name:'TESTE2', bbox:{ x1:-2, y1:-1, x2:2, y2:1 },
             pads:[{ name:'1', type:'smd', shape:'rect', x:-1, y:0, w:1, h:1.2, rot:0, layer:'Top' },
                   { name:'2', type:'th', shape:'circle', x:1, y:0, w:1.6, h:1.6, rot:0, layer:'Multi', drillshape:'circle', drill:0.8, holerot:0 }],
             silk:[{ kind:'line', x1:-2, y1:1, x2:2, y2:1, w:0.2 }, { kind:'arc', cx:0, cy:0, r:0.5, sa:0, ea:90, w:0.2 }] };
const LIB = { footprints:[FP] };
function placa(){
  return { format:'pcbmirror-v1', exporter:'teste', units:'mm',
    board:{ bbox:{ x1:0, y1:0, x2:50, y2:40 }, outline:[{ kind:'line', x1:0, y1:0, x2:50, y2:0 }, { kind:'line', x1:50, y1:0, x2:50, y2:40 },
                                                     { kind:'line', x1:50, y1:40, x2:0, y2:40 }, { kind:'line', x1:0, y1:40, x2:0, y2:0 }] },
    nets:['GND', 'VCC'],
    components:[{ id:'c1', ref:'R1', footprint:'TESTE2', comment:'1k', layer:'Top', x:10, y:10, rot:0, bbox:{ x1:8, y1:9, x2:12, y2:11 },
                  pads:[{ id:'c1p1', name:'1', type:'smd', shape:'rect', x:9, y:10, w:1, h:1.2, rot:0, layer:'Top', net:'GND' },
                        { id:'c1p2', name:'2', type:'th', shape:'circle', x:11, y:10, w:1.6, h:1.6, rot:0, layer:'Multi', drillshape:'circle', drill:0.8, holerot:0, net:'VCC' }] }],
    freepads:[{ id:'p1', name:'9', layer:'Multi', type:'th', shape:'circle', x:40, y:30, w:3, h:3, rot:0, drillshape:'circle', drill:1.5, holerot:0, net:'GND' }],
    tracks:[{ id:'t1', layer:'Top', x1:9, y1:10, x2:20, y2:10, w:0.3, net:'GND' }],
    arcs:[], vias:[{ id:'v1', x:20, y:10, size:0.6, drill:0.3, net:'GND' }],
    texts:[{ id:'x1', layer:'TopOverlay', x:10, y:12, text:'R1', h:1, rot:0, mirror:false, designator:true, comment:false, owner:'R1' },
           { id:'x2', layer:'TopOverlay', x:10, y:8, text:'1k', h:1, rot:0, mirror:false, designator:false, comment:true, owner:'R1' }],
    silk:[{ id:'s1', layer:'TopOverlay', kind:'line', x1:8, y1:11, x2:12, y2:11, w:0.2, owner:'R1' }],
    regions:[], fills:[], cutouts:[], stats:{} };
}
const ap = (B, ch, o) => HC.applyPcbChanges(B, ch, o || { pcblib:LIB });

/* ================= comp_add ================= */
{
  const B = placa();
  const ch = [{ op:'comp_add', ref:'U1', footprint:'TESTE2', x:30, y:20, rot:90, layer:'Top', comment:'novo', nets:'1=GND;2=VCC', note:'ECO' }];
  const m = ap(B, ch); semErro(m);
  const eb = HC.effectiveBoard(B, m);
  const u = eb.components.find(c => c.ref === 'U1');
  assert.ok(u && u.footprint === 'TESTE2' && u.comment === 'novo' && u.rot === 90);
  /* pad 1 local (-1,0) girado 90 -> (0,-1) + (30,20) */
  const p1 = u.pads.find(p => p.name === '1'), p2 = u.pads.find(p => p.name === '2');
  assert.ok(near(p1.x, 30) && near(p1.y, 19) && p1.rot === 90 && p1.net === 'GND' && p1.layer === 'Top');
  assert.ok(near(p2.x, 30) && near(p2.y, 21) && p2.net === 'VCC' && p2.plated === true, 'pad passante com cobre > furo = PTH');
  assert.deepStrictEqual(u.bbox, { x1:29, y1:18, x2:31, y2:22 });
  assert.strictEqual(eb.silk.filter(s => s.owner === 'U1').length, 2, 'a serigrafia do footprint vem junto');
  const d = eb.texts.find(t => t.owner === 'U1' && t.designator);
  assert.ok(d && d.text === 'U1' && d.layer === 'TopOverlay' && d.h === 1, 'designator novo');
  assert.strictEqual(m.comps.length, 2, 'entra em model.comps');
  assert.strictEqual(eb.components.length, m.comps.length, 'model.comps[i] <-> eb.components[i]');
  idem(eb, 'comp_add');
  ida(ch);
  /* no Bottom: pads e serigrafia viram, designator espelhado */
  const mb = ap(B, [{ op:'comp_add', ref:'U2', footprint:'TESTE2', x:30, y:20, rot:0, layer:'Bottom' }]); semErro(mb);
  const eb2 = HC.effectiveBoard(B, mb), u2 = eb2.components.find(c => c.ref === 'U2');
  assert.strictEqual(u2.pads.find(p => p.name === '1').layer, 'Bottom');
  assert.ok(eb2.silk.filter(s => s.owner === 'U2').every(s => s.layer === 'BottomOverlay'));
  assert.ok(eb2.texts.find(t => t.owner === 'U2').mirror === true);
  /* comp_move e designator_move valem no componente novo */
  const mm = ap(B, [ch[0], { op:'designator_move', ref:'U1', x:35, y:25, orig_x:d.x, orig_y:d.y },
                    { op:'comp_move', ref:'U1', x:31, y:20, rot:90, layer:'Top', orig_x:30, orig_y:20, orig_rot:90, orig_layer:'Top' }]);
  semErro(mm);
  const ebm = HC.effectiveBoard(B, mm);
  assert.ok(near(ebm.components.find(c => c.ref === 'U1').pads[0].x, 31));
  assert.ok(near(ebm.texts.find(t => t.owner === 'U1').x, 36), 'o designator movido anda com o componente');
  idem(ebm, 'comp_add + moves');
  /* recusas */
  comErro(ap(B, [{ op:'comp_add', ref:'R1', footprint:'TESTE2', x:1, y:1 }]), /já existe/);
  comErro(ap(B, [{ op:'comp_add', ref:'U9', footprint:'NAO EXISTE', x:1, y:1 }]), /não encontrado/);
  comErro(ap(B, [{ op:'comp_add', ref:'U9', footprint:'TESTE2', x:1, y:1, layer:'Mid1' }]), /Top ou Bottom/);
  comErro(ap(B, [{ op:'comp_add', ref:'U9', footprint:'TESTE2', x:1, y:1, nets:'sem-igual' }]), /mal formado/);
  comAviso(ap(B, [{ op:'comp_add', ref:'U9', footprint:'TESTE2', x:1, y:1, nets:'1=NOVA' }]), /não existe.*net_add/);
  comAviso(ap(B, [{ op:'comp_add', ref:'U9', footprint:'TESTE2', x:1, y:1, nets:'7=GND' }]), /não existe\(m\) no footprint/);
  /* sem pcblib: o footprint sai do componente que ja esta na placa (R1 usa TESTE2) */
  const ms = HC.applyPcbChanges(B, [{ op:'comp_add', ref:'U3', footprint:'TESTE2', x:30, y:20, rot:0 }]);
  semErro(ms);
  const u3 = HC.effectiveBoard(B, ms).components.find(c => c.ref === 'U3');
  assert.ok(near(u3.pads.find(p => p.name === '1').x, 29) && near(u3.pads.find(p => p.name === '2').x, 31), 'geometria derivada do R1');
  /* embutido no board (board.footprints) */
  const Be = placa(); Be.components = []; Be.footprints = [FP];
  semErro(HC.applyPcbChanges(Be, [{ op:'comp_add', ref:'U4', footprint:'TESTE2', x:5, y:5 }]));
  /* setPcbLib registra a lib para quem chama sem opts (a vista PCB) */
  const Bv = placa(); Bv.components = [];
  comErro(HC.applyPcbChanges(Bv, [{ op:'comp_add', ref:'U5', footprint:'TESTE2', x:5, y:5 }]), /setPcbLib/);
  HC.setPcbLib(LIB);
  semErro(HC.applyPcbChanges(Bv, [{ op:'comp_add', ref:'U5', footprint:'TESTE2', x:5, y:5 }]));
  HC.setPcbLib(null);
}

/* ================= comp_del ================= */
{
  const B = placa();
  const del = { op:'comp_del', ref:'R1', orig_x:10, orig_y:10, orig_rot:0, orig_layer:'Top', orig_footprint:'TESTE2' };
  const m = ap(B, [del]); semErro(m);
  const eb = HC.effectiveBoard(B, m);
  assert.strictEqual(eb.components.length, 0);
  assert.strictEqual(eb.texts.length, 0, 'designator e comment saem com o componente');
  assert.strictEqual(eb.silk.length, 0);
  assert.strictEqual(eb.tracks.length, 1, 'trilha livre fica');
  assert.strictEqual(m.compsRemovidos.length, 1);
  idem(eb, 'comp_del');
  ida([del]);
  comErro(ap(B, [del, { op:'comp_move', ref:'R1', x:1, y:1, orig_x:10, orig_y:10, orig_rot:0, orig_layer:'Top' }]), /removido pela mudança #1/);
  comErro(ap(B, [del, del]), /já foi removido/);
  comAviso(ap(B, [Object.assign({}, del, { orig_x:11 })]), /não confere/);
  comErro(ap(B, [{ op:'comp_del', ref:'R1' }]), /faltam orig/);
  /* troca de footprint = comp_del + comp_add com o mesmo ref; o novo nao herda os objetos do velho */
  const t = ap(B, [del, { op:'comp_add', ref:'R1', footprint:'TESTE2', x:10, y:10, nets:'1=GND' }]); semErro(t);
  const ebt = HC.effectiveBoard(B, t);
  assert.strictEqual(ebt.components.length, 1); assert.strictEqual(ebt.components[0].id, 'new-c1');
  assert.deepStrictEqual(ebt.texts.map(x => x.id), ['new-c1x'], 'so o designator novo');
  semErro(ap(B, [del, { op:'comp_add', ref:'R1', footprint:'TESTE2', x:10, y:10 },
                 { op:'designator_move', ref:'R1', x:1, y:1, orig_x:10, orig_y:12.3 + 0.5 }]), 'designator_move acha o do componente novo');
  /* componente adicionado e removido no mesmo arquivo: some inteiro */
  const ar = ap(B, [{ op:'comp_add', ref:'U1', footprint:'TESTE2', x:30, y:20 },
                    { op:'comp_del', ref:'U1', orig_x:30, orig_y:20, orig_rot:0, orig_layer:'Top' }]);
  semErro(ar);
  const ebar = HC.effectiveBoard(B, ar);
  assert.ok(!ebar.components.some(c => c.ref === 'U1') && !ebar.silk.some(s => s.owner === 'U1') && !ebar.texts.some(x => x.owner === 'U1'));
}

/* ================= pad_net / nets ================= */
{
  const B = placa();
  const ch = [{ op:'net_add', net:'SINAL' }, { op:'pad_net', ref:'R1', pad:'2', net:'SINAL', orig_net:'VCC' }];
  const m = ap(B, ch); semErro(m);
  const eb = HC.effectiveBoard(B, m);
  assert.deepStrictEqual(eb.nets, ['GND', 'VCC', 'SINAL']);
  assert.strictEqual(eb.components[0].pads[1].net, 'SINAL');
  idem(eb, 'pad_net'); ida(ch);
  comAviso(ap(B, [{ op:'pad_net', ref:'R1', pad:'2', net:'X', orig_net:'VCC' }]), /net_add/);
  comAviso(ap(B, [{ op:'pad_net', ref:'R1', pad:'2', net:'GND', orig_net:'OUTRA' }]), /orig_net não confere/);
  comErro(ap(B, [ch[1], { op:'pad_net', ref:'R1', pad:'2', net:'GND', orig_net:'VCC' }]), /orig_\* não confere|orig_net/);
  comErro(ap(B, [{ op:'pad_net', ref:'R1', pad:'7', net:'GND', orig_net:'' }]), /pad "7" não existe/);
  semErro(ap(B, [{ op:'pad_net', ref:'R1', pad:'2', net:'', orig_net:'VCC' }]), 'tirar da net');
  comErro(ap(B, [{ op:'net_add', net:'GND' }]), /já existe/);
  comErro(ap(B, [{ op:'net_del', net:'NAO' }]), /não existe/);
  /* net_del: objetos da net ficam sem net */
  const md = ap(B, [{ op:'net_del', net:'GND' }]); semErro(md);
  const ebd = HC.effectiveBoard(B, md);
  assert.deepStrictEqual(ebd.nets, ['VCC']);
  assert.ok(ebd.tracks[0].net === '' && ebd.vias[0].net === '' && ebd.freepads[0].net === '' && ebd.components[0].pads[0].net === '');
  idem(ebd, 'net_del');
  /* net_rename: tudo segue o nome novo, inclusive o orig_net do pad_net seguinte */
  const mr = ap(B, [{ op:'net_rename', net:'0V', orig_net:'GND' }, { op:'pad_net', ref:'R1', pad:'2', net:'0V', orig_net:'VCC' }]); semErro(mr);
  const ebr = HC.effectiveBoard(B, mr);
  assert.deepStrictEqual(ebr.nets, ['0V', 'VCC']);
  assert.ok(ebr.tracks[0].net === '0V' && ebr.components[0].pads.every(p => p.net === '0V'));
  semErro(ap(B, [{ op:'net_rename', net:'0V', orig_net:'GND' }, { op:'pad_net', ref:'R1', pad:'1', net:'VCC', orig_net:'GND' }]),
          'orig_net com o nome de antes tambem confere');
  comErro(ap(B, [{ op:'net_rename', net:'VCC', orig_net:'GND' }]), /já existe/);
  ida([{ op:'net_rename', net:'0V', orig_net:'GND' }, { op:'net_del', net:'VCC' }]);
  /* placa sem nada de net: identica ao board (o generico nao muda) */
  assert.deepStrictEqual(HC.effectiveBoard(B).nets, B.nets);
}

/* ================= pad_add / pad_edit / pad_del ================= */
{
  const B = placa();
  const ch = [{ op:'pad_add', type:'npth', shape:'circle', x:5, y:5, w:3.2, h:3.2, drill:3.2, note:'furo' },
              { op:'pad_add', type:'smd', shape:'roundrect', x:6, y:6, w:1, h:2, radius:0.1, layer:'Bottom', net:'GND', name:'TP1' },
              { op:'pad_add', type:'th', shape:'oval', x:7, y:7, w:2, h:3, drill:1, drillshape:'oblong', drillw:1.6, rot:45, net:'VCC' }];
  const m = ap(B, ch); semErro(m);
  const eb = HC.effectiveBoard(B, m);
  assert.strictEqual(eb.freepads.length, 4);
  const [, n, s, t] = eb.freepads;
  assert.ok(n.type === 'th' && n.plated === false && n.layer === 'Multi' && n.net === '' && n.drill === 3.2);
  assert.ok(s.type === 'smd' && s.layer === 'Bottom' && s.radius === 0.1 && s.net === 'GND' && s.name === 'TP1' && !('drill' in s));
  assert.ok(t.plated === true && t.drillshape === 'oblong' && t.drillw === 1.6 && t.rot === 45);
  idem(eb, 'pad_add'); ida(ch);
  comErro(ap(B, [{ op:'pad_add', type:'xx', x:1, y:1, w:1, h:1 }]), /type/);
  comErro(ap(B, [{ op:'pad_add', type:'th', x:1, y:1, w:1, h:1 }]), /drill/);
  comErro(ap(B, [{ op:'pad_add', type:'smd', x:1, y:1, w:1, h:1, layer:'Multi' }]), /Top ou no Bottom/);
  comErro(ap(B, [{ op:'pad_add', type:'th', x:1, y:1, w:2, h:2, drill:1, drillshape:'rect' }]), /drillw/);
  comAviso(ap(B, [{ op:'pad_add', type:'npth', x:1, y:1, w:2, h:2, drill:2, net:'GND' }]), /NPTH não tem net/);
  comAviso(ap(B, [{ op:'pad_add', type:'th', x:1, y:1, w:1, h:1, drill:1 }]), /anel nulo/);
  /* edit e del do pad solto do board */
  const pe = { op:'pad_edit', id:'p1', x:41, w:4, h:4, net:'VCC', orig_x:40, orig_y:30 };
  const me = ap(B, [pe]); semErro(me);
  const pp = HC.effectiveBoard(B, me).freepads[0];
  assert.ok(pp.x === 41 && pp.w === 4 && pp.net === 'VCC' && pp.y === 30 && pp.drill === 1.5);
  idem(HC.effectiveBoard(B, me), 'pad_edit'); ida([pe]);
  comErro(ap(B, [{ op:'pad_edit', id:'p1', type:'smd', orig_x:40, orig_y:30 }]), /troca de tipo/);
  comErro(ap(B, [{ op:'pad_edit', id:'c1p1', x:1, orig_x:9, orig_y:10 }]), /do componente R1.*pad_net/);
  const pdl = { op:'pad_del', id:'p1', orig_x:40, orig_y:30 };
  semErro(ap(B, [pdl])); assert.strictEqual(HC.effectiveBoard(B, ap(B, [pdl])).freepads.length, 0);
  comErro(ap(B, [pdl, pe]), /já foi removido/);
  comErro(ap(B, [pe, Object.assign({}, pdl)]), /não confere/);
}

/* ================= comment_move ================= */
{
  const B = placa();
  const ch = [{ op:'comment_move', ref:'R1', x:15, y:8, orig_x:10, orig_y:8 }];
  const m = ap(B, ch); semErro(m);
  assert.strictEqual(HC.effectiveBoard(B, m).texts.find(t => t.comment).x, 15);
  ida(ch);
  const B2 = placa(); B2.texts = B2.texts.filter(t => !t.comment);
  comErro(ap(B2, ch), /não está visível/);
  comErro(ap(B, [{ op:'comment_move', ref:'R1', x:1, y:1, orig_x:10, orig_y:8 },
                 { op:'comp_move', ref:'R1', x:20, y:10, orig_x:10, orig_y:10, orig_rot:0, orig_layer:'Top' },
                 { op:'comment_move', ref:'R1', x:1, y:1, orig_x:1, orig_y:1 }]), /já terá andado|não confere/);
}

/* ================= outline_set com arco (bulge) ================= */
{
  const B = placa();
  const T = Math.tan(Math.PI / 8);
  const pts = [[2, 0], [48, 0, T], [50, 2], [50, 40], [0, 40], [0, 2, T]];
  const m = ap(B, [{ op:'outline_set', pts }]); semErro(m);
  const eb = HC.effectiveBoard(B, m);
  const arcos = eb.board.outline.filter(s => s.kind === 'arc');
  assert.strictEqual(arcos.length, 2);
  assert.ok(near(arcos[0].cx, 48, 1e-5) && near(arcos[0].cy, 2, 1e-5) && near(arcos[0].r, 2, 1e-5) && near(arcos[0].sa, 270, 1e-4) && near(arcos[0].ea, 0, 1e-4) || near(arcos[0].ea, 360, 1e-4));
  assert.deepStrictEqual(eb.board.bbox, { x1:0, y1:0, x2:50, y2:40 }, 'bbox conta o arco');
  idem(eb, 'outline com arco'); ida([{ op:'outline_set', pts }]);
  /* volta: o contorno do board.js vira pts com bulge de novo */
  const volta = HC.outlineToPts(eb.board.outline);
  assert.strictEqual(volta.length, pts.length);
  volta.forEach((p, i) => { assert.ok(near(p[0], pts[i][0], 1e-5) && near(p[1], pts[i][1], 1e-5)); assert.ok(near(p[2] || 0, pts[i][2] || 0, 1e-6), 'bulge ' + i); });
  /* horario (bulge negativo) e circulo de dois vertices */
  const cw = HC.ptsToOutline([[0, 0, -1], [10, 0]]);
  assert.ok(cw[0].kind === 'arc' && near(cw[0].cx, 5) && near(cw[0].r, 5));
  semErro(ap(B, [{ op:'outline_set', pts:[[0, 0, 1], [10, 0, 1]] }]), 'circulo');
  comErro(ap(B, [{ op:'outline_set', pts:[[0, 0], [10, 0]] }]), /3 vértices/);
  comErro(ap(B, [{ op:'outline_set', pts:[[0, 0, 'x'], [10, 0], [5, 5]] }]), /pts deve ser/);
  /* reta pura: o mesmo resultado de antes do bulge existir */
  assert.deepStrictEqual(ap(B, [{ op:'outline_set', pts:[[0, 0], [80, 0], [80, 60]] }]).outline,
    [{ kind:'line', x1:0, y1:0, x2:80, y2:0 }, { kind:'line', x1:80, y1:0, x2:80, y2:60 }, { kind:'line', x1:80, y1:60, x2:0, y2:0 }]);
  /* contorno real com arco (29% do acervo) que o board.js traz: volta e ida dao o mesmo contorno */
  for (const d of fs.readdirSync(path.join(__dirname, '..', 'Projects'))) {
    const f = 'Projects/' + d + '/board.js';
    if (!fs.existsSync(path.join(__dirname, '..', f))) continue;
    const ol = (loadVar(f, 'pcbmirror').board || {}).outline || [];
    if (!ol.some(s => s.kind === 'arc')) continue;
    const p = HC.outlineToPts(ol);
    if (!p) continue;                               /* contorno que nao fecha em ordem: fica para o Altium */
    const de = HC.ptsToOutline(p);
    const b1 = HC.outlineBBox(de), b2 = HC.outlineBBox(ol);
    for (const k of ['x1', 'y1', 'x2', 'y2']) assert.ok(near(b1[k], b2[k], 1e-4), d + ': contorno com arco ida e volta ' + k);
    assert.strictEqual(de.filter(s => s.kind === 'arc').length, ol.filter(s => s.kind === 'arc').length, d);
  }
}

/* ================= poly_add / poly_edit / poly_del ================= */
{
  const B = placa();
  const pa = { op:'poly_add', layer:'Bottom', net:'GND', pts:[[0, 0], [50, 0], [50, 40], [0, 40]], pour:'hatch', hatch_grade:0.5, hatch_largura:0.2,
               con_tipo:'relief', con_condutores:2, con_angulo:45, clearance:0.3, nome:'GND bottom' };
  const m = ap(B, [pa]); semErro(m);
  const eb = HC.effectiveBoard(B, m);
  assert.strictEqual(eb.polygons.length, 1);
  const g = eb.polygons[0];
  assert.deepStrictEqual(Object.assign({}, g, { id:undefined }),
    { id:undefined, nome:'GND bottom', layer:'Bottom', net:'GND', pts:pa.pts, pour:'hatch', removeDead:true, minArea:1.6129, ordem:0,
      conexao:{ tipo:'relief', condutores:2, largura:0.254, gap:0.254, angulo:45 }, clearance:0.3, hatch:{ grade:0.5, largura:0.2 } });
  assert.ok(/^new-pg\d+$/.test(g.id));
  idem(eb, 'poly_add'); ida([pa]);
  assert.deepStrictEqual(HC.effectiveBoard(B).polygons, [], 'sem polígono: vazio');
  comErro(ap(B, [Object.assign({}, pa, { layer:'TopOverlay' })]), /cobre/);
  comErro(ap(B, [Object.assign({}, pa, { pour:'x' })]), /pour/);
  comErro(ap(B, [Object.assign({}, pa, { con_condutores:3 })]), /2 ou 4/);
  comErro(ap(B, [Object.assign({}, pa, { pts:[[0, 0], [10, 10], [10, 0], [0, 10]] })]), /se cruzam/);
  comAviso(ap(B, [Object.assign({}, pa, { net:'' })]), /sem net/);
  /* o polígono que veio no board.js: edit e del */
  const B2 = placa(); B2.polygons = [Object.assign({}, g, { id:'pg1' })];
  const pe = { op:'poly_edit', id:'pg1', pour:'solid', ordem:2, orig_layer:'Bottom', orig_n:4, orig_x0:0, orig_y0:0 };
  const me = ap(B2, [pe]); semErro(me);
  const ge = HC.effectiveBoard(B2, me).polygons[0];
  assert.ok(ge.pour === 'solid' && ge.ordem === 2 && !('hatch' in ge) && ge.net === 'GND');
  idem(HC.effectiveBoard(B2, me), 'poly_edit'); ida([pe]);
  const pd = { op:'poly_del', id:'pg1', orig_layer:'Bottom', orig_n:4, orig_x0:0, orig_y0:0 };
  semErro(ap(B2, [pd])); assert.deepStrictEqual(HC.effectiveBoard(B2, ap(B2, [pd])).polygons, []);
  comAviso(ap(B2, [Object.assign({}, pd, { orig_x0:1 })]), /não confere/);
  assert.deepStrictEqual(HC.effectiveBoard(B2).polygons, B2.polygons, 'parado sai identico');
}

/* ================= ECO: projetos reais ================= */
const PROJ = path.join(__dirname, '..', 'Projects');
for (const d of fs.readdirSync(PROJ)) {
  const p = 'Projects/' + d;
  if (!fs.existsSync(path.join(PROJ, d, 'board.js')) || !fs.existsSync(path.join(PROJ, d, 'schematic.js'))) continue;
  const B = loadVar(p + '/board.js', 'pcbmirror'), S = loadVar(p + '/schematic.js', 'schematic');
  let ch = []; try { ch = loadVar(p + '/changes.js', 'changes'); } catch (e) { /* sem changes */ }
  const eco = Eco.compara(S, B, { schlib, pcblib, changes:ch });
  /* o ECO nunca propoe tirar pino de componente cuja pinagem a previa nao conhece */
  const cegos = new Set(eco.acoes.filter(a => a.info).map(a => a.objeto));
  assert.ok(!eco.acoes.some(a => a.tipo === 'pad_net' && !a.dados.net && cegos.has(a.dados.ref)), d + ': pino de componente cego');
  /* o que ele manda executar passa no motor sem erro (ordem, orig_*, nets) */
  const r = Eco.aplica(eco, { pcblib });
  const todas = ch.concat(r.linhas);
  const m = HC.applyPcbChanges(B, todas, { pcblib });
  const novos = m.changeItems.slice(ch.length).filter(it => it.status === 'err');
  assert.deepStrictEqual(novos.map(it => it.msg), [], d + ': linhas do ECO com erro');
  ida(r.linhas);
  /* e depois de executado, o ECO de novo nao tem nada a fazer de componente nem de pino */
  const eb = HC.effectiveBoard(B, m);
  const eco2 = Eco.compara(S, eb, { schlib, pcblib });
  const resto = eco2.acoes.filter(a => a.ativo && a.status !== 'err');
  assert.deepStrictEqual(resto.map(a => a.grupo + ' ' + a.objeto), [], d + ': segundo ECO');
  assert.ok(Eco.relatorio(eco).indexOf('Engineering Change Order') === 0);
}
/* LM555: o board do Altium nao tem os conectores (a placa usa 4 pads soltos no lugar), e o CI1
   nao tem simbolo na schlib -- o resto esta sincronizado */
{
  const B = loadVar('Projects/LM555 astável/board.js', 'pcbmirror'), S = loadVar('Projects/LM555 astável/schematic.js', 'schematic');
  const eco = Eco.compara(S, B, { schlib, pcblib });
  assert.deepStrictEqual(eco.acoes.filter(a => a.grupo === 'compAdd').map(a => a.objeto), ['CN1', 'CN2']);
  assert.deepStrictEqual(eco.acoes.filter(a => a.grupo === 'compDel' || a.grupo === 'compFp' || a.grupo === 'netDel'), []);
  assert.ok(eco.acoes.some(a => a.info && a.objeto === 'CI1'), 'CI1 sem simbolo: aviso, sem acao de pino');
  /* desmarcar: Validate refaz o status; a acao que depende de net desmarcada vira erro */
  const S2 = JSON.parse(JSON.stringify(S));
  const eco3 = Eco.compara(S2, Nova.gera({ largura:40, altura:30 }), { schlib, pcblib });
  const gnd = eco3.acoes.find(a => a.tipo === 'net_add' && a.dados.net === 'GND');
  gnd.ativo = false; Eco.valida(eco3);
  assert.ok(eco3.acoes.filter(a => a.tipo === 'comp_add' && Object.values(a.dados.nets).includes('GND')).every(a => a.status === 'warn'));
  const r3 = Eco.aplica(eco3, { pcblib });
  assert.ok(r3.linhas.filter(l => l.op === 'comp_add').every(l => !/=GND(;|$)/.test(l.nets || '')), 'sem a net, o pad vai sem net');
  /* footprint que falta: erro de validacao, nao crash, e nao executa */
  const S4 = JSON.parse(JSON.stringify(S));
  S4.items.find(i => i.t === 'comp' && i.ref === 'R1').footprint = 'NAO EXISTE 9999';
  const eco4 = Eco.compara(S4, Nova.gera({ largura:40, altura:30 }), { schlib, pcblib });
  const r1 = eco4.acoes.find(a => a.objeto === 'R1');
  assert.ok(r1.status === 'err' && /não encontrado/.test(r1.msgValida));
  const r4 = Eco.aplica(eco4, { pcblib });
  assert.ok(!r4.linhas.some(l => l.ref === 'R1') && r4.puladas.some(p => p.acao === r1));
}

/* ================= placa nova + ECO de ponta a ponta (LM555) ================= */
{
  const S = loadVar('Projects/LM555 astável/schematic.js', 'schematic');
  assert.ok(Nova.erros({ largura:0, altura:10 }).length && Nova.erros({ largura:10, altura:10, forma:'arredondado', raio:6 }).length);
  assert.throws(() => Nova.gera({ largura:-1, altura:5 }), /placa nova/);
  const B0 = Nova.gera({ projeto:'LM555 astável', largura:40, altura:30, forma:'arredondado', raio:2, camadas:2,
                         furos:{ d:3.2, margem:4 }, codigo:true });
  assert.ok(B0.master === true && B0.exporter === 'EletricHUB' && B0.components.length === 0);
  assert.deepStrictEqual(B0.board.bbox, { x1:0, y1:0, x2:40, y2:30 }, 'origem no canto (a da casa)');
  assert.strictEqual(B0.board.outline.filter(s => s.kind === 'arc').length, 4);
  assert.strictEqual(B0.lines.length, B0.board.outline.length, 'contorno repetido na Mech1');
  assert.strictEqual(B0.cutouts.length, 4);
  assert.deepStrictEqual(B0.rules, Nova.PADRAO_CASA.regras);
  assert.deepStrictEqual(B0.layers.filter(l => HC.isCopper(l.key)).map(l => l.key), ['Top', 'Bottom']);
  assert.deepStrictEqual(Nova.gera({ largura:10, altura:10, camadas:4 }).layers.filter(l => HC.isCopper(l.key)).map(l => l.key + l.stack), ['Top1', 'Mid12', 'Mid23', 'Bottom4']);
  assert.deepStrictEqual(Nova.gera({ largura:10, altura:20, origem:'centro' }).board.bbox, { x1:-5, y1:-10, x2:5, y2:10 });
  /* o texto gravado e lido de volta e a mesma placa */
  const txt = Nova.serializa(B0);
  const B = new Function(txt + ';return pcbmirror;')();
  assert.deepStrictEqual(B, B0);
  assert.ok(txt.split('\n').every(l => !/[^\x00-\x7e]/.test(l)), 'nao-ASCII escapado');
  idem(HC.effectiveBoard(B), 'placa nova vazia');
  /* ECO: tudo entra */
  const eco = Eco.compara(S, B, { schlib, pcblib });
  assert.ok(eco.acoes.filter(a => a.tipo === 'comp_add').length === 11);
  const r = Eco.aplica(eco, { pcblib });
  assert.deepStrictEqual(r.puladas, []);
  const lidas = ida(r.linhas);
  const m = HC.applyPcbChanges(B, lidas, { pcblib }); semErro(m, 'ECO na placa nova');
  const eb = HC.effectiveBoard(B, m);
  /* estacionados a direita da placa, sem sobrepor */
  const cx = eb.components.map(c => c.bbox);
  assert.ok(cx.every(b => b.x1 >= 40 + 5 - 1e-6), 'fora da placa, a direita');
  for (let i = 0; i < cx.length; i++) for (let j = i + 1; j < cx.length; j++) {
    const a = cx[i], b = cx[j];
    assert.ok(a.x2 <= b.x1 + 1e-6 || b.x2 <= a.x1 + 1e-6 || a.y2 <= b.y1 + 1e-6 || b.y2 <= a.y1 + 1e-6, 'sobrepostos: ' + i + ' ' + j);
  }
  const cn1 = eb.components.find(c => c.ref === 'CN1');
  assert.deepStrictEqual(cn1.pads.map(p => p.name + '=' + p.net).sort(), ['1=VCC', '2=GND']);
  idem(eb, 'LM555 com ECO');
  /* consolidar: a placa mestra com o changes.js assado, ids renumerados, footprints embutidos */
  const c = Nova.consolida(B, lidas, { pcblib });
  assert.deepStrictEqual(c.erros, []);
  assert.deepStrictEqual(c.board.components.map(x => x.id), c.board.components.map((x, i) => 'c' + (i + 1)));
  assert.ok(c.board.components.every(x => x.pads.every((p, i) => p.id === x.id + 'p' + (i + 1))));
  assert.ok(!JSON.stringify(c.board).includes('"new-'), 'nenhum id new- depois de consolidar');
  assert.deepStrictEqual(c.board.footprints.map(f => f.name).sort(), ['CAP 1206', 'CONE MSTBH 2,5/ 2 GF', 'DIP8', 'RES 1206', 'TO-92']);
  idem(c.board, 'consolidada');
  /* a consolidada abre sem pcblib (footprint embutido) e o ECO de novo nao tem nada a fazer */
  const B2 = new Function(Nova.serializa(c.board) + ';return pcbmirror;')();
  const eco2 = Eco.compara(S, B2, { schlib });
  assert.deepStrictEqual(eco2.acoes.filter(a => a.ativo).map(a => a.grupo + ' ' + a.objeto), []);
  /* mais um componente depois de consolidar: o id novo nao colide */
  const m3 = HC.applyPcbChanges(B2, [{ op:'comp_add', ref:'R9', footprint:'RES 1206', x:5, y:5 }]);
  semErro(m3, 'footprint vem do board.footprints');
  const c3 = Nova.consolida(B2, [{ op:'comp_add', ref:'R9', footprint:'RES 1206', x:5, y:5 }]);
  assert.strictEqual(c3.board.components.find(x => x.ref === 'R9').id, 'c12');
  /* consolidar com erro nao grava nada */
  assert.ok(Nova.consolida(B2, [{ op:'comp_del', ref:'NADA', orig_x:0, orig_y:0, orig_rot:0, orig_layer:'Top' }]).erros.length);
}

console.log('test-pcbeco: ok');
