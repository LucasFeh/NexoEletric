/* AltiumPCBMirror - hub-pcbnova.js
   Placa que nasce no hub (L3/L4 do docs/PCB-MIGRACAO.md): o "PCB Board Wizard" / novo PcbDoc no
   padrao da casa, e a placa MESTRA -- o board.js que o proprio hub grava, em vez de ser so o
   espelho do Altium. Puro (sem DOM): browser (global HubPcbNova) e testes (node).

   O PADRAO DA CASA foi medido no projeto-modelo do Altium
   (C:\Users\Public\Documents\Altium\AD21\Templates\DieletronsAltium\DieletronsAltium\PCB\PCB.PcbDoc,
   lido com o tools/pcbdoc em 2026-10-13):
   - origem no canto inferior esquerdo da placa (ORIGINX = SHEETX = 1000 mil: contorno de 0,0);
   - grade de 5 mil (SNAPGRIDSIZE 50000);
   - 2 camadas; pilha: mascara 0,4 mil (Solder Resist, er 3,5), cobre 1,4 mil, FR-4 12,6 mil
     (er 4,8), cobre 1,4 mil, mascara -- a pilha PADRAO do Altium, que a casa nunca mudou (a
     espessura real de 1,6 mm vai no pedido da fabrica);
   - regras: clearance 10 mil, largura 10 mil, via 0,5/0,3 mm, mascara 4 mil, pasta 0;
   - contorno repetido na Mechanical 1 com linha de 10 mil (o "desenho solto na Mech1" de 96%
     das placas do acervo);
   - texto "Codigo da placa / REV.A" na Top Overlay, 1,5 mm, traco 0,3, no canto inferior direito.
   4 camadas NAO tem modelo na casa (7 projetos com roteamento interno, nenhum plano): vale a pilha
   JLC7628 de 1,6 mm, que e onde a casa fabrica -- marcada como nao medida.

   API:
     PADRAO_CASA
     contorno(o) -> {pts, segs, bbox}   o: {forma:'retangulo'|'arredondado'|'importar', largura, altura, raio, pts|segs}
     gera(o) -> board                    o: {projeto, largura, altura, forma, raio, camadas:2|4, origem:'canto'|'centro',
                                              mech1:true, furos:{d, margem}|null, codigo:'texto'|null, regras:{...}, pts|segs}
     erros(o) -> [texto]                 o que o assistente recusa, antes de gerar
     serializa(board) -> texto           "var pcbmirror = {...};" um objeto por linha, como o ExportBoard
     consolida(board, changes, o) -> {board, erros}   placa mestra: assa o changes.js no board.js
                                                      (ids 'new-*' renumerados, footprints usados embutidos)
     ehMestre(board) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    let R = null;
    try { R = require('./hub-pcbregras.js'); } catch (e) { R = null; }
    module.exports = factory(require('./hub-core.js'), { HubPcbRegras:R });
  }
  else root.HubPcbNova = factory(root.HubCore, root);
})(typeof self !== 'undefined' ? self : this, function (HC, raiz) {
"use strict";

const MIL = 0.0254;
const isNum = v => typeof v === 'number' && isFinite(v);
const r6 = v => { const x = Math.round(v * 1e6) / 1e6; return x === 0 ? 0 : x; };

const PADRAO_CASA = Object.freeze({
  medido:'DieletronsAltium.PrjPcb / PCB.PcbDoc (AD21), 2026-10-13',
  origem:'canto',
  grade:5 * MIL,
  regras:Object.freeze({ sm:0.1016, pm:0, clearance:0.254, width:0.254, viaSize:0.5, viaDrill:0.3 }),
  furo:3.2,                       /* o furo de fixacao da ferramenta Furo da vista PCB */
  mech1W:0.254,
  codigo:Object.freeze({ texto:'Codigo da placa\r\nREV.A', h:1.5, w:0.3, dx:16.129, dy:7.747 }),
  pilha2:Object.freeze([
    { camada:'TopSolder',    tipo:'mascara',    espessura:0.4 * MIL,  material:'Solder Resist', er:3.5 },
    { camada:'Top',          tipo:'cobre',      espessura:1.4 * MIL },
    { camada:'Dielectric1',  tipo:'dieletrico', espessura:12.6 * MIL, material:'FR-4', er:4.8 },
    { camada:'Bottom',       tipo:'cobre',      espessura:1.4 * MIL },
    { camada:'BottomSolder', tipo:'mascara',    espessura:0.4 * MIL,  material:'Solder Resist', er:3.5 },
  ]),
  pilha4:Object.freeze([
    { camada:'TopSolder',    tipo:'mascara',    espessura:0.4 * MIL, material:'Solder Resist', er:3.5 },
    { camada:'Top',          tipo:'cobre',      espessura:0.035 },
    { camada:'Dielectric1',  tipo:'dieletrico', espessura:0.2104, material:'Prepreg 7628', er:4.4 },
    { camada:'Mid1',         tipo:'cobre',      espessura:0.0152 },
    { camada:'Dielectric2',  tipo:'dieletrico', espessura:1.065,  material:'FR-4 core', er:4.6 },
    { camada:'Mid2',         tipo:'cobre',      espessura:0.0152 },
    { camada:'Dielectric3',  tipo:'dieletrico', espessura:0.2104, material:'Prepreg 7628', er:4.4 },
    { camada:'Bottom',       tipo:'cobre',      espessura:0.035 },
    { camada:'BottomSolder', tipo:'mascara',    espessura:0.4 * MIL, material:'Solder Resist', er:3.5 },
  ]),
  pilha4Nota:'não medida no acervo: pilha JLC7628 de 1,6 mm (a fábrica da casa)',
});

/* as camadas que o PcbDoc-modelo da casa tem (board.js » layers), na ordem dele */
function camadasDaPlaca(n){
  const sinal = n === 4 ? ['Top', 'Mid1', 'Mid2', 'Bottom'] : ['Top', 'Bottom'];
  const out = sinal.map((k, i) => ({ key:k, name:HC.pcbLayer(k).name, stack:i + 1 }));
  out[0].name = 'Top Layer'; out[out.length - 1].name = 'Bottom Layer';
  for (const k of ['Mech1', 'TopOverlay', 'BottomOverlay', 'TopPaste', 'BottomPaste', 'TopSolder', 'BottomSolder',
                   'DrillGuide', 'KeepOut', 'DrillDrawing', 'Multi'])
    out.push({ key:k, name:HC.pcbLayer(k).name });
  return out;
}

const T22 = Math.tan(Math.PI / 8);                  /* bulge de um canto de 90 graus */
/* o contorno pedido, em pts com bulge (o formato do outline_set) e em segmentos do board.js */
function contorno(o){
  const forma = o.forma || 'retangulo';
  let pts;
  if (forma === 'importar') {
    if (Array.isArray(o.pts)) pts = o.pts.map(p => p.slice());
    else if (Array.isArray(o.segs)) pts = HC.outlineToPts(o.segs);
    if (!pts) return null;
  } else {
    const w = o.largura, h = o.altura;
    if (!(w > 0) || !(h > 0)) return null;
    const r = forma === 'arredondado' ? Math.min(Math.max(o.raio || 0, 0), w / 2, h / 2) : 0;
    if (r > 1e-9) {
      /* cada canto: reta ate o comeco do arco, arco de 90 graus anti-horario (bulge +tan 22,5) */
      pts = [[r, 0], [w - r, 0, T22], [w, r], [w, h - r, T22], [w - r, h], [r, h, T22], [0, h - r], [0, r, T22]];
      /* lado de comprimento zero (raio = metade do lado) some: o arco vai direto ao proximo */
      pts = pts.filter((p, i) => { const q = pts[(i + 1) % pts.length]; return !(Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9); });
    } else pts = [[0, 0], [w, 0], [w, h], [0, h]];
  }
  /* origem: canto inferior esquerdo (a da casa) ou centro da placa */
  const segs0 = HC.ptsToOutline(pts);
  if (!segs0) return null;
  const bb0 = HC.outlineBBox(segs0);
  const dx = o.origem === 'centro' ? -(bb0.x1 + bb0.x2) / 2 : -bb0.x1;
  const dy = o.origem === 'centro' ? -(bb0.y1 + bb0.y2) / 2 : -bb0.y1;
  pts = pts.map(p => { const q = [r6(p[0] + dx), r6(p[1] + dy)]; if (p.length > 2 && isNum(p[2]) && p[2]) q.push(p[2]); return q; });
  const segs = HC.ptsToOutline(pts);
  return { pts, segs, bbox:HC.outlineBBox(segs) };
}

function erros(o){
  const e = [];
  const f = o.forma || 'retangulo';
  if (!['retangulo', 'arredondado', 'importar'].includes(f)) e.push('forma deve ser retângulo, arredondado ou importar');
  if (f !== 'importar') {
    if (!(o.largura > 0) || o.largura > 600) e.push('largura entre 0 e 600 mm');
    if (!(o.altura > 0) || o.altura > 600) e.push('altura entre 0 e 600 mm');
    if (f === 'arredondado' && !(o.raio > 0)) e.push('raio do canto deve ser > 0');
    if (f === 'arredondado' && o.raio > Math.min(o.largura, o.altura) / 2) e.push('raio maior que metade do lado');
  } else if (!contorno(o)) e.push('contorno importado não fecha (pts ou segs)');
  if (o.camadas !== undefined && o.camadas !== 2 && o.camadas !== 4) e.push('camadas: 2 ou 4');
  if (o.furos) {
    const c = contorno(o);
    const d = o.furos.d, m = o.furos.margem;
    if (!(d > 0)) e.push('diâmetro do furo de fixação deve ser > 0');
    if (!(m > d / 2)) e.push('margem do furo deve passar do raio do furo');
    if (c && (2 * m >= c.bbox.x2 - c.bbox.x1 || 2 * m >= c.bbox.y2 - c.bbox.y1)) e.push('placa pequena demais para os furos nessa margem');
  }
  if (typeof o.codigo === 'string' && o.codigo.indexOf('":') >= 0) e.push('código não pode ter aspas seguidas de dois-pontos');
  return e;
}

/* furo de fixacao = Board Cutout redondo de 36 lados, o mesmo da ferramenta Furo da vista PCB */
function circulo(cx, cy, r, n){
  const out = [];
  for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; out.push([r6(cx + r * Math.cos(a)), r6(cy + r * Math.sin(a))]); }
  return out;
}

function hoje(){
  const d = new Date(), z = n => ('0' + n).slice(-2);
  return `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

/* board.rules (o resumo que o espelho tambem traz): o padrao da casa; opts.regras por cima */
function regrasPadrao(o){
  let r = Object.assign({}, PADRAO_CASA.regras);
  if (o && o.regras && typeof o.regras === 'object') r = Object.assign(r, o.regras);
  return r;
}
/* O rules.js da placa nova (as Design Rules inteiras, que o DRC le): o padrao da casa do
   hub-pcbregras (o template DieletronsAltium, medido por aquela frente), serializado por ele.
   null quando o hub-pcbregras nao esta carregado -- ai a placa vale so com o board.rules. O
   integrador grava em Projects/<p>/rules.js pelo /api/save (rules.js ja e liberado la). */
function regrasJs(){
  const R = raiz && raiz.HubPcbRegras;
  if (!R || typeof R.padroesCasa !== 'function' || typeof R.serializa !== 'function') return null;
  try { const t = R.serializa(R.padroesCasa()); return typeof t === 'string' ? t : (t && typeof t.text === 'string' ? t.text : null); }
  catch (e) { return null; }
}

function gera(opts){
  const o = Object.assign({ forma:'retangulo', camadas:2, origem:PADRAO_CASA.origem, mech1:true }, opts || {});
  const e = erros(o);
  if (e.length) throw new Error('placa nova: ' + e.join('; '));
  const c = contorno(o);
  const bb = c.bbox;
  const B = {
    format:'pcbmirror-v1', exporter:'EletricHUB', master:true, generated:hoje(),
    project:typeof o.projeto === 'string' ? o.projeto : '',
    source:'EletricHUB (placa nova, padrão da casa)', units:'mm', axis:'y-up',
    origin_note:'coordenadas em mm relativas a origem da placa, Y para cima - placa mestra do hub (board.js gravado pelo EletricHUB)',
    board:{ bbox:bb, outline:c.segs },
    nets:[],
    layers:camadasDaPlaca(o.camadas),
    rules:regrasPadrao(o),
    stackup:(o.camadas === 4 ? PADRAO_CASA.pilha4 : PADRAO_CASA.pilha2).map(x => Object.assign({}, x, { espessura:r6(x.espessura) })),
    grid:r6(PADRAO_CASA.grade),
    components:[], freepads:[], tracks:[], arcs:[], vias:[], texts:[], silk:[], lines:[], fills:[], regions:[], cutouts:[],
    polygons:[], footprints:[],
  };
  if (o.camadas === 4) B.stackupNota = PADRAO_CASA.pilha4Nota;
  if (o.mech1)
    c.segs.forEach((s, i) => B.lines.push(Object.assign({ id:'l' + (i + 1), layer:'Mech1' }, s, { w:PADRAO_CASA.mech1W })));
  if (o.furos) {
    const r = o.furos.d / 2, m = o.furos.margem;
    [[bb.x1 + m, bb.y1 + m], [bb.x2 - m, bb.y1 + m], [bb.x2 - m, bb.y2 - m], [bb.x1 + m, bb.y2 - m]].forEach((p, i) =>
      B.cutouts.push({ id:'k' + (i + 1), layer:'Multi', incomp:false, points:circulo(p[0], p[1], r, 36) }));
  }
  if (o.codigo) {
    const k = PADRAO_CASA.codigo;
    const txt = o.codigo === true ? k.texto : String(o.codigo);
    B.texts.push({ id:'x1', layer:'TopOverlay', x:r6(Math.max(bb.x1 + k.dx / 2, bb.x2 - k.dx)), y:r6(bb.y1 + Math.min(k.dy, (bb.y2 - bb.y1) / 2)),
                   text:txt, h:k.h, rot:0, mirror:false, designator:false, comment:false, w:k.w, kind:'stroke' });
  }
  B.stats = conta(B);
  return B;
}

const EB_ARRAYS = ['components', 'freepads', 'tracks', 'arcs', 'vias', 'texts', 'silk', 'lines', 'fills', 'regions', 'cutouts'];
function conta(B){
  const st = {};
  for (const k of EB_ARRAYS) st[k] = (B[k] || []).length;
  st.polygons = (B.polygons || []).length;
  return st;
}

const ehMestre = B => !!(B && B.master === true);

/* ---- serializacao: o formato do ExportBoard (cabecalho uma chave por linha, arrays um objeto
   por linha, virgula na frente), nao-ASCII em \uXXXX como o JS() dos .pas ---- */
const js = v => JSON.stringify(v).replace(/[\u007e-\uffff]/g, c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));
function serializa(B){
  const L = ['var pcbmirror = {'];
  const chaves = Object.keys(B);
  chaves.forEach((k, i) => {
    const fim = i === chaves.length - 1 ? '' : ',';
    const v = B[k];
    if (Array.isArray(v)) {
      L.push(js(k) + ':[');
      v.forEach((x, j) => L.push((j ? ',' : '') + js(x)));
      L.push(']' + fim);
    } else L.push(js(k) + ':' + js(v) + fim);
  });
  L.push('};');
  return L.join('\n') + '\n';
}

/* ---- placa mestra: o changes.js assado no board.js ----
   Num projeto que nasceu no hub nao ha Altium do outro lado: o board.js e a verdade e o
   changes.js e so o trabalho em andamento. Consolidar = effectiveBoard (o mesmo motor da tela e do
   Gerber) + ids 'new-*' renumerados na sequencia de cada tipo (senao o proximo comp_add
   reusaria 'new-c1') + os footprints que os componentes usam EMBUTIDOS em board.footprints (a
   biblioteca da placa, como no PcbDoc: a placa abre sem o pcblib.js). Com erro de validacao no
   changes.js, nao consolida. */
const PREFIXO = { components:'c', freepads:'p', tracks:'t', arcs:'a', vias:'v', texts:'x', silk:'s', lines:'l',
                  fills:'f', regions:'g', cutouts:'k', polygons:'pg' };
function renumera(B){
  const mapa = Object.create(null);
  for (const k of Object.keys(PREFIXO)) {
    const pre = PREFIXO[k], L = B[k] || [];
    const re = new RegExp('^' + pre + '(\\d+)$');
    let max = 0;
    for (const o of L) { const m = o && typeof o.id === 'string' && o.id.match(re); if (m) max = Math.max(max, +m[1]); }
    for (const o of L) if (o && typeof o.id === 'string' && o.id.indexOf('new-') === 0) { const n = pre + (++max); mapa[o.id] = n; o.id = n; }
  }
  for (const c of (B.components || [])) (c.pads || []).forEach((p, i) => {
    if (p && typeof p.id === 'string' && p.id.indexOf('new-') === 0) p.id = c.id + 'p' + (i + 1);
  });
  return mapa;
}
function consolida(board, changes, opts){
  const o = opts || {};
  const m = HC.applyPcbChanges(board, changes || [], { pcblib:o.pcblib });
  const errs = m.validation.filter(v => v.level === 'err').map(v => v.msg);
  if (errs.length) return { board:null, erros:errs };
  const eb = HC.effectiveBoard(board, m);
  renumera(eb);
  /* biblioteca embutida: o que ja estava, mais o footprint de cada componente que veio da pcblib */
  const emb = Array.isArray(eb.footprints) ? eb.footprints.slice() : [];
  const tem = new Set(emb.map(f => f && f.name));
  for (const c of eb.components) {
    if (!c || !c.footprint || tem.has(c.footprint)) continue;
    const g = HC.footprintGeom(c.footprint, { components:[], footprints:emb }, { pcblib:o.pcblib }) ||
              HC.footprintGeom(c.footprint, eb, { pcblib:o.pcblib });
    if (g) { emb.push(Object.assign({}, JSON.parse(JSON.stringify(g.fp)), { name:c.footprint })); tem.add(c.footprint); }
  }
  eb.footprints = emb;
  eb.exporter = 'EletricHUB'; eb.master = true; eb.generated = hoje();
  eb.stats = conta(eb);
  return { board:eb, erros:[] };
}

return { PADRAO_CASA, contorno, erros, gera, serializa, consolida, renumera, ehMestre, camadasDaPlaca, regrasJs };
});
