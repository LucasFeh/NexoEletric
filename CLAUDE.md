# CLAUDE.md — AltiumPCBMirror

@AI-GUIDE.md

O AI-GUIDE acima é o contrato para **editar projetos** (`schematic.js`,
`changes.js`, `annotations.js`). Este arquivo é sobre **editar o código do
workspace**.

## Dois worktrees: principal e homologação

Até 2026-09-24 havia um worktree por agente (`APM-page`, `APM-bom`, `APM-laser`,
`APM-frames`), cada um dono de um pedaço dos arquivos. O dono pediu para ficar só
com um: **homologação**. Os quatro saíram (nenhum tinha commit fora do principal), e
os `dono: agente/...` que ainda aparecem no `tools/deploy/PENDENCIAS.md` são
histórico — hoje tudo é do principal.

| worktree | branch | papel | porta |
|---|---|---|---|
| `AltiumPCBMirror` (principal) | `neoden-ordem-por-bico` | onde se escreve e se commita; é daqui que sai o deploy | 8000 |
| `../APM-homologacao` | `homologacao` | a versão que vai para produção, rodando antes do deploy | 8001 |

Suba o servidor na porta do worktree: `python hubserver.py --port 800X`. A 8000 é a do
dono — teste seu vai noutra porta.

**Homologação não recebe edição.** Ela só anda para a frente, atrás do principal:

```powershell
git -C ..\APM-homologacao merge --ff-only neoden-ordem-por-bico
```

Confere-se lá (na 8001, contra o Odoo de teste do `hub-almox.json` local) e só então
`git push servidor neoden-ordem-por-bico`. Se o `--ff-only` recusar, alguém commitou
direto na homologação: traga o commit para o principal, não o contrário.

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

## Recriar a homologação

```powershell
.\tools\wt-novo.ps1 -Pasta APM-homologacao -Branch homologacao -Base neoden-ordem-por-bico
```

O script cria a pasta **irmã** do repo (nunca dentro dele — worktree aninhado
entra no `git status` e nas buscas de todo mundo) e repõe o que o `.gitignore`
deixa de fora: `hub-config.json`, `hub-almox.json`, os espelhos do almoxarifado e
uma junction para os 69 MB de `Libs/Almox`, compartilhados em vez de copiados.
Rodar `-Pasta` sozinho, sem `-Branch`, reequipa um worktree que já existe.

**Para apagar um worktree, tire a junction ANTES.** O Git atravessa a junction como se
fosse pasta (o `git status --ignored` lista os 134 arquivos de `Libs/Almox` dentro do
worktree), então um `git worktree remove --force` com ela no lugar pode apagar a
`Libs/Almox` DO PRINCIPAL. `cmd /c rmdir ..\APM-x\Libs\Almox` remove só o link; confira
que a do principal continua inteira e só então `git worktree remove --force ..\APM-x`.

## Integração

Commits pequenos e frequentes. **`git add <arquivo>` leva o arquivo INTEIRO**, e
`Libs/` tem estado que não é código (`almox-excluidos.json`, `lib-subs.js`,
`lib-ledger.json`): esses são do servidor e não viajam no deploy. `git status` **na
hora** de commitar e `git diff --cached` antes de publicar.

Depois de qualquer merge, um `grep -o 'src="[^"]*"' hub.html | sort -u` conferido
contra os arquivos que existem custa dois segundos: foi assim que o `hub.html` já
chegou ao principal chamando um `hub-libsync.js` que só existia noutro worktree — o
`<script src>` viajou, o arquivo não, e o hub carregou com 404.
