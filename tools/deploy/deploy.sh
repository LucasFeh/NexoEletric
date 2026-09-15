#!/bin/bash
# AltiumPCBMirror — instala uma release e troca o hub para ela.
#
# Chamado pelo hook post-receive, ou a mao no servidor para repetir um deploy:
#     /srv/altiumhub/bin/deploy.sh <commit>
#
# Desenho: RELEASE IMUTAVEL + symlink atomico, com o container do compose lendo
# o codigo por bind mount. Nao existe work tree no servidor, e por isso nao
# existe merge no deploy, nem commit de "bancada" preso na maquina, nem arquivo
# gerado sujando o git status, nem CRLF do gerador de espelho brigando com o
# blob LF. O que o servidor escreve mora em shared/ e nao passa por git nenhum.
#
#   /srv/altiumhub/            <- e tambem a raiz do share SMB `altiumhub`
#   ├── releases/<hash>/       codigo extraido do commit (nunca reescrito)
#   ├── current -> releases/<hash>
#   ├── anterior               hash da release de antes (rollback.sh le daqui)
#   ├── shared/                DADOS e configuracao de maquina
#   ├── compose.yml            copiado da release a cada deploy
#   └── bin/                   este script e o rollback.sh
#
# O repositorio bare fica FORA daqui (/srv/altiumhub-repo.git), para nao ser
# publicado no share nem montado dentro do container.
set -euo pipefail

BASE=${ALTIUMHUB_BASE:-/srv/altiumhub}
REPO=${ALTIUMHUB_REPO:-/srv/altiumhub-repo.git}
SERVICO=hub                  # nome do servico dentro do compose.yml
PORTA=${ALTIUMHUB_PORTA:-8100}
GUARDAR=5                    # quantas releases antigas ficam no disco

# De onde vem Projects/ — quem e o DONO dos dados do projeto.
#   shared  = o servidor e o dono. A bancada salva pelo hub e o Altium das outras
#             maquinas escreve pelo share SMB. E o modo deste desenho.
#   git     = o repositorio e o dono, e cada deploy substitui Projects/ pelo
#             conteudo do commit. So faz sentido se o hub for so leitura.
PROJECTS_DE=shared

# O que sobrevive ao deploy: os caminhos que o SERVIDOR escreve, medidos no
# codigo. Ficam em shared/ e entram na release por symlink.
#
# Diretorios e arquivos vao em listas separadas porque o tratamento de "nao
# existe em lado nenhum" e diferente: diretorio a gente cria vazio, arquivo a
# gente deixa passar. Trash/ e Laser/ nascem so em runtime e sao gitignored --
# sem o mkdir, o hub gravaria dentro da release e a lixeira do "Excluir projeto"
# seria varrida pela poda no deploy seguinte.
COMPARTILHADOS_DIR=(
  "Libs/Almox"                     # .SchLib do almoxarifado, 255 MB (gitignored)
  "Trash"                          # hubserver.py TRASH_DIR: o unico desfazer que existe
  "Laser"                          # .lbrn gerados pelo painel do laser
)
COMPARTILHADOS_ARQ=(
  "Libs/almox-basicos.js"          # espelhos gerados (gitignored)
  "Libs/almox-especiais.js"
  "Libs/almox-index.js"
  "Libs/almox-sync.js"
  "Libs/almox-guardiao.js"
  "Libs/almox-parts.json"          # livro-razao rotulo->part number: PERDER RENUMERA TUDO
  "Libs/lib-ledger.json"           # guardiao.py:166 reescreve a cada sincronismo
  "Libs/lib-subs.js"               # unico Libs/ que o browser grava (hubserver.py:157)
  "Libs/schlib.js"                 # symserver.py:374 reescreve a cada Salvar
  "Libs/symbols-lib.js"            # symserver.py:540 — simbolos desenhados a mao
  "Libs/libs-report.txt"           # symserver.py:711
  # OS TRES ABAIXO ESCAPAVAM, e o usuario pegou: sao VERSIONADOS e nao estavam nesta
  # lista, entao o deploy os reescrevia a cada push com o conteudo do commit -- inclusive
  # a .SchLib da casa, que e biblioteca de Altium e nao codigo. Medido em 2026-09-15:
  # no servidor os tres eram arquivo real da release, e nao symlink.
  #
  # Estar no git nao os torna codigo: sao ESTADO publicado, como o schlib.js logo acima.
  # Viajam no repositorio para uma instalacao NOVA nascer com eles; a que ja esta no ar
  # tem a sua copia, e trocar isso por baixo de quem trabalha e a coisa que este deploy
  # inteiro foi desenhado para nao fazer.
  "Libs/BIBLIOTECA DE ESQUEMA.SchLib"  # a lib da casa publicada pelo guardiao
  "Libs/pcblib.js"                 # espelho de footprints, escrito pelo ExportLibs
  "Libs/rename-map.js"             # nomes antigos -> novos, estado da biblioteca
  "projects.js"                    # indice dos projetos; os .pas reescrevem
  "tools/almox/componentes_odoo.csv"   # estado do sincronismo incremental
  "tools/symbols/config.json"      # caminhos da maquina, nao do projeto
  "hub-config.json"
  "hub-almox.json"                 # credenciais do Odoo — chmod 600
  ".hub-odoo.json"                 # credencial do ENVIO da lista; o ponto no nome e o que
                                   # impede o _serve de entrega-la por HTTP (hubserver.py).
                                   # Sem esta linha ela morava dentro da release e o
                                   # `rm -rf $DEST` do deploy seguinte a levava junto --
                                   # o envio voltava a "nao ha senha configurada" a cada
                                   # publicacao, sem ninguem ter mexido nela.
)

erro() { echo "!! $*" >&2; exit 1; }
dc()   { docker compose --project-directory "$BASE" -f "$BASE/compose.yml" "$@"; }

[ $# -eq 1 ] || erro "uso: deploy.sh <commit>"

# ── 0a. o usuario certo, ANTES de qualquer outra coisa ──────────────────────
# Rodar como outro login e o tropeco mais comum aqui, e ele nao se denuncia: tudo sob
# $BASE e do altiumhub, entao quem roda como `odoo` (ou como o proprio login) so esbarra
# la na frente, no env_file -- com uma mensagem que fala de permissao de ARQUIVO e manda
# consertar um chmod que ja esta certo. Medido em 2026-09-15: /etc/altiumhub/senha.env
# estava exatamente como o INSTALL manda (root:altiumhub 640) e a mensagem mandava
# arruma-lo assim mesmo. O nome do usuario na frente mata a duvida antes de ela nascer.
DONO=$(stat -c %U "$BASE" 2>/dev/null || echo altiumhub)
if [ "$(id -un)" != "$DONO" ]; then
  erro "este script roda como '$DONO' e voce e '$(id -un)'.
   Rode:  sudo -u $DONO $0 $1"
fi
COMMIT=$(git --git-dir="$REPO" rev-parse --verify "$1^{commit}") || erro "commit desconhecido: $1"
CURTO=$(git --git-dir="$REPO" rev-parse --short "$COMMIT")
DEST=$BASE/releases/$CURTO

# ── 0. pre-voo: se nao der para subir o container, nao comece ────────────────
# Sem isto o script troca o symlink e morre no up, deixando o share ja apontando
# para codigo novo com o hub ainda rodando o velho.
command -v docker >/dev/null 2>&1 || erro "docker nao esta instalado nesta maquina"
docker compose version >/dev/null 2>&1 || erro "o plugin 'docker compose' nao esta disponivel"
docker info >/dev/null 2>&1 || erro "$(whoami) nao fala com o daemon do docker. Falta 'usermod -aG docker $(whoami)' e reabrir a sessao."

# O env_file do compose e lido pelo CLIENTE do compose, nao pelo container, entao
# quem precisa conseguir le-lo e o usuario que roda o deploy. Criado com chmod 600
# e dono root, ele da 'permission denied' la na frente, no meio de um comando que
# fala de outra coisa.
ENVFILE=${ALTIUMHUB_ENVFILE:-/etc/altiumhub/senha.env}
[ -e "$ENVFILE" ] || erro "$ENVFILE nao existe. E o env_file do compose, com ALTIUMHUB_MASTER."
[ -r "$ENVFILE" ] || erro "$(whoami) nao consegue ler $ENVFILE.
   Conserto:  sudo chown root:altiumhub $ENVFILE && sudo chmod 640 $ENVFILE"

echo "-> release $CURTO"

# ── 1. extrai o commit ──────────────────────────────────────────────────────
# A release e imutavel, entao re-extrair a que ESTA NO AR seria so destruicao:
# o `rm -rf` apagaria o diretorio de onde o container serve, com `current` ainda
# apontando para ele, e levaria junto o que o servidor escreveu la dentro. Como o
# INSTALL manda re-rodar o deploy depois de semear um arquivo em shared/, esse
# caso e rotina, nao exotico. Aqui ele vira "so religa os symlinks".
NO_AR=$(basename "$(readlink -f "$BASE/current" 2>/dev/null)" 2>/dev/null || true)
if [ "$CURTO" = "$NO_AR" ] && [ -d "$DEST" ]; then
  echo "   $CURTO ja e a release no ar: religando shared/ sem re-extrair"
else
  rm -rf "$DEST"
  mkdir -p "$DEST"
  git --git-dir="$REPO" archive "$COMMIT" | tar -x -C "$DEST"
fi

# ── 2. liga o que e estado, nao codigo ──────────────────────────────────────
mkdir -p "$BASE/shared"

ligar() {   # $1 = caminho relativo, $2 = "dir" ou "arq"
  local alvo=$1 tipo=$2
  local origem=$BASE/shared/$alvo
  if [ ! -e "$origem" ]; then
    if [ -e "$DEST/$alvo" ]; then
      mkdir -p "$(dirname "$origem")"
      cp -a "$DEST/$alvo" "$origem"
      echo "   semeou shared/$alvo a partir do commit"
    elif [ "$tipo" = dir ]; then
      mkdir -p "$origem"           # Trash/, Laser/: nascem so em runtime
      echo "   criou shared/$alvo vazio"
    else
      return 0                     # arquivo que nao existe dos dois lados
    fi
  fi
  mkdir -p "$(dirname "$DEST/$alvo")"
  rm -rf "$DEST/$alvo"
  ln -s "$origem" "$DEST/$alvo"
}

for alvo in "${COMPARTILHADOS_DIR[@]}"; do ligar "$alvo" dir; done
for alvo in "${COMPARTILHADOS_ARQ[@]}"; do ligar "$alvo" arq; done

if [ "$PROJECTS_DE" = shared ]; then
  mkdir -p "$BASE/shared/Projects"
  if [ -z "$(ls -A "$BASE/shared/Projects" 2>/dev/null)" ] && [ -d "$DEST/Projects" ]; then
    cp -a "$DEST/Projects/." "$BASE/shared/Projects/"
    echo "   semeou shared/Projects com $(ls -1 "$BASE/shared/Projects" | wc -l) projetos do commit"
  fi
  rm -rf "$DEST/Projects"
  ln -s "$BASE/shared/Projects" "$DEST/Projects"
fi

# ── 3. o compose.yml e versionado: vem da release, nao do disco do servidor ──
cp -f "$DEST/tools/deploy/compose.yml" "$BASE/compose.yml"

# ── 4. a imagem so e reconstruida quando as dependencias mudam ───────────────
# O build e feito AQUI, com a release como contexto, e nao pelo compose: no
# primeiro deploy o symlink `current` ainda nao existe, entao um contexto
# apontado para ele nasceria vazio.
anterior=$(cat "$BASE/anterior" 2>/dev/null || true)
CONSTRUIR=0
if ! docker image inspect altiumhub:local >/dev/null 2>&1; then
  CONSTRUIR=1
  echo "   imagem ainda nao existe: vai construir"
elif [ -n "$anterior" ] && [ -f "$BASE/releases/$anterior/requirements.txt" ] \
     && ! cmp -s "$DEST/requirements.txt" "$BASE/releases/$anterior/requirements.txt"; then
  CONSTRUIR=1
  echo "   requirements.txt mudou: vai reconstruir a imagem"
fi
if [ "$CONSTRUIR" = 1 ]; then
  echo "   construindo altiumhub:local (baixa a imagem base e instala as deps)"
  docker build --pull=false \
    --build-arg UID=1500 --build-arg GID=1500 \
    -t altiumhub:local \
    -f "$DEST/tools/deploy/Dockerfile" "$DEST" \
    || erro "a imagem nao construiu. Se travou em apt-get ou pip, o servidor
   provavelmente nao tem saida para a internet. Confira com:
     curl -sS -m 10 -o /dev/null -w '%{http_code}\\n' https://deb.debian.org/debian/"
fi

# ── 5. prova que a release ao menos importa antes de trocar o hub ───────────
# -w e obrigatorio aqui. O working_dir do compose e /srv/altiumhub/current, que
# no PRIMEIRO deploy ainda nao existe; o docker criaria um DIRETORIO com esse
# nome dentro do bind mount, e o `mv -Tf` do passo 6 nao consegue por um symlink
# por cima de um diretorio. A checagem passaria e a troca falharia logo depois.
# A saida do compose vai para um arquivo para a mensagem de erro poder dizer o que
# REALMENTE falhou. Sem isso, qualquer tropeco do compose -- env_file ilegivel,
# imagem que nao constroi, daemon que caiu -- era relatado como "nao compila", e
# manda procurar defeito no lugar errado.
LOG=$(mktemp)
if ! dc run --rm --no-deps -T -w /srv/altiumhub hub python -m py_compile "$DEST/hubserver.py" >"$LOG" 2>&1; then
  echo "--- saida do compose ---" >&2
  cat "$LOG" >&2
  echo "------------------------" >&2
  if grep -qi 'syntaxerror\|py_compile' "$LOG"; then
    rm -f "$LOG"; erro "hubserver.py do commit $CURTO nao compila — nada foi trocado"
  fi
  rm -f "$LOG"
  erro "o compose falhou antes de compilar coisa nenhuma — veja a saida acima. Nada foi trocado."
fi
rm -f "$LOG"

# ── 6. guarda para onde voltar, ENTAO troca (o symlink e a troca atomica) ───
if [ -L "$BASE/current" ]; then
  basename "$(readlink -f "$BASE/current")" > "$BASE/anterior"
fi
ln -sfn "$DEST" "$BASE/current.novo"
mv -Tf "$BASE/current.novo" "$BASE/current"

# ── 7. sobe e confere que o hub respondeu de verdade ─────────────────────────
# O bind mount e de /srv/altiumhub inteiro, entao o symlink novo ja e visto de
# dentro do container; mesmo assim recriamos, porque o processo Python que esta
# no ar carrega o codigo velho em memoria.
dc up -d --force-recreate
ok=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS -m 5 "http://127.0.0.1:$PORTA/api/index.json" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [ "$ok" != 1 ]; then
  echo "!! o hub nao respondeu na porta $PORTA depois de subir"
  if [ ! -s "$BASE/anterior" ]; then
    erro "primeiro deploy: nao existe release anterior para voltar.
   O codigo de $CURTO esta instalado e o container esta caido ou mudo.
   Diagnostico:  docker compose -f $BASE/compose.yml logs --tail 60
   Suspeitos:    porta $PORTA ocupada por outro processo do host,
                 /etc/altiumhub/senha.env faltando (env_file do compose),
                 ou shared/ sem os arquivos do item 5 do INSTALL."
  fi
  echo "!! voltando sozinho para a release anterior"
  "$BASE/bin/rollback.sh" || erro "o rollback tambem nao subiu; veja: dc logs --tail 60"
  erro "deploy de $CURTO revertido. Log: docker compose -f $BASE/compose.yml logs --tail 60"
fi

# ── 8. poda releases antigas ────────────────────────────────────────────────
atual=$(basename "$(readlink -f "$BASE/current")")
anterior=$(cat "$BASE/anterior" 2>/dev/null || true)
ls -1dt "$BASE"/releases/*/ 2>/dev/null | tail -n +$((GUARDAR + 1)) | while read -r velha; do
  nome=$(basename "$velha")
  [ "$nome" = "$atual" ] && continue
  [ "$nome" = "$anterior" ] && continue
  rm -rf "$velha"
done

# ── 9. bin/ e o hook acompanham a release ───────────────────────────────────
# Sem isto, toda mudanca em tools/deploy/ exige uma extracao manual, e o par
# deploy.sh + compose.yml fica em versoes diferentes. Foi assim que apareceu o
# "No such image: altiumhub:local": deploy.sh velho esperando o compose
# construir, compose.yml novo ja sem secao build.
#
# So depois do deploy dar certo, e por `mv` atomico: o bash que esta executando
# este arquivo segue lendo o inode antigo, que o mv nao toca. Copiar por cima
# faria o interpretador ler metade de um script novo.
for f in deploy.sh rollback.sh compose.yml Dockerfile post-receive smb-altiumhub.conf INSTALL.md PENDENCIAS.md; do
  [ -f "$DEST/tools/deploy/$f" ] || continue
  cmp -s "$DEST/tools/deploy/$f" "$BASE/bin/$f" 2>/dev/null && continue
  cp -f "$DEST/tools/deploy/$f" "$BASE/bin/.$f.novo"
  chmod --reference="$DEST/tools/deploy/$f" "$BASE/bin/.$f.novo" 2>/dev/null || true
  mv -f "$BASE/bin/.$f.novo" "$BASE/bin/$f"
  echo "   bin/$f atualizado"
done
if ! cmp -s "$DEST/tools/deploy/post-receive" "$REPO/hooks/post-receive" 2>/dev/null; then
  cp -f "$DEST/tools/deploy/post-receive" "$REPO/hooks/.post-receive.novo"
  chmod +x "$REPO/hooks/.post-receive.novo"
  mv -f "$REPO/hooks/.post-receive.novo" "$REPO/hooks/post-receive"
  echo "   hook post-receive atualizado"
fi

echo "-> no ar: $CURTO   (voltar: $BASE/bin/rollback.sh)"
