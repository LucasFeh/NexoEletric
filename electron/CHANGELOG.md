# Changelog — NexoEletric desktop

Versões do app desktop (tags `vX.Y.Z` deste repositório). Cada versão carrega o hub do
commit em que foi gerada; o commit aparece em **Ajuda › Sobre o NexoEletric**. Até a 1.8.1 o
app se chamava EletricHUB.

## 1.92.2 — 2026-11-10

**O botão das Artes vai para o canto de cima à direita da vista PCB; a PCB avisa quando o código da placa não está na
serigrafia; e o envio ao Odoo fica impedido sem a PCB declarada.**
Pedidos do dono: "o ícone de 'Artes' pode tirar da barra e colocar no canto superior direito, do lado do menu de
propriedades" e "quero que tenha um alerta, dizendo que o código não foi colocado na PCB, todas as PCBs precisam ter
código, e se um esquema não tiver com PCB declarada, é pra impedir o envio pro Odoo".
- **Botão Artes no canto de cima à direita**, colado no painel de Propriedades, na altura do título dele: o mesmo ícone (o
  QR), a dica "Artes", a mesma lista (que abre logo embaixo, nesse canto) e o Studio; aceso enquanto a lista está aberta.
  Saiu da barra de ferramentas. Não aparece na vista embutida (lean) nem com o visualizador de Gerber aberto.
- **Alerta "código da placa na serigrafia"** (`HubPcbArtes.codigoNaPlaca`): no pé da vista PCB, no meio, fica um aviso
  enquanto a placa não tiver o código de agora na serigrafia. Conta como presente a arte com o campo `=CodigoDaPlaca` (a
  "Código da placa + revisão", qualquer arte com o campo, a logo da 1.77) ou um texto de serigrafia (Top/Bottom Overlay, à
  vista; designator não conta) com o código inteiro escrito (sem caixa; "PMD - DI261946" vale; pedaço de outro código
  não: "PDMB-DI231765_P2" não contém "DMB-DI231765"). Três avisos:
  - **falta** — "O código da placa (PMD-DI261946) não está na serigrafia — toda PCB precisa ter o código";
  - **desatualizado** — há um código de placa escrito à mão que é outro (o "PDMB-DI231765_P2" da DMB): diz qual e qual é o
    de agora, e pede a arte automática no lugar do texto antigo;
  - **projeto não definido** — sem o código da placa (a regra do "PROJETO NÃO DEFINIDO"): manda definir o projeto.
  O botão **Colocar código** pega a arte "Código da placa + revisão" na mão (clique na placa para largar). Com a
  variante ativa vale o código da placa (a PCB é a mesma). O alerta some sozinho quando a placa passa a ter o código.
- **No Gerber, no Enviar pra JLC e no PDF**: o mesmo aviso (nos avisos do Gerber, na pergunta da JLC e numa notificação ao
  abrir o PDF). É **aviso, não bloqueio**: a placa de teste, o painel e a placa sem serigrafia continuam saindo — se o
  dono quiser travar, é uma linha.
- **MCP**: o `pcb_artes` com o projeto diz `codigo_na_placa` (ok | falta | desatualizado | nao-definido, com o código e o
  que achou); o `pcb_arte_colocar` com `codigo-revisao` resolve.
- **Envio ao Odoo só com a PCB declarada** (`odoolista.motivo_sem_pcb`): sem o código da placa do Definir projeto no
  cabeçalho do esquema (vazio, "*" ou "PROJETO NÃO DEFINIDO" — o palpite pelo nome da pasta não vale, porque é o código
  que o Odoo recebe para a placa montada e a virgem), ou sem documento de PCB no projeto (sem board.js: "o projeto não tem
  PCB"), o envio é **impedido**:
  - na vista Esquema o **Enviar lista** fica desligado e o porquê aparece embaixo dos botões, em vermelho, apontando o
    Definir projeto; ele volta sozinho quando o Definir projeto grava (a página pergunta ao servidor ao abrir, ao voltar
    o foco e a cada 10 s);
  - no servidor (`/api/lista/ensaio` e `/api/lista/envio`, também pelo que o Rust repassa e por qualquer cliente) a
    recusa é 409 com `semPcb`, antes de falar com o Odoo; a `/previa` monta a lista e devolve `bloqueio`, e a tela do
    envio mostra "Envio bloqueado: …" sem conferir; `GET /api/lista/bloqueio?projeto=` responde à tela. O MCP não tem
    ferramenta de envio ao Odoo; quem chamar a rota leva a mesma recusa.
  - A falta do código na serigrafia **não** bloqueia o envio (é só o alerta acima).
- Testes: `tests/test-pcbartes.js` (o código na serigrafia: falta, arte com o campo, a logo da 1.77, escrito com espaço,
  embaixo, desatualizado e qual, pedaço de outro código, cobre/escondido/designator não contam, não definido, a arte
  virada), `tests/test-mcp-artes.js` (`codigo_na_placa` falta → ok), `tests/test_odoo_sem_pcb.py` (novo: sem código, código
  vazio, "*", "PROJETO NÃO DEFINIDO" e sem board.js recusam ensaio e envio com 409 e nada chega ao Odoo falso; a prévia
  diz o porquê; com a PCB declarada segue), `tests/test_lista_extras.py` (a bancada agora declara a PCB), os smokes
  `tests/smoke-artes.js` (o botão no canto colado nas Propriedades; o alerta "desatualizado" na DMB, o Colocar código, o
  alerta some com a arte) e `tests/smoke-odoo-bloqueio.js` (novo: na vista Esquema de verdade o Enviar lista desligado
  com o motivo, o servidor recusando direto, e o botão voltando depois do Definir projeto).

## 1.92.1 — 2026-11-10

**O corpo 3D da biblioteca volta a aparecer: o cache dos STEP da PcbLib se conserta sozinho (e saiu do %TEMP%), e o
corpo é achado pelo nome do footprint como o `pcblib.js` o escreve.**
Pedido do dono: "alguns footprint estão bugando, o 3D mesmo posicionado não aparece no footprint, como é o caso do
ESP32-WROOM-32D - pads 1-38 com expansao de mascara 0,05 mm (ponte de mascara 0,27 mm no passo 1,27)" — e "verifica se
não é caractere especial também".
- **A causa do ESP32 (FP-ESP32-WROOM-32D-MFG) não era o nome:** o STEP dele é o `Libs/3d/2475317612.step`, que o
  hubserver extrai da PcbLib da casa para um cache. O cache morava no `%TEMP%`, e a limpeza do Windows apagou 328 dos
  330 STEP da máquina do dono, deixando o `pcblib-3d.js` — que era a marca de "cache pronto". O modelo dava 404 para
  sempre e a vista 3D (editor de footprint e PCB) mostrava só os pads. Valia para todo footprint cujo corpo vem da
  PcbLib: 13 dos 26 footprints da biblioteca do hub com STEP (CAP 0805, CAP 1206, RES 1206, SOIC 24, SOT-223,
  ESP32PICOMINI02UN8R2...) e 414 dos 416 da PcbLib; os do `3d-hub` (STEP subido pelo editor), do NexoCAD e do
  `board3d.js` da placa não eram afetados, e o que já estava no cache do navegador continuava aparecendo — daí o
  "alguns".
- **Agora:** o cache mora em `%LOCALAPPDATA%\NexoEletric\pcblib3d` (fora do Temp); ao abrir, o hub confere se cada STEP
  que o `pcblib-3d.js` lista está lá e extrai de novo só o que falta; o STEP que sumir com o hub aberto é extraído no
  próprio pedido (~2 s); e o STEP que a PcbLib atual não tem (footprint do hub que copiou o corpo de outra PcbLib) é
  procurado nos caches das outras PcbLib antes do 404. A primeira vista 3D depois de atualizar refaz o cache (~10 s).
- **Caractere especial:** varridos os 619 footprints da PcbLib, os 78 da biblioteca do hub e os 368 modelos 3D. Vírgula,
  parênteses, barra, ponto e vírgula, aspas, acento/ç, °, µ, Ω, ±, &, #, %, + **não quebram** nada: o arquivo do
  modelo é sempre `3d/<checksum>.step` ou `3d-hub/<sha1>.step` (o nome do STEP só aparece na tela), o upload manda o
  nome por `encodeURIComponent` e o NexoCAD por `encodeURIComponent` do id; os 10 STEP com nome especial e os 7 do
  `3d-hub` convertem em malha. O que **quebrava** era o nome do footprint diferente nos dois arquivos: o `pcblib.js` lê
  o nome em cp1252 e troca o antigo pelo padronizado do `Libs/rename-map.js`, e o `pcblib-3d.js` saía com o nome cru.
  124 footprints com corpo na PcbLib nunca achavam o corpo — 123 renomeados (`BARRA 7 VIAS FEMEA` → `CONE BARRA 7 VIAS
  FEMEA`, `CAP EL 2mm L10 D6` → `CAP EL 2MM L10 D6`...) e o `TO–220AB`, cujo travessão (byte 0x96 do Windows) virava
  um caractere de controle. O `pcblib-3d.js` agora sai com o nome do `pcblib.js` (e o cru como apelido): de 351 para
  475 dos 619 footprints com corpo achado (os outros 144 não têm corpo na PcbLib).
- **Nome com caractere invisível:** a vista 3D acha o footprint também quando o nome difere só por espaço duro (NBSP),
  zero-width, BOM, espaço no fim ou repetido, ou acento decomposto (NFD); maiúscula e pontuação continuam valendo. Na
  biblioteca de hoje nenhum nome depende disso.
- Nenhum dado real precisou de reparo: o `pcblib-hub.js` e a PcbLib estão íntegros (todo corpo aponta para um modelo do
  índice). O cache velho em `%TEMP%\eletrichub-pcblib3d` fica sem uso.
- Testes: `tests/test_lib3d_servidor.py` (cache apagado com o hub aberto e ao abrir, outra PcbLib, rename-map, cp1252,
  nomes com vírgula/parênteses/longo do ESP32) e `tests/test-pcb3d-nomes.js` (o corpo e a URL do STEP pelo nome com cada
  caractere especial; NBSP/zero-width/NFD).

## 1.92.0 — 2026-11-10

**A borda da placa com o mouse: Tab, Tab seleciona a borda inteira (e só ela), e as alças arrastam a borda, uma aresta
ou um vértice, com a medida ao vivo.**
Pedido do dono: "eu também queria que fosse possível expandir a seleção com tab 2x quando selecionar a borda da PCB, mas
só a borda pra movimentar, também queria que fosse possível arrastar, aumentar e diminuir a borda da PCB só com interface
de click".
- **Tab na borda (como no Altium):** clicou numa reta ou arco da borda da placa (o `board.outline`, a Board Shape do
  Altium), **Tab** seleciona os segmentos ligados a ele (a cadeia) e **Tab de novo** a borda **inteira** — só a borda:
  nenhum componente, trilha ou serigrafia entra. A barra de status diz "borda da placa — N segmentos (inteira)" (ou "N de
  M"); o rodapé mostra a largura × altura; Esc limpa. A ficha da borda inteira mostra Width/Height e como editar (o
  retângulo continua com a ficha de Largura/Altura/Origem da 1.70.0).
- **Alças da borda selecionada:** a **bolinha** de cada vértice move o vértice; o **quadrado no meio de cada reta** move a
  aresta pela normal — aumenta ou diminui a placa daquele lado —, com as pontas deslizando pelas retas vizinhas (o canto
  em esquadro continua em esquadro e o chanfro de 45° continua de 45°, como os da DMB); a **cruz no meio** move a borda
  toda. Arrastar a própria reta da borda também move a aresta (ou a borda toda, quando ela inteira está selecionada). As
  **setas** andam a borda inteira um passo da grade (Shift: 10 passos). A grade da vista vale (Ctrl solta), e a medida
  **largura × altura aparece ao vivo** ao lado do cursor e no rodapé; borda que se cruzaria fica vermelha e não grava.
  Arco da borda (a orelha da DMB embaixo à direita) acompanha os vértices ligados nele.
- **Um gesto = um passo do Ctrl+Z:** cada arrasto grava um `outline_set` (o mesmo da ferramenta Contorno e da ficha,
  trocando o anterior), então o desfazer volta tudo de uma vez. O Gerber (Profile), o DRC, o 3D, o PDF e o Enviar pra JLC
  leem a borda nova da placa efetiva (conferido: o Profile do Gerber vai até a borda arrastada).
- **Permissões:** visualizador e quem não é da equipe do projeto não editam a borda (o aviso diz por quê); com a variante
  de projeto ativa a PCB é a da padrão e não se edita (regra da 1.88.0).
- As contas ficam em `hub-pcbborda.js` (cadeia, caixa, mover aresta/vértice/borda, normal, cruzamento), puras e testadas.
- Testes novos: `tests/test-pcbborda.js` (retângulo: a aresta cresce e diminui em esquadro, sentido horário e anti-horário,
  a borda anda, vértice; a DMB: a cadeia é a borda inteira, a aresta da esquerda +5 mm deixa a placa 5 mm mais larga com os
  chanfros no mesmo ângulo, fechada e sem cruzar, e o Profile do Gerber acompanha) e o smoke `tests/smoke-borda.js` (a
  vista de verdade numa cópia da DMB: clique na reta, Tab = cadeia só de borda, Tab Tab = os 13 segmentos e a contagem na
  barra; a cruz move a borda 5 mm e o Ctrl+Z volta num passo; o quadrado da aresta da direita arrastado 6 mm com a medida ao
  vivo, um outline_set, mesma altura, fechada, Gerber acompanha, Ctrl+Z volta; a seta sobe a borda).

## 1.91.0 — 2026-11-10

**Artes de overlay na PCB: a logo DiEletrons com o QR do site e o código da placa + revisão viram artes padrão que se
puxam para a placa, e o Studio de artes (ferramenta da vista PCB) cria e edita artes novas.**
Pedido do dono: "nas PCBs a gente sempre coloca o código da placa com revisão, e sempre a logo com o QR CODE pro site da
dieletrons, eu queria que isso virasse uma logo overlay padrão, onde a gente só puxa e já vem com o código da placa + a
revisão automática, e a logo fica lá adicionada por padrão, mas pode adicionar novas, criar, é um studio pra criação desse
tipo de arte" — e "é como se fosse uma ferramenta mesmo, na área de PCB".
- **Botão "Artes" na barra da vista PCB** (ao lado de Imagem → serigrafia): abre a lista das artes da biblioteca, cada
  uma com a miniatura desenhada pela mesma geometria do Gerber (os campos já com o código e a revisão do projeto aberto).
  **Arrastar** a arte para a placa a larga onde soltou; **clicar** pega a arte na mão (Espaço gira, L troca a face, clique
  larga, Esc desiste). A arte entra como **um objeto só** (um `comp_add` com o desenho na própria linha, ref ARTE1,
  ARTE2…): move, gira, troca de face (Bottom = Bottom Overlay espelhada, lida por baixo) e tem **escala** no painel.
  Selecionada, a ficha "Arte de overlay" mostra X | Y, Rotação | Face, Escala, onde sai no Gerber, os avisos da JLC e os
  botões **Editar no Studio…** e **Atualizar da biblioteca** (a placa guarda a foto da arte: mudar a arte na biblioteca não
  mexe em placa nenhuma sozinho; o botão marca ● quando a biblioteca tem versão mais nova). Nada entra sozinho em placa
  nova nem em projeto existente: só puxando.
- **As duas artes padrão da casa:**
  - **Logo DiEletrons + QR** — o desenho medido na DMB - DI231765_P2 (a placa do print do dono): a logo era um bitmap do
    Altium (1.392 traços de 0,0508 mm na Top Overlay, 24,0 × 8,1 mm, com "dieletrons.com" embaixo do traço) e virou 28
    regiões de serigrafia com os miolos vazados; o QR era feito de 196 fills e **decodifica para `www.dieletrons.com`**
    (nível L, versão 2, invertido: a serigrafia é a parte clara, com 2 módulos de borda, 10 mm de lado). Aqui o QR é
    **gerado de verdade** a partir desse texto (`hub-qr.js`, ISO 18004, modo byte), com a mesma medida; os módulos viram
    regiões retangulares de serigrafia. 34,9 × 10,1 mm no total, como a da placa.
  - **Código da placa + revisão** — `=CodigoDaPlaca` e `=Revisao` (1,524 mm, traço 0,254, o bloco que a casa digitava à
    mão): o código da placa do Definir projeto (ex.: PMD-DI261946) e a revisão do projeto, a mesma do quadro da folha
    (REV. C). **Mudam sozinhos** quando o código ou a revisão mudam (a aprovação nova troca a revisão sem mexer na PCB).
    Sem placa definida: **PROJETO NÃO DEFINIDO** (a regra do quadro da 1.86.0/1.90.1). Com a variante de projeto ativa a
    PCB é a mesma da padrão (e não se edita, regra da 1.88.0): o código continua o **da placa**, não o da variante.
- **Studio de artes** (botão "Studio…" da lista, ou Editar no Studio… da arte selecionada): a biblioteca à esquerda (Nova,
  Duplicar, Apagar, Restaurar), a arte no meio (arrastar move o elemento com passo de 0,05 mm — Shift livre —, roda dá zoom,
  arrastar no vazio anda, Delete apaga, setas empurram 0,1 mm / Shift 1 mm, F enquadra, Ctrl+S salva) e à direita
  Adicionar / Elementos / Propriedades:
  - **Texto** com os campos automáticos em botões: =CodigoDaPlaca, =Revisao, =NomeDaPlaca, =CodigoDoEquipamento,
    =NomeDoEquipamento, =Cliente, =Data (hoje), =Data_desenho, =Projeto — em qualquer lugar do texto ("REV. =Revisao");
  - **Linha, Retângulo e Círculo** (contorno com traço, ou cheio);
  - **QR code** de uma URL/texto: nível de correção L/M/Q/H, lado em mm, borda em módulos, invertido (placa escura);
    mostra a versão e o tamanho do módulo, e avisa módulo abaixo de 0,3 mm;
  - **Imagem…**: PNG, JPG, SVG, BMP… ou texto em qualquer fonte do Windows convertido em regiões de serigrafia com limiar,
    inverter e simplificação — o diálogo da ferramenta Imagem ou texto → serigrafia (1.60.0), agora também dentro do Studio;
  - embaixo, os **avisos do mínimo da serigrafia da JLC** (traço ≥ 0,15 mm, texto ≥ 0,8 mm de altura, região mais fina que
    0,15 mm) e o tamanho da arte; **Salvar** grava na biblioteca da rede; **Colocar na placa** pega a arte como está.
- **A biblioteca mora no NexoBD**: `Libs/pcb-artes.json`, que viaja com o resto da Libs/ pelo item "Biblioteca do
  NexoEletric" — todo NexoEletric ligado ao mesmo NexoBD vê as mesmas artes. As duas da casa vêm no programa (o arquivo só
  as guarda se o administrador as mudar); o arquivo nasce na primeira gravação feita pelo programa. Rotas novas
  (`tools/rotas/pcb_artes.py`): `GET /api/pcb-artes`, `POST /api/pcb-artes/salvar {arte, base}` (a versão sobe; quem
  editou a versão velha leva 409 com quem gravou antes), `/apagar {id}` e `/restaurar {id}`.
- **Permissões:** visualizador não grava (403 `sem_permissao`, como as outras edições) e não põe arte na placa; quem não é
  da equipe do projeto também não põe; com a variante ativa a lista avisa e não deixa. **Apagar** arte e **mudar ou
  restaurar as artes da casa** são só do administrador do Nexo Hub (como as exclusões da biblioteca da 1.89.0): para os
  outros o Salvar de uma arte padrão fica desligado com o motivo ("use Duplicar para fazer a sua").
- **Fabricação:** a arte é serigrafia comum na placa efetiva: sai no **Gerber** na legenda certa (GTO na Top Overlay, GBO
  espelhada na Bottom Overlay), no **PDF da PCB**, no laser e no **Enviar pra JLC** (que manda o mesmo Gerber da tela).
  Testado: o QR lido de volta do Gerber gerado (GTO e GBO virada) decodifica `www.dieletrons.com` no zxing. Campo sem
  valor (ex.: projeto sem revisão) sai cru e o Gerber avisa, como as strings especiais do Altium.
- **Arte não é peça:** fica fora da lista do BOM, do ECO (o Update PCB não propõe tirá-la), da folga entre componentes do
  DRC e dos corpos/designators do PDF de montagem. A logo DiEletrons do Definir projeto (1.77.0) passa a contar como arte
  também.
- **MCP:** `pcb_artes` (lista as artes, com tamanho, campos e avisos; com o projeto, as que estão na placa e os textos já
  resolvidos) e `pcb_arte_colocar` (simula por padrão; `gravar:true` grava; x, y, rot, layer, escala). `pcb_mover` move,
  gira e vira a arte; o `pcb_consultar` de componentes marca `arte`.
- Testes novos: `tests/test-pcbartes.js` (QR: versão, localizadores e a tinta do invertido; os campos e o PROJETO NÃO
  DEFINIDO; as artes da casa no mínimo da JLC; a arte na placa como um objeto, na Top Overlay, virada para a Bottom
  Overlay espelhada, escala, giro; o Gerber GTO/GBO com a arte; ECO e BOM sem a arte), `tests/test_pcbartes_qr.py` (o QR
  decodificado do Gerber gerado, nas duas faces, e um QR do Studio), `tests/test_pcb_artes.py` (a biblioteca: primeira
  gravação, versão, conflito 409, visualizador, arte da casa e apagar só o admin), `tests/test-mcp-artes.js` e o smoke
  `tests/smoke-artes.js` (a vista PCB de verdade num Chrome headless: a lista, pegar e largar, arrastar e soltar, a ficha,
  o Studio criando e salvando, numa cópia da placa).

## 1.90.1 — 2026-11-10

**A ficha do componente no Esquema na ordem que o dono pediu, e sem o "Ver em 3D".**
Pedido do dono: "a coordenada X e Y fica na primeira linha, rotação e espelhar na segunda, designator fica na terceira
linha no canto esquerdo e do outro lado fica a parte na mesma linha, mas bem afastado; pinos pode ficar na quarta linha,
e o botão 'Ver 3D' pode sair, deixa só trocar, editar e depois trocar componente e parâmetro igual tá".
- Esquema › Propriedades do componente: **X | Y**; **Rotação | Espelhar**; **Designator** (com o olho) na esquerda e
  **Parte** na direita, afastados; **Pinos** (o olho e a contagem); Footprint com **Trocar… | Editar…**; e
  **Parâmetros** (com o ponto de aviso) | **Trocar componente…**, como na 1.90.0.
- O "Ver em 3D" saiu do painel. O 3D do footprint continua no editor que o Editar… abre (botão 3D da barra dele,
  tecla 3).
- PCB › Propriedades do componente na mesma ordem: X | Y; Rotation | Layer (a face é o "espelhar" da placa);
  Designator; Comment; Show Designator/Comment; e os botões. O View 3D saiu do painel; a vista 3D da placa continua
  no botão direito (Ver em 3D) e na tecla 3.
- **Definir projeto em vermelho** enquanto o projeto não está definido (pedido do dono: "no botão de 'definir projeto'
  se não tiver projeto definido ele fica em vermelho"). A regra é a mesma que põe "PROJETO NÃO DEFINIDO" no quadro da
  folha (`HubSchTemplate.camposNaoDefinidos`): fica vermelho se faltar o código da placa OU o do equipamento, e a dica
  diz qual falta. O vermelho é o de alerta do tema (o do "Sem aprovação"), sem piscar. Volta ao normal na hora em
  que o Definir projeto grava, e se repinta a cada mudança da folha (desfazer, recarga, aprovação).
- **Os dois códigos do carimbo alinhados** (pedido do dono: "deixa os dois códigos alinhados"). No A4_DiEletrons o
  código do equipamento era a 2ª linha de uma célula de duas (a 1ª, o NomeDoEquipamento, saiu do quadro na 1.88.0) e
  ficava mais baixo que o da placa. Com o nome vazio, ele passa à mesma linha de base, fonte e tamanho do código da
  placa, cada um centrado na sua célula. É regra do desenho (`hub-schtemplate.js` » `alinhaCodigos`), não do dado: o
  template da casa no NexoBD não muda, e toda folha e todo projeto pegam sozinhos, na tela, nas miniaturas e no PDF do
  esquema. O editor de template mostra as posições como estão gravadas.

## 1.90.0 — 2026-11-10

**A ficha do componente fica só com o que se edita, em grade; o resto vai para o botão "Parâmetros". O "Não montar"
vai para o botão direito. E o acervo deixa de dizer "Biblioteca do Altium" para peça vinculada ao almoxarifado.**
Pedidos do dono: "no menu de componente quero resumir muito a quantidade de informações, só vai aparecer no menu o que é
editável […] quero que fique em botão 'parametros' que abre um modal com todos os parametros", "coloque o menu em grid
pra caber mais coisas, e o 'não montar' vira só opção quando clica com lado direito em cima do componente no esquema e
sai do menu", e o bug "mesmo o produto estando no acervo correto, aparece como 'biblioteca do altium'".
- **Esquema › Propriedades do componente**, em grade: X | Y | Rotação | Espelhar; Designator (com o olho) | Parte |
  Pinos (o olho dos nomes de pino na folha); Footprint (a linha toda) com Trocar… | Editar… | Ver em 3D; e
  **Parâmetros** | Trocar componente… (mais o Desfazer escolha, quando há). Saíram do painel as abas Geral/Pinos e
  tudo que é só leitura: Comment, Valor, Descrição, Acervo, Odoo, Origem, Desenho, origem/pads/modelo 3D do
  footprint, os parâmetros e a tabela de pinos. A posição do texto marcado (Voltar ao lugar de origem) continua.
- **Botão Parâmetros**: abre um modal só de leitura (para todos, inclusive o visualizador) com o componente
  (designator, parte, comment, valor, descrição, símbolo e como resolveu, acervo, desenho do símbolo quando é de outro
  acervo, Odoo com o link, não montar, suprimido na variante, folha), os **parâmetros que vão para o Odoo**
  (OdooId, MPN, Estoque, Local, Custo…), o footprint (origem, pads, modelo 3D, pinos sem pad) e os pinos com a net.
- **Os avisos não somem**: acervo da Biblioteca do Altium, sem ficha no Odoo, desenho ausente/emprestado, partes que
  não desenham, footprint fora da PcbLib e pinos sem pad viram um **ponto no botão Parâmetros** (vermelho quando é
  grave, âmbar quando é aviso), com a lista na dica do mouse e no topo do modal.
- **Não montar no botão direito** sobre o componente no Esquema: "✓ Não montar C3" (o ✓ quando todos os
  selecionados estão marcados; o clique desmarca — com a seleção misturada, marca todos). Vale para a seleção inteira.
  Visualizador e quem não é da equipe veem a opção desligada, com o motivo. Na variante ativa o botão direito continua
  sendo só o Suprimir / Montar dela (a caixa "Suprimido (variante)" também saiu do painel).
- **PCB › Propriedades do componente**, em grade: X | Y | Rotation; Layer | Designator; Comment; Show Designator |
  Show Comment; e Parâmetros | Rotate 90° | Flip | Zoom, Edit Footprint… | View 3D. Saíram Type, Footprint Name,
  Dimensions, 3D Body e a tabela de pads, que estão no modal Parâmetros junto com os parâmetros do componente no
  esquema (os que vão para o Odoo) e o vínculo com o almoxarifado. O ponto de aviso na PCB marca o que a placa sabe:
  componente que não está no esquema, sem footprint. O "Não montar" foi para o botão direito da PCB (com ✓, para a
  seleção inteira; desligado com o motivo sem permissão, sem schematic.js ou fora do esquema).
- **Bug do acervo**: o acervo saía só do nome do SÍMBOLO, que é o do desenho. Um componente vinculado ao almoxarifado
  (OdooId nos params, pelo "Trocar componente…") e ainda desenhado por um símbolo da SchLib do Altium (ex. o conector
  de 80 vias do CBM-DI251876, desenhado pelo CONE PADRAO) aparecia "▲ Biblioteca do Altium" em vermelho, "vincule ao
  almoxarifado", mesmo já vinculado e já casado por id na lista do Odoo. Agora vale a identidade da peça antes do nome:
  LocalId, depois OdooId, depois o nome (`acervoDoComp`, `tests/test-acervo-comp.js`). Medido nos 25 projetos com
  esquema da pasta de trabalho: 25 designadores passaram ao acervo certo (6 deles saíram do vermelho falso; os outros
  19 apareciam "—"). Sem OdooId nem valor do almoxarifado com o nome dele (ex. o C3 do DMB), o aviso continua — ali
  ele é verdadeiro.
- `HubDialog.ficha()` (hub-dialog.js): o modal largo e só de leitura das duas vistas.

## 1.89.4 — 2026-11-10

**O link da BOM é o da placa (com o nome atual dela) e cada variante tem o seu.**
Pedido do dono: "no BOM, o nome que vem no link ainda não tá pegando o nome atual da placa" e "precisa ser um link
diferente pra cada variante de projeto".
- Até aqui o link da BOM (aba BOM › Copiar link, o da bancada no NexoBD) era `/bom/<nome da pasta>` (ex.
  `http://192.168.15.83:47810/bom/dmb-di231765-p2`) e a página tinha o nome da pasta no título: a pasta não muda de nome
  quando o Definir projeto escolhe a placa (1.88.0). Agora o link sai do **código da placa** do cabeçalho do projeto
  (`CodigoDaPlaca`, lido na hora): `/bom/pmd-di261946`, e o título da página (e o da prévia na aba BOM) é
  **"<código> · <nome da placa>"** (`NomeDaPlaca`). Pelo código, e não pelo nome: é único no catálogo, curto para digitar
  no tablet e não muda quando o nome da placa é corrigido. Trocar a placa no Definir projeto troca o link e o título
  logo depois (na rodada seguinte do sincronismo com o NexoBD).
- **Um link por variante**, com a BOM dela (sem os suprimidos): `/bom/<código da placa>-<nome da variante>` (ex.
  `/bom/pmd-di261946-sem-display`: o código da PCB montada da variante, 1.89.0), título "<código> <NOME DA VARIANTE>".
  O rodapé da aba BOM mostra o link da variante ativa e, embaixo, os das outras (clique copia). Variante apagada: a BOM
  dela sai do NexoBD.
- **Os links já distribuídos continuam abrindo**: o da pasta (`dmb-di231765-p2`) e o de um código de placa anterior
  ficam como apelidos da BOM padrão (o mesmo item do NexoBD, com os vistos da bancada) e mostram o nome atual.
- Sem placa definida, o link continua o da pasta. Duas pastas com o mesmo código de placa: o link fica com a que já o
  tem, e a outra aparece nos erros do sincronismo.
- Não precisa atualizar o NexoBD nem o Nexo Hub: o NexoEletric publica as BOMs com as chaves novas no NexoBD que já
  está na rede (apelido = outra chave do mesmo item).

## 1.89.3 — 2026-11-10

**A padrão no dropdown da variante se chama pelo equipamento; o resumo da variante fica curto.**
- Em Configurações › Variante de projeto, a primeira opção do dropdown (e a caixa fechada) deixa de ser "Padrão (todos
  montados)" e passa a ser a **sigla do equipamento do projeto** (o `CodigoDoEquipamento` do Definir projeto até o
  "-DI…": `DMB-DI231765` → **DMB**), com o **código do equipamento** à direita, como as variantes (antes aparecia o
  código da placa). Sem código de equipamento, vale o nome do equipamento e o código da placa; sem nada, "Padrão".
- Com uma variante ativa, o resumo embaixo do dropdown fica só **"PCB montada: <código da placa> <NOME>"** e
  **"Sem PCB virgem · N suprimido(s)"**, sem explicação. Na tela do envio ao Odoo, com a variante, a linha vira
  "PCB montada: … · Sem PCB virgem · N suprimido(s)" (com os refs, se houver). Sem variante, nada mudou.

## 1.89.2 — 2026-11-10

**A barra da variante vira só uma etiqueta no topo.**
- Com uma variante de projeto ativa, o esquema e a PCB mostram no alto só **"VARIANTE <nome> · <código>"**, numa etiqueta
  laranja que corta com "…" quando o nome é comprido. O contador de suprimidos e o botão **Suprimir / Montar** saíram da
  barra (o contador está no título da etiqueta, ao passar o mouse, e em Configurações › Variante de projeto).
- Suprimir e montar continuam pelo **Shift+S** e pelo **botão direito** no componente (e pela caixa nas Propriedades da PCB).

## 1.89.1 — 2026-11-10

**A árvore de projetos mostra o código da PCB, não o nome.**
- Cada projeto com placa definida aparece pelo **código da placa** (ex.: `PMD-DI261946`) e o **nome da PCB** vai em cinza
  ao lado (`MICONTROLADORA DE DISPLAY`). Na 1.88.0 era o contrário. Sem placa definida, continua o nome da pasta com a
  marca "sem PCB". A busca continua achando pelo código, pelo nome e pela pasta; o título (passar o mouse) não mudou.

## 1.89.0 — 2026-11-09

**O Definir projeto fica só com Placas, ⚠ Código de placa errado e Equipamentos; cadastrar e editar o catálogo não dependem
mais da planilha estar fechada (fila no NexoBD, várias pessoas ao mesmo tempo); a variante de projeto vira um equipamento
escolhido num dropdown só, com nome, e vai ao Odoo como "<código da placa> <NOME DA VARIANTE>" sem a PCB virgem.**

- **Definir projeto só com três filtros** (pedido do dono: "sistemas, cabos, acessorios, softwares podem sair, deixa só
  placa, codigo de placa errado e equipamento no definir"): **Todos** (placas + equipamentos), **Placas**,
  **Equipamentos** e **⚠ Código de placa errado**. Sistemas, cabos, acessórios, software e nacionalização não aparecem na
  lista, nos filtros, no cadastro novo nem no "mudar categoria" do botão direito (que fica só Placa ↔ Equipamento). A
  planilha não é reescrita: esses itens continuam nela, e o código repetido continua recusado contra todos. O servidor
  (`/api/catalogo`) só manda placas e equipamentos; `/api/catalogo/registrar` só aceita PLACA ou EQUIPAMENTO e o
  `novoGrupo` do editar só placa ou equipamento (400 no resto).
- **Catálogo com a planilha aberta no Excel** (pedido do dono: "hoje não tá deixando editar se o excel tiver sendo usado,
  isso n pode acontecer, tem que ser assincrono, mais de uma pessoa pode editar ao mesmo tempo"). Até a 1.88.0 o cadastro e
  a edição gravavam direto no .xlsx: com o Excel aberto a tela dizia "não registrou: o catálogo está aberto em outro
  programa (Excel?): feche e tente de novo" (HTTP 503), e com o arquivo em uso exclusivo nem o Definir abria ("EBUSY:
  resource busy or locked"). Agora (`mcp/lib/catalogo-fila.js`):
  - **a fila mora no NexoBD**: um item oculto do NexoEletric (categoria interna `nexoeletric`, chave
    `nexoeletric-catalogo` = `fila-<sha1 do caminho da planilha>`, arquivo `fila.json`). Cadastrar e mudar
    código/nome/categoria entram nela e **respondem na hora**; cada mudança na fila é uma revisão com `base` (duas
    máquinas juntas: a segunda leva conflito, relê e refaz a conta);
  - **código único com gente cadastrando ao mesmo tempo**: o próximo item é o maior entre a planilha e a fila (pendentes,
    em conflito e os gravados dos últimos 7 dias) + 1, calculado dentro da revisão — duas pessoas nunca ganham o mesmo
    código nem o mesmo item; nome e código repetidos são recusados contra a planilha + a fila;
  - **a leitura** é a planilha (ou, se ela estiver travada até para ler, a cópia da última leitura boa em
    `%TEMP%\NexoEletric-catalogo\ultima-lida-*.xlsx`) com a fila por cima: o item novo aparece já com o código e a marca
    discreta **"aguardando gravar na planilha"** (o título diz quem pediu, de qual máquina e quando); a edição aparece com
    o valor novo. Um aviso no Definir diz que a planilha está aberta e que as mudanças gravam sozinhas;
  - **o gravador**: em toda máquina com o NexoEletric aberto, o app (`electron/lib/gravador-catalogo.js`) tenta a cada
    45 s (`NEXO_GRAVADOR_S`) e o motor tenta logo depois de cada mudança; só com a planilha livre; **um por vez** (a trava fica na própria fila, com validade de 2 min — máquina
    que cai não prende ninguém). Relê a planilha, aplica na ordem, grava uma vez, relê para conferir e só então marca como
    gravado. **Nunca duplica**: o código que já está na planilha conta como gravado; **nunca atropela**: a edição só grava
    se o valor de agora ainda é o de quando foi pedida — senão vira **conflito** (marcado em vermelho na lista; botão
    direito: Gravar por cima / Tentar de novo / Descartar). Quem via o valor antigo e tenta editar o mesmo item é avisado
    na hora ("outra pessoa mudou o nome … agora há pouco"). Falha que não é trava fica na fila com o erro visível;
  - a tela relê a lista a cada 10 s enquanto houver mudança pendente e avisa quando gravou;
  - o Novo projeto e o `projeto_criar`/`catalogo_previa` do MCP usam a mesma fila; sem o NexoBD no ar vale o caminho de
    antes (direto, com a planilha livre);
  - rotas novas: `GET /api/catalogo/fila`, `POST /api/catalogo/fila/resolver {id, como}`, `POST /api/catalogo/fila/gravar`.
- **Variante de projeto = um dropdown só** (pedido do dono: "o dropbox pra criar variante, precisa ser só o dropbox …
  clicar em 'adicionar variante' dentro do dropbox mesmo, e isso abre a tela pra selecionar o equipamento daquela
  variante, seleciona só o equipamento pq a PCB é a mesma"). A área "Variante de projeto" (esquema e PCB) é só o
  dropdown: **Padrão (todos montados)**, as variantes e **+ Adicionar variante**; com uma variante escolhida, também
  **Renomear esta variante…**, **Trocar equipamento desta variante…** e **Apagar esta variante…** (com divisor). Os botões
  soltos saíram (o Suprimir / Montar fica na barra da vista e no Shift+S). Permissões como antes: a equipe edita; o
  visualizador e o não convidado só trocam de variante (as ações aparecem apagadas, com o motivo).
  - **+ Adicionar variante** abre o catálogo do Definir **só com equipamentos** (a PCB é a mesma); o equipamento dá o
    **código** da variante e em seguida a pessoa dá o **nome** (obrigatório — "precisa por nome da variante"; a sugestão é
    o nome do equipamento; nome repetido é recusado). Cancelou, nada é criado. O equipamento do projeto padrão e o de
    outra variante são recusados. Equipamento que não existe: cadastra ali mesmo (só Equipamento), pela fila.
  - Com a variante ativa, o campo **EQUIPAMENTO** do quadro da folha mostra o código do equipamento **da variante**; a
    linha "VARIANTE …" saiu do quadro (a barra da vista diz o nome); **PLACA** continua o código da PCB.
  - Variantes da 1.88.0 (nome livre, código de qualquer grupo) continuam abrindo como estão.
- **Lista do Odoo com variante** (pedido do dono: "sempre que for subir lista de variante, precisa gerar uma PCB
  (montada) gera com o codigo da placa + nome da variante … e toda vez que enviar pro odoo, a lista, precisa enviar sem
  criar a PCB virgem, quando for uma variante"): com a variante ativa, `pcb_montada.codigo` = **"<código da placa>
  <NOME DA VARIANTE>"** (ex. "PAEL-DI261940 SEM R1"; o separador mora num lugar só: `tools/rotas/variantes.py` »
  `SEPARADOR_MONTADA`, o mesmo em `hub-variantes.js`) e o payload vai **sem `pcb_virgem`** e sem a foto da placa virgem
  (a tela do envio diz "PCB virgem: não enviada (variante — a placa virgem é a do projeto padrão)"). Na padrão, como
  antes: montada e virgem com o código da placa (virgem = código da PCB). O equipamento da variante só vai ao quadro,
  nunca ao Odoo. Isso substitui a regra da 1.88.0 (montada = código da variante). `docs/prompt-altium-envio-de-lista.md`
  §11.1 conta ao addon `di_lista_altium`.
- **Apagar da biblioteca só pelo administrador** (pergunta ao dono: "componente local e valor do Almox ainda podem ser
  apagados por qualquer usuário logado; deixo só para o admin?" — "sim só pro admin"): apagar componente local
  (`POST /api/locais/<id>/apagar`, o `local_apagar` do MCP) e excluir valor do almoxarifado (`/api/symbols/almox-excluir`
  com `confirmar`, o `/almox-excluir/desfazer` e também o apagar dos duplicados e dos "fora" com `confirmar`) são só do
  **administrador do Nexo Hub**: usuário comum, visualizador e sem login levam 403 `sem_permissao` "Só o administrador do
  Nexo Hub apaga componentes da biblioteca" (o before_request de `tools/rotas/equipe.py` » `recusa_so_admin`, que vale
  também para o que o Rust repassa). A prévia (sem `confirmar`, não grava) continua livre. Na tela, "Apagar" da ficha do
  componente local, "Apagar componente local…" do botão direito, "Apagar da biblioteca…" do almoxarifado e os "apagar
  os antigos/os fora" ficam desligados com o motivo para quem não é admin (`HubEquipe.motivoSoAdmin`).
- Testes: `tests/test-catalogo-fila.js` (novo: Excel aberto, duas "máquinas" em processos ao mesmo tempo sem código
  repetido, gravador único com trava e trava vencida, edição concorrente com conflito, arquivo exclusivo lendo a cópia,
  erro que não é trava, descartar, sem NexoBD), `electron/test/gravador-catalogo.test.js` (novo), `tests/nexohub-falso.js` (criar categoria), `test_projeto_novo.py`
  (Definir só com placas e equipamentos), `test_variantes.py` e `test-variantes.js` (equipamento do projeto recusado, nome
  obrigatório, quadro com o equipamento da variante, montada = código + nome e sem virgem; na padrão, os dois),
  `test-schtemplate.js` (o quadro com a variante), `test_equipe.py` e `test_componentes_locais.py` (apagar só o admin;
  comum, visualizador e sem login 403; a prévia livre) e os `test_almox_*` rodando como admin.

## 1.88.0 — 2026-11-09

**A árvore da esquerda vira o controle de PCB, o catálogo fica com Placas e Equipamentos (mais as categorias próprias) e
nasce a VARIANTE DE PROJETO: a mesma PCB para produtos diferentes, onde só se suprime (não monta) componente.**

- **Árvore = controle de PCB.** Cada projeto aparece pelo **nome da PCB** (o nome do item do catálogo para o código da
  placa do projeto) com o **código da placa** em cinza ao lado; o título (passar o mouse) diz também a pasta. Projeto sem
  placa definida: o nome da pasta, como antes, com a marca discreta **"sem PCB"** (o título diz "PCB não definida"). Projeto com variantes ganha a
  etiqueta "N variantes". A busca acha pelo nome da PCB, pelo código e pelo nome da pasta. Nenhuma pasta muda de nome.
  O nome da PCB vai para o cabeçalho do esquema (`NomeDaPlaca`) no Definir projeto e no Novo projeto; projeto antigo que
  só tem o código busca o nome no catálogo uma vez por sessão. O `/api/index.json` (Python e Rust) traz `placa: {codigo,
  nome}` e `variantes`.
- **Sem limite de caracteres no nome** (placa ou equipamento): o limite de 27 da 1.82.0 e o "⚠ nome longo" saíram.
- **Quadro da folha:** onde ia o equipamento agora vai **só o código do equipamento** (o `NomeDoEquipamento` continua
  guardado no cabeçalho, só não aparece). Sem código: "PROJETO NÃO DEFINIDO", como na 1.86.0. O campo PLACA continua com o
  código da placa.
- **Catálogo (Definir projeto):** "produto" e "equipamento" viram uma coisa só — **Equipamento**. Cabo, software, sistema,
  acessório e nacionalização são **categorias próprias**, cada uma com o seu filtro (um TIPO novo que a planilha inventar
  vira uma categoria com o próprio nome). O filtro "Produtos" sumiu; o cadastro novo e o "mudar categoria" do botão direito
  oferecem Placa, Equipamento, Sistema, Cabo, Software, Acessórios e Nacionalização. O agrupamento é **na leitura**: a
  planilha não é reescrita; só grava o que a pessoa cadastra ou edita pela tela. Na cópia do catálogo de 09/11 (1.887
  itens): Placas 89, Equipamentos 1.746, Acessórios 28, Nacionalizações 16, Sistemas 4, Cabos 3, Software 1 (nenhum item
  tem TIPO "Produto"; os 32 que a 1.87 chamava de produto eram acessório, cabo e software).
- **Placa começa com "P".** Cadastrar ou editar placa com código sem o "P" é recusado com a mensagem (também passar um
  item para Placa sem o P no código). As placas antigas sem o P ficam marcadas **"⚠ código de placa errado"** e o filtro
  de mesmo nome junta todas (30 na cópia de 09/11); escolher uma delas como PCB no Definir projeto **avisa o motivo e
  deixa** (o Novo projeto também recusa sigla de placa sem o P).
- **Lista do Odoo:** a **PCB montada** e a **PCB virgem** vão pelo **código da PCB** (`codigo_placa`,
  `pcb_montada.codigo`, `pcb_virgem.codigo` no payload; o equipamento só dá o nome no quadro e não vai ao Odoo). Regra com
  variantes (decisão de 09/11, fácil de trocar: `tools/rotas/variantes.py » codigos` e `hub-variantes.js » codigos`):
  **PCB virgem = código da PCB** (a fibra é a mesma em todas as variantes); **PCB montada = código da PCB na variante
  padrão, e o código da variante quando há uma ativa** (cada variante é outro produto montado; a chave de idempotência
  ganha o código da variante). A tela do envio mostra "PCB montada: … · PCB virgem: …" e a variante.
- **Variante de projeto** (`Projects/<p>/variantes.json`, formato `nexoeletric-variantes-1`, viaja para o NexoBD com o
  projeto; quem suprimiu o quê vai para o Histórico › Modificações):
  - Área **"Variante de projeto"** no painel da direita: em Configurações no Esquema, nas Propriedades da placa na PCB.
    Seletor "Padrão (todos montados)" + as variantes; **+ Nova** pede o nome e **na hora** abre o catálogo do Definir
    projeto para escolher ou cadastrar o **código da variante** (sem código não cria; o código não pode ser o da PCB nem o
    de outra variante); Renomear, Código… (pelo catálogo) e Apagar. Mostra a PCB montada/virgem e os suprimidos (clique
    acha o componente).
  - A variante ativa é **desta máquina** (`.variante-ativa.json`, fora do NexoBD): trocar aqui não muda a vista de quem
    abre o mesmo projeto noutro computador. Trocar recarrega o esquema e a PCB.
  - **Na variante a PCB é exatamente a mesma**: as barras de edição do esquema e da PCB somem (o Salvar, o Definir projeto
    e o Trocar acervo também); fica a barra da variante com **Suprimir / Montar** (botão, menu do botão direito e
    **Shift+S**). Qualquer outra edição (mover, apagar, propriedades, fio, trilha, destravar a PCB…) é desfeita com o aviso.
    No servidor: com uma variante ativa o `/api/save` (Python e Rust) e as escritas do MCP recusam mudar `schematic.js`,
    `changes.js`, `annotations.js` e `rules.js` (409 `variante_ativa`); só o `variantes.json` muda.
  - **Componente suprimido** (não montado): no esquema com o **X vermelho** do "Not Fitted" e o símbolo esmaecido; na PCB
    com um véu escuro e o X (o cobre, os pads e os furos continuam: a placa é a mesma) e **fora do 3D** (e da foto da placa
    montada). Sai do **BOM** (do painel e da página da bancada no NexoBD), da **lista do Odoo**, do **CSV da Neoden**
    (pick-and-place) e do `bom_listar` do MCP. **Gerber da variante = Gerber da PCB.** O envio à JLC só manda o Gerber
    (não há BOM/CPL de montagem na JLC hoje), então não muda.
  - **Exportações dizem a variante**: o nome do BOM e do CSV da Neoden e o PDF do esquema ganham " - variante <código>";
    o quadro da folha mostra **"VARIANTE <nome> · <código>"** na linha que era do nome do equipamento (e um selo no alto da
    vista). O campo PLACA continua com o código da PCB.
  - **Permissões:** criar, renomear, trocar código, apagar e suprimir = edição (responsável, colaborador convidado ou
    admin); o visualizador e quem não foi convidado levam 403 `sem_permissao` (tela e servidor, `ROTAS_EDICAO`). Todo
    mundo pode **trocar de variante** para ver e exportar.
  - **MCP:** `variante_listar`, `variante_ativar` (livre também para o visualizador) e `variante_suprimir` (a equipe).
- Por dentro: `tools/rotas/variantes.py` (rotas `/api/variantes*`, a trava do save, `aplica`/`codigos`), `hub-variantes.js`
  (o mesmo no navegador e no Node, e a tela), `rust/crates/nexo-hub/src/variantes.rs`, `mcp/lib/variantes.js`,
  `mcp/ferramentas/variantes.js`; `hub-catalogo.js` ganhou `escolhe()` (o catálogo para escolher um código só) e
  `rotuloProjeto()`. Testes: `tests/test_variantes.py`, `tests/test-variantes.js`, `tests/test-catalogo.js` (categorias,
  placa sem P, sem limite), Rust (a trava do save e o `placa` do índice).

## 1.87.0 — 2026-11-09

**A função do usuário vem do Nexo Hub: Administrador, Usuário ou Apenas visualizador. O visualizador vê, baixa, exporta
e envia à JLC, mas não edita nada.** (Para o administrador escolher a função no painel é preciso o **Nexo Hub
2.27.0**; com o Hub antigo todo mundo segue como usuário comum.)
- **Usuário comum** (como já era desde a 1.84.0, conferido de novo): entra e edita os projetos de que participa — o
  que ele criou (é o responsável) e aqueles para que foi convidado como colaborador —, apaga os próprios, e projeto de
  outra pessoa só edita se for convidado. Quem cria vira o responsável também ao **importar do Altium** e ao criar uma
  **PCB nova num projeto multi-PCB** ou uma placa nova numa pasta nova (antes só o Novo projeto e o MCP faziam isso). E
  renomear ou mover de grupo o projeto de outra pessoa agora pede o convite, como salvar.
- **Apenas visualizador:** fica no mesmo somente leitura do comum que não foi convidado, mas em **todos** os projetos,
  inclusive os em que é o responsável ou colaborador.
  - **Não pode:** salvar esquema, PCB, regras ou sinalizadores; mexer na biblioteca (símbolos, footprints, modelos 3D,
    componentes locais, Almox, templates de folha, substituições); Definir projeto/catálogo; criar, importar,
    renomear, mover, excluir ou assumir projeto; aprovar; apagar ou voltar revisão; convidar ou ser convidado/
    responsável (quem já estava numa equipe continua aparecendo nela, mas não edita); mexer nos itens fora do esquema da
    lista do Odoo.
  - **Pode:** abrir e ver tudo, navegar, medir, 3D, Histórico (revisões e modificações), baixar e exportar (Gerber,
    PDF, BOM, STEP, pick-and-place, laser), **Enviar pra JLC**, mandar a lista ao Odoo, mandar a placa ao NexoCAD,
    sincronizar o projeto desatualizado e usar o chat **para consultar** (o turno roda em "Só planejar" e a IA não grava
    nada por ele).
  - Na tela: o selo **Visualizador** ao lado do crachá do Nexo Hub, a faixa "Somente leitura — seu usuário é apenas
    visualizador…" na vista Esquema/PCB, o cadeado na árvore (com o motivo), o Salvar desligado, e os itens Novo
    projeto, Abrir do Altium, Renomear, Mover, Excluir e Assumir desligados com o motivo "Seu usuário é apenas
    visualizador — peça ao administrador do Nexo Hub".
  - No servidor (o que vale de verdade): o `/api/save` do Python e o do Rust (projeto e `Libs/`) e todas as rotas de
    edição (`tools/rotas/equipe.py » ROTAS_EDICAO`, um `before_request`) respondem 403 `sem_permissao` com o motivo; as
    ferramentas do MCP que não são de leitura nem de saída recusam antes de rodar, e nenhuma gravação da IA passa.
- **A troca de função vale na hora, sem reiniciar:** o Nexo Hub avisa os programas quando a lista de usuários muda (o
  mesmo evento do login), e o NexoEletric relê quem está logado (`/api/sessao?forcar=1`): o selo, a faixa e o Salvar
  mudam em segundos. Sem o evento, a árvore e a vista conferem sozinhas de 8 em 8 s, e o servidor nunca usa uma
  sessão com mais de 2 s.
- **O somente leitura não barra saída:** conferido um por um — Gerber (Salvar no projeto e Baixar), PDF, render,
  BOM, laser, Enviar pra JLC, lista do Odoo, NexoCAD e a sincronia não passam pelo `/api/save` nem pela checagem da
  equipe, para o visualizador e para o comum não convidado. O que mudou para o comum não convidado: o chat no projeto
  de outra equipe também passa a ser só consulta (antes o modo de edição do chat gravava direto na pasta), e o
  "Aplicar" de uma proposta do chat recusa.
- Por dentro: `tools/rotas/equipe.py` (`funcao_de`, `eh_visualizador`, `publico` com `visualizador`/`funcao`,
  `permissao.visualizador`, `recusa_visualizador`, `recusa_rota`, `ROTAS_EDICAO`, `/api/sessao?forcar=1`; convidar ou
  tornar responsável um visualizador = 409), `hubserver.py` (responsável do projeto importado e da PCB nova;
  renomear/mover pela equipe), `tools/rotas/board_novo.py`, `tools/chat/chatserver.py` (`_recusa_edicao`),
  `rust/crates/nexo-hub/src/equipe.rs` e `statics.rs` (`Modo::Login.visualizador`, `recusa_visualizador`),
  `mcp/lib/equipe.js` (`recusaFerramenta`, `SAIDAS`), `mcp/lib/contexto.js`, `mcp/lib/protocolo.js`, `hub-equipe.js`
  (selo, faixa, `visualizador()`, `barraVisualizador()`), `hub-shell.js`, `hub-menubar.js`, `hub-aprovacao.js` e
  `hub.html` (Abrir do Altium).

## 1.86.0 — 2026-11-09

**A senha mestre saiu de vez: só o administrador ou o responsável exclui. E o projeto sem código mostra "PROJETO NÃO
DEFINIDO" no quadro da folha, com um clique para defini-lo.**
- **Excluir projeto** (botão direito na árvore, ou Configurações do hub › Projeto): só o **administrador do Nexo Hub**
  ou o **responsável pelo projeto**, pelo login. Não existe mais senha nenhuma no diálogo: ele diz "Você é o
  responsável…"/"Você é administrador…" e exclui (a pasta continua indo inteira para `Trash\`).
  - Para os outros o "Excluir projeto…" fica **desligado**, com o motivo logo abaixo ("Só o administrador ou o
    responsável (Paula Prado) exclui este projeto"), e o botão das Configurações também.
  - **Projeto sem responsável:** só o administrador. Os outros veem "Este projeto não tem responsável… Assuma o
    projeto" e um botão **Assumir projeto…**; assumido, o diálogo volta com o Excluir.
  - Sem login (Nexo Hub antigo, Nexo Hub fora do ar, ninguém logado): ninguém exclui. O servidor confere de novo e
    responde 403 `sem_permissao` (a janela Rust repassa a mesma rota).
- **Apagar revisão** (Histórico › Revisões): a mesma regra — o administrador ou o responsável pelo projeto (antes era
  só o administrador, e o Nexo Hub antigo pedia a senha mestre). Para os outros o Apagar fica desligado, com o motivo.
- **Chat do Claude na rede:** com o "Compartilhar na rede local" ligado, o chat abre só com alguém logado no Nexo Hub
  desta máquina (era a senha mestre). O campo "Senha mestre" saiu das Configurações do aplicativo; a que estiver
  gravada no `settings.json` é ignorada e some na próxima gravação, e a que o chat guardava no navegador é apagada.
- **"PROJETO NÃO DEFINIDO":** no quadro de título da folha (template da casa), o **código da placa** e o **código do
  equipamento** que o projeto ainda não tem aparecem como **PROJETO NÃO DEFINIDO** (antes, em branco). Na tela sai em
  vermelho, com um tracejado em volta e a mão do mouse; **clicar abre o Definir projeto** (o catálogo de todos os
  produtos). Escolhida a placa e o equipamento, o texto some e entram os códigos.
  - O texto nunca é gravado no projeto: é só o desenho. O código da placa que o nome do projeto traz
    ("PDCD-DI261939 (PTYPE)") e os códigos dos projetos vindos do Altium (os nomes antigos) continuam valendo.
  - **No PDF do esquema** ele sai como o resto do quadro (na cor do template, sem o destaque): o projeto está
    indefinido, e a folha impressa diz isso em vez de um campo em branco que parece esquecido. Gerber e PDF da PCB
    não mudam (a logo da placa continua com `.CodigoDaPlaca`).
  - Também em Parâmetros do projeto (o campo vazio mostra PROJETO NÃO DEFINIDO e há um "Definir projeto…") e no
    resumo do Definir projeto nas Configurações.
- Por dentro: `hubserver.py` (sem `MASTER_PASSWORD`/`ALTIUMHUB_MASTER`; `api_project_delete` pelo
  `tools/rotas/equipe.py » recusa_apagar`), `tools/rotas/aprovacao.py` (apagar revisão pelo login), `/api/equipe` e
  `/api/equipes` com `apagar`/`motivoApagar`, `tools/chat/chatserver.py` (a tranca `ALTIUMHUB_CHAT_TRANCA` pede o
  login; o `ALTIUMHUB_CHAT_SENHA` antigo ainda liga a tranca, sem senha), `hub-schtemplate.js` (`NAO_DEFINIDO`,
  `naoDefinidos`), `schframe.js` (o destaque e o clique), `electron/lib/settings.js` (`masterPassword` some na leitura)
  e `tools/deploy/*` sem a senha.

## 1.85.0 — 2026-11-09

**Projeto desatualizado: quem está com o projeto aberto fica sabendo na hora que outra pessoa mudou, e escolhe quando
atualizar.**
- Antes, a mudança de outra máquina só chegava na rodada de 2 em 2 minutos e entrava calada: a vista aberta
  recarregava sozinha (ou, com edição não salva, pedia F5 e perguntava "sobrescrever?" ao salvar).
- Agora, se alguém (colaborador, administrador, o responsável em outra máquina, ou você mesmo em outro computador)
  grava o projeto que está aberto aqui, em poucos segundos aparece o aviso **Projeto desatualizado**: a foto e o nome
  de quem mudou, onde ("Paula Prado, em PC-OFICINA"; "Você, em …" quando é o seu login), quando, e o que mudou (as
  modificações do histórico com autor). A pergunta: "Seu projeto está desatualizado. Sincronizar e atualizar para a
  última versão?".
  - **Sincronizar e atualizar** puxa o projeto do NexoBD na hora e recarrega o projeto e as vistas abertas. O que
    você salvou aqui e ainda não tinha subido sobe junto. Se os dois mexeram no mesmo arquivo, o aviso explica antes:
    fica o seu, e o outro vai para `.altiumhub\conflitos-nexobd\`.
  - Com edição **não salva** no Esquema/PCB, o botão vira **Descartar as minhas e atualizar** (ou "Agora não", salve
    e atualize depois).
  - **Agora não** deixa o selo **Projeto desatualizado — sincronizar** na barra da vista e um ícone na árvore de
    projetos; clicar reabre o aviso. Mudanças novas atualizam o mesmo aviso (não empilham janelas).
- Enquanto o aviso está pendente, a versão nova não entra sozinha no projeto aberto. Projeto que não está aberto
  continua sincronizando sozinho, como sempre; mudança feita neste mesmo computador não avisa.
- Quem grava: a gravação sobe para o NexoBD uns 3 s depois, e a revisão leva o login e o nome da máquina, para o
  aviso dizer quem e onde.
- Por dentro: `electron/lib/sincronia.js` (o motor segura a revisão de fora do projeto aberto e escreve o aviso),
  `tools/rotas/sincronia.py` (`/api/sincronia/*`, a porta da página: projeto aberto, aviso e pedido de sincronizar,
  por arquivos em `.altiumhub\`), `hub-sincronia.js` (o aviso e o selo). O evento do NexoBD de outro NexoEletric, antes
  ignorado, agora dispara a rodada na hora; a nota das revisões leva "@<máquina>".

## 1.84.0 — 2026-11-09

**Sem carimbo: quem desenha, quem aprova e quem mexe em cada projeto vêm do login do Nexo Hub. E o histórico diz
quem mudou o quê.**
- **O carimbo saiu.** Não existe mais cadastrar carimbo, senha de carimbo, carimbo em uso nem a janela de carimbos
  (o "Carimbo…" do menu da folha saiu). O seu nome vem do login do Nexo Hub, e quem é **aprovador** (e
  **administrador**) é o administrador que marca no Nexo Hub, em Configurações › Usuários. O que o carimbo fazia
  continua, feito pelo usuário logado:
  - **Novo projeto:** o desenhista é você (o nome do login, com a data); você vira o **responsável** pelo projeto.
  - **Arquivo › Assumir projeto…:** você vira o desenhista (com a data de hoje) e o responsável. O administrador
    assume qualquer projeto; os outros, só projeto sem responsável (o responsável passa o projeto pela Equipe).
    Sem senha mestre.
  - **Aprovar** (ao lado do Salvar, no Esquema): só para quem é aprovador no Nexo Hub e mexe no projeto. Aprovado, o
    botão mostra a foto e o nome de quem aprovou; o quadro de título da folha e os PDFs levam o nome do login.
  - **Apagar revisão** (Histórico › Revisões): o administrador, sem senha. **Excluir projeto**: o responsável ou o
    administrador, sem senha (os outros continuam com a senha mestre).
  - As aprovações antigas continuam valendo. O arquivo de carimbos que já existe fica quieto no NexoBD.
- **Equipe do projeto** (Arquivo › Equipe do projeto…, ou botão direito no projeto): o responsável e os
  colaboradores, com foto e nome. O responsável e o administrador **convidam** (escolhem da equipe do Nexo Hub, com
  busca) e tiram colaboradores; o administrador troca o responsável; o colaborador pode sair. Projeto antigo sem
  responsável: qualquer pessoa logada mexe e pode assumir.
- **Quem não é da equipe abre o projeto só para leitura:** uma faixa avisa "Somente leitura — responsável <nome>.
  Peça um convite.", o Salvar fica desligado e o autosave não grava. O servidor também recusa (o app, a janela Rust e
  a IA pelo MCP). O administrador mexe em tudo sem convite. Na árvore de projetos, "meu", "colab." ou um cadeado.
- **Histórico › Modificações** (a aba principal): cada gravação com a foto e o nome de quem fez, quando ("há 5 min")
  e exatamente o que mudou — componente adicionado/removido/movido, valor 10k → 22k, footprint, rótulos de net,
  fios; na PCB "2 trilhas na net GND adicionadas (Top)", "U1 movido para (30,48; 22,86) mm, girado para 90°", via
  removida; regras e sinalizadores. O que a IA gravou leva o selo **pela IA**. O autosave da mesma pessoa no mesmo
  arquivo em até 5 min vira uma linha só. Convites, aprovações e revisões também aparecem. As revisões mostram a foto
  e o nome de quem aprovou.
- As revisões que o NexoEletric sobe ao NexoBD levam o login de quem está logado como autor.
- Por dentro: `tools/rotas/equipe.py` (o servidor pergunta ao Hub `GET /api/v1/sessao`; rotas `/api/sessao*`,
  `/api/equipe*`, `/api/historico*`), `tools/rotas/aprovacao.py` (era o `carimbos.py`, sem as rotas `/api/carimbos*`),
  `hub-equipe.js`, `hub-aprovacao.js` (era o `hub-carimbos.js`), `rust/crates/nexo-hub/src/equipe.rs` e
  `mcp/lib/equipe.js`. A equipe mora em `Projects/<p>/equipe.json` e o histórico em `Projects/<p>/Historico/<id do
  usuário>.jsonl` (um arquivo por pessoa, para duas máquinas gravando ao mesmo tempo não se perderem no NexoBD); os
  campos `Desenhista_carimbo`/`Aprovacao_carimbo` do cabeçalho guardam o login. Precisa do Nexo Hub 2.26.0+ (Hub
  antigo: edição liberada, aprovação recusada com "Atualize o Nexo Hub").

## 1.83.0 — 2026-11-09

**Só funciona logado no Nexo Hub, com o login no canto superior direito.**
- Regra da atmosfera Nexo (contrato do Nexo Hub, §9 Login): sem alguém logado no Nexo Hub desta máquina, uma tela
  por cima de tudo pede **usuário (ou e-mail) e senha** — a conta é a do Nexo Hub, e entrar aqui (ou no Hub, ou
  em qualquer programa da atmosfera) libera todos. Enquanto ela está aberta, os atalhos de teclado não chegam ao
  NexoEletric por baixo e arquivo solto na janela não abre projeto.
- Logado, **o crachá** (foto ou iniciais + primeiro nome) fica na ponta direita da barra de menus; clicar mostra a
  conta, **Abrir o Nexo Hub** e **Sair** (sair aqui sai de todos). Login ou saída em outro programa aparece na hora.
- **Na abertura, o NexoEletric confere o Nexo Hub** e, se ele não responde, abre o Nexo Hub instalado (oculto na
  bandeja) e espera até 45 s ("Conectando ao Nexo Hub…"). O Hub cair depois de logado não trava o trabalho: o crachá
  fica apagado e ele volta sozinho.
- A vista Esquema/PCB aberta numa janela à parte também pede o login. O MCP e a janela de testes não pedem.
- Nexo Hub antigo (sem login, até a 2.24): libera como antes, sem crachá.
- Por dentro: `nexohub-sessao.js` e `electron/lib/nexohub-abrir.mjs` são cópias sem mudança do `cliente/` do
  repositório nexohub; `hub-nexohub-login.js` liga os dois. A página pede o Hub ao motor por
  `eletricApp.garantirHub()` (janela Rust: menu `nexohubGarantir` → resposta `nexohub <json>` na entrada padrão;
  janela Electron: `nexohub:garantir` no preload).

## 1.82.0 — 2026-11-06

**Formas e texto na barra do Esquema.**
- A barra ganhou **Texto**, **Linha**, **Retângulo**, **Círculo** e **Estrela**, e a gaveta **Mais formas** (seta,
  retângulo arredondado, triângulo, losango). Arrastar desenha de canto a canto, na grade; clicar sem arrastar põe uma
  do tamanho padrão. Shift: quadrado / linha a 0°-45°-90°; no Círculo, o Shift solta para elipse. Esc ou o botão
  direito largam a ferramenta.
- A forma marcada tem alças verdes (puxar muda o tamanho ou a ponta), anda com o arrasto, gira no Espaço, espelha no
  X/Y e sai no Del. Na ficha: forma, cor, espessura, traço (sólido, tracejado, pontilhado) e preenchimento. O texto:
  a palavra (duplo clique edita), o tamanho e a cor.
- Item novo no `schematic.js`: `{"t":"forma","forma":"ret|linha|seta|arred|elipse|triangulo|losango|estrela",
  "pts":[[x1,y1],[x2,y2]], cor?, larg?, fundo?, traco?, rot?}`; o texto ganhou `cor`. Saem no PDF. Não são
  elétricos: ficam fora das nets e não tiram a aprovação.
- A barra quebra em duas linhas quando a vista fica estreita.

## 1.81.0 — 2026-11-06

**Carimbos mais simples e apagar revisão no histórico.**
- **A janela Carimbos** mostra em cima o carimbo em uso neste computador, com **Editar** e **Sair**; embaixo os
  outros (Usar, Apagar). O "Novo carimbo" virou só o botão **Adicionar carimbo** (nome, senha, confirmar; sem
  carimbo em uso, o novo já entra em uso).
- **Aprovador é um switch** em cada carimbo (liga/desliga; pede a senha mestre). O "Aprovador…" saiu.
- **Editar** troca o nome e/ou a senha do carimbo (pede a senha atual) e tem o Apagar carimbo. Os projetos que já
  levam o nome antigo na folha ficam como estão. Rota nova: `POST /api/carimbos/editar`.
- **Histórico › Revisões:** cada revisão tem **Apagar** (senha mestre): sai do histórico e a cópia em
  `Revisoes/REV.<x>/` some. Apagar a revisão em que o projeto está aprovado tira a aprovação junto. Rota nova:
  `POST /api/revisoes/apagar`.

## 1.80.0 — 2026-11-05

**Revisão nova só quando o esquema muda de verdade; e o esquema não trava mais depois de voltar uma revisão.**
- **A aprovação do esquema olha só o elétrico.** Mover componente, arrastar fio sem mudar a ligação, mexer em texto,
  rótulo, folha ou template não tira mais a aprovação (e não pede revisão nova). Tira: trocar componente (símbolo,
  footprint, valor, MPN e os parâmetros da peça), mudar a ligação (os pinos de cada net) ou o nome de uma net com
  rótulo, e os dados do projeto (código da placa, equipamento). Na **PCB** continua valendo qualquer mudança (mover,
  trocar nome...). A impressão elétrica é o `mcp/lib/impressao-eletrica.js` (o mesmo `extractNets` da tela); a
  assinatura nova começa com `e1-`. Estoque, custo e local do almoxarifado não contam.
- O Salvar do Esquema não apaga mais os campos da aprovação sozinho: quem decide é a assinatura do servidor.
- Projetos aprovados antes desta versão continuam aprovados, e mover coisas neles também não derruba mais: a
  conferência compara com a cópia da revisão aprovada (Projects/<p>/Revisoes/REV.x/).
- Se o Node não responder, a aprovação fica como está (nada é apagado do carimbo) e o Aprovar pede para tentar de novo.
- **Esquema travado em "X: NaN Y: NaN" depois de Voltar para uma revisão:** a página do esquema se recarrega quando o
  disco muda, e com a aba Histórico na frente ela estava escondida (0×0); o enquadramento dava zoom zero. Agora o
  enquadramento espera a tela ter tamanho (hub-draw.js » mkCamera), e um zoom inválido nunca fica.

## 1.79.0 — 2026-11-05

**O nome do catálogo tem no máximo 27 caracteres** (como "CARTAO MELPLAC 550 - P9CF01"); o que passar vai na descrição.
- Item novo (Definir projeto › Adicionar ao catálogo e Novo projeto), "Mudar nome…" e o MCP (`projeto_criar {produto}`)
  recusam nome acima de 27 caracteres, dizendo quantos tem (rotas: 409). Os campos de nome param em 27.
- Os antigos que passam do limite ficam com ⚠ na lista do Definir projeto (e no item escolhido), e o filtro
  **⚠ nome longo** junta todos para encurtar. Mudar outra coisa de um item antigo continua valendo.
- `lista` do catálogo traz `nomeMax` e `nomeLongo` em cada item.

## 1.78.0 — 2026-11-05

**Mudar a categoria de um item no Definir projeto.**
- O botão direito numa linha do catálogo ganhou **Categoria: Placa / Equipamento / Produto** (a de agora com ✓). Grava
  na coluna TIPO da planilha (se o TIPO de agora já é daquela categoria, fica; senão vira "Placa", "Equipamento" ou
  "Produto"); o código não muda. Para o que é produto e estava como placa.
- `POST /api/catalogo/editar` aceita `novoGrupo` (placa, equipamento ou produto) e devolve `tipo` e `grupo`.

## 1.77.0 — 2026-11-05

**Logo DiEletrons na PCB e o catálogo editável no Definir projeto.**
- **Logo DiEletrons**, no rodapé do Definir projeto: grava a definição, salva o esquema e põe na PCB a logo da casa (o
  desenho do LOGOTIPO_P_SILK das placas, "Di-elétrons" sublinhado), com o **código da placa** e a **revisão** embaixo,
  no canto de baixo à esquerda da placa, para arrastar na vista PCB. A placa que já tem a logo não ganha outra.
- O código e a revisão da logo são **automáticos**: os textos guardam as strings especiais `.CodigoDaPlaca` e
  `.Revisao`, e a placa as resolve com os parâmetros do projeto na tela, no Gerber, no laser e no que a IA gera. Uma
  aprovação nova (REV.C) muda a logo sozinha, sem mexer na PCB, e a vista PCB aberta se atualiza. Sem o Definir
  projeto, o código sai do nome do projeto.
- Footprint agora pode ter texto próprio, que anda e gira com o componente.
- **Botão direito numa linha do Definir projeto:** "Mudar código…" e "Mudar nome…", gravados no catálogo de todos os
  produtos. Código repetido é recusado e a mensagem diz de qual item ele já é.

## 1.76.0 — 2026-11-05

**Sem "Campos do carimbo": o carimbo é só a pessoa.**
- O item **Campos do carimbo…** saiu do menu da folha e do rodapé dos carimbos: o carimbo da casa se preenche todo
  sozinho (folha, Definir projeto, carimbos e Aprovar).
- **Carimbo novo** pede só o **nome**, a **senha** (a que o "Usar" pede) e se é **aprovador**. O campo de outras tags
  saiu, e o "Tags…" de cada carimbo virou **Aprovador…**, que liga ou desliga a aprovação com a senha mestre.

## 1.75.0 — 2026-11-05

**O carimbo se preenche sozinho, e o projeto é definido pelo catálogo de todos os produtos.**
- **Definir projeto** (Configurações do Esquema, e também no rodapé dos Campos do carimbo) abre o catálogo de todos os
  produtos numa tela. Ele tem:
  - pesquisa por código, nome, cliente ou descrição;
  - filtros **Placas / Equipamentos / Produtos** (a coluna TIPO da planilha, com as grafias soltas agrupadas);
  - escolha do **código da placa** e do **equipamento** (código e nome). Escolher uma placa traz junto o equipamento
    que a descrição dela cita;
  - **Adicionar ao catálogo**, quando o produto ainda não está lá: tipo, nome, cliente e descrição, com o código no
    padrão da casa (sigla + DI + ano + item). Código ou nome repetido no mesmo grupo é recusado, e a mensagem diz o
    código que já existe.
  Os códigos e o nome do equipamento vão para o carimbo.
- **Template da casa:**
  - "Equipamento linha um/dois" passa a ser **Nome do equipamento** e **Código do equipamento**, e a "linha única" sai;
  - o quadro "DESENHO:" passa a ser **PLACA:**, com o código da placa;
  - os nomes são os do template do Altium (NomeDoEquipamento, CodigoDoEquipamento, CodigoDaPlaca), então os projetos
    que vieram do Altium já aparecem preenchidos. Os nomes antigos continuam sendo lidos.
- **Campos automáticos:** Formato e Escala vêm da folha, Arquivo é o nome da folha, e o número da folha também é
  automático. Desenhista, verificador, aprovador, datas e revisão só vêm do projeto (carimbos e Aprovar): o que a folha
  ou o Altium tenham gravado com esses nomes não conta mais, e projeto sem aprovação não mostra "NOME_APROVADOR".
- **Campos do carimbo:** uma coluna só, sem os textos de cima, só com o que o sistema não preenche (no template da
  casa, nada).
- Novo projeto: a folha nasce com o nome do arquivo (SCH-DI…) e o carimbo com o código da placa. O equipamento vem do
  Definir projeto.

## 1.74.0 — 2026-11-05

**O carimbo do projeto: desenhista, assumir projeto e as revisões a cada aprovação.**
- **Desenhista = quem criou o projeto.** O Novo projeto não pergunta mais o nome: o desenhista é o **carimbo em uso**
  neste computador (o "Trocar…"/"Escolher…" do diálogo abre os carimbos), com a data de criação como data do desenho.
- **Arquivo › Assumir projeto…** troca o desenhista do projeto aberto pelo carimbo em uso, com a data de hoje. Pede a
  **senha mestre**: o carimbo do projeto só muda por aqui. Não mexe na aprovação.
- **A data do desenho só muda na criação e no assumir.** Ela não é mais atualizada a cada modificação (a modificação
  continua tirando a aprovação).
- **Campos do carimbo** não tem mais desenhista, verificador, aprovador, datas nem revisão: eles vêm do carimbo de
  quem criou ou assumiu e do Aprovar, e aparecem resumidos no topo da tabela.
- **Revisões.** Cada **Aprovar** define a revisão: a primeira aprovação grava a **REV.A** (ou a revisão que o carimbo
  já tinha, se o projeto veio do Altium numa REV.C); depois de uma modificação, a próxima aprovação grava a **REV.B**,
  e assim por diante. A revisão vai para o campo Revisão do template, e o projeto inteiro é guardado em
  `Projects/<projeto>/Revisoes/REV.<x>/`, que viaja com o projeto para o NexoBD.
- **Histórico › Revisões** (nova sub-aba, ao lado da Linha do tempo): o estado de agora (o que mudou desde a última
  revisão), cada revisão com quem aprovou, quando e **o que mudou** desde a anterior (componentes novos, removidos,
  movidos, valor/footprint trocado, fios, rótulos, carimbo, mudanças da PCB) e **Voltar para esta revisão**: o
  projeto inteiro volta a ser o daquela revisão, e fica aprovado de novo.
- O botão do Esquema mostra a revisão ("Aprovado · REV.B"). Um projeto já aprovado não é aprovado de novo sem
  modificação.

## 1.73.0 — 2026-11-05

**Todo conector com o símbolo "Conector 1 via", uma parte por pino.**
- Todo conector do almoxarifado (os valores com `conn`, mais de 260) passa a ser desenhado como o CONECTOR PADRÃO da
  biblioteca da casa: **um símbolo "Conector 1 via" por pino**, numerados de 1 a N, todos com o **mesmo designator**.
  O desenho vem da Biblioteca de símbolos (Libs/symbols-lib.js, o "Conector 1 via"). O número de cada via é o do pino
  do desenho antigo, então o footprint continua casando pad a pad. Se o desenho tiver menos pinos que as vias do
  conector, os que faltam são completados (o "1x40 40 vias" tinha 6 pinos desenhados e agora tem 40).
- **Adicionar componentes:** o conector entra **inteiro**, uma coluna com as N vias (de 100 em 100 mil) e o designator
  novo. A prévia mostra as vias empilhadas.
- **Tab:** com uma via selecionada, o Tab marca o conector inteiro. O **designator aparece num selo no topo da folha**
  (ex.: "CN2 2x15 30 vias… · 30 vias"). Vale para qualquer componente de várias partes.
- Designator e valor saem só na parte 1. As outras mostram só o número da via.
- **Os conectores já colocados** com o desenho antigo (um símbolo com todos os pinos) viram uma parte por via quando o
  esquema abre, com a ponta de cada pino exatamente onde estava. Os fios e as nets não mudam. A folha fica marcada
  como alterada e um aviso diz quais conectores mudaram; ao salvar, a mudança fica gravada.
- MCP: a IA vê os conectores do mesmo jeito (o esquema antigo é lido já convertido), e o `sch_adicionar` de um
  conector sem `part` coloca as N vias com o mesmo ref.

## 1.72.0 — 2026-11-05

**Carimbos da casa e aprovação do projeto.**
- **Carimbo…** no menu da folha do Esquema abre os carimbos salvos (Libs/carimbos.json, que vai para o NexoBD, ou
  seja, todo mundo vê os mesmos). Cada carimbo tem o nome e a senha que a pessoa deu na criação. **Usar** um carimbo
  pede a senha dele e vale só neste computador; o nome do carimbo em uso aparece no menu ("Carimbo · Lucas").
  **Apagar** e **Tags…** pedem a senha mestre do sistema. Criar carimbo com a tag **aprovador** também pede a senha
  mestre. A tabela de campos do template continua em **Campos do carimbo…**.
- **Aprovar**, ao lado do Salvar: aparece quando o carimbo em uso tem a tag aprovador. Ele preenche no template o
  **verificador e o aprovador** com o nome do carimbo e a data de hoje (quem verifica também aprova). Sem carimbo
  aprovador, o lugar mostra **Sem aprovação** em vermelho piscando; depois de aprovado, **Aprovado** em verde.
- No painel Projetos, cada projeto leva **[Aprovado]** (verde) ou **[Sem aprovação]** (vermelho, piscando).
- **Qualquer modificação tira a aprovação.** A aprovação guarda a assinatura do schematic.js, do changes.js e do
  board.js. Se algum deles muda (esquema salvo, PCB editada, Altium reexportado ou a IA mexendo), a tag volta para
  [Sem aprovação] na hora, os nomes de verificador e aprovador saem do carimbo e a **data do desenho** vira a de hoje.
  Editar e salvar no Esquema faz isso na mesma gravação; mudança que chega de fora é limpa depois de 2 minutos, que é
  o tempo para o NexoBD terminar de trazer os arquivos de outra máquina.
- O grupo **Bibliotecas** saiu do painel Projetos (a aba Biblioteca continua no topo).

## 1.71.0 — 2026-11-04

**O Tab da vista PCB vai até a net inteira, e o terceiro Tab realça a net com os componentes.**
- **Tab Tab** (com uma trilha, arco ou via selecionado) não para mais no pad: atravessa as vias **e os pads** e
  seleciona a net inteira, juntando todo cobre livre (trilha, arco, via) com o mesmo nome de net — inclusive o pedaço
  que só se liga pelo plano ou por outro pad do componente. Sem nome de net, segue a ligação, atravessando o pad.
- **Tab Tab Tab** (sem mexer na seleção) escurece o resto da placa e realça a net, e acende os **componentes que
  encostam nela**: a caixa do componente e os outros pads dele aparecem. Esc limpa.
- O realce do Ctrl+clique numa net também acende os componentes dela.

## 1.70.1 — 2026-11-04

**Projeto renomeado ou apagado em outra máquina não volta com o nome velho quando o NexoBD muda de identidade.**
- A memória do espelho de projetos era zerada sempre que o NexoBD se identificava de outro jeito (máquina|pasta: o banco
  que foi para outra máquina, ou o Hub que trocou de NexoBD e voltou). Sem ela, a pasta com o nome antigo (o
  `MIRBC_DI251885`, renomeado para `MIRBC-DI251885DRV` em outra máquina) subia como projeto novo, com o conteúdo velho,
  e aparecia para todo mundo ao lado do novo; o projeto apagado em outra máquina também voltava.
- Agora a memória do banco de antes fica guardada (volta se o Hub voltar para ele) e, num banco sem memória, vale a dos
  itens que ele também tem (os ids viajam com o banco). Assim a pasta renomeada acompanha o nome novo, a apagada vai
  para a lixeira, e só a pasta que o banco não conhece sobe como projeto novo.

## 1.70.0 — 2026-11-04

**Novo projeto pelo clique direito, o contorno da placa editável e o menu da folha que abre com um clique.**
- **Clique direito em "Projetos"** (a raiz da árvore ou o cabeçalho do painel) abre o menu com **Novo projeto…**,
  Reindexar, Abrir todos e Fechar todos.
- O Novo projeto ganhou o **Template do esquema**: o da casa por padrão, outro template da casa, ou "sem template" (A4
  em branco). O aviso de campo faltando só aparece depois de começar a preencher. O MCP também aceita
  `projeto_criar {produto, template}`; o template que não existe é recusado antes de registrar no catálogo.
- **O contorno da placa (PCB) se clica.**
  - Retângulo: a ficha "Board Outline" dá **Largura**, **Altura** e a origem; o canto de baixo à esquerda fica
    parado.
  - Contorno de várias retas: cada reta se clica e se edita como uma reta comum (início, fim e comprimento). A reta
    vizinha acompanha, porque o vértice é o mesmo. O arco só se lê.
  - Cada edição grava um `outline_set` (trocando o anterior), com o Ctrl+Z. O contorno de antes aparece tracejado.
    No Altium o ApplyChanges pergunta antes de trocar o contorno.
- **O menu da folha do Esquema** abre e recolhe com um clique em qualquer lugar do cabeçalho, não só na seta.

## 1.69.2 — 2026-11-04

- O menu da folha do Esquema passa para o canto esquerdo, e a barra de ferramentas vem logo depois dele, na mesma
  altura. A barra acompanha a largura do menu, aberto ou recolhido no nome da folha.

## 1.69.1 — 2026-11-04

- O menu da folha do Esquema fica **ao lado** da barra de ferramentas, na mesma altura, e não mais embaixo dela.
  Ele acompanha a largura da barra quando ela muda; recolhido, sobra só o cabeçalho com o nome da folha.

## 1.69.0 — 2026-11-04

**Novo projeto com o código da casa, o menu da folha e o painel enxuto do Esquema.**

**Novo projeto.** O botão novo no painel Projetos (e Arquivo › Novo projeto…) pergunta o nome da placa, o cliente,
a descrição e **quem iniciou o projeto**. Enquanto você digita, ele mostra o código que a placa vai ganhar no catálogo
`CATALOGAÇÃO TODOS OS PRODUTOS` (no NAS, Controle de Projetos): P + as iniciais do nome + `-DI` + ano + o número do
produto, ex.: `PAEL-DI261940`. A sigla pode ser trocada.
- **Criar e registrar** acrescenta a linha no catálogo (ITEM, TIPO PLACA, NOME, CLIENTE, MODELO, VÍNCULO) e cria o
  projeto com o nome do código.
- O projeto nasce com uma folha A4 no template da DIEletrons, com o carimbo preenchido: código, `SCH-DI…`, nome,
  quem iniciou e a data.
- O catálogo aberto no Excel não é gravado (o aviso pede para fechar). Antes de cada gravação fica uma cópia em
  `%TEMP%\NexoEletric-catalogo`. Só a linha nova muda no .xlsx.
- Pela IA: a skill nova `projeto-novo` manda perguntar quem iniciou e confirmar antes de registrar. A ferramenta
  `catalogo_previa` mostra o código e `projeto_criar {produto}` registra e cria.

**O menu da folha** (canto de cima à esquerda do Esquema, com a cara do menu do Gerber): as folhas
(nova/renomear/apagar), o formato, a orientação (Deitado/Em pé) e o template. Recolhe pela seta.
- **Carimbo…** abre todos os campos do template numa tabela, com o valor do projeto e o desta folha; o vazio mostra o
  que vai sair.
- **Remover template…** lista os templates da casa, cada um com o seu Remover.
- Só sobrou o template da DIEletrons: os do Altium saíram da lista.
- **O carimbo se completa sozinho:**
  - o formato vem da folha;
  - no projeto com código no nome (`PDCD-DI261939 (PTYPE)`), o código e o `SCH-DI…` saem do nome;
  - escolher o template busca o nome da placa e o cliente no catálogo.

**O painel Configurações ficou enxuto:** os ícones da vista em grade, sem os textos de ajuda. **Enviar lista** (o
Enviar para o Odoo) e **Trocar acervo** (o Converter para o almoxarifado) ficam lado a lado, e o **Salvar** no canto
de baixo à esquerda (o que falta salvar vai no título do botão).

**MCP no canto de cima à direita:** o botão novo ao lado do "IA" lista todas as skills da casa (os processos que a IA
segue) e abre o texto de cada uma.

## 1.68.0 — 2026-11-04

**O "Enviar pra JLC" entra na conta primeiro e mostra as camadas antes do carrinho.** A ordem agora é:
1. **A conta.** O envio confere a conta da JLC antes de subir o Gerber. Sem ela, entra pelo "Sign In" do orçamento,
   com a conta da configuração do hub. Sem conta na configuração, ou com captcha, a janela do IntegrateBrowser
   aparece e espera você entrar. Pelo MCP, o `jlc_enviar` para com `etapa: "login"` antes de subir nada.
2. **O Gerber.** O .zip sobe e a JLC diz quantas camadas leu, que o envio confere contra as da placa.
3. **Camadas e quantidade** marcadas no orçamento.
4. **O visualizador de camadas da JLC** (o Gerber Viewer, na aba Layers) abre numa janela nova do IntegrateBrowser.
   Ela fica aberta para você conferir cada camada, mesmo depois que a guia do envio fecha. Precisa do Nexo Hub
   2.24.0; num Hub mais velho ele abre numa guia da sua janela.
5. **Só então o SAVE TO CART.** Se a sessão cair no meio e a JLC pedir a conta ali, o envio entra e sobe o Gerber de
   novo, como antes.

Medido na página da JLC em 2026-11-04: o Gerber Viewer só abre com a conta. O `jlc_login` do MCP também entra pelo
"Sign In" do orçamento.

## 1.67.0 — 2026-11-04

**O componente local se apaga pela lista, e o modal ganha a cara do "Trocar componente".**
- **Apagar:** o clique direito num componente criado localmente abre "Editar componente…" e "Apagar componente
  local…". O apagar confirma numa caixa no tema, sem abrir a ficha. Antes, o único caminho era abrir a ficha pela
  tag, e a ficha não abre sem o Nexo Hub conectado.
- **Família e encapsulamento** abrem a lista do que já existe enquanto se digita: o que está na biblioteca, com
  quantos componentes usam, e o que está no cadastro do Odoo. O "DIP8" de um componente que já existe aparece como
  opção. Setas e Enter escolhem, e o campo continua aceitando um valor novo. O `/api/locais/opcoes` traz
  `familias` e `encapsulamentos`.
- **O modal:** fundo preto (o da página), a 14 px das bordas da janela e com o cabeçalho do "Trocar componente". Os
  quadros do símbolo e do footprint e as miniaturas da lista ficaram maiores.
- **Fechar:** clicar fora não fecha mais o modal; só o × (ou o Esc).

## 1.66.0 — 2026-11-04

**O componente novo nasce num modal, e a lista da Biblioteca fica limpa.**
- **A lista:** saíram os botões Tudo, Com saldo, Zerados e Sem footprint, e os números do resumo (símbolos, valores,
  itens do Odoo, peças). O recorte agora se digita na busca, junto com o texto: "sem footprint", "com saldo",
  "zerados" e "criado local" ("sem footprint capacitor"). A data da sincronização foi para o fim da faixa das
  sub-abas. Fica só o aviso de novidades da última sincronização, quando há.
- **O botão:** um ícone de CI com um + ao lado da busca abre o modal "Novo componente". A sub-aba "Componentes
  novos" (1.65.0) saiu.
- **O modal, em etapas,** com a troca de tela em vinheta: as bordas escurecem e o conteúdo desliza para o lado.
  1. **Essencial (obrigatório):** nome, MPN, encapsulamento, pinos e o link (datasheet ou página do produto).
  2. **Ficha do Odoo:** família, montagem, fabricante, designator, valor, subtipo, polaridade e os atributos que a
     família pede, pelas regras do Odoo.
  3. **Símbolo e footprint:** dois quadros com o desenho de cada um e, embaixo, a lista com busca por nome e a
     miniatura de cada opção. Os símbolos com o número de pinos certo e os footprints parecidos com o
     encapsulamento vêm primeiro.
  4. **Revisar:** salvar, ou salvar e conferir no Odoo.
  As etapas 2 a 4 são opcionais ("Salvar agora").
- **Na biblioteca:** salvo, o componente entra na lista da esquerda, num grupo "criados localmente" no topo, com a
  tag "criado local", e fica selecionado. Clicar na tag reabre o modal para completar ou apagar. Ele perde a tag
  quando o almoxarifado do Odoo tiver a peça.
- **Sem símbolo escolhido,** o componente ganha um retângulo com os N pinos, para já ir para o esquema. Mudar os
  pinos refaz o retângulo; a pinagem desse genérico não vai para o Odoo.
- **Servidor:** a rota `POST /api/locais/desenhos` dá a geometria das miniaturas.

## 1.65.0 — 2026-11-04

**Componentes novos:** a peça que o almoxarifado do Odoo ainda não tem, criada no NexoEletric com a tag
**"criado localmente"**. O contrato é o `docs/prompt-nexoeletric-componente-novo.md` (módulo `di_lista_altium`
19.0.9.0.0).
- **A área (Biblioteca › Componentes novos):**
  - lista dos componentes criados localmente, com a situação de cada um: incompleto, não conferido, com faltas ou
    pronto para o Odoo;
  - a ficha completa do contrato: família, montagem, encapsulamento, MPN, fabricante, subtipo, valor, vias,
    polaridade, os atributos que a família pede, pinos, pinagem e designator;
  - o símbolo (da Biblioteca de símbolos, da SchLib ou de uma família do almoxarifado), o footprint, o datasheet e os
    links.
- **O formulário se monta pelo Odoo:** as listas fechadas, os encapsulamentos, os subtipos e o perfil da família vêm
  do próprio Odoo, sem nada cravado aqui. Sem o Odoo, os campos ficam livres.
- **Conferir no Odoo:** o botão "Salvar e conferir no Odoo" é o `di_confere_lista` (ensaio, não grava nada lá). Ele
  mostra pronto, faltas, erros e o nome que a peça vai ter. A pinagem sai sozinha dos pinos do símbolo.
- **No esquema:** o componente local aparece no "Adicionar componentes", com a tag, num acervo próprio e na família
  dele. Coloca-se como qualquer peça; o params leva `LocalId=Ln`. A ficha da vista Esquema também mostra a tag.
- **No "Enviar para o Odoo":** a linha do componente local vai com a ficha completa, no bloco `componente`, sem
  `product_id`. O modal diz se a ficha está pronta (o almoxarifado cria com um clique) ou o que falta.
- **A integração:** depois que o almoxarifado cria a peça, o sincronismo seguinte a traz com o mesmo MPN e
  encapsulamento.
  - O componente local é integrado: perde a tag, sai do "Adicionar componentes" e a linha passa a ir com o
    `product_id`, também nos esquemas que já o usavam.
  - O "Odoo ↗" dele passa a abrir a ficha.
- **Onde mora:** `Libs/almox-locais.js`, no formato dos acervos do almoxarifado. Ele vai e volta com o NexoBD, como a
  biblioteca, e está no `.gitignore`. O servidor é o `tools/rotas/componentes_locais.py` (rotas `/api/locais/*`).
- **MCP:**
  - ferramentas `local_regras`, `local_opcoes`, `local_listar`, `local_ler`, `local_criar`, `local_editar`,
    `local_conferir`, `local_apagar` e `local_integrar`;
  - a skill `componente-novo`: ler o link ou o datasheet, perguntar as regras ao Odoo, atribuir o símbolo e o
    footprint (criando com `sym_gerar`/`fp_pacote` se faltar), conferir e colocar no esquema;
  - o `almox_buscar` também acha os criados localmente, com a tag.
- **Para o Odoo:** `docs/prompt-odoo-verificar-recebimento-nexoeletric.md`, a instrução para a IA do Odoo conferir o
  recebimento da lista com as fotos da placa e das peças novas.
- Testes: `tests/test_componentes_locais.py`.

## 1.64.2 — 2026-11-04

**Arrastar o projeto do Altium para a janela abre de verdade.** A 1.64.1 consertou o Arquivo › Abrir, mas o arrastar
continuou sem abrir. Com o tratador de arraste da casca Rust ligado, o wry desliga o soltar de arquivos dentro da
página (`SetAllowExternalDrop(false)`; o retorno do tratador é ignorado no Windows). A página nunca recebia o "soltar":
só o Rust recebia os caminhos, e apenas os guardava. A espera da 1.64.1 supunha que a página recebia o soltar.

- Agora o Rust chama a página: `__nexoSoltou(caminhos)` abre direto pelos caminhos (basta o `.PrjPcb`), e
  `__nexoArrasto(true/false)` mostra e esconde a faixa "Solte o projeto do Altium…" com o arquivo sobre a janela.
- `HubAltiumAbrir.abre({arquivos})` aceita caminhos (texto) além de arquivos.
- Testes: `tests/test-altium-abrir.js` (8 casos) e o teste novo do `nexoeletric-web`.

## 1.64.1 — 2026-11-04

**Abrir projeto do Altium volta a funcionar na janela Rust.** Pelo Arquivo › Abrir e arrastando o `.PrjPcb`, nada
abria. Para abrir só pelo `.PrjPcb`, a página precisa do caminho do arquivo no disco: com ele, o servidor acha as
folhas e a placa. Na janela Electron o preload dava esse caminho; na janela Rust (1.54.0+) ele não chegava.

- **Arquivo › Abrir:** era a janela de arquivos do navegador (`<input type=file>`), que nunca entrega o caminho.
  Agora é a janela de arquivos do Windows (`eletricApp.escolheArquivos`, pelo `rfd` na casca Rust), com o caminho
  completo: basta o `.PrjPcb`, como no Electron.
- **Arrastar:** a casca Rust recebe o caminho do arquivo solto e o repassa à página um instante depois do soltar. A
  página perguntava na hora e não achava. Agora ela espera até 1,5 s pelo caminho (`eletricApp.esperaCaminhos`) e
  só aceita o de um arraste recente.
- No navegador (sem o app) continua igual: escolha o `.PrjPcb` junto com as folhas e a placa.
- Testes: `tests/test-altium-abrir.js` (a página e a ponte de verdade) e o teste novo do `nexoeletric-web`.

## 1.64.0 — 2026-11-04

**O componente posto depois do Altium pega o 3D do irmão de mesmo footprint.** No PLACAB_DI251885B o IC16
(TMCS1123A1AQDVGR, criado por `comp_add`) aparecia como caixa genérica no 3D, ao lado do IC1 e do IC12–IC14 (o mesmo
footprint, vindos do Altium) com o corpo certo. O `board3d.js` só tem corpo para quem veio do Altium, o footprint
no editor do hub não tinha corpo e a PcbLib 3D da casa não tinha o footprint.

- Agora, sem corpo próprio, o componente usa o corpo de um irmão da mesma placa com o mesmo footprint
  (`HubPcb3dModelo.corpos`), levado da pose do irmão para a dele: giro e troca de face juntos.
- A ordem fica: corpo do editor do hub › corpo próprio do `board3d.js` › irmão de mesmo footprint › PcbLib 3D da
  casa › caixa genérica.
- Vale na vista 3D, nas fotos da placa e no pacote que vai para o NexoCAD.
- Teste: `tests/test-pcb3d-irmao.js`.

## 1.63.0 — 2026-11-04

**O mesmo STEP não vira dois itens na biblioteca.** O corpo 3D de uma placa enviada ao Nexo Hub tem a chave
`projeto:<projeto>/3d/<n>.step`, diferente em cada projeto (até `MIRBC_DI251885b` e `MIRBC_DI251885B` contavam como
dois), e quem publica os modelos (`garanteModelo` do `mcp/lib/nexohub-sync.js` e `garante_modelo` do
`tools/rotas/nexocad.py`) só procurava pela chave: cada placa criava um item novo com o MESMO arquivo. Medido em
2026-11-04: 144 itens a mais em 67 grupos em Eletrônicos › Modelos 3D da PcbLib (o "step_temp" do CAP EL SMD 12.7mm
D10 cinco vezes).

- Sem item na chave, o STEP de mesmo sha256 que já está no Nexo Hub é reaproveitado: a chave nova passa a apontar
  para o item que existe e os footprints se juntam nele. Só cria item quando o arquivo é outro.
- Vale também com dois envios ao mesmo tempo (os lotes paralelos do sincronizador criam um item só).
- Os repetidos que já existem continuam lá (as placas publicadas apontam para eles).
- Testes: `tests/test-modelo-mesmo-step.js` e o caso novo do `tests/test_nexocad_rotas.py`.

## 1.62.0 — 2026-11-03

**Power port do tamanho do desenho, e troca de símbolo sem pino solto.**

- **Power port (vista Esquema):** a caixa de clique e de seleção era um quadrado de 300×300 mil centrado na âncora
  (e o clique, um raio de 140 mil). Num power encostado num componente (o 0VCC em cima do C25), metade da caixa
  cobria o corpo dele: a seleção virava um quadrado gigante e o clique no componente pegava o power. Agora a
  caixa é o desenho: a haste, o símbolo e o nome, só para o lado da rotação (`HubDraw.powerBBox`, a mesma
  geometria do `drawPowerPort`), nada atrás da âncora.
- **Troca de símbolo que muda a distância entre os pinos** (Trocar componente, Converter para o almoxarifado,
  lista do Odoo): o "CAP [PTH] 1-2" tem os pinos a ±100 mil e o capacitor do almoxarifado a ±150. Nenhum
  deslocamento devolve os dois pinos ao lugar; o encaixe religava um e o outro ficava solto sem aviso (C15, C1
  e C8 do PBIDP-DI261944). Agora, como o arrasto do Altium, o que estava ligado no pino antigo vai até o pino
  novo:
  - a ponta do fio estica (no mesmo eixo só anda; fora dele ganha um trecho, em L se preciso);
  - o fio que passava pelo pino (T) ou o pino de outro componente encostado ganham um fio novo;
  - o power, o rótulo, a porta ou o No ERC no pino andam junto.
  Um aviso diz quantas ligações foram levadas em cada componente.
- Testes: `tests/test-power-bbox.js` e `tests/test-estica-troca.js`.

## 1.61.0 — 2026-11-03

**O componente do designator acende no arraste.** Clicar e arrastar o designator (ou o comment) de um componente na
vista PCB realça o componente dono dele — a caixa com o véu e o contorno tracejado da seleção —, por baixo da prévia
do texto, até soltar. Assim fica claro de quem é o nome que está andando, mesmo com a placa cheia.

- Vale para o designator e o comment, em qualquer face, também para o componente criado por `comp_add`.
- Texto livre e texto do footprint não acendem nada; o componente que anda no mesmo arraste (selecionado junto) já
  aparece na mão e não ganha um segundo realce.
- Teste: `tests/test-pcb-dono-designator.js`.

## 1.60.0 — 2026-11-03

**Imagem e texto viram serigrafia.** Um logo ou um texto em qualquer fonte TrueType/OpenType vai direto para a
serigrafia de cima ou de baixo. Cada letra ou mancha vira uma região sólida (`region_add`) com o miolo vazado em
`holes` (1.59.0): o "o", o "e" e o furo do logo saem certos na tela, na janela Rust, no Gerber, no DRC e no PDF.

- **Na vista PCB:** um botão novo na barra (logo depois do Texto) e o item Place » "Imagem ou texto → serigrafia…".
  Os dois abrem um diálogo com duas abas.
  - **Imagem:** PNG, JPG, SVG ou qualquer imagem que o navegador abra, escolhida, arrastada ou colada com Ctrl+V.
    Controles: limiar, inverter, transparente como fundo e a largura ou a altura em mm.
  - **Texto:** qualquer texto, com quebra de linha, numa fonte do Windows (Arial, Calibri, Segoe UI, Times New
    Roman, Consolas, Verdana, Tahoma ou outra instalada). Controles: negrito, itálico e a altura da maiúscula em mm.
  - **Nas duas abas:** face (Bottom Overlay sai espelhado), giro e simplificação.
  - **Prévia:** mostra as regiões com os miolos, o tamanho, os vértices e os avisos.
  - **Colocar:** as regiões entram no centro da vista já selecionadas, para arrastar e girar; o Ctrl+Z desfaz.
    Acima de 2000 vértices, o hub pergunta antes.
- **Pela IA (MCP):** `serigrafia_imagem` (PNG) e `serigrafia_texto` (`h` = altura da maiúscula, Arial por padrão ou
  outra fonte do Windows / um `.ttf`). Elas simulam por padrão, mostram a imagem do lugar e conferem as regras da
  casa (pad, via, trilha, furo, borda) antes de gravar. `substituir:true` refaz no lugar sem duplicar.
- **O motor** (`hub-silkgen.js`, o mesmo na vista e no MCP):
  - contorna a imagem pelo limiar de claro e escuro (o fundo transparente não imprime) e escala para a medida pedida;
  - simplifica o contorno sem deixar lado cruzado;
  - avisa onde o traço ou o vão fica abaixo de 0,15 mm, que a serigrafia não imprime;
  - lê as fontes pelo opentype.js 1.3.4 (MIT, em `vendor/`); o PNG é lido sem dependência nova (`mcp/lib/png.js`).
- Testes: `tests/test-silkgen.js`, `tests/test-mcp-silkgen.js`, `tests/test-pcbsilkgen.js` e
  `tests/smoke-serigrafia.js` (navegador headless).

## 1.59.1 — 2026-11-03

- **Corrigido: o "Odoo ↗" dos componentes não abria a ficha no Odoo** (nem outros links que abrem numa janela
  nova).
  - **Causa:** desde a janela Rust (1.54.0), todo link com `target=_blank` ou `window.open` era recusado em
    silêncio. Sem tratador, o WebView2 do `wry` nega a janela nova.
  - **Agora vale a regra que o Electron tinha:**
    - página do próprio hub abre numa janela do app;
    - link de fora (http, https, mailto), como a ficha do produto no Odoo, abre no navegador padrão do Windows;
    - o resto (`file:`, `javascript:`, endereço com espaço ou aspas) não abre.
  - Teste novo em `rust/crates/nexoeletric-web` (`links_novos_como_o_electron`).

## 1.59.0 — 2026-11-03

Três itens do relato da serigrafia (MIRBC).

- **ECO: trocar o footprint pelo esquema não religa mais a placa calado.**
  - **Nets e designator:** em "Design » Atualizar PCB", o componente com footprint novo volta no mesmo lugar, com as
    nets que os pads têm hoje na placa (pelo nome do pad). O designator fica onde estava, com a altura, o traço, o
    giro e o "oculto" de antes.
  - **Onde o esquema discorda:** pad numa net diferente, pad que o esquema deixa sem ligação ou pad que só o
    footprint novo tem. A diferença aparece como uma ação própria em "Adicionar/Remover pinos", marcada. Aceitar
    tudo deixa a placa como o esquema; desmarcar mantém a net da placa.
  - **A linha da troca:** diz quantos pads mudam de net (ex.: "RES 1206 → RES 0805 · 1 pad muda de net: 2 GND→VCC")
    e avisa quando um pad do footprint antigo some, com a net que ele leva.
  - **No MCP:** o `eco_aplicar` e o `eco_comparar` trazem o mesmo resumo em `trocas_footprint`.
  - **Corrigido junto:** a troca de um componente de símbolo desconhecido gravava o nome de prévia da net do esquema
    (`NetR1_1`) no lugar da net da placa.
- **Fonte da serigrafia com minúsculas de verdade.**
  - **O que acontecia:** só o n, o u e o x tinham glifo próprio (para "nF"/"uF"), e o resto caía na maiúscula:
    "dieletrons.com" saía "DIELETROnS.COM".
  - **Agora:** as 26 minúsculas vêm da newstroke do KiCad (CC0, a mesma família dos glifos que já existiam). Os
    antigos ficaram idênticos.
  - **O complemento na grade do Altium:** o "+" de polaridade, X, Z, * = < > ? % ( ) : passou do gerador de Gerber
    para a própria fonte.
  - **Onde vale:** tela, Gerber, gravação a laser, BOM, PDF e a janela Rust desenham os mesmos glifos. O laser e o
    BOM não põem mais uma caixa no lugar do "+".
- **Região com furo.**
  - **A op:** a `region_add` aceita `holes`, os furos, na mesma linha do `pts`. Letras como "o", "e" e "D" na
    serigrafia, um logo vazado ou um anel de cobre viram uma região só, sem dividir em pedaços.
  - **Onde aparece:** na tela, na janela Rust, no Gerber (o furo sai claro), no DRC e no PDF.
  - **Na vista PCB:** a região com furo, inclusive a que veio do Altium, agora se move, gira, espelha, estica, copia e
    cola com os furos junto. Antes aparecia o aviso "o region_add não leva furo".
  - **O motor recusa:** furo fora da região, encostado no contorno, sobreposto a outro furo, dentro de outro furo ou
    num recorte.
  - **No Altium:** o `ApplyChanges` grava os furos (novo no bloco APOSTAS: `GravaFuros`, com `GeometricPolygon` e
    `AddContourIsHole`, ainda não medidos) e confere na releitura. Se o Altium recusar, a linha sai como FALHA e
    nada é criado.
- Testes: `tests/test-eco-troca-fp.js`, `tests/test-regiao-furo.js` e `tests/test-font.js` (minúsculas e a tabela
  do Rust igual à do hub).

## 1.58.1 — 2026-11-03

- "Enviar pra JLC": **com o Gerber no carrinho, o IntegrateBrowser fecha sozinho.**
  - **Quando fecha:** o envio fecha a guia dele quando o carrinho é reconhecido e o arquivo está lá. Se era a única
    guia da janela, o IntegrateBrowser fecha junto; se você tinha outras guias abertas, só a do envio sai.
  - **Quando fica aberta:** carrinho não reconhecido ou sem o arquivo, para você conferir.
  - **No aviso final:** diz que o navegador fechou e que o pagamento é no carrinho da JLC (cart.jlcpcb.com).
  - **Pelo MCP:** as ferramentas `jlc_*` (a IA) não fecham nada.

## 1.58.0 — 2026-11-03

**Não montar (DNP)**, no esquema e na PCB. Até aqui ele não existia em lugar nenhum: o MIRBC tinha `DNP=1` e
`Montagem=NAO MONTAR` nos `params` de J5, J6 e J7 (uma sessão de IA gravou assim), e nada lia isso.

- **A marca mora no esquema** (`schematic.js`, `"dnp":true` no item `comp`), e vale para o componente inteiro:
  todas as partes. A marca antiga nos `params` (`DNP=1`, `Montagem=NAO MONTAR`) vale igual, e desmarcar a tira.
  O componente continua na folha, na placa e no ECO (footprint e nets ficam).
- **Vista Esquema:** a ficha do componente tem a caixa "Não montar", e a folha desenha um X vermelho por cima do
  corpo, como o Not Fitted do Altium. O X sai também nas miniaturas e no PDF do esquema.
- **Vista PCB:** o mesmo X por cima do componente. A ficha do componente tem a caixa "Não montar", que grava no
  `schematic.js` (a mesma marca, uma fonte só). A vista relê a marca quando o esquema muda no disco, sem recarregar.
  O X é desenhado por cima da placa também na janela Rust.
- **Fica fora de:**
  - **lista do Odoo:** o componente não vai, e o aviso no topo diz quais ficaram de fora e como pedir de novo;
  - **BOM da bancada** (o do hub e o do link): o componente vai para um grupo próprio no fim da lista, com
    "NÃO MONTAR", quantidade 0 e sem o visto, e a conta de cima diz quantos são;
  - **CSV da Neoden:** sai do CSV e a linha mostra "não montar", sem deixar incluir.
- **MCP:**
  - `sch_nao_montar {refs, dnp}` marca ou desmarca todas as partes;
  - `sch_componentes` diz `dnp: true`;
  - `sch_editar` recusa `dnp` que não é booleano;
  - `bom_listar` deixa os marcados de fora e os devolve em `nao_montar`.
- **No Altium:** o `BuildSchematic` ignora o campo; a variante Not Fitted continua sendo feita à mão lá.
- Testes: `tests/test-dnp.js`, `tests/test-mcp-dnp.js` e `test_nao_montar_fica_fora_da_lista` em
  `tests/test_odoolista.py`.

## 1.57.2 — 2026-11-03

- **A conta da JLCPCB na configuração do hub.**
  - **Onde:** Configurações › Projeto, logo abaixo da credencial do Odoo, um bloco "Conta da JLCPCB (Enviar pra
    JLC)" com e-mail e senha (Gravar e Apagar senha).
  - **No envio:** quando a JLC pede o login no meio do "Enviar pra JLC", o motor preenche e entra sozinho, sobe o
    Gerber de novo e vai até o carrinho. Captcha ou senha recusada: mostra a janela do navegador e espera você
    entrar, como antes.
  - **Onde fica:** em `.hub-jlc.json`, na raiz do workspace. O ponto no nome tira o arquivo do HTTP, no hub Python
    e no Rust, e ele está no `.gitignore`.
  - **Cifra:** a senha vai cifrada pela DPAPI do Windows, e só o mesmo usuário, nesta máquina, a abre.
  - **Segurança:** a senha nunca volta pela tela nem pela rota (só "tem senha"). Vai para o motor pela entrada
    padrão e não fica no estado do envio. De outra máquina, a gravação é recusada.
- Testes: `tests/test_jlc_rotas.py` (a conta, a cifra, a senha que não volta) e `tests/test-jlc.js` (o login
  automático no meio do envio e a senha errada).

## 1.57.1 — 2026-11-03

- **Corrigido: o zoom numa trilha travava a vista PCB.**
  - **Causa:** o tracejado é medido em pixels de tela. Com zoom alto, uma trilha de 40 mm vira 120.000 px, e o
    Chrome gerava ~15.000 traços só para ela, inclusive para o que estava fora da tela.
  - **Medido na CBM-DI251876 (3.595 linhas no `changes.js`):** com zoom alto, cada quadro levava até 2 s. As
    marcações das mudanças custavam ~1,9 s, e os contornos dos planos e o keepout, o resto.
  - **Agora:** com zoom, o tracejado é montado só com a parte da geometria que aparece na tela, e o arco vira
    polilinha só nessa parte. Vale para as marcações das mudanças, o contorno dos planos, a hachura do "sem plano",
    o keepout e o realce da seleção.
  - **Resultado:** 27–45 ms por quadro em qualquer zoom. Com a placa inteira à vista, nada muda.
- Teste novo: `tests/test-pcb-recorte.js`.

## 1.57.0 — 2026-11-03

Correções de um relato de uma sessão de IA que montou a serigrafia de uma placa (MIRBC).

- **Os recortes que vieram do Altium agora saem.**
  - **O que acontecia:** no MIRBC, 12 recortes de polígono (Polygon Pour Cutout) das Mid1/Mid2 ficaram fora da placa,
    na posição antiga do contorno. A vista PCB os mostrava, mas o Delete respondia "apague no Altium".
  - **Agora:** Delete no recorte (Board Cutout ou recorte de polígono do `board.js`) grava um `region_del` com os
    `orig_*` dele. O `pcb_apagar` do MCP aceita o id `k…`. Vale no motor do hub e no da janela Rust. O recorte de
    componente continua andando com ele. No Altium, o `ApplyChanges` recusa a linha, porque lá a region não é sólida:
    apague o recorte lá também.
- **Designator e comment ocultos (o Show Designator / Show Comment do Altium).**
  - **A op:** `designator_move` e `comment_move` aceitam `"hidden":true` para ocultar e `false` para mostrar de novo;
    o `comp_add` aceita `des_hidden`. O texto continua no componente, mas some da tela, do Gerber, do PDF e do DRC.
  - **No Altium:** o `ApplyChanges` liga ou desliga o `NameOn`/`CommentOn` (novo no bloco APOSTAS: se o Altium
    recusar o nome, apague o `MostraTexto`).
  - **Na vista PCB:**
    - Delete num designator ou comment o oculta, em vez de dizer "texto do componente";
    - a ficha do componente ganhou as caixas Show Designator e Show Comment;
    - o texto do footprint continua preso ao componente.
- **Tamanho do designator pela edição de texto.**
  - **No MCP:** o `pcb_editar` num designator ou comment (id `x…`) manda `x`, `y`, `h`, `w`, `rot` e `hidden` para
    `designator_move`/`comment_move`, e `text` para `comp_attr` (renomeia o componente ou troca o comment). Antes ia
    como `text_edit`, que o motor recusa para texto de componente.
  - **Na vista PCB:** a ficha do designator ganhou o traço (Stroke) ao lado da altura. O comment agora se arrasta e se
    redimensiona como o designator (o `comment_move` já existia e a vista não o usava).
  - **No Altium:** o `comment_move` passa a gravar o traço também.
- **Campo que ninguém lê não some mais calado.** As ops do MCP com campo que a op não tem (o `oculto` que a IA mandou
  no `designator_move`) respondem em `campos_ignorados`, com a linha e o campo. A conferência cobre as ops de campos
  fechados no AI-GUIDE.
- **O posicionador de designadores não empilha rótulos.**
  - **O que acontecia:** o `serigrafia_posicionar` ignorava, desde o começo, o designator velho de todo componente que
    ia andar. Quando um deles não achava lugar, o texto velho dele ficava na placa, e os rótulos já postos podiam estar
    em cima dele.
  - **Agora:** depois de cada volta, o rótulo posto que encosta no texto velho de uma falha procura outro lugar (e,
    sem lugar, vira falha também). A resposta avisa quantos foram refeitos. No MIRBC, 1 dos 25 rótulos postos caía
    em cima de um dos 9 que ficaram.
- **`regras_casa_verificar` com filtro:** `area {x1, y1, x2, y2}` e `refs` devolvem só as violações daquela área ou
  daqueles componentes (o pad, o designator ou o desenho deles, dos dois lados da violação). A placa inteira continua
  sendo conferida, e a resposta repete o filtro.
- Testes: `tests/test-recorte-apagar.js`, `tests/test-designator-oculto.js` e `tests/test-mcp-designator.js`.

## 1.56.3 — 2026-11-03

- Vista PCB › Grade: **o passo anda junto com a unidade.**
  - **Na troca:** trocar a unidade (o botão ⇅, ou a tecla) leva o passo para o equivalente mais perto na outra:
    5 mil ↔ 0,1 mm, 10 mil ↔ 0,25 mm, 20 mil ↔ 0,5 mm, 50 mil ↔ 1 mm e 100 mil ↔ 2,5 mm.
  - **Na lista:** só aparecem os passos da unidade em uso.
  - **Ao abrir:** um par misturado gravado antes (mm com 5 mil) abre já alinhado.

## 1.56.2 — 2026-11-03

- **Corrigido: o "Enviar pra JLC" do Gerber não abria mais o site.**
  - **Causa:** o envio roda o motor (`mcp/lib/jlc.js`) com o exe do app como Node. Desde a 1.54.0, o exe anotado no
    `~/.nexoeletric/session.json` é o da janela Rust (`resources\rust\NexoEletric.exe`), que não é Node e ignora os
    argumentos. O motor nunca rodava.
  - **Agora:** o `tools/rotas/jlc.py` só usa um exe que seja Electron. A partir da janela Rust, chega no
    `NexoEletric.exe` da mesma instalação; depois tenta o instalado e o `node` do PATH.
  - Além disso, o app passa `NEXOELETRIC_NODE` (o próprio Electron) para a janela Rust, e o Python dela já recebe o
    Node certo.

## 1.56.1 — 2026-11-03

- Propriedades da placa › Grade: o passo é uma lista, e do lado dela fica um botão só com a unidade e o ícone de
  troca (⇅). Clicar troca de mm para mil e de volta. Antes eram dois botões, "mm" e "mil".

## 1.56.0 — 2026-11-03

As Propriedades da placa (vista PCB, nada selecionado) enxutas e em grade.
- **Sem as notas:** as notas embaixo de cada grupo saíram. A explicação de cada controle aparece ao passar o mouse.
- **Quatro grupos em vez de seis:**
  - **Edição:** o cadeado (Só leitura / Editando, com a tecla) e a Fixação nas marcações, lado a lado.
  - **Grade:** Passo e Unidade lado a lado, e o Snap embaixo.
  - **Vista:** os botões de ícone, e embaixo Componentes 3D, 3D de antemão e Solda embaixo. Esse grupo juntou o
    antigo Desempenho.
  - **Saídas:** Gerber salvo e PCB List.
- **Ladrilhos de duas colunas:** tudo em ladrilhos, no lugar da lista de linhas.
- **Sem repetição:** a caixa "Marcações das mudanças" saiu, porque o botão do olho em Vista faz o mesmo.

## 1.55.0 — 2026-11-03

O render da placa, o valor no esquema e o PDF do esquema.
- **Gerar render** (vista PCB › Arquivo, também em Exportar e no menu do botão direito): tira sozinho as duas fotos
  3D da placa, a **montada** (isométrica, com os componentes) e a **virgem** (de frente, só a placa). Grava em
  `Projects/<p>/Renders/` (rota nova `POST /api/render`), igual ao `pcb_render_3d` do MCP.
- **Enviar para o Odoo mostra as fotos**: as duas aparecem grandes no modal, e o clique amplia. Há um botão "Gerar
  render" (ou "Refazer render") que tira as fotos ali mesmo, numa vista PCB escondida, sem sair do modal.
- **A placa no NexoBD tem a foto**: a placa montada vira a miniatura da placa na biblioteca (papel `thumb`) e a placa
  virgem vai junto (papel `virgem`). Foto nova publica a placa de novo: a sincronia vigia `Renders/`, e o "Enviar
  placa ao NexoCAD" também leva as fotos. No catálogo do NexoBD 1.11.0 a placa abre em 3D e exporta STEP, STL e
  Parasolid.
- **O valor dos componentes aparece no esquema** (olho novo "Ω" na seção Vista, ligado por padrão), no lugar do
  comment, onde o Altium o põe. O valor vem nesta ordem:
  - o `Value` do componente (o do almoxarifado: 10K, 1uF);
  - senão o comment, quando é curto (100uF 16V, 1N4007, BC337, LM2575-5);
  - a fórmula do Altium é resolvida: `=Value + ' - ' + Potência + ' - ' + Tolerancia` vira "1K - 1/4W - 1%".

  Conector, jumper e ponto de teste não mostram valor: o comment deles é descrição. A ficha do componente mostra o
  campo Valor. O olho do comment continua mostrando o comment inteiro, agora com a fórmula resolvida.
- **Exportar PDF do esquema** (vista Esquema › Arquivo, ou Smart PDF): uma página por folha, no tamanho da folha,
  **vetorial** e com o texto selecionável. É o mesmo desenho da tela (`hub-schpdf.js`: um contexto 2D que grava no
  `hub-pdfwriter.js`), em papel branco. Baixa o arquivo e grava em `Projects/<p>/PDF/SCH - <p>.pdf`. A rota `/api/pdf`
  passa a aceitar projeto só de esquema.
- **Exportar PDF do layout** fica à vista no Arquivo da vista PCB (o "LO -" de sempre, que antes só estava em
  Exportar › PDF).
- Janela Rust: gravar em `Renders/` não recarrega mais a vista que acabou de fotografar.
- Testes: `tests/test_render_api.py`, `tests/test-schpdf.js`, e as fotos em `tests/test-nexohub-sync.js` e
  `tests/test_nexocad_rotas.py`.

## 1.54.1 — 2026-10-30

Duas correções na vista 3D da placa.
- **O 3D da biblioteca encaixa nos pads do componente.** Um footprint pode ter o mesmo nome na biblioteca do hub
  e na placa, mas com outra origem ou outro giro. O corpo 3D da biblioteca era posto na origem da biblioteca e saía
  deslocado dos pads. Exemplo: o ESP32-WROOM-32D do MIRBC_DI251885 e da PLACAB_DI251885B ficava 2,4 mm fora. Agora
  o corpo vai pelo encaixe dos pads da biblioteca nos pads do componente, casados pelo nome.
  - Se o desenho dos pads for diferente, ou houver pads de menos para casar, o corpo fica como antes.
  - O corpo ajustado sai com `ajuste: {pads, dx, dy, giro}`.
  - Também acerta, no PRJ-DI161455, resistores e diodos girados 90°/180°/270° e o IDC20RM 1,27 mm fora.
- **A placa não sai mais preta no 3D.** Na PBIDP-DI261944, a face da placa (máscara, cobre, serigrafia) ficava
  preta conforme o zoom, o tamanho da janela e a escala do Windows (a 125% aparecia). Também no Real View.
  - A causa: a textura sRGB enviada de um `<canvas>` acelerado (na GPU) gera as versões de longe (os mipmaps)
    pretas em vários tamanhos no Chromium/ANGLE. Medido no Edge 156 em WebGL2 puro: 3725×3463, 3433×3384,
    3000×3000 e 4000×3000 saem pretos; 4096×3000 e 2500×1500 saem certos.
  - A correção: os canvases da face e os mapas do Real View nascem na memória (`willReadFrequently`), que sobe certo
    em todos os tamanhos medidos.
  - As linhas que a janela Rust troca (remendo `face-na-memoria`) continuam iguais.
- Testes: `tests/test-pcb3d-origem.js` (o encaixe no Top e no Bottom, giro, forma diferente) e
  `tests/test-pcb3d-face-cpu.mjs` (os canvases da face na memória e a âncora do remendo Rust intacta).

## 1.54.0 — 2026-10-30

A janela do NexoEletric agora é a da versão em Rust.
- **O mesmo atalho, o mesmo ícone, a janela nova.** Ao abrir o NexoEletric, a janela que aparece é a do
  NexoEletric em Rust: WebView2 do Windows, o servidor do hub em Rust e a vista PCB no WebGL com o núcleo Rust.
  Abre em ~0,1 s depois de preparar a pasta. O instalador, o `NexoEletric.exe`, o atalho, o registro no Windows e a
  publicação no NexoBD são os de sempre, então o Nexo Hub atualiza como antes. A janela agrupa na barra de tarefas
  com o atalho fixado.
- **O Electron vira o motor de fundo, sem janela**: pasta de trabalho, sincronia com o NexoBD (a primeira rodada
  corre enquanto a janela já está aberta; o vigia recarrega quando os arquivos chegam), biblioteca da rede,
  configurações, Conectar IA, Sobre e o runtime do MCP. Os itens de menu que a janela Rust ainda não tem abrem a
  tela do motor. Ao fechar a janela, o que foi salvo nos últimos segundos ainda sobe ao NexoBD antes de o app sair.
- **Se a janela Rust não abrir** nesta máquina (sem WebView2), a sessão segue na janela Electron de antes.
  `"casca": "electron"` no `settings.json` (ou `NEXOELETRIC_CASCA=electron`) volta a ela de propósito.
- **MCP com a janela Rust**:
  - `pcb_render_3d` funciona: o canal da vista ganhou a ação `render3d` e aceita respostas grandes;
  - `vista_screenshot` traz a placa desenhada no WebGL (antes só os contornos por cima);
  - o `session.json` diz a versão do app.
- **Configurações que exigem reiniciar** (porta, pasta) valem na próxima abertura: fechar a janela por baixo
  perderia uma edição não salva.
- Medido no teste com a janela Rust: a janela usa ~30 MB e o motor Electron ~240 MB. O Python só sobe quando
  uma rota que ficou nele é pedida.
- Testes: `electron/test/casca-rust.test.js` (o canal inteiro contra uma casca falsa: origem do hub, menu,
  focar, aviso, saída e a volta para a janela Electron).

## 1.53.0 — 2026-10-30

O símbolo da folha na troca de componente.
- **A troca pergunta quando o símbolo da folha é diferente do componente novo.** Vale para o "Converter para o
  almoxarifado" e para o "Trocar componente…" da ficha. Uma tela lista todos os componentes trocados assim, com o
  antes e o depois de cada um, e três escolhas:
  - **substituir o símbolo do componente**: o componente do almoxarifado passa a ter o símbolo da folha. Vale para
    todos os projetos que o usam;
  - **criar uma parte com o símbolo da folha**: o componente ganha uma parte nova com esse símbolo, e os
    designadores trocados usam essa parte. Os outros projetos continuam na parte 1;
  - **usar o símbolo do almoxarifado**: como a troca sempre fez.
  Há atalho "para todos", e o Trocar só libera com todas as linhas escolhidas.
- **Símbolo igual não pergunta**: a troca mantém o desenho. Se o componente já tem uma parte com o desenho da folha
  (a que um "criar parte" de antes fez), a troca usa essa parte direto.
- **Onde grava**: a biblioteca, pela rota do editor de símbolos (`/api/symbols/save-almox`: espelho, `.SchLib` da
  família e a proteção no ledger, que faz o desenho sobreviver ao sincronismo). Cada componente é gravado uma vez, com
  todas as decisões dele; a biblioteca se recarrega e só então a folha troca. Cancelar não muda nada. Multi-parte e
  componente fora do almoxarifado continuam como antes.
- **Gravação da biblioteca no Windows**: a troca do arquivo (espelho, ledger, resumo) tenta de novo quando o Windows
  responde "acesso negado". Isso acontecia quando a vista relia o `almox-basicos.js` no instante da gravação
  seguinte.
- Testes: `tests/test-simbolo-na-troca.js` (o que é o mesmo desenho, quando não pergunta, e as partes de cada escolha).

## 1.52.0 — 2026-10-30

Fotos 3D da placa para o cadastro no Odoo: a placa montada e a placa virgem.
- **MCP `pcb_render_3d`**: a IA tira duas fotos da placa:
  - **placa montada**: isométrica, com os componentes 3D;
  - **placa virgem**: de frente, só a placa (a fibra).
  Elas saem da vista PCB do app, em Real View e fundo branco, recortadas na placa. A vista 3D é própria e fica fora da
  tela: a câmera, a seleção e o Real View de quem está trabalhando não mudam, e a janela escondida também fotografa.
  Sem vista aberta, o MCP pede ao hub para abrir a aba PCB do projeto. As fotos ficam em
  `Projects/<p>/Renders/placa-montada.png` e `placa-virgem.png` (+ `renders.json`). Essa pasta fica fora do vigia,
  como o Gerber, e vai ao NexoBD com o projeto.
- **As fotos vão com a lista do Odoo**: o envio (`di_recebe_lista`) leva `imagem_montada` e `pcb_virgem`
  (`{quantidade: 1, imagem}`): a placa virgem vai declarada como item da montada. Só no envio: o ensaio não leva foto.
  Ficam fora da assinatura, então refazer a foto não invalida o ensaio. O modal "Enviar para o Odoo" mostra as
  miniaturas, ou "sem foto". O `di_lista_altium` 19.0.8 da produção ainda ignora as duas chaves; o que ele precisa
  fazer com elas está em `docs/prompt-altium-envio-de-lista.md`, seção 10.
- Canal MCP ↔ vista: a ação `render3d` responde com Promise, e o pedido que a vista já pegou espera até 240 s.
  A resposta do MCP aceita mais de uma imagem (`_imagens`).
- Testes: `tests/test_odoolista.py` (fotos e placa virgem só no envio, fora da assinatura) e
  `tests/test_mcp_rotas.py` (pedido pego espera mais).

## 1.51.1 — 2026-10-30

A tela preta que aparecia de vez em quando com o MCP em uso.
- **O "sem Nexo Hub" não dispara mais por uma demora**: o hub perguntava ao Nexo Hub a cada 5 s, esperava 3 s, e
  bastava **uma** resposta lenta para virar "sem Hub". Com isso, todas as páginas recarregavam vazias (a tela preta)
  e recarregavam de novo na volta, 15 s ou mais cada vez. A demora vinha do Hub e do NexoBD ocupados com o envio de
  revisão que cada gravação do MCP faz. Agora:
  - a espera é de 6 s, acima dos 4 s que o próprio Nexo Hub espera o NexoBD;
  - só vira "sem Hub" com 3 falhas seguidas (conferidas a cada 2 s);
  - volta na primeira resposta boa.
- **O aviso de "disco mudou" diz qual projeto mudou**: antes ele mandava só um número, e cada arquivo que a sincronia
  do NexoBD baixava de qualquer um dos projetos (ou cada gravação do MCP) fazia o hub reler e redesenhar o projeto
  aberto, e as vistas Esquema e PCB reconferirem os arquivos e a biblioteca. Agora:
  - o hub e as vistas ignoram o aviso de outro projeto;
  - a biblioteca (`Libs`) e o `projects.js` continuam valendo para todos;
  - aviso sem lista (o Nexo Hub conectou ou caiu) continua recarregando tudo.
- **Trocar de projeto fecha as vistas escondidas do anterior**: Esquema, PCB, Gerber e a placa do Neoden ficavam
  vivas, escondidas, com o projeto antigo e relendo o disco a cada aviso. Agora saem na troca e voltam quando a aba
  abrir.
- Testes: `tests/test_nexohub_gate.py` (falha passageira não derruba) e `tests/test_hubapi.py` (escopos do aviso).

## 1.51.0 — 2026-10-30

Mover levando as trilhas, teardrops que acompanham e a colisão medida pelo cobre (etapa C do relato da PCB1).
- **`pcb_mover` e `pcb_mover_lote` com `trilhas`**:
  - `"arrastar"`: a ponta da trilha que estava no pad vai junto com ele e a trilha estica, como o drag do Altium.
    Descer o ESP32 2 mm na PCB1 tinha soltado 30 trilhas.
  - `"apagar"`: tira as trilhas presas nos pads.
  - `"deixar"` (o padrão): a resposta diz como arrastar.
  - Mexer de novo na mesma peça edita as linhas `track_edit`, sem empilhar.
  - Trilha de pad SMD num componente que virou de lado não se arrasta e vai em `puladas`.
  - A região de cobre que estava em cima de uma trilha arrastada e não é teardrop reconhecido fica no lugar e vem em
    `regioes_que_ficaram`.
- **Teardrops do hub acompanham**: depois de qualquer gravação do MCP que mexe em trilha, via, arco, pad ou
  componente, o teardrop posto pelo hub (`teardrop do hub`) que perdeu a trilha ou a via sai sozinho, e volta onde o
  par pad/trilha ainda existe (`teardrops: {tirados, refeitos}` na resposta). Antes ficava na placa, barrava via nova e
  era preciso tirar e repor todos (`teardrop_remover` + `teardrop_aplicar`). O teardrop do `board.js` a placa já
  refazia.
- **Colisão pelo cobre**: o `pcb_posicao_conferir` e o `pcb_mover_lote` medem cada componente pela caixa dos pads e da
  serigrafia dele, não pela caixa inteira do footprint (com o desenho mecânico). Antes o IND IFDC2525 da PCB1, de
  ±6,15 mm de caixa e ±4 mm de cobre e serigrafia, "colidia" com o D3. `caixa:"componente"` volta à conta antiga.
- Teste: `tests/test-mcp-arrasta.js`.

## 1.50.0 — 2026-10-30

Furos, recortes, faixa proibida e o autoroteador (etapa B do relato da PCB1: trilho de 2 mm + furos M3).
- **Furo sem cobre (NPTH) no footprint**: o `fp_salvar` aceita `type:"npth"` (grava `th` com `plated:false`, o pad do
  tamanho do furo) e `plated:false` num pad passante. Antes recusava o furo de 3,4 num pad de 3,4 dizendo "o furo é
  maior que o pad"; para o pad metalizado a mensagem agora diz "do tamanho do pad" e mostra o caminho do NPTH. O editor de
  footprint ganhou **Plated: Metalizado (PTH) / Sem cobre (NPTH)** em Hole Information. O Gerber já mandava esse furo
  para o arquivo de NPTH.
- **Furo de fixação pronto**: `fp_pacote` (e o assistente do editor) com o tipo `furo` — furo 3,2 sem cobre por padrão
  (`FURO_3.2_NPTH`), `padX` = anel de cobre (furo metalizado), `cx` = círculo da cabeça do parafuso na serigrafia.
- **`pcb_furo`**: furo avulso na placa (`pad_add`), sem cobre por padrão; `metalizado` com `anel` e `net`.
- **`pcb_recorte`**: recorte da placa (Board Cutout, `region_add` com `cutout:true`) em círculo, retângulo ou polígono.
  A op já existia, mas sem ferramenta, e a IA não a achou.
- **`pcb_faixa_borda`**: a faixa proibida ao longo de bordas escolhidas (ex.: 2 mm em cima e embaixo para o trilho), uma
  região na camada KeepOut por lado, recortada no contorno. A resposta lista o que já está dentro dela.
  - O polígono (pour) passou a respeitar tudo o que está na KeepOut, como o roteador e o DRC já faziam (antes só
    o que tinha a marca `keepout:true`).
  - A regra da casa acusa texto de serigrafia na KeepOut (`serigrafia_keepout`), e o `serigrafia_posicionar` não
    põe designador lá (o do VDR1 tinha caído dentro da faixa do trilho).
- **Autoroteador**:
  - Sem `camadas`, usa só Top, Bottom e as camadas internas que já têm cobre. A PCB1 tinha Mid2/Mid4 vazias na pilha
    e saiu roteada por elas. A resposta diz quais ficaram de fora.
  - Avisa a rota que só passou com a largura MÍNIMA da regra (`abaixo_da_preferida`). Antes o +3V3 saiu com 0,19 mm
    em vez dos 0,8 da Width_Power sem aviso.
  - Sugere `cruzarPlanos:true` quando falta caminho e há plano de cobre na placa.
- `pcb_consultar` e `pcb_componente` mostram `plated` nos pads com furo.
- Teste: `tests/test-mcp-furos.js`.

## 1.49.0 — 2026-10-30

PCB pelo MCP: o que a sessão de IA da PCB1 não conseguia apagar, editar nem mover (itens 15 a 34 do relato, etapa A).
- **Objetos criados pelo changes.js** (trilha, via, texto, região… com id `new-…`): o `pcb_apagar` e o `pcb_editar`
  aceitam o id que o `pcb_consultar` mostra e mexem na linha que criou o objeto. Antes respondiam "não existe objeto com
  id new-t245 no board.js", e o caminho era baixar o `pcb_mudancas` inteiro (270 mil caracteres) e achar a linha pela
  coordenada.
- **Id que não muda**: toda linha `*_add` gravada pelo MCP ganha um `uid`, e o objeto aparece como `new-<tipo><uid>`.
  Antes o id era um contador e mudava a cada gravação (new-t96 virava new-t73). Linhas antigas e as da vista seguem com
  o contador.
- **Componente de `comp_add`** (ECO, `pcb_colocar`, a vista): mover, apagar, renomear (`comp_attr`) e o designator mexem
  na própria linha `comp_add`. Vale para o `pcb_mover`, o `pcb_mover_lote`, o `pcb_apagar`, o `pcb_aplicar`, o
  `eco_aplicar` (trocar o footprint de quem o ECO trouxe dava "componente X não existe no board.js") e o
  `serigrafia_posicionar`. Vale também para o componente que saiu do `board.js` por `comp_del` e voltou por `comp_add` com
  o mesmo nome: antes as ferramentas usavam os `orig_*` do componente antigo (o `pcb_mover_lote` editava a linha
  errada e o `designator_move` ficava com `orig_*` que não conferia). As linhas `comp_move`/`designator_move` antigas
  desse componente são juntadas na `comp_add` na primeira mexida.
- **`pcb_mudancas`** com filtros: `id` (também `new-…`), `ref`, `op` (ou o começo dela), `caixa`, `curto` e
  `limite`/`pular`; cada linha `*_add` traz o id do objeto na placa.
- **Resposta resumida**: lote com mais de 40 linhas (`teardrop_aplicar`, `eco_aplicar`, `serigrafia_posicionar`…)
  devolve as 10 primeiras e as com aviso ou erro, com o total e a contagem por op.
- **`regras_definir`**: a prioridade pedida vence o empate (a `HoleSize` nova com prioridade 1 entrava como 2, e a regra
  geral de 2,54 mm seguia vencendo nos furos M3). A resposta mostra a prioridade final das regras daquele tipo.
- **Regras da casa por área**: o quadrado de cada furo de parafuso usa o `parafuso` da área onde o furo está (o
  `regras_casa_verificar` e o `serigrafia_posicionar`). Antes usava o valor geral (3 mm) mesmo com `parafuso: 1` na área
  do H3 da PCB1. A falha era da 1.37.0.
- **`pcb_colocar`** aceita de novo um designador que saiu por `comp_del`.
- **Gravação**: o rename do arquivo temporário tenta de novo por até ~2 s quando o Windows responde EPERM/EBUSY/EACCES
  (o app, o hub, o OneDrive ou o antivírus com o `changes.js` aberto naquele instante).
- Contrato (AI-GUIDE): campo opcional `uid` nas linhas `*_add`.
- Teste: `tests/test-mcp-novos.js`.

## 1.48.0 — 2026-10-29

**`sch_copiar`** (MCP): copia um circuito de um projeto para outro, pedido pela mesma sessão de IA que, para levar a fonte
do PRJ-UR-DI261924 para a PCB1, teve de ler e regravar cada símbolo, recriar cada componente e redesenhar cada fio.
- Escolha por `refs` ou por `caixa` (em mil, na folha de origem).
  - Por refs vem o que é das nets dos pinos escolhidos e passa pela caixa em volta deles (`margem`, padrão 400 mil). O
    fio que passa pela caixa vem inteiro, com o rótulo e o power pousados nele (`fios_estendidos`). O circuito vizinho
    que cai na caixa não vem.
  - Por caixa vem tudo o que está dentro. O fio que sai dela fica de fora (`fios_cortados`).
- Designador que já existe no destino ganha o próximo livre do prefixo (`refs` mostra a troca). `refs_novos` escolhe e
  `renumerar` renumera todos.
- `nets` troca nomes de net (`{"0V":"0VCC"}`).
- `posicao` (o canto dos componentes, na grade de 100 pela sobra que mais pinos têm) ou `deslocamento`. `folha_destino`
  com nome novo cria a folha.
- O símbolo que só existe no esquema de origem vai para o `symbols` do destino (`simbolos_copiados`), com o aviso de
  que o BuildSchematic do Altium só põe componente cujo símbolo está na biblioteca dele.
- Erro que o componente já tinha na origem (footprint fora da PcbLib) não trava a cópia (`erros_herdados`). Os avisos
  de grade viram a contagem `fora_da_grade`.
- Medido no PRJ-UR-DI261924: a fonte (11 componentes) copiada por refs mantém as 300 combinações de pinos com a mesma
  ligação da origem, com o 0V virando 0VCC.
- Correção: gravação do MCP que mudava o cabeçalho do `schematic.js` (os `symbols`) no modo que só troca as linhas dos
  itens perdia o cabeçalho; agora o arquivo é reserializado inteiro, como no `sym_salvar`.
- Teste: `tests/test-sch-copiar.js`.

## 1.47.0 — 2026-10-29

Esquema: validação e ferramentas da IA (relato de uma sessão de IA que montou a PCB1 a partir do PRJ-UR-DI261924).
- **Pino sem ligação e ponta de fio solta.** A validação (`HubCore.validateSchematic`, que o `sch_validar` e as gravações de esquema do MCP usam) acusa o pino que não liga a
  nada (nenhum fio, rótulo ou outro pino) e a ponta de fio onde nada encosta, uma linha por componente e uma por folha.
  No ERC na ponta do pino ou do fio quer dizer "solto de propósito" e não é acusado (o pino 3 do CI4 do PRJ-UR-DI261924
  tem No ERC). O `HubCore.extractNets` devolve `pinosSoltos` e `pontasSoltas`.
- **Pad sem pino**: pad de cobre do footprint que nenhum pino do símbolo leva fica sem net na placa, e agora é aviso (a
  aba térmica do TO-263-5/DDPAK-5 nos reguladores, a do SOT223, os capacitores cujo símbolo numera diferente do
  footprint).
- **Símbolo que só casa trocando maiúsculas, acentos ou espaços** ("Varistor" → "VARISTOR", outro desenho) é aviso na
  validação, e o `sch_simbolo` diz `casou_por` e avisa.
- **A cópia do símbolo guardada no esquema** (`schematic.symbols`) com pontas de pino diferentes da biblioteca: continua
  valendo a da biblioteca, e a validação conta quantos pinos encostam em fio com cada desenho (no PRJ-UR-DI261924, o
  "Res SMD 1206": 22 de 26 com a biblioteca, 7 com a cópia). Se os fios seguem a cópia, o aviso diz. O relato pedia o
  contrário (usar sempre a do esquema), mas a medição mostrou que a cópia é a que desligaria os resistores.
- **MCP**:
  - `sch_componentes`: filtros `prefixo` ("R" = os resistores, sem pegar RV1 nem o "C" de CI1), `refs` e `folha`;
    `pinos: "soltos" | "nenhum"`; `campos`; cada pino solto vem com `solto: true`.
  - `sch_ler`: o cabeçalho sai em `resumo` por padrão (os nomes dos símbolos guardados, sem o desenho de cada um, que
    passava de 15 mil caracteres); `cabecalho: "completo" | "nenhum"`; filtros `refs`, `prefixo` e `net`; `campos`.
  - `sch_apagar` e `sch_editar` acham o item pelo lugar (`em: {t, x, y}`), sem depender dos índices, que mudam depois
    de cada apagar. Lugar com mais de um item não edita (diz quais índices achou).
  - `sch_simbolo`: avisa pontas de pino fora da grade de 100 mil, o footprint padrão que não existe na PcbLib e a cópia
    diferente guardada no esquema do projeto.
  - `sch_validar`: `pinos_sem_ligacao`, `pontas_soltas` e `simbolos_do_esquema_diferentes`.
- Teste: `tests/test-sch-validacao.js`.

## 1.46.0 — 2026-10-29

Projeto com mais de uma PCB (pedido do dono: "tem projetos que têm mais de uma PCB; na árvore, Projeto → PCB → os
documentos, e poder mover algumas prontas para esse projeto").
- **Na árvore**: as PCBs de um mesmo projeto ficam embaixo de uma linha só (com quantas PCBs são e as mudanças
  pendentes somadas), e cada PCB abre os documentos de sempre (Esquema, PCB, Neoden, Laser, BOM, Histórico).
  Projeto de uma PCB só continua como era. A busca acha pelo nome da PCB ou do projeto.
- **Mover uma PCB pronta**: arrastar a PCB para o projeto, ou botão direito › Mover para um projeto multi-PCB…
  (escolhe um existente ou digita um nome novo, que cria o projeto). Para tirar: botão direito › Tirar do
  projeto, ou arrastar para a raiz "Projetos".
- **No projeto (botão direito)**: Nova PCB neste projeto… (pasta nova com um esquema de uma folha em branco; a placa
  nasce na vista PCB › Placa nova ou pelo Altium), Renomear projeto… e Desfazer o projeto (as PCBs ficam avulsas;
  nada é apagado).
- Cada PCB continua sendo um projeto inteiro em `Projects\<nome>`: o Altium, o MCP, as vistas e o NexoBD não mudam.
  O projeto é o `grupo.json` da pasta de cada PCB (`{"grupo": "<projeto>"}`), que vai para o NexoBD junto com ela,
  então as outras máquinas montam a mesma árvore. O índice (`/api/index.json`) traz o `grupo` de cada projeto.
- Rotas novas do `hubserver.py`: `POST /api/project/<id>/grupo`, `/api/grupo/renomear` e `/api/grupo/nova-pcb`.
- Testes: `tests/test_hubapi.py` (as rotas) e `electron/test/armazem.test.js` (o `grupo.json` chega à outra
  máquina pelo NexoBD real).

## 1.45.0 — 2026-10-29

Renomear projeto e folhas (pedido do dono: "não consigo alterar o nome do projeto; se tenho mais de uma folha, apagar
alguma em branco, além de poder renomear a folha").
- **Renomear projeto**: botão direito no projeto, no painel Projetos › Renomear projeto….
  - Rota `POST /api/project/<id>/rename` do `hubserver.py`: renomeia a pasta em `Projects\`, troca o `"project"` do
    `schematic.js` (o `board.js` não é tocado) e recusa nome inválido, nome repetido e nome que dá o mesmo id/link
    de outro projeto. Só a caixa ("pcb1" → "PCB1") também vale.
  - No NexoBD é o MESMO item que troca de chave e nome, com o histórico de revisões; a BOM (`/bom/<id>`) acompanha.
    O hubserver anota em `.altiumhub/nexobd-renomear.json` antes de renomear, e o `armazem.js` aplica na rodada.
  - Nas outras máquinas a pasta é renomeada também, sem baixar de novo e sem perder o que estava por subir.
  - As escolhas do projeto no navegador (Neoden, Laser, BOM) vão para o id novo.
  - O Altium acha o projeto pelo nome: para o BuildSchematic/ApplyChanges, renomeie também o `.PrjPcb`.
- **Folhas do esquema** (vista Esquema › Configurações › Folha): **Nova folha**, **Renomear…** (ou duplo clique no
  cartão) e **Apagar**, que só vale para folha em branco e nunca para a última. Renomear leva junto o `sheet` de
  todos os itens. Ctrl+Z volta.
- `HubDialog.texto` (`hub-dialog.js`): a caixa de digitar no tema, com validação embaixo do campo.
- Testes: `tests/test_hubapi.py` (a rota) e `electron/test/armazem.test.js` (duas máquinas contra o NexoBD real).

## 1.44.0 — 2026-10-29

Junta as duas linhas do dia: os teardrops feitos em paralelo no `main` (lá saíram como 1.42.0) chegam à vista da
régua, da pilha de camadas e do Polygon Pour em gaveta (1.42.0 a 1.43.0 abaixo). Pedido do dono: "o teardrop não
pega as conexões em T; coloque uma opção de tirar os teardrops".
- **Junção em T**: o Teardrops da vista e o `teardrop_aplicar` do MCP põem a gota também onde uma trilha termina no
  meio de outra da mesma net (uma trilha só ou duas emendadas no ponto).
  - A forma é a do Altium, medida nos 82 de trilha com trilha do acervo: ponta a 100% da largura da trilha que
    chega, base andando 100% da largura da principal pela borda dela, e o vértice na borda do outro lado. 77 dos 82
    caem na mesma junção.
  - Canto (L), emenda quase reta e ponta dentro de pad/via ficam sem. Junção que já tem gota (do Altium ou do hub)
    não ganha outra.
  - `opcoes.tjuncao:false` desliga.
- **Tirar teardrops**: a barra da PCB ganha a gaveta Teardrops (ao lado da do Polygon Pour), com Pôr e Tirar, e o
  MCP a ferramenta `teardrop_remover` (`nets`/`camadas` limitam).
  - O teardrop posto pelo hub sai tirando a linha `region_add`; o do espelho ganha `region_del`.
  - O do espelho antigo (board.js sem `exporter`) não se apaga daqui, e a mensagem diz quantos ficaram.
  - Ctrl+Z volta. O botão da frente da gaveta é sempre o Pôr, para o Tirar não ficar a um clique por engano.
- `hub-pcbteardrop.js`: `faltam()` (o que o botão põe) e `todos()` (o que o Tirar tira).
- Testes: `tests/test-pcbteardrop.js` (o T do LM555, do DMB e a 45° do PAEL, e os casos sem gota),
  `tests/test-mcp-teardrop.js` e o `tests/smoke-teardrops.js` na vista.

## 1.43.0 — 2026-10-29

- **Vista PCB mais leve** (medido num projeto com 25 planos de terra e 3.600 linhas no changes.js):
  - as marcações das mudanças saem em lote e sem as camadas escondidas: mexer o mouse, dar zoom e arrastar a tela
    gastam ~10× menos;
  - o 3D escondido não se refaz mais depois de cada edição (era ~1 s de tela parada): refaz quando você abre;
  - **Propriedades da placa › Desempenho**: **Componentes 3D** (desligado: sem corpos no 3D nem silhuetas na placa,
    nada de STEP carregando) e **3D pronto de antemão**;
  - camada escondida não é desenhada nem processada.
- **Menu Camadas no canto da placa** (embaixo do Filtro): uma caixa por camada, **Todas**, **só** (passe o mouse) e os
  atalhos Cobre / Cima / Baixo. O que você deixa à vista fica gravado por projeto.
- **Pilha de camadas** (painel › aba Camadas): espessura do cobre e do dielétrico em mm, a espessura da placa,
  **+ Camada de cobre**, tirar camada interna vazia, pilhas prontas de **2, 4, 6 e 8** camadas, camadas mecânicas
  (+ / tirar) e **Voltar à pilha do Altium**. Vale na tela, no Gerber (uma camada por cobre) e no 3D. Camada que ainda
  tem objeto (ou via passando) não sai. No Altium, ajuste o Layer Stack Manager à mão (o ApplyChanges avisa).
- **Vão da via**: **De / Até** na ficha da via e na ferramenta Via (via cega ou enterrada, com aviso).
- **Camadas do pad pelo footprint**: clique no pad de um componente e escolha **SMD do lado do componente**, **SMD do
  lado oposto** ou **Passante**; o footprint muda na biblioteca do hub e os componentes da placa com ele se atualizam.
  **Todos os pads do footprint assim** aplica no footprint inteiro.
- `tests/test-pcbpilha.js` e `tests/smoke-camadas-pcb.js`; AI-GUIDE: `stack_set` e `from`/`to` no `via_edit`.

## 1.42.1 — 2026-10-29

- **Régua (Ctrl+M): a retícula não some mais.** Com o cursor Small 90 (a cruz do Windows), longe de qualquer ponto de
  agarre não aparecia nada no cursor: a cruz do sistema é preta e some no fundo preto da placa. Agora, com a régua na
  mão, a vista desenha a própria cruz, branca com contorno escuro, sempre; o marcador do agarre vem por cima.

## 1.42.0 — 2026-10-29

- **Régua (Ctrl+M) como a do NexoCAD**, na vista PCB:
  - marca dois pontos (dois cliques, ou aperta num, arrasta e solta no outro) e agarra em centro de pad, via, furo e
    círculo, ponta, meio, quadrante (a borda do círculo), vértice, canto, borda do cobre e na **tangente** de círculo ou
    arco (encosta do lado da outra ponta: perto, longe ou centro, trocável no painel);
  - depois do 2º ponto, a linha da cota vai com o mouse: acima/abaixo dos pontos dá a **horizontal**, ao lado a
    **vertical**, no meio a **alinhada** (Espaço troca); o clique deixa a cota na placa; Backspace volta um ponto, Esc
    larga;
  - as cotas ficam na placa (nesta máquina, por projeto; não vão para o Altium): clicar seleciona, arrastar muda por
    onde passa a linha, Delete apaga; o botão da **régua com olho**, na barra (e no painel Vista), esconde e mostra.
- **Polygon Pour numa gaveta**: retângulo e polígono livre juntos, com a setinha, como as formas de desenho.
- **O cadeado saiu da barra**: a trava da edição mora nas Propriedades da placa (com nada selecionado); a tecla E e o
  botão direito continuam.
- **Sinalizador: pôr e tirar** — a bandeira inteira responde ao clique (antes só a base), Delete apaga sem destravar a
  edição, e há "Apagar sinalizador" no painel e no botão direito; com a ferramenta Sinalizar, clicar numa bandeira que
  já existe a seleciona em vez de pôr outra.
- `hub-pcbcotas.js` (lógica pura), `tests/test-pcbcotas.js` e `tests/smoke-regua-pcb.js`.

## 1.41.0 — 2026-10-29

Roteamento e posicionamento, o P3 da lista de melhorias (itens 21 e 22).
- **Suavizar a 45° sem soltar ramo (21)**: módulo novo `hub-suaviza45.js` e ferramenta `pcb_suavizar` do MCP.
  - Toda ponta de trilha ou arco, via, pad ou cruzamento da mesma net que encosta no meio de uma trilha vira ponto
    fixo, e só o trecho entre dois pontos fixos se suaviza, com as pontas paradas. A versão ingênua (a rota inteira
    puxada de ponta a ponta) soltava o ramo e a via; o teste mostra isso antes.
  - A suavização é a do roteador, com as regras do projeto. A trilha nova não passa por cima de pad da mesma net que
    não tocava, e trecho que já violava folga fica como está. `modo:'chanfro'` só chanfra os cantos de 90°.
  - No fim confere por net o ratsnest e as pontas soltas: net que piorou volta inteira.
  - Grava trocando as trilhas: `track_del` com os orig_*, ou tirando a linha `track_add` de quem nasceu no
    changes.js. Com violação nova de DRC nada é gravado.
- **Mover componentes em lote (22)**: ferramentas `pcb_mover_lote` e `pcb_posicao_conferir` do MCP, módulo novo
  `hub-posiciona.js`.
  - Centenas de `comp_move` numa gravação só, com a mesma conta do `pcb_mover`. Medido: 18 componentes em 0,3 s
    numa chamada.
  - Antes de gravar, confere colisão entre componentes do mesmo lado (a ComponentClearance das regras, ou `folga`)
    e componente fora da placa ou sobre recorte. Só o que o lote criou conta: com colisão nova nada é gravado, e
    `forcar:true` grava.
  - O `pcb_mover` passou a usar a mesma função do lote, sem mudar o que faz.
- Testes: `tests/test-suaviza45.js` e `tests/test-mcp-p3.js`.

## 1.40.0 — 2026-10-29

Auto-roteador e planos, o P2 da lista de melhorias de roteamento (itens 17 a 20).
- **A árvore da net é o cobre despejado de verdade (17)**:
  - o pedaço de plano de outra net é obstáculo pela folga do **próprio polígono**, quando ela passa a da regra. Antes,
    a rota encostava só na folga da regra e o plano recuava calado no redespejo (medido: 5,7 mm² a menos num teste);
  - depois das passadas o lote **redespeja** os planos e confere o ratsnest. A rota que partiu um plano (o pad que
    ficou numa ilha recortada) sai e é refeita sem cruzá-lo; sem caminho, a falha é `corta-plano`;
  - o "depois" do relatório e o DRC da prévia na vista saem da placa redespejada (`HubAutoRoteador.redespeja`, a
    mesma conta da vista e do MCP). O worker da vista carrega o despejo (`hub-clipper.js`, `hub-pcbpour.js`).
- **Fanout (18)**, ferramenta `pcb_fanout {net}` do MCP:
  - cada pad SMD da net que ainda não chega ao plano ganha uma trilha reta curta e uma via dentro do cobre do plano,
    longe da borda o bastante para o térmico achar cobre;
  - a via respeita folga, furo a furo e ponte de máscara, também contra as outras vias do fanout (nada de via sobre
    via), e a direção preferida é para fora do componente;
  - simula por padrão e grava com `gravar:true`, desde que não haja violação nova de DRC.
- **Cruzar plano de outra net (19)**, `cruzarPlanos`:
  - no MCP e na caixa "Cruzar planos de outra net" do Auto-rotear da vista;
  - a trilha (a de gate pelo plano de fase) atravessa o polígono com custo por mm dentro dele (`custoPlano`), e o plano
    é redespejado em volta dela.
- **Via proibida (20)**:
  - em pad SMD de qualquer net (`viaEmPad:true` libera);
  - na faixa estreita de plano (`faixaPlano`, padrão 2 mm, crescida de metade dela), onde a via e o térmico cortariam
    o plano. A trilha que cruza plano também não passa ali;
  - novo `HubPcbPour.estreitas` acha essas faixas.
- Testes:
  - novo `tests/test-autoroteador-planos.js`, com placas sintéticas para cada item;
  - `pcb_fanout` no `tests/test-mcp-autorotear.js`.

## 1.39.0 — 2026-10-29

- **Arrastar a trilha sem quebrar** (o Drag do Altium), na vista PCB:
  - uma trilha sozinha anda paralela a si mesma e as vizinhas deslizam pela direção delas: os cantos de 45°/90° ficam;
  - ponta presa em pad ou via que não anda ganha uma trilha nova, na mesma camada, largura e net, do lugar antigo ao
    novo: a ligação não se perde;
  - um grupo (o Tab, a janela) anda inteiro e as trilhas de fora que encostavam nele esticam; arrastar a via estica as
    trilhas das duas camadas; arrastar a ponta leva o vértice inteiro;
  - a regra de folga continua: cobre de outra net no caminho, tudo volta para o lugar.
- **Tab do Altium** com a trilha selecionada (ou sob o cursor): **Tab** pega a trilha inteira até a via ou o pad;
  **Tab de novo** pega tudo o que se liga, atravessando as vias para as outras camadas (para no pad).
- `hub-pcbtopologia.js` (lógica pura) e `tests/test-pcbtopologia.js`.

## 1.38.0 — 2026-10-29

- **Auto-rotear na vista PCB** (o Auto Route do Altium, com o auto-roteador da 1.34.0):
  - botão **Auto-rotear** na barra, logo depois da Via; teclas **U, A, A** nos dois conjuntos de atalhos (NexoEletric e
    Padrão Altium); menu **Rotear › Roteamento automático › Tudo… / Net / Configurar…** (Net = as nets da seleção);
  - janela com as conexões abertas agora, o escopo (todas ou só as nets selecionadas), a ordem (curtas primeiro, longas
    primeiro, por classe de regra), as camadas de sinal, o custo da via e as passadas de arranca-e-refaz;
  - roda num Web Worker, sem travar a vista (sem worker, em fatias de ~40 ms na própria página), com o progresso no
    canto (conexão x de y, passada, roteadas/abertas, tempo) e **Cancelar**;
  - **prévia** na placa (trilhas e vias novas com contorno verde) e o resumo: abertas antes → depois, trechos e vias,
    comprimento, tempo, falhas com o motivo e as violações NOVAS de DRC (a mesma conta do `pcb_autorotear`);
  - **Aplicar** entra como uma edição da vista (um Ctrl+Z desfaz o lote inteiro; Salvar/autosave grava o changes.js);
    **Descartar** não deixa nada. Com violação nova, o Aplicar só libera marcando "Aplicar mesmo com as violações
    novas"; se a placa mudou depois da prévia, o Aplicar recusa e pede para rodar de novo.

## 1.37.0 — 2026-10-29

Serigrafia pela IA, segunda parte: posicionar, conferir rápido e regras da casa por projeto.

- **`serigrafia_posicionar`** (MCP): acha lugar para os designadores que violam as regras da casa (ou os `refs`
  dados, ou `todos:true`) e grava como `designator_move` no lugar final. Procura em volta da caixa do componente, do
  mais perto ao mais longe, da maior altura à menor (`altura_min`/`altura_max`), paralelo ao lado comprido. Recusa
  lugar em cima de pad, via, furo, trilha (`ignorar_trilha` libera), outra serigrafia, borda e corpo de componente
  (`sobre_corpo` libera), e lugar ambíguo (o rótulo mais perto de outro componente que do dono). `modo:"fileira"`
  alinha o rótulo ao próprio componente numa fileira de iguais. Simula por padrão; `gravar:true` grava. Os que não
  acham lugar voltam em `falhas`, com o que bloqueou.
- **`serigrafia_checar`**: diz em milissegundos se um lugar candidato (do designator de um ref, de um texto pelo id
  ou de um texto novo) viola alguma regra da casa, sem gravar e sem rodar o DRC — a mesma conta do
  `regras_casa_verificar`.
- **`pcb_aplicar` com `drc:true`**: roda o DRC antes e depois das ops (também com `simular:true`) e devolve as
  violações novas e as que saíram.
- **Regras da casa por projeto e por área** (`Projects/<p>/regras-casa.json`, ferramentas `regras_casa_ler` e
  `regras_casa_definir`): os números (folgas, `texto_h_min`, `texto_w_min`...), regras desligadas inteiras ou só uma
  parte da serigrafia (`serigrafia_trilha`, `serigrafia_pad`, `texto_tamanho`...) e áreas da placa com regras
  próprias. O verificador, o `serigrafia_checar` e o `serigrafia_posicionar` seguem o arquivo.
- **Altura e traço mínimos do texto** (1,0 e 0,15 mm, a skill `pcb-serigrafia-livre`) agora são conferidos pelo
  `regras_casa_verificar` (`texto_tamanho`), e o projeto pode mudar.
- **Correção da 1.36.0:** a checagem de borda do `regras_casa_verificar` somava os traços sobrepostos da fonte e
  acusava quase todo texto como "a menos de 0,3 mm da borda". Agora mede a área da união.

## 1.36.0 — 2026-10-29

Serigrafia e despejo pela IA. Nasceu de uma rodada em que 80 designadores foram parar fora da placa com `status: ok`,
e de 220 violações de Clearance de dois polígonos novos.

- **`designator_move` no lugar final (MCP).** Antes, o x/y valia no lugar de antes do `comp_move` do componente: o
  `pcb_aplicar` punha a linha antes do `comp_move` e respondia ok, mas o texto andava junto com o componente e ia
  parar em outro lugar. Agora o x/y/rot é onde o texto deve **ficar** na placa, e a conta inversa é feita por dentro
  (a mesma da vista PCB, `xfPointInv`). `"referencial":"original"` mantém o comportamento antigo. A resposta traz em
  `textos` a posição efetiva de cada texto, a diferença para o pedido e `fora_da_placa` quando ele sai do contorno.
- **`w` (traço) no `designator_move`**, no hub e no `ApplyChanges`: altura de 0,6–0,8 mm com o traço de 0,254 mm
  deixava o texto grosso e ilegível.
- **Designator de componente criado por `comp_add`.** Ele não está no `board.js` ("o designator de J5 não está em
  board.js » texts"). O lugar, a altura, o traço e o giro agora vão na própria linha do `comp_add` (`des_x`,
  `des_y`, `des_h`, `des_w`, `des_rot`), no `pcb_aplicar` e arrastando na vista PCB; o `ApplyChanges` põe o nome
  lá. Mover o componente (`pcb_mover`) leva o designator junto.
- **Serigrafia fora da placa.** O DRC ganhou a checagem `SilkOutsideBoard` (da casa; o Altium não tem): texto de
  serigrafia fora do contorno ou cruzando a borda. Roda junto com as checagens de silk e de contorno. O
  `regras_casa_verificar` passou a medir a borda pelo contorno de verdade, não pelo retângulo da placa.
- **O despejo respeita as regras por classe.** O polígono do hub (`poly_add`) despejava com a folga única dele
  (0,2 mm), ignorando "fase × baixa tensão 1,5 mm", "+74 × baixa 1,0 mm" e afins. Agora a folga de cada net vizinha
  sai da Clearance vencedora (`HubPcbPour.comRegras`, a mesma conta do DRC e do roteador) — só onde ela é maior que
  a do polígono, então o despejo de quem já seguia as regras não muda. Vale na tela, no DRC, no Gerber, no
  `pour_despejar` e na placa viva (laser).
- **`pcb_consultar` com `campos` e `arquivo`.** Pads, vias e trilhas da placa inteira esgotavam o contexto da IA:
  `campos` devolve só o que pedir e `arquivo:true` grava tudo num `.json` e devolve o caminho.

## 1.35.0 — 2026-10-28

- **Apagar o cobre despejado do Altium sem polígono na placa.** O ExportBoard leva os pedaços que o Altium despejou
  (`poly:true`), mas não o polígono de onde eles saíram. O hub recusava apagar esse cobre ("o Altium redespeja; mexa
  no polígono"), e quem não volta mais ao Altium ficava com ele na placa: na tela, no DRC, no ratsnest, no Gerber e no
  PDF (o `altium_sem_poligono` do DRC). Agora esse cobre entra no modelo marcado `orfa` e o `region_del` apaga:
  selecione na vista PCB e aperte Delete, ou pela IA (`pcb_apagar`). Mover ou editar continua recusado (o
  `region_add` não leva os furos do despejo), e o pedaço de um polígono que está na placa (`de` = um id de
  `board.js » polygons`) continua só de desenho, porque o hub o redespeja. No Altium o `ApplyChanges` recusa essa
  linha: lá o polígono existe, apague-o no Altium.

## 1.34.0 — 2026-10-28

- **Auto-roteador em várias camadas, com vias** (`hub-autoroteador.js`, ferramenta `pcb_autorotear` do MCP). O
  `pcb_rotear` liga uma conexão por vez numa camada só; o novo liga o ratsnest aberto da placa (ou só as `nets`
  pedidas) de uma vez:
  - A* numa grade única para todas as camadas de sinal (Top, Bottom, Mid…), trocando de camada por via. A via só entra
    onde fica limpa em todas as camadas de cobre, inclusive furo a furo e ponte de máscara do DRC. Plane não recebe
    trilha; pad SMD só se liga na camada dele.
  - As folgas, a largura, a via e as camadas permitidas saem da mesma conta do DRC: Clearance vencedora por par (classes
    de net e regras com escopo, como fase × baixa tensão 1,5 mm ou COM × VSS 0,2 mm só no IC8), Width, Routing Via
    Style e Routing Layers.
  - Ordem (`curta`, `longa`, `classe`, `dada` ou uma lista de nets), arranca-e-refaz só das rotas que ele mesmo pôs
    (o cobre que já estava na placa nunca sai) e várias passadas, ficando com a de menos conexões abertas.
  - Padrão `gravar:false`: só simula e mostra as conexões abertas antes/depois, as vias, o tempo e o DRC com as
    violações NOVAS. `gravar:true` escreve os `track_add`/`via_add` no changes.js; com violação nova nada é gravado.
  - Medido no acervo, sem violação nova de DRC: placa de potência DI221705 42 → 0 abertas (9 vias, 0,1 s); PRJ-UR 174 →
    0 (137 vias, ~10 s); MIF 332 → 1 (47 s); PACI (17 × 13 mm, muito densa) 16 → 4.
  - Limites: cada linha do ratsnest vai de ponta a ponta (não emenda no meio de uma trilha); só via passante; o
    anti-pad do plano não é modelado (o acervo não tem placa com Plane/Mid para testar mais de 2 camadas). Ainda sem
    botão na vista PCB: por enquanto pelo MCP.

## 1.33.0 — 2026-10-28

- **Laser, Neoden e BOM andam junto com a PCB.** Os três liam o `board.js` cru, o espelho do Altium. O que se mexia
  na vista PCB (o `changes.js`) não chegava neles, e os próprios avisos diziam "a arte NÃO inclui as mudanças". Agora
  usam a mesma placa da vista PCB: mudanças, componentes do ECO com a biblioteca de footprints, teardrops e planos
  despejados (`hub-placaviva.js`).
  - Com a vista PCB do projeto aberta, vale a placa dela **ao vivo**, inclusive o que ainda não foi salvo: mexeu um
    componente, ele já está no lugar novo no Neoden, na arte do Laser e no BOM.
  - Sem a vista aberta, a placa sai do disco e é refeita quando o projeto muda.
  - **A BOM publicada no NexoBD para a bancada também.** A fonte dela passa a ter as mudanças da PCB, e mexer só no
    `changes.js` também a republica. Antes, só o `board.js` e o `schematic.js` disparavam a republicação. O
    comentário vindo do esquema continua valendo onde a PCB não mexeu.
- **Arquivo › Autosave**, logo abaixo de Salvar, na PCB e no Esquema. Marcado, cada mudança é salva sozinha logo
  depois da última edição (arrastando ou desenhando, espera terminar), sem o aviso de "salvo". A escolha é uma só e
  fica guardada: marcou numa vista, vale na outra e nas próximas vezes. As perguntas de sobrescrever (o arquivo mudou
  no disco por outro escritor) continuam aparecendo. Mudança inválida para o autosave e avisa no rodapé; Ctrl+S
  mostra qual é.

## 1.32.1 — 2026-10-28

- **O hub sobe com `python.exe -E -s`** (pedido do usuário): `python.exe -E -s -X utf8 -u hubserver.py --port 8200
  --host 127.0.0.1`, e o `pcblib2js.py` do armazém do mesmo jeito (`lib/python-flags.js`).
  - `-E` ignora as variáveis `PYTHON*` e, junto, o `PythonPath` do registro. Numa máquina com o Python 3.12 instalado,
    o Python embutido carregava o `_ctypes.pyd` dele, e o import do Flask derrubava o hub com 0xC0000005 antes de subir
    (e o `npm run dist` parava na prova de vida do runtime).
  - `-s` deixa de fora o site-packages do usuário.
  - `-X utf8` e `-u` fazem o que o `PYTHONUTF8`/`PYTHONIOENCODING` e o `PYTHONUNBUFFERED` faziam (o `-E` os desliga):
    log em UTF-8 e linha a linha.
  - Os filhos que o hub sobe com `sys.executable` não herdam parâmetro: o ambiente deles continua limpo e ganha
    `PYTHONHOME` na pasta do Python embutido, que tira o registro do caminho também para eles.
- **Hub órfão reconhecido com acento no caminho.** O app pergunta ao PowerShell de quem é a porta e o caminho do
  `python.exe` voltava na página de código do console: numa pasta com acento ("Área de Trabalho") o hub que ficou de
  uma sessão anterior passava por "outro programa", seguia vivo e o app mudava de porta. A saída agora é UTF-8.

## 1.32.0 — 2026-10-28

- **Corrigido: os pads SMD dos componentes não saíam no Gerber.** Abrindo a placa direto na aba Gerber, o pacote era
  gerado antes de a vista carregar a biblioteca de footprints. Os componentes postos pelo ECO/`comp_add` cujo footprint
  vem da biblioteca (capacitores, resistores, CIs SMD, módulos) ficavam de fora, e o plano de cobre passava por cima
  de onde eles estariam. Na PCB1 a pasta de cima caía de 159 para 14 flashes. Agora o Gerber espera a biblioteca, e o
  que já estava aberto é gerado de novo quando ela chega. Salvar, Baixar .zip e Enviar pra JLC também esperam. Se
  ainda faltar footprint, os avisos do Gerber dizem em letra de ATENÇÃO quais componentes ficaram de fora.
- **Olho das marcações de alteração na barra da PCB.** Fechado, somem os tracejados de onde as coisas estavam, as setas
  de movimento e os contornos de novo/removido, e fica só a placa como ela está (trilhas, pads, plano). É o mesmo
  liga/desliga da tecla das marcações e do botão da seção Vista do painel (agora com o mesmo olho), e fica gravado.
- **O Selection Filter saiu do painel lateral da PCB.** Era repetido: o filtro do canto da área de PCB, com as caixas
  de marcar, faz o mesmo e continua lá.

## 1.31.0 — 2026-10-27

- **Nada do NexoEletric fica fora do NexoBD.** O "servidor central" antigo (192.168.15.192:8100) saiu do app: o campo
  dele nas Configurações, a biblioteca do servidor, o "Importar do servidor" e o link da BOM de lá. Projetos de
  qualquer máquina sobem para o NexoBD e descem em todas pelo Nexo Hub; as conversas do chat do hub também (item
  "Chat do NexoEletric"). Um settings.json antigo com o servidor central continua abrindo.
- **A BOM vem do NexoBD e abre em qualquer PC da rede local**, sem token: `http://<IP do NexoBD>:47810/bom/<projeto>`
  (ex. `/bom/dmb-di231765-p2`). O NexoEletric publica no NexoBD a página da BOM e a fonte de cada projeto (a cada
  mudança do esquema/PCB); os vistos da bancada ficam no NexoBD, com histórico. "Copiar link" e "Abrir numa aba" usam
  esse link; sem o Nexo Hub conectado, o painel avisa. Precisa do **NexoBD 1.9.0** (instale o NexoBD primeiro).
- Os projetos do servidor central foram migrados para o NexoBD (`tools/nexobd/migrar-central.mjs`, com `--simular`).

## 1.30.0 — 2026-10-27

- **Ctrl+F no Esquema procura componente.** Pedido do dono: "ctrl+F no esquema te ajuda a procurar um componente, por
  qualquer nome, designator, comentário, vai escrevendo e ele vai marcando". Abre uma caixa no alto da folha que procura
  em todas as folhas, sem diferenciar maiúscula nem acento. Busca no designador, no comentário (ou no Value, quando o
  comentário é fórmula do Altium), no símbolo, no footprint, nos parâmetros e na descrição.
  - Enquanto se digita, os achados da folha ficam marcados e a vista vai até eles.
  - Enter ou ↓ vão para o próximo e Shift+Enter ou ↑ para o anterior, trocando de folha quando precisa.
  - A lista mostra até 8 achados e aceita clique. Esc fecha e a seleção fica.
  - O designador exato vem primeiro: "r1" acha o R1 antes do R10. As partes de um componente (A, B...) são um achado só.
  - Também abre pelo menu do topo, em Editar › Localizar texto... A tecla aparece em Configurações › Atalhos e pode ser trocada.
- **Corrigido: o menu do topo não fechava ao clicar no esquema ou na PCB.** Depois de abrir um menu (por exemplo, um
  item com setinha ›), o clique dentro da vista não chegava à barra de menus, que fica fora da vista, e o menu ficava
  aberto. Agora qualquer clique dentro da vista fecha o menu.

## 1.29.0 — 2026-10-27

Pedido do dono: "tudo vem do DB … sem ele nada aparece, se ele não tá conectado fica tudo vazio". O caminho agora é
**Odoo → NexoBD → Nexo Hub → NexoEletric**, e o NexoEletric só fala com o Nexo Hub. A exceção é o envio da lista de
material e as consultas ao Odoo, que continuam indo direto ao Odoo.

- **Sem o Nexo Hub, o NexoEletric fica vazio.** Com o Hub fora do ar, ou no ar mas sem os dados:
  - não aparece nenhum projeto, esquema, símbolo nem footprint;
  - nada é gravado;
  - um aviso "Sem conexão com o Nexo Hub" aparece no hub e nas vistas Esquema e PCB.

  Quando o Hub volta, as páginas recarregam sozinhas, cheias. A pasta de trabalho virou só a memória de trabalho do app
  (ela é preenchida pelo Hub e nunca é mostrada sem ele). O MCP segue a mesma regra: sem o Hub, as ferramentas de
  projeto e de biblioteca respondem "sem conexão" em vez de ler uma cópia velha do disco.
- **O sincronismo com o Odoo roda no NexoBD.**
  - O botão Sincronizar e a configuração do Odoo (URL, banco, login, senha) pedem ao NexoBD pelo Hub, e o andamento
    aparece ao vivo como antes. A revisão nova da biblioteca chega sozinha.
  - O app não roda mais o gerador nesta máquina. Ele publica o gerador (guardião + almox2lib) no item "Ferramentas do
    Odoo", que o NexoBD usa.
  - Precisa do **NexoBD 1.7.0**. A senha do Odoo agora é gravada no NexoBD (painel do NexoBD › Odoo, ou nas
    configurações do Odoo do hub).
- **Footprints da PcbLib que vem do Hub.**
  - O `Libs/pcblib.js`, que o hub, as vistas e o MCP leem, era um arquivo gerado no Altium em 06/08, a partir de uma pasta
    de rede (Z:), e viajava congelado no instalador.
  - Agora ele é refeito da `FOOTPRINTS ALMOX.PcbLib` que o Hub traz do NexoBD, toda vez que ela muda. O
    `tools/pcblib/pcblib2js.py` lê a PcbLib sem o Altium: 609 de 618 footprints idênticos ao export do Altium e o resto só
    na ordem dos pads. Os nomes saem padronizados pelo rename-map.
  - O MCP com o app fechado também traz os corpos 3D dessa PcbLib, em vez de "indisponível".
  - O ApplyChanges do Altium carrega o footprint primeiro dessa PcbLib e só depois das bibliotecas instaladas no Altium.
- **Conectar IA no desenho do NexoCAD.** Ajuda › Conectar IA (MCP)… e o indicador IA no topo abrem uma tela própria, no
  lugar da caixa de mensagem do Windows, igual à "Conectar IA" do NexoCAD:
  - o comando do Claude Code e o JSON dos outros agentes, com Copiar;
  - a atividade recente da IA;
  - o botão **Registrar no Claude Code e no Claude Desktop**, que grava a mesma entrada que o Nexo Hub usa;
  - o estado do **Nexo Hub** ao vivo, numa linha só: conectado (com o endereço, a versão e a última sincronização) ou
    desconectado;
  - os botões **Tentar de novo**, **Conexão com o Nexo Hub…** (endereço e token) e **Abrir o Nexo Hub**.

  Quando o Hub cai ou volta, aparece uma notificação. Nas Configurações, no menu e no Sobre, o NexoEletric só fala do
  Nexo Hub.

Ordem de instalação: NexoBD 1.7.0 → Nexo Hub 2.13.0 → NexoEletric 1.29.0.

## 1.28.0 — 2026-10-23

- **O filtro de seleção no canto da PCB** (pedido do dono: "um menuzinho no canto superior esquerdo, em transparência,
  com esses filtros, em lista; posso marcar todos ou um por um, com checkbox"). É uma lista translúcida no canto
  superior esquerdo da vista PCB:
  - **Todos** marca ou desmarca tudo, e fica parcial quando só alguns estão marcados;
  - uma caixa para cada tipo: Componentes, Trilhas, Arcos, Pads, Vias, Regiões, Polígonos, Fills, Textos, Keepouts e
    Outros;
  - o cabeçalho mostra quantos estão ligados (ex.: 10/11) e recolhe a lista; o app lembra como você deixou.

  É o mesmo filtro do Selection Filter do painel: marcar num muda o outro.

## 1.27.1 — 2026-10-23

- **Fechar a página cancela o Enviar pra JLC** (pedido do dono). Se a vista PCB ou o app fecham depois do clique, o
  envio é cancelado (`/api/jlc/cancelar`) e não continua sozinho no navegador. Fechar o app inteiro também para o envio:
  o processo dele sai junto com o hub. Fechar a guia da JLC já cancelava desde a 1.27.0.

## 1.27.0 — 2026-10-23

- **Enviar pra JLC sem "Claude".** O botão nunca chamou o Claude, mas o IntegrateBrowser mostrava toda automação na
  janela "IntegrateBrowser — Claude", no grupo laranja "Claude". Agora a guia abre na **sua** janela do IntegrateBrowser,
  como uma guia normal, que vem para a frente. Precisa do Nexo Hub 2.12.0; num Nexo Hub mais velho ela abre na sua
  janela, mas ainda marcada como do Claude. As ferramentas `jlc_*` do MCP, que são o Claude de verdade, continuam na
  janela dele.
- **Fechar o navegador no meio do envio cancela na hora.** Antes o envio ficava esperando a guia fechada (até 5 minutos
  no login) e o botão continuava desabilitado. Agora vem o aviso "o navegador foi fechado — envio cancelado" e o botão
  volta.
- **Desfazer/Refazer no fim da fileira Placa | Gerber.** Os ícones ↶ ↷ saíram da barra de ferramentas da PCB e foram
  para o canto direito da fileira de sub-abas. Eles acendem quando há o que desfazer ou refazer. Ctrl+Z, Ctrl+Y e o menu
  Editar continuam valendo, inclusive com o foco fora da vista (depois de clicar numa aba, por exemplo).

## 1.26.0 — 2026-10-23

O Gerber sem a faixa de cima (pedido do dono: "pegue essa área toda bagunçada, cheia de informação, e transforma em um
menuzinho no canto superior esquerdo, transparente, com as opções em lista, sem muita escrita, e com ícones"):

- As duas barras de cima do visualizador de Gerber viraram **um menu translúcido no canto superior esquerdo**, em lista,
  cada item com ícone e rótulo curto: Gerar de novo, Baixar .zip, Salvar, Ver salvo, Enviar pra JLC, Abrir, Comparar,
  Enquadrar, Cima/Baixo, Camadas/Realista e Fechar. A placa ganhou a altura das barras.
- O que era texto corrido ficou recolhido dentro do menu:
  - **Opções**: nomes dos arquivos, camadas vazias, legenda .gto/.gbo, atributos X2 e o resumo do pacote;
  - **N avisos**: os avisos do gerador; o primeiro "ATENÇÃO" aparece passando o mouse.
- A setinha do cabeçalho recolhe o menu inteiro. O app lembra se ele ficou recolhido.

## 1.25.0 — 2026-10-23

A placa no carrinho da JLCPCB pelo IntegrateBrowser (pedido do dono: "em Gerber clicar em 'enviar pra JLC', ele já
abre o IntegrateBrowser e já coloca no carrinho da JLC o ZIP; pela quantidade de layers ele já sabe o que configurar;
só pergunta antes quantas placas", e uma skill no MCP para o mesmo processo):

- **Botão Enviar pra JLC** no visualizador de Gerber da vista PCB:
  - pergunta antes quantas placas, só entre as quantidades que a JLC vende (5, 10, 15, 20, 25, 30, 50, 75, 100…),
    e mostra as camadas de cobre e o tamanho da placa;
  - salva o Gerber no projeto e abre o orçamento da JLCPCB no IntegrateBrowser;
  - sobe o .zip, confere as camadas que a JLC leu contra as da placa (3 ou 5 camadas viram 4 ou 6, como a JLC
    fabrica), põe a quantidade e clica SAVE TO CART;
  - sem a conta aberta, a janela do navegador aparece e espera você entrar (a senha não passa pelo NexoEletric);
  - no fim, o resumo: o que a JLC detectou, camadas, quantidade e preço.

  O pedido para no carrinho: o pagamento fica com você.
- **No MCP:**
  - as ferramentas `jlc_preparar`, `jlc_enviar` e `jlc_login`;
  - a skill da casa `pcb-enviar-jlc`, com o passo a passo:
    1. conferir o DRC;
    2. perguntar a quantidade antes;
    3. pedir o login e a senha da JLC só quando a conta não está aberta;
    4. conferir a captura do carrinho antes de dizer "pronto".
  - A senha só é digitada no campo da JLC: não volta na resposta, não é gravada, e o indicador "IA" do app mostra
    `senha •••`.
- O motor é um só (`mcp/lib/jlc.js`): o botão roda o mesmo código pela rota `/api/jlc` do hub.
- Testes:
  - o fluxo inteiro contra um IntegrateBrowser de mentira (`tests/test-jlc.js`), com o caminho do login e a senha
    sem vazar;
  - as rotas (`tests/test_jlc_rotas.py`);
  - o botão e o modal da quantidade no smoke da vista.

## 1.24.0 — 2026-10-23

Duas regras novas do dono nas skills do MCP:

- **O plano de terra pode passar por baixo do overlay** ("plano de terra pode passar por cima de overlay"):
  `pcb-serigrafia-livre` e `pcb-producao-backplane` agora dizem com todas as letras — texto em cima do plano
  despejado não é violação, não se recorta o plano por causa de texto; continua proibido em cima de pad, via, furo,
  trilha e fill (aba de fill não é plano).
- **Trilha de conector lateral não pode ser fina** ("a trilha desses conectores laterais não pode ser tão fina"):
  `pcb-boas-praticas` e `pcb-producao-backplane` pedem ≥ 0,8 mm do pad do borne até o pino onde o sinal entra no
  barramento (0,254 só dentro do campo de pinos). Na CBM-DI251876 as trilhas do CN7/TB2 (PG, RUN, ERR, STERR)
  foram refeitas em 0,8 mm, raias mais abertas, cantos de 45° (no `changes.js` do projeto).

## 1.23.0 — 2026-10-23

O Polygon Pour editável na vista PCB, como no Canva (pedido do dono: "editar com clique e arraste, regular o tamanho,
clicando nas bordas" e "definir se o plano é Top, Bottom ou sem plano, uma área que não deixa o plano passar, só
trilha"):

- **Alças no que está selecionado.** Plano, sem plano, região, recorte, fill e um grupo de trilhas ganham a caixa
  com 8 alças: arrastar um canto ou uma borda (a alça ou a própria linha da caixa) estica ou encolhe a partir do lado
  oposto, na grade. Shift no canto mantém a proporção; Ctrl solta a grade; Esc desiste. Um polígono que não é
  retângulo mostra também os vértices, e arrastar um muda a forma. Tamanho e canto também se digitam no painel.
- **O plano é selecionável.** Clicar no contorno do Polygon Pour, ou no cobre despejado dele, seleciona o plano:
  mover, girar, espelhar, apagar, trocar a net, e o **Tipo**: Plano no Top, Plano no Bottom (ou numa interna), ou
  **Sem plano**. A troca entre plano e sem plano mantém o contorno.
- **Sem plano** é o Polygon Pour Cutout do Altium (`region_add` com `polycut:true`): o plano não entra na área, e
  trilha e via passam. Vale numa camada ou em todas (Multi). Na tela aparece hachurado. O despejo, o Gerber, o
  laser, o PDF e o DRC não o tratam como furo. O ApplyChanges o cria no Altium pelo mesmo caminho do Board Cutout
  (o Kind 1 escrito e relido).
- **A ferramenta Polygon Pour ficou direta.** O painel da ferramenta tem a Forma (retângulo em 2 cliques ou polígono
  livre), o Tipo e a Net (vem a de terra da placa). Não abre mais o menu de net a cada polígono. O que nasce fica
  selecionado, já com as alças.
- **As formas de desenho numa gaveta.** Linha, arco, círculo, retângulo, triângulo e polígono viraram um botão só na
  barra: ele mostra a última forma usada, e a setinha ao lado abre a gaveta com as outras.
- Correção: as teclas de Linha, Arco, Círculo, Retângulo, Polígono e Texto (L, A, O, R, G, T) escolhiam a ferramenta
  Furo desde a 1.17.0.
- Correção: o DRC, o laser e o PDF tratavam um recorte de polígono vindo do Altium como furo da placa.

O roteamento e o DRC com as mesmas regras, como no Altium (pedido do dono: "as regras precisam ser a mesma, a lógica
de roteamento também precisa ser igual"):

- **A Trilha (e o `pcb_rotear` do MCP) obedece as regras do projeto, as mesmas do DRC.** A folga de cada par sai da
  Clearance vencedora (escopo `InNet(...)`, prioridade e matriz de objetos), e a folga ao contorno sai da Board
  Outline Clearance. A camada que a Routing Layers da net não permite não recebe rota. Antes, a rota usava uma folga
  só para a placa inteira, e uma regra como "a net HV pede 1 mm" valia só no DRC.
- **Largura e via pela regra da net (o "Rule Preferred" do Altium).** A rota começa com a largura preferida da regra
  Width da net, e a via com a da Routing Via Style. O valor digitado fora da faixa da regra vira o limite dela, com
  aviso.
- **Via em cima de outra net é recusada também pelo MCP** (`pcb_via`), como já era na tela.
- O `pcb_rotear` não liga pad SMD pela camada errada nem grava rota que já sai da partida abaixo da folga (pad de passo
  fino com a largura da regra): responde o motivo, e a tela avisa.
- **DRC:** keepout passa a ser conferido contra o cobre, e trilha sem net em cima de furo NPTH é acusada.
- **A vista reabre a placa que nasceu no hub.** Os componentes trazidos pelo ECO aparecem ao reabrir o projeto. Antes
  ficavam com "footprint não encontrado" até alguém abrir o ECO de novo.
- **O MCP posiciona componente que veio do ECO** (`pcb_mover` edita a linha `comp_add`).
- Testes novos:
  - roteador × DRC par a par, em placas sintéticas e em placas reais do acervo;
  - quatro placas feitas do zero pelo MCP: esquema → ECO → posicionar → rotear → DRC → Gerber, com a furação conferida
    furo a furo;
  - smoke da vista PCB num Chrome headless (`tests/smoke-vista-pcb.js`).

## 1.22.0 — 2026-10-23

- **Skill de produção nova no MCP: `pcb-producao-backplane`** (pedido do dono: "seguindo a CBM-DI251877, faça a
  mesma lógica de roteamento e plano de terra para a CBM-DI251876 e crie uma skill de produção com ela"). A técnica
  da CBM-DI251877, com os números: campo sem plano em volta das fileiras (faixa limpa de 2,25 mm), GND no Top fora
  do campo, +5V no Bottom (e a 2ª fonte no canto dela, com 1,5 mm de vão), retângulo de GND no Bottom entre cada par
  de conectores, abas de GND/+5V dos pinos aos planos (dando a volta nos rótulos de serigrafia), corrente de +5V no
  meio das fileiras com entrada a 45°, leque em escada só com 45° (perfil único deslocado: chanfro 0,4, reta 1,0,
  degraus de 0,6 a cada 1,75), nenhum canto de 90°, sem via, quadrado do parafuso furo/2 + 3,05 em todos os planos,
  pontes nos cortes dos planos e a conferência antes de entregar.
- A CBM-DI251876 foi refeita com ela (no `changes.js` do projeto, não neste repositório): DRC 0, nenhuma net
  pendente, nenhum curto, nenhuma trilha fora de 0/45/90°, nenhuma via.

## 1.21.1 — 2026-10-22

- O instalador da 1.21.0 saiu sem as dependências do atualizador automático (`electron-updater`: o
  `node_modules` do build era um atalho para outra pasta e o empacotador não as achou). Mesmo código da 1.21.0,
  instalador refeito com as dependências dentro. Instale esta no lugar da 1.21.0.

## 1.21.0 — 2026-10-22

Boas práticas de PCB no MCP (pedido do dono: "trilha passando por cima de pad com net diferente não pode acontecer
de forma alguma"):

- **Três skills novas da casa** (chegam a toda IA que conecta no MCP): `pcb-cobre-sem-curto` (cobre de outra net
  nunca em cima nem perto de pad/via — pad passante vale no Top e no Bottom; trilha no meio do vão entre pinos;
  trilha da mesma net termina no pad; faixa não tapa o alívio térmico), `pcb-boas-praticas` (checklist pesquisado:
  IPC-2221, DFM de fabricantes e do Altium — folga por tensão, largura por corrente, anel, furo-cobre, borda, ângulo
  agudo, alívio, costura, serigrafia, teardrop) e `pcb-verificar-antes-de-entregar` (a sequência antes de dizer
  "pronto" e o que fazer com a foto de um problema).
- **`regras_casa_verificar` confere duas regras novas:** `pad_outra_net` (trilha, arco, via, pad, fill, região ou
  plano de outra net por cima de um pad/via = CURTO, ou mais perto que a Clearance do projeto) e
  `trilha_sobre_pad` (trilha da mesma net cruzando o pad sem terminar nele; faixa/região tapando o pad e o alívio
  térmico do plano). A placa conferida é a da tela.
- **`drc_rodar`, `nets_ratsnest` e `pcb_render` com os planos despejados, como a tela do app.** Antes o DRC do MCP
  não via o cobre dos polígonos (`poly_add`): o GND aparecia "não roteado" e um curto com o plano passava em branco.
  `despejar:false` volta ao jeito antigo. Novo `ctx.placaDespejada(p)` para as ferramentas.

## 1.20.0 — 2026-10-22

- **Gerar fixação em cima da marcação.** Na barra lateral da PCB (Propriedades, sem nada selecionado), a seção
  **Furos de fixação** tem o botão **Gerar fixação nas marcações (N)**: cada marcação redonda sem furo (círculo de
  serigrafia, mecânica…) ganha um furo de fixação (Board Cutout) do diâmetro dela, e a marcação fica. Com círculos
  selecionados, só neles; marcação que já tem furo não ganha outro. O mesmo botão aparece com o círculo selecionado,
  na seleção de vários, no painel da ferramenta Furo e no clique direito.
- A ferramenta **Furo** clicada numa marcação também gera o furo em cima dela, mantendo o desenho. Quem quer tirar o
  desenho usa **Virar furo (tira o desenho)**.

## 1.19.0 — 2026-10-22

- **A versão na barra de cima.** O título de toda janela do app mostra a versão instalada: "Projeto · Documento —
  NexoEletric 1.19.0" (a janela principal, Nova janela, as vistas abertas à parte e as configurações).

## 1.18.0 — 2026-10-22

PCB mais perto do Properties do Altium:

- **Clicar no componente edita o componente.** Clicar num pad do componente (o jeito mais comum de "clicar no
  componente") agora mostra o componente editável em cima: posição X/Y, rotação, lado (Top/Bottom) e comentário, com
  Selecionar componente, Girar 90°, Virar e Editar footprint. Os dados do pad continuam embaixo.
- **Pad solto editável inteiro:** tipo (SMD, passante, furo NPTH), lado, net, designador, forma, tamanho X/Y, raio
  do canto, furo (diâmetro, forma e comprimento do oblongo), posição e rotação — e agora ele anda no arrasto e sai
  com Delete. Vale para o pad posto pela ferramenta Pad e para o pad solto do Altium.
- **Círculo vira furo de fixação.** Selecione um círculo desenhado (serigrafia, mecânica, cobre) e clique na
  ferramenta **Furo**, ou, com a ferramenta Furo na mão, clique no círculo: ele vira o furo de fixação (Board Cutout
  redondo) do mesmo diâmetro. Também no botão "Virar furo de fixação" do painel e no clique direito.
- **Furo de fixação editável:** diâmetro e centro no painel. O círculo mostra o diâmetro também.
- **As cores das camadas no seletor de camada** (trilha, retângulo, círculo, texto, região, ferramentas e o lado do
  componente): a lista mostra a amostra da cor de cada camada, e o menu "Camada" do clique direito também.
- A net de um arco que já existia não aparece mais como editável (o ApplyChanges não a troca; antes a mudança se
  perdia calada); no arco novo continua editável. A lista de Mudanças dá nome a todas as ops (pad, polígono,
  componente, net…), sem os "??".

## 1.17.0 — 2026-10-22

- **Skills da casa no MCP.** As regras de projeto da Dieletrons agora moram em `mcp/skills/*.md` e chegam a qualquer IA
  que use o MCP do NexoEletric: resumo nas instruções do servidor, recursos `eletrichub://skill/<nome>`, prompts
  `skill_<nome>` e as ferramentas `skills_listar` / `skill_ler`. As três primeiras:
  - **pcb-parafusos-isolados** — furo de parafuso/fixação dentro de um quadrado sem cobre nenhum (furo + 3 mm), nas
    duas camadas;
  - **pcb-plano-folga-pads** — plano de terra a 1,0 mm dos pads de outra net (a fileira de pads fica numa faixa limpa),
    pinos do plano com alívio térmico;
  - **pcb-serigrafia-livre** — overlay nunca em cima de pad, via, furo, trilha, outra serigrafia ou da borda.
- **`regras_casa_verificar`** confere a placa (com os planos redespejados) contra as três regras e diz cada
  violação com posição e objeto, e quais são os furos de parafuso com o quadrado de cada um.
- **Polígono:** o `poly_add`/`poly_edit` aceita `clearanceTipo` (folga por tipo de objeto — ex. `{th:1, smd:1}` afasta
  o plano só dos pads), `clearanceNet` e o objeto `conexao` ({tipo, condutores, largura, gap, angulo}), que o
  despejo do hub já entendia mas o changes.js descartava.

## 1.16.0 — 2026-10-22

- **A IA no topo do app.** Um indicador **IA** no canto de cima (ao lado do chat, na fileira das abas), como no
  NexoCAD: cinza sem IA, verde com quem está conectado ("IA · Claude Code"), laranja pulsando com o comando que ela
  acabou de rodar. Cada comando que muda algo aparece num aviso no canto, e o clique abre o painel com a conexão, o
  botão **Conectar IA (MCP)…** e a **atividade recente da IA** (hora, ferramenta, projeto, o que mudou ou o erro).
- **O MCP conecta sozinho.** O registro antigo apontava para `C:\NexoEletric`, que não existe em todo PC, e o MCP
  nem subia. Agora ele acha a pasta: a do app aberto (o app grava `~/.nexoeletric/session.json`, a mesma mecânica do
  NexoCAD), senão a pasta de trabalho configurada. O manifesto não leva mais `--root`.
- **MCP completo (90 ferramentas):**
  - **símbolo:** `sym_ler`, `sym_gerar` (CI/conector a partir da lista de pinos), `sym_salvar` (no esquema do projeto,
    na Biblioteca de símbolos ou redesenhando um da SchLib da casa), `sym_renomear`, `sym_apagar`;
  - **3D:** `fp_3d_importar` (STEP do disco no footprint) e `fp_3d_nexo` (modelo da biblioteca da rede Nexo);
  - **placa:** `pcb_colocar` (footprint como componente novo, com as nets) — e o `comp_add` passa a achar os
    footprints da biblioteca (antes só os que já estavam na placa);
  - **app:** `app_status`, `app_abrir` (abre o NexoEletric e espera), `vista_abrir` (mostra o projeto ao usuário) e
    `lote` (vários comandos numa chamada, como o batch do NexoCAD);
  - **NexoBD:** `nexo_projetos`, `nexo_projeto_historico` e `nexo_projeto_restaurar` (volta uma revisão);
  - **Esquema ao vivo:** a IA foca, seleciona (componente, net, folha) e roda ações na vista Esquema aberta, como já
    fazia na PCB; `projeto_abrir_altium` traz esquema e PCB.

## 1.15.0 — 2026-10-22

- **Abrir projeto do Altium com esquema E PCB.** Arquivo › **Abrir projeto do Altium** (ou arraste o arquivo para a
  janela) e escolha só o **.PrjPcb**: o NexoEletric acha as folhas e a placa pelo próprio projeto e cria tudo sozinho,
  como o ExportProject + ExportBoard deixariam — o esquema (`schematic.js`), a PCB (`board.js`), as regras da placa
  (`rules.js`), o 3D (`board3d.js` + os modelos) e o `changes.js`/`annotations.js` vazios. O Altium nem precisa estar
  instalado, e os arquivos do Altium só são lidos (podem estar no W:). Também aceita um `.SchDoc` ou um `.PcbDoc`
  soltos. Projeto que já existe pergunta antes de substituir (o anterior fica como `.bak`). O projeto novo sobe para o
  NexoBD como os outros.
- **Arrastar e soltar:** solte o `.PrjPcb` (ou `.SchDoc`/`.PcbDoc`) em qualquer lugar da janela, inclusive em cima do
  Esquema ou da PCB; o aviso "Solte o projeto do Altium…" aparece enquanto o arquivo está sobre a janela.
- Na barra de menus da página, **NexoBD: sincronizar agora** no lugar de "Importar do servidor", e o
  "Nexo Hub: sincronizar agora" dali volta a funcionar.

## 1.14.0 — 2026-10-22

- **Nada mora mais no NexoEletric: tudo vai para o NexoBD.** Projetos, biblioteca e os scripts do Altium ficam no
  NexoBD, pelo Nexo Hub desta máquina. A pasta de trabalho passa a ser só uma cópia: o que você salva (esquema, PCB,
  regras, sinalizadores, Gerber, PDF) sobe sozinho uns segundos depois; o que mudou no NexoBD (o Altium exportou, outra
  máquina salvou) chega aqui e o hub recarrega. Apagar a pasta não apaga nada: ela volta do NexoBD na abertura. Sem o
  NexoBD, o hub abre com a última cópia e o que você salvar sobe quando ele voltar.
- **Projetos:** um item por projeto no NexoBD, fora do catálogo (NexoBD 1.5.0): aparecem só aqui. "Excluir projeto"
  (senha mestre) manda a pasta para o Trash e apaga o projeto no NexoBD.
- **Biblioteca:** os símbolos, os footprints e o almoxarifado sincronizado com o Odoo (com as `.SchLib`, a `.PcbLib` e
  o `ALMOX.DbLib` do Altium) são um item do NexoBD; cada sincronismo do Odoo vira uma revisão. Antes de sincronizar, o
  app traz a versão do NexoBD. A biblioteca do servidor (192.168.15.192) e o "Importar do servidor" saem de cena
  (voltam se o NexoBD for desligado nas configurações). O login do Odoo agora fica neste PC: Biblioteca › Almoxarifado.
- **Altium:** os scripts (ExportProject, ExportBoard, BuildSchematic, ApplyChanges) vão para o NexoBD a cada versão, e
  o **Nexo Hub 2.7.0** os põe na pasta do Altium dele, aponta o `home.txt` para ela e sobe o que o Altium exportar. O
  app não mexe mais no `home.txt` (a caixa "Apontar o Altium" sai das configurações).
- Arquivo › **NexoBD: sincronizar agora**; Ajuda › Sobre mostra o estado. Conflito (o mesmo arquivo mudou aqui e no
  NexoBD) fica com o daqui, e o do NexoBD é guardado em `.altiumhub/conflitos-nexobd`.
- Precisa do **NexoBD 1.5.0** e do **Nexo Hub 2.7.0**: instale nessa ordem, e o NexoEletric por último.

## 1.13.0 — 2026-10-19

- **Uma biblioteca de footprints só.** Os footprints criados no editor, pela IA (MCP) ou vindos do NexoCAD ficam na mesma biblioteca que os do Altium, sem a marca "hub" / "hub · 3D": a galeria, o editor de footprint, a troca de footprint no Esquema e a faixa de Footprints da Biblioteca mostram tudo junto, em ordem alfabética, com a marca "3D" quando o footprint tem modelo.
- **As peças do NexoCAD entram direto na biblioteca de footprints.** Componente eletrônico criado ou editado no NexoCAD (item componente do Nexo Hub com footprint) vira o 3D desse footprint na biblioteca do NexoEletric, sem passar pelo editor. O app olha o Nexo Hub a cada minuto; o footprint que só existia no Altium entra junto, com os pads dele. Componente cujo footprint ainda não existe fica avisado no log (crie o footprint e ele entra sozinho).
- **MCP:** ferramenta nova `nexo_componentes` (traz agora e diz o que entrou, o que falta footprint e os conflitos); o `nexo_vincular_footprint` já põe (ou tira) o 3D do footprint na hora; o `nexo_sincronizar` traz os componentes antes de publicar. As ferramentas de esquema (`sch_buscar_footprint`, `sch_simbolo`, `sch_validar`) e o ECO passam a ver os footprints que a IA criou com o `fp_salvar`.
- O editor de footprint relê a biblioteca antes de salvar: o que a IA ou o NexoCAD gravou enquanto ele estava aberto não se perde.

## 1.12.1 — 2026-10-19

- **Sem 3D inventado na PCB.** Componente que não tem modelo 3D aparece no 3D da placa só com o footprint (pads e serigrafia), sem a caixa genérica que o hub punha no lugar. Na ficha do componente, o 3D Body diz "nenhum — no 3D aparece só o footprint".

## 1.12.0 — 2026-10-19

- **Vista 3D da PCB instantânea, como no Altium.** O 3D da placa é montado sozinho, escondido, logo que a vista PCB abre, e se refaz em segundo plano depois de cada mudança, quando a tela para. A tecla **3** só mostra o 3D e a **2** só esconde: não há mais a espera a cada troca. A câmera fica onde estava entre uma ida e outra (o Flip Board recoloca).
- **A silhueta do 3D na placa.** O contorno azul que o editor de footprint mostra de cada corpo 3D aparece também na vista PCB, em todo componente que tem modelo 3D (STEP, extrudado, cilindro ou esfera). A silhueta é do componente: não se seleciona nem se move sozinha. Clicar ou arrastar nela pega o componente inteiro, e ela anda junto no arrasto. Segue a visibilidade da camada Top Overlay ou Bottom Overlay do lado do componente.

## 1.11.1 — 2026-10-16

- **Solda embaixo virou uma caixa de visualização, para a placa inteira.** Na vista PCB, painel **Vista**, a caixa **Solda embaixo no 3D**: desmarcada, o pino passa normal; marcada, o pino de todo componente para na placa e cada pad passante mostra o ponto de solda na outra face. Não altera footprint nem placa, e o 3D enviado ao NexoCAD continua com o pino inteiro. A mesma caixa fica na barra do editor de footprint (marcar numa vale na outra).
- Sai a opção por footprint da 1.11.0 (o campo no painel do editor e a ferramenta `fp_solda` do MCP): a caixa decide sozinha.

## 1.11.0 — 2026-10-16

- **Solda embaixo no 3D.** O footprint ganhou a opção **Solda embaixo** (editor de footprint, painel Footprint). Ligada, o pino do componente só aparece do lado dele: o que passaria da face de baixo é cortado. Embaixo de cada pad passante aparece o ponto de solda, um cone de estanho que vai do tamanho do pad até a ponta do pino. Vale no 3D do editor e no 3D da placa, nos modos Padrão e Real View. Componente montado embaixo fica com a solda em cima.
- **MCP:** a ferramenta `fp_solda` liga e desliga a opção, e o `fp_salvar` aceita `solda:true`.

## 1.10.0 — 2026-10-16

- **Guias na vista PCB, como no Esquema.** Ao arrastar um componente, ele gruda borda com borda e centro com centro nos vizinhos e no centro da placa. O centro de cada pad gruda no centro dos pads vizinhos, nas vias e nas pontas de trilha, para a trilha sair reta. Também acha o espaço igual da fileira e mostra numa pílula o vão até o componente vizinho de cada lado. A barra de status diz qual guia pegou, e o **Ctrl** solta as guias junto com o snap. Via e trilha arrastadas também alinham pelo centro e pelas pontas.
- **Guias no editor de footprint.** O pad arrastado gruda centro a centro com os outros pads (nos dois eixos), borda com borda, no passo igual da fileira e na origem do footprint. As pílulas mostram o vão até o pad vizinho, e a barra de status mostra a distância centro a centro até o pad mais perto. A linha e o arco da serigrafia grudam nas pontas e no centro dos pads. O **Ctrl** solta as guias.
- **Ctrl+W desenha trilha, como no Altium (Interactive Routing).** É a mesma Trilha do W: trilha de outra net nunca se encontra com ela. O roteador acha sozinho o caminho em volta do obstáculo, sem deformar o que já está na placa (Shift+R troca para parar no obstáculo ou ignorar). O W continua valendo.

## 1.9.2 — 2026-10-15

- **Editar no NexoCAD com confirmação:** o aviso "✔ Enviado ao NexoCAD: <nome>" fica 6 segundos na tela, e a janela do NexoCAD (0.8.1) vem para a frente com o item aberto.
- O componente vai sozinho, sem o desenho dos pads do footprint junto.

## 1.9.1 — 2026-10-15

- **Adicionar componente 3D com a biblioteca do Nexo Hub:** os componentes aparecem em cards, cada um com a miniatura do modelo, o nome e o footprint que o usa. O mesmo modelo aparece uma vez só, e os que foram editados no NexoCAD vêm marcados.
- As miniaturas são geradas pelo próprio Nexo Hub (1.0.1) para todo componente, inclusive os da PcbLib da casa, e também aparecem no catálogo do Nexo Hub.

## 1.9.0 — 2026-10-15

- **O EletricHUB agora se chama NexoEletric.** O instalador troca o EletricHUB instalado pelo NexoEletric, sem deixar os dois. Configurações, preferências, projetos e a pasta de trabalho (`C:EletricHUB`) continuam como estão; numa instalação nova a pasta padrão é `C:NexoEletric`.
- **Na rede Nexo Hub.** A biblioteca 3D e as placas vão sozinhas para o Nexo Hub, o banco comum aos programas da casa: cada modelo 3D dos footprints aparece na biblioteca do NexoCAD, e cada placa também. Roda ao abrir e sempre que um footprint ou uma placa muda, em segundo plano. Para forçar: **Arquivo › Nexo Hub: sincronizar agora**; o estado está em **Ajuda › Sobre o NexoEletric**.
- **Editar 3D no NexoCAD** e **Enviar placa ao NexoCAD** passam pelo Nexo Hub: o NexoCAD abre o próprio item, e o que for salvo lá aparece aqui no 3D, como antes.
- **MCP:** o servidor se chama `nexoeletric` (o registro antigo continua valendo) e ganha `nexo_sincronizar`.

## 1.8.1 — 2026-10-15

- **Enviar placa ao NexoCAD à vista:** na vista PCB, direto no menu **Arquivo**, logo abaixo de Exportar (que também o tem), e no botão direito da placa também no 2D, não só no 3D.

## 1.8.0 — 2026-10-15

- **Ligado ao NexoCAD.** Os dois programas usam a mesma biblioteca 3D (`C:\Users\Public\Dieletrons\Biblioteca`).
- **Editar 3D no NexoCAD:** botão direito num componente na PCB (2D ou 3D), ou no corpo 3D do editor de footprint. O NexoCAD abre o modelo, com os pads do footprint como referência. Ao salvar lá (Ctrl+S), o 3D se atualiza aqui na hora, sem recarregar.
- **Adicionar componente 3D** também lista os componentes eletrônicos da biblioteca do NexoCAD, com miniatura.
- **Enviar placa ao NexoCAD:** em Arquivo › Exportar, ou com o botão direito no 3D. A placa vai com contorno, furos, espessura e componentes; no NexoCAD dá para criar a caixa em volta dela, com as aberturas dos conectores.
- **MCP:** grupo nexo, para a IA mandar coisas de um programa para o outro: nexo_estado, nexo_biblioteca, nexo_editar_modelo, nexo_enviar_placa, nexo_vincular_footprint.

## 1.7.1 — 2026-10-15

- **Arrastar o componente 3D direto com o mouse** no editor de footprint: clique em cima e arraste, sem precisar das setas (elas continuam para mover num eixo só). O ímã nas pernas e nos pads continua valendo.
- **Sincronizar pino e pad.** Clique no componente, depois na perna do pino 1 e depois no pad 1, e aperte **S**. O componente vai para o lugar com aquele pino no centro do pad e já gira (0/90/180/270°) para pôr o máximo de pernas sobre os pads. A barra de baixo mostra o resultado, por exemplo "8 de 8 pernas nos pads".
- **Barra de ferramentas mais enxuta:** sobra um ícone, **Adicionar componente 3D** (P,B). Saíram as ferramentas de criar e girar corpo 3D (extrudado, cilindro, esfera, +90°, encaixar e trocar modelo). Os componentes 3D vão vir do NexoCAD.

## 1.7.0 — 2026-10-15

- **Posicionar o modelo 3D direto na vista 3D do editor de footprint**, como nos programas de CAD:
  - **Selecionar:** clique no corpo; a ficha dele abre ao lado.
  - **Mover num eixo:** arraste uma das setas, **X** (vermelha), **Y** (verde) ou **Z** (azul, sobe e desce).
  - **Mover livre no plano:** arraste o quadrado amarelo ou o próprio corpo.
  - **Pelo teclado:** setas movem em X e Y; **PageUp/PageDown** sobem e descem (com Shift, 10 passos).
- **Ímã:**
  - **Pernas nos pads:** perto deles, as pernas do modelo encaixam no centro, na posição que põe mais pernas sobre pads ao mesmo tempo. A barra de baixo mostra quantas encaixaram.
  - **Altura:** o corpo assenta na placa, ou a perna atravessa até a face de baixo.
  - **Fora do alcance:** vale o passo da grade.
  - **Shift:** segurado durante o arraste, solta o ímã.

## 1.6.1 — 2026-10-15

- **Real View pelo ícone da barra lateral:** na placa, no painel **Vista** (ao lado de "Ver por baixo"); no editor de footprint, nas **Ferramentas**. Ligar abre o 3D já no Real View; clicar de novo volta às cores de sempre. A escolha fica gravada.
- Saíram o modo **Render** e o seletor do canto da vista 3D; o Real View usa o estúdio e pads de estanho.

## 1.6.0 — 2026-10-15

- **3D realista: Real View e Render.** No canto da vista 3D (PCB e editor de footprint) há um seletor **Padrão · Real View · Render**:
  - **Real View** (o do SolidWorks): materiais físicos com reflexo de estúdio e sombra macia no piso. Pinos e terminais em estanho, ouro ou cobre de verdade; corpo de CI em epóxi acetinado; plásticos com verniz ou foscos.
  - **Render** (o do Blender): parado, a imagem vai se limpando em 128 amostras, com sombra de luz de área, oclusão nos cantos e serrilhado zero.
  - **Ambiente e acabamento:** escolha o ambiente (Estúdio ou Interior) e o acabamento dos pads, Estanho (HASL) ou Ouro (ENIG).
- **A placa com textura:** máscara com verniz, trilhas em relevo sob a máscara, serigrafia fosca e a borda de FR4 com a trama da fibra de vidro.
- **Modelos 3D mais lisos:** as curvas do STEP agora saem arredondadas, sem facetas, e os cilindros têm o dobro de lados.

## 1.5.0 — 2026-10-15

- **Esquema do Altium aberto direto no hub, sem o Altium.** Use **Arquivo › Abrir documento do Altium (.SchDoc / .PrjPcb)…** e escolha o .PrjPcb junto com as folhas; o projeto abre na aba Esquema. Vem tudo, como o ExportProject traria:
  - componentes, com footprint, parâmetros e posição do designador e do comentário;
  - fios, rótulos, power, ports, junções, No ERC e textos;
  - o template da folha e os parâmetros do carimbo.
  O símbolo que só existe dentro do .SchDoc aparece desenhado, e não mais como quadrado vermelho. O .SchDoc só é lido, nunca alterado.
- **Componente espelhado e girado 90°/270° no Esquema:** o hub girava e espelhava na ordem inversa da do Altium e punha os pinos trocados, o que quebrava as ligações nesses pinos. Agora segue a ordem do Altium.
- **MCP:** `projeto_abrir_altium` faz o mesmo pela IA.

## 1.4.0 — 2026-10-15

- **Editor de footprint com a barra do Altium (Active Bar)** no alto da área de trabalho, cada botão com as variantes no triângulo:
  - **Seleção:** tudo, só pads, só serigrafia, só corpos 3D, inverter e limpar.
  - **Mover e girar:** mover por X,Y (M,X), girar 90° ou por ângulo, espelhar em X e Y, duplicar e apagar.
  - **Alinhar e distribuir:** A,L / A,R / A,T / A,B / A,C / A,E / A,D / A,S.
  - **Desenho:** pad, linha e retângulo (P,R), arco e círculo (P,U).
  - **Corpo 3D:** da biblioteca, STEP do computador, extrudado, cilindro e esfera.
  - **Medir distância:** Ctrl+M.
  - **Origem do footprint (Set Reference):** no pino 1 (E,F,P), no centro (E,F,C) ou num ponto (E,F,L).
  - **Assistente de footprint:** T,W.
  - **Enquadrar.**
- **Os modelos 3D da BIBLIOTECA DE FOOTPRINT do Altium no hub.** O footprint do Altium abre com o modelo dele (tecla 3 mostra em 3D), e a lista marca "3D" nos que têm modelo. **Place 3D Body** (P,B) escolhe entre os 330 modelos STEP da PcbLib, procurando pelo nome do modelo ou do footprint que o usa, e já traz a rotação com que esse footprint o usa. Os modelos saem da própria PcbLib, sob demanda; nada é copiado para o repositório.
- **Assistente de footprint:** chip (2 terminais), SOIC/SOP, QFP/LQFP, DIP, SOT-23 (3, 5 e 6 pinos) e barra de pinos (1 ou 2 fileiras). A numeração segue a do Altium, a serigrafia leva a marca do pino 1 e o corpo 3D vem do tamanho do corpo.
- **A vista 3D enquadra também os componentes**, e peça alta numa placa pequena não fica mais cortada.
- **MCP: a IA edita footprint.** Grupo novo com 8 ferramentas: `fp_buscar`, `fp_ler`, `fp_salvar`, `fp_pacote` (o assistente), `fp_modelos3d`, `fp_corpo3d` (prende um STEP), `fp_apagar` e `fp_vincular` (footprint a componente). As ferramentas gravam só na biblioteca de footprints do hub.

## 1.3.3 — 2026-10-15

- Biblioteca › Componentes: a faixa de baixo fica na ordem **Componentes | Símbolos | Footprints**.

## 1.3.2 — 2026-10-15

- **As quatro vistas da Biblioteca no molde da Símbolos.** Geral, Componentes, Footprints e Símbolos têm as sub-abas no alto, a lista com a busca à esquerda, a área de trabalho no meio e o painel (Ferramentas / ficha) à direita, com as mesmas larguras.
- **Footprints virou o editor de footprint**, igual ao editor de símbolos: lista com miniatura e "+ Novo footprint" à esquerda; editor com 2D/3D, desfazer/refazer, camadas, unidade e grade no meio; Ferramentas em ícones (pad, linha, arco, STEP, extrudado, cilindro…), propriedades e Salvar / Salvar como / Duplicar / Apagar à direita.
- **O footprint se vincula pela aba Componentes**, como o símbolo: a faixa de baixo ganhou **Footprints**, com **Aplicar footprint ao componente** e **Desvincular footprint** (duplo clique aplica; botão direito abre no editor).
- A vista Geral volta a desenhar o símbolo e o footprint depois de mexer nas outras vistas.

## 1.3.1 — 2026-10-14

- **Criar e editar footprint na Biblioteca › Footprints**, no layout de sempre da aba. **Novo footprint…** e **Editar footprint** ficam na fileira de ações (o botão direito num footprint da galeria também edita). O editor abre no lugar da galeria, com o mesmo desenho da vista de footprint do hub: pads, serigrafia, arco e o corpo 3D (STEP, extrudado, cilindro), com 2D/3D e as teclas do Altium (P,P, P,L, P,A, P,B). **Aplicar a <componente>** salva e vincula o footprint ao componente escolhido; **← Galeria** volta.
- **A galeria mostra os footprints do hub** (marca "hub", "hub · 3D" quando têm modelo) junto com os do Altium, e a vista Geral passa a desenhá-los.
- **Footprint criado no hub pode ser vinculado a componente** da biblioteca e do almoxarifado. Antes o servidor só aceitava os da PcbLib do Altium.
- **Esquema: Trocar footprint… abre a galeria**, com o desenho, os pads, a origem (Altium ou hub), o modelo 3D e o teste "todos os pinos do símbolo têm pad". O filtro **só os que servem** deixa só os footprints compatíveis com o símbolo. Ferramentas › Gerenciador de footprints com um componente marcado abre a mesma galeria. A PCB recebe no Design › Update PCB.

## 1.3.0 — 2026-10-14

- **Vista 3D na PCB, como no Altium: tecla 3** (2 volta ao 2D; também em Exibir › Modo de layout 3D). A placa aparece com os furos, a máscara, o cobre, a serigrafia e os componentes. Componente sem modelo 3D aparece como uma caixa. Gira com **Shift + botão direito** (ou arrastando), arrasta com o botão direito, aproxima com a roda. Exibir › **Controle da vista 3D** tem as poses do Altium: 0 topo, Ctrl+0 base, 8 isométrica, 9 gira 90°, setas giram 30°. Ctrl+F vira a placa. Clicar num componente o seleciona.
- **Editor de footprint (o PCB Library do Altium) dentro do EletricHUB.** Abre pelo botão direito no componente (**Editar footprint…**), pela ficha dele, por Ferramentas › Gerenciador de corpos 3D na PCB e por Ferramentas › Gerenciador de footprints no Esquema. Tem a lista de footprints e as camadas Top, Bottom, Multi-Layer, Top Overlay e Mechanical (3D). As Properties seguem as do Altium (Designator, Layer, Size and Shape, Hole Information). Teclas do Altium: **P,P** pad, **P,L** linha, **P,A** arco, **P,B** corpo 3D, Espaço gira, Ctrl+Z desfaz. Tecla 3 mostra o footprint em 3D.
- **Corpo 3D no footprint: o STEP do fabricante.** P,B (ou soltar o .step na área de trabalho) prende o modelo ao footprint. "Encaixar nos pads" centraliza e assenta o modelo na placa; Rotation X/Y/Z e Z Offset acertam o resto. Também há corpo extrudado (caixa) e cilindro. O modelo aparece na PCB em 3D em todos os componentes com esse footprint.
- **Os footprints editados ficam numa biblioteca do hub** (Libs/pcblib-hub.js); a PcbLib do Altium não muda. O do hub vale no lugar do de mesmo nome do Altium. Salvar com pads diferentes oferece atualizar os componentes que já estão na placa (o "Update PCB With" do Altium), no mesmo lugar e com as mesmas nets.
- **Esquema: o footprint se escolhe na ficha do componente**, antes de levar para a PCB. Mostra pads e modelo 3D e avisa quais pinos do símbolo não têm pad, que o ECO acusaria. Tem "Editar footprint…" e "Ver em 3D". A PCB recebe no Design › Update PCB.
- Com a biblioteca do servidor, os footprints e os STEP ficam no servidor, como o resto da biblioteca. O servidor precisa estar nesta versão do hub para aceitar o STEP.

## 1.2.9 — 2026-10-14

- **Menus só com o que o EletricHUB faz.** Comando do Altium que o hub não executa saiu dos menus (barra de cima, botão direito e menus das letras), em vez de ficar cinza; menus que ficaram vazios (Projeto, Janela...) sumiram. As Preferences também mostram só as opções que funcionam.
- **Gerber e PDF só no Arquivo:** Arquivo › Saídas de fabricação › Arquivos Gerber e Arquivo › Smart PDF. Saíram da barra de ferramentas da PCB.
- **PCB sem as sub-abas Componentes e Nets.**
- **Painel da placa mais limpo:** o bloco Placa (arquivo, tamanho, contagens) saiu, e o filtro virou o **Selection Filter** do Altium: All - On/Off e um botão pequeno por tipo.

## 1.2.8 — 2026-10-14

- **Uma barra de menus só, no topo da janela, no tema do hub.** Arquivo, Exibir e Ajuda do app se juntaram aos menus do Altium: em **Arquivo** fica tudo do File, em **Exibir** tudo do View, em **Ajuda** o Help — e o Sair no fim do Arquivo. A barra nativa do Windows sumiu (ela não seguia o modo escuro/claro); os atalhos dela (F5, F11, Ctrl+,) continuam valendo.
- **Os menus mudam com a vista, como no Altium.** No Esquema, os menus do editor de esquema (com Simulador); na PCB, os do editor de placa (com Rotear); nas outras abas, só Arquivo, Exibir e Ajuda.
- **No idioma do sistema.** Em português os menus vêm traduzidos (Colocar, Ferramentas, Relatórios…); em inglês, os nomes do Altium. Troca junto com o idioma das Configurações.
- **Atalhos do Altium como padrão.** As letras abrem os menus como no Altium: **T, D, R** = Ferramentas › Verificação de regras › Rodar; **P, T** = trilha; **D, R** = regras. Vale nas duas vistas. As teclas de antes continuam em Configurações › Atalhos › **Padrão EletricHUB**.
- **Painel Projetos: Todos | Só o atual.** Mostra todos os projetos da pasta ou só o aberto (a busca continua procurando em todos).

## 1.2.7 — 2026-10-14

- **A vista PCB com os menus do Altium.** Barra de menus **File · Edit · View · Project · Place · Design · Tools · Route · Reports · Window · Help** em cima da placa, com a mesma ordem e os mesmos nomes do Altium Designer 21 (lidos do próprio Altium). F10, ou Alt + a letra, abre pelo teclado. O que o hub ainda não faz aparece cinza, com o porquê.
- **Botão direito igual ao do Altium.** Sobre um objeto, o menu "Right Mouse Click Primitive" (Place, Component Actions, Net Actions, Align, Cut/Copy/Paste, Comment, Preferences, Properties...); no vazio, o "Free Space". Component Actions aparece no componente e no pad dele (Select Component Nets, Move Component Origin To Grid...). Camada, Virar de face e Sinalizar continuam no fim do menu.
- **Teclas que abrem menu.** Com a predefinição **Padrão Altium** dos atalhos, P, D, T, U, V... abrem o menu no cursor e a letra seguinte escolhe (P,T trilha · D,R regras · T,D DRC), como no Altium.
- **Tools › Preferences (T,P).** A janela de Preferences do PCB Editor do Altium: General (Online DRC, Cursor Type, duplo clique), Display, Interactive Routing (modos de conflito do Shift+R, largura pela trilha existente, Default/Preferred), Mouse Wheel Configuration (com Padrão Altium), Defaults (largura, via, pad, texto), Layer Colors e **Keyboard Shortcuts**. O padrão é o comportamento de antes.
- **Properties do componente no formato do Altium:** Location, Properties, Footprint e Primitives; os campos das outras fichas com os nomes do Altium (Layer, Width, Hole Size...).
- **Ajuda › Conectar IA (MCP)** e os módulos da vista PCB (DRC, regras, polygon pour, ECO, roteador, PDF de layout) entram no app.

## 1.2.6 — 2026-10-01

- **A Parte sempre à vista.** Na ficha (Propriedades), a **Parte** aparece como seletor em todo componente: no de uma parte só ela fica travada em "1 de 1", e o *title* diz por quê (desenhar as partes no editor de símbolos, ou trocar por um componente que as tenha). No **Trocar componente**, o **PARTE** do rodapé aparece desde a abertura, travado enquanto o componente tem uma parte, e destrava ao escolher um componente de várias. Antes os dois sumiam no componente de uma parte, e a troca de parte parecia não existir.

## 1.2.5 — 2026-09-30

- **Enviar para o Odoo: os botões no fim da linha.** **resolver** e **remover** (e o **devolver** das linhas tiradas) ficam no fim de cada linha, alinhados na lista inteira — o remover sempre na borda, o resolver à esquerda dele. Antes eles vinham colados ao texto da resolução e mudavam de lugar de uma linha para a outra.

## 1.2.4 — 2026-09-30

- **A parte se troca na ficha, direto na folha.** Clique no componente: se o símbolo tem várias partes, a **Parte** das Propriedades é um seletor com todas elas, como o Part do Altium. Cada opção diz os pinos da parte, se ela já está colocada noutro item do mesmo designador (escolher uma dessas troca os dois) e se os pinos dela não têm pad no footprint. Um Ctrl+Z desfaz. Antes a ficha contava só as partes da folha, e um componente de duas partes com a 1 colocada dizia "1 de 1".
- **Enviar para o Odoo: tirar da lista uma linha do esquema.** Toda linha do esquema tem **remover**: ela não vai para o Odoo, o esquema não muda, e ela desce para o fim, apagada, com **devolver**. Um aviso no topo, o total e a pergunta do Enviar dizem quantas foram tiradas. Trocada por outra peça, a linha volta sozinha para a lista. Com tudo tirado, a lista ainda aparece para devolver, mas conferir e enviar ficam recusados.
- O `lista-extras.json` de um projeto com linhas tiradas passa a ser o formato v2: um app de versão anterior recusa montar a lista desse projeto, em vez de mandar ao Odoo o que foi tirado — atualize os PCs que usam a lista.

## 1.2.3 — 2026-09-30

- **Trocar componente: a parte.** No rodapé do **Trocar componente** (aberto pela ficha de um componente), o seletor **Parte** mostra as partes do componente escolhido — ou, sem escolha, as do componente de hoje, e o botão vira **Trocar a parte**: é assim que se troca só a parte, inclusive de um símbolo da Biblioteca do Altium. Cada opção diz quantos pinos a parte tem. A parte vale para o item que abriu o modal; os outros designadores do alcance trocam de componente e ficam com a parte que têm. Se o designador já tem a parte pedida noutro item, os dois trocam de parte. Um Ctrl+Z desfaz tudo.
- **Componente de várias partes troca de desenho** quando o componente novo tem todas as partes que ele usa na folha (um relé de duas partes por outro de duas). Faltando alguma, recebe só a identidade, como antes.

## 1.2.2 — 2026-09-30

- **Adicionar componentes: a parte, em qualquer acervo.** Componente de várias partes (um relé com bobina e contatos, um amplificador duplo) mostra o seletor **Parte** também no almoxarifado — para o componente desenhado em várias partes no editor (**+ parte**) —, e não só na Biblioteca do Altium. Cada opção diz quantos pinos a parte tem, e a lista da direita mostra a parte na frente do nome. No **Finalizar**, a parte vai para o componente que ainda não a tem: parte 1 e parte 2 na mesma lista viram **um** U1, como o "completar os existentes" do Altium. O campo *comment* não fica mais espremido quando o componente tem uma parte só.
- **Apagar os componentes fora do Odoo.** Em **Configurações › Projeto**, a contagem dos componentes que saíram do Odoo e **Apagar os N fora…**. Na Biblioteca, o painel de valores ganhou **Selecionar fora** (Ctrl+clique marca ou desmarca um) e **Apagar N…**, e a faixa de cima, **Apagar fora (N)…**. Todos perguntam antes, dizendo onde cada componente é usado; se o produto voltar ao Odoo, volta com o mesmo número.
- **Excluir da biblioteca** (botão direito num valor) volta a funcionar para os componentes da biblioteca Especiais — o hub respondia "não está no espelho do almoxarifado".
- **Tudo segue o ID do Odoo.** Renomear um produto no Odoo troca só o nome do componente: o desenho, o símbolo aplicado, o footprint escolhido à mão e o componente já colocado na folha acompanham o produto. O produto que aparece em mais de um componente da biblioteca é avisado na Biblioteca (**⚠ N produtos repetidos**), com **Apagar os antigos**.

## 1.2.1 — 2026-09-29

- **Enviar para o Odoo: componentes fora do esquema.** O botão **Adicionar componente fora do esquema** abre o seletor do almoxarifado num modo que só escolhe (a folha não muda); a quantidade se digita no próprio painel e a peça entra como uma linha **EXTRA n**, com a marca *fora do esquema*. Na linha, a quantidade se edita ali mesmo (Enter ou sair do campo grava, Esc desfaz, as setas contam), **remover** tira a linha sem perguntar e **resolver** troca a peça mantendo a quantidade. As mudanças gravam na hora, em fila, e a lista se reconfere sozinha. Um extra da mesma peça de uma linha do esquema vai numa linha separada, com a marca *mesma peça de R1, R2*. Os extras moram em `lista-extras.json`, ao lado do esquema, e o **Importar do servidor** os traz junto com o projeto.
- **O envio confere a lista inteira.** Se a lista mudou depois da conferência (uma quantidade mexida noutra aba, o esquema gravado), o envio é recusado sem mandar nada, e a tela remonta e confere de novo. Um caractere que o Odoo não aceita (colado do Word na observação, por exemplo) não derruba mais o envio.
- **Componentes de mesmo nome** (o *Cartão Micro SD* do conector e o do soquete) não se confundem mais: o seletor marca e grava a peça clicada — no Trocar componente, no resolver da lista do Odoo e nos extras — e a linha sai com o produto, o nome e o encapsulamento dela.
- **Trocar componente › Editar símbolo ↗ volta a abrir o editor no componente**, e não só na família. O botão já aparece quando o seletor abre.
- **Adicionar componentes:** valor sem footprint conhecido entra com **— sem footprint —** (antes o seletor pegava o primeiro footprint da biblioteca), e o esquema salva assim; o BuildSchematic avisa para definir no Altium.

## 1.2.0 — 2026-09-28

- **A biblioteca é a do servidor.** Símbolos, almoxarifado, substituições e a numeração dos componentes são lidos e gravados direto no hub central (http://192.168.15.192:8100). Salvar ou aplicar um símbolo, trocar um footprint, excluir um componente do almoxarifado, escolher uma substituição e sincronizar com o Odoo acontecem no servidor, e o que um PC grava os outros veem. A pasta de trabalho guarda uma cópia para leitura, que o hub atualiza sozinho (ao abrir, a cada mudança no servidor e a cada minuto). O hub, a lista para o Odoo, o chat e o Altium desta máquina leem dela.
- **Sem o servidor, a biblioteca abre só para leitura**, com a última cópia. Toda gravação de biblioteca é recusada com aviso, e nada é gravado. Projetos continuam sendo editados e salvos neste PC normalmente. Um indicador no hub mostra **Biblioteca do servidor** ou **Servidor fora — biblioteca só leitura**, e avisa quando o servidor cai e quando volta.
- **O que era só deste PC não some.** Um arquivo de biblioteca mudado aqui que o servidor não tem vai para `.altiumhub\backup\lib-remota-<data>\Libs\` antes de ser trocado pela versão do servidor, e o hub avisa onde ficou.
- **Sincronizar almoxarifado** roda no servidor, com o Odoo e o login de lá, e é o servidor quem numera. O app não traz mais o estado do almoxarifado antes, nem pergunta "Sincronizar assim mesmo". A caixa correspondente das configurações fica sem efeito, mas continua guardada: volta a valer se a biblioteca do servidor for desligada.
- **Importar do servidor** fica com **Projetos** e **Bibliotecas do almoxarifado para o Altium** (`Libs\Almox`). "Bibliotecas publicadas" e "Estado do almoxarifado" aparecem desligadas, porque a cópia da biblioteca já é o hub quem mantém. O índice dos projetos (`projects.js`) passa a vir com os projetos. As `.SchLib` do almoxarifado não entram na cópia automática: depois de sincronizar, se o Altium desta máquina lê a pasta de trabalho, importe as Bibliotecas do almoxarifado para ele receber as novas.
- **Configurações › Servidor central › Usar a biblioteca do servidor**, ligada. Desligar volta a biblioteca própria deste PC, que se afasta da do servidor a cada edição. A cópia que a biblioteca do servidor deixou na pasta continua se atualizando pelo **Importar do servidor**, sem virar conflito nem backup; só o que foi editado aqui depois dela fica protegido. Mudar o servidor ou essa caixa reinicia o hub. Numa pasta de desenvolvedor (git) a biblioteca continua a do repositório. **Ajuda › Sobre o EletricHUB** diz qual biblioteca está valendo.
- O hub do servidor precisa ser da mesma versão que o deste app: uma função que ele ainda não tem responde com o aviso de atualizar o hub do servidor, em vez de falhar calada.

## 1.1.9 — 2026-09-25

- Biblioteca › Símbolos, a ferramenta de símbolos depois da revisão:
  - Os pinos casam **pelo nome** quando o símbolo e o componente nomeiam os pinos (A/K, B/C/E, +/−). Casar pelo número invertia o transistor e o zener quando a numeração do símbolo segue outra convenção. Quando só um lado nomeia os pinos (o eletrolítico "1"/"2" contra o símbolo "+"/"−"), a linha vem **a conferir**, desmarcada, e a seção mostra como os pinos casariam ("1 → +  2 → -"); conferido, um clique no cabeçalho marca a seção.
  - A **pinagem nunca muda calada**: componente com outra contagem de pinos só recebe o símbolo se for marcado à mão. Ao editar um símbolo, quem teria a pinagem trocada fica de fora do "Atualizar", e o hub diz quantos são; salvar só a descrição não pergunta nada.
  - Componente com desenho próprio do gerador (PNP, conector por vias) vem desmarcado, e categoria de pinagem a definir não recebe desenho padrão.
  - `Enter` no "Aplicar à categoria" só confirma em cima do botão Aplicar.
  - Aplicar e salvar são recusados enquanto a sincronização do almoxarifado roda (ela desfaria a gravação no fim), e editar a biblioteca enquanto a extração roda.
  - Excluir um símbolo mantém a categoria com o desenho padrão. O hub volta a mostrar o desenho do componente de conector e PNP protegido depois de sincronizar.
  - A tela não esvazia mais quando o hub recarrega com um componente aberto, e os avisos do último lote não somem da ficha.

## 1.1.8 — 2026-09-25

- Biblioteca › Símbolos, **ferramenta de símbolos**. Símbolo não é componente: o símbolo é o desenho da biblioteca de símbolos; o componente é a peça do almoxarifado que o usa; a linha da lista da esquerda é a categoria.
  - **Botão direito num símbolo**: *Editar símbolo*, *Aplicar…*, *Renomear…* e *Excluir símbolo…*.
  - **Editar** abre o desenho do símbolo no canvas (marca SÍMBOLO no topo) e **Salvar símbolo** grava na biblioteca. Se ele já estava aplicado, o hub pergunta se leva o desenho novo aos componentes que o usam.
  - **+ Novo símbolo** começa um símbolo em branco, que entra na biblioteca no primeiro Salvar.
  - **Excluir** tira o símbolo de vez (a extração não o traz de volta); os componentes que o usavam ficam com o desenho.
  - **Aplicar à categoria…**: com uma categoria aberta, lista os componentes dela, todos marcados, para conferir e desmarcar, e grava todos de uma vez no espelho, na .SchLib e no ledger. As outras linhas da mesma família (o [SMD] do [PTH]) aparecem desmarcadas, a um clique. Marcada a categoria inteira, o símbolo vira também o **desenho padrão** dela, e o componente que entrar no almoxarifado depois já vem com ele.
  - Os pinos casam **pelo número** quando o símbolo e o componente têm os mesmos números: a polaridade de capacitor, diodo e transistor fica. Pela ordem só quando os números não batem, e o hub avisa.
  - O botão Aplicar diz onde o desenho vai cair: *Aplicar ao componente* ou *Aplicar à categoria…*.

## 1.1.7 — 2026-09-25

- Vista Esquema, **gaveta dos pousos** na barra de ferramentas, como na Active Bar do Altium: GND, 3V3, 5V5, VIN, o rótulo de net e o No ERC ficam num botão só. A face do botão é o último pouso usado, e clicar nela usa de novo; a setinha no canto de baixo, ou o botão direito, abre a lista com os seis. As teclas (`G`, `L`, `N`) continuam valendo e também trocam a face, e a escolha fica lembrada nesta máquina. Clicar fora ou `Esc` fecham a gaveta, e o clique na folha que a fecha não pousa nada.
- O botão do tamanho da folha (**A4**) saiu da barra: o formato continua em **Configurações › Folha**.

## 1.1.6 — 2026-09-25

- Vista Esquema, **fio traçado como no Altium** (ferramenta Fio, `W`): do último ponto saem duas pernas em L até o cursor, a primeira contínua e a segunda pontilhada; o clique fixa só a primeira, e a seguinte sai perpendicular. Clicar num ponto elétrico (pino, ponta ou **meio** de outro fio, junção, power, port) completa o L e termina o fio; no meio de um fio nasce o T. `Espaço` inverte o canto, `Shift+Espaço` troca o modo (90°, 45° ou livre, lembrado nesta máquina) e `Backspace` desfaz o último canto (sem canto fixado, desiste do fio). Botão direito ou `Esc` terminam no último canto fixado, e o duplo clique termina no ponto clicado; a ferramenta continua na mão, e um segundo botão direito ou `Esc` a larga. `Esc`, trocar de ferramenta e trocar de folha agora **gravam** o fio em curso — antes ele sumia. O fio gravado sai sem ponto repetido nem vértice no meio de uma reta.
- As marcas do fio seguem as medidas do Altium: o trecho fixado sai em lavanda com halo e fica azul só ao gravar, cada canto ganha um x, a partida ligada ganha uma bolinha magenta, o cursor sobre um ponto elétrico mostra um X vermelho e uma cruz cinza acompanha o cursor. A barra de status mostra o ponto sob o cursor, o modo, o dX/dY desde o último clique (na unidade da grade) e as teclas que valem.
- Ímã das ferramentas (Fio, pousos, rótulo, No ERC) nas grades finas: vértice de fio, junção, power e port pegam a até 0,6 passo, e o mínimo de 20 mil ficou só para o pino. Nas grades de 10 mil, 0,5 mm e 0,25 mm, o fio vizinho a um ou dois passos não puxa mais o cursor. Os pousos **GND**, **3V3**, **5V5** e **VIN** e o **rótulo de net** também encostam no meio de um fio.
- **Seleção do fio em dois cliques**, como no Altium: o primeiro clique pega o fio inteiro (tracejado claro, alcinha verde em cada vértice); o segundo pega só o trecho, ou o vértice se caiu na alcinha (alcinhas vermelhas). Assim, clique e `Delete` apagam o fio inteiro; para apagar um trecho ou um vértice, pegue-o com o segundo clique. O duplo clique deixou de ser o gesto de pegar o fio inteiro. Parado sobre um fio, a barra de status diz o que o clique vai pegar. A net acende só com **`Alt`+clique**: o clique simples apenas seleciona.
- **Mover um componente não leva mais o fio**: a ligação se desfaz quando o pino sai da ponta. Para levar o fio, selecione-o junto (laço, `Ctrl+A` ou `Shift`+clique): o fio inteiro anda junto, e um trecho ou vértice selecionado fica com a ponta presa ao pino, mesmo girando o componente no meio do arrasto.
- **Guias de alinhamento** no arrasto, em magenta, como no Figma: borda com borda, centro com centro e com o centro da folha, pino com pino, vértice de fio, power, port, rótulo e junção; entre componentes, o **espaço igual** e a **distância** até o vizinho de cada lado, em mm ou mil conforme a grade. A guia prende quando o cursor chega perto e só solta quando ele se afasta um pouco mais, e a barra de status diz qual pegou. Designador e comment arrastados alinham com os dos outros componentes. No arrasto, `Ctrl` solta a guia e `Shift` prende a peça no trilho dela (sem guia, faz a peça andar reta). O botão fica em **Configurações › Vista** e já vem ligado.
- Correções no arrasto: um ajuste curto de componente não volta mais sozinho para o lugar; girar ou espelhar no meio do arrasto (`Espaço`, `X`, `Y`) refaz o ímã e as guias e entra no desfazer; `Esc`, ou a janela perder o foco, desfaz o deslocamento e mantém o giro, que também entra no desfazer; a roda do mouse ou o `F` no meio do arrasto fazem a peça pousar onde se vê; dois pedaços do mesmo fio arrastados juntos andam os dois. O tracinho do designador ou do comment até o componente só aparece enquanto o texto é arrastado.
- **Número e nome de pino ficam de pé** em qualquer rotação: a 180° não saem mais de cabeça para baixo, e a 270° não se leem mais de cima para baixo.
- **Conector desenhado uma parte por pino** (designador CN, J ou X, ou símbolo com um pino por parte): o designador aparece só na parte 1, e nas outras fica o número do pino. Ele volta quando os nomes e números de pino estão desligados em **Configurações › Vista** e o símbolo esconde os números.
- Aba **Atalhos**: os gestos da vista Esquema acompanham o editor novo (segundo clique no fio, `Alt`+clique, `Shift` e `Ctrl` no arrasto, as teclas do fio), e a coluna **Quando** diz em que situação cada linha vale: vista Esquema, arrastando ou fio na mão (W). Saiu o "Clique duplo: pegar o fio inteiro".
- Configurações do hub › Projeto, **Envio da lista para o Odoo**: a ajuda não diz mais que o hub-almox.json é servido em texto claro para a rede, o que já não acontecia.

## 1.1.5 — 2026-09-24

- As vistas **Esquema e PCB seguem o tema do hub**: modo claro ou escuro, os temas Grafite, Papel, Altium e Placa, e a fonte escolhida. Painéis, barras, botões, listas, a ficha de propriedades e os modais (Adicionar componentes, Odoo, almoxarifado) trocam junto, na hora, sem recarregar a folha. O desenho não muda: a folha do Altium, os fios e símbolos, e a placa sobre o fundo preto, como no Altium.
- Aba **Atalhos** das configurações do hub no molde do *Keyboard Shortcuts* do VSCode: busca (por texto ou pela tecla pressionada), tabela Comando · Atalho · Quando · Origem, teclas desenhadas, troca por duplo clique numa caixa "pressione a combinação e depois Enter", voltar ao padrão por linha. Os gestos do mouse aparecem na mesma tabela.

## 1.1.4 — 2026-09-24

- Sem o botão **Painéis** na barra de status. O painel Projetos agora recolhe e expande pelo próprio cabeçalho: clicar em **Projetos** recolhe numa faixa fina à esquerda, e clicar na faixa abre de novo (Exibir › Painel Projetos, Ctrl+Alt+P, faz o mesmo). Duplo clique na borda do painel volta à largura padrão.
- As configurações do hub ficam só em **Arquivo › Configurações do hub…**: o ⚙ ao lado do botão do Claude saiu. O item abre as configurações na janela do hub que estiver à mão; se só houver uma janela à parte da vista Esquema aberta, abre uma janela nova do hub já com elas. Com um diálogo do hub esperando resposta, ele não abre outro por cima.

## 1.1.3 — 2026-09-24

- Vista Esquema: a lista de **Validação** saiu das Configurações. A validação continua valendo (é ela que impede salvar um esquema inválido), só não é mais listada no painel.

## 1.1.2 — 2026-09-24

- Painel Projetos: botão direito num projeto abre um menu com **Excluir projeto…** (e abrir o projeto, abrir/fechar a gaveta). É o mesmo diálogo das Configurações do hub — senha mestre, a pasta vai para `Trash\` —, agora para o projeto clicado, mesmo que não seja o aberto.
- Vista Esquema: o painel da esquerda saiu. O da direita tem duas abas no rodapé, **Configurações** (folhas e formato, vista, salvar, Odoo, almoxarifado e validação) e **Propriedades**. Sem nada selecionado ele mostra as Configurações; ao selecionar, troca para as Propriedades; as abas trocam à mão. O painel fica ao lado da folha em vez de por cima, e o alfinete deixou de existir. A aba Componentes (lista de componentes e de nets) saiu.
- Os atalhos de teclado da vista Esquema foram para as Configurações do hub, aba **Atalhos**. As teclas já trocadas continuam valendo, e trocar ali vale na hora, também para a vista que já estiver aberta.

## 1.1.1 — 2026-09-24

- Sem a faixa do cabeçalho: no topo ficam só as abas. O estágio do projeto (esquema, eco, roteada, aplicada) e as pendências foram para a barra de status; o chat e as configurações do hub (⚙) ficaram no canto direito das abas. As configurações do hub também estão em Arquivo › Configurações do hub…, e as do app passaram a se chamar Configurações do aplicativo….
- Painel Projetos: clicar no projeto abre a gaveta dele e clicar de novo fecha, inclusive no projeto aberto. Novo botão "Fechar todos os projetos". Ctrl+K leva à busca do painel.

## 1.1.0 — 2026-09-24

- O sistema passa a se chamar **EletricHUB**: app, janela, instalador, atalhos, hub e as caixas dos scripts do Altium. A pasta de dados (`%APPDATA%\AltiumHub`) muda de nome sozinha na primeira abertura, com a pasta de trabalho, as configurações e as preferências do hub. Instalações novas usam `C:\EletricHUB` como pasta de trabalho; as existentes continuam onde estão.
- Interface de ambiente de CAD, com a mesma identidade visual: painel **Projetos** à esquerda (projetos, documentos e bibliotecas em árvore, com busca, pendências e largura ajustável), abas de documento com ícone e barra de status com projeto, documento, contagens, servidor e o botão **Painéis**. Exibir › Painel Projetos (Ctrl+Alt+P) mostra e esconde o painel.
- O título da janela mostra o projeto e o documento abertos.

## 1.0.2 — 2026-09-24

- O link do BOM é sempre o do hub do servidor (http://192.168.15.192:8100): "Copiar link", o rodapé do painel e "Abrir numa aba" (que abre no navegador). É lá que a bancada abre o projeto de referência e marca os vistos. Se o projeto ainda não está no servidor, ou o servidor não responde, o app avisa ao copiar. As opções da aba vão junto para o servidor, como quando se copia o link lá.

## 1.0.1 — 2026-09-24

- O instalador reconhece o AltiumHub já instalado: de uma versão mais velha ele **atualiza** (e diz isso), na mesma versão oferece abrir o app em vez de reinstalar, e nunca volta para uma versão mais antiga. Projetos, bibliotecas, a pasta de trabalho e as configurações não são tocados. Mensagens do instalador em português.
- Com o app aberto, o instalador pede para ele fechar como o X da janela: as vistas perguntam pelo que não foi salvo e o hub é parado direito. Só se o app continuar aberto é que ele pergunta de novo.
- Hub que abriu sem projeto nenhum (primeira execução, antes da importação do servidor) não atualizava a lista quando os projetos chegavam: ficava vazio até um F5.

## 1.0.0 — 2026-09-24

Primeira versão: o hub do AltiumPCBMirror como aplicativo do Windows.

- O mesmo `hubserver.py` do servidor, com um CPython 3.12.10 embutido, escutando só em
  127.0.0.1 (porta 8200). O compartilhamento na rede local é opcional e exige senha
  mestre própria.
- Pasta de trabalho local (padrão `C:\AltiumHub`). A cada atualização, o código do hub é
  reposto; projetos, bibliotecas e credenciais nunca são tocados.
- **Importar do servidor**: projetos, bibliotecas publicadas, estado do almoxarifado e
  `Libs/Almox`, a partir do hub central (http://192.168.15.192:8100). A importação tem três
  vias: um arquivo mudado só aqui não é sobrescrito, e um conflito fica guardado à parte.
- Almoxarifado consultando o Odoo de produção (192.168.15.192:8070, `odoo_db`) e gerando
  as bibliotecas localmente. Antes de cada sincronismo, o estado que numera os
  componentes vem do servidor, para a numeração não divergir.
- Os scripts do Altium podem ser apontados para a pasta local (`home.txt`).
- Atualização automática pelos releases do GitHub (repositório privado, com token de
  leitura).
- Janela com o comportamento de aba do Chrome: pop-ups do hub dentro do app, links do
  Odoo no navegador, aviso de edição não salva, F5, captura de tela para o chat,
  downloads direto para a pasta Downloads e a fonte Inter embutida.
