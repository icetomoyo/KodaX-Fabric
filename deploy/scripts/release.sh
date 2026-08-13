#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/compose.yaml}"
TAG="${IMAGE_TAG:-}"
CHECK="${1:-}"

require_immutable_tag() {
  tag=$1
  [ -n "$tag" ] || { echo "IMAGE_TAG is required (immutable, not latest)" >&2; exit 2; }
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
if [ "$CHECK" = "--check" ] || [ "$CHECK" = "--dry-run" ]; then
  docker compose -f "$COMPOSE_FILE" config >/dev/null
  echo "release check ok IMAGE_TAG=$TAG"
  exit 0
fi
export IMAGE_TAG="$TAG"
docker compose -f "$COMPOSE_FILE" build --build-arg VERSION=v0.1.0 --build-arg GIT_COMMIT="${GIT_COMMIT:-unknown}"
docker compose -f "$COMPOSE_FILE" up -d --wait --remove-orphans
"$ROOT/deploy/scripts/smoke.sh" "$(smoke_base)"
echo "release ok $TAG"
