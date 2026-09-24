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

/* ── o editor (aba Atalhos das Configurações do hub) ─────────────────────────────── */
const CSS = `
.hat-lista { margin-top: 8px; display: grid; gap: 2px; }
.hat-linha { display: flex; align-items: center; gap: 10px; padding: 3px 0; }
.hat-nome { flex: 1; min-width: 0; font-size: 12.5px; color: var(--text); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.hat-tecla { min-width: 92px; height: 26px; padding: 0 10px; border-radius: var(--r-sm, 5px);
  border: 1px solid var(--edge, rgba(127,127,127,.3)); background: var(--surface-2, transparent);
  color: var(--text); font: 12px var(--mono, Consolas, monospace); cursor: pointer; }
.hat-tecla:hover { border-color: var(--hi); }
.hat-tecla.mudado { border-color: var(--hi); color: var(--hi); }
.hat-tecla.ouvindo { background: var(--hi); border-color: var(--hi); color: var(--on-hi, #111); }
.hat-acoes { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.hat-gestos kbd, .hat-rodape kbd { font: 11px var(--mono, Consolas, monospace); padding: 0 4px;
  border: 1px solid var(--edge, rgba(127,127,127,.3)); border-radius: 3px; color: var(--text-2); }
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
/* os dois textos de ajuda levam <kbd>/<b>: sao constantes deste arquivo, nunca entrada de
   usuario, entao o innerHTML nao abre porta nenhuma */
const GESTOS = 'Clique seleciona — no fio, o <b>trecho</b>; clique duplo pega o fio inteiro. '
  + 'Arraste move; arraste no vazio para selecionar vários. <kbd>Shift</kbd> soma à seleção. '
  + 'Botão direito arrasta a tela. <kbd>Esc</kbd> larga o que estiver na mão.';
const RODAPE = 'Clique na tecla e pressione a nova; <kbd>Esc</kbd> desiste. Teclas que o navegador '
  + 'leva antes da página (Ctrl+W, F5, Ctrl+R…) são recusadas. A troca vale na hora, inclusive '
  + 'para a vista Esquema que já estiver aberta.';

/* Desenha o editor dentro de `box`. `o.toast(texto, tipo)` e quem avisa: o hub passa o dele. */
function pane(box, o){
  const avisa = (o && o.toast) || function(){};
  estilo();
  let salvos = carrega();
  let ouvindo = false;

  const k1 = el('div', 'kicker', 'Vista Esquema · gestos');
  const g = el('p', 'cfgm-hint hat-gestos'); g.innerHTML = GESTOS;
  const k2 = el('div', 'kicker', 'Vista Esquema · teclas');
  const lista = el('div', 'hat-lista');
  const acoes = el('div', 'hat-acoes');
  const reset = el('button', 'btn btn-ghost btn-sm', 'Restaurar o padrão');
  reset.type = 'button';
  reset.title = 'devolve todas as teclas ao padrão';
  reset.onclick = () => { salvos = {}; grava(salvos); desenha(); avisa('atalhos de volta ao padrão', 'ok'); };
  acoes.append(reset);
  const rod = el('p', 'cfgm-hint hat-rodape'); rod.innerHTML = RODAPE;
  box.append(k1, g, k2, lista, acoes, rod);

  function desenha(){
    const m = mapaAtalhos(salvos);
    lista.textContent = '';
    for (const a of ATALHOS_PADRAO){
      const linha = el('div', 'hat-linha');
      linha.append(el('span', 'hat-nome', a.rotulo));
      const b = el('button', 'hat-tecla', m.porAcao[a.id]);
      b.type = 'button';
      b.title = m.porAcao[a.id] !== a.tecla ? 'padrão: ' + a.tecla + ' · clique e pressione a tecla nova'
                                            : 'clique e pressione a tecla nova';
      if (m.porAcao[a.id] !== a.tecla) b.classList.add('mudado');
      b.onclick = () => ouve(a, b);
      linha.append(b);
      lista.append(linha);
    }
    reset.disabled = !Object.keys(salvos).length;
  }
  /* Captura na JANELA, antes de qualquer atalho do hub: o Esc que desiste nao pode fechar o
     modal, e a letra escolhida nao pode disparar outra coisa por baixo. */
  function ouve(a, b){
    if (ouvindo) return;
    ouvindo = true;
    b.classList.add('ouvindo');
    b.textContent = 'pressione…';
    const tecla = ev => {
      /* o modal fechou com o editor ouvindo: larga a escuta sem engolir a tecla de ninguem */
      if (!box.isConnected){ window.removeEventListener('keydown', tecla, true); ouvindo = false; return; }
      ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
      const t = normalizaTecla(ev);
      if (!t) return;                       /* so o modificador: continua esperando */
      window.removeEventListener('keydown', tecla, true);
      ouvindo = false;
      if (ev.key === 'Escape'){ desenha(); return; }
      const r = defineAtalho(salvos, a.id, t);
      if (!r.ok){ avisa(r.erro, 'warn'); desenha(); return; }
      salvos = r.salvos;
      grava(salvos);
      desenha();
      avisa(a.rotulo + ' → ' + t, 'ok');
    };
    window.addEventListener('keydown', tecla, true);
  }
  desenha();
}

return { CHAVE, ATALHOS_PADRAO, TECLAS_PROIBIDAS, normalizaTecla, mapaAtalhos, defineAtalho,
         carrega, grava, pane };
});
