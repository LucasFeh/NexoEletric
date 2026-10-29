/* AltiumPCBMirror v2 - hub-atalhos.js — os atalhos de teclado das vistas Esquema e PCB.

   As tabelas, as regras de gravação e o editor das teclas. Morava inteiro no schframe.js, com
   o editor numa sub-aba "Atalhos" do painel da vista; o editor mudou para as Configurações do
   hub (aba Atalhos) e a vista ficou só com o teclado. Desde 2026-10-02 são DUAS tabelas, uma
   por vista, cada uma com a sua chave no localStorage, o seu padrão e os seus gestos:

   - HubAtalhos.sch, e o próprio HubAtalhos (CHAVE, ATALHOS_PADRAO, GESTOS, mapaAtalhos,
     defineAtalho, carrega, grava), que continua sendo o Esquema: schframe.js usa a tabela e o
     mapaAtalhos para saber o que cada tecla faz, e re-exporta as funções puras (os testes em
     Node as pegam por ele: tests/test-fio-topologia.js);
   - HubAtalhos.pcb, a vista PCB, com a mesma forma (CHAVE, QUANDO, ATALHOS_PADRAO, GESTOS,
     mapaAtalhos, defineAtalho, carrega, grava);
   - o hub chama pane() dentro do modal de configuração, e o editor mostra as duas.

   Tecla repetida só conta DENTRO da vista: o W é o fio no Esquema e a trilha na PCB.

   O que o usuário grava fica no localStorage (a chave do Esquema é a MESMA de antes, então
   quem já tinha trocado uma tecla não perde nada). O hub e as vistas (um <iframe> da mesma
   origem) dividem esse localStorage: gravar no modal dispara o evento `storage` na vista
   aberta, e ela troca o teclado na hora, sem recarregar. A vista PCB lê assim:

     let ATALHOS = HubAtalhos.pcb.mapaAtalhos(HubAtalhos.pcb.carrega());
     addEventListener('storage', e => {
       if (e.key === HubAtalhos.pcb.CHAVE || e.key === null)
         ATALHOS = HubAtalhos.pcb.mapaAtalhos(HubAtalhos.pcb.carrega());
     });
     const acao = ATALHOS.porTecla[HubAtalhos.normalizaTecla(e)];   // no keydown

   Autossuficiente como o hub-dialog.js: injeta o próprio CSS e traz os próprios rótulos em
   pt-BR. Em Node vale só a parte pura. */
"use strict";
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module !== 'undefined' && module.exports) module.exports = m;
  else raiz.HubAtalhos = m;
})(typeof self !== 'undefined' ? self : this, function () {

/* ══ A VISTA ESQUEMA ══ */

/* ── ATALHOS: uma tabela so ──
   A dica do painel era uma COPIA escrita a mao, e ja mentia: nao citava Ctrl+Y, Ctrl+A, Ctrl+W
   nem o Escape, que sozinho faz seis coisas. Agora a tabela e a verdade — o teclado le dela e o
   editor desenha dela, entao trocar uma tecla troca as duas de uma vez.
   O Escape fica DE FORA de proposito: ele e a saida de emergencia de seis estados e e tratado
   antes da guarda de campo de texto, para funcionar com o foco dentro de um <input>. */
const ATALHOS_SCH = [
  { id:'add',       tecla:'C',      rotulo:'Adicionar componentes' },
  { id:'fio',       tecla:'W',      rotulo:'Ferramenta fio' },
  { id:'terra',     tecla:'G',      rotulo:'Pousar terra (GND)' },
  { id:'rotulo',    tecla:'L',      rotulo:'Rótulo de net' },
  { id:'noerc',     tecla:'N',      rotulo:'No ERC' },
  { id:'girar',     tecla:'Espaço', rotulo:'Girar 90°' },
  { id:'espelhoX',  tecla:'X',      rotulo:'Espelhar na horizontal' },
  { id:'espelhoY',  tecla:'Y',      rotulo:'Espelhar na vertical' },
  /* so no meio do arrasto (schframe.js » rotearNoArrasto); parado, a tecla nao faz nada */
  { id:'rotear',    tecla:'D',      rotulo:'Rotear o componente arrastado até os fios alinhados' },
  { id:'apagar',    tecla:'Delete', rotulo:'Apagar a seleção' },
  { id:'enquadrar', tecla:'F',      rotulo:'Enquadrar a folha' },
  { id:'grade',     tecla:'B',      rotulo:'Mostrar/ocultar a grade' },
  { id:'desfazer',  tecla:'Ctrl+Z', rotulo:'Desfazer' },
  { id:'refazer',   tecla:'Ctrl+Y', rotulo:'Refazer' },
  { id:'tudo',      tecla:'Ctrl+A', rotulo:'Selecionar tudo da folha' },
  /* 2026-10-13, o DNA do Altium (hub-altiumdna.js): acréscimos, sem mexer nas de cima. As duas
     moram no menu Options do Altium, que o O abre (o O estava livre aqui): O,D = Document
     Options, O,S = Sheet (formato e template da folha). No Altium o template também é o D,T
     (Design » Sheet Templates), mas o D já é o rotear e uma tecla não pode ser ação e começo de
     sequência: o D,T fica para a predefinição "Padrão Altium" (PADRAO_ALTIUM_SCH). */
  { id:'template',  tecla:'O,S',    rotulo:'Template da folha (Design » Sheet Templates)', altium:'PLSch:SetTemplateFromLocal' },
  { id:'folha',     tecla:'O,D',    rotulo:'Propriedades da folha (Document Options)',     altium:'PLSch:DocumentPreferencesSchDocumentOptions' },
  /* 2026-10-27, pedido do dono: o Ctrl+F procura o componente por designador, comentário, nome,
     footprint ou parâmetro e vai marcando enquanto se digita (schframe.js » abreBusca) */
  { id:'buscar',    tecla:'Ctrl+F', rotulo:'Procurar componente (designador, comentário, nome...)' },
];
/* A predefinição "Padrão Altium" do Esquema: as teclas do Altium 21 de fábrica (os aceleradores
   de menu, P,W = Place » Wire, e as teclas diretas), tiradas do advsch.rcs pelo hub-altiumdna.js e
   conferidas contra ele no tests/test-altiumdna.js. A tabela da casa continua sendo o padrão; esta
   só entra quando a pessoa escolhe "Padrão Altium" no editor. O Ctrl+W (Interactive Routing) e o
   Ctrl+PgDn (Fit All) o navegador leva: ficam os aceleradores P,W e V,F. O rotear não existe no
   Altium e vai para o R, livre ali. */
const PADRAO_ALTIUM_SCH = {
  add:'P,P', fio:'P,W', terra:'P,O', rotulo:'P,N', noerc:'P,V,N', girar:'Espaço', espelhoX:'X', espelhoY:'Y',
  rotear:'R', apagar:'Delete', enquadrar:'V,F', grade:'Ctrl+Shift+G', desfazer:'Ctrl+Z', refazer:'Ctrl+Y',
  tudo:'Ctrl+A', template:'D,T', folha:'O,D', buscar:'Ctrl+F',
};

/* Os gestos do mouse e as teclas do fio: fixos (o teclado le a tabela de atalhos; estes o
   canvas trata direto, ANTES do mapa), mas moram na mesma tabela porque respondem a mesma
   pergunta. `quando` e a coluna Quando do VSCode: o Espaco da vista gira a selecao, e so com o
   fio na mao (W) ele inverte o canto. Sem `quando`, vale o da vista (QUANDO).
   Desde 2026-09-24 o fio se pega em dois cliques, como no Altium: o primeiro pega o fio
   inteiro, o segundo so o trecho (o duplo clique que promovia a fio inteiro saiu).
   O "so fios" e um botao da barra, sem tecla: e o mesmo Selecionar, so que o clique e o laço
   passam por cima de pino, designador e corpo e pegam o fio (schframe.js » setSoFio). */
const FIO = 'fio na mão (W)', ARRASTO = 'arrastando', SO_FIO = 'só fios (botão da barra)';
const GESTOS_SCH = [
  { rotulo:'Selecionar (no fio, o fio inteiro)',           teclas:['Clique'] },
  { rotulo:'Pegar só o trecho do fio (ou o vértice)',      teclas:['Segundo clique'] },
  { rotulo:'Acender a net',                                teclas:['Alt', 'Clique'] },
  { rotulo:'Somar à seleção',                              teclas:['Shift', 'Clique'] },
  { rotulo:'Mover a seleção',                              teclas:['Arrastar'] },
  { rotulo:'Andar reto no trilho da guia',                 teclas:['Shift'],            quando:ARRASTO },
  { rotulo:'Soltar as guias',                              teclas:['Ctrl'],             quando:ARRASTO },
  { rotulo:'Selecionar vários',                            teclas:['Arrastar no vazio'] },
  { rotulo:'Pegar o fio mesmo com componente por cima',    teclas:['Clique'],           quando:SO_FIO },
  { rotulo:'Selecionar só os fios',                        teclas:['Arrastar no vazio'], quando:SO_FIO },
  { rotulo:'Fixar o canto do fio',                         teclas:['Clique'],           quando:FIO },
  { rotulo:'Inverter o canto do fio',                      teclas:['Espaço'],           quando:FIO },
  { rotulo:'Mudar o modo do fio (90°, 45°, livre)',        teclas:['Shift', 'Espaço'],  quando:FIO },
  { rotulo:'Desfazer o último canto',                      teclas:['Backspace'],        quando:FIO },
  { rotulo:'Terminar o fio (de novo, larga a ferramenta)', teclas:['Botão direito'],    quando:FIO },
  { rotulo:'Arrastar a tela',                              teclas:['Botão direito', 'Arrastar'] },
  { rotulo:'Aproximar e afastar',                          teclas:['Roda do mouse'] },
  { rotulo:'Largar o que estiver na mão',                  teclas:['Escape'] },
];

/* ══ A VISTA PCB ══ */

/* Pedido do dono (2026-10-02): W cria trilha nova e Ctrl+2 poe via. Nao sao as do Altium 21 de
   fabrica (la e Ctrl+W ou P,T para a trilha, que o navegador leva, e P,V para a via; o Ctrl+2 de
   la e memoria de selecao). O resto segue o Altium 21 onde a tecla cabe na tabela, e o editor de
   simbolos onde ja havia costume (L linha, A arco, R retangulo, G poligono, T texto): por isso a
   grade sai do G de antes e vai para o B, como no Esquema, e o T deixa de ser trilha. O que o
   Altium faz com Shift+letra (Shift+S, camada unica) vira a letra sozinha: o normalizaTecla nao
   grava Shift em tecla de um caractere. Os ids e as teclas sao o contrato com o pcbframe.js,
   que programa contra eles. */
const ATALHOS_PCB = [
  { id:'trilha',      tecla:'W',      rotulo:'Trilha (roteamento interativo)' },
  { id:'via',         tecla:'Ctrl+2', rotulo:'Via (com a trilha na mão: via + troca de camada)' },
  { id:'linha',       tecla:'L',      rotulo:'Linha na camada atual' },
  { id:'arco',        tecla:'A',      rotulo:'Arco' },
  { id:'circulo',     tecla:'O',      rotulo:'Círculo' },
  { id:'retangulo',   tecla:'R',      rotulo:'Retângulo' },
  { id:'poligono',    tecla:'G',      rotulo:'Polígono' },
  { id:'texto',       tecla:'T',      rotulo:'Texto' },
  { id:'preencher',   tecla:'P',      rotulo:'Preencher formas (cheio/contorno)' },
  { id:'sinalizar',   tecla:'N',      rotulo:'Sinalizar para a IA' },
  { id:'medir',       tecla:'Ctrl+M', rotulo:'Medir distância' },
  { id:'unidade',     tecla:'Q',      rotulo:'Trocar a unidade mm/mil' },
  { id:'camadaUnica', tecla:'S',      rotulo:'Camada única' },
  { id:'proxCamada',  tecla:'+',      rotulo:'Próxima camada' },
  { id:'antCamada',   tecla:'-',      rotulo:'Camada anterior' },
  { id:'outraFace',   tecla:'*',      rotulo:'Top ↔ Bottom (com a trilha na mão: via + troca)' },
  { id:'virar',       tecla:'V',      rotulo:'Ver por baixo' },
  { id:'grade',       tecla:'B',      rotulo:'Mostrar/ocultar a grade' },
  { id:'diff',        tecla:'D',      rotulo:'Fantasmas das mudanças' },
  { id:'enquadrar',   tecla:'F',      rotulo:'Enquadrar a placa' },
  { id:'girar',       tecla:'Espaço', rotulo:'Girar 90°' },
  { id:'espelhoX',    tecla:'X',      rotulo:'Espelhar na horizontal' },
  { id:'espelhoY',    tecla:'Y',      rotulo:'Espelhar na vertical' },
  { id:'apagar',      tecla:'Delete', rotulo:'Apagar a seleção' },
  { id:'desfazer',    tecla:'Ctrl+Z', rotulo:'Desfazer' },
  { id:'refazer',     tecla:'Ctrl+Y', rotulo:'Refazer' },
  { id:'tudo',        tecla:'Ctrl+A', rotulo:'Selecionar tudo' },
  { id:'editar',      tecla:'E',      rotulo:'Travar/destravar a edição' },
  { id:'salvar',      tecla:'Ctrl+S', rotulo:'Salvar o changes.js' },
  { id:'ajuda',       tecla:'H',      rotulo:'Ajuda' },
  /* 2026-10-13, o DNA do Altium (hub-altiumdna.js): ações novas, acrescentadas no fim para não
     mexer em nada de cima. `altium` é o comando do Altium que a ação espelha (o plid do AdvPcb.rcs);
     o hub-altiumdna.js diz o caminho no menu e a tecla de lá.
     A tecla da casa é a do Altium quando ela cabe sem tirar ninguém do lugar: Ctrl+C/X/V e os
     alinhamentos com Ctrl+Shift (o normalizaTecla agora guarda o Shift quando há Ctrl ou Alt). O
     Shift+C do realcarNet chegaria como C, e o C fica livre na casa (é o exemplo de "tecla do
     Esquema que vale na PCB" do teste): ele vai para a predefinição. O Ctrl+clique que acende a
     net é gesto (GESTOS_PCB). As que no Altium são sequência de menu (T,D, P,G, D,R...) começam
     por uma letra que AQUI já é ferramenta (o T é o texto, o P o preencher, o D os fantasmas, o A o
     arco, o F o enquadrar): uma tecla não pode ser ação e começo de sequência ao mesmo tempo (seria
     esperar para saber qual das duas, ou disparar a errada), então na tabela da casa elas ficam sem
     tecla e a predefinição "Padrão Altium" (PADRAO_ALTIUM_PCB) as põe no lugar do Altium.
     O duplicar é o Rubber Stamp do Altium, Ctrl+R lá -- que aqui recarrega a página (TECLAS_
     PROIBIDAS); fica o Ctrl+D, que é o Duplicate do próprio Altium no Esquema (PLSCH:Duplicate).
     O Ctrl+Shift+R (alinhar à direita) e o Ctrl+Shift+T (ao topo) também são do navegador: no
     Altium elas têm o A,R e o A,T, que vão para a predefinição. */
  { id:'copiar',         tecla:'Ctrl+C',       rotulo:'Copiar',                               altium:'PLPCB:Copy' },
  { id:'recortar',       tecla:'Ctrl+X',       rotulo:'Recortar',                             altium:'PLPCB:Cut' },
  { id:'colar',          tecla:'Ctrl+V',       rotulo:'Colar',                                altium:'PLPCB:Paste' },
  { id:'duplicar',       tecla:'Ctrl+D',       rotulo:'Duplicar (o Rubber Stamp do Altium)',  altium:'PLPCB:RubberStamp' },
  { id:'alinharEsq',     tecla:'Ctrl+Shift+L', rotulo:'Alinhar à esquerda',                   altium:'PLPCB:AlignComponentsLeft' },
  { id:'alinharDir',     tecla:'',             rotulo:'Alinhar à direita',                    altium:'PLPCB:AlignComponentsRight' },
  { id:'alinharTopo',    tecla:'',             rotulo:'Alinhar ao topo',                      altium:'PLPCB:AlignComponentsTop' },
  { id:'alinharBase',    tecla:'Ctrl+Shift+B', rotulo:'Alinhar à base',                       altium:'PLPCB:AlignComponentsBottom' },
  { id:'alinharCentroH', tecla:'',             rotulo:'Alinhar os centros na horizontal',     altium:'PLPCB:AlignComponentsCenterHorizontal' },
  { id:'alinharCentroV', tecla:'',             rotulo:'Alinhar os centros na vertical',       altium:'PLPCB:AlignComponentsCenterVertical' },
  { id:'distribuirH',    tecla:'Ctrl+Shift+H', rotulo:'Distribuir na horizontal',             altium:'PLPCB:AlignComponentsSpreadHorizontal' },
  { id:'distribuirV',    tecla:'Ctrl+Shift+V', rotulo:'Distribuir na vertical',               altium:'PLPCB:AlignComponentsSpreadVertical' },
  { id:'ratsnest',       tecla:'',             rotulo:'Linhas de conexão (ratsnest)',         altium:'PLPCB:PopupShowConnectionsAll' },
  { id:'realcarNet',     tecla:'',             rotulo:'Limpar o realce da net (Shift+C)',     altium:'PLPCB:ClearFilter' },
  { id:'drc',            tecla:'',             rotulo:'Verificar as regras (DRC)',            altium:'PLPCB:DesignRuleCheck' },
  { id:'regras',         tecla:'',             rotulo:'Regras de projeto',                    altium:'PLPCB:DesignRules' },
  { id:'pour',           tecla:'',             rotulo:'Polygon pour',                         altium:'PLPCB:PlacePolygonPlane' },
  { id:'repour',         tecla:'',             rotulo:'Despejar de novo todos os polígonos',  altium:'PLPCB:RepourAllPolygonsNoContext' },
  { id:'teardrops',      tecla:'',             rotulo:'Teardrops',                            altium:'PLPCB:TearDrops' },
  { id:'pad',            tecla:'',             rotulo:'Pad avulso',                           altium:'PLPCB:PlacePad' },
  { id:'atualizarPcb',   tecla:'',             rotulo:'Trazer as mudanças do esquema (ECO)',  altium:'PLPCB:CompareAndUpdateMe' },
  { id:'pdf',            tecla:'',             rotulo:'PDF do layout',                        altium:'PLWorkspaceManager:ExportToPDF' },
  { id:'novaPlaca',      tecla:'',             rotulo:'Nova placa',                           altium:'PLWorkspaceManager:NewPCB' },
  /* 2026-10-14: a vista 3D (View » 2D/3D Layout Mode). O 2 e o 3 sao as teclas do Altium e
     estavam livres na casa; com a trilha na mao o 2 continua sendo a via (gesto, antes do mapa) */
  { id:'vista2d',        tecla:'2',            rotulo:'2D Layout Mode (vista 2D)',             altium:'PLPCB:ViewSwitchTo2D' },
  { id:'vista3d',        tecla:'3',            rotulo:'3D Layout Mode (vista 3D)',             altium:'PLPCB:ViewSwitchTo3D' },
  /* 2026-10-28: o auto-roteador em lote (hub-autoroteador.js, Route » Auto Route » All). U,A,A é a
     tecla do Altium, e o U estava livre na casa: aqui a sequência vale nas duas tabelas (o U sozinho
     continua abrindo o menu Route no cursor, como no Altium) */
  { id:'autorotear',     tecla:'U,A,A',        rotulo:'Auto-rotear (todas as conexões abertas)', altium:'PLPCB:AutorouteAll' },
];
/* Os comandos de cima que já existiam também espelham um comando do Altium: anotado aqui, e não
   na linha, para a tabela de antes ficar como era. */
const ALTIUM_PCB = { trilha:'PLManRoute:Track', via:'PLPCB:PlaceVia', linha:'PLManRoute:PlaceLine',
  arco:'PLPCB:PlaceArcCenter', circulo:'PLPCB:PlaceFullCircle', retangulo:'PLPCB:PlaceRectangle',
  poligono:'PLPCB:PlaceSolidRegion', texto:'PLPCB:PlaceString', medir:'PLPCB:MeasureDistance',
  unidade:'PLPCB:ToggleUnits', camadaUnica:'PLPCB:ToggleSingleLayerMode', proxCamada:'PLPCB:NextLayer',
  antCamada:'PLPCB:PreviousLayer', outraFace:'PLPCB:NextSignalLayer', virar:'PLPCB:FlipBoard',
  grade:'PLPCB:ToggleVisibleGridKind', enquadrar:'PLPCB:ViewFitBoard', apagar:'PLPCB:DeleteObjectsFocused',
  desfazer:'PLPCB:Undo', refazer:'PLPCB:Redo', tudo:'PLPCB:SelectAll', salvar:'PLWorkspaceManager:SaveDocument' };
const ALTIUM_SCH = { add:'PLSch:PlacePart', fio:'PLSch:PlaceWire', terra:'PLSch:PlacePowerPort',
  rotulo:'PLSch:PlaceNetLabel', noerc:'PLSch:PlaceNoERCGeneric', girar:'PLSch:RotateSelectedObjectsCCW',
  enquadrar:'PLSch:ZoomAll', grade:'PLSch:ToggleVisibleGrid', desfazer:'PLSch:Undo', refazer:'PLSch:Redo',
  tudo:'PLSch:SelectAllObjects', buscar:'PLSch:FindText' };
/* A predefinição "Padrão Altium" da PCB: TODA ação com tecla, as do Altium 21 de fábrica onde há
   (conferidas contra o hub-altiumdna.js no tests/test-altiumdna.js). As que só existem no hub
   (preencher, sinalizar, fantasmas, travar a edição, ajuda) vão para letras que o Altium não usa
   como começo de sequência neste mapa. A tabela da casa continua sendo o padrão. */
const PADRAO_ALTIUM_PCB = {
  trilha:'P,T', via:'P,V', linha:'P,L', arco:'P,A,A', circulo:'P,A,U', retangulo:'P,E', poligono:'P,R',
  texto:'P,S', preencher:'I', sinalizar:'K', medir:'Ctrl+M', unidade:'Q', camadaUnica:'S', proxCamada:'+',
  antCamada:'-', outraFace:'*', virar:'Ctrl+F', grade:'V,G,V', diff:'B', enquadrar:'V,F', girar:'Espaço',
  espelhoX:'X', espelhoY:'Y', apagar:'Delete', desfazer:'Ctrl+Z', refazer:'Ctrl+Y', tudo:'Ctrl+A', editar:'E',
  salvar:'Ctrl+S', ajuda:'H',
  copiar:'Ctrl+C', recortar:'Ctrl+X', colar:'Ctrl+V', duplicar:'Ctrl+D', alinharEsq:'Ctrl+Shift+L',
  alinharDir:'A,R', alinharTopo:'A,T', alinharBase:'Ctrl+Shift+B', alinharCentroH:'A,C', alinharCentroV:'A,V',
  distribuirH:'Ctrl+Shift+H', distribuirV:'Ctrl+Shift+V', ratsnest:'N', realcarNet:'C', drc:'T,D', regras:'D,R',
  pour:'P,G', repour:'T,G,A', teardrops:'T,E', pad:'P,P', atualizarPcb:'D,I', pdf:'F,M', novaPlaca:'F,N,P',
  vista2d:'2', vista3d:'3', autorotear:'U,A,A',
};

/* Os gestos da PCB, no molde dos do Esquema: o canvas os trata direto, ANTES do mapa.
   Tres linhas nao sao tecla fixa, sao ACOES do mapa num estado da vista, e trazem `acoes`: com a
   trilha na mao, a acao via e a outraFace (a tecla que estiver gravada para elas; Ctrl+2 e * no
   padrao) poem a via E trocam de camada; arrastando, a girar e as de espelhar valem para o que
   esta na mao. Nessas o editor mostra a tecla GRAVADA, para a tabela nao mentir depois que o
   usuario troca a tecla; `teclas` e o padrao da primeira acao. O 2 sozinho (via sem trocar de
   camada) e o L do arrasto (troca de face) sao fixos, como no Altium. O Shift+R tambem (o modo de
   conflito do roteamento interativo do Altium: contornar, parar no obstaculo ou ignorar): o
   normalizaTecla nao grava Shift em tecla de um caractere, entao no mapa ele chegaria como R, o
   Retangulo -- o canvas o trata antes do mapa, e so com a ferramenta Trilha. */
const TRILHA = 'trilha na mão (W)', TRILHA_SEL = 'trilha selecionada';
const GESTOS_PCB = [
  { rotulo:'Selecionar',                                teclas:['Clique'] },
  { rotulo:'Pegar o objeto de baixo, no mesmo ponto',   teclas:['Segundo clique'] },
  { rotulo:'Somar à seleção ou tirar dela',             teclas:['Shift', 'Clique'] },
  /* o Ctrl+clique do Altium (2026-10-13): acende a net do que está sob o cursor; a ação
     realcarNet (C, o Shift+C do Altium) limpa */
  { rotulo:'Acender a net',                             teclas:['Ctrl', 'Clique'] },
  { rotulo:'Selecionar o que fica dentro da janela',   teclas:['Arrastar no vazio →'] },
  { rotulo:'Selecionar o que a janela toca',            teclas:['Arrastar no vazio ←'] },
  { rotulo:'Mover o objeto (ou a seleção)',             teclas:['Arrastar'] },
  { rotulo:'Mover só a ponta da trilha selecionada',    teclas:['Arrastar a ponta'] },
  /* 2026-10-29, pedido do dono: o Drag e o Tab do Altium (hub-pcbtopologia.js). A trilha arrastada
     leva as vizinhas junto (nao quebra); o Tab pega a trilha ate a via, e o 2o Tab, alem dela */
  { rotulo:'Arrastar a trilha sem soltar das vizinhas (o Drag do Altium)', teclas:['Arrastar'], quando:TRILHA_SEL },
  { rotulo:'Selecionar a trilha inteira até a via',     teclas:['Tab'],             quando:TRILHA_SEL },
  { rotulo:'De novo: tudo o que liga, além da via',     teclas:['Tab', 'Tab'],      quando:TRILHA_SEL },
  { rotulo:'Arrastar a tela',                           teclas:['Botão direito', 'Arrastar'] },
  { rotulo:'Abrir o menu (sem arrastar)',               teclas:['Botão direito'] },
  { rotulo:'Aproximar e afastar, no cursor',            teclas:['Roda do mouse'] },
  { rotulo:'Andar para o lado',                         teclas:['Shift', 'Roda do mouse'] },
  { rotulo:'Abrir as Propriedades',                     teclas:['Clique duplo'] },
  /* 2026-10-16, pedido do dono: o Ctrl+W do Altium (Interactive Routing) pega a mesma Trilha do W.
     Fixo, ao lado da ação trilha (que continua no W e trocável): a vista o trata antes do mapa.
     Só no app desktop: no navegador o Ctrl+W fecha a aba (TECLAS_PROIBIDAS) */
  { rotulo:'Trilha (Interactive Routing do Altium, no app desktop)', teclas:['Ctrl', 'W'] },
  { rotulo:'Fixar o canto da trilha',                   teclas:['Clique'],          quando:TRILHA },
  { rotulo:'Inverter o canto da trilha',                teclas:['Espaço'],          quando:TRILHA },
  { rotulo:'Mudar o modo da trilha (45°, 90°, livre)',  teclas:['Shift', 'Espaço'], quando:TRILHA },
  { rotulo:'Conflito: contornar, parar no obstáculo ou ignorar', teclas:['Shift', 'R'], quando:TRILHA },
  { rotulo:'Desfazer o último trecho',                  teclas:['Backspace'],       quando:TRILHA },
  { rotulo:'Via sem trocar de camada',                  teclas:['2'],               quando:TRILHA },
  { rotulo:'Via e troca de camada',                     teclas:['*'],               quando:TRILHA, acoes:['outraFace', 'via'] },
  { rotulo:'Largura da trilha no painel',               teclas:['Tab'],             quando:TRILHA },
  { rotulo:'Terminar a trilha',                         teclas:['Botão direito'],   quando:TRILHA },
  { rotulo:'Largar a trilha',                           teclas:['Escape'],          quando:TRILHA },
  { rotulo:'Girar 90°',                                 teclas:['Espaço'],          quando:ARRASTO, acoes:['girar'] },
  { rotulo:'Trocar de face (componente)',               teclas:['L'],               quando:ARRASTO },
  { rotulo:'Espelhar',                                  teclas:['X'],               quando:ARRASTO, acoes:['espelhoX', 'espelhoY'] },
  { rotulo:'Soltar o snap e as guias',                  teclas:['Ctrl'],            quando:ARRASTO },
  { rotulo:'Largar o que estiver na mão',               teclas:['Escape'] },
];

/* ══ AS REGRAS: as mesmas nas duas vistas ══ */

/* O navegador leva estas antes da pagina ver. Deixar gravar uma delas seria entregar um
   "gravei e nao funciona" sem nenhuma pista de por que. */
const TECLAS_PROIBIDAS = ['Ctrl+W','Ctrl+T','Ctrl+N','Ctrl+Shift+N','Ctrl+Shift+T','Ctrl+R','Ctrl+P',
                          'F5','F11','F12','Escape','Tab','Ctrl+Tab',
                          /* desde que o normalizaTecla guarda o Shift com Ctrl (2026-10-13): recarregar
                             sem cache, fechar a janela e as ferramentas do desenvolvedor */
                          'Ctrl+Shift+R','Ctrl+Shift+W','Ctrl+Shift+I','Ctrl+Shift+J'];
/* Proibida: a lista acima, e qualquer combinacao que TERMINE em Escape. A vista trata todo
   e.key === 'Escape' antes de olhar o mapa (e a saida de emergencia de seis estados), entao um
   Shift+Escape gravado nunca dispararia. Numa sequencia (P,T) vale para cada tecla dela. */
function proibida(t){
  const p = acordes(t);
  if (p.length > 1) return p.length > MAX_ACORDES || p.some(proibida);
  return TECLAS_PROIBIDAS.indexOf(t) >= 0 || /(^|\+)Escape$/.test(String(t));
}

/* ── SEQUENCIAS: o P,T do Altium ──
   No Altium a letra sozinha abre um menu no cursor (P = Place) e a seguinte escolhe pela letra
   sublinhada (&Track): P,T e a trilha, T,G,A o Repour All. A tabela escreve assim, com virgula,
   como o Altium escreve; cada pedaco e uma tecla no formato do normalizaTecla ('Ctrl+K,Ctrl+S'
   tambem vale). A virgula como TECLA continua escrevivel: ',' sozinha e uma tecla, 'P,,' e P
   seguido da virgula, 'Ctrl+,' e o Ctrl com a virgula.
   A regra que segura tudo: uma tecla NAO pode ser acao e comeco de sequencia ao mesmo tempo. Se o
   T e o texto, T,D nao pode ser o DRC -- seria esperar um tempo para saber qual das duas a pessoa
   quis (o texto ficaria lerdo) ou disparar o texto e depois o DRC por cima. O mapaAtalhos trata
   essa colisao como trata tecla repetida, e o defineAtalho a recusa dizendo com quem bate. */
const MAX_ACORDES = 4;                         /* F,N,L,I do Altium tem quatro */
function acordes(t){
  const s = String(t == null ? '' : t);
  if (!s) return [];
  const out = [];
  let cur = '';
  for (const ch of s){
    if (ch === ',' && cur !== '' && !cur.endsWith('+')){ out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur !== '') out.push(cur);
  return out;
}
const ehSequencia = t => acordes(t).length > 1;
/* duas teclas colidem se sao a mesma ou se uma e o comeco da outra (P e P,T; P,A e P,A,A) */
function colide(a, b){
  const x = acordes(a), y = acordes(b);
  if (!x.length || !y.length) return false;
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return false;
  return true;
}
/* A tecla como a tabela a escreve. Shift nao entra em tecla de UM caractere: o navegador ja
   manda 'X' para Shift+x, e distinguir os dois criaria dois atalhos que a mao nao distingue.
   O mesmo vale para os simbolos que so saem com Shift. Medido em 2026-10-02 com o ToUnicodeEx
   do Windows (a conta de onde o Chrome tira o e.key) nos dois layouts desta bancada, US (0409)
   e ABNT (0416): nos dois o * de cima e Shift+8 e o + de cima e Shift+=; no teclado numerico o
   +, o - e o * saem sem Shift. Os seis caminhos dao '+', '-' e '*'. Com Ctrl o Windows nao da
   caractere (ou da um de controle, Ctrl+M = U+000D), e o Chrome cai na tecla sem o Ctrl: Ctrl+2,
   Ctrl+M e Ctrl+S chegam como '2', 'm' e 's' com ctrlKey, e saem 'Ctrl+2', 'Ctrl+M', 'Ctrl+S'.
   O que NAO da: o 2 do teclado numerico com o NumLock desligado e a seta para baixo (key
   'ArrowDown'), e sai 'Ctrl+ArrowDown'; o Ctrl+2 e o 2 da trilha pedem o 2 de cima ou o NumLock
   ligado. E o Ctrl+2 so fica com a pagina se ela chamar preventDefault() no keydown: medido no
   Chrome (headless, duas abas), sem ele a pagina vai para o fundo e o Chrome mostra a aba 2; com
   ele, fica. A tecla so chega a quem tem o foco: com o foco na casca do hub, o Ctrl+2 e dela. O
   NexoEletric nao tem aba nem acelerador de menu em Ctrl+2, Ctrl+M ou Ctrl+S.
   Desde 2026-10-13 o Shift FICA quando ha Ctrl ou Alt junto: Ctrl+Shift+L sai 'Ctrl+Shift+L', e
   nao mais 'Ctrl+L' (os alinhamentos do Altium sao Shift+Ctrl+L/B/H/V). Com Ctrl a mao distingue
   o Shift, e o Windows nao troca a tecla (Ctrl+Shift+L chega com key 'L'). Sozinho continua como
   era: Shift+X e X. Quem ja tinha gravado 'Ctrl+L' nao perde nada: o mapaAtalhos deixa o
   Ctrl+Shift+L cair no Ctrl+L quando nenhuma acao e dona do Ctrl+Shift+L (o porTecla herda, ver
   la). */
function normalizaTecla(e){
  if (!e || !e.key) return '';
  let k = e.key;
  if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return '';
  if (k === ' ' || k === 'Spacebar') k = 'Espaço';
  else if (k.length === 1) k = k.toUpperCase();
  const m = [];
  if (e.ctrlKey || e.metaKey) m.push('Ctrl');
  if (e.altKey) m.push('Alt');
  if (e.shiftKey && k !== 'Espaço' && (k.length > 1 || m.length)) m.push('Shift');
  m.push(k);
  return m.join('+');
}
/* 'Ctrl+Shift+L' -> 'Ctrl+L': a tecla como o normalizaTecla de antes a escrevia (o Shift caia
   em tecla de um caractere). '' quando nao muda. */
function semShiftAntigo(t){
  const m = /^((?:Ctrl\+)?(?:Alt\+)?)Shift\+(.)$/.exec(String(t));
  return m && m[1] ? m[1] + m[2] : '';
}

/* ══ UMA VISTA: a tabela, o mapa e a gravacao ══
   Cada vista tem o proprio mapa, entao a repeticao de tecla so conta dentro dela; as regras
   (tecla proibida, Esc reservado) sao as mesmas. `nome` e a chave interna do editor. */
function fazVista(nome, CHAVE, QUANDO, ATALHOS_PADRAO, GESTOS, ALTIUM, PADRAO_ALTIUM){
  const ids = new Set(ATALHOS_PADRAO.map(a => a.id));
  const daTabela = id => ATALHOS_PADRAO.find(a => a.id === id);

  /* O padrao, com o que o usuario gravou por cima. Entrada desconhecida, tecla proibida e tecla
     repetida sao DESCARTADAS em vez de derrubar o mapa: uma chave estragada no localStorage nao
     pode deixar a vista sem teclado nenhum. (A acao desconhecida e conferida na lista de ids, e
     nao no objeto: um "constructor" gravado passaria por acao que existe.)
     Desde 2026-10-13: a acao pode nascer SEM tecla (tecla '' na tabela: fica fora do porTecla e
     o editor mostra "sem tecla"), a tecla pode ser sequencia (P,T), e "repetida" passou a ser
     COLIDIR -- a mesma tecla, ou uma ser o comeco da outra (colide). `prefixos` e o conjunto dos
     comecos de sequencia, que o leitor usa para esperar a tecla seguinte. */
  function mapaAtalhos(salvos){
    const porAcao = {}, descartados = [];
    for (const a of ATALHOS_PADRAO) porAcao[a.id] = a.tecla;
    const s = salvos && typeof salvos === 'object' ? salvos : {};
    for (const id of Object.keys(s)){
      const t = String(s[id] || '');
      if (!ids.has(id)) { descartados.push(id + ': ação que não existe'); continue; }
      if (!t || proibida(t)) { descartados.push(id + ': tecla não permitida'); continue; }
      porAcao[id] = t;
    }
    const dono = (lista, t) => { for (const [x, id] of lista) if (colide(x, t)) return id; return null; };
    const primeira = [], repetidas = [];
    for (const a of ATALHOS_PADRAO){
      const t = porAcao[a.id];
      if (!t) continue;
      if (dono(primeira, t)){ repetidas.push(t); porAcao[a.id] = a.tecla; }   /* volta ao padrao do que repetiu */
      else primeira.push([t, a.id]);
    }
    /* a volta ao padrao pode ter repetido de novo; o segundo passe resolve sem laço infinito */
    const final = [];
    for (const a of ATALHOS_PADRAO){
      let t = porAcao[a.id];
      if (!t) continue;
      let d = dono(final, t);
      if (d && d !== a.id){ t = a.tecla; d = t ? dono(final, t) : null; }
      if (!t || (d && d !== a.id)){ porAcao[a.id] = ''; continue; }   /* sem tecla, mas o mapa fica de pe */
      porAcao[a.id] = t; final.push([t, a.id]);
    }
    /* O porTecla tem SO as teclas de verdade como chaves proprias (Object.keys conta uma por
       acao), e herda de um objeto escondido o Ctrl+Shift+X -> Ctrl+X: e a escrita antiga do
       normalizaTecla, entao quem gravou Ctrl+L (ou o padrao que for Ctrl+Z) segue disparando
       quando a mao aperta tambem o Shift -- a nao ser que outra acao seja dona do Ctrl+Shift+X. */
    const herdado = Object.create(null), finalTecla = Object.create(herdado), prefixos = new Set();
    for (const [t, id] of final){
      finalTecla[t] = id;
      const p = acordes(t);
      for (let i = 1; i < p.length; i++) prefixos.add(p.slice(0, i).join(','));
    }
    for (const [t] of final){
      const m = /^((?:Ctrl\+)?(?:Alt\+)?)(.)$/.exec(t);
      if (m && m[1]){
        const com = m[1] + 'Shift+' + m[2];
        if (!(com in finalTecla)) herdado[com] = finalTecla[t];
      }
    }
    return { porAcao, porTecla:finalTecla, descartados, repetidas, prefixos };
  }
  /* Grava uma tecla nova para uma ação; devolve o que a interface tem de dizer. A tecla vazia so
     vale para voltar ao padrao de uma acao que nasce sem tecla. */
  function defineAtalho(salvos, id, tecla){
    const a = daTabela(id);
    if (!a) return { ok:false, erro:'ação desconhecida' };
    const novo = Object.assign({}, salvos && typeof salvos === 'object' ? salvos : {});
    if (!tecla){
      if (a.tecla === '') { delete novo[id]; return { ok:true, salvos:novo }; }
      return { ok:false, erro:'tecla vazia' };
    }
    const p = acordes(tecla);
    if (p.some(x => /(^|\+)Escape$/.test(x))) return { ok:false, erro:'o Esc é reservado: larga o que estiver na mão' };
    if (p.length > MAX_ACORDES) return { ok:false, erro:'sequência de no máximo ' + MAX_ACORDES + ' teclas' };
    const ruim = p.find(x => proibida(x));
    if (ruim) return { ok:false, erro:'“' + ruim + '” é do navegador — escolha outra' };
    const m = mapaAtalhos(salvos);
    for (const [t, dono] of Object.entries(m.porTecla)){
      if (dono === id || !colide(t, tecla)) continue;
      const r = daTabela(dono), nomeDono = r ? r.rotulo.toLowerCase() : dono;
      if (t === tecla) return { ok:false, erro:'“' + tecla + '” já é ' + nomeDono };
      if (acordes(t).length > p.length) return { ok:false, erro:'“' + tecla + '” começa a sequência ' + t + ' (' + nomeDono + ')' };
      return { ok:false, erro:'“' + tecla + '” começa com ' + t + ', que já é ' + nomeDono };
    }
    if (a.tecla === tecla) delete novo[id];
    else novo[id] = tecla;
    return { ok:true, salvos:novo };
  }
  /* A predefinicao: 'casa' (a tabela, o padrao de sempre) ou 'altium' (as teclas do Altium 21).
     Devolve o que gravar -- so o que difere da tabela, como o editor grava. */
  function predefinicao(qual){
    if (qual !== 'altium' || !PADRAO_ALTIUM) return {};
    const out = {};
    for (const a of ATALHOS_PADRAO){
      const t = PADRAO_ALTIUM[a.id];
      if (t != null && t !== a.tecla) out[a.id] = t;
    }
    return out;
  }
  /* o que esta gravado bate com uma predefinicao inteira? ('casa', 'altium' ou '') */
  function qualPredefinicao(salvos){
    const m = mapaAtalhos(salvos);
    for (const q of ['casa', 'altium']){
      const p = mapaAtalhos(predefinicao(q));
      if (ATALHOS_PADRAO.every(a => p.porAcao[a.id] === m.porAcao[a.id])) return q;
    }
    return '';
  }
  /* o comando do Altium que a acao espelha (plid do .rcs; o hub-altiumdna.js diz o resto) */
  const altiumDe = id => { const a = daTabela(id); return (a && a.altium) || (ALTIUM && ALTIUM[id]) || ''; };

  /* ── o que esta gravado nesta maquina ──
     Mesmo molde de toda preferencia de vista: try/catch e o padrao no codigo. Uma chave
     estragada volta como {} e o mapaAtalhos faz o resto. */
  /* 2026-10-14, pedido do dono: o padrao e o do ALTIUM ("T, D, R abre o rule check, quero que
     essa identidade venha do altium"). Sem nada gravado nesta maquina vale a predefinicao Padrao
     Altium; o botao "Padrao NexoEletric" grava '{}' (a tabela da casa) e ela fica. */
  function carrega(){
    try {
      const cru = localStorage.getItem(CHAVE);
      if (cru === null && PADRAO_ALTIUM) return predefinicao('altium');
      const v = JSON.parse(cru || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch (e) { return {}; }
  }
  function grava(salvos){
    try {
      localStorage.setItem(CHAVE, JSON.stringify(salvos && typeof salvos === 'object' ? salvos : {}));
    } catch (e) {}
  }

  return { nome, CHAVE, QUANDO, ATALHOS_PADRAO, GESTOS, PADRAO_ALTIUM, mapaAtalhos, defineAtalho, carrega, grava,
           predefinicao, qualPredefinicao, altiumDe };
}

const sch = fazVista('sch', 'altiumhub.sch.atalhos', 'vista Esquema', ATALHOS_SCH, GESTOS_SCH, ALTIUM_SCH, PADRAO_ALTIUM_SCH);
const pcb = fazVista('pcb', 'altiumhub.pcb.atalhos', 'vista PCB', ATALHOS_PCB, GESTOS_PCB, ALTIUM_PCB, PADRAO_ALTIUM_PCB);
const VISTAS = [sch, pcb];

/* ── O LEITOR DE SEQUENCIAS: o que a vista chama no keydown no lugar do porTecla direto ──
   Puro (sem DOM; o relogio e o setTimeout de quem chama), para os testes em Node.

     const leitor = HubAtalhos.leitor(() => ATALHOS, fazAcao, { aoEsperar: seq => status(seq) });
     // no keydown, depois dos gestos fixos do estado (trilha, arrasto):
     if (leitor.tecla(HubAtalhos.normalizaTecla(e))) e.preventDefault();
     // no Esc, e ao trocar de ferramenta: leitor.cancela();

   tecla(t) devolve true quando a tecla foi do mapa (disparou uma acao ou abriu/continuou uma
   sequencia) e false quando nao e de ninguem. Sem sequencia gravada ele e exatamente o
   `porTecla[t]` de antes. Numa sequencia aberta (P, ...), a tecla que nao continua nenhuma
   fecha a espera e vale sozinha -- como o menu do Altium que some quando a letra nao e de
   ninguem. A espera tambem cai sozinha depois de `o.espera` ms (1500), e o `aoEsperar(seq)`
   avisa a vista para mostrar "P, …" no rodape ('' quando acaba). `tecla(t, {direto:true})`
   ignora sequencias: para um estado que tem as proprias teclas (o arrasto do rotear). */
function leitor(mapa, dispara, o){
  o = o || {};
  const espera = o.espera > 0 ? o.espera : 1500;
  const aviso = typeof o.aoEsperar === 'function' ? o.aoEsperar : () => {};
  let aberta = '', timer = null;
  const pega = () => (typeof mapa === 'function' ? mapa() : mapa) || { porTecla:{} };
  function fecha(){ if (timer) { clearTimeout(timer); timer = null; } if (aberta){ aberta = ''; aviso(''); } }
  function abre(seq){
    aberta = seq; aviso(seq);
    if (timer) clearTimeout(timer);
    if (typeof setTimeout === 'function') timer = setTimeout(() => { timer = null; aberta = ''; aviso(''); }, espera);
  }
  function tecla(t, o2){
    if (!t) return false;
    const m = pega(), pref = m.prefixos instanceof Set ? m.prefixos : new Set();
    if (o2 && o2.direto){ fecha(); const id = m.porTecla[t]; if (id){ dispara(id, t); return true; } return false; }
    if (aberta){
      const seq = aberta + ',' + t;
      if (Object.prototype.hasOwnProperty.call(m.porTecla, seq)){ fecha(); dispara(m.porTecla[seq], seq); return true; }
      if (pref.has(seq)){ abre(seq); return true; }
      fecha();                                   /* nao continua nada: vale sozinha */
    }
    if (pref.has(t)){ abre(t); return true; }
    const id = m.porTecla[t];
    if (id){ dispara(id, t); return true; }
    return false;
  }
  return { tecla, cancela: fecha, pendente: () => aberta };
}

/* ── o editor (aba Atalhos das Configurações do hub) ───────────────────────────────
   No molde do "Keyboard Shortcuts" do VSCode, a pedido do usuario: a busca no topo, uma
   tabela Comando | Atalho | Quando | Origem, as teclas desenhadas como teclinhas, e a troca
   por duplo clique (ou Enter, ou o lapis) numa caixa que diz "pressione a combinacao e depois
   Enter". Os gestos do mouse entram na mesma tabela como linhas FIXAS: e a mesma pergunta
   ("como eu faco X?") e a resposta tem de estar no mesmo lugar.
   As duas vistas ficam na mesma tabela, cada uma no seu grupo (com o proprio "Restaurar o
   padrao", que so mexe na chave dela), e a busca vale para as duas: o Quando diz de que vista
   e a linha, e a gravacao de teclas acha a tecla nas duas. */
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
.hat-info { display: flex; align-items: center; gap: 10px; min-height: 26px; margin-top: 8px; font-size: 11.5px;
  color: var(--text-3); }
.hat-tab { margin-top: 6px; font-size: 12.5px; }
.hat-cab, .hat-l { display: grid; grid-template-columns: 22px minmax(0, 1.5fr) minmax(0, 1.25fr) 100px 72px;
  align-items: center; column-gap: 8px; min-height: 26px; padding: 0 6px 0 2px; }
.hat-cab { position: sticky; top: var(--hat-cab-top, 68px); z-index: 1; font-weight: 600; color: var(--text);
  background: var(--surface-2); border-radius: 4px 4px 0 0; box-shadow: inset 0 -1px 0 var(--line); }
.hat-grupo + .hat-grupo { margin-top: 14px; }
.hat-g { display: flex; align-items: center; gap: 10px; min-height: 30px; padding: 4px 6px 2px 4px;
  border-bottom: 1px solid var(--line-soft); }
.hat-g .nome { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-2); }
.hat-g .cont { font-size: 11.5px; color: var(--text-3); }
.hat-g .btn { margin-left: auto; }
.hat-l { color: var(--text); border-radius: 3px; cursor: default; outline: none; user-select: none;
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
.hat-k .ou { color: var(--text-3); font-size: 11px; margin: 0 2px; }
.hat-k .seq { color: var(--text-3); font-size: 11px; margin: 0 1px 0 -1px; }
.hat-k .sem { color: var(--text-4); font-size: 11px; }
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
.hat-caixa .msg { min-height: 17px; margin-top: 8px; font-size: 11.5px; line-height: 1.45; color: var(--text-3); }
.hat-caixa .msg.err { color: var(--err); }
.hat-caixa .msg.ok { color: var(--ok); }
.hat-caixa .msg.aviso { color: var(--warn); }
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

/* 'Ctrl+Shift+Z' -> ['Ctrl','Shift','Z']; o '+' como tecla ('Ctrl++') continua sendo uma */
function partes(t){
  if (!t) return [];
  if (t === '+') return ['+'];
  const p = String(t).split('+');
  if (t.endsWith('++')) p.splice(p.length - 2, 2, '+');
  return p.filter(x => x !== '');
}
/* a sequencia (P,T) em teclinhas: os acordes separados por SEQ, que o desenho troca pela virgula */
const SEQ = '\u0000,';
function partesSeq(t){
  const out = [];
  acordes(t).forEach((a, i) => { if (i) out.push(SEQ); out.push(...partes(a)); });
  return out;
}
/* uma ou mais combinacoes, cada uma em teclinhas, separadas por "ou" ('* ou Ctrl + 2'); a
   combinacao vazia e a acao sem tecla */
function teclinhas(lista){ return teclinhasOu([lista]); }
function teclinhasOu(alts){
  const k = el('span', 'hat-k');
  if (!alts.some(l => l.length)) { k.append(el('span', 'sem', 'sem tecla')); return k; }
  alts.filter(l => l.length).forEach((lista, j) => {
    if (j) k.append(el('span', 'ou', 'ou'));
    lista.forEach((t, i) => {
      if (t === SEQ) { k.append(el('span', 'seq', ',')); return; }
      if (i && lista[i - 1] !== SEQ) k.append(el('span', 'mais', '+'));
      k.append(el('kbd', null, t));
    });
  });
  return k;
}
const sem = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/* Um gesto FIXO de um estado da vista que usa esta tecla (o 2 e o Backspace da trilha, o L do
   arrasto): o canvas o trata antes do mapa, entao a acao gravada nela nao dispara ali. Gravar
   vale (fora daquele estado ela funciona), mas a caixa avisa. */
function fixoNoEstado(v, tecla){
  return v.GESTOS.find(g => g.quando && !g.acoes && g.teclas.join('+') === tecla) || null;
}
/* "Altium: Place » Track · P,T" -- a dica da linha, quando a página carregou o hub-altiumdna.js;
   sem ele, o plid cru (ainda serve para procurar) */
function noAltium(v, id){
  const plid = v.altiumDe(id);
  if (!plid) return '';
  const D = typeof HubAltiumDNA !== 'undefined' ? HubAltiumDNA : null;
  if (!D) return 'Altium: ' + plid;
  try {
    const cam = D.caminho(v.nome, plid), ac = D.acelerador(v.nome, plid), tk = D.teclas(v.nome, plid);
    return 'Altium: ' + (cam.length ? cam.join(' » ') : plid) + [ac].concat(tk).filter(Boolean).map(x => ' · ' + x).join('');
  } catch (e) { return 'Altium: ' + plid; }
}

/* Desenha o editor dentro de `box`. `o.toast(texto, tipo)` e quem avisa: o hub passa o dele. */
function pane(box, o){
  const avisa = (o && o.toast) || function(){};
  estilo();
  const salvos = {};
  for (const v of VISTAS) salvos[v.nome] = v.carrega();
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
  info.append(conta);
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

  /* Outra janela do hub (Nova janela) gravou atalhos: este painel relê a chave que mudou, senao
     a proxima gravacao daqui sobrescreveria a chave inteira com o estado velho. A escuta sai com
     o modal. */
  const deFora = e => {
    if (!box.isConnected){ window.removeEventListener('storage', deFora); return; }
    let mudou = false;
    for (const v of VISTAS) if (e.key === v.CHAVE || e.key === null){ salvos[v.nome] = v.carrega(); mudou = true; }
    if (mudou && !editando) desenha();
  };
  window.addEventListener('storage', deFora);

  /* As linhas de uma vista: as teclas dela (com o que o usuario gravou) e os gestos. `alts` e a
     lista de combinacoes da coluna Atalho; so a linha de gesto com `acoes` tem mais de uma. */
  function linhas(v){
    const m = v.mapaAtalhos(salvos[v.nome]);
    const out = v.ATALHOS_PADRAO.map(a => {
      const t = m.porAcao[a.id];
      return { vista:v, chave:v.nome + ':' + a.id, id:a.id, rotulo:a.rotulo, tecla:t, alts:[partesSeq(t)],
               padrao:a.tecla, usuario:t !== a.tecla, fixo:false, quando:v.QUANDO, altium:noAltium(v, a.id) };
    });
    for (const g of v.GESTOS){
      const alts = g.acoes ? g.acoes.map(id => partesSeq(m.porAcao[id])).filter(p => p.length) : [g.teclas];
      out.push({ vista:v, rotulo:g.rotulo, alts, fixo:true, quando:g.quando || v.QUANDO, estado:Boolean(g.quando) });
    }
    return out;
  }
  function passa(l){
    if (!filtro) return true;
    /* gravando teclas: a linha que dispara com aquela combinacao, gesto fixo inclusive (o 2 da
       trilha aparece junto de quem mais usa o 2) */
    if (gravando) return l.fixo ? l.alts.some(a => a.join('+') === filtro)
      : (l.tecla === filtro || acordes(l.tecla)[0] === filtro);   /* e a sequencia que ela abre (P -> P,T) */
    const q = sem(filtro);
    const origem = l.fixo ? 'fixo' : (l.usuario ? 'usuario' : 'padrao');
    const campos = [l.rotulo, l.quando, l.vista.QUANDO, origem];
    for (const a of l.alts) campos.push(a.join('+'), a.join(' '));
    if (!l.fixo) campos.push(l.tecla || 'sem tecla', l.altium || '');
    return campos.some(x => sem(x).includes(q));
  }

  function linhaEl(l){
    const r = el('div', 'hat-l' + (l.fixo ? ' fixo' : ''));
    r.setAttribute('role', 'row');
    const ed = el('span');
    if (!l.fixo){
      r.tabIndex = 0;
      r.dataset.id = l.chave;
      const b = el('button', 'hat-ed');
      b.type = 'button'; b.tabIndex = -1;
      b.title = 'Trocar a tecla (duplo clique na linha também)';
      b.append(icone('lapis'));
      b.onclick = e => { e.stopPropagation(); edita(l); };
      ed.append(b);
    }
    const cmd = el('span', 'cmd', l.rotulo); cmd.title = l.rotulo + (l.altium ? ' — ' + l.altium : '');
    const org = el('span', 'org' + (l.usuario ? ' usr' : ''), l.fixo ? 'Fixo' : (l.usuario ? 'Usuário' : 'Padrão'));
    if (l.usuario){
      const rs = el('button', 'hat-rs');
      rs.type = 'button'; rs.tabIndex = -1;
      rs.title = 'Voltar ao padrão (' + (l.padrao || 'sem tecla') + ')';
      rs.append(icone('volta'));
      rs.onclick = e => { e.stopPropagation(); volta(l); };
      org.append(rs);
    }
    /* o estado (trilha na mao, arrastando) mora numa vista so; a dica diz qual */
    const qdo = el('span', 'qdo', l.quando);
    qdo.title = l.estado ? l.vista.QUANDO + ' · ' + l.quando : l.quando;
    r.append(ed, cmd, teclinhasOu(l.alts), qdo, org);
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
    return r;
  }

  function desenha(foco){
    tab.textContent = '';
    const cab = el('div', 'hat-cab');
    cab.setAttribute('role', 'row');
    cab.append(el('span'), el('span', null, 'Comando'), el('span', null, 'Atalho'),
               el('span', null, 'Quando'), el('span', null, 'Origem'));
    tab.append(cab);
    medeTopo();
    let nTodas = 0, nVis = 0, nUsr = 0;
    for (const v of VISTAS){
      const todas = linhas(v), vis = todas.filter(passa);
      const usr = todas.filter(l => l.usuario).length;
      nTodas += todas.length; nVis += vis.length; nUsr += usr;
      if (!vis.length) continue;                 /* a busca esconde a vista inteira */
      const grupo = el('div', 'hat-grupo');
      grupo.setAttribute('role', 'rowgroup');
      const g = el('div', 'hat-g');
      g.setAttribute('role', 'row');
      const cont = el('span', 'cont', (vis.length === todas.length ? todas.length + ' atalhos' : vis.length + ' de ' + todas.length)
        + (usr ? ' · ' + usr + ' trocado' + (usr > 1 ? 's' : '') : ''));
      const rs = el('button', 'btn btn-ghost btn-sm', 'Padrão NexoEletric');
      rs.type = 'button';
      rs.title = 'as teclas de antes do NexoEletric na ' + v.QUANDO + ' (W trilha, T texto…; a outra vista não muda)';
      /* com lixo na chave (acao que nao existe, tecla recusada) o botao continua servindo para limpar */
      rs.disabled = v.qualPredefinicao(salvos[v.nome]) === 'casa' && !Object.keys(salvos[v.nome]).length;
      rs.onclick = () => {
        salvos[v.nome] = {}; v.grava({}); desenha();
        avisa('atalhos da ' + v.QUANDO + ': padrão NexoEletric', 'ok');
      };
      g.append(el('span', 'nome', v.QUANDO), cont);
      /* a predefinicao "Padrao Altium" (2026-10-13): troca as teclas da vista pelas do Altium 21
         de fabrica (P,T, T,D...). Acrescimo: a tabela da casa continua sendo o padrao, e o
         "Restaurar o padrao" ao lado volta para ela. */
      if (v.PADRAO_ALTIUM){
        const pa = el('button', 'btn btn-ghost btn-sm', 'Padrão Altium');
        pa.type = 'button';
        pa.title = 'troca as teclas da ' + v.QUANDO + ' pelas do Altium Designer 21 (P,T trilha, T,D DRC…); '
          + '“Padrão NexoEletric” volta para as da casa';
        pa.disabled = v.qualPredefinicao(salvos[v.nome]) === 'altium';
        pa.onclick = () => {
          const p = v.predefinicao('altium');
          salvos[v.nome] = p; v.grava(p); desenha();
          avisa('atalhos da ' + v.QUANDO + ': padrão Altium', 'ok');
        };
        g.append(pa);
      }
      g.append(rs);
      grupo.append(g);
      for (const l of vis) grupo.append(linhaEl(l));
      tab.append(grupo);
    }
    if (!nVis) tab.append(el('div', 'hat-vazio', gravando
      ? 'Nenhum comando usa “' + filtro + '”.'
      : 'Nenhum atalho com “' + filtro + '”.'));
    conta.textContent = (nVis === nTodas ? nTodas + ' atalhos nas duas vistas' : nVis + ' de ' + nTodas)
      + (nUsr ? ' · ' + nUsr + ' trocado' + (nUsr > 1 ? 's' : '') + ' por você' : '');
    if (!foco) return false;
    const r = tab.querySelector('.hat-l[data-id="' + foco + '"]');
    if (r) r.focus();
    return Boolean(r);
  }
  /* devolve o foco para a linha editada; se o filtro a escondeu, para a busca -- foco perdido no
     BODY faria o proximo Esc fechar o modal inteiro em vez de desistir da busca */
  function volta_foco(chave){ if (!desenha(chave)) busca.focus(); }

  function volta(l){
    const v = l.vista;
    const r = v.defineAtalho(salvos[v.nome], l.id, l.padrao);
    if (!r.ok){ avisa('Não voltou ao padrão: ' + r.erro + '. Troque aquela primeiro.', 'warn'); return; }
    salvos[v.nome] = r.salvos; v.grava(r.salvos); volta_foco(l.chave);
    avisa(l.rotulo + ' → ' + (l.padrao || 'sem tecla') + ' (padrão, ' + v.QUANDO + ')', 'ok');
  }

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
    const v = l.vista;
    let pendente = '', seguinte = false;
    const fundo = el('div', 'hat-caixa-fundo');
    const cx = el('div', 'hat-caixa');
    cx.setAttribute('role', 'dialog');
    cx.setAttribute('aria-label', 'Trocar a tecla de ' + l.rotulo + ' (' + v.QUANDO + ')');
    const tit = el('div', 'tit', 'Pressione a combinação desejada e depois Enter');
    const cmd = el('div', 'cmd', l.rotulo + ' · ' + v.QUANDO + ' · agora ' + (l.tecla || 'sem tecla')
      + (l.usuario ? ' (padrão ' + (l.padrao || 'sem tecla') + ')' : ''));
    const visor = el('div', 'tecla');
    const msg = el('div', 'msg', 'Esc desiste');
    cx.append(tit, cmd, visor, msg);
    fundo.append(cx);
    document.body.append(fundo);
    const pinta = () => {
      visor.textContent = '';
      if (!pendente){ visor.append(el('span', 'vaz', 'aguardando…')); return; }
      visor.append(teclinhas(partesSeq(pendente)));
      if (seguinte){ msg.className = 'msg'; msg.textContent = 'agora a tecla seguinte da sequência'; return; }
      if (pendente === l.tecla){ msg.className = 'msg ok'; msg.textContent = 'já é esta'; return; }
      const r = v.defineAtalho(salvos[v.nome], l.id, pendente);
      if (!r.ok){ msg.className = 'msg err'; msg.textContent = r.erro; return; }
      const f = fixoNoEstado(v, pendente);
      msg.className = 'msg ' + (f ? 'aviso' : 'ok');
      msg.textContent = (f ? '“' + pendente + '” continua fixo quando ' + f.quando + ': '
        + f.rotulo.toLowerCase() + '. ' : '') + 'Enter grava · vírgula emenda uma sequência (P, T) · Esc desiste';
    };
    const fecha = () => {
      window.removeEventListener('keydown', tecla, true);
      fundo.remove();
      editando = null;
      volta_foco(l.chave);
    };
    const tecla = ev => {
      /* o modal fechou com a caixa aberta: larga a escuta sem engolir a tecla de ninguem */
      if (!box.isConnected){ window.removeEventListener('keydown', tecla, true); fundo.remove(); editando = null; return; }
      ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
      const sozinha = !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey;
      if (ev.key === 'Escape'){ fecha(); return; }     /* com modificador tambem: Esc nao e tecla gravavel */
      if (ev.key === 'Enter' && sozinha){
        if (!pendente || pendente === l.tecla){ fecha(); return; }
        const r = v.defineAtalho(salvos[v.nome], l.id, pendente);
        if (!r.ok){ msg.className = 'msg err'; msg.textContent = r.erro; return; }
        salvos[v.nome] = r.salvos; v.grava(r.salvos);
        fecha();
        avisa(l.rotulo + ' → ' + pendente + ' (' + v.QUANDO + ')', 'ok');
        return;
      }
      const t = normalizaTecla(ev);
      if (!t) return;                       /* so o modificador: continua esperando */
      /* A SEQUENCIA (P,T do Altium): a virgula depois de uma tecla emenda a proxima, e a caixa
         escreve como o Altium escreve. Sem a virgula tudo fica como era: a tecla nova troca a
         anterior. A virgula como primeira tecla continua sendo a tecla virgula. */
      if (t === ',' && pendente && !seguinte && acordes(pendente).length < MAX_ACORDES){ seguinte = true; pinta(); return; }
      pendente = seguinte ? pendente + ',' + t : t;
      seguinte = false;
      pinta();
    };
    fundo.addEventListener('mousedown', e => { if (e.target === fundo) fecha(); });
    editando = l.chave;
    pinta();
    window.addEventListener('keydown', tecla, true);
  }

  desenha();
}

/* O Esquema continua sendo o HubAtalhos de antes (o schframe e o hub dependem desses nomes); as
   duas vistas, com a mesma forma, em .sch e .pcb. */
return { CHAVE:sch.CHAVE, ATALHOS_PADRAO:sch.ATALHOS_PADRAO, TECLAS_PROIBIDAS, GESTOS:sch.GESTOS,
         normalizaTecla, mapaAtalhos:sch.mapaAtalhos, defineAtalho:sch.defineAtalho,
         carrega:sch.carrega, grava:sch.grava, pane, sch, pcb,
         /* 2026-10-13: as sequencias (P,T) e a predefinicao Padrao Altium */
         leitor, acordes, colide, ehSequencia, semShiftAntigo, MAX_ACORDES };
});
