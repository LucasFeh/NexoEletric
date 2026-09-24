/* AltiumPCBMirror v2 - hub-fio.js — o traçado de FIO como o do Altium.

   O pedido (2026-09-24), com um vídeo do Altium de referência: "quero que a construção de
   trilha funcione assim no esquema, igualzinho". O que o vídeo mostra, quadro a quadro:

     - do último ponto FIXADO saem DUAS pernas até o cursor, em L: a primeira contínua e a
       segunda pontilhada (a "de antecipação");
     - o CLIQUE fixa só a PRIMEIRA perna. O canto vira o ponto novo, e a perna de antecipação
       vira a primeira perna do trecho seguinte — por isso ela sai sempre perpendicular à que
       acabou de ser fixada (a barra do Altium alterna "90 Degree start/end" a cada clique);
     - se a primeira perna tem comprimento zero (o cursor está na linha do ponto), o clique
       fixa a segunda;
     - clicar num ponto elétrico (pino, ponta ou meio de fio, junção, power, port) completa o L
       inteiro até ele e termina o fio;
     - Espaço inverte o canto; Shift+Espaço troca o modo: 90°, 45° e ângulo livre;
     - Backspace desfaz o último canto fixado.

   Este arquivo é PURO — não conhece folha, câmera nem DOM —, e por isso roda em Node
   (tests/test-fio-altium.js). Quem liga ao mouse e desenha é o schframe.js.

   O ESTADO de um fio em curso:
       { pts:[[x,y], ...]   os pontos JÁ FIXADOS (pts[0] é a partida)
         modo:'90'|'45'|'livre'
         primeiro          '90': 'v' | 'h'        — o eixo da primeira perna
                           '45': 'diag' | 'orto'  — a primeira perna é a diagonal ou a reta
         inicial            o `primeiro` da partida — o Backspace volta a ele
         ult:[x,y] }        o último clique: a barra mede dX/dY a partir dele */
"use strict";
const HubFio = (function(){

const MODOS = ['90', '45', 'livre'];
const EPS = 1e-6;
const igual = (a, b) => !!a && !!b && Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;
const copia = p => [p[0], p[1]];

/* as duas pernas de A até o cursor C: devolve o canto K (null quando é uma perna só) */
function canto(A, C, modo, primeiro){
  if (modo === 'livre') return null;
  if (modo === '45'){
    const dx = C[0] - A[0], dy = C[1] - A[1];
    const d = Math.min(Math.abs(dx), Math.abs(dy));
    const diag = [Math.sign(dx) * d, Math.sign(dy) * d];
    /* 'diag': a diagonal sai do ponto e a reta chega no cursor; 'orto': o contrário */
    return primeiro === 'diag' ? [A[0] + diag[0], A[1] + diag[1]] : [C[0] - diag[0], C[1] - diag[1]];
  }
  return primeiro === 'h' ? [C[0], A[1]] : [A[0], C[1]];
}
/* o que se desenha do ponto fixado até o cursor: a perna 1 (contínua) e a 2 (pontilhada) */
function pernas(est, C){
  const A = est.pts[est.pts.length - 1];
  const K = canto(A, C, est.modo, est.primeiro);
  if (!K || igual(K, A) || igual(K, C)) return { perna1: igual(A, C) ? null : [A, C], perna2: null, canto: null };
  return { perna1: [A, K], perna2: [K, C], canto: K };
}
/* o outro valor do `primeiro`, no modo do fio */
function inverte(modo, primeiro){
  if (modo === '45') return primeiro === 'diag' ? 'orto' : 'diag';
  if (modo === 'livre') return primeiro;
  return primeiro === 'h' ? 'v' : 'h';
}
/* o `primeiro` que deixa a proxima perna PERPENDICULAR ao trecho A→B que acabou de ser fixado */
function depoisDe(modo, A, B, primeiroAtual){
  if (modo === '90') return Math.abs(B[0] - A[0]) > EPS ? 'v' : 'h';
  if (modo === '45') return inverte('45', primeiroAtual);
  return primeiroAtual;
}

function novo(p, modo, primeiro){
  const m = MODOS.indexOf(modo) >= 0 ? modo : '90';
  const pr = primeiro || (m === '45' ? 'diag' : 'v');
  return { pts:[copia(p)], modo:m, primeiro:pr, inicial:pr, ult:copia(p) };
}
/* O CLIQUE NO MEIO DO CAMINHO: fixa a primeira perna (ou a segunda, se a primeira não tem
   comprimento). Devolve o estado novo; o de entrada não é tocado. */
function fixa(est, C){
  const e = { pts:est.pts.map(copia), modo:est.modo, primeiro:est.primeiro, inicial:est.inicial, ult:copia(C) };
  const A = e.pts[e.pts.length - 1];
  if (igual(A, C)) return e;
  const K = canto(A, C, e.modo, e.primeiro);
  const ponto = K && !igual(K, A) ? K : C;
  e.pts.push(copia(ponto));
  e.primeiro = depoisDe(e.modo, A, ponto, e.primeiro);
  return e;
}
/* O CLIQUE NUM PONTO ELÉTRICO: o L inteiro até ele — é assim que o fio encosta no pino */
function completa(est, C){
  const e = { pts:est.pts.map(copia), modo:est.modo, primeiro:est.primeiro, inicial:est.inicial, ult:copia(C) };
  const A = e.pts[e.pts.length - 1];
  const K = canto(A, C, e.modo, e.primeiro);
  if (K && !igual(K, A) && !igual(K, C)) e.pts.push(copia(K));
  if (!igual(C, A)) e.pts.push(copia(C));
  return e;
}
/* BACKSPACE: tira o último ponto fixado; sem nada fixado além da partida, o fio acaba (null) */
function desfaz(est){
  if (est.pts.length <= 1) return null;
  const pts = est.pts.slice(0, -1).map(copia);
  let primeiro = est.inicial;
  if (pts.length >= 2) primeiro = depoisDe(est.modo, pts[pts.length - 2], pts[pts.length - 1], est.primeiro);
  return { pts, modo:est.modo, primeiro, inicial:est.inicial, ult:copia(pts[pts.length - 1]) };
}
/* ESPAÇO e SHIFT+ESPAÇO */
function trocaCanto(est){ return Object.assign({}, est, { primeiro: inverte(est.modo, est.primeiro) }); }
function trocaModo(est){
  const modo = MODOS[(MODOS.indexOf(est.modo) + 1) % MODOS.length];
  const primeiro = modo === '45' ? 'diag' : modo === '90' ? 'v' : est.primeiro;
  return Object.assign({}, est, { modo, primeiro });
}

/* O FIO QUE VAI PARA O ARQUIVO: sem ponto repetido e sem vértice no meio de uma reta. Um canto
   que não dobra nada não é canto — só faria o Delete e o arrasto de trecho acharem trechos que
   a mão não fez. O vértice colinear só sai quando o fio SEGUE em frente; se ele volta por
   cima de si mesmo (A→B→A'), o ponto fica, senão o fio encolheria calado. */
function limpa(pts){
  const out = [];
  for (const p of (pts || [])) if (!out.length || !igual(out[out.length - 1], p)) out.push(copia(p));
  for (let i = 1; i < out.length - 1;){
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const cruz = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const segue = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) > 0;
    if (Math.abs(cruz) <= EPS && segue) out.splice(i, 1); else i++;
  }
  return out;
}
/* a frase do modo, para a barra de status */
function nomeDoModo(est){
  if (est.modo === 'livre') return 'ângulo livre';
  if (est.modo === '45') return '45° · ' + (est.primeiro === 'diag' ? 'sai na diagonal' : 'sai reto');
  return '90° · ' + (est.primeiro === 'h' ? 'sai na horizontal' : 'sai na vertical');
}

return { MODOS, canto, pernas, novo, fixa, completa, desfaz, trocaCanto, trocaModo, limpa, nomeDoModo, inverte };
})();
if (typeof module === 'object' && module.exports) module.exports = HubFio;
