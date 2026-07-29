#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
echo "Phase 8 smoke test plan (no real SMS):"
echo "1. Create/use an explicit FieldOS application network; do not join n8n networks."
echo "2. docker compose -f infra/client-protection/compose.yml up -d rabbitmq redis"
echo "3. infra/client-protection/scripts/configure-rabbitmq.sh"
echo "4. Verify worker reachability: python socket checks for rabbitmq:5672 and redis:6379 from worker container."
echo "5. export COMMUNICATION_DISPATCH_MODE=rabbitmq RABBITMQ_ENABLED=true REDIS_ENABLED=true N8N_REPLAY_STORE=redis N8N_REPLAY_TTL_SECONDS=330"
echo "6. python -m app.workers.communication_publisher --once --worker-id smoke-publisher"
echo "7. python -m app.workers.communication_consumer --queue sms --once --worker-id smoke-consumer"
echo "8. pytest -q tests/test_communication_broker_phase8.py tests/test_n8n_replay_store.py"
echo "This script intentionally prints commands only; starting containers requires separate approval."
