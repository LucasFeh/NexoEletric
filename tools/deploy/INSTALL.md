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

A biblioteca da casa saiu de cena. A única em uso é a gerada a partir do Odoo, que
vive em `Libs/Almox`: 32 `.SchLib`, uma por família, mais `FOOTPRINTS ALMOX.PcbLib`
com 63 MB de footprints. Os `.pas` já apontam só para lá, e a pasta
`D:\ALTIUM LIBRARY ------ LUCAS` não viaja nem é referenciada.

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

```bash
docker --version && docker compose version      # premissa do plano

sudo groupadd -g 1500 altiumhub
sudo useradd -u 1500 -g 1500 -m -d /srv/altiumhub -s /bin/bash altiumhub
sudo usermod -aG docker altiumhub
sudo -u altiumhub mkdir -p /srv/altiumhub/{releases,shared,bin,.ssh}
sudo -u altiumhub chmod 700 /srv/altiumhub/.ssh

sudo mkdir -p /srv/altiumhub-repo.git && sudo chown altiumhub:altiumhub /srv/altiumhub-repo.git
sudo -u altiumhub git -C /srv/altiumhub-repo.git init --bare
```

O UID 1500 não é decorativo: é o mesmo do `Dockerfile` e o do `force user` do
share. Os três precisam bater, senão o Altium grava `board.js` pelo SMB e o hub
não consegue reescrever.

A senha mestre, fora do git:

```bash
sudo mkdir -p /etc/altiumhub
printf 'ALTIUMHUB_MASTER=%s\n' "$(openssl rand -base64 24)" | sudo tee /etc/altiumhub/senha.env
sudo chmod 600 /etc/altiumhub/senha.env
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

```bash
cd /srv/altiumhub
sudo -u altiumhub git --git-dir=/srv/altiumhub-repo.git archive neoden-ordem-por-bico tools/deploy \
  | sudo -u altiumhub tar -x --strip-components=2 -C bin
sudo -u altiumhub cp bin/post-receive /srv/altiumhub-repo.git/hooks/post-receive
```

## 5. Semear `shared/` antes do primeiro deploy

A ordem importa: o symlink de um arquivo só nasce se ele já existir quando o
deploy roda.

```bash
sudo -u altiumhub mkdir -p /srv/altiumhub/shared/{Libs,tools/almox,tools/symbols}
sudo -u altiumhub tee /srv/altiumhub/shared/hub-almox.json >/dev/null <<'J'
{"url":"http://127.0.0.1:8070","db":"odoo_db","login":"SEU_LOGIN","senha":"SENHA_NOVA"}
J
sudo -u altiumhub chmod 600 /srv/altiumhub/shared/hub-almox.json
```

`http://127.0.0.1:8070` funciona porque o compose usa rede do host. Se o arquivo
faltar, `le_config()` cai calado no padrão de `odoo_pull.py:34`, que aponta para o
Odoo de **teste**, e o sincronismo puxa do ERP errado sem erro nenhum.

E daqui, os 265 MB de biblioteca:

```powershell
scp -r Libs\Almox altiumhub@192.168.15.192:/srv/altiumhub/shared/Libs/
scp Libs\almox-basicos.js Libs\almox-especiais.js Libs\almox-index.js altiumhub@192.168.15.192:/srv/altiumhub/shared/Libs/
scp tools\almox\componentes_odoo.csv altiumhub@192.168.15.192:/srv/altiumhub/shared/tools/almox/
```

## 6. O share SMB

```bash
sudo cp /srv/altiumhub/bin/smb-altiumhub.conf /etc/samba/smb.conf.d/altiumhub.conf
sudo testparm -s            # tem que passar sem erro
sudo systemctl reload smbd
```

Se o `smb.conf` da máquina não tiver `include`, cole a seção no fim dele.

## 7. Primeiro deploy

```bash
sudo -u altiumhub /srv/altiumhub/bin/deploy.sh neoden-ordem-por-bico
```

Ele constrói a imagem na primeira vez, extrai a release, liga `shared/`, compila
`hubserver.py` para provar que o commit importa, troca o symlink, sobe o container
e confere que o hub respondeu. Se não responder, volta sozinho.

O hub fica em `http://192.168.15.192:8100`.

## 8. Windows: mapear e apontar o Altium

```powershell
net use P: \\192.168.15.192\altiumhub /persistent:yes
```

Os quatro `.pas` já apontam para `\\192.168.15.192\altiumhub\current`. Rode-os do
Altium a partir de `P:\current`. Como `current` é um link para a release no ar, um
deploy troca o alvo e o caminho continua o mesmo.

O `BuildSchematic.pas` agora abre só as bibliotecas do almoxarifado. A constante
`SCHLIB_FILE` foi removida junto com a chamada que a usava, e `PCBLIB_FILE` passou
a apontar para `Libs\Almox\FOOTPRINTS ALMOX.PcbLib`. Se a pasta do almoxarifado
faltar, ele para com aviso em vez de montar esquema com biblioteca vazia.

## 9. O dia a dia

```powershell
git push servidor neoden-ordem-por-bico
```

```bash
/srv/altiumhub/bin/rollback.sh              # volta uma release
/srv/altiumhub/bin/rollback.sh a1b2c3d      # volta para uma específica
docker compose -f /srv/altiumhub/compose.yml logs --tail 60
```

O nome da release é o `git rev-parse --short` do commit empurrado, então
`git show a1b2c3d` funciona nos dois lados.

A imagem só é reconstruída quando o `requirements.txt` muda. Um deploy normal é
extrair, trocar o link e recriar o container.

## 10. O que continua aberto

- **`localStorage` não viaja.** Parâmetros de corte do laser e exclusões do Neoden
  vivem no navegador, por origem. Trocar de `localhost:8000` para
  `192.168.15.192:8100` zera os dois, e os dois viram material físico. Exporte
  antes: no console do hub antigo, as chaves que começam com `altiumhub.`.
- **As correções de código** em [PENDENCIAS.md](PENDENCIAS.md), que valem igual com
  compose.
- `altiumhub.service` continua no repositório como alternativa sem Docker. Com o
  compose, ele não é usado.
