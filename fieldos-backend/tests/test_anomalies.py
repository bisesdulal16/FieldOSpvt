"""Tests for cash reconciliation and the anomaly-detection rules."""
from httpx import AsyncClient

from tests.conftest import login, auth


async def _collect(client, token, client_id, amount, method="cash", gps=False):
    body = {"client_id": client_id, "amount": amount, "payment_method": method}
    if gps:
        body["gps_latitude"] = 27.69
        body["gps_longitude"] = 85.28
    return await client.post("/api/v1/collections/", headers=auth(token), json=body)


async def test_cash_reconciliation_splits_cash_and_digital(client: AsyncClient):
    token = await login(client, "FO-208")
    await _collect(client, token, 1, 2500, "cash", gps=True)
    await _collect(client, token, 1, 500, "esewa", gps=True)

    mtoken = await login(client, "BM-001")
    resp = await client.get("/api/v1/manager/cash-reconciliation", headers=auth(mtoken))
    assert resp.status_code == 200
    ram = next(o for o in resp.json()["data"] if o["staff_id"] == "FO-208")
    assert ram["total_npr"] == 3000.0
    assert ram["cash_npr"] == 2500.0      # physical cash the officer should hold
    assert ram["digital_npr"] == 500.0


async def test_anomaly_collection_without_visit(client: AsyncClient):
    token = await login(client, "FO-208")
    # Collection with GPS but no visit check-in for this client today.
    await _collect(client, token, 1, 2500, "cash", gps=True)

    mtoken = await login(client, "BM-001")
    resp = await client.get("/api/v1/manager/anomalies", headers=auth(mtoken))
    types = [f["type"] for f in resp.json()["data"]]
    assert "collection_without_visit" in types


async def test_anomaly_collection_without_gps(client: AsyncClient):
    token = await login(client, "FO-208")
    await _collect(client, token, 1, 2500, "cash", gps=False)

    mtoken = await login(client, "BM-001")
    resp = await client.get("/api/v1/manager/anomalies", headers=auth(mtoken))
    flags = resp.json()["data"]
    assert any(f["type"] == "collection_without_gps" for f in flags)
    # high-severity flags sort first
    assert flags[0]["severity"] == "high"


async def test_no_anomalies_when_clean(client: AsyncClient):
    """A collection WITH gps AND a prior visit check-in should raise no flags for that client."""
    token = await login(client, "FO-208")
    # Record a visit first, then a GPS collection for the same client.
    await client.post("/api/v1/visit-checkins/", headers=auth(token),
                      json={"client_id": 1, "gps_latitude": 27.69, "gps_longitude": 85.28, "purpose": "collection"})
    await _collect(client, token, 1, 2500, "cash", gps=True)

    mtoken = await login(client, "BM-001")
    resp = await client.get("/api/v1/manager/anomalies", headers=auth(mtoken))
    for f in resp.json()["data"]:
        assert f["type"] not in ("collection_without_visit", "collection_without_gps")
