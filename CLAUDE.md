# CLAUDE.md — AltiumPCBMirror

@AI-GUIDE.md

O AI-GUIDE acima é o contrato para **editar projetos** (`schematic.js`,
`changes.js`, `annotations.js`). Este arquivo é sobre **editar o código do
workspace** — e sobre vários agentes fazendo isso ao mesmo tempo sem se atropelar.

## Quem é dono de quê

Cada agente roda no seu próprio worktree, num branch próprio. Antes de editar um
arquivo, confira de quem ele é. **Se o arquivo não é seu, não edite: peça.**

| worktree | branch | dono dos arquivos | porta do hub |
|---|---|---|---|
| `AltiumPCBMirror` (principal) | `neoden-ordem-por-bico` | árbitro: `hub.html`, `hub-core.js`, `hub-i18n.js`, `README.md`, `.gitignore`, `*.pas` | 8000 |
| `../APM-bom` | `agente/bom-almox` | `hub-bom.js`, `Libs/almox-*.js`, `tools/almox/**`, `hubserver.py` | 8001 |
| `../APM-laser` | `agente/laser` | `hub-laser.js`, `hub-draw.js`, `hub-font.js` | 8002 |
| `../APM-frames` | `agente/frames` | `pcbframe.js`, `pcbframe.html`, `schframe.js`, `schframe.html` | 8003 |

Suba o servidor sempre na porta do seu worktree: `python hubserver.py --port 800X`.
Três agentes na 8000 é a colisão mais boba e mais frequente deste projeto.

## Os três arquivos-gargalo

`hub.html` (216 KB, ~3200 linhas de script inline), `hub-i18n.js` e `README.md`
são tocados por qualquer mudança de UI. São do **principal**. Para não fazer fila
neles, siga a regra que também é a melhor arquitetura:

- **Código novo não entra no script inline do `hub.html`.** Vai no seu próprio
  `hub-<subsistema>.js`. O que você precisa no `hub.html` deve caber em três
  linhas: uma `<script src>`, um `<div>` container e um bloco de CSS.
- Precisa de mais que isso? Descreva a mudança e peça ao principal. Não edite.
- **Rótulo novo de UI**: os painéis Laser/BOM/Neoden/Biblioteca são pt-BR e os
  rótulos vivem dentro do `.js` de cada painel — resolva lá. `hub-i18n.js` é só a
  casca (cabeçalho, abas, rodapé, config) e é do principal.
- **README**: escreva a sua seção num commit separado e isolado, só do README.
  Conflito em commit isolado se resolve em segundos; misturado com código, não.

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
