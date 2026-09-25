/* AltiumPCBMirror v2 - hub-almoxpick.js — escolher um COMPONENTE do almoxarifado.

   VOCABULÁRIO, que é a razão deste arquivo existir separado:
     COMPONENTE  a entrada da biblioteca. No almoxarifado é um VALOR — "CAP 0805 100nF 50V"
                 — e é o nome dele (`valores[].altium`) que o schematic.js grava em `sym`.
     FAMÍLIA     o símbolo do almoxarifado que agrupa esses valores ("CAPACITOR CERAMICO
                 [SMD]", 90 valores). Não é um componente: não se coloca família na folha.
     SÍMBOLO     só o desenho. Mora em Libs/symbols-lib.js e é outra tela.

   Este arquivo é autossuficiente de propósito — injeta o próprio CSS e desenha dentro do
   container que quem chama entregar, como o hub-dialog.js e o hub-odoolista.js fazem. Assim
   ele não entra no script inline do hub.html (que é do agente/page e onde este painel existe
   hoje, ~200 linhas, da linha 2670 em diante) nem engorda o schframe.js. O dia em que a aba
   Biblioteca quiser, ela carrega este mesmo arquivo e apaga a cópia dela.

   SÓ ALMOXARIFADO, por pedido explícito: `Libs/almox-basicos.js` e `Libs/almox-especiais.js`.
   A biblioteca da casa (Libs/schlib.js) fica FORA — a tela é uma ferramenta de migração, e
   oferecer a lib antiga seria oferecer justamente o que se quer deixar de usar. Medido nos
   14 projetos: 513 dos 824 componentes colocados ainda resolvem na casa; são eles que esta
   tela existe para trocar.                                                                */
"use strict";
var HubAlmoxPick = (function () {

const CSS = `
/* Nada de botao/input proprios: o modal do schframe ja empresta .btn, .input e .seg da casa.
   Aqui mora so o que e DESTE painel — a linha da familia e a linha do valor. */
.ap-fam{display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:baseline;
  width:100%; text-align:left; cursor:pointer; border:0; border-radius:var(--r-sm,4px);
  background:transparent; color:var(--text,#d8d8d8); padding:8px 10px; margin-bottom:1px;}
.ap-fam:hover{background:rgba(var(--tint,79,195,247),0.06);}
.ap-fam[aria-selected="true"]{background:rgba(var(--tint,79,195,247),0.12);
  box-shadow:inset 2px 0 0 var(--hi,#4fc3f7);}
.ap-fam .f{font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.ap-fam .s{font-size:11px; color:var(--text-4,#7a7a7a); white-space:nowrap;}
.ap-fam .s b{font-weight:600; color:var(--text-3,#9a9a9a);}
.ap-grupo{font-size:10px; letter-spacing:.09em; text-transform:uppercase; color:var(--text-4,#7a7a7a);
  padding:12px 2px 4px;}
/* o menu do botao direito. Vive no <body> e fecha em qualquer clique, rolagem ou Esc:
   menu que sobrevive a um scroll fica flutuando sobre outra coisa e clica no que nao devia.
   E o .menu da casca: --surface com o anel e a sombra do --shadow-menu, sem borda. Ele lia um
   --card que nenhuma pagina define, e por isso ficava escuro em todo tema. */
.ap-menu{position:fixed; z-index:9999; min-width:210px; padding:4px;
  background:var(--surface,#242424); border-radius:var(--r-sm,4px);
  box-shadow:var(--shadow-menu, 0 0 0 1px #3a3a3a, 0 8px 24px rgba(0,0,0,.45));}
.ap-menu button{display:block; width:100%; text-align:left; border:0; background:transparent;
  color:var(--text,#d8d8d8); font:12px var(--font,'Segoe UI',sans-serif); padding:7px 10px;
  border-radius:3px; cursor:pointer;}
.ap-menu button:hover{background:rgba(var(--tint,255,255,255),.09);}
.ap-menu button.perigo{color:var(--err,#ff6b6b);}
.ap-menu button.perigo:hover{background:var(--err-soft,rgba(255,107,107,.12));}
.ap-menu .ap-menu-alvo{font-size:10px; color:var(--text-4,#7a7a7a); padding:5px 10px 6px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:260px;}
/* o valor: e ele o COMPONENTE que vai para a folha */
.ap-val{display:grid; grid-template-columns:minmax(0,1fr) auto auto; gap:10px; align-items:baseline;
  width:100%; text-align:left; cursor:pointer; border:0; border-radius:var(--r-sm,4px);
  background:transparent; color:var(--text,#d8d8d8); padding:6px 10px; margin-bottom:1px;}
.ap-val:hover{background:rgba(var(--tint,79,195,247),0.06);}
.ap-val[aria-selected="true"]{background:rgba(var(--tint,79,195,247),0.14);
  box-shadow:inset 2px 0 0 var(--hi,#4fc3f7);}
.ap-val .v{font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.ap-val .k{font:10px var(--mono,Consolas,ui-monospace,monospace); color:var(--text-4,#7a7a7a); white-space:nowrap;}
.ap-val .q{font-size:11px; font-variant-numeric:tabular-nums; color:var(--ok,#00e676); min-width:3ch; text-align:right;}
.ap-val .q.zero{color:var(--text-4,#7a7a7a);}
/* a recomendacao: o componente de mesmo nome que o Altium mandou. Ela se anuncia, senao
   ninguem sabe por que aquele veio marcado. */
.ap-val .rec, .ap-fam .rec{font-size:10px; color:var(--hi,#4fc3f7); white-space:nowrap;}
.ap-vazio{font-size:12px; color:var(--text-4,#7a7a7a); padding:16px 10px; line-height:1.5;}
`;

let cssPosto = false;
function poeCss(){
  if (cssPosto) return;
  cssPosto = true;
  const st = document.createElement('style');
  st.id = 'ap-css'; st.textContent = CSS;
  document.head.appendChild(st);
}

function el(tag, cls, text){
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ── os dados ──
   Lidos dos globais que o schframe.html já carrega. NÃO se lê o SLIB aqui: ele mistura os
   acervos, e a mistura é justamente o que esta tela não quer. */
/* Os acervos saem do PRÓPRIO índice do almoxarifado (Libs/almox-index.js » libs), com id,
   título, arquivo e nome de variável — os mesmos que a aba Biblioteca usa. Cravar isso aqui
   faria duas listas de acervo no projeto, e a que eu cravasse envelheceria primeiro. O par
   [global, título] de reserva existe só para o caso de o índice não ter carregado. */
const RESERVA = [
  { id: 'almox-basicos',   title: 'Almoxarifado — Básicos',   file: 'Libs/almox-basicos.js',   var: 'almoxBasicos' },
  { id: 'almox-especiais', title: 'Almoxarifado — Especiais', file: 'Libs/almox-especiais.js', var: 'almoxEspeciais' },
];
function acervos(){
  const ix = window.almoxIndex;
  const libs = (ix && ix.libs && ix.libs.length) ? ix.libs : RESERVA;
  return libs.filter(l => l && l.var && window[l.var]);
}

const saldoDe = v => (v.itens || []).reduce((a, i) => a + (Number(i.estoque) || 0), 0);

/* ── A LINHA DO CONECTOR ──
   "4 vias 3.81 180 femea". Ela é MONTADA AQUI, na tela, a partir dos campos que o gerador
   emite soltos em `valores[].conn` (tools/almox/conectores.py). Não é o rótulo do valor e
   não pode ser: o rótulo é a chave do livro-razão (Libs/almox-parts.json) e metade da
   identidade do valor — `agrupar()` chaveia por (rótulo, encapsulamento), então dois
   produtos com o mesmo rótulo VIRAM UM, com o estoque somado. Medido no dump: esta frase
   se repete em 27 dos 327 conectores; como rótulo, funde sete blocos terminais Phoenix
   diferentes — macho e fêmea juntos — num componente só.
   Campo que o Odoo não diz simplesmente não aparece: em CIRCULAR MIL e RÉGUA TERMINAL o
   passo e o ângulo não existem como propriedade da peça. */
function linhaConn(c){
  if (!c) return '';
  const p = [];
  if (c.vias) p.push(c.vias + (c.vias === 1 ? ' via' : ' vias'));
  if (c.matriz) p.push('(' + c.matriz + ')');
  if (c.passo != null) p.push(String(c.passo));
  if (c.angulo) p.push(c.angulo + '°');
  if (c.genero) p.push(c.genero);
  return p.join(' ');
}

/* A CHAVE DO GRUPO — o texto de uma linha da lista da esquerda.
   Era o nome do SÍMBOLO, e por isso a esquerda tinha 148 linhas: nos ESPECIAIS o símbolo
   se parte por número de pinos (CIRCUITO INTEGRADO [8P], [14P], [16P]…) porque o desenho
   precisa ter N pinos — e isso é verdade sobre o DESENHO, não sobre como se procura uma
   peça. Agrupando por família são 82 linhas, e o número de pinos desce para o rótulo do
   valor, onde ele é um dado a mais em vez de um labirinto.
   O conector não depende disto: lá o corte foi feito no gerador, e ele já tem um símbolo
   por subtipo, com a pinagem no próprio valor (`valores[].parts`).
   A montagem continua partindo — só nos BÁSICOS, onde o símbolo é mesmo partido por ela
   (RESISTOR [SMD] / RESISTOR [PTH]). Nos especiais `montagem` é só a do primeiro item que
   criou o símbolo (ver almox2lib » monta_simbolo) e dividir por ela seria dividir por acaso. */
function chaveDoGrupo(sy){
  const fam = String(sy.familia || sy.name || '');
  return (sy.grupo === 'basicos' && sy.montagem) ? fam + ' [' + sy.montagem + ']' : fam;
}

/* a ordem DENTRO da família: primeiro por número de vias, depois passo, depois o rótulo.
   Alfabética sobre o nome do símbolo dava "10V, 12V, 13V, …, 2V, 20V", e juntar vários
   símbolos numa linha só espalharia essa bagunça pela lista da direita inteira. */
function ordemDoValor(it){
  const c = it.conn || {};
  return [Number(c.vias) || 0, c.passo == null ? 1e9 : Number(c.passo), it.rotulo || ''];
}
function comparaValor(a, b){
  const x = ordemDoValor(a), y = ordemDoValor(b);
  if (x[0] !== y[0]) return x[0] - y[0];
  if (x[1] !== y[1]) return x[1] - y[1];
  return String(x[2]).localeCompare(String(y[2]), 'pt-BR', { numeric: true });
}

/* [{familia, sym, acervo, valores:[{v, sym, nome, saldo, pkg}]}] — uma entrada por FAMÍLIA
   do almoxarifado, com os valores de todos os símbolos dela. `nome` é o que vai para o
   schematic.js (`v.altium`).
   Cada item carrega o `sym`/`lib` DE ONDE ELE VEIO. É obrigatório desde que o grupo deixou
   de ser um símbolo só: a prévia do desenho, o "Editar símbolo" e o `/api/symbols/almox-*`
   precisam do símbolo do COMPONENTE ESCOLHIDO, e `g.sym` agora é só o primeiro da família. */
function grupos(){
  const porChave = new Map();
  for (const a of acervos()){
    const lib = window[a.var];
    const titulo = String(a.title || '').replace(/^Almoxarifado\s*[—-]\s*/i, '').toLowerCase();
    /* o descritor viaja com o grupo: e ele que o "Editar simbolo" entrega ao editor, que
       precisa TROCAR DE ACERVO antes de achar a familia — medido, sem isso a aba abre, a
       familia aparece em ST.sel e o desenho vem vazio */
    const acervo = { id: a.id, title: a.title, file: a.file, varName: a.var };
    for (const sy of ((lib && lib.symbols) || [])){
      const vals = (sy.valores || []).filter(v => v && v.altium).map(v => ({
        v, sym: sy, lib: acervo, nome: v.altium, rotulo: v.label || v.altium,
        saldo: Number(v.estoque) || saldoDe(v),
        pkg: v.footprint || (v.pkgs || [])[0] || '',
        /* 956 dos 2513 valores trazem MPN, em 97 das 148 familias — e o part number e
           justamente o que se tem na mao quando se olha a peca ou o esquema antigo. Sem
           ele na busca, digitar "SZMMSZ5240BT1G" nao achava o DIODO ZENER [PTH] que o
           carrega, e a tela dizia "nenhuma familia casa" tendo a resposta dentro. */
        mpn: String((v.mpn || '')).trim(),
        /* SAIU DO ODOO (ou perdeu a marca "e componente eletronico"): continua na lib,
           com saldo zero e o numero de part reservado, para nao renumerar as outras. */
        fora: !!v.fora,
        conn: v.conn || null,
        linha: linhaConn(v.conn),
        /* o codigo do fabricante (MC 1,5/4-G-3,81, 2510, BBPTC-4). E ele que separa duas
           linhas identicas em vias/passo/angulo, e e o que se tem na mao olhando a peca. */
        tipo: String(((v.conn || {}).tipo) || '').trim(),
      }));
      if (!vals.length) continue;
      const chave = chaveDoGrupo(sy);
      let g = porChave.get(chave);
      if (!g){
        g = { familia: chave, sym: sy, acervo: titulo, lib: acervo, valores: [], acervos: new Set() };
        porChave.set(chave, g);
      }
      g.acervos.add(titulo);
      for (const it of vals) g.valores.push(it);
    }
  }
  const fora = [];
  for (const g of porChave.values()){
    g.valores.sort(comparaValor);
    /* uma familia pode cruzar os dois acervos — os conectores sem pinagem legivel ficam nos
       especiais enquanto os irmaos dela estao nos basicos. O titulo diz os dois. */
    g.acervo = [...g.acervos].sort().join(' + ');
    delete g.acervos;
    fora.push(g);
  }
  fora.sort((a, b) => a.familia.localeCompare(b.familia, 'pt-BR'));
  return fora;
}

/* o componente recomendado: o que tem o MESMO nome que o Altium mandou. É de longe o caso
   comum — medido, 448 dos 824 componentes dos projetos casam por nome exato. */
function recomendado(gs, ...nomes){
  /* DOIS nomes entram, nesta ordem: o que o Altium mandou em `sym` e o nome em que ele
     RESOLVEU (por renomeação, chave ou escolha gravada em lib-subs.js). O segundo importa
     tanto quanto o primeiro — um componente já apontado para "SN74HC245DWR" tem no nome
     resolvido a resposta que o nome cru (um hash de 32 letras) não tem. */
  for (const n of nomes){
    const alvo = String(n == null ? '' : n).trim();
    if (!alvo) continue;
    for (const g of gs) for (const it of g.valores)
      if (it.nome === alvo) return { grupo: g, item: it, por: alvo };
  }
  return null;
}

/* ── NÚMERO PROCURADO É NÚMERO INTEIRO, não pedaço de outro ──
   Quem digita "10" está dizendo DEZ VIAS, e `indexOf` achava o "10" de dentro do número de
   pedido `(0710196)` — o bloco terminal de 4 vias entrava na busca por "10". A fronteira é
   de DÍGITO, não de palavra: "10" tem de casar "10 vias" e "SMD 0805 10K", e não pode casar
   "110 vias" nem "100nF". Só vale para o termo puramente numérico; "100NF" e "BPSC-40"
   continuam sendo procurados como texto.
   O regex é montado uma vez por termo e guardado: são 2.545 valores por tecla digitada. */
const _regras = new Map();
function regraDoTermo(q){
  let r = _regras.get(q);
  if (!r){
    const num = /^[0-9]+(?:[.,][0-9]+)?$/.test(q);
    r = { num: num, letra: /[A-Z]/.test(q),
          rx: num ? new RegExp('(?<![0-9])' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                               + '(?![0-9])') : null };
    if (_regras.size > 400) _regras.clear();        // a busca é por tecla: não acumula
    _regras.set(q, r);
  }
  return r;
}
function casa(txt, q){
  const s = String(txt || '').toUpperCase();
  if (!s || !q) return false;
  const r = regraDoTermo(q);
  return r.rx ? r.rx.test(s) : s.indexOf(q) >= 0;
}
/* part number se escreve dos dois jeitos: "CDSOT23-SM712" e "CDSOT23SM712", "SZMMSZ 5240"
   e "SZMMSZ5240". Comparar so o literal faz a busca depender de quem digitou o hifen no
   mesmo lugar que o fornecedor. Vale SO para o MPN: tirar separador dos outros campos
   faria "CAP 0805" casar com "CAP0805" e tambem com coisas que nao se quer. */
/* A VIRGULA ENTRA NA LISTA por causa do conector. O mesmo bloco terminal Phoenix esta
   cadastrado no Odoo como "MC 1,5/ 4-STF-3,81" e como "MC 1.5/ 4-STF-3.81" — decimal
   brasileiro numa linha, ponto na outra, no mesmo catalogo. Sem a virgula aqui, quem
   digitasse a forma que NAO fosse a da linha procurada recebia lista vazia; medido no
   navegador com o codigo lido da propria peca. */
const semSep = t => String(t || '').toUpperCase().replace(/[\s\-\/.,]/g, '');
/* O caminho SEM SEPARADOR é para PART NUMBER, e por isso exige LETRA no termo. Um número
   solto colapsado perde o sentido e casa qualquer coisa: "2.54" vira "254", e "254" existe
   dentro de `DFK-MSTB 2,5/ 4-GF-5,08` — que é passo 5,08 — porque o "2,5/ 4" da bitola e da
   contagem de vias encosta um no outro quando a vírgula e a barra saem. Medido no navegador:
   era esse o caminho que fazia "10 conector 2.54 bloco terminal" devolver um conector de 4
   vias e passo 5,08. */
const casaMpn = (mpn, q, qSem) => !!mpn && (casa(mpn, q)
  || (regraDoTermo(q).letra && qSem.length >= 3 && semSep(mpn).indexOf(qSem) >= 0));

/* O FILTRO DE SALDO, mais o `fora`. Zerado e fora nao sao a mesma coisa e o olho nao
   separa: os dois aparecem com 0 do lado direito. Zerado e peca do catalogo que acabou e
   vai voltar na proxima compra; FORA e peca que saiu do Odoo -- ou que perdeu a marca
   "e componente eletronico" -- e so volta se alguem mexer no cadastro. Quem esta caçando
   o que sumiu precisa de uma lista so com esses, e "Zerados" traz os dois misturados. */
const passa = (it, filtro) => filtro === 'stock' ? it.saldo > 0 && !it.fora
                            : filtro === 'nostock' ? it.saldo <= 0 && !it.fora
                            : filtro === 'fora' ? !!it.fora : true;

/* UM predicado para as duas listas. A da esquerda (familias) e a da direita (valores)
   filtravam com duas copias da mesma condicao — e enquanto forem duas, acrescentar um campo
   numa delas faz a familia aparecer na esquerda e a direita dizer "nenhum componente desta
   familia passa no filtro", que e o pior jeito de errar: parece bug da tela, nao da busca. */
function valorCasa(it, q, qSem){
  return !q || casa(it.rotulo, q) || casa(it.nome, q) || casa(it.pkg, q)
           || casaMpn(it.mpn, q, qSem)
           /* Os campos do conector, e o NOME DO SÍMBOLO junto. Os dois são regressão se
              faltarem: a linha da esquerda deixou de trazer o número de vias (era
              "CONECTOR 10V", hoje é "CONECTOR HEADER SEM TRAVA"), então quem digita "10V"
              ou "10 vias" agora depende só daqui. `it.linha` responde por "10 vias",
              "3.81", "90°" e "femea"; `it.sym.name` responde pelo "10V" de quem tem o
              costume antigo — e pelo "[8P]" dos especiais. */
           || casa(it.linha, q) || casaMpn(it.tipo, q, qSem)
           || casa(it.sym && it.sym.name, q);
}

/* ── A BUSCA POR PALAVRAS SOLTAS ──
   `10 conector 2.54 bloco terminal` tem de achar o bloco terminal de 10 vias e passo 2,54.
   A busca era UM pedaço de texto procurado inteiro, então essa frase não achava nada: ela
   não existe literalmente em campo nenhum, e nem podia — metade dela descreve a FAMÍLIA
   ("conector bloco terminal") e a outra metade o COMPONENTE ("10", "2.54").

   Agora cada palavra é uma exigência à parte, e cada uma pode ser satisfeita pela família
   OU pelo valor. Quem digita uma palavra só continua com o comportamento de antes, porque
   uma palavra é o caso de uma lista de uma. */
function termos(busca){
  const q = String(busca || '').trim().toUpperCase();
  if (!q) return [];
  return q.split(/\s+/).filter(Boolean).map(t => ({ t: t, sem: semSep(t) }));
}
const termoCasa = (it, famUp, x) => casa(famUp, x.t) || valorCasa(it, x.t, x.sem);

/* os valores de UMA família que passam na busca e no filtro de saldo.
   É a única implementação: a lista da esquerda conta o que esta função devolve e a da
   direita mostra exatamente isto. Enquanto foram duas cópias da condição, acrescentar um
   campo numa fazia a família aparecer à esquerda e a direita dizer "nenhum componente desta
   família passa no filtro" — que parece bug da tela, não da busca. */
function visiveis(g, busca, filtro){
  const ts = termos(busca);
  const famUp = String((g && g.familia) || '').toUpperCase();
  /* A BUSCA INTEIRA CONTINUA VALENDO, ao lado das palavras soltas. Um part number tem
     espaço dentro ("MC 1.5/ 4-STF-3.81") e é exatamente ele que a pessoa cola no campo:
     partido em palavras, o pedaço "1.5/" vira "15" sem separadores — curto demais para o
     piso de 3 caracteres — e o código deixava de achar a própria peça. Aceitar as duas
     leituras é um superconjunto do que havia antes, então nada que achava deixa de achar. */
  const inteiro = ts.length > 1
    ? { t: String(busca || '').trim().toUpperCase(), sem: semSep(busca) } : null;
  return ((g && g.valores) || []).filter(it => passa(it, filtro || 'all')
    && (ts.every(x => termoCasa(it, famUp, x))
        || (inteiro && termoCasa(it, famUp, inteiro))));
}

/* A família entra na lista quando ELA casa a busca ou quando algum VALOR dela casa: quem
   digita "cap" quer a família, quem digita "4.7pF" quer a família que a contém. Sem as duas
   pontas, metade das buscas volta vazia sem explicar por quê. */
function filtra(gs, busca, filtro){
  const fora = [];
  for (const g of gs){
    const vis = visiveis(g, busca, filtro);
    if (vis.length) fora.push({ g, vis });
  }
  return fora;
}

/* os números dos três botões do .seg — contados no acervo inteiro, não no que está filtrado:
   um contador que muda junto com o próprio filtro não informa nada */
function contagens(gs){
  let tudo = 0, comSaldo = 0, fora = 0;
  for (const g of gs) for (const it of g.valores){
    tudo++;
    if (it.fora) fora++;
    else if (it.saldo > 0) comSaldo++;
  }
  return { tudo, comSaldo, fora, zerados: tudo - comSaldo - fora };
}

/* ── ESQUERDA: só as FAMÍLIAS ──
   `opts`: { grupos, busca, filtro, sel (nome da família), rec, onPick(g), onContagem(n,tot) } */
function renderFamilias(box, opts){
  poeCss();
  const o = opts || {}, gs = o.grupos || grupos();
  box.textContent = '';
  const linhas = filtra(gs, o.busca, o.filtro || 'all');

  if (!linhas.length){
    box.append(el('div', 'ap-vazio', (gs.length
      ? 'nenhuma família do almoxarifado casa com esta busca.'
      : 'os espelhos do almoxarifado não carregaram (Libs/almox-basicos.js e '
        + 'almox-especiais.js). Rode o sincronismo e recarregue a biblioteca.')));
    if (o.onContagem) o.onContagem(0, gs.length);
    return;
  }
  /* a família da recomendação sobe para o topo: é a resposta provável, e procurá-la entre
     148 famílias é justamente o trabalho que esta tela existe para poupar */
  if (o.rec){
    const i = linhas.findIndex(x => x.g === o.rec.grupo);
    if (i > 0) linhas.unshift(linhas.splice(i, 1)[0]);
  }
  for (const { g, vis } of linhas){
    const b = el('button', 'ap-fam');
    b.type = 'button';
    b.dataset.fam = g.familia;
    b.setAttribute('aria-selected', String(o.sel === g.familia));
    const f = el('span', 'f', g.familia);
    f.title = g.familia + ' · ' + g.acervo;
    b.append(f);
    const dir = el('span', 's');
    if (o.rec && o.rec.grupo === g) dir.append(el('span', 'rec', '↩ '));
    const n = el('b', null, String(vis.length));
    dir.append(n, document.createTextNode(vis.length === 1 ? ' valor' : ' valores'));
    b.append(dir);
    b.onclick = () => { if (o.onPick) o.onPick(g); };
    box.append(b);
  }
  if (o.onContagem) o.onContagem(linhas.length, gs.length);
}

/* ── DIREITA, debaixo do símbolo: os VALORES da família escolhida ──
   É aqui que se escolhe o COMPONENTE — o valor é que vai para o schematic.js.
   `opts`: { busca, filtro, sel (nome do valor), rec, onPick(it, g) } */
/* ── O MENU DO BOTAO DIREITO ──
   Generico de proposito: quem chama diz o alvo e as acoes. O arquivo continua sem saber o que
   e um servidor — quem sabe disso e o `excluirValor` logo abaixo, e mesmo ele recebe o que
   precisa por parametro. */
let menuAberto = null;
function fechaMenu(){
  if (!menuAberto) return;
  menuAberto.remove();
  menuAberto = null;
  window.removeEventListener('scroll', fechaMenu, true);
  window.removeEventListener('resize', fechaMenu);
}
function menu(x, y, titulo, acoes){
  poeCss();
  fechaMenu();
  const m = el('div', 'ap-menu');
  if (titulo) m.append(el('div', 'ap-menu-alvo', titulo));
  for (const a of acoes){
    const b = el('button', a.perigo ? 'perigo' : null, a.rotulo);
    b.type = 'button';
    b.onclick = ev => { ev.stopPropagation(); fechaMenu(); a.onEscolher(); };
    m.append(b);
  }
  document.body.append(m);
  /* encosta na borda: sem isto o menu aberto no rodape da lista fica metade fora da tela */
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, window.innerWidth  - r.width  - 6)) + 'px';
  m.style.top  = Math.max(4, Math.min(y, window.innerHeight - r.height - 6)) + 'px';
  menuAberto = m;
  setTimeout(() => {
    document.addEventListener('click', fechaMenu, { once: true });
    document.addEventListener('contextmenu', fechaMenu, { once: true });
  }, 0);
  window.addEventListener('scroll', fechaMenu, true);
  window.addEventListener('resize', fechaMenu);
  return m;
}
/* O ESC FECHA O MENU E PARA AI. Sem o stopPropagation ele seguia viagem e o Escape da vista
   fechava o MODAL inteiro junto — quem abriu o menu sem querer perdia a tela de troca. O
   evento so e consumido quando havia menu aberto: fora isso o Escape continua sendo o botao
   de panico de sempre. Em captura, para chegar antes do handler de window da vista.

   O guard de `document` e o que deixa este arquivo ser CARREGADO EM NODE. Sem ele o require
   do teste morria aqui, no topo do modulo, antes de qualquer assercao -- e `filtra`/`valorCasa`,
   que sao as funcoes que mais silenciosamente erram (busca que nao acha nao levanta excecao,
   so devolve vazio), ficavam sem teste nenhum. Mesmo recurso do hub-converte.js:478. */
if (typeof document !== 'undefined') document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !menuAberto) return;
  e.stopPropagation();
  e.preventDefault();
  fechaMenu();
}, true);

/* ── EXCLUIR UM VALOR DA BIBLIOTECA ──
   Duas idas ao servidor de proposito: a primeira SO PERGUNTA (previa), e e ela que traz quem
   usa o item nos projetos. Perguntar antes de apagar e o que transforma "excluir" numa decisao
   informada em vez de um susto — o usuario pediu para ser avisado, nao barrado.

   O `io` e o adaptador da tela que chamou: a vista Esquema tem HubDialog e HubIO, a aba
   Biblioteca do hub tem os proprios. Assim o fluxo (e o texto da pergunta) existe UMA vez. */
async function excluirValor(alvo, io){
  const corpo = { familia: alvo.familia, componente: alvo.componente };
  let previa;
  try {
    previa = await io.post('/api/symbols/almox-excluir', corpo);
  } catch (e) {
    io.toast('não consegui perguntar ao servidor: ' + (e && e.message || e), 'err', 7000);
    return false;
  }
  if (!previa || !previa.ok){
    io.toast((previa && previa.error) || 'o servidor recusou', 'err', 7000);
    return false;
  }
  const usos = previa.usos || [];
  const quantos = usos.reduce((n, u) => n + (u.refs || []).length, 0);
  let texto = 'Apagar “' + (previa.label || alvo.componente) + '” da biblioteca?\n\n'
            + 'Ele sai do acervo agora. Quem decide se volta é o Odoo: se o produto ainda '
            + 'existir lá, a próxima sincronização o traz de volta com o mesmo número — é '
            + 'assim que se desfaz um engano. Some de vez só o que já não está mais no Odoo, '
            + 'que é o caso dos duplicados.';
  if (quantos){
    texto += '\n\nEM USO por ' + quantos + (quantos === 1 ? ' componente' : ' componentes') + ':\n'
           + usos.map(u => '  · ' + u.projeto + ': ' + (u.refs || []).join(', ')).join('\n')
           + '\n\nEsses componentes ficam órfãos (quadrado vermelho na folha) até você trocá-los.';
  } else {
    texto += '\n\nNão está em uso em nenhum projeto do workspace.';
  }
  const sim = await io.confirm(texto, { title: 'Apagar da biblioteca',
                                        ok: 'Apagar', danger: true });
  if (!sim) return false;
  let r;
  try {
    r = await io.post('/api/symbols/almox-excluir', Object.assign({ confirmar: true }, corpo));
  } catch (e) {
    io.toast('não consegui excluir: ' + (e && e.message || e), 'err', 7000);
    return false;
  }
  if (!r || !r.ok){
    io.toast((r && r.error) || 'o servidor recusou a exclusão', 'err', 7000);
    return false;
  }
  io.toast('“' + (r.label || alvo.componente) + '” saiu da biblioteca', 'ok');
  for (const a of (r.avisos || [])) io.toast(a, 'warn', 9000);
  if (io.recarregar) await io.recarregar();
  return true;
}

function renderValores(box, g, opts){
  poeCss();
  const o = opts || {};
  box.textContent = '';
  if (!g){
    box.append(el('div', 'ap-vazio', 'escolha uma família à esquerda para ver os componentes dela.'));
    return;
  }
  const ts = termos(o.busca);
  const vis = visiveis(g, o.busca, o.filtro);

  const h = el('div', 'ap-grupo');
  h.append(document.createTextNode(vis.length + (vis.length === 1 ? ' componente' : ' componentes')
                                   + ' de ' + g.familia));
  box.append(h);
  if (!vis.length){
    box.append(el('div', 'ap-vazio', 'nenhum componente desta família passa no filtro.'));
    return;
  }
  for (const it of vis){
    const b = el('button', 'ap-val');
    b.type = 'button';
    b.dataset.nome = it.nome;
    b.setAttribute('aria-selected', String(o.sel === it.nome));
    /* O CONECTOR SE MOSTRA PELOS CAMPOS: "4 vias 3.81 180° femea" em vez de
       "Bloco Terminal MC 1,5/ 4-STF-3,81 (1827729)". É o que se procura numa gaveta, e é o
       pedido. Só quando a linha tem o número de vias, porque sem ele ela vira um "3.81"
       solto — aí vale mais o rótulo do Odoo, que ao menos diz a cor do borne. O nome
       inteiro do produto continua no title, que é onde ele é útil: na conferência. */
    const conn = it.conn && it.conn.vias ? it.linha : '';
    const v = el('span', 'v', conn || it.rotulo);
    v.title = (conn ? it.rotulo + '\n' : '') + it.nome
            + (it.pkg ? '\n' + it.pkg : '') + (it.mpn ? '\nMPN ' + it.mpn : '');
    b.append(v);
    /* achou POR CAUSA do MPN: mostre o MPN. "SZMMSZ5240BT1G" devolvendo "PTH 10V 0.5W"
       parece resultado errado ate se ver que o part number esta nele. */
    /* achou POR CAUSA do MPN — agora com a busca por palavras, basta UMA delas ter casado
       só ali. "SZMMSZ5240BT1G" devolvendo "PTH 10V 0.5W" parece resultado errado até se ver
       que o part number está nele. */
    const porMpn = !!it.mpn && ts.some(x =>
      !casa(it.rotulo, x.t) && !casa(it.nome, x.t) && casaMpn(it.mpn, x.t, x.sem));
    if (o.rec && o.rec.item === it) b.append(el('span', 'rec', '↩ mesmo nome'));
    else if (porMpn) b.append(el('span', 'k', it.mpn));
    /* no fim da linha, o código do fabricante — que em conector é o que identifica a peça
       (não existe "encapsulamento 0805" de bloco terminal). Sem ele cai para o encap, como
       em todas as outras famílias. */
    else b.append(el('span', 'k', it.tipo || it.pkg || ''));
    const q2 = el('span', 'q' + (it.saldo > 0 ? '' : ' zero'), String(it.saldo));
    q2.title = it.saldo > 0 ? it.saldo + ' em estoque' : 'sem saldo no almoxarifado';
    b.append(q2);
    b.onclick = () => { if (o.onPick) o.onPick(it, g); };
    /* o botao direito NAO seleciona: quem abre o menu esta mirando aquela linha, e trocar a
       selecao por baixo faria o "Usar este componente" apontar para outra coisa */
    if (o.onExcluir) b.oncontextmenu = ev => {
      ev.preventDefault(); ev.stopPropagation();
      menu(ev.clientX, ev.clientY, it.rotulo, [
        { rotulo: 'Apagar da biblioteca…', perigo: true, onEscolher: () => o.onExcluir(it, g) },
      ]);
    };
    /* o "Odoo ↗" ao lado da linha, nunca dentro: a linha é um <button> (hub-odoolink » faixa).
       Sem o hub-odoolink carregado a lista continua sendo a de sempre. */
    box.append(typeof HubOdooLink !== 'undefined'
      ? HubOdooLink.faixa(b, it.v, { nome: it.rotulo }) : b);
  }
}

/* `filtra` e `valorCasa` saem no export por serem PUROS e por serem a regra que mais
   silenciosamente erra: busca que nao acha nao levanta excecao, so devolve vazio e
   parece que a peca nao existe. tests/test-almoxpick.js os exercita em Node. */
return { grupos, recomendado, contagens, renderFamilias, renderValores, poeCss,
         menu, fechaMenu, excluirValor,
         filtra, valorCasa, semSep,
         /* puros tambem, e pela mesma razao: `chaveDoGrupo` decide quantas linhas a
            esquerda tem, `linhaConn` e o texto que o usuario le no lugar do rotulo e
            `comparaValor` e a ordem da lista da direita. Errar qualquer um dos tres nao
            levanta excecao — so mostra a lista errada. */
         chaveDoGrupo, linhaConn, comparaValor, termos, visiveis };
})();
if (typeof module === 'object' && module.exports) module.exports = HubAlmoxPick;
