#!/bin/bash
# Volta o hub para a release anterior. Segundos, sem git e sem rede.
#
#     /srv/altiumhub/bin/rollback.sh            # volta uma
#     /srv/altiumhub/bin/rollback.sh <hash>     # volta para uma release especifica
#
# So o CODIGO volta. Os dados moram em shared/ e nao andam para tras — e
# proposital: voltar o hub por causa de um bug nao pode desfazer o changes.js
# que alguem salvou meia hora atras, nem o board.js que o Altium exportou.
set -euo pipefail

BASE=${ALTIUMHUB_BASE:-/srv/altiumhub}
PORTA=${ALTIUMHUB_PORTA:-8100}

erro() { echo "!! $*" >&2; exit 1; }
dc()   { docker compose --project-directory "$BASE" -f "$BASE/compose.yml" "$@"; }

alvo=${1:-$(cat "$BASE/anterior" 2>/dev/null || true)}
[ -n "$alvo" ] || erro "nao ha release anterior registrada em $BASE/anterior"
[ -d "$BASE/releases/$alvo" ] || erro "release $alvo nao esta em $BASE/releases (ficam as mais recentes)"

atual=$(basename "$(readlink -f "$BASE/current")" 2>/dev/null || echo '-')
echo "-> voltando de $atual para $alvo"

echo "$atual" > "$BASE/anterior"          # rollback do rollback volta para onde estavamos
ln -sfn "$BASE/releases/$alvo" "$BASE/current.novo"
mv -Tf "$BASE/current.novo" "$BASE/current"

# o compose.yml tambem e versionado: volte o dele junto com o codigo
if [ -f "$BASE/releases/$alvo/tools/deploy/compose.yml" ]; then
  cp -f "$BASE/releases/$alvo/tools/deploy/compose.yml" "$BASE/compose.yml"
fi

dc up -d --force-recreate

for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS -m 5 "http://127.0.0.1:$PORTA/api/index.json" >/dev/null 2>&1; then
    echo "-> no ar: $alvo"
    exit 0
  fi
  sleep 2
done
erro "$alvo tambem nao responde na porta $PORTA. docker compose -f $BASE/compose.yml logs --tail 60"
