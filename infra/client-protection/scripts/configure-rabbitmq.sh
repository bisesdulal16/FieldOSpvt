#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE=${COMPOSE_FILE:-infra/client-protection/compose.yml}
VHOST=${FIELDOS_RABBITMQ_VHOST:-/fieldos}
USER=${FIELDOS_RABBITMQ_USER:-fieldos}
PASSWORD=${FIELDOS_RABBITMQ_PASSWORD:?set FIELDOS_RABBITMQ_PASSWORD}
CONFIGURE_REGEX=${FIELDOS_RABBITMQ_CONFIGURE_REGEX:-'^fieldos\.communication.*'}
WRITE_REGEX=${FIELDOS_RABBITMQ_WRITE_REGEX:-'^fieldos\.communication.*'}
READ_REGEX=${FIELDOS_RABBITMQ_READ_REGEX:-'^fieldos\.communication.*'}

compose() {
  if [[ -n "${COMPOSE:-}" ]]; then
    # shellcheck disable=SC2086 # COMPOSE is an operator-supplied docker compose command string.
    $COMPOSE "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

# Run after rabbitmq is healthy. Topology is loaded automatically from
# rabbitmq.conf/definitions.json; this script creates/tightens the runtime
# secret-bearing dedicated user without committing credentials.
compose exec -T rabbitmq rabbitmqctl add_vhost "$VHOST" 2>/dev/null || true
if compose exec -T rabbitmq rabbitmqctl list_users | awk '{print $1}' | grep -Fxq "$USER"; then
  compose exec -T rabbitmq rabbitmqctl change_password "$USER" "$PASSWORD"
else
  compose exec -T rabbitmq rabbitmqctl add_user "$USER" "$PASSWORD"
fi
compose exec -T rabbitmq rabbitmqctl set_permissions -p "$VHOST" "$USER" "$CONFIGURE_REGEX" "$WRITE_REGEX" "$READ_REGEX"
compose exec -T rabbitmq rabbitmqctl set_user_tags "$USER"
