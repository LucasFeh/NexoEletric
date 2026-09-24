/* AltiumPCBMirror v2 - hub-odoolink.js — o "Odoo ↗" de todo lugar que mostra um componente.

   PEDIDO DO DONO (2026-09-24): o botão que o conversor ganhou em 7088216 vale para TODA tela
   com componente — a lista e a ficha da Biblioteca, o editor de símbolos, a aba Footprints, a
   ficha de propriedades da vista Esquema, o "Trocar componente…", o "Adicionar componentes",
   a lista do Odoo e o próprio conversor. Nove lugares; uma cópia do link em cada um seriam
   nove números 282 e nove jeitos de achar a base. Por isso este arquivo existe sozinho, e
   todos chamam o mesmo.

   O ID DA FICHA É O `tmpl`, NÃO O `OdooId`. A ficha do Odoo abre pelo product.TEMPLATE; o
   `OdooId` que os params carregam (e o `product_id` da lista) é o product.product, a variante.
   Medido no exemplo do dono — "Kk Macho 2,54mm 4 Vias 180° Molex Branco (2510)": variante
   2118, template 2116, e 2116 é o número do link. Quem só tem o OdooId passa por
   `tmplDoProduto`, que traduz pelos espelhos do almoxarifado.

   A BASE SAI DO ESPELHO: `almoxIndex.odooUrl` é o Odoo de onde os dados vieram, escrito pelo
   gerador (tools/almox/almox2lib.py). Na falta dele (índice anterior a 2026-09-24) vale a url
   de dentro do `fonte` ("Odoo completo · http://<odoo>:8070 · odoo_db"). A bancada e o
   servidor dizem cada um o seu Odoo, e cada um está certo no seu lugar. Ler do hub-almox.json
   seria trazer para a tela o arquivo que carrega a senha do Odoo.
   O `odooUrl` existe porque o `fonte` mente por omissão: a regeração sem puxar ("Só regerar do
   snapshot", a única opção sem senha gravada) escreve `fonte = 'snapshot em disco'`, sem url —
   e todo link da casa sumia até a próxima puxada. O gerador carrega a url adiante.
   A casca do hub (hub.html » loadVarScript) APAGA o global depois de ler o índice — por isso
   existe `setFonte`: ela entrega o índice, e a vista Esquema, que mantém o global, nem precisa.

   Autossuficiente como o hub-dialog.js: injeta o próprio CSS e carrega em Node (os guards de
   `document`/`window`), para `url`/`tmplDe`/`tmplDoProduto` poderem ser provados sem
   navegador. */
"use strict";
var HubOdooLink = (function () {

/* A ação 282 é a ficha de produto DESTA instalação. É o único número daqui que não sai do
   dado; se um dia a ação mudar de id, é esta linha que muda — e só ela. */
const ACAO = 282;

const G = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});

/* `setFonte` aceita o ÍNDICE inteiro (o que a casca passa) ou só um texto com a url dentro */
let fonteFixa = '';
const urlDoIndice = ix => ix ? String(ix.odooUrl || ix.fonte || '') : '';
function setFonte(f){ fonteFixa = (f && typeof f === 'object') ? urlDoIndice(f) : String(f || ''); }

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|localhost|\[?::1\]?)$/i;
function base(){
  const f = fonteFixa || urlDoIndice(G.almoxIndex);
  const m = f.match(/https?:\/\/[^\s·]+/);
  if (!m) return '';
  let b = m[0].replace(/\/+$/, '');
  /* O ODOO "LOCAL" DO SERVIDOR NÃO É O DO NAVEGADOR. O container do hub roda na própria máquina
     do Odoo, e uma config com http://127.0.0.1:8070 é certa para o gerador puxar — e errada
     para um link: no PC de quem clica, 127.0.0.1 é o próprio PC. Quando a página não está em
     loopback, o host vira o do hub, que é a máquina onde o Odoo mora; a porta fica. */
  try {
    const u = new URL(b);
    const aqui = (typeof location !== 'undefined' && location.hostname) || '';
    if (LOOPBACK.test(u.hostname) && aqui && !LOOPBACK.test(aqui)){
      u.hostname = aqui;
      b = u.origin;
    }
  } catch (e) { /* url estranha: fica como veio */ }
  return b;
}

/* O tmpl de qualquer coisa que se tenha na mão:
     · string ou número — já é o tmpl;
     · um item do Odoo ({odoo, tmpl, nome}) — o dele;
     · um VALOR da lib ({itens:[…]}) — o do item cujo `odoo` é o `odooId` pedido, senão o do
       primeiro. 31 valores juntam mais de um item; sem o odooId o link vai no primeiro, e o
       title diz que há mais (ver `link`). */
function tmplDe(x, odooId){
  if (x == null) return '';
  if (typeof x === 'string' || typeof x === 'number') return String(x).trim();
  if (x.tmpl != null && x.tmpl !== '') return String(x.tmpl).trim();
  const itens = Array.isArray(x.itens) ? x.itens : [];
  const id = odooId == null ? '' : String(odooId).trim();
  const achado = (id && itens.find(i => i && String(i.odoo) === id)) || itens[0];
  return achado && achado.tmpl != null ? String(achado.tmpl).trim() : '';
}

function url(x, odooId){
  const b = base(), t = tmplDe(x, odooId);
  return (b && t) ? b + '/odoo/action-' + ACAO + '/' + t : '';
}

/* ── product.product → template ──
   Os acervos são os do índice (os mesmos que o hub-almoxpick lê), com a reserva para quando o
   índice não carregou. O mapa se refaz quando os OBJETOS de acervo mudam: o
   __hubRecarregaLibs reinjeta os <script>, e o global passa a ser outro objeto. */
const RESERVA = ['almoxBasicos', 'almoxEspeciais'];
let mapa = null, mapaDe = [];
function acervos(){
  const ix = G.almoxIndex;
  const vars = (ix && ix.libs && ix.libs.length) ? ix.libs.map(l => l && l.var) : RESERVA;
  return vars.filter(Boolean).map(v => G[v]).filter(l => l && l.symbols);
}
/* dois mapas numa passada: produto → {tmpl, nome} e nome do valor (`v.altium`, o que o `sym`
   do schematic.js grava) → valor */
function indice(){
  const libs = acervos();
  if (mapa && libs.length === mapaDe.length && libs.every((l, i) => l === mapaDe[i])) return mapa;
  mapa = { produto: new Map(), valor: new Map() };
  mapaDe = libs;
  for (const lib of libs) for (const sy of lib.symbols) for (const v of (sy.valores || [])){
    if (v && v.altium && !mapa.valor.has(v.altium)) mapa.valor.set(v.altium, v);
    for (const it of ((v && v.itens) || []))
      if (it && it.odoo != null && it.tmpl != null && !mapa.produto.has(String(it.odoo)))
        mapa.produto.set(String(it.odoo), { tmpl: String(it.tmpl), nome: it.nome || v.label || v.altium || '' });
  }
  return mapa;
}
function tmplDoProduto(odooId){
  const id = odooId == null ? '' : String(odooId).trim();
  if (!id) return '';
  const r = indice().produto.get(id);
  return r ? r.tmpl : '';
}
function valorPorNome(nome){
  const n = nome == null ? '' : String(nome);
  return n ? (indice().valor.get(n) || null) : null;
}

/* ── A FICHA DE UM COMPONENTE DA FOLHA ──
   A MESMA cascata do odoolista.py » resolve, que é quem decide o product_id da lista enviada
   ao Odoo. Divergir dela era o defeito: a primeira versão seguia a resolução do DESENHO
   (HubCore.resolveSym, com as escolhas do Libs/lib-subs.js), e a escolha "RES [ SMD ] →
   SMD 1206 10R" fazia todo 10K, 1K e 2K2 do PRJ-UR-DI261924 abrir a ficha do 10R — enquanto a
   lista, com razão, não mandava produto nenhum. Desenho emprestado não é identidade de peça.
     1. o `OdooId` dos params, quando é UM id válido — e aí é final, ache-se a ficha ou não;
     2. o valor do almoxarifado com o NOME EXATO do `sym`: um item só, ou o único cujo
        encapsulamento é o footprint do componente;
     3. nada.
   Devolve { alvo, nome } quando há ficha, { motivo } quando a resposta é "não" e vale dizer
   por quê, ou null quando o componente simplesmente não é do almoxarifado. */
function fichaDoComp(comp){
  if (!comp) return null;
  const m = /(?:^|;)\s*OdooId\s*=\s*([^;]*)/i.exec(String(comp.params || ''));
  const ids = m ? m[1].split(/[\s,]+/).filter(x => /^\d+$/.test(x) && +x > 0 && +x < 2147483648) : [];
  if (ids.length === 1){
    const t = tmplDoProduto(ids[0]);
    return t ? { alvo: t, nome: comp.sym || comp.ref || '' }
             : { motivo: 'o produto ' + ids[0] + ' (o OdooId do componente) não está no espelho do '
                         + 'almoxarifado — sincronize para ter o link' };
  }
  const v = valorPorNome(comp.sym);
  const itens = (v && v.itens) || [];
  if (!itens.length) return null;
  let escolha = itens;
  const fp = String(comp.footprint || '').trim().toLowerCase();
  if (itens.length > 1 && fp){
    const casam = itens.filter(x => String((x && x.pkg) || '').trim().toLowerCase() === fp);
    if (casam.length === 1) escolha = casam;
  }
  if (escolha.length === 1) return { alvo: escolha[0], nome: v.label || v.altium };
  return { motivo: 'ambíguo: ' + itens.length + ' produtos do Odoo neste valor — a Biblioteca '
                   + 'abre a ficha de cada um' };
}

/* ── o link ── */
const CSS = `
/* A FAIXA: o botão da linha continua sendo o que era (a grade dele, o hover, o selecionado) e
   o link fica do lado, fora dele. Botão dentro de botão não existe — ver a nota em faixa(). */
.odoo-fx{display:flex; align-items:center; gap:4px; min-width:0;}
.odoo-fx > :first-child{flex:1 1 auto; min-width:0;}
.odoo-lk{flex:none; display:inline-flex; align-items:center; font-size:10px; line-height:1.4;
  letter-spacing:.04em; padding:2px 7px; border-radius:3px; white-space:nowrap; cursor:pointer;
  text-decoration:none; border:1px solid var(--line, var(--border, #3a3a3a));
  background:transparent; color:var(--text-3, var(--fg-dim, #9a9a9a));}
.odoo-lk:hover, .odoo-lk:focus-visible{border-color:var(--hi, var(--accent, #4fc3f7));
  color:var(--hi, var(--accent, #4fc3f7)); outline:none;}
/* sem ficha: o lugar fica guardado, senão a coluna do saldo dança de linha para linha */
.odoo-lk.vago{visibility:hidden;}
.odoo-lk.grande{font-size:11px; padding:3px 9px;}
`;
let cssPosto = false;
function poeCss(){
  if (cssPosto || typeof document === 'undefined') return;
  cssPosto = true;
  const st = document.createElement('style');
  st.id = 'odoo-lk-css'; st.textContent = CSS;
  document.head.appendChild(st);
}

/* `alvo`: o que `tmplDe` aceita. `o`: { odooId, nome, nItens, texto, grande, vago }.
   Devolve o <a>, ou null quando não há ficha — a não ser com `vago`, que devolve o marcador
   invisível para a linha não perder o alinhamento.

   <a> DE VERDADE, e não um botão com window.open: o clique do meio abre em aba nova, o
   Ctrl+clique e o "copiar endereço do link" funcionam, e nenhum bloqueador de pop-up entra no
   caminho.
   O CLIQUE SOBE ATÉ O document DE PROPÓSITO. O link nunca mora dentro da linha (ver faixa), então
   não há o que proteger — e o menu do botão direito (hub-almoxpick » menu) fecha justamente num
   clique que chega ao document: com stopPropagation aqui, abrir a ficha deixava o "Apagar da
   biblioteca…" boiando sobre a lista. Só o mousedown para aqui, para não iniciar arrasto. */
function link(alvo, opts){
  const o = opts || {};
  const href = url(alvo, o.odooId);
  if (typeof document === 'undefined') return null;
  poeCss();
  if (!href){
    if (!o.vago) return null;
    const v = document.createElement('span');
    v.className = 'odoo-lk vago';
    v.textContent = o.texto || 'Odoo ↗';
    v.setAttribute('aria-hidden', 'true');
    return v;
  }
  const a = document.createElement('a');
  a.className = 'odoo-lk' + (o.grande ? ' grande' : '');
  a.textContent = o.texto || 'Odoo ↗';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  const n = o.nItens != null ? o.nItens
          : (alvo && Array.isArray(alvo.itens) && !o.odooId ? alvo.itens.length : 0);
  a.title = 'abrir ' + (o.nome ? 'a ficha de ' + o.nome : 'a ficha do produto') + ' no Odoo'
          + (n > 1 ? '  (este valor junta ' + n + ' fichas; abre a primeira)' : '');
  a.addEventListener('mousedown', e => e.stopPropagation());
  return a;
}

/* BOTÃO DENTRO DE BOTÃO NÃO EXISTE. As linhas das listas são <button> (clicar escolhe), e o
   link precisa ser clicável por conta própria: aninhar um no outro é HTML inválido e o
   navegador desmonta a árvore sozinho — some o clique de um dos dois, sem aviso. Então a linha
   vai para dentro de um <div> e o link fica ao lado dela. Com `vago` (o padrão aqui) a linha
   sem ficha guarda o lugar, e as colunas continuam alinhadas. */
function faixa(botao, alvo, opts){
  if (typeof document === 'undefined') return botao;
  poeCss();
  const cx = document.createElement('div');
  cx.className = 'odoo-fx';
  cx.append(botao);
  const l = link(alvo, Object.assign({ vago: true }, opts || {}));
  if (l) cx.append(l);
  return cx;
}

return { ACAO, setFonte, base, tmplDe, url, tmplDoProduto, valorPorNome, fichaDoComp,
         link, faixa, poeCss };
})();
if (typeof module === 'object' && module.exports) module.exports = HubOdooLink;
