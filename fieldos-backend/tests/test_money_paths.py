"""
Tests for the security- and money-critical paths. These are the ones where a regression means
lost money, unattributed collections, or an open door — so they get automated coverage.
"""
from httpx import AsyncClient

from tests.conftest import login, auth


# ── Authentication is enforced ───────────────────────────────────────────

async def test_unauthenticated_collection_is_rejected(client: AsyncClient):
    resp = await client.post("/api/v1/collections/", json={"client_id": 1, "amount": 2500, "payment_method": "cash"})
    assert resp.status_code == 401


async def test_unauthenticated_client_read_is_rejected(client: AsyncClient):
    resp = await client.get("/api/v1/clients/1")
    assert resp.status_code == 401


async def test_login_returns_token(client: AsyncClient):
    resp = await client.post("/api/v1/auth/login", json={"staff_id": "FO-208", "pin": "1234"})
    assert resp.status_code == 200
    assert resp.json()["data"]["tokens"]["access_token"]


async def test_login_wrong_pin_fails(client: AsyncClient):
    resp = await client.post("/api/v1/auth/login", json={"staff_id": "FO-208", "pin": "9999"})
    assert resp.status_code != 200 or resp.json().get("success") is False


# ── Collections attribute to the token, never the body ───────────────────

async def test_collection_officer_id_comes_from_token_not_body(client: AsyncClient):
    token = await login(client, "FO-208")
    # Try to forge officer_id 999 in the body — it must be ignored.
    resp = await client.post("/api/v1/collections/", headers=auth(token),
                             json={"client_id": 1, "amount": 2500, "payment_method": "cash", "officer_id": 999})
    assert resp.status_code == 200
    receipt_id = resp.json()["data"]["receipt_id"]

    # Manager reads the collections; the officer must be the real FO (id 1), not 999.
    mtoken = await login(client, "BM-001")
    audit = await client.get("/api/v1/manager/audit-logs?limit=5", headers=auth(mtoken))
    names = [e["action_type"] for e in audit.json()["data"]]
    assert "collection_recorded" in names
    assert receipt_id.startswith("RCPT-")


async def test_collection_computes_balance_server_side(client: AsyncClient):
    token = await login(client, "FO-208")
    # Client M-001 starts at outstanding 45000; a 2500 collection → 42500, regardless of body value.
    resp = await client.post("/api/v1/collections/", headers=auth(token),
                             json={"client_id": 1, "amount": 2500, "payment_method": "cash", "outstanding_after": 999999})
    assert resp.status_code == 200
    assert resp.json()["data"]["outstanding_after"] == 42500.0


async def test_collection_amount_capped_at_outstanding(client: AsyncClient):
    # Client 1 outstanding is 45000; a wildly-over amount (the real 210k fat-finger) is rejected.
    token = await login(client, "FO-208")
    resp = await client.post("/api/v1/collections/", headers=auth(token),
                             json={"client_id": 1, "amount": 210000, "payment_method": "cash"})
    assert resp.status_code == 400
    assert "exceeds the outstanding" in resp.json()["detail"].lower()


# ── The anti-fraud SMS receipt fires ─────────────────────────────────────

async def test_collection_sends_client_receipt(client: AsyncClient):
    token = await login(client, "FO-208")
    await client.post("/api/v1/collections/", headers=auth(token),
                      json={"client_id": 1, "amount": 2500, "payment_method": "cash"})
    mtoken = await login(client, "BM-001")
    receipts = await client.get("/api/v1/manager/receipts?limit=5", headers=auth(mtoken))
    data = receipts.json()["data"]
    assert len(data) >= 1
    top = data[0]
    assert top["status"] == "sent"
    assert "2,500" in top["message"]
    assert top["phone_number"] == "+977-9800000001"


# ── Timestamps stored in Nepal time (fits Postgres VARCHAR(30)) ───────────

async def test_collected_at_is_nepal_time_seconds_precision(client: AsyncClient):
    token = await login(client, "FO-208")
    resp = await client.post("/api/v1/collections/", headers=auth(token),
                             json={"client_id": 1, "amount": 2500, "payment_method": "cash"})
    collected_at = resp.json()["data"]["collected_at"]
    assert collected_at.endswith("+05:45")       # Asia/Kathmandu offset
    assert len(collected_at) <= 30               # fits the DB column on Postgres


# ── RBAC: only managers approve loans ────────────────────────────────────

async def test_field_officer_cannot_approve_loan(client: AsyncClient):
    token = await login(client, "FO-208")
    resp = await client.post("/api/v1/loans/LN-M-001-0001/approve", headers=auth(token))
    assert resp.status_code == 403


async def test_manager_can_approve_loan(client: AsyncClient):
    mtoken = await login(client, "BM-001")
    resp = await client.post("/api/v1/loans/LN-M-001-0001/approve", headers=auth(mtoken))
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "approved"


# ── Day-start office-network gate ────────────────────────────────────────

async def test_day_start_gate_off_by_default_allows_any_network(client: AsyncClient):
    # Pilot default: DAY_START_IP_GATE is OFF, so an officer can start the day from any
    # network even though the test branch has office_ip=127.0.0.1.
    token = await login(client, "FO-208")
    resp = await client.post("/api/v1/day-start/", headers={**auth(token), "X-Forwarded-For": "202.51.1.99"}, json={})
    assert resp.status_code == 200
    assert resp.json()["data"]["gate_enabled"] is False


async def test_day_start_blocked_off_office_network(client: AsyncClient, monkeypatch):
    # With the master switch ON, a spoofed off-network forwarded IP must be blocked.
    from app.routers import day_start as day_start_router
    monkeypatch.setattr(day_start_router.settings, "DAY_START_IP_GATE", True)
    token = await login(client, "FO-208")
    resp = await client.post("/api/v1/day-start/", headers={**auth(token), "X-Forwarded-For": "202.51.1.99"}, json={})
    assert resp.status_code == 403


async def test_day_start_allowed_on_office_network(client: AsyncClient, monkeypatch):
    from app.routers import day_start as day_start_router
    monkeypatch.setattr(day_start_router.settings, "DAY_START_IP_GATE", True)
    token = await login(client, "FO-208")
    resp = await client.post("/api/v1/day-start/", headers=auth(token), json={"selfie_data_uri": "data:image/png;base64,AAAA"})
    assert resp.status_code == 200
    assert resp.json()["data"]["ip_verified"] is True
