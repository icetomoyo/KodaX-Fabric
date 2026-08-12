#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$root/backups"
out="$root/backups/tokenhub-$(date +%Y%m%d-%H%M%S).sql.gz"
export DOCKER_HOST="${DOCKER_HOST:-unix:///Users/zhangchuang/.colima/default/docker.sock}"
docker compose -p tokenhub-goal -f "$root/deploy/compose.yaml" exec -T postgres \
  pg_dump -U tokenhub tokenhub | gzip > "$out"
echo "$out"
