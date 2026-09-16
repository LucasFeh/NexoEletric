/* AltiumPCBMirror v2 - schframe.js — vista Esquema (le globals: schematic, schlib, pcblib).

   BIBLIOTECA EM TEMPO REAL. Os acervos entram pelo schframe.html como <script src> e viram
   GLOBAIS no load; quando o editor de simbolos grava no espelho (Libs\) eles ficam velhos na
   hora. Recarregar a pagina resolveria — e joga fora a edicao pendente da folha. Por isso a
   montagem dos acervos e uma funcao PURA (montaAcervos, alimentada pelos globais) e existe
   window.__hubRecarregaLibs(): re-injeta os <script> com ?v= novo, remonta os acervos e
   redesenha, sem F5 e sem tocar no `schematic`.
   Em Node (tests/test-schframe-libs.js) o arquivo vale so pela parte pura — por isso nada de
   DOM antes do module.exports logo abaixo. */
"use strict";
(function(){

/* ═══════════ parte pura (roda em Node, sem DOM) ═══════════ */

/* Os arquivos de biblioteca e o global que cada um define. E a MESMA lista dos <script src>
   do schframe.html: quem acrescentar um acervo la tem de acrescenta-lo aqui, senao ele nunca
   se recarrega sozinho. */
const LIBS = [
  { src:'Libs/schlib.js',          nome:'schlib' },
  { src:'Libs/pcblib.js',          nome:'pcblib' },
  { src:'Libs/almox-basicos.js',   nome:'almoxBasicos' },
  { src:'Libs/almox-especiais.js', nome:'almoxEspeciais' },
  { src:'Libs/almox-index.js',     nome:'almoxIndex' },
  { src:'Libs/rename-map.js',      nome:'renameMap' },
  { src:'Libs/lib-subs.js',        nome:'libSubs' },
  /* NAO e acervo (nao esta em ACERVO_DEFS): entra so para o resgate de desenho abaixo */
  { src:'Libs/symbols-lib.js',     nome:'symbolsLib' },
];

/* ------- acervos -------
   A folha pode referenciar simbolo da SchLib do Altium OU das bibliotecas do
   almoxarifado. SLIB precisa conter todos: e ele que o desenho, a extracao de nets e a
   validacao consultam — um simbolo de fora viraria quadrado vermelho e erro de
   validacao. O modal de adicionar e que separa por acervo, na hora de escolher. */
const ACERVO_DEFS = [
  { id:'altium',          nome:'schlib',         titulo:'Biblioteca do Altium' },
  { id:'almox-basicos',   nome:'almoxBasicos',   titulo:'Almoxarifado — Básicos' },
  { id:'almox-especiais', nome:'almoxEspeciais', titulo:'Almoxarifado — Especiais' },
];
const _acervo = (g, id, titulo) => (g && g.symbols && g.symbols.length)
  ? { id, titulo: g.title || titulo, syms: g.symbols, almox: id !== 'altium',
      gerado: g.generated || '' } : null;

/* Monta a lista de acervos, o indice nome -> acervo e os alias por VALOR a partir dos
   globais que os <script> deixaram.
   `velhos` e a montagem anterior: o acervo cujo arquivo NAO veio agora (404, servidor
   caido, sync no meio da escrita) e PRESERVADO como estava, marcado com `caiu:true` —
   meio acervo faltando viraria metade da folha em quadrado vermelho. */
function montaAcervos(globais, velhos){
  const g = globais || {};
  const antes = new Map((velhos || []).map(a => [a.id, a]));
  const acervos = [];
  for (const d of ACERVO_DEFS){
    const novo = _acervo(g[d.nome], d.id, d.titulo);
    const velho = antes.get(d.id);
    if (novo) acervos.push(novo);
    else if (velho) acervos.push(Object.assign({}, velho, { caiu:true }));
  }
  const symbols = [], acervoDe = new Map(), valorDe = new Map();
  for (const a of acervos) for (const sy of a.syms){
    if (acervoDe.has(sy.name)) continue;      /* o do Altium ganha em caso de xara */
    acervoDe.set(sy.name, a);
    symbols.push(sy);
  }
  /* Na conversao para o Altium cada VALOR virou um componente proprio, com nome
     "SMD 0805 10K 1/8W". E esse nome que o schematic.js grava, porque e ele que existe
     la dentro. Aqui registramos cada um como um simbolo que REAPROVEITA a geometria da
     familia (mesma referencia de objeto, sem copia), para o hub desenhar, extrair nets e
     validar sem precisar saber da diferenca. */
  for (const a of acervos){
    if (!a.almox) continue;
    for (const sy of a.syms) for (const v of (sy.valores || [])){
      if (!v.altium || acervoDe.has(v.altium)) continue;
      const alias = {
        name: v.altium, description: (v.itens && v.itens[0] && v.itens[0].nome) || v.label,
        designator: sy.designator, familia: sy.familia, partcount: 1,
        /* a geometria da familia, compartilhada — a nao ser que o VALOR traga a dele: e assim
           que o PNP deixa de ser desenhado com a seta do NPN sem partir a familia em duas */
        parts: v.parts || sy.parts,
        footprints: v.footprint ? [{ name: v.footprint, current: true, incurrentlib: true }]
                                : (sy.footprints || []),
        valores: [v], deValor: true,
      };
      acervoDe.set(alias.name, a);
      valorDe.set(alias.name, { sym: sy, valor: v });
      symbols.push(alias);
    }
  }
  return { acervos, symbols, acervoDe, valorDe };
}
/* A impressao digital de uma montagem: e o que diz se a recarga trouxe algo novo. O
   `generated` do espelho muda a cada gravacao do editor de simbolos; a contagem pega o
   resto (simbolo acrescentado ou removido). */
const carimbo = acervos => (acervos || [])
  .map(a => a.id + ':' + a.syms.length + ':' + (a.gerado || '') + (a.caiu ? ':caiu' : '')).join('|');

/* ------- trocar o simbolo de um componente (parte pura) -------
   Um componente chega ao simbolo por caminhos diferentes — nome exato, renomeacao, chave
   normalizada ou uma ESCOLHA gravada em Libs/lib-subs.js — e a escolha e GLOBAL: vale para
   todo componente com aquele nome, em todo projeto. Uma escolha ruim ja fez um transceptor
   RS-485 de 8 pinos ser desenhado como um TVS de 3 durante tres dias, e a extracao de nets
   foi junto: a ficha dizia em que simbolo tinha resolvido, nao dizia POR QUE, e o botao de
   trocar sumia justamente quando o simbolo resolvia. Esta funcao e a regra dessa tela —
   qual rotulo, qual motivo, qual aviso — separada do DOM para poder ser provada sem
   navegador (tests/test-troca-simbolo.js). */

/* o `how` do HubCore.resolveSym em portugues de gente. 'exato' fica de fora de proposito:
   o nome pedido e o nome achado sao o mesmo, nao ha o que explicar, e uma linha dizendo o
   obvio em todo componente esconderia justamente a linha que importa. */
const MOTIVO_RESOL = {
  escolha: 'por escolha sua, gravada em Libs/lib-subs.js',
  rename:  'por uma renomeação registrada em Libs/rename-map.js',
  chave:   'por aproximação do nome (maiúsculas, espaços e traços não contam)',
  ambiguo: 'nome ambíguo: mais de um componente casa, e nenhum foi usado',
};
const _pinos = n => n + (n === 1 ? ' pino' : ' pinos');

/* Estado ja medido -> o que a ficha e o modal mostram. Campos de entrada:
   `sym`   nome do simbolo em que o componente resolveu, ou null/'' se nao resolveu;
   `how`   como resolveu (HubCore.resolveSym);
   `quantos` componentes DESTE projeto com o mesmo comp.sym — todos mudam junto;
   `pinosEsperados` pinagem do simbolo em que o nome do componente resolveria SOZINHO, sem
     a escolha; null quando esse simbolo nao existe em acervo nenhum — ai nao ha o que
     comparar, e dizer isso e melhor do que inventar um numero;
   `pinosDoCandidato` pinagem do candidato selecionado no modal; null sem candidato ou sem
     geometria. */
function decideTroca(est){
  const e = est || {};
  const nome = e.sym ? String(e.sym) : '';
  const porEscolha = e.how === 'escolha';
  const quantos = Math.max(0, Math.trunc(e.quantos || 0));
  const esperados = e.pinosEsperados == null ? null : Math.trunc(e.pinosEsperados);
  const cand = e.pinosDoCandidato == null ? null : Math.trunc(e.pinosDoCandidato);
  const d = {
    /* com simbolo resolvido a troca e acao secundaria: quem esta vendo o desenho certo nao
       precisa de alarme. Sem simbolo o componente e um quadrado vermelho, e ai o botao e a
       saida — por isso so nesse caso ele tem destaque. */
    rotulo: nome ? 'Trocar componente…' : 'Procurar componente no acervo…',
    title: 'sugere pelo comment, nome, footprint, designador e pinagem — você escolhe'
         + (nome ? '; a folha continua com "' + nome + '" até você confirmar' : ''),
    destaque: !nome,
    porEscolha: porEscolha,
    motivo: MOTIVO_RESOL[e.how] || null,
    desfazer: porEscolha ? 'Desfazer a escolha' : null,
    impacto: null, impactoAlerta: false,
    pinos: null, pinosAlerta: false,
  };
  /* O ALCANCE MUDOU em 2026-09-15: a troca vale so para ESTE designador (e todas as
     partes dele). Antes ia para o lib-subs.js e valia para todo componente com o mesmo
     nome de simbolo, em todos os projetos — e era isso que este texto avisava. Dizer
     'muda junto' agora seria mentira, e mentira que assusta quem ia so trocar um. */
  if (quantos > 1){
    d.impacto = 'muda só este designador; os outros ' + (quantos - 1)
              + ' componentes da folha com este mesmo símbolo ficam como estão';
    d.impactoAlerta = false;
  } else if (quantos === 1){
    d.impacto = 'muda só este designador — é o único da folha com este símbolo';
  }
  if (cand != null){
    if (esperados == null)
      d.pinos = 'o componente de origem não existe em acervo nenhum — não há pinagem esperada '
              + 'para comparar; o candidato tem ' + _pinos(cand);
    else if (esperados === cand)
      d.pinos = 'pinagem bate: ' + _pinos(esperados) + ' dos dois lados';
    else {
      d.pinos = 'pinagem NÃO bate: o componente espera ' + _pinos(esperados)
              + ' e o candidato tem ' + cand + ' — os fios dos pinos que não existirem no '
              + 'componente novo ficam sem ligação';
      d.pinosAlerta = true;
    }
  }
  return d;
}

/* ── TROCAR O SÍMBOLO DE UMA PARTE, SEM PERDER AS OUTRAS ──
   O POST /api/symbols/save SUBSTITUI a lista de partes e recalcula o partcount a partir do
   que recebe (symserver.py » _salva_espelho: `('partcount', len(parts)), ('parts', parts)`).
   Mandar só a parte escolhida apagaria as demais no espelho E na .SchLib, para TODOS os
   projetos — e a conferência do servidor aprovaria, porque ela compara o gravado com o que
   foi PEDIDO, não com o que existia. Não é hipótese: 43 dos 401 componentes da casa têm mais
   de uma parte, e o CONE PADRAO tem 80.

   Por isso esta função devolve SEMPRE a lista inteira, com uma única parte trocada.

   `aplica` entra por parâmetro (o applyLibSymbol do hub-symed) para a função ficar pura e
   poder ser provada em Node, como o decideTroca. Ele mantém número, nome, tipo e olho do
   pino e troca só posição e gráficos — que é exatamente "trocar a imagem".

   PINAGEM NÃO MUDA: símbolo é a imagem. Contagem diferente é RECUSA, não aviso. É o que
   separa "trocar o desenho" de "trocar a peça", e foi a decisão do usuário. */
function montaPartsTrocando(componente, numeroParte, simbolo, aplica){
  const todas = (componente && componente.parts) || [];
  if (!todas.length) return { erro: 'este componente não tem nenhuma parte no espelho' };
  const n = Math.trunc(Number(numeroParte)) || 1;
  const alvo = todas.find(p => (p.part || 1) === n);
  if (!alvo) return { erro: 'a parte ' + n + ' não existe neste componente' };
  /* o symlib-v1 guarda pins/graphics no próprio símbolo; um acervo schlib-v2 guarda em
     parts[] — aceitar os dois evita que a origem do desenho vire uma regra escondida */
  const s = (simbolo && simbolo.parts && simbolo.parts.length) ? simbolo.parts[0] : (simbolo || {});
  const nova = s.pins || [], velha = alvo.pins || [];
  if (nova.length !== velha.length)
    return { erro: 'o símbolo tem ' + nova.length + (nova.length === 1 ? ' pino' : ' pinos')
                 + ' e a parte ' + n + ' tem ' + velha.length
                 + ': trocar o desenho não pode mudar a pinagem do componente' };
  const r = aplica(alvo, s);
  const parts = todas.map(p => ((p.part || 1) === n ? r.part : p));
  return { parts, nota: r.note, trocada: n, intactas: parts.length - 1 };
}

/* ═══════════ o fio maleável, a bolinha e a ponte ═══════════ */

/* Distancia de um ponto a um segmento. E a mesma conta do HubCore.distSeg, repetida aqui de
   proposito: este bloco roda em Node SEM o hub-core.js carregado, e amarrar oito linhas de
   geometria ao carregamento do outro arquivo tiraria do teste justamente a regra mais
   delicada do fio. Se um dia divergirem, a testemunha e tests/test-fio-topologia.js. */
function distPS(px, py, x1, y1, x2, y2){
  const dx = x2 - x1, dy = y2 - y1, dd = dx*dx + dy*dy;
  let t = dd ? ((px - x1)*dx + (py - y1)*dy) / dd : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x1 + t*dx), py - (y1 + t*dy));
}
/* a tolerancia do esquema e o balde de ponto do HubCore (round(v*2)), copiados pelo mesmo
   motivo: o desenho e a extracao de nets tem de concordar sobre o que e "o mesmo ponto",
   senao a folha desenha bolinha onde a net nao existe */
const STOL_SCH = 0.5;
const pertoDe  = (ax, ay, bx, by) => Math.abs(ax - bx) <= STOL_SCH && Math.abs(ay - by) <= STOL_SCH;
const chavePt  = (x, y) => Math.round(x * 2) + '|' + Math.round(y * 2);

/* Cruzamento de verdade entre dois segmentos: os dois se cortam NO MEIO. Paralelo, encosto de
   ponta e T ficam de fora — ponta encostada e ancora, e ancora ja e tratada como ligacao. */
function cruzaSeg(a, b){
  const rx = a.x2 - a.x1, ry = a.y2 - a.y1, sx = b.x2 - b.x1, sy = b.y2 - b.y1;
  const den = rx*sy - ry*sx;
  if (!den) return null;
  const t = ((b.x1 - a.x1)*sy - (b.y1 - a.y1)*sx) / den;
  const u = ((b.x1 - a.x1)*ry - (b.y1 - a.y1)*rx) / den;
  const ea = STOL_SCH / Math.max(Math.hypot(rx, ry), 1e-9);
  const eb = STOL_SCH / Math.max(Math.hypot(sx, sy), 1e-9);
  if (t <= ea || t >= 1 - ea || u <= eb || u >= 1 - eb) return null;
  return { x: a.x1 + t*rx, y: a.y1 + t*ry };
}

/* ── ONDE NASCE A BOLINHA E QUEM SALTA ──
   Duas perguntas que a folha nunca soube responder, e que se respondem com o mesmo censo.

   BOLINHA = "ha mais de uma conexao aqui". Conta-se o numero de RAMOS que saem do ponto:
   ponta de fio vale 1, vertice do meio vale 2 (o fio entra e sai), pino vale 1, e fio que
   PASSA por cima de uma ancora sem ter vertice nela vale 2. Com 3 ou mais ramos ha derivacao
   e a bolinha aparece — que e a regra do Altium. Por que assim: o `autoJunctions` de hoje so
   enxerga o T (ponta pousando no meio de um fio) e deixa passar a estrela de tres pontas de
   fio no mesmo ponto — 18 pontos assim nos projetos deste workspace, todos sem bolinha. E
   contar ramo (em vez de afrouxar a guarda de extremidade do HubCore) e o que impede o canto
   em L — 2 ramos — de virar bolinha em todo dobra de fio da folha.

   PONTE = "eu so passo por cima". E o cruzamento que NAO tem ancora nenhuma: pelo Altium (e
   pelo HubCore.extractNets) dois fios que so se cruzam nao se ligam, e hoje a folha desenha
   isso como um X mudo, que se le como ligacao. O arco diz o contrario com o desenho.
   Quem salta e o HORIZONTAL: nos 58 cruzamentos sem conexao dos projetos reais deste
   workspace, os 58 sao um horizontal contra um vertical, entao a regra decide todos.

   Entra a folha ja em coordenada de mundo (fios com pts, pontas quentes de pino, junções
   explicitas) e saem os dois desenhos. Nada aqui liga ou desliga net — quem decide ligacao
   continua sendo o HubCore. */
function topologiaFolha(fios, pinos, juncoes){
  const segs = [];
  (fios || []).forEach((w, wi) => {
    const pts = (w && w.pts) || [];
    for (let i = 0; i < pts.length - 1; i++){
      const a = pts[i], b = pts[i+1];
      if (a[0] === b[0] && a[1] === b[1]) continue;   /* segmento de comprimento zero nao e segmento */
      segs.push({ wi, i, x1:a[0], y1:a[1], x2:b[0], y2:b[1] });
    }
  });
  const anc = new Map();
  const poe = (x, y, ramos) => {
    const k = chavePt(x, y);
    let a = anc.get(k);
    if (!a){ a = { x, y, ramos:0 }; anc.set(k, a); }
    a.ramos += ramos;
  };
  (fios || []).forEach(w => {
    const pts = (w && w.pts) || [];
    for (let j = 0; j < pts.length; j++)
      poe(pts[j][0], pts[j][1], (j === 0 || j === pts.length - 1) ? 1 : 2);
  });
  for (const p of (pinos || [])) poe(p.x, p.y, 1);
  /* A junção EXPLICITA nao traz ramo — quem tem ramo ali sao os fios que ela une — mas ela
     desenha de qualquer jeito: e um objeto que alguem pos no arquivo (ou que veio do Altium),
     e sumir com ele porque a conta de ramos nao chegou a tres seria o desenho contradizer o
     dado. Sem a marca, uma junção pousada sozinha ganharia bolinha de si mesma pelo caminho
     errado — por isso ela entra como ancora com zero ramos E com a marca. */
  for (const j of (juncoes || [])){ poe(j.x, j.y, 0); const a = anc.get(chavePt(j.x, j.y)); if (a) a.forcada = true; }
  for (const a of anc.values())
    for (const s of segs){
      if (pertoDe(a.x, a.y, s.x1, s.y1) || pertoDe(a.x, a.y, s.x2, s.y2)) continue;
      if (distPS(a.x, a.y, s.x1, s.y1, s.x2, s.y2) <= STOL_SCH) a.ramos += 2;
    }
  const bolinhas = [];
  for (const a of anc.values()) if (a.ramos >= 3 || a.forcada) bolinhas.push({ x:a.x, y:a.y, ramos:a.ramos });

  /* Os pares de segmento saem de um balde de 1000 mil em vez do laço de todos contra todos:
     a folha maior deste workspace tem 555 segmentos (154 mil pares), e esta conta roda a cada
     quadro do arrasto. Com o balde sobram os vizinhos de verdade. */
  const CEL = 1000, balde = new Map();
  segs.forEach((s, si) => {
    const cx1 = Math.floor(Math.min(s.x1, s.x2) / CEL), cx2 = Math.floor(Math.max(s.x1, s.x2) / CEL);
    const cy1 = Math.floor(Math.min(s.y1, s.y2) / CEL), cy2 = Math.floor(Math.max(s.y1, s.y2) / CEL);
    for (let cx = cx1; cx <= cx2; cx++) for (let cy = cy1; cy <= cy2; cy++){
      const k = cx + ':' + cy;
      let l = balde.get(k); if (!l){ l = []; balde.set(k, l); }
      l.push(si);
    }
  });
  const temAncora = (x, y) => {
    for (const dx of [-STOL_SCH, 0, STOL_SCH]) for (const dy of [-STOL_SCH, 0, STOL_SCH])
      if (anc.has(chavePt(x + dx, y + dy))) return true;
    return false;
  };
  const vistos = new Set(), pontes = [];
  for (const lista of balde.values())
    for (let a = 0; a < lista.length; a++) for (let b = a + 1; b < lista.length; b++){
      const i1 = Math.min(lista[a], lista[b]), i2 = Math.max(lista[a], lista[b]);
      const par = i1 + '#' + i2;
      if (vistos.has(par)) continue;
      vistos.add(par);
      const s1 = segs[i1], s2 = segs[i2];
      if (s1.wi === s2.wi) continue;                 /* fio nao salta por cima de si mesmo */
      const p = cruzaSeg(s1, s2);
      if (!p || temAncora(p.x, p.y)) continue;
      const h1 = Math.abs(s1.x2 - s1.x1) >= Math.abs(s1.y2 - s1.y1);
      const h2 = Math.abs(s2.x2 - s2.x1) >= Math.abs(s2.y2 - s2.y1);
      /* mesmo eixo nos dois (nao aconteceu em nenhum dos 58 casos reais): salta o que vier
         DEPOIS no arquivo. Criterio arbitrario, mas estavel — o desenho nao pisca entre um
         quadro e outro, que e o que importa num arco puramente visual. */
      const salta = (h1 !== h2) ? (h1 ? s1 : s2) : (s1.wi > s2.wi ? s1 : s2);
      pontes.push({ x:p.x, y:p.y, wi:salta.wi, seg:salta.i });
    }
  return { bolinhas, pontes };
}

/* ── ARRASTAR UM TRECHO ──
   O Altium empurra o trecho na PERPENDICULAR e deixa os vizinhos esticarem; e isso que faz o
   fio parecer maleavel em vez de duro. Trecho no eixo X so anda em Y, trecho no eixo Y so anda
   em X — e os vizinhos acompanham de graca, porque compartilham os vertices movidos.
   Duas excecoes deliberadas: o fio de DOIS pontos anda inteiro (ali o trecho E o fio, e travar
   o unico trecho num eixo tiraria o gesto de mover o fio), e o trecho em diagonal — os que vem
   do Altium — anda livre, porque nele nao existe "a perpendicular certa". */
function moveSegmento(pts, i, dx, dy){
  const out = (pts || []).map(p => [p[0], p[1]]);
  const a = out[i], b = out[i+1];
  if (!a || !b) return out;
  if (out.length === 2){ a[0] += dx; a[1] += dy; b[0] += dx; b[1] += dy; return out; }
  const horiz = Math.abs(b[1] - a[1]) <= STOL_SCH && Math.abs(b[0] - a[0]) > STOL_SCH;
  const vert  = Math.abs(b[0] - a[0]) <= STOL_SCH && Math.abs(b[1] - a[1]) > STOL_SCH;
  const ux = horiz ? 0 : dx, uy = vert ? 0 : dy;
  a[0] += ux; a[1] += uy; b[0] += ux; b[1] += uy;
  return out;
}

/* Apagar um trecho PARTE o fio em dois — e e essa a troca de "apagar tudo e refazer" por
   "tirar so o pedaco errado". Pedaco de menos de dois pontos nao existe: o serializeSchematic
   recusa o ARQUIVO INTEIRO por causa de um fio assim, entao a ponta que sobra e descartada. */
function apagaSegmento(pts, i){
  const A = (pts || []).slice(0, i + 1), B = (pts || []).slice(i + 1);
  const out = [];
  if (A.length >= 2) out.push(A.map(p => [p[0], p[1]]));
  if (B.length >= 2) out.push(B.map(p => [p[0], p[1]]));
  return out;
}
/* Apagar um vertice endireita o fio no ponto; com menos de dois pontos sobrando, o fio acaba. */
function apagaVertice(pts, i){
  const out = (pts || []).filter((p, j) => j !== i).map(p => [p[0], p[1]]);
  return out.length >= 2 ? out : null;
}

/* ── ESPELHO NA TELA, NOS DOIS EIXOS ──
   O formato tem um booleano `mirror` (espelho em X aplicado ANTES da rotacao) e rot 0/90/180/
   270. Nao ha terceiro campo a inventar — o Altium tambem so tem IsMirrored + Orientation —,
   entao espelhar o que se VE e composicao:
       horizontal (vira esquerda/direita):  rot' = 360 - rot,  mirror' = !mirror
       vertical   (vira em cima/embaixo):   rot' = 180 - rot,  mirror' = !mirror
   Ate aqui o X trocava so o booleano, que e o espelho no eixo LOCAL do componente: num
   componente girado 90 a tecla X espelhava na vertical, e a mesma tecla fazia coisas
   diferentes conforme a rotacao. Com a conta acima X e sempre horizontal e Y e sempre
   vertical, em qualquer rotacao. */
function espelha(rot, mirror, eixo){
  const r = (((rot || 0) % 360) + 360) % 360;
  const base = (eixo === 'y' ? 180 - r : 360 - r);
  return { rot: ((base % 360) + 360) % 360, mirror: !mirror };
}

/* ── O COMPONENTE NOVO CAI ONDE O ANTIGO ESTAVA ──
   Trocar o componente troca o DESENHO, e desenho novo poe os pinos noutro lugar em volta da
   mesma ancora. Os fios ficam onde estavam e a ligacao se desfaz sem uma linha de aviso — a
   extracao de nets casa por coordenada exata, sem tolerancia. Aqui se escolhe o deslocamento
   que faz o MAIOR numero de pinos de mesmo numero voltar ao ponto antigo: a moda dos
   deslocamentos, nao a media, que nao devolveria nenhum pino ao lugar. Empate no numero de
   pinos, ganha o menor deslocamento — o componente anda o minimo possivel. */
function encaixeDaTroca(antes, depois){
  const de = new Map();
  for (const p of (antes || [])) de.set(String(p.num), p);
  const votos = new Map();
  let comuns = 0;
  for (const p of (depois || [])){
    const a = de.get(String(p.num));
    if (!a) continue;
    comuns++;
    const dx = a.x - p.x, dy = a.y - p.y, k = dx + '|' + dy;
    const v = votos.get(k) || { dx, dy, n:0 };
    v.n++; votos.set(k, v);
  }
  let best = null;
  for (const v of votos.values())
    if (!best || v.n > best.n || (v.n === best.n && Math.hypot(v.dx, v.dy) < Math.hypot(best.dx, best.dy))) best = v;
  return best ? { dx:best.dx, dy:best.dy, encaixa:best.n, comuns }
              : { dx:0, dy:0, encaixa:0, comuns:0 };
}

/* ── A GRADE ──
   Os 100 mil do AI-GUIDE nao descrevem esta casa: as folhas reais snapam em 1 mm (39,37 mil)
   ou 0,3 mm, e 3980 dos 4188 vertices de fio dos projetos deste workspace estao fora da grade
   de 100 mil — muitos nem sao inteiros. Uma grade que so sabe 100 mil empurra tudo para fora
   do lugar e desencosta fio de pino, que no Altium so liga por coincidencia EXATA. Por isso a
   lista abaixo tem os dois mundos, e o metrico tem nome de metrico. */
const MM_MIL = 39.3700787402;
const GRADES = [
  { id:'100mil',  rotulo:'100 mil',  passo:100 },
  { id:'50mil',   rotulo:'50 mil',   passo:50 },
  { id:'25mil',   rotulo:'25 mil',   passo:25 },
  { id:'10mil',   rotulo:'10 mil',   passo:10 },
  { id:'1mm',     rotulo:'1 mm',     passo:MM_MIL },
  { id:'0.5mm',   rotulo:'0,5 mm',   passo:MM_MIL / 2 },
  { id:'0.25mm',  rotulo:'0,25 mm',  passo:MM_MIL / 4 },
];
/* 4 casas: o passo metrico e dizima, e sem o corte o vertice acumula sujeira de float a cada
   arrasto — coordenada que nao fecha e pino que nao liga. */
function snapPasso(v, passo){
  if (!(passo > 0)) return v;
  return Math.round(Math.round(v / passo) * passo * 1e4) / 1e4;
}
function gradePorId(id){ return GRADES.find(g => g.id === id) || GRADES[0]; }

/* ── ATALHOS: uma tabela so ──
   A dica do painel era uma COPIA escrita a mao, e ja mentia: nao citava Ctrl+Y, Ctrl+A, Ctrl+W
   nem o Escape, que sozinho faz seis coisas. Agora a tabela e a verdade — o teclado le dela e a
   aba Atalhos desenha dela, entao trocar uma tecla troca as duas de uma vez.
   O Escape fica DE FORA de proposito: ele e a saida de emergencia de seis estados e e tratado
   antes da guarda de campo de texto, para funcionar com o foco dentro de um <input>. */
const ATALHOS_PADRAO = [
  { id:'add',       tecla:'C',      rotulo:'Adicionar componentes' },
  { id:'fio',       tecla:'W',      rotulo:'Ferramenta fio' },
  { id:'terra',     tecla:'G',      rotulo:'Pousar terra (GND)' },
  { id:'rotulo',    tecla:'L',      rotulo:'Rótulo de net' },
  { id:'noerc',     tecla:'N',      rotulo:'No ERC' },
  { id:'girar',     tecla:'Espaço', rotulo:'Girar 90°' },
  { id:'espelhoX',  tecla:'X',      rotulo:'Espelhar na horizontal' },
  { id:'espelhoY',  tecla:'Y',      rotulo:'Espelhar na vertical' },
  { id:'apagar',    tecla:'Delete', rotulo:'Apagar a seleção' },
  { id:'enquadrar', tecla:'F',      rotulo:'Enquadrar a folha' },
  { id:'grade',     tecla:'B',      rotulo:'Mostrar/ocultar a grade' },
  { id:'desfazer',  tecla:'Ctrl+Z', rotulo:'Desfazer' },
  { id:'refazer',   tecla:'Ctrl+Y', rotulo:'Refazer' },
  { id:'tudo',      tecla:'Ctrl+A', rotulo:'Selecionar tudo da folha' },
];
/* O navegador leva estas antes da pagina ver. Deixar gravar uma delas seria entregar um
   "gravei e nao funciona" sem nenhuma pista de por que. */
const TECLAS_PROIBIDAS = ['Ctrl+W','Ctrl+T','Ctrl+N','Ctrl+Shift+N','Ctrl+Shift+T','Ctrl+R','Ctrl+P',
                          'F5','F11','F12','Escape','Tab','Ctrl+Tab'];
/* A tecla como a tabela a escreve. Shift nao entra em tecla de UM caractere: o navegador ja
   manda 'X' para Shift+x, e distinguir os dois criaria dois atalhos que a mao nao distingue. */
function normalizaTecla(e){
  if (!e || !e.key) return '';
  let k = e.key;
  if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return '';
  if (k === ' ' || k === 'Spacebar') k = 'Espaço';
  else if (k.length === 1) k = k.toUpperCase();
  const m = [];
  if (e.ctrlKey || e.metaKey) m.push('Ctrl');
  if (e.altKey) m.push('Alt');
  if (e.shiftKey && k.length > 1 && k !== 'Espaço') m.push('Shift');
  m.push(k);
  return m.join('+');
}
/* O padrao, com o que o usuario gravou por cima. Entrada desconhecida, tecla proibida e tecla
   repetida sao DESCARTADAS em vez de derrubar o mapa: uma chave estragada no localStorage nao
   pode deixar a vista sem teclado nenhum. */
function mapaAtalhos(salvos){
  const porAcao = {}, descartados = [];
  for (const a of ATALHOS_PADRAO) porAcao[a.id] = a.tecla;
  const s = salvos && typeof salvos === 'object' ? salvos : {};
  for (const id of Object.keys(s)){
    const t = String(s[id] || '');
    if (!porAcao[id]) { descartados.push(id + ': ação que não existe'); continue; }
    if (!t || TECLAS_PROIBIDAS.indexOf(t) >= 0) { descartados.push(id + ': tecla não permitida'); continue; }
    porAcao[id] = t;
  }
  const porTecla = {}, repetidas = [];
  for (const a of ATALHOS_PADRAO){
    const t = porAcao[a.id];
    if (porTecla[t]){ repetidas.push(t); porAcao[a.id] = a.tecla; }   /* volta ao padrao do que repetiu */
    else porTecla[t] = a.id;
  }
  /* a volta ao padrao pode ter repetido de novo; o segundo passe resolve sem laço infinito */
  const finalTecla = {};
  for (const a of ATALHOS_PADRAO){
    let t = porAcao[a.id];
    if (finalTecla[t] && finalTecla[t] !== a.id) t = a.tecla;
    if (finalTecla[t] && finalTecla[t] !== a.id) continue;
    porAcao[a.id] = t; finalTecla[t] = a.id;
  }
  return { porAcao, porTecla:finalTecla, descartados, repetidas };
}
/* Grava uma tecla nova para uma ação; devolve o que a interface tem de dizer. */
function defineAtalho(salvos, id, tecla){
  if (!ATALHOS_PADRAO.some(a => a.id === id)) return { ok:false, erro:'ação desconhecida' };
  if (!tecla) return { ok:false, erro:'tecla vazia' };
  if (TECLAS_PROIBIDAS.indexOf(tecla) >= 0) return { ok:false, erro:'“' + tecla + '” é do navegador — escolha outra' };
  const m = mapaAtalhos(salvos);
  const dono = m.porTecla[tecla];
  if (dono && dono !== id){
    const r = ATALHOS_PADRAO.find(a => a.id === dono);
    return { ok:false, erro:'“' + tecla + '” já é ' + (r ? r.rotulo.toLowerCase() : dono) };
  }
  const novo = Object.assign({}, salvos && typeof salvos === 'object' ? salvos : {});
  novo[id] = tecla;
  return { ok:true, salvos:novo };
}

/* A largura estimada de um texto, em mil. E a mesma estimativa por caractere que o editor de
   simbolos usa (hub-symed.js » labelBox): numa fonte proporcional ela erra para MAIS, e errar
   para mais e o lado certo de errar numa area de clique. */
function larguraTexto(txt, h){
  return Math.max(h || 60, String(txt == null ? '' : txt).length * (h || 60) * 0.58);
}
/* A caixa de um texto ANCORADO NO CANTO INFERIOR-ESQUERDO — que e o ponto que o Altium guarda
   para um rotulo (o RECORD=34/41 do .SchDoc nao traz Justification, e o padrao dele e
   BottomLeft; o proprio hub ja desenhava o net label assim, hub-draw.js » drawNetLabel).
   A ancora importa porque ela E o contrato: `refdx/refdy` sao medidos ATE ESTE PONTO nos dois
   lados do espelho. Enquanto o hub desenhava o designador centrado e o Altium o ancorava no
   canto, a mesma coordenada queria dizer dois lugares diferentes, e a ida e volta pelo hub
   andava meia palavra a cada passagem — sem nunca convergir. */
function caixaTexto(x, y, txt, h){
  const alt = h || 60, larg = larguraTexto(txt, alt), folga = alt * 0.18;
  return { x1:x - folga, y1:y - folga, x2:x + larg + folga, y2:y + alt + folga };
}

const PURE = { LIBS, ACERVO_DEFS, montaAcervos, carimbo, decideTroca, montaPartsTrocando,
               topologiaFolha, moveSegmento, apagaSegmento, apagaVertice, espelha, encaixeDaTroca,
               GRADES, gradePorId, snapPasso, MM_MIL, caixaTexto, larguraTexto,
               ATALHOS_PADRAO, TECLAS_PROIBIDAS, normalizaTecla, mapaAtalhos, defineAtalho };
/* Em Node o arquivo acaba aqui: dali para baixo e tudo DOM. */
if (typeof module !== 'undefined' && module.exports){ module.exports = PURE; return; }
if (typeof window !== 'undefined') window.SchFramePure = PURE;

/* ═══════════ a vista ═══════════ */

const $ = id => document.getElementById(id);
const fatal = m => { const f = $('fatal'); f.style.display = 'flex'; f.textContent = m; };
if (typeof schematic === 'undefined') { fatal('schematic.js não encontrado para o projeto "' + SCH_P + '".'); return; }
function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
/* nome de pino ativo-baixo: R\S\T\ e RST com a barra em cima. O hub-overbar.js entra pelo
   schframe.html, mas a vista nao pode morrer se faltar — sem ele a notacao aparece crua,
   que e exatamente o que aparecia antes. */
const OVB = () => (typeof HubOverbar !== 'undefined' && HubOverbar) || null;

/* Os globais de biblioteca lidos pelo window: depois de uma recarga o valor e outro, e
   `typeof schlib` congelado numa const apontaria para sempre para o do load. */
function globaisDaLib(){
  const g = {};
  for (const l of LIBS) g[l.nome] = window[l.nome];
  return g;
}
/* ACERVOS, SLIB, ACERVO_DE e VALOR_DE sao mutados NO LUGAR (nunca trocados por outro
   objeto): o arquivo inteiro os captura por nome, e depois de uma recarga nada pode
   continuar apontando para a montagem antiga.

   UMA EXCECAO, e ela e obrigatoria: o ARRAY de dentro do SLIB (SLIB.symbols) tem de ser
   TROCADO, nunca esvaziado e repovoado. O HubCore indexa a biblioteca num WeakMap chaveado
   pela IDENTIDADE do array (hub-core.js:301-315, libIndex): mesmo array = mesmo indice, e o
   indice e montado uma vez so. Esvaziar e repovoar mantinha a identidade, entao depois de
   recarregar a biblioteca o symbolOf continuava devolvendo o simbolo VELHO — a folha
   desenhava a geometria antiga e o extractNets casava os pinos antigos, enquanto os modais,
   que leem SLIB.symbols direto, ja mostravam o novo. Duas verdades na mesma tela.
   Trocar o array nao quebra a captura por nome, porque quem consulta recebe o SLIB e nao o
   array: HubCore.symbolOf(SLIB, ...), compPinsWorld(c, SLIB), extractNets(model, SLIB). */
const ACERVOS = [];
const SLIB = { symbols: [] };
const ACERVO_DE = new Map();
const VALOR_DE = new Map();
let PLIB = { footprints:[] };
/* ── RESGATE DE DESENHO (só para a vista) ──
   Componente cujo símbolo nenhum acervo tem vira quadrado vermelho — a folha fica ilegível
   justamente onde mais precisa ser lida. A Biblioteca de símbolos (`Libs/symbols-lib.js`) é
   o apanhado de TODAS as folhas e libs já varridas e quase sempre tem o desenho: medido,
   158 dos 319 quadrados vermelhos dos 14 projetos (50%).

   Ela entra SÓ PARA DESENHAR, e de propósito fica FORA do SLIB. Casar por nome não é prova
   de que é a peça certa, e net inventada em cima de palpite é pior que um quadrado vermelho
   honesto — então extração de nets, validação e ficha de biblioteca seguem sem ela, e o
   "símbolo não existe na schlib" continua de pé. Quem conserta de verdade é trocar o símbolo.

   O nome do tile é HEURÍSTICO (o `_reconhece` do extrair.py inventa "Conector 1 via"); quem
   casa com o que o projeto grava é o `aliases`, que guarda o nome de origem do Altium. Por
   isso os dois entram no índice — só por nome o resgate cai de 50% para 17%. */
const EMERG_COR = '#b06000';
const EMERG = { porNome: new Map(), porChave: new Map(), porId: new Map() };
function montaEmergencia(){
  EMERG.porNome.clear(); EMERG.porChave.clear(); EMERG.porId.clear();
  const lib = window.symbolsLib;
  for (const s of ((lib && lib.symbols) || [])){
    /* O symlib-v1 grava `desc`; toda tela daqui lê `description`. Já custou 727 descrições
       invisíveis de 897 símbolos por uma letra — o hub-symed normaliza na carga dele e aqui
       ninguém normalizava. Sem esta linha a busca por descrição nasce morta, justamente nos
       símbolos cujo NOME é código de catálogo (CMP-0694-00003-2) e a descrição é o que dá
       para procurar. */
    if (s.desc && !s.description) s.description = s.desc;
    if (s.id) EMERG.porId.set(s.id, s);
    for (const n of [s.name].concat(s.aliases || [])){
      if (!n) continue;
      const k = HubCore.normKey(n);
      const l = EMERG.porChave.get(k) || [];
      if (l.indexOf(s) < 0) l.push(s);
      EMERG.porChave.set(k, l);
    }
  }
  /* DUAS PASSADAS para o índice por nome: todo `name` primeiro, `aliases` só depois. Numa
     passada só, quem vem antes no arquivo leva a chave — e o APELIDO de um símbolo sequestra
     o NOME PRÓPRIO de outro. Medido: 6 casos em 2661 chaves ("Jumper" caindo em "Conector 2
     vias (Jumper)", "Trimpot" em "Potenciômetro"). O dono do nome tem de ganhar sempre. */
  for (const s of ((lib && lib.symbols) || []))
    if (s.name && !EMERG.porNome.has(s.name)) EMERG.porNome.set(s.name, s);
  for (const s of ((lib && lib.symbols) || []))
    for (const a of (s.aliases || [])) if (a && !EMERG.porNome.has(a)) EMERG.porNome.set(a, s);
}
/* { part, nome, how } do desenho emprestado, ou null. AMBÍGUO DEVOLVE NULL de propósito:
   dois candidatos é o mesmo que nenhum, e desenhar um chute com cara de certeza é o erro
   que este resgate existe para não cometer. */
function desenhoDeEmergencia(c){
  if (!c || !c.sym) return null;
  let s = EMERG.porNome.get(c.sym), how = 'nome';
  if (!s){
    const l = EMERG.porChave.get(HubCore.normKey(c.sym)) || [];
    if (l.length !== 1) return null;
    s = l[0]; how = 'chave';
  }
  /* o symlib-v1 guarda pins/graphics no próprio símbolo; multi-part vira uma entrada por parte */
  const part = s.parts ? HubCore.partOf(s, c.part) : s;
  return part ? { part, nome: s.name, how } : null;
}
function aplicaAcervos(){
  const r = montaAcervos(globaisDaLib(), ACERVOS.slice());
  ACERVOS.length = 0;      for (const a of r.acervos) ACERVOS.push(a);
  SLIB.symbols = r.symbols.slice();   /* array NOVO de proposito: ver a nota acima */
  ACERVO_DE.clear(); r.acervoDe.forEach((v, k) => ACERVO_DE.set(k, v));
  VALOR_DE.clear(); r.valorDe.forEach((v, k) => VALOR_DE.set(k, v));
  /* a PcbLib nao tem acervo: ou veio agora, ou fica a de antes — um 404 no meio de uma
     recarga nao pode zerar a lista de footprints da ficha */
  if (window.pcblib && window.pcblib.footprints) PLIB = window.pcblib;
  /* antes de qualquer symbolOf: sem as tabelas o resolvedor casa so por nome exato e por
     chave, e metade dos componentes viraria quadrado vermelho na folha */
  HubCore.setLibTables(window.renameMap || null, window.libSubs || null);
  montaEmergencia();
  return r;
}
aplicaAcervos();

let model = HubCore.buildSchModel(schematic);
let nets  = HubCore.extractNets(model, SLIB);
let val   = HubCore.validateSchematic(schematic, SLIB, PLIB);
let sheetIdx = 0, selNet = '';
/* O comentario do componente nasce SUPRIMIDO. Numa folha real ele e a maior fonte de
   poluicao visual: no DMB sao 44 componentes e "CONECTOR HEADER / 6 VIAS / Macho"
   aparece dezenas de vezes por cima do desenho. Quem quiser ve-lo liga no olho — e a
   escolha fica guardada, como no Altium. */
const VER_COMMENT_KEY = 'altiumhub.sch.comment';
/* NOME E NUMERO DE PINO NASCEM A VISTA, ao contrario do comment. O simbolo traz do
   Altium o hideName/hideNum de cada pino, e obedece-lo cegamente apagava 63% dos nomes
   (548 de 865 pinos medidos nos 14 projetos) — a vista Biblioteca mostrava e a folha nao,
   que e o sintoma classico de [dois desenhistas, um so honrando o olho]. Ligado, este
   botao passa honraOlho:false e a folha le como a biblioteca; desligado, a folha volta a
   obedecer o simbolo e fica fiel ao que o Altium desenha. A escolha fica guardada. */
const VER_PINOS_KEY = 'altiumhub.sch.pinos';
/* O DESIGNADOR NASCE A VISTA, e o olho dele mora na ficha do componente — ao lado do campo
   que ele apaga, e não numa seção de configuração do outro painel. É preferencia de VISTA
   (vale para a folha inteira, fica nesta máquina), e não um campo do componente: um campo
   por componente seria mudança de formato, com os dois .pas atrás. */
const VER_REF_KEY = 'altiumhub.sch.ref';
/* QUAL SUB-ABA DA FICHA estava aberta. Ela precisa sobreviver ao renderProps, que roda a cada
   selecao e a cada commit: sem isso, arrastar um componente com a aba Pinos aberta devolvia a
   Geral no meio do gesto. Fica nesta maquina, como as outras preferencias da vista. */
const PR_ABA_KEY = 'schframe.prAba';
let prAba = 'geral';
try { prAba = localStorage.getItem(PR_ABA_KEY) === 'pinos' ? 'pinos' : 'geral'; } catch (e) {}
const showState = { grid:true, comment:false, pinos:true, ref:true };
try { showState.ref = localStorage.getItem(VER_REF_KEY) !== '0'; } catch (e) {}
try { showState.comment = localStorage.getItem(VER_COMMENT_KEY) === '1'; } catch (e) {}
try { showState.pinos = localStorage.getItem(VER_PINOS_KEY) !== '0'; } catch (e) {}
/* `staleWorkspace` morava na linha do sinalizador, mas e do SALVAMENTO do esquema: o
   __hubOnChange o levanta quando o disco muda por baixo, e o saveSchematic pergunta antes
   de sobrescrever. */
let staleWorkspace = false;

/* ------- a folha e SEMPRE editavel -------
   Havia aqui um lapis: a vista abria em LEITURA e mexer exigia destravar. Saiu a pedido do
   usuario (2026-09-14) — quem abre o esquema no hub abre para mexer nele, e um modo a menos
   e um modo a menos para explicar. Editar aqui e MOVER: componentes, fios e o resto do que
   esta na folha. Fio, label, power e texto novos quem escreve e a IA, no schematic.js.

   O SINALIZADOR saiu junto, e da vista Esquema inteira: o `annotations.js` continua
   existindo e quem o escreve agora e so a vista PCB. Sinalizador 'sch' que ja esteja no
   disco fica no arquivo, intocado, e some da tela. */

/* ------- selecao: ALVOS, nao itens -------
   Ate 2026-09-16 `sel` era um Set dos proprios objetos de schematic.items, e a granularidade
   era o item inteiro: clicar num fio de seis vertices marcava a polilinha toda, e tirar um
   pedaco errado do meio exigia apagar o fio e refazer. Agora `sel` guarda ALVOS:

       { it, k:'all' }            o item inteiro (componente, rotulo, power, texto, junção…)
       { it, k:'seg',  i }        UM trecho do fio (entre pts[i] e pts[i+1])
       { it, k:'vert', i }        UM vertice do fio
       { it, k:'ref' } / 'com'    o texto do designador / do comment de um componente

   A identidade continua sendo a do objeto — o buildSchModel nao copia os itens, so os agrupa
   por folha, entao ela sobrevive ao reapply (e nao ao undo, que reconstroi tudo do JSON). O
   que muda e que agora ha um Map: dois alvos iguais precisam colidir na mesma chave, coisa que
   `Set.add({...})` nao faria — dois objetos iguais sao dois membros. A chave e um numero de
   serie por item (WeakMap, nao suja o objeto que vai para o arquivo) + o tipo + o indice. */
const sel = new Map();
let serieN = 0;
const SERIE = new WeakMap();
function idDe(it){ let n = SERIE.get(it); if (n == null){ n = ++serieN; SERIE.set(it, n); } return n; }
function chaveAlvo(a){ return idDe(a.it) + '|' + a.k + '|' + (a.i == null ? '' : a.i); }
const alvoAll = it => ({ it, k:'all' });
function selAdd(a){ sel.set(chaveAlvo(a), a); }
function selDel(a){ sel.delete(chaveAlvo(a)); }
function selTem(a){ return sel.has(chaveAlvo(a)); }
function selAlvos(){ return Array.from(sel.values()); }
/* os ITENS envolvidos, sem repetir: um fio com tres trechos marcados e um item so */
function selItens(){
  const out = [], vistos = new Set();
  for (const a of sel.values()) if (!vistos.has(a.it)){ vistos.add(a.it); out.push(a.it); }
  return out;
}
function selTemItem(it){ for (const a of sel.values()) if (a.it === it) return true; return false; }
function selSo(alvos){ sel.clear(); for (const a of alvos) selAdd(a); }
const SEL = '#2979ff';   /* azul da selecao — so no contorno tracejado, nunca no objeto */
let schDirty = false, schDiskSnapshot = null;
const undoStack = [JSON.stringify(schematic.items)], redoStack = [];
/* ------- a grade -------
   O passo deixou de ser 100 mil cravado. Motivo medido: as folhas desta casa snapam em 1 mm
   (39,37 mil) ou 0,3 mm no proprio Altium, e 3980 dos 4188 vertices de fio dos projetos deste
   workspace estao fora da grade de 100 mil — muitos nem sao inteiros. Uma grade que so sabe
   100 mil empurra o vertice para longe do pino a cada arrasto, e no Altium so liga o que
   coincide EXATAMENTE. A escolha fica lembrada nesta maquina, como o comment e os pinos. */
const VER_GRADE_KEY = 'altiumhub.sch.grade';
let grade = GRADES[0];
try { const g = localStorage.getItem(VER_GRADE_KEY); if (g) grade = gradePorId(g); } catch (e) {}
function snapG(v){ return snapPasso(v, grade.passo); }
const D = HubDraw;
const cv = $('cv');

function updateMeta(){
  $('meta').textContent = `${schematic.project} · ${model.sheets.length} folha(s) · ${nets.nets.length} nets`;
}
function reapply(){
  model = HubCore.buildSchModel(schematic);
  nets  = HubCore.extractNets(model, SLIB);
  val   = HubCore.validateSchematic(schematic, SLIB, PLIB);
  if (sheetIdx >= model.sheets.length) sheetIdx = 0;
  /* poda da selecao: o item pode ter sumido (Delete, undo, troca de simbolo) e o INDICE do
     alvo pode ter ficado fora de faixa — um fio que perdeu vertices por outro caminho deixa
     para tras um alvo apontando para um trecho que nao existe mais */
  for (const [k, a] of Array.from(sel)){
    const pts = a.it && a.it.pts;
    if (schematic.items.indexOf(a.it) < 0
        || (a.k === 'vert' && !(pts && a.i < pts.length))
        || (a.k === 'seg'  && !(pts && a.i < pts.length - 1))) sel.delete(k);
  }
  geomVer++;
  /* a net em foco tambem pode ter deixado de existir (apagou o fio, desfez): destaque
     apontando para uma net que sumiu e cor sem dono na tela */
  if (selNet && !nets.nets.some(n => n.name === selNet)) selNet = '';
  buildCompTable(); buildNetList(); buildValList(); updateMeta(); updateSelStatus(); renderProps();
  /* O cartao da folha mostra a folha COMO ELA ESTA, e este e o unico funil por onde passam
     commit, undo, redo, recarga de biblioteca e troca de simbolo. Repintar aqui e o que
     separa "miniatura" de "foto do carregamento". */
  renderSheetCards();
  cam.draw();
}
/* O Salvar grava o schematic.js. Ele gravava tambem o annotations.js; com o sinalizador
   fora da vista Esquema sobrou um arquivo so, e o `#savehint` deixou de precisar dizer
   QUAL dos dois esta pendente. O id #btnSave nao muda: o hub-odoolista.js o clica por id
   antes de montar a lista para o Odoo. */
function updateSaveBtn(){
  const d = schDirty;
  $('btnSave').classList.toggle('active', d);
  $('btnSaveLbl').textContent = d ? 'Salvar *' : 'Salvar';
  $('savehint').textContent = d ? 'alterado: esquema' : 'nada pendente';
}
function setSchDirty(v){ schDirty = v; updateSaveBtn(); }
function commit(){
  undoStack.push(JSON.stringify(schematic.items));
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  setSchDirty(true);
  reapply();
}
function restoreItems(json){
  schematic.items.length = 0;
  for (const it of JSON.parse(json)) schematic.items.push(it);
  sel.clear();
  selNet = '';         /* os itens sao outros objetos: o foco antigo nao tem mais dono */
  setSchDirty(true);
  reapply();
}
function undo(){ if (undoStack.length < 2) return; redoStack.push(undoStack.pop()); restoreItems(undoStack[undoStack.length - 1]); }
function redo(){ if (!redoStack.length) return; const s = redoStack.pop(); undoStack.push(s); restoreItems(s); }

/* ------- geometria da selecao ------- */
function sheetItems(si){
  const s = model.sheets[si === undefined ? sheetIdx : si];
  return [].concat(s.comps, s.wires, s.netlabels, s.powers, s.ports, s.junctions, s.noercs, s.texts);
}
const onSheet = it => it.sheet === model.sheets[sheetIdx].name;
function compBBox(c){
  const sym = HubCore.symbolOf(SLIB, c.sym), part = HubCore.partOf(sym, c.part);
  const emg = part ? null : desenhoDeEmergencia(c);
  const bb = part ? D.symBBox(part) : emg ? D.symBBox(emg.part) : { x1:-100, y1:-100, x2:100, y2:100 };
  const tf = HubCore.compTransform(c);
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  for (const [lx, ly] of [[bb.x1, bb.y1], [bb.x2, bb.y1], [bb.x2, bb.y2], [bb.x1, bb.y2]]){
    const w = tf.map(lx, ly);
    if (w.x < x1) x1 = w.x; if (w.x > x2) x2 = w.x; if (w.y < y1) y1 = w.y; if (w.y > y2) y2 = w.y;
  }
  return { x1, y1, x2, y2 };
}
/* ------- o designador e o comment na folha -------
   ONDE ELES POUSAM, e por que a conta mudou. Ate 2026-09-16 a ancora saia do bbox LOCAL do
   simbolo e usava `max(|y1|,|y2|)`, duas coisas erradas ao mesmo tempo:

   - o bbox local ignora a rotacao, entao num componente girado 90 o afastamento era calculado
     no eixo Y do SIMBOLO enquanto o corpo, na folha, ocupava o eixo X. Medido nos 12 projetos
     deste workspace: 142 dos 383 componentes com simbolo resolvido tinham o designador dentro
     do proprio corpo, e sao EXATAMENTE os rot 90 e 270 (nenhum caso em rot 0/180);
   - `max(|y1|,|y2|)` e simetrico em torno da ORIGEM, nao da borda: 94 dos 401 simbolos da casa
     jogavam o nome mais de 300 mil acima do corpo (o CONE BARRA [13V] vai de -2540 a 1320 e o
     ref saia em +2610).

   Agora a ancora sai da caixa do componente COMO ELA ESTA NA FOLHA (compBBox, que passa pelo
   compTransform) e da BORDA de verdade.

   QUANDO A MAO MOVE O TEXTO, ele deixa de ser derivado: `refdx/refdy` (e `comdx/comdy`)
   passam a valer, e sao o deslocamento em relacao a ANCORA DO COMPONENTE (c.x, c.y), em mil,
   na coordenada da folha. Tres razoes para ser assim, e nao "deslocamento em relacao ao lugar
   de origem":
     - o lado Altium consegue calcular: `Designator.Location = Location do componente + (dx,dy)`
       e uma conta que o BuildSchematic faz sem precisar refazer o bbox do simbolo do jeito que
       o hub faz — refazer daria numeros diferentes e o texto sairia noutro lugar no Altium;
     - mover o componente leva o texto junto de graca, sem uma linha de codigo;
     - girar o componente NAO gira o texto, que e o que o Altium tambem faz.
   Ausente = derivado. E por isso que "voltar ao lugar de origem" e apagar os dois campos.

   O PONTO e o CANTO INFERIOR-ESQUERDO do texto, e nao o centro dele — porque e esse o ponto
   que o Altium guarda (veja caixaTexto). O centro seria mais comodo aqui e faria o espelho
   mentir la: a posicao lida do Altium chegaria ao hub deslocada de meia palavra, e a posicao
   que a mao escolhe aqui chegaria ao Altium deslocada da mesma meia palavra, para o outro
   lado — um ciclo que nunca fecha. Um ponto so, e o dele. */
const FOLGA_TXT = 70;
function textoComp(c, qual){
  const bb = compBBox(c);
  const h = qual === 'com' ? 55 : 60;
  const s = qual === 'com' ? (c.comment || '') : c.ref;
  /* o lugar derivado centraliza a PALAVRA sobre o corpo, e para isso a ancora recua meia
     largura: centralizar e coisa do desenho, a ancora continua sendo o canto */
  const cx = (bb.x1 + bb.x2) / 2 - larguraTexto(s, h) / 2;
  const base = qual === 'com' ? { x:cx, y:bb.y1 - FOLGA_TXT - h } : { x:cx, y:bb.y2 + FOLGA_TXT };
  const dx = qual === 'com' ? c.comdx : c.refdx;
  const dy = qual === 'com' ? c.comdy : c.refdy;
  /* O PAR TEM DE ESTAR INTEIRO. Meio par (so o refdy, digamos) era desenhado com o eixo que
     falta valendo zero — e o lado Altium RECUSA meio par e nao toca no texto. Era a unica
     combinacao do formato em que a previa do hub e a folha do Altium mostravam coisas
     diferentes; tratar meio par como ausente nos dois lados acaba com ela. O erro continua
     sendo dito em voz alta: quem escrever meio par no arquivo leva [FALHA] no build-report. */
  const posto = (typeof dx === 'number' && typeof dy === 'number');
  return { x: posto ? c.x + (dx || 0) : base.x,
           y: posto ? c.y + (dy || 0) : base.y,
           h, s, bx:base.x, by:base.y, posto };
}
function textoBBox(c, qual){
  const t = textoComp(c, qual);
  return caixaTexto(t.x, t.y, t.s, t.h);
}
/* caixa de cada tipo de item, em mil — o mesmo alcance que o hitTest usa */
function itemBBox(it){
  switch (it.t){
    case 'comp': return compBBox(it);
    case 'wire': {
      let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
      for (const p of (it.pts || [])){ if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0]; if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1]; }
      return x1 > x2 ? { x1:0, y1:0, x2:0, y2:0 } : { x1, y1, x2, y2 };
    }
    case 'netlabel': return { x1:it.x - 20, y1:it.y - 20, x2:it.x + Math.max((it.net || '').length * 40, 120), y2:it.y + 80 };
    case 'power':    return { x1:it.x - 150, y1:it.y - 150, x2:it.x + 150, y2:it.y + 150 };
    /* A caixa da port vem do PROPRIO desenho (D.portBBox), nao de uma copia da geometria
       aqui: a barra nasce na ancora e cresce numa direcao so, entao cobrir os dois lados
       dobrava a area de clique — e no dia em que a direcao passar a sair do `style` a caixa
       acompanha sozinha, em vez de errar a port em silencio. */
    case 'port': return D.portBBox(it);
    case 'junction': return { x1:it.x - 35, y1:it.y - 35, x2:it.x + 35, y2:it.y + 35 };
    /* do tamanho do X desenhado, e nao maior: o No ERC mora EM CIMA da ponta do pino,
       e uma caixa generosa roubaria o clique do pino que ele marca */
    case 'noerc':    return { x1:it.x - 30, y1:it.y - 30, x2:it.x + 30, y2:it.y + 30 };
    case 'text': {
      const h = (it.h || 10) * 4;
      return { x1:it.x - 20, y1:it.y - h, x2:it.x + Math.max((it.s || '').length * (it.h || 10) * 4, 120), y2:it.y + h };
    }
  }
  return { x1:it.x || 0, y1:it.y || 0, x2:it.x || 0, y2:it.y || 0 };
}
const bbInside = (a, r) => a.x1 >= r.x1 && a.x2 <= r.x2 && a.y1 >= r.y1 && a.y2 <= r.y2;
const bbTouch  = (a, r) => a.x1 <= r.x2 && a.x2 >= r.x1 && a.y1 <= r.y2 && a.y2 >= r.y1;
function unionBBox(items){
  let u = null;
  for (const it of items){
    const b = itemBBox(it);
    u = u ? { x1:Math.min(u.x1, b.x1), y1:Math.min(u.y1, b.y1), x2:Math.max(u.x2, b.x2), y2:Math.max(u.y2, b.y2) } : b;
  }
  return u;
}
/* a caixa de UM alvo: o item inteiro, o trecho, o vertice ou o texto */
function alvoBBox(a){
  if (a.k === 'ref' || a.k === 'com') return textoBBox(a.it, a.k);
  if (a.k === 'vert'){
    const p = (a.it.pts || [])[a.i];
    return p ? { x1:p[0] - 30, y1:p[1] - 30, x2:p[0] + 30, y2:p[1] + 30 } : { x1:0, y1:0, x2:0, y2:0 };
  }
  if (a.k === 'seg'){
    const p = (a.it.pts || [])[a.i], q = (a.it.pts || [])[a.i + 1];
    if (!p || !q) return { x1:0, y1:0, x2:0, y2:0 };
    return { x1:Math.min(p[0], q[0]), y1:Math.min(p[1], q[1]), x2:Math.max(p[0], q[0]), y2:Math.max(p[1], q[1]) };
  }
  return itemBBox(a.it);
}
/* posicao de partida de cada ALVO selecionado: o arrasto e sempre "base + delta", nunca
   acumulado, para o passo da grade nao andar sozinho.
   A chave do Map e a chave do alvo (e nao o objeto item): dois trechos do MESMO fio sao dois
   alvos, e chaveando pelo item um deles apagaria a foto do outro. Quem precisa saber "este
   item esta viajando?" — o ima, para nao grudar o componente nele mesmo — usa `base.itens`. */
function baseOf(alvos){
  const m = new Map();
  m.itens = new Set();
  for (const a of alvos){
    const it = a.it;
    m.itens.add(it);
    if (a.k === 'ref' || a.k === 'com'){
      /* a foto do texto e a posicao ABSOLUTA de onde ele esta agora — inclusive quando ele
         ainda e derivado. Assim o primeiro arrasto tambem parte do lugar certo. */
      const t = textoComp(it, a.k);
      m.set(chaveAlvo(a), { a, x0:t.x, y0:t.y });
    }
    else if (a.k === 'vert' || a.k === 'seg')
      m.set(chaveAlvo(a), { a, pts:(it.pts || []).map(p => [p[0], p[1]]) });
    else if (it.t === 'wire')
      m.set(chaveAlvo(a), { a, pts:(it.pts || []).map(p => [p[0], p[1]]) });
    else
      m.set(chaveAlvo(a), { a, x:it.x, y:it.y });
  }
  return m;
}
function applyMove(base, dx, dy){
  geomVer++;                 /* a geometria mudou: a topologia (bolinha/ponte) tem de refazer */
  for (const b of base.values()){
    const a = b.a, it = a.it;
    if (a.k === 'ref' || a.k === 'com'){
      /* os DOIS campos sao gravados sempre que a mao move o texto, inclusive em zero: aqui o
         zero e uma posicao (o texto em cima da ancora do componente) e nao "sem opiniao".
         Quem apaga os campos e o "voltar ao lugar de origem" e o Delete no texto. */
      const nx = Math.round((b.x0 + dx - it.x) * 1e4) / 1e4, ny = Math.round((b.y0 + dy - it.y) * 1e4) / 1e4;
      if (a.k === 'com'){ it.comdx = nx; it.comdy = ny; } else { it.refdx = nx; it.refdy = ny; }
    }
    else if (a.k === 'vert'){
      const pts = b.pts.map(p => [p[0], p[1]]);
      if (pts[a.i]){ pts[a.i][0] += dx; pts[a.i][1] += dy; }
      it.pts = pts;
    }
    else if (a.k === 'seg') it.pts = moveSegmento(b.pts, a.i, dx, dy);
    else if (it.t === 'wire') it.pts = b.pts.map(p => [p[0] + dx, p[1] + dy]);
    else { it.x = b.x + dx; it.y = b.y + dy; }
  }
  /* os fios que acompanham os pinos movidos — o elastico. Vem DEPOIS da base: um fio que
     esteja ele proprio selecionado ja andou acima, e nao pode andar duas vezes (a montagem
     em `elasticoDoArrasto` ja o exclui). */
  if (base.elastico) for (const e of base.elastico){
    const p = (e.w.pts || [])[e.i];
    if (p){ p[0] = e.x + dx; p[1] = e.y + dy; }
  }
}
function describe(a){
  const it = a && a.it ? a.it : a;      /* aceita alvo ou item cru: a tabela ainda passa item */
  if (a && a.k === 'ref') return 'designador ' + it.ref;
  if (a && a.k === 'com') return 'comment de ' + it.ref;
  if (a && a.k === 'seg') return 'trecho ' + (a.i + 1) + ' de ' + Math.max((it.pts || []).length - 1, 1) + ' do fio';
  if (a && a.k === 'vert') return 'vértice ' + (a.i + 1) + ' do fio';
  return it.t === 'comp' ? it.ref : it.t === 'wire' ? 'fio' : it.t === 'netlabel' ? 'label ' + (it.net || '')
       : it.t === 'power' ? 'power ' + (it.net || '') : it.t === 'junction' ? 'junção'
       : it.t === 'noerc' ? 'No ERC' : 'texto';
}
function updateSelStatus(){
  const n = sel.size;
  const s = !n ? '' : n === 1 ? describe(sel.values().next().value) + ' selecionado' : n + ' selecionados';
  /* o laranja precisa de dono escrito: sem isso a net acesa nao tem nome nem jeito obvio de
     apagar, e a cor parece travada na folha */
  $('ssel').textContent = selNet ? (s ? s + ' · net ' + selNet : 'net ' + selNet) : s;
}

/* ------- selecao e foco de net, um escritor so -------
   Sao dois estados que tem que andar juntos: 'sel' (o que esta marcado) e 'selNet' (a net
   acesa em laranja). Enquanto cada caminho mexia num e esquecia o outro — Escape, tabela,
   retangulo, troca de folha, undo, Ctrl+A — a folha ficava laranja sem nada selecionado e
   sem gesto para desligar. Agora quem mexe na selecao diz, na MESMA chamada, que net fica
   em foco; nao ha caminho que escreva 'selNet' por fora. */
let netListDe = null;                    /* de que selNet a lista lateral foi desenhada */
function aplicaSel(net){
  /* net sem linha no painel nao tem interruptor: acender pintaria a folha sem jeito de
     apagar (grupo de um pino so ganha nome automatico e nao entra em nets.nets) */
  selNet = net && nets.nets.some(n => n.name === net) ? net : '';
  buildCompTable(); updateSelStatus(); renderProps(); mostraProps();
  if (netListDe !== selNet) buildNetList();
  cam.draw();
}
function limpaSel(){ sel.clear(); aplicaSel(''); }
/* que net o alvo do clique representa; '' quando o alvo nao e de net (componente, texto) */
function netDoAlvo(h){
  if (!h) return '';
  if (h.kind === 'pin')  return nets.pinNet[h.ref + '-' + h.num] || '';
  if (h.kind === 'wire') return nets.wireNet[sheetIdx][h.wi] || '';
  /* rotulo, power e junção sao objetos DE net: clicar neles acende a net, nao apaga */
  if (h.kind === 'ref' || h.kind === 'com') return '';   /* texto nao e objeto de net */
  if (h.kind === 'netlabel' || h.kind === 'power') return h.item.net || '';
  if (h.kind === 'junction') return netEm(h.item.x, h.item.y);
  return '';
}
/* a net que passa por um ponto da folha — o fio que encosta nele manda */
function netEm(x, y){
  const s = model.sheets[sheetIdx];
  for (let wi = 0; wi < s.wires.length; wi++){
    const pts = s.wires[wi].pts || [];
    for (let i = 0; i < pts.length - 1; i++)
      if (HubCore.distSeg(x, y, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]) <= 1)
        return nets.wireNet[sheetIdx][wi] || '';
  }
  return '';
}
function selectOnly(items){ selSo(items.map(alvoAll)); aplicaSel(''); }
function rotateSel(){
  const comps = selItens().filter(it => it.t === 'comp');
  if (!comps.length) return;
  for (const c of comps) c.rot = (((c.rot || 0) + 90) % 360);
  if (mouse && mouse.mode === 'move') cam.draw(); else commit();
}
/* Espelhar o que se VE: 'x' vira esquerda/direita, 'y' vira em cima/embaixo, em qualquer
   rotacao. A conta esta no bloco puro (espelha) e vale para os dois eixos. */
function mirrorSel(eixo){
  const comps = selItens().filter(it => it.t === 'comp');
  if (!comps.length) return;
  for (const c of comps){
    const r = espelha(c.rot, !!c.mirror, eixo === 'y' ? 'y' : 'x');
    if (r.rot) c.rot = r.rot; else c.rot = 0;
    if (r.mirror) c.mirror = true; else delete c.mirror;
  }
  if (mouse && mouse.mode === 'move') cam.draw(); else commit();
}
/* ------- apagar -------
   O Delete agora entende o que esta marcado. No fio, apagar um TRECHO parte a polilinha em
   duas (e e essa a troca de "apagar tudo e refazer" pelo gesto de tirar so o pedaco errado);
   apagar um VERTICE endireita o fio ali. Ponta que sobra com menos de dois pontos nao vira
   fio — o serializeSchematic recusaria o arquivo inteiro por causa dela.
   O texto do designador nao se apaga: o Delete nele DEVOLVE o texto ao lugar de origem, que
   e o unico "apagar" que faz sentido para uma posicao. */
function deleteSel(){
  if (!sel.size) return;
  const fora = new Set();            /* itens a remover do arquivo */
  const novos = [];                  /* fios nascidos de um corte */
  /* os trechos e vertices do mesmo fio sao resolvidos JUNTOS: cortar um por vez invalidaria
     os indices dos outros no meio do caminho */
  const porFio = new Map();
  let mexeu = false;
  for (const a of sel.values()){
    if (a.k === 'seg' || a.k === 'vert'){
      let l = porFio.get(a.it); if (!l){ l = []; porFio.set(a.it, l); }
      l.push(a);
    } else if (a.k === 'ref'){ delete a.it.refdx; delete a.it.refdy; mexeu = true; }
    else if (a.k === 'com'){ delete a.it.comdx; delete a.it.comdy; mexeu = true; }
    else { fora.add(a.it); mexeu = true; }
  }
  for (const [w, alvos] of porFio){
    if (fora.has(w)) continue;
    /* do maior indice para o menor: assim o corte de um nao mexe no indice do proximo */
    let pedacos = [w.pts || []];
    const ordem = alvos.slice().sort((p, q) => q.i - p.i);
    for (const a of ordem){
      const saida = [];
      for (const pts of pedacos){
        /* o pedaco que contem este indice e o que foi cortado — os outros passam intactos */
        if (pts !== pedacos[0]){ saida.push(pts); continue; }
        if (a.k === 'seg') saida.push.apply(saida, apagaSegmento(pts, a.i));
        else { const r = apagaVertice(pts, a.i); if (r) saida.push(r); }
      }
      pedacos = saida;
      if (!pedacos.length) break;
    }
    mexeu = true;
    if (!pedacos.length){ fora.add(w); continue; }
    w.pts = pedacos[0];
    for (let i = 1; i < pedacos.length; i++)
      novos.push({ t:'wire', sheet:w.sheet, pts:pedacos[i] });
  }
  for (const it of fora){ const i = schematic.items.indexOf(it); if (i >= 0) schematic.items.splice(i, 1); }
  for (const w of novos) schematic.items.push(w);
  sel.clear();
  selNet = '';        /* os fios da net podem ter ido junto; o reapply do commit revalida */
  if (mexeu) commit(); else aplicaSel('');
}

/* ------- ferramentas da barra -------
   So o que a MAO faz nesta vista: escolher/mover, puxar fio e pousar um terra ou um trilho
   de alimentacao. Rotulo, texto, junção e troca de valor/footprint sao da IA, no
   schematic.js — por isso nao existem botoes para eles. */
let tool = 'select';        /* 'select' | 'wire' | 'power' | 'label' */
let toolPower = null;       /* { net, style, rot } quando tool === 'power' */
let toolNet = '';           /* a palavra na mao quando tool === 'label' */
let wireDraw = null;        /* { pts:[[x,y],...] } enquanto o fio esta sendo puxado */
let snapHit = null;         /* ponto magnetico sob o cursor: { x, y, kind, label } */

/* O IMA: enquanto uma ferramenta esta ativa, o cursor procura um ponto de conexao por
   perto — ponta quente de pino primeiro, depois vertice de fio, junção e power.
   O RAIO ACOMPANHA A GRADE. Com 100 mil ele e 60, como sempre foi — "meia grade", perto o
   bastante para nao roubar o clique de quem quer o ponto livre. Com uma grade de 10 mil, 60
   mil seriam SEIS grades de alcance: o ima capturaria pontos que a mao nem estava mirando e o
   pouso deixaria de ser previsivel. O piso de 20 mil existe para o ima nao sumir na grade
   mais fina, onde ele e justamente o que faz o fio encostar no pino. */
const snapMil = () => Math.max(20, Math.min(60, grade.passo * 0.6));
function snapPoint(w){
  const s = model.sheets[sheetIdx];
  let best = null;
  /* `html` so aparece onde ha o que barrar: e o mesmo rotulo, com o <span> da sobrelinha.
     Quem mostra escolhe — a barra de status pinta o html, o resto continua em texto. */
  const tenta = (x, y, kind, label, peso, html) => {
    const d = Math.hypot(w.x - x, w.y - y);
    if (d > snapMil()) return;
    if (!best || peso < best.peso || (peso === best.peso && d < best.d)) best = { x, y, d, kind, label, html: html || null, peso };
  };
  for (const c of s.comps){
    const pins = HubCore.compPinsWorld(c, SLIB) || [];
    const ovb = OVB();
    for (const p of pins){
      const mostra = p.name && p.name !== p.num;
      const base = c.ref + '-' + p.num;
      tenta(p.x, p.y, 'pin', base + (mostra ? ' (' + (ovb ? ovb.plain(p.name) : p.name) + ')' : ''), 0,
            mostra && ovb && ovb.temBarra(p.name) ? ovb.html(base) + ' (' + ovb.html(p.name) + ')' : null);
    }
  }
  for (const j of s.junctions) tenta(j.x, j.y, 'junction', 'junção', 1);
  for (const p of s.powers)    tenta(p.x, p.y, 'power', p.net || 'power', 1);
  for (const p of s.ports)     tenta(p.x, p.y, 'port', p.net || 'port', 1);
  for (const wi of s.wires) for (const p of (wi.pts || [])) tenta(p[0], p[1], 'wire', 'fio', 2);
  return best;
}
/* ── O IMA DO ARRASTO ──
   Aproximar um componente da ponta de um fio nao bastava: o pouso era na grade de 100 mil
   contada a partir da posicao ANTIGA, entao o pino parava a 20 ou 40 mil do fio e a net nao
   fechava — o desenho dizia "ligado" e a extracao de nets dizia "solto". Agora o pino GRUDA:
   se durante o arrasto alguma ponta quente do que esta sendo movido chega a menos de
   snapMil() de um ponto de conexao PARADO, o deslocamento inteiro e corrigido para ela cair
   exatamente em cima, e o ima manda sobre a grade ao soltar.
   Alvo nunca e o que viaja junto, senao o componente grudaria nele mesmo.
   Aqui o criterio e a distancia pura, e nao o peso por tipo do snapPoint: quem arrasta esta
   mirando um ponto, e o mais perto do pino e o ponto que ele esta mirando. */
function alvosDeIma(base){
  const s = model.sheets[sheetIdx], fora = [], viaja = base.itens;
  for (const c of s.comps){
    if (viaja.has(c)) continue;
    for (const p of (HubCore.compPinsWorld(c, SLIB) || [])) fora.push({ x:p.x, y:p.y, label:c.ref + '-' + p.num });
  }
  for (const wi of s.wires){
    if (viaja.has(wi)) continue;
    for (const p of (wi.pts || [])) fora.push({ x:p[0], y:p[1], label:'fio' });
  }
  for (const j of s.junctions) if (!viaja.has(j)) fora.push({ x:j.x, y:j.y, label:'junção' });
  for (const p of s.powers)    if (!viaja.has(p)) fora.push({ x:p.x, y:p.y, label:p.net || 'power' });
  for (const p of s.ports)     if (!viaja.has(p)) fora.push({ x:p.x, y:p.y, label:p.net || 'port' });
  return fora;
}
/* O que viaja e pode GRUDAR, na posicao de PARTIDA: o arrasto so lhe soma o deslocamento,
   entao medir uma vez por gesto basta — e nao a folha inteira a cada quadro.
   Eram so as pontas quentes de componente; agora o vertice de fio tambem gruda, e e isso que
   permite puxar a ponta do fio ate o pino em vez de mirar o pixel. */
function pinosDoArrasto(base){
  const fora = [];
  for (const b of base.values()){
    const a = b.a, it = a.it;
    if (it.t === 'comp' && a.k === 'all'){
      for (const p of (HubCore.compPinsWorld(it, SLIB) || [])) fora.push({ x:p.x, y:p.y, num:p.num, ref:it.ref });
    } else if (it.t === 'wire' && (a.k === 'vert' || a.k === 'seg' || a.k === 'all')){
      const idx = a.k === 'vert' ? [a.i] : a.k === 'seg' ? [a.i, a.i + 1] : (it.pts || []).map((p, i) => i);
      for (const i of idx){
        const p = b.pts && b.pts[i];
        if (p) fora.push({ x:p[0], y:p[1], num:'', ref:'fio' });
      }
    }
  }
  return fora;
}
/* ── O ELASTICO ──
   Mover um componente deixava os fios parados: o desenho continuava encostado (o simbolo passa
   por cima) e a net se desfazia calada, porque a extracao casa por coordenada EXATA. Agora os
   vertices de fio que estavam em cima de uma ponta quente dos componentes que viajam andam
   junto, como no Altium.
   Montado UMA vez por gesto, pelo mesmo motivo do ima: varrer os pinos de 200 componentes a
   cada quadro engasga o arrasto. Fio que ja esta na selecao fica de fora — ele ja anda pela
   base, e andar duas vezes o levaria ao dobro do deslocamento. */
function elasticoDoArrasto(base){
  const s = model.sheets[sheetIdx], out = [], pinos = [];
  /* SO o componente que esta viajando INTEIRO puxa fio. `base.itens` guarda o item de todo
     alvo do gesto, e o texto do designador e um alvo DO COMPONENTE: sem este `k === 'all'`,
     arrastar o nome de um resistor levava junto todos os fios ligados a ele — os pinos nao
     tinham saido do lugar, e mesmo assim a fiacao andava. */
  for (const b of base.values()){
    if (b.a.k !== 'all' || b.a.it.t !== 'comp') continue;
    for (const p of (HubCore.compPinsWorld(b.a.it, SLIB) || [])) pinos.push(p);
  }
  if (!pinos.length) return out;
  for (const w of s.wires){
    if (base.itens.has(w)) continue;
    const pts = w.pts || [];
    for (let i = 0; i < pts.length; i++)
      for (const p of pinos)
        if (pertoDe(pts[i][0], pts[i][1], p.x, p.y)){ out.push({ w, i, x:pts[i][0], y:pts[i][1] }); break; }
  }
  return out;
}
/* o deslocamento corrigido para o pino mais proximo pousar em cima do alvo; null = sem ima */
function imaDoArrasto(g, dx, dy){
  if (!g || !g.pinos.length || !g.alvos.length) return null;
  let best = null;
  for (const p of g.pinos){
    const px = p.x + dx, py = p.y + dy;
    for (const a of g.alvos){
      const d = Math.hypot(px - a.x, py - a.y);
      if (d > snapMil() || (best && d >= best.d)) continue;
      best = { d, dx: dx + (a.x - px), dy: dy + (a.y - py), x:a.x, y:a.y,
               label: (p.num ? p.ref + '-' + p.num : p.ref) + ' → ' + a.label };
    }
  }
  return best;
}
/* proximo ponto do fio: o ima ganha; sem ima, grade de 100 mil e traçado ortogonal */
function wirePoint(w){
  const hs = snapPoint(w);
  if (hs) return { pt:[hs.x, hs.y], snap:hs };
  const gx = snapG(w.x), gy = snapG(w.y);
  if (!wireDraw || !wireDraw.pts.length) return { pt:[gx, gy], snap:null };
  const last = wireDraw.pts[wireDraw.pts.length - 1];
  return { pt: (Math.abs(gx - last[0]) >= Math.abs(gy - last[1])) ? [gx, last[1]] : [last[0], gy], snap:null };
}
function wireClick(w){
  const r = wirePoint(w);
  if (!wireDraw){ wireDraw = { pts:[r.pt] }; cam.draw(); return; }
  const last = wireDraw.pts[wireDraw.pts.length - 1];
  const [x, y] = r.pt;
  if (x === last[0] && y === last[1]) return;
  /* ponto magnetico fora do eixo: entra um canto, como o Altium faz */
  if (x !== last[0] && y !== last[1]) wireDraw.pts.push([x, last[1]]);
  wireDraw.pts.push([x, y]);
  /* encostou num pino: o fio acabou ali */
  if (r.snap && r.snap.kind === 'pin') endWire(); else cam.draw();
}
function endWire(){
  const d = wireDraw; wireDraw = null;
  if (d && d.pts.length >= 2){
    schematic.items.push({ t:'wire', sheet:model.sheets[sheetIdx].name, pts:d.pts });
    commit();
  } else cam.draw();
}
/* O No ERC pousa onde o ima mandar — e o ponto que ele marca precisa ser EXATAMENTE a
   ponta quente do pino, senao o Altium recebe a diretiva ao lado do pino e o ERC
   continua reclamando do mesmo pino. Sem ima, grade de 100 mil como o resto. */
function placeNoERC(w){
  const hs = snapPoint(w);
  schematic.items.push({ t:'noerc', sheet:model.sheets[sheetIdx].name,
                         x: hs ? hs.x : snapG(w.x), y: hs ? hs.y : snapG(w.y) });
  commit();
}
function placePower(w){
  const hs = snapPoint(w);
  const p = toolPower;
  schematic.items.push({ t:'power', sheet:model.sheets[sheetIdx].name, net:p.net, style:p.style,
                         x: hs ? hs.x : snapG(w.x), y: hs ? hs.y : snapG(w.y), rot:p.rot });
  commit();
}
/* O rotulo de net: uma palavra pousada na folha. Quem une dois rotulos de mesmo nome e o
   extractNets (fusao por nome), nao esta funcao — aqui e so pousar. */
function placeLabel(w){
  if (!toolNet) return;
  const hs = snapPoint(w);
  schematic.items.push({ t:'netlabel', sheet:model.sheets[sheetIdx].name, net:toolNet,
                         x: hs ? hs.x : snapG(w.x), y: hs ? hs.y : snapG(w.y), rot:0 });
  commit();
}
function setTool(t, pw){
  tool = t; toolPower = pw || null; wireDraw = null; snapHit = null;
  if (t !== 'label') toolNet = '';
  $('tbSel').setAttribute('aria-pressed', String(t === 'select'));
  $('tbWire').setAttribute('aria-pressed', String(t === 'wire'));
  $('tbNet').setAttribute('aria-pressed', String(t === 'label'));
  $('tbNoErc').setAttribute('aria-pressed', String(t === 'noerc'));
  for (const b of document.querySelectorAll('#schtb .pw'))
    b.setAttribute('aria-pressed', String(t === 'power' && !!pw && b.dataset.net === pw.net));
  cv.style.cursor = t !== 'select' ? 'crosshair' : 'default';
  cam.draw();
}
$('tbSel').addEventListener('click', () => setTool('select'));
$('tbWire').addEventListener('click', () => setTool(tool === 'wire' ? 'select' : 'wire'));
$('tbNoErc').addEventListener('click', () => setTool(tool === 'noerc' ? 'select' : 'noerc'));
for (const b of document.querySelectorAll('#schtb .pw'))
  b.addEventListener('click', () => {
    const igual = tool === 'power' && toolPower && toolPower.net === b.dataset.net;
    /* o terra aponta para baixo, o trilho de alimentacao para cima — como no Altium */
    setTool(igual ? 'select' : 'power', igual ? null
      : { net:b.dataset.net, style:b.dataset.style, rot: b.dataset.style === 'Bar' ? 90 : 270 });
  });

/* ------- recarga de biblioteca, sem F5 -------
   O editor de simbolos grava no espelho (Libs\schlib.js e os acervos do almoxarifado) e o
   watcher do hubserver avisa esta pagina. Recarregar a pagina inteira e a saida simples — e
   a errada quando ha edicao pendente na folha, porque joga o trabalho fora. Aqui as
   bibliotecas voltam sozinhas: cada <script src> entra DE NOVO com um ?v= novo (o mesmo
   truque do loadVarScript da casca), os acervos sao remontados pelo montaAcervos e a vista
   redesenha. O `schematic` nao e tocado: nem a selecao, nem o undo, nem o que esta por
   salvar. */
function recarregaLib(l, v){
  return new Promise(resolve => {
    const antes = window[l.nome];
    window[l.nome] = undefined;
    const s = document.createElement('script');
    s.src = l.src + '?v=' + v;
    s.onload = () => {
      const veio = window[l.nome];
      s.remove();
      /* carregou mas nao definiu o global (arquivo pela metade porque o sync estava
         escrevendo, erro de sintaxe): vale o mesmo que 404 — fica valendo o de antes */
      if (veio === undefined){ window[l.nome] = antes; resolve({ l, ok:false }); return; }
      resolve({ l, ok:true });
    };
    s.onerror = () => { window[l.nome] = antes; s.remove(); resolve({ l, ok:false }); };
    document.head.appendChild(s);
  });
}
let libRecarga = null;
/* Chamada pelo botao da barra, pelo __hubOnChange daqui e pelo hub (que a invoca em cada
   iframe quando o disco muda). Devolve Promise com
   { mudou, acervos, simbolos, falhas, caidos } — quem chamou decide o que dizer. */
window.__hubRecarregaLibs = function(){
  if (libRecarga) return libRecarga;          /* duas chamadas juntas: uma recarga so */
  const antes = carimbo(ACERVOS);
  const v = Date.now();
  libRecarga = Promise.all(LIBS.map(l => recarregaLib(l, v))).then(res => {
    aplicaAcervos();
    /* o modelo do esquema e o mesmo; o que mudou foi a biblioteca que o desenho, a
       extracao de nets e a validacao CONSULTAM — e tudo isso passa pelo reapply */
    reapply();
    /* o combobox de acervo do modal e montado uma vez so: um acervo a mais (ou a menos)
       so aparece la se ele for refeito */
    const src = $('addSrc'); if (src) src.textContent = '';
    if (addOpen()){ buildAddSrc(); buildAddList(); renderAddPreview(); }
    if ($('symmodal').classList.contains('on')) symRenderLista();
    return { mudou: carimbo(ACERVOS) !== antes,
             acervos: ACERVOS.length, simbolos: SLIB.symbols.length,
             falhas: res.filter(r => !r.ok).map(r => r.l.src),
             caidos: ACERVOS.filter(a => a.caiu).map(a => a.titulo) };
  }).then(r => { libRecarga = null; return r; },
          e => { libRecarga = null; throw e; });
  return libRecarga;
};
/* O BOTAO, pedido explicito do usuario. O automatico depende do watcher do hubserver, que e
   por polling de mtime — e nao existe com a pagina aberta direto do disco (file://). Aqui
   ele forca, e ve o que veio. */
function montaBotaoLibs(){
  const tb = $('schtb');
  if (!tb) return;
  tb.append(el('span', 'sep'));
  const b = el('button');
  b.id = 'tbLibs';
  b.setAttribute('aria-label', 'Atualizar biblioteca');
  b.title = 'Recarregar do disco os componentes e footprints (Libs\\) sem recarregar a página'
          + ' — a edição pendente da folha NÃO se perde';
  b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 6.3"/>'
              + '<path d="M20 5v6h-6"/></svg>';
  b.append(el('span', 'lb', 'libs'));
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const r = await window.__hubRecarregaLibs();
      if (r.falhas.length)
        HubDialog.toast('não carregou ' + r.falhas.join(', ') + ' — o acervo anterior foi mantido ('
                        + r.simbolos + ' componentes)', 'warn', 7000);
      else if (r.mudou)
        HubDialog.toast('biblioteca recarregada — ' + r.simbolos + ' componentes em '
                        + r.acervos + ' acervo(s)', 'ok');
      else
        HubDialog.toast('nada mudou na biblioteca — ' + r.simbolos + ' componentes', 'info');
    } catch (e){
      HubDialog.toast('não deu para recarregar a biblioteca: ' + (e && e.message || e), 'err', 7000);
    }
    b.disabled = false;
  });
  tb.append(b);
}
montaBotaoLibs();

/* ------- mouse: esquerdo seleciona e move, direito arrasta a tela -------
   O mkCamera (hub-draw.js) arrasta a tela com QUALQUER botao e nao sabe de selecao. Em vez
   de mexer nele — e mudar junto o PCB, as previews da Biblioteca e o laser —, os eventos do
   botao esquerdo sao interceptados aqui: ouvintes de CAPTURA, registrados ANTES da camera
   existir, que param o evento ali (stopImmediatePropagation). O direito e o do meio passam
   direto e viram o pan de sempre; a roda continua sendo o zoom da camera. */
let hoverW = null;          /* cursor em coords do mundo */
let mouse = null;           /* gesto do esquerdo em curso: { mode:'move'|'box'|'none', start, moved, base, shift } */
let lastDown = null;        /* o que o ultimo mousedown acertou, para o Shift+clique saber se tira */
let boxRect = null;         /* retangulo de selecao em curso (mundo) */
let moveIma = null;         /* alvo grudado pelo ima do arrasto: { x, y, dx, dy, label } */
let swallowClick = false;   /* o click que fecha um arrasto nao e um clique */
let panning = false, panFrom = null, panMoved = false;

function worldOf(e){ const r = cv.getBoundingClientRect(); return cam.toWorld(e.clientX - r.left, e.clientY - r.top); }

window.addEventListener('mousedown', () => { panning = false; }, true);
cv.addEventListener('mousedown', e => {
  if (e.button !== 0){                                  /* direito/meio: pan da camera */
    panning = true; panMoved = false; panFrom = { x:e.clientX, y:e.clientY };
    cv.style.cursor = 'grabbing'; return;
  }
  e.stopImmediatePropagation();
  leftDown(e);
}, true);
cv.addEventListener('click', e => { e.stopImmediatePropagation(); leftClick(e); }, true);
cv.addEventListener('contextmenu', e => e.preventDefault());
/* soltar o direito fora do canvas dispararia o menu do navegador em cima do painel.
   Direito SEM arrastar encerra o fio, como no Altium; com arrasto, foi so um pan. */
window.addEventListener('contextmenu', e => {
  if (!panning) return;
  e.preventDefault();
  const arrastou = panMoved;
  panning = false; panMoved = false;
  if (!arrastou && wireDraw) endWire();
});
window.addEventListener('mousemove', e => {
  if (mouse){ leftMove(e); return; }
  if (panning && panFrom && Math.hypot(e.clientX - panFrom.x, e.clientY - panFrom.y) > 4) panMoved = true;
});
window.addEventListener('mouseup', e => {
  if (e.button === 0){ leftUp(e); return; }
  cv.style.cursor = 'default';
  if (e.button !== 2) panning = false;      /* o direito espera o contextmenu para zerar */
});
window.addEventListener('blur', () => {
  if (!mouse) return;
  if (mouse.mode === 'move') applyMove(mouse.base, 0, 0);
  mouse = null; boxRect = null; cam.draw();
});

function leftDown(e){
  const w = worldOf(e);
  swallowClick = false;
  lastDown = null;        /* o click deste gesto so pode ver o que ESTE mousedown acertou */
  /* com uma ferramenta na mao o esquerdo nao seleciona nem arrasta: ele coloca */
  if (tool !== 'select'){ mouse = { mode:'none', start:w, moved:false }; return; }
  const h = hitTest(w.x, w.y);
  if (!h){
    mouse = { mode:'box', start:w, moved:false, shift:e.shiftKey };
    lastDown = null;
    return;
  }
  /* O ALVO do clique, e nao mais "o item inteiro". Num fio, o hitTest diz qual TRECHO e, se o
     cursor estiver em cima de um vertice, qual vertice — e e o vertice que ganha, porque quem
     mira a alcinha esta querendo mexer no canto. O fio inteiro continua alcançavel: clique
     duplo promove (veja o dblclick mais abaixo) e o retangulo de selecao pega fio inteiro. */
  const a = alvoDoHit(h);
  const wasSel = selTem(a);
  if (!wasSel){ if (!e.shiftKey) sel.clear(); selAdd(a); }
  lastDown = { alvo:a, wasSel };
  const base = baseOf(selAlvos());
  /* o ima e o elastico sao montados aqui, e nao no primeiro movimento: a folha parada e a
     mesma o gesto inteiro, e varrer os pinos de 200 componentes a cada quadro engasgaria */
  base.elastico = elasticoDoArrasto(base);
  mouse = { mode:'move', start:w, moved:false, base,
            ima: { alvos: alvosDeIma(base), pinos: pinosDoArrasto(base) } };
  moveIma = null;
  /* a net entra em foco AQUI, e nao no click: todo arrasto engole o click (swallowClick), e
     a net anterior ficava acesa por cima de uma selecao que ja era outra */
  aplicaSel(e.shiftKey && sel.size > 1 ? '' : netDoAlvo(h));
}
/* do que o hitTest devolveu para o alvo que a selecao guarda */
function alvoDoHit(h){
  if (h.kind === 'ref' || h.kind === 'com') return { it:h.item, k:h.kind };
  if (h.kind === 'wire'){
    if (h.vert != null) return { it:h.item, k:'vert', i:h.vert };
    if (h.seg  != null) return { it:h.item, k:'seg',  i:h.seg };
  }
  return alvoAll(h.item);
}
/* um desenho por quadro: cada mousemove pedia um cam.draw() inteiro e, em folha grande, o
   arrasto engasgava atras da fila de eventos */
let quadro = 0;
function desenhaNoQuadro(){ if (!quadro) quadro = requestAnimationFrame(() => { quadro = 0; cam.draw(); }); }
function leftMove(e){
  const d = mouse, w = worldOf(e);
  const dx = w.x - d.start.x, dy = w.y - d.start.y;
  if (!d.moved && Math.hypot(dx, dy) * cam.cam.scale < 3) return;   /* 3 px de folga: clique nao vira arrasto */
  d.moved = true;
  /* durante o arrasto o item acompanha o mouse; a grade so entra ao soltar (leftUp). Com o
     snap a cada movimento ele so saia do lugar depois de 50 mil e pulava de 100 em 100 — em
     zoom alto parecia travado */
  if (d.mode === 'move'){
    moveIma = imaDoArrasto(d.ima, dx, dy);
    applyMove(d.base, moveIma ? moveIma.dx : dx, moveIma ? moveIma.dy : dy);
    $('shover').textContent = moveIma ? '⊙ ' + moveIma.label : '';
    desenhaNoQuadro();
  }
  else if (d.mode === 'box'){ boxRect = { x1:d.start.x, y1:d.start.y, x2:w.x, y2:w.y }; desenhaNoQuadro(); }
  /* O terceiro modo, 'none', e o arrasto com uma FERRAMENTA na mao: nao move nada, e e
     assim que tem de ser. Havia aqui um toast "Só leitura" pendurado nesse mesmo ramo — ele
     ja disparava indevidamente com a ferramenta na mao, e com o lapis fora nao teria mais o
     que dizer. */
}
function leftUp(e){
  const d = mouse; if (!d) return;
  mouse = null;
  swallowClick = d.moved;
  if (d.mode === 'move' && d.moved){
    /* ao soltar: sem ima, o deslocamento pousa na grade de 100 mil contada da posicao
       original — com ima, quem manda e ele (veja imaDoArrasto) */
    const w = e ? worldOf(e) : d.start;
    const rx = w.x - d.start.x, ry = w.y - d.start.y;
    /* o ima MANDA sobre a grade: e ele que faz o pino cair em cima da ponta do fio, e
       100 mil de grade contados da posicao antiga jogariam o pino fora dela de novo */
    const m = imaDoArrasto(d.ima, rx, ry);
    if (m) applyMove(d.base, m.dx, m.dy); else applyMove(d.base, snapG(rx), snapG(ry));
    moveIma = null; $('shover').textContent = '';
    /* Arrasto que voltou para a mesma grade nao e mudanca — nao entra no undo.
       A conta olhava SO o pts[0] do fio: arrastar um vertice do meio (que agora e um gesto de
       verdade) mudava o desenho, nao entrava no undo e nao acendia o "Salvar *" — a falha
       silenciosa que so aparece quando a pagina recarrega e o trabalho sumiu. Agora compara
       ponto a ponto, mais o deslocamento do texto e mais o elastico. */
    const mudou = Array.from(d.base.values()).some(b => {
      const a = b.a, it = a.it;
      if (a.k === 'ref' || a.k === 'com'){ const t = textoComp(it, a.k); return t.x !== b.x0 || t.y !== b.y0; }
      if (b.pts) return (it.pts || []).some((p, i) => !b.pts[i] || p[0] !== b.pts[i][0] || p[1] !== b.pts[i][1]);
      return it.x !== b.x || it.y !== b.y;
    }) || (d.base.elastico || []).some(e => {
      const p = (e.w.pts || [])[e.i];
      return p && (p[0] !== e.x || p[1] !== e.y);
    });
    if (mudou) commit(); else cam.draw();
    return;
  }
  if (d.mode === 'box' && d.moved && boxRect){
    const r = boxRect; boxRect = null;
    const n = { x1:Math.min(r.x1, r.x2), y1:Math.min(r.y1, r.y2), x2:Math.max(r.x1, r.x2), y2:Math.max(r.y1, r.y2) };
    /* esquerda→direita pega so quem cabe inteiro; direita→esquerda pega quem encosta (como no Altium) */
    const inteiro = r.x2 >= r.x1;
    if (!d.shift) sel.clear();
    /* O RETANGULO CONTINUA PEGANDO ITEM INTEIRO. E de proposito: o gesto de laço serve para
       pegar um pedaço da folha e arrasta-lo junto, e um laço que devolvesse trechos soltos
       partiria os fios ao mover. O trecho e coisa do clique; o laço e coisa do bloco. */
    for (const it of sheetItems()){ const bb = itemBBox(it); if (inteiro ? bbInside(bb, n) : bbTouch(bb, n)) selAdd(alvoAll(it)); }
    aplicaSel('');     /* selecao de varios nao tem uma net so: apaga o foco anterior */
    return;
  }
  boxRect = null; cam.draw();
}
function leftClick(e){
  if (swallowClick){ swallowClick = false; return; }
  const w = worldOf(e);
  if (tool === 'wire'){ wireClick(w); return; }
  if (tool === 'power'){ placePower(w); return; }
  if (tool === 'label'){ placeLabel(w); return; }
  if (tool === 'noerc'){ placeNoERC(w); return; }
  /* O alvo foi resolvido no mousedown (lastDown) e NAO se refaz o hitTest aqui: entre o
     mousedown e o click a ficha abriu e o canvas mudou de largura, entao o mesmo ponto de
     tela cai em outro ponto do mundo, "erra" o componente que acabou de ser marcado e
     limpava a selecao — era isso que fazia a ficha abrir e fechar no mesmo clique. */
  if (!lastDown){ if (!e.shiftKey) limpaSel(); return; }
  if (e.shiftKey && lastDown.wasSel){
    selDel(lastDown.alvo);
    aplicaSel('');            /* saiu da selecao: a net dele sai junto */
  }
}
/* Duplo clique: com o fio na mao encerra o traçado (o Altium faz igual). Sem ferramenta, ele e
   o gesto que PROMOVE — o trecho marcado vira o fio inteiro, e o texto do designador leva o
   foco para o campo da ficha, que e onde se troca a palavra. Sem isso, o clique simples ter
   virado "trecho" teria tirado o gesto de pegar o fio todo, que ainda e o certo para mover o
   fio de lugar. */
cv.addEventListener('dblclick', e => {
  if (wireDraw){ endWire(); return; }
  if (tool !== 'select') return;
  const w = worldOf(e);
  const h = hitTest(w.x, w.y);
  if (!h) return;
  if (h.kind === 'wire'){ selSo([alvoAll(h.item)]); aplicaSel(netDoAlvo(h)); return; }
  if (h.kind === 'ref' || h.kind === 'com'){
    /* o campo do designador vive na aba Geral: se a ficha estiver na aba Pinos, focar um
       campo escondido nao daria erro nenhum — so nao aconteceria nada, que e pior */
    prAba = 'geral';
    try { localStorage.setItem(PR_ABA_KEY, prAba); } catch (e) {}
    selSo([alvoAll(h.item)]); aplicaSel('');
    propsPin = true; salvaPin(); mostraProps();
    const campo = $('prBody') && $('prBody').querySelector('input.mono');
    if (campo){ campo.focus(); campo.select(); }
  }
});

/* ------- adicionar componentes (modal) -------
   E a aba Biblioteca do hub com uma troca: a ficha da direita virou a LISTA do que vai
   para o esquema. Escolher um a um e ja posicionar cada um quebra o raciocinio de quem
   esta montando o circuito; aqui a escolha (simbolo + valor + footprint + quantidade)
   vai se juntando, e Finalizar joga tudo na folha de uma vez, em grade, para depois ser
   arrastado e ligado. A lista mora na memoria da vista; o que persiste e o schematic.js. */
let pick = null;                    /* { sym, valorId, part, fpShown } — o que esta em foco no modal */
let cart = [];
const addState = { baixo:'val' };   /* painel de baixo no almoxarifado: 'val' | 'fp' */
let addDrawSym = null, addDrawFp = null;
const camSym = D.mkCamera($('addSymCv'), ctx => { if (addDrawSym) D.drawSymbolPart(ctx, addDrawSym, { honraOlho: false }); }, { bg:D.SCH.sheet });
const camFp  = D.mkCamera($('addFpCv'),  ctx => { if (addDrawFp)  D.drawFootprint(ctx, addDrawFp, {}); },  { bg:'#0b0b0d' });

function refPrefixOf(name){
  /* o simbolo do almoxarifado carrega o designador ("R", "C", "DS"...); so o do Altium
     precisa do palpite pela primeira letra do nome */
  const sy = SLIB.symbols.find(x => x.name === name);
  if (sy && sy.designator) return String(sy.designator).toUpperCase();
  const m = String(name || '').match(/^[A-Za-z]+/);
  return m ? m[0].toUpperCase() : 'U';
}
function allComps(){ const out = []; for (const s of model.sheets) for (const c of s.comps) out.push(c); return out; }
function nextRef(symName){
  const comps = allComps();
  const same = comps.filter(c => c.sym === symName);
  let prefix = same.length ? refPrefixOf(same[0].ref) : refPrefixOf(symName);
  let mx = 0;
  for (const c of comps){
    const m = String(c.ref).match(/^([A-Za-z]+)(\d+)$/);
    if (m && m[1].toUpperCase() === prefix && +m[2] > mx) mx = +m[2];
  }
  return prefix + (mx + 1);
}
function acervoAtual(){
  const id = $('addSrc').value;
  return ACERVOS.find(a => a.id === id) || ACERVOS[0];
}
const qtdFmt = n => (Math.round((n || 0) * 100) / 100).toLocaleString('pt-BR');
/* No acervo do almoxarifado o simbolo tem UMA parte e uma lista de VALORES; cada valor
   e um conjunto de parametros (Comment, Value, MPN, Mouser, Estoque, Local). O que se
   escolhe no modal e o valor, nao a parte. */
const valoresDe = sy => (sy && sy.valores) || [];
const estoqueDe = sy => valoresDe(sy).reduce((a, p) => a + (p.estoque || 0), 0);
/* os parametros viram um campo plano "K=V;K=V" no schematic.js: o parser do
   BuildSchematic le linha a linha e nao aguenta objeto aninhado */
const limpaPar = t => String(t == null ? '' : t).replace(/[;=|]/g, ',').trim();
function paramsDoValor(v){
  if (!v) return '';
  const pares = [];
  for (const q of (v.params || [])) if (q.v) pares.push(limpaPar(q.n) + '=' + limpaPar(q.v));
  pares.push('ValorId=' + v.id);
  return pares.join(';');
}
function buildAddSrc(){
  const s = $('addSrc');
  if (s.options.length) return;
  for (const a of ACERVOS){ const o = document.createElement('option'); o.value = a.id; o.textContent = a.titulo; s.appendChild(o); }
}
/* no acervo do almoxarifado a busca tambem entra nos VALORES: e assim que se acha "10k"
   ou um codigo Mouser sem saber em que familia ele mora */
function addFiltered(){
  const q = $('addSearch').value.trim().toLowerCase(), ac = acervoAtual();
  if (!q) return ac.syms.slice();           /* ac.syms = familias, sem os alias por valor */
  return ac.syms.filter(s => (s.name + ' ' + (s.description || '') + ' '
    + (ac.almox ? valoresDe(s).slice(0, 400).map(p => p.label + ' ' + (p.mpn || '') + ' ' + (p.mouser || '')).join(' ') : '')
  ).toLowerCase().includes(q));
}
function setPick(s){
  const v0 = valoresDe(s)[0] || null;
  pick = { sym:s, valorId: v0 ? v0.id : 0, part:1, fpShown:null };
  $('addValSearch').value = '';
  $('addComment').value = v0 ? v0.label : '';
  $('addQtd').value = 1;
}
function buildAddList(){
  const ac = acervoAtual(), q = $('addSearch').value.trim();
  const lista = addFiltered();
  /* a busca serve para CHEGAR num componente: se o escolhido saiu dos resultados, a lista e
     o preview seguem o primeiro (mesma regra da aba Biblioteca) */
  if (pick && lista.length && !lista.includes(pick.sym)) setPick(lista[0]);

  const sum = $('addSum'); sum.textContent = '';
  const stat = (n, label, tone) => {
    const s = el('span'); const b = el('b', null, String(n));
    if (tone) b.style.color = 'var(--' + tone + ')';
    s.append(b, document.createTextNode(' ' + label)); sum.append(s);
  };
  if (ac.almox){
    const soma = lista.reduce((a, sy) => {
      const vs = valoresDe(sy);
      a.vals += vs.length; a.pecas += estoqueDe(sy);
      a.zerados += vs.filter(v => !((v.estoque || 0) > 0)).length;
      return a;
    }, { vals:0, pecas:0, zerados:0 });
    stat(lista.length, 'componentes'); stat(soma.vals, 'valores');
    stat(qtdFmt(soma.pecas), 'peças em estoque', soma.pecas > 0 ? 'ok' : 'warn');
    stat(soma.zerados, 'valores zerados', soma.zerados ? 'warn' : null);
  } else {
    const semFp = lista.filter(s => !(s.footprints || []).some(f => f.incurrentlib)).length;
    stat(lista.length, 'componentes'); stat((PLIB.footprints || []).length, 'footprints');
    stat(semFp, 'sem footprint', semFp ? 'warn' : null);
  }
  if (lista.length !== ac.syms.length) sum.append(el('span', null, 'de ' + ac.syms.length + ' no acervo'));

  const list = $('addList'); list.textContent = '';
  const frag = document.createDocumentFragment();
  const MAX = 400, vis = lista.slice(0, MAX);
  const row = (s, extra) => {
    const b = el('button', 'lib-row'); b.type = 'button';
    b.setAttribute('aria-selected', String(!!pick && pick.sym === s));
    b.title = s.description || s.name;
    b.append(el('span', 'nm', s.name));
    extra(b);
    b.addEventListener('click', () => { setPick(s); buildAddList(); renderAddPreview(); });
    frag.append(b);
  };
  if (ac.almox){
    /* agrupada por familia — e assim que se procura um componente */
    let fam = null;
    for (const s of vis){
      if (s.familia !== fam){
        fam = s.familia;
        const n = lista.filter(x => x.familia === fam).length;
        frag.append(el('div', 'lib-head', (fam || 'sem família') + (n > 1 ? ' (' + n + ')' : '')));
      }
      row(s, b => {
        const nv = valoresDe(s).length;
        if (nv > 1) b.append(el('span', 'pill', nv + ' val'));
        if (!(s.footprints || []).length) b.append(el('span', 'pill warn', 'sem encap'));
        const est = estoqueDe(s), q2 = el('span', 'mt', qtdFmt(est));
        q2.style.color = est > 0 ? 'var(--ok)' : 'var(--text-4)';
        b.append(q2);
      });
    }
  } else {
    frag.append(el('div', 'lib-head', 'componentes (' + lista.length + (q ? ' de ' + ac.syms.length : '') + ')'));
    for (const s of vis) row(s, b => {
      const part = HubCore.partOf(s, 1);
      if (!(s.footprints || []).some(f => f.incurrentlib)) b.append(el('span', 'pill warn', 'sem fp'));
      b.append(el('span', 'mt', ((part && part.pins && part.pins.length) || 0) + 'p'));
    });
  }
  if (lista.length > MAX) frag.append(el('div', 'lib-head', 'mostrando ' + MAX + ' de ' + lista.length + ' — refine a busca'));
  if (!lista.length) frag.append(el('div', 'lib-head', q ? 'nada com "' + q + '"' : 'nada aqui'));
  list.append(frag);
}
/* as previews sao canvases dentro de um modal que abre e fecha: o fit so vale com o canvas
   medido, entao a caixa fica guardada e o ajuste acontece no proximo frame, com tamanho */
function fitPreview(c, bb){ c.__bb = bb || null; }
function ajustaPreviews(cams){
  for (const c of cams){
    const cvs = c.ctx.canvas;
    if (!cvs.clientWidth || !cvs.clientHeight) continue;
    c.resize();
    if (c.__bb) c.fit(c.__bb, 1.35); else c.draw();
  }
}
function refitPreviews(){ ajustaPreviews([camSym, camFp]); }
function renderAddPreview(){
  const ac = acervoAtual(), almox = !!ac.almox;
  const s = pick && pick.sym;
  /* Dois corpos disputam a metade de baixo: o footprint e a lista de valores. A lista so
     existe no acervo do almoxarifado, e e o padrao la — e ela que responde "tem esse valor?". */
  const modo = almox ? addState.baixo : 'fp';
  $('addFpVp').hidden = modo !== 'fp'; $('addValBox').hidden = modo !== 'val';
  $('addBotTtl').textContent = modo === 'val' ? 'valores' : 'footprint';
  const seg = $('addBotSeg'); seg.textContent = ''; seg.hidden = !almox;
  if (almox) for (const [k, rot] of [['val', 'valores'], ['fp', 'footprint']]){
    const b = el('button', null, rot); b.type = 'button';
    b.setAttribute('aria-pressed', String(k === modo));
    b.title = k === 'fp' ? 'o footprint do valor escolhido' : 'os valores deste componente no almoxarifado';
    b.addEventListener('click', () => { addState.baixo = k; renderAddPreview(); });
    seg.append(b);
  }
  for (const id of ['addFp', 'addPart', 'addQtd', 'addComment', 'addOk']) $(id).disabled = !s;
  if (!s){
    addDrawSym = null; addDrawFp = null; fitPreview(camSym, null); fitPreview(camFp, null);
    $('addSymMeta').textContent = '—'; $('addBotMeta').textContent = '—';
    $('addSymHint').textContent = 'escolha um item na lista'; $('addFpHint').textContent = '';
    $('addValList').textContent = ''; $('addValCount').textContent = '';
    $('addFp').textContent = ''; $('addPartLab').hidden = true;
    requestAnimationFrame(refitPreviews);
    return;
  }
  const vals = valoresDe(s);
  const v = vals.find(x => x.id === pick.valorId) || vals[0] || null;
  const nparts = s.partcount || (s.parts || []).length || 1;
  /* o simbolo do almoxarifado tem UMA geometria; o valor escolhido e so um conjunto de parametros */
  const part = vals.length ? (s.parts || [])[0] : HubCore.partOf(s, pick.part || 1);
  addDrawSym = part || null;
  fitPreview(camSym, part ? D.symBBox(part) : null);
  $('addSymHint').textContent = part && (part.graphics || []).length ? '' : 'sem desenho na biblioteca';
  $('addSymMeta').textContent = s.name + ' · ' + ((part && part.pins) || []).length + ' pinos'
    + (v ? ' · valor ' + (vals.indexOf(v) + 1) + '/' + vals.length : nparts > 1 ? ' · parte ' + pick.part + '/' + nparts : '');

  /* parte: so no simbolo multi-part da schlib do Altium */
  const pl = $('addPartLab'); pl.hidden = !!vals.length || nparts <= 1;
  if (!pl.hidden){
    const ps = $('addPart'); ps.textContent = '';
    for (let i = 1; i <= nparts; i++){ const o = document.createElement('option'); o.value = i; o.textContent = i + '/' + nparts; if (i === pick.part) o.selected = true; ps.append(o); }
  }

  /* footprint: o do VALOR primeiro (um resistor 0805 e um 2512 dividem o mesmo simbolo e nao
     tem nada a ver na placa), depois os modelos do simbolo, depois a PcbLib inteira */
  const fpSel = $('addFp'); fpSel.textContent = '';
  const models = (v && v.footprint)
    ? [{ name:v.footprint, current:true }].concat((s.footprints || []).filter(m => m.name !== v.footprint))
    : (s.footprints || []);
  const want = pick.fpShown || ((models.find(m => m.current) || models[0] || {}).name) || '';
  const seen = new Set();
  const addOpt = (name, mark) => {
    if (!name || seen.has(name)) return; seen.add(name);
    const o = document.createElement('option'); o.value = name; o.textContent = name + (mark || '');
    if (name === want) o.selected = true;
    fpSel.append(o);
  };
  for (const m of models) addOpt(m.name, m.current ? ' ✓' : '');
  for (const f of (PLIB.footprints || [])) addOpt(f.name, '');
  if (!seen.size){ const o = document.createElement('option'); o.value = ''; o.textContent = '— nenhum —'; fpSel.append(o); }

  const fpName = fpSel.value;
  const fp = fpName ? HubCore.footprintOf(PLIB, fpName) : null;
  addDrawFp = fp || null;
  fitPreview(camFp, fp && fp.bbox ? fp.bbox : null);
  $('addFpHint').textContent = fp ? '' : (fpName ? 'footprint "' + fpName + '" não está na PcbLib espelhada' : 'sem footprint');
  $('addBotMeta').textContent = modo === 'val' ? s.name : (fpName || '—');

  /* lista de valores (almoxarifado) */
  if (almox){
    const vq = $('addValSearch').value.trim().toLowerCase();
    const vis = vals.filter(p => !vq ||
      (p.label + ' ' + (p.mpn || '') + ' ' + (p.mouser || '') + ' ' + (p.pkgs || []).join(' ')).toLowerCase().includes(vq));
    $('addValCount').textContent = vis.length === vals.length ? vals.length + ' valores' : vis.length + ' de ' + vals.length;
    const vl = $('addValList'); vl.textContent = '';
    const frag = document.createDocumentFragment();
    for (const p of vis){
      const b = el('button', 'alx-row'); b.type = 'button';
      b.setAttribute('aria-selected', String(!!v && p.id === v.id));
      b.title = (p.itens && p.itens[0] && p.itens[0].nome) || p.label;
      const lb = el('span', 'lb', p.label);
      if (p.fora){ lb.append(el('i', null, 'fora')); b.title = 'não está mais no Odoo — a part continua na lib para não renumerar as outras'; }
      /* o numero e o id do valor: e a chave dele no .DbLib e no schematic.js */
      const ix = el('span', 'ix', String(p.id)); ix.title = 'id ' + p.id + ' no catálogo';
      b.append(ix, lb, el('span', 'pk', (p.pkgs || []).join(' · ')));
      b.append(el('span', 'qt' + (p.estoque > 0 ? '' : ' zero'), qtdFmt(p.estoque)));
      /* o encapsulamento fixado era do valor ANTERIOR: mantê-lo poria um 0805 na ficha de um 2512 */
      b.addEventListener('click', () => { pick.valorId = p.id; pick.fpShown = null; $('addComment').value = p.label; renderAddPreview(); });
      frag.append(b);
    }
    if (!vis.length) frag.append(el('div', 'alx-empty', 'nenhum valor com "' + $('addValSearch').value + '"'));
    vl.append(frag);
  }
  requestAnimationFrame(refitPreviews);
}
function openAdd(){
  buildAddSrc();
  $('addmodal').classList.add('on');
  buildAddList(); renderAddPreview(); cartRender();
  $('addSearch').focus();
}
function closeAdd(){ $('addmodal').classList.remove('on'); }
const addOpen = () => $('addmodal').classList.contains('on');

/* ------- a lista (o que vai para o esquema) ------- */
const cartCount = () => cart.reduce((a, c) => a + c.qtd, 0);
function cartAdd(){
  if (!pick) return;
  const s = pick.sym, vals = valoresDe(s), v = vals.find(x => x.id === pick.valorId) || vals[0] || null;
  const qtd = Math.max(1, Math.min(99, Math.round(+$('addQtd').value) || 1));
  const part = v ? 1 : (pick.part || 1);
  const item = {
    /* o nome do componente no Altium: cada valor e um componente proprio na lib da
       familia ("SMD 0805 10K 1/8W"). O espelho do hub continua por familia. */
    sym: (v && v.altium) || s.name,
    part,
    footprint: $('addFp').value,
    comment: ($('addComment').value.trim() || (v && v.label) || '').replace(/"/g, "'"),
    params: paramsDoValor(v),
    rotulo: (v && v.label) || (s.name + (part > 1 ? ' · parte ' + part : '')),
    estoque: v && typeof v.estoque === 'number' ? v.estoque : null,
    qtd,
  };
  const igual = cart.find(c => c.sym === item.sym && c.part === item.part && c.footprint === item.footprint && c.comment === item.comment);
  if (igual) igual.qtd += qtd; else cart.push(item);
  cartRender();
}
function cartRender(){
  const n = cartCount();
  $('addBtnN').textContent = n ? '(' + n + ')' : '';
  $('cartInfo').textContent = n ? n + ' peça(s) · ' + cart.length + ' tipo(s)' : 'vazia';
  $('cartDone').disabled = !cart.length; $('cartClear').disabled = !cart.length;
  const box = $('cartList'); box.textContent = '';
  if (!cart.length){
    box.append(el('div', 'cart-empty', 'Escolha um componente à esquerda, confira o valor e o footprint no meio '
      + 'e clique em Adicionar. Quando a lista estiver pronta, Finalizar coloca tudo na folha ativa, em grade, '
      + 'para arrastar e ligar depois.'));
    return;
  }
  const mk = (txt, title, fn) => { const b = el('button', 'btn btn-secondary', txt); b.type = 'button'; b.title = title; b.addEventListener('click', fn); return b; };
  cart.forEach((c, i) => {
    const row = el('div', 'cart-row');
    const t = el('div', 't'); t.title = c.rotulo;
    if (c.qtd > 1) t.append(el('b', null, c.qtd + '× '));
    t.append(document.createTextNode(c.rotulo));
    row.append(t,
      mk('−', 'uma a menos', () => { if (--cart[i].qtd <= 0) cart.splice(i, 1); cartRender(); }),
      mk('+', 'uma a mais', () => { cart[i].qtd++; cartRender(); }),
      mk('✕', 'tirar da lista', () => { cart.splice(i, 1); cartRender(); }));
    const s = el('div', 's', c.sym + ' · ' + (c.footprint || 'sem footprint'));
    if (c.estoque !== null && c.estoque < c.qtd) s.append(el('span', 'w', '  ⚠ saldo ' + qtdFmt(c.estoque)));
    row.append(s);
    box.append(row);
  });
}
/* joga a lista inteira na folha, em grade, a partir de um canto livre, e deixa tudo
   selecionado: o proximo gesto natural e arrastar para o lugar */
function finalizar(){
  if (!cart.length) return;
  const folha = model.sheets[sheetIdx];
  const usados = folha.comps || [];
  /* comeca abaixo do que ja existe, para nao cair em cima do circuito */
  let y0 = 6200, x0 = 800;
  if (usados.length){
    const minY = Math.min.apply(null, usados.map(c => c.y));
    y0 = snapG(minY - 900);
  }
  const PASSO_X = 700, PASSO_Y = 800, LARGURA = 9;
  let i = 0; const novos = [];
  for (const item of cart){
    for (let k = 0; k < item.qtd; k++){
      const c = {
        t: 'comp', sheet: folha.name, ref: nextRef(item.sym), sym: item.sym,
        x: snapG(x0 + (i % LARGURA) * PASSO_X),
        y: snapG(y0 - Math.floor(i / LARGURA) * PASSO_Y),
        rot: 0, footprint: item.footprint,
      };
      if (item.part !== 1) c.part = item.part;
      if (item.comment) c.comment = item.comment;
      if (item.params) c.params = item.params;
      schematic.items.push(c); novos.push(c);
      /* o model precisa enxergar o que acabou de entrar, senao o nextRef repete o ref */
      model = HubCore.buildSchModel(schematic);
      i++;
    }
  }
  cart = []; cartRender(); closeAdd();
  selSo(novos.map(alvoAll));
  selNet = '';        /* componentes novos nao pertencem a net nenhuma ainda */
  commit();
  const bb = unionBBox(novos);
  if (bb) cam.fit({ x1:bb.x1 - 600, y1:bb.y1 - 600, x2:bb.x2 + 600, y2:bb.y2 + 600 });
  HubDialog.toast(novos.length + ' componente(s) na folha "' + folha.name + '" — arraste para o lugar e salve', 'ok');
}

$('addSearch').addEventListener('input', () => { buildAddList(); renderAddPreview(); });
$('addSrc').addEventListener('change', () => { pick = null; buildAddList(); renderAddPreview(); });
$('addValSearch').addEventListener('input', renderAddPreview);
$('addFp').addEventListener('change', () => { if (pick){ pick.fpShown = $('addFp').value; renderAddPreview(); } });
$('addPart').addEventListener('change', () => { if (pick){ pick.part = +$('addPart').value || 1; renderAddPreview(); } });
$('addOk').addEventListener('click', cartAdd);
$('addClose').addEventListener('click', closeAdd);
$('addmodal').addEventListener('click', e => { if (e.target === $('addmodal')) closeAdd(); });
$('cartClear').addEventListener('click', async () => {
  if (cart.length && !(await HubDialog.confirm('Esvaziar a lista de componentes? O que já estava nela se perde.',
      { title:'Limpar lista', ok:'Esvaziar', danger:true }))) return;
  cart = []; cartRender();
});
$('cartDone').addEventListener('click', finalizar);
$('btnAdd').addEventListener('click', openAdd);

/* ------- painel de propriedades (direita, so leitura) -------
   A ficha do que esta selecionado, no espirito do painel Properties do Altium: o que o
   componente E, de onde ele veio, onde ele esta e em que pinos as nets caem — com o simbolo
   e o footprint desenhados no rodape. Nada aqui e editavel de proposito: esta vista serve
   para OLHAR e para posicionar; valor, footprint e parametro sao da IA, no schematic.js. */
let prSym = null, prFp = null;
const camPrSym = D.mkCamera($('prSymCv'), ctx => { if (prSym) D.drawSymbolPart(ctx, prSym, { honraOlho: false }); }, { bg:D.SCH.sheet });
const camPrFp  = D.mkCamera($('prFpCv'),  ctx => { if (prFp)  D.drawFootprint(ctx, prFp, {}); },  { bg:'#0b0b0d' });
function refitProps(){ ajustaPreviews([camPrSym, camPrFp]); }

/* ------- quando a ficha aparece -------
   Ela nao fica ocupando a tela o tempo todo: entra com a selecao e sai com ela. O alfinete
   no canto da ficha prende ela aberta; fechada, ela vira o botao de paineis no canto
   inferior esquerdo da folha. O alfinete fica lembrado nesta maquina. */
let propsPin = false, painelProps = null;
try { propsPin = localStorage.getItem('schframe.propsPin') === '1'; } catch (e) {}
function salvaPin(){ try { localStorage.setItem('schframe.propsPin', propsPin ? '1' : '0'); } catch (e) {} }
function mostraProps(){
  const ver = propsPin || sel.size > 0;
  /* a ficha fechada pela divisoria tem largura zero: reabrir sem devolver largura mostraria
     uma fatia de nada */
  if (ver && painelProps) painelProps.abre();
  $('props').hidden = !ver;
  $('splitR').hidden = !ver;
  $('btnPaineis').hidden = ver;
  $('btnPin').setAttribute('aria-pressed', String(propsPin));
  /* o canvas mudou de largura; os previews so enquadram depois de medidos */
  if (ver) requestAnimationFrame(refitProps);
}
$('btnPin').addEventListener('click', () => { propsPin = !propsPin; salvaPin(); mostraProps(); });
/* o botao de paineis so existe com a ficha fechada, entao ele SEMPRE prende: abrir para
   fechar sozinho no proximo clique no vazio seria um botao que nao faz nada */
$('btnPaineis').addEventListener('click', () => { propsPin = true; salvaPin(); mostraProps(); });

function prSec(titulo){ const d = el('div', 'pr-sec'); if (titulo) d.append(el('h3', null, titulo)); return d; }
function prKv(box, k, v, cls){
  const g = box.__kv || (box.__kv = (() => { const x = el('div', 'pr-kv'); box.append(x); return x; })());
  g.append(el('span', 'k', k), el('span', 'v' + (cls ? ' ' + cls : ''), v == null || v === '' ? '—' : String(v)));
}
/* mesma grade do prKv, mas com um elemento no lugar do texto — para o campo ser editavel
   sem quebrar o alinhamento da coluna de rotulos */
function prKvEl(box, k, node){
  const g = box.__kv || (box.__kv = (() => { const x = el('div', 'pr-kv'); box.append(x); return x; })());
  const v = el('span', 'v'); v.append(node);
  g.append(el('span', 'k', k), v);
}
/* ── CAMPO DISCRETO ──
   A ficha passou a EDITAR posicao, rotacao e designador, e um <input> com borda em cada linha
   transformava o painel numa planilha. Aqui a caixa fica lisa e cinza, como se estivesse
   desligada, e so se revela ao passar o mouse ou ao receber o foco — o pedido foi literalmente
   "uma caixa mais discreta, que fique em cinza claro como se tivesse desativada, so ativa
   quando clica em cima". Quem edita continua sabendo que da para editar (o cursor de texto e o
   realce no hover dizem), e quem so esta lendo nao ve uma grade de caixas. */
function prCampo(valor, titulo, aplica, opts){
  const o = opts || {};
  const i = el('input', 'pr-inp' + (o.cls ? ' ' + o.cls : ''));
  i.type = 'text';
  i.value = valor == null ? '' : String(valor);
  if (titulo) i.title = titulo;
  i.addEventListener('change', () => aplica(i));
  i.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); i.blur(); }
    if (e.key === 'Escape'){ e.preventDefault(); i.value = valor == null ? '' : String(valor); i.blur(); }
  });
  return i;
}
/* dois campos na mesma linha (o X e o Y), com o rotulo de cada um em cima do seu */
function prPar(box, a, b){
  const linha = el('div', 'pr-par');
  for (const [rot, node] of [a, b]){
    const c = el('div', 'pr-par-c');
    /* o rotulo pode ser um NO (o do designador leva o olho junto) ou so o texto; passar um
       no para o el() o transformaria em "[object HTMLDivElement]" no textContent */
    c.append(rot && rot.nodeType ? rot : el('span', 'k', rot), node);
    linha.append(c);
  }
  box.append(linha);
  box.__kv = null;                 /* a proxima linha de prKv abre uma grade nova, abaixo */
}
/* o olho da barra Vista, do lado do campo que ele apaga: quem quer sumir com o designador
   procura pelo designador, nao pela secao de configuracao do outro painel */
function prOlho(box, ligado, titulo, aoClicar){
  const b = el('button', 'pr-olho');
  b.type = 'button';
  b.title = titulo;
  b.setAttribute('aria-pressed', String(!!ligado));
  b.innerHTML = '<svg viewBox="0 0 16 16"><path d="M1.5 8 C3.5 4.6 5.8 3 8 3 C10.2 3 12.5 4.6 14.5 8 '
              + 'C12.5 11.4 10.2 13 8 13 C5.8 13 3.5 11.4 1.5 8 Z"/><circle cx="8" cy="8" r="2.2"/>'
              + (ligado ? '' : '<path d="M2.5 13.5 L13.5 2.5"/>') + '</svg>';
  b.onclick = aoClicar;
  box.append(b);
  return b;
}
const corValida = c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
/* Cor de um campo do item, no molde do editor de simbolos (hub-symed): o seletor mostra a
   cor em uso, o × devolve o padrao APAGANDO o campo — cor ausente e o estado normal, e
   gravar "#ffff00" em toda port so para dizer "o padrao" sujaria o schematic.js. */
function prCor(box, rotulo, it, chave, padrao){
  const wrap = el('span', 'pr-cor');
  const tem = corValida(it[chave]);
  const c = el('input'); c.type = 'color'; c.value = tem ? it[chave] : padrao;
  if (!tem) c.classList.add('padrao');
  c.title = rotulo + (tem ? ': ' + it[chave] : ' — padrão (clique para escolher)');
  c.onchange = () => { it[chave] = String(c.value).toLowerCase(); commit(); };
  const x = el('button', 'pr-cor-x', '×'); x.type = 'button'; x.title = 'voltar à cor padrão';
  x.disabled = !tem;
  x.onclick = () => { delete it[chave]; commit(); };
  wrap.append(c, x);
  prKvEl(box, rotulo, wrap);
}
/* os parametros viajam num campo plano "K=V;K=V" (o parser do BuildSchematic le linha a linha) */
function prParams(s){
  const out = [];
  for (const par of String(s || '').split(';')){
    const i = par.indexOf('=');
    if (i > 0 && par.slice(0, i).trim()) out.push([par.slice(0, i).trim(), par.slice(i + 1).trim()]);
  }
  return out;
}
/* O NOME DO FOOTPRINT MORA EMBAIXO DA PRÉVIA DELE, e não numa linha da seção geral: ali ele
   é legenda do que se está vendo. Enquanto era linha de texto lá em cima, era mais um item na
   lista de procedencia que o usuário pediu para sumir. */
function prPreview(sym, part, fpNome){
  prSym = part || null;
  fitPreview(camPrSym, part ? D.symBBox(part) : null);
  $('prSymHint').textContent = part ? '' : (sym === false ? '' : 'sem geometria na biblioteca');
  const fp = fpNome ? HubCore.footprintOf(PLIB, fpNome) : null;
  prFp = fp || null;
  fitPreview(camPrFp, fp && fp.bbox ? fp.bbox : null);
  const hf = $('prFpHint');
  hf.className = 'pvh' + (fp ? ' mono' : '');
  hf.textContent = fp ? fpNome
    : fpNome ? '"' + fpNome + '" não está na PcbLib espelhada' : (sym === false ? '' : 'sem footprint');
  requestAnimationFrame(refitProps);
}
function renderProps(){
  const body = $('prBody');
  body.textContent = '';
  /* A FOLHA NO CABEÇALHO. Ela era a última linha da seção "posição" e repetia, item a item,
     o que vale para a ficha inteira — no topo ela diz de uma vez de onde é o que se está
     olhando, e devolve uma linha para cada seção. */
  const cabFolha = $('prFolha');
  if (cabFolha){
    const um = selAlvos().filter(a => onSheet(a.it));
    cabFolha.textContent = um.length ? (um[0].it.sheet || '') : '';
  }
  const alvos = selAlvos().filter(a => onSheet(a.it));
  const itens = alvos.map(a => a.it);
  if (!itens.length){
    const s = prSec(null);
    s.append(el('p', 'pr-empty', 'Clique num componente, fio ou pouso de alimentação para ver a ficha dele. '
      + 'Aqui se olha e se posiciona; a única propriedade editável é a cor da port. Valor, footprint '
      + 'e parâmetro são editados pela IA, no schematic.js.'));
    body.append(s);
    return prPreview(false, null, null);
  }
  if (itens.length > 1){
    const s = prSec('seleção');
    s.append(el('div', 'pr-title', itens.length + ' itens'));
    const cont = {};
    for (const it of itens) cont[it.t] = (cont[it.t] || 0) + 1;
    const NOME = { comp:'componente', wire:'fio', netlabel:'net label', power:'power port',
                   port:'port', junction:'junção', noerc:'No ERC', text:'texto' };
    for (const [k, n] of Object.entries(cont)) prKv(s, (NOME[k] || k) + (n > 1 ? 's' : ''), n);
    body.append(s);
    return prPreview(false, null, null);
  }

  const it = itens[0], alvo = alvos[0];
  if (it.t !== 'comp'){
    const NOME = { wire:'fio', netlabel:'net label', power:'power port', port:'port',
                   junction:'junção', noerc:'No ERC', text:'texto' };
    const s = prSec(NOME[it.t] || it.t);
    if (it.t === 'wire'){
      const wi = model.sheets[sheetIdx].wires.indexOf(it);
      const pts = it.pts || [];
      s.append(el('div', 'pr-title', (wi >= 0 && nets.wireNet[sheetIdx][wi]) || 'sem net'));
      /* A ficha fala do que esta MARCADO. Com um trecho na mao ela mostrava "Vertices/Inicio/
         Fim" do fio inteiro — informacao verdadeira sobre o objeto errado. */
      if (alvo.k === 'seg' && pts[alvo.i] && pts[alvo.i+1]){
        prKv(s, 'Trecho', (alvo.i + 1) + ' de ' + (pts.length - 1));
        prKv(s, 'De', pts[alvo.i][0] + ' , ' + pts[alvo.i][1] + ' mil', 'mono');
        prKv(s, 'Até', pts[alvo.i+1][0] + ' , ' + pts[alvo.i+1][1] + ' mil', 'mono');
        prKv(s, '', 'Del parte o fio aqui · clique duplo pega o fio inteiro', 'dim');
      } else if (alvo.k === 'vert' && pts[alvo.i]){
        prKv(s, 'Vértice', (alvo.i + 1) + ' de ' + pts.length);
        prKv(s, 'Posição', pts[alvo.i][0] + ' , ' + pts[alvo.i][1] + ' mil', 'mono');
        prKv(s, '', 'Del tira o vértice e endireita o fio', 'dim');
      } else {
        prKv(s, 'Vértices', pts.length);
        const p0 = pts[0] || [0, 0], pn = pts[pts.length - 1] || [0, 0];
        prKv(s, 'Início', p0[0] + ' , ' + p0[1] + ' mil', 'mono');
        prKv(s, 'Fim', pn[0] + ' , ' + pn[1] + ' mil', 'mono');
      }
    } else {
      s.append(el('div', 'pr-title', it.net || it.s || (NOME[it.t] || it.t)));
      /* `!= null` e nao `if (it.style)`: estilo 0 e um estilo, e e o de TODA port dos
         espelhos reais — o teste de verdade escondia o campo justamente onde ele existe */
      if (it.style != null) prKv(s, 'Estilo', it.style);
      if (it.t === 'port' && it.w != null) prKv(s, 'Largura', Math.round(it.w) + ' mil');
      if (it.t === 'text') prKv(s, 'Altura', (it.h || 10) + ' mil');
      prKv(s, 'Posição', it.x + ' , ' + it.y + ' mil', 'mono');
      if (it.rot != null) prKv(s, 'Rotação', (((it.rot % 360) + 360) % 360) + '°');
      /* As unicas propriedades EDITAVEIS da ficha. Cor de port e coisa de desenho, nao de
         eletrica: mudar aqui nao mexe em net nenhuma, e e o mesmo ajuste que se faz no
         Altium. O resto da ficha continua so de leitura. */
      if (it.t === 'port'){
        prCor(s, 'Preenchimento', it, 'fill',      D.SCH.portFill);
        prCor(s, 'Texto',         it, 'textColor', D.SCH.portText);
        prCor(s, 'Borda',         it, 'color',     D.SCH.port);
      }
    }
    prKv(s, 'Folha', it.sheet);
    body.append(s);
    return prPreview(false, null, null);
  }

  /* ── componente ── */
  /* resolveSym e nao symbolOf: o `how` e quem diz POR QUE a folha desenha o que desenha.
     Sem ele a ficha afirmava um simbolo e calava a origem — inclusive quando a origem era
     uma escolha gravada, que e justamente a que pode estar errada. */
  const rsym = HubCore.resolveSym(SLIB, it.sym);
  const sym = (rsym && rsym.item) || null;
  const part = HubCore.partOf(sym, it.part);
  const ac = ACERVO_DE.get(it.sym) || (sym && ACERVO_DE.get(sym.name)) || null;
  const nparts = sym ? (sym.partcount || (sym.parts || []).length || 1) : 1;
  /* QUANTAS PARTES ESTE COMPONENTE TEM, DE VERDADE. Nao basta perguntar ao simbolo: todo
     alias do almoxarifado tem partcount 1, e uma escolha gravada no lib-subs.js pode
     apontar um conector de 4 partes para um alias de uma. Nesses casos a ficha dizia
     '1 de 1' numa peca que a folha usa em 4 partes — e, pior, escondia a parte REAL do
     item, que continuava sendo 3. A folha e a testemunha: se ha um comp com part 3 neste
     ref, o componente tem ao menos 3 partes, o simbolo sabendo disso ou nao. */
  const partesDoRef = sheetItems().filter(x => x.t === 'comp' && x.ref === it.ref);
  const maxNaFolha = partesDoRef.reduce((m, x) => Math.max(m, x.part || 1), 0);
  /* O TOTAL E DO COMPONENTE, NAO DO SIMBOLO. O CONE PADRAO tem 80 partes desenhadas, e um
     conector de 4 vias que o usa nao deve oferecer 80 opcoes — seria convite para pousar
     uma parte na 57 e criar um buraco que o ECO do Altium reclama. Quem sabe quantas
     partes este componente tem e a folha: as que estao nela. O partcount do simbolo entra
     so como AVISO, mais abaixo, quando ele nao alcanca o que a folha usa. */
  const totalPartes = Math.max(maxNaFolha, it.part || 1);
  const fpNome = it.footprint || '';

  /* ── POSICAO PRIMEIRO ──
     A ficha começava por "geral" e a posição ficava no fim, depois de dez linhas de
     procedência do símbolo. Quem abre a ficha de um componente colocado está quase sempre
     ajustando ONDE ele está — então o que se mexe vem primeiro, e o que se lê vem depois. */
  const p = prSec('posição');
  const aplicaXY = (campo, eixo) => {
    const v = parseFloat(String(campo.value).replace(',', '.'));
    if (!isFinite(v)){ campo.value = it[eixo]; return; }
    const n = Math.round(v * 1e4) / 1e4;
    if (n === it[eixo]){ campo.value = n; return; }
    it[eixo] = n;
    commit();
  };
  prPar(p,
    ['X', prCampo(it.x, 'posição X em mil — o mesmo número do Altium', c => aplicaXY(c, 'x'), { cls:'mono' })],
    ['Y', prCampo(it.y, 'posição Y em mil (Y para cima, como no Altium)', c => aplicaXY(c, 'y'), { cls:'mono' })]);

  /* ROTACAO + OS DOIS ESPELHOS na mesma linha. O formato só aceita 0/90/180/270 (o
     validateSchematic recusa o resto), então valor fora disso é RECUSADO em vez de
     arredondado calado: arredondar faria a ficha dizer um número e o arquivo guardar outro. */
  const rotAtual = () => ((((it.rot || 0) % 360) + 360) % 360);
  const linhaRot = el('div', 'pr-par');
  const cRot = el('div', 'pr-par-c');
  cRot.append(el('span', 'k', 'Rotação'), prCampo(rotAtual(),
    'graus, anti-horário: só 0, 90, 180 ou 270', campo => {
      const v = parseInt(String(campo.value).replace(/[^0-9-]/g, ''), 10);
      const n = ((v % 360) + 360) % 360;
      if (!isFinite(v) || [0, 90, 180, 270].indexOf(n) < 0){
        HubDialog.toast('rotação só pode ser 0, 90, 180 ou 270', 'warn');
        campo.value = rotAtual();
        return;
      }
      if (n === rotAtual()) return;
      it.rot = n;
      commit();
    }, { cls:'mono' }));
  const cEsp = el('div', 'pr-par-c');
  cEsp.append(el('span', 'k', 'Espelhar'));
  const caixaEsp = el('div', 'pr-esp');
  const bH = el('button', 'pr-ib'); bH.type = 'button';
  bH.title = 'Espelhar na horizontal (X) — vira esquerda/direita';
  bH.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M9.5 7 5 12l4.5 5z"/>'
               + '<path d="M14.5 7 19 12l-4.5 5z"/></svg>';
  bH.onclick = () => { selSo([alvoAll(it)]); mirrorSel('x'); };
  const bV = el('button', 'pr-ib'); bV.type = 'button';
  bV.title = 'Espelhar na vertical (Y) — vira em cima/embaixo';
  bV.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 12h18"/><path d="M7 9.5 12 5l5 4.5z"/>'
               + '<path d="M7 14.5 12 19l5-4.5z"/></svg>';
  bV.onclick = () => { selSo([alvoAll(it)]); mirrorSel('y'); };
  caixaEsp.append(bH, bV);
  cEsp.append(caixaEsp);
  linhaRot.append(cRot, cEsp);
  p.append(linhaRot);
  body.append(p);

  /* ── AS DUAS SUB-ABAS ──
     "Não ficar tudo junto": com geral, parâmetros e a tabela de pinos empilhados, a ficha
     virava uma coluna longa em que a lista de pinos empurrava o resto para fora da tela. A
     POSIÇÃO fica de fora das abas, sempre à vista — ela é pequena e é o que se mexe. */
  const abas = el('div', 'pr-abas');
  const paneG = el('div', 'pr-pane');
  const paneP = el('div', 'pr-pane');
  const pinsN = (HubCore.compPinsWorld(it, SLIB) || []).length;
  const mostraAba = () => {
    paneG.hidden = prAba !== 'geral';
    paneP.hidden = prAba !== 'pinos';
    for (const b of abas.children) b.setAttribute('aria-selected', String(b.dataset.aba === prAba));
  };
  for (const [id, rot] of [['geral', 'Geral'], ['pinos', 'Pinos (' + pinsN + ')']]){
    const b = el('button', 'pr-aba', rot);
    b.type = 'button';
    b.dataset.aba = id;
    b.setAttribute('role', 'tab');
    b.onclick = () => {
      prAba = id;
      try { localStorage.setItem(PR_ABA_KEY, id); } catch (e) {}
      mostraAba();
    };
    abas.append(b);
  }
  abas.setAttribute('role', 'tablist');
  body.append(abas, paneG, paneP);

  /* ── GERAL ──
     Saiu daqui tudo que era PROCEDENCIA e não propriedade: "Por quê", "Resolvido em" e
     "Prefixo da lib". Eram verdadeiros e ninguém os lia — e empurravam para baixo o que se
     usa. O nome do componente também saiu: ele agora vive dentro do "Trocar componente…",
     que é o único lugar onde ele serve para alguma coisa (e lá dá para copiar). */
  const g = prSec('geral');
  /* o texto do botão de troca (e se ele sai em destaque) é regra pura, provada em
     tests/test-troca-simbolo.js — a ficha só desenha o que ela decide */
  const dec = decideTroca({ sym: sym && sym.name, how: rsym && rsym.how, quantos: contaSym(it.sym) });

  /* DESIGNATOR com o olho do lado. Ele é do COMPONENTE, não da parte: renomear CN4 renomeia
     as 4 partes de uma vez, senão a folha fica com um componente partido ao meio e o ECO do
     Altium acusa. Recusa nome vazio e nome já usado por OUTRO ref. */
  const kRef = el('div', 'pr-lab');
  kRef.append(el('span', null, 'Designator'));
  prOlho(kRef, showState.ref, showState.ref
    ? 'Designadores visíveis na folha — clique para suprimir'
    : 'Designadores suprimidos — clique para mostrar', () => {
      showState.ref = !showState.ref;
      try { localStorage.setItem(VER_REF_KEY, showState.ref ? '1' : '0'); } catch (e) {}
      renderProps(); cam.draw(); pintaMiniaturas();
    });
  const ref = prCampo(it.ref, 'o designador do componente — muda todas as partes dele', campo => {
    const novo = String(campo.value || '').trim().toUpperCase();
    if (!novo || novo === it.ref){ campo.value = it.ref; return; }
    if (sheetItems().some(x => x.t === 'comp' && x.ref === novo)){
      HubDialog.toast('\u201c' + novo + '\u201d já está em uso nesta folha', 'warn');
      campo.value = it.ref; return;
    }
    const antigo = it.ref;
    for (const x of partesDoRef) x.ref = novo;
    commit();
    HubDialog.toast(antigo + ' \u2192 ' + novo
      + (partesDoRef.length > 1 ? ' (' + partesDoRef.length + ' partes)' : ''), 'ok');
  }, { cls:'mono' });
  prPar(g, [kRef, ref], ['Parte', el('span', 'pr-ro mono', (it.part || 1) + ' de ' + totalPartes)]);
  if (nparts < totalPartes)
    prKv(g, '', 'o símbolo resolvido tem só ' + nparts + ' parte(s) — as outras não desenham', 'dim');

  prKv(g, 'Comment', it.comment, it.comment ? null : 'dim');
  prKv(g, 'Descrição', sym && sym.description, sym && sym.description ? null : 'dim');

  /* ACERVO. "Biblioteca do Altium" sai em VERMELHO com o triângulo: o componente ainda não
     tem par no almoxarifado, e é isso que impede a lista do Odoo de casar a linha por id em
     vez de por texto. Não é erro — é trabalho pendente, e a cor diz isso sem abrir modal. */
  const acNome = ac ? ac.titulo : (sym ? '—' : 'ausente na biblioteca');
  const acPendente = !!ac && /biblioteca do altium|espelho do altium/i.test(String(ac.titulo || ''));
  if (acPendente){
    const v = el('span', 'pr-alerta');
    v.append(el('span', 'tri', '\u25B2'), document.createTextNode(' ' + acNome));
    v.title = 'este componente ainda vem da biblioteca do Altium — vincule-o ao almoxarifado '
            + 'pelo "Trocar componente…" para a lista do Odoo casar por id';
    prKvEl(g, 'Acervo', v);
  } else prKv(g, 'Acervo', acNome, ac ? null : 'warn');

  /* o desenho emprestado precisa se ANUNCIAR: o corpo âmbar na folha diz que algo é
     diferente, e é aqui que se lê O QUÊ. */
  if (!sym){
    const emg = desenhoDeEmergencia(it);
    prKv(g, 'Desenho', emg ? 'emprestado de "' + emg.nome + '" (Biblioteca de símbolos, por ' + emg.how + ') — só para ver'
                           : 'nenhum: a folha mostra o quadrado vermelho', 'warn');
  }
  /* O botão existe com símbolo resolvido OU NÃO. Enquanto ele só aparecia com o símbolo
     ausente, uma escolha errada era definitiva pela interface: assim que ela resolvia o
     nome, não havia mais caminho nenhum na tela para trocar. */
  const bTroca = el('button', dec.destaque ? 'wide' : 'wide sutil', dec.rotulo);
  bTroca.type = 'button';
  bTroca.title = dec.title;
  bTroca.onclick = () => abrirEscolhaSimbolo(it);
  g.append(bTroca);
  if (dec.desfazer){
    const bUndo = el('button', 'wide sutil', dec.desfazer);
    bUndo.type = 'button';
    bUndo.title = 'apaga a linha de Libs/lib-subs.js e volta à resolução natural do nome';
    bUndo.onclick = () => desfazerEscolha(it);
    g.append(bUndo);
  }
  paneG.append(g);

  /* O TEXTO, quando e ele que esta marcado. A posicao do designador e um deslocamento em
     relacao ao lugar de origem (embaixo/em cima do corpo): mostrar o deslocamento, e nao a
     coordenada, e o que deixa "voltar ao lugar" ser uma acao obvia. */
  if (alvo.k === 'ref' || alvo.k === 'com'){
    const q = alvo.k === 'com' ? 'comment' : 'designador';
    const t = prSec('texto · ' + q);
    const tx = textoComp(it, alvo.k);
    prKv(t, 'Deslocamento', tx.posto ? ((it[alvo.k === 'com' ? 'comdx' : 'refdx'] || 0) + ' , '
                                     + (it[alvo.k === 'com' ? 'comdy' : 'refdy'] || 0) + ' mil (da âncora)')
                                     : 'no lugar de origem', 'mono');
    if (tx.posto){
      const b = el('button', 'wide sutil', 'Voltar ao lugar de origem');
      b.title = 'apaga o deslocamento — o mesmo que o Delete faz com o texto marcado';
      b.onclick = () => {
        if (alvo.k === 'com'){ delete it.comdx; delete it.comdy; } else { delete it.refdx; delete it.refdy; }
        commit();
      };
      t.append(b);
    } else prKv(t, '', 'arraste o texto na folha para afastá-lo do símbolo', 'dim');
    paneG.append(t);
  }

  const pars = prParams(it.params);
  if (pars.length){
    const s = prSec('parâmetros');
    for (const [k, v] of pars) prKv(s, k, v);
    paneG.append(s);
  }

  const pins = HubCore.compPinsWorld(it, SLIB) || [];
  const s = prSec(null);
  /* O OLHO DIZ O QUE ELE APAGA. Ele estava colado no título "pinos (2)", e ali dava para ler
     que apagaria a TABELA; o que ele apaga é o nome do pino na FOLHA. Com a aba assumindo o
     título, sobrou lugar para a frase inteira. */
  const linhaOlho = el('div', 'pr-lab pr-olholinha');
  linhaOlho.append(el('span', null, 'nomes de pino na folha'));
  prOlho(linhaOlho, showState.pinos, showState.pinos
    ? 'Nomes e números de pino visíveis na folha — clique para obedecer o símbolo'
    : 'Pino escondido pelo símbolo fica escondido — clique para mostrar tudo', () => {
      showState.pinos = !showState.pinos;
      try { localStorage.setItem(VER_PINOS_KEY, showState.pinos ? '1' : '0'); } catch (e) {}
      pintaOlhoPinos(); renderProps(); cam.draw(); pintaMiniaturas();
    });
  s.append(linhaOlho);
  if (!pins.length) s.append(el('p', 'pr-empty', sym ? 'a parte não tem pinos' : 'componente ausente na biblioteca — sem pinagem para mostrar'));
  else {
    const t = el('table', 'pr-tab');
    const th = el('tr');
    for (const c of ['#', 'nome', 'net']) th.append(el('th', null, c));
    t.append(el('thead', null).appendChild(th).parentNode);
    const tb = el('tbody');
    for (const pin of pins){
      const tr = el('tr');
      const rede = nets.pinNet[it.ref + '-' + pin.num] || '';
      /* node() em vez de innerHTML: o <span> da barra vem montado, sem string para escapar */
      const tdNome = el('td');
      const ovb = OVB();
      if (pin.name && ovb) tdNome.append(ovb.node(pin.name));
      else tdNome.textContent = pin.name || '—';
      tr.append(el('td', 'n', pin.num), tdNome);
      const td = el('td', 'net' + (rede ? '' : ' sem'), rede || 'sem net');
      td.title = rede || 'sem net';
      tr.append(td);
      tb.append(tr);
    }
    t.append(tb);
    s.append(t);
  }
  paneP.append(s);
  mostraAba();          /* so agora os dois paineis existem: acende a aba escolhida */

  prPreview(sym, part, fpNome);
}

/* ------- salvar ------- */
const SCH_REL = 'Projects/' + SCH_P + '/schematic.js';
(async () => { if (HubIO.canPost) try { schDiskSnapshot = await HubIO.fetchText(SCH_REL); } catch (e) {} })();

/* as perguntas de seguranca dos dois escritores viram modal; o resultado, notificacao */
const SOBRESCREVER = { title:'Salvar', ok:'Sobrescrever', danger:true };
async function falhaSalvar(err, nome, texto){
  if (await HubDialog.confirm('Salvar no servidor falhou: ' + err.message + '\nBaixar o arquivo em vez disso?',
      { title:'Falha ao salvar', ok:'Baixar' }))
    HubIO.download(nome, texto);
}
async function saveSchematic(){
  if (staleWorkspace && !(await HubDialog.confirm('O workspace mudou desde o carregamento — salvar vai sobrescrever o schematic.js do disco. Continuar?', SOBRESCREVER))) return null;
  const out = HubCore.serializeSchematic(schematic);
  if (!out.text){ await HubDialog.alert(out.errors.map(e => e.msg).join('\n'), { title:'Esquema inválido' }); return null; }
  /* Texto sem uma letra dentro nao vai para o arquivo (ver serializeSchematic), e isso
     precisa ser DITO. Some da folha ao salvar, e descobrir depois seria pior do que o
     defeito que isto conserta: ate agora ele impedia o projeto INTEIRO de ser salvo. */
  if ((out.descartados || []).length){
    const q = out.descartados.length;
    schematic.items = schematic.items.filter(it => out.descartados.indexOf(it) < 0);
    reapply();
    HubDialog.toast(q + (q === 1 ? ' texto vazio foi descartado' : ' textos vazios foram descartados')
      + ' — eles não desenhavam nada, e o arquivo não aceita texto sem conteúdo', 'warn', 8000);
  }
  if (HubIO.canPost){
    try {
      const cur = await HubIO.fetchText(SCH_REL);
      if ((schDiskSnapshot === null || cur !== schDiskSnapshot) &&
          !(await HubDialog.confirm('schematic.js mudou no disco desde o carregamento (outro escritor — a IA?). Sobrescrever mesmo assim?', SOBRESCREVER))) return null;
    } catch (e) {}
  }
  try {
    const r = await HubIO.saveFile(SCH_REL, out.text);
    setSchDirty(false);
    staleWorkspace = false;
    schDiskSnapshot = out.text;
    return r.mode === 'server' ? { m:'schematic.js salvo', k:'ok' } : { m:'arquivo baixado — substitua ' + SCH_REL, k:'warn' };
  } catch (err) { await falhaSalvar(err, 'schematic.js', out.text); return null; }
}
/* O Salvar grava MESMO sem nada pendente, e e de proposito: ele nunca pode prender o que
   ja foi alterado atras de uma deteccao de sujo que possa ter errado. Era o que a condicao
   `schDirty || !annDirty` fazia quando havia dois arquivos; com um so, a condicao some e o
   comportamento fica explicito. */
async function saveAll(){
  const r = await saveSchematic();
  if (r) HubDialog.toast(r.m, r.k);
}
$('btnSave').addEventListener('click', saveAll);

/* ---------- desenho ---------- */
/* A folha desenhada e a folha MEDIDA no Altium (w/h do espelho); so quando o espelho nao
   traz medida e que se cai na tabela por nome — e ai a folha custom da casa vira a "A4"
   legada de 11500x7600, que e menor que o template, e o carimbo e os fios da borda ficam
   para fora. Espelho antigo continua assim ate ser reexportado: e o unico jeito honesto,
   porque a medida nao esta no arquivo para ser adivinhada. */
function sheetBBox(si){
  const sz = HubCore.sheetSize(model.sheets[si === undefined ? sheetIdx : si]);
  return { x1:0, y1:0, x2:sz[0], y2:sz[1] };
}
/* O que o "encaixar na tela" enquadra: a folha MAIS o que por acaso estiver fora dela.
   Desenhar a folha e enquadrar sao coisas diferentes — a folha desenhada tem que ser a do
   Altium, mas esconder item nenhum. Em espelho antigo (sem medida, caindo na tabela) e
   justamente o carimbo e os fios da borda que ficam para fora; some tudo do enquadramento
   e a impressao e de que o esquema veio pela metade. Com a folha certa, a uniao E a folha. */
function fitBBox(si){
  const b = sheetBBox(si), u = unionBBox(sheetItems(si));
  if (!u) return b;
  return { x1:Math.min(b.x1, u.x1), y1:Math.min(b.y1, u.y1),
           x2:Math.max(b.x2, u.x2), y2:Math.max(b.y2, u.y2) };
}
/* A FOLHA, DESENHADA POR INDICE. Era `drawWorld(ctx, cam)` com `sheetIdx` cravado dentro;
   a miniatura do cartao precisa desenhar uma folha QUALQUER, entao o indice virou
   parametro. As opcoes sao os tres estados que pertencem a folha ATIVA e nao podem vazar
   para o cartao das outras:
     grid   a grade de 100 mil (do olho da secao Vista)
     foco   a net acesa (`selNet`) — com '' o ramo do laranja morre sozinho em toda parte,
            inclusive no netEm(), que tambem le a folha ativa e so e chamado atras de `foco &&`
     esc    a escala, que era `cam.scale`. O que depende de PIXEL (a grade e, antes, a
            bandeirinha do sinalizador) sai dela.
   A selecao e a ferramenta na mao NAO entram aqui: sao do canvas grande, e o drawSelection
   filtra pela folha ativa — numa miniatura de outra folha ele desenharia as bordinhas no
   cartao errado. */
/* ------- a topologia da folha, uma vez por quadro -------
   O censo de ramos e os cruzamentos custam O(ancoras x segmentos) e um passe por balde; na
   folha maior deste workspace sao 555 segmentos. Rodar isso duas vezes no mesmo quadro (o
   canvas grande e a miniatura do cartao) seria desperdicio, e rodar a cada mousemove do
   arrasto engasgaria. A memoria e por folha + versao da geometria: o `geomVer` sobe no
   applyMove (que e o unico que mexe em coordenada durante o gesto) e no reapply. */
const PONTE_R = 28;          /* raio do arco da ponte, em mil — cabe nos 58 cruzamentos reais,
                                onde o vertice mais proximo esta a 39,8 mil no pior caso */
let topoCache = new Map(), geomVer = 0;
function topologiaDe(si){
  const k = si + ':' + geomVer;
  const achou = topoCache.get(k);
  if (achou) return achou;
  /* uma entrada por FOLHA, e nao uma so: o commit redesenha o canvas grande (folha ativa) e
     logo em seguida a miniatura de cada cartao de folha. Com memoria de um lugar so, as duas
     se expulsavam e cada commit recalculava tudo de novo, folha por folha. O Map velho e
     jogado fora inteiro quando a geometria muda, entao ele nao cresce sem limite. */
  const s = model.sheets[si];
  const pinos = [];
  for (const c of s.comps) for (const p of (HubCore.compPinsWorld(c, SLIB) || [])) pinos.push(p);
  const r = topologiaFolha(s.wires, pinos, s.junctions);
  if (topoCache.size > 8) topoCache.clear();
  topoCache.set(k, r);
  return r;
}
function desenhaFolha(ctx, si, o){
  const s = model.sheets[si];
  const foco = o.foco, esc = o.esc;
  const bb = sheetBBox(si);
  ctx.fillStyle = D.SCH.sheet;
  ctx.fillRect(bb.x1, bb.y1, bb.x2-bb.x1, bb.y2-bb.y1);
  /* A GRADE SEGUE O PASSO ESCOLHIDO, e some por DENSIDADE e nao por um corte fixo de escala:
     com passo de 10 mil, o corte antigo (esc > 0.045) mandaria desenhar 1100 linhas em cada
     eixo numa folha A4 — dezenas de milhares de segmentos por quadro, com a camera sem limite
     de zoom. Aqui a malha fina so aparece quando cada quadrado tem pelo menos 5 px de tela; se
     nao tiver, sobe para o passo de 10 em 10, e se nem esse couber a grade some. */
  if (o.grid) {
    const px = p => p * esc;
    const passo = px(grade.passo) >= 5 ? grade.passo : px(grade.passo * 10) >= 5 ? grade.passo * 10 : 0;
    if (passo){
      ctx.strokeStyle = D.SCH.grid; ctx.lineWidth = 1/esc;
      ctx.beginPath();
      for (let x = 0; x <= bb.x2; x += passo) { ctx.moveTo(x, 0); ctx.lineTo(x, bb.y2); }
      for (let y = 0; y <= bb.y2; y += passo) { ctx.moveTo(0, y); ctx.lineTo(bb.x2, y); }
      ctx.stroke();
    }
  }
  ctx.strokeStyle = D.SCH.border; ctx.lineWidth = 8;
  ctx.strokeRect(bb.x1, bb.y1, bb.x2-bb.x1, bb.y2-bb.y1);

  /* A COR E A IDENTIDADE ELETRICA, NAO A SELECAO.
     Um fio sai laranja quando pertence a net em foco e azul-escuro quando nao — e so. Quem
     esta selecionado ganha o contorno tracejado do drawSelection, por cima, como na vista
     PCB e como no Altium. Enquanto a selecao RECOLORIA, clicar num fio deixava o fio azul e
     os companheiros de net laranja: uma net com duas cores, que se lia como cor travada. */
  const topo = topologiaDe(si);
  /* Os arcos por trecho, para o desenho do fio saber onde saltar. Chave "wi:seg". */
  const saltos = new Map();
  for (const p of topo.pontes){
    const k = p.wi + ':' + p.seg;
    let l = saltos.get(k); if (!l){ l = []; saltos.set(k, l); }
    l.push(p);
  }
  s.wires.forEach((w, wi) => {
    const hl = foco && nets.wireNet[si][wi] === foco;
    ctx.strokeStyle = hl ? D.SCH.hl : D.SCH.wire;
    ctx.lineWidth = hl ? 14 : 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    const pts = w.pts || [];
    /* UM path por fio, com o arco DENTRO dele. Desenhar o arco por cima, num path separado,
       nao serviria: o fio por baixo pode estar laranja (net em foco) e o fundo e o creme da
       folha, entao nao ha cor de "apagar". E quebrar o path por trecho tiraria o lineJoin
       arredondado, que e o que faz o canto do fio parecer canto. */
    pts.forEach((p, i) => {
      if (!i){ ctx.moveTo(p[0], p[1]); return; }
      const arcos = saltos.get(wi + ':' + (i - 1));
      if (arcos){
        const a = pts[i-1];
        const vx = p[0] - a[0], vy = p[1] - a[1], L = Math.hypot(vx, vy) || 1;
        const ux = vx / L, uy = vy / L;
        /* em ordem ao longo do trecho: dois cruzamentos no mesmo trecho nao podem sair fora
           de ordem, senao o path volta para tras e o fio ganha um nó */
        const ord = arcos.map(q => ({ q, t:((q.x - a[0]) * ux + (q.y - a[1]) * uy) })).sort((m, n) => m.t - n.t);
        for (const { q, t } of ord){
          const r = Math.min(PONTE_R, L / 4);
          if (!(r > 0)) continue;
          ctx.lineTo(a[0] + ux * (t - r), a[1] + uy * (t - r));
          /* meia-lua para o lado do +X/+Y: o sentido nao importa eletricamente, so precisa
             ser o mesmo sempre — e o arco anti-horario em torno do ponto de cruzamento */
          const ang = Math.atan2(uy, ux);
          ctx.arc(q.x, q.y, r, ang + Math.PI, ang, true);
        }
      }
      ctx.lineTo(p[0], p[1]);
    });
    ctx.stroke();
  });
  /* As bolinhas. Vinham de dois lugares (as junções explicitas do arquivo e o autoJunctions
     do HubCore, que so enxerga o T) e deixavam de fora a estrela de tres pontas de fio no
     mesmo ponto — 18 pontos assim nos projetos deste workspace, todos sem bolinha. Agora sai
     do censo de ramos (topologiaFolha), que cobre os tres casos de uma vez: T, estrela e pino
     no meio do fio. Quem liga continua sendo o HubCore; isto aqui so DESENHA. */
  for (const j of topo.bolinhas)
    D.drawJunction(ctx, j.x, j.y, foco && netEm(j.x, j.y) === foco ? D.SCH.hl : undefined);

  /* componentes */
  /* o simbolo tambem nao muda de cor por estar selecionado: o azul entrava por cima dos
     PINOS junto com o corpo (o stroke do hub-draw vale para os dois), e pinos de outras nets
     ficavam azuis sem motivo. Quem marca o componente e o contorno tracejado. */
  for (const c of s.comps) {
    const sym = HubCore.symbolOf(SLIB, c.sym);
    const part = HubCore.partOf(sym, c.part);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(((((c.rot||0)%360)+360)%360) * Math.PI/180);
    /* espelho pelo DADO (opts.mirror), e nao por um ctx.scale(-1,1): o scale virava a
       LETRA do nome e do numero do pino junto com o corpo. hub-draw.js » mirrorPart. */
    const emg = part ? null : desenhoDeEmergencia(c);
    if (part) D.drawSymbolPart(ctx, part, { mirror: !!c.mirror, honraOlho: !showState.pinos });
    /* desenho emprestado sai INTEIRO em ambar, e nao no azul da casa: ele esta ali para a
       folha ser legivel, nao para passar por simbolo resolvido — a cor e o aviso */
    else if (emg) D.drawSymbolPart(ctx, emg.part, { mirror: !!c.mirror, honraOlho: !showState.pinos, stroke: EMERG_COR });
    else { ctx.strokeStyle = '#ff5252'; ctx.strokeRect(-100, -100, 200, 200); }
    ctx.restore();
    /* designador e comment: ancora medida pelo textoComp (caixa NA FOLHA + o deslocamento que
       a mao deu). Continuam desenhados fora do ctx.rotate e sempre na horizontal — girar o
       componente nao pode deitar o nome dele, que e o que o Altium tambem faz. */
    /* ancora no canto + `align:'left'` + o mesmo levante de baseline que o net label usa
       (hub-draw.js » drawNetLabel: y + 18 para altura 55, ou seja um terco da altura): o
       worldText centra a letra na vertical, e o Altium a apoia na base */
    const tr = textoComp(c, 'ref');
    if (showState.ref) D.worldText(ctx, tr.s, tr.x, tr.y + tr.h * 0.33, tr.h, 0, '#000000', 'left');
    if (c.comment && showState.comment){
      const tc = textoComp(c, 'com');
      D.worldText(ctx, tc.s, tc.x, tc.y + tc.h * 0.33, tc.h, 0, '#333366', 'left');
    }
    /* o tracinho que liga o texto ao componente quando ele foi afastado com a mao: sem ele,
       um designador arrastado para longe vira uma palavra solta no meio da folha */
    for (const qual of ['ref', 'com']){
      if (qual === 'com' && !(c.comment && showState.comment)) continue;
      const t = textoComp(c, qual);
      if (!t.posto || (Math.abs(t.x - t.bx) < 1 && Math.abs(t.y - t.by) < 1)) continue;
      ctx.save();
      ctx.strokeStyle = '#9a9a86'; ctx.lineWidth = 3; ctx.setLineDash([18, 14]);
      ctx.beginPath(); ctx.moveTo(t.bx, t.by); ctx.lineTo(t.x, t.y); ctx.stroke();
      ctx.restore();
    }
  }
  /* pinos destacados da net selecionada */
  if (foco) {
    for (const c of s.comps) {
      const pins = HubCore.compPinsWorld(c, SLIB) || [];
      for (const p of pins)
        if (nets.pinNet[c.ref + '-' + p.num] === foco) {
          ctx.strokeStyle = D.SCH.hl; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(p.x, p.y, 35, 0, 2*Math.PI); ctx.stroke();
        }
    }
  }
  /* rotulos e power: acendem com a net deles. A guarda `selNet &&` importa — sem ela, com o
     foco vazio um rotulo de net vazia casava com '' e acendia sozinho. */
  for (const l of s.netlabels) D.drawNetLabel(ctx, l, foco && foco === l.net ? D.SCH.hl : undefined);
  for (const p of s.powers)    D.drawPowerPort(ctx, p, foco && foco === p.net ? D.SCH.hl : undefined);
  for (const p of s.ports)     D.drawPort(ctx, p, foco && foco === p.net ? D.SCH.hl : undefined);
  for (const t of s.texts)     D.worldText(ctx, t.s || '', t.x, t.y, (t.h || 10) * 6, t.rot || 0, D.SCH.text, 'left');
  /* o X por ULTIMO: ele marca um pino, e marca escondida atras do corpo nao marca nada */
  for (const n of s.noercs)    D.drawNoERC(ctx, n.x, n.y, n.color);

}
/* o que a camera do canvas grande desenha: a folha ATIVA com os tres estados dela, mais o
   que so existe aqui — o contorno da selecao e a ferramenta na mao */
function drawWorld(ctx, cam){
  desenhaFolha(ctx, sheetIdx, { grid: showState.grid, foco: selNet, esc: cam.scale });
  drawSelection(ctx, cam);
  drawFerramenta(ctx, cam);
}
/* o que a ferramenta na mao esta prestes a fazer: o fio em elastico, o pouso de
   alimentacao em fantasma e o alvo do ima */
function drawFerramenta(ctx, cam){
  const px = 1 / cam.scale;
  if (wireDraw && wireDraw.pts.length){
    const last = wireDraw.pts[wireDraw.pts.length - 1];
    ctx.save();
    ctx.strokeStyle = D.SCH.wire; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    wireDraw.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.stroke();
    if (hoverW){
      const r = wirePoint(hoverW);
      ctx.globalAlpha = 0.7; ctx.setLineDash([30, 20]);
      ctx.beginPath(); ctx.moveTo(last[0], last[1]);
      if (r.pt[0] !== last[0] && r.pt[1] !== last[1]) ctx.lineTo(r.pt[0], last[1]);
      ctx.lineTo(r.pt[0], r.pt[1]);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (tool === 'power' && toolPower && hoverW){
    const x = snapHit ? snapHit.x : snapG(hoverW.x), y = snapHit ? snapHit.y : snapG(hoverW.y);
    ctx.save(); ctx.globalAlpha = 0.6;
    D.drawPowerPort(ctx, { x, y, net:toolPower.net, style:toolPower.style, rot:toolPower.rot });
    ctx.restore();
  }
  if (tool === 'label' && toolNet && hoverW){
    const x = snapHit ? snapHit.x : snapG(hoverW.x), y = snapHit ? snapHit.y : snapG(hoverW.y);
    ctx.save(); ctx.globalAlpha = 0.6;
    D.drawNetLabel(ctx, { x, y, net:toolNet, rot:0 });
    ctx.restore();
  }
  /* o ima: alvo laranja no ponto de conexao que vai grudar */
  const ima = tool !== 'select' ? snapHit : moveIma;
  if (ima){
    const r = 7 * px;
    ctx.save();
    ctx.strokeStyle = D.SCH.hl; ctx.lineWidth = 2 * px; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(ima.x, ima.y, r, 0, 2 * Math.PI); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ima.x - r * 2.1, ima.y); ctx.lineTo(ima.x - r * 1.2, ima.y);
    ctx.moveTo(ima.x + r * 1.2, ima.y); ctx.lineTo(ima.x + r * 2.1, ima.y);
    ctx.moveTo(ima.x, ima.y - r * 2.1); ctx.lineTo(ima.x, ima.y - r * 1.2);
    ctx.moveTo(ima.x, ima.y + r * 1.2); ctx.lineTo(ima.x, ima.y + r * 2.1);
    ctx.stroke();
    ctx.restore();
  }
}
/* as bordinhas: caixa tracejada com alcas nos cantos em cada item marcado (nos fios, tambem
   em cada vertice) e o retangulo de selecao enquanto ele e arrastado */
function drawSelection(ctx, cam){
  const px = 1 / cam.scale, hs = 3.5 * px, m = 40;
  ctx.save();
  for (const a of sel.values()){
    const it = a.it;
    if (!onSheet(it)) continue;
    const pts = it.pts || [];
    /* O TRECHO se marca por cima do proprio fio, e nao por uma caixa: um trecho horizontal tem
       caixa de altura zero, e um retangulo tracejado de 80 mil em volta dele apontaria para o
       lugar certo dizendo a coisa errada — "peguei esta area" em vez de "peguei este trecho". */
    if (a.k === 'seg' && pts[a.i] && pts[a.i+1]){
      ctx.strokeStyle = SEL; ctx.lineWidth = Math.max(16, 6 * px); ctx.setLineDash([]);
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(pts[a.i][0], pts[a.i][1]); ctx.lineTo(pts[a.i+1][0], pts[a.i+1][1]); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = SEL;
      for (const p of [pts[a.i], pts[a.i+1]]) ctx.fillRect(p[0] - hs, p[1] - hs, 2*hs, 2*hs);
      continue;
    }
    if (a.k === 'vert'){
      const p = pts[a.i];
      if (!p) continue;
      ctx.fillStyle = SEL;
      ctx.fillRect(p[0] - hs*2, p[1] - hs*2, 4*hs, 4*hs);
      continue;
    }
    const bb = alvoBBox(a);
    const mm = (a.k === 'ref' || a.k === 'com') ? 10 : m;    /* o texto quer moldura justa */
    const x = bb.x1 - mm, y = bb.y1 - mm, w = (bb.x2 - bb.x1) + 2*mm, h = (bb.y2 - bb.y1) + 2*mm;
    ctx.strokeStyle = SEL; ctx.lineWidth = 1.5 * px; ctx.setLineDash([6 * px, 4 * px]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = SEL;
    for (const [cx, cy] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) ctx.fillRect(cx - hs, cy - hs, 2*hs, 2*hs);
    /* as alcinhas de vertice do fio inteiro: elas ja eram desenhadas e nao faziam nada. Agora
       sao alvo de verdade — o hitTest devolve o vertice quando o cursor esta em cima delas. */
    if (it.t === 'wire' && a.k === 'all') for (const p of pts) ctx.fillRect(p[0] - hs, p[1] - hs, 2*hs, 2*hs);
  }
  if (boxRect){
    const r = boxRect;
    ctx.fillStyle = 'rgba(41,121,255,0.12)'; ctx.strokeStyle = SEL; ctx.lineWidth = px;
    if (r.x2 < r.x1) ctx.setLineDash([5 * px, 4 * px]);     /* direita→esquerda: "quem encosta" */
    ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
    ctx.strokeRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
  }
  ctx.restore();
}
const cam = D.mkCamera(cv, drawWorld, {
  bg:'#3a3a34',
  onMove: w => {
    hoverW = w;
    $('sx').textContent = w.x.toFixed(0);
    $('sy').textContent = w.y.toFixed(0);
    /* com ferramenta na mao o que interessa e o ima, nao o que esta sob o cursor */
    if (tool !== 'select'){
      snapHit = panning ? null : snapPoint(w);
      /* o ima pegou um pino de nome barrado: o rotulo vai como markup ja escapado pelo
         hub-overbar — nos outros casos segue texto, que nao passa por parser nenhum */
      if (snapHit && snapHit.html) $('shover').innerHTML = '⊙ ' + snapHit.html;
      else $('shover').textContent = snapHit ? '⊙ ' + snapHit.label
        : (tool === 'wire' ? (wireDraw ? 'clique para o próximo ponto · botão direito encerra' : 'clique para começar o fio')
        :  tool === 'label' ? 'clique para pousar o rótulo ' + toolNet
        :  tool === 'noerc' ? 'clique no pino que fica sem ligar de propósito'
                           : 'clique para pousar ' + (toolPower ? toolPower.net : ''));
      cam.draw();
      return;
    }
    if (mouse || panning) return;      /* durante um gesto o hover nao manda no cursor nem no texto */
    const h = hitTest(w.x, w.y);
    /* o hover diz o que o clique vai pegar — com o trecho, o numero do trecho, senao a mao
       marca uma coisa e a barra de status anuncia outra */
    $('shover').textContent =
      h ? (h.kind === 'pin' ? `${h.ref}-${h.num} · ${nets.pinNet[h.ref + '-' + h.num] || 'sem net'}`
         : h.kind === 'wire' ? (describe(alvoDoHit(h)) + ' · ' + (nets.wireNet[sheetIdx][h.wi] || 'sem net'))
                             : describe(alvoDoHit(h))) : '';
    cv.style.cursor = 'default';   /* seta normal; so o pan (agarrando) muda */
  }
});

function hitTest(x, y){
  const s = model.sheets[sheetIdx];
  const tol = 8 / cam.cam.scale;
  /* o No ERC vem ANTES do pino, e so: ele fica EM CIMA da ponta quente, entao com o
     pino primeiro o X nunca poderia ser selecionado — nem apagado. O raio e curto (30
     mil, o tamanho do desenho), entao clicar um fio de distancia ao lado ainda pega o
     pino, como se espera de um objeto pequeno por cima de outro. */
  for (const n of s.noercs)
    if (Math.hypot(x - n.x, y - n.y) <= 30) return { kind:'noerc', item:n };
  for (const c of s.comps) {
    const pins = HubCore.compPinsWorld(c, SLIB) || [];
    for (const p of pins)
      if (Math.hypot(x - p.x, y - p.y) <= Math.max(tol, 30)) return { kind:'pin', ref:c.ref, num:p.num, item:c };
  }
  for (const j of s.junctions)
    if (Math.hypot(x - j.x, y - j.y) <= Math.max(tol, 35)) return { kind:'junction', item:j };
  for (const l of s.netlabels)
    if (x >= l.x - 20 && x <= l.x + Math.max((l.net || '').length * 40, 120) && y >= l.y - 20 && y <= l.y + 80)
      return { kind:'netlabel', item:l };
  for (const p of s.powers)
    if (Math.hypot(x - p.x, y - p.y) <= Math.max(tol, 140)) return { kind:'power', item:p };
  for (const p of s.ports){
    const b = itemBBox(p);
    if (x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2) return { kind:'port', item:p };
  }
  for (const t of s.texts)
    if (x >= t.x - 20 && x <= t.x + Math.max((t.s || '').length * (t.h || 10) * 4, 120) &&
        y >= t.y - (t.h || 10) * 4 && y <= t.y + (t.h || 10) * 4)
      return { kind:'text', item:t };
  /* O TEXTO DO COMPONENTE (designador e comment) vem antes do fio e do corpo: ele mora em
     area vazia, e quem clica em cima de uma palavra esta mirando a palavra. Entre os dois, o
     designador ganha — ele esta sempre a vista, o comment so com o olho ligado. */
  if (showState.ref) for (const c of s.comps){
    const b = textoBBox(c, 'ref');
    if (x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2) return { kind:'ref', ref:c.ref, item:c };
  }
  if (showState.comment) for (const c of s.comps){
    if (!c.comment) continue;
    const b = textoBBox(c, 'com');
    if (x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2) return { kind:'com', ref:c.ref, item:c };
  }
  /* O FIO DEVOLVE O TRECHO, e o vertice quando o cursor esta em cima da alcinha. O indice do
     segmento ja era calculado aqui e jogado fora no return — era so isso que faltava para
     "selecionar o trecho e nao a polilinha inteira". O vertice ganha do trecho porque a
     alcinha e menor e quem a mira esta querendo justamente o canto. */
  for (let wi = 0; wi < s.wires.length; wi++) {
    const pts = s.wires[wi].pts || [];
    for (let i = 0; i < pts.length - 1; i++)
      if (HubCore.distSeg(x, y, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]) <= Math.max(tol, 20)){
        const rv = Math.max(tol, 22);
        const vert = Math.hypot(x - pts[i][0], y - pts[i][1]) <= rv ? i
                   : Math.hypot(x - pts[i+1][0], y - pts[i+1][1]) <= rv ? i + 1 : null;
        return { kind:'wire', wi, item:s.wires[wi], seg:i, vert };
      }
  }
  /* pela caixa do corpo como ele esta na folha (girado/espelhado), e nao por um circulo em
     volta da ancora: o RES da casa vai de -150 a +50 mil, e o circulo errava o corpo de um
     lado e acertava o vazio do outro */
  for (const c of s.comps) {
    const bb = compBBox(c), f = Math.max(tol, 20);
    if (x >= bb.x1 - f && x <= bb.x2 + f && y >= bb.y1 - f && y <= bb.y2 + f) return { kind:'comp', ref:c.ref, item:c };
  }
  return null;
}

/* O carimbo de data do livro-razao da troca de simbolo. Morava no bloco do sinalizador
   (que saiu inteiro) mas o dono de verdade e outro: `nova.push({ kind:'sym', ..., when:
   nowStr() })`, mais abaixo neste arquivo. */
function nowStr(){
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
/* ------- rotulo de net: pedir a palavra, depois armar a ferramenta -------
   A ferramenta so e armada DEPOIS que a palavra existe: um netlabel com net vazio e erro
   de validacao (hub-core.js) e travaria o Salvar do arquivo inteiro. */
function hideNetForm(){ $('netform').style.display = 'none'; }
function openNetForm(){
  $('nettext').value = toolNet || '';
  $('netform').style.display = 'block';
  $('nettext').focus(); $('nettext').select();
}
function confirmaNetForm(){
  /* aspas viram apostrofo: a sequencia aspas-dois-pontos quebra o parser de linha do .pas */
  const nome = $('nettext').value.trim().replace(/"/g, "'");
  if (!nome){ HubDialog.toast('dê um nome à net', 'warn'); $('nettext').focus(); return; }
  hideNetForm();
  toolNet = nome;          /* antes do setTool: ele so zera a palavra ao SAIR de 'label' */
  setTool('label');
}
$('netok').addEventListener('click', confirmaNetForm);
$('netcancel').addEventListener('click', () => { hideNetForm(); setTool('select'); });
/* Enter confirma e Escape fecha AQUI: o keydown global trata Escape antes de deixar
   passar por INPUT, entao sem o stopPropagation o Esc do campo mexia na ferramenta */
$('nettext').addEventListener('keydown', e => {
  if (e.key === 'Enter'){ e.preventDefault(); confirmaNetForm(); }
  else if (e.key === 'Escape'){ e.stopPropagation(); hideNetForm(); setTool('select'); }
});
$('tbNet').addEventListener('click', () => {
  if (tool === 'label'){ setTool('select'); hideNetForm(); return; }
  openNetForm();
});
/* ═══ Escolher um simbolo para um componente que nao foi identificado ═══
   37% dos componentes dos projetos reais chegam do Altium com um `sym` que nenhuma
   biblioteca daqui tem — vieram de outra lib, com outro nome. HubCore.suggestSym ranqueia
   candidatos do acervo pelo comment, pelo nome, pelo footprint, pelo designador e pela
   pinagem; QUEM ESCOLHE E A PESSOA. Empate no topo e comum e legitimo (tres capacitores
   0805 100nF servem igual), e escolher sozinho gravaria um esquema silenciosamente errado.
   A escolha vira linha em Libs/lib-subs.js — o mesmo lugar onde a aba Biblioteca grava as
   dela — e dali em diante o resolveLib acerta ja no primeiro passo. */
let symAlvo = null, symEscolhido = null, symCands = [], symOpts = null;
/* a lista do modal e o ALMOXARIFADO, agrupado por familia, e so ele: a biblioteca da
   casa fica de fora por pedido explicito — a tela e ferramenta de migracao, e oferecer
   a lib antiga seria oferecer justo o que se quer parar de usar. O painel mora no
   hub-almoxpick.js (modulo proprio, como o hub-odoolista.js) para nao inflar este
   arquivo nem entrar no script inline do hub.html, que e de outro dono. */
let apGrupos = null, apFiltro = 'all', apRec = null, apFam = null;
let symPart = null;
/* medidos ao ABRIR o modal, para aparecerem antes do clique em Usar e nao num toast depois
   de gravar: quantos componentes do projeto mudam junto e a pinagem que o componente
   espera (null = o simbolo de origem nao existe em acervo nenhum) */
let symQuantos = 0, symEsperados = null;
const camSymEsc = D.mkCamera($('symCv'), ctx => { if (symPart) D.drawSymbolPart(ctx, symPart, { honraOlho: false }); },
                             { bg: D.SCH.sheet });
const symModalAberto = () => $('symmodal').classList.contains('on');

function fechaSymModal(){
  $('symmodal').classList.remove('on');
  /* o aviso de fechamento sai ANTES do reset, e vale tambem para quem cancelou: o painel
     que abriu este modal se escondeu para nao ficar por cima dele (z-index 60 contra 50) e
     precisa voltar de qualquer jeito, senao um Esc deixa a tela vazia */
  const aoFechar = symOpts && symOpts.aoFechar;
  symAlvo = null; symEscolhido = null; symCands = []; symPart = null; apFam = null; apRec = null;
  symOpts = null;
  symQuantos = 0; symEsperados = null;
  if (typeof aoFechar === 'function') aoFechar();
}

/* quantos componentes DESTE projeto usam o mesmo nome de simbolo: e o tamanho do estrago
   (ou do conserto) de uma escolha, que e global */
function contaSym(nome){
  if (!nome) return 0;
  return model.sheets.reduce((k, sh) => k + sh.comps.filter(c => c.sym === nome).length, 0);
}

/* As tabelas de apelido SEM a escolha gravada para `de` — e assim que se pergunta ao
   resolvedor "e se essa escolha nao existisse?" sem mexer no estado global. */
function tabelasSemEscolha(de){
  const t = HubCore.libTables();
  const subs = {};
  for (const k of Object.keys(t.sym.subs)) if (k !== de) subs[k] = t.sym.subs[k];
  return { sym: { subs: subs, fwd: t.sym.fwd, bwd: t.sym.bwd }, fp: t.fp };
}

/* Pinagem que o componente ESPERA: a do simbolo em que o nome dele resolveria sozinho. O
   caso comum de quem veio de outra biblioteca do Altium e nao existir em acervo nenhum —
   ai a resposta e null, e a tela diz isso em vez de inventar um numero. */
function pinosEsperadosDe(comp){
  if (!comp || !comp.sym) return null;
  const r = HubCore.resolveSym(SLIB, comp.sym, tabelasSemEscolha(comp.sym));
  const p = r && r.item ? HubCore.partOf(r.item, comp.part) : null;
  return p && p.pins ? p.pins.length : null;
}

/* O aviso que faltava, no pe da previa: pinagem esperada x pinagem do candidato, e quantos
   componentes mudam junto — os dois ANTES do clique. */
function symAtualizaInfo(){
  const box = $('symInfo');
  if (!box) return;
  box.textContent = '';
  const rs = symAlvo ? HubCore.resolveSym(SLIB, symAlvo.sym) : null;
  const d = decideTroca({ sym: rs && rs.item && rs.item.name, how: rs && rs.how,
                          quantos: symQuantos, pinosEsperados: symEsperados,
                          pinosDoCandidato: symPart && symPart.pins ? symPart.pins.length : null });
  if (d.pinos)   box.append(el('div', 'li' + (d.pinosAlerta   ? ' alerta' : ''), d.pinos));
  if (d.impacto) box.append(el('div', 'li' + (d.impactoAlerta ? ' alerta' : ''), d.impacto));
}

function symSelecionar(c){
  symEscolhido = c;
  $('symEscolha').textContent = c ? c.name : 'nenhum componente escolhido';
  $('symUsar').disabled = !c;
  for (const b of $('symVals').querySelectorAll('.ap-val'))
    b.setAttribute('aria-selected', String(!!c && b.dataset.nome === c.name));
  /* a parte do COMPONENTE, nao a 1 fixa: previa e contagem de pinos tem de falar da mesma
     parte, senao o aviso de pinagem compara coisas diferentes */
  const parte = (symAlvo && symAlvo.part) || 1;
  symPart = c ? (HubCore.partOf(c.item, parte) || HubCore.partOf(c.item, 1) || null) : null;
  $('symHint').textContent = symPart ? '' : (c ? 'sem geometria para desenhar' : '');
  symAtualizaInfo();
  if (apFam) $('symEditar').title = 'abre "' + apFam.familia + '" na aba Biblioteca » Símbolos'
    + (c ? ', já no componente "' + c.name + '"' : '');
  fitPreview(camSymEsc, symPart ? D.symBBox(symPart) : null);
  camSymEsc.resize(); ajustaPreviews([camSymEsc]);
}

function symLinha(c, sugerido){
  const b = el('button', 'sym-item'); b.type = 'button'; b.dataset.nome = c.name;
  b.setAttribute('aria-selected', 'false');
  if (sugerido) b.append(el('span', 'nota', String(c.pontos)));
  b.append(el('div', 'n', c.name));
  const ac = ACERVO_DE.get(c.name);
  b.append(el('div', 'p', (sugerido && c.porque.length) ? c.porque.join(' · ')
                        : (ac ? ac.titulo : ((c.item && c.item.familia) || ''))));
  b.onclick = () => symSelecionar(c);
  return b;
}

function symRenderLista(){
  if (!apGrupos) apGrupos = HubAlmoxPick.grupos();
  const c = HubAlmoxPick.contagens(apGrupos);
  $('symNTudo').textContent = c.tudo;
  $('symNSaldo').textContent = c.comSaldo;
  $('symNZero').textContent = c.zerados;
  HubAlmoxPick.renderFamilias($('symLista'), {
    grupos: apGrupos, busca: $('symBusca').value, filtro: apFiltro,
    sel: apFam && apFam.familia, rec: apRec,
    onPick: g => { escolheFamilia(g); symRenderLista(); },
    onContagem: (n, tot) => {
      $('symSum').textContent = (n === tot ? n : n + ' de ' + tot)
        + (tot === 1 ? ' família' : ' famílias') + ' do almoxarifado';
    },
  });
  symRenderValores();
}
/* os componentes da familia aberta, debaixo do simbolo dela — e aqui que se escolhe o que
   vai para a folha. A familia nao e escolhivel: ninguem coloca "CAPACITOR CERAMICO [PTH]"
   numa placa, coloca-se "3.3pF 25V". */
function symRenderValores(){
  HubAlmoxPick.renderValores($('symVals'), apFam, {
    busca: $('symBusca').value, filtro: apFiltro,
    sel: symEscolhido && symEscolhido.name, rec: apRec,
    onPick: it => { symSelecionar(candidatoDoValor(it.nome)); symRenderValores(); },
  });
}
/* abrir a familia mostra o DESENHO dela na hora, mesmo antes de escolher o componente: e o
   desenho que diz se a familia e a certa. O componente so se escolhe depois, na lista. */
function escolheFamilia(g){
  apFam = g;
  const b = $('symEditar');
  b.hidden = !g;
  if (g) b.title = 'abre "' + g.familia + '" na aba Biblioteca » Símbolos'
                 + (symEscolhido ? ', já no componente "' + symEscolhido.name + '"' : '');
  if (!g) return;
  const dela = symEscolhido && g.valores.some(v => v.nome === symEscolhido.name);
  if (!dela) symSelecionar(null);
  if (!symPart) previaDaFamilia(g);
}
/* ── ABRIR O EDITOR NUMA ABA PRÓPRIA, mantendo esta ──
   Trocar a aba do hub fecharia este modal, e a comparação "o desenho está certo?" é
   justamente entre as duas telas. Então o editor vai para uma ABA NOVA, com o alvo na URL
   (hub.html » ?edsym/&edcomp/&edacervo), e esta fica como está.

   O que for salvo lá volta para cá SOZINHO: o hubserver vigia `Libs\` a cada segundo e
   empurra um SSE `change` para toda aba aberta (hubserver.py » LIVE_JS/_watcher), que chama
   __hubOnChange. O daqui, com o modal aberto, recarrega a biblioteca e redesenha o modal em
   vez de recarregar a página — ver mais abaixo. */
/* A biblioteca mudou por baixo do modal — alguém salvou na aba do editor. Refaz os grupos,
   recalcula a recomendação e redesenha, PRESERVANDO a família aberta e o componente escolhido
   quando eles ainda existirem (um rename ou uma exclusão lá podem tê-los levado embora).
   É o outro lado do "Editar símbolo ↗": lá se edita, aqui se vê o resultado sem F5. */
function atualizaModalDaBiblioteca(){
  if (!symModalAberto()) return;
  const famNome = apFam && apFam.familia;
  const escolhido = symEscolhido && symEscolhido.name;
  apGrupos = HubAlmoxPick.grupos();
  apFam = famNome ? (apGrupos.find(g => g.familia === famNome) || null) : null;
  if (symAlvo){
    const rs = HubCore.resolveSym(SLIB, symAlvo.sym);
    apRec = HubAlmoxPick.recomendado(apGrupos, symAlvo.sym, rs && rs.name);
  }
  /* a seleção ANTES do render: quem desenha a lista de valores lê symEscolhido para marcar */
  const c = escolhido ? candidatoDoValor(escolhido) : null;
  symSelecionar(c);
  symRenderLista();
  if (!c && apFam) previaDaFamilia(apFam);
  const perdeu = (famNome && !apFam) || (escolhido && !c);
  HubDialog.toast(perdeu
    ? 'a biblioteca mudou e o que estava aberto aqui não existe mais — escolha de novo'
    : 'a biblioteca mudou — o desenho aqui já está atualizado',
    perdeu ? 'warn' : 'ok', perdeu ? 7000 : 4000);
}
function editarSimboloNoHub(){
  const g = apFam;
  if (!g) return;
  const comp = symEscolhido && symEscolhido.name;
  const q = new URLSearchParams();
  q.set('edsym', g.familia);
  if (comp) q.set('edcomp', comp);
  if (g.lib && g.lib.id) q.set('edacervo', g.lib.id);
  /* O hub e a PAGINA DE CIMA: dentro do iframe, `location` e o schframe.html.
     A deteccao e por CAPACIDADE, nunca pelo nome do arquivo: o hubserver serve o hub tanto
     em /hub.html quanto na RAIZ (hubserver.py » @app.route('/')), e exigir que o pathname
     terminasse em "hub.html" acusava "sem o hub por perto" para quem abre por
     http://servidor:8000/ — que e o caminho normal. O pathname so serve para MONTAR a URL,
     e ele vai como veio: '/' ou '/hub.html', tanto faz. */
  let base = null, temPorta = false;
  try {
    if (window.parent !== window){
      base = window.parent.location.pathname;
      temPorta = typeof window.parent.__hubEditarSimbolo === 'function';
    }
  } catch (e) { base = null; }          /* cross-origin: nao e o nosso hub */
  if (base === null){
    HubDialog.alert('A área de edição de símbolo é uma aba do hub. Esta vista está aberta '
      + 'sozinha — abra o hub (python hubserver.py) e entre pela aba Esquema.',
      { title: 'sem o hub por perto' });
    return;
  }
  if (!temPorta){
    HubDialog.alert('O hub aberto é de uma versão anterior e não tem a porta que abre o '
      + 'editor numa aba nova. Recarregue a página do hub (F5) e tente de novo.',
      { title: 'hub desatualizado' });
    return;
  }
  const w = window.open(base + '?' + q.toString() + '#/libsym', '_blank');
  if (!w){
    HubDialog.alert('o navegador bloqueou a aba nova. Libere os pop-ups para este endereço '
      + 'e tente de novo.', { title: 'aba não abriu' });
    return;
  }
  HubDialog.toast('abrindo "' + (comp || g.familia) + '" numa aba nova — o que você salvar lá '
                  + 'aparece aqui sozinho', 'info', 6000);
}
function previaDaFamilia(g){
  symPart = HubCore.partOf(g.sym, 1) || null;
  $('symHint').textContent = symPart ? '' : 'esta família não tem desenho no espelho';
  fitPreview(camSymEsc, symPart ? D.symBBox(symPart) : null);
  camSymEsc.resize(); ajustaPreviews([camSymEsc]);
}
/* o valor escolhido vira o candidato que o resto do modal ja entende: o alias do valor esta
   no SLIB (montaAcervos cria um por valor), entao e ele que a previa desenha e que o
   usarSimboloEscolhido grava no lib-subs.js */
function candidatoDoValor(nome){
  const item = HubCore.symbolOf(SLIB, nome);
  return item ? { name: nome, item, pontos: 0, porque: [] } : null;
}

/* `opts.vinculo` muda o que o botao Usar faz — ver usarSimboloEscolhido. O modal, a busca,
   a previa e a conferencia de pinagem sao os mesmos: quem escolhe componente do almoxarifado
   ja tem tela, e uma segunda seria outra tela para manter. */
function abrirEscolhaSimbolo(comp, opts){
  symOpts = opts || null;
  symAlvo = comp;
  symCands = HubCore.suggestSym(comp, SLIB.symbols, { limit: 12 });
  apGrupos = HubAlmoxPick.grupos();
  apFiltro = 'all';
  /* o componente de MESMO NOME que o Altium mandou sobe para o topo e ja vem marcado:
     medido, 448 dos 824 componentes dos projetos casam por nome exato */
  const rsRec = HubCore.resolveSym(SLIB, comp.sym);
  apRec = HubAlmoxPick.recomendado(apGrupos, comp.sym, rsRec && rsRec.name);
  symQuantos = contaSym(comp.sym);
  symEsperados = pinosEsperadosDe(comp);
  const rs = HubCore.resolveSym(SLIB, comp.sym);
  const atual = (rs && rs.item) || null;
  /* o cabecalho muda de "procurar" para "trocar" quando ja ha COMPONENTE resolvido, e diz
     qual e de onde ele veio: e a pergunta que o modal tem de responder antes de qualquer
     clique. Componente e a entrada da biblioteca; simbolo e so o desenho dela — o modal
     escolhe o primeiro, e a faixa de baixo (quando existir) troca o segundo */
  $('symTitle').textContent = atual ? 'Trocar componente' : 'Procurar componente';
  /* o nome sai da prosa e vira um campo proprio, copiavel: e ele que a pessoa leva para a
     busca do acervo logo abaixo. O meta continua com o RESTO — de quem e, o comment e onde
     ja resolveu —, que e contexto para ler, nao texto para levar */
  /* O NOME DO COMPONENTE SO EXISTE AQUI. Ele saiu da ficha (era mais uma linha de
     procedencia entre "Por que" e "Resolvido em", que o usuario pediu para sumir) e aqui
     ele serve para alguma coisa: e o que se leva para a busca do acervo. O icone de copia
     diz isso sem precisar do title — antes, so quem passasse o mouse descobria. */
  const nb = $('symNome');
  nb.textContent = '';
  if (comp.sym){
    nb.append(el('span', 'nm', comp.sym));
    const ic = document.createElement('span');
    ic.className = 'cp';
    ic.innerHTML = '<svg viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/>'
                 + '<path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/></svg>';
    nb.append(ic);
  }
  nb.title = comp.sym ? 'clique para copiar “' + comp.sym + '”' : '';
  $('symMeta').textContent = comp.ref + ' — o Altium mandou este nome'
    + (comp.comment ? ' · comment "' + comp.comment + '"' : '')
    + (atual ? ' · resolvido no componente "' + atual.name + '"'
             + (rs.how === 'escolha' ? ', por escolha sua' : '') : '');
  $('symBusca').value = '';
  $('symmodal').classList.add('on');
  apFam = apRec ? apRec.grupo : null;
  symSelecionar(apRec ? candidatoDoValor(apRec.item.nome) : null);
  if (!apRec) symRenderLista(); else { symRenderLista(); }
  if (!symPart && apFam) previaDaFamilia(apFam);
}

/* Grava RELENDO o disco antes: lib-subs.js e da LAN inteira e a aba Biblioteca do hub
   grava nele tambem — reescrever de memoria apagaria a escolha que a outra aba fez. */
/* ── ATRIBUIR O DESENHO EMPRESTADO AO SÍMBOLO DA BIBLIOTECA ──
   O resgate acima deixa a folha legível, mas é remendo de VISTA: o símbolo da casa continua
   sem geometria e no próximo projeto o quadrado vermelho volta. Aqui a correção fica de pé —
   o símbolo escolhido RECEBE o desenho, no espelho e na .SchLib real.

   É a única coisa desta vista que escreve na biblioteca viva, então ela é cercada: só com
   servidor, só na biblioteca da CASA (o desenho do almoxarifado nasce do gerador e se grava
   pela rota /save-almox, por componente), só em símbolo de UMA parte (atribuir um desenho de
   uma parte a um símbolo de várias apagaria as outras) e sempre atrás de um confirm que diz,
   em número de pinos e gráficos, o que vai ser sobrescrito. */
const clonaJSON = o => JSON.parse(JSON.stringify(o));
async function postSymbols(path, body){
  let r;
  try { r = await fetch('/api/symbols/' + path, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) }); }
  catch (e){ return { status:0, j:{ ok:false, error:'servidor não respondeu: ' + e.message } }; }
  let j = null;
  try { j = await r.json(); }
  catch (e){ j = { ok:false, error:(r.status === 404 || r.status === 405)
    ? 'o servidor não tem /api/symbols — reinicie o hubserver.py'
    : 'resposta inválida do servidor (HTTP ' + r.status + ')' }; }
  return { status:r.status, j };
}
async function perguntaAtribuir(emg, para){
  if (!emg || !HubIO.canPost) return;
  const alvo = HubCore.symbolOf(SLIB, para);
  if (!alvo) return;
  const ac = ACERVO_DE.get(para);
  if (ac && ac.almox){
    HubDialog.toast('"' + para + '" é do almoxarifado: o desenho dele vem do sincronismo — '
                    + 'para gravar, use a aba Biblioteca » Símbolos', 'warn', 7000);
    return;
  }
  const nPartes = (alvo.parts || []).length || 1;
  if (nPartes > 1){
    HubDialog.toast('"' + para + '" tem ' + nPartes + ' partes — atribuir o desenho de uma só '
                    + 'apagaria as outras; use a aba Biblioteca » Símbolos', 'warn', 7000);
    return;
  }
  const atual = HubCore.partOf(alvo, 1) || { pins:[], graphics:[] };
  const nPin = (emg.part.pins || []).length, nGrf = (emg.part.graphics || []).length;
  const ok = await HubDialog.confirm(
    'Deseja atribuir a "' + para + '" o desenho emprestado de "' + emg.nome + '"?\n\n'
    + '"' + para + '" hoje tem ' + (atual.pins || []).length + ' pinos e '
    + (atual.graphics || []).length + ' gráficos; passa a ter ' + nPin + ' pinos e ' + nGrf + ' gráficos.\n\n'
    + 'Grava em Libs/schlib.js E na SchLib do Altium — vale para TODOS os projetos, não só este.',
    { title: 'atribuir o símbolo ao componente da biblioteca', ok: 'Atribuir', danger: true });
  if (!ok) return;
  return true;
}
/* A GRAVACAO, separada da pergunta de proposito: escrever em Libs dispara o
   __hubOnChange, que recarrega a pagina. Com a pergunta ja respondida antes de qualquer
   escrita, nenhuma recarga pode pegar um dialogo aberto no meio. */
async function gravaDesenhoNaBiblioteca(emg, para){
  const alvo = HubCore.symbolOf(SLIB, para);
  if (!alvo) return;
  const parts = [{ part:1, pins: clonaJSON(emg.part.pins || []), graphics: clonaJSON(emg.part.graphics || []) }];
  const { status, j } = await postSymbols('save', { name: para, parts, description: alvo.description, altium: true });
  /* o espelho pode ter sido gravado mesmo quando a SchLib falhou (423 = lib aberta no
     Altium): nesse caso a memória TEM de acompanhar o disco, senão a folha desenha uma
     versão que já não existe em lugar nenhum */
  /* partcount SAI DA LISTA, nunca cravado: com um componente de várias partes o 1 fixo
     mentia na ficha e na contagem de partes do modal */
  const aplicaNaMemoria = () => {
    alvo.parts = (j && j.parts) || parts;
    alvo.partcount = alvo.parts.length;
    reapply();
  };
  if (j && j.ok){
    aplicaNaMemoria();
    HubDialog.toast('"' + para + '" recebeu o desenho' + (j.altium ? ' — espelho e SchLib' : ' — só o espelho'), 'ok');
    return;
  }
  const msg = (j && j.error) || ('HTTP ' + status);
  if (j && j.espelho && !j.altium){
    aplicaNaMemoria();
    HubDialog.toast(status === 423
      ? 'espelho gravado; a biblioteca está aberta no Altium — feche e repita para a SchLib'
      : 'espelho gravado, mas a SchLib ficou para trás — ' + msg, 'warn', 8000);
    return;
  }
  await HubDialog.alert(msg, { title: 'não gravou na biblioteca' });
}

async function usarSimboloEscolhido(){
  if (!symAlvo || !symEscolhido) return;
  const de = symAlvo.sym, para = symEscolhido.name;
  /* medido ANTES da substituicao: depois dela o simbolo resolve e o emprestimo some */
  const emg = HubCore.symbolOf(SLIB, de) ? null : desenhoDeEmergencia(symAlvo);
  if (de === para && !(symOpts && symOpts.vinculo)){ HubDialog.toast('já é esse componente', 'warn'); return; }

  /* MODO VINCULO — o painel "Enviar para o Odoo" abriu este modal para resolver UMA linha
     da lista. O que resolve uma linha NAO e substituicao de simbolo: o lib-subs.js vale
     para a folha inteira, nao grava OdooId, e o odoolista resolve por OdooId nos params.
     Entao aqui vai o VINCULO, pelo mesmo caminho que o painel da BoM usa — sym, comment e
     params de uma vez so, pela mesma funcao, para nao existirem dois formatos de params. */
  /* SEMPRE VINCULO, desde 2026-09-15. Antes, sem `symOpts.vinculo`, a escolha ia para o
     lib-subs.js — substituicao GLOBAL por nome de simbolo. Trocar o componente de CN1
     mudava todo CN que usasse o mesmo simbolo, em todos os projetos, e a folha nem
     mostrava que isso tinha acontecido. O usuario pediu o contrario, com todas as letras:
     um componente nao pode influenciar outro de designador diferente.

     Entao o `vinculo` deixou de ser um modo e virou O comportamento. O que muda e o
     ALCANCE: agora sao as partes DESTE designador, e mais nada. A trava de multi-parte
     mora dentro do __hubAplicaVinculos, entao ela vale para os dois caminhos.

     O lib-subs.js continua existindo e continua sendo lido — ha escolhas antigas
     gravadas la, e o 'Desfazer a escolha' as remove. So nao se escreve mais nele por
     aqui. */
  /* O DESENHO EMPRESTADO, antes de qualquer coisa. Um simbolo sem geometria desenha como
     quadrado vermelho, e o vinculo sozinho nao conserta isso: quem conserta e levar o
     desenho para a BIBLIOTECA. A pergunta vem primeiro porque gravar em Libs/ recarrega a
     pagina pelo SSE do hubserver, e uma pergunta aberta morreria sem resposta.
     So faz sentido com servidor: sem ele nao ha onde gravar a biblioteca. */
  const atribuir = (emg && HubIO.canPost) ? await perguntaAtribuir(emg, para) : false;

  /* todas as partes do MESMO designador: o designador e do componente, e trocar metade
     dele deixaria a folha com um componente partido ao meio */
  const refs = (symOpts && symOpts.vinculo && symOpts.refs && symOpts.refs.length)
    ? symOpts.refs : [symAlvo.ref];
  const res = window.__hubAplicaVinculos([{ refs: refs, componente: para }]);
  if (!res || !res.ok){
    await HubDialog.alert((res && res.erro) || 'não deu para aplicar a troca.',
                          { title: 'não troquei' });
    return;
  }
  const aoAplicar = symOpts && symOpts.aoAplicar;
  fechaSymModal();
  /* dizer QUAL das duas coisas aconteceu: multi-parte recebe so a identidade, e prometer
     troca de desenho que nao houve e o comeco de "mas eu troquei e nao mudou nada" */
  const so = (res.soIdentidade || []).length > 0;
  HubDialog.toast(refs.join(', ') + (so
    ? ' recebeu a identidade de "' + para + '" — o desenho fica, porque é multi-parte.'
    : ' → "' + para + '"') + ' Ctrl+Z desfaz, e só o Salvar grava.', 'ok');
  /* O ENCAIXE dito em voz alta. Mover o componente para os pinos caírem onde estavam e um
     ajuste que o usuario nao pediu: se ele nao for anunciado, o componente "anda sozinho" e
     a duvida sobra para quem estava olhando a folha. */
  for (const en of (res.encaixes || []))
    HubDialog.toast(en.ref + ': encaixei no lugar do antigo — ' + en.encaixa + ' de ' + en.comuns
      + ' pinos voltaram ao mesmo ponto (andou ' + Math.round(en.dx) + ' , ' + Math.round(en.dy) + ' mil)',
      'info', 9000);
  for (const rc of (res.recusados || [])) HubDialog.toast('recusado: ' + rc.porque, 'warn', 9000);
  if (typeof aoAplicar === 'function') aoAplicar({ refs: refs, componente: para, res: res });

  /* a troca ja vale na folha; agora, se foi pedido la em cima, o desenho vai para a
     BIBLIOTECA — e dali em diante o simbolo deixa de nascer como quadrado vermelho */
  if (atribuir) await gravaDesenhoNaBiblioteca(emg, para);
}

/* Espelho do usarSimboloEscolhido, ao contrario: rele o disco (a aba Biblioteca do hub
   grava no mesmo arquivo), tira a linha daquele `from`, valida, grava e aplica sem F5.
   Voltar a ficar SEM simbolo e um resultado legitimo de quem pediu para desfazer — e por
   isso e dito com todas as letras antes e depois, senao parece que a remocao falhou. */
async function desfazerEscolha(comp){
  const de = comp && comp.sym;
  if (!de) return;
  if (!HubIO.canPost){
    await HubDialog.alert('Sem servidor: abra o hub por hubserver.py para apagar a escolha.',
                          { title: 'não dá para gravar' });
    return;
  }
  const REL = 'Libs/lib-subs.js';
  let atuais = [];
  try {
    const txt = await HubIO.fetchText(REL);
    atuais = new Function(txt + ';return typeof libSubs !== "undefined" ? libSubs : [];')() || [];
  } catch (e) {
    atuais = (typeof libSubs !== 'undefined' && Array.isArray(libSubs)) ? libSubs.slice() : [];
  }
  const alvo = atuais.find(r => r && r.kind !== 'fp' && r.from === de);
  if (!alvo){
    HubDialog.toast('não há escolha gravada para "' + de + '" em ' + REL, 'warn');
    return;
  }
  const nat = HubCore.resolveSym(SLIB, de, tabelasSemEscolha(de));
  const natNome = (nat && nat.item && nat.item.name) || '';
  const quantos = contaSym(de);
  const fim = natNome
    ? 'Sem ela, "' + de + '" volta a resolver em "' + natNome + '".'
    : 'Sem ela, "' + de + '" não resolve em componente nenhum: o item da folha vira um quadrado '
      + 'vermelho e sai da extração de nets.';
  if (!(await HubDialog.confirm(
        'Remover a escolha "' + de + '" → "' + alvo.to + '"? ' + fim
        + (quantos > 1 ? ' ' + quantos + ' componentes deste projeto mudam junto.' : ''),
        { title: 'desfazer a escolha', ok: 'Remover', danger: !natNome }))) return;

  const nova = atuais.filter(r => !(r && r.kind !== 'fp' && r.from === de));
  const out = HubCore.serializeLibSubs(nova);
  if (out.errors.length){
    await HubDialog.alert(out.errors.map(e => e.msg).join('\n'), { title: 'lib-subs.js inválido' });
    return;
  }
  const r = await HubIO.saveFile(REL, out.text);
  if (!r || r.ok === false){
    await HubDialog.alert((r && r.msg) || 'o servidor recusou a gravação', { title: 'não salvou' });
    return;
  }
  /* aplica sem recarregar: um F5 aqui jogaria fora edicao nao salva da folha */
  HubCore.setLibTables(typeof renameMap !== 'undefined' ? renameMap : null, nova);
  if (symModalAberto() && symAlvo && symAlvo.sym === de) fechaSymModal();
  reapply();
  const quantosTxt = quantos > 1 ? ' (' + quantos + ' componentes)' : '';
  HubDialog.toast(natNome
    ? 'escolha removida — "' + de + '" volta a resolver em "' + natNome + '"' + quantosTxt
    : 'escolha removida — "' + de + '" agora está SEM componente na biblioteca, como você pediu' + quantosTxt,
    natNome ? 'ok' : 'warn');
}

/* Copiar texto numa página servida por HTTP simples.

   `navigator.clipboard` só existe em contexto seguro. Na bancada o hub abre em
   http://localhost, que O É — então um copiar escrito só com ele funciona aqui e some no
   servidor (http://192.168.15.192:8100 não é contexto seguro), que é o jeito mais chato de
   um defeito nascer: invisível justamente onde se testa. O execCommand é o caminho que
   funciona nos dois, e fica sendo o fallback enquanto o hub não tiver HTTPS. */
async function copiaTexto(txt, oque, alvo){
  if (!txt) return;
  if (window.isSecureContext && navigator.clipboard){
    try { await navigator.clipboard.writeText(txt); HubDialog.toast(oque + ' copiado', 'ok', 1600); return; }
    catch (e){ /* permissão negada ou aba sem foco: cai no de baixo */ }
  }
  const ta = document.createElement('textarea');
  ta.value = txt;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed; top:-1000px; left:0; opacity:0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, txt.length);          // iOS ignora o select() sozinho
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e){ ok = false; }
  document.body.removeChild(ta);
  if (ok){ HubDialog.toast(oque + ' copiado', 'ok', 1600); return; }
  /* Sem clipboard e sem execCommand sobra o Ctrl+C — mas mandar usar Ctrl+C sem deixar
     nada selecionado e pedir o impossivel, ainda mais porque o textarea de cima ja saiu
     do DOM. Entao a selecao vai para o proprio texto na tela. */
  if (alvo && window.getSelection){
    const r = document.createRange();
    r.selectNodeContents(alvo);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  HubDialog.toast('não deu para copiar sozinho — o ' + oque + ' está selecionado, use Ctrl+C', 'warn', 4000);
}

/* detail > 1 e o clique duplo: com user-select:all ele serve para SELECIONAR o nome, e
   copiar de novo so empilharia um segundo balao por cima do primeiro */
$('symNome').addEventListener('click', ev => {
  if (ev.detail > 1) return;
  copiaTexto($('symNome').textContent, 'nome', $('symNome'));
});
$('symClose').addEventListener('click', fechaSymModal);
$('symUsar').addEventListener('click', usarSimboloEscolhido);
$('symBusca').addEventListener('input', symRenderLista);
$('symEditar').addEventListener('click', editarSimboloNoHub);
$('symFiltros').addEventListener('click', e => {
  const b = e.target.closest('.ap-f'); if (!b) return;
  apFiltro = b.dataset.f;
  for (const x of $('symFiltros').querySelectorAll('.ap-f'))
    x.setAttribute('aria-pressed', String(x === b));
  symRenderLista();
});
$('symmodal').addEventListener('mousedown', e => { if (e.target === $('symmodal')) fechaSymModal(); });

/* ------- teclado ------- */
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (symModalAberto()){ fechaSymModal(); return; }
    if (addOpen()){ closeAdd(); return; }
    if (wireDraw){ wireDraw = null; cam.draw(); return; }
    if (tool !== 'select'){ setTool('select'); return; }
    if (mouse){
      if (mouse.mode === 'move') applyMove(mouse.base, 0, 0);
      mouse = null; boxRect = null; swallowClick = true; cam.draw(); return;
    }
    /* Escape e o botao de panico: larga a selecao E o foco de net. Enquanto largava so a
       selecao, a folha ficava laranja sem nada marcado — a "cor travada". */
    if (sel.size || selNet) limpaSel();
    return;
  }
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (addOpen() || symModalAberto()) return;   /* os atalhos da folha nao valem dentro do modal */
  if (capturandoAtalho) return;                /* a aba Atalhos esta ouvindo a proxima tecla */
  const acao = ATALHOS.porTecla[normalizaTecla(e)];
  if (!acao) return;
  /* O ESPACO COM UM BOTAO EM FOCO ja se resolve sozinho, e MEDIDO no Chrome: com selecao, o
     `e.preventDefault()` da linha de girar cancela a ativacao nativa do botao (o componente
     gira 0->90 e o olho da grade nao pisca); sem selecao aquela linha nao pega e o Espaco
     volta a ser o clique do botao, que e o que se espera. Houve aqui uma guarda que devolvia
     cedo quando o foco estava num <button> — ela trocava uma coisa pela outra: o botao era
     reacionado e a selecao NAO girava.
     Por isso o preventDefault e do ESPACO-com-selecao e dos Ctrl, nao de todo atalho. */
  const t = ATALHOS.porAcao[acao] || '';
  if (t.indexOf('Ctrl') === 0 || (t === 'Espaço' && sel.size)) e.preventDefault();
  if (fazAcao(acao) === false) return;
});
/* O QUE CADA AÇÃO FAZ. Separado do teclado de proposito: a aba Atalhos precisa saber o nome e
   a tecla, e o teclado precisa saber o que executar — sem esta tabela as duas coisas voltariam
   a ser duas copias escritas a mao, que foi o que fez a dica do painel mentir por meses. */
function fazAcao(id){
  switch (id){
    case 'add':       openAdd(); return;
    case 'fio':       setTool(tool === 'wire' ? 'select' : 'wire'); return;
    case 'terra':     setTool(tool === 'power' && toolPower && toolPower.net === 'GND' ? 'select' : 'power',
                              { net:'GND', style:'GndPower', rot:270 }); return;
    case 'rotulo':    if (tool === 'label'){ setTool('select'); hideNetForm(); } else openNetForm(); return;
    case 'noerc':     setTool(tool === 'noerc' ? 'select' : 'noerc'); return;
    case 'girar':     if (sel.size) rotateSel(); else return false; return;
    case 'espelhoX':  if (sel.size) mirrorSel('x'); else return false; return;
    case 'espelhoY':  if (sel.size) mirrorSel('y'); else return false; return;
    case 'apagar':    deleteSel(); return;
    case 'enquadrar': cam.fit(fitBBox()); return;
    case 'grade':     $('btnGrid').click(); return;
    case 'desfazer':  undo(); return;
    case 'refazer':   redo(); return;
    case 'tudo':      selectOnly(sheetItems()); return;
  }
  return false;
}
/* O schematic.js do disco ainda e o que esta aba tem?

   `schDiskSnapshot` guarda os bytes EXATOS da ultima leitura ou da ultima gravacao, entao a
   comparacao responde isso sem margem. Ela existe porque o aviso do hubserver e um contador
   de versao e nao diz QUAL arquivo mudou (hubserver.py » /__events manda so o numero).

   Falha de leitura responde NAO: um erro de rede nao e motivo para recarregar a pagina por
   cima do que a pessoa esta fazendo. Sem servidor (file://) nao ha disco que mude por baixo. */
async function schemaDoDiscoMudou(){
  if (!HubIO.canPost) return false;
  let atual;
  try { atual = await HubIO.fetchText(SCH_REL); }
  catch (e) { return false; }
  if (schDiskSnapshot === null){ schDiskSnapshot = atual; return false; }   /* sem base: adota e segue */
  return atual !== schDiskSnapshot;
}
window.__hubOnChange = function(){
  /* COM O MODAL ABERTO a página não pode recarregar. O "Editar símbolo ↗" abriu o editor numa
     aba própria justamente para esta ficar de pé; recarregar aqui fecharia o modal e o usuário
     salvaria lá para perder a tela de cá. Recarrega a BIBLIOTECA e redesenha o modal. */
  if (symModalAberto()){
    window.__hubRecarregaLibs().then(atualizaModalDaBiblioteca, atualizaModalDaBiblioteca);
    return;
  }
  /* FOI ESTA ABA QUE MUDOU O DISCO? O aviso chega igual para uma biblioteca regerada, para
     outro projeto e para o schematic.js que ESTA aba acabou de gravar — e no ultimo caso
     recarregar nao traz nada (o disco e exatamente o que esta na tela) e leva junto o
     enquadramento, a selecao e a pilha do desfazer. Medido: dois segundos depois de CADA
     Salvar a folha piscava e voltava do zero, e era o proprio Salvar que a derrubava. */
  schemaDoDiscoMudou().then(mudou => {
    if (!mudou){
      /* o schematic.js do disco e o nosso: o que mudou foi outra coisa. A biblioteca se
         recarrega NO LUGAR — o __hubRecarregaLibs passa pelo reapply — e a folha fica onde
         esta, com o zoom, a selecao e o desfazer intactos. */
      window.__hubRecarregaLibs().catch(() => {});
      return;
    }
    if (!schDirty){ HubDialog.ocioso().then(() => location.reload()); return; }
    comEdicaoPendente();
  });
};
/* O disco mudou DE VERDADE e ha edicao pendente aqui: a pagina nao pode recarregar, mas a
   BIBLIOTECA pode — trocar o acervo por baixo do desenho nao custa uma linha do que o usuario
   fez. O que continua esperando o F5 e so o schematic.js, que brigaria com a tela. */
function comEdicaoPendente(){
  staleWorkspace = true;
  $('annmsg').textContent = '⚠ workspace mudou — conferindo a biblioteca…';
  window.__hubRecarregaLibs().then(r => {
    const lib = r.falhas.length ? 'biblioteca recarregada em parte (não veio ' + r.falhas.join(', ') + ')'
              : r.mudou ? 'biblioteca recarregada — ' + r.simbolos + ' componentes'
              : 'biblioteca conferida — nada mudou nela';
    /* O RODAPE FICA NA TELA depois que o toast passa, entao ele nao pode continuar pedindo
       F5 pelo que JA entrou sozinho: empurrar para o F5 e empurrar para perder o trabalho
       pendente, que e exatamente o que este caminho existe para proteger. Diga o que sobrou. */
    $('annmsg').textContent = (r.mudou ? '⚠ biblioteca já atualizada aqui' : '⚠ workspace mudou')
      + ' — só o schematic.js do disco espera F5';
    HubDialog.toast(lib + '. O schematic.js do disco só entra com F5: salve o que está pendente antes.', 'warn', 0);
  }, () => {
    $('annmsg').textContent = '⚠ workspace mudou — salve e recarregue (F5)';
    HubDialog.toast('O workspace mudou com edições pendentes aqui — salve e recarregue (F5).', 'warn', 0);
  });
}
window.__hubDirty = function(){ return schDirty; };
/* ------- aplicar vinculos vindos de fora -------
   Quem monta a lista e o modulo do Odoo; quem ESCREVE e esta vista, e nao por gentileza: o
   caminho passa pelo `commit()`, e e ele que empilha o desfazer, acende o "Salvar *" e
   repinta folha, painel e miniatura. Um modulo de fora que mexesse em `schematic.items`
   direto perderia os quatro, em silencio.

   Cada vinculo e { refs:[...], sym, comment, params, soParams }. `soParams` e o caminho do
   componente MULTI-PARTE: todo alias de valor do almoxarifado tem uma parte so, entao trocar
   o `sym` de um conector desenhado em 16 partes largaria 15 delas e a fiacao junto. Nesses
   a identidade e gravada (comment + params) e o desenho fica como esta — dito na tela, nao
   escondido.

   Recusa ANTES de tocar no modelo, nunca no meio: sym que nenhum acervo resolve viraria
   quadrado vermelho sem nada reclamar (o serializeSchematic so exige string nao vazia), e a
   sequencia aspas-dois-pontos em qualquer campo derruba a gravacao do arquivo INTEIRO. */
/* Ponte para o painel "Enviar para o Odoo": abrir o seletor de componente do almoxarifado
   para um designador da lista e, na confirmacao, gravar o vinculo no esquema. Devolve false
   quando o designador nao esta nesta folha — a lista vem do DISCO e pode citar componente
   que a vista aberta nao tem. */
window.__hubResolveParaLista = function(refs, aoAplicar, aoFechar){
  const lista = Array.isArray(refs) ? refs : [refs];
  let alvo = null;
  for (const s of model.sheets)
    for (const c of s.comps)
      if (!alvo && lista.indexOf(c.ref) >= 0) alvo = c;
  if (!alvo) return false;
  abrirEscolhaSimbolo(alvo, { vinculo: true, refs: lista, aoAplicar: aoAplicar,
                              aoFechar: aoFechar });
  return true;
};

window.__hubAplicaVinculos = function(vinculos){
  const lista = Array.isArray(vinculos) ? vinculos : [];
  if (!lista.length) return { ok:false, erro:'nada para aplicar' };

  const porRef = new Map();
  for (const s of model.sheets)
    for (const c of s.comps){
      if (!porRef.has(c.ref)) porRef.set(c.ref, []);
      porRef.get(c.ref).push(c);
    }
  const ruim = t => typeof t === 'string' && t.indexOf('":') >= 0;
  const planos = [], recusados = [];

  for (const v of lista){
    const nome = String((v && v.componente) || '').trim();
    const refs = (v && Array.isArray(v.refs)) ? v.refs.filter(r => porRef.has(r)) : [];
    if (!refs.length){ recusados.push({ componente:nome, porque:'nenhum designador deste vinculo esta na folha' }); continue; }
    if (!nome){ recusados.push({ componente:'?', porque:'vinculo sem componente' }); continue; }

    /* O COMPONENTE E RESOLVIDO AQUI, no espelho desta vista, e nao vem pronto do servidor.
       E o que garante que o vinculo grave exatamente o que o modal "Adicionar componentes"
       grava: mesmo `sym`, mesmo `comment`, mesmo `params` — pela MESMA funcao. Montar o
       params do outro lado seria uma segunda implementacao do formato, em outra linguagem,
       que so se descobre divergente no dia em que divergir. */
    const res = HubCore.resolveSym(SLIB, nome);
    if (!(res && res.item)){
      recusados.push({ componente:nome, porque:'nao existe em acervo nenhum aqui — o componente viraria um quadrado vermelho' });
      continue;
    }
    const alias = res.item;
    const valor = (alias.valores && alias.valores.length === 1) ? alias.valores[0] : null;
    if (!valor){
      recusados.push({ componente:nome, porque:'"' + nome + '" e uma FAMILIA do almoxarifado, nao um componente: nao da para saber o valor' });
      continue;
    }
    const comment = String(valor.label || '').replace(/"/g, "'");
    const params = paramsDoValor(valor);
    if (ruim(comment) || ruim(params)){
      recusados.push({ componente:nome, porque:'o texto tem a sequencia que o gravador do schematic.js recusa' });
      continue;
    }
    /* MULTI-PARTE NAO TROCA DE SIMBOLO, e quem decide isso e ESTA funcao, olhando a folha.
       Todo alias de valor do almoxarifado tem uma parte so; um conector desenhado em 16
       partes perderia 15 e a fiacao junto. Grava-se a identidade e o desenho fica.

       Isto era responsabilidade de quem chamava, e custou um projeto: o painel da BoM
       calculava `soParams` a partir do grupo, mas o caminho novo de "resolver pela lista do
       Odoo" nao calculava nada — e o CN4 de um DMB, com 4 partes, saiu com 2 (2026-09-15).
       A guarda mudou de lugar: o `porRef` daqui SABE quantas partes cada designador tem, e
       nenhum chamador precisa lembrar de uma regra que a folha ja responde. O `v.soParams`
       continua valendo para quem quer so a identidade mesmo sendo de uma parte. */
    let multiParte = false;
    for (const ref of refs)
      for (const c of porRef.get(ref))
        if ((c.part || 1) > 1 || porRef.get(ref).length > 1) multiParte = true;
    const soParams = !!v.soParams || multiParte;
    planos.push({
      refs, comment, params,
      sym: soParams ? null : (res.name || nome),
      soParams: soParams,
      multiParte: multiParte,
      /* resolveu, mas nao pelo nome exato: o lib-subs.js guarda escolhas GLOBAIS por nome e
         elas vencem o nome exato. Gravar "X" e a folha desenhar "Y" nao e erro de gravacao,
         e surpresa — e surpresa tem de sair na tela. */
      desvio: res.how !== 'exato' ? { como:res.how, vira:res.name } : null,
    });
  }
  if (!planos.length) return { ok:false, erro:'nenhum vinculo passou na conferencia', recusados };

  let itens = 0;
  const refsTocados = [], encaixes = [];
  for (const p of planos)
    for (const ref of p.refs){
      for (const c of porRef.get(ref)){
        /* ── O ENCAIXE ──
           Trocar o componente troca o DESENHO, e desenho novo poe os pinos noutro lugar em
           volta da MESMA ancora: os fios ficam onde estavam e a ligacao se desfaz sem uma
           linha de aviso, porque a extracao de nets casa por coordenada exata. Mede-se onde
           os pinos estavam, troca-se, mede-se de novo, e o componente inteiro anda o tanto
           que devolve o maior numero de pinos ao ponto antigo (encaixeDaTroca, no bloco puro).
           So faz sentido quando o SIMBOLO muda: com `soParams` o desenho fica o mesmo e nao
           ha nada a encaixar. */
        const antes = p.sym ? (HubCore.compPinsWorld(c, SLIB) || []) : null;
        if (p.sym) c.sym = p.sym;
        if (p.comment) c.comment = p.comment; else delete c.comment;
        if (p.params) c.params = p.params; else delete c.params;
        if (antes && antes.length){
          const depois = HubCore.compPinsWorld(c, SLIB) || [];
          const enc = encaixeDaTroca(antes, depois);
          if ((enc.dx || enc.dy) && enc.encaixa > 0){
            c.x = Math.round((c.x + enc.dx) * 1e4) / 1e4;
            c.y = Math.round((c.y + enc.dy) * 1e4) / 1e4;
            encaixes.push({ ref, dx:enc.dx, dy:enc.dy, encaixa:enc.encaixa, comuns:enc.comuns });
          }
        }
        itens++;
      }
      refsTocados.push(ref);
    }
  commit();
  limpaSel();
  return { ok:true, vinculos:planos.length, refs:refsTocados, itens, recusados, encaixes,
           soIdentidade: planos.filter(p => p.multiParte).map(p => p.refs.join(', ')),
           desvios: planos.filter(p => p.desvio).map(p => ({ refs:p.refs, sym:p.sym,
                                                             como:p.desvio.como, vira:p.desvio.vira })) };
};
window.__hubSelectComp = function(ref){
  for (const s of model.sheets){ const c = s.comps.find(c => c.ref === ref); if (c){ focusComp(c); return; } }
};
window.addEventListener('beforeunload', e => { if (schDirty){ e.preventDefault(); e.returnValue = ''; } });

/* ---------- paineis ---------- */
function focusComp(c){
  const si = model.sheets.findIndex(sh => sh.name === c.sheet);
  /* troca a folha SEM o limpaSel/enquadrar do setSheet: quem chama daqui ja traz a propria
     selecao (o componente) e o proprio enquadramento, logo abaixo */
  if (si >= 0 && si !== sheetIdx){ sheetIdx = si; pintaCartaoAtivo(); }
  selSo([alvoAll(c)]);
  /* a porta de entrada do hub (__hubSelectComp) tambem passa por aqui: nao pode deixar a net
     anterior acesa por baixo do componente novo */
  aplicaSel('');
  cam.fit({ x1:c.x-800, y1:c.y-800, x2:c.x+800, y2:c.y+800 });
}
function buildCompTable(){
  const tb = document.querySelector('#comptable tbody');
  tb.innerHTML = '';
  let n = 0;
  for (const s of model.sheets) for (const c of s.comps) {
    n++;
    const tr = document.createElement('tr');
    if (selTemItem(c)) tr.className = 'sel';
    for (const v of [c.ref, c.sym, c.footprint || '—', c.comment || '']) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    tr.addEventListener('click', () => focusComp(c));
    tb.appendChild(tr);
  }
  $('compcount').textContent = n;
}
function buildNetList(){
  $('netcount').textContent = nets.nets.length;
  const list = $('netlist');
  list.innerHTML = '';
  for (const n of nets.nets) {
    const div = document.createElement('div');
    div.className = 'netitem' + (n.name === selNet ? ' sel' : '');
    div.textContent = `${n.name}${n.auto ? ' (auto)' : ''} — ${n.pins.join(', ')}`;
    /* escolher a net pela lista tambem larga a selecao: um foco de cada vez na tela */
    div.addEventListener('click', () => { sel.clear(); aplicaSel(n.name === selNet ? '' : n.name); });
    list.appendChild(div);
  }
  netListDe = selNet;
}
function buildValList(){
  const list = $('vallist');
  list.innerHTML = '';
  const items = val.errors.map(m => ({ level:'err', m }))
    .concat(val.warnings.map(m => ({ level:'warn', m })))
    .concat(nets.warnings.map(m => ({ level:'warn', m })));
  if (!items.length) { list.innerHTML = '<div style="color:var(--ok)">✓ sem problemas</div>'; return; }
  for (const it of items) {
    const div = document.createElement('div');
    div.className = 'valitem ' + it.level;
    div.textContent = it.m;
    list.appendChild(div);
  }
}
/* ------- as folhas, em cartoes com miniatura -------
   Era um <select>: dizia o nome da folha e mais nada, e num projeto de duas folhas nao havia
   como saber qual era qual sem trocar e olhar. O cartao mostra a folha COMO ELA ESTA, com o
   mesmo desenho do canvas grande (desenhaFolha) — so sem grade, sem selecao e sem net em
   foco, que sao estado da folha ATIVA e vazariam para o cartao das outras.

   A miniatura NAO usa o mkCamera: ele registra wheel/mousedown/resize e um ResizeObserver
   sem dispose, entao uma camera por folha recriada a cada edicao vazaria um listener de
   janela por vez — e a roda do mouse sobre o cartao daria zoom nele em vez de rolar o
   painel. O caminho e o ctx.setTransform manual, o mesmo do drawTile do editor de simbolos. */
function renderSheetCards(){
  const box = $('sheetcards');
  if (!box) return;
  /* reconstruir com innerHTML='' descarta os nos E os listeners deles junto — e a razao de
     o clique estar delegado no container, registrado UMA vez (logo abaixo) */
  box.innerHTML = '';
  model.sheets.forEach((sh, i) => {
    const b = el('button', 'sheetcard' + (i === sheetIdx ? ' on' : ''));
    b.type = 'button';
    b.dataset.i = String(i);
    b.title = `folha ${sh.name} (${sh.size}) — ${(sh.comps || []).length} componente(s)`;
    /* a miniatura e o icone da linha; o nome e o resumo vao ao lado, numa coluna que
       encolhe (o .txt) para o ellipsis do nome ter onde acontecer */
    const txt = el('div', 'txt');
    txt.append(el('span', 'nm', sh.name),
               el('span', 'k', `${sh.size} · ${(sh.comps || []).length} comp.`));
    b.append(document.createElement('canvas'), txt);
    box.append(b);
  });
  pintaMiniaturas();
}
$('sheetcards').addEventListener('click', e => {
  const b = e.target.closest('.sheetcard');
  if (b) setSheet(+b.dataset.i);
});
/* O canvas de um cartao mede 0 enquanto a sub-aba Configuracoes esta fechada, e enquadrar
   numa largura 0 sai EM BRANCO sem erro nenhum (a escala vira Infinity). Um observador no
   CONTAINER resolve os dois casos de uma vez — a aba abrindo e a divisoria mudando a largura
   do painel — e e um so, permanente: os cartoes sao refeitos, o container nao. */
new ResizeObserver(pintaMiniaturas).observe($('sheetcards'));
function pintaCartaoAtivo(){
  for (const b of document.querySelectorAll('#sheetcards .sheetcard'))
    b.classList.toggle('on', +b.dataset.i === sheetIdx);
}
/* a folha ativa muda: larga a selecao (a net acesa era da folha antiga — levar o laranja
   junto pintaria fios de outra folha) e reenquadra */
function setSheet(i){
  if (!(i >= 0) || i >= model.sheets.length || i === sheetIdx) return;
  sheetIdx = i;
  pintaCartaoAtivo();
  /* O FIO EM CURSO E DA FOLHA ANTIGA. O endWire carimba o fio com a folha ATIVA no momento
     de fechar, entao trocar de folha no meio do tracado gravaria na folha nova os pontos
     clicados na velha. O Escape ja larga o fio assim; a troca de folha tinha de largar
     tambem. */
  wireDraw = null;
  limpaSel();
  cam.fit(fitBBox());
}
/* Desenha cada cartao. Canvas dentro de painel fechado mede 0 e sairia em branco SEM ERRO
   (a escala vira Infinity) — por isso a guarda do desenhaMiniatura so pinta o cartao que
   mediu. Quem repinta ao abrir a sub-aba e o ResizeObserver do #sheetcards, logo acima: o
   showPane tira o display:none do painel, o container sai de 0 e o observador dispara. */
function pintaMiniaturas(){
  document.querySelectorAll('#sheetcards .sheetcard canvas').forEach((cvm, i) => desenhaMiniatura(cvm, i));
}
function desenhaMiniatura(cvm, si){
  const W = cvm.clientWidth, H = cvm.clientHeight;
  if (!W || !H || !model.sheets[si]) return false;
  const DPR = window.devicePixelRatio || 1;
  cvm.width = Math.round(W * DPR); cvm.height = Math.round(H * DPR);
  const ctx = cvm.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#3a3a34';                       /* a mesma moldura do canvas grande */
  ctx.fillRect(0, 0, cvm.width, cvm.height);
  const bb = fitBBox(si);
  const esc = Math.min(W / Math.max(bb.x2 - bb.x1, 1), H / Math.max(bb.y2 - bb.y1, 1)) / 1.06;
  const cx = (bb.x1 + bb.x2) / 2, cy = (bb.y1 + bb.y2) / 2;
  /* a matriz Y-up do mkCamera, copiada: o mundo do esquema tem Y para cima */
  ctx.setTransform(DPR * esc, 0, 0, -DPR * esc, DPR * (W / 2 - cx * esc), DPR * (H / 2 + cy * esc));
  desenhaFolha(ctx, si, { grid:false, foco:'', esc });
  return true;
}
/* sub-abas do painel: a ultima aberta fica lembrada nesta maquina */
/* ------- a aba Atalhos -------
   A dica de atalhos morava na secao "Edicao" do painel, escrita a mao em <kbd>, e ja mentia:
   nao citava Ctrl+Y, Ctrl+A nem o Escape, e citava um X que fazia coisas diferentes conforme
   a rotacao do componente. Agora a lista SAI da tabela que o teclado le, e a tecla e
   trocavel — clicar no botao da tecla e pressionar a nova. O que o usuario grava fica nesta
   maquina, no mesmo molde de toda preferencia desta vista (localStorage, try/catch, padrao
   no codigo): uma chave estragada nao pode deixar a folha sem teclado nenhum. */
const ATALHOS_KEY = 'altiumhub.sch.atalhos';
let atalhosSalvos = {};
try { atalhosSalvos = JSON.parse(localStorage.getItem(ATALHOS_KEY) || '{}') || {}; } catch (e) { atalhosSalvos = {}; }
let ATALHOS = mapaAtalhos(atalhosSalvos);
let capturandoAtalho = false;
function gravaAtalhos(){
  ATALHOS = mapaAtalhos(atalhosSalvos);
  try { localStorage.setItem(ATALHOS_KEY, JSON.stringify(atalhosSalvos)); } catch (e) {}
  renderAtalhos();
}
function renderAtalhos(){
  const box = $('atalhoslist');
  if (!box) return;
  box.textContent = '';
  for (const a of ATALHOS_PADRAO){
    const linha = el('div', 'atalho');
    linha.append(el('span', 'atalho-nome', a.rotulo));
    const b = el('button', 'atalho-tecla', ATALHOS.porAcao[a.id]);
    b.type = 'button';
    b.title = 'clique e pressione a tecla nova';
    if (ATALHOS.porAcao[a.id] !== a.tecla) b.classList.add('mudado');
    b.addEventListener('click', () => {
      if (capturandoAtalho) return;
      capturandoAtalho = true;
      b.classList.add('ouvindo');
      b.textContent = 'pressione…';
      const ouve = ev => {
        ev.preventDefault(); ev.stopPropagation();
        const t = normalizaTecla(ev);
        if (!t) return;                       /* so o modificador: continua esperando */
        window.removeEventListener('keydown', ouve, true);
        capturandoAtalho = false;
        if (ev.key === 'Escape'){ renderAtalhos(); return; }   /* Escape desiste */
        const r = defineAtalho(atalhosSalvos, a.id, t);
        if (!r.ok){ HubDialog.toast(r.erro, 'warn'); renderAtalhos(); return; }
        atalhosSalvos = r.salvos;
        gravaAtalhos();
        HubDialog.toast(a.rotulo + ' → ' + t, 'ok');
      };
      window.addEventListener('keydown', ouve, true);
    });
    linha.append(b);
    box.append(linha);
  }
  const rest = $('atalhosReset');
  if (rest) rest.disabled = !Object.keys(atalhosSalvos).length;
}

/* ------- o passo da grade ------- */
function montaGrade(){
  const seu = $('gridsel');
  if (!seu) return;
  seu.textContent = '';
  for (const g of GRADES){
    const o = document.createElement('option');
    o.value = g.id; o.textContent = g.rotulo;
    if (g.id === grade.id) o.selected = true;
    seu.append(o);
  }
  seu.onchange = () => {
    grade = gradePorId(seu.value);
    try { localStorage.setItem(VER_GRADE_KEY, grade.id); } catch (e) {}
    /* o ima anda com a grade (snapMil), entao trocar o passo muda os dois de uma vez */
    cam.draw(); pintaMiniaturas();
    HubDialog.toast('grade: ' + grade.rotulo + ' · ímã ' + Math.round(snapMil()) + ' mil', 'info', 2500);
  };
}

/* Os paineis saem da propria lista de abas, e nao de uma linha por id: era assim que uma aba
   nova nascia acesa no rodape e com o painel do vizinho na tela — a mesma armadilha que o
   modal de configuracao da casca ja documenta em hub.html. */
const PANES = Array.from(document.querySelectorAll('#side .subtab')).map(b => b.dataset.pane);
function showPane(id){
  if (PANES.indexOf(id) < 0) id = PANES[0];
  document.querySelectorAll('#side .subtab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pane === id)));
  for (const p of PANES){ const el0 = $('pane-' + p); if (el0) el0.classList.toggle('on', p === id); }
  try { localStorage.setItem('schframe.pane', id); } catch (e) {}
}
document.querySelectorAll('#side .subtab').forEach(b => b.addEventListener('click', () => showPane(b.dataset.pane)));
let pane0 = 'comps';
try { pane0 = localStorage.getItem('schframe.pane') || 'comps'; } catch (e) {}
showPane(pane0);

/* ------- divisorias dos dois paineis -------
   Mesmo gesto das abas Laser e BOM do hub: arrastar redimensiona, soltar perto da borda
   fecha, duplo clique fecha/abre. A largura fica lembrada nesta maquina. O canvas nao
   precisa de aviso: o mkCamera observa o proprio elemento e redesenha quando ele muda —
   so os previews da ficha e que precisam refazer o enquadramento. */
const SIDE_SNAP = 90, SIDE_VIEW_MIN = 240;   /* os mesmos limites do hub */
function mkPainel(o){
  let larg = o.padrao;
  try { const v = localStorage.getItem(o.chave); if (v !== null && isFinite(+v)) larg = Math.max(0, +v); } catch (e) {}
  const aplica = () => {
    document.documentElement.style.setProperty(o.varCss, larg + 'px');
    /* o painel da esquerda some pela propria largura; o da direita nao — la quem manda em
       estar na tela e o [hidden], que segue a selecao, e display inline atropelaria isso */
    if (!o.porHidden) $(o.el).style.display = larg ? '' : 'none';
    if (o.aoMudar) o.aoMudar(larg);
  };
  const salva = () => { try { localStorage.setItem(o.chave, String(larg)); } catch (e) {} };
  const sp = $(o.split);
  sp.addEventListener('pointerdown', e => {
    const total = $('main').getBoundingClientRect().width;
    const teto = Math.max(SIDE_SNAP, total - SIDE_VIEW_MIN - 12);
    const x0 = e.clientX, w0 = larg;
    sp.classList.add('on');
    sp.setPointerCapture(e.pointerId);
    /* o painel da direita cresce para o lado contrario do ponteiro */
    const move = ev => { const w = w0 + (ev.clientX - x0) * (o.lado === 'r' ? -1 : 1);
                         larg = w < SIDE_SNAP ? 0 : Math.min(w, teto); aplica(); };
    const up = () => {
      sp.classList.remove('on');
      sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); sp.removeEventListener('pointercancel', up);
      salva();
    };
    sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up); sp.addEventListener('pointercancel', up);
    e.preventDefault();
  });
  sp.addEventListener('dblclick', () => { larg = larg ? 0 : o.padrao; aplica(); salva(); });
  aplica();
  return { larg: () => larg, abre(){ if (!larg){ larg = o.padrao; aplica(); salva(); } } };
}
mkPainel({ chave:'schframe.sideW', varCss:'--side-w', el:'side', split:'split', padrao:330, lado:'l' });
/* arrastar a divisoria da ficha ate o fim e o mesmo que soltar o alfinete: some agora e
   volta quando alguma coisa for selecionada (ou pelo botao de paineis) */
painelProps = mkPainel({ chave:'schframe.propsW', varCss:'--props-w', el:'props', split:'splitR',
  padrao:320, lado:'r', porHidden:true,
  aoMudar: w => { if (!w && propsPin){ propsPin = false; salvaPin(); } mostraProps(); } });
mostraProps();

$('btnFit').addEventListener('click', () => cam.fit(fitBBox()));
/* o mesmo olho da Biblioteca: aberto = aparece, riscado = suprimido */
const OLHO    = 'M1.5 8 C3.5 4.6 5.8 3 8 3 C10.2 3 12.5 4.6 14.5 8 C12.5 11.4 10.2 13 8 13 C5.8 13 3.5 11.4 1.5 8 Z';
const OLHO_X  = 'M2.5 13.5 L13.5 2.5';
function pintaOlhoComment(){
  const b = $('btnComment'), on = showState.comment;
  b.classList.toggle('active', on);
  b.setAttribute('aria-pressed', String(on));
  b.title = on ? 'Comment visível — clique para suprimir'
               : 'Comment suprimido — clique para mostrar';
  b.innerHTML = '<svg viewBox="0 0 16 16"><path d="' + OLHO + '"/><circle cx="8" cy="8" r="2.2"/>'
              + (on ? '' : '<path d="' + OLHO_X + '"/>') + '</svg>';
}
$('btnComment').addEventListener('click', () => {
  showState.comment = !showState.comment;
  try { localStorage.setItem(VER_COMMENT_KEY, showState.comment ? '1' : '0'); } catch (e) {}
  /* o cartao herda estes dois (sao preferencia de vista, nao estado da folha ativa), e
     estes botoes so repintavam o canvas grande: sem isto o icone fica com o estado antigo
     ate a proxima edicao */
  pintaOlhoComment(); cam.draw(); pintaMiniaturas();
});
pintaOlhoComment();
/* mesmo idioma do olho do comment: aceso = a vista manda, riscado = o simbolo manda */
function pintaOlhoPinos(){
  const b = $('btnPinNames'), on = showState.pinos;
  b.classList.toggle('active', on);
  b.setAttribute('aria-pressed', String(on));
  b.title = on ? 'Nomes e numeros de pino visiveis — clique para obedecer o simbolo'
               : 'Pino escondido pelo simbolo fica escondido (como no Altium) — clique para mostrar tudo';
  b.innerHTML = '<svg viewBox="0 0 16 16"><path d="M1 8h4.5"/><path d="M7.5 5h7M7.5 8h7M7.5 11h4.5"/>'
              + (on ? '' : '<path d="' + OLHO_X + '"/>') + '</svg>';
}
$('btnPinNames').addEventListener('click', () => {
  showState.pinos = !showState.pinos;
  try { localStorage.setItem(VER_PINOS_KEY, showState.pinos ? '1' : '0'); } catch (e) {}
  pintaOlhoPinos(); cam.draw(); pintaMiniaturas();
});
pintaOlhoPinos();
$('btnGrid').addEventListener('click', () => {
  showState.grid = !showState.grid; $('btnGrid').classList.toggle('active', showState.grid); cam.draw();
});
$('atalhosReset').addEventListener('click', () => {
  atalhosSalvos = {};
  gravaAtalhos();
  HubDialog.toast('atalhos de volta ao padrão', 'ok');
});
montaGrade(); renderAtalhos();
renderSheetCards(); buildCompTable(); buildNetList(); buildValList();
updateMeta(); updateSaveBtn(); updateSelStatus(); cartRender(); renderProps();
cam.resize(); cam.fit(fitBBox());

})();
