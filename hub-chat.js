/* AltiumPCBMirror v2 - hub-chat.js — a conversa com o Claude OPERADOR do hub.

   O que este arquivo é: a CASCA da conversa. Ele desenha a lista de mensagens, recebe o
   texto enquanto chega, mostra o que o Claude fez (as ferramentas), oferece o cartão de
   proposta com os dois botões e cuida dos anexos. Ele NÃO fala com a Anthropic e não
   escreve em disco: quem fala é o `tools/chat/chatserver.py`, quem decide é o motor que
   estiver atrás dele. O navegador nunca vê CHAVE nenhuma — é a mesma regra que o
   /hub-almox.json já quebrou uma vez, vazando a senha do Odoo em texto claro para a LAN
   inteira, e que não se quebra de novo. (A senha mestre do hub, essa sim, o navegador
   guarda: veja "entrar", logo abaixo.)

   ── DOIS MOTORES, e a tela diz qual ──
   O servidor responde no /estado qual está atrás, e a tela muda de acordo:

     motor "cli"  o `claude` DA MÁQUINA que serve o hub, subido como subprocesso
                  (tools/chat/claude_cli.py). É literalmente o acesso de terminal do Claude
                  Code com outra cara: o login é o que já está na máquina, não há chave de
                  API, e as ferramentas são as dele (Read, Edit, Write, Bash, Grep…). Aqui
                  existe o SELETOR DE COLEIRA colado no campo de escrever — é ele que diz
                  até onde o Claude pode ir — e NÃO existe cartão de proposta: o Claude
                  edita direto. O dólar que o CLI relata é QUANTO CUSTARIA pela API; quem
                  está na assinatura não paga aquilo, e por isso ele só aparece com a frase
                  que diz o que é (ver `desenhaEquiv`).
     motor "api"  a chave da Anthropic no ambiente do container (tools/chat/claude_api.py),
                  com as ferramentas do `tools/chat/operador.py` — que devolvem PROPOSTA e
                  não gravam nada. É o caminho do servidor (192.168.15.192:8100), onde não
                  há `claude` instalado nem login de ninguém. Aí o cartão de proposta e o
                  contador em dólar valem, e o seletor de coleira não aparece.

   Servidor mais velho que esta tela responde só `chave:bool`, e nada aqui quebra por isso:
   campo ausente vira "não sei", e "não sei" não desliga funcionalidade nenhuma.

   Autossuficiente de propósito — injeta o próprio CSS e o próprio DOM. São duas portas:

     HubChat.instala(io)          põe no <body> um botão na borda direita (a estrela do
                                  Claude) e um painel encostado nessa borda, que abre e fecha
                                  no clique, tem a largura arrastável e lembrada, e fecha no
                                  Esc. Aberto, ele EMPURRA o hub para o lado em vez de cobri-lo
                                  (um padding no <body>, veja `empurra`). É a porta normal: NÃO
                                  precisa de container, e do hub.html não precisa de linha
                                  nenhuma além do <script src>.
     HubChat.monta(container, io) o mesmo painel embutido num container, para quem quiser o
                                  chat dentro de uma aba.

   O botão mora no documento de FORA porque as vistas Esquema e PCB são IFRAME: um elemento
   fixo daqui fica por cima do iframe inteiro, e por isso um lançador só cobre todas as telas
   — sem cópia dentro dos frames para manter em dia.

   ── entrar ──
   O painel abre pedindo a SENHA MESTRE DO HUB (a mesma do "Excluir projeto"), porque é ela
   que TODA rota do chat exige (chatserver.py » _autoriza). Aceita, ela fica no localStorage
   deste navegador e vai no cabeçalho X-Hub-Senha de cada pedido; "Sair" apaga. É por isso
   que o painel fala com /api/chat/* por conta própria, e não pelo io.post/io.stream do hub:
   quem tem a credencial é ele. O `io` continua servindo para o resto — projeto, tela, canvas,
   toast e recarregar a vista.

   Não existe "entrar com a conta Claude" aqui, e não é esquecimento: aquele login é do Claude
   Code e não tem porta pública para um app de terceiro. A CHAVE da Anthropic também não passa
   por esta tela — ela mora no ambiente do container, e a tela de entrada mostra ONDE pôr, sem
   campo nenhum, porque não há rota que a grave (conferido no chatserver.py antes de escrever
   a tela). Campo que não grava é mentira bonita.

   ── O RECORTE, que é a parte que parece simples e não é ──
   Medido nas duas origens em que o hub roda:
     http://192.168.15.192:8100 (LAN, produção): isSecureContext=false, mediaDevices
       indefinido, getDisplayMedia ausente, clipboard.read bloqueado. Sobram: evento paste,
       input file, drag&drop e canvas.toBlob.
     http://127.0.0.1:8009 (localhost): tudo liberado, inclusive getDisplayMedia.
   Por isso o botão de recorte tem DOIS caminhos e nunca some. O que funciona em qualquer
   origem é recortar o CANVAS da vista — o desenho já mora em canvas, e o canvas está num
   iframe de MESMA ORIGEM, então dá para alcançá-lo e copiar o pedaço com drawImage. Capturar
   a tela inteira do Windows (o Altium, por exemplo) só existe em localhost/HTTPS; quando não
   existe, o `title` do botão diz por quê e ensina o Ctrl+V — o caminho do Win+Shift+S, que é o
   único que atravessa origem insegura. (Era uma linha de rodapé fixa embaixo do campo até
   16/09; saiu a pedido do dono, e o texto foi para o botão — veja `desenhaRecorte`.)

   ── Markdown não é renderizado, de propósito ──
   A resposta é texto curto, e o que importa de verdade aparece fora dela: no cartão de
   proposta (motor "api") ou nas linhas de ferramenta (motor "cli"). Renderizar markdown no
   meio do streaming custa um parser que reescreve o que já está na tela a cada pedaço que
   chega, e paga isso com nada.                                                            */
"use strict";
var HubChat = (function () {

/* ── rotas do chatserver.py ──
   Nomes fixados com o agente do servidor. O painel só conhece estes três.               */
const R = {
  estado:   '/api/chat/estado',    // { ok, ligado, motivo, motor, versao, modos, modo_padrao,
                                   //   modelos, modelo, projeto, teto } — servidor velho: chave:bool
  conversa: '/api/chat/conversa',  // SSE: texto / ferramenta / resultado / proposta / fim / erro
  aplicar:  '/api/chat/aplicar',   // { ok, resumo } — o ÚNICO lugar em que o disco é tocado
};

/* Preço por milhão de tokens. É tabela de RESERVA: o /api/chat/estado manda a dele, e a do
   servidor manda, porque lá é que vive o MODELOS do claude_api.py. Esta cópia existe para o
   contador não ficar mudo enquanto o estado não chega — e para ele não mentir mostrando
   "US$ 0,00" quando o preço é desconhecido: sem preço, o painel mostra só os tokens.     */
const PRECO = {
  'claude-opus-5':              { rotulo: 'Opus 5',   entrada: 5, saida: 25 },
  'claude-sonnet-5':            { rotulo: 'Sonnet 5', entrada: 2, saida: 10 },
  'claude-haiku-4-5-20251001':  { rotulo: 'Haiku 4.5', entrada: 1, saida: 5 },
};
const MODELO_PADRAO = 'claude-sonnet-5';

/* 1568 px no maior lado: acima disso a API redimensiona sozinha e cobra pelo que ela
   redimensionou — mandar 4K é pagar o dobro pela mesma imagem. O corte é feito aqui, no
   canvas, antes de virar base64, para a conta e o upload caírem juntos.                  */
const LADO_MAX   = 1568;
const TETO_IMG   = 5 * 1024 * 1024;   // teto por imagem da API
const TETO_TEXTO = 200 * 1024;        // arquivo de texto: 200 KB já é um schematic.js inteiro
const MIN_RECORTE = 8;                // px: abaixo disso o arrasto foi um clique, não um recorte

const CSS = `
/* Tokens da casa (--surface, --line, --text-*, --hi, --ok, --err…) vêm do hub.html; os
   fallbacks existem só para o painel não ficar invisível se alguém carregar este arquivo
   fora do hub. Tudo é escopado em .hc para não encostar em painel de outro dono. */
/* 15px, e nao os 14 do comeco: o dono pediu "aumenta a fonte pra ficar mais visual", e a base
   arrasta junto o botao, o seletor e o campo de escrever. O texto da conversa sobe mais do que
   a base (veja .hc-txt) — a base e a moldura, a conversa e o que se le. */
.hc{display:flex; flex-direction:column; min-height:0; height:100%;
  font:15px var(--font, system-ui, sans-serif); color:var(--text,#f2f2f3);}
.hc *{box-sizing:border-box;}

/* embrulha de propósito: no painel no mínimo (300 px, a largura que a pega permite) a fila da
   direita mede 311 px e empurrava o "Sair" para fora da tela — botão que existe e não dá para
   clicar é pior do que botão nenhum. Medido no headless, 16/09. */
.hc-topo{display:flex; flex-wrap:wrap; align-items:center; gap:6px 10px; flex:none;
  padding:8px 12px; border-bottom:1px solid var(--line,rgba(242,242,243,.14));}
.hc-topo .hc-tit{font-size:11px; letter-spacing:.09em; text-transform:uppercase;
  color:var(--text-3,#7a7a80);}
.hc-topo .hc-proj{font-size:12px; color:var(--text-2,#a8a8ae); overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; max-width:34ch;}
.hc-topo .hc-dir{margin-left:auto; display:flex; flex-wrap:wrap; justify-content:flex-end;
  align-items:center; gap:6px 8px;}
.hc-sel{min-height:26px; padding:2px 6px; font:inherit; font-size:12px;
  background:var(--surface,#1a1a1d); color:var(--text,#f2f2f3);
  border:1px solid var(--line,rgba(242,242,243,.14)); border-radius:var(--r-sm,5px);}

/* O contador. Fica sempre visível: quem paga a conta é o usuário, e conta que só aparece
   no fim do mês é conta que ninguém conferiu. */
.hc-conta{font:11px var(--mono,ui-monospace,Consolas,monospace); color:var(--text-3,#7a7a80);
  font-variant-numeric:tabular-nums; white-space:nowrap;}
.hc-conta b{font-weight:600; color:var(--text-2,#a8a8ae);}

.hc-lista{flex:1; min-height:0; overflow:auto; padding:14px 12px 6px;
  display:flex; flex-direction:column; gap:12px;}

.hc-msg{display:flex; flex-direction:column; gap:5px; max-width:100%;}
.hc-msg .hc-quem{font-size:10px; letter-spacing:.09em; text-transform:uppercase;
  color:var(--text-4,#57575d);}
/* O QUE SE LE: 13 → 15 px e a cor dita na regra, em vez de herdada. O dono disse que a
   escrita estava "apagada", e o apagado nao era so a cor — 13 px de texto corrido num painel
   de 420 px le-se com o pescoco esticado. O rotulo (.hc-quem), o contador e o nome da
   ferramenta FICAM apagados de proposito: se tudo branqueia, some a hierarquia e o olho perde
   onde comeca a resposta. */
.hc-msg .hc-txt{white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.55; font-size:15px;
  color:var(--text,#f2f2f3);}
/* O hub marca o modo no <html> (data-mode="light" no claro). NO ESCURO o texto lido passa do
   --text (242,242,243 no Grafite) para o quase-branco; no claro a regra nao vale, que la
   clarear e apagar. O color-mix guarda o tom do tema (o "papel" tem texto creme, e virar #fff
   cru tiraria a cor do tema inteiro por causa de 13 pontos de luz); navegador sem color-mix
   fica com o #fff da linha de cima, que e a declaracao anterior do mesmo campo. */
:root:not([data-mode="light"]) .hc-msg .hc-txt{
  color:#fff; color:color-mix(in srgb, var(--text,#f2f2f3) 35%, #fff);}
.hc-eu{align-items:flex-end;}
.hc-eu .hc-txt{background:rgba(var(--tint,242,242,243),0.07); padding:8px 11px;
  border-radius:var(--r-md,8px) var(--r-md,8px) 2px var(--r-md,8px); max-width:min(46ch,92%);}
.hc-ele .hc-txt{padding-right:6px;}
/* o cursor de digitação: sinal de que ainda está chegando texto, e some sozinho no fim */
.hc-vivo .hc-txt::after{content:'▍'; color:var(--text-4,#57575d); animation:hc-pisca 1s steps(2) infinite;}
@keyframes hc-pisca{50%{opacity:0;}}

/* As ferramentas. Linha discreta, não balão: o usuário precisa VER o que o Claude fez —
   "leu o esquema", "procurou resistor 10k" — sem que isso dispute espaço com a resposta. */
.hc-fer{display:flex; align-items:baseline; gap:7px; font-size:12px;
  color:var(--text-3,#7a7a80); padding:1px 0 1px 2px;}
.hc-fer .hc-pt{color:var(--text-4,#57575d);}
.hc-fer .hc-arg{font:11.5px var(--mono,ui-monospace,Consolas,monospace); color:var(--text-4,#57575d);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:38ch;}
.hc-fer.hc-fim .hc-pt{color:var(--ok,#4bbf7b);}
.hc-fer.hc-ruim{color:var(--err,#e0555a);} .hc-fer.hc-ruim .hc-pt{color:var(--err,#e0555a);}

/* O COMANDO do Bash tem bloco próprio, e é a única ferramenta que ganha isso. Motivo: com o
   motor CLI, o Bash roda na máquina que serve o hub, e esta linha é a única forma de o
   usuário ver o que foi rodado ali. Cortar em 38ch com reticências, como os outros
   argumentos, esconderia justamente o fim do comando — que é onde mora o rm -rf.

   E UM TERMINAL, entao ele e PRETO — pedido do dono, com o comando "dentro de cor bem
   levinha". As duas cores sao cravadas, e nao tokens do tema, justamente porque o bloco nao e
   superficie do painel: no modo claro o --sunken e quase branco, e o comando perdia o unico
   sinal visual de que aquilo rodou numa maquina de verdade. Preto em qualquer tema, letra
   clara em cima dele — e a borda esquerda continua sendo a que fica vermelha no erro. */
.hc-fer.hc-bash{flex-direction:column; align-items:stretch; gap:4px;}
.hc-fer.hc-bash .hc-ferl{display:flex; align-items:baseline; gap:7px;}
/* 132 px de teto, e nao os 98 de antes: a letra subiu para 12.5 px e o teto velho cortava o
   bloco em quatro linhas e meia — a meia linha e que denunciava o corte. */
.hc-fer .hc-cmd{margin-left:9px; padding:7px 9px; max-height:132px; overflow:auto;
  font:12.5px/1.5 var(--mono,ui-monospace,Consolas,monospace); color:#e9e9ee;
  white-space:pre-wrap; overflow-wrap:anywhere; background:#000;
  border:1px solid rgba(255,255,255,.10);
  border-left:2px solid rgba(255,255,255,.22); border-radius:var(--r-sm,5px);}
.hc-fer.hc-ruim .hc-cmd{border-left-color:var(--err,#e0555a);}

/* O cartão de proposta: nada é escrito sem os dois botões daqui. */
.hc-prop{border:1px solid var(--line,rgba(242,242,243,.14)); border-left:3px solid var(--hi,#d8d8dd);
  border-radius:var(--r-md,8px); background:var(--surface,#1a1a1d); overflow:hidden;}
.hc-prop .hc-ph{display:flex; align-items:baseline; gap:8px; padding:8px 11px;
  border-bottom:1px solid var(--line-soft,rgba(242,242,243,.08));}
.hc-prop .hc-ph .t{font-size:12.5px; font-weight:600;}
.hc-prop .hc-ph .f{font:11px var(--mono,ui-monospace,Consolas,monospace); color:var(--text-3,#7a7a80);
  margin-left:auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:30ch;}
/* o resumo da proposta e texto que se LE antes de clicar em Aplicar: sai do --text-2 e vai
   para o --text, junto com o resto da conversa */
.hc-prop .hc-res{font-size:13px; color:var(--text,#f2f2f3); padding:7px 11px 0; line-height:1.5;}
.hc-diff{margin:8px 0 0; max-height:270px; overflow:auto; font:12px var(--mono,ui-monospace,Consolas,monospace);
  background:var(--sunken,#0b0b0d); border-top:1px solid var(--line-soft,rgba(242,242,243,.08));}
.hc-diff div{padding:1px 11px; white-space:pre; }
.hc-diff .mais{background:rgba(75,191,123,.13); color:var(--ok,#4bbf7b);}
.hc-diff .menos{background:rgba(224,85,90,.13); color:var(--err,#e0555a);}
.hc-diff .cab{color:var(--text-4,#57575d);}
/* a linha de contexto do diff e o que diz ONDE a mudanca cai — --text-3 fazia dela um
   fantasma entre o verde e o vermelho */
.hc-diff .igual{color:var(--text-2,#a8a8ae);}
.hc-prop .hc-pb{display:flex; align-items:center; gap:8px; padding:9px 11px;
  border-top:1px solid var(--line-soft,rgba(242,242,243,.08));}
.hc-prop .hc-pb .hc-nota{font-size:11px; color:var(--text-3,#7a7a80); margin-left:auto;}
.hc-prop.hc-feito{border-left-color:var(--ok,#4bbf7b);}
.hc-prop.hc-fora{border-left-color:var(--idle,#4a4a50); opacity:.62;}

/* A linha de recado: sem motor, sem servidor, sem projeto. Um chat que não responde e não
   diz por quê é pior do que um chat que não existe. */
.hc-aviso{flex:none; margin:10px 12px 0; padding:9px 11px; font-size:12.5px; line-height:1.5;
  border:1px solid var(--line,rgba(242,242,243,.14)); border-left:3px solid var(--warn,#d6a75a);
  border-radius:var(--r-sm,5px); background:var(--warn-soft,rgba(214,167,90,.12));}
.hc-aviso.err{border-left-color:var(--err,#e0555a); background:var(--err-soft,rgba(224,85,90,.15));}
.hc-aviso code{font:11.5px var(--mono,ui-monospace,Consolas,monospace); color:var(--text,#f2f2f3);}
/* a faixa de pergunta: onde não há modal da página (io.confirm/HubDialog), a confirmação
   acontece AQUI, no tema — nunca no confirm() do navegador, que chega em inglês e trava a aba */
.hc-aviso .hc-botoes{display:flex; gap:8px; padding-top:9px;}

/* A caixa de escrever */
.hc-baixo{flex:none; border-top:1px solid var(--line,rgba(242,242,243,.14)); padding:8px 12px 10px;}
.hc-anexos{display:flex; flex-wrap:wrap; gap:6px; padding-bottom:7px;}
.hc-anexos:empty{display:none;}
.hc-chip{display:flex; align-items:center; gap:6px; max-width:230px; padding:3px 4px 3px 7px;
  font-size:11px; border:1px solid var(--line,rgba(242,242,243,.14)); border-radius:var(--r-sm,5px);
  background:var(--surface,#1a1a1d);}
.hc-chip img{width:26px; height:26px; object-fit:cover; border-radius:3px; display:block;}
.hc-chip .n{overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.hc-chip .z{color:var(--text-4,#57575d); font-variant-numeric:tabular-nums; white-space:nowrap;}
.hc-chip button{border:0; background:transparent; color:var(--text-3,#7a7a80); cursor:pointer;
  font:13px/1 var(--font,sans-serif); padding:2px 5px; border-radius:3px;}
.hc-chip button:hover{background:rgba(var(--tint,242,242,243),.1); color:var(--text,#f2f2f3);}
.hc-chip.grande{border-color:var(--warn,#d6a75a);}

/* ── a coleira ──
   Colada no campo de escrever porque é ali que ela vale: é a última coisa que o usuário vê
   antes de apertar Enter. UMA linha desde 16/09: a frase que explicava o modo escolhido saiu
   a pedido do dono ("deixe mais limpo"). Ela nao evaporou — o mesmo texto e o title do
   seletor e o de cada opcao, isto e, fica onde quem tem a duvida vai passar o mouse, em vez
   de aceso o tempo todo em cima do campo. Só aparece com o motor que tem modos (o CLI). */
.hc-coleira{display:flex; flex-wrap:wrap; align-items:center; gap:5px 8px; padding-bottom:7px;}
/* mesma armadilha do passo da tela de entrada: sem isto, coleira.hidden = true deixaria uma
   faixa vazia ocupando espaço em cima do campo de escrever no motor que não tem modos */
.hc-coleira[hidden]{display:none;}
.hc-coleira .hc-modo{max-width:62%;}
.hc-coleira .hc-motor{margin-left:auto; max-width:50%; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; font:11px var(--mono,ui-monospace,Consolas,monospace);
  color:var(--text-4,#57575d);}
.hc-coleira .hc-equiv{margin-left:auto; white-space:nowrap; font-size:11px;
  font-variant-numeric:tabular-nums; color:var(--text-4,#57575d); cursor:help;}
.hc-coleira .hc-equiv:empty, .hc-coleira .hc-motor:empty{display:none;}
/* solto é o único modo que muda de cor: a coleira aberta tem de ser visível de canto de olho.
   Sem a frase, o seletor amarelo e o unico aviso que sobra — por isso ele fica. */
.hc-coleira.hc-solta .hc-modo{border-color:var(--warn,#d6a75a); color:var(--warn,#d6a75a);}

.hc-escrita{display:flex; align-items:flex-end; gap:7px;}
.hc-campo{flex:1; min-height:38px; max-height:170px; resize:none; overflow-y:auto;
  padding:9px 11px; font:inherit; font-size:14.5px; line-height:1.45;
  background:var(--surface,#1a1a1d); color:var(--text,#f2f2f3);
  border:1px solid var(--line,rgba(242,242,243,.14)); border-radius:var(--r-md,8px);
  caret-color:var(--hi,#d8d8dd);}
.hc-campo:focus-visible{border-color:var(--hi,#d8d8dd); outline:none;}
.hc-campo:disabled{opacity:.5;}
.hc-bt{flex:none; display:inline-flex; align-items:center; justify-content:center; gap:6px;
  cursor:pointer; font:inherit; font-size:13.5px; line-height:1.2; padding:7px 11px;
  background:transparent; color:var(--text-2,#a8a8ae);
  border:1px solid var(--line,rgba(242,242,243,.14)); border-radius:var(--r-md,8px);}
.hc-bt:hover:not(:disabled){background:rgba(var(--tint,242,242,243),.07); color:var(--text,#f2f2f3);}
.hc-bt:disabled{opacity:.42; cursor:not-allowed;}
.hc-bt.forte{color:var(--hi,#d8d8dd); border-color:var(--hi,#d8d8dd);}
.hc-bt.perigo{color:var(--err,#e0555a); border-color:var(--err,#e0555a);}
.hc-bt.icone{width:34px; padding:0; height:34px; font-size:15px;}

/* arrastar arquivo para cima do painel */
.hc.hc-caindo{outline:2px dashed var(--hi,#d8d8dd); outline-offset:-6px;}

/* ── o véu do recorte ──
   Vive no <body>, não no painel: ele precisa cobrir o IFRAME da vista, e elemento de dentro
   do painel nunca cobre um irmão do painel. z-index alto pelo mesmo motivo. */
.hc-ov{position:fixed; inset:0; z-index:9998; cursor:crosshair; user-select:none;}
.hc-ov .hc-area{position:fixed; box-shadow:0 0 0 100vmax var(--scrim,rgba(11,11,13,.62));
  outline:1px solid rgba(var(--tint,242,242,243),.35);}
.hc-ov .hc-foto{position:fixed; object-fit:contain;}
/* .hc-ret, e não .hc-sel: o combo de modelo lá em cima já é .hc-sel, e duas coisas com o
   mesmo nome de classe acabam herdando o fundo e a altura mínima uma da outra. */
.hc-ov .hc-ret{position:fixed; border:1px solid var(--hi,#d8d8dd);
  background:rgba(var(--tint,242,242,243),.12); pointer-events:none;}
.hc-ov .hc-med{position:fixed; font:11px var(--mono,ui-monospace,Consolas,monospace);
  color:var(--text,#f2f2f3); background:rgba(11,11,13,.8); padding:2px 6px; border-radius:3px;
  pointer-events:none;}
.hc-ov .hc-barra{position:fixed; left:50%; transform:translateX(-50%); top:18px;
  display:flex; align-items:center; gap:10px; padding:8px 12px; font-size:12px;
  background:var(--surface,#1a1a1d); color:var(--text,#f2f2f3);
  border:1px solid var(--line,rgba(242,242,243,.14)); border-radius:var(--r-md,8px);
  box-shadow:0 14px 36px rgba(0,0,0,.55);}
.hc-ov .hc-barra kbd{font:11px var(--mono,ui-monospace,Consolas,monospace);
  border:1px solid var(--line,rgba(242,242,243,.14)); border-radius:3px; padding:1px 5px;}

/* o menu de escolha do botão de recorte (só aparece quando há getDisplayMedia) */
.hc-menu{position:fixed; z-index:9999; min-width:250px; padding:4px;
  background:var(--surface,#1a1a1d); border:1px solid var(--line,rgba(242,242,243,.14));
  border-radius:var(--r-sm,5px); box-shadow:var(--shadow-menu,0 16px 40px rgba(0,0,0,.6));}
.hc-menu button{display:block; width:100%; text-align:left; border:0; background:transparent;
  color:var(--text,#f2f2f3); font:inherit; font-size:12.5px; padding:7px 10px;
  border-radius:3px; cursor:pointer;}
.hc-menu button:hover{background:rgba(var(--tint,242,242,243),.08);}
.hc-menu button small{display:block; font-size:11px; color:var(--text-4,#57575d); padding-top:2px;}

/* ══ o lançador e o dock ══
   Vivem no <body>, e não dentro de uma aba: as vistas Esquema e PCB são IFRAME, e um elemento
   fixo do documento DE FORA fica por cima do iframe inteiro. É isso que faz UM lançador no hub
   cobrir todas as telas — dentro dos frames não existe cópia nenhuma para manter em dia.
   A pilha de z-index é a mesma do resto do arquivo, e a ordem importa: o dock (9996) e o botão
   (9997) ficam ABAIXO do véu do recorte (9998) e do menu (9999), senão o painel tapa o próprio
   arrasto na hora de recortar a vista. */
.hcx-lanca{position:fixed; right:0; top:50%; transform:translateY(-50%); z-index:9997;
  width:34px; height:68px; display:flex; align-items:center; justify-content:center; padding:0;
  cursor:pointer; background:var(--surface,#1a1a1d); color:#D97757;
  border:1px solid var(--line,rgba(242,242,243,.14)); border-right:0;
  border-radius:var(--r-md,8px) 0 0 var(--r-md,8px);
  box-shadow:-2px 0 14px rgba(0,0,0,.35);
  transition:right .18s ease, background .12s ease;}
.hcx-lanca:hover{background:rgba(217,119,87,.16);}

/* NO CABEÇALHO. O dono tirou o botão do meio da borda direita e o pôs lá em cima, ao lado do
   indicador de servidor: "quando clica ele fica coloridinho, e quando ta fechado fica cinza
   apagado". É o mesmo botão — só troca de casa e de forma: deixa de ser fixo na janela, perde
   a sombra e não precisa mais sair da frente do dock quando o painel abre. */
.hcx-lanca.hcx-no-topo{position:static; transform:none; width:26px; height:26px;
  border-radius:var(--r-sm,5px); border:1px solid transparent; box-shadow:none;
  background:transparent; transition:color .12s ease, background .12s ease, opacity .12s ease;
  /* FECHADO: cinza apagado. A cor da marca só acende quando o painel está aberto, e é esse
     contraste que diz, de canto de olho, se o operador está ligado. */
  color:var(--text-4,#57575d); opacity:.75;}
.hcx-lanca.hcx-no-topo svg{width:17px; height:17px;}
.hcx-lanca.hcx-no-topo:hover{background:rgba(217,119,87,.12); color:#D97757; opacity:1;}
.hcx-lanca.hcx-no-topo[aria-expanded="true"]{color:#D97757; opacity:1;
  background:rgba(217,119,87,.14); border-color:rgba(217,119,87,.35);}
.hcx-lanca:focus-visible{outline:2px solid #D97757; outline-offset:-3px;}
.hcx-lanca svg{width:21px; height:21px; display:block;}

/* box-sizing aqui e nao herdado: a borda esquerda de 1 px fica FORA da largura declarada, e
   a conta de 1 px desencontra o botao da borda do painel (medido: pediu 700, mediu 701) */
.hcx-dock{position:fixed; top:0; right:0; bottom:0; z-index:9996; width:420px; max-width:100vw;
  box-sizing:border-box; display:flex; flex-direction:column; min-height:0;
  background:var(--panel,var(--surface,#1a1a1d));
  border-left:1px solid var(--line,rgba(242,242,243,.14));
  box-shadow:-12px 0 38px rgba(0,0,0,.45);
  transform:translateX(100%); transition:transform .18s ease;}
.hcx-dock.aberto{transform:none;}
/* fechado ele não pode roubar clique nem tabulação de quem está usando o hub */
.hcx-dock:not(.aberto){pointer-events:none; visibility:hidden;}
.hcx-dock > .hc-raiz{flex:1; min-height:0;}
/* a pega da largura: a borda esquerda inteira, 6 px de alvo */
.hcx-pega{position:absolute; left:-3px; top:0; bottom:0; width:6px; cursor:col-resize; z-index:1;}
.hcx-pega:hover{background:rgba(217,119,87,.45);}
/* o véu do arrasto: o pointermove que passa por cima de um IFRAME é entregue ao documento do
   iframe, não a este — sem o véu a largura trava assim que o ponteiro entra na vista */
.hcx-veu{position:fixed; inset:0; z-index:9995; cursor:col-resize;}
.hcx-arrastando{user-select:none;}

/* ── o empurrao: o painel abre e o hub anda para o lado, em vez de sumir debaixo dele ──
   O hub inteiro mora no #app, filho direto do <body>, e esse <body> tem margin:0 e
   overflow:hidden — um padding-right nele encolhe o #app e, dentro dele, o IFRAME width:100%
   da vista, sem que o hub.html precise de uma linha. O canvas do schframe/pcbframe se
   reajusta sozinho (ResizeObserver no hub-draw.js, resize de window no pcbframe.js).
   O que NAO anda: modal, toast e menu do hub, que sao position:fixed do viewport. E de
   proposito — eles ja vivem por cima de tudo, painel inclusive.
   A transicao acompanha os .18s do dock; no arrasto ela e desligada, senao a tela chega
   atrasada no ponteiro e o arrasto parece emperrado. */
body.hcx-empurra{padding-right:var(--hcx-empurra,0px); transition:padding-right .18s ease;}
body.hcx-empurra.hcx-arrastando{transition:none;}
/* o lancador anda junto com a borda (bt.style.right, no poeLargura), e os .18s dele sao os
   mesmos .18s do dock deslizando ao abrir. No ARRASTO eles atrapalham: medido em 16/09, o
   botao ficava parado em 1130 px enquanto a borda ja estava em 824 — 300 px de atraso, que na
   tela e o botao descolado do painel o arrasto inteiro. */
body.hcx-arrastando .hcx-lanca{transition:none;}

.hc-raiz{display:flex; flex-direction:column; min-height:0; height:100%;
  font:15px var(--font, system-ui, sans-serif); color:var(--text,#f2f2f3);}
.hc-raiz *{box-sizing:border-box;}
.hc-raiz > .hc{flex:1; min-height:0;}

/* ══ a tela de entrada ══
   Não se conversa antes de entrar, e depois o navegador lembra. */
.hc-porta{flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:13px;
  padding:26px 20px 18px;}
.hc-porta .hc-marca{display:flex; align-items:center; gap:10px; color:#D97757; padding-bottom:2px;}
.hc-porta .hc-marca svg{width:27px; height:27px; flex:none;}
.hc-porta .hc-marca span{font-size:15px; font-weight:600; color:var(--text,#f2f2f3);}
.hc-porta h4{margin:0; font-size:13px; font-weight:600; color:var(--text,#f2f2f3);}
.hc-porta p{margin:0; font-size:12.5px; line-height:1.55; color:var(--text-2,#a8a8ae);}
.hc-porta label{font-size:10px; letter-spacing:.09em; text-transform:uppercase;
  color:var(--text-3,#7a7a80);}
.hc-porta input{width:100%; padding:9px 11px; font:inherit; font-size:13px;
  background:var(--sunken,#0b0b0d); color:var(--text,#f2f2f3); caret-color:var(--hi,#d8d8dd);
  border:1px solid var(--line,rgba(242,242,243,.14)); border-radius:var(--r-md,8px);}
.hc-porta input:focus-visible{border-color:var(--hi,#d8d8dd); outline:none;}
.hc-porta input:disabled{opacity:.5;}
.hc-porta .hc-campoz{display:flex; flex-direction:column; gap:5px;}
.hc-porta .hc-linha{display:flex; gap:8px; align-items:center; flex-wrap:wrap;}
.hc-porta .hc-mau{font-size:12px; line-height:1.5; color:var(--err,#e0555a);}
.hc-porta .hc-mau:empty{display:none;}
.hc-porta .hc-ok{font-size:12px; line-height:1.5; color:var(--text-3,#7a7a80);}
.hc-porta .hc-ok:empty{display:none;}
.hc-porta code{display:block; font:11.5px var(--mono,ui-monospace,Consolas,monospace);
  color:var(--text,#f2f2f3); background:var(--sunken,#0b0b0d); padding:8px 10px;
  border:1px solid var(--line,rgba(242,242,243,.14)); border-radius:var(--r-sm,5px);
  overflow-wrap:anywhere;}
.hc-porta .hc-passo{display:flex; flex-direction:column; gap:11px; padding-top:13px;
  border-top:1px solid var(--line-soft,rgba(242,242,243,.08));}
/* display:flex numa CLASSE ganha do [hidden]{display:none} do navegador, que é regra de
   agente do usuário. Sem esta linha, p.hidden = true não esconde nada — e o segundo passo
   aparecia com o campo de senha ainda em cima dele (medido no headless, 16/09). */
.hc-porta .hc-passo[hidden]{display:none;}
.hc-porta .hc-rodape{margin-top:auto; padding-top:14px; font-size:11px; line-height:1.55;
  color:var(--text-4,#57575d);}
.hc-porta .hc-textobt{border:0; background:transparent; padding:0; cursor:pointer;
  font:inherit; font-size:11.5px; color:var(--text-3,#7a7a80); text-decoration:underline;
  text-underline-offset:2px;}
.hc-porta .hc-textobt:hover{color:var(--text,#f2f2f3);}
`;

let cssPosto = false;
function poeCss(){
  if (cssPosto) return;
  cssPosto = true;
  const st = document.createElement('style');
  st.id = 'hc-css'; st.textContent = CSS;
  document.head.appendChild(st);
}

function el(tag, cls, texto){
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto != null) e.textContent = texto;
  return e;
}

/* ════════════════════════════════════════════════════════════════════════════
   PURO — nada aqui toca no DOM, na rede ou no disco. É o que dá para conferir
   sem navegador (e o que o smoke por CDP não alcança).
   ════════════════════════════════════════════════════════════════════════════ */

/* O evento do SSE chega como objeto, ou como a linha crua quando o io repassa sem parsear.
   E os nomes vêm em português (contrato do claude_api.py) ou no cru da API, se o servidor
   estiver repassando o evento dela. Normalizar aqui é mais barato do que espalhar
   `ev.t || ev.type` por dez lugares — e evita o painel ficar mudo por causa de uma letra. */
function normaliza(bruto){
  let ev = bruto;
  if (typeof ev === 'string'){
    const s = ev.trim();
    if (!s || s === '[DONE]') return null;
    try { ev = JSON.parse(s); } catch (e) { return { t: 'texto', s: bruto }; }
  }
  if (!ev || typeof ev !== 'object') return null;
  const t = ev.t || ev.tipo || ev.type || '';
  if (t === 'texto' || t === 'text' || t === 'delta')
    return { t: 'texto', s: String(ev.s != null ? ev.s : (ev.texto != null ? ev.texto : (ev.text || ''))) };
  if (t === 'ferramenta' || t === 'tool' || t === 'tool_use')
    return { t: 'ferramenta', id: ev.id || ev.tool_use_id || '',
             nome: ev.nome || ev.name || '', entrada: ev.entrada || ev.input || {} };
  if (t === 'resultado' || t === 'tool_result')
    return { t: 'resultado', id: ev.id || ev.tool_use_id || '', nome: ev.nome || ev.name || '',
             resumo: ev.resumo || ev.summary || '', erro: !!(ev.erro || ev.is_error),
             proposta: ev.proposta || (ev.resultado && ev.resultado.proposta) || null };
  if (t === 'proposta')
    return { t: 'resultado', id: ev.id || '', nome: ev.nome || '', resumo: '', erro: false,
             proposta: ev.proposta || ev };
  if (t === 'fim' || t === 'done' || t === 'message_stop'){
    const u = ev.uso || ev.usage || {};
    /* `custo_equivalente_usd` só existe no motor CLI (claude_cli.py » eventos_da_linha): é o
       que o turno CUSTARIA pela API. NÃO é o mesmo número do contador do motor API, e por
       isso viaja num campo próprio — somar os dois no mesmo lugar faria a tela apresentar
       como fatura um dinheiro que a assinatura não cobra. `null` quando o servidor não diz. */
    const eq = ev.custo_equivalente_usd != null ? ev.custo_equivalente_usd
             : (ev.custo_equivalente != null ? ev.custo_equivalente : null);
    return { t: 'fim', motivo: ev.motivo || ev.stop_reason || 'end_turn',
      /* o id da sessão do CLI. Quem retoma (`--resume`) é o SERVIDOR, pelo id da conversa —
         o painel guarda isto só para saber com qual sessão está falando. */
      sessao: String(ev.sessao || ev.session_id || ''),
      equivalente: (eq == null || isNaN(Number(eq))) ? null : Number(eq),
      uso: {
      entrada: Number(u.entrada != null ? u.entrada : u.input_tokens) || 0,
      saida:   Number(u.saida   != null ? u.saida   : u.output_tokens) || 0,
      cacheLeitura:  Number(u.cache_leitura  != null ? u.cache_leitura  : u.cache_read_input_tokens) || 0,
      cacheEscrita:  Number(u.cache_escrita  != null ? u.cache_escrita  : u.cache_creation_input_tokens) || 0,
    }};
  }
  if (t === 'erro' || t === 'error')
    return { t: 'erro', msg: ev.msg || ev.mensagem || ev.message || 'erro sem mensagem',
             status: Number(ev.status) || 0 };
  return null;
}

/* Frase para a linha de ferramenta. São DUAS famílias de ferramenta, e o painel desenha as
   duas: as do `operador.py` (motor API, nomes em snake_case e em português) e as do CLAUDE
   CODE (motor CLI: Read, Edit, Write, Bash, Grep, Glob, Task…), que chegam em inglês e em
   PascalCase. Traduzir a segunda família não é enfeite: com o motor CLI não há cartão de
   proposta nenhum, e esta linha passa a ser a ÚNICA coisa que o usuário vê do que foi feito
   no disco e na máquina dele.

   O dicionário continua sendo cortesia: ferramenta que não estiver aqui aparece com o nome
   cru e o sublinhado trocado por espaço. Feia, mas aparece — sumir seria pior. */
const VERBO = {
  /* operador.py — motor "api" */
  ler_esquema: 'leu o esquema',        ler_placa: 'leu a placa',
  ler_arquivo: 'leu o arquivo',        listar_projetos: 'listou os projetos',
  procurar_componente: 'procurou',     buscar_simbolo: 'procurou o símbolo',
  ler_biblioteca: 'leu a biblioteca',  ler_anotacoes: 'leu os sinalizadores',
  ler_footprint: 'leu o footprint',    listar_nets: 'listou as nets',
  escrever_esquema: 'propôs mudar o esquema',
  escrever_changes: 'propôs mudar a PCB',
  escrever_anotacoes: 'propôs responder um sinalizador',
  /* Claude Code — motor "cli". O tempo verbal é o passado dos outros: a linha nasce quando a
     chamada começa, mas quem lê a conversa depois está lendo o que já aconteceu. */
  Read: 'leu',                   Write: 'escreveu o arquivo',
  Edit: 'editou',                MultiEdit: 'editou (vários trechos)',
  NotebookEdit: 'editou o notebook',
  Bash: 'rodou na máquina',      BashOutput: 'leu a saída do comando',
  /* o mesmo verbo do Bash: nesta máquina as duas são a MESMA coisa para quem lê a
     conversa — comando rodando no Windows que serve o hub */
  PowerShell: 'rodou na máquina',
  KillShell: 'encerrou o comando', KillBash: 'encerrou o comando',
  Grep: 'procurou no código',    Glob: 'listou arquivos',
  LS: 'listou a pasta',          Task: 'chamou um subagente',
  TodoWrite: 'anotou as tarefas', ExitPlanMode: 'fechou o plano',
  WebFetch: 'abriu a página',    WebSearch: 'pesquisou na web',
  SlashCommand: 'rodou um comando do Claude', Skill: 'abriu uma habilidade',
  AskUserQuestion: 'perguntou',  NotebookRead: 'leu o notebook',
};
/* O campo que vale mostrar, POR FERRAMENTA — é o que separa "leu" de "leu schematic.js". A
   lista genérica (ARGS) atende quem não estiver aqui. */
const ARG_DA = {
  Read: 'file_path', Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path', NotebookRead: 'notebook_path', LS: 'path',
  Grep: 'pattern', Glob: 'pattern', Task: 'description', WebFetch: 'url',
  WebSearch: 'query', SlashCommand: 'command', Skill: 'skill', BashOutput: 'bash_id',
  /* Bash mostra a `description` na linha e o COMANDO no bloco de baixo — ver `cmd` */
  Bash: 'description',
};
/* o argumento que vale mostrar: o primeiro campo curto e legível. "procurou resistor 10k"
   diz o que "procurar_componente" sozinho não diz. */
const ARGS = ['termo','busca','q','texto','ref','net','simbolo','componente','arquivo','caminho','projeto','folha','sheet','id','file_path','pattern','command','description','path','url','query'];
const TETO_ARG = 60;
/* 38 é o `max-width:38ch` do `.hc-arg` no CSS, e os dois números TÊM de ser o mesmo para
   CAMINHO: o corte do CSS come o FIM da linha, e o fim de um caminho é o nome do arquivo —
   a única parte que interessa. Deixar o JS cortar em 60 fazia um caminho de 52 passar
   inteiro daqui e sair da tela como "…/Projects/X/schemat…". Texto livre continua em 60,
   porque lá o começo é que importa. */
const TETO_CAMINHO = 38;
const TETO_CMD = 2000;   /* comando maior que isto não é comando, é um script colado */

/* Caminho inteiro não cabe na linha, e o que importa dele é o FIM: `…/Projects/X/schematic.js`
   diz o que `D:\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror\Projects…` esconde. Só encurta o
   que é caminho (tem barra) e só quando passa do teto. */
function caminhoCurto(s, teto){
  const t = teto || TETO_ARG;
  const txt = String(s == null ? '' : s);
  if (txt.length <= t || !/[\\/]/.test(txt)) return txt;
  const p = txt.replace(/\\/g, '/').split('/').filter(Boolean);
  for (let n = 3; n >= 1; n--){
    if (p.length <= n) break;
    const curto = '…/' + p.slice(-n).join('/');
    if (curto.length <= t || n === 1) return curto;
  }
  return txt;
}

function fraseFerramenta(nome, entrada){
  const verbo = VERBO[nome] || String(nome || 'ferramenta').replace(/_/g, ' ');
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  const texto = k => {
    const v = e[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
    return '';
  };
  let arg = ARG_DA[nome] ? texto(ARG_DA[nome]) : '';
  if (!arg) for (const k of ARGS){ arg = texto(k); if (arg) break; }
  if (!arg){
    for (const k of Object.keys(e)){
      const v = e[k];
      if (typeof v === 'string' && v.trim() && v.length <= TETO_ARG){ arg = v.trim(); break; }
    }
  }
  arg = caminhoCurto(arg, TETO_CAMINHO);
  if (arg.length > TETO_ARG) arg = arg.slice(0, TETO_ARG - 3) + '…';
  /* O COMANDO do Bash sai inteiro, num bloco à parte. Com o motor CLI ele roda na máquina que
     serve o hub, e ver o que rodou é tudo o que sobra ao usuário depois do fato — cortar em
     38ch esconderia justamente o fim da linha, que é onde mora o que dói. */
  let cmd = '';
  /* PowerShell entra junto com o Bash: nesta maquina o Claude Code tem as duas ferramentas de
     terminal, e as duas trazem o comando no mesmo campo `command`. Deixar so o Bash fazia o
     comando do PowerShell cair na linha comum e ser cortado em 38ch — que e exatamente o corte
     que esconde o fim da linha, onde mora o que dói. */
  if (nome === 'Bash' || nome === 'BashOutput' || nome === 'SlashCommand' || nome === 'PowerShell'){
    cmd = typeof e.command === 'string' ? e.command.trim() : '';
    if (cmd.length > TETO_CMD) cmd = cmd.slice(0, TETO_CMD) + '\n… (comando cortado na tela)';
  }
  if (cmd && arg === cmd) arg = '';     /* não repetir o comando na linha e no bloco */
  return { verbo, arg, cmd };
}

/* O diff em linhas classificadas. Aceita as duas formas que a proposta pode trazer: o texto
   unificado (`diff`) e a lista já pronta (`linhas`). Cabeçalho de arquivo (+++ / ---) é
   cabeçalho, não linha que entra ou sai — pintar aquilo de verde e vermelho faria todo diff
   começar com uma inserção e uma remoção que não existem. */
function linhasDoDiff(prop){
  const fora = [];
  if (prop && Array.isArray(prop.linhas)){
    for (const l of prop.linhas){
      if (typeof l === 'string') fora.push(classifica(l));
      else if (l && typeof l === 'object'){
        const t = l.t || l.tipo || ' ';
        const s = l.s != null ? l.s : (l.texto != null ? l.texto : '');
        fora.push({ cls: t === '+' ? 'mais' : t === '-' ? 'menos' : t === '@' ? 'cab' : 'igual', s: String(s) });
      }
    }
    return fora;
  }
  const bruto = prop && typeof prop.diff === 'string' ? prop.diff : '';
  if (!bruto) return fora;
  for (const linha of bruto.replace(/\r/g, '').split('\n')) fora.push(classifica(linha));
  while (fora.length && !fora[fora.length - 1].s) fora.pop();
  return fora;
}
function classifica(linha){
  const s = String(linha);
  if (/^(\+\+\+|---|@@|diff |index )/.test(s)) return { cls: 'cab', s };
  if (s[0] === '+') return { cls: 'mais',  s };
  if (s[0] === '-') return { cls: 'menos', s };
  return { cls: 'igual', s };
}

/* Quanto custou. Sem preço conhecido devolve null — e o painel então mostra só os tokens,
   em vez de um "US$ 0,00" que parece de graça. Cache entra quando o servidor mandar: ele
   é lido a 0,1x e escrito a 1,25x do preço de entrada. */
function custo(uso, preco){
  if (!preco || !(preco.entrada > 0 || preco.saida > 0)) return null;
  const e = (uso.entrada || 0) / 1e6 * preco.entrada;
  const s = (uso.saida || 0) / 1e6 * preco.saida;
  const cl = (uso.cacheLeitura || 0) / 1e6 * preco.entrada * 0.1;
  const ce = (uso.cacheEscrita || 0) / 1e6 * preco.entrada * 1.25;
  return e + s + cl + ce;
}

/* ── o /estado, normalizado ──
   Dois servidores respondem esta rota e o painel aguenta os dois. O novo diz qual MOTOR está
   atrás (`cli` = o claude desta máquina; `api` = a chave no container) e manda versão, modos
   e modelos; o velho respondia só `chave:bool`. A regra aqui é uma só: CAMPO AUSENTE VIRA
   "NÃO SEI", e "não sei" nunca desliga nada — um painel que se cala porque o servidor é mais
   velho que ele é um painel quebrado por conta própria.

   As listas chegam como array (`[{id,rotulo,…}]`) ou como o dicionário cru do Python
   (`{plan:{rotulo,…}}`, que é a forma do claude_cli.MODOS). As duas são aceitas: qual das
   duas o servidor manda é decisão dele, e não vale um painel mudo. */
function emLista(v){
  const fora = [];
  if (Array.isArray(v)){
    for (const x of v){
      if (typeof x === 'string'){ if (x) fora.push({ id: x }); }
      else if (x && typeof x === 'object' && (x.id || x.nome)) fora.push(Object.assign({}, x, { id: String(x.id || x.nome) }));
    }
  } else if (v && typeof v === 'object'){
    for (const k of Object.keys(v)){
      const x = v[k];
      fora.push(Object.assign({}, (x && typeof x === 'object') ? x : {}, { id: String(k) }));
    }
  }
  return fora;
}

function leEstado(bruto){
  const r = bruto && typeof bruto === 'object' ? bruto : {};
  /* `ligado` é a única pergunta que importa: dá para conversar? O servidor velho respondia
     isso em `chave`. Nenhum dos dois presente = não sei, e não sei deixa a conversa aberta —
     quem sabe de verdade é o primeiro turno, e o erro dele vem com frase. */
  const ligado = typeof r.ligado === 'boolean' ? r.ligado
               : typeof r.chave === 'boolean' ? r.chave : null;
  const modos = emLista(r.modos).map(m => ({
    id: m.id, rotulo: String(m.rotulo || m.id), frase: String(m.frase || ''), solto: !!m.solto }));
  const modelos = emLista(r.modelos).map(m => {
    const o = { id: m.id, rotulo: String(m.rotulo || m.id) };
    if (m.entrada != null) o.entrada = Number(m.entrada) || 0;
    if (m.saida   != null) o.saida   = Number(m.saida) || 0;
    return o;
  });
  return {
    motor: String(r.motor || '').toLowerCase(),
    versao: String(r.versao || r.version || ''),
    ligado, motivo: String(r.motivo || ''),
    modelos, modelo: String(r.modelo || ''),
    modos, modoPadrao: String(r.modo_padrao != null ? r.modo_padrao
                             : (r.modoPadrao != null ? r.modoPadrao : (r.modo || ''))),
    /* `dolar.fatura` é o servidor DIZENDO se o número é conta a pagar, em vez de a tela
       deduzir isso do nome do motor. É a resposta certa para a mesma pergunta, e ela ganha:
       quem sabe se aquilo é cobrado é quem mede. `null` = não disse, e aí vale o motor. */
    fatura: (r.dolar && typeof r.dolar.fatura === 'boolean') ? r.dolar.fatura : null,
    /* a frase do servidor dizendo que o dólar do CLI é equivalente, e não fatura. Sem ela o
       painel usa a própria — mas a do servidor ganha, porque é lá que a conta é medida. */
    avisoCusto: String(r.aviso_custo || (r.dolar && r.dolar.frase) || r.custo_aviso || r.aviso || ''),
    teto: (r.teto && typeof r.teto === 'object') ? r.teto : {},
  };
}

/* Com quem eu estou falando. É a frase que a tela de entrada mostra depois da senha e que o
   painel repete em letra miúda ao lado da coleira. Servidor que não diz o motor não ganha
   frase inventada: devolve vazio, e o lugar dela simplesmente não aparece. */
function rotuloMotor(est){
  if (!est) return '';
  if (est.motor === 'cli') return 'claude CLI' + (est.versao ? ' ' + est.versao : '') + ' nesta máquina';
  if (est.motor === 'api') return 'chave da API no servidor';
  return '';
}

function kilo(n){
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  return (v / 1000).toFixed(v < 10000 ? 1 : 0).replace('.', ',') + 'k';
}
function bytes(n){
  const v = Number(n) || 0;
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(0) + ' KB';
  return (v / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}
function moeda(v){
  if (v == null) return '';
  return 'US$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: v < 1 ? 4 : 2, maximumFractionDigits: 4 });
}

/* O tamanho depois do corte. Só encolhe: ampliar imagem pequena é pagar por pixel inventado. */
function cabe(w, h, lado){
  const maior = Math.max(w, h);
  if (!(maior > lado)) return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
  const k = lado / maior;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/* Estimativa de tokens da imagem (≈ w·h/750). Serve para o chip dizer o preço ANTES de
   mandar — é o número que faz o usuário entender por que a imagem foi reduzida. O valor que
   vale é o do `uso` que volta do servidor; este é só o aviso prévio. */
function tokensImagem(w, h){ return Math.round((w * h) / 750); }

/* O retângulo do elemento em coordenadas da JANELA DE CIMA. O canvas da vista mora num
   iframe de mesma origem, e getBoundingClientRect() lá dentro responde em coordenadas DO
   IFRAME: sem somar a posição do frame, o véu desenha o recorte deslocado pela altura do
   cabeçalho do hub, e o pedaço que chega no chat é o pedaço errado. */
function retanguloNaTela(no){
  if (!no || !no.getBoundingClientRect) return null;
  const r = no.getBoundingClientRect();
  let x = r.left, y = r.top;
  let win = (no.ownerDocument && no.ownerDocument.defaultView) || null;
  let guarda = 0;
  while (win && win !== window && guarda++ < 8){
    let fr = null;
    try { fr = win.frameElement; } catch (e) { fr = null; }  /* cross-origin: para aqui */
    if (!fr) break;
    const rf = fr.getBoundingClientRect();
    x += rf.left + (fr.clientLeft || 0);
    y += rf.top  + (fr.clientTop  || 0);
    win = win.parent;
  }
  return { left: x, top: y, width: r.width, height: r.height };
}

/* Retângulo de dois pontos. Resolve os três casos chatos de uma vez: arrasto para trás (da
   direita para a esquerda, ou de baixo para cima), arrasto que saiu da área (fica preso na
   borda) e clique sem arrasto (sai com w/h zerados, e quem chama descarta). */
function retanguloDe(a, b, limite){
  let x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
  let y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  if (limite){
    x1 = Math.max(x1, limite.left); y1 = Math.max(y1, limite.top);
    x2 = Math.min(x2, limite.left + limite.width);
    y2 = Math.min(y2, limite.top + limite.height);
  }
  return { left: x1, top: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

/* ════════════════════════════════════════════════════════════════════════════
   A CREDENCIAL E O CANO — o painel fala com /api/chat/* por conta própria
   ════════════════════════════════════════════════════════════════════════════

   Por que não pelo `io.post`/`io.stream` do hub: quem tem a credencial é este painel. TODA
   rota do chat exige a senha mestre (chatserver.py » _autoriza), a mesma senha que o
   "Excluir projeto" já pedia (hubserver.py:489) — o chat gasta dinheiro E edita projeto, e
   as duas juntas valem mais que o clique errado. O `io` continua servindo para o resto:
   projeto, tela, canvas, toast e recarregar a vista.

   A senha vai no CABEÇALHO X-Hub-Senha e em nenhum outro lugar. O servidor também a aceita
   no corpo JSON, mas o cabeçalho é o que não corre risco de ser copiado para dentro de um
   arquivo de conversa por descuido; a query string está fora de cogitação, é a única das
   três que o log de acesso do servidor grava.

   Ela fica no localStorage deste navegador, e é uma troca declarada: qualquer script que já
   rode nesta origem a alcança — mas quem já roda script nesta origem é o próprio hub, e
   pedir a senha a cada recarregamento de aba é o caminho mais curto para ela acabar num
   post-it colado no monitor. "Sair" apaga.                                                */

const CAB_SENHA  = 'X-Hub-Senha';
const CHAVE_SENHA = 'altiumhub.chat.senha';
const CHAVE_LARG  = 'altiumhub.chat.largura';
/* a coleira escolhida fica por NAVEGADOR, como a largura do painel: quem trabalha solto o dia
   inteiro não quer reescolher a cada aba. O que NÃO é lembrado é a confirmação do modo solto —
   essa é por sessão, e acontece antes do primeiro envio (ver `liberaModo`). */
const CHAVE_MODO  = 'altiumhub.chat.modo';

/* localStorage LEVANTA (não devolve null) quando o navegador está com os dados do site
   bloqueados ou numa janela anônima restrita — e um painel que não abre porque não deu para
   ler uma preferência é pior do que um painel sem preferência. */
function guardado(k, padrao){
  try { const v = localStorage.getItem(k); return v == null ? padrao : v; }
  catch (e){ return padrao; }
}
function guarda(k, v){
  try { if (v == null || v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); }
  catch (e) {}
}

/* O SSE chega em PEDAÇOS que o fetch corta onde quiser: no meio de um evento, e até no meio
   de um caractere UTF-8 (por isso o decode com stream:true lá em baixo). Um evento acaba em
   linha em branco; o que sobra fica na caixa até o pedaço seguinte. Puro de propósito — é a
   parte que erra em silêncio, porque evento partido não levanta exceção, só some da tela. */
function eventosDe(pedaco, caixa, fim){
  caixa.resto = (caixa.resto || '') + String(pedaco == null ? '' : pedaco);
  const fora = [];
  for (;;){
    const m = /\r?\n\r?\n/.exec(caixa.resto);
    if (!m) break;
    const bloco = caixa.resto.slice(0, m.index);
    caixa.resto = caixa.resto.slice(m.index + m[0].length);
    const d = dadoDoBloco(bloco);
    if (d !== null) fora.push(d);
  }
  if (fim && caixa.resto.trim()){
    const d = dadoDoBloco(caixa.resto);
    caixa.resto = '';
    if (d !== null) fora.push(d);
  }
  return fora;
}
/* as linhas `data:` de UM evento. Linha que começa com `:` é comentário de keep-alive do
   protocolo — engolir isso é o que impede um "ping" de virar texto na conversa. */
function dadoDoBloco(bloco){
  const dados = [];
  for (const l of String(bloco).split(/\r?\n/)){
    if (!l || l.charAt(0) === ':') continue;
    if (l.slice(0, 5) === 'data:') dados.push(l.slice(5).replace(/^ /, ''));
  }
  return dados.length ? dados.join('\n') : null;
}

function erroDe(j, status){
  const e = new Error((j && (j.erro || j.error)) || ('o servidor respondeu HTTP ' + status));
  e.status = status;
  if (status === 403) e.senhaRuim = true;
  return e;
}

/* A sessão: a senha, o estado do servidor e os dois jeitos de falar com ele. */
function criaSessao(io){
  const S = {
    io: io || {},
    senha: guardado(CHAVE_SENHA, '') || '',
    estado: null,
    aoPerder: null,      /* o servidor recusou a senha no meio do caminho */
  };

  function cabecalho(){
    const h = { 'Content-Type': 'application/json' };
    if (S.senha) h[CAB_SENHA] = S.senha;
    return h;
  }

  async function chama(rota, corpo, senha){
    const h = { 'Content-Type': 'application/json' };
    if (senha) h[CAB_SENHA] = senha;
    const r = await fetch(rota, { method: 'POST', headers: h,
                                  body: JSON.stringify(corpo || {}) });
    let j = null;
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw erroDe(j, r.status);
    return j;
  }

  /* Confere uma senha SEM mexer na sessão: é o que a tela de entrada chama, e ela não pode
     disparar o `aoPerder` (voltar para a tela de entrada estando nela seria um laço). Nunca
     levanta — a tela de entrada precisa da frase, não da exceção. */
  S.testa = async function (senha){
    try {
      const j = await chama(R.estado, { projeto: '' }, senha);
      return { ok: true, estado: j || {} };
    } catch (e){
      return { ok: false, senhaRuim: !!e.senhaRuim, semRede: !e.status,
               msg: e && e.message ? e.message : String(e) };
    }
  };

  S.post = async function (rota, corpo){
    try {
      return await chama(rota, corpo, S.senha);
    } catch (e){
      if (e && e.senhaRuim && S.aoPerder) S.aoPerder(e);
      throw e;
    }
  };

  /* O turno, em SSE. Devolve uma promessa com `.cancelar()` — é o que o botão Parar usa, e é
     abortar de verdade: sem isso o servidor continuaria gerando (e cobrando) uma resposta
     que já ninguém lê. */
  S.fluxo = function (rota, corpo, aoEvento){
    const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    const p = (async function (){
      const r = await fetch(rota, { method: 'POST', headers: cabecalho(),
                                    body: JSON.stringify(corpo || {}),
                                    signal: ctrl ? ctrl.signal : undefined });
      if (!r.ok){
        let j = null;
        try { j = await r.json(); } catch (e) {}
        const e2 = erroDe(j, r.status);
        if (e2.senhaRuim && S.aoPerder) S.aoPerder(e2);
        throw e2;
      }
      const caixa = { resto: '' };
      if (!r.body || typeof r.body.getReader !== 'function'){
        /* navegador sem stream no fetch: o turno inteiro chega de uma vez. A tela deixa de
           escrever enquanto chega, mas escreve — e o formato do evento é o mesmo nos dois
           caminhos, então nada além da animação muda. */
        const texto = await r.text();
        for (const ev of eventosDe(texto, caixa, true)) aoEvento(ev);
        return;
      }
      const leitor = r.body.getReader();
      const dec = new TextDecoder();
      for (;;){
        const parte = await leitor.read();
        if (parte.done) break;
        for (const ev of eventosDe(dec.decode(parte.value, { stream: true }), caixa)) aoEvento(ev);
      }
      for (const ev of eventosDe(dec.decode(), caixa, true)) aoEvento(ev);
    })();
    p.cancelar = function (){ try { if (ctrl) ctrl.abort(); } catch (e) {} };
    return p;
  };

  S.sai = function (){
    S.senha = '';
    S.estado = null;
    guarda(CHAVE_SENHA, null);
  };

  return S;
}

/* A estrela do Claude, desenhada aqui em SVG: raios afilados saindo do centro. É desenho
   nosso e não o arquivo da marca — não há CDN nem dependência externa neste projeto, e um
   <img> apontando para fora seria as duas coisas. Fica em `currentColor` para o laranja da
   marca (#D97757) vir do CSS e o botão poder mudar de cor no hover sem tocar no path. */
function marcaClaude(){
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const cx = 12, cy = 12;
  /* oito raios; os diagonais um pouco mais curtos, que é o que dá o contorno de estrela em
     vez de o de uma roda */
  const RAIOS = [
    [0, 10.2], [45, 8.0], [90, 10.2], [135, 8.0],
    [180, 10.2], [225, 8.0], [270, 10.2], [315, 8.0],
  ];
  /* `ri` NEGATIVO de proposito: a base de cada raio fica um pouco ALEM do centro, senao os
     oito raios se encostam sem cobrir o meio e sobra um furo no miolo da estrela */
  const ri = -0.6, hb = 1.9, ht = 0.38;  /* raio interno, meia-largura na base e na ponta */
  const partes = [];
  for (const [graus, ro] of RAIOS){
    const a = graus * Math.PI / 180;
    const ux = Math.cos(a), uy = Math.sin(a);
    const vx = -uy, vy = ux;
    const p = (r, h, s) => ((cx + ux * r + vx * h * s).toFixed(2) + ',' +
                            (cy + uy * r + vy * h * s).toFixed(2));
    partes.push('M' + p(ri, hb, 1) + 'L' + p(ro, ht, 1) + 'L' + p(ro, ht, -1) +
                'L' + p(ri, hb, -1) + 'Z');
  }
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', partes.join(''));
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

/* ════════════════════════════════════════════════════════════════════════════
   A TELA DE ENTRADA

   O que ela FAZ: pede a senha mestre do hub, e só. O que ela NÃO faz, de propósito: "entrar
   com a conta Claude". Aquele login é do Claude Code e não tem porta pública para um app de
   terceiro — botão que finge fazer isso é pior do que botão nenhum, porque o usuário clica.

   O segundo passo NÃO PEDE MAIS CHAVE DE API, e não é só porque o campo não gravava: com o
   motor CLI não existe chave nenhuma para pedir. O que ele faz agora é DIZER QUEM ESTÁ
   ATRÁS — "claude CLI 2.1.260 nesta máquina" — porque a diferença entre falar com o terminal
   da máquina e falar com uma API paga muda o que o usuário pode pedir e o que aquilo custa.
   Quando não há motor nenhum, quem fala é o servidor: a frase do /estado (`motivo`) já diz o
   que falta fazer (instalar o Claude Code e rodar `claude` uma vez para entrar na conta, ou
   pôr a chave no ambiente do container). Instrução, nunca campo: nenhuma rota do chatserver.py
   grava chave ou login, e campo que não grava é mentira bonita.
   ════════════════════════════════════════════════════════════════════════════ */

function montaPorta(sessao, aoEntrar, recado){
  const raiz = el('div', 'hc-porta');

  const marca = el('div', 'hc-marca');
  marca.append(marcaClaude(), el('span', null, 'Operador do hub'));
  raiz.append(marca);

  const p1 = el('div', 'hc-passo');
  p1.style.borderTop = '0';
  p1.style.paddingTop = '0';
  p1.append(el('p', null,
    'O operador edita projeto — e, dependendo da coleira, roda comando na máquina que serve ' +
    'o hub. Por isso toda rota dele pede a senha mestre, a mesma do "Excluir projeto". ' +
    'Depois de aceita, ela fica guardada neste navegador e vai em todo pedido; o botão Sair ' +
    'apaga.'));

  const campoz = el('div', 'hc-campoz');
  const rot = el('label', null, 'senha mestre do hub');
  rot.htmlFor = 'hc-senha';
  const campo = el('input');
  campo.type = 'password';
  campo.id = 'hc-senha';
  campo.autocomplete = 'current-password';
  campo.placeholder = 'a senha do hub';
  campoz.append(rot, campo);
  p1.append(campoz);

  const linha = el('div', 'hc-linha');
  const btEntrar = el('button', 'hc-bt forte', 'Entrar');
  linha.append(btEntrar);
  p1.append(linha);

  const mau = el('div', 'hc-mau');
  const ok = el('div', 'hc-ok');
  p1.append(mau, ok);
  raiz.append(p1);

  const p2 = el('div', 'hc-passo');
  p2.hidden = true;
  raiz.append(p2);

  const rodape = el('div', 'hc-rodape');
  rodape.textContent =
    'Não existe "entrar com a conta Claude" aqui, e nem precisa: quem conversa é o `claude` ' +
    'que já está instalado e logado na máquina que serve o hub — a mesma conta do terminal. ' +
    'Onde não houver esse claude (o servidor do deploy, por exemplo), o motor é a chave da ' +
    'Anthropic no ambiente do container. Nenhum dos dois passa por este navegador.';
  raiz.append(rodape);

  function diz(texto, bom){
    mau.textContent = bom ? '' : (texto || '');
    ok.textContent  = bom ? (texto || '') : '';
  }
  function ocupado(sim){
    campo.disabled = btEntrar.disabled = !!sim;
    btEntrar.textContent = sim ? 'conferindo…' : 'Entrar';
  }
  function foca(){
    try { campo.focus(); campo.select(); } catch (e) {}
  }

  /* O SEGUNDO PASSO: quem está atrás.
     Aparece DEPOIS da senha aceita, porque o /estado só responde a quem entrou. Ele existe
     mesmo quando está tudo certo: a diferença entre conversar com o `claude` da máquina (as
     ferramentas do terminal, a assinatura, edição direta no disco) e conversar com a API
     paga (o operador.py, cartão de proposta, cobrança por token) muda o que se pode pedir —
     e descobrir isso no meio da primeira conversa é tarde. */
  function mostraMotor(est){
    p1.hidden = true;
    p2.hidden = false;
    p2.innerHTML = '';
    const pronto = est.ligado !== false;
    const cli = est.motor === 'cli';

    if (pronto){
      p2.append(el('h4', null, 'Pronto para conversar'));
      const rot = rotuloMotor(est);
      if (rot) p2.append(el('code', null, rot));
      if (cli){
        p2.append(el('p', null,
          'O chat sobe o MESMO `claude` do terminal, na máquina que serve o hub, com o login ' +
          'que já está nela. Não há chave de API no caminho e nada é cobrado por token — é um ' +
          'acesso de terminal com outra cara.'));
        p2.append(el('p', null,
          'As ferramentas são as dele: ler, procurar, editar arquivo e rodar comando. Por isso ' +
          'não há cartão de proposta para aprovar — o que limita o alcance é a COLEIRA, o ' +
          'seletor colado no campo de escrever, e ela começa no modo que só lê e propõe.'));
      } else if (est.motor === 'api'){
        p2.append(el('p', null,
          'Esta instalação não tem o `claude` da máquina, então quem responde é a chave da ' +
          'Anthropic guardada no ambiente do container. Aqui cada mensagem é cobrada por ' +
          'token, o histórico inteiro sobe a cada envio, e toda mudança em arquivo vem como ' +
          'PROPOSTA, com diff e dois botões: nada é gravado sem o seu clique.'));
      } else {
        p2.append(el('p', null,
          'O servidor não disse qual motor está atrás — ele é mais velho que esta tela. Dá ' +
          'para conversar; o que a tela não pode fazer é adivinhar se aquilo é cobrado.'));
      }
    } else {
      p2.append(el('h4', null, 'Ainda não dá para conversar'));
      /* a frase é do SERVIDOR: é ele que sabe o que faltou (claude ausente, `--version` mudo,
         chave fora do ambiente). Reescrevê-la aqui seria adivinhar de longe. */
      p2.append(el('p', null, est.motivo ||
        'O servidor não tem motor para conversar: nem o `claude` desta máquina, nem chave de API.'));
      if (cli || !est.motor)
        p2.append(el('code', null, 'claude    ← rode uma vez na máquina do hub, para entrar na conta'));
      if (!cli && est.motor === 'api')
        p2.append(el('code', null, '/etc/altiumhub/senha.env   →   ANTHROPIC_API_KEY=sk-ant-…'));
      p2.append(el('p', null,
        'Não há campo para colar chave nem login aqui porque não há rota que os grave: o ' +
        'chatserver.py não tem nenhuma. Campo que não grava seria só uma mentira bonita.'));
    }

    const l2 = el('div', 'hc-linha');
    const btIr = el('button', 'hc-bt forte', pronto ? 'Conversar' : 'Entrar assim mesmo');
    if (!pronto) btIr.className = 'hc-bt';
    btIr.title = pronto ? 'abre a conversa'
                        : 'o painel abre e a conversa fica desligada até o motor existir';
    const btVer = el('button', 'hc-bt' + (pronto ? '' : ' forte'), 'Conferir de novo');
    l2.append(pronto ? btIr : btVer, pronto ? btVer : btIr);
    p2.append(l2);
    const m2 = el('div', 'hc-mau');
    p2.append(m2);

    btVer.onclick = async () => {
      btVer.disabled = true;
      btVer.textContent = 'conferindo…';
      const r = await sessao.testa(sessao.senha);
      btVer.disabled = false;
      btVer.textContent = 'Conferir de novo';
      if (r.ok){
        sessao.estado = r.estado;
        const novo = leEstado(r.estado);
        if (novo.ligado !== false || pronto){ mostraMotor(novo); return; }
        m2.textContent = 'o servidor ainda não achou motor — o container já subiu de novo?';
        return;
      }
      m2.textContent = r.msg;
    };
    btIr.onclick = () => aoEntrar();

    const volta = el('button', 'hc-textobt', 'usar outra senha');
    volta.onclick = () => {
      sessao.sai();
      p2.hidden = true;
      p1.hidden = false;
      campo.value = '';
      diz('');
      foca();
    };
    p2.append(volta);
  }

  async function entra(){
    /* a senha NÃO é aparada: espaço na ponta é senha, e o servidor compara byte a byte
       (hmac.compare_digest). Aparar aqui faria uma senha legítima ser recusada para sempre. */
    const s = campo.value;
    if (!s){ diz('escreva a senha mestre do hub'); foca(); return; }
    diz('');
    ocupado(true);
    const r = await sessao.testa(s);
    ocupado(false);
    if (r.ok){
      sessao.senha = s;
      sessao.estado = r.estado;
      guarda(CHAVE_SENHA, s);
      campo.value = '';
      /* sempre o segundo passo, mesmo estando tudo certo: ele é onde a tela diz com quem o
         usuário vai falar. Só custa um clique, e só na primeira vez deste navegador — quem
         já entrou volta direto para a conversa (ver `monta`). */
      mostraMotor(leEstado(r.estado));
      return;
    }
    /* o campo continua focado e com o texto selecionado: quem errou a senha vai digitar de
       novo, e não procurar o campo com o mouse. */
    diz(r.senhaRuim ? 'senha mestre incorreta.' : r.msg);
    foca();
  }

  btEntrar.onclick = entra;
  campo.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); entra(); }
  });

  if (recado) diz(recado, true);

  return {
    raiz, foca,
    conferindo(sim, texto){
      ocupado(sim);
      if (texto) diz(texto, true);
    },
    mostraMotor,
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   O PAINEL
   ════════════════════════════════════════════════════════════════════════════ */

/* A conversa propriamente dita. Quem chama é o `monta` lá embaixo, DEPOIS da tela de
   entrada — este pedaço parte do princípio de que já há senha aceita na sessão. */
function montaConversa(container, io, sessao, aoSair){
  poeCss();

  const ST = {
    io: io || {},
    sessao: sessao,
    /* a conversa que o servidor vai remontar: papel + texto + anexos. As ferramentas e os
       resultados ficam do lado de lá (o laço roda dentro de UMA requisição); o `conversa`
       é o identificador para o chatserver.py guardar o histórico rico dele, se quiser. */
    conversa: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    msgs: [], anexos: [],
    rodando: false, cancelado: false, parar: null,
    modelo: MODELO_PADRAO, modelos: null, precos: null,
    /* quem está atrás (ver `leEstado`). `pronto` é bool ou null: null = o servidor não disse,
       e não dizer não desliga a conversa. */
    motor: '', versao: '', pronto: null, motivo: '',
    /* o servidor dizendo se o dólar é conta a pagar (`dolar.fatura`); null = não disse */
    fatura: null,
    /* a coleira: os modos que o servidor anunciou, o escolhido, e se o modo SOLTO já foi
       confirmado nesta sessão do painel (uma vez só — ver `liberaModo`). */
    modos: [], modo: '', modoPadrao: '', soltoOk: false,
    /* o dólar EQUIVALENTE do motor CLI, somado pelos turnos. Não é fatura: é quanto este papo
       custaria pela API. Mora longe do contador de cima de propósito. */
    equiv: 0, avisoEquiv: '', sessaoCli: '',
    perguntando: false,   /* uma pergunta de coleira aberta; ver `envia` */
    uso: { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 },
    vivo: null,          /* o balão que está recebendo texto agora */
    ferAbertas: new Map(),
    /* os cartões de proposta ainda abertos. Eles precisam ser REVISTOS quando o projeto da
       tela muda: um cartão desenhado com o projeto A não pode continuar com o Aplicar ligado
       depois que o usuário trocou para o B. */
    cartoes: new Set(),
  };

  const toast = (m, k, ms) => { try { if (ST.io.toast) ST.io.toast(m, k || 'info', ms); } catch (e) {} };

  /* ── DOM ── */
  container.classList.add('hc');
  container.innerHTML = '';

  const topo = el('div', 'hc-topo');
  topo.append(el('span', 'hc-tit', 'Operador'));
  const rotProj = el('span', 'hc-proj', '');
  topo.append(rotProj);
  const dir = el('div', 'hc-dir');
  const selModelo = el('select', 'hc-sel');
  selModelo.title = 'modelo que responde';
  const conta = el('span', 'hc-conta', '');
  const btLimpar = el('button', 'hc-bt', 'Limpar');
  btLimpar.title = 'esquece a conversa e zera o contador';
  const btSair = el('button', 'hc-bt', 'Sair');
  btSair.title = 'apaga a senha mestre guardada neste navegador e volta para a tela de entrada';
  dir.append(conta, selModelo, btLimpar, btSair);
  topo.append(dir);

  const avisos = el('div', 'hc-avisos');
  const lista = el('div', 'hc-lista');
  lista.setAttribute('role', 'log');
  lista.setAttribute('aria-live', 'polite');

  const baixo = el('div', 'hc-baixo');
  const chips = el('div', 'hc-anexos');

  /* ── a coleira, colada no campo de escrever ── */
  const coleira = el('div', 'hc-coleira');
  coleira.hidden = true;
  const selModo = el('select', 'hc-sel hc-modo');
  selModo.title = 'até onde o Claude pode ir nesta máquina';
  const rotMotor = el('span', 'hc-motor', '');
  const rotEquiv = el('span', 'hc-equiv', '');
  coleira.append(selModo, rotMotor, rotEquiv);

  const escrita = el('div', 'hc-escrita');
  const btArquivo = el('button', 'hc-bt icone', '+');
  btArquivo.title = 'anexar arquivo, foto ou documento';
  const btRecorte = el('button', 'hc-bt icone', '⬚');
  const campo = el('textarea', 'hc-campo');
  campo.rows = 1;
  campo.placeholder = '';      /* ver o comentário do outro placeholder, logo abaixo */
  const btEnviar = el('button', 'hc-bt forte', 'Enviar');
  const entrada = el('input');
  entrada.type = 'file'; entrada.multiple = true; entrada.hidden = true;
  entrada.accept = 'image/*,application/pdf,.txt,.md,.csv,.json,.js,.log,.pas';
  escrita.append(btArquivo, btRecorte, campo, btEnviar, entrada);
  baixo.append(chips, coleira, escrita);

  container.append(topo, avisos, lista, baixo);

  /* ── avisos ── */
  function poeAviso(id, texto, tipo, extra){
    tiraAviso(id);
    const a = el('div', 'hc-aviso' + (tipo === 'err' ? ' err' : ''));
    a.dataset.hc = id;
    a.append(document.createTextNode(texto));
    if (extra){ a.append(document.createElement('br')); a.append(el('code', null, extra)); }
    avisos.append(a);
  }
  function tiraAviso(id){
    const v = avisos.querySelector('[data-hc="' + id + '"]');
    if (v) v.remove();
  }

  /* ── contador ──
     Mostra sempre os tokens; o dinheiro só quando ele é DINHEIRO DE VERDADE — ou seja, no
     motor da API. Com o motor CLI o que existe é um equivalente, e ele vive na coleira, com
     a frase que diz o que é (`desenhaEquiv`). */
  /* O número é FATURA ou é equivalente? O servidor responde (`dolar.fatura`); quando ele não
     responde, o motor responde por ele. Uma pergunta só, um lugar só — o contador de cima e a
     linha da coleira são os dois lados dela. */
  function ehFatura(){
    if (ST.fatura !== null) return ST.fatura;
    return ST.motor !== 'cli';
  }
  function precoDo(id){
    /* a tabela de reserva PRECO é de modelos da API (`claude-sonnet-5`…). Com o motor CLI os
       ids são apelidos do CLI (`sonnet`) e o token não tem preço: quem está na assinatura não
       paga por token. Deixar a reserva responder aqui inventaria uma conta. */
    if (!ehFatura()) return null;
    return (ST.precos && ST.precos[id]) || PRECO[id] || null;
  }
  function desenhaConta(){
    const c = custo(ST.uso, precoDo(ST.modelo));
    conta.textContent = '';
    conta.append(el('b', null, kilo(ST.uso.entrada)));
    conta.append(document.createTextNode(' ent · '));
    conta.append(el('b', null, kilo(ST.uso.saida)));
    conta.append(document.createTextNode(' sai'));
    if (c != null) conta.append(document.createTextNode(' · ' + moeda(c)));
    conta.title = c != null
      ? 'a conversa inteira até agora — entrada, saída e o que ela custou no modelo escolhido'
      : (!ehFatura()
         ? 'os tokens desta conversa. Pelo login do terminal não se paga por token; o que isto ' +
           'custaria pela API aparece na linha do modo, embaixo.'
         : 'tokens da conversa; o preço deste modelo o servidor ainda não informou');
  }

  /* ── a coleira ── */
  function modoAtual(){
    for (const m of ST.modos) if (m.id === ST.modo) return m;
    return null;
  }
  /* o mais seguro: o padrão que o servidor manda, se não for solto; senão o primeiro que não
     seja. É onde a coleira começa e para onde ela volta quando a confirmação é recusada. */
  function modoSeguro(){
    for (const m of ST.modos) if (m.id === ST.modoPadrao && !m.solto) return m;
    for (const m of ST.modos) if (!m.solto) return m;
    return ST.modos[0] || null;
  }
  function desenhaColeira(){
    const rot = rotuloMotor(ST);
    const tem = ST.modos.length > 0;
    coleira.hidden = !(tem || rot);
    rotMotor.textContent = rot;
    rotMotor.title = ST.motor === 'cli'
      ? 'o mesmo claude do terminal, rodando na máquina que serve o hub, com o login que já ' +
        'está nela' + (ST.sessaoCli ? ' — sessão ' + ST.sessaoCli : '')
      : (rot ? 'a conversa sai pela chave da API que mora no ambiente do servidor' : '');
    selModo.hidden = !tem;
    if (tem){
      selModo.innerHTML = '';
      for (const m of ST.modos){
        const o = el('option', null, m.rotulo);
        o.value = m.id;
        o.title = m.frase;
        selModo.append(o);
      }
      selModo.value = ST.modo;
    }
    const m = modoAtual();
    /* a frase do modo era um <span> aceso o tempo todo em cima do campo; agora ela e o `title`
       do seletor. Mesmo texto, mesmo servidor (`m.frase`), e sem uma linha de tela gasta com
       uma explicacao que se le uma vez. O title de cada OPCAO ja existia (o.title = m.frase),
       entao a frase aparece tanto no seletor fechado quanto ao percorrer a lista. */
    selModo.title = (m && m.frase) ? m.frase : 'até onde o Claude pode ir nesta máquina';
    coleira.classList.toggle('hc-solta', !!(m && m.solto));
    desenhaEquiv();
  }
  /* O DÓLAR DO CLI NÃO É FATURA, e a tela não pode deixar dúvida.
     O `claude` relata quanto o turno CUSTARIA pela API (claude_cli.py » `total_cost_usd`);
     quem está na assinatura não paga aquilo. Mostrá-lo do mesmo jeito que o contador do motor
     API faria o usuário somar no fim do mês um dinheiro que ninguém cobrou — e número que
     parece fatura sem ser é pior do que número nenhum. Então ele existe (é a única régua de
     tamanho de papo que o CLI dá), mas nunca sem a frase que diz o que ele é. */
  function desenhaEquiv(){
    if (ehFatura() || !(ST.equiv > 0)){
      rotEquiv.textContent = ''; rotEquiv.title = '';
      return;
    }
    rotEquiv.textContent = '≈' + moeda(ST.equiv) + ' se fosse API';
    rotEquiv.title = ST.avisoEquiv ||
      ('é o que esta conversa custaria pela API da Anthropic. Pelo login do terminal ela não é ' +
       'cobrada por token — o número serve de régua do tamanho do papo, não de conta a pagar.');
  }

  /* A pergunta no tema da página. Nunca `confirm()`: o diálogo do navegador chega em inglês,
     com a cara do sistema, e trava a aba. Quando não há modal de ninguém (o painel pode estar
     fora do hub), a pergunta vira uma faixa DENTRO do painel — que também é no tema. */
  function pergunta(frase, opc){
    const f = ST.io.confirm ||
      ((typeof window !== 'undefined' && window.HubDialog && window.HubDialog.confirm)
        ? (t, o) => window.HubDialog.confirm(t, o) : null);
    if (f){
      try { return Promise.resolve(f(frase, opc || {})); } catch (e) { /* cai na faixa */ }
    }
    return faixaPergunta(frase, opc || {});
  }
  function faixaPergunta(frase, opc){
    return new Promise(resolve => {
      tiraAviso('pergunta');
      const a = el('div', 'hc-aviso err');
      a.dataset.hc = 'pergunta';
      a.append(document.createTextNode(frase));
      const bs = el('div', 'hc-botoes');
      const sim = el('button', 'hc-bt perigo', opc.ok || 'Confirmar');
      const nao = el('button', 'hc-bt', 'Cancelar');
      const fim = v => { a.remove(); resolve(v); };
      sim.onclick = () => fim(true);
      nao.onclick = () => fim(false);
      bs.append(sim, nao);
      a.append(bs);
      avisos.append(a);
      try { nao.focus(); } catch (e) {}
    });
  }

  /* A coleira solta pede confirmação UMA VEZ POR SESSÃO do painel, e a frase diz em uma linha
     o que ela significa: comando rodando na máquina que serve o hub. Duas portas chegam aqui —
     trocar no seletor e mandar a primeira mensagem com um modo solto que veio guardado do
     navegador. A segunda é o motivo de a pergunta não acontecer na abertura do painel: modal
     que pula na cara de quem só abriu a aba é modal que se aprende a fechar sem ler. */
  async function liberaModo(){
    const m = modoAtual();
    if (!m || !m.solto || ST.soltoOk) return true;
    const ok = await pergunta(
      'No modo "' + m.rotulo + '" o Claude roda comando na máquina que serve o hub — com as ' +
      'ferramentas do terminal e sem perguntar a cada uma. Soltar?',
      { title: 'Soltar o Claude nesta máquina', ok: 'Soltar', danger: true });
    if (ok) ST.soltoOk = true;
    return !!ok;
  }
  function voltaAoSeguro(){
    const s = modoSeguro();
    if (!s) return;
    ST.modo = s.id;
    guarda(CHAVE_MODO, ST.modo);
    desenhaColeira();
  }

  /* ── modelos ── */
  function desenhaModelos(){
    const fonte = ST.modelos && ST.modelos.length
      ? ST.modelos
      : Object.keys(PRECO).map(id => ({ id, rotulo: PRECO[id].rotulo }));
    selModelo.innerHTML = '';
    for (const m of fonte){
      const o = el('option', null, m.rotulo || m.id);
      o.value = m.id;
      selModelo.append(o);
    }
    if (!fonte.some(m => m.id === ST.modelo) && fonte.length) ST.modelo = fonte[0].id;
    selModelo.value = ST.modelo;
  }

  /* ── mensagens ── */
  function coladoNoFim(){
    return lista.scrollTop + lista.clientHeight >= lista.scrollHeight - 40;
  }
  function desce(force){
    if (force || coladoNoFim()) lista.scrollTop = lista.scrollHeight;
  }

  function balao(papel){
    const m = el('div', 'hc-msg ' + (papel === 'usuario' ? 'hc-eu' : 'hc-ele'));
    m.append(el('span', 'hc-quem', papel === 'usuario' ? 'você' : 'operador'));
    const txt = el('div', 'hc-txt');
    m.append(txt);
    lista.append(m);
    return { raiz: m, txt };
  }

  function poeTurnoUsuario(texto, anexos){
    const b = balao('usuario');
    b.txt.textContent = texto || '';
    if (anexos && anexos.length){
      const faixa = el('div', 'hc-anexos');
      for (const a of anexos) faixa.append(chipDe(a, null));
      b.raiz.append(faixa);
      if (!texto) b.txt.remove();
    }
    desce(true);
  }

  /* ── as linhas de ferramenta ── */
  function poeFerramenta(ev){
    const f = fraseFerramenta(ev.nome, ev.entrada);
    const linha = el('div', 'hc-fer' + (f.cmd ? ' hc-bash' : ''));
    /* com comando, a linha vira duas: o verbo em cima e o comando inteiro embaixo, no bloco.
       Sem comando, a linha é a de sempre — não há caixa a mais para quem só leu um arquivo. */
    const cab = f.cmd ? el('div', 'hc-ferl') : linha;
    cab.append(el('span', 'hc-pt', '·'));
    cab.append(el('span', null, f.verbo));
    if (f.arg) cab.append(el('span', 'hc-arg', f.arg));
    if (f.cmd){
      linha.append(cab);
      const bloco = el('div', 'hc-cmd', f.cmd);
      bloco.title = f.cmd;
      linha.append(bloco);
    }
    /* a linha entra ANTES do texto que ainda vai chegar: o operador chama a ferramenta e só
       depois comenta o que achou, e é nessa ordem que se lê. */
    if (ST.vivo) lista.insertBefore(linha, ST.vivo.raiz);
    else lista.append(linha);
    if (ev.id) ST.ferAbertas.set(ev.id, linha);
    desce();
  }
  function fechaFerramenta(ev){
    const linha = ev.id ? ST.ferAbertas.get(ev.id) : null;
    ST.ferAbertas.delete(ev.id);
    if (linha){
      linha.classList.add('hc-fim');
      if (ev.erro) linha.classList.add('hc-ruim');
      if (ev.resumo){
        const a = linha.querySelector('.hc-arg');
        if (a) a.textContent = ev.resumo;
        else linha.append(el('span', 'hc-arg', ev.resumo));
      }
    }
    if (ev.proposta) poeProposta(ev.proposta);
  }
  function fechaPendentes(){
    for (const [, linha] of ST.ferAbertas) linha.classList.add('hc-fim');
    ST.ferAbertas.clear();
  }

  /* ── o cartão de proposta ── */
  function poeProposta(prop){
    const cartao = el('div', 'hc-prop');
    const cab = el('div', 'hc-ph');
    cab.append(el('span', 't', prop.titulo || prop.resumo_curto || 'mudança proposta'));
    const alvo = prop.arquivo || prop.alvo || '';
    if (alvo) cab.append(el('span', 'f', alvo));
    cartao.append(cab);
    if (prop.resumo) cartao.append(el('div', 'hc-res', prop.resumo));

    const linhas = linhasDoDiff(prop);
    if (linhas.length){
      const d = el('div', 'hc-diff');
      for (const l of linhas) d.append(el('div', l.cls, l.s || ' '));
      cartao.append(d);
    } else {
      cartao.append(el('div', 'hc-res', 'a proposta veio sem diff — confira no arquivo antes de aplicar'));
    }

    const barra = el('div', 'hc-pb');
    const btOk = el('button', 'hc-bt forte', 'Aplicar');
    const btNao = el('button', 'hc-bt', 'Descartar');
    const nota = el('span', 'hc-nota', '');
    barra.append(btOk, btNao, nota);
    cartao.append(barra);

    if (ST.vivo) lista.insertBefore(cartao, ST.vivo.raiz);
    else lista.append(cartao);
    desce();

    const titulo = prop.titulo || alvo || 'anterior';
    let fechado = false;             /* aplicada, descartada ou vencida — o cartão não volta */
    let confirmaDestrutiva = false;

    /* ── por que o Aplicar pode estar desligado ──
       Sem projeto na tela, `projetoAgora()` devolve "" — e "" é exatamente o valor que
       DESLIGA a cerca do servidor: o /aplicar só compara a proposta com o projeto aberto
       quando o cliente manda um (chatserver.py » api_aplicar, `if aberto and ...`). Mandar ""
       fazia uma proposta antiga, de outro projeto, ser gravada calada. Aqui o botão fica
       desligado e a nota diz por quê — desligado com motivo se conserta; gravado no projeto
       errado, não. */
    function razaoDeNao(){
      const aberto = projetoAgora();
      if (!aberto) return 'sem projeto aberto na tela — abra o projeto no hub para poder aplicar';
      const dela = String(prop.projeto || '').trim();
      /* o servidor compara com normcase; comparar aqui com sensibilidade a maiúsculas
         acusaria diferença onde o disco do Windows não vê nenhuma */
      if (dela && dela.toLowerCase() !== aberto.toLowerCase())
        return 'esta proposta é do projeto "' + dela + '" e a tela está no "' + aberto + '"';
      return '';
    }
    function revisa(){
      if (fechado) return;
      const razao = razaoDeNao();
      btOk.disabled = !!razao;
      btOk.title = razao || 'grava a mudança no arquivo do projeto aberto';
      nota.textContent = razao || 'nada é escrito sem este clique';
      confirmaDestrutiva = false;
    }
    function encerra(classe, texto){
      fechado = true;
      ST.cartoes.delete(revisa);
      btOk.disabled = btNao.disabled = true;
      if (classe) cartao.classList.add(classe);
      if (texto != null) nota.textContent = texto;
    }
    ST.cartoes.add(revisa);
    revisa();

    btNao.onclick = () => {
      encerra('hc-fora', 'descartada — nada foi escrito');
      /* o operador precisa SABER que foi recusada, senão ele reoferece a mesma coisa na
         próxima mensagem. Uma linha no histórico é mais barato do que o usuário ter de
         escrever "não" à mão. */
      ST.msgs.push({ papel: 'usuario', texto: '[a proposta "' + titulo + '" foi descartada]', anexos: [] });
    };

    btOk.onclick = async () => {
      if (fechado) return;
      /* de novo na hora do clique: o combobox de projeto pode ter mudado depois de o cartão
         ser desenhado, e é o clique que grava */
      const impede = razaoDeNao();
      if (impede){ revisa(); toast(impede, 'warn'); return; }

      if (prop.perigo){
        const frase = prop.perigo === true
          ? 'Esta mudança é destrutiva. Aplicar mesmo assim?' : String(prop.perigo);
        const pergunta = ST.io.confirm ||
          ((typeof window !== 'undefined' && window.HubDialog && window.HubDialog.confirm)
            ? (t, o) => window.HubDialog.confirm(t, o) : null);
        if (pergunta){
          const ok = await pergunta(frase, { title: 'Aplicar a proposta', ok: 'Aplicar', danger: true });
          if (!ok) return;
        } else if (!confirmaDestrutiva){
          /* sem modal no ambiente, a confirmação vira DOIS cliques neste mesmo botão. Nunca
             `confirm()`: o diálogo do navegador chega em inglês, com a cara do sistema, e
             trava a aba — e deixar passar sem perguntar, numa mudança destrutiva, é pior
             ainda que as duas coisas. */
          confirmaDestrutiva = true;
          nota.textContent = frase + ' Clique em Aplicar de novo para confirmar.';
          return;
        }
      }

      const aberto = projetoAgora();
      btOk.disabled = btNao.disabled = true;
      nota.textContent = 'aplicando…';
      try {
        const r = await ST.sessao.post(R.aplicar,
          { conversa: ST.conversa, projeto: aberto, proposta: prop });
        if (r && r.ok === false && r.mudou){
          /* O arquivo mudou embaixo da proposta, e o outro escritor é o próprio usuário pelo
             hub (o AI-GUIDE chama isso de "dois escritores"). A saída é REFAZER em cima do
             que está lá agora — forçar seria sobrescrever o que ele acabou de desenhar, que é
             justamente o que o carimbo do operador.py existe para impedir. Por isso não há
             botão de "aplicar mesmo assim": ele não existiria para ser usado com juízo. */
          encerra('hc-fora', (r.erro || r.error || 'o arquivo mudou desde a proposta') +
                             ' — esta proposta venceu');
          const btRefaz = el('button', 'hc-bt', 'Pedir de novo');
          btRefaz.title = 'manda o operador reler o arquivo e refazer a proposta';
          btRefaz.onclick = () => {
            btRefaz.disabled = true;
            envia('o ' + (alvo || 'arquivo') + ' mudou no disco desde aquela proposta, e ela ' +
                  'não foi aplicada. Releia o arquivo e refaça a proposta em cima do que está ' +
                  'lá agora.');
          };
          barra.insertBefore(btRefaz, nota);
          ST.msgs.push({ papel: 'usuario',
            texto: '[a proposta "' + titulo + '" nao foi aplicada: o arquivo mudou no disco ' +
                   'desde que ela nasceu. Releia o arquivo antes de propor de novo]', anexos: [] });
          toast('o arquivo mudou desde a proposta — refaça, não force', 'warn');
          return;
        }
        if (r && r.ok === false) throw new Error(r.erro || r.error || 'o servidor recusou');
        encerra('hc-feito', (r && (r.resumo || r.msg)) || 'aplicado');
        toast((r && (r.resumo || r.msg)) || 'mudança aplicada', 'ok');
        try { if (ST.io.recarregarVista) ST.io.recarregarVista(); } catch (e) {}
        ST.msgs.push({ papel: 'usuario', texto: '[a proposta "' + titulo + '" foi aplicada]', anexos: [] });
      } catch (e){
        if (e && e.senhaRuim) return;   /* a sessão já levou o usuário para a tela de entrada */
        btNao.disabled = false;
        btOk.disabled = !!razaoDeNao();
        nota.textContent = 'não aplicou: ' + (e && e.message ? e.message : e);
        toast('não deu para aplicar — ' + (e && e.message ? e.message : e), 'err');
      }
    };
  }

  /* ════════════ anexos ════════════ */

  function chipDe(anexo, aoTirar){
    const c = el('div', 'hc-chip' + (anexo.grande ? ' grande' : ''));
    if (anexo.tipo === 'imagem'){
      const im = el('img');
      im.src = 'data:' + anexo.mime + ';base64,' + anexo.dados;
      im.alt = anexo.nome || 'imagem';
      c.append(im);
    }
    c.append(el('span', 'n', anexo.nome || (anexo.tipo === 'imagem' ? 'recorte' : 'arquivo')));
    c.append(el('span', 'z', anexo.tipo === 'imagem'
      ? anexo.w + '×' + anexo.h
      : bytes(anexo.bytes || 0)));
    c.title = anexo.tipo === 'imagem'
      ? anexo.w + '×' + anexo.h + ' px · ' + bytes(anexo.bytes || 0) + ' · ≈' + kilo(tokensImagem(anexo.w, anexo.h)) + ' tokens'
      : bytes(anexo.bytes || 0);
    if (aoTirar){
      const x = el('button', null, '×');
      x.title = 'tirar este anexo';
      x.onclick = () => aoTirar(anexo);
      c.append(x);
    }
    return c;
  }

  function desenhaAnexos(){
    chips.innerHTML = '';
    for (const a of ST.anexos) chips.append(chipDe(a, tira));
    function tira(a){
      const i = ST.anexos.indexOf(a);
      if (i >= 0) ST.anexos.splice(i, 1);
      desenhaAnexos();
    }
  }

  function ehImagem(f){ return f && /^image\//.test(f.type || ''); }
  function ehTexto(f){
    return f && (/^text\//.test(f.type || '') || /\.(txt|md|csv|json|js|log|pas|py|html|css)$/i.test(f.name || ''));
  }

  function leComo(file, como){
    return new Promise((ok, ruim) => {
      const fr = new FileReader();
      fr.onerror = () => ruim(new Error('não deu para ler o arquivo'));
      fr.onload = () => ok(fr.result);
      if (como === 'texto') fr.readAsText(file);
      else fr.readAsDataURL(file);
    });
  }

  function imagemDe(url){
    return new Promise((ok, ruim) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => ruim(new Error('imagem ilegível'));
      im.src = url;
    });
  }

  /* Canvas → anexo. Reduz acima de LADO_MAX e escolhe o formato pelo TAMANHO, não pelo
     gosto: PNG mantém legível a serigrafia e a trilha de 1 px (JPEG borra as duas), então
     PNG é o padrão e o JPEG só entra quando o PNG estoura o teto por imagem da API. */
  async function anexoDoCanvas(cv, nome){
    const alvo = cabe(cv.width, cv.height, LADO_MAX);
    let fonte = cv;
    if (alvo.w !== cv.width || alvo.h !== cv.height){
      const menor = document.createElement('canvas');
      menor.width = alvo.w; menor.height = alvo.h;
      const cx = menor.getContext('2d');
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(cv, 0, 0, alvo.w, alvo.h);
      fonte = menor;
    }
    let mime = 'image/png';
    let url;
    /* toDataURL estoura em canvas "sujo" — basta a vista ter desenhado uma imagem de outra
       origem para o navegador proibir a leitura dos pixels. Estourar aqui derrubaria o
       anexo sem dizer por quê. */
    try { url = fonte.toDataURL(mime); }
    catch (e){ toast('o navegador não deixa ler os pixels deste desenho (canvas de outra origem)', 'err'); return null; }
    let cru = Math.round((url.length - url.indexOf(',') - 1) * 0.75);
    if (cru > TETO_IMG){
      mime = 'image/jpeg';
      url = fonte.toDataURL(mime, 0.86);
      cru = Math.round((url.length - url.indexOf(',') - 1) * 0.75);
      toast('a imagem era grande demais para PNG — foi como JPEG, o texto fino pode borrar', 'warn');
    }
    if (cru > TETO_IMG){
      toast('imagem grande demais (' + bytes(cru) + ') — o teto por imagem da API é ' + bytes(TETO_IMG), 'err');
      return null;
    }
    return { tipo: 'imagem', nome: nome || 'recorte.png', mime,
             dados: url.slice(url.indexOf(',') + 1), w: fonte.width, h: fonte.height, bytes: cru };
  }

  async function anexaArquivo(file){
    try {
      if (ehImagem(file)){
        const url = await leComo(file, 'url');
        const im = await imagemDe(url);
        const cv = document.createElement('canvas');
        cv.width = im.naturalWidth || im.width; cv.height = im.naturalHeight || im.height;
        cv.getContext('2d').drawImage(im, 0, 0);
        const encolheu = Math.max(cv.width, cv.height) > LADO_MAX;
        const a = await anexoDoCanvas(cv, file.name || 'imagem.png');
        if (!a) return;
        if (encolheu) toast('imagem reduzida para ' + a.w + '×' + a.h + ' — acima de ' + LADO_MAX +
                            ' px a API cobra pelo tamanho reduzido de qualquer jeito', 'info');
        ST.anexos.push(a);
      } else if ((file.type || '') === 'application/pdf'){
        if (file.size > TETO_IMG){
          toast('PDF grande demais (' + bytes(file.size) + ')', 'err'); return;
        }
        const url = await leComo(file, 'url');
        ST.anexos.push({ tipo: 'documento', nome: file.name || 'documento.pdf', mime: 'application/pdf',
                         dados: url.slice(url.indexOf(',') + 1), bytes: file.size });
      } else if (ehTexto(file)){
        let txt = await leComo(file, 'texto');
        let cortado = false;
        if (txt.length > TETO_TEXTO){ txt = txt.slice(0, TETO_TEXTO); cortado = true; }
        ST.anexos.push({ tipo: 'texto', nome: file.name || 'arquivo.txt', texto: txt,
                         bytes: file.size, grande: cortado });
        if (cortado) toast('o arquivo foi cortado em ' + bytes(TETO_TEXTO) + ' — mande o trecho que importa', 'warn');
      } else {
        toast('não sei mandar "' + (file.type || file.name) + '" — imagem, PDF ou texto', 'warn');
        return;
      }
      desenhaAnexos();
    } catch (e){
      toast('não deu para anexar: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  async function anexaVarios(files){
    for (const f of Array.from(files || [])) await anexaArquivo(f);
  }

  /* ════════════ recorte ════════════ */

  const temTelaInteira = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');

  /* O véu. Devolve o retângulo em px da TELA (viewport da janela de cima) ou null.
     `area` limita o arrasto; `fundo` é a imagem por baixo (a captura de tela).
     Trata os três casos que sempre quebram: arrasto para trás, retângulo de tamanho zero e
     Esc no meio do arrasto. */
  function arrasta(area, fundo, textoDica, aoInteira){
    return new Promise(resolve => {
      const ov = el('div', 'hc-ov');
      let img = null;
      if (fundo){
        img = el('img', 'hc-foto');
        img.src = fundo.url;
        img.style.left = area.left + 'px'; img.style.top = area.top + 'px';
        img.style.width = area.width + 'px'; img.style.height = area.height + 'px';
        ov.append(img);
      }
      const buraco = el('div', 'hc-area');
      buraco.style.left = area.left + 'px'; buraco.style.top = area.top + 'px';
      buraco.style.width = area.width + 'px'; buraco.style.height = area.height + 'px';
      ov.append(buraco);

      const barra = el('div', 'hc-barra');
      barra.append(el('span', null, textoDica));
      const kEsc = el('kbd', null, 'Esc'); barra.append(kEsc);
      barra.append(el('span', null, 'cancela'));
      if (aoInteira){
        const bi = el('button', 'hc-bt', 'usar a tela inteira');
        bi.onclick = () => { fim(); resolve({ inteira: true }); };
        barra.append(bi);
      }
      ov.append(barra);

      const sel = el('div', 'hc-ret');
      const med = el('div', 'hc-med');
      let ini = null;

      function fim(){
        ov.remove();
        window.removeEventListener('keydown', tecla, true);
        window.removeEventListener('pointerup', solta, true);
        window.removeEventListener('pointermove', move, true);
      }
      function tecla(e){
        if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); fim(); resolve(null); }
      }
      function move(e){
        if (!ini) return;
        const r = retanguloDe(ini, { x: e.clientX, y: e.clientY }, area);
        sel.style.left = r.left + 'px'; sel.style.top = r.top + 'px';
        sel.style.width = r.width + 'px'; sel.style.height = r.height + 'px';
        med.textContent = Math.round(r.width) + ' × ' + Math.round(r.height);
        med.style.left = Math.min(r.left, window.innerWidth - 90) + 'px';
        med.style.top = Math.max(2, r.top - 20) + 'px';
      }
      function solta(e){
        if (!ini) return;
        const r = retanguloDe(ini, { x: e.clientX, y: e.clientY }, area);
        ini = null;
        /* clique sem arrasto: o usuário só clicou. Sair com um retângulo de 0×0 viraria uma
           imagem vazia no chat — e uma imagem vazia é cobrada igual. */
        if (r.width < MIN_RECORTE || r.height < MIN_RECORTE){
          fim(); resolve(null);
          toast('o recorte saiu vazio — arraste um retângulo sobre a vista', 'warn');
          return;
        }
        fim(); resolve(r);
      }
      ov.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        /* a barra tem botão ("usar a tela inteira"): começar um arrasto ali, com o
           preventDefault que o arrasto precisa, engole o clique do próprio botão. */
        if (e.target.closest && e.target.closest('.hc-barra')) return;
        e.preventDefault();
        ini = { x: e.clientX, y: e.clientY };
        sel.style.width = sel.style.height = '0px';
        ov.append(sel, med);
      });
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', solta, true);
      window.addEventListener('keydown', tecla, true);
      document.body.append(ov);
    });
  }

  /* Recortar a VISTA: funciona em qualquer origem, porque o desenho já é canvas e o iframe é
     de mesma origem — drawImage de um canvas irmão não suja o destino. */
  async function recortaVista(){
    let cv = null;
    try { cv = ST.io.canvasDaVista ? ST.io.canvasDaVista() : null; } catch (e) { cv = null; }
    if (!cv){
      toast('abra a vista Esquema ou PCB para recortar — ou cole uma imagem com Ctrl+V', 'warn');
      return;
    }
    /* A vista pode não estar VISÍVEL: o hub mostra um painel por vez, e com o chat aberto
       sobre a aba Biblioteca o iframe da folha fica em display:none. O buffer do canvas
       sobrevive a isso — display:none não apaga pixel —, então em vez de desistir mostramos
       o ÚLTIMO QUADRO DESENHADO sob o véu e recortamos dele, que é exatamente o que a captura
       de tela já faz. Desistir aqui matava o único caminho de recorte que a LAN permite. */
    let area = retanguloNaTela(cv);
    let fundo = null, dica = 'arraste sobre a vista para recortar';
    if (!area || area.width < 2 || area.height < 2){
      if (!cv.width || !cv.height){
        toast('a vista ainda não desenhou nada para recortar', 'warn');
        return;
      }
      try { fundo = { url: cv.toDataURL('image/png') }; }
      catch (e){
        toast('o navegador recusou copiar o desenho da vista', 'err');
        return;
      }
      const cx = cabe(cv.width, cv.height,
                      Math.min(window.innerWidth - 60, window.innerHeight - 110));
      area = { left: Math.round((window.innerWidth - cx.w) / 2),
               top: Math.round((window.innerHeight - cx.h) / 2) + 14,
               width: cx.w, height: cx.h };
      dica = 'arraste para recortar o último desenho da vista';
    }
    const r = await arrasta(area, fundo, dica, fundo ? true : null);
    if (!r) return;
    if (r.inteira){
      const a0 = await anexoDoCanvas(cv, 'vista.png');
      if (a0){ ST.anexos.push(a0); desenhaAnexos(); campo.focus(); }
      return;
    }
    /* CSS px → px do canvas: o canvas da vista é esticado por CSS (width:100%) e o buffer
       tem outro tamanho (devicePixelRatio). Sem esta escala o recorte sai do lugar errado. */
    const kx = cv.width / area.width, ky = cv.height / area.height;
    const sx = (r.left - area.left) * kx, sy = (r.top - area.top) * ky;
    const sw = Math.max(1, Math.round(r.width * kx)), sh = Math.max(1, Math.round(r.height * ky));
    const corte = document.createElement('canvas');
    corte.width = sw; corte.height = sh;
    try {
      corte.getContext('2d').drawImage(cv, Math.round(sx), Math.round(sy), sw, sh, 0, 0, sw, sh);
    } catch (e){
      toast('o navegador recusou copiar o desenho da vista', 'err');
      return;
    }
    const a = await anexoDoCanvas(corte, 'recorte-vista.png');
    if (a){ ST.anexos.push(a); desenhaAnexos(); campo.focus(); }
  }

  /* Capturar a TELA DO SISTEMA (o Altium, por exemplo). Só existe onde o navegador libera
     getDisplayMedia — localhost ou HTTPS. Captura um quadro, mostra esse quadro sob o véu e
     deixa recortar dele; "usar a tela inteira" manda o quadro todo. */
  async function capturaTela(){
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
    } catch (e){
      /* o usuário clicar em "cancelar" no diálogo do navegador é NotAllowedError, e não é erro */
      if (e && e.name !== 'NotAllowedError') toast('a captura falhou: ' + e.message, 'err');
      return;
    }
    let cv = null;
    try {
      const v = document.createElement('video');
      v.srcObject = stream; v.muted = true;
      await v.play();
      await new Promise(ok => (v.videoWidth ? ok() : (v.onloadedmetadata = ok)));
      /* um quadro só: o vídeo começa preto e o primeiro frame pode chegar antes do desenho */
      await new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok)));
      cv = document.createElement('canvas');
      cv.width = v.videoWidth; cv.height = v.videoHeight;
      cv.getContext('2d').drawImage(v, 0, 0);
      v.pause(); v.srcObject = null;
    } finally {
      for (const t of stream.getTracks()) t.stop();   /* sem isso o Chrome fica gravando a tela */
    }
    if (!cv || !cv.width){ toast('a captura veio vazia', 'err'); return; }

    const url = cv.toDataURL('image/png');
    const cxTela = cabe(cv.width, cv.height, Math.min(window.innerWidth - 60, window.innerHeight - 110));
    const area = { left: Math.round((window.innerWidth - cxTela.w) / 2),
                   top: Math.round((window.innerHeight - cxTela.h) / 2) + 14,
                   width: cxTela.w, height: cxTela.h };
    const r = await arrasta(area, { url }, 'arraste para recortar a captura', true);
    if (!r) return;
    let corte = cv;
    if (!r.inteira){
      const kx = cv.width / area.width, ky = cv.height / area.height;
      const sw = Math.max(1, Math.round(r.width * kx)), sh = Math.max(1, Math.round(r.height * ky));
      corte = document.createElement('canvas');
      corte.width = sw; corte.height = sh;
      corte.getContext('2d').drawImage(cv, Math.round((r.left - area.left) * kx),
                                           Math.round((r.top - area.top) * ky), sw, sh, 0, 0, sw, sh);
    }
    const a = await anexoDoCanvas(corte, 'captura-tela.png');
    if (a){ ST.anexos.push(a); desenhaAnexos(); campo.focus(); }
  }

  let menuAberto = null;
  function fechaMenu(){
    if (menuAberto){ menuAberto.remove(); menuAberto = null; }
    window.removeEventListener('pointerdown', fechaMenu, true);
    window.removeEventListener('keydown', escMenu, true);
  }
  function escMenu(e){ if (e.key === 'Escape') fechaMenu(); }
  function menuRecorte(){
    fechaMenu();
    const m = el('div', 'hc-menu');
    const b1 = el('button', null, 'Recortar a vista');
    b1.append(el('small', null, 'o Esquema ou a PCB aberta aqui no hub'));
    b1.onclick = () => { fechaMenu(); recortaVista(); };
    const b2 = el('button', null, 'Capturar a tela do sistema');
    b2.append(el('small', null, 'qualquer janela — o Altium, por exemplo'));
    b2.onclick = () => { fechaMenu(); capturaTela(); };
    m.append(b1, b2);
    document.body.append(m);
    const r = btRecorte.getBoundingClientRect(), mr = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(r.left, window.innerWidth - mr.width - 6)) + 'px';
    m.style.top = Math.max(4, r.top - mr.height - 6) + 'px';
    menuAberto = m;
    setTimeout(() => {
      window.addEventListener('pointerdown', fechaMenu, true);
      window.addEventListener('keydown', escMenu, true);
    }, 0);
  }

  /* ════════════ conversa ════════════ */

  function projetoAgora(){
    try { return (ST.io.projeto && ST.io.projeto()) || ''; } catch (e) { return ''; }
  }
  function telaAgora(){
    try { return (ST.io.tela && ST.io.tela()) || {}; } catch (e) { return {}; }
  }

  function podeEnviar(){
    return !ST.rodando && ST.pronto !== false &&
           !!(campo.value.trim() || ST.anexos.length);
  }
  function ajustaBotoes(){
    btEnviar.disabled = !podeEnviar();
    btEnviar.textContent = ST.rodando ? 'Parar' : 'Enviar';
    btEnviar.classList.toggle('perigo', ST.rodando);
    btEnviar.classList.toggle('forte', !ST.rodando);
    if (ST.rodando) btEnviar.disabled = false;
    campo.disabled = ST.pronto === false;
    btArquivo.disabled = ST.pronto === false;
    selModo.disabled = ST.rodando;      /* trocar a coleira no meio do turno não muda o turno */
  }
  function ajustaAltura(){
    campo.style.height = 'auto';
    campo.style.height = Math.min(170, campo.scrollHeight) + 'px';
  }

  function paraServidor(m){
    return { papel: m.papel, texto: m.texto || '', anexos: (m.anexos || []).map(a => ({
      tipo: a.tipo, nome: a.nome, mime: a.mime, dados: a.dados, texto: a.texto,
      w: a.w, h: a.h })) };
  }

  /* `textoDado` é o único jeito de uma frase que o usuário não digitou ser enviada, e serve
     a um caso só: o "Pedir de novo" do cartão que venceu. Mesmo ali quem manda é um clique
     dele — nada neste painel gasta dinheiro sozinho. */
  async function envia(textoDado){
    const forcado = typeof textoDado === 'string' ? textoDado.trim() : '';
    if (ST.rodando){ if (!forcado) para(); return; }
    if (!forcado && !podeEnviar()) return;
    if (ST.pronto === false) return;

    const texto = forcado || campo.value.trim();
    /* o rascunho e os anexos do usuário não são varridos por uma frase que não foi ele que
       escreveu: eles ficam para a mensagem dele */
    const anexos = forcado ? [] : ST.anexos.slice();

    /* A COLEIRA É CONFERIDA ANTES DE O CAMPO SER LIMPO. A pergunta do modo solto pode ser
       recusada, e recusar não pode custar ao usuário o texto que ele acabou de escrever.
       `perguntando` existe porque durante a espera `rodando` ainda é falso: um segundo Enter
       ali dentro começaria um segundo turno com a mesma pergunta pendurada. */
    if (ST.perguntando) return;
    ST.perguntando = true;
    const liberou = await liberaModo();
    ST.perguntando = false;
    if (!liberou){
      voltaAoSeguro();
      const m = modoAtual();
      toast('nada foi enviado — a coleira voltou para "' + (m ? m.rotulo : 'o modo seguro') + '"', 'info');
      return;
    }

    if (!forcado){
      ST.anexos.length = 0; desenhaAnexos();
      campo.value = ''; ajustaAltura();
    }

    ST.msgs.push({ papel: 'usuario', texto, anexos });
    poeTurnoUsuario(texto, anexos);

    const corpo = {
      conversa: ST.conversa,
      modelo: ST.modelo,
      projeto: projetoAgora(),
      tela: telaAgora(),              /* o que está na tela AGORA — o operador só mexe nisto */
      mensagens: ST.msgs.map(paraServidor),
    };
    /* `modo` só viaja quando o servidor anunciou modos. Mandar um campo que o servidor velho
       nunca ouviu falar é inventar contrato — e o servidor novo, sem o campo, usa o padrão
       dele, que é o mais fechado. */
    if (ST.modos.length) corpo.modo = ST.modo;

    ST.rodando = true; ST.cancelado = false; ajustaBotoes();
    ST.vivo = balao('assistente');
    ST.vivo.raiz.classList.add('hc-vivo');
    desce(true);

    const aoEvento = bruto => {
      /* evento atrasado (o io pode entregar o último pedaço depois da promessa resolver, e
         Parar corta no meio) não tem mais balão para escrever — e escrever em `null` derruba
         o painel inteiro por causa do fim de uma resposta que já acabou. */
      if (ST.cancelado || !ST.vivo) return;
      const ev = normaliza(bruto);
      if (!ev) return;
      if (ev.t === 'texto'){
        ST.vivo.txt.textContent += ev.s;
        desce();
      } else if (ev.t === 'ferramenta'){
        poeFerramenta(ev);
      } else if (ev.t === 'resultado'){
        fechaFerramenta(ev);
      } else if (ev.t === 'fim'){
        fechaPendentes();
        ST.uso.entrada += ev.uso.entrada; ST.uso.saida += ev.uso.saida;
        ST.uso.cacheLeitura += ev.uso.cacheLeitura; ST.uso.cacheEscrita += ev.uso.cacheEscrita;
        if (ev.equivalente != null) ST.equiv += ev.equivalente;
        if (ev.sessao) ST.sessaoCli = ev.sessao;
        desenhaConta(); desenhaColeira();
        if (ev.motivo === 'max_tokens')
          ST.vivo.raiz.append(el('div', 'hc-fer hc-ruim', 'a resposta bateu no teto de tokens e parou no meio'));
      } else if (ev.t === 'erro'){
        fechaPendentes();
        const l = el('div', 'hc-fer hc-ruim');
        l.append(el('span', 'hc-pt', '!'));
        l.append(el('span', null, ev.msg + (ev.status ? ' (HTTP ' + ev.status + ')' : '')));
        lista.insertBefore(l, ST.vivo.raiz);
        /* 401 é a API dizendo que a chave não vale. No motor CLI ele não existe — lá a falta
           de motor vem como frase do /estado, e não como código HTTP. */
        if (ev.status === 401) marcaDesligado('');
        desce();
      }
    };

    try {
      const p = ST.sessao.fluxo(R.conversa, corpo, aoEvento);
      ST.parar = p && typeof p.cancelar === 'function' ? () => p.cancelar()
               : p && typeof p.abort === 'function' ? () => p.abort() : null;
      await Promise.resolve(p);
    } catch (e){
      /* abortar é o que o Parar faz de propósito, e senha recusada já mandou o usuário para a
         tela de entrada: nenhum dos dois é "a conversa caiu", e dizer que caiu faria procurar
         defeito onde não há. */
      const esperado = ST.cancelado || (e && (e.name === 'AbortError' || e.senhaRuim));
      if (!esperado && ST.vivo){
        const l = el('div', 'hc-fer hc-ruim');
        l.append(el('span', 'hc-pt', '!'));
        l.append(el('span', null, 'a conversa caiu: ' + (e && e.message ? e.message : e)));
        lista.insertBefore(l, ST.vivo.raiz);
      }
    } finally {
      fechaPendentes();
      const dito = ST.vivo.txt.textContent;
      ST.vivo.raiz.classList.remove('hc-vivo');
      if (!dito) ST.vivo.txt.remove();
      ST.msgs.push({ papel: 'assistente', texto: dito, anexos: [] });
      ST.vivo = null; ST.parar = null; ST.rodando = false;
      ajustaBotoes();
      desce();
    }
  }

  /* Parar. Se o io souber cancelar o SSE, cancela de verdade; se não souber, o painel para de
     desenhar e o servidor termina sozinho — dizer "parou" e continuar escrevendo na tela
     seria mentira, gastar o resto da resposta que já foi pedida não é. */
  function para(){
    ST.cancelado = true;
    if (ST.parar){ try { ST.parar(); } catch (e) {} }
    fechaPendentes();
    if (ST.vivo){
      ST.vivo.raiz.classList.remove('hc-vivo');
      ST.vivo.raiz.append(el('div', 'hc-fer', 'parado por você'));
    }
    ST.rodando = false; ajustaBotoes();
  }

  function limpa(){
    ST.msgs.length = 0;
    ST.uso = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 };
    ST.equiv = 0;
    /* a sessão do CLI vai junto: conversa nova é fio novo, e continuar mostrando o id da
       anterior faria a letra miúda apontar para um contexto que ninguém mais está usando. */
    ST.sessaoCli = '';
    ST.conversa = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    lista.innerHTML = '';
    desenhaConta(); desenhaColeira();
  }

  /* ── estado do servidor: tem motor? tem servidor? ── */
  function marcaDesligado(motivo){
    ST.pronto = false;
    ajustaBotoes();
    /* a frase é a do SERVIDOR quando ela existe: é ele que sabe se faltou o `claude` na
       máquina, se o `--version` não respondeu ou se a chave não está no ambiente. A nossa só
       entra quando ele não disse nada. */
    poeAviso('motor',
      motivo ||
      'O servidor não tem motor para conversar: nem o `claude` desta máquina, nem chave de API.',
      'warn',
      ST.motor === 'api' ? '/etc/altiumhub/senha.env  →  ANTHROPIC_API_KEY=sk-ant-…'
                         : 'claude    ← rode uma vez na máquina do hub, para entrar na conta');
  }

  /* Os modos que vieram do servidor viram a coleira. A escolha guardada neste navegador vale
     — inclusive a solta —, e ela não é perigosa por si: o modo solto só sai daqui depois da
     confirmação do `liberaModo`, que acontece antes do primeiro envio da sessão. Quando o
     servidor não anuncia modo nenhum (motor API, servidor velho), a coleira não existe e o
     campo `modo` não é enviado.

     O PADRAO DO SERVIDOR VALE, INCLUSIVE SOLTO. Antes, a coleira começava sempre num modo que
     não fosse solto, mesmo que o servidor anunciasse o contrário — e isso deixou de ser
     cuidado no dia em que o dono da máquina configurou o solto COMO padrão. Quem escolhe o
     padrão e quem confirmaria são a mesma pessoa; perguntar de novo é só um modal que se
     aprende a fechar sem ler. A confirmação continua existindo para o que ela sempre foi: a
     TROCA de um modo mais curto para o solto, no seletor. */
  function aplicaModos(est){
    ST.modos = est.modos;
    ST.modoPadrao = est.modoPadrao;
    if (!ST.modos.length){ ST.modo = ''; return; }
    const salvo = guardado(CHAVE_MODO, '');
    const vale = ST.modos.some(m => m.id === salvo);
    const padrao = ST.modos.find(m => m.id === ST.modoPadrao) || null;
    if (!vale && padrao && padrao.solto) ST.soltoOk = true;   /* o servidor já disse que sim */
    const inicial = padrao || modoSeguro();
    ST.modo = vale ? salvo : (inicial ? inicial.id : ST.modos[0].id);
    /* modo solto RESTAURADO do navegador continua pedindo confirmação: ele pode ter sido
       escolhido noutro dia, noutra máquina, por outra pessoa neste mesmo navegador */
  }

  async function perguntaEstado(){
    try {
      const r = await ST.sessao.post(R.estado, { projeto: projetoAgora() });
      tiraAviso('servidor');
      const est = leEstado(r);
      ST.motor = est.motor;
      ST.versao = est.versao;
      ST.motivo = est.motivo;
      ST.fatura = est.fatura;
      ST.avisoEquiv = est.avisoCusto;
      if (est.modelos.length){
        ST.modelos = est.modelos;
        ST.precos = {};
        for (const m of est.modelos)
          if (m.entrada != null || m.saida != null)
            ST.precos[m.id] = { entrada: Number(m.entrada) || 0, saida: Number(m.saida) || 0 };
      }
      if (est.modelo) ST.modelo = est.modelo;
      aplicaModos(est);
      desenhaModelos(); desenhaColeira(); desenhaConta(); desenhaEscrita();
      if (est.ligado === false) marcaDesligado(est.motivo);
      else {
        /* `null` (o servidor não disse) conta como ligado: um painel que se cala porque o
           servidor é mais velho que ele é um painel quebrado por conta própria. */
        ST.pronto = true; tiraAviso('motor'); ajustaBotoes();
      }
    } catch (e){
      /* senha recusada tem dono: a sessão já devolveu o usuário à tela de entrada, e pôr um
         aviso aqui seria escrever num painel que está saindo da tela. */
      if (e && e.senhaRuim) return;
      /* o chatserver ainda pode não estar registrado (deploy velho, ou o arquivo ainda não
         subiu). É diferente de "sem motor", e dizer qual dos dois é poupa meia hora. */
      ST.pronto = null;
      poeAviso('servidor',
        'O servidor do chat não respondeu. Confira se o hubserver está com o chatserver ' +
        'registrado e se a rota existe:', 'err', 'POST ' + R.estado + ' — ' + (e && e.message ? e.message : e));
      desenhaModelos(); desenhaConta(); ajustaBotoes();
    }
  }

  /* O convite do campo muda com o motor, porque o que se pede a cada um é diferente: ao motor
     CLI se pede trabalho no workspace (ele edita e roda), ao da API se pede proposta. */
  function desenhaEscrita(){
    /* SEM texto dentro do campo. O dono pediu para tirar: quem abriu o painel do chat já
       sabe que ali se escreve, e a frase ocupava a única linha vazia da tela. */
    campo.placeholder = '';
  }

  /* ── o que o botão de recorte sabe dizer de si ──
     Era uma linha de rodapé embaixo do campo ("Recorte: …"), e ela saiu a pedido do dono junto
     com a frase do modo: ficava acesa o tempo todo repetindo uma instrução que se lê uma vez.
     O que ela ENSINAVA não podia evaporar — o Ctrl+V é o único jeito de mandar um print do
     Altium quando a origem é http na LAN —, então o texto veio inteiro para o `title` do botão,
     que é onde vai parar quem está procurando como anexar a tela. */
  function desenhaRecorte(){
    btRecorte.title = temTelaInteira
      ? 'recortar a vista daqui, ou capturar a tela do sistema. Também aceita arquivo arrastado ' +
        'para cima do painel, ou colado com Ctrl+V.'
      : 'recortar a vista aberta — nesta origem (http na LAN) o navegador bloqueia a captura de ' +
        'tela. Para mandar o Altium: Win+Shift+S e cole aqui com Ctrl+V.';
  }

  /* ── ligações ── */
  btEnviar.onclick = () => envia();
  btLimpar.onclick = limpa;
  btSair.onclick = () => { if (aoSair) aoSair(); };
  btArquivo.onclick = () => entrada.click();
  btRecorte.onclick = () => { if (temTelaInteira) menuRecorte(); else recortaVista(); };
  entrada.onchange = async () => { await anexaVarios(entrada.files); entrada.value = ''; };
  selModelo.onchange = () => { ST.modelo = selModelo.value; desenhaConta(); };
  /* trocar a coleira: a solta pergunta AGORA, porque agora é quando o usuário está olhando
     para o seletor e a frase tem efeito. Recusou, volta para o que estava — e o que estava
     continua sendo o que vai no próximo envio. */
  selModo.onchange = async () => {
    const antes = ST.modo;
    ST.modo = selModo.value;
    desenhaColeira();
    if (!(await liberaModo())){
      ST.modo = antes;
      desenhaColeira();
      return;
    }
    guarda(CHAVE_MODO, ST.modo);
  };

  campo.addEventListener('input', () => { ajustaAltura(); ajustaBotoes(); });
  campo.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey){
      e.preventDefault();
      if (podeEnviar()) envia();
    }
  });

  /* COLAR. É o caminho que sobrevive à origem insegura — clipboard.read() está bloqueado na
     LAN, mas o evento paste com imagem chega inteiro, e é nele que o Win+Shift+S desemboca.

     Ouve no DOCUMENTO, e não no painel. Medido: o navegador entrega o paste ao elemento
     FOCADO, e depois de tirar o print o foco está no <body> — o evento chegava em `document`
     e nunca no container, então Win+Shift+S seguido de Ctrl+V não fazia nada. Era o caminho
     que o próprio painel ensina como o único da LAN, e era o que não funcionava.

     O preço de ouvir no documento é roubar o Ctrl+V de quem está escrevendo em outro campo da
     página; por isso a guarda: o painel precisa estar ABERTO, e um paste que nasce dentro de
     um campo de texto de fora do painel é dele, não nosso. */
  document.addEventListener('paste', async e => {
    if (!container.isConnected || !container.offsetParent) return;   /* painel fechado */
    const alvo = e.target;
    if (alvo && !container.contains(alvo)){
      const t = (alvo.tagName || '').toUpperCase();
      if (t === 'INPUT' || t === 'TEXTAREA' || alvo.isContentEditable) return;
    }
    const dt = e.clipboardData;
    if (!dt) return;
    const arquivos = [];
    for (const it of Array.from(dt.items || [])){
      if (it.kind === 'file'){
        const f = it.getAsFile();
        if (f) arquivos.push(f);
      }
    }
    if (!arquivos.length) return;        /* texto puro: deixa o paste normal acontecer */
    e.preventDefault();
    await anexaVarios(arquivos);
    campo.focus();
  });

  container.addEventListener('dragover', e => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    container.classList.add('hc-caindo');
  });
  container.addEventListener('dragleave', e => {
    if (e.target === container) container.classList.remove('hc-caindo');
  });
  container.addEventListener('drop', async e => {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    container.classList.remove('hc-caindo');
    await anexaVarios(e.dataTransfer.files);
    campo.focus();
  });

  /* ── partida ── */
  function atualizaProjeto(){
    const p = projetoAgora();
    rotProj.textContent = p || 'nenhum projeto aberto';
    rotProj.title = p ? 'o operador só mexe neste projeto' : 'abra um projeto para o operador ter no que mexer';
    if (p) tiraAviso('projeto');
    else poeAviso('projeto', 'Nenhum projeto aberto. O operador só mexe no projeto que está na tela — abra um para ele poder trabalhar.', 'warn');
    /* o projeto mudou: todo cartão de proposta ainda aberto tem de ser reavaliado AGORA, e
       não só no clique — o botão desligado é o aviso */
    for (const revisa of ST.cartoes){
      try { revisa(); } catch (e) {}
    }
  }

  desenhaModelos();
  desenhaConta();
  desenhaColeira();      /* escondida até o /estado dizer que há motor com modos */
  desenhaEscrita();
  desenhaRecorte();
  desenhaAnexos();
  atualizaProjeto();
  ajustaBotoes();
  perguntaEstado();

  const api = {
    estado: ST,
    envia, limpa, para,
    anexa: anexaArquivo,
    recortaVista, capturaTela,
    foca(){ try { if (!campo.disabled) campo.focus(); } catch (e) {} },
    /* o hub chama quando o combobox de projeto muda ou a aba troca */
    atualiza: atualizaProjeto,
    destroi(){ fechaMenu(); ST.cartoes.clear(); container.innerHTML = ''; },
  };
  return api;
}


/* ════════════════════════════════════════════════════════════════════════════
   O PAINEL INTEIRO: a tela de entrada na frente, a conversa atrás
   ════════════════════════════════════════════════════════════════════════════ */

function monta(container, io){
  if (!container) throw new Error('HubChat.monta: sem container');
  if (container.__hubchat) return container.__hubchat;   /* trocar de aba não recomeça a conversa */
  poeCss();

  const sessao = criaSessao(io);
  container.classList.add('hc-raiz');
  container.innerHTML = '';

  let chat = null;
  let porta = null;

  function limpaTela(){
    if (chat){ try { chat.destroi(); } catch (e) {} chat = null; }
    if (porta){ porta = null; }
    container.innerHTML = '';
  }

  function abreChat(){
    limpaTela();
    const alvo = el('div', 'hc');
    container.append(alvo);
    chat = montaConversa(alvo, io, sessao, sai);
    return chat;
  }

  function abrePorta(recado, conferindo){
    limpaTela();
    const p = montaPorta(sessao, abreChat, recado);
    porta = p;
    container.append(p.raiz);
    if (conferindo) p.conferindo(true, recado);
    else setTimeout(p.foca, 0);
    return p;
  }

  function sai(){
    sessao.sai();
    abrePorta('Você saiu — a senha foi apagada deste navegador.');
  }

  /* A senha guardada pode ter deixado de valer (o hubserver subiu com outra). Quando isso
     acontece NO MEIO de um pedido, o painel volta para a tela de entrada em vez de ficar
     tentando: um chat que responde 403 calado parece um chat quebrado. */
  sessao.aoPerder = () => {
    if (porta) return;                       /* já está na tela de entrada */
    sessao.sai();
    abrePorta('O servidor recusou a senha guardada — entre de novo.');
  };

  if (sessao.senha){
    /* já entrou nesta máquina: confere calado, e só volta a pedir se o servidor RECUSAR.
       Servidor mudo não manda ninguém digitar senha de novo — a conversa entra e o aviso de
       "o servidor do chat não respondeu" aparece lá dentro, que é onde ele se conserta. */
    const p = abrePorta('conferindo a senha guardada…', true);
    sessao.testa(sessao.senha).then(r => {
      if (porta !== p) return;               /* o usuário mexeu na tela enquanto isso */
      if (r.ok){
        sessao.estado = r.estado;
        abreChat();
      } else if (r.senhaRuim){
        sessao.sai();
        abrePorta('A senha guardada não vale mais — entre de novo.');
      } else {
        abreChat();
      }
    });
  } else {
    /* A PORTA PODE ESTAR ABERTA. Desde 2026-09-16 o dono da máquina pode deixar o chat sem
       senha (chatserver.py » "A PORTA ESTA ABERTA"), e aí desenhar a tela de entrada seria
       pedir uma senha que ninguém confere — a pior das telas: obrigatória e inútil.
       Então perguntamos ao servidor ANTES, com senha vazia: se ele responder, entra direto.
       Um servidor que exige senha recusa esse mesmo pedido, e aí a tela aparece como sempre. */
    const p = abrePorta('vendo se este hub pede senha…', true);
    sessao.testa('').then(r => {
      if (porta !== p) return;               /* o usuário digitou algo enquanto isso */
      if (r.ok && (r.estado || {}).exige_senha === false){
        sessao.estado = r.estado;
        abreChat();
      } else {
        abrePorta('');
      }
    });
  }

  const api = {
    get estado(){ return chat ? chat.estado : null; },
    sessao,
    /* delegam para a conversa quando ela existe; antes de entrar não há o que enviar */
    envia(t){ return chat ? chat.envia(t) : undefined; },
    limpa(){ if (chat) chat.limpa(); },
    para(){ if (chat) chat.para(); },
    anexa(f){ return chat ? chat.anexa(f) : undefined; },
    recortaVista(){ return chat ? chat.recortaVista() : undefined; },
    capturaTela(){ return chat ? chat.capturaTela() : undefined; },
    foca(){ if (chat) chat.foca(); else if (porta) porta.foca(); },
    atualiza(){ if (chat) chat.atualiza(); },
    sai,
    destroi(){
      limpaTela();
      container.__hubchat = null;
      container.classList.remove('hc-raiz');
    },
  };
  container.__hubchat = api;
  return api;
}


/* ════════════════════════════════════════════════════════════════════════════
   O LANÇADOR — um botão na borda direita e um painel encostado nela

   `instala(io)` injeta os dois no <body> e cuida de tudo; não precisa de container. O
   `monta(container, io)` continua existindo para quem quiser o painel embutido numa aba.

   Por que no <body> e não dentro de uma aba: as vistas Esquema e PCB são IFRAME dentro do
   hub, e um elemento fixo do documento de fora fica por cima do iframe inteiro. Um lançador
   só, aqui, cobre TODAS as telas — e não há cópia dentro dos frames para manter em dia.
   ════════════════════════════════════════════════════════════════════════════ */

const LARG_MIN = 300;

/* ── o piso do que tem de sobrar de hub ──
   O painel EMPURRA o hub em vez de cobri-lo (pedido do dono: "ele ocupa toda a lateral, mas eu
   preciso continuar podendo ver tudo"). Só que empurrar 300 px de painel numa janela de 400 px
   deixaria 100 px de hub — isso não é continuar vendo, é um talo. Então o empurrão SATURA:
   `min(largura, innerWidth - piso)`. Enquanto sobrar hub, ele empurra; passado o piso, o painel
   volta a cobrir só o excedente. Uma conta só, igual no arrasto e na abertura — sem um modo que
   troca de comportamento no meio do movimento. Numa janela de 400 px a conta dá negativo, o
   empurrão é zero e o painel cobre, exatamente como antes desta mudança.

   O PISO É METADE DO --page-min DO HUB (1040 px, declarado no hub.html:61; abaixo disso o #app
   já rola na horizontal por decisão do hub, não nossa). Metade, e não o valor inteiro, porque
   exigir 1040 desligaria o empurrão em qualquer notebook 1366 com o painel aberto
   (1366-420 = 946) — e lá o empurrão ainda paga, com uma barra horizontal curta. Com metade, o
   pior caso ainda mostra a metade esquerda da página e o resto está a um arrasto da barra;
   abaixo disso é ler a página por um buraco de fechadura, e aí cobrir — que um clique no botão
   desfaz — é mais honesto do que espremer. Em número: com o painel no mínimo (300 px), o
   empurrão vale até a janela cair abaixo de 820 px (520 + 300). */
let pisoCache = 0;
function pisoVista(){
  if (pisoCache) return pisoCache;
  let n = 0;
  /* o valor é do hub, e é lido dele: hardcodar 520 aqui faria a conta mentir no dia em que o
     hub mudasse o --page-min. Fora do hub a variável não existe e vale o número do hub.html. */
  try { n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-min')); }
  catch (e) { n = 0; }
  if (!(n > 0)) n = 1040;
  pisoCache = Math.round(n / 2);
  return pisoCache;
}

let posto = null;          /* instala() é idempotente: dois lançadores seriam dois chats */

/* `encaixe` é onde o lançador mora. Sem ele, o botão flutua grudado na borda direita, que
   era o desenho antigo e continua servindo a qualquer página que carregue este arquivo sem
   ter um cabeçalho. Com ele — o `hub.html` passa o vão ao lado do indicador de servidor — o
   botão vira um ícone de cabeçalho. A casca entrega um elemento vazio e nada mais, que é o
   que o CLAUDE.md pede dela. */
function instala(io, opcoes){
  if (posto){
    if (io) posto.io(io);
    if (opcoes && opcoes.encaixe) posto.encaixa(opcoes.encaixe);
    return posto;
  }
  const encaixe = (opcoes && opcoes.encaixe) || null;
  poeCss();

  let ioAtual = io || {};
  let painel = null;
  let aberto = false;
  let larg = Math.round(Number(guardado(CHAVE_LARG, '')) || 0) || 420;
  let soltaArrasto = null;   /* o encerrador do arrasto em curso, quando há um */

  const dock = el('div', 'hcx-dock');
  dock.setAttribute('role', 'complementary');
  dock.setAttribute('aria-label', 'Operador do hub');
  const pega = el('div', 'hcx-pega');
  pega.title = 'arraste para mudar a largura do painel';
  const corpo = el('div', 'hc-raiz');
  dock.append(pega, corpo);

  const bt = el('button', 'hcx-lanca');
  bt.type = 'button';
  bt.title = 'Operador — o chat do hub';
  bt.setAttribute('aria-label', 'abrir o operador');
  bt.setAttribute('aria-expanded', 'false');
  bt.append(marcaClaude());

  /* um <script> no <head> roda antes de existir <body>, e `document.body.append` ali levanta.
     Quem carrega o hub-chat.js no fim da página não passa por isto — quem carregar no topo,
     passa, e o lançador aparece assim que o documento termina em vez de derrubar a página. */
  function encaixa(onde){
    if (onde && onde.isConnected){
      bt.classList.add('hcx-no-topo');
      onde.append(bt);
    } else {
      bt.classList.remove('hcx-no-topo');
      document.body.append(bt);
    }
  }
  function pendura(){
    document.body.append(dock);
    encaixa(encaixe);
    poeLargura(larg);
  }
  if (document.body) pendura();
  else document.addEventListener('DOMContentLoaded', pendura, { once: true });

  /* Uma PONTE para o `io`, e não o objeto que veio: `instala(io)` pode ser chamado de novo
     com um io recém-montado (o hub redesenha a aba, o objeto é outro), e o painel guarda o
     que recebeu. Sem a ponte, ele continuaria perguntando o projeto a um io morto — e um
     projeto errado aqui é uma proposta gravada no lugar errado. O `bind` mantém o `this` do
     dono, e a ausência de um método continua sendo ausência (o painel testa `if (io.toast)`). */
  const ioPonte = {};
  for (const nome of ['projeto', 'tela', 'toast', 'canvasDaVista', 'recarregarVista', 'confirm']){
    Object.defineProperty(ioPonte, nome, {
      enumerable: true,
      get(){
        const f = ioAtual ? ioAtual[nome] : null;
        return typeof f === 'function' ? f.bind(ioAtual) : f;
      },
    });
  }

  /* A largura é lembrada, mas o TETO é da janela de agora: uma largura gravada num monitor
     grande não pode abrir um painel maior que a tela de um notebook. */
  function poeLargura(px){
    const teto = Math.max(LARG_MIN, window.innerWidth - 48);
    larg = Math.round(Math.min(Math.max(Number(px) || 420, LARG_MIN), teto));
    dock.style.width = larg + 'px';
    /* o botão anda junto com a borda: aberto, ele é o próprio fechar, grudado no painel */
    bt.style.right = aberto ? larg + 'px' : '0px';
    empurra();
  }

  /* Quanto do hub o painel empurra AGORA. É uma CLASSE no <body> mais uma variável, e não um
     style inline de padding: fechar o painel tira a classe e o hub volta sozinho — inclusive
     quando o fechamento acontece no meio de um arrasto, que é o caso em que um padding inline
     ficaria pendurado no body para sempre. Chamado de dentro do `poeLargura`, então vale para
     os três caminhos que mudam a largura: abrir, arrastar e redimensionar a janela. */
  function empurra(){
    const b = document.body;
    if (!b) return;          /* carregado no <head>: o body ainda não existe (veja `pendura`) */
    const px = aberto ? Math.max(0, Math.min(larg, window.innerWidth - pisoVista())) : 0;
    b.style.setProperty('--hcx-empurra', px + 'px');
    b.classList.toggle('hcx-empurra', px > 0);
  }
  poeLargura(larg);
  function abre(){
    if (aberto) return;
    aberto = true;
    dock.classList.add('aberto');
    bt.classList.add('aberto');
    bt.setAttribute('aria-expanded', 'true');
    bt.setAttribute('aria-label', 'fechar o operador');
    poeLargura(larg);
    if (!painel) painel = monta(corpo, ioPonte);
    else { try { painel.atualiza(); } catch (e) {} }
    /* o foco só depois da transição: focar um campo dentro de um elemento que ainda está
       deslizando faz o navegador rolar a página atrás dele */
    setTimeout(() => { try { painel.foca(); } catch (e) {} }, 200);
  }

  function fecha(){
    if (!aberto) return;
    /* fechar no meio de um arrasto encerra o arrasto ANTES de mais nada: senão o véu fica
       pendurado no <body> comendo todo clique do hub, e o ponteiro segue mexendo na largura de
       um painel que já saiu da tela. É também o que garante que nada sobra empurrado. */
    if (soltaArrasto) soltaArrasto();
    aberto = false;
    dock.classList.remove('aberto');
    bt.classList.remove('aberto');
    bt.setAttribute('aria-expanded', 'false');
    bt.setAttribute('aria-label', 'abrir o operador');
    poeLargura(larg);
    /* o dock fechado fica `visibility:hidden`, e o foco de dentro dele iria para o body:
       trazê-lo para o botão é o que mantém a tabulação onde o usuário estava */
    try { bt.focus(); } catch (e) {}
  }

  function alterna(){ if (aberto) fecha(); else abre(); }

  bt.onclick = alterna;

  /* ── a largura, arrastando a borda esquerda ── */
  pega.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    /* o véu: pointermove que passa por cima de um IFRAME é entregue ao documento DO IFRAME, e
       não a este — sem ele a largura trava assim que o ponteiro entra na vista Esquema/PCB */
    const veu = el('div', 'hcx-veu');
    document.body.append(veu);
    document.body.classList.add('hcx-arrastando');
    const move = ev => poeLargura(window.innerWidth - ev.clientX);
    const solta = () => {
      if (!soltaArrasto) return;      /* o `fecha` já encerrou este arrasto */
      soltaArrasto = null;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', solta, true);
      window.removeEventListener('pointercancel', solta, true);
      veu.remove();
      document.body.classList.remove('hcx-arrastando');
      guarda(CHAVE_LARG, String(larg));
    };
    soltaArrasto = solta;
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', solta, true);
    window.addEventListener('pointercancel', solta, true);
  });

  /* o piso do empurrão vem de uma variável CSS, e uma media query do hub pode trocá-la ao
     redimensionar — por isso o cache morre aqui, e não uma vez na carga */
  function aoRedimensionar(){ pisoCache = 0; poeLargura(larg); }
  window.addEventListener('resize', aoRedimensionar);

  /* ── Esc fecha, mas só quando o Esc é dele ──
     O véu do recorte e o menu tratam o próprio Esc (o véu até para a propagação); o #overlay
     do hub e o .hd-scrim do hub-dialog são modais de outros donos. Fechar o painel por baixo
     de um modal aberto tiraria o chão de quem ainda está respondendo à pergunta dele. */
  function coisaPorCima(){
    if (document.querySelector('.hc-ov, .hc-menu')) return true;
    if (document.querySelector('dialog[open]')) return true;
    const ov = document.getElementById('overlay');
    if (ov && ov.offsetParent !== null) return true;
    const hd = document.querySelector('.hd-scrim:not([hidden])');
    if (hd && hd.offsetParent !== null) return true;
    return false;
  }
  function tecla(e){
    if (e.key !== 'Escape' || !aberto) return;
    if (coisaPorCima()) return;
    e.preventDefault();
    fecha();
  }
  window.addEventListener('keydown', tecla);

  posto = {
    abre, fecha, alterna,
    aberto(){ return aberto; },
    painel(){ return painel; },
    largura(){ return larg; },
    /* quanto o hub está empurrado agora — é por aqui que a medição de fora confere o
       empurrão sem ter de reimplementar a saturação do piso */
    empurrao(){ return parseFloat(document.body.style.getPropertyValue('--hcx-empurra')) || 0; },
    botao: bt, dock,
    /* trocar a casa do lançador depois de instalado: o hub redesenha o cabeçalho e o
       elemento de encaixe é outro, então quem instala chama de novo com o novo vão */
    encaixa,
    io(novo){ if (novo) ioAtual = novo; },
    atualiza(){ if (painel) painel.atualiza(); },
    destroi(){
      window.removeEventListener('keydown', tecla);
      window.removeEventListener('resize', aoRedimensionar);
      if (soltaArrasto) soltaArrasto();
      if (painel){ try { painel.destroi(); } catch (e) {} painel = null; }
      /* o hub não pode ficar empurrado por um painel que não existe mais */
      try {
        document.body.classList.remove('hcx-empurra');
        document.body.style.removeProperty('--hcx-empurra');
      } catch (e) {}
      dock.remove(); bt.remove();
      posto = null;
    },
  };
  return posto;
}

/* `pure` sai no export porque é o que dá para conferir sem navegador: o retângulo do arrasto
   para trás, a classificação do diff, a redução da imagem e a conta do custo. São justamente
   as quatro que erram em silêncio — retângulo invertido não levanta exceção, só recorta o
   lugar errado. */
return { instala, monta, poeCss,
         pure: { normaliza, leEstado, emLista, rotuloMotor, fraseFerramenta, caminhoCurto,
                 linhasDoDiff, classifica, custo, cabe,
                 tokensImagem, retanguloDe, retanguloNaTela, kilo, bytes, moeda,
                 eventosDe, dadoDoBloco },
         MODELO_PADRAO, PRECO, LADO_MAX, TETO_IMG, ROTAS: R,
         CHAVE_SENHA, CHAVE_LARG, CHAVE_MODO, CAB_SENHA };
})();
if (typeof module === 'object' && module.exports) module.exports = HubChat;
