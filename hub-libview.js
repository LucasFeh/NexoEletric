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
  if (ST.aba === 'footprints'){
    pintaFootprints();
    if (ST.fps === null && !ST.carregando) carregaFps();
  }
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
    grade.classList.toggle('lv-sem-lista', ST.aba === 'simbolos');
  }
}

/* ── as sub-abas, no topo do CENTRO ──
   Elas são a primeira linha da grade do `.lib-view`, e não do aside da direita: quem troca
   é a janela do meio, e a faixa tem de estar em cima do que ela troca. */
function pintaAbas(){
  const centro = API && API.centro && API.centro();
  if (!centro) return;
  let faixa = centro.querySelector('.lv-tabs');
  if (!faixa){
    faixa = el('div', 'lv-tabs');
    centro.prepend(faixa);
  } else if (faixa !== centro.firstElementChild){
    centro.prepend(faixa);          /* um redesenho da casca pode tê-la empurrado para baixo */
  }
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

/* ── a vista Footprints ── */
function montaFootprints(){
  const box = el('div', 'lv-fp'); box.id = 'lvFootprints';

  const alvo = el('div', 'lv-alvo'); alvo.id = 'lvAlvo';
  const bar = el('div', 'lv-fp-bar');
  const inp = el('input', 'input'); inp.id = 'lvBusca'; inp.type = 'text';
  inp.placeholder = 'buscar footprint…';
  inp.value = ST.q;
  inp.addEventListener('input', () => { ST.q = inp.value; pintaLista(); });
  const cnt = el('span', 'count'); cnt.id = 'lvCount';
  bar.append(inp, cnt);

  /* A fileira de ações, no molde da do editor: escolher é uma coisa, aplicar é outra. O
     fluxo pedido é "seleciona o componente → escolhe o footprint → aplica no componente",
     e um clique que já grava não tem esse meio-passo. Duplo clique aplica direto, como o
     tile de símbolo faz. */
  const acts = el('div', 'lv-acts');
  const bAp = el('button', 'btn pri'); bAp.id = 'lvAplicar';
  bAp.textContent = 'Aplicar ao componente'; bAp.disabled = true;
  bAp.onclick = () => { if (ST.sel) vincula(ST.sel); };
  const bDes = el('button', 'btn'); bDes.id = 'lvDesvincular';
  bDes.textContent = 'Desvincular'; bDes.onclick = () => vincula('');
  const esc = el('span', 'esc'); esc.id = 'lvEscolhido';
  acts.append(bAp, bDes, esc);

  const lista = el('div', 'symed-tiles'); lista.id = 'lvLista';

  /* NAO EXISTE "criar footprint" AQUI, e isso e a regra, nao uma limitacao: o footprint e a
     UNICA coisa cuja verdade mora na lib do Altium (a .PcbLib, espelhada em Libs/pcblib.js).
     Todo o resto -- simbolo, valores, parametros, nomes -- nasce no hub e vai para o Altium;
     o footprint faz o caminho inverso, e por isso o hub so ESCOLHE entre os que ja existem
     la. Havia aqui um "Cadastrar e vincular" que aceitava um nome novo: ele fazia um
     footprint nascer no hub, que e exatamente o que nao pode. Saiu em 2026-09-17, junto com
     a recusa no servidor. Footprint que falta se desenha no Altium e chega pelo sincronismo.
  */
  const novo = el('div', 'lv-nota');
  novo.textContent = 'os footprints vêm da biblioteca do Altium — para criar um novo, '
                   + 'desenhe na PcbLib e sincronize.';

  const tit = el('div', 'lv-titulo'); tit.id = 'lvTitulo';
  const comps = el('div', 'lv-comps'); comps.id = 'lvComps';
  box.append(alvo, tit, comps, bar, acts, lista, novo);
  return box;
}

/* A CATEGORIA selecionada na esquerda. Ela não recebe footprint — é o agrupador. */
function categoriaAtual(){
  const s = API && API.sel && API.sel();
  if (!s || (s.k !== 'sym' && s.k !== 'gone-sym')) return null;
  return s.name;
}

/* OS COMPONENTES da categoria: no almoxarifado são os `valores` (cada um é uma peça de
   verdade, "SMD 1206 4.7pF 50V C0G"); na biblioteca da casa a categoria É o componente, e
   a lista tem um item só. As duas viram a mesma coisa daqui para cima. */
function componentesDa(cat){
  const s = cat && API.simbolo && API.simbolo(cat);
  if (!s) return [];
  const vals = s.valores;
  if (Array.isArray(vals) && vals.length){
    /* `sym`: o valor tem desenho? O dele (`parts` próprio) ou, na falta, o da família.
       Sem nenhum dos dois, o componente vai para o Altium sem símbolo — e é isso que a tag
       vermelha diz. */
    const temFam = !!(s.parts && s.parts.length);
    /* UM encap por componente, como o resto do hub: a peça tem um tamanho só. Havendo mais
       de um no Odoo, quem desempata é o footprint — "CAP 1206" carrega "1206". */
    const encapDe = v => {
      const pk = v.pkgs || [];
      if (pk.length <= 1) return pk[0] || '';
      const fp = String(v.footprint || '').toLowerCase();
      return pk.find(x => fp.includes(String(x).toLowerCase())) || pk[0];
    };
    return vals.map(v => ({ nome: v.altium, rotulo: v.label || v.altium, fp: v.footprint || '',
                            sym: !!(v.parts && v.parts.length) || temFam,
                            proprio: !!(v.parts && v.parts.length),
                            estoque: v.estoque, pkgs: encapDe(v), valor: true,
                            /* o valor inteiro, para o "Odoo ↗" achar o `tmpl` dos itens */
                            v }));
  }
  const fps = s.footprints || [];
  return [{ nome: s.name, rotulo: s.name, fp: (fps[0] && fps[0].name) || '',
            sym: !!(s.parts && s.parts.length), proprio: false,
            estoque: null, pkgs: '', valor: false }];
}

/* o componente escolhido agora — ou o primeiro da categoria, para a tela nunca abrir sem
   alvo (e o cabeçalho poder dizer em quem o clique vai mexer) */
function componenteAtual(){
  const cat = categoriaAtual();
  if (!cat) return null;
  const lista = componentesDa(cat);
  if (!lista.length) return null;
  const achado = ST.comp && lista.find(c => c.nome === ST.comp);
  return achado || lista[0];
}

function fpAtualDe(){
  const c = componenteAtual();
  return c && c.fp ? { name: c.fp } : null;
}

function pintaAlvo(){
  const cx = document.getElementById('lvAlvo');
  if (!cx) return;
  cx.textContent = '';
  const cat = categoriaAtual();
  if (!cat){
    cx.append(el('span', 'q', 'escolha uma categoria na lista da esquerda.'));
    return;
  }
  const c = componenteAtual();
  const l1 = el('div');
  if (!c){
    l1.append(el('span', 'q', 'a categoria '), el('b', null, cat),
              el('span', 'q', ' não tem componentes.'));
    cx.append(l1);
    return;
  }
  l1.append(el('span', 'q', 'vincular a '), el('b', null, c.nome));
  cx.append(l1);
  const l2 = el('div', 'atual');
  if (c.fp){
    l2.append(el('span', null, '↳ ' + c.fp));
    const x = el('button', 'x', '✕ desvincular');
    x.title = 'tirar o footprint deste componente';
    x.onclick = () => vincula('');
    l2.append(x);
  } else {
    l2.className = 'atual nenhum';
    l2.append(el('span', null, '↳ sem footprint vinculado'));
  }
  cx.append(l2);
}

/* A LISTA DE COMPONENTES da categoria. É o que faltava para o fluxo fechar: sem ela a tela
   sabia a categoria e não sabia em QUEM aplicar. Cada linha é .symed-comp — a mesma do
   editor — e mostra o footprint que o componente já tem, porque é isso que se está vindo
   trocar. */
function pintaComponentes(){
  const box = document.getElementById('lvComps');
  const tit = document.getElementById('lvTitulo');
  if (!box) return;
  box.textContent = '';
  const cat = categoriaAtual();
  const lista = cat ? componentesDa(cat) : [];
  const atual = componenteAtual();
  if (tit){
    tit.textContent = '';
    tit.append(el('span', null, 'componentes'));
    if (cat) tit.append(el('span', 'cat', cat));
    tit.append(el('span', 'n', lista.length
      ? lista.length + (lista.length === 1 ? ' item' : ' itens')
        + ' · ' + lista.filter(c => !c.fp).length + ' sem footprint'
        + (lista.filter(c => !c.sym).length
           ? ' · ' + lista.filter(c => !c.sym).length + ' sem símbolo' : '')
      : ''));
  }
  if (!cat){ box.append(el('div', 'lv-vazio', 'escolha uma categoria na lista da esquerda.')); return; }
  if (!lista.length){ box.append(el('div', 'lv-vazio', 'sem componentes nesta categoria.')); return; }
  const frag = document.createDocumentFragment();
  for (const c of lista){
    const b = el('button', 'symed-comp'); b.type = 'button';
    b.setAttribute('aria-selected', String(!!atual && atual.nome === c.nome));
    b.title = c.nome + (c.fp ? '\nfootprint: ' + c.fp : '\nsem footprint')
            + (c.pkgs ? '\nencapsulamento: ' + c.pkgs : '');
    b.append(el('span', 'nm', c.rotulo));
    const meta = el('span', 'mt');
    /* o ENCAP primeiro, do mesmo jeito da lista de valores da vista Geral: é a ponte entre
       o que veio do Odoo ("1206") e o footprint da casa ("CAP 1206") */
    if (c.pkgs){
      const e = el('span', 'enc', c.pkgs);
      e.title = 'encapsulamento ' + c.pkgs + ' (do Odoo)';
      meta.append(e);
    }
    /* O QUE FALTA VEM DEPOIS, em vermelho e com o nome da coisa que falta — as mesmas
       tags da categoria (hub.html » .pill.falta), para a lista e o agrupador dizerem a
       mesma coisa do mesmo jeito. Tendo footprint, mostra QUAL: é o que se veio trocar. */
    if (!c.fp){
      const t = el('span', 'pill falta', 'footprint');
      t.title = 'sem footprint vinculado';
      meta.append(t);
    } else {
      meta.append(el('span', 'fpat', c.fp));
    }
    if (!c.sym){
      const t = el('span', 'pill falta', 'símbolo');
      t.title = 'sem desenho: nem próprio nem o da categoria';
      meta.append(t);
    } else if (c.proprio){
      meta.append(el('span', 'pill', 'desenho próprio'));
    }
    if (typeof c.estoque === 'number') meta.append(el('span', 'es', c.estoque + ' un'));
    b.append(meta);
    b.onclick = () => { ST.comp = c.nome; ST.sel = null; pintaFootprints(); };
    /* o "Odoo ↗" ao lado da linha, não dentro dela (hub-odoolink » faixa) */
    frag.append(typeof HubOdooLink !== 'undefined'
      ? HubOdooLink.faixa(b, c.v, { nome: c.rotulo }) : b);
  }
  box.append(frag);
}

function pintaLista(){
  const lista = document.getElementById('lvLista');
  const cnt = document.getElementById('lvCount');
  if (!lista) return;
  lista.textContent = '';
  if (ST.carregando){ lista.append(el('div', 'lv-vazio', 'carregando…')); return; }
  if (ST.fps === null){ lista.append(el('div', 'lv-vazio', 'não consegui ler a lista de footprints.')); return; }
  const q = ST.q.trim().toLowerCase();
  const vis = ST.fps.filter(f => !q || f.name.toLowerCase().includes(q));
  if (cnt) cnt.textContent = vis.length + ' de ' + ST.fps.length;
  if (!vis.length){
    lista.append(el('div', 'lv-vazio', q
      ? 'nada com "' + ST.q + '" na biblioteca do Altium.'
      : 'nenhum footprint.'));
    return;
  }
  const atual = fpAtualDe();
  const frag = document.createDocumentFragment();
  const pendentes = [];
  for (const f of vis.slice(0, 400)){
    const obj = API.footprint && API.footprint(f.name);
    const t = el('button', 'symed-tile' + (f.desenhado ? '' : ' nao'));
    t.type = 'button';
    /* marcado = o escolhido agora; se ninguém escolheu ainda, o que já está vinculado */
    const marcado = ST.sel ? (ST.sel === f.name) : (!!atual && atual.name === f.name);
    t.setAttribute('aria-selected', String(marcado));
    t.title = f.name + '\n' + (f.desenhado ? ((obj && (obj.pads || []).length) || 0) + ' pads'
                                           : 'ainda não desenhado na PcbLib')
      + (f.usos ? '\n' + f.usos + (f.usos === 1 ? ' componente usa' : ' componentes usam') : '')
      + (atual && atual.name === f.name ? '\n— é o vinculado hoje' : '');
    const cv = el('canvas'); cv.width = 96; cv.height = 64;
    const nm = el('span', 'nm', f.name);
    const k = el('span', f.desenhado ? 'pads' : 'nd',
                 f.desenhado ? (((obj && (obj.pads || []).length) || 0) + ' pads'
                                + (f.usos ? ' · ' + f.usos + ' uso' + (f.usos === 1 ? '' : 's') : ''))
                             : 'não desenhado');
    t.append(cv, nm, k);
    t.onclick = () => { ST.sel = (ST.sel === f.name) ? null : f.name; pintaLista(); pintaAcoes(); };
    t.ondblclick = () => vincula(f.name);
    frag.append(t);
    if (obj){ cv._fp = obj; pendentes.push(cv); }
  }
  lista.append(frag);
  /* DESENHAR SÓ DEPOIS DE ENTRAR NO DOCUMENTO. Dentro do fragmento o canvas tem
     clientWidth 0, e o resize() da câmera monta uma transformação vazia: o tile ficava
     preenchido com o fundo e mais nada — foi o "as miniaturas estão brancas". O
     IntersectionObserver é o mesmo remédio da galeria de símbolos (hub-symed.js), e de
     quebra não pinta 400 canvas de uma vez: só os que estão à vista. */
  observa(lista, pendentes);
  if (vis.length > 400){
    lista.append(el('div', 'symed-empty', '… e mais ' + (vis.length - 400)
      + '. Refine a busca — a galeria para em 400 para a rolagem não travar.'));
  }
  pintaAcoes();
}

/* o desenho do footprint no tile. Mesmo motor da vista Geral (HubDraw), mesma moldura dos
   tiles de símbolo — footprint sem pads (o só-cadastrado) fica com o quadro vazio, que é a
   verdade dele. */
/* O FUNDO ESCURO NÃO É ENFEITE. Sem `bg`, o mkCamera pinta BRANCO (hub-draw.js:345) e o
   footprint — cobre e furo, cores feitas para fundo escuro — some no branco: foi o "as
   miniaturas estão brancas, não aparece nada". A vista Geral sempre passou `--sunken` no
   canvas de footprint (hub.html:2397); o tile passa o mesmo, e o CSS do .symed-tile canvas,
   que é `--sheet` (a folha clara do símbolo), é sobrescrito junto. */
const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

let IO = null;

/* Pinta cada canvas quando ele entra na área visível da galeria. `rootMargin` generoso para
   o tile já chegar desenhado, e `unobserve` depois de pintar porque o desenho não muda. */
function observa(raiz, canvases){
  if (!canvases.length) return;
  if (IO) IO.disconnect();
  if (typeof IntersectionObserver !== 'function'){
    for (const cv of canvases) desenhaTile(cv, cv._fp);
    return;
  }
  IO = new IntersectionObserver(entradas => {
    for (const e of entradas){
      if (!e.isIntersecting) continue;
      desenhaTile(e.target, e.target._fp);
      IO.unobserve(e.target);
    }
  }, { root: raiz, rootMargin: '160px' });
  for (const cv of canvases) IO.observe(cv);
}

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

function pintaAcoes(){
  const b = document.getElementById('lvAplicar');
  const d = document.getElementById('lvDesvincular');
  const e = document.getElementById('lvEscolhido');
  const c = componenteAtual();
  const sim = c && c.nome;
  const atual = fpAtualDe();
  if (b) b.disabled = !sim || !ST.sel || (!!atual && atual.name === ST.sel);
  if (d) d.disabled = !sim || !atual;
  if (e) e.textContent = !sim ? 'nenhum componente selecionado'
    : ST.sel ? 'escolhido: ' + ST.sel
    : 'escolha um footprint na galeria';
}

function pintaFootprints(){ pintaAlvo(); pintaComponentes(); pintaLista(); }

async function carregaFps(){
  ST.carregando = true;
  pintaLista();
  try {
    const r = await fetch('/api/symbols/footprints');
    const j = await r.json();
    ST.fps = (j && j.ok && j.footprints) || null;
  } catch (e){
    ST.fps = null;
  }
  ST.carregando = false;
  pintaLista();
}

/* UM footprint. A rota recusa mais de um, e aqui nem se oferece: clicar troca, e o ✕
   desvincula. Não existe "adicionar mais um" nesta tela de propósito. */
async function vincula(nome){
  const c = componenteAtual();
  const sim = c && c.nome;
  if (!sim){ aviso('escolha um componente na lista acima primeiro.', 'warn'); return; }
  try {
    /* DUAS ROTAS, porque sao dois mundos. No almoxarifado o alvo e um VALOR dentro da
       familia, e a escolha precisa ir ao ledger para sobreviver ao sincronismo; na
       biblioteca da casa o simbolo E o componente e o vinculo mora no proprio schlib.js.
       `c.valor` diz de qual dos dois se trata — quem monta a lista ja sabe. */
    const corpo = c.valor
      ? { familia: categoriaAtual(), componente: sim, footprint: nome }
      : { simbolo: sim, footprint: nome };
    const r = await fetch(c.valor ? '/api/symbols/almox-footprint' : '/api/symbols/footprint', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    const j = await r.json();
    if (!j || !j.ok){ aviso((j && j.error) || 'não deu para vincular', 'err'); return; }
    /* o espelho em memória da casca tem de andar junto, senão a tela mostra o vínculo velho
       até alguém recarregar a página */
    /* o espelho em memoria da casca anda junto, senao a tela mostra o vinculo velho ate
       alguem recarregar a pagina */
    const fam = API.simbolo && API.simbolo(categoriaAtual());
    if (c.valor && fam && Array.isArray(fam.valores)){
      const v = fam.valores.find(x => x.altium === sim);
      if (v) v.footprint = nome;
    } else if (fam){
      fam.footprints = j.footprints || [];
    }
    ST.sel = null;
    aviso(nome ? ('“' + sim + '” → ' + nome) : ('“' + sim + '” ficou sem footprint'), 'ok');
    for (const a of (j.avisos || [])) aviso(a, 'warn');
    pintaFootprints();
    if (API.redesenha) API.redesenha();
  } catch (e){
    aviso('não consegui falar com o servidor: ' + (e && e.message || e), 'err');
  }
}

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
  if (ST.aba === 'footprints'){ pintaFootprints(); return; }
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
}

return { instala, ir, atualiza, estado: ST,
         /* quem apaga componentes da biblioteca (hub-almoxfora.js) pede a contagem nova da faixa */
         recontar: () => carregaDups(true),
         pure: { filtra: (fps, q) => (fps || []).filter(f => !q || f.name.toLowerCase().includes(String(q).toLowerCase())) } };
})();
if (typeof module === 'object' && module.exports) module.exports = HubLibView;
