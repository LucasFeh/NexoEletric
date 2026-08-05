# AltiumPCBMirror Hub — spec de implementação

Documento de referência para reconstruir a interface do hub. Escrito para ser
lido por uma IA de código (Claude no VS Code) com acesso à pasta do projeto.

**Arquivo de exemplo:** `referencia/hub.html` — implementação completa e
funcional em HTML + CSS + JS puro, um arquivo só. Abre direto no navegador
(cai em dados de demonstração quando não há servidor). Use-o como base: copie,
troque a camada `API` pelos endpoints reais e monte o renderer existente no
ponto marcado.

Stack: HTML + CSS + JS puro, sem framework, sem build step, servido por um
servidor local (node/python).

---

## 1. O que muda em relação ao hub atual

| Hoje | Novo | Por quê |
| --- | --- | --- |
| Grade de cards, um por projeto | Combobox no header com busca | 100 projetos não cabem numa grade |
| 4 pílulas coloridas por card | Pipeline de 4 etapas com 3 estados | Estado atual fica óbvio sem decorar cores |
| Botões `Esquema` / `PCB` soltos | Abas com contadores | Um lugar só para toda a informação |
| Componentes/nets não aparecem | Abas Componentes, Nets, Footprints | Era o que faltava |
| Fluxo de 7 passos ocupa a home | Faixa de uma linha no rodapé + modal | A home é o projeto, não o tutorial |
| Nenhuma ação executável | Botão da próxima ação + menu completo | Menos ida e volta ao terminal |

---

## 2. Arquitetura de tela

```
#app  height:100vh
      grid-template-rows: auto auto auto 1fr auto
      grid-template-columns: minmax(1040px, 1fr)
      overflow-x: auto; overflow-y: hidden

  [1] header    — marca · seletor de projeto · servidor · ExportLibs · reindexar
  [2] .projbar  — nome + selos · pipeline · pendências · ação principal · menu
  [3] .tabs     — abas + agregados do projeto
  [4] main      — painel da aba ativa (única região que rola na vertical)
  [5] footer    — fluxo de 7 passos
```

Regras não negociáveis:

- `html, body { height:100%; overflow:hidden }` — a página nunca rola inteira.
- O scroll vertical vive dentro do painel da aba, num elemento com
  `overflow-y:auto` **e** `min-height:0` no item de grid pai. Sem `min-height:0`
  o grid não deixa o filho encolher e o scroll vaza.
- Largura mínima de 1040px (`--page-min`). Abaixo disso a página rola na
  horizontal em vez de esconder controles à direita. Nenhum filho pode ter
  `overflow-x:auto` próprio — duas barras horizontais empilhadas leem como bug.
- Elementos de largura fixa: seletor 420px (`flex: 1 1 420px; max-width:420px`),
  painel de detalhe 330px. Todo o resto é `minmax(0,1fr)`.
- Todo container de flex que possa truncar texto precisa de `min-width:0`.

---

## 3. Design tokens

Todos os valores vivem no `:root`. **Nenhum hex fora desse bloco.**

```css
--bg:        #0f0f11;   --surface:   #1a1a1d;   --surface-2: #161619;
--sunken:    #0b0b0d;   --text:      #f2f2f3;   --text-2:    #a8a8ae;
--text-3:    #7a7a80;   --text-4:    #57575d;
--line:      rgba(242,242,243,0.14);
--line-soft: rgba(242,242,243,0.08);
--hi:        #d8d8dd;   /* destaque = branco-cinza, nunca cor */
--surface-3: #17171a;   /* topo do gradiente do header */
--edge:      #2a2a2e;   /* borda interna de tag, card e viewport */
--scroll:    #34343a;   --dot-idle: #3a3a40;
--scrim:     rgba(11,11,13,0.55);
```

Inter entra por `<link>` no `<head>`, nunca por `@import` no meio do
`<style>` — o navegador descarta `@import` que não seja a primeira regra da
folha, e a fonte cai silenciosamente no fallback.

Cor carrega **status** e nada mais:

| Token | Valor | Significa | Onde aparece |
| --- | --- | --- | --- |
| `--ok` | `#4bbf7b` | online, concluído, sucesso | servidor, etapa concluída, histórico ok |
| `--warn` | `#d6a75a` | pendente, aviso | mudanças pendentes, DRC com aviso, execução em curso |
| `--err` | `#e0555a` | offline, erro, sem esquema | ponto do seletor, falha de execução |
| `--idle` | `#4a4a50` | inativo, não iniciado | etapa futura, ponto vazado |

Seleção, aba ativa, hover e destaque usam **branco a baixa opacidade**
(`rgba(242,242,243,0.04 / 0.07 / 0.09 / 0.10 / 0.16 / 0.22`), nunca cor.

Tipografia: Inter 400/500. Corpo 15px/1.55. Dados técnicos (designator, path,
comando, net, posição, footprint) em `--mono`. Números em tabelas com
`font-variant-numeric: tabular-nums`.

Espaço: `3 / 6 / 8 / 11 / 17 / 22px`. Raios: `5 / 8 / 14px`.

Botões são **contornados**, nunca preenchidos. Foco de teclado é sempre
`outline: 2px solid var(--hi); outline-offset: 2px` — não remover.

---

## 4. Contrato de dados

### 4.1 Índice — `GET /api/index.json`

Escrito pelo indexador; carregado uma vez no boot.

```json
{
  "generatedAt": "2026-08-05T14:32:00Z",
  "projects": [
    {
      "id": "tcms2",
      "name": "TCMS_Reader_V2",
      "path": "Projects\\TCMS_Reader_V2",
      "demo": false,
      "noSchematic": false,
      "stages": [2, 0, 0, 0],
      "pending": 0,
      "stats": { "sheets": 1, "comps": 81, "nets": 49, "tracks": 0, "vias": 0 }
    }
  ]
}
```

`stages` é um array de 4 inteiros na ordem `esquema, eco, roteada, aplicada`:

- `0` — não iniciada
- `1` — concluída
- `2` — etapa atual (no máximo uma por projeto)

Deriva-se do sistema de arquivos: `schematic.js` existe → esquema; `changes.js`
com ECO aplicado → eco; `board.js` com trilhas > 0 → roteada; marcador de
`ApplyChanges` → aplicada.

`pending` é a contagem de operações em `changes.js` ainda não aplicadas.

### 4.2 Detalhe — `GET /api/project/<id>.json`

Carregado sob demanda, ao trocar de projeto.

```json
{
  "components": [{
    "des": "U1", "value": "STM32F103C8T6",
    "footprint": "LQFP-48_7x7mm_P0.5mm", "lib": "MCU_ST_STM32F1",
    "pins": 48, "layer": "Top", "pos": "48.26, 31.75 mm", "rot": "0°",
    "nets": ["VDD", "GND", "SWDIO", "SWCLK"]
  }],
  "nets": [{ "name": "GND", "cls": "Power", "nodes": 34, "tracks": 96, "width": "0.5 mm" }],
  "footprints": [{ "name": "C_0402_1005Metric", "lib": "Capacitor_SMD",
                   "desc": "Capacitor SMD 0402", "usage": "18 componentes", "pads": "2 pads" }],
  "history": [{ "when": "hoje 14:32", "kind": "ok",
                "title": "ExportBoard concluído", "detail": "board.js atualizado" }],
  "schematic": { },
  "board": { }
}
```

`kind` ∈ `"ok" | "run" | "warn" | "err"`.

`schematic` e `board` carregam o que o renderer atual já consome — **não
reformate**. Inspecione `schematic.js` / `board.js` e passe a estrutura como
está.

### 4.3 Execução — `POST /api/run`

```
POST /api/run
  { "project": "tcms2", "action": "ExportBoard" }
  → 202 { "runId": "r_8f21" }

GET /api/run/r_8f21/stream        (Server-Sent Events)
  data: > node scripts/export-board.js
  data: 81 componentes lidos
  event: done
  data: {"ok":true}
  # ou
  event: error
  data: "exit code 1"
```

Ações válidas: `ExportLibs`, `BuildSchematic`, `ExportBoard`, `ApplyChanges`,
`DRC`, `Rescan`. O servidor mapeia cada uma para o script correspondente e
recusa qualquer outro valor (nunca interpolar entrada do cliente num comando).

Após `done`, o front recarrega `index.json` e o detalhe do projeto.

### 4.4 Sem índice

Se `index.json` não existir, mostrar um estado vazio com o comando de indexação
(`node scripts/scan.js`) — nunca uma tela em branco.

---

## 5. Regiões da interface

### 5.1 Header

Da esquerda: marca (`AltiumPCBMirror` + `hub` em caixa alta 11px, `flex:none`),
seletor de projeto, e à direita `flex:none` com status do servidor, botão
`ExportLibs` e botão-ícone de reindexar.

Status do servidor: ponto 5px + `localhost:5173` em 11px `--text-3`. Verde
quando o `fetch` do índice responde; vermelho quando falha.

### 5.2 Seletor de projeto

Combobox, não grade. Escala para 100+ projetos sem empurrar conteúdo.

**Gatilho** — ponto de status + nome truncado + contagem total + chevron.
Borda `--line`, vira `--hi` quando aberto. Ponto:

- vermelho `--err` se `noSchematic`
- âmbar `--warn` se `pending > 0`
- verde `--ok` caso contrário

**Painel** — `position:absolute`, `z-index:40`, largura do gatilho, sombra
`--shadow-menu`. Campo de busca no topo (foco automático), lista rolável
`max-height:340px`.

**Click-catcher** — `<div>` `position:fixed; inset:0; z-index:30` atrás do
painel, fecha ao clique. Sem ele o painel fica preso sobre o conteúdo.

**Item** — nome (13px, truncado) + resumo (`N comps · N nets` ou `sem esquema`,
11px `--text-3`) à esquerda; 4 pontinhos de 5px à direita, verde para etapa
concluída, cinza para as demais. Item ativo e hover: `rgba(242,242,243,0.09)`.

**Busca** — substring, case-insensitive, no nome. Sem debounce necessário até
~500 projetos.

**Teclado** — `Ctrl/Cmd+K` abre de qualquer lugar, `Esc` fecha, `↑ ↓` navega,
`Enter` seleciona. (`Ctrl+K` e `Esc` já estão no exemplo; setas ficam a
implementar.)

**Persistência** — projeto ativo em `localStorage['altiumhub.project']` e no
hash da URL (`#tcms2/comp`), para link direto e para sobreviver ao reload.

### 5.3 Barra do projeto

Três blocos numa linha: identidade (`min-width:0`), pipeline (`flex:none`),
ações (`margin-left:auto; flex:none`).

**Identidade** — `h4` 19px truncado em 380px, selos ao lado (`demo` contornado,
`sem esquema` cinza), e o caminho em mono 11px `--text-3` embaixo.

**Pipeline** — quatro etapas em sequência:

| Estado | Marca | Texto | Fundo |
| --- | --- | --- | --- |
| Concluída (`1`) | ponto 6px `--ok` | `--text-2` | — |
| Atual (`2`) | ponto branco + halo `0 0 0 3px rgba(242,242,243,.22)` | `--text` | `rgba(242,242,243,.08)` + contorno 1px `--hi` |
| Futura (`0`) | ponto vazado `inset 0 0 0 1px var(--idle)` | `--text-4` | — |

**Ações** — contagem de pendências em `--warn` quando `pending > 0`; botão
primário com a **próxima ação derivada**. O mapa é uma tabela explícita,
indexada pelo número de etapas concluídas — nunca reaproveite esse índice para
destacar o passo do rodapé, porque as duas listas têm tamanhos e significados
diferentes. Cada entrada aponta o passo do fluxo:

```js
const STEP = {
  none: { label: 'Pedir schematic.js',   flow: 1, run: false }, // sem schematic.js
  0:    { label: 'BuildSchematic',       flow: 3, run: true  },
  1:    { label: 'Compile + Update PCB', flow: 4, run: false }, // manual no Altium
  2:    { label: 'ExportBoard',          flow: 5, run: true  },
  3:    { label: 'ApplyChanges',         flow: 6, run: true  },
  4:    { label: 'DRC',                  flow: 6, run: true  },
};
const step = p.noSchematic ? STEP.none : STEP[p.stages.filter(v => v === 1).length];
```

`run: false` marca um passo que não é um script: o botão abre o modal do fluxo
na explicação correspondente em vez de executar. O destaque no rodapé vem de
`step.flow`. Ao lado, botão `⋮` com o menu de todas as ações.

### 5.4 Abas

`Esquema · PCB · Componentes · Nets · Footprints · Histórico`

Contador ao lado do rótulo nas três abas de lista. Aba ativa: texto cheio +
`inset 0 -2px 0 var(--hi)`. À direita da barra, agregados do projeto
(`comps · nets · trilhas · vias`) — sempre visíveis, independem da aba.

Estado da aba entra no hash da URL.

### 5.5 Esquema e PCB

Mesma casca para as duas: `grid-template-rows: auto 1fr`.

Barra fina: título em caixa alta, meta (`1 folha(s) · 81 comps · 49 nets` ou
`148 trilhas · 8 vias · 2 layers`), e à direita `Ajustar`, `Camadas`,
`Abrir em nova aba`.

Viewport: `--sunken` com grid de pontos em `background`, `border-radius:8px`,
`box-shadow: inset 0 0 0 1px #2a2a2e`, `overflow:hidden`. Controles de zoom
flutuando no canto inferior esquerdo (`−`, `+`, nível %).

**Monte o renderer que já existe.** No exemplo, o ponto está marcado com
`►►► PONTO DE MONTAGEM DO RENDERER EXISTENTE ◄◄◄` e o viewport mostra um
placeholder com a assinatura da chamada esperada
(`renderSchematic(vp, d.schematic)` / `renderBoard(vp, d.board)`). Leia `schematic.js` /
`board.js` e o desenho atual do hub e chame o mesmo código ali — o contêiner já
resolve fundo, borda e recorte. Não reescreva o renderer.

Interação esperada: arrastar para pan, `Ctrl+scroll` para zoom, `F` para
ajustar à tela, clique num componente seleciona e abre a aba Componentes nele.

**Estado vazio** — sem `schematic.js`, a aba Esquema mostra selo `sem esquema`
e uma frase com o próximo passo. Sem roteamento, a aba PCB mostra o equivalente.
Nada é bloqueado: as outras abas continuam navegáveis.

### 5.6 Componentes

`grid-template-columns: minmax(0,1fr) 330px`.

**Tabela** — `Desig. · Valor · Footprint · Library · Pins`. Larguras fixas nas
colunas curtas (78 / 108 / — / 130 / 62), Footprint absorve a sobra. Designator
em mono; Pins alinhado à direita com `tabular-nums`.

Linha selecionada: `aria-selected="true"` → `inset 2px 0 0 var(--hi)` + fundo
`rgba(242,242,243,.09)`. O alvo de clique é a linha inteira.

**Filtro** — campo único acima da tabela, casando contra
`des + value + footprint + nets.join(' ')`. Contador `N de M` ao lado.
`Exportar BOM` à direita.

**Painel de detalhe** — kicker `componente`, designator 22px + valor, pares
rótulo/valor (Footprint, Library, Pins, Layer, Posição, Rotação) com rótulo de
88px em `--text-3`, nets como chips mono, e dois botões: `Ver no esquema` /
`Ver no PCB` (trocam de aba e dão highlight no elemento correspondente).

Sem seleção: uma frase curta em 12px `--text-3`. Nada de ilustração.

**Escala** — acima de ~500 linhas, virtualizar (janela de ~60 linhas com
`translateY`) ou paginar de 200 em 200. O filtro roda em memória; para 5000+
componentes, mover para o servidor (`?q=`).

### 5.7 Nets

Tabela `Net · Classe · Nós · Trilhas · Largura`. Nome em mono `--hi`, números à
direita. Linhas não são clicáveis (`cursor:default`) até existir uma vista de
net.

### 5.8 Footprints

Grade `repeat(auto-fill, minmax(230px,1fr))`, gap 10px. Card: biblioteca como
kicker, nome em mono 15px, descrição em `--text-2`, e rodapé com quantos
componentes usam e quantos pads.

### 5.9 Histórico

Grid de 3 colunas: `108px (timestamp) · 18px (ponto) · 1fr (texto)`. Mais
recente no topo. Ponto por `kind`: `ok` verde, `warn` âmbar, `err` vermelho,
`run` cinza. Título em 13px, detalhe em mono 11px `--text-3`.

Alimentar de um `history.jsonl` (uma linha JSON por evento) que cada script
escreve ao terminar.

### 5.10 Rodapé do fluxo

Faixa de 8px de padding sobre `--sunken`. Sete passos `número + rótulo` em
11px; o passo correspondente ao `nextIdx` recebe fundo branco 10%.

O passo destacado é `step.flow`, o mesmo que o botão primário anuncia — os
dois nunca podem discordar. O texto explicativo **não** aparece na faixa: vai para o `title` (tooltip) e
para o modal `Ver detalhes`, que lista os 7 passos com a explicação completa.

A faixa precisa caber em 1040px sem scroll próprio. Se acrescentar passos,
encurte rótulos.

---

## 6. Ações

Três níveis, do mais frequente ao menos:

1. **Botão primário** na barra do projeto — a próxima ação derivada do
   pipeline. Um clique, sem escolha.
2. **Menu `⋮`** — todas as ações, cada uma com o comando real embaixo do rótulo
   (`node scripts/export-board.js`), legível e copiável.
3. **Header** — `ExportLibs` e reindexar, que são globais.

Ciclo de execução:

- ao disparar: botão desabilitado, toast âmbar `<Ação> em execução…`
- durante: linhas do SSE acumulam num buffer (mostrar num painel de log
  expansível, não no toast)
- sucesso: toast verde, recarrega índice + detalhe
- falha: toast vermelho **e** abre o log completo. Nunca só um toast vermelho.

Toast: `position:fixed`, centralizado, 54px do rodapé, some em 2.8s.

---

## 7. Estado do front

```js
const S = {
  projects: [],     // índice carregado uma vez
  detail: null,     // detalhe do projeto ativo
  projId: null,     // persiste em localStorage + hash
  tab: 'esquema',   // persiste no hash
  selDes: null,     // designator selecionado
  q: '', compQ: '', // buscas
  pickerOpen: false,
};
```

Tudo o mais é derivado: pipeline, próxima ação, contadores, listas filtradas,
cor do ponto de status. Nada de estado duplicado, nada de flag redundante.

Padrão de render: funções `renderHeader / renderProjBar / renderTabs /
renderPanes` que reconstroem sua região a partir de `S`. Sem diffing, sem
biblioteca. Só a região afetada re-renderiza.

---

## 8. Acessibilidade

- `role="tablist"` / `role="tab"` + `aria-selected` nas abas.
- `aria-expanded` / `aria-haspopup` no gatilho do seletor; `role="listbox"` /
  `role="option"` na lista.
- `aria-selected` na linha selecionada da tabela.
- `Esc` fecha qualquer overlay; `Ctrl/Cmd+K` abre o seletor.
- Foco visível em tudo — o `:focus-visible` do token não pode ser removido.
- Contraste: `--hi` sobre `--bg` serve para texto e chrome; as cores de status
  são para marcas e ícones, não para parágrafo.

---

## 9. Ordem de implementação

1. Casca do grid + tokens + header, com o seletor lendo `index.json`.
2. Barra do projeto: pipeline, agregados, botão da próxima ação.
3. Abas + roteamento por hash + persistência em `localStorage`.
4. Aba Componentes (tabela + painel) — é a de maior valor.
5. Nets e Footprints, reaproveitando a mesma tabela.
6. Montagem do renderer existente em Esquema e PCB.
7. `POST /api/run` + SSE, toasts e painel de log.
8. Histórico a partir de `history.jsonl` e modal de fluxo.

---

## 10. Checklist de aceite

- [ ] Nenhum hex fora do `:root` (exceto os rgba de sombra, que são escuridão ambiente).
- [ ] Inter carregada por `<link>` no `<head>` e visível na tela.
- [ ] Cor só aparece como status; destaque é branco a baixa opacidade.
- [ ] A página não rola na vertical; só o painel da aba rola.
- [ ] Nenhuma barra de rolagem horizontal aninhada.
- [ ] Nada é cortado à direita entre 1040px e 2560px de largura.
- [ ] O seletor fecha ao clicar fora e com `Esc`.
- [ ] `Ctrl/Cmd+K` abre o seletor de qualquer aba.
- [ ] Projeto e aba sobrevivem ao reload (hash + `localStorage`).
- [ ] Projeto sem esquema abre normalmente, com selo e estado vazio.
- [ ] O botão primário e o passo destacado no rodapé apontam o mesmo passo.
- [ ] Cada ação mostra início, log, sucesso e falha — e recarrega os dados.
- [ ] Tabela de componentes responde ao filtro sem travar com 500 linhas.
- [ ] Foco de teclado visível em todo controle.
