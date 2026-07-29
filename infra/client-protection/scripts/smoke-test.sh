#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
echo "Phase 8 smoke test plan (no real SMS):"
echo "1. docker compose -f infra/client-protection/compose.yml up -d rabbitmq redis"
echo "2. export COMMUNICATION_DISPATCH_MODE=rabbitmq RABBITMQ_ENABLED=true REDIS_ENABLED=true N8N_REPLAY_STORE=redis"
echo "3. python -m app.workers.communication_publisher --once --worker-id smoke-publisher"
echo "4. python -m app.workers.communication_consumer --queue sms --once --worker-id smoke-consumer"
echo "5. pytest -q tests/test_communication_broker_phase8.py tests/test_n8n_replay_store.py"
echo "This script intentionally prints commands only; starting containers requires separate approval."
