/* As peças puras do Auto-rotear da vista PCB (Route » Auto Route » All), sem navegador:
     node tests/test-autorotear-vista.js

   1. o lote como GERADOR (HubAutoRoteador.lote): o progresso a cada conexão e, no fim, o MESMO
      relatório do rotearLote (as mesmas ops);
   2. as ops como objetos da placa (previa / comPrevia) e as violações NOVAS de DRC (novasViolacoes: a
      net não roteada fora, o pedaço de plano redespejado pelo polígono);
   3. o lote em fatias (rodaEmFatias): o progresso, o fim, o Cancelar (o gerador fecha) e o erro;
   4. o PROTOCOLO do worker (hub-autoroteador-worker.js » atende): pedido e respostas clonáveis
      (structuredClone, a regra do postMessage), progresso -> fim com as ops e o DRC; erro; mensagem
      que não é pedido não responde nada;
   5. o worker DE VERDADE: o arquivo rodado num contexto à parte com importScripts, self e
      postMessage (o que o navegador dá ao Web Worker) — os módulos carregam na ordem e a resposta
      sai pelo onmessage. */
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const AR = require('../hub-autoroteador.js');
const W = require('../hub-autoroteador-worker.js');
const RG = require('../hub-pcbregras.js');
const HR = require('../hub-roteador.js');

let falhou = 0;
async function caso(nome, fn){
  try { await fn(); console.log('ok  ' + nome); }
  catch (e) { falhou++; console.log('FALHOU  ' + nome + '\n   ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n   ')); }
}

/* a placa do cruzamento (a do tests/test-autoroteador.js): duas nets que só fecham com via */
function placa(){
  let seq = 0;
  const id = p => p + (++seq);
  const W0 = 40, H0 = 20;
  const out = [[0, 0, W0, 0], [W0, 0, W0, H0], [W0, H0, 0, H0], [0, H0, 0, 0]].map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2 }));
  const eb = { board: { bbox: { x1: 0, y1: 0, x2: W0, y2: H0 }, outline: out }, layers: [{ key: 'Top' }, { key: 'Bottom' }],
               components: [], tracks: [], arcs: [], vias: [], fills: [], regions: [], texts: [], lines: [], silk: [], freepads: [], nets: ['A', 'B'] };
  const pad = (ref, x, y, net, w, h) => eb.components.push({ id: id('c'), ref, footprint: 'FP', layer: 'Top', x, y, rot: 0,
    pads: [{ id: id('p'), name: '1', x, y, w, h, shape: 'rect', layer: 'Top', type: 'smd', drill: 0, rot: 0, net }] });
  pad('J1', 0.9, 10, 'A', 1.0, 3); pad('J2', 39.1, 10, 'A', 1.0, 3);
  pad('U1', 20, 0.9, 'B', 3, 1.0); pad('U2', 20, 19.1, 'B', 3, 1.0);
  return eb;
}
const S = RG.normaliza(RG.padroesCasa());

(async () => {
  await caso('o gerador dá o progresso e o mesmo relatório do rotearLote', () => {
    const eb = placa();
    const direto = AR.rotearLote(eb, { regras: S });
    const g = AR.lote(eb, { regras: S });
    const prog = [];
    let fim;
    for (;;) { const p = g.next(); if (p.done) { fim = p.value; break; } prog.push(p.value); }
    assert.deepStrictEqual(fim.ops, direto.ops, 'as mesmas ops');
    assert.deepStrictEqual([fim.depois, fim.vias, fim.roteadas], [direto.depois, direto.vias, direto.roteadas]);
    assert.ok(prog.length >= 3 && prog[0].fase === 'rota' && prog[0].feitas === 0, 'começa com 0 de N');
    const rota = prog.filter(p => p.fase === 'rota');
    assert.ok(rota.every((p, i) => !i || p.feitas >= rota[i - 1].feitas), 'feitas só cresce');
    assert.strictEqual(rota[rota.length - 1].feitas, rota[0].total, 'termina em N de N');
    for (const p of prog) for (const k of ['fase', 'feitas', 'total', 'passe', 'roteadas', 'falhas', 'conexoes', 'ms']) assert.ok(k in p, 'progresso traz ' + k);
  });

  await caso('previa / comPrevia: as ops como objetos da placa, sem mexer na placa de antes', () => {
    const ops = [{ op: 'track_add', layer: 'Top', x1: 1, y1: 2, x2: 3, y2: 2, w: 0.25, net: 'A', note: 'x' },
                 { op: 'via_add', x: 3, y: 2, size: 0.5, drill: 0.3, net: 'A' },
                 { op: 'track_add', layer: 'Bottom', x1: 3, y1: 2, x2: 3, y2: 5, w: 0.25 }, { op: 'comp_move', ref: 'R1' }, null];
    const p = AR.previa(ops);
    assert.deepStrictEqual(p.tracks.map(t => [t.id, t.layer, t.net]), [['auto-t1', 'Top', 'A'], ['auto-t2', 'Bottom', '']]);
    assert.deepStrictEqual(p.vias, [{ id: 'auto-v1', x: 3, y: 2, size: 0.5, drill: 0.3, net: 'A', from: 'Top', to: 'Bottom' }]);
    const eb = placa(), n0 = eb.tracks.length;
    const e2 = AR.comPrevia(eb, ops);
    assert.strictEqual(e2.tracks.length, n0 + 2); assert.strictEqual(e2.vias.length, 1);
    assert.strictEqual(eb.tracks.length, n0, 'a placa de antes não muda');
    assert.strictEqual(e2.components, eb.components, 'o resto é o mesmo objeto');
  });

  await caso('novasViolacoes: a net não roteada fora, o plano redespejado pelo polígono', () => {
    const v = (tipo, ids) => ({ tipo, ids, msg: tipo + ids.join(',') });
    const antes = { violacoes: [v('Clearance', ['t1', 'q:pg1:3']), v('UnRoutedNet', ['p1', 'p2'])] };
    const depois = { violacoes: [v('Clearance', ['q:pg1:7', 't1']), v('UnRoutedNet', ['p1', 'p9']), v('Clearance', ['auto-t1', 'p4']), v('ShortCircuit', ['t1', 'q:pg1:3'])] };
    const n = AR.novasViolacoes(antes, depois);
    assert.deepStrictEqual(n.map(x => x.tipo + ':' + x.ids.join(',')), ['Clearance:auto-t1,p4', 'ShortCircuit:t1,q:pg1:3']);
    assert.deepStrictEqual(AR.novasViolacoes(null, null), []);
  });

  await caso('rodaEmFatias: progresso, fim, Cancelar e erro', async () => {
    const fila = [];
    const agenda = f => fila.push(f);
    const roda = async (P) => { while (fila.length) fila.shift()(); return P; };
    /* um gerador que leva 3 fatias (cada passo "dura" 15 ms de um relógio falso não serve: a fatia
       é por tempo real; aqui, fatiaMs mínimo força uma parada por passo) */
    function* g3(){ yield { feitas: 1 }; yield { feitas: 2 }; return 'pronto'; }
    let vistos = [];
    let P = AR.rodaEmFatias(g3(), { fatiaMs: 1e-9, agenda, aoProgresso: p => vistos.push(p.feitas) });
    let r = await roda(P);
    assert.deepStrictEqual(r, { ok: true, valor: 'pronto' });
    assert.deepStrictEqual(vistos, [1, 2], 'um progresso por fatia');
    /* cancelar: o gerador fecha (o finally roda) e nada mais é pedido */
    let fechou = false, cancel = false;
    function* g4(){ try { for (let i = 0; i < 100; i++) yield { feitas: i }; return 'nunca'; } finally { fechou = true; } }
    P = AR.rodaEmFatias(g4(), { fatiaMs: 1e-9, agenda, aoProgresso: p => { if (p.feitas === 3) cancel = true; }, cancelado: () => cancel });
    r = await roda(P);
    assert.deepStrictEqual(r, { ok: false, cancelado: true });
    assert.ok(fechou, 'o gerador foi fechado');
    /* erro dentro do lote */
    function* g5(){ yield {}; throw new Error('quebrou'); }
    r = await roda(AR.rodaEmFatias(g5(), { fatiaMs: 1e-9, agenda }));
    assert.deepStrictEqual(r, { ok: false, erro: 'quebrou' });
    /* e com o setTimeout de verdade e o lote de verdade: o mesmo resultado do rotearLote */
    const eb = placa();
    const real = await AR.rodaEmFatias(AR.lote(eb, { regras: S }), { fatiaMs: 5 });
    assert.ok(real.ok);
    assert.deepStrictEqual(real.valor.ops, AR.rotearLote(eb, { regras: S }).ops);
  });

  const pedido = (extra) => Object.assign({ tipo: 'roda', id: 7, eb: placa(), regras: S, placa: null, textos: {}, opcoes: { note: 'auto-rotear da vista' } }, extra || {});
  await caso('protocolo do worker: progresso -> fim com as ops e o DRC, tudo clonável', () => {
    const msg = structuredClone(pedido());           /* o que o postMessage da página entrega */
    const saida = [];
    W.atende(msg, m => saida.push(structuredClone(m)));
    const fim = saida[saida.length - 1];
    assert.strictEqual(fim.tipo, 'fim', JSON.stringify(saida.filter(m => m.tipo === 'erro')));
    assert.ok(saida.every(m => m.id === 7), 'toda resposta leva o id do pedido');
    const prog = saida.filter(m => m.tipo === 'progresso');
    assert.ok(prog.length >= 2 && prog.some(m => m.fase === 'drc'), 'progresso do lote e do DRC');
    const ref = AR.rotearLote(placa(), { regras: S, note: 'auto-rotear da vista' });
    assert.deepStrictEqual(fim.r.ops, ref.ops, 'as ops do worker = as do rotearLote');
    assert.ok(fim.r.ops.every(o => o.note === 'auto-rotear da vista'));
    assert.ok(fim.drc && fim.drc.nNovas === 0 && fim.drc.depois < fim.drc.antes, 'DRC: nenhuma nova, e as não roteadas sumiram: ' + JSON.stringify(fim.drc));
    /* sem DRC quando a página não pede */
    const s2 = [];
    W.atende(pedido({ drc: false }), m => s2.push(m));
    assert.strictEqual(s2[s2.length - 1].drc, null);
  });
  await caso('protocolo do worker: erro e mensagem que não é pedido', () => {
    const s = [];
    W.atende({ tipo: 'roda', id: 3, eb: { components: 5 }, opcoes: {} }, m => s.push(m));
    assert.strictEqual(s.length, 1); assert.strictEqual(s[0].tipo, 'erro'); assert.strictEqual(s[0].id, 3);
    assert.ok(typeof s[0].msg === 'string' && s[0].msg);
    const s2 = [];
    W.atende({ tipo: 'outra coisa' }, m => s2.push(m)); W.atende(null, m => s2.push(m));
    assert.deepStrictEqual(s2, []);
    /* a geometria de texto que vem da página vira a função da cena */
    const tg = W.textoGeoDe({ x1: { tracos: [[[0, 0], [1, 0]]], w: 0.2 } });
    assert.ok(tg({ id: 'x1' }) && tg({ id: 'x2' }) === null && tg({ id: 'x1', hidden: true }) === null);
    assert.strictEqual(W.textoGeoDe(null), undefined);
  });

  await caso('o worker de verdade: importScripts, self e postMessage num contexto à parte', async () => {
    const RAIZ = path.join(__dirname, '..');
    const saida = [];
    const ctx = { console, Date, Math, JSON, setTimeout, clearTimeout, performance,
                  postMessage: m => saida.push(structuredClone(m)) };
    ctx.self = ctx;
    ctx.importScripts = (...fs0) => { for (const f of fs0) vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f }); };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'hub-autoroteador-worker.js'), 'utf8'), ctx, { filename: 'hub-autoroteador-worker.js' });
    assert.strictEqual(typeof ctx.onmessage, 'function', 'o worker se pendura no onmessage');
    for (const g of ['HubPcbRegras', 'HubPcbNets', 'HubPcbDrc']) assert.ok(ctx[g], 'o worker carregou ' + g);
    assert.ok(vm.runInContext('typeof HubRoteador === "object" && typeof HubAutoRoteador === "object"', ctx), 'os const do topo dos módulos ficam visíveis entre os scripts');
    ctx.onmessage({ data: structuredClone(pedido({ id: 11 })) });
    const fim = saida[saida.length - 1];
    assert.strictEqual(fim && fim.tipo, 'fim', JSON.stringify(saida.filter(m => m.tipo === 'erro')));
    assert.ok(fim.r.depois.conexoes === 0 && fim.r.vias >= 2 && fim.drc.nNovas === 0, 'fecha o cruzamento com via, sem violação nova');
    assert.ok(!ctx.HubAutoRoteadorWorker, 'no worker não há o global da página');
  });

  await caso('a cena do worker = a da vista (mesmas regras, contorno e textos)', () => {
    /* o pedido que a vista monta (hub-pcbautorota.js » comeca) roteia igual à cena montada à mão */
    const eb = placa();
    const C = HR.cena(eb, { regras: S });
    const a = AR.rotearLote(eb, { cena: C });
    const s = [];
    W.atende(pedido({ eb, drc: false }), m => s.push(m));
    assert.deepStrictEqual(s[s.length - 1].r.ops.map(o => Object.assign({}, o, { note: undefined })), a.ops.map(o => Object.assign({}, o, { note: undefined })));
  });

  if (falhou) { console.log(`test-autorotear-vista FALHOU (${falhou})`); process.exit(1); }
  console.log('test-autorotear-vista OK');
})();
