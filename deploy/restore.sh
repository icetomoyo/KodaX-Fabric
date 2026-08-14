#!/bin/sh
set -eu
cd "$(dirname "$0")"
PROJECT="${COMPOSE_PROJECT_NAME:-tokenhub}"
FILE="${1:?usage: restore.sh dump.sql}"
[ -f "$FILE" ] || {
	echo "missing dump: $FILE" >&2
	exit 1
}
started=0
cleanup() {
	if [ "$started" = 1 ]; then
		docker compose -p "$PROJECT" -f compose.yaml start gateway || true
	fi
}
trap cleanup EXIT
docker compose -p "$PROJECT" -f compose.yaml stop gateway
started=1
docker compose -p "$PROJECT" -f compose.yaml exec -T postgres \
  psql -U tokenhub -d tokenhub -v ON_ERROR_STOP=1 <"$FILE"
docker compose -p "$PROJECT" -f compose.yaml start gateway
started=0
trap - EXIT
echo "restored $FILE"
