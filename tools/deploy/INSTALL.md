# Por o hub no servidor ODOO com docker compose

Alvo: **192.168.15.192**, a máquina do Odoo. Medido em 2026-09-09:

| | |
|---|---|
| nome SMB | **ODOO**, workgroup WORKGROUP, master browser |
| Samba | **já roda**, com o share `Compartilhado` publicado |
| Odoo | 19.0 Enterprise na 8070, bases `odoo_db` e `teste` |
| ssh | porta 22 aberta |
| portas ocupadas | 22, 139, 445, 5000, 8000, 8070, 8080 |
| hub | **8100** |

O Samba **não** entra no compose. As portas 445 e 139 já são dele, e o certo é
acrescentar uma seção ao `smb.conf` que existe. O compose sobe um serviço só.

## O que vai para o servidor

Só o que está dentro do projeto:

| | |
|---|---|
| `Libs/` incluindo `Libs/Almox` | 264,6 MB |
| `Projects/` | 5,6 MB |
| os quatro `.pas` | 178 KB |

A biblioteca gerada a partir do Odoo vive em `Libs/Almox`: 32 `.SchLib`, uma por
família, mais `FOOTPRINTS ALMOX.PcbLib` com 63 MB de footprints. Ela viaja junto.

A `.SchLib` da casa **viaja**, publicada dentro do repositório em
`Libs/BIBLIOTECA DE ESQUEMA.SchLib` (1,7 MB) — sem ela o gerador do almoxarifado sai
sem footprint reciclado e as 32 `.SchLib` abrem com a folha preta. Quem publica é o
guardião, no começo de cada sincronismo, a partir da lib viva da bancada; a cópia é
somente leitura no servidor. A ordem de resolução está em `tools/libpath.py` e no
README principal, em **Onde está a biblioteca da casa**.

A `.PcbLib` da casa (63 MB) **não** viaja no git: ela já chega como
`Libs/Almox/FOOTPRINTS ALMOX.PcbLib`, que é diretório compartilhado.

O `BuildSchematic.pas` continua abrindo as duas por UNC, e isso é de propósito: ele roda
no Altium, que enxerga a rede. O motivo de a lib da casa não poder sumir está medido: os
14 projetos com `schematic.js` usam 108 símbolos distintos, e só **3** existem nas
bibliotecas do almoxarifado. Outros 42 existem só na lib da casa, com nomes como
`RES [SMD]`, `CAP [SMD]`, `BC337` e `CONE PADRAO`. Tirar a lib da casa faz
`FindLibSymbol` falhar, o `ErrCount` crescer e a validação abortar sem criar nada:
os 14 projetos deixam de ser reconstruíveis.

Aposentar a lib da casa é uma mudança separada desta migração, e o preço dela é
fazer nascer no almoxarifado os símbolos que faltam. Para medir de novo a qualquer
momento, cruze os `"sym"` dos `Projects/*/schematic.js` com os `"name"` dos
`Libs/almox-*.js`. Enquanto der mais que zero, a linha não pode sair.

## Como fica no disco do servidor

```
/srv/altiumhub/            <- também é a raiz do share SMB `altiumhub`
├── releases/<hash>/       código extraído do commit, nunca reescrito
├── current -> releases/<hash>
├── anterior               hash da release de antes
├── shared/                Projects/, Libs/Almox, credenciais, estado
├── compose.yml            copiado da release a cada deploy
└── bin/                   deploy.sh e rollback.sh
/srv/altiumhub-repo.git/   bare, FORA do share e fora do container
```

O container monta `/srv/altiumhub` inteiro no mesmo caminho absoluto. É isso que
faz `current` e os symlinks de `shared/` resolverem igual dentro e fora.

---

## 1. Servidor: usuário, docker, estrutura

Este bloco pode ser rodado de novo sem estragar nada: cada linha só age se o que
ela cria ainda não existir. É o passo que cria `/srv/altiumhub`, então nada dos
passos seguintes funciona antes dele.

```bash
docker --version && docker compose version      # premissa do plano

getent group  altiumhub >/dev/null || sudo groupadd -g 1500 altiumhub
getent passwd altiumhub >/dev/null || sudo useradd -u 1500 -g 1500 -d /srv/altiumhub -s /bin/bash altiumhub
sudo usermod -aG docker altiumhub

sudo install -d -o altiumhub -g altiumhub -m 755 \
  /srv/altiumhub /srv/altiumhub/releases /srv/altiumhub/shared /srv/altiumhub/bin \
  /srv/altiumhub-repo.git
sudo install -d -o altiumhub -g altiumhub -m 700 /srv/altiumhub/.ssh

sudo -u altiumhub git -C /srv/altiumhub-repo.git init --bare
```

O UID 1500 não é decorativo: é o mesmo do `Dockerfile` e o do `force user` do
share. Os três precisam bater, senão o Altium grava `board.js` pelo SMB e o hub
não consegue reescrever.

A senha mestre, fora do git:

```bash
sudo install -d -m 755 /etc/altiumhub
printf 'ALTIUMHUB_MASTER=%s\n' "$(openssl rand -base64 24)" | sudo tee /etc/altiumhub/senha.env >/dev/null
sudo chown root:altiumhub /etc/altiumhub/senha.env
sudo chmod 640 /etc/altiumhub/senha.env
```

O modo é 640 com grupo `altiumhub`, e não 600 do root. Quem lê o `env_file` é o
**cliente** do compose, que roda como `altiumhub`; o container nem chega a ver o
arquivo. Com 600 o deploy morre com `permission denied` no meio de um comando que
fala de outra coisa.

Confira antes de seguir:

```bash
ls -ld /srv/altiumhub /srv/altiumhub-repo.git && getent passwd altiumhub
```

`/srv/altiumhub` tem que sair como `drwxr-xr-x`. Se sair `drwxr-x---`, foi o
`useradd -m` que criou o home com o `HOME_MODE` do sistema, que na Ubuntu é 750, e
aí nenhum outro usuário nem entra na pasta. O `install -d` acima corrige, mas se
você já tinha criado antes, force:

```bash
sudo chmod 755 /srv/altiumhub
```

## 2. Chave SSH, daqui

```powershell
ssh-keygen -t ed25519 -C "lucas@LUCAS-PC"
git remote set-url servidor altiumhub@192.168.15.192:/srv/altiumhub-repo.git
```

No `ssh-keygen`, **aceite o caminho sugerido apertando Enter**. Digitar um nome ali
salva a chave com esse nome na pasta atual, e não em `.ssh\id_ed25519`, que é o
único lugar onde o ssh a procura sozinho.

Para ver a chave pública, a sintaxe muda com o terminal:

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub     # PowerShell
```

```bat
type %USERPROFILE%\.ssh\id_ed25519.pub        REM cmd.exe
```

Cole a linha em `/srv/altiumhub/.ssh/authorized_keys`, `chmod 600`.

## 3. Primeiro push, daqui

```powershell
git push servidor neoden-ordem-por-bico
```

Só popula o repositório. O hook ainda não existe.

## 4. Servidor: instalar os scripts

Tudo por caminho absoluto, sem `cd`. Você não precisa conseguir entrar em
`/srv/altiumhub` com o seu usuário para instalar o hub, e insistir nisso é o que
leva ao `sudo cd`, que não existe: `cd` é do shell, não um programa.

Cada comando numa linha só, sem barra de continuação. Colado em duas partes, o
`git archive` despeja o tar na tela e o `tar` do outro lado morre com "Refusing to
read archive contents from terminal". O `bin/` fica com os scripts velhos e o
sintoma só aparece no deploy seguinte, com uma mensagem que não fala disso.

```bash
sudo -u altiumhub git --git-dir=/srv/altiumhub-repo.git archive neoden-ordem-por-bico tools/deploy | sudo -u altiumhub tar -x --strip-components=2 -C /srv/altiumhub/bin
sudo -u altiumhub cp /srv/altiumhub/bin/post-receive /srv/altiumhub-repo.git/hooks/post-receive
```

Confira que veio o script novo. Tem que responder `1`:

```bash
grep -c 'docker build' /srv/altiumhub/bin/deploy.sh
```

Para olhar lá dentro, use um shell do dono em vez de forçar permissão:

```bash
sudo -u altiumhub -s        # abre um shell como altiumhub; `exit` volta
```

## 5. Semear `shared/` antes do primeiro deploy

A ordem importa: o symlink de um arquivo só nasce se ele já existir quando o
deploy roda.

```bash
sudo -u altiumhub mkdir -p /srv/altiumhub/shared/{Libs,tools/almox,tools/symbols}
sudo -u altiumhub tee /srv/altiumhub/shared/hub-almox.json >/dev/null <<'J'
{"url":"http://192.168.15.192:8070","db":"odoo_db","login":"SEU_LOGIN","senha":"SENHA_NOVA"}
J
sudo -u altiumhub tee /srv/altiumhub/shared/.hub-odoo.json >/dev/null <<'J'
{"url":"http://192.168.15.192:8070","db":"odoo_db","login":"SEU_LOGIN","modelo":"di.lista.altium","senha":"SENHA_NOVA"}
J
sudo -u altiumhub chmod 600 /srv/altiumhub/shared/hub-almox.json /srv/altiumhub/shared/.hub-odoo.json
```

**`sudo -u altiumhub` e `tee`, não `cat >`.** Tudo sob `/srv/altiumhub` é do usuário
`altiumhub`, e o redirecionamento `>` acontece no shell de *quem chamou* — com
`sudo -u altiumhub cat > arquivo` o `sudo` até roda, mas quem tenta escrever é o seu
login, e sai `Permission denied`. O mesmo vale para o `deploy.sh`: rodá-lo com outro
login falha no `env_file` com uma mensagem que parece ser de chmod e não é.

`SEU_LOGIN` e `SENHA_NOVA` são para trocar, e não trocá-los tem sintoma próprio: o painel
da lista de materiais mostra a recusa do Odoo em texto vermelho. Se aparecer
`Failed to fetch` em vez disso, o hub é anterior a 2026-09-15 — ver a pendência 2.2.

`http://127.0.0.1:8070` funciona porque o compose usa rede do host, e
`http://192.168.15.192:8070` — o padrão do código desde 2026-09-15 — funciona de qualquer
máquina. Na prática **só `login` e `senha` precisam ser escritos aqui**: servidor e base já
vêm certos do código. O padrão apontava para o Odoo de **teste** até a pendência 1.8, e aí
sim um arquivo faltando fazia o hub puxar do ERP errado sem erro nenhum.

Se o `login` estiver errado (o `SEU_LOGIN` deste exemplo, por exemplo), o painel da lista de
materiais mostra a recusa do Odoo em texto. Até 2026-09-15 ele mostrava
`sem resposta do servidor: Failed to fetch`, porque a recusa subia como `SystemExit` e matava
a thread do Flask sem resposta — se você vir isso num hub antigo, é login, não rede.

E daqui, os 265 MB de biblioteca mais os arquivos de estado:

```powershell
scp -r Libs\Almox altiumhub@192.168.15.192:/srv/altiumhub/shared/Libs/
scp Libs\almox-basicos.js Libs\almox-especiais.js Libs\almox-index.js Libs\almox-sync.js Libs\almox-guardiao.js altiumhub@192.168.15.192:/srv/altiumhub/shared/Libs/
scp -p Libs\almox-parts.json Libs\lib-ledger.json Libs\lib-subs.js altiumhub@192.168.15.192:/srv/altiumhub/shared/Libs/
scp -p projects.js altiumhub@192.168.15.192:/srv/altiumhub/shared/
scp tools\almox\componentes_odoo.csv altiumhub@192.168.15.192:/srv/altiumhub/shared/tools/almox/
```

A segunda e a terceira linha não são detalhe. `almox-parts.json`, `lib-ledger.json`,
`lib-subs.js` e `projects.js` são versionados mas estão **sujos** na árvore agora:
o `almox-parts.json` do disco tem 148 famílias contra 134 no commit. Se você não os
mandar do disco, o deploy os semeia a partir do commit e o servidor nasce com o
livro-razão velho. Aí o primeiro sincronismo renumera as 14 famílias que já
receberam part number, e esse número já foi para o Odoo e para as `.SchLib`.

## 6. O share SMB

A Ubuntu não usa `/etc/samba/smb.conf.d/`: o `smb.conf` dela é um arquivo só, sem
`include`. Então a seção vai anexada no fim dele.

```bash
grep -q '^\[altiumhub\]' /etc/samba/smb.conf \
  || sudo tee -a /etc/samba/smb.conf < /srv/altiumhub/bin/smb-altiumhub.conf >/dev/null
sudo smbpasswd -a altiumhub      # senha DO SHARE, não é a do Linux
sudo testparm -s                 # tem que passar sem erro
sudo systemctl reload smbd
```

O `grep` na frente é o que deixa o bloco seguro para rodar de novo: sem ele, uma
segunda execução anexa a seção duas vezes e o `testparm` reclama de seção
duplicada.

A conta do Samba é obrigatória, não é zelo. O cliente SMB do Windows recusa logon
guest desde a 1709 nas edições Enterprise e Education, e esta bancada é Windows 10
Enterprise. O sintoma engana: o `testparm` passa, o `smbclient -L` rodado no próprio
servidor lista o share, e nenhum PC monta.

## 7. Primeiro deploy

```bash
sudo -u altiumhub /srv/altiumhub/bin/deploy.sh neoden-ordem-por-bico
```

Ele constrói a imagem na primeira vez, extrai a release, liga `shared/`, compila
`hubserver.py` para provar que o commit importa, troca o symlink, sobe o container
e confere que o hub respondeu. Se não responder, volta sozinho.

O hub fica em `http://192.168.15.192:8100`. Confira que o estado ficou mesmo fora
da release, senão o próximo deploy leva junto:

```bash
for f in Trash Laser projects.js Libs/Almox Libs/almox-parts.json Libs/lib-ledger.json; do
  [ -L /srv/altiumhub/current/$f ] || echo "NAO E SYMLINK: $f"
done
```

## 8. Windows: mapear e apontar o Altium

```powershell
cmdkey /add:192.168.15.192 /user:altiumhub /pass
net use P: \\192.168.15.192\altiumhub /persistent:yes
```

Guarde a credencial com `cmdkey`. O Windows mantém uma credencial por servidor,
então este share e o `Compartilhado` que já existe têm que abrir com o mesmo
usuário. Dois usuários no mesmo servidor dão "multiple connections to a server by
the same user are not allowed".

Os quatro `.pas` **não apontam mais para lugar nenhum**: o caminho saiu do código e cada
máquina diz o seu em `C:\ProgramData\AltiumPCBMirror\home.txt` (veja *Onde fica o
workspace: `home.txt`* no README). Nesta máquina, aponte para o share:

```ini
home=\\192.168.15.192\altiumhub\current
```

`\\192.168.15.192\altiumhub\current` ainda é um dos candidatos embutidos, então numa
máquina que só tem o share ele se resolve sozinho na primeira execução. Numa que também
tem o workspace local, o candidato local ganha — por isso a chave `home` aqui é explícita,
não opcional. Rode os scripts do Altium a partir de `P:\current`. Como `current` é um link
para a release no ar, um deploy troca o alvo e o caminho continua o mesmo.

O `BuildSchematic.pas` abre as bibliotecas do almoxarifado **e** a da casa. Os padrões da
lib da casa (`SCHLIB_PADRAO`/`PCBLIB_PADRAO`) saíram do `Z:`, que não resolve, e apontam por
UNC para `\\LUCAS-PC\D\ALTIUM LIBRARY ------ LUCAS` — funciona de qualquer máquina, em vez
de depender de cada uma mapear a mesma letra. São só o piso: as chaves `schlib` e `pcblib`
do `home.txt` mandam nelas.

> **Essa cópia UNC está desatualizada e ninguém a atualiza.** Medido: a do `Y:` (que é
> onde o Altium grava, e de onde sai a publicação) tem md5 `2c3f4b13…`; a UNC tem outro e
> não contém o símbolo `NE555`, que `Projects/LM555 astável/schematic.js` usa. Rodar o
> BuildSchematic nesse projeto hoje aborta pelo modo de falha descrito acima. O código
> Python já não usa essa UNC — a ordem única vive em `tools/libpath.py`. Decidir para onde
> o `SCHLIB_PADRAO` deve apontar (a lib viva, ou a publicação em
> `\\192.168.15.192\altiumhub\current\Libs\`) é assunto em aberto; a publicação está
> sempre fresca depois de um sincronismo, mas fica gravável pelo share. Enquanto isso não se
> decide, dá para resolver por máquina com a chave `schlib` do `home.txt`, sem tocar no
> `.pas`.

## 9. O dia a dia

Publicar uma versão é uma linha, daqui:

```powershell
git push servidor neoden-ordem-por-bico
```

O hook `post-receive` chama o `deploy.sh` sozinho. A saída do deploy aparece no
seu terminal, junto com a do push, e termina em `-> no ar: <hash>`. Não precisa
entrar no servidor.

Se algo der errado no servidor, o deploy para sem trocar nada e o hub continua
na versão anterior. Repetir o push **não** refaz o deploy, porque a ref já
avançou e o hook não é chamado de novo. Nesse caso, no servidor:

```bash
sudo -u altiumhub /srv/altiumhub/bin/deploy.sh neoden-ordem-por-bico
```

Voltar atrás:

```bash
sudo -u altiumhub /srv/altiumhub/bin/rollback.sh              # volta uma release
sudo -u altiumhub /srv/altiumhub/bin/rollback.sh a1b2c3d      # volta para uma específica
```

Ver o log:

```bash
docker compose -f /srv/altiumhub/compose.yml logs --tail 60
```

Três coisas que valem saber. O nome da release é o `git rev-parse --short` do
commit empurrado, então `git show a1b2c3d` funciona nos dois lados. A imagem só é
reconstruída quando o `requirements.txt` muda; um deploy normal é extrair, trocar
o link e recriar o container. E o `deploy.sh` atualiza o próprio `bin/` e o hook a
partir da release no fim de cada deploy bem-sucedido, então mudanças em
`tools/deploy/` entram sozinhas a partir do segundo push.

## 10. O que continua aberto

- **`localStorage` não viaja.** Parâmetros de corte do laser e exclusões do Neoden
  vivem no navegador, por origem. Trocar de `localhost:8000` para
  `192.168.15.192:8100` zera os dois, e os dois viram material físico. Exporte
  antes: no console do hub antigo, as chaves que começam com `altiumhub.`.
- **As correções de código** em [PENDENCIAS.md](PENDENCIAS.md), que valem igual com
  compose.
- `altiumhub.service` continua no repositório como alternativa sem Docker. Com o
  compose, ele não é usado.
