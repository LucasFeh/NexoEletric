# AltiumHub desktop (Electron)

O hub do AltiumPCBMirror como aplicativo do Windows. Faz o mesmo que o hub do servidor
(192.168.15.192:8100), porque **é** o mesmo hub: o app sobe o `hubserver.py` deste
repositório com um Python embutido e o mostra numa janela.

```
AltiumHub.exe (Electron)
 ├─ resources/python/        CPython 3.12.10 embeddable + Flask/Werkzeug/olefile
 ├─ resources/hub/           o hub do commit do build (git ls-files, sem segredos)
 └─ main.js
      1. sincroniza resources/hub -> pasta de trabalho (C:\AltiumHub)
      2. python hubserver.py --port 8200 --host 127.0.0.1   (cwd = pasta de trabalho)
      3. janela em http://127.0.0.1:8200/
```

## Por que é assim

- **Código e dado na mesma pasta.** Todo worker de `tools/` acha a raiz a partir do
  próprio arquivo, e o `guardiao.py` recusa outra raiz. Por isso o app **copia** o código
  para a pasta de trabalho, como o `tools/deploy/deploy.sh` faz no servidor. A regra de
  cópia é a mesma do deploy:
  - `code` é do app e é reposto a cada versão;
  - `seed` é estado: só é copiado se faltar e nunca é sobrescrito (livro-razão de part
    numbers, espelhos, `projects.js`...);
  - código editado à mão que saiu do app não é apagado;
  - uma pasta com `.git` é de desenvolvedor, e o app roda o que está lá sem copiar nada.
- **Python embutido, e não PyInstaller.** O hub sobe subprocessos com `sys.executable`
  (`guardiao.py`, `extrair.py`). O `python312._pth` do embeddable sai, porque tiraria a
  pasta do script do `sys.path` e o envio da lista ao Odoo sumiria calado. Em troca, o
  backend zera todas as variáveis `PYTHON*` e liga `PYTHONNOUSERSITE`.
- **Porta fixa (8200).** O localStorage do hub é por origem. Se uma porta ocupada por
  outro programa força a seguinte, o hub perde as preferências. O hub órfão de uma
  sessão que caiu é identificado (arquivo de PID + `netstat` + caminho do `python.exe`) e
  encerrado.
- **Só loopback por padrão.** O hub tem rotas que gravam sem senha. O compartilhamento na
  rede (para o link do BOM no tablet) é opcional, exige senha mestre e tranca o chat.
  Com `--host 127.0.0.1` o hub só aceita `Host:` de loopback, o que protege contra DNS
  rebinding.
- **Biblioteca da casa só leitura.** O `tools/symbols/config.json` do desktop sai sem
  `schlib`/`pcblib`: resolve para a cópia publicada em `Libs/`, como o servidor. Com o
  do git, um PC com `Y:` gravaria na `.SchLib` da rede.

## A primeira execução

A tela de boas-vindas pede a pasta de trabalho, testa o servidor e, se marcado:

- **importa do servidor**: projetos, bibliotecas publicadas, estado do almoxarifado e
  `Libs/Almox`, cerca de 100 MB (`lib/import-server.js`, três vias, ETag);
- **aponta o Altium** para a pasta, gravando `home=` em
  `C:\ProgramData\AltiumPCBMirror\home.txt`. Depois disso, rode os scripts pelo
  `AltiumPCBMirror.PrjScr` da pasta de trabalho, e não pelo share do servidor.

Login e senha do Odoo são pedidos no próprio hub (**Biblioteca › Almoxarifado**). O app
só semeia o `hub-almox.json` com `http://192.168.15.192:8070` e `odoo_db`.

### Numeração do almoxarifado

O servidor é quem numera os componentes (`Libs/almox-parts.json`). Antes de cada
sincronismo local com o Odoo, o app intercepta o `POST /api/symbols/almox-sync` e traz do
servidor o estado que numera. Com o mesmo estado e o mesmo Odoo, a numeração daqui sai
igual à de lá. Com o servidor fora do ar, o app pergunta antes de seguir. Configurável em
**Configurações › Servidor central**.

## Desenvolvimento

```powershell
cd electron
npm install
npm run build:prep     # build/python (baixa o Python), build/hub (do HEAD), gen/build-info.json
npm test               # 26 testes; os de backend/importação sobem o hub de verdade
npm run dev            # abre o app (pasta de dados normal: %APPDATA%\AltiumHub)
```

`build/hub` sai do **commit** (`git cat-file --filters`, que aplica o CRLF dos `.pas`), e
não da árvore suja. Para testar uma mudança no hub, commite antes.

Variáveis para teste e automação:

| variável | efeito |
|---|---|
| `ALTIUMHUB_USERDATA` | pasta de dados do app (settings, logs, localStorage) |
| `ALTIUMHUB_WORKSPACE` | pasta de trabalho, pulando a tela de boas-vindas |
| `ALTIUMHUB_SMOKE=<arq.json>` | abre, confere o hub, grava o resultado e sai |
| `ALTIUMHUB_UPDATE_FEED=<url>` | atualiza de um servidor HTTP (provider generic) em vez do GitHub |
| `ALTIUMHUB_UPDATE_AUTOINSTALL=1` | instala a atualização baixada sem perguntar |

No terminal do VS Code, o `ELECTRON_RUN_AS_NODE=1` faz o `electron.exe` virar um Node.
Rode com `env -u ELECTRON_RUN_AS_NODE` (Git Bash) ou limpe a variável.

## Instalador e release

```powershell
npm run dist                       # electron/dist/AltiumHub-Setup-X.Y.Z.exe, sem publicar
$env:GH_TOKEN = "<token de PUBLICAR>"
$env:ALTIUMHUB_UPDATE_TOKEN = "<token de LER, vai dentro do .exe>"
npm run release -- patch           # ou minor, major, X.Y.Z; --dry-run para ensaiar
```

O `release` segue estes passos:

1. Testa os dois tokens no GitHub antes de qualquer commit.
2. Sobe a versão e escreve o `CHANGELOG.md`.
3. Gera o instalador.
4. Commita `desktop: vX.Y.Z`, cria a tag `vX.Y.Z` e empurra branch e tag para `origin`.
5. Sobe o `.exe`, o `.blockmap` e o `latest.yml` num **rascunho**. O rascunho só vira
   release publicado quando os três estão lá. Os apps instalados consultam
   `releases/latest`, que nunca enxerga rascunho, então um upload pela metade não quebra
   a atualização de ninguém.

Se o upload falhar, rode de novo o mesmo `npm run release -- X.Y.Z`. O script reconhece
a tag no HEAD e só refaz a publicação. Sem token de leitura ele se recusa a publicar,
porque quem instalar ficaria sem atualização automática. Para publicar assim mesmo, use
`--sem-token-de-leitura`.

### Os dois tokens

O repositório é **privado**, então o app instalado precisa de um token para ver os
releases. Use dois tokens, nunca um só:

| token | onde fica | permissão |
|---|---|---|
| `GH_TOKEN` (publicar) | só na máquina que faz o release | fine-grained, só este repo, **Contents: Read and write** |
| `ALTIUMHUB_UPDATE_TOKEN` (ler) | **dentro do .exe** (`gen/build-info.json`) | fine-grained, só este repo, **Contents: Read-only** |

Qualquer um que abra o instalador consegue extrair o token de leitura. Com ele se lê o
repositório inteiro, inclusive o histórico e `Projects/`. O `release` se recusa a
embutir o token de publicar. Um token também pode ser informado depois, em
**Configurações › Atualizações**, e fica cifrado com o DPAPI do Windows.

### Como a atualização chega

Ao abrir e a cada 4 horas, o app consulta `releases/latest` e baixa em segundo plano.
Depois pergunta se pode reiniciar, ou instala ao fechar. O instalador é per-user
(`%LOCALAPPDATA%\Programs\AltiumHub`), e por isso atualiza sem pedir administrador.
Antes de instalar, o app derruba o hub e os filhos dele, porque arquivo aberto não é
substituído. Na abertura seguinte, a pasta de trabalho recebe o código novo.
