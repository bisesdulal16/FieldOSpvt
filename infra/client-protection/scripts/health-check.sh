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
if $COMPOSE run --rm --no-deps outbox-publisher python - <<'PY' >/dev/null 2>&1
import socket
for host, port in [('rabbitmq', 5672), ('redis', 6379)]:
    s = socket.create_connection((host, port), timeout=5)
    s.close()
PY
then
  echo "worker-network: rabbitmq and redis reachable"
else
  echo "worker-network: reachability check skipped or failed"
fi
