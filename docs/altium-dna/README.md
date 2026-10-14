# O DNA do Altium: comandos, menus e teclas

Os comandos, os menus e os atalhos dos editores **PCB** e **Esquema** do Altium Designer 21,
lidos do próprio Altium, e o que o hub faz com eles: o `hub-altiumdna.js` (dado consultável) e a
predefinição **"Padrão Altium"** do editor de atalhos (`hub-atalhos.js`).

| arquivo | o que é |
|---|---|
| `tools/altiumdna/extrai-rcs.js` | o extrator: lê os `.rcs`, escreve o `hub-altiumdna.js` |
| `tools/altiumdna/api.js` | a consulta (o extrator a cola no fim do módulo gerado) |
| `hub-altiumdna.js` | **dado versionado** (321 KB), módulo UMD puro: `HubAltiumDNA` no navegador, `module.exports` no Node |
| `hub-atalhos.js` | as ações novas, as sequências (`P,T`), o leitor de sequências e a predefinição Padrão Altium |
| `tests/test-altiumdna.js` | confere a consulta contra o `.rcs`, a predefinição contra o Altium e se o dado envelheceu |

Para regenerar (só ao trocar de versão do Altium; o hub nunca depende de Altium instalado):

```
node tools/altiumdna/extrai-rcs.js ["C:\Program Files\Altium\AD21\System"] [saida.js]
```

## De onde vem: os `.rcs`

O Altium **não** guarda comandos, menus e teclas nos binários. O `X2.EXE` lê em tempo de
execução os arquivos de recursos `System\*.rcs`, que são **texto** (ASCII, CRLF). Evidência:

- as palavras do formato estão no `X2.EXE` (o parser), e não nos editores:
  `ShortCut1` no offset 16310466, `UpdatePLSuffix` em 28145301, `TreeCopy` em 28145423,
  `LinkRepeat` em 28146755, `.RCS` em 39433068 (X2.EXE, sha256 `f7a02c13…f893d7`).
  O `Advpcb.dll` só cita `.Rcs` uma vez (offset 92374063);
- o REA (`rea-agents@6.4.0`) **recusa** os servidores nativos: `inspect-pe-resources` em
  `Advpcb.dll` (108 MB) e `AdvSch.dll` (46 MB) devolve `invalid_format: PE sections have
  overlapping raw file ranges` — são Delphi nativos, sem recurso RCDATA com as tabelas, e o
  `inspect-binary-layout` só cobre Linux x64;
- o REA confirma que a parte .NET não tem teclado: `inspect-managed-artifact` em
  `Altium.Sch.Editor.dll` (25 KB, CIL, sha256 `dc3f487e…79780ce`) e `inspect-managed-members`
  mostram só `HierarchyCreator`, `PushPartToSheet`, `PinToPortMapping`,
  `InteractiveEventActions` — criação de folhas/portas, nenhum mapa de teclas ou menu.

Logo, os `.rcs` são a fonte de verdade. O extrator lê os **41** `.rcs` de `System\` (2771 PLs,
816 árvores), porque os menus do PCB e do Esquema citam comandos de outros arquivos
(`WorkspaceManager.rcs`: File, Project, Window; `dxp.rcs`: Client).

| arquivo | sha256 (16) | o que traz |
|---|---|---|
| `AdvPcb.rcs` (4196 linhas) | `e101b857f9ab9872` | PCB: 920 PLs, menus, popups, teclado, barras |
| `advsch.rcs` (3807 linhas) | `13e70d53c4499c76` | Esquema: 680 PLs, menus, popups, teclado |
| `WorkspaceManager.rcs` | `6b643a67fafb39d6` | File » New, Project (`Popup='C'`, l. 1070), Window (`Popup='W'`, l. 1874) |
| `dxp.rcs` | `cb76e2d27edbc6c0` | comandos do Client (Run Script, Preferences) |

### O formato

```
PL <plid> Command='PCB:PlacePad' Caption='&Pad' Shortcut1='' Shortcut2='' Params='...' Description='Place Pad' End
PLRepeat <plid> Symbol1='%1' BeginIndex1=1 EndIndex1=30 Command=... End     (série: importadores, recentes)
Tree <id> Caption='&Place' Popup='P'                                        (menu; filhos até o End)
    Link <id> PLID='PLManRoute:Track' End
    Separator <id> End
    TreeCopy <id> OriginalID=<outra árvore> End
End
```

- `PL` pode ocupar várias linhas (`dxp.rcs` l. 56–60) e herdar campos com `BasePL=` (é assim que
  as variantes `_PCAD` trocam só a tecla, `AdvPcb.rcs` l. 1001–1005). Aspas dobradas `''` são uma aspa.
- `Insertion`/`Change`/`Deletion` são ajustes das variantes P-CAD (`advsch.rcs` l. 2875–2950):
  lidos, não aplicados.
- **O acelerador `P,T` não está escrito em lugar nenhum**: ele é a tecla `Popup='P'` da árvore
  (pressionada no editor, abre o menu Place no cursor) seguida da letra com `&` de cada nível
  (`Caption='&Track'`). O extrator calcula todas as sequências de cada comando — pelo menu
  principal (`E,G,L` = Edit » Ali**g**n » Align **L**eft) e pelos popups soltos (`A,L`, porque
  `Tree MNPCB_Align Caption='Ali&gn' Popup='A'`, l. 1510) — e a consulta devolve a mais curta.
  Duas letras iguais no mesmo menu: vale a primeira, como o Windows (o Altium alterna).

### Onde mora cada coisa

| | PCB (`AdvPcb.rcs`) | Esquema (`advsch.rcs`) |
|---|---|---|
| menu principal | `Tree MNPCBMenu` l. 1357 | `Tree MNSchematicMenu` l. 917 |
| popups soltos (G, N, O, Z, Y…) | `Tree MNPCBPopup` l. 2047 | `Tree MNSchematicPopup` l. 1328 |
| Place (`P`) | `Tree MNPCB_Place` l. 1280 | `Tree MNSchematic_Place` l. 811 |
| teclado | `Tree HTPCBHotKeys` l. 3429 | `HTSchematicHotKeys` l. 2424, `HTSchInteractiveHotKeys` l. 2699 |
| barras | `TLPCBToolbar` 2447, `TLPCBWiring` 3150, `TLPCBUtilities` 3176, `TopBarPCB` 3970 | `TLSchematicTools` 1960, `TLWiringTools` 2094, `TopBarSchematic` 3630 |

Comandos citados no hub (linha do `PL`): `PLManRoute:Track` 243, `PLPCB:PlacePad` 283,
`PLPCB:PlacePolygonPlane` 323, `PLPCB:DesignRules` 376, `PLPCB:DesignRuleCheck` 380,
`PLPCB:AlignComponentsLeft` 390, `PLPCB:TearDrops` 509, `PLPCB:PopupShowConnectionsAll` 637,
`PLPCB:ToggleSingleLayerMode` 677, `PLPCB:RepourAllPolygonsNoContext` 754, `PLPCB:ClearFilter` 837,
`PLPCB:CompareAndUpdateMe` 892, `PLPCB:RubberStamp` 945 (`Ctrl+R`), `PLPCB:Copy` 36;
`PLSch:PlaceWire` 267, `PLSch:SetTemplateFromLocal` 353, `PLSch:DocumentPreferencesSchDocumentOptions` 391,
`PLSCH:Duplicate` 546 (`Ctrl+D`), `PLSch:RubberStamp` 605; `PLWorkspaceManager:NewPCB` 156 e
`ExportToPDF` 489 (`WorkspaceManager.rcs`).

## O que foi extraído (contagens)

| | PCB | Esquema |
|---|---|---|
| comandos (PLs que o editor alcança + os do arquivo com tecla) | 888 | 591 |
| menus de cima | File Edit View Project Place Design Tools Route Reports Window Help | File Edit View Project Place Design Tools **Simulator** Reports Window Help |
| teclas diretas (`Shortcut1/2`) | 222 | 162 |
| aceleradores (sequências) | 487 | 299 |
| comandos no teclado (`HT*`) | 98 | 111 |

Ficaram de fora o editor de biblioteca (`MNPCBLibMenu`, `MNSchLibMenu`), o Situs, o OpenBus/FSM e
as variantes `_PCAD`, salvo quando o editor de placa/folha os alcança.

## A API do `HubAltiumDNA`

```js
HubAltiumDNA.comando('pcb', 'PLPCB:Copy')      // {plid, comando:'PCB:Copy', params, rotulo:'Copy', tecla1:'Ctrl+C', tecla2:'Ctrl+Insert', descricao}
HubAltiumDNA.caminho('pcb', 'PLPCB:RepourAllPolygonsNoContext')   // ['Tools', 'Polygon Pours', 'Repour All']
HubAltiumDNA.acelerador('pcb', 'PLManRoute:Track')                 // 'P,T'
HubAltiumDNA.porSequencia('pcb', 'T,D')        // o comando (Design Rule Check...)
HubAltiumDNA.teclas('pcb', 'PLPCB:AlignComponentsLeft')            // ['Shift+Ctrl+L']  (escrita do Altium)
HubAltiumDNA.porTecla('pcb', 'Ctrl+Shift+L')   // os comandos dessa tecla (aceita as duas escritas)
HubAltiumDNA.teclaHub('Shift+Ctrl+L')          // 'Ctrl+Shift+L'  (escrita do HubAtalhos.normalizaTecla)
HubAltiumDNA.menu('pcb', 'principal'|'popups') // a árvore: {rotulo, popup, acelerador, filhos} / {rotulo, plid, acelerador, teclas} / {separador} / {dinamico}
HubAltiumDNA.busca('sch', 'template')          // comandos por rótulo/comando/descrição
HubAltiumDNA.contagens(), HubAltiumDNA.DADOS, HubAltiumDNA.VERSAO
```

Os índices nascem na primeira consulta. `teclaHub` segue o `normalizaTecla`: `PgUp` → `PageUp`,
`Multiply` → `*`, `Space` → `Espaço`, e o Shift numa tecla de um caractere só fica com Ctrl/Alt
(`Shift+S` do Altium vira `S`). Teclas de mouse do Altium (`Left_Dbl_Click`) passam cruas.

## O editor de atalhos (`hub-atalhos.js`)

Tudo é **acréscimo**: a tabela da casa continua sendo o padrão, nenhuma tecla existente mudou.

- **Ações novas** (no fim das tabelas, com `altium:'<plid>'`): PCB `copiar` Ctrl+C, `recortar`
  Ctrl+X, `colar` Ctrl+V, `duplicar` Ctrl+D, `alinharEsq` Ctrl+Shift+L, `alinharBase` Ctrl+Shift+B,
  `distribuirH` Ctrl+Shift+H, `distribuirV` Ctrl+Shift+V; **sem tecla na casa**: `alinharDir`,
  `alinharTopo`, `alinharCentroH`, `alinharCentroV`, `ratsnest`, `realcarNet`, `drc`, `regras`,
  `pour`, `repour`, `teardrops`, `pad`, `atualizarPcb`, `pdf`, `novaPlaca`. Esquema: `folha` O,D e
  `template` O,S (o menu Options do Altium, que o O abre; o O estava livre). Gesto novo na PCB:
  **Ctrl+Clique acende a net**.
- **Por que algumas ficam sem tecla na casa**: no Altium elas são sequência começada por uma letra
  que aqui já é ferramenta (T texto, P preencher, D fantasmas, A arco, F enquadrar, N sinalizar). A
  regra nova: uma tecla não pode ser ação e começo de sequência ao mesmo tempo — seria esperar um
  tempo para saber qual das duas (o T ficaria lerdo) ou disparar a errada (A depois R = arco e
  retângulo, ou alinhar à direita?). A predefinição Padrão Altium as põe no lugar.
- **Ctrl+R / Ctrl+Shift+R / Ctrl+Shift+T são do navegador** (recarregar, recarregar sem cache,
  reabrir aba): o `duplicar` fica no Ctrl+D (o Duplicate do Esquema do Altium, `PLSCH:Duplicate`;
  no PCB do Altium o Ctrl+D é View Options), e alinhar à direita/topo ficam no A,R e A,T da
  predefinição.
- **`normalizaTecla` guarda o Shift quando há Ctrl ou Alt** (`Ctrl+Shift+L`). Retrocompatível: o
  `porTecla` herda (sem chave própria) `Ctrl+Shift+X → Ctrl+X`, então o `Ctrl+Z` e qualquer
  `Ctrl+L` gravado continuam disparando com o Shift junto — a não ser que uma ação seja dona do
  `Ctrl+Shift+X`. `TECLAS_PROIBIDAS` ganhou Ctrl+Shift+R/W/I/J.
- **Sequências** (`'P,T'`): `acordes`, `colide`, `mapaAtalhos(...).prefixos`, e o
  `HubAtalhos.leitor(mapa, dispara, {aoEsperar, espera})` para a vista chamar no keydown. Sem
  sequência gravada o leitor é exatamente o `porTecla[k]` de antes. Na caixa de gravar, a
  **vírgula emenda** a próxima tecla (P , T); sem vírgula tudo é como era.
- **Predefinição "Padrão Altium"**: botão em cada grupo do editor, ao lado de "Restaurar o padrão"
  (que volta para a casa). `v.predefinicao('altium')`, `v.qualPredefinicao(salvos)`.
  O mapa Altium da PCB: P,T trilha · P,V via · P,L linha · P,A,A arco · P,A,U círculo · P,E
  retângulo · P,R polígono · P,S texto · Ctrl+M medir · Q unidade · S (Shift+S) camada única ·
  +/−/* camadas · Ctrl+F virar · V,G,V grade · V,F enquadrar · T,D DRC · D,R regras · P,G pour ·
  T,G,A repour · T,E teardrops · P,P pad · D,I ECO · F,M PDF · F,N,P nova placa · A,R/A,T/A,C/A,V
  alinhamentos · N ratsnest · C (Shift+C) limpar realce · Ctrl+C/X/V/D; o que só existe no hub vai
  para letras que o Altium não usa como começo de sequência: I preencher, K sinalizar, B
  fantasmas, E travar, H ajuda. Esquema: P,P componente · P,W fio · P,O terra · P,N rótulo · P,V,N
  No ERC · V,F enquadrar · Ctrl+Shift+G grade · D,T template · O,D folha · R rotear.
  O `tests/test-altiumdna.js` confere cada uma contra o `.rcs`; as exceções escritas são o
  `duplicar` (Ctrl+R proibido), o `ratsnest` (no Altium N abre o menu Netlist) e o `template` (D,T
  abre o submenu).

### Para ligar nas vistas (integrador)

```js
const leitor = HubAtalhos.leitor(() => ATALHOS, id => fazAcao(id), { aoEsperar: seq => avisoRodape(seq ? seq + ', …' : '') });
// no keydown, no lugar de `const acao = ATALHOS.porTecla[k]; ... fazAcao(acao)`:
if (leitor.tecla(k)) e.preventDefault();
// no Esc e ao trocar de ferramenta: leitor.cancela();
// num estado com teclas próprias (o arrasto do rotear): leitor.tecla(k, { direto:true })
```

E carregar o `hub-altiumdna.js` (`<script src>`) onde a dica "Altium: Place » Track · P,T" do
editor deve aparecer (o `hub.html`); sem ele a dica mostra o plid cru.

## Lacunas: o Altium de uso comum × o hub

✓ = o hub faz; ◐ = em parte, ou chegando agora (ação registrada no `hub-atalhos.js`); ✗ = não faz.

### PCB

| Altium (menu) | tecla Altium | hub | ação / onde |
|---|---|---|---|
| Place » Track / Route » Interactive Routing | P,T · U,T · Ctrl+W | ✓ | `trilha` (W) |
| Place » Via | P,V | ✓ | `via` (Ctrl+2; na trilha, 2 e *) |
| Place » Line / Arc / Full Circle | P,L · P,A,A · P,A,U | ✓ | `linha` L, `arco` A, `circulo` O |
| Place » Fill / Rectangle / Solid Region | P,F · P,E · P,R | ✓ | `retangulo` R, `poligono` G (+ `preencher`) |
| Place » String | P,S | ✓ | `texto` T |
| Place » Pad | P,P | ◐ | `pad` — travado na barra (falta `pad_add` no ApplyChanges) |
| Place » Polygon Pour | P,G | ◐ | `pour` — travado na barra |
| Tools » Polygon Pours » Repour All | T,G,A | ◐ | `repour` |
| Tools » Teardrops | T,E | ◐ | `teardrops` |
| Design » Rules | D,R | ◐ | `regras` |
| Tools » Design Rule Check | T,D | ◐ | `drc` |
| Netlist » Show/Hide Connections | N,S,A · N,H,A | ◐ | `ratsnest` |
| realce de net (Ctrl+clique) / Clear Filter | Shift+C | ◐ | gesto Ctrl+Clique, `realcarNet` |
| Edit » Copy / Cut / Paste | Ctrl+C/X/V | ◐ | `copiar`, `recortar`, `colar` (componente entra pelo ECO) |
| Edit » Paste Special | E,A | ✗ | — |
| Edit » Duplicate (Rubber Stamp) | Ctrl+R | ◐ | `duplicar` Ctrl+D |
| Edit » Align (esq/dir/topo/base/centros) | Shift+Ctrl+L/R/T/B · A,C · A,V | ◐ | `alinhar*` |
| Edit » Align » Distribute H/V | Shift+Ctrl+H/V | ◐ | `distribuirH`, `distribuirV` |
| Edit » Align » Align To Grid | Shift+Ctrl+D | ✗ | — |
| Edit » Delete / Select All / Undo / Redo | Delete · Ctrl+A · Ctrl+Z · Ctrl+Y | ✓ | `apagar`, `tudo`, `desfazer`, `refazer` |
| Edit » Select » Connected Copper | Ctrl+H | ✗ | — |
| View » Fit Board / Flip Board | V,F · Ctrl+F | ✓ | `enquadrar` F, `virar` V |
| View » Toggle Units | Q | ✓ | `unidade` Q |
| Toggle Single Layer Mode | Shift+S | ✓ | `camadaUnica` S |
| Next/Previous Layer, Next Signal Layer | + − * | ✓ | `proxCamada`, `antCamada`, `outraFace` |
| Reports » Measure Distance | Ctrl+M | ✓ | `medir` |
| Design » Board Shape (redefinir) | D,S,… | ✓ | ferramenta `contorno` (barra, sem tecla) |
| Design » Board Shape » Define Board Cutout | D,S,C | ✓ | ferramenta `furo` (redondo) |
| Design » Import Changes (ECO) | D,I | ◐ | `atualizarPcb` |
| Design » Update Schematic | D,U | ✗ | — |
| Design » Layer Stack Manager | D,K | ✗ | — |
| Route » Auto Route / Fanout | U,A · U,F | ✗ | — |
| interactive routing: conflito (Walkaround/Stop/Ignore) | Shift+R | ✓ | gesto da trilha |
| File » Fabrication Outputs » Gerber | — (lista dinâmica) | ✓ | `gerber` (barra) |
| File » Smart PDF | F,M | ◐ | `pdf` — travado na barra |
| File » New » PCB | F,N,P | ◐ | `novaPlaca` |
| File » Save | Ctrl+S | ✓ | `salvar` |
| Place » Component / Dimension / Keepout | P,C · P,D · P,K | ✗ | componente entra pelo ECO |

### Esquema

| Altium (menu) | tecla Altium | hub | ação |
|---|---|---|---|
| Place » Part | P,P | ✓ | `add` (C) |
| Place » Wire | P,W · Ctrl+W | ✓ | `fio` (W) |
| Place » Power Port | P,O | ✓ | `terra` (G, o GND) |
| Place » Net Label | P,N | ✓ | `rotulo` (L) |
| Place » Directives » Generic No ERC | P,V,N | ✓ | `noerc` (N) |
| rotate / mirror (no arrasto) | Space · X · Y | ✓ | `girar`, `espelhoX`, `espelhoY` |
| View » Fit All Objects | V,F · Ctrl+PgDn | ✓ | `enquadrar` (F) |
| View » Grids » Toggle Visible Grid | Ctrl+Shift+G | ✓ | `grade` (B) |
| Design » Sheet Templates | D,T | ◐ | `template` (O,S); o painel tem a seção de template |
| Options » Document Options | O,D | ◐ | `folha` (O,D) |
| Edit » Copy / Paste / Smart Paste | Ctrl+C/V · Ctrl+Shift+V | ✗ | — |
| Edit » Duplicate | Ctrl+D | ✗ | — |
| Edit » Align | A,L … · Shift+Ctrl+L | ✗ | (há guias de alinhamento no arrasto) |
| Design » Update PCB Document | D,U | ◐ | o fluxo do hub é `changes.js` + `ApplyChanges.pas` |
| Tools » Annotation | T,A,A | ✗ | — |
| Project » Compile / ERC | C,C | ✗ | (só a diretiva No ERC) |
| Place » Port / Bus / Sheet Symbol | P,R · P,B · P,S | ✗ | — |
| File » Smart PDF | F,M | ✗ | — |

## Em aberto

- O `hub-altiumdna.js` tem 321 KB, quase tudo nos 1479 comandos (rótulo, parâmetros, descrição).
  Dá para cortar à metade guardando só os comandos que algum menu ou tecla alcança, mas aí a
  `busca` perde o resto; ficou inteiro. Carregue-o só onde for consultar.
- Rótulos dinâmicos: o Altium troca o caption de alguns itens na hora (`Update Schematics in
  X.PrjPcb`, `Import Changes from X.PrjPcb`); o `.rcs` só tem o rótulo-base (`Update Schematic...`).
- Menus dinâmicos (`LinkRepeat`: importadores, saídas de fabricação, recentes) aparecem como
  `{dinamico}`; os itens de verdade só existem com o Altium rodando.
- O que o usuário customizou no Altium (DXP » Customize) fica no perfil dele, não nos `.rcs` de
  `System\`; aqui é o Altium de fábrica.
- Teclas do Altium que o navegador não deixa: Ctrl+W (rotear), Ctrl+R (duplicar), Ctrl+P
  (imprimir), Ctrl+PgDn/PgUp (trocar de aba), F5, F11, F12, Ctrl+Shift+R/T.

## Os menus e as Preferences na vista PCB (`hub-pcbaltium.js`)

Pedido do dono (2026-10-14): a vista PCB do Electron "idêntica ao Altium" — o menu do clique no
componente, as configurações das ferramentas e os atalhos —, mantendo a cara do hub.

- **Barra de menus** (File Edit View Project Place Design Tools Route Reports Window Help): a
  árvore `MNPCBMenu` inteira, na ordem e com os rótulos do Altium. F10, ou Alt solto + letra, abre
  pelo teclado; setas, Enter e a letra sublinhada navegam.
- **Botão direito**: `MNPCB_Primitive` ("Right Mouse Click Primitive", com objeto embaixo) ou
  `MNPCB_FreeSpace` ("Right Mouse Click Free Space"). Component Actions aparece no componente e no
  pad dele; Net Actions com objeto de net; Polygon Actions só em polígono; submenu sem nada que o
  hub faça some (o `EmptyAction=Hide`). O que só o hub tem (Camada, Virar de face, Sinalizar,
  Travar) fica no fim, depois de um separador.
- **Tecla que abre menu**: com a predefinição "Padrão Altium" do editor de atalhos, P, D, T, U, V,
  E... abrem o menu no cursor (como o `Popup='P'` das árvores) e a letra seguinte escolhe — P,T
  Track, D,R Rules, T,D DRC. Na predefinição da casa nada muda (P continua Preencher).
- **Comando → ação**: o `MAPA` do módulo (93 comandos do Altium em 65 ações da vista). Comando
  sem ação fica **cinza** com o porquê na dica. `tests/test-pcbaltium.js` confere que todo plid
  existe no Altium e toda ação é um `case` do `fazAcao`.
- **Preferences** (Tools » Preferences, T,P, ou Preferences... no botão direito): a janela do
  Altium com a árvore System / PCB Editor. Os rótulos vêm dos formulários Delphi gravados no
  `Advpcb.dll` (DFM `TPF0`, lidos com um leitor próprio — o REA recusa o PE desse binário):
  `TSystemOptions_Frame` (General), `TSystemDisplayOptions_Frame` (Display),
  `TRoutingSystemOptions_Frame` (Interactive Routing), `TMouseConfigurationOptions_Frame` (Mouse
  Wheel Configuration), `TSystemDefaultPrimitives_Frame` (Defaults),
  `TSystemOptionsLayerColors_Frame` (Layer Colors). O que funciona: Online DRC, Double Click Runs
  Interactive Properties, Cursor Type (Small 90 / Large 90 / Small 45 / Tiny 45), grade, linhas
  de conexão e fantasmas, os modos de conflito do Shift+R e o atual, Pickup Track Width From
  Existing Routes, Track Width / Via Size Mode (Default ou Preferred = regra), canto 45/90/livre,
  a roda do mouse (Ctrl/Shift/Alt por ação, com "Padrão Altium"), os valores de nascença das
  ferramentas e as cores das camadas. O resto aparece cinza. **System » Keyboard Shortcuts** é o
  editor de atalhos do hub (`HubAtalhos.pane`).
- **Padrão = o comportamento de antes**: nada muda até a pessoa mexer (roda = zoom, Shift = lado,
  Ctrl+Shift = camada; largura e via pela regra da placa).
- **Painel Properties**: a ficha do componente nas seções do Altium (Location, Properties,
  Footprint, Primitives) e os campos das outras fichas com os nomes do Altium (Layer, Width,
  Start/End (X/Y), Hole Size...).

## Vista 3D e editor de footprint (2026-10-14)

- **View » 3D Layout Mode (tecla 3; 2 volta)** — `hub-pcb3d-vista.js`, WebGL com o Three.js de
  `vendor/three` carregado só quando o 3D abre. A placa é a de verdade (contorno, recortes e furos
  vazados, 1,6 mm ou a espessura do `board3d.js`); as duas faces são pintadas com o MESMO cache da
  vista 2D (máscara, cobre sob ela, metal onde ela abre, serigrafia). Os corpos vêm do
  `HubPcb3dModelo.corpos`, nesta ordem: o que o editor de footprint do hub prendeu ao footprint
  (`Libs/pcblib-hub.js`), o `board3d.js` do PcbDoc (`tools/pcb3d/extrai3d.py`), o
  `Libs/pcblib-3d.js` (`tools/pcb3d/pcblib3d.py`); sem nenhum, a caixa de placeholder. Navegação
  do Altium: Shift+botão direito (ou arrastar) gira, botão direito arrasta, roda aproxima; o
  **3D View Control** do menu Exibir (0 topo, Ctrl+0 base, 8 isométrica, 9 gira 90°, setas giram
  30°) só vale no 3D. Clique escolhe o componente (a mesma seleção do 2D); ferramenta de desenho
  chamada no 3D volta ao 2D.
- **Editor de footprint** — `hub-fpeditor.js`, o "PCB Library" do Altium por cima da vista PCB e
  do Esquema: painel de footprints (filtro, Add / Duplicate / Delete), área de trabalho 2D com as
  camadas Top / Bottom / Multi-Layer / Top Overlay / Mechanical (3D), Properties do objeto
  (Designator, Layer, Location, Size and Shape, Hole Information; Track/Arc; 3D Body). Teclas do
  Altium: P,P pad, P,L linha, P,A arco, **P,B 3D Body (STEP)**, P,E Extruded, Espaço gira, setas
  andam, Ctrl+Z/Y, Q mm/mil, G grade, 3/2 alterna a vista do footprint em 3D. O STEP (do
  fabricante) sobe por `POST /api/fp3d` para `Libs/3d-hub/<sha1>.step`; "Encaixar nos pads"
  centraliza o modelo sobre os pads e o assenta na placa; Rotation X/Y/Z e Z Offset acertam o
  resto. Soltar um .step na área de trabalho é o mesmo que P,B.
- **Biblioteca do hub** — `hub-fplib.js`, `Libs/pcblib-hub.js` (fora do git: é estado do
  servidor). O `Libs/pcblib.js` do Altium não muda; o footprint do hub com o mesmo nome passa na
  frente dele na ficha do Esquema, no ECO e no `comp_add`. Gravou com pads diferentes: a vista PCB
  oferece o "Update PCB With" (comp_del + comp_add no mesmo lugar, mesmas nets por nome de pad).
  No modo biblioteca remota do desktop, o arquivo e os STEP moram no servidor (`libremota.py`).
- **Esquema » Properties » Footprint** — o footprint de todas as partes do designador (lista da
  PcbLib + biblioteca do hub), o que ele tem (pads, modelo 3D), os pinos do símbolo sem pad (o
  Unknown Pin do ECO), e "Editar footprint…" / "Ver em 3D". Tools » Footprint Manager... abre o
  editor no componente selecionado. A PCB recebe no Design » Update PCB.
