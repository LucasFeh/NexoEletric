/* AltiumPCBMirror v2 - hub-odoobom.js — a lista de materiais do Odoo sobre o esquema.

   O caminho inverso do hub-odoolista.js. Ali o esquema vai para a fila do estoque; aqui a
   BoM da PCB no Odoo VOLTA e diz quais componentes do almoxarifado este projeto antigo
   deveria estar usando. Serve para migrar um projeto da biblioteca velha para a nova sem
   redesenhar nada.

   POR QUE ISTO E UMA TELA DE CONFERENCIA, E NAO UM BOTAO "ATUALIZAR TUDO" — tres medidas
   feitas na base real antes de escrever a primeira linha:

     a BoM nao tem DESIGNADOR. `mrp.bom.line` traz product_id, quantidade e sequencia, e
       mais nada. "Qual R e qual" nao vem do Odoo e nenhuma heuristica inventa: o que da
       para casar e o GRUPO (componentes de mesma identidade), e quem confirma e gente.
     a BoM nao cobre o esquema. Na placa medida sao 16 linhas para 21 componentes: sete
       grupos alcancados, treze sem linha nenhuma. Por isso a tela tem TRES listas e nao
       uma — sem a terceira, quem aplica ve sete migrados e conclui que a ferramenta falhou.
     empate acontece e nao se resolve no chute. "Kk 4 vias Femea" e "Kk 4 vias macho"
       pontuam igual contra o mesmo grupo, porque o comment da folha nao diz o genero.
       Desempatar por ordem escolheu a femea, que era a errada. Empate vem SEM marca.

   Erro de omissao (mandar para a mao o que daria para sugerir) custa um clique. Erro de
   comissao reescreve o componente de uma placa. A tela inteira e desenhada em cima dessa
   assimetria: nada e aplicado sem estar marcado, e o que o computador nao sabe vem em
   branco, dizendo por que.

   Autossuficiente de proposito, como o hub-odoolista.js e o hub-almoxpick.js: injeta o
   proprio CSS, o proprio botao e o proprio modal. O schframe.html so precisa da linha
   <script src="hub-odoobom.js"></script>. Quem grava no esquema e a VISTA, pela ponte
   `window.__hubAplicaVinculos` — aplicar por fora perderia o desfazer, o "Salvar *" e a
   repintura, que sao todos do commit() dela.                                            */
"use strict";

var HubOdooBom = (function () {

const ID = 'odoobom';
const CSS = `
#odoobommodal{position:fixed; inset:0; z-index:60; display:none; align-items:center;
  justify-content:center; background:rgba(0,0,0,.55);}
#odoobommodal.on{display:flex;}
#odoobommodal .ob-box{display:grid; grid-template-rows:auto auto 1fr auto; width:min(1080px,94vw);
  height:min(760px,92vh); background:var(--panel,#242424); color:var(--fg,#d8d8d8);
  border:1px solid var(--border,#3a3a3a); border-radius:6px; box-shadow:0 18px 60px rgba(0,0,0,.6);
  font:13px/1.45 "Segoe UI",sans-serif;}
#odoobommodal .ob-head{display:flex; align-items:center; gap:10px; padding:10px 14px;
  border-bottom:1px solid var(--border,#3a3a3a);}
#odoobommodal .ob-head h2{font-size:14px; font-weight:600; margin:0;}
#odoobommodal .ob-head .ob-de{font-size:11px; color:var(--fg-dim,#9a9a9a); margin-left:auto;
  font-family:Consolas,monospace;}
#odoobommodal .ob-sub{padding:8px 14px; border-bottom:1px solid var(--border,#3a3a3a);
  display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
#odoobommodal .ob-body{overflow:auto; padding:10px 14px;}
#odoobommodal .ob-foot{display:flex; align-items:center; gap:8px; padding:10px 14px;
  border-top:1px solid var(--border,#3a3a3a);}
#odoobommodal button{background:var(--panel2,#2d2d2d); color:var(--fg,#d8d8d8);
  border:1px solid var(--border,#3a3a3a); border-radius:3px; padding:5px 12px; font-size:12px;
  cursor:pointer;}
#odoobommodal button:hover:not(:disabled){border-color:var(--accent,#4fc3f7);}
#odoobommodal button:disabled{opacity:.45; cursor:not-allowed;}
#odoobommodal button.ob-ok{color:#fff; background:#0d47a1; border-color:#1565c0;}
#odoobommodal select{background:var(--panel2,#2d2d2d); color:var(--fg,#d8d8d8);
  border:1px solid var(--border,#3a3a3a); border-radius:3px; padding:4px; max-width:560px;}
#odoobommodal .ob-li{display:grid; grid-template-columns:22px 1fr 16px 1fr 88px; gap:8px;
  align-items:center; padding:6px 8px; margin:3px 0; border-radius:3px;
  background:var(--panel2,#2d2d2d); border-left:3px solid transparent;}
#odoobommodal .ob-li.alta{border-left-color:var(--ok,#00e676);}
#odoobommodal .ob-li.media{border-left-color:var(--warn,#ffd54f);}
#odoobommodal .ob-li.mao{border-left-color:var(--err,#ff5252);}
#odoobommodal .ob-li.off{opacity:.5;}
#odoobommodal .ob-nm{min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
#odoobommodal .ob-de2{font-size:11px; color:var(--fg-dim,#9a9a9a); overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap;}
#odoobommodal .ob-seta{color:var(--fg-dim,#9a9a9a); text-align:center;}
#odoobommodal .ob-conf{font-size:10px; text-transform:uppercase; letter-spacing:.06em;
  color:var(--fg-dim,#9a9a9a); text-align:right;}
#odoobommodal .ob-razao{grid-column:2 / -1; font-size:11px; color:var(--fg-dim,#9a9a9a);}
#odoobommodal .ob-razao.alerta{color:var(--warn,#ffd54f);}
#odoobommodal .ob-nota{font-size:11px; color:var(--fg-dim,#9a9a9a); margin:4px 0 10px;}
#odoobommodal .ob-aviso{padding:8px 10px; margin:6px 0; border-radius:3px; font-size:12px;
  background:rgba(255,82,82,.12); border-left:3px solid var(--err,#ff5252);}
#odoobommodal .ob-cnt{font-variant-numeric:tabular-nums;}
`;

/* ═══════════════════════ logica pura (testavel em Node) ═══════════════════════ */

/* O que um vinculo marcado vira no schematic.js. UMA funcao, porque o resto da tela e o
   `__hubAplicaVinculos` dependem de concordarem caractere a caractere sobre isto.

   `soParams` e o caminho do MULTI-PARTE: todo alias de valor do almoxarifado tem uma parte
   so, entao trocar o `sym` de um conector desenhado em 16 partes largaria 15 delas e a
   fiacao junto. Nesses, grava-se a identidade e o desenho fica como esta. */
function planoDoVinculo(sug, grupo){
  if (!sug || !grupo || !sug.componente || !grupo.refs || !grupo.refs.length) return null;
  const multi = !!grupo.multiparte;
  return {
    refs: grupo.refs.slice(),
    componente: sug.componente,
    soParams: multi,
    /* o que a linha da tela promete — e o que o resumo repete antes de aplicar */
    efeito: multi
      ? 'identidade gravada; o desenho fica (são ' + grupo.partes + ' partes)'
      : 'componente trocado por "' + sug.componente + '"',
  };
}

/* quais sugestoes nascem MARCADAS. Alta e media sim; "mao" nunca — e a regra que mantem o
   placar em zero vinculo errado aplicado. */
function marcadasDeSaida(sugestoes){
  const m = {};
  for (const s of (sugestoes || []))
    m[s.product_id] = s.confianca === 'alta' || s.confianca === 'media';
  return m;
}

function resumo(sugestoes, marcadas, porGrupo){
  let trocam = 0, soId = 0, grupos = 0;
  for (const s of (sugestoes || [])){
    if (!marcadas[s.product_id]) continue;
    grupos++;
    const g = porGrupo[s.grupo];
    if (g && g.multiparte) soId++; else trocam++;
  }
  return { grupos, trocam, soId };
}

const pure = { planoDoVinculo, marcadasDeSaida, resumo };

if (typeof module === 'object' && module.exports){ module.exports = { pure }; }
if (typeof document === 'undefined') return { pure };

/* ═══════════════════════ estado e rede ═══════════════════════ */

const ST = { aberto:false, rodando:false, projeto:'', dados:null, marcadas:{}, pcbs:[], bom:0 };
let cssPosto = false;
const $ = id => document.getElementById(id);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
                          if (x != null) n.textContent = x; return n; };

/* nunca estoura: sem servidor, rota ausente ou resposta sem JSON viram {ok:false,error} —
   o mesmo contrato do hub-odoolista.js */
async function chama(rota){
  let r;
  try { r = await fetch(rota, { cache:'no-store' }); }
  catch (e){ return { ok:false, error:'sem resposta do servidor: ' + (e && e.message) }; }
  const j = await r.json().catch(() => null);
  if (!j) return { ok:false, error:'o servidor respondeu ' + r.status + ' sem JSON' };
  return j;
}

function poeCss(){
  if (cssPosto) return;
  cssPosto = true;
  const st = el('style'); st.id = 'ob-css'; st.textContent = CSS;
  document.head.appendChild(st);
}

/* ═══════════════════════ DOM ═══════════════════════ */

function montaDom(){
  const pane = $('pane-cfg');
  if (!pane) return false;                       /* casca sem a aba: o modulo fica inerte */
  poeCss();

  const sec = el('div', 'sec'); sec.id = 'obsec';
  sec.append(el('h2', null, 'Lista de materiais do Odoo'));
  const b = el('button', 'wide'); b.id = 'btnOdooBom';
  b.title = 'Puxa a lista de materiais da PCB deste projeto no Odoo e vincula aos componentes do esquema';
  b.append(el('span', null, '↓ Vincular pela lista do Odoo'));
  b.addEventListener('click', abre);
  sec.append(b, el('div', 'hint', 'traz a BoM da placa no Odoo e diz qual componente do '
                   + 'almoxarifado cada peça do esquema deveria ser'));
  pane.append(sec);

  const m = el('div'); m.id = 'odoobommodal';
  const box = el('div', 'ob-box');
  const head = el('div', 'ob-head');
  head.append(el('h2', null, 'Lista de materiais do Odoo'), el('span', 'ob-de'));
  const fechar = el('button', null, 'Fechar'); fechar.id = 'obFechar';
  fechar.addEventListener('click', fecha);
  head.append(fechar);
  const sub = el('div', 'ob-sub');
  const body = el('div', 'ob-body');
  const foot = el('div', 'ob-foot');
  const cnt = el('span', 'ob-nota'); cnt.id = 'obResumo';
  const aplicar = el('button', 'ob-ok', 'Aplicar os marcados'); aplicar.id = 'obAplicar';
  aplicar.addEventListener('click', aplica);
  foot.append(cnt, el('span', null, ' '), aplicar);
  foot.children[1].style.flex = '1';
  box.append(head, sub, body, foot);
  m.append(box);
  m.addEventListener('click', e => { if (e.target === m && !ST.rodando) fecha(); });
  document.body.appendChild(m);
  return true;
}

function trava(v){
  ST.rodando = v;
  for (const id of ['obFechar', 'obAplicar', 'obPcb'])
    if ($(id)) $(id).disabled = v;
}

function fecha(){
  if (ST.rodando) return;
  ST.aberto = false;
  const m = $('odoobommodal'); if (m) m.classList.remove('on');
}

/* ═══════════════════════ abrir e carregar ═══════════════════════ */

async function abre(){
  if (!$('odoobommodal')) return;
  const cfg = await chama('/api/bom-odoo/config');
  if (!cfg.ok){
    await HubDialog.alert('Esta página não tem o servidor do hub por perto — a lista do Odoo '
      + 'precisa dele.\n\n' + (cfg.error || ''), { title:'Sem servidor' });
    return;
  }
  if (!cfg.temSenha){
    await HubDialog.alert('Não há senha do Odoo gravada. Configure o sincronismo do '
      + 'almoxarifado (hub, aba Biblioteca) antes de puxar a lista.', { title:'Sem credencial' });
    return;
  }
  if (!cfg.espelho){
    await HubDialog.alert('O espelho do almoxarifado (Libs\\almox-*.js) não está aqui — sem '
      + 'ele não dá para dizer qual componente cada linha da lista vira.', { title:'Sem o almoxarifado' });
    return;
  }
  ST.projeto = (window.SCH_P || '');
  ST.aberto = true; ST.dados = null; ST.marcadas = {}; ST.bom = 0;
  $('odoobommodal').classList.add('on');
  $('odoobommodal').querySelector('.ob-de').textContent = cfg.url || '';
  const body = $('odoobommodal').querySelector('.ob-body');
  body.textContent = '';
  body.append(el('p', 'ob-nota', 'procurando a placa deste projeto no Odoo…'));
  $('obResumo').textContent = '';
  $('obAplicar').disabled = true;

  trava(true);
  const r = await chama('/api/bom-odoo/pcbs?projeto=' + encodeURIComponent(ST.projeto));
  trava(false);
  if (!ST.aberto) return;
  if (!r.ok){ erroNaTela(r.error); return; }
  ST.pcbs = (r.pcbs || []).filter(p => (p.boms || []).length);
  montaSeletor(r.pcbs || []);
  if (!ST.pcbs.length){
    erroNaTela('nenhuma placa com lista de materiais no Odoo casa com "' + ST.projeto + '".');
    return;
  }
  await carregaBom(ST.pcbs[0].boms[0].id);
}

function erroNaTela(txt){
  const body = $('odoobommodal').querySelector('.ob-body');
  body.textContent = '';
  body.append(el('div', 'ob-aviso', txt || 'não deu'));
}

function montaSeletor(pcbs){
  const sub = $('odoobommodal').querySelector('.ob-sub');
  sub.textContent = '';
  if (!pcbs.length) return;
  sub.append(el('span', 'ob-de2', 'placa'));
  const sel = el('select'); sel.id = 'obPcb';
  /* TODAS as candidatas, com a "(Montada)" na frente: o nome do projeto casa com a Montada,
     a Virgem e as variantes, e ler a BoM da placa errada e o erro mais caro desta tela */
  for (const p of pcbs){
    for (const b of (p.boms || [])){
      const o = el('option', null, p.nome + '  ·  ' + b.linhas + ' linha(s)');
      o.value = String(b.id);
      sel.append(o);
    }
  }
  sel.addEventListener('change', () => carregaBom(+sel.value));
  sub.append(sel);
}

async function carregaBom(bomId){
  ST.bom = bomId;
  const body = $('odoobommodal').querySelector('.ob-body');
  body.textContent = '';
  body.append(el('p', 'ob-nota', 'lendo a lista de materiais…'));
  trava(true);
  const r = await chama('/api/bom-odoo/lista?projeto=' + encodeURIComponent(ST.projeto)
                        + '&bom=' + encodeURIComponent(bomId));
  trava(false);
  if (!ST.aberto) return;
  if (!r.ok){ erroNaTela(r.error); return; }
  ST.dados = r;
  ST.marcadas = marcadasDeSaida(r.sugestoes);
  pinta();
}

/* ═══════════════════════ pintar ═══════════════════════ */

function porGrupo(){
  const m = {};
  for (const g of ((ST.dados && ST.dados.grupos) || [])) m[g.id] = g;
  return m;
}

function pinta(){
  const d = ST.dados, gs = porGrupo();
  const body = $('odoobommodal').querySelector('.ob-body');
  body.textContent = '';

  /* SO o que casou. A tela ja teve mais duas listas — os componentes que a BoM nao menciona
     e as linhas que nao sao componente de folha — e elas respondiam a uma pergunta que
     ninguem estava fazendo aqui: quem abre este painel quer vincular o que deu, nao auditar
     o que ficou de fora. Quem precisar do resto tem a CLI (python odoobom.py), que imprime
     as tres listas; o servidor continua devolvendo `semLinha` e `descartes` no JSON para
     ela. Pedido do usuario em 2026-09-15: "o mais direta possivel, so o basico". */
  const sug = d.sugestoes || [];
  if (!sug.length){
    body.append(el('div', 'ob-nota', 'nenhuma linha desta lista casou com o esquema.'));
    atualizaRodape();
    return;
  }

  for (const s of sug){
    const g = gs[s.grupo];
    const li = el('div', 'ob-li ' + s.confianca);
    const cx = el('input'); cx.type = 'checkbox'; cx.checked = !!ST.marcadas[s.product_id];
    cx.addEventListener('change', () => { ST.marcadas[s.product_id] = cx.checked;
                                          li.classList.toggle('off', !cx.checked); atualizaRodape(); });
    li.classList.toggle('off', !cx.checked);
    li.append(cx);

    const esq = el('div', 'ob-nm');
    esq.append(el('div', null, s.nome));
    /* o multi-parte cabe em duas palavras na propria linha: antes era um paragrafo por
       componente, repetindo em cada um que alias do almoxarifado tem uma parte so */
    esq.append(el('div', 'ob-de2', (g && g.multiparte ? 'só a identidade · ' : 'vira ') + s.componente));
    li.append(esq, el('div', 'ob-seta', '→'));

    li.append(el('div', 'ob-nm', g ? g.refs.join(', ') : s.grupo));
    li.append(el('div', 'ob-conf', s.confianca === 'mao' ? 'na mão' : s.confianca));

    /* as `razoes` ("casou por OdooId; footprint bate; comment igual") sairam: elas explicam
       o passado de uma decisao que a pessoa toma olhando os dois nomes lado a lado. O AVISO
       fica, porque ele fala do futuro — e o unico texto que muda o que se marca. */
    if (s.aviso){
      const av = el('div', 'ob-razao alerta');
      av.textContent = '⚠ ' + s.aviso;
      li.append(av);
    }
    body.append(li);
  }

  atualizaRodape();
}

function atualizaRodape(){
  const r = resumo((ST.dados && ST.dados.sugestoes) || [], ST.marcadas, porGrupo());
  const total = ((ST.dados && ST.dados.sugestoes) || []).length;
  $('obResumo').textContent = r.grupos ? r.grupos + ' de ' + total + ' marcados' : 'nada marcado';
  $('obAplicar').disabled = !r.grupos || ST.rodando;
}

/* ═══════════════════════ aplicar ═══════════════════════ */

async function aplica(){
  const d = ST.dados, gs = porGrupo();
  const planos = [];
  for (const s of (d.sugestoes || [])){
    if (!ST.marcadas[s.product_id]) continue;
    const p = planoDoVinculo(s, gs[s.grupo]);
    if (p) planos.push(p);
  }
  if (!planos.length) return;

  const r = resumo(d.sugestoes, ST.marcadas, gs);
  /* duas frases, e as duas sao sobre RISCO: o footprint nao muda (a PCB roteada esta a
     salvo) e nada foi para o disco ainda. O resto do que este texto dizia esta na tela */
  const ok = await HubDialog.confirm(
    r.grupos + ' vínculo(s) vão para o esquema. O footprint não muda em nenhum.'
    + '\nNada vai para o disco agora: Ctrl+Z desfaz, e só o Salvar grava.',
    { title:'Aplicar os vínculos', ok:'Aplicar' });
  if (!ok) return;

  if (typeof window.__hubAplicaVinculos !== 'function'){
    await HubDialog.alert('Esta vista não sabe aplicar vínculos (falta __hubAplicaVinculos). '
      + 'Recarregue a página.', { title:'Não deu' });
    return;
  }
  trava(true);
  let res;
  try { res = window.__hubAplicaVinculos(planos); }
  catch (e){ res = { ok:false, erro:(e && e.message) || String(e) }; }
  trava(false);

  if (!res || !res.ok){
    erroNaTela('não apliquei nada: ' + ((res && res.erro) || '?'));
    HubDialog.toast('nenhum vínculo aplicado', 'err');
    return;
  }
  fecha();
  let msg = res.vinculos + ' vínculo(s) aplicados em ' + res.refs.length + ' componente(s) — '
          + 'Ctrl+Z desfaz, o Salvar grava.';
  if ((res.recusados || []).length) msg += ' ' + res.recusados.length + ' recusado(s).';
  HubDialog.toast(msg, 'ok', 8000);
  /* desvio de resolucao nao e detalhe: o nome gravado nao e o que a folha vai desenhar */
  for (const dv of (res.desvios || []))
    HubDialog.toast('atenção: "' + dv.sym + '" resolve para "' + dv.vira + '" (' + dv.como
      + ') — é uma escolha antiga do lib-subs.js, e ela vence o nome exato.', 'warn', 0);
  for (const rc of (res.recusados || []))
    HubDialog.toast('recusado: ' + rc.porque, 'warn', 9000);
}

/* ═══════════════════════ teclado ═══════════════════════ */

/* na BOLHA, nao na captura: os atalhos da folha moram num listener de window, que so recebe
   depois do document — entao parar aqui basta. Na captura, o mesmo stopPropagation matava o
   teclado dos campos do proprio modal. */
document.addEventListener('keydown', e => {
  if (!ST.aberto) return;
  e.stopPropagation();
  if (e.key === 'Escape' && !ST.rodando) fecha();
});

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', montaDom);
else
  montaDom();

return { pure, abre, fecha, estado: ST };
})();
