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
COMPARTILHADOS=(
  "Libs/Almox"                     # .SchLib do almoxarifado, 255 MB (gitignored)
  "Libs/almox-basicos.js"          # espelhos gerados (gitignored)
  "Libs/almox-especiais.js"
  "Libs/almox-index.js"
  "Libs/almox-sync.js"
  "Libs/almox-guardiao.js"
  "Libs/almox-parts.json"          # livro-razao rotulo->part number: PERDER RENUMERA TUDO
  "Libs/lib-ledger.json"           # guardiao.py:166 reescreve a cada sincronismo
  "Libs/lib-subs.js"               # unico Libs/ que o browser grava (hubserver.py:157)
  "tools/almox/componentes_odoo.csv"   # estado do sincronismo incremental
  "tools/symbols/config.json"      # caminhos da maquina, nao do projeto
  "hub-config.json"
  "hub-almox.json"                 # credenciais do Odoo — chmod 600
  "Trash"
  "Laser"
)

erro() { echo "!! $*" >&2; exit 1; }
dc()   { docker compose --project-directory "$BASE" -f "$BASE/compose.yml" "$@"; }

[ $# -eq 1 ] || erro "uso: deploy.sh <commit>"
COMMIT=$(git --git-dir="$REPO" rev-parse --verify "$1^{commit}") || erro "commit desconhecido: $1"
CURTO=$(git --git-dir="$REPO" rev-parse --short "$COMMIT")
DEST=$BASE/releases/$CURTO

# ── 0. pre-voo: se nao der para subir o container, nao comece ────────────────
# Sem isto o script troca o symlink e morre no up, deixando o share ja apontando
# para codigo novo com o hub ainda rodando o velho.
command -v docker >/dev/null 2>&1 || erro "docker nao esta instalado nesta maquina"
docker compose version >/dev/null 2>&1 || erro "o plugin 'docker compose' nao esta disponivel"
docker info >/dev/null 2>&1 || erro "$(whoami) nao fala com o daemon do docker. Falta 'usermod -aG docker $(whoami)' e reabrir a sessao."

echo "-> release $CURTO"

# ── 1. extrai o commit (release nunca e reescrita; repetir um deploy refaz) ──
rm -rf "$DEST"
mkdir -p "$DEST"
git --git-dir="$REPO" archive "$COMMIT" | tar -x -C "$DEST"

# ── 2. liga o que e estado, nao codigo ──────────────────────────────────────
mkdir -p "$BASE/shared"
for alvo in "${COMPARTILHADOS[@]}"; do
  origem=$BASE/shared/$alvo
  if [ ! -e "$origem" ]; then
    if [ -e "$DEST/$alvo" ]; then
      mkdir -p "$(dirname "$origem")"
      cp -a "$DEST/$alvo" "$origem"
      echo "   semeou shared/$alvo a partir do commit"
    else
      continue                     # nao existe dos dois lados: nada a ligar
    fi
  fi
  mkdir -p "$(dirname "$DEST/$alvo")"
  rm -rf "$DEST/$alvo"
  ln -s "$origem" "$DEST/$alvo"
done

if [ "$PROJECTS_DE" = shared ]; then
  mkdir -p "$BASE/shared/Projects"
  if [ -z "$(ls -A "$BASE/shared/Projects" 2>/dev/null)" ] && [ -d "$DEST/Projects" ]; then
    cp -a "$DEST/Projects/." "$BASE/shared/Projects/"
    echo "   semeou shared/Projects com $(ls -1 "$BASE/shared/Projects" | wc -l) projetos do commit"
  fi
  rm -rf "$DEST/Projects"
  ln -s "$BASE/shared/Projects" "$DEST/Projects"
  if [ -e "$BASE/shared/projects.js" ]; then
    rm -f "$DEST/projects.js"; ln -s "$BASE/shared/projects.js" "$DEST/projects.js"
  fi
fi

# ── 3. o compose.yml e versionado: vem da release, nao do disco do servidor ──
cp -f "$DEST/tools/deploy/compose.yml" "$BASE/compose.yml"

# ── 4. a imagem so e reconstruida quando as dependencias mudam ───────────────
anterior=$(cat "$BASE/anterior" 2>/dev/null || true)
CONSTRUIR=""
if ! docker image inspect altiumhub:local >/dev/null 2>&1; then
  CONSTRUIR="--build"
  echo "   imagem ainda nao existe: vai construir"
elif [ -n "$anterior" ] && [ -f "$BASE/releases/$anterior/requirements.txt" ] \
     && ! cmp -s "$DEST/requirements.txt" "$BASE/releases/$anterior/requirements.txt"; then
  CONSTRUIR="--build"
  echo "   requirements.txt mudou: vai reconstruir a imagem"
fi

# ── 5. prova que a release ao menos importa antes de trocar o hub ───────────
# -w e obrigatorio aqui. O working_dir do compose e /srv/altiumhub/current, que
# no PRIMEIRO deploy ainda nao existe; o docker criaria um DIRETORIO com esse
# nome dentro do bind mount, e o `mv -Tf` do passo 6 nao consegue por um symlink
# por cima de um diretorio. A checagem passaria e a troca falharia logo depois.
dc run --rm --no-deps -T -w /srv/altiumhub hub python -m py_compile "$DEST/hubserver.py" \
  || erro "hubserver.py do commit $CURTO nao compila — nada foi trocado"

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
dc up -d --force-recreate $CONSTRUIR
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

echo "-> no ar: $CURTO   (voltar: $BASE/bin/rollback.sh)"
