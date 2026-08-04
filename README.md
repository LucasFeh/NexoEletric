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
├── hub.html                 interface única (Projetos, Esquema, PCB, Libs)
├── schframe.html            vista Esquema (carregada em iframe pelo hub)
├── pcbframe.html            vista PCB (shell fino, em iframe pelo hub)
├── pcbframe.js              lógica da vista PCB (renderer, painéis, PCB List, CSV)
├── hub-core.js              lógica pura (parsing, validação, nets, motor único de changes)
├── hub-draw.js              renderers canvas compartilhados (símbolo, footprint, PCB)
├── projects.js              índice do histórico de projetos
├── AI-GUIDE.md              contrato/manual para a sessão de IA
├── hubserver.py             servidor local opcional (Flask; tempo real na rede)
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

## hub.html

Arquivo único autocontido na raiz do workspace — abre com **duplo clique, sem internet** —
com 4 vistas:

- **Projetos** (inicial) — histórico lido de `projects.js`: um card por projeto, com esteira
  de status **esquema → eco → roteada → aplicada**, datas, contagens (componentes, nets,
  folhas) e atalhos para abrir nas vistas Esquema/PCB. Projetos `_*` levam o selo DEMO.
- **Esquema** — renderiza `Projects\<nome>\schematic.js` com os gráficos reais de
  `Libs\schlib.js`: símbolos, fios, junctions, net labels, power ports, designator/comment.
  Zoom/pan, cursor em mil, clique numa net destaca ela na folha inteira (com os pinos
  membros). Painel lateral com a lista de componentes e a validação do esquema.
- **PCB** — a vista PCB (`pcbframe.html` + `pcbframe.js`; motor no `hub-core.js`), lendo `Projects\<nome>\board.js` e
  `changes.js`: render fiel, fantasma tracejado das posições originais, lista de mudanças
  com validação, tabela PCB List pós-mudança e exportação para CSV.
- **Libs** — navegador das bibliotecas espelhadas: busca por nome/descrição, símbolo
  desenhado lado a lado com o footprint associado, aviso destacado nos símbolos sem
  footprint na lib.

## Servidor local com tempo real (opcional)

O hub continua abrindo por **duplo clique**, sem servidor. Se quiser ver os exports em
**tempo real** (inclusive de outra máquina da rede local), rode na raiz do workspace:

    python hubserver.py

- Abra `http://127.0.0.1:8000` — ou `http://<IP-desta-máquina>:8000` de outro PC da
  rede (o servidor imprime as duas URLs ao subir; o Windows pode pedir liberação de
  firewall na primeira vez).
- Rodou um **Export** no Altium → a página aberta recarrega sozinha em ~1 s.
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
4. Editar um esquema **existente** não é suportado nesta versão — o espelho é só leitura
   (round-trip de edição de esquema fica para a v3). Para mudar o esquema, edite no Altium
   e rode `ExportProject` de novo para atualizar o espelho.

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

Polígonos/planos, regiões, keepouts, textos e regras são exportados para **visualização**,
mas não são editáveis nesta versão. Furos de fixação/NPTH aparecem em `freepads`.

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
