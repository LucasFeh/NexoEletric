/* AltiumPCBMirror v2 - hub-draw.js — renderers canvas compartilhados (browser).
   Esquema em mil (tema claro, folha Altium); footprint em mm (tema escuro do viewer). */
"use strict";
var HubDraw = (function () {

const OD = { 0:[1,0], 90:[0,1], 180:[-1,0], 270:[0,-1] };
const SCH = { body:'#00008b', fill:'#fff8c8', pin:'#00008b', pinnum:'#600000',
              wire:'#0000c8', junction:'#0000c8', label:'#000000', power:'#000000',
              text:'#000080', sheet:'#fffef2', border:'#8a8a6a', grid:'#e6e4cf', hl:'#ff8c00' };
const PCB = { Top:'#ff0000', Bottom:'#0a0aff', TopOverlay:'#ffff00', BottomOverlay:'#b4b400',
              Multi:'#c0c0c0', hole:'#000000', bg:'#1b1b1b' };

/* texto no mundo Y-up (desfaz o flip da camera); h em unidades de mundo */
function worldText(ctx, txt, x, y, h, rot, color, align){
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(((rot || 0) * Math.PI) / 180);
  ctx.scale(1, -1);
  ctx.font = h + 'px "Segoe UI", sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(txt, 0, 0);
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

/* ---------- simbolo (coords locais do simbolo, mil) ---------- */
function drawSymbolPart(ctx, part, opts){
  const o = opts || {};
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const g of (part.graphics || [])) {
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
    if (o.showPinNums !== false)
      worldText(ctx, p.num, (p.x+hx)/2 + Math.abs(d[1])*30, (p.y+hy)/2 + Math.abs(d[0])*30, 45, 0, SCH.pinnum, 'center');
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
    if (!opts || opts.showPadNames !== false)
      worldText(ctx, String(p.name), p.x, p.y, Math.max(Math.min(p.w, p.h)*0.55, 0.3), 0, '#ffffff', 'center');
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

return { SCH, PCB, OD, worldText, roundRect, drawSymbolPart, symBBox, drawFootprint,
         drawPowerPort, drawNetLabel, drawJunction, mkCamera };
})();
if (typeof module === 'object' && module.exports) module.exports = HubDraw;
