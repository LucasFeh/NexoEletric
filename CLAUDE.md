# CLAUDE.md — AltiumPCBMirror

@AI-GUIDE.md

O AI-GUIDE acima é o contrato para **editar projetos** (`schematic.js`,
`changes.js`, `annotations.js`). Este arquivo é sobre **editar o código do
workspace**.

## Dois worktrees, duas interfaces: web e desktop

Até 2026-09-24 havia um worktree por agente (`APM-page`, `APM-bom`, `APM-laser`,
`APM-frames`), cada um dono de um pedaço dos arquivos, e depois um de homologação. Os
`dono: agente/...` que ainda aparecem no `tools/deploy/PENDENCIAS.md` são histórico. Hoje
são dois branches, cada um com a sua interface:

| worktree | branch | o que é | porta |
|---|---|---|---|
| `AltiumPCBMirror` (principal) | `neoden-ordem-por-bico` | o hub **web** (o servidor .192); é daqui que sai o deploy | 8000 |
| `../APM-homologacao` | `electron` | o app **desktop** EletricHUB (`electron/`), com casca própria | 8001 |

O branch `homologacao` continua existindo, sem worktree. Suba o servidor na porta do
worktree: `python hubserver.py --port 800X`. A 8000 é a do dono — teste seu vai noutra
porta, com `--host 127.0.0.1`.

**As cascas são diferentes de propósito** (pedido do dono em 2026-09-24: "a interface do
software desktop e da aplicação web vão ser diferentes mesmo por hora"). O desktop tem a
casca EletricHUB e a vista PCB no tema do hub. São da interface, e ficam diferentes nos dois
branches: `hub.html`, `hub-classic.html` e `pcbframe.html`. Lógica, backend, `.pas` e testes
são um código só.

**A vista Esquema é uma só desde 2026-09-25** (pedido do dono: "o menu precisa ser igual ao
do electron", e "toda modificação aplica nos dois"). `schframe.html`, `schframe.js` e os
quatro módulos que ela carrega com CSS de tema (`hub-dialog.js`, `hub-converte.js`,
`hub-odoolista.js`, `hub-almoxpick.js`) são idênticos nos dois branches: painel à direita com
Configurações e Propriedades, no tema do hub, e o editor de atalhos nas configurações do hub
(os dois `hub.html` carregam o `hub-atalhos.js`). Mudança no Esquema se faz no principal e
desce por merge sem conflito; se um merge conflitar num desses arquivos, alguém os fez
divergir de novo.

- **Web → desktop: merge normal.** `git -C ..APM-homologacao merge neoden-ordem-por-bico`.
  Conflito numa casca se resolve ficando com o layout do desktop e trazendo a lógica. Depois
  do merge, confira o que o Git não vê: a tabela `GESTOS` do `hub-atalhos.js` descreve o
  canvas (`tests/test-atalhos-gestos.js`), e `hub-*.js` novo precisa do `<script src>` na
  casca do desktop também.
- **Desktop → web: nunca `merge electron` no principal.** O merge traria a casca do desktop
  calada, e revertê-la depois mandaria a reversão para o desktop no merge seguinte. O que é
  backend ou lógica vem por `git cherry-pick -x`; arquivo que a web não carrega (ou que é
  igual nos dois) vem por `git checkout electron -- <arquivo>`. `electron/` vem junto e fica
  fora do deploy pelo `export-ignore` do `.gitattributes`.
- **O app se constrói só no `APM-homologacao`.** O `electron/scripts/stage-hub.mjs` empacota o
  HEAD do worktree onde roda: construído no principal, o instalador sairia com a casca web.
  Arquivo novo entra no app só depois de commitado no `electron`.
- **Deploy** é `git push servidor neoden-ordem-por-bico`; o desktop não vai para o servidor.

## A casca do hub

`hub.html` tem 216 KB e ~3200 linhas de script inline; qualquer mudança de UI
encosta nele. Vale a regra que nasceu para os agentes não fazerem fila e que também
é a melhor arquitetura:

- **Código novo de painel não entra no script inline do `hub.html`.** Vai no seu
  próprio `hub-<subsistema>.js`. O que ele precisa da casca deve caber em três
  linhas: uma `<script src>`, um `<div>` container e um bloco de CSS. Precisa de
  mais que três linhas? É sinal de que a lógica devia estar no `.js`, não na casca.
- **Rótulo novo de UI**: os painéis Laser/BOM/Neoden/Biblioteca são pt-BR e os
  rótulos vivem dentro do `.js` de cada painel — resolva lá. `hub-i18n.js` é só a
  casca (cabeçalho, abas, rodapé, config).
- **README**: a seção de um assunto vai num commit separado, só do README.
  Conflito em commit isolado se resolve em segundos; misturado com código, não.

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

## Recriar o worktree do desktop

```powershell
git worktree add ..APM-homologacao electron
.	oolswt-novo.ps1 -Pasta APM-homologacao
```

O script, com `-Pasta` sozinho, reequipa um worktree que já existe: repõe o que o
`.gitignore` deixa de fora — `hub-config.json`, `hub-almox.json`, os espelhos do almoxarifado
e uma junction para os 69 MB de `Libs/Almox`, compartilhados em vez de copiados. A pasta é
sempre **irmã** do repo (nunca dentro dele — worktree aninhado entra no `git status` e nas
buscas de todo mundo).

**Para apagar um worktree, tire a junction ANTES.** O Git atravessa a junction como se
fosse pasta (o `git status --ignored` lista os 134 arquivos de `Libs/Almox` dentro do
worktree), então um `git worktree remove --force` com ela no lugar pode apagar a
`Libs/Almox` DO PRINCIPAL. `cmd /c rmdir ..APM-xLibsAlmox` remove só o link; confira
que a do principal continua inteira e só então `git worktree remove --force ..APM-x`.

## Integração

Commits pequenos e frequentes. **`git add <arquivo>` leva o arquivo INTEIRO**, e
`Libs/` tem estado que não é código (`almox-excluidos.json`, `lib-subs.js`,
`lib-ledger.json`): esses são do servidor e não viajam no deploy. `git status` **na
hora** de commitar e `git diff --cached` antes de publicar.

Depois de qualquer merge, um `grep -o 'src="[^"]*"' hub.html | sort -u` conferido
contra os arquivos que existem custa dois segundos: foi assim que o `hub.html` já
chegou ao principal chamando um `hub-libsync.js` que só existia noutro worktree — o
`<script src>` viajou, o arquivo não, e o hub carregou com 404.
