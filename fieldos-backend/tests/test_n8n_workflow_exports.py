import json
import re
from pathlib import Path

WORKFLOW_DIR = Path(__file__).resolve().parents[2] / "n8n" / "workflows"
EXPECTED = {
    "client-protection-dispute-escalation.json",
    "client-protection-failed-delivery.json",
    "client-protection-daily-report.json",
    "client-protection-random-sampling.json",
    "client-protection-manager-callback.json",
    "client-protection-provider-outage.json",
}
FORBIDDEN_PATTERNS = [
    re.compile(r"\+977[- ]?\d{10}"),
    re.compile(r"https?://(?!\{\{\$env\.FIELDOS_API_BASE_URL\}\})[A-Za-z0-9_.:-]+"),
    re.compile(r"(?i)(api[_-]?key|shared[_-]?secret|password|bearer\s+[a-z0-9])"),
]


def _workflow_texts():
    return {path.name: path.read_text() for path in WORKFLOW_DIR.glob("*.json")}


def test_phase7_workflow_exports_are_valid_json_and_expected_files_exist():
    texts = _workflow_texts()
    assert EXPECTED.issubset(set(texts))
    for name in EXPECTED:
        parsed = json.loads(texts[name])
        assert parsed["active"] is False
        assert parsed["nodes"]
        assert parsed["connections"]


def test_phase7_workflow_exports_have_required_nodes_idempotency_error_and_bounded_retry():
    for name, text in _workflow_texts().items():
        if name not in EXPECTED:
            continue
        parsed = json.loads(text)
        node_names = {node["name"] for node in parsed["nodes"]}
        assert "Trigger - placeholder only" in node_names
        assert "Build idempotency key and safe payload" in node_names
        assert "Call FieldOS integration API" in node_names
        assert "Error response" in node_names
        assert "Bounded retry wait" in node_names
        assert "idempotency_key" in text
        assert "maxTries" in text
        assert "n8n:" in text


def test_phase7_workflow_exports_have_no_credentials_phone_or_production_urls():
    for name, text in _workflow_texts().items():
        if name not in EXPECTED:
            continue
        for pattern in FORBIDDEN_PATTERNS:
            assert not pattern.search(text), f"{name} matched {pattern.pattern}"
        assert "PLACEHOLDER" in text
        assert "FIELDOS_API_BASE_URL" in text
        assert "{{$json.url" not in text
        assert "{{$json.webhook" not in text
        assert "postgres" not in text.lower()
        assert "mysql" not in text.lower()
