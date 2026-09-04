# CLAUDE.md — AltiumPCBMirror

@AI-GUIDE.md

O AI-GUIDE acima é o contrato para **editar projetos** (`schematic.js`,
`changes.js`, `annotations.js`). Este arquivo é sobre **editar o código do
workspace** — e sobre vários agentes fazendo isso ao mesmo tempo sem se atropelar.

## Quem é dono de quê

Cada agente roda no seu próprio worktree, num branch próprio. Antes de editar um
arquivo, confira de quem ele é. **Se o arquivo não é seu, não edite: peça.**

| worktree | branch | dono dos arquivos | porta |
|---|---|---|---|
| `AltiumPCBMirror` (principal) | `neoden-ordem-por-bico` | integrador: `*.pas`, `README.md`, `AI-GUIDE.md`, `CLAUDE.md`, `.gitignore` | 8000 |
| `../APM-page` | `agente/page` | a casca do hub: `hub.html`, `hub-core.js`, `hub-ui.js`, `hub-io.js`, `hub-i18n.js` | 8004 |
| `../APM-bom` | `agente/bom-almox` | `hub-bom.js`, `Libs/almox-*.js`, `tools/almox/**`, `hubserver.py` | 8001 |
| `../APM-laser` | `agente/laser` | `hub-laser.js`, `hub-draw.js`, `hub-font.js` | 8002 |
| `../APM-frames` | `agente/frames` | `pcbframe.js`, `pcbframe.html`, `schframe.js`, `schframe.html`, `hub-dialog.js` | 8003 |

Suba o servidor sempre na porta do seu worktree: `python hubserver.py --port 800X`.
Quatro agentes na 8000 é a colisão mais boba e mais frequente deste projeto.

O **principal não escreve código de painel**. Ele integra: faz o merge dos branches
de agente, cuida da documentação e dos scripts que rodam dentro do Altium (`*.pas`).

## A casca do hub é de um dono só

`hub.html` tem 216 KB e ~3200 linhas de script inline; qualquer mudança de UI
encosta nele. Ele é do `agente/page`, junto com `hub-core.js`, `hub-ui.js`,
`hub-io.js` e `hub-i18n.js`. Para que ninguém faça fila, vale a regra que também
é a melhor arquitetura:

- **Código novo de painel não entra no script inline do `hub.html`.** Vai no seu
  próprio `hub-<subsistema>.js`. O que você precisa da casca deve caber em três
  linhas: uma `<script src>`, um `<div>` container e um bloco de CSS.
- Precisa disso? **Peça ao `agente/page`** — não edite. Diga o id do container, o
  nome do arquivo e onde na aba ele entra. Precisa de mais que três linhas? É
  sinal de que a lógica devia estar no seu `.js`, não na casca.
- `agente/page`: você é dono da casca, não dos painéis. Não mexa em `hub-bom.js`,
  `hub-laser.js` nem nos frames — se a casca precisa de algo deles, peça.
- **Rótulo novo de UI**: os painéis Laser/BOM/Neoden/Biblioteca são pt-BR e os
  rótulos vivem dentro do `.js` de cada painel — resolva lá. `hub-i18n.js` é só a
  casca (cabeçalho, abas, rodapé, config) e é do `agente/page`.
- **README**: é do principal. Escreva a sua seção num commit separado e isolado,
  só do README. Conflito em commit isolado se resolve em segundos; misturado com
  código, não.

## Nunca `alert()`, `confirm()` ou `prompt()`

O diálogo do navegador chega em inglês, com a cara do sistema, e trava a aba. Toda
pergunta ou aviso é um **modal no tema da página**; todo resultado ("salvo",
"3 componentes colocados") é uma **notificação no canto superior direito**, por cima
de tudo. Nas vistas (`schframe`, `pcbframe`) a peça é `hub-dialog.js`:
`await HubDialog.confirm(texto, {title, ok, danger})`, `await HubDialog.alert(...)`
e `HubDialog.toast(texto, 'ok'|'warn'|'err'|'info', ms)`. O hub tem o próprio
`toast()` e o `#overlay`; o painel BOM tem o `pergunta()` dele. Se o seu painel ainda
não tem, carregue o `hub-dialog.js` em vez de escrever outro.

## Nunca versione saída gerada

`tools/almox/almox2lib.py` escreve `Libs/almox-{basicos,especiais,index,sync}.js`
e as `.SchLib` de `Libs/Almox/` — tudo isso está no `.gitignore` e refaz sozinho
rodando o sync. Se `git status` mostrar esses arquivos, o `.gitignore` quebrou;
avise, não commite.

Uma exceção deliberada: **`Libs/almox-parts.json` é versionado**. É o livro-razão
rótulo → part number. Ele é gerado, mas guarda estado: perder o arquivo renumera
o almoxarifado inteiro.

## Worktree novo

```powershell
.\tools\wt-novo.ps1 -Pasta APM-neoden -Branch agente/neoden
```

O script cria a pasta **irmã** do repo (nunca dentro dele — worktree aninhado
entra no `git status` e nas buscas de todo mundo) e repõe o que o `.gitignore`
deixa de fora: `hub-config.json`, `hub-almox.json`, os espelhos do almoxarifado e
uma junction para os 69 MB de `Libs/Almox`, compartilhados em vez de triplicados.

Rodar `-Pasta` sozinho, sem `-Branch`, reequipa um worktree que já existe.

## Integração

Commits pequenos e frequentes. Antes de pedir merge, traga o principal para o seu
branch (`git rebase neoden-ordem-por-bico`) e resolva o conflito no seu worktree —
nunca no do vizinho. Worktree que acabou: `git worktree remove ../APM-<nome>`.

**`git add <arquivo>` leva o arquivo INTEIRO**, inclusive o que o dono dele deixou
pendente ali. Editar o arquivo de outro agente e commitar parece inofensivo quando o
`git status` estava limpo *quando você começou* — mas ele pode ter salvado no meio do
caminho, e aí o seu commit publica trabalho pela metade dele. Foi assim que o
`hub.html` chegou ao principal chamando um `hub-libsync.js` que só existia no worktree
do `agente/page`: o `<script src>` viajou, o arquivo não, e o hub carregou com 404.

Antes de commitar arquivo que não é seu: `git status` **na hora**, e confira o diff
com `git diff --cached <arquivo>` — se aparecer coisa que você não escreveu, pare e
peça ao dono. Se der para escolher só o que é seu, `git add -p` resolve. E depois de
qualquer merge, um `grep -o 'src="[^"]*"' hub.html | sort -u` conferido contra os
arquivos que existem custa dois segundos e pega esse tipo de metade.
