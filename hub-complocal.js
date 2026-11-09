/* NexoEletric - hub-complocal.js — o modal "Novo componente": a peça que o almoxarifado do Odoo ainda não tem.

   Pedido do dono (2026-11-03): criar no NexoEletric a peça que não está no almoxarifado, com a tag "criado
   localmente", com tudo o que o "Enviar para o Odoo" precisa (o bloco `componente`, os campos x_* do produto; o
   contrato é o prompt-nexoeletric-componente-novo.md). Na sincronização em que o almoxarifado já tem a peça, ela
   perde a tag e vira peça da biblioteca geral.

   O MODAL (2026-11-04, pedido do dono): "ao lado direito da barra de pesquisa, um ícone de um CI com um +; quando
   clica, abre a tela de adicionar componente, um modal, que vai aparecendo os campos em etapas, primeiro os
   obrigatórios (encap, nome, link, pinos, MPN) e depois os opcionais; salva, e ele já entra na biblioteca com a tag
   de criado local até que seja sincronizado com o Odoo" — e "o modal tem efeito de vinheta pra trocar de uma tela
   pra outra". Ele substituiu a sub-aba "Componentes novos" da Biblioteca.

   As etapas:
     1. o essencial (obrigatório): nome, MPN, encapsulamento, pinos e o link (datasheet ou página do produto);
     2. a ficha do Odoo (opcional): família, montagem, fabricante, valor, subtipo e os atributos que a família pede;
     3. símbolo e footprint (opcional): sem símbolo, o servidor desenha um retângulo com os N pinos;
     4. revisar e salvar (e, se quiser, conferir no Odoo: o di_confere_lista, que não grava nada lá).
   Salvar vale a partir da etapa 2: o que é opcional pode ficar para depois (o modal reabre pela tag da lista).

   AS REGRAS SÃO DO ODOO: as listas de família, montagem, polaridade etc., os encapsulamentos, os subtipos e o perfil
   da família vêm de /api/locais/regras. Sem o Odoo, os campos ficam livres.

   Quem grava é o servidor (tools/rotas/componentes_locais.py). Autossuficiente: o próprio CSS e os rótulos. Da casca:
   o <script src> e o botão ao lado da busca, que chama HubCompLocal.abre({aoSalvar}). */
"use strict";
var HubCompLocal = (function () {

const CSS = `
/* A CARA DO "TROCAR COMPONENTE" (pedido do dono, 2026-11-04: "tudo preto, maior"): a caixa no fundo da página (--bg), a
   14 px das bordas da janela, a sombra dos menus e o cabeçalho com o traço embaixo. Fecha só pelo × (ou Esc). */
.cl-fundo{position:fixed; inset:0; z-index:9000; display:flex; align-items:center; justify-content:center; padding:14px;
  background:var(--scrim,rgba(11,11,13,.6)); animation:cl-fade .18s ease-out;}
.cl-fundo.fecha{animation:cl-fade .16s ease-in reverse forwards;}
@keyframes cl-fade{from{opacity:0} to{opacity:1}}
.cl-modal{position:relative; width:100%; height:100%; display:flex; flex-direction:column;
  background:var(--bg,#0f0f11); color:var(--text,#d8d8d8); border-radius:var(--r-lg,14px);
  box-shadow:var(--shadow-menu,0 0 0 1px rgba(255,255,255,.16),0 16px 40px rgba(0,0,0,.65)); overflow:hidden;
  animation:cl-sobe .22s cubic-bezier(.2,.8,.2,1); font:13px/1.5 var(--font,'Segoe UI',sans-serif);}
@keyframes cl-sobe{from{opacity:0; transform:translateY(14px) scale(.98)} to{opacity:1; transform:none}}
.cl-cab{display:flex; align-items:center; gap:12px; padding:12px 18px; box-shadow:inset 0 -1px 0 var(--line,#3a3a3a);}
.cl-cab h2{flex:1; margin:0; font:500 15px var(--font,'Segoe UI',sans-serif);}
.cl-tag{font-size:10px; line-height:1.4; padding:1px 7px; border-radius:999px; white-space:nowrap;
  border:1px solid var(--hi,#4fc3f7); color:var(--hi,#4fc3f7);}
.cl-x{border:0; background:transparent; color:var(--text-3,#9a9a9a); font-size:18px; line-height:1; cursor:pointer;
  padding:4px 6px; border-radius:4px;}
.cl-x:hover{background:rgba(255,255,255,.06); color:var(--text,#d8d8d8);}
/* as etapas: pontos ligados por um traço, a da vez acesa */
.cl-passos{display:flex; align-items:center; gap:0; padding:14px max(18px, calc(50% - 470px)); box-shadow:inset 0 -1px 0 var(--line,#3a3a3a);}
.cl-passo{display:flex; align-items:center; gap:6px; border:0; background:transparent; color:var(--text-4,#7a7a7a);
  font:12px var(--font,'Segoe UI',sans-serif); padding:2px 0; cursor:pointer; white-space:nowrap;}
.cl-passo:disabled{cursor:default;}
.cl-passo .bola{width:22px; height:22px; border-radius:50%; display:grid; place-items:center; font-size:11px;
  box-shadow:inset 0 0 0 1px var(--line,#3a3a3a); transition:background .25s, box-shadow .25s, color .25s;}
.cl-passo.feito{color:var(--text-3,#9a9a9a);} .cl-passo.feito .bola{box-shadow:inset 0 0 0 1px var(--ok,#00e676); color:var(--ok,#00e676);}
.cl-passo.atual{color:var(--text,#d8d8d8);} .cl-passo.atual .bola{background:var(--hi,#4fc3f7); color:#000; box-shadow:none;}
.cl-traco{flex:1; height:1px; min-width:12px; margin:0 8px; background:var(--line,#3a3a3a);}
/* o palco: o conteúdo da etapa troca por baixo de uma vinheta (as bordas escurecem e o meio se abre de novo) */
.cl-palco{position:relative; flex:1; min-height:0; overflow:hidden;}
.cl-corpo{height:100%; overflow:auto; padding:28px max(18px, calc(50% - 470px)) 28px; box-sizing:border-box;}
.cl-corpo.sai-f{animation:cl-sai-f .2s ease-in forwards;}  .cl-corpo.entra-f{animation:cl-entra-f .28s cubic-bezier(.2,.8,.2,1);}
.cl-corpo.sai-t{animation:cl-sai-t .2s ease-in forwards;}  .cl-corpo.entra-t{animation:cl-entra-t .28s cubic-bezier(.2,.8,.2,1);}
@keyframes cl-sai-f{to{opacity:0; transform:translateX(-28px) scale(.985); filter:blur(2px)}}
@keyframes cl-entra-f{from{opacity:0; transform:translateX(28px) scale(.985); filter:blur(2px)}}
@keyframes cl-sai-t{to{opacity:0; transform:translateX(28px) scale(.985); filter:blur(2px)}}
@keyframes cl-entra-t{from{opacity:0; transform:translateX(-28px) scale(.985); filter:blur(2px)}}
.cl-vinheta{position:absolute; inset:0; pointer-events:none; opacity:0;
  background:radial-gradient(ellipse at center, transparent 0%, transparent 35%, rgba(0,0,0,.6) 100%);}
.cl-vinheta.on{animation:cl-vinheta .5s ease-in-out;}
@keyframes cl-vinheta{0%{opacity:0} 40%{opacity:1} 100%{opacity:0}}
@media (prefers-reduced-motion: reduce){
  .cl-corpo.sai-f,.cl-corpo.sai-t,.cl-corpo.entra-f,.cl-corpo.entra-t,.cl-vinheta.on,.cl-modal,.cl-fundo{animation-duration:1ms !important;}
}
.cl-etapa-t{font:500 16px var(--font,'Segoe UI',sans-serif); margin:0 0 4px;}
.cl-etapa-s{font-size:12px; color:var(--text-4,#7a7a7a); margin:0 0 20px; line-height:1.5;}
.cl-grade{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px 18px;}
.cl-campo{display:flex; flex-direction:column; gap:4px; min-width:0;}
.cl-campo > label{font-size:12px; color:var(--text-3,#9a9a9a);}
.cl-campo > label b{color:var(--warn,#ffb74d); font-weight:500;}
.cl-campo .input, .cl-campo select{width:100%; box-sizing:border-box; min-height:34px;}
.cl-campo.erro .input{box-shadow:inset 0 0 0 1px var(--err,#ff6b6b);}
.cl-campo .dica{font-size:10px; color:var(--text-4,#7a7a7a); line-height:1.4;}
.cl-larga{grid-column:1 / -1;}
.cl-aviso{font-size:11px; line-height:1.5; margin:0 0 12px; color:var(--warn,#ffb74d);}
.cl-sugs{display:flex; flex-wrap:wrap; gap:4px; margin-top:2px;}
.cl-sug{border:1px solid var(--line,#3a3a3a); background:transparent; color:var(--text-2,#b8b8b8); border-radius:999px;
  font:11px var(--font,'Segoe UI',sans-serif); padding:2px 9px; cursor:pointer; max-width:100%; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap;}
.cl-sug:hover{border-color:var(--hi,#4fc3f7); color:var(--text,#d8d8d8);}
.cl-sug[aria-pressed="true"]{border-color:var(--hi,#4fc3f7); color:var(--hi,#4fc3f7);}
/* a etapa do desenho: duas colunas, o quadro com o desenho e o seletor embaixo */
.cl-des{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:24px;}
.cl-des-col{display:flex; flex-direction:column; gap:6px; min-width:0;}
.cl-des-rot{font-size:11px; color:var(--text-3,#9a9a9a);}
.cl-quadro{width:100%; height:clamp(220px, 42vh, 460px); border-radius:8px; background:#060607; display:grid; place-items:center;
  box-shadow:inset 0 0 0 1px var(--line,#3a3a3a); overflow:hidden;}
.cl-quadro .cl-svg{width:88%; height:88%;}
.cl-quadro-vazio{font-size:11px; color:var(--text-4,#7a7a7a);}
.cl-sel{position:relative; min-width:0;}
.cl-sel-bt{display:flex; align-items:center; gap:6px; width:100%; min-height:30px; padding:4px 10px; box-sizing:border-box; cursor:pointer;
  border:1px solid var(--line,#3a3a3a); border-radius:6px; background:var(--bg-3,#1c1c1c); color:var(--text,#d8d8d8); font:inherit; text-align:left;}
.cl-sel-bt:hover, .cl-sel.aberto .cl-sel-bt{border-color:var(--hi,#4fc3f7);}
.cl-sel-bt .nm{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.cl-sel-bt .seta{color:var(--text-4,#7a7a7a); font-size:10px;}
.cl-sel-painel{margin-top:4px; border:1px solid var(--line,#3a3a3a); border-radius:6px; background:var(--bg-3,#1c1c1c); padding:6px;
  animation:cl-fade .14s ease-out;}
.cl-sel-painel .input{width:100%; box-sizing:border-box; min-height:28px; margin-bottom:6px;}
.cl-sel-lista{max-height:min(340px, 40vh); overflow:auto;}
.cl-sel-it{display:flex; align-items:center; gap:8px; width:100%; border:0; background:transparent; color:var(--text,#d8d8d8);
  padding:4px 6px; border-radius:5px; cursor:pointer; font:inherit; text-align:left;}
.cl-sel-it:hover, .cl-sel-it.foco{background:rgba(255,255,255,.06);}
.cl-sel-it[aria-selected="true"]{box-shadow:inset 2px 0 0 var(--hi,#4fc3f7);}
.cl-sel-it .th{flex:none; width:52px; height:52px; border-radius:5px; background:#060607; display:grid; place-items:center; overflow:hidden;}
.cl-sel-it .th .cl-svg{width:86%; height:86%;}
.cl-sel-it .th-vazio{font-size:12px; color:var(--text-4,#7a7a7a);}
.cl-sel-it .tx{display:flex; flex-direction:column; min-width:0;}
.cl-sel-it .tx .nm{font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.cl-sel-it .tx .mt{font-size:10px; color:var(--text-4,#7a7a7a);}
.cl-sel-it.destaque .tx .mt{color:var(--ok,#00e676);}
.cl-sel-mais{font-size:11px; color:var(--text-4,#7a7a7a); padding:6px;}
.cl-rev{display:grid; grid-template-columns:150px minmax(0,1fr); gap:5px 12px; font-size:12px;}
.cl-rev .k{color:var(--text-4,#7a7a7a);} .cl-rev .v{min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.cl-rev .v.vazio{color:var(--text-4,#7a7a7a); font-style:italic;}
.cl-conf{margin-top:14px; border:1px solid var(--line,#3a3a3a); border-radius:6px; padding:10px 12px; font-size:12px; line-height:1.5;}
.cl-conf.ok{border-color:var(--ok,#00e676);} .cl-conf.err{border-color:var(--warn,#ffb74d);}
.cl-conf ul{margin:4px 0 0 16px; padding:0;} .cl-conf li{margin:2px 0;}
.cl-conf .np{font:12px var(--mono,Consolas,monospace);}
.cl-pe{display:flex; align-items:center; gap:8px; padding:12px max(18px, calc(50% - 470px)); box-shadow:inset 0 1px 0 var(--line,#3a3a3a);}
.cl-pe .cl-apagar{color:var(--err,#ff6b6b);}
.cl-pe .cl-apagar.confirma{background:var(--err,#ff6b6b); color:#000; border-color:var(--err,#ff6b6b);}
/* a caixa de confirmar o apagar (o menu da lista chama sem abrir o modal inteiro) */
.cl-conf-apagar{width:min(440px,100%); height:auto; padding:18px 20px 14px;}
.cl-conf-apagar h3{margin:0 0 8px; font:600 14px var(--font,'Segoe UI',sans-serif); color:var(--err,#ff6b6b);}
.cl-conf-apagar p{margin:0 0 4px; font-size:12px; color:var(--text-2,#b8b8b8); word-break:break-word;}
.cl-conf-apagar .cl-pe{padding:14px 0 0; box-shadow:none;}
/* o combo (família, encapsulamento): o campo de texto com a lista do que já existe embaixo */
.cl-combo{position:relative;}
.cl-combo-lista{position:absolute; left:0; right:0; top:calc(100% + 3px); z-index:5; max-height:240px; overflow:auto;
  background:var(--surface,#1a1a1d); border-radius:6px; box-shadow:var(--shadow-menu,0 0 0 1px rgba(255,255,255,.16),0 16px 40px rgba(0,0,0,.65));
  padding:4px;}
.cl-combo-it{display:flex; align-items:baseline; gap:8px; width:100%; border:0; background:transparent; color:var(--text,#d8d8d8);
  padding:5px 8px; border-radius:4px; cursor:pointer; font:inherit; font-size:12px; text-align:left;}
.cl-combo-it:hover, .cl-combo-it.foco{background:rgba(255,255,255,.07);}
.cl-combo-it .nm{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.cl-combo-it .mt{font-size:10px; color:var(--text-4,#7a7a7a); white-space:nowrap;}
.cl-combo-sec{font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--text-4,#7a7a7a); padding:6px 8px 2px;}
.cl-pe .sep{flex:1;}
.cl-apagar.confirma{color:var(--err,#ff6b6b);}
`;

const ROT = {
  x_familia: 'Família', x_subtipo: 'Subtipo', x_montagem: 'Montagem', x_encapsulamento: 'Encapsulamento',
  x_mpn: 'MPN', x_fabricante: 'Fabricante', x_valor_txt: 'Valor', x_vias: 'Vias',
  x_polaridade: 'Polaridade', x_tensao: 'Tensão', x_potencia: 'Potência', x_corrente: 'Corrente',
  x_tolerancia: 'Tolerância', x_coeficiente: 'Coeficiente', x_dieletrico: 'Dielétrico', x_carga: 'Carga',
  x_dimensao: 'Dimensão', x_passo: 'Passo', x_genero: 'Gênero', x_angulo: 'Ângulo', x_pinos: 'Pinos',
  x_pinagem: 'Pinagem', x_designator: 'Designator',
};
const DICA = {
  x_valor_txt: '10K, 4.7K, 100nF, 16MHz, 40V', x_tensao: '50V, 6.3V', x_potencia: '1/4W, 500mW', x_corrente: '1A, 200mA',
  x_tolerancia: '1%, 20%', x_coeficiente: '100ppm', x_carga: '18pF', x_dimensao: 'D10x20mm', x_passo: 'P2.54mm',
  x_designator: 'vazio = o da família',
};
const LISTAS = ['x_familia', 'x_montagem', 'x_polaridade', 'x_dieletrico', 'x_genero', 'x_angulo'];
const PASSOS = ['Essencial', 'Ficha do Odoo', 'Símbolo e footprint', 'Revisar'];

const ST = { regras: null, regrasErro: '', opcoes: null, perfis: {} };
let M = null;        /* o modal aberto: {fundo, corpo, vinheta, passo, F, c, aoSalvar, ocupado, erros} */

const nel = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const toast = (m, t) => {
  if (typeof window.toast === 'function') return window.toast(m, t || 'info');
  if (window.HubDialog && HubDialog.toast) HubDialog.toast(m, t || 'info');
};
async function api(url, corpo){
  const req = corpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) } : undefined;
  let r, j = {};
  try { r = await fetch(url, req); } catch (e) { return { ok: false, error: 'sem servidor: ' + (e.message || e) }; }
  try { j = await r.json(); } catch (e) {}
  if (!r.ok) return Object.assign({ ok: false, error: j.error || ('HTTP ' + r.status) }, j, { ok: false });
  return j;
}
function poeCss(){
  if (document.getElementById('cl-css')) return;
  const st = nel('style'); st.id = 'cl-css'; st.textContent = CSS; document.head.append(st);
}
const reduzMov = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

/* as regras do Odoo e as opções de desenho: uma vez por sessão (o servidor tem cache de 10 min) */
async function preparo(){
  const tarefas = [];
  if (!ST.opcoes) tarefas.push(api('/api/locais/opcoes').then(o => { if (o.ok) ST.opcoes = o; }));
  if (!ST.regras && !ST.regrasErro) tarefas.push(api('/api/locais/regras').then(r => {
    if (r.ok) ST.regras = r; else ST.regrasErro = r.error || 'o Odoo não respondeu';
  }));
  await Promise.all(tarefas);
}

/* ── abrir / fechar ── */
async function abre(o){
  o = o || {};
  poeCss();
  if (M) fecha(true);
  const F = { id: '', nome: '', simbolo: '', footprint: '', link: '', componente: {}, links: [] };
  let c = null;
  if (o.id){
    const j = await api('/api/locais/' + encodeURIComponent(o.id));
    if (!j.ok) return toast('não abriu o componente: ' + j.error, 'err');
    c = j.resumo;
    const meta = j.componente.criadoLocal || {};
    const b = Object.assign({}, meta.componente || {});
    F.id = c.id; F.nome = c.nome;
    F.simbolo = c.simboloDe === 'generico' ? '' : (c.simbolo || '');
    F.footprint = c.footprint || '';
    F.link = meta.datasheet || ((b.links || [])[0] || {}).url || '';
    F.links = (b.links || []).filter(l => l.url !== F.link).map(l => ({ name: l.name, url: l.url }));
    delete b.links; delete b.footprint; delete b.imagem;
    if (c.simboloDe === 'generico') delete b.x_pinagem;
    F.componente = b;
  }
  const fundo = nel('div', 'cl-fundo');
  const modal = nel('div', 'cl-modal');
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  fundo.append(modal);
  /* clicar fora NÃO fecha (pedido do dono, 2026-11-04): só o × ou o Esc */
  M = { fundo, modal, passo: 0, F, c, aoSalvar: o.aoSalvar, ocupado: false, erros: {}, apagando: false };
  M.tecla = e => {
    /* o Esc dentro da lista aberta fecha só a lista (quem trata é o seletor) */
    const dentro = sel => !!(e.target && e.target.closest && e.target.closest(sel));
    if (e.key === 'Escape'){ if (dentro('.cl-sel.aberto, .cl-combo.aberto')) return; e.preventDefault(); e.stopPropagation(); fecha(); }
    else if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && !e.isComposing
             && !dentro('.cl-sel') && !(dentro('.cl-combo.aberto') && e.target.closest('.cl-combo').querySelector('.cl-combo-it.foco'))){
      e.preventDefault(); avanca();
    }
  };
  document.addEventListener('keydown', M.tecla, true);
  document.body.append(fundo);
  montaModal();
  preparo().then(() => { if (M && M.F === F) pintaEtapa(); });
}

function fecha(ja){
  if (!M) return;
  const m = M; M = null;
  document.removeEventListener('keydown', m.tecla, true);
  if (ja || reduzMov()) return m.fundo.remove();
  m.fundo.classList.add('fecha');
  setTimeout(() => m.fundo.remove(), 170);
}

function montaModal(){
  const { modal, c } = M;
  modal.textContent = '';
  const cab = nel('div', 'cl-cab');
  cab.append(nel('h2', null, c ? c.nome : 'Novo componente'));
  cab.append(nel('span', 'cl-tag', 'criado localmente'));
  const x = nel('button', 'cl-x', '×'); x.type = 'button'; x.title = 'Fechar (Esc)'; x.onclick = () => fecha();
  cab.append(x);
  const passos = nel('div', 'cl-passos'); M.passos = passos;
  const palco = nel('div', 'cl-palco');
  M.corpo = nel('div', 'cl-corpo');
  M.vinheta = nel('div', 'cl-vinheta');
  palco.append(M.corpo, M.vinheta);
  M.pe = nel('div', 'cl-pe');
  modal.append(cab, passos, palco, M.pe);
  pintaEtapa();
  focaPrimeiro();
}

function pintaPassos(){
  const p = M.passos; p.textContent = '';
  PASSOS.forEach((rot, i) => {
    if (i) p.append(nel('span', 'cl-traco'));
    const b = nel('button', 'cl-passo' + (i === M.passo ? ' atual' : i < M.passo ? ' feito' : ''));
    b.type = 'button';
    b.append(nel('span', 'bola', i < M.passo ? '✓' : String(i + 1)), document.createTextNode(rot));
    /* pular para a frente só depois do essencial (é ele que é obrigatório) */
    b.disabled = i === M.passo || (i > 0 && !essencialOk());
    b.onclick = () => vai(i);
    p.append(b);
  });
}

/* ── a troca de etapa: a vinheta fecha as bordas, o conteúdo sai para um lado e entra pelo outro ── */
function vai(n){
  if (!M || n === M.passo || n < 0 || n >= PASSOS.length || M.trocando) return;
  if (n > 0 && M.passo === 0 && !confereEssencial()) return;
  const frente = n > M.passo;
  if (reduzMov()){ M.passo = n; pintaEtapa(); focaPrimeiro(); return; }
  M.trocando = true;
  const corpo = M.corpo, vin = M.vinheta;
  vin.classList.remove('on'); void vin.offsetWidth; vin.classList.add('on');
  corpo.classList.remove('entra-f', 'entra-t');
  corpo.classList.add(frente ? 'sai-f' : 'sai-t');
  setTimeout(() => {
    if (!M || M.corpo !== corpo) return;
    M.passo = n;
    corpo.classList.remove('sai-f', 'sai-t');
    pintaEtapa();
    corpo.scrollTop = 0;
    corpo.classList.add(frente ? 'entra-f' : 'entra-t');
    M.trocando = false;
    focaPrimeiro();
  }, 200);
}
function avanca(){ if (M.passo < PASSOS.length - 1) vai(M.passo + 1); else salvar(false); }
function focaPrimeiro(){
  setTimeout(() => {
    if (!M) return;
    const i = M.corpo.querySelector('input:not([type=hidden]), select');
    if (i) i.focus();
  }, 30);
}

function pintaEtapa(){
  if (!M) return;
  pintaPassos();
  /* redesenhar (as regras do Odoo chegaram, a família mudou) não tira o cursor de quem está digitando */
  const ativo = document.activeElement, kAtivo = ativo && M.corpo.contains(ativo) && ativo.dataset ? ativo.dataset.k : null;
  const pos = kAtivo && typeof ativo.selectionStart === 'number' ? [ativo.selectionStart, ativo.selectionEnd] : null;
  const corpo = M.corpo; corpo.textContent = '';
  [etapaEssencial, etapaOdoo, etapaDesenho, etapaRevisar][M.passo](corpo);
  pintaPe();
  if (kAtivo){
    const i = corpo.querySelector('[data-k="' + kAtivo + '"]');
    if (i){ i.focus(); if (pos) try { i.setSelectionRange(pos[0], pos[1]); } catch (e) {} }
  }
}

function pintaPe(){
  const pe = M.pe; pe.textContent = '';
  const btn = (txt, cls, fn, tit) => { const b = nel('button', 'btn ' + cls + ' btn-sm', txt); b.type = 'button'; b.onclick = fn; if (tit) b.title = tit; b.disabled = M.ocupado; return b; };
  if (M.c){
    const a = btn(M.apagando ? 'Confirmar: apagar' : 'Apagar', 'btn-ghost cl-apagar' + (M.apagando ? ' confirma' : ''), apagar,
      'Apaga este componente local. Os esquemas que o usam ficam com o quadrado vermelho.');
    /* 1.89.0: só o administrador do Nexo Hub apaga */
    const naoAdmin = motivoSoAdmin();
    if (naoAdmin){ a.disabled = true; a.title = naoAdmin; }
    pe.append(a);
  }
  if (M.passo > 0) pe.append(btn('Voltar', 'btn-ghost', () => vai(M.passo - 1)));
  pe.append(nel('span', 'sep'));
  if (M.passo === PASSOS.length - 1){
    pe.append(btn('Salvar e conferir no Odoo', 'btn-ghost', () => salvar(true),
      'o Odoo confere a ficha com as regras do cadastro, sem gravar nada lá'));
    pe.append(btn(M.c ? 'Salvar' : 'Salvar na biblioteca', 'btn-primary', () => salvar(false)));
  } else {
    if (M.passo > 0) pe.append(btn('Salvar agora', 'btn-ghost', () => salvar(false), 'o resto é opcional: dá para completar depois'));
    pe.append(btn('Continuar', 'btn-primary', avanca));
  }
}

/* ── as etapas ── */
function titulo(corpo, t, s){ corpo.append(nel('div', 'cl-etapa-t', t)); if (s) corpo.append(nel('div', 'cl-etapa-s', s)); }

function etapaEssencial(corpo){
  const F = M.F;
  titulo(corpo, 'O essencial', 'Os cinco campos que o componente precisa para entrar na biblioteca. O resto vem nas próximas etapas, e é opcional.');
  const g = nel('div', 'cl-grade');
  g.append(campoLivre('nome', 'Nome', { obrig: true, larga: true, ph: 'Regulador LDO 3.3V, Sensor de temperatura…',
    dica: M.c ? 'é o nome gravado nos esquemas: trocar não muda os já colocados' : 'como ele aparece na biblioteca' }));
  g.append(campo('x_mpn', { obrig: true, ph: 'AMS1117-3.3' }));
  g.append(campo('x_encapsulamento', { obrig: true, ph: 'SOT-223', combo: gruposEnc }));
  g.append(campo('x_pinos', { obrig: true, tipo: 'number', ph: '3', dica: 'sem símbolo escolhido, ele ganha um com esses pinos' }));
  g.append(campoLivre('link', 'Link', { obrig: true, ph: 'https://… (datasheet ou página do produto)', tipo: 'url' }));
  corpo.append(g);
}

function etapaOdoo(corpo){
  const F = M.F;
  titulo(corpo, 'A ficha do Odoo', 'Opcional. É o que o almoxarifado usa para criar a peça quando a lista for enviada. As listas vêm do próprio Odoo.');
  if (ST.regrasErro){
    const curto = String(ST.regrasErro).split(/[:(]/)[0].trim();
    const av = nel('div', 'cl-aviso', 'Sem as regras do Odoo (' + curto + '): os campos ficam livres.');
    av.title = ST.regrasErro;
    corpo.append(av);
  }
  const fam = String(F.componente.x_familia || '').toUpperCase();
  const perfil = fam ? ST.perfis[fam] : null;
  if (fam && !perfil && !ST.regrasErro && !F.pedindoPerfil){
    F.pedindoPerfil = true;
    api('/api/locais/regras?familia=' + encodeURIComponent(fam)).then(r => {
      F.pedindoPerfil = false;
      if (r.ok && r.perfil){ ST.perfis[fam] = r.perfil; if (M && M.F === F && M.passo === 1) pintaEtapa(); }
    });
  }
  const g = nel('div', 'cl-grade');
  g.append(campo('x_familia', { combo: gruposFam, ph: 'CAPACITOR, RESISTOR, CI…', muda: () => pintaEtapa() }));
  g.append(campo('x_montagem', { lista: listaDe('x_montagem') || [['smd', 'SMD'], ['pth', 'PTH']] }));
  g.append(campo('x_fabricante'));
  g.append(campo('x_designator', { ph: 'U, Q, D…' }));
  if (!perfil || perfil.valor) g.append(campo('x_valor_txt'));
  g.append(campo('x_subtipo', { sugestoes: (ST.regras && ST.regras.subtipos || []).filter(s => !s.familia || s.familia === fam).map(s => s.nome) }));
  if (!perfil || perfil.vias) g.append(campo('x_vias', { tipo: 'number' }));
  const pols = perfil ? (perfil.polaridades || []) : null;
  if (!perfil || pols.length) g.append(campo('x_polaridade',
    { lista: pols && pols.length ? pols.map(p => Array.isArray(p) ? p : [p, String(p).toUpperCase()]) : listaDe('x_polaridade') }));
  /* os atributos só aparecem quando a família diz quais pede: atributo que ela não pede o Odoo recusa */
  for (const a of (perfil ? (perfil.atributos || []) : [])){
    const k = 'x_' + a;
    g.append(campo(k, { lista: LISTAS.indexOf(k) >= 0 ? listaDe(k) : null }));
  }
  corpo.append(g);
  if (!fam) corpo.append(nel('div', 'cl-etapa-s', 'Escolha a família para ver os atributos que ela pede.'));
}

/* A ETAPA DO DESENHO (pedido do dono, 2026-11-04): só o símbolo e o footprint, cada um com um quadrado mostrando o
   desenho e, embaixo, a lista com busca por nome e a miniatura de cada opção. */
const chave = s => String(s || '').toLowerCase().replace(/[\s_\-.]+/g, '');
function etapaDesenho(corpo){
  const F = M.F, n = parseInt(F.componente.x_pinos, 10) || 0;
  const generico = n ? 'genérico de ' + n + ' pinos' : '';
  titulo(corpo, 'Símbolo e footprint', 'Opcional. Sem símbolo, o componente ganha um retângulo com ' + (n || 'os') + ' pinos.');
  const g = nel('div', 'cl-des');

  const sims = ((ST.opcoes && ST.opcoes.simbolos) || []).slice()
    .sort((a, b) => ((b.pinos === n) - (a.pinos === n)) || a.nome.localeCompare(b.nome));
  g.append(colunaDesenho({
    tipo: 's', rotulo: 'Símbolo', valor: F.simbolo, desenho: F.simbolo || generico,
    vazio: generico ? { nome: '', rotulo: generico, desenho: generico, meta: 'o padrão, sem escolher' } : null,
    opcoes: sims.map(s => ({ nome: s.nome, desenho: s.nome, meta: s.pinos + ' pinos · ' + s.de, destaque: n && s.pinos === n })),
    aoEscolher: v => { F.simbolo = v; pintaEtapa(); },
  }));

  const enc = chave(F.componente.x_encapsulamento);
  const fps = ((ST.opcoes && ST.opcoes.footprints) || []).map(f => ({ nome: f, desenho: f, destaque: !!enc && chave(f).includes(enc) }))
    .sort((a, b) => (b.destaque - a.destaque) || a.nome.localeCompare(b.nome));
  g.append(colunaDesenho({
    tipo: 'f', rotulo: 'Footprint', valor: F.footprint, desenho: F.footprint,
    vazio: { nome: '', rotulo: 'sem footprint', desenho: '', meta: 'escolher depois' },
    opcoes: fps.map(o => Object.assign(o, { meta: o.destaque ? 'parecido com ' + F.componente.x_encapsulamento : '' })),
    aoEscolher: v => { F.footprint = v; pintaEtapa(); },
  }));
  corpo.append(g);
  if (!ST.opcoes) corpo.append(nel('div', 'cl-etapa-s', 'carregando a biblioteca…'));
}

function colunaDesenho(o){
  const col = nel('div', 'cl-des-col');
  col.append(nel('div', 'cl-des-rot', o.rotulo));
  const quadro = nel('div', 'cl-quadro');
  if (o.desenho) miniatura(quadro, o.tipo, o.desenho, true);
  else quadro.append(nel('div', 'cl-quadro-vazio', o.tipo === 'f' ? 'sem footprint' : 'sem símbolo'));
  col.append(quadro);
  col.append(seletor(o));
  return col;
}

/* o "dropbox": o botão com a escolha; aberto, a busca e a lista com miniaturas (desenhadas quando aparecem) */
function seletor(o){
  const box = nel('div', 'cl-sel');
  const atual = o.valor ? (o.opcoes.find(x => x.nome === o.valor) || { nome: o.valor, desenho: o.valor, meta: '' }) : o.vazio;
  const bt = nel('button', 'cl-sel-bt'); bt.type = 'button';
  bt.append(nel('span', 'nm', atual ? (atual.rotulo || atual.nome) : '—'), nel('span', 'seta', '▾'));
  bt.title = bt.textContent;
  const painel = nel('div', 'cl-sel-painel'); painel.hidden = true;
  const busca = nel('input', 'input'); busca.type = 'search'; busca.placeholder = 'buscar por nome…'; busca.spellcheck = false;
  const lista = nel('div', 'cl-sel-lista');
  painel.append(busca, lista);
  let vis = [], foco = 0, obs = null;
  const escolhe = x => { o.aoEscolher(x.nome); };
  const pinta = () => {
    const q = chave(busca.value);
    const todas = (o.vazio ? [o.vazio] : []).concat(o.opcoes);
    const achadas = q ? todas.filter(x => chave(x.rotulo || x.nome).includes(q)) : todas;
    vis = achadas.slice(0, 200);
    foco = Math.min(foco, Math.max(0, vis.length - 1));
    lista.textContent = '';
    if (obs) obs.disconnect();
    obs = typeof IntersectionObserver === 'function' ? new IntersectionObserver(es => {
      for (const e of es) if (e.isIntersecting){ obs.unobserve(e.target); miniatura(e.target, o.tipo, e.target.dataset.d, false); }
    }, { root: lista, rootMargin: '120px' }) : null;
    vis.forEach((x, i) => {
      const it = nel('button', 'cl-sel-it' + (x.destaque ? ' destaque' : '') + (i === foco ? ' foco' : ''));
      it.type = 'button';
      it.setAttribute('aria-selected', String((x.nome || '') === (o.valor || '')));
      const th = nel('span', 'th'); th.dataset.d = x.desenho || '';
      if (!x.desenho) th.append(nel('span', 'th-vazio', '∅'));
      else if (obs) obs.observe(th); else miniatura(th, o.tipo, x.desenho, false);
      const tx = nel('span', 'tx');
      tx.append(nel('span', 'nm', x.rotulo || x.nome));
      if (x.meta) tx.append(nel('span', 'mt', x.meta));
      it.append(th, tx);
      it.title = x.rotulo || x.nome;
      it.onclick = () => escolhe(x);
      lista.append(it);
    });
    if (achadas.length > vis.length) lista.append(nel('div', 'cl-sel-mais', 'mais ' + (achadas.length - vis.length) + ': refine a busca'));
    if (!achadas.length) lista.append(nel('div', 'cl-sel-mais', 'nada com "' + busca.value + '"'));
  };
  const abre = () => {
    painel.hidden = false; box.classList.add('aberto');
    const i = (o.vazio ? [o.vazio] : []).concat(o.opcoes).findIndex(x => (x.nome || '') === (o.valor || ''));
    foco = i > 0 && i < 200 ? i : 0;
    pinta();
    busca.focus();
    const f = lista.querySelector('.foco'); if (f) f.scrollIntoView({ block: 'nearest' });
  };
  const fechaP = () => { painel.hidden = true; box.classList.remove('aberto'); };
  bt.onclick = () => (painel.hidden ? abre() : fechaP());
  busca.oninput = () => { foco = 0; pinta(); };
  busca.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      foco = Math.max(0, Math.min(vis.length - 1, foco + (e.key === 'ArrowDown' ? 1 : -1)));
      lista.querySelectorAll('.cl-sel-it').forEach((it, i) => it.classList.toggle('foco', i === foco));
      const f = lista.querySelector('.foco'); if (f) f.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter'){ e.preventDefault(); if (vis[foco]) escolhe(vis[foco]); }
    else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); fechaP(); bt.focus(); }
  };
  box.append(bt, painel);
  return box;
}

/* ── as miniaturas: a geometria vem do servidor em lotes (/api/locais/desenhos) e vira SVG aqui ── */
const GEO = { s: new Map(), f: new Map(), fila: { s: new Set(), f: new Set() }, espera: [], timer: null };
function geometria(tipo, nome){
  if (GEO[tipo].has(nome)) return Promise.resolve(GEO[tipo].get(nome));
  return new Promise(res => {
    GEO.fila[tipo].add(nome); GEO.espera.push({ tipo, nome, res });
    if (!GEO.timer) GEO.timer = setTimeout(despacha, 30);
  });
}
async function despacha(){
  GEO.timer = null;
  const s = [...GEO.fila.s].slice(0, 80), f = [...GEO.fila.f].slice(0, 80);
  s.forEach(n => GEO.fila.s.delete(n)); f.forEach(n => GEO.fila.f.delete(n));
  const r = await api('/api/locais/desenhos', { simbolos: s, footprints: f });
  s.forEach(n => GEO.s.set(n, (r.ok && r.simbolos && r.simbolos[n]) || null));
  f.forEach(n => GEO.f.set(n, (r.ok && r.footprints && r.footprints[n]) || null));
  GEO.espera = GEO.espera.filter(w => { if (GEO[w.tipo].has(w.nome)){ w.res(GEO[w.tipo].get(w.nome)); return false; } return true; });
  if ((GEO.fila.s.size || GEO.fila.f.size) && !GEO.timer) GEO.timer = setTimeout(despacha, 0);
}
async function miniatura(host, tipo, nome, grande){
  const g = await geometria(tipo, nome);
  if (!host.isConnected && !grande) return;
  host.textContent = '';
  const svg = g ? (tipo === 's' ? svgSimbolo(g, grande) : svgFootprint(g, grande)) : null;
  if (svg) host.append(svg);
  else host.append(nel('span', grande ? 'cl-quadro-vazio' : 'th-vazio', grande ? 'sem desenho' : '?'));
}

const SVGNS = 'http://www.w3.org/2000/svg';
function sv(tag, at){ const n = document.createElementNS(SVGNS, tag); for (const k in at) n.setAttribute(k, at[k]); return n; }
const caixa = () => ({ x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity,
  add(x, y){ this.x1 = Math.min(this.x1, x); this.y1 = Math.min(this.y1, y); this.x2 = Math.max(this.x2, x); this.y2 = Math.max(this.y2, y); } });
function moldura(cx, folga){
  if (!isFinite(cx.x1)) return null;
  const w = Math.max(cx.x2 - cx.x1, 1e-6), h = Math.max(cx.y2 - cx.y1, 1e-6), m = Math.max(w, h) * folga;
  const lado = Math.max(w, h) + 2 * m;
  /* Y para cima no desenho, para baixo no SVG: o viewBox centra a caixa já com o Y trocado */
  return [(cx.x1 + cx.x2) / 2 - lado / 2, -(cx.y1 + cx.y2) / 2 - lado / 2, lado, lado].join(' ');
}
function arcoPath(cx, cy, r, sa, ea){
  let sw = ea - sa; while (sw <= 0) sw += 360;
  if (sw >= 359.9) return null;
  const p = a => [cx + r * Math.cos(a * Math.PI / 180), -(cy + r * Math.sin(a * Math.PI / 180))];
  const [x1, y1] = p(sa), [x2, y2] = p(sa + sw);
  return 'M' + x1 + ' ' + y1 + ' A' + r + ' ' + r + ' 0 ' + (sw > 180 ? 1 : 0) + ' 0 ' + x2 + ' ' + y2;
}
const DIR = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };
function svgSimbolo(partes, grande){
  const pt = (partes && partes[0]) || {};
  const cx = caixa();
  const svg = sv('svg', { class: 'cl-svg' });
  const traco = grande ? 1.6 : 1.2;
  const corpo = sv('g', { fill: 'none', stroke: 'var(--cl-sym, #c9a24a)', 'stroke-width': traco, 'vector-effect': 'non-scaling-stroke',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  for (const g of pt.graphics || []){
    let n = null;
    if (g.g === 'line'){ n = sv('line', { x1: g.x1, y1: -g.y1, x2: g.x2, y2: -g.y2 }); cx.add(g.x1, g.y1); cx.add(g.x2, g.y2); }
    else if (g.g === 'rect'){
      n = sv('rect', { x: Math.min(g.x1, g.x2), y: -Math.max(g.y1, g.y2), width: Math.abs(g.x2 - g.x1), height: Math.abs(g.y2 - g.y1) });
      if (g.solid) n.setAttribute('fill', 'rgba(201,162,74,.12)');
      cx.add(g.x1, g.y1); cx.add(g.x2, g.y2);
    } else if (g.g === 'arc'){
      const d = arcoPath(g.cx, g.cy, g.r, g.sa, g.ea);
      n = d ? sv('path', { d }) : sv('circle', { cx: g.cx, cy: -g.cy, r: g.r });
      cx.add(g.cx - g.r, g.cy - g.r); cx.add(g.cx + g.r, g.cy + g.r);
    } else if (g.g === 'ellipse'){
      n = sv('ellipse', { cx: g.cx, cy: -g.cy, rx: g.rx, ry: g.ry || g.rx }); if (g.solid) n.setAttribute('fill', 'rgba(201,162,74,.12)');
      cx.add(g.cx - g.rx, g.cy - (g.ry || g.rx)); cx.add(g.cx + g.rx, g.cy + (g.ry || g.rx));
    } else if ((g.g === 'poly' || g.g === 'polyline') && Array.isArray(g.pts)){
      n = sv(g.g === 'poly' ? 'polygon' : 'polyline', { points: g.pts.map(p => p[0] + ',' + -p[1]).join(' ') });
      if (g.g === 'poly' && g.solid) n.setAttribute('fill', 'var(--cl-sym, #c9a24a)');
      g.pts.forEach(p => cx.add(p[0], p[1]));
    }
    if (n) corpo.append(n);
  }
  const pinos = sv('g', { stroke: 'var(--cl-pin, #9aa3ad)', 'stroke-width': traco, 'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round' });
  const nums = [];
  for (const p of pt.pins || []){
    const d = DIR[((p.orient % 360) + 360) % 360] || [1, 0], len = p.len || 0;
    const x2 = p.x + d[0] * len, y2 = p.y + d[1] * len;
    pinos.append(sv('line', { x1: p.x, y1: -p.y, x2, y2: -y2 }));
    cx.add(p.x, p.y); cx.add(x2, y2);
    if (grande) nums.push([p, x2, y2, d]);
  }
  const vb = moldura(cx, 0.08);
  if (!vb) return null;
  svg.setAttribute('viewBox', vb);
  svg.append(corpo, pinos);
  if (grande && nums.length <= 64){
    const lado = parseFloat(vb.split(' ')[2]), fs = lado / 22;
    for (const [p, x2, y2, d] of nums){
      const t = sv('text', { x: (p.x + x2) / 2, y: -((p.y + y2) / 2) - fs * 0.35, 'font-size': fs, 'text-anchor': 'middle',
        fill: 'var(--text-4, #7a7a7a)', 'font-family': 'Segoe UI, sans-serif' });
      if (d[0] === 0){ t.setAttribute('x', (p.x + x2) / 2 - fs * 0.4); t.setAttribute('y', -((p.y + y2) / 2) + fs * 0.35); t.setAttribute('text-anchor', 'end'); }
      t.textContent = p.num; svg.append(t);
    }
  }
  return svg;
}
function svgFootprint(fp, grande){
  const cx = caixa();
  const svg = sv('svg', { class: 'cl-svg' });
  const cobre = sv('g', {});
  for (const p of fp.pads || []){
    const w = p.w || 0, h = p.h || w, rot = -(p.rot || 0);
    const cor = p.type === 'th' ? 'var(--cl-th, #c8a23c)' : p.layer === 'Bottom' ? 'var(--cl-bot, #3c78c8)' : 'var(--cl-top, #c83c3c)';
    const g = sv('g', { transform: 'translate(' + p.x + ' ' + -p.y + ') rotate(' + rot + ')' });
    let n;
    if (p.shape === 'circle') n = sv('circle', { cx: 0, cy: 0, r: Math.max(w, h) / 2 });
    else {
      const r = p.shape === 'oval' ? Math.min(w, h) / 2 : p.shape === 'roundrect' ? Math.min(w, h) * 0.25 : 0;
      n = sv('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: r, ry: r });
    }
    n.setAttribute('fill', cor);
    g.append(n);
    if (p.type === 'th' && p.drill) g.append(sv('circle', { cx: 0, cy: 0, r: p.drill / 2, fill: '#0b0b0b' }));
    cobre.append(g);
    const ext = Math.max(w, h) / 2;
    cx.add(p.x - ext, p.y - ext); cx.add(p.x + ext, p.y + ext);
  }
  const silk = sv('g', { fill: 'none', stroke: 'var(--cl-silk, #e8e3c8)', 'stroke-linecap': 'round' });
  for (const s of fp.silk || []){
    let n = null;
    if (s.kind === 'line'){ n = sv('line', { x1: s.x1, y1: -s.y1, x2: s.x2, y2: -s.y2 }); cx.add(s.x1, s.y1); cx.add(s.x2, s.y2); }
    else if (s.kind === 'arc'){
      const d = arcoPath(s.cx, s.cy, s.r, s.sa, s.ea);
      n = d ? sv('path', { d }) : sv('circle', { cx: s.cx, cy: -s.cy, r: s.r });
      cx.add(s.cx - s.r, s.cy - s.r); cx.add(s.cx + s.r, s.cy + s.r);
    }
    if (n){ n.setAttribute('stroke-width', Math.max(s.w || 0.15, 0.08)); silk.append(n); }
  }
  const vb = moldura(cx, 0.1);
  if (!vb) return null;
  svg.setAttribute('viewBox', vb);
  svg.append(cobre, silk);
  if (grande){
    const lado = parseFloat(vb.split(' ')[2]), fs = lado / 26;
    for (const p of (fp.pads || []).slice(0, 80)){
      const t = sv('text', { x: p.x, y: -p.y + fs * 0.35, 'font-size': fs, 'text-anchor': 'middle', fill: '#fff', 'font-family': 'Segoe UI, sans-serif' });
      t.textContent = p.name || ''; svg.append(t);
    }
  }
  return svg;
}

function etapaRevisar(corpo){
  const F = M.F, b = F.componente;
  titulo(corpo, 'Revisar', 'Salvo, ele entra na biblioteca com a tag "criado localmente" até o almoxarifado do Odoo ter a peça.');
  const r = nel('div', 'cl-rev');
  const n = parseInt(b.x_pinos, 10) || 0;
  const linhas = [['Nome', F.nome], ['MPN', b.x_mpn], ['Encapsulamento', b.x_encapsulamento], ['Pinos', b.x_pinos], ['Link', F.link],
    ['Família', b.x_familia], ['Montagem', (b.x_montagem || '').toUpperCase()], ['Fabricante', b.x_fabricante], ['Valor', b.x_valor_txt],
    ['Símbolo', F.simbolo || (n ? 'genérico de ' + n + ' pinos' : '')], ['Footprint', F.footprint]];
  for (const k of Object.keys(b)) if (/^x_/.test(k) && ['x_mpn', 'x_encapsulamento', 'x_pinos', 'x_familia', 'x_montagem', 'x_fabricante', 'x_valor_txt'].indexOf(k) < 0 && b[k] !== '' && b[k] != null)
    linhas.push([ROT[k] || k, b[k]]);
  for (const [k, v] of linhas){
    r.append(nel('div', 'k', k));
    const vv = nel('div', 'v' + (v === '' || v == null ? ' vazio' : ''), v === '' || v == null ? '—' : String(v));
    vv.title = vv.textContent;
    r.append(vv);
  }
  corpo.append(r);
  if (M.c && M.c.conferencia) corpo.append(caixaConferencia(M.c.conferencia));
}

function caixaConferencia(cf){
  const box = nel('div', 'cl-conf ' + (cf.pronto ? 'ok' : 'err'));
  box.append(nel('div', null, (cf.pronto ? '✓ Pronto para o Odoo' : cf.jaExiste ? 'O Odoo já tem esta peça' : '✗ Ainda não está pronto')
    + (cf.em ? ' · conferido em ' + cf.em : '')));
  if (cf.nome_previsto){
    const np = nel('div'); np.append(document.createTextNode('Nome no Odoo: '), nel('span', 'np', cf.nome_previsto));
    box.append(np);
  }
  const lista = (rot, xs) => { if (!xs || !xs.length) return; box.append(nel('div', null, rot)); const ul = nel('ul'); for (const x of xs) ul.append(nel('li', null, x)); box.append(ul); };
  lista('Faltas:', cf.faltas); lista('Erros:', cf.erros); lista('Avisos:', cf.avisos);
  return box;
}

/* ── os campos ── */
function listaDe(k){
  const l = ST.regras && ST.regras.listas && ST.regras.listas[k];
  return l && l.length ? l : null;
}
function encDe(mont){
  const e = ST.regras && ST.regras.encapsulamentos && ST.regras.encapsulamentos[String(mont || '').toLowerCase()];
  return (e || []).map(x => Array.isArray(x) ? x[0] : (x && (x.name || x.nome)) || String(x));
}
function encTodos(){
  const m = String(M.F.componente.x_montagem || '').toLowerCase();
  const l = m ? encDe(m) : encDe('smd').concat(encDe('pth'));
  return [...new Set(l)];
}
const valorDe = (k) => k.startsWith('x_') ? M.F.componente[k] : M.F[k];
function poeValor(k, v){ if (k.startsWith('x_')) M.F.componente[k] = v; else M.F[k] = v; delete M.erros[k]; }
function campo(k, o){ return campoGenerico(k, ROT[k] || k, Object.assign({ dica: DICA[k] }, o || {})); }
function campoLivre(k, rot, o){ return campoGenerico(k, rot, o || {}); }
let nDl = 0;
function campoGenerico(k, rot, o){
  const d = nel('div', 'cl-campo' + (o.larga ? ' cl-larga' : '') + (M.erros[k] ? ' erro' : ''));
  const lab = nel('label', null, rot); if (o.obrig) lab.append(document.createTextNode(' '), nel('b', null, '*'));
  d.append(lab);
  let i;
  if (o.lista){
    i = nel('select', 'input');
    const vazio = nel('option', null, '—'); vazio.value = ''; i.append(vazio);
    for (const par of o.lista){ const op = nel('option', null, String(par[1] != null ? par[1] : par[0])); op.value = String(par[0]); i.append(op); }
    const v = valorDe(k) == null ? '' : String(valorDe(k));
    const achou = o.lista.find(p => String(p[0]).toLowerCase() === v.toLowerCase());
    if (v && !achou){ const op = nel('option', null, v + ' (fora da lista)'); op.value = v; i.append(op); }
    i.value = achou ? String(achou[0]) : v;
    i.onchange = () => { poeValor(k, i.value); if (o.muda) o.muda(); };
  } else {
    i = nel('input', 'input'); i.type = o.tipo || 'text'; i.spellcheck = false;
    if (o.tipo === 'number'){ i.min = '1'; i.step = '1'; }
    i.value = valorDe(k) == null ? '' : valorDe(k);
    if (o.ph) i.placeholder = o.ph;
    i.dataset.k = k;
    i.oninput = e => { poeValor(k, e.target.value); d.classList.remove('erro'); if (M.passo === 0) pintaPassos(); };
    if (o.combo){
      d.append(combo(i, k, o.combo, o.muda));     /* o combo embrulha o campo */
      i = null;
    } else if (o.sugestoes && o.sugestoes.length){
      const dl = nel('datalist'); dl.id = 'cl-dl-' + (++nDl);
      for (const s of o.sugestoes.slice(0, 5000)){ const op = nel('option'); op.value = s; dl.append(op); }
      i.setAttribute('list', dl.id); d.append(dl);
    }
  }
  if (i) d.append(i);
  if (M.erros[k]) d.append(nel('div', 'dica', M.erros[k]));
  else if (o.dica) d.append(nel('div', 'dica', o.dica));
  if (o.chips && o.chips.length){
    const sg = nel('div', 'cl-sugs');
    for (const s of o.chips){
      const b = nel('button', 'cl-sug', s); b.type = 'button'; b.title = s;
      b.setAttribute('aria-pressed', String(valorDe(k) === s));
      b.onclick = () => { poeValor(k, valorDe(k) === s ? '' : s); pintaEtapa(); };
      sg.append(b);
    }
    d.append(sg);
  }
  return d;
}

/* O COMBO (família e encapsulamento): o campo continua livre, e embaixo dele abre a lista do que JÁ EXISTE — na
   biblioteca (com quantos componentes usam) e no cadastro do Odoo —, filtrada pelo que se digita. Setas e Enter
   escolhem; Esc fecha só a lista. `grupos` = [{titulo, itens:[{v, rot?, meta?}]}] (uma função, para ler na hora). */
function combo(i, k, grupos, muda){
  const w = nel('div', 'cl-combo');
  const lista = nel('div', 'cl-combo-lista'); lista.hidden = true;
  w.append(i, lista);
  let vis = [], foco = -1;
  const escolhe = it => {
    i.value = it.v; poeValor(k, it.v); fecha();
    if (muda) i.blur();        /* o redesenho do muda não reabre a lista */
    w.closest('.cl-campo') && w.closest('.cl-campo').classList.remove('erro');
    if (M.passo === 0) pintaPassos();
    if (muda) muda();
  };
  const pinta = () => {
    const q = chave(i.value);
    lista.textContent = ''; vis = [];
    const vistos = new Set();
    for (const g of (typeof grupos === 'function' ? grupos() : grupos)){
      const its = g.itens.filter(it => {
        const c = chave(it.v);
        if (vistos.has(c)) return false;
        return !q || c.includes(q) || chave(it.rot).includes(q);
      }).slice(0, 80);
      if (!its.length) continue;
      lista.append(nel('div', 'cl-combo-sec', g.titulo));
      for (const it of its){
        vistos.add(chave(it.v));
        const b = nel('button', 'cl-combo-it'); b.type = 'button'; b.tabIndex = -1;
        b.append(nel('span', 'nm', it.rot || it.v));
        if (it.meta) b.append(nel('span', 'mt', it.meta));
        b.onmousedown = e => { e.preventDefault(); escolhe(it); };
        vis.push({ it, b });
        lista.append(b);
      }
    }
    foco = -1;
    lista.hidden = !vis.length;
    w.classList.toggle('aberto', !lista.hidden);
  };
  const fecha = () => { lista.hidden = true; w.classList.remove('aberto'); };
  const marca = () => vis.forEach((x, n) => { x.b.classList.toggle('foco', n === foco); if (n === foco) x.b.scrollIntoView({ block: 'nearest' }); });
  i.addEventListener('focus', pinta);
  i.addEventListener('mousedown', () => { if (lista.hidden) setTimeout(pinta, 0); });
  i.addEventListener('input', pinta);
  i.addEventListener('blur', () => setTimeout(fecha, 120));
  if (muda) i.addEventListener('change', muda);
  i.addEventListener('keydown', e => {
    if (lista.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      foco = Math.max(0, Math.min(vis.length - 1, foco + (e.key === 'ArrowDown' ? 1 : -1))); marca();
    } else if (e.key === 'Enter' && foco >= 0){ e.preventDefault(); escolhe(vis[foco].it); }
    else if (e.key === 'Escape'){ e.preventDefault(); fecha(); }
  });
  return w;
}
const usos = n => n + (n === 1 ? ' componente' : ' componentes');
function gruposEnc(){
  const bib = ((ST.opcoes && ST.opcoes.encapsulamentos) || []).map(e => ({ v: e.nome, meta: usos(e.usos) }));
  return [{ titulo: 'na biblioteca', itens: bib }, { titulo: 'no cadastro do Odoo', itens: encTodos().map(v => ({ v })) }];
}
function gruposFam(){
  const bib = ((ST.opcoes && ST.opcoes.familias) || []).map(f => ({ v: f.nome, meta: usos(f.usos) }));
  const odoo = (listaDe('x_familia') || []).map(p => ({ v: String(p[0]), rot: String(p[1] != null ? p[1] : p[0]) }));
  return [{ titulo: 'na biblioteca', itens: bib }, { titulo: 'no cadastro do Odoo', itens: odoo }];
}

/* o essencial: os cinco obrigatórios */
function errosEssencial(){
  const F = M.F, b = F.componente, e = {};
  if (!String(F.nome || '').trim()) e.nome = 'dê um nome';
  if (!String(b.x_mpn || '').trim()) e.x_mpn = 'o código do fabricante';
  if (!String(b.x_encapsulamento || '').trim()) e.x_encapsulamento = 'o pacote (NA quando não houver)';
  const n = Number(b.x_pinos);
  if (!(Number.isInteger(n) && n > 0 && n <= 400)) e.x_pinos = 'um número inteiro de 1 a 400';
  if (!/^https?:\/\/\S+\.\S+/i.test(String(F.link || '').trim())) e.link = 'o endereço completo, com https://';
  return e;
}
const essencialOk = () => !Object.keys(errosEssencial()).length;
function confereEssencial(){
  const e = errosEssencial();
  if (!Object.keys(e).length) return true;
  M.erros = e;
  if (M.passo !== 0){ M.passo = 0; }
  pintaEtapa();
  const p = M.corpo.querySelector('.cl-campo.erro input, .cl-campo.erro select'); if (p) p.focus();
  return false;
}

function nomeDoLink(url){
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').split('.');
    const base = h.length > 2 && h[h.length - 2].length <= 3 ? h[h.length - 3] : h[h.length - 2] || h[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch (e) { return 'Link'; }
}

async function salvar(conferir){
  if (!M || M.ocupado) return;
  if (!confereEssencial()) return;
  const F = M.F, c = M.c;
  const comp = {};
  for (const [k, v] of Object.entries(F.componente)) if (v !== '' && v != null) comp[k] = typeof v === 'string' ? v.trim() : v;
  comp.x_pinos = parseInt(comp.x_pinos, 10);
  const link = String(F.link).trim();
  const links = [{ name: nomeDoLink(link), url: link }].concat(F.links.filter(l => l.name && l.url && l.url !== link));
  comp.links = links;
  const corpo = { componente: comp, simbolo: String(F.simbolo || '').trim(), footprint: String(F.footprint || '').trim(), datasheet: link };
  if (F.id) corpo.id = F.id;
  if (!c || F.nome.trim() !== c.nome) corpo.nome = F.nome.trim();
  M.ocupado = true; pintaPe();
  const r = await api('/api/locais', corpo);
  if (!M){ return; }
  M.ocupado = false;
  if (!r.ok){ pintaPe(); return toast('não gravou: ' + r.error, 'err'); }
  (r.avisos || []).filter(a => !/sem x_mpn/.test(a)).forEach(a => toast(a, 'warn'));
  let res = r.componente;
  if (conferir){
    M.ocupado = true; pintaPe();
    toast('conferindo no Odoo…', 'info');
    const cf = await api('/api/locais/' + encodeURIComponent(res.id) + '/conferir', {});
    if (!M) return;
    M.ocupado = false;
    if (!cf.ok){ toast('salvo; o Odoo não conferiu: ' + cf.error, 'warn'); }
    else {
      res = cf.componente || res;
      if (!cf.conferencia.pronto){
        /* fica aberto na revisão, com o que o Odoo apontou */
        M.c = res; M.F.id = res.id; M.F.nome = res.nome; M.passo = PASSOS.length - 1; montaModal();
        toast('salvo; o Odoo apontou o que falta', 'warn');
        if (M.aoSalvar) M.aoSalvar(res);
        return;
      }
      toast('salvo e pronto para o Odoo', 'ok');
    }
  } else toast(c ? 'componente salvo' : 'componente criado na biblioteca', 'ok');
  const fn = M.aoSalvar;
  fecha();
  if (fn) fn(res);
}

/* 1.89.0: só o administrador do Nexo Hub apaga da biblioteca ('' = pode; hub-equipe.js » motivoSoAdmin) */
const motivoSoAdmin = () => { try { const E = (typeof window !== 'undefined' && window.HubEquipe) || null; return E && E.motivoSoAdmin ? E.motivoSoAdmin() : ''; } catch (_) { return ''; } };
async function apagar(){
  if (!M || !M.c || M.ocupado) return;
  if (motivoSoAdmin()) return toast(motivoSoAdmin(), 'warn');
  if (!M.apagando){ M.apagando = true; pintaPe(); setTimeout(() => { if (M && M.apagando){ M.apagando = false; pintaPe(); } }, 4000); return; }
  M.ocupado = true; pintaPe();
  const r = await api('/api/locais/' + encodeURIComponent(M.c.id) + '/apagar', {});
  if (!M) return;
  M.ocupado = false;
  if (!r.ok){ M.apagando = false; pintaPe(); return toast('não apagou: ' + r.error, 'err'); }
  toast('componente local apagado', 'ok');
  const fn = M.aoSalvar;
  fecha();
  if (fn) fn(null);
}

/* APAGAR SEM ABRIR O MODAL (o menu do clique direito na lista): a caixa de confirmar, na cara do modal. Só usa o
   POST de apagar, então funciona mesmo quando a ficha não abre. `aoSalvar(null)` recarrega a lista. */
function confirmaApagar(o){
  if (motivoSoAdmin()) return toast(motivoSoAdmin(), 'warn');
  poeCss();
  if (M) fecha(true);
  const fundo = nel('div', 'cl-fundo');
  const caixa = nel('div', 'cl-modal cl-conf-apagar');
  caixa.setAttribute('role', 'alertdialog'); caixa.setAttribute('aria-modal', 'true');
  caixa.append(nel('h3', null, 'Apagar componente local'));
  caixa.append(nel('p', null, '"' + (o.nome || o.id) + '" sai da biblioteca.'));
  caixa.append(nel('p', null, 'Os esquemas que já usam este componente ficam com o quadrado vermelho no lugar dele.'));
  const pe = nel('div', 'cl-pe');
  const nao = nel('button', 'btn btn-ghost btn-sm', 'Cancelar'); nao.type = 'button';
  const sim = nel('button', 'btn btn-sm cl-apagar confirma', 'Apagar'); sim.type = 'button';
  pe.append(nel('span', 'sep'), nao, sim);
  caixa.append(pe);
  fundo.append(caixa);
  const sai = () => { document.removeEventListener('keydown', tecla, true); fundo.remove(); };
  const tecla = e => { if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); sai(); } };
  document.addEventListener('keydown', tecla, true);
  nao.onclick = sai;
  sim.onclick = async () => {
    sim.disabled = nao.disabled = true; sim.textContent = 'Apagando…';
    const r = await api('/api/locais/' + encodeURIComponent(o.id) + '/apagar', {});
    if (!r.ok){ sim.disabled = nao.disabled = false; sim.textContent = 'Apagar'; return toast('não apagou: ' + r.error, 'err'); }
    sai();
    toast('componente local apagado', 'ok');
    if (o.aoSalvar) o.aoSalvar(null);
  };
  document.body.append(fundo);
  nao.focus();
}

return { abre, fecha, confirmaApagar, estado: ST, _errosEssencial: () => M ? errosEssencial() : null };
})();
if (typeof module === 'object' && module.exports) module.exports = HubCompLocal;
