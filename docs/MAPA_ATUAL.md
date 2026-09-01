# MAPA_ATUAL — Fase 0 do briefing MCP

> Entregável da Fase 0 de `docs/superpowers/BRIEFING_MCP_ALTIUM.md`. **Nenhum código foi
> escrito nem alterado para produzir este documento.** Levantamento feito lendo os 6 `.pas`,
> os 8 `.js`, o `hubserver.py`, os 4 HTML e os 118 arquivos do repositório, executando as
> suítes de teste e inspecionando os bytes reais dos arquivos em disco.
>
> Estado do repositório no levantamento: branch `laser-furo-fixacao`, HEAD `2fffb60`
> ("Now cutout appear in system"), working tree limpo (único item não rastreado é o próprio
> briefing).

**Regra de leitura:** toda afirmação carrega `arquivo:linha`. Onde não foi possível
confirmar por código, está escrito **NÃO CONFIRMADO** — isso significa que precisa de teste
na bancada, não que é provável.

---

## 0. Resumo executivo — os cinco achados que mudam o plano

1. **Não existe modelo canônico.** O `board.js` é um formato de *arquivo* comum, não um
   modelo em memória comum. Na **mesma página** do hub v2, o mesmo `board.js` é lido por
   **dois parsers, em duas linguagens**, alimentando consumidores com **conteúdos
   diferentes**. Este é o achado que o briefing (§4.3) chama de "o mais importante da Fase 0"
   — e ele muda o plano.

2. **Laser e Neoden exportam a placa SEM o `changes.js`.** A aba Neoden mostra, lado a lado,
   uma vista de PCB que *aplica* as mudanças e um botão que baixa o CSV *sem* elas. A aba
   Laser pelo menos avisa (`hub.html:1952-1955`); a aba Neoden não avisa nada.

3. **A configuração que define o artefato real do laser vive no `localStorage` do
   navegador** (`hub.html:1613,1620,1651`). O critério de aceite da Fase 1 ("diff byte a byte
   contra golden files") é **hoje inverificável** para a saída mais crítica: só dá para
   congelar os *defaults*, nunca o arquivo que a bancada de fato usou.

4. **Não há linha de base verde nem gatilho.** Duas das nove suítes falham desde
   2026-08-04 (~20 dias) e ninguém percebeu, porque não existe `package.json`, runner, CI
   nem git hook. Um golden file adicionado a esta infra herda o mesmo destino.

5. **A "saída HTML" que o briefing manda congelar byte-a-byte não existe como arquivo.**
   `ExportBoard.pas` tem exatamente 5 `SaveToFile` (linhas 411, 1030, 1040, 1051, 1055),
   nenhum de `.html`. O HTML é uma página estática viva que lê os `.js`. As saídas realmente
   *golden-áveis* são **6**, não 4.

---

## 1. Visão geral do fluxo real

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  ALTIUM DESIGNER  (OUTRA MÁQUINA — caminhos UNC \\LUCAS-PC\D\…)  │
   │  DXP » Run Script  →  10 entradas no menu (README diz 4)         │
   │    ExportPcb · ExportSch · ExportLibs · ApplyProject             │
   │    RenameLibs · BuildSym · BuildFp · BuildObs · DoPcb · DoSch    │
   └───────────┬──────────────────────────────────────┬───────────────┘
               │ escreve                              │ lê
               ▼                                      │
   ┌───────────────────────────────────────────────┐  │
   │  WORKSPACE (este repositório)                 │  │
   │  Projects/<nome>/ board.js  ← só leitura      │  │
   │                   changes.js ← dois escritores├──┘
   │                   schematic.js ← dois escrit. │
   │                   annotations.js ← dois escr. │
   │                   pcb-list.csv · *-report.txt │
   │  Libs/ schlib.js · pcblib.js                  │
   │  projects.js  (índice do hub clássico)        │
   └───────┬──────────────────────┬────────────────┘
           │ <script src>         │ regex + json.loads
           ▼                      ▼
   ┌───────────────┐      ┌───────────────┐
   │ pcbframe.html │      │ hubserver.py  │
   │ schframe.html │      │ /api/*.json   │
   │ (iframes)     │      └───────┬───────┘
   │ APLICA changes│              │ board CRU
   └───────────────┘              ▼
                          ┌───────────────┐
                          │   hub.html    │
                          │ aba Laser ────┼──► SVG · .lbrn2   ⚠ sem changes
                          │ aba Neoden ───┼──► CSV Neoden 4   ⚠ sem changes, sem aviso
                          └───────────────┘
```

**A linha tracejada que não existe:** nada no hub, no `hubserver.py` ou em qualquer `.js`
executa um script do Altium. `POST /api/run` recusa tudo que não seja `Rescan`, devolvendo
a dica de menu (`hubserver.py:418-428`). A integração com o Altium é **100% por arquivo**,
e o disparo é **sempre manual pelo usuário**.

---

## 2. §4.1 — Inventário de código

### 2.1 Classificação de cada arquivo

| Arquivo | Classificação | Linguagem | Tamanho | Observação |
|---|---|---|---|---|
| `ExportBoard.pas` | **script Altium** / gerador | DelphiScript | 1079 linhas | Único escritor de `board.js` |
| `ExportProject.pas` | **script Altium** / gerador | DelphiScript | — | Único escritor Altium de `schematic.js` |
| `ExportLibs.pas` | **script Altium** / gerador | DelphiScript | — | Espelha as bibliotecas |
| `ApplyChanges.pas` | **script Altium** / caminho de volta | DelphiScript | 1644 linhas | Aplica `changes.js` na placa |
| `BuildSchematic.pas` | **script Altium** / unidade auxiliar | DelphiScript | 1525 linhas | **Não aparece no menu** (sem procedure sem parâmetro) |
| `RenameLibs.pas` | **script Altium** / **mutador destrutivo** | DelphiScript | — | Não documentado no README |
| `hub-core.js` | **núcleo** + gerador (Neoden) | JS (UMD) | 35 KB | Zero dependências; `require`-ável em Node |
| `hub-laser.js` | **gerador de saída** (máquina) | JS (UMD) | 47 KB | Sem DOM; `require`-ável em Node |
| `hub-font.js` | núcleo (dado geométrico) | JS (UMD) | 11 KB | Único módulo compartilhado tela↔máquina |
| `hub-draw.js` | renderer (canvas) | JS (global + exports) | 10 KB | Sem suíte de teste |
| `hub-io.js` | transporte (persistência) | JS (IIFE, só browser) | 1,4 KB | **Não importável em Node** |
| `hub-ui.js` | UI (hub clássico) | JS (IIFE, só browser) | 9 KB | **Não importável em Node** |
| `pcbframe.js` | UI/editor da PCB | JS (IIFE, só browser) | 58 KB | **Não importável em Node** |
| `schframe.js` | UI/editor do esquema | JS (IIFE, só browser) | 38 KB | **Não importável em Node** |
| `hub.html` | **UI + gerador** | HTML + JS inline | 117 KB | 1650 linhas de `<script>` inline, ~71 funções |
| `hub-classic.html` | UI (v1) | HTML | 107 linhas | 100% `file://` |
| `pcbframe.html` / `schframe.html` | shells das vistas | HTML | — | `document.write` dos `.js` do projeto |
| `hubserver.py` | **servidor** | Python 3 / Flask | 471 linhas | Opcional; hub v2 depende dele para dado real |
| `tests/*.js` (9) + `test_hubapi.py` | testes | JS/Python | — | Scripts soltos, sem runner |
| `example/hub.html`, `example/viewer.html` | **UI fossilizada, mas VIVA** | HTML | — | Servida pela rota curinga; bate na API real |

### 2.2 Pontos de entrada — o que o usuário realmente vê no menu do Altium

Verificado por varredura de `procedure`/`function` **sem parâmetro** (o Run Script do Altium
só lista essas):

| Entrada no menu | Arquivo:linha | O que faz | Documentado? |
|---|---|---|---|
| `ExportPcb` | `ExportBoard.pas:795` | PCB focada → `board.js` + 4 arquivos | Sim |
| `ExportSch` | `ExportProject.pas:515` | Esquema focado → `schematic.js` | Sim (mas o cabeçalho do próprio arquivo diz "ExportProject", que não existe) |
| `ExportLibs` | `ExportLibs.pas:474` | Bibliotecas → `Libs/*.js` | Sim |
| `ApplyProject` | `ApplyChanges.pas:1590` | **Bifurca**: PCB+`changes.js` → aplica; senão `schematic.js` → despeja esquema | Parcialmente (README oscila entre "ApplyChanges" e "ApplyProject") |
| `RenameLibs` | `RenameLibs.pas:510` | Renomeia símbolos/footprints nas bibliotecas mestras | **Não** |
| `BuildSym` | `RenameLibs.pas:63` | *helper interno* — vazou para o menu | Não |
| `BuildFp` | `RenameLibs.pas:220` | *helper interno* — vazou para o menu | Não |
| `BuildObs` | `RenameLibs.pas:394` | *helper interno* — vazou para o menu | Não |
| `DoPcb` | `RenameLibs.pas:411` | **muta a PcbLib** (protegido só por `SIMULAR=True`, `RenameLibs.pas:20`) | Não |
| `DoSch` | `RenameLibs.pas:449` | **muta a SchLib** (mesma proteção) | Não |

> `BuildSchematic.pas` **não tem nenhuma procedure sem parâmetro** — o cabeçalho do arquivo
> (`BuildSchematic.pas:14`), o `README.md:341` e o `AI-GUIDE.md:122` mandam rodar
> "BuildSchematic" pelo Run Script, e isso é impossível. A entrada real é `ApplyProject`.

Os demais `.pas` usam um truque deliberado para esconder helpers do menu: parâmetro
artificial `Dummy: Integer` (`ExportBoard.pas:296` e `:727`). `RenameLibs.pas` não usa esse
truque — daí os 6 itens.

### 2.3 Quem chama quem

- **Entre `.pas`:** só uma chamada — `ApplyChanges.pas:1630` → `BuildSchematic.pas:1197`
  (`BuildSchematicInto`). Possível porque os 6 são documentos do mesmo `AltiumPCBMirror.PrjScr`
  e compartilham escopo. **Consequência não trivial:** há símbolos homônimos duplicados entre
  unidades (`JGet`, `JF`, `BaseName`, `ListProjectDirs`, `RegenerateProjectsIndex`,
  `ResolveProjectDir`) definidos de 2 a 5 vezes, com corpos **diferentes** — o
  `RegenerateProjectsIndex` de `ExportProject.pas:351-355` **não grava a flag `annotations`**,
  enquanto os de `ExportBoard.pas:402`, `BuildSchematic.pas:472` e `ApplyChanges.pas:478`
  gravam. **NÃO CONFIRMADO** qual corpo o engine executa.
- **`.pas` → resto:** nenhuma. Comunicação por arquivo.
- **Hub → Altium:** nenhuma. `hubserver.py:424-425` recusa explicitamente.
- **JS interno:** `pcbframe.js` → `HubCore`, `HubIO`, `HubFont` e `HubLaser.boardCutouts`;
  `schframe.js` → `HubCore`, `HubDraw`, `HubIO`; `hub.html` → `HubCore` (só Neoden),
  `HubDraw`, `HubLaser`. **`hub.html` nunca chama `applyPcbChanges`.**

### 2.4 Como o usuário dispara cada operação

| Operação | Onde | Gesto |
|---|---|---|
| Espelhar PCB | Altium | DXP » Run Script » `ExportPcb` |
| Espelhar esquema | Altium | DXP » Run Script » `ExportSch` |
| Espelhar bibliotecas | Altium | DXP » Run Script » `ExportLibs` |
| Aplicar mudanças / construir esquema | Altium | DXP » Run Script » `ApplyProject` → escolhe pasta numa listbox |
| Subir o hub | terminal | `python hubserver.py` (porta 8000, bind `0.0.0.0`) |
| Editar PCB | hub, vista PCB | Botão **Editar** (`E`) destrava; arrastar/`T`/duplo clique; **Salvar changes** |
| Editar esquema | hub, vista Esquema | Botão **Editar** (`E`); `W` fios, `+ Componente`; **Salvar esquema** |
| Sinalizar problema | hub, ambas as vistas | **⚑ Sinalizar** (`N`) |
| Gerar arte a laser | hub, aba Laser | **Baixar .lbrn2** / **Abrir no LightBurn** / Baixar SVG |
| Gerar CSV do Neoden | hub, aba Neoden | **Baixar TopLayer** / **Baixar BottomLayer** |
| Exportar BOM | hub, aba Componentes | **Exportar BOM** |
| Exportar PCB List pós-mudanças | hub, vista PCB | botão CSV |

---

## 3. §4.2 — Inventário de saídas

**18 artefatos** produzidos. Varredura independente confirmou que **não existe nenhuma saída
de fabricação além do laser e do Neoden**: grep por `.gbr`, `.drl`, `.dxf`, `.nc`, `.tap`,
`.gcode`, `Gerber`, `OutJob`, `NCDrill` em todos os `.pas`/`.js`/`.html`/`.py` = **zero**.
O único lançamento de processo em todo o repositório é `os.startfile` em `hubserver.py:188`.

### 3.1 Saídas que alimentam MÁQUINA FÍSICA (as críticas)

#### 3.1.1 `<projeto>-NEODEN-<Top|Bottom>Layer.csv` — pick-and-place Neoden 4

| Campo | Valor |
|---|---|
| **Arquivo gerador** | `hub-core.js:655-664` (`neodenCsv`), alimentado por `neodenTransform` (`hub-core.js:615`) |
| **Disparo** | `hub.html:2101-2116` (`neodenDownload`), botões `#ndTop`/`#ndBottom` |
| **Formato** | CSV real (vírgula). Cabeçalho `Designator,Footprint,Mid X,Mid Y,Layer,Rotation,Comment` + **segunda linha literal `,,,,,,`** |
| **Consumidor** | Máquina Neoden 4 |
| **Campos** | 7 colunas, ordem fixa |
| **Unidade / origem** | mm com **sufixo literal `mm` colado** e **exatamente 2 casas** (`toFixed(2)`). Origem = componente de **referência** escolhido pelo usuário, depois rotação, depois offset de máquina, depois "mover após N" — nessa ordem (`hub-core.js:637-652`) |
| **Eixo Y** | Para cima, **sem inversão em nenhuma etapa** |
| **Rotação** | Graus, anti-horário, referenciada à **origem do componente** (`Location X/Y`), copiada **crua** de `Comp.Rotation`. A rotação da placa move só as posições, nunca a coluna Rotation (`tests/test-neoden.js:52`) |
| **Terminador / encoding** | **CRLF**, inclusive no fim do arquivo. **UTF-8 sem BOM** (Blob do browser) |
| **Tolerância a mudança** | **Zero.** Trate separador, sufixo `mm`, 2 casas, linha `,,,,,,`, literal `T` e CRLF como contrato |

**Descobertas que resolvem dúvidas em aberto:**
- Existe **golden file real fora do repositório**: `D:\MICROCONTROLLER_DEV\MSC - CODIGOS\Neoden4-Altium\`
  contém `neodenAltium.py` (o script de produção original), os CSV de entrada e
  `Output/DI251864-NEODEN-TopLayer.csv` (3,5 KB) e `-BottomLayer.csv` (65 B). **Verificado em disco.**
- A coluna `Layer` sai com o literal **`T` mesmo no arquivo BottomLayer** — isso **não é bug**,
  é paridade deliberada: `neodenAltium.py:146` tem `"T,"` hardcoded e usa o parâmetro `_side`
  só para filtrar e nomear o arquivo. Continua sendo uma pergunta legítima *sobre a máquina*.
- O lado Bottom **não espelha X nem ajusta rotação** — também paridade
  (`neodenAltium.py:34` documenta "Y-flip Bottom Side Components = Unticked").
- **Divergência de arredondamento medível:** o hub usa `toFixed(2)` (empate para cima),
  o script usa `round(Decimal(x),2)` (half-even). Diferem em `.125`/`.375`/`.625`/`.875`.
  Erro máximo 0,005 mm.
- **Divergência de comportamento:** o script sempre grava os dois arquivos (o Bottom real
  tem 65 B: só cabeçalho); o hub **recusa** o download quando o lado está vazio
  (`hub.html:2106-2108`).
- **Não existe** tratamento de DNP/não-montar em lugar nenhum (grep repo-wide = 0). O
  `board.js` não exporta o atributo.
- O filtro de PTH é **manual** e a lista de excluídos vive em `localStorage`
  (`altiumhub.neoden.excl.<id>`, `hub.html:996-1005`). Trocar de navegador devolve os PTH ao CSV **em silêncio**.

#### 3.1.2 `<projeto>-LASER-<lado>[-negativo][-espelhado].lbrn2` e `.svg` — LightBurn

| Campo | `.lbrn2` (botão primário) | `.svg` |
|---|---|---|
| **Gerador** | `hub-laser.js:978` (`lbrn`) | `hub-laser.js:853` (`svg`) |
| **Consumidor** | LightBurn 1.6 / galvo MOPA 60 W | LightBurn (File » Import) |
| **Unidade** | mm (o formato **não declara unidade**); `frequency` em **Hz** (kHz×1000), `QPulseWidth` em ns, booleanos `1`/`0` | mm explícito: `width="Xmm" height="Ymm"` + `viewBox` idêntico |
| **Origem** | canto **inferior**-esquerdo da bbox da arte | canto **superior**-esquerdo |
| **Eixo Y** | **para CIMA** (não inverte) | **para BAIXO** (inverte uma vez, `hub-laser.js:796`) |
| **Espelho** | só em X, só na emissão | idem |
| **Casas decimais** | `toFixed(4)` com zeros à direita removidos → **0 a 4 casas variáveis** | idem |
| **Tolerância** | **Baixa e já provada em campo**: sob `FormatVersion="1"` só a forma **condensada** (`VertList`/`PrimList`) é lida — o formato legado abriu com camadas certas e **zero geometria** | **Média**, mas a **cor exata da paleta é load-bearing** (é o que separa camadas no import) e precisa estar em **cada elemento**, não num grupo |

**Arquitetura do gerador (relevante para a Fase 1):** o módulo **não emite as primitivas
cruas**. Rasteriza tudo num bitmap de cobertura, traça o contorno por marching squares e
simplifica com Douglas-Peucker — porque o LightBurn **não grava a área comum** de formas que
se sobrepõem parcialmente na mesma camada de Fill, o que abriria um buraco em cada junção
trilha/pad (`hub-laser.js:5-8`). O mesmo bitmap serve para o negativo, o recorte pelo
contorno e os furos de fixação.

**A configuração de bancada (9 camadas C00–C08, com velocidade, potência, frequência,
passagens globais e q-pulse) é totalmente editável pela UI e persistida em
`localStorage['altiumhub.laser.<projId>']`** (`hub.html:1613,1620,1651`). Os defaults estão em
`hub-laser.js:78-107`. **Isto é o bloqueador nº 1 da Fase 1** — ver §6.

**Terceiro caminho de entrega:** `POST /api/laser-open` (`hubserver.py:159-194`) grava em
`<ROOT>/Laser/` e chama `os.startfile`. Restrito a `127.0.0.1`. `Laser/` está no `.gitignore`
e **não existe em disco hoje**.

### 3.2 Demais saídas

| Nome | Gerador | Formato | Consumidor | Unidade/origem | Tolerância |
|---|---|---|---|---|---|
| `board.js` | `ExportBoard.pas:1030` | `var pcbmirror = {…};` | hub, IA | mm, Y↑, origem da placa | Alta (é JS avaliado) |
| `changes.js` (esqueleto) | `ExportBoard.pas:1040` | `.js` | IA, `ApplyChanges` | — | **Nunca sobrescrito** se já existe |
| `annotations.js` (esqueleto) | `ExportBoard.pas:1051` | `.js` | usuário, IA | — | **Nunca sobrescrito**; não documentado no README |
| `pcb-list.csv` | `ExportBoard.pas:1055` | **TSV** (extensão mente) | pessoa / Smart Grid Insert do Altium | mm, mesma origem | **Sem escaping algum**; ANSI/Latin-1 + CRLF |
| `projects.js` | 4 scripts diferentes (`ExportBoard.pas:411`, `ApplyChanges.pas:487`, `BuildSchematic.pas:481`, `ExportProject.pas:362`) | `.js` | só o hub **clássico** | — | Reescrito **inteiro** a cada execução |
| `schematic.js` | `ExportProject.pas:575` **ou** `hub-core.js:540` | `.js` | `BuildSchematic`, hub, IA | **mil**, Y↑, canto da folha | Um item por linha, obrigatório |
| `Libs/pcblib.js` | `ExportLibs.pas:535` | `.js` | hub, IA | mm, coordenadas **locais** do footprint | Alta |
| `Libs/schlib.js` | `ExportLibs.pas:585` | `.js` | hub, IA | **mil**, locais do símbolo | Alta |
| `Libs/libs-report.txt` | `ExportLibs.pas:596` | texto | pessoa | — | ANSI cru (não é UTF-8 válido) |
| `Libs/rename-report.txt` | `RenameLibs.pas:533` | texto | pessoa | — | **Não existe em disco**; não está no `.gitignore` |
| `apply-report.txt` | `ApplyChanges.pas:1502` | texto | pessoa, IA | mm nos ecos | ANSI + CRLF; **separador decimal do locale** (vírgula em pt-BR!) |
| `build-report.txt` | `BuildSchematic.pas:1362` e `:1513` | texto | pessoa, hub (só mtime) | mil | ANSI + CRLF |
| `.SchDoc` (modificado) | `BuildSchematic.pas:1488` | binário Altium | Altium / ECO | mil | Salvo em disco pelo script |
| `.SchLib` / `.PcbLib` (mutadas) | `RenameLibs.pas:537-540` | binário Altium | Altium e **todos os projetos existentes** | — | **Sem backup, sem confirmação** |
| `pcb-list-updated.csv` | `pcbframe.js:1228` | TSV, download | pessoa | mm, **`toFixed(4)` fixo** | Diverge do `pcb-list.csv` do Altium |
| `bom.csv` | `hub.html:2090` | TSV, download | pessoa | — | Alta |
| `/api/index.json`, `/api/project/<id>.json` | `hubserver.py:405`/`:410` | JSON HTTP | `hub.html` | mm ou mil conforme a fonte | Alta |
| `__pycache__/hubserver.*.pyc` | import do Python | binário | — | — | Ignorado pelo git |

---

## 4. §4.3 — Formato de dados intermediário

### A resposta: **não existe.**

O `board.js` é um **formato de arquivo** comum, não um **modelo em memória** comum. A prova
é direta e está na mesma página:

| Consumidor | Como lê o `board.js` | Aplica `changes.js`? |
|---|---|---|
| Vista PCB (`pcbframe.html`, também embutida na aba Neoden) | `<script src>` avaliado pelo **motor JS do browser** (`pcbframe.html:257`) | **Sim** (`pcbframe.js:103`) |
| Aba Laser (`hub.html`) | `S.detail.board`, vindo do **parser Python** (`hubserver.py:200-207`) | **Não** |
| Aba Neoden (`hub.html`) | idem | **Não** |

São **três mecanismos de leitura em cinco sítios** para o `board.js`:

1. `<script>` do browser — `pcbframe.html:257` e `hub-ui.js:90`
2. `new Function(...)` — `tests/load.js:5` (só testes)
3. regex + `json.loads` — `hubserver.py:200-207` (chamado em `:237` e `:298`)

E mais **três parsers artesanais em DelphiScript** para os formatos irmãos:
`ApplyChanges.pas:99-155` (`JGet`, para `changes.js`), `BuildSchematic.pas:147-204` (idem,
para `schematic.js`) e `NameFieldOf` em **quatro cópias** (`ExportBoard.pas:199`,
`ExportProject.pas:151`, `ApplyChanges.pas:275`, `BuildSchematic.pas:269`).

### O motor que existe é único, mas parcial e pouco usado

`HubCore.applyPcbChanges` (`hub-core.js:31-203`) é o único motor de mudanças, e tem
exatamente **dois chamadores em produção**: `pcbframe.js:103` e `:133`. `hub.html` — que
hospeda as duas saídas de máquina — **nunca o chama**.

Além disso, o "modelo efetivo" que ele devolve é **parcial**: embrulha só
`components`/`tracks`/`arcs`/`vias`/`texts` (`hub-core.js:34-45`). Ficam de fora
**`regions`, `freepads`, `silk`, `cutouts`, `nets`, `bbox` e `outline`** — e por isso todo
consumidor volta ao objeto cru em ~30 sítios (`pcbframe.js:312,346,365,667,685,692,1283-1286`;
`hub-laser.js:148-149,304-308,323-327,337-347,367-375`).

Consequência concreta: `hub-core.js` precisa **exportar helpers de transformação**
(`compDelta`, `xfPoint`, `xfAngle`, `ownerDelta`) porque o modelo nunca materializa a
geometria movida — cada consumidor aplica o delta na hora de desenhar. E `drawRegion`
(`pcbframe.js:571-583`) **não aplica delta nenhum**: mover um componente com zona de cobre
mostra na tela uma placa fisicamente impossível.

**Portanto:** o modelo canônico da Fase 1 tem de ser **maior** que o modelo que existe hoje,
não uma formalização dele.

### O núcleo já é importável fora do browser — testado

Verificado com `node -e "require(...)"` em cada arquivo:

| Módulo | `require()` em Node | Exports |
|---|---|---|
| `hub-core.js` | ✅ | 30 |
| `hub-laser.js` | ✅ | 31 |
| `hub-font.js` | ✅ | 4 |
| `hub-draw.js` | ✅ | 12 |
| `hub-io.js` | ❌ `location is not defined` | — |
| `hub-ui.js`, `pcbframe.js` | ❌ `document is not defined` | — |
| `schframe.js` | ❌ `SCH_P is not defined` | — |

**Geração headless já funciona hoje, sem escrever uma linha de infra**, a partir de
`Projects/TCMS_Reader/board.js`: SVG 297.415 B, `.lbrn2` 682.513 B, CSV Neoden 944 B — e
**byte-determinística** (mesmos SHA-1 em duas execuções; zero ocorrências de
`Date`/`Math.random`/`toLocale` em `hub-laser.js` e `hub-core.js`).

**O que impede um MCP headless hoje não é o DOM.** São três coisas *fora* do núcleo:
1. **Leitura** — não existe carregador compartilhado publicado (só `tests/load.js`, 7 linhas).
2. **Configuração** — a lista de camadas do laser e as exclusões do Neoden vivem no
   `localStorage`; o resto das opções do Neoden vem direto do DOM (`hub.html:1030-1038`).
3. **Linguagem** — não há implementação Python dos geradores. Um MCP em Python teria de
   fazer shell-out para node ou **reimplementar** — exatamente o que a restrição nº 1 do
   briefing proíbe.

---

## 5. §4.4 — Caminho de volta (hub → PCB List do Altium)

### 5.1 Como funciona

1. Usuário destrava a vista PCB (**Editar**, `E`) e arrasta/edita.
2. Cada gesto vira um objeto no array `changes` em memória, com os campos `orig_*` copiados
   de `m.src` (o `board.js` cru). Mapa gesto→op em `pcbframe.js:214-275, 778-902`.
   `upsertEdit` (`pcbframe.js:229-243`) garante idempotência; voltar o objeto à posição
   original **remove** a mudança (`sameCompPos`, `pcbframe.js:211-220`).
3. **Salvar changes** → `HubCore.serializeChanges` (`hub-core.js:505-528`) →
   `HubIO.saveFile` → `POST /api/save` → `hubserver.py:146-150` grava com `tmp` + `os.replace`.
   Sem servidor, vira **download** para o usuário substituir à mão.
4. Usuário roda **`ApplyProject`** no Altium; escolhe a pasta numa listbox.
5. `ApplyChangesInto` (`ApplyChanges.pas:1409`) lê o arquivo linha a linha e aplica.
6. Relatório em `apply-report.txt`; o usuário roda o DRC e **re-exporta** manualmente.

### 5.2 O que o script espera receber

- **Um objeto JSON plano por linha.** Objetos aninhados ou "pretty-printed" são
  **ignorados em silêncio** (`ApplyChanges.pas:1452-1453`). Única exceção de aninhamento:
  `pts` do `outline_set`, e ainda assim na mesma linha.
- **14 operações** (`ApplyChanges.pas:1458-1487`): `comp_move`, `track_edit/add/del`,
  `via_edit/add/del`, `arc_edit/add/del`, `text_edit`, `designator_move`, `outline_set`,
  `comp_attr`. O cabeçalho do próprio arquivo lista só 13 (esquece `comp_attr`).
- **Campos `orig_*` para toda edição/remoção.** Eles **não são só conferência — são a chave
  de busca**: `FindTrack`/`FindVia`/`FindArc`/`FindFreeText` varrem a placa procurando o
  primeiro objeto que casa dentro da tolerância e **param no primeiro acerto**
  (`ApplyChanges.pas:667-771`). **Não há detecção de ambiguidade.**
- **Tolerâncias:** 0,001 mm para posição/largura/raio (`TOL_MM`, `ApplyChanges.pas:24`),
  0,01 grau para ângulos (`NearAngle`, `:574`), e **0,01 mm** para a pós-checagem de texto
  (`:1237`) — três tolerâncias diferentes no mesmo fluxo.
- **Separador decimal:** obrigatoriamente **ponto**.

### 5.3 Aplica tudo ou só o que mudou? É atômico?

| Pergunta | Resposta |
|---|---|
| Aplica tudo ou o diferencial? | Aplica **tudo o que estiver no arquivo**, na ordem do arquivo. Exceção: `comp_attr` é adiado para uma segunda passada (`:1484-1485`, `:1490-1492`) — confirmado o que o AI-GUIDE afirma. |
| Rejeição é do lote ou da linha? | **Da linha.** Todo caminho de falha é `LogFail` + `Exit` dentro do `Do*`; o laço principal (`:1447`) **não tem `break`, `abort` nem rollback**. **Não existe passada de validação prévia.** |
| É atômico? | Parcialmente. `PCBServer.PreProcess` (`:1445`) / `PostProcess` (`:1494`) envolvem tudo, e cada objeto modificado/criado segue o protocolo `SendMessageToRobots`. **Mas as remoções não**: `track_del` (`:957`), `via_del` (`:1051`) e `arc_del` (`:1166`) chamam só `Board.RemovePCBObject`, **sem `PCBM_BoardDeRegisteration` e sem `DestroyPCBObject``. Se o Ctrl+Z cobre esses deletes é **NÃO CONFIRMADO** — precisa de teste na bancada. |
| Se falhar no meio? | **Não há `try/except` em nenhum ponto do arquivo.** Uma exceção entre `:1445` e `:1494` pula o `PostProcess` (transação de undo fica aberta), pula o `SaveToFile` do relatório e vaza os `TStringList`. Placa meio alterada **e sem relatório nenhum**. |
| Backup? | **Nenhum.** Zero `CopyFile`/`Board.Save`. O `.PcbDoc` fica **sujo e não salvo** — o que é ao mesmo tempo a rede de segurança real ("fechar sem salvar") e o risco. |
| Confirmação? | **Uma só**, e só no `outline_set`: digitar "SIM" (`:1374`). Nenhuma outra operação pergunta nada. |
| Re-exporta o espelho depois? | **Não.** Mostra um `ShowMessage` pedindo que o usuário rode o DRC e o `ExportPcb` à mão (`:1510`). **O espelho fica velho no instante seguinte à aplicação.** |
| O `changes.js` é consumido? | **Não.** Continua idêntico no disco. Rodar de novo: os `*_edit`/`*_del` são rejeitados pelos `orig_*` (bom), mas **`track_add`/`via_add`/`arc_add` duplicam os objetos em silêncio** — não há guarda nenhuma nos adds. |

### 5.4 O outro caminho de volta: esquema

`schframe.js` **não tem camada de intenção**. Não existe arquivo de changes para o esquema:
a vista muta `schematic.items` **in place** (`schframe.js:179,210,242-244,334-349`) e o
Salvar **reescreve o arquivo inteiro**. Não há `orig_*`, não há rastreabilidade e não há
conferência contra o estado real. `BuildSchematic` então **apaga** fios/rótulos/power
ports/junctions da folha (após confirmação digitada) e redespeja.

---

## 6. §4.5 — Riscos e pontos frágeis

Ordenados por severidade. **Os piores são *atravessados*** — nascem da divergência entre dois
módulos, não dentro de um.

### 6.1 Severidade ALTA

**R1 · IDs posicionais + duas estratégias de busca incompatíveis**
`ExportBoard.pas:893-920` · `hub-core.js:87,114,133,158` · `ApplyChanges.pas:667-741`
Os ids (`t<N>`, `v<N>`, `a<N>`, `x<N>`…) são **contadores incrementados na ordem do
`BoardIterator`**. Rotear uma trilha a mais e re-exportar desloca todos os `t<N>` seguintes.
O hub localiza por `byId[ch.id]`; o `ApplyChanges` **ignora o id** (usa só como rótulo no
relatório) e localiza por **geometria**.
*Como quebra em silêncio:* com um `changes.js` de ontem, a tela destaca a trilha **errada**
(com um aviso perdido numa lista lateral) e o Altium aplica na trilha **certa**, logando `[OK]`.
Tela e máquina discordam e nada nomeia a causa.
> O comentário em `hub-core.js:71-72` afirma que "no motor JS a ordem não importa — tudo
> procura pelo ref". **Está errado**: só `comp_move` e `comp_attr` usam ref.

**R2 · Laser e Neoden exportam sem o `changes.js`**
`hub.html:1612,1909,2007,1065,2102` contra `hub.html:1051` + `pcbframe.js:103`
O usuário move um componente, vê a posição nova no iframe embutido **da própria aba Neoden**,
clica em "Baixar TopLayer" e leva para a máquina o CSV com a posição **antiga**. A aba Laser
avisa quando há pendências (`hub.html:1952-1955`); **a aba Neoden não avisa nada**.

**R3 · Conferência `orig_*` é `warn` no hub e `err` no Altium**
`hub-core.js:62,79,98,120,143,168,181` (todas chamam `warn()`) contra
`ApplyChanges.pas:817-818,862,971` (`LogFail` + `Exit`)
O mesmo teste é um aviso lateral de um lado e rejeição dura do outro. O usuário vê o preview
"certo" e a máquina faz outra coisa. Nenhum teste cobre a diferença.

**R4 · Codec de escape assimétrico entre `JS()` e `JGet` — com dado real no acervo**
`ExportBoard.pas:64-70` emite `\b`, `\f`, `\r`; `ApplyChanges.pas:125-138` decodifica só
`\n`, `\t` e `\uXXXX` — o resto volta como a **letra**.
Há texto de serigrafia multilinha (`\r\n`) em **7 dos 11** `board.js`
(ex.: `Projects/MID - DI261897…/board.js:2024`). Qualquer `text_edit` sobre esses textos é
**impossível de aplicar**: `FindFreeText` compara `Prim.Text = Txt` por igualdade exata e
nunca casa. O relatório diz "texto original nao encontrado" e o usuário re-exporta, o que
não resolve.

**R5 · `Chr()` acima de 255 nos parsers `.pas`**
`hub-core.js:472-474` escapa **tudo** ≥ U+007E como `\uXXXX`; `ApplyChanges.pas:131-134` faz
`Chr(StrToInt('$'+Hex))`, que cobre 0..255. Travessão, aspas curvas, reticências ou símbolo
de ohm num `note`/`text`/`comment` estouram.
*Não quebra em silêncio — quebra alto, no pior momento:* sem `try/except`, a exceção deixa a
transação de undo aberta, pula o relatório e vaza os `TStringList`. **O "silencioso" é a
ausência do `apply-report.txt`.**

**R6 · Vírgula decimal é aceita e descartada: `"12,7"` → `127`**
`ApplyChanges.pas:53-80` e `BuildSchematic.pas:101-128` (`StrToFloatDot` não tem ramo para
`Ord 44`). Erro de uma ordem de grandeza aplicado como `[OK]`.
**E o ciclo se fecha sozinho:** o `apply-report.txt` escreve os centros medidos com
`FloatToStr`, que em pt-BR emite **vírgula** (`:1239,1242,1318,1321`) — copiar esse número de
volta para o `changes.js` produz o erro.

**R7 · `comp_move` sem `x` ou sem `y` teleporta o componente para a origem**
`ApplyChanges.pas:834` — o `MoveToXY` é **incondicional**, enquanto `layer` (`:823`) e `rot`
(`:831`) são protegidos por `JHas`. Chave ausente → `JGet` devolve `''` → `StrToFloatDot('')`
devolve `0`. Logado como `[OK]`.
O `AI-GUIDE.md:190` lista `x` e `y` como **opcionais** de `comp_move` — divergência direta
com o código. O hub protege; um `changes.js` escrito pela IA não passa por lá.

**R8 · Objeto quebrado em mais de uma linha some sem entrar em contagem nenhuma**
`ApplyChanges.pas:1449-1453` — nem loga, nem incrementa `Recognized`. O diálogo final diz
"Reconhecidas: 0 / Aplicadas: 0 / Falhas: 0": **três zeros com cara de sucesso**. É o modo de
falha mais provável de um arquivo escrito por ferramenta que formata JSON.

**R9 · Bottom no laser sem espelho = placa perdida**
`hub.html:1622` restaura `side` e `mirror` crus do `localStorage`; `hub-laser.js:1017-1026`
(`checkOpts`) **nunca olha o par side×mirror**; `autoMirror` só age no clique do botão de lado.
O arquivo sai geometricamente perfeito e fisicamente invertido — e **sem o sufixo
`-espelhado`**, então `PLACA-LASER-Bottom.lbrn2` parece o arquivo certo. Só se descobre na bancada.

**R10 · Ordem de execução do laser depende de uma preferência do LightBurn, não do arquivo**
`hub-laser.js:982-1007` não emite `<UIPrefs>`; o arquivo de referência
(`Color_Test_60W_MOPA.lbrn2:11-26`) tem `<Optimize_ByPriority Value="1"/>` explícito.
Toda a documentação afirma "a ordem aqui é a ordem em que a máquina roda". Se a instalação
estiver em "order by layer", **o corte da borda pode rodar antes da gravação** e a placa se
solta antes de estar pronta.

**R11 · Serigrafia com `X` ou `Z` maiúsculo é gravada como um RETÂNGULO**
`hub-font.js:14` — enumerei os 43 glifos e **faltam exatamente `X` e `Z` maiúsculos**.
**Verificado por execução:** `textPolylines('X')` e `textPolylines('Z')` devolvem 1 polilinha
de 5 pontos (a caixa de fallback), enquanto `'x'` minúsculo devolve 2 polilinhas corretas.
**Verificado no acervo:** 3 projetos afetados — `PACI-DI221687` (textos `X` e `Z`),
`SD - DI251838` (`RXD0`, `TXD0`), `VDCB - DI251879` (designator `DZ1`).
A caixa é geometria válida: passa pelo raster, pelo marching squares, pelo Douglas-Peucker e
chega ao arquivo **sem uma única mensagem**. E a prévia usa as mesmas funções, então a tela
mostra o retângulo também — parecendo elemento de arte proposital.

**R12 · `RenameLibs` com `SIMULAR=False` renomeia e SALVA as bibliotecas mestras sem backup**
`RenameLibs.pas:20,434,440,473,493,537-540`
O único freio é uma constante no fonte. 152 símbolos + 170 footprints + 11 marcações
`ZZ-OBSOLETO` aplicados e as duas `.SchLib`/`.PcbLib` gravadas em disco imediatamente.
Sem diálogo, sem cópia de segurança, sem script de reversão.
**Agravante 1:** rodar de novo depois de aplicar **apaga o único registro** — nenhuma linha é
logada (os nomes já são os novos) e o relatório é sobrescrito vazio.
**Agravante 2:** `DoSch` repontua o footprint dos símbolos para o substituto do merge
(`LED 5MM - RED` → `LED 5MM - GREEN`, `TO-225AA` → `TO-126`, `TO-263-5` → `DDPAK-5`). Se
algum par não for geometricamente idêntico, todo projeto novo sai com o footprint errado.
**Agravante 3:** `DoPcb` e `DoSch` **aparecem no menu do Run Script** como itens
independentes.

**R13 · O espelho `Libs/*.js` não foi produzido pelo `ExportLibs` e diverge do próprio relatório**
`Libs/libs-report.txt` diz "Símbolos: 402 Footprints: 629" com a **mesma data**
(06/08/2026 08:39:59) em que `schlib.js` diz 401 e `pcblib.js` diz 618. O commit `96a1de6`
alterou os `.js` e **não** alterou o `.txt` — os espelhos foram editados **fora do Altium**
para aplicar os renames.
*Consequência:* **não há garantia de que as bibliotecas REAIS tenham os nomes novos.** A IA e
o hub podem estar escolhendo nomes (`FIO`, `DIODO SCHOTTKY [SMD]`) que não existem na
`.SchLib`/`.PcbLib` de verdade. Rodar `ExportLibs` agora é o único jeito de saber — e pode
reverter o espelho inteiro.

**R14 · Se alguém fixar casas decimais no `board.js`, a trava `orig_*` rejeita TUDO**
`ExportBoard.pas:34-37` (sem casas fixas) · `ApplyChanges.pas:24` (`TOL_MM = 0.001`)
Aritmética: 3 casas → desvio máximo 0,0005 mm (passa raspando); 2 casas → 0,005 mm = **cinco
vezes a tolerância**. Há **46.866 coordenadas com 5 casas e 421 com 6 casas** nos `board.js`
do repo. O sintoma não aponta para a causa: o relatório enche de "não casa com `orig_*`
(re-exporte o espelho)", o usuário re-exporta e piora.
*Ponto tranquilizador:* hoje o hub **não** arredonda os `orig_*` — `r4` (`pcbframe.js:108`)
só toca os campos novos. Mas nada no código trava isso.

**R15 · Três regimes de encoding e dois de terminador convivendo**
- Delphi grava **ANSI/cp1252 + CRLF**; `hubserver.py:148` grava **UTF-8 + LF**.
- Os `.js` gerados pelo Altium são **ASCII puro** (o `JS()` escapa `Ord > 125`), mas
  `pcb-list.csv` e os `*-report.txt` saem em **Latin-1 cru** (byte `0xC7` solto em
  `Projects/PACI-DI221687/pcb-list.csv`).
- `Libs/rename-map.js` é **UTF-8 cru com mojibake** — 22 linhas com `U+FFFD`.
*Dois sintomas:* (1) o git mostra o arquivo inteiro alterado a cada troca de escritor,
escondendo a mudança real — **a revisão humana quebra antes do código**; (2) se a IA escrever
um acento literal num `orig_text`, a comparação exata do `.pas` nunca casa.

**R16 · `annotations.js`: o usuário apaga em silêncio as respostas da IA**
`pcbframe.js:68-83` e `schframe.js:673-688` gravam **direto, sem reler o disco** — ao
contrário de `changes.js` e `schematic.js`, que fazem `fetchText` + comparação byte a byte
antes (`pcbframe.js:184-186`, `schframe.js:371-374`).
É **exatamente** o arquivo de ida-e-volta com a IA, e é o único sem trava. A IA resolve três
sinalizadores; o usuário, com a aba aberta desde antes, adiciona um novo e salva: os três
voltam a `open` com `reply` vazio. Sem diálogo, sem aviso, sem backup.

**R17 · Notação científica MAIÚSCULA em coordenadas reais**
`Projects/prototipo/board.js:221` tem `-1E-5`; `Projects/SD - DI251838/board.js` tem
`1.69420616440918E-14`. Vem do `FloatToStr` do Delphi. `JSON.parse` aceita, mas **qualquer
regex de número ingênua quebra** — e se o hub reserializar via `JSON.stringify`, `-1E-5` vira
`-0.00001` e o arquivo deixa de ser byte-idêntico ao do Altium.

**R18 · 17 caminhos hardcoded para uma máquina específica, em 6 arquivos**
UNC `\\LUCAS-PC\D\…` em 11 constantes (`ApplyChanges.pas:22-23`, `BuildSchematic.pas:19-20`,
`ExportBoard.pas:21-22`, `ExportLibs.pas:18-19`, `ExportProject.pas:15-16`,
`RenameLibs.pas:23`) e drive `Z:` em 6 (`BuildSchematic.pas:21-22`, `ExportLibs.pas:20-21`,
`RenameLibs.pas:21-22`). Zero no `hubserver.py`, zero no JS.
*Pior modo de falha:* se o UNC responder mas apontar para uma **cópia antiga** do workspace,
tudo funciona e o Altium lê/grava o espelho errado sem uma única mensagem.

**R19 · `BuildSchematic` não cria `.SchDoc`, ao contrário do que toda a documentação afirma**
`BuildSchematic.pas:977-1001` exige um `.SchDoc` **pré-existente** do projeto focado; se não
houver, desiste com "Crie uma folha de esquema (File » New » Schematic)". Não há
`CreateNewDocument` nem `AddSourceDocument` no arquivo (grep = 0).
Isso quebra a promessa central do "fluxo projeto novo do zero" (`README.md:334-337`), onde o
usuário cria um `.PrjPcb` **vazio**. O `ProjFolder` morto em `BuildSchematic.pas:1230` é o
fóssil dessa funcionalidade removida.

**R20 · O despejo do esquema vai para "o Sch que estiver focado", não para o escolhido**
`BuildSchematic.pas:1390-1402` — `Client.OpenDocument` + `ShowDocument`, e então
`SchServer.GetCurrentSchDocument`. Se o foco não migrar, o despejo destrutivo (limpeza + N
componentes) vai para o esquema **errado**, e a prova por `FileAge` (`:1499-1508`) é feita no
`TargetPath`: vai reportar "o arquivo NÃO mudou em disco", **escondendo que outro arquivo foi
alterado**.

**R21 · Componente reaproveitado não recebe footprint, comment nem símbolo novos**
`BuildSchematic.pas:738-742` — o `Exit` acontece **antes** de `NewComp.Comment.Text` e do
`SetFootprint`. Editar o footprint no `schematic.js` e re-despejar **não muda nada**, e o
relatório ainda loga `[OK] já existia - será reposicionado`.

**R22 · Duas suítes vermelhas há ~20 dias, sem nenhum gatilho no repositório**
`tests/test-validate.js:11` (4 erros onde esperava 0) e `tests/test-netextract.js:10`
(`TypeError` antes do primeiro assert). **Causa raiz confirmada por arqueologia de commits:**
no commit `f2cb1d1` (2026-08-04) `Libs/schlib.js` passou de 4 símbolos sintéticos para o dump
real de 401, e `Projects/_DemoKit/schematic.js` continua apontando para `CONN2`/`RES`/`CAP` e
`LED0805`, que hoje se chamam `RES [SMD]`, `RES 0805` etc.
**Não existe** `package.json`, npm script, CI (`.github` não existe), git hook não-sample
(`.git/hooks` só tem `.sample`) nem `.claude/` com conteúdo (está **vazia**).

**R23 · Servidor sem autenticação em `0.0.0.0` com rota curinga**
`hubserver.py:470` + `:125-127`. Qualquer máquina da LAN lê o workspace inteiro (incluindo os
`.pas` com o UNC embutido) e, via `POST /api/save`, **sobrescreve** `changes.js`/`schematic.js`/
`annotations.js` de qualquer projeto — sem log, sem backup, sem versionamento.

### 6.2 Severidade MÉDIA (resumo)

| # | Risco | Onde |
|---|---|---|
| R24 | `FindVia` identifica a via **só por (x,y)**, em todas as camadas, parando no primeiro acerto | `ApplyChanges.pas:697-717` |
| R25 | `text_edit` e `designator_move` relatam `[FALHA]` mas **deixam a mudança aplicada** (pós-checagem roda depois da escrita) | `ApplyChanges.pas:1237-1240`, `:1316-1319` |
| R26 | `designator_move` força `eAutoPos_Manual` **permanentemente**, fora de qualquer `orig_*` | `ApplyChanges.pas:1279-1281` |
| R27 | Placas com **mais de 2 camadas são intocáveis** pela via de volta: o export grava `L<n>` e o `LayerFromName` só conhece 7 nomes | `ExportBoard.pas:118` vs `ApplyChanges.pas:577-594` |
| R28 | `comp_attr` com `comment:""` **zera** o comment; com `designator:""` ignora — assimetria não documentada | `ApplyChanges.pas:1347-1353` |
| R29 | O mesmo clique em `ApplyProject` faz **duas coisas diferentes** conforme o documento focado, sem confirmação | `ApplyChanges.pas:1616-1630` |
| R30 | `annotations.js` usa a **mesma chave `x`/`y` para mm e mil**, distinguidas só por `view`, com arredondamentos diferentes (4 casas / inteiro) | `pcbframe.js:44` vs `schframe.js:627` |
| R31 | `Fills` (`eFillObject`) **nunca são exportados**; tracks/arcs em `Multi` são descartados em silêncio; camadas mecânicas e KeepOut nunca são percorridas | `ExportBoard.pas:884-915` |
| R32 | A região da **própria placa** sai dentro de `cutouts[]` sem discriminador (o hub compensa por fora) | `ExportBoard.pas:943-947` |
| R33 | `nets[]` só lista nets **com pelo menos um primitivo** — net órfã é invisível para a IA | `ExportBoard.pas:121-128` |
| R34 | `outline_set` **destrói arcos** do contorno (tudo vira linha reta) e não tem guarda `orig_*` | `ApplyChanges.pas:1359-1401` |
| R35 | Reexecutar o mesmo `changes.js` **duplica** trilhas/vias/arcos em silêncio | `ApplyChanges.pas:905-946` etc. |
| R36 | `RegenerateProjectsIndex` reescreve o índice **inteiro** e pode derrubar projetos que não conseguiu confirmar; a versão do `ExportProject` **não grava a flag `annotations`** | 4 cópias divergentes |
| R37 | Furo `oblong` sai na camada de furos como **8 formas sobrepostas** (×20 passagens globais = ~160 percursos) | `hub-laser.js:1003-1005`, `:425-436` |
| R38 | O `.lbrn2` **fecha toda polilinha**, inclusive as abertas: contorno com folga > 1 µm ganha uma **corda que atravessa a placa**; segmento de serigrafia é percorrido **duas vezes** | `hub-laser.js:967` |
| R39 | Preservação de comentários `//` existe **só** no `changes.js` e mora na **UI**, não no serializador | `pcbframe.js:169-177` |
| R40 | `POST /api/save` sem lock, com `.tmp` de nome fixo, sob `threaded=True` | `hubserver.py:146-150` |
| R41 | "Mover após N" do Neoden está amarrado à **ordem do `BoardIterator`** | `hub-core.js:626,650-652` |
| R42 | `JGet` devolve a **primeira** ocorrência de `"chave":` na linha; a guarda `badStr` só cobre strings de 1º nível e só no caminho do hub | `ApplyChanges.pas:105` vs `hub-core.js:476,501` |
| R43 | `example/hub.html` e `example/viewer.html` são servidos **vivos** pela rota curinga e batem na API real, com um motor de changes fossilizado (sem `texts`) que baixa um CSV com o **mesmo nome** do atual | `hubserver.py:125-127` |
| R44 | `history.jsonl` é **lido e nunca escrito** por ninguém; e se alguém criar o arquivo à mão, a ordenação por `ts` joga tudo para o fim | `hubserver.py:364-373,386` |
| R45 | `_proj_id` colapsa acento e pontuação: duas pastas que só difiram por acento/hífen devolvem o projeto errado | `hubserver.py:210-212` |
| R46 | Dois índices de projeto independentes e divergentes (formato, ordem e data): `projects.js` vs `/api/index.json` | — |
| R47 | O preview de **flip de camada** existe no hub e **não tem contrapartida** no `ApplyChanges` (que delega ao Altium) — **NÃO CONFIRMADO** se coincidem | `hub-core.js:211-217` vs `ApplyChanges.pas:823-836` |
| R48 | Rotação fora de 0/90/180/270 vira **0 grau em silêncio** no `BuildSchematic`; a validação não pega negativos nem > 360 | `BuildSchematic.pas:544-553,1281-1285` |
| R49 | O diálogo de confirmação do `BuildSchematic` **mente**: promete apagar textos e não apaga | `BuildSchematic.pas:1407` vs `:956` |
| R50 | `pcb-list.csv` **sem escaping algum** — TAB ou CRLF num Footprint/Comment corrompe a tabela | `ExportBoard.pas:858-859` |

### 6.3 Divergências documentação × código (todas verificadas)

| Documento | Afirma | Código faz |
|---|---|---|
| `README.md:44` | O menu mostra **4 comandos** | Mostra **10** (6 vazam de `RenameLibs.pas`) |
| `README.md:102,341`, `AI-GUIDE.md:122`, `BuildSchematic.pas:6,14` | `BuildSchematic` **cria** os `.SchDoc` e é rodado pelo menu | Não cria nada, exige `.SchDoc` existente, e não aparece no menu |
| `AI-GUIDE.md:190` | `x`/`y` são **opcionais** em `comp_move` | Ausência teleporta o componente para (0,0) |
| `AI-GUIDE.md:47-48` | Esquema "sempre em inteiros, na grade de 100 mil" | 123/123 wires do PESDA, 103/103 do VDCB e 135/136 do PRJ-DI221694D têm coordenada fracionária |
| `AI-GUIDE.md:156` | "mm (use até 6 casas decimais)" | Ângulos `sa`/`ea` chegam a **14 casas**; a regra 4 exige copiar `orig_*` sem arredondar |
| `README.md:73` | `hub-core.js` faz "parsing" | Zero `JSON.parse` no arquivo |
| `README.md:108-110` | Os dois hubs usam "o mesmo motor" | `hub.html` não usa `applyPcbChanges`, `validateSchematic`, `deriveStatus` nem `HubIO`; a esteira tem **duas** implementações com critérios diferentes |
| `README.md:76` | `hub-laser.js` gera "SVG para o LightBurn" | O botão primário é o `.lbrn2` |
| `README.md:90` | tests/ tem 5 arquivos | Tem 10, incluindo o `test-laser.js` de 881 linhas |
| `ExportBoard.pas:7` | Copia o `AI-GUIDE.md` para a pasta do projeto | Nunca copiou (grep = 0) |
| `ExportProject.pas:10` | Rodar "ExportProject" | O procedimento se chama `ExportSch` |
| `hubserver.py:5`, `README.md:326` | "não altera nenhum arquivo" | Escreve 3 arquivos por projeto e cria `Laser/` |
| specs do Neoden | "Mid X/Y = centro do bbox" e terminador **LF** | Usa a **origem do componente** e **CRLF** (ambos corrigidos no código, nunca nos specs) |
| spec do laser | default de `holes` = `mark`; raio do roundrect = `min(w,h)/4` | `drill`; `min(w,h)/8` |
| `README.md:77` | `projects.js` é "o índice do histórico de projetos" | É irrelevante para o hub v2, que varre a pasta |

### 6.4 Correções a afirmações que **não** se sustentaram

Registro para não propagarem:
- **`apply-report.txt` NÃO está versionado.** `git ls-files | grep apply-report` = 0.
  O `.gitignore` está funcionando.
- **`Projects/prototipo/` está rastreado** (commit `2fffb60`, 5 arquivos).
- **O round-trip de texto fecha.** O `ExportBoard` grava o centro do bounding box e o
  `ApplyChanges` **mede o mesmo centro e move por delta** (`ApplyChanges.pas:1220-1229`).
  A fragilidade real é outra: duas tolerâncias diferentes no mesmo fluxo (R25).
- **O fator de conversão de unidade NÃO está duplicado.** Existe um caminho por domínio, todos
  delegando à API do Altium. No JS há **uma** constante numérica no repositório inteiro
  (`pcbframe.js:98`, só para a barra de status). *O risco de unidade é a convivência mm/mil
  sem discriminador (R30), não divergência de constante* — direcionar esforço para "unificar
  a constante" seria trabalho no lugar errado.
- **Há dois módulos compartilhados tela↔máquina, não um:** `HubLaser.boardCutouts` **e**
  `hub-font.js`. São os dois precedentes que a Fase 1 pode citar como padrão a seguir.

---

## 7. Consequências para o plano do briefing

### 7.1 Escopo real dos golden files

O briefing manda congelar "HTML, SVG do laser, Neoden e as demais". Na prática:

| Saída | Golden viável? | Observação |
|---|---|---|
| SVG do laser | ✅ com ressalva | Determinístico (SHA-1 estável). Mas o cabeçalho embute as opções e o formatador dá 0-4 casas variáveis → byte-exact é frágil |
| `.lbrn2` | ✅ com ressalva | Idem. Campos são **omitidos condicionalmente** (`globalRepeat` só se ≠1, `bidir` só se true) → o golden trava a *estrutura* junto com o valor |
| CSV Neoden | ✅ **e há golden real fora do repo** | `Neoden4-Altium/Output/DI251864-NEODEN-TopLayer.csv` |
| `changes.js` | ✅ | — |
| `schematic.js` | ✅ | — |
| `annotations.js` | ✅ | — |
| **HTML** | ❌ | **Não existe como arquivo.** É página estática viva |
| `board.js`, `pcb-list.csv`, `Libs/*.js`, relatórios | ❌ na prática | Só o Altium os produz, e ele roda em outra máquina |

### 7.2 O que a Fase 1 precisa entregar *antes* de mexer em código

Pela ordem:
1. **Fechar as duas suítes vermelhas** — sem linha de base verde não há como provar "diff zero".
2. **Entregar um runner** (`package.json` + script, ou um `.js` que rode as 9 suítes) **junto**
   com os goldens, não depois. Sem gatilho, o golden nasce morto.
3. **Tirar a config de bancada do laser do `localStorage`** para um arquivo em
   `Projects/<nome>/` — caso contrário o critério "byte-idêntico" prova a coisa errada
   (prova que os *defaults* não mudaram, não que o arquivo da bancada não mudou).
4. Escolher as placas: `TCMS_Reader` (já usada pelo `test-laser.js`) e **`prototipo`** (é a
   **única** com `cutouts`, ou seja, a única que exercita o furo de fixação).

### 7.3 Raio de alcance da Fase 1

**~30 sítios de leitura crua em 4 arquivos**: `hub-laser.js` (13), `pcbframe.js` (9),
`hub-core.js` (2 blocos), `hubserver.py` (4). A maioria lê campos que o modelo efetivo atual
**não tem** — o canônico precisa ser **maior** que o modelo de hoje.

**Decisão que domina o custo:** o modelo canônico fica **só em JS** (e o `hubserver.py` passa
a invocar node), ou é **duplicado em Python**? Hoje `hubserver.py:226-355` é uma terceira
leitura independente do mesmo arquivo. O briefing exige direção unidirecional MCP→núcleo, mas
não diz nada sobre um núcleo bilíngue. **Duplicar em Python recria exatamente o problema que
a Fase 1 existe para resolver.**

### 7.4 Fase 2 — a ponte

Bom sinal: a arquitetura de ponte por arquivo que o briefing propõe **já é o que existe**. O
que falta é o observador do lado Altium. Cuidados que este mapa acrescenta:
- Os `.pas` **não têm `try/except` em lugar nenhum** — um watcher com timer herda isso.
- `ExportPcb` pode **travar num diálogo modal** (`InputBox` em `ExportBoard.pas:349-372`,
  `ShowMessage` final em `:1065`). Modo automático precisa de um caminho sem diálogo.
- `ApplyProject` abre um `TForm` com `TListBox` (`ApplyChanges.pas:1525`) — idem.

### 7.5 Fase 4 — validação determinística

O sistema já tem três camadas de validação (aplicação, serialização e `validateSchematic`),
**e elas discordam entre si** (`hub-core.js:128` aceita `via_add` com `drill>=size` como aviso;
`:514` trata como erro que bloqueia a gravação). A Fase 4 deve **unificar**, não acrescentar
uma quarta. E o validador precisa cobrir o que hoje ninguém cobre: `x`/`y` obrigatórios em
`comp_move` (R7), vírgula decimal (R6), sequência `":` recursiva (R42), caracteres acima de
U+00FF (R5) e a coerência side×mirror do laser (R9).

---

## 8. Perguntas que só o usuário pode responder

Agrupadas por quanto travam o trabalho.

### Bloqueantes para a Fase 1

1. **A configuração de bancada do laser** (lista de camadas + velocidade/potência/frequência/
   passagens) **sai do `localStorage` para um arquivo no projeto antes da Fase 1?** Sem isso o
   golden file só congela `benchDefaults()` e o critério "byte-idêntico" não prova nada sobre
   o arquivo que a máquina recebeu.
2. **Laser e Neoden devem passar a APLICAR o `changes.js`** (o que o usuário vê na tela) **ou
   continuar exportando o espelho do Altium?** A resposta define se o modelo canônico é
   "board + changes" ou "board cru" — e se a vista PCB embutida na aba Neoden deveria abrir
   **sem** aplicar changes, para não mentir.
3. **O modelo canônico fica só em JavaScript** (com o `hubserver.py` invocando node) **ou é
   duplicado em Python?** É a decisão que mais mexe no custo.
4. **Posso usar `Neoden4-Altium/Output/DI251864-NEODEN-TopLayer.csv` como golden file**,
   comparando byte a byte a saída do hub contra a do script sobre o mesmo insumo? Isso
   resolveria de vez as dúvidas de formato.
5. **Conserto as fixtures do `_DemoKit`** para os nomes reais de hoje (`RES [SMD]`, `RES 0805`)
   **ou restauro uma schlib/pcblib sintética só para teste?** As duas suítes precisam ficar
   verdes antes de qualquer golden.
6. **Quais placas viram golden?** Minha sugestão: `TCMS_Reader` + `prototipo` (única com
   `cutouts`) + uma terceira que você indique.

### Sobre as máquinas (só a bancada responde)

7. **Ctrl+Z depois do `ApplyProject` realmente devolve as trilhas/vias/arcos APAGADOS?**
   As remoções não seguem o protocolo completo. Decide se o "undo único" é rede de segurança
   real ou promessa da documentação.
8. **O `<speed>` do `.lbrn2` é mm/s no seu galvo?** O arquivo de referência tem uma camada
   chamada "Speed 2800 mm/min" com `speed=600` — o rótulo contradiz o valor.
9. **A instalação do LightBurn está com "Order by priority" ligado?** Se não estiver, o `ci`
   não garante a ordem de execução (R10).
10. **O CSV do Neoden do lado Bottom já foi usado de verdade?** A coluna Layer sai com `T`
    literal e as coordenadas não são espelhadas. A máquina lê essa coluna, ou o operador vira
    a placa e ignora?
11. **A Neoden 4 aceita qual encoding?** O hub gera UTF-8; o script original gerava cp1252.
    Nunca foram comparados byte a byte. Há dado real com acento (`VIBRAÇÃO` no PACI).
12. **Alguma das 3 placas com `X`/`Z` na serigrafia já foi gravada a laser?** Apareceram
    retângulos no lugar das letras? (R11 — prefere que eu desenhe os dois glifos ou que a arte
    passe a **avisar** quando um caractere cair na caixa?)

### Sobre o ambiente e o histórico

13. **Qual máquina roda o Altium hoje, e o UNC `\\LUCAS-PC\D\…` ainda resolve a partir dela?
    O drive `Z:` ainda existe mapeado?** São 17 constantes em 6 arquivos que precisam ser
    editadas juntas — vale transformar em uma única fonte de verdade antes de tudo?
14. **As bibliotecas REAIS já estão com os nomes novos, ou só o espelho `Libs/*.js` foi
    editado?** (R13 — se as libs não foram renomeadas, rodar `ExportLibs` reverte o espelho e
    a IA volta a escolher nomes antigos.) **O `RenameLibs` já foi rodado com `SIMULAR=False`
    alguma vez?**
15. **Quais saídas são CRÍTICAS de verdade** — no sentido de "se sair errado vira sucata ou
    trava máquina"? Meu palpite: `.lbrn2` (bottom sem espelho = placa perdida) > CSV Neoden
    (PTH trava a máquina) > `changes.js` (altera a placa, mas o documento fica sujo e não
    salvo, o que dá uma saída). Confirma essa ordem?
16. **Existe backup dos artefatos críticos?** Não há cópia do `.PcbDoc` nem das bibliotecas
    antes de nenhum script destrutivo. A rede de segurança real é "commitar antes" ou "fechar
    sem salvar"?
17. **Você já rodou o `ApplyProject` sobre um `changes.js` escrito contra um `board.js`
    ANTIGO?** É o teste que confirma ou derruba o R1.
18. **Placas de mais de 2 camadas estão no escopo?** Hoje objetos em `Mid1`/`Mech2+` são
    intocáveis pela via de volta (R27).
19. **`example/` ainda serve para alguma coisa?** É servida viva e bate nos endpoints reais
    com um motor desatualizado (R43).
20. **`history.jsonl`:** implemento o escritor ou apago o leitor (R44)?

---

## 9. Metodologia e limites deste mapa

**Foi verificado por leitura de código com citação:** todos os pontos de entrada, todas as
escritas de arquivo (por varredura de `SaveToFile`/`open(...,'w')`/`Blob`), todos os formatos
de dados (por inspeção dos bytes reais com `od`/`file`), as convenções de unidade/origem/eixo/
rotação de cada saída, e o resultado real das 9 suítes de teste.

**Foi verificado por execução:** a ausência dos glifos `X`/`Z`; a geração headless
determinística de SVG/`.lbrn2`/CSV; o `require()` de cada módulo em Node; a existência dos
goldens do Neoden fora do repositório; o estado do git.

**NÃO foi verificado (precisa da bancada / do Altium):** se o Ctrl+Z cobre as remoções; se o
`<speed>` do `.lbrn2` é mm/s; se o `<Shape Type="Path">` de topo abre com geometria; se o
flip de camada do preview coincide com o do Altium; se `Pad.CornerRadius` devolve Coord ou
porcentagem nesta versão; qual corpo o engine executa quando duas unidades definem a mesma
função; o comportamento exato do `Chr()` acima de 255.
