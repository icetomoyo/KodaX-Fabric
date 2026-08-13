#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/compose.yaml}"
ARCHIVE="${1:-}"
CONFIRM="${2:-}"
[ -n "$ARCHIVE" ] || { echo "usage: restore.sh <archive.sql.gz> YES" >&2; exit 2; }
[ -f "$ARCHIVE" ] || { echo "missing archive" >&2; exit 2; }
[ "$CONFIRM" = "YES" ] || { echo "refusing restore without YES" >&2; exit 2; }
gzip -t "$ARCHIVE"
# Destructive: replaces public schema of tokenhub.
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U tokenhub -d tokenhub -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gzip -dc "$ARCHIVE" | docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U tokenhub -d tokenhub -v ON_ERROR_STOP=1
echo "restore ok"
