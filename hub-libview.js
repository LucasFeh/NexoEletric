/* AltiumPCBMirror v2 - hub-libview.js — as 3 vistas da aba Biblioteca.
 *
 *   GERAL       o que a aba sempre mostrou: o símbolo em cima, o footprint embaixo.
 *   SÍMBOLOS    o editor de símbolos, mas dirigido pela MESMA busca das outras duas.
 *   FOOTPRINTS  a lista de footprints, para vincular UM a um componente.
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
 * nela atravessam a troca.
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

/* Fora da vista Geral o centro deixa de ser a grade de quatro painéis e vira faixa + corpo:
   senão as linhas vazias da grade continuariam reservando altura para canvas escondido. */
.lib-view.lv-outra{grid-template-rows:auto minmax(0,1fr);}
/* FORA DA GERAL, SÓ A VISTA DA VEZ — declarativo, e não a disputa de hidden que eu vinha
   perdendo. O hub.html tem vários donos do hidden dessas peças (libPainelDeBaixo, os ~16
   chamadores de renderLib, e o próprio redesenha que este módulo dispara ao vincular), e
   cada um deles reexibia a caixa de valores por cima da vista Símbolos. Com a regra na
   CLASSE que este módulo controla, todos os caminhos fecham de uma vez — inclusive os que
   alguém escrever amanhã. O laço de aplicaVisibilidade fica como cinto e suspensório. */
.lib-view.lv-outra > :not(.lv-tabs):not(#symed):not(#lvFootprints){display:none !important;}
/* o footprint é desenhado em fundo escuro, como na vista Geral — ver desenhaTile */
.lv-fp .symed-tile canvas{background:var(--sunken,#14161a);}

/* A FICHA DA DIREITA SÓ EXISTE NA VISTA GERAL. Em Símbolos o editor já tem o painel dele
   (e os dois mostravam componentes DIFERENTES, porque o editor abre o seu e a ficha segue a
   seleção da lista); em Footprints o cabeçalho "vincular a X" já diz o alvo. Esconder o
   aside não basta: a coluna dele é uma faixa fixa do grid e continuaria reservada, deixando
   um buraco — por isso a grade perde a terceira coluna junto. */
.lib-grid.lv-sem-ficha{grid-template-columns:minmax(300px,0.95fr) minmax(320px,1.25fr);}
#libDetail[hidden]{display:none !important;}

/* UMA BUSCA SÓ. Dentro da Biblioteca o editor de símbolos perde a coluna de busca dele: a
   lista da esquerda serve as três vistas, e duas caixas "Buscar símbolo" na mesma tela era
   justamente o que o dono mandou tirar. A coluna e a divisória somem juntas, e os trilhos 1
   e 2 fecham em zero — o .symed-grid prende cada filho ao seu grid-column, então deixar a
   faixa aberta deixaria um vão.
   Só aqui dentro: aberto pela aba própria, o editor continua com a busca dele. */
.lib-view #symed .symed-grid{grid-template-columns:0 0 minmax(240px,1fr) 6px var(--symed-r, var(--aside-w));}
.lib-view #symed .symed-grid > .lib-left,
.lib-view #symed .symed-grid > [data-split="l"]{display:none !important;}

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
.lv-novo{padding:8px 10px; border-top:1px solid var(--line,#3a3a3a); display:flex; gap:8px;
  align-items:center;}
.lv-novo .input{flex:1; min-width:0;}
/* a fileira de ações, no lugar e no tom da do editor (Aplicar ao símbolo / Renomear…) */
.lv-acts{display:flex; gap:6px; align-items:center; padding:6px 12px;
  border-bottom:1px solid var(--line,#3a3a3a);}
.lv-acts .esc{font-size:11px; color:var(--text-4,#7a7a7a); margin-left:auto;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
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

const ABAS = [['geral', 'Geral'], ['simbolos', 'Símbolos'], ['footprints', 'Footprints']];

const ST = {
  aba: 'geral',
  fps: null,          /* [{name, desenhado, usos}] — cache do GET */
  q: '',
  sel: null,          /* o footprint marcado na lista */
  carregando: false,
};

let API = null;       /* o que a casca entregou no instala() */

/* ── as três vistas do centro ──
   Só uma fica visível. As peças da vista GERAL são as que o hub.html já desenha (os dois
   canvas e a caixa de valores): não se recria nada, só se esconde — o `renderLib` da casca
   continua mandando nelas, e assim voltar para Geral não precisa redesenhar. */
function trocaCentro(){
  const centro = API && API.centro && API.centro();
  if (!centro) return;

  /* A vista SÍMBOLOS traz o `#symed` para dentro do centro (a casca move o nó). Ele fica
     aqui depois de vir, então a partir da segunda vez é só mostrar/esconder — por isso as
     peças da vista Geral são reconhecidas por exclusão, e não por uma lista de ids que
     envelheceria junto com o hub.html. */
  if (ST.aba === 'simbolos' && API.montaEditor) API.montaEditor(centro);
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
  if (ST.aba === 'simbolos' && API.abreEditor){
    const s = API.sel && API.sel();
    if (s && (s.k === 'sym' || s.k === 'gone-sym')){ ultimoAberto = s.name; API.abreEditor(s.name); }
  }
}

/* QUEM ESCONDE O QUE, separado de montar o centro — e barato de propósito, porque roda
   toda vez que a casca redesenha.

   Precisa rodar sempre porque o `renderLib` do hub.html RE-EXIBE as peças da vista Geral
   (o #libValBox e a barra de footprint) a cada desenho: ele não sabe que existe uma vista
   por cima. Sem reaplicar, bastava digitar na busca da esquerda para a caixa de valores
   reaparecer no topo da vista Símbolos, empilhada com o editor — que foi o que o dono viu. */
function aplicaVisibilidade(){
  const centro = API && API.centro && API.centro();
  if (!centro) return;
  const soGeral = (ST.aba === 'geral');
  for (const filho of Array.from(centro.children)){
    if (filho.id === 'lvFootprints' || filho.id === 'symed') continue;
    if (filho.classList && filho.classList.contains('lv-tabs')) continue;   /* a faixa fica */
    filho.hidden = !soGeral;
  }
  const meu = centro.querySelector('#lvFootprints');
  if (meu) meu.hidden = (ST.aba !== 'footprints');
  const ed = document.getElementById('symed');
  if (ed && ed.closest('.lib-view')) ed.hidden = (ST.aba !== 'simbolos');
  /* a grade de 4 painéis só faz sentido na vista Geral (ver .lv-outra no CSS) */
  centro.classList.toggle('lv-outra', !soGeral);
  /* e a ficha da direita idem — com a coluna dela, senão sobra o buraco */
  const aside = API.detalhe && API.detalhe();
  if (aside) aside.hidden = !soGeral;
  const grade = centro.parentElement;
  if (grade && grade.classList) grade.classList.toggle('lv-sem-ficha', !soGeral);
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
    b.onclick = () => { ST.aba = id; pintaAbas(); trocaCentro(); };
    faixa.append(b);
  }
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
  bAp.onclick = () => { if (ST.sel) vincula(ST.sel, false); };
  const bDes = el('button', 'btn'); bDes.id = 'lvDesvincular';
  bDes.textContent = 'Desvincular'; bDes.onclick = () => vincula('', false);
  const esc = el('span', 'esc'); esc.id = 'lvEscolhido';
  acts.append(bAp, bDes, esc);

  const lista = el('div', 'symed-tiles'); lista.id = 'lvLista';

  /* cadastrar um nome que a PcbLib ainda não tem. NÃO desenha footprint nenhum — não existe
     escritor de .PcbLib neste projeto (só de .SchLib). O nome fica vinculado e marcado como
     "não desenhado", para ser desenhado no Altium depois. */
  const novo = el('div', 'lv-novo');
  const ni = el('input', 'input'); ni.id = 'lvNovo'; ni.type = 'text';
  ni.placeholder = 'nome de um footprint que ainda não existe…';
  const nb = el('button', 'btn'); nb.textContent = 'Cadastrar e vincular';
  nb.onclick = () => vincula(ni.value.trim(), true);
  ni.addEventListener('keydown', e => { if (e.key === 'Enter') nb.click(); });
  novo.append(ni, nb);

  box.append(alvo, bar, acts, lista, novo);
  return box;
}

function simboloAtual(){
  const s = API && API.sel && API.sel();
  if (!s || (s.k !== 'sym' && s.k !== 'gone-sym')) return null;
  return s.name;
}

function fpAtualDe(nome){
  const s = API && API.simbolo && API.simbolo(nome);
  const fps = (s && s.footprints) || [];
  return fps.length ? fps[0] : null;
}

function pintaAlvo(){
  const cx = document.getElementById('lvAlvo');
  if (!cx) return;
  cx.textContent = '';
  const nome = simboloAtual();
  if (!nome){
    cx.append(el('span', 'q', 'escolha um componente na lista da esquerda para vincular.'));
    return;
  }
  const l1 = el('div');
  l1.append(el('span', 'q', 'vincular a '), el('b', null, nome));
  cx.append(l1);
  const at = fpAtualDe(nome);
  const l2 = el('div', 'atual');
  if (at){
    l2.append(el('span', null, '↳ ' + at.name + (at.incurrentlib === false ? '  (não desenhado)' : '')));
    const x = el('button', 'x', '✕ desvincular');
    x.title = 'tirar o footprint deste componente';
    x.onclick = () => vincula('', false);
    l2.append(x);
  } else {
    l2.className = 'atual nenhum';
    l2.append(el('span', null, '↳ sem footprint vinculado'));
  }
  cx.append(l2);
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
      ? 'nada com "' + ST.q + '". Dá para cadastrar esse nome abaixo e desenhar no Altium depois.'
      : 'nenhum footprint.'));
    return;
  }
  const atual = fpAtualDe(simboloAtual());
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
    t.ondblclick = () => vincula(f.name, false);
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
  const sim = simboloAtual();
  const atual = fpAtualDe(sim);
  if (b) b.disabled = !sim || !ST.sel || (!!atual && atual.name === ST.sel);
  if (d) d.disabled = !sim || !atual;
  if (e) e.textContent = !sim ? 'nenhum componente selecionado'
    : ST.sel ? 'escolhido: ' + ST.sel
    : 'escolha um footprint na galeria';
}

function pintaFootprints(){ pintaAlvo(); pintaLista(); }

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
async function vincula(nome, ehNovo){
  const sim = simboloAtual();
  if (!sim){ aviso('escolha um componente na lista da esquerda primeiro.', 'warn'); return; }
  if (ehNovo && !nome){ aviso('digite o nome do footprint.', 'warn'); return; }
  try {
    const r = await fetch('/api/symbols/footprint', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ simbolo: sim, footprint: nome }),
    });
    const j = await r.json();
    if (!j || !j.ok){ aviso((j && j.error) || 'não deu para vincular', 'err'); return; }
    /* o espelho em memória da casca tem de andar junto, senão a tela mostra o vínculo velho
       até alguém recarregar a página */
    const s = API.simbolo && API.simbolo(sim);
    if (s) s.footprints = j.footprints || [];
    if (ehNovo){
      const ni = document.getElementById('lvNovo');
      if (ni) ni.value = '';
      ST.fps = null;                    /* o nome novo passa a existir na lista */
      carregaFps();
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
  return { aba: () => ST.aba, ir, atualiza };
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
  aplicaVisibilidade();                 /* barato, e desfaz o que o renderLib re-exibiu */
  if (ST.aba === 'footprints'){ pintaFootprints(); return; }
  if (ST.aba !== 'simbolos') return;
  /* abrir no editor é CARO (carrega a schlib, redesenha a faixa), então só quando o
     componente selecionado realmente mudou — senão cada tecla digitada na busca da
     esquerda reabriria o símbolo e o editor piscaria. */
  const s = API && API.sel && API.sel();
  const nome = s && (s.k === 'sym' || s.k === 'gone-sym') ? s.name : null;
  if (!nome || nome === ultimoAberto) return;
  ultimoAberto = nome;
  if (API.abreEditor) API.abreEditor(nome);
}

function ir(aba){
  if (!ABAS.some(([id]) => id === aba)) return false;
  ST.aba = aba; pintaAbas(); trocaCentro();
  return true;
}

return { instala, ir, atualiza, estado: ST,
         pure: { filtra: (fps, q) => (fps || []).filter(f => !q || f.name.toLowerCase().includes(String(q).toLowerCase())) } };
})();
if (typeof module === 'object' && module.exports) module.exports = HubLibView;
