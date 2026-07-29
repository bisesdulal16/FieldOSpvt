#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE="${COMPOSE:-docker compose -f compose.yml}"
$COMPOSE config >/dev/null
$COMPOSE ps
if $COMPOSE exec -T rabbitmq rabbitmq-diagnostics -q ping >/dev/null 2>&1; then
  echo "rabbitmq: reachable"
else
  echo "rabbitmq: not reachable"
fi
if $COMPOSE exec -T redis redis-cli -a "${FIELDOS_REDIS_PASSWORD:-}" ping 2>/dev/null | grep -q PONG; then
  echo "redis: reachable"
else
  echo "redis: not reachable"
fi
