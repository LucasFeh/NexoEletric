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
  /* NAO sao acervo: os templates de folha (hub-schtemplate.js le os globais a cada desenho).
     Recarregar traz o template que outra pessoa acabou de salvar no editor */
  { src:'Libs/sch-templates.js',      nome:'schtemplates' },
  { src:'Libs/sch-templates-casa.js', nome:'schtemplatesCasa' },
  /* NAO e acervo: os footprints do editor de footprint do hub, que passam na frente dos do
     Altium com o mesmo nome (aplicaAcervos » PLIB) */
  { src:'Libs/pcblib-hub.js',       nome:'pcblibHub', opcional:true },
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

/* ── AS PARTES DE UM COMPONENTE, em qualquer acervo ──
   Um componente de várias partes (um relé com bobina e contatos, um amplificador duplo) é uma
   lista de partes, cada uma com o seu desenho. Na biblioteca do Altium quem tem as partes é o
   SÍMBOLO. No almoxarifado a família tem uma parte só (tests/test-almoxlib.js), e quem pode ter
   várias é o VALOR: o "+ parte" do editor de símbolos grava `valores[].parts`. `partesDe` é o
   desenho que a FOLHA vai usar para aquele componente — o do valor quando ele tem o seu, senão o
   da família —, e é a mesma regra do alias por valor logo abaixo: o modal que escolhe a parte e a
   folha que a desenha não podem contar partes diferentes. */
function partesDe(s, v){
  return (v ? (v.parts || (s && s.parts)) : (s && s.parts)) || [];
}
function nPartes(s, v){
  if (v) return partesDe(s, v).length || 1;
  return (s && (s.partcount || (s.parts || []).length)) || 1;
}

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
      /* a geometria da familia, compartilhada — a nao ser que o VALOR traga a dele: e assim
         que o PNP deixa de ser desenhado com a seta do NPN sem partir a familia em duas. E o
         partcount e o do desenho que ficou: um valor desenhado em duas partes tem duas, e o 1
         cravado fazia a ficha e o "Adicionar componentes" esconderem a segunda. */
      const partes = partesDe(sy, v);
      const alias = {
        name: v.altium, description: (v.itens && v.itens[0] && v.itens[0].nome) || v.label,
        designator: sy.designator, familia: sy.familia, partcount: partes.length || 1,
        parts: partes,
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

/* ── O VALOR DO COMPONENTE, que é metade do "mesmo tipo" ──
   Até 2026-09-16 "mesmo tipo" era só o `sym`. No PRJ-UR-DI261924 isso quer dizer que os
   24 componentes de `RES [ SMD ]` são o mesmo tipo — 10K, 1K, 2K2 e 15R juntos — e trocar
   o 10K trocava os quatro valores de uma vez. O usuário pediu o corte certo: trocar um
   resistor troca os que TAMBÉM têm o mesmo valor.

   De onde sai o valor, nesta ordem e por medição nos 8 projetos da casa:

   1. o parâmetro `Value` do componente. É o dado dos espelhos novos, e é exato
      (`params:"Value=10K"`). O `comment` NÃO serve aqui: nesses mesmos projetos ele é a
      fórmula do Altium por resolver (`"=Value + ' - ' + Potência"`), igual nos 24;
   2. o `comment`, mas SÓ em designador R… ou C… — resistor e capacitor, que foi o pedido.
      É o que faz a regra valer também nos espelhos antigos (SHP2, PRJ-DI221694D), onde
      não há `Value` e o comment é mesmo o valor ("2k2", "0,1uF");
   3. nada. E aí o alcance volta a ser o de hoje, o símbolo inteiro.

   O passo 2 é limitado a R e C DE PROPÓSITO. Solto, ele parte o que não é valor: medido,
   quebraria `TEST POINT` em 2 grupos pelo rótulo, `MSTBH 12 Pin` em 28 pelo nome da net e
   `CONE PADRAO` em 6 pela descrição — e trocar um conector deixaria os outros 27 para
   trás. Com o limite, 63 grupos ficam inteiros e só resistor e capacitor se dividem. */
const RE_VALUE = /(?:^|;)\s*Value\s*=\s*([^;]*)/i;
const RE_REF_RC = /^[RC]\d/i;
function _normValor(t){ return String(t == null ? '' : t).trim().replace(/\s+/g, ' ').toLowerCase(); }
function valorDoComp(c){
  if (!c) return '';
  const m = RE_VALUE.exec(String(c.params || ''));
  if (m) return _normValor(m[1]);
  if (RE_REF_RC.test(String(c.ref || ''))){
    const cm = String(c.comment || '').trim();
    /* fórmula do Altium por resolver não é valor: ela é IGUAL nos 24 resistores */
    if (cm && cm.charAt(0) !== '=') return _normValor(cm);
  }
  return '';
}
/* A chave do "mesmo tipo e mesmo valor". O \u0000 separa porque não existe em nome de
   símbolo nem em valor — concatenar sem ele faria "RES"+"10K" casar com "RES1"+"0K". */
function tipoDoComp(c){
  return c ? String(c.sym || '') + '\u0000' + valorDoComp(c) : '';
}

/* Estado ja medido -> o que a ficha e o modal mostram. Campos de entrada:
   `sym`   nome do simbolo em que o componente resolveu, ou null/'' se nao resolveu;
   `how`   como resolveu (HubCore.resolveSym);
   `quantos` componentes DESTE projeto com o mesmo comp.sym;
   `quantosValor` componentes com o mesmo comp.sym E o mesmo valor (veja valorDoComp).
     Ausente = igual a `quantos`, que é o caso de quem não tem valor nenhum declarado;
   `valor`   o valor em si, para escrever na tela ("10K"). Vazio quando não há;
   `escopo`  'valor' (o padrão), 'tipo' ou 'um' — veja o bloco ALCANCE abaixo;
   `todos`   compatibilidade: false é o mesmo que escopo 'um';
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
  /* sem valor declarado os dois números são o mesmo, e aí a tela não fala de valor */
  const quantosValor = Math.min(quantos, Math.max(0, Math.trunc(
    e.quantosValor == null ? quantos : e.quantosValor)));
  const valor = String(e.valor == null ? '' : e.valor).trim();
  const temValor = !!valor && quantosValor < quantos;
  let escopo = ['um', 'valor', 'tipo'].indexOf(e.escopo) >= 0
    ? e.escopo : (e.todos === false ? 'um' : 'valor');
  /* único do seu valor: "trocar os 1 com valor 4.7 uF" e "trocar só este designador" são a
     MESMA coisa escrita duas vezes, e a primeira ainda sai com o plural errado. Some uma. */
  const valorEhUm = temValor && quantosValor <= 1;
  if (escopo === 'valor' && valorEhUm) escopo = 'um';
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
    alcance: 0,
  };
  /* O ALCANCE, em três viradas.
     Em 2026-09-15 a troca deixou de ir para o lib-subs.js: aquilo era substituição GLOBAL
     por nome de símbolo, valia em TODOS os projetos e não aparecia em lugar nenhum — o
     usuário pediu o fim disso com todas as letras ("um componente não pode influenciar
     outro de designador diferente"), e o alcance virou um designador só.
     Em 2026-09-16 ele pediu o meio-termo: trocar um troca TODOS do mesmo tipo NESTE
     projeto. Não é a volta do lib-subs — continua sendo edição do schematic.js deste
     projeto, visível no arquivo e desfeita com um Ctrl+Z.
     No mesmo dia veio o corte que faltava: "mesmo tipo" era só o `sym`, e no
     PRJ-UR-DI261924 os 24 `RES [ SMD ]` são 10K, 1K, 2K2 e 15R juntos — trocar o 10K
     trocava os quatro valores. Agora o padrão é MESMO TIPO E MESMO VALOR, e o símbolo
     inteiro continua ao alcance de um clique, dito com o número na frente.

     Os três escopos saem daqui prontos (`d.escopos`), com rótulo e contagem: a tela só
     desenha o que esta função decidiu, e a regra se prova sem navegador. */
  d.escopo = escopo;
  d.escopos = [];
  if (quantos > 1){
    if (temValor){
      if (!valorEhUm)
        d.escopos.push({ id:'valor', n:quantosValor,
                         rotulo:'trocar os ' + quantosValor + ' com valor ' + valor });
      d.escopos.push({ id:'tipo', n:quantos,
                       rotulo:'trocar os ' + quantos + ' deste tipo, qualquer valor' });
    } else {
      d.escopos.push({ id:'valor', n:quantos,
                       rotulo:'trocar os ' + quantos + ' componentes deste tipo' });
    }
    d.escopos.push({ id:'um', n:1, rotulo:'trocar só este designador' });
  }
  d.alcance = escopo === 'um' ? Math.min(quantos, 1)
            : escopo === 'tipo' ? quantos
            : quantosValor;
  if (escopo === 'um' && valorEhUm){
    d.impacto = 'muda só este designador — é o único de valor ' + valor + ' no projeto, '
              + 'entre os ' + quantos + ' deste símbolo';
    d.impactoAlerta = false;
  } else if (escopo === 'um' && quantos > 1){
    d.impacto = 'muda só este designador; os outros ' + (quantos - 1)
              + ' componentes deste tipo ficam como estão';
    d.impactoAlerta = false;
  } else if (escopo === 'tipo' && quantos > 1){
    d.impacto = 'muda os ' + quantos + ' componentes deste símbolo no projeto — TODOS os '
              + 'valores junto' + (temValor ? ', e não só os ' + quantosValor + ' de '
              + valor : '') + '; escolha abaixo para reduzir';
    d.impactoAlerta = true;
  } else if (escopo === 'valor' && temValor && quantosValor > 1){
    d.impacto = 'muda os ' + quantosValor + ' componentes deste tipo com valor ' + valor
              + ' — os outros ' + (quantos - quantosValor) + ' deste símbolo, de outro '
              + 'valor, ficam como estão';
    d.impactoAlerta = true;
  } else if (quantos > 1){
    d.impacto = 'muda os ' + quantos + ' componentes deste tipo no projeto, com designador '
              + 'diferente ou não — escolha abaixo para trocar só este';
    d.impactoAlerta = true;
  } else if (quantos === 1){
    d.impacto = 'muda só este designador — é o único deste tipo no projeto';
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
/* O fio debaixo do ponto: o primeiro trecho a ate max(tol,20) mil, e o vertice quando o ponto
   esta a ate max(tol,22) de uma ponta DESSE trecho. O vertice ganha do trecho porque a alcinha
   e menor e quem a mira esta querendo justamente o canto. Morava dentro do hitTest; saiu para
   ca porque o modo "so fios" da barra usa a MESMA conta sem o resto da fila (pino, designador,
   corpo), e a fila do modo normal tem de continuar pegando exatamente o fio que pegava.
   Devolve { wi, seg, vert } (vert = null fora da alcinha) ou null. */
function fioNoPonto(wires, x, y, tol){
  const rs = Math.max(tol || 0, 20), rv = Math.max(tol || 0, 22);
  for (let wi = 0; wi < (wires || []).length; wi++){
    const pts = wires[wi].pts || [];
    for (let i = 0; i < pts.length - 1; i++)
      if (distPS(x, y, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]) <= rs){
        const vert = Math.hypot(x - pts[i][0], y - pts[i][1]) <= rv ? i
                   : Math.hypot(x - pts[i+1][0], y - pts[i+1][1]) <= rv ? i + 1 : null;
        return { wi, seg:i, vert };
      }
  }
  return null;
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
/* Em que eixos o trecho i anda ('xy', so 'x' ou so 'y'). E a regra de cima, numa funcao so,
   porque tres lugares precisam dela e tem de concordar: o moveSegmento (que move), as guias (que
   nao podem prometer guia no eixo travado) e o Shift (que nao pode prender o unico eixo que
   anda — o trecho congelava e a barra dizia "so na horizontal" de um trecho que so anda em Y). */
function eixosDoTrecho(pts, i){
  const a = (pts || [])[i], b = (pts || [])[i + 1];
  if (!a || !b || pts.length === 2) return 'xy';
  const horiz = Math.abs(b[1] - a[1]) <= STOL_SCH && Math.abs(b[0] - a[0]) > STOL_SCH;
  const vert  = Math.abs(b[0] - a[0]) <= STOL_SCH && Math.abs(b[1] - a[1]) > STOL_SCH;
  return horiz ? 'y' : vert ? 'x' : 'xy';
}
function moveSegmento(pts, i, dx, dy){
  const out = (pts || []).map(p => [p[0], p[1]]);
  const a = out[i], b = out[i+1];
  if (!a || !b) return out;
  const ex = eixosDoTrecho(out, i);
  const ux = ex.indexOf('x') >= 0 ? dx : 0, uy = ex.indexOf('y') >= 0 ? dy : 0;
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

/* ── O D: O COMPONENTE ARRASTADO VAI ATE OS FIOS ALINHADOS ──
   Pedido do dono (2026-10-09): "se quando eu estiver movimentando um componente entre 2 trilhas
   e o canvas identificar que existe centralizacao entre os pinos e as 2 trilhas eu posso aperta
   'D' no teclado e o componente e roteado automaticamente". A centralizacao e a guia pino↔fio
   que o arrasto ja mostra: o pino no mesmo X ou no mesmo Y da PONTA SOLTA de um fio. O D pousa
   o componente e estica cada fio ate o seu pino, num trecho reto. Nao ha desvio de obstaculo
   nem L ate pino desalinhado: ai e a mao que sabe o caminho.
   Tres contas: as pontas soltas (uma vez por gesto), os pares (a cada quadro, no pouso) e o fio
   esticado (no D). */

/* As pontas SOLTAS: pts[0] e pts[n-1] de cada fio que nao encostam em nada eletrico. Isso exclui
   pino, juncao, power e port (`pontos`, que o chamador entrega) e vertice ou trecho de fio,
   inclusive do proprio: o fio fechado em anel nao tem ponta solta. Rotulo de net nao liga, e por
   isso nao vem em `pontos`. `fios` sao so os PARADOS, porque o que viaja no gesto nao e ponta de
   ninguem. Devolve { wi, i, x, y }: o indice do fio em `fios`, o da ponta e onde ela esta.
   Roda no primeiro quadro de cada arrasto, e toda ponta contra todo trecho custava 50 ms na folha
   maior do acervo (SHP2, 722 fios): ponto e trecho vao num balde de 1000 mil, como na
   topologiaFolha, cada um em toda celula que a sua caixa alargada de STOL_SCH toca. Assim tudo o
   que encosta numa ponta esta na celula dela. */
function pontasSoltas(fios, pontos){
  const out = [], F = fios || [], CEL = 1000, balde = new Map();
  const poe = (x1, y1, x2, y2, v) => {
    for (let cx = Math.floor((x1 - STOL_SCH) / CEL); cx <= Math.floor((x2 + STOL_SCH) / CEL); cx++)
      for (let cy = Math.floor((y1 - STOL_SCH) / CEL); cy <= Math.floor((y2 + STOL_SCH) / CEL); cy++){
        const k = cx + ':' + cy;
        let l = balde.get(k); if (!l){ l = []; balde.set(k, l); }
        l.push(v);
      }
  };
  for (const q of pontos || []) poe(q.x, q.y, q.x, q.y, { q });
  F.forEach((w, wi) => {
    const o = (w && w.pts) || [];
    for (let s = 0; s < o.length - 1; s++){
      const a = o[s], b = o[s+1];
      poe(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), { wi, s, a, b });
    }
  });
  F.forEach((w, wi) => {
    const pts = (w && w.pts) || [], n = pts.length;
    if (n < 2) return;
    for (const i of [0, n - 1]){
      const p = pts[i], meu = i === 0 ? 0 : n - 2;     /* o trecho que termina nesta ponta */
      const ligada = (balde.get(Math.floor(p[0] / CEL) + ':' + Math.floor(p[1] / CEL)) || []).some(v => v.q
        ? pertoDe(v.q.x, v.q.y, p[0], p[1])
        : !(v.wi === wi && v.s === meu) && distPS(p[0], p[1], v.a[0], v.a[1], v.b[0], v.b[1]) <= STOL_SCH);
      if (!ligada) out.push({ wi, i, x:p[0], y:p[1] });
    }
  });
  return out;
}

/* o trecho reto (a,b) entra no MIOLO da caixa? A borda nao conta: e nela que a ponta do pino mora */
function entraNaCaixa(ax, ay, bx, by, c){
  const t = STOL_SCH;
  return Math.max(ax, bx) > c.x1 + t && Math.min(ax, bx) < c.x2 - t
      && Math.max(ay, by) > c.y1 + t && Math.min(ay, by) < c.y2 - t;
}
/* Os pares pino ↔ ponta que um trecho RETO liga. `pinos` sao as pontas quentes do que viaja, ja
   no pouso: { x, y, ref, num, caixa, ox, oy }. `caixa` e o indice em `caixas` (a caixa do proprio
   componente, tambem no pouso) e ox/oy e a direcao do pino, do corpo para fora. Um par existe
   quando:
     - pino e ponta estao no mesmo X ou no mesmo Y (ate STOL_SCH), a mais de STOL_SCH e ate
       `alcance` um do outro;
     - a ponta fica DO LADO DE FORA. O trecho que sai do pino na direcao dele e de fora por
       construcao, e o que volta contra ela atravessa o pino. Nas outras direcoes ele nao pode
       entrar na caixa de nenhum componente que viaja. A caixa sozinha nao basta: 139 dos 1781
       desenhos da biblioteca tem um texto que a alarga alem da ponta do pino, e o fio que sai
       reto do pino seria recusado por causa de um texto;
     - o trecho nao encosta em mais nada eletrico: outro pino do que viaja ou um dos `pontos`
       (pino parado, juncao, power, port, vertice de fio). Nem o pino pode pousar no meio de um
       dos `fios` parados: ali ele ja esta ligado, e o D juntaria duas nets.
   Guloso pelo mais perto: cada pino e cada ponta entram em no maximo um par. Devolve
   [{ pino, ponta, d }] na ordem dos pinos.
   A conta roda a cada quadro do arrasto, e com 2/3 da folha maior do acervo na mao, no zoom da
   folha inteira, levava 12 ms. Duas podas a trazem para baixo sem mudar o resultado:
     - de cada pino so conta a ponta MAIS PERTO em cada direcao. O trecho ate a de tras passaria
       pela da frente, que e vertice de fio, e vertice de fio esta em `pontos`;
     - o que pode encostar num trecho reto esta na faixa de STOL_SCH em volta da linha dele, e a
       faixa sai de uma busca binaria nos pontos em ordem de X e de Y, e nao da folha inteira.
   E o distPS so roda dentro da caixa do trecho: era ele que pesava, contra cada trecho de fio da
   folha para cada pino. A ordem dos pontos fica guardada pela identidade da lista, que e a mesma
   o gesto inteiro (rotaDoGesto). */
const ORDEM_DOS_PONTOS = new WeakMap();
function paresDeRota(pinos, pontas, caixas, pontos, alcance, fios){
  const L = pinos || [], P = pontas || [], C = caixas || [], Q = pontos || [];
  const lim = alcance > 0 ? alcance : Infinity, T = STOL_SCH;
  let ordem = ORDEM_DOS_PONTOS.get(Q);
  if (!ordem){
    ordem = { x:Q.slice().sort((a, b) => a.x - b.x), y:Q.slice().sort((a, b) => a.y - b.y) };
    ORDEM_DOS_PONTOS.set(Q, ordem);
  }
  /* algum ponto de `arr` (em ordem de k) entre lo e hi faz `f` responder true? */
  const naFaixa = (arr, k, lo, hi, f) => {
    let a = 0, b = arr.length;
    while (a < b){ const m = (a + b) >> 1; if (arr[m][k] < lo) a = m + 1; else b = m; }
    for (let i = a; i < arr.length && arr[i][k] <= hi; i++) if (f(arr[i])) return true;
    return false;
  };
  /* (px,py) encosta no trecho (x1,y1)-(x2,y2)? A caixa primeiro, que e barata */
  const encosta = (px, py, x1, y1, x2, y2) =>
    px >= Math.min(x1, x2) - T && px <= Math.max(x1, x2) + T && py >= Math.min(y1, y2) - T && py <= Math.max(y1, y2) + T
    && distPS(px, py, x1, y1, x2, y2) <= T;
  const pousado = pn => {
    if (naFaixa(ordem.y, 'y', pn.y - T, pn.y + T, q => pertoDe(q.x, q.y, pn.x, pn.y))) return true;
    for (const w of fios || []){
      const o = (w && w.pts) || [];
      for (let s = 0; s < o.length - 1; s++) if (encosta(pn.x, pn.y, o[s][0], o[s][1], o[s+1][0], o[s+1][1])) return true;
    }
    return false;
  };
  const deFora = (pn, pt) => {
    const sx = pt.x - pn.x, sy = pt.y - pn.y, ol = Math.hypot(pn.ox || 0, pn.oy || 0);
    const cos = ol ? (sx * pn.ox + sy * pn.oy) / (Math.hypot(sx, sy) * ol) : 0;
    if (cos < -0.999) return false;
    for (let k = 0; k < C.length; k++)
      if (!(k === pn.caixa && cos > 0.999) && entraNaCaixa(pn.x, pn.y, pt.x, pt.y, C[k])) return false;
    return true;
  };
  const livre = (a, pn, pt) => {
    const bate = q => !pertoDe(q.x, q.y, pt.x, pt.y) && encosta(q.x, q.y, pn.x, pn.y, pt.x, pt.y);
    if (Math.abs(pt.y - pn.y) <= T ? naFaixa(ordem.y, 'y', Math.min(pn.y, pt.y) - T, Math.max(pn.y, pt.y) + T, bate)
                                   : naFaixa(ordem.x, 'x', Math.min(pn.x, pt.x) - T, Math.max(pn.x, pt.x) + T, bate)) return false;
    for (let k = 0; k < L.length; k++)
      if (k !== a && encosta(L[k].x, L[k].y, pn.x, pn.y, pt.x, pt.y)) return false;
    return true;
  };
  const cand = [];
  for (let a = 0; a < L.length; a++){
    const pn = L[a], frente = {};
    for (let b = 0; b < P.length; b++){
      const pt = P[b];
      const deitado = Math.abs(pt.y - pn.y) <= STOL_SCH;
      if (!deitado && Math.abs(pt.x - pn.x) > STOL_SCH) continue;
      const d = Math.hypot(pt.x - pn.x, pt.y - pn.y);
      if (d <= STOL_SCH || d > lim) continue;
      const dir = deitado ? (pt.x > pn.x ? '+x' : '-x') : (pt.y > pn.y ? '+y' : '-y');
      if (!frente[dir] || d < frente[dir].d) frente[dir] = { b, d };
    }
    const dirs = Object.keys(frente);
    /* o pino ja ligado so e conferido quando ha ponta alinhada: e a conta cara */
    if (!dirs.length || pousado(pn)) continue;
    for (const k of dirs){
      const { b, d } = frente[k];
      if (deFora(pn, P[b]) && livre(a, pn, P[b])) cand.push({ a, b, d });
    }
  }
  cand.sort((u, v) => u.d - v.d || u.a - v.a || u.b - v.b);
  const usouPino = new Set(), usouPonta = new Set(), par = [];
  for (const c of cand){
    if (usouPino.has(c.a) || usouPonta.has(c.b)) continue;
    usouPino.add(c.a); usouPonta.add(c.b);
    par.push(c);
  }
  return par.sort((u, v) => u.a - v.a).map(c => ({ pino:L[c.a], ponta:P[c.b], d:c.d }));
}
/* O fio esticado ate o pino em (x,y); i e a ponta (0 ou n-1). Se o ultimo trecho ja esta no eixo
   do pino e aponta para ele, a ponta ANDA ate o pino e o fio continua com os mesmos vertices.
   Senao entra um vertice novo depois da ponta (o canto do L, ou o trecho que continua um fio
   diagonal). Devolve os pts novos. Quem chama ainda passa o resultado pelo HubFio.limpa. */
function ligaPonta(pts, i, x, y){
  const out = (pts || []).map(p => [p[0], p[1]]), n = out.length;
  if (n < 2 || (i !== 0 && i !== n - 1)) return out;
  const p = out[i], q = out[i === 0 ? 1 : n - 2];
  const vx = p[0] - q[0], vy = p[1] - q[1];          /* o ultimo trecho, de dentro para a ponta */
  const sx = x - p[0], sy = y - p[1];               /* o trecho novo, da ponta ate o pino */
  const mesmoEixo = (Math.abs(vy) <= STOL_SCH && Math.abs(sy) <= STOL_SCH)
                 || (Math.abs(vx) <= STOL_SCH && Math.abs(sx) <= STOL_SCH);
  if (mesmoEixo && vx * sx + vy * sy > 0) out[i] = [x, y];
  else if (i === 0) out.unshift([x, y]);
  else out.push([x, y]);
  return out;
}

/* ── ESPELHO NA TELA, NOS DOIS EIXOS ──
   O formato tem um booleano `mirror` e rot 0/90/180/270, na ordem do Altium: gira e DEPOIS
   espelha em X (HubCore.rotEfetiva). Nao ha terceiro campo a inventar — o Altium tambem so tem
   IsMirrored + Orientation —, entao espelhar o que se VE e composicao (F = espelho na tela,
   M = espelho em X, R = giro; F_x = M, F_y = R180.M, e M.R(a) = R(-a).M):
       horizontal (vira esquerda/direita):  rot' = rot,        mirror' = !mirror
       vertical   (vira em cima/embaixo):   rot' = rot + 180,  mirror' = !mirror
   (Ate 2026-10 a conta era 360 - rot / 180 - rot, certa para a ordem "espelha e depois gira",
   que o hub usava e o Altium nao.)
   Ate aqui o X trocava so o booleano, que e o espelho no eixo LOCAL do componente: num
   componente girado 90 a tecla X espelhava na vertical, e a mesma tecla fazia coisas
   diferentes conforme a rotacao. Com a conta acima X e sempre horizontal e Y e sempre
   vertical, em qualquer rotacao. */
function espelha(rot, mirror, eixo){
  const r = (((rot || 0) % 360) + 360) % 360;
  const base = (eixo === 'y' ? r + 180 : r);
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

/* ── ATALHOS ──
   A tabela, as regras e o editor moram no hub-atalhos.js: o editor saiu desta vista para as
   Configuracoes do hub (aba Atalhos), e os dois lados leem a mesma tabela. Daqui para baixo a
   vista so usa o mapa; as funcoes continuam no PURE porque os testes as pegam por aqui. */
const HA = (typeof module !== 'undefined' && module.exports) ? require('./hub-atalhos.js') : window.HubAtalhos;
const { ATALHOS_PADRAO, TECLAS_PROIBIDAS, normalizaTecla, mapaAtalhos, defineAtalho } = HA;

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

/* a regra do designador do conector multiparte (veja designadorVisivel, na parte DOM): pura,
   para o teste provar sem folha nem biblioteca */
function designadorAparece(c, sym, part){
  if ((c.part || 1) <= 1) return true;
  /* so esconde quando a parte desenhada vai MOSTRAR o numero do pino no lugar: o conector sem
     simbolo resolvido e um quadrado vermelho sem pino (134 partes em 3 projetos, medido em
     2026-09-24), e escondido o designador ele virava um quadrado anonimo */
  if (!part || !(part.pins || []).length) return true;
  if (/^(CN|J|X)\d/i.test(c.ref || '')) return false;
  return !(sym && (sym.parts || []).length > 1 && part && (part.pins || []).length === 1);
}

/* ── A PARTE QUE ENTRA NA FOLHA ACHA O SEU COMPONENTE ──
   Um componente de várias partes é UM designador repetido na folha: o U1 do amplificador duplo
   é a parte 1 e a parte 2, as duas com "U1" (é o par ref/part que a validação exige único). O
   "Adicionar componentes" dava designador novo a toda peça — e aí a parte 2 escolhida no modal
   nascia U2, sozinha, e a ficha não a deixava virar U1 (recusa nome já usado). A parte tinha
   como ser escolhida e não tinha onde se encaixar.

   A regra é o "completar os existentes" da anotação do Altium: a parte vai para o PRIMEIRO
   designador que já tem a mesma peça (mesmo símbolo, footprint e comment — outro comment é
   outro valor) e ainda não tem esta parte; não havendo, ganha designador novo. Componente de
   uma parte só nunca se encaixa em nada, porque todo designador já tem a parte 1 — e por isso
   ele continua exatamente como era. `comps` são os componentes de TODAS as folhas (o designador
   é do projeto, não da folha); `novoRef()` dá o próximo livre. Devolve { ref, junto }. */
function refDaParte(comps, peca, novoRef){
  const n = (peca && peca.part) || 1;
  if (peca && (peca.partes || 1) > 1){
    const mesma = c => c.sym === peca.sym && (c.footprint || '') === (peca.footprint || '')
                    && (c.comment || '') === (peca.comment || '');
    const porRef = new Map();
    for (const c of comps || []){
      if (!c || !c.ref) continue;
      if (!porRef.has(c.ref)) porRef.set(c.ref, []);
      porRef.get(c.ref).push(c);
    }
    const livres = [];
    for (const [ref, l] of porRef)
      if (l.every(mesma) && !l.some(c => (c.part || 1) === n)) livres.push(ref);
    livres.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    if (livres.length) return { ref: livres[0], junto: true };
  }
  return { ref: novoRef(), junto: false };
}

/* ── TROCAR A PARTE DE UM ITEM DA FOLHA (o "Trocar componente") ──
   A parte e do ITEM: U1 parte 1 e U1 parte 2 sao dois itens com o mesmo designador, e o par
   ref/parte tem de continuar unico (a validacao recusa o repetido). Se o designador ja tem a
   parte pedida noutro item, os dois TROCAM: o outro fica com a parte que este tinha — pedir a
   parte 2 para o item que e a 1 e dizer "este e o 2", nao "tenha dois 2". `itensDoRef` sao os
   itens do designador em TODAS as folhas. Devolve [{ item, de, para }], vazio quando nada muda;
   quem chama aplica. */
function trocaDeParte(itensDoRef, item, para){
  const de = (item && item.part) || 1;
  const n = Math.trunc(Number(para)) || 1;
  if (!item || n < 1 || n === de) return [];
  const outro = (itensDoRef || []).find(c => c && c !== item && (c.part || 1) === n);
  const fora = [{ item, de, para: n }];
  if (outro) fora.push({ item: outro, de: n, para: de });
  return fora;
}
/* O desenho novo CABE no designador quando tem todas as partes que ele usa na folha, contadas
   DEPOIS das `trocas` (trocaDeParte) — o item que vai virar a parte 1 nao conta mais como a 3.
   Sem caber, trocar o `sym` largaria as partes que o componente novo nao tem (um conector
   desenhado em 16 partes trocado por um de uma so). */
function desenhoCabe(itensDoRef, nNovo, trocas){
  const vira = new Map((trocas || []).map(t => [t.item, t.para]));
  let maior = 1;
  for (const c of itensDoRef || [])
    if (c) maior = Math.max(maior, vira.has(c) ? vira.get(c) : (c.part || 1));
  return maior <= (nNovo || 1);
}

/* ── O QUE UM COMPONENTE DO ALMOXARIFADO GRAVA ──
   `sym`, `comment`, `params` e `footprint` de um valor escolhido. Moram aqui, na parte pura,
   porque tres caminhos gravam isso e os tres tem de gravar IGUAL: o "Adicionar componentes"
   (cartAdd), o vinculo que o painel da BoM e a lista do Odoo aplicam na folha
   (__hubAplicaVinculos) e o componente fora do esquema da lista do Odoo
   (__hubEscolheParaLista), que nao vai para a folha mas resolve pela MESMA cascata do
   odoolista.py. Uma segunda implementacao do formato so se descobriria divergente no dia em
   que divergisse. */

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
/* footprint: o do VALOR primeiro (um resistor 0805 e um 2512 dividem o mesmo simbolo e nao
   tem nada a ver na placa), depois os modelos do simbolo. O padrao e o marcado como atual,
   ou o primeiro — e o que o seletor do "Adicionar componentes" ja vem mostrando. */
function modelosDeFootprint(s, v){
  return (v && v.footprint)
    ? [{ name:v.footprint, current:true }].concat(((s && s.footprints) || []).filter(m => m.name !== v.footprint))
    : ((s && s.footprints) || []);
}
function footprintPadrao(s, v){
  const models = modelosDeFootprint(s, v);
  return ((models.find(m => m.current) || models[0] || {}).name) || '';
}
/* A sequencia aspas-dois-pontos derruba a gravacao do schematic.js INTEIRO (o parser le
   linha a linha e corta ali). */
const quebraGravacao = t => typeof t === 'string' && t.indexOf('":') >= 0;
/* A identidade de UM VALOR do almoxarifado, tirada dele mesmo — e o que o cartAdd grava: o
   `sym` e o nome do valor no Altium (v.altium), o comment e o rotulo, o params sai do
   paramsDoValor e o footprint do footprintPadrao (o do valor, senao os modelos da familia
   `s`). Recusa so o texto que o gravador do schematic.js nao aguenta. */
function identidadeDoValor(v, s){
  if (!v) return { ok:false, porque:'nenhum valor do almoxarifado escolhido' };
  const comment = String(v.label || '').replace(/"/g, "'");
  const params = paramsDoValor(v);
  if (quebraGravacao(comment) || quebraGravacao(params))
    return { ok:false, porque:'o texto tem a sequencia que o gravador do schematic.js recusa' };
  return { ok:true, sym: v.altium || (s && s.name) || '', comment, params,
           footprint: footprintPadrao(s, v), valor: v };
}
/* `res` e o HubCore.resolveSym do nome escolhido. Recusa ANTES de gravar qualquer coisa:
   nome que nenhum acervo resolve viraria quadrado vermelho, e FAMILIA nao e componente —
   "RESISTOR" nao diz o valor, e sem valor nao ha OdooId nem comment que preste. */
function identidadeDoComponente(res, nome){
  if (!(res && res.item))
    return { ok:false, porque:'nao existe em acervo nenhum aqui — o componente viraria um quadrado vermelho' };
  const alias = res.item;
  const valor = (alias.valores && alias.valores.length === 1) ? alias.valores[0] : null;
  if (!valor)
    return { ok:false, porque:'"' + nome + '" e uma FAMILIA do almoxarifado, nao um componente: nao da para saber o valor' };
  const r = identidadeDoValor(valor, alias);
  /* pelo NOME, grava-se o nome resolvido (o lib-subs.js pode te-lo mandado para outro) */
  if (r.ok) r.sym = res.name || nome;
  return r;
}
/* O componente escolhido no seletor do almoxarifado (candidatoDoValor). Com o VALOR clicado
   em maos, a identidade sai DELE, e nao do nome: o nome nao identifica o valor. Medido nos
   2545 valores reais, dois "Cartão Micro SD" de familias diferentes (OdooId 910 e 149) — pelo
   nome, escolher o soquete gravava o OdooId do outro, calado —, e nove valores (BC807, TL431,
   78L05...) cujo nome e tambem o de um simbolo da biblioteca da casa, que vence o alias e nao
   tem `valores`: pelo nome, eles eram recusados como "FAMILIA". Sem o valor (candidato que
   nao veio de um clique na lista), vale o caminho pelo nome. `resolve` e o
   HubCore.resolveSym ja amarrado ao SLIB — parametro para esta funcao ficar pura. */
function identidadeDoEscolhido(c, resolve){
  if (c && c.valor) return identidadeDoValor(c.valor, c.familia);
  const nome = c && c.name;
  return identidadeDoComponente(nome && resolve ? resolve(nome) : null, nome);
}
/* O vinculo ({refs, componente, valor?, familia?} do __hubAplicaVinculos): pelo VALOR clicado
   quando o seletor o mandou — "Trocar componente" e o "resolver" das linhas do esquema na
   lista do Odoo —, pelo nome quando nao (o painel da BoM so tem o nome). Sem o valor, o
   soquete 'Cartão Micro SD' clicado gravava o OdooId do conector de mesmo nome. */
function identidadeDoVinculo(v, resolve){
  const nome = String((v && v.componente) || '').trim();
  return identidadeDoEscolhido({ name: nome, valor: (v && v.valor) || null,
                                 familia: (v && v.familia) || null }, resolve);
}

/* Os ids de um params "K=V;K=V": OdooId (um ou varios, separados por espaco — 31 valores do
   almoxarifado tem mais de um produto) e ValorId. */
function idsDoParams(p){
  const s = String(p || '');
  const od = /(?:^|;)OdooId=([^;]*)/.exec(s), vi = /(?:^|;)ValorId=([^;]*)/.exec(s);
  return { odoo: od ? od[1].trim().split(/[\s,]+/).filter(Boolean) : [],
           valorId: vi ? vi[1].trim() : '' };
}
/* A PECA DE HOJE no seletor: o valor do almoxarifado que um params gravado descreve. Pela
   IDENTIDADE, nunca pela string inteira: o params leva Estoque, Local e Custo, que mudam a
   cada sincronizacao, e a comparacao exata errava a partir do primeiro sync — o seletor
   voltava ao xara pelo nome e o "Trocar a peça" trocava o soquete pelo conector. Primeiro o
   OdooId (unico entre os 2545 valores, medido); sem ele, o ValorId, que numera por SIMBOLO e
   se repete entre familias — so vale entre os valores do MESMO nome, e so se sobrar um.
   Nada casou: null, e quem chama cai no nome. */
function pecaDeHoje(grupos, params, nome){
  const a = idsDoParams(params);
  if (a.odoo.length)
    for (const g of grupos || []) for (const it of g.valores){
      const d = it.v ? idsDoParams(paramsDoValor(it.v)).odoo : [];
      if (a.odoo.some(o => d.indexOf(o) >= 0)) return { grupo: g, item: it };
    }
  if (a.valorId){
    const c = [];
    for (const g of grupos || []) for (const it of g.valores)
      if (it.nome === nome && it.v && String(it.v.id) === a.valorId) c.push({ grupo: g, item: it });
    if (c.length === 1) return c[0];
  }
  return null;
}
/* A RECOMENDACAO do seletor, decidida aqui (pura) a partir do que o nome recomendaria
   (`porNome`, o HubAlmoxPick.recomendado). A peca de hoje (pecaDeHoje) vence o nome. Se o
   params dizia QUAL era a peca e ela sumiu do almoxarifado, o de mesmo nome so e apontado,
   nao escolhido, quando o nome tem xara: ele e outra peca, e um clique no Usar/Trocar a peca
   gravaria o outro produto. Nome sem xara continua escolhido, como sempre foi. */
function recomendacaoDe(grupos, comp, porNome){
  const params = comp && comp.params;
  const hoje = params ? pecaDeHoje(grupos, params, comp.sym) : null;
  if (hoje) return { grupo: hoje.grupo, item: hoje.item, por: comp.sym, rotulo: '↩ a peça de hoje' };
  if (!porNome) return null;
  const ids = idsDoParams(params);
  if (ids.odoo.length || ids.valorId){
    let xaras = 0;
    for (const g of grupos || []) for (const it of g.valores) if (it.nome === porNome.item.nome) xaras++;
    if (xaras > 1) return Object.assign({}, porNome, { seleciona: false, rotulo: '↩ mesmo nome — outra peça?' });
  }
  return porNome;
}
/* "Ja e esse componente": o mesmo nome E a mesma peca. Com o valor clicado em maos, a peca
   de hoje do componente (pecaDeHoje, pela identidade — nunca a string inteira do params, que
   muda com o saldo a cada sync) tem de ser ESTE valor. Componente sem params recebe a
   identidade no clique; so pelo nome (sem valor), vale o nome, como sempre. */
function mesmaPecaDaFolha(grupos, comp, para, valor){
  if (!comp || comp.sym !== para) return false;
  if (!valor) return true;
  if (!comp.params) return false;
  const hoje = pecaDeHoje(grupos, comp.params, comp.sym);
  return !!hoje && hoje.item.v === valor;
}
/* ── A FOLHA SEGUE O PRODUTO, NÃO O NOME (2026-09-29) ──
   Pedido do dono: tudo é vinculado pelo ID do Odoo. O `sym` de um componente do almoxarifado
   é o NOME do valor (o LibReference na .SchLib), e o nome sai do cadastro: renomear o produto
   no Odoo deixava a folha apontando para um nome que não existe mais — quadrado vermelho —,
   ou para o zumbi `fora` que a renomeação deixou para trás, com o desenho da família em vez do
   símbolo aplicado. O `params` do componente guarda o OdooId, que não muda.

   Segue quando o nome NÃO resolve, resolve para um `fora`, ou resolve (por aproximação ou
   escolha) para o próprio produto com outro nome. NÃO segue quando o nome resolve para outra
   peça viva ou para um símbolo da casa: aí o nome é escolha de alguém, e o id no params é
   sobra — trocar a peça por baixo seria desfazer a escolha. Nem quando o id leva a mais de um
   componente vivo: dois candidatos não são resposta.

   Troca `sym` e `params` (a identidade do valor de hoje, igual ao "Adicionar componentes"), e
   o `comment` só quando ele ainda era o rótulo antigo — comment escrito à mão fica. O
   footprint fica: ele é da peça, e a peça é a mesma. Devolve [{ref, de, para}] e MUDA os
   itens; quem chama marca a folha como alterada e avisa. `resolve(nome)` é o
   HubCore.resolveSym já amarrado; `valorDe` o Map nome → {sym, valor} do montaAcervos. */
function seguePeloOdoo(items, valorDe, resolve){
  const porId = new Map();
  for (const [nome, x] of valorDe || []){
    if (!x || !x.valor || x.valor.fora) continue;
    for (const it of x.valor.itens || []){
      const o = String((it && it.odoo) == null ? '' : it.odoo).trim();
      if (!o) continue;
      const l = porId.get(o) || [];
      if (!l.some(y => y.nome === nome)) l.push({ nome, sym: x.sym, valor: x.valor });
      porId.set(o, l);
    }
  }
  const fora = [];
  if (!porId.size) return fora;
  for (const c of items || []){
    if (!c || c.t !== 'comp' || !c.params) continue;
    const ids = idsDoParams(c.params).odoo;
    if (!ids.length) continue;
    const cand = [];
    for (const o of ids) for (const y of porId.get(o) || []) if (!cand.some(z => z.nome === y.nome)) cand.push(y);
    if (cand.length !== 1) continue;
    const alvo = cand[0];
    if (alvo.nome === c.sym) continue;
    const r = resolve ? resolve(c.sym) : null;
    if (r && r.item){
      const achou = r.name && valorDe && valorDe.get(r.name);
      const mesmoProduto = achou && achou.valor === alvo.valor;
      const zumbi = achou && achou.valor && achou.valor.fora;
      if (!mesmoProduto && !zumbi) continue;     /* outra peça viva, ou símbolo da casa */
    }
    const ident = identidadeDoValor(alvo.valor, alvo.sym);
    if (!ident.ok) continue;
    const rotuloVelho = (/(?:^|;)Comment=([^;]*)/.exec(c.params) || [])[1];
    if (c.comment != null && rotuloVelho != null && String(c.comment).trim() === rotuloVelho.trim())
      c.comment = ident.comment;
    fora.push({ ref: c.ref || '', de: c.sym, para: ident.sym });
    c.sym = ident.sym;
    c.params = ident.params;
  }
  return fora;
}

/* O valor escolhido, reachado nos grupos NOVOS depois de uma recarga da biblioteca (os objetos
   mudam). A chave e o simbolo (a familia do valor) + o id, que numera por simbolo, com o nome
   junto. Sumiu: null — nunca o xara de mesmo nome, que seria OUTRA peca escolhida calada. */
function reachaValor(grupos, nome, valorAntes, symAntes){
  if (!valorAntes) return null;
  const ach = [];
  for (const g of grupos || []) for (const x of g.valores)
    if (x.nome === nome && x.v && x.v.id === valorAntes.id
        && (!symAntes || (x.sym && x.sym.name) === symAntes)) ach.push(x);
  return ach.length === 1 ? ach[0] : null;
}

const PURE = { LIBS, ACERVO_DEFS, montaAcervos, partesDe, nPartes, refDaParte, trocaDeParte, desenhoCabe,
               carimbo, decideTroca, montaPartsTrocando,
               valorDoComp, tipoDoComp,
               paramsDoValor, modelosDeFootprint, footprintPadrao, identidadeDoValor,
               identidadeDoComponente, identidadeDoEscolhido, identidadeDoVinculo,
               idsDoParams, pecaDeHoje, reachaValor, recomendacaoDe, mesmaPecaDaFolha, seguePeloOdoo,
               topologiaFolha, moveSegmento, eixosDoTrecho, apagaSegmento, apagaVertice, espelha, encaixeDaTroca,
               fioNoPonto, pontasSoltas, paresDeRota, ligaPonta,
               GRADES, gradePorId, snapPasso, MM_MIL, caixaTexto, larguraTexto, designadorAparece,
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
  /* os footprints do editor de footprint do hub (Libs/pcblib-hub.js) passam na frente dos do
     Altium com o mesmo nome -- o mesmo que a vista PCB e o ECO enxergam */
  if (typeof HubFpLib !== 'undefined' && window.pcblibHub) PLIB = HubFpLib.mescla(PLIB, HubFpLib.normaliza(window.pcblibHub));
  /* antes de qualquer symbolOf: sem as tabelas o resolvedor casa so por nome exato e por
     chave, e metade dos componentes viraria quadrado vermelho na folha */
  HubCore.setLibTables(window.renameMap || null, window.libSubs || null);
  /* OS SIMBOLOS DE DENTRO DO .SchDoc. O esquema aberto direto do Altium (tools/schdoc/
     schdoc2sch.py) traz em `schematic.symbols` o desenho de cada simbolo como a folha o guarda
     -- o .SchDoc carrega uma copia do simbolo em cada componente. Entram SO onde nenhum acervo
     resolve o nome: a biblioteca da casa continua mandando, e o que ela nao tem deixa de ser
     quadrado vermelho. Nao e palpite como o resgate de baixo: e o simbolo daquele componente,
     entao vale tambem para as nets. Array NOVO, como acima. */
  const doDoc = (typeof schematic !== 'undefined' && schematic && Array.isArray(schematic.symbols)) ? schematic.symbols : [];
  if (doDoc.length) {
    const extras = doDoc.filter(s => s && s.name && Array.isArray(s.parts) && !HubCore.symbolOf(SLIB, s.name))
                        .map(s => Object.assign({}, s, { doDocumento:true }));
    if (extras.length) SLIB.symbols = SLIB.symbols.concat(extras);
  }
  montaEmergencia();
  return r;
}
aplicaAcervos();
/* o produto renomeado no Odoo, seguido pelo id (seguePeloOdoo, no bloco puro). Na CARGA a
   folha só fica marcada como alterada — o schematic.js é de dois escritores e nada vai ao
   disco sem o Salvar —, e o aviso sai no fim da montagem, quando a tela já existe. */
const RENOMEADOS_ODOO = seguePeloOdoo(schematic.items, VALOR_DE, n => HubCore.resolveSym(SLIB, n));
function avisaRenomeados(lista){
  if (!lista || !lista.length || typeof HubDialog === 'undefined') return;
  const ex = lista.slice(0, 4).map(x => x.ref + ': ' + x.de + ' → ' + x.para).join('\n');
  HubDialog.toast(lista.length + (lista.length === 1 ? ' componente mudou' : ' componentes mudaram')
    + ' de nome no Odoo — a folha seguiu pelo ID do produto:\n' + ex
    + (lista.length > 4 ? '\n… e mais ' + (lista.length - 4) : '')
    + '\nSalve para levar o nome novo ao Altium.', 'warn', 12000);
}

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
/* AS GUIAS DO ARRASTO nascem LIGADAS, e o botao delas mora na secao Vista das Configuracoes
   (pedido de 2026-09-24). Desligadas, o arrasto volta a ser o de antes: o cursor, a grade ao
   soltar e o ima do pino — que nao e guia, e continua. Preferencia de vista, desta maquina. */
const VER_GUIAS_KEY = 'altiumhub.sch.guias';
const showState = { grid:true, comment:false, pinos:true, ref:true, guias:true };
try { showState.guias = localStorage.getItem(VER_GUIAS_KEY) !== '0'; } catch (e) {}
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
/* A MESA — o fundo do canvas EM VOLTA da folha — segue o tema do hub. Era um oliva escuro
   cravado, e a vista ficava avulsa quando o tema mudava. A folha e tudo o que se desenha nela
   NAO seguem: sao as cores do Altium. O canvas nao le var() sozinho, entao a cor sai do token
   (--sunken, o mesmo fundo de viewport do hub) e fica guardada aqui; o evento 'hubtema'
   (hub-tema.js, la embaixo junto dos atalhos) a rele e repinta o canvas grande e as
   miniaturas das folhas. Sem o hub-tema carregado, a mesa de sempre. */
const MESA_RESERVA = '#3a3a34';
let mesaCor = MESA_RESERVA;
function leMesa(){ mesaCor = window.HubTema ? HubTema.cor('--sunken', MESA_RESERVA) : MESA_RESERVA; }
leMesa();
/* o fio selecionado tem as cores do Altium: tracejado claro por dentro, alcinha verde no
   vertice, vermelha no pedaco escolhido */
const SEL_FIO = '#d8ecff', ALCA_VERDE = '#1fdc1f', ALCA_VERMELHA = '#ff2a2a';
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
  updateMeta(); updateSelStatus(); renderProps();
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
/* ── O DESIGNADOR DO CONECTOR MULTIPARTE ──
   Pedido de 2026-09-24: no conector desenhado UMA PARTE POR PINO (CONE PADRAO, MSTBH, CONE
   APONT), o designador aparece so na parte 1; nas outras fica so o numero — que ja e o numero
   do pino, porque cada parte e um pino. Seis "CN2" empilhados diziam a mesma coisa seis vezes.
   Conector = designador CN/J/X, ou simbolo multiparte com UM pino por parte (medido nos projetos:
   os 120 "Conector 2 Filas" sem simbolo resolvido entram pelo prefixo). CI multiparte (CD4069,
   TL082 — 2 a 5 pinos por parte) continua com o designador em toda parte, como no Altium.
   Designador escondido nao se desenha, nao se clica e nao e guia de alinhamento. */
function designadorVisivel(c){
  /* a parte que a folha DESENHA — a do simbolo, ou a de emergencia (ambar); sem nenhuma das
     duas o componente e um quadrado vermelho sem pino, e sem o designador ele ficaria anonimo */
  const sym = HubCore.symbolOf(SLIB, c.sym);
  const part = HubCore.partOf(sym, c.part) || ((desenhoDeEmergencia(c) || {}).part || null);
  /* a regra esconde o designador PORQUE o numero do pino aparece no lugar. Com o olho dos
     pinos desligado o desenho obedece o hideNum do simbolo, e na parte em que todo pino tem o
     numero escondido nao sairia nem numero nem designador — um quadrado anonimo */
  const mostraNum = showState.pinos || ((part && part.pins) || []).some(p => !p.hideNum);
  return !mostraNum || designadorAparece(c, sym, part);
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
  /* DOIS ALVOS DO MESMO FIO (um trecho e um vertice, dois trechos) se COMPOEM: cada um parte do
     fio que o anterior ja moveu. Partindo cada um da propria foto, o ultimo reescrevia o fio
     inteiro e o movimento dos outros se perdia. O moveSegmento nao muda a contagem de pontos,
     entao os indices continuam valendo de um para o outro. */
  const trab = new Map();
  const ptsDe = b => trab.get(b.a.it) || b.pts;
  for (const b of base.values()){
    const a = b.a, it = a.it;
    if (a.k === 'ref' || a.k === 'com'){
      /* os DOIS campos sao gravados sempre que a mao move o texto, inclusive em zero: aqui o
         zero e uma posicao (o texto em cima da ancora do componente) e nao "sem opiniao".
         Quem apaga os campos e o "voltar ao lugar de origem" e o Delete no texto. */
      const nx = Math.round((b.x0 + dx - it.x) * 1e4) / 1e4, ny = Math.round((b.y0 + dy - it.y) * 1e4) / 1e4;
      if (a.k === 'com'){ it.comdx = nx; it.comdy = ny; } else { it.refdx = nx; it.refdy = ny; }
    }
    else if (a.k === 'vert' || a.k === 'seg'){
      /* cada alvo e medido da FOTO, e o vertice anda num eixo quando ALGUM alvo o move nesse
         eixo: dois trechos que dividem um canto (um anda em X, o outro em Y) levam o canto nos
         dois eixos, e nenhum apaga o eixo do outro */
      const mov = a.k === 'seg' ? moveSegmento(b.pts, a.i, dx, dy)
                : b.pts.map((p, i) => i === a.i ? [p[0] + dx, p[1] + dy] : p);
      const pts = ptsDe(b).map(p => [p[0], p[1]]);
      for (const i of (a.k === 'seg' ? [a.i, a.i + 1] : [a.i])){
        const o = b.pts[i], q = mov[i];
        if (!pts[i] || !o || !q) continue;
        if (q[0] !== o[0]) pts[i][0] = q[0];
        if (q[1] !== o[1]) pts[i][1] = q[1];
      }
      it.pts = pts; trab.set(it, pts);
    }
    else if (it.t === 'wire') it.pts = b.pts.map(p => [p[0] + dx, p[1] + dy]);
    else { it.x = b.x + dx; it.y = b.y + dy; }
  }
  /* O FIO SELECIONADO FICA PRESO AO PINO. Com o trecho (ou o vertice) de um fio selecionado
     junto com o componente, a ponta que estava no pino anda com ele inteira — o trecho, em fio
     de 3 ou mais pontos, so anda na perpendicular (moveSegmento), e sem isto o pino saia da
     ponta e o fio atravessava o corpo. A ponta so desliza ao longo do proprio trecho, entao o
     fio continua ortogonal. Vem DEPOIS do laco: o moveSegmento ja moveu o trecho. */
  if (base.colados) for (const e of base.colados){
    const q = (e.w.pts || [])[e.i];
    if (!q) continue;
    /* onde o pino ESTA agora — com um giro no meio do arrasto ele nao e mais a partida + delta */
    const p = e.c ? (HubCore.compPinsWorld(e.c, SLIB) || []).find(p => p.num === e.num) : null;
    if (p){ q[0] = p.x; q[1] = p.y; } else { q[0] = e.x + dx; q[1] = e.y + dy; }
  }
}
/* os vertices de fio SELECIONADO (como trecho ou vertice) que estao num pino de componente que
   viaja inteiro — os que o applyMove prende ao pino */
function coladosNosPinos(base){
  const pinos = [], out = [];
  for (const b of base.values())
    if (b.a.k === 'all' && b.a.it.t === 'comp')
      for (const p of (HubCore.compPinsWorld(b.a.it, SLIB) || [])) pinos.push({ x:p.x, y:p.y, num:p.num, comp:b.a.it });
  if (!pinos.length) return out;
  const vistos = new Set();
  for (const b of base.values()){
    if (b.a.it.t !== 'wire' || (b.a.k !== 'seg' && b.a.k !== 'vert')) continue;
    /* SO os vertices do alvo: o trecho leva as duas pontas dele, o vertice leva ele mesmo. Varrer
       o fio inteiro prendia ao pino a ponta de OUTRO trecho, que a mao nao selecionou, e o
       trecho entre as duas saia na diagonal. */
    const idx = b.a.k === 'seg' ? [b.a.i, b.a.i + 1] : [b.a.i];
    for (const i of idx){
      const q = (b.pts || [])[i];
      const k = idDe(b.a.it) + ':' + i;
      if (!q || vistos.has(k)) continue;
      const p = pinos.find(p => pertoDe(q[0], q[1], p.x, p.y));
      /* guarda QUAL pino (componente + numero), e nao so onde ele estava: um giro ou espelho no
         meio do arrasto leva o pino para outro lugar, e a ponta tem de ir atras dele */
      if (p){ vistos.add(k); out.push({ w:b.a.it, i, x:q[0], y:q[1], c:p.comp, num:p.num }); }
    }
  }
  return out;
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
function aplicaSel(net){
  /* net sem linha no painel nao tem interruptor: acender pintaria a folha sem jeito de
     apagar (grupo de um pino so ganha nome automatico e nao entra em nets.nets) */
  selNet = net && nets.nets.some(n => n.name === net) ? net : '';
  updateSelStatus(); renderProps(); mostraProps();
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
  retratoDoGiro(comps);
  for (const c of comps) c.rot = (((c.rot || 0) + 90) % 360);
  if (mouse && mouse.mode === 'move') giroNoArrasto(); else commit();
}
/* GIRAR OU ESPELHAR NO MEIO DO ARRASTO (Espaço/X/Y com o botao preso, como no Altium).
   Duas coisas, e as duas pertencem ao gesto:
   - o que o gesto mediu na partida ficou velho: os pinos do ima e as guias sao medidos de
     novo com o desenho novo — senao a guia alinha a borda de um corpo que nao existe mais e
     anuncia um alinhamento falso. A medicao e na PARTIDA, entao o item volta a ela, e o
     arrasto e refeito da ultima posicao do cursor;
   - o giro e mudanca MESMO que a posicao volte ao lugar: girouDeFato faz o leftUp gravar (o
     "mudou" dele so olha coordenada) — antes, girar e soltar parado nao entrava no undo nem
     acendia o "Salvar *". E so o giro que FICOU: X e X de novo, ou quatro Espacos, volta ao
     desenho da partida e nao e mudanca — gravar ali empilhava um undo vazio. */
function retratoDoGiro(comps){
  if (!mouse || mouse.mode !== 'move') return;
  if (!mouse.giro0) mouse.giro0 = new Map();
  for (const c of comps) if (!mouse.giro0.has(c)) mouse.giro0.set(c, { rot:c.rot || 0, mir:!!c.mirror });
}
function girouDeFato(d){
  if (!d || !d.giro0) return false;
  for (const [c, o] of d.giro0) if ((c.rot || 0) !== o.rot || !!c.mirror !== o.mir) return true;
  return false;
}
function giroNoArrasto(){
  const d = mouse;
  applyMove(d.base, 0, 0);
  d.guias = null; d.cena = null;
  /* o trilho do Shift era uma guia do desenho de ANTES do giro: com o Shift preso, o gesto
     refeito cai no "anda reto" ate uma guia nova pegar e o Shift descer de novo */
  d.shift = null; d.ultGuia = null;
  d.ima.pinos = pinosDoArrasto(d.base);
  if (d.moved && d.ult) leftMove(d.ult); else cam.draw();
}
/* Espelhar o que se VE: 'x' vira esquerda/direita, 'y' vira em cima/embaixo, em qualquer
   rotacao. A conta esta no bloco puro (espelha) e vale para os dois eixos. */
function mirrorSel(eixo){
  const comps = selItens().filter(it => it.t === 'comp');
  if (!comps.length) return;
  retratoDoGiro(comps);
  for (const c of comps){
    const r = espelha(c.rot, !!c.mirror, eixo === 'y' ? 'y' : 'x');
    if (r.rot) c.rot = r.rot; else c.rot = 0;
    if (r.mirror) c.mirror = true; else delete c.mirror;
  }
  if (mouse && mouse.mode === 'move') giroNoArrasto(); else commit();
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
   So o que a MAO faz nesta vista: escolher/mover, puxar fio e, pela gaveta dos pousos, pousar
   um terra, um trilho de alimentacao, um rotulo de net ou um No ERC. Texto, junção e troca de
   valor/footprint sao da IA, no schematic.js — por isso nao existem botoes para eles. */
let tool = 'select';        /* 'select' | 'wire' | 'power' | 'label' | 'noerc' */
/* "So fios" nao e um valor de `tool`: e um filtro DENTRO da seleção, e os muitos testes de
   tool === 'select' (o clique, o arrasto, o duplo clique, o ima, o Esc) valem nele sem mudar.
   So vale com tool === 'select'; o setTool o desliga e a vista sempre abre sem ele. */
let soFio = false;
let toolPower = null;       /* { net, style, rot } quando tool === 'power' */
let toolNet = '';           /* a palavra na mao quando tool === 'label' */
let wireDraw = null;        /* o fio em curso: o estado do hub-fio.js ({ pts, modo, primeiro, ult }) + ligado */
let snapHit = null;         /* ponto magnetico sob o cursor: { x, y, kind, label } */
let fioCursor = null;       /* onde o fio vai: { pt, snap } — refeito a cada movimento do mouse */
/* O MODO DO FIO fica lembrado nesta maquina, como no Altium, que guarda o ultimo modo usado:
   90°/45°/livre (Shift+Espaco) e para que lado sai o primeiro trecho (Espaco). */
const FIO_MODO_KEY = 'altiumhub.sch.fioModo';
let fioModo = { modo:'90', p90:'v', p45:'diag' };
try {
  const m = JSON.parse(localStorage.getItem(FIO_MODO_KEY) || 'null');
  if (m && typeof HubFio !== 'undefined' && HubFio.MODOS.indexOf(m.modo) >= 0) fioModo = Object.assign(fioModo, m);
} catch (e) {}

/* O IMA: enquanto uma ferramenta esta ativa, o cursor procura um ponto de conexao por
   perto — ponta quente de pino primeiro, depois vertice de fio, junção e power.
   O RAIO ACOMPANHA A GRADE. Com 100 mil ele e 60, como sempre foi — "meia grade", perto o
   bastante para nao roubar o clique de quem quer o ponto livre. Com uma grade de 10 mil, 60
   mil seriam SEIS grades de alcance: o ima capturaria pontos que a mao nem estava mirando e o
   pouso deixaria de ser previsivel. O piso de 20 mil existe para o ima nao sumir na grade
   mais fina, onde ele e justamente o que faz o fio encostar no pino. */
const snapMil = () => Math.max(20, Math.min(60, grade.passo * 0.6));
/* `comMeio`: o MEIO dos fios tambem e ponto de ligacao — como no Altium, o cursor que passa por
   cima de um fio encosta nele, e o fio novo que sai ou chega ali forma um T (a bolinha aparece
   sozinha, topologiaFolha). O fio, o rotulo e o power usam; o No ERC nao: ele marca PINO. */
function snapPoint(w, comMeio){
  const s = model.sheets[sheetIdx];
  let best = null;
  /* `html` so aparece onde ha o que barrar: e o mesmo rotulo, com o <span> da sobrelinha.
     Quem mostra escolhe — a barra de status pinta o html, o resto continua em texto. */
  /* O PISO DE 20 MIL E DO PINO, que mora fora da grade nas folhas metricas da casa. Ponta de
     fio, juncao, power e port sao pousados PELA grade: com o piso, nas grades de 10 mil e 0,25
     mm a ponta de um fio a DOIS passos ainda puxava o cursor, e o fio paralelo caia em cima
     dela. Para eles o alcance fica em 0,6 passo (de 1 mm para cima nada muda). */
  const rPonto = Math.min(snapMil(), grade.passo * 0.6);
  const tenta = (x, y, kind, label, peso, html, raio) => {
    const d = Math.hypot(w.x - x, w.y - y);
    if (d > (raio || snapMil())) return;
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
  for (const j of s.junctions) tenta(j.x, j.y, 'junction', 'junção', 1, null, rPonto);
  for (const p of s.powers)    tenta(p.x, p.y, 'power', p.net || 'power', 1, null, rPonto);
  for (const p of s.ports)     tenta(p.x, p.y, 'port', p.net || 'port', 1, null, rPonto);
  for (const wi of s.wires) for (const p of (wi.pts || [])) tenta(p[0], p[1], 'wire', 'fio', 2, null, rPonto);
  /* peso 3: ponta de fio, pino e juncao ganham do meio quando estao no alcance. Ao longo do fio
     o ponto cai no passo da grade (e dentro do trecho); no trecho em diagonal, na projecao.
     O MEIO e uma LINHA, e nao um ponto: com o raio do snapMil() (piso de 20 mil) as grades de
     10 mil, 0,5 mm e 0,25 mm tinham o passo vizinho de TODO fio dentro do alcance, e o fio
     puxado em paralelo a um passo de outro caia em cima dele — ligando duas nets sem que a mao
     pedisse. A distancia ATE a linha fica abaixo de meio passo; pino, ponta e juncao, que sao
     pontos, continuam com o snapMil(). */
  const rMeio = Math.min(snapMil(), grade.passo * 0.45);
  if (comMeio) for (const wi of s.wires){
    const pts = wi.pts || [];
    for (let i = 0; i < pts.length - 1; i++){
      const a = pts[i], b = pts[i + 1];
      if (HubCore.distSeg(w.x, w.y, a[0], a[1], b[0], b[1]) > rMeio) continue;
      const x1 = Math.min(a[0], b[0]), x2 = Math.max(a[0], b[0]), y1 = Math.min(a[1], b[1]), y2 = Math.max(a[1], b[1]);
      let q;
      if (Math.abs(a[1] - b[1]) <= STOL_SCH) q = [Math.min(Math.max(snapG(w.x), x1), x2), a[1]];
      else if (Math.abs(a[0] - b[0]) <= STOL_SCH) q = [a[0], Math.min(Math.max(snapG(w.y), y1), y2)];
      else {
        const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
        const t = Math.max(0, Math.min(1, ((w.x - a[0]) * vx + (w.y - a[1]) * vy) / L2));
        q = [a[0] + vx * t, a[1] + vy * t];
      }
      tenta(q[0], q[1], 'fio-meio', 'fio', 3);
    }
  }
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
  /* O que esta EM CIMA de um pino que viaja nao e filtrado aqui: o filtro e POR PAR, no
     imaDoArrasto (o pino nao gruda no que estava debaixo dele mesmo). */
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
/* ── O FIO NAO VEM JUNTO ──
   Houve um ELASTICO aqui: os vertices de fio em cima dos pinos do componente que viajava andavam
   com ele, como no Altium. Saiu a pedido do usuario (2026-09-24: "quero poder movimentar o
   componente sem a trilha vir junto, a nao ser que eu selecione ela"). Agora o componente anda
   SOZINHO; o fio so anda se estiver na selecao (o laco e o Ctrl+A pegam os dois). A net se
   desfaz quando o pino sai da ponta do fio — e o que se pediu, e a lista de nets mostra.
   O que sobrou do elastico sao AS PONTAS: quais vertices estavam em cima dos pinos na partida.
   Elas nao se movem mais, mas duas coisas precisam saber delas: o ima (que nao pode mirar a
   propria ponta, senao o componente volta para a origem) e as guias (que alinham o pino com o
   fio que ele deixou — e assim que se volta a encostar nele).
   Montado UMA vez por gesto: varrer os pinos de 200 componentes a cada quadro engasga o arrasto.
   Fio que ja esta na selecao fica de fora — ele anda pela base. */
function pontasNosPinos(base){
  const s = model.sheets[sheetIdx], out = [], pinos = [];
  /* SO o componente que esta viajando INTEIRO tem pinos que saem do lugar: arrastar o texto do
     designador e um alvo DO COMPONENTE, mas os pinos ficam. */
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
function imaDoArrasto(g, dx, dy, fixo){
  if (!g || !g.pinos.length || !g.alvos.length) return null;
  let best = null;
  for (const p of g.pinos){
    const px = p.x + dx, py = p.y + dy;
    for (const a of g.alvos){
      /* O PINO NAO GRUDA NO QUE ESTAVA DEBAIXO DELE: a ponta de fio, o GND, a port ou o pino
         vizinho encostados ali estao a distancia ZERO na partida, e puxavam o componente de
         volta em todo arrasto menor que snapMil() — uma zona morta que engolia os ajustes finos
         (42 dos 1428 componentes dos projetos, medido em 2026-09-24). E POR PAR, e nao global:
         o filtro antigo tirava o alvo de TODOS os pinos, e o conector deslocado um passo ao
         longo da fileira nao grudava mais o pino 1 no GND que estava no pino 2. Voltar a
         encostar no proprio ponto continua possivel pelas guias. p.x/p.y sao a partida. */
      if (pertoDe(a.x, a.y, p.x, p.y)) continue;
      const d = Math.hypot(px - a.x, py - a.y);
      if (d > snapMil() || (best && d >= best.d)) continue;
      /* NO TRILHO DO SHIFT so concorre o alvo que esta na linha do pino. Filtrar DEPOIS de
         escolher o mais perto nao serve: um alvo fora da linha, mais perto, era escolhido,
         recusado, e o alvo da linha nunca era considerado — o pino pousava desligado a 15 mil
         do fio que devia pegar. dx/dy ja trazem o eixo preso, entao a linha e p.x/p.y. */
      if (fixo && ((fixo.x && Math.abs(a.x - px) > STOL_SCH) || (fixo.y && Math.abs(a.y - py) > STOL_SCH))) continue;
      best = { d, dx: dx + (a.x - px), dy: dy + (a.y - py), x:a.x, y:a.y,
               label: (p.num ? p.ref + '-' + p.num : p.ref) + ' → ' + a.label };
    }
  }
  return best;
}
/* ── AS GUIAS DO ARRASTO (hub-guias.js) ──
   O ima gruda PONTO em PONTO, nos dois eixos, e so quando o pino chega em cima do alvo. As
   guias sao a outra metade do arrasto, pedida em 2026-09-24: alinham POR EIXO (a borda, o
   centro, a fileira de pinos que deixa o fio reto), acham o espaco igual e mostram o vao ate
   cada vizinho — como no Figma. O ima continua mandando: quando ele pega, a guia so mostra o
   que coincidiu. O Ctrl apertado solta a guia (o ima fica).
   O que se move e o que esta parado sao medidos UMA vez por gesto, no primeiro movimento de
   verdade (o clique que nao arrasta nao paga nada), na posicao de PARTIDA — e isso que deixa
   cada quadro barato. */
const GUIAS = typeof HubGuias !== 'undefined' ? HubGuias : null;
const PONTO_DE_LIGACAO = { power:1, port:1, netlabel:1, junction:1 };
function guiasDoGesto(base){
  const s = model.sheets[sheetIdx];
  const movComp = new Set(), fioMove = new Map(), pontos = [], textos = [];
  let caixa = null;
  const soma = b => { caixa = !caixa ? { x1:b.x1, y1:b.y1, x2:b.x2, y2:b.y2 }
    : { x1:Math.min(caixa.x1, b.x1), y1:Math.min(caixa.y1, b.y1), x2:Math.max(caixa.x2, b.x2), y2:Math.max(caixa.y2, b.y2) }; };
  /* os vertices de cada fio que ANDAM neste gesto; os outros do mesmo fio sao alvo */
  const marcaFio = (w, i) => {
    const m = fioMove.get(w);
    if (m === 'todos') return;
    if (i === 'todos'){ fioMove.set(w, 'todos'); return; }
    if (m) m.add(i); else fioMove.set(w, new Set([i]));
  };
  for (const b of base.values()){
    const a = b.a, it = a.it;
    if (a.k === 'ref' || a.k === 'com'){ textos.push(a); continue; }
    if (it.t === 'comp'){
      movComp.add(it); soma(compBBox(it));
      for (const p of (HubCore.compPinsWorld(it, SLIB) || [])) pontos.push({ x:p.x, y:p.y, nome:it.ref + '-' + p.num });
    } else if (it.t === 'wire'){
      const pts = b.pts || [];
      if (a.k === 'vert'){
        marcaFio(it, a.i);
        if (pts[a.i]) pontos.push({ x:pts[a.i][0], y:pts[a.i][1], nome:'fio' });
      } else if (a.k === 'seg'){
        const p = pts[a.i], q = pts[a.i + 1];
        if (!p || !q) continue;
        const eixos = eixosDoTrecho(pts, a.i);
        marcaFio(it, a.i); marcaFio(it, a.i + 1);
        pontos.push({ x:p[0], y:p[1], nome:'fio', eixos }, { x:q[0], y:q[1], nome:'fio', eixos });
      } else {
        marcaFio(it, 'todos');
        for (const p of pts) pontos.push({ x:p[0], y:p[1], nome:'fio' });
      }
    } else if (PONTO_DE_LIGACAO[it.t]) pontos.push({ x:b.x, y:b.y, nome:it.net || describe(a) });
  }
  /* os fios que estavam nos pinos entram SEMPRE, com todos os vertices (inclusive a ponta que o
     pino deixou): alinhar o pino com eles e o que deixa o fio reto, ou o reencosta */
  const fiosDosPinos = new Set((base.pontas || []).map(e => e.w));
  let tipoCaixa = caixa ? 'comp' : null;
  if (!caixa && textos.length){
    for (const a of textos) soma(textoBBox(a.it, a.k));
    tipoCaixa = 'texto';
  }
  const fixos = { caixas:[], pontos:[], sempre:[], folha: caixa ? sheetBBox() : null };
  if (tipoCaixa === 'texto'){
    /* texto alinha com o texto do MESMO tipo dos outros componentes, e so com o que esta a vista */
    const movendo = new Set(textos.map(chaveAlvo)), tipos = new Set(textos.map(a => a.k));
    for (const c of s.comps) for (const k of tipos){
      if (movendo.has(chaveAlvo({ it:c, k }))) continue;
      if (k === 'ref' ? !(showState.ref && designadorVisivel(c)) : !(showState.comment && c.comment)) continue;
      fixos.caixas.push(Object.assign(textoBBox(c, k), { nome:c.ref, tipo:'texto' }));
    }
  } else {
    for (const c of s.comps){
      if (movComp.has(c)) continue;
      const pinos = pontos.length ? (HubCore.compPinsWorld(c, SLIB) || []) : [];
      fixos.caixas.push(Object.assign(compBBox(c), { nome:c.ref, tipo:'comp',
        pontos: pinos.map(p => ({ x:p.x, y:p.y, nome:c.ref + '-' + p.num })) }));
    }
  }
  if (pontos.length){
    for (const w of s.wires){
      const m = fioMove.get(w);
      if (m === 'todos') continue;
      const lista = m || fiosDosPinos.has(w) ? fixos.sempre : fixos.pontos;
      (w.pts || []).forEach((p, i) => { if (!(m && m.has(i))) lista.push({ x:p[0], y:p[1], nome:'fio' }); });
    }
    for (const arr of [s.junctions, s.powers, s.ports, s.netlabels])
      for (const it of arr) if (!base.itens.has(it)) fixos.pontos.push({ x:it.x, y:it.y, nome:it.net || describe(it) });
  }
  return { G: GUIAS.prepara({ caixa, tipoCaixa, pontos }, fixos, { eps:0.1 }), livre: eixosLivres(base) };
}
/* os eixos em que ALGUM alvo do gesto anda — medido sobre TODOS os alvos, e nao so sobre os que
   tem guia: No ERC e texto livre nao tem guia nenhuma e andam nos dois eixos. So o trecho travado
   do moveSegmento, sozinho, deixa de andar num eixo. Nao depende das guias: o Shift precisa
   disto com elas desligadas tambem. */
function eixosLivres(base){
  let x = false, y = false;
  for (const b of base.values()){
    const ex = b.a.it.t === 'wire' && b.a.k === 'seg' ? eixosDoTrecho(b.pts || [], b.a.i) : 'xy';
    if (ex.indexOf('x') >= 0) x = true;
    if (ex.indexOf('y') >= 0) y = true;
  }
  return { x, y };
}
/* a medida na unidade da grade escolhida: quem arruma a folha em 1 mm pensa em mm */
function fmtMedida(v){
  const mm = /mm$/.test(grade.id), casas = mm ? 2 : 1, f = Math.pow(10, casas);
  const n = Math.round((mm ? v / MM_MIL : v) * f) / f;
  return n.toLocaleString('pt-BR', { maximumFractionDigits:casas }) + (mm ? ' mm' : ' mil');
}
/* o deslocamento do arrasto passado pelas guias. null quando nao ha guia a medir — elas estao
   desligadas no botao da vista, o hub-guias.js nao carregou, ou o gesto so leva o que nao tem
   guia (No ERC, texto livre) — e ai o arrasto e o de sempre: o cursor, e a grade ao soltar */
function guiasDoArrasto(d, dx, dy, e, trava, fixo){
  if (!GUIAS || !showState.guias) return null;
  if (!d.guias) d.guias = guiasDoGesto(d.base);
  if (!d.guias.G.box0) return null;
  /* o eixo em que nada do gesto anda (o trecho travado) fica parado aqui tambem: a vizinhanca,
     os × e a extensao da guia sao medidos onde o trecho ESTA, e nao onde o cursor esta */
  const lv = d.guias.livre, sx = v => lv.x ? v : 0, sy = v => lv.y ? v : 0;
  return GUIAS.resolve(d.guias.G, sx(dx), sy(dy), { escala:cam.cam.scale, grade:snapG,
                       trava: trava ? { dx:sx(trava.dx), dy:sy(trava.dy) } : null,
                       fixo: fixo ? { x: lv.x ? fixo.x : null, y: lv.y ? fixo.y : null } : null,
                       desliga:!!(e && e.ctrlKey), fmt:fmtMedida });
}
/* ── O SHIFT: ANDAR RETO NO TRILHO DA GUIA ──
   Pedido de 2026-09-24: "se enquanto eu estiver movimentando eu apertar Shift ele trava no eixo
   centralizado, pra eu movimentar reto na direção do alinhamento".
   Com uma guia pegando, o Shift PRENDE o eixo dela: guia vertical (mesmo X) — o X fica e a peca
   so anda em Y; guia horizontal — so anda em X. No trilho o outro eixo continua achando guia
   (sobe pela vertical ate alinhar com o vizinho de cima). Com as duas guias pegando, quem decide
   e a mao: os primeiros SHIFT_DECIDE_PX de movimento escolhem a direcao, e ate la a peca fica.
   Sem guia nenhuma (ou com as guias desligadas) e o "anda reto" de sempre: so na horizontal ou
   so na vertical, a partir de onde a peca estava, conforme a mao mais andou.
   O trilho e a guia que estava pegando QUANDO o Shift desceu (d.ultGuia), e nao a proxima que
   aparecer no caminho. Com o IMA do pino pegando, o trilho e o lugar em que ele pos a peca, nos
   dois eixos (a mao escolhe a direcao) — sem isso a peca voltava para a linha de partida.
   O Shift nunca prende o UNICO eixo em que o gesto anda (o trecho de fio travado pelo
   moveSegmento): com o outro eixo ja parado, prender este congelava o gesto inteiro.
   Soltar o Shift devolve o movimento livre. */
const SHIFT_DECIDE_PX = 4;
function fixoDoShift(d, dx, dy, e){
  if (!(e && e.shiftKey)){ d.shift = null; return null; }
  const lv = d.livre || (d.livre = eixosLivres(d.base));
  if (!d.shift){
    const g = d.ultGuia || {};
    /* candidato de guia, ou o lugar do ima; o 'fixo' do proprio Shift nao vira trilho */
    const vale = c => c && (c.tipo !== 'fixo' || c.ima) ? c : null;
    /* trilho em X deixa andar em Y: so serve se Y anda; e vice-versa */
    const gx = lv.y ? vale(g.x) : null, gy = lv.x ? vale(g.y) : null;
    d.shift = gx && gy ? { ambos:{ x:gx, y:gy }, dx, dy }
            : gx ? { fixo:{ x:gx } } : gy ? { fixo:{ y:gy } } : { reto:true };
  }
  const s = d.shift;
  if (s.fixo) return s.fixo;
  if (s.ambos){
    const mx = Math.abs(dx - s.dx), my = Math.abs(dy - s.dy);
    if (Math.max(mx, my) * cam.cam.scale < SHIFT_DECIDE_PX) return s.ambos;
    s.fixo = mx >= my ? { y:s.ambos.y } : { x:s.ambos.x };     /* a mao andou em X: o Y e o trilho */
    return s.fixo;
  }
  /* o "anda reto": a mao escolhe so quando os dois eixos andam */
  if (!lv.x && !lv.y) return null;
  const emX = lv.x && (!lv.y || Math.abs(dx) >= Math.abs(dy));
  return emX ? { y:{ tipo:'fixo', delta:0 } } : { x:{ tipo:'fixo', delta:0 } };
}
/* a frase do Shift na barra: para onde a peca ainda pode andar */
function dicaDoShift(f){
  if (!f) return '';
  if (f.x && f.y) return 'Shift: mova para escolher a direção';
  return f.x ? 'Shift: só na vertical' : 'Shift: só na horizontal';
}
/* ── O POUSO ──
   Onde o gesto cai se a mao soltar AGORA. O ima manda: e ele que faz o pino cair em cima da ponta
   do fio, e 100 mil de grade contados da posicao antiga jogariam o pino fora dela de novo. Sem
   ima, cada eixo pousa onde a guia mandou (a MESMA conta que desenhou as medidas durante o
   arrasto: o numero que se viu e o que fica), e o eixo que nenhuma guia pegou cai na grade
   contada da posicao original, ou no trilho do Shift, que vale no soltar tambem.
   Tres lugares precisam do mesmo numero: o leftUp (que pousa), a previa da rota no leftMove e a
   tecla D (que pousa e liga os fios). Com uma conta em cada um, a previa podia prometer um fio
   que o D nao faz. O leftMove ja tem as pecas na mao (o ima e a guia do quadro) e usa so o
   pousoDe; com o ima pegando, a guia dele veio com trava, mas ai quem decide e o ima. */
function pousoDe(m, g, fixo, fx, fy, rx, ry){
  if (m) return { dx:m.dx, dy:m.dy };
  if (g) return { dx:g.lx, dy:g.ly };
  return { dx: fixo && fixo.x ? fx : snapG(rx), dy: fixo && fixo.y ? fy : snapG(ry) };
}
function pousoDoArrasto(d, e){
  const w = e ? worldOf(e) : d.start;
  const rx = w.x - d.start.x, ry = w.y - d.start.y;
  const fixo = fixoDoShift(d, rx, ry, e);
  const fx = fixo && fixo.x ? fixo.x.delta : rx, fy = fixo && fixo.y ? fixo.y.delta : ry;
  const m = imaDoArrasto(d.ima, fx, fy, fixo);
  return pousoDe(m, m ? null : guiasDoArrasto(d, fx, fy, e, null, fixo), fixo, fx, fy, rx, ry);
}
/* ── O D: ROTEAR ATE OS FIOS ALINHADOS (a conta e o pontasSoltas/paresDeRota/ligaPonta) ──
   A folha PARADA e medida uma vez por gesto, no primeiro quadro, como as guias: os fios que nao
   viajam, as pontas soltas deles e os pontos eletricos. Rotulo de net nao liga e fica de fora.
   O que viaja e o que tem geometria andando: arrastar so o designador deixa os pinos onde estao. */
const ELETRICO = { junction:1, power:1, port:1 };
function rotaDoGesto(base){
  const s = model.sheets[sheetIdx], anda = new Set();
  for (const b of base.values()) if (b.a.k !== 'ref' && b.a.k !== 'com') anda.add(b.a.it);
  const fios = s.wires.filter(w => !anda.has(w)), pontos = [];
  for (const c of s.comps){
    if (anda.has(c)) continue;
    for (const p of (HubCore.compPinsWorld(c, SLIB) || [])) pontos.push({ x:p.x, y:p.y });
  }
  for (const arr of [s.junctions, s.powers, s.ports])
    for (const it of arr) if (!anda.has(it)) pontos.push({ x:it.x, y:it.y });
  /* para o trecho novo, o vertice de fio parado tambem e ponto eletrico */
  const eletricos = pontos.slice();
  for (const w of fios) for (const p of (w.pts || [])) eletricos.push({ x:p[0], y:p[1] });
  return { fios, pontas: pontasSoltas(fios, pontos), eletricos };
}
/* as pontas quentes de um componente com a direcao de cada pino, do corpo para fora */
function pinosComDirecao(c){
  const quentes = HubCore.compPinsWorld(c, SLIB) || [];
  if (!quentes.length) return [];
  const part = HubCore.partOf(HubCore.symbolOf(SLIB, c.sym), c.part);
  const tf = HubCore.compTransform(c), pins = (part && part.pins) || [];
  return quentes.map((p, k) => {
    const corpo = pins[k] ? tf.map(pins[k].x, pins[k].y) : p;
    return { x:p.x, y:p.y, ref:c.ref, num:p.num, ox:p.x - corpo.x, oy:p.y - corpo.y };
  });
}
/* Os pares do D com o gesto no pouso `p`. DEIXA A BASE NO POUSO: o leftMove a devolve para onde
   a mao esta logo depois, e o D a deixa la. So o componente que viaja INTEIRO tem pinos que andam.
   O alcance e o das guias (o que esta a vista), com piso de 100 mil. */
function rotasNoPouso(d, p){
  const viaja = [];
  for (const b of d.base.values()) if (b.a.k === 'all' && b.a.it.t === 'comp') viaja.push(b.a.it);
  if (!viaja.length) return [];
  if (!d.rota) d.rota = rotaDoGesto(d.base);
  if (!d.rota.pontas.length) return [];
  applyMove(d.base, p.dx, p.dy);
  const pinos = [], caixas = [], extra = [];
  viaja.forEach((c, k) => {
    caixas.push(compBBox(c));
    for (const q of pinosComDirecao(c)) pinos.push(Object.assign(q, { caixa:k }));
  });
  /* o resto do que viaja (fio, power, port, juncao) tambem e obstaculo, onde ele pousa */
  for (const b of d.base.values()){
    const it = b.a.it;
    if (it.t === 'wire') for (const q of (it.pts || [])) extra.push({ x:q[0], y:q[1] });
    else if (b.a.k === 'all' && ELETRICO[it.t]) extra.push({ x:it.x, y:it.y });
  }
  const alcance = Math.max((GUIAS ? GUIAS.ALCANCE_PX : 600) / cam.cam.scale, 100);
  return paresDeRota(pinos, d.rota.pontas, caixas, extra.length ? d.rota.eletricos.concat(extra) : d.rota.eletricos,
                     alcance, d.rota.fios);
}
/* a frase da barra, com a tecla que estiver gravada (o D e o padrao). Os pinos vao em ordem de
   designador e numero: a ordem do desenho poe o pino 2 antes do 1 em muito resistor da casa */
function fraseDaRota(rotas){
  if (!rotas || !rotas.length) return '';
  const nomes = rotas.map(r => r.pino.ref + '-' + r.pino.num)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric:true, sensitivity:'base' }));
  return (ATALHOS.porAcao.rotear || 'D') + ': rotear ' + nomes.join(', ');
}
/* A TECLA D no meio do arrasto: pousa a selecao onde o soltar pousaria, estica cada fio ate o seu
   pino e encerra o gesto, tudo num passo so de desfazer. Sem par, avisa e o arrasto continua.
   Fora do arrasto nao faz nada (false: o teclado segue adiante). */
function rotearNoArrasto(){
  const d = mouse;
  if (!d || d.mode !== 'move' || !d.moved || !d.ult) return false;
  const rotas = rotasNoPouso(d, pousoDoArrasto(d, d.ult));
  if (!rotas.length){
    refazGesto();      /* a conta pode ter deixado a peca no pouso: ela volta para baixo da mao */
    HubDialog.toast('nenhum pino alinhado com ponta de fio', 'warn');
    return;
  }
  /* a peca ja esta no pouso; o fio estica. As duas pontas do mesmo fio podem entrar: o indice da
     ultima e medido na hora, porque esticar a primeira pode ter posto um vertice na frente */
  const mexidos = new Set();
  for (const r of rotas){
    const w = d.rota.fios[r.ponta.wi];
    w.pts = ligaPonta(w.pts, r.ponta.i === 0 ? 0 : w.pts.length - 1, r.pino.x, r.pino.y);
    mexidos.add(w);
  }
  for (const w of mexidos) w.pts = HubFio.limpa(w.pts);
  /* o gesto acaba aqui: o mouseup que vem depois nao acha gesto, e o click e engolido */
  mouse = null; moveIma = null; swallowClick = true;
  $('shover').textContent = '';
  commit();
  const refs = Array.from(new Set(rotas.map(r => r.pino.ref))).join(', ');
  HubDialog.toast(refs + ': ' + rotas.length + (rotas.length === 1 ? ' pino roteado' : ' pinos roteados'), 'ok');
}
/* ── O FIO, COMO NO ALTIUM (hub-fio.js tem a regra; aqui e so o mouse, o teclado e a folha) ──
   Pedido de 2026-09-24, com um video do Altium: "quero que a construcao de trilha funcione
   assim no esquema, igualzinho". Do ultimo ponto fixado saem duas pernas em L ate o cursor; o
   clique fixa SO a primeira, e a seguinte sai perpendicular; clicar num ponto eletrico completa
   o L ate ele e termina o fio; botao direito, Esc ou duplo clique terminam no que ja foi
   fixado, e a ferramenta continua na mao para o proximo fio (um segundo direito/Esc a larga);
   Espaco inverte o canto, Shift+Espaco troca o modo (90°, 45°, livre), Backspace desfaz o canto.
   Onde o cursor vai: o ponto eletrico em alcance (pino, ponta ou meio de fio, juncao, power,
   port), senao o passo da grade. */
function pontoDoFio(w){
  const hs = snapPoint(w, true);
  if (hs) return { pt:[hs.x, hs.y], snap:hs };
  return { pt:[snapG(w.x), snapG(w.y)], snap:null };
}
const primeiroDoModo = () => fioModo.modo === '45' ? fioModo.p45 : fioModo.p90;
const gravaFioModo = () => { try { localStorage.setItem(FIO_MODO_KEY, JSON.stringify(fioModo)); } catch (e) {} };
/* o ultimo clique da ferramenta, fora do fio: a barra mede dX/dY a partir dele tambem ENTRE um
   fio e outro, como a do Altium */
let fioUltClique = null;
function wireClick(w){
  const r = pontoDoFio(w);
  fioCursor = r;
  fioUltClique = r.pt.slice();
  if (!wireDraw){
    /* a partida que encostou num ponto eletrico ganha a bolinha magenta do Altium */
    wireDraw = Object.assign(HubFio.novo(r.pt, fioModo.modo, primeiroDoModo()), { ligado: !!r.snap });
    statusDoFio(); cam.draw();
    return;
  }
  const A = wireDraw.pts[wireDraw.pts.length - 1];
  if (r.pt[0] === A[0] && r.pt[1] === A[1]) return;
  const ligado = wireDraw.ligado;
  /* CLICOU NUM PONTO ELETRICO: o L inteiro ate ele, e o fio acaba ali */
  if (r.snap){ wireDraw = Object.assign(HubFio.completa(wireDraw, r.pt), { ligado }); endWire(); return; }
  wireDraw = Object.assign(HubFio.fixa(wireDraw, r.pt), { ligado });
  statusDoFio(); cam.draw();
}
/* termina no que ja foi fixado — as pernas soltas ate o cursor nao entram, como no Altium */
function endWire(){
  const d = wireDraw; wireDraw = null;
  /* O CANTO PASSA PARA O PROXIMO FIO. O Altium alterna "90 Degree start/end" a cada clique e
     o proximo fio sai no canto em que este parou; recomecar sempre do lado do Espaco fazia o
     fio seguinte sair ao contrario do Altium (o video, aos 12 s). */
  if (d && d.modo === fioModo.modo){
    if (d.modo === '90') fioModo.p90 = d.primeiro; else if (d.modo === '45') fioModo.p45 = d.primeiro;
    gravaFioModo();
  }
  const pts = d ? HubFio.limpa(d.pts) : [];
  if (pts.length >= 2){
    schematic.items.push({ t:'wire', sheet:model.sheets[sheetIdx].name, pts });
    commit();
  } else cam.draw();
  statusDoFio();
}
/* ESPACO inverte o canto; SHIFT+ESPACO troca o modo. Sem fio em curso, vale para o proximo. */
function espacoDoFio(shift){
  const est = wireDraw || HubFio.novo([0, 0], fioModo.modo, primeiroDoModo());
  const novo = shift ? HubFio.trocaModo(est, fioModo) : HubFio.trocaCanto(est);
  fioModo.modo = novo.modo;
  if (novo.modo === '90') fioModo.p90 = novo.primeiro; else if (novo.modo === '45') fioModo.p45 = novo.primeiro;
  gravaFioModo();
  if (wireDraw) wireDraw = Object.assign(novo, { ligado: wireDraw.ligado });
  statusDoFio(); cam.draw();
}
/* BACKSPACE desfaz o ultimo canto; sem canto fixado, o fio em curso acaba (sem gravar nada) */
function backspaceDoFio(){
  const ligado = wireDraw.ligado, d = HubFio.desfaz(wireDraw);
  wireDraw = d ? Object.assign(d, { ligado }) : null;
  statusDoFio(); cam.draw();
}
/* a barra de status do fio: o ponto eletrico sob o cursor, o modo, dX/dY desde o ultimo clique
   (na unidade da grade), e as teclas — o Altium diz "Shift + Space to change mode" ali mesmo */
function statusDoFio(){
  if (tool !== 'wire') return;
  const r = fioCursor;
  const est = wireDraw || { modo: fioModo.modo, primeiro: primeiroDoModo() };
  const partes = ['Fio ' + HubFio.nomeDoModo(est)];
  const ult = wireDraw ? wireDraw.ult : fioUltClique;
  if (ult && r) partes.push('dX ' + fmtMedida(r.pt[0] - ult[0]) + '  dY ' + fmtMedida(r.pt[1] - ult[1]));
  partes.push(wireDraw ? 'clique fixa o canto · Backspace desfaz · direito/Esc termina'
                       : 'clique para começar · direito/Esc larga a ferramenta');
  partes.push('Espaço inverte · Shift+Espaço muda o modo');
  const txt = partes.join(' · ');
  if (r && r.snap && r.snap.html){
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    $('shover').innerHTML = '⊙ ' + r.snap.html + ' · ' + esc(txt);
  } else $('shover').textContent = (r && r.snap ? '⊙ ' + r.snap.label + ' · ' : '') + txt;
}
/* O No ERC pousa onde o ima mandar — e o ponto que ele marca precisa ser EXATAMENTE a
   ponta quente do pino, senao o Altium recebe a diretiva ao lado do pino e o ERC
   continua reclamando do mesmo pino. Sem ima, grade de 100 mil como o resto. */
function placeNoERC(w){
  const hs = snapPoint(w, false);
  schematic.items.push({ t:'noerc', sheet:model.sheets[sheetIdx].name,
                         x: hs ? hs.x : snapG(w.x), y: hs ? hs.y : snapG(w.y) });
  commit();
}
function placePower(w){
  const hs = snapPoint(w, true);
  const p = toolPower;
  schematic.items.push({ t:'power', sheet:model.sheets[sheetIdx].name, net:p.net, style:p.style,
                         x: hs ? hs.x : snapG(w.x), y: hs ? hs.y : snapG(w.y), rot:p.rot });
  commit();
}
/* O rotulo de net: uma palavra pousada na folha. Quem une dois rotulos de mesmo nome e o
   extractNets (fusao por nome), nao esta funcao — aqui e so pousar. */
function placeLabel(w){
  if (!toolNet) return;
  const hs = snapPoint(w, true);
  schematic.items.push({ t:'netlabel', sheet:model.sheets[sheetIdx].name, net:toolNet,
                         x: hs ? hs.x : snapG(w.x), y: hs ? hs.y : snapG(w.y), rot:0 });
  commit();
}
/* ------- a gaveta dos pousos -------
   GND, 3V3, 5V5, VIN, o rotulo de net e o No ERC moram num botao so, como na Active Bar do
   Altium: a FACE e o ultimo pouso usado — clicar nela usa de novo —, e a setinha no canto (ou
   o botao direito na face) abre a gaveta com os seis. Os itens sao os botoes de antes, com os
   mesmos ids e listeners: clicar na face e clicar no item que ela mostra. Por isso a net pela
   face passa pelo campo da palavra, como sempre (o rotulo nao existe sem ela).
   A face e pintada no setTool, e nao no clique: as teclas (G, L, N) escolhem a ferramenta sem
   tocar em botao nenhum, e a face tem de mostrar o que esta na mao. */
const GAV_KEY = 'altiumhub.sch.pouso';
let gavFace = 'GND';
try { gavFace = localStorage.getItem(GAV_KEY) || 'GND'; } catch (e) {}
const gavItens = () => [...$('gavPousoLista').querySelectorAll('button')];
const gavChave = b => b.dataset.net || b.id;
const gavItem = k => gavItens().find(b => gavChave(b) === k) || gavItens()[0];
const gavAberta = () => !$('gavPousoLista').hidden;
function gavAbre(sim){
  $('gavPousoLista').hidden = !sim;
  $('tbPousoSeta').setAttribute('aria-expanded', String(sim));
}
/* o item da gaveta que corresponde a ferramenta na mao, ou null */
function gavDaFerramenta(t, pw){
  if (t === 'power' && pw) return gavItens().find(b => b.dataset.net === pw.net) || null;
  if (t === 'label') return $('tbNet');
  if (t === 'noerc') return $('tbNoErc');
  return null;
}
function pintaGaveta(t, pw){
  const ativo = gavDaFerramenta(t, pw);
  if (ativo && gavChave(ativo) !== gavFace){
    gavFace = gavChave(ativo);
    try { localStorage.setItem(GAV_KEY, gavFace); } catch (e) {}
  }
  /* A FACE TEM LARGURA FIXA: ela leva os seis rotulos empilhados numa celula so e mostra o da
     vez, entao mede sempre o mais largo. Com o rotulo sozinho ela ia de "net" a "No ERC" e a
     barra inteira pulava ate 26 px a cada troca — o Adicionar saia de baixo do cursor. */
  const it = gavItem(gavFace), face = $('tbPouso'), rot = el('span', 'gav-rot');
  for (const b of gavItens()){
    const lb = b.querySelector('.lb').cloneNode(true);
    if (b !== it) lb.classList.add('fora');
    rot.append(lb);
  }
  face.replaceChildren(it.querySelector('svg').cloneNode(true), rot);
  face.title = it.title + ' · a setinha (ou o botão direito) abre os outros pousos';
  face.setAttribute('aria-pressed', String(!!ativo));
}
$('tbPouso').addEventListener('click', () => { gavAbre(false); gavItem(gavFace).click(); });
/* O botao direito vale na gaveta inteira: na face e na setinha abre e fecha; num item so nao
   deixa o menu do navegador subir. O pan pelo botao direito que termina solto em cima da face
   tambem dispara um contextmenu (no Windows ele sai no mouseup, onde o cursor estiver): esse
   nao e pedido de gaveta, e o listener da window o engole. */
$('gavPouso').addEventListener('contextmenu', e => {
  if (panning) return;
  e.preventDefault();
  if (!$('gavPousoLista').contains(e.target)) gavAbre(!gavAberta());
});
$('tbPousoSeta').addEventListener('click', () => gavAbre(!gavAberta()));
/* escolher um item fecha a gaveta; o listener do proprio item (mais abaixo) ja agiu */
$('gavPousoLista').addEventListener('click', e => { if (e.target.closest('button')) gavAbre(false); });
/* clicar fora fecha. Em CAPTURA na window: o canvas engole o mousedown com
   stopImmediatePropagation, e um listener em bolha nunca veria o clique na folha. */
window.addEventListener('mousedown', e => {
  if (!gavAberta() || $('gavPouso').contains(e.target)) return;
  gavAbre(false);
  /* NA FOLHA, O CLIQUE QUE FECHA A GAVETA NAO FAZ MAIS NADA, como no Altium: sem isto ele
     pousava o pouso armado (ou fixava um canto do fio) em quem so queria desistir da gaveta.
     O mousedown para aqui, antes da captura do canvas, e o click que vem depois e engolido
     pelo swallowClick, que o leftClick respeita. */
  if (e.target === cv && e.button === 0){ e.stopImmediatePropagation(); swallowClick = true; }
}, true);
window.addEventListener('blur', () => gavAbre(false));
pintaGaveta(tool, toolPower);     /* a face nasce com o ultimo pouso usado nesta maquina */
function setTool(t, pw){
  /* O FIO EM CURSO E GRAVADO, como no Esc e no botao direito: no Altium o trecho fixado ja
     esta no documento, e trocar de ferramenta (W, G, os botoes da barra) nao o apaga. Aqui ele
     sumia calado, sem undo que o trouxesse de volta. */
  if (wireDraw) endWire();
  /* a barra do fio ("clique para comecar · direito/Esc larga a ferramenta") nao pode ficar
     falando de uma ferramenta que ja foi largada */
  if (tool === 'wire' && t !== 'wire') $('shover').textContent = '';
  tool = t; toolPower = pw || null; wireDraw = null; snapHit = null; fioCursor = null;
  soFio = false;        /* toda troca de ferramenta larga o "so fios" — quem o quer liga depois (setSoFio) */
  if (t !== 'label') toolNet = '';
  pintaSelecao();
  $('tbWire').setAttribute('aria-pressed', String(t === 'wire'));
  $('tbNet').setAttribute('aria-pressed', String(t === 'label'));
  $('tbNoErc').setAttribute('aria-pressed', String(t === 'noerc'));
  for (const b of document.querySelectorAll('#schtb .pw'))
    b.setAttribute('aria-pressed', String(t === 'power' && !!pw && b.dataset.net === pw.net));
  pintaGaveta(t, pw);
  cv.style.cursor = t !== 'select' && t !== 'wire' ? 'crosshair' : 'default';
  if (t === 'wire') statusDoFio();
  cam.draw();
}
/* Selecionar e "so fios" sao dois botoes da mesma ferramenta: um aceso por vez */
function pintaSelecao(){
  $('tbSel').setAttribute('aria-pressed', String(tool === 'select' && !soFio));
  $('tbSoFio').setAttribute('aria-pressed', String(tool === 'select' && soFio));
}
/* O modo "so fios" num lugar so. Ligar passa pelo setTool('select'), que grava o fio em curso
   e larga o pouso como qualquer troca; desligar fica no Selecionar normal. */
function setSoFio(on){
  if (on && tool !== 'select') setTool('select');
  soFio = !!on;
  pintaSelecao();
  $('shover').textContent = soFio ? 'só fios: clique num fio' : '';
  cam.draw();
}
$('tbSel').addEventListener('click', () => setTool('select'));
$('tbSoFio').addEventListener('click', () => setSoFio(!soFio));
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
    /* a sincronização pode ter acabado de renomear um produto: a folha segue pelo id, e isso
       entra no desfazer como qualquer outra edição */
    const ren = seguePeloOdoo(schematic.items, VALOR_DE, n => HubCore.resolveSym(SLIB, n));
    if (ren.length){
      undoStack.push(JSON.stringify(schematic.items));
      if (undoStack.length > 60) undoStack.shift();
      redoStack.length = 0;
      setSchDirty(true);
      avisaRenomeados(ren);
    }
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
             falhas: res.filter(r => !r.ok && !r.l.opcional).map(r => r.l.src),
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
  else if (!arrastou && tool === 'wire') setTool('select');
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
/* O Ctrl solta a guia, e o Shift prende o trilho — e soltar a tecla desfaz — NA HORA, sem
   esperar o mouse andar: o gesto e refeito da ultima posicao do cursor com a tecla no estado
   novo (e a outra como estava) */
for (const tipo of ['keydown', 'keyup'])
  window.addEventListener(tipo, e => {
    if ((e.key !== 'Control' && e.key !== 'Shift') || !mouse || mouse.mode !== 'move' || !mouse.moved || !mouse.ult) return;
    const u = mouse.ult, desce = tipo === 'keydown';
    leftMove({ clientX:u.clientX, clientY:u.clientY,
               ctrlKey:  e.key === 'Control' ? desce : !!u.ctrlKey,
               shiftKey: e.key === 'Shift'   ? desce : !!u.shiftKey });
  });
window.addEventListener('blur', () => {
  if (!mouse) return;
  const girou = mouse.mode === 'move' && girouDeFato(mouse);
  if (mouse.mode === 'move') applyMove(mouse.base, 0, 0);
  mouse = null; boxRect = null;
  moveIma = null; $('shover').textContent = '';
  if (girou) commit(); else cam.draw();
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
  /* O FIO COMO NO ALTIUM (pedido de 2026-09-24, com fotos do Altium): o PRIMEIRO clique pega o
     fio inteiro — a "perninha" que e um fio so fica sozinha na selecao —, e o SEGUNDO clique no
     mesmo fio pega so o pedaco em que ele caiu: o trecho, ou o vertice se foi na alcinha. E o
     pedaco que se move ou apaga. A troca inteiro->pedaco acontece no CLICK (leftClick), e nao
     aqui: apertar num fio ja selecionado e arrastar leva o fio inteiro, como la. So a alcinha de
     vertice troca ja no aperto, para o arrasto mover o canto.
     Ate 2026-09-24 era o contrario — o clique pegava o trecho e o duplo clique promovia a fio
     inteiro —, e num fio comprido nao havia como pegar so a perninha sem pegar um trecho que
     nao era ela. */
  let a = alvoDoHit(h), promover = null;
  if (h.kind === 'wire' && a.k === 'all' && selTem(a) && !e.shiftKey){
    if (h.vert != null) a = { it:h.item, k:'vert', i:h.vert };
    else if (h.seg != null) promover = { it:h.item, k:'seg', i:h.seg };
  }
  const wasSel = selTem(a);
  if (!wasSel){ if (!e.shiftKey) sel.clear(); selAdd(a); }
  lastDown = { alvo:a, wasSel, promover };
  const base = baseOf(selAlvos());
  /* o ima e as pontas sao montados aqui, e nao no primeiro movimento: a folha parada e a
     mesma o gesto inteiro, e varrer os pinos de 200 componentes a cada quadro engasgaria */
  base.pontas = pontasNosPinos(base);
  base.colados = coladosNosPinos(base);
  mouse = { mode:'move', start:w, moved:false, base,
            ima: { alvos: alvosDeIma(base), pinos: pinosDoArrasto(base) } };
  moveIma = null;
  /* A NET ACENDE SO COM ALT+CLIQUE (ou pela lista de nets), como no Altium. O clique simples
     acendia a net inteira de laranja, e pegar uma perninha parecia pegar o circuito todo — era
     a queixa da foto de 2026-09-24. Com Alt, a net entra em foco AQUI, e nao no click: todo
     arrasto engole o click (swallowClick). */
  aplicaSel(e.altKey && !(e.shiftKey && sel.size > 1) ? netDoAlvo(h) : '');
}
/* do que o hitTest devolveu para o alvo que a selecao guarda */
/* (o fio: sem nada dele na selecao, o clique pega ele INTEIRO; com ele inteiro selecionado, o
   pedaco vem no click — leftDown/leftClick; com um PEDACO dele ja selecionado, o clique fica
   no nivel do pedaco e pega o trecho ou o vertice em que caiu) */
function alvoDoHit(h){
  if (h.kind === 'ref' || h.kind === 'com') return { it:h.item, k:h.kind };
  if (h.kind === 'wire'){
    const pedaco = selAlvos().some(a => a.it === h.item && (a.k === 'seg' || a.k === 'vert'));
    if (!pedaco) return alvoAll(h.item);
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
    /* no trilho do Shift o cursor so conta no eixo livre */
    const fixo = fixoDoShift(d, dx, dy, e);
    const fx = fixo && fixo.x ? fixo.x.delta : dx, fy = fixo && fixo.y ? fixo.y.delta : dy;
    moveIma = imaDoArrasto(d.ima, fx, fy, fixo);
    /* as guias grudam por eixo; com o ima pegando, elas so mostram (trava) */
    const g = guiasDoArrasto(d, fx, fy, e, moveIma, fixo);
    d.cena = g ? g.cena : null;
    /* o que esta pegando e o trilho que o Shift vai prender — a guia, ou o lugar em que o ima
       pos a peca — lembrado so FORA do trilho */
    if (!fixo) d.ultGuia = moveIma ? { x:{ tipo:'fixo', delta:moveIma.dx, ima:true }, y:{ tipo:'fixo', delta:moveIma.dy, ima:true } }
                                   : g ? g.guia : null;
    /* a ultima posicao do cursor, com o Ctrl e o Shift: quem refaz o gesto sem o mouse andar
       (as teclas, o giro, o zoom da roda) refaz com o que a mao estava fazendo */
    d.ult = { clientX:e.clientX, clientY:e.clientY, ctrlKey:!!e.ctrlKey, shiftKey:!!e.shiftKey };
    /* a rota do D e medida onde o gesto POUSARIA, que e onde o D o poe; o rotasNoPouso deixa a
       peca la, e o applyMove logo abaixo a devolve para debaixo da mao */
    d.rotas = rotasNoPouso(d, pousoDe(moveIma, g, fixo, fx, fy, dx, dy));
    applyMove(d.base, moveIma ? moveIma.dx : g ? g.dx : fx, moveIma ? moveIma.dy : g ? g.dy : fy);
    const rota = fraseDaRota(d.rotas);
    const frase = [dicaDoShift(fixo), g && g.rotulo ? g.rotulo + ' · Ctrl solta a guia' : '', rota].filter(Boolean).join(' · ');
    $('shover').textContent = moveIma ? '⊙ ' + moveIma.label + (fixo ? ' · ' + dicaDoShift(fixo) : '') + (rota ? ' · ' + rota : '') : frase;
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
    /* ao soltar: ima > guia > grade (ou o trilho do Shift) — a conta e o pousoDoArrasto */
    const p = pousoDoArrasto(d, e);
    applyMove(d.base, p.dx, p.dy);
    moveIma = null; $('shover').textContent = '';
    /* Arrasto que voltou para a mesma grade nao e mudanca — nao entra no undo.
       A conta olhava SO o pts[0] do fio: arrastar um vertice do meio (que agora e um gesto de
       verdade) mudava o desenho, nao entrava no undo e nao acendia o "Salvar *" — a falha
       silenciosa que so aparece quando a pagina recarrega e o trabalho sumiu. Agora compara
       ponto a ponto, mais o deslocamento do texto. */
    const mudou = Array.from(d.base.values()).some(b => {
      const a = b.a, it = a.it;
      if (a.k === 'ref' || a.k === 'com'){ const t = textoComp(it, a.k); return t.x !== b.x0 || t.y !== b.y0; }
      if (b.pts) return (it.pts || []).some((p, i) => !b.pts[i] || p[0] !== b.pts[i][0] || p[1] !== b.pts[i][1]);
      return it.x !== b.x || it.y !== b.y;
    });
    /* o giro no meio do gesto e mudanca mesmo que a posicao volte ao lugar (giroNoArrasto) */
    if (mudou || girouDeFato(d)) commit(); else cam.draw();
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
       partiria os fios ao mover. O trecho e coisa do clique; o laço e coisa do bloco.
       Com o "so fios" o laço passa por cima dos componentes e pega so os fios. */
    for (const it of soFio ? model.sheets[sheetIdx].wires : sheetItems()){ const bb = itemBBox(it); if (inteiro ? bbInside(bb, n) : bbTouch(bb, n)) selAdd(alvoAll(it)); }
    aplicaSel('');     /* selecao de varios nao tem uma net so: apaga o foco anterior */
    return;
  }
  /* segurou, girou e soltou sem arrastar: o giro e a mudanca do gesto */
  if (d.mode === 'move' && girouDeFato(d)){ commit(); return; }
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
  /* o segundo clique num fio ja inteiro na selecao: fica SO o trecho clicado */
  if (lastDown.promover && !e.shiftKey){
    selSo([lastDown.promover]);
    aplicaSel('');
    return;
  }
  if (e.shiftKey && lastDown.wasSel){
    selDel(lastDown.alvo);
    aplicaSel('');            /* saiu da selecao: a net dele sai junto */
  }
}
/* Duplo clique: com o fio na mao encerra o traçado (o Altium faz igual). Sem ferramenta, no
   texto do designador ele leva o
   foco para o campo da ficha, que e onde se troca a palavra. Sem isso, o clique simples ter
   virado "trecho" teria tirado o gesto de pegar o fio todo, que ainda e o certo para mover o
   fio de lugar. */
cv.addEventListener('dblclick', e => {
  if (wireDraw){ endWire(); return; }
  if (tool !== 'select') return;
  const w = worldOf(e);
  const h = hitTest(w.x, w.y);
  if (!h) return;
  /* o FIO nao tem mais duplo clique: o primeiro clique ja pega o fio inteiro, e o segundo pega o
     trecho (leftClick). Promover aqui desfaria o que o segundo clique acabou de escolher. */
  if (h.kind === 'ref' || h.kind === 'com'){
    /* o campo do designador vive na aba Geral: se a ficha estiver na aba Pinos, focar um
       campo escondido nao daria erro nenhum — so nao aconteceria nada, que e pior */
    prAba = 'geral';
    try { localStorage.setItem(PR_ABA_KEY, prAba); } catch (e) {}
    selSo([alvoAll(h.item)]); aplicaSel('');
    mostraDir('props');
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
/* No acervo do almoxarifado a familia tem UMA parte e uma lista de VALORES; cada valor
   e um conjunto de parametros (Comment, Value, MPN, Mouser, Estoque, Local) e pode ter o
   desenho proprio, em varias partes (partesDe). O que se escolhe no modal e o valor — e,
   quando o desenho dele tem mais de uma, a parte, como na biblioteca do Altium. */
const valoresDe = sy => (sy && sy.valores) || [];
const estoqueDe = sy => valoresDe(sy).reduce((a, p) => a + (p.estoque || 0), 0);
/* paramsDoValor e modelosDeFootprint moram na parte pura, la em cima: sao o formato que
   este modal, o vinculo e a lista do Odoo gravam, e tem de ser um so */
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
  /* AS PARTES, EM QUALQUER ACERVO (pedido do dono, 2026-09-30): as do simbolo na biblioteca do
     Altium, as do VALOR no almoxarifado — o mesmo desenho que a folha vai usar (partesDe). Ate
     aqui o seletor so existia para o Altium, e um valor desenhado em duas partes entrava sempre
     com a primeira. Trocar de valor pode trocar quantas partes ha: a escolhida que nao existe
     mais volta para a 1. */
  const partes = { parts: partesDe(s, v) }, nparts = nPartes(s, v);
  if (!(pick.part >= 1 && pick.part <= nparts)) pick.part = 1;
  /* o partOf da FOLHA, e nao uma busca daqui: o que o modal mostra e o que ela vai desenhar */
  const part = HubCore.partOf(partes, pick.part);
  addDrawSym = part || null;
  fitPreview(camSym, part ? D.symBBox(part) : null);
  $('addSymHint').textContent = part && (part.graphics || []).length ? '' : 'sem desenho na biblioteca';
  $('addSymMeta').textContent = s.name + ' · ' + ((part && part.pins) || []).length + ' pinos'
    + (v ? ' · valor ' + (vals.indexOf(v) + 1) + '/' + vals.length : '')
    + (nparts > 1 ? ' · parte ' + pick.part + '/' + nparts : '');

  /* a parte: aparece sempre que o componente tem mais de uma, com os pinos de cada uma — e o
     que separa a bobina (2 pinos) dos contatos (3) de um rele sem abrir o desenho */
  const pl = $('addPartLab'); pl.hidden = nparts <= 1;
  if (!pl.hidden){
    const ps = $('addPart'); ps.textContent = '';
    for (let i = 1; i <= nparts; i++){
      const pi = HubCore.partOf(partes, i), np = pi ? (pi.pins || []).length : 0;
      const o = document.createElement('option'); o.value = i;
      o.textContent = i + ' de ' + nparts + (pi ? ' · ' + np + (np === 1 ? ' pino' : ' pinos') : '');
      if (i === pick.part) o.selected = true;
      ps.append(o);
    }
  }

  /* footprint: o do VALOR primeiro, depois os modelos do simbolo (modelosDeFootprint, na
     parte pura), depois a PcbLib inteira */
  const fpSel = $('addFp'); fpSel.textContent = '';
  const models = modelosDeFootprint(s, v);
  const want = pick.fpShown || footprintPadrao(s, v);
  const seen = new Set();
  const addOpt = (name, mark) => {
    if (!name || seen.has(name)) return; seen.add(name);
    const o = document.createElement('option'); o.value = name; o.textContent = name + (mark || '');
    if (name === want) o.selected = true;
    fpSel.append(o);
  };
  /* SEM FOOTPRINT CONHECIDO, O PADRAO E NENHUM — e dito como opcao. Sem ela nenhuma opcao
     ficava marcada, o navegador pegava a primeira da PcbLib inteira ("M7", um diodo) e o
     cartAdd gravava esse footprint em 781 dos 2545 valores do almoxarifado (um clip de
     bateria, uma chave alavanca) sem ninguem ter escolhido. Vazio e o que o footprintPadrao
     devolve — e o que o componente fora do esquema da lista do Odoo grava para o mesmo
     valor —, e o BuildSchematic o trata como aviso a resolver no Altium (AI-GUIDE). O Salvar
     aceita o vazio (hub-core » SCH_ITEM_REQUIRED): antes ele recusava o arquivo INTEIRO. */
  if (!want){
    const o = document.createElement('option'); o.value = ''; o.textContent = '— sem footprint —';
    o.selected = true; fpSel.append(o);
  }
  for (const m of models) addOpt(m.name, m.current ? ' ✓' : '');
  for (const f of (PLIB.footprints || [])) addOpt(f.name, '');
  if (!fpSel.options.length){ const o = document.createElement('option'); o.value = ''; o.textContent = '— nenhum —'; fpSel.append(o); }

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
      (p.label + ' ' + (p.mpn || '') + ' ' + (p.mouser || '') + ' ' + (p.pkgs || []).join(' ')
       /* a linha montada do conector e o codigo do fabricante entram na busca */
       + ' ' + (p.conn ? HubAlmoxPick.linhaConn(p.conn) : '')
       + ' ' + ((p.conn && p.conn.tipo) || '')).toLowerCase().includes(vq));
    $('addValCount').textContent = vis.length === vals.length ? vals.length + ' valores' : vis.length + ' de ' + vals.length;
    const vl = $('addValList'); vl.textContent = '';
    const frag = document.createDocumentFragment();
    for (const p of vis){
      const b = el('button', 'alx-row'); b.type = 'button';
      b.setAttribute('aria-selected', String(!!v && p.id === v.id));
      b.title = (p.itens && p.itens[0] && p.itens[0].nome) || p.label;
      /* o conector se mostra pelos campos (hub-almoxpick » linhaConn), e o nome inteiro do
         Odoo — com codigo do fabricante e numero de pedido — fica no title */
      const linhaC = (p.conn && p.conn.vias) ? HubAlmoxPick.linhaConn(p.conn) : '';
      const lb = el('span', 'lb', linhaC || p.label);
      if (linhaC) b.title = p.label + '\n' + b.title;
      if (p.fora){ lb.append(el('i', null, 'fora')); b.title = 'não está mais no Odoo — a part continua na lib para não renumerar as outras'; }
      /* o numero e o id do valor: e a chave dele no .DbLib e no schematic.js */
      const ix = el('span', 'ix', String(p.id)); ix.title = 'id ' + p.id + ' no catálogo';
      /* UMA ETIQUETA PARA CADA COISA — encapsulamento e codigo do fabricante sao leituras
         diferentes, e juntas num balao so viram texto corrido. Etiqueta vazia nao existe,
         em vez de virar um travessao. Mesmo desenho do hub.html. */
      /* UM encapsulamento, desempatado pelo footprint -- a mesma regra do `alxEncap` do
         hub.html. Aqui era `pkgs.join(' · ')`, que mostra TODOS: hoje da no mesmo (nenhum
         valor do acervo tem mais de um), mas no dia em que o Odoo mandar dois as duas telas
         diriam coisas diferentes sobre a mesma peca. */
      const pks = p.pkgs || [];
      const fpl = String(p.footprint || '').toLowerCase();
      const pkTxt = pks.length <= 1 ? (pks[0] || '')
                  : (pks.find(x => fpl.includes(String(x).toLowerCase())) || pks[0]);
      const cod = String((p.conn && p.conn.tipo) || p.mpn || '').trim();
      const tags = el('span', 'tags');
      if (pkTxt) tags.append(el('span', 'pk', pkTxt));
      if (cod) tags.append(el('span', 'mp', cod));
      b.append(ix, lb, tags);
      b.append(el('span', 'qt' + (p.estoque > 0 ? '' : ' zero'), qtdFmt(p.estoque)));
      /* o encapsulamento fixado era do valor ANTERIOR: mantê-lo poria um 0805 na ficha de um 2512 */
      b.addEventListener('click', () => { pick.valorId = p.id; pick.fpShown = null; $('addComment').value = p.label; renderAddPreview(); });
      /* o "Odoo ↗" ao lado da linha, não dentro: a linha é um <button> (hub-odoolink » faixa) */
      frag.append(typeof HubOdooLink !== 'undefined' ? HubOdooLink.faixa(b, p, { nome: p.label }) : b);
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
  /* a parte vale nos dois acervos: a do simbolo do Altium ou a do desenho do valor */
  const partes = nPartes(s, v);
  const part = Math.min(Math.max(1, pick.part || 1), partes);
  const item = {
    /* o nome do componente no Altium: cada valor e um componente proprio na lib da
       familia ("SMD 0805 10K 1/8W"). O espelho do hub continua por familia. */
    sym: (v && v.altium) || s.name,
    part, partes,
    footprint: $('addFp').value,
    comment: ($('addComment').value.trim() || (v && v.label) || '').replace(/"/g, "'"),
    params: paramsDoValor(v),
    nome: (v && v.label) || s.name,
    rotulo: ((v && v.label) || s.name) + (partes > 1 ? ' · parte ' + part + ' de ' + partes : ''),
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
    /* a parte vem NA FRENTE do nome: a linha corta no fim, e com "parte 2 de 3" no fim as
       duas partes do mesmo rele viravam duas linhas iguais */
    if (c.partes > 1) t.append(el('b', null, 'parte ' + c.part + '/' + c.partes + ' · '));
    t.append(document.createTextNode(c.nome || c.rotulo));
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
  let i = 0; const novos = [], juntas = [];
  for (const item of cart){
    for (let k = 0; k < item.qtd; k++){
      /* a parte de um componente de varias vai para o designador que ainda nao a tem
         (refDaParte); a de uma parte so ganha designador novo, como sempre */
      const d = refDaParte(allComps(), item, () => nextRef(item.sym));
      if (d.junto) juntas.push('parte ' + item.part + ' → ' + d.ref);
      const c = {
        t: 'comp', sheet: folha.name, ref: d.ref, sym: item.sym,
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
  HubDialog.toast(novos.length + ' componente(s) na folha "' + folha.name + '"'
    + (juntas.length ? ' (' + juntas.join(', ') + ')' : '') + ' — arraste para o lugar e salve', 'ok');
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

/* ------- o painel da direita: Configuracoes | Propriedades -------
   Ele fica sempre na tela e troca de pagina sozinho: selecionar mostra a ficha, largar a
   selecao volta para as Configuracoes. As sub-abas do rodape trocam a mao.
   A troca automatica so acontece quando a SELECAO muda (a chave do Map `sel`), e nao a cada
   chamada: o aplicaSel roda tambem depois de cada commit, e sem essa guarda quem abriu as
   Configuracoes com um componente marcado seria mandado de volta para a ficha no proximo
   arrasto. Fechado pela divisoria, o painel vira o botao de paineis no canto da folha. */
let dirAba = 'cfg', selChaveAntes = '', painelProps = null;
function pintaDir(){
  for (const b of document.querySelectorAll('#props .subtab'))
    b.setAttribute('aria-selected', String(b.dataset.dir === dirAba));
  $('pane-cfg').classList.toggle('on', dirAba === 'cfg');
  $('pane-props').classList.toggle('on', dirAba === 'props');
  $('prTitulo').textContent = dirAba === 'cfg' ? 'Configurações' : 'Propriedades';
  $('prFolha').hidden = dirAba !== 'props';
  /* os previews da ficha so enquadram depois de medidos, e escondidos eles medem 0 */
  if (dirAba === 'props') requestAnimationFrame(refitProps);
}
function mostraDir(aba){ dirAba = aba === 'props' ? 'props' : 'cfg'; pintaDir(); }
function mostraProps(){
  const chave = Array.from(sel.keys()).sort().join(',');
  if (chave !== selChaveAntes){ selChaveAntes = chave; dirAba = chave ? 'props' : 'cfg'; }
  $('btnPaineis').hidden = !painelProps || painelProps.larg() > 0;
  pintaDir();
}
document.querySelectorAll('#props .subtab').forEach(b => b.addEventListener('click', () => mostraDir(b.dataset.dir)));
$('btnPaineis').addEventListener('click', () => { if (painelProps) painelProps.abre(); mostraProps(); });

/* ── A FICHA DO ODOO DE UM COMPONENTE DA FOLHA ──
   A cascata é a do odoolista.py (quem decide o product_id da lista enviada ao Odoo) e mora no
   hub-odoolink » fichaDoComp, onde é provada em Node. NÃO passa pelo resolveSym: ele segue as
   escolhas de DESENHO do lib-subs.js, e uma delas fazia todo resistor "RES [ SMD ]" abrir a
   ficha do 10R. Devolve { alvo, nome }, { motivo } ou null. */
function odooDoComp(comp){
  return (comp && typeof HubOdooLink !== 'undefined') ? HubOdooLink.fichaDoComp(comp) : null;
}

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
/* ── FOOTPRINT, no esquema, antes da PCB (pedido do dono, 2026-10-14: "poder configurar o
   footprint no esquema antes de importar pra pcb") ──
   A secao "Footprint" do painel Properties do Altium: o nome (com a lista da PcbLib + a
   biblioteca do hub), o que ele tem (pads, corpo 3D), se os pinos do simbolo tem pad nele (o
   "Unknown Pin" que o ECO acusaria), e o editor de footprint do hub (o PCB Library) para criar,
   alterar e prender o modelo 3D. Vale para TODAS as partes do designador; a PCB recebe no
   Design » Update PCB (ECO), que ja troca o footprint de quem ja esta na placa. */
function listaFootprints(){
  let dl = document.getElementById('prFpLista');
  if (!dl){ dl = document.createElement('datalist'); dl.id = 'prFpLista'; document.body.append(dl); }
  const n = (PLIB.footprints || []).length;
  if (dl.dataset.n === String(n) && dl.dataset.lib === String(!!PLIB.hub)) return dl;
  dl.textContent = '';
  for (const f of (PLIB.footprints || [])) if (f && f.name){ const o = document.createElement('option'); o.value = f.name; dl.append(o); }
  dl.dataset.n = String(n); dl.dataset.lib = String(!!PLIB.hub);
  return dl;
}
function poeFootprint(ref, nome){
  const partes = itensDoRef(ref);
  for (const x of partes){ if (nome) x.footprint = nome; else delete x.footprint; }
  commit();
  HubDialog.toast(ref + ': footprint ' + (nome || '(nenhum)') + (partes.length > 1 ? ' (' + partes.length + ' partes)' : '')
    + ' — vai para a PCB no Design » Update PCB', 'ok', 3200);
}
async function abreFootprint(it, o){
  if (typeof HubFpEditor === 'undefined'){ HubDialog.alert('O editor de footprint (hub-fpeditor.js) não carregou. Atualize a página (F5).', { title:'Footprint' }); return; }
  const antes = it ? (it.footprint || '') : '';
  await HubFpEditor.abre(Object.assign({ nome:antes || null, pcblib:window.pcblib || PLIB, titulo:'PCB Library',
    async aoSalvar(fp, lib){
      window.pcblibHub = lib;
      PLIB = HubFpLib.mescla(window.pcblib || PLIB, lib);
      if (it && fp.name !== (it.footprint || '') &&
          await HubDialog.confirm('Usar "' + fp.name + '" em ' + it.ref + '?', { title:'Footprint', ok:'Usar' }))
        poeFootprint(it.ref, fp.name);
    } }, o || {}));
  if (typeof HubFpLib !== 'undefined'){
    const lib = await HubFpLib.carrega();
    window.pcblibHub = lib;
    PLIB = HubFpLib.mescla(window.pcblib || PLIB, lib);
  }
  renderProps();
}
/* TROCAR na galeria, e nao so no campo de texto: o desenho, os pads, se e do hub e se os pinos
   do simbolo tem pad (hub-fppick.js, a mesma galeria da Biblioteca » Footprints do hub) */
async function trocaFootprint(it, sym){
  if (typeof HubFpPick === 'undefined'){ HubDialog.alert('A galeria de footprints (hub-fppick.js) não carregou. Atualize a página (F5).', { title:'Footprint' }); return; }
  const pinos = [];
  if (sym && Array.isArray(sym.parts))
    for (const p of sym.parts) for (const q of (p.pins || [])) if (q && q.num != null && pinos.indexOf(String(q.num)) < 0) pinos.push(String(q.num));
  const hub = ((window.pcblibHub && window.pcblibHub.footprints) || []).map(f => f && f.name).filter(Boolean);
  const r = await HubFpPick.escolhe({ footprints:PLIB.footprints || [], atual:it.footprint || '', ref:it.ref, pinos, hub, titulo:'Trocar footprint' });
  if (!r) return;
  if (r.acao === 'usar') poeFootprint(it.ref, r.nome);
  else if (r.acao === 'tirar') poeFootprint(it.ref, '');
  else if (r.acao === 'editar') abreFootprint(it, { nome:r.nome });
  else if (r.acao === 'novo') abreFootprint(it, { nome:null, aoMontar:c => c.novo() });
}
function secFootprint(it, sym, fpNome){
  const s = prSec('footprint');
  listaFootprints();
  const campo = prCampo(fpNome, 'o footprint deste componente (todas as partes). Escolha da lista ou digite; '
    + 'a PCB recebe no Design » Update PCB', async c => {
      const novo = String(c.value || '').trim();
      if (novo === fpNome) return;
      if (novo && !HubCore.footprintOf(PLIB, novo) &&
          !(await HubDialog.confirm('"' + novo + '" não está na PcbLib nem na biblioteca do hub. O ECO vai recusar o componente até ele existir. Usar mesmo assim?', { title:'Footprint', ok:'Usar' }))){
        c.value = fpNome; return;
      }
      poeFootprint(it.ref, novo);
    }, { cls:'mono' });
  campo.setAttribute('list', 'prFpLista');
  campo.placeholder = '— sem footprint —';
  prKvEl(s, 'Footprint', campo);
  const fp = fpNome ? HubCore.footprintOf(PLIB, fpNome) : null;
  const hub = fp && PLIB.hub && typeof HubFpLib !== 'undefined' && window.pcblibHub ? HubFpLib.acha(window.pcblibHub, fp.name) : null;
  if (fpNome && !fp) prKv(s, '', 'não está na PcbLib espelhada nem na biblioteca do hub — crie no editor (Novo…)', 'warn');
  if (fp){
    const corpos = (fp.bodies || []).length;
    prKv(s, 'Origem', hub ? 'biblioteca do hub' + (hub.hub && hub.hub.base ? ' (alterado do Altium)' : '') : 'PcbLib do Altium', 'dim');
    prKv(s, 'Pads', String((fp.pads || []).length), 'mono');
    prKv(s, 'Modelo 3D', corpos ? corpos + ' corpo(s)' : 'nenhum — prenda o STEP no editor', corpos ? null : 'dim');
    /* os pinos do simbolo (todas as partes) que nao tem pad: o Unknown Pin do ECO */
    if (sym && Array.isArray(sym.parts)){
      const pads = new Set((fp.pads || []).map(p => String(p.name)));
      const falta = [];
      for (const p of sym.parts) for (const q of (p.pins || [])) if (q && q.num != null && !pads.has(String(q.num)) && falta.indexOf(String(q.num)) < 0) falta.push(String(q.num));
      if (falta.length) prKv(s, 'Sem pad', falta.slice(0, 12).join(', ') + (falta.length > 12 ? '…' : '') + ' — pinos sem pad no footprint (o ECO acusa)', 'warn');
    }
  }
  const linha = el('div', 'pr-fpacoes');
  const b = (rot, titulo, fn) => { const x = el('button', 'wide sutil', rot); x.type = 'button'; x.title = titulo; x.onclick = fn; linha.append(x); };
  b('Trocar footprint…', 'a galeria de footprints (PcbLib do Altium + biblioteca do hub), com o desenho e o teste dos pinos — a PCB recebe no Design » Update PCB', () => trocaFootprint(it, sym));
  b(fp ? 'Editar footprint…' : 'Abrir o editor de footprint…', 'o PCB Library do Altium, no hub: pads, serigrafia e o corpo 3D (STEP). Grava na biblioteca do hub', () => abreFootprint(it));
  if (fp) b('Ver em 3D', 'o footprint com o modelo 3D, no editor', () => abreFootprint(it, { modo3d:true }));
  s.append(linha);
  return s;
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
/* ── A FOLHA É O QUE SOBRA ──
   Com nada selecionado a ficha só tinha um parágrafo dizendo "clique em alguma coisa". Mas
   quando nada está marcado o que está debaixo do cursor É A FOLHA, e ela também tem
   propriedades — a primeira delas o formato, que até aqui ninguém conseguia escolher em lugar
   nenhum: o hub desenhava a medida que o espelho trouxe e ponto.

   Por que aqui e não numa barra nova: é o mesmo lugar onde se edita posição, rotação e
   designador, com a mesma mecânica (campo → commit() → Salvar *). Uma barra nova seria um
   segundo jeito de editar a mesma coisa. NO DESKTOP o seletor saiu da ficha: desde a 1.1.2 ele
   fica em Configurações › Folha (#folhaFmt), que o renderProps redesenha a cada troca; a
   mecânica de gravar é a mesma.

   O QUE É GRAVADO: `size` (o nome) e `w`/`h` (a medida em mil) no item `sheet` do
   schematic.js. Os dois, sempre — o nome porque é o que o BuildSchematic procura, e a medida
   porque o nome MENTE (o ExportProject chama de "A4" toda folha que não seja A3/A2/A1/A/B/C,
   inclusive a A0 do usuário) e porque só a medida sabe dizer se a folha está em pé. */
function itemFolha(nome){
  let it = schematic.items.find(i => i && i.t === 'sheet' && i.name === nome);
  if (!it){
    /* FOLHA IMPLÍCITA: ninguém a declarou e o buildSchModel a inventou a partir do campo
       `sheet` dos itens. Para gravar um formato é preciso ter onde — declara agora, no topo,
       que é onde o ExportProject a escreve. O BuildSchematic exige a declaração de qualquer
       jeito (ele recusa item cuja folha não foi declarada), então isto só conserta. */
    it = { t:'sheet', name:nome, size:'A4' };
    schematic.items.unshift(it);
  }
  return it;
}
/* quantos itens desta folha cairiam FORA de uma página de medida `med` */
function contaFora(si, med){
  let n = 0;
  for (const it of sheetItems(si)){
    const b = itemBBox(it);
    if (b.x1 < 0 || b.y1 < 0 || b.x2 > med[0] || b.y2 > med[1]) n++;
  }
  return n;
}
const milTxt = v => String(Math.round(v));
const mmTxt  = v => String(Math.round(v * 0.0254 * 10) / 10);

/* O formato da folha: Configuracoes do painel da direita, secao Folha (#folhaFmt, pelo
   renderProps). O botao "A4" da barra saiu em 2026-09-25. */
function secFolha(){
  const s = prSec(null);
  const sh = model.sheets[sheetIdx];
  /* esquema sem folha nenhuma (arquivo vazio) nao pode derrubar a ficha inteira: sem folha
     nao ha formato a escolher, e dizer isso e melhor que um painel em branco */
  if (!sh){ s.append(el('p', 'pr-empty', 'este esquema ainda não tem folha nenhuma')); return s; }
  const med = HubCore.sheetSize(sh);
  /* SEM w/h NO ESPELHO, `med` e o palpite da tabela legado — e o `sheetMatch` casa com esse
     palpite, devolvendo "leg:A4" para uma folha que ninguem mediu. Deixar o seletor de
     formato JA PREENCHIDO com esse palpite era o buraco: qualquer mexida (girar a folha)
     passava pelo preset herdado e gravava 11500x7600 como se fosse medida declarada, e o
     BuildSchematic escrevia isso por cima da folha real do Altium. Sem medida, nenhum
     formato vem escolhido: o usuario precisa AFIRMAR qual e. */
  const medida = HubCore.isNum(sh.w) && sh.w > 0 && HubCore.isNum(sh.h) && sh.h > 0;
  const casa = medida ? HubCore.sheetMatch(sh) : null;

  /* O NOME DE CADA OPÇÃO LEVA A MEDIDA JUNTO. Não é enfeite: "A4" quer dizer 11693×8268 no
     template da casa e 11500×7600 no estilo legado do Altium, e sem o número na frente a
     escolha entre os dois grupos seria adivinhação. Por isso também são dois optgroups. */
  const selFmt = el('select');
  selFmt.title = 'o formato da página desta folha';
  if (!casa){
    /* "Custom" só existe quando a medida não é de formato nenhum — que é o caso da maioria
       das folhas reais. Ele não é escolhível para "virar custom": é onde o seletor pousa
       enquanto a folha for a que veio do Altium. */
    const o = el('option', null, 'Custom · ' + milTxt(med[0]) + '×' + milTxt(med[1]) + ' mil');
    o.value = '';
    selFmt.append(o);
  }
  for (const [fam, rotulo] of [['iso', 'ISO — a folha de verdade'], ['legado', 'Altium legado']]){
    const g = document.createElement('optgroup');
    g.label = rotulo;
    for (const p of HubCore.SHEET_PRESETS.filter(p => p.fam === fam)){
      const o = el('option', null, p.name + ' · ' + milTxt(p.size[0]) + '×' + milTxt(p.size[1]));
      o.value = p.id;
      g.append(o);
    }
    selFmt.append(g);
  }
  selFmt.value = casa ? casa.id : '';
  if (!medida){
    /* a opcao vazia existe e e a selecionada: ela diz o que esta acontecendo em vez de
       deixar o seletor mostrando um formato que ninguem mediu */
    const o0 = selFmt.querySelector('option[value=""]');
    if (o0) o0.textContent = '— não medida: rode o ExportProject —';
  }

  /* RETRATO NÃO É UM CAMPO DO ESPELHO: é a mesma medida com h > w (ver hub-core » SHEET_ISO).
     Por isso o seletor de orientação escreve w/h trocados em vez de uma propriedade nova que
     os dois .pas teriam de aprender — e por isso ele funciona igual para folha Custom, onde
     "em pé" quer dizer só "o maior dos dois lados é a altura". */
  const selOri = el('select');
  selOri.title = 'retrato (em pé) ou paisagem (deitado)';
  for (const [v, t] of [['0', 'deitado'], ['1', 'em pé']]){
    const o = el('option', null, t); o.value = v; selOri.append(o);
  }
  selOri.value = med[1] > med[0] ? '1' : '0';

  /* FOLHA NUNCA MEDIDA: sem w/h no espelho, `med` e o palpite da tabela legado do hub-core --
     bom para desenhar alguma coisa, pessimo como base de calculo. Girar a orientacao aqui
     gravava esse palpite (7600x11500) como medida declarada, e o BuildSchematic, que PRESERVA
     a folha justamente quando nao ha w/h, passava a escrever o palpite por cima da folha real
     do Altium. Medido em 11 projetos deste repositorio.
     Entao: sem medida, a orientacao sozinha nao decide nada. Escolher um formato continua
     valendo -- ali o usuario esta afirmando o tamanho, e afirmar e diferente de herdar. */
  if (!medida){
    selOri.disabled = true;
    selOri.title = 'esta folha nunca foi medida: o tamanho que aparece e um palpite. '
                 + 'Rode o ExportProject, ou escolha um formato aqui para afirmar qual e.';
  }

  const aplica = () => {
    const id = selFmt.value, retrato = selOri.value === '1';
    const atual = HubCore.sheetSize(sh);
    let nova;
    if (id) nova = HubCore.sheetPreset(id, retrato);
    else if (!medida) return;     /* ver o comentario do selOri: palpite nao vira medida */
    else {
      const a = Math.max(atual[0], atual[1]), b = Math.min(atual[0], atual[1]);
      nova = retrato ? [b, a] : [a, b];
    }
    if (!nova) return;
    /* trocar pela mesma medida não é edição: acender o "Salvar *" e empilhar um undo por um
       select que voltou ao que já estava seria ruído */
    if (HubCore.near(nova[0], atual[0], 1e-3) && HubCore.near(nova[1], atual[1], 1e-3)) return;
    const preset = id ? HubCore.SHEET_PRESETS.find(p => p.id === id) : null;
    const fora = contaFora(sheetIdx, nova);
    const it = itemFolha(sh.name);
    if (preset) it.size = preset.name;          /* folha Custom conserva o nome que já tinha */
    it.w = nova[0]; it.h = nova[1];
    const nome = HubCore.sheetLabel({ size:it.size, w:it.w, h:it.h });
    commit();
    /* o enquadramento era da folha antiga: numa A0 vinda de uma A4 o desenho ficaria num
       canto de 5% da página, e no caminho contrário metade dele fora da tela */
    cam.fit(fitBBox());
    /* A FOLHA É DO USUÁRIO: encolher e deixar componente para fora é decisão dele, não erro a
       impedir. Mas ele tem de SABER — o item que sobrou da página some do desenho impresso
       sem avisar nada no Altium. */
    if (fora) HubDialog.toast(nome + ' · ' + fora + (fora > 1 ? ' itens ficaram' : ' item ficou')
                              + ' fora da página', 'warn', 5000);
    else HubDialog.toast('folha ' + nome + ' · ' + milTxt(nova[0]) + '×' + milTxt(nova[1]) + ' mil', 'ok');
  };
  selFmt.addEventListener('change', aplica);
  selOri.addEventListener('change', aplica);
  prPar(s, ['formato', selFmt], ['orientação', selOri]);
  prKv(s, 'medida', milTxt(med[0]) + ' × ' + milTxt(med[1]) + ' mil');
  prKv(s, 'em mm', mmTxt(med[0]) + ' × ' + mmTxt(med[1]) + ' mm', 'dim');
  /* o `size` do arquivo fica à vista justamente porque ele pode estar mentindo: é assim que o
     usuário descobre que o export chamou de "A4" a folha A3 dele */
  prKv(s, 'size no arquivo', (sh.size || '—') + (casa && casa.name !== sh.size ? '  (mede ' + casa.name + ')' : ''),
       casa && casa.name !== sh.size ? 'warn' : 'mono');
  /* TEMPLATE e PARÂMETROS da folha (o Document Options do Altium): a seção inteira, o editor
     de template e a gravação moram no hub-schtemplate-ui.js; daqui ele só recebe as alças */
  if (typeof HubSchTemplateUI !== 'undefined') s.append(HubSchTemplateUI.secao({
    schematic, nome: sh.name, indice: sheetIdx, total: model.sheets.length,
    item: () => itemFolha(sh.name), medida: () => HubCore.sheetSize(sh),
    commit, sujo: () => setSchDirty(true), redesenha: () => { cam.draw(); pintaMiniaturas(); },
    enquadra: () => cam.fit(fitBBox()), contaFora: med => contaFora(sheetIdx, med) }));
  return s;
}
function renderProps(){
  const body = $('prBody');
  body.textContent = '';
  /* A FOLHA NO CABEÇALHO. Ela era a última linha da seção "posição" e repetia, item a item,
     o que vale para a ficha inteira — no topo ela diz de uma vez de onde é o que se está
     olhando, e devolve uma linha para cada seção. */
  /* o formato da folha ativa, na secao Folha das Configuracoes: redesenhado aqui porque este e
     o funil de toda troca (commit, undo, troca de folha, selecao) */
  const fmt = $('folhaFmt');
  if (fmt) fmt.replaceChildren(secFolha());
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
      + 'Aqui se olha e se posiciona; a única propriedade editável de um item é a cor da port. Valor, '
      + 'footprint e parâmetro são editados pela IA, no schematic.js.'));
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

    /* ── TROCAR OS SELECIONADOS ──
       O alcance automático ("os do mesmo tipo e valor") resolve o caso regular; este resolve
       o resto, que o usuário pediu junto: marcar os componentes A DEDO — de valores
       diferentes, de símbolos diferentes, de folhas diferentes — e dar um componente só a
       todos. É o mesmo caminho do painel "Enviar para o Odoo" (`vinculo` com a lista de
       refs pronta): quem escolheu o conjunto foi a pessoa, e o modal não reabre a conta.

       O modal precisa de um componente de referência para sugerir candidatos e medir a
       pinagem; usa-se o PRIMEIRO da seleção, e a tela diz isso, senão as sugestões parecem
       vir do nada. Fios e textas marcados junto são ignorados em silêncio — marcar um fio
       por acidente não pode custar o gesto inteiro. */
    const comps = itens.filter(it => it.t === 'comp');
    const refsSel = Array.from(new Set(comps.map(c => c.ref)));
    if (comps.length > 1){
      const sT = prSec('trocar em bloco');
      const b = el('button', 'wide sutil', 'Definir o componente nos ' + refsSel.length
                   + ' designadores…');
      b.type = 'button';
      b.title = 'um componente só para ' + refsSel.join(', ')
              + ' — as sugestões saem de "' + (comps[0].ref || '?') + '"';
      b.onclick = () => abrirEscolhaSimbolo(comps[0], { vinculo: true, refs: refsSel });
      sT.append(b);
      /* os valores que vão junto, ditos ANTES do clique: é a única defesa contra marcar um
         10K e um 1K sem perceber e dar o mesmo componente aos dois. */
      const vals = Array.from(new Set(comps.map(c => valorDoComp(c)).filter(Boolean)));
      if (vals.length > 1)
        prKv(sT, '', 'atenção: a seleção mistura ' + vals.length + ' valores ('
             + vals.slice(0, 6).join(', ') + (vals.length > 6 ? '…' : '')
             + ') — todos vão receber o MESMO componente', 'warn');
      else
        prKv(sT, '', 'todos recebem o mesmo componente; Ctrl+Z desfaz e só o Salvar grava',
             'dim');
      body.append(sT);
    }
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
        prKv(s, '', 'Del parte o fio aqui · Esc e um clique pegam o fio inteiro', 'dim');
      } else if (alvo.k === 'vert' && pts[alvo.i]){
        prKv(s, 'Vértice', (alvo.i + 1) + ' de ' + pts.length);
        prKv(s, 'Posição', pts[alvo.i][0] + ' , ' + pts[alvo.i][1] + ' mil', 'mono');
        prKv(s, '', 'Del tira o vértice e endireita o fio', 'dim');
      } else {
        prKv(s, 'Vértices', pts.length);
        const p0 = pts[0] || [0, 0], pn = pts[pts.length - 1] || [0, 0];
        prKv(s, 'Início', p0[0] + ' , ' + p0[1] + ' mil', 'mono');
        prKv(s, 'Fim', pn[0] + ' , ' + pn[1] + ' mil', 'mono');
        prKv(s, '', 'outro clique no fio pega só o trecho', 'dim');
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
  /* QUANTAS PARTES ESTE COMPONENTE TEM, DE VERDADE. Nao basta perguntar ao simbolo: o
     alias do almoxarifado so conta as partes do desenho do valor (quase sempre uma), e uma
     escolha gravada no lib-subs.js pode apontar um conector de 4 partes para um alias de
     uma. Nesses casos a ficha dizia '1 de 1' numa peca que a folha usa em 4 partes — e,
     pior, escondia a parte REAL do item, que continuava sendo 3. A folha e a testemunha: se
     ha um comp com part 3 neste ref, o componente tem ao menos 3 partes, o simbolo sabendo
     disso ou nao. */
  const partesDoRef = sheetItems().filter(x => x.t === 'comp' && x.ref === it.ref);
  const maxNaFolha = partesDoRef.reduce((m, x) => Math.max(m, x.part || 1), 0);
  /* O TOTAL QUE SE LE, quando nao ha o que escolher, e o da folha: as partes que estao nela.
     O partcount do simbolo entra como AVISO, mais abaixo, quando ele nao alcanca o que a folha
     usa. Com o simbolo de varias partes a ficha deixa de so ler — ver o seletor da Parte. */
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
  const dec = decideTroca({ sym: sym && sym.name, how: rsym && rsym.how,
                           quantos: contaSym(it.sym), quantosValor: contaTipo(it),
                           valor: valorDoComp(it) });

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
  /* A PARTE SE TROCA AQUI, direto na folha (pedido do dono, 2026-09-30: "dentro do esquema eu
     consigo alterar a parte, so clicar e mudar a parte ja direto no esquema"). Com o simbolo de
     varias partes o campo vira seletor com TODAS as partes dele, como o Part do Altium. Contar
     so as da folha escondia justamente o que se queria: o ESP32 desenhado em duas partes, com a
     1 colocada, dizia "1 de 1". Cada opcao diz os pinos da parte, se ela ja esta colocada noutro
     item deste designador (escolher uma dessas troca os dois: trocaDeParte) e se os pinos dela
     nao tem pad no footprint — o cuidado de quando a ficha so contava a folha: o CONE PADRAO tem
     80 partes, e pousar a 57 num conector de 4 vias abre um buraco que o ECO do Altium reclama.
     Avisa, nao esconde: sem footprint, ou com o footprint errado, esconder travaria a escolha. */
  let campoParte = el('span', 'pr-ro mono', (it.part || 1) + ' de ' + totalPartes);
  if (nparts > 1){
    const aqui = it.part || 1;
    const colocadas = new Set(itensDoRef(it.ref).filter(x => x !== it).map(x => x.part || 1));
    const fp = fpNome ? HubCore.footprintOf(PLIB, fpNome) : null;
    const pads = fp ? new Set((fp.pads || []).map(p => String(p.name))) : null;
    const sel = el('select', 'pr-inp mono pr-sel');
    sel.title = 'a parte deste item — escolher uma já colocada troca as duas de lugar';
    for (let i = 1; i <= Math.max(nparts, aqui); i++){
      const p = HubCore.partOf(sym, i), pinos = p ? (p.pins || []) : [];
      const semPad = !!pads && pinos.length > 0 && !pinos.some(q => pads.has(String(q.num)));
      const o = el('option', null, i + ' de ' + nparts
        + (p ? ' · ' + pinos.length + (pinos.length === 1 ? ' pino' : ' pinos') : ' · não desenha')
        + (colocadas.has(i) ? ' · colocada' : '') + (semPad ? ' · sem pad' : ''));
      o.value = String(i);
      if (i === aqui) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener('change', () => trocaParteDoItem(it, +sel.value || 1));
    campoParte = sel;
  } else if (sym && totalPartes <= 1){
    /* UMA PARTE SO: o seletor aparece assim mesmo, travado em "1 de 1", e diz por que. Sumindo,
       ele parecia nao existir — o dono procurou a troca de parte num ESP32 de uma parte so
       (2026-10-01) e concluiu que ela nao tinha chegado. O title mora na caixa e no seletor:
       sobre um <select> desabilitado o navegador pode nao mostrar o do proprio campo. */
    const caixa = el('span', 'pr-parte-um');
    const sel = el('select', 'pr-inp mono pr-sel');
    sel.append(el('option', null, '1 de 1'));
    sel.disabled = true;
    caixa.title = sel.title = 'este componente tem uma parte só — para trocar de parte ele precisa '
      + 'ter várias: desenhe-as no editor de símbolos (+ parte), ou troque por um componente que '
      + 'as tenha (Trocar componente…)';
    caixa.append(sel);
    campoParte = caixa;
  }
  prPar(g, [kRef, ref], ['Parte', campoParte]);
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

  /* ODOO: a ficha do produto a um clique, logo abaixo de de onde ele vem. Sem ficha a linha
     continua lá e diz POR QUÊ — sumir com ela faria parecer que a ficha nem tem esse campo. */
  const od = odooDoComp(it);
  const lkOdoo = od && od.alvo ? HubOdooLink.link(od.alvo, { nome: od.nome, texto: 'Abrir no Odoo ↗' }) : null;
  if (lkOdoo) prKvEl(g, 'Odoo', lkOdoo);
  else prKv(g, 'Odoo', od && od.motivo ? od.motivo
                     : od ? 'o espelho não diz qual é o Odoo — rode a sincronização do almoxarifado'
                     : 'sem ficha: vincule ao almoxarifado pelo "Trocar componente…"', 'dim');

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
  paneG.append(secFootprint(it, sym, fpNome));

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
/* O TEMPLATE DE FOLHA (moldura, zonas, carimbo — o .SchDot do Altium): só quando o item `sheet`
   traz `template`. Folha sem o campo desenha exatamente como antes; o motor inteiro mora no
   hub-schtemplate.js, e sem ele carregado isto não faz nada. Campo sem valor sai em branco
   (o Altium mostraria o "*" da semente; na tela, vazio lê melhor). */
function desenhaTemplate(ctx, si, esc){
  const T = typeof HubSchTemplate !== 'undefined' ? HubSchTemplate : null;
  const s = model.sheets[si];
  if (!T || !s) return;
  const d = T.daFolha(schematic, s.name);
  if (!d.tpl) return;
  d.ctxo.faltante = '';
  T.desenha(ctx, d.tpl, HubCore.sheetSize(s), d.ctxo, { esc, aoChegarImagem: () => { cam.draw(); pintaMiniaturas(); } });
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
  desenhaTemplate(ctx, si, esc);
  /* o que tem de ficar POR BAIXO dos fios e dos simbolos (a cruz do cursor do fio) */
  if (o.antesDosFios) o.antesDosFios(ctx);

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
    ctx.rotate(HubCore.rotEfetiva(c) * Math.PI/180);   /* a ordem do Altium: ver HubCore.rotEfetiva */
    /* espelho pelo DADO (opts.mirror), e nao por um ctx.scale(-1,1): o scale virava a
       LETRA do nome e do numero do pino junto com o corpo. hub-draw.js » mirrorPart. */
    const emg = part ? null : desenhoDeEmergencia(c);
    if (part) D.drawSymbolPart(ctx, part, { mirror: !!c.mirror, honraOlho: !showState.pinos, rot: HubCore.rotEfetiva(c) });
    /* desenho emprestado sai INTEIRO em ambar, e nao no azul da casa: ele esta ali para a
       folha ser legivel, nao para passar por simbolo resolvido — a cor e o aviso */
    else if (emg) D.drawSymbolPart(ctx, emg.part, { mirror: !!c.mirror, honraOlho: !showState.pinos, stroke: EMERG_COR, rot: HubCore.rotEfetiva(c) });
    else { ctx.strokeStyle = '#ff5252'; ctx.strokeRect(-100, -100, 200, 200); }
    ctx.restore();
    /* designador e comment: ancora medida pelo textoComp (caixa NA FOLHA + o deslocamento que
       a mao deu). Continuam desenhados fora do ctx.rotate e sempre na horizontal — girar o
       componente nao pode deitar o nome dele, que e o que o Altium tambem faz. */
    /* ancora no canto + `align:'left'` + o mesmo levante de baseline que o net label usa
       (hub-draw.js » drawNetLabel: y + 18 para altura 55, ou seja um terco da altura): o
       worldText centra a letra na vertical, e o Altium a apoia na base */
    const tr = textoComp(c, 'ref');
    const refVisivel = showState.ref && designadorVisivel(c);
    if (refVisivel) D.worldText(ctx, tr.s, tr.x, tr.y + tr.h * 0.33, tr.h, 0, '#000000', 'left');
    if (c.comment && showState.comment){
      const tc = textoComp(c, 'com');
      D.worldText(ctx, tc.s, tc.x, tc.y + tc.h * 0.33, tc.h, 0, '#333366', 'left');
    }
    /* O TRACINHO que liga o texto ao componente e so um INDICADOR de a quem o texto pertence,
       e aparece so ENQUANTO a mao arrasta aquele texto (pedido de 2026-09-24): soltou, some, ate
       o proximo arrasto. Antes ele ficava para sempre em todo texto afastado, e a folha se
       enchia de linhas tracejadas. */
    for (const qual of ['ref', 'com']){
      if (qual === 'ref' && !refVisivel) continue;
      if (qual === 'com' && !(c.comment && showState.comment)) continue;
      if (!(o.textosNaMao && o.textosNaMao.has(chaveAlvo({ it:c, k:qual })))) continue;
      const t = textoComp(c, qual);
      if (Math.abs(t.x - t.bx) < 1 && Math.abs(t.y - t.by) < 1) continue;
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
/* os textos (designador/comment) que a mao esta arrastando AGORA — so eles ganham o tracinho */
function textosNaMao(){
  if (!mouse || mouse.mode !== 'move' || !mouse.moved) return null;
  const out = new Set();
  for (const b of mouse.base.values()) if (b.a.k === 'ref' || b.a.k === 'com') out.add(chaveAlvo(b.a));
  return out.size ? out : null;
}
function drawWorld(ctx, cam){
  desenhaFolha(ctx, sheetIdx, { grid: showState.grid, foco: selNet, esc: cam.scale, textosNaMao: textosNaMao(),
                                antesDosFios: tool === 'wire' ? c => desenhaCruzDoFio(c, 1 / cam.scale) : null });
  drawSelection(ctx, cam);
  drawFerramenta(ctx, cam);
}
/* o que a ferramenta na mao esta prestes a fazer: o fio em elastico, o pouso de
   alimentacao em fantasma e o alvo do ima */
function drawFerramenta(ctx, cam){
  const px = 1 / cam.scale;
  if (tool === 'wire') desenhaFioEmCurso(ctx, px);
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
  /* as guias do arrasto, por baixo do alvo do ima */
  if (GUIAS && mouse && mouse.mode === 'move' && mouse.moved && mouse.cena)
    GUIAS.desenha(ctx, mouse.cena, { escala:cam.scale, fmt:fmtMedida });
  /* a rota do D: o trecho que cada fio ganharia, tracejado na cor das guias, e um anel no pino.
     Os dois pontos sao os do POUSO, entao o tracejado termina onde o D vai por o pino */
  if (mouse && mouse.mode === 'move' && mouse.moved && mouse.rotas && mouse.rotas.length){
    ctx.save();
    ctx.strokeStyle = GUIAS ? GUIAS.COR : '#e0197d'; ctx.lineWidth = 2 * px; ctx.lineCap = 'butt';
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.beginPath();
    for (const r of mouse.rotas){ ctx.moveTo(r.ponta.x, r.ponta.y); ctx.lineTo(r.pino.x, r.pino.y); }
    ctx.stroke();
    ctx.setLineDash([]);
    for (const r of mouse.rotas){ ctx.beginPath(); ctx.arc(r.pino.x, r.pino.y, 4 * px, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.restore();
  }
  /* o ima: alvo laranja no ponto de conexao que vai grudar (o fio tem o X vermelho dele) */
  const ima = tool === 'wire' ? null : tool !== 'select' ? snapHit : moveIma;
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
/* O FIO EM CURSO, com as cores e as espessuras medidas no video do Altium (2026-09-24).
   O video e a tela inteira de um 1920x1080 reduzida a 720p: a barra de tarefas do Windows 11
   (48 px a 100%) mede 32 px no quadro, e a seta do mouse bate com isso — escala 2/3. As
   medidas abaixo sao as do quadro vezes 1,5, em px de tela; o traco fino continua de 1 px
   (no quadro ele e o 1 px da tela borrado pela reducao):
     - o que ja foi fixado: nucleo lavanda-escuro de 3 px com um halo lavanda claro (6 px no
       total); o fio so ganha o azul da folha ao terminar;
     - a perna 1 ate o cursor: cinza, 1 px, continua e NITIDA (no meio do pixel — entre dois
       pixels ela saia em duas linhas palidas); a perna 2, a de antecipacao, pontilhada 4,5/1,5;
     - um x de ±7,5 px em cada canto fixado, no canto das pernas e no centro da cruz;
     - a partida que encostou num ponto eletrico: a bolinha magenta POR CIMA de um X fino;
     - o X vermelho fino e comprido (±12 px) quando o cursor esta sobre um ponto eletrico;
     - a cruz do cursor (±50 px, cinza claro) vai por BAIXO dos fios: desenhaCruzDoFio. */
const FIO_FIXADO = '#7c7a9d', FIO_HALO = '#dcdaf9', FIO_PERNA = '#9a98ad', FIO_PONTOS = '#8a889a',
      FIO_CRUZ = '#c0c0c0', FIO_HOT = '#e3242b', FIO_PARTIDA = '#c2357c';
/* a coordenada de mundo que poe a linha horizontal (eixo 'y') ou vertical ('x') no MEIO do pixel
   do aparelho — com a espessura atual do ctx. Sem getTransform (o harness de Node), fica como esta. */
function noPixel(ctx, v, eixo){
  const m = ctx.getTransform ? ctx.getTransform() : null;
  if (!m) return v;
  const esc = eixo === 'x' ? m.a : m.d, off = eixo === 'x' ? m.e : m.f;
  if (!esc) return v;
  const lw = Math.max(1, Math.round(Math.abs(ctx.lineWidth * esc)));
  const d = esc * v + off;
  const alvo = lw % 2 ? Math.floor(d) + 0.5 : Math.round(d);
  return (alvo - off) / esc;
}
function desenhaFioEmCurso(ctx, px){
  const r = fioCursor;
  const linha = (a, b) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
  /* reta horizontal ou vertical, nitida; a diagonal (45°, livre) vai como esta */
  const reta = (a, b) => {
    if (a[1] === b[1]){ const y = noPixel(ctx, a[1], 'y'); linha([a[0], y], [b[0], y]); }
    else if (a[0] === b[0]){ const x = noPixel(ctx, a[0], 'x'); linha([x, a[1]], [x, b[1]]); }
    else linha(a, b);
  };
  const xis = (p, t) => { ctx.beginPath(); ctx.moveTo(p[0] - t, p[1] - t); ctx.lineTo(p[0] + t, p[1] + t);
                          ctx.moveTo(p[0] - t, p[1] + t); ctx.lineTo(p[0] + t, p[1] - t); ctx.stroke(); };
  ctx.save();
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.setLineDash([]);
  if (wireDraw){
    const pts = wireDraw.pts;
    if (pts.length >= 2){
      const tudo = () => { ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke(); };
      ctx.strokeStyle = FIO_HALO; ctx.lineWidth = 6 * px; tudo();
      ctx.strokeStyle = FIO_FIXADO; ctx.lineWidth = 3 * px; tudo();
    }
    ctx.lineWidth = px;
    const marcas = pts.slice(1);
    if (r){
      const pn = HubFio.pernas(wireDraw, r.pt);
      ctx.strokeStyle = FIO_PERNA;
      if (pn.perna1) reta(pn.perna1[0], pn.perna1[1]);
      if (pn.perna2){ ctx.strokeStyle = FIO_PONTOS; ctx.setLineDash([4.5 * px, 1.5 * px]); reta(pn.perna2[0], pn.perna2[1]); ctx.setLineDash([]); }
      if (pn.canto) marcas.push(pn.canto);
    }
    ctx.strokeStyle = FIO_PONTOS;
    for (const q of marcas) xis(q, 7.5 * px);
    /* na partida, o X e fino e a bolinha fica POR CIMA dele — no video e a bolinha que se ve */
    if (wireDraw.ligado){
      const a = pts[0];
      ctx.strokeStyle = FIO_HOT; xis(a, 13.5 * px);
      ctx.fillStyle = FIO_PARTIDA; ctx.beginPath(); ctx.arc(a[0], a[1], 7.5 * px, 0, 2 * Math.PI); ctx.fill();
    }
  }
  if (r){
    ctx.lineWidth = px;
    /* sobre um ponto eletrico, o X vermelho — mas nao repetido em cima da propria partida;
       fora dele, o x cinza no centro da cruz, que o Altium mostra ate sem fio em curso */
    const naPartida = wireDraw && wireDraw.ligado && r.pt[0] === wireDraw.pts[0][0] && r.pt[1] === wireDraw.pts[0][1];
    if (r.snap){ if (!naPartida){ ctx.strokeStyle = FIO_HOT; xis(r.pt, 12 * px); } }
    else { ctx.strokeStyle = FIO_PONTOS; xis(r.pt, 7.5 * px); }
  }
  ctx.restore();
}
/* A CRUZ DO CURSOR vai POR BAIXO dos fios (desenhaFolha » antesDosFios): por cima, ela
   desbotava de cinza o fio azul que cruzava. ±50 px de tela e cinza claro, a medida do video. */
function desenhaCruzDoFio(ctx, px){
  const r = fioCursor;
  if (!r) return;
  const c = 50 * px;
  ctx.save();
  ctx.strokeStyle = FIO_CRUZ; ctx.lineWidth = px; ctx.setLineDash([]); ctx.lineCap = 'butt';
  const x = noPixel(ctx, r.pt[0], 'x'), y = noPixel(ctx, r.pt[1], 'y');
  ctx.beginPath();
  ctx.moveTo(r.pt[0] - c, y); ctx.lineTo(r.pt[0] + c, y);
  ctx.moveTo(x, r.pt[1] - c); ctx.lineTo(x, r.pt[1] + c);
  ctx.stroke();
  ctx.restore();
}
/* as bordinhas: caixa tracejada com alcas nos cantos em cada item marcado (nos fios, tambem
   em cada vertice) e o retangulo de selecao enquanto ele e arrastado */
function drawSelection(ctx, cam){
  const px = 1 / cam.scale, hs = 3.5 * px, m = 40;
  ctx.save();
  /* O FIO SELECIONADO, COMO NO ALTIUM (as fotos de 2026-09-24): sem caixa em volta — um trecho
     horizontal teria caixa de altura zero, e um retangulo diria "peguei esta area" em vez de
     "peguei este fio". O fio ganha um tracejado claro por dentro e uma alcinha VERDE em cada
     vertice; o PEDACO escolhido no segundo clique (trecho ou vertice) leva as alcinhas VERMELHAS,
     e o resto do fio continua com as verdes, para se ver de que fio ele e pedaco. */
  const linhaSel = (a, b) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
  const alca = (q, cor) => {
    ctx.fillStyle = cor; ctx.fillRect(q[0] - hs, q[1] - hs, 2 * hs, 2 * hs);
    ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = px; ctx.setLineDash([]); ctx.strokeRect(q[0] - hs, q[1] - hs, 2 * hs, 2 * hs);
  };
  for (const a of sel.values()){
    const it = a.it;
    if (!onSheet(it) || it.t !== 'wire') continue;
    const pts = it.pts || [];
    const escolhidos = a.k === 'seg' ? [a.i, a.i + 1] : a.k === 'vert' ? [a.i] : [];
    ctx.strokeStyle = SEL_FIO; ctx.lineWidth = px; ctx.setLineDash([3 * px, 3 * px]);
    if (a.k === 'seg'){ if (pts[a.i] && pts[a.i + 1]) linhaSel(pts[a.i], pts[a.i + 1]); }
    else for (let i = 1; i < pts.length; i++) linhaSel(pts[i - 1], pts[i]);
    pts.forEach((q, i) => { if (escolhidos.indexOf(i) < 0) alca(q, ALCA_VERDE); });
    for (const i of escolhidos) if (pts[i]) alca(pts[i], ALCA_VERMELHA);
  }
  for (const a of sel.values()){
    const it = a.it;
    if (!onSheet(it) || it.t === 'wire') continue;
    const bb = alvoBBox(a);
    const mm = (a.k === 'ref' || a.k === 'com') ? 10 : m;    /* o texto quer moldura justa */
    const x = bb.x1 - mm, y = bb.y1 - mm, w = (bb.x2 - bb.x1) + 2*mm, h = (bb.y2 - bb.y1) + 2*mm;
    ctx.strokeStyle = SEL; ctx.lineWidth = 1.5 * px; ctx.setLineDash([6 * px, 4 * px]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = SEL;
    for (const [cx, cy] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) ctx.fillRect(cx - hs, cy - hs, 2*hs, 2*hs);
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
  /* o mkCamera le o bg a cada quadro: com o getter a troca de tema chega sem recriar a camera */
  get bg(){ return mesaCor; },
  onMove: w => {
    hoverW = w;
    $('sx').textContent = w.x.toFixed(0);
    $('sy').textContent = w.y.toFixed(0);
    /* com ferramenta na mao o que interessa e o ima, nao o que esta sob o cursor */
    if (tool === 'wire'){
      fioCursor = panning ? null : pontoDoFio(w);
      snapHit = null;
      statusDoFio();
      cam.draw();
      return;
    }
    if (tool !== 'select'){
      snapHit = panning ? null : snapPoint(w, tool !== 'noerc');
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
    /* (no "so fios" o hitTest so devolve fio; sem fio debaixo, a barra lembra o modo) */
    $('shover').textContent =
      h ? (h.kind === 'pin' ? `${h.ref}-${h.num} · ${nets.pinNet[h.ref + '-' + h.num] || 'sem net'}`
         : h.kind === 'wire' ? (describe(alvoDoHit(h)) + ' · ' + (nets.wireNet[sheetIdx][h.wi] || 'sem net'))
                             : describe(alvoDoHit(h))) : soFio ? 'só fios: clique num fio' : '';
    cv.style.cursor = 'default';   /* seta normal; so o pan (agarrando) muda */
  }
});
/* O GESTO E REFEITO A CADA MUDANCA DE CAMERA no meio do arrasto. A roda amplia (e com o Shift
   anda para os lados) com o cursor parado: o ponto do mundo sob ele muda, e o raio da guia, que
   e em px de TELA, tambem. Sem refazer, a tela continuava mostrando o pouso antigo e o soltar
   recalculava com a camera nova — pousava noutro lugar, com a barra ainda anunciando o
   alinhamento. Este ouvinte vem DEPOIS do da camera (mesmo alvo, ordem de registro), entao ja
   ve a camera nova. */
function refazGesto(){ if (mouse && mouse.mode === 'move' && mouse.moved && mouse.ult) leftMove(mouse.ult); }
cv.addEventListener('wheel', refazGesto);

function hitDoFio(s, x, y, tol){
  const f = fioNoPonto(s.wires, x, y, tol);
  return f ? { kind:'wire', wi:f.wi, item:s.wires[f.wi], seg:f.seg, vert:f.vert } : null;
}
function hitTest(x, y){
  const s = model.sheets[sheetIdx];
  const tol = 8 / cam.cam.scale;
  /* SO FIOS (o botao da barra): o clique pega o fio mesmo com pino, designador ou corpo de
     componente por cima — a fila abaixo nunca deixaria. A junção sai junto: clicar na bolinha
     pega o fio que passa por ela. O resto do gesto (inteiro, trecho, vertice, arrasto) e o
     mesmo, porque o que sai daqui tem a forma de sempre. */
  if (soFio) return hitDoFio(s, x, y, tol);
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
    if (!designadorVisivel(c)) continue;          /* o que nao se ve nao se clica */
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
     "selecionar o trecho e nao a polilinha inteira". */
  const hf = hitDoFio(s, x, y, tol);
  if (hf) return hf;
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
/* a parte pedida no seletor do rodape (so com o modal aberto pela ficha de UM componente) */
let symParte = 1;
/* medidos ao ABRIR o modal, para aparecerem antes do clique em Usar e nao num toast depois
   de gravar: quantos componentes do projeto mudam junto e a pinagem que o componente
   espera (null = o simbolo de origem nao existe em acervo nenhum) */
let symQuantos = 0, symEsperados = null;
/* quantos tem o mesmo tipo E o mesmo valor, e qual e o valor — os dois medidos ao abrir,
   como o symQuantos, para a conta nao mudar embaixo de quem esta lendo a tela */
let symQuantosValor = 0, symValor = '';
/* 'valor' (o padrao: mesmo tipo e mesmo valor), 'tipo' (o simbolo inteiro) ou 'um'.
   Nasce em 'valor' a cada abertura do modal: a escolha e daquela troca, nao um modo do
   hub — escolha grudenta faria o gesto seguinte trocar um alcance que ninguem pediu. */
let symEscopo = 'valor';
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
  symOpts = null; symParte = 1;
  symQuantos = 0; symEsperados = null;
  symQuantosValor = 0; symValor = ''; symEscopo = 'valor';
  if (typeof aoFechar === 'function') aoFechar();
}

/* quantos componentes DESTE projeto usam o mesmo nome de simbolo: e o tamanho do estrago
   (ou do conserto) de uma escolha, que e global */
function contaSym(nome){
  if (!nome) return 0;
  return model.sheets.reduce((k, sh) => k + sh.comps.filter(c => c.sym === nome).length, 0);
}

/* quantos sao do MESMO TIPO E VALOR que este componente — o alcance padrao da troca.
   `contaSym` continua existindo e continua sendo por nome de simbolo: ele mede o estrago
   de uma escolha do lib-subs.js, que e global por nome e nao sabe de valor. */
function contaTipo(comp){
  if (!comp) return 0;
  const chave = tipoDoComp(comp);
  return model.sheets.reduce((k, sh) =>
    k + sh.comps.filter(c => tipoDoComp(c) === chave).length, 0);
}

/* os componentes desta folha e das outras que casam com o alcance pedido, sem repetir
   designador (o __hubAplicaVinculos expande cada ref para todas as partes dele) */
function refsDoAlcance(comp, escopo){
  if (!comp) return [];
  const chave = tipoDoComp(comp), sym = comp.sym;
  const casa = escopo === 'tipo' ? (c => c.sym === sym)
             : escopo === 'um'   ? (c => c.ref === comp.ref)
             : (c => tipoDoComp(c) === chave);
  return Array.from(new Set(model.sheets.reduce(
    (l, sh) => l.concat(sh.comps.filter(casa).map(c => c.ref)), [])));
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

/* ── A PARTE, no "Trocar componente" ──
   Pedido do dono (2026-09-30): "na troca de componente também quero poder trocar a parte". O
   seletor so existe com o modal aberto pela ficha de UM componente: na lista do Odoo e na
   selecao de varios o conjunto veio de fora, e "a parte" nao diria de qual item. Ele mostra as
   partes do componente escolhido ou, sem escolha, as do componente de hoje — e assim que se
   troca SO a parte, inclusive de um simbolo da biblioteca do Altium, que nao aparece na lista
   do almoxarifado e e onde moram hoje os componentes de varias partes. A parte vale para o
   item que abriu o modal; os outros designadores do alcance trocam de componente e ficam com
   a parte que tem. */
const symComParte = () => !!symAlvo && !(symOpts && (symOpts.escolhe || symOpts.vinculo));
function symDesenhoDeHoje(){
  const r = symAlvo ? HubCore.resolveSym(SLIB, symAlvo.sym) : null;
  return (r && r.item) || null;
}
const symDaParte = () => symEscolhido ? symEscolhido.item : symDesenhoDeHoje();
const symParteDeHoje = () => (symAlvo && symAlvo.part) || 1;
function symNPartes(){ const s = symDaParte(); return s ? nPartes(s, null) : 1; }
const symParteMuda = () => symComParte() && symNPartes() > 1 && symParte !== symParteDeHoje();
function itensDoRef(ref){
  const fora = [];
  for (const s of model.sheets) for (const c of s.comps) if (c.ref === ref) fora.push(c);
  return fora;
}
/* o seletor do rodape: uma opcao por parte, com os pinos dela — e o que separa a bobina dos
   contatos de um rele sem abrir o desenho. A escolhida fica quando o componente novo a tem;
   senao volta a de hoje, ou a 1 */
function symPintaParte(){
  const lab = $('symParteLab'), sel = $('symParte');
  const n = symComParte() ? symNPartes() : 1;
  /* A VISTA SEMPRE que o modal abre pela ficha de um componente, e TRAVADO em "1 de 1" quando o
     componente (o escolhido, ou o de hoje) tem uma parte so. Escondido, ele parecia nao existir:
     o dono abriu o "Trocar componente" num ESP32 de uma parte (2026-10-01) e nao achou onde
     trocar a parte — ela so aparecia depois de escolher um componente de varias. */
  lab.hidden = !symComParte();
  if (!(symParte >= 1 && symParte <= n)) symParte = symParteDeHoje() <= n ? symParteDeHoje() : 1;
  if (lab.hidden) return;
  sel.disabled = n <= 1;
  lab.title = n > 1 ? '' : symEscolhido
    ? 'o componente escolhido tem uma parte só'
    : 'este componente tem uma parte só — escolha à esquerda um componente de várias partes para trocar a parte';
  const s = symDaParte();
  sel.textContent = '';
  for (let i = 1; i <= n; i++){
    const p = HubCore.partOf(s, i), np = p ? (p.pins || []).length : 0;
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = i + ' de ' + n + (p ? ' · ' + np + (np === 1 ? ' pino' : ' pinos') : '')
                  + (!symEscolhido && i === symParteDeHoje() ? ' (a de hoje)' : '');
    if (i === symParte) o.selected = true;
    sel.append(o);
  }
}
/* a previa: a parte escolhida do componente escolhido — ou, sem escolha, a do componente de
   hoje quando o seletor esta na tela (e ela que muda com o seletor) */
function symDesenha(){
  const c = symEscolhido, comParte = symComParte();
  const alvo = c ? c.item : (comParte && symNPartes() > 1 ? symDesenhoDeHoje() : null);
  /* a parte do COMPONENTE, nao a 1 fixa: previa e contagem de pinos tem de falar da mesma
     parte, senao o aviso de pinagem compara coisas diferentes */
  const parte = comParte ? symParte : symParteDeHoje();
  symPart = alvo ? (HubCore.partOf(alvo, parte) || HubCore.partOf(alvo, 1) || null) : null;
  $('symHint').textContent = symPart ? '' : (c ? 'sem geometria para desenhar' : '');
  fitPreview(camSymEsc, symPart ? D.symBBox(symPart) : null);
  camSymEsc.resize(); ajustaPreviews([camSymEsc]);
}
/* o botao e a linha do rodape: "Trocar a parte" quando so ela muda (nenhum componente
   escolhido, ou o mesmo de hoje), e a parte dita junto do nome */
function symAtualizaBotao(){
  const b = $('symUsar'), c = symEscolhido;
  if (symOpts && symOpts.escolhe){
    b.textContent = symOpts.troca ? 'Trocar a peça' : 'Escolher para a lista';
    b.disabled = !c;
    $('symEscolha').textContent = c ? c.name : 'nenhum componente escolhido';
    return;
  }
  const muda = symParteMuda();
  const mesma = !!c && mesmaPecaDaFolha(apGrupos, symAlvo, c.name, c.valor || null);
  b.textContent = muda && (!c || mesma) ? 'Trocar a parte' : 'Usar este componente';
  b.disabled = !c && !muda;
  const n = symComParte() ? symNPartes() : 1;
  $('symEscolha').textContent = (c ? c.name : (muda ? 'o mesmo componente' : 'nenhum componente escolhido'))
    + (n > 1 && (c || muda) ? ' · parte ' + symParte + ' de ' + n : '');
}

/* O aviso que faltava, no pe da previa: pinagem esperada x pinagem do candidato, e quantos
   componentes mudam junto — os dois ANTES do clique. */
function symAtualizaInfo(){
  const box = $('symInfo');
  if (!box) return;
  box.textContent = '';
  /* SÓ ESCOLHE (o componente fora do esquema da lista do Odoo): não há folha a mudar, então
     alcance e pinagem não se aplicam — o "componente de origem" é de mentira, e um aviso de
     pinagem sobre ele seria alarme falso. Diz-se o que acontece, e só. */
  if (symOpts && symOpts.escolhe){
    /* TROCAR A PEÇA de uma linha EXTRA que já existe não pede quantidade: ela continua a
       mesma (o update do servidor só troca a peça). Prometer o campo que não vem deixava
       quem trocava esperando por ele. */
    box.append(el('div', 'li', symOpts.troca
      ? 'troca a peça desta linha EXTRA da lista do Odoo — a quantidade continua a mesma, '
        + 'e a folha não muda'
      : 'não entra na folha: vai só para a lista do Odoo, numa linha '
        + 'EXTRA — a quantidade você diz em seguida, no próprio painel da lista'));
    return;
  }
  const rs = symAlvo ? HubCore.resolveSym(SLIB, symAlvo.sym) : null;
  /* a pinagem se compara quando ha o que vai para a folha: um componente escolhido, ou a parte
     nova do de hoje. Sem nenhum dos dois, a previa e so da familia aberta, e comparar com ela
     seria alarme sobre uma escolha que ninguem fez */
  const muda = symParteMuda();
  const d = decideTroca({ sym: rs && rs.item && rs.item.name, how: rs && rs.how,
                          quantos: symQuantos, quantosValor: symQuantosValor, valor: symValor,
                          escopo: symEscopo, pinosEsperados: symEsperados,
                          pinosDoCandidato: (symEscolhido || muda) && symPart && symPart.pins
                            ? symPart.pins.length : null });
  if (d.pinos)   box.append(el('div', 'li' + (d.pinosAlerta   ? ' alerta' : ''), d.pinos));
  /* A PARTE, dita antes do clique: de qual para qual, e quem cede a dela quando o designador
     ja tem a parte pedida noutro item (trocaDeParte). So a parte mudando — sem componente, ou
     o mesmo de hoje —, o alcance nao se aplica, e a caixa para aqui. */
  if (muda){
    const t = trocaDeParte(itensDoRef(symAlvo.ref), symAlvo, symParte);
    box.append(el('div', 'li', symAlvo.ref + ': parte ' + symParteDeHoje() + ' → ' + symParte
      + (t.length > 1 ? ' — a parte ' + symParte + ' que já está na folha fica com a ' + symParteDeHoje() : '')));
    const mesma = !!symEscolhido && mesmaPecaDaFolha(apGrupos, symAlvo, symEscolhido.name,
                                                     symEscolhido.valor || null);
    if (!symEscolhido || mesma) return;
  }
  /* LISTA VINDA DE FORA: o conjunto já foi escolhido (uma linha da lista do Odoo, ou os
     componentes marcados na folha). Aqui não há alcance a decidir — e oferecer um seletor
     que não muda nada seria pior do que não ter nenhum. Diz-se QUEM vai mudar, e só. */
  const deFora = !!(symOpts && symOpts.vinculo && symOpts.refs && symOpts.refs.length);
  if (deFora){
    const r = symOpts.refs;
    box.append(el('div', 'li alerta', 'vai valer para ' + r.length + ' designador'
      + (r.length > 1 ? 'es' : '') + ': ' + r.slice(0, 12).join(', ')
      + (r.length > 12 ? ' e mais ' + (r.length - 12) : '')));
    return;
  }
  if (d.impacto) box.append(el('div', 'li' + (d.impactoAlerta ? ' alerta' : ''), d.impacto));
  /* o escopo efetivo vem do decideTroca, que normaliza: pedir 'valor' onde só existe um
     daquele valor vira 'um', e sem isto nenhum rádio ficaria marcado */
  symEscopo = d.escopo;
  /* O ALCANCE, e só quando há escolha. Com um componente só do tipo no projeto uma caixa
     dizendo "trocar os 1" seria enfeite — e enfeite que faz duvidar do que o botão vai
     fazer. Quem decide quais opções existem (e o texto de cada uma) é o decideTroca, que é
     puro e testado; aqui só se desenha o que ele devolveu. Nasce sempre no primeiro item,
     'valor', a cada abertura do modal. */
  for (const op of (d.escopos || [])){
    const l = el('label', 'sym-todos');
    const rb = el('input');
    rb.type = 'radio';
    rb.name = 'symEscopo';
    rb.value = op.id;
    rb.checked = symEscopo === op.id;
    rb.onchange = () => { if (rb.checked){ symEscopo = op.id; symAtualizaInfo(); } };
    l.append(rb, el('span', null, op.rotulo));
    box.append(l);
  }
  if (muda && d.alcance > 1)
    box.append(el('div', 'li', 'a parte vale só para ' + symAlvo.ref
      + '; os outros trocam de componente e ficam com a parte que têm'));
}

function symSelecionar(c){
  symEscolhido = c;
  /* pelo VALOR quando o candidato o tem (o clique), senao pelo nome: com xaras, a marca pelo
     nome caia na linha de outra peca (hub-almoxpick » renderValores guarda o valor em b._v) */
  for (const b of $('symVals').querySelectorAll('.ap-val'))
    b.setAttribute('aria-selected', String(!!c && (c.valor ? b._v === c.valor : b.dataset.nome === c.name)));
  /* o seletor antes da previa: e ele que diz qual parte desenhar */
  symPintaParte();
  symDesenha();
  symAtualizaInfo();
  symAtualizaBotao();
  if (apFam) $('symEditar').title = 'abre "' + apFam.familia + '" na aba Biblioteca » Componentes'
    + (c ? ', já no componente "' + c.name + '"' : '');
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
  $('symNFora').textContent = c.fora;
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
    selValor: (symEscolhido && symEscolhido.valor) || null,
    onPick: it => { symSelecionar(candidatoDoValor(it.nome, it)); symRenderValores(); },
    /* BOTAO DIREITO: excluir o valor da biblioteca. O fluxo (previa, pergunta com quem usa,
       exclusao) mora no hub-almoxpick para a aba Biblioteca do hub usar o MESMO — inclusive o
       mesmo texto de pergunta. Aqui entra so o adaptador desta tela. */
    /* O SÍMBOLO DO ITEM, não o da família. Desde que a lista da esquerda passou a agrupar
       por família (hub-almoxpick » chaveDoGrupo), "CONECTOR BLOCO TERMINAL" cobre 15
       símbolos e `g.familia` deixou de identificar um. O servidor resolve por nome de
       símbolo ou por família do arquivo (symserver » _resolve_almox), e o nome do símbolo
       é o que sempre aponta para um só. */
    onExcluir: (it, g) => HubAlmoxPick.excluirValor(
      { familia: (it.sym && it.sym.name) || g.familia, componente: it.nome, label: it.rotulo },
      {
        confirm: (txt, o) => HubDialog.confirm(txt, o),
        toast: (m, k, ms) => HubDialog.toast(m, k, ms),
        post: async (url, body) => {
          const r = await postSymbols(url.replace('/api/symbols/', ''), body);
          return r.j;
        },
        /* a lista some da tela na hora: sem isto o item excluido continua ali, clicavel, ate
           alguem fechar e reabrir o modal */
        recarregar: async () => {
          await window.__hubRecarregaLibs();
          apGrupos = HubAlmoxPick.grupos();
          apFam = apGrupos.find(x => x.familia === (apFam && apFam.familia)) || null;
          $('symEditar').hidden = !apFam;       /* a familia pode ter saido junto */
          symRenderValores();
        },
      }),
  });
}
/* abrir a familia mostra o DESENHO dela na hora, mesmo antes de escolher o componente: e o
   desenho que diz se a familia e a certa. O componente so se escolhe depois, na lista. */
function escolheFamilia(g){
  apFam = g;
  const b = $('symEditar');
  b.hidden = !g;
  if (g) b.title = 'abre "' + g.familia + '" na aba Biblioteca » Componentes'
                 + (symEscolhido ? ', já no componente "' + symEscolhido.name + '"' : '');
  if (!g) return;
  /* a escolha fica so se ESTA familia tem o valor escolhido — o mesmo objeto, quando o
     candidato veio de um clique. Pelo nome, abrir a familia do xara mantinha a peca da
     familia anterior escolhida, com a linha do xara marcada: 'Escolher' gravava a outra */
  const dela = symEscolhido && g.valores.some(v => symEscolhido.valor ? v.v === symEscolhido.valor
                                                                     : v.nome === symEscolhido.name);
  if (!dela) symSelecionar(null);
  /* sem escolha, o desenho e o da familia aberta — mesmo com a parte do componente de hoje na
     previa (o seletor de parte a pinta ali quando ele tem varias) */
  if (!symEscolhido) previaDaFamilia(g);
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
  /* o valor clicado e o simbolo dele: com xaras, o nome sozinho reacharia o outro */
  const vAntes = (symEscolhido && symEscolhido.valor) || null;
  const symAntes = vAntes && symEscolhido.familia ? symEscolhido.familia.name : null;
  apGrupos = HubAlmoxPick.grupos();
  apFam = famNome ? (apGrupos.find(g => g.familia === famNome) || null) : null;
  /* a familia aberta pode ter sumido com a recarga: o "Editar símbolo ↗" some junto, senao
     fica visivel e mudo (o editarSimboloNoHub sai calado sem familia) */
  $('symEditar').hidden = !apFam;
  if (symAlvo) apRec = recomendacaoDoSeletor(symAlvo);
  /* a seleção ANTES do render: quem desenha a lista de valores lê symEscolhido para marcar.
     O valor clicado é reachado nos grupos NOVOS (os objetos mudaram com a recarga) pelo
     símbolo e pelo id (reachaValor). Sumiu, a escolha cai — e NÃO volta pelo nome, que
     acharia o xará e deixaria outra peça escolhida, com o toast verde. O candidato que nunca
     teve valor (veio da lista por nome) continua pelo nome, como sempre. */
  const itNovo = (escolhido && vAntes) ? reachaValor(apGrupos, escolhido, vAntes, symAntes) : null;
  const c = !escolhido ? null
          : vAntes ? (itNovo ? candidatoDoValor(escolhido, itNovo) : null)
          : candidatoDoValor(escolhido, null);
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
  /* `edsym` é NOME DE SÍMBOLO, e a família deixou de ser um (ver o comentário do onExcluir).
     Mandar "CONECTOR BLOCO TERMINAL" faz o hub-symed abrir a aba vazia e devolver false —
     sem toast, sem erro, só uma tela em branco. O símbolo sai do componente escolhido; sem
     escolha, do primeiro da lista, que depois da ordenação é o de menor número de vias. */
  /* o item do VALOR clicado quando ele veio (xaras tem o mesmo nome), senao pelo nome */
  const vEsc = symEscolhido && symEscolhido.valor;
  const doItem = (comp && g.valores.find(x => vEsc ? x.v === vEsc : x.nome === comp))
              || (comp && g.valores.find(x => x.nome === comp)) || g.valores[0] || null;
  const q = new URLSearchParams();
  q.set('edsym', (doItem && doItem.sym && doItem.sym.name) || g.familia);
  if (comp) q.set('edcomp', comp);
  const acervo = (doItem && doItem.lib) || g.lib;
  if (acervo && acervo.id) q.set('edacervo', acervo.id);
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
  /* A família pode cobrir vários símbolos — `CIRCUITO INTEGRADO` junta [8P], [14P], [16P]…
     numa linha só. A prévia mostra o PRIMEIRO da lista e diz que há outros, em vez de
     desenhar um qualquer calado: o desenho aqui serve para reconhecer a família, e o do
     componente certo aparece assim que se escolhe. Conector não cai neste caso — ele tem um
     símbolo por subtipo e a pinagem vive no próprio valor (`valores[].parts`). */
  const prim = (g.valores && g.valores[0]) || null;
  const sy = (prim && prim.sym) || g.sym;
  const quantos = new Set((g.valores || []).map(x => x.sym && x.sym.name)).size;
  symPart = HubCore.partOf(sy, 1) || null;
  $('symHint').textContent = symPart
    ? (quantos > 1 ? 'desenho de "' + sy.name + '" — esta família tem ' + quantos
                     + ' pinagens; escolha o componente para ver a dele' : '')
    : 'esta família não tem desenho no espelho';
  fitPreview(camSymEsc, symPart ? D.symBBox(symPart) : null);
  camSymEsc.resize(); ajustaPreviews([camSymEsc]);
}
/* o valor escolhido vira o candidato que o resto do modal ja entende: o alias do valor esta
   no SLIB (montaAcervos cria um por valor), entao e ele que a previa desenha e que o
   usarSimboloEscolhido grava no lib-subs.js */
function candidatoDoValor(nome, it){
  const item = HubCore.symbolOf(SLIB, nome);
  if (!item) return null;
  const c = { name: nome, item, pontos: 0, porque: [] };
  /* O VALOR CLICADO VIAJA JUNTO (o `it` do hub-almoxpick): o nome nao o identifica — dois
     valores podem ter o mesmo, e o de um simbolo da casa vence o alias. O modo so escolhe
     tira a identidade dele (identidadeDoEscolhido); os outros continuam pelo nome. */
  if (it && it.v){ c.valor = it.v; c.familia = it.sym || null; }
  return c;
}

/* A recomendacao do seletor (o valor que abre marcado). Com a peca de hoje em maos — o
   params de um componente colocado do almoxarifado, ou o de um EXTRA da lista do Odoo —, vale
   primeiro a IDENTIDADE dela (pecaDeHoje, pelo OdooId): o nome nao separa xaras, e o 'Cartão
   Micro SD' do soquete abria marcado no do conector, com o 'Trocar a peça'/'Usar' a um clique
   de gravar o outro produto. Sem params, ou params que nada casa, vale o NOME, como sempre.
   Depende de apGrupos ja montado. */
function recomendacaoDoSeletor(comp){
  const rs = HubCore.resolveSym(SLIB, comp.sym);
  return recomendacaoDe(apGrupos, comp, HubAlmoxPick.recomendado(apGrupos, comp.sym, rs && rs.name));
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
  apRec = recomendacaoDoSeletor(comp);
  symQuantos = contaSym(comp.sym);
  symQuantosValor = contaTipo(comp);
  symValor = valorDoComp(comp);
  /* o alcance nasce em 'valor'; no modo vinculo ele nem aparece, porque a lista de refs
     ja veio decidida de fora (a linha da lista do Odoo, ou a selecao de varios) */
  symEscopo = 'valor';
  symEsperados = pinosEsperadosDe(comp);
  const rs = HubCore.resolveSym(SLIB, comp.sym);
  const atual = (rs && rs.item) || null;
  /* o cabecalho muda de "procurar" para "trocar" quando ja ha COMPONENTE resolvido, e diz
     qual e de onde ele veio: e a pergunta que o modal tem de responder antes de qualquer
     clique. Componente e a entrada da biblioteca; simbolo e so o desenho dela — o modal
     escolhe o primeiro, e a faixa de baixo (quando existir) troca o segundo */
  /* o modo SO ESCOLHE (__hubEscolheParaLista) usa o mesmo modal para outra pergunta — "qual
     peça vai na lista?" — e o cabeçalho e o botão dizem isso, senão prometem mexer na folha */
  const soEscolhe = !!(symOpts && symOpts.escolhe);
  $('symTitle').textContent = soEscolhe ? 'Componente fora do esquema'
                            : atual ? 'Trocar componente' : 'Procurar componente';
  /* o seletor de parte nasce na parte do item; o texto do botao sai do symAtualizaBotao */
  symParte = comp.part || 1;
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
  /* a ficha no Odoo do componente que está NA FOLHA, ao lado do nome dele — irmão, não
     filho: o #symNome é um <button> (o de copiar). O da abertura anterior sai antes. */
  const odVelho = $('symOdoo');
  if (odVelho) odVelho.remove();
  const odAtual = odooDoComp(comp);
  const lkAtual = odAtual && odAtual.alvo ? HubOdooLink.link(odAtual.alvo, { nome: odAtual.nome }) : null;
  if (lkAtual){ lkAtual.id = 'symOdoo'; nb.after(lkAtual); }
  $('symMeta').textContent = soEscolhe
    ? 'vai só para a lista do Odoo — a folha não muda'
      + (!comp.sym ? ''
         : apRec && apRec.seleciona === false
           ? ' · a peça de hoje saiu do almoxarifado: escolha a nova (a de mesmo nome pode ser outra)'
           : ' · a peça de hoje é a do nome ao lado')
    : comp.ref + ' — o Altium mandou este nome'
      + (comp.comment ? ' · comment "' + comp.comment + '"' : '')
      + (atual ? ' · resolvido no componente "' + atual.name + '"'
               + (rs.how === 'escolha' ? ', por escolha sua' : '') : '');
  $('symBusca').value = '';
  $('symmodal').classList.add('on');
  apFam = apRec ? apRec.grupo : null;
  /* o "Editar símbolo ↗" acompanha a familia aberta: ela vem aberta pela recomendacao, e so o
     escolheFamilia (clique na lista) o mostrava — abria escondido, e da abertura anterior
     podia ficar visivel sem familia nenhuma */
  $('symEditar').hidden = !apFam;
  /* a recomendacao que so APONTA (seleciona:false — recomendacaoDe) abre a familia e marca a
     linha, mas nao escolhe: o Usar fica apagado ate um clique */
  symSelecionar(apRec && apRec.seleciona !== false ? candidatoDoValor(apRec.item.nome, apRec.item) : null);
  if (!apRec) symRenderLista(); else { symRenderLista(); }
  if (!symEscolhido && apFam) previaDaFamilia(apFam);
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
                    + 'para gravar, use a aba Biblioteca » Componentes', 'warn', 7000);
    return;
  }
  const nPartes = (alvo.parts || []).length || 1;
  if (nPartes > 1){
    HubDialog.toast('"' + para + '" tem ' + nPartes + ' partes — atribuir o desenho de uma só '
                    + 'apagaria as outras; use a aba Biblioteca » Componentes', 'warn', 7000);
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

/* SO A PARTE do item muda — nem identidade nem desenho novo. Um passo so do desfazer, e o
   item que cede a parte pedida (trocaDeParte) vai junto nele. E o mesmo gesto pelo seletor
   da ficha (renderProps) e pelo "Trocar a parte" do modal. */
function trocaParteDoItem(item, para){
  const t = trocaDeParte(itensDoRef(item.ref), item, para);
  if (!t.length) return;
  for (const x of t) x.item.part = x.para;
  commit();
  HubDialog.toast(item.ref + ': parte ' + t[0].de + ' → ' + t[0].para
    + (t.length > 1 ? ' (a parte ' + t[1].de + ' que já estava na folha virou a ' + t[1].para + ')' : '')
    + '. Ctrl+Z desfaz, e só o Salvar grava.', 'ok');
}
function trocaSoAParte(item, para){
  fechaSymModal();
  trocaParteDoItem(item, para);
}

async function usarSimboloEscolhido(){
  if (!symAlvo) return;
  /* SO A PARTE: nenhum componente escolhido (o seletor mostrava as partes do de hoje), ou o
     mesmo componente de hoje escolhido na lista. Fora do modo com parte, sem escolha nao ha o
     que fazer, e o mesmo componente continua sendo "ja e esse". */
  const parteNova = symParteMuda() ? symParte : null;
  const soEscolhe = !!(symOpts && symOpts.escolhe);
  if (!soEscolhe && (!symEscolhido || (!(symOpts && symOpts.vinculo)
      && mesmaPecaDaFolha(apGrupos, symAlvo, symEscolhido.name, symEscolhido.valor || null)))){
    if (parteNova){ trocaSoAParte(symAlvo, parteNova); return; }
    if (symEscolhido) HubDialog.toast('já é esse componente', 'warn');
    return;
  }
  if (!symEscolhido) return;
  /* MODO SÓ ESCOLHE — o componente fora do esquema da lista do Odoo. Nada aqui toca na folha:
     a identidade sai da MESMA função que o vínculo e o "Adicionar componentes" usam, e vai
     para quem pediu. Família sem valor único é recusada como o __hubAplicaVinculos recusa. */
  if (symOpts && symOpts.escolhe){
    const esc = symEscolhido, nome = esc.name;
    /* pelo VALOR clicado, quando ele veio (identidadeDoEscolhido): e isso que separa dois
       valores de mesmo nome, e que deixa entrar o BC807 cujo nome e tambem da lib da casa */
    const ident = identidadeDoEscolhido(esc, n => HubCore.resolveSym(SLIB, n));
    if (!ident.ok){
      await HubDialog.alert(ident.porque, { title: 'não dá para usar este componente' });
      return;
    }
    const aoEscolher = symOpts.aoEscolher;
    /* a familia e o MPN vao junto so para a tela dizer QUAL peca foi — com dois valores de
       mesmo nome, o nome sozinho nao diz */
    const familia = (esc.familia && (esc.familia.familia || esc.familia.name))
                 || (esc.item && esc.item.familia) || '';
    fechaSymModal();
    aoEscolher({ sym: ident.sym, comment: ident.comment, footprint: ident.footprint,
                 params: ident.params, nome: nome, valor: String(ident.valor.label || ''),
                 familia: String(familia), mpn: String(ident.valor.mpn || '').trim() });
    return;
  }
  const de = symAlvo.sym, para = symEscolhido.name, refAlvo = symAlvo.ref;
  /* medido ANTES da substituicao: depois dela o simbolo resolve e o emprestimo some */
  const emg = HubCore.symbolOf(SLIB, de) ? null : desenhoDeEmergencia(symAlvo);
  /* "ja e esse" (la em cima, junto com a troca so de parte) so quando nada muda: com o valor
     clicado em maos, o nome igual nao basta — o conector e o soquete 'Cartão Micro SD' tem o
     mesmo nome e sao pecas diferentes. E a peca se compara pela IDENTIDADE (mesmaPecaDaFolha),
     nao pela string do params: o saldo e o custo mudam a cada sync, e o clique nulo passava a
     regravar o alcance inteiro */

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
  /* O ALCANCE, decidido pelo seletor do modal (refsDoAlcance).
     "Mesmo tipo" passou a ser `sym` E VALOR em 2026-09-16: os 24 `RES [ SMD ]` do
     PRJ-UR-DI261924 são 10K, 1K, 2K2 e 15R, e trocar o 10K trocava os quatro. O designador
     não entra na conta — dois CAP de 100nF são o mesmo tipo sejam eles C3 e C5 ou C3 e R9.
     Cada designador aparece UMA vez na lista, e o __hubAplicaVinculos expande cada um para
     todas as partes dele.

     A lista de fora vence tudo: ela é a linha da lista do Odoo, ou a seleção de vários
     componentes na folha — nos dois casos quem escolheu o conjunto foi o usuário, e não
     cabe a esta função reabrir a conta. */
  const refs = (symOpts && symOpts.vinculo && symOpts.refs && symOpts.refs.length)
    ? symOpts.refs.slice()
    : refsDoAlcance(symAlvo, symEscopo);
  /* o VALOR clicado vai junto (identidadeDoVinculo): pelo nome, o xara clicado gravava o
     OdooId do outro, e o BC807 da lib da casa era recusado como familia */
  const res = window.__hubAplicaVinculos([{ refs: refs, componente: para,
                                            valor: symEscolhido.valor || null,
                                            familia: symEscolhido.familia || null,
                                            parte: parteNova ? { item: symAlvo, para: parteNova } : null }]);
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
  for (const pt of (res.partes || []))
    HubDialog.toast(pt.ref + ': parte ' + pt.de + ' → ' + pt.para, 'info', 6000);
  /* a parte pedida so vale com o desenho novo na folha: com a identidade apenas (o componente
     novo nao tem todas as partes que o designador usa), o numero seria de outro desenho */
  if (res.parteIgnorada)
    HubDialog.toast(refAlvo + ': a parte ficou como estava — "' + para + '" não tem todas as partes '
      + 'que ' + refAlvo + ' usa na folha, e só a identidade foi gravada', 'warn', 9000);
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
$('symParte').addEventListener('change', () => {
  symParte = +$('symParte').value || 1;
  symDesenha(); symAtualizaInfo(); symAtualizaBotao();
});
$('symBusca').addEventListener('input', symRenderLista);
$('symEditar').addEventListener('click', editarSimboloNoHub);
/* O SELETOR PROCURAVA UMA CLASSE QUE NAO EXISTE. Os botoes sao `<button data-f=...>` e o
   handler fazia `closest('.ap-f')` -- nenhum elemento do projeto tem essa classe, entao o
   clique saia pelo `if (!b) return` e os tres filtros (Tudo / Com saldo / Zerados) nunca
   fizeram nada. Nao dava erro nenhum: o botao acendia? nao, nem isso. Agora casa pelo
   proprio `data-f`, que e o que define um botao deste grupo. */
$('symFiltros').addEventListener('click', e => {
  const b = e.target.closest('button[data-f]'); if (!b) return;
  apFiltro = b.dataset.f;
  for (const x of $('symFiltros').querySelectorAll('button[data-f]'))
    x.setAttribute('aria-pressed', String(x === b));
  symRenderLista();
});
$('symmodal').addEventListener('mousedown', e => { if (e.target === $('symmodal')) fechaSymModal(); });

/* ------- teclado ------- */
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (symModalAberto()){ fechaSymModal(); return; }
    if (addOpen()){ closeAdd(); return; }
    /* a gaveta aberta vem logo depois dos modais: o Esc a fecha e a ferramenta na mao fica.
       Quem estava nela pelo teclado volta para a setinha, e nao para o nada. */
    if (gavAberta()){
      const dentro = $('gavPousoLista').contains(document.activeElement);
      gavAbre(false);
      if (dentro) $('tbPousoSeta').focus();
      return;
    }
    if (wireDraw){ endWire(); return; }
    if (tool !== 'select'){ setTool('select'); return; }
    if (mouse){
      /* o Escape desfaz o DESLOCAMENTO; o giro dado no meio do gesto fica, e entra no undo */
      const girou = mouse.mode === 'move' && girouDeFato(mouse);
      if (mouse.mode === 'move') applyMove(mouse.base, 0, 0);
      mouse = null; boxRect = null; swallowClick = true;
      /* o alvo do ima e a frase da guia sao do gesto: sem isto ficavam na tela, anunciando um
         alinhamento que o Escape acabou de desfazer */
      moveIma = null; $('shover').textContent = '';
      if (girou) commit(); else cam.draw();
      return;
    }
    /* Escape e o botao de panico: larga a selecao E o foco de net. Enquanto largava so a
       selecao, a folha ficava laranja sem nada marcado — a "cor travada". */
    if (sel.size || selNet) limpaSel();
    /* sem nada para largar, o Esc seguinte larga o "so fios" e volta ao Selecionar normal */
    else if (soFio) setSoFio(false);
    return;
  }
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (addOpen() || symModalAberto()) return;   /* os atalhos da folha nao valem dentro do modal */
  /* O FIO NA MAO tem teclas proprias, como no Altium, e elas vem antes dos atalhos: aqui o
     Espaco inverte o canto (nao gira a selecao), Shift+Espaco troca o modo, Backspace desfaz */
  if (tool === 'wire' && (e.key === ' ' || e.code === 'Space')){ e.preventDefault(); espacoDoFio(e.shiftKey); return; }
  if (tool === 'wire' && wireDraw && e.key === 'Backspace'){ e.preventDefault(); backspaceDoFio(); return; }
  /* as sequencias do Altium (O,D; O,S e as da predefinicao "Padrao Altium"): o leitor do
     hub-atalhos.js segura o comeco e o mostra no rodape; tecla simples sai igual a antes */
  const tk = normalizaTecla(e);
  let acao = ATALHOS.porTecla[tk];
  const ld = leitorSch();
  /* a letra que abre menu no Altium (P Place, D Design, T Tools...): o menu do Esquema no
     cursor e a letra seguinte escolhe -- quando ela nao e de nenhuma acao, ou e so o comeco de
     uma sequencia (a predefinicao Padrao Altium) */
  const comeco = ATALHOS.prefixos instanceof Set && ATALHOS.prefixos.has(tk);
  if (ALT_SCH && /^[A-Z]$/.test(tk) && !(ld && ld.pendente()) && (!acao || comeco) && ALT_SCH.temPopup(tk)) {
    e.preventDefault();
    const p = ultimoMouseSch || { x:innerWidth / 2, y:innerHeight / 2 };
    ALT_SCH.popup(tk, p.x, p.y);
    return;
  }
  if (ld) {
    if (ld.pendente() || comeco) {
      e.preventDefault(); ld.tecla(tk); return;
    }
  }
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
  gavAbre(false);     /* um atalho que age fecha a gaveta: senao ela sobrava atras do modal */
  switch (id){
    /* com um componente marcado: a galeria para trocar o footprint dele; sem nada, o editor */
    case 'footprints': { const a = selAlvos().find(x => x.it && x.it.t === 'comp');
      if (a) trocaFootprint(a.it, HubCore.symbolOf(SLIB, a.it.sym)); else abreFootprint(null); return; }
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
    case 'template':  if (typeof HubSchTemplateUI !== 'undefined') HubSchTemplateUI.abreEditor(); return;
    case 'folha':     if (typeof HubSchTemplateUI !== 'undefined') HubSchTemplateUI.abreParametros(); return;
    case 'enquadrar': cam.fit(fitBBox()); refazGesto(); return;
    case 'buscar':    abreBusca(); return;
    case 'grade':     $('btnGrid').click(); return;
    case 'desfazer':  undo(); return;
    case 'refazer':   redo(); return;
    case 'tudo':      selectOnly(sheetItems()); return;
    case 'rotear':    return rotearNoArrasto();
    case 'salvar':    saveAll(); return;
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

   Cada vinculo e { refs:[...], sym, comment, params, soParams, parte? }. `soParams` e o
   caminho do componente MULTI-PARTE cujo componente novo nao tem todas as partes que ele usa:
   trocar o `sym` de um conector desenhado em 16 partes por um valor de uma parte so largaria
   15 delas e a fiacao junto. Nesses a identidade e gravada (comment + params) e o desenho
   fica como esta — dito na tela, nao escondido. `parte` ({ item, para }) e a parte que o
   "Trocar componente" pediu para o item que o abriu.

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

/* Ponte para o componente FORA DO ESQUEMA da lista do Odoo: o MESMO seletor do almoxarifado,
   num modo que SO ESCOLHE — nao toca na folha, nao empilha desfazer, nao acende o Salvar. O
   que volta e o que o "Adicionar componentes" gravaria na folha para aquele valor, pela
   mesmas funcoes, a partir do VALOR clicado (identidadeDoEscolhido » identidadeDoValor):
   { sym, comment, footprint, params, nome, valor, familia, mpn } — os dois ultimos so para a
   tela dizer qual peca foi. E isso que faz a linha extra resolver no odoolista.py exatamente
   como resolveria o mesmo componente colocado no esquema.

   `atual` (opcional) e a peca que o extra ja tem — { sym, comment, params } —, para o
   seletor abrir nela quando se TROCA a peca de um extra; vindo ele, o seletor fala de troca
   (a quantidade fica), e nao de uma peca nova. Devolve false quando esta vista nao consegue
   abrir o seletor (sem o modal na pagina, ou sem o almoxarifado). */
window.__hubEscolheParaLista = function(aoEscolher, aoFechar, atual){
  if (typeof aoEscolher !== 'function' || !$('symmodal')) return false;
  if (typeof HubAlmoxPick === 'undefined' || !HubAlmoxPick.grupos().length) return false;
  const a = atual || {};
  /* um componente de mentira, so para o seletor ter o que recomendar: ref vazio e nenhuma
     folha, entao nada do que o modal conta (mesmo tipo, mesmo valor) casa com a folha */
  const alvo = { ref: '', sym: String(a.sym || ''), comment: String(a.comment || ''),
                 params: String(a.params || ''), footprint: String(a.footprint || '') };
  abrirEscolhaSimbolo(alvo, { escolhe: true, troca: atual != null,
                              aoEscolher: aoEscolher, aoFechar: aoFechar });
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
  const planos = [], recusados = [];

  for (const v of lista){
    const nome = String((v && v.componente) || '').trim();
    const refs = (v && Array.isArray(v.refs)) ? v.refs.filter(r => porRef.has(r)) : [];
    if (!refs.length){ recusados.push({ componente:nome, porque:'nenhum designador deste vinculo esta na folha' }); continue; }
    if (!nome){ recusados.push({ componente:'?', porque:'vinculo sem componente' }); continue; }

    /* O COMPONENTE E RESOLVIDO AQUI, no espelho desta vista, e nao vem pronto do servidor.
       E o que garante que o vinculo grave exatamente o que o modal "Adicionar componentes"
       grava: mesmo `sym`, mesmo `comment`, mesmo `params` — pela MESMA funcao
       (identidadeDoVinculo, na parte pura). Montar o params do outro lado seria uma
       segunda implementacao do formato, em outra linguagem, que so se descobre divergente
       no dia em que divergir. Com o VALOR clicado no vinculo (o seletor o manda), a
       identidade sai dele; so pelo nome (o painel da BoM), sai do nome, como sempre. */
    const resolve = n => HubCore.resolveSym(SLIB, n);
    const ident = identidadeDoVinculo(v, resolve);
    if (!ident.ok){ recusados.push({ componente:nome, porque:ident.porque }); continue; }
    /* o desvio (lib-subs) e medido sobre o que vai ser gravado: pelo nome, o proprio nome
       pedido; pelo valor, o sym dele */
    const res = resolve(v && v.valor ? ident.sym : nome);
    const comment = ident.comment, params = ident.params;
    /* MULTI-PARTE NAO TROCA DE SIMBOLO, e quem decide isso e ESTA funcao, olhando a folha.
       O alias de valor do almoxarifado quase sempre tem uma parte so; um conector desenhado
       em 16 partes perderia 15 e a fiacao junto. Grava-se a identidade e o desenho fica.

       Isto era responsabilidade de quem chamava, e custou um projeto: o painel da BoM
       calculava `soParams` a partir do grupo, mas o caminho novo de "resolver pela lista do
       Odoo" nao calculava nada — e o CN4 de um DMB, com 4 partes, saiu com 2 (2026-09-15).
       A guarda mudou de lugar: o `porRef` daqui SABE quantas partes cada designador tem, e
       nenhum chamador precisa lembrar de uma regra que a folha ja responde. O `v.soParams`
       continua valendo para quem quer so a identidade mesmo sendo de uma parte.

       Desde 2026-09-30 o desenho TROCA quando o componente novo tem todas as partes que o
       designador usa (desenhoCabe) — um rele de duas partes trocado por outro de duas. O
       conector de 16 partes trocado por um de uma continua recebendo so a identidade.

       `v.parte` = { item, para }: a parte que o "Trocar componente" pediu para UM item (o que
       abriu o modal). Entra no mesmo passo do desfazer, e so quando o desenho troca — com a
       identidade apenas, o numero da parte seria de um desenho que nao esta na folha. */
    const nNovo = (res && res.item) ? nPartes(res.item, null) : 1;
    const pedido = (v && v.parte && v.parte.item) ? v.parte : null;
    let multiParte = false, cabe = true;
    for (const ref of refs){
      const its = porRef.get(ref);
      if (its.length > 1 || its.some(c => (c.part || 1) > 1)) multiParte = true;
      const trocas = (pedido && pedido.item.ref === ref) ? trocaDeParte(its, pedido.item, pedido.para) : [];
      if (!desenhoCabe(its, nNovo, trocas)) cabe = false;
    }
    const soParams = !!v.soParams || (multiParte && !cabe);
    planos.push({
      refs, comment, params,
      sym: soParams ? null : ident.sym,
      soParams: soParams,
      multiParte: multiParte,
      parte: soParams ? null : pedido,
      parteIgnorada: !!(soParams && pedido),
      /* resolveu, mas nao pelo nome exato: o lib-subs.js guarda escolhas GLOBAIS por nome e
         elas vencem o nome exato. Gravar "X" e a folha desenhar "Y" nao e erro de gravacao,
         e surpresa — e surpresa tem de sair na tela. */
      desvio: (res && res.how !== 'exato') ? { como:res.how, vira:res.name } : null,
    });
  }
  if (!planos.length) return { ok:false, erro:'nenhum vinculo passou na conferencia', recusados };

  let itens = 0;
  const refsTocados = [], encaixes = [], partes = [];
  for (const p of planos)
    for (const ref of p.refs){
      const its = porRef.get(ref);
      /* os pinos de TODAS as partes do designador, medidos antes de qualquer mudanca: a troca
         de parte mexe em dois itens de uma vez, e o segundo nao pode ser medido ja trocado */
      const antesDe = new Map(its.map(c => [c, p.sym ? (HubCore.compPinsWorld(c, SLIB) || []) : null]));
      const trocas = (p.parte && p.parte.item.ref === ref) ? trocaDeParte(its, p.parte.item, p.parte.para) : [];
      for (const t of trocas){ t.item.part = t.para; partes.push({ ref, de: t.de, para: t.para }); }
      const outraParte = new Set(trocas.map(t => t.item));
      for (const c of its){
        /* ── O ENCAIXE ──
           Trocar o componente troca o DESENHO, e desenho novo poe os pinos noutro lugar em
           volta da MESMA ancora: os fios ficam onde estavam e a ligacao se desfaz sem uma
           linha de aviso, porque a extracao de nets casa por coordenada exata. Mede-se onde
           os pinos estavam, troca-se, mede-se de novo, e o componente inteiro anda o tanto
           que devolve o maior numero de pinos ao ponto antigo (encaixeDaTroca, no bloco puro).
           So faz sentido quando o SIMBOLO muda e a PARTE fica: com `soParams` o desenho e o
           mesmo, e a parte trocada e outro desenho, com outros pinos — casar os numeros dela
           com os da parte antiga moveria o componente para um lugar que nao encaixa nada. */
        const antes = antesDe.get(c);
        if (p.sym) c.sym = p.sym;
        if (p.comment) c.comment = p.comment; else delete c.comment;
        if (p.params) c.params = p.params; else delete c.params;
        if (antes && antes.length && !outraParte.has(c)){
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
  return { ok:true, vinculos:planos.length, refs:refsTocados, itens, recusados, encaixes, partes,
           parteIgnorada: planos.some(p => p.parteIgnorada),
           soIdentidade: planos.filter(p => p.multiParte && p.soParams).map(p => p.refs.join(', ')),
           desvios: planos.filter(p => p.desvio).map(p => ({ refs:p.refs, sym:p.sym,
                                                             como:p.desvio.como, vira:p.desvio.vira })) };
};
/* Os componentes da folha, para quem precisa LISTAR o projeto (hub-converte.js). Copia rasa
   de propriedade, e nao o objeto do modelo: painel que recebe o comp de verdade pode escrever
   nele sem passar pelo commit(), e a folha passa a mostrar uma coisa que o undo nao desfaz. */
window.__hubComponentes = function(){
  const fora = [];
  for (const s of model.sheets)
    for (const c of s.comps)
      fora.push({ ref:c.ref, sym:c.sym, footprint:c.footprint, comment:c.comment,
                  params:c.params, part:c.part || 1, sheet:s.name });
  return fora;
};

window.__hubSelectComp = function(ref){
  for (const s of model.sheets){ const c = s.comps.find(c => c.ref === ref); if (c){ focusComp(c); return; } }
};
/* os ganchos do MCP (mcp/hub-mcpvista.js), os mesmos da vista PCB: a IA mostra ao usuario o que fez.
   focar {x, y, zoom (meia largura em mil, padrao 800) | ref}; selecionar {refs, net, folha};
   comando = qualquer acao da barra/teclado (fazAcao: enquadrar, girar, apagar, salvar...); captura. */
window.HubMcpVista = {
  focar(x, y, zoom, a){
    if (a && a.ref){ window.__hubSelectComp(a.ref); return true; }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const r = Number.isFinite(zoom) && zoom > 0 ? zoom : 800;
    cam.fit({ x1:x - r, y1:y - r, x2:x + r, y2:y + r });
    return true;
  },
  selecionar(o){
    o = o || {};
    if (Number.isFinite(o.folha) && o.folha >= 0 && o.folha < model.sheets.length) setSheet(o.folha);
    const refs = (o.refs || []).map(String);
    if (refs.length){
      const sh = model.sheets.findIndex(s => s.comps.some(c => refs.indexOf(c.ref) >= 0));
      if (sh < 0) return 0;
      const comps = model.sheets[sh].comps.filter(c => refs.indexOf(c.ref) >= 0);
      if (comps.length === 1) focusComp(comps[0]);
      else { if (sh !== sheetIdx) setSheet(sh); selSo(comps.map(alvoAll)); aplicaSel(''); }
      return comps.length;
    }
    if (o.net){ aplicaSel(String(o.net)); return 1; }
    return 0;
  },
  comando(nome){ if (typeof nome !== 'string' || !nome) return false; return fazAcao(nome) !== false; },
  captura(){ return cv; },
};
window.addEventListener('beforeunload', e => { if (schDirty){ e.preventDefault(); e.returnValue = ''; } });

/* ---------- paineis ---------- */
function focusComp(c){
  const si = model.sheets.findIndex(sh => sh.name === c.sheet);
  /* troca a folha SEM o limpaSel/enquadrar do setSheet: quem chama daqui ja traz a propria
     selecao (o componente) e o proprio enquadramento, logo abaixo */
  if (si >= 0 && si !== sheetIdx){
    /* o fio em curso e da folha que esta saindo: gravado ANTES da troca (o endWire carimba a
       folha ativa), senao ia para a folha nova com os pontos clicados na velha */
    if (wireDraw) endWire();
    sheetIdx = si; pintaCartaoAtivo();
  }
  selSo([alvoAll(c)]);
  /* a porta de entrada do hub (__hubSelectComp) tambem passa por aqui: nao pode deixar a net
     anterior acesa por baixo do componente novo */
  aplicaSel('');
  cam.fit({ x1:c.x-800, y1:c.y-800, x2:c.x+800, y2:c.y+800 });
}
/* ------- Ctrl+F: procurar componente -------
   Pedido do dono (2026-10-27): "ctrl+F no esquema te ajuda a procurar um componente, por
   qualquer nome, designator, comentario, vai escrevendo e ele vai marcando". Cada palavra
   digitada tem de aparecer em algum campo do componente (designador, comentario, simbolo,
   footprint, parametros, descricao), sem caixa e sem acento, em TODAS as folhas. Enquanto se
   digita, os achados da folha ficam selecionados e a camera vai ao melhor; Enter/Shift+Enter
   (ou as setas) andam entre eles, trocando de folha quando precisa; Esc fecha e a selecao
   fica. A lista e refeita a cada passo: undo, troca de folha ou commit trocam os objetos. */
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const busca = { idx:0, achados:[] };
function achaComps(q){
  const palavras = semAcento(q).split(/\s+/).filter(Boolean);
  if (!palavras.length) return [];
  const p0 = palavras[0], out = [];
  model.sheets.forEach((s, si) => {
    const porRef = new Map();        /* as partes (A, B, ...) de um componente sao um achado so */
    for (const c of s.comps){
      const sy = HubCore.symbolOf(SLIB, c.sym);
      const ref = semAcento(c.ref), com = semAcento(c.comment);
      const tudo = [ref, com, semAcento(c.sym), semAcento(c.footprint), semAcento(c.params),
                    semAcento(sy && (sy.description || sy.desc))].join('\n');
      if (!palavras.every(w => tudo.indexOf(w) >= 0)) continue;
      const ja = c.ref && porRef.get(c.ref);
      if (ja){ ja.partes.push(c); continue; }
      const nota = ref === p0 ? 0 : ref.indexOf(p0) === 0 ? 1 : ref.indexOf(p0) >= 0 ? 2 : com.indexOf(p0) >= 0 ? 3 : 4;
      const a = { c, si, nota, partes:[c] };
      if (c.ref) porRef.set(c.ref, a);
      out.push(a);
    }
  });
  /* a ordem nao depende da folha aberta: o Enter anda numa lista que nao se reembaralha */
  out.sort((a, b) => a.nota - b.nota || a.si - b.si
    || String(a.c.ref).localeCompare(String(b.c.ref), undefined, { numeric:true }));
  return out;
}
function buscaVai(passo, enquadra){
  const q = $('schBuscaTxt').value;
  const ach = busca.achados = achaComps(q);
  const n = ach.length;
  $('schBusca').classList.toggle('nada', !!q.trim() && !n);
  if (!n){
    $('schBuscaN').textContent = q.trim() ? 'nada' : '';
    if (sel.size) limpaSel();
    pintaListaBusca();
    return;
  }
  busca.idx = ((busca.idx + passo) % n + n) % n;
  const atual = ach[busca.idx];
  if (atual.si !== sheetIdx){
    if (wireDraw) endWire();          /* o fio em curso e da folha que sai (o mesmo do focusComp) */
    sheetIdx = atual.si; pintaCartaoAtivo();
  }
  const daFolha = ach.filter(a => a.si === sheetIdx);
  selSo([].concat(...daFolha.map(a => a.partes)).map(alvoAll));
  aplicaSel('');
  /* enquadra o achado atual (todas as partes dele); digitando, todos os da folha */
  const caixa = (lista) => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const d of lista){ x1 = Math.min(x1, d.x); y1 = Math.min(y1, d.y); x2 = Math.max(x2, d.x); y2 = Math.max(y2, d.y); }
    cam.fit({ x1:x1 - 800, y1:y1 - 800, x2:x2 + 800, y2:y2 + 800 });
  };
  caixa(enquadra || daFolha.length === 1 ? atual.partes : [].concat(...daFolha.map(a => a.partes)));
  $('schBuscaN').textContent = (busca.idx + 1) + ' de ' + n;
  pintaListaBusca();
}
function pintaListaBusca(){
  const box = $('schBuscaLista');
  box.textContent = '';
  const ach = busca.achados, MAX = 8;
  const ini = Math.max(0, Math.min(busca.idx - 3, ach.length - MAX));
  ach.slice(ini, ini + MAX).forEach((a, k) => {
    const i = ini + k;
    const li = document.createElement('div');
    li.className = 'it' + (i === busca.idx ? ' on' : '');
    const r = document.createElement('b'); r.textContent = a.c.ref || '?';
    /* comment com formula do Altium por resolver ("=Value + ...") diz nada: vai o Value */
    const cm = String(a.c.comment || '').trim(), mv = RE_VALUE.exec(String(a.c.params || ''));
    const d = document.createElement('span');
    d.textContent = [cm && cm.charAt(0) !== '=' ? cm : (mv ? mv[1].trim() : ''), a.c.sym].filter(Boolean).join(' · ');
    li.append(r, d);
    if (model.sheets.length > 1){ const f = document.createElement('i'); f.textContent = model.sheets[a.si].name || ''; li.append(f); }
    li.addEventListener('mousedown', e => { e.preventDefault(); busca.idx = i; buscaVai(0, true); });
    box.append(li);
  });
  box.hidden = !ach.length;
}
function abreBusca(){
  const b = $('schBusca'), t = $('schBuscaTxt');
  b.hidden = false;
  try { window.focus(); } catch (e) {}
  t.focus(); t.select();
  if (t.value.trim()) buscaVai(0, false);
}
function fechaBusca(){
  $('schBusca').hidden = true;
  $('schBuscaLista').hidden = true;
  $('schBuscaTxt').blur();
}
$('schBuscaTxt').addEventListener('input', () => { busca.idx = 0; buscaVai(0, false); });
$('schBuscaTxt').addEventListener('keydown', e => {
  if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); fechaBusca(); return; }
  if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    e.preventDefault(); e.stopPropagation();
    buscaVai(e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1, true);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')){ e.preventDefault(); e.target.select(); }
});
$('schBuscaAnt').addEventListener('click', () => buscaVai(-1, true));
$('schBuscaProx').addEventListener('click', () => buscaVai(1, true));
$('schBuscaX').addEventListener('click', fechaBusca);
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
    /* O CARTÃO DIZ O QUE A FOLHA MEDE, e não o que o `size` afirma: o ExportProject chama de
       "A4" toda folha que ele não sabe nomear (A0 inclusive), então o nome do arquivo daria a
       mesma etiqueta para folhas de tamanhos diferentes. O sheetLabel lê a medida. */
    const fmt = HubCore.sheetLabel(sh);
    b.title = `folha ${sh.name} — ${fmt} (size no arquivo: ${sh.size}) — ${(sh.comps || []).length} componente(s)`;
    /* a miniatura e o icone da linha; o nome e o resumo vao ao lado, numa coluna que
       encolhe (o .txt) para o ellipsis do nome ter onde acontecer */
    const txt = el('div', 'txt');
    txt.append(el('span', 'nm', sh.name),
               el('span', 'k', `${fmt} · ${(sh.comps || []).length} comp.`));
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
  /* O FIO EM CURSO E DA FOLHA ANTIGA. O endWire carimba o fio com a folha ATIVA no momento
     de fechar, entao ele e gravado ANTES da troca — como o Esc faz. Deixado para depois, iria
     para a folha nova com os pontos clicados na velha. */
  if (wireDraw) endWire();
  sheetIdx = i;
  pintaCartaoAtivo();
  limpaSel();
  cam.fit(fitBBox());
}
/* Desenha cada cartao. Canvas dentro de painel fechado mede 0 e sairia em branco SEM ERRO
   (a escala vira Infinity) — por isso a guarda do desenhaMiniatura so pinta o cartao que
   mediu. Quem repinta ao abrir a sub-aba e o ResizeObserver do #sheetcards, logo acima: a
   troca para as Configuracoes tira o display:none do painel, o container sai de 0 e o
   observador dispara. */
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
  ctx.fillStyle = mesaCor;                         /* a mesma mesa do canvas grande */
  ctx.fillRect(0, 0, cvm.width, cvm.height);
  const bb = fitBBox(si);
  const esc = Math.min(W / Math.max(bb.x2 - bb.x1, 1), H / Math.max(bb.y2 - bb.y1, 1)) / 1.06;
  const cx = (bb.x1 + bb.x2) / 2, cy = (bb.y1 + bb.y2) / 2;
  /* a matriz Y-up do mkCamera, copiada: o mundo do esquema tem Y para cima */
  ctx.setTransform(DPR * esc, 0, 0, -DPR * esc, DPR * (W / 2 - cx * esc), DPR * (H / 2 + cy * esc));
  desenhaFolha(ctx, si, { grid:false, foco:'', esc });
  return true;
}
/* ------- atalhos -------
   O editor das teclas saiu desta vista para as Configuracoes do hub (aba Atalhos,
   hub-atalhos.js); aqui fica so o mapa que o teclado le. O hub e esta vista (um iframe da
   mesma origem) dividem o localStorage: quando o modal grava, o evento `storage` chega aqui e
   o teclado troca na hora, sem recarregar a folha. `key === null` e o localStorage.clear(). */
let ATALHOS = mapaAtalhos(HA.carrega());
let LEITOR_SCH = null;
function leitorSch(){
  if (!LEITOR_SCH && typeof HA.leitor === 'function')
    LEITOR_SCH = HA.leitor(() => ATALHOS, id => fazAcao(id), { aoEsperar:seq => { const el = $('shover'); if (el) el.textContent = seq ? seq + ', …' : ''; } });
  return LEITOR_SCH;
}
window.addEventListener('storage', e => {
  if (e.key === HA.CHAVE || e.key === null) ATALHOS = mapaAtalhos(HA.carrega());
});
/* ------- os menus do Altium do Esquema -------
   Pedido do dono (2026-10-14): os menus mudam com a vista, como no Altium. A arvore e a
   MNSchematicMenu do advsch.rcs (hub-altiumdna.js), no idioma do hub (hub-menutrad.js); o
   desenho e o teclado sao os do hub-pcbaltium.js. Embutida no hub do desktop, a barra de cima e
   a do topo (hub-menubar.js); aqui ficam as letras que abrem menu no cursor. */
let ALT_SCH = null, ultimoMouseSch = null;
window.addEventListener('mousemove', e => { ultimoMouseSch = { x:e.clientX, y:e.clientY }; }, true);
if (typeof HubPcbAltium !== 'undefined' && typeof HubAltiumDNA !== 'undefined') {
  ALT_SCH = HubPcbAltium.instala({
    vista:'sch', fazAcao:id => fazAcao(id), teclaDe:id => (ATALHOS.porAcao && ATALHOS.porAcao[id]) || '',
    ctx:() => ({ sel:sel.size, lean:false }), grades:() => [],
    toast:(t, tipo, ms) => { if (typeof HubDialog !== 'undefined') HubDialog.toast(t, tipo || 'info', ms); },
  });
  window.__hubMenus = { vista:'sch', itens:() => ALT_SCH.itensBarra(), popup:(l, x, y) => ALT_SCH.popup(l, x, y) };
  try { if (window.parent !== window && window.parent.EletricMenubar) window.parent.EletricMenubar.vistaPronta(window); } catch (e) {}
}
/* ------- o tema -------
   Pelo mesmo `storage`, o hub-tema.js troca o tema do CSS sozinho e avisa com 'hubtema'. O
   que o CSS nao alcanca e o que esta pintado em canvas: a mesa (leMesa, la em cima). */
window.addEventListener('hubtema', () => { leMesa(); cam.draw(); pintaMiniaturas(); });

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

/* ------- a divisoria do painel -------
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
    /* fechado (0) o painel some inteiro; a divisoria fica, para arrastar de volta */
    $(o.el).style.display = larg ? '' : 'none';
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
painelProps = mkPainel({ chave:'schframe.propsW', varCss:'--props-w', el:'props', split:'splitR',
  padrao:320, lado:'r', aoMudar: () => mostraProps() });
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
/* o botao das guias: duas caixas na mesma linha de centro; desligado, o risco dos outros olhos */
function pintaGuias(){
  const b = $('btnGuias');
  if (!b) return;
  const on = showState.guias && !!GUIAS;
  b.classList.toggle('active', on);
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', 'Guias de alinhamento');
  b.title = !GUIAS ? 'Guias de alinhamento indisponíveis: o hub-guias.js não carregou'
          : on ? 'Guias de alinhamento ligadas: ao arrastar, alinha, iguala o espaço e mostra a distância (Ctrl solta a guia, Shift anda reto no trilho dela) — clique para desligar'
               : 'Guias de alinhamento desligadas: o arrasto usa só a grade e o ímã do pino — clique para ligar';
  b.innerHTML = '<svg viewBox="0 0 16 16"><rect x="1.5" y="5" width="4" height="6" rx="0.6"/>'
              + '<rect x="10.5" y="3.5" width="4" height="9" rx="0.6"/><path d="M0.5 8h15" stroke-dasharray="1.4 1.4"/>'
              + (on ? '' : '<path d="' + OLHO_X + '"/>') + '</svg>';
}
$('btnGuias').addEventListener('click', () => {
  if (!GUIAS) return;
  showState.guias = !showState.guias;
  try { localStorage.setItem(VER_GUIAS_KEY, showState.guias ? '1' : '0'); } catch (e) {}
  pintaGuias();
  HubDialog.toast(showState.guias ? 'guias de alinhamento ligadas' : 'guias de alinhamento desligadas', 'info', 2200);
});
pintaGuias();
$('btnGrid').addEventListener('click', () => {
  showState.grid = !showState.grid; $('btnGrid').classList.toggle('active', showState.grid); cam.draw();
});
montaGrade();
renderSheetCards();
if (RENOMEADOS_ODOO.length){ schDirty = true; avisaRenomeados(RENOMEADOS_ODOO); }
updateMeta(); updateSaveBtn(); updateSelStatus(); cartRender(); renderProps();
cam.resize(); cam.fit(fitBBox());

})();
