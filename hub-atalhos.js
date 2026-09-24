/* AltiumPCBMirror v2 - hub-atalhos.js — os atalhos de teclado da vista Esquema.

   A tabela, as regras de gravação e o editor das teclas. Morava inteiro no schframe.js, com
   o editor numa sub-aba "Atalhos" do painel da vista; o editor mudou para as Configurações do
   hub (aba Atalhos) e a vista ficou só com o teclado. Os dois lados leem daqui:

   - schframe.js usa a tabela e o mapaAtalhos para saber o que cada tecla faz, e re-exporta
     as funções puras (os testes em Node as pegam por ele: tests/test-fio-topologia.js);
   - o hub chama pane() dentro do modal de configuração.

   O que o usuário grava fica no localStorage, na MESMA chave de antes (CHAVE), então quem já
   tinha trocado uma tecla não perde nada. O hub e a vista (um <iframe> da mesma origem)
   dividem esse localStorage: gravar no modal dispara o evento `storage` na vista aberta, e
   ela troca o teclado na hora, sem recarregar.

   Autossuficiente como o hub-dialog.js: injeta o próprio CSS e traz os próprios rótulos em
   pt-BR. Em Node vale só a parte pura. */
"use strict";
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module !== 'undefined' && module.exports) module.exports = m;
  else raiz.HubAtalhos = m;
})(typeof self !== 'undefined' ? self : this, function () {

const CHAVE = 'altiumhub.sch.atalhos';

/* ── ATALHOS: uma tabela so ──
   A dica do painel era uma COPIA escrita a mao, e ja mentia: nao citava Ctrl+Y, Ctrl+A, Ctrl+W
   nem o Escape, que sozinho faz seis coisas. Agora a tabela e a verdade — o teclado le dela e o
   editor desenha dela, entao trocar uma tecla troca as duas de uma vez.
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
/* Proibida: a lista acima, e qualquer combinacao que TERMINE em Escape. A vista trata todo
   e.key === 'Escape' antes de olhar o mapa (e a saida de emergencia de seis estados), entao um
   Shift+Escape gravado nunca dispararia. */
function proibida(t){ return TECLAS_PROIBIDAS.indexOf(t) >= 0 || /(^|\+)Escape$/.test(String(t)); }
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
    if (!t || proibida(t)) { descartados.push(id + ': tecla não permitida'); continue; }
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
  if (/(^|\+)Escape$/.test(tecla)) return { ok:false, erro:'o Esc é reservado: larga o que estiver na mão' };
  if (proibida(tecla)) return { ok:false, erro:'“' + tecla + '” é do navegador — escolha outra' };
  const m = mapaAtalhos(salvos);
  const dono = m.porTecla[tecla];
  if (dono && dono !== id){
    const r = ATALHOS_PADRAO.find(a => a.id === dono);
    return { ok:false, erro:'“' + tecla + '” já é ' + (r ? r.rotulo.toLowerCase() : dono) };
  }
  const novo = Object.assign({}, salvos && typeof salvos === 'object' ? salvos : {});
  if (ATALHOS_PADRAO.find(a => a.id === id).tecla === tecla) delete novo[id];
  else novo[id] = tecla;
  return { ok:true, salvos:novo };
}

/* ── o que esta gravado nesta maquina ──
   Mesmo molde de toda preferencia de vista: try/catch e o padrao no codigo. Uma chave
   estragada volta como {} e o mapaAtalhos faz o resto. */
function carrega(){
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch (e) { return {}; }
}
function grava(salvos){
  try {
    if (salvos && Object.keys(salvos).length) localStorage.setItem(CHAVE, JSON.stringify(salvos));
    else localStorage.removeItem(CHAVE);
  } catch (e) {}
}

/* ── o editor (aba Atalhos das Configurações do hub) ───────────────────────────────
   No molde do "Keyboard Shortcuts" do VSCode, a pedido do usuario: a busca no topo, uma
   tabela Comando | Atalho | Quando | Origem, as teclas desenhadas como teclinhas, e a troca
   por duplo clique (ou Enter, ou o lapis) numa caixa que diz "pressione a combinacao e depois
   Enter". Os gestos do mouse entram na mesma tabela como linhas FIXAS: e a mesma pergunta
   ("como eu faco X?") e a resposta tem de estar no mesmo lugar. */
const CSS = `
.hat { position: relative; display: flex; flex-direction: column; min-height: 100%; }
.hat-topo { position: sticky; top: -16px; z-index: 2; margin: -16px -20px 0; padding: 14px 20px 10px;
  background: var(--surface); }
.hat-busca { position: relative; display: flex; align-items: center; }
.hat-busca input { flex: 1; min-width: 0; height: 30px; padding: 4px 36px 4px 10px; font: 13px var(--font);
  color: var(--text); background: var(--bg); border: 1px solid var(--edge); border-radius: var(--r-sm, 5px); }
.hat-busca input:focus { outline: none; border-color: var(--hi); }
.hat-busca input.gravando { border-color: var(--hi); box-shadow: 0 0 0 1px var(--hi); }
.hat-grava { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 26px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 4px;
  background: transparent; color: var(--text-3); cursor: pointer; }
.hat-grava:hover { color: var(--text); background: rgba(var(--tint), 0.08); }
.hat-grava[aria-pressed="true"] { color: var(--on-hi); background: var(--hi); }
.hat-grava svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.3;
  stroke-linecap: round; stroke-linejoin: round; }
.hat-info { display: flex; align-items: center; gap: 10px; margin-top: 8px; font-size: 11.5px; color: var(--text-3); }
.hat-info .btn { margin-left: auto; }
.hat-tab { margin-top: 6px; font-size: 12.5px; }
.hat-cab, .hat-l { display: grid; grid-template-columns: 22px minmax(0, 1.5fr) minmax(0, 1.25fr) 86px 84px;
  align-items: center; column-gap: 8px; min-height: 26px; padding: 0 6px 0 2px; }
.hat-cab { position: sticky; top: var(--hat-cab-top, 68px); z-index: 1; font-weight: 600; color: var(--text);
  background: var(--surface-2); border-radius: 4px 4px 0 0; box-shadow: inset 0 -1px 0 var(--line); }
.hat-l { color: var(--text); border-radius: 3px; cursor: default; outline: none;
  scroll-margin-top: calc(var(--hat-cab-top, 68px) + 30px); scroll-margin-bottom: 8px; }
.hat-l:nth-child(even) { background: rgba(var(--tint), 0.035); }
.hat-l:hover { background: rgba(var(--tint), 0.07); }
.hat-l:focus-visible, .hat-l.foco { background: rgba(var(--tint), 0.11); box-shadow: inset 0 0 0 1px var(--hi); }
.hat-l .cmd, .hat-l .qdo { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hat-l .qdo, .hat-l .org { color: var(--text-3); font-size: 11.5px; }
.hat-l.fixo .cmd { color: var(--text-2); }
.hat-l .org { display: flex; align-items: center; gap: 4px; }
.hat-l .org.usr { color: var(--hi); }
.hat-ed, .hat-rs { width: 20px; height: 20px; padding: 0; border: 0; border-radius: 4px; background: transparent;
  color: var(--text-3); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.hat-ed { visibility: hidden; }
.hat-l:hover .hat-ed, .hat-l:focus-visible .hat-ed, .hat-l.foco .hat-ed { visibility: visible; }
.hat-ed:hover, .hat-rs:hover { color: var(--text); background: rgba(var(--tint), 0.10); }
.hat-ed svg, .hat-rs svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.4;
  stroke-linecap: round; stroke-linejoin: round; }
.hat-k { display: flex; align-items: center; flex-wrap: wrap; gap: 3px; min-width: 0; }
.hat-k .mais { color: var(--text-3); font-size: 11px; }
.hat-k kbd, .hat-caixa kbd { display: inline-block; min-width: 16px; padding: 1px 6px; font: 11px/16px var(--font);
  text-align: center; color: var(--text); background: rgba(var(--tint), 0.08); border: 1px solid var(--line);
  border-bottom-color: rgba(var(--tint), 0.24); border-radius: 3px; box-shadow: inset 0 -1px 0 rgba(var(--tint), 0.10);
  white-space: nowrap; }
.hat-l.fixo .hat-k kbd { color: var(--text-2); background: transparent; }
.hat-vazio { padding: 14px 8px; font-size: 12px; color: var(--text-3); }
.hat-caixa-fundo { position: fixed; inset: 0; z-index: 90; display: grid; place-items: start center;
  padding-top: 22vh; background: rgba(0, 0, 0, 0.18); }
.hat-caixa { width: min(420px, calc(100vw - 32px)); padding: 16px 18px 14px; border-radius: var(--r-md, 8px);
  background: var(--surface); box-shadow: var(--shadow-menu); text-align: center; }
.hat-caixa .tit { font-size: 13px; color: var(--text); }
.hat-caixa .cmd { margin-top: 2px; font-size: 11.5px; color: var(--text-3); }
.hat-caixa .tecla { display: flex; justify-content: center; align-items: center; gap: 4px; min-height: 34px;
  margin-top: 12px; padding: 6px; border: 1px solid var(--hi); border-radius: var(--r-sm, 5px); background: var(--bg); }
.hat-caixa .tecla kbd { font-size: 12.5px; line-height: 20px; padding: 1px 8px; }
.hat-caixa .tecla .vaz { font-size: 12px; color: var(--text-4); }
.hat-caixa .msg { min-height: 17px; margin-top: 8px; font-size: 11.5px; color: var(--text-3); }
.hat-caixa .msg.err { color: var(--err); }
.hat-caixa .msg.ok { color: var(--ok); }
`;
function estilo(){
  if (document.getElementById('hubAtalhosCss')) return;
  const s = document.createElement('style');
  s.id = 'hubAtalhosCss';
  s.textContent = CSS;
  document.head.append(s);
}
function el(tag, cls, txt){
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
}
/* os tres icones: constantes deste arquivo, nunca entrada de usuario (innerHTML seguro) */
const ICONE = {
  lapis: '<svg viewBox="0 0 16 16"><path d="M10.8 2.7l2.5 2.5L6 12.5l-3.1.6.6-3.1z"/><path d="M9.5 4l2.5 2.5"/></svg>',
  volta: '<svg viewBox="0 0 16 16"><path d="M3.2 6.5A5 5 0 1 1 3 9.8"/><path d="M3 3v3.5h3.5"/></svg>',
  teclado: '<svg viewBox="0 0 16 16"><rect x="1.5" y="4" width="13" height="8.5" rx="1.3"/>'
    + '<path d="M4 6.6h.01M6.3 6.6h.01M8.6 6.6h.01M10.9 6.6h.01M4 9h.01M11.9 9h.01M6 10h4"/></svg>',
};
function icone(nome){ const s = el('span'); s.innerHTML = ICONE[nome]; return s.firstChild; }

/* Os gestos do mouse: fixos (o teclado le a tabela ATALHOS_PADRAO; estes o canvas trata
   direto), mas moram na mesma tabela porque respondem a mesma pergunta. */
const GESTOS = [
  { rotulo:'Selecionar',                    teclas:['Clique'] },
  { rotulo:'Pegar o fio inteiro',           teclas:['Clique duplo'] },
  { rotulo:'Somar à seleção',               teclas:['Shift', 'Clique'] },
  { rotulo:'Mover a seleção',               teclas:['Arrastar'] },
  { rotulo:'Selecionar vários',             teclas:['Arrastar no vazio'] },
  { rotulo:'Arrastar a tela',               teclas:['Botão direito', 'Arrastar'] },
  { rotulo:'Aproximar e afastar',           teclas:['Roda do mouse'] },
  { rotulo:'Largar o que estiver na mão',   teclas:['Escape'] },
];
const QUANDO = 'vista Esquema';

/* 'Ctrl+Shift+Z' -> ['Ctrl','Shift','Z']; o '+' como tecla ('Ctrl++') continua sendo uma */
function partes(t){
  if (!t) return [];
  if (t === '+') return ['+'];
  const p = String(t).split('+');
  if (t.endsWith('++')) p.splice(p.length - 2, 2, '+');
  return p.filter(x => x !== '');
}
function teclinhas(lista){
  const k = el('span', 'hat-k');
  lista.forEach((t, i) => {
    if (i) k.append(el('span', 'mais', '+'));
    k.append(el('kbd', null, t));
  });
  return k;
}
const sem = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* Desenha o editor dentro de `box`. `o.toast(texto, tipo)` e quem avisa: o hub passa o dele. */
function pane(box, o){
  const avisa = (o && o.toast) || function(){};
  estilo();
  let salvos = carrega();
  let filtro = '', gravando = false, editando = null;

  const raiz = el('div', 'hat');
  const topo = el('div', 'hat-topo');
  const bz = el('div', 'hat-busca');
  const busca = el('input');
  busca.type = 'text'; busca.autocomplete = 'off'; busca.spellcheck = false;
  busca.placeholder = 'Digite para pesquisar nos atalhos';
  busca.setAttribute('aria-label', 'Pesquisar nos atalhos');
  const grava1 = el('button', 'hat-grava');
  grava1.type = 'button';
  grava1.setAttribute('aria-pressed', 'false');
  grava1.title = 'Gravar teclas: pesquisa pela combinação que você pressionar';
  grava1.append(icone('teclado'));
  bz.append(busca, grava1);
  const info = el('div', 'hat-info');
  const conta = el('span');
  const reset = el('button', 'btn btn-ghost btn-sm', 'Restaurar o padrão');
  reset.type = 'button';
  reset.title = 'devolve todas as teclas ao padrão';
  info.append(conta, reset);
  topo.append(bz, info);

  const tab = el('div', 'hat-tab');
  tab.setAttribute('role', 'grid');
  raiz.append(topo, tab);
  box.append(raiz);
  /* O cabecalho da tabela gruda logo abaixo da busca, que tambem gruda (o -16 e o padding do
     painel do modal, que a busca come para encostar no topo). A altura so existe depois que o
     modal entra na pagina e a aba aparece -- o openConfig monta o pane solto, e ele pode nascer
     escondido --, entao quem mede e um observador, e nao o primeiro desenho. */
  const medeTopo = () => { if (topo.offsetHeight) raiz.style.setProperty('--hat-cab-top', (topo.offsetHeight - 16) + 'px'); };
  if (typeof ResizeObserver === 'function') new ResizeObserver(medeTopo).observe(topo);
  box.addEventListener('scroll', medeTopo, { passive: true });   /* so importa ao rolar: mede ali tambem */
  /* o observador nem sempre avisa quando o pane solto entra na pagina (reabrir o modal na mesma
     sessao foi medido assim): o openConfig termina de anexar na mesma tarefa, entao a proxima
     tarefa ja mede de verdade */
  setTimeout(medeTopo, 0);

  /* As teclas das linhas (setas, Enter, Delete...) nao descem para o que esta atras do modal: o
     editor de simbolos ouve o document e moveria ou apagaria o desenho da aba de baixo. O Esc
     passa, porque fechar o modal e o que ele faz em toda aba. */
  raiz.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });

  /* Outra janela do hub (Nova janela) gravou atalhos: este painel relê, senao a proxima gravacao
     daqui sobrescreveria a chave inteira com o estado velho. A escuta sai com o modal. */
  const deFora = e => {
    if (!box.isConnected){ window.removeEventListener('storage', deFora); return; }
    if (e.key === CHAVE || e.key === null){ salvos = carrega(); if (!editando) desenha(); }
  };
  window.addEventListener('storage', deFora);

  function linhas(){
    const m = mapaAtalhos(salvos);
    const out = ATALHOS_PADRAO.map(a => {
      const t = m.porAcao[a.id];
      return { id:a.id, rotulo:a.rotulo, tecla:t, teclas:partes(t), padrao:a.tecla,
               usuario:t !== a.tecla, fixo:false };
    });
    for (const g of GESTOS) out.push({ rotulo:g.rotulo, teclas:g.teclas, fixo:true });
    return out;
  }
  function passa(l){
    if (!filtro) return true;
    if (gravando) return !l.fixo && l.tecla === filtro;
    const q = sem(filtro);
    const origem = l.fixo ? 'fixo' : (l.usuario ? 'usuario' : 'padrao');
    return [l.rotulo, l.teclas.join('+'), l.teclas.join(' '), QUANDO, origem].some(x => sem(x).includes(q));
  }

  function desenha(foco){
    const todas = linhas();
    const vis = todas.filter(passa);
    tab.textContent = '';
    const cab = el('div', 'hat-cab');
    cab.setAttribute('role', 'row');
    cab.append(el('span'), el('span', null, 'Comando'), el('span', null, 'Atalho'),
               el('span', null, 'Quando'), el('span', null, 'Origem'));
    tab.append(cab);
    medeTopo();
    for (const l of vis){
      const r = el('div', 'hat-l' + (l.fixo ? ' fixo' : ''));
      r.setAttribute('role', 'row');
      const ed = el('span');
      if (!l.fixo){
        r.tabIndex = 0;
        r.dataset.id = l.id;
        const b = el('button', 'hat-ed');
        b.type = 'button'; b.tabIndex = -1;
        b.title = 'Trocar a tecla (duplo clique na linha também)';
        b.append(icone('lapis'));
        b.onclick = e => { e.stopPropagation(); edita(l); };
        ed.append(b);
      }
      const cmd = el('span', 'cmd', l.rotulo); cmd.title = l.rotulo;
      const org = el('span', 'org' + (l.usuario ? ' usr' : ''), l.fixo ? 'Fixo' : (l.usuario ? 'Usuário' : 'Padrão'));
      if (l.usuario){
        const rs = el('button', 'hat-rs');
        rs.type = 'button'; rs.tabIndex = -1;
        rs.title = 'Voltar ao padrão (' + l.padrao + ')';
        rs.append(icone('volta'));
        rs.onclick = e => { e.stopPropagation(); volta(l); };
        org.append(rs);
      }
      r.append(ed, cmd, teclinhas(l.teclas), el('span', 'qdo', QUANDO), org);
      if (!l.fixo){
        r.ondblclick = () => edita(l);
        r.onkeydown = e => {
          if (e.key === 'Enter'){ e.preventDefault(); edita(l); }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
            e.preventDefault();
            const lista = Array.from(tab.querySelectorAll('.hat-l[tabindex="0"]'));
            const i = lista.indexOf(r) + (e.key === 'ArrowDown' ? 1 : -1);
            if (lista[i]) lista[i].focus();
          }
        };
      }
      tab.append(r);
    }
    if (!vis.length) tab.append(el('div', 'hat-vazio', gravando
      ? 'Nenhum comando usa “' + filtro + '”.'
      : 'Nenhum atalho com “' + filtro + '”.'));
    const nUsr = todas.filter(l => l.usuario).length;
    conta.textContent = (vis.length === todas.length ? todas.length + ' atalhos' : vis.length + ' de ' + todas.length)
      + (nUsr ? ' · ' + nUsr + ' trocado' + (nUsr > 1 ? 's' : '') + ' por você' : '');
    /* com lixo na chave (acao que nao existe, tecla recusada) o botao continua servindo para limpar */
    reset.disabled = !nUsr && !Object.keys(salvos).length;
    if (!foco) return false;
    const r = tab.querySelector('.hat-l[data-id="' + foco + '"]');
    if (r) r.focus();
    return Boolean(r);
  }
  /* devolve o foco para a linha editada; se o filtro a escondeu, para a busca -- foco perdido no
     BODY faria o proximo Esc fechar o modal inteiro em vez de desistir da busca */
  function volta_foco(id){ if (!desenha(id)) busca.focus(); }

  function volta(l){
    const r = defineAtalho(salvos, l.id, l.padrao);
    if (!r.ok){ avisa('Não voltou ao padrão: ' + r.erro + '. Troque aquela primeiro.', 'warn'); return; }
    salvos = r.salvos; grava(salvos); volta_foco(l.id);
    avisa(l.rotulo + ' → ' + l.padrao + ' (padrão)', 'ok');
  }
  reset.onclick = () => { salvos = {}; grava(salvos); desenha(); avisa('atalhos de volta ao padrão', 'ok'); };

  /* ── a busca: texto, ou "gravar teclas" (pesquisa pela combinacao pressionada) ── */
  busca.addEventListener('input', () => { if (!gravando){ filtro = busca.value.trim(); desenha(); } });
  function modoGravar(sim){
    gravando = sim;
    grava1.setAttribute('aria-pressed', String(sim));
    busca.classList.toggle('gravando', sim);
    busca.readOnly = sim;
    busca.placeholder = sim ? 'Pressione a combinação a procurar (Esc sai)' : 'Digite para pesquisar nos atalhos';
    busca.value = ''; filtro = '';
    desenha();
    busca.focus();
  }
  grava1.onclick = () => modoGravar(!gravando);
  busca.addEventListener('keydown', e => {
    if (!gravando){
      if (e.key === 'Escape' && busca.value){ e.preventDefault(); e.stopPropagation(); busca.value = ''; filtro = ''; desenha(); }
      else if (e.key === 'ArrowDown'){ const r = tab.querySelector('.hat-l[tabindex="0"]'); if (r){ e.preventDefault(); r.focus(); } }
      return;
    }
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape'){ modoGravar(false); return; }     /* com ou sem modificador */
    const t = normalizaTecla(e);
    if (!t) return;
    busca.value = t; filtro = t; desenha();
  });

  /* ── trocar a tecla: a caixa "pressione a combinacao e depois Enter" ──
     Captura na JANELA, antes de qualquer atalho do hub: o Esc que desiste nao pode fechar o
     modal de configuracao, e a letra escolhida nao pode disparar outra coisa por baixo. */
  function edita(l){
    if (editando) return;
    let pendente = '';
    const fundo = el('div', 'hat-caixa-fundo');
    const cx = el('div', 'hat-caixa');
    cx.setAttribute('role', 'dialog');
    cx.setAttribute('aria-label', 'Trocar a tecla de ' + l.rotulo);
    const tit = el('div', 'tit', 'Pressione a combinação desejada e depois Enter');
    const cmd = el('div', 'cmd', l.rotulo + ' · agora ' + l.tecla + (l.usuario ? ' (padrão ' + l.padrao + ')' : ''));
    const visor = el('div', 'tecla');
    const msg = el('div', 'msg', 'Esc desiste');
    cx.append(tit, cmd, visor, msg);
    fundo.append(cx);
    document.body.append(fundo);
    const pinta = () => {
      visor.textContent = '';
      if (!pendente){ visor.append(el('span', 'vaz', 'aguardando…')); return; }
      visor.append(teclinhas(partes(pendente)));
      const r = pendente === l.tecla ? { ok:true } : defineAtalho(salvos, l.id, pendente);
      msg.className = 'msg ' + (r.ok ? 'ok' : 'err');
      msg.textContent = r.ok ? (pendente === l.tecla ? 'já é esta' : 'Enter grava · Esc desiste') : r.erro;
    };
    const fecha = () => {
      window.removeEventListener('keydown', tecla, true);
      fundo.remove();
      editando = null;
      volta_foco(l.id);
    };
    const tecla = ev => {
      /* o modal fechou com a caixa aberta: larga a escuta sem engolir a tecla de ninguem */
      if (!box.isConnected){ window.removeEventListener('keydown', tecla, true); fundo.remove(); editando = null; return; }
      ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
      const sozinha = !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey;
      if (ev.key === 'Escape'){ fecha(); return; }     /* com modificador tambem: Esc nao e tecla gravavel */
      if (ev.key === 'Enter' && sozinha){
        if (!pendente || pendente === l.tecla){ fecha(); return; }
        const r = defineAtalho(salvos, l.id, pendente);
        if (!r.ok){ msg.className = 'msg err'; msg.textContent = r.erro; return; }
        salvos = r.salvos; grava(salvos);
        fecha();
        avisa(l.rotulo + ' → ' + pendente, 'ok');
        return;
      }
      const t = normalizaTecla(ev);
      if (!t) return;                       /* so o modificador: continua esperando */
      pendente = t;
      pinta();
    };
    fundo.addEventListener('mousedown', e => { if (e.target === fundo) fecha(); });
    editando = l.id;
    pinta();
    window.addEventListener('keydown', tecla, true);
  }

  desenha();
}

return { CHAVE, ATALHOS_PADRAO, TECLAS_PROIBIDAS, normalizaTecla, mapaAtalhos, defineAtalho,
         carrega, grava, pane };
});
