"""Tests for the CBS data bridge — client import (upsert) and postings export."""
from httpx import AsyncClient

from tests.conftest import login, auth


async def test_import_clients_upserts(client: AsyncClient):
    mtoken = await login(client, "BM-001")
    # M-001 exists in the seed (outstanding 45000); M-777 is new.
    csv = (
        "member_id,name,phone_number,outstanding_balance,due_amount\n"
        "M-001,Sita Thapa,,60000,3000\n"
        "M-777,New Borrower,+977-9800000777,20000,1200\n"
    )
    resp = await client.post("/api/v1/data/import-clients", headers=auth(mtoken), json={"csv_text": csv})
    assert resp.status_code == 200
    d = resp.json()["data"]
    assert d["created"] == 1        # M-777
    assert d["updated"] == 1        # M-001
    assert d["error_count"] == 0

    # The existing member's balance was refreshed.
    detail = await client.get("/api/v1/clients/1", headers=auth(mtoken))
    assert detail.json()["data"]["outstanding_balance"] == 60000.0


async def test_import_requires_manager(client: AsyncClient):
    ftoken = await login(client, "FO-208")
    resp = await client.post("/api/v1/data/import-clients", headers=auth(ftoken), json={"csv_text": "member_id\nM-1"})
    assert resp.status_code == 403


async def test_postings_export_lists_collections(client: AsyncClient):
    ftoken = await login(client, "FO-208")
    rec = await client.post("/api/v1/collections/", headers=auth(ftoken),
                            json={"client_id": 1, "amount": 2500, "payment_method": "cash"})
    receipt_id = rec.json()["data"]["receipt_id"]

    mtoken = await login(client, "BM-001")
    resp = await client.get("/api/v1/data/postings", headers=auth(mtoken))
    assert resp.status_code == 200
    d = resp.json()["data"]
    assert d["count"] >= 1
    assert receipt_id in d["csv"]
    assert "member_id" in d["csv"].splitlines()[0]   # header present
