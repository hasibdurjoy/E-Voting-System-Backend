#!/usr/bin/env bash
#
# Server-side deployment, invoked over SSH by CI:
#
#     bash deploy-docker.sh <image-tag>
#
# Deployments are immutable: the tag is a commit SHA, so rolling back means starting the
# previous tag again. The previous tag is recorded before anything changes.
#
# It never writes .env — the relayer key, JWT secret and NID pepper are managed on the
# server and never travel through CI.

set -euo pipefail

NEW_TAG="${1:-}"
if [[ -z "$NEW_TAG" ]]; then
  echo "Usage: bash deploy-docker.sh <image-tag>" >&2
  exit 1
fi

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "No .env on the server — refusing to deploy a backend that cannot start." >&2
  exit 1
fi

PREVIOUS_TAG="$(cat .current-tag 2>/dev/null || echo '')"
echo "Deploying $NEW_TAG (current: ${PREVIOUS_TAG:-none})"

PORT="$(grep -E '^PORT=' .env | cut -d= -f2 | tr -d '[:space:]' || true)"
PORT="${PORT:-5000}"

health_ok() {
  for _ in $(seq 1 20); do
    if curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/api/health" | grep -q '"success":true'; then
      return 0
    fi
    sleep 3
  done
  return 1
}

start() {
  IMAGE_TAG="$1" docker compose up -d --remove-orphans
}

IMAGE_TAG="$NEW_TAG" docker compose pull backend
start "$NEW_TAG"

if health_ok; then
  echo "$NEW_TAG" > .current-tag
else
  echo "::error:: New image failed its health check." >&2
  docker compose logs --tail 80 backend || true

  if [[ -n "$PREVIOUS_TAG" ]]; then
    echo "Rolling back to $PREVIOUS_TAG"
    start "$PREVIOUS_TAG"
    health_ok && echo "Rollback succeeded" || echo "::error:: Rollback also failed — the service is down." >&2
  else
    echo "::error:: No previous tag recorded, so there is nothing to roll back to." >&2
  fi
  exit 1
fi

# The relayer is useless without its role; say so rather than letting the first voter
# discover it.
if ! curl -fsS --max-time 15 "http://127.0.0.1:${PORT}/api/blockchain/status" | grep -q '"relayerAuthorized":true'; then
  echo "WARNING: the backend signer does not hold RELAYER_ROLE — every write will revert." >&2
  echo "Run grant:roles:sepolia in the contracts repository against the deployed contract." >&2
fi

# Keep the last few images; drop the rest so the droplet's disk does not fill up.
docker image prune -f --filter 'until=168h' >/dev/null 2>&1 || true

echo "Deployed $NEW_TAG successfully"
