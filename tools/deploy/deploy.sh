#!/bin/bash
# AltiumPCBMirror — instala uma release e troca o hub para ela.
#
# Chamado pelo hook post-receive, ou a mao no servidor para repetir um deploy:
#     /srv/altiumhub/bin/deploy.sh <commit>
#
# Desenho: RELEASE IMUTAVEL + symlink atomico. Nao existe work tree no servidor,
# e por isso nao existe merge no deploy, nem commit de "bancada" preso no
# servidor, nem arquivo gerado sujando o git status, nem CRLF do gerador de
# espelho brigando com o blob LF. O que o servidor escreve mora em shared/ e nao
# passa por git nenhum.
#
#   /srv/altiumhub/
#   ├── repo.git/              bare, recebe o push
#   ├── releases/<hash>/       codigo extraido do commit (nunca reescrito)
#   ├── current -> releases/<hash>
#   ├── anterior               hash da release de antes (rollback.sh le daqui)
#   ├── shared/                DADOS e configuracao de maquina (sobrevivem ao deploy)
#   ├── bin/                   este script e o rollback.sh
#   └── .venv/                 fora das releases, para nao ser reinstalado a cada push
set -euo pipefail

BASE=${ALTIUMHUB_BASE:-/srv/altiumhub}
REPO=$BASE/repo.git
SERVICO=altiumhub
PORTA=${ALTIUMHUB_PORTA:-8100}
GUARDAR=5                    # quantas releases antigas ficam no disco

# De onde vem Projects/ — a decisao de quem e o DONO dos dados do projeto.
#   shared  = o servidor e a dona. A bancada salva pelo hub e o que ela salva fica.
#             Exige que o Altium tambem escreva aqui (Samba), senao o ApplyChanges
#             do Altium le a copia do Windows e aplica mudanca velha, sem erro.
#   git     = o repositorio e o dono. O hub do servidor e uma VISTA: cada deploy
#             substitui Projects/ pelo conteudo do commit. Exige gatear /api/save.
PROJECTS_DE=shared

# O que sobrevive ao deploy. Sao os caminhos que o SERVIDOR escreve, medidos no
# codigo: /api/save (hubserver.py:153), o sincronismo do almoxarifado e as sete
# rotas POST do symserver. Ficam em shared/ e entram na release por symlink.
COMPARTILHADOS=(
  "Libs/Almox"                     # .SchLib binarias do almoxarifado (gitignored)
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

[ $# -eq 1 ] || erro "uso: deploy.sh <commit>"
COMMIT=$(git --git-dir="$REPO" rev-parse --verify "$1^{commit}") || erro "commit desconhecido: $1"
CURTO=$(git --git-dir="$REPO" rev-parse --short "$COMMIT")
DEST=$BASE/releases/$CURTO

# ── 0. pre-voo: se o restart nao for possivel, nao comece ────────────────────
# Sem isto o script troca o symlink e morre no restart, deixando frontend novo
# contra backend velho — o estado meio-deployado.
#
# A sonda e `systemctl show`, nao `is-active`: show sai 0 para unidade carregada
# em QUALQUER estado, entao um nao-zero aqui significa mesmo que o sudo foi
# recusado. Com `is-active` o primeiro deploy morreria de mentira, porque o
# servico ainda nao subiu e o is-active sai 3.
sudo -n systemctl show "$SERVICO" >/dev/null 2>&1 \
  || erro "sudo -n systemctl foi recusado para $(whoami). Confira /etc/sudoers.d/altiumhub."
[ -x "$BASE/.venv/bin/python" ] || erro "sem venv em $BASE/.venv — veja o INSTALL.md"

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
    # semeia a partir do que veio no commit, se o commit trouxe algo
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
  # primeira vez: leva os projetos do commit para shared/ em vez de descarta-los
  if [ -z "$(ls -A "$BASE/shared/Projects" 2>/dev/null)" ] && [ -d "$DEST/Projects" ]; then
    cp -a "$DEST/Projects/." "$BASE/shared/Projects/"
    echo "   semeou shared/Projects com $(ls -1 "$BASE/shared/Projects" | wc -l) projetos do commit"
  fi
  rm -rf "$DEST/Projects"
  ln -s "$BASE/shared/Projects" "$DEST/Projects"
  # projects.js e indice dos projetos: acompanha a mesma dona
  if [ -e "$BASE/shared/projects.js" ]; then
    rm -f "$DEST/projects.js"; ln -s "$BASE/shared/projects.js" "$DEST/projects.js"
  fi
fi

# ── 3. prova que a release ao menos importa antes de trocar o hub ───────────
"$BASE/.venv/bin/python" -m py_compile "$DEST/hubserver.py" \
  || erro "hubserver.py do commit $CURTO nao compila — nada foi trocado"

# ── 4. guarda para onde voltar, ENTAO troca (o symlink e a troca atomica) ───
if [ -L "$BASE/current" ]; then
  basename "$(readlink -f "$BASE/current")" > "$BASE/anterior"
fi
ln -sfn "$DEST" "$BASE/current.novo"
mv -Tf "$BASE/current.novo" "$BASE/current"

# ── 5. reinicia e confere que o hub respondeu de verdade ────────────────────
sudo -n systemctl restart "$SERVICO"
ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -m 3 "http://127.0.0.1:$PORTA/api/index.json" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != 1 ]; then
  echo "!! o hub nao respondeu na porta $PORTA depois do restart"
  if [ ! -s "$BASE/anterior" ]; then
    # primeiro deploy da vida: nao ha para onde voltar, e dizer "o rollback
    # falhou" mandaria procurar defeito no lugar errado.
    erro "primeiro deploy: nao existe release anterior para voltar.
   O codigo de $CURTO esta instalado e o servico esta caido.
   Diagnostico:  journalctl -u $SERVICO -n 50
   Suspeitos:    porta $PORTA ocupada, venv sem as deps (requirements.txt),
                 ou ALTIUMHUB_ALMOX/shared sem os arquivos do item 5 do INSTALL."
  fi
  echo "!! voltando sozinho para a release anterior"
  "$BASE/bin/rollback.sh" || erro "o rollback tambem nao subiu; veja: journalctl -u $SERVICO -n 50"
  erro "deploy de $CURTO revertido. Log: journalctl -u $SERVICO -n 50"
fi

# ── 6. poda releases antigas ────────────────────────────────────────────────
atual=$(basename "$(readlink -f "$BASE/current")")
anterior=$(cat "$BASE/anterior" 2>/dev/null || true)
ls -1dt "$BASE"/releases/*/ 2>/dev/null | tail -n +$((GUARDAR + 1)) | while read -r velha; do
  nome=$(basename "$velha")
  [ "$nome" = "$atual" ] && continue
  [ "$nome" = "$anterior" ] && continue
  rm -rf "$velha"
done

echo "-> no ar: $CURTO   (voltar: $BASE/bin/rollback.sh)"
