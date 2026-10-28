/* O AUTOROTEADOR (hub-autoroteador.js): várias camadas com via, o lote com ordem e arranca-e-refaz, e
   as MESMAS regras do DRC — provado pelo próprio DRC (hub-pcbdrc.js) em cada resultado.
     node tests/test-autoroteador.js

   1. duas nets que se cruzam: numa camada só, impossível (sobra uma conexão aberta); com duas, a
      segunda desce por via e volta — DRC zerado;
   2. a ordem e o arranca-e-refaz: a net fina, curta, toma o único vão em que a net de potência larga
      cabe; a passada única (a mais curta primeiro) deixa a potência aberta, o arranca-e-refaz e a
      ordem por classe fecham tudo — estritamente melhor;
   3. folga por CLASSE de net e por par com escopo, lidas de um rules.js: Fase x baixa tensão 1,5 mm
      (a fase passa a 0,5 mm de outra net comum, mas nunca a menos de 1,5 mm da baixa tensão) e COM x
      VSS 0,2 mm só nos pads do IC8 (a COM passa entre dois pads VSS do IC8 que a folga geral de
      0,3 mm fecharia — sem a regra de escopo, não passa); DRC zerado e distâncias medidas;
   4. Routing Layers: a net proibida no Bottom nunca ganha cobre no Bottom — quem desce por via é a
      outra;
   5. as placas do acervo (Projects/, só leitura): as trilhas das nets de sinal arrancadas (na
      memória) e roteadas de novo — conexões abertas antes/depois, vias, tempo; nenhuma violação nova
      de DRC. */
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const AR = require('../hub-autoroteador.js');
const HR = require('../hub-roteador.js');
const RG = require('../hub-pcbregras.js');
const DRC = require('../hub-pcbdrc.js');
const NETS = require('../hub-pcbnets.js');

let falhou = 0;
function caso(nome, fn){
  try { fn(); console.log('ok  ' + nome); }
  catch (e) { falhou++; console.log('FALHOU  ' + nome + '\n   ' + (e && e.stack || e).toString().split('\n').slice(0, 6).join('\n   ')); }
}

/* ---------------- placas sintéticas ---------------- */
let seq = 0;
const id = p => p + (++seq);
function placaBase(W, H){
  const out = [[0, 0, W, 0], [W, 0, W, H], [W, H, 0, H], [0, H, 0, 0]].map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2 }));
  return { board: { bbox: { x1: 0, y1: 0, x2: W, y2: H }, outline: out }, layers: [{ key: 'Top' }, { key: 'Bottom' }],
           components: [], tracks: [], arcs: [], vias: [], fills: [], regions: [], texts: [], lines: [], silk: [], freepads: [], nets: [] };
}
const temNet = (eb, n) => { if (n && !eb.nets.includes(n)) eb.nets.push(n); };
function pad(eb, ref, nome, x, y, o){
  let c = eb.components.find(k => k.ref === ref);
  if (!c) { c = { id: id('c'), ref, footprint: 'FP_' + ref, layer: 'Top', x, y, rot: 0, pads: [] }; eb.components.push(c); }
  const p = Object.assign({ id: id('p'), name: nome, x, y, w: 1.2, h: 1.2, shape: 'rect', layer: 'Top', type: 'smd', drill: 0, rot: 0, net: '' }, o || {});
  c.pads.push(p);
  temNet(eb, p.net);
  return p;
}
function trilha(eb, layer, x1, y1, x2, y2, w, net){ const t = { id: id('t'), layer, x1, y1, x2, y2, w, net: net || '' }; eb.tracks.push(t); temNet(eb, net); return t; }

/* a placa com as ops do lote assadas (como o effectiveBoard faria) */
function comOps(eb, ops){
  return Object.assign({}, eb, {
    tracks: eb.tracks.concat(ops.filter(o => o.op === 'track_add').map((o, i) => Object.assign({ id: 'auto-t' + i }, o))),
    vias: eb.vias.concat(ops.filter(o => o.op === 'via_add').map((o, i) => Object.assign({ id: 'auto-v' + i, from: 'Top', to: 'Bottom' }, o))) });
}
const msgs = d => d.violacoes.slice(0, 6).map(v => v.msg).join(' | ');
/* o DRC das regras que o roteador tem de cumprir, na placa inteira */
const TIPOS = ['Clearance', 'ShortCircuit', 'UnRoutedNet', 'Width', 'RoutingLayers', 'RoutingVias', 'HoleSize', 'HoleToHoleClearance',
               'MinimumSolderMaskSliver', 'NetAntennae', 'BoardOutlineClearance'];
const drc = (eb, S) => DRC.rodar(eb, S, { modo: 'lote', tipos: TIPOS });
/* as violações que o lote criou: as da placa com as rotas que a placa de antes não tinha (a net não
   roteada fica de fora: a árvore do ratsnest muda quando as ilhas se juntam) */
const chaveV = v => v.tipo + '|' + v.ids.map(String).sort().join('|');
function novas(ebAntes, ebDepois, S){
  const ja = new Set(drc(ebAntes, S).violacoes.map(chaveV));
  const d = drc(ebDepois, S);
  return Object.assign(d, { novas: d.violacoes.filter(v => v.tipo !== 'UnRoutedNet' && !ja.has(chaveV(v))),
                            abertas: d.violacoes.filter(v => v.tipo === 'UnRoutedNet').length });
}
const msgsN = d => d.novas.slice(0, 6).map(v => v.msg).join(' | ');

/* distância de cobre a cobre entre duas trilhas (cápsulas) */
const geo = DRC.geo;
const capsula = t => geo.primSeg(t.x1, t.y1, t.x2, t.y2, t.w / 2);
const dTrilhas = (A, B) => { let d = Infinity; for (const a of A) for (const b of B) d = Math.min(d, geo.dPrim(capsula(a), capsula(b), 50)); return d; };

const CASA = () => RG.normaliza(RG.padroesCasa());

/* ---------------- 1. o cruzamento ---------------- */
caso('cruzamento: numa camada sobra uma aberta; em duas, via e DRC zerado', () => {
  const eb = placaBase(40, 20);
  /* A atravessa de borda a borda; B, de baixo para cima. Os pads encostam na borda: não há volta */
  pad(eb, 'J1', '1', 0.9, 10, { net: 'A', w: 1.0, h: 3 }); pad(eb, 'J2', '1', 39.1, 10, { net: 'A', w: 1.0, h: 3 });
  pad(eb, 'U1', '1', 20, 0.9, { net: 'B', w: 3, h: 1.0 }); pad(eb, 'U2', '1', 20, 19.1, { net: 'B', w: 3, h: 1.0 });
  const S = CASA();
  const um = AR.rotearLote(eb, { regras: S, camadas: ['Top'] });
  assert.strictEqual(um.antes.conexoes, 2);
  assert.strictEqual(um.depois.conexoes, 1, 'numa camada só, uma das duas não fecha: ' + JSON.stringify(um.falhas));
  assert.strictEqual(um.vias, 0);
  assert.ok(um.falhas.length === 1 && ['sem-caminho', 'bloqueada'].includes(um.falhas[0].motivo), JSON.stringify(um.falhas));
  const dois = AR.rotearLote(eb, { regras: S });
  assert.strictEqual(dois.depois.conexoes, 0, 'com Top e Bottom fecha: ' + JSON.stringify(dois.falhas));
  assert.ok(dois.vias >= 2, 'a que cruza desce e sobe por via (' + dois.vias + ')');
  const vias = dois.ops.filter(o => o.op === 'via_add');
  assert.ok(vias.every(v => Math.abs(v.size - 0.5) < 1e-9 && Math.abs(v.drill - 0.3) < 1e-9 && v.net), 'via da Routing Via Style da casa (0,5/0,3), com net');
  assert.ok(dois.ops.filter(o => o.op === 'track_add').every(t => Math.abs(t.w - 0.254) < 1e-9), 'trilha da Width da casa (10 mil)');
  assert.ok(dois.ops.some(o => o.op === 'track_add' && o.layer === 'Bottom'), 'algum trecho no Bottom');
  const d = drc(comOps(eb, dois.ops), S);
  assert.strictEqual(d.total, 0, 'DRC: ' + msgs(d));
  /* sem pontos repetidos nem trilha de comprimento zero */
  assert.ok(dois.ops.filter(o => o.op === 'track_add').every(t => Math.hypot(t.x2 - t.x1, t.y2 - t.y1) > 1e-6));
  console.log(`    1 camada: ${um.depois.conexoes} aberta; 2 camadas: 0 abertas, ${dois.vias} vias, ${dois.comprimento.toFixed(1)} mm, ${dois.ms} ms`);
});

/* ---------------- 2. ordem e arranca-e-refaz ---------------- */
caso('ordem e arranca-e-refaz: estritamente melhor que a passada única', () => {
  const S = CASA();
  S.rules.push(Object.assign(RG.novaRegra(S, 'Width'), { name: 'Width_PWR', scope1: "InNet('PWR')", priority: 0, min: 1.0, pref: 1.0, max: 2.0 }));
  const R = RG.normaliza(S);
  const eb = placaBase(40, 24);
  /* uma parede (net X) em x = 20 de borda a borda, com dois vãos: G1 (1,8 mm livres: a PWR de 1 mm
     cabe, mas não junto com uma fina) e G2 (1,0 mm: só a fina) */
  const w = 0.3, X = 20;
  trilha(eb, 'Top', X, 0.2, X, 5, w, 'X');             /* G2: 5..6.3 */
  trilha(eb, 'Top', X, 6.3, X, 15, w, 'X');            /* G1: 15..17.1 */
  trilha(eb, 'Top', X, 17.1, X, 23.8, w, 'X');
  pad(eb, 'P1', '1', 5, 16.05, { net: 'PWR', w: 2, h: 2 }); pad(eb, 'P2', '1', 35, 16.05, { net: 'PWR', w: 2, h: 2 });
  pad(eb, 'S1', '1', 17, 19, { net: 'S' }); pad(eb, 'S2', '1', 23, 13, { net: 'S' });
  /* só as duas nets do caso: as ilhas da parede (net X) não entram no lote */
  const base = { regras: R, camadas: ['Top'], nets: ['PWR', 'S'] };
  const ingenua = AR.rotearLote(eb, Object.assign({ passes: 0, ordem: 'curta' }, base));
  assert.strictEqual(ingenua.alvo.conexoes, 2);
  assert.strictEqual(ingenua.depois.doAlvo, 1, 'a passada única deixa a PWR aberta: ' + JSON.stringify(ingenua.falhas));
  assert.strictEqual(ingenua.falhas[0].net, 'PWR');
  const lote = AR.rotearLote(eb, Object.assign({ ordem: 'curta' }, base));
  assert.strictEqual(lote.depois.doAlvo, 0, 'o arranca-e-refaz fecha as duas: ' + JSON.stringify(lote.falhas));
  assert.ok(lote.depois.doAlvo < ingenua.depois.doAlvo && lote.depois.conexoes < ingenua.depois.conexoes, 'estritamente melhor');
  assert.ok(lote.arrancadas >= 1 && lote.passes >= 1, 'arrancou a fina e refez (' + lote.arrancadas + ' arrancada(s), ' + lote.passes + ' passada(s))');
  const pw = lote.ops.filter(o => o.net === 'PWR');
  assert.ok(pw.length && pw.every(o => Math.abs(o.w - 1.0) < 1e-9), 'a PWR com a largura da Width_PWR');
  const d = novas(eb, comOps(eb, lote.ops), R);
  assert.ok(!d.novas.length && !d.abertas, 'DRC: ' + msgsN(d) + msgs(d));
  /* a ordem por classe (a regra mais pesada primeiro) resolve sem arrancar nada */
  const classe = AR.rotearLote(eb, Object.assign({ passes: 0, ordem: 'classe' }, base));
  assert.strictEqual(classe.depois.doAlvo, 0, 'ordem por classe: ' + JSON.stringify(classe.falhas));
  /* e a ordem dada também manda */
  const dada = AR.rotearLote(eb, Object.assign({ passes: 0, ordem: ['PWR', 'S'] }, base));
  assert.strictEqual(dada.depois.doAlvo, 0);
  console.log(`    passada única: ${ingenua.depois.doAlvo} aberta; arranca-e-refaz: 0 (${lote.arrancadas} arrancada, ${lote.passes} passada); 'classe' e ['PWR','S']: 0`);
});

/* ---------------- 3. classes e par com escopo, do rules.js ---------------- */
function regrasClasses(comEscopo){
  const S = CASA();
  S.rules.find(r => r.kind === 'Clearance').gap = 0.3;
  S.classes.net = { Phase: ['L1', 'L2'], LowV: ['S1', 'S2'] };
  S.rules.push(Object.assign(RG.novaRegra(S, 'Clearance'), { name: 'Fase_x_BT', gap: 1.5, matrix: {}, scope1: "InNetClass('Phase')", scope2: "InNetClass('LowV')", priority: 0 }));
  if (comEscopo) S.rules.push(Object.assign(RG.novaRegra(S, 'Clearance'), { name: 'COM_VSS_IC8', gap: 0.2, matrix: {}, scope1: "InNet('COM')", scope2: "InNet('VSS') and InComponent('IC8')", priority: 0.5 }));
  S.rules.push(Object.assign(RG.novaRegra(S, 'Width'), { name: 'Width_COM', scope1: "InNet('COM')", priority: 0, min: 0.2, pref: 0.2, max: 0.5 }));
  /* pelo rules.js de verdade: serializa e lê de volta, como o MCP e a vista carregam */
  const t = RG.serializa(RG.normaliza(S));
  return RG.ler(typeof t === 'string' ? t : t.text);
}
caso('folga por classe: Fase x baixa tensão 1,5 mm, e só com a baixa tensão', () => {
  const S = regrasClasses(true);
  for (const [nome, yS1, reta] of [['S1 longe', 13.0, true], ['S1 perto', 14.0, false]]) {
    const eb = placaBase(40, 30);
    pad(eb, 'K1', '1', 3, 15, { net: 'L1' }); pad(eb, 'K2', '1', 37, 15, { net: 'L1' });
    const tN = trilha(eb, 'Top', 10, 15.8, 30, 15.8, 0.3, 'N');      /* net comum: a 0,52 mm do eixo da fase */
    const tS = trilha(eb, 'Top', 10, yS1, 30, yS1, 0.3, 'S1');       /* baixa tensão */
    const r = AR.rotearLote(eb, { regras: S, camadas: ['Top'], nets: ['L1'] });
    assert.strictEqual(r.alvo.conexoes, 1);
    assert.strictEqual(r.depois.conexoes, 0, nome + ': ' + JSON.stringify(r.falhas));
    const L1 = r.ops.filter(o => o.op === 'track_add' && o.net === 'L1');
    const dS = dTrilhas(L1, [tS]), dN = dTrilhas(L1, [tN]);
    assert.ok(dS >= 1.5 - 1e-6, `${nome}: a fase fica a ${dS.toFixed(4)} mm da baixa tensão (pede 1,5)`);
    if (reta) {
      assert.strictEqual(L1.length, 1, 'S1 longe: a fase vai reta (a folga de 1,5 é só contra a baixa tensão)');
      assert.ok(dN < 1.5 && dN >= 0.3 - 1e-6, `S1 longe: a fase passa a ${dN.toFixed(3)} mm da net comum (< 1,5, >= 0,3)`);
    } else assert.ok(L1.length > 1, 'S1 perto: a fase desvia');
    const d = novas(eb, comOps(eb, r.ops), S);
    assert.ok(!d.novas.length && !d.abertas, nome + ' DRC: ' + msgsN(d));
    console.log(`    ${nome}: fase a ${dS.toFixed(3)} mm da baixa tensão, ${dN.toFixed(3)} mm da net comum, ${L1.length} trecho(s)`);
  }
});
caso('par com escopo: COM x VSS a 0,2 mm só nos pads do IC8 (sem a regra, não passa)', () => {
  const montar = () => {
    const eb = placaBase(40, 20);
    /* dois pads VSS do IC8 com 0,65 mm de vão; paredes VSS (fora do IC8: valem os 0,3 mm) fecham o resto */
    pad(eb, 'IC8', '1', 20, 10, { net: 'VSS', w: 1.0, h: 0.4 });
    pad(eb, 'IC8', '2', 20, 11.05, { net: 'VSS', w: 1.0, h: 0.4 });
    trilha(eb, 'Top', 20, 0.3, 20, 9.9, 0.3, 'VSS');
    trilha(eb, 'Top', 20, 11.15, 20, 19.7, 0.3, 'VSS');
    pad(eb, 'Q1', '1', 5, 10.525, { net: 'COM' }); pad(eb, 'Q2', '1', 35, 10.525, { net: 'COM' });
    return eb;
  };
  const S = regrasClasses(true), S0 = regrasClasses(false);
  const eb = montar();
  /* só a COM: os dois pads VSS do IC8 são ilhas separadas de propósito */
  const r = AR.rotearLote(eb, { regras: S, camadas: ['Top'], nets: ['COM'] });
  assert.strictEqual(r.antes.conexoes, 2, 'abertas: a COM e o par VSS do IC8');
  assert.strictEqual(r.depois.conexoes, 1, 'com a regra de escopo a COM passa entre os pads: ' + JSON.stringify(r.falhas));
  const COM = r.ops.filter(o => o.op === 'track_add' && o.net === 'COM');
  assert.ok(COM.every(t => Math.abs(t.w - 0.2) < 1e-9), 'a COM com a Width_COM');
  /* ela passa mesmo pelo vão (x = 20), e a 0,2 mm dos pads do IC8 */
  const ic8 = eb.components.find(c => c.ref === 'IC8').pads;
  const dPad = Math.min(...COM.map(t => Math.min(...ic8.map(p => geo.dPrim(capsula(t), geo.primPad(p, false, 0), 50)))));
  assert.ok(dPad >= 0.2 - 1e-6 && dPad < 0.3, `a COM fica a ${dPad.toFixed(4)} mm dos pads VSS do IC8 (>= 0,2 e < 0,3)`);
  const d = novas(eb, comOps(eb, r.ops), S);
  assert.ok(!d.novas.length && d.abertas === 1, 'DRC: ' + msgsN(d));
  /* e a mesma rota, conferida SEM a regra de escopo, viola — a folga de 0,3 vale para o par */
  const d0 = novas(eb, comOps(eb, r.ops), S0);
  assert.ok(d0.novas.some(v => v.tipo === 'Clearance'), 'sem a regra de escopo o DRC acusa a mesma rota');
  /* sem a regra, o autoroteador não acha caminho (e não grava nada abaixo da regra) */
  const r0 = AR.rotearLote(montar(), { regras: S0, camadas: ['Top'], nets: ['COM'] });
  assert.strictEqual(r0.depois.conexoes, 2, 'sem a regra de escopo, não passa: ' + JSON.stringify(r0.falhas));
  assert.strictEqual(r0.ops.length, 0, 'e nada sai abaixo da regra');
  console.log(`    COM a ${dPad.toFixed(3)} mm dos pads VSS do IC8; sem COM_VSS_IC8: ${r0.falhas[0].motivo}`);
});

/* ---------------- 4. Routing Layers ---------------- */
caso('Routing Layers: a net proibida no Bottom nunca ganha cobre no Bottom', () => {
  const S = CASA();
  const so = {}; for (const k of ['Top', 'Bottom']) so[k] = k === 'Top';
  S.rules.push(Object.assign(RG.novaRegra(S, 'RoutingLayers'), { name: 'NB_so_Top', layers: so, scope1: "InNet('NB')", priority: 0 }));
  const R = RG.normaliza(S);
  const eb = placaBase(40, 20);
  pad(eb, 'J1', '1', 0.9, 10, { net: 'NB', w: 1.0, h: 3 }); pad(eb, 'J2', '1', 39.1, 10, { net: 'NB', w: 1.0, h: 3 });
  pad(eb, 'U1', '1', 20, 0.9, { net: 'B', w: 3, h: 1.0 }); pad(eb, 'U2', '1', 20, 19.1, { net: 'B', w: 3, h: 1.0 });
  assert.ok(!HR.camadaPermitida(HR.cena(eb, { regras: R }), 'NB', 'Bottom'));
  const r = AR.rotearLote(eb, { regras: R });
  assert.strictEqual(r.depois.conexoes, 0, JSON.stringify(r.falhas));
  const nb = r.ops.filter(o => o.net === 'NB' && o.op === 'track_add');
  assert.ok(nb.length && nb.every(o => o.layer === 'Top'), 'NB só no Top');
  assert.ok(r.ops.some(o => o.net === 'B' && o.op === 'track_add' && o.layer === 'Bottom') && r.ops.some(o => o.net === 'B' && o.op === 'via_add'), 'quem desce por via é a B');
  const d = drc(comOps(eb, r.ops), R);
  assert.strictEqual(d.total, 0, 'DRC (com RoutingLayers): ' + msgs(d));
  /* a NB com o Bottom pedido sozinho: camada proibida */
  const p = AR.rotearLote(eb, { regras: R, camadas: ['Bottom'], nets: ['NB'] });
  assert.strictEqual(p.falhas[0].motivo, 'camada-proibida');
  console.log(`    NB: ${nb.length} trecho(s) no Top; B: ${r.vias} vias`);
});

/* ---------------- 5. as placas do acervo ---------------- */
{
  const G = require('../hub-gerber.js');
  const HC = require('../hub-core.js');
  const PCB = require('../mcp/ferramentas/pcb.js');
  const { lerVar } = require('../mcp/lib/arquivo-linhas.js');
  const ctxM = { modulo: n => { try { return require(path.join(__dirname, '..', n)); } catch (e) { return null; } } };
  const tg = t => { if (!t || t.hidden) return null; try { return G.geometriaTexto(t); } catch (e) { return null; } };
  /* a maior placa do acervo e a fonte de alimentação (potência + lógica, 2 camadas: o acervo não tem
     placa com plano interno) */
  const PLACAS = ['PRJ-UR-DI261924', 'PRJ - IT - DI221705 (Alimentação)'];
  /* id da violação sem o número do pedaço de plano redespejado */
  const chave = v => v.tipo + '|' + v.ids.map(x => String(x).replace(/^(q:[^:]*):\d+$/, '$1')).sort().join('|');
  for (const nome of PLACAS) caso('acervo: ' + nome + ' — as nets de sinal arrancadas e roteadas de novo', () => {
    const f = path.join(__dirname, '..', 'Projects', nome, 'board.js');
    if (!fs.existsSync(f)) { console.log('    (sem a placa no acervo: pulado)'); return; }
    const antesArq = fs.readFileSync(f, 'utf8');
    const b = lerVar(f, 'pcbmirror');
    const eb0 = HC.effectiveBoard(b, HC.applyPcbChanges(b, []));
    /* as nets de sinal: tudo menos a(s) de plano (a que tem muitas regiões de cobre) */
    const reg = {};
    for (const g of eb0.regions || []) if (g.net) reg[g.net] = (reg[g.net] || 0) + 1;
    const nets = (eb0.nets || []).filter(n => !((reg[n] || 0) > 20));
    const ns = new Set(nets);
    const eb = Object.assign({}, eb0, { tracks: eb0.tracks.filter(t => !ns.has(t.net)), arcs: (eb0.arcs || []).filter(t => !ns.has(t.net)),
                                        vias: (eb0.vias || []).filter(v => !ns.has(v.net)), regions: (eb0.regions || []).filter(g => !ns.has(g.net)) });
    const S = RG.doBoard(eb);
    const C = HR.cena(eb, { regras: S, placa: { lacos: PCB._interno.lacosDe(ctxM, eb), recortes: [] }, textoGeo: tg });
    const r = AR.rotearLote(eb, { cena: C, nets });
    const d0 = DRC.rodar(eb, S, { textoGeo: tg }), d1 = DRC.rodar(comOps(eb, r.ops), S, { textoGeo: tg });
    const ja = new Set(d0.violacoes.map(chave));
    const novas = d1.violacoes.filter(v => v.tipo !== 'UnRoutedNet' && !ja.has(chave(v)));
    console.log(`    ${nome}: ${nets.length} nets arrancadas; abertas ${r.antes.conexoes} -> ${r.depois.conexoes} (1a passada ${r.primeiraPassada.falhas} falha(s)), ` +
                `${r.vias} vias, ${r.comprimento.toFixed(0)} mm, ${r.passes} passada(s), ${r.arrancadas} arrancada(s), ${(r.ms / 1000).toFixed(1)} s; ` +
                `DRC ${d0.total} -> ${d1.total}, ${novas.length} nova(s)`);
    assert.ok(r.antes.conexoes > 0 && r.depois.conexoes < r.antes.conexoes, 'menos conexões abertas depois');
    assert.strictEqual(novas.length, 0, 'violações novas: ' + novas.slice(0, 5).map(v => v.msg).join(' | '));
    /* a conta de abertas do relatório é a do ratsnest da placa com as rotas */
    assert.strictEqual(NETS.naoRoteadas(comOps(eb, r.ops)).conexoes, r.depois.conexoes);
    assert.strictEqual(r.orcamento.tempoMs, AR.TEMPO_MS);
    assert.strictEqual(fs.readFileSync(f, 'utf8'), antesArq, 'o board.js do acervo não muda');
  });
}

if (falhou) { console.log(`test-autoroteador FALHOU (${falhou} caso(s))`); process.exit(1); }
console.log('test-autoroteador OK');
