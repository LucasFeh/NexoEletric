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
  if (quantos > 1){
    d.impacto = 'a escolha vale para todos os projetos; só neste, ' + quantos
              + ' componentes da folha usam este mesmo componente e mudam junto';
    d.impactoAlerta = true;
  } else if (quantos === 1){
    d.impacto = 'a escolha vale para todos os projetos; neste, só este componente da folha usa essa entrada da biblioteca';
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

const PURE = { LIBS, ACERVO_DEFS, montaAcervos, carimbo, decideTroca, montaPartsTrocando };
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
const showState = { grid:true, comment:false, pinos:true };
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

/* ------- selecao -------
   `sel` guarda os proprios objetos de schematic.items (comp, wire, netlabel, power,
   junction, text): e por identidade que o desenho, o arrasto e o Delete sabem quem esta
   marcado. O buildSchModel nao copia os itens, so os agrupa por folha, entao a identidade
   sobrevive ao reapply — mas nao ao undo, que reconstroi tudo do JSON (restoreItems limpa). */
const sel = new Set();
const SEL = '#2979ff';   /* azul da selecao — so no contorno tracejado, nunca no objeto */
let schDirty = false, schDiskSnapshot = null;
const undoStack = [JSON.stringify(schematic.items)], redoStack = [];
function snap100(v){ return Math.round(v / 100) * 100; }
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
  for (const it of Array.from(sel)) if (schematic.items.indexOf(it) < 0) sel.delete(it);
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
/* posicao de partida de cada item selecionado: o arrasto e sempre "base + delta", nunca
   acumulado, para o snap de 100 mil nao andar sozinho */
function baseOf(items){
  const m = new Map();
  for (const it of items) m.set(it, it.t === 'wire' ? (it.pts || []).map(p => [p[0], p[1]]) : { x:it.x, y:it.y });
  return m;
}
function applyMove(base, dx, dy){
  for (const [it, b] of base){
    if (it.t === 'wire') it.pts = b.map(p => [p[0] + dx, p[1] + dy]);
    else { it.x = b.x + dx; it.y = b.y + dy; }
  }
}
function describe(it){
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
function selectOnly(items){ sel.clear(); for (const it of items) sel.add(it); aplicaSel(''); }
function rotateSel(){
  const comps = Array.from(sel).filter(it => it.t === 'comp');
  if (!comps.length) return;
  for (const c of comps) c.rot = (((c.rot || 0) + 90) % 360);
  if (mouse && mouse.mode === 'move') cam.draw(); else commit();
}
function mirrorSel(){
  const comps = Array.from(sel).filter(it => it.t === 'comp');
  if (!comps.length) return;
  for (const c of comps){ if (c.mirror) delete c.mirror; else c.mirror = true; }
  if (mouse && mouse.mode === 'move') cam.draw(); else commit();
}
function deleteSel(){
  if (!sel.size) return;
  for (const it of sel){ const i = schematic.items.indexOf(it); if (i >= 0) schematic.items.splice(i, 1); }
  sel.clear();
  selNet = '';        /* os fios da net podem ter ido junto; o reapply do commit revalida */
  commit();
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
   perto — ponta quente de pino primeiro, depois vertice de fio, junção e power. 60 mil e
   meia grade: perto o bastante para nao roubar o clique de quem quer o ponto livre. */
const SNAP_MIL = 60;
function snapPoint(w){
  const s = model.sheets[sheetIdx];
  let best = null;
  /* `html` so aparece onde ha o que barrar: e o mesmo rotulo, com o <span> da sobrelinha.
     Quem mostra escolhe — a barra de status pinta o html, o resto continua em texto. */
  const tenta = (x, y, kind, label, peso, html) => {
    const d = Math.hypot(w.x - x, w.y - y);
    if (d > SNAP_MIL) return;
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
   SNAP_MIL de um ponto de conexao PARADO, o deslocamento inteiro e corrigido para ela cair
   exatamente em cima, e o ima manda sobre a grade ao soltar.
   Alvo nunca e o que viaja junto, senao o componente grudaria nele mesmo.
   Aqui o criterio e a distancia pura, e nao o peso por tipo do snapPoint: quem arrasta esta
   mirando um ponto, e o mais perto do pino e o ponto que ele esta mirando. */
function alvosDeIma(base){
  const s = model.sheets[sheetIdx], fora = [];
  for (const c of s.comps){
    if (base.has(c)) continue;
    for (const p of (HubCore.compPinsWorld(c, SLIB) || [])) fora.push({ x:p.x, y:p.y, label:c.ref + '-' + p.num });
  }
  for (const wi of s.wires){
    if (base.has(wi)) continue;
    for (const p of (wi.pts || [])) fora.push({ x:p[0], y:p[1], label:'fio' });
  }
  for (const j of s.junctions) if (!base.has(j)) fora.push({ x:j.x, y:j.y, label:'junção' });
  for (const p of s.powers)    if (!base.has(p)) fora.push({ x:p.x, y:p.y, label:p.net || 'power' });
  for (const p of s.ports)     if (!base.has(p)) fora.push({ x:p.x, y:p.y, label:p.net || 'port' });
  return fora;
}
/* pontas quentes do que esta sendo arrastado, na posicao de PARTIDA: o arrasto so lhes soma o
   deslocamento, entao medir uma vez por gesto basta — e nao a folha inteira a cada quadro */
function pinosDoArrasto(base){
  const fora = [];
  for (const it of base.keys()){
    if (it.t !== 'comp') continue;
    for (const p of (HubCore.compPinsWorld(it, SLIB) || [])) fora.push({ x:p.x, y:p.y, num:p.num, ref:it.ref });
  }
  return fora;
}
/* o deslocamento corrigido para o pino mais proximo pousar em cima do alvo; null = sem ima */
function imaDoArrasto(g, dx, dy){
  if (!g || !g.pinos.length || !g.alvos.length) return null;
  let best = null;
  for (const p of g.pinos){
    const px = p.x + dx, py = p.y + dy;
    for (const a of g.alvos){
      const d = Math.hypot(px - a.x, py - a.y);
      if (d > SNAP_MIL || (best && d >= best.d)) continue;
      best = { d, dx: dx + (a.x - px), dy: dy + (a.y - py), x:a.x, y:a.y,
               label: p.ref + '-' + p.num + ' → ' + a.label };
    }
  }
  return best;
}
/* proximo ponto do fio: o ima ganha; sem ima, grade de 100 mil e traçado ortogonal */
function wirePoint(w){
  const hs = snapPoint(w);
  if (hs) return { pt:[hs.x, hs.y], snap:hs };
  const gx = snap100(w.x), gy = snap100(w.y);
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
                         x: hs ? hs.x : snap100(w.x), y: hs ? hs.y : snap100(w.y) });
  commit();
}
function placePower(w){
  const hs = snapPoint(w);
  const p = toolPower;
  schematic.items.push({ t:'power', sheet:model.sheets[sheetIdx].name, net:p.net, style:p.style,
                         x: hs ? hs.x : snap100(w.x), y: hs ? hs.y : snap100(w.y), rot:p.rot });
  commit();
}
/* O rotulo de net: uma palavra pousada na folha. Quem une dois rotulos de mesmo nome e o
   extractNets (fusao por nome), nao esta funcao — aqui e so pousar. */
function placeLabel(w){
  if (!toolNet) return;
  const hs = snapPoint(w);
  schematic.items.push({ t:'netlabel', sheet:model.sheets[sheetIdx].name, net:toolNet,
                         x: hs ? hs.x : snap100(w.x), y: hs ? hs.y : snap100(w.y), rot:0 });
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
  const it = h.item, wasSel = sel.has(it);
  if (!wasSel){ if (!e.shiftKey) sel.clear(); sel.add(it); }
  lastDown = { item:it, wasSel };
  const base = baseOf(sel);
  /* o ima e montado aqui, e nao no primeiro movimento: a folha parada e a mesma o gesto
     inteiro, e varrer os pinos de 200 componentes a cada quadro engasgaria o arrasto */
  mouse = { mode:'move', start:w, moved:false, base,
            ima: { alvos: alvosDeIma(base), pinos: pinosDoArrasto(base) } };
  moveIma = null;
  /* a net entra em foco AQUI, e nao no click: todo arrasto engole o click (swallowClick), e
     a net anterior ficava acesa por cima de uma selecao que ja era outra */
  aplicaSel(e.shiftKey && sel.size > 1 ? '' : netDoAlvo(h));
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
    if (m) applyMove(d.base, m.dx, m.dy); else applyMove(d.base, snap100(rx), snap100(ry));
    moveIma = null; $('shover').textContent = '';
    /* arrasto que voltou para a mesma grade nao e mudanca — nao entra no undo */
    const mudou = Array.from(d.base).some(([it, b]) => it.t === 'wire'
      ? (it.pts[0] && (it.pts[0][0] !== b[0][0] || it.pts[0][1] !== b[0][1]))
      : (it.x !== b.x || it.y !== b.y));
    if (mudou) commit(); else cam.draw();
    return;
  }
  if (d.mode === 'box' && d.moved && boxRect){
    const r = boxRect; boxRect = null;
    const n = { x1:Math.min(r.x1, r.x2), y1:Math.min(r.y1, r.y2), x2:Math.max(r.x1, r.x2), y2:Math.max(r.y1, r.y2) };
    /* esquerda→direita pega so quem cabe inteiro; direita→esquerda pega quem encosta (como no Altium) */
    const inteiro = r.x2 >= r.x1;
    if (!d.shift) sel.clear();
    for (const it of sheetItems()){ const bb = itemBBox(it); if (inteiro ? bbInside(bb, n) : bbTouch(bb, n)) sel.add(it); }
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
    sel.delete(lastDown.item);
    aplicaSel('');            /* saiu da selecao: a net dele sai junto */
  }
}
/* duplo clique com o fio na mao encerra o traçado (o Altium faz igual); no resto, nada:
   a ficha da direita e so de leitura, e quem edita propriedade e a IA no schematic.js */
cv.addEventListener('dblclick', () => { if (wireDraw) endWire(); });

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
    y0 = snap100(minY - 900);
  }
  const PASSO_X = 700, PASSO_Y = 800, LARGURA = 9;
  let i = 0; const novos = [];
  for (const item of cart){
    for (let k = 0; k < item.qtd; k++){
      const c = {
        t: 'comp', sheet: folha.name, ref: nextRef(item.sym), sym: item.sym,
        x: snap100(x0 + (i % LARGURA) * PASSO_X),
        y: snap100(y0 - Math.floor(i / LARGURA) * PASSO_Y),
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
  sel.clear(); for (const c of novos) sel.add(c);
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
function prPreview(sym, part, fpNome){
  prSym = part || null;
  fitPreview(camPrSym, part ? D.symBBox(part) : null);
  $('prSymHint').textContent = part ? '' : (sym === false ? '' : 'sem geometria na biblioteca');
  const fp = fpNome ? HubCore.footprintOf(PLIB, fpNome) : null;
  prFp = fp || null;
  fitPreview(camPrFp, fp && fp.bbox ? fp.bbox : null);
  $('prFpHint').textContent = fp ? ''
    : fpNome ? '"' + fpNome + '" não está na PcbLib espelhada' : (sym === false ? '' : 'sem footprint');
  requestAnimationFrame(refitProps);
}
function renderProps(){
  const body = $('prBody');
  body.textContent = '';
  const itens = Array.from(sel).filter(onSheet);
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

  const it = itens[0];
  if (it.t !== 'comp'){
    const NOME = { wire:'fio', netlabel:'net label', power:'power port', port:'port',
                   junction:'junção', noerc:'No ERC', text:'texto' };
    const s = prSec(NOME[it.t] || it.t);
    if (it.t === 'wire'){
      const wi = model.sheets[sheetIdx].wires.indexOf(it);
      s.append(el('div', 'pr-title', (wi >= 0 && nets.wireNet[sheetIdx][wi]) || 'sem net'));
      prKv(s, 'Vértices', (it.pts || []).length);
      const p0 = (it.pts || [])[0] || [0, 0], pn = (it.pts || [])[(it.pts || []).length - 1] || [0, 0];
      prKv(s, 'Início', p0[0] + ' , ' + p0[1] + ' mil', 'mono');
      prKv(s, 'Fim', pn[0] + ' , ' + pn[1] + ' mil', 'mono');
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
  const fpNome = it.footprint || '';

  const g = prSec('geral');
  g.append(el('div', 'pr-title', it.ref));
  if (it.comment) g.append(el('div', 'pr-sub', it.comment));
  prKv(g, 'Comment', it.comment, it.comment ? null : 'dim');
  prKv(g, 'Parte', nparts > 1 ? (it.part || 1) + ' de ' + nparts : '1 de 1');
  prKv(g, 'Descrição', sym && sym.description, sym && sym.description ? null : 'dim');
  prKv(g, 'Designador', sym && sym.designator, sym && sym.designator ? null : 'dim');
  prKv(g, 'Componente', it.sym, 'mono');
  /* o resolvedor pode ter entregue outro simbolo (apelido/substituto): dizer qual, senao a
     ficha afirma um nome e o desenho mostra outro */
  if (sym && sym.name !== it.sym) prKv(g, 'Resolvido em', sym.name, 'mono');
  const dec = decideTroca({ sym: sym && sym.name, how: rsym && rsym.how, quantos: contaSym(it.sym) });
  /* a linha que faltava: escolha sua fica em amarelo, ao lado do nome que ela impos */
  if (dec.motivo) prKv(g, 'Por quê', dec.motivo, dec.porEscolha ? 'warn' : 'dim');
  prKv(g, 'Acervo', ac ? ac.titulo : (sym ? '—' : 'ausente na biblioteca'), ac ? null : 'warn');
  /* o desenho emprestado precisa se ANUNCIAR: o corpo ambar na folha diz que algo e
     diferente, e e aqui que se le O QUE. Sem esta linha o usuario veria um simbolo
     plausivel e concluiria que a biblioteca tem a peca — que e o oposto da verdade. */
  if (!sym){
    const emg = desenhoDeEmergencia(it);
    prKv(g, 'Desenho', emg ? 'emprestado de "' + emg.nome + '" (Biblioteca de símbolos, por ' + emg.how + ') — só para ver'
                           : 'nenhum: a folha mostra o quadrado vermelho', 'warn');
  }
  /* O botao existe com simbolo resolvido OU NAO. Enquanto ele so aparecia com o simbolo
     ausente, uma escolha errada era definitiva pela interface: assim que ela resolvia o
     nome, nao havia mais caminho nenhum na tela para trocar. */
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
  prKv(g, 'Footprint', fpNome, fpNome ? 'mono' : 'warn');
  if (fpNome && !HubCore.footprintOf(PLIB, fpNome)) prKv(g, '', 'não está na PcbLib espelhada', 'warn');
  body.append(g);

  const p = prSec('posição');
  prKv(p, 'X', it.x + ' mil', 'mono');
  prKv(p, 'Y', it.y + ' mil', 'mono');
  prKv(p, 'Rotação', ((((it.rot || 0) % 360) + 360) % 360) + '°');
  prKv(p, 'Espelhado', it.mirror ? 'sim' : 'não');
  prKv(p, 'Folha', it.sheet);
  body.append(p);

  const pars = prParams(it.params);
  if (pars.length){
    const s = prSec('parâmetros');
    for (const [k, v] of pars) prKv(s, k, v);
    body.append(s);
  }

  const pins = HubCore.compPinsWorld(it, SLIB) || [];
  const s = prSec('pinos (' + pins.length + ')');
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
  body.append(s);

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
function desenhaFolha(ctx, si, o){
  const s = model.sheets[si];
  const foco = o.foco, esc = o.esc;
  const bb = sheetBBox(si);
  ctx.fillStyle = D.SCH.sheet;
  ctx.fillRect(bb.x1, bb.y1, bb.x2-bb.x1, bb.y2-bb.y1);
  if (o.grid && esc > 0.045) {
    ctx.strokeStyle = D.SCH.grid; ctx.lineWidth = 1/esc;
    ctx.beginPath();
    for (let x = 0; x <= bb.x2; x += 100) { ctx.moveTo(x, 0); ctx.lineTo(x, bb.y2); }
    for (let y = 0; y <= bb.y2; y += 100) { ctx.moveTo(0, y); ctx.lineTo(bb.x2, y); }
    ctx.stroke();
  }
  ctx.strokeStyle = D.SCH.border; ctx.lineWidth = 8;
  ctx.strokeRect(bb.x1, bb.y1, bb.x2-bb.x1, bb.y2-bb.y1);

  /* A COR E A IDENTIDADE ELETRICA, NAO A SELECAO.
     Um fio sai laranja quando pertence a net em foco e azul-escuro quando nao — e so. Quem
     esta selecionado ganha o contorno tracejado do drawSelection, por cima, como na vista
     PCB e como no Altium. Enquanto a selecao RECOLORIA, clicar num fio deixava o fio azul e
     os companheiros de net laranja: uma net com duas cores, que se lia como cor travada. */
  s.wires.forEach((w, wi) => {
    const hl = foco && nets.wireNet[si][wi] === foco;
    ctx.strokeStyle = hl ? D.SCH.hl : D.SCH.wire;
    ctx.lineWidth = hl ? 14 : 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    (w.pts || []).forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.stroke();
  });
  /* junctions explicitas + automaticas: sao pontos DA net, entao acendem com ela */
  for (const j of s.junctions)
    D.drawJunction(ctx, j.x, j.y, foco && netEm(j.x, j.y) === foco ? D.SCH.hl : undefined);
  for (const j of nets.autoJunctions) if (j.sheet === si)
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
    const bbref = part ? D.symBBox(part) : emg ? D.symBBox(emg.part) : { x1:-100, y1:-100, x2:100, y2:100 };
    D.worldText(ctx, c.ref, c.x, c.y + Math.max(Math.abs(bbref.y1), Math.abs(bbref.y2)) + 70, 60, 0, '#000000', 'center');
    if (c.comment && showState.comment)
      D.worldText(ctx, c.comment, c.x, c.y - Math.max(Math.abs(bbref.y1), Math.abs(bbref.y2)) - 70, 55, 0, '#333366', 'center');
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
    const x = snapHit ? snapHit.x : snap100(hoverW.x), y = snapHit ? snapHit.y : snap100(hoverW.y);
    ctx.save(); ctx.globalAlpha = 0.6;
    D.drawPowerPort(ctx, { x, y, net:toolPower.net, style:toolPower.style, rot:toolPower.rot });
    ctx.restore();
  }
  if (tool === 'label' && toolNet && hoverW){
    const x = snapHit ? snapHit.x : snap100(hoverW.x), y = snapHit ? snapHit.y : snap100(hoverW.y);
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
  for (const it of sel){
    if (!onSheet(it)) continue;
    const bb = itemBBox(it);
    const x = bb.x1 - m, y = bb.y1 - m, w = (bb.x2 - bb.x1) + 2*m, h = (bb.y2 - bb.y1) + 2*m;
    ctx.strokeStyle = SEL; ctx.lineWidth = 1.5 * px; ctx.setLineDash([6 * px, 4 * px]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = SEL;
    for (const [cx, cy] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) ctx.fillRect(cx - hs, cy - hs, 2*hs, 2*hs);
    if (it.t === 'wire') for (const p of (it.pts || [])) ctx.fillRect(p[0] - hs, p[1] - hs, 2*hs, 2*hs);
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
    $('shover').textContent =
      h ? (h.kind === 'pin' ? `${h.ref}-${h.num} · ${nets.pinNet[h.ref + '-' + h.num] || 'sem net'}`
                            : h.kind === 'wire' ? (nets.wireNet[sheetIdx][h.wi] || 'fio') : describe(h.item)) : '';
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
  for (let wi = 0; wi < s.wires.length; wi++) {
    const pts = s.wires[wi].pts || [];
    for (let i = 0; i < pts.length - 1; i++)
      if (HubCore.distSeg(x, y, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]) <= Math.max(tol, 20))
        return { kind:'wire', wi, item:s.wires[wi] };
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
  $('symNome').textContent = comp.sym || '';
  $('symNome').title = comp.sym ? 'clique para copiar "' + comp.sym + '"' : '';
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
  if (symOpts && symOpts.vinculo){
    const refs = (symOpts.refs && symOpts.refs.length) ? symOpts.refs : [symAlvo.ref];
    const res = window.__hubAplicaVinculos([{ refs: refs, componente: para }]);
    if (!res || !res.ok){
      await HubDialog.alert((res && res.erro) || 'não deu para aplicar o vínculo.',
                            { title: 'não apliquei' });
      return;
    }
    const aoAplicar = symOpts.aoAplicar;
    fechaSymModal();
    /* dizer QUAL das duas coisas aconteceu: multi-parte recebe so a identidade, e prometer
       troca de simbolo que nao houve e o comeco de "mas eu troquei e nao mudou nada" */
    const so = (res.soIdentidade || []).length > 0;
    HubDialog.toast(refs.join(', ') + (so
      ? ' recebeu a identidade de "' + para + '" — o desenho fica, porque é multi-parte.'
      : ' → "' + para + '"') + ' Ctrl+Z desfaz, e só o Salvar grava.', 'ok');
    for (const rc of (res.recusados || [])) HubDialog.toast('recusado: ' + rc.porque, 'warn', 9000);
    if (typeof aoAplicar === 'function') aoAplicar({ refs: refs, componente: para, res: res });
    return;
  }
  if (!HubIO.canPost){
    await HubDialog.alert('Sem servidor: abra o hub por hubserver.py para gravar a escolha.',
                          { title: 'não dá para gravar' });
    return;
  }
  /* PERGUNTA ANTES DE GRAVAR QUALQUER COISA: o primeiro arquivo escrito em Libs derruba
     a pagina pelo __hubOnChange, e uma pergunta aberta morreria sem resposta. */
  const atribuir = emg ? await perguntaAtribuir(emg, para) : false;
  const REL = 'Libs/lib-subs.js';
  let atuais = [];
  try {
    const txt = await HubIO.fetchText(REL);
    atuais = new Function(txt + ';return typeof libSubs !== "undefined" ? libSubs : [];')() || [];
  } catch (e) {
    atuais = (typeof libSubs !== 'undefined' && Array.isArray(libSubs)) ? libSubs.slice() : [];
  }
  const antes = atuais.find(r => r && r.kind !== 'fp' && r.from === de);
  if (antes && !(await HubDialog.confirm(
        '"' + de + '" já aponta para "' + antes.to + '". Trocar por "' + para + '"?',
        { title: 'já existe uma escolha', ok: 'Trocar' }))) return;

  const nova = atuais.filter(r => !(r && r.kind !== 'fp' && r.from === de));
  nova.push({ kind: 'sym', from: de, to: para, when: nowStr() });
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
  const quantos = model.sheets.reduce((k, sh) => k + sh.comps.filter(c => c.sym === de).length, 0);
  fechaSymModal();
  reapply();
  HubDialog.toast('"' + de + '" agora usa "' + para + '"'
                  + (quantos > 1 ? ' — ' + quantos + ' componentes' : ''), 'ok');
  /* a escolha ja vale; agora, se foi pedido la em cima, o desenho vai para a BIBLIOTECA */
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
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 'z'){ e.preventDefault(); undo(); return; }
  if (e.ctrlKey && k === 'y'){ e.preventDefault(); redo(); return; }
  if (e.ctrlKey && k === 'a'){ e.preventDefault(); selectOnly(sheetItems()); return; }
  /* Ctrl+W e do NAVEGADOR (fecha a aba) e nenhuma pagina consegue interceptar — o atalho do
     fio e o W sozinho. Isto aqui so pega onde o Ctrl+W chega mesmo (janela de aplicativo). */
  if (e.ctrlKey && k === 'w'){ e.preventDefault(); setTool(tool === 'wire' ? 'select' : 'wire'); return; }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (k === 'c'){ openAdd(); return; }
  if (k === 'w'){ setTool(tool === 'wire' ? 'select' : 'wire'); return; }
  if (k === 'g'){ setTool(tool === 'power' && toolPower && toolPower.net === 'GND' ? 'select' : 'power',
                          { net:'GND', style:'GndPower', rot:270 }); return; }
  if (k === 'l'){ if (tool === 'label'){ setTool('select'); hideNetForm(); } else openNetForm(); return; }
  /* O ESPACO COM UM BOTAO EM FOCO ja se resolve sozinho, e MEDIDO no Chrome: com selecao, o
     `e.preventDefault()` da linha de girar cancela a ativacao nativa do botao (o componente
     gira 0->90 e o olho da grade nao pisca); sem selecao aquela linha nao pega e o Espaco
     volta a ser o clique do botao, que e o que se espera. Houve aqui uma guarda que devolvia
     cedo quando o foco estava num <button> — ela trocava uma coisa pela outra: o botao era
     reacionado e a selecao NAO girava. */
  if (e.key === 'Delete'){ deleteSel(); return; }
  if (e.key === ' ' && sel.size){ e.preventDefault(); rotateSel(); return; }
  if (k === 'x' && sel.size){ mirrorSel(); return; }
});
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
  const refsTocados = [];
  for (const p of planos)
    for (const ref of p.refs){
      for (const c of porRef.get(ref)){
        if (p.sym) c.sym = p.sym;
        if (p.comment) c.comment = p.comment; else delete c.comment;
        if (p.params) c.params = p.params; else delete c.params;
        itens++;
      }
      refsTocados.push(ref);
    }
  commit();
  limpaSel();
  return { ok:true, vinculos:planos.length, refs:refsTocados, itens, recusados,
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
  sel.clear(); sel.add(c);
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
    if (sel.has(c)) tr.className = 'sel';
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
function showPane(id){
  document.querySelectorAll('#side .subtab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pane === id)));
  $('pane-comps').classList.toggle('on', id === 'comps');
  $('pane-cfg').classList.toggle('on', id === 'cfg');
  try { localStorage.setItem('schframe.pane', id); } catch (e) {}
}
document.querySelectorAll('#side .subtab').forEach(b => b.addEventListener('click', () => showPane(b.dataset.pane)));
let pane0 = 'comps';
try { pane0 = localStorage.getItem('schframe.pane') || 'comps'; } catch (e) {}
showPane(pane0 === 'cfg' ? 'cfg' : 'comps');

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
renderSheetCards(); buildCompTable(); buildNetList(); buildValList();
updateMeta(); updateSaveBtn(); updateSelStatus(); cartRender(); renderProps();
cam.resize(); cam.fit(fitBBox());

})();
