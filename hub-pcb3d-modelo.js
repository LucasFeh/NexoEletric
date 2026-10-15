/* AltiumPCBMirror v2 - hub-pcb3d-modelo.js
   Os corpos 3D da placa EFETIVA (a que o HubCore.effectiveBoard devolve, com as mudancas ja
   assadas), prontos para a vista 3D desenhar. Logica pura, sem DOM e sem Three.js: navegador
   (global HubPcb3dModelo) e node (tests/test-pcb3d-modelo.js).

   De onde vem
     Projects/<p>/board3d.js  `var pcbmirror3d = {format:'pcb3d-v1', source, thickness,
                              thicknessFrom, bodies:[...], models:{...}, componentes:{...}}`,
                              gravado por tools/pcb3d/extrai3d.py a partir do .PcbDoc
     Libs/pcblib-3d.js        `var pcblib3d = {format:'pcblib3d-v1', footprints:{<nome>:{bodies}},
                              models}`, de tools/pcb3d/pcblib3d.py: corpos LOCAIS ao footprint
                              (origem dele, rot 0, Top), para o componente que o hub acrescentou

   Um corpo do board3d.js (mm, referencial da placa, Z = 0 na face de cima, Z negativo para baixo)
     {owner:'R5'|'', side:'top'|'bottom', kind:'extruded'|'step'|'cylinder'|'sphere', layer,
      color:'#rrggbb', opacity:0..1, raw:{x2d,y2d,rot2d,rotx,roty,rotz,dz,standoff,overall},
      extruded:  pts:[[x,y]...], holes?:[[[x,y]...]], standoff, height   (contorno absoluto;
                 standoff e height sao as alturas da base e do topo, contadas da face do lado
                 para fora: o corpo ocupa [standoff, height] -- height NAO e a espessura)
      step:      model:'<modelId>', name, matrix:[16], outline:[[x,y]...] (a caixa XY que o Altium
                 gravou, so para conferir)
      cylinder:  radius, height, matrix  (eixo Z local, base na origem; sem exemplo medido)
      sphere:    radius, matrix          (centro na origem; sem exemplo medido)}
   matrix e coluna-maior, como o Matrix4.fromArray do Three.js, e leva o ponto do arquivo STEP
   (em mm -- o occt-import-js entrega em mm) direto para a placa.

   A conta (MEDIDA em 2026-10-13: a caixa do STEP posicionado bate com o contorno que o Altium
   gravou em 1.076 de 1.078 corpos do DMB, LM555, WiFi e MiniPC, erro <= 0,008 mm):
     Top:    M = T(x2d, y2d, dz) . Rz(rotz) . Ry(roty) . Rx(rotx)
     Bottom: M = T(x2d, y2d, -esp) . Rx(180) . T(0, 0, dz) . Rz(rotz) . Ry(roty) . Rx(rotx)
   O rotz do Altium ja traz a rotacao do componente; o rot2d (0 em todos os medidos) entra junto.

   Componente movido/virado (comp_move): o corpo anda com a MESMA conta do HubCore.compDelta (a dos
   pads e do Gerber), levada para 3D:
     sem flip: D = T(N) . Rz(r1 - r0) . T(-O)
     flip:     D = T(Nx, Ny, -esp) . Rz(r1 + r0) . Rx(180) . T(-Ox, -Oy, 0)
   (Rx(180) e o Sy do hub -- espelha o Y local -- feito rotacao: o corpo vai para a outra face de
   cabeca para baixo; ida e volta e identidade.) O ponto de origem e o d3.componentes[ref].

   API
     HubPcb3dModelo.corpos(eb, d3, opcoes) -> [{owner, side, kind, ...geometria, matrix, color,
       opacity, modelUrl, placeholder?, origem}]
       eb      a placa efetiva (formato do board.js)
       d3      o pcbmirror3d (ou null: tudo vira biblioteca/placeholder)
       opcoes  {pcblib3d (o var pcblib3d, se carregado), pcblib3dHub (HubFpLib.lib3d: os corpos que o
               editor de footprint do hub pos -- passam na frente do board3d e do pcblib3d), base ('Projects/<p>/', prefixo do
               modelUrl do board3d), baseLib ('Libs/', prefixo do modelUrl da biblioteca),
               thickness (sobrepoe a do d3), placeholder (false = nao inventa caixa),
               alturas ({smdPassivo, ci, th, semPad} em mm), board (o board.js ORIGINAL: acha o
               componente renomeado por comp_attr pelo id), renomes ({refNovo: refAntigo}),
               nexo (HubNexo.resolvedor(): a biblioteca do NexoCAD por cima de tudo -- `substitui`
               troca o STEP de um corpo, o vinculo pelo footprint troca todos os corpos dele),
               projeto (o nome do projeto: a chave 'projeto:<p>/<file>' dos modelos do board3d)}
       Todo corpo STEP sai com modeloChave (a chave de modelo do contrato do NexoCAD); o que veio da
       biblioteca do NexoCAD sai com origem 'nexo', nexo:<id> e chave:'nexo:<id>@<rev>' (cache)
       Saida, por kind:
         extruded: pts (ja movidos), holes?, standoff, height, z0/z1 (a faixa Z ABSOLUTA na placa:
                   Top [standoff, height]; Bottom [-esp-height, -esp-standoff]) e matrix identidade
         step:     model, matrix (FINAL), modelUrl ('' se o modelo nao esta embutido)
         cylinder/sphere: radius, height?, matrix (final)
       origem: 'hub' | 'board3d' | 'biblioteca' | 'placeholder' | 'nexo'
     HubPcb3dModelo.matrizCorpo(raw, comp) -> [16] coluna-maior
       raw  {x2d, y2d, rot2d, rotx, roty, rotz, dz}
       comp {side|layer, thickness, orig?:{x,y,rot,layer}, eff?:{x,y,rot,layer}}: com orig e eff,
            ja aplica o deslocamento/giro/flip do componente
     HubPcb3dModelo.placeholder(comp, eb, opcoes) -> corpo extrudado (placeholder:true)
     e para os testes: deltaComp, matPose, mul4, aplica, colMaior, ALTURAS

   Quando recarregar: o board3d.js muda so quando se reextrai do .PcbDoc; corpos() se refaz a cada
   placa efetiva nova (cada mudanca no changes.js). E barato: so multiplica matrizes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HubPcb3dModelo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const VERSAO = '2026-10-13';
const ESPESSURA_PADRAO = 1.6;
/* altura do placeholder (componente sem corpo nenhum), em mm, contada da face:
   SMD passivo/discreto = ate 3 pads e caixa ate 7 mm (0402..2512, SOT-23, SMA); CI = SMD com
   mais pads ou maior; TH = algum pad passante (conector, eletrolitico, rele); semPad = so desenho */
const ALTURAS = { smdPassivo: 0.6, ci: 1.5, th: 8, semPad: 1 };
const COR_PLACEHOLDER = { smdPassivo: '#8a6d46', ci: '#2b2b2b', th: '#3c4a5c', semPad: '#7a7a7a' };

const isNum = v => typeof v === 'number' && isFinite(v);
const num = (v, d) => isNum(v) ? v : (d === undefined ? 0 : d);
const ex = v => Math.abs(v) < 1e-12 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-12 ? Math.sign(v) : v;
function cs(g){ const a = g * Math.PI / 180; return [ex(Math.cos(a)), ex(Math.sin(a))]; }

/* matrizes 4x4 linha-maior (m[i][j]); saem coluna-maior */
const I4 = () => [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
function mul4(A, B){
  const R = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0; for (let k = 0; k < 4; k++) s += A[i][k] * B[k][j];
    R[i][j] = s;
  }
  return R;
}
const mulN = (...Ms) => Ms.reduce((A, B) => mul4(A, B));
function rx(g){ const [c, s] = cs(g); return [[1,0,0,0],[0,c,-s,0],[0,s,c,0],[0,0,0,1]]; }
function ry(g){ const [c, s] = cs(g); return [[c,0,s,0],[0,1,0,0],[-s,0,c,0],[0,0,0,1]]; }
function rz(g){ const [c, s] = cs(g); return [[c,-s,0,0],[s,c,0,0],[0,0,1,0],[0,0,0,1]]; }
const tr = (x, y, z) => [[1,0,0,x],[0,1,0,y],[0,0,1,z],[0,0,0,1]];
const r6 = v => { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; };
function colMaior(M){ const o = []; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) o.push(r6(M[i][j])); return o; }
function deColMaior(a){ const M = I4(); for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) M[i][j] = a[j*4 + i]; return M; }
function aplica(M, p){
  const x = p[0], y = p[1], z = p.length > 2 ? p[2] : 0;
  return [M[0][0]*x + M[0][1]*y + M[0][2]*z + M[0][3],
          M[1][0]*x + M[1][1]*y + M[1][2]*z + M[1][3],
          M[2][0]*x + M[2][1]*y + M[2][2]*z + M[2][3]];
}

const ladoDe = c => {
  const s = String((c && (c.side || c.layer)) || 'top').toLowerCase();
  return s === 'bottom' ? 'bottom' : 'top';
};
const espDe = (c, d) => isNum(c && c.thickness) ? c.thickness : (isNum(d) ? d : ESPESSURA_PADRAO);

/* a matriz do corpo no lugar onde o Altium o gravou (linha-maior) */
function matCorpoBruta(raw, lado, esp){
  const R = mulN(rz(num(raw.rot2d) + num(raw.rotz)), ry(num(raw.roty)), rx(num(raw.rotx)));
  if (lado === 'bottom') return mulN(tr(num(raw.x2d), num(raw.y2d), -esp), rx(180), tr(0, 0, num(raw.dz)), R);
  return mul4(tr(num(raw.x2d), num(raw.y2d), num(raw.dz)), R);
}

/* o deslocamento do componente: da pose de origem (o / board3d) para a efetiva (e), em 3D */
function deltaComp(o, e, esp){
  if (!o || !e) return I4();
  const r0 = num(o.rot), r1 = isNum(e.rot) ? e.rot : r0;
  const flip = ladoDe(o) !== ladoDe(e);
  const nx = isNum(e.x) ? e.x : num(o.x), ny = isNum(e.y) ? e.y : num(o.y);
  if (!flip) return mulN(tr(nx, ny, 0), rz(r1 - r0), tr(-num(o.x), -num(o.y), 0));
  return mulN(tr(nx, ny, -esp), rz(r1 + r0), rx(180), tr(-num(o.x), -num(o.y), 0));
}
/* a pose do footprint na placa (corpo LOCAL da biblioteca -> placa): a convencao do HubCore
   (Bottom: O + R(r) . Sy . local), com Sy feito Rx(180) e a descida da espessura */
function matPose(c, esp){
  const x = num(c && c.x), y = num(c && c.y), r = num(c && c.rot);
  if (ladoDe(c) === 'bottom') return mulN(tr(x, y, -esp), rz(r), rx(180));
  return mul4(tr(x, y, 0), rz(r));
}

/* API: a matriz final, coluna-maior. comp.orig + comp.eff = o componente andou */
function matrizCorpo(raw, comp){
  comp = comp || {};
  const esp = espDe(comp);
  const lado = comp.orig ? ladoDe(comp.orig) : ladoDe(comp);
  let M = matCorpoBruta(raw || {}, lado, esp);
  if (comp.orig && comp.eff) M = mul4(deltaComp(comp.orig, comp.eff, esp), M);
  return colMaior(M);
}

/* ---- extrudado ---- */
const xy = (M, p) => { const q = aplica(M, [p[0], p[1], 0]); return [r6(q[0]), r6(q[1])]; };
function faixaZ(lado, standoff, height, esp){
  return lado === 'bottom' ? [r6(-esp - height), r6(-esp - standoff)] : [r6(standoff), r6(height)];
}
function extrudado(b, M, lado, esp, extra){
  const o = Object.assign({ owner: b.owner || '', side: lado, kind: 'extruded', layer: b.layer || '',
    color: b.color || '#808080', opacity: isNum(b.opacity) ? b.opacity : 1 }, extra || {});
  o.pts = (b.pts || []).map(p => xy(M, p));
  if (Array.isArray(b.holes) && b.holes.length) o.holes = b.holes.map(h => h.map(p => xy(M, p)));
  o.standoff = num(b.standoff); o.height = num(b.height);
  const z = faixaZ(lado, o.standoff, o.height, esp);
  o.z0 = z[0]; o.z1 = z[1];
  o.matrix = colMaior(I4());
  /* contorno espelhado (flip) sai no sentido contrario: devolve anti-horario, como entrou */
  if (area(o.pts) * area(b.pts || []) < 0) { o.pts.reverse(); if (o.holes) o.holes.forEach(h => h.reverse()); }
  if (b.raw) o.raw = b.raw;
  return o;
}
function area(pts){
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0]*q[1] - q[0]*p[1]; }
  return a / 2;
}

/* ---- placeholder: a caixa do componente sem corpo ---- */
function classe(comp){
  const pads = (comp && comp.pads) || [];
  if (!pads.length) return 'semPad';
  if (pads.some(p => p && (p.type === 'th' || p.type === 'npth' || num(p.drill) > 0 || p.layer === 'Multi'))) return 'th';
  return null;
}
function cantosPad(p){
  const w = num(p.w), h = num(p.h), [c, s] = cs(num(p.rot));
  return [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([a, b]) => [p.x + a*c - b*s, p.y + a*s + b*c]);
}
function pontosSilk(o){
  if (o.kind === 'arc' || isNum(o.r)) return [[o.cx - o.r, o.cy - o.r], [o.cx + o.r, o.cy + o.r]];
  if (isNum(o.x1)) return [[o.x1, o.y1], [o.x2, o.y2]];
  return [];
}
function placeholder(comp, eb, opcoes){
  opcoes = opcoes || {};
  const esp = espDe(opcoes, eb && eb.thickness);
  const lado = ladoDe(comp);
  const P = matPose(comp, esp), Pinv = inversa(P);
  const local = pts => pts.map(p => aplica(Pinv, [p[0], p[1], lado === 'bottom' ? -esp : 0]));
  const ref = comp.ref;
  /* serigrafia do componente; sem ela, os pads; sem pads, o courtyard/linhas; sem nada, o bbox */
  let pts = [];
  const silk = ((eb && eb.silk) || []).filter(o => o && o.owner === ref);
  for (const o of silk) pts.push(...pontosSilk(o));
  let fonte = 'serigrafia';
  const pads = (comp.pads || []).filter(Boolean);
  if (!pts.length && pads.length) { for (const p of pads) pts.push(...cantosPad(p)); fonte = 'pads'; }
  if (!pts.length) {
    for (const o of ((eb && eb.lines) || []).filter(o => o && o.owner === ref)) pts.push(...pontosSilk(o));
    fonte = 'linhas';
  }
  if (!pts.length && comp.bbox && isNum(comp.bbox.x1)) {
    const b = comp.bbox; pts = [[b.x1, b.y1], [b.x2, b.y2]]; fonte = 'bbox';
  }
  if (!pts.length) { pts = [[num(comp.x) - 0.5, num(comp.y) - 0.5], [num(comp.x) + 0.5, num(comp.y) + 0.5]]; fonte = 'ponto'; }
  const L = local(pts);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of L) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
  let cl = classe(comp);
  if (!cl) cl = (pads.length <= 3 && Math.max(x1 - x0, y1 - y0) <= 7) ? 'smdPassivo' : 'ci';
  const H = Object.assign({}, ALTURAS, opcoes.alturas || {});
  const b = { owner: ref || '', layer: '', color: COR_PLACEHOLDER[cl], opacity: 1,
              pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], standoff: 0, height: H[cl] };
  return extrudado(b, P, lado, esp, { placeholder: true, classe: cl, fonteContorno: fonte, origem: 'placeholder' });
}
function inversa(M){
  /* so rigida (rotacao + translacao) */
  const R = [[M[0][0], M[1][0], M[2][0]], [M[0][1], M[1][1], M[2][1]], [M[0][2], M[1][2], M[2][2]]];
  const t = [M[0][3], M[1][3], M[2][3]];
  const o = I4();
  for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) o[i][j] = R[i][j]; o[i][3] = -(R[i][0]*t[0] + R[i][1]*t[1] + R[i][2]*t[2]); }
  return o;
}

/* ---- um corpo (do board3d ou da biblioteca) levado pela matriz D ---- */
function urlDe(models, base, id){
  const m = models && Object.prototype.hasOwnProperty.call(models, id) ? models[id] : null;
  if (m && /^nexo:/.test(m.file || '')) return '';      /* item da biblioteca do NexoCAD: so pelo opcoes.nexo */
  return m && m.file ? (base || '') + m.file : '';
}
/* a chave de modelo do contrato do NexoCAD (docs/INTEGRACAO-NEXOCAD.md): o `file` do modelo;
   do board3d.js, 'projeto:<p>/<file>' */
function chaveDe(models, id, prefixo){
  const m = models && Object.prototype.hasOwnProperty.call(models, id) ? models[id] : null;
  if (m && m.file) return /^nexo:/.test(m.file) ? m.file : (prefixo || '') + m.file;
  return /^nexo:/.test(String(id || '')) ? String(id) : '';
}
function leva(b, D, lado, esp, models, base, origem, owner, prefixo){
  if (b.kind === 'extruded') {
    return extrudado(Object.assign({}, b, { owner }), D, lado, esp, { origem });
  }
  const o = { owner, side: lado, kind: b.kind, layer: b.layer || '', color: b.color || '#808080',
              opacity: isNum(b.opacity) ? b.opacity : 1, origem };
  /* do raw, com a espessura de agora (a matrix gravada leva a do board3d); sem raw, a matrix */
  const M0 = b.raw && isNum(b.raw.x2d) ? matCorpoBruta(b.raw, ladoDe(b), esp)
           : Array.isArray(b.matrix) && b.matrix.length === 16 ? deColMaior(b.matrix) : I4();
  o.matrix = colMaior(mul4(D, M0));
  if (b.kind === 'step') { o.model = b.model; o.name = b.name || ''; o.modelUrl = urlDe(models, base, b.model); o.modeloChave = chaveDe(models, b.model, prefixo); }
  if (isNum(b.radius)) o.radius = b.radius;
  if (b.kind === 'cylinder' && isNum(b.height)) o.height = b.height;
  if (b.raw) o.raw = b.raw;
  return o;
}

/* ---- API principal ---- */
function corpos(eb, d3, opcoes){
  opcoes = opcoes || {};
  const esp = isNum(opcoes.thickness) ? opcoes.thickness : (d3 && isNum(d3.thickness) ? d3.thickness : ESPESSURA_PADRAO);
  const base = opcoes.base || '', baseLib = opcoes.baseLib === undefined ? 'Libs/' : opcoes.baseLib;
  const lib = opcoes.pcblib3d || null, hub = opcoes.pcblib3dHub || null;
  const origem = (d3 && d3.componentes) || {};
  const porDono = Object.create(null);
  const livres = [];
  for (const b of ((d3 && d3.bodies) || [])) {
    if (!b) continue;
    if (b.owner) (porDono[b.owner] = porDono[b.owner] || []).push(b);
    else livres.push(b);
  }
  /* renomeado por comp_attr: o ref efetivo -> o ref da origem (pelo id do board.js original) */
  const ren = Object.assign(Object.create(null), opcoes.renomes || {});
  if (opcoes.board && Array.isArray(opcoes.board.components)) {
    const porId = Object.create(null);
    for (const c of opcoes.board.components) if (c && c.id) porId[c.id] = c.ref;
    for (const c of ((eb && eb.components) || [])) if (c && c.id && porId[c.id] && porId[c.id] !== c.ref && !(c.ref in ren)) ren[c.ref] = porId[c.id];
  }
  const out = [];
  const tem = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k);
  const nx = opcoes.nexo || null;
  const prefD3 = opcoes.projeto ? 'projeto:' + opcoes.projeto + '/' : '';
  for (const c of ((eb && eb.components) || [])) {
    if (!c) continue;
    const ini = out.length;
    corposDoComp(c);
    if (nx) aplicaNexo(c, ini);
  }
  /* a biblioteca do NexoCAD (opcoes.nexo, o HubNexo.resolvedor()), pela prioridade do contrato:
     `substitui` troca so aquele corpo STEP (mesma matriz) > o item vinculado ao footprint entra no
     lugar de TODOS os corpos dele (um STEP na identidade do footprint) > as fontes de sempre */
  function aplicaNexo(c, ini){
    let trocou = false;
    for (let i = ini; i < out.length; i++) {
      const o = out[i];
      if (o.kind !== 'step') continue;
      const k = o.modeloChave || '';
      const r = /^nexo:/.test(k) ? nx.porId(k.slice(5)) : (k ? nx.porChave(k) : null);
      if (/^nexo:/.test(k)) trocou = true;
      if (!r) continue;
      trocou = true;
      o.modelUrl = r.url; o.chave = r.chave; o.nexo = r.id; o.origemAntes = o.origem; o.origem = 'nexo';
      if (!o.name) o.name = r.nome || '';
    }
    if (trocou) return;
    const f = c.footprint && nx.porFootprint(c.footprint);
    if (!f) return;
    const P = matPose(c, esp);
    out.splice(ini, out.length - ini, { owner:c.ref || '', side:ladoDe(c), kind:'step', layer:'', color:'#9a9a9a', opacity:1,
      origem:'nexo', vinculo:'footprint', model:'nexo:' + f.id, name:f.nome || '', modeloChave:'nexo:' + f.id, nexo:f.id,
      modelUrl:f.url, chave:f.chave, matrix:colMaior(P) });
  }
  function corposDoComp(c){
    /* o corpo que o editor de footprint do hub pos (Libs/pcblib-hub.js) vale mais que o do PcbDoc:
       foi escolhido DEPOIS, de proposito */
    const fh = hub && hub.footprints && tem(hub.footprints, c.footprint) ? hub.footprints[c.footprint] : null;
    if (fh && Array.isArray(fh.bodies) && fh.bodies.length) {
      const P = matPose(c, esp), lado = ladoDe(c);
      for (const b of fh.bodies) {
        const ladoB = ladoDe(b) === 'bottom' ? (lado === 'top' ? 'bottom' : 'top') : lado;
        out.push(leva(b, P, ladoB, esp, hub.models, baseLib, 'hub', c.ref));
      }
      return;
    }
    const refO = tem(ren, c.ref) ? ren[c.ref] : c.ref;
    const o = tem(origem, refO) ? origem[refO] : null;
    const doD3 = o && porDono[refO] && (!o.footprint || !c.footprint || o.footprint === c.footprint);
    if (doD3) {
      const D = deltaComp(o, c, esp);
      const lado = ladoDe(c);
      for (const b of porDono[refO]) {
        /* o corpo de Bottom num componente de Top (raro, mas o Altium deixa) vira junto */
        const ladoB = ladoDe(o) === ladoDe(c) ? ladoDe(b) : (ladoDe(b) === 'top' ? 'bottom' : 'top');
        out.push(leva(b, D, ladoB || lado, esp, d3.models, base, 'board3d', c.ref, prefD3));
      }
      return;
    }
    const fp = lib && lib.footprints && tem(lib.footprints, c.footprint) ? lib.footprints[c.footprint] : null;
    if (fp && Array.isArray(fp.bodies) && fp.bodies.length) {
      const P = matPose(c, esp), lado = ladoDe(c);
      for (const b of fp.bodies) {
        const ladoB = ladoDe(b) === 'bottom' ? (lado === 'top' ? 'bottom' : 'top') : lado;
        out.push(leva(b, P, ladoB, esp, lib.models, baseLib, 'biblioteca', c.ref));
      }
      return;
    }
    if (opcoes.placeholder !== false) out.push(placeholder(c, eb, { thickness: esp, alturas: opcoes.alturas }));
  }
  for (const b of livres) {
    const o = leva(b, I4(), ladoDe(b), esp, d3.models, base, 'board3d', '', prefD3);
    const r = nx && o.kind === 'step' && o.modeloChave ? nx.porChave(o.modeloChave) : null;
    if (r) { o.modelUrl = r.url; o.chave = r.chave; o.nexo = r.id; o.origemAntes = o.origem; o.origem = 'nexo'; }
    out.push(o);
  }
  return out;
}

return { corpos, matrizCorpo, placeholder, deltaComp, matPose, mul4, aplica, colMaior, deColMaior,
         ALTURAS, ESPESSURA_PADRAO, VERSAO };
});
