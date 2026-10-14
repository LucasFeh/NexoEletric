/* AltiumPCBMirror v2 - hub-pcbpour.js
   Polygon pour do hub (G3 do docs/PCB-MIGRACAO.md): o despejo de cobre que o Altium faz em
   Tools > Polygon Pours > Repour, refeito a partir da placa EFETIVA (HubCore.effectiveBoard, o
   formato do board.js). Mover uma trilha perto de um poligono deixava o cobre velho do espelho no
   lugar e o Gerber saia em curto; com isto a tela e o Gerber usam o cobre redespejado.

   Logica pura, sem DOM: navegador (global HubPcbPour) e Node (tests/test-pcbpour.js).
   Dependencias: hub-clipper.js (Clipper 6.4.2, Boost) para recorte/offset; hub-gerber.js e
   OPCIONAL (texto de cobre pelo HubGerber.geometriaTexto, o mesmo desenho da tela e do Gerber;
   sem ele o texto vira o retangulo da caixa).

   O POLIGONO (eb.polygons[], criado/alterado pelas ops poly_add/poly_edit/poly_del do changes.js)
     { id:'p1', nome:'GND_L01_P000', layer:'Top', net:'GND',
       pts:[[x,y],...],            contorno em mm (arcos ja achatados), fechado implicito
       pour:'solid'|'hatch'|'none', 'none' = arquivado (Shelved): nao despeja
       ordem:0,                    POURINDEX do Altium: o menor despeja primeiro e o seguinte o evita
       pourOver:'all'|'polygons'|'none',  TPolygonPourOver (AdvPcb.dll: None, SameNet, SameNetPolygons):
                                   'all' = cobre por cima de tudo da mesma net; fora dele, trilha/arco
                                   da mesma net leva cobre por cima se a conexao e direct e vira
                                   obstaculo a gap do termico se e relief (medido: MTBP e DSC);
                                   fill/regiao da mesma net vira obstaculo
       removeDead:false,           tira ilha sem pad/via (nem trilha, no 'all') da net
       removeNecks:true, neck:0.127,     tira pescoco mais estreito que neck (mm)
       minArea:1.6129,             mm²; ilha menor sai (0 = nao tira). 1,6129 = os 2500 mil² do Altium
       arco:0.0127,                ArcResolution: flecha maxima ao achatar curva (mm)
       clearance:0.254,            folga para cobre de outra net (a regra Clearance)
       clearanceTipo?:{track,arc,smd,th,via,fill,region,text,poly: mm},   a matriz OBJECTCLEARANCES
       clearanceNet?:{'+5V':{track:..., '*':...}},                          regra por net
       clearanceBorda?:0,          folga do contorno da placa e dos board cutouts (BoardOutlineClearance)
       conexao:{tipo:'relief'|'direct'|'none', condutores:4, largura:0.254, gap:0.254, angulo:90|45},
       conexaoVia?, conexaoSmd?,   a mesma coisa so para via / pad SMD (regra com IsVia, IsSMDPad)
       conexaoObj?:{'c12p3':{...}},       por pad/via (regra com InComponent...)
       hatch?:{grade, largura},    so documentado: hachurado sai solido, com aviso (0 de 39 no acervo)
       hash?:'a1b2c3d4' }          assinatura do que o despejo usou (assinatura()); o integrador grava
                                   ao despejar e compara para pintar "modified" como o Altium

   O RESULTADO (o que entra no lugar das regions poly:true do espelho)
     { layer, net, pts:[[x,y]...], holes:[[[x,y]...]...], poly:true, de:'p1' }
     raios termicos ja vem unidos ao cobre (o Altium tambem grava o solido como regioes).

   FIDELIDADE (tools/pour/compara.js, 18 PcbDoc do acervo com poligono, 2026-10-13): XOR contra as
   regioes que o Altium gravou abaixo de 0,4% em 13 placas (0,00% nos 12 poligonos do CMK8),
   0,8-0,9% no DSC (ArcResolution 0,2 mm) e no PGS; 2-6% so no MAX31865 importado do Eagle.
   Tempo: 1 a 130 ms por poligono real; 0,5 s na placa sintetica densa do teste.

   API
     despeja(eb, poligono, opcoes) -> { regioes, avisos, ms, hash, area }
        opcoes.anteriores  regioes ja despejadas pelos poligonos de ordem menor (o despejaTodos
                           passa); sem ela, os de ordem menor de eb.polygons sao despejados antes
        opcoes.texto       funcao(t) -> HubGerber.geometriaTexto(t) (padrao: o HubGerber carregado)
     despejaTodos(eb, opcoes) -> { regioes, porPoligono:{id:{regioes, avisos, ms, hash, area}}, avisos, ms }
     assinatura(eb, poligono) -> hash (string) de tudo que muda o despejo
     desatualizado(eb, poligono) -> true se poligono.hash nao bate com a placa de agora
     placaSemDespejoVelho(eb, regioes) -> eb com as regions poly:true trocadas pelas novas (para o Gerber)
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    let G = null;
    try { G = require('./hub-gerber.js'); } catch (e) { G = null; }
    module.exports = factory(require('./hub-clipper.js'), G);
  } else root.HubPcbPour = factory(root.ClipperLib, null, root);
})(typeof self !== 'undefined' ? self : this, function (ClipperLib, Gerber0, root) {
"use strict";

const C = ClipperLib;
const ESC = 1e4;                 /* unidades do Clipper por mm (0,1 um). Placa de 900 mm ainda cabe
                                    no caminho rapido do Clipper JS (produtos < 2^53) */
const ARCO_PADRAO = 0.0127;      /* ArcResolution do Altium: 0,5 mil (37 de 39 poligonos do acervo) */
const CLEAR_PADRAO = 0.254;      /* 10 mil: a Clearance de 95 de 111 placas */
const CON_PADRAO = { tipo: 'relief', condutores: 4, largura: 0.254, gap: 0.254, angulo: 90 };
const isNum = v => typeof v === 'number' && isFinite(v);
const r5 = v => Math.round(v * 1e5) / 1e5;

function gerber() {
  if (Gerber0) return Gerber0;
  if (root && root.HubGerber) return root.HubGerber;
  return null;
}

/* ============================== geometria em mm ============================== */
/* O passo angular do Altium ao achatar curva, medido no DSC-DI251883 (ArcResolution 0,2 mm): a
   folga de 0,254 em volta de trilha de 0,5 aparece a 0,2955 da borda = (0,25 + 0,254)/cos 22,5°
   - 0,25. Ou seja: os vertices caem em multiplos inteiros do passo (o quarto de volta dividido
   em k partes iguais), no raio r/cos(passo/2), e o lado reto que liga dois arcos fica tambem
   em r/cos(passo/2). O passo e o maior que deixa r/cos(passo/2) - r <= ArcResolution. */
function passoAng(r, tol) {
  if (!(r > 0)) return Math.PI / 2;
  const s = 2 * Math.acos(r / (r + Math.max(tol / 2, 1e-6)));
  return (Math.PI / 2) / Math.max(1, Math.ceil((Math.PI / 2) / s - 1e-9));
}
function passos(r, varre, tol) {
  return Math.max(1, Math.ceil(Math.abs(varre) / passoAng(r, tol) - 1e-6));
}
/* circulo (pad e via redondos): poligono CIRCUNSCRITO, lado (nao vertice) sobre os eixos -- o vazio
   do termico de via de 3 mm no DSC e o octogono de apotema r + gap com lados em x e y */
function circulo(cx, cy, r, tol) {
  const s = passoAng(r, tol), n = Math.round(2 * Math.PI / s);
  const R = r / Math.cos(s / 2), out = [];
  for (let i = 0; i < n; i++) { const a = s * (i + 0.5); out.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
  return out;
}
/* arco de a0 a a1 (rad) em volta de (cx, cy): vertices no raio r/cos(passo/2), nas pontas inclusive */
function arcoPts(cx, cy, r, a0, a1, tol, out) {
  const n = passos(r, a1 - a0, tol), s = (a1 - a0) / n, R = r / Math.cos(s / 2);
  for (let i = 0; i <= n; i++) { const a = a0 + s * i; out.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
  return out;
}
/* segmento grosso de pontas redondas (trilha) */
function capsula(x1, y1, x2, y2, r, tol) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
  if (L < 1e-9) return circulo(x1, y1, r, tol);
  const a = Math.atan2(dy, dx), out = [];
  arcoPts(x2, y2, r, a - Math.PI / 2, a + Math.PI / 2, tol, out);
  arcoPts(x1, y1, r, a + Math.PI / 2, a + 3 * Math.PI / 2, tol, out);
  return out;
}
/* retangulo w x h de cantos com raio rc, centrado na origem */
function retRedondo(w, h, rc, tol) {
  const hx = w / 2, hy = h / 2;
  rc = Math.max(0, Math.min(rc, hx, hy));
  if (rc < 1e-9) return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
  const out = [], P = Math.PI;
  arcoPts(hx - rc, -hy + rc, rc, -P / 2, 0, tol, out);
  arcoPts(hx - rc, hy - rc, rc, 0, P / 2, tol, out);
  arcoPts(-hx + rc, hy - rc, rc, P / 2, P, tol, out);
  arcoPts(-hx + rc, -hy + rc, rc, P, 3 * P / 2, tol, out);
  return out;
}
function gira(pts, ang, cx, cy) {
  const a = (ang || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map(p => [cx + p[0] * c - p[1] * s, cy + p[0] * s + p[1] * c]);
}

/* ---- Clipper ---- */
const paraC = pts => pts.map(p => ({ X: Math.round(p[0] * ESC), Y: Math.round(p[1] * ESC) }));
const deC = path => path.map(q => [r5(q.X / ESC), r5(q.Y / ESC)]);
/* caminho com orientacao positiva (o NonZero soma os obstaculos sem um cancelar o outro) */
function positivo(path) { if (C.Clipper.Area(path) < 0) path.reverse(); return path; }
function negativo(path) { if (C.Clipper.Area(path) > 0) path.reverse(); return path; }
function offset(paths, d, tol, quina) {
  if (!paths.length) return [];
  if (Math.abs(d) < 1e-9) return paths;
  const co = new C.ClipperOffset(2, Math.max(1, tol * ESC));
  co.AddPaths(paths, quina ? C.JoinType.jtMiter : C.JoinType.jtRound, C.EndType.etClosedPolygon);
  const out = new C.Paths();
  co.Execute(out, d * ESC);
  return out;
}
/* folga em volta de obstaculo como o Altium (passoAng): o lado reto vai junto com o vertice,
   a d/cos(passo/2) */
function offsetObst(paths, d, tol) {
  return offset(paths, d > 0 ? d / Math.cos(passoAng(d, tol) / 2) : d, tol);
}
function opera(tipo, sujeito, recorte, fillS, fillC) {
  const c = new C.Clipper();
  c.AddPaths(sujeito, C.PolyType.ptSubject, true);
  if (recorte && recorte.length) c.AddPaths(recorte, C.PolyType.ptClip, true);
  const out = new C.Paths();
  c.Execute(tipo, out, fillS || C.PolyFillType.pftNonZero, fillC || C.PolyFillType.pftNonZero);
  return out;
}
function arvore(paths) {
  const c = new C.Clipper();
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const t = new C.PolyTree();
  c.Execute(C.ClipType.ctUnion, t, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return C.JS.PolyTreeToExPolygons(t);
}
const areaC = paths => paths.reduce((s, p) => s + C.Clipper.Area(p), 0) / (ESC * ESC);
function caixaC(path) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const q of path) { if (q.X < x1) x1 = q.X; if (q.X > x2) x2 = q.X; if (q.Y < y1) y1 = q.Y; if (q.Y > y2) y2 = q.Y; }
  return { x1, y1, x2, y2 };
}
const cruza = (a, b) => a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
/* ponto dentro do conjunto (par-impar sobre todos os caminhos: contorno + furos) */
function dentro(paths, X, Y) {
  let n = 0;
  const pt = { X, Y };
  for (const p of paths) if (C.Clipper.PointInPolygon(pt, p) !== 0) n++;
  return n % 2 === 1;
}

/* ============================== a placa ============================== */
const RE_COBRE = /^(Top|Bottom|Mid\d+|Plane\d+)$/;
const ehTH = p => p.layer === 'Multi' || (!p.layer && p.type === 'th');

/* contorno da placa (segmentos line/arc do board.js) -> poligono em mm */
function contornoPlaca(bd, tol) {
  const segs = (bd && Array.isArray(bd.outline)) ? bd.outline.filter(Boolean) : [];
  const pts = [];
  const perto = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3;
  for (const s of segs) {
    if (s.kind === 'arc') {
      if (![s.cx, s.cy, s.r, s.sa, s.ea].every(isNum)) continue;
      let sa = s.sa * Math.PI / 180, ea = s.ea * Math.PI / 180;
      while (ea <= sa) ea += 2 * Math.PI;
      const ps = [s.cx + s.r * Math.cos(sa), s.cy + s.r * Math.sin(sa)];
      const pe = [s.cx + s.r * Math.cos(ea), s.cy + s.r * Math.sin(ea)];
      const ult = pts[pts.length - 1];
      const tmp = [];
      const n = passos(s.r, ea - sa, tol);
      for (let i = 0; i <= n; i++) { const a = sa + (ea - sa) * i / n; tmp.push([s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a)]); }
      if (ult && perto(ult, pe) && !perto(ult, ps)) tmp.reverse();
      for (const q of tmp) if (!perto(pts[pts.length - 1], q)) pts.push(q);
    } else {
      if (![s.x1, s.y1, s.x2, s.y2].every(isNum)) continue;
      const a = [s.x1, s.y1], b = [s.x2, s.y2], ult = pts[pts.length - 1];
      const par = (ult && perto(ult, b) && !perto(ult, a)) ? [b, a] : [a, b];
      for (const q of par) if (!perto(pts[pts.length - 1], q)) pts.push(q);
    }
  }
  while (pts.length > 2 && perto(pts[0], pts[pts.length - 1])) pts.pop();
  if (pts.length >= 3) return pts;
  const bb = bd && bd.bbox;
  if (bb && [bb.x1, bb.y1, bb.x2, bb.y2].every(isNum)) return [[bb.x1, bb.y1], [bb.x2, bb.y1], [bb.x2, bb.y2], [bb.x1, bb.y2]];
  return null;
}

/* forma do pad na camada (a do lado, como o hub-gerber.formaLado), em mm, crescida de e */
function formaPad(p, camada, e, tol) {
  let f = { shape: p.shape, w: p.w, h: p.h, radius: p.radius };
  if (camada === 'Bottom' && ehTH(p)) {
    const b = p.bot && typeof p.bot === 'object' ? p.bot : null;
    if (b) f = { shape: b.shape || p.shape, w: isNum(b.w) ? b.w : p.w, h: isNum(b.h) ? b.h : p.h, radius: isNum(b.radius) ? b.radius : p.radius };
  }
  if (!(f.w > 0) || !(f.h > 0)) return null;
  let cx = p.x, cy = p.y;
  if ((isNum(p.hox) && p.hox) || (isNum(p.hoy) && p.hoy)) {
    const q = gira([[p.hox || 0, p.hoy || 0]], p.rot || 0, 0, 0)[0];
    cx += q[0]; cy += q[1];
  }
  const shape = String(f.shape || 'rect').toLowerCase(), W = f.w, H = f.h;
  let loc;
  if (shape === 'circle' || shape === 'round' || shape === 'oval' || shape === 'oblong' || shape === 'obround') {
    if (Math.abs(W - H) < 1e-9) return circulo(cx, cy, W / 2 + e, tol);
    const L = Math.max(W, H), S = Math.min(W, H), hs = (L - S) / 2;
    loc = W >= H ? capsula(-hs, 0, hs, 0, S / 2 + e, tol) : capsula(0, -hs, 0, hs, S / 2 + e, tol);
  } else if (shape === 'roundrect') {
    const r0 = isNum(f.radius) ? f.radius : Math.min(W, H) / 8;
    loc = retRedondo(W + 2 * e, H + 2 * e, r0 + e, tol);
  } else if (shape === 'octagon' || shape === 'octagonal') {
    const c = Math.min(W, H) / 4, hx = W / 2, hy = H / 2;
    loc = [[-hx + c, -hy], [hx - c, -hy], [hx, -hy + c], [hx, hy - c], [hx - c, hy], [-hx + c, hy], [-hx, hy - c], [-hx, -hy + c]];
    if (e > 0) { const o = offsetObst([positivo(paraC(loc))], e, tol); return o.length ? deC(o[0]) : loc; }
  } else {
    loc = retRedondo(W + 2 * e, H + 2 * e, e, tol);
  }
  return gira(loc, p.rot || 0, cx, cy);
}
/* arco grosso (raio r em volta do centro do traco) */
function arcoGrosso(a, r, tol) {
  if (![a.cx, a.cy, a.r, a.sa, a.ea].every(isNum)) return [];
  let sa = a.sa * Math.PI / 180, ea = a.ea * Math.PI / 180;
  while (ea <= sa) ea += 2 * Math.PI;
  if (ea - sa >= 2 * Math.PI - 1e-9) {
    const out = [circulo(a.cx, a.cy, a.r + r, tol)];
    if (a.r - r > 1e-6) out.push(circulo(a.cx, a.cy, a.r - r, tol).reverse());
    return [out];                                         /* anel: um conjunto com furo */
  }
  if (a.r - r <= 1e-6) {
    /* raio menor que a largura: capsulas ao longo do arco */
    const n = passos(a.r, ea - sa, tol), res = [];
    for (let i = 0; i < n; i++) {
      const t0 = sa + (ea - sa) * i / n, t1 = sa + (ea - sa) * (i + 1) / n;
      res.push([capsula(a.cx + a.r * Math.cos(t0), a.cy + a.r * Math.sin(t0), a.cx + a.r * Math.cos(t1), a.cy + a.r * Math.sin(t1), r, tol)]);
    }
    return res;
  }
  const out = [];
  arcoPts(a.cx, a.cy, a.r + r, sa, ea, tol, out);
  const ex = a.cx + a.r * Math.cos(ea), ey = a.cy + a.r * Math.sin(ea);
  arcoPts(ex, ey, r, ea, ea + Math.PI, tol, out);
  const dentroArco = [];
  arcoPts(a.cx, a.cy, a.r - r, sa, ea, tol, dentroArco);
  /* o arco de dentro e inscrito: circunscrito ao contrario aproxima por fora do traco */
  const Ri = a.r - r;
  for (const q of dentroArco.reverse()) {
    const d = Math.hypot(q[0] - a.cx, q[1] - a.cy);
    const k = d > Ri ? (2 * Ri - d) / d : 1;
    out.push([a.cx + (q[0] - a.cx) * k, a.cy + (q[1] - a.cy) * k]);
  }
  const sx = a.cx + a.r * Math.cos(sa), sy = a.cy + a.r * Math.sin(sa);
  arcoPts(sx, sy, r, sa + Math.PI, sa + 2 * Math.PI, tol, out);
  return [[out]];
}
function retFill(f, e, tol) {
  const w = Math.abs(f.x2 - f.x1), h = Math.abs(f.y2 - f.y1);
  if (!(w > 0) || !(h > 0)) return null;
  return gira(retRedondo(w + 2 * e, h + 2 * e, e, tol), f.rot || 0, (f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2);
}
/* via: na camada se a camada esta entre from e to na pilha */
function viaNaCamada(v, camada, pilha) {
  const i = pilha.indexOf(camada);
  if (i < 0) return false;
  let a = pilha.indexOf(v.from || 'Top'), b = pilha.indexOf(v.to || 'Bottom');
  if (a < 0) a = 0;
  if (b < 0) b = pilha.length - 1;
  return i >= Math.min(a, b) && i <= Math.max(a, b);
}
function pilhaDe(eb) {
  const mids = new Set();
  for (const l of Array.isArray(eb.layers) ? eb.layers : []) if (l && /^Mid\d+$/.test(l.key || '')) mids.add(l.key);
  for (const k of ['tracks', 'arcs', 'regions', 'fills']) for (const o of eb[k] || []) if (o && /^Mid\d+$/.test(o.layer || '')) mids.add(o.layer);
  for (const p of eb.polygons || []) if (p && /^Mid\d+$/.test(p.layer || '')) mids.add(p.layer);
  return ['Top'].concat([...mids].sort((a, b) => parseInt(a.slice(3), 10) - parseInt(b.slice(3), 10)), ['Bottom']);
}

/* ============================== regras do poligono ============================== */
function folgaDe(pol, tipo, net) {
  const cn = pol.clearanceNet && net ? pol.clearanceNet[net] : null;
  if (cn) { if (isNum(cn[tipo])) return cn[tipo]; if (isNum(cn['*'])) return cn['*']; }
  if (pol.clearanceTipo && isNum(pol.clearanceTipo[tipo])) return pol.clearanceTipo[tipo];
  if (isNum(pol.clearance)) return pol.clearance;
  return CLEAR_PADRAO;
}
function conexaoDe(pol, obj, ehVia, ehSmd) {
  const o = (pol.conexaoObj && obj && obj.id && pol.conexaoObj[obj.id]) ||
            (ehVia && pol.conexaoVia) || (ehSmd && pol.conexaoSmd) || pol.conexao || CON_PADRAO;
  return {
    tipo: o.tipo === 'direct' || o.tipo === 'none' ? o.tipo : 'relief',
    condutores: o.condutores === 2 ? 2 : 4,
    largura: isNum(o.largura) && o.largura > 0 ? o.largura : CON_PADRAO.largura,
    gap: isNum(o.gap) && o.gap >= 0 ? o.gap : CON_PADRAO.gap,
    angulo: o.angulo === 45 ? 45 : 90,
  };
}

/* ============================== assinatura ============================== */
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
function caixaPts(pts) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) { if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0]; if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1]; }
  return { x1, y1, x2, y2 };
}
function folgaMax(pol) {
  let m = isNum(pol.clearance) ? pol.clearance : CLEAR_PADRAO;
  for (const v of Object.values(pol.clearanceTipo || {})) if (isNum(v)) m = Math.max(m, v);
  for (const d of Object.values(pol.clearanceNet || {})) for (const v of Object.values(d || {})) if (isNum(v)) m = Math.max(m, v);
  const cs = [pol.conexao, pol.conexaoVia, pol.conexaoSmd].concat(Object.values(pol.conexaoObj || {}));
  for (const c of cs) if (c) m = Math.max(m, (c.gap || 0) + (c.largura || 0));
  return m + 1;
}
/* tudo o que pode mudar o despejo de `pol`, em texto estavel: o proprio poligono (sem hash), o
   contorno da placa, os recortes, e os objetos de cobre da camada que tocam a caixa do poligono
   crescida da maior folga. Os poligonos de ordem menor entram pela definicao (o cobre deles
   depende das mesmas coisas). */
function assinatura(eb, pol) {
  const B = eb || {}, P = pol || {};
  const pts = Array.isArray(P.pts) ? P.pts : [];
  if (pts.length < 3) return fnv('vazio');
  const bb = caixaPts(pts), m = folgaMax(P);
  const cx = { x1: bb.x1 - m, y1: bb.y1 - m, x2: bb.x2 + m, y2: bb.y2 + m };
  const L = P.layer, partes = [];
  const def = {}; for (const k of Object.keys(P).sort()) if (k !== 'hash' && k !== 'despejo') def[k] = P[k];
  partes.push(JSON.stringify(def));
  partes.push(JSON.stringify((B.board && B.board.outline) || []));
  partes.push(JSON.stringify(B.cutouts || []));
  const toca = (x1, y1, x2, y2) => x1 <= cx.x2 && cx.x1 <= x2 && y1 <= cx.y2 && cx.y1 <= y2;
  const naCam = o => o && (o.layer === L || o.layer === 'KeepOut' || o.layer === 'Multi');
  for (const t of B.tracks || []) if (naCam(t) && toca(Math.min(t.x1, t.x2) - t.w, Math.min(t.y1, t.y2) - t.w, Math.max(t.x1, t.x2) + t.w, Math.max(t.y1, t.y2) + t.w)) partes.push('t' + JSON.stringify(t));
  for (const a of B.arcs || []) if (naCam(a) && toca(a.cx - a.r - a.w, a.cy - a.r - a.w, a.cx + a.r + a.w, a.cy + a.r + a.w)) partes.push('a' + JSON.stringify(a));
  for (const v of B.vias || []) if (v && toca(v.x - v.size, v.y - v.size, v.x + v.size, v.y + v.size)) partes.push('v' + JSON.stringify(v));
  const pad = p => { const r = Math.max(p.w || 0, p.h || 0) + Math.hypot(p.hox || 0, p.hoy || 0); return toca(p.x - r, p.y - r, p.x + r, p.y + r); };
  for (const c of B.components || []) for (const p of (c && c.pads) || []) if (p && pad(p)) partes.push('p' + JSON.stringify(p));
  for (const p of B.freepads || []) if (p && pad(p)) partes.push('p' + JSON.stringify(p));
  for (const f of B.fills || []) if (naCam(f) && toca(Math.min(f.x1, f.x2) - 1, Math.min(f.y1, f.y2) - 1, Math.max(f.x1, f.x2) + 1, Math.max(f.y1, f.y2) + 1)) partes.push('f' + JSON.stringify(f));
  for (const g of B.regions || []) if (naCam(g) && !g.poly && Array.isArray(g.points)) { const b = caixaPts(g.points); if (toca(b.x1, b.y1, b.x2, b.y2)) partes.push('g' + JSON.stringify(g)); }
  for (const t of B.texts || []) if (t && t.layer === L && isNum(t.x) && isNum(t.y)) { const r = (t.h || 1) * Math.max(1, String(t.text || '').length); if (toca(t.x - r, t.y - r, t.x + r, t.y + r)) partes.push('x' + JSON.stringify(t)); }
  for (const q of B.polygons || []) if (q && q !== pol && q.id !== P.id && q.layer === L && ordemDe(q) < ordemDe(P)) {
    const d = {}; for (const k of Object.keys(q).sort()) if (k !== 'hash' && k !== 'despejo') d[k] = q[k];
    partes.push('P' + JSON.stringify(d));
  }
  return fnv(partes.join('\n'));
}
function desatualizado(eb, pol) {
  return !pol || typeof pol.hash !== 'string' || pol.hash !== assinatura(eb, pol);
}
const ordemDe = p => (p && isNum(p.ordem) && p.ordem >= 0) ? p.ordem : 1e9;

/* ============================== o despejo ============================== */
function despeja(eb, pol, opcoes) {
  const t0 = Date.now();
  const B = eb || {}, P = pol || {};
  let op = opcoes || {};
  /* sem as anteriores: despeja antes os poligonos de ordem menor de eb.polygons (na mesma camada) */
  if (!Array.isArray(op.anteriores) && Array.isArray(B.polygons)) {
    const antes = B.polygons.filter(q => q && q !== pol && q.id !== P.id && q.layer === P.layer && ordemDe(q) < ordemDe(P));
    const r = antes.length ? despejaTodos(Object.assign({}, B, { polygons: antes }), Object.assign({}, op, { anteriores: undefined })) : null;
    op = Object.assign({}, op, { anteriores: r ? r.regioes : [] });
  }
  const avisos = [];
  const fim = (regioes, area) => ({ regioes, avisos, ms: Date.now() - t0, hash: assinatura(B, P), area: r5(area || 0) });
  if (P.pour === 'none') return fim([]);
  const L = P.layer, net = typeof P.net === 'string' ? P.net : '';
  if (!Array.isArray(P.pts) || P.pts.length < 3) { avisos.push(`polígono ${P.id || ''}: contorno com menos de 3 vértices`); return fim([]); }
  if (P.pour === 'hatch') avisos.push(`polígono ${P.id || ''}: hachurado sai sólido (o hub ainda não hachura)`);
  const cobre = RE_COBRE.test(L || '');
  const tol = isNum(P.arco) && P.arco > 0 ? P.arco : ARCO_PADRAO;
  const pourOver = P.pourOver === 'none' || P.pourOver === 'polygons' ? P.pourOver : 'all';

  /* 1. a area: contorno do poligono dentro da placa (menos a folga da borda) */
  let area = [positivo(paraC(P.pts))];
  const folgaBorda = isNum(P.clearanceBorda) ? P.clearanceBorda : 0;
  const placa = contornoPlaca(B.board, tol);
  let pc = null;
  if (placa) {
    pc = [positivo(paraC(placa))];
    if (folgaBorda > 0) pc = offset(pc, -folgaBorda, tol);
    area = opera(C.ClipType.ctIntersection, area, pc);
  }
  const bbA = area.length ? area.map(caixaC).reduce((a, b) => ({ x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) })) : null;
  if (!bbA) return fim([]);
  const margem = folgaMax(P) * ESC;
  const caixaPol = { x1: bbA.x1 - margem, y1: bbA.y1 - margem, x2: bbA.x2 + margem, y2: bbA.y2 + margem };
  const ok = pts => pts && pts.length >= 3 && cruza(caixaC(pts.__c || (pts.__c = paraC(pts))), caixaPol);
  const emC = pts => pts.__c || paraC(pts);

  /* 2. obstaculos: furos duros (recortes), outra net (com a folga), mesma net (relief) */
  /* duros: recorte e keepout; outros: cobre de outra net; mesmos: cobre da mesma net que nao leva
     cobre por cima (pourOver); vazios: o vazio do termico. O raio do termico so e barrado por
     duros e outros (no DSC ele passa por cima da trilha da mesma net dentro do vazio) */
  const duros = [], outros = [], mesmos = [], vazios = [], conectores = [], termicos = [];
  const pilha = pilhaDe(B);
  /* recortes da placa (a regra do HubLaser.boardCutouts: o do tamanho da placa nao e furo) e
     recortes de poligono (kindn 1, so na camada dele) */
  const bbp = B.board && B.board.bbox;
  for (const k of Array.isArray(B.cutouts) ? B.cutouts : []) {
    if (!k || !Array.isArray(k.points) || k.points.length < 3 || k.kindn === -1) continue;
    const pts = k.points.map(q => [q[0], q[1]]);
    if (k.kindn === 1 || (!isNum(k.kindn) && RE_COBRE.test(k.layer || ''))) {
      if (k.layer === L || k.layer === 'Multi' || !k.layer) duros.push(positivo(paraC(pts)));
      continue;
    }
    const b = caixaPts(pts);
    if (bbp && b.x1 <= bbp.x1 + 1e-3 && b.x2 >= bbp.x2 - 1e-3 && b.y1 <= bbp.y1 + 1e-3 && b.y2 >= bbp.y2 - 1e-3) continue;
    for (const q of offsetObst([positivo(paraC(pts))], folgaBorda, tol)) duros.push(q);
  }
  /* keepout: objeto com keepout:true na camada do poligono ou na KeepOut */
  const keep = o => o && o.keepout === true && (o.layer === L || o.layer === 'KeepOut');
  const daNet = o => cobre && net !== '' && typeof o.net === 'string' && o.net === net;
  const poe = (lista, pts) => { if (ok(pts)) lista.push(positivo(emC(pts))); };
  const poeConj = (lista, conj) => { for (const c of conj) { if (!c.length || !ok(c[0])) continue; lista.push(positivo(emC(c[0]))); for (let i = 1; i < c.length; i++) lista.push(negativo(emC(c[i]))); } };

  if (cobre) {
  /* trilha/arco da mesma net: no 'all' o cobre passa por cima. Fora dele o que manda e a conexao
     do poligono: direct = por cima (MTBP-DI231703, trilha que entra na faixa de 1 mm da borda
     e o Altium nao parte a faixa); relief = obstaculo a gap do termico (DSC-DI251883: 0,254) */
  const conP = conexaoDe(P, null, false, false);
  const porCima = pourOver === 'all' || conP.tipo === 'direct';
  const gapMesma = conP.tipo === 'relief' ? conP.gap : folgaDe(P, 'track', '');
  /* trilhas e arcos */
  for (const t of B.tracks || []) {
    if (!t || ![t.x1, t.y1, t.x2, t.y2, t.w].every(isNum)) continue;
    if (keep(t)) { poe(duros, capsula(t.x1, t.y1, t.x2, t.y2, t.w / 2 + folgaDe(P, 'track', ''), tol)); continue; }
    if (t.layer !== L || t.keepout) continue;
    if (daNet(t)) {
      if (porCima) poe(conectores, capsula(t.x1, t.y1, t.x2, t.y2, t.w / 2, tol));
      else poe(mesmos, capsula(t.x1, t.y1, t.x2, t.y2, t.w / 2 + gapMesma, tol));
      continue;
    }
    poe(outros, capsula(t.x1, t.y1, t.x2, t.y2, t.w / 2 + folgaDe(P, 'track', t.net), tol));
  }
  for (const a of B.arcs || []) {
    if (!a || !isNum(a.w)) continue;
    if (keep(a)) { poeConj(duros, arcoGrosso(a, a.w / 2 + folgaDe(P, 'arc', ''), tol)); continue; }
    if (a.layer !== L || a.keepout) continue;
    if (daNet(a)) {
      if (porCima) poeConj(conectores, arcoGrosso(a, a.w / 2, tol));
      else poeConj(mesmos, arcoGrosso(a, a.w / 2 + gapMesma, tol));
      continue;
    }
    poeConj(outros, arcoGrosso(a, a.w / 2 + folgaDe(P, 'arc', a.net), tol));
  }
  /* pads e vias: outra net = folga; mesma net = conexao (direct, relief ou none) */
  const pad = (p, ehVia) => {
    let forma = null;
    const ehSmd = !ehVia && !ehTH(p);
    if (ehVia) {
      if (!cobre || !viaNaCamada(p, L, pilha) || !(p.size > 0)) return;
    } else if (!(ehTH(p) ? cobre : p.layer === L)) return;
    const tipo = ehVia ? 'via' : (ehSmd ? 'smd' : 'th');
    const r0 = ehVia ? p.size / 2 : null;
    const forma0 = e => ehVia ? circulo(p.x, p.y, r0 + e, tol) : formaPad(p, L, e, tol);
    if (!daNet(p)) { forma = forma0(folgaDe(P, tipo, p.net)); if (forma) poe(outros, forma); return; }
    const con = conexaoDe(P, p, ehVia, ehSmd);
    const base = forma0(0);
    if (!base) return;
    if (con.tipo === 'direct') { poe(conectores, base); return; }
    if (con.tipo === 'none') { forma = forma0(folgaDe(P, tipo, '')); if (forma) poe(mesmos, forma); return; }
    const vazio = forma0(con.gap);
    if (!ok(vazio)) return;
    const vazioC = positivo(emC(vazio));
    vazios.push(vazioC);
    conectores.push(positivo(paraC(base)));
    termicos.push({ p, base, con, vazioC, cx: ehVia ? p.x : null, cy: ehVia ? p.y : null, rot: ehVia ? 0 : (p.rot || 0) });
  };
  for (const c of B.components || []) for (const p of (c && c.pads) || []) if (p && [p.x, p.y].every(isNum)) pad(p, false);
  for (const p of B.freepads || []) if (p && [p.x, p.y].every(isNum)) pad(p, false);
  for (const v of B.vias || []) if (v && [v.x, v.y].every(isNum)) pad(v, true);
  /* fills e regioes */
  for (const f of B.fills || []) {
    if (!f || ![f.x1, f.y1, f.x2, f.y2].every(isNum)) continue;
    if (keep(f)) { const q = retFill(f, folgaDe(P, 'fill', ''), tol); if (q) poe(duros, q); continue; }
    if (f.layer !== L || f.keepout) continue;
    if (daNet(f) && pourOver === 'all') { const q = retFill(f, 0, tol); if (q) poe(conectores, q); continue; }
    const q = retFill(f, folgaDe(P, 'fill', daNet(f) ? '' : f.net), tol);
    if (q) poe(daNet(f) ? mesmos : outros, q);
  }
  const regiaoC = g => { const o = [positivo(paraC(g.points))]; for (const h of Array.isArray(g.holes) ? g.holes : []) if (Array.isArray(h) && h.length >= 3) o.push(negativo(paraC(h))); return o; };
  for (const g of B.regions || []) {
    if (!g || g.poly || !Array.isArray(g.points) || g.points.length < 3) continue;
    const kp = keep(g);
    if (!kp && (g.layer !== L || g.keepout)) continue;
    if (!cruza(caixaC(paraC(g.points)), caixaPol)) continue;
    if (!kp && daNet(g) && pourOver === 'all') { for (const q of regiaoC(g)) conectores.push(q); continue; }
    const d = folgaDe(P, 'region', kp || daNet(g) ? '' : g.net);
    for (const q of offsetObst(regiaoC(g), d, tol)) (kp ? duros : daNet(g) ? mesmos : outros).push(q);
  }
  /* textos de cobre (sem net no Altium: sempre obstaculo) */
  if (cobre) {
    const G = typeof op.texto === 'function' ? { geometriaTexto: op.texto } : gerber();
    for (const t of B.texts || []) {
      if (!t || t.layer !== L || t.hidden || !isNum(t.x) || !isNum(t.y)) continue;
      const d = folgaDe(P, 'text', '');
      let geo = null;
      try { geo = G && G.geometriaTexto ? G.geometriaTexto(t) : null; } catch (e) { geo = null; }
      if (geo && Array.isArray(geo.regioes)) {
        const ps = geo.regioes.map(r => r.hole ? negativo(paraC(r.pts)) : positivo(paraC(r.pts)));
        for (const q of offsetObst(ps, d, tol)) outros.push(q);
      } else if (geo && Array.isArray(geo.tracos)) {
        const w = isNum(geo.w) ? geo.w : (t.w || t.h * 0.15);
        for (const s of geo.tracos) for (let i = 1; i < s.length; i++) poe(outros, capsula(s[i - 1][0], s[i - 1][1], s[i][0], s[i][1], w / 2 + d, tol));
      } else {
        const n = String(t.text || '').length, h = t.h || 1;
        poe(outros, gira(retRedondo(n * h * 0.8 + 2 * d, h + 2 * d, d, tol), t.rot || 0, t.x, t.y));
        if (!G) avisos.push('texto de cobre pela caixa (sem o hub-gerber carregado)');
      }
    }
  }
  /* poligonos de ordem menor ja despejados */
  for (const r of op.anteriores || []) {
    if (!r || r.layer !== L || !Array.isArray(r.pts) || r.pts.length < 3) continue;
    const mesma = net !== '' && r.net === net;
    if (mesma && pourOver !== 'none') continue;
    const conj = [positivo(paraC(r.pts))].concat((r.holes || []).filter(h => h && h.length >= 3).map(h => negativo(paraC(h))));
    if (!cruza(caixaC(conj[0]), caixaPol)) continue;
    for (const q of offsetObst(conj, folgaDe(P, 'poly', mesma ? '' : r.net), tol)) (mesma ? mesmos : outros).push(q);
  }
  } /* fim do if (cobre): poligono em camada que nao e de cobre (o disco do encoder na TopOverlay,
       PGP/PEEV Disco 2048) so respeita contorno e recortes -- o Altium despeja por cima das
       2.056 regioes de serigrafia da mesma camada */

  /* 3. o cobre: area - duros - outros. A base (sem os vazios dos termicos) e onde o raio pode ir */
  const semDuros = duros.length ? opera(C.ClipType.ctDifference, area, duros) : area;
  let cu = opera(C.ClipType.ctDifference, semDuros, outros.concat(mesmos, vazios));
  /* 4. pescocos: abertura por neck/2 (o que e mais estreito que neck some). A abertura pura
     arredondaria os cantos vivos do cobre; crescida de mais neck/2 e cortada pelo cobre de antes,
     o canto volta e o pescoco nao (ele so cresce neck/2 de cada ponta) */
  if (P.removeNecks && isNum(P.neck) && P.neck > 0) {
    /* em quina (jtMiter): o arredondado multiplicava os vertices e custava 4 s numa placa densa */
    /* a mascara sai de uma copia simplificada (vertice a menos de neck/4 do vizinho cai) -- 1,2 s
       viraram 0,5 s numa placa densa; o par-impar refaz a orientacao que a limpeza pode trocar */
    const leve = C.Clipper.SimplifyPolygons(C.Clipper.CleanPolygons(cu, Math.max(tol, P.neck / 4) * ESC), C.PolyFillType.pftEvenOdd);
    const ab = offset(offset(leve, -P.neck / 2, tol, true), P.neck, tol, true);
    cu = opera(C.ClipType.ctIntersection, cu, ab);
  }
  /* 5. raios termicos: retangulo do CENTRO do pad (o Altium grava o raio por cima do pad, ate o
     centro: DSC, PCB-DI231744) ate passar do vazio, e so se a ponta cai no cobre (o Altium nao
     poe raio que nao chega a lugar nenhum). Direcoes: 0/90/180/270 (ou 45/135/...) + rot do pad */
  if (termicos.length) {
    const raios = [];
    for (const T of termicos) {
      const { base, con } = T;
      const cx = isNum(T.cx) ? T.cx : centro(base)[0], cy = isNum(T.cy) ? T.cy : centro(base)[1];
      const ang0 = (con.angulo === 45 ? 45 : 0) + (T.rot || 0);
      const dirs = con.condutores === 2 ? [0, 180] : [0, 90, 180, 270];
      for (const d0 of dirs) {
        const a = (ang0 + d0) * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
        let alc = 0;
        for (const q of base) alc = Math.max(alc, (q[0] - cx) * ux + (q[1] - cy) * uy);
        const ponta = alc + con.gap + Math.max(con.largura / 2, 0.02);
        if (!dentro(cu, Math.round((cx + ux * ponta) * ESC), Math.round((cy + uy * ponta) * ESC))) continue;
        const L2 = alc + con.gap + con.largura, h = con.largura / 2;
        raios.push(positivo(paraC([[cx - uy * h, cy + ux * h], [cx - uy * h + ux * L2, cy + ux * h + uy * L2],
                                    [cx + uy * h + ux * L2, cy - ux * h + uy * L2], [cx + uy * h, cy - ux * h]])));
      }
    }
    if (raios.length) {
      /* o raio nao atravessa obstaculo de outra net nem recorte (os vazios de termico e o cobre da
         mesma net nao o barram: no DSC o raio passa por cima da trilha GND dentro do vazio) */
      /* o raio pode sair do contorno do poligono so dentro do vazio do proprio termico (pad na
         borda: PCB-DI231744); alem do vazio, nao (PBLS-DI221677) -- e nunca sai da placa */
      let base = opera(C.ClipType.ctUnion, area, vazios);
      if (pc) base = opera(C.ClipType.ctIntersection, base, pc);
      const alvo = opera(C.ClipType.ctDifference, base, duros.concat(outros));
      const rc = opera(C.ClipType.ctIntersection, raios, alvo);
      cu = opera(C.ClipType.ctUnion, cu, rc);
    }
  }
  /* 6. ilhas: area minima e cobre morto */
  let ilhas = arvore(cu);
  const minA = isNum(P.minArea) ? P.minArea : 0;
  const conC = conectores.map(q => ({ q, b: caixaC(q) }));
  const vivo = ex => {
    const b = caixaC(ex.outer);
    const cand = conC.filter(o => cruza(o.b, b)).map(o => o.q);
    if (!cand.length) return false;
    const toque = offset(cand, 0.002, tol);
    const i = opera(C.ClipType.ctIntersection, [ex.outer].concat(ex.holes), toque, C.PolyFillType.pftEvenOdd);
    return Math.abs(areaC(i)) > 1e-8;
  };
  const regioes = [];
  let total = 0;
  for (const ex of ilhas) {
    const a = Math.abs(C.Clipper.Area(ex.outer)) / (ESC * ESC) - ex.holes.reduce((s, h) => s + Math.abs(C.Clipper.Area(h)), 0) / (ESC * ESC);
    if (minA > 0 && a < minA) continue;
    if (P.removeDead && cobre && !vivo(ex)) continue;
    const pts = deC(ex.outer), holes = ex.holes.map(deC);
    regioes.push({ layer: L, net: cobre ? net : '', pts, holes, poly: true, de: P.id });
    total += a;
  }
  return fim(regioes, total);
}
function centro(pts) {
  let x = 0, y = 0;
  for (const q of pts) { x += q[0]; y += q[1]; }
  return [x / pts.length, y / pts.length];
}
function despejaTodos(eb, opcoes) {
  const t0 = Date.now();
  const B = eb || {}, op = opcoes || {};
  const lista = (Array.isArray(B.polygons) ? B.polygons : []).filter(Boolean)
    .map((p, i) => ({ p, i })).sort((a, b) => (ordemDe(a.p) - ordemDe(b.p)) || (a.i - b.i)).map(x => x.p);
  const feitos = [], porPoligono = {}, avisos = [];
  for (const p of lista) {
    const r = despeja(B, p, Object.assign({}, op, { anteriores: feitos.slice() }));
    porPoligono[p.id] = r;
    for (const g of r.regioes) feitos.push(g);
    for (const a of r.avisos) avisos.push(a);
  }
  return { regioes: feitos, porPoligono, avisos, ms: Date.now() - t0 };
}

/* a placa que vai para o Gerber/tela: as regions poly:true do espelho (o despejo velho do
   Altium) saem e as do hub entram no lugar */
function placaSemDespejoVelho(eb, regioes) {
  const out = Object.assign({}, eb);
  const novas = (regioes || []).map((g, i) => {
    const o = { id: 'q' + (i + 1), layer: g.layer, net: g.net, points: g.pts, poly: true, de: g.de };
    if (g.holes && g.holes.length) o.holes = g.holes;
    return o;
  });
  out.regions = (eb.regions || []).filter(g => !(g && g.poly)).concat(novas);
  return out;
}

return { despeja, despejaTodos, assinatura, desatualizado, placaSemDespejoVelho,
         _int: { contornoPlaca, formaPad, arcoGrosso, capsula, circulo, ESC } };
});
