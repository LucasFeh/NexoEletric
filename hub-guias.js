/* AltiumPCBMirror v2 - hub-guias.js — as GUIAS do arrasto, como as do Figma.

   O pedido (2026-09-24): "quando eu movimento um componente, mostra equidistância, se está
   centralizado ou não; se eu quero enfileirar várias coisas, mostra a distância entre elas
   enquanto eu posiciono". São três coisas, e as duas primeiras GRUDAM:

     ALINHAMENTO   borda com a borda do MESMO lado e centro com centro da caixa dos vizinhos
                   (e o centro da folha); ponta quente de pino com ponta quente de pino, vértice de fio,
                   power, port, rótulo e junção — é isso que deixa o fio RETO, que numa folha
                   de esquema vale mais que a caixa bonita
     ESPAÇO IGUAL  centralizado entre os dois vizinhos, ou com o mesmo vão que a fila já tem
     DISTÂNCIA     o vão até o vizinho mais próximo em cada direção, ao vivo

   A guia gruda POR EIXO: alinhar em Y não prende o X. O eixo que nenhuma guia pegou continua
   pousando na grade ao soltar, como sempre. Por isso as medidas são desenhadas na posição de
   POUSO, e não na do cursor: o número que aparece durante o arrasto é o número que fica.

   O ÍMÃ DA GUIA, E A TRAVADA. Toda guia gruda — alinhamento de caixa, de pino e espaço igual —,
   e gruda FORA da grade se for preciso: é o pedido do usuário (2026-09-24, "quando achar
   alinhamento, tipo centro com centro, ele tenha efeito magnético, dá uma travada pra ajudar no
   ajuste"). Houve uma versão em que caixa e espaço só grudavam num passo da grade; numa folha
   métrica com a grade de 100 mil isso queria dizer que centro com centro NUNCA grudava.
   A travada é histerese: a guia PEGA a SNAP_PX do cursor e só SOLTA a SOLTA_PX — o ajuste fino
   não escapa da guia por um tremor da mão. A guia presa não bloqueia as outras: se outro
   alinhamento chegar mais perto do cursor que ela, ele toma o lugar, e nada fica inalcançável.
   O que a travada custa é conhecido: centro com centro pode deixar os pinos fora da grade, e
   perto de um pino alinhado ganha o que estiver mais perto do cursor. A barra de status diz qual
   guia pegou, o Ctrl solta, e o botão de guias da vista desliga tudo.
   O que diminui o grude é a MESMA-BORDA: esquerda só alinha com esquerda, direita com direita
   (e em Y, base com base, topo com topo). Esquerda de um com direita do outro é encostar as
   caixas — pino tocando pino —, e no esquema quase nunca é o que se quer; eram 2 das 5 retas de
   cada vizinho, e as que mais grudavam à toa.

   Este arquivo é PURO e não conhece a folha: quem diz o que se move e o que está parado é o
   schframe.js (guiasDoGesto). Assim ele roda em Node (tests/test-guias.js) e serve à vista
   PCB no dia em que ela pedir o mesmo. As unidades são as do mundo de quem chama; só o
   `eps` ("é a mesma coordenada") depende delas, e vem de fora.

   DESEMPENHO. O arrasto já redesenha a folha inteira a cada quadro, e as guias não podem
   pesar nisso:
     - o que se move é medido UMA vez por gesto, na posição de partida, e fica ORDENADO num
       Float64Array. O arrasto só soma o deslocamento, e somar uma constante não muda a ordem,
       então cada consulta é uma busca binária;
     - o que está parado também é medido uma vez. Por quadro só se escolhe a VIZINHANÇA (os K
       mais perto), numa passada linear e sem ordenar a folha;
     - o desenho são algumas linhas e rótulos por cima do quadro que já ia sair.

   POR QUE SÓ A VIZINHANÇA. Uma folha real tem centenas de pinos e vértices, e cada um é uma
   reta candidata em cada eixo. Com todos valendo, numa folha densa sempre haveria uma reta a
   poucos px do cursor: o componente grudaria em qualquer coisa, nunca pousaria na grade e a
   guia viraria ruído. Quem arruma a folha está alinhando com o vizinho, não com um pino do
   outro lado da página — então valem os K objetos mais perto, dentro de PERTO_PX de tela, e
   o espaço igual só conta vão até ALCANCE_PX (o mesmo alcance em que a cota é desenhada:
   grudar num vão que não aparece seria um pulo sem explicação).
   A exceção são os vértices do próprio fio que se move (e dos fios que o elástico puxa): são
   exatamente as retas que deixam aquele fio reto, e entram sempre.
   Os números abaixo foram MEDIDOS em quatro projetos reais (SHP2, MIF, PRJ-UR, PESDA; ~40 mil
   arrastos sorteados, zoom de "caber a folha" = 1x, grade de 100 mil):
     - a primeira versão (8 caixas, 16 pontos, 400 px, 6 px, sem mesma-borda) grudava em 78%
       dos movimentos a 2x, e metade dos pontos da grade ficava inalcançável sem o Ctrl;
     - com a caixa presa à grade: 31/26/18% a 1x/2x/4x, e 73/98/99% dos pontos alcançáveis —
       mas centro com centro não grudava nas folhas métricas, e foi o que o usuário pediu;
     - HOJE (ímã em tudo, mesma-borda, travada 5→12 px): gruda em 57/53/38%, e 42/80/96% dos
       pontos da grade são alcançáveis (27/63/86% se a mão passa por uma guia no caminho e a
       travada a segura). É o preço do ímã, e ele é conhecido: o Ctrl solta e o botão das guias
       desliga. Afrouxar para 4→10 px dá 48% de grude e 86% de alcance a 2x.
   Custo: ~0,05 ms por movimento e ~0,5 ms para montar o gesto. */
"use strict";
const HubGuias = (function(){

const SNAP_PX    = 5;    /* raio de captura, em px de TELA: a guia pega igual em qualquer zoom */
const SOLTA_PX   = 12;   /* a travada: a guia que pegou só solta com o cursor a esta distância */
const PERTO_PX   = 300;  /* até onde (px de tela) um objeto ainda conta como vizinho */
const ALCANCE_PX = 600;  /* o maior vão (px de tela) que o espaço igual e a cota consideram */
const K_CAIXAS   = 4;    /* vizinhos com caixa (componentes, ou textos quando se move texto) */
const K_PONTOS   = 8;    /* vizinhos pontuais: vértice de fio, power, port, rótulo, junção */
const COR       = '#e0197d';               /* magenta: nenhuma outra coisa na folha tem esta cor */
const COR_FAIXA = 'rgba(224,25,125,0.14)';

/* o 1e-4 do snapPasso do schframe: sem o corte, a coordenada acumula sujeira de float a cada
   gesto e o pino que devia coincidir fica a 1e-13 do fio */
const arred = v => Math.round(v * 1e4) / 1e4;

function lowerBound(a, v){
  let lo = 0, hi = a.length;
  while (lo < hi){ const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
  return lo;
}
function une(a, b){
  if (!a) return b ? { x1:b.x1, y1:b.y1, x2:b.x2, y2:b.y2 } : null;
  if (!b) return a;
  return { x1:Math.min(a.x1, b.x1), y1:Math.min(a.y1, b.y1), x2:Math.max(a.x2, b.x2), y2:Math.max(a.y2, b.y2) };
}
const desloca = (b, dx, dy) => ({ x1:b.x1 + dx, y1:b.y1 + dy, x2:b.x2 + dx, y2:b.y2 + dy });
function distCaixas(a, b){
  const gx = Math.max(0, b.x1 - a.x2, a.x1 - b.x2), gy = Math.max(0, b.y1 - a.y2, a.y1 - b.y2);
  return Math.hypot(gx, gy);
}

/* ── FEIÇÕES ──
   Uma feição é uma reta candidata num eixo: `v` é a coordenada nesse eixo, `lo..hi` o que ela
   ocupa no OUTRO eixo (para a guia saber de onde a onde ir e onde pôr o ×).
   `cls` separa os dois mundos que não se misturam: 'vis' (borda/centro de caixa) e 'el'
   (ponto de conexão). Pino alinhado com a borda de um corpo não quer dizer nada.
   `qual` diz QUE reta da caixa ela é ('ini' = esquerda/base, 'centro', 'fim' = direita/topo):
   caixa só alinha com a mesma reta da outra (veja a mesma-borda no cabeçalho). */
function feicoesCaixa(b, eixo, nome, obj){
  const X = eixo === 'x';
  const a1 = X ? b.x1 : b.y1, a2 = X ? b.x2 : b.y2, lo = X ? b.y1 : b.x1, hi = X ? b.y2 : b.x2;
  return [{ v:a1,            cls:'vis', qual:'ini',    lo, hi, nome, obj },
          { v:(a1 + a2) / 2, cls:'vis', qual:'centro', lo, hi, nome, obj },
          { v:a2,            cls:'vis', qual:'fim',    lo, hi, nome, obj }];
}
function feicaoPonto(p, eixo, obj){
  return eixo === 'x' ? { v:p.x, cls:'el', lo:p.y, hi:p.y, pt:true, nome:p.nome || '', obj }
                      : { v:p.y, cls:'el', lo:p.x, hi:p.x, pt:true, nome:p.nome || '', obj };
}
const casam = (m, f) => m.cls === f.cls && (m.cls === 'el' || m.qual === f.qual);

/* ── PREPARA: uma vez por gesto ──
   mov   = { caixa:{x1,y1,x2,y2}|null, tipoCaixa:'comp'|'texto', nome,
             pontos:[{ x, y, nome, eixos:'xy'|'x'|'y' }] }
           `eixos` existe para o trecho de fio, que o schframe só deixa andar na perpendicular:
           um trecho horizontal não sai do lugar em X, e uma guia em X seria mentira.
   fixos = { caixas:[{ x1,y1,x2,y2, nome, tipo:'comp'|'texto', pontos:[{x,y,nome}] }],
             pontos:[{x,y,nome}],   (disputam a vizinhança)
             sempre:[{x,y,nome}],   (entram sempre — os vértices parados dos fios que andam)
             folha:{x1,y1,x2,y2}|null }
   opts  = { eps } — "é a mesma coordenada", na unidade do mundo */
function prepara(mov, fixos, opts){
  mov = mov || {}; fixos = fixos || {};
  const eps = opts && opts.eps > 0 ? opts.eps : 0.1;
  const caixa = mov.caixa ? { x1:mov.caixa.x1, y1:mov.caixa.y1, x2:mov.caixa.x2, y2:mov.caixa.y2 } : null;
  const fx = [], fy = [];
  if (caixa){ fx.push(...feicoesCaixa(caixa, 'x', mov.nome || '')); fy.push(...feicoesCaixa(caixa, 'y', mov.nome || '')); }
  let caixaPts = null;
  for (const p of (mov.pontos || [])){
    const e = p.eixos || 'xy';
    if (e.indexOf('x') >= 0) fx.push(feicaoPonto(p, 'x'));
    if (e.indexOf('y') >= 0) fy.push(feicaoPonto(p, 'y'));
    caixaPts = une(caixaPts, { x1:p.x, y1:p.y, x2:p.x, y2:p.y });
  }
  const ordena = l => { l.sort((a, b) => a.v - b.v); return { f:l, v:Float64Array.from(l, f => f.v) }; };
  const temEl = fx.some(f => f.cls === 'el') || fy.some(f => f.cls === 'el');
  const G = { eps, caixa, tipoCaixa: caixa ? (mov.tipoCaixa || 'comp') : null,
              box0: une(caixa, caixaPts), mx: ordena(fx), my: ordena(fy),
              caixas: [], pontos: [], sempre: [], folha: null, filas: [] };
  if (!G.box0) return G;
  const temVis = !!caixa;
  for (const c of (fixos.caixas || [])){
    const o = { box:{ x1:c.x1, y1:c.y1, x2:c.x2, y2:c.y2 }, nome:c.nome || '', fx:[], fy:[] };
    if (temVis){ o.fx.push(...feicoesCaixa(o.box, 'x', o.nome, o)); o.fy.push(...feicoesCaixa(o.box, 'y', o.nome, o)); }
    if (temEl) for (const p of (c.pontos || [])){ o.fx.push(feicaoPonto(p, 'x', o)); o.fy.push(feicaoPonto(p, 'y', o)); }
    if (o.fx.length) G.caixas.push(o);
    /* a fila (espaço igual e distância) e so entre componentes, e so quando o que anda e
       componente: medir o vão entre um designador e um corpo nao ajuda ninguém */
    if (G.tipoCaixa === 'comp' && c.tipo !== 'texto') G.filas.push({ x1:c.x1, y1:c.y1, x2:c.x2, y2:c.y2, nome:o.nome });
  }
  if (temEl){
    const objPt = p => { const o = { box:{ x1:p.x, y1:p.y, x2:p.x, y2:p.y }, nome:p.nome || '' }; o.fx = [feicaoPonto(p, 'x', o)]; o.fy = [feicaoPonto(p, 'y', o)]; return o; };
    for (const p of (fixos.pontos || [])) G.pontos.push(objPt(p));
    for (const p of (fixos.sempre || [])) G.sempre.push(objPt(p));
  }
  if (temVis && fixos.folha){
    const f = fixos.folha;
    G.folha = { fx:[{ v:(f.x1 + f.x2) / 2, cls:'vis', qual:'centro', lo:f.y1, hi:f.y2, nome:'folha', rotulo:f.rotulo, semMarca:true }],
                fy:[{ v:(f.y1 + f.y2) / 2, cls:'vis', qual:'centro', lo:f.x1, hi:f.x2, nome:'folha', rotulo:f.rotulo, semMarca:true }] };
  }
  return G;
}

/* ── A VIZINHANÇA: os K mais perto, sem ordenar a folha ──
   Inserção num topo de tamanho fixo: uma passada, nenhum array do tamanho da folha por quadro. */
function poeNoTopo(top, k, o, d){
  if (top.length >= k && d >= top[top.length - 1].d) return;
  let i;
  if (top.length < k){ top.push(null); i = top.length - 1; } else i = k - 1;
  while (i > 0 && top[i - 1].d > d){ top[i] = top[i - 1]; i--; }
  top[i] = { o, d };
}
function vizinhanca(G, M, perto){
  const tc = [], tp = [];
  for (const o of G.caixas){ const d = distCaixas(M, o.box); if (d <= perto) poeNoTopo(tc, K_CAIXAS, o, d); }
  for (const o of G.pontos){ const d = distCaixas(M, o.box); if (d <= perto) poeNoTopo(tp, K_PONTOS, o, d); }
  const fx = [], fy = [];
  const poe = o => { for (const f of o.fx) fx.push(f); for (const f of o.fy) fy.push(f); };
  for (const t of tc) poe(t.o);
  for (const t of tp) poe(t.o);
  for (const o of G.sempre) poe(o);
  if (G.folha) poe(G.folha);
  return { fx, fy };
}

/* ── ALINHAMENTO: a reta mais perto, num eixo ──
   Para cada feição parada, a busca binária acha as feições móveis que, com o deslocamento `d`,
   caem a menos de `tol` dela. Ganha a mais perto; empate vai para o ponto de conexão. */
function melhorAlinha(mov, feats, d, tol){
  let best = null;
  const v = mov.v;
  for (const f of feats){
    const alvo = f.v - d;
    for (let i = lowerBound(v, alvo - tol); i < v.length && v[i] <= alvo + tol; i++){
      const m = mov.f[i];
      if (!casam(m, f)) continue;
      const dist = Math.abs(v[i] - alvo), prio = f.cls === 'el' ? 0 : 2;
      if (best && !(dist < best.dist - 1e-9 || (Math.abs(dist - best.dist) <= 1e-9 && prio < best.prio))) continue;
      best = { tipo:'alinha', delta:arred(f.v - m.v), dist, prio, f, m };
    }
  }
  return best;
}

/* ── A FILA: quem está na mesma linha, e os vizinhos de cada lado ──
   Linha = caixas que se sobrepõem à caixa móvel no OUTRO eixo. O `lim` de antesDe/depoisDe
   leva a tolerância, para o vizinho valer mesmo quando o cursor passou um pouco do ponto (a
   caixa encosta ou invade uns mil). */
function eixos(eixo){
  return eixo === 'x' ? { a1:'x1', a2:'x2', b1:'y1', b2:'y2' } : { a1:'y1', a2:'y2', b1:'x1', b2:'x2' };
}
/* A e B dividem a mesma faixa no OUTRO eixo — so assim o vão entre eles e um vão de fila */
const sobrepoe = (A, B, k, e) => A[k.b1] < B[k.b2] - e && A[k.b2] > B[k.b1] + e;
function filaDe(G, M, k, e){
  const out = [];
  for (const o of G.filas) if (sobrepoe(o, M, k, e)) out.push(o);
  return out;
}
function antesDe(fila, alvo, lim, k){       /* a caixa que termina mais perto antes de `lim` */
  let r = null;
  for (const o of fila) if (o !== alvo && o[k.a2] <= lim && (!r || o[k.a2] > r[k.a2])) r = o;
  return r;
}
function depoisDe(fila, alvo, lim, k){      /* a caixa que começa mais perto depois de `lim` */
  let r = null;
  for (const o of fila) if (o !== alvo && o[k.a1] >= lim && (!r || o[k.a1] < r[k.a1])) r = o;
  return r;
}
/* os candidatos a espaço igual num eixo, para a caixa M (já deslocada, e com o OUTRO eixo já
   no lugar em que vai pousar — a fila depende dele):
     centro — o meio exato entre o vizinho de antes e o de depois
     fila   — o mesmo vão que o vizinho tem com o vizinho DELE, de qualquer um dos lados
   Todo vão envolvido cabe no `alcance`.
   `quer` (opcional) aceita SÓ o candidato igual a ele (mesmo `como`, mesmos vizinhos): é assim
   que a travada confere se o espaço igual que pegou ainda existe, com o raio de soltar. */
function melhorEspaco(G, eixo, M, tol, alcance, quer){
  const k = eixos(eixo), e = G.eps;
  const fila = filaDe(G, M, k, e);
  if (!fila.length) return null;
  const L = antesDe(fila, null, M[k.a1] + tol, k), R = depoisDe(fila, null, M[k.a2] - tol, k);
  const W = M[k.a2] - M[k.a1];
  let best = null;
  const tenta = (t, vao, info) => {
    if (!(vao > e && vao <= alcance)) return;
    if (quer && !(info.como === quer.como && info.A === quer.A && info.B === quer.B)) return;
    const dist = Math.abs(t - M[k.a1]);
    if (dist > tol || (best && dist >= best.dist - 1e-9)) return;
    best = Object.assign({ tipo:'espaco', delta:arred(t - G.caixa[k.a1]), dist, prio:1, g:vao }, info);
  };
  if (L && R) tenta((L[k.a2] + R[k.a1] - W) / 2, (R[k.a1] - L[k.a2] - W) / 2, { como:'centro', A:L, B:R });
  if (L){
    const LL = antesDe(fila, L, L[k.a1] + e, k);
    if (LL && sobrepoe(LL, L, k, e)) tenta(L[k.a2] + (L[k.a1] - LL[k.a2]), L[k.a1] - LL[k.a2], { como:'fila', A:LL, B:L });
  }
  if (R){
    const RR = depoisDe(fila, R, R[k.a2] - e, k);
    if (RR && sobrepoe(R, RR, k, e)) tenta(R[k.a1] - (RR[k.a1] - R[k.a2]) - W, RR[k.a1] - R[k.a2], { como:'fila', A:R, B:RR });
  }
  return best;
}
function escolhe(a, b){
  if (!a) return b; if (!b) return a;
  if (Math.abs(a.dist - b.dist) <= 1e-9) return a.prio <= b.prio ? a : b;
  return a.dist < b.dist ? a : b;
}

/* ── O QUE SE DESENHA, na posição de pouso ── */
function guiasEm(G, viz, lx, ly){
  const e = G.eps, out = [];
  for (const eixo of ['x', 'y']){
    const mov = eixo === 'x' ? G.mx : G.my, feats = eixo === 'x' ? viz.fx : viz.fy;
    const d = eixo === 'x' ? lx : ly, dOutro = eixo === 'x' ? ly : lx;
    const grupos = new Map();
    for (const f of feats){
      const alvo = f.v - d;
      for (let i = lowerBound(mov.v, alvo - e); i < mov.v.length && mov.v[i] <= alvo + e; i++){
        const m = mov.f[i];
        if (!casam(m, f)) continue;
        const chave = Math.round(f.v / e);
        let g = grupos.get(chave);
        if (!g){ g = { eixo, v:f.v, lo:Infinity, hi:-Infinity, marcas:[], vistos:new Set() }; grupos.set(chave, g); }
        poeFeicao(g, f, 0);
        poeFeicao(g, m, dOutro);
      }
    }
    for (const g of grupos.values()){ delete g.vistos; out.push(g); }
  }
  return out;
}
function poeFeicao(g, f, dOutro){
  if (g.vistos.has(f)) return;
  g.vistos.add(f);
  const lo = f.lo + dOutro, hi = f.hi + dOutro;
  if (lo < g.lo) g.lo = lo; if (hi > g.hi) g.hi = hi;
  if (f.semMarca) return;
  const ponto = w => g.eixo === 'x' ? [g.v, w] : [w, g.v];
  g.marcas.push(ponto(lo));
  if (!f.pt) g.marcas.push(ponto(hi));
}
/* o vão até o vizinho mais perto de cada lado, e quais vãos são iguais.
   Vãos declarados iguais saem com o MESMO número na pílula: iguais a menos de `eps` podem cair
   dos dois lados do arredondamento ("400 mil" e "400,1 mil" pintados como iguais). */
function medidasEm(G, M, alcance){
  const e = G.eps, out = [];
  for (const eixo of ['x', 'y']){
    const k = eixos(eixo), fila = filaDe(G, M, k, e);
    if (!fila.length) continue;
    const L = antesDe(fila, null, M[k.a1] + e, k), R = depoisDe(fila, null, M[k.a2] - e, k);
    const gL = L ? M[k.a1] - L[k.a2] : -1, gR = R ? R[k.a1] - M[k.a2] : -1;
    const vaoL = gL > e && gL <= alcance, vaoR = gR > e && gR <= alcance;
    const medidas = [];
    /* `lado`: a que grupo de vãos iguais a cota pertence ('L', 'R') — ou null, vão sozinho */
    const mede = (A, B, lado) => {
      const lo = Math.max(A[k.b1], B[k.b1]), hi = Math.min(A[k.b2], B[k.b2]);
      if (lo > hi) return;
      medidas.push({ eixo, a:A[k.a2], b:B[k.a1], em:(lo + hi) / 2, lo, hi, valor:B[k.a1] - A[k.a2], igual:!!lado, lado });
    };
    let refL = null, refR = null;
    if (vaoL){
      const LL = antesDe(fila, L, L[k.a1] + e, k), g = LL && sobrepoe(LL, L, k, e) ? L[k.a1] - LL[k.a2] : -1;
      if (g > e && Math.abs(g - gL) <= e){ mede(LL, L, 'L'); refL = g; }
    }
    if (vaoR){
      const RR = depoisDe(fila, R, R[k.a2] - e, k), g = RR && sobrepoe(R, RR, k, e) ? RR[k.a1] - R[k.a2] : -1;
      if (g > e && Math.abs(g - gR) <= e){ mede(R, RR, 'R'); refR = g; }
    }
    /* centralizado: os dois lados viram um grupo so */
    if (vaoL && vaoR && Math.abs(gL - gR) <= e){ refL = refR = refL !== null ? refL : refR !== null ? refR : gL; }
    if (vaoL) mede(L, M, refL !== null ? 'L' : null);
    if (vaoR) mede(M, R, refR !== null ? 'R' : null);
    for (const m of medidas){
      if (m.lado) m.valor = m.lado === 'L' ? refL : refR;
      delete m.lado;
      out.push(m);
    }
  }
  return out;
}

function rotuloDe(c, fmt){
  if (!c || c.tipo === 'fixo') return '';
  if (c.tipo === 'espaco'){
    if (c.como === 'centro') return 'centralizado entre ' + c.A.nome + ' e ' + c.B.nome;
    return 'mesmo vão de ' + c.A.nome + '–' + c.B.nome + (fmt ? ': ' + fmt(c.g) : '');
  }
  if (c.f.nome === 'folha') return c.f.rotulo || 'no centro da folha';
  if (c.f.cls === 'el') return (c.m.nome || 'ponto') + ' alinhado com ' + c.f.nome;
  return (c.m.qual === 'centro' ? 'centro alinhado com ' : 'alinhado com ') + c.f.nome;
}

/* de que tipo foi a guia que decidiu um eixo — para quem mede o motor */
function porQue(c){
  if (!c) return null;
  if (c.tipo === 'fixo') return 'fixo';
  if (c.tipo === 'espaco') return 'espaco';
  if (c.f.nome === 'folha') return 'folha';
  return c.f.cls;                                   /* 'el' | 'vis' */
}
/* ── RESOLVE: a cada movimento ──
   dx, dy  o deslocamento cru do cursor desde o começo do gesto
   o = { escala   px de tela por unidade do mundo (o zoom),
         grade    v => deslocamento na grade — o que o eixo SEM guia faz ao soltar,
         trava    { dx, dy } quando o ímã do pino já decidiu: as guias só mostram,
         desliga  true com o Ctrl apertado: nem gruda nem desenha,
         fixo     { x, y } — o SHIFT: o eixo com valor fica PARADO nele, e so o outro anda (e
                  procura guia). O valor e um candidato — a guia que estava pegando quando o
                  Shift desceu, com o nome dela para a barra — ou { tipo:'fixo', delta } puro,
                  o "anda reto" sem guia. Vale ate com o Ctrl: soltar as guias nao solta o trilho,
         fmt      v => texto da medida }
   Devolve { dx, dy (onde desenhar agora), lx, ly (onde pousa ao soltar), gx, gy (o eixo
   grudou), porX, porY ('el' | 'vis' | 'espaco' | 'folha' | 'fixo' — quem decidiu o eixo),
   guia { x, y } (o candidato que decidiu cada eixo — e o que o Shift prende), cena (o que
   desenhar, ou null), rotulo (a frase da barra de status) }.
   A TRAVADA MORA EM G (`G.preso`): a guia que pegou num movimento vale para o seguinte enquanto
   o cursor estiver a menos de SOLTA_PX dela. G é de UM gesto, então a travada nasce e morre com
   ele; o ímã do pino e o Ctrl a zeram, e ela recomeça pelo raio de pegar quando eles saem. */
function resolve(G, dx, dy, o){
  o = o || {};
  const grade = typeof o.grade === 'function' ? o.grade : null;
  /* a grade POR EIXO (gradeX/gradeY), para quem prende a posicao ABSOLUTA na grade, e nao o
     deslocamento: a vista PCB prende o ponto de referencia do objeto, que nao precisa estar na
     grade no comeco do gesto. Sem elas, a `grade` vale nos dois eixos, como sempre */
  const gX = typeof o.gradeX === 'function' ? o.gradeX : grade, gY = typeof o.gradeY === 'function' ? o.gradeY : grade;
  /* o eixo fixo (Shift) entra ANTES de tudo: o cursor naquele eixo deixa de existir */
  const fixo = o.fixo || {};
  if (fixo.x) dx = fixo.x.delta;
  if (fixo.y) dy = fixo.y.delta;
  const out = { dx, dy, lx:fixo.x || !gX ? dx : gX(dx), ly:fixo.y || !gY ? dy : gY(dy),
                gx:false, gy:false, porX:null, porY:null, guia:{ x:null, y:null }, cena:null, rotulo:'' };
  if (!G || !G.box0 || o.desliga){ if (G) G.preso = null; return out; }
  const esc = o.escala > 0 ? o.escala : 1;
  const tol = SNAP_PX / esc, solta = SOLTA_PX / esc, perto = PERTO_PX / esc, alcance = ALCANCE_PX / esc;
  let viz;
  if (o.trava){
    G.preso = null;
    out.dx = out.lx = o.trava.dx; out.dy = out.ly = o.trava.dy;
    viz = vizinhanca(G, desloca(G.box0, out.lx, out.ly), perto);
  } else {
    viz = vizinhanca(G, desloca(G.box0, dx, dy), perto);
    const preso = G.preso || {};
    /* o alinhamento preso continua valendo se a reta parada ainda esta na vizinhanca e o cursor
       nao se afastou SOLTA_PX dela; a distancia e refeita, para disputar com as guias novas */
    const aindaPreso = (p, feats, d) => {
      if (!p || p.tipo !== 'alinha' || feats.indexOf(p.f) < 0) return null;
      const dist = Math.abs(d - (p.f.v - p.m.v));
      return dist <= solta ? Object.assign({}, p, { dist, prio: p.f.cls === 'el' ? 0 : 2 }) : null;
    };
    /* a guia presa so perde para uma guia MAIS PERTO do cursor — e isso que deixa trocar de
       alinhamento sem sair da travada, e nada fica inalcancavel */
    const comTrava = (novo, velho) => velho && (!novo || velho.dist <= novo.dist + 1e-9) ? velho : novo;
    /* o eixo fixo nao procura guia: ele E a guia, a distancia zero e na frente de todas */
    const fixa = c => Object.assign({}, c, { dist:0, prio:-1 });
    const ax = fixo.x ? fixa(fixo.x) : comTrava(melhorAlinha(G.mx, viz.fx, dx, tol), aindaPreso(preso.x, viz.fx, dx));
    const ay = fixo.y ? fixa(fixo.y) : comTrava(melhorAlinha(G.my, viz.fy, dy, tol), aindaPreso(preso.y, viz.fy, dy));
    let bx = ax, by = ay;
    if (G.filas.length){
      /* A FILA DE UM EIXO DEPENDE DE ONDE A CAIXA POUSA NO OUTRO — e nao de onde o cursor
         esta: o outro eixo sem guia vai para a grade ao soltar, e uma fila medida no cursor
         anunciava "centralizado entre L e R" com L fora da fila no pouso. Duas voltas: se o
         espaco igual decidiu um eixo, o pouso desse eixo mudou e a fila do outro e refeita. */
      const pouso = (c, d, g) => c ? c.delta : g ? g(d) : d;
      /* o espaco igual preso e conferido de novo com o raio de soltar, e so ELE (mesmo `como`,
         mesmos vizinhos): se a fila mudou, ele deixou de existir e solta sozinho */
      const espacoPreso = (p, eixo, M) =>
        p && p.tipo === 'espaco' ? melhorEspaco(G, eixo, M, solta, alcance, p) : null;
      for (let volta = 0; volta < 2; volta++){
        const Mx = desloca(G.caixa, dx, pouso(by, dy, gY)), My = desloca(G.caixa, pouso(bx, dx, gX), dy);
        const sx = comTrava(melhorEspaco(G, 'x', Mx, tol, alcance), espacoPreso(preso.x, 'x', Mx));
        const sy = comTrava(melhorEspaco(G, 'y', My, tol, alcance), espacoPreso(preso.y, 'y', My));
        const nx = escolhe(ax, sx), ny = escolhe(ay, sy);
        const mudou = nx !== bx || ny !== by;
        bx = nx; by = ny;
        if (!mudou || !((sx && bx === sx) || (sy && by === sy))) break;
      }
      /* A GARANTIA: espaco igual que gruda tem de APARECER. Se no pouso o eixo nao tem uma cota
         marcada igual, o snap nao se explica — volta para o alinhamento (ou para a grade).
         Uma reversao por vez, e a medida e refeita depois de cada uma: reverter um eixo muda o
         pouso dele, e com isso a fila do OUTRO (medido em 2026-09-24: conferir os dois contra a
         mesma medida deixava "centralizado entre B1 e T2" com T2 fora da coluna). Cada passe so
         TIRA espaco igual, entao termina em no maximo tres. */
      for (let passe = 0; passe < 3; passe++){
        const med = medidasEm(G, desloca(G.caixa, pouso(bx, dx, gX), pouso(by, dy, gY)), alcance);
        const sem = eixo => !med.some(m => m.eixo === eixo && m.igual);
        if (bx && bx !== ax && bx.tipo === 'espaco' && sem('x')) bx = ax;
        else if (by && by !== ay && by.tipo === 'espaco' && sem('y')) by = ay;
        else break;
      }
    }
    G.preso = { x:bx, y:by };
    out.guia = { x:bx, y:by };
    if (bx){ out.dx = out.lx = bx.delta; out.gx = true; out.porX = porQue(bx); }
    if (by){ out.dy = out.ly = by.delta; out.gy = true; out.porY = porQue(by); }
    const rx = rotuloDe(bx, o.fmt), ry = rotuloDe(by, o.fmt);
    out.rotulo = rx && ry && rx !== ry ? rx + ' · ' + ry : (rx || ry);
  }
  const guias = guiasEm(G, viz, out.lx, out.ly);
  const medidas = G.filas.length && G.caixa ? medidasEm(G, desloca(G.caixa, out.lx, out.ly), alcance) : [];
  if (guias.length || medidas.length) out.cena = { guias, medidas };
  return out;
}

/* ── DESENHO ──
   As retas e as cotas vão em coordenada do MUNDO, com espessura de 1 px de tela; os
   rótulos vão em coordenada de TELA (getTransform), para ter sempre o mesmo tamanho e não
   sair de cabeça para baixo — a câmera do hub vira o Y. */
function caminhoPilula(ctx, x, y, w, h, r){
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
}
function desenha(ctx, cena, o){
  if (!cena || !ctx) return;
  o = o || {};
  const esc = o.escala > 0 ? o.escala : 1, px = 1 / esc;
  const fmt = typeof o.fmt === 'function' ? o.fmt : (v => String(Math.round(v)));
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = COR; ctx.lineWidth = px;
  /* as faixas de espaço igual primeiro, por baixo das linhas */
  ctx.fillStyle = COR_FAIXA;
  for (const m of cena.medidas){
    if (!m.igual) continue;
    if (m.eixo === 'x') ctx.fillRect(m.a, m.lo, m.b - m.a, m.hi - m.lo);
    else ctx.fillRect(m.lo, m.a, m.hi - m.lo, m.b - m.a);
  }
  ctx.beginPath();
  for (const g of cena.guias){
    if (g.eixo === 'x'){ ctx.moveTo(g.v, g.lo); ctx.lineTo(g.v, g.hi); }
    else { ctx.moveTo(g.lo, g.v); ctx.lineTo(g.hi, g.v); }
  }
  const r = 3 * px;
  for (const g of cena.guias) for (const p of g.marcas){
    ctx.moveTo(p[0] - r, p[1] - r); ctx.lineTo(p[0] + r, p[1] + r);
    ctx.moveTo(p[0] - r, p[1] + r); ctx.lineTo(p[0] + r, p[1] - r);
  }
  const t = 4 * px;
  for (const m of cena.medidas){
    if (m.eixo === 'x'){
      ctx.moveTo(m.a, m.em); ctx.lineTo(m.b, m.em);
      ctx.moveTo(m.a, m.em - t); ctx.lineTo(m.a, m.em + t);
      ctx.moveTo(m.b, m.em - t); ctx.lineTo(m.b, m.em + t);
    } else {
      ctx.moveTo(m.em, m.a); ctx.lineTo(m.em, m.b);
      ctx.moveTo(m.em - t, m.a); ctx.lineTo(m.em + t, m.a);
      ctx.moveTo(m.em - t, m.b); ctx.lineTo(m.em + t, m.b);
    }
  }
  ctx.stroke();
  /* os números */
  if (cena.medidas.length && typeof ctx.getTransform === 'function'){
    const T = ctx.getTransform();
    const dpr = Math.abs(T.a) / esc || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = Math.round(11 * dpr) + 'px "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const h = 16 * dpr, pad = 5 * dpr;
    for (const m of cena.medidas){
      const wx = m.eixo === 'x' ? (m.a + m.b) / 2 : m.em, wy = m.eixo === 'x' ? m.em : (m.a + m.b) / 2;
      const X = T.a * wx + T.c * wy + T.e, Y = T.b * wx + T.d * wy + T.f;
      const s = fmt(m.valor), w = ctx.measureText(s).width + 2 * pad;
      ctx.fillStyle = COR;
      ctx.beginPath(); caminhoPilula(ctx, X - w / 2, Y - h / 2, w, h, h / 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(s, X, Y + 0.5 * dpr);
    }
  }
  ctx.restore();
}

return { prepara, resolve, desenha, SNAP_PX, SOLTA_PX, PERTO_PX, ALCANCE_PX, K_CAIXAS, K_PONTOS, COR,
         _int: { lowerBound, vizinhanca, melhorAlinha, melhorEspaco, medidasEm, guiasEm, poeNoTopo } };
})();
if (typeof module === 'object' && module.exports) module.exports = HubGuias;
