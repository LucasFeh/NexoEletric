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
   primeira linha da grade do .lib-view — por isso o hub.html abriu um \`auto\` a mais ali. */
.lv-tabs{display:flex; gap:2px; padding:6px 12px 0; border-bottom:1px solid var(--line,#3a3a3a);}
.lv-tabs button{border:0; background:transparent; color:var(--text-3,#9a9a9a);
  font:12px 'Segoe UI',sans-serif; padding:7px 14px; cursor:pointer;
  border-bottom:2px solid transparent; margin-bottom:-1px;}
.lv-tabs button:hover{background:rgba(255,255,255,.05); color:var(--text,#d8d8d8);}
.lv-tabs button[aria-pressed="true"]{color:var(--hi,#4fc3f7); border-bottom-color:var(--hi,#4fc3f7);}

/* Fora da vista Geral o centro deixa de ser a grade de quatro painéis e vira faixa + corpo:
   senão as linhas vazias da grade continuariam reservando altura para canvas escondido. */
.lib-view.lv-outra{grid-template-rows:auto minmax(0,1fr);}

/* o centro da sub-aba Footprints */
.lv-fp{display:flex; flex-direction:column; height:100%; min-height:0;}
/* [hidden] é só \`display:none\` da folha do navegador, e perde para o \`display:flex\` acima
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
.lv-fp-list{flex:1; min-height:0; overflow:auto; padding:4px;}
.lv-row{display:grid; grid-template-columns:minmax(0,1fr) auto auto; gap:10px; align-items:center;
  width:100%; text-align:left; border:0; background:transparent; color:var(--text,#d8d8d8);
  font:12px 'Segoe UI',sans-serif; padding:7px 10px; border-radius:var(--r-sm,4px); cursor:pointer;}
.lv-row:hover{background:rgba(var(--tint,79,195,247),.07);}
.lv-row[aria-pressed="true"]{background:rgba(var(--tint,79,195,247),.16);
  box-shadow:inset 2px 0 0 var(--hi,#4fc3f7);}
.lv-row .nm{overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.lv-row .us{font-size:11px; color:var(--text-4,#7a7a7a); white-space:nowrap;}
.lv-row .st{font-size:10px; white-space:nowrap; padding:1px 6px; border-radius:8px;}
.lv-row .st.ok{color:var(--ok,#00e676); background:rgba(0,230,118,.10);}
.lv-row .st.no{color:var(--warn,#ffb74d); background:rgba(255,183,77,.12);}
.lv-vazio{padding:18px 12px; font-size:12px; color:var(--text-4,#7a7a7a); line-height:1.5;}
.lv-novo{padding:8px 10px; border-top:1px solid var(--line,#3a3a3a); display:flex; gap:8px;}
.lv-novo .input{flex:1; min-width:0;}
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
  for (const filho of Array.from(centro.children)){
    if (filho.id === 'lvFootprints' || filho.id === 'symed') continue;
    if (filho.classList && filho.classList.contains('lv-tabs')) continue;   /* a faixa fica */
    filho.hidden = (ST.aba !== 'geral');
  }
  if (meu) meu.hidden = (ST.aba !== 'footprints');
  /* a grade de 4 painéis só faz sentido na vista Geral (ver .lv-outra no CSS) */
  centro.classList.toggle('lv-outra', ST.aba !== 'geral');
  if (ST.aba === 'footprints'){
    pintaFootprints();
    if (ST.fps === null && !ST.carregando) carregaFps();
  }
  if (ST.aba === 'simbolos' && API.abreEditor){
    const s = API.sel && API.sel();
    if (s && (s.k === 'sym' || s.k === 'gone-sym')) API.abreEditor(s.name);
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

  const lista = el('div', 'lv-fp-list'); lista.id = 'lvLista';

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

  box.append(alvo, bar, lista, novo);
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
  for (const f of vis.slice(0, 400)){
    const b = el('button', 'lv-row');
    b.setAttribute('aria-pressed', String(!!atual && atual.name === f.name));
    const nm = el('span', 'nm', f.name); nm.title = f.name;
    const st = el('span', 'st ' + (f.desenhado ? 'ok' : 'no'),
                  f.desenhado ? 'desenhado' : 'não desenhado');
    const us = el('span', 'us', f.usos ? f.usos + (f.usos === 1 ? ' uso' : ' usos') : '—');
    b.append(nm, st, us);
    b.onclick = () => vincula(f.name, false);
    lista.append(b);
  }
  if (vis.length > 400){
    lista.append(el('div', 'lv-vazio', '… e mais ' + (vis.length - 400)
      + '. Refine a busca — a lista para em 400 para a rolagem não travar.'));
  }
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
function atualiza(){
  pintaAbas();
  if (ST.aba === 'footprints') pintaFootprints();
  else if (ST.aba === 'simbolos' && API && API.abreEditor){
    const s = API.sel && API.sel();
    if (s && (s.k === 'sym' || s.k === 'gone-sym')) API.abreEditor(s.name);
  }
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
