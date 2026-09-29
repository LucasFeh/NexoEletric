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
/* o total mora no RODAPE, ao lado do Enviar: na barra de cima ele ficava debaixo dos toasts
   (que descem para baixo do cabecalho, ver .hd-toasts), coberto justamente logo depois de cada
   mudanca — o momento em que ele muda */
#odoomodal .od-tot{font-size:11px; color:var(--fg-dim,#9a9a9a); white-space:nowrap;}
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
  grid-template-columns:150px minmax(0,221px) 104px 143px 156px 58px minmax(0,1fr);
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
/* ── componentes fora do esquema ──
   O botao que junta um e acao secundaria, no desenho do "resolver": o unico botao com
   destaque neste modal continua sendo o Enviar. */
#odoomodal .od-add{flex:none; font-size:11px; line-height:1.6; padding:1px 9px; border-radius:3px;
  background:var(--panel2,#2d2d2d); color:var(--fg,#d8d8d8); border:1px solid var(--border,#3a3a3a);
  cursor:pointer;}
#odoomodal .od-add:hover:not(:disabled), #odoomodal .od-row .rs .od-fix:hover:not(:disabled){
  border-color:var(--accent,#4fc3f7);}
#odoomodal .od-add:disabled, #odoomodal .od-fix:disabled, #odoomodal .od-qtd:disabled{
  opacity:.45; cursor:not-allowed;}
/* a linha que nao veio do esquema: um fio na borda e a marca junto do designador — discreta,
   porque ela nao e problema, e so procedencia */
#odoomodal .od-row.extra{box-shadow:inset 2px 0 0 var(--accent,#4fc3f7);}
#odoomodal .od-row .des .od-fora{display:inline-block; margin-left:6px; padding:0 5px;
  border:1px solid var(--border,#3a3a3a); border-radius:3px; white-space:nowrap;
  font-family:var(--font,system-ui,sans-serif); font-size:10px; line-height:1.45; color:var(--fg-dim,#9a9a9a);}
/* a quantidade do extra se edita ali mesmo. E um campo de TEXTO com teclado numerico, e nao
   um type=number: o number muda com a roda do mouse (girar para rolar a lista gravava outra
   quantidade no blur) e nao expoe a selecao, que a repintura precisa repor. As teclas de seta
   continuam contando (campoQtd). O seletor leva o "input" para empatar com o input[type=text]
   de cima e vencer por vir depois. */
#odoomodal input.od-qtd{width:100%; box-sizing:border-box; padding:1px 5px; text-align:right;
  font-family:inherit; font-size:12px; font-variant-numeric:tabular-nums;
  background:var(--panel2,#2d2d2d); color:var(--fg,#d8d8d8);
  border:1px solid var(--border,#3a3a3a); border-radius:3px;}
/* a peca escolhida esperando a quantidade: fora da #odooLista de proposito, porque a lista se
   repinta sozinha quando o ensaio volta e levaria junto o que a pessoa esta digitando */
#odoomodal .od-novo{display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:11px;
  padding:7px 9px; margin-bottom:8px; border-radius:4px; border:1px solid var(--border,#3a3a3a);
  border-left:3px solid var(--accent,#4fc3f7); background:var(--panel2,#2d2d2d);}
#odoomodal .od-novo[hidden]{display:none;}
#odoomodal .od-novo .t{flex:1; min-width:200px;}
#odoomodal .od-novo .t b{font-weight:600;}
#odoomodal .od-novo input.od-qtd{width:84px;}
/* o extra que e a MESMA peca de outra linha (o 10K do esquema pedido de novo como
   sobressalente): vai numa linha separada, e a marca diz com qual */
#odoomodal .od-row .rs .od-rep{flex:none; color:var(--fg-dim,#9a9a9a); white-space:nowrap;}
/* com a lista aberta, os toasts (hub-dialog) descem para baixo do cabecalho dela: no canto de
   sempre eles cobriam o X, e o clique so fechava o toast. O cabecalho tem ~42px a partir dos
   14px da borda do .od-box */
body:has(#odoomodal.on) .hd-toasts{top:64px;}
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
/* o seletor do almoxarifado mora no schframe.js; sem ele nao ha de onde escolher a peca */
const temPonte = () => typeof window.__hubEscolheParaLista === 'function';

/* o teto e o do servidor (odoolista.py » QTD_MAX): a tela recusa antes para nao gastar uma ida */
const QTD_MAX = 100000;
/* Quantidade digitada -> inteiro de 1 a QTD_MAX, ou null. Pura: tests/test-lista-extras.js.
   O campo e de texto (ver o CSS do input.od-qtd): "1.5", "-3", "0", "10 pç" e "" chegam como
   vieram — e nenhum deles e quantidade de peca. */
function qtdDoCampo(v){
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{1,9}$/.test(s)) return null;
  const q = Number(s);
  return q >= 1 && q <= QTD_MAX ? q : null;
}

/* As setas do teclado no campo de quantidade: um passo, preso entre 1 e QTD_MAX. O que nao e
   quantidade conta a partir da gravada. Pura: tests/test-lista-extras.js. */
function passoQtd(v, delta, gravada){
  const q = qtdDoCampo(v);
  const base = q === null ? (qtdDoCampo(gravada) || 1) : q;
  return Math.min(QTD_MAX, Math.max(1, base + delta));
}

/* O extra que e a MESMA peca (mesmo product_id) de outra linha — o 10K do esquema pedido de
   novo como sobressalente, ou a mesma peca juntada duas vezes. Ele vai ao Odoo numa linha
   separada, com a quantidade dele: isso e decisao, nao defeito (a linha do esquema conta
   designadores, a extra conta o que foi digitado), mas quem confere precisa ver. Devolve um
   Map linha extra -> designadores das outras linhas do mesmo produto. So o product_id conta:
   sem ele nao ha como afirmar que e a mesma peca. Pura: tests/test-lista-extras.js. */
function repeticoes(linhas){
  const por = new Map(), out = new Map();
  for (const l of linhas || []) if (l && l.product_id != null){
    if (!por.has(l.product_id)) por.set(l.product_id, []);
    por.get(l.product_id).push(l);
  }
  for (const l of linhas || []) if (l && l._extra != null && l.product_id != null){
    const outras = por.get(l.product_id).filter(x => x !== l).map(x => x.designadores);
    if (outras.length) out.set(l, outras);
  }
  return out;
}

/* "N linha(s) · M peça(s)", com os extras DENTRO da conta — eles vao para o Odoo como
   qualquer linha — e ditos a parte, para ninguem estranhar o total maior que o esquema. */
function totalDaLista(payload){
  const linhas = (payload && payload.linhas) || [];
  if (!linhas.length) return '';
  const pecas = linhas.reduce((a, l) => a + (Number(l.quantidade) || 0), 0);
  const fora = linhas.filter(l => l._extra != null).length;
  return linhas.length + ' linha(s) · ' + pecas + ' peça(s)'
       + (fora ? ' · ' + fora + ' fora do esquema' : '');
}

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
    /* status e semJson para quem precisa distinguir "a rota nao existe neste servidor" (o
       404/405 em HTML do Flask) de uma recusa dela (sempre em JSON) — ver rotaAusente */
    return { ok: false, error: 'o servidor respondeu ' + r.status + ' sem JSON',
             status: r.status, semJson: true };
  } catch (e) {
    return { ok: false, error: 'sem resposta do servidor: ' + (e && e.message || e) };
  }
}

/* ------------------------------- estado da tela ------------------------------- */

const ST = {
  previa: null, aplicados: [],
  aberto: false, rodando: false,
  conferido: null,      /* o payload que o SERVIDOR montou no ultimo ensaio */
  assinatura: null,     /* a do ensaio que deu o `conferido`; volta no /envio */
  reciboLocal: null,    /* o ultimo envio, lido de Projects/<p>/odoo-lista.json */
  destino: null,        /* url/db/login/temSenha */
  extras: [],           /* Projects/<p>/lista-extras.json, como o servidor devolveu */
  novo: null,           /* a peca escolhida no seletor, esperando a quantidade */
  mexendo: false,       /* ha extra na fila (mexeExtra): previa e ensaio esperam ela esvaziar */
  naFila: 0,            /* quantos POSTs de extra estao na fila, contando o que esta no ar */
  semExtras: false,     /* o servidor nao tem /api/lista/extras (hubserver.py de antes) */
  extrasErro: null,     /* o lista-extras.json nao se le: a frase do servidor, que trava o botao */
  revSuja: false,       /* a revisao foi digitada e a lista ainda nao foi remontada com ela */
  conferindo: false,    /* um ensaio no ar */
  voltaFoco: null,      /* o extra cuja quantidade levou Enter: o foco volta a ele na repintura */
  voltaBotao: null,     /* [[extra, papel]...] do 'resolver' que abriu o seletor: o foco volta ali */
  /* Cada previa/ensaio leva um numero, e so a resposta do ULTIMO pinta. Com os extras a
     lista passou a ser remontada varias vezes seguidas (cada quantidade mexida), e um ensaio
     velho chegando depois do novo acendia o Enviar com a assinatura da lista anterior. O
     servidor recusaria (409), mas a tela nao pode mostrar uma lista e conferir outra.
     Quem MUDA a lista (mexeExtra, a revisao digitada) avanca os numeros ANTES de mexer: o
     que ja estava no ar descreve a lista de antes e nao pode pousar depois — so ordenar um
     ensaio contra outro deixava o de antes da mudanca repintar e acender o Enviar. */
  gPrevia: 0, gEnsaio: 0,
};

/* a rota nao existe neste servidor: o hubserver.py ainda e o de antes dos extras (arquivos
   novos no disco, processo nao reiniciado). O Flask responde a rota que nao conhece com
   404/405 em HTML; a rota que existe recusa sempre em JSON. */
const rotaAusente = j => !!(j && j.semJson && (j.status === 404 || j.status === 405));
const FRASE_SEM_EXTRAS = 'este servidor ainda não tem os componentes fora do esquema — '
                       + 'reinicie o hubserver.py';

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
  /* A QUANTIDADE SENDO DIGITADA SOBREVIVE A REPINTURA. A lista se refaz inteira quando o
     ensaio volta (1 a 3 s depois de abrir, e depois de cada mudanca de extra), e o campo com
     foco ia junto: o Chrome disparava `change` no campo removido — gravando o "1" de quem
     queria 150 —, e o foco caia fora da lista. O campo velho e marcado como descartado (o
     change/blur dele nao grava mais nada) e o novo, do mesmo extra, recebe o que estava
     digitado e o foco. `mexeu` separa digitado de so clicado: sem digitacao, o campo novo
     fica com o valor que o disco tem agora (outra aba pode te-lo mudado).
     A SELECAO vai junto. Quem selecionou o numero para digitar outro por cima (ou acabou de
     dar Enter, que seleciona) e perdia a selecao quando o ensaio pousava: o "25" digitado
     caia no fim do "10" e o blur gravava 1025. */
  const foco = document.activeElement;
  const emEdicao = foco && foco.classList && foco.classList.contains('od-qtd') && box.contains(foco)
    ? { extra: foco.dataset.extra, valor: foco.value, mexeu: foco.value !== foco.dataset.gravado,
        sel: [foco.selectionStart, foco.selectionEnd, foco.selectionDirection] }
    : null;
  /* O FOCO NUM BOTAO DA LINHA volta tambem. O Tab que sai da quantidade para no 'resolver'
     ou no 'remover' da mesma linha, e e ele que dispara o POST e a repintura: o botao sumia,
     o foco caia no corpo e o Tab seguinte recomecava na PRIMEIRA quantidade da lista — o
     numero da linha de baixo ia gravado na de cima. Guarda-se o controle focado e os que vem
     depois dele (extra + papel); na lista nova, o primeiro que ainda existir recebe o foco. */
  let emBotao = emEdicao ? null : controlesDesde(foco);
  /* o botao que tirou o foco da lista para agir (o 'resolver' esconde a lista para abrir o
     seletor) deixou marcado para onde voltar — vale se o foco nao estiver em outro lugar */
  if (!emEdicao && !emBotao && ST.voltaBotao
      && (!foco || foco === document.body || !$('odoomodal').contains(foco))) emBotao = ST.voltaBotao;
  ST.voltaBotao = null;
  for (const x of box.querySelectorAll('input.od-qtd')) x._descartado = true;
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
  const repete = repeticoes(payload && payload.linhas);

  for (const ln of (payload && payload.linhas) || []){
    /* `_extra` e o id do componente fora do esquema (odoolista.py » linhas_extras): a linha
       vem do lista-extras.json, e nao da folha — resolver e mexer nela e outro caminho */
    const ex = ln._extra != null;
    const r = resolucaoDe(ln, porDes.get(ln.designadores));
    const row = el('div', 'od-row' + (ex ? ' extra' : ''));
    const rs = el('span', 'rs' + (r.pend ? ' pend' : ''));
    const rst = el('span', 'rst', r.txt); rst.title = r.txt;
    rs.append(rst);
    /* a linha que resolveu leva a ficha do produto: o product_id é a variante, e o
       hub-odoolink a traduz para o template, que é o que a URL do Odoo quer */
    if (ln.product_id && typeof HubOdooLink !== 'undefined'){
      const lk = HubOdooLink.link(HubOdooLink.tmplDoProduto(ln.product_id),
                                  { nome: ln.nome_altium || ('produto ' + ln.product_id) });
      /* na linha extra o link e um controle da linha como os outros: o Tab que sai da
         quantidade para NELE, e sem a marca a repintura o perdia e o foco caia no topo */
      if (lk && ex){ lk.dataset.extra = String(ln._extra); lk.dataset.papel = 'ficha'; }
      if (lk) rs.append(lk);
    }
    if (ex){
      const outras = repete.get(ln);
      if (outras){
        const quem = outras.join(' · ');
        const m = el('span', 'od-rep', 'mesma peça de ' + (quem.length > 18 ? quem.slice(0, 16) + '…' : quem));
        m.title = 'a mesma peça (produto ' + ln.product_id + ') de ' + quem + ' — vai ao Odoo numa '
                + 'linha separada, com a quantidade desta. Se a ideia era só aumentar a quantidade, '
                + 'tudo bem assim; se foi repetida sem querer, remova esta.';
        rs.append(m);
      }
      /* o extra pendente troca a PEÇA (o mesmo seletor, no modo que só escolhe); a folha
         não entra nisso — ele nunca esteve nela */
      if (r.pend && temPonte()){
        const b = el('button', 'od-fix', 'resolver');
        b.dataset.extra = String(ln._extra);
        b.dataset.papel = 'resolver';
        b.title = 'trocar a peça de ' + ln.designadores + ' por um componente do almoxarifado';
        b.onclick = () => trocaPecaExtra(ln, controlesDesde(b));
        rs.append(b);
      }
      const rm = el('button', 'od-fix', 'remover');
      rm.dataset.extra = String(ln._extra);
      rm.dataset.papel = 'remover';
      rm.title = 'tirar ' + ln.designadores + ' da lista — o esquema não muda';
      /* uma vez so, e a LINHA inteira: com a fila, o segundo clique mandaria o remove de novo,
         e uma quantidade ou um 'resolver' mexidos na linha que ja esta saindo voltariam como
         "nao esta mais na lista" */
      rm.onclick = ev => {
        /* PELO TECLADO (Enter/Espaço: click com detail 0), o foco anda ANTES de a linha
           travar: o botao desabilitado perde o foco para o corpo na repintura, e o Tab seguinte
           recomecava no topo. Vai para o proximo controle vivo depois desta linha; sem nenhum
           (era a ultima), para o anterior; sem nenhum, para o "Adicionar componente fora do
           esquema". PELO MOUSE nao: o clique tambem foca o botao, e levar o foco a quantidade
           seguinte fazia o primeiro Esc so desfazer o campo em vez de fechar a lista. */
        if (ev && ev.detail === 0 && document.activeElement === rm){
          const ctrls = [...$('odooLista').querySelectorAll('[data-extra][data-papel]')];
          const k = ctrls.indexOf(rm);
          const vivo = x => x.dataset.extra !== String(ln._extra) && !x.disabled;
          const extra = $('odooExtra');
          const prox = ctrls.slice(k + 1).find(vivo) || ctrls.slice(0, k).reverse().find(vivo)
                    || (extra && !extra.disabled ? extra : null);
          if (prox) prox.focus();
        }
        for (const x of row.querySelectorAll('[data-extra]')){ x._usado = true; x.disabled = true; }
        removeExtra(ln);
      };
      rs.append(rm);
    }
    /* so na linha com problema, e so quando esta vista sabe abrir o seletor: o painel roda
       dentro do schframe, mas a lista vem do disco e pode citar componente de outra folha */
    else if (r.pend && typeof window.__hubResolveParaLista === 'function'){
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
    const des = el('span', 'des', ln.designadores);
    if (ex){
      const t = el('span', 'od-fora', 'fora do esquema');
      t.title = 'componente que não está no desenho e vai junto na lista — mora em '
              + 'lista-extras.json, ao lado do esquema';
      des.append(t);
    }
    row.append(des, nm, vl, en, ac, ex ? campoQtd(ln) : el('span', 'qt', String(ln.quantidade)), rs);
    box.append(row);
  }

  $('odooTot').textContent = totalDaLista(payload);
  travaExtras();
  if (emBotao){
    const novos = [...box.querySelectorAll('[data-extra][data-papel]')];
    for (const [ex, p] of emBotao){
      const c = novos.find(x => x.dataset.extra === ex && x.dataset.papel === p && !x.disabled);
      if (c){ c.focus(); break; }
    }
  }
  devolveFoco(box, emEdicao);
}

/* Os controles de extra da lista (os que levam data-extra e data-papel), do `el` em diante,
   como pares [extra, papel]: e o endereco que sobrevive a repintura — o no morre, o par
   acha o equivalente na lista nova. `el` que nao e um deles: null. */
function controlesDesde(el){
  const box = $('odooLista');
  if (!el || !box) return null;
  const ctrls = [...box.querySelectorAll('[data-extra][data-papel]')];
  const i = ctrls.indexOf(el);
  return i >= 0 ? ctrls.slice(i).map(x => [x.dataset.extra, x.dataset.papel]) : null;
}

/* O foco de volta ao campo de quantidade do mesmo extra, depois da repintura: o que estava
   sendo digitado (emEdicao) ou o que acabou de levar Enter (ST.voltaFoco). O Enter so
   recupera o foco se ninguem o levou para outro lugar no meio — quem clicou na observacao
   enquanto a lista se refazia fica na observacao. Campo travado (envio no ar) nao recebe. */
function devolveFoco(box, emEdicao){
  const alvo = emEdicao ? emEdicao.extra : ST.voltaFoco;
  if (alvo == null) return;
  if (!emEdicao){
    const a = document.activeElement;
    if (a && a !== document.body && $('odoomodal').contains(a)){ ST.voltaFoco = null; return; }
  }
  const i = box.querySelector('input.od-qtd[data-extra="' + String(Number(alvo)) + '"]');
  if (!i || i.disabled) return;
  if (emEdicao && emEdicao.mexeu) i.value = emEdicao.valor;
  i.focus();
  /* a selecao (ou o cursor) de antes, no campo novo: quem digitava "1" segue depois dele
     ("1" + "50" e 150, nao 501), e quem tinha o numero selecionado continua com ele
     selecionado. MAS so quando o numero e o mesmo: se o disco o trocou por baixo (outra aba)
     sem ninguem ter digitado aqui, a posicao antiga nao descreve o numero novo — o "10"
     selecionado virava o "15" de "150", e "25" digitado dava 250. Ai o numero novo vem
     inteiro selecionado: fica visivel que mudou, e digitar substitui. */
  if (emEdicao && !emEdicao.mexeu && i.value !== emEdicao.valor) i.select();
  else if (emEdicao && emEdicao.sel[0] != null){
    try { i.setSelectionRange(emEdicao.sel[0], emEdicao.sel[1], emEdicao.sel[2] || 'none'); }
    catch (e) { /* campo que nao expoe selecao: fica o cursor do focus */ }
  }
  if (!emEdicao) i.select();
  ST.voltaFoco = null;
}

/* A quantidade do extra, editavel na propria linha. Grava ao sair do campo ou no Enter; Esc
   devolve o que estava. O que nao e inteiro de 1 a QTD_MAX volta sem ir ao servidor — e o
   servidor recusa do mesmo jeito, para quem chamar a rota sem a tela. */
function campoQtd(ln){
  const box = el('span', 'qt');
  const i = el('input', 'od-qtd');
  i.type = 'text'; i.inputMode = 'numeric'; i.autocomplete = 'off';
  i.maxLength = String(QTD_MAX).length;
  i.value = String(ln.quantidade);
  /* o valor que veio do disco: e contra ele que a repintura sabe se houve digitacao */
  i.dataset.gravado = i.value;
  i.dataset.extra = String(ln._extra);
  i.dataset.papel = 'qtd';
  i.title = 'quantidade de ' + ln.designadores + ' — Enter grava, Esc desfaz';
  i.setAttribute('aria-label', 'quantidade de ' + ln.designadores);
  /* O numero que o disco vai ter: o que veio (ln.quantidade) ou o ultimo que este campo
     mandou. Enter, change e blur chegam juntos com o MESMO numero, e so o primeiro manda; um
     numero diferente digitado depois no mesmo campo manda de novo (entra na fila do
     mexeExtra). O campo DESCARTADO pela repintura nao grava nada: o que estava digitado nele
     passou para o campo novo. */
  let enviado = ln.quantidade;
  const volta = () => { i.value = String(enviado); };
  /* true quando mandou o numero ao servidor */
  const grava = () => {
    if (i._descartado) return false;
    const q = qtdDoCampo(i.value);
    if (q === null){
      HubDialog.toast('quantidade é um número inteiro de 1 a ' + QTD_MAX + ' — ' + ln.designadores
        + ' continua com ' + enviado, 'warn', 6000);
      volta();
      return false;
    }
    if (q === enviado) return false;
    const antes = enviado;
    enviado = q;
    /* o "gravado" do campo e o ultimo numero mandado: e contra ele que a repintura sabe se
       houve digitacao depois (voltar ao numero de antes do POST tambem e digitacao) */
    i.dataset.gravado = String(q);
    mexeExtra({ op: 'update', id: ln._extra, quantidade: q },
              () => HubDialog.toast(ln.designadores + ': ' + q + ' peça(s)', 'ok', 2500),
              /* recusado: so desfaz se este ainda e o numero mais novo do campo — um mais
                 novo na fila, ou sendo digitado, nao pode ser atropelado pela falha do velho */
              () => {
                if (enviado !== q) return;
                enviado = antes;
                i.dataset.gravado = String(antes);
                if (!i._descartado && qtdDoCampo(i.value) === q) volta();
              });
    return true;
  };
  i.addEventListener('keydown', e => {
    /* o Enter grava e o foco volta a este extra quando a lista se refizer: quem esta no
       teclado segue nele, em vez de cair no corpo da pagina */
    if (e.key === 'Enter'){ e.preventDefault(); if (grava()) ST.voltaFoco = ln._extra; i.blur(); }
    /* o Esc do campo e do campo: sem o stopPropagation ele subia ao listener do modal e
       fechava a lista inteira */
    else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); volta(); i.blur(); }
    /* as setas contam, como contavam no type=number; gravar continua sendo Enter ou sair */
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown'){
      e.preventDefault();
      i.value = String(passoQtd(i.value, e.key === 'ArrowUp' ? 1 : -1, ln.quantidade));
    }
  });
  /* no blur, e nao so no change: o campo que a repintura recriou com o numero digitado nao
     dispara change se a pessoa sair sem digitar mais nada (o valor ja estava la no foco) */
  i.addEventListener('change', grava);
  i.addEventListener('blur', grava);
  box.append(i);
  return box;
}

function trava(v){
  ST.rodando = v;
  $('odooEnviar').disabled = v || !ST.conferido;
  $('odooRev').disabled = v;
  /* o X junto: fechado no meio da conferencia, o resultado chegava numa tela invisivel e
     a pessoa ficava sem toast, sem hint e sem saber se algo aconteceu */
  $('odooFechar').disabled = v;
  travaExtras();
}

/* Com o ENVIO no ar, nada dos extras mexe: a lista que vai e a que foi conferida, e um
   clique no meio mudaria o disco por baixo do /envio. Todo controle de extra leva
   `data-extra`, e e por ele que esta funcao os acha — os da linha e os da barra da peca nova.
   Um extra sendo GRAVADO nao trava nada: as mudancas entram na fila do mexeExtra. Travar ali
   desabilitava o campo de destino no meio da troca de foco, e o Tab de uma quantidade para a
   outra caia no corpo da pagina — tudo que se digitava depois ia para lugar nenhum. O botao
   que ja foi usado (`_usado`: o remover clicado) fica fora ate a repintura. */
function travaExtras(){
  const off = ST.rodando;
  const b = $('odooExtra');
  if (b){
    b.disabled = off || !temPonte() || ST.semExtras || !!ST.extrasErro;
    b.title = ST.semExtras ? FRASE_SEM_EXTRAS
      : ST.extrasErro ? ST.extrasErro
      : temPonte()
      ? 'escolhe no almoxarifado uma peça que não está no desenho e junta à lista — o esquema não muda'
      : 'esta vista não tem o seletor do almoxarifado';
  }
  for (const x of document.querySelectorAll('#odoomodal [data-extra]')) x.disabled = off || x._usado === true;
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
/* Devolve true quando a lista foi montada e o ensaio pode vir atras. False quando a resposta
   chegou velha (outra previa, ou uma mudanca de extra, saiu depois desta) ou quando a lista
   nem se montou: o /ensaio passa pelo MESMO _prepara do servidor e recusaria com a mesma
   frase, que a tela empilhava duas vezes — a segunda culpando o Odoo, que nem foi chamado. */
async function previa(){
  const g = ++ST.gPrevia;
  /* a lista vai ser remontada: a conferencia de antes deixa de valer AGORA, e nao quando a
     resposta chegar. Senao o Enter na revisao sem mudanca deixava o Enviar aceso com a previa
     no ar, e um clique ali mandava o envio com a previa e o ensaio pousando por cima dele */
  ST.conferido = null;
  ST.assinatura = null;
  $('odooEnviar').disabled = true;
  estadoTxt('montando a lista do esquema salvo…');
  const j = await chama('/api/lista/previa', corpo());
  /* outra previa saiu depois desta (ela pinta), ou a lista foi fechada no meio: a janela que
     ninguem ve nao pinta, e sobretudo nao manda o ensaio ao Odoo */
  if (g !== ST.gPrevia || !ST.aberto) return false;
  /* a /previa monta a lista lendo o lista-extras.json (odoolista_server » _prepara): se ela
     voltou ok, o arquivo se le — o botao que travou por ele destrava sem fechar a lista */
  if (j.ok && ST.extrasErro){ ST.extrasErro = null; travaExtras(); }
  if (!j.ok){
    ST.previa = null;
    ST.conferido = null;
    $('odooEnviar').disabled = true;
    pintaLista(null, null);
    estadoTxt('a lista não se montou — veja o aviso acima');
    $('odooLista').prepend(el('div', 'od-aviso err', j.error || 'não deu para montar a lista'));
    return false;
  }
  /* a revisao do palpite so entra em campo VAZIO: o que o projetista digitou manda */
  if (!$('odooRev').value.trim() && j.revisaoUsada) $('odooRev').value = j.revisaoUsada;
  ST.previa = j.payload;
  ST.conferido = null;
  /* ST.aplicados NAO se zera aqui. Ele e "vinculo aplicado na folha e ainda nao salvo", e so
     o Salvar (pintaPendentes) ou uma abertura nova o resolvem; a previa roda tambem quando a
     revisao ou um extra mudam, e zerar ali apagava a barra do "ainda sem salvar" e acendia o
     Enviar sobre um esquema que nao estava no disco. */
  $('odooEnviar').disabled = true;
  pintaLista(j.payload, null);
  if (ST.aplicados.length) pintaPendentes();
  estadoTxt('lista montada do esquema salvo');
  return true;
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
    /* remonta E reconfere: so a previa deixava o Enviar apagado para sempre (ela zera a
       conferencia e ninguem mandava o ensaio de novo) — o mesmo beco do 409 */
    await recarrega();
  };
  bar.append(b);
}

/* ------------------------------- componentes fora do esquema -------------------------------
   Peca que vai na lista sem estar no desenho (a cola, o dissipador, o conector do chicote).
   Mora em Projects/<p>/lista-extras.json, que o SERVIDOR grava (/api/lista/extras) e le de
   novo ao montar a previa, o ensaio e o envio — a lista continua saindo do disco, como a do
   esquema. Cada mudanca aqui e gravada na hora (nao ha "salvar" dos extras) e invalida a
   conferencia: a lista mudou, entao o que foi conferido deixou de ser o que vai. */

async function carregaExtras(){
  const j = await chama('/api/lista/extras?projeto=' + encodeURIComponent(proj()));
  ST.extras = (j.ok && j.itens) || [];
  /* SERVIDOR SEM A ROTA: o botao desliga ja na abertura, com o motivo no title. Antes ele
     ficava ativo e a pessoa so descobria depois de escolher a peca e digitar a quantidade,
     num "o servidor respondeu 405 sem JSON" que nao dizia o que fazer. */
  ST.semExtras = rotaAusente(j);
  /* ARQUIVO QUE NAO SE LE (JSON quebrado, fora do UTF-8): mesma coisa. A frase do defeito
     aparece na lista pela previa; o botao desliga com ela no title, em vez de levar a pessoa
     ao seletor e a quantidade so para devolver o mesmo erro num toast. Consertado o arquivo,
     abrir a lista de novo le outra vez. */
  ST.extrasErro = (!j.ok && !ST.semExtras) ? (j.error || 'o lista-extras.json nao se le') : null;
  travaExtras();
}

/* Um POST de extra, e depois a lista remontada e reconferida. `aoGravar` roda assim que o
   servidor responde ok — o toast nao espera a ida ao Odoo —; `aoFalhar`, se ele recusar.
   OS POSTS SAEM EM FILA, um de cada vez, e nunca sao recusados por "ocupado": antes o segundo
   (a quantidade do EXTRA 2 digitada com a do EXTRA 1 ainda no ar) voltava como falha e o
   campo desfazia o numero. A lista se remonta e reconfere UMA vez, quando a fila esvazia —
   ST.mexendo e "ha extra na fila", e segura a previa e o ensaio ate la. */
let filaExtras = Promise.resolve();
function mexeExtra(corpoOp, aoGravar, aoFalhar){
  /* com o envio no ar, sim, e falha: a lista que vai e a conferida */
  if (ST.rodando){ if (aoFalhar) aoFalhar(null); return Promise.resolve(null); }
  ST.naFila++;
  ST.mexendo = true;
  /* a lista muda AGORA: o Enviar apaga antes da resposta, para nunca ficar aceso sobre uma
     conferencia que ja nao descreve o disco. E a previa e o ensaio que ja estavam no ar sao
     da lista de ANTES: os numeros avancam aqui, e a resposta deles e descartada quando
     chegar — senao o ensaio velho repintava a quantidade velha e reacendia o Enviar com a
     assinatura anterior, no meio deste POST */
  ST.gPrevia++;
  ST.gEnsaio++;
  ST.conferindo = false;
  ST.conferido = null;
  ST.assinatura = null;
  $('odooEnviar').disabled = true;
  estadoTxt('gravando o componente fora do esquema…');
  const vez = filaExtras.then(() => gravaExtra(corpoOp, aoGravar, aoFalhar));
  filaExtras = vez.catch(() => null);
  return vez;
}

async function gravaExtra(corpoOp, aoGravar, aoFalhar){
  let j = null;
  try {
    j = await chama('/api/lista/extras', Object.assign({ projeto: proj() }, corpoOp));
    if (rotaAusente(j)){ ST.semExtras = true; j.error = FRASE_SEM_EXTRAS; }
    if (j.ok){
      ST.extrasErro = null;                  /* gravou: o arquivo se le */
      ST.extras = j.itens || [];
      if (aoGravar) aoGravar(j);
    } else {
      HubDialog.toast(j.error || 'não gravou o componente fora do esquema', 'err', 8000);
      if (aoFalhar) aoFalhar(j);
    }
  } finally {
    /* no finally: um callback que estourasse deixaria a fila "ocupada" para sempre */
    if (--ST.naFila === 0) ST.mexendo = false;
    travaExtras();
  }
  /* nos dois casos: um 404 quer dizer que outra aba mexeu, e a tela tem de voltar a mostrar
     o disco, nao o que ela achava que havia nele. So o ultimo da fila remonta — e SEM await:
     a fila nao espera a remontagem. Com o await o POST seguinte ficava parado atras do
     ensaio no Odoo (1 a 30 s) que a propria mudanca nova ja tinha descartado, com o numero
     novo so na tela, e um F5 nesse meio o perdia. */
  if (!ST.mexendo) recarrega().catch(() => {});
  return j;
}

/* Sair da pagina com extra na fila perderia a mudanca: o navegador pergunta antes. */
if (typeof window !== 'undefined' && window.addEventListener)
  window.addEventListener('beforeunload', e => {
    if (ST.naFila > 0){ e.preventDefault(); e.returnValue = ''; }
  });

/* O MESMO seletor da vista Esquema, no modo que so escolhe (schframe.js »
   __hubEscolheParaLista). O painel se esconde enquanto ele esta aberto — o seletor tem
   z-index menor — e volta de qualquer jeito, escolhendo ou nao, como no resolveLinha. */
function escolhePeca(atual, aoEscolher){
  if (ST.rodando) return;
  if (ST.semExtras){ HubDialog.toast(FRASE_SEM_EXTRAS, 'warn', 7000); return; }
  if (!temPonte()){
    HubDialog.toast('esta vista não tem o seletor do almoxarifado — abra a lista pela vista Esquema',
                    'warn', 7000);
    return;
  }
  const modal = $('odoomodal');
  modal.classList.remove('on');
  const volta = () => { if (ST.aberto) modal.classList.add('on'); };
  const ok = window.__hubEscolheParaLista(esc => { if (ST.aberto) aoEscolher(esc); }, volta, atual);
  if (!ok){
    volta();
    HubDialog.toast('não deu para abrir o seletor do almoxarifado aqui — o espelho do '
      + 'almoxarifado não carregou nesta vista', 'warn', 7000);
  }
}

function adicionaExtra(){ escolhePeca(null, mostraNovo); }

/* A peca escolhida pede a quantidade AQUI, num campo do proprio painel (nunca prompt()). */
function mostraNovo(esc){
  ST.novo = esc;
  const box = $('odooNovo');
  box.textContent = '';
  const t = el('span', 't');
  t.append('Fora do esquema: ', el('b', null, esc.nome));
  /* a familia e o MPN dizem QUAL peca foi: ha valores de mesmo nome em familias diferentes
     (dois "Cartão Micro SD"), e o nome sozinho nao os separa */
  const det = [esc.valor && esc.valor !== esc.nome ? esc.valor : '', esc.familia || '',
               esc.mpn ? 'MPN ' + esc.mpn : '', esc.footprint || '']
    .filter(Boolean).join(' · ');
  if (det) t.append(' · ' + det);
  const lb = el('label', null, 'quantidade ');
  const q = el('input', 'od-qtd');
  /* texto com teclado numerico, como o da linha (ver o CSS do input.od-qtd): a roda do mouse
     sobre um type=number trocava o 1 por 4 sem ninguem digitar */
  q.id = 'odooNovoQtd'; q.type = 'text'; q.inputMode = 'numeric'; q.autocomplete = 'off';
  q.maxLength = String(QTD_MAX).length;
  q.value = '1'; q.dataset.extra = 'novo';
  lb.append(q);
  const ok = el('button', 'od-add', 'Adicionar à lista');
  ok.type = 'button'; ok.dataset.extra = 'novo';
  ok.onclick = () => confirmaNovo();
  const nao = el('button', 'od-add', 'Cancelar');
  nao.type = 'button'; nao.dataset.extra = 'novo';
  nao.onclick = () => escondeNovo();
  q.addEventListener('keydown', e => {
    /* com a peca na fila o campo e so leitura: nada de Esc fechando a lista, nem de seta
       mexendo no numero que ja foi — so o Tab passa */
    if (q.readOnly){ if (e.key !== 'Tab'){ e.preventDefault(); e.stopPropagation(); } return; }
    if (e.key === 'Enter'){ e.preventDefault(); confirmaNovo(); }
    /* Esc cancela a peca, nao fecha a lista: o stopPropagation para no campo */
    else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); escondeNovo(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown'){
      e.preventDefault();
      q.value = String(passoQtd(q.value, e.key === 'ArrowUp' ? 1 : -1, 1));
    }
  });
  /* quantidade e botoes a ESQUERDA, o texto depois: o canto superior direito e dos toasts
     (hub-dialog), e com dois vivos (remover e juntar outra) o clique no "Adicionar a lista"
     so fechava o toast — o mesmo motivo que tirou o #odooExtra dali */
  box.append(lb, ok, nao, t);
  box.hidden = false;
  /* a barra mora no alto da lista; quem estava rolado la embaixo nao a veria */
  const corpoModal = box.closest('.od-body');
  if (corpoModal) corpoModal.scrollTop = 0;
  travaExtras();
  q.focus();
  q.select();
}

function escondeNovo(){
  ST.novo = null;
  const box = $('odooNovo');
  if (!box) return;
  box.hidden = true;
  box.textContent = '';
}

async function confirmaNovo(){
  const esc = ST.novo;
  /* `indo`: esta peca ja esta na fila — o segundo Enter (ou Enter e clique) juntaria a MESMA
     peca duas vezes, agora que a fila nao recusa mais nada */
  if (!esc || ST.rodando || esc.indo) return;
  const campo = $('odooNovoQtd');
  const q = qtdDoCampo(campo && campo.value);
  if (q === null){
    HubDialog.toast('quantidade é um número inteiro de 1 a ' + QTD_MAX, 'warn', 5000);
    if (campo){ campo.focus(); campo.select(); }
    return;
  }
  esc.indo = true;
  /* a barra congela enquanto a peca esta na fila: uma quantidade nova digitada ali ou o
     Cancelar seriam ignorados calados, porque o POST ja saiu com o numero de antes */
  const bar = $('odooNovo');
  /* o CAMPO congela como somente-leitura, e nao desabilitado: desabilitado, o Chrome tira o
     foco dele, e depois de uma recusa o Enter nao tentava de novo e o Esc — que ali so
     cancelaria a peca — chegava ao modal e fechava a lista inteira */
  const congela = v => {
    for (const x of bar.querySelectorAll('[data-extra]')){
      if (x.id === 'odooNovoQtd'){ x.readOnly = v; continue; }
      x._usado = v; x.disabled = v || ST.rodando;
    }
  };
  congela(true);
  await mexeExtra({ op: 'add', item: { sym: esc.sym, comment: esc.comment, footprint: esc.footprint,
                                       params: esc.params, quantidade: q } },
    j => {
      if (ST.novo === esc){
        /* a barra some com o foco dentro: sem isto ele caia no corpo da pagina. Vai para o
           botao que junta a proxima peca, que e o passo seguinte de quem esta no teclado */
        const naBarra = $('odooNovo').contains(document.activeElement)
                     || document.activeElement === document.body;
        escondeNovo();
        const b = $('odooExtra');
        if (naBarra && b && !b.disabled && ST.aberto) b.focus();
      }
      HubDialog.toast('EXTRA ' + j.id + ' entrou na lista: ' + esc.nome + ' × ' + q
                      + '. O esquema não mudou.', 'ok', 5000);
    },
    /* recusado: a barra continua, e volta a mexer, para corrigir e tentar de novo — com o
       foco no campo, se ele tinha caido (quem clicou no botao, que se desabilitou) */
    () => {
      esc.indo = false;
      if (ST.novo !== esc) return;
      congela(false);
      const c = $('odooNovoQtd'), a = document.activeElement;
      if (c && ST.aberto && (!a || a === document.body)){ c.focus(); c.select(); }
    });
}

/* O extra pendente troca de PECA pelo mesmo seletor; a quantidade fica. O servidor troca os
   quatro campos juntos (odoolista.py » valida_peca), entao o OdooId da peca velha nao sobra. */
/* `volta`: os controles do 'resolver' em diante (controlesDesde), para o foco voltar a linha
   quando a lista se repintar com a peca nova — o seletor tirou o foco da lista. */
async function trocaPecaExtra(ln, volta){
  if (ST.rodando) return;
  /* a peca de hoje abre marcada no seletor. A linha pode ter nascido noutra aba, e ai a copia
     daqui nao a conhece: le de novo do disco antes de desistir dela */
  let atual = ST.extras.find(x => x.id === ln._extra);
  if (!atual){
    await carregaExtras();
    atual = ST.extras.find(x => x.id === ln._extra) || null;
  }
  /* nem no disco: outra aba o tirou. Trocar a peca de uma linha que nao existe acabaria num
     404 depois de a pessoa escolher tudo — diga agora e mostre a lista de verdade */
  if (!atual){
    HubDialog.toast(ln.designadores + ' não está mais na lista (outra aba pode tê-lo tirado)',
                    'warn', 7000);
    await recarrega();
    return;
  }
  escolhePeca(atual, esc => {
    /* so com a escolha feita: cancelar o seletor nao repinta nada, e a marca velha roubaria o
       foco na repintura seguinte */
    if (volta) ST.voltaBotao = volta;
    return mexeExtra(
      { op: 'update', id: ln._extra, sym: esc.sym, comment: esc.comment,
        footprint: esc.footprint, params: esc.params },
      () => HubDialog.toast(ln.designadores + ' agora é ' + esc.nome, 'ok', 4000));
  });
}

/* Remover NAO pergunta. Tirar uma linha que a pessoa mesma pos e barato de desfazer (tres
   cliques a poem de volta), nada sai para o Odoo sem a conferencia e o "tem certeza?" do
   Enviar, e um modal a cada remocao seria o interrogatorio que ensina a clicar sem ler. O
   toast diz o que saiu — nome e quantidade —, que e o que se precisa para pôr de volta. */
function removeExtra(ln){
  mexeExtra({ op: 'remove', id: ln._extra },
    () => HubDialog.toast(ln.designadores + ' saiu da lista: ' + (ln.nome_altium || 'componente')
                          + ' × ' + ln.quantidade + '. O esquema não mudou.', 'info', 7000));
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
  if (!ST.aberto) return;                     /* fechada: nada de ida ao Odoo por ela */
  const g = ++ST.gEnsaio;
  /* a previa que vale para este ensaio e a que ja voltou: uma previa nova saindo depois
     dele quer dizer que a lista (ou a revisao) mudou no meio, e este ensaio descreve a de
     antes */
  const gp = ST.gPrevia;
  ST.conferido = null;
  ST.conferindo = true;
  /* o ensaio sai com a revisao que esta no campo AGORA (o corpo() a le): ela deixa de estar
     suja. Digitada com a previa no ar, ela ficava marcada, e o clique no Enviar — que tira o
     foco da revisao — mandava um segundo par previa/ensaio identico e engolia o clique */
  ST.revSuja = false;
  estadoTxt('conferindo no Odoo…');
  const j = await chama('/api/lista/ensaio', corpo());
  /* um ensaio mais novo ja saiu, a lista mudou ou um extra esta sendo gravado: nao pinta */
  if (!ST.aberto || g !== ST.gEnsaio || gp !== ST.gPrevia || ST.mexendo) return;
  ST.conferindo = false;
  if (!j.ok){
    estadoTxt('a lista acima é a do esquema; o Odoo não respondeu');
    $('odooLista').prepend(el('div', 'od-aviso err',
      (j.error || 'falhou') + ' — dá para resolver as linhas mesmo assim; o Enviar volta quando o Odoo responder.'));
    return;
  }
  ST.conferido = j.payload;
  /* a prova do que foi conferido: o /envio a recalcula do disco e recusa se nao bater */
  ST.assinatura = j.assinatura || null;
  pintaLista(j.payload, j.recibo);
  if (ST.aplicados.length) pintaPendentes();
  estadoTxt('conferido no Odoo · nada foi gravado · ' + j.uid_externo);
  $('odooEnviar').disabled = ST.aplicados.length > 0;
}

/* a revisao ou um extra mudou: remonta e reconfere, na ordem. Com um extra sendo gravado,
   nao: o mexeExtra chama esta mesma funcao quando o POST voltar, ja com a revisao do campo.
   E a previa que chegou velha nao segue para o ensaio — uma mais nova ja esta a caminho. */
async function recarrega(){
  if (!ST.aberto || ST.rodando || ST.mexendo) return;
  /* daqui em diante a lista sai com a revisao que esta no campo: o blur que vier atras de um
     Enter nao manda um segundo par previa/ensaio */
  ST.revSuja = false;
  if (!(await previa())) return;
  await conferir();
}

async function enviar(){
  if (!ST.conferido || ST.mexendo || ST.rodando) return;
  /* uma peça escolhida esperando a quantidade NÃO está na lista conferida: mandar agora
     mandaria sem ela, e quem escolheu a peça quase sempre esqueceu do "Adicionar à lista" */
  if (ST.novo){
    await HubDialog.alert('"' + ST.novo.nome + '" foi escolhido mas ainda não entrou na lista: '
      + 'diga a quantidade e clique em "Adicionar à lista", ou cancele, antes de enviar.',
      { title: 'componente esperando a quantidade' });
    const q = $('odooNovoQtd');
    if (q) q.focus();
    return;
  }
  /* a lista e a assinatura saem do MESMO ensaio, lidas juntas antes do "tem certeza?": o
     par que vai ao /envio nunca mistura uma conferencia com a outra */
  const r = ST.conferido, n = r.linhas.length, assinatura = ST.assinatura;
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
  const fora = r.linhas.filter(l => l._extra != null).length;
  const ok = await HubDialog.confirm(
    'Enviar ' + n + ' linha(s) de "' + r.projeto
    + (semRev ? '" (sem revisão)' : ' rev ' + r.revisao + '"')
    + (fora ? ', ' + fora + ' delas fora do esquema,' : '') + ' para a fila de '
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

  /* O ENVIO MANDA NA TELA ate voltar: previa e ensaio que ja estavam no ar descrevem a tela de
     antes do clique e sao descartados quando pousarem — senao o ensaio chegava com o /envio no
     ar, reacendia o Enviar e escrevia "nada foi gravado" por cima do "enviando…" (ou por cima
     do recibo, se chegasse depois dele) */
  ST.gPrevia++;
  ST.gEnsaio++;
  ST.conferindo = false;
  trava(true);
  estadoTxt('enviando…');
  /* uid, contagem e ASSINATURA do ensaio viajam junto: o servidor releem o schematic.js e o
     lista-extras.json do disco no envio, e se a revisao, o esquema ou um extra mudaram no
     meio ele recusa com 409 em vez de mandar para o Odoo uma lista que ninguem conferiu. A
     contagem sozinha nao via a quantidade de um extra mudada noutra aba; a assinatura ve. */
  const extra = { confirmado: true, uid_externo: r.uid_externo, total_linhas: n };
  if (assinatura) extra.assinatura = assinatura;
  const j = await chama('/api/lista/envio', corpo(extra));
  trava(false);
  if (!j.ok && j.confiraDeNovo){
    /* A LISTA MUDOU NO DISCO depois da conferencia (outra aba mexeu num extra, a IA gravou o
       esquema): nada foi enviado. A frase manda conferir de novo, e o ensaio nao e mais
       botao — entao a propria tela o faz: remonta do disco e reconfere. Antes ela so apagava
       o Enviar e deixava a lista velha na tela, sem caminho de volta alem de fechar e abrir. */
    ST.conferido = null;
    ST.assinatura = null;
    $('odooEnviar').disabled = true;
    HubDialog.toast((j.error || 'a lista mudou depois da conferência') + ' Nada foi enviado: a '
      + 'lista abaixo foi remontada com o que está no disco agora — confira e envie de novo.',
      'warn', 12000);
    await recarrega();
    return;
  }
  if (!j.ok){
    estadoTxt('');
    $('odooLista').prepend(el('div', 'od-aviso err', j.error || 'falhou'));
    HubDialog.toast(j.error || 'o envio falhou', 'err');
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

function fecha(){ ST.aberto = false; escondeNovo(); $('odoomodal').classList.remove('on'); }

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
  ST.assinatura = null;
  ST.conferindo = false;
  ST.voltaFoco = null;
  ST.revSuja = false;
  /* abrir e comecar de novo: o garanteSalvo acima deixou o esquema no disco, entao nao ha
     vinculo pendente; e a peca que esperava quantidade na abertura anterior ficou para tras */
  ST.aplicados = [];
  escondeNovo();
  await carregaExtras();
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
  /* extra ainda na fila (a lista foi fechada e reaberta com um POST no ar): o disco e o de
     ANTES dele, e pintar agora devolveria o 'remover' da linha que ja esta saindo. Quem
     pinta e confere e a remontagem do fim da fila (gravaExtra), que ja ve a lista aberta. */
  if (ST.mexendo) estadoTxt('gravando o componente fora do esquema…');
  else if (await previa()) await conferir();
  /* o foco vai para a revisao so se ninguem ja estiver num campo do modal: o ensaio leva 1 a
     3 s, e quem clicou numa quantidade nesse meio-tempo tinha o resto da digitacao jogado na
     revisao — e com ela selecionada, "150" virava a revisao "50" */
  const a = document.activeElement;
  if (ST.aberto && !(a && a !== document.body && $('odoomodal').contains(a))){
    $('odooRev').focus();
    $('odooRev').select();
  }
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
    /* o botao mora a ESQUERDA, e nao no fim da barra: o canto superior direito e dos toasts
       (hub-dialog), e o "EXTRA n entrou na lista" de 5 s cobria o botao — o clique para juntar a
       peca seguinte so fechava o toast */
    +       '<button type="button" class="od-add" id="odooExtra">Adicionar componente fora do esquema</button>'
    +       '<input type="text" class="od-obs" id="odooObs" maxlength="500" '
    +         'placeholder="observação para quem confere (opcional)">'
    +     '</div>'
    +     '<div class="od-novo" id="odooNovo" hidden></div>'
    +     '<div id="odooLista"></div>'
    +   '</div>'
    +   '<div class="od-foot">'
    +     '<span class="est" id="odooEstado"></span>'
    +     '<span class="od-tot" id="odooTot"></span>'
    +     '<button type="button" class="pri" id="odooEnviar" disabled>Enviar</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(m);

  $('odooFechar').addEventListener('click', fecha);
  /* o X nao toma o foco: sem isto, o mousedown nele tirava o foco da revisao suja ANTES do
     click, e o blur mandava previa e ensaio (ida ao Odoo) para a lista que ia fechar */
  $('odooFechar').addEventListener('mousedown', e => e.preventDefault());
  m.addEventListener('mousedown', e => { if (e.target === m && !ST.rodando) fecha(); });
  $('odooEnviar').addEventListener('click', () => enviar());
  $('odooExtra').addEventListener('click', () => adicionaExtra());
  /* trocar a revisao muda o uid_externo — a chave que impede o envio duplicado —, entao a
     lista precisa ser remontada e reconferida com ela. Enter faz na hora; sair do campo
     tambem, para quem digita e clica direto no Enviar */
  $('odooRev').addEventListener('keydown', e => { if (e.key === 'Enter') recarrega(); });
  /* so com a revisao suja: o Enter ja remontou (e limpou a marca), e o change que o Chrome
     dispara logo depois do Enter mandava a segunda previa */
  $('odooRev').addEventListener('change', () => { if (ST.revSuja) recarrega(); });
  /* SAIR DO CAMPO RECONFERE, e nao so o change: o navegador nao dispara change quando o valor
     na saida e igual ao da entrada — "A" digitado por cima do "A" selecionado, ou "Ax" e
     Backspace. O input abaixo ja tinha apagado o Enviar, e a tela ficava num beco dizendo que
     sair do campo remontava. O change vem antes do blur e zera a marca (recarrega), entao os
     dois juntos mandam um par previa/ensaio so. */
  $('odooRev').addEventListener('blur', () => { if (ST.revSuja) recarrega(); });
  /* revisao mexida depois de conferir invalida o ensaio: o "tem certeza" nomearia uma
     revisao e o envio abriria outra chave de idempotencia, com uma lista que ninguem viu */
  /* O ensaio que estiver NO AR tambem e da revisao de antes: o numero dele avanca aqui, e a
     resposta e descartada quando chegar — senao ela acendia o Enviar com o uid velho */
  $('odooRev').addEventListener('input', () => {
    ST.revSuja = true;
    if (!ST.conferido && !ST.conferindo) return;
    ST.gEnsaio++;
    ST.conferindo = false;
    ST.conferido = null;
    $('odooEnviar').disabled = true;
    estadoTxt('a revisão mudou — Enter (ou sair do campo) remonta e confere a lista de novo');
  });

  /* Na BOLHA do document, nao na captura. Os atalhos da folha (W, G, L, Del, Espaço) moram
     num listener de window (schframe.js:1639), que so recebe a tecla DEPOIS do document —
     entao parar aqui basta para eles. Na captura o mesmo stopPropagation matava o evento
     antes de ele descer ao alvo, e nenhum campo deste modal recebia tecla nenhuma: o Enter
     da revisão simplesmente nao fazia nada.
     De quebra o HubDialog continua ganhando quando abre por cima: o listener DELE e de
     captura (hub-dialog.js:93), corta o evento antes, e este aqui nem roda — o Esc do "tem
     certeza?" nao leva junto a lista que a pessoa ainda nao mandou. */
  /* ABERTO NAO E VISIVEL. Enquanto o seletor do almoxarifado esta por cima (resolver uma
     linha, escolher um componente fora do esquema), este painel fica escondido com ST.aberto
     ainda verdadeiro — e o Esc do seletor, que mora no listener de window do schframe, morria
     aqui: fechava a LISTA escondida e deixava o seletor aberto, orfao. Escondido, o teclado e
     de quem esta na frente. */
  document.addEventListener('keydown', e => {
    if (!ST.aberto || !m.classList.contains('on')) return;
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

return { abre, fecha, estado: ST,
         pure: { resolucaoDe, descRecibo, desfechoDoEnvio, qtdDoCampo, passoQtd, repeticoes,
                 totalDaLista } };
})();
if (typeof module === 'object' && module.exports) module.exports = HubOdooLista;
