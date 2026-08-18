#!/usr/bin/env sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backup_dir="$root_dir/backups"
timestamp=$(date +%Y%m%d-%H%M%S)

umask 077
mkdir -p -m 700 "$backup_dir"

dump_file=$(mktemp "$backup_dir/.tokenhub-$timestamp.XXXXXX.sql")
archive_file=$(mktemp "$backup_dir/.tokenhub-$timestamp.XXXXXX.sql.gz")
final_file="$backup_dir/tokenhub-$timestamp.sql.gz"

cleanup() {
  rm -f "$dump_file" "$archive_file"
}

trap cleanup EXIT HUP INT TERM

cd "$root_dir/deploy"
docker compose exec -T postgres \
  sh -ec 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$dump_file"

gzip -c "$dump_file" > "$archive_file"
mv "$archive_file" "$final_file"
rm -f "$dump_file"
trap - EXIT HUP INT TERM

find "$backup_dir" -type f -name 'tokenhub-*.sql.gz' -mtime +14 -delete
