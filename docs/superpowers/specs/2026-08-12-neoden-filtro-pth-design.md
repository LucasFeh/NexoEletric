# Filtro PTH e exclusão de componentes na aba Neoden — design

Data: 2026-08-12 · Branch: main · Status: aprovado em sessão
Estende: `2026-08-05-neoden-csv-design.md`

## Problema

A Neoden 4 é uma máquina só-SMD: componente PTH na lista trava a colocação. O design
original decidiu explicitamente incluir tudo ("PTH vs SMT — o script original inclui
tudo e o operador pula na máquina"), o que na prática obriga a editar o CSV na mão.
Números reais dos boards do repo: MID-DI261897 tem 38 PTH em 166 componentes,
PRJ-DI221694D tem 32 em 68, TCMS_Reader tem 11 em 17. Editar isso na mão a cada
regeração do board.js não escala.

Objetivo: tirar componentes da lista exportada pela interface — com um filtro de tipo
("todos que têm PTH"), seleção em lote e exclusão individual reversível.

## Classificação: dado, não heurística

`board.js` já grava `components[].pads[].type` com `"th"` ou `"smd"` (únicos valores
presentes nos 9 projetos do repo). Não é preciso adivinhar por nome de footprint.

`neodenKind(comp)` → uma de quatro:

| retorno | regra                        |
|---------|------------------------------|
| `smd`   | todos os pads `smd`          |
| `pth`   | todos os pads `th`           |
| `misto` | tem pad `th` e pad `smd`     |
| `?`     | sem `pads` no board.js       |

**Misto é categoria própria, não PTH.** Existe de verdade — MD4 (ESP32-H2-SuperMini)
no VDCB-DI251879 — e é um módulo que assenta em pads SMD com furos de header junto:
colocável. Tratá-lo como PTH derrubaria da lista um componente que a máquina coloca.

**`?` nunca é excluído automaticamente.** Nenhum componente dos boards atuais cai nele;
se um board vier sem `pads`, marcar como indefinido é honesto, chutar `smd` não é.

A ação em lote **Excluir PTH** pega **só `pth`** — nunca `misto`, nunca `?`.

## Exclusão dentro do pipeline

`neodenTransform` ganha `opts.exclude` (array de designators). As linhas de saída ganham
três campos: `kind`, `excluded` e `idx`.

Ordem dentro da função:

1. ordena com a referência em primeiro (como hoje);
2. **a referência é retirada da lista de exclusão** — nunca sai do CSV;
3. marca `excluded` em cada linha;
4. numera `idx` = índice de exportação, **contando só os incluídos** (`null` nos excluídos);
5. relativo / rotação / offset aplicam em **todas** as linhas, inclusive excluídas — a
   prévia mostra a coordenada coerente do que foi tirado; o CSV é quem filtra;
6. `mover após N` (`-m`) passa a comparar contra `idx`, pulando os excluídos.

O passo 6 é a razão de a exclusão viver no core e não na camada de vista: `-m` desloca
tudo depois do índice N (uso: painel). Se a exclusão ficasse só na hora do download,
tirar os 32 PTH do PRJ-DI221694D deslocaria o corte do painel em 32 posições e o painel
sairia errado. Numerando sobre os incluídos, o `#` da tabela, o N do campo e a linha do
CSV são sempre o mesmo número.

`neodenCsv(rows, side)` pula `r.excluded` além do filtro de lado que já faz.

**Retrocompatibilidade:** sem `opts.exclude`, `excluded` é `false` em todas as linhas,
`idx` iguala a posição e `-m` se comporta exatamente como antes. Os testes de paridade
com o `neodenAltium.py` continuam valendo sem edição.

## Interface (aba Neoden)

**Barra da lista** — três controles novos ao lado da busca que já existe:

- `filtro`: *todos · SMD · PTH · misto · excluídos*. Combina com a busca de texto por E.
- **Excluir PTH**: exclui todos os `pth` de uma vez.
- **Restaurar**: reinclui tudo; desabilitado quando não há nada excluído.

A `.comp-bar` da aba precisa de `flex-wrap` — passa a ter busca, contador, filtro e
quatro botões.

**Tabela** — duas colunas novas:

- checkbox de inclusão à esquerda. O checkbox do cabeçalho marca/desmarca **todos os
  visíveis no filtro corrente** — é o "selecionar vários de uma vez": filtrar PTH e
  desmarcar o cabeçalho tira os 38 num gesto. Shift+clique seleciona intervalo.
- `Tipo`: badge SMD (cinza) / PTH (vermelho) / MISTO (amarelo) / vazio para `?`.

Linha excluída fica riscada e apagada; `#` vira `—`. O checkbox da referência fica
desabilitado, com a dica de trocar a referência antes.

**Aside** ganha `incluir no CSV` para o componente selecionado, junto do
`definir como referência` que já existe.

**Contador**: `N no CSV · M excluídos (de T)`.

**Download**: se o lado escolhido ficar sem nenhuma linha incluída, mostra toast de aviso
em vez de baixar um CSV só com cabeçalho.

## Persistência

`localStorage['altiumhub.neoden.excl.<projId>']` = array JSON de designators, lido em
`loadProject` e gravado a cada mudança. **Restaurar** apaga a chave. Referência e offset
de máquina continuam sem persistir — fora de escopo.

## Testes (`tests/test-neoden.js`)

- `neodenKind` nos quatro casos (smd puro, th puro, misto, sem pads);
- excluído sai do CSV e continua na prévia com coordenada transformada;
- `#` renumera sobre os incluídos;
- `mover após N` conta só incluídos;
- referência imune mesmo listada em `exclude`;
- chamada sem `exclude` idêntica ao comportamento anterior.

## Fora de escopo

Esmaecer os excluídos no desenho da placa embutida (exigiria API nova no pcbframe);
persistir referência/offset; qualquer ajuste de nozzle/feeder (segue na UI da Neoden).
