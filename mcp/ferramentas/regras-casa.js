/* NexoEletric MCP - grupo "casa": as skills da casa (mcp/skills/*.md) e o verificador delas.
     skills_listar / skill_ler    as regras de projeto da Dieletrons, para a IA seguir
     regras_casa_verificar        confere a placa EFETIVA (board.js + changes.js, com os planos
                                  redespejados pelo hub-pcbpour.js) contra as regras:
       pad_outra_net    cobre de outra net em cima de pad/via (curto) ou a menos da Clearance
                        do projeto -- pad passante conta em todas as camadas de cobre
       trilha_sobre_pad trilha da mesma net cruzando o pad sem terminar nele; regiao/faixa
                        tapando o pad e o alivio termico do plano
       parafuso    nenhum cobre (plano, trilha, via, pad, fill, regiao) no quadrado em volta de
                   cada furo de parafuso, em todas as camadas de cobre
       plano_pad   cobre de plano despejado a menos de `folga_plano_pad` de pad de outra net
       serigrafia  overlay encostando em pad/via (+ mascara), furo/recorte, quadrado de parafuso,
                   cobre do mesmo lado, outra serigrafia ou saindo da placa
       texto_tamanho  texto de serigrafia abaixo da altura/traco minimos (1,0 / 0,15 mm)
   A geometria e a do Clipper do hub (hub-clipper.js), em 0,1 um, a mesma do pour e do Gerber.

   REGRAS POR PROJETO (1.37.0): Projects/<p>/regras-casa.json muda os numeros, desliga regras e
   vale por area da placa (o backplane que libera serigrafia sobre trilha, o conector com texto de
   0,6 mm). Precedencia: padrao da casa < arquivo do projeto < area < o que a chamada passa.
     { "format":"regras-casa-v1",
       "parametros":{"silk_cobre":0.1,"texto_h_min":0.8,...},
       "desligar":["serigrafia_trilha", ...],      regra inteira ou sub-regra (SUBREGRAS)
       "areas":[{"nome":"...","caixa":{"x1","y1","x2","y2"},"camada"?:"TopOverlay",
                 "parametros":{...},"desligar":[...]}] }
   A cena da serigrafia (cenaSerigrafia + checaSerigrafia) e a MESMA para o verificador, o
   serigrafia_checar e o serigrafia_posicionar (mcp/ferramentas/serigrafia.js). */
'use strict';
const fs = require('node:fs');
const { ErroMcp } = require('../lib/contexto.js');
const geo = require('../lib/geometria.js');
const skills = require('../lib/skills.js');
const { PROJETO } = require('../lib/util.js');

const E = 1e4;                                  // unidades do Clipper por mm
const isNum = v => typeof v === 'number' && isFinite(v);
const r3 = v => Math.round(v * 1000) / 1000;
const PAD = { parafuso: 3.0, plano_pad: 1.0, silk: 0.254, silk_cobre: 0.1, silk_borda: 0.3, furo_min: 2.5, texto_h_min: 1.0, texto_w_min: 0.15 };
const PARAMS = Object.keys(PAD);
const REGRAS = ['pad_outra_net', 'trilha_sobre_pad', 'parafuso', 'plano_pad', 'serigrafia'];
/* as partes da regra "serigrafia", para desligar uma so (por projeto ou por area) */
const SUBREGRAS = ['serigrafia_pad', 'serigrafia_trilha', 'serigrafia_furo', 'serigrafia_parafuso', 'serigrafia_borda', 'serigrafia_silk', 'texto_tamanho'];
const ARQ_CFG = 'regras-casa.json';

/* ---------- as regras da casa do projeto (regras-casa.json) ---------- */
function lerConfig(p) {
  const f = p.arq(ARQ_CFG);
  if (!fs.existsSync(f)) return { format: 'regras-casa-v1', parametros: {}, desligar: [], areas: [], existe: false };
  let c;
  try { c = JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { throw new ErroMcp(`${ARQ_CFG} do projeto "${p.nome}" não é JSON válido: ${e.message}`); }
  return normalizaConfig(c, true);
}
/* confere e limpa: parametro desconhecido ou regra que nao existe e erro (nao some calado) */
function normalizaConfig(c, existe) {
  c = c || {};
  const erro = m => { throw new ErroMcp(`regras da casa: ${m}`); };
  const prm = o => {
    const out = {};
    for (const [k, v] of Object.entries(o || {})) {
      if (!PARAMS.includes(k)) erro(`parâmetro "${k}" não existe (${PARAMS.join(', ')})`);
      if (!isNum(v) || v < 0) erro(`parâmetro "${k}" deve ser número >= 0 (mm)`);
      out[k] = v;
    }
    return out;
  };
  const des = L => {
    if (L == null) return [];
    if (!Array.isArray(L)) erro('"desligar" deve ser uma lista');
    for (const r of L) if (!REGRAS.includes(r) && !SUBREGRAS.includes(r)) erro(`"${r}" não é regra (${REGRAS.concat(SUBREGRAS).join(', ')})`);
    return [...new Set(L)];
  };
  const areas = (c.areas || []).map((ar, i) => {
    const q = ar && ar.caixa;
    if (!q || ![q.x1, q.y1, q.x2, q.y2].every(isNum)) erro(`área ${i + 1}: "caixa" {x1,y1,x2,y2} em mm`);
    if (ar.camada != null && typeof ar.camada !== 'string') erro(`área ${i + 1}: "camada" deve ser texto`);
    return { nome: String(ar.nome || 'área ' + (i + 1)),
             caixa: { x1: Math.min(q.x1, q.x2), y1: Math.min(q.y1, q.y2), x2: Math.max(q.x1, q.x2), y2: Math.max(q.y1, q.y2) },
             camada: ar.camada || undefined, parametros: prm(ar.parametros), desligar: des(ar.desligar) };
  });
  return { format: 'regras-casa-v1', parametros: prm(c.parametros), desligar: des(c.desligar), areas, existe: !!existe };
}
/* o que vale num ponto: os parametros (padrao < projeto < area < chamada) e o que esta desligado */
function regrasEm(cfg, base, chamada, x, y, layer) {
  const o = Object.assign({}, base, cfg.parametros);
  const desl = new Set(cfg.desligar);
  for (const ar of cfg.areas) {
    const q = ar.caixa;
    if (!(isNum(x) && isNum(y) && x >= q.x1 && x <= q.x2 && y >= q.y1 && y <= q.y2)) continue;
    if (ar.camada && layer && ar.camada !== layer) continue;
    Object.assign(o, ar.parametros);
    for (const r of ar.desligar) desl.add(r);
  }
  Object.assign(o, chamada || {});
  return { o, desl };
}

function textoGeo(ctx) {
  const G = ctx.modulo('hub-gerber.js');
  return G && G.geometriaTexto ? (t => { if (!t || t.hidden) return null; try { return G.geometriaTexto(t); } catch (_) { return null; } }) : null;
}
function circulo(cx, cy, r, n) { const P = [], k = n || 24; for (let i = 0; i < k; i++) { const a = i * 2 * Math.PI / k; P.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return P; }
function caixaPts(pts) { const b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }; for (const [x, y] of pts) { if (x < b.x1) b.x1 = x; if (x > b.x2) b.x2 = x; if (y < b.y1) b.y1 = y; if (y > b.y2) b.y2 = y; } return b; }
const cruza = (a, b, m) => a.x1 - m <= b.x2 && b.x1 - m <= a.x2 && a.y1 - m <= b.y2 && b.y1 - m <= a.y2;
function dentroPoly(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function dPS(px, py, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
  let t = L ? ((px - a[0]) * vx + (py - a[1]) * vy) / L : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + t * vx - px, a[1] + t * vy - py);
}
/* grade de vizinhança por caixa (mm) para nao comparar tudo com tudo */
function grade(lista, passo) {
  const G = new Map(), C = passo || 2;
  for (const o of lista) for (let gx = Math.floor(o.bb.x1 / C); gx <= Math.floor(o.bb.x2 / C); gx++) for (let gy = Math.floor(o.bb.y1 / C); gy <= Math.floor(o.bb.y2 / C); gy++) {
    const k = gx + ',' + gy; let l = G.get(k); if (!l) G.set(k, l = []); l.push(o);
  }
  return { G, C };
}
function vizinhos(g, bb, m) {
  const s = new Set();
  for (let gx = Math.floor((bb.x1 - m) / g.C); gx <= Math.floor((bb.x2 + m) / g.C); gx++) for (let gy = Math.floor((bb.y1 - m) / g.C); gy <= Math.floor((bb.y2 + m) / g.C); gy++) {
    const l = g.G.get(gx + ',' + gy); if (l) for (const o of l) s.add(o);
  }
  return [...s];
}
/* a folga da regra Clearance geral (All × All) do projeto, senao 0,254 mm (10 mil) */
function folgaDoProjeto(ctx, p) {
  try {
    const R = ctx.modulo('hub-pcbregras.js'), f = p.arq('rules.js');
    if (R && fs.existsSync(f)) {
      const c = R.ler(fs.readFileSync(f, 'utf8'));
      const L = (c.rules || c.regras || []).filter(r => (r.kind || r.tipo) === 'Clearance' && r.enabled !== false && isNum(r.gap) &&
        /^all$/i.test(String(r.scope1 || 'All').trim()) && /^all$/i.test(String(r.scope2 || 'All').trim()));
      if (L.length) return Math.min(...L.map(r => r.gap));
    }
  } catch (_) { /* sem regras legiveis: o padrao */ }
  return 0.254;
}
const nomeOb = ob => ob.tipo === 'pad' ? `pad ${ob.ref ? ob.ref + '.' + ob.nome : (ob.nome || ob.id)}` : `${ob.tipo} ${ob.id}`;
const netDe = ob => ob.net ? ob.net : 'sem net';
const uniao = (a, b) => ({ x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) });

function kit(C) {
  const paraC = pts => pts.map(p => ({ X: Math.round(p[0] * E), Y: Math.round(p[1] * E) }));
  const offset = (paths, d, aberto) => {
    const co = new C.ClipperOffset(2, 0.005 * E);
    co.AddPaths(paths, C.JoinType.jtRound, aberto ? C.EndType.etOpenRound : C.EndType.etClosedPolygon);
    const out = new C.Paths(); co.Execute(out, d * E); return out;
  };
  const inter = (suj, clip, eo) => {
    const c = new C.Clipper();
    c.AddPaths(suj, C.PolyType.ptSubject, true); c.AddPaths(clip, C.PolyType.ptClip, true);
    const out = new C.Paths();
    c.Execute(C.ClipType.ctIntersection, out, eo ? C.PolyFillType.pftEvenOdd : C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
    return out;
  };
  const uniaoC = paths => { const c = new C.Clipper(); c.AddPaths(paths, C.PolyType.ptSubject, true); const out = new C.Paths(); c.Execute(C.ClipType.ctUnion, out, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero); return out; };
  const area = paths => Math.abs(paths.reduce((s, p) => s + C.Clipper.Area(p), 0)) / (E * E);
  const caixa = paths => caixaPts([].concat(...paths.map(p => p.map(q => [q.X / E, q.Y / E]))));
  return { paraC, offset, inter, uniaoC, area, caixa };
}

/* o cobre de uma camada como formas {tipo, id, net, paths, bb} (paths em unidades do Clipper) */
function cobreDa(K, eb, L, hc, buracoPad) {
  const out = [];
  const poe = (tipo, o, pts, extra) => { if (pts && pts.length >= 3) out.push(Object.assign({ tipo, id: o.id || '', net: o.net || '', paths: [K.paraC(pts)], bb: caixaPts(pts) }, extra || {})); };
  const traco = (tipo, o, pts, w) => { const paths = K.offset([K.paraC(pts)], Math.max(w, 0.01) / 2, true); if (paths.length) out.push({ tipo, id: o.id || '', net: o.net || '', paths, bb: K.caixa(paths), linha: pts, w: Math.max(w, 0.01) }); };
  for (const t of eb.tracks || []) if (t && t.layer === L && [t.x1, t.y1, t.x2, t.y2].every(isNum)) traco('trilha', t, [[t.x1, t.y1], [t.x2, t.y2]], t.w || 0.254);
  for (const a of eb.arcs || []) if (a && a.layer === L && isNum(a.r)) traco('arco', a, geo.pontosArco(a, 5), a.w || 0.254);
  for (const v of eb.vias || []) if (v && isNum(v.x) && isNum(v.size)) poe('via', v, circulo(v.x, v.y, v.size / 2), { cx: v.x, cy: v.y });
  for (const c of eb.components || []) for (const p of (c && c.pads) || []) {
    if (!p || !isNum(p.x) || buracoPad(p)) continue;
    const th = p.type === 'th' || p.layer === 'Multi' || p.drill > 0;
    if (th || p.layer === L) { const pts = geo.poligonoPad(p, 6); poe('pad', p, pts, { ref: c.ref, nome: p.name, cx: p.x, cy: p.y, pts, th }); }
  }
  for (const p of eb.freepads || []) if (p && isNum(p.x) && !buracoPad(p) && (p.layer === 'Multi' || p.drill > 0 || p.layer === L)) { const pts = geo.poligonoPad(p, 6); poe('pad', p, pts, { nome: p.name, cx: p.x, cy: p.y, pts, th: p.layer === 'Multi' || p.drill > 0 }); }
  for (const f of eb.fills || []) if (f && f.layer === L && [f.x1, f.y1, f.x2, f.y2].every(isNum)) {
    const cx = (f.x1 + f.x2) / 2, cy = (f.y1 + f.y2) / 2, a = (f.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const w = Math.abs(f.x2 - f.x1) / 2, h = Math.abs(f.y2 - f.y1) / 2;
    poe('fill', f, [[w, h], [-w, h], [-w, -h], [w, -h]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]));
  }
  for (const g of eb.regions || []) {
    if (!g || g.layer !== L || g.keepout || g.cutout || !Array.isArray(g.points) || g.points.length < 3) continue;
    const paths = [K.paraC(g.points)].concat((g.holes || []).filter(h => Array.isArray(h) && h.length >= 3).map(h => K.paraC(h)));
    out.push({ tipo: g.poly ? 'plano' : 'regiao', id: g.id || g.de || '', net: g.net || '', paths, bb: caixaPts(g.points), eo: true, de: g.de != null ? String(g.de) : undefined });
  }
  return out;
}

/* os parametros que a chamada passou (os de nome proprio e o objeto parametros) */
function paramsDaChamada(a) {
  const o = Object.assign({}, (a && a.parametros) || {});
  for (const k of PARAMS) if (a && isNum(a[k])) o[k] = a[k];
  return o;
}

/* a placa conferida: camadas de cobre, os furos de parafuso e o cobre de cada camada */
function preparaPlaca(ctx, eb, K, o, a, camadasSo) {
  const hc = ctx.hc;
  const camadas = camadasSo || [...new Set(['Top', 'Bottom'].concat((eb.tracks || []).map(t => t.layer), (eb.regions || []).map(g => g.layer)))].filter(k => k && hc.isCopper(k));
  /* pad que e so furo (fixacao sem anel, sem net) */
  const buracoPad = q => !q.net && q.drill >= o.furo_min - 1e-6 && Math.max(q.w || 0, q.h || 0) <= q.drill + 0.05;
  const furos = [];
  const bbPlaca = eb.board && eb.board.bbox;
  for (const k of eb.cutouts || []) {
    if (!k || !Array.isArray(k.points) || k.points.length < 3 || k.kindn === -1 || k.kindn === 1) continue;
    const b = caixaPts(k.points), w = b.x2 - b.x1, h = b.y2 - b.y1;
    if (bbPlaca && b.x1 <= bbPlaca.x1 + 1e-3 && b.x2 >= bbPlaca.x2 - 1e-3) continue;
    if (w <= 12 && h <= 12 && Math.abs(w - h) <= 0.3 * Math.max(w, h)) furos.push({ x: r3((b.x1 + b.x2) / 2), y: r3((b.y1 + b.y2) / 2), d: r3(Math.max(w, h)), origem: 'recorte ' + (k.id || '') });
  }
  for (const c of eb.components || []) for (const q of (c && c.pads) || []) if (q && buracoPad(q)) furos.push({ x: q.x, y: q.y, d: q.drill, origem: c.ref + ' (furo de fixação)' });
  for (const q of eb.freepads || []) if (q && buracoPad(q)) furos.push({ x: q.x, y: q.y, d: q.drill, origem: 'furo livre' });
  for (const f of (a && a.furos) || []) if (Array.isArray(f) && f.length >= 3) furos.push({ x: f[0], y: f[1], d: f[2], origem: 'informado' });
  for (const f of furos) { const m = f.d / 2 + o.parafuso; f.quadrado = { x1: r3(f.x - m), y1: r3(f.y - m), x2: r3(f.x + m), y2: r3(f.y + m) }; }
  const cobre = {};
  for (const L of camadas) cobre[L] = cobreDa(K, eb, L, hc, buracoPad);
  return { camadas, buracoPad, furos, cobre, bbPlaca };
}

/* ---------- a cena da serigrafia (o verificador, o serigrafia_checar e o posicionador) ---------- */
const ladoSilk = l => l === 'TopOverlay' ? 'Top' : l === 'BottomOverlay' ? 'Bottom' : null;
/* a forma de um texto em paths do Clipper: a do HubGerber (a da tela e do Gerber), senao a caixa
   aproximada pelo tamanho da fonte */
function formaTexto(K, tg, t) {
  let paths = [];
  const g = tg ? tg(t) : null;
  if (g && Array.isArray(g.regioes)) paths = g.regioes.filter(r => !r.hole && r.pts && r.pts.length >= 3).map(r => K.paraC(r.pts));
  else if (g && Array.isArray(g.tracos)) {           // fonte stroke do hub: polilinhas com a espessura do traço
    const w = Math.max(g.w || t.w || 0.15, 0.01);
    for (const tr of g.tracos) if (Array.isArray(tr) && tr.length >= 2) paths.push(...K.offset([K.paraC(tr)], w / 2, true));
  }
  if (!paths.length && isNum(t.x)) { const hw = String(t.text || '').length * (t.h || 1) * 0.45, hh = (t.h || 1) / 2; paths = [K.paraC([[t.x - hw, t.y - hh], [t.x + hw, t.y - hh], [t.x + hw, t.y + hh], [t.x - hw, t.y + hh]])]; }
  return paths;
}
function silkDeTexto(K, tg, t) {
  const s = ladoSilk(t && t.layer); if (!s || t.hidden) return null;
  const paths = formaTexto(K, tg, t);
  return paths.length ? { tipo: 'texto', id: t.id || '', texto: t.text, owner: t.owner || '', designator: !!t.designator, lado: s, layer: t.layer,
                          paths, bb: K.caixa(paths), h: t.h, w: t.w, kind: t.kind || '' } : null;
}
function chavesGrade(g, bb) {
  const out = [];
  for (let gx = Math.floor(bb.x1 / g.C); gx <= Math.floor(bb.x2 / g.C); gx++) for (let gy = Math.floor(bb.y1 / g.C); gy <= Math.floor(bb.y2 / g.C); gy++) out.push(gx + ',' + gy);
  return out;
}
function cenaSerigrafia(ctx, eb, K, furos, cobre, tg) {
  const sm = (eb.rules && isNum(eb.rules.sm)) ? eb.rules.sm : 0.1016;
  const silk = [];
  for (const t of eb.texts || []) { const s = silkDeTexto(K, tg, t); if (s) silk.push(s); }
  for (const q of eb.silk || []) {
    const s = ladoSilk(q && q.layer); if (!s) continue;
    let pts = null;
    if ([q.x1, q.y1, q.x2, q.y2].every(isNum)) pts = [[q.x1, q.y1], [q.x2, q.y2]];
    else if (isNum(q.r) && isNum(q.cx)) pts = geo.pontosArco(q, 5);
    if (!pts) continue;
    const paths = K.offset([K.paraC(pts)], Math.max(q.w || 0.15, 0.01) / 2, true);
    if (paths.length) silk.push({ tipo: 'silk', id: q.id || '', owner: q.owner || '', lado: s, layer: q.layer, paths, bb: K.caixa(paths) });
  }
  const quadrados = furos.map(f => ({ tipo: 'quadrado do parafuso', id: f.origem, bb: f.quadrado, paths: [K.paraC([[f.quadrado.x1, f.quadrado.y1], [f.quadrado.x2, f.quadrado.y1], [f.quadrado.x2, f.quadrado.y2], [f.quadrado.x1, f.quadrado.y2]])] }));
  const recortes = (eb.cutouts || []).filter(k => k && Array.isArray(k.points) && k.points.length >= 3 && k.kindn !== -1 && k.kindn !== 1).map(k => ({ tipo: 'recorte', id: k.id || '', bb: caixaPts(k.points), paths: [K.paraC(k.points)] }));
  /* a placa encolhida da folga da borda, pelo CONTORNO (placa recortada ou com arco nao cabe no
     retangulo da bbox); sem contorno, a bbox */
  const PP = ctx.modulo('hub-pcbpour.js');
  const ptsPlaca = PP && PP._int && PP._int.contornoPlaca ? PP._int.contornoPlaca(eb.board, 0.05) : null;
  const placas = new Map();
  const placaEm = f => { if (!ptsPlaca) return null; let v = placas.get(f); if (!v) placas.set(f, v = K.offset([K.paraC(ptsPlaca)], -f, false)); return v; };
  /* o cobre do lado de cada overlay (plano despejado pode ficar embaixo do texto: fora) */
  const obs = {}, gCobre = {};
  for (const L of ['Top', 'Bottom']) { obs[L] = (cobre[L] || []).filter(x => x.tipo !== 'plano'); gCobre[L] = grade(obs[L], 2); }
  const cena = { K, tg, sm, silk, quadrados, recortes, ptsPlaca, bbPlaca: eb.board && eb.board.bbox, placaEm, obs, gCobre, gSilk: {}, cache: new WeakMap() };
  for (const L of ['TopOverlay', 'BottomOverlay']) cena.gSilk[L] = grade(silk.filter(x => x.layer === L), 2);
  /* objeto novo na cena (o texto que o posicionador acabou de pôr) */
  cena.poe = x => {
    cena.silk.push(x);
    const g = cena.gSilk[x.layer];
    if (g) for (const k of chavesGrade(g, x.bb)) { let l = g.G.get(k); if (!l) g.G.set(k, l = []); l.push(x); }
  };
  return cena;
}
/* o obstaculo crescido da folga, guardado (o posicionador testa centenas de lugares contra ele) */
function expande(cena, ob, folga) {
  if (!(folga > 0)) return ob.paths;
  let m = cena.cache.get(ob);
  if (!m) cena.cache.set(ob, m = new Map());
  const k = Math.round(folga * 1e4);
  let v = m.get(k);
  if (!v) m.set(k, v = cena.K.offset(ob.paths, folga, false));
  return v;
}
const nomeSilk = s => s.tipo === 'texto' ? `texto "${s.texto}"` : `serigrafia de ${s.owner || s.id}`;
const SEM_GRADE = { G: new Map(), C: 2 };
/* As violacoes de UM objeto de serigrafia `s` (texto ou desenho), com os parametros `o` e as regras
   desligadas `desl` do lugar dele. opc: {semSilk (o verificador faz silk x silk em pares),
   ignora:Set de ids de serigrafia que nao contam (o texto que vai sair dali), corpos:[{ref, lado,
   bb, paths}] (corpo de componente proibido), parar (para na primeira)}. Cada violacao leva `sub`
   (SUBREGRAS) para o projeto poder desligar. */
function checaSerigrafia(cena, s, o, desl, opc) {
  opc = opc || {};
  const K = cena.K, out = [], txt = s.tipo === 'texto';
  const poe = v => { out.push(Object.assign({ regra: 'serigrafia', camada: s.layer, objeto: { tipo: s.tipo, id: s.id, texto: s.texto, owner: s.owner } }, v)); return !!opc.parar; };
  const bate = (ob, folga, contra, sub) => {
    if (desl.has(sub) || !cruza(s.bb, ob.bb, folga + 0.01)) return false;
    const it = K.inter(s.paths, expande(cena, ob, folga), false);
    if (K.area(it) < 1e-4) return false;
    const bb = K.caixa(it);
    return poe({ sub, x: r3((bb.x1 + bb.x2) / 2), y: r3((bb.y1 + bb.y2) / 2), msg: `${nomeSilk(s)} encosta em ${contra}`,
      contra: { tipo: ob.tipo, id: ob.id, net: ob.net || undefined, ref: ob.ref ? ob.ref + (ob.nome != null ? '.' + ob.nome : '') : undefined } });
  };
  const cx = r3((s.bb.x1 + s.bb.x2) / 2), cy = r3((s.bb.y1 + s.bb.y2) / 2);
  if (txt && !desl.has('texto_tamanho')) {
    const baixo = isNum(s.h) && s.h < o.texto_h_min - 1e-6, fino = s.kind !== 'truetype' && isNum(s.w) && s.w < o.texto_w_min - 1e-6;
    if ((baixo || fino) && poe({ sub: 'texto_tamanho', x: cx, y: cy,
      msg: `${nomeSilk(s)} ${baixo ? `com altura ${r3(s.h)} mm (mínimo ${o.texto_h_min})` : ''}${baixo && fino ? ' e ' : ''}${fino ? `com traço ${r3(s.w)} mm (mínimo ${o.texto_w_min})` : ''}` })) return out;
  }
  /* texto (inclusive designador): todas as regras. Desenho de footprint (contorno, marca do pino 1): so
     cobre exposto (pad/via com a mascara) e furo -- a trilha tem de cruzar o contorno para chegar aos pads */
  const m = Math.max(cena.sm + o.silk, o.silk_cobre) + 0.02;
  for (const ob of vizinhos(cena.gCobre[s.lado] || SEM_GRADE, s.bb, m)) {
    if (ob.tipo === 'pad' || ob.tipo === 'via') { if (bate(ob, txt ? cena.sm + o.silk : cena.sm, ob.tipo === 'pad' ? `pad ${ob.ref ? ob.ref + '.' + ob.nome : ob.id}` : `via ${ob.id}`, 'serigrafia_pad')) return out; }
    else if (txt && bate(ob, o.silk_cobre, `${ob.tipo} ${ob.id}${ob.net ? ' (' + ob.net + ')' : ''}`, 'serigrafia_trilha')) return out;
  }
  for (const k of cena.recortes) if (bate(k, o.silk, `recorte/furo ${k.id}`, 'serigrafia_furo')) return out;
  if (txt) for (const q of cena.quadrados) if (bate(q, 0, `quadrado isolado do parafuso (${q.id})`, 'serigrafia_parafuso')) return out;
  if (txt && !desl.has('serigrafia_borda')) {
    const pc = cena.placaEm(o.silk_borda), bp = cena.bbPlaca;
    /* a area da UNIAO: os tracos da fonte stroke se sobrepoem, e a soma deles passava a parte
       dentro da placa -- todo texto parecia encostar na borda (1.36.0) */
    if (pc && !isNum(s.areaU)) s.areaU = K.area(K.uniaoC(s.paths));
    const fora = pc ? s.areaU - K.area(K.inter(s.paths, pc, false)) > 1e-4
      : !!bp && !(s.bb.x1 >= bp.x1 + o.silk_borda && s.bb.x2 <= bp.x2 - o.silk_borda && s.bb.y1 >= bp.y1 + o.silk_borda && s.bb.y2 <= bp.y2 - o.silk_borda);
    if (fora && poe({ sub: 'serigrafia_borda', x: cx, y: cy, msg: `${nomeSilk(s)} a menos de ${o.silk_borda} mm da borda da placa` })) return out;
  }
  if (!opc.semSilk && !desl.has('serigrafia_silk')) {
    for (const t2 of vizinhos(cena.gSilk[s.layer] || SEM_GRADE, s.bb, o.silk + 0.02)) {
      if (t2 === s || (t2.id && t2.id === s.id) || (opc.ignora && opc.ignora.has(t2.id))) continue;
      if (!txt && t2.tipo === 'silk' && s.owner && s.owner === t2.owner) continue;
      if (bate(t2, o.silk, nomeSilk(t2), 'serigrafia_silk')) return out;
    }
  }
  if (txt && opc.corpos) for (const c of opc.corpos) {
    if (c.lado !== s.lado || !cruza(s.bb, c.bb, 0)) continue;
    if (K.area(K.inter(s.paths, c.paths, false)) < 1e-4) continue;
    if (poe({ sub: 'serigrafia_corpo', x: cx, y: cy, msg: `${nomeSilk(s)} em cima do corpo de ${c.ref}`, contra: { tipo: 'corpo', ref: c.ref } })) return out;
  }
  return out;
}

function verifica(ctx, a) {
  const p = ctx.projeto(a.projeto);
  const C = ctx.exige('hub-clipper.js', 'ClipperLib');
  const K = kit(C);
  const cfg = lerConfig(p);
  const chamada = paramsDaChamada(a);
  const o = Object.assign({}, PAD, cfg.parametros, chamada);      // o geral; a area muda por objeto
  /* a placa como a tela mostra (planos do hub redespejados; cobre despejado do Altium sem poligono fica) */
  const pdp = ctx.placaDespejada(p);
  const eb = pdp.eb, tg = textoGeo(ctx);
  const velhas = pdp.despejo ? pdp.despejo.altium_sem_poligono : [];
  const despejo = pdp.despejo ? pdp.despejo.poligonos + ' polígono(s) redespejado(s) como na tela' +
    (velhas.length ? `; ${velhas.length} região(ões) despejada(s) no Altium sem polígono no hub (${velhas.slice(0, 8).join(', ')}) ficam como vieram (pcb_apagar apaga)` : '') : 'sem polígono';
  const { camadas, furos, cobre } = preparaPlaca(ctx, eb, K, o, a);
  const viol = [];
  const quer = r => (!a.regras || !a.regras.length || a.regras.includes(r)) && !cfg.desligar.includes(r);

  if (quer('parafuso')) for (const f of furos) {
    const q = f.quadrado, sq = [K.paraC([[q.x1, q.y1], [q.x2, q.y1], [q.x2, q.y2], [q.x1, q.y2]])];
    for (const L of camadas) for (const ob of cobre[L]) {
      if (!cruza(ob.bb, q, 0)) continue;
      const it = K.inter(ob.paths, sq, ob.eo);
      if (K.area(it) < 5e-4) continue;
      const bb = K.caixa(it);
      viol.push({ regra: 'parafuso', camada: L, x: r3((bb.x1 + bb.x2) / 2), y: r3((bb.y1 + bb.y2) / 2),
        msg: `${ob.tipo}${ob.net ? ' (' + ob.net + ')' : ''} dentro do quadrado isolado do furo Ø${f.d} em (${f.x}, ${f.y}) [${f.origem}]`,
        objeto: { tipo: ob.tipo, id: ob.id, net: ob.net, ref: ob.ref ? ob.ref + '.' + ob.nome : undefined } });
    }
  }

  /* ---------- plano x pad de outra net ---------- */
  if (quer('plano_pad')) for (const L of camadas) {
    const planos = cobre[L].filter(x => x.tipo === 'plano');
    for (const net of [...new Set(planos.map(x => x.net))]) {
      const suj = [].concat(...planos.filter(x => x.net === net).map(x => x.paths));
      const pads = cobre[L].filter(x => x.tipo === 'pad' && x.net !== net);
      if (!pads.length || !suj.length) continue;
      const clip = [];
      for (const pd of pads) clip.push(...K.offset(pd.paths, Math.max(0, o.plano_pad - 0.02), false));
      const it = K.inter(suj, K.uniaoC(clip), true);
      const porPad = new Map();
      for (const peca of it) {
        if (Math.abs(C.Clipper.Area(peca)) / (E * E) < 2e-4) continue;
        const bb = K.caixa([peca]), cx = (bb.x1 + bb.x2) / 2, cy = (bb.y1 + bb.y2) / 2;
        let melhor = null, dm = Infinity;
        for (const pd of pads) { const pc = [(pd.bb.x1 + pd.bb.x2) / 2, (pd.bb.y1 + pd.bb.y2) / 2], dd = Math.hypot(pc[0] - cx, pc[1] - cy); if (dd < dm) { dm = dd; melhor = pd; } }
        const k = melhor ? (melhor.ref || '') + '.' + melhor.nome : r3(cx) + ',' + r3(cy);
        if (!porPad.has(k)) porPad.set(k, { regra: 'plano_pad', camada: L, x: r3(cx), y: r3(cy),
          msg: `plano ${net} a menos de ${o.plano_pad} mm do pad ${k}${melhor && melhor.net ? ' (' + melhor.net + ')' : ''}`,
          objeto: { tipo: 'pad', ref: k, net: melhor ? melhor.net : '' } });
      }
      viol.push(...porPad.values());
    }
  }

  /* ---------- cobre de OUTRA net em cima ou perto de pad/via (curto) ----------
     Pad passante existe em TODAS as camadas de cobre: trilha do Top passando por cima de pad TH de
     outra net e curto, mesmo que o pad "seja do Bottom". Folga = a Clearance geral do projeto. */
  const folga = isNum(a.folga_cobre) ? a.folga_cobre : folgaDoProjeto(ctx, p);
  if (quer('pad_outra_net')) for (const L of camadas) {
    const obs = cobre[L];
    const alvos = obs.filter(x => x.tipo === 'pad' || x.tipo === 'via');
    const g = grade(obs.filter(x => x.tipo !== 'plano'), 2);
    const visto = new Set();
    for (const al of alvos) {
      let ex = null;
      for (const ob of vizinhos(g, al.bb, folga + 0.01)) {
        if (ob === al || (ob.net && ob.net === al.net)) continue;
        if (ob.tipo === 'pad' && al.tipo === 'pad' && ob.ref && ob.ref === al.ref) continue;     // o footprint e da biblioteca
        if (!cruza(ob.bb, al.bb, folga + 0.01)) continue;
        const k = [L, ob.tipo + ob.id + (ob.ref || '') + (ob.nome || ''), al.tipo + al.id + (al.ref || '') + (al.nome || '')].sort().join('|');
        if (visto.has(k)) continue; visto.add(k);
        const toca = K.area(K.inter(ob.paths, al.paths, ob.eo)) > 1e-6;
        if (!toca) { ex = ex || K.offset(al.paths, Math.max(0, folga - 0.002), false); if (K.area(K.inter(ob.paths, ex, ob.eo)) < 1e-6) continue; }
        viol.push({ regra: 'pad_outra_net', camada: L, x: r3(al.cx), y: r3(al.cy),
          msg: toca ? `CURTO: ${nomeOb(ob)} (${netDe(ob)}) passa por cima do ${nomeOb(al)} (${netDe(al)})`
                    : `${nomeOb(ob)} (${netDe(ob)}) a menos de ${folga} mm do ${nomeOb(al)} (${netDe(al)})`,
          objeto: { tipo: al.tipo, id: al.id, ref: al.ref ? al.ref + '.' + al.nome : undefined, net: al.net },
          contra: { tipo: ob.tipo, id: ob.id, ref: ob.ref ? ob.ref + '.' + ob.nome : undefined, net: ob.net } });
      }
    }
    /* plano despejado (ou poligono vindo do Altium) de outra net em cima/perto do pad ou via */
    const planos = obs.filter(x => x.tipo === 'plano');
    for (const net of [...new Set(planos.map(x => x.net))]) {
      const suj = [].concat(...planos.filter(x => x.net === net).map(x => x.paths));
      const bbP = planos.filter(x => x.net === net).reduce((b, x) => uniao(b, x.bb), { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });
      const ps = alvos.filter(x => !(net && x.net === net) && cruza(x.bb, bbP, folga));
      if (!ps.length || !suj.length) continue;
      const clip = [];
      for (const pd of ps) clip.push(...K.offset(pd.paths, Math.max(0, folga - 0.002), false));
      const it = K.inter(suj, K.uniaoC(clip), true);
      const ja = new Set();
      for (const peca of it) {
        if (Math.abs(C.Clipper.Area(peca)) / (E * E) < 1e-6) continue;
        const bb = K.caixa([peca]), cx = (bb.x1 + bb.x2) / 2, cy = (bb.y1 + bb.y2) / 2;
        let melhor = null, dm = Infinity;
        for (const pd of ps) { const dd = Math.hypot(pd.cx - cx, pd.cy - cy); if (dd < dm) { dm = dd; melhor = pd; } }
        if (!melhor || ja.has(melhor)) continue; ja.add(melhor);
        const toca = K.area(K.inter(suj, melhor.paths, true)) > 1e-6;
        viol.push({ regra: 'pad_outra_net', camada: L, x: r3(melhor.cx), y: r3(melhor.cy),
          msg: (toca ? 'CURTO: plano ' : 'plano ') + `${net || 'sem net'} ${toca ? 'por cima do' : 'a menos de ' + folga + ' mm do'} ${nomeOb(melhor)} (${netDe(melhor)})`,
          objeto: { tipo: melhor.tipo, id: melhor.id, ref: melhor.ref ? melhor.ref + '.' + melhor.nome : undefined, net: melhor.net }, contra: { tipo: 'plano', net } });
      }
    }
  }

  /* ---------- trilha / cobre da MESMA net passando por cima do pad ----------
     Trilha que cruza o pad sem terminar nele (entra de um lado e sai do outro) esconde a ligacao e,
     na tela, parece curto; regiao/fill/faixa solida tapando o pad que o plano liga com alivio termico
     anula o alivio (a solda nao pega) e tambem parece trilha por cima do pad. Trilha que TERMINA no
     pad e sai pelo outro lado (barramento de backplane, pino a pino) e ligacao normal: nao conta. */
  if (quer('trilha_sobre_pad')) {
    const relief = (eb.polygons || []).filter(q => q && q.net && Array.isArray(q.pts) && q.pts.length >= 3 && q.pour !== 'none' &&
      ((q.conexao && q.conexao.tipo === 'relief') || q.con_tipo === 'relief'));
    for (const L of camadas) {
      const obs = cobre[L];
      const g = grade(obs.filter(x => x.tipo === 'trilha' || x.tipo === 'arco' || x.tipo === 'regiao' || x.tipo === 'fill' || (x.tipo === 'plano' && !x.de)), 2);
      for (const pd of obs.filter(x => x.tipo === 'pad')) {
        const viz = vizinhos(g, pd.bb, 0.6).filter(ob => ob.net && ob.net === pd.net && cruza(ob.bb, pd.bb, 0.6));
        if (!viz.length) continue;
        const rel = relief.find(q => q.layer === L && q.net === pd.net && dentroPoly([pd.cx, pd.cy], q.pts));
        let rIn = Infinity;
        for (let i = 0; i < pd.pts.length; i++) rIn = Math.min(rIn, dPS(pd.cx, pd.cy, pd.pts[i], pd.pts[(i + 1) % pd.pts.length]));
        for (const ob of viz) {
          if (ob.linha) {
            const lin = ob.linha, ini = lin[0], fim = lin[lin.length - 1];
            const dI = dentroPoly(ini, pd.pts), dF = dentroPoly(fim, pd.pts);
            if (!dI && !dF) {
              let dm = Infinity;
              for (let i = 0; i + 1 < lin.length; i++) dm = Math.min(dm, dPS(pd.cx, pd.cy, lin[i], lin[i + 1]));
              if (dm < rIn - 0.01) viol.push({ regra: 'trilha_sobre_pad', camada: L, x: r3(pd.cx), y: r3(pd.cy),
                msg: `${nomeOb(ob)} (${netDe(ob)}) passa reto por cima do ${nomeOb(pd)} sem terminar nele — termine a trilha no pad (ou desvie) e saia com outra`,
                objeto: { tipo: 'pad', id: pd.id, ref: pd.ref ? pd.ref + '.' + pd.nome : undefined, net: pd.net }, contra: { tipo: ob.tipo, id: ob.id, net: ob.net } });
            }
          } else if (rel && pd.th) {
            const gap = (rel.conexao && isNum(rel.conexao.gap)) ? rel.conexao.gap : (isNum(rel.con_gap) ? rel.con_gap : 0.3);
            const anel = K.offset(pd.paths, Math.max(gap, 0.1), false);
            const aAnel = K.area(anel) - K.area(pd.paths);
            const cob = K.area(K.inter(ob.paths, anel, ob.eo)) - K.area(K.inter(ob.paths, pd.paths, ob.eo));
            if (aAnel > 0 && cob > 0.5 * aAnel) viol.push({ regra: 'trilha_sobre_pad', camada: L, x: r3(pd.cx), y: r3(pd.cy),
              msg: ob.tipo === 'plano'
                ? `faixa ${ob.id} (${netDe(ob)}) do polygon pour do Altium tapa o ${nomeOb(pd)} e o alívio térmico do plano ${rel.nome || rel.id} — na tela é cobre passando por cima do pad; esse cobre veio despejado de um polígono do Altium que não está na placa: apague a região (pcb_apagar) ou recorte o polígono no Altium`
                : `${ob.tipo} ${ob.id} (${netDe(ob)}) tapa o ${nomeOb(pd)} e o alívio térmico do plano ${rel.nome || rel.id} — o cobre passa por cima do pad; tire a ${ob.tipo} (pcb_apagar) e deixe o plano ligar`,
              objeto: { tipo: 'pad', id: pd.id, ref: pd.ref ? pd.ref + '.' + pd.nome : undefined, net: pd.net }, contra: { tipo: ob.tipo, id: ob.id, net: ob.net } });
          }
        }
      }
    }
  }

  /* ---------- serigrafia ---------- */
  if (quer('serigrafia')) {
    const cena = cenaSerigrafia(ctx, eb, K, furos, cobre, tg);
    const rDe = s => regrasEm(cfg, PAD, chamada, (s.bb.x1 + s.bb.x2) / 2, (s.bb.y1 + s.bb.y2) / 2, s.layer);
    for (const s of cena.silk) { const r = rDe(s); viol.push(...checaSerigrafia(cena, s, r.o, r.desl, { semSilk: true })); }
    /* serigrafia x serigrafia (mesmo lado; o desenho de um mesmo componente pode se tocar) */
    const silk = cena.silk;
    for (let i = 0; i < silk.length; i++) for (let j = i + 1; j < silk.length; j++) {
      const s1 = silk[i], s2 = silk[j];
      if (s1.layer !== s2.layer || !cruza(s1.bb, s2.bb, o.silk + 0.01)) continue;
      if (s1.tipo === 'silk' && s2.tipo === 'silk' && s1.owner && s1.owner === s2.owner) continue;
      const [t1, t2] = s1.tipo === 'texto' ? [s1, s2] : [s2, s1];
      const r = rDe(t1);
      if (r.desl.has('serigrafia_silk') || !cruza(t1.bb, t2.bb, r.o.silk + 0.01)) continue;
      const it = K.inter(t1.paths, expande(cena, t2, r.o.silk), false);
      if (K.area(it) < 1e-4) continue;
      const bb = K.caixa(it);
      viol.push({ regra: 'serigrafia', sub: 'serigrafia_silk', camada: t1.layer, x: r3((bb.x1 + bb.x2) / 2), y: r3((bb.y1 + bb.y2) / 2), msg: `${nomeSilk(t1)} encosta em ${nomeSilk(t2)}`,
        objeto: { tipo: t1.tipo, id: t1.id, texto: t1.texto, owner: t1.owner }, contra: { tipo: t2.tipo, id: t2.id } });
    }
  }

  /* o que o projeto desligou numa area vale para a violacao que cai nela */
  const valendo = cfg.areas.length ? viol.filter(v => { const r = regrasEm(cfg, PAD, chamada, v.x, v.y, v.camada); return !r.desl.has(v.regra) && !(v.sub && r.desl.has(v.sub)); }) : viol;
  const por = {};
  for (const v of valendo) por[v.regra] = (por[v.regra] || 0) + 1;
  const lim = a.limite || 200;
  return { projeto: p.nome, ok: valendo.length === 0, total: valendo.length, por_regra: por, despejo,
    parametros: Object.assign({ folga_cobre: folga }, o), camadas, furos_parafuso: furos,
    regras_do_projeto: cfg.existe ? { arquivo: ctx.rel(p.arq(ARQ_CFG)), parametros: cfg.parametros, desligar: cfg.desligar, areas: cfg.areas.length } : null,
    violacoes: valendo.slice(0, lim), cortadas: Math.max(0, valendo.length - lim),
    skills: skills.listar().map(s => s.nome),
    nota: valendo.length ? 'Corrija e rode de novo até zerar (skill_ler {nome} explica cada regra; regras_casa_definir muda as do projeto).' : 'Placa dentro das regras da casa.' };
}

module.exports = {
  grupo: 'casa',
  ordem: 45,
  titulo: 'Regras da casa — skills (nada de cobre de outra net no pad, trilha não passa por cima de pad, parafuso isolado, plano afastado dos pads, serigrafia livre, boas práticas) e o verificador',
  modulos: ['hub-clipper.js', 'hub-pcbpour.js', 'hub-gerber.js', 'hub-pcbregras.js'],
  ferramentas: [
    {
      nome: 'skills_listar', titulo: 'Skills da casa', leitura: true,
      descricao: 'As regras de projeto da Dieletrons que a IA segue SEMPRE ao mexer numa placa (furo de parafuso isolado, plano de terra afastado dos pads, serigrafia sem passar por cima de nada...): nome, título e quando usar. Leia cada uma com skill_ler antes de criar plano, rotear perto de furo ou escrever overlay; confira com regras_casa_verificar.',
      entrada: { type: 'object', properties: {} },
      executa: async () => ({ total: skills.listar().length, skills: skills.listar().map(s => ({ nome: s.nome, titulo: s.titulo, descricao: s.descricao, recurso: 'eletrichub://skill/' + s.nome, prompt: 'skill_' + s.nome.replace(/[^a-z0-9_]/gi, '_') })) }),
    },
    {
      nome: 'skill_ler', titulo: 'Ler uma skill da casa', leitura: true,
      descricao: 'O texto inteiro de uma skill da casa (a regra, o porquê e como fazer com as ferramentas deste MCP). skills_listar mostra os nomes.',
      entrada: { type: 'object', properties: { nome: { type: 'string', description: 'ex.: pcb-parafusos-isolados' } }, required: ['nome'] },
      executa: async a => {
        const s = skills.ler(a.nome);
        if (!s) throw new ErroMcp(`skill "${a.nome}" não existe — skills_listar: ${skills.listar().map(x => x.nome).join(', ')}`);
        return { nome: s.nome, titulo: s.titulo, descricao: s.descricao, texto: s.corpo };
      },
    },
    {
      nome: 'regras_casa_verificar', titulo: 'Verificar as regras da casa', leitura: true, modulo: 'hub-clipper.js',
      descricao: 'Confere a placa (com as mudanças e os planos redespejados) contra as skills da casa e lista cada violação com posição e objeto: "pad_outra_net" = cobre de OUTRA net (trilha, arco, via, pad, fill, região, plano) passando por cima de um pad/via (CURTO) ou a menos da Clearance do projeto — pad passante vale em todas as camadas; "trilha_sobre_pad" = trilha da mesma net cruzando o pad sem terminar nele, ou região/faixa tapando o pad e o alívio térmico do plano; "parafuso" = cobre dentro do quadrado isolado de um furo de parafuso (furo + 3 mm, todas as camadas); "plano_pad" = plano despejado a menos de 1,0 mm de pad de outra net; "serigrafia" = overlay encostando em pad/via, furo, quadrado de parafuso, trilha do mesmo lado, outra serigrafia ou borda. A placa conferida é a da tela (planos do hub redespejados). Devolve também os furos de parafuso achados com o quadrado de cada um. Rode antes de entregar a placa e zere.',
      entrada: { type: 'object', properties: { projeto: PROJETO,
        regras: { type: 'array', items: { type: 'string', enum: ['pad_outra_net', 'trilha_sobre_pad', 'parafuso', 'plano_pad', 'serigrafia'] }, description: 'só estas (padrão: todas)' },
        folga_cobre: { type: 'number', description: 'folga mínima cobre × pad/via de outra net, mm (padrão: a Clearance All×All do rules.js, senão 0,254)' },
        parafuso: { type: 'number', description: 'folga do quadrado além do furo, mm (padrão 3)' },
        plano_pad: { type: 'number', description: 'folga mínima plano × pad de outra net, mm (padrão 1,0)' },
        silk: { type: 'number', description: 'folga da serigrafia para pad/via/furo/outra serigrafia, mm (padrão 0,254; pad e via somam a expansão da máscara)' },
        silk_cobre: { type: 'number', description: 'folga da serigrafia para trilha/fill/região do mesmo lado, mm (padrão 0,1)' },
        silk_borda: { type: 'number', description: 'folga do texto para a borda da placa, mm (padrão 0,3)' },
        texto_h_min: { type: 'number', description: 'altura mínima do texto de serigrafia, mm (padrão 1,0)' },
        texto_w_min: { type: 'number', description: 'traço mínimo do texto de serigrafia, mm (padrão 0,15)' },
        furo_min: { type: 'number', description: 'furo sem anel a partir do qual um pad sem net é furo de parafuso, mm (padrão 2,5)' },
        furos: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'furos de parafuso a mais: [[x, y, diâmetro], ...] em mm' },
        limite: { type: 'integer', minimum: 1, maximum: 5000 } }, required: ['projeto'] },
      executa: async (a, ctx) => verifica(ctx, a),
    },
    {
      nome: 'regras_casa_ler', titulo: 'Regras da casa do projeto', leitura: true,
      descricao: `As regras da casa que valem NESTE projeto (Projects/<p>/${ARQ_CFG}): os números que mudam (parametros), as regras desligadas e as áreas da placa com números ou regras próprias, mais o padrão da casa. Sem o arquivo, vale o padrão.`,
      entrada: { type: 'object', properties: { projeto: PROJETO }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const c = lerConfig(p);
        return { projeto: p.nome, arquivo: ctx.rel(p.arq(ARQ_CFG)), existe: c.existe, padrao: PAD, valendo: Object.assign({}, PAD, c.parametros),
                 parametros: c.parametros, desligar: c.desligar, areas: c.areas, regras: REGRAS, subregras: SUBREGRAS };
      },
    },
    {
      nome: 'regras_casa_definir', titulo: 'Mudar as regras da casa do projeto',
      descricao: `Grava as regras da casa deste projeto (Projects/<p>/${ARQ_CFG}), que o regras_casa_verificar, o serigrafia_checar e o serigrafia_posicionar seguem. parametros: ${PARAMS.join(', ')} (mm). desligar: regra inteira (${REGRAS.join(', ')}) ou parte da serigrafia (${SUBREGRAS.join(', ')}). areas: [{nome, caixa:{x1,y1,x2,y2}, camada?, parametros, desligar}] — valem só dentro da caixa (ex.: liberar serigrafia sobre trilha no backplane, texto de 0,6 mm na fileira de conectores). Mescla com o que já está no arquivo (parametro null tira; substituir:true troca tudo). Libere uma regra só quando o dono pedir, e diga qual.`,
      entrada: { type: 'object', properties: { projeto: PROJETO,
        parametros: { type: 'object', additionalProperties: true, description: 'ex.: {"texto_h_min":0.6,"texto_w_min":0.1}; null num parâmetro volta ao padrão' },
        desligar: { type: 'array', items: { type: 'string' } },
        ligar: { type: 'array', items: { type: 'string' }, description: 'tira estas da lista de desligadas' },
        areas: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'substitui a lista de áreas' },
        substituir: { type: 'boolean' }, note: { type: 'string' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const atual = a.substituir ? normalizaConfig({}) : lerConfig(p);
        const prm = Object.assign({}, atual.parametros);
        for (const [k, v] of Object.entries(a.parametros || {})) { if (v === null) delete prm[k]; else prm[k] = v; }
        let desl = atual.desligar.concat(a.desligar || []);
        if (a.ligar) desl = desl.filter(r => !a.ligar.includes(r));
        const c = normalizaConfig({ parametros: prm, desligar: desl, areas: a.areas !== undefined ? a.areas : atual.areas }, true);
        const obj = { format: c.format, parametros: c.parametros, desligar: c.desligar, areas: c.areas };
        if (a.note) obj.note = String(a.note);
        const gravado = ctx.grava(p.arq(ARQ_CFG), JSON.stringify(obj, null, 1) + '\n', 'regras_casa_definir');
        return { projeto: p.nome, arquivo: ctx.rel(p.arq(ARQ_CFG)), gravado, valendo: Object.assign({}, PAD, c.parametros), desligar: c.desligar, areas: c.areas };
      },
    },
  ],
  _interno: { verifica, kit, PAD, PARAMS, SUBREGRAS, lerConfig, regrasEm, paramsDaChamada, preparaPlaca, cenaSerigrafia, checaSerigrafia, silkDeTexto, formaTexto, textoGeo, expande },
};
