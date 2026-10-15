/* AltiumPCBMirror - hub-nexopacote.js
   O pacote da placa para o NexoCAD (`placa.json`, formato eletrichub-placa-v1; contrato em
   docs/INTEGRACAO-NEXOCAD.md §4), montado da placa EFETIVA (HubCore.effectiveBoard, a mesma da
   tela e do Gerber) e dos corpos 3D que a vista 3D desenha (HubPcb3dModelo.corpos, ja com a
   biblioteca do NexoCAD por cima). Logica pura: navegador (global HubNexoPacote) e Node (o MCP,
   mcp/ferramentas/nexocad.js; tests/test-nexopacote.js).

   Referencial do pacote: o da placa do Altium, X para a direita, Y para cima, Z = 0 na face de
   BAIXO e a de cima em Z = espessura. O HubPcb3dModelo poe Z = 0 na face de CIMA (Bottom em
   -espessura): toda matriz e toda faixa Z sobem `espessura` aqui.

   API
     HubNexoPacote.monta(eb, opcoes) -> {pacote, avisos:[texto]}
       eb       a placa efetiva (formato do board.js)
       opcoes   {projeto, espessura (1,6), corpos (a saida do HubPcb3dModelo.corpos), vias (false:
                 as vias ficam de fora dos furos), gerado (ISO; padrao agora), laser (HubLaser, para
                 o mesmo filtro de recorte da tela; sem ele, o filtro local igual)}
       pacote.modelos[chave] = {arquivo:'modelos/<nome>.step', nome, url}: `url` e o caminho do STEP
       no hub (o servidor baixa e o tira do placa.json; ver POST /api/nexo/placa)
       No Nexo Hub (o item placa, papel `placa`) cada modelo vira {item:'<id>', rev:N, nome}, sem arquivo/url:
       o publicador e o mcp/lib/nexohub-sync.js » publicaPacote (e o tools/rotas/nexocad.py » publica_pacote)
     HubNexoPacote.contornoDe(outline) -> [laco] com [x,y] / [x,y,bulge]
     HubNexoPacote.conector(comp, contorno) -> bool
     e para os testes: lacos, furosDe, recortesDe, sobeZ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HubNexoPacote = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const FORMATO = 'eletrichub-placa-v1';
const ESPESSURA = 1.6;
const TOL = 1e-3;
const isNum = v => typeof v === 'number' && isFinite(v);
const r6 = v => { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; };
const P = (g, s) => [s.cx + s.r * Math.cos(g * Math.PI / 180), s.cy + s.r * Math.sin(g * Math.PI / 180)];
const igual = (a, b) => Math.abs(a[0] - b[0]) <= TOL && Math.abs(a[1] - b[1]) <= TOL;

/* ---------- contorno: segmentos do board.outline -> lacos com bulge ---------- */
function arestas(outline){
  const out = [];
  for (const s of (outline || [])) {
    if (!s) continue;
    if (s.kind === 'arc' && [s.cx, s.cy, s.r, s.sa, s.ea].every(isNum) && s.r > 0) {
      let sw = (((s.ea - s.sa) % 360) + 360) % 360;
      if (sw < 1e-9) sw = 360;
      if (sw >= 360 - 1e-9) {          /* circulo inteiro: duas meias-voltas (bulge 1) */
        out.push({ a:P(s.sa, s), b:P(s.sa + 180, s), bulge:1 });
        out.push({ a:P(s.sa + 180, s), b:P(s.sa, s), bulge:1 });
      } else out.push({ a:P(s.sa, s), b:P(s.ea, s), bulge:Math.tan(sw * Math.PI / 180 / 4) });
    } else if ([s.x1, s.y1, s.x2, s.y2].every(isNum) && !(s.x1 === s.x2 && s.y1 === s.y2)) {
      out.push({ a:[s.x1, s.y1], b:[s.x2, s.y2], bulge:0 });
    }
  }
  return out;
}
function area(l){
  let a = 0;
  for (let i = 0; i < l.length; i++) { const p = l[i], q = l[(i + 1) % l.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
function lacos(outline){
  const E = arestas(outline), usado = new Array(E.length).fill(false), out = [];
  for (let i0 = 0; i0 < E.length; i0++) {
    if (usado[i0]) continue;
    usado[i0] = true;
    const laco = [{ p:E[i0].a, b:E[i0].bulge }];
    const ini = E[i0].a;
    let fim = E[i0].b, fechou = igual(fim, ini);
    while (!fechou) {
      let achou = false;
      for (let j = 0; j < E.length; j++) {
        if (usado[j]) continue;
        if (igual(E[j].a, fim)) { usado[j] = true; laco.push({ p:E[j].a, b:E[j].bulge }); fim = E[j].b; achou = true; break; }
        if (igual(E[j].b, fim)) { usado[j] = true; laco.push({ p:E[j].b, b:-E[j].bulge }); fim = E[j].a; achou = true; break; }
      }
      if (!achou) break;
      fechou = igual(fim, ini);
    }
    if (fechou && (laco.length >= 3 || laco.some(v => v.b))) out.push(laco.map(v => v.b ? [r6(v.p[0]), r6(v.p[1]), Math.round(v.b * 1e9) / 1e9] : [r6(v.p[0]), r6(v.p[1])]));
  }
  out.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  return out;
}
function contornoDe(outline, bbox){
  const L = lacos(outline);
  if (L.length) return L;
  const b = bbox;
  if (b && [b.x1, b.y1, b.x2, b.y2].every(isNum)) return [[[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]]];
  return [];
}

/* ---------- recortes (a regra do pcbframe.js » recortesDe / HubLaser.boardCutouts) ---------- */
const COBRE = /^(Top|Bottom|Mid\d+|Plane\d+)$/;
function recortesDe(eb, laser){
  const out = [];
  const bd = (eb && eb.board && typeof eb.board === 'object') ? eb.board : {};
  const bb = bd.bbox;
  for (const k of ((eb && eb.cutouts) || [])) {
    if (!k || !Array.isArray(k.points) || k.points.length < 3) continue;
    if (isNum(k.kindn) && (k.kindn === -1 || k.kindn === 1)) continue;
    if (!isNum(k.kindn) && typeof k.layer === 'string' && COBRE.test(k.layer)) continue;
    let pts;
    if (laser && laser.boardCutouts) {
      const f = laser.boardCutouts({ board:{ bbox:bb, outline:bd.outline || [] }, cutouts:[k] });
      if (!f.length) continue;
      pts = f[0];
    } else {
      pts = k.points.map(q => [q[0], q[1]]);
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      if (bb && Math.min(...xs) <= bb.x1 + TOL && Math.max(...xs) >= bb.x2 - TOL && Math.min(...ys) <= bb.y1 + TOL && Math.max(...ys) >= bb.y2 - TOL) continue;
    }
    if (pts.length > 3 && igual(pts[0], pts[pts.length - 1])) pts = pts.slice(0, -1);
    out.push(pts.map(q => [r6(q[0]), r6(q[1])]));
  }
  return out;
}

/* ---------- furos ---------- */
function tipoFuro(p){
  if (p.type === 'npth' || p.plated === false) return 'npth';
  if (isNum(p.w) && isNum(p.h) && p.drill >= Math.min(p.w, p.h) - 1e-6) return 'npth';   /* cobre do tamanho do furo: fixacao */
  return 'pth';
}
function furosDe(eb, vias){
  const out = [];
  const poe = (p, tipo) => {
    if (!p || !(p.drill > 0) || !isNum(p.x) || !isNum(p.y)) return;
    const f = { x:r6(p.x), y:r6(p.y), d:r6(p.drill), tipo:tipo || tipoFuro(p) };
    if ((p.drillshape === 'oblong' || p.drillshape === 'rect') && p.drillw > 0) { f.forma = p.drillshape; f.w = r6(p.drillw); f.rot = r6((p.rot || 0) + (p.holerot || 0)); }
    out.push(f);
  };
  for (const c of ((eb && eb.components) || [])) for (const p of ((c && c.pads) || [])) poe(p);
  for (const p of ((eb && eb.freepads) || [])) poe(p);
  if (vias) for (const v of ((eb && eb.vias) || [])) poe(v, 'via');
  return out;
}

/* ---------- conector ---------- */
const PREFIXO = /^(USB|CON|CN|J|X|P)(\d|$|[-_])/i;
function dentro(pt, laco){
  let d = false;
  for (let i = 0, j = laco.length - 1; i < laco.length; j = i++) {
    const a = laco[i], b = laco[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) d = !d;
  }
  return d;
}
function conector(c, contorno){
  if (!c) return false;
  if (PREFIXO.test(String(c.ref || ''))) return true;
  const th = (c.pads || []).some(p => p && (p.type === 'th' || p.layer === 'Multi') && p.drill > 0);
  if (!th) return false;
  const L = contorno && contorno[0];
  const b = c.bbox;
  if (!L || !b || ![b.x1, b.y1, b.x2, b.y2].every(isNum)) return false;
  return [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]].some(q => !dentro(q, L));
}

/* ---------- corpos ---------- */
function sobeZ(m, dz){
  const a = m.slice();
  for (let j = 0; j < 4; j++) a[j * 4 + 2] = r6(a[j * 4 + 2] + dz * a[j * 4 + 3]);
  return a;
}
const nomeArq = s => String(s || 'modelo').replace(/\.(step|stp)$/i, '').replace(/[^A-Za-z0-9._ ()+-]+/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 60) || 'modelo';
const circulo = (cx, cy, r, n) => { const o = []; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; o.push([r6(cx + r * Math.cos(a)), r6(cy + r * Math.sin(a))]); } return o; };
function urlAbs(u){ return !u ? '' : /^(\/|https?:)/i.test(u) ? u : '/' + u; }

function monta(eb, opcoes){
  opcoes = opcoes || {};
  const avisos = [];
  const esp = isNum(opcoes.espessura) && opcoes.espessura > 0 ? opcoes.espessura : ESPESSURA;
  const bd = (eb && eb.board && typeof eb.board === 'object') ? eb.board : {};
  const contorno = contornoDe(bd.outline, bd.bbox);
  if (!contorno.length) avisos.push('a placa não tem contorno nem bbox');
  const modelos = {}, usados = new Set();
  const porDono = new Map();
  for (const b of (opcoes.corpos || [])) {
    if (!b || !b.owner) continue;
    if (!porDono.has(b.owner)) porDono.set(b.owner, []);
    porDono.get(b.owner).push(b);
  }
  const corpoDe = b => {
    const cor = b.color || '#808080';
    if (b.kind === 'step') {
      const chave = b.modeloChave || b.model || '';
      if (!b.modelUrl || !chave) { avisos.push((b.owner || '?') + ': corpo STEP sem arquivo (' + (b.name || chave || 'sem nome') + ')'); return null; }
      if (!modelos[chave]) {
        let arq = 'modelos/' + nomeArq(b.name || chave.split('/').pop()) + '.step', n = 1;
        while (usados.has(arq.toLowerCase())) arq = 'modelos/' + nomeArq(b.name || chave.split('/').pop()) + '-' + (++n) + '.step';
        usados.add(arq.toLowerCase());
        modelos[chave] = { arquivo:arq, nome:b.name || chave.split('/').pop(), url:urlAbs(b.modelUrl) };
      }
      return { tipo:'step', modelo:chave, matriz:sobeZ(b.matrix, esp), cor };
    }
    if (b.kind === 'extruded' && Array.isArray(b.pts) && b.pts.length >= 3) {
      const o = { tipo:'extrudado', pts:b.pts.map(q => [r6(q[0]), r6(q[1])]), z0:r6(b.z0 + esp), z1:r6(b.z1 + esp), cor };
      if (Array.isArray(b.holes) && b.holes.length) o.furos = b.holes.map(h => h.map(q => [r6(q[0]), r6(q[1])]));
      if (b.placeholder) o.placeholder = true;
      return o;
    }
    if ((b.kind === 'cylinder' || b.kind === 'sphere') && b.radius > 0 && Array.isArray(b.matrix)) {
      const m = b.matrix, z = [m[8], m[9], m[10]];
      const cx = m[12], cy = m[13], cz = m[14] + esp;
      if (b.kind === 'sphere') return { tipo:'extrudado', pts:circulo(cx, cy, b.radius, 24), z0:r6(cz - b.radius), z1:r6(cz + b.radius), cor, forma:'esfera' };
      if (Math.abs(Math.abs(z[2]) - 1) < 1e-6) {
        const h = (b.height || 1) * Math.sign(z[2]);
        return { tipo:'extrudado', pts:circulo(cx, cy, b.radius, 24), z0:r6(Math.min(cz, cz + h)), z1:r6(Math.max(cz, cz + h)), cor, forma:'cilindro' };
      }
      avisos.push((b.owner || '?') + ': cilindro deitado ficou de fora');
      return null;
    }
    return null;
  };
  const componentes = [];
  for (const c of ((eb && eb.components) || [])) {
    if (!c || !c.ref) continue;
    const bb = c.bbox && [c.bbox.x1, c.bbox.y1, c.bbox.x2, c.bbox.y2].every(isNum) ? [r6(c.bbox.x1), r6(c.bbox.y1), r6(c.bbox.x2), r6(c.bbox.y2)] : null;
    const o = { ref:c.ref, footprint:c.footprint || '', comment:c.comment || '', lado:String(c.layer || '').toLowerCase() === 'bottom' ? 'Bottom' : 'Top',
                x:r6(c.x || 0), y:r6(c.y || 0), rot:r6(c.rot || 0) };
    if (bb) o.bbox = bb;
    o.conector = conector(c, contorno);
    o.corpos = (porDono.get(c.ref) || []).map(corpoDe).filter(Boolean);
    componentes.push(o);
  }
  const pacote = {
    format:FORMATO, projeto:opcoes.projeto || '', gerado:opcoes.gerado || new Date().toISOString(), espessura:r6(esp),
    contorno, recortes:recortesDe(eb, opcoes.laser), furos:furosDe(eb, !!opcoes.vias), componentes, modelos,
  };
  return { pacote, avisos };
}

return { FORMATO, monta, contornoDe, lacos, recortesDe, furosDe, conector, sobeZ };
});
