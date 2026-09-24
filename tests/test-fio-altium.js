/* O traçado de fio como o do Altium (hub-fio.js), provado sem navegador.

   O caso 1 é o VÍDEO de referência que o usuário mandou (video_referencia/, 2026-09-24),
   refeito clique a clique: o fio sai de um canto, desce, vai para a direita, sobe, volta para a
   esquerda e desce — cada clique fixando só a primeira perna do L e a seguinte saindo
   perpendicular. As coordenadas são do mundo (Y para cima), em mil. */
const assert = require('assert');
const F = require('../hub-fio.js');

/* ── 1. a sequência do vídeo ── */
{
  let e = F.novo([0, 0], '90', 'v');
  /* 4,1 s: cursor para baixo e à direita — a perna 1 desce (vertical), a 2 vai ao cursor */
  let p = F.pernas(e, [300, -200]);
  assert.deepStrictEqual(p.perna1, [[0, 0], [0, -200]]);
  assert.deepStrictEqual(p.perna2, [[0, -200], [300, -200]]);
  /* 5,1 s: clique — fixa SÓ a descida */
  e = F.fixa(e, [300, -200]);
  assert.deepStrictEqual(e.pts, [[0, 0], [0, -200]]);
  assert.strictEqual(e.primeiro, 'h', 'a perna seguinte sai perpendicular: horizontal');
  /* 5,3–6,7 s: a perna de antecipação virou a perna 1 e acompanha o X do cursor */
  p = F.pernas(e, [250, 150]);
  assert.deepStrictEqual(p.perna1, [[0, -200], [250, -200]]);
  assert.deepStrictEqual(p.perna2, [[250, -200], [250, 150]]);
  e = F.fixa(e, [250, 150]);            /* 7,0 s */
  e = F.fixa(e, [40, 100]);             /* 8,3 s */
  e = F.fixa(e, [180, 60]);             /* 9,5 s */
  e = F.fixa(e, [120, 50]);             /* 10,1 s */
  assert.deepStrictEqual(e.pts, [[0, 0], [0, -200], [250, -200], [250, 100], [180, 100], [180, 50]]);
  /* 10,7 s: termina — as pernas soltas não entram; o que fica é o que foi fixado */
  assert.deepStrictEqual(F.limpa(e.pts), e.pts);
  assert.deepStrictEqual(e.ult, [120, 50], 'dX/dY contam do último clique');
}

/* ── 2. primeira perna de comprimento zero: o clique fixa a segunda ── */
{
  let e = F.novo([0, 0], '90', 'v');
  const p = F.pernas(e, [400, 0]);      /* o cursor na linha do ponto: não há descida */
  assert.deepStrictEqual(p.perna1, [[0, 0], [400, 0]]); assert.strictEqual(p.perna2, null);
  e = F.fixa(e, [400, 0]);
  assert.deepStrictEqual(e.pts, [[0, 0], [400, 0]]);
  assert.strictEqual(e.primeiro, 'v', 'depois de um trecho horizontal a perna seguinte é vertical');
  /* clicar em cima do próprio ponto não faz nada */
  assert.deepStrictEqual(F.fixa(e, [400, 0]).pts, e.pts);
}

/* ── 3. clicar num ponto elétrico: o L inteiro até ele ── */
{
  const e = F.completa(F.novo([0, 0], '90', 'h'), [300, 200]);
  assert.deepStrictEqual(e.pts, [[0, 0], [300, 0], [300, 200]]);
  /* alinhado: um trecho só, sem canto repetido */
  assert.deepStrictEqual(F.completa(F.novo([0, 0], '90', 'h'), [0, 200]).pts, [[0, 0], [0, 200]]);
}

/* ── 4. Espaço inverte o canto; Shift+Espaço troca o modo ── */
{
  let e = F.novo([0, 0], '90', 'v');
  e = F.trocaCanto(e);
  assert.strictEqual(e.primeiro, 'h');
  assert.deepStrictEqual(F.pernas(e, [300, 200]).canto, [300, 0]);
  e = F.trocaModo(e); assert.strictEqual(e.modo, '45');
  e = F.trocaModo(e); assert.strictEqual(e.modo, 'livre');
  assert.strictEqual(F.pernas(e, [300, 200]).perna2, null, 'livre: uma perna só, em qualquer ângulo');
  assert.deepStrictEqual(F.fixa(e, [300, 200]).pts, [[0, 0], [300, 200]]);
  e = F.trocaModo(e); assert.strictEqual(e.modo, '90');
  assert.ok(/90°/.test(F.nomeDoModo(e)));
}

/* ── 5. o modo 45° ── */
{
  const e = F.novo([0, 0], '45', 'diag');
  assert.deepStrictEqual(F.pernas(e, [300, 100]).canto, [100, 100], 'diagonal primeiro, reta até o cursor');
  assert.deepStrictEqual(F.pernas(F.trocaCanto(e), [300, 100]).canto, [200, 0], 'reta primeiro, diagonal no fim');
  assert.deepStrictEqual(F.pernas(e, [-300, -100]).canto, [-100, -100], 'vale nos quatro quadrantes');
  const e2 = F.fixa(e, [300, 100]);
  assert.deepStrictEqual(e2.pts, [[0, 0], [100, 100]]); assert.strictEqual(e2.primeiro, 'orto');
}

/* ── 6. Backspace desfaz o último canto; sem canto nenhum, o fio acaba ── */
{
  let e = F.novo([0, 0], '90', 'v');
  e = F.fixa(e, [300, -200]);           /* desce */
  e = F.fixa(e, [300, 100]);            /* direita */
  assert.deepStrictEqual(e.pts, [[0, 0], [0, -200], [300, -200]]); assert.strictEqual(e.primeiro, 'v');
  e = F.desfaz(e);
  assert.deepStrictEqual(e.pts, [[0, 0], [0, -200]]); assert.strictEqual(e.primeiro, 'h', 'volta a sair perpendicular à descida');
  e = F.desfaz(e);
  assert.deepStrictEqual(e.pts, [[0, 0]]); assert.strictEqual(e.primeiro, 'v', 'na partida, o canto de antes');
  assert.strictEqual(F.desfaz(e), null);
}

/* ── 7. o fio que vai para o arquivo: sem ponto repetido nem canto que não dobra ── */
{
  assert.deepStrictEqual(F.limpa([[0, 0], [0, 0], [100, 0], [200, 0], [200, 100]]), [[0, 0], [200, 0], [200, 100]]);
  /* volta por cima de si mesmo: o ponto fica */
  assert.deepStrictEqual(F.limpa([[0, 0], [200, 0], [100, 0]]), [[0, 0], [200, 0], [100, 0]]);
  assert.deepStrictEqual(F.limpa([[5, 5]]), [[5, 5]]);
}

/* ── 8. 45° com a primeira perna de comprimento zero: a seguinte ainda sai do OUTRO tipo ── */
{
  /* 'diag' com o cursor na mesma linha: a diagonal tem zero, o clique fixa a RETA */
  let e = F.fixa(F.novo([0, 0], '45', 'diag'), [500, 0]);
  assert.deepStrictEqual(e.pts, [[0, 0], [500, 0]]);
  assert.strictEqual(e.primeiro, 'diag', 'depois de uma reta, a perna seguinte é a diagonal');
  /* 'orto' com o cursor na diagonal exata: a reta tem zero, o clique fixa a DIAGONAL */
  e = F.fixa(F.novo([0, 0], '45', 'orto'), [300, 300]);
  assert.deepStrictEqual(e.pts, [[0, 0], [300, 300]]);
  assert.strictEqual(e.primeiro, 'orto', 'depois de uma diagonal, a perna seguinte é a reta');
}

/* ── 9. o canto passa para o PRÓXIMO fio: o completa também acerta o `primeiro` ── */
{
  /* L até um pino: desce e vai para a direita; o próximo fio sai na vertical (perpendicular à
     última perna), como o "90 Degree start/end" do Altium */
  const e = F.completa(F.novo([0, 0], '90', 'v'), [300, -200]);
  assert.deepStrictEqual(e.pts, [[0, 0], [0, -200], [300, -200]]);
  assert.strictEqual(e.primeiro, 'v');
  /* reta só (o pino na linha do ponto): o próximo sai perpendicular a ela */
  assert.strictEqual(F.completa(F.novo([0, 0], '90', 'v'), [0, -400]).primeiro, 'h');
}

/* ── 10. o Espaço na partida é o lado a que o Backspace volta; Shift+Espaço lembra o lado ── */
{
  let e = F.trocaCanto(F.novo([0, 0], '90', 'v'));
  assert.strictEqual(e.inicial, 'h', 'o Espaço dado na partida vira o inicial');
  e = F.fixa(e, [400, 300]);
  assert.strictEqual(F.desfaz(e).primeiro, 'h', 'o Backspace volta ao lado escolhido, não ao de antes');
  /* com canto fixado, o Espaço não mexe no inicial */
  assert.strictEqual(F.trocaCanto(e).inicial, 'h');
  /* o ciclo 90 → 45 → livre → 90 volta ao lado lembrado de cada modo */
  const lembra = { p90:'h', p45:'orto' };
  let m = F.trocaModo(F.novo([0, 0], '90', 'h'), lembra);
  assert.strictEqual(m.modo, '45'); assert.strictEqual(m.primeiro, 'orto');
  m = F.trocaModo(F.trocaModo(m, lembra), lembra);
  assert.strictEqual(m.modo, '90'); assert.strictEqual(m.primeiro, 'h');
  /* lado lembrado estragado cai no padrão do modo */
  assert.strictEqual(F.trocaModo(F.novo([0, 0], '90', 'v'), { p45:'xyz' }).primeiro, 'diag');
}

/* ── 11. nada muda o estado de quem chamou ── */
{
  const e = F.novo([0, 0], '90', 'v'), antes = JSON.stringify(e);
  F.fixa(e, [100, 100]); F.completa(e, [100, 100]); F.trocaCanto(e); F.trocaModo(e);
  assert.strictEqual(JSON.stringify(e), antes);
}

console.log('test-fio-altium: OK');
