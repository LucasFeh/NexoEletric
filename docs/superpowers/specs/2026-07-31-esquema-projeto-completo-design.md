# AltiumPCBMirror v2 — Esquema elétrico, bibliotecas e projeto completo do zero

**Data:** 2026-07-31
**Status:** Aprovado pelo usuário (brainstorm em 4 seções, todas aprovadas)
**Base:** design v1 (`2026-07-28-altium-pcb-mirror-design.md`) — o contrato de fidelidade
da PCB permanece intacto; este documento só ADICIONA capacidades.

## 1. Objetivo

Permitir que a IA (Claude Code), além de personalizar PCBs (v1), monte um **projeto
eletrônico completo do zero**: escolher componentes das bibliotecas reais do usuário,
desenhar o esquema elétrico, transferi-lo para o Altium como `.SchDoc` verdadeiro
(com nets reais via compilador do Altium), e então posicionar e rotear a PCB pelo
fluxo v1 já existente. Tudo visível e conferível num hub HTML único, com histórico
local dos projetos criados.

Decisões do usuário durante o brainstorm:

- **Primeiro alvo:** um projeto novo pequeno (validar o fluxo de ponta a ponta).
- **Esquema → PCB:** fluxo nativo do Altium (ECO / Design » Update PCB) — projeto
  100% sincronizado, nada de placement direto sem vínculo.
- **Libs:** `Z:\Biblioteca\ALTIUM LIBRARY ------ LUCAS` contém
  `BIBLIOTECA DE ESQUEMA.SchLib` (1,7 MB) e `BIBLIOTECA DE FOOTPRINT.PcbLib` (63 MB);
  **só alguns símbolos têm footprint associado** — o espelho precisa reportar quem
  tem/não tem, e a IA define o footprint quando faltar.
- **Escopo desta versão (v2):** criar esquema do zero + espelhar esquema existente
  para visualização. Editar esquema existente com round-trip fica para a v3.
- **Workspace central:** tudo em `Z:\AltiumPCBMirror` (Libs\ + Projects\<nome>\ como
  histórico local). Sincronização com o Altium casa pelo **nome do projeto**; sem
  casamento, o script pergunta qual projeto usar.

## 2. Abordagens consideradas

- **A. (Escolhida) Workspace central + espelhos via scripts do Altium** — extensão
  natural do v1: novos scripts DelphiScript no mesmo `.PrjScr`, espelhos JSON das
  libs e do esquema, hub HTML único, ECO nativo no meio do fluxo. Só a API
  sancionada do Altium toca arquivos do Altium.
- **B. Parser binário direto (.SchLib/.PcbLib/.SchDoc)** — rejeitada: formato não
  documentado, frágil entre versões (mesmo motivo da rejeição no v1).
- **C. Só netlist, sem desenho de esquema** — rejeitada: não atende "esquema
  visível no HTML" nem "projeto completo".

## 3. Estrutura do workspace

```
Z:\AltiumPCBMirror\
├── AltiumPCBMirror.PrjScr     projeto de script (5 documentos)
├── ExportLibs.pas             NOVO: espelha as 2 bibliotecas → Libs\
├── ExportProject.pas          NOVO: espelha esquema+PCB do projeto aberto → Projects\<nome>\
├── BuildSchematic.pas         NOVO: schematic.js da IA → .SchDoc real no projeto aberto
├── ExportBoard.pas            evoluído: grava em Projects\<nome>\ (não mais ao lado do PcbDoc)
├── ApplyChanges.pas           evoluído: lê Projects\<nome>\changes.js (casamento por nome) + outline_set
├── hub.html                   NOVO: interface única (Projetos, Esquema, PCB, Libs)
├── viewer.html                absorvido pelo hub (deixa de ser copiado por-projeto)
├── Libs\
│   ├── schlib.js              espelho da BIBLIOTECA DE ESQUEMA
│   └── pcblib.js              espelho da BIBLIOTECA DE FOOTPRINT
├── Projects\
│   └── <nome>\                um por projeto = histórico local
│       ├── schematic.js       esquema (autorado pela IA ou espelhado do Altium)
│       ├── board.js           espelho da PCB (após ECO)
│       ├── changes.js         mudanças de PCB (formato v1 + outline_set)
│       └── build-report.txt / apply-report.txt
└── projects.js                índice do histórico (regenerado por scripts e pela IA)
```

O caminho das libs é constante configurável no topo de `ExportLibs.pas`.
Gravar em `Projects\<nome>\` resolve a pendência antiga de centralizar o export
no repositório do script.

### Fluxo "projeto novo do zero"

1. `ExportLibs` (uma vez / quando as libs mudarem).
2. IA escreve `Projects\<nome>\schematic.js` + atualiza `projects.js`.
3. Usuário confere no `hub.html`.
4. No Altium: cria `.PrjPcb` vazio com o mesmo nome e roda `BuildSchematic`.
5. Compile + **Design » Update PCB** (ECO nativo) → componentes e nets na PCB.
6. `ExportBoard` → IA posiciona/roteia em `changes.js` → `ApplyChanges` → DRC.

## 4. Contrato de coordenadas do esquema

Mesma filosofia da PCB: dados nunca transformados, só a projeção de tela.

| Aspecto | Convenção (idêntica ao Altium Sch) |
|---|---|
| Unidade | **mil** (1/1000"); pinos/fios em inteiros na grade de 100 mil |
| Eixos | X para a direita, **Y para cima**, origem no canto inferior esquerdo da folha |
| Rotação | 0/90/180/270 + flag `mirror` (como o Altium armazena) |
| Folha | `A4`, `A3`, ... com dimensões padrão do Altium |

## 5. Formatos de dados

### 5.1 `Libs\schlib.js`

Por símbolo: `name`, `description`, `partcount` (multi-parte); por parte: `pins[]`
(número, nome, x, y, comprimento, orientação, tipo elétrico), `graphics[]` (linhas,
retângulos, arcos, polylines, elipses, textos), `footprints[]` (modelos associados
na lib + flag de existência na PcbLib). É o relatório de "símbolos sem footprint".

### 5.2 `Libs\pcblib.js`

Por footprint: `name`, `description`, `pads[]` (nome, x, y, forma, tamanho, furo,
layer, rotação), silk (linhas/arcos), `bbox`. Corpos 3D excluídos (maior parte dos
63 MB — espelho 2D fica leve). Unidade: mm, como o board.js.

### 5.3 `Projects\<nome>\schematic.js`

Mesmo schema para esquema autorado (IA) e espelhado (`ExportProject`):

```js
var schematic = { header: {project, sheetsize, units:"mil"}, sheets: [ {
  name: "folha1",
  components: [ {ref:"R1", sym:"RES", part:1, x:4000, y:3200, rot:0, mirror:false,
                 footprint:"R0805", comment:"10k"} ],
  wires:      [ {pts:[[4000,3300],[4000,3600],[4400,3600]]} ],
  netlabels:  [ {net:"VCC_5V", x:4000, y:3600, rot:0} ],
  powerports: [ {net:"GND", style:"PowerGround", x:4400, y:3000, rot:180} ],
  junctions:  [ {x:4400,y:3600} ],
  texts:      [ {s:"Fonte 5V", x:3800, y:4000, h:10} ]
} ] };
```

- `sym` referencia o símbolo em `schlib.js`; `footprint` é **obrigatório** em todo
  componente (com link na lib: confirma; sem link: a IA escolhe da `pcblib.js`).
- Conectividade real, como no Altium: fio encostado em pino conecta, net label
  nomeia, power port liga potências. `BuildSchematic` só desenha; quem extrai as
  nets é o compilador do Altium.

### 5.4 `changes.js` — nova operação `outline_set`

Polígono (segmentos linha/arco) que redefine `Board.BoardOutline` — para a IA dar
forma/tamanho à placa nova após o ECO. Todo o resto do formato v1 permanece.

### 5.5 `projects.js`

Índice do histórico: por projeto — nome, datas, status na esteira
(`esquema → eco → roteada → aplicada`), contagens (componentes, nets, folhas) e
quais arquivos existem. Regenerado pelos scripts do Altium (varrendo `Projects\`)
e pela IA ao criar projeto novo.

## 6. Scripts do lado Altium

Todos DelphiScript no `AltiumPCBMirror.PrjScr`, com os idiomas de API já provados
no `ExportBoard`/`ApplyChanges` v1.

- **`ExportLibs.pas`** — abre as libs pelo caminho constante, itera símbolos
  (`SchServer`) e footprints (`PCBServer`), grava `Libs\*.js`, cruza modelos
  símbolo→footprint e marca links quebrados/ausentes. Resumo final (n símbolos,
  n footprints, n sem link).
- **`ExportProject.pas`** — espelha o projeto aberto: cada `.SchDoc` → entrada em
  `schematic.js`; PCB → `board.js` (mesma lógica do ExportBoard). Atualiza
  `projects.js`.
- **`BuildSchematic.pas`** — (1) casa projeto aberto ↔ `Projects\<nome>\` (auto por
  nome; senão lista numerada + InputBox); (2) **valida tudo antes de criar
  qualquer coisa** — `sym` existe? `footprint` existe? refs duplicados? — erros vão
  para `build-report.txt` e aborta; (3) cria um `.SchDoc` por folha na pasta do
  `.PrjPcb`, adiciona ao projeto, coloca cada componente **copiando o símbolo real
  da SchLib** (gráficos, pinos e parâmetros preservados), seta designator, comment
  e modelo de footprint, desenha fios, net labels, power ports, junctions, textos;
  (4) `.SchDoc` homônimo já existente → **não sobrescreve** sem confirmação
  explícita; (5) relatório + diálogo final apontando o próximo passo (Compile +
  Update PCB).
- **`ExportBoard.pas`** (evoluído) — mesma exportação fiel, destino
  `Projects\<nome>\`, atualiza `projects.js`. `changes.js` continua nunca sendo
  sobrescrito.
- **`ApplyChanges.pas`** (evoluído) — mesma aplicação com trava `orig_*` e undo
  único; lê de `Projects\<nome>\` (casamento por nome, senão pergunta); handler de
  `outline_set` protegido por confirmação.

**Erros (comum a todos):** documento errado/ausente → mensagem e aborta; pastas com
`ForceDirectories`; falha individual não derruba o lote (relatório linha a linha);
alterações sempre dentro de undo.

## 7. `hub.html`

Arquivo único autocontido na raiz (duplo clique, sem internet), 4 vistas:

- **Projetos (inicial)** — histórico: card por projeto de `projects.js` com nome,
  status na esteira, datas, contagens e miniatura da placa. Clique abre o projeto.
- **Esquema** — renderiza `schematic.js` com os gráficos reais de `schlib.js`:
  símbolos, fios, junctions, net labels, power ports, designator/comment. Zoom/pan,
  cursor em mil, clique em net destaca a net na folha inteira (com pinos membros).
  Painel lateral: lista de componentes (ref, símbolo, footprint, comment).
- **PCB** — a vista do `viewer.html` v1 integrada (render fiel, diff fantasma,
  PCB List, validação de `changes.js`, export CSV), lendo `Projects\<nome>\board.js`.
- **Libs** — navegador das bibliotecas: busca, símbolo desenhado + footprints
  associados lado a lado, aviso nos símbolos sem footprint.

Carregamento por injeção de `<script src="Projects/<nome>/...">` (técnica já
comprovada via `file://` no v1). O `viewer.html` por-projeto deixa de ser copiado.

## 8. Testes (sem Altium no ambiente de build)

- `.pas` seguem estritamente idiomas/nomes de API comprovados na base v1.
- JS validado com `node --check`.
- `example\` ganha um projeto sintético completo (schlib + pcblib + schematic +
  board) exercitando o hub inteiro.
- Teste lógico em node: schematic.js sintético → extração de nets esperada
  (simulando o compilador do Altium) → confere contra gabarito; round-trip PCB do
  v1 continua passando.

## 9. Limites do v2 (explícitos)

- Editar esquema **existente** (round-trip de edição) fica para v3 — espelho de
  esquema existente é só leitura.
- Folhas planas: sem hierarquia (sheet symbols/harnesses).
- Sem buses — fios, net labels e power ports cobrem o projeto pequeno alvo.
- Parâmetros custom dos símbolos: preservados na cópia, não editáveis.
- ECO é passo manual do usuário no Altium (garantia de sincronismo nativo).
- DRC/ERC continuam sendo os do Altium.
