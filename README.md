# AltiumPCBMirror

Espelha a PCB **aberta no Altium Designer** em um HTML fiel ao ambiente do Altium, deixa uma
IA (Claude Code) personalizar a placa — componentes, trilhas e furos/vias — editando um arquivo
de mudanças, e depois **aplica tudo de volta na PCB real**, nas mesmas coordenadas que aparecem
no PCB List / Properties do Altium.

Baseado (como referência de API) no
[InteractiveHTMLBOM4Altium2](https://github.com/lukaszmoskwa/InteractiveHTMLBOM4Altium2)
(MIT), mas é um projeto independente: o ibom gera um BOM interativo para visualização; aqui o
objetivo é **round-trip fiel** Altium → HTML → IA → Altium.

## Por que é fiel

O contrato de coordenadas é o mesmo do Altium, em todos os arquivos:

- **mm**, eixo **Y para cima**, relativo à **origem da placa** (`Board.XOrigin/YOrigin`) —
  exatamente os números da barra de status, do painel Properties e do PCB List;
- rotação em **graus anti-horário**, valor bruto de `Component.Rotation` (inclusive no bottom);
- camadas com nomes canônicos: `Top`, `Bottom`, `TopOverlay`, `BottomOverlay`, `Multi`, `Mech1`, `KeepOut`.

Os dados **nunca são transformados**; só a projeção de tela do viewer inverte Y.

## Instalação

1. Copie esta pasta para o seu PC (ex.: `Z:\AltiumPCBMirror`).
2. Se o caminho for diferente de `Z:\AltiumPCBMirror`, ajuste a constante `SCRIPT_HOME`
   no início do [ExportBoard.pas](ExportBoard.pas).
3. No Altium: **DXP » Run Script » Browse** e selecione `AltiumPCBMirror.PrjScr`
   (ou adicione o projeto de script ao seu workspace).

## Fluxo de uso

```
┌────────────┐  1. ExportBoard   ┌──────────────────────────┐
│   Altium   │ ────────────────► │  <pasta do PcbDoc>\PCBMirror\  │
│  (.PcbDoc) │                   │  board.js  viewer.html   │
└────────────┘                   │  changes.js  pcb-list.csv│
      ▲                          └──────────────────────────┘
      │                                     │ 2. IA (Claude Code) edita changes.js
      │ 4. ApplyChanges                     │ 3. você confere no viewer.html
      └─────────────────────────────────────┘
```

1. **Exportar** — com o `.PcbDoc` aberto: `DXP » Run Script » ExportBoard`.
   Cria a pasta `PCBMirror\` ao lado do `.PcbDoc` com:
   - `board.js` — espelho completo da placa (**não edite**);
   - `changes.js` — arquivo de mudanças (criado vazio; **nunca é sobrescrito** em re-exports);
   - `viewer.html` — visualizador (abre com duplo clique, sem internet);
   - `pcb-list.csv` — snapshot tipo PCB List (TSV);
   - `AI-GUIDE.md` — instruções para a sessão de IA.
2. **Personalizar com IA** — abra um Claude Code na pasta `PCBMirror\` e peça as mudanças
   ("afaste R5 do conector", "engrosse as trilhas de GND", "adicione vias de costura...").
   A IA lê `board.js` + `AI-GUIDE.md` e escreve **somente** `changes.js`.
3. **Conferir** — recarregue o `viewer.html` (F5). Ele mostra a placa com as mudanças
   aplicadas, o fantasma tracejado das posições originais, a lista de mudanças com validação
   e a tabela PCB List pós-mudança (célula amarela = valor alterado). O botão
   **CSV PCB List** exporta a tabela final.
4. **Aplicar** — no Altium, com a mesma placa aberta: `DXP » Run Script » ApplyChanges`.
   - Tudo entra como **uma única operação de undo** (Ctrl+Z desfaz completo).
   - Cada mudança só é aplicada se o objeto real da placa **casar com os campos `orig_*`**
     (tolerância 0,001 mm) — se a placa mudou desde o export, a mudança falha com aviso.
   - Relatório em `PCBMirror\apply-report.txt`.
5. **Fechar o ciclo** — rode o **DRC do Altium**, confira e re-execute `ExportBoard` para
   atualizar o espelho (o `changes.js` aplicado pode ser esvaziado/arquivado).

### Conferência manual via PCB List (opcional)

O `pcb-list.csv` (e o CSV pós-mudanças exportado pelo viewer) usa TAB como separador, nas
colunas `Designator, Footprint, Comment, Layer, X_mm, Y_mm, Rotation` — os mesmos valores do
painel **PCB List** do Altium (View » Panels » PCB List, modo Components). Dá para comparar
lado a lado ou usar *Smart Grid Insert* para colar posições em massa, se preferir o caminho
manual em vez do `ApplyChanges`.

## O que é editável (v1)

| Objeto | Operações em `changes.js` |
|---|---|
| Componente | `comp_move` (x, y, rot, layer/flip) |
| Trilha | `track_edit`, `track_add`, `track_del` |
| Via (furo metalizado) | `via_edit`, `via_add`, `via_del` |
| Arco de cobre | `arc_edit`, `arc_add`, `arc_del` |

Polígonos/planos, regiões, keepouts, textos e regras são exportados para **visualização**,
mas não são editáveis nesta versão. Furos de fixação/NPTH aparecem em `freepads`.

## Limitações e avisos

- **DRC é do Altium** — o viewer não checa clearance; sempre rode o DRC depois de aplicar.
- Texto de silkscreen é renderizado com fonte vetorial aproximada (posição/altura/rotação fiéis).
- Os `id`s (`t1`, `v2`...) valem para **um ciclo** export → apply; após aplicar, re-exporte.
- Flip de componente (`layer` diferente em `comp_move`) usa a operação nativa do Altium; o
  preview do viewer é uma aproximação — confira no Altium após aplicar.
- Salve o `.PcbDoc` **antes** de rodar `ApplyChanges` (é uma edição normal, com undo, mas
  backup nunca fez mal a ninguém).

## Estrutura do projeto

```
AltiumPCBMirror.PrjScr   projeto de script (adicione ao Altium)
ExportBoard.pas          Altium -> PCBMirror\ (espelho)
ApplyChanges.pas         PCBMirror\changes.js -> PCB aberta
viewer.html              visualizador (template; copiado pelo export)
AI-GUIDE.md              contrato/manual para a sessão de IA
example\                 placa sintética de demonstração (abra example\viewer.html)
docs\superpowers\specs\  documento de design
```

## Licença

MIT — veja [LICENSE](LICENSE). Dados da fonte vetorial de silkscreen provenientes do
InteractiveHtmlBom/InteractiveHTMLBOM4Altium2 (MIT).
