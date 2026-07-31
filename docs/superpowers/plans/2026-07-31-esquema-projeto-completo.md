# AltiumPCBMirror v2 — Plano de Implementação (esquema, libs, projeto do zero)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expandir o AltiumPCBMirror para espelhar as bibliotecas do usuário, criar esquemas do zero via `schematic.js`, transferi-los ao Altium como `.SchDoc` reais, e navegar tudo (projetos, esquema, PCB, libs) num hub HTML com histórico local.

**Architecture:** Workspace central em `Z:\AltiumPCBMirror` (`Libs\` + `Projects\<nome>\` + `projects.js`). Lado Altium: 3 scripts DelphiScript novos (ExportLibs, ExportProject, BuildSchematic) + 2 evoluídos (ExportBoard, ApplyChanges), todos autocontidos (unidades DelphiScript NÃO compartilham código — o v1 já duplica helpers entre ExportBoard/ApplyChanges, siga esse padrão). Lado HTML: `hub.html` (shell com vistas Projetos e Libs) + `schframe.html` (vista Esquema, iframe) + `pcbframe.html` (viewer v1 + loader por query-param, iframe) + `hub-core.js` (lógica pura testável em node) + `hub-draw.js` (renderers canvas compartilhados).

**Tech Stack:** DelphiScript (API de scripting do Altium — apenas idiomas comprovados no v1), HTML/Canvas/JS vanilla (funciona via `file://`, sem internet), node (apenas para testes: `node --check` + scripts com `assert`).

**Spec:** `docs/superpowers/specs/2026-07-31-esquema-projeto-completo-design.md` (aprovado; Task 0 registra 2 refinamentos).

---

## Contexto essencial (leia antes de qualquer task)

### O que já existe (v1) e será reusado

- [ExportBoard.pas](../../../ExportBoard.pas) (789 linhas): helpers JSON `JF/JB/JS` (linhas 35-82), conversões `CX/CY/CW` (84-100), `LayerNameOf` (102-120), serializadores de primitivas, rotina `ExportBoard` (524-789). Grava hoje em `<pasta do PcbDoc>\PCBMirror\`.
- [ApplyChanges.pas](../../../ApplyChanges.pas) (863 linhas): parser JSON plano por linha `StrToFloatDot/JGet/JHas/JNum` (32-161), conversões `MMX/MMY/XMM/YMM/NearMM/NearAngle` (167-204), `LayerFromName/LayerNameOf` (206-243), localizadores `FindComponent/FindNet/FindTrack/FindVia/FindArc` (249-370), operações `Do*` (392-767), rotina principal (773-862).
- [viewer.html](../../../viewer.html) (1000 linhas): visualizador PCB fiel completo. Carrega `board.js`/`changes.js` por `<script src>` (linhas 154-155). Vira a base do `pcbframe.html` (Task 9).
- [example\](../../../example/): demo v1 do viewer — **não mexer** (continua funcionando como está).

### Contratos de coordenadas (NUNCA transformar dados)

- **PCB** (`board.js`, `changes.js`, `pcblib.js`): mm, Y para cima, 6 casas; origem da placa (board) ou origem do footprint (pcblib). Rotação graus anti-horário.
- **Esquema** (`schlib.js`, `schematic.js`): **mil** (1/1000"), Y para cima, origem no canto inferior esquerdo da folha (esquema) ou origem do símbolo (schlib). Rotação apenas 0/90/180/270 + flag `mirror` (espelha X antes de rotacionar). Pinos/fios em inteiros na grade de 100 mil.
- Pino (schlib): `x,y` = ponta do CORPO (onde encosta no símbolo); ponta QUENTE (conexão) = `(x,y) + len·dir(orient)` com `dir(0)=+X, dir(90)=+Y, dir(180)=-X, dir(270)=-Y`.
- Transform de componente no esquema (preview): ponto local → `mirror ? (-x,y) : (x,y)` → rotaciona `rot` anti-horário → soma posição. Ângulo: `a' = (mirror ? 180-a : a) + rot (mod 360)`. O `BuildSchematic` usa `Orientation`/`IsMirrored` nativos do Altium, então a verdade é sempre o Altium; o preview segue esta convenção.

### Formatos novos (todos `var X = ...` com JSON puro após o `=`, para funcionar via `file://`)

- `projects.js` → `var projects = [ {"name":..., "files":{...}, "indexed":...}, ... ];`
- `Libs\schlib.js` → `var schlib = {...};`
- `Libs\pcblib.js` → `var pcblib = {...};`
- `Projects\<nome>\schematic.js` → `var schematic = {..., "items":[ um objeto JSON PLANO por linha ]};` (mesma filosofia do `changes.js`: o parser DelphiScript lê linha a linha; única exceção de aninhamento é `"pts":[[x,y],...]` numa linha só, com parser dedicado).
- Projetos com nome iniciando `_` são demos (o hub mostra badge "DEMO").

### Regras DelphiScript (valem para TODAS as tasks .pas)

- Cada `.pas` é autocontido: copie os helpers de que precisar (JS/JB/JF, JGet/JNum/JHas/StrToFloatDot, LayerNameOf...) — NÃO tente "importar" de outra unidade.
- Sem `try/except`, sem tipos declarados em records; propriedades-record exigem variável temporária (`Seg := BO.Segments[i]; Seg.vx := ...; BO.Segments[i] := Seg;`).
- Sem `StrToIntDef` — use o helper `SafeStrToInt` (definido na Task 12).
- Diálogos: `ShowMessage`, `InputBox`, `ConfirmNoYes` (booleano).
- Tudo que altera documento roda entre `PreProcess`/`PostProcess` (undo único).
- API Sch usada (idiomas de galeria pública do Altium, mesma família do v1): `SchServer.GetSchDocumentByPath/LoadSchDocumentByPath`, `SchLibIterator_Create`, `SchIterator_Create` + `AddFilter_ObjectSet(MkSet(...))`, `SchServer.SchObjectFactory(eWire|eNetLabel|ePowerObject|eJunction|eLabel, eCreate_GlobalCopy)`, `Wire.InsertVertex := N; Wire.SetState_Vertex(N, Point(...))`, `Doc.RegisterSchObjectInContainer(Obj)`, `SchServer.RobotManager.SendMessage(..., SCHM_PrimitiveRegistration, ...)`, `LibComp.Replicate`, `Comp.AddSchImplementation`, `SchServer.ProcessControl.PreProcess/PostProcess`, `CreateNewDocumentFromDocumentKind('SCH')`, `IServerDocument.DoSafeChangeFileNameAndSave(path,'SCH')`, `GetWorkspace.DM_FocusedProject`, `Project.DM_AddSourceDocument`.
- `MilsToCoord/CoordToMils` existem nos dois servers; no Sch as coordenadas internas também são TCoord.

### Estrutura final de arquivos

```
Z:\AltiumPCBMirror\
├── AltiumPCBMirror.PrjScr      +3 documentos (Tasks 10/11/14)
├── ExportLibs.pas              NOVO (Task 10)
├── ExportProject.pas           NOVO (Task 11)
├── BuildSchematic.pas          NOVO (Task 14)
├── ExportBoard.pas             evoluído (Task 12)
├── ApplyChanges.pas            evoluído (Task 13)
├── hub.html                    NOVO shell: Projetos + Libs (Task 7)
├── schframe.html               NOVO vista Esquema (Task 8)
├── pcbframe.html               NOVO vista PCB = viewer + loader (Task 9)
├── hub-core.js                 NOVO lógica pura (Tasks 3-5)
├── hub-draw.js                 NOVO renderers canvas (Task 6)
├── viewer.html                 mantido (usado pelo example\ e como fonte do pcbframe)
├── projects.js                 índice (fixture Task 2; regenerado pelos .pas)
├── Libs\schlib.js              fixture Task 1; real via ExportLibs
├── Libs\pcblib.js              fixture Task 1; real via ExportLibs
├── Projects\_DemoKit\          fixture Task 2 (schematic.js, board.js, changes.js)
├── tests\load.js               Task 3
├── tests\test-apply.js         Task 3
├── tests\test-netextract.js    Task 4
├── tests\test-validate.js      Task 5
├── README.md / AI-GUIDE.md     reescritos (Task 15)
└── example\                    intocado (demo v1)
```

Comandos de verificação rodam do diretório `Z:\AltiumPCBMirror` (PowerShell). `node` precisa estar no PATH.

---

### Task 0: Registrar 2 refinamentos no spec

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-esquema-projeto-completo-design.md`

Dois ajustes descobertos ao planejar com o código v1 aberto (nenhum muda o que foi aprovado em essência):

1. **`schematic.js` orientado a linha** (seção 5.3): o parser DelphiScript do v1 lê um objeto JSON plano por linha (comprovado no `changes.js`). O schema aninhado `sheets:[{components:[...]}]` é impraticável nesse parser. Novo shape (mesma informação): `var schematic = {"format":"schmirror-v2","project":...,"units":"mil","items":[` + um item plano por linha com discriminador `"t"` (`sheet|comp|wire|netlabel|power|junction|text`), campo `sheet` ligando item→folha; `pts` de wire é a única exceção de aninhamento (uma linha, parser dedicado).
2. **`outline_set` só com linhas** (seção 5.4): v2 aceita `pts` (polígono fechado de vértices); arcos de contorno ficam para o Altium/v3.

- [ ] **Step 1: Editar a seção 5.3** — substituir o bloco de código exemplo por:

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

e acrescentar a frase: "Um item JSON plano por linha (parser DelphiScript lê linha a linha, como no changes.js); `pts` é a única exceção de aninhamento, sempre numa linha só."

- [ ] **Step 2: Editar a seção 5.4** — trocar "Polígono (segmentos linha/arco)" por "Polígono fechado de vértices (`pts`, apenas linhas no v2; contorno com arcos: desenhe no Altium)". Exemplo: `{"op":"outline_set","pts":[[0,0],[80,0],[80,60],[0,60]],"note":"placa 80x60"}`.

- [ ] **Step 3: Commit**

```powershell
git add docs/superpowers/specs/2026-07-31-esquema-projeto-completo-design.md
git commit -m @'
Spec v2: schematic.js orientado a linha; outline_set so com linhas

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 1: Fixtures das bibliotecas (`Libs\schlib.js` + `Libs\pcblib.js`)

Miniaturas sintéticas no MESMO formato que o `ExportLibs.pas` gerará (Task 10 segue este gabarito). Servem de demo out-of-the-box do hub e de fixture dos testes. 4 símbolos / 4 footprints; `LED` propositalmente SEM footprint associado (exercita o aviso "sem link"); pads do `LED0805` chamados `A`/`K` (exercita o crosscheck pino↔pad).

**Files:**
- Create: `Libs\schlib.js`
- Create: `Libs\pcblib.js`

- [ ] **Step 1: Criar `Libs\schlib.js`** com exatamente:

```js
var schlib = {
"format":"schlib-v2",
"generated":"exemplo sintetico - sera substituido pelo ExportLibs",
"source":"BIBLIOTECA DE ESQUEMA.SchLib",
"units":"mil",
"symbols":[
{"name":"RES","description":"Resistor","partcount":1,"parts":[
 {"part":1,
  "pins":[
   {"num":"1","name":"1","x":-100,"y":0,"len":100,"orient":180,"type":"Passive"},
   {"num":"2","name":"2","x":100,"y":0,"len":100,"orient":0,"type":"Passive"}],
  "graphics":[
   {"g":"rect","x1":-100,"y1":-40,"x2":100,"y2":40,"solid":true}]}],
 "footprints":[{"name":"R0805","incurrentlib":true,"current":true}]},
{"name":"CAP","description":"Capacitor ceramico","partcount":1,"parts":[
 {"part":1,
  "pins":[
   {"num":"1","name":"1","x":-10,"y":0,"len":90,"orient":180,"type":"Passive"},
   {"num":"2","name":"2","x":10,"y":0,"len":90,"orient":0,"type":"Passive"}],
  "graphics":[
   {"g":"line","x1":-10,"y1":-60,"x2":-10,"y2":60,"w":10},
   {"g":"line","x1":10,"y1":-60,"x2":10,"y2":60,"w":10}]}],
 "footprints":[{"name":"C0805","incurrentlib":true,"current":true}]},
{"name":"LED","description":"Diodo emissor de luz","partcount":1,"parts":[
 {"part":1,
  "pins":[
   {"num":"A","name":"A","x":-50,"y":0,"len":150,"orient":180,"type":"Passive"},
   {"num":"K","name":"K","x":50,"y":0,"len":150,"orient":0,"type":"Passive"}],
  "graphics":[
   {"g":"poly","pts":[[-50,-50],[-50,50],[50,0]],"solid":true},
   {"g":"line","x1":50,"y1":-50,"x2":50,"y2":50,"w":10},
   {"g":"line","x1":10,"y1":70,"x2":40,"y2":100,"w":6},
   {"g":"line","x1":40,"y1":60,"x2":70,"y2":90,"w":6}]}],
 "footprints":[]},
{"name":"CONN2","description":"Conector 2 vias","partcount":1,"parts":[
 {"part":1,
  "pins":[
   {"num":"1","name":"1","x":-100,"y":100,"len":100,"orient":180,"type":"Passive"},
   {"num":"2","name":"2","x":-100,"y":0,"len":100,"orient":180,"type":"Passive"}],
  "graphics":[
   {"g":"rect","x1":-100,"y1":-50,"x2":100,"y2":150,"solid":false},
   {"g":"label","x":0,"y":100,"text":"1","rot":0,"size":8},
   {"g":"label","x":0,"y":0,"text":"2","rot":0,"size":8}]}],
 "footprints":[{"name":"HDR2X1","incurrentlib":true,"current":true}]}
],
"stats":{"symbols":4,"nofootprint":1}
};
```

- [ ] **Step 2: Criar `Libs\pcblib.js`** com exatamente:

```js
var pcblib = {
"format":"pcblib-v2",
"generated":"exemplo sintetico - sera substituido pelo ExportLibs",
"source":"BIBLIOTECA DE FOOTPRINT.PcbLib",
"units":"mm",
"footprints":[
{"name":"R0805","description":"Resistor chip 0805","bbox":{"x1":-1.5,"y1":-0.8,"x2":1.5,"y2":0.8},
 "pads":[
  {"name":"1","type":"smd","shape":"rect","x":-0.95,"y":0,"w":0.9,"h":1.3,"rot":0,"layer":"Top"},
  {"name":"2","type":"smd","shape":"rect","x":0.95,"y":0,"w":0.9,"h":1.3,"rot":0,"layer":"Top"}],
 "silk":[
  {"kind":"line","x1":-0.35,"y1":0.85,"x2":0.35,"y2":0.85,"w":0.15},
  {"kind":"line","x1":-0.35,"y1":-0.85,"x2":0.35,"y2":-0.85,"w":0.15}]},
{"name":"C0805","description":"Capacitor chip 0805","bbox":{"x1":-1.5,"y1":-0.8,"x2":1.5,"y2":0.8},
 "pads":[
  {"name":"1","type":"smd","shape":"rect","x":-0.95,"y":0,"w":0.9,"h":1.3,"rot":0,"layer":"Top"},
  {"name":"2","type":"smd","shape":"rect","x":0.95,"y":0,"w":0.9,"h":1.3,"rot":0,"layer":"Top"}],
 "silk":[
  {"kind":"line","x1":-0.35,"y1":0.85,"x2":0.35,"y2":0.85,"w":0.15},
  {"kind":"line","x1":-0.35,"y1":-0.85,"x2":0.35,"y2":-0.85,"w":0.15}]},
{"name":"LED0805","description":"LED chip 0805","bbox":{"x1":-1.6,"y1":-0.8,"x2":1.6,"y2":0.8},
 "pads":[
  {"name":"A","type":"smd","shape":"rect","x":-0.95,"y":0,"w":0.9,"h":1.3,"rot":0,"layer":"Top"},
  {"name":"K","type":"smd","shape":"rect","x":0.95,"y":0,"w":0.9,"h":1.3,"rot":0,"layer":"Top"}],
 "silk":[
  {"kind":"line","x1":1.55,"y1":-0.8,"x2":1.55,"y2":0.8,"w":0.15}]},
{"name":"HDR2X1","description":"Header 2x1 2.54mm","bbox":{"x1":-1.4,"y1":-2.67,"x2":1.4,"y2":2.67},
 "pads":[
  {"name":"1","type":"th","shape":"rect","x":0,"y":1.27,"w":1.7,"h":1.7,"rot":0,"layer":"Multi","drillshape":"circle","drill":1.0,"holerot":0},
  {"name":"2","type":"th","shape":"circle","x":0,"y":-1.27,"w":1.7,"h":1.7,"rot":0,"layer":"Multi","drillshape":"circle","drill":1.0,"holerot":0}],
 "silk":[
  {"kind":"line","x1":-1.35,"y1":-2.6,"x2":-1.35,"y2":2.6,"w":0.15},
  {"kind":"line","x1":-1.35,"y1":2.6,"x2":1.35,"y2":2.6,"w":0.15},
  {"kind":"line","x1":1.35,"y1":2.6,"x2":1.35,"y2":-2.6,"w":0.15},
  {"kind":"line","x1":1.35,"y1":-2.6,"x2":-1.35,"y2":-2.6,"w":0.15}]}
],
"stats":{"footprints":4}
};
```

- [ ] **Step 3: Validar sintaxe**

```powershell
node --check Libs/schlib.js; node --check Libs/pcblib.js
```

Esperado: nenhuma saída (exit 0) nos dois.

- [ ] **Step 4: Commit**

```powershell
git add Libs/schlib.js Libs/pcblib.js
git commit -m @'
Fixtures sinteticas das bibliotecas (schlib.js/pcblib.js v2)

Gabarito do formato que o ExportLibs.pas gera; demo do hub e fixture dos testes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 2: Fixture do projeto demo (`Projects\_DemoKit\`) + `projects.js`

Circuito LED completo: CONN2 (P1, espelhado — exercita mirror), RES (R1), LED (D1), CAP (C1). Nets esperadas: `VCC` = P1-1,R1-1,C1-2 · `NET_LED` = R1-2,D1-A · `GND` = C1-1,D1-K,P1-2 (**três ilhas de fio separadas unidas por power ports GND** — exercita a fusão global por nome). Estes valores são o gabarito do teste da Task 4 — NÃO altere as coordenadas sem recalcular o gabarito.

Geometria conferida (hot = ponta quente):
- P1 `CONN2` em (1200,3000) `mirror:true`: hot local pino1 (-200,100)→mirror(200,100)→mundo (1400,3100); pino2 → (1400,3000).
- R1 `RES` em (2400,3400): hots (2200,3400) e (2600,3400).
- C1 `CAP` em (1800,2800) `rot:90`: hot local pino1 (-100,0)→rot90→(0,-100)→mundo (1800,2700); pino2 → (1800,2900).
- D1 `LED` em (3200,3400): hots A=(3000,3400), K=(3400,3400).

**Files:**
- Create: `Projects\_DemoKit\schematic.js`
- Create: `Projects\_DemoKit\board.js`
- Create: `Projects\_DemoKit\changes.js`
- Create: `projects.js`

- [ ] **Step 1: Criar `Projects\_DemoKit\schematic.js`** com exatamente:

```js
var schematic = {
"format":"schmirror-v2",
"project":"_DemoKit",
"generated":"exemplo sintetico",
"units":"mil",
"items":[
{"t":"sheet","name":"main","size":"A4"},
{"t":"comp","sheet":"main","ref":"P1","sym":"CONN2","part":1,"x":1200,"y":3000,"rot":0,"mirror":true,"footprint":"HDR2X1","comment":"ALIM 5V"},
{"t":"comp","sheet":"main","ref":"R1","sym":"RES","part":1,"x":2400,"y":3400,"rot":0,"mirror":false,"footprint":"R0805","comment":"330R"},
{"t":"comp","sheet":"main","ref":"C1","sym":"CAP","part":1,"x":1800,"y":2800,"rot":90,"mirror":false,"footprint":"C0805","comment":"100n"},
{"t":"comp","sheet":"main","ref":"D1","sym":"LED","part":1,"x":3200,"y":3400,"rot":0,"mirror":false,"footprint":"LED0805","comment":"LED VERMELHO"},
{"t":"wire","sheet":"main","pts":[[1400,3100],[1800,3100],[1800,3400],[2200,3400]]},
{"t":"wire","sheet":"main","pts":[[1800,2900],[1800,3100]]},
{"t":"wire","sheet":"main","pts":[[2600,3400],[3000,3400]]},
{"t":"wire","sheet":"main","pts":[[3400,3400],[3600,3400],[3600,3000]]},
{"t":"wire","sheet":"main","pts":[[1400,3000],[1600,3000]]},
{"t":"netlabel","sheet":"main","net":"VCC","x":1800,"y":3400,"rot":0},
{"t":"netlabel","sheet":"main","net":"NET_LED","x":2800,"y":3400,"rot":0},
{"t":"power","sheet":"main","net":"GND","style":"GndPower","x":1800,"y":2700,"rot":270},
{"t":"power","sheet":"main","net":"GND","style":"GndPower","x":3600,"y":3000,"rot":270},
{"t":"power","sheet":"main","net":"GND","style":"GndPower","x":1600,"y":3000,"rot":270},
{"t":"junction","sheet":"main","x":1800,"y":3100},
{"t":"text","sheet":"main","s":"DEMO KIT - LED + RC","x":2200,"y":3800,"h":12}
]};
```

Nota: `netlabel NET_LED` em (2800,3400) está no MEIO do fio (2600,3400)-(3000,3400) — exercita "âncora sobre segmento". O fio de C1 termina em (1800,3100), vértice do fio VCC — exercita conexão em T.

- [ ] **Step 2: Criar `Projects\_DemoKit\board.js`** (estado "pós-ECO, parcialmente roteado") com exatamente:

```js
var pcbmirror = {
"format":"pcbmirror-v1",
"generated":"exemplo sintetico",
"source":"_DemoKit.PcbDoc",
"units":"mm",
"axis":"y-up",
"origin_note":"coordenadas em mm relativas a origem da placa (Board.XOrigin/YOrigin), Y para cima - identicas ao PCB List / Properties do Altium",
"board":{"bbox":{"x1":0,"y1":0,"x2":30,"y2":20},
"outline":[
{"kind":"line","x1":0,"y1":0,"x2":30,"y2":0},
{"kind":"line","x1":30,"y1":0,"x2":30,"y2":20},
{"kind":"line","x1":30,"y1":20,"x2":0,"y2":20},
{"kind":"line","x1":0,"y1":20,"x2":0,"y2":0}
]},
"nets":["","GND","NET_LED","VCC"],
"components":[
{"id":"c1","ref":"P1","footprint":"HDR2X1","comment":"ALIM 5V","layer":"Top","x":3,"y":10,"rot":0,"bbox":{"x1":1.6,"y1":7.33,"x2":4.4,"y2":12.67},"pads":[
{"id":"c1p1","name":"1","layer":"Multi","type":"th","shape":"rect","x":3,"y":11.27,"w":1.7,"h":1.7,"rot":0,"drillshape":"circle","drill":1,"holerot":0,"net":"VCC"},
{"id":"c1p2","name":"2","layer":"Multi","type":"th","shape":"circle","x":3,"y":8.73,"w":1.7,"h":1.7,"rot":0,"drillshape":"circle","drill":1,"holerot":0,"net":"GND"}]},
{"id":"c2","ref":"R1","footprint":"R0805","comment":"330R","layer":"Top","x":10,"y":14,"rot":0,"bbox":{"x1":8.5,"y1":13.2,"x2":11.5,"y2":14.8},"pads":[
{"id":"c2p1","name":"1","layer":"Top","type":"smd","shape":"rect","x":9.05,"y":14,"w":0.9,"h":1.3,"rot":0,"net":"VCC"},
{"id":"c2p2","name":"2","layer":"Top","type":"smd","shape":"rect","x":10.95,"y":14,"w":0.9,"h":1.3,"rot":0,"net":"NET_LED"}]},
{"id":"c3","ref":"D1","footprint":"LED0805","comment":"LED VERMELHO","layer":"Top","x":16,"y":14,"rot":0,"bbox":{"x1":14.4,"y1":13.2,"x2":17.6,"y2":14.8},"pads":[
{"id":"c3p1","name":"A","layer":"Top","type":"smd","shape":"rect","x":15.05,"y":14,"w":0.9,"h":1.3,"rot":0,"net":"NET_LED"},
{"id":"c3p2","name":"K","layer":"Top","type":"smd","shape":"rect","x":16.95,"y":14,"w":0.9,"h":1.3,"rot":0,"net":"GND"}]},
{"id":"c4","ref":"C1","footprint":"C0805","comment":"100n","layer":"Top","x":10,"y":6,"rot":0,"bbox":{"x1":8.5,"y1":5.2,"x2":11.5,"y2":6.8},"pads":[
{"id":"c4p1","name":"1","layer":"Top","type":"smd","shape":"rect","x":9.05,"y":6,"w":0.9,"h":1.3,"rot":0,"net":"GND"},
{"id":"c4p2","name":"2","layer":"Top","type":"smd","shape":"rect","x":10.95,"y":6,"w":0.9,"h":1.3,"rot":0,"net":"VCC"}]}
],
"freepads":[],
"tracks":[
{"id":"t1","layer":"Top","x1":3,"y1":11.27,"x2":3,"y2":14,"w":0.3,"net":"VCC"},
{"id":"t2","layer":"Top","x1":3,"y1":14,"x2":9.05,"y2":14,"w":0.3,"net":"VCC"},
{"id":"t3","layer":"Top","x1":10.95,"y1":14,"x2":15.05,"y2":14,"w":0.3,"net":"NET_LED"},
{"id":"t4","layer":"Top","x1":16.95,"y1":14,"x2":18,"y2":14,"w":0.3,"net":"GND"},
{"id":"t5","layer":"Top","x1":18,"y1":14,"x2":18,"y2":6,"w":0.3,"net":"GND"},
{"id":"t6","layer":"Top","x1":18,"y1":6,"x2":9.05,"y2":6,"w":0.3,"net":"GND"},
{"id":"t7","layer":"Top","x1":3,"y1":8.73,"x2":3,"y2":6,"w":0.3,"net":"GND"}
],
"arcs":[],
"vias":[],
"texts":[
{"id":"x1","layer":"TopOverlay","x":3,"y":13.2,"text":".Designator","h":0.8,"rot":0,"mirror":false,"designator":true,"comment":false,"owner":"P1"},
{"id":"x2","layer":"TopOverlay","x":10,"y":15.4,"text":".Designator","h":0.8,"rot":0,"mirror":false,"designator":true,"comment":false,"owner":"R1"},
{"id":"x3","layer":"TopOverlay","x":16,"y":15.4,"text":".Designator","h":0.8,"rot":0,"mirror":false,"designator":true,"comment":false,"owner":"D1"},
{"id":"x4","layer":"TopOverlay","x":10,"y":7.4,"text":".Designator","h":0.8,"rot":0,"mirror":false,"designator":true,"comment":false,"owner":"C1"}
],
"silk":[
{"id":"s1","layer":"TopOverlay","kind":"line","x1":9.65,"y1":14.85,"x2":10.35,"y2":14.85,"w":0.15,"owner":"R1"},
{"id":"s2","layer":"TopOverlay","kind":"line","x1":9.65,"y1":13.15,"x2":10.35,"y2":13.15,"w":0.15,"owner":"R1"},
{"id":"s3","layer":"TopOverlay","kind":"line","x1":17.55,"y1":13.2,"x2":17.55,"y2":14.8,"w":0.15,"owner":"D1"}
],
"regions":[],
"stats":{"components":4,"freepads":0,"tracks":7,"arcs":0,"vias":0,"texts":4,"silk":3,"regions":0}
};
```

- [ ] **Step 3: Criar `Projects\_DemoKit\changes.js`** (demonstra diff + ligação faltante de t7→GND do C1) com exatamente:

```js
// AltiumPCBMirror - arquivo de mudancas (DEMO).
// Edite ESTE arquivo (nunca o board.js). Um objeto JSON por linha. Consulte AI-GUIDE.md.
var changes = [
{"op":"comp_move","ref":"D1","x":16,"y":11,"rot":0,"layer":"Top","orig_x":16,"orig_y":14,"orig_rot":0,"orig_layer":"Top","note":"descer o LED"},
{"op":"track_add","layer":"Top","x1":3,"y1":6,"x2":9.05,"y2":6,"w":0.3,"net":"GND","note":"fechar GND do C1 ate o conector"},
{"op":"via_add","x":18,"y":10,"size":0.6,"drill":0.3,"net":"GND","note":"via de costura GND"}
];
```

- [ ] **Step 4: Criar `projects.js`** com exatamente:

```js
var projects = [
{"name":"_DemoKit","files":{"schematic":true,"board":true,"changes":true,"buildreport":false,"applyreport":false},"indexed":"exemplo sintetico"}
];
```

- [ ] **Step 5: Validar sintaxe**

```powershell
node --check Projects/_DemoKit/schematic.js; node --check Projects/_DemoKit/board.js; node --check Projects/_DemoKit/changes.js; node --check projects.js
```

Esperado: exit 0 nos quatro.

- [ ] **Step 6: Commit**

```powershell
git add Projects/_DemoKit projects.js
git commit -m @'
Fixture do projeto demo _DemoKit + indice projects.js

Circuito LED (CONN2+RES+LED+CAP) com esquema, board pos-ECO e changes de demo.
Gabarito dos testes de extracao de nets.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

### Task 3: `hub-core.js` (base + aplicação de mudanças PCB) com teste

TDD. `hub-core.js` é UMD (roda no browser como `HubCore` e no node via `require`), SEM DOM. Nesta task: helpers, `applyPcbChanges` (port do `buildModel` do viewer.html linhas 194-302, generalizado — sem globals `B`/`CH` — e com a op nova `outline_set`) e `deriveStatus`.

**Files:**
- Create: `tests\load.js`
- Create: `tests\test-apply.js`
- Create: `hub-core.js`

- [ ] **Step 1: Criar `tests\load.js`**:

```js
const fs = require('fs'), path = require('path');
// Carrega um arquivo "var X = {...};" e devolve o valor de X.
function loadVar(rel, name){
  const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  return new Function(src + ';return ' + name + ';')();
}
module.exports = { loadVar };
```

- [ ] **Step 2: Criar `tests\test-apply.js`** (o teste que deve falhar primeiro):

```js
const assert = require('assert');
const { loadVar } = require('./load');
const Core = require('../hub-core.js');

const board   = loadVar('Projects/_DemoKit/board.js', 'pcbmirror');
const changes = loadVar('Projects/_DemoKit/changes.js', 'changes');

// demo aplica limpo
const m = Core.applyPcbChanges(board, changes);
assert.strictEqual(m.validation.filter(v => v.level === 'err').length, 0);
const d1 = m.compByRef['D1'];
assert.ok(d1.changed, 'D1 deve estar marcado como movido');
assert.strictEqual(d1.eff.y, 11);
assert.strictEqual(d1.src.y, 14);
assert.strictEqual(m.added.filter(a => a.kind === 'track').length, 1);
assert.strictEqual(m.added.filter(a => a.kind === 'via').length, 1);

// orig_* divergente gera warning (mesma semantica do viewer v1)
const bad = Core.applyPcbChanges(board,
  [{ op:'comp_move', ref:'R1', x:1, y:1, orig_x:999, orig_y:14, orig_rot:0, orig_layer:'Top' }]);
assert.ok(bad.validation.some(v => v.level === 'warn'));

// ref inexistente gera erro
const err = Core.applyPcbChanges(board,
  [{ op:'comp_move', ref:'Z9', x:1, y:1, orig_x:0, orig_y:0, orig_rot:0, orig_layer:'Top' }]);
assert.ok(err.validation.some(v => v.level === 'err'));

// outline_set valido e invalido
const o = Core.applyPcbChanges(board, [{ op:'outline_set', pts:[[0,0],[40,0],[40,25],[0,25]] }]);
assert.ok(o.outlineChanged);
assert.strictEqual(o.outline.length, 4);
assert.deepStrictEqual(o.outline[1], { kind:'line', x1:40, y1:0, x2:40, y2:25 });
const o2 = Core.applyPcbChanges(board, [{ op:'outline_set', pts:[[0,0],[40,0]] }]);
assert.ok(o2.validation.some(v => v.level === 'err'));

// example v1 continua compativel
const exb = loadVar('example/board.js', 'pcbmirror');
const exc = loadVar('example/changes.js', 'changes');
const ex = Core.applyPcbChanges(exb, exc);
assert.strictEqual(ex.validation.filter(v => v.level === 'err').length, 0);
assert.ok(ex.compByRef['R1'].changed);

console.log('test-apply OK');
```

- [ ] **Step 3: Rodar e confirmar que FALHA**

```powershell
node tests/test-apply.js
```

Esperado: `Error: Cannot find module '../hub-core.js'`.

- [ ] **Step 4: Criar `hub-core.js`**:

```js
/* AltiumPCBMirror v2 - hub-core.js
   Logica pura compartilhada pelo hub (browser, global HubCore) e pelos testes (node).
   NAO acessa DOM. Contratos: esquema em mil (Y para cima), PCB em mm (Y para cima).
   A extracao de nets e um PREVIEW - a verdade e sempre o compilador do Altium. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HubCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const TOL = 1e-3, TOL_ANG = 1e-2;  // PCB (mm)
const STOL = 0.5;                   // esquema (mil)

function near(a, b, t){ return Math.abs(a - b) <= (t || TOL); }
function nearAng(a, b){ let d = Math.abs(a - b) % 360; if (d > 180) d = 360 - d; return d <= TOL_ANG; }
function isNum(v){ return typeof v === 'number' && isFinite(v); }
function distSeg(px, py, x1, y1, x2, y2){
  const dx = x2 - x1, dy = y2 - y1, l2 = dx*dx + dy*dy;
  let t = l2 ? ((px-x1)*dx + (py-y1)*dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x1 + t*dx - px, y1 + t*dy - py);
}

/* tamanhos de folha do Altium em mil [largura, altura] */
const SHEET_SIZES = { A4:[11500,7600], A3:[15500,11000], A2:[22000,15500], A1:[31000,22000],
                      A:[9500,7500], B:[15000,9500], C:[20000,15000] };
const ORIENT_DIR = { 0:[1,0], 90:[0,1], 180:[-1,0], 270:[0,-1] };

/* ============ PCB: board + changes -> modelo efetivo (port do viewer v1) ============ */

function applyPcbChanges(board, changes){
  const B = board || {};
  const CH = Array.isArray(changes) ? changes : [];
  const model = { comps:[], compByRef:{}, tracks:[], arcs:[], vias:[], added:[],
                  validation:[], changeItems:[],
                  outline:((B.board && B.board.outline) || []).slice(), outlineChanged:false };
  for (const c of (B.components || [])) {
    const m = { kind:'comp', src:c, eff:{ x:c.x, y:c.y, rot:c.rot, layer:c.layer }, changed:false };
    model.comps.push(m); model.compByRef[c.ref] = m;
  }
  const byId = {};
  for (const t of (B.tracks || [])) { const m = { kind:'track', src:t, eff:{...t}, changed:false, deleted:false }; model.tracks.push(m); byId[t.id] = m; }
  for (const a of (B.arcs  || [])) { const m = { kind:'arc',   src:a, eff:{...a}, changed:false, deleted:false }; model.arcs.push(m);  byId[a.id] = m; }
  for (const v of (B.vias  || [])) { const m = { kind:'via',   src:v, eff:{...v}, changed:false, deleted:false }; model.vias.push(m);  byId[v.id] = m; }

  let addSeq = 0;
  CH.forEach((ch, idx) => {
    const item = { ch, idx, status:'ok', msg:'', target:null };
    model.changeItems.push(item);
    const bad  = (m) => { item.status='err'; item.msg=m; model.validation.push({ level:'err', msg:`#${idx+1} ${ch.op||'?'}: ${m}`, target:item.target }); };
    const warn = (m) => { if (item.status!=='err') item.status='warn'; item.msg=m; model.validation.push({ level:'warn', msg:`#${idx+1} ${ch.op}: ${m}`, target:item.target }); };

    switch (ch.op) {
      case 'comp_move': {
        const m = model.compByRef[ch.ref];
        if (!m) return bad(`componente "${ch.ref}" não existe no board.js`);
        item.target = m;
        if (!isNum(ch.orig_x)||!isNum(ch.orig_y)||!isNum(ch.orig_rot)||!ch.orig_layer)
          return bad('faltam orig_x/orig_y/orig_rot/orig_layer (copie do board.js)');
        if (!near(ch.orig_x,m.src.x)||!near(ch.orig_y,m.src.y)||!nearAng(ch.orig_rot,m.src.rot)||ch.orig_layer!==m.src.layer)
          warn('orig_* não confere com o board.js — espelho pode estar desatualizado');
        if (isNum(ch.x)) m.eff.x = ch.x;
        if (isNum(ch.y)) m.eff.y = ch.y;
        if (isNum(ch.rot)) m.eff.rot = ch.rot;
        if (ch.layer) m.eff.layer = ch.layer;
        m.changed = !(near(m.eff.x,m.src.x)&&near(m.eff.y,m.src.y)&&nearAng(m.eff.rot,m.src.rot)&&m.eff.layer===m.src.layer);
        break;
      }
      case 'track_edit': case 'track_del': {
        let m = ch.id ? byId[ch.id] : null;
        if (m && m.kind!=='track') m = null;
        if (!m) return bad(`trilha id "${ch.id}" não existe no board.js`);
        item.target = m;
        for (const k of ['x1','y1','x2','y2','w'])
          if (!isNum(ch['orig_'+k])) return bad('faltam campos orig_* (copie do board.js)');
        if (!ch.orig_layer) return bad('falta orig_layer');
        const s = m.src;
        const direct = near(ch.orig_x1,s.x1)&&near(ch.orig_y1,s.y1)&&near(ch.orig_x2,s.x2)&&near(ch.orig_y2,s.y2);
        const rev    = near(ch.orig_x1,s.x2)&&near(ch.orig_y1,s.y2)&&near(ch.orig_x2,s.x1)&&near(ch.orig_y2,s.y1);
        if (!(direct||rev) || !near(ch.orig_w,s.w) || ch.orig_layer!==s.layer)
          warn('orig_* não confere com o board.js');
        if (ch.op==='track_del'){ m.deleted = true; break; }
        for (const k of ['x1','y1','x2','y2','w']) if (isNum(ch[k])) m.eff[k] = ch[k];
        if (ch.layer) m.eff.layer = ch.layer;
        if (typeof ch.net==='string') m.eff.net = ch.net;
        m.changed = true;
        break;
      }
      case 'track_add': {
        for (const k of ['x1','y1','x2','y2','w']) if (!isNum(ch[k])) return bad(`campo "${k}" ausente/inválido`);
        if (ch.layer!=='Top' && ch.layer!=='Bottom') return bad('layer deve ser Top ou Bottom');
        if (ch.w<=0) return bad('largura w deve ser > 0');
        const m = { kind:'track', src:null, eff:{ id:'new-t'+(++addSeq), ...ch }, changed:false, added:true };
        model.added.push(m); item.target = m;
        break;
      }
      case 'via_edit': case 'via_del': {
        let m = ch.id ? byId[ch.id] : null;
        if (m && m.kind!=='via') m = null;
        if (!m) return bad(`via id "${ch.id}" não existe no board.js`);
        item.target = m;
        if (!isNum(ch.orig_x)||!isNum(ch.orig_y)) return bad('faltam orig_x/orig_y');
        if (!near(ch.orig_x,m.src.x)||!near(ch.orig_y,m.src.y)) warn('orig_* não confere com o board.js');
        if (ch.op==='via_del'){ m.deleted = true; break; }
        for (const k of ['x','y','size','drill']) if (isNum(ch[k])) m.eff[k] = ch[k];
        m.changed = true;
        break;
      }
      case 'via_add': {
        for (const k of ['x','y','size','drill']) if (!isNum(ch[k])) return bad(`campo "${k}" ausente/inválido`);
        if (ch.drill>=ch.size) warn('drill >= size (anel nulo)');
        const m = { kind:'via', src:null, eff:{ id:'new-v'+(++addSeq), from:'Top', to:'Bottom', ...ch }, changed:false, added:true };
        model.added.push(m); item.target = m;
        break;
      }
      case 'arc_edit': case 'arc_del': {
        let m = ch.id ? byId[ch.id] : null;
        if (m && m.kind!=='arc') m = null;
        if (!m) return bad(`arco id "${ch.id}" não existe no board.js`);
        item.target = m;
        for (const k of ['cx','cy','r','sa','ea']) if (!isNum(ch['orig_'+k])) return bad('faltam campos orig_*');
        if (!ch.orig_layer) return bad('falta orig_layer');
        const s = m.src;
        if (!near(ch.orig_cx,s.cx)||!near(ch.orig_cy,s.cy)||!near(ch.orig_r,s.r)||
            !nearAng(ch.orig_sa,s.sa)||!nearAng(ch.orig_ea,s.ea)||ch.orig_layer!==s.layer)
          warn('orig_* não confere com o board.js');
        if (ch.op==='arc_del'){ m.deleted = true; break; }
        for (const k of ['cx','cy','r','sa','ea','w']) if (isNum(ch[k])) m.eff[k] = ch[k];
        if (ch.layer) m.eff.layer = ch.layer;
        m.changed = true;
        break;
      }
      case 'arc_add': {
        for (const k of ['cx','cy','r','sa','ea','w']) if (!isNum(ch[k])) return bad(`campo "${k}" ausente/inválido`);
        if (ch.layer!=='Top' && ch.layer!=='Bottom') return bad('layer deve ser Top ou Bottom');
        const m = { kind:'arc', src:null, eff:{ id:'new-a'+(++addSeq), ...ch }, changed:false, added:true };
        model.added.push(m); item.target = m;
        break;
      }
      case 'outline_set': {
        if (!Array.isArray(ch.pts) || ch.pts.length < 3 ||
            ch.pts.some(p => !Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])))
          return bad('pts deve ser [[x,y],...] com >= 3 vértices');
        const segs = [];
        for (let i = 0; i < ch.pts.length; i++) {
          const a = ch.pts[i], b = ch.pts[(i+1) % ch.pts.length];
          segs.push({ kind:'line', x1:a[0], y1:a[1], x2:b[0], y2:b[1] });
        }
        model.outline = segs; model.outlineChanged = true;
        break;
      }
      default:
        bad(`operação desconhecida "${ch.op}"`);
    }
  });
  return model;
}

/* ============ status do projeto na esteira ============ */

function deriveStatus(entry, loaded){
  const f = (entry && entry.files) || {};
  if (f.applyreport) return 'aplicada';
  if (loaded && loaded.changesCount > 0 && f.board) return 'roteada';
  if (f.board) return 'eco';
  if (f.schematic) return 'esquema';
  return 'vazio';
}

return { near, nearAng, isNum, distSeg, TOL, STOL, SHEET_SIZES, ORIENT_DIR,
         applyPcbChanges, deriveStatus };
});
```

- [ ] **Step 5: Rodar e confirmar que PASSA**

```powershell
node --check hub-core.js; node tests/test-apply.js
```

Esperado: `test-apply OK`.

- [ ] **Step 6: Commit**

```powershell
git add hub-core.js tests/load.js tests/test-apply.js
git commit -m @'
hub-core.js: aplicacao de changes (port do viewer) + outline_set + status

Logica pura UMD testavel em node; teste com fixture _DemoKit e example v1.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 4: `hub-core.js` — transform de símbolo + extração de nets, com teste

**Files:**
- Create: `tests\test-netextract.js`
- Modify: `hub-core.js` (inserir bloco novo ANTES do `return {...}` final; atualizar o `return`)

- [ ] **Step 1: Criar `tests\test-netextract.js`**:

```js
const assert = require('assert');
const { loadVar } = require('./load');
const Core = require('../hub-core.js');

const sch = loadVar('Projects/_DemoKit/schematic.js', 'schematic');
const lib = loadVar('Libs/schlib.js', 'schlib');

// transform: P1 espelhado -> pino 1 na ponta quente (1400,3100)
const p1 = Core.compPinsWorld(sch.items.find(i => i.ref === 'P1'), lib);
const pin1 = p1.find(p => p.num === '1');
assert.ok(Math.abs(pin1.x - 1400) < 0.5 && Math.abs(pin1.y - 3100) < 0.5,
  `P1-1 esperado (1400,3100), veio (${pin1.x},${pin1.y})`);

// transform: C1 rot 90 -> pino 1 em (1800,2700)
const c1 = Core.compPinsWorld(sch.items.find(i => i.ref === 'C1'), lib);
const c1p1 = c1.find(p => p.num === '1');
assert.ok(Math.abs(c1p1.x - 1800) < 0.5 && Math.abs(c1p1.y - 2700) < 0.5,
  `C1-1 esperado (1800,2700), veio (${c1p1.x},${c1p1.y})`);

// extracao de nets do demo (gabarito da Task 2)
const r = Core.extractNets(sch, lib);
const nets = {};
for (const n of r.nets) nets[n.name] = n.pins.slice().sort().join(',');
assert.strictEqual(nets['VCC'],     'C1-2,P1-1,R1-1');
assert.strictEqual(nets['NET_LED'], 'D1-A,R1-2');
assert.strictEqual(nets['GND'],     'C1-1,D1-K,P1-2');  // 3 ilhas unidas por power ports
assert.strictEqual(r.pinNet['R1-2'], 'NET_LED');
assert.strictEqual(r.warnings.length, 0, 'demo não deve gerar warnings: ' + r.warnings.join(' | '));

// wireNet: primeiro fio da folha 0 e VCC
assert.strictEqual(r.wireNet[0][0], 'VCC');

// nome automatico quando nao ha rotulo
const auto = Core.extractNets({ format:'schmirror-v2', project:'t', units:'mil', items:[
  { t:'sheet', name:'m', size:'A4' },
  { t:'comp', sheet:'m', ref:'R1', sym:'RES', part:1, x:1000, y:1000, rot:0, mirror:false, footprint:'R0805' },
  { t:'comp', sheet:'m', ref:'R2', sym:'RES', part:1, x:1800, y:1000, rot:0, mirror:false, footprint:'R0805' },
  { t:'wire', sheet:'m', pts:[[1200,1000],[1600,1000]] }
]}, lib);
assert.strictEqual(auto.nets.length, 1);
assert.ok(auto.nets[0].auto);
assert.strictEqual(auto.nets[0].name, 'NetR1_2');
assert.deepStrictEqual(auto.nets[0].pins.slice().sort(), ['R1-2','R2-1']);

// cruzamento sem junction NAO conecta; com junction conecta
const cross = (withJ) => Core.extractNets({ format:'schmirror-v2', project:'t', units:'mil', items:[
  { t:'sheet', name:'m', size:'A4' },
  { t:'wire', sheet:'m', pts:[[0,100],[200,100]] },
  { t:'wire', sheet:'m', pts:[[100,0],[100,200]] },
  { t:'netlabel', sheet:'m', net:'A', x:0, y:100, rot:0 },
  { t:'netlabel', sheet:'m', net:'B', x:100, y:0, rot:0 },
  ...(withJ ? [{ t:'junction', sheet:'m', x:100, y:100 }] : [])
]}, lib);
assert.strictEqual(cross(false).nets.length, 2, 'cruzamento sem junction deve dar 2 nets');
assert.strictEqual(cross(true).nets.length, 1, 'junction deve unir as 2 nets');

console.log('test-netextract OK');
```

- [ ] **Step 2: Rodar e confirmar que FALHA** — `node tests/test-netextract.js` → `TypeError: Core.compPinsWorld is not a function`.

- [ ] **Step 3: Inserir em `hub-core.js`**, imediatamente ANTES da linha `/* ============ status do projeto na esteira ============ */`:

```js
/* ============ Esquema: libs, transform e extracao de nets (preview) ============ */

function symbolOf(schlib, name){
  return ((schlib && schlib.symbols) || []).find(s => s.name === name) || null;
}
function partOf(sym, part){
  if (!sym || !sym.parts || !sym.parts.length) return null;
  return sym.parts.find(p => p.part === (part || 1)) || null;
}
function footprintOf(pcblib, name){
  return ((pcblib && pcblib.footprints) || []).find(f => f.name === name) || null;
}
/* ponta quente do pino (onde o fio conecta), em coords locais do simbolo */
function pinHot(pin){
  const d = ORIENT_DIR[((pin.orient % 360) + 360) % 360] || [1, 0];
  return { x: pin.x + d[0]*pin.len, y: pin.y + d[1]*pin.len };
}
/* transform local->mundo de um componente: espelha X, rotaciona anti-horario, translada */
function compTransform(comp){
  const rot = (((comp.rot || 0) % 360) + 360) % 360;
  const cos = Math.cos(rot * Math.PI/180), sin = Math.sin(rot * Math.PI/180);
  const mx = comp.mirror ? -1 : 1;
  return {
    map(x, y){ const lx = x*mx, ly = y; return { x: comp.x + lx*cos - ly*sin, y: comp.y + lx*sin + ly*cos }; },
    ang(a){ return ((((comp.mirror ? 180 - a : a) + rot) % 360) + 360) % 360; }
  };
}
/* pontas quentes de todos os pinos do componente, em coords da folha; null se simbolo desconhecido */
function compPinsWorld(comp, schlib){
  const sym = symbolOf(schlib, comp.sym); if (!sym) return null;
  const part = partOf(sym, comp.part);    if (!part) return null;
  const tf = compTransform(comp);
  return (part.pins || []).map(p => {
    const h = pinHot(p), w = tf.map(h.x, h.y);
    return { num: p.num, name: p.name, x: w.x, y: w.y };
  });
}

/* agrupa a lista plana "items" em folhas */
function buildSchModel(schematic){
  const model = { project: (schematic && schematic.project) || '', units: (schematic && schematic.units) || 'mil', sheets: [] };
  const byName = {};
  for (const it of ((schematic && schematic.items) || [])) {
    if (it.t === 'sheet') {
      if (byName[it.name]) continue;
      const s = { name: it.name, size: it.size || 'A4', comps:[], wires:[], netlabels:[], powers:[], junctions:[], texts:[] };
      model.sheets.push(s); byName[it.name] = s;
      continue;
    }
    let s = byName[it.sheet];
    if (!s) {
      s = { name: it.sheet || 'main', size:'A4', comps:[], wires:[], netlabels:[], powers:[], junctions:[], texts:[] };
      model.sheets.push(s); byName[s.name] = s;
    }
    if      (it.t === 'comp')     s.comps.push(it);
    else if (it.t === 'wire')     s.wires.push(it);
    else if (it.t === 'netlabel') s.netlabels.push(it);
    else if (it.t === 'power')    s.powers.push(it);
    else if (it.t === 'junction') s.junctions.push(it);
    else if (it.t === 'text')     s.texts.push(it);
  }
  return model;
}

/* Extracao de nets (PREVIEW - a verdade e o compilador do Altium).
   Regras: pontos coincidentes conectam; ponto de conexao (extremo de fio, pino,
   junction, ancora de rotulo/power) SOBRE um segmento conecta (T); cruzamento sem
   ponto de conexao NAO conecta; netlabel funde grupos por nome; power funde por
   nome globalmente. Nome automatico: Net<ref>_<pino> do menor pino. */
function extractNets(schematicOrModel, schlib){
  const model = schematicOrModel.sheets ? schematicOrModel : buildSchModel(schematicOrModel);
  const warnings = [];
  const parent = [];
  const mk = () => { parent.push(parent.length); return parent.length - 1; };
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

  const nodeMap = {};
  const key = (si, x, y) => si + '|' + Math.round(x*2) + '|' + Math.round(y*2);
  const nodeAt = (si, x, y) => { const k = key(si, x, y); if (!(k in nodeMap)) nodeMap[k] = mk(); return nodeMap[k]; };

  const segs = [], attach = [], pinRecs = [], labelRecs = [], powerRecs = [];
  const wireNet = model.sheets.map(s => s.wires.map(() => ''));

  model.sheets.forEach((s, si) => {
    s.wires.forEach((w, wi) => {
      const pts = w.pts || [];
      for (let i = 0; i < pts.length - 1; i++) {
        const nA = nodeAt(si, pts[i][0], pts[i][1]), nB = nodeAt(si, pts[i+1][0], pts[i+1][1]);
        uni(nA, nB);
        segs.push({ si, wi, x1:pts[i][0], y1:pts[i][1], x2:pts[i+1][0], y2:pts[i+1][1], node:nA });
      }
      pts.forEach(p => attach.push({ si, x:p[0], y:p[1], node:nodeAt(si, p[0], p[1]), kind:'wend' }));
    });
    s.comps.forEach(c => {
      const pins = compPinsWorld(c, schlib);
      if (!pins) { warnings.push(`${c.ref}: símbolo "${c.sym}" desconhecido — pinos ignorados na extração`); return; }
      pins.forEach(p => {
        const n = nodeAt(si, p.x, p.y);
        pinRecs.push({ ref:c.ref, num:p.num, node:n });
        attach.push({ si, x:p.x, y:p.y, node:n, kind:'pin' });
      });
    });
    s.junctions.forEach(j => attach.push({ si, x:j.x, y:j.y, node:nodeAt(si, j.x, j.y), kind:'junction' }));
    s.netlabels.forEach(l => { const n = nodeAt(si, l.x, l.y); labelRecs.push({ net:l.net, node:n, x:l.x, y:l.y }); attach.push({ si, x:l.x, y:l.y, node:n, kind:'label' }); });
    s.powers.forEach(p => { const n = nodeAt(si, p.x, p.y); powerRecs.push({ net:p.net, node:n }); attach.push({ si, x:p.x, y:p.y, node:n, kind:'power' }); });
  });

  /* conexoes em T: ponto de conexao sobre o interior de um segmento */
  const autoJunctions = [];
  for (const a of attach) {
    for (const g of segs) {
      if (g.si !== a.si) continue;
      if ((near(a.x,g.x1,STOL) && near(a.y,g.y1,STOL)) || (near(a.x,g.x2,STOL) && near(a.y,g.y2,STOL))) continue;
      if (distSeg(a.x, a.y, g.x1, g.y1, g.x2, g.y2) <= STOL) {
        uni(a.node, g.node);
        if (a.kind === 'pin' || a.kind === 'wend' || a.kind === 'junction')
          autoJunctions.push({ sheet:a.si, x:a.x, y:a.y });
      }
    }
  }

  /* fusao por nome (netlabel e power) */
  const nameRoot = {};
  for (const rec of labelRecs.concat(powerRecs)) {
    const r = find(rec.node);
    if (rec.net in nameRoot) uni(nameRoot[rec.net], r); else nameRoot[rec.net] = r;
  }

  /* agrupamento e nomeacao */
  const groups = {};
  const gof = n => { const r = find(n); if (!groups[r]) groups[r] = { names:new Set(), pins:[] }; return groups[r]; };
  for (const rec of labelRecs) gof(rec.node).names.add(rec.net);
  for (const rec of powerRecs) gof(rec.node).names.add(rec.net);
  for (const rec of pinRecs)   gof(rec.node).pins.push(rec.ref + '-' + rec.num);
  for (const g of segs) gof(g.node);
  const segRoots = new Set(segs.map(g => find(g.node)));

  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric:true, sensitivity:'base' });
  const netByRoot = {}, nets = [];
  for (const r in groups) {
    const g = groups[r];
    const names = [...g.names].sort(natural);
    let name = '', auto = false;
    if (names.length > 1) warnings.push('nomes de net conflitantes no mesmo grupo: ' + names.join(', '));
    if (names.length) name = names[0];
    else if (g.pins.length) {
      const ps = g.pins.slice().sort(natural);
      name = 'Net' + ps[0].replace('-', '_'); auto = true;
    }
    netByRoot[r] = name;
    /* net so entra na lista se: tem rotulo/power (e algum fio ou pino), ou tem >= 2 pinos.
       Pino solto sem fio NAO vira net (equivale a NetlistSinglePinNets=0 do Altium). */
    if (names.length) {
      if (g.pins.length || segRoots.has(+r))
        nets.push({ name, pins: g.pins.slice().sort(natural), auto: false });
    } else if (g.pins.length >= 2) {
      nets.push({ name, pins: g.pins.slice().sort(natural), auto: true });
    }
    if (!name && !g.pins.length && segRoots.has(+r))
      warnings.push('fio sem conexão (nenhum pino ou rótulo)');
  }
  for (const rec of labelRecs) {
    const r = find(rec.node), g = groups[r];
    if (!segRoots.has(r) && (!g || !g.pins.length))
      warnings.push(`netlabel "${rec.net}" solta em (${rec.x},${rec.y})`);
  }
  nets.sort((a, b) => natural(a.name, b.name));

  const pinNet = {};
  for (const rec of pinRecs) { const nm = netByRoot[find(rec.node)]; if (nm) pinNet[rec.ref + '-' + rec.num] = nm; }
  for (const g of segs) { const nm = netByRoot[find(g.node)]; if (nm) wireNet[g.si][g.wi] = nm; }

  return { nets, pinNet, wireNet, autoJunctions, warnings };
}
```

Atenção ao detalhe `segRoots.has(+r)`: as chaves de `groups` são strings — converta para número.

- [ ] **Step 4: Atualizar o `return {...}` final** de `hub-core.js` para:

```js
return { near, nearAng, isNum, distSeg, TOL, STOL, SHEET_SIZES, ORIENT_DIR,
         symbolOf, partOf, footprintOf, pinHot, compTransform, compPinsWorld,
         buildSchModel, extractNets,
         applyPcbChanges, deriveStatus };
```

- [ ] **Step 5: Rodar e confirmar que PASSA**

```powershell
node --check hub-core.js; node tests/test-apply.js; node tests/test-netextract.js
```

Esperado: `test-apply OK` e `test-netextract OK`.

- [ ] **Step 6: Commit**

```powershell
git add hub-core.js tests/test-netextract.js
git commit -m @'
hub-core.js: transform de simbolo e extracao de nets com union-find

Regras Altium: T conecta, cruzamento nao, labels fundem por nome, powers
globais; gabarito _DemoKit + casos sinteticos (auto-nome, junction).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 5: `hub-core.js` — validação de esquema, com teste

**Files:**
- Create: `tests\test-validate.js`
- Modify: `hub-core.js` (inserir ANTES de `/* ============ status do projeto na esteira ============ */`; atualizar `return`)

- [ ] **Step 1: Criar `tests\test-validate.js`**:

```js
const assert = require('assert');
const { loadVar } = require('./load');
const Core = require('../hub-core.js');

const sch = loadVar('Projects/_DemoKit/schematic.js', 'schematic');
const slib = loadVar('Libs/schlib.js', 'schlib');
const plib = loadVar('Libs/pcblib.js', 'pcblib');

// demo valida limpo
const v = Core.validateSchematic(sch, slib, plib);
assert.strictEqual(v.errors.length, 0, 'erros: ' + v.errors.join(' | '));
assert.strictEqual(v.warnings.length, 0, 'warnings: ' + v.warnings.join(' | '));

const base = (items) => ({ format:'schmirror-v2', project:'t', units:'mil',
  items:[{ t:'sheet', name:'m', size:'A4' }, ...items] });
const comp = (over) => ({ t:'comp', sheet:'m', ref:'R1', sym:'RES', part:1,
  x:1000, y:1000, rot:0, mirror:false, footprint:'R0805', ...over });

// simbolo inexistente
assert.ok(Core.validateSchematic(base([comp({ sym:'NAOEXISTE' })]), slib, plib)
  .errors.some(e => e.includes('NAOEXISTE')));
// footprint inexistente
assert.ok(Core.validateSchematic(base([comp({ footprint:'NAOEXISTE' })]), slib, plib)
  .errors.some(e => e.includes('NAOEXISTE')));
// footprint ausente
assert.ok(Core.validateSchematic(base([comp({ footprint:undefined })]), slib, plib)
  .errors.some(e => e.includes('footprint')));
// ref duplicado
assert.ok(Core.validateSchematic(base([comp({}), comp({ x:2000 })]), slib, plib)
  .errors.some(e => e.includes('duplicado')));
// pino sem pad correspondente (LED A/K num footprint 1/2)
assert.ok(Core.validateSchematic(base([comp({ sym:'LED', footprint:'R0805' })]), slib, plib)
  .warnings.some(w => w.includes('sem pad')));
// fora da grade
assert.ok(Core.validateSchematic(base([comp({ x:1015 })]), slib, plib)
  .warnings.some(w => w.includes('grade')));
// wire invalido
assert.ok(Core.validateSchematic(base([{ t:'wire', sheet:'m', pts:[[0,0]] }]), slib, plib)
  .errors.some(e => e.includes('pts')));
// rot invalida
assert.ok(Core.validateSchematic(base([comp({ rot:45 })]), slib, plib)
  .errors.some(e => e.includes('rot')));

// deriveStatus
assert.strictEqual(Core.deriveStatus({ files:{ schematic:true } }), 'esquema');
assert.strictEqual(Core.deriveStatus({ files:{ schematic:true, board:true } }), 'eco');
assert.strictEqual(Core.deriveStatus({ files:{ schematic:true, board:true } }, { changesCount:3 }), 'roteada');
assert.strictEqual(Core.deriveStatus({ files:{ applyreport:true } }), 'aplicada');

console.log('test-validate OK');
```

- [ ] **Step 2: Rodar e confirmar que FALHA** — `node tests/test-validate.js` → `TypeError: Core.validateSchematic is not a function`.

- [ ] **Step 3: Inserir em `hub-core.js`** (antes do bloco de status):

```js
/* ============ validacao do schematic.js contra as libs espelhadas ============ */

function validateSchematic(schematic, schlib, pcblib){
  const errors = [], warnings = [];
  if (!schematic || schematic.format !== 'schmirror-v2') warnings.push('format esperado "schmirror-v2"');
  if (!schematic || !schematic.project) errors.push('header: falta "project"');
  const model = buildSchModel(schematic || {});
  if (!model.sheets.length) errors.push('nenhuma folha ({"t":"sheet",...})');
  const seen = {};
  for (const s of model.sheets) {
    for (const c of s.comps) {
      const where = `comp ${c.ref || '?'}`;
      if (!c.ref) { errors.push('comp sem "ref"'); continue; }
      const k = c.ref + '/' + (c.part || 1);
      if (seen[k]) errors.push(`${where}: ref duplicado (parte ${c.part || 1})`);
      seen[k] = true;
      if (!isNum(c.x) || !isNum(c.y)) { errors.push(`${where}: faltam x/y`); continue; }
      const rot = (((c.rot || 0) % 360) + 360) % 360;
      if (![0, 90, 180, 270].includes(rot)) errors.push(`${where}: rot deve ser 0/90/180/270`);
      const sym = symbolOf(schlib, c.sym);
      if (!sym) { errors.push(`${where}: símbolo "${c.sym}" não existe na schlib`); continue; }
      const part = partOf(sym, c.part);
      if (!part) errors.push(`${where}: parte ${c.part || 1} não existe em "${c.sym}"`);
      if (!c.footprint) errors.push(`${where}: falta "footprint" (obrigatório em todo componente)`);
      else {
        const fp = footprintOf(pcblib, c.footprint);
        if (!fp) errors.push(`${where}: footprint "${c.footprint}" não existe na pcblib`);
        else if (part) {
          const padNames = new Set((fp.pads || []).map(p => String(p.name)));
          for (const p of (part.pins || []))
            if (!padNames.has(String(p.num)))
              warnings.push(`${where}: pino "${p.num}" sem pad correspondente no footprint ${c.footprint}`);
        }
        const cur = (sym.footprints || []).find(f => f.current);
        if (cur && cur.name !== c.footprint)
          warnings.push(`${where}: footprint ${c.footprint} difere do modelo da lib (${cur.name})`);
      }
      if ((c.x % 100) || (c.y % 100)) warnings.push(`${where}: fora da grade de 100 mil`);
    }
    for (const w of s.wires) {
      if (!Array.isArray(w.pts) || w.pts.length < 2) { errors.push(`wire na folha ${s.name}: pts precisa de >= 2 pontos`); continue; }
      for (const p of w.pts)
        if ((p[0] % 100) || (p[1] % 100)) { warnings.push(`wire na folha ${s.name}: vértice (${p[0]},${p[1]}) fora da grade de 100 mil`); break; }
    }
    for (const l of s.netlabels) if (!l.net) errors.push(`netlabel sem "net" na folha ${s.name}`);
    for (const p of s.powers)    if (!p.net) errors.push(`power sem "net" na folha ${s.name}`);
  }
  return { errors, warnings };
}
```

- [ ] **Step 4: Atualizar o `return {...}` final** acrescentando `validateSchematic` (entre `extractNets` e `applyPcbChanges`).

- [ ] **Step 5: Rodar TODOS os testes e confirmar que PASSAM**

```powershell
node --check hub-core.js; node tests/test-apply.js; node tests/test-netextract.js; node tests/test-validate.js
```

- [ ] **Step 6: Commit**

```powershell
git add hub-core.js tests/test-validate.js
git commit -m @'
hub-core.js: validacao de schematic.js contra as libs espelhadas

Erros (sym/footprint/ref/rot/pts) e avisos (grade, pino sem pad, modelo divergente).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

### Task 6: `hub-draw.js` — renderers canvas compartilhados

Usado pelo hub (vista Libs) e pelo schframe (vista Esquema). Sem DOM além de canvas 2D; `node --check` valida a sintaxe. Esquema desenha em tema CLARO (folha do Altium); footprints no tema escuro do viewer.

**Files:**
- Create: `hub-draw.js`

- [ ] **Step 1: Criar `hub-draw.js`**:

```js
/* AltiumPCBMirror v2 - hub-draw.js — renderers canvas compartilhados (browser).
   Esquema em mil (tema claro, folha Altium); footprint em mm (tema escuro do viewer). */
"use strict";
var HubDraw = (function () {

const OD = { 0:[1,0], 90:[0,1], 180:[-1,0], 270:[0,-1] };
const SCH = { body:'#00008b', fill:'#fff8c8', pin:'#00008b', pinnum:'#600000',
              wire:'#0000c8', junction:'#0000c8', label:'#000000', power:'#000000',
              text:'#000080', sheet:'#fffef2', border:'#8a8a6a', grid:'#e6e4cf', hl:'#ff8c00' };
const PCB = { Top:'#ff0000', Bottom:'#0a0aff', TopOverlay:'#ffff00', BottomOverlay:'#b4b400',
              Multi:'#c0c0c0', hole:'#000000', bg:'#1b1b1b' };

/* texto no mundo Y-up (desfaz o flip da camera); h em unidades de mundo */
function worldText(ctx, txt, x, y, h, rot, color, align){
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(((rot || 0) * Math.PI) / 180);
  ctx.scale(1, -1);
  ctx.font = h + 'px "Segoe UI", sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(txt, 0, 0);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r){
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y); ctx.arcTo(x+w, y, x+w, y+r, r);
  ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
  ctx.lineTo(x+r, y+h); ctx.arcTo(x, y+h, x, y+h-r, r);
  ctx.lineTo(x, y+r); ctx.arcTo(x, y, x+r, y, r);
  ctx.closePath();
}

/* ---------- simbolo (coords locais do simbolo, mil) ---------- */
function drawSymbolPart(ctx, part, opts){
  const o = opts || {};
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const g of (part.graphics || [])) {
    ctx.beginPath();
    ctx.lineWidth = g.w || 6;
    ctx.strokeStyle = o.stroke || SCH.body;
    ctx.fillStyle = SCH.fill;
    if (g.g === 'rect') { ctx.rect(g.x1, g.y1, g.x2-g.x1, g.y2-g.y1); if (g.solid) ctx.fill(); ctx.stroke(); }
    else if (g.g === 'line') { ctx.moveTo(g.x1, g.y1); ctx.lineTo(g.x2, g.y2); ctx.stroke(); }
    else if (g.g === 'arc') { ctx.arc(g.cx, g.cy, g.r, (g.sa||0)*Math.PI/180, (g.ea==null?360:g.ea)*Math.PI/180); ctx.stroke(); }
    else if (g.g === 'ellipse') { ctx.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, 2*Math.PI); if (g.solid) ctx.fill(); ctx.stroke(); }
    else if (g.g === 'poly') { (g.pts||[]).forEach((p,i)=> i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath(); if (g.solid) ctx.fill(); ctx.stroke(); }
    else if (g.g === 'polyline') { (g.pts||[]).forEach((p,i)=> i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.stroke(); }
    else if (g.g === 'label') { worldText(ctx, g.text||'', g.x, g.y, (g.size||8)*10, g.rot||0, SCH.text, 'center'); }
  }
  for (const p of (part.pins || [])) {
    const d = OD[((p.orient % 360) + 360) % 360] || [1, 0];
    const hx = p.x + d[0]*p.len, hy = p.y + d[1]*p.len;
    ctx.beginPath(); ctx.lineWidth = 4; ctx.strokeStyle = o.stroke || SCH.pin;
    ctx.moveTo(p.x, p.y); ctx.lineTo(hx, hy); ctx.stroke();
    if (o.showPinNums !== false)
      worldText(ctx, p.num, (p.x+hx)/2 + Math.abs(d[1])*30, (p.y+hy)/2 + Math.abs(d[0])*30, 45, 0, SCH.pinnum, 'center');
  }
}

/* bbox local do simbolo (graficos + pinos) para fit */
function symBBox(part){
  let x1=1e9, y1=1e9, x2=-1e9, y2=-1e9;
  const ext=(x,y)=>{ if(x<x1)x1=x; if(x>x2)x2=x; if(y<y1)y1=y; if(y>y2)y2=y; };
  for (const g of (part.graphics || [])) {
    if (g.g==='rect'||g.g==='line'){ ext(g.x1,g.y1); ext(g.x2,g.y2); }
    else if (g.g==='arc'){ ext(g.cx-g.r,g.cy-g.r); ext(g.cx+g.r,g.cy+g.r); }
    else if (g.g==='ellipse'){ ext(g.cx-g.rx,g.cy-g.ry); ext(g.cx+g.rx,g.cy+g.ry); }
    else if (g.g==='poly'||g.g==='polyline'){ (g.pts||[]).forEach(p=>ext(p[0],p[1])); }
    else if (g.g==='label'){ ext(g.x-100,g.y-50); ext(g.x+100,g.y+50); }
  }
  for (const p of (part.pins || [])) {
    const d = OD[((p.orient%360)+360)%360] || [1,0];
    ext(p.x,p.y); ext(p.x+d[0]*p.len, p.y+d[1]*p.len);
  }
  if (x1 > x2) { x1=-100; y1=-100; x2=100; y2=100; }
  return { x1, y1, x2, y2 };
}

/* ---------- footprint (coords locais, mm) ---------- */
function drawFootprint(ctx, fp, opts){
  for (const s of (fp.silk || [])) {
    ctx.beginPath(); ctx.strokeStyle = PCB.TopOverlay; ctx.lineWidth = s.w || 0.15; ctx.lineCap='round';
    if (s.kind === 'arc') ctx.arc(s.cx, s.cy, s.r, (s.sa||0)*Math.PI/180, (s.ea==null?360:s.ea)*Math.PI/180);
    else { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
    ctx.stroke();
  }
  for (const p of (fp.pads || [])) {
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(((p.rot||0)*Math.PI)/180);
    ctx.fillStyle = p.type === 'th' ? PCB.Multi : (PCB[p.layer] || PCB.Top);
    ctx.beginPath();
    const hw = p.w/2, hh = p.h/2;
    if (p.shape === 'circle') ctx.arc(0, 0, Math.max(hw, hh), 0, 2*Math.PI);
    else if (p.shape === 'oval' || p.shape === 'roundrect') { const r = Math.min(hw, hh); roundRect(ctx, -hw, -hh, p.w, p.h, Math.min(p.radius || r, r)); }
    else if (p.shape === 'octagon') { const c = Math.min(hw,hh)*0.4142;
      ctx.moveTo(-hw+c,-hh); ctx.lineTo(hw-c,-hh); ctx.lineTo(hw,-hh+c); ctx.lineTo(hw,hh-c);
      ctx.lineTo(hw-c,hh); ctx.lineTo(-hw+c,hh); ctx.lineTo(-hw,hh-c); ctx.lineTo(-hw,-hh+c); ctx.closePath(); }
    else ctx.rect(-hw, -hh, p.w, p.h);
    ctx.fill();
    if (p.type === 'th' && p.drill) { ctx.fillStyle = PCB.hole; ctx.beginPath(); ctx.arc(0, 0, p.drill/2, 0, 2*Math.PI); ctx.fill(); }
    ctx.restore();
    if (!opts || opts.showPadNames !== false)
      worldText(ctx, String(p.name), p.x, p.y, Math.max(Math.min(p.w, p.h)*0.55, 0.3), 0, '#ffffff', 'center');
  }
}

/* ---------- power port / netlabel / junction (coords da folha, mil) ---------- */
function seg(ctx, x1, y1, x2, y2){ ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
function drawPowerPort(ctx, p, color){
  const c = color || SCH.power;
  ctx.save();
  ctx.translate(p.x, p.y); ctx.rotate((((p.rot||0)%360)*Math.PI)/180);
  ctx.strokeStyle = c; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); seg(ctx, 0, 0, 100, 0);
  const st = p.style || 'Bar';
  if (st === 'GndPower' || st === 'GndEarth') { seg(ctx,100,-50,100,50); seg(ctx,120,-30,120,30); seg(ctx,140,-12,140,12); ctx.stroke(); }
  else if (st === 'GndSignal') { ctx.stroke(); ctx.beginPath(); ctx.moveTo(100,-50); ctx.lineTo(100,50); ctx.lineTo(160,0); ctx.closePath(); ctx.stroke(); }
  else if (st === 'Circle' || st === 'Wave') { ctx.stroke(); ctx.beginPath(); ctx.arc(125, 0, 25, 0, 2*Math.PI); ctx.stroke(); }
  else if (st === 'Arrow') { seg(ctx,100,0,70,25); seg(ctx,100,0,70,-25); ctx.stroke(); }
  else { seg(ctx, 100, -50, 100, 50); ctx.stroke(); }  // Bar
  ctx.restore();
  const rot = ((p.rot||0)%360+360)%360;
  const d = OD[rot] || [1,0];
  const isGnd = st.indexOf('Gnd') === 0;
  worldText(ctx, p.net || '', p.x + d[0]*(isGnd?230:190), p.y + d[1]*(isGnd?230:190), 55, 0, c, 'center');
}
function drawNetLabel(ctx, l, color){
  worldText(ctx, l.net || '', l.x, l.y + 18, 55, l.rot || 0, color || SCH.label,
    (((l.rot||0)%360)+360)%360 === 0 ? 'left' : 'center');
}
function drawJunction(ctx, x, y, color){
  ctx.fillStyle = color || SCH.junction;
  ctx.beginPath(); ctx.arc(x, y, 18, 0, 2*Math.PI); ctx.fill();
}

/* ---------- camera zoom/pan Y-up (mesma matriz do viewer v1) ---------- */
function mkCamera(canvas, drawWorld, opts){
  const ctx = canvas.getContext('2d');
  const cam = { scale: 0.1, cx: 0, cy: 0 };
  let DPR = 1, W = 0, H = 0;
  function draw(){
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = (opts && opts.bg) || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(DPR*cam.scale, 0, 0, -DPR*cam.scale,
      DPR*(W/2 - cam.cx*cam.scale), DPR*(H/2 + cam.cy*cam.scale));
    drawWorld(ctx, cam);
  }
  function resize(){
    DPR = window.devicePixelRatio || 1;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W*DPR); canvas.height = Math.round(H*DPR);
    draw();
  }
  function fit(bb, margin){
    const m = margin || 1.15;
    const w = Math.max(bb.x2-bb.x1, 1), h = Math.max(bb.y2-bb.y1, 1);
    cam.cx = (bb.x1+bb.x2)/2; cam.cy = (bb.y1+bb.y2)/2;
    cam.scale = Math.min(W/(w*m), H/(h*m));
    draw();
  }
  function toWorld(sx, sy){ return { x:(sx-W/2)/cam.scale + cam.cx, y:(H/2-sy)/cam.scale + cam.cy }; }
  let dragging = false, lx = 0, ly = 0, moved = false;
  canvas.addEventListener('mousedown', e => { dragging = true; moved = false; lx = e.offsetX; ly = e.offsetY; });
  window.addEventListener('mouseup', () => { dragging = false; });
  canvas.addEventListener('mousemove', e => {
    if (opts && opts.onMove) opts.onMove(toWorld(e.offsetX, e.offsetY), e);
    if (!dragging) return;
    cam.cx -= (e.offsetX-lx)/cam.scale; cam.cy += (e.offsetY-ly)/cam.scale;
    lx = e.offsetX; ly = e.offsetY; moved = true; draw();
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const w = toWorld(e.offsetX, e.offsetY);
    cam.scale *= (e.deltaY < 0 ? 1.18 : 1/1.18);
    cam.cx = w.x - (e.offsetX-W/2)/cam.scale;
    cam.cy = w.y + (e.offsetY-H/2)/cam.scale;
    draw();
    if (opts && opts.onZoom) opts.onZoom(cam);
  }, { passive: false });
  canvas.addEventListener('click', e => {
    if (moved) return;
    if (opts && opts.onClick) opts.onClick(toWorld(e.offsetX, e.offsetY), e);
  });
  window.addEventListener('resize', resize);
  return { cam, ctx, draw, fit, toWorld, resize };
}

return { SCH, PCB, OD, worldText, roundRect, drawSymbolPart, symBBox, drawFootprint,
         drawPowerPort, drawNetLabel, drawJunction, mkCamera };
})();
if (typeof module === 'object' && module.exports) module.exports = HubDraw;
```

- [ ] **Step 2: Validar** — `node --check hub-draw.js` (exit 0).

- [ ] **Step 3: Commit**

```powershell
git add hub-draw.js
git commit -m @'
hub-draw.js: renderers de simbolo, footprint, power port, netlabel e camera

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 7: `hub.html` + `hub-ui.js` — shell com vistas Projetos e Libs

O hub abre por duplo clique na raiz do workspace. Vistas Esquema/PCB são iframes (Tasks 8/9) — os botões já apontam para elas. Toda a lógica JS fica em `hub-ui.js` (validável com `node --check`); `hub.html` é só markup+CSS.

**Files:**
- Create: `hub.html`
- Create: `hub-ui.js`

- [ ] **Step 1: Criar `hub.html`**:

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>AltiumPCBMirror — Hub</title>
<style>
  :root{ --bg:#1b1b1b; --panel:#242424; --panel2:#2d2d2d; --border:#3a3a3a;
    --fg:#d8d8d8; --fg-dim:#9a9a9a; --accent:#4fc3f7; --ok:#00e676; --warn:#ffd54f; --err:#ff5252; }
  *{box-sizing:border-box; margin:0; padding:0;}
  html,body{height:100%; overflow:hidden;}
  body{background:var(--bg); color:var(--fg); font:13px/1.45 "Segoe UI",sans-serif;}
  #header{display:flex; align-items:center; gap:10px; height:44px; padding:0 12px;
    background:var(--panel); border-bottom:1px solid var(--border);}
  #header h1{font-size:14px; font-weight:600; color:var(--accent); white-space:nowrap;}
  #tabs{display:flex; gap:4px; margin-left:14px;}
  .tab{background:var(--panel2); color:var(--fg); border:1px solid var(--border); border-bottom:none;
    border-radius:4px 4px 0 0; padding:6px 16px; cursor:pointer; font-size:12px;}
  .tab.active{background:#0d47a1; color:#fff; border-color:var(--accent);}
  #curproj{margin-left:auto; color:var(--fg-dim); font-size:12px;}
  .view{display:none; height:calc(100% - 44px);}
  .view.active{display:block;}
  iframe{width:100%; height:100%; border:0; background:var(--bg);}
  /* Projetos */
  #view-projects{overflow:auto; padding:18px;}
  #cards{display:flex; flex-wrap:wrap; gap:14px;}
  .card{width:290px; background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:12px;}
  .card h3{font-size:14px; color:#fff; margin-bottom:6px; display:flex; gap:8px; align-items:center;}
  .badge{font-size:10px; background:#6a1b9a; color:#fff; border-radius:3px; padding:1px 6px;}
  .steps{display:flex; gap:4px; margin:8px 0;}
  .step{flex:1; text-align:center; font-size:10px; padding:3px 0; border-radius:3px;
    background:var(--panel2); color:var(--fg-dim); border:1px solid var(--border);}
  .step.done{background:#1b5e20; color:#c8e6c9; border-color:#2e7d32;}
  .step.cur{background:#0d47a1; color:#fff; border-color:var(--accent);}
  .card .info{color:var(--fg-dim); font-size:11px; min-height:32px; white-space:pre-line;}
  .card .actions{display:flex; gap:6px; margin-top:8px;}
  button{background:var(--panel2); color:var(--fg); border:1px solid var(--border);
    border-radius:3px; padding:4px 10px; font-size:12px; cursor:pointer;}
  button:hover{border-color:var(--accent); color:#fff;}
  #howto{margin-top:22px; color:var(--fg-dim); font-size:12px; max-width:760px; line-height:1.7;}
  #howto b{color:var(--fg);}
  /* Libs */
  #view-libs{display:none; height:calc(100% - 44px);}
  #view-libs.active{display:flex;}
  #libleft{width:290px; min-width:290px; background:var(--panel); border-right:1px solid var(--border);
    display:flex; flex-direction:column;}
  #libsearch{margin:8px; background:var(--panel2); border:1px solid var(--border); color:var(--fg);
    border-radius:3px; padding:5px 8px;}
  #liblist{flex:1; overflow:auto;}
  .libitem{padding:5px 10px; cursor:pointer; border-left:3px solid transparent; font-size:12px;}
  .libitem:hover{background:#333;}
  .libitem.sel{background:#0d47a1; color:#fff;}
  .libitem .miss{color:var(--err); font-size:10px;}
  #libmain{flex:1; display:flex; flex-direction:column; min-width:0;}
  #libwarn{padding:6px 12px; color:var(--warn); font-size:11px; border-bottom:1px solid var(--border);
    max-height:76px; overflow:auto; white-space:pre-line;}
  #libcanvases{flex:1; display:flex; min-height:0;}
  .libcv{flex:1; position:relative; border-right:1px solid var(--border);}
  .libcv canvas{position:absolute; inset:0; width:100%; height:100%; display:block;}
  .libcv .cvtitle{position:absolute; top:6px; left:10px; z-index:2; font-size:11px; color:var(--fg-dim);}
</style>
</head>
<body>
<div id="header">
  <h1>AltiumPCBMirror — Hub</h1>
  <div id="tabs">
    <div class="tab active" data-v="projects">Projetos</div>
    <div class="tab" data-v="sch">Esquema</div>
    <div class="tab" data-v="pcb">PCB</div>
    <div class="tab" data-v="libs">Libs</div>
  </div>
  <span id="curproj">nenhum projeto aberto</span>
</div>

<div id="view-projects" class="view active">
  <div id="cards"></div>
  <div id="howto">
    <b>Fluxo projeto novo:</b> 1) rode <b>ExportLibs</b> no Altium (espelha suas bibliotecas) ·
    2) peça o projeto à IA (ela cria <b>Projects\&lt;nome&gt;\schematic.js</b>) · 3) confira aqui na vista
    <b>Esquema</b> · 4) no Altium: crie um .PrjPcb com o mesmo nome e rode <b>BuildSchematic</b> ·
    5) Compile + <b>Design » Update PCB</b> (ECO) · 6) rode <b>ExportBoard</b>, a IA roteia no
    <b>changes.js</b>, confira na vista <b>PCB</b> · 7) rode <b>ApplyChanges</b> + DRC.
  </div>
</div>

<div id="view-sch" class="view"><iframe id="schframe" src="about:blank"></iframe></div>
<div id="view-pcb" class="view"><iframe id="pcbframe" src="about:blank"></iframe></div>

<div id="view-libs" class="view">
  <div id="libleft">
    <input id="libsearch" placeholder="buscar símbolo ou footprint...">
    <div id="liblist"></div>
  </div>
  <div id="libmain">
    <div id="libwarn"></div>
    <div id="libcanvases">
      <div class="libcv"><span class="cvtitle" id="symtitle">símbolo</span><canvas id="cvsym"></canvas></div>
      <div class="libcv"><span class="cvtitle" id="fptitle">footprint</span><canvas id="cvfp"></canvas></div>
    </div>
  </div>
</div>

<script src="hub-core.js"></script>
<script src="hub-draw.js"></script>
<script src="projects.js"></script>
<script src="hub-ui.js"></script>
</body>
</html>
```

- [ ] **Step 2: Criar `hub-ui.js`**:

```js
/* AltiumPCBMirror v2 - hub-ui.js — logica do shell (Projetos + Libs + tabs). */
"use strict";
(function(){

const PROJECTS = (typeof projects !== 'undefined' && Array.isArray(projects)) ? projects : [];
let current = null;          // nome do projeto aberto
let schlibData = null, pcblibData = null, libsLoading = null;

/* ---------- carregamento dinamico de "var X = ..." via <script> (funciona em file://) ---------- */
function loadVarScript(src, name){
  return new Promise(resolve => {
    window[name] = undefined;
    const s = document.createElement('script');
    s.src = src;
    s.onload  = () => { const v = window[name]; window[name] = undefined; s.remove(); resolve(v); };
    s.onerror = () => { s.remove(); resolve(undefined); };
    document.head.appendChild(s);
  });
}
function loadLibs(){
  if (schlibData) return Promise.resolve();
  if (libsLoading) return libsLoading;
  libsLoading = Promise.all([
    loadVarScript('Libs/schlib.js', 'schlib'),
    loadVarScript('Libs/pcblib.js', 'pcblib')
  ]).then(([s, p]) => { schlibData = s || { symbols:[] }; pcblibData = p || { footprints:[] }; });
  return libsLoading;
}

/* ---------- tabs ---------- */
const views = { projects:'view-projects', sch:'view-sch', pcb:'view-pcb', libs:'view-libs' };
function showView(v){
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.v === v));
  for (const k in views) document.getElementById(views[k]).classList.toggle('active', k === v);
  if (v === 'libs') loadLibs().then(buildLibList);
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.v)));

/* ---------- Projetos ---------- */
const STEP_ORDER = ['esquema', 'eco', 'roteada', 'aplicada'];
function stepsHtml(status){
  const idx = STEP_ORDER.indexOf(status);
  return '<div class="steps">' + STEP_ORDER.map((s, i) =>
    `<span class="step ${i < idx ? 'done' : i === idx ? 'cur' : ''}">${s}</span>`).join('') + '</div>';
}
function openProject(name, view){
  current = name;
  document.getElementById('curproj').textContent = 'projeto: ' + name;
  document.getElementById('schframe').src = 'schframe.html?p=' + encodeURIComponent(name);
  document.getElementById('pcbframe').src = 'pcbframe.html?p=' + encodeURIComponent(name);
  showView(view || 'sch');
}
function buildCards(){
  const wrap = document.getElementById('cards');
  wrap.innerHTML = '';
  if (!PROJECTS.length)
    wrap.innerHTML = '<div style="color:var(--fg-dim)">Nenhum projeto em Projects\\ — rode um Export no Altium ou peça um projeto novo à IA.</div>';
  for (const p of PROJECTS) {
    const card = document.createElement('div');
    card.className = 'card';
    const demo = p.name.charAt(0) === '_' ? '<span class="badge">DEMO</span>' : '';
    card.innerHTML = `<h3>${p.name} ${demo}</h3>` +
      stepsHtml(HubCore.deriveStatus(p)) +
      `<div class="info" id="info-${p.name}">carregando resumo…</div>` +
      `<div class="actions">
         <button data-a="sch">Esquema</button>
         <button data-a="pcb">PCB</button>
       </div>`;
    card.querySelector('[data-a="sch"]').addEventListener('click', () => openProject(p.name, 'sch'));
    card.querySelector('[data-a="pcb"]').addEventListener('click', () => openProject(p.name, 'pcb'));
    wrap.appendChild(card);
    fillCardInfo(p);
  }
}
async function fillCardInfo(p){
  const el = document.getElementById('info-' + p.name);
  const parts = [];
  let changesCount = 0;
  if (p.files && p.files.schematic) {
    const sch = await loadVarScript('Projects/' + p.name + '/schematic.js', 'schematic');
    if (sch) {
      await loadLibs();
      const model = HubCore.buildSchModel(sch);
      const nets = HubCore.extractNets(model, schlibData);
      const nc = model.sheets.reduce((n, s) => n + s.comps.length, 0);
      parts.push(`esquema: ${model.sheets.length} folha(s), ${nc} comps, ${nets.nets.length} nets`);
    }
  }
  if (p.files && p.files.board) {
    const b = await loadVarScript('Projects/' + p.name + '/board.js', 'pcbmirror');
    if (b && b.stats) parts.push(`pcb: ${b.stats.components} comps, ${b.stats.tracks} trilhas, ${b.stats.vias} vias`);
  }
  if (p.files && p.files.changes) {
    const ch = await loadVarScript('Projects/' + p.name + '/changes.js', 'changes');
    changesCount = Array.isArray(ch) ? ch.length : 0;
    if (changesCount) parts.push(`mudanças pendentes: ${changesCount}`);
  }
  el.textContent = parts.join('\n') || 'sem dados ainda';
  const card = el.closest('.card');
  card.querySelector('.steps').outerHTML = stepsHtml(HubCore.deriveStatus(p, { changesCount }));
}

/* ---------- Libs ---------- */
let libSel = null, camSym = null, camFp = null, curFp = null;
function libItems(){
  const q = (document.getElementById('libsearch').value || '').toLowerCase();
  const syms = (schlibData.symbols || []).filter(s => !q || s.name.toLowerCase().includes(q) || (s.description||'').toLowerCase().includes(q));
  const fps  = (pcblibData.footprints || []).filter(f => !q || f.name.toLowerCase().includes(q) || (f.description||'').toLowerCase().includes(q));
  return { syms, fps };
}
function buildLibList(){
  const { syms, fps } = libItems();
  const list = document.getElementById('liblist');
  list.innerHTML = `<div class="libitem" style="color:var(--fg-dim)">— SÍMBOLOS (${syms.length}) —</div>`;
  for (const s of syms) {
    const div = document.createElement('div');
    div.className = 'libitem' + (libSel === 's:' + s.name ? ' sel' : '');
    const noFp = !(s.footprints || []).some(f => f.incurrentlib);
    div.innerHTML = s.name + (noFp ? ' <span class="miss">✖ sem footprint</span>' : '');
    div.addEventListener('click', () => { libSel = 's:' + s.name; buildLibList(); showSymbol(s); });
    list.appendChild(div);
  }
  const t = document.createElement('div');
  t.className = 'libitem'; t.style.color = 'var(--fg-dim)';
  t.textContent = `— FOOTPRINTS (${fps.length}) —`;
  list.appendChild(t);
  for (const f of fps) {
    const div = document.createElement('div');
    div.className = 'libitem' + (libSel === 'f:' + f.name ? ' sel' : '');
    div.textContent = f.name;
    div.addEventListener('click', () => { libSel = 'f:' + f.name; buildLibList(); showFootprint(f); });
    list.appendChild(div);
  }
  const missing = (schlibData.symbols || []).filter(s => !(s.footprints || []).some(f => f.incurrentlib));
  document.getElementById('libwarn').textContent = missing.length
    ? '✖ símbolos sem footprint na PcbLib (a IA define no schematic.js): ' + missing.map(s => s.name).join(', ')
    : '✓ todos os símbolos têm footprint associado';
}
function ensureCams(){
  if (!camSym) {
    camSym = HubDraw.mkCamera(document.getElementById('cvsym'), (ctx) => {
      if (!showSymbol.cur) return;
      HubDraw.drawSymbolPart(ctx, showSymbol.cur);
    }, { bg:'#fffef2' });
    camFp = HubDraw.mkCamera(document.getElementById('cvfp'), (ctx) => {
      if (curFp) HubDraw.drawFootprint(ctx, curFp);
    }, { bg:'#1b1b1b' });
    camSym.resize(); camFp.resize();
  }
}
function showSymbol(sym){
  ensureCams();
  const part = HubCore.partOf(sym, 1) || { pins:[], graphics:[] };
  showSymbol.cur = part;
  document.getElementById('symtitle').textContent =
    `símbolo: ${sym.name} (${sym.partcount} parte${sym.partcount > 1 ? 's' : ''}) — ${sym.description || ''}`;
  camSym.resize(); camSym.fit(HubDraw.symBBox(part), 1.4);
  const cur = (sym.footprints || []).find(f => f.current) || (sym.footprints || [])[0];
  const fp = cur && HubCore.footprintOf(pcblibData, cur.name);
  curFp = fp || null;
  document.getElementById('fptitle').textContent = fp
    ? `footprint associado: ${fp.name}` : 'footprint: (nenhum associado na lib)';
  camFp.resize();
  if (fp) camFp.fit(fp.bbox, 1.5); else camFp.draw();
}
function showFootprint(fp){
  ensureCams();
  showSymbol.cur = null;
  curFp = fp;
  document.getElementById('symtitle').textContent = 'símbolo: —';
  document.getElementById('fptitle').textContent = `footprint: ${fp.name} — ${fp.description || ''}`;
  camSym.resize(); camSym.draw();
  camFp.resize(); camFp.fit(fp.bbox, 1.5);
}
document.getElementById('libsearch').addEventListener('input', buildLibList);

/* ---------- init ---------- */
buildCards();

})();
```

- [ ] **Step 3: Validar** — `node --check hub-ui.js` (exit 0).

- [ ] **Step 4: Verificação manual** — abrir `Z:\AltiumPCBMirror\hub.html` no navegador: card `_DemoKit` com badge DEMO, esteira em "roteada" (3 mudanças pendentes), resumo com "1 folha(s), 4 comps, 3 nets"; vista Libs lista 4 símbolos + 4 footprints, `LED` com "✖ sem footprint", clique em `RES` desenha símbolo à esquerda e `R0805` à direita. (Abas Esquema/PCB ficam em branco até as Tasks 8/9.)

- [ ] **Step 5: Commit**

```powershell
git add hub.html hub-ui.js
git commit -m @'
hub.html + hub-ui.js: shell com vistas Projetos (historico) e Libs

Cards com esteira de status e resumo carregado dinamicamente; navegador
das bibliotecas com aviso de simbolos sem footprint.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 8: `schframe.html` + `schframe.js` — vista Esquema

Renderiza `Projects/<p>/schematic.js` fiel à folha do Altium (mil, Y para cima, tema claro): símbolos reais da schlib, fios, junctions (explícitas + automáticas), net labels, power ports, designator/comment. Clique destaca a net inteira; painel lateral com componentes, nets e validação.

**Files:**
- Create: `schframe.html`
- Create: `schframe.js`

- [ ] **Step 1: Criar `schframe.html`**:

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>AltiumPCBMirror — Esquema</title>
<style>
  :root{ --bg:#1b1b1b; --panel:#242424; --panel2:#2d2d2d; --border:#3a3a3a;
    --fg:#d8d8d8; --fg-dim:#9a9a9a; --accent:#4fc3f7; --warn:#ffd54f; --err:#ff5252; --ok:#00e676; }
  *{box-sizing:border-box; margin:0; padding:0;}
  html,body{height:100%; overflow:hidden;}
  body{background:var(--bg); color:var(--fg); font:13px/1.45 "Segoe UI",sans-serif; display:flex; flex-direction:column;}
  #bar{display:flex; align-items:center; gap:8px; height:36px; padding:0 10px;
    background:var(--panel); border-bottom:1px solid var(--border);}
  #bar .meta{color:var(--fg-dim); font-size:12px;}
  button{background:var(--panel2); color:var(--fg); border:1px solid var(--border);
    border-radius:3px; padding:3px 10px; font-size:12px; cursor:pointer;}
  button:hover{border-color:var(--accent);}
  button.active{background:#0d47a1; color:#fff;}
  select{background:var(--panel2); color:var(--fg); border:1px solid var(--border); border-radius:3px; padding:3px;}
  #main{flex:1; display:flex; min-height:0;}
  #cvwrap{flex:1; position:relative;}
  canvas{position:absolute; inset:0; width:100%; height:100%; display:block; cursor:crosshair;}
  #side{width:330px; min-width:280px; background:var(--panel); border-left:1px solid var(--border);
    overflow-y:auto;}
  .sec{padding:8px 10px; border-bottom:1px solid var(--border);}
  .sec h2{font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--fg-dim); margin-bottom:6px;}
  table{border-collapse:collapse; width:100%; font-size:11px;}
  th,td{padding:2px 5px; text-align:left; border-bottom:1px solid #333; white-space:nowrap;}
  tbody tr{cursor:pointer;}
  tbody tr:hover{background:#333;}
  tbody tr.sel{background:#0d47a1;}
  .netitem,.valitem{padding:3px 6px; margin:2px 0; border-radius:3px; background:var(--panel2);
    cursor:pointer; font-size:11px; border-left:3px solid transparent;}
  .netitem.sel{background:#0d47a1; color:#fff;}
  .valitem.err{border-left-color:var(--err);}
  .valitem.warn{border-left-color:var(--warn);}
  #status{height:24px; display:flex; gap:16px; align-items:center; padding:0 10px;
    background:var(--panel); border-top:1px solid var(--border);
    font:12px Consolas,monospace; color:var(--fg-dim);}
  #status b{color:var(--fg); font-weight:normal;}
  #fatal{position:absolute; inset:0; display:none; align-items:center; justify-content:center;
    color:var(--err); font-size:14px; text-align:center; padding:30px; background:var(--bg); z-index:5;}
</style>
</head>
<body>
<div id="bar">
  <b style="color:var(--accent); font-size:13px;">Esquema</b>
  <select id="sheetsel"></select>
  <button id="btnFit">Fit</button>
  <button id="btnGrid" class="active">Grade</button>
  <span class="meta" id="meta"></span>
</div>
<div id="main">
  <div id="cvwrap"><canvas id="cv"></canvas><div id="fatal"></div></div>
  <aside id="side">
    <div class="sec"><h2>Componentes</h2>
      <table id="comptable"><thead><tr><th>Ref</th><th>Símbolo</th><th>Footprint</th><th>Comment</th></tr></thead><tbody></tbody></table>
    </div>
    <div class="sec"><h2>Nets (<span id="netcount">0</span>)</h2><div id="netlist"></div></div>
    <div class="sec"><h2>Validação</h2><div id="vallist"></div></div>
  </aside>
</div>
<div id="status">
  <span>X: <b id="sx">—</b> Y: <b id="sy">—</b> mil</span>
  <span id="shover"></span>
</div>
<script src="hub-core.js"></script>
<script src="hub-draw.js"></script>
<script src="Libs/schlib.js"></script>
<script src="Libs/pcblib.js"></script>
<script>
  var SCH_P = new URLSearchParams(location.search).get('p') || '_DemoKit';
  document.write('<script src="Projects/' + SCH_P + '/schematic.js"><\/script>');
</script>
<script src="schframe.js"></script>
</body>
</html>
```

- [ ] **Step 2: Criar `schframe.js`**:

```js
/* AltiumPCBMirror v2 - schframe.js — vista Esquema (le globals: schematic, schlib, pcblib). */
"use strict";
(function(){

const fatal = m => { const f = document.getElementById('fatal'); f.style.display = 'flex'; f.textContent = m; };
if (typeof schematic === 'undefined') { fatal('schematic.js não encontrado para o projeto "' + SCH_P + '".'); return; }
const SLIB = typeof schlib  !== 'undefined' ? schlib  : { symbols:[] };
const PLIB = typeof pcblib  !== 'undefined' ? pcblib  : { footprints:[] };

const model = HubCore.buildSchModel(schematic);
const nets  = HubCore.extractNets(model, SLIB);
const val   = HubCore.validateSchematic(schematic, SLIB, PLIB);
let sheetIdx = 0, selNet = '', selComp = null;
const showState = { grid:true };

document.getElementById('meta').textContent =
  `${schematic.project} · ${model.sheets.length} folha(s) · ${nets.nets.length} nets`;

/* ---------- desenho ---------- */
const D = HubDraw;
function sheetBBox(){
  const s = model.sheets[sheetIdx];
  const sz = HubCore.SHEET_SIZES[s.size] || HubCore.SHEET_SIZES.A4;
  return { x1:0, y1:0, x2:sz[0], y2:sz[1] };
}
function drawWorld(ctx, cam){
  const s = model.sheets[sheetIdx];
  const bb = sheetBBox();
  ctx.fillStyle = D.SCH.sheet;
  ctx.fillRect(bb.x1, bb.y1, bb.x2-bb.x1, bb.y2-bb.y1);
  if (showState.grid && cam.scale > 0.045) {
    ctx.strokeStyle = D.SCH.grid; ctx.lineWidth = 1/cam.scale;
    ctx.beginPath();
    for (let x = 0; x <= bb.x2; x += 100) { ctx.moveTo(x, 0); ctx.lineTo(x, bb.y2); }
    for (let y = 0; y <= bb.y2; y += 100) { ctx.moveTo(0, y); ctx.lineTo(bb.x2, y); }
    ctx.stroke();
  }
  ctx.strokeStyle = D.SCH.border; ctx.lineWidth = 8;
  ctx.strokeRect(bb.x1, bb.y1, bb.x2-bb.x1, bb.y2-bb.y1);

  /* fios */
  s.wires.forEach((w, wi) => {
    const hl = selNet && nets.wireNet[sheetIdx][wi] === selNet;
    ctx.strokeStyle = hl ? D.SCH.hl : D.SCH.wire;
    ctx.lineWidth = hl ? 14 : 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    (w.pts || []).forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.stroke();
  });
  /* junctions explicitas + automaticas */
  for (const j of s.junctions) D.drawJunction(ctx, j.x, j.y);
  for (const j of nets.autoJunctions) if (j.sheet === sheetIdx) D.drawJunction(ctx, j.x, j.y);

  /* componentes */
  for (const c of s.comps) {
    const sym = HubCore.symbolOf(SLIB, c.sym);
    const part = HubCore.partOf(sym, c.part);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(((((c.rot||0)%360)+360)%360) * Math.PI/180);
    if (c.mirror) ctx.scale(-1, 1);
    if (part) D.drawSymbolPart(ctx, part, { stroke: selComp === c.ref ? D.SCH.hl : undefined });
    else { ctx.strokeStyle = '#ff5252'; ctx.strokeRect(-100, -100, 200, 200); }
    ctx.restore();
    const bbref = part ? D.symBBox(part) : { x1:-100, y1:-100, x2:100, y2:100 };
    D.worldText(ctx, c.ref, c.x, c.y + Math.max(Math.abs(bbref.y1), Math.abs(bbref.y2)) + 70, 60, 0,
      selComp === c.ref ? D.SCH.hl : '#000000', 'center');
    if (c.comment)
      D.worldText(ctx, c.comment, c.x, c.y - Math.max(Math.abs(bbref.y1), Math.abs(bbref.y2)) - 70, 55, 0, '#333366', 'center');
  }
  /* pinos destacados da net selecionada */
  if (selNet) {
    for (const c of s.comps) {
      const pins = HubCore.compPinsWorld(c, SLIB) || [];
      for (const p of pins)
        if (nets.pinNet[c.ref + '-' + p.num] === selNet) {
          ctx.strokeStyle = D.SCH.hl; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(p.x, p.y, 35, 0, 2*Math.PI); ctx.stroke();
        }
    }
  }
  /* rotulos e power */
  for (const l of s.netlabels) D.drawNetLabel(ctx, l, selNet === l.net ? D.SCH.hl : undefined);
  for (const p of s.powers)    D.drawPowerPort(ctx, p, selNet === p.net ? D.SCH.hl : undefined);
  for (const t of s.texts)     D.worldText(ctx, t.s || '', t.x, t.y, (t.h || 10) * 6, t.rot || 0, D.SCH.text, 'left');
}
const cam = D.mkCamera(document.getElementById('cv'), drawWorld, {
  bg:'#3a3a34',
  onMove: w => {
    document.getElementById('sx').textContent = w.x.toFixed(0);
    document.getElementById('sy').textContent = w.y.toFixed(0);
    const h = hitTest(w.x, w.y);
    document.getElementById('shover').textContent =
      h ? (h.kind === 'pin' ? `${h.ref}-${h.num} · ${nets.pinNet[h.ref + '-' + h.num] || 'sem net'}`
                            : h.kind === 'wire' ? (nets.wireNet[sheetIdx][h.wi] || 'fio') : h.ref) : '';
  },
  onClick: w => {
    const h = hitTest(w.x, w.y);
    if (!h) { setNet(''); setComp(null); return; }
    if (h.kind === 'pin')  { setComp(h.ref); setNet(nets.pinNet[h.ref + '-' + h.num] || ''); }
    if (h.kind === 'wire') setNet(nets.wireNet[sheetIdx][h.wi] || '');
    if (h.kind === 'comp') { setComp(h.ref); setNet(''); }
  }
});

function hitTest(x, y){
  const s = model.sheets[sheetIdx];
  const tol = 8 / cam.cam.scale;
  for (const c of s.comps) {
    const pins = HubCore.compPinsWorld(c, SLIB) || [];
    for (const p of pins)
      if (Math.hypot(x - p.x, y - p.y) <= Math.max(tol, 30)) return { kind:'pin', ref:c.ref, num:p.num };
  }
  for (let wi = 0; wi < s.wires.length; wi++) {
    const pts = s.wires[wi].pts || [];
    for (let i = 0; i < pts.length - 1; i++)
      if (HubCore.distSeg(x, y, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]) <= Math.max(tol, 20))
        return { kind:'wire', wi };
  }
  for (const c of s.comps) {
    const sym = HubCore.symbolOf(SLIB, c.sym);
    const part = HubCore.partOf(sym, c.part);
    const bb = part ? D.symBBox(part) : { x1:-100, y1:-100, x2:100, y2:100 };
    const r = Math.max(bb.x2 - bb.x1, bb.y2 - bb.y1) / 2 + 50;
    if (Math.hypot(x - c.x, y - c.y) <= r) return { kind:'comp', ref:c.ref };
  }
  return null;
}

/* ---------- paineis ---------- */
function setNet(n){ selNet = n; buildNetList(); cam.draw(); }
function setComp(r){ selComp = r; buildCompTable(); cam.draw(); }
function buildCompTable(){
  const tb = document.querySelector('#comptable tbody');
  tb.innerHTML = '';
  for (const s of model.sheets) for (const c of s.comps) {
    const tr = document.createElement('tr');
    if (c.ref === selComp) tr.className = 'sel';
    tr.innerHTML = `<td>${c.ref}</td><td>${c.sym}</td><td>${c.footprint || '—'}</td><td>${c.comment || ''}</td>`;
    tr.addEventListener('click', () => {
      selComp = c.ref; buildCompTable();
      cam.fit({ x1:c.x-800, y1:c.y-800, x2:c.x+800, y2:c.y+800 });
    });
    tb.appendChild(tr);
  }
}
function buildNetList(){
  document.getElementById('netcount').textContent = nets.nets.length;
  const list = document.getElementById('netlist');
  list.innerHTML = '';
  for (const n of nets.nets) {
    const div = document.createElement('div');
    div.className = 'netitem' + (n.name === selNet ? ' sel' : '');
    div.textContent = `${n.name}${n.auto ? ' (auto)' : ''} — ${n.pins.join(', ')}`;
    div.addEventListener('click', () => setNet(n.name === selNet ? '' : n.name));
    list.appendChild(div);
  }
}
function buildValList(){
  const list = document.getElementById('vallist');
  list.innerHTML = '';
  const items = val.errors.map(m => ({ level:'err', m }))
    .concat(val.warnings.map(m => ({ level:'warn', m })))
    .concat(nets.warnings.map(m => ({ level:'warn', m })));
  if (!items.length) { list.innerHTML = '<div style="color:var(--ok)">✓ sem problemas</div>'; return; }
  for (const it of items) {
    const div = document.createElement('div');
    div.className = 'valitem ' + it.level;
    div.textContent = it.m;
    list.appendChild(div);
  }
}
function buildSheetSel(){
  const sel = document.getElementById('sheetsel');
  sel.innerHTML = '';
  model.sheets.forEach((s, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = `folha: ${s.name} (${s.size})`;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => { sheetIdx = +sel.value; cam.fit(sheetBBox()); });
}

document.getElementById('btnFit').addEventListener('click', () => cam.fit(sheetBBox()));
document.getElementById('btnGrid').addEventListener('click', e => {
  showState.grid = !showState.grid; e.target.classList.toggle('active'); cam.draw();
});

buildSheetSel(); buildCompTable(); buildNetList(); buildValList();
cam.resize(); cam.fit(sheetBBox());

})();
```

- [ ] **Step 3: Validar** — `node --check schframe.js` (exit 0).

- [ ] **Step 4: Verificação manual** — abrir `schframe.html?p=_DemoKit` (ou a aba Esquema do hub): folha A4 clara com grade de 100 mil, 4 símbolos desenhados (P1 espelhado com pinos para a direita), fios azuis, 3 power GND, labels VCC/NET_LED, junction em (1800,3100); clicar num fio pinta a net inteira de laranja e destaca os pinos membros; painel mostra 3 nets e validação "✓ sem problemas".

- [ ] **Step 5: Commit**

```powershell
git add schframe.html schframe.js
git commit -m @'
schframe: vista Esquema fiel (simbolos da lib, fios, nets, validacao)

Destaque de net por clique, tabela de componentes, folha A4 com grade 100 mil.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 9: `pcbframe.html` — vista PCB por projeto (derivada do viewer)

Reuso máximo: `pcbframe.html` é uma CÓPIA de `viewer.html` com uma única mudança — em vez de carregar `board.js`/`changes.js` fixos da pasta atual, carrega `Projects/<p>/…` conforme o parâmetro `?p=`. Toda a renderização/diff/PCB List/validação do v1 fica intacta. `viewer.html` original permanece no repo (o `example\` usa).

**Files:**
- Create: `pcbframe.html` (cópia modificada de `viewer.html`)

- [ ] **Step 1: Copiar** `viewer.html` → `pcbframe.html` (cópia binária idêntica):

```powershell
Copy-Item viewer.html pcbframe.html
```

- [ ] **Step 2: Editar `pcbframe.html`** — substituir EXATAMENTE as duas linhas (154-155 no arquivo original):

```html
<script src="board.js"></script>
<script src="changes.js"></script>
```

por:

```html
<script>
  var PCB_P = new URLSearchParams(location.search).get('p');
  if (PCB_P) {
    document.write('<script src="Projects/' + PCB_P + '/board.js"><\/script>');
    document.write('<script src="Projects/' + PCB_P + '/changes.js"><\/script>');
  } else {
    document.write('<script src="board.js"><\/script>');
    document.write('<script src="changes.js"><\/script>');
  }
</script>
```

- [ ] **Step 3: Trocar o `<title>`** de `AltiumPCBMirror — Viewer` para `AltiumPCBMirror — PCB`.

- [ ] **Step 4: Verificação manual** — abrir `pcbframe.html?p=_DemoKit` (ou a aba PCB do hub): placa 30x20 renderizada, D1 com fantasma tracejado (movido para y=11), trilha nova verde no GND, via de costura, PCB List com células amarelas nas mudanças.

- [ ] **Step 5: Commit**

```powershell
git add pcbframe.html
git commit -m @'
pcbframe.html: vista PCB por projeto (viewer v1 + loader ?p=)

Reuso integral do viewer; board/changes carregados de Projects/<nome>/.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Bloco PROJ-HELPERS (usado pelas Tasks 10-14)

Unidades DelphiScript não compartilham código: **cole este bloco inteiro** em cada script que o referencia (ExportProject, BuildSchematic, ExportBoard, ApplyChanges — ExportLibs não precisa). Ele requer as constantes `SCRIPT_HOME`/`PROJECTS_DIR` e os helpers `JS`/`JB` presentes no mesmo arquivo.

```pascal
{ ======================= PROJ-HELPERS (workspace central) ======================= }

// nome do arquivo sem pasta e sem extensao
function BaseName(Path: String): String;
var
  s: String;
  p: Integer;
begin
  s := ExtractFileName(Path);
  p := Length(s);
  while (p > 0) and (s[p] <> '.') do
    p := p - 1;
  if p > 1 then
    s := Copy(s, 1, p - 1);
  Result := s;
end;

// StrToInt sem excecao (0 se invalido)
function SafeStrToInt(s: String): Integer;
var
  i: Integer;
begin
  Result := 0;
  s := Trim(s);
  if s = '' then
    Exit;
  for i := 1 to Length(s) do
  begin
    if (Ord(s[i]) < 48) or (Ord(s[i]) > 57) then
    begin
      Result := 0;
      Exit;
    end;
    Result := Result * 10 + (Ord(s[i]) - 48);
  end;
end;

// preenche Dirs com os nomes das subpastas de Projects\
procedure ListProjectDirs(Dirs: TStringList);
var
  SR: TSearchRec;
  r: Integer;
begin
  Dirs.Clear;
  r := FindFirst(PROJECTS_DIR + '\*', faDirectory, SR);
  while r = 0 do
  begin
    if ((SR.Attr and faDirectory) <> 0) and (SR.Name <> '.') and (SR.Name <> '..') then
      Dirs.Add(SR.Name);
    r := FindNext(SR);
  end;
  FindClose(SR);
end;

// nome do projeto focado no Workspace ('' se nenhum / Free Documents)
function FocusedProjectName: String;
var
  WS: IWorkspace;
  Prj: IProject;
begin
  Result := '';
  WS := GetWorkspace;
  if WS = nil then
    Exit;
  Prj := WS.DM_FocusedProject;
  if Prj = nil then
    Exit;
  Result := BaseName(Prj.DM_ProjectFileName);
  if Result = 'Free Documents' then
    Result := '';
end;

// Casa WantedName com uma pasta de Projects\ (case-insensitive).
// Nao achou: CreateIfMissing cria; senao pergunta com lista numerada. '' = cancelado.
function ResolveProjectDir(WantedName: String; CreateIfMissing: Boolean): String;
var
  Dirs: TStringList;
  i, Choice: Integer;
  ListStr, Answer: String;
begin
  Result := '';
  ForceDirectories(PROJECTS_DIR);
  Dirs := TStringList.Create;
  ListProjectDirs(Dirs);
  Dirs.Sort;
  if WantedName <> '' then
    for i := 0 to Dirs.Count - 1 do
      if AnsiCompareText(Dirs[i], WantedName) = 0 then
      begin
        Result := PROJECTS_DIR + '\' + Dirs[i];
        Dirs.Free;
        Exit;
      end;
  if CreateIfMissing and (WantedName <> '') then
  begin
    Result := PROJECTS_DIR + '\' + WantedName;
    ForceDirectories(Result);
    Dirs.Free;
    Exit;
  end;
  if Dirs.Count = 0 then
  begin
    ShowMessage('Nenhum projeto em ' + PROJECTS_DIR + '.' + #13#10 +
      'Rode um export ou peca um projeto novo a IA primeiro.');
    Dirs.Free;
    Exit;
  end;
  ListStr := 'Projeto "' + WantedName + '" nao encontrado em Projects\.' + #13#10 +
    'Digite o NUMERO do projeto a usar:' + #13#10;
  for i := 0 to Dirs.Count - 1 do
    ListStr := ListStr + IntToStr(i + 1) + ' = ' + Dirs[i] + #13#10;
  Answer := InputBox('AltiumPCBMirror', ListStr, '1');
  Choice := SafeStrToInt(Answer);
  if (Choice >= 1) and (Choice <= Dirs.Count) then
    Result := PROJECTS_DIR + '\' + Dirs[Choice - 1];
  Dirs.Free;
end;

// Regenera o indice projects.js varrendo Projects\
procedure RegenerateProjectsIndex;
var
  Dirs, Ou: TStringList;
  i: Integer;
  d, line: String;
begin
  Dirs := TStringList.Create;
  ListProjectDirs(Dirs);
  Dirs.Sort;
  Ou := TStringList.Create;
  Ou.Add('var projects = [');
  for i := 0 to Dirs.Count - 1 do
  begin
    d := PROJECTS_DIR + '\' + Dirs[i];
    line := '{"name":' + JS(Dirs[i]) +
      ',"files":{"schematic":' + JB(FileExists(d + '\schematic.js')) +
      ',"board":' + JB(FileExists(d + '\board.js')) +
      ',"changes":' + JB(FileExists(d + '\changes.js')) +
      ',"buildreport":' + JB(FileExists(d + '\build-report.txt')) +
      ',"applyreport":' + JB(FileExists(d + '\apply-report.txt')) + '}' +
      ',"indexed":' + JS(DateTimeToStr(Now)) + '}';
    if i < Dirs.Count - 1 then
      line := line + ',';
    Ou.Add(line);
  end;
  Ou.Add('];');
  Ou.SaveToFile(SCRIPT_HOME + '\projects.js');
  Ou.Free;
  Dirs.Free;
end;
{ ===================== fim PROJ-HELPERS ===================== }
```

---

### Task 10: `ExportLibs.pas` — espelho das bibliotecas

Abre a SchLib e a PcbLib do usuário pelos caminhos fixos, gera `Libs\schlib.js` + `Libs\pcblib.js` (formatos exatos das fixtures da Task 1) e `Libs\libs-report.txt` com os símbolos sem footprint. Corpos 3D não são exportados (filtro só pega Pad/Track/Arc). Sem verificação executável (não há Altium no build) — o critério é seguir estritamente os idiomas listados no "Contexto essencial".

**Files:**
- Create: `ExportLibs.pas`
- Modify: `AltiumPCBMirror.PrjScr` (adicionar Document3)

- [ ] **Step 1: Criar `ExportLibs.pas`** com o conteúdo completo:

```pascal
{ ..................................................................................................................... }
{ .  AltiumPCBMirror - ExportLibs.pas                                                                                 . }
{ .                                                                                                                   . }
{ .  Espelha as bibliotecas do usuario para o workspace central:                                                      . }
{ .    Libs\schlib.js   : simbolos (pinos, graficos, modelos de footprint) - unidade: MIL                             . }
{ .    Libs\pcblib.js   : footprints (pads, silk, bbox) - unidade: MM (corpos 3D ficam de fora)                       . }
{ .    Libs\libs-report.txt : simbolos sem footprint valido na PcbLib                                                 . }
{ .                                                                                                                   . }
{ .  Rode de novo sempre que alterar as bibliotecas. Se der erro de servidor, abra as duas                            . }
{ .  bibliotecas no Altium (File >> Open) e rode novamente.                                                           . }
{ .                                                                                                                   . }
{ .  Como executar: DXP >> Run Script >> ExportLibs                                                                   . }
{ ..................................................................................................................... }

const
  // AJUSTE AQUI se as bibliotecas mudarem de lugar.
  SCRIPT_HOME = 'Z:\AltiumPCBMirror';
  OUT_DIR = 'Z:\AltiumPCBMirror\Libs';
  SCHLIB_FILE = 'Z:\Biblioteca\ALTIUM LIBRARY ------ LUCAS\BIBLIOTECA DE ESQUEMA.SchLib';
  PCBLIB_FILE = 'Z:\Biblioteca\ALTIUM LIBRARY ------ LUCAS\BIBLIOTECA DE FOOTPRINT.PcbLib';

var
  FpNames: TStringList;   // nomes de footprint presentes na PcbLib (para o crosscheck)
  NoFpList: TStringList;  // simbolos sem footprint valido
  SymCount, FpCount: Integer;

{ ------------------------------- helpers JSON / numeros (copia do ExportBoard) ------------------------------- }

function JF(v: Double): String;
begin
  Result := StringReplace(FloatToStr(v), ',', '.', MkSet(rfReplaceAll, rfIgnoreCase));
end;

function JB(v: Boolean): String;
begin
  if v then
    Result := 'true'
  else
    Result := 'false';
end;

function JS(v: String): String;
var
  i: Integer;
  c: String;
begin
  Result := '"';
  for i := 1 to Length(v) do
  begin
    c := v[i];
    case Ord(v[i]) of
      34:
        Result := Result + '\"';
      92:
        Result := Result + '\\';
      8:
        Result := Result + '\b';
      9:
        Result := Result + '\t';
      10:
        Result := Result + '\n';
      12:
        Result := Result + '\f';
      13:
        Result := Result + '\r';
    else
      begin
        if (Ord(v[i]) < 32) or (Ord(v[i]) > 125) then
          Result := Result + '\u' + IntToHex(Ord(v[i]), 4)
        else
          Result := Result + c;
      end;
    end;
  end;
  Result := Result + '"';
end;

// coordenada interna -> mil (esquema) / mm (pcb)
function ML(v: Integer): String;
begin
  Result := JF(CoordToMils(v));
end;

function MM(v: Integer): String;
begin
  Result := JF(CoordToMMs(v));
end;

procedure AddItem(Section: TStringList; Line: String);
begin
  if Section.Count > 0 then
    Section.Add(',' + Line)
  else
    Section.Add(Line);
end;

{ ------------------------------- mapeamentos Sch ------------------------------- }

function RotDegOf(o: TRotationBy90): Integer;
begin
  Result := 0;
  if o = eRotate90 then
    Result := 90
  else if o = eRotate180 then
    Result := 180
  else if o = eRotate270 then
    Result := 270;
end;

function ElecName(e: TPinElectrical): String;
begin
  if e = eElectricInput then
    Result := 'Input'
  else if e = eElectricIO then
    Result := 'IO'
  else if e = eElectricOutput then
    Result := 'Output'
  else if e = eElectricOpenCollector then
    Result := 'OpenCollector'
  else if e = eElectricHiZ then
    Result := 'HiZ'
  else if e = eElectricOpenEmitter then
    Result := 'OpenEmitter'
  else if e = eElectricPower then
    Result := 'Power'
  else
    Result := 'Passive';
end;

// largura de linha do Sch (enum TSize) -> mil aproximado
function LineWMil(w: Integer): String;
begin
  if w <= 0 then
    Result := '4'
  else if w = 1 then
    Result := '10'
  else if w = 2 then
    Result := '20'
  else
    Result := '30';
end;

{ ------------------------------- serializacao SchLib ------------------------------- }

function PinJSON(Pin: TObject): String;
begin
  Result := '{"num":' + JS(Pin.Designator) +
    ',"name":' + JS(Pin.Name) +
    ',"x":' + ML(Pin.Location.X) +
    ',"y":' + ML(Pin.Location.Y) +
    ',"len":' + ML(Pin.PinLength) +
    ',"orient":' + IntToStr(RotDegOf(Pin.Orientation)) +
    ',"type":' + JS(ElecName(Pin.Electrical)) + '}';
end;

function GraphJSON(Prim: TObject): String;
var
  s: String;
  k: Integer;
begin
  Result := '';
  case Prim.ObjectId of
    eLine:
      Result := '{"g":"line","x1":' + ML(Prim.Location.X) + ',"y1":' + ML(Prim.Location.Y) +
        ',"x2":' + ML(Prim.Corner.X) + ',"y2":' + ML(Prim.Corner.Y) +
        ',"w":' + LineWMil(Prim.LineWidth) + '}';
    eRectangle:
      Result := '{"g":"rect","x1":' + ML(Prim.Location.X) + ',"y1":' + ML(Prim.Location.Y) +
        ',"x2":' + ML(Prim.Corner.X) + ',"y2":' + ML(Prim.Corner.Y) +
        ',"solid":' + JB(Prim.IsSolid) + '}';
    eArc:
      Result := '{"g":"arc","cx":' + ML(Prim.Location.X) + ',"cy":' + ML(Prim.Location.Y) +
        ',"r":' + ML(Prim.Radius) + ',"sa":' + JF(Prim.StartAngle) + ',"ea":' + JF(Prim.EndAngle) +
        ',"w":' + LineWMil(Prim.LineWidth) + '}';
    eEllipse:
      Result := '{"g":"ellipse","cx":' + ML(Prim.Location.X) + ',"cy":' + ML(Prim.Location.Y) +
        ',"rx":' + ML(Prim.Radius) + ',"ry":' + ML(Prim.SecondaryRadius) +
        ',"solid":' + JB(Prim.IsSolid) + '}';
    ePolygon:
      begin
        s := '';
        for k := 1 to Prim.VerticesCount do
        begin
          if s <> '' then
            s := s + ',';
          s := s + '[' + ML(Prim.Vertex[k].X) + ',' + ML(Prim.Vertex[k].Y) + ']';
        end;
        Result := '{"g":"poly","pts":[' + s + '],"solid":true}';
      end;
    ePolyline:
      begin
        s := '';
        for k := 1 to Prim.VerticesCount do
        begin
          if s <> '' then
            s := s + ',';
          s := s + '[' + ML(Prim.Vertex[k].X) + ',' + ML(Prim.Vertex[k].Y) + ']';
        end;
        Result := '{"g":"polyline","pts":[' + s + '],"w":' + LineWMil(Prim.LineWidth) + '}';
      end;
    eLabel:
      Result := '{"g":"label","x":' + ML(Prim.Location.X) + ',"y":' + ML(Prim.Location.Y) +
        ',"text":' + JS(Prim.Text) +
        ',"rot":' + IntToStr(RotDegOf(Prim.Orientation)) +
        ',"size":' + IntToStr(SchServer.FontManager.Size(Prim.FontID)) + '}';
  end;
end;

function SymbolJSON(Comp: TObject): String;
var
  PartsStr, PinsStr, GraphStr, FpStr, g: String;
  part, NP: Integer;
  Iter, Prim: TObject;
  HasFpInLib, HasAnyFp: Boolean;
begin
  NP := Comp.PartCount;
  if NP < 1 then
    NP := 1;

  PartsStr := '';
  for part := 1 to NP do
  begin
    PinsStr := '';
    GraphStr := '';
    Iter := Comp.SchIterator_Create;
    Iter.AddFilter_ObjectSet(MkSet(ePin, eLine, eRectangle, eArc, eEllipse, ePolygon, ePolyline, eLabel));
    Prim := Iter.FirstSchObject;
    while Prim <> nil do
    begin
      if ((Prim.OwnerPartId = part) or (Prim.OwnerPartId <= 0)) and (Prim.OwnerPartDisplayMode <= 0) then
      begin
        if Prim.ObjectId = ePin then
        begin
          if PinsStr <> '' then
            PinsStr := PinsStr + ',';
          PinsStr := PinsStr + PinJSON(Prim);
        end
        else
        begin
          g := GraphJSON(Prim);
          if g <> '' then
          begin
            if GraphStr <> '' then
              GraphStr := GraphStr + ',';
            GraphStr := GraphStr + g;
          end;
        end;
      end;
      Prim := Iter.NextSchObject;
    end;
    Comp.SchIterator_Destroy(Iter);
    if PartsStr <> '' then
      PartsStr := PartsStr + ',';
    PartsStr := PartsStr + '{"part":' + IntToStr(part) + ',"pins":[' + PinsStr + '],"graphics":[' + GraphStr + ']}';
  end;

  // modelos de footprint associados ao simbolo
  FpStr := '';
  HasFpInLib := False;
  HasAnyFp := False;
  Iter := Comp.SchIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eImplementation));
  Prim := Iter.FirstSchObject;
  while Prim <> nil do
  begin
    if UpperCase(Prim.ModelType) = 'PCBLIB' then
    begin
      HasAnyFp := True;
      if FpStr <> '' then
        FpStr := FpStr + ',';
      FpStr := FpStr + '{"name":' + JS(Prim.ModelName) +
        ',"incurrentlib":' + JB(FpNames.IndexOf(Prim.ModelName) >= 0) +
        ',"current":' + JB(Prim.IsCurrent) + '}';
      if FpNames.IndexOf(Prim.ModelName) >= 0 then
        HasFpInLib := True;
    end;
    Prim := Iter.NextSchObject;
  end;
  Comp.SchIterator_Destroy(Iter);

  if not HasFpInLib then
  begin
    if HasAnyFp then
      NoFpList.Add(Comp.LibReference + ' (modelo aponta p/ footprint fora da PcbLib)')
    else
      NoFpList.Add(Comp.LibReference + ' (sem modelo de footprint)');
  end;

  Result := '{"name":' + JS(Comp.LibReference) +
    ',"description":' + JS(Comp.ComponentDescription) +
    ',"partcount":' + IntToStr(NP) +
    ',"parts":[' + PartsStr + ']' +
    ',"footprints":[' + FpStr + ']}';
end;

{ ------------------------------- serializacao PcbLib ------------------------------- }

function FpPadJSON(Pad: TObject): String;
var
  s, PadType, PadShape, DrillShape: String;
  W, H: String;
  ShapeCode: Integer;
  Radius: String;
begin
  Radius := '';
  if Pad.Layer = eTopLayer then
  begin
    PadType := 'smd';
    W := MM(Pad.TopXSize);
    H := MM(Pad.TopYSize);
    ShapeCode := Pad.TopShape;
  end
  else if Pad.Layer = eBottomLayer then
  begin
    PadType := 'smd';
    W := MM(Pad.BotXSize);
    H := MM(Pad.BotYSize);
    ShapeCode := Pad.BotShape;
  end
  else
  begin
    PadType := 'th';
    W := MM(Pad.TopXSize);
    H := MM(Pad.TopYSize);
    ShapeCode := Pad.TopShape;
  end;

  PadShape := 'circle';
  case ShapeCode of
    1:
      begin
        if W = H then
          PadShape := 'circle'
        else
          PadShape := 'oval';
      end;
    2:
      PadShape := 'rect';
    3:
      PadShape := 'octagon';
    9:
      begin
        PadShape := 'roundrect';
        Radius := MM(Pad.CornerRadius(Pad.Layer));
      end;
  end;

  s := '{"name":' + JS(Pad.Name);
  s := s + ',"type":' + JS(PadType);
  s := s + ',"shape":' + JS(PadShape);
  if Radius <> '' then
    s := s + ',"radius":' + Radius;
  s := s + ',"x":' + MM(Pad.x);
  s := s + ',"y":' + MM(Pad.y);
  s := s + ',"w":' + W;
  s := s + ',"h":' + H;
  s := s + ',"rot":' + JF(Pad.Rotation);
  if Pad.Layer = eTopLayer then
    s := s + ',"layer":"Top"'
  else if Pad.Layer = eBottomLayer then
    s := s + ',"layer":"Bottom"'
  else
    s := s + ',"layer":"Multi"';
  if PadType = 'th' then
  begin
    DrillShape := 'circle';
    case Pad.HoleType of
      1:
        DrillShape := 'rect';
      2:
        DrillShape := 'oblong';
    end;
    s := s + ',"drillshape":' + JS(DrillShape);
    s := s + ',"drill":' + MM(Pad.HoleSize);
    if Pad.HoleType <> 0 then
      s := s + ',"drillw":' + MM(Pad.HoleWidth);
    s := s + ',"holerot":' + JF(Pad.HoleRotation);
  end;
  s := s + '}';
  Result := s;
end;

function FootprintJSON(FP: TObject): String;
var
  GIter, Prim: TObject;
  PadsStr, SilkStr: String;
  MinX, MinY, MaxX, MaxY, cx, cy, half: Double;
begin
  MinX := 1e9;
  MinY := 1e9;
  MaxX := -1e9;
  MaxY := -1e9;
  PadsStr := '';
  SilkStr := '';

  GIter := FP.GroupIterator_Create;
  GIter.AddFilter_ObjectSet(MkSet(ePadObject, eTrackObject, eArcObject));
  Prim := GIter.FirstPCBObject;
  while Prim <> nil do
  begin
    case Prim.ObjectId of
      ePadObject:
        begin
          if PadsStr <> '' then
            PadsStr := PadsStr + ',';
          PadsStr := PadsStr + FpPadJSON(Prim);
          cx := CoordToMMs(Prim.x);
          cy := CoordToMMs(Prim.y);
          half := CoordToMMs(Prim.TopXSize);
          if CoordToMMs(Prim.TopYSize) > half then
            half := CoordToMMs(Prim.TopYSize);
          half := half / 2;
          if cx - half < MinX then MinX := cx - half;
          if cx + half > MaxX then MaxX := cx + half;
          if cy - half < MinY then MinY := cy - half;
          if cy + half > MaxY then MaxY := cy + half;
        end;
      eTrackObject:
        begin
          if (Prim.Layer = eTopOverlay) or (Prim.Layer = eBottomOverlay) then
          begin
            if SilkStr <> '' then
              SilkStr := SilkStr + ',';
            SilkStr := SilkStr + '{"kind":"line","x1":' + MM(Prim.X1) + ',"y1":' + MM(Prim.Y1) +
              ',"x2":' + MM(Prim.X2) + ',"y2":' + MM(Prim.Y2) + ',"w":' + MM(Prim.Width) + '}';
            if CoordToMMs(Prim.X1) < MinX then MinX := CoordToMMs(Prim.X1);
            if CoordToMMs(Prim.X2) < MinX then MinX := CoordToMMs(Prim.X2);
            if CoordToMMs(Prim.X1) > MaxX then MaxX := CoordToMMs(Prim.X1);
            if CoordToMMs(Prim.X2) > MaxX then MaxX := CoordToMMs(Prim.X2);
            if CoordToMMs(Prim.Y1) < MinY then MinY := CoordToMMs(Prim.Y1);
            if CoordToMMs(Prim.Y2) < MinY then MinY := CoordToMMs(Prim.Y2);
            if CoordToMMs(Prim.Y1) > MaxY then MaxY := CoordToMMs(Prim.Y1);
            if CoordToMMs(Prim.Y2) > MaxY then MaxY := CoordToMMs(Prim.Y2);
          end;
        end;
      eArcObject:
        begin
          if (Prim.Layer = eTopOverlay) or (Prim.Layer = eBottomOverlay) then
          begin
            if SilkStr <> '' then
              SilkStr := SilkStr + ',';
            SilkStr := SilkStr + '{"kind":"arc","cx":' + MM(Prim.XCenter) + ',"cy":' + MM(Prim.YCenter) +
              ',"r":' + MM(Prim.Radius) + ',"sa":' + JF(Prim.StartAngle) + ',"ea":' + JF(Prim.EndAngle) +
              ',"w":' + MM(Prim.LineWidth) + '}';
            if CoordToMMs(Prim.XCenter) - CoordToMMs(Prim.Radius) < MinX then MinX := CoordToMMs(Prim.XCenter) - CoordToMMs(Prim.Radius);
            if CoordToMMs(Prim.XCenter) + CoordToMMs(Prim.Radius) > MaxX then MaxX := CoordToMMs(Prim.XCenter) + CoordToMMs(Prim.Radius);
            if CoordToMMs(Prim.YCenter) - CoordToMMs(Prim.Radius) < MinY then MinY := CoordToMMs(Prim.YCenter) - CoordToMMs(Prim.Radius);
            if CoordToMMs(Prim.YCenter) + CoordToMMs(Prim.Radius) > MaxY then MaxY := CoordToMMs(Prim.YCenter) + CoordToMMs(Prim.Radius);
          end;
        end;
    end;
    Prim := GIter.NextPCBObject;
  end;
  FP.GroupIterator_Destroy(GIter);

  if MinX > MaxX then
  begin
    MinX := -1;
    MinY := -1;
    MaxX := 1;
    MaxY := 1;
  end;

  Result := '{"name":' + JS(FP.Name) +
    ',"description":' + JS(FP.Description) +
    ',"bbox":{"x1":' + JF(MinX) + ',"y1":' + JF(MinY) + ',"x2":' + JF(MaxX) + ',"y2":' + JF(MaxY) + '}' +
    ',"pads":[' + PadsStr + ']' +
    ',"silk":[' + SilkStr + ']}';
end;

{ ------------------------------- rotina principal ------------------------------- }

procedure ExportLibs;
var
  PLib: IPCB_Library;
  LibIter, FP: TObject;
  SchDoc: ISch_Document;
  Iterator, Comp: TObject;
  FpL, SymL, OutL: TStringList;
  i: Integer;
  s: String;
begin
  if PCBServer = nil then
  begin
    ShowMessage('PCBServer indisponivel. Abra a PcbLib no Altium e rode de novo.');
    Exit;
  end;
  ForceDirectories(OUT_DIR);

  // ------------------------------------------------ PcbLib primeiro (para o crosscheck)
  PLib := PCBServer.GetPCBLibraryByPath(PCBLIB_FILE);
  if PLib = nil then
    PLib := PCBServer.LoadPCBLibraryByPath(PCBLIB_FILE);
  if PLib = nil then
  begin
    ShowMessage('Nao consegui abrir a PcbLib:' + #13#10 + PCBLIB_FILE + #13#10#13#10 +
      'Abra a biblioteca no Altium (File >> Open) e rode de novo.');
    Exit;
  end;

  FpNames := TStringList.Create;
  FpNames.Sorted := True;
  FpNames.Duplicates := dupIgnore;
  FpNames.CaseSensitive := False;
  NoFpList := TStringList.Create;
  FpL := TStringList.Create;
  SymL := TStringList.Create;
  FpCount := 0;
  SymCount := 0;

  LibIter := PLib.LibraryIterator_Create;
  LibIter.SetState_FilterAll;
  FP := LibIter.FirstPCBObject;
  while FP <> nil do
  begin
    FpCount := FpCount + 1;
    FpNames.Add(FP.Name);
    AddItem(FpL, FootprintJSON(FP));
    FP := LibIter.NextPCBObject;
  end;
  PLib.LibraryIterator_Destroy(LibIter);

  OutL := TStringList.Create;
  OutL.Add('var pcblib = {');
  OutL.Add('"format":"pcblib-v2",');
  OutL.Add('"generated":' + JS(DateTimeToStr(Now)) + ',');
  OutL.Add('"source":' + JS(PCBLIB_FILE) + ',');
  OutL.Add('"units":"mm",');
  OutL.Add('"footprints":[');
  OutL.AddStrings(FpL);
  OutL.Add('],');
  OutL.Add('"stats":{"footprints":' + IntToStr(FpCount) + '}');
  OutL.Add('};');
  OutL.SaveToFile(OUT_DIR + '\pcblib.js');
  OutL.Free;

  // ------------------------------------------------ SchLib
  if SchServer = nil then
  begin
    ShowMessage('SchServer indisponivel. Abra a SchLib no Altium e rode de novo.' + #13#10 +
      '(pcblib.js ja foi gerado)');
    FpL.Free;
    SymL.Free;
    FpNames.Free;
    NoFpList.Free;
    Exit;
  end;
  SchDoc := SchServer.GetSchDocumentByPath(SCHLIB_FILE);
  if SchDoc = nil then
    SchDoc := SchServer.LoadSchDocumentByPath(SCHLIB_FILE);
  if SchDoc = nil then
  begin
    ShowMessage('Nao consegui abrir a SchLib:' + #13#10 + SCHLIB_FILE + #13#10#13#10 +
      'Abra a biblioteca no Altium (File >> Open) e rode de novo. (pcblib.js ja foi gerado)');
    FpL.Free;
    SymL.Free;
    FpNames.Free;
    NoFpList.Free;
    Exit;
  end;

  Iterator := SchDoc.SchLibIterator_Create;
  Iterator.AddFilter_ObjectSet(MkSet(eSchComponent));
  Comp := Iterator.FirstSchObject;
  while Comp <> nil do
  begin
    SymCount := SymCount + 1;
    AddItem(SymL, SymbolJSON(Comp));
    Comp := Iterator.NextSchObject;
  end;
  SchDoc.SchIterator_Destroy(Iterator);

  OutL := TStringList.Create;
  OutL.Add('var schlib = {');
  OutL.Add('"format":"schlib-v2",');
  OutL.Add('"generated":' + JS(DateTimeToStr(Now)) + ',');
  OutL.Add('"source":' + JS(SCHLIB_FILE) + ',');
  OutL.Add('"units":"mil",');
  OutL.Add('"symbols":[');
  OutL.AddStrings(SymL);
  OutL.Add('],');
  OutL.Add('"stats":{"symbols":' + IntToStr(SymCount) + ',"nofootprint":' + IntToStr(NoFpList.Count) + '}');
  OutL.Add('};');
  OutL.SaveToFile(OUT_DIR + '\schlib.js');
  OutL.Free;

  // ------------------------------------------------ relatorio + resumo
  OutL := TStringList.Create;
  OutL.Add('AltiumPCBMirror - relatorio das bibliotecas');
  OutL.Add('Data: ' + DateTimeToStr(Now));
  OutL.Add('Simbolos: ' + IntToStr(SymCount) + '   Footprints: ' + IntToStr(FpCount));
  OutL.Add('');
  OutL.Add('Simbolos SEM footprint valido na PcbLib (' + IntToStr(NoFpList.Count) + '):');
  OutL.AddStrings(NoFpList);
  OutL.SaveToFile(OUT_DIR + '\libs-report.txt');
  OutL.Free;

  s := 'Bibliotecas espelhadas em ' + OUT_DIR + #13#10#13#10 +
    'Simbolos: ' + IntToStr(SymCount) + #13#10 +
    'Footprints: ' + IntToStr(FpCount) + #13#10 +
    'Simbolos sem footprint na PcbLib: ' + IntToStr(NoFpList.Count) + #13#10#13#10 +
    'Detalhes em libs-report.txt';
  ShowMessage(s);

  FpL.Free;
  SymL.Free;
  FpNames.Free;
  NoFpList.Free;
end;
```

- [ ] **Step 2: Adicionar ao `AltiumPCBMirror.PrjScr`**, após o bloco `[Document2]`, copiando o padrão dos blocos existentes:

```ini
[Document3]
DocumentPath=ExportLibs.pas
AnnotationEnabled=1
AnnotateStartValue=1
AnnotationIndexControlEnabled=0
AnnotateSuffix=
AnnotateScope=All
AnnotateOrder=-1
DoLibraryUpdate=1
DoDatabaseUpdate=1
ClassGenCCAutoEnabled=1
ClassGenCCAutoRoomEnabled=0
ClassGenNCAutoScope=None
DItemRevisionGUID=
GenerateClassCluster=0
DocumentUniqueId=
```

- [ ] **Step 3: Revisão de idiomas** — conferir que o arquivo só usa APIs da lista do "Contexto essencial" + as já provadas no v1 (`GroupIterator_Create`, `LibraryIterator_Create/SetState_FilterAll`, propriedades de `Pad` idênticas ao `PadJSON` do ExportBoard). Sem `try/except`, sem `StrToIntDef`.

- [ ] **Step 4: Commit**

```powershell
git add ExportLibs.pas AltiumPCBMirror.PrjScr
git commit -m @'
ExportLibs.pas: espelho das bibliotecas SchLib/PcbLib para Libs\

Simbolos com pinos/graficos/modelos (mil) + footprints 2D (mm) +
relatorio de simbolos sem footprint.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 11: `ExportProject.pas` — espelho do esquema do projeto aberto

Espelha cada `.SchDoc` do projeto focado para `Projects\<nome>\schematic.js` (mesmo formato que a IA escreve). A PCB NÃO é duplicada aqui: o script avisa para rodar o `ExportBoard` (unidades DelphiScript não compartilham código — duplicar 700 linhas do serializador de placa criaria manutenção dupla).

**Files:**
- Create: `ExportProject.pas`
- Modify: `AltiumPCBMirror.PrjScr` (adicionar Document4, mesmo padrão da Task 10 com `DocumentPath=ExportProject.pas`)

- [ ] **Step 1: Criar `ExportProject.pas`** com o conteúdo completo:

```pascal
{ ..................................................................................................................... }
{ .  AltiumPCBMirror - ExportProject.pas                                                                              . }
{ .                                                                                                                   . }
{ .  Espelha o ESQUEMA do projeto focado para o workspace central:                                                    . }
{ .    Projects\<nome>\schematic.js  (formato schmirror-v2, unidade MIL, um item por linha)                           . }
{ .  e atualiza o indice projects.js.                                                                                 . }
{ .                                                                                                                   . }
{ .  A PCB e espelhada pelo ExportBoard (rode-o com o .PcbDoc focado).                                                . }
{ .                                                                                                                   . }
{ .  Como executar: DXP >> Run Script >> ExportProject  (com o projeto aberto/focado)                                 . }
{ ..................................................................................................................... }

const
  SCRIPT_HOME = 'Z:\AltiumPCBMirror';
  PROJECTS_DIR = 'Z:\AltiumPCBMirror\Projects';

var
  SkippedDocs: Integer;

{ helpers JSON identicos aos do ExportLibs.pas — copie JF, JB, JS, AddItem daquele arquivo }
{ e os mapeamentos RotDegOf (TRotationBy90 -> 0/90/180/270) tambem. }

function JF(v: Double): String;
begin
  Result := StringReplace(FloatToStr(v), ',', '.', MkSet(rfReplaceAll, rfIgnoreCase));
end;

function JB(v: Boolean): String;
begin
  if v then
    Result := 'true'
  else
    Result := 'false';
end;

function JS(v: String): String;
var
  i: Integer;
  c: String;
begin
  Result := '"';
  for i := 1 to Length(v) do
  begin
    c := v[i];
    case Ord(v[i]) of
      34:
        Result := Result + '\"';
      92:
        Result := Result + '\\';
      8:
        Result := Result + '\b';
      9:
        Result := Result + '\t';
      10:
        Result := Result + '\n';
      12:
        Result := Result + '\f';
      13:
        Result := Result + '\r';
    else
      begin
        if (Ord(v[i]) < 32) or (Ord(v[i]) > 125) then
          Result := Result + '\u' + IntToHex(Ord(v[i]), 4)
        else
          Result := Result + c;
      end;
    end;
  end;
  Result := Result + '"';
end;

function ML(v: Integer): String;
begin
  Result := JF(CoordToMils(v));
end;

function RotDegOf(o: TRotationBy90): Integer;
begin
  Result := 0;
  if o = eRotate90 then
    Result := 90
  else if o = eRotate180 then
    Result := 180
  else if o = eRotate270 then
    Result := 270;
end;

procedure AddItem(Section: TStringList; Line: String);
begin
  if Section.Count > 0 then
    Section.Add(',' + Line)
  else
    Section.Add(Line);
end;

{ >>> COLE AQUI O BLOCO PROJ-HELPERS (secao "Bloco PROJ-HELPERS" deste plano) <<< }

{ ------------------------------- mapeamentos Sch ------------------------------- }

function SheetSizeName(style: Integer): String;
begin
  if style = eSheetA3 then
    Result := 'A3'
  else if style = eSheetA2 then
    Result := 'A2'
  else if style = eSheetA1 then
    Result := 'A1'
  else if style = eSheetA then
    Result := 'A'
  else if style = eSheetB then
    Result := 'B'
  else if style = eSheetC then
    Result := 'C'
  else
    Result := 'A4';
end;

function PowerStyleName(style: Integer): String;
begin
  if style = ePowerGndPower then
    Result := 'GndPower'
  else if style = ePowerGndSignal then
    Result := 'GndSignal'
  else if style = ePowerGndEarth then
    Result := 'GndEarth'
  else if style = ePowerCircle then
    Result := 'Circle'
  else if style = ePowerArrow then
    Result := 'Arrow'
  else if style = ePowerWave then
    Result := 'Wave'
  else
    Result := 'Bar';
end;

// footprint atual (modelo PCBLIB IsCurrent; senao o primeiro PCBLIB; senao '')
function CurrentFootprintOf(Comp: TObject): String;
var
  Iter, Impl: TObject;
  FirstFp: String;
begin
  Result := '';
  FirstFp := '';
  Iter := Comp.SchIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eImplementation));
  Impl := Iter.FirstSchObject;
  while Impl <> nil do
  begin
    if UpperCase(Impl.ModelType) = 'PCBLIB' then
    begin
      if FirstFp = '' then
        FirstFp := Impl.ModelName;
      if Impl.IsCurrent then
      begin
        Result := Impl.ModelName;
        break;
      end;
    end;
    Impl := Iter.NextSchObject;
  end;
  Comp.SchIterator_Destroy(Iter);
  if Result = '' then
    Result := FirstFp;
end;

{ ------------------------------- exportacao de uma folha ------------------------------- }

procedure ExportSheet(Path: String; ItemsL: TStringList);
var
  SchDoc: ISch_Document;
  Iterator, Prim: TObject;
  SheetName, s, pts: String;
  k: Integer;
begin
  SchDoc := SchServer.GetSchDocumentByPath(Path);
  if SchDoc = nil then
    SchDoc := SchServer.LoadSchDocumentByPath(Path);
  if SchDoc = nil then
  begin
    SkippedDocs := SkippedDocs + 1;
    Exit;
  end;
  SheetName := BaseName(Path);

  AddItem(ItemsL, '{"t":"sheet","name":' + JS(SheetName) + ',"size":' + JS(SheetSizeName(SchDoc.SheetStyle)) + '}');

  Iterator := SchDoc.SchIterator_Create;
  Iterator.AddFilter_ObjectSet(MkSet(eSchComponent, eWire, eNetLabel, ePowerObject, eJunction, eLabel));
  Prim := Iterator.FirstSchObject;
  while Prim <> nil do
  begin
    case Prim.ObjectId of
      eSchComponent:
        begin
          s := '{"t":"comp","sheet":' + JS(SheetName) +
            ',"ref":' + JS(Prim.Designator.Text) +
            ',"sym":' + JS(Prim.LibReference) +
            ',"part":' + IntToStr(Prim.CurrentPartID) +
            ',"x":' + ML(Prim.Location.X) +
            ',"y":' + ML(Prim.Location.Y) +
            ',"rot":' + IntToStr(RotDegOf(Prim.Orientation)) +
            ',"mirror":' + JB(Prim.IsMirrored) +
            ',"footprint":' + JS(CurrentFootprintOf(Prim)) +
            ',"comment":' + JS(Prim.Comment.Text) + '}';
          AddItem(ItemsL, s);
        end;
      eWire:
        begin
          pts := '';
          for k := 1 to Prim.VerticesCount do
          begin
            if pts <> '' then
              pts := pts + ',';
            pts := pts + '[' + ML(Prim.Vertex[k].X) + ',' + ML(Prim.Vertex[k].Y) + ']';
          end;
          AddItem(ItemsL, '{"t":"wire","sheet":' + JS(SheetName) + ',"pts":[' + pts + ']}');
        end;
      eNetLabel:
        AddItem(ItemsL, '{"t":"netlabel","sheet":' + JS(SheetName) +
          ',"net":' + JS(Prim.Text) +
          ',"x":' + ML(Prim.Location.X) + ',"y":' + ML(Prim.Location.Y) +
          ',"rot":' + IntToStr(RotDegOf(Prim.Orientation)) + '}');
      ePowerObject:
        AddItem(ItemsL, '{"t":"power","sheet":' + JS(SheetName) +
          ',"net":' + JS(Prim.Text) +
          ',"style":' + JS(PowerStyleName(Prim.Style)) +
          ',"x":' + ML(Prim.Location.X) + ',"y":' + ML(Prim.Location.Y) +
          ',"rot":' + IntToStr(RotDegOf(Prim.Orientation)) + '}');
      eJunction:
        AddItem(ItemsL, '{"t":"junction","sheet":' + JS(SheetName) +
          ',"x":' + ML(Prim.Location.X) + ',"y":' + ML(Prim.Location.Y) + '}');
      eLabel:
        AddItem(ItemsL, '{"t":"text","sheet":' + JS(SheetName) +
          ',"s":' + JS(Prim.Text) +
          ',"x":' + ML(Prim.Location.X) + ',"y":' + ML(Prim.Location.Y) +
          ',"h":10}');
    end;
    Prim := Iterator.NextSchObject;
  end;
  SchDoc.SchIterator_Destroy(Iterator);
end;

{ ------------------------------- rotina principal ------------------------------- }

procedure ExportProject;
var
  WS: IWorkspace;
  Prj: IProject;
  Doc: IDocument;
  i, SheetCount: Integer;
  ProjName, OutDir: String;
  ItemsL, OutL: TStringList;
begin
  if SchServer = nil then
  begin
    ShowMessage('SchServer indisponivel. Abra um esquema no Altium e rode de novo.');
    Exit;
  end;
  WS := GetWorkspace;
  if WS = nil then
  begin
    ShowMessage('Workspace indisponivel.');
    Exit;
  end;
  Prj := WS.DM_FocusedProject;
  if (Prj = nil) or (BaseName(Prj.DM_ProjectFileName) = 'Free Documents') then
  begin
    ShowMessage('Nenhum projeto focado. Abra o .PrjPcb e rode de novo.');
    Exit;
  end;
  ProjName := BaseName(Prj.DM_ProjectFileName);
  OutDir := ResolveProjectDir(ProjName, True);
  if OutDir = '' then
    Exit;

  SkippedDocs := 0;
  SheetCount := 0;
  ItemsL := TStringList.Create;
  for i := 0 to Prj.DM_LogicalDocumentCount - 1 do
  begin
    Doc := Prj.DM_LogicalDocuments(i);
    if Doc.DM_DocumentKind = 'SCH' then
    begin
      SheetCount := SheetCount + 1;
      ExportSheet(Doc.DM_FullPath, ItemsL);
    end;
  end;

  if SheetCount = 0 then
  begin
    ShowMessage('O projeto "' + ProjName + '" nao tem documentos de esquema (.SchDoc).');
    ItemsL.Free;
    Exit;
  end;

  OutL := TStringList.Create;
  OutL.Add('var schematic = {');
  OutL.Add('"format":"schmirror-v2",');
  OutL.Add('"project":' + JS(ProjName) + ',');
  OutL.Add('"generated":' + JS(DateTimeToStr(Now)) + ',');
  OutL.Add('"units":"mil",');
  OutL.Add('"items":[');
  OutL.AddStrings(ItemsL);
  OutL.Add(']};');
  OutL.SaveToFile(OutDir + '\schematic.js');
  OutL.Free;
  ItemsL.Free;

  RegenerateProjectsIndex;

  ShowMessage('Esquema espelhado em:' + #13#10 + OutDir + '\schematic.js' + #13#10#13#10 +
    'Folhas: ' + IntToStr(SheetCount) +
    '   (nao abertas/puladas: ' + IntToStr(SkippedDocs) + ')' + #13#10#13#10 +
    'PCB: rode o ExportBoard com o .PcbDoc focado.' + #13#10 +
    'Confira no hub.html (vista Esquema).');
end;
```

- [ ] **Step 2: Substituir o marcador** `{ >>> COLE AQUI O BLOCO PROJ-HELPERS ... <<< }` pelo bloco PROJ-HELPERS completo (seção acima).

- [ ] **Step 3: Adicionar `[Document4]`** ao `.PrjScr` (padrão da Task 10, `DocumentPath=ExportProject.pas`).

- [ ] **Step 4: Revisão de idiomas** — mesma checagem da Task 10 (APIs da lista, sem try/except).

- [ ] **Step 5: Commit**

```powershell
git add ExportProject.pas AltiumPCBMirror.PrjScr
git commit -m @'
ExportProject.pas: espelha esquema do projeto focado (schmirror-v2)

Componentes/fios/netlabels/powers/junctions/textos por folha + indice.
PCB continua via ExportBoard.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

### Task 12: `ExportBoard.pas` evoluído — destino `Projects\<nome>\`

Muda SÓ o destino e o pós-processo; toda a serialização fiel permanece intocada.

**Files:**
- Modify: `ExportBoard.pas`

- [ ] **Step 1: Atualizar o cabeçalho e as constantes** (linhas 1-25). No comentário do topo, trocar a descrição da saída para `Projects\<nome do projeto>\` e remover a menção a viewer.html copiado. Constantes ficam:

```pascal
const
  // Pasta onde este script esta instalado. AJUSTE AQUI se instalar em outro lugar.
  SCRIPT_HOME = 'Z:\AltiumPCBMirror';
  PROJECTS_DIR = 'Z:\AltiumPCBMirror\Projects';
  FORMAT_ID = 'pcbmirror-v1';
```

(a constante `OUT_SUBDIR` é removida.)

- [ ] **Step 2: Inserir o bloco PROJ-HELPERS** logo após a procedure `AddItem` (linha ~145). Os helpers `JS`/`JB` já existem no arquivo.

- [ ] **Step 3: Remover os utilitários de arquivo órfãos** — as functions `LoadTextFile` e `CopyTextFile` (linhas 469-492 do arquivo original) deixam de ser usadas e são removidas.

- [ ] **Step 4: Na procedure `ExportBoard`**, trocar o cálculo do destino (linhas 541-546 do original):

```pascal
  OutDir := ExtractFilePath(Board.FileName) + OUT_SUBDIR;
  if (not DirectoryExists(OutDir)) and (not ForceDirectories(OutDir)) then
  begin
    ShowMessage('Nao foi possivel criar a pasta de saida: ' + OutDir);
    Exit;
  end;
```

por (declarar `ProjName: String` no var da procedure):

```pascal
  ProjName := FocusedProjectName;
  if ProjName = '' then
    ProjName := BaseName(Board.FileName);
  OutDir := ResolveProjectDir(ProjName, True);
  if OutDir = '' then
    Exit;
```

- [ ] **Step 5: Substituir o bloco "viewer + guia"** (linhas 757-776 do original, do comentário `// ---- viewer + guia` até o `ShowMessage(s);` inclusive) por:

```pascal
  RegenerateProjectsIndex;

  s := 'Exportacao concluida em:' + #13#10 + OutDir + #13#10#13#10 +
    'Componentes: ' + IntToStr(CompIdx) + #13#10 +
    'Trilhas: ' + IntToStr(TrackIdx) + '   Arcos: ' + IntToStr(ArcIdx) + '   Vias: ' + IntToStr(ViaIdx) + #13#10 +
    'Silk: ' + IntToStr(SilkIdx) + '   Textos: ' + IntToStr(TextIdx) + '   Regioes: ' + IntToStr(RegionIdx) + #13#10 +
    'Pads livres: ' + IntToStr(PadIdx) + #13#10#13#10 +
    'Confira no hub.html (vista PCB).';
  ShowMessage(s);
```

(a variável `Missing` sai do `var` da procedure.)

- [ ] **Step 6: Commit**

```powershell
git add ExportBoard.pas
git commit -m @'
ExportBoard.pas: grava em Projects\<nome>\ e atualiza projects.js

Resolve a pendencia de centralizar o export no workspace; viewer.html
nao e mais copiado por projeto (hub central substitui).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 13: `ApplyChanges.pas` evoluído — projeto por nome + `outline_set`

**Files:**
- Modify: `ApplyChanges.pas`

- [ ] **Step 1: Atualizar cabeçalho e constantes** — no comentário do topo, a fonte passa a ser `Projects\<nome>\changes.js` e a lista de ops ganha `outline_set`. Constantes:

```pascal
const
  SCRIPT_HOME = 'Z:\AltiumPCBMirror';
  PROJECTS_DIR = 'Z:\AltiumPCBMirror\Projects';
  TOL_MM = 0.001;
```

- [ ] **Step 2: Adicionar os helpers `JS` e `JB`** (copiar do ExportBoard.pas, linhas 40-82 do original) logo após `JNum` (linha ~161), e em seguida **inserir o bloco PROJ-HELPERS**.

- [ ] **Step 3: Adicionar `ParsePts`** (após o bloco PROJ-HELPERS) — extrai o array aninhado `"pts":[[x,y],...]` de uma linha, devolvendo TStringList de `'x|y'`:

```pascal
// Extrai "pts":[[x,y],[x,y],...] da linha -> TStringList de 'x|y' (strings numericas)
function ParsePts(Line: String): TStringList;
var
  p, i, Depth: Integer;
  Body, Cur, c: String;
begin
  Result := TStringList.Create;
  p := Pos('"pts":[', Line);
  if p = 0 then
    Exit;
  i := p + 7;
  Depth := 1;
  Body := '';
  while (i <= Length(Line)) and (Depth > 0) do
  begin
    c := Line[i];
    if c = '[' then
      Depth := Depth + 1
    else if c = ']' then
      Depth := Depth - 1;
    if Depth > 0 then
      Body := Body + c;
    i := i + 1;
  end;
  Cur := '';
  for i := 1 to Length(Body) do
  begin
    c := Body[i];
    if c = '[' then
      Cur := ''
    else if c = ']' then
    begin
      p := Pos(',', Cur);
      if p > 0 then
        Result.Add(Copy(Cur, 1, p - 1) + '|' + Copy(Cur, p + 1, 255));
    end
    else if c <> ' ' then
      Cur := Cur + c;
  end;
end;
```

- [ ] **Step 4: Adicionar `DoOutlineSet`** (após `DoArcDel`, linha ~767 do original). Nota DelphiScript: `Segments[i]` é propriedade-record — ler para variável temporária, alterar, gravar de volta:

```pascal
procedure DoOutlineSet(Line: String);
var
  Pts: TStringList;
  i, p: Integer;
  BO: TObject;
  Seg: TPolySegment;
  x, y: Double;
begin
  Pts := ParsePts(Line);
  if Pts.Count < 3 then
  begin
    LogFail('outline_set: pts precisa de pelo menos 3 vertices [[x,y],...]');
    Pts.Free;
    Exit;
  end;
  if not ConfirmNoYes('outline_set: substituir o CONTORNO DA PLACA por um poligono de ' +
    IntToStr(Pts.Count) + ' vertices?') then
  begin
    LogFail('outline_set: cancelado pelo usuario');
    Pts.Free;
    Exit;
  end;
  BO := Board.BoardOutline;
  PCBServer.SendMessageToRobots(BO.I_ObjectAddress, c_Broadcast, PCBM_BeginModify, c_NoEventData);
  BO.Invalidate;
  BO.PointCount := Pts.Count;
  for i := 0 to Pts.Count - 1 do
  begin
    p := Pos('|', Pts[i]);
    x := StrToFloatDot(Copy(Pts[i], 1, p - 1));
    y := StrToFloatDot(Copy(Pts[i], p + 1, 255));
    Seg := BO.Segments[i];
    Seg.Kind := ePolySegmentLine;
    Seg.vx := MMX(x);
    Seg.vy := MMY(y);
    BO.Segments[i] := Seg;
  end;
  BO.Rebuild;
  BO.Validate;
  PCBServer.SendMessageToRobots(BO.I_ObjectAddress, c_Broadcast, PCBM_EndModify, c_NoEventData);
  LogOk('outline_set: contorno redefinido com ' + IntToStr(Pts.Count) + ' vertices');
  Pts.Free;
end;
```

- [ ] **Step 5: Na procedure `ApplyChanges`**, trocar a resolução do arquivo (linhas 786-793 do original):

```pascal
  OutDir := ExtractFilePath(Board.FileName) + OUT_SUBDIR;
  ChangesFile := OutDir + '\changes.js';
```

por (declarar `ProjName: String` no var):

```pascal
  ProjName := FocusedProjectName;
  if ProjName = '' then
    ProjName := BaseName(Board.FileName);
  OutDir := ResolveProjectDir(ProjName, False);
  if OutDir = '' then
    Exit;
  ChangesFile := OutDir + '\changes.js';
```

e a mensagem de arquivo ausente passa a dizer `'Rode primeiro o ExportBoard e peca as mudancas a IA.'`.

- [ ] **Step 6: Registrar a op no dispatcher** — no encadeado de `else if` (linhas 820-841 do original), antes do `else` final:

```pascal
    else if Op = 'outline_set' then
      DoOutlineSet(Line)
```

- [ ] **Step 7: Regenerar o índice** — logo após `Report.SaveToFile(...)`, adicionar `RegenerateProjectsIndex;`.

- [ ] **Step 8: Commit**

```powershell
git add ApplyChanges.pas
git commit -m @'
ApplyChanges.pas: le Projects\<nome>\changes.js + op outline_set

Casamento do projeto por nome (com escolha numerada), redefinicao do
Board Outline protegida por confirmacao, indice atualizado.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 14: `BuildSchematic.pas` — criar o esquema real no Altium

O coração do "projeto do zero": valida TUDO antes de criar qualquer coisa; depois cria um `.SchDoc` por folha, coloca os símbolos copiados da SchLib real, seta designator/comment/footprint e desenha fios/labels/powers/junctions/textos. Relatório em `build-report.txt`.

**Files:**
- Create: `BuildSchematic.pas`
- Modify: `AltiumPCBMirror.PrjScr` (adicionar Document5, `DocumentPath=BuildSchematic.pas`)

- [ ] **Step 1: Criar `BuildSchematic.pas`** com o conteúdo completo:

```pascal
{ ..................................................................................................................... }
{ .  AltiumPCBMirror - BuildSchematic.pas                                                                             . }
{ .                                                                                                                   . }
{ .  Le Projects\<nome>\schematic.js (escrito pela IA) e cria os .SchDoc REAIS no projeto focado:                     . }
{ .    - valida tudo ANTES de criar qualquer coisa (simbolos na SchLib, footprints na PcbLib, refs)                   . }
{ .    - um .SchDoc por folha, na pasta do .PrjPcb, adicionado ao projeto                                             . }
{ .    - componentes COPIADOS da SchLib real (graficos/pinos/parametros preservados)                                  . }
{ .    - designator, comment e modelo de footprint definidos por componente                                           . }
{ .    - fios, net labels, power ports, junctions e textos                                                            . }
{ .    - relatorio em Projects\<nome>\build-report.txt                                                                . }
{ .                                                                                                                   . }
{ .  Depois: salve o projeto, Compile, e Design >> Update PCB (ECO nativo).                                           . }
{ .                                                                                                                   . }
{ .  Como executar: DXP >> Run Script >> BuildSchematic  (com o .PrjPcb do projeto focado)                            . }
{ ..................................................................................................................... }

const
  SCRIPT_HOME = 'Z:\AltiumPCBMirror';
  PROJECTS_DIR = 'Z:\AltiumPCBMirror\Projects';
  SCHLIB_FILE = 'Z:\Biblioteca\ALTIUM LIBRARY ------ LUCAS\BIBLIOTECA DE ESQUEMA.SchLib';
  PCBLIB_FILE = 'Z:\Biblioteca\ALTIUM LIBRARY ------ LUCAS\BIBLIOTECA DE FOOTPRINT.PcbLib';

var
  Report: TStringList;
  OkCount, FailCount: Integer;
  SchLibDoc: ISch_Document;
  PcbFpNames: TStringList;   // nil = PcbLib indisponivel (validacao de footprint vira aviso)

{ ------------------------------- helpers JSON (copias do ExportBoard/ApplyChanges) ------------------------------- }
{ Copie aqui, identicos aos originais: JF, JB, JS (do ExportBoard.pas)                                              }
{ e StrToFloatDot, JGet, JHas, JNum (do ApplyChanges.pas linhas 32-161).                                            }

{ >>> COLE AQUI: JF, JB, JS, StrToFloatDot, JGet, JHas, JNum <<< }

{ >>> COLE AQUI O BLOCO PROJ-HELPERS (secao "Bloco PROJ-HELPERS" deste plano) <<< }

{ >>> COLE AQUI a function ParsePts da Task 13 (identica) <<< }

{ ------------------------------- log ------------------------------- }

procedure LogOk(Msg: String);
begin
  OkCount := OkCount + 1;
  Report.Add('[OK]    ' + Msg);
end;

procedure LogFail(Msg: String);
begin
  FailCount := FailCount + 1;
  Report.Add('[FALHA] ' + Msg);
end;

{ ------------------------------- mapeamentos ------------------------------- }

function RotToOrient(rot: Integer): TRotationBy90;
begin
  Result := eRotate0;
  if rot = 90 then
    Result := eRotate90
  else if rot = 180 then
    Result := eRotate180
  else if rot = 270 then
    Result := eRotate270;
end;

function StyleFromName(s: String): TPowerObjectStyle;
begin
  Result := ePowerBar;
  if s = 'GndPower' then
    Result := ePowerGndPower
  else if s = 'GndSignal' then
    Result := ePowerGndSignal
  else if s = 'GndEarth' then
    Result := ePowerGndEarth
  else if s = 'Circle' then
    Result := ePowerCircle
  else if s = 'Arrow' then
    Result := ePowerArrow
  else if s = 'Wave' then
    Result := ePowerWave;
end;

function SheetStyleFromName(s: String): Integer;
begin
  Result := eSheetA4;
  if s = 'A3' then
    Result := eSheetA3
  else if s = 'A2' then
    Result := eSheetA2
  else if s = 'A1' then
    Result := eSheetA1
  else if s = 'A' then
    Result := eSheetA
  else if s = 'B' then
    Result := eSheetB
  else if s = 'C' then
    Result := eSheetC;
end;

{ ------------------------------- bibliotecas reais ------------------------------- }

function OpenSchLib: Boolean;
begin
  Result := False;
  if SchServer = nil then
    Exit;
  SchLibDoc := SchServer.GetSchDocumentByPath(SCHLIB_FILE);
  if SchLibDoc = nil then
    SchLibDoc := SchServer.LoadSchDocumentByPath(SCHLIB_FILE);
  Result := SchLibDoc <> nil;
end;

function FindLibSymbol(Name: String): ISch_Component;
var
  Iterator, Comp: TObject;
begin
  Result := nil;
  Iterator := SchLibDoc.SchLibIterator_Create;
  Iterator.AddFilter_ObjectSet(MkSet(eSchComponent));
  Comp := Iterator.FirstSchObject;
  while Comp <> nil do
  begin
    if AnsiCompareText(Comp.LibReference, Name) = 0 then
    begin
      Result := Comp;
      break;
    end;
    Comp := Iterator.NextSchObject;
  end;
  SchLibDoc.SchIterator_Destroy(Iterator);
end;

procedure LoadPcbFpNames;
var
  PLib: IPCB_Library;
  LibIter, FP: TObject;
begin
  PcbFpNames := nil;
  if PCBServer = nil then
    Exit;
  PLib := PCBServer.GetPCBLibraryByPath(PCBLIB_FILE);
  if PLib = nil then
    PLib := PCBServer.LoadPCBLibraryByPath(PCBLIB_FILE);
  if PLib = nil then
    Exit;
  PcbFpNames := TStringList.Create;
  PcbFpNames.Sorted := True;
  PcbFpNames.Duplicates := dupIgnore;
  PcbFpNames.CaseSensitive := False;
  LibIter := PLib.LibraryIterator_Create;
  LibIter.SetState_FilterAll;
  FP := LibIter.FirstPCBObject;
  while FP <> nil do
  begin
    PcbFpNames.Add(FP.Name);
    FP := LibIter.NextPCBObject;
  end;
  PLib.LibraryIterator_Destroy(LibIter);
end;

{ ------------------------------- colocacao de objetos ------------------------------- }

procedure RegisterObj(SchDoc: ISch_Document; Obj: TObject);
begin
  SchDoc.RegisterSchObjectInContainer(Obj);
  SchServer.RobotManager.SendMessage(SchDoc.I_ObjectAddress, c_BroadCast,
    SCHM_PrimitiveRegistration, Obj.I_ObjectAddress);
end;

procedure SetFootprint(Comp: TObject; FpName: String; Ref: String);
var
  Iter, Impl: TObject;
  Found: Boolean;
begin
  Found := False;
  Iter := Comp.SchIterator_Create;
  Iter.AddFilter_ObjectSet(MkSet(eImplementation));
  Impl := Iter.FirstSchObject;
  while Impl <> nil do
  begin
    if UpperCase(Impl.ModelType) = 'PCBLIB' then
    begin
      if AnsiCompareText(Impl.ModelName, FpName) = 0 then
      begin
        Impl.IsCurrent := True;
        Found := True;
      end
      else
        Impl.IsCurrent := False;
    end;
    Impl := Iter.NextSchObject;
  end;
  Comp.SchIterator_Destroy(Iter);
  if not Found then
  begin
    Impl := Comp.AddSchImplementation;
    if Impl = nil then
    begin
      Report.Add('[AVISO] ' + Ref + ': nao consegui criar o modelo de footprint "' + FpName +
        '" - defina manualmente no Altium');
      Exit;
    end;
    Impl.ModelName := FpName;
    Impl.ModelType := 'PCBLIB';
    Impl.Description := '';
    Impl.MapAsString := '';
    Impl.IsCurrent := True;
  end;
end;

procedure PlaceComp(SchDoc: ISch_Document; Line: String);
var
  LibComp, NewComp: TObject;
  Ref: String;
  PartId: Integer;
begin
  Ref := JGet(Line, 'ref');
  LibComp := FindLibSymbol(JGet(Line, 'sym'));
  if LibComp = nil then
  begin
    LogFail('comp ' + Ref + ': simbolo "' + JGet(Line, 'sym') + '" sumiu da SchLib');
    Exit;
  end;
  NewComp := LibComp.Replicate;
  if NewComp = nil then
  begin
    LogFail('comp ' + Ref + ': Replicate falhou');
    Exit;
  end;
  PartId := 1;
  if JHas(Line, 'part') then
    PartId := Round(JNum(Line, 'part'));
  if PartId < 1 then
    PartId := 1;
  NewComp.CurrentPartID := PartId;
  NewComp.Location := Point(MilsToCoord(JNum(Line, 'x')), MilsToCoord(JNum(Line, 'y')));
  NewComp.Orientation := RotToOrient(Round(JNum(Line, 'rot')));
  if JGet(Line, 'mirror') = 'true' then
    NewComp.IsMirrored := True;
  NewComp.Designator.Text := Ref;
  if JHas(Line, 'comment') then
    NewComp.Comment.Text := JGet(Line, 'comment');
  RegisterObj(SchDoc, NewComp);
  SetFootprint(NewComp, JGet(Line, 'footprint'), Ref);
  LogOk('comp ' + Ref + ' (' + JGet(Line, 'sym') + ' / ' + JGet(Line, 'footprint') + ')');
end;

procedure PlaceWire(SchDoc: ISch_Document; Line: String);
var
  Wire: TObject;
  Pts: TStringList;
  i, p: Integer;
  x, y: Double;
begin
  Pts := ParsePts(Line);
  if Pts.Count < 2 then
  begin
    LogFail('wire: pts precisa de >= 2 pontos');
    Pts.Free;
    Exit;
  end;
  Wire := SchServer.SchObjectFactory(eWire, eCreate_GlobalCopy);
  if Wire = nil then
  begin
    LogFail('wire: factory falhou');
    Pts.Free;
    Exit;
  end;
  p := Pos('|', Pts[0]);
  x := StrToFloatDot(Copy(Pts[0], 1, p - 1));
  y := StrToFloatDot(Copy(Pts[0], p + 1, 255));
  Wire.Location := Point(MilsToCoord(x), MilsToCoord(y));
  for i := 0 to Pts.Count - 1 do
  begin
    p := Pos('|', Pts[i]);
    x := StrToFloatDot(Copy(Pts[i], 1, p - 1));
    y := StrToFloatDot(Copy(Pts[i], p + 1, 255));
    Wire.InsertVertex := i + 1;
    Wire.SetState_Vertex(i + 1, Point(MilsToCoord(x), MilsToCoord(y)));
  end;
  RegisterObj(SchDoc, Wire);
  LogOk('wire com ' + IntToStr(Pts.Count) + ' pontos');
  Pts.Free;
end;

procedure PlaceNetLabel(SchDoc: ISch_Document; Line: String);
var
  NL: TObject;
begin
  NL := SchServer.SchObjectFactory(eNetLabel, eCreate_GlobalCopy);
  if NL = nil then
  begin
    LogFail('netlabel ' + JGet(Line, 'net') + ': factory falhou');
    Exit;
  end;
  NL.Location := Point(MilsToCoord(JNum(Line, 'x')), MilsToCoord(JNum(Line, 'y')));
  NL.Orientation := RotToOrient(Round(JNum(Line, 'rot')));
  NL.Text := JGet(Line, 'net');
  RegisterObj(SchDoc, NL);
  LogOk('netlabel ' + JGet(Line, 'net'));
end;

procedure PlacePower(SchDoc: ISch_Document; Line: String);
var
  PW: TObject;
begin
  PW := SchServer.SchObjectFactory(ePowerObject, eCreate_GlobalCopy);
  if PW = nil then
  begin
    LogFail('power ' + JGet(Line, 'net') + ': factory falhou');
    Exit;
  end;
  PW.Location := Point(MilsToCoord(JNum(Line, 'x')), MilsToCoord(JNum(Line, 'y')));
  PW.Orientation := RotToOrient(Round(JNum(Line, 'rot')));
  PW.Style := StyleFromName(JGet(Line, 'style'));
  PW.Text := JGet(Line, 'net');
  PW.ShowNetName := True;
  RegisterObj(SchDoc, PW);
  LogOk('power ' + JGet(Line, 'net'));
end;

procedure PlaceJunction(SchDoc: ISch_Document; Line: String);
var
  J: TObject;
begin
  J := SchServer.SchObjectFactory(eJunction, eCreate_GlobalCopy);
  if J = nil then
  begin
    LogFail('junction: factory falhou');
    Exit;
  end;
  J.Location := Point(MilsToCoord(JNum(Line, 'x')), MilsToCoord(JNum(Line, 'y')));
  RegisterObj(SchDoc, J);
  LogOk('junction');
end;

procedure PlaceText(SchDoc: ISch_Document; Line: String);
var
  L: TObject;
begin
  L := SchServer.SchObjectFactory(eLabel, eCreate_GlobalCopy);
  if L = nil then
  begin
    LogFail('text: factory falhou');
    Exit;
  end;
  L.Location := Point(MilsToCoord(JNum(Line, 'x')), MilsToCoord(JNum(Line, 'y')));
  L.Text := JGet(Line, 's');
  RegisterObj(SchDoc, L);
  LogOk('text "' + JGet(Line, 's') + '"');
end;

{ ------------------------------- rotina principal ------------------------------- }

procedure BuildSchematic;
var
  WS: IWorkspace;
  Prj: IProject;
  ProjDir, ProjFolder, SchFile, Line, T, SheetName, TargetPath: String;
  Src, Syms, Fps, Refs, SheetNames, SheetSizes, Pts, ItemSheets: TStringList;
  i, si, ErrCount, PartId: Integer;
  ServerDoc: IServerDocument;
  SchDoc: ISch_Document;
begin
  if SchServer = nil then
  begin
    ShowMessage('SchServer indisponivel. Abra um documento de esquema qualquer e rode de novo.');
    Exit;
  end;
  WS := GetWorkspace;
  Prj := nil;
  if WS <> nil then
    Prj := WS.DM_FocusedProject;
  if (Prj = nil) or (BaseName(Prj.DM_ProjectFileName) = 'Free Documents') then
  begin
    ShowMessage('Nenhum projeto focado. Crie/abra o .PrjPcb do projeto (File >> New >> Project) e rode de novo.');
    Exit;
  end;

  ProjDir := ResolveProjectDir(FocusedProjectName, False);
  if ProjDir = '' then
    Exit;
  SchFile := ProjDir + '\schematic.js';
  if not FileExists(SchFile) then
  begin
    ShowMessage('Nao achei ' + SchFile + #13#10 + 'Peca o esquema a IA primeiro.');
    Exit;
  end;
  ProjFolder := ExtractFilePath(Prj.DM_ProjectFullPath);

  Report := TStringList.Create;
  Report.Add('AltiumPCBMirror - BuildSchematic');
  Report.Add('Projeto: ' + Prj.DM_ProjectFullPath);
  Report.Add('Fonte:   ' + SchFile);
  Report.Add('Data:    ' + DateTimeToStr(Now));
  Report.Add('');
  OkCount := 0;
  FailCount := 0;

  Src := TStringList.Create;
  Src.LoadFromFile(SchFile);

  { ---------------- PASSO 1: validacao total (nada e criado se houver erro) ---------------- }
  ErrCount := 0;
  Syms := TStringList.Create;  Syms.Sorted := True;  Syms.Duplicates := dupIgnore;  Syms.CaseSensitive := False;
  Fps := TStringList.Create;   Fps.Sorted := True;   Fps.Duplicates := dupIgnore;   Fps.CaseSensitive := False;
  Refs := TStringList.Create;  Refs.Sorted := True;  Refs.Duplicates := dupAccept;
  SheetNames := TStringList.Create;
  SheetSizes := TStringList.Create;
  ItemSheets := TStringList.Create;
  ItemSheets.Sorted := True;
  ItemSheets.Duplicates := dupIgnore;

  for i := 0 to Src.Count - 1 do
  begin
    Line := Trim(Src[i]);
    if not JHas(Line, 't') then
      continue;
    T := JGet(Line, 't');
    if T <> 'sheet' then
      ItemSheets.Add(JGet(Line, 'sheet'));
    if T = 'sheet' then
    begin
      SheetNames.Add(JGet(Line, 'name'));
      SheetSizes.Add(JGet(Line, 'size'));
    end
    else if T = 'comp' then
    begin
      if (JGet(Line, 'ref') = '') or (JGet(Line, 'sym') = '') or
        (not JHas(Line, 'x')) or (not JHas(Line, 'y')) then
      begin
        Report.Add('[ERRO] comp invalido (faltam ref/sym/x/y): ' + Line);
        ErrCount := ErrCount + 1;
      end;
      if JGet(Line, 'footprint') = '' then
      begin
        Report.Add('[ERRO] comp ' + JGet(Line, 'ref') + ': falta footprint (obrigatorio)');
        ErrCount := ErrCount + 1;
      end;
      if (Round(JNum(Line, 'rot')) mod 90) <> 0 then
      begin
        Report.Add('[ERRO] comp ' + JGet(Line, 'ref') + ': rot deve ser 0/90/180/270');
        ErrCount := ErrCount + 1;
      end;
      Syms.Add(JGet(Line, 'sym'));
      Fps.Add(JGet(Line, 'footprint'));
      PartId := 1;
      if JHas(Line, 'part') then
        PartId := Round(JNum(Line, 'part'));
      if PartId < 1 then
        PartId := 1;
      Refs.Add(UpperCase(JGet(Line, 'ref')) + '/' + IntToStr(PartId));
    end
    else if T = 'wire' then
    begin
      Pts := ParsePts(Line);
      if Pts.Count < 2 then
      begin
        Report.Add('[ERRO] wire com menos de 2 pontos: ' + Line);
        ErrCount := ErrCount + 1;
      end;
      Pts.Free;
    end
    else if (T = 'netlabel') or (T = 'power') then
    begin
      if JGet(Line, 'net') = '' then
      begin
        Report.Add('[ERRO] ' + T + ' sem net: ' + Line);
        ErrCount := ErrCount + 1;
      end;
    end;
  end;

  if SheetNames.Count = 0 then
  begin
    Report.Add('[ERRO] nenhuma folha ({"t":"sheet",...}) no schematic.js');
    ErrCount := ErrCount + 1;
  end;
  for i := 0 to ItemSheets.Count - 1 do
    if SheetNames.IndexOf(ItemSheets[i]) < 0 then
    begin
      Report.Add('[ERRO] item com "sheet":"' + ItemSheets[i] + '" sem folha declarada');
      ErrCount := ErrCount + 1;
    end;
  for i := 1 to Refs.Count - 1 do
    if Refs[i] = Refs[i - 1] then
    begin
      Report.Add('[ERRO] ref duplicado: ' + Refs[i]);
      ErrCount := ErrCount + 1;
    end;

  if not OpenSchLib then
  begin
    ShowMessage('Nao consegui abrir a SchLib:' + #13#10 + SCHLIB_FILE + #13#10 +
      'Abra a biblioteca no Altium e rode de novo.');
    Report.Free; Src.Free; Syms.Free; Fps.Free; Refs.Free; SheetNames.Free; SheetSizes.Free; ItemSheets.Free;
    Exit;
  end;
  for i := 0 to Syms.Count - 1 do
    if FindLibSymbol(Syms[i]) = nil then
    begin
      Report.Add('[ERRO] simbolo "' + Syms[i] + '" nao existe na SchLib');
      ErrCount := ErrCount + 1;
    end;

  LoadPcbFpNames;
  if PcbFpNames = nil then
    Report.Add('[AVISO] PcbLib indisponivel - existencia dos footprints NAO conferida')
  else
    for i := 0 to Fps.Count - 1 do
      if PcbFpNames.IndexOf(Fps[i]) < 0 then
      begin
        Report.Add('[ERRO] footprint "' + Fps[i] + '" nao existe na PcbLib');
        ErrCount := ErrCount + 1;
      end;

  if ErrCount > 0 then
  begin
    Report.Add('');
    Report.Add('VALIDACAO FALHOU com ' + IntToStr(ErrCount) + ' erro(s). NADA foi criado.');
    Report.SaveToFile(ProjDir + '\build-report.txt');
    ShowMessage('Validacao falhou com ' + IntToStr(ErrCount) + ' erro(s) - nada foi criado.' + #13#10 +
      'Veja ' + ProjDir + '\build-report.txt');
    if PcbFpNames <> nil then
      PcbFpNames.Free;
    Report.Free; Src.Free; Syms.Free; Fps.Free; Refs.Free; SheetNames.Free; SheetSizes.Free; ItemSheets.Free;
    Exit;
  end;
  Report.Add('Validacao OK (' + IntToStr(SheetNames.Count) + ' folha(s)).');
  Report.Add('');

  { ---------------- PASSO 2: criacao, folha a folha ---------------- }
  for si := 0 to SheetNames.Count - 1 do
  begin
    SheetName := SheetNames[si];
    TargetPath := ProjFolder + SheetName + '.SchDoc';
    if FileExists(TargetPath) then
      if not ConfirmNoYes('Ja existe:' + #13#10 + TargetPath + #13#10#13#10 + 'SOBRESCREVER esta folha?') then
      begin
        LogFail('folha ' + SheetName + ': ja existe e o usuario nao quis sobrescrever');
        continue;
      end;

    ServerDoc := CreateNewDocumentFromDocumentKind('SCH');
    if ServerDoc = nil then
    begin
      LogFail('folha ' + SheetName + ': CreateNewDocumentFromDocumentKind falhou');
      continue;
    end;
    Client.ShowDocument(ServerDoc);
    SchDoc := SchServer.GetCurrentSchDocument;
    if SchDoc = nil then
    begin
      LogFail('folha ' + SheetName + ': documento novo nao ficou focado');
      continue;
    end;
    SchDoc.SheetStyle := SheetStyleFromName(SheetSizes[si]);

    SchServer.ProcessControl.PreProcess(SchDoc, '');
    for i := 0 to Src.Count - 1 do
    begin
      Line := Trim(Src[i]);
      if not JHas(Line, 't') then
        continue;
      if JGet(Line, 'sheet') <> SheetName then
        continue;
      T := JGet(Line, 't');
      if T = 'comp' then
        PlaceComp(SchDoc, Line)
      else if T = 'wire' then
        PlaceWire(SchDoc, Line)
      else if T = 'netlabel' then
        PlaceNetLabel(SchDoc, Line)
      else if T = 'power' then
        PlacePower(SchDoc, Line)
      else if T = 'junction' then
        PlaceJunction(SchDoc, Line)
      else if T = 'text' then
        PlaceText(SchDoc, Line);
    end;
    SchServer.ProcessControl.PostProcess(SchDoc, '');
    SchDoc.GraphicallyInvalidate;

    if not ServerDoc.DoSafeChangeFileNameAndSave(TargetPath, 'SCH') then
    begin
      LogFail('folha ' + SheetName + ': falha ao salvar em ' + TargetPath);
      continue;
    end;
    Prj.DM_AddSourceDocument(TargetPath);
    LogOk('folha ' + SheetName + ' criada e adicionada ao projeto: ' + TargetPath);
  end;

  Report.Add('');
  Report.Add('OK: ' + IntToStr(OkCount) + '   Falhas: ' + IntToStr(FailCount));
  Report.SaveToFile(ProjDir + '\build-report.txt');
  RegenerateProjectsIndex;

  ShowMessage('BuildSchematic concluido.' + #13#10 +
    'OK: ' + IntToStr(OkCount) + '   Falhas: ' + IntToStr(FailCount) + #13#10#13#10 +
    'Relatorio: ' + ProjDir + '\build-report.txt' + #13#10#13#10 +
    'PROXIMOS PASSOS: salve o projeto, rode Project >> Compile,' + #13#10 +
    'e depois Design >> Update PCB (ECO) para levar tudo a placa.');

  Report.Free; Src.Free; Syms.Free; Fps.Free; Refs.Free; SheetNames.Free; SheetSizes.Free; ItemSheets.Free;
  if PcbFpNames <> nil then
    PcbFpNames.Free;
end;
```

- [ ] **Step 2: Substituir os três marcadores `>>> COLE AQUI <<<`** pelos blocos indicados (helpers JSON do ExportBoard/ApplyChanges, PROJ-HELPERS, ParsePts) — todos idênticos às fontes citadas.

- [ ] **Step 3: Adicionar `[Document5]`** ao `.PrjScr` (`DocumentPath=BuildSchematic.pas`, mesmo padrão).

- [ ] **Step 4: Revisão de idiomas** — checar contra a lista do "Contexto essencial": `Replicate`, `AddSchImplementation`, `SchObjectFactory` + `InsertVertex/SetState_Vertex`, `RegisterSchObjectInContainer` + `SCHM_PrimitiveRegistration`, `CreateNewDocumentFromDocumentKind` + `DoSafeChangeFileNameAndSave` + `DM_AddSourceDocument`, `ProcessControl.PreProcess/PostProcess`. Sem try/except; records com variável temporária; nada além da superfície declarada.

- [ ] **Step 5: Commit**

```powershell
git add BuildSchematic.pas AltiumPCBMirror.PrjScr
git commit -m @'
BuildSchematic.pas: schematic.js -> .SchDoc reais no projeto focado

Validacao total antes de criar (simbolos, footprints, refs), simbolos
copiados da SchLib, footprint por componente, fios/labels/powers,
relatorio build-report.txt e ECO nativo como proximo passo.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

### Task 15: README.md e AI-GUIDE.md v2

O AI-GUIDE é o contrato das futuras sessões de IA — precisa cobrir o fluxo novo inteiro. O README é o manual do usuário. Reescrever ambos (o conteúdo v1 sobre PCB/changes.js continua válido e é mantido nas seções indicadas).

**Files:**
- Modify: `README.md`
- Modify: `AI-GUIDE.md`

- [ ] **Step 1: Reescrever `README.md`** mantendo as seções v1 "Por que é fiel", "O que é editável" e "Limitações" (atualizadas) e substituindo o resto por:

  - **Título/resumo**: espelho fiel Altium ↔ HTML agora com bibliotecas, esquema e projeto completo do zero; workspace central em `Z:\AltiumPCBMirror`.
  - **Estrutura do workspace**: a árvore da seção "Estrutura final de arquivos" deste plano (sem a coluna de tasks).
  - **Os 5 scripts** (tabela): ExportLibs (espelha libs → `Libs\`), ExportProject (esquema do projeto → `Projects\<nome>\`), ExportBoard (PCB → `Projects\<nome>\`), BuildSchematic (schematic.js → .SchDoc reais + footprints), ApplyChanges (changes.js → PCB aberta, com undo e `outline_set`). Todos casam o projeto pelo NOME (`.PrjPcb` ↔ pasta em `Projects\`); sem casamento, perguntam com lista numerada.
  - **hub.html**: 4 vistas (Projetos = histórico com esteira esquema→eco→roteada→aplicada; Esquema; PCB; Libs com aviso de símbolo sem footprint). Abre por duplo clique; projetos `_*` são demos.
  - **Fluxo projeto novo do zero** (numerado, igual ao rodapé da vista Projetos): ExportLibs → IA escreve `schematic.js` → conferir no hub → criar `.PrjPcb` homônimo + BuildSchematic → Compile + Design»Update PCB → ExportBoard → IA roteia `changes.js` → ApplyChanges → DRC.
  - **Fluxo projeto existente**: ExportProject (+ ExportBoard) → hub para leitura; edição de PCB como no v1; edição de esquema existente fica para v3.
  - **Limitações v2**: espelho de esquema existente é só leitura; folhas planas (sem hierarquia/harness); sem buses; `outline_set` só com linhas; ERC/DRC/ECO são do Altium; preview de nets do hub é aproximação — a verdade é o compilador.

- [ ] **Step 2: Reescrever `AI-GUIDE.md`** — manter TODO o conteúdo v1 (regras absolutas, sistema de coordenadas mm, formato do changes.js, boas práticas) como a seção "Parte B — PCB (changes.js)", com dois acréscimos: a op `outline_set` na tabela (`pts` obrigatório, `note` opcional; só linhas; exige confirmação do usuário no apply) e a observação de que os arquivos agora vivem em `Z:\AltiumPCBMirror\Projects\<nome>\`. Adicionar antes a "Parte A — Esquema (schematic.js)":

  - **Onde trabalhar**: workspace `Z:\AltiumPCBMirror`; libs espelhadas em `Libs\schlib.js`/`Libs\pcblib.js` (leia SEMPRE antes de escolher componentes); projeto novo = criar `Projects\<nome>\schematic.js` + adicionar entrada em `projects.js` (formato exato da fixture da Task 2, `files.schematic:true` e demais false).
  - **Coordenadas**: mil, Y para cima, origem no canto inferior esquerdo da folha; grade de 100 mil para pinos/fios; rot só 0/90/180/270 + `mirror` (espelha X antes de rotacionar). Ponta quente do pino = `(x,y) + len·dir(orient)` — os fios devem chegar EXATAMENTE nela.
  - **Formato schmirror-v2**: o bloco de exemplo da Task 0 + tabela de campos por item:

    | t | obrigatórios | opcionais |
    |---|---|---|
    | `sheet` | `name`, `size` (A4/A3/A2/A1/A/B/C) | — |
    | `comp` | `sheet`,`ref`,`sym`,`x`,`y`,`rot`,`footprint` | `part` (default 1), `mirror`, `comment` |
    | `wire` | `sheet`,`pts` ([[x,y],...] ≥2, numa linha só) | — |
    | `netlabel` | `sheet`,`net`,`x`,`y` | `rot` |
    | `power` | `sheet`,`net`,`style`,`x`,`y` | `rot` (Bar/Circle/Arrow/Wave/GndPower/GndSignal/GndEarth) |
    | `junction` | `sheet`,`x`,`y` | — |
    | `text` | `sheet`,`s`,`x`,`y` | `h` |

  - **Regras de conectividade** (como o Altium): fio encostado em ponta de pino conecta; extremo sobre segmento = T (conecta); cruzamento sem junction NÃO conecta; netlabel nomeia o fio onde a âncora está; power ports com mesmo nome fundem globalmente. `footprint` é OBRIGATÓRIO em todo comp — se o símbolo tem modelo na lib (`footprints[].current`), use-o; senão escolha na `pcblib.js` conferindo pino↔pad.
  - **Fluxo**: escrever schematic.js → pedir para conferir no hub (vista Esquema valida e mostra as nets) → usuário roda BuildSchematic → ECO → volta para a Parte B (PCB).

- [ ] **Step 3: Commit**

```powershell
git add README.md AI-GUIDE.md
git commit -m @'
Docs v2: README e AI-GUIDE cobrindo libs, esquema e projeto do zero

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 16: Verificação final

**Files:**
- Modify: `C:\Users\Lucas\.claude\projects\z--AltiumPCBMirror\memory\layout-ifm40d24.md` (memória)

- [ ] **Step 1: Rodar toda a bateria**

```powershell
node --check hub-core.js; node --check hub-draw.js; node --check hub-ui.js; node --check schframe.js
node --check Libs/schlib.js; node --check Libs/pcblib.js; node --check projects.js
node --check Projects/_DemoKit/schematic.js; node --check Projects/_DemoKit/board.js; node --check Projects/_DemoKit/changes.js
node tests/test-apply.js; node tests/test-netextract.js; node tests/test-validate.js
```

Esperado: todos exit 0, com `test-apply OK`, `test-netextract OK`, `test-validate OK`.

- [ ] **Step 2: Checklist manual no navegador** (abrir `hub.html`):
  - Projetos: card `_DemoKit` (badge DEMO, esteira "roteada", resumo com contagens).
  - Esquema: folha A4 com os 4 símbolos, clique na trilha VCC destaca P1-1/R1-1/C1-2.
  - PCB: placa 30x20 com diff (D1 fantasma, trilha verde nova, via nova).
  - Libs: LED marcado "✖ sem footprint"; RES mostra símbolo + R0805 lado a lado.

- [ ] **Step 3: Conferir que o `example\` v1 continua intacto** — `git status` não pode mostrar nada em `example\`; abrir `example\viewer.html` ainda funciona (usa o viewer.html original, não alterado).

- [ ] **Step 4: Atualizar a memória** — em `layout-ifm40d24.md`, substituir o parágrafo final da pendência ("Pendencia pedida pelo usuario...") por uma nota: pendência resolvida em 31/07/2026 pelo v2 — ExportBoard agora grava em `Z:\AltiumPCBMirror\Projects\<nome>\`; o fluxo novo (libs/esquema/hub) está no spec `2026-07-31-esquema-projeto-completo-design.md`.

- [ ] **Step 5: Commit final** (se houver ajustes soltos) e resumo para o usuário com os passos que SÓ ele pode fazer no Altium:
  1. `DXP » Run Script » ExportLibs` (uma vez, com as libs acessíveis) — valida schlib.js/pcblib.js reais no hub.
  2. Testar o fluxo completo com um projeto pequeno real (o alvo combinado no brainstorm).
  3. Reportar qualquer FALHA de `build-report.txt`/`apply-report.txt` para a IA corrigir.

---

## Self-review do plano (executado na escrita)

- **Cobertura do spec**: §3 estrutura → Tasks 1-2/7/10-14; §4 contrato mil → Contexto+Tasks 3-5/8; §5.1-5.2 libs → Tasks 1/10; §5.3 schematic.js → Tasks 0/2/11/14; §5.4 outline_set → Tasks 0/3/13; §5.5 projects.js → Tasks 2 + PROJ-HELPERS; §6 scripts → Tasks 10-14; §7 hub 4 vistas → Tasks 7-9; §8 testes → Tasks 3-5/16; §9 limites → README (Task 15). Sem lacunas.
- **Sem placeholders**: todo código está inline; os únicos marcadores `>>> COLE AQUI <<<` apontam para blocos completos presentes NESTE documento (seção PROJ-HELPERS / fontes v1 com linhas citadas).
- **Consistência de nomes**: `HubCore.{applyPcbChanges,extractNets,validateSchematic,buildSchModel,compPinsWorld,deriveStatus,symbolOf,partOf,footprintOf,distSeg,SHEET_SIZES}` e `HubDraw.{drawSymbolPart,symBBox,drawFootprint,drawPowerPort,drawNetLabel,drawJunction,mkCamera,SCH,PCB}` conferidos entre Tasks 3-8; formatos `schlib/pcblib/schematic/projects` idênticos entre fixtures (1-2), hub (7-8) e .pas (10-14); `files.{schematic,board,changes,buildreport,applyreport}` idêntico entre PROJ-HELPERS, fixture e `deriveStatus`.





