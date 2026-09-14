/* AltiumPCBMirror v2 - hub-draw.js — renderers canvas compartilhados (browser).
   Esquema em mil (tema claro, folha Altium); footprint em mm (tema escuro do viewer). */
"use strict";
var HubDraw = (function () {

const OD = { 0:[1,0], 90:[0,1], 180:[-1,0], 270:[0,-1] };
/* Nome do pino: altura e recuo para dentro do corpo, em mil. O numero ja tinha os seus
   cravados na chamada; estes ficam nomeados porque sao usados em duas contas. */
const PIN_NOME_H = 45, PIN_NOME_FOLGA = 20;
const SCH = { body:'#00008b', fill:'#fff8c8', pin:'#00008b', pinnum:'#600000',
              wire:'#0000c8', junction:'#0000c8', label:'#000000', power:'#000000',
              /* Port: barra AMARELA com a letra PRETA, como no Altium. Estes tres sao so o
                 PADRAO — a port que trouxer color/fill/textColor (do proprio Altium, ou
                 escolhidos na ficha da vista Esquema) manda neles. */
              port:'#0000c8', portFill:'#ffff00', portText:'#000000',
              /* o X do No ERC: o vermelho que o Altium usa na diretiva */
              noerc:'#cc0000',
              text:'#000080', sheet:'#fffef2', border:'#8a8a6a', grid:'#e6e4cf', hl:'#ff8c00' };
const PCB = { Top:'#ff0000', Bottom:'#0a0aff', TopOverlay:'#ffff00', BottomOverlay:'#b4b400',
              Multi:'#c0c0c0', hole:'#000000', bg:'#1b1b1b' };

/* texto no mundo Y-up (desfaz o flip da camera); h em unidades de mundo.
   opts.overbar: o texto e nome de pino/pad, e a notacao ativo-baixo do Altium (R\S\T\) sai
   barrada em vez de crua. E OPT-IN: o mesmo worldText desenha designador, comentario e
   texto livre, onde uma barra na frente e barra mesmo. Sem o hub-overbar.js carregado o
   desenho cai no fillText de sempre — quem carrega e a casca. */
function worldText(ctx, txt, x, y, h, rot, color, align, opts){
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(((rot || 0) * Math.PI) / 180);
  ctx.scale(1, -1);
  ctx.font = h + 'px "Segoe UI", sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  const ovb = typeof HubOverbar !== 'undefined' ? HubOverbar : null;
  if (opts && opts.overbar && ovb) ovb.canvas(ctx, txt, 0, 0);
  else ctx.fillText(txt, 0, 0);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r){
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y); ctx.arcTo(x+w, y, x+w, y+r, r);
  ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
  ctx.lineTo(x+r, y+h); ctx.arcTo(x, y+h, x, y+h-r, r);
  ctx.lineTo(x, y+r); ctx.arcTo(x, y, x+r, y, r);
  ctx.closePath();
}

/* ---------- espelho em X: no DADO, nunca no pixel ---------- */
/* Espelhar o componente com um ctx.scale(-1,1) do chamador virava tambem a LETRA: o
   worldText desfaz so o flip Y da camera, entao o flip X do chamador sobrevive ate o
   glifo e o nome do pino saia de tras para frente (GP2/AN2 lido ao contrario). Espelhando
   a GEOMETRIA aqui, o desenho de sempre calcula o lado do nome e o alinhamento a partir do
   pino JA espelhado: a posicao vira, a letra nao — que e o que o Altium mostra.
   Mesma regra do AI-GUIDE e do HubCore.compTransform (quem extrai as nets): angulo vira
   180-a, arco troca inicio e fim. Um entendimento so de "espelhado" nos tres lugares.
   O ROTULO NAO GIRA: 180-0 = 180 poria a legenda de cabeca para baixo, que e espelhar a
   letra pela porta dos fundos. Do rotulo so a ancora vira. */
const n360 = a => ((a % 360) + 360) % 360;
function mirrorPart(part){
  const N = v => 0 - v;                       /* 0 - v e nao -v: -0 suja comparacao */
  const pins = (part.pins || []).map(p => Object.assign({}, p, { x: N(p.x), orient: n360(180 - (p.orient || 0)) }));
  const graphics = (part.graphics || []).map(g => {
    const o = Object.assign({}, g);
    switch (g.g) {
      case 'line': o.x1 = N(g.x1); o.x2 = N(g.x2); break;
      case 'rect': o.x1 = Math.min(N(g.x1), N(g.x2)); o.x2 = Math.max(N(g.x1), N(g.x2)); break;
      case 'arc': { o.cx = N(g.cx);
        const sa = g.sa || 0, ea = g.ea == null ? 360 : g.ea;
        if (n360(ea - sa) !== 0) { o.sa = n360(180 - ea); o.ea = n360(180 - sa); }
        break; }
      case 'ellipse': o.cx = N(g.cx); break;
      case 'poly': case 'polyline': o.pts = (g.pts || []).map(p => [N(p[0]), p[1]]); break;
      case 'label': o.x = N(g.x); break;
    }
    return o;
  });
  return Object.assign({}, part, { pins, graphics });
}

/* ---------- simbolo (coords locais do simbolo, mil) ---------- */
function drawSymbolPart(ctx, part, opts){
  const o = opts || {};
  if (o.mirror) part = mirrorPart(part);   /* o espelho vira o dado; o texto continua desenhado normal */
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  /* PREENCHIMENTO VAI PARA TRAS. A ordem do array e a ordem em que o Altium guardou, e o
     corpo preenchido costuma vir por ULTIMO — desenhando na ordem crua, o retangulo amarelo
     do corpo cobria os diodos desenhados dentro dele. Duas passadas: primeiro tudo que
     preenche area, depois o resto, cada grupo na ordem original entre si. */
  const gs = part.graphics || [];
  for (const g of gs.filter(x => x && x.solid).concat(gs.filter(x => !(x && x.solid)))) {
    ctx.beginPath();
    ctx.lineWidth = g.w || 6;
    ctx.strokeStyle = o.stroke || SCH.body;
    ctx.fillStyle = SCH.fill;
    if (g.g === 'rect') { ctx.rect(g.x1, g.y1, g.x2-g.x1, g.y2-g.y1); if (g.solid) ctx.fill(); ctx.stroke(); }
    else if (g.g === 'line') { ctx.moveTo(g.x1, g.y1); ctx.lineTo(g.x2, g.y2); ctx.stroke(); }
    else if (g.g === 'arc') { ctx.arc(g.cx, g.cy, g.r, (g.sa||0)*Math.PI/180, (g.ea==null?360:g.ea)*Math.PI/180); ctx.stroke(); }
    else if (g.g === 'ellipse') { ctx.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, 2*Math.PI); if (g.solid) ctx.fill(); ctx.stroke(); }
    else if (g.g === 'poly') { (g.pts||[]).forEach((p,i)=> i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath(); if (g.solid) ctx.fill(); ctx.stroke(); }
    else if (g.g === 'polyline') { (g.pts||[]).forEach((p,i)=> i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.stroke(); }
    else if (g.g === 'label') { worldText(ctx, g.text||'', g.x, g.y, (g.size||8)*10, g.rot||0, SCH.text, 'center'); }
  }
  for (const p of (part.pins || [])) {
    const d = OD[((p.orient % 360) + 360) % 360] || [1, 0];
    const hx = p.x + d[0]*p.len, hy = p.y + d[1]*p.len;
    ctx.beginPath(); ctx.lineWidth = 4; ctx.strokeStyle = o.stroke || SCH.pin;
    ctx.moveTo(p.x, p.y); ctx.lineTo(hx, hy); ctx.stroke();
    const honra = o.honraOlho !== false;
    if (o.showPinNums !== false && !(honra && p.hideNum))
      worldText(ctx, p.num, (p.x+hx)/2 + Math.abs(d[1])*30, (p.y+hy)/2 + Math.abs(d[0])*30, 45, 0, SCH.pinnum, 'center');
    /* O NOME DO PINO VAI PARA DENTRO DO CORPO, como no Altium: d aponta para FORA (do corpo
       para a ponta quente), entao -d e para dentro. Faltava: este desenhista so punha o
       numero, e um SN65HVD75 virava um retangulo com 1..8 em volta, sem VCC/A/B/GND. Pino
       vertical leva o nome deitado (rot 90), como o Altium tambem faz.
       honraOlho: na FOLHA e na ficha o hideName do Altium manda, senao o desenho mente sobre
       o esquema. Nas vistas de BIBLIOTECA quem chama passa honraOlho:false, porque ali o nome
       do pino e justamente o que se foi ler — e porque o olho que veio do espelho agregado
       nao e confiavel pino a pino (o fingerprint e grafico, o doador pode ser outra peca). */
    /* NOME QUE SO REPETE O NUMERO NAO E NOME. Medido nos acervos: 4762 dos 12069 pinos (39%,
       e 94-97% no almoxarifado) tem name igual a num — desenhar os dois punha o mesmo "1"
       duas vezes no mesmo pino, um dentro do corpo e outro em cima do traco. E a regra que o
       hub-symed » comPadraoDeVisibilidade ja aplica ao pino que chega da paleta.
       So vale com o olho DESLIGADO: honrando, quem manda e o hideName do Altium, e adivinhar
       por cima dele faria o desenho mentir sobre o que a folha real mostra. */
    const nome = String(p.name == null ? '' : p.name).trim();
    const mostraNome = honra ? !p.hideName : nome !== String(p.num == null ? '' : p.num).trim();
    if (o.showPinNames !== false && p.name && mostraNome) {
      const vert = d[0] === 0;
      worldText(ctx, String(p.name), p.x - d[0]*PIN_NOME_FOLGA, p.y - d[1]*PIN_NOME_FOLGA,
                PIN_NOME_H, vert ? 90 : 0, o.stroke || SCH.body,
                (vert ? d[1] > 0 : d[0] > 0) ? 'right' : 'left', { overbar: true });
    }
  }
}

/* bbox local do simbolo (graficos + pinos) para fit */
function symBBox(part){
  let x1=1e9, y1=1e9, x2=-1e9, y2=-1e9;
  const ext=(x,y)=>{ if(x<x1)x1=x; if(x>x2)x2=x; if(y<y1)y1=y; if(y>y2)y2=y; };
  for (const g of (part.graphics || [])) {
    if (g.g==='rect'||g.g==='line'){ ext(g.x1,g.y1); ext(g.x2,g.y2); }
    else if (g.g==='arc'){ ext(g.cx-g.r,g.cy-g.r); ext(g.cx+g.r,g.cy+g.r); }
    else if (g.g==='ellipse'){ ext(g.cx-g.rx,g.cy-g.ry); ext(g.cx+g.rx,g.cy+g.ry); }
    else if (g.g==='poly'||g.g==='polyline'){ (g.pts||[]).forEach(p=>ext(p[0],p[1])); }
    else if (g.g==='label'){ ext(g.x-100,g.y-50); ext(g.x+100,g.y+50); }
  }
  for (const p of (part.pins || [])) {
    const d = OD[((p.orient%360)+360)%360] || [1,0];
    ext(p.x,p.y); ext(p.x+d[0]*p.len, p.y+d[1]*p.len);
  }
  if (x1 > x2) { x1=-100; y1=-100; x2=100; y2=100; }
  return { x1, y1, x2, y2 };
}

/* ---------- footprint (coords locais, mm) ---------- */
function drawFootprint(ctx, fp, opts){
  for (const s of (fp.silk || [])) {
    ctx.beginPath(); ctx.strokeStyle = PCB.TopOverlay; ctx.lineWidth = s.w || 0.15; ctx.lineCap='round';
    if (s.kind === 'arc') ctx.arc(s.cx, s.cy, s.r, (s.sa||0)*Math.PI/180, (s.ea==null?360:s.ea)*Math.PI/180);
    else { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
    ctx.stroke();
  }
  for (const p of (fp.pads || [])) {
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(((p.rot||0)*Math.PI)/180);
    ctx.fillStyle = p.type === 'th' ? PCB.Multi : (PCB[p.layer] || PCB.Top);
    ctx.beginPath();
    const hw = p.w/2, hh = p.h/2;
    if (p.shape === 'circle') ctx.arc(0, 0, Math.max(hw, hh), 0, 2*Math.PI);
    else if (p.shape === 'oval' || p.shape === 'roundrect') { const r = Math.min(hw, hh); roundRect(ctx, -hw, -hh, p.w, p.h, Math.min(p.radius || r, r)); }
    else if (p.shape === 'octagon') { const c = Math.min(hw,hh)*0.4142;
      ctx.moveTo(-hw+c,-hh); ctx.lineTo(hw-c,-hh); ctx.lineTo(hw,-hh+c); ctx.lineTo(hw,hh-c);
      ctx.lineTo(hw-c,hh); ctx.lineTo(-hw+c,hh); ctx.lineTo(-hw,hh-c); ctx.lineTo(-hw,-hh+c); ctx.closePath(); }
    else ctx.rect(-hw, -hh, p.w, p.h);
    ctx.fill();
    if (p.type === 'th' && p.drill) { ctx.fillStyle = PCB.hole; ctx.beginPath(); ctx.arc(0, 0, p.drill/2, 0, 2*Math.PI); ctx.fill(); }
    ctx.restore();
    /* nome de pad hoje nao tem nenhum barrado em Libs/pcblib.js (medido: 0 em 5212); vai
       pelo mesmo caminho do nome de pino para nao ser o unico lugar que mostra a notacao
       crua no dia em que aparecer um */
    if (!opts || opts.showPadNames !== false)
      worldText(ctx, String(p.name), p.x, p.y, Math.max(Math.min(p.w, p.h)*0.55, 0.3), 0, '#ffffff', 'center', { overbar:true });
  }
}

/* ---------- power port / netlabel / junction (coords da folha, mil) ---------- */
function seg(ctx, x1, y1, x2, y2){ ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
function drawPowerPort(ctx, p, color){
  const c = color || SCH.power;
  ctx.save();
  ctx.translate(p.x, p.y); ctx.rotate((((p.rot||0)%360)*Math.PI)/180);
  ctx.strokeStyle = c; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); seg(ctx, 0, 0, 100, 0);
  const st = p.style || 'Bar';
  if (st === 'GndPower' || st === 'GndEarth') { seg(ctx,100,-50,100,50); seg(ctx,120,-30,120,30); seg(ctx,140,-12,140,12); ctx.stroke(); }
  else if (st === 'GndSignal') { ctx.stroke(); ctx.beginPath(); ctx.moveTo(100,-50); ctx.lineTo(100,50); ctx.lineTo(160,0); ctx.closePath(); ctx.stroke(); }
  else if (st === 'Circle' || st === 'Wave') { ctx.stroke(); ctx.beginPath(); ctx.arc(125, 0, 25, 0, 2*Math.PI); ctx.stroke(); }
  else if (st === 'Arrow') { seg(ctx,100,0,70,25); seg(ctx,100,0,70,-25); ctx.stroke(); }
  else { seg(ctx, 100, -50, 100, 50); ctx.stroke(); }  // Bar
  ctx.restore();
  const rot = ((p.rot||0)%360+360)%360;
  const d = OD[rot] || [1,0];
  const isGnd = st.indexOf('Gnd') === 0;
  worldText(ctx, p.net || '', p.x + d[0]*(isGnd?230:190), p.y + d[1]*(isGnd?230:190), 55, 0, c, 'center');
}
/* A Port do Altium: uma barra deitada com o nome dentro. O ponto ELETRICO e a ancora
   (x,y) — e onde o fio encosta e onde a extracao de nets liga. `w` e o comprimento em
   mil; sem ele, 400 (o padrao do Altium).

   ESTILO: `p.style` e o INTEIRO CRU do Altium (o mesmo |Style=n| do .SchDoc). O
   significado de cada numero AINDA NAO FOI CONFERIDO contra um Altium de verdade — a
   tentativa de usar as constantes nomeadas (ePortLeft, ePortNone_Vertical...) foi
   recusada com "Undeclared identifier". Enquanto nao houver medicao, TODA port e
   desenhada com bico dos dois lados, que e a cara generica de uma port: preferimos uma
   forma honestamente aproximada a uma forma errada com ar de certa.

   Para calibrar: rode o ExportProject num projeto com ports, veja que numeros saem em
   "style", compare com a forma na tela do Altium e preencha ESTILO_POR_NUM abaixo. */
const ESTILO_POR_NUM = {
  /* num: [bicoEsquerdo, bicoDireito, vertical] — vazio de proposito enquanto nao medido */
};

/* Medidas da barra, num lugar so. Encolhidas a pedido: a port ocupava 120 mil de altura
   e competia com o componente ao lado. */
const PORT_H    = 45;      /* meia-altura da barra (era 60) */
const PORT_BICO = 24;      /* o quanto o chanfro avanca     */
const PORT_TXT  = 45;      /* corpo da letra do nome        */

/* Cor so vale se for "#rrggbb": espelho antigo nao tem o campo, e um valor estranho
   (inteiro cru do Altium, 'rgb(...)') tem que cair no padrao em vez de sujar o canvas. */
const corDePort = c => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) ? c : null;

/* A GEOMETRIA DA PORT MORA AQUI, e so aqui: o desenho e a caixa de clique da vista Esquema
   leem desta funcao. Se cada um calculasse a sua, no dia em que ESTILO_POR_NUM for
   preenchido o desenho giraria e a caixa nao — o clique passaria a errar a port sem que
   ninguem tivesse mexido no clique. */
function portGeom(p){
  const conhecido = ESTILO_POR_NUM[p.style];
  const vertical  = conhecido ? conhecido[2] : false;
  const ang = ((((vertical ? 90 : 0) + (p.rot || 0)) % 360) + 360) % 360;
  return { w: (typeof p.w === 'number' && p.w > 0) ? p.w : 400,
           h: PORT_H, bico: PORT_BICO,
           pontaEsq: conhecido ? conhecido[0] : true,
           pontaDir: conhecido ? conhecido[1] : true,
           ang, dir: OD[ang] || [1, 0] };
}

/* Caixa da port em mil: EXATAMENTE o retangulo desenhado, nem um mil a mais. A barra nasce
   na ancora (x,y) e cresce na direcao da port — nao para os dois lados. */
function portBBox(p){
  const g  = portGeom(p);
  const xf = p.x + g.dir[0] * g.w, yf = p.y + g.dir[1] * g.w;
  const ex = g.dir[0] ? 0 : g.h, ey = g.dir[0] ? g.h : 0;   /* engorda so no eixo transversal */
  return { x1: Math.min(p.x, xf) - ex, y1: Math.min(p.y, yf) - ey,
           x2: Math.max(p.x, xf) + ex, y2: Math.max(p.y, yf) + ey };
}

function drawPort(ctx, p, color){
  const g = portGeom(p);
  const dentro = corDePort(p.fill)      || SCH.portFill;
  const letra  = corDePort(p.textColor) || SCH.portText;
  /* O destaque de net (`color`) manda SO no contorno: pintar a letra de laranja por cima
     do amarelo apagaria justamente o nome que se quer ler. Contorno mais grosso e o que
     marca a port em foco. */
  const borda  = color || corDePort(p.color) || SCH.port;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate((g.ang * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(g.pontaEsq ? g.bico : 0, g.h);
  ctx.lineTo(g.pontaDir ? g.w - g.bico : g.w, g.h);
  if (g.pontaDir) ctx.lineTo(g.w, 0);
  ctx.lineTo(g.pontaDir ? g.w - g.bico : g.w, -g.h);
  ctx.lineTo(g.pontaEsq ? g.bico : 0, -g.h);
  if (g.pontaEsq) ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fillStyle = dentro; ctx.fill();
  ctx.strokeStyle = borda; ctx.lineWidth = color ? 7 : 4; ctx.lineJoin = 'miter';
  ctx.stroke();
  ctx.restore();
  /* o nome sai na horizontal mesmo em port vertical: rotulo de fio no Altium nunca fica
     de cabeca para baixo, e aqui o objetivo e ler */
  worldText(ctx, p.net || '', p.x + g.dir[0] * (g.w / 2), p.y + g.dir[1] * (g.w / 2),
            PORT_TXT, 0, letra, 'center');
}

/* O "No ERC" do Altium: o X vermelho que marca "este pino fica sem ligar DE PROPOSITO".
   Nao e objeto eletrico — nao liga, nao separa e nao nomeia nada; e um recado para o ERC do
   Altium (e para quem le a folha) de que aquele pino solto ja foi visto e aprovado. Por isso
   ele nao entra na extracao de nets: entrar faria o preview inventar ligacao que o Altium
   nao faz.
   A ancora e o ponto MARCADO (a ponta quente do pino, normalmente), e o X e centrado nela.
   `color` vem do proprio Altium quando o espelho o trouxer; ausente, o vermelho da casa. */
const NOERC_BRACO = 22;
function drawNoERC(ctx, x, y, color){
  ctx.save();
  ctx.strokeStyle = color || SCH.noerc; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - NOERC_BRACO, y - NOERC_BRACO); ctx.lineTo(x + NOERC_BRACO, y + NOERC_BRACO);
  ctx.moveTo(x - NOERC_BRACO, y + NOERC_BRACO); ctx.lineTo(x + NOERC_BRACO, y - NOERC_BRACO);
  ctx.stroke();
  ctx.restore();
}
function drawNetLabel(ctx, l, color){
  worldText(ctx, l.net || '', l.x, l.y + 18, 55, l.rot || 0, color || SCH.label,
    (((l.rot||0)%360)+360)%360 === 0 ? 'left' : 'center');
}
function drawJunction(ctx, x, y, color){
  ctx.fillStyle = color || SCH.junction;
  ctx.beginPath(); ctx.arc(x, y, 18, 0, 2*Math.PI); ctx.fill();
}

/* ---------- camera zoom/pan Y-up (mesma matriz do viewer v1) ---------- */
function mkCamera(canvas, drawWorld, opts){
  const ctx = canvas.getContext('2d');
  const cam = { scale: 0.1, cx: 0, cy: 0 };
  let DPR = 1, W = 0, H = 0;
  function draw(){
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = (opts && opts.bg) || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(DPR*cam.scale, 0, 0, -DPR*cam.scale,
      DPR*(W/2 - cam.cx*cam.scale), DPR*(H/2 + cam.cy*cam.scale));
    drawWorld(ctx, cam);
  }
  function resize(){
    DPR = window.devicePixelRatio || 1;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W*DPR); canvas.height = Math.round(H*DPR);
    draw();
  }
  function fit(bb, margin){
    const m = margin || 1.15;
    const w = Math.max(bb.x2-bb.x1, 1), h = Math.max(bb.y2-bb.y1, 1);
    cam.cx = (bb.x1+bb.x2)/2; cam.cy = (bb.y1+bb.y2)/2;
    cam.scale = Math.min(W/(w*m), H/(h*m));
    draw();
  }
  function toWorld(sx, sy){ return { x:(sx-W/2)/cam.scale + cam.cx, y:(H/2-sy)/cam.scale + cam.cy }; }
  let dragging = false, lx = 0, ly = 0, moved = false, claimed = false;
  canvas.addEventListener('mousedown', e => {
    dragging = true; moved = false; lx = e.offsetX; ly = e.offsetY;
    claimed = !!(opts && opts.onDragStart && opts.onDragStart(toWorld(e.offsetX, e.offsetY), e));
  });
  window.addEventListener('mouseup', () => {
    if (dragging && claimed && opts && opts.onDragEnd) opts.onDragEnd(moved);
    dragging = false; claimed = false;
  });
  canvas.addEventListener('mousemove', e => {
    if (opts && opts.onMove) opts.onMove(toWorld(e.offsetX, e.offsetY), e);
    if (!dragging) return;
    moved = true;
    if (claimed){ if (opts && opts.onDrag) opts.onDrag(toWorld(e.offsetX, e.offsetY), e); return; }
    cam.cx -= (e.offsetX-lx)/cam.scale; cam.cy += (e.offsetY-ly)/cam.scale;
    lx = e.offsetX; ly = e.offsetY; draw();
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    /* Shift + roda anda para os lados em vez de ampliar. Alguns navegadores ja trocam
       deltaY por deltaX quando o Shift esta preso, entao vale o que vier. */
    if (e.shiftKey){
      const d = (e.deltaX || e.deltaY) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      cam.cx += d / cam.scale;
      draw();
      return;
    }
    const w = toWorld(e.offsetX, e.offsetY);
    cam.scale *= (e.deltaY < 0 ? 1.18 : 1/1.18);
    cam.cx = w.x - (e.offsetX-W/2)/cam.scale;
    cam.cy = w.y + (e.offsetY-H/2)/cam.scale;
    draw();
    if (opts && opts.onZoom) opts.onZoom(cam);
  }, { passive: false });
  canvas.addEventListener('click', e => {
    if (moved) return;
    if (opts && opts.onClick) opts.onClick(toWorld(e.offsetX, e.offsetY), e);
  });
  window.addEventListener('resize', resize);
  /* A JANELA nao e a unica coisa que muda o tamanho do canvas: a barra de rolagem da lista
     que aparece e some conforme a busca filtra, a troca de sub-aba, o painel de baixo
     alternando entre valores e footprint — nada disso dispara 'resize' da window. Sem
     observar o proprio elemento, o bitmap e o W/H que o transform usa ficam do tamanho
     ANTIGO, e o desenho sai espremido e fora de centro dentro de uma caixa de outra
     proporcao. Observar o canvas conserta todos esses casos de uma vez. */
  if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(canvas);
  return { cam, ctx, draw, fit, toWorld, resize };
}

return { SCH, PCB, OD, worldText, roundRect, drawSymbolPart, mirrorPart, symBBox, drawFootprint,
         drawPowerPort, drawNetLabel, drawPort, portGeom, portBBox, drawJunction, drawNoERC, mkCamera };
})();
if (typeof module === 'object' && module.exports) module.exports = HubDraw;
