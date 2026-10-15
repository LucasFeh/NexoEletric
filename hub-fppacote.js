/* AltiumPCBMirror - hub-fppacote.js
   O assistente de footprint do editor (hub-fpeditor.js » Tools » Footprint Wizard, o "IPC Compliant
   Footprint Wizard" do Altium reduzido aos pacotes da casa): dos parametros do pacote sai o footprint
   inteiro -- pads numerados como o Altium numera, a serigrafia com a marca do pino 1 e um corpo 3D
   extrudado do tamanho do corpo. Puro (node: tests/test-fppacote.js); o MCP usa o mesmo gerador.

   API (global HubFpPacote)
     TIPOS                          {tipo: {rot, n, passo, span, padX, padY, furo, cx, cy, alt, fil}}
     padrao(tipo)                   copia dos parametros de fabrica do tipo
     nome(tipo, P)                  o nome sugerido (SOIC-8_P1.27, QFP-32_P0.8, DIP-8, SOT-23-3...)
     gera(tipo, P, nome?) -> fp     {name, description, pads, silk, bodies}; Error se P nao fecha

   Parametros (mm):
     n      pinos            passo  distancia entre pinos vizinhos (chip: centro a centro dos 2 pads)
     span   centro a centro entre as fileiras opostas (SOIC, DIP, QFP, SOT-23)
     padX   pad no sentido que sai do corpo   padY  pad no sentido da fileira   furo  0 = SMD
     cx     corpo no sentido da fileira (comprimento)   cy  corpo atravessado (largura)
     alt    altura do corpo (o 3D)   fil  fileiras da barra de pinos (1 ou 2)
   Numeracao: pino 1 no alto da fileira da esquerda e anti-horario (SOIC, DIP, QFP), como no Altium;
   barra de 2 fileiras em zigue-zague (1 em cima, 2 embaixo). Origem no centro do pacote. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HubFpPacote = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const TIPOS = {
  chip:   { rot:'Chip 2 terminais (resistor, capacitor SMD)', n:2, passo:1.9, span:0, padX:1.0, padY:1.45, furo:0, cx:2.0, cy:1.25, alt:0.6, fil:1 },
  soic:   { rot:'SOIC / SOP (2 fileiras, SMD)', n:8, passo:1.27, span:5.4, padX:1.55, padY:0.6, furo:0, cx:4.9, cy:3.9, alt:1.75, fil:2 },
  qfp:    { rot:'QFP / LQFP (4 lados, SMD)', n:32, passo:0.8, span:8.4, padX:1.5, padY:0.55, furo:0, cx:7, cy:7, alt:1.4, fil:4 },
  dip:    { rot:'DIP (2 fileiras, PTH)', n:8, passo:2.54, span:7.62, padX:1.6, padY:1.6, furo:0.8, cx:9.8, cy:6.35, alt:3.3, fil:2 },
  sot23:  { rot:'SOT-23 (3, 5 ou 6 pinos)', n:3, passo:0.95, span:2.2, padX:0.6, padY:1.1, furo:0, cx:2.9, cy:1.3, alt:1.1, fil:2 },
  header: { rot:'Barra de pinos (PTH)', n:4, passo:2.54, span:2.54, padX:1.7, padY:1.7, furo:1.0, cx:0, cy:0, alt:2.5, fil:1 },
};
const STANDOFF = { chip:0, soic:0.1, qfp:0.1, dip:0.5, sot23:0.05, header:0 };
const SILK = 0.15;

const r4 = v => { const x = Math.round(v * 1e4) / 1e4; return x === 0 ? 0 : x; };
const num = v => typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
const fmt = v => String(r4(v));

function padrao(tipo){
  const t = TIPOS[tipo];
  if (!t) throw new Error('tipo de pacote desconhecido: ' + tipo + ' (use ' + Object.keys(TIPOS).join(', ') + ')');
  return Object.assign({}, t);
}

function params(tipo, P){
  const D = padrao(tipo), o = {};
  for (const k of Object.keys(D)) {
    if (k === 'rot') continue;
    const v = P && P[k] !== undefined && P[k] !== '' ? num(P[k]) : D[k];
    if (!isFinite(v)) throw new Error('parâmetro "' + k + '" inválido');
    o[k] = v;
  }
  o.n = Math.round(o.n); o.fil = Math.round(o.fil);
  return o;
}

function nome(tipo, P){
  const p = params(tipo, P);
  if (tipo === 'chip') return 'CHIP_' + fmt(p.cx) + 'x' + fmt(p.cy);
  if (tipo === 'soic') return 'SOIC-' + p.n + '_P' + fmt(p.passo);
  if (tipo === 'qfp') return 'QFP-' + p.n + '_P' + fmt(p.passo);
  if (tipo === 'dip') return 'DIP-' + p.n;
  if (tipo === 'sot23') return 'SOT-23-' + p.n;
  return 'HDR_' + p.fil + 'x' + Math.ceil(p.n / Math.max(1, p.fil)) + '_P' + fmt(p.passo);
}

function gera(tipo, P, nomeFp){
  const p = params(tipo, P);
  for (const k of ['passo', 'padX', 'padY', 'alt']) if (!(p[k] > 0)) throw new Error('"' + k + '" precisa ser maior que zero');
  if (p.furo < 0) throw new Error('"furo" não pode ser negativo');
  const th = p.furo > 0;
  if (th && p.furo >= Math.min(p.padX, p.padY)) throw new Error('o furo (' + fmt(p.furo) + ') precisa ser menor que o pad');
  const pads = [], silk = [];
  /* gira = pad deitado (lados de cima/baixo do QFP): troca X e Y do pad */
  const pad = (n, x, y, gira) => {
    const o = { name:String(n), type:th ? 'th' : 'smd', shape:th ? (n === 1 ? 'rect' : 'circle') : 'rect',
                x:r4(x), y:r4(y), w:r4(gira ? p.padY : p.padX), h:r4(gira ? p.padX : p.padY), rot:0, layer:th ? 'Multi' : 'Top' };
    if (th) { o.drill = r4(p.furo); o.drillshape = 'circle'; o.holerot = 0; }
    pads.push(o);
  };
  const linha = (x1, y1, x2, y2) => silk.push({ kind:'line', x1:r4(x1), y1:r4(y1), x2:r4(x2), y2:r4(y2), w:SILK });
  const ret = (hx, hy) => { linha(-hx, hy, hx, hy); linha(hx, hy, hx, -hy); linha(hx, -hy, -hx, -hy); linha(-hx, -hy, -hx, hy); };
  const marca = (x, y, r) => silk.push({ kind:'arc', cx:r4(x), cy:r4(y), r:r4(r || 0.2), sa:0, ea:360, w:SILK });
  let bx = p.cx / 2, by = p.cy / 2;        /* meia caixa do corpo 3D em X e Y */

  if (tipo === 'chip') {
    if (p.n !== 2) throw new Error('chip tem 2 pinos');
    pad(1, -p.passo / 2, 0); pad(2, p.passo / 2, 0);
    const hy = Math.max(p.cy, p.padY) / 2 + 0.2, hx = p.cx / 2;
    linha(-hx, hy, hx, hy); linha(-hx, -hy, hx, -hy);
  } else if (tipo === 'soic' || tipo === 'dip') {
    if (p.n < 2 || p.n % 2) throw new Error(tipo.toUpperCase() + ' precisa de um número par de pinos');
    if (!(p.span > p.padX)) throw new Error('"span" precisa ser maior que o pad');
    const meio = p.n / 2, y0 = (meio - 1) * p.passo / 2;
    for (let i = 0; i < meio; i++) pad(i + 1, -p.span / 2, y0 - i * p.passo);
    for (let i = 0; i < meio; i++) pad(meio + i + 1, p.span / 2, -y0 + i * p.passo);
    const hx = Math.max(0.2, Math.min(p.cy / 2, p.span / 2 - p.padX / 2 - 0.2)), hy = Math.max(p.cx / 2, y0 + p.padY / 2 + 0.1);
    ret(hx, hy);
    marca(-(p.span / 2 + p.padX / 2 + 0.45), y0, 0.2);
    bx = p.cy / 2; by = p.cx / 2;
  } else if (tipo === 'qfp') {
    if (p.n < 4 || p.n % 4) throw new Error('QFP precisa de um número de pinos múltiplo de 4');
    if (!(p.span > p.padX)) throw new Error('"span" precisa ser maior que o pad');
    const lado = p.n / 4, a0 = (lado - 1) * p.passo / 2, s = p.span / 2;
    let k = 1;
    for (let i = 0; i < lado; i++) pad(k++, -s, a0 - i * p.passo);
    for (let i = 0; i < lado; i++) pad(k++, -a0 + i * p.passo, -s, true);
    for (let i = 0; i < lado; i++) pad(k++, s, -a0 + i * p.passo);
    for (let i = 0; i < lado; i++) pad(k++, a0 - i * p.passo, s, true);
    const h = Math.max(0.2, Math.min(Math.max(p.cx, p.cy) / 2, s - p.padX / 2 - 0.2)), e = a0 + p.padY / 2 + 0.25;
    if (h > e + 0.1) for (const [sx, sy] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) { linha(sx * h, sy * h, sx * h, sy * e); linha(sx * h, sy * h, sx * e, sy * h); }
    else ret(h, h);
    marca(-(s + p.padX / 2 + 0.45), a0, 0.2);
  } else if (tipo === 'sot23') {
    if ([3, 5, 6].indexOf(p.n) < 0) throw new Error('SOT-23 tem 3, 5 ou 6 pinos');
    const e = p.passo, b = -p.span / 2, c = p.span / 2;
    const pos = p.n === 3 ? [[-e, b], [e, b], [0, c]]
      : p.n === 5 ? [[-e, b], [0, b], [e, b], [e, c], [-e, c]]
      : [[-e, b], [0, b], [e, b], [e, c], [0, c], [-e, c]];
    pos.forEach((q, i) => pad(i + 1, q[0], q[1]));
    const hy = Math.max(0.1, p.span / 2 - p.padY / 2 - 0.2), hx = p.cx / 2;
    linha(-hx, -hy, -hx, hy); linha(hx, -hy, hx, hy);
    marca(-(e + p.padX / 2 + 0.35), b, 0.15);
  } else if (tipo === 'header') {
    const fil = p.fil === 2 ? 2 : 1, col = Math.ceil(p.n / fil);
    for (let k = 1; k <= p.n; k++) {
      const c = fil === 2 ? Math.floor((k - 1) / 2) : k - 1, f = fil === 2 ? (k - 1) % 2 : 0;
      pad(k, (c - (col - 1) / 2) * p.passo, fil === 2 ? (f === 0 ? p.passo / 2 : -p.passo / 2) : 0);
    }
    bx = col * p.passo / 2; by = fil * p.passo / 2;
    ret(bx + 0.1, by + 0.1);
    marca(-(bx + 0.5), fil === 2 ? p.passo / 2 : 0, 0.2);
  } else throw new Error('tipo de pacote desconhecido: ' + tipo);

  const corpo = { kind:'extruded', side:'top',
    pts:[[r4(-bx), r4(-by)], [r4(bx), r4(-by)], [r4(bx), r4(by)], [r4(-bx), r4(by)]],
    standoff:STANDOFF[tipo] || 0, height:r4(p.alt), color:'#2b2b2b', opacity:1 };
  return { name:nomeFp || nome(tipo, p), description:TIPOS[tipo].rot + ' · gerado pelo assistente do hub',
           pads, silk, bodies:bx > 0 && by > 0 ? [corpo] : [] };
}

return { TIPOS, padrao, nome, gera };
});
