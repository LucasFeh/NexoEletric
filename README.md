# AltiumPCBMirror

Workspace central que espelha as **bibliotecas**, o **esquema elétrico** e a **PCB** do
Altium Designer em HTML fiel ao ambiente do Altium. Uma IA (Claude Code) pode montar um
projeto eletrônico **do zero** — escolhendo componentes das bibliotecas reais, desenhando
o esquema, transferindo-o para o Altium como `.SchDoc` verdadeiro (nets extraídas pelo
compilador do Altium) — ou apenas personalizar a PCB de um projeto existente (posição de
componentes, trilhas, vias, arcos, contorno), sempre **aplicando de volta** na placa real,
nas mesmas coordenadas do PCB List / Properties do Altium. Tudo fica visível e conferível
num hub HTML único, com histórico local em `D:\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror\Projects\`.

Baseado (como referência de API) no
[InteractiveHTMLBOM4Altium2](https://github.com/lukaszmoskwa/InteractiveHTMLBOM4Altium2)
(MIT), mas é um projeto independente: o ibom gera um BOM interativo para visualização; aqui o
objetivo é **round-trip fiel** Altium → HTML → IA → Altium.

## Por que é fiel

O contrato de coordenadas é o mesmo do Altium, em todos os arquivos da PCB:

- **mm**, eixo **Y para cima**, relativo à **origem da placa** (`Board.XOrigin/YOrigin`) —
  exatamente os números da barra de status, do painel Properties e do PCB List;
- rotação em **graus anti-horário**, valor bruto de `Component.Rotation` (inclusive no bottom);
- camadas com nomes canônicos: `Top`, `Bottom`, `TopOverlay`, `BottomOverlay`, `Multi`, `Mech1`, `KeepOut`.

O esquema segue a mesma filosofia, com o contrato dele: **mil**, eixo Y para cima, origem
no canto inferior esquerdo da folha, rotação só 0/90/180/270 + `mirror` (detalhes em
[AI-GUIDE.md](AI-GUIDE.md), Parte A). Em ambos os casos, os dados **nunca são
transformados**; só a projeção de tela do hub inverte Y.

## Instalação

1. Copie esta pasta para o seu PC — ela é o **workspace central** (ex.: `D:\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror`).
2. Ajuste a constante `SCRIPT_HOME` (e `PROJECTS_DIR`/`OUT_DIR`, quando existir) no
   início de cada um dos 5 scripts `.pas`. **Importante:** use o caminho como visto
   do PC que **roda o Altium** — se o workspace fica em outra máquina da rede,
   a constante deve ser o UNC do compartilhamento (ex.:
   `\\LUCAS-PC\D\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror`), nunca um caminho
   local que só existe na máquina do workspace
   (`ExportLibs.pas`, `ExportProject.pas`, `BuildSchematic.pas`, `ExportBoard.pas`,
   `ApplyChanges.pas`).
3. Em `ExportLibs.pas` (e também em `BuildSchematic.pas`), ajuste `SCHLIB_FILE` e
   `PCBLIB_FILE` para o caminho real da sua `.SchLib`/`.PcbLib` (por padrão apontam para
   `Z:\Biblioteca\ALTIUM LIBRARY ------ LUCAS\`).
4. No Altium: **DXP » Run Script » Browse** e selecione `AltiumPCBMirror.PrjScr`
   (ou adicione o projeto de script ao seu workspace). O menu mostra **4 comandos**:

   | Comando | O que faz |
   |---|---|
   | **ExportSch** | esquema do projeto focado → `Projects\<nome>\schematic.js` |
   | **ExportPcb** | PCB focada → `Projects\<nome>\board.js` + `pcb-list.csv` |
   | **ApplyProject** | pergunta qual projeto de `Projects\` usar e aplica no projeto Altium atual: cria os `.SchDoc` (se tem `schematic.js`) ou aplica as mudanças na PCB focada (se tem `changes.js`) |
   | **ExportLibs** | suas bibliotecas → `Libs\schlib.js` / `Libs\pcblib.js` |

   As rotinas auxiliares recebem parâmetro de propósito, para não poluírem o menu
   (o *Run Script* só lista procedimentos sem parâmetros).

## Estrutura do workspace

```
D:\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror\
├── AltiumPCBMirror.PrjScr   projeto de script (5 documentos)
├── ExportLibs.pas           [ExportLibs]   bibliotecas do usuário -> Libs\
├── ExportProject.pas        [ExportSch]    esquema do projeto aberto -> Projects\<nome>\schematic.js
├── BuildSchematic.pas       (unidade auxiliar: schematic.js -> .SchDoc, chamada por ApplyProject)
├── ExportBoard.pas          [ExportPcb]    PCB aberta -> Projects\<nome>\
├── ApplyChanges.pas         [ApplyProject] menu de projetos -> esquema/PCB no projeto atual
├── hub.html                 hub v2 (Projetos, Esquema, PCB, Componentes, Nets, Footprints, Histórico) — servido por hubserver.py; sem servidor abre em modo demonstração
├── hub-classic.html         hub clássico (Projetos, Esquema, PCB, Libs) — abre por duplo clique, 100% file://
├── schframe.html            vista Esquema (em iframe por hub.html e hub-classic.html)
├── pcbframe.html            vista PCB (shell fino, em iframe por hub.html e hub-classic.html)
├── pcbframe.js              lógica da vista PCB (renderer, painéis, PCB List, CSV)
├── hub-core.js              lógica pura (parsing, validação, nets, motor único de changes)
├── hub-draw.js              renderers canvas compartilhados (símbolo, footprint, PCB)
├── hub-font.js              fonte vetorial da serigrafia como geometria pura (canvas e SVG)
├── hub-laser.js             gerador da arte para gravação a laser (SVG para o LightBurn)
├── projects.js              índice do histórico de projetos (usado pelo hub-classic.html)
├── AI-GUIDE.md              contrato/manual para a sessão de IA
├── hubserver.py             servidor local opcional (Flask; API do hub v2 — índice/detalhe/Rescan — e recarregamento automático)
├── Libs\
│   ├── schlib.js            espelho da biblioteca de esquema (símbolos)
│   └── pcblib.js            espelho da biblioteca de footprints
├── Projects\
│   └── <nome>\              um por projeto = histórico local
│       ├── schematic.js     esquema (autorado pela IA ou espelhado do Altium)
│       ├── board.js         espelho da PCB (após o ECO)
│       ├── changes.js       mudanças de PCB pendentes/aplicadas
│       ├── annotations.js   sinalizadores do usuário para a IA (bandeiras no hub)
│       └── build-report.txt / apply-report.txt
├── tests\                   testes node (load.js, test-apply.js, test-geom.js, test-netextract.js, test-validate.js)
└── example\                 placa sintética standalone do viewer v1 (intocada)
```

Projetos com nome iniciando `_` (ex.: `_DemoKit`) são demos — o hub mostra o selo **DEMO**.

## Os 5 scripts

| Script | O que faz | Casamento pelo nome do projeto |
|---|---|---|
| **ExportLibs** | Espelha as duas bibliotecas do usuário (`.SchLib` + `.PcbLib`) para `Libs\schlib.js` / `Libs\pcblib.js`, cruzando símbolo → footprint e listando os símbolos sem link (`Libs\libs-report.txt`). Não depende de projeto aberto — rode uma vez e de novo sempre que as bibliotecas mudarem. | não se aplica |
| **ExportProject** | Espelha o esquema do projeto aberto/focado (cada `.SchDoc`) para `Projects\<nome>\schematic.js` e atualiza `projects.js`. A PCB é espelhada à parte pelo ExportBoard. | usa o nome do `.PrjPcb` focado; cria a pasta em `Projects\` se ainda não existir |
| **BuildSchematic** | Lê `Projects\<nome>\schematic.js` (escrito pela IA) e cria os `.SchDoc` reais no projeto aberto: valida tudo **antes** de criar qualquer coisa (símbolo existe na lib? footprint existe? refs duplicados?), copia o símbolo real da SchLib (gráficos/pinos/parâmetros), desenha fios, net labels, power ports, junctions e textos, define designator/comment/footprint por componente. Erros e resumo em `Projects\<nome>\build-report.txt`. Folha já existente **não é sobrescrita** sem confirmação. | casa pelo nome do `.PrjPcb` focado; sem casamento, pergunta com lista numerada |
| **ExportBoard** | Espelha a PCB aberta/focada para `Projects\<nome>\board.js` (+ `changes.js` vazio se ainda não existir — **nunca sobrescrito** em re-exports — + `pcb-list.csv`) e atualiza `projects.js`. | idem ExportProject |
| **ApplyChanges** | Aplica `Projects\<nome>\changes.js` na PCB aberta/focada: trava por campos `orig_*` (tolerância 0,001 mm), tudo dentro de **uma única operação de undo**, agora com suporte a `outline_set`. Relatório em `Projects\<nome>\apply-report.txt`. | casa pelo nome; sem casamento, pergunta com lista numerada |

## hub.html (v2) e hub-classic.html

Duas interfaces sobre os mesmos dados, com o mesmo motor de renderização/edição
(`hub-core.js`, `hub-draw.js` e as vistas Esquema/PCB em iframe). Use a que preferir —
nenhuma altera os arquivos de forma diferente da outra.

### hub.html — hub v2 (recomendado, servido por `hubserver.py`)

Casca única com:

- **Seletor de projeto** — combobox no header (`Ctrl/Cmd+K` abre de qualquer aba, busca
  por nome, fecha ao clicar fora ou `Esc`); projeto e aba atuais sobrevivem ao reload
  (hash da URL + `localStorage`).
- **Barra do projeto** — esteira de pipeline **esquema → eco → roteada → aplicada** e um
  botão de próxima ação derivado dela (um clique, sem escolher nada).
- **Abas**: Esquema, PCB (os mesmos `schframe.html`/`pcbframe.html` de sempre, com edição
  completa), Componentes (tabela filtrável + painel de detalhe + exportar BOM), Nets,
  Footprints, Neoden (CSV Neoden 4 direto do espelho, em três colunas: lista com busca ·
  a placa ao vivo · opções. Clicar numa linha marca e dá zoom no componente dentro da placa;
  o menu lateral traz o checkbox "definir como referência", as coordenadas de máquina —
  editáveis na referência, calculadas nos demais — mais rotação e move-pós-N. A coluna `#`
  é o índice de exportação e não é renumerado pela busca, que filtra só a vista.
  A Neoden só coloca SMD, então a coluna `Tipo` classifica cada componente pelos pads do
  `board.js` (**SMD** · **PTH** · **MISTO**) e dá pra tirar do CSV: botão **Excluir PTH**,
  filtro por tipo + checkbox do cabeçalho para desmarcar todos os visíveis de uma vez,
  shift+clique para intervalos, e **Restaurar** para desfazer. Excluído fica riscado na
  lista, some do CSV e não conta no `#` — então o "mover após N" segue certo. A escolha
  é lembrada por projeto; a referência nunca sai (se ela for PTH, a barra avisa).
  Download `<nome>-NEODEN-TopLayer.csv` / `-BottomLayer.csv`,
  Mid X/Y = origem do componente, igual ao Location X/Y do Altium), **Laser** (arte vetorial
  da placa para gravar no LightBurn — detalhes abaixo) e Histórico (linha do tempo a partir de `build-report.txt`/
  `apply-report.txt`/datas de `board.js`/`schematic.js`, mais um `history.jsonl` opcional por
  projeto).
- **Ações** — menu **⋮** com os 5 comandos do Altium documentados (comando real embaixo do
  rótulo, copiável). Só **Rescan** executa de fato (reindexa `Projects\` no servidor); os
  demais (`ExportLibs`, `BuildSchematic`, `ExportBoard`, `ApplyChanges`, `DRC`) continuam
  **passos manuais no Altium** — o hub só explica o passo, nunca finge executá-lo.
- **Sem servidor**, `hub.html` abre em **modo demonstração** (projetos fictícios, selo
  "demo" no seletor) — dados reais exigem `python hubserver.py` rodando (veja abaixo).

### hub-classic.html — hub v1 (Projetos, Esquema, PCB, Libs)

A interface anterior, preservada tal como era: **duplo clique, 100% `file://`**, sem
precisar de servidor.

- **Projetos** (inicial) — histórico lido de `projects.js`: um card por projeto, com esteira
  de status **esquema → eco → roteada → aplicada**, datas, contagens (componentes, nets,
  folhas) e atalhos para abrir nas vistas Esquema/PCB. Projetos `_*` levam o selo DEMO.
- **Libs** — navegador das bibliotecas espelhadas (só no clássico; o hub v2 não tem esta
  vista): busca por nome/descrição, símbolo desenhado lado a lado com o footprint
  associado, aviso destacado nos símbolos sem footprint na lib.

### Esquema e PCB — vistas compartilhadas pelos dois hubs

- **Esquema** — renderiza `Projects\<nome>\schematic.js` com os gráficos reais de
  `Libs\schlib.js`: símbolos, fios, junctions, net labels, power ports, designator/comment.
  Zoom/pan, cursor em mil, clique numa net destaca ela na folha inteira (com os pinos
  membros). Painel lateral com a lista de componentes e a validação do esquema.
  A vista Esquema **edita depois de destravar** — as duas vistas abrem em leitura e só
  aceitam alteração depois do botão **Editar** (`E`), que libera ferramentas, arrasto,
  duplo clique, Delete e Ctrl+Z; os **Salvar** ficam sempre disponíveis, para nunca prender
  o que já foi alterado. Destravada: `+ Componente` abre o picker das libs (símbolo + footprint lado a lado, ref sugerido), `W` desenha fios com snap na ponta quente dos pinos, Label/Power/Junção/Texto por clique, arrastar move com grade de 100 mil, duplo clique abre propriedades, `Ctrl+Z` desfaz e **Salvar esquema** grava o `schematic.js`. Para o Altium refletir edições numa folha já construída, rode o **BuildSchematic com limpeza da folha** (confirmação SIM).
- **PCB** — a vista PCB (`pcbframe.html` + `pcbframe.js`; motor no `hub-core.js`), lendo `Projects\<nome>\board.js` e
  `changes.js`: render fiel, fantasma tracejado das posições originais, lista de mudanças
  com validação, tabela PCB List pós-mudança e exportação para CSV.
  A vista PCB **edita depois de destravar** (botão **Editar**, `E` — igual à do Esquema):
  arrastar move objetos, `T` desenha trilhas, duplo clique abre propriedades (inclusive
  designator/comment), `Ctrl+Z` desfaz e **Salvar changes** grava o `changes.js` — com aviso
  se a IA tiver gravado o arquivo em paralelo. A mesma vista embutida na aba Neoden
  (`?lean=1`) é só de consulta: lá o botão Editar não aparece e a trava não abre.

### Laser — arte para o LightBurn

A aba **Laser** gera o SVG 1:1 da placa para gravação a laser (tinta + ablação, ou fotolito),
a partir do `board.js`. Três colunas: opções · prévia ao vivo · resumo e download.

**O cobre sai unido, e isso não é detalhe.** A doc do LightBurn (*Fill Mode*) diz que formas
que se sobrepõem parcialmente na mesma camada de preenchimento **não gravam a área comum** —
e nenhuma das opções de ordem (*Fill All Shapes at Once* / *Groups* / *Individually*) muda
isso. Emitir as primitivas cruas abriria um buraco em cada junção trilha/pad. Por isso o
gerador rasteriza tudo, traça o contorno da união (marching squares) e emite **uma**
geometria por camada. É também o que faz o negativo e a expansão saírem de graça.

A união ignora o **sentido** de cada polígono, e isso importa: o `board.js` traz as regiões
majoritariamente no sentido horário, e as formas construídas pelo gerador são anti-horárias.
Sem normalizar, a regra de preenchimento cancela uma contra a outra e abre cunhas brancas na
junção da trilha com o pad.

**Camadas — você monta a lista.** O LightBurn separa por **cor**, com o valor exato da
paleta (C00…C29), e cada cor vira uma camada com velocidade e potência próprias. No painel
da direita cada linha é uma camada: escolhe o `Cxx`, escolhe **que geometria** ela carrega,
dá nome, duplica (⧉) ou remove (✕).

| Geometria | O que é |
|---|---|
| retirada do cobre (preenchimento) | a área a gravar — no negativo é tudo que **não** é cobre |
| contorno só de pads e vias | o traço em volta de pad e via apenas, sem trilha nem região |
| contorno do cobre (limpeza) | o traço em volta de cada ilha de cobre, para a passada de limpeza |
| furos | um círculo no **diâmetro real da broca** em cada furo, para furar |
| serigrafia | o silkscreen |
| borda da placa (corte) | o contorno, para soltar a placa |
| furos de fixação (recorte da placa) | os *Board Cutout* do Altium — furo de verdade no contorno |

Lista inicial, **na ordem de execução** da bancada (o `priority` do `.lbrn2` sai do
índice, então a ordem das camadas é a ordem em que a máquina roda):

| | Geometria | Modo | Vel. | Pot. | Freq. | Glob. | Q-pulse | Extras |
|---|---|---|---|---|---|---|---|---|
| **C00** | furos | linha | 100 | 100% | 40 kHz | 20 | 200 ns | |
| **C01** | retirada de cobre (1ª passada) | preencher | 1000 | 75% | 45 kHz | 1 | 200 ns | bidir · cruzada · 45° · int. 0,05 |
| **C02** | corte da borda | linha | 100 | 100% | 40 kHz | 20 | 200 ns | |
| **C03** | furo de fixação | linha | 100 | 100% | 40 kHz | 20 | 200 ns | |
| **C04** | retirada de cobre (limpeza, 3ª passada) | preencher | 1000 | 20% | 45 kHz | 1 | 200 ns | bidir · cruzada · 45° · int. 0,05 |
| **C05** | retirada de cobre (2ª passada) | preencher | 1000 | 75% | 45 kHz | 1 | 200 ns | bidir · cruzada · 45° · int. 0,05 |
| **C06** | contorno do cobre (limpeza) | preencher | 1000 | 20% | 45 kHz | 1 | 200 ns | bidir · cruzada · 45° · int. 0,01 |
| **C07** | retirada de cobre (limpeza, 3ª passada) | preencher | 1000 | 20% | 45 kHz | 1 | 200 ns | bidir · cruzada · 45° · int. 0,05 |
| **C08** | bordas de pads e vias (pós tinta UV) | preencher | 1000 | 20% | 45 kHz | 1 | 200 ns | bidir · cruzada · 45° · int. 0,01 |

A **3ª passada roda antes da 2ª** — é a sequência da bancada, não engano de digitação.

C01, C04, C05 e C07 carregam a mesma geometria de propósito: são quatro passadas do mesmo
preenchimento, em camadas separadas para dar para ajustar uma sem mexer nas outras. C04 e
C07 têm o mesmo nome porque são a mesma operação repetida — o `Cxx` é que distingue as duas.

**C03** corta os furos de fixação com **a mesma configuração da C02**: recorte de placa é a
mesma operação da borda — atravessar o FR4 — só que num círculo interno, e por isso roda
logo depois dela. A geometria vem dos *Board Cutout* do `board.js`; placa sem recorte não
gera a camada.

**C08** existe para o passo depois da tinta UV: expõe o anel do pad e da via **sem tocar
nas trilhas**, para poder soldar. É a fonte `contorno só de pads e vias` — mesma
configuração da limpeza do contorno, mas ignorando trilha e região.

O ⚙ de cada linha abre os parâmetros; ⧉ duplica (sempre num `Cxx` livre, porque duas
linhas no mesmo índice se fundem numa camada só no LightBurn).

O **modo** é quem decide preencher ou contornar, tanto no arquivo quanto na prévia — não a
geometria que a camada carrega.

A camada de furos é independente da opção **Furos** do cobre: dá para não subtrair o furo da
máscara (*pad cheio*) e ainda assim ter a camada para furar.

A lista fica salva por projeto, e **restaurar padrão** volta ao começo.

**Três formas de levar para a máquina:**

| Botão | O que faz |
|---|---|
| **Baixar .lbrn2** | formato nativo, **com geometria e parâmetros dentro** — abre pronto |
| **Abrir no LightBurn** | grava em `Laser\` e manda o Windows abrir com o app associado |
| Baixar SVG | só a geometria; o LightBurn casa pela cor e usa os parâmetros que já tiver |

O `.lbrn2` traz um `<CutSetting>` por camada e as formas junto. O esquema foi conferido
campo a campo contra um arquivo real de MOPA 60 W: `frequency` vai em **Hz** (a aba mostra
kHz e converte), `QPulseWidth` em ns, booleanos como `1`/`0`, e o LightBurn usa **Y para
cima** — ao contrário do SVG, aqui o Y não inverte. Uma potência só na aba vira
`minPower = maxPower`, ou seja, sem rampa.

As formas usam a lista **condensada** (`<VertList>`/`<PrimList>`), que é a que
`FormatVersion="1"` lê. O formato legado (`<V vx>`/`<P T=>`) dentro de `FormatVersion="1"`
gera um arquivo que abre com as camadas certas e **nenhuma geometria**.

> **Se "Abrir no LightBurn" der erro de rota inexistente:** o `hubserver.py` roda com
> `debug=False` e não recarrega sozinho. Pare e suba de novo depois de atualizar o projeto.

O SVG continua levando os parâmetros em `data-lb-mode` e `data-lb-cut`, para conferência.

> **Abrir direto abre na máquina do servidor.** O navegador não lança aplicativo, então quem
> abre é o `hubserver.py` — se você acessa o hub de outro PC da rede, o LightBurn abre no PC
> do servidor, não no seu. Por isso o endpoint só aceita chamada de `localhost`: o servidor
> escuta na rede toda, e lançar aplicativo não pode ficar exposto à LAN. De outro PC, use
> **Baixar .lbrn**.

**Opções**

- **Lado** Top/Bottom. Trocar para Bottom já sugere **espelhar** (o cobre precisa gravar do
  lado certo), e o checkbox continua editável — máquina que grava por baixo do vidro não quer.
- **Inverter (negativo)** — **ligado por padrão**; queima tudo que **não** é cobre; é o modo de placa pintada.
- **Furos** — *furo real* (padrão), *marca de centro* (ø 0,3 mm: uma covinha que centra a broca
  sem comer o anel) ou *pad cheio*. No *furo real* a forma é fiel ao `board.js`: `drillshape`
  `rect`/`oblong` viram furo retangular/oblongo de `drillw × drill`, girados por `holerot`
  (sem `holerot`, o furo herda a rotação do pad) — as mesmas regras que a vista PCB usa. Pad
  SMD nunca é furado.
- **Expansão** — compensa o kerf do laser e a sobre-corrosão: cresce o cobre e encolhe a marca
  de furo na mesma medida.
- **Resolução** — passo do traçado, padrão 0,025 mm (uma ordem de grandeza abaixo do spot do
  laser). A prévia usa um passo mais grosso para responder ao vivo e diz quando faz isso; o
  arquivo sai sempre no valor escolhido. Placa muito grande faz o gerador ceder resolução
  sozinho, com aviso, em vez de estourar a memória.

As escolhas ficam por projeto em `localStorage`. Nome do arquivo:
`<projeto>-LASER-<lado>[-negativo][-espelhado].svg`.

**Avisos que a aba dá**

- **mudanças pendentes** — a arte sai do `board.js` cru, o `changes.js` não entra. Rode
  ApplyChanges e ExportPcb antes de gravar.
- **negativo sem grupo de cobre** — geraria um retângulo cheio (geometria perfeitamente
  válida) e o laser queimaria a placa inteira. A aba bloqueia o download.

Contorno com canto em arco é achatado e encadeado junto com as linhas — placa de canto
arredondado recorta certo, inclusive no negativo.

## Servidor local com tempo real (opcional)

`hub-classic.html` continua abrindo por **duplo clique**, sem servidor, como sempre.
`hub.html` (v2) também abre por duplo clique, mas sem servidor fica em **modo
demonstração** — para ver os projetos reais (e em **tempo real**, inclusive de outra
máquina da rede local), rode na raiz do workspace:

    python hubserver.py

- Abra `http://127.0.0.1:8000` (serve `hub.html`; `hub-classic.html` fica em
  `http://127.0.0.1:8000/hub-classic.html`) — ou `http://<IP-desta-máquina>:8000` de
  outro PC da rede (o servidor imprime as URLs ao subir; o Windows pode pedir liberação
  de firewall na primeira vez).
- Rodou um **Export** no Altium → a página aberta recarrega sozinha em ~1 s (ambos os
  hubs).
- `--port N` muda a porta. Requer Python 3 + Flask (`pip install flask`). O servidor
  não altera nenhum arquivo do hub.
- Com o servidor rodando, o hub também **salva** arquivos direto no workspace
  (`POST /api/save`, restrito a `Projects\<nome>\{changes,schematic,annotations}.js`,
  escrita atômica). Sem servidor, os botões de salvar baixam o arquivo para você
  substituir manualmente.

## Fluxo projeto novo do zero

1. Rode **ExportLibs** no Altium (uma vez, ou quando as bibliotecas mudarem).
2. A IA escreve `Projects\<nome>\schematic.js` e adiciona a entrada correspondente em
   `projects.js`.
3. Você confere no `hub.html`, vista **Esquema** (valida símbolos/footprints/ids e já
   mostra uma prévia das nets).
4. No Altium, crie um `.PrjPcb` vazio com o **mesmo nome** do projeto e rode
   **BuildSchematic** — cria o(s) `.SchDoc` real(is), copiando os símbolos da SchLib.
5. **Compile** o projeto e rode **Design » Update PCB** (ECO nativo do Altium) —
   é aqui que os componentes e as nets chegam de verdade na PCB.
6. Rode **ExportBoard** no Altium.
7. A IA posiciona e roteia em `Projects\<nome>\changes.js` (dê forma à placa nova com
   `outline_set`, se preciso).
8. Rode **ApplyChanges** no Altium — undo único.
9. Rode o **DRC do Altium** e confira.

## Fluxo projeto existente

1. Com o projeto aberto/focado no Altium, rode **ExportProject** (esquema) e
   **ExportBoard** (PCB) — ambos casam pelo nome do `.PrjPcb` e gravam em
   `Projects\<nome>\`.
2. Abra `hub.html`: o projeto aparece no card em **Projetos**; as vistas **Esquema** e
   **PCB** mostram os espelhos atuais.
3. Editar a PCB segue exatamente o fluxo v1 (veja "O que é editável" abaixo): a IA edita
   `changes.js`, você confere no hub, roda **ApplyChanges** e depois o DRC.
4. Editar o esquema pelo hub grava o `schematic.js`; para levar ao Altium, rode
   **BuildSchematic com limpeza da folha** (re-despejo completo — o rebuild incremental fica para uma fase futura). A alternativa segue válida: editar no Altium e re-exportar.

## O que é editável

Via `changes.js`, na PCB de um projeto (novo já roteado ou existente). Para montar um
esquema do zero, veja [AI-GUIDE.md](AI-GUIDE.md), Parte A.

| Objeto | Operações em `changes.js` |
|---|---|
| Componente | `comp_move` (x, y, rot, layer/flip) |
| Trilha | `track_edit`, `track_add`, `track_del` |
| Via (furo metalizado) | `via_edit`, `via_add`, `via_del` |
| Arco de cobre | `arc_edit`, `arc_add`, `arc_del` |
| Contorno da placa | `outline_set` (substitui o `Board.BoardOutline` por um polígono fechado de vértices; pede confirmação do usuário no apply) |
| Designator/Comment (texto) | comp_attr (editar pelo duplo clique no hub) |

Polígonos/planos, regiões, keepouts, textos e regras são exportados para **visualização**,
mas não são editáveis nesta versão. Furo de fixação feito como **recorte da placa** (*Board
Cutout*) aparece em `cutouts` — sai como furo de verdade na vista PCB e na arte a laser;
furo NPTH feito como pad aparece em `freepads`.

## Sinalizadores (usuário → IA)

Nas vistas **PCB** e **Esquema**, o botão **⚑ Sinalizar** (tecla `N`) deixa você marcar
problemas direto no desenho — ex.: bandeira vermelha "trilha muito próxima". As marcações
ficam em `Projects\<nome>\annotations.js` e a IA é obrigada (AI-GUIDE.md, Parte C) a
lê-las antes de trabalhar no projeto, corrigir via `changes.js` e responder marcando cada
uma como resolvida. Resolvidas aparecem esmaecidas com a resposta; você pode reabrir (↺)
ou apagar (✕). Severidades: vermelho (erro), amarelo (atenção), azul (nota). O export do
Altium cria o arquivo vazio uma única vez e nunca o sobrescreve.

## Limitações e avisos

**PCB:**

- **DRC é do Altium** — o hub não checa clearance; sempre rode o DRC depois de aplicar.
- Texto de silkscreen é renderizado com fonte vetorial aproximada (posição/altura/rotação fiéis).
- Os `id`s (`t1`, `v2`...) valem para **um ciclo** export → apply; após aplicar, re-exporte.
- Flip de componente (`layer` diferente em `comp_move`) usa a operação nativa do Altium; o
  preview do hub é uma aproximação — confira no Altium após aplicar.
- `outline_set` só aceita polígono de **linhas** (contorno com arcos: desenhe no Altium).
- Salve o projeto **antes** de rodar `ApplyChanges` ou `BuildSchematic` (são edições
  normais, com undo, mas backup nunca fez mal a ninguém).

**Esquema / projeto novo:**

- Espelho de esquema **existente** é só leitura — edição/round-trip fica para a v3.
- Folhas planas: sem hierarquia (sheet symbols/harnesses).
- Sem buses — fios, net labels e power ports cobrem o escopo de projeto pequeno da v2.
- ERC/DRC/ECO continuam sendo os do Altium — `BuildSchematic` só desenha; quem extrai as
  nets de verdade é o compilador do Altium (Compile + Update PCB).
- O preview de nets na vista Esquema do hub é uma aproximação geométrica (fio toca pino,
  junction, net label) — a verdade é sempre o que o compilador do Altium calcular.
- A altura (`h`) de um item `text` no `schematic.js` é só informativa: o `BuildSchematic`
  cria o texto com o tamanho de fonte padrão do Altium, não com o valor de `h`.

## Licença

MIT — veja [LICENSE](LICENSE). Dados da fonte vetorial de silkscreen provenientes do
InteractiveHtmlBom/InteractiveHTMLBOM4Altium2 (MIT).
