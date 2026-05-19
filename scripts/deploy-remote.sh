#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/zeroauth}"
APP_URL="${APP_URL:-https://zeroauth.dev}"
COMPOSE_PROFILE="${COMPOSE_PROFILE:-prod}"
HEALTHCHECK_ATTEMPTS="${HEALTHCHECK_ATTEMPTS:-30}"
HEALTHCHECK_SLEEP_SECONDS="${HEALTHCHECK_SLEEP_SECONDS:-5}"

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  echo "Missing $APP_DIR/.env"
  exit 1
fi

echo "Validating compose configuration..."
docker compose --profile "$COMPOSE_PROFILE" config >/dev/null

echo "Deploying ZeroAuth with Docker Compose..."
docker compose --profile "$COMPOSE_PROFILE" up -d --build --remove-orphans

# `up -d --build` does NOT restart a service when only its bind-mounted
# files (e.g. Caddyfile) changed — Docker only recreates on image /
# environment / volume-definition drift. Force an explicit Caddy reload
# so config changes land on every deploy. Idempotent + fast (~2s).
if docker ps --format '{{.Names}}' | grep -q '^zeroauth-caddy$'; then
  echo "Reloading Caddy to pick up Caddyfile changes..."
  docker exec zeroauth-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile \
    || docker restart zeroauth-caddy

  # Give Caddy a moment to provision certs for any new vhosts, then dump
  # its recent log so ACME failures land in the deploy output instead of
  # silently hiding inside the container.
  sleep 25
  echo "--- caddy logs (last 200 lines) ---"
  docker logs --tail 200 zeroauth-caddy 2>&1 || true
  echo "--- end caddy logs ---"
fi

echo "Waiting for zeroauth-prod health check..."
attempt=1
while [[ $attempt -le $HEALTHCHECK_ATTEMPTS ]]; do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' zeroauth-prod 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    break
  fi

  if [[ "$status" == "unhealthy" ]]; then
    echo "Container reported unhealthy status."
    docker logs --tail 100 zeroauth-prod || true
  fi

  echo "Attempt $attempt/$HEALTHCHECK_ATTEMPTS: zeroauth-prod status = ${status:-missing}"
  sleep "$HEALTHCHECK_SLEEP_SECONDS"
  attempt=$((attempt + 1))
done

final_status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' zeroauth-prod 2>/dev/null || true)"
if [[ "$final_status" != "healthy" ]]; then
  echo "Deployment failed: zeroauth-prod never became healthy."
  docker compose ps
  docker logs --tail 200 zeroauth-prod || true
  exit 1
fi

echo "Running public health check..."
curl --fail --silent --show-error "$APP_URL/api/health" >/dev/null

echo "Pruning dangling images..."
docker image prune -f >/dev/null || true

echo "Deployment complete."
