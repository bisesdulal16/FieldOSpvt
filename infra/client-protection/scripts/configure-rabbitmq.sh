#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE=${COMPOSE_FILE:-infra/client-protection/compose.yml}
VHOST=${FIELDOS_RABBITMQ_VHOST:-/fieldos}
USER=${FIELDOS_RABBITMQ_USER:-fieldos}
CONFIGURE_REGEX=${FIELDOS_RABBITMQ_CONFIGURE_REGEX:-'^fieldos\.communication.*'}
WRITE_REGEX=${FIELDOS_RABBITMQ_WRITE_REGEX:-'^fieldos\.communication.*'}
READ_REGEX=${FIELDOS_RABBITMQ_READ_REGEX:-'^fieldos\.communication.*'}

# Run after rabbitmq is healthy. Keeps the dedicated FieldOS user out of administrator mode
# and restricts it to FieldOS communication exchanges/queues only.
docker compose -f "$COMPOSE_FILE" exec -T rabbitmq rabbitmqctl set_permissions -p "$VHOST" "$USER" "$CONFIGURE_REGEX" "$WRITE_REGEX" "$READ_REGEX"
docker compose -f "$COMPOSE_FILE" exec -T rabbitmq rabbitmqctl set_user_tags "$USER"
