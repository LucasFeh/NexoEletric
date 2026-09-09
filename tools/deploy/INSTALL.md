# Por o hub no servidor 192.168.15.192 e versionar por push

Alvo: **192.168.15.192**, a máquina do Odoo de produção. Medido em 2026-09-09:

| | |
|---|---|
| Odoo | 19.0 Enterprise (`19.0+e-20260421`), Werkzeug/3.0.1, **Python 3.12.3** |
| bases | `odoo_db`, `teste` |
| ssh | porta 22 aberta |
| portas **ocupadas** | 8000, 5000, 8070, 8080 |
| portas livres | 8081, **8100**, 8090, 8800, 9000 |

O hub vai na **8100**. A 8000 do rascunho anterior está ocupada nessa máquina, e
`Restart=always` transformaria isso num crash-loop silencioso.

Depois de montado, publicar uma versão é uma linha:

```powershell
git push servidor neoden-ordem-por-bico
```

E voltar atrás, outra:

```bash
/srv/altiumhub/bin/rollback.sh
```

---

## 0. Duas coisas a decidir ANTES de instalar

### 0.1 Quem é dono de `Projects/`

Já existem **cinco** cópias de `Projects/` nesta mesa: o worktree principal e os
quatro de agente, com `projects.js` de md5 diferente. Ninguém se machucou porque
só o principal é escrito pelo Altium e aberto pelo Lucas. O servidor seria a
sexta — e a primeira que é escrita por um robô e oferecida à bancada para editar.

Os quatro `.pas` cravam o workspace em oito constantes, todas em `\\LUCAS-PC`
(`ExportBoard.pas:21`, `ApplyChanges.pas:22`, `ExportProject.pas:15`,
`BuildSchematic.pas:19`). Sem decidir a dona, o roteiro é este: alguém salva
`changes.js` no hub do .192, vai ao Altium, roda ApplyProject — e o Altium lê a
cópia do `\\LUCAS-PC`, aplica as mudanças **da semana passada** e escreve um
`apply-report.txt` verde. Nenhum erro em lugar nenhum.

Só há duas formas honestas:

**(A) O servidor é o dono.** O `deploy.sh` já vem assim (`PROJECTS_DE=shared`).
Falta apontar o Altium para lá: compartilhar `/srv/altiumhub/shared` por Samba e
trocar as oito constantes dos `.pas` de `\\LUCAS-PC\D\...` para o UNC do .192.
É viável porque o Altium **já** escreve por SMB — o comentário de
`ExportBoard.pas:20` diz que ele roda noutra máquina e alcança o `D:` compartilhado.
Trocar de host é trocar o nome, não o mecanismo.

**(B) O Windows continua dono.** Então o hub do servidor precisa ser **só leitura**:
`/api/save` (`hubserver.py:153`) e as sete rotas POST do symserver têm que recusar
quem não for local. Ponha `PROJECTS_DE=git` no `deploy.sh` e o conteúdo de
`Projects/` passa a vir do commit a cada deploy.

O que **não** pode existir é o desenho de hoje: duas cópias graváveis e nenhum
sincronismo entre elas.

> Nunca resolva isso com symlink dentro de um work tree do git. Se `Projects/`
> virar um link, um `git add -A Projects` estagia a remoção dos 74 arquivos
> versionados. É por isso que o deploy daqui usa release imutável e não work tree.

### 0.2 A senha do Odoo já está exposta, e o deploy agrava

`GET /hub-almox.json` responde **200 com a senha em texto claro** para qualquer
host da LAN. O `_serve` (`hubserver.py:120-133`) só recusa segmento começado por
ponto, e a curinga `/<path:path>` (`:141`) serve qualquer arquivo do ROOT. O
comentário de `hubserver.py:548` — "fica FORA do git e nunca sai por HTTP" — está
errado. Pela mesma rota saem `tools/almox/componentes_odoo.csv` (723 KB com custo,
preço de venda e part number de fornecedor) e `Libs/Almox/almox.sqlite`.

E isso **não começa no deploy**: `tools/wt-novo.ps1:38-45` copia `hub-almox.json`
para cada worktree novo, e os quatro irmãos têm cada um a sua cópia. Com o
`app.run(host='0.0.0.0')` de `hubserver.py:938`, a credencial já é baixável das
portas 8000 a 8004 desta mesa enquanto os agentes trabalham.

**Ordem certa:** trate a senha atual como comprometida e troque-a no Odoo; tire as
credenciais do ROOT servido em todas as máquinas; só então aponte alguma coisa
para o .192. As mudanças de código estão em [PENDENCIAS.md](PENDENCIAS.md).

---

## 1. Chave SSH

O remote `servidor` aponta para o .240, que era o servidor de teste, e
`git ls-remote servidor` responde `Permission denied (publickey,password)`.

```powershell
ssh-keygen -t ed25519 -C "lucas@LUCAS-PC"
type $env:USERPROFILE\.ssh\id_ed25519.pub
git remote set-url servidor altiumhub@192.168.15.192:/srv/altiumhub/repo.git
```

Não adivinhe o usuário do .192. Quem administra o Odoo responde com:

```bash
getent passwd altiumhub
systemctl show -p User --value odoo.service
```

A prova final é de fora: `git ls-remote servidor` tem que listar refs.

## 2. Servidor: usuário, estrutura, venv

```bash
sudo adduser --system --group --home /srv/altiumhub altiumhub
sudo -u altiumhub mkdir -p /srv/altiumhub/repo.git /srv/altiumhub/releases \
     /srv/altiumhub/shared /srv/altiumhub/bin /srv/altiumhub/.ssh
sudo -u altiumhub chmod 700 /srv/altiumhub/.ssh
sudo -u altiumhub git -C /srv/altiumhub/repo.git init --bare
sudo apt install -y python3-venv curl
sudo -u altiumhub python3 -m venv /srv/altiumhub/.venv
```

A chave pública do passo 1 vai em `/srv/altiumhub/.ssh/authorized_keys`, `chmod 600`.

O venv fica **fora** das releases de propósito: assim não é reinstalado a cada push,
e o `ExecStart` do serviço nunca muda de caminho.

## 3. Primeiro push

```powershell
git push servidor neoden-ordem-por-bico
```

O hook ainda não existe, então esse push só popula o repositório. Agora, no servidor:

```bash
cd /srv/altiumhub
sudo -u altiumhub git --git-dir=repo.git archive neoden-ordem-por-bico tools/deploy \
  | sudo -u altiumhub tar -x --strip-components=2 -C bin
sudo -u altiumhub chmod +x bin/deploy.sh bin/rollback.sh
sudo -u altiumhub cp bin/post-receive repo.git/hooks/post-receive
sudo -u altiumhub chmod +x repo.git/hooks/post-receive
sudo -u altiumhub git --git-dir=repo.git show neoden-ordem-por-bico:requirements.txt > /tmp/req.txt
sudo -u altiumhub /srv/altiumhub/.venv/bin/pip install -r /tmp/req.txt
```

O `deploy.sh` reinicia o serviço, então o `altiumhub` precisa disso sem senha.
Confira o caminho do binário com `command -v systemctl` — em caixa com usrmerge é
`/usr/bin/systemctl`, e a regra escrita com o caminho errado só falha na hora do
deploy. A linha abaixo aceita os dois caminhos:

```bash
printf 'altiumhub ALL=(root) NOPASSWD: /usr/bin/systemctl restart altiumhub, /usr/bin/systemctl show altiumhub, /bin/systemctl restart altiumhub, /bin/systemctl show altiumhub\n' | sudo tee /etc/sudoers.d/altiumhub
sudo chmod 440 /etc/sudoers.d/altiumhub
sudo visudo -c
```

## 4. O serviço

```bash
sudo cp /srv/altiumhub/bin/altiumhub.service /etc/systemd/system/
sudo mkdir -p /etc/systemd/system/altiumhub.service.d
printf '[Service]\nEnvironment=ALTIUMHUB_MASTER=%s\n' "$(openssl rand -base64 24)" | sudo tee /etc/systemd/system/altiumhub.service.d/senha.conf
sudo chmod 600 /etc/systemd/system/altiumhub.service.d/senha.conf
sudo systemctl daemon-reload && sudo systemctl enable altiumhub
```

A senha mestre nunca entra em arquivo versionado. Sem `ALTIUMHUB_MASTER`, vale o
default de `hubserver.py:470`, que está público no GitHub.

Firewall — nunca `ufw allow 8100` sozinho, porque as rotas de escrita não pedem
credencial nenhuma:

```bash
sudo ufw allow from 192.168.15.0/24 to any port 8100 proto tcp comment 'altiumhub LAN'
```

## 5. Semear o que o git não leva

O `deploy.sh` cria `shared/` e liga tudo, mas alguns arquivos não existem em
lugar nenhum até alguém pôr:

| arquivo | o que é | como semear |
|---|---|---|
| `shared/hub-almox.json` | credenciais do Odoo | escreva à mão, `chmod 600`, `url` = `http://127.0.0.1:8070` |
| `shared/Libs/Almox/` | `.SchLib` binárias do almoxarifado | `scp -r` do Windows |
| `shared/Libs/almox-*.js` | espelhos gerados | `scp` junto com as `.SchLib` |
| `shared/tools/almox/componentes_odoo.csv` | estado do sincronismo incremental | `scp` — sem ele o botão "só regerar" morre em `almox2lib.py:675` |
| `shared/tools/symbols/config.json` | caminhos `Y:\` da máquina | ajuste ou deixe cair no padrão |

Sobre o `hub-almox.json`: se ele **não existir**, `le_config()` (`odoo_pull.py:50-61`)
cai calado no `PADRAO` de `odoo_pull.py:34` — que aponta para
`http://192.168.15.182:8070`, o **servidor de teste**. Não há erro nenhum: o
sincronismo simplesmente puxa do ERP abandonado. O mesmo acontece se alguém gravar
a config pela tela com o campo do servidor em branco (`hubserver.py:597` grava `""`,
e string vazia volta ao `PADRAO`).

E gravar pela tela **não vai funcionar** de outra máquina: `POST /api/almox/config`
exige `_is_local` (`hubserver.py:583`), e `_is_local` compara o IP do **cliente** com
os endereços do servidor. Do PC do Lucas isso nunca casa. Escreva o arquivo por ssh,
ou faça o POST de dentro do servidor:

```bash
curl -X POST http://127.0.0.1:8100/api/almox/config -H 'Content-Type: application/json' \
  -d '{"url":"http://127.0.0.1:8070","db":"odoo_db","login":"...","senha":"..."}'
```

## 6. O dia a dia

```powershell
git push servidor neoden-ordem-por-bico
```

O `deploy.sh` extrai a release, liga `shared/`, compila `hubserver.py` para provar
que o commit ao menos importa, troca o symlink `current` de forma atômica, reinicia
e **confere que o hub respondeu** em `http://127.0.0.1:8100/api/index.json`. Se não
responder em 10 s, ele volta sozinho para a release anterior e diz isso no push.

```bash
/srv/altiumhub/bin/rollback.sh              # volta uma release
/srv/altiumhub/bin/rollback.sh a1b2c3d      # volta para uma específica
ls -1t /srv/altiumhub/releases              # as 5 últimas ficam no disco
```

O nome da release é o `git rev-parse --short` do commit que você empurrou, então
ele existe também no seu repositório: `git show a1b2c3d` funciona dos dois lados.

Marcar versões continua sendo git normal:

```powershell
git tag -a v2026.09.09 -m "hub no servidor de producao"
git push servidor neoden-ordem-por-bico --tags
```

## 7. O que a bancada salva no servidor

Fica em `/srv/altiumhub/shared/`, e **não é versionado**. Isso é deliberado: sem
work tree no servidor não há merge no meio do push, nem commit de "bancada" preso
numa máquina, nem arquivo gerado sujando o `git status`. Para trazer de volta:

```powershell
scp -r altiumhub@192.168.15.192:/srv/altiumhub/shared/Projects/ .
```

Se a opção (A) do item 0.1 for adotada, `shared/Projects` passa a ser o original e
essa cópia deixa de fazer sentido — o Windows é que passa a ler de lá.

## 8. O que não atravessa para o Linux

- **Abrir no LightBurn** (`/api/laser-open`): é `os.startfile`. De outra máquina o
  endpoint já responde **403** antes disso (`hubserver.py:193`), então o que a
  bancada vê é "use Baixar .lbrn" — que é o caminho certo mesmo.
- **Sincronismo do almoxarifado e editor de símbolos**: apontam para
  `Y:\Biblioteca\...` (`tools/symbols/config.json`) e `\\LUCAS-PC\D\...`
  (`tools/almox/dblib.py:26`, `schlib_escritor.py:24`). No Linux o sincronismo
  **termina com sucesso** e gera `.SchLib` sem o desenho da casa, mais um `.DbLib`
  apontando para o `\\LUCAS-PC` — degrada em silêncio, porque
  `almox2lib.py:796-803` engole a falha num `except` que só imprime ATENÇÃO.
  Rode o sync com `--sem-schlib` no servidor, ou monte CIFS.
- **A vista Esquema nasce sem o almoxarifado**: `schframe.html:590-592` carrega três
  scripts que estão no `.gitignore`. Sem semeá-los (item 5), o modal de símbolo abre
  sem os dois acervos, com três 404 no console e nenhum aviso na tela.
- **Os `.pas`** rodam dentro do Altium. O ciclo export → hub → apply continua
  passando pelo Windows enquanto o item 0.1 não for decidido.

## 9. O navegador também guarda estado, e ele não viaja

`localStorage` é por origem. Hoje o hub vive em `file://` e `http://localhost:8000`;
no servidor passa a ser `http://192.168.15.192:8100`, uma origem nova e vazia. O que
se perde vira material físico:

- **Parâmetros de corte do laser** por projeto (`hub.html:3247`, `:3285`) voltam ao
  padrão de fábrica — potência e velocidade erradas no galvo.
- **Exclusões do Neoden** por projeto (`hub.html:1631-1647`) somem: os 38 PTH do
  MID-DI261897 voltam para o CSV de pick-and-place.
- Também a fonte de biblioteca escolhida, o "já visto" do almoxarifado, tema e idioma.

Antes de trocar de origem, exporte no console do hub antigo:

```js
JSON.stringify(Object.fromEntries(
  Object.entries(localStorage).filter(([k]) => k.startsWith('altiumhub.'))))
```

e reinjete no hub novo. O conserto de verdade é promover os dois estados que viram
material físico a arquivo do projeto, como o BOM já fez com `bom-vistos.json`
(`hubserver.py:33-35`).
