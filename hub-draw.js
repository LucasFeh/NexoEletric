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
  /* 1.94.0: opts.fonte (a port estilizável escolhe a fonte); sem ela, a de sempre */
  ctx.font = h + 'px "' + (opts && opts.fonte ? opts.fonte : 'Segoe UI') + '", ' + (opts && /times/i.test(opts.fonte || '') ? 'serif' : 'sans-serif');
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
/* O TEXTO DO PINO FICA DE PE, como no Altium. Quem desenha a folha gira o componente INTEIRO
   (ctx.rotate(rot) antes de chamar drawSymbolPart), e o numero e o nome do pino giravam junto:
   num conector em 180° o numero saia de cabeca para baixo (queixa de 2026-09-24, nos conectores
   de uma parte por pino, em que o numero do pino E o numero da parte), e a 270° lia de cima para
   baixo. Se o angulo NA FOLHA (rot do componente + angulo do texto) cai em (90°, 270°], o texto
   ganha meia volta em torno da propria ancora e o alinhamento troca de lado — assim ele continua
   ocupando o mesmo lugar, so que legivel. `rotComp` ausente (previews de biblioteca) = 0. */
function dePe(ang, rotComp, align){
  const ef = ((((ang + (rotComp || 0)) % 360) + 360) % 360);
  if (ef > 90.5 && ef <= 270.5)
    return { ang: ang + 180, align: align === 'left' ? 'right' : align === 'right' ? 'left' : align };
  return { ang, align };
}
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
    if (o.showPinNums !== false && !(honra && p.hideNum)){
      const t = dePe(0, o.rot, 'center');
      worldText(ctx, p.num, (p.x+hx)/2 + Math.abs(d[1])*30, (p.y+hy)/2 + Math.abs(d[0])*30, 45, t.ang, SCH.pinnum, t.align);
    }
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
      const t = dePe(vert ? 90 : 0, o.rot, (vert ? d[1] > 0 : d[0] > 0) ? 'right' : 'left');
      worldText(ctx, String(p.name), p.x - d[0]*PIN_NOME_FOLGA, p.y - d[1]*PIN_NOME_FOLGA,
                PIN_NOME_H, t.ang, o.stroke || SCH.body, t.align, { overbar: true });
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
/* As medidas do power port, num lugar so: o desenho e a caixa de clique leem daqui. */
const POWER_HASTE = 100, POWER_MEIA = 50, POWER_TXT = 55;
const powerFim  = st => st === 'GndSignal' ? 160 : (st === 'Circle' || st === 'Wave') ? 150
                      : (st === 'GndPower' || st === 'GndEarth') ? 140 : POWER_HASTE;
const powerNome = st => (st || '').indexOf('Gnd') === 0 ? 230 : 190;
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
  const dn = powerNome(st);
  worldText(ctx, p.net || '', p.x + d[0]*dn, p.y + d[1]*dn, POWER_TXT, 0, c, 'center');
}
/* Caixa do power port em mil: o que drawPowerPort desenha — a haste nasce na ancora e cresce SO para
   o lado da rotacao, o simbolo no fim dela e o nome (sempre deitado) adiante — e nada atras da ancora.
   Era 300x300 centrada na ancora (e o clique, um raio de 140): no power em cima de um componente,
   metade da caixa cobria o corpo dele, a selecao virava um quadrado gigante e o clique no componente
   pegava o power (pedido do dono, 2026-11-03). Mesma regra da portBBox: desenho e caixa leem a mesma
   geometria. */
function powerBBox(p){
  const st = p.style || 'Bar';
  const a = ((((p.rot || 0) % 360) + 360) % 360) * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  const fim = powerFim(st), xs = [], ys = [];
  for (const [lx, ly] of [[0, -POWER_MEIA], [fim, -POWER_MEIA], [fim, POWER_MEIA], [0, POWER_MEIA]]) {
    xs.push(p.x + lx * cs - ly * sn); ys.push(p.y + lx * sn + ly * cs);
  }
  const d = OD[(((p.rot || 0) % 360) + 360) % 360] || [1, 0], dn = powerNome(st);
  const cx = p.x + d[0] * dn, cy = p.y + d[1] * dn;
  const meiaL = Math.max(POWER_TXT, String(p.net || '').length * POWER_TXT * 0.62) / 2, meiaA = POWER_TXT * 0.6;
  xs.push(cx - meiaL, cx + meiaL); ys.push(cy - meiaA, cy + meiaA);
  const r = v => Math.round(v * 1e3) / 1e3;
  return { x1: r(Math.min(...xs)), y1: r(Math.min(...ys)), x2: r(Math.max(...xs)), y2: r(Math.max(...ys)) };
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
/* MEDIDO em 2026-09-14, nos 127 ports dos 14 projetos: so DOIS numeros aparecem no espelho,
   0 (121 ports) e 4 (6 ports), e o que eles decidem e o EIXO — 0 deita, 4 fica em pe. Tres
   evidencias independentes, e nenhum contraexemplo:
     fio    todo port style 0 que encosta em fio so encosta em fio HORIZONTAL (19 casos);
            todo style 4, so em fio VERTICAL (2 casos).
     pino   os quatro style 4 do PRJ - DI261930 (MISO, CS, SCK, MOSI) sao exatamente os do
            U2 (SCL3300), cujos pinos sao verticais — e eram os que sairam deitados na tela.
     ancora os quatro crescem +Y a partir dela sem invadir o corpo do U2. Ou seja: no port
            em pe a ancora e a ponta de BAIXO, como no deitado ela e a da ESQUERDA, e o
            `dir` do portGeom ja resolve isso sozinho.
   O BICO fica dos dois lados nos dois estilos: e o que o Altium desenha na tela (hexagono
   apontado nas duas pontas, como na captura do usuario), e nao ha aqui medida que separe
   bico de eixo. 1, 2, 3, 5, 6 e 7 nao apareceram em projeto nenhum e seguem SEM MEDIDA —
   caem no padrao de antes, que e o mesmo desenho generico. */
const ESTILO_POR_NUM = {
  /* num: [bicoEsquerdo, bicoDireito, vertical] */
  0: [true, true, false],
  4: [true, true, true],
  /* 1.94.0: os outros números do TPortArrowStyle do Altium (ePortLeft=1, ePortRight=2, ePortLeftRight=3,
     ePortTop=5, ePortBottom=6, ePortTopBottom=7) — nenhum apareceu nos projetos medidos; são os que a port NOVA (a
     ferramenta Port da barra) grava para o Altium a partir da `seta`. Esquerda/baixo = a ponta da âncora. */
  1: [true, false, false], 2: [false, true, false], 3: [true, true, false],
  5: [false, true, true],  6: [true, false, true],  7: [true, true, true],
};

/* Medidas da barra, num lugar so. Encolhidas a pedido: a port ocupava 120 mil de altura
   e competia com o componente ao lado. */
const PORT_H    = 45;      /* meia-altura da barra (era 60) */
const PORT_BICO = 24;      /* o quanto o chanfro avanca     */
const PORT_TXT  = 45;      /* corpo da letra do nome        */

/* Cor so vale se for "#rrggbb": espelho antigo nao tem o campo, e um valor estranho
   (inteiro cru do Altium, 'rgb(...)') tem que cair no padrao em vez de sujar o canvas. */
const corDePort = c => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) ? c : null;

/* ── A PORT ESTILIZÁVEL (1.94.0) ──
   Pedido do dono (2026-11-10): "na barra de ferramentas, em 'net' adiciona 'port' também pra adicionar esse tipo de
   porta, e quero que seja completamente estilizável, podendo alterar borda, background, posição do texto, size do
   texto, fonte e cor do texto". É o MESMO objeto `port` que vem do Altium (o mesmo desenho, a mesma conexão pelo
   nome); os campos novos são todos opcionais — a port importada sem eles desenha exatamente como antes:
     seta         'nenhuma' | 'esquerda' | 'direita' | 'ambos'   onde vai a ponta (esquerda = a ponta da âncora; na port
                  em pé, embaixo). Ausente: o `style` do Altium decide (ESTILO_POR_NUM).
     larguraAuto  true: a largura acompanha o nome (e o `w` gravado é recalculado, para o Altium receber a mesma)
     bordaW       espessura da borda, em mil (padrão 4)
     fill         a cor do fundo, ou 'none' (transparente)
     alinha       'esquerda' | 'centro' | 'direita'          o texto dentro da barra
     txtH         tamanho do texto, em mil (padrão 45); a barra engorda se a letra pedir
     fonte        uma das PORT_FONTES (as do esquema: a da vista e as do carimbo)
   color/textColor/io/style/w continuam os do Altium. */
const PORT_SETAS  = ['nenhuma', 'esquerda', 'direita', 'ambos'];
const PORT_ALINHA = ['esquerda', 'centro', 'direita'];
const PORT_FONTES = ['Segoe UI', 'Arial', 'Arial Narrow', 'Times New Roman'];
/* o tipo de E/S do Altium (TPortIO) */
const PORT_IO = [[0, 'não especificado'], [1, 'saída'], [2, 'entrada'], [3, 'bidirecional']];
/* o estilo da port nova (o da imagem do dono: borda azul escura, fundo branco, texto azul centralizado, ponta à direita) */
const PORT_PADRAO = { seta:'direita', io:0, larguraAuto:true, color:'#1f3a93', bordaW:6, fill:'#ffffff',
                      alinha:'centro', txtH:PORT_TXT, fonte:'Segoe UI', textColor:'#1f4fd1' };
const PORT_CAMPOS = ['seta', 'io', 'larguraAuto', 'w', 'color', 'bordaW', 'fill', 'alinha', 'txtH', 'fonte', 'textColor'];

function portTxtH(p){ return typeof p.txtH === 'number' && p.txtH > 0 ? p.txtH : PORT_TXT; }
function portBicos(p){
  if (PORT_SETAS.includes(p.seta)) return [p.seta === 'esquerda' || p.seta === 'ambos', p.seta === 'direita' || p.seta === 'ambos'];
  const c = ESTILO_POR_NUM[p.style];
  return c ? [c[0], c[1]] : [true, true];
}
/* a largura que o nome pede: a letra (média de 0,62 em, as maiúsculas da casa), as pontas e uma folga de cada lado */
function portLargura(p){
  const h = portTxtH(p), meia = Math.max(PORT_H, Math.round(h * 0.8));
  const bico = Math.max(PORT_BICO, Math.round(meia * 0.53));
  const [e, d] = portBicos(p);
  const fator = /narrow/i.test(p.fonte || '') ? 0.5 : 0.62;
  const larg = String(p.net || '').length * h * fator + (e ? bico : 0) + (d ? bico : 0) + 2 * Math.max(25, h * 0.5);
  return Math.max(200, Math.ceil(larg / 10) * 10);
}
/* o número do `style` do Altium para a seta e o eixo (o BuildSchematic grava este) */
function portEstiloAltium(seta, vertical){
  /* deitada: ePortNone_Horizontal 0, ePortLeft 1, ePortRight 2, ePortLeftRight 3; em pé (a âncora embaixo):
     ePortNone_Vertical 4, ePortTop 5 (a ponta longe da âncora), ePortBottom 6 (a da âncora), ePortTopBottom 7 */
  if (vertical) return { esquerda:6, direita:5, ambos:7 }[seta] || 4;
  return { esquerda:1, direita:2, ambos:3 }[seta] || 0;
}
/* a port em pé? (o eixo que o desenho usa) */
function portEmPe(p){ return portGeom(p).ang % 180 === 90; }
/* Acerta o `style`, o `rot` e o `w` da port depois de mexer na seta, no eixo ou no nome: o Altium só sabe de port
   deitada (âncora na esquerda) ou em pé (âncora embaixo) — o `rot` do hub sai, e o eixo vai no `style`. */
function portAcerta(p, emPe){
  const vertical = emPe == null ? portEmPe(p) : !!emPe;
  if (PORT_SETAS.includes(p.seta)) p.style = portEstiloAltium(p.seta, vertical);
  else p.style = vertical ? 4 : 0;
  delete p.rot;
  if (p.larguraAuto) p.w = portLargura(p);
  return p;
}
/* uma port nova (a ferramenta da barra, o MCP): o estilo padrão, por cima o `estilo` pedido (o "usar como padrão") */
function portNova(o){
  const p = Object.assign({ t:'port', sheet:o.sheet, net:o.net, x:o.x, y:o.y, style:0 }, PORT_PADRAO);
  for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
  if (o.estilo) portEstilo(p, o.estilo);          /* conferido: um padrão velho/estranho não suja a port */
  return portAcerta(p, !!o.emPe);
}
/* Aplica um estilo (só os campos conhecidos, conferidos) numa port; devolve a lista dos campos recusados */
function portEstilo(p, est){
  const ruins = [];
  for (const k of Object.keys(est || {})){
    const v = est[k];
    const ok = k === 'seta' ? PORT_SETAS.includes(v)
      : k === 'alinha' ? PORT_ALINHA.includes(v)
      : k === 'fonte' ? PORT_FONTES.includes(v)
      : k === 'io' ? [0, 1, 2, 3].includes(v)
      : k === 'larguraAuto' ? typeof v === 'boolean'
      : k === 'w' ? typeof v === 'number' && v >= 100 && v <= 5000
      : k === 'bordaW' ? typeof v === 'number' && v >= 1 && v <= 40
      : k === 'txtH' ? typeof v === 'number' && v >= 15 && v <= 200
      : k === 'fill' ? v === 'none' || corDePort(v) != null
      : k === 'color' || k === 'textColor' ? corDePort(v) != null
      : false;
    if (!ok){ ruins.push(k); continue; }
    p[k] = typeof v === 'string' && v.charAt(0) === '#' ? v.toLowerCase() : v;
    if (k === 'w') p.larguraAuto = false;
  }
  portAcerta(p);
  return ruins;
}

/* A GEOMETRIA DA PORT MORA AQUI, e so aqui: o desenho e a caixa de clique da vista Esquema
   leem desta funcao. Se cada um calculasse a sua, no dia em que ESTILO_POR_NUM for
   preenchido o desenho giraria e a caixa nao — o clique passaria a errar a port sem que
   ninguem tivesse mexido no clique. */
function portGeom(p){
  const conhecido = ESTILO_POR_NUM[p.style];
  const vertical  = conhecido ? conhecido[2] : false;
  const ang = ((((vertical ? 90 : 0) + (p.rot || 0)) % 360) + 360) % 360;
  const [pontaEsq, pontaDir] = portBicos(p);
  /* a letra maior engorda a barra (e a ponta acompanha); no tamanho padrão, as medidas de sempre */
  const h = Math.max(PORT_H, Math.round(portTxtH(p) * 0.8));
  const w = p.larguraAuto ? portLargura(p) : (typeof p.w === 'number' && p.w > 0) ? p.w : 400;
  return { w, h, bico: Math.max(PORT_BICO, Math.round(h * 0.53)),
           pontaEsq, pontaDir, ang, dir: OD[ang] || [1, 0] };
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
  const semFundo = p.fill === 'none';
  const dentro = corDePort(p.fill)      || SCH.portFill;
  const letra  = corDePort(p.textColor) || SCH.portText;
  /* O destaque de net (`color`) manda SO no contorno: pintar a letra de laranja por cima
     do amarelo apagaria justamente o nome que se quer ler. Contorno mais grosso e o que
     marca a port em foco. */
  const borda  = color || corDePort(p.color) || SCH.port;
  const bw = typeof p.bordaW === 'number' && p.bordaW > 0 ? p.bordaW : 4;
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
  if (!semFundo){ ctx.fillStyle = dentro; ctx.fill(); }
  ctx.strokeStyle = borda; ctx.lineWidth = color ? Math.max(7, bw + 3) : bw; ctx.lineJoin = 'miter';
  ctx.stroke();
  ctx.restore();
  /* O NOME ACOMPANHA O EIXO DA PORT: deitada, texto deitado; em pe, texto em pe — igual ao
     nome de pino vertical, que o drawSymbolPart ja desenha em 90. Com a barra em pe e a
     letra deitada, o nome transbordava os 90 mil de largura da barra e brigava com o
     componente ao lado.
     O `% 180` e a trava contra letra de cabeca para baixo: 0 e 90 sao leituras honestas
     (90 le de baixo para cima, como no Altium), 180 e 270 nao — e viram 0 e 90. Espelhar e
     virar a POSICAO, nunca a letra.
     1.94.0: o ALINHAMENTO (esquerda/centro/direita) é o da leitura: a "esquerda" é onde a letra começa — a ponta
     da âncora na port deitada ou em pé, e a outra na de cabeça para baixo. */
  const th = portTxtH(p);
  const al = PORT_ALINHA.includes(p.alinha) ? p.alinha : 'centro';
  let t = g.w / 2, align = 'center';
  if (al !== 'centro'){
    const folga = Math.max(25, th * 0.5);
    const ini = (g.pontaEsq ? g.bico : 0) + folga, fim = g.w - (g.pontaDir ? g.bico : 0) - folga;
    const leDaAncora = g.ang < 180;
    t = (al === 'esquerda') === leDaAncora ? ini : fim;
    align = al === 'esquerda' ? 'left' : 'right';
  }
  worldText(ctx, p.net || '', p.x + g.dir[0] * t, p.y + g.dir[1] * t,
            th, g.ang % 180, letra, align, PORT_FONTES.includes(p.fonte) ? { fonte:p.fonte } : null);
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
  /* ENQUADRAR COM A TELA ESCONDIDA (2026-11-05: "quando troco a revisão, o esquema tá bugando, fica nessa tela e não
     sai mais", com X: NaN Y: NaN): o esquema se recarrega quando o disco muda, e o Voltar da revisão é feito com a aba
     Histórico na frente — o quadro do esquema fica escondido, com 0×0. O fit dava escala min(0/w, 0/h) = 0, e daí em
     diante todo toWorld dividia por zero (NaN) e a roda multiplicava o zero. Agora, sem tamanho, o enquadramento
     fica guardado e acontece no primeiro resize com a tela de verdade (o ResizeObserver abaixo avisa quando a aba
     volta). E uma escala que não presta (0, NaN, infinito) nunca fica: volta para a de antes. */
  let fitPendente = null;
  function resize(){
    DPR = window.devicePixelRatio || 1;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W*DPR); canvas.height = Math.round(H*DPR);
    if (fitPendente && W > 0 && H > 0){ const [bb, m] = fitPendente; fitPendente = null; fit(bb, m); return; }
    draw();
  }
  function fit(bb, margin){
    if (!(W > 0 && H > 0)){ fitPendente = [bb, margin]; return; }
    fitPendente = null;
    const m = margin || 1.15;
    const w = Math.max(bb.x2-bb.x1, 1), h = Math.max(bb.y2-bb.y1, 1);
    cam.cx = (bb.x1+bb.x2)/2; cam.cy = (bb.y1+bb.y2)/2;
    const s = Math.min(W/(w*m), H/(h*m));
    if (s > 0 && isFinite(s)) cam.scale = s;
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
    if (!(cam.scale > 0 && isFinite(cam.scale))) cam.scale = 0.1;
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

/* ---------- AS FORMAS DE DESENHO DO ESQUEMA (1.82.0, 2026-11-06) ----------
   Pedido do dono: "na barra de ferramenta, quero que tenha símbolos geométricos (retângulo, reta, círculo, texto,
   estrela) e outras coisas". Item {"t":"forma", "forma":<FORMAS>, "pts":[[x1,y1],[x2,y2]], cor?, larg?, fundo?,
   traco?, rot?} em mil. Os dois pontos sao as pontas (linha, seta) ou dois cantos opostos da caixa (o resto). O `rot`
   (0/90/180/270) so muda o desenho do que nao e simetrico (triangulo, estrela): girar as outras e trocar os cantos.
   Nao e eletrico: fica fora das nets e da assinatura da aprovacao. */
const FORMAS = ['linha', 'seta', 'ret', 'arred', 'elipse', 'triangulo', 'losango', 'estrela'];
const FORMA_NOME = { linha:'linha', seta:'seta', ret:'retângulo', arred:'retângulo arredondado', elipse:'círculo / elipse',
                     triangulo:'triângulo', losango:'losango', estrela:'estrela' };
const FORMA_COR = '#00008b', FORMA_LARG = 10;
const formaLarg = it => (typeof it.larg === 'number' && it.larg > 0) ? it.larg : FORMA_LARG;
function formaCaixa(it){
  const p = it.pts || [], a = p[0] || [0, 0], b = p[1] || a;
  return { x1:Math.min(a[0], b[0]), y1:Math.min(a[1], b[1]), x2:Math.max(a[0], b[0]), y2:Math.max(a[1], b[1]) };
}
/* a ponta da seta: o triangulo cheio na ponta `b` */
function pontaDaSeta(a, b, larg){
  const vx = b[0] - a[0], vy = b[1] - a[1], L = Math.hypot(vx, vy) || 1, ux = vx / L, uy = vy / L;
  const c = Math.min(L * 0.5, Math.max(60, larg * 5)), m = c * 0.45;
  const bx = b[0] - ux * c, by = b[1] - uy * c;
  return [[bx - uy * m, by + ux * m], [b[0], b[1]], [bx + uy * m, by - ux * m]];
}
/* o contorno como poligono (o mundo e Y para cima): {fechada, pts, ponta?}. A elipse e o arredondado saem em
   pontos tambem: o clique e o PDF usam o mesmo contorno que a tela */
function formaContorno(it){
  const f = it.forma, p = it.pts || [], a = p[0] || [0, 0], b = p[1] || a;
  if (f === 'linha') return { fechada:false, pts:[a, b] };
  if (f === 'seta') return { fechada:false, pts:[a, b], ponta:pontaDaSeta(a, b, formaLarg(it)) };
  const c = formaCaixa(it), cx = (c.x1 + c.x2) / 2, cy = (c.y1 + c.y2) / 2;
  const rx = (c.x2 - c.x1) / 2, ry = (c.y2 - c.y1) / 2;
  if (f === 'elipse'){
    const out = [];
    for (let i = 0; i < 64; i++){ const t = i / 64 * 2 * Math.PI; out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
    return { fechada:true, pts:out };
  }
  if (f === 'arred'){
    const r = Math.min(rx, ry) * 0.3, out = [];
    const cantos = [[c.x2 - r, c.y2 - r, 0], [c.x1 + r, c.y2 - r, 90], [c.x1 + r, c.y1 + r, 180], [c.x2 - r, c.y1 + r, 270]];
    for (const [qx, qy, a0] of cantos)
      for (let i = 0; i <= 8; i++){ const t = (a0 + i * 90 / 8) * Math.PI / 180; out.push([qx + r * Math.cos(t), qy + r * Math.sin(t)]); }
    return { fechada:true, pts:out };
  }
  if (f === 'losango') return { fechada:true, pts:[[cx, c.y2], [c.x2, cy], [cx, c.y1], [c.x1, cy]] };
  if (f === 'triangulo' || f === 'estrela'){
    /* desenhado "em pe" na caixa sem giro e girado pelo `rot`: a caixa girada de 90/270 tem os lados trocados */
    const rot = ((((it.rot || 0) % 360) + 360) % 360);
    const deitado = rot === 90 || rot === 270;
    const hx = deitado ? ry : rx, hy = deitado ? rx : ry;
    let loc;
    if (f === 'triangulo') loc = [[0, hy], [hx, -hy], [-hx, -hy]];
    else {
      loc = [];
      for (let i = 0; i < 10; i++){
        const t = Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? 0.4 : 1;
        loc.push([hx * k * Math.cos(t), hy * k * Math.sin(t)]);
      }
      /* a estrela de 5 pontas nao enche a caixa embaixo: desce o centro para ela ficar no meio */
      const ymin = Math.min.apply(null, loc.map(q => q[1]));
      const d = (-hy - ymin) / 2;
      loc = loc.map(q => [q[0], q[1] + d]);
    }
    const ang = rot * Math.PI / 180, co = Math.cos(ang), si = Math.sin(ang);
    return { fechada:true, pts:loc.map(([x, y]) => [cx + x * co - y * si, cy + x * si + y * co]) };
  }
  /* 'ret' e o que nao for conhecido */
  return { fechada:true, pts:[[c.x1, c.y1], [c.x2, c.y1], [c.x2, c.y2], [c.x1, c.y2]] };
}
function drawForma(ctx, it, opts){
  const o = opts || {};
  const g = formaContorno(it), larg = formaLarg(it), cor = o.cor || it.cor || FORMA_COR;
  if (!g.pts.length) return;
  ctx.save();
  if (o.alfa != null) ctx.globalAlpha = o.alfa;
  ctx.lineWidth = larg; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.setLineDash(it.traco === 'tracejado' ? [larg * 4, larg * 3] : it.traco === 'pontilhado' ? [larg * 0.01, larg * 2.5] : []);
  ctx.beginPath();
  g.pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]));
  if (g.fechada) ctx.closePath();
  if (g.fechada && it.fundo){ ctx.fillStyle = it.fundo; ctx.fill(); }
  ctx.strokeStyle = cor; ctx.stroke();
  if (g.ponta){
    ctx.setLineDash([]);
    ctx.beginPath(); g.ponta.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath();
    ctx.fillStyle = cor; ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
function distSegF(x, y, a, b){
  const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
  const t = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / L2)) : 0;
  return Math.hypot(x - (a[0] + t * vx), y - (a[1] + t * vy));
}
function dentroPoli(x, y, pts){
  let d = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++){
    const a = pts[i], b = pts[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) d = !d;
  }
  return d;
}
/* o clique pega a forma no TRAÇO (com folga), ou dentro dela quando ela tem preenchimento: o retangulo vazio em
   volta de um bloco do circuito nao rouba o clique de quem esta dentro */
function formaPerto(it, x, y, tol){
  const g = formaContorno(it), lim = tol + formaLarg(it) / 2;
  const n = g.pts.length;
  for (let i = 0; i < n - 1 + (g.fechada ? 1 : 0); i++) if (distSegF(x, y, g.pts[i], g.pts[(i + 1) % n]) <= lim) return true;
  if (g.ponta && dentroPoli(x, y, g.ponta)) return true;
  return !!(g.fechada && it.fundo && dentroPoli(x, y, g.pts));
}
/* a caixa do que se ve (o traco inteiro e a ponta da seta dentro) */
function formaBBox(it){
  const g = formaContorno(it), m = formaLarg(it) / 2;
  const pts = g.ponta ? g.pts.concat(g.ponta) : g.pts;
  let x1 = 1e12, y1 = 1e12, x2 = -1e12, y2 = -1e12;
  for (const q of pts){ if (q[0] < x1) x1 = q[0]; if (q[0] > x2) x2 = q[0]; if (q[1] < y1) y1 = q[1]; if (q[1] > y2) y2 = q[1]; }
  return x1 > x2 ? { x1:0, y1:0, x2:0, y2:0 } : { x1:x1 - m, y1:y1 - m, x2:x2 + m, y2:y2 + m };
}

return { SCH, PCB, OD, worldText, roundRect, dePe, drawSymbolPart, mirrorPart, symBBox, drawFootprint,
         drawPowerPort, powerBBox, drawNetLabel, drawPort, portGeom, portBBox, drawJunction, drawNoERC, mkCamera,
         PORT_SETAS, PORT_ALINHA, PORT_FONTES, PORT_IO, PORT_PADRAO, PORT_CAMPOS, portLargura, portEstiloAltium, portEmPe,
         portAcerta, portNova, portEstilo,
         FORMAS, FORMA_NOME, FORMA_COR, FORMA_LARG, formaLarg, formaCaixa, formaContorno, drawForma, formaPerto, formaBBox };
})();
if (typeof module === 'object' && module.exports) module.exports = HubDraw;
