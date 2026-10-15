/* AltiumPCBMirror v2 - hub-libview.js — as 4 vistas da aba Biblioteca.
 *
 *   GERAL        o que a aba sempre mostrou: o símbolo em cima, o footprint embaixo.
 *   COMPONENTES  o editor de símbolos no modo componente, dirigido pela MESMA busca da Geral
 *                e da Footprints. Até 2026-10-09 esta vista se chamava Símbolos.
 *   FOOTPRINTS   a lista de footprints, para vincular UM a um componente.
 *   SÍMBOLOS     o MESMO editor, no modo símbolo: só para criar e editar os símbolos da
 *                biblioteca de símbolos (Libs/symbols-lib.js), com a lista deles à esquerda.
 *
 * COMPONENTES E SÍMBOLOS SÃO UM EDITOR SÓ (pedido do dono, 2026-10-09: "a aba Símbolos serve
 * única e exclusivamente para editar símbolos"). O HubSymEd é singleton, então as duas abas
 * são MODOS dele (HubSymEd.modo), e trocar de uma para a outra com edição não salva pergunta
 * antes — quem decide é o editor, que é quem sabe se há o que perder.
 *
 * A REGRA QUE DEU ORIGEM A ISTO (pedido do dono, 2026-09-17): todo componente da biblioteca
 * tem EXATAMENTE UM footprint vinculado. Ela é garantida no servidor
 * (tools/symbols/symserver.py » /api/symbols/footprint), e não aqui: tela é sugestão,
 * servidor é garantia. Esta vista existe para tornar o vínculo fácil de fazer, não para ser
 * o lugar onde a regra mora.
 *
 * POR QUE UM ARQUIVO PRÓPRIO, e não mais 600 linhas no `hub.html`: a casca é do
 * `agente/page` e o CLAUDE.md pede que código novo de painel viva no seu próprio
 * `hub-<subsistema>.js`, pedindo à casca só um `<script src>`, um container e o hook. É o
 * mesmo contrato do `hub-chat.js` e do `hub-almoxpick.js`.
 *
 * O QUE A CASCA PRECISA ENTREGAR (veja `instala` no fim): os dois elementos (o aside da
 * direita e a área central), quem está selecionado, como achar um símbolo pelo nome e como
 * mandar redesenhar. Nada mais — em particular, este módulo NÃO conhece o `S` da casca.
 *
 * A BUSCA NÃO É DAQUI. Ela continua sendo a da esquerda, do `hub.html`, exatamente como
 * antes — foi pedido explícito ("a busca pelos componentes continua exatamente como é
 * hoje"). Trocar de sub-aba muda só o CENTRO; a lista da esquerda e o que está selecionado
 * nela atravessam a troca. A exceção é a vista Símbolos: a lista da casca é de COMPONENTES,
 * e ali o que se escolhe é um símbolo — ela some (com a coluna dela) e o editor mostra a
 * lista própria, a da biblioteca de símbolos.
 */
"use strict";
var HubLibView = (function () {

const CSS = `
/* A faixa mora no TOPO DO CENTRO (a janela do meio), que é onde a vista troca. Ela é a
   primeira linha da grade do .lib-view — por isso o hub.html abriu um "auto" a mais ali. */
.lv-tabs{display:flex; gap:2px; padding:6px 12px 0; border-bottom:1px solid var(--line,#3a3a3a);}
.lv-tabs button{border:0; background:transparent; color:var(--text-3,#9a9a9a);
  font:12px 'Segoe UI',sans-serif; padding:7px 14px; cursor:pointer;
  border-bottom:2px solid transparent; margin-bottom:-1px;}
.lv-tabs button:hover{background:rgba(255,255,255,.05); color:var(--text,#d8d8d8);}
.lv-tabs button[aria-pressed="true"]{color:var(--hi,#4fc3f7); border-bottom-color:var(--hi,#4fc3f7);}
/* o aviso de produto repetido: no fim da faixa, no tom de aviso, e so quando ha */
.lv-tabs .lv-avisos{margin-left:auto; display:flex; gap:2px;}
.lv-tabs button.lv-dup{color:var(--warn,#ffb74d); border-bottom-color:transparent;}
.lv-tabs button.lv-dup:hover{color:var(--warn,#ffb74d); background:rgba(255,183,77,.08);}
.lv-tabs button.lv-fora{border-bottom-color:transparent;}
.lv-tabs button.lv-fora:hover{color:var(--err,#ff6b6b); background:rgba(255,107,107,.08);}
.lv-dup-dlg{width:min(820px,100%);}
.lv-dup-dlg p{font-size:12px; line-height:1.5; color:var(--text-2,#b8b8b8);}
.lv-dup-lista{max-height:min(52vh,460px); overflow:auto; border:1px solid var(--line,#3a3a3a);
  border-radius:6px; font:11px Consolas,ui-monospace,monospace;}
.lv-dup-g{display:flex; gap:10px; padding:3px 10px; border-bottom:1px solid rgba(255,255,255,.04);}
.lv-dup-g .id{flex:0 0 52px; color:var(--text-4,#7a7a7a); text-align:right;}
.lv-dup-g .vs{min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.lv-dup-g .vivo{color:var(--text,#d8d8d8);}
.lv-dup-g .fora{color:var(--warn,#ffb74d);}
.lv-dup-g .sep{color:var(--text-4,#7a7a7a);}
.lv-dup-mais{padding:6px 10px; color:var(--text-4,#7a7a7a);}
.lv-dup-dlg .lv-dup-nota{font-size:11px; color:var(--text-4,#7a7a7a);}

/* A FAIXA NO TOPO DA GRADE INTEIRA (pintaAbas): uma linha a mais na .lib-grid, a faixa cobrindo
   as colunas, e o centro perde a linha que era dela */
.lib-grid.lv-faixa-cima{grid-template-rows:auto minmax(0,1fr);}
.lib-grid.lv-faixa-cima > .lv-tabs{grid-column:1 / -1;}
.lib-grid.lv-faixa-cima > .lib-view{grid-template-rows:auto minmax(0,1fr) auto minmax(0,1fr) minmax(0,0.85fr);}
.lib-grid.lv-faixa-cima > .lib-view.lv-outra{grid-template-rows:minmax(0,1fr);}
/* a busca da esquerda como a da vista Símbolos: o campo primeiro, o segmentado desce de linha */
.lib-grid > .lib-left .lib-bar{flex-wrap:wrap; row-gap:6px;}
.lib-grid > .lib-left .lib-bar .input{flex:1 1 140px;}
/* Fora da vista Geral o centro deixa de ser a grade de quatro painéis e vira faixa + corpo:
   senão as linhas vazias da grade continuariam reservando altura para canvas escondido. */
.lib-view.lv-outra{grid-template-rows:auto minmax(0,1fr);}
/* FORA DA GERAL, SÓ A VISTA DA VEZ — declarativo, e não a disputa de hidden que eu vinha
   perdendo. O hub.html tem vários donos do hidden dessas peças (libPainelDeBaixo, os ~16
   chamadores de renderLib, e o próprio redesenha que este módulo dispara ao vincular), e
   cada um deles reexibia a caixa de valores por cima da vista Componentes. Com a regra na
   CLASSE que este módulo controla, todos os caminhos fecham de uma vez — inclusive os que
   alguém escrever amanhã. O laço de aplicaVisibilidade fica como cinto e suspensório. */
.lib-view.lv-outra > :not(.lv-tabs):not(#symed):not(#lvFootprints){display:none !important;}
.lib-view.lv-outra > #lvFootprints{height:100%; min-height:0;}
/* AS MESMAS COLUNAS EM TODAS AS VISTAS: a lista da esquerda e o painel da direita com a largura
   dos da vista Símbolos (o --aside-w do hub), o meio com o resto. Depois das regras de ficha e
   de lista de propósito: com a mesma força, ganha a última. */
.lib-grid.lv-faixa-cima{grid-template-columns:var(--symed-l, var(--aside-w)) minmax(0,1fr) var(--symed-r, var(--aside-w));}
.lib-grid.lv-faixa-cima.lv-sem-ficha{grid-template-columns:var(--symed-l, var(--aside-w)) minmax(0,1fr);}
.lib-grid.lv-faixa-cima.lv-sem-lista{grid-template-columns:minmax(0,1fr);}
.lib-grid.lv-faixa-cima > *{min-width:0;}
.lib-grid.lv-faixa-cima > .lib-left{overflow:hidden; box-shadow:inset -1px 0 0 var(--line);}
.lib-grid.lv-faixa-cima > .lib-view{padding-left:6px;}
.lib-grid > .lib-left .lib-bar .seg{flex-wrap:wrap; max-width:100%;}
/* o footprint é desenhado em fundo escuro, como na vista Geral — ver desenhaTile */
.lv-fp .symed-tile canvas{background:var(--sunken,#14161a);}

/* A FICHA DA DIREITA SÓ EXISTE NA VISTA GERAL. Em Componentes e Símbolos o editor já tem o
   painel dele (e os dois mostravam componentes DIFERENTES, porque o editor abre o seu e a
   ficha segue a seleção da lista); em Footprints o cabeçalho "vincular a X" já diz o alvo.
   Esconder o aside não basta: a coluna dele é uma faixa fixa do grid e continuaria
   reservada, deixando um buraco — por isso a grade perde a terceira coluna junto. */
.lib-grid.lv-sem-ficha{grid-template-columns:minmax(300px,0.95fr) minmax(320px,1.25fr);}
#libDetail[hidden]{display:none !important;}
/* NA VISTA SÍMBOLOS A LISTA DA CASCA SAI, com a coluna dela, pelo mesmo motivo da ficha: a
   lista de símbolos é a do editor, que ocupa a grade inteira. Depois da regra de cima de
   propósito: as duas valem juntas fora da Geral, e com a mesma força ganha a última. */
.lib-grid.lv-sem-lista{grid-template-columns:minmax(0,1fr);}
.lib-grid.lv-sem-lista > .lib-left{display:none !important;}

/* UMA BUSCA SÓ. Na vista Componentes o editor perde a coluna de busca dele: a lista da
   esquerda serve Geral, Componentes e Footprints, e duas caixas "Buscar símbolo" na mesma
   tela era justamente o que o dono mandou tirar. A coluna e a divisória somem juntas, e os
   trilhos 1 e 2 fecham em zero — o .symed-grid prende cada filho ao seu grid-column, então
   deixar a faixa aberta deixaria um vão.
   No modo símbolos (a vista Símbolos) a coluna volta: é nela que mora a lista de símbolos. */
.lib-view #symed:not(.symed-modo-simbolos) .symed-grid{grid-template-columns:0 0 minmax(240px,1fr) 6px var(--symed-r, var(--aside-w));}
.lib-view #symed:not(.symed-modo-simbolos) .symed-grid > .lib-left,
.lib-view #symed:not(.symed-modo-simbolos) .symed-grid > [data-split="l"]{display:none !important;}

/* o centro da sub-aba Footprints */
.lv-fp{display:flex; flex-direction:column; height:100%; min-height:0;}
/* [hidden] é só display:none da folha do navegador, e perde para o display:flex acima
   — a mesma armadilha que o hub.html já resolve assim para .viewport e .seg (hub.html:659).
   Sem esta linha a lista de footprints aparecia POR BAIXO da vista Geral, as duas juntas. */
.lv-fp[hidden]{display:none !important;}
#symed[hidden]{display:none !important;}
.lv-fp-bar{display:flex; gap:8px; align-items:center; padding:8px 10px;
  border-bottom:1px solid var(--line,#3a3a3a);}
.lv-fp-bar .input{flex:1; min-width:0;}
.lv-fp-bar .count{font-size:11px; color:var(--text-4,#7a7a7a); white-space:nowrap;}
/* o cabeçalho que diz em QUEM o clique vai mexer. Sem isto a lista é uma lista de nomes
   soltos e ninguém sabe o que o clique faz. */
.lv-alvo{padding:8px 10px; border-bottom:1px solid var(--line,#3a3a3a); font-size:12px;}
.lv-alvo .q{color:var(--text-4,#7a7a7a);}
.lv-alvo b{color:var(--text,#d8d8d8); font-weight:600;}
.lv-alvo .atual{display:inline-flex; align-items:center; gap:6px; margin-top:4px;
  font:11px Consolas,ui-monospace,monospace; color:var(--hi,#4fc3f7);}
.lv-alvo .atual .x{border:0; background:transparent; color:#ff6b6b; cursor:pointer;
  font-size:11px; padding:0 2px;}
.lv-alvo .nenhum{color:var(--warn,#ffb74d);}
/* A GALERIA É A MESMA DO EDITOR DE SÍMBOLOS, de propósito: reusa .symed-tiles/.symed-tile do
   hub.html em vez de inventar um cartão parecido. Foi o pedido ("a tela de seleção do
   footprint pode ser igualzinha a de símbolo"), e um cartão "quase igual" envelheceria
   sozinho quando o outro mudasse. Só o teto de altura cai: aqui a galeria É a vista. */
.lv-fp .symed-tiles{max-height:none; flex:1; min-height:0;}
.lv-fp .symed-tile .pads{font-size:9px; color:var(--text-4,#7a7a7a);}
.lv-fp .symed-tile.nao canvas{opacity:.35;}
.lv-fp .symed-tile .nd{font-size:9px; color:var(--warn,#ffb74d); text-transform:uppercase;
  letter-spacing:.04em;}
.lv-vazio{padding:18px 12px; font-size:12px; color:var(--text-4,#7a7a7a); line-height:1.5;}
.lv-nota{padding:8px 12px; border-top:1px solid var(--line,#3a3a3a); font-size:11px;
  color:var(--text-4,#7a7a7a); line-height:1.5;}
/* a fileira de ações, no lugar e no tom da do editor (Aplicar ao símbolo / Renomear…) */
.lv-acts{display:flex; gap:6px; align-items:center; padding:6px 12px;
  border-bottom:1px solid var(--line,#3a3a3a);}
.lv-acts .esc{font-size:11px; color:var(--text-4,#7a7a7a); margin-left:auto;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.lv-acts .sep{width:1px; height:18px; background:var(--line,#3a3a3a); margin:0 2px;}
/* O EDITOR DE FOOTPRINT MORA AQUI (hub-fpeditor.js embutido): editando, a galeria e a lista de
   componentes saem e o editor ocupa o corpo da vista; o cabecalho "vincular a X" fica, porque e
   nele que o "Aplicar a X" do editor vai mexer. Fechar o editor volta para a galeria. */
.lv-fp-ed{flex:1; min-height:0; min-width:0; display:flex; overflow:hidden;}
.lv-fp{min-width:0;}
.lv-fp-ed[hidden]{display:none !important;}
.lv-fp.lv-editando > :not(.lv-alvo):not(.lv-fp-ed){display:none !important;}
.lv-fp .symed-tile .hubtag{font-size:9px; padding:0 5px; border-radius:8px; margin-left:4px;
  background:var(--hi,#4fc3f7); color:var(--on-hi,#000); text-transform:none;}

/* A LISTA DE COMPONENTES DA CATEGORIA — o espelho da faixa "Componentes" do editor, e a
   peça que faltava: a categoria ("CAPACITOR CERAMICO [SMD]") é só o agrupador da esquerda;
   quem recebe o footprint é o COMPONENTE ("SMD 1206 4.7pF 50V C0G"). Reusa .symed-comp,
   a mesma linha que o editor desenha, para as duas telas serem a mesma tela. */
.lv-comps{max-height:34%; min-height:96px; overflow:auto; padding:4px 6px;
  border-bottom:1px solid var(--line,#3a3a3a);}
.lv-comps .symed-comp .fpat{font-size:10px; color:var(--hi,#4fc3f7);
  font-family:Consolas,ui-monospace,monospace;}
/* o encap, legivel: MESMA PINTA da etiqueta .pk da lista de valores (hub.html e
   schframe.html). O comentario ja dizia isso e tinha deixado de ser verdade -- a lista
   virou pilula (radius 999px, padding 1px 7px) e esta copia ficou no desenho velho.
   Terceira copia do mesmo chip; se mudar uma, mude as tres.
   SEM CRASE NESTE ARQUIVO: todo este CSS vive dentro de um template literal, e uma crase
   no comentario FECHA A STRING -- o modulo inteiro morre com "is not a function". */
.lv-comps .symed-comp .enc{font-size:11px; color:var(--text-2,#b8b8b8); padding:1px 7px;
  border-radius:999px; background:rgba(var(--tint,79,195,247),.12);
  font-family:Consolas,ui-monospace,monospace; white-space:nowrap;}
.lv-comps .symed-comp .semfp{font-size:10px; color:var(--warn,#ffb74d);}
.lv-titulo{display:flex; align-items:baseline; gap:8px; padding:7px 12px 4px;
  font-size:10px; letter-spacing:.09em; text-transform:uppercase;
  color:var(--text-4,#7a7a7a);}
.lv-titulo .n{text-transform:none; letter-spacing:0; font-size:11px;}
.lv-titulo .cat{text-transform:none; letter-spacing:0; color:var(--text-2,#b8b8b8);
  font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
`;

let cssPosto = false;
function poeCss(){
  if (cssPosto) return;
  cssPosto = true;
  const st = document.createElement('style');
  st.id = 'lv-css'; st.textContent = CSS;
  document.head.appendChild(st);
}

function el(tag, cls, txt){
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
}

/* "simbolos" mudou de dono em 2026-10-09: era o id da vista que hoje é Componentes. Quem
   chamava ir('simbolos') para chegar no componente (o #/libsym do hub.html) passou a pedir
   'componentes'; 'simbolos' agora é a vista nova, a do editor de símbolos. */
const ABAS = [['geral', 'Geral'], ['componentes', 'Componentes'], ['footprints', 'Footprints'],
              ['simbolos', 'Símbolos']];
/* as duas vistas que mostram o editor (#symed), cada uma num modo dele */
const DO_EDITOR = { componentes: true, simbolos: true };

const ST = {
  aba: 'geral',
  fps: null,          /* [{name, desenhado, usos}] — cache do GET */
  q: '',
  sel: null,          /* o footprint marcado na galeria */
  comp: null,         /* o COMPONENTE da categoria que vai receber o footprint */
  carregando: false,
  hub: null,          /* a biblioteca de footprints do hub (HubFpLib, Libs/pcblib-hub.js) */
  ed: null,           /* o editor de footprint aberto nesta vista (o ctrl do HubFpEditor) */
};

let API = null;       /* o que a casca entregou no instala() */

/* ── as quatro vistas do centro ──
   Só uma fica visível. As peças da vista GERAL são as que o hub.html já desenha (os dois
   canvas e a caixa de valores): não se recria nada, só se esconde — o `renderLib` da casca
   continua mandando nelas, e assim voltar para Geral não precisa redesenhar. */
function trocaCentro(){
  const centro = API && API.centro && API.centro();
  if (!centro) return;

  /* As vistas COMPONENTES e SÍMBOLOS trazem o `#symed` para dentro do centro (a casca move o
     nó). Ele fica aqui depois de vir, então a partir da segunda vez é só mostrar/esconder —
     por isso as peças da vista Geral são reconhecidas por exclusão, e não por uma lista de
     ids que envelheceria junto com o hub.html. */
  if (DO_EDITOR[ST.aba] && API.montaEditor) API.montaEditor(centro);
  else if (API.escondeEditor) API.escondeEditor();

  let meu = centro.querySelector('#lvFootprints');
  if (ST.aba === 'footprints' && !meu){
    meu = montaFootprints();
    centro.append(meu);
  }
  aplicaVisibilidade();
  if (ST.aba === 'footprints' && !ST.ed) abreEditorFp(null);
  /* só a vista Componentes abre no editor o que está selecionado na lista da casca: na
     Símbolos a lista é a do editor, e abrir a categoria ali jogaria fora o símbolo em edição */
  if (ST.aba === 'componentes' && API.abreEditor){
    const s = API.sel && API.sel();
    if (s && (s.k === 'sym' || s.k === 'gone-sym')){ ultimoAberto = s.name; API.abreEditor(s.name); }
  }
}

/* QUEM ESCONDE O QUE, separado de montar o centro — e barato de propósito, porque roda
   toda vez que a casca redesenha.

   Precisa rodar sempre porque o `renderLib` do hub.html RE-EXIBE as peças da vista Geral
   (o #libValBox e a barra de footprint) a cada desenho: ele não sabe que existe uma vista
   por cima. Sem reaplicar, bastava digitar na busca da esquerda para a caixa de valores
   reaparecer no topo da vista Componentes (então Símbolos), empilhada com o editor — que
   foi o que o dono viu. */
function aplicaVisibilidade(){
  const centro = API && API.centro && API.centro();
  if (!centro) return;
  const soGeral = (ST.aba === 'geral');
  /* NÃO SE MEXE NO `hidden` DAS PEÇAS DA GERAL. Quem esconde fora da Geral é a classe
     .lv-outra (CSS acima), e dentro da Geral quem decide QUAL corpo de baixo aparece é o
     `libPainelDeBaixo` do hub.html — hoje sempre o footprint.
     O laço que ficava aqui punha `hidden = false` em TODOS os filhos ao voltar para a
     Geral, e com isso reexibia a caixa de valores que o hub.html tinha acabado de
     esconder. Ela então caía numa SEXTA linha implícita da grade (que tem cinco) e comia
     o espaço: os dois viewports, que são `1fr`, colapsavam para 0 px e a vista Geral
     ficava só com as duas barras de título — "eu clico e não aparece nada". */
  const meu = centro.querySelector('#lvFootprints');
  if (meu) meu.hidden = (ST.aba !== 'footprints');
  const ed = document.getElementById('symed');
  if (ed && ed.closest('.lib-view')) ed.hidden = !DO_EDITOR[ST.aba];
  /* a grade de 4 painéis só faz sentido na vista Geral (ver .lv-outra no CSS) */
  centro.classList.toggle('lv-outra', !soGeral);
  /* e a ficha da direita idem — com a coluna dela, senão sobra o buraco */
  const aside = API.detalhe && API.detalhe();
  if (aside) aside.hidden = !soGeral;
  const grade = centro.parentElement;
  if (grade && grade.classList){
    grade.classList.toggle('lv-sem-ficha', !soGeral);
    /* na vista Símbolos a lista da casca sai também: ela é de componentes (ver o CSS) */
    grade.classList.toggle('lv-sem-lista', ST.aba === 'simbolos' || ST.aba === 'footprints');
  }
}

/* ── as sub-abas, no topo do CENTRO ──
   Elas são a primeira linha da grade do `.lib-view`, e não do aside da direita: quem troca
   é a janela do meio, e a faixa tem de estar em cima do que ela troca. */
/* DESDE 2026-10-14 A FAIXA É A PRIMEIRA LINHA DA GRADE INTEIRA (.lib-grid), por cima das três
   colunas, em todas as vistas — como a vista Símbolos sempre mostrou (ali a lista da casca sai e
   o centro ocupa tudo). Pedido do dono: "todas as abas em Biblioteca sigam o exemplo da de
   Símbolos, subabas na parte de cima". Dentro do centro, na Geral e na Componentes ela ficava
   só em cima da coluna do meio, e a busca da esquerda subia ao lado dela. */
function pintaAbas(){
  const centro = API && API.centro && API.centro();
  if (!centro) return;
  const grade = centro.parentElement || centro;
  let faixa = grade.querySelector(':scope > .lv-tabs') || centro.querySelector('.lv-tabs');
  if (!faixa) faixa = el('div', 'lv-tabs');
  if (faixa !== grade.firstElementChild) grade.prepend(faixa);   /* um redesenho da casca pode tê-la empurrado */
  grade.classList.add('lv-faixa-cima');
  faixa.textContent = '';
  for (const [id, rotulo] of ABAS){
    const b = el('button', null, rotulo);
    b.setAttribute('aria-pressed', String(ST.aba === id));
    b.onclick = () => ir(id);
    faixa.append(b);
  }
  const n = DUP.j ? DUP.j.grupos.length : 0;
  /* os avisos da biblioteca INTEIRA moram no fim da faixa, juntos: os produtos repetidos e o
     "apagar todos os fora" (a seleção por categoria fica no painel de valores, hub-almoxfora.js) */
  const avisos = el('span', 'lv-avisos');
  if (n){
    const b = el('button', 'lv-dup', '⚠ ' + n + (n === 1 ? ' produto repetido' : ' produtos repetidos'));
    b.title = 'o mesmo produto do Odoo em mais de um componente da biblioteca — clique para ver e limpar';
    b.onclick = abreDups;
    avisos.append(b);
  }
  if (DUP.fora && typeof HubAlmoxFora !== 'undefined'){
    const b = el('button', 'lv-fora', 'Apagar fora (' + DUP.fora + ')…');
    b.title = 'apaga da biblioteca todos os ' + DUP.fora + ' componentes que estão fora do Odoo — '
      + 'pergunta antes, mostrando onde são usados. Por categoria: selecione no painel de valores.';
    b.onclick = async () => { await HubAlmoxFora.apagaTodos(); await carregaDups(true); pintaAbas(); };
    avisos.append(b);
  }
  if (avisos.childNodes.length) faixa.append(avisos);
}

/* ── O MESMO PRODUTO DO ODOO EM MAIS DE UM COMPONENTE ──
   Pedido do dono (2026-09-29): tudo é vinculado pelo ID do Odoo, e o produto que aparece duas
   vezes na biblioteca tem de ser AVISADO. É quase sempre o zumbi de uma renomeação anterior
   a isso: o nome antigo ficou `fora` e o produto vive no outro componente (o TMAG5131A1, nº 4
   e nº 46). O aviso mora nesta faixa porque ela é igual nas duas cascas; a lista vem do
   servidor (/api/symbols/almox-duplicados), que é quem também apaga — e só apaga o antigo
   cujo produto vive noutro componente. O desenho e o vínculo com o símbolo que estavam no
   antigo o guardião já leva para o vivo no sincronismo. */
const DUP = { j: null, fora: 0, quando: 0, pedindo: null };
const DUP_TTL = 30000;                 /* a faixa repinta a cada desenho da Biblioteca */
/* os repetidos e a contagem de fora (/api/symbols/almox-fora), numa passada só */
function carregaDups(forca){
  if (typeof fetch !== 'function') return Promise.resolve(null);
  if (DUP.pedindo) return DUP.pedindo;
  if (!forca && Date.now() - DUP.quando < DUP_TTL) return Promise.resolve(DUP.j);
  DUP.quando = Date.now();
  const json = url => fetch(url).then(r => r.json()).catch(() => null);
  DUP.pedindo = Promise.all([json('/api/symbols/almox-duplicados'), json('/api/symbols/almox-fora')])
    .then(([j, f]) => {
      const antes = (DUP.j ? DUP.j.grupos.length : 0) + '/' + DUP.fora;
      DUP.j = (j && j.ok && Array.isArray(j.grupos)) ? j : null;
      DUP.fora = (f && f.ok && f.total) || 0;
      if ((DUP.j ? DUP.j.grupos.length : 0) + '/' + DUP.fora !== antes) pintaAbas();
      return DUP.j;
    }).then(j => { DUP.pedindo = null; return j; });
  return DUP.pedindo;
}
/* o adaptador da casca para o fluxo de apagar (o mesmo do "Apagar da biblioteca" de um valor:
   modal do hub, toast e recarga). As duas cascas o têm; sem ele, só o toast. */
function ioDaCasca(){
  if (API && typeof API.io === 'function') return API.io();
  return typeof ioExcluirAlmox === 'function' ? ioExcluirAlmox() : null;
}
function rotuloDup(v){
  return '#' + v.id + ' ' + (v.altium || v.label) + (v.fora ? '  (fora)' : '');
}
async function abreDups(){
  const j = await carregaDups(true);
  if (!j || !j.grupos.length){ aviso('nenhum produto repetido na biblioteca', 'ok'); return; }
  const raiz = document.getElementById('overlay') || document.body;
  const bd = el('div', 'backdrop center');
  const d = el('div', 'dialog lv-dup-dlg');
  d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
  const nAnt = (j.antigos || []).length;
  d.append(el('h3', null, 'Produtos repetidos na biblioteca'),
           el('p', null, j.grupos.length + (j.grupos.length === 1 ? ' produto do Odoo aparece' : ' produtos do Odoo aparecem')
             + ' em mais de um componente. Quase sempre é o nome antigo de um produto renomeado no Odoo antes de a '
             + 'biblioteca seguir o ID: o antigo ficou “fora” e o produto vive no outro. O desenho e o vínculo com '
             + 'o símbolo que estavam no antigo passam para o vivo no sincronismo.'));
  const lista = el('div', 'lv-dup-lista');
  const TETO = 300;
  for (const g of j.grupos.slice(0, TETO)){
    const lin = el('div', 'lv-dup-g');
    lin.append(el('span', 'id', g.odoo));
    const vs = el('span', 'vs');
    g.valores.forEach((v, i) => {
      if (i) vs.append(el('span', 'sep', ' · '));
      const x = el('span', v.fora ? 'fora' : 'vivo', rotuloDup(v));
      x.title = v.simbolo;
      vs.append(x);
    });
    lin.append(vs);
    lista.append(lin);
  }
  if (j.grupos.length > TETO) lista.append(el('div', 'lv-dup-mais', '+ ' + (j.grupos.length - TETO) + ' não listados'));
  d.append(lista);
  if (j.soFora) d.append(el('p', 'lv-dup-nota', j.soFora === 1
    ? '1 produto saiu do Odoo e ficou repetido só como “fora”: não entra no lote — apague à mão, se quiser.'
    : j.soFora + ' produtos saíram do Odoo e ficaram repetidos só como “fora”: não entram no lote — apague à mão, se quiser.'));
  if (j.misturados) d.append(el('p', 'lv-dup-nota', (j.misturados === 1
    ? '1 componente antigo carrega'
    : j.misturados + ' componentes antigos carregam')
    + ' também um produto que saiu do Odoo — é a última lembrança dele, e fica fora do lote. Apague à mão, se quiser.'));
  const act = el('div', 'acts');
  const bc = el('button', 'btn btn-ghost', 'Fechar'); bc.type = 'button';
  const bo = el('button', 'btn btn-danger', nAnt ? 'Apagar os ' + nAnt + ' antigos…' : 'Nada a apagar'); bo.type = 'button';
  bo.disabled = !nAnt;
  act.append(bc, bo); d.append(act); bd.append(d);
  const fecha = () => { document.removeEventListener('keydown', tecla, true); bd.remove(); };
  const tecla = e => { if (e.key === 'Escape'){ e.preventDefault(); e.stopImmediatePropagation(); fecha(); } };
  bc.onclick = fecha;
  bd.onclick = e => { if (e.target === bd) fecha(); };
  bo.onclick = async () => { fecha(); await apagaAntigos(); };
  document.addEventListener('keydown', tecla, true);
  raiz.append(bd);
  bc.focus();
}
async function apagaAntigos(){
  const io = ioDaCasca();
  const post = io ? io.post : async (url, body) => (await fetch(url, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  let p;
  try { p = await post('/api/symbols/almox-duplicados', {}); }
  catch (e){ aviso('não consegui perguntar ao servidor: ' + (e && e.message || e), 'err'); return; }
  if (!p || !p.ok){ aviso((p && p.error) || 'o servidor recusou', 'err'); return; }
  const n = (p.antigos || []).length;
  if (!n){ aviso('nada a apagar: nenhum antigo com o produto vivo noutro componente', 'ok'); return; }
  let texto = 'Apagar os ' + n + ' componentes antigos da biblioteca?\n\n'
    + 'Cada um está “fora” com um nome que não existe mais no Odoo, e o produto dele vive noutro '
    + 'componente. Eles saem do acervo agora; o número de cada um continua reservado, e nada '
    + 'renumera. Entram na lista de excluídos, como o “Apagar da biblioteca” de um só.';
  if (p.total){
    texto += '\n\nEM USO por ' + p.total + ' componente(s) nos projetos:\n'
      + p.usos.map(u => '  · ' + u.projeto + ': ' + u.refs.join(', ')).join('\n')
      + '\n\nQuem tem o id do Odoo no componente a folha leva sozinha para o nome de hoje.'
      + (p.orfaos ? ' ' + p.orfaos + ' não tem (' + p.usos.filter(u => u.orfaos.length)
          .map(u => u.projeto + ': ' + u.orfaos.join(', ')).join('; ') + ') e fica órfão até ser trocado.' : '');
  }
  const sim = io ? await io.confirm(texto, { title: 'Apagar os antigos', ok: 'Apagar ' + n, danger: true }) : false;
  if (!sim) return;
  let r;
  try { r = await post('/api/symbols/almox-duplicados', { confirmar: true }); }
  catch (e){ aviso('não consegui apagar: ' + (e && e.message || e), 'err'); return; }
  if (!r || !r.ok){ aviso((r && r.error) || 'o servidor recusou', 'err'); return; }
  aviso(r.apagados + (r.apagados === 1 ? ' componente antigo saiu' : ' componentes antigos saíram') + ' da biblioteca', 'ok');
  for (const a of (r.avisos || [])) aviso(a, 'warn');
  if (io && io.recarregar) await io.recarregar();
  await carregaDups(true);
  pintaAbas();
}

/* ── a vista Footprints: O EDITOR DE FOOTPRINT, no molde da vista Símbolos ──
   Pedido do dono, 2026-10-14: "deixe todas as abas idênticas à aba de símbolo em questão de
   layout, inclusive o footprints, precisa ter uma área de edição do footprint igual à dos
   símbolos". A vista é o hub-fpeditor.js no layout 'hub': lista com busca e "+ Novo footprint"
   à esquerda, editor no meio, FERRAMENTAS e a ficha à direita. Ele fica aberto ao trocar de
   sub-aba (o estado é dele) e grava em Libs/pcblib-hub.js.

   VINCULAR NÃO É AQUI. Como o símbolo, o footprint se aplica PELO COMPONENTE: na vista
   Componentes, faixa "Footprints", "Aplicar footprint ao componente" (hub-symed.js). Esta vista
   só cria e edita; o que ela entrega à outra é o HubLibView.fp (lista, desenho, vincular). */
function montaFootprints(){
  const box = el('div', 'lv-fp'); box.id = 'lvFootprints';
  const ed = el('div', 'lv-fp-ed'); ed.id = 'lvFpEd';
  box.append(ed);
  return box;
}

function fpDoHub(nome){
  return (ST.hub && typeof HubFpLib !== 'undefined') ? HubFpLib.acha(ST.hub, nome) : null;
}
function fpParaDesenho(nome){ return fpDoHub(nome) || (API.footprint && API.footprint(nome)) || null; }

let abrindo = null;
function abreEditorFp(nome, novo){
  if (ST.ed){
    if (nome && ST.ed.fp() && ST.ed.fp().name === nome && !ST.ed.fp().__vazio) return Promise.resolve();
    return Promise.resolve(ST.ed.podeSair()).then(ok => {
      if (!ok) return;
      if (novo) { ST.ed.carregaFp(null); ST.ed.novo(); }
      else ST.ed.carregaFp(nome, API.footprint && API.footprint(nome));
    });
  }
  if (abrindo) return abrindo;
  if (typeof HubFpEditor === 'undefined' || !HubFpEditor.abre){
    aviso('o editor de footprint (hub-fpeditor.js) não carregou nesta página', 'err'); return Promise.resolve();
  }
  const host = document.getElementById('lvFpEd');
  if (!host) return Promise.resolve();
  abrindo = new Promise(pronto => {
    HubFpEditor.abre({
      host, layout: 'hub', titulo: 'Footprint',
      nome: nome || null,
      fp: nome ? (API.footprint && API.footprint(nome)) || null : null,
      pcblib: { footprints: (API.footprintsAltium && API.footprintsAltium()) || [] },
      aoMontar: ctrl => { ST.ed = ctrl; abrindo = null; pronto(); if (novo) ctrl.novo(); },
      aoSalvar: async (fp, lib) => {
        ST.hub = lib;
        if (API.footprintsHub) { try { API.footprintsHub(lib); } catch (e) { /* a vista Geral relê depois */ } }
        await carregaFps();
        if (API.redesenha) API.redesenha();
      },
    }).then(() => { ST.ed = null; host.textContent = ''; });
  });
  return abrindo;
}

/* ── o que a vista Componentes (hub-symed.js, faixa "Footprints") usa daqui ── */
async function carregaFps(){
  ST.carregando = true;
  try {
    const [j, hub] = await Promise.all([
      fetch('/api/symbols/footprints').then(r => r.json()),
      /* os do hub com a geometria, para a miniatura: o /footprints só traz o nome */
      typeof HubFpLib !== 'undefined' ? HubFpLib.carrega().catch(() => null) : Promise.resolve(null)]);
    ST.fps = (j && j.ok && j.footprints) || null;
    if (hub) ST.hub = hub;
  } catch (e){
    ST.fps = null;
  }
  ST.carregando = false;
  try { document.dispatchEvent(new CustomEvent('hub:footprints-mudou')); } catch (e) { /* sem CustomEvent */ }
  return ST.fps;
}

/* o desenho do footprint no tile. Mesmo motor da vista Geral (HubDraw), no fundo escuro dela:
   sem `bg` o mkCamera pinta BRANCO e o cobre some ("as miniaturas estão brancas") */
const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function desenhaTile(cv, fp){
  if (!fp) return;
  if (!window.HubDraw || !HubDraw.mkCamera) return;
  try {
    const cam = HubDraw.mkCamera(cv, ctx => HubDraw.drawFootprint(ctx, fp),
                                 { bg: tok('--sunken') || '#14161a' });
    cam.resize();
    if (fp.bbox && cam.cam) cam.fit(fp.bbox, 1.25); else cam.draw();
  } catch (e) { /* um tile sem preview é melhor que a galeria inteira sem aparecer */ }
}

/* VINCULAR UM footprint a um componente. Duas rotas, porque são dois mundos: no almoxarifado
   o alvo é um VALOR dentro da categoria (vai ao ledger para sobreviver ao sincronismo); na
   biblioteca da casa o símbolo É o componente. `footprint` vazio desvincula. A regra de um-só
   e a de o nome existir (Altium ou hub) são do servidor. */
async function vinculaAlvo(alvo, nome){
  if (!alvo || !(alvo.componente || alvo.simbolo)) throw new Error('nenhum componente aberto');
  const corpo = alvo.valor
    ? { familia: alvo.familia, componente: alvo.componente, footprint: nome || '' }
    : { simbolo: alvo.simbolo, footprint: nome || '' };
  const r = await fetch(alvo.valor ? '/api/symbols/almox-footprint' : '/api/symbols/footprint', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = await r.json();
  if (!j || !j.ok) throw new Error((j && j.error) || 'não deu para vincular');
  /* o espelho em memória da casca anda junto, senão a lista da esquerda mostra o vínculo velho
     até alguém recarregar a página */
  const fam = API.simbolo && API.simbolo(alvo.valor ? alvo.familia : alvo.simbolo);
  if (alvo.valor && fam && Array.isArray(fam.valores)){
    const v = fam.valores.find(x => x.altium === alvo.componente);
    if (v) v.footprint = nome || '';
  } else if (fam){
    fam.footprints = j.footprints || [];
  }
  if (API.redesenha) API.redesenha();
  return j;
}
const FP = {
  lista: () => { if (ST.fps === null && !ST.carregando) carregaFps(); return ST.fps; },
  carrega: () => carregaFps(),
  geo: nome => fpParaDesenho(nome),
  ehHub: nome => !!fpDoHub(nome),
  desenha: (cv, nome) => desenhaTile(cv, fpParaDesenho(nome)),
  vincula: vinculaAlvo,
  /* "Editar footprint" no botão direito de um tile da vista Componentes */
  editar: nome => Promise.resolve(ir('footprints')).then(ok => { if (ok) return abreEditorFp(nome); }),
};

function aviso(txt, tom){
  if (window.HubDialog && HubDialog.toast) HubDialog.toast(txt, tom || 'info', 6000);
  else if (API && API.toast) API.toast(txt, tom);
  else { const io = ioDaCasca(); if (io && io.toast) io.toast(txt, tom); }
}

/* ── o contrato com a casca ──
   `instala({detalhe, centro, sel, simbolo, redesenha, abreEditor, toast})`. Tudo função, e
   lida na HORA de usar: a casca redesenha o aside e o centro o tempo todo, e guardar o
   elemento aqui daria um ponteiro para um nó que saiu do documento. */
function instala(api){
  API = api || {};
  poeCss();
  pintaAbas();
  trocaCentro();
  carregaDups(true);
  if (!ouvindo && typeof document !== 'undefined'){
    document.addEventListener('hub:editar-simbolo', pedidoDeEdicao);
    ouvindo = true;
  }
  return { aba: () => ST.aba, ir, atualiza };
}

/* "EDITAR NA ABA SÍMBOLOS" (o botão direito num tile da vista Componentes). O editor não
   conhece esta faixa: ele só avisa, por evento, que alguém quer editar o símbolo `id`. Aqui
   se troca de vista e se abre o símbolo. O preventDefault é o recibo — sem ninguém ouvindo, o
   editor troca de modo sozinho (hub-symed.js » pedeEdicao). */
let ouvindo = false;
function pedidoDeEdicao(e){
  const id = e && e.detail && e.detail.id;
  if (!id || typeof HubSymEd === 'undefined' || !HubSymEd.editarLib) return;
  e.preventDefault();
  Promise.resolve(ir('simbolos')).then(ok => { if (ok) HubSymEd.editarLib(id); });
}

/* a casca chama quando a seleção da esquerda muda: o alvo do vínculo é aquela seleção */
/* A casca chama isto a CADA desenho da Biblioteca (o fim dos dois previews), e não só
   quando a seleção muda: é o único ponto por onde os dois caminhos de clique passam — o
   `selectLib` do acervo do Altium e o onclick solto da lista do almoxarifado
   (hub.html:2839), que mexe em S.lib.sel direto e nunca chamou selectLib. Pendurar o aviso
   só no selectLib deixava o acervo padrão (Almoxarifado — Todos) sem aviso nenhum. */
let ultimoAberto = null;

function atualiza(){
  pintaAbas();
  carregaDups(false);                   /* no máximo uma vez a cada 30 s: depois de um sync */
  aplicaVisibilidade();                 /* barato, e desfaz o que o renderLib re-exibiu */
  if (ST.aba === 'footprints') return;
  /* na vista Símbolos a seleção da casca não manda no editor: a lista dali é outra */
  if (ST.aba !== 'componentes') return;
  /* abrir no editor é CARO (carrega a schlib, redesenha a faixa), então só quando o
     componente selecionado realmente mudou — senão cada tecla digitada na busca da
     esquerda reabriria o símbolo e o editor piscaria. */
  const s = API && API.sel && API.sel();
  const nome = s && (s.k === 'sym' || s.k === 'gone-sym') ? s.name : null;
  if (!nome || nome === ultimoAberto) return;
  ultimoAberto = nome;
  if (API.abreEditor) API.abreEditor(nome);
}

/* TROCAR DE VISTA PASSA PELO EDITOR quando o destino é uma das duas dele: ele é quem sabe se
   há edição não salva, e a vista só muda se ele aceitar trocar de modo. O HubSymEd.modo
   responde `true` NA HORA quando não precisa perguntar, e só devolve Promise quando abre o
   modal. É de propósito: quem chama ir() pelo hub.html (o #/libsym, o "Editar símbolo" da
   vista Esquema) segue logo com HubSymEd.abrir, e uma troca adiada para depois dele faria o
   render da vista trocar o acervo por baixo da abertura.
   Devolve true/false, ou a Promise disso quando houve pergunta. */
function ir(aba){
  if (!ABAS.some(([id]) => id === aba)) return false;
  const m = (DO_EDITOR[aba] && typeof HubSymEd !== 'undefined' && HubSymEd.modo) ? HubSymEd.modo(aba) : true;
  const fim = ok => { if (ok) entra(aba); else pintaAbas(); return !!ok; };
  return (m === true || m === false) ? fim(m) : Promise.resolve(m).then(fim, () => fim(false));
}
function entra(aba){
  /* voltar para Componentes reabre a categoria da esquerda: o editor esvaziou a mesa ao
     trocar de modo, e o atualiza() acha que ela continua aberta se o nome não mudou */
  if (aba === 'componentes' && ST.aba !== 'componentes') ultimoAberto = null;
  ST.aba = aba; pintaAbas(); trocaCentro();
  /* a Geral volta com os desenhos dela refeitos: um redesenho que aconteceu com ela escondida
     (aplicar um footprint na Componentes, por exemplo) mediu os canvas com zero de largura */
  if (aba === 'geral' && API && API.redesenha) requestAnimationFrame(() => API.redesenha());
}

return { instala, ir, atualiza, estado: ST, fp: FP,
         /* quem apaga componentes da biblioteca (hub-almoxfora.js) pede a contagem nova da faixa */
         recontar: () => carregaDups(true),
         pure: { filtra: (fps, q) => (fps || []).filter(f => !q || f.name.toLowerCase().includes(String(q).toLowerCase())) } };
})();
if (typeof module === 'object' && module.exports) module.exports = HubLibView;
