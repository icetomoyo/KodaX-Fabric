#!/usr/bin/env sh
set -eu

: "${SEED_ADMIN_NAME:=管理员}"
: "${SEED_ADMIN_PHONE:?Set the initial admin phone number}"
: "${SEED_ADMIN_PASSWORD:?Set the initial admin password}"

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root_dir/deploy"

exec docker compose run --rm --no-deps \
  -e "SEED_ADMIN_NAME=$SEED_ADMIN_NAME" \
  -e "SEED_ADMIN_PHONE=$SEED_ADMIN_PHONE" \
  -e "SEED_ADMIN_PASSWORD=$SEED_ADMIN_PASSWORD" \
  api sh -ec 'node server/dist/db/migrate.js && node server/dist/db/seed.js'
