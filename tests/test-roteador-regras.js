/* O roteador e o DRC usam AS MESMAS REGRAS — como no Altium, onde o Interactive Routing e o Design
   Rule Check leem o mesmo "PCB Rules and Constraints Editor".
     node tests/test-roteador-regras.js

   O que se confere, com um conjunto de regras com escopo (o padrão da casa + regras por net):
     1. a folga de cada par (trilha na mão, objeto da placa) do roteador é a do DRC: em milhares de
        segmentos sorteados, o que o roteador acusa o DRC acusa, e o que ele libera o DRC aceita
        (fora da faixa de 1 µm em que as duas tolerâncias diferem de propósito);
     2. toda rota completa que o roteador devolve, gravada na placa, sai do DRC sem Clearance, curto
        nem folga ao contorno;
     3. a regra de escopo muda a rota: a net HV (1 mm) contorna o corredor que a net comum (10 mil)
        atravessa;
     4. Width, Routing Via Style e Routing Layers da net mandam na rota (o "Rule Preferred");
     5. keepout barra o roteador e o DRC acusa o cobre que o invade;
     6. a folga ao contorno é a da regra Board Outline Clearance, nos dois. */
'use strict';
const assert = require('assert');
const HR = require('../hub-roteador.js');
const RG = require('../hub-pcbregras.js');
const DRC = require('../hub-pcbdrc.js');

/* ---------------- o conjunto de regras ---------------- */
function regras(){
  const S = RG.padroesCasa();
  const nova = (kind, nome, campos, extra) => Object.assign(RG.novaRegra(S, kind), { name: nome }, campos, extra || {});
  S.rules.push(nova('Clearance', 'Clearance_HV', { gap: 1.0, matrix: {} }, { scope1: "InNet('HV')", scope2: 'All', priority: 0 }));
  S.rules.push(nova('Clearance', 'Clearance_Via', { gap: 0.4, matrix: {} }, { scope1: 'IsVia', scope2: 'All', priority: 0.5 }));
  S.rules.push(nova('Width', 'Width_PWR', { min: 0.5, pref: 0.8, max: 1.5 }, { scope1: "InNet('PWR')", priority: 0 }));
  S.rules.push(nova('RoutingVias', 'Via_PWR', { min: 0.8, pref: 1.0, max: 1.2, holeMin: 0.4, holePref: 0.5, holeMax: 0.6 }, { scope1: "InNet('PWR')", priority: 0 }));
  const so = {}; for (const k of ['Top', 'Bottom']) so[k] = k === 'Bottom';
  S.rules.push(nova('RoutingLayers', 'Layers_SOBE', { layers: so }, { scope1: "InNet('SOBE')", priority: 0 }));
  const bo = S.rules.find(r => r.kind === 'BoardOutlineClearance');
  bo.gap = 0.5;
  /* o DRC em lote confere tudo o que interessa aqui */
  S.verificar.lote = ['Clearance', 'ShortCircuit', 'BoardOutlineClearance', 'Width', 'RoutingVias', 'RoutingLayers'];
  return RG.normaliza(S);
}
const S = regras();

/* ---------------- placas ---------------- */
let seq = 0;
const id = p => p + (++seq);
function placaBase(W, H){
  const out = [[0, 0, W, 0], [W, 0, W, H], [W, H, 0, H], [0, H, 0, 0]].map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2 }));
  return { board: { bbox: { x1: 0, y1: 0, x2: W, y2: H }, outline: out }, layers: [{ key: 'Top' }, { key: 'Bottom' }],
           components: [], tracks: [], arcs: [], vias: [], fills: [], regions: [], texts: [], lines: [], silk: [], freepads: [], nets: [] };
}
function trilha(eb, layer, x1, y1, x2, y2, w, net){ const t = { id: id('t'), layer, x1, y1, x2, y2, w, net: net || '' }; eb.tracks.push(t); return t; }
function via(eb, x, y, size, drill, net){ const v = { id: id('v'), x, y, size, drill, net: net || '' }; eb.vias.push(v); return v; }
function pad(eb, ref, nome, x, y, o){
  let c = eb.components.find(k => k.ref === ref);
  if (!c) { c = { id: id('c'), ref, footprint: 'FP', layer: 'Top', x, y, rot: 0, pads: [] }; eb.components.push(c); }
  const p = Object.assign({ id: id('p'), name: nome, x, y, w: 1.6, h: 1.6, shape: 'circle', layer: 'Multi', type: 'th', drill: 0.8, rot: 0, net: '' }, o || {});
  c.pads.push(p);
  return p;
}

/* o DRC das checagens de folga, só nos objetos dados */
const drcFolga = (eb, ids) => DRC.rodar(eb, S, { ids, modo: 'lote', tipos: ['Clearance', 'ShortCircuit', 'BoardOutlineClearance'] });

/* ---------------- 1. a folga do par: roteador == DRC ---------------- */
function rnd(seed){ let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
{
  const R = rnd(20261022);
  const NETS = ['A', 'B', 'HV', 'PWR', ''];
  let conferidos = 0, conflitos = 0, faixa = 0;
  for (let placa = 0; placa < 12; placa++) {
    const eb = placaBase(40, 30);
    for (let i = 0; i < 25; i++) {
      const x = 3 + R() * 34, y = 3 + R() * 24, net = NETS[Math.floor(R() * NETS.length)];
      const k = R();
      if (k < 0.35) trilha(eb, R() < 0.5 ? 'Top' : 'Bottom', x, y, x + (R() - 0.5) * 12, y + (R() - 0.5) * 12, 0.2 + R() * 0.6, net);
      else if (k < 0.55) via(eb, x, y, 0.5 + R() * 0.4, 0.3, net);
      else if (k < 0.8) pad(eb, 'U' + placa, String(i), x, y, { net, shape: R() < 0.5 ? 'rect' : 'circle', w: 1 + R(), h: 1 + R(), rot: R() * 90 });
      else pad(eb, 'J' + placa, String(i), x, y, { net, type: 'smd', layer: R() < 0.5 ? 'Top' : 'Bottom', drill: 0, shape: 'roundrect', w: 0.6 + R(), h: 0.4 + R(), radius: 0.1 });
    }
    /* um furo NPTH (objeto "Hole" para a regra) e um keepout */
    pad(eb, 'MH' + placa, '1', 20, 15, { net: '', w: 3, h: 3, drill: 3 });
    eb.regions.push({ id: id('r'), layer: 'Top', keepout: true, net: '', points: [[30, 2], [36, 2], [36, 6], [30, 6]] });
    const C = HR.cena(eb, { regras: S, res: 0.1 });
    for (let k = 0; k < 160; k++) {
      const layer = R() < 0.5 ? 'Top' : 'Bottom', net = NETS[Math.floor(R() * NETS.length)];
      const x = 1 + R() * 38, y = 1 + R() * 28, w = 0.15 + R() * 0.5;
      const seg = { x1: x, y1: y, x2: x + (R() - 0.5) * 10, y2: y + (R() - 0.5) * 10, w };
      const f = HR.folgaTrilha(C, layer, seg, { net });
      /* a pior sobra (dist - folga da regra) pelo roteador */
      const pior = f.conflitos.reduce((m, c) => Math.min(m, c.dist - c.folga), Infinity);
      const eb2 = Object.assign({}, eb, { tracks: eb.tracks.concat([{ id: 'novo', layer, net, x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2, w }]) });
      const d = drcFolga(eb2, ['novo']);
      const acusou = d.violacoes.some(v => v.ids.includes('novo') && (v.tipo === 'Clearance' || v.tipo === 'BoardOutlineClearance' || v.tipo === 'ShortCircuit'));
      conferidos++;
      if (f.ok) {
        assert.ok(!acusou, `o roteador liberou e o DRC acusou: ${JSON.stringify(seg)} net ${net} ${layer}\n${d.violacoes.map(v => v.msg).join('\n')}`);
      } else {
        conflitos++;
        /* o DRC tolera 1 µm (o Altium mede em 1/10000 mil); a sobra menor que isso fica na faixa */
        if (pior < -2e-3) assert.ok(acusou, `o roteador acusou (${pior.toFixed(4)} mm) e o DRC liberou: ${JSON.stringify(seg)} net ${net} ${layer} — ${JSON.stringify(f.conflitos.slice(0, 3))}`);
        else faixa++;
      }
    }
  }
  assert.ok(conflitos > 200 && conferidos - conflitos > 200, `amostra equilibrada (${conflitos} conflitos em ${conferidos})`);
  console.log(`  folga do par: ${conferidos} segmentos, ${conflitos} com conflito, ${faixa} na faixa de 1 µm — roteador e DRC concordam`);
}

/* ---------------- 2 e 3. a regra de escopo muda a rota, e toda rota sai limpa no DRC ---------------- */
{
  const eb = placaBase(40, 30);
  /* um corredor de 1,2 mm entre duas trilhas da net X (bordas de cobre a 1,2 mm uma da outra) */
  trilha(eb, 'Top', 15, 0.6, 15, 14.4, 0.4, 'X');
  trilha(eb, 'Top', 15, 15.6, 15, 29.4, 0.4, 'X');
  /* o vão em y=15 entre as duas: livre de 14.6 a 15.4 -> 0,8 mm. As pontas de fora ficam a menos
     de 0,5 mm (Board Outline Clearance) do contorno: só se passa pelo vão */
  const C = HR.cena(eb, { regras: S });
  const req = net => ({ layer: 'Top', w: 0.2, net, de: [5, 15], ate: [25, 15], modo: '45', conflito: 'contornar' });
  const comum = HR.rota(C, req('A')), hv = HR.rota(C, req('HV'));
  assert.ok(comum.completa, 'a net comum chega: ' + comum.motivo);
  const passaPeloVao = pts => pts.some((p, i) => i && Math.min(p[1], pts[i - 1][1]) <= 15.0001 && Math.max(p[1], pts[i - 1][1]) >= 14.9999 && Math.min(p[0], pts[i - 1][0]) < 15 && Math.max(p[0], pts[i - 1][0]) > 15);
  assert.ok(passaPeloVao(comum.pts), 'a net comum atravessa o vão de 0,8 mm (precisa de 0,2 + 2×0,254)');
  assert.ok(!hv.completa || !passaPeloVao(hv.pts), 'a net HV (1 mm de folga) não cabe no vão');
  /* as duas gravadas na placa: o DRC não acusa nada nelas */
  for (const [nome, r] of [['A', comum], ['HV', hv]]) {
    const eb2 = Object.assign({}, eb, { tracks: eb.tracks.slice() });
    const ids = [];
    for (let i = 1; i < r.pts.length; i++) { const t = { id: 'r' + nome + i, layer: 'Top', net: nome, x1: r.pts[i - 1][0], y1: r.pts[i - 1][1], x2: r.pts[i][0], y2: r.pts[i][1], w: 0.2 }; eb2.tracks.push(t); ids.push(t.id); }
    const d = drcFolga(eb2, ids);
    assert.strictEqual(d.total, 0, `rota da net ${nome} sai limpa no DRC: ${d.violacoes.map(v => v.msg).join(' | ')}`);
  }
  console.log(`  escopo: net A atravessa o vão (${comum.pts.length} vértices), net HV ${hv.completa ? 'contorna' : 'para antes'} — as duas limpas no DRC`);
}

/* ---------------- 2b. rotas sorteadas, gravadas, DRC limpo ---------------- */
{
  const R = rnd(777);
  let rotas = 0, completas = 0;
  for (let placa = 0; placa < 8; placa++) {
    const eb = placaBase(40, 30);
    const nets = ['A', 'B', 'HV', 'PWR'];
    for (let i = 0; i < 18; i++) {
      const x = 4 + R() * 32, y = 4 + R() * 22, net = nets[Math.floor(R() * nets.length)];
      if (R() < 0.5) pad(eb, 'U' + placa, String(i), x, y, { net, shape: 'rect', w: 1.5, h: 1.5 });
      else trilha(eb, 'Top', x, y, x + (R() - 0.5) * 10, y + (R() - 0.5) * 10, 0.3, net);
    }
    eb.regions.push({ id: id('r'), layer: 'Top', keepout: true, net: '', points: [[12, 12], [16, 12], [16, 16], [12, 16]] });
    const C = HR.cena(eb, { regras: S });
    for (let k = 0; k < 14; k++) {
      const net = nets[Math.floor(R() * nets.length)];
      const de = [1.5 + R() * 37, 1.5 + R() * 27], ate = [1.5 + R() * 37, 1.5 + R() * 27];
      if (HR.folgaTrilha(C, 'Top', { x1: de[0], y1: de[1], x2: de[0], y2: de[1], w: 0.25 }, { net }).ok === false) continue;
      const r = HR.rota(C, { layer: 'Top', w: 0.25, net, de, ate, modo: R() < 0.5 ? '45' : '90', conflito: 'contornar' });
      rotas++;
      if (!r.pts || r.pts.length < 2) continue;
      if (r.completa) completas++;
      const eb2 = Object.assign({}, eb, { tracks: eb.tracks.slice() }), ids = [];
      for (let i = 1; i < r.pts.length; i++) { const t = { id: 'n' + i, layer: 'Top', net, x1: r.pts[i - 1][0], y1: r.pts[i - 1][1], x2: r.pts[i][0], y2: r.pts[i][1], w: 0.25 }; eb2.tracks.push(t); ids.push(t.id); }
      const d = drcFolga(eb2, ids);
      assert.strictEqual(d.total, 0, `rota ${k} da placa ${placa} (net ${net}, ${r.motivo}) com violação: ${d.violacoes.map(v => v.msg).join(' | ')}`);
    }
  }
  assert.ok(completas >= 40, `rotas completas suficientes (${completas} de ${rotas})`);
  console.log(`  rotas sorteadas: ${rotas} (${completas} completas) — todas limpas no DRC (Clearance, curto, contorno)`);
}

/* ---------------- 4. Width, Routing Via Style e Routing Layers da net ---------------- */
{
  const eb = placaBase(30, 20);
  const C = HR.cena(eb, { regras: S });
  assert.strictEqual(HR.larguraDaRegra(C, 'PWR', 'Top').pref, 0.8, 'Width_PWR: preferida 0,8');
  assert.strictEqual(HR.larguraDaRegra(C, 'PWR', 'Top').regra, 'Width_PWR');
  assert.ok(Math.abs(HR.larguraDaRegra(C, 'A', 'Top').pref - 0.254) < 1e-4, 'net comum: a Width da casa (10 mil)');
  const v = HR.viaDaRegra(C, 'PWR');
  assert.deepStrictEqual([v.size, v.drill, v.regra], [1.0, 0.5, 'Via_PWR'], 'Via_PWR: 1,0/0,5');
  const vc = HR.viaDaRegra(C, 'A');
  assert.ok(Math.abs(vc.size - 0.5) < 1e-4 && Math.abs(vc.drill - 0.3) < 1e-4, 'via comum: a da casa (0,5/0,3)');
  /* a rota sem largura pega a da regra */
  const r = HR.rota(C, { layer: 'Top', net: 'PWR', de: [3, 3], ate: [20, 10], modo: '45' });
  assert.ok(r.completa);
  /* o valor escolhido fora da faixa da regra vira o limite (Altium) */
  assert.deepStrictEqual([HR.limitaLargura(C, 'PWR', 'Top', 3).w, HR.limitaLargura(C, 'PWR', 'Top', 3).ajustada], [1.5, true]);
  assert.deepStrictEqual([HR.limitaLargura(C, 'PWR', 'Top', 0.2).w, HR.limitaLargura(C, 'PWR', 'Top', 1).ajustada], [0.5, false]);
  const lv = HR.limitaVia(C, 'PWR', 2, 0.1);
  assert.deepStrictEqual([lv.size, lv.drill, lv.ajustada], [1.2, 0.4, true], 'via presa à Via_PWR');
  assert.ok(!HR.limitaVia(C, 'PWR', 1.1, 0.5).ajustada);
  assert.ok(!HR.camadaPermitida(C, 'SOBE', 'Top') && HR.camadaPermitida(C, 'SOBE', 'Bottom'), 'Layers_SOBE: só Bottom');
  const p = HR.rota(C, { layer: 'Top', net: 'SOBE', de: [3, 3], ate: [20, 10], modo: '45' });
  assert.strictEqual(p.motivo, 'camada-proibida');
  assert.ok(HR.rota(C, { layer: 'Bottom', net: 'SOBE', de: [3, 3], ate: [20, 10], modo: '45' }).completa);
  /* e o DRC acusa a mesma coisa: trilha de SOBE no Top, PWR fina, via de PWR pequena */
  const eb2 = Object.assign({}, eb, { tracks: [{ id: 'ts', layer: 'Top', net: 'SOBE', x1: 3, y1: 3, x2: 8, y2: 3, w: 0.3 }, { id: 'tp', layer: 'Bottom', net: 'PWR', x1: 3, y1: 8, x2: 8, y2: 8, w: 0.3 }],
                                      vias: [{ id: 'vp', x: 15, y: 15, size: 0.5, drill: 0.3, net: 'PWR' }] });
  const d = DRC.rodar(eb2, S, { modo: 'lote', tipos: ['Width', 'RoutingLayers', 'RoutingVias'] });
  const tipos = d.violacoes.map(x => x.tipo + ':' + x.ids.join(',')).sort();
  assert.deepStrictEqual(tipos, ['RoutingLayers:ts', 'RoutingVias:vp', 'RoutingVias:vp', 'Width:tp'], 'o DRC confere as mesmas regras: ' + tipos.join(' '));
  console.log('  Width / Routing Via Style / Routing Layers: a rota usa a regra da net, e o DRC confere a mesma');
}

/* ---------------- 5. keepout ---------------- */
{
  const eb = placaBase(30, 20);
  eb.lines.push({ id: 'k1', layer: 'KeepOut', x1: 15, y1: 0.5, x2: 15, y2: 19.5, w: 0.2 });
  const C = HR.cena(eb, { regras: S });
  const r = HR.rota(C, { layer: 'Bottom', w: 0.25, net: 'A', de: [5, 10], ate: [25, 10], modo: '45' });
  assert.ok(!r.completa, 'a linha na camada KeepOut barra a rota de lado a lado (todas as camadas)');
  const eb2 = Object.assign({}, eb, { tracks: [{ id: 'tk', layer: 'Bottom', net: 'A', x1: 5, y1: 10, x2: 25, y2: 10, w: 0.25 }] });
  const d = drcFolga(eb2, ['tk']);
  assert.ok(d.violacoes.some(v => v.tipo === 'Clearance' && v.ids.includes('k1') && /Keepout/.test(v.msg)), 'o DRC acusa a trilha que cruza o keepout: ' + d.violacoes.map(v => v.msg).join(' | '));
  /* trilha longe do keepout: nada */
  const eb3 = Object.assign({}, eb, { tracks: [{ id: 'tl', layer: 'Bottom', net: 'A', x1: 5, y1: 10, x2: 14, y2: 10, w: 0.25 }] });
  assert.strictEqual(drcFolga(eb3, ['tl']).total, 0);
  console.log('  keepout: o roteador não atravessa e o DRC acusa quem atravessa');
}

/* ---------------- 6. folga ao contorno = Board Outline Clearance ---------------- */
{
  const eb = placaBase(30, 20);
  const C = HR.cena(eb, { regras: S, res: 0.05 });
  const f = HR.folgaTrilha(C, 'Top', { x1: 5, y1: 0.55, x2: 25, y2: 0.55, w: 0.2 }, { net: 'A' });
  assert.ok(!f.ok && f.conflitos[0].id === 'borda' && Math.abs(f.conflitos[0].folga - 0.5) < 1e-9, 'a 0,45 mm da borda viola a regra de 0,5 mm');
  assert.ok(HR.folgaTrilha(C, 'Top', { x1: 5, y1: 0.6001, x2: 25, y2: 0.6001, w: 0.2 }, { net: 'A' }).ok, 'a 0,5001 mm passa');
  const eb2 = Object.assign({}, eb, { tracks: [{ id: 'tb', layer: 'Top', net: 'A', x1: 5, y1: 0.55, x2: 25, y2: 0.55, w: 0.2 }] });
  assert.ok(drcFolga(eb2, ['tb']).violacoes.some(v => v.tipo === 'BoardOutlineClearance'), 'o DRC acusa o mesmo');
  /* sem a regra no conjunto, nem o roteador nem o DRC pedem folga à borda (só não sair da placa) */
  const S0 = RG.normaliza(Object.assign({}, S, { rules: S.rules.filter(r => r.kind !== 'BoardOutlineClearance') }));
  const C0 = HR.cena(eb, { regras: S0 });
  assert.ok(HR.folgaTrilha(C0, 'Top', { x1: 5, y1: 0.11, x2: 25, y2: 0.11, w: 0.2 }, { net: 'A' }).ok);
  assert.ok(!HR.folgaTrilha(C0, 'Top', { x1: 5, y1: 0.09, x2: 25, y2: 0.09, w: 0.2 }, { net: 'A' }).ok, 'sair da placa nunca vale');
  console.log('  contorno: a folga é a da Board Outline Clearance, no roteador e no DRC');
}

/* ---------------- 7. sem regras na cena: o comportamento de antes (folga única) ---------------- */
{
  const eb = placaBase(30, 20);
  trilha(eb, 'Top', 10, 5, 10, 15, 0.3, 'X');
  const C = HR.cena(eb, { clearance: 0.254 });
  assert.strictEqual(C.regras, null);
  const f = HR.folgaTrilha(C, 'Top', { x1: 10.6, y1: 5, x2: 10.6, y2: 15, w: 0.2 }, { net: 'HV' });
  assert.ok(f.ok, 'sem regras, HV usa a folga única');
  const C2 = HR.cena(eb, { regras: S });
  assert.ok(!HR.folgaTrilha(C2, 'Top', { x1: 10.6, y1: 5, x2: 10.6, y2: 15, w: 0.2 }, { net: 'HV' }).ok, 'com regras, HV pede 1 mm');
  assert.ok(Math.abs(C2.clearance - 0.254) < 1e-6, 'a folga "da placa" é a Clearance geral do conjunto');
}

/* ---------------- 8. as placas do acervo (o board.js de Projects), com as regras da casa + as do espelho ----------------
   o mesmo par roteador x DRC em placas reais, e nenhuma rota com violação calada: a que sai de uma
   partida já em conflito (pad de passo fino com a largura da regra) vem com `violacoes` */
{
  const fs = require('fs'), path = require('path');
  const G = require('../hub-gerber.js');
  const PCB = require('../mcp/ferramentas/pcb.js');
  const ctxM = { modulo: n => { try { return require(path.join(__dirname, '..', n)); } catch (e) { return null; } } };
  const tg = t => { if (!t || t.hidden) return null; try { return G.geometriaTexto(t); } catch (e) { return null; } };
  const lerVar = (f, v) => new Function(fs.readFileSync(f, 'utf8') + ';return ' + v + ';')();
  const ehCobre = k => /^(Top|Bottom|Mid\d+)$/.test(k);
  const PLACAS = ['DMB - DI231765_P2', 'PRJ-UR-DI261924', 'PACI-DI221687', 'SD - DI251838'];
  let segs = 0, rotas = 0, declaradas = 0;
  for (const nome of PLACAS) {
    const f = path.join(__dirname, '..', 'Projects', nome, 'board.js');
    if (!fs.existsSync(f)) continue;
    const eb = lerVar(f, 'pcbmirror'), RS = RG.doBoard(eb);
    const C = HR.cena(eb, { regras: RS, placa: { lacos: PCB._interno.lacosDe(ctxM, eb), recortes: [] }, textoGeo: tg });
    const cams = C.camadas.filter(ehCobre), nets = (eb.nets || []).map(n => typeof n === 'string' ? n : n.name).filter(Boolean);
    const anc = [];
    for (const t of eb.tracks || []) if (ehCobre(t.layer)) anc.push([t.x1, t.y1, t.layer]);
    for (const c of eb.components || []) for (const p of c.pads || []) anc.push([p.x, p.y, p.layer === 'Multi' || p.type === 'th' ? null : p.layer, p]);
    const R = rnd(nome.length * 104729);
    const drc = (novos) => DRC.rodar(Object.assign({}, eb, { tracks: (eb.tracks || []).concat(novos), cutouts: [] }), RS,
      { ids: novos.map(t => t.id), modo: 'lote', tipos: ['Clearance', 'ShortCircuit', 'BoardOutlineClearance'], textoGeo: tg });
    for (let k = 0; k < 60; k++) {
      const a = anc[Math.floor(R() * anc.length)], layer = a[2] || cams[Math.floor(R() * cams.length)];
      const net = R() < 0.15 ? '' : nets[Math.floor(R() * nets.length)];
      const x = a[0] + (R() - 0.5) * 2, y = a[1] + (R() - 0.5) * 2;
      const seg = { x1: x, y1: y, x2: x + (R() - 0.5) * 4, y2: y + (R() - 0.5) * 4, w: 0.15 + R() * 0.4 };
      const fr = HR.folgaTrilha(C, layer, seg, { net });
      const pior = fr.conflitos.reduce((m, c) => Math.min(m, c.dist - c.folga), Infinity);
      const acusou = drc([{ id: 'novo', layer, net, x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2, w: seg.w }]).total > 0;
      if (fr.ok) assert.ok(!acusou, `${nome}: o roteador liberou e o DRC acusou ${JSON.stringify(seg)} ${net} ${layer}`);
      else if (pior < -2e-3) assert.ok(acusou, `${nome}: o roteador acusou e o DRC liberou ${JSON.stringify(seg)} ${net} ${layer} ${JSON.stringify(fr.conflitos.slice(0, 2))}`);
      segs++;
    }
    for (let k = 0; k < 15; k++) {
      const a = anc.filter(q => q[3] && q[3].net)[Math.floor(R() * anc.filter(q => q[3] && q[3].net).length)], p = a[3];
      const layer = a[2] || cams[Math.floor(R() * cams.length)];
      const b = anc[Math.floor(R() * anc.length)], ate = [b[0] + (R() - 0.5) * 6, b[1] + (R() - 0.5) * 6];
      const w = HR.larguraDaRegra(C, p.net, layer).pref;
      const r = HR.rota(C, { layer, w, net: p.net, de: [p.x, p.y], ate, modo: '45', conflito: 'contornar', orcamento: 30000 });
      if (!r.pts || r.pts.length < 2) continue;
      rotas++;
      const novos = r.pts.slice(1).map((q, i) => ({ id: 'r' + i, layer, net: p.net, x1: r.pts[i][0], y1: r.pts[i][1], x2: q[0], y2: q[1], w }));
      const d = drc(novos);
      if (r.violacoes.length) declaradas++;
      assert.ok(!d.total || r.violacoes.length, `${nome}: rota com violação calada: ${d.violacoes.slice(0, 2).map(v => v.msg).join(' | ')}`);
    }
  }
  console.log(`  acervo: ${segs} segmentos em ${PLACAS.length} placas reais concordam; ${rotas} rotas, ${declaradas} com violação herdada da partida (declarada)`);
}

console.log('test-roteador-regras OK');
