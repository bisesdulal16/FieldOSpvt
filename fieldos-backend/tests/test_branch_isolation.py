"""
Branch isolation — proves the multi-branch pilot boundary holds (migration 008 +
scope_to_branch). A branch manager must NEVER see another branch's money/activity;
an admin sees the consolidated view; a manager with no branch sees nothing (fail-closed).

These are the tests CLAUDE.md hard-rule #5 asks for BEFORE any multi-branch UI: a
missing query-scope is a cross-branch money-data leak.
"""
import pytest
from httpx import AsyncClient

from tests.conftest import login, auth
from app.database import AsyncSessionLocal
from app.models.branch import Branch
from app.models.user import User
from app.models.client import Client
from app.services.auth_service import hash_pin


async def _make_branch_b():
    """Add a SECOND branch (B) with its own officer, manager, and a client.

    The default conftest seed is Branch A (BR-TEST) with FO-208 / BM-001 / client #1.
    We add Branch B alongside it and return the new ids so tests can drive both branches.
    Also add an admin (no branch scoping) to prove the consolidated view.
    """
    async with AsyncSessionLocal() as s:
        branch_b = Branch(branch_id="BR-TEST-B", name="Test Branch B", office_ip="127.0.0.1")
        s.add(branch_b)
        await s.flush()
        s.add_all([
            User(staff_id="FO-B01", name="Bimala Rai", role="field_officer",
                 hashed_pin=hash_pin("1234"), branch_id=branch_b.id, is_active=True),
            User(staff_id="BM-B01", name="Krishna Lama", role="branch_manager",
                 hashed_pin=hash_pin("1234"), branch_id=branch_b.id, is_active=True),
            # Admin/HO: no branch pinning — sees all branches.
            User(staff_id="AD-001", name="HO Admin", role="admin",
                 hashed_pin=hash_pin("1234"), branch_id=None, is_active=True),
            # A branch manager with NO branch assigned — must fail closed (see nothing).
            User(staff_id="BM-NOBR", name="Orphan Manager", role="branch_manager",
                 hashed_pin=hash_pin("1234"), branch_id=None, is_active=True),
        ])
        # NOTE: Client has no branch_id yet (tracked follow-up) — collections carry the
        # branch via the officer, so the client's own branch is irrelevant to these tests.
        client_b = Client(member_id="M-B01", name="Gita Rai (B)", phone_number="+977-9800000099",
                          outstanding_balance=30000.0, due_amount=3000.0, status="active")
        s.add(client_b)
        await s.flush()
        result = {"branch_b_id": branch_b.id, "client_b_id": client_b.id}
        await s.commit()  # AsyncSessionLocal does NOT auto-commit on context exit
        return result


async def _collect(client: AsyncClient, token: str, client_id: int, amount: float):
    body = {"client_id": client_id, "amount": amount, "payment_method": "cash",
            "gps_latitude": 27.7, "gps_longitude": 85.3}
    r = await client.post("/api/v1/collections/", headers=auth(token), json=body)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.asyncio
async def test_manager_sees_only_own_branch_collections(client: AsyncClient):
    """Branch-A manager's collections view must contain A's money and ZERO of B's."""
    ids = await _make_branch_b()

    # Officer A collects on client #1 (branch A); officer B collects on client B.
    a_tok = await login(client, "FO-208")
    await _collect(client, a_tok, 1, 2500)
    b_tok = await login(client, "FO-B01")
    await _collect(client, b_tok, ids["client_b_id"], 1800)

    # Branch-A manager: sees A's 2500, not B's 1800.
    am = await login(client, "BM-001")
    a_view = (await client.get("/api/v1/manager/collections", headers=auth(am))).json()["data"]
    assert a_view["today_collected_npr"] == 2500, a_view
    a_receipts = {r["amount_npr"] for r in a_view["recent"]}
    assert 2500 in a_receipts
    assert 1800 not in a_receipts, "LEAK: Branch A manager saw Branch B's collection"

    # Branch-B manager: mirror image.
    bm = await login(client, "BM-B01")
    b_view = (await client.get("/api/v1/manager/collections", headers=auth(bm))).json()["data"]
    assert b_view["today_collected_npr"] == 1800, b_view
    assert 2500 not in {r["amount_npr"] for r in b_view["recent"]}, "LEAK: B saw A"


@pytest.mark.asyncio
async def test_admin_sees_all_branches(client: AsyncClient):
    """Admin/HO gets the consolidated view: both branches' collections."""
    ids = await _make_branch_b()
    a_tok = await login(client, "FO-208")
    await _collect(client, a_tok, 1, 2500)
    b_tok = await login(client, "FO-B01")
    await _collect(client, b_tok, ids["client_b_id"], 1800)

    admin = await login(client, "AD-001")
    view = (await client.get("/api/v1/manager/collections", headers=auth(admin))).json()["data"]
    assert view["today_collected_npr"] == 2500 + 1800, view
    amounts = {r["amount_npr"] for r in view["recent"]}
    assert {2500, 1800} <= amounts, "Admin should see both branches"


@pytest.mark.asyncio
async def test_manager_without_branch_sees_nothing(client: AsyncClient):
    """Fail-closed: a branch manager with no branch_id must see zero rows, never all."""
    ids = await _make_branch_b()
    a_tok = await login(client, "FO-208")
    await _collect(client, a_tok, 1, 2500)
    b_tok = await login(client, "FO-B01")
    await _collect(client, b_tok, ids["client_b_id"], 1800)

    orphan = await login(client, "BM-NOBR")
    view = (await client.get("/api/v1/manager/collections", headers=auth(orphan))).json()["data"]
    assert view["today_collected_npr"] == 0, "Fail-closed expected: no branch → no rows"
    assert view["recent"] == []


@pytest.mark.asyncio
async def test_dashboard_kpis_are_branch_scoped(client: AsyncClient):
    """Dashboard collection/visit KPIs are per-branch for a manager, consolidated for admin."""
    ids = await _make_branch_b()
    a_tok = await login(client, "FO-208")
    await _collect(client, a_tok, 1, 2500)
    b_tok = await login(client, "FO-B01")
    await _collect(client, b_tok, ids["client_b_id"], 1800)

    am = await login(client, "BM-001")
    a_dash = (await client.get("/api/v1/manager/dashboard", headers=auth(am))).json()["data"]
    assert a_dash["collections_total_npr"] == 2500, a_dash

    admin = await login(client, "AD-001")
    ad_dash = (await client.get("/api/v1/manager/dashboard", headers=auth(admin))).json()["data"]
    assert ad_dash["collections_total_npr"] == 2500 + 1800, ad_dash


@pytest.mark.asyncio
async def test_officer_activity_cross_branch_guard(client: AsyncClient):
    """A branch manager cannot pull an officer from another branch by id (404)."""
    await _make_branch_b()
    # Resolve Branch B officer's id.
    async with AsyncSessionLocal() as s:
        from sqlalchemy import select
        fob = (await s.execute(select(User).where(User.staff_id == "FO-B01"))).scalar_one()
        fob_id = fob.id

    am = await login(client, "BM-001")  # Branch A manager
    resp = await client.get(f"/api/v1/manager/officer-activity?officer_id={fob_id}", headers=auth(am))
    assert resp.status_code == 404, "Branch A manager must not read Branch B officer's activity"

    # Admin can.
    admin = await login(client, "AD-001")
    resp2 = await client.get(f"/api/v1/manager/officer-activity?officer_id={fob_id}", headers=auth(admin))
    assert resp2.status_code == 200, resp2.text
