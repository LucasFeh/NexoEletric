# pcbframe como shell fino — design

Data: 2026-08-03 · Branch: v2-esquema · Status: aprovado pelo usuário

## Problema

A vista PCB do hub ([pcbframe.html](../../../pcbframe.html), 53 KB) é o viewer v1 inteiro
colado inline: motor de changes, renderer, fonte vetorial e UI vivem dentro do HTML. O motor
é um **fork** do `applyPcbChanges` do `hub-core.js` — a cópia canônica tem teste
(`tests/test-apply.js`), a inline não. Isso já causou drift real: o suporte a `outline_set`
existia no `hub-core.js` e no `ApplyChanges.pas`, mas teve que ser portado à mão para o
`pcbframe.html` (auditoria de 03/08/2026). Ainda existem mais duas cópias do viewer v1:
`viewer.html` na raiz (a "fonte" do pcbframe, hoje sem consumidor) e `example/viewer.html`
(demo standalone, deliberadamente congelada).

A vista Esquema já segue o modelo certo: `schframe.html` é um shell fino (HTML+CSS+loader)
que carrega `hub-core.js` + `hub-draw.js` + `schframe.js`.

## Objetivo

Uma única implementação da lógica de PCB no workspace. `pcbframe.html` fica simétrico ao
`schframe.html`. Novas operações de change passam a existir num lugar só (`hub-core.js` no
lado JS), tornando o drift impossível por construção.

## Mudanças por arquivo

| Arquivo | Mudança |
|---|---|
| `pcbframe.html` | Mantém HTML, CSS e o loader `?p=` via `document.write` (funciona em `file://`) exatamente como estão. O `<script>` inline gigante sai; entram, nesta ordem: `hub-core.js`, `hub-draw.js`, os dados do projeto (`Projects/<p>/board.js` + `changes.js`, via loader existente) e `pcbframe.js`. Resultado: ~5 KB. |
| `pcbframe.js` (novo) | IIFE `"use strict"` no padrão do `schframe.js`. Lê os globals `pcbmirror`/`changes`, monta o modelo efetivo com `HubCore.applyPcbChanges(B, CH)` e contém só o que é exclusivo da vista: FONTDATA (fonte vetorial de silkscreen), renderer da placa (grid, outline, tracks, arcs, vias, pads, silk, texts, regions, ghost, seleção), interação (pan/zoom/hit-test), painéis laterais (camadas, lista de mudanças), PCB List com ordenação, export CSV, toolbar/teclado e init. ~700 linhas movidas do HTML, não reescritas. |
| `hub-core.js` | `applyPcbChanges` **não muda de comportamento**. Ganha os helpers puros de geometria hoje duplicados no inline — `compDelta`, `xfPoint`, `xfAngle`, `ownerDelta`, `effLayerForOwner` — exportados no objeto `HubCore`, ficando testáveis em node. Qualquer micro-divergência entre o fork inline e o canônico é resolvida a favor do canônico (que tem teste); divergência de comportamento visível, se aparecer, é registrada no plano antes de decidir. |
| `viewer.html` (raiz) | **Apagado** (aprovado pelo usuário). Era a fonte do pcbframe; nenhum outro arquivo o referencia. `example/viewer.html` permanece intocado como demo standalone v1. |
| `example/` | Intocado (congelado, como documentado no README). |
| `README.md` / `AI-GUIDE.md` | Atualizar a tabela/estrutura de arquivos: `pcbframe.js` novo, `viewer.html` removido da raiz, nota de que o motor de changes JS vive só no `hub-core.js`. |

## Sequência de commits

1. Commit do diff **pendente** do `outline_set` no `pcbframe.html` (estado verificado pela
   auditoria; mantém o histórico bisecável).
2. Refactor: criação do `pcbframe.js`, esvaziamento do `pcbframe.html`, helpers no
   `hub-core.js`, remoção do `viewer.html`, docs.

## Compatibilidade (o que NÃO muda)

- O hub continua abrindo `pcbframe.html?p=<nome>` em iframe; duplo clique sem internet
  continua funcionando (tudo via `<script src>` relativo, sem fetch/modules).
- Os 5 scripts `.pas` e os formatos `board.js`/`changes.js`/`projects.js` não são tocados.
- O fallback sem `?p=` (carregar `board.js`/`changes.js` da raiz) é preservado no loader.
- Comportamento visual e de interação da vista PCB: idêntico (é mover código, não reescrever).

## Verificação

- `node --check` no `pcbframe.js` (e um smoke de que `pcbframe.html` só contém o loader).
- Os 3 testes node existentes continuam passando sem alteração (o motor não muda).
- Conferência visual com `_DemoKit` e `example/board.js` (aberto pelo hub) comparando com o
  estado atual antes do refactor.
- Critério de aceite: nenhuma referência a `buildModel`/FONTDATA dentro de `pcbframe.html`;
  o switch de aplicação das operações de change (`case 'comp_move'`, `'track_add'`,
  `'outline_set'`...) existe, no lado JS, apenas no `hub-core.js` (no `pcbframe.js` a string
  de uma op pode aparecer só em rótulo de UI, ex.: `chLabel`).

## Fora de escopo

- Bugs do caminho de volta confirmados na auditoria de 03/08/2026 (teleporte do `comp_move`
  sem x/y no `ApplyChanges.pas:671`, `ParsePts` exigindo `"pts":[` sem espaço, divergências
  hub × `BuildSchematic.pas` de folha/case/rotação) — correções separadas.
- Qualquer mudança de feature na vista PCB.
- Unificar os HTMLs num arquivo único (descartado na conversa: recriaria o monolito).
