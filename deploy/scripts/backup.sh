#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/compose.yaml}"
OUTDIR="${BACKUP_DIR:-$ROOT/var/backups}"
# Restrict new files/dirs before creating them.
umask 077
mkdir -p "$OUTDIR"
ts=$(date -u +%Y%m%d-%H%M%S)
out="$OUTDIR/tokenhub-$ts.sql.gz"
partial="$OUTDIR/tokenhub-$ts.sql.gz.partial"
sql_partial="$OUTDIR/tokenhub-$ts.sql.partial"
# Only allow writing under the chosen backup dir.
case "$out" in
  "$OUTDIR"/*) ;;
  *) echo "refusing dest $out" >&2; exit 2 ;;
esac

cleanup() {
  rm -f "$partial" "$sql_partial"
}
trap cleanup EXIT INT TERM HUP

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U tokenhub -d tokenhub --no-owner --no-privileges > "$sql_partial"
[ -s "$sql_partial" ] || { echo "empty dump" >&2; exit 1; }
gzip -c "$sql_partial" > "$partial"
rm -f "$sql_partial"
[ -s "$partial" ] || { echo "empty gzip" >&2; exit 1; }
gzip -t "$partial"
chmod 600 "$partial"
mv -f "$partial" "$out"
trap - EXIT INT TERM HUP
echo "$out"
