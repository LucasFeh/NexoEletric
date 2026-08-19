/* AltiumPCBMirror v2 - hub-laser.js
   Gera a arte vetorial da PCB para gravacao a laser (LightBurn). Logica pura: sem DOM,
   sem canvas - roda no browser (global HubLaser) e no node (testes).

   POR QUE UNIR O COBRE: a doc do LightBurn (Fill Mode) diz que formas que se sobrepoem
   PARCIALMENTE na mesma camada de preenchimento nao gravam a area comum. Emitir as
   primitivas cruas abriria um buraco exatamente em cada junção trilha/pad. Entao o cobre
   sai daqui ja unido numa geometria so: rasteriza -> marching squares -> simplifica.

   Contrato de coordenadas: o mesmo da PCB (mm, Y para cima, relativo a origem da placa).
   Espelho e flip de Y acontecem UMA VEZ SO, na emissao do SVG. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hub-font.js'));
  else root.HubLaser = factory(root.HubFont);
})(typeof self !== 'undefined' ? self : this, function (HubFont) {
"use strict";

/* Paleta do LightBurn, indice = numero da camada (C00..C29). O import so casa
   cor -> camada com o valor EXATO, entao esta tabela nao pode ser aproximada. */
const PALETTE = [
  '#000000','#0000FF','#FF0000','#00E000','#D0D000','#FF8000','#00E0E0','#FF00FF',
  '#B4B4B4','#0000A0','#A00000','#00A000','#A0A000','#C08000','#00A0FF','#A000A0',
  '#808080','#7D87B9','#BB7784','#4A6FE3','#D33F6A','#8CD78C','#F0B98D','#F6C4E1',
  '#FA9ED4','#500A78','#B45A00','#004754','#86FA88','#FFDB66',
];
const ci2hex = ci => PALETTE[(ci|0) % PALETTE.length] || PALETTE[0];
const ciName = ci => 'C' + String(ci|0).padStart(2, '0');

/* Atalho historico das tres primeiras (cobre C00, serigrafia C01, contorno C02). */
const LB = { copper:PALETTE[0], silk:PALETTE[1], outline:PALETTE[2] };

/* O que uma camada pode carregar. `fill` e a unica de preenchimento; o resto e traco,
   que e como o laser faz passada de limpeza e de corte. */
const SOURCES = [
  { id:'fill',       label:'retirada do cobre (preenchimento)', mode:'fill' },
  { id:'copperEdge', label:'contorno do cobre (limpeza)',       mode:'line' },
  { id:'padEdge',    label:'contorno só de pads e vias',        mode:'line' },
  { id:'drills',     label:'furos (diâmetro real da broca)',    mode:'line' },
  { id:'silk',       label:'serigrafia',                        mode:'auto' },
  { id:'board',      label:'borda da placa (corte)',            mode:'line' },
];

/* Parametros de corte de uma camada. `type` e o MODO: 'Scan' = preencher, 'Cut' = linha.
   frequency em kHz e qPulse em ns, como aparecem na UI do LightBurn para fibra/MOPA;
   a conversao para a unidade do arquivo acontece na emissao, num lugar so.
   `globalPasses` = "Passagens Globais" da UI galvo (repete a camada inteira N vezes);
   nao confundir com o "Numero de Passagens" da sub-camada, que a bancada nao usa. */
function cutDefaults(){
  return { type:'Cut', speed:100, maxPower:100, frequency:40, globalPasses:1, qPulse:200,
           bidir:false, crossHatch:false, angle:0, interval:0.01 };
}
/* Ate 2026-08 o campo se chamava numPasses - e saia como <numPasses>, que no galvo e o
   campo DA SUB-CAMADA, nao o global. Configs salvas com o nome antigo migram na leitura;
   o valor sempre significou passagens globais, so o nome estava errado. */
function migrateCut(o){
  if (!o || o.numPasses == null) return o;
  const m = Object.assign({}, o);
  if (m.globalPasses == null) m.globalPasses = m.numPasses;
  delete m.numPasses;
  return m;
}
const cutOf = (o) => Object.assign(cutDefaults(), migrateCut(o) || {});

/* Parametros efetivos de uma camada. Sem `type` explicito o modo vem da FONTE: uma
   camada de preenchimento sem configuracao tem que preencher, nao virar contorno. */
function layerCut(lay){
  const src = SOURCES.find(s => s.id === (lay && lay.src));
  const base = cutDefaults();
  if (src && src.mode === 'fill') base.type = 'Scan';
  return Object.assign(base, migrateCut((lay && lay.cut) || {}));
}

/* Perfis da bancada (2026-08-18). A retirada de cobre aparece em TRES camadas de
   proposito: sao tres passadas do mesmo preenchimento, separadas para dar para ajustar
   uma sem mexer nas outras. As duas cheias usam CUT_COBRE; a de limpeza so baixa a
   potencia, e por isso deriva de CUT_COBRE em vez de repetir os numeros. */
const CUT_FUROS    = { type:'Cut',  speed:80,   maxPower:95, frequency:40, globalPasses:16, qPulse:200 };
const CUT_COBRE    = { type:'Scan', speed:1000, maxPower:55, frequency:45, globalPasses:1,  qPulse:200,
                       bidir:true, crossHatch:true, angle:45, interval:0.05 };
const CUT_COBRE_LV = Object.assign({}, CUT_COBRE, { maxPower:20 });   /* so a potencia muda */
const CUT_BORDA    = { type:'Cut',  speed:100,  maxPower:100, frequency:40, globalPasses:20, qPulse:200 };
const CUT_CONTORNO = { type:'Scan', speed:1000, maxPower:20, frequency:45, globalPasses:1,  qPulse:200,
                       bidir:true, crossHatch:true, angle:45 };

/* Lista inicial, NA ORDEM DE EXECUCAO da bancada - o `priority` do .lbrn2 sai do indice,
   entao a ordem aqui e a ordem em que a maquina roda. A "3a passada" vir antes da "2a" e
   o processo do usuario, nao engano.
   Nada disto e fixo: a aba deixa somar, duplicar, remover e mexer em cada parametro. */
function defaultLayers(){
  return [
    { src:'drills',     ci:0, name:'furos',                            cut:cutOf(CUT_FUROS)    },
    { src:'fill',       ci:1, name:'retirada de cobre (1ª passada)',   cut:cutOf(CUT_COBRE)    },
    { src:'board',      ci:2, name:'corte da borda',                    cut:cutOf(CUT_BORDA)    },
    { src:'fill',       ci:3, name:'retirada de cobre (limpeza, 3ª passada)', cut:cutOf(CUT_COBRE_LV) },
    { src:'fill',       ci:4, name:'retirada de cobre (2ª passada)',   cut:cutOf(CUT_COBRE)    },
    { src:'copperEdge', ci:5, name:'contorno do cobre (limpeza)',      cut:cutOf(CUT_CONTORNO) },
    /* depois de pintar com tinta UV: expoe a borda do pad e da via, sem tocar na trilha */
    { src:'padEdge',    ci:6, name:'bordas de pads e vias (pós tinta UV)', cut:cutOf(CUT_CONTORNO) },
  ];
}

/* Primeiro Cxx que ninguem esta usando. Duas linhas no MESMO indice se fundem numa
   camada so no LightBurn - o que anula justamente o motivo de duplicar uma camada. */
function freeCi(layers){
  const usadas = new Set((layers || []).map(l => l && (l.ci | 0)));
  for (let i = 0; i < PALETTE.length; i++) if (!usadas.has(i)) return i;
  return PALETTE.length - 1;
}

const ARC_TOL = 0.01;      /* mm - flecha maxima ao achatar arco em segmentos */
const CHAIN_TOL = 1e-3;    /* mm - mesma tolerancia do resto do projeto */

function defaults(){
  return {
    side:'Top', invert:false, mirror:false,
    /* tracks cobre trilhas + arcos + regioes/planos: e tudo cobre roteado */
    show:{ tracks:true, pads:true, vias:true, silk:false, texts:false, outline:true },
    /* padrao = furo real: e o que parece a placa. A marca de centro continua disponivel
       para quem prefere nao perder anel de cobre e so guiar a broca. */
    holes:'drill', markD:0.3, layers:null,
    expand:0, res:0.025, margin:2, silkMode:'line',
  };
}
function norm(o){
  const d = defaults(), r = Object.assign(d, o || {});
  r.show = Object.assign(defaults().show, (o && o.show) || {});
  return r;
}

/* ═══════════════ primitivas ═══════════════
   path: polilinha com traco de largura w (pontas/juntas redondas)
   disc: circulo cheio      rect: retangulo rotacionado com raio de canto
   poly: poligono cheio                                                     */

/* achata um arco em polilinha; passo pela flecha, para o erro ficar sob ARC_TOL */
function arcPts(cx, cy, r, sa, ea){
  let a0 = sa * Math.PI/180, a1 = ea * Math.PI/180;
  while (a1 <= a0) a1 += 2*Math.PI;                 /* sentido anti-horario, como no canvas */
  const sweep = a1 - a0;
  const step = r > ARC_TOL ? 2*Math.acos(1 - ARC_TOL/r) : Math.PI/6;
  const n = Math.max(2, Math.ceil(sweep / step));
  const out = [];
  for (let i = 0; i <= n; i++){
    const a = a0 + sweep*i/n;
    out.push([cx + r*Math.cos(a), cy + r*Math.sin(a)]);
  }
  return out;
}

/* pad -> primitiva, com as MESMAS convencoes de forma do pcbframe.js (padPath) */
function padPrim(p, warnings){
  const shape = String(p.shape || 'rect').toLowerCase();
  const w = p.w || 0, h = p.h || 0, rot = p.rot || 0, hw = w/2, hh = h/2;
  if (shape === 'circle') return { k:'disc', x:p.x, y:p.y, r:Math.max(hw, hh) };
  if (shape === 'oval')   return { k:'rect', cx:p.x, cy:p.y, w, h, rot, r:Math.min(hw, hh) };
  if (shape === 'roundrect')
    return { k:'rect', cx:p.x, cy:p.y, w, h, rot,
             r:Math.min(p.radius || Math.min(hw, hh)*0.25, Math.min(hw, hh)) };
  if (shape === 'octagon'){
    const c = Math.min(hw, hh)*0.4142, co = Math.cos(rot*Math.PI/180), si = Math.sin(rot*Math.PI/180);
    const loc = [[-hw+c,-hh],[hw-c,-hh],[hw,-hh+c],[hw,hh-c],
                 [hw-c,hh],[-hw+c,hh],[-hw,hh-c],[-hw,-hh+c]];
    return { k:'poly', pts: loc.map(q => [p.x + q[0]*co - q[1]*si, p.y + q[0]*si + q[1]*co]) };
  }
  if (shape !== 'rect' && warnings) warnings.push('forma de pad desconhecida: ' + p.shape);
  return { k:'rect', cx:p.x, cy:p.y, w, h, rot, r:0 };
}

/* Furo de pad/via, com as MESMAS regras do pcbframe.drawPad:
   - so em through-hole (type 'th' ou camada Multi) - pad SMD nunca e furado;
   - a forma vem de drillshape: 'rect' e 'oblong' usam drillw x drill, o resto e circulo;
   - o furo gira por holerot, e sem holerot herda a rotacao do PAD.
   A marca de centro e sempre um ponto: e uma marca de broca, nao a forma do furo. */
/* A forma REAL do furo. Sai sempre, independente da opcao `holes`: a camada de furos
   (para furar de verdade) e a subtracao do furo no cobre sao coisas ortogonais. */
function drillPrim(src, isTH){
  const drill = src.drill;
  if (!isTH || !(drill > 0)) return null;
  const rot = (src.holerot != null ? src.holerot : src.rot) || 0;
  const dw = src.drillw;
  if (src.drillshape === 'oblong' && dw > 0)
    return { k:'rect', cx:src.x, cy:src.y, w:dw, h:drill, rot, r:Math.min(dw, drill)/2 };
  if (src.drillshape === 'rect' && dw > 0)
    return { k:'rect', cx:src.x, cy:src.y, w:dw, h:drill, rot, r:0 };
  return { k:'disc', x:src.x, y:src.y, r:drill/2 };
}

/* O que a opcao `holes` subtrai do cobre. */
function holePrim(o, src, isTH){
  if (o.holes === 'none' || !isTH || !(src.drill > 0)) return null;
  if (o.holes !== 'drill'){
    const r = (o.markD || 0) / 2;
    return r > 0 ? { k:'disc', x:src.x, y:src.y, r } : null;
  }
  return drillPrim(src, isTH);
}

/* pad PTH (Multi) aparece nos dois lados - mesmo criterio que a Neoden usa p/ SMD/PTH */
const padOnSide = (p, side) => p.layer === side || p.layer === 'Multi';
const padIsTH = p => p.type === 'th' || p.layer === 'Multi';

/* pedacos soltos do contorno -> lacos encadeados (o LightBurn corta muito melhor um
   laco fechado do que 60 pedacos independentes). Aceita polilinha, nao so segmento:
   contorno de placa real tem canto em arco, que vira varios pontos. */
function chainSegments(segs){
  const rest = segs.filter(s => s && s.length > 1), out = [];
  const same = (a, b) => Math.abs(a[0]-b[0]) <= CHAIN_TOL && Math.abs(a[1]-b[1]) <= CHAIN_TOL;
  const rev = s => s.slice().reverse();
  while (rest.length){
    let cur = rest.shift().slice();
    let grew = true;
    while (grew){
      grew = false;
      for (let i = 0; i < rest.length; i++){
        const s = rest[i], head = cur[0], tail = cur[cur.length-1];
        if      (same(tail, s[0]))            cur = cur.concat(s.slice(1));
        else if (same(tail, s[s.length-1]))   cur = cur.concat(rev(s).slice(1));
        else if (same(head, s[s.length-1]))   cur = s.slice(0, -1).concat(cur);
        else if (same(head, s[0]))            cur = rev(s).slice(0, -1).concat(cur);
        else continue;
        rest.splice(i, 1); grew = true; break;
      }
    }
    if (same(cur[0], cur[cur.length-1])) cur[cur.length-1] = cur[0].slice();  /* fecha exato */
    out.push(cur);
  }
  return out;
}

function collect(board, opts){
  const o = norm(opts), side = o.side, ov = side + 'Overlay';
  const warnings = [], copper = [], holes = [], silk = [], drills = [];
  /* pads e vias tambem em separado: a camada de destaque pos-tinta-UV expoe o anel do
     pad e da via, e nao pode arrastar a trilha junto */
  const padVia = [];
  const B = board || {};

  /* trilhas, arcos e regioes sao o mesmo grupo: e tudo cobre roteado, e separar o plano
     do traco que chega nele nunca faz sentido para gravar. Um toggle so. */
  if (o.show.tracks){
    for (const t of B.tracks || [])
      if (t.layer === side) copper.push({ k:'path', pts:[[t.x1,t.y1],[t.x2,t.y2]], w:t.w||0 });
    for (const a of B.arcs || [])
      if (a.layer === side) copper.push({ k:'path', pts:arcPts(a.cx,a.cy,a.r,a.sa,a.ea), w:a.w||0 });
    for (const g of B.regions || [])
      if (g.layer === side && (g.points||[]).length > 2)
        copper.push({ k:'poly', pts:g.points.map(q => [q[0], q[1]]) });
  }

  if (o.show.pads){
    const eat = p => {
      if (!padOnSide(p, side)) return;
      const pp = padPrim(p, warnings);
      copper.push(pp); padVia.push(pp);
      const hp = holePrim(o, p, padIsTH(p));
      if (hp) holes.push(hp);
      const dp = drillPrim(p, padIsTH(p));
      if (dp) drills.push(dp);
    };
    for (const c of B.components || []) for (const p of c.pads || []) eat(p);
    for (const p of B.freepads || []) eat(p);
  }
  if (o.show.vias)
    for (const v of B.vias || []){
      const vp = { k:'disc', x:v.x, y:v.y, r:(v.size||0)/2 };
      copper.push(vp); padVia.push(vp);
      const hp = holePrim(o, v, true);          /* via e sempre furo passante */
      if (hp) holes.push(hp);
      const dp = drillPrim(v, true);
      if (dp) drills.push(dp);
    }

  if (o.show.silk){
    for (const s of B.silk || []){
      if (s.layer !== ov) continue;
      if (s.kind === 'line') silk.push({ k:'path', pts:[[s.x1,s.y1],[s.x2,s.y2]], w:s.w||0 });
      else if (s.kind === 'arc') silk.push({ k:'path', pts:arcPts(s.cx,s.cy,s.r,s.sa,s.ea), w:s.w||0 });
      else warnings.push('silk de tipo desconhecido: ' + s.kind);
    }
  }
  if (o.show.silk && o.show.texts){
    const byRef = {};
    for (const c of B.components || []) byRef[c.ref] = c;
    for (const t of B.texts || []){
      if (t.layer !== ov) continue;
      const own = t.owner ? byRef[t.owner] : null;
      let txt = t.text || '';
      if (t.designator && own) txt = own.ref;
      if (t.comment && own) txt = own.comment || txt;
      if (!txt) continue;
      const h = t.h || 1, rot = (t.rot||0)*Math.PI/180;
      const co = Math.cos(rot), si = Math.sin(rot), mx = t.mirror ? -1 : 1;
      for (const poly of HubFont.textPolylines(txt, h))
        silk.push({ k:'path', w:t.w || h*0.13, pts: poly.map(q => {
          const lx = q[0]*mx, ly = q[1];
          return [t.x + lx*co - ly*si, t.y + lx*si + ly*co];
        }) });
    }
  }

  /* contorno de placa real tem canto em arco - achatar e obrigatorio, senao o laco nao
     fecha e o negativo queima um retangulo no lugar da placa */
  const outline = o.show.outline
    ? chainSegments((B.board && B.board.outline || []).map(s => {
        if (s.kind === 'arc') return arcPts(s.cx, s.cy, s.r, s.sa, s.ea);
        if (s.kind === 'line') return [[s.x1,s.y1],[s.x2,s.y2]];
        warnings.push('contorno de tipo desconhecido: ' + s.kind);
        return null;
      }).filter(Boolean))
    : [];

  const bb = (B.board && B.board.bbox) || null;
  return { copper, padVia, holes, drills, silk, outline,
           bbox: bb ? { x1:bb.x1, y1:bb.y1, x2:bb.x2, y2:bb.y2 } : null,
           warnings, opts:o };
}

/* ═══════════════ primitiva -> poligonos ═══════════════
   Tudo vira poligono para haver UM rasterizador so. O erro de facetar circulo fica em
   res/4 (6 um no padrao), uma ordem abaixo do spot do laser. */

function circlePts(cx, cy, r, tol){
  const n = Math.max(8, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tol/Math.max(r, tol)))));
  const out = [];
  for (let i = 0; i < n; i++){
    const a = 2*Math.PI*i/n;
    out.push([cx + r*Math.cos(a), cy + r*Math.sin(a)]);
  }
  return out;
}
function capsulePts(p0, p1, hw, tol){
  const dx = p1[0]-p0[0], dy = p1[1]-p0[1];
  if (Math.hypot(dx, dy) < 1e-9) return circlePts(p0[0], p0[1], hw, tol);
  const ang = Math.atan2(dy, dx);
  const n = Math.max(4, Math.ceil(Math.PI / (2*Math.acos(Math.max(-1, 1 - tol/Math.max(hw, tol))))));
  const out = [];
  for (let i = 0; i <= n; i++){ const a = ang - Math.PI/2 + Math.PI*i/n;
    out.push([p1[0] + hw*Math.cos(a), p1[1] + hw*Math.sin(a)]); }
  for (let i = 0; i <= n; i++){ const a = ang + Math.PI/2 + Math.PI*i/n;
    out.push([p0[0] + hw*Math.cos(a), p0[1] + hw*Math.sin(a)]); }
  return out;
}

/* offset exato de e: capsula/disco crescem o raio; poligono usa
   offset(P) = P uniao (borda de P dilatada) - que e a soma de Minkowski com o disco. */
function primPolys(pr, e, tol){
  const out = [];
  e = e || 0;
  if (pr.k === 'disc'){
    if (pr.r + e > 0) out.push(circlePts(pr.x, pr.y, pr.r + e, tol));
  } else if (pr.k === 'path'){
    const hw = (pr.w || 0)/2 + e;
    if (hw > 0){
      for (let i = 0; i < pr.pts.length - 1; i++) out.push(capsulePts(pr.pts[i], pr.pts[i+1], hw, tol));
      if (pr.pts.length === 1) out.push(circlePts(pr.pts[0][0], pr.pts[0][1], hw, tol));
      /* juntas redondas: um disco em cada vertice interno */
      for (let i = 1; i < pr.pts.length - 1; i++) out.push(circlePts(pr.pts[i][0], pr.pts[i][1], hw, tol));
    }
  } else if (pr.k === 'rect'){
    /* retangulo de canto redondo = retangulo interno dilatado pelo raio; com e, r cresce
       junto - e e por isso que o canto vivo (r=0) offsetado sai arredondado, como deve */
    const r = (pr.r || 0) + e;
    const iw = Math.max(0, pr.w - 2*(pr.r||0)), ih = Math.max(0, pr.h - 2*(pr.r||0));
    const co = Math.cos((pr.rot||0)*Math.PI/180), si = Math.sin((pr.rot||0)*Math.PI/180);
    const W = iw/2, H = ih/2;
    const loc = [[-W,-H],[W,-H],[W,H],[-W,H]];
    const box = loc.map(q => [pr.cx + q[0]*co - q[1]*si, pr.cy + q[0]*si + q[1]*co]);
    if (iw > 0 && ih > 0) out.push(box);
    if (r > 0) out.push.apply(out, primPolys({ k:'path', pts:box.concat([box[0]]), w:2*r }, 0, tol));
    else if (!(iw > 0 && ih > 0)) out.push(box);
  } else if (pr.k === 'poly'){
    out.push(pr.pts);
    if (e > 0) out.push.apply(out, primPolys({ k:'path', pts:pr.pts.concat([pr.pts[0]]), w:2*e }, 0, tol));
  }
  return out;
}

function polysBounds(polys){
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of polys) for (const q of p){
    if (q[0] < x1) x1 = q[0];  if (q[0] > x2) x2 = q[0];
    if (q[1] < y1) y1 = q[1];  if (q[1] > y2) y2 = q[1];
  }
  return x1 === Infinity ? null : { x1, y1, x2, y2 };
}

/* ═══════════════ rasterizador de cobertura (AA por scanline) ═══════════════
   cov[i] = 0..255 = fracao da celula coberta. Soma com teto: para a UNIAO isso
   aproxima o maximo por cima so dentro do sub-pixel, o que aqui e irrelevante. */

const SUB = 4;                                   /* sub-scanlines por linha de pixel */

function makeGrid(bounds, res, pad){
  const ox = bounds.x1 - pad*res, oy = bounds.y1 - pad*res;
  const W = Math.max(1, Math.ceil((bounds.x2 - bounds.x1)/res) + 2*pad);
  const H = Math.max(1, Math.ceil((bounds.y2 - bounds.y1)/res) + 2*pad);
  return { ox, oy, res, W, H, cov: new Uint8Array(W*H) };
}

function addSpan(cov, off, W, xa, xb, amt){
  if (xb <= xa) return;
  if (xa < 0) xa = 0;
  if (xb > W) xb = W;
  if (xb <= xa) return;
  let ia = Math.floor(xa), ib = Math.floor(xb);
  const put = (i, f) => {
    if (i < 0 || i >= W) return;
    const v = cov[off+i] + Math.round(amt*f);
    cov[off+i] = v > 255 ? 255 : v;
  };
  if (ia === ib){ put(ia, xb - xa); return; }
  put(ia, ia + 1 - xa);
  for (let i = ia + 1; i < ib; i++) put(i, 1);
  if (ib < W) put(ib, xb - ib);
}

/* evenodd = regra par-impar; sem ela, non-zero. A mascara da placa usa par-impar para
   que um recorte interno no contorno saia como furo, e nao preenchido. */
function signedArea(p){
  let s = 0;
  for (let i = 0; i < p.length; i++){ const a = p[i], b = p[(i+1) % p.length];
    s += a[0]*b[1] - b[0]*a[1]; }
  return s/2;
}

function rasterPolys(g, polys, evenodd){
  const amt = Math.round(255/SUB);
  /* Arestas em coordenadas de grade, com o SENTIDO NORMALIZADO para anti-horario.
     Sem isso a regra nonzero deixa de ser uniao: o board.js traz regiao horaria (1170 das
     1232 do repo), e horaria sobre anti-horaria soma zero - abre buraco branco exatamente
     na junção da trilha com o pad. A arte nao pode depender do sentido do poligono. */
  const edges = [];
  for (const raw of polys){
    const p = signedArea(raw) < 0 ? raw.slice().reverse() : raw;
    const n = p.length;
    for (let i = 0; i < n; i++){
      const a = p[i], b = p[(i+1) % n];
      const ay = (a[1]-g.oy)/g.res, by = (b[1]-g.oy)/g.res;
      if (ay === by) continue;
      edges.push({ x0:(a[0]-g.ox)/g.res, y0:ay, x1:(b[0]-g.ox)/g.res, y1:by,
                   ymin:Math.min(ay,by), ymax:Math.max(ay,by) });
    }
  }
  if (!edges.length) return;
  edges.sort((e1, e2) => e1.ymin - e2.ymin);

  let first = 0;
  const active = [];
  const xs = [];
  for (let j = 0; j < g.H; j++){
    const off = j*g.W;
    for (let s = 0; s < SUB; s++){
      const y = j + (s + 0.5)/SUB;
      while (first < edges.length && edges[first].ymin <= y) active.push(edges[first++]);
      for (let k = active.length - 1; k >= 0; k--) if (active[k].ymax <= y) active.splice(k, 1);
      if (!active.length) continue;
      xs.length = 0;
      for (const e of active){
        if (y < e.ymin || y >= e.ymax) continue;
        const t = (y - e.y0)/(e.y1 - e.y0);
        xs.push({ x: e.x0 + t*(e.x1 - e.x0), w: e.y1 > e.y0 ? 1 : -1 });
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a.x - b.x);
      let wind = 0;
      for (let k = 0; k < xs.length - 1; k++){
        wind += xs[k].w;
        const dentro = evenodd ? (k % 2 === 0) : wind !== 0;
        if (dentro) addSpan(g.cov, off, g.W, xs[k].x, xs[k+1].x, amt);
      }
    }
  }
}

/* ═══════════════ marching squares interpolado ═══════════════
   Corner (i,j) = amostra no CENTRO do pixel (i+0.5, j+0.5). Os segmentos saem
   orientados com o DENTRO a esquerda: anel externo CCW, buraco CW. */

const MS = [
  [], [['B','L']], [['R','B']], [['R','L']],
  [['T','R']], null, [['T','B']], [['T','L']],
  [['L','T']], [['B','T']], null, [['R','T']],
  [['L','R']], [['B','R']], [['L','B']], [],
];

function contours(g, level){
  const W = g.W, H = g.H, cov = g.cov, lv = level != null ? level : 127.5;
  const segs = [];
  const key = p => p[0].toFixed(6) + ',' + p[1].toFixed(6);

  for (let j = 0; j < H - 1; j++){
    for (let i = 0; i < W - 1; i++){
      const va = cov[j*W + i],       vb = cov[j*W + i + 1],
            vd = cov[(j+1)*W + i],   vc = cov[(j+1)*W + i + 1];
      const idx = (va >= lv ? 1 : 0) | (vb >= lv ? 2 : 0) | (vc >= lv ? 4 : 0) | (vd >= lv ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const cut = (v0, v1) => {
        const d = v1 - v0;
        return d === 0 ? 0.5 : Math.min(1, Math.max(0, (lv - v0)/d));
      };
      const pt = e => {
        if (e === 'B') return [i + 0.5 + cut(va, vb), j + 0.5];
        if (e === 'T') return [i + 0.5 + cut(vd, vc), j + 1.5];
        if (e === 'L') return [i + 0.5, j + 0.5 + cut(va, vd)];
        return [i + 1.5, j + 0.5 + cut(vb, vc)];                    /* 'R' */
      };
      let list = MS[idx];
      if (list === null){                                     /* sela: desempata pelo centro */
        const mid = (va + vb + vc + vd)/4 >= lv;
        list = idx === 5 ? (mid ? [['B','R'],['T','L']] : [['B','L'],['T','R']])
                         : (mid ? [['L','B'],['R','T']] : [['R','B'],['L','T']]);
      }
      for (const [ea, eb] of list) segs.push([pt(ea), pt(eb)]);
    }
  }
  if (!segs.length) return [];

  /* encadeia: os pontos de corte de celulas vizinhas sao o MESMO float, entao a
     chave por string casa exato */
  const from = new Map();
  for (const s of segs){
    const k = key(s[0]);
    if (!from.has(k)) from.set(k, []);
    from.get(k).push(s);
  }
  const used = new Set(), rings = [];
  for (const s0 of segs){
    if (used.has(s0)) continue;
    const ring = [s0[0]];
    let cur = s0;
    while (cur && !used.has(cur)){
      used.add(cur);
      ring.push(cur[1]);
      const nxt = (from.get(key(cur[1])) || []).filter(x => !used.has(x));
      cur = nxt.length ? nxt[0] : null;
    }
    if (ring.length > 3){
      ring[ring.length-1] = ring[0].slice();                    /* fecha exato */
      rings.push(ring.map(p => [g.ox + p[0]*g.res, g.oy + p[1]*g.res]));
    }
  }
  return rings;
}

/* ═══════════════ Douglas-Peucker ═══════════════ */
function simplify(pts, tol){
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length-1] = 1;
  const stack = [[0, pts.length-1]];
  while (stack.length){
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++){
      const d = len < 1e-12
        ? Math.hypot(pts[i][0]-ax, pts[i][1]-ay)
        : Math.abs(dy*pts[i][0] - dx*pts[i][1] + bx*ay - by*ax) / len;
      if (d > best){ best = d; bi = i; }
    }
    if (best > tol){ keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/* ═══════════════ union(): primitivas -> aneis ═══════════════ */
function union(prims, subs, opts){
  const o = norm(opts), tol = o.res/4, e = Math.max(0, o.expand || 0);
  const polys = [], hpolys = [];
  for (const pr of prims || []) polys.push.apply(polys, primPolys(pr, e, tol));
  /* o furo e uma ilha SEM cobre: se o cobre dilata e, a ilha encolhe e */
  for (const pr of subs || []) hpolys.push.apply(hpolys, primPolys(pr, -e, tol));
  const bounds = polysBounds(polys);
  if (!bounds) return [];

  const g = makeGrid(bounds, o.res, 3);
  rasterPolys(g, polys);
  if (hpolys.length){
    const hg = { ox:g.ox, oy:g.oy, res:g.res, W:g.W, H:g.H, cov:new Uint8Array(g.W*g.H) };
    rasterPolys(hg, hpolys);
    for (let i = 0; i < g.cov.length; i++){
      const v = g.cov[i] - hg.cov[i];
      g.cov[i] = v < 0 ? 0 : v;
    }
  }
  return ringsOf(g, o.res);
}

/* ═══════════════ art(): board.js -> aneis prontos ═══════════════ */

const MAX_PX = 40e6;       /* teto do bitmap; acima disso a resolucao cede, com aviso */

/* Douglas-Peucker a res/2: na VDCB (477 trilhas + 248 regioes) custa 0,37% de area e
   economiza 7x no arquivo (78 KB contra 559 KB sem simplificar). O que sobra de erro e
   discretizacao do raster - ~4 um de recuo no contorno, uma ordem abaixo do spot do
   laser, e e o que a opcao `expand` compensa. */
const DP_FRAC = 0.5;
function ringsOf(g, res){
  return contours(g).map(r => {
    const s = simplify(r, res*DP_FRAC);
    if (s.length > 2) s[s.length-1] = s[0].slice();
    return s;
  }).filter(r => r.length > 3);
}

function art(board, opts){
  const o = norm(opts);
  const c = collect(board, o);
  const warnings = c.warnings.slice();
  const tol = () => o.res/4;

  /* area util do arquivo = bbox da placa + margem */
  let bb = c.bbox;
  if (!bb){
    const all = [];
    for (const pr of c.copper.concat(c.silk)) all.push.apply(all, primPolys(pr, 0, o.res/4));
    bb = polysBounds(all);
    if (!bb) return { copper:[], silk:null, silkLines:null, outline:c.outline,
                      bbox:null, size:{ w:0, h:0 },
                      warnings:warnings.concat('placa sem geometria'), stats:{ rings:0, points:0 }, opts:o };
    warnings.push('board.js sem bbox da placa - usando a extensao da geometria');
  }
  const region = { x1:bb.x1 - o.margin, y1:bb.y1 - o.margin,
                   x2:bb.x2 + o.margin, y2:bb.y2 + o.margin };

  /* teto de memoria: em vez de estourar, cede resolucao e diz que cedeu */
  const px = ((region.x2-region.x1)/o.res + 4) * ((region.y2-region.y1)/o.res + 4);
  if (px > MAX_PX){
    const novo = o.res * Math.sqrt(px / MAX_PX);
    warnings.push('resolucao baixada de ' + o.res + ' para ' + novo.toFixed(4) +
                  ' mm/px para caber na memoria');
    o.res = novo;
  }

  /* mascara da placa: o contorno real, ou o bbox quando o board.js nao trouxe contorno */
  const maskPolys = c.outline.filter(r => r.length > 3);
  if (!maskPolys.length){
    warnings.push('sem contorno fechado no board.js - recortando pelo bbox da placa');
    maskPolys.push([[bb.x1,bb.y1],[bb.x2,bb.y1],[bb.x2,bb.y2],[bb.x1,bb.y2]]);
  }

  const gm = makeGrid(region, o.res, 2);
  rasterPolys(gm, maskPolys, true);

  /* cobre, com furos subtraidos e expand aplicado */
  const e = Math.max(0, o.expand || 0);
  const gc = makeGrid(region, o.res, 2);
  const cPolys = [];
  for (const pr of c.copper) cPolys.push.apply(cPolys, primPolys(pr, e, tol()));
  rasterPolys(gc, cPolys);
  if (c.holes.length){
    const gh = makeGrid(region, o.res, 2);
    const hPolys = [];
    for (const pr of c.holes) hPolys.push.apply(hPolys, primPolys(pr, -e, tol()));
    rasterPolys(gh, hPolys);
    for (let i = 0; i < gc.cov.length; i++){ const v = gc.cov[i] - gh.cov[i]; gc.cov[i] = v < 0 ? 0 : v; }
  }

  /* O cobre recortado pela placa: e o contorno que a camada de LIMPEZA usa, e ele segue
     o cobre nos dois modos - o negativo inverte o preenchimento, nao a borda do traco. */
  for (let i = 0; i < gc.cov.length; i++) gc.cov[i] = Math.min(gc.cov[i], gm.cov[i]);
  const copperEdge = ringsOf(gc, o.res);

  /* Contorno so de pads e vias, mesmo caminho do cobre (recorte pela placa e furo ja
     descontado). So roda quando alguma camada pede: e mais uma rasterizacao inteira. */
  let padEdge = [];
  const querPadEdge = !o.layers || o.layers.some(l => l && l.src === 'padEdge');
  if (querPadEdge && c.padVia.length){
    const gp = makeGrid(region, o.res, 2);
    const pPolys = [];
    for (const pr of c.padVia) pPolys.push.apply(pPolys, primPolys(pr, e, tol()));
    rasterPolys(gp, pPolys);
    if (c.holes.length){
      const gph = makeGrid(region, o.res, 2);
      const hp2 = [];
      for (const pr of c.holes) hp2.push.apply(hp2, primPolys(pr, -e, tol()));
      rasterPolys(gph, hp2);
      for (let i = 0; i < gp.cov.length; i++){ const v = gp.cov[i] - gph.cov[i]; gp.cov[i] = v < 0 ? 0 : v; }
    }
    for (let i = 0; i < gp.cov.length; i++) gp.cov[i] = Math.min(gp.cov[i], gm.cov[i]);
    padEdge = ringsOf(gp, o.res);
  }

  /* Negativo = placa MENOS cobre, do MESMO bitmap - e essa a razao de ter rasterizado. */
  let copper = copperEdge;
  if (o.invert){
    for (let i = 0; i < gc.cov.length; i++) gc.cov[i] = Math.max(0, gm.cov[i] - gc.cov[i]);
    copper = ringsOf(gc, o.res);
  }

  /* serigrafia: centerline (o laser traça o eixo) ou largura real (mesma uniao do cobre) */
  let silk = null, silkLines = null;
  if (c.silk.length){
    if (o.silkMode === 'fill'){
      const gs = makeGrid(region, o.res, 2);
      const sPolys = [];
      for (const pr of c.silk) sPolys.push.apply(sPolys, primPolys(pr, 0, tol()));
      rasterPolys(gs, sPolys);
      silk = ringsOf(gs, o.res);
    } else {
      silkLines = c.silk.map(pr => pr.pts);
    }
  }

  const pts = a => (a || []).reduce((s, r) => s + r.length, 0);
  return {
    copper, copperEdge, padEdge, drills:c.drills, silk, silkLines, outline:c.outline,
    bbox: region, size:{ w:region.x2-region.x1, h:region.y2-region.y1 },
    warnings, opts:o,
    stats:{ rings: copper.length + (silk ? silk.length : 0),
            points: pts(copper) + pts(silk) + pts(silkLines) + pts(c.outline) },
  };
}

/* ═══════════════ emissao ═══════════════ */

/* board (mm, Y p/ cima) -> SVG (mm, Y p/ baixo, origem no canto da area util).
   Exportado porque a previa da aba usa EXATAMENTE esta transformacao: o que se ve
   na tela e o que sai no arquivo, nao uma aproximacao. */
function place(art, opts){
  const o = norm(opts), bb = art.bbox;
  return (x, y) => [ o.mirror ? bb.x2 - x : x - bb.x1, bb.y2 - y ];
}

const fmt = v => {
  const s = v.toFixed(4);
  return s.replace(/\.?0+$/, '') || '0';
};
function pathD(rings, T, close){
  const out = [];
  for (const r of rings){
    if (!r || r.length < 2) continue;
    const parts = [];
    for (let i = 0; i < r.length; i++){
      const p = T(r[i][0], r[i][1]);
      parts.push((i === 0 ? 'M' : 'L') + fmt(p[0]) + ' ' + fmt(p[1]));
    }
    out.push(parts.join(' ') + (close ? ' Z' : ''));
  }
  return out.join(' ');
}

/* A geometria que cada fonte entrega, ja resolvida. Usada pela emissao e pela previa,
   para as duas verem exatamente a mesma coisa. */
function geomFor(art, src){
  if (src === 'fill')       return { rings:art.copper || [], fill:true };
  if (src === 'copperEdge') return { rings:art.copperEdge || [] };
  if (src === 'padEdge')    return { rings:art.padEdge || [] };
  if (src === 'drills')     return { prims:art.drills || [] };
  if (src === 'board')      return { lines:art.outline || [] };
  if (src === 'silk'){
    if (art.silk && art.silk.length) return { rings:art.silk, fill:true };
    return { lines:art.silkLines || [] };
  }
  return {};
}
const geomEmpty = g => !(g.rings || []).length && !(g.lines || []).length && !(g.prims || []).length;

/* furo circular sai como <circle>: menor que um poligono de 40 lados e o LightBurn
   importa como elipse de verdade, entao a broca fica redonda mesmo */
function drillSvg(prims, T, tol, hex){
  /* a cor vai em CADA elemento, e nao num grupo em volta: atributo herdado de grupo e
     ponto fraco de importador, e a cor e o que define a camada no LightBurn */
  const attr = ' fill="none" stroke="' + hex + '" stroke-width="0.1"/>';
  const out = [];
  for (const p of prims){
    if (p.k === 'disc'){
      const c = T(p.x, p.y);
      out.push('<circle cx="' + fmt(c[0]) + '" cy="' + fmt(c[1]) + '" r="' + fmt(p.r) + '"' + attr);
    } else {
      for (const poly of primPolys(p, 0, tol))
        out.push('<path d="' + pathD([poly.concat([poly[0]])], T, true) + '"' + attr);
    }
  }
  return out;
}

function svg(art, opts){
  const o = norm(opts), T = place(art, o), s = art.size;
  const layers = (o.layers && o.layers.length) ? o.layers : defaultLayers();
  const L = [];
  L.push('<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ' +
         'width="' + fmt(s.w) + 'mm" height="' + fmt(s.h) + 'mm" ' +
         'viewBox="0 0 ' + fmt(s.w) + ' ' + fmt(s.h) + '">');
  L.push('<!-- AltiumPCBMirror - arte para LightBurn. 1 unidade = 1 mm.' +
         ' lado=' + o.side +
         ' arte=' + (o.invert ? 'negativo' : 'positivo') +
         ' espelho=' + (o.mirror ? 'sim' : 'nao') +
         ' furo=' + o.holes + (o.holes === 'mark' ? '(' + o.markD + 'mm)' : '') +
         ' expand=' + o.expand + 'mm res=' + o.res + 'mm/px -->');
  L.push('<!-- camadas: ' + layers.map(l => ciName(l.ci) + '=' + (l.name || l.src)).join(' | ') + ' -->');

  for (const lay of layers){
    const g = geomFor(art, lay.src);
    if (geomEmpty(g)) continue;                    /* camada sem geometria nao vira grupo */
    const hex = ci2hex(lay.ci);
    const cut = layerCut(lay);
    /* quem decide preencher ou contornar e o MODO da camada, nao a fonte de geometria:
       a bancada e que escolhe, e e ela que sabe o que a maquina vai fazer */
    const preenche = cut.type === 'Scan';
    const head = '<g id="' + ciName(lay.ci) + '-' + String(lay.src) +
                 '" data-lb-layer="' + ciName(lay.ci) + '"' +
                 ' data-lb-mode="' + (preenche ? 'preencher' : 'linha') + '"' +
                 ' data-lb-cut="' + cut.speed + 'mm/s ' + cut.maxPower + '% ' +
                   cut.frequency + 'kHz ' + cut.globalPasses + 'x qpulse' + cut.qPulse + '"' +
                 ' data-lb-name="' + String(lay.name || lay.src).replace(/"/g, '') + '">';
    const body = [];
    if (g.rings && g.rings.length)
      body.push(preenche
        ? '<path fill="' + hex + '" fill-rule="evenodd" stroke="none" d="' + pathD(g.rings, T, true) + '"/>'
        : '<path fill="none" stroke="' + hex + '" stroke-width="0.1" d="' + pathD(g.rings, T, true) + '"/>');
    if (g.lines && g.lines.length)
      body.push('<path fill="none" stroke="' + hex + '" stroke-width="0.1" d="' +
                pathD(g.lines, T, false) + '"/>');
    if (g.prims && g.prims.length)
      body.push(drillSvg(g.prims, T, o.res/4, hex).join(''));
    L.push(head + body.join('') + '</g>');
  }

  L.push('</svg>');
  return L.join('\n');
}

/* ═══════════════ .lbrn — formato nativo, com os parametros dentro ═══════════════
   Esquema conferido campo a campo contra um arquivo real de MOPA 60W
   (Color_Test_60W_MOPA.lbrn2, AppVersion 1.4.00):
     - `frequency` e em Hz  (o arquivo traz 10000..500000; a UI mostra kHz)
     - `QPulseWidth` e em ns
     - booleano e 1/0  (`crossHatch Value="1"`)
     - `globalRepeat`/`bidir` NAO aparecem la: o LightBurn omite quando estao no padrao,
       entao aqui tambem so saem quando diferem, para nao inventar campo.
     - as passagens da bancada saem como `globalRepeat` (= "Passagens Globais" da UI
       galvo; nome conferido nas strings do binario LightBurn 1.6.04, junto dos outros
       campos de CutSetting). `numPasses` existe mas e o "Numero de Passagens" DA
       SUB-CAMADA: 20 ali carregava o campo errado na bancada.
   O LightBurn usa Y para CIMA - ao contrario do SVG, aqui Y nao inverte. */

function placeLbrn(art, opts){
  const o = norm(opts), bb = art.bbox;
  return (x, y) => [ o.mirror ? bb.x2 - x : x - bb.x1, y - bb.y1 ];
}

const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                             .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const V = (k, v) => '      <' + k + ' Value="' + v + '"/>';
const bit = b => b ? '1' : '0';

function cutSettingXml(lay){
  const c = layerCut(lay), L = [];
  L.push('    <CutSetting type="' + (c.type === 'Scan' ? 'Scan' : 'Cut') + '">');
  L.push(V('index', lay.ci | 0));
  L.push(V('name', xmlEsc(lay.name || ciName(lay.ci))));
  /* uma potencia so na UI = sem rampa: min = max */
  L.push(V('minPower', c.maxPower));
  L.push(V('maxPower', c.maxPower));
  L.push(V('speed', c.speed));
  L.push(V('frequency', Math.round(c.frequency * 1000)));      /* kHz -> Hz */
  L.push(V('QPulseWidth', c.qPulse));
  if (c.globalPasses !== 1) L.push(V('globalRepeat', c.globalPasses));
  if (c.type === 'Scan'){
    L.push(V('interval', c.interval));
    L.push(V('angle', c.angle));
    L.push(V('crossHatch', bit(c.crossHatch)));
    if (c.bidir) L.push(V('bidir', bit(true)));
  }
  L.push(V('priority', lay.ci | 0));
  L.push('    </CutSetting>');
  return L.join('\n');
}

/* Path na forma CONDENSADA, que e a que FormatVersion="1" le:
     <VertList>V<x> <y>c0x1c1x1V...</VertList>
     <PrimList>L0 1L1 2...L<n-1> 0</PrimList>
   `c0x1c1x1` sao os marcadores de "sem bezier" que o arquivo de referencia poe em todo
   vertice de linha; `L<a> <b>` liga dois vertices, e o ultimo fecha no zero.

   Emitir a forma legada (<V vx>/<P T=>) dentro de FormatVersion="1" produz um arquivo que
   abre com as camadas certas e NENHUMA geometria - foi o que aconteceu na primeira versao.
   Coordenadas absolutas, entao a XForm e a identidade. */
function pathShape(rings, T, ci){
  const L = [];
  for (const r of rings){
    if (!r || r.length < 2) continue;
    /* o anel ja fecha repetindo o primeiro ponto; aqui quem fecha e a ultima primitiva */
    const pts = (r.length > 2 && r[0][0] === r[r.length-1][0] && r[0][1] === r[r.length-1][1])
      ? r.slice(0, -1) : r.slice();
    if (pts.length < 2) continue;
    const vs = [], ps = [];
    for (let i = 0; i < pts.length; i++){
      const p = T(pts[i][0], pts[i][1]);
      vs.push('V' + fmt(p[0]) + ' ' + fmt(p[1]) + 'c0x1c1x1');
      ps.push('L' + i + ' ' + ((i + 1) % pts.length));
    }
    L.push('    <Shape Type="Path" CutIndex="' + ci + '">');
    L.push('      <XForm>1 0 0 1 0 0</XForm>');
    L.push('      <VertList>' + vs.join('') + '</VertList>');
    L.push('      <PrimList>' + ps.join('') + '</PrimList>');
    L.push('    </Shape>');
  }
  return L;
}

function lbrn(art, opts){
  const o = norm(opts), T = placeLbrn(art, o);
  const layers = (o.layers && o.layers.length) ? o.layers : defaultLayers();
  const L = [];
  L.push('<?xml version="1.0" encoding="UTF-8"?>');
  /* AppVersion 1.6.00: globalRepeat e campo da era 1.5+, e arquivos 1.6 reais usam o
     mesmo FormatVersion="1" condensado - dizer 1.4.00 com um campo de 1.5+ seria mentira */
  L.push('<LightBurnProject AppVersion="1.6.00" FormatVersion="1" MaterialHeight="0" ' +
         'MirrorX="False" MirrorY="False">');
  L.push('  <!-- AltiumPCBMirror - ' + o.side + ', ' +
         (o.invert ? 'negativo' : 'positivo') + (o.mirror ? ', espelhado' : '') +
         ', res ' + o.res + ' mm/px -->');

  for (const lay of layers){
    if (geomEmpty(geomFor(art, lay.src))) continue;
    L.push(cutSettingXml(lay));
  }
  for (const lay of layers){
    const g = geomFor(art, lay.src);
    if (geomEmpty(g)) continue;
    const ci = lay.ci | 0;
    if (g.rings && g.rings.length) L.push.apply(L, pathShape(g.rings, T, ci));
    if (g.lines && g.lines.length) L.push.apply(L, pathShape(g.lines, T, ci));
    /* furo tambem como Path: o arquivo de referencia so tem Rect e Text, entao os
       atributos de Ellipse seriam palpite - e palpite aqui ja custou um arquivo vazio */
    for (const pr of (g.prims || []))
      for (const poly of primPolys(pr, 0, o.res/4))
        L.push.apply(L, pathShape([poly], T, ci));
  }
  L.push('</LightBurnProject>');
  return L.join('\n');
}

/* o bottom precisa sair espelhado para gravar do lado certo do cobre */
const autoMirror = side => side === 'Bottom';

/* Combinacoes que produzem geometria VALIDA mas fisicamente errada - por isso a checagem
   olha as opcoes, e nao o que saiu: negativo sem grupo de cobre gera um retangulo cheio,
   que e geometria perfeita e queimaria a placa inteira. */
const COPPER_GROUPS = ['tracks', 'pads', 'vias'];
function checkOpts(opts){
  const o = norm(opts), out = [];
  const algum = Object.keys(o.show).some(k => o.show[k]);
  if (!algum) out.push('nada marcado em "o que aparece" - o arquivo sairia vazio.');
  else if (o.invert && !COPPER_GROUPS.some(k => o.show[k]))
    out.push('negativo sem nenhum grupo de cobre marcado: a arte vira a placa inteira ' +
             'preenchida e o laser queimaria a placa toda. Marque trilhas/pads/vias/regioes.');
  return out;
}

const sane = s => String(s).replace(/[\\/:*?"<>|]/g, '_');
function filename(projName, opts, ext){
  const o = norm(opts);
  return sane(projName || 'placa') + '-LASER-' + o.side +
         (o.invert ? '-negativo' : '') + (o.mirror ? '-espelhado' : '') +
         '.' + (ext || 'svg');
}

function exportSvg(board, opts){
  const a = art(board, opts);
  return { svg: svg(a, a.opts), art: a, warnings: a.warnings };
}

return { LB, defaults, collect, arcPts, chainSegments,
         primPolys, union, contours, simplify,
         art, place, svg, exportSvg, filename, autoMirror, checkOpts,
         PALETTE, SOURCES, defaultLayers, geomFor, ci2hex, ciName, freeCi,
         cutDefaults, cutOf, layerCut, lbrn, placeLbrn };
});
