# AltiumPCBMirror — Espelho fiel da PCB do Altium em HTML, com round-trip via IA

**Data:** 2026-07-28
**Status:** Aprovado para implementação (sessão autônoma — decisões documentadas abaixo; ajustes bem-vindos)
**Base de referência:** `InteractiveHTMLBOM4Altium2` (somente leitura — nada foi alterado lá)

## 1. Objetivo

Permitir que uma IA (Claude Code), sem acesso ao Altium, personalize uma PCB:

1. **Exportar**: um script roda dentro do Altium na PCB **aberta** e espelha todos os dados
   (componentes, pads, trilhas, arcos, vias/furos, silkscreen, contorno) para arquivos
   texto + um visualizador HTML **fiel ao ambiente do Altium**.
2. **Editar**: a IA edita um arquivo de mudanças (`changes.js`) — mover/rotacionar
   componentes, editar/criar/apagar trilhas, vias e arcos. O HTML mostra o resultado
   e o diff (fantasma da posição original).
3. **Aplicar**: outro script roda no Altium e aplica as mudanças na PCB real, nas
   **mesmas coordenadas** exibidas no HTML (as mesmas que aparecem no PCB List /
   painel Properties do Altium). Um CSV compatível com o PCB List é gerado para
   conferência/colagem manual.

## 2. Requisito central: fidelidade

O contrato de coordenadas é a garantia de fidelidade — **os dados nunca são
transformados**, apenas a projeção de tela do viewer:

| Aspecto | Convenção (idêntica ao Altium) |
|---|---|
| Unidade | mm, 6 casas decimais (resolução interna do Altium ≈ 0,0000025 mm) |
| Eixos | X para a direita, **Y para cima** |
| Origem | Origem da placa (`Board.XOrigin/YOrigin`) — os mesmos números da barra de status, Properties e PCB List do Altium |
| Rotação | Graus, anti-horário, valor bruto de `Component.Rotation` (inclusive no bottom) |
| Camadas | Nomes canônicos: `Top`, `Bottom`, `TopOverlay`, `BottomOverlay`, `Multi`, `Mech1`, `KeepOut` |

O viewer inverte Y **somente na matriz de projeção** (tela é Y-para-baixo). O projeto
base (ibom) inverte Y e nega ângulos nos próprios dados — aqui isso foi rejeitado de
propósito, pois quebraria o round-trip.

## 3. Abordagens consideradas

- **A. Fork do InteractiveHTMLBOM4Altium2** — rejeitada. O pipeline do ibom é
  orientado a visualização (Y invertido nos dados, ângulos negados, campos de BOM),
  e a UI é centrada em BOM. Enxertar edição/round-trip nele luta contra a arquitetura.
- **B. Ler o .PcbDoc direto (parser de arquivo)** — rejeitada. Formato binário
  não documentado, frágil entre versões; e o requisito é a placa **aberta**, cujo
  caminho sancionado é a API de scripting.
- **C. (Escolhida) Par de scripts DelphiScript novos + viewer HTML próprio**,
  com dados na convenção nativa do Altium e mudanças declarativas com valores
  originais embutidos para verificação. Reusa da base apenas o *conhecimento* da API
  (nomes de propriedades, iteradores, idiomas) e os dados de fonte vetorial (MIT).

## 4. Arquitetura

```
z:\AltiumPCBMirror\
├── AltiumPCBMirror.PrjScr    projeto de script do Altium (2 documentos)
├── ExportBoard.pas           Altium → PCBMirror\ (board.js, viewer.html, changes.js, pcb-list.csv)
├── ApplyChanges.pas          PCBMirror\changes.js → PCB aberta (com undo) + apply-report.txt
├── viewer.html               template estático do visualizador (copiado pelo export)
├── AI-GUIDE.md               contrato para a sessão de IA que edita changes.js
├── README.md                 fluxo de uso completo (PT-BR)
└── example\                  board.js + changes.js de demonstração
```

Saída do export: subpasta **`PCBMirror\`** ao lado do `.PcbDoc` aberto, contendo
`board.js`, `changes.js` (criado vazio só se não existir — nunca sobrescrito),
`viewer.html`, `pcb-list.csv`, `AI-GUIDE.md`. A pasta `PCBMirror\` é o diretório de
trabalho da sessão de IA.

### 4.1 `board.js` (verdade exportada — a IA nunca edita)

`var pcbmirror = { ... }` — JSON com: cabeçalho (formato, data, arquivo fonte,
unidades, convenção de eixos), contorno da placa (`Board.BoardOutline` segmentos
linha/arco), `nets`, `components` (id, ref, footprint, comment, layer, x, y, rot,
bbox, pads com forma/tamanho/furo/net), `tracks`, `arcs`, `vias` (ids estáveis `t1…`,
`a1…`, `v1…` dentro de um export), `freepads` (furos de fixação/NPTH), `texts` e
`silk` (com `owner` = ref do componente dono, para o preview mover junto), `regions`
(polígonos de cobre, somente visualização), `stats`.

Arquivo `.js` (e não `.json`) para o viewer funcionar via `file://` sem CORS; o
conteúdo após `=` é JSON puro e a IA lê normalmente.

### 4.2 `changes.js` (única fonte de edição — escrita pela IA)

`var changes = [ ... ];` — um objeto JSON **plano por linha** (parse trivial em
DelphiScript). Operações: `comp_move`, `track_edit|add|del`, `via_edit|add|del`,
`arc_edit|add|del`. Toda edição/remoção carrega `orig_*` copiados de `board.js`;
o script de aplicação **só aplica se o objeto real casar com `orig_*`** (tolerância
0,001 mm) — proteção contra placa dessincronizada. `layer` em cobre: `Top|Bottom`.
Em `comp_move`, mudar `layer` = flip do componente.

### 4.3 `viewer.html` (espelho visual, somente leitura)

Autocontido (CSS/JS/fonte vetorial embutidos; carrega `board.js` + `changes.js` por
`<script src>`): tema escuro 2D do Altium com cores padrão de camadas; zoom/pan;
leitura de cursor em mm e mil relativa à origem (como a barra de status do Altium);
marcador de origem; grade adaptativa; toggles de camada; vista Top/Bottom (flip
horizontal como no Altium); tabela **PCB List** (Designator, Footprint, Comment,
Layer, X, Y, Rotation) com valores pós-mudança, células alteradas destacadas,
clique↔seleção no canvas; render do diff (fantasma tracejado do original, halo para
adicionados, X para removidos); painel de validação (orig divergente, campos
faltando, camada inválida); botão de exportar CSV pós-mudanças (TSV para colar no
PCB List). Texto silkscreen renderizado com a fonte vetorial da base (aproximação
visual; não participa do round-trip).

### 4.4 `ApplyChanges.pas`

Lê `PCBMirror\changes.js` da placa aberta; parser key=value por linha
(`ExtractJSONString/Number`); casamento: componente por designator, trilha por
extremos+camada+largura originais (qualquer direção), via por posição original, arco
por centro/raio/ângulos. Tudo dentro de `PCBServer.PreProcess/PostProcess` (um único
undo). Criação via `PCBObjectFactory`, net atribuída por nome. Relatório
`apply-report.txt` (OK/FALHA por mudança + resumo) e diálogo final. Depois de
aplicar, o usuário re-exporta para regenerar o espelho e roda o DRC do Altium.

### 4.5 `pcb-list.csv`

TSV com Designator, Footprint, Comment, Layer, X_mm, Y_mm, Rotation — snapshot no
export; o viewer gera a versão pós-mudanças. Serve para conferência e para colagem
em massa no painel PCB List (Smart Grid Insert).

## 5. Tratamento de erros

- Export: sem PCB aberta → mensagem e aborta; pasta de saída criada com
  `ForceDirectories`; `changes.js` existente nunca é sobrescrito.
- Apply: mudança sem casamento ou com `orig_*` divergente → FALHA no relatório, as
  demais continuam; nets inexistentes em `*_add` → objeto criado sem net + aviso;
  linha malformada → FALHA com o texto da linha.
- Viewer: valida `changes` contra `board` e lista erros antes de renderizar o efeito.

## 6. Escopo / limitações (v1)

- Editáveis: componentes (posição/rotação/lado), trilhas, arcos, vias. Polígonos,
  regiões, keepouts, texto e regras: somente visualização.
- Texto silkscreen: aproximação visual (fonte vetorial), fiel em posição/altura/rotação.
- Sem DRC no viewer — o DRC continua sendo o do Altium, rodado após aplicar.
- IDs são estáveis apenas entre um export e o apply correspondente (protegidos por `orig_*`).

## 7. Testes

- Sem Altium disponível no ambiente de build: scripts `.pas` seguem estritamente os
  idiomas/nomes de API comprovados no projeto base (mesma superfície de API).
- JS do viewer validado com `node --check`; `example\` com placa sintética
  (componentes, trilhas, vias, silk, diff) verificada com `node` (parse + aplicação
  das mudanças) e serve como demo abrível no navegador.
- Round-trip lógico: script de teste em node confirma que aplicar `changes` sobre
  `board.js` e gerar o PCB List bate com o esperado.
