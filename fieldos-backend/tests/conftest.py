"""
Test harness for the money paths. Uses an isolated SQLite test DB and drives the FastAPI app
in-process (no server). The DB is reset + reseeded before every test for isolation.
"""
import os

# Env must be set BEFORE importing anything from `app` (config reads it at import time).
os.environ["DB_TYPE"] = "sqlite"
os.environ["SQLITE_PATH"] = "/tmp/fieldos_test.db"
os.environ["SMS_PROVIDER"] = "log"
os.environ["JWT_SECRET_KEY"] = "test-secret-key"
os.environ["ORG_NAME"] = "TestMFI"

import pytest_asyncio
from httpx import AsyncClient, ASGITransport

import app.main  # noqa: F401  — registers all routers + models on Base.metadata
from app.database import Base, engine, AsyncSessionLocal
from app.main import app
from app.models.branch import Branch
from app.models.user import User
from app.models.client import Client
from app.models.loan_account import LoanAccount
from app.services.auth_service import hash_pin


async def _reset_and_seed():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSessionLocal() as s:
        branch = Branch(branch_id="BR-TEST", name="Test Branch", office_ip="127.0.0.1")
        s.add(branch)
        await s.flush()
        s.add_all([
            User(staff_id="FO-208", name="Ram Bahadur Shah", role="field_officer",
                 hashed_pin=hash_pin("1234"), branch_id=branch.id, is_active=True),
            User(staff_id="BM-001", name="Suman Karki", role="branch_manager",
                 hashed_pin=hash_pin("1234"), branch_id=branch.id, is_active=True),
        ])
        client = Client(member_id="M-001", name="Sita Thapa", phone_number="+977-9800000001",
                        outstanding_balance=45000.0, due_amount=2500.0, status="active")
        s.add(client)
        await s.flush()
        # A pending loan for the RBAC approve test.
        s.add(LoanAccount(client_id=client.id, loan_id="LN-M-001-0001", product_type="micro_loan",
                          principal_amount=40000.0, outstanding_balance=0.0, installment_amount=1738.0,
                          installment_frequency="weekly", term_weeks=25, status="pending"))
        await s.commit()


@pytest_asyncio.fixture(autouse=True)
async def seeded_db():
    await _reset_and_seed()
    yield


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def login(client: AsyncClient, staff_id: str, pin: str = "1234") -> str:
    resp = await client.post("/api/v1/auth/login", json={"staff_id": staff_id, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["tokens"]["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
