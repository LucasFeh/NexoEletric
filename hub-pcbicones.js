/* AltiumPCBMirror v2 - hub-pcbicones.js — os icones da vista PCB (barra e painel).

   O mesmo desenho dos ICONS do editor de simbolos (hub-symed.js), a pedido do dono ("uma barra
   de ferramenta em cima ... igual a dos simbolos"): 16x16, traco em currentColor, sem emoji nem
   fonte de icone. O construtor de la e interno ao modulo dele, entao a grafia e o construtor
   moram aqui tambem, com a MESMA convencao:
     'M...'        = path
     c:cx,cy,r     = circulo
     e:cx,cy,rx,ry = elipse
     r:x,y,w,h     = retangulo
     '|'           separa as partes
   Os que coincidem com o editor de simbolos (select, line, rect, poly, arc, label, undo, redo,
   fit, grid, eye) sao copia literal dos de la: e o "igual a dos simbolos".

   UMD como o hub-font.js: module.exports em Node (so a tabela tem uso la), global no navegador. */
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubPcbIcones = m;
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const ICONES = {
  /* edicao */
  cadeado:    'r:3.5,7,9,7|M5.5 7 V5 A2.5 2.5 0 0 1 10.5 5 V7',
  cadeadoAb:  'r:3.5,7,9,7|M5.5 7 V5 A2.5 2.5 0 0 1 10.3 3.6',
  select:     'M3 2 L3 12.5 L6.2 9.8 L8.4 14 L10.4 13 L8.2 8.8 L12.2 8.4 Z',
  /* roteamento */
  trilha:     'M2 13 H6.5 L11 8.5 V3|c:2,13,1.2|c:11,3,1.2',
  via:        'c:8,8,5.5|c:8,8,2',
  /* desenho na camada atual (os do editor de simbolos onde existem) */
  linha:      'M3 13 L13 3',
  arco:       'M3 13 A10 10 0 0 1 13 3',
  circulo:    'c:8,8,5.5',
  retangulo:  'r:2.5,3.5,11,9',
  triangulo:  'M8 2.5 L14 13.5 H2 Z',
  poligono:   'M8 2 L14 6.5 L11.7 13.5 L4.3 13.5 L2 6.5 Z',
  texto:      'M3 3.5 H13 M8 3.5 V13',
  preencher:  'r:2.5,4,11,8|M2.5 9.5 L8 4 M6.5 12 L13.5 5 M11 12 L13.5 9.5',
  /* placa */
  furo:       'r:2,2,12,12|c:8,8,3.2',
  contorno:   'r:2,3,12,10|c:2,3,1|c:14,3,1|c:14,13,1|c:2,13,1',
  pad:        'c:8,8,5|c:8,8,1.8',
  pour:       'M2.5 2.5 H13.5 V13.5 H2.5 Z|M2.5 6.5 L6.5 2.5 M2.5 10.5 L10.5 2.5 M5.5 13.5 L13.5 5.5 M9.5 13.5 L13.5 9.5',
  /* medir e sinalizar */
  medir:      'M2 11.5 L11.5 2 L14 4.5 L4.5 14 Z|M5 9 L6.5 10.5 M7.2 6.8 L8.7 8.3 M9.4 4.6 L10.9 6.1',
  sinalizar:  'M4 14.5 V2|M4 2.5 H12.5 L10.5 5.5 L12.5 8.5 H4',
  /* historico */
  desfazer:   'M3 7 H10 A3.5 3.5 0 0 1 10 14 H7 M6 4 L3 7 L6 10',
  refazer:    'M13 7 H6 A3.5 3.5 0 0 0 6 14 H9 M10 4 L13 7 L10 10',
  /* saidas */
  gerber:     'M8 2 L14 5 L8 8 L2 5 Z|M2 8 L8 11 L14 8|M2 11 L8 14 L14 11',
  pdf:        'M4 1.5 H10 L13 4.5 V14.5 H4 Z|M10 1.5 V4.5 H13|M6 9 H11 M6 11.5 H11',
  csv:        'r:2,2.5,12,11|M2 6 H14 M2 9.5 H14 M6.5 2.5 V13.5',
  salvar:     'M2.5 2.5 H11.5 L13.5 4.5 V13.5 H2.5 Z|M5 2.5 V6 H10.5 V2.5|r:5,9,6,4.5',
  baixar:     'M8 2 V10.5 M4.5 7 L8 10.5 L11.5 7|M2.5 13.5 H13.5',
  /* vista */
  fit:        'M2 6 V2 H6 M10 2 H14 V6 M14 10 V14 H10 M6 14 H2 V10',
  grid:       'M5.5 2 V14 M10.5 2 V14 M2 5.5 H14 M2 10.5 H14',
  eye:        'M1.5 8 C3.5 4.6 5.8 3 8 3 C10.2 3 12.5 4.6 14.5 8 C12.5 11.4 10.2 13 8 13 C5.8 13 3.5 11.4 1.5 8 Z|c:8,8,2.2',
  eyeOff:     'M1.5 8 C3.5 4.6 5.8 3 8 3 C10.2 3 12.5 4.6 14.5 8 C12.5 11.4 10.2 13 8 13 C5.8 13 3.5 11.4 1.5 8 Z|c:8,8,2.2|M2.5 13.5 L13.5 2.5',
  virar:      'M2 5 H11 M8.5 2.5 L11 5 L8.5 7.5|M14 11 H5 M7.5 8.5 L5 11 L7.5 13.5',
  unica:      'r:2,4,12,8|M2 8 H14',
  fantasma:   'r:2,2,7,7|M7 7 H14 V14 H7 Z',
  girar:      'M13 8 A5 5 0 1 1 10.5 3.7 M10.5 1.2 V3.7 H13',
  espelho:    'M8 2 V14 M6 5 L2 8 L6 11 M10 5 L14 8 L10 11',
  apagar:     'M3 4.5 H13 M6.5 4.5 V3 H9.5 V4.5 M4.5 4.5 L5.2 13.5 H10.8 L11.5 4.5 M7 7 V11 M9 7 V11',
  ajuda:      'c:8,8,6|M6.2 6.2 A1.9 1.9 0 1 1 8 8.4 V9.6|M8 11.8 V11.9',
  paineis:    'r:2,2.5,12,11|M10 2.5 V13.5',
};

const SVG = 'http://www.w3.org/2000/svg';
/* o mesmo construtor do hub-symed.js » icon(): devolve um <svg> pronto para o DOM */
function icone(spec) {
  const s = document.createElementNS(SVG, 'svg');
  [['viewBox', '0 0 16 16'], ['width', '16'], ['height', '16'], ['fill', 'none'], ['stroke', 'currentColor'],
   ['stroke-width', '1.6'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']]
    .forEach(([k, v]) => s.setAttribute(k, v));
  const txt = ICONES[spec] || spec || '';
  for (const parte of String(txt).split('|')) {
    if (!parte) continue;
    const m = parte.match(/^([cer]):(.+)$/);
    let n;
    if (!m) { n = document.createElementNS(SVG, 'path'); n.setAttribute('d', parte); }
    else {
      const v = m[2].split(',');
      if (m[1] === 'c') { n = document.createElementNS(SVG, 'circle'); n.setAttribute('cx', v[0]); n.setAttribute('cy', v[1]); n.setAttribute('r', v[2]); }
      else if (m[1] === 'e') { n = document.createElementNS(SVG, 'ellipse'); n.setAttribute('cx', v[0]); n.setAttribute('cy', v[1]); n.setAttribute('rx', v[2]); n.setAttribute('ry', v[3]); }
      else { n = document.createElementNS(SVG, 'rect'); n.setAttribute('x', v[0]); n.setAttribute('y', v[1]); n.setAttribute('width', v[2]); n.setAttribute('height', v[3]); }
    }
    s.append(n);
  }
  return s;
}

return { ICONES, icone };
});
