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
# environment / volume-definition drift. We need new vhosts to be
# picked up + their TLS certs to be provisioned on every deploy.
#
# Strategy:
#   1. Try a hot reload (zero downtime).
#   2. If reload says "config unchanged" or fails, force-recreate the
#      container so Caddy boots fresh and queues ACME provisioning for
#      every named vhost in the Caddyfile.
if docker ps --format '{{.Names}}' | grep -q '^zeroauth-caddy$'; then
  echo "Validating Caddyfile syntax..."
  if ! docker exec zeroauth-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1; then
    echo "Caddyfile is invalid — aborting deploy."
    exit 1
  fi

  echo "Reloading Caddy to pick up Caddyfile changes..."
  reload_out="$(docker exec zeroauth-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1)" || reload_out="$reload_out (rc=$?)"
  echo "$reload_out"

  # Always also force-recreate the container after a deploy. Caddy's
  # hot reload sometimes skips provisioning new vhosts when ACME
  # storage carries a partial/failed record — a fresh boot clears
  # in-process state and re-queues issuance for every name in the
  # Caddyfile. We still keep the volume so existing certs persist.
  echo "Force-recreating zeroauth-caddy so any new vhosts get fresh ACME provisioning..."
  docker compose --profile "$COMPOSE_PROFILE" up -d --force-recreate --no-deps caddy

  # Wait for Caddy to come back, then dump its recent NON-access log
  # so ACME activity actually surfaces in the deploy output. Without
  # the filter the chatty per-request access log drowns the lines we
  # actually need to read.
  sleep 35
  echo "--- caddy logs (excl. access log, last 5min) ---"
  docker logs --since 5m zeroauth-caddy 2>&1 \
    | grep -Ev '"logger":"http\.log\.access' \
    | tail -300 || true
  echo "--- end caddy logs ---"

  echo "--- caddy cert inventory ---"
  docker exec zeroauth-caddy ls /data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/ 2>&1 || true
  echo "--- end cert inventory ---"
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
