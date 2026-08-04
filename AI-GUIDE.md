# AI-GUIDE — Como trabalhar neste workspace (contrato para a sessão de IA)

Você está com um Claude Code aberto no **workspace central do AltiumPCBMirror**
(normalmente `Z:\AltiumPCBMirror` — confirme com o usuário se for outro caminho). Ele
concentra as bibliotecas espelhadas (`Libs\`), o histórico de projetos
(`Projects\<nome>\`) e o `hub.html`; não é mais uma pasta que existe só ao lado de um
`.PcbDoc`. Depois que você edita os arquivos aqui, um script dentro do Altium aplica suas
mudanças no projeto real.

Duas frentes de trabalho, normalmente nesta ordem para um projeto novo:

- **Parte A — Esquema** (`schematic.js`): montar um projeto do zero (ou entender um
  esquema existente, só leitura) escolhendo componentes das bibliotecas reais do usuário.
- **Parte B — PCB** (`changes.js`): depois que o esquema virou `.SchDoc` real e passou
  pelo ECO do Altium (ou para um projeto que já tinha PCB), posicionar/rotear a placa —
  fluxo idêntico ao v1, só que os arquivos agora vivem em `Projects\<nome>\`.

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
  {"name":"<nome>","files":{"schematic":true,"board":false,"changes":false,"buildreport":false,"applyreport":false},"indexed":"<data/hora ou nota>"}
  ```

  `files.schematic:true` e todos os outros `false` até os scripts do Altium gerarem
  `board.js`/`changes.js`/os relatórios (eles regeneram `projects.js` sozinhos depois).

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
{"t":"junction","sheet":"main","x":1800,"y":3100},
{"t":"text","sheet":"main","s":"Fonte 5V","x":3800,"y":4000,"h":10}
]};
```

Um item JSON **plano** por linha (o parser DelphiScript lê linha a linha, como no
`changes.js`); `pts` é a única exceção de aninhamento, sempre numa linha só.

### Campos por item (`t`)

| `t` | obrigatórios | opcionais |
|---|---|---|
| `sheet` | `name`, `size` (A4/A3/A2/A1/A/B/C) | — |
| `comp` | `sheet`,`ref`,`sym`,`x`,`y`,`rot`,`footprint` | `part` (default 1), `mirror`, `comment` |
| `wire` | `sheet`,`pts` (`[[x,y],...]` ≥2, numa linha só) | — |
| `netlabel` | `sheet`,`net`,`x`,`y` | `rot` |
| `power` | `sheet`,`net`,`style`,`x`,`y` | `rot` (`Bar`/`Circle`/`Arrow`/`Wave`/`GndPower`/`GndSignal`/`GndEarth`) |
| `junction` | `sheet`,`x`,`y` | — |
| `text` | `sheet`,`s`,`x`,`y` | `h` (só informativo — veja Limitações no README) |

`sym` referencia o nome do símbolo em `schlib.js`.

### Regras de conectividade (como o Altium)

- Fio encostado na **ponta quente** de um pino conecta.
- Extremo de um fio pousando **no meio** de outro fio forma um T — conecta.
- **Cruzamento** de dois fios sem `junction` explícita **não conecta**; ponha uma
  `junction` no ponto se quiser uni-los.
- `netlabel` nomeia a rede do fio bem debaixo da sua âncora (`x,y`).
- `power` (power port) com o mesmo `net` funde-se numa única rede em **todo o
  projeto**, mesmo em folhas diferentes (é assim que o Altium trata GND/VCC).
- `footprint` é **OBRIGATÓRIO** em todo `comp` — o `BuildSchematic` rejeita (erro em
  `build-report.txt`, nada é criado) um componente sem footprint. Se o símbolo já tem
  modelo associado e presente na lib (`schlib.js » symbols[].footprints[].current` /
  `incurrentlib`), use esse nome; senão escolha um footprint em `pcblib.js` conferindo
  que os nomes dos pads batem com os pinos do símbolo (`schlib` `pins[].num` ↔ `pcblib`
  `pads[].name`) — é o mesmo crosscheck que a vista Libs do hub mostra.

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
**`Z:\AltiumPCBMirror\Projects\<nome>\`** (não mais ao lado do `.PcbDoc`).

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
- Camadas de cobre: `Top` e `Bottom`. Silk: `TopOverlay`/`BottomOverlay`. Pads TH: `Multi`.
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
| `comp_move` | `ref`, `orig_x`, `orig_y`, `orig_rot`, `orig_layer` | `x`, `y`, `rot`, `layer` (mudar layer = flip), `note` |
| `track_edit` | `id`, `orig_x1..orig_y2`, `orig_w`, `orig_layer` | `x1`,`y1`,`x2`,`y2`,`w`,`layer`,`net`,`note` |
| `track_add` | `layer` (Top/Bottom), `x1`,`y1`,`x2`,`y2`,`w` | `net`, `note` |
| `track_del` | `id`, `orig_x1..orig_y2`, `orig_w`, `orig_layer` | `note` |
| `via_edit` | `id`, `orig_x`, `orig_y` | `x`,`y`,`size`,`drill`,`note` |
| `via_add` | `x`,`y`,`size`,`drill` | `net`, `from`, `to`, `note` |
| `via_del` | `id`, `orig_x`, `orig_y` | `note` |
| `arc_edit` | `id`, `orig_cx`,`orig_cy`,`orig_r`,`orig_sa`,`orig_ea`,`orig_layer` | `cx`,`cy`,`r`,`sa`,`ea`,`w`,`layer`,`note` |
| `arc_add` | `layer`, `cx`,`cy`,`r`,`sa`,`ea`,`w` | `net`, `note` |
| `arc_del` | `id`, `orig_cx..orig_ea`, `orig_layer` | `note` |
| `text_edit` | `id`, `orig_x`, `orig_y`, `orig_text`, `orig_layer` | `text`, `x`, `y`, `h`, `rot`, `note` |
| `designator_move` | `ref`, `orig_x`, `orig_y` | `x`, `y`, `h`, `rot`, `note` |
| `outline_set` | `pts` (`[[x,y],...]` ≥3, polígono **fechado**, só linhas) | `note` |

- `size` = diâmetro do anel da via; `drill` = diâmetro do furo (`drill < size`).
- `sa`/`ea` = ângulos inicial/final do arco em graus, anti-horário a partir de +X.
- `text_edit` vale só para **textos livres** (`designator:false` e `comment:false` no
  `board.js`); designator/comment pertencem ao componente. `x`/`y` são o **centro do
  bounding box** (mesma convenção do `board.js » texts`): o ApplyChanges aplica
  `text`/`h`/`rot` primeiro, mede o bounding box novo no Altium e desloca a âncora para o
  centro cair exatamente em `x`/`y` — o texto fica centralizado independente da largura.
- `designator_move` reposiciona o **designator de um componente** (item `designator:true`
  em `board.js » texts`; ache-o pelo `owner` = ref). Mesma convenção de centro do
  `text_edit`; os `orig_x`/`orig_y` vêm desse item. O script põe o autoposition do nome em
  Manual antes de mover (senão o Altium re-ancora sozinho).
- `net`: use um nome existente em `board.js » nets` (net inexistente gera aviso e objeto sem net).
- `outline_set` **substitui inteiro** o `Board.BoardOutline` pelo polígono de `pts`; só
  aceita segmentos de linha (contorno com arcos: desenhe no Altium). O `ApplyChanges`
  **pede confirmação explícita do usuário** antes de aplicar (é destrutivo).

### Boas práticas de layout (o DRC final é do Altium)

- Clearance típico: mantenha **≥ 0,2 mm** entre cobres de nets diferentes (confira as regras
  reais do projeto se o usuário informar).
- Ao mover um componente, ajuste/adicione/remova as trilhas que chegavam nos pads dele —
  os pads estão em `board.js » components[].pads` (posições absolutas ANTES do movimento;
  após `comp_move`, cada pad gira/translada junto com o componente em torno de `x,y`).
- Vias novas: conecte camadas com trilha chegando na mesma coordenada da via.
- Não deixe trilhas órfãs: remova com `track_del` o que ficou sem função.
- Furos de fixação e NPTH estão em `freepads` — não coloque cobre em cima.

### Fluxo de trabalho recomendado

1. Leia `board.js` (cabeçalho, `stats`, `board.bbox`, depois os objetos relevantes).
2. Planeje as mudanças; copie os `orig_*` exatos do `board.js`.
3. Escreva `changes.js` (uma linha por mudança, com `note` explicando cada uma).
4. Peça ao usuário para conferir no `hub.html` (vista **PCB**) — ele valida `orig_*`,
   mostra o diff e a tabela PCB List pós-mudanças.
5. O usuário roda `ApplyChanges` no Altium e depois o DRC. O relatório fica em
   `Projects\<nome>\apply-report.txt`; se algo falhar, corrija e repita.
