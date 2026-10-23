/* Placas do zero, de ponta a ponta, pelas ferramentas do MCP (o que a IA e a vista fazem):
     node tests/test-e2e-placas.js

   Para cada projeto: a LISTA DE LIGAÇÕES que se quer (net -> pinos) é a verdade, e cada etapa
   tem de concordar com ela:
     1. esquema: componentes da biblioteca real, ligados por fio, rótulo de net e power port;
        sch_validar limpo e sch_nets = a lista (mesmas nets, mesmos pinos);
     2. placa nova (hub-pcbnova) + ECO: cada pad do footprint com a net do pino do esquema, e o
        eco_comparar sem nada pendente;
     3. posicionar e rotear com o roteador (pcb_rotear, as regras do rules.js) até o ratsnest
        zerar; trilha com a largura da regra da net;
     4. DRC (o lote da casa + as regras do projeto) aprovado: sem Clearance, curto, net não
        roteada, largura, via, furo ou contorno;
     5. Gerber: a furação do arquivo (flashes de furo, PTH e NPTH) = os furos dos pads e das vias
        da placa, um a um, com o diâmetro; e o cobre de cima tem um flash por pad do Top.
   Roda numa pasta temporária: nada do repositório é gravado. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');

process.env.ELETRICHUB_SEM_RELATO = '1';
const RAIZ = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-placas-'));
const PROJETOS = path.join(TMP, 'Projects');
fs.mkdirSync(PROJETOS);
fs.writeFileSync(path.join(TMP, 'projects.js'), 'var projects = [\n];\n');
const GV = require('../hub-gerberview.js');

const { montaServidor } = require('../mcp/eletrichub-mcp.js');
/* a raiz É o repositório: sem ela o servidor seguiria o app instalado (session.json/settings.json)
   e testaria os módulos de lá, não os daqui */
const srv = montaServidor({ root: RAIZ, projetos: PROJETOS, log: () => {} });
assert.strictEqual(path.resolve(srv.ctx.root), path.resolve(RAIZ), 'o MCP carrega os módulos deste repositório');
let seq = 0;
async function chama(name, args) {
  const r = await srv.atende({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } });
  const o = JSON.parse(r.result.content[0].text);
  if (r.result.isError) throw new Error(name + ': ' + (o.erro || JSON.stringify(o).slice(0, 1500)));
  return o;
}

/* ------------------------------------------------------------------ o esquema */
/* a direção "para fora" de um pino: da média dos pinos do componente para a ponta dele */
function paraFora(pinos, q) {
  const cx = pinos.reduce((s, p) => s + p.x, 0) / pinos.length, cy = pinos.reduce((s, p) => s + p.y, 0) / pinos.length;
  const dx = q.x - cx, dy = q.y - cy;
  if (pinos.length === 1 || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) return [0, 1];
  return Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
}
/* comps: [{ref, sym, footprint, x, y, part?}]; nets: {NOME: ['R1.1', ...]}; power: nets que vão
   por power port; fio: [['R1.2','D1.A']] pares ligados por fio direto (a net fica com o nome do
   rótulo de outro pino dela, ou com o nome automático) */
async function montaEsquema(proj, comps, nets, opc) {
  opc = opc || {};
  const add = await chama('sch_adicionar', { projeto: proj, itens: comps.map(c => Object.assign({ t: 'comp' }, c)) });
  assert.ok(add.gravado, proj + ': componentes no esquema: ' + JSON.stringify(add.erros || add).slice(0, 800));
  const lidos = (await chama('sch_componentes', { projeto: proj })).componentes;
  const ponta = {};
  for (const c of lidos) for (const q of c.pinos) ponta[c.ref + '.' + q.num] = { q, pinos: c.pinos };
  const itens = [], fio = new Set();
  for (const [a, b] of opc.fio || []) {
    const r = await chama('sch_ligar', { projeto: proj, de: a, para: b });
    assert.ok(r.gravado, proj + ': fio ' + a + '-' + b + ': ' + JSON.stringify(r.erros || r).slice(0, 500));
    fio.add(a); fio.add(b);
  }
  for (const [net, pinos] of Object.entries(nets)) {
    let rotulou = false;
    for (const pino of pinos) {
      const P = ponta[pino];
      assert.ok(P, proj + ': pino ' + pino + ' não existe no símbolo');
      /* o pino ligado por fio a outro da mesma net: um rótulo basta para os dois */
      if (fio.has(pino) && rotulou) continue;
      const d = paraFora(P.pinos, P.q), x2 = P.q.x + d[0] * 200, y2 = P.q.y + d[1] * 200;
      itens.push({ t: 'wire', pts: [[P.q.x, P.q.y], [x2, y2]] });
      if ((opc.power || []).includes(net)) itens.push({ t: 'power', net, style: net === 'GND' ? 'GndPower' : 'Bar', x: x2, y: y2, rot: d[1] < 0 ? 270 : 90 });
      else itens.push({ t: 'netlabel', net, x: x2, y: y2 });
      rotulou = true;
    }
  }
  const r = await chama('sch_adicionar', { projeto: proj, itens });
  assert.ok(r.gravado, proj + ': fios e rótulos: ' + JSON.stringify(r.erros || r).slice(0, 800));
  const v = await chama('sch_validar', { projeto: proj });
  assert.ok(v.ok, proj + ': sch_validar: ' + JSON.stringify(v).slice(0, 1200));
  /* as nets do esquema = a lista pedida */
  const sn = await chama('sch_nets', { projeto: proj });
  const pinoPara = s => s.replace('.', '-');
  for (const [net, pinos] of Object.entries(nets)) {
    const n = sn.nets.find(x => x.name === net);
    assert.ok(n, proj + ': a net ' + net + ' existe no esquema (' + sn.nets.map(x => x.name).join(', ') + ')');
    const tem = (n.pins || []).map(String).sort(), quer = pinos.map(pinoPara).sort();
    assert.deepStrictEqual(tem, quer, proj + ': pinos da net ' + net);
  }
  const ligados = new Set([].concat(...Object.values(nets)).map(pinoPara));
  for (const n of sn.nets) for (const p of n.pins || []) assert.ok(ligados.has(String(p)) || (n.pins || []).length === 1, proj + ': pino ' + p + ' em net ' + n.name + ' que a lista não pede');
  return sn;
}

/* ------------------------------------------------------------------ a placa */
async function consulta(proj, tipo) { return (await chama('pcb_consultar', { projeto: proj, tipo, limite: 5000 })); }
const lista = r => r.itens || r.objetos || r.resultado || r.lista || r[Object.keys(r).find(k => Array.isArray(r[k]))] || [];

/* posições: grade dentro da placa, com folga entre as caixas */
async function posiciona(proj, layout) {
  for (const [ref, x, y, rot, layer] of layout) {
    const r = await chama('pcb_mover', Object.assign({ projeto: proj, ref, x, y, rot: rot || 0 }, layer ? { layer } : {}));
    assert.ok(r.gravado || r.ok, proj + ': mover ' + ref + ': ' + JSON.stringify(r).slice(0, 600));
  }
  /* o posicionamento não pode nascer com pad em cima de pad: o roteador (como o do Altium) não
     entra num pad que outra net cobre */
  const d = await chama('drc_rodar', { projeto: proj, tipos: ['Clearance', 'ShortCircuit', 'BoardOutlineClearance'] });
  assert.ok(d.aprovado, proj + ': posicionamento com conflito:\n  ' + d.violacoes.map(v => v.msg).join('\n  '));
}

/* a ligação pela outra camada: cada ponta SMD sai do pad por uma via ("escape", na camada do pad),
   e as duas vias (ou o pad passante) se ligam pela camada L2. Toda via passa pelo pcb_via, que a
   recusa em cima de outra net; o que não fecha é desfeito (projeto_desfazer) */
async function comVia(proj, net, ends, camadas) {
  let gravacoes = 0;
  const desfaz = async () => { while (gravacoes > 0) { await chama('projeto_desfazer', { projeto: proj }); gravacoes--; } };
  const r2 = v => Math.round(v * 20) / 20;
  async function escapa(e) {
    if (e.th) return { ponto: e.ref, vias: 0 };
    for (const r of [1.6, 2.4, 3.2, 4.0]) for (let k = 0; k < 8; k++) {
      const V = [r2(e.x + r * Math.cos(k * Math.PI / 4)), r2(e.y + r * Math.sin(k * Math.PI / 4))];
      const s = await chama('pcb_rotear', { projeto: proj, layer: e.layer, de: e.ref, ate: V, net, aplicar: false });
      if (!s.completa) continue;
      const v = await chama('pcb_via', { projeto: proj, x: V[0], y: V[1], net, simular: true });
      if (v.erro || v.ok === false) continue;
      await chama('pcb_rotear', { projeto: proj, layer: e.layer, de: e.ref, ate: V, net }); gravacoes++;
      await chama('pcb_via', { projeto: proj, x: V[0], y: V[1], net }); gravacoes++;
      return { ponto: V, vias: 1 };
    }
    return null;
  }
  for (const L2 of camadas) {
    const a = await escapa(ends[0]);
    const b = a && await escapa(ends[1]);
    if (a && b) {
      const s = await chama('pcb_rotear', { projeto: proj, layer: L2, de: a.ponto, ate: b.ponto, net });
      if (s.completa) return { vias: a.vias + b.vias, camada: L2 };
    }
    await desfaz();
  }
  return null;
}

/* rotear até o ratsnest zerar: cada ligação que falta, primeiro no Top, depois no Bottom (pad
   passante nas duas pontas), depois pela outra camada com via (comVia) */
async function roteia(proj) {
  const relato = { ligacoes: 0, top: 0, bottom: 0, viaLigacoes: 0, vias: 0, falhas: [] };
  for (let volta = 0; volta < 6; volta++) {
    const rn = await chama('nets_ratsnest', { projeto: proj });
    const falta = [].concat(...(rn.nets || []).map(n => (n.ligacoes || []).map(l => Object.assign({ net: n.net }, l))));
    if (!falta.length) { relato.pendentes = rn.nets_pendentes; return relato; }
    let feitas = 0;
    /* as pontas do ratsnest vêm como {tipo, id}: pad vira "REF.PINO" (a rota sabe a camada dele) */
    const padsL = lista(await consulta(proj, 'pads'));
    const pads = new Map(padsL.map(p => [p.id, p.ref + '.' + p.name]));
    const ponta = (o, x, y) => (o && o.tipo === 'pad' && pads.has(o.id)) ? pads.get(o.id) : [x, y];
    const camadas = (await chama('pcb_resumo', { projeto: proj })).camadas || [];
    const cobre = (Array.isArray(camadas) ? camadas.map(c => c.key || c.camada || c) : Object.keys(camadas)).filter(k => /^(Top|Bottom|Mid\d+)$/.test(k));
    for (const l of falta) {
      const de = ponta(l.de, l.x1, l.y1), para = ponta(l.para, l.x2, l.y2);
      let ok = false;
      for (const layer of ['Top', 'Bottom'].concat(cobre.filter(k => /^Mid/.test(k)))) {
        const s = await chama('pcb_rotear', { projeto: proj, layer, de, ate: para, net: l.net, aplicar: false });
        if (!s.completa) continue;
        const g = await chama('pcb_rotear', { projeto: proj, layer, de, ate: para, net: l.net });
        assert.ok(g.completa && g.gravacao && (g.gravacao.gravado || g.gravacao.ok), proj + ': gravar rota ' + JSON.stringify(g).slice(0, 600));
        relato[layer === 'Top' ? 'top' : 'bottom']++;
        ok = true; break;
      }
      if (!ok && l.de && l.para && l.de.tipo === 'pad' && l.para.tipo === 'pad') {
        const fim = o => { const q = padsL.find(p => p.id === o.id); return { ref: q.ref + '.' + q.name, x: q.x, y: q.y, layer: q.layer, th: q.type === 'th' || q.layer === 'Multi' }; };
        const outras = ['Bottom'].concat(cobre.filter(k => /^Mid/.test(k)), ['Top']);
        const v = await comVia(proj, l.net, [fim(l.de), fim(l.para)], outras);
        if (v) { ok = true; relato.viaLigacoes++; relato.vias += v.vias; }
      }
      if (ok) { relato.ligacoes++; feitas++; }
      else relato.falhas.push(l.net + ' ' + JSON.stringify(de) + '->' + JSON.stringify(para));
    }
    if (!feitas) break;
  }
  const rn = await chama('nets_ratsnest', { projeto: proj });
  relato.pendentes = rn.nets_pendentes;
  return relato;
}

/* ------------------------------------------------------------------ as conferências */
async function confere(proj, nets, info) {
  /* 2. o vínculo esquema -> placa: cada pad com a net do pino */
  const pads = lista(await consulta(proj, 'pads'));
  const netDoPad = new Map(pads.map(p => [p.ref + '.' + p.name, p.net || '']));
  for (const [net, pinos] of Object.entries(nets)) for (const pino of pinos)
    assert.strictEqual(netDoPad.get(pino), net, proj + ': o pad ' + pino + ' tem de estar na net ' + net + ' (está em "' + netDoPad.get(pino) + '")');
  const pedidos = new Set([].concat(...Object.values(nets)));
  for (const [k, n] of netDoPad) if (n && !pedidos.has(k)) assert.fail(proj + ': pad ' + k + ' na net ' + n + ' que o esquema não liga');
  const eco = await chama('eco_comparar', { projeto: proj });
  const pend = (eco.acoes || []).filter(a => a.status !== 'ok' || a.tipo);
  assert.strictEqual(pend.length, 0, proj + ': ECO depois de aplicado não pode ter nada pendente: ' + JSON.stringify(pend).slice(0, 800));

  /* 4. DRC */
  const d = await chama('drc_rodar', { projeto: proj, limite: 50 });
  assert.ok(d.aprovado, proj + ': DRC: ' + d.total + ' violações\n  ' + d.violacoes.map(v => v.msg).join('\n  '));

  /* 3. a largura de cada trilha é a da regra Width da net */
  const trilhas = lista(await consulta(proj, 'trilhas'));
  for (const t of trilhas) if (info.larguras && info.larguras[t.net]) assert.ok(Math.abs(t.w - info.larguras[t.net]) < 1e-4, proj + ': trilha ' + t.id + ' da net ' + t.net + ' com ' + t.w + ' mm (regra: ' + info.larguras[t.net] + ')');

  /* 5. Gerber e furação */
  const g = await chama('gerber_gerar', { projeto: proj });
  const pasta = path.join(PROJETOS, proj, 'Gerber');
  const arquivos = fs.readdirSync(pasta).filter(f => !/\.json$/i.test(f));
  const furosGerber = [];
  let flashTop = null;
  for (const f of arquivos) {
    const c = GV.parse(fs.readFileSync(path.join(pasta, f), 'utf8'), f);
    const fun = String(c.funcao || (c.atributos && c.atributos.FileFunction) || '');
    if (/Plated|NonPlated|drill/i.test(fun) || /drill|pth|npth/i.test(f)) {
      for (const pr of c.prims) if (pr.k === 'flash') furosGerber.push([pr.x, pr.y, pr.ap.params[0], /NonPlated|NPTH/i.test(fun + f) ? 'n' : 'p']);
    }
    if (/Copper,L1,Top/i.test(fun)) flashTop = c.prims.filter(pr => pr.k === 'flash').length;
  }
  const comps = lista(await consulta(proj, 'componentes'));
  const vias = lista(await consulta(proj, 'vias'));
  const furosPlaca = [];
  for (const p of pads) if (p.drill > 0) furosPlaca.push([p.x, p.y, p.drill]);
  for (const v of vias) furosPlaca.push([v.x, v.y, v.drill]);
  const chaveF = f => f[0].toFixed(3) + ',' + f[1].toFixed(3) + '@' + f[2].toFixed(3);
  const G = furosGerber.map(chaveF).sort(), P = furosPlaca.map(chaveF).sort();
  assert.deepStrictEqual(G, P, proj + ': a furação do Gerber = os furos dos pads e vias da placa');
  const padsTop = pads.filter(p => p.layer === 'Top' || p.layer === 'Multi' || p.type === 'th').length;
  if (flashTop != null) assert.ok(flashTop >= padsTop + vias.length, proj + ': cobre de cima com um flash por pad do Top e por via (' + flashTop + ' < ' + (padsTop + vias.length) + ')');
  return { pads: pads.length, comps: comps.length, trilhas: trilhas.length, vias: vias.length, furos: furosGerber.length, gerber: arquivos.length, drc: d.total, avisosGerber: (g.avisos || []).length };
}

/* ================================================================== os projetos */
const PROJETOS_E2E = [
  {
    nome: 'E2E LED transistor',
    placa: { largura: 50, altura: 35, camadas: 2 },
    comps: [
      { ref: 'J1', sym: 'JUMPER [02V]', footprint: 'JUMPER 2 VIAS PTH', x: 1000, y: 4000 },
      { ref: 'J2', sym: 'JUMPER [02V]', footprint: 'JUMPER 2 VIAS PTH', x: 1000, y: 2000 },
      { ref: 'R1', sym: 'RES [SMD]', footprint: 'RES 0805', x: 3000, y: 5000, comment: '330R' },
      { ref: 'R2', sym: 'RES [SMD]', footprint: 'RES 0805', x: 3000, y: 2000, comment: '10k' },
      { ref: 'D1', sym: 'LED', footprint: 'LED 5MM - GREEN', x: 5000, y: 5000 },
      { ref: 'Q1', sym: 'BC337', footprint: 'TO-92', x: 5000, y: 2500 },
      { ref: 'C1', sym: 'CAP [SMD]', footprint: 'CAP 0805', x: 7000, y: 4000, comment: '100nF' },
    ],
    /* os pinos do BC337 e do LED vêm da biblioteca: conferidos abaixo pelo nome */
    nets: null,
    power: ['GND', 'VCC'],
    layout: [['J1', 5, 26, 0], ['J2', 5, 9, 0], ['R1', 18, 26, 0], ['R2', 18, 9, 0], ['D1', 32, 26, 0], ['Q1', 32, 12, 0], ['C1', 44, 18, 90]],
  },
  {
    nome: 'E2E Rele',
    placa: { largura: 70, altura: 50, camadas: 2, furos: { d: 3.2, margem: 4 } },
    comps: [
      { ref: 'J1', sym: 'JUMPER 3Q', footprint: 'JUMPER_3VIAS', x: 1000, y: 5000 },
      { ref: 'J2', sym: 'JUMPER 3Q', footprint: 'JUMPER_3VIAS', x: 9000, y: 5000 },
      { ref: 'K1', sym: 'RELE 1', footprint: 'RELE SIMP', x: 6000, y: 5000 },
      { ref: 'Q1', sym: 'TIP41C', footprint: 'TO-220J', x: 4000, y: 2500 },
      { ref: 'D1', sym: 'DIODO ZENER [PTH]', footprint: 'DO-35', x: 4000, y: 6500 },
      { ref: 'R1', sym: 'RES [PTH]', footprint: 'RES 9MM D2.5', x: 2500, y: 2500, comment: '1k' },
      { ref: 'C1', sym: 'CAP EL [PTH]', footprint: 'CAP EL 2MM L10 D6', x: 2500, y: 6500, comment: '100uF' },
    ],
    nets: null,
    power: ['GND'],
    layout: [['J1', 8, 25, 90], ['J2', 62, 25, 90], ['K1', 45, 25, 0], ['Q1', 25, 12, 0], ['D1', 25, 38, 0], ['R1', 8, 12, 0], ['C1', 15, 38, 0]],
    regrasExtra: [{ kind: 'Width', name: 'Width_VCC', scope1: "InNet('VCC')", priority: 0, min: 0.5, pref: 0.8, max: 2 },
                  { kind: 'Clearance', name: 'Clearance_CARGA', scope1: "InNet('CARGA')", scope2: 'All', priority: 0, gap: 0.6, matrix: {} }],
    larguras: { VCC: 0.8 },
  },
  {
    nome: 'E2E Fonte 4 camadas',
    placa: { largura: 60, altura: 45, camadas: 4 },
    comps: [
      { ref: 'J1', sym: 'JUMPER [02V]', footprint: 'JUMPER 2 VIAS PTH', x: 1000, y: 4000 },
      { ref: 'U1', sym: '7805', footprint: 'DISSIPADOR - 7805', x: 3000, y: 4000 },
      { ref: 'C1', sym: 'CAP EL [PTH]', footprint: 'CAP EL 2MM L10 D6', x: 2000, y: 2000, comment: '470uF' },
      { ref: 'C2', sym: 'CAP [SMD]', footprint: 'CAP 0805', x: 4500, y: 2000, comment: '100nF' },
      { ref: 'R1', sym: 'RES [SMD]', footprint: 'RES 0805', x: 6000, y: 4000, comment: '1k' },
      { ref: 'D1', sym: 'LED', footprint: 'LED 5MM - GREEN', x: 7500, y: 4000 },
      { ref: 'J2', sym: 'JUMPER [02V]', footprint: 'JUMPER 2 VIAS PTH', x: 9000, y: 4000 },
    ],
    nets: null,
    power: ['GND'],
    layout: [['J1', 6, 22, 90], ['U1', 22, 30, 0], ['C1', 14, 10, 0], ['C2', 30, 10, 0], ['R1', 40, 22, 90], ['D1', 47, 32, 0], ['J2', 54, 12, 90]],
  },
  {
    nome: 'E2E Amp LM324',
    placa: { largura: 60, altura: 45, camadas: 2 },
    comps: [
      { ref: 'U1', sym: 'LM324', footprint: 'DIP14', x: 4000, y: 4000, part: 1 },
      { ref: 'U1', sym: 'LM324', footprint: 'DIP14', x: 4000, y: 2000, part: 2 },
      /* o pino 11 (alimentação negativa) mora na parte 4 do símbolo da casa */
      { ref: 'U1', sym: 'LM324', footprint: 'DIP14', x: 4000, y: 6000, part: 4 },
      { ref: 'R1', sym: 'RES [SMD]', footprint: 'RES 0805', x: 2000, y: 4500, comment: '10k' },
      { ref: 'R2', sym: 'RES [SMD]', footprint: 'RES 0805', x: 2000, y: 3500, comment: '100k' },
      { ref: 'R3', sym: 'RES [SMD]', footprint: 'RES 0805', x: 2000, y: 2000, comment: '10k' },
      { ref: 'J1', sym: 'JUMPER 3Q', footprint: 'JUMPER_3VIAS', x: 500, y: 3000 },
      { ref: 'J2', sym: 'JUMPER 3Q', footprint: 'JUMPER_3VIAS', x: 7000, y: 3000 },
      { ref: 'C1', sym: 'CAP [SMD]', footprint: 'CAP 0805', x: 6000, y: 5000, comment: '100nF' },
    ],
    nets: null,
    power: ['GND', 'VCC'],
    layout: [['U1', 30, 22, 0], ['R1', 15, 30, 0], ['R2', 15, 22, 0], ['R3', 15, 12, 0], ['J1', 5, 22, 90], ['J2', 54, 22, 90], ['C1', 42, 34, 0]],
  },
];

/* as ligações de cada projeto pelos NOMES dos pinos da biblioteca (o número sai do símbolo) */
async function pinoPorNome(sym, nomes, part) {
  const s = await chama('sch_simbolo', { nome: sym, part: part || 1 });
  const out = {};
  for (const [k, re] of Object.entries(nomes)) {
    const q = s.pinos.find(p => re.test(String(p.name)) || re.test(String(p.num)));
    assert.ok(q, sym + ': pino ' + re + ' (' + s.pinos.map(p => p.num + '=' + p.name).join(' ') + ')');
    out[k] = q.num;
  }
  return out;
}
async function ligacoes(P) {
  if (P.nome === 'E2E LED transistor') {
    const q = await pinoPorNome('BC337', { b: /^b|base/i, c: /^c|colet/i, e: /^e|emis/i });
    const d = await pinoPorNome('LED', { a: /^a$|anod/i, k: /^k$|catod|cathod/i });
    return { VCC: ['J1.1', 'R1.1', 'C1.1'], GND: ['J1.2', 'J2.2', 'Q1.' + q.e, 'C1.2'], LED_A: ['R1.2', 'D1.' + d.a], LED_K: ['D1.' + d.k, 'Q1.' + q.c],
             BASE: ['R2.2', 'Q1.' + q.b], ENTRADA: ['J2.1', 'R2.1'] };
  }
  if (P.nome === 'E2E Rele') {
    const q = await pinoPorNome('TIP41C', { b: /^b|base|^1$/i, c: /^c|colet|^2$/i, e: /^e|emis|^3$/i });
    const k = await pinoPorNome('RELE 1', { a1: /^A1$/i, a2: /^A2$/i, c: /^C$/i, na: /^NA$/i, nf: /^NF$/i });
    const d = await pinoPorNome('DIODO ZENER [PTH]', { a: /^a$|anod|^1$/i, k: /^k$|catod|^2$/i });
    return { VCC: ['J1.1', 'K1.' + k.a1, 'D1.' + d.k, 'C1.1'], GND: ['J1.3', 'Q1.' + q.e, 'C1.2'], BOBINA: ['K1.' + k.a2, 'D1.' + d.a, 'Q1.' + q.c],
             CMD: ['J1.2', 'R1.1'], BASE: ['R1.2', 'Q1.' + q.b], CARGA: ['K1.' + k.c, 'J2.1'], NA: ['K1.' + k.na, 'J2.2'], NF: ['K1.' + k.nf, 'J2.3'] };
  }
  if (P.nome === 'E2E Fonte 4 camadas') {
    const u = await pinoPorNome('7805', { i: /^in|^vi|^1$/i, g: /gnd|^2$/i, o: /^out|^vo|^3$/i });
    const d = await pinoPorNome('LED', { a: /^a$|anod/i, k: /^k$|catod|cathod/i });
    return { VIN: ['J1.1', 'U1.' + u.i, 'C1.1'], GND: ['J1.2', 'U1.' + u.g, 'C1.2', 'C2.2', 'D1.' + d.k, 'J2.2'], V5: ['U1.' + u.o, 'C2.1', 'R1.1', 'J2.1'],
             LED: ['R1.2', 'D1.' + d.a] };
  }
  /* LM324: parte 1 (A) amplificador inversor, parte 2 (B) seguidor; alimentação nos pinos 4/11 */
  const a = await pinoPorNome('LM324', { o: /out|^1$/i, n: /-|in.?-|^2$/i, p: /\+|in.?\+|^3$/i }, 1);
  const b = await pinoPorNome('LM324', { o: /out|^7$/i, n: /-|in.?-|^6$/i, p: /\+|in.?\+|^5$/i }, 2);
  return { VCC: ['U1.4', 'J1.1', 'C1.1'], GND: ['U1.11', 'J1.3', 'J2.3', 'C1.2', 'U1.' + a.p], IN: ['J1.2', 'R1.1'], INV: ['R1.2', 'R2.1', 'U1.' + a.n],
           OUTA: ['U1.' + a.o, 'R2.2', 'R3.1'], SEG: ['R3.2', 'U1.' + b.p], OUT: ['U1.' + b.o, 'U1.' + b.n, 'J2.1'] };
}

(async () => {
  await srv.atende({ jsonrpc: '2.0', id: ++seq, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'e2e', version: '1' } } });
  const resumo = [];
  for (const P of PROJETOS_E2E) {
    const t0 = Date.now();
    const cria = await chama('projeto_criar', { nome: P.nome, placa: P.placa });
    assert.ok(cria.ok && cria.placa && cria.placa.ok, P.nome + ': placa nova: ' + JSON.stringify(cria.placa));
    if (P.regrasExtra) {
      const r = await chama('regras_definir', { projeto: P.nome, regras: P.regrasExtra });
      assert.ok(r.ok, P.nome + ': regras');
    }
    const nets = await ligacoes(P);
    /* LM324: os pinos de alimentação (4 e 11) ficam numa parte só no símbolo da casa? Se não
       estiverem em nenhuma das partes colocadas, a parte de alimentação entra também */
    await montaEsquema(P.nome, P.comps, nets, { power: P.power });
    const eco = await chama('eco_aplicar', { projeto: P.nome });
    assert.ok(eco.gravado || eco.ok, P.nome + ': ECO: ' + JSON.stringify(eco).slice(0, 1200));
    await posiciona(P.nome, P.layout);
    if (P.larguras) {
      /* a largura pedida fora da faixa da regra vira o limite dela (simulado: não grava) */
      const [net, wq] = Object.entries(P.larguras)[0];
      const pino = nets[net][0];
      const t = await chama('pcb_trilha', { projeto: P.nome, layer: 'Top', pts: [pino, [1, 1]], w: 5, simular: true });
      assert.ok(t.largura_ajustada && /usei 2\b/.test(t.largura_ajustada), P.nome + ': w 5 mm na net ' + net + ' preso ao máximo da regra: ' + JSON.stringify(t).slice(0, 300));
      const v = await chama('pcb_via', { projeto: P.nome, x: 1.5, y: 1.5, net, size: 0.05, drill: 0.01, simular: true, forcar: true });
      assert.ok(v.via_ajustada && v.linhas[0].linha.includes('"size":0.3,"drill":0.1'), 'via abaixo da faixa vira o limite, com anel: ' + JSON.stringify(v).slice(0, 400));
      assert.ok(Math.abs(wq - 0.8) < 1e-9);
    }
    const rot = await roteia(P.nome);
    assert.strictEqual(rot.pendentes, 0, P.nome + ': o ratsnest tem de zerar; faltou: ' + rot.falhas.join(' | '));
    const c = await confere(P.nome, nets, P);
    resumo.push(`  ${P.nome}: ${c.comps} componentes, ${c.pads} pads, ${Object.keys(nets).length} nets, ${c.trilhas} trilhas (${rot.top} ligações no Top, ${rot.bottom} no Bottom), ${c.vias} vias, ${c.furos} furos no Gerber = placa, DRC limpo — ${Date.now() - t0} ms`);
  }
  console.log(resumo.join('\n'));
  /* E2E_MANTER=1 guarda as placas para ver na vista (ou no pcb_render) */
  if (process.env.E2E_MANTER) console.log('placas em ' + PROJETOS);
  else fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-e2e-placas OK');
})().catch(e => { console.error(e); console.error('pasta mantida para inspeção: ' + TMP); process.exit(1); });
