#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/compose.yaml}"
TAG="${1:-}"

require_immutable_tag() {
  tag=$1
  [ -n "$tag" ] || { echo "usage: rollback.sh <old-immutable-image-tag>" >&2; exit 2; }
  case "$tag" in
    *:*) ;;
    *) echo "refusing tag without colon: $tag" >&2; exit 2 ;;
  esac
  case "$tag" in
    *:latest|latest) echo "refusing latest tag" >&2; exit 2 ;;
  esac
}

smoke_base() {
  if [ -n "${BASE_URL:-}" ]; then
    printf '%s\n' "$BASE_URL"
  else
    printf 'http://127.0.0.1:%s\n' "${GATEWAY_PORT:-3000}"
  fi
}

require_immutable_tag "$TAG"
if [ "${2:-}" = "--check" ] || [ "${2:-}" = "--dry-run" ]; then
  echo "rollback would set IMAGE_TAG=$TAG and compose up --wait"
  exit 0
fi
export IMAGE_TAG="$TAG"
docker compose -f "$COMPOSE_FILE" up -d --wait --no-build
"$ROOT/deploy/scripts/smoke.sh" "$(smoke_base)" || {
  echo "rollback smoke failed; previous containers left running" >&2
  exit 1
}
echo "rollback ok $TAG"
