#!/bin/sh
set -eu
cd "$(dirname "$0")"
umask 077
PROJECT="${COMPOSE_PROJECT_NAME:-tokenhub}"
FILE="${1:-./backups/tokenhub.sql}"
mkdir -p "$(dirname "$FILE")"
tmp="${FILE}.tmp.$$"
trap 'rm -f "$tmp"' EXIT
docker compose -p "$PROJECT" -f compose.yaml exec -T postgres \
  pg_dump -U tokenhub --clean --if-exists tokenhub >"$tmp"
mv "$tmp" "$FILE"
trap - EXIT
echo "wrote $FILE"
