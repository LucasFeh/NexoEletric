/* NexoEletric 1.96.0 — os nove pedidos do dono de 2026-11-10, num teste só (todos sintéticos, sem projeto real):
     1. a port liga nas DUAS pontas (HubCore.portPontas = a geometria do hub-draw » portGeom);
     2. o sch_erc conta a regra "Componente (Parâmetros)" como o botão DRC (avisosDoCompPuro, parte pura do schframe);
     3. "fora do almoxarifado" deixa de fora o não montar e o só de cobre (HubSchErc.ehSoCobre);
     4. vista_screenshot / protocolo: imagem com base64 quebrado não derruba a resposta;
     5. o ECO da placa multi-esquema: X_<folha> do Altium é a X do esquema, e a X vazia de um ECO antigo não ganha;
     6. o footprint achado por outro nome (rename-map) sem os pads do símbolo avisa;
     7. o mapa pino↔pad por componente (pinoPad: "1=A;2=B") no ECO e na validação;
     8. o Make PCB Library (HubFpLib.daPlaca): o footprint e o 3D tirados da placa.
   node tests/test-196-erc-port-eco-fp.js */
'use strict';
const assert = require('assert');
const HC = require('../hub-core.js');
global.HubCore = HC;
const D = require('../hub-draw.js');
const Erc = require('../hub-scherc.js');
const Eco = require('../hub-pcbeco.js');
const F = require('../hub-fplib.js');
const P = require('../schframe.js');
const { imagemDoDataUrl } = require('../mcp/ferramentas/hub.js');
const { resultado } = require('../mcp/lib/protocolo.js');
let ok = 0;
const caso = (nome, fn) => { fn(); ok++; };
HC.setLibTables(null, null);

/* um símbolo de 2 pinos: pino 1 com a ponta quente em (-200,0), pino 2 em (200,0) */
const RES2 = { name:'RES2', designator:'R', parts:[{ part:1, pins:[
  { num:'1', name:'1', x:-100, y:0, orient:180, len:100 }, { num:'2', name:'2', x:100, y:0, orient:0, len:100 }] }] };
const SLIB = { symbols:[RES2] };
const folha = itens => ({ format:'schmirror-v2', items:[{ t:'sheet', name:'s', size:'A4' }].concat(itens.map(i => Object.assign({ sheet:'s' }, i))) });

/* ── 1. a port nas duas pontas ── */
caso('portPontas = portGeom', () => {
  for (const style of [0, 1, 2, 3, 4, 5, 6, 7, -1]) for (const w of [200, 400, 630]) {
    const p = { t:'port', x:1000, y:2000, w, style, net:'A' };
    const [a, b] = HC.portPontas(p), g = D.portGeom(p);
    assert.deepStrictEqual(a, [1000, 2000]);
    assert.deepStrictEqual(b, [p.x + g.dir[0] * g.w, p.y + g.dir[1] * g.w], 'style ' + style + ' w ' + w);
  }
});
caso('o fio na ponta da direita liga', () => {
  const s = folha([{ t:'comp', ref:'R1', sym:'RES2', x:2000, y:1000, rot:0, footprint:'' },
                   { t:'port', net:'SDA', x:1000, y:1000, w:400, style:0 },
                   { t:'wire', pts:[[1400, 1000], [1800, 1000]] }]);
  const r = HC.extractNets(s, SLIB);
  const sda = r.nets.find(n => n.name === 'SDA');
  assert.ok(sda && sda.pins.includes('R1-1'), 'R1-1 na SDA pela ponta direita: ' + JSON.stringify(r.nets));
  assert.ok(!r.warnings.some(w => /port "SDA" solta/.test(w)), 'não é solta');
});
caso('port em pé: a outra ponta é +Y', () => {
  const s = folha([{ t:'comp', ref:'R1', sym:'RES2', x:1000, y:1600, rot:90, footprint:'' },
                   { t:'port', net:'CS', x:1000, y:1000, w:400, style:4 }]);
  /* com rot 90 o pino 1 vai para (1000, 1400): a ponta de cima da port */
  const r = HC.extractNets(s, SLIB);
  assert.ok((r.nets.find(n => n.name === 'CS') || { pins:[] }).pins.includes('R1-1'), JSON.stringify(r.nets));
});
caso('port solta só sem nada nas duas pontas', () => {
  const r = HC.extractNets(folha([{ t:'port', net:'X', x:1000, y:1000, w:400, style:0 }]), SLIB);
  assert.strictEqual(r.warnings.filter(w => /port "X" solta/.test(w)).length, 1, 'um aviso só (não um por ponta)');
});

/* ── 2/3. o DRC do esquema ── */
caso('fora do almoxarifado: não montar e só de cobre ficam de fora', () => {
  const plib = { footprints:[
    { name:'JUMPER 2 VIAS SMD', pads:[{ name:'1', x:-1, y:0 }, { name:'2', x:1, y:0 }], silk:[], bodies:[] },
    { name:'R0805', pads:[{ name:'1', x:-1, y:0 }, { name:'2', x:1, y:0 }], silk:[], bodies:[{ kind:'step', model:'m' }] }] };
  const s = folha([
    { t:'comp', ref:'R1', sym:'RES2', x:1000, y:1000, rot:0, footprint:'R0805' },
    { t:'comp', ref:'R2', sym:'RES2', x:2000, y:1000, rot:0, footprint:'R0805', dnp:true },
    { t:'comp', ref:'J2', sym:'Jumper 2', x:3000, y:1000, rot:0, footprint:'JUMPER 2 VIAS SMD' },
    { t:'comp', ref:'R3', sym:'RES2', x:4000, y:1000, rot:0, footprint:'R0805', params:'Comment=X;Montagem=NAO MONTAR' },
    { t:'comp', ref:'TP1', sym:'RES2', x:5000, y:1000, rot:0, footprint:'R0805', soCobre:true },
    { t:'comp', ref:'R4', sym:'RES2', x:6000, y:1000, rot:0, footprint:'R0805', params:'BOM=NAO' }]);
  const r = Erc.rodar({ hc:HC, schematic:s, slib:SLIB, plib, foraDoAlmox: () => true });
  const fora = r.violacoes.filter(v => v.regra === 'fora-almox').map(v => v.ref).sort();
  assert.deepStrictEqual(fora, ['R1'], 'só o R1 (os outros não se compram): ' + fora);
  /* o reconhecimento pelo nome não vale com corpo 3D (o jumper de barra com shunt é peça) */
  assert.strictEqual(Erc.ehSoCobre({ footprint:'JUMPER X' }, { name:'JUMPER X', bodies:[{ kind:'step' }] }), false);
  assert.strictEqual(Erc.ehSoCobre({ footprint:'FIDUCIAL 1MM' }, { name:'FIDUCIAL 1MM', bodies:[] }), true);
});
caso('avisosDoCompPuro: a regra "Componente" sem a vista', () => {
  const plib = { footprints:[{ name:'R0805', pads:[{ name:'1' }], silk:[] }] };
  const m = P.montaAcervos({ schlib:{ symbols:[RES2] } });
  const s = folha([{ t:'comp', ref:'R1', sym:'RES2', x:1000, y:1000, rot:0, footprint:'R0805' },
                   { t:'comp', ref:'U9', sym:'NAO_EXISTE', x:3000, y:1000, rot:0, footprint:'R0805' }]);
  const d = { hc:HC, slib:SLIB, plib, acervos:m, schematic:s, odoo: () => null, local: () => null, emergencia: () => null, almoxCarregado:true };
  const a = P.avisosDoCompPuro(s.items[1], d);
  assert.ok(a.avisos.some(x => x.cod === 'acervo' && x.nivel === 'err'), 'Biblioteca do Altium = acervo pendente');
  assert.ok(a.avisos.some(x => x.cod === 'footprint' && /Pinos sem pad.*2/.test(x.t)), 'o pino 2 sem pad');
  assert.ok(a.fora, 'sem ficha = fora');
  const u = P.avisosDoCompPuro(s.items[2], d);
  assert.ok(u.avisos.some(x => x.cod === 'desenho' && x.nivel === 'err'), 'sem símbolo = quadrado vermelho');
  /* e o DRC com o filtro da vista conta a regra "componente" */
  const r = Erc.rodar({ hc:HC, schematic:s, slib:SLIB, plib, avisosDoComp: c => P.avisosDoCompPuro(c, d).avisos.filter(x => !['sem-ficha', 'footprint-inexistente'].includes(x.cod)) });
  assert.ok(r.porRegra.some(c => c.regra === 'componente' && c.n >= 2), JSON.stringify(r.porRegra));
  /* o resgate de desenho: índice por nome e por chave */
  const E = P.indiceEmergencia({ symbols:[{ name:'Jumper', aliases:['JMP'], pins:[] }] }, HC);
  assert.ok(P.emergenciaDe(E, { sym:'JMP' }, HC), 'pelo apelido');
  assert.strictEqual(P.emergenciaDe(E, { sym:'zzz' }, HC), null);
});

/* ── 4. a imagem do screenshot ── */
caso('imagem quebrada não vai', () => {
  assert.strictEqual(imagemDoDataUrl('data:,'), null, 'o canvas vazio');
  assert.strictEqual(imagemDoDataUrl('data:image/png;base64,iVBORw0KGgo', 1, 1), null, 'curta');
  const b = 'A'.repeat(400);
  assert.deepStrictEqual(imagemDoDataUrl('data:image/png;base64,' + b, 800, 600), { base64:b, mime:'image/png' });
  assert.strictEqual(imagemDoDataUrl('data:image/png;base64,' + b, 1, 1), null, '1 x 1 px');
  const r = resultado({ ok:true, _imagem:{ base64:'data:,', mime:'image/png' } });
  assert.strictEqual(r.content.length, 1, 'só o texto');
  assert.ok(/imagem_descartada/.test(r.content[0].text));
  const r2 = resultado({ ok:true, _imagem:{ base64:b, mime:'image/png' } });
  assert.strictEqual(r2.content[1].type, 'image');
});

/* ── 5/7. o ECO ── */
const FPAB = { name:'CAP AB', pads:[{ name:'A', type:'smd', shape:'rect', x:-1, y:0, w:1, h:1, rot:0, layer:'Top' },
                                   { name:'B', type:'smd', shape:'rect', x:1, y:0, w:1, h:1, rot:0, layer:'Top' }], silk:[] };
const FP12 = { name:'R0805', pads:[{ name:'1', type:'smd', shape:'rect', x:-1, y:0, w:1, h:1, rot:0, layer:'Top' },
                                  { name:'2', type:'smd', shape:'rect', x:1, y:0, w:1, h:1, rot:0, layer:'Top' }], silk:[] };
const PLIB = { footprints:[FPAB, FP12] };
const pad = (ref, nome, x, net) => ({ id:ref + nome, name:nome, type:'smd', shape:'rect', x, y:10, w:1, h:1, rot:0, layer:'Top', net });
function placa(nets, comps){
  return { format:'pcbmirror-v1', exporter:'teste', units:'mm', board:{ bbox:{ x1:0, y1:0, x2:50, y2:40 }, outline:[] },
    nets, components:comps, freepads:[], tracks:[{ id:'t1', layer:'Top', x1:9, y1:10, x2:19, y2:10, w:0.3, net:nets[0] }],
    arcs:[], vias:[], texts:[], silk:[], regions:[], fills:[], cutouts:[], stats:{} };
}
caso('X_<folha> do Altium é a X do esquema, mesmo com 2 pinos', () => {
  const B = placa(['EN_4'], [
    { id:'c1', ref:'R1', footprint:'R0805', comment:'', layer:'Top', x:10, y:10, rot:0, pads:[pad('R1', '1', 9, 'EN_4'), pad('R1', '2', 11, '')] },
    { id:'c2', ref:'R2', footprint:'R0805', comment:'', layer:'Top', x:20, y:10, rot:0, pads:[pad('R2', '1', 19, 'EN_4'), pad('R2', '2', 21, '')] }]);
  /* no esquema: R1-1 e R2-1 na net EN (rótulo); R1-2/R2-2 soltos */
  const s = folha([{ t:'comp', ref:'R1', sym:'RES2', x:1000, y:1000, rot:0, footprint:'R0805' },
                   { t:'comp', ref:'R2', sym:'RES2', x:3000, y:1000, rot:0, footprint:'R0805' },
                   { t:'wire', pts:[[800, 1000], [800, 1200], [2800, 1200], [2800, 1000]] },
                   { t:'netlabel', net:'EN', x:1500, y:1200 }]);
  const eco = Eco.compara(s, B, { schlib:SLIB, pcblib:PLIB, changes:[] });
  const nets = eco.acoes.filter(a => /^net/.test(a.grupo));
  assert.deepStrictEqual(nets.map(a => a.grupo + ' ' + a.objeto + '>' + a.para), ['netRename EN_4>EN'], JSON.stringify(nets));
  assert.ok(/sufixo de folha/.test(nets[0].msg));
});
caso('a X vazia de um ECO antigo não ganha da X_4 com os pinos e as trilhas', () => {
  const B = placa(['EN_4'], [
    { id:'c1', ref:'R1', footprint:'R0805', comment:'', layer:'Top', x:10, y:10, rot:0, pads:[pad('R1', '1', 9, 'EN_4'), pad('R1', '2', 11, '')] },
    { id:'c2', ref:'R2', footprint:'R0805', comment:'', layer:'Top', x:20, y:10, rot:0, pads:[pad('R2', '1', 19, 'EN_4'), pad('R2', '2', 21, '')] }]);
  const antigo = [{ op:'net_add', net:'EN', note:'ECO: Add Nets EN' }];
  const s = folha([{ t:'comp', ref:'R1', sym:'RES2', x:1000, y:1000, rot:0, footprint:'R0805' },
                   { t:'comp', ref:'R2', sym:'RES2', x:3000, y:1000, rot:0, footprint:'R0805' },
                   { t:'wire', pts:[[800, 1000], [800, 1200], [2800, 1200], [2800, 1000]] },
                   { t:'netlabel', net:'EN', x:1500, y:1200 }]);
  const eco = Eco.compara(s, B, { schlib:SLIB, pcblib:PLIB, changes:antigo });
  const nets = eco.acoes.filter(a => /^net|^pin/.test(a.grupo));
  assert.deepStrictEqual(nets.map(a => a.grupo + ' ' + a.objeto + '>' + a.para), ['netRename EN_4>EN'], 'nada de apagar a EN_4: ' + JSON.stringify(nets));
  const linhas = Eco.aplica(eco).linhas;
  const ops = (Array.isArray(linhas) ? linhas : linhas.changes || []).filter(l => /^net_/.test(l.op)).map(l => l.op + ' ' + l.net);
  assert.deepStrictEqual(ops, ['net_del EN', 'net_rename EN'], 'a vazia sai antes do renomear');
  const m = HC.applyPcbChanges(B, antigo.concat(Array.isArray(linhas) ? linhas : linhas.changes), { pcblib:PLIB });
  assert.deepStrictEqual(m.validation.filter(v => v.level === 'err').map(v => v.msg), []);
  const eb = HC.effectiveBoard(B, m);
  assert.strictEqual(eb.tracks.find(t => t.id === 't1').net, 'EN', 'a trilha vai junto para a EN');
});
caso('o mapa pino↔pad: o CAP com A/B', () => {
  const B = placa(['N1', 'N2'], [
    { id:'c1', ref:'C1', footprint:'CAP AB', comment:'', layer:'Top', x:10, y:10, rot:0, pads:[pad('C1', 'A', 9, 'N1'), pad('C1', 'B', 11, 'N2')] }]);
  const s = folha([{ t:'comp', ref:'C1', sym:'RES2', x:1000, y:1000, rot:0, footprint:'CAP AB', pinoPad:'1=A;2=B' },
                   { t:'netlabel', net:'N1', x:800, y:1000 }, { t:'netlabel', net:'N2', x:1200, y:1000 }]);
  const eco = Eco.compara(s, B, { schlib:SLIB, pcblib:PLIB, changes:[] });
  assert.deepStrictEqual(eco.acoes.filter(a => /^pin|^net/.test(a.grupo)).map(a => a.objeto + ' ' + a.msg), [], 'nada a mexer');
  const sem = folha([{ t:'comp', ref:'C1', sym:'RES2', x:1000, y:1000, rot:0, footprint:'CAP AB' },
                     { t:'netlabel', net:'N1', x:800, y:1000 }, { t:'netlabel', net:'N2', x:1200, y:1000 }]);
  const eco2 = Eco.compara(sem, B, { schlib:SLIB, pcblib:PLIB, changes:[] });
  assert.ok(eco2.acoes.some(a => a.semPad), 'sem o mapa: o Unknown Pin de antes');
  /* a validação */
  const v = HC.validateSchematic(s, SLIB, PLIB, HC.extractNets(s, SLIB));
  assert.ok(!v.warnings.some(w => /sem pad correspondente/.test(w)), v.warnings.join(' | '));
  const v2 = HC.validateSchematic(sem, SLIB, PLIB, HC.extractNets(sem, SLIB));
  assert.ok(v2.warnings.some(w => /pino "1" sem pad/.test(w)));
  assert.strictEqual(HC.pinoPadCampo(HC.mapaPinoPad({ pinoPad:' 2=B ; 1=A;;x' })), '1=A;2=B');
});

/* ── 6. o footprint achado por outro nome ── */
caso('rename-map para um footprint com outros pads avisa', () => {
  HC.setLibTables({ fpRename:{ 'Barra Prog Atmega':'CAP AB' } }, null);
  try {
    const t = HC.avisoFootprintRenomeado(PLIB, 'Barra Prog Atmega', ['1', '2']);
    assert.ok(t && /achado como "CAP AB" pelo rename-map/.test(t) && /1, 2/.test(t), t);
    assert.strictEqual(HC.avisoFootprintRenomeado(PLIB, 'CAP AB', ['1']), null, 'nome exato não é troca');
    assert.strictEqual(HC.avisoFootprintRenomeado(PLIB, 'Barra Prog Atmega', ['A', 'B']), null, 'com os pads certos não avisa');
    const s = folha([{ t:'comp', ref:'CN1', sym:'RES2', x:1000, y:1000, rot:0, footprint:'Barra Prog Atmega' }]);
    const v = HC.validateSchematic(s, SLIB, PLIB, HC.extractNets(s, SLIB));
    assert.ok(v.warnings.some(w => /achado como "CAP AB"/.test(w)), v.warnings.join(' | '));
  } finally { HC.setLibTables(null, null); }
});

/* ── 8. o Make PCB Library ── */
caso('daPlaca: pads, serigrafia e o 3D na coordenada do footprint', () => {
  const B = placa(['N1'], [
    { id:'c1', ref:'U1', footprint:'SO SÓ NA PLACA', comment:'', layer:'Top', x:20, y:10, rot:90,
      pads:[{ id:'p1', name:'1', type:'smd', shape:'rect', x:20, y:9, w:1, h:0.6, rot:90, layer:'Top', net:'N1' },
            { id:'p2', name:'2', type:'smd', shape:'rect', x:20, y:11, w:1, h:0.6, rot:90, layer:'Top', net:'' }] },
    { id:'c2', ref:'U2', footprint:'SO SÓ NA PLACA', comment:'', layer:'Bottom', x:40, y:10, rot:0, pads:[pad('U2', '1', 39, ''), pad('U2', '2', 41, '')] },
    { id:'c3', ref:'R9', footprint:'R0805', comment:'', layer:'Top', x:5, y:5, rot:0, pads:[pad('R9', '1', 4, ''), pad('R9', '2', 6, '')] }]);
  B.silk.push({ id:'s9', layer:'TopOverlay', kind:'line', x1:19, y1:8, x2:19, y2:12, w:0.2, owner:'U1' });
  const d3 = { bodies:[{ owner:'U1', side:'top', kind:'step', model:'{M1}', name:'u.step',
                         raw:{ x2d:20.5, y2d:10, rot2d:0, rotx:0, roty:0, rotz:90, dz:0.1, standoff:0, overall:1 } },
                       { owner:'U1', side:'top', kind:'extruded', pts:[[19, 9], [21, 9], [21, 11], [19, 11]], standoff:0, height:1 }],
               models:{ '{M1}':{ file:'3d/123.step', name:'u.step' } } };
  const falta = F.faltandoNaPlaca(HC, B, PLIB);
  assert.deepStrictEqual(falta, [{ nome:'SO SÓ NA PLACA', refs:['U1', 'U2'] }], 'o R0805 está na biblioteca');
  const r = F.daPlaca(HC, B, d3, 'SO SÓ NA PLACA');
  assert.strictEqual(r.ref, 'U1', 'a instância do Top');
  const p1 = r.fp.pads.find(p => p.name === '1');
  assert.ok(Math.abs(p1.x - (-1)) < 1e-6 && Math.abs(p1.y) < 1e-6, 'o pad 1 volta para (-1, 0): ' + JSON.stringify(p1));
  assert.strictEqual(r.fp.silk.length, 1);
  const st = r.fp.bodies.find(b => b.kind === 'step');
  assert.deepStrictEqual([st.raw.x2d, st.raw.y2d, st.raw.rotz, st.raw.dz], [0, -0.5, 0, 0.1], 'o STEP no footprint: ' + JSON.stringify(st.raw));
  assert.deepStrictEqual(r.modelos, { '{M1}':{ file:'3d/123.step', name:'u.step' } });
  const ex = r.fp.bodies.find(b => b.kind === 'extruded');
  assert.ok(ex.pts.every(([x, y]) => Math.abs(Math.abs(x) - 1) < 1e-6 && Math.abs(Math.abs(y) - 1) < 1e-6), JSON.stringify(ex.pts));
  assert.deepStrictEqual(F.valida(r.fp), []);
  /* a volta: o footprint extraído, posto onde o U1 estava, dá os pads da placa */
  const m = HC.applyPcbChanges(B, [{ op:'comp_add', ref:'U9', footprint:'SO SÓ NA PLACA', x:20, y:10, rot:90 }], { pcblib:{ footprints:[r.fp] } });
  const u9 = HC.effectiveBoard(B, m).components.find(c => c.ref === 'U9');
  for (const q of u9.pads) {
    const o = B.components[0].pads.find(x => x.name === q.name);
    assert.ok(Math.abs(q.x - o.x) < 1e-4 && Math.abs(q.y - o.y) < 1e-4, 'pad ' + q.name + ' no lugar');
  }
  /* só do bottom: sem 3D, avisado */
  const so = F.daPlaca(HC, placa([], [B.components[1]]), { bodies:[{ owner:'U2', kind:'step', model:'{M1}' }], models:d3.models }, 'SO SÓ NA PLACA');
  assert.strictEqual(so.fp.bodies.length, 0);
  assert.ok(so.avisos.some(a => /bottom/.test(a)));
});


/* ── 1.96.1: o que o dono devolveu ── */
caso('só de cobre: sem os avisos de compra na regra "Componente"', () => {
  const plib = { footprints:[{ name:'JUMPER 2 VIAS SMD', pads:[{ name:'1' }, { name:'2' }], silk:[], bodies:[] }] };
  const m = P.montaAcervos({ schlib:{ symbols:[RES2] } });
  const s = folha([{ t:'comp', ref:'J2', sym:'RES2', x:1000, y:1000, rot:0, footprint:'JUMPER 2 VIAS SMD', soCobre:true },
                   { t:'comp', ref:'R1', sym:'RES2', x:3000, y:1000, rot:0, footprint:'JUMPER 2 VIAS SMD', soCobre:false }]);
  const d = { hc:HC, slib:SLIB, plib, acervos:m, schematic:s, odoo: () => null, local: () => null, emergencia: () => null,
              almoxCarregado:true, soCobre: c => Erc.ehSoCobre(c, null) };
  const a = P.avisosDoCompPuro(s.items[1], d);
  assert.ok(!a.avisos.some(x => x.cod === 'acervo' || x.cod === 'odoo' || x.cod === 'sem-ficha'), JSON.stringify(a.avisos));
  assert.strictEqual(a.fora, false);
  /* o R1 (sem a marca, mas com o footprint de jumper sem 3D) também é só de cobre pelo nome */
  const r = Erc.rodar({ hc:HC, schematic:s, slib:SLIB, plib, foraDoAlmox: () => true,
    avisosDoComp: () => [{ t:'Acervo: Biblioteca do Altium', cod:'acervo', nivel:'err' }, { t:'Desenho: x', cod:'desenho' }] });
  assert.deepStrictEqual(r.violacoes.filter(v => v.regra === 'componente').map(v => v.ref + ' ' + v.msg.replace(/^\S+ — /, '')),
    ['J2 Desenho: x', 'R1 Desenho: x'], 'só os técnicos: ' + JSON.stringify(r.violacoes.map(v => v.msg)));
  assert.ok(!r.violacoes.some(v => v.regra === 'fora-almox'));
});
caso('pinoPad contra a biblioteca (1/2) e contra a placa (A/B): o C5', () => {
  /* símbolo com pinos A/B, footprint da BIBLIOTECA com pads 1/2, o da PLACA (o mesmo nome) com pads A/B */
  const CAPAB = { name:'CAPAB', designator:'C', parts:[{ part:1, pins:[
    { num:'A', name:'A', x:-100, y:0, orient:180, len:100 }, { num:'B', name:'B', x:100, y:0, orient:0, len:100 }] }] };
  const SL = { symbols:[CAPAB] };
  const LIB12 = { footprints:[{ name:'CAP 0805', pads:[{ name:'1', type:'smd', shape:'rect', x:-1, y:0, w:1, h:1, rot:0, layer:'Top' },
                                                     { name:'2', type:'smd', shape:'rect', x:1, y:0, w:1, h:1, rot:0, layer:'Top' }], silk:[] }] };
  const B = placa(['N1', 'N2'], [
    { id:'c5', ref:'C5', footprint:'CAP 0805', comment:'', layer:'Top', x:10, y:10, rot:0, pads:[pad('C5', 'A', 9, 'N1'), pad('C5', 'B', 11, 'N2')] }]);
  const itens = pp => [{ t:'comp', ref:'C5', sym:'CAPAB', x:1000, y:1000, rot:0, footprint:'CAP 0805', pinoPad:pp },
    { t:'comp', ref:'C6', sym:'CAPAB', x:3000, y:1000, rot:0, footprint:'CAP 0805', pinoPad:pp },
    { t:'netlabel', net:'N1', x:800, y:1000 }, { t:'netlabel', net:'N2', x:1200, y:1000 },
    { t:'netlabel', net:'N1', x:2800, y:1000 }, { t:'netlabel', net:'N2', x:3200, y:1000 }];
  const s = folha(itens('A=1;B=2'));
  /* a validação contra a biblioteca: o mapa leva A/B a 1/2 — sem aviso */
  const v = HC.validateSchematic(s, SL, LIB12, HC.extractNets(s, SL));
  assert.ok(!v.warnings.some(w => /sem pad|mapa pino/.test(w)), v.warnings.join(' | '));
  /* sem o mapa, os avisos de antes (os 20 dos capacitores 0805) */
  const s0 = folha(itens(undefined));
  assert.ok(HC.validateSchematic(s0, SL, LIB12, HC.extractNets(s0, SL)).warnings.some(w => /pino "A" sem pad/.test(w)));
  /* o ECO: o C5 já está na placa com pads A/B — nada de Unknown Pin; o C6 é novo e entra pelos pads 1/2 da biblioteca */
  const eco = Eco.compara(s, B, { schlib:SL, pcblib:LIB12, changes:[] });
  assert.ok(!eco.acoes.some(a => a.semPad || (a.objeto || '').startsWith('C5-')), 'C5: ' + JSON.stringify(eco.acoes.filter(a => /C5/.test(a.objeto))));
  const add = eco.acoes.find(a => a.tipo === 'comp_add' && a.objeto === 'C6');
  assert.ok(add, 'o C6 entra');
  const linhas = Eco.aplica(eco).linhas;
  const c6 = linhas.find(l => l.op === 'comp_add' && l.ref === 'C6');
  assert.ok(c6 && /1=N1/.test(c6.nets || '') && /2=N2/.test(c6.nets || ''), 'o C6 pelas nets nos pads 1/2: ' + JSON.stringify(c6));
  /* a ficha e o DRC: avisosDoFootprint com o mapa, contra a biblioteca */
  assert.deepStrictEqual(P.avisosDoFootprint(HC, LIB12, CAPAB, 'CAP 0805', HC.mapaPinoPad({ pinoPad:'A=1;B=2' })).falta, []);
  assert.strictEqual(HC.padDoPino(null, 'A', { A:'1' }, new Set(['A', 'B'])), 'A', 'o pad de mesmo nome ganha do mapa');
  assert.strictEqual(HC.padDoPino(null, 'A', { A:'1' }, new Set(['1', '2'])), '1');
});
console.log('test-196-erc-port-eco-fp: ' + ok + ' ok');
