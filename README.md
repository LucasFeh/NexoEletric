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
2. Diga a **esta máquina** onde fica o workspace, em
   `C:\ProgramData\AltiumPCBMirror\home.txt` — veja **Onde fica o workspace: `home.txt`**
   logo abaixo. Não há mais caminho gravado dentro dos `.pas`: na máquina onde tudo roda
   local, a primeira execução acha sozinha e anota; na máquina que usa o servidor, você
   escreve o UNC uma vez. Vale o caminho como visto do PC que **roda o Altium**.
3. Se a `.SchLib`/`.PcbLib` da casa não estiverem onde o `BuildSchematic` procura por
   padrão (`SCHLIB_PADRAO`/`PCBLIB_PADRAO`), acrescente as chaves `schlib` e `pcblib` no
   mesmo `home.txt`. Elas são caminho de *máquina*, e não têm relação com a cópia publicada
   em `Libs\` que o hub usa (veja **Onde está a biblioteca da casa**): o `.pas` roda no
   Altium, que enxerga a rede.
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

### Onde fica o workspace: `home.txt`

O caminho do workspace **não é mais constante no código**. Cada máquina diz o seu em
`C:\ProgramData\AltiumPCBMirror\home.txt`.

`ProgramData` porque é por **máquina** — não por usuário, não por variável de ambiente
(`GetEnvironmentVariable` não está entre as primitivas provadas no DelphiScript do Altium) —
e porque abre no Bloco de Notas. Formato: uma `chave=valor` por linha; linha vazia e linha
começando por `;` ou `#` são ignoradas.

| chave | o quê |
|---|---|
| `home` | raiz do workspace: a pasta que tem o `AI-GUIDE.md`. **Obrigatória.** |
| `schlib` | `.SchLib` da casa. Opcional; sem ela vale a cópia publicada dentro do workspace (`Libs\BIBLIOTECA DE ESQUEMA.SchLib`). |
| `pcblib` | `.PcbLib`. Opcional; sem ela valem os footprints do almoxarifado (`Libs\Almox\FOOTPRINTS ALMOX.PcbLib`). |

```ini
; AltiumPCBMirror - configuracao DESTA maquina
home=D:\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror
;schlib=\\192.168.15.192\altiumhub\current\Libs\BIBLIOTECA DE ESQUEMA.SchLib
```

Cada script resolve a raiz nesta ordem, **validando** cada candidato — validar é achar o
`AI-GUIDE.md` dentro dele, com `FileExists` e não `DirectoryExists`, porque uma pasta que
existe mas não é o workspace tem de ser recusada:

1. a chave `home` do `home.txt`;
2. os candidatos embutidos, **o servidor primeiro** — `\\192.168.15.192\altiumhub\current`,
   `\\ODOO\altiumhub\current`, `D:\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror`. O primeiro
   que validar é **gravado** no `home.txt`, para a próxima execução não procurar de novo;
3. um `InputBox` perguntando a raiz — a resposta também é validada e gravada;
4. nada validou: uma mensagem dizendo onde procurou e o que editar, e **nada é escrito**.

A ordem mudou em 2026-09-15: o `\\LUCAS-PC\D\…` saiu da lista e o servidor passou à
frente. Ele é o nome de UMA máquina, estava na frente do share, e a bancada está no ar —
então o Altium achava o workspace de desenvolvimento e parava ali, exportando o esquema
para lá em vez de para a release publicada. O `D:` local ficou por último e só casa na
própria bancada.

Na máquina onde tudo roda local o `D:` resolve sozinho, na primeira execução, e nunca
mais se fala nisso. Depois do deploy, a máquina que usa o servidor põe o UNC no
`home.txt` dela — e nenhuma das duas precisa de um `.pas` diferente.

**Se aparecer "Acesso negado" apontando para um servidor que você não está usando, o
`home.txt` desta máquina está apontando para o lugar errado.** Abra-o e corrija a linha
`home=`. A mensagem de erro dos scripts já diz qual caminho falhou e de onde ele veio (do
`home.txt` ou de um candidato embutido).

O bloco que faz isso é **duplicado, com o mesmo texto, nos quatro `.pas`** — de propósito: o
`.PrjScr` não ganha unidade nova, e resolução entre unidades do DelphiScript do Altium não
dá para testar fora do Altium. Mudou num, mude nos quatro.

### Dependências do servidor

O `hubserver.py` precisa de **Flask**; a sincronização do almoxarifado e as ferramentas de
símbolo precisam também de **olefile** (é ele que lê o `.SchLib` do Altium):

```
python -m pip install flask olefile
```

Rode isso **com o mesmo `python` que sobe o hub**. O hub dispara os scripts com
`sys.executable`, então numa máquina com vários Pythons instalados (o do Espressif, o da
Microsoft Store, o do python.org) é fácil subir o servidor com um que não tem `olefile` — e
aí a sincronização morre com `ModuleNotFoundError` no meio do guardião. Quando isso
acontece a mensagem já diz o caminho exato do interpretador a consertar.

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
├── hub-bom.js               gerador do BOM interativo (uma página HTML autossuficiente)
├── hub-i18n.js              idioma da casca do hub (pt-BR / en) — dicionário + t()
├── projects.js              índice do histórico de projetos (usado pelo hub-classic.html)
├── AI-GUIDE.md              contrato/manual para a sessão de IA
├── hubserver.py             servidor local opcional (Flask; API do hub v2 — índice/detalhe/Rescan/exclusão/seletor de pasta — e recarregamento automático)
├── Libs\
│   ├── BIBLIOTECA DE ESQUEMA.SchLib   a biblioteca da casa PUBLICADA (binária, versionada)
│   ├── schlib.js            espelho da biblioteca de esquema (símbolos)
│   ├── pcblib.js            espelho da biblioteca de footprints
│   ├── rename-map.js        o que o RenameLibs padronizou (antigo → novo) — tabela de apelido
│   └── lib-subs.js          substituições escolhidas na aba Biblioteca
├── Projects\
│   └── <nome>\              um por projeto = histórico local
│       ├── schematic.js     esquema (autorado pela IA ou espelhado do Altium)
│       ├── board.js         espelho da PCB (após o ECO)
│       ├── changes.js       mudanças de PCB pendentes/aplicadas
│       ├── annotations.js   sinalizadores do usuário para a IA (bandeiras no hub)
│       └── build-report.txt / apply-report.txt
├── Trash\                   projetos excluídos pelo hub (criada na primeira exclusão; esvaziar é manual)
├── tests\                   testes node (load.js, test-apply.js, test-geom.js, test-netextract.js, test-validate.js)
└── example\                 placa sintética standalone do viewer v1 (intocada)
```

Projetos com nome iniciando `_` (ex.: `_DemoKit`) são demos — o hub mostra o selo **DEMO**.

### Onde está a biblioteca da casa

A `.SchLib` da casa mora fora do repositório, num share que só as máquinas da bancada
enxergam (`Y:\Biblioteca\ALTIUM LIBRARY ------ LUCAS\`). O hub do servidor não enxerga: ele
roda num container que, por desenho, **não alcança nada fora dele — só serve**. Sem a
biblioteca, o gerador do almoxarifado sai sem footprint reciclado e sem cabeçalho de
documento, e as 32 `.SchLib` abrem com a folha preta no Altium — reportando `ok:true`.

Por isso ela **viaja dentro do repositório**, publicada em
`Libs\BIBLIOTECA DE ESQUEMA.SchLib` (1,7 MB, versionada, `*.SchLib binary` no
`.gitattributes` para o git nunca tocar nos bytes). Quem publica é o próprio sincronismo: o
guardião copia a lib viva para lá no começo de cada rodada, se ela mudou.

Um módulo só decide o caminho, `tools\libpath.py`, e todo mundo o consulta — o gerador, o
guardião, o leitor e o servidor de símbolos:

| ordem | de onde | quando ganha |
|---|---|---|
| 1 | o caminho explícito de quem chamou | `--lib`, um teste, uma rota |
| 2 | `ALTIUMHUB_SCHLIB` / `ALTIUMHUB_PCBLIB` | se a variável aponta para um arquivo que existe |
| 3 | `tools\symbols\config.json » schlib` | **só se o arquivo existir** |
| 4 | `Libs\BIBLIOTECA DE ESQUEMA.SchLib` | o piso: existe em todo clone |

O passo 3 é o que faz a mesma ordem servir às duas máquinas sem um único `if` de
plataforma. Na bancada o `Y:` existe e ganha — quem edita símbolo continua editando a
biblioteca viva, com o History do Altium e o `Backup-hub` de lá. No Linux do servidor,
`Y:\...` não é um caminho absoluto, o arquivo não existe, e a ordem cai sozinha na cópia
publicada. O `config.json` congelado em `shared/` pelo deploy pode continuar apontando para
o `Y:` para sempre: o valor morto é ignorado por não existir.

Duas regras que vêm junto:

- **A cópia publicada é somente leitura pelo hub.** No servidor ela vive dentro de
  `releases/<hash>/`, que o deploy seguinte apaga com um `rm -rf`. Enquanto o caminho da
  casa era o `Y:`, o "Salvar » Altium" do editor de símbolos morria num 404 inofensivo; com
  a lib alcançável ele passaria a gravar de verdade, e o trabalho sumiria no deploy
  seguinte. `/api/symbols/save` devolve **409** com `soLeitura:true` (o espelho é gravado
  do mesmo jeito, e vale), e `/api/symbols/mirror` exige `{"confirmar":true}`. A trava é do
  hub: a CLI do `schlib_patch` e o próprio Altium gravam nela se você mandar.
- **A cópia publicada não entra no ledger.** O `git archive` do deploy carimba nos arquivos
  extraídos a data do *commit*, então ela ganha mtime novo a cada deploy — de qualquer commit,
  mesmo um só de README. Enquanto o hub comparava mtime, isso abria sozinho o modal de "mudou
  no Altium" para quem entrasse na aba Biblioteca; a comparação saiu em 2026-09-15, e a regra
  fica de pé porque carimbo de deploy continua não sendo informação sobre a biblioteca.

A `.PcbLib` da casa (63 MB) **não** é versionada: seriam 52 MiB permanentes no pack e a
release do servidor iria de 14 para 77 MB, cinco vezes, dentro do share que hospeda o ERP.
Ela já chega ao servidor como `Libs\Almox\FOOTPRINTS ALMOX.PcbLib`, que o deploy trata como
diretório compartilhado — e é esse o piso da chave `pcblib`.

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
  **Agrupar por tipo e tamanho** (ligado por padrão, lembrado por projeto) reordena o CSV
  para a máquina não trocar de bico a cada peça: junta o que tem a mesma classe e o mesmo
  package — todos os R 1206, depois os R 0805, depois os C, na ordem R · C · L · D · resto.
  A classe sai do prefixo do designator, não do nome do footprint, então `RES 1206` e
  `1206 resistor` caem no mesmo grupo, e `CN1` não vai parar no meio dos capacitores. A
  referência fica sempre na primeira linha, fora do agrupamento. Medido no acervo:
  119 → 78 trocas de bico (34% menos); no `PRJ-UR-DI261924`, 41 → 20 em 97 peças.
  Download `<nome>-NEODEN-TopLayer.csv` / `-BottomLayer.csv`,
  Mid X/Y = origem do componente, igual ao Location X/Y do Altium), **Laser** (arte vetorial
  da placa para gravar no LightBurn — detalhes abaixo) e Histórico (linha do tempo a partir de `build-report.txt`/
  `apply-report.txt`/datas de `board.js`/`schematic.js`, mais um `history.jsonl` opcional por
  projeto).
- **Configurações** — no app desktop, **Arquivo › Configurações do hub…**; no navegador, o
  **⚙** no canto direito das abas, ao lado do chat (ali não há menu Arquivo). O modal tem
  quatro abas laterais. `ExportLibs`, `Reindexar` e o **⋮** da barra do projeto, que viviam
  soltos no antigo cabeçalho, entraram para ele.
  - **Projeto** (a primeira) — o projeto aberto e a exclusão. (A **pasta padrão do BOM**
    morava aqui; saiu quando o BOM virou link e deixou de existir arquivo para pôr em
    pasta alguma — veja *BOM* mais abaixo.) **Excluir projeto** fica atrás da **senha
    mestre** (conferida no servidor; o browser só a transporta — veja `MASTER_PASSWORD`
    em `hubserver.py`, ou a variável de ambiente `ALTIUMHUB_MASTER`). A pasta não é
    apagada: vai inteira para `Trash\<nome>-<data>` no mesmo workspace, some do hub na
    hora e volta arrastando de volta para `Projects\`. Senha errada não fecha o
    diálogo; sem servidor o botão fica desligado.
  - **Layout** — quatro comboboxes. **Cor**: Escuro · Claro · Automático (automático
    segue o sistema e muda junto se o Windows mudar com o hub aberto). **Tema**:
    Grafite (o de sempre) · Papel · Altium · Placa. **Linguagem**: Português ou English.
    **Fonte**: Inter · Do sistema · Bancada (Verdana, de altura-x grande, para ler de um
    passo atrás) · Monoespaçada. Os quatro são atributos no `<html>`
    (`data-mode`/`data-theme`/`data-font`) já lidos no `<head>` pelo `hub-tema.js`, então
    a página não abre de um jeito para virar no primeiro frame — e as cores e as pilhas de
    família moram no `hub-tema.css`, não no JS, para não existirem em dois lugares. As
    vistas **Esquema e PCB seguem o mesmo tema** (carregam os dois arquivos) e trocam ao
    vivo quando ele muda aqui, sem recarregar a folha. Fica de fora só o que é desenho: a
    folha do Altium com o que está nela, a seleção azul, e a placa com as camadas sobre o
    fundo preto, como no Altium. A prévia do BOM continua escura.
  - **Atalhos** — as teclas da vista Esquema, no molde do *Keyboard Shortcuts* do VSCode:
    busca no topo (por texto, ou pelo botão de teclado, que pesquisa pela combinação
    pressionada) e a tabela **Comando · Atalho · Quando · Origem**, com os gestos do mouse
    como linhas fixas. Duplo clique numa linha (ou `Enter`, ou o lápis) abre a caixa
    "pressione a combinação desejada e depois Enter", que avisa na hora tecla ocupada ou do
    navegador; `Esc` desiste. Cada linha trocada tem o ↺ para voltar ao padrão, e
    **Restaurar o padrão** desfaz tudo. A tabela sai da mesma lista que o teclado da vista
    lê (`hub-atalhos.js`), e a troca vale na hora, inclusive para a vista Esquema aberta.
  - **Ações** — os tutoriais. Os 5 comandos do Altium documentados (comando real embaixo
    do rótulo, copiável) e, embaixo, o fluxo de um projeto novo do começo ao fim. Só
    **Rescan** executa de fato (reindexa `Projects\` no servidor); os demais
    (`ExportLibs`, `BuildSchematic`, `ExportBoard`, `ApplyChanges`, `DRC`) continuam
    **passos manuais no Altium** — o hub só explica o passo, nunca finge executá-lo. É
    aqui que mora o fluxo inteiro: o rodapé **fluxo** e o botão de próximo passo
    (*Compile + Update PCB* e companhia) saíram da casca porque repetiam esta aba.

  **Sem cabeçalho**: com o painel Projetos (logo abaixo), a faixa de cima some e ficam as
  abas e a folha. O estágio (esquema · eco · roteada · aplicada), as pendências e o estado
  do servidor vão para a barra de status. A barra do projeto também saiu: o nome e o
  caminho estão no painel, e o botão de próximo passo mudou para a configuração.

  A tradução cobre a casca (cabeçalho, abas, diálogos e o
  próprio modal); os painéis Laser, BOM e Neoden seguem em português. O dicionário é o
  `hub-i18n.js` — chave sem tradução volta como ela mesma, que é como os nomes de
  comando do Altium passam intactos.
- **Painel Projetos** (`hub-shell.js`) — a coluna da esquerda, no jeito de um ambiente de
  CAD: os projetos em árvore, cada um com os seus documentos (Esquema, PCB, Neoden, Laser,
  BOM, Histórico) e as Bibliotecas embaixo, com busca (`Ctrl+K`). Clicar no projeto abre a
  gaveta dele (e abre o projeto, se for outro); clicar de novo fecha. **Fechar todos os
  projetos** recolhe todas as gavetas. O **botão direito** num projeto abre um menu com
  **Excluir projeto…** — o mesmo diálogo da aba Projeto das configurações (senha mestre,
  pasta para `Trash\`), só que para o projeto clicado, que não precisa ser o aberto.
  Clicar no cabeçalho **Projetos** recolhe o painel numa faixa fina, com o título em pé, e
  clicar na faixa o traz de volta (no app, também **Exibir › Painel Projetos**, `Ctrl+Alt+P`).
  A largura se ajusta arrastando a borda; duplo clique nela volta ao padrão.
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
  Zoom com a roda, **botão direito arrasta a tela**, cursor em mil, `Alt`+clique numa net
  destaca ela na folha inteira (com os pinos membros). O painel fica **à direita**, redimensionável
  pela divisória (duplo clique fecha/abre, como nas abas Laser e BOM), com duas sub-abas no
  rodapé: **Configurações** (as folhas e o formato da ativa, centralizar, o passo da grade,
  os olhos de comment e de pino, o **Salvar**, Odoo e almoxarifado) e
  **Propriedades** (a ficha do que está selecionado, logo abaixo). Ele troca sozinho: sem
  nada selecionado mostra as Configurações, selecionar mostra as Propriedades — e as abas
  continuam lá para trocar à mão. A lista de componentes, a de nets e a de validação saíram
  com a antiga aba Componentes, e os atalhos foram para as configurações do hub. A validação
  ainda é calculada, mas hoje não aparece em lugar nenhum e **não trava o Salvar**: ele só
  recusa o que o `schematic.js` não consegue gravar (o `serializeSchematic`).
  **Bolinha e ponte.** Onde três ou mais ramos se encontram — um T, uma estrela de pontas de
  fio, um pino no meio de um fio — nasce a **bolinha** de conexão; onde dois fios só se
  **cruzam**, sem nada declarado ali, o de cima vira uma **ponte** (um arco de passagem). Os
  dois são desenho: quem decide ligação continua sendo a extração de nets do `hub-core.js`,
  e cruzamento sem junção continua não ligando, como no Altium. Antes, o cruzamento era um X
  mudo que se lia como ligação, e a estrela de três pontas não ganhava bolinha nenhuma.
  **Cor é identidade elétrica, seleção é contorno.** Um fio sai laranja quando pertence à net
  em foco e azul-escuro quando não; quem está selecionado ganha um contorno tracejado por
  cima, sem trocar de cor — a mesma convenção da vista PCB e do Altium. `Alt`+clique num fio,
  pino, rótulo, power port ou junção põe a net dele em foco (o nome aparece na barra de status);
  o clique simples só seleciona — acender a net inteira a
  cada clique fazia pegar uma perninha parecer pegar o circuito todo. `Esc`, o clique no
  vazio, a troca de folha e qualquer nova seleção largam o foco junto. Antes a seleção
  recoloria o objeto, e a net saía metade azul metade laranja, com o laranja sobrevivendo ao
  `Esc` — a cor ficava presa na folha.
  A folha é sempre editável, e editar é **mover**: clique seleciona, arrastar no vazio
  seleciona vários (esquerda→direita só quem couber inteiro; direita→esquerda quem encostar),
  `Shift` soma à seleção. `Del` apaga, `Espaço` gira, `X` espelha na **horizontal**, `Y` na
  **vertical**, `Ctrl+A` seleciona a folha e `Ctrl+Z` desfaz — e **todas essas teclas são
  trocáveis** na aba **Atalhos** das configurações do hub, que é desenhada a partir da mesma
  tabela que o teclado lê (não há lista de atalhos escrita à mão em lugar nenhum). Teclas que o navegador leva
  antes da página (`Ctrl+W`, `F5`, `Ctrl+R`…) são recusadas na hora de gravar.
  **No fio, dois cliques, como no Altium.** O primeiro clique pega o **fio inteiro** (a
  "perninha" que é um fio só fica sozinha na seleção), com uma alcinha verde em cada vértice;
  o segundo clique no mesmo fio pega **só o pedaço** em que caiu — o trecho, ou o vértice se foi
  na alcinha —, marcado com as alcinhas vermelhas. Apertar e arrastar logo no primeiro clique
  leva o fio inteiro. Arrastar um trecho o empurra na perpendicular e estica os vizinhos;
  arrastar um **vértice** move só aquele canto (e ele gruda no pino pelo ímã); `Del` num trecho
  do meio **parte o fio em dois** e num trecho da ponta apara. `Esc` e um clique voltam ao fio
  inteiro, e o laço de seleção continua pegando fios inteiros. Até 2026-09-24 era o contrário
  (o clique pegava o trecho e o duplo clique promovia), e num fio comprido não havia como
  pegar só a perninha.
  **Mover um componente não leva o fio**, a não ser que o fio (ou o trecho dele) esteja
  selecionado junto: aí a ponta que estava no pino fica presa ao pino, inclusive se ele girar
  no meio do arrasto. Sem o fio na seleção, a net se desfaz quando o pino sai da ponta — e as
  guias alinham o pino com o fio que ele deixou, que é como se volta a encostar nele.
  **O passo da grade é escolhido** na aba Configurações do painel — 100/50/25/10 mil e também
  1 mm / 0,5 mm / 0,25 mm. O métrico está ali porque as folhas desta casa snapam em 1 mm ou
  0,3 mm dentro do próprio Altium: quase todo vértice de fio dos projetos reais está fora da
  grade de 100 mil, e um editor que só soubesse 100 mil empurraria o vértice para longe do
  pino a cada arrasto. A malha desenhada e o raio do ímã acompanham o passo.
  **O designador e o comment são objetos.** Dá para clicar no texto, arrastá-lo para longe do
  símbolo (um tracinho o liga ao componente **enquanto ele está sendo arrastado**; solto, o
  tracinho some) e devolvê-lo ao lugar pelo `Del` ou pelo botão da ficha; a posição vai para o `schematic.js` em `refdx/refdy` (e `comdx/comdy`), em mil, como
  deslocamento da âncora do componente. A âncora automática também mudou: ela sai da caixa do
  componente **como ela está na folha**, e não do símbolo sem girar — era por isso que todo
  componente em `rot` 90/270 nascia com o nome escrito por cima do próprio corpo.
  No conector desenhado uma parte por pino, o designador aparece **só na parte 1**; nas outras
  fica só o número do pino (que ali é a própria parte), sempre de pé — girado de cabeça para
  baixo ele é desvirado, como o Altium faz. Se o olho dos pinos está desligado e o símbolo
  esconde o número, o designador volta, para a parte não ficar anônima.
  **Guias de alinhamento**, como as do Figma, enquanto se arrasta: linhas magenta mostram o
  alinhamento de borda ou de centro com os vizinhos, a **equidistância** (o mesmo espaço dos
  dois lados, ou o espaço de uma fila repetido) e a **distância** até os vizinhos mais perto,
  na unidade da grade. O alinhamento é **magnético** — dá uma travada ao chegar, e só solta
  quando a mão passa do ponto. Com `Shift` apertado o arrasto anda **reto na direção da guia**
  que está valendo (guia vertical, só em Y; horizontal, só em X); `Ctrl` solta o ímã naquele
  instante. O botão das guias fica em **Configurações › Vista** e vem ligado.
  **Adicionar componentes** (`C`) abre um modal igual à aba Biblioteca (busca, seletor de
  acervo, preview do símbolo, lista de valores do almoxarifado ou footprint); cada
  **Adicionar** junta o item numa lista à direita e **Finalizar** coloca tudo na folha ativa,
  em grade, já selecionado para arrastar.
  Dentro da folha há uma **barra de ferramentas** com o pouco que a mão faz aqui: selecionar,
  **Fio** (`W`), a **gaveta dos pousos**, **Adicionar componentes** (`C`) e **libs**. A gaveta
  junta **GND** (`G`), **3V3**, **5V5**, **VIN**, o **rótulo de net** (`L`) e o **No ERC** (`N`)
  num botão só, como na Active Bar do Altium: a face é o último pouso usado (clicar nela usa de
  novo, e as teclas também a trocam), e a setinha no canto de baixo, ou o botão direito, abre a
  lista com os seis. A escolha fica lembrada nesta máquina. O tamanho da folha não fica na
  barra: está em **Configurações › Folha**, no painel.
  **O fio é traçado como no Altium** (conferido quadro a quadro contra um vídeo dele): do último
  ponto saem duas pernas em L até o cursor, a primeira contínua e a segunda pontilhada; o
  clique fixa **só a primeira**, e a seguinte sai perpendicular. Clicar num ponto elétrico —
  pino, ponta ou **meio** de fio, junção, power, port — completa o L até ele e termina o fio
  (no meio de um fio nasce o T, com a bolinha). Botão direito, `Esc` ou duplo clique terminam
  no que já foi fixado e deixam a ferramenta na mão para o próximo fio (o segundo direito/`Esc`
  a larga); trocar de ferramenta ou de folha também grava o fio. `Espaço` inverte o canto,
  `Shift+Espaço` troca o modo (90°, 45°, ângulo livre) e `Backspace` desfaz o último canto. O
  canto em que um fio parou é o canto com que o próximo sai, e o modo fica lembrado nesta
  máquina. A barra de status mostra o ponto elétrico sob o cursor e o dX/dY desde o último
  clique. O ímã do pino acompanha o passo da grade (60 mil em 100, nunca menos de 20 — o pino
  mora fora da grade nas folhas métricas); ponta de fio, junção, power e port pegam a até 0,6
  passo, e o meio de um fio a menos de meio passo, para o fio paralelo não cair em cima do
  vizinho nas grades finas. Texto,
  junção explícita e troca de valor/footprint continuam sendo da IA, no `schematic.js`
  ([AI-GUIDE.md](AI-GUIDE.md), Parte A).
  **Trocar um troca os do mesmo tipo E do mesmo valor.** "Mesmo tipo" era só o nome do
  símbolo, e num projeto real isso junta demais: os 24 `RES [ SMD ]` do `PRJ-UR-DI261924`
  são 10K, 1K, 2K2 e 15R, e trocar o 10K trocava os quatro valores. O valor sai do parâmetro
  `Value` do componente — e, só em designador `R…` ou `C…`, do `comment` quando não há
  parâmetro, que é o caso dos espelhos antigos. Componente sem valor declarado (conector,
  test point, LED, diodo) continua com o alcance de antes, o símbolo inteiro: medido nos 8
  projetos da casa, 63 dos 76 grupos ficam intactos e só resistor e capacitor se dividem.
  O modal mostra **os três alcances antes do clique**, com o número em cada um — *os N com
  valor 10K* (padrão), *os N deste tipo, qualquer valor* e *só este designador*.
  **Vários de uma vez, escolhidos a dedo:** marque os componentes na folha (clique com
  `Shift`, ou laço) e o painel Propriedades oferece **"Definir o componente nos N
  designadores…"** — mesmo componente para todos, de valores ou símbolos diferentes, com um
  aviso quando a seleção mistura valores. É o mesmo caminho do "resolver" da lista do Odoo.
  **Trocar componente encaixa.** O desenho novo põe os pinos noutro lugar em volta da mesma
  âncora; a troca agora mede onde os pinos estavam, mede onde ficaram, e anda com o componente
  o tanto que devolve o maior número de pinos de mesmo número ao ponto antigo — dizendo no
  aviso quantos voltaram. Sem isso os fios ficavam onde estavam e a ligação se desfazia sem
  uma linha de aviso, porque a extração de nets casa por coordenada exata.
  A aba **Propriedades** do painel é a ficha, no espírito do painel homônimo do Altium
  (designator e parte são editáveis; o resto é leitura): designator, comment, descrição, símbolo (e em que nome ele foi resolvido),
  acervo de origem, footprint, posição/rotação, parâmetros e a tabela de pinos com a net de
  cada um — com o **símbolo e o footprint desenhados no rodapé**. Não há um campo editável
  sequer: esta vista serve para olhar e posicionar. A ficha entra quando algo é
  selecionado e dá lugar às Configurações quando a seleção acaba; o painel fechado pela
  divisória vira o botão de painéis no canto inferior esquerdo da folha.
  Para o Altium refletir edições numa folha já construída, rode o **BuildSchematic com
  limpeza da folha** (confirmação SIM).
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
a partir do `board.js`. Três colunas: opções · prévia ao vivo · resumo e download. As
divisórias são arrastáveis — puxe até o fim (ou dê duplo clique) para fechar uma lateral e
dar a largura toda à prévia, ou o contrário. A largura fica no navegador, não no projeto.

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
- **As duas faces no mesmo arquivo** — o `.lbrn2` (e o SVG) sai com Top **e** Bottom lado a
  lado: a face aberta na aba primeiro, a outra ao lado, separada pela margem. Assim o operador
  grava uma face, vira a placa e grava a outra **sem trocar de arquivo**. A prévia mostra as
  duas, na posição em que vão cair no LightBurn.

  Cada face leva **as suas próprias camadas**: a segunda entra nos `Cxx` seguintes aos da
  primeira e ganha o nome da face no fim (`furos · Bottom`). É de propósito — se as duas
  dividissem o mesmo `Cxx`, mandar gravar “furos” dispararia nas **duas posições de uma vez**,
  e a face que ainda não foi virada sairia gravada errada. Com a lista padrão são 18 camadas
  (C00…C17); passando de 15 por face não cabe nos 30 `Cxx` do LightBurn, e a aba avisa e
  bloqueia o download.

  O **espelho** é o que separa as duas: a face aberta sai exatamente como está na prévia e a
  outra sai espelhada em relação a ela — o par certo (uma espelhada, uma não), respeitando o
  que você marcou.
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
`<projeto>-LASER-<lado>[-negativo][-espelhado].svg` — com as duas faces o lado vira
`Top+Bottom` e o sufixo de espelho sai, porque aí ele é por face.

**Avisos que a aba dá**

- **mudanças pendentes** — a arte sai do `board.js` cru, o `changes.js` não entra. Rode
  ApplyChanges e ExportPcb antes de gravar.
- **negativo sem grupo de cobre** — geraria um retângulo cheio (geometria perfeitamente
  válida) e o laser queimaria a placa inteira. A aba bloqueia o download.
- **as duas faces não cabem** — a lista passa de 15 camadas por face e não há `Cxx` para
  dar um a cada uma. A aba bloqueia o download.

Contorno com canto em arco é achatado e encadeado junto com as linhas — placa de canto
arredondado recorta certo, inclusive no negativo.


### Nomes de biblioteca — apelidos e substitutos

O espelho e a `.SchLib`/`.PcbLib` mestras falam **vocabulários diferentes**. O `RenameLibs`
padronizou 152 símbolos e 170 footprints, mas o resultado foi aplicado **só ao espelho** — a
biblioteca de verdade continua com os nomes antigos, que são justamente os que os projetos
exportados referenciam (`CAP [  SMD  ]` contra `CAP [SMD]`). Projeto escrito **depois** do
rename referencia o nome novo. Os dois vocabulários estão em uso ao mesmo tempo.

Casar por igualdade exata condenava metade a "ausente" — e ausente não é um aviso: o símbolo
vira um **quadrado vermelho sem pinos** na folha, o componente é **pulado inteiro** na extração
de nets (net faltando, sem dizer nada) e a validação **aborta** o resto das checagens dele.

Agora existe **um resolvedor só**, em `hub-core.js`, por onde passam a aba Biblioteca, a folha
do Esquema, a extração de nets, a validação e o hub clássico. A cascata, em ordem de autoridade:

| Passo | Como | `how` |
|---|---|---|
| 1 | substituição escolhida por uma pessoa (`Libs\lib-subs.js`) | `escolha` |
| 2 | nome exato | `exato` |
| 3 | `Libs\rename-map.js`, **um salto só**, nos dois sentidos | `rename` |
| 4 | chave normalizada, **só** quando aponta para um único item | `chave` |

A chave normalizada é a **`NormKey` do `RenameLibs.pas` portada literalmente** — maiúscula,
acento dobrado por faixa de byte Latin-1, só `A-Z0-9`. É porte literal de propósito: se JS e
Pascal discordarem do que é "o mesmo nome", a discordância só aparece na bancada.

O passo 3 dá **um salto só** porque no `rename-map` `INDUTOR MODO COMUM` é nome novo de uma
entrada **e** nome antigo de outra — encadear seguiria para o item errado.

O passo 4 **se recusa a chutar**. Na PcbLib real a chave junta `SOIC 8` com `SOIC - 8`,
`TO-220AB` com `TO–220AB` (travessão), e mais dois pares. Pôr o footprint errado na placa é
pior que não resolver, então empate vira **ambíguo** e cai no fluxo de substituição, que é onde
uma pessoa decide. Nos símbolos a chave não colide (404 nomes, 404 chaves).

**O que isso recupera**, medido no acervo: 86 ocorrências de símbolo e 14 de footprint que
apareciam como ausentes. No `LM555 astável`, a aba Biblioteca sai de **4 ausentes para 1**.

O segmento **Apelidos** lista tudo que casou por apelido (`referenciado → nome na lib`, e
por quê) — é onde se confere se algum apelido casou errado.

**Escolher um substituto.** No painel de um item ausente, cada "parecido na lib" ganhou um
botão **usar este**: a escolha vai para `Libs\lib-subs.js` e, daí em diante, o resolvedor
entrega o símbolo escolhido no lugar do ausente em todas as telas. **Desfazer** está no mesmo
lugar. Três decisões de projeto:

- **É da biblioteca, não do projeto.** O mesmo `Cap Eletrolitico` aparece em quatro projetos;
  perguntar quatro vezes só cria quatro respostas diferentes.
- **O `schematic.js` não muda.** Ele é o contrato com o `BuildSchematic`; manter o nome
  original preserva a rastreabilidade e deixa a escolha reversível. O projeto no Altium
  também não muda — a troca vale para o espelho.
- **Arquivo separado.** O `ExportLibs` sobrescreve `schlib.js`/`pcblib.js` **inteiros**;
  guardar a escolha dentro deles a apagaria no próximo export.

O formato de `lib-subs.js` é um objeto JSON **plano por linha**, com chaves fixas e não-ASCII
em `\uXXXX` — exatamente o que o `JGet` dos `.pas` consegue ler e o que o `TStringList` do
Delphi não corrompe. Em `file://` (sem servidor) a gravação degrada para **download**, igual
ao botão "Salvar changes".

> **O espelho não tem tudo que a lib mestra tem.** Conferído direto na `.SchLib`/`.PcbLib` de
> `Y:\Biblioteca\ALTIUM LIBRARY ------ LUCAS\`: a lib real tem **404 símbolos** e o espelho
> 401 — faltam `NE555`, `MC33072P_1` e `STWD100YNYWY3F`. Nome nenhum resolve isso: só rodar
> **ExportLibs** de novo traz a geometria. E note que esse `ExportLibs` vai reescrever o
> espelho com os nomes **reais** (os antigos) — o resolvedor cobre os dois sentidos, então
> nada quebra quando isso acontecer.


### Biblioteca » Símbolos — editar o símbolo e gravar na SchLib do Altium

A sub-aba **Símbolos** (ao lado de Footprints) é um editor de símbolos de esquema sobre o
espelho do Altium, com a gramática do próprio Altium. À esquerda, a lista e a busca dos
componentes do espelho (a mesma da sub-aba Sch Lib); no meio, o canvas; à direita, as
ferramentas em ícones (selecionar, linha, retângulo, polilinha, polígono, arco, elipse,
texto, pino, excluir; girar, espelhar, enquadrar, grade) e a ficha no estilo do painel
Properties: o tipo e o nome, os ícones de virar pino/linha (`K`), duplicar e excluir, X e Y
na primeira linha, a cor do traço e a caixa **Preencher** com a cor de área, a parte, o
tamanho em mm (largura/altura, diâmetro, comprimento), e no pino o número e o nome com o
olho de visibilidade — pino novo nasce com o nome escondido, só o número à vista, como todo
componente gerado do almoxarifado (o nome quase sempre repete o número); o olho o mostra
quando fizer falta. Desfazer e refazer ficam no canto direito da barra do editor. As
colunas laterais são ajustáveis como nas abas Laser e BOM (arraste; duplo clique fecha).

O mouse é o da vista Esquema: o botão esquerdo seleciona, arrasta o que está marcado e
desenha a caixa de seleção (esquerda→direita pega o que cabe inteiro, direita→esquerda o que
encosta); direito e meio arrastam a tela; a roda amplia; Shift alterna a seleção; Delete,
setas e Ctrl+D agem sobre o conjunto. A unidade da interface é **mm** por padrão (snap 0,1 /
0,5 / 1 / 2,5 mm; em mil, 10 / 25 / 50 / 100) — por dentro tudo continua em mil com três
casas, que é o que o Altium e o espelho falam. O pino é desenhado como no Altium (traço
grosso e a marca "::" na ponta quente) e a ficha avisa quando a ponta quente está fora do
snap escolhido.

Embaixo do canvas fica a **Biblioteca de símbolos**: um acervo só de desenhos — sem valor,
sem descrição, sem footprint. Arraste um símbolo para o canvas (numa parte vazia ele entra
na origem; numa parte com desenho, entra onde soltou, selecionado, renumerando os pinos que
colidem) ou use "Aplicar ao símbolo", que troca o corpo inteiro preservando a pinagem
quando a contagem de pinos bate. "+ corpo atual" guarda o desenho aberto na biblioteca.

**Salvar** grava em dois lugares de uma vez: `Libs/schlib.js` (o espelho que o hub desenha) e,
com a caixa *Altium* marcada, a SchLib da casa — a viva, resolvida pela ordem de
**Onde está a biblioteca da casa**; onde só existe a cópia publicada (o servidor), esse
segundo passo é recusado com **409** e só o espelho é gravado —,
escrita direto pelo Python (a mesma técnica do almoxarifado: `cfbf.py` + `schlib_bin.py`),
com backup automático em `Backup-hub\` ao lado do arquivo e conferência por releitura. A
fração do pino vai para o stream `PinFrac` como o Altium grava (a grade métrica sobrevive),
a visibilidade de número e nome vai para os bits do pino, e as cores para `Color`/`AreaColor`
de cada primitiva; todos os outros componentes da biblioteca saem byte a byte iguais. Se a
biblioteca estiver aberta no Altium, a gravação na SchLib é recusada com aviso — feche-a e
salve de novo.

A Biblioteca de símbolos vive em `Libs/symbols-lib.js` (versionado — é estado curado, não
saída). Quem a alimenta é:

```bash
python tools/symbols/extrair.py                 # varre as fontes de tools/symbols/config.json
python tools/symbols/extrair.py --limite 20     # amostra, para experimentar
```

que percorre a biblioteca antiga e todos os projetos de `Y:\EQUIPAMENTOS ATUALIZADOS` e
`Y:\EQUIPAMENTOS_REVISADOS` (`.SchLib`, `.SchDoc` — inclusive os antigos com chaves em
maiúsculas e o formato ASCII — e as `.SchLib` embutidas em `.IntLib`), extrai só a
geometria, deduplica por impressão digital (cor e visibilidade não contam) e **mescla**: o
que já está cadastrado é ignorado (só ganha `usos`/`aliases`), nomes e ids existentes nunca
mudam — renomear e excluir é pelo hub. Até 4 pinos vira símbolo genérico com nome básico por
heurística de forma (Resistor, Capacitor polarizado, Diodo zener…); o resto é CI e leva o nome
do próprio componente (`SN74LVC244AQPWRQ1`). A varredura de 2026-09-03 leu 527 arquivos e
reduziu 176.322 ocorrências a 895 símbolos. O relatório fica em `tools/symbols/relatorio.txt`;
o mesmo botão existe na API (`POST /api/symbols/extract`, log por SSE).

**O desenho nasce no hub e vai para o Altium — nunca o contrário.** A sincronização do
almoxarifado passa pelo **guardião** (`tools/symbols/guardiao.py`, botão *Sincronizar* da aba).
O gerador reescreve cada `.SchLib` de `Libs/Almox` do zero; o guardião **repõe** nela, depois de
cada regeração, o desenho de todo componente *protegido* — a geometria guardada em
`Libs/lib-ledger.json` (versionado: é estado) — e o espelho da família anda junto, marcado
`origem` (pílula na lista). Só quem ninguém protegeu recebe o desenho do Odoo. O diálogo mostra
"preservado: N componentes"; `--liberar` devolve um componente ao gerador e `--proteger` adota
um desenho.

**O que for editado direto na `.SchLib` pelo Altium é sobrescrito pela próxima regeração, em
silêncio.** Foi assim que o usuário pediu, em duas etapas: em 2026-09-14 a hierarquia inverteu
(o Altium deixou de subir e virou aviso) e em 2026-09-15 o aviso também saiu — *"as modificações
nascem e saem do hub para o Altium, mas nunca o contrário, portanto não precisa mais identificar
nenhuma modificação vinda do Altium"*. Saíram o badge, o modal, as rotas `/altium-changes` e
`/altium-apply` e a apuração de divergências do resumo. A única porta que ainda leva um desenho
do Altium para o hub é o comando manual `guardiao.py --proteger "FAMILIA/COMPONENTE"`.

**Apagar um componente da biblioteca: apaga mesmo, e quem decide se ele volta é o Odoo.**
A biblioteca foi construída quando o cadastro do Odoo ainda não tinha padrão de nome, e por
isso alguns itens nasceram **duas vezes**, com nomes diferentes. Limpar isso é apagar o
duplicado pelo botão direito » *Apagar da biblioteca…* — e a mecânica protege quem erra a mão:

| o item… | o que acontece na próxima geração |
|---|---|
| **ainda existe no Odoo** | volta, remontado do CSV, **com o mesmo número de part** |
| **já não existe no Odoo** (o duplicado) | não volta: morreu de vez |

Não há lista de veto. O gerador não consulta `Libs/almox-excluidos.json` — esse arquivo é o
**registro** do que foi apagado e quando. Funciona sem filtro porque o valor que já não vem do
Odoo só aparece no espelho por ser repescado do espelho **anterior** (é o `fora: true`, saldo
zero, de `almox2lib.py » numera_valores`); apagar corta essa única fonte. Por isso *desfazer* só
limpa o registro: quem traz o item de volta é a sincronização, se o produto ainda estiver lá.

Duas coisas sobrevivem a apagar, de propósito: o **número da part** fica reservado no
livro-razão (ninguém herda o número de um apagado) e o **desenho protegido** fica no
`Libs/lib-ledger.json` — ele era apagado junto até 2026-09-17, e como o espelho e a `.SchLib`
são gerados, essa era a única cópia durável; o item voltava do Odoo com o desenho genérico e
sem aviso. E um **sufixo de homônimo, uma vez dado, não sai mais** (`almox-parts.json » sufixados`):
sem isso, apagar o `PTH DIP8 OP07CP` renomearia o `PTH DIP8 OP07CP #26` para o nome cru, e todo
`schematic.js` que grava esse texto em `sym` passaria a apontar para outra peça.

O componente só sai da `.SchLib` dentro do Altium na sincronização seguinte, porque elas são
reescritas inteiras a partir do espelho — a resposta do hub diz isso.

**Limpeza em lote: `tools/almox/limpa_fantasmas.py`.** Um terço do acervo do servidor era
fantasma (1318 de 4064 valores, medido em 2026-09-17) — apagar um por um pelo hub não era
viável. Sem argumento nenhum ele é **relatório e não escreve um byte**; `--apagar` executa.

```
python tools/almox/limpa_fantasmas.py                 # relatório
python tools/almox/limpa_fantasmas.py --csv f.csv     # a lista para conferir fora
python tools/almox/limpa_fantasmas.py --apagar        # apaga os seguros
```

Ele segura sozinho o fantasma que está **em uso** num projeto: o `sym` de um `schematic.js` é
exatamente o `valores[].altium`, e apagar deixaria aquele componente órfão na folha. Esses saem
listados com projeto e designador — o certo é trocar o componente no esquema antes (vista
Esquema, que troca em bloco) e rodar de novo; `--em-uso-tambem` inclui mesmo assim.

Antes de escrever ele copia os espelhos para `Libs/.backup-fantasmas-<carimbo>/`, porque apagar
fantasma não tem desfazer. Não encosta na `.SchLib` (o sincronismo a reescreve), nem no
`almox-parts.json` (o número da part fica reservado), nem no `lib-ledger.json` — desenho
protegido de um apagado **continua guardado**, só vira órfão. O relatório separa os protegidos
por origem, porque só um punhado interessa: no servidor eram 853 protegidos entre os fantasmas,
dos quais **3** feitos à mão no hub e 850 herdados da biblioteca da casa, que se refazem sozinhos.

Ele reusa o `_usos_do_valor` do `symserver` — a mesma função da prévia do hub — em vez de
reimplementar a detecção de uso; onde o Flask não existir, cai para a busca pelo `sym`, que para
um fantasma é a marca que sobra (o `params` dele sai com `OdooId` vazio). **Não use o hub
enquanto ele roda**: o espelho é reescrito inteiro e o lock do hub está noutro processo.

O leitor Python (`tools/symbols/sch_leitor.py`) também regera o espelho inteiro sem abrir o
Altium — `python tools/symbols/sch_leitor.py --espelho` (aplica o `rename-map.js` para não
desfazer os nomes do RenameLibs) — e é provado contra o `schlib.js` que o `ExportLibs.pas`
gerou (`tests/test_sch_leitor.py`: 401/401 símbolos idênticos). O passo `--flags` leva só os
flags de visibilidade para o espelho, linha a linha, sem tocar em mais nada.

### BOM — página interativa para montar a placa

A aba **BOM** gera **uma página HTML autossuficiente** com a placa desenhada dos dois lados e a
lista de componentes ao lado. É para a bancada: clicar numa linha acende as peças no desenho,
clicar numa peça acha a linha, e o **visto** de cada linha fica salvo no navegador de quem
monta. Mesma ideia do [InteractiveHtmlBom](https://github.com/openscopeproject/InteractiveHtmlBom),
com uma diferença que importa: **não precisa de plugin novo no Altium** — sai do mesmo
`board.js` que o `ExportPcb` já gera e que a vista PCB desenha, então não há um segundo caminho
de extração para divergir do primeiro.

**A geometria sai achatada, e isso é de propósito.** O arquivo tem que abrir sozinho, em
qualquer pasta, sem internet e sem os `.js` do espelho ao lado. Então a página **não** carrega
`hub-font.js` nem `hub-laser.js`: ela recebe a geometria já resolvida — pad virou polígono
(pelo `HubLaser.padPrim`/`primPolys`, que já resolve círculo, oval, roundrect, octógono e o furo
com `drillshape`/`holerot`) e texto virou polilinha (pelo `HubFont`) — e só precisa saber
preencher polígono e traçar linha. É o que mantém **uma** implementação de forma de pad e **uma**
de fonte no projeto, as que já estão sob teste, em vez de abrir uma terceira dentro do template.

O que a página gerada faz:

| | |
|---|---|
| **ícone das faces** | **um só** para frente e verso: clicar troca de uma para a outra, e o desenho mostra a que está na tela — dois botões para um par que se exclui gastavam o dobro da barra para dizer a mesma coisa |
| **as duas** e **só a lista** | os outros dois layouts. O verso sai espelhado em X, que é a placa virada na mão e não vista através |
| **ícone de ajustes** | abre a gaveta lateral, onde mora **todo o resto**: as camadas (Pads, Serigrafia, Designadores, Trilhas, Planos, Furos), a **visão guiada**, a escolha entre **Agrupado** e **Por peça** e o **tema escuro** |
| **Agrupado / Por peça** | uma linha por compra, ou uma linha por designador — que é como se confere a placa peça a peça |
| **colunas** | **#** · visto · **Qtd** · **Designadores** · Footprint · Comentário. O **#** fica na ponta, do outro lado do visto: encostado na Qtd, dois números seguidos e alinhados à direita eram lidos como um só. Os designadores vêm primeiro entre os três campos, porque é por eles que se procura a peça na placa |
| **clique na linha** | acende todas as peças daquele grupo, nos dois lados |
| **clique na peça** | seleciona a linha e rola até ela |
| **clique num pad** | acende **a net inteira** (pads, trilhas, planos e vias) e seleciona o dono do pad — é por onde se segue um sinal na bancada |
| **visto por linha** | fica no `localStorage` do navegador de quem monta; o rodapé conta quantas peças já foram |
| **tamanho da fonte** | um **A** ao lado do “Limpar vistos” que cicla entre **pequena** (a de sempre), **média** e **grande** — o próprio A cresce a cada clique, então o botão mostra o tamanho em vez de nomeá-lo. Tudo sai de uma medida só: cabeçalho, designadores, etiqueta de lado e o respiro das linhas derivam dela por `calc()`, então a lista cresce inteira em vez de ficar um pedaço grande ao lado de outro miúdo |
| **filtro** | mora **junto da lista**, logo acima dela, e casa contra valor, footprint e designadores |
| **Limpar vistos** | ao lado do filtro, e pergunta num modal da própria página (Sim/Não), não na caixa do navegador |
| **divisória da lista** | arraste para dar mais espaço ao desenho ou à lista |
| **ícone de layout** | joga a lista para o outro lado da tela — o próprio ícone espelha junto |
| **tema escuro** | e zoom/pan com roda e arraste em cada lado |

**Visão guiada** (opção, desligada por padrão). Ligada, escolher uma linha **leva a câmera até a
peça e dá zoom** — a mesma interação que a aba Neoden tem na vista PCB, e com a mesma folga do
`zoomToObj` (a peça ocupa cerca de 1/1,6 da tela), para quem usa as duas telas ver a mesma
coisa. Medido no `PRJ-UR-DI261924`: um D6 de 3,15 mm num painel de 168 mm sai de 1,8× para
42,7× — 24 vezes mais perto.

O **filtro também guia**: digitar um designador (“D1”) mira nele, ao dar **Enter** ou 350 ms
depois que a digitação para — mirar a cada tecla faria a placa pular de “D” para “D1”. O
designador **exato** ganha do primeiro da lista: quem escreve “D1” quer o D1, e não o grupo em
que ele caiu. E a tela vai junto: peça do **verso** põe a vista no verso, peça da **frente** põe na frente. É o
lado de **montagem** que manda, mesmo num passante que aparece nos dois — é daquele lado que
ela vai ser soldada. Só quando a escolha mistura as duas faces é que as duas ficam na tela,
porque aí não há uma face certa.

A troca é **animada**: de uma peça para outra a câmera **afasta, viaja e volta a aproximar**.
A curva é a de Van Wijk & Nuij (a mesma do `d3.interpolateZoom`), e ela afasta **na medida da
distância**: entre vizinhas o campo de visão mal sobe (6 → 7,2 → 6 mm), e de um canto ao outro
da placa ele abre até 161 mm antes de descer no destino — é o que deixa o olho seguir o caminho
em vez de perder a referência num corte seco. Dura de 180 a 700 ms, conforme o percurso.
Pegar a placa na mão (arrastar ou usar a roda) interrompe a viagem, e quem tem
`prefers-reduced-motion` no sistema recebe o salto direto, sem animação.

Clicar **no desenho** nunca move a câmera, mesmo com a visão guiada ligada: quem clicou ali já
está olhando para o lugar certo, e dar zoom seria arrancar a vista da mão dele.

A opção está nos dois lugares: na aba **BOM** do hub (o estado em que a página nasce) e na
gaveta da própria página (para ligar e desligar na bancada, gravado no navegador de quem monta).

O **visto** é gravado pela identidade do grupo (valor + footprint), e não pelo índice dele: pelo
índice, regerar o BOM depois de acrescentar um componente reordenaria a lista e os vistos
passariam a apontar para outra peça, sem nada na tela dizendo que trocaram de dono.

Na barra de cima fica **só o que muda a vista** — cinco botões: as três opções de layout, o lado
da lista e a gaveta. Ajuste é ajuste: acerta-se uma vez e não se mexe mais, então não precisa
ocupar a barra o dia inteiro. Na gaveta as camadas ficam todas na mesma seção e com o mesmo
gesto — caixa de marcar.

O agrupamento é por **comment + footprint**, e **não** por lado: quem compra quer uma linha por
peça, e a etiqueta de lado na coluna de designadores já diz onde cada uma cai. A ordem dos
grupos segue o primeiro designador, em ordem natural (`R2` antes de `R10`), que é a ordem em que
a bancada procura. Camada interna não entra — quem monta não alcança ela.

**Vista 3D.** Um quadradinho **3D** no canto de cada vista troca as duas telas 2D por uma
única tela da placa em três dimensões — substrato com espessura, cobre, pads, furos e
serigrafia. A vista **abre na pose de origem** — placa reta, virada para cima, centrada e enquadrada, a
mesma pose para onde o **Centralizar** volta. Abrir de esguelha obrigava a centralizar antes de
olhar qualquer coisa.

A navegação é a do Altium: o **botão esquerdo move** a vista, o **direito gira** — e gira em
torno do ponto onde se clicou, marcado por uma **esfera com uma cruz** enquanto se segura.
Girar sempre pelo centro da placa obriga a reenquadrar a cada volta; girando pelo ponto que se
está olhando, o que interessa fica **parado no mesmo pixel**. Passar do plano vira a placa e
mostra o verso; a roda aproxima, ancorada no cursor; o **2D** volta. (Sem modelo 3D dos
componentes por enquanto — só a placa montada.)

Um **clique direito rápido** — sem arrastar — abre um menu no ponto clicado, com
**Centralizar** e **Posicionar** → 90°, 180°, 270° e **Espelhar**. As poses são ângulos
**absolutos** em torno da normal da placa, e reenquadram — girada, ela ocupa outro retângulo na
tela. O submenu **desdobra dentro** do menu em vez de flutuar ao lado: um painel que se abre
não precisa adivinhar para que lado há espaço, e funciona igual no toque.

**Centralizar recoloca a placa, e não só reenquadra.** Depois de tombar a vista, reenquadrar no
ângulo tombado devolve a placa torta no meio da tela, que não é “centralizar” para quem pediu.
Ela volta **reta e de frente** — a mesma pose da vista 2D, só que em 3D. A **face é preservada**:
quem está conferindo o verso não quer ser jogado para a frente; para trocar de face existem o
<kbd>Ctrl</kbd>+<kbd>F</kbd> e o **Espelhar**. Pelo teclado: <kbd>C</kbd> centraliza e <kbd>Ctrl</kbd>+<kbd>F</kbd> vira a
face **sem tirar a placa do lugar** — e impede a busca do navegador. O **Espelhar** do menu é o
mesmo gesto.

Virar é **dois movimentos, e não um**: a placa troca de face **e dá meia volta**, como a mão faz
ao virá-la sobre a bancada. Só inverter a inclinação espelharia o eixo **Y**; com a meia volta
junto, o espelho cai no **X** — a mesma convenção da vista **Verso** 2D. Sem isso, a mesma placa
apareceria espelhada de um jeito no 2D e de outro no 3D.

E virar exige **recolocar a câmera**: sem isso uma placa centrada em Y = 40 mm saltaria para
−40. Quem virou queria o outro lado **do que estava olhando**, e não caçar a placa de novo. As teclas são ignoradas enquanto se digita
num campo: no filtro, “c” é a letra c. A lista de atalhos fica na **gaveta**, junto do resto
dos ajustes.

Feita **sem biblioteca nenhuma**, e não por teimosia: a página tem que abrir sozinha, em
qualquer pasta, sem internet. E dá para fazer porque uma PCB é **2,5D** — tudo mora em três
alturas (cobre do verso, substrato, cobre da frente), então o **algoritmo do pintor** resolve a
oclusão inteira sem z-buffer: desenha-se a parede, depois a face que se vê, depois o cobre
dela. Não há o que se intersectar, então não há o que ordenar por triângulo.

A projeção é **ortográfica**: numa placa plana a perspectiva quase não acrescenta e custa
exatidão de medida — o que se quer aqui é reconhecer a peça, não simular uma foto. O
**sinal** da inclinação é o lado que se vê, e por isso virar a placa é um gesto só. Nada é
espelhado: as coordenadas giram de verdade, então o verso em 3D é a placa virada na mão — ao
contrário da vista **Verso** 2D, que é espelhada de propósito.

As cores são as da placa real: verde de máscara no substrato, verde mais claro na trilha e no
plano (que ficam **sob** a máscara, e por isso aparecem como relevo), metal exposto nos pads e
vias, branco na serigrafia. A espessura é 1,6 mm — o `board.js` não traz esse dado, então vale
o FR4 padrão.

> **O traço sai em lote, agrupado por espessura.** O caro não é a conta da projeção, é a
> chamada: um `stroke` por segmento dava **8.746 traços só de serigrafia** por quadro no
> `PRJ-UR-DI261924`, e a órbita redesenha a cada movimento do ponteiro. Como a espessura é o
> único atributo que muda entre eles, um caminho por espessura resolve: os 10.307 traços de
> silk e trilha viraram **17 chamadas**, com o mesmo desenho na tela. Traço não tem regra de
> preenchimento, então juntar segmentos num caminho só não muda o resultado — ao contrário do
> `fill`, onde o sentido do polígono importa, e por isso o preenchimento continua um a um.
> Sobram 3,0 ms de geometria por quadro na maior placa do acervo.

Arco de serigrafia e de cobre entram achatados em polilinha: em 3D um arco no plano da placa
vira uma **elipse** na tela, e o `ctx.arc` não serve. São **626 arcos de serigrafia** no acervo
(236 só no `MID - DI261897`), então descartá-los deixava a placa visívelmente diferente da
vista 2D.

A divisória entre as opções e a prévia é **arrastável**, igual às da aba Laser — puxe até o
fim (ou dê duplo clique) para fechar a lateral e dar a largura toda à prévia, e duplo clique
de novo para devolver. A largura fica no navegador, não no projeto: é preferência de tela, e
trocar de placa não pode mexer nela. As duas abas usam a **mesma** implementação de divisória.

A **prévia** na aba é a página inteira num `iframe` com `srcdoc`: o que se vê é
literalmente o que quem abrir o link vai ver. Uma diferença esperada: a prévia roda **sem
servidor** (o gerador recebe `api` vazio), então nela o visto fica no `localStorage` em vez
de ir para a bancada, e não persiste — dentro do `srcdoc` a origem é opaca. É prévia, não é
a folha de montagem.

**Link**

O BOM **não é um arquivo que se baixa**. Cada projeto tem uma URL fixa:

    http://<servidor>:<porta>/bom/<id-do-projeto>

| Botão | O que faz |
|---|---|
| **Copiar link** | grava as opções da aba e copia a URL do BOM deste projeto |
| Abrir numa aba | abre a mesma URL — o que se vê é o que quem recebeu o link vê |
| Refresh | busca novamente os espelhos do esquema e da PCB e recria o BOM |

`/bom/<id>` não devolve um BOM gravado: devolve um **bootstrap** de duas mil letras que
carrega o `hub-bom.js` atual, os espelhos do projeto e o estado da bancada, e monta o
documento no navegador de quem abriu. Não existe cópia velha em lugar nenhum — é daí que
vem a propriedade que se queria: melhorar o gerador melhora o BOM de **todos** os projetos
no mesmo instante, sem regerar nada e sem reenviar link para ninguém.

O BOM usa a geometria e os componentes físicos de `board.js`. Para componentes que existem
nos dois espelhos, `comment` e `footprint` vêm de `schematic.js` quando ele foi atualizado
depois da PCB; após um novo `ExportBoard`, os dados da PCB prevalecem. Assim, trocar um
comentário de 15k para 16k no esquema exportado atualiza o agrupamento sem esperar o ECO.
A página aberta confere a revisão dos dois espelhos a cada quatro segundos e se recria
quando ela muda. O botão **Refresh** faz essa busca na hora, tanto no link quanto na prévia
do hub. Mudanças feitas somente nos documentos nativos do Altium precisam ser exportadas
para os espelhos; inclusão, remoção e posição de peças na placa precisam do ECO e de
`ExportBoard` para aparecerem no desenho do BOM.

A ordem dos `<script>` do bootstrap não é cosmética. No browser o `hub-bom.js` lê
`root.HubFont` e `root.HubLaser`, e fora do CommonJS ninguém resolve isso sozinho: com a
ordem errada a página abre morta, com `reading 'padPrim'` no console. O `test_hubapi.py`
cobra a ordem.

O preço é depender do servidor no ar, e foi uma troca deliberada: o link tem que abrir do
tablet da bancada, de qualquer máquina da rede, e amanhã de um servidor de verdade — nada
disso um arquivo na pasta de Downloads de alguém faz.

> **O link tem que abrir de outra máquina.** Quem abre o hub em `127.0.0.1` copiaria um
> endereço que só funciona no próprio PC, e o ponto do link é justamente abrir no tablet:
> `GET /api/bom/<id>/link` troca o localhost pelo IP da rede. Se o `Host:` do request já é
> um nome de rede — o dia em que isso virar um servidor de verdade — fica como veio, porque
> o próprio `Host:` é a melhor pista de como se chega ali. E a cópia passa pelo
> `textarea` + `execCommand` e não só pelo `navigator.clipboard`: este último só existe em
> contexto seguro, e o hub aberto por `http://192.168.x.x` **não** é um.

**Os vistos são compartilhados.** Quem monta está no tablet e quem confere está no PC; a
lista só serve para dois se os dois virem a mesma coisa. O que já foi montado fica em
`Projects\<nome>\bom-vistos.json`, e a página busca de volta a cada quatro segundos (e ao
voltar para a aba):

- O que sobe é um **delta** (`{set:{chave:bool}}`), nunca o mapa inteiro — duas pessoas
  marcando peças diferentes ao mesmo tempo se somam, em vez de a última apagar o trabalho
  da outra. Desmarcar **apaga** a entrada: o arquivo guarda o que foi feito, e só.
- O `rev` que a página compara é **hash do conteúdo**, não `mtime`. Dois vistos marcados no
  mesmo milissegundo saem com o mesmo `st_mtime_ns` no NTFS, e a outra máquina perderia o
  segundo — que é exatamente o caso de duas pessoas na mesma placa.
- `bom-vistos.json` e `bom-opts.json` ficam **fora** do watcher (`_snapshot`). Dentro dele,
  cada visto marcado dispararia o SSE e recarregaria a página de todo mundo — no meio da
  montagem, que é quando ninguém pode perder a tela de vista.
- Servidor fora do ar **aparece na tela**. Silêncio faria a bancada marcar no vazio.
- `POST /api/bom/<id>/vistos` **não** é só-localhost, ao contrário do `laser-open`: quem
  marca é o tablet. Ele escreve um arquivo só, dentro da pasta do projeto, e a pasta vem do
  slug do índice — nada de caminho vindo do cliente.

As **opções** com que a aba gerou (tema, lados, o que aparece) vão para
`Projects\<nome>\bom-opts.json` quando se copia o link, e o link abre com elas. Se essa
gravação falhar, o link ainda sai — no padrão: opção é conforto, link é o que se pediu.

Aberto de `file://`, sem servidor, o gerador ainda produz a página autocontida de sempre, e
nela o visto volta para o `localStorage` do navegador.

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
- `--host 127.0.0.1` deixa o hub só nesta máquina: ninguém da rede o alcança, o link do
  BOM sai com o endereço de loopback e só `Host:` de loopback é aceito (proteção contra
  DNS rebinding). O padrão continua `0.0.0.0`, a rede toda. É assim que o app desktop
  sobe o hub.
- Com o servidor rodando, o hub também **salva** arquivos direto no workspace
  (`POST /api/save`, restrito a `Projects\<nome>\{changes,schematic,annotations}.js`,
  escrita atômica). Sem servidor, os botões de salvar baixam o arquivo para você
  substituir manualmente.

## App desktop (Windows)

`electron/` empacota este hub como aplicativo do Windows, o **EletricHUB** (o nome do
sistema desde 2026-09-24; o hub também se apresenta assim). Não é uma
reescrita: o app sobe o próprio `hubserver.py` com um Python 3.12 embutido e o mostra
numa janela. Tudo o que o hub do servidor faz, o app faz, só que nesta máquina.

- **Instalação:** `EletricHUB-Setup-X.Y.Z.exe`, por usuário e sem administrador. O
  instalador não é assinado, então o Windows SmartScreen pede **Mais informações ›
  Executar assim mesmo** na primeira vez.
- **Pasta de trabalho** (padrão `C:\EletricHUB`; instalações de antes da 1.1.0 seguem em
  `C:\AltiumHub`): recebe o código do hub e o estado da
  máquina (`Projects\`, `Libs\`, credenciais). A cada atualização o app repõe só o
  código, pelas mesmas regras do `tools/deploy/deploy.sh`.
- **Importar do servidor** (Arquivo › Importar do servidor): traz projetos, bibliotecas
  e o almoxarifado do hub central (`http://192.168.15.192:8100`). Um arquivo mudado só
  aqui não é sobrescrito.
- **Almoxarifado:** consulta o Odoo de produção (`192.168.15.192:8070`, `odoo_db`) e
  gera as bibliotecas localmente. Antes de cada sincronismo, o app traz do servidor o
  livro-razão de part numbers, para a numeração daqui continuar igual à do servidor.
- **Altium:** as configurações podem apontar o `home.txt` dos scripts para a pasta
  local. Depois disso, rode os scripts pelo `AltiumPCBMirror.PrjScr` da pasta de
  trabalho.
- **Menus:** as configurações do hub (tema, idioma, atalhos, Odoo, exclusão de projeto)
  abrem por **Arquivo › Configurações do hub…** — no app o ⚙ do canto das abas não existe;
  as do próprio app (pasta de trabalho, porta, rede) por **Arquivo › Configurações do
  aplicativo…** (`Ctrl+,`).
- **Atualização automática** pelos releases deste repositório no GitHub.

Build, release, tokens e o porquê de cada escolha estão em
[electron/README.md](electron/README.md).

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

## Enviar a lista de componentes para o Odoo

Na vista **Esquema**, aba **Configurações**, o botão **↗ Enviar para o Odoo** monta a lista
de materiais do esquema e a manda para a fila de aprovação do Odoo (modelo
`di.lista.altium`, módulo `di_lista_altium`).

**A lista não entra no inventário quando chega.** Ela cai numa fila, alguém do estoque
confere e decide; só na aprovação nascem o produto "PCB (montada)" e a `mrp.bom`. Entre o
desenho de um projetista e um fato do almoxarifado existe uma pessoa — que sabe se o
projeto virou placa, se a revisão é a que foi para a fábrica e se as peças são as que a
casa compra. O hub nunca aprova nada.

### Como usar

1. Salve o esquema. A lista sai do `schematic.js` **em disco** — o botão oferece salvar se
   houver alteração pendente, porque uma lista montada do que está só na tela não existe
   para mais ninguém.
2. A **revisão** (`B`, `P2`…) é **opcional**, e repeti-la é permitido. Ela entra no nome da
   placa no Odoo (`Projeto rev B`) e compõe a chave de idempotência
   `altium:<PROJETO>:<REVISÃO>`. Pôr, repetir ou deixar em branco é decisão de quem envia —
   o Odoo não pede revisão, e a exigência que existia era só nossa. Em branco, a chave vira
   `altium:<PROJETO>:` e **todos** os envios sem revisão daquele projeto dividem um registro
   só lá; a tela diz isso na confirmação. O campo vem pré-enchido com a revisão do último
   envio. **O palpite pelo nome da pasta só sugere, nunca decide**: `parse_revisao` lê `P2`
   em `DMB - DI231765_P2`, e ali `_P2` é variante, não revisão — até 2026-09-17 o CLI
   mandava como rev `P2` sem avisar ninguém.
3. **Conferir** — roda `di_confere_lista`, que resolve as linhas e diz o que resolveria
   **sem gravar nada**. As pendências aparecem na coluna *resolução*.
4. **Enviar** — só depois de conferir, e com uma confirmação explícita.

Reenviar a mesma revisão **substitui as linhas** enquanto ninguém decidiu: é assim que se
corrige a lista. Depois da decisão, o módulo do Odoo (`di_recebe_lista`) não mexe mais
naquele registro e devolve o estado com `gravou:false` — **o hub avisa e não impede**.
Repetir assim mesmo, abrir outra revisão ou pedir a reabertura no Odoo é decisão de quem
envia. Fazer o reenvio ter efeito de verdade depende do módulo de lá, não deste lado.

**Recusa não pede explicação.** Foi recusada e pronto: se quem recusou escreveu um motivo,
ele aparece num diálogo (a spec pede que chegue ao projetista); se não escreveu, o aviso é
uma notificação e acabou — ausência de motivo não é falta. E recusa **não** é estado
terminal deste lado: a tela continua consultando `di_estado_lista`, então uma reabertura
feita no Odoo chega aqui. Até 2026-09-17 não chegava, e havia um defeito pior — o hub
comparava o estado devolvido em vez da *mudança* de estado, e por isso todo reenvio de uma
lista recusada reabria o modal vermelho com o motivo antigo, como se a recusa tivesse
acabado de acontecer. Era o que fazia o `DMB - DI231765_P2`, recusado uma vez, cobrar para
sempre. A regra agora mora numa função pura, `desfechoDoEnvio`, presa por
`tests/test-odoolista-desfecho.js`.

O recibo (`id`, `referencia`, `estado`, pendências) fica em
`Projects\<nome>\odoo-lista.json`, fora do git: tudo nele volta de
`di_estado_lista(uid_externo)`.

### Como uma linha acha o produto

Uma linha por componente, com os designadores agrupados — `R1, R2, R5` é **uma** linha com
quantidade 3, que é como a BoM do Odoo quer o dado e como quem confere lê a placa.
Componente multi-parte conta **uma vez**: um conector de 16 partes é um conector, e nos 16
projetos do workspace são 782 itens `comp` para 562 componentes.

A cascata para achar o produto, em ordem:

| passo | de onde vem | quando pega |
|---|---|---|
| `product_id` | `params » OdooId` do próprio componente | peça colocada pelo hub a partir do almoxarifado |
| `product_id` | `Libslmox-*.js » valores[].itens[].odoo`, pelo nome do símbolo | símbolo da biblioteca gerada do Odoo |
| `mpn` (+ `encapsulamento`) | o nome do símbolo, quando tem cara de part number | biblioteca antiga da casa (`BC337`, `MMBD4148SE`) |
| nada | — | a linha vai assim mesmo, marcada, e quem confere aponta na mão |

Duas regras que valem o cuidado que custaram:

- **valor ambíguo não manda `product_id`.** 62 dos 2511 valores do almoxarifado têm mais de
  um produto do Odoo sob o mesmo rótulo (fabricantes diferentes); escolher o primeiro em
  silêncio poria a peça errada na placa. O footprint desempata quando só um item casa; sem
  isso a linha volta como pendência, que é o comportamento certo;
- **valor de componente não é part number.** `330R` e `100n` nunca viram MPN. MPN que não
  existe volta como pendência e não custa nada; MPN palpitado que casa por acaso põe a peça
  errada na placa e ninguém desconfia.

E o que **nunca** é mandado: `default_code`. Neste acervo ele é o **endereço da peça na
gaveta**, não part number — casar por ele colocaria na placa o componente que mora no mesmo
escaninho.

### A cobertura depende de onde veio o símbolo

Nos projetos legados do workspace, só 2% das linhas têm `product_id` e 21% têm MPN: esses
esquemas foram desenhados com a `BIBLIOTECA DE ESQUEMA` da casa, que não tem vínculo com o
cadastro, e 28% dos designadores têm como *comment* a fórmula não resolvida do Altium
(`=Value + ' - ' + Potencia`), que não casa com nada.

O caminho que resolve isso é o `params`: o **ExportProject** passou a exportá-lo, então um
componente escolhido no hub a partir do almoxarifado mantém o `OdooId` depois de ir ao
Altium e voltar. Antes ele morria no primeiro round-trip — o `BuildSchematic` escrevia o
parâmetro, o export não o lia, e nenhum dos 16 `schematic.js` do workspace tinha o campo. O
diálogo final do ExportProject agora diz quantos componentes trouxeram identidade.

Para um projeto legado, a alternativa é o estoque cadastrar as peças e o projetista trocar
os símbolos pelos do almoxarifado — a lista só pode ser **aprovada** quando toda linha
apontar para um produto.

### Credenciais e destino

A senha vem de `ODOO_SENHA` (ou `ODOO_LISTA_SENHA`) no ambiente do processo do hub — no
servidor, uma linha em `/etc/altiumhub/senha.env`, que o compose já injeta; na bancada,
`$env:ODOO_SENHA = '...'` antes de subir o `hubserver.py`. Alternativa: `.hub-odoo.json` na
raiz do workspace.

**A senha não vem do `hub-almox.json` de propósito.** Aquele arquivo é servido em texto
claro pela rota curinga do hub (`GET /hub-almox.json` responde 200 para a LAN inteira, nas
portas 8000-8004) — e esta conta *escreve* no Odoo, não só lê. O ponto no nome de
`.hub-odoo.json` não é enfeite: é o que faz o `_serve` recusá-lo. Url, base e login, que não
são segredo, ainda são herdados do `hub-almox.json` quando não há nada mais específico.

O destino é **fixo**: `http://192.168.15.192:8070`, base `odoo_db`, modelo
`di.lista.altium` — o Odoo da casa é um só, e a tela mostra os três em somente-leitura. A
única coisa editável é a credencial. Até 2026-09-15 o padrão era `http://192.168.15.182:8070`,
o servidor de **teste**, e era um convite ao acidente: uma máquina sem configuração mandava a
lista para lá sem avisar ninguém. Quem precisar apontar para outro Odoo (uma bancada, para
testar) escreve `.hub-odoo.json` à mão — as variáveis `ODOO_LISTA_URL` / `_DB` / `_LOGIN` /
`_MODELO` continuam valendo e ganham de tudo. Medido em
2026-09-11: o modelo `di.lista.altium` existe no `.182` e **não existe** no `.192` —
apontar para produção hoje falha com modelo inexistente.
O modal mostra sempre para onde vai antes de você enviar.

### Sem passar pelo navegador

    python odoolista.py --projeto "PESDA - DI241790" --revisao B              # ensaio (revisao e opcional)
    python odoolista.py --projeto "PESDA - DI241790" --revisao B --aplicar    # envia
    python odoolista.py --projeto "PESDA - DI241790" --revisao B --estado     # consulta

Ensaio por padrão, como o botão.

## Converter um projeto para o almoxarifado

Projeto antigo vem com os componentes da biblioteca da casa — `RES [ SMD ]`, footprint
`RES 1206`, comment `10k` —, e o que se quer daqui em diante é a peça do almoxarifado, que
carrega o `OdooId` e entra na lista de compras. Trocar um por um pelo seletor da vista
Esquema sempre deu; o botão **⇄ Converter para o almoxarifado** (vista Esquema, aba
*Configurações*) olha o projeto inteiro de uma vez.

Ele lê a folha aberta, junta os componentes iguais numa linha só (mesmo símbolo, footprint,
comment e parâmetros — 175 resistores iguais são UMA decisão) e recomenda o substituto a
partir de, em ordem de força:

| sinal | peso | de onde vem |
|---|---|---|
| MPN igual | 120 | `params » MPN` dos dois lados |
| valor igual | 60 | `params » Value` ou o comment, normalizado (`4k7` = `4.7k`, `100nF` = `0.1uF`) |
| part number no nome | 55 | `1N4148` no comment achado em `PTH 1N4148UR-1` |
| encapsulamento | 40 | o nome do footprint (`RES 1206` → `1206`, `DIP8` → `DIP-8`) |
| família no texto | 35 | `LED SMD 1206 RED` traz "LED" |
| vias | 30 | `CONECTOR HEADER / 16 VIAS` ↔ `16 Pin` |
| mesmo tipo, montagem, tensão, estoque | 25/15/6/3 | designador, `[SMD]`/`[PTH]`, `25V`, saldo |

Três coisas **nunca** são recomendadas, por mais pontos que o resto some: tipo diferente
(um varistor 1206 não substitui um LED 1206), valor diferente e SMD por PTH. Quando o valor
exato não existe no almoxarifado, a linha diz qual é o mais próximo — e não o escolhe.

Vêm **marcadas** só as linhas de confiança alta e média; as de confiança baixa aparecem com
a sugestão, desmarcadas. Componente cujo comment é uma fórmula do Altium
(`=Value + ' - ' + Potência`) e cujo `Value` não veio no export nunca passa de baixa: sem o
valor não há recomendação, e a linha diz isso.

O **Aplicar** muda só o esquema aberto — nada vai para o disco antes do Salvar. Quem grava é
a mesma ponte que o painel da BoM e o envio da lista usam (`__hubAplicaVinculos`), então a
troca sai com `sym`, `comment` e `params` (com `OdooId`) idênticos aos de um componente
colocado à mão; conector multi-parte recebe só a identidade, para não perder as outras
partes e a fiação junto.

Medido nos 19 projetos deste workspace: 1428 componentes, 368 tipos, 134 linhas de confiança
alta e 12 sem sugestão nenhuma. `node tests/test-converte.js` roda isso a cada mudança.

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
