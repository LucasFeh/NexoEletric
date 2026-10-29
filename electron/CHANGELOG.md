# Changelog — NexoEletric desktop

Versões do app desktop (tags `vX.Y.Z` deste repositório). Cada versão carrega o hub do
commit em que foi gerada; o commit aparece em **Ajuda › Sobre o NexoEletric**. Até a 1.8.1 o
app se chamava EletricHUB.

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
