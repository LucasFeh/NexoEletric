# NexoEletric desktop (Electron)

O hub do AltiumPCBMirror como aplicativo do Windows. Faz o mesmo que o hub do servidor
(192.168.15.192:8100), porque **é** o mesmo hub: o app sobe o `hubserver.py` deste
repositório com um Python embutido e o mostra numa janela.

```
NexoEletric.exe (Electron)
 ├─ resources/python/        CPython 3.12.10 embeddable + Flask/Werkzeug/olefile
 ├─ resources/hub/           o hub do commit do build (git ls-files, sem segredos)
 └─ main.js
      1. sincroniza resources/hub -> pasta de trabalho (C:\NexoEletric; C:\EletricHUB nas de antes)
      2. python hubserver.py --port 8200 --host 127.0.0.1   (cwd = pasta de trabalho)
      3. janela em http://127.0.0.1:8200/
```

## O nome

Desde a 1.9.0 o sistema se chama **NexoEletric** (EletricHUB da 1.1.0 à 1.8.1, AltiumHub antes):
app, janela, instalador, atalhos, a marca do hub e o servidor MCP (`nexoeletric`). Alguns
identificadores internos continuam com os nomes antigos, e isso é de propósito, porque trocá-los
quebraria o que já está instalado:

- **`appId` `com.dieletrons.altiumhub` e pacote `altiumhub-desktop`.** São o que faz o
  instalador reconhecer a instalação existente (a chave de desinstalação e a pasta
  `%LOCALAPPDATA%\Programs\altiumhub-desktop`).
- **As chaves `altiumhub.*` do localStorage.** São as preferências do hub.
- **As variáveis `ALTIUMHUB_*`** e o caminho `C:\ProgramData\AltiumPCBMirror\home.txt`,
  lido pelos scripts do Altium.
- **O marcador `// AltiumPCBMirror` dos arquivos que o hub lê de volta.**
- **`window.eletricApp`, os `hub-*.js`, `mcp/eletrichub-mcp.js`, as URIs `eletrichub://`, o
  `exporter` do `board.js`, o formato `eletrichub-placa-v1` e o `source:"eletrichub"` do `/rpc` do NexoCAD.**

A pasta de dados segue o nome do produto. Na primeira abertura da 1.9.0, `%APPDATA%\EletricHUB`
(ou `%APPDATA%\AltiumHub`, de quem pulou versões) vira `%APPDATA%\NexoEletric` (`main.js`, antes de
tudo); se o Windows recusar, o app continua na pasta antiga. A pasta de trabalho gravada nas
configurações não muda: só a das instalações novas é `C:\NexoEletric`.

**O instalador com o EletricHUB instalado.** O appId é o mesmo, então a chave de desinstalação (o GUID
dele) também: o electron-builder acha o EletricHUB e roda o desinstalador dele em silêncio, guardando os
dados, antes de copiar o NexoEletric, e troca o atalho. Não fica nada lado a lado. Sozinho ele
reaproveitaria a pasta `...\EletricHUB` gravada no registro; o `assets/installer.nsh` (`customInit`) a
troca por `...\NexoEletric` e pede para o `EletricHUB.exe` aberto fechar antes, como o X da janela.

## Nexo Hub

O app publica a biblioteca 3D e as placas no Nexo Hub, o banco da rede (`lib/nexohub-sync.js`; o
contrato é o `..\nexohub\docs\CONTRATO.md` e o `docs/INTEGRACAO-NEXOCAD.md`):

- o trabalho é do `mcp/lib/nexohub-sync.js` da pasta de trabalho, o mesmo do MCP, rodado num processo
  Node à parte (o próprio exe com `ELECTRON_RUN_AS_NODE`), para a janela não travar na primeira vez
  (uns 650 modelos);
- roda depois que o hub sobe (o 3D da PcbLib sai do hubserver sob demanda), de novo quando
  `Libs/pcblib-hub.js`, `Libs/pcblib-3d.js` ou `Libs/3d-hub/` mudam (só a biblioteca) e quando
  `Projects/<p>/board.js` ou `changes.js` mudam (só aquela placa), com 4 s de espera;
- fora do ar, tenta de novo a cada 2 min; o andamento vai para o log (`[nexohub]`) e o estado para
  **Ajuda › Sobre**. À mão: **Arquivo › Nexo Hub: sincronizar agora**;
- a conexão e a presença (`/clientes/ping`) são do cliente oficial, `lib/nexohub-cliente.mjs` (cópia do
  repositório nexohub);
- `NEXOHUB_DESLIGADO=1` desliga; nos testes e na automação (`ALTIUMHUB_SMOKE`, `ALTIUMHUB_USERDATA`) fica
  desligado a menos que `NEXOHUB_URL` diga para onde, para um teste nunca publicar no Nexo Hub de verdade.

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

- **importa do servidor**: os projetos e `Libs/Almox`, cerca de 70 MB
  (`lib/import-server.js`, três vias, ETag). Com a biblioteca do servidor desligada, também
  as bibliotecas publicadas e o estado do almoxarifado, cerca de 100 MB;
- **aponta o Altium** para a pasta, gravando `home=` em
  `C:\ProgramData\AltiumPCBMirror\home.txt`. Depois disso, rode os scripts pelo
  `AltiumPCBMirror.PrjScr` da pasta de trabalho, e não pelo share do servidor.

Com a biblioteca do servidor valem o login e a senha do Odoo gravados **no servidor**: o
`/api/almox/config` vai para lá, e o servidor só aceita gravar a credencial pela máquina
dele. Com ela desligada, login e senha são pedidos no próprio hub (**Biblioteca ›
Almoxarifado**). O app só semeia o `hub-almox.json` com `http://192.168.15.192:8070` e
`odoo_db`.

## Biblioteca do servidor

Desde a 1.2.0 a biblioteca é **uma só: a do servidor** (decisão do dono). Com
**Configurações › Servidor central › Usar a biblioteca do servidor** ligada (o padrão,
`libRemota` em `lib/settings.js`), o app sobe o hub com `ALTIUMHUB_LIB_REMOTA=<servidor>`
(`lib/lib-remota.js`, a decisão única) e o hub daqui, no `libremota.py`:

- **repassa ao servidor toda gravação de biblioteca**: `/api/symbols/*` (com o andamento
  ao vivo do sincronismo e da extração), `/api/almox/config` e o `/api/save` do
  `Libs/lib-subs.js`. Projetos continuam locais. A rota antiga `/api/almox/sync` é
  recusada (409);
- **mantém o topo de `Libs/` como espelho só leitura do servidor**: `schlib.js`,
  `pcblib.js`, `symbols-lib.js`, `rename-map.js`, `lib-subs.js`, `libs-report.txt`, a
  `.SchLib` da casa, `almox-parts.json`, `lib-ledger.json`, `almox-excluidos.json` e os
  `almox-*.js`. Atualiza ao subir, a cada mudança no servidor (o `/__events` dele), a cada
  minuto e logo depois de cada gravação repassada. É dele que leem o hub, a lista para o
  Odoo, o chat e o `BuildSchematic` do Altium desta máquina;
- **sem servidor, abre a biblioteca com a última cópia e recusa toda gravação** de
  biblioteca (503, com aviso). Nada é gravado;
- **não deixa nada sumir calado**: um arquivo de biblioteca mudado só aqui vai para
  `.altiumhub\backup\lib-remota-<data>\Libs\` antes de o espelho trocá-lo.

O estado está em `GET /api/lib-remota/status`, e o indicador do hub (`hub-libremota.js`)
o mostra. O app segue o hub **que está no ar**, e não a configuração salva: depois de
subir, pergunta a ele se o modo ligou. Um hub sem o modo remoto (um app gerado antes do
merge do backend) responde 404, e o app avisa e se comporta como antes, com o guarda do
sincronismo e a importação completa.

Nesse modo, o app:

- **não intercepta mais o sincronismo** (o guarda abaixo): ele roda no servidor;
- **tira da importação** os grupos *Bibliotecas publicadas* e *Estado do almoxarifado*,
  na tela e no processo principal. O espelho e a importação de três vias nos mesmos
  arquivos seriam dois escritores, e um desfaria o outro;
- **reinicia o hub** quando o servidor ou a caixa mudam.

**Desligar a caixa depois de usar o modo** não deixa a cópia órfã. O espelho grava `Libs/`
sem passar pelo `import-state.json`, então a importação lê o que ele gravou por último
(`.altiumhub\lib-remota.json`, em `lib-remota.js » gravadosPeloEspelho`) e o conta como
base das três vias, como a semente do instalador. Esses arquivos se atualizam no próximo
**Importar do servidor** sem conflito nem backup. O que alguém editou aqui depois do espelho
deixa de bater com ele e segue protegido como sempre.

**`Libs/Almox` fica fora do espelho.** São as `.SchLib`, a PcbLib de footprints (63 MB)
e a DbLib que o Altium lê, e continuam vindo por **Arquivo › Importar do servidor ›
Bibliotecas do almoxarifado para o Altium**. A lista delas sai do `lib-ledger.json` do
servidor. Depois de um sincronismo, é essa importação que leva as `.SchLib` novas ao
Altium desta máquina, se o `home.txt` aponta a pasta de trabalho (apontando o servidor, o
Altium já as lê de lá).

Numa pasta de desenvolvedor (git), o modo não liga: a biblioteca é a do repositório.

### Numeração do almoxarifado

O servidor é quem numera os componentes (`Libs/almox-parts.json`). Com a biblioteca do
servidor, o **Sincronizar almoxarifado** roda nele, com o Odoo e o login de lá, e a
numeração é uma só por construção.

Com ela desligada, vale o guarda: antes de cada sincronismo local com o Odoo, o app
intercepta o `POST /api/symbols/almox-sync` e traz do servidor o estado que numera. Com o
mesmo estado e o mesmo Odoo, a numeração daqui sai igual à de lá. Com o servidor fora do
ar, o app pergunta antes de seguir. Configurável em **Configurações › Servidor central**
(a caixa fica desligada enquanto a biblioteca do servidor vale).

## Desenvolvimento

```powershell
cd electron
npm install
npm run build:prep     # build/python (baixa o Python), build/hub (do HEAD), gen/build-info.json
npm test               # 32 testes; os de backend/importação/biblioteca sobem o hub de verdade
npm run dev            # abre o app (pasta de dados normal: %APPDATA%\NexoEletric)
```

`build/hub` sai do **commit** (`git cat-file --filters`, que aplica o CRLF dos `.pas`), e
não da árvore suja. Para testar uma mudança no hub, commite antes.

O teste de ponta a ponta da biblioteca do servidor (`test/lib-remota.test.js`: espelho,
repasse, backup, offline) só liga quando o `build/hub` tem o backend do modo remoto (um
`.py` com `ALTIUMHUB_LIB_REMOTA`). Antes disso ele aparece como pulado.

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
npm run dist                       # electron/dist/NexoEletric-Setup-X.Y.Z.exe, sem publicar
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

### Rodar o instalador com o app já instalado

O instalador lê a versão instalada (a chave de desinstalação do usuário) e age conforme
o caso (`assets/installer.nsh`):

| instalado | o que o instalador faz |
|---|---|
| nada | instalação normal |
| versão mais velha | pergunta "Atualizar de X para Y?" e troca só o programa |
| a mesma versão | não reinstala: oferece abrir o app (ou reparar a instalação) |
| versão mais nova | recusa voltar para trás |

Nada disso pergunta nada na atualização automática (`--updated`) nem em instalação
silenciosa (`/S`). Com o app aberto, o instalador pede para ele fechar como o X da
janela, então as vistas perguntam pelo que não foi salvo e o app para o hub antes de
sair. Só os processos da própria pasta de instalação são fechados.

Como é a versão que decide, **todo instalador distribuído precisa de um número novo**:
dois builds com o mesmo número parecem "já instalado".

### Como a atualização chega

Ao abrir e a cada 4 horas, o app consulta `releases/latest` e baixa em segundo plano.
Depois pergunta se pode reiniciar, ou instala ao fechar. O instalador é per-user
(`%LOCALAPPDATA%\Programs\altiumhub-desktop`, o nome interno do pacote), e por isso atualiza
sem pedir administrador.
Antes de instalar, o app derruba o hub e os filhos dele, porque arquivo aberto não é
substituído. Na abertura seguinte, a pasta de trabalho recebe o código novo.
