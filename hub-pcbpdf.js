/* AltiumPCBMirror v2 - hub-pcbpdf.js
   O PDF de layout ("LO - ...") que a casa tira do Draftsman do Altium 21, gerado pelo hub (P1/P2 do
   docs/PCB-MIGRACAO.md, secao 4.2). Entra a placa EFETIVA (HubCore.effectiveBoard: o board.js com
   as mudancas ja assadas, as mesmas que o Gerber usa) e sai o PDF vetorial:

     folha A4 paisagem (A3 se pedir), moldura com as zonas do Draftsman (6 x 4, letras nas colunas,
     origem no canto de cima a esquerda) e o CARIMBO DIEletrons do template A4_DiEletronsDraftsman
     (geometria, textos e logo extraidos pelo tools/draftsman/carimbo.py -> hub-pcbpdf-carimbo.js);
     vista de montagem de cima e de baixo (a de baixo espelhada, como o Draftsman a mostra: olhando
     por baixo da placa), em escala "redonda" automatica ou escolhida, com:
       contorno da placa e recortes   - HubGerber.caminhoContorno e HubLaser.boardCutouts
       serigrafia do lado              - linhas/arcos/fills/regioes; texto pelo HubGerber.geometriaTexto
       corpo do componente             - camada mecanica de 3D Body/Courtyard quando a placa tem;
                                         senao a caixa do componente (bbox do board.js)
       pads (opcional)                 - HubLaser.padPrim, nas cores do Draftsman (SMD azul, PTH verde)
       furos >= 1,5 mm                 - o "MinimumDiameter" do Layout.PCBDwf da casa
       designators                     - os da serigrafia (padrao), no centro do componente, ou nao
     pagina "Realistic View" opcional  - a placa de cima e de baixo nas cores do modo realista do
                                         hub-gerberview (mascara, cobre sob a mascara, ouro, silk
                                         branco, furos vazados), vetorial; ou o raster que o
                                         chamador mandar (opcoes.realista.cima/baixo)
     quadros "OBS:" opcionais          - como os do Layout.PCBDwf (Arial Narrow -> Helvetica)

   O Draftsman mede em DIP do WPF (1/96 pol); tudo aqui ja esta em mm, origem no canto INFERIOR
   esquerdo da folha, Y para cima (a conta da placa e do PDF).

   Logica pura, sem DOM: navegador (global HubPcbPdf; carregue antes hub-font.js, hub-laser.js,
   hub-gerber.js, hub-pdfwriter.js e hub-pcbpdf-carimbo.js) e node (tests/test-pcbpdf.js).

   API
     HubPcbPdf.gera(eb, opcoes)      -> Uint8Array   (Flate pelo zlib no node; cru no navegador)
     HubPcbPdf.geraAsync(eb, opcoes) -> Promise<Uint8Array>   (CompressionStream no navegador)
     HubPcbPdf.monta(eb, opcoes)     -> { doc, folhas:[{tipo, escala}], escala, campos, avisos, nome }
     HubPcbPdf.plano(eb, opcoes)     -> { folhas, escala, avisos }  so o arranjo (a UI mostra antes)
     HubPcbPdf.camposCarimbo(eb, opcoes) -> os campos que o carimbo vai mostrar (padroes do projeto)
     HubPcbPdf.nomeArquivo(eb, opcoes)   -> 'LO - <base>.pdf'
     HubPcbPdf.ESCALAS, HubPcbPdf.rotuloEscala(s), HubPcbPdf.leEscala('3:2') -> 1.5

   opcoes (tudo opcional)
     formato   'A4' (padrao) | 'A3'
     escala    'auto' (padrao: a maior da lista que cabe) | numero (2 = 2:1) | '3:2'
     folhas    { cima:true, baixo:true, realista:false }
     juntas    'auto' (padrao: as duas vistas numa folha se couberem na mesma escala) | true | false
     titulos   true: "TOP VIEW"/"BOTTOM VIEW" no alto da folha (como o Layout.PCBDwf)
     legenda   'View from =ViewSide side (Scale =ViewScale)' (a do Draftsman); '' tira
     corpo     'auto' | 'mecanica' | 'caixa' | 'nao'
     pads      false | true
     designators 'serigrafia' | 'centro' | 'nao'
     furos     true | false
     obs       '' | 'texto' | { cima, baixo, realista }   (texto com \n; quadro so onde houver texto)
     carimbo   { arquivo, revisao, equipamento ('linha 1\nlinha 2'), desenho, desenhista, dataDesenho,
                 verificador, dataVerificacao, aprovador, dataAprovacao, formato, escala }
     realista  { cima:{jpeg|rgb, w, h}, baixo:{...} }   raster pronto (senao, vetorial)
     data      Date (padrao: agora; os testes fixam)
     deflate   funcao (Uint8Array) -> Uint8Array, so para o gera() sincrono */
(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(root, require('./hub-pdfwriter.js'), require('./hub-gerber.js'), require('./hub-laser.js'),
                             require('./hub-pcbpdf-carimbo.js'));
  else root.HubPcbPdf = factory(root, root.HubPdfWriter, root.HubGerber, root.HubLaser, root.HubPcbPdfCarimbo);
})(typeof self !== 'undefined' ? self : this, function (root, W0, G0, L0, C0) {
"use strict";

function dep(nome, v) {
  const x = v || (root && root[nome]);
  if (!x) throw new Error('HubPcbPdf: falta ' + nome + ' (carregue o .js dele antes)');
  return x;
}
const PdfW = () => dep('HubPdfWriter', W0);
const Ger = () => dep('HubGerber', G0);
const Las = () => dep('HubLaser', L0);
const Car = () => dep('HubPcbPdfCarimbo', C0);

const isNum = v => typeof v === 'number' && isFinite(v);

/* ============================== escala ============================== */

/* as escalas "redondas" do acervo (1:1, 3:2, 2:1 e o 1,27 que aparece nos LO) e as de reducao */
const ESCALAS = Object.freeze([10, 8, 5, 4, 3, 2.5, 2, 1.5, 1.27, 1, 0.75, 2 / 3, 0.5, 0.4, 1 / 3, 0.25, 0.2, 0.1]);
const fmt = v => String(Math.round(v * 100) / 100).replace('.', ',');
function rotuloEscala(s) {
  if (!(s > 0)) return '';
  const casos = [[1.5, '3:2'], [2.5, '5:2'], [0.75, '3:4'], [2 / 3, '2:3'], [0.4, '2:5']];
  for (const c of casos) if (Math.abs(s - c[0]) < 1e-6) return c[1];
  if (s >= 1) return fmt(s) + ':1';
  return '1:' + fmt(1 / s);
}
function leEscala(v) {
  if (isNum(v)) return v > 0 ? v : null;
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*[:/]\s*(\d+(?:[.,]\d+)?)\s*$/.exec(String(v || ''));
  if (!m) return null;
  const a = parseFloat(m[1].replace(',', '.')), b = parseFloat(m[2].replace(',', '.'));
  return a > 0 && b > 0 ? a / b : null;
}
/* a maior da lista em que (w, h) cabe em (aw, ah) */
function escalaQueCabe(w, h, aw, ah) {
  for (const s of ESCALAS) if (w * s <= aw + 1e-9 && h * s <= ah + 1e-9) return s;
  return Math.min(aw / w, ah / h);
}

/* ============================== a placa ============================== */

function caixaDaPlaca(eb) {
  const b = eb && eb.board && eb.board.bbox;
  if (b && [b.x1, b.y1, b.x2, b.y2].every(isNum) && b.x2 > b.x1 && b.y2 > b.y1) return { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 };
  /* sem bbox: a caixa do contorno, senao a dos componentes */
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const poe = (x, y) => { if (isNum(x) && isNum(y)) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y); } };
  for (const s of ((eb && eb.board && eb.board.outline) || [])) {
    if (s.kind === 'arc') { poe(s.cx - s.r, s.cy - s.r); poe(s.cx + s.r, s.cy + s.r); } else { poe(s.x1, s.y1); poe(s.x2, s.y2); }
  }
  if (!(x1 < x2)) for (const c of ((eb && eb.components) || [])) if (c.bbox) { poe(c.bbox.x1, c.bbox.y1); poe(c.bbox.x2, c.bbox.y2); }
  if (!(x1 < x2) || !(y1 < y2)) return { x1: 0, y1: 0, x2: 50, y2: 50 };
  return { x1, y1, x2, y2 };
}

const OVERLAY = { top: 'TopOverlay', bottom: 'BottomOverlay' };
const COBRE = { top: 'Top', bottom: 'Bottom' };
const ladoDe = camada => camada === 'Bottom' ? 'bottom' : 'top';

/* camadas mecanicas de corpo: pelo nome que a placa da (Top 3D Body, Courtyard, Assembly...);
   sem nome que diga, as do padrao do Altium (Mech13 = 3D Body, Mech15 = Courtyard) */
const RE_CORPO = /3d\s*body|courtyard|assembly|component\s*(outline|body)|corpo|montagem/i;
function camadasDeCorpo(eb) {
  const out = new Map();
  for (const l of (Array.isArray(eb.layers) ? eb.layers : []))
    if (l && typeof l.key === 'string' && /^Mech\d+$/.test(l.key) && RE_CORPO.test(String(l.name || '')))
      out.set(l.key, /bot/i.test(l.name) ? 'bottom' : /top/i.test(l.name) ? 'top' : null);
  if (!out.size) { out.set('Mech13', null); out.set('Mech15', null); }
  return out;
}
/* objetos de corpo do lado: o lado vem do componente dono; sem dono, do nome da camada; sem os
   dois, cima */
function objetosDeCorpo(eb, lado) {
  const cams = camadasDeCorpo(eb), out = [];
  const compLado = Object.create(null);
  for (const c of (eb.components || [])) if (c && c.ref) compLado[c.ref] = ladoDe(c.layer);
  const ve = (o, tipo) => {
    if (!o || !cams.has(o.layer)) return;
    const l = (o.owner && compLado[o.owner]) || cams.get(o.layer) || 'top';
    if (l === lado) out.push({ o, tipo });
  };
  for (const k of ['lines', 'silk', 'arcs', 'tracks']) for (const o of (eb[k] || [])) ve(o, o && o.kind === 'arc' || k === 'arcs' ? 'arco' : 'linha');
  for (const o of (eb.fills || [])) ve(o, 'fill');
  for (const o of (eb.regions || [])) ve(o, 'regiao');
  return out;
}

/* ============================== desenho de primitivas ============================== */

/* o contorno da placa no caminho (continuo, com os arcos no sentido do percurso) */
function caminhoDaPlaca(pg, eb, bb) {
  let segs = [];
  try { segs = Ger().caminhoContorno((eb.board && eb.board.outline) || []); } catch (_) { segs = []; }
  if (!segs.length) { pg.retangulo(bb.x1, bb.y1, bb.x2 - bb.x1, bb.y2 - bb.y1); return false; }
  let cur = null;
  for (const s of segs) {
    const ini = s.k === 'line' ? [s.x1, s.y1] : [s.sx, s.sy];
    if (!cur || Math.hypot(cur[0] - ini[0], cur[1] - ini[1]) > 1e-3) {
      if (cur) pg.fecha();
      pg.move(ini[0], ini[1]);
    }
    if (s.k === 'line') { pg.reta(s.x2, s.y2); cur = [s.x2, s.y2]; continue; }
    const r = Math.hypot(s.sx - s.cx, s.sy - s.cy);
    const a0 = Math.atan2(s.sy - s.cy, s.sx - s.cx) * 180 / Math.PI;
    const a1 = s.cheio ? a0 + (s.cw ? -360 : 360) : Math.atan2(s.ey - s.cy, s.ex - s.cx) * 180 / Math.PI;
    pg.arco(s.cx, s.cy, r, a0, a1, s.cw);
    cur = [s.ex, s.ey];
  }
  pg.fecha();
  return true;
}
function recortes(eb) { try { return Las().boardCutouts(eb); } catch (_) { return []; } }

/* primitiva do HubLaser (disc/rect/poly/path) -> caminho */
function caminhoPrim(pg, pr) {
  if (!pr) return;
  if (pr.k === 'disc') { pg.circulo(pr.x, pr.y, pr.r); return; }
  if (pr.k === 'poly') { pg.poligono(pr.pts); return; }
  if (pr.k === 'rect') {
    const g = (pr.rot || 0) * Math.PI / 180, co = Math.cos(g), si = Math.sin(g);
    const hw = pr.w / 2, hh = pr.h / 2, r = Math.max(0, Math.min(pr.r || 0, hw, hh));
    const P = (x, y) => [pr.cx + x * co - y * si, pr.cy + x * si + y * co];
    if (r <= 1e-6) { pg.poligono([P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)]); return; }
    /* canto redondo: 4 retas e 4 quartos de arco, no referencial do pad */
    const cantos = [[hw - r, -hh + r, -90], [hw - r, hh - r, 0], [-hw + r, hh - r, 90], [-hw + r, -hh + r, 180]];
    const ini = P(-hw + r, -hh);
    pg.move(ini[0], ini[1]);
    for (const c of cantos) {
      const k = 0.5522847498 * r, a = c[2] * Math.PI / 180, b = a + Math.PI / 2;
      const p0 = [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)], p3 = [c[0] + r * Math.cos(b), c[1] + r * Math.sin(b)];
      const p1 = [p0[0] - k * Math.sin(a), p0[1] + k * Math.cos(a)], p2 = [p3[0] + k * Math.sin(b), p3[1] - k * Math.cos(b)];
      const q0 = P(p0[0], p0[1]), q1 = P(p1[0], p1[1]), q2 = P(p2[0], p2[1]), q3 = P(p3[0], p3[1]);
      pg.reta(q0[0], q0[1]); pg.curva(q1[0], q1[1], q2[0], q2[1], q3[0], q3[1]);
    }
    pg.fecha();
  }
}
function padPrim(p) { try { return Las().padPrim(p, null); } catch (_) { return null; } }
/* a forma do pad no lado (pilha diferente no Bottom: bshape/bw/bh, como o hub-gerber) */
function padNoLado(p, lado) {
  if (lado === 'bottom' && (p.bshape || isNum(p.bw) || isNum(p.bh)))
    return Object.assign({}, p, { shape: p.bshape || p.shape, w: isNum(p.bw) ? p.bw : p.w, h: isNum(p.bh) ? p.bh : p.h });
  return p;
}
const ehTH = p => p.type === 'th' || p.layer === 'Multi';
const padNoLadoQ = (p, lado) => ehTH(p) || p.layer === COBRE[lado];
function todosPads(eb) {
  const out = [];
  for (const c of (eb.components || [])) for (const p of ((c && c.pads) || [])) if (p) out.push(p);
  for (const p of (eb.freepads || [])) if (p) out.push(p);
  return out;
}

/* linha/arco com largura real (unidades da placa), ponta redonda */
function tracoLinha(pg, o) {
  if (o.kind === 'arc' || (isNum(o.cx) && isNum(o.r))) {
    if (!(o.r > 0)) return false;
    pg.arco(o.cx, o.cy, o.r, o.sa || 0, o.ea === o.sa ? (o.sa || 0) + 360 : o.ea, false, true);
    return true;
  }
  if (![o.x1, o.y1, o.x2, o.y2].every(isNum)) return false;
  pg.move(o.x1, o.y1).reta(o.x2, o.y2);
  return true;
}
function caminhoFill(pg, f) {
  if (![f.x1, f.y1, f.x2, f.y2].every(isNum)) return;
  const w = Math.abs(f.x2 - f.x1), h = Math.abs(f.y2 - f.y1);
  caminhoPrim(pg, { k: 'rect', cx: (f.x1 + f.x2) / 2, cy: (f.y1 + f.y2) / 2, w, h, rot: f.rot || 0, r: 0 });
}
function caminhoRegiao(pg, g) {
  const ok = q => Array.isArray(q) && q.length >= 3;
  if (!ok(g.points)) return;
  pg.poligono(g.points);
  for (const h of (Array.isArray(g.holes) ? g.holes : [])) if (ok(h)) pg.poligono(h);
}

/* a serigrafia de uma camada: tracos e arcos com a largura deles, fills, regioes e textos (o texto
   pela geometria do Gerber: contorno exato quando ha, senao a fonte do hub pela tinta) */
function pintaSerigrafia(pg, eb, camada, cor, o) {
  const G = Ger();
  pg.corTraco(cor).corFundo(cor).pontas('redonda');
  const porLargura = new Map();
  for (const k of ['silk', 'lines', 'tracks', 'arcs']) for (const s of (eb[k] || [])) {
    if (!s || s.layer !== camada || s.keepout) continue;
    const w = isNum(s.w) && s.w > 0 ? s.w : 0.1;
    if (!porLargura.has(w)) porLargura.set(w, []);
    porLargura.get(w).push(s);
  }
  for (const [w, lista] of porLargura) {
    pg.espessura(w);
    let n = 0;
    for (const s of lista) { if (tracoLinha(pg, s)) n++; if (n >= 200) { pg.traca(); n = 0; } }
    if (n) pg.traca();
  }
  for (const f of (eb.fills || [])) if (f && f.layer === camada && !f.keepout) { caminhoFill(pg, f); pg.preenche(false); }
  for (const g of (eb.regions || [])) if (g && g.layer === camada && !g.keepout) { caminhoRegiao(pg, g); pg.preenche(true); }
  for (const t of (eb.texts || [])) {
    if (!t || t.layer !== camada || t.hidden) continue;
    if (t.designator && o.designators !== 'serigrafia') continue;
    let geo = null;
    try { geo = G.geometriaTexto(t); } catch (_) { geo = null; }
    if (!geo) continue;
    if (geo.regioes) {
      if (!geo.regioes.length) continue;
      for (const q of geo.regioes) pg.poligono(q.pts);
      pg.preenche(true);
    } else if (geo.tracos && geo.tracos.length) {
      pg.espessura(geo.w > 0 ? geo.w : 0.15);
      for (const s of geo.tracos) { if (s.length === 1) pg.move(s[0][0], s[0][1]).reta(s[0][0] + 1e-4, s[0][1]); else pg.polilinha(s); }
      pg.traca();
    }
  }
}

/* ============================== vistas ============================== */

/* a matriz placa -> folha: (px, py) e o canto de baixo a esquerda da vista; a de baixo espelha X */
function matrizVista(bb, s, lado, px, py) {
  return lado === 'bottom' ? [-s, 0, 0, s, px + s * bb.x2, py - s * bb.y1] : [s, 0, 0, s, px - s * bb.x1, py - s * bb.y1];
}
const aplica = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];

const COR = {
  traco: '#000000',
  pastilhaSmd: '#00b6f0',     /* SmdPadsColor do Layout.PCBDwf (scRGB 0; 0,434; 0,871) */
  pastilhaTh: '#94d050',      /* ThroughHolePadsColor (scRGB 0,287; 0,631; 0,080) */
  corpo: '#000000',
};
const REAL = { mascara: '#0e5a2c', cobreSob: '#2e8a47', ouro: '#d8a83e', fr4: '#a39257', silk: '#f4f4ee' };   /* hub-gerberview REAL */
const FURO_MIN = 1.5;          /* MinimumHoleDiameter 5,669 DIP do Layout.PCBDwf */
const LARG_CONTORNO = 0.2;     /* LineStyle 2/3 do template: 0,7559 DIP */

/* vista de montagem (Draftsman "BoardAssemblyView"): tudo preto no branco */
function pintaMontagem(pg, eb, lado, bb, s, px, py, o, avisos) {
  const M = matrizVista(bb, s, lado, px, py);
  pg.salva();
  pg.matriz(M[0], M[1], M[2], M[3], M[4], M[5]);
  /* corpo do componente */
  if (o.corpo !== 'nao') {
    const objs = o.corpo === 'caixa' ? [] : objetosDeCorpo(eb, lado);
    const usaCaixa = o.corpo === 'caixa' || (o.corpo === 'auto' && !objs.length);
    if (o.corpo === 'mecanica' && !objs.length && lado === 'top') avisos.push('corpo: a placa não tem camada mecânica de 3D Body/Courtyard com desenho — a vista sai sem o corpo dos componentes.');
    pg.corTraco(COR.corpo).corFundo(COR.corpo).pontas('redonda').espessura(LARG_CONTORNO * 0.75 / s);
    if (usaCaixa) {
      let n = 0;
      for (const c of (eb.components || [])) {
        if (!c || ladoDe(c.layer) !== lado || !c.bbox) continue;
        const b = c.bbox;
        if (![b.x1, b.y1, b.x2, b.y2].every(isNum)) continue;
        pg.retangulo(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); n++;
      }
      if (n) pg.traca();
    } else {
      for (const it of objs) {
        if (it.tipo === 'fill') { caminhoFill(pg, it.o); pg.traca(); }
        else if (it.tipo === 'regiao') { caminhoRegiao(pg, it.o); pg.traca(); }
        else if (tracoLinha(pg, it.o)) pg.traca();
      }
    }
  }
  /* pads (opcional, como o ShowSmdPads/ShowThroughHolePads do Draftsman) */
  if (o.pads) {
    for (const th of [false, true]) {
      pg.corFundo(th ? COR.pastilhaTh : COR.pastilhaSmd);
      for (const p of todosPads(eb)) {
        if (ehTH(p) !== th || !padNoLadoQ(p, lado)) continue;
        caminhoPrim(pg, padPrim(padNoLado(p, lado)));
        pg.preenche(false);
      }
    }
  }
  /* serigrafia */
  pintaSerigrafia(pg, eb, OVERLAY[lado], COR.traco, o);
  /* furos grandes e recortes */
  pg.corTraco(COR.traco).espessura(LARG_CONTORNO * 0.75 / s);
  if (o.furos) {
    for (const p of todosPads(eb)) {
      if (!ehTH(p) || !(p.drill >= FURO_MIN)) continue;
      let pr = null;
      try { pr = Las().drillPrim(p, true); } catch (_) { pr = { k: 'disc', x: p.x, y: p.y, r: p.drill / 2 }; }
      caminhoPrim(pg, pr); pg.traca();
    }
    for (const v of (eb.vias || [])) if (v && v.drill >= FURO_MIN) { pg.circulo(v.x, v.y, v.drill / 2); pg.traca(); }
  }
  /* contorno */
  pg.espessura(LARG_CONTORNO / s);
  for (const k of recortes(eb)) { pg.poligono(k); }
  caminhoDaPlaca(pg, eb, bb);
  pg.traca();
  pg.restaura();
  /* designator no centro do componente, sempre legivel (fora da matriz espelhada) */
  if (o.designators === 'centro') {
    for (const c of (eb.components || [])) {
      if (!c || !c.ref || ladoDe(c.layer) !== lado) continue;
      const b = c.bbox, cx = b ? (b.x1 + b.x2) / 2 : c.x, cy = b ? (b.y1 + b.y2) / 2 : c.y;
      if (!isNum(cx) || !isNum(cy)) continue;
      const q = aplica(M, cx, cy);
      const larg = b ? Math.abs(b.x2 - b.x1) * s : 10, alt = b ? Math.abs(b.y2 - b.y1) * s : 10;
      const vert = alt > larg * 1.4;
      const disp = (vert ? alt : larg) * 0.85, porTam = PdfW().larguraTexto(c.ref, 'Helvetica', 1);
      /* MinAutoFitFontSize 5 / MaxAutoFitFontSize 12 do Draftsman (em tam do Draftsman) */
      const tam = Math.max(tamDraftsman(5), Math.min(tamDraftsman(12), disp / porTam, (vert ? larg : alt) * 0.7));
      pg.texto(q[0], q[1], c.ref, { fonte: 'Helvetica', tam, cor: '#000000', alinha: 'centro', base: 'meio', rot: vert ? 90 : 0 });
    }
  }
}

/* vista realista (vetorial): mascara verde dentro do contorno, cobre sob a mascara, pads em ouro,
   serigrafia branca, furos e recortes vazados - as cores e a ordem do hub-gerberview */
function pintaRealista(pg, eb, lado, bb, s, px, py) {
  const M = matrizVista(bb, s, lado, px, py);
  pg.salva();
  pg.matriz(M[0], M[1], M[2], M[3], M[4], M[5]);
  /* tudo recortado pela placa */
  caminhoDaPlaca(pg, eb, bb);
  pg.recorta(true);
  pg.corFundo(REAL.mascara);
  caminhoDaPlaca(pg, eb, bb);
  pg.preenche(true);
  /* cobre sob a mascara */
  const cobre = COBRE[lado];
  pg.corTraco(REAL.cobreSob).corFundo(REAL.cobreSob).pontas('redonda');
  for (const k of ['tracks', 'arcs']) for (const t of (eb[k] || [])) {
    if (!t || t.layer !== cobre || !(t.w > 0)) continue;
    pg.espessura(t.w);
    if (tracoLinha(pg, k === 'arcs' ? Object.assign({ kind: 'arc' }, t) : t)) pg.traca();
  }
  for (const f of (eb.fills || [])) if (f && f.layer === cobre) { caminhoFill(pg, f); pg.preenche(false); }
  for (const g of (eb.regions || [])) if (g && g.layer === cobre && !g.keepout) { caminhoRegiao(pg, g); pg.preenche(true); }
  for (const v of (eb.vias || [])) if (v && v.size > 0) { pg.circulo(v.x, v.y, v.size / 2); pg.preenche(false); }
  /* serigrafia, depois o cobre exposto por cima (a mascara corta a tinta na abertura) */
  pintaSerigrafia(pg, eb, OVERLAY[lado], REAL.silk, { designators: 'serigrafia' });
  pg.corFundo(REAL.ouro);
  for (const p of todosPads(eb)) {
    if (!padNoLadoQ(p, lado)) continue;
    caminhoPrim(pg, padPrim(padNoLado(p, lado)));
    pg.preenche(false);
  }
  /* furos (pad e via) e recortes: o branco da folha */
  pg.corFundo('#ffffff');
  for (const p of todosPads(eb)) {
    if (!ehTH(p) || !(p.drill > 0)) continue;
    let pr = null;
    try { pr = Las().drillPrim(p, true); } catch (_) { pr = { k: 'disc', x: p.x, y: p.y, r: p.drill / 2 }; }
    caminhoPrim(pg, pr); pg.preenche(false);
  }
  for (const v of (eb.vias || [])) if (v && v.drill > 0) { pg.circulo(v.x, v.y, v.drill / 2); pg.preenche(false); }
  for (const k of recortes(eb)) { pg.poligono(k); pg.preenche(false); }
  pg.restaura();
}

/* ============================== folha e carimbo ============================== */

/* tamanho do Draftsman -> corpo da fonte em mm. Medido no template: a caixa de um texto de
   tamanho 10 tem 2,54 mm (= tam/100 pol) e e a altura ascendente + descendente da Times New
   Roman (1,107 em); a largura bate com o AFM ("DESEN." 3472/1000 em -> 7,80 mm de caixa) */
function tamDraftsman(t, fonte) { return t * 0.254 / (fonte === 'Times-Roman' ? 1.107 : 1.117); }
const FONTE_PDF = f => /times/i.test(f || '') ? 'Times-Roman' : /black|bold/i.test(f || '') ? 'Helvetica-Bold' : 'Helvetica';

/* largura maxima de cada campo dentro da celula dele no carimbo (mm), medida na geometria */
const LARG_CAMPO = {
  '=Arquivo': 38, '=Revisao': 22, '=SheetNumber': 3, '=SheetTotal': 3, '=Formato': 9.5, '=Escala': 24,
  '=Desenhista_DiEletrons': 34.5, '=Verificador_DiEletrons': 34.5, '=Aprovador_DiEletrons': 34.5,
  '=Data_desenho': 21, '=Data_verificacao': 21, '=Data_aprovacao': 21,
  '=Equipamento_linha_um': 55, '=Equipamento_linha_dois': 55, '=Equipamento_linha_unica': 55,
  '=Desenho_linha_um': 51, '=Desenho_linha_dois': 51, '=Desenho_linha_unica': 51,
};

function dataCurta(d) {
  const z = v => ('0' + v).slice(-2);
  return z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + z(d.getFullYear() % 100);
}
function baseDoPcbDoc(eb) {
  return String((eb && eb.source) || '').split(/[\\/]/).pop().replace(/\.pcbdoc(\.zip)?$/i, '');
}
/* a revisao que a serigrafia da placa ja diz ("REV. C" -> "REV.C") */
function revisaoDaPlaca(eb) {
  for (const t of ((eb && eb.texts) || [])) {
    const m = /\bREV\.?\s*([A-Z0-9]{1,3})\b/i.exec(String((t && t.text) || ''));
    if (m) return 'REV.' + m[1].toUpperCase();
  }
  return '';
}
function duasLinhas(v) {
  const L = String(v == null ? '' : v).split(/\r\n|\r|\n/).map(x => x.trim()).filter(Boolean);
  return L.length >= 2 ? { um: L[0], dois: L.slice(1).join(' '), unica: '' } : { um: '', dois: '', unica: L[0] || '' };
}

/* os campos do carimbo: o que o chamador mandou, senao o que o projeto da */
function camposCarimbo(eb, opcoes) {
  const o = opcoes || {}, c = o.carimbo || {}, d = o.data instanceof Date ? o.data : new Date();
  const base = baseDoPcbDoc(eb);
  const tem = k => Object.prototype.hasOwnProperty.call(c, k) && c[k] != null;
  return {
    arquivo: tem('arquivo') ? String(c.arquivo) : base,
    revisao: tem('revisao') ? String(c.revisao) : revisaoDaPlaca(eb),
    equipamento: tem('equipamento') ? String(c.equipamento) : '',
    desenho: tem('desenho') ? String(c.desenho) : (base ? 'LAYOUT ' + base : 'LAYOUT'),
    desenhista: tem('desenhista') ? String(c.desenhista) : '',
    dataDesenho: tem('dataDesenho') ? String(c.dataDesenho) : dataCurta(d),
    verificador: tem('verificador') ? String(c.verificador) : '',
    dataVerificacao: tem('dataVerificacao') ? String(c.dataVerificacao) : '',
    aprovador: tem('aprovador') ? String(c.aprovador) : '',
    dataAprovacao: tem('dataAprovacao') ? String(c.dataAprovacao) : '',
    formato: tem('formato') ? String(c.formato) : (o.formato === 'A3' ? 'A3' : 'A4'),
    escala: tem('escala') ? String(c.escala) : '',
  };
}

function valorDoParametro(nome, campos, fl, total) {
  const eq = duasLinhas(campos.equipamento), de = duasLinhas(campos.desenho);
  switch (nome) {
    case '=Arquivo': return campos.arquivo;
    case '=Revisao': return campos.revisao;
    case '=Formato': return campos.formato;
    case '=Escala': return campos.escala;
    case '=Desenhista_DiEletrons': return campos.desenhista;
    case '=Verificador_DiEletrons': return campos.verificador;
    case '=Aprovador_DiEletrons': return campos.aprovador;
    case '=Data_desenho': return campos.dataDesenho;
    case '=Data_verificacao': return campos.dataVerificacao;
    case '=Data_aprovacao': return campos.dataAprovacao;
    case '=Equipamento_linha_um': return eq.um;
    case '=Equipamento_linha_dois': return eq.dois;
    case '=Equipamento_linha_unica': return eq.unica;
    case '=Desenho_linha_um': return de.um;
    case '=Desenho_linha_dois': return de.dois;
    case '=Desenho_linha_unica': return de.unica;
    /* o template poe =SheetTotal ANTES da barra e =SheetNumber depois; o PDF le "folha/total",
       que e o que o FL. quer dizer, entao os dois valores trocam de lugar */
    case '=SheetTotal': return String(fl);
    case '=SheetNumber': return String(total);
  }
  return '';
}

/* um texto do template na sua caixa (x, y = canto de baixo; ha/va do Draftsman) */
function textoNaCaixa(pg, t, s, dx, dy, larguraMax) {
  const fonte = FONTE_PDF(t.fonte);
  let tam = tamDraftsman(t.tam, fonte);
  const lw = PdfW().larguraTexto(s, fonte, tam);
  if (larguraMax > 0 && lw > larguraMax) tam *= larguraMax / lw;
  const asc = fonte === 'Times-Roman' ? 0.891 : 0.905, desc = fonte === 'Times-Roman' ? 0.216 : 0.212;
  /* linha de base: a caixa e asc + desc do tamanho original; centrado nela quando encolheu */
  const yBase = t.y + dy + t.h / 2 - (asc - desc) / 2 * tam;
  const x = t.ha === 'Center' ? t.x + dx + t.w / 2 : t.ha === 'Right' ? t.x + dx + t.w : t.x + dx;
  pg.texto(x, yBase, s, { fonte, tam, cor: t.cor || '#000000', alinha: t.ha === 'Center' ? 'centro' : t.ha === 'Right' ? 'dir' : 'esq' });
}

/* moldura com as zonas: borda na margem de 5 mm; letras nas colunas e numeros nas linhas, contando
   do canto de cima a esquerda (ZoneOrigin TopLeft, ZoneLetterPosition Columns do template) */
function pintaMoldura(pg, Wf, Hf, margem) {
  const cols = Wf > 300 ? 8 : 6, lins = Wf > 300 ? 6 : 4;
  pg.corTraco('#000000').espessura(LARG_CONTORNO).pontas('reta');
  pg.retangulo(margem, margem, Wf - 2 * margem, Hf - 2 * margem).traca();
  const cw = (Wf - 2 * margem) / cols, lh = (Hf - 2 * margem) / lins, tam = 2.6, meio = margem / 2;
  pg.espessura(LARG_CONTORNO * 0.75);
  for (let i = 1; i < cols; i++) {
    const x = margem + i * cw;
    pg.move(x, 0.8).reta(x, margem).move(x, Hf - margem).reta(x, Hf - 0.8);
  }
  for (let j = 1; j < lins; j++) {
    const y = margem + j * lh;
    pg.move(0.8, y).reta(margem, y).move(Wf - margem, y).reta(Wf - 0.8, y);
  }
  pg.traca();
  for (let i = 0; i < cols; i++) {
    const x = margem + (i + 0.5) * cw, L = String.fromCharCode(65 + i);
    pg.texto(x, meio, L, { fonte: 'Helvetica', tam, alinha: 'centro', base: 'meio', cor: '#000000' });
    pg.texto(x, Hf - meio, L, { fonte: 'Helvetica', tam, alinha: 'centro', base: 'meio', cor: '#000000' });
  }
  for (let j = 0; j < lins; j++) {
    const y = Hf - margem - (j + 0.5) * lh, N = String(j + 1);
    pg.texto(meio, y, N, { fonte: 'Helvetica', tam, alinha: 'centro', base: 'meio', cor: '#000000' });
    pg.texto(Wf - meio, y, N, { fonte: 'Helvetica', tam, alinha: 'centro', base: 'meio', cor: '#000000' });
  }
}

/* o carimbo do template, ancorado no canto de baixo a direita da folha (no A3 ele anda junto) */
function pintaCarimbo(pg, logo, campos, fl, total, Wf) {
  const C = Car(), dx = Wf - C.folha.w, dy = 0;
  pg.corTraco('#000000').pontas('reta');
  for (const r of C.retangulos) { pg.espessura(r[4] || LARG_CONTORNO); pg.retangulo(r[0] + dx, r[1] + dy, r[2], r[3]).traca(); }
  for (const l of C.linhas) { pg.espessura(l[4] || LARG_CONTORNO); pg.move(l[0] + dx, l[1] + dy).reta(l[2] + dx, l[3] + dy).traca(); }
  C.imagens.forEach((im, i) => { if (logo[i]) pg.imagem(logo[i], im.x + dx, im.y + dy, im.w, im.h); });
  for (const t of C.textos) {
    const ehParam = t.s.charAt(0) === '=';
    const s = ehParam ? valorDoParametro(t.s, campos, fl, total) : t.s;
    if (!s) continue;
    textoNaCaixa(pg, t, s, dx, dy, ehParam ? (LARG_CAMPO[t.s] || 0) : 0);
  }
}

/* quadro OBS: retangulo, "OBS:." no canto (Arial Narrow 12 do Layout.PCBDwf) e o texto quebrado */
function pintaObs(pg, x, y, w, h, texto) {
  pg.corTraco('#000000').espessura(LARG_CONTORNO).pontas('reta');
  pg.retangulo(x, y, w, h).traca();
  const tam = tamDraftsman(12, 'Helvetica') * 0.82;      /* a Narrow e ~82% da Arial */
  pg.texto(x + 2, y + h - 2 - tam * 0.72, 'OBS:.', { fonte: 'Helvetica', tam, cor: '#000000' });
  const linhas = quebra(String(texto || ''), 'Helvetica', tam, w - 6);
  let yy = y + h - 4 - tam * 1.9;
  for (const L of linhas) { if (yy < y + 2) break; pg.texto(x + 4, yy, L, { fonte: 'Helvetica', tam, cor: '#000000' }); yy -= tam * 1.3; }
}
function quebra(txt, fonte, tam, larg) {
  const out = [], W = PdfW();
  for (const par of txt.split(/\r\n|\r|\n/)) {
    let cur = '';
    for (const p of par.split(/\s+/).filter(Boolean)) {
      const tent = cur ? cur + ' ' + p : p;
      if (cur && W.larguraTexto(tent, fonte, tam) > larg) { out.push(cur); cur = p; } else cur = tent;
    }
    out.push(cur);
  }
  return out;
}

/* ============================== plano das folhas ============================== */

function normaliza(opcoes) {
  const o = Object.assign({}, opcoes || {});
  o.formato = o.formato === 'A3' ? 'A3' : 'A4';
  const f = o.folhas || {};
  o.folhas = { cima: f.cima !== false, baixo: f.baixo !== false, realista: !!f.realista };
  o.juntas = o.juntas === true || o.juntas === false ? o.juntas : 'auto';
  o.titulos = o.titulos !== false;
  o.legenda = typeof o.legenda === 'string' ? o.legenda : 'View from =ViewSide side (Scale =ViewScale)';
  o.corpo = ['auto', 'mecanica', 'caixa', 'nao'].indexOf(o.corpo) >= 0 ? o.corpo : 'auto';
  o.pads = !!o.pads;
  o.designators = ['serigrafia', 'centro', 'nao'].indexOf(o.designators) >= 0 ? o.designators : 'serigrafia';
  o.furos = o.furos !== false;
  const obs = o.obs;
  o.obs = typeof obs === 'string' ? { cima: obs, baixo: obs, realista: obs } : Object.assign({ cima: '', baixo: '', realista: '' }, obs || {});
  for (const k of ['cima', 'baixo', 'realista']) o.obs[k] = String(o.obs[k] || '').trim();
  return o;
}

/* a area de desenho de uma folha (sem o carimbo, o titulo e a legenda) */
const OBS_LARG = 78;
function areaDeVista(Wf, Hf, o, comObs) {
  const x1 = 12, x2 = Wf - 12 - (comObs ? OBS_LARG + 6 : 0);
  const y1 = 32 + (o.legenda ? 6 : 0), y2 = Hf - 12 - (o.titulos ? 16 : 0);
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
}

/* -> { folhas:[{tipo:'cima'|'baixo'|'juntas'|'realista', lados, arranjo}], escala, avisos } */
function plano(eb, opcoes) {
  const o = normaliza(opcoes), avisos = [];
  const FL = PdfW().FOLHAS[o.formato], bb = caixaDaPlaca(eb);
  const bw = bb.x2 - bb.x1, bh = bb.y2 - bb.y1;
  const lados = [];
  if (o.folhas.cima) lados.push('top');
  if (o.folhas.baixo) lados.push('bottom');
  const fixa = o.escala && o.escala !== 'auto' ? leEscala(o.escala) : null;
  if (o.escala && o.escala !== 'auto' && !fixa) avisos.push('escala "' + o.escala + '" não entendida: vale a automática.');
  const temObs = k => !!o.obs[k];
  /* uma vista por folha */
  const a1 = areaDeVista(FL.w, FL.h, o, temObs('cima') || temObs('baixo'));
  const s1 = escalaQueCabe(bw, bh, a1.w, a1.h);
  /* as duas numa folha: lado a lado ou uma sobre a outra */
  const a2 = areaDeVista(FL.w, FL.h, Object.assign({}, o, { titulos: false }), temObs('cima') || temObs('baixo'));
  const lado = escalaQueCabe(bw, bh, (a2.w - 14) / 2, a2.h);
  const sobre = escalaQueCabe(bw, bh, a2.w, (a2.h - 10) / 2);
  const s2 = Math.max(lado, sobre), arranjo2 = lado >= sobre ? 'lado' : 'sobre';
  let juntas = lados.length === 2 && (o.juntas === true || (o.juntas === 'auto' && s2 >= s1 - 1e-9));
  let s = juntas ? s2 : s1;
  if (fixa) {
    s = fixa;
    if (lados.length === 2 && o.juntas !== false) {
      const cabe2 = arranjo2 === 'lado' ? (bw * s <= (a2.w - 14) / 2 + 1e-9 && bh * s <= a2.h + 1e-9) : (bw * s <= a2.w + 1e-9 && bh * s <= (a2.h - 10) / 2 + 1e-9);
      juntas = o.juntas === true || cabe2;
    }
    const a = juntas ? a2 : a1;
    if (bw * s > a.w + 1e-9 || bh * s > a.h + 1e-9) avisos.push('na escala ' + rotuloEscala(s) + ' a placa (' + fmt(bw) + ' x ' + fmt(bh) + ' mm) não cabe na área de desenho da ' + o.formato + ': a vista passa da moldura.');
  }
  if (!fixa && ESCALAS.indexOf(s) < 0) avisos.push('a placa não cabe nem em 1:10 na ' + o.formato + ': escala livre ' + rotuloEscala(s) + '.');
  const folhas = [];
  if (juntas) folhas.push({ tipo: 'juntas', lados, arranjo: arranjo2 });
  else for (const l of lados) folhas.push({ tipo: l === 'top' ? 'cima' : 'baixo', lados: [l] });
  if (o.folhas.realista) folhas.push({ tipo: 'realista', lados: ['top', 'bottom'] });
  if (!folhas.length) avisos.push('nenhuma folha escolhida: o PDF sai só com o carimbo.');
  return { folhas, escala: s, rotulo: rotuloEscala(s), avisos, bb, opcoes: o };
}

/* ============================== montagem ============================== */

function legendaDe(o, lado, s) {
  return o.legenda.replace(/=ViewSide/g, lado === 'bottom' ? 'Bottom' : 'Top').replace(/=ViewScale/g, rotuloEscala(s));
}

function monta(eb, opcoes) {
  if (!eb || typeof eb !== 'object') throw new Error('HubPcbPdf: falta a placa (effectiveBoard)');
  const P = plano(eb, opcoes), o = P.opcoes, avisos = P.avisos.slice();
  const W = PdfW(), FL = W.FOLHAS[o.formato], bb = P.bb, s = P.escala;
  const bw = bb.x2 - bb.x1, bh = bb.y2 - bb.y1;
  const campos = camposCarimbo(eb, o);
  if (!campos.escala) campos.escala = P.rotulo;
  const base = baseDoPcbDoc(eb) || 'placa';
  const doc = W.novo({ titulo: 'LO - ' + base, assunto: 'Layout (montagem) — ' + base, criador: 'EletricHUB (hub-pcbpdf)', autor: campos.desenhista || undefined, data: o.data });
  const logo = Car().imagens.map(im => {
    try { return doc.imagem({ w: im.pw, h: im.ph, flate: base64(im.rgbFlate) }); } catch (_) { return null; }
  });
  if (!(eb.board && Array.isArray(eb.board.outline) && eb.board.outline.length)) avisos.push('a placa não tem contorno (board.outline): a vista usa a caixa da placa.');
  if (o.corpo === 'auto' && !objetosDeCorpo(eb, 'top').length && !objetosDeCorpo(eb, 'bottom').length)
    avisos.push('a placa não traz camada mecânica de 3D Body/Courtyard: o corpo dos componentes sai como a caixa de cada um (reexporte com o ExportBoard novo para o corpo de verdade).');

  const total = Math.max(1, P.folhas.length);
  const folhas = P.folhas.length ? P.folhas : [{ tipo: 'vazia', lados: [] }];
  folhas.forEach((f, i) => {
    const pg = doc.pagina(FL.w, FL.h);
    pintaMoldura(pg, FL.w, FL.h, Car().folha.margem || 5);
    pintaCarimbo(pg, logo, campos, i + 1, total, FL.w);
    if (f.tipo === 'realista') { folhaRealista(pg, doc, eb, o, FL, bb); f.escala = null; return; }
    if (f.tipo === 'vazia') return;
    const obsTxt = f.lados.map(l => o.obs[l === 'top' ? 'cima' : 'baixo']).filter((v, k, a) => v && a.indexOf(v) === k).join('\n');
    const A = areaDeVista(FL.w, FL.h, f.tipo === 'juntas' ? Object.assign({}, o, { titulos: false }) : o, !!obsTxt);
    if (obsTxt) pintaObs(pg, FL.w - 12 - OBS_LARG, A.y1 - (o.legenda ? 6 : 0), OBS_LARG, A.y2 - A.y1 + (o.legenda ? 6 : 0), obsTxt);
    const vistas = [];
    if (f.tipo === 'juntas') {
      if (f.arranjo === 'lado') {
        const cw = (A.w - 14) / 2;
        f.lados.forEach((l, k) => vistas.push({ lado: l, cx: A.x1 + cw / 2 + k * (cw + 14), cy: (A.y1 + A.y2) / 2 }));
      } else {
        const ch = (A.h - 10) / 2;
        f.lados.forEach((l, k) => vistas.push({ lado: l, cx: (A.x1 + A.x2) / 2, cy: A.y2 - ch / 2 - k * (ch + 10) }));
      }
    } else vistas.push({ lado: f.lados[0], cx: (A.x1 + A.x2) / 2, cy: (A.y1 + A.y2) / 2 });
    for (const v of vistas) {
      const px = v.cx - bw * s / 2, py = v.cy - bh * s / 2;
      pintaMontagem(pg, eb, v.lado, bb, s, px, py, o, avisos);
      if (o.legenda) pg.texto(px, py - 3, legendaDe(o, v.lado, s), { fonte: 'Helvetica', tam: tamDraftsman(14, 'Helvetica'), cor: '#000000', base: 'topo' });
    }
    if (o.titulos && f.tipo !== 'juntas') {
      const t = f.lados[0] === 'bottom' ? 'BOTTOM VIEW' : 'TOP VIEW';
      pg.texto(FL.w / 2, FL.h - 12 - 8, t, { fonte: 'Helvetica-Bold', tam: tamDraftsman(25, 'Helvetica') * 1.05, cor: '#000000', alinha: 'centro', base: 'meio' });
    }
    f.escala = s;
  });
  return { doc, folhas, escala: s, rotulo: P.rotulo, campos, avisos: unicos(avisos), nome: nomeArquivo(eb, o) };
}
function unicos(a) { return a.filter((v, i) => a.indexOf(v) === i); }

/* a folha "Realistic View": as duas faces numa coluna a esquerda, como a pagina 3 do
   Layout.PCBDwf, e os quadros OBS a direita quando houver texto */
function folhaRealista(pg, doc, eb, o, FL, bb) {
  const obs = o.obs.realista;
  const x1 = 12, x2 = obs ? 144 : FL.w - 12, y1 = 30, y2 = FL.h - 12;
  const bw = bb.x2 - bb.x1, bh = bb.y2 - bb.y1;
  const leg = 6, gap = 8;
  /* uma face sobre a outra (o template); se a placa for alta e estreita, lado a lado */
  const sSobre = Math.min((x2 - x1) / bw, ((y2 - y1) - 2 * leg - gap) / 2 / bh);
  const sLado = Math.min(((x2 - x1) - gap) / 2 / bw, ((y2 - y1) - leg) / bh);
  const sobre = sSobre >= sLado;
  const s = escalaQueCabe(bw, bh, sobre ? (x2 - x1) : ((x2 - x1) - gap) / 2, sobre ? ((y2 - y1) - 2 * leg - gap) / 2 : (y2 - y1) - leg);
  const lados = ['top', 'bottom'];
  lados.forEach((lado, k) => {
    let cx, cy;
    if (sobre) { cx = (x1 + x2) / 2; const ch = ((y2 - y1) - gap) / 2; cy = y2 - ch / 2 - k * (ch + gap) + leg / 2; }
    else { const cw = ((x2 - x1) - gap) / 2; cx = x1 + cw / 2 + k * (cw + gap); cy = (y1 + y2) / 2 + leg / 2; }
    const px = cx - bw * s / 2, py = cy - bh * s / 2;
    const r = o.realista && o.realista[lado === 'top' ? 'cima' : 'baixo'];
    if (r && (r.jpeg || r.rgb) && r.w > 0 && r.h > 0) {
      /* raster do chamador, encaixado mantendo a proporcao dentro da caixa da placa */
      const im = doc.imagem(r);
      const k2 = Math.min(bw * s / r.w, bh * s / r.h);
      pg.imagem(im, cx - r.w * k2 / 2, cy - r.h * k2 / 2, r.w * k2, r.h * k2);
    } else pintaRealista(pg, eb, lado, bb, s, px, py);
    pg.texto(px, py - 3, 'Realistic View' + (lado === 'bottom' ? ' (Bottom)' : ' (Top)'), { fonte: 'Helvetica', tam: tamDraftsman(14, 'Helvetica'), cor: '#000000', base: 'topo' });
  });
  if (obs) {
    /* os dois quadros do Layout.PCBDwf: x 149..286,5; y 33..108,9 e 120,7..195,9 (A4) */
    const dx = FL.w - 297, dy = FL.h - 210;
    pintaObs(pg, 149 + dx, 120.7 + dy, 137.5, 75.2, obs);
    pintaObs(pg, 149 + dx, 33, 137.5, 75.9 + dy, '');
  }
}

function base64(s) {
  if (typeof Buffer !== 'undefined' && Buffer.from) return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = (root.atob || atob)(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function nomeArquivo(eb, opcoes) {
  const c = (opcoes && opcoes.carimbo) || {};
  const base = (c.arquivo && String(c.arquivo).trim()) || baseDoPcbDoc(eb) || 'placa';
  /* o que a rota /api/pdf aceita no nome: ASCII, espaco e _.()+,- (acento cai na letra base) */
  const limpo = ('LO - ' + base).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 _.()+,-]+/g, '_')
    .replace(/[. ]+$/, '').slice(0, 150);
  return limpo + '.pdf';
}

function gera(eb, opcoes) {
  const o = opcoes || {};
  return monta(eb, o).doc.bytes(typeof o.deflate === 'function' ? { deflate: o.deflate } : undefined);
}
async function geraAsync(eb, opcoes) { return monta(eb, opcoes || {}).doc.bytesAsync(); }

return {
  gera, geraAsync, monta, plano, camposCarimbo, nomeArquivo,
  ESCALAS, rotuloEscala, leEscala, escalaQueCabe, caixaDaPlaca, tamDraftsman,
};
});
