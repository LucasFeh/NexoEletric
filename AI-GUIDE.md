# AI-GUIDE — Como trabalhar neste workspace (contrato para a sessão de IA)

Você está com um Claude Code aberto no **workspace central do AltiumPCBMirror**
(normalmente `D:\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror` — confirme com o usuário se for outro caminho). Ele
concentra as bibliotecas espelhadas (`Libs\`), o histórico de projetos
(`Projects\<nome>\`) e o `hub.html`; não é mais uma pasta que existe só ao lado de um
`.PcbDoc`. Depois que você edita os arquivos aqui, um script dentro do Altium aplica suas
mudanças no projeto real.

O hub novo (combobox de projeto, pipeline, abas) é servido por `hubserver.py`
(`python hubserver.py`); o hub clássico (Projetos/Esquema/PCB/Libs, duplo clique) continua
em `hub-classic.html`. As referências a "`hub.html`, vista Esquema/PCB" neste documento
continuam válidas nos dois — as vistas são os mesmos `schframe.html`/`pcbframe.html`.

Duas frentes de trabalho, normalmente nesta ordem para um projeto novo:

- **Parte A — Esquema** (`schematic.js`): montar um projeto do zero (ou entender um
  esquema existente, só leitura) escolhendo componentes das bibliotecas reais do usuário.
- **Parte B — PCB** (`changes.js`): depois que o esquema virou `.SchDoc` real e passou
  pelo ECO do Altium (ou para um projeto que já tinha PCB), posicionar/rotear a placa —
  fluxo idêntico ao v1, só que os arquivos agora vivem em `Projects\<nome>\`.

**Pelo MCP (recomendado):** o servidor `mcp/eletrichub-mcp.js` dá à IA as ferramentas do hub
inteiro — projeto, esquema, PCB (com os `orig_*` preenchidos sozinhos a partir do `board.js`),
regras/DRC, ratsnest, polygon pour, teardrops, ECO, placa nova, Gerber, PDF e sinalizadores —
e cada escrita valida antes de gravar. Registro: `node mcp/registrar.js` (ou, no app, Ajuda »
Conectar IA). `list_commands` lista tudo; o `mcp/README.md` explica. Este documento continua
sendo o contrato dos arquivos, que é o que as ferramentas escrevem.

---

## Parte A — Esquema (`schematic.js`)

### Onde trabalhar

- `Libs\schlib.js` (símbolos: pinos, gráficos, modelos de footprint associados) e
  `Libs\pcblib.js` (footprints: pads, silk, bbox) são o espelho das bibliotecas reais do
  usuário, gerado pelo `ExportLibs`. **Leia os dois antes de escolher qualquer
  componente.** São só leitura — nunca edite `Libs\*.js`.
- Projeto novo: crie `Projects\<nome>\schematic.js` (a pasta/arquivo ainda não existem —
  você os cria) e adicione uma entrada em `projects.js`, no formato exato já usado pelo
  índice (mesmo shape da fixture `_DemoKit`):

  ```js
  {"name":"<nome>","files":{"schematic":true,"board":false,"changes":false,"annotations":false,"buildreport":false,"applyreport":false},"indexed":"<data/hora ou nota>"}
  ```

  `files.schematic:true` e todos os outros `false` até os scripts do Altium gerarem
  `board.js`/`changes.js`/os relatórios (eles regeneram `projects.js` sozinhos depois).
- `Projects\<nome>\lista-extras.json` são os componentes **fora do esquema** que o usuário
  junta à lista do Odoo pelo hub (as linhas `EXTRA n`). É do hub — você não precisa editá-lo,
  e peça dele **não** vai para o `schematic.js`.

**Dois escritores:** o usuário também edita o `schematic.js` pelo hub (vista Esquema). Releia o arquivo antes de cada edição e preserve as linhas dele; após edições, o BuildSchematic deve rodar com limpeza da folha para refletir removidos/alterados. A limpeza apaga fios, rótulos, power ports, junções, No ERC e textos — **componentes não**: eles são reaproveitados pelo designador/parte para preservar o `UniqueID` que o ECO usa. Componente apagado do `schematic.js` continua na folha e precisa ser removido à mão no Altium.

### Coordenadas (idêntico ao Altium Sch)

- Unidade: **mil** (1/1000"). Pinos e fios sempre em inteiros, na grade de **100 mil**.
- Eixos X para a direita, **Y para cima**, origem no canto inferior esquerdo da folha.
- Rotação: só **0/90/180/270** + flag `mirror` (espelha X **antes** de rotacionar).
  Transform de um ponto local do componente: `mirror ? (-x,y) : (x,y)` → rotaciona `rot`
  anti-horário → soma a posição do componente (`x,y` do item `comp`). Ângulo de
  pino/texto: `a' = (mirror ? 180-a : a) + rot (mod 360)`.
- Ponta quente do pino (onde o fio precisa encostar) = `(x,y) + len·dir(orient)`, com
  `dir(0)=+X, dir(90)=+Y, dir(180)=-X, dir(270)=-Y`. O `x,y` de um pino em `schlib.js` é a
  ponta do **corpo** do símbolo, não a ponta quente — calcule antes de desenhar o fio.
  **Fios devem terminar EXATAMENTE na ponta quente** (mesma exigência de grade do
  Altium); sem isso, o Altium não considera o pino conectado.
- O `BuildSchematic` usa `Orientation`/`IsMirrored` nativos do Altium para desenhar de
  verdade — a convenção acima é para você (e o preview do hub) calcularem a posição
  antes de escrever no arquivo; a verdade final é sempre o Altium.

### Formato `schmirror-v2`

```js
var schematic = {
"format":"schmirror-v2",
"project":"_DemoKit",
"generated":"...",
"units":"mil",
"items":[
{"t":"sheet","name":"main","size":"A4"},
{"t":"comp","sheet":"main","ref":"R1","sym":"RES","part":1,"x":2400,"y":3400,"rot":0,"mirror":false,"footprint":"R0805","comment":"330R"},
{"t":"wire","sheet":"main","pts":[[1400,3100],[1800,3100],[1800,3400],[2200,3400]]},
{"t":"netlabel","sheet":"main","net":"VCC","x":1800,"y":3400,"rot":0},
{"t":"power","sheet":"main","net":"GND","style":"GndPower","x":1600,"y":3000,"rot":270},
{"t":"port","sheet":"main","net":"SDA","io":3,"style":0,"x":2600,"y":3400,"w":400},
{"t":"junction","sheet":"main","x":1800,"y":3100},
{"t":"noerc","sheet":"main","x":2600,"y":3400},
{"t":"text","sheet":"main","s":"Fonte 5V","x":3800,"y":4000,"h":10}
]};
```

Um item JSON **plano** por linha (o parser DelphiScript lê linha a linha, como no
`changes.js`); `pts` é a única exceção de aninhamento, sempre numa linha só.

### Campos por item (`t`)

| `t` | obrigatórios | opcionais |
|---|---|---|
| `sheet` | `name`, `size` (A4/A3/A2/A1/A0/A/B/C/D/E, ou `Custom`) | `w`,`h` — **medida real da folha, em mil**, como o Altium a reporta. Sem elas vale a tabela por nome, que traz o tamanho *legado* do Altium e **não** o ISO real: a “A4” do template da casa mede 11693×8268, não 11500×7600, e a diferença joga carimbo e fios de borda para fora da página desenhada |
| `comp` | `sheet`,`ref`,`sym`,`x`,`y`,`rot`,`footprint` | `part` (default 1), `mirror`, `comment`, `params`, `refdx`/`refdy` e `comdx`/`comdy` — deslocamento do texto do designador e do comment em relação à âncora do componente, em mil, na coordenada da folha, medido até o **canto inferior-esquerdo** do texto; par ausente = o hub decide onde pousar o texto — mas o export os emite para todo componente |
| `wire` | `sheet`,`pts` (`[[x,y],...]` ≥2, numa linha só) | — |
| `netlabel` | `sheet`,`net`,`x`,`y` | `rot` |
| `power` | `sheet`,`net`,`style`,`x`,`y` | `rot` (`Bar`/`Circle`/`Arrow`/`Wave`/`GndPower`/`GndSignal`/`GndEarth`) |
| `port` | `sheet`,`net`,`x`,`y` | `style` e `io` (**inteiros crus do Altium**, `-1` = não foi possível ler), `w` (comprimento em mil, default 400), `rot`, `fill`/`textColor`/`color` (preenchimento, letra e borda em `#rrggbb`; ausentes = o padrão amarelo com letra preta do `hub-draw`) |
| `junction` | `sheet`,`x`,`y` | — |
| `noerc` | `sheet`,`x`,`y` | `style`, `color` — **reservados**: o ExportProject ainda não os emite (o símbolo e a cor da diretiva não foram medidos num Altium real), e o BuildSchematic deixa o Altium usar o padrão dele |
| `text` | `sheet`,`s`,`x`,`y` | `h` (só informativo — veja Limitações no README) |

`sym` referencia o nome do símbolo em `schlib.js`.

`refdx`/`refdy` e `comdx`/`comdy` são o **deslocamento do texto em relação à âncora do
componente**: a posição na folha é `(comp.x + refdx, comp.y + refdy)` para o designador e
`(comp.x + comdx, comp.y + comdy)` para o comment — mesma coordenada de `comp.x`/`comp.y`, Y
para cima, em mil. É deslocamento a partir da âncora, e não do lugar de origem, porque assim
mover o componente leva o texto junto e **girar não gira o texto**.

O ponto é o **canto inferior-esquerdo** do texto, e não o centro dele — é esse o ponto que o
Altium guarda (o `RECORD=34`/`41` do `.SchDoc` não traz `Justification`, e o padrão dele é
`BottomLeft`), e o hub ancora no canto também (`schframe.js » textoComp`/`caixaTexto`). Os dois
lados medem até o mesmo ponto: `Txt.Location` é exatamente o ponto do contrato, e não há
conversão a fazer em lado nenhum. Com o hub centrando e o Altium ancorando no canto, a mesma
coordenada queria dizer dois lugares, e a ida e volta andava meia palavra a cada passagem.

Designador e comment saem na horizontal dos dois lados, mas isso é limitação do espelho, não
regra do Altium: ele guarda uma `Orientation` no registro do próprio texto e sabe deixar o
designador em pé. Nenhum dos dois lados carrega essa propriedade hoje — designador em pé no
Altium aparece deitado no hub.

**Ausente não é zero**, e a regra vale **por par**: `refdx` com `refdy`, `comdx` com `comdy`.
Zero é uma posição legítima (texto em cima da âncora); par ausente quer dizer "o hub decide
sozinho", e ele pousa o designador em cima do corpo e o comment embaixo. Espelho antigo, que
não tem os campos, não muda de comportamento nenhum.

**Meio par é erro** — escreva sempre os dois. Os dois lados o ignoram do mesmo jeito: o hub
desenha como se o par não existisse (ele decide onde pousar o texto) e o `BuildSchematic` não
toca no texto. A diferença é só no barulho: o hub fica quieto e o build registra `[FALHA]`
nomeando o campo que falta, porque quem escreveu meio par quase sempre queria escrever os dois.
O `BuildSchematic` também recusa deslocamento absurdo (acima de 50000 mil): registra `[FALHA]`
e não move aquele texto, porque é quase sempre erro de quem escreveu, não intenção.

O `ExportProject` lê e emite os quatro campos — a posição do designador **e a do comment**. Ele
os emite para TODO componente sempre que a sonda responder, porque daqui não dá para saber qual
texto a mão moveu: o lugar automático do Altium não é um deslocamento fixo com que comparar. Na
prática, depois do primeiro export "ausente" deixa de existir naquele projeto. Se esta
instalação do Altium recusar a leitura, o componente sai sem os campos, o relatório avisa uma
vez (não um por componente) e o hub volta a decidir onde pousar o texto.

O `BuildSchematic` escreve a posição e **tenta** desligar o autoposicionamento daquele texto —
senão o Altium o re-ancora sozinho no desenho seguinte. "Tenta" é a palavra certa: o nome dessa
propriedade no DelphiScript de esquema **nunca foi medido** (no arquivo a marca é
`OverrideNotAutoPosition`, mas nome de arquivo não é nome de API, e do lado PCB o equivalente é
um *método* no componente, não uma propriedade no texto). É a mesma situação dos inteiros de
`style`/`io` da port, logo abaixo: atravessa como sonda, e a primeira rodada dentro do Altium
diz se pegou. Enquanto não pegar, a posição é escrita e o Altium pode re-ancorar o texto depois.

O que ele escreve fica gravado no `.SchDoc`, então só vale para o texto que realmente mudou de
lugar: o que já está onde o espelho pede não é tocado — nem a posição, nem o autoposicionamento.
Sem essa guarda, um único re-despejo passaria para manual os designadores de toda a folha (nos
projetos medidos, 156 de 159 se reposicionam sozinhos hoje).

A posição é somada à âncora **atual** do componente, já depois de ele ter sido posicionado —
igual à fórmula acima quando o posicionamento deu certo, e diferente dela exatamente quando não
deu (aí o texto acompanha o símbolo onde ele ficou, em vez de ficar sozinho no lugar certo).

`params` é a **identidade da peça no cadastro**, num campo plano `Chave=Valor;Chave=Valor`
(o parser DelphiScript lê linha a linha e não aguenta objeto aninhado). Ele carrega
`OdooId` (o id da variante `product.product`), `ValorId`, `MPN`, `Encapsulamento`, `Value`
e `Mouser` — e é o que liga um componente ao produto do Odoo **sem depender de texto**.

O campo atravessa os três lados: o hub o escreve ao colocar um componente do almoxarifado
(`schframe.js » paramsDoValor`), o `BuildSchematic` o transforma em parâmetro do componente
no Altium (`AplicaParams`) e o `ExportProject` o traz de volta (`ParamsOf`). Só a
identidade volta: saldo, local e custo são fotografia do almoxarifado, mudam sozinhos e
fariam o `schematic.js` mudar sem que nada do desenho tenha mudado.

Ele é **opcional e é omitido quando vazio** — `schematic.js` de projeto antigo não o tem, e
componente da biblioteca da casa nunca vai ter. Sem ele a lista de materiais ainda sai,
mas a linha só pode casar por MPN ou voltar para conferência humana.

### Template de folha (`sheet`, opcional)

Cada item `sheet` pode levar dois campos. Folha sem `template` desenha como sempre desenhou.
- `"template":"<id>"`: o id do template, de `Libs/sch-templates.js` (os do Altium: `altium:Standard`, `ISO A3 Landscape`…) ou de `Libs/sch-templates-casa.js` (o da casa: `casa:A4_DiEletrons`).
- `"params":"Chave=Valor;…"`: os parâmetros do carimbo da folha. O cabeçalho do arquivo pode levar o mesmo `params` para os parâmetros do projeto.

Texto do carimbo `=Nome` (sem diferenciar maiúsculas) se resolve nesta ordem:
1. a folha;
2. o projeto;
3. o sistema: `SheetNumber`, `SheetTotal`, `CurrentDate`, `DocumentName`, `ProjectName`.

Os nomes da casa valem como apelidos dos do Altium: `Desenhista_DiEletrons`=`DrawnBy`,
`Verificador_DiEletrons`=`CheckedBy`, `Aprovador_DiEletrons`=`ApprovedBy`,
`Revisao`=`Revision`, `Arquivo`=`DocumentNumber`, `Equipamento_linha_um`=`Title`. O
`BuildSchematic.pas` ignora esses campos.

### Regras de conectividade (como o Altium)

- Fio encostado na **ponta quente** de um pino conecta.
- Extremo de um fio pousando **no meio** de outro fio forma um T — conecta.
- **Cruzamento** de dois fios sem `junction` explícita **não conecta**; ponha uma
  `junction` no ponto se quiser uni-los.
- `noerc` é a diretiva **No ERC** do Altium — o X vermelho que marca um pino como solto
  **de propósito**. Ele **não é elétrico**: não liga, não separa e não nomeia nada, e por
  isso fica de fora da extração de nets (somar o ponto dele aos nós faria a prévia
  inventar ligação que a folha real não tem). A âncora é o ponto marcado — ponha-a
  **exatamente na ponta quente do pino**, senão o Altium prende a diretiva ao lado e o
  ERC continua reclamando do mesmo pino.
- `netlabel` nomeia a rede do fio bem debaixo da sua âncora (`x,y`).
- **Nome igual conecta.** Dois `netlabel` com o mesmo `net` são a mesma rede, mesmo sem
  fio nenhum entre eles — é o jeito normal de ligar dois cantos distantes da folha sem
  puxar fio, e é o que o Altium faz. Vale igual para `power` e `port`, e os três se
  misturam: uma `port` `SDA` e um `netlabel` `SDA` são a mesma rede.
- `power` (power port) com o mesmo `net` funde-se numa única rede em **todo o
  projeto**, mesmo em folhas diferentes (é assim que o Altium trata GND/VCC).
- `port` é o conector de folha do Altium: uma barra com bico levando um nome. Para a
  extração de nets ele é um nomeador como os outros. A âncora (`x,y`) é o ponto elétrico:
  é ali que o fio precisa encostar.
  `style` (forma) e `io` (direção, só para o ERC do Altium) viajam como **o inteiro que o
  Altium usa**, não como nome: a tentativa de usar as constantes nomeadas
  (`ePortLeft`, `ePortNone_Vertical`…) foi recusada pelo compilador do Altium com
  *Undeclared identifier*. O inteiro atravessa o espelho sem perda e volta idêntico no
  `BuildSchematic`, inclusive para estilos que os scripts não conhecem. **O significado
  de cada número ainda não foi medido** — enquanto isso o hub desenha toda port com bico
  dos dois lados (`hub-draw.js » ESTILO_POR_NUM`, tabela vazia à espera da medição).
- Um nomeador (`netlabel`, `power` ou `port`) que não encosta em fio nem em pino vira
  aviso ("solto"/"solta") — ele nomeia, mas não está ligado a nada.
- **Escreva sempre um `footprint`** em todo `comp`. Se o símbolo já tem modelo associado
  e presente na lib (`schlib.js » symbols[].footprints[].current` / `incurrentlib`), use
  esse nome; senão escolha um footprint em `pcblib.js` conferindo que os nomes dos pads
  batem com os pinos do símbolo (`schlib` `pins[].num` ↔ `pcblib` `pads[].name`) — é o
  mesmo crosscheck que a vista Libs do hub mostra.

  **Footprint não trava o `BuildSchematic`** (decisão do usuário em 2026-09-23: "o esquema
  precisa voltar pro Altium; se não tiver footprint, mantém sem e eu mesmo resolvo"). Um
  footprint que existe na PcbLib **ou na placa do projeto** (`board.js`) é vinculado; um
  que não existe em nenhum dos dois, ou um `footprint` vazio, **não é vinculado** — o
  componente que já está na folha mantém os modelos que tem, o novo vai só com o que o
  símbolo da biblioteca traz — e sai como `[AVISO]` no relatório e na contagem do diálogo
  final, para ser resolvido no Altium. Não confunda isso com permissão para omitir: o que
  você deixa sem footprint vira trabalho manual de alguém.

  **Símbolo também não trava** (mesma decisão, no mesmo dia). O `sym` passa primeiro pela
  tradução de nomes — o `lib-subs` e o `rename-map` lido ao contrário, porque a biblioteca
  da casa que o Altium lê ainda usa os nomes de antes da padronização. Se nem assim existir
  em biblioteca nenhuma: o componente que **já está na folha** fica com o símbolo que tem;
  o **novo não é colocado** (os fios dele ficam no lugar, soltos). Os dois saem como
  `[AVISO]` e listados no diálogo final. Então um `sym` errado não derruba mais o esquema —
  ele vira um buraco na folha, com o designador na lista para alguém colocar à mão.

### Fluxo de trabalho recomendado

1. Leia `Libs\schlib.js` e `Libs\pcblib.js` antes de escolher qualquer componente.
2. Escreva/edite `Projects\<nome>\schematic.js` (projeto novo: crie a pasta, o arquivo, e
   a entrada em `projects.js`).
3. Peça ao usuário para conferir no `hub.html`, vista **Esquema** — ela valida símbolos,
   footprints, ids e mostra uma prévia das nets.
4. O usuário roda **BuildSchematic** no Altium (com o `.PrjPcb` homônimo focado) — cria
   o(s) `.SchDoc` real(is); qualquer falha de validação vai para `build-report.txt` sem
   criar nada.
5. O usuário faz **Compile** + **Design » Update PCB** (ECO) — só a partir daí as nets
   existem de verdade (extraídas pelo compilador do Altium, não por este script).
6. Daqui em diante é a **Parte B** abaixo (posicionar/rotear a PCB).

---

## Parte B — PCB (`changes.js`)

Fluxo idêntico ao v1: personalizar a PCB depois que o ECO trouxe componentes e nets (ou
de um projeto que já tinha PCB). Único ajuste: os arquivos vivem em
**`D:\MICROCONTROLLER_DEV\AltiumIA\AltiumPCBMirror\Projects\<nome>\`** (não mais ao lado do `.PcbDoc`).

> **Dois escritores:** o usuário também edita `changes.js` (pelo hub — vista PCB — ou manualmente). Releia o arquivo
> antes de cada edição e preserve as linhas dele. E leia os sinalizadores
> (`annotations.js`, Parte C) antes de posicionar/rotear.
> Ao salvar pelo hub, comentários // do arquivo são preservados mas movidos para cima do array — prefira registrar o racional no campo note de cada change.

### Regras absolutas

1. **NUNCA edite `board.js`** — ele é o espelho exportado (verdade da placa). Só leitura.
2. **Edite somente `changes.js`** (e nada mais na pasta do projeto).
3. Em `changes.js`, escreva **um objeto JSON por linha**, dentro do array `var changes = [...]`.
   Objetos **planos** (sem aninhamento), terminados com `,` — o parser do Altium lê linha a linha.
4. Toda edição/remoção **deve carregar os campos `orig_*` copiados EXATAMENTE do `board.js`**
   (mesmos números, sem arredondar). É a trava de segurança: se a placa real não casar com o
   `orig_*` (tolerância 0,001 mm), a mudança é rejeitada.
5. Não invente `id`s: use os que existem em `board.js` (`t1`, `v2`, `a1`...). Adições não levam `id`.
6. Strings não podem conter a sequência `":` (quebra o parser de linha). Use `note` com texto simples.

### Sistema de coordenadas (idêntico ao Altium)

- Unidade: **mm** (use até 6 casas decimais).
- Eixo **X para a direita, Y para CIMA**, relativo à **origem da placa** — os mesmos números
  do PCB List / Properties do Altium.
- Rotação: **graus, anti-horário** (0–360). Componentes no bottom usam o valor bruto do Altium
  (não converta nada).
- Camadas (as chaves que o `board.js` e o `changes.js` usam; a tabela é `HubCore.PCB_LAYERS`,
  na ordem das abas do Altium): cobre `Top`, `Mid1`..`Mid30`, `Bottom` (e `Plane1`..`Plane16`);
  serigrafia `TopOverlay`/`BottomOverlay`; pasta `TopPaste`/`BottomPaste`; máscara
  `TopSolder`/`BottomSolder`; `DrillGuide`, `KeepOut`, `DrillDrawing`; mecânicas
  `Mech1`..`Mech16` (o nome que a placa dá — "Top 3D Body", "Top Courtyard"… — vem em
  `board.js » layers`); e `Multi` (pad passante e via — nunca camada de desenho).
- `board.js » board.bbox` dá os limites da placa. Mantenha tudo dentro do contorno (ou use
  `outline_set` para redefini-lo).

### Formato do `changes.js`

```js
// comentarios com // sao permitidos em linhas proprias
var changes = [
{"op":"comp_move","ref":"R5","x":12.7,"y":8.4,"rot":90,"layer":"Top","orig_x":10.16,"orig_y":8.4,"orig_rot":0,"orig_layer":"Top","note":"afastar do conector"},
{"op":"track_edit","id":"t42","w":0.5,"orig_x1":10.8,"orig_y1":20,"orig_x2":14,"orig_y2":20,"orig_w":0.3,"orig_layer":"Top"},
{"op":"track_add","layer":"Top","x1":16,"y1":22,"x2":19,"y2":22,"w":0.3,"net":"GND"},
{"op":"track_del","id":"t7","orig_x1":9.2,"orig_y1":20,"orig_x2":9.2,"orig_y2":22,"orig_w":0.3,"orig_layer":"Top"},
{"op":"via_edit","id":"v3","x":21,"y":13,"orig_x":20,"orig_y":13.1},
{"op":"via_add","x":16,"y":22,"size":0.6,"drill":0.3,"net":"GND"},
{"op":"via_del","id":"v9","orig_x":36,"orig_y":5},
{"op":"arc_edit","id":"a1","r":2.5,"orig_cx":33,"orig_cy":22,"orig_r":2,"orig_sa":0,"orig_ea":90,"orig_layer":"Top"},
{"op":"arc_add","layer":"Top","cx":33,"cy":22,"r":3,"sa":0,"ea":90,"w":0.3,"net":""},
{"op":"arc_del","id":"a2","orig_cx":5,"orig_cy":5,"orig_r":1,"orig_sa":0,"orig_ea":360,"orig_layer":"Bottom"},
{"op":"text_edit","id":"x7","text":"27","x":116,"y":34.869675,"orig_x":116.245225,"orig_y":34.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"numero do canal 27 centralizado"},
{"op":"designator_move","ref":"F27","x":116,"y":38.47149,"orig_x":115.942435,"orig_y":38.47149,"note":"designator dentro da celula"},
{"op":"outline_set","pts":[[0,0],[80,0],[80,60],[0,60]],"note":"placa 80x60"},
];
```

### Campos por operação

| op | obrigatórios | opcionais |
|---|---|---|
| `comp_move` | `ref`, `orig_x`, `orig_y`, `orig_rot`, `orig_layer` | `x`, `y`, `rot`, `layer` (`Top`/`Bottom`; mudar = flip), `note` |
| `track_edit` | `id`, `orig_x1..orig_y2`, `orig_w`, `orig_layer` | `x1`,`y1`,`x2`,`y2`,`w`,`layer` (qualquer, menos `Multi`),`net`,`note` |
| `track_add` | `layer` (qualquer, menos `Multi`), `x1`,`y1`,`x2`,`y2`,`w` | `net` (só em cobre), `note` |
| `track_del` | `id`, `orig_x1..orig_y2`, `orig_w`, `orig_layer` | `note` |
| `via_edit` | `id`, `orig_x`, `orig_y` | `x`,`y`,`size`,`drill`,`from`,`to` (camadas de cobre do vão: `Top`, `Mid1`..`Mid30`, `Bottom`),`note` |
| `via_add` | `x`,`y`,`size`,`drill` | `net`, `from`, `to`, `note` |
| `via_del` | `id`, `orig_x`, `orig_y` | `note` |
| `arc_edit` | `id`, `orig_cx`,`orig_cy`,`orig_r`,`orig_sa`,`orig_ea`,`orig_layer` | `cx`,`cy`,`r`,`sa`,`ea`,`w`,`layer` (qualquer, menos `Multi`),`note` |
| `arc_add` | `layer` (qualquer, menos `Multi`), `cx`,`cy`,`r`,`sa`,`ea`,`w` | `net` (só em cobre), `note` |
| `arc_del` | `id`, `orig_cx..orig_ea`, `orig_layer` | `note` |
| `text_edit` | `id`, `orig_x`, `orig_y`, `orig_text`, `orig_layer` | `text`, `x`, `y`, `h`, `w`, `rot`, `layer`, `mirror`, `note` |
| `text_add` | `layer`, `text`, `x`, `y` (centro do bbox), `h` | `w` (traço; padrão h/10), `rot`, `mirror`, `note` |
| `text_del` | `id`, `orig_x`, `orig_y`, `orig_text`, `orig_layer` | `note` |
| `fill_add` | `layer`, `x1`,`y1`,`x2`,`y2` (cantos SEM rotação) | `rot` (em torno do centro), `net`, `note` |
| `fill_edit` | `id`, `orig_x1`,`orig_y1`,`orig_x2`,`orig_y2`, `orig_layer` | `x1`,`y1`,`x2`,`y2`,`rot`,`layer`,`net`,`note` |
| `fill_del` | `id`, `orig_x1..orig_y2`, `orig_layer` | `note` |
| `region_add` | `layer`, `pts` (`[[x,y],...]` ≥3, numa linha só) | `net`, `cutout` (true = Board Cutout; a camada é ignorada), `polycut` (true = "sem plano", o Polygon Pour Cutout: o plano não entra, trilha e via passam; `layer` de cobre, ou `Multi` = todas; sem net), `note` |
| `region_del` | `id`, `orig_layer`, `orig_n` (nº de vértices), `orig_x0`, `orig_y0` (1º vértice) | `note` |
| `designator_move` | `ref`, `orig_x`, `orig_y` | `x`, `y`, `h`, `w`, `rot`, `note` |
| `outline_set` | `pts` (`[[x,y],...]` ≥3, polígono **fechado**, só linhas) | `note` |
| `comp_attr` | `ref`, `orig_designator`, `orig_comment` | `designator` (novo texto), `comment` (novo texto), `note` |
| `comp_add` | `ref`, `footprint`, `x`, `y` | `rot`, `layer` (Top/Bottom), `comment`, `nets` (texto plano `"1=GND;2=VCC"`), `des_x`/`des_y` (centro do designator na placa), `des_h`, `des_w`, `des_rot`, `note` |
| `comp_del` | `ref`, `orig_x`, `orig_y`, `orig_rot`, `orig_layer` | `orig_footprint`, `note` |
| `pad_net` | `ref`, `pad` (nome do pad), `net` (`""` = sem net), `orig_net` | `note` |
| `net_add` / `net_del` | `net` | `note` |
| `net_rename` | `net` (novo), `orig_net` | `note` |
| `pad_add` | `type` (smd/th/npth), `x`, `y`, `w`, `h`; furo: `drill` | `shape` (circle/rect/oval/roundrect/octagon), `rot`, `layer` (SMD: Top/Bottom), `name`, `net`, `radius`, `drillshape` (circle/rect/oblong), `drillw`, `holerot`, `note` |
| `pad_edit` | `id` (pad solto `p…`), `orig_x`, `orig_y` | os campos do `pad_add`, menos `type` |
| `pad_del` | `id`, `orig_x`, `orig_y` | `note` |
| `comment_move` | `ref`, `orig_x`, `orig_y` | `x`, `y`, `h`, `rot`, `note` |
| `poly_add` | `layer` (cobre), `pts` | `net`, `pour` (solid/hatch/none), `removeDead`, `minArea`, `ordem`, `clearance`, `nome`, `con_tipo`/`con_condutores`/`con_largura`/`con_gap`/`con_angulo`, `pourOver`, `removeNecks`, `neck`, `arco`, `clearanceBorda`, `note` |
| `poly_edit` / `poly_del` | `id` (`pg…`), `orig_layer`, `orig_n`, `orig_x0`, `orig_y0` | (edit) os do `poly_add` |
| `stack_set` | `layers` (as de cobre na ordem física: `[{"key":"Top","copper":0.035,"dielectric":0.2},{"key":"Mid1","name":"GND","copper":0.035,"dielectric":1.065},…,{"key":"Bottom","copper":0.035}]`) | `mech` (as mecânicas que a placa tem: `["Mech1","Mech13"]`), `note` |

**Objeto e componente criados pelo changes.js (1.49.0).**
- Toda linha `*_add` (track, via, arc, text, fill, region, pad, poly) pode levar `uid` (`"u"` + letras e números; o MCP grava
  sozinho). O objeto aparece na placa com o id `new-<tipo><uid>` (`new-tu1a`), que não muda quando outra linha entra ou
  sai. Linha sem `uid` continua com o contador de antes (`new-t12`), que muda.
- Para mexer num objeto `new-…`, edite ou tire a linha `*_add` dele. Os `orig_*` não valem para ele (não está no
  `board.js`).
- O componente de uma linha `comp_add` (também o que saiu do `board.js` por `comp_del` e voltou por `comp_add` com o
  mesmo nome) se move, renomeia e apaga pela própria linha `comp_add`. O designator dele vai nos `des_*` dessa linha.

**Pilha de camadas e vão da via (2026-10-29).**
- `stack_set` define a pilha do hub: a primeira camada é a `Top`, a última a `Bottom`, no meio `Mid1`..`Mid30`;
  `copper` = espessura do cobre (mm, padrão 0,035 = 1 oz), `dielectric` = o dielétrico ABAIXO da camada (mm; a
  `Bottom` não tem). A espessura da placa é a soma. Vale a última `stack_set` do arquivo; uma só linha, editada no
  lugar. Tirar uma camada que ainda tem objeto (ou via que passa nela) é erro.
- O Gerber sai com uma camada por cobre da pilha. No Altium, o `ApplyChanges` só avisa: ajuste o Layer Stack
  Manager à mão antes das trilhas nas camadas novas.
- `via_add`/`via_edit` com `from`/`to` diferentes de Top–Bottom = via cega/enterrada (o motor avisa).

**Ops da placa nova (2026-10-13).**
- `comp_add` acha o footprint no `Libs/pcblib.js`, depois na biblioteca embutida da placa
  (`board.footprints`), depois num componente da placa com o mesmo footprint. Se não achar
  nenhum, é erro de validação.
- `outline_set` também aceita arco: cada vértice é `[x,y]` ou `[x,y,b]`, com `b` = bulge
  (tan(varredura/4), positivo anti-horário).
- O polígono (`poly_*`) é despejado pelo hub (`hub-pcbpour.js`) na tela, no Gerber e no PDF.
  O cobre despejado pelo Altium fica como veio.
- O padrão da casa é conexão Direct e ilha mínima de 1,6129 mm².
- No Altium, essas ops entram pelo bloco APOSTAS do `ApplyChanges.pas`: confira o
  `apply-report.txt` na primeira rodada.

**Regras e DRC.**
- As regras do projeto ficam em `Projects/<nome>/rules.js`: `var pcbrules = {"format":"pcbrules-v1", …}`,
  uma regra por linha, em mm, com escopo na query do Altium (`InNet('GND')`,
  `InNetClass(…)`, `OnLayer('Top')`, `IsVia`…).
- Sem esse arquivo, valem as que o `board.js` trouxe sobre o padrão da casa (clearance 10 mil).
- O DRC (`hub-pcbdrc.js`, botão DRC da vista PCB, ou a ferramenta `drc_rodar` do MCP)
  confere clearance, curto, largura, via, furo, furo a furo, ponte de máscara, silk,
  contorno e net não roteada.
- Rode o DRC depois de rotear; não entregue placa com violação sem dizer qual e por quê.
- O roteador usa as mesmas regras do DRC (`pcb_rotear` e a Trilha da vista):
  - folga de cada par pela Clearance vencedora (escopo, prioridade e matriz de objetos);
  - contorno pela Board Outline Clearance;
  - camada proibida pela Routing Layers (`motivo: camada-proibida`).
- Largura e via, como o "Rule Preferred" do Altium:
  - sem `w`/`size`, saem da preferida da Width / Routing Via Style da net;
  - valor fora da faixa da regra vira o limite (`largura_ajustada` / `via_ajustada` na resposta).
- `pcb_via` recusa via encostada em cobre de outra net (como a vista); `forcar:true` passa.
- `pcb_rotear` não grava rota que sairia abaixo da folga, e responde `motivo: partida-em-conflito`
  com as `violacoes`. Acontece quando a partida já está perto demais, por exemplo pad de passo fino
  com a largura da regra. Diminua `w` dentro da faixa, ou parta de outro ponto.
- Pad SMD só se liga na camada dele. Rotear em outra camada responde `pad-em-outra-camada`: desça por
  via (trilha até um ponto livre na camada do pad, `pcb_via`, e siga na outra camada).
- Muitas conexões de uma vez: `pcb_autorotear` (o `hub-autoroteador.js`, com as mesmas regras):
  - liga o ratsnest aberto (ou só as `nets` dadas) em várias camadas, trocando de camada por via;
  - roteia na `ordem` pedida, com arranca-e-refaz só das rotas que ele mesmo pôs;
  - padrão `gravar:false`: só simula e mostra as conexões abertas antes/depois e o DRC com as violações NOVAS;
  - `gravar:true` escreve os `track_add`/`via_add` no changes.js; com violação nova de DRC nada é gravado;
  - planos do hub (1.40.0): o cobre despejado é obstáculo pela folga do próprio polígono, e o lote redespeja e
    desfaz a rota que partiria um plano (`motivo: corta-plano`);
  - `cruzarPlanos` deixa a trilha atravessar o plano de OUTRA net (o gate pelo plano de fase), com custo; o plano
    recua em volta dela, nunca na faixa estreita (`faixaPlano`, padrão 2 mm);
  - a via nunca cai em pad SMD (`viaEmPad:true` libera) nem na faixa estreita de um plano.
- Fanout de uma net (GND): `pcb_fanout {net}` põe, em cada pad SMD que ainda não chega ao plano, uma trilha curta e
  uma via dentro do cobre do plano. A via respeita furo a furo e máscara, também contra as outras vias do fanout.
  Simula por padrão; com `gravar:true` grava, desde que não haja violação nova de DRC.
- Suavizar trilhas que já estão na placa a 45° (a escada de um roteador de grade): `pcb_suavizar`. Ponto em que
  outro cobre da mesma net encosta no meio da trilha (ramo, via, pad) fica parado, então nenhum ramo se solta; net
  que piorar no ratsnest ou nas pontas soltas volta inteira. Simula por padrão.
- Posicionar muitos componentes: `pcb_mover_lote {movimentos:[...]}` numa gravação só, em vez de um `pcb_mover` por
  componente. Ele recusa o lote que põe componente em cima de outro (ComponentClearance) ou fora da placa;
  `pcb_posicao_conferir` mostra as colisões a qualquer hora.

**Também vem do Altium (só na tela e nas saídas, sem op própria).**
- Linhas de conexão (ratsnest): o que falta ligar por net.
- Teardrop refeito quando a trilha ou a via anda; teardrop novo é `region_add` (botão Teardrops, `teardrop_aplicar`),
  também na junção em T (trilha que termina no meio de outra da mesma net). Tirar: `teardrop_remover` (ou Teardrops ›
  Tirar teardrops na vista).
- O PDF de layout (`LO -`) com o carimbo DIEletrons, gravado em `Projects/<nome>/PDF/`.

- **Ordem.** O ApplyChanges aplica o arquivo na ordem e confere cada `orig_*` com o objeto
  como ele está DEPOIS das linhas anteriores — o motor do hub faz a mesma conta e acusa erro.
  Então: **uma linha por objeto** (para mexer de novo, edite a linha que já existe), e o
  `designator_move` de um componente vem **antes** do `comp_move` dele, com x/y no lugar de
  antes do componente andar.
- Ids que as ops de edição aceitam: `t…`/`a…` (trilha/arco de cobre), `s…` (linha/arco de
  serigrafia **sem `owner`**) e `l…` (linha/arco de `lines`, as camadas mecânicas, keep-out,
  máscara, pasta e furação, sem `owner`). Objeto com `owner` é do componente: anda com ele.
  `fill_*`, `text_del` e `region_del` também só valem para objeto livre; `region_del` não vale
  para pedaço de polígono despejado de um polígono da placa (`poly:true` com `de` — o hub
  redespeja) nem em espelho antigo. O cobre despejado do Altium cujo polígono não veio no
  espelho (o `altium_sem_poligono` do DRC) só se apaga, com `region_del` (desde a 1.35.0); no
  Altium o `ApplyChanges` recusa essa linha (lá o polígono existe: apague-o no Altium).
- Círculo cheio, triângulo e polígono cheio → `region_add`; retângulo cheio → `fill_add`;
  contorno de qualquer forma → `track_add` em série (círculo: `arc_add` de 0 a 360).
- `comp_attr` — aplicado **por último** pelo ApplyChanges (renomear cedo quebraria os `ref` das ops seguintes); renomear na PCB dessincroniza do esquema — o ECO vai acusar.
- `size` = diâmetro do anel da via; `drill` = diâmetro do furo (`drill < size`).
- `sa`/`ea` = ângulos inicial/final do arco em graus, anti-horário a partir de +X.
- `text_edit` vale só para **textos livres** (`designator:false` e `comment:false` no
  `board.js`); designator/comment pertencem ao componente. `x`/`y` são o **centro do
  bounding box** (mesma convenção do `board.js » texts`): o ApplyChanges aplica
  `text`/`h`/`w`/`rot` primeiro, mede o bounding box novo no Altium e desloca a âncora para o
  centro cair exatamente em `x`/`y` — o texto fica centralizado independente da largura.
  `h` = altura da fonte em mm; `w` = espessura do traço (stroke) em mm.
- `designator_move` reposiciona o **designator de um componente** (item `designator:true`
  em `board.js » texts`; ache-o pelo `owner` = ref). Mesma convenção de centro do
  `text_edit`; os `orig_x`/`orig_y` vêm desse item. O script põe o autoposition do nome em
  Manual antes de mover (senão o Altium re-ancora sozinho). `h` = altura, `w` = espessura do
  traço (1.36.0): reduzir a altura sem reduzir o traço deixa o texto ilegível.
- O designator de um componente **criado por `comp_add`** não está no `board.js`: o lugar, a
  altura, o traço e o giro dele vão na **própria linha do `comp_add`** (`des_x`/`des_y` = centro,
  `des_h`, `des_w`, `des_rot`; 1.36.0). O `designator_move` não serve para ele (o Altium põe o
  nome onde o footprint manda, e o `orig_*` não casaria).
- `net`: use um nome existente em `board.js » nets` (net inexistente gera aviso e objeto sem net).
- `outline_set` **substitui inteiro** o `Board.BoardOutline` pelo polígono de `pts`; só
  aceita segmentos de linha (contorno com arcos: desenhe no Altium). O `ApplyChanges`
  **pede confirmação explícita do usuário** antes de aplicar (é destrutivo).

### O que o `board.js` traz além do básico (ExportBoard 2026-10 e o leitor de `.PcbDoc`)

Tudo opcional: espelho antigo (sem `"exporter"`) não tem estes campos e continua valendo.

| campo | o quê |
|---|---|
| `exporter` | quem gerou ("ExportBoard 2026-10", "pcbdoc2board …"); ausente = espelho antigo |
| `layers[]` | `{key, name, color, stack}`: nome e cor que a placa dá; `stack` = ordem física do cobre |
| `rules` | `{sm, pm, clearance, width, viaSize, viaDrill}` em mm (máscara, pasta, folga, largura, via) |
| `fills[]` | `{id:"f…", layer, x1, y1, x2, y2, rot, net, owner?}` — o QR code e os logos da casa são fills |
| `lines[]` | linhas/arcos (formato do `silk`) das camadas que não são cobre nem serigrafia; ids `l…` |
| `keepout:true` | em trilha/arco/fill/region de cobre que é keepout: **não é cobre** |
| `texts[]` | + `w` (traço), `kind` (stroke/truetype/barcode), `font`, `bold`, `italic`, `inverted`, `ax`/`ay` (âncora) e `polys` (o contorno EXATO do texto, quando veio) |
| `regions[]` | + `holes` (furos), `poly:true` (pedaço de polígono despejado), `owner`, `keepout` |
| `cutouts[]` | + `kindn` (o `Kind()` cru do Altium) |
| pads | + `plated`, `sm`/`pm` (expansão efetiva de máscara/pasta), `tentTop`/`tentBot`, `nopaste`, `bot` (pilha do lado de baixo), `hox`/`hoy` (furo deslocado) |
| vias | + `sm`, `tentTop`, `tentBot` |

Sem o Altium: `python3 tools/pcbdoc/pcbdoc2board.py <arquivo.PcbDoc> <saida.js>` lê o
`.PcbDoc` direto e escreve um `board.js` completo (validado item a item contra o do
ExportBoard). Ele nunca sobrescreve `Projects/*/board.js` sem `--forcar` (e aí faz `.bak`).

### Gerber

A vista PCB gera o Gerber (botão **Gerber**, ou a sub-aba **PCB › Gerber** do hub) a partir da
placa COM as mudanças — o `hub-gerber.js` escreve o mesmo conjunto X2 mm 4:5 do Altium
(cobre, pad master, legenda, máscara, pasta, profile e furação PTH/NPTH em Gerber). A IA não
precisa gerar Gerber; se precisar conferir um, o `hub-gerberview.js` lê X2, RS-274X e
Excellon em Node (`HubGerberView.parse`).

### Boas práticas de layout (o DRC final é do Altium)

- Clearance típico: mantenha **≥ 0,2 mm** entre cobres de nets diferentes (confira as regras
  reais do projeto se o usuário informar).
- Ao mover um componente, ajuste/adicione/remova as trilhas que chegavam nos pads dele —
  os pads estão em `board.js » components[].pads` (posições absolutas ANTES do movimento;
  após `comp_move`, cada pad gira/translada junto com o componente em torno de `x,y`).
- Vias novas: conecte camadas com trilha chegando na mesma coordenada da via.
- Não deixe trilhas órfãs: remova com `track_del` o que ficou sem função.
- Furo de fixação costuma ser **recorte da placa** (*Board Cutout* do Altium) e está em
  `cutouts`: é buraco no contorno, não pad. O maior deles é a região da própria placa (cobre
  o bbox inteiro) e não é furo. Furo NPTH feito como pad está em `freepads`. Nos dois casos,
  não coloque cobre em cima.

### Fluxo de trabalho recomendado

1. Leia `board.js` (cabeçalho, `stats`, `board.bbox`, depois os objetos relevantes).
2. Planeje as mudanças; copie os `orig_*` exatos do `board.js`.
3. Escreva `changes.js` (uma linha por mudança, com `note` explicando cada uma).
4. Peça ao usuário para conferir no `hub.html` (vista **PCB**) — ele valida `orig_*`,
   mostra o diff e a tabela PCB List pós-mudanças.
5. O usuário roda `ApplyChanges` no Altium e depois o DRC. O relatório fica em
   `Projects\<nome>\apply-report.txt`; se algo falhar, corrija e repita.

---

## Parte C — Sinalizadores (`annotations.js`)

O usuário marca problemas direto no hub, **na vista PCB**, com bandeirinhas coloridas;
elas ficam em `Projects\<nome>\annotations.js` (um objeto JSON por linha):

> A vista **Esquema** deixou de sinalizar em 2026-09-14, numa limpeza de interface pedida
> pelo usuário. O formato não mudou e o `view:"sch"` continua válido — sinalizador de
> esquema que já esteja no arquivo permanece lá e continua sendo contrato seu (ver o
> Contrato abaixo). O que não existe mais é o hub CRIAR um novo pela vista Esquema.

```js
var annotations = [
{"id":"n1","view":"pcb","x":12.5,"y":8.3,"layer":"Top","severity":"err","msg":"trilha muito proxima","ref":"","status":"open","created":"2026-08-04 10:00","reply":""},
{"id":"n2","view":"sch","sheet":"main","x":2400,"y":3400,"severity":"warn","msg":"conferir pull-up","ref":"R3","status":"resolved","created":"2026-08-04 10:05","reply":"trocado para 10k"},
];
```

| Campo | Significado |
|---|---|
| `id` | estável (`n1`, `n2`…) — nunca reutilize nem renumere |
| `view` | `pcb` (x/y em **mm**, `layer`) ou `sch` (x/y em **mil**, `sheet`) |
| `severity` | `err` (vermelho) / `warn` (amarelo) / `info` (azul) |
| `msg` | texto do usuário descrevendo o problema |
| `ref` | opcional: componente âncora |
| `status` | `open` → `resolved` |
| `created` | data/hora da criação (`YYYY-MM-DD HH:MM`, preenchido pelo hub) |
| `reply` | sua resposta ao resolver |

### Contrato (OBRIGATÓRIO para a sessão de IA)

1. **Antes de qualquer trabalho de PCB/esquema num projeto, leia
   `Projects\<nome>\annotations.js`** (se existir). Sinalizadores `open` são
   pendências do usuário para você.
2. Para cada um: corrija via `changes.js` (cada change com `note` referenciando o id,
   ex.: `"note":"n1: trilha afastada 0.4mm"`), depois mude `status` para `"resolved"`
   e escreva em `reply` o que foi feito.
3. **Nunca apague nem reescreva** sinalizadores do usuário — só altere `status`/`reply`.
   Quem apaga/reabre é o usuário, pelo hub.
4. **Dois escritores**: `changes.js`, `schematic.js` e `annotations.js` são editados
   por você **e** pelo usuário (sinalizadores, changes.js e schematic.js pelo hub). Sempre **releia o arquivo antes de editar**
   e preserve as linhas existentes — nunca regenere do zero sem pedido explícito.
