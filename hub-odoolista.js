/* AltiumPCBMirror v2 - hub-odoolista.js — "Enviar para o Odoo" na vista Esquema.

   Monta a lista de componentes do projeto e a manda para a fila de aprovacao do Odoo
   (modelo di.lista.altium). A lista NAO entra no inventario quando chega: alguem do
   estoque confere e decide, e so na aprovacao nascem a PCB e a BoM.

   Este arquivo e autossuficiente de proposito — injeta o proprio CSS, o proprio botao e o
   proprio modal, como o hub-dialog.js faz. O schframe.html so precisa da linha
   <script src="hub-odoolista.js"></script>, e nada da casca de outro dono muda.

   Quem monta o payload e resolve o product_id e o SERVIDOR (odoolista.py), lendo o
   schematic.js do disco. Nao e aqui: a lista tem que sair do arquivo salvo, e a senha do
   Odoo nunca pode chegar ao navegador.                                                  */
"use strict";
var HubOdooLista = (function () {

/* No tema do hub: --panel, --fg, --border... sao os nomes da vista Esquema, que a ponte do
   schframe.html aponta para os tokens do hub-tema.css; fundo do modal, sombra e fonte sao os
   tokens da casca direto. A cor depois da virgula e o escuro antigo, para pagina sem tokens. */
const CSS = `
#odoomodal{position:fixed; inset:0; z-index:60; display:none; background:var(--scrim,rgba(11,11,13,.62));}
#odoomodal.on{display:flex;}
/* sem borda: o contorno e o anel do --shadow-menu, como no .dialog da casca */
#odoomodal .od-box{position:absolute; inset:14px; display:grid; grid-template-rows:auto 1fr auto;
  background:var(--panel,#242424); border-radius:var(--r-md,8px);
  box-shadow:var(--shadow-menu, 0 0 0 1px #3a3a3a, 0 22px 60px rgba(0,0,0,.62)); overflow:hidden; min-height:0;}
#odoomodal .od-head{display:flex; align-items:center; gap:10px; padding:11px 13px;
  border-bottom:1px solid var(--border,#3a3a3a); background:var(--panel2,#2d2d2d);}
#odoomodal .od-head h2{font-size:13px; font-weight:600; margin:0; letter-spacing:-.01em;}
#odoomodal .od-head .alvo{font-size:11px; color:var(--fg-dim,#9a9a9a); flex:1;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
#odoomodal .od-head button{padding:2px 8px;}
#odoomodal .od-body{overflow:auto; min-height:0; padding:0 13px;}
#odoomodal .od-bar{display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 0 8px;
  position:sticky; top:0; background:var(--panel,#242424); z-index:1;}
#odoomodal label{font-size:11px; color:var(--fg-dim,#9a9a9a); display:flex; align-items:center; gap:6px;}
#odoomodal input[type=text]{background:var(--panel2,#2d2d2d); color:var(--fg,#d8d8d8); font:inherit;
  border:1px solid var(--border,#3a3a3a); border-radius:3px; padding:3px 7px;}
#odoomodal input:focus-visible{outline:2px solid var(--accent,#4fc3f7); outline-offset:1px;}
#odoomodal .od-obs{flex:1; min-width:150px;}
#odoomodal .od-tot{font-size:11px; color:var(--fg-dim,#9a9a9a); margin-left:auto;}
#odoomodal .od-aviso{font-size:11px; padding:7px 9px; border-radius:4px; margin-bottom:8px;
  border:1px solid var(--border,#3a3a3a); border-left:3px solid var(--warn,#ffd54f);
  background:var(--panel2,#2d2d2d); white-space:pre-wrap;}
#odoomodal .od-aviso.err{border-left-color:var(--err,#ff5252);}
#odoomodal .od-aviso.ok{border-left-color:var(--ok,#00e676);}
/* a coluna do nome tem teto: sem ele, numa tela larga o nome estica e joga a quantidade
   para longe da peca a que ela pertence. A folga sobra para a resolucao, que e texto longo.

   AS FAIXAS SAO EM PX, e isso nao e gosto. Elas eram 17em/8em/11em/12em, e o em se
   resolve contra a fonte do PROPRIO container da grade: o cabecalho tinha font-size:10px e
   as linhas herdavam 13px, entao o mesmo 12em valia 120px la e 156px aqui. As colunas
   sairam desalinhadas a partir da terceira, com a deriva crescendo ate 144px na ultima —
   medido no Chrome. Em px as duas fileiras resolvem igual, e a fonte menor do cabecalho
   passou a morar nos FILHOS, para nunca mais mexer na largura das faixas. */
#odoomodal .od-row{display:grid; gap:9px; align-items:baseline; padding:5px 4px;
  grid-template-columns:150px minmax(0,221px) 104px 143px 156px 44px minmax(0,1fr);
  border-bottom:1px solid var(--border,#3a3a3a);}
#odoomodal .od-row.hd{position:sticky; top:42px; background:var(--panel,#242424); z-index:1;
  letter-spacing:.09em; text-transform:uppercase; color:var(--fg-dim,#9a9a9a);}
#odoomodal .od-row.hd > *{font-size:10px;}
#odoomodal .od-row .des{font:11px/1.4 var(--mono,Consolas,ui-monospace,monospace); color:var(--fg,#d8d8d8);
  overflow:hidden; text-overflow:ellipsis;}
#odoomodal .od-row .nm{font-size:12px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
#odoomodal .od-row .qt{font-size:12px; text-align:right; font-variant-numeric:tabular-nums;}
/* a resolucao virou faixa: o texto (que elipsa) mais o botao de resolver, que so aparece
   na linha com problema. O botao mora AQUI, e nao numa coluna propria, porque uma coluna a
   mais encolheria todas as outras em toda linha para servir a algumas. */
#odoomodal .od-row .rs{display:flex; align-items:baseline; gap:7px; min-width:0;
  font-size:11px; color:var(--ok,#00e676);}
#odoomodal .od-row .rs .rst{overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
#odoomodal .od-row .rs.pend{color:var(--warn,#ffd54f);}
#odoomodal .od-row .rs .od-fix{flex:none; font-size:10px; line-height:1.5; padding:0 8px;
  border-radius:3px; background:var(--panel2,#2d2d2d); color:var(--fg,#d8d8d8);
  border:1px solid var(--border,#3a3a3a); cursor:pointer;}
#odoomodal .od-row .rs .od-fix:hover{border-color:var(--accent,#4fc3f7);}
/* a barra do que foi resolvido e ainda nao foi salvo: a lista sai do DISCO, entao ate o
   Salvar ela nao mostra o conserto — dizer isso e o que impede o "resolvi e nao mudou" */
#odoomodal .od-aviso.od-pend{border-left-color:var(--accent,#4fc3f7); display:flex;
  align-items:center; gap:10px; flex-wrap:wrap;}
#odoomodal .od-row .vl, #odoomodal .od-row .en, #odoomodal .od-row .ac{font-size:11px;
  color:var(--fg-dim,#9a9a9a); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
/* Fora dos dois almoxarifados e o que PRECISA MUDAR, e por isso e a unica coisa vermelha
   da linha: a resolucao ja usa verde e amarelo, e um terceiro alarme na mesma cor se
   perderia no meio deles. */
#odoomodal .od-row .ac.fora{color:var(--err,#ff5252);}
/* o cabecalho nao e uma linha resolvida: nao pode herdar o verde do .rs */
#odoomodal .od-row.hd .des, #odoomodal .od-row.hd .nm, #odoomodal .od-row.hd .vl,
#odoomodal .od-row.hd .en, #odoomodal .od-row.hd .ac,
#odoomodal .od-row.hd .qt, #odoomodal .od-row.hd .rs{color:inherit; font:inherit; font-size:10px;}
#odoomodal .od-foot{display:flex; align-items:center; gap:9px; padding:10px 13px;
  border-top:1px solid var(--border,#3a3a3a); background:var(--panel2,#2d2d2d);}
#odoomodal .od-foot .est{flex:1; font-size:11px; color:var(--fg-dim,#9a9a9a);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
/* o Enviar e o .btn-primary da casca: contornado no destaque do tema, nunca preenchido */
#odoomodal .od-foot button.pri{background:transparent; border-color:var(--hi,#4fc3f7); color:var(--hi,#4fc3f7);}
#odoomodal .od-foot button.pri:hover:not(:disabled){background:rgba(var(--tint,79,195,247),.10);}
`;

const $ = id => document.getElementById(id);
function el(tag, cls, text){
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const temServidor = () => !!(window.HubIO && HubIO.canPost);
const temDestino = () => !!(ST.destino && ST.destino.temSenha);
const proj = () => (typeof SCH_P === 'string' && SCH_P) || '';

/* getJson/postJson nunca estouram: devolvem {ok:false,error}, para a tela nunca ficar com um
   botao morto e nenhuma explicacao. */
async function chama(rota, corpo){
  try {
    const o = corpo === undefined
      ? { cache: 'no-store' }
      : { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo) };
    const r = await fetch(rota, o);
    const j = await r.json().catch(() => null);
    if (j && typeof j === 'object') return j;
    return { ok: false, error: 'o servidor respondeu ' + r.status + ' sem JSON' };
  } catch (e) {
    return { ok: false, error: 'sem resposta do servidor: ' + (e && e.message || e) };
  }
}

/* ------------------------------- estado da tela ------------------------------- */

const ST = {
  previa: null, aplicados: [],
  aberto: false, rodando: false,
  conferido: null,      /* o payload que o SERVIDOR montou no ultimo ensaio */
  reciboLocal: null,    /* o ultimo envio, lido de Projects/<p>/odoo-lista.json */
  destino: null,        /* url/db/login/temSenha */
};

/* A resolucao tem dois estados e a tela precisa distinguir, senao o projetista envia
   achando que esta resolvido: palpite local (o que o espelho do almoxarifado sabe) e
   veredito do Odoo (o que di_confere_lista respondeu). */
function resolucaoDe(linha, pendencia){
  if (pendencia) return { txt: pendencia.motivo || 'pendente', pend: true };
  if (linha.product_id) return { txt: 'produto ' + linha.product_id + ' · ' + (linha._como || ''), pend: false };
  if (linha.mpn) return { txt: 'MPN ' + linha.mpn + (linha.encapsulamento ? ' · ' + linha.encapsulamento : ''), pend: false };
  return { txt: linha._como || 'sem vinculo com o cadastro', pend: true };
}

function pintaLista(payload, recibo){
  const box = $('odooLista');
  box.textContent = '';

  const avisos = [];
  if (payload && payload._sem_designador && payload._sem_designador.length){
    avisos.push(['', payload._sem_designador.length + ' componente(s) fora da lista por nao terem '
      + 'designador anotado (' + payload._sem_designador.join(', ') + '). Anote no Altium antes de enviar.']);
  }
  if (payload && payload._sem_valor){
    avisos.push(['', payload._sem_valor + ' linha(s) juntam componentes cujo VALOR não está no '
      + 'espelho — o comment do Altium é fórmula não resolvida e o componente não traz '
      + 'parâmetro de identidade. Um "RES [SMD]" de quantidade 24 pode ser quatro resistores '
      + 'diferentes. Rode o ExportProject de novo (ele agora traz os parâmetros) ou confira '
      + 'essas linhas peça a peça antes de aprovar.']);
  }
  if (recibo && recibo.linhas_pendentes){
    avisos.push(['', recibo.linhas_pendentes + ' de ' + recibo.total_linhas + ' linha(s) sem produto no Odoo. '
      + 'A fila aceita assim mesmo, mas a lista so pode ser APROVADA quando toda linha apontar '
      + 'para um produto — a peca provavelmente precisa ser cadastrada la, nao inventada aqui.']);
  } else if (recibo){
    avisos.push(['ok', 'As ' + recibo.total_linhas + ' linha(s) resolveram. O Odoo reconheceu todos os produtos.']);
  }
  for (const [k, t] of avisos) box.append(el('div', 'od-aviso' + (k ? ' ' + k : ''), t));

  const hd = el('div', 'od-row hd');
  hd.append(el('span', 'des', 'designadores'), el('span', 'nm', 'nome'),
            el('span', 'vl', 'valor'), el('span', 'en', 'encapsulamento'),
            el('span', 'ac', 'acervo'),
            el('span', 'qt', 'qtd'), el('span', 'rs', 'resolução'));
  box.append(hd);

  const porDes = new Map();
  for (const p of (recibo && recibo.pendencias) || []) porDes.set(p.designadores, p);

  for (const ln of (payload && payload.linhas) || []){
    const r = resolucaoDe(ln, porDes.get(ln.designadores));
    const row = el('div', 'od-row');
    const rs = el('span', 'rs' + (r.pend ? ' pend' : ''));
    const rst = el('span', 'rst', r.txt); rst.title = r.txt;
    rs.append(rst);
    /* a linha que resolveu leva a ficha do produto: o product_id é a variante, e o
       hub-odoolink a traduz para o template, que é o que a URL do Odoo quer */
    if (ln.product_id && typeof HubOdooLink !== 'undefined'){
      const lk = HubOdooLink.link(HubOdooLink.tmplDoProduto(ln.product_id),
                                  { nome: ln.nome_altium || ('produto ' + ln.product_id) });
      if (lk) rs.append(lk);
    }
    /* so na linha com problema, e so quando esta vista sabe abrir o seletor: o painel roda
       dentro do schframe, mas a lista vem do disco e pode citar componente de outra folha */
    if (r.pend && typeof window.__hubResolveParaLista === 'function'){
      const b = el('button', 'od-fix', 'resolver');
      b.title = 'escolher o componente do almoxarifado para ' + ln.designadores;
      b.onclick = () => resolveLinha(ln);
      rs.append(b);
    }
    const nm = el('span', 'nm', ln.nome_altium || '');
    nm.title = (ln.nome_altium || '') + (ln.footprint ? '\n' + ln.footprint : '');
    /* Valor e encapsulamento saem em toda linha, inclusive nas que nao resolveram: sao
       elas que mais precisam ser lidas por quem confere. Traço = o espelho nao sabe,
       que e diferente de vazio. */
    const vl = el('span', 'vl', ln._valor || '—'); vl.title = ln._valor || '';
    const en = el('span', 'en', ln._encapsulamento || '—'); en.title = ln._encapsulamento || '';
    const ac = el('span', 'ac' + (ln._acervo ? '' : ' fora'), ln._acervo || 'fora do almoxarifado');
    ac.title = ln._acervo
      || 'o componente não está em almox-basicos.js nem em almox-especiais.js — troque por um '
       + 'componente do almoxarifado para a linha poder ser aprovada';
    row.append(el('span', 'des', ln.designadores), nm, vl, en, ac,
               el('span', 'qt', String(ln.quantidade)), rs);
    box.append(row);
  }

  const n = ((payload && payload.linhas) || []).length;
  const pecas = ((payload && payload.linhas) || []).reduce((a, l) => a + l.quantidade, 0);
  $('odooTot').textContent = n ? n + ' linha(s) · ' + pecas + ' peça(s)' : '';
}

function trava(v){
  ST.rodando = v;
  $('odooEnviar').disabled = v || !ST.conferido;
  $('odooRev').disabled = v;
  /* o X junto: fechado no meio da conferencia, o resultado chegava numa tela invisivel e
     a pessoa ficava sem toast, sem hint e sem saber se algo aconteceu */
  $('odooFechar').disabled = v;
}

function estadoTxt(t){ $('odooEstado').textContent = t || ''; }

function descRecibo(r){
  if (!r) return '';
  return (r.referencia || '(sem referência)') + ' · ' + (r.estado || '?')
       + (r.revisao ? ' · rev ' + r.revisao : '')
       + (r.enviado_em ? ' · ' + r.enviado_em : '');
}

/* ------------------------------- a previa (sem Odoo) ------------------------------- */

/* A lista sai do esquema salvo e do espelho do almoxarifado — sem rede, sem credencial e
   sem espera. E a resposta para "o que eu vou mandar?", que a tela tem de ter ANTES de
   qualquer round-trip. O ensaio vem logo atras, sozinho, e pinta por cima o que o Odoo
   respondeu — sao duas perguntas diferentes, e so a segunda custa rede. */
async function previa(){
  estadoTxt('montando a lista do esquema salvo…');
  const j = await chama('/api/lista/previa', corpo());
  if (!j.ok){
    ST.previa = null;
    pintaLista(null, null);
    estadoTxt('');
    $('odooLista').prepend(el('div', 'od-aviso err', j.error || 'não deu para montar a lista'));
    return;
  }
  /* a revisao do palpite so entra em campo VAZIO: o que o projetista digitou manda */
  if (!$('odooRev').value.trim() && j.revisaoUsada) $('odooRev').value = j.revisaoUsada;
  ST.previa = j.payload;
  ST.conferido = null;
  ST.aplicados = [];
  $('odooEnviar').disabled = true;
  pintaLista(j.payload, null);
  estadoTxt('lista montada do esquema salvo');
}

/* Resolver uma linha e escolher o componente do almoxarifado para os designadores dela. O
   seletor e o MESMO da vista Esquema; quem grava e a ponte __hubAplicaVinculos, a mesma do
   painel da BoM — sym, comment e params (com OdooId) de uma vez, pela mesma funcao. */
function resolveLinha(ln){
  const refs = String(ln.designadores || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!refs.length) return;
  const modal = $('odoomodal');
  modal.classList.remove('on');            // o seletor tem z-index menor que este painel
  const volta = () => { if (ST.aberto) modal.classList.add('on'); };
  const ok = window.__hubResolveParaLista(refs, info => {
    ST.aplicados.push(info);
    ST.conferido = null;
    $('odooEnviar').disabled = true;
    pintaPendentes();
  }, volta);
  if (!ok){
    volta();
    HubDialog.toast(refs.join(', ') + ' não está na folha aberta — abra a folha em que ele mora '
      + 'para poder resolver por aqui', 'warn', 7000);
  }
}

/* O conserto existe no esquema em memoria, e a lista vem do DISCO: enquanto nao salvar, a
   tela continua mostrando o problema. Dizer isso na cara e o que evita o "resolvi tres e
   nada mudou" — e o botao faz as duas coisas numa tacada. */
function pintaPendentes(){
  if (!ST.aplicados.length) return;
  let bar = $('odooPend');
  if (!bar){ bar = el('div', 'od-aviso od-pend'); bar.id = 'odooPend'; $('odooLista').prepend(bar); }
  bar.textContent = '';
  const quantos = ST.aplicados.length;
  bar.append(el('span', null, quantos + (quantos === 1 ? ' vínculo aplicado' : ' vínculos aplicados')
    + ' no esquema, ainda sem salvar. A lista é montada do arquivo salvo.'));
  const b = el('button', null, 'Salvar e atualizar a lista');
  b.onclick = async () => {
    b.disabled = true;
    const ok = await garanteSalvo();
    b.disabled = false;
    if (!ok) return;
    ST.aplicados = [];
    await previa();
  };
  bar.append(b);
}

/* ------------------------------- as duas acoes ------------------------------- */

function corpo(extra){
  return Object.assign({
    projeto: proj(),
    revisao: $('odooRev').value.trim(),
    observacao: $('odooObs').value.trim(),
    enviado_por: (ST.destino && ST.destino.login || '').split('@')[0],
  }, extra || {});
}

/* O ENSAIO DEIXOU DE SER UM BOTAO. Ele nunca foi uma decisao — era sempre "sim, confira" —,
   e cobrar o clique so adiava a unica informacao que a tela tem a dar. Agora ele roda
   sozinho, logo depois da previa: a lista aparece na hora (montada aqui) e em seguida se
   pinta com o que o Odoo respondeu. O que o ensaio garante continua igual: nada e gravado,
   e o uid_externo e a contagem que o /envio confere saem DELE, nao do que a tela imagina.

   Falhar aqui nao apaga a lista — ela veio da previa e continua valendo. So o Enviar fica
   de fora, com o motivo escrito. */
async function conferir(){
  if (!temDestino()){
    estadoTxt('lista montada do esquema salvo — sem senha do Odoo');
    $('odooLista').prepend(el('div', 'od-aviso',
      'Não há senha do Odoo gravada, então a lista não foi conferida e o Enviar está fora. '
      + 'Abra Configuração » Projeto » Envio da lista para o Odoo e preencha usuário e senha '
      + '(a tela só grava a partir desta máquina). No servidor, a alternativa é ODOO_SENHA no '
      + 'ambiente, uma linha em /etc/altiumhub/senha.env. Resolver as linhas aqui continua '
      + 'funcionando: isso é o esquema, não o Odoo.'));
    return;
  }
  ST.conferido = null;
  estadoTxt('conferindo no Odoo…');
  const j = await chama('/api/lista/ensaio', corpo());
  if (!ST.aberto) return;
  if (!j.ok){
    estadoTxt('a lista acima é a do esquema; o Odoo não respondeu');
    $('odooLista').prepend(el('div', 'od-aviso err',
      (j.error || 'falhou') + ' — dá para resolver as linhas mesmo assim; o Enviar volta quando o Odoo responder.'));
    return;
  }
  ST.conferido = j.payload;
  pintaLista(j.payload, j.recibo);
  if (ST.aplicados.length) pintaPendentes();
  estadoTxt('conferido no Odoo · nada foi gravado · ' + j.uid_externo);
  $('odooEnviar').disabled = ST.aplicados.length > 0;
}

/* a revisao mudou: remonta e reconfere, na ordem */
async function recarrega(){
  if (!ST.aberto || ST.rodando) return;
  await previa();
  await conferir();
}

async function enviar(){
  if (!ST.conferido) return;
  const r = ST.conferido, n = r.linhas.length;
  /* o estado de ANTES do POST: e ele que diz se a recusa que voltar e nova ou a de sempre.
     Tem de ser lido aqui, porque ST.reciboLocal e sobrescrito com o recibo novo la embaixo. */
  const estadoAntes = (ST.reciboLocal && ST.reciboLocal.estado) || '';
  const loc = ST.reciboLocal;
  /* Aviso, nao trava: se esta revisao ja foi decidida, o modulo do Odoo ignora o reenvio.
     Dizer isso ANTES do clique e o que faltava — a tela so descobria depois, porque o ensaio
     sempre volta com estado 'ensaio' e o Enviar fica habilitado. O botao continua habilitado
     de proposito: mandar assim mesmo e decisao de quem envia. */
  const jaDecidida = loc && (loc.estado === 'recusada' || loc.estado === 'aprovada')
                     && (loc.revisao || '') === (r.revisao || '');
  const semRev = !String(r.revisao || '').trim();
  const ok = await HubDialog.confirm(
    'Enviar ' + n + ' linha(s) de "' + r.projeto
    + (semRev ? '" (sem revisão)' : ' rev ' + r.revisao + '"') + ' para a fila de '
    + 'aprovação do Odoo?\n\nA lista não entra no estoque agora: alguém do almoxarifado '
    + 'confere e decide. Enquanto ninguém decidiu, reenviar a mesma revisão substitui as '
    + 'linhas.'
    + (jaDecidida ? '\n\nEsta revisão já foi ' + loc.estado + ' no Odoo. Pelo comportamento '
       + 'de hoje do módulo de lá, um reenvio dela não altera nada — mas o envio é seu: dá '
       + 'para mandar assim mesmo.' : '')
    + (semRev ? '\n\nSem revisão, todos os envios sem revisão deste projeto dividem um '
       + 'registro só no Odoo.' : ''),
    { title: 'Enviar lista', ok: 'Enviar' });
  if (!ok) return;

  trava(true);
  estadoTxt('enviando…');
  /* uid e contagem do ENSAIO viajam junto: o servidor releem o schematic.js do disco no
     envio, e se a revisao ou o arquivo mudaram no meio ele recusa com 409 em vez de mandar
     para o Odoo uma lista que ninguem conferiu */
  const j = await chama('/api/lista/envio', corpo({
    confirmado: true, uid_externo: r.uid_externo, total_linhas: n }));
  trava(false);
  if (!j.ok){
    estadoTxt('');
    $('odooLista').prepend(el('div', 'od-aviso err', j.error || 'falhou'));
    HubDialog.toast(j.error || 'o envio falhou', 'err');
    if (j.confiraDeNovo){ ST.conferido = null; $('odooEnviar').disabled = true; }
    return;
  }
  const rec = j.recibo || {};
  /* o recibo manda na revisao: o que o Odoo gravou e a verdade, nao o que estava na tela */
  ST.reciboLocal = Object.assign({}, rec, { revisao: rec.revisao || r.revisao,
                                            uid_externo: j.uid_externo });
  ST.conferido = j.payload || ST.conferido;
  pintaLista(ST.conferido, rec);
  estadoTxt(descRecibo(ST.reciboLocal));
  atualizaBotao();
  const d = desfechoDoEnvio(rec, estadoAntes);
  if (d.tipo === 'recusa-nova' && d.titulo){
    await HubDialog.alert(d.texto, { title: d.titulo, danger: true });
  } else {
    HubDialog.toast(d.texto, d.tom, d.ms);
  }
}

/* O DESFECHO DO ENVIO — pura de proposito, porque foi aqui que morava o defeito e regra
   que se testa nao volta. tests/test-odoolista-desfecho.js.

   O ERRO ERA A ORDEM. `estado === 'recusada'` vinha antes de `gravou === false`, e um uid ja
   decidido volta com os DOIS ao mesmo tempo (a spec, tabela de di_recebe_lista). Entao todo
   reenvio de uma lista recusada — que nao altera nada no Odoo — abria o modal vermelho
   bloqueante com o motivo VELHO, como se a recusa tivesse acabado de acontecer. O ramo
   honesto ("ja foi decidida, nada mudou") era inalcancavel. Foi o que fez o DMB, recusado
   uma vez, cobrar para sempre.

   A raiz: o codigo lia o ESTADO devolvido como se fosse um EVENTO. Recusa e evento quando o
   estado MUDOU — e por isso `estadoAntes` entra aqui. O caminho irmao (atualizaEstado) ja
   fazia essa comparacao; o do envio tinha esquecido dela. */
function desfechoDoEnvio(rec, estadoAntes){
  rec = rec || {};
  const ref = rec.referencia || 'a lista';
  /* 1o: o Odoo nao mexeu em nada. Vem ANTES da recusa porque uma lista decidida volta com
     estado E gravou:false juntos. Sem ordem nenhuma de trocar revisao: repetir, abrir outra
     ou pedir reabertura no Odoo e decisao de quem envia. */
  if (rec.gravou === false){
    return { tipo: 'nada-mudou', titulo: '', tom: 'warn', ms: 8000,
             texto: ref + ' já está ' + (rec.estado || 'decidida') + ' no Odoo — este envio '
                    + 'não alterou nada lá.' };
  }
  /* 2o: recusa NOVA (o estado mudou nesta ida). Modal so com motivo escrito; recusa sem
     motivo e normal e nao vira interrogatorio. */
  if (rec.estado === 'recusada' && rec.estado !== estadoAntes){
    return rec.motivo_recusa
      ? { tipo: 'recusa-nova', titulo: 'Lista recusada', tom: 'warn', ms: 8000,
          texto: ref + ' foi recusada.\n\n' + rec.motivo_recusa }
      : { tipo: 'recusa-nova', titulo: '', tom: 'warn', ms: 8000,
          texto: ref + ' foi recusada.' };
  }
  return { tipo: 'ok', titulo: '', tom: 'ok', ms: 0,
           texto: (rec.referencia || 'lista') + ' — ' + (rec.estado || 'recebida')
                  + (rec.linhas_pendentes ? ' · ' + rec.linhas_pendentes + ' pendência(s)' : '') };
}

/* ------------------------------- abrir e fechar ------------------------------- */

function fecha(){ ST.aberto = false; $('odoomodal').classList.remove('on'); }

/* O esquema aberto e o do disco? A lista sai do arquivo SALVO — quem monta e o servidor,
   lendo Projects/<p>/schematic.js. Mandar com alteracao pendente mandaria uma lista que
   nem o disco nem o Altium tem. */
async function garanteSalvo(){
  if (!(window.__hubDirty && window.__hubDirty())) return true;
  const ok = await HubDialog.confirm(
    'O esquema tem alterações não salvas. A lista é montada a partir do schematic.js '
    + 'gravado em disco, então ela sairia sem essas alterações.',
    { title: 'alterações pendentes', ok: 'Salvar e continuar' });
  if (!ok) return false;
  const btn = $('btnSave');
  if (!btn) return false;
  /* reusa o caminho de gravacao do schframe (btnSave) em vez de reimplementar: ele releem o
     disco, pergunta se alguem gravou por cima e sabe cair no download quando o POST falha.
     Por isso a espera e generosa — pode haver um modal DELE esperando resposta no meio. */
  btn.click();
  for (let i = 0; i < 300 && window.__hubDirty(); i++)
    await new Promise(r => setTimeout(r, 100));
  if (window.__hubDirty()){
    await HubDialog.alert('O esquema ainda tem alterações pendentes, então o envio não '
      + 'seguiu. Salve e clique em Enviar para o Odoo de novo.',
      { title: 'ainda não salvou' });
    return false;
  }
  return true;
}

async function abre(){
  if (!temServidor()){
    await HubDialog.alert('Sem servidor: abra o hub por hubserver.py para enviar a lista.',
      { title: 'não dá para enviar' });
    return;
  }
  if (!(await garanteSalvo())) return;

  const cfg = await chama('/api/lista/config');
  ST.destino = (cfg.ok && cfg.config) || null;
  if (!ST.destino){
    await HubDialog.alert(cfg.error || 'o servidor não respondeu sobre o Odoo.',
      { title: 'sem destino' });
    return;
  }
  const r = await chama('/api/lista/recibo?projeto=' + encodeURIComponent(proj()));
  ST.reciboLocal = (r.ok && r.recibo) || null;
  ST.conferido = null;
  await atualizaEstado();

  /* "A" e o comeco de tudo que nunca foi enviado — pedido do usuario. O palpite do nome da
     pasta saiu do caminho: ele acertava 3 de 16 e, quando errava, errava em silencio (o
     "_P2" de uma pasta e variante, nao revisao). O que vence "A" e so o que JA foi enviado
     deste projeto: reenviar a mesma revisao substitui as linhas enquanto ninguem decidiu. */
  $('odooRev').value = (ST.reciboLocal && ST.reciboLocal.revisao) || 'A';
  $('odooObs').value = '';
  $('odooAlvo').textContent = ST.destino.db + ' em ' + ST.destino.url
    + ' · ' + (ST.destino.login || '');
  $('odooAlvo').title = 'senha lida de ' + (ST.destino.fonteSenha || '?');
  $('odooEnviar').disabled = true;
  estadoTxt(ST.reciboLocal ? 'último envio: ' + descRecibo(ST.reciboLocal)
                           : 'nenhum envio deste projeto ainda');
  pintaLista(null, null);

  ST.aberto = true;
  $('odoomodal').classList.add('on');
  /* depois de abrir, nao antes: a tela aparece na hora, a lista chega em seguida (montada
     aqui, sem rede) e por ultimo o Odoo pinta o que respondeu. Nenhum dos tres passos pede
     clique — o unico botao que sobrou e o que grava de verdade. */
  await previa();
  await conferir();
  $('odooRev').focus();
  $('odooRev').select();
}

/* O disco so guarda o estado do momento do envio. Quem decide e uma pessoa no Odoo, depois
   — entao um envio ainda nao decidido precisa ser perguntado, senao uma lista RECUSADA
   aparece aqui como "recebida" para sempre e o motivo que a pessoa do estoque escreveu (a
   spec, secao 8.4, pede justamente que ele volte para o projetista) nunca chega.

   RECUSADA NAO E TERMINAL do nosso lado (2026-09-17). Ela estava aqui, e com isso o disco
   congelava o projeto: recusado uma vez, a tela nunca mais perguntava o estado e nunca mais
   via uma reabertura feita no Odoo. Aprovada continua terminal — dali nao se voltea. */
const DECIDIDO = { aprovada: 1 };

async function atualizaEstado(){
  const loc = ST.reciboLocal;
  if (!loc || !loc.uid_externo || DECIDIDO[loc.estado]) return;
  const j = await chama('/api/lista/estado', { projeto: proj(), revisao: loc.revisao || '' });
  if (!j.ok || !j.recibo) return;              /* Odoo fora do ar nao pode travar o modal */
  ST.reciboLocal = Object.assign({}, loc, j.recibo);
  atualizaBotao();
  if (j.recibo.estado === 'recusada' && j.recibo.estado !== loc.estado){
    /* recusa sem motivo e NORMAL — quem recusa nao deve satisfacao. Modal so quando ha
       texto para ler (a spec, 8.4, pede que o motivo chegue ao projetista); sem texto, o
       aviso e um toast e acabou. E nao se manda mais "corrija e mande com revisao nova":
       o que enviar depois e decisao de quem envia. */
    const ref = j.recibo.referencia || 'a lista';
    if (j.recibo.motivo_recusa){
      await HubDialog.alert(ref + ' foi recusada.\n\n' + j.recibo.motivo_recusa,
        { title: 'Lista recusada', danger: true });
    } else {
      HubDialog.toast(ref + ' foi recusada.', 'warn', 8000);
    }
  } else if (j.recibo.estado === 'aprovada' && j.recibo.estado !== loc.estado){
    HubDialog.toast((j.recibo.referencia || 'a lista') + ' foi aprovada — virou a placa '
      + (j.recibo.produto_id || '?') + ' com BoM ' + (j.recibo.bom_id || '?'), 'ok', 8000);
  }
}

/* ------------------------------- o botao no painel ------------------------------- */

function atualizaBotao(){
  const b = $('btnOdooLista'), h = $('odooHint');
  if (!b) return;
  b.disabled = !temServidor();
  if (!temServidor()){ h.textContent = 'sem servidor — abra o hub por hubserver.py'; return; }
  h.textContent = ST.reciboLocal ? 'último envio: ' + descRecibo(ST.reciboLocal)
                                 : 'monta a lista de componentes e manda para a fila do estoque';
}

function montaDom(){
  const st = el('style'); st.textContent = CSS; document.head.appendChild(st);

  /* o botao: no #odoolista se a casca deu o ancora, senao no fim da aba Configuracoes */
  let sec = $('odoolista');
  if (!sec){
    const pane = $('pane-cfg');
    if (!pane) return false;
    sec = el('div', 'sec'); sec.id = 'odoolista';
    pane.appendChild(sec);
  }
  sec.append(el('h2', null, 'Odoo'));
  const b = el('button', 'wide'); b.id = 'btnOdooLista';
  b.title = 'Monta a lista de componentes do esquema e manda para a fila de aprovação do Odoo';
  b.append(el('span', null, '↗ Enviar para o Odoo'));
  const h = el('div', 'hint'); h.id = 'odooHint';
  sec.append(b, h);
  b.addEventListener('click', () => { if (!ST.rodando) abre(); });

  const m = el('div'); m.id = 'odoomodal';
  m.innerHTML = ''
    + '<div class="od-box" role="dialog" aria-modal="true" aria-labelledby="odooTitulo">'
    +   '<div class="od-head">'
    +     '<h2 id="odooTitulo">Enviar para o Odoo</h2>'
    +     '<span class="alvo" id="odooAlvo"></span>'
    +     '<button type="button" id="odooFechar" title="Fechar (Esc)">✕</button>'
    +   '</div>'
    +   '<div class="od-body">'
    +     '<div class="od-bar">'
    +       '<label>revisão <input type="text" id="odooRev" maxlength="8" size="6" '
    +         'placeholder="B" title="entra no nome da placa no Odoo e na chave do envio"></label>'
    +       '<input type="text" class="od-obs" id="odooObs" maxlength="500" '
    +         'placeholder="observação para quem confere (opcional)">'
    +       '<span class="od-tot" id="odooTot"></span>'
    +     '</div>'
    +     '<div id="odooLista"></div>'
    +   '</div>'
    +   '<div class="od-foot">'
    +     '<span class="est" id="odooEstado"></span>'
    +     '<button type="button" class="pri" id="odooEnviar" disabled>Enviar</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(m);

  $('odooFechar').addEventListener('click', fecha);
  m.addEventListener('mousedown', e => { if (e.target === m && !ST.rodando) fecha(); });
  $('odooEnviar').addEventListener('click', () => enviar());
  /* trocar a revisao muda o uid_externo — a chave que impede o envio duplicado —, entao a
     lista precisa ser remontada e reconferida com ela. Enter faz na hora; sair do campo
     tambem, para quem digita e clica direto no Enviar */
  $('odooRev').addEventListener('keydown', e => { if (e.key === 'Enter') recarrega(); });
  $('odooRev').addEventListener('change', () => recarrega());
  /* revisao mexida depois de conferir invalida o ensaio: o "tem certeza" nomearia uma
     revisao e o envio abriria outra chave de idempotencia, com uma lista que ninguem viu */
  $('odooRev').addEventListener('input', () => {
    if (!ST.conferido) return;
    ST.conferido = null;
    $('odooEnviar').disabled = true;
    estadoTxt('a revisão mudou — confira de novo antes de enviar');
  });

  /* Na BOLHA do document, nao na captura. Os atalhos da folha (W, G, L, Del, Espaço) moram
     num listener de window (schframe.js:1639), que so recebe a tecla DEPOIS do document —
     entao parar aqui basta para eles. Na captura o mesmo stopPropagation matava o evento
     antes de ele descer ao alvo, e nenhum campo deste modal recebia tecla nenhuma: o Enter
     da revisão simplesmente nao fazia nada.
     De quebra o HubDialog continua ganhando quando abre por cima: o listener DELE e de
     captura (hub-dialog.js:93), corta o evento antes, e este aqui nem roda — o Esc do "tem
     certeza?" nao leva junto a lista que a pessoa ainda nao mandou. */
  document.addEventListener('keydown', e => {
    if (!ST.aberto) return;
    e.stopPropagation();
    if (e.key === 'Escape' && !ST.rodando){ e.preventDefault(); fecha(); }
  });
  return true;
}

function inicia(){
  if (!montaDom()) return;
  atualizaBotao();
  if (!temServidor()) return;
  chama('/api/lista/recibo?projeto=' + encodeURIComponent(proj())).then(r => {
    if (r && r.ok && r.recibo){ ST.reciboLocal = r.recibo; atualizaBotao(); }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicia);
else inicia();

return { abre, fecha, estado: ST, pure: { resolucaoDe, descRecibo, desfechoDoEnvio } };
})();
if (typeof module === 'object' && module.exports) module.exports = HubOdooLista;
