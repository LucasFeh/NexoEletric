// hub-nexo.js + HubPcb3dModelo.corpos com a biblioteca do NexoCAD (docs/INTEGRACAO-NEXOCAD.md):
//   - prioridade: `substitui` (troca so o STEP daquele corpo, mesma matriz) > vinculo pelo footprint
//     (um STEP na identidade do footprint, no lugar de TODOS os corpos) > as fontes de sempre;
//   - a chave do cache e nexo:<id>@<rev> (salvar no NexoCAD troca a malha);
//   - corpo preso direto ao item (model 'nexo:<id>', do editor de footprint) desenha o item;
//   - a chave de modelo dos corpos do board3d e 'projeto:<p>/<file>';
//   - geometriaDeComp desfaz a pose do componente (Top e Bottom) e bate com geometriaDe do footprint.
const assert = require('assert');
const path = require('path');
const R = path.join(__dirname, '..');
const HN = require(path.join(R, 'hub-nexo.js'));
const M3 = require(path.join(R, 'hub-pcb3d-modelo.js'));
const HC = require(path.join(R, 'hub-core.js'));

const indice = { revisao:9, itens:[
  { id:'el-subst', nome:'R0805 editado', categoria:'Eletrônicos', rev:4, arquivos:{ step:'itens/el-subst/modelo.step' },
    substitui:['3d-hub/abc.step'], eletronico:{ footprints:['R0805'] } },
  { id:'el-sot', nome:'SOT-23', categoria:'Eletrônicos', rev:2, arquivos:{ step:'itens/el-sot/modelo.step' }, eletronico:{ footprints:['SOT23'] } },
  { id:'el-d3', nome:'do board3d', categoria:'Eletronicos', rev:1, arquivos:{ step:'x' }, substitui:['projeto:Demo/modelos/u1.step'] },
  { id:'mec-sem-step', nome:'sem step', categoria:'Mecânicos', rev:1, arquivos:{}, substitui:['3d/zz.step'] },
  { id:'mec-fp', nome:'mecanico com footprint', categoria:'Mecânicos', rev:1, arquivos:{ step:'y' }, eletronico:{ footprints:['DIP8'] } },
] };
const nx = HN.resolvedorDe(indice);

/* o resolvedor */
assert.strictEqual(nx.porChave('3d-hub/abc.step').id, 'el-subst');
assert.strictEqual(nx.porChave('3d-hub/abc.step').chave, 'nexo:el-subst@4', 'chave do cache = nexo:<id>@<rev>');
assert.strictEqual(nx.porChave('3d-hub/abc.step').url, '/api/nexo/arquivo/el-subst/modelo.step?rev=4', 'a url leva a revisao');
assert.strictEqual(nx.porFootprint('SOT23').id, 'el-sot');
assert.strictEqual(nx.porChave('3d/zz.step'), null, 'item sem STEP gerado nao substitui nada');
assert.strictEqual(nx.porFootprint('DIP8'), null, 'vinculo por footprint so vale para Eletronicos');
assert.strictEqual(HN.resolveCorpo({ modeloChave:'3d-hub/abc.step' }, 'R0805', nx).por, 'substitui');
assert.strictEqual(HN.resolveCorpo({ modeloChave:'nexo:el-sot' }, '', nx).id, 'el-sot');
assert.strictEqual(HN.resolveCorpo({ modeloChave:'3d/outro.step' }, '', nx), null);

/* a placa: R1 com corpo do hub (3d-hub/abc.step, substituido), R2 com corpo da PcbLib (3d/qq.step)
   e footprint R0805 (vinculado ao el-subst), U1 SOT23 sem corpo (vinculo), U2 do board3d, U3 nexo direto */
const ident = { x2d:0.5, y2d:0, rot2d:0, rotx:90, roty:0, rotz:0, dz:0.1 };
const hub3d = { footprints:{ R0805:{ bodies:[{ kind:'step', model:'abc', name:'r.step', side:'top', raw:ident }] },
                             NEXO1:{ bodies:[{ kind:'step', model:'nexo:el-sot', name:'SOT', side:'top', raw:{ x2d:0, y2d:0, rot2d:0, rotx:0, roty:0, rotz:0, dz:0 } }] } },
                models:{ abc:{ file:'3d-hub/abc.step', name:'r.step' }, 'nexo:el-sot':{ file:'nexo:el-sot', name:'SOT-23', nexo:'el-sot' } } };
const lib3d = { footprints:{ C0603:{ bodies:[{ kind:'step', model:'qq', name:'c.step', side:'top', raw:ident }] } },
                models:{ qq:{ file:'3d/qq.step', name:'c.step' } } };
const d3 = { thickness:1.6, componentes:{ U2:{ x:20, y:5, rot:0, layer:'Top', footprint:'QFN' } },
             bodies:[{ owner:'U2', side:'top', kind:'step', model:'m1', name:'u1.step', raw:{ x2d:20, y2d:5, rot2d:0, rotx:0, roty:0, rotz:0, dz:0 } }],
             models:{ m1:{ file:'modelos/u1.step', name:'u1.step' } } };
const eb = { components:[
  { ref:'R1', footprint:'R0805', x:10, y:10, rot:90, layer:'Top', pads:[] },
  { ref:'C1', footprint:'C0603', x:12, y:10, rot:0, layer:'Top', pads:[] },
  { ref:'U1', footprint:'SOT23', x:5, y:5, rot:180, layer:'Bottom', pads:[{ x:5, y:5, w:1, h:1 }] },
  { ref:'U2', footprint:'QFN', x:20, y:5, rot:0, layer:'Top', pads:[] },
  { ref:'U3', footprint:'NEXO1', x:30, y:5, rot:0, layer:'Top', pads:[] },
] };
const sem = M3.corpos(eb, d3, { pcblib3d:lib3d, pcblib3dHub:hub3d, projeto:'Demo', thickness:1.6 });
const com = M3.corpos(eb, d3, { pcblib3d:lib3d, pcblib3dHub:hub3d, projeto:'Demo', thickness:1.6, nexo:nx });
const de = (L, ref) => L.filter(b => b.owner === ref);

/* sem nexo nada muda alem do modeloChave */
assert.strictEqual(de(sem, 'R1')[0].modeloChave, '3d-hub/abc.step');
assert.strictEqual(de(sem, 'C1')[0].modeloChave, '3d/qq.step');
assert.strictEqual(de(sem, 'U2')[0].modeloChave, 'projeto:Demo/modelos/u1.step', 'board3d: projeto:<p>/<file>');
assert.strictEqual(de(sem, 'U1')[0].placeholder, true);
assert.strictEqual(de(sem, 'U3')[0].modelUrl, '', 'nexo:<id> sem resolvedor nao vira Libs/nexo:...');

/* substitui: a mesma matriz, o STEP do item */
const r1 = de(com, 'R1');
assert.strictEqual(r1.length, 1);
assert.strictEqual(r1[0].origem, 'nexo'); assert.strictEqual(r1[0].nexo, 'el-subst');
assert.deepStrictEqual(r1[0].matrix, de(sem, 'R1')[0].matrix, 'substitui guarda a matriz do corpo');
assert.strictEqual(r1[0].chave, 'nexo:el-subst@4');
/* C1 (C0603) sem item: fica como estava */
assert.deepStrictEqual(de(com, 'C1'), de(sem, 'C1'));
/* U1: vinculo pelo footprint, no lugar do placeholder, na identidade do footprint (Bottom: virado) */
const u1 = de(com, 'U1');
assert.strictEqual(u1.length, 1); assert.strictEqual(u1[0].kind, 'step'); assert.strictEqual(u1[0].vinculo, 'footprint');
assert.deepStrictEqual(u1[0].matrix, M3.colMaior(M3.matPose(eb.components[2], 1.6)));
assert.strictEqual(u1[0].side, 'bottom');
/* U2: board3d substituido pela chave projeto: */
assert.strictEqual(de(com, 'U2')[0].nexo, 'el-d3');
/* U3: preso direto ao item */
assert.strictEqual(de(com, 'U3')[0].modelUrl, '/api/nexo/arquivo/el-sot/modelo.step?rev=2');
assert.strictEqual(de(com, 'U3')[0].vinculo, undefined, 'corpo nexo: direto nao e trocado pelo vinculo');

/* substitui vale mais que o vinculo: R0805 tem os dois, fica o corpo substituido (nao o da identidade) */
assert.notDeepStrictEqual(r1[0].matrix, M3.colMaior(M3.matPose(eb.components[0], 1.6)));

/* geometria.corpo: a matriz do corpo na placa, sem a pose do componente, e a do footprint (raw), Top e Bottom */
for (const [layer, rot] of [['Top', 90], ['Bottom', 30], ['Bottom', 180]]) {
  const ebX = { components:[{ ref:'Q1', footprint:'R0805', x:3, y:-2, rot, layer, pads:[] }] };
  const b = M3.corpos(ebX, null, { pcblib3dHub:hub3d, thickness:1.6 })[0];
  const L = M3.matrizLocal(b.matrix, ebX.components[0], 1.6);
  const esperado = M3.matrizCorpo(ident, { side:'top', thickness:1.6 });
  L.forEach((v, i) => assert.ok(Math.abs(v - esperado[i]) < 1e-6, layer + ' ' + rot + ': matriz local [' + i + '] ' + v + ' != ' + esperado[i]));
  assert.ok(Math.abs(L[14] - 0.1) < 1e-6, 'o dz do corpo fica na matriz local');
}

/* geometria: a do componente na placa volta ao referencial do footprint */
const fp = { name:'SOT23', pads:[
  { name:'1', x:-0.95, y:-1.1, w:0.6, h:0.7, rot:0, shape:'rect', type:'smd' },
  { name:'2', x:0.95, y:-1.1, w:0.6, h:0.7, rot:0, shape:'rect', type:'smd' },
  { name:'3', x:0, y:1.1, w:0.6, h:0.7, rot:90, shape:'round', type:'smd' }], silk:[] };
const gLocal = HN.geometriaDe(fp);
assert.strictEqual(gLocal.pads.length, 3); assert.strictEqual(gLocal.pads[2].forma, 'circle');
assert.ok(Array.isArray(gLocal.contorno) && gLocal.contorno.length === 4);
for (const [layer, rot] of [['Top', 0], ['Top', 90], ['Bottom', 0], ['Bottom', 270]]) {
  const a = rot * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a), b = layer === 'Bottom';
  const comp = { x:7, y:3, rot, layer, pads:fp.pads.map(p => {
    const ly = b ? -p.y : p.y;
    return Object.assign({}, p, { x:7 + p.x * cs - ly * sn, y:3 + p.x * sn + ly * cs, rot:b ? rot - p.rot : rot + p.rot });
  }) };
  const g = HN.geometriaDeComp(comp);
  g.pads.forEach((q, i) => {
    assert.ok(Math.abs(q.x - gLocal.pads[i].x) < 1e-6 && Math.abs(q.y - gLocal.pads[i].y) < 1e-6, layer + ' ' + rot + ': pad ' + q.nome + ' ' + q.x + ',' + q.y);
    assert.ok(Math.abs(((q.rot - gLocal.pads[i].rot) % 360 + 360) % 360) < 1e-6 || Math.abs(((q.rot - gLocal.pads[i].rot) % 360 + 360) % 360 - 360) < 1e-6, layer + ' ' + rot + ': rot do pad');
  });
}

console.log('test-nexo: ok');
