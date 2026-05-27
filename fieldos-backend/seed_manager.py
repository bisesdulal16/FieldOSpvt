"""
Seed script for Manager Dashboard demo data.

Run independently after the base seed:
    cd backend
    python seed_manager.py

Creates:
  - 5 additional staff (1 branch manager + 4 field officers)
  - 28 new clients across 5 centers
  - Loan accounts for all new clients
  - 6 devices (one per staff)
  - ~28 tasks for today
  - ~23 visit check-ins for today
  - ~18 collections for today + historical data for the past 6 days
  - 7 promise-to-pay records
  - 4 end-of-day reports
  - 10 audit log entries
  - 20 sync events (mix of statuses)
"""
import asyncio
import json
import logging
import uuid
from datetime import date, timedelta, datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import engine, Base, AsyncSessionLocal
from app.models.branch import Branch
from app.models.user import User
from app.models.client import Client
from app.models.loan_account import LoanAccount
from app.models.task import TaskAssignment
from app.models.visit_checkin import VisitCheckin
from app.models.collection import Collection
from app.models.promise_to_pay import PromiseToPay
from app.models.end_of_day import EndOfDayReport
from app.models.sync_event import SyncEvent
from app.models.audit_log import AuditLog
from app.models.device import Device
from app.services.auth_service import hash_pin

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TODAY = date.today()
TODAY_STR = str(TODAY)
NOW_UTC = datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Data definitions
# ---------------------------------------------------------------------------

NEW_STAFF = [
    {
        "staff_id": "BM-001",
        "name": "Rajesh Kumar Shrestha",
        "name_ne": "राजेश कुमार श्रेष्ठ",
        "role": "branch_manager",
        "phone": "+977-9841111111",
    },
    {
        "staff_id": "FO-201",
        "name": "Shyam Kumar Rai",
        "name_ne": "श्याम कुमार राई",
        "role": "field_officer",
        "phone": "+977-9841234001",
    },
    {
        "staff_id": "FO-202",
        "name": "Sunita Lama",
        "name_ne": "सुनिता लामा",
        "role": "field_officer",
        "phone": "+977-9841234002",
    },
    {
        "staff_id": "FO-203",
        "name": "Bijaya Gurung",
        "name_ne": "बिजय गुरुङ",
        "role": "field_officer",
        "phone": "+977-9841234003",
    },
    {
        "staff_id": "FO-204",
        "name": "Anita Thapa Magar",
        "name_ne": "अनिता थापा मगर",
        "role": "field_officer",
        "phone": "+977-9841234004",
    },
]

# Each officer gets clients from their assigned centers
# FO-208 already has CTR-001, CTR-002, CTR-003 clients
# New officers get:
#   FO-201: CTR-001, CTR-004
#   FO-202: CTR-002, CTR-004
#   FO-203: CTR-003, CTR-005
#   FO-204: CTR-005, CTR-001

NEW_CLIENTS = [
    # FO-201 clients
    {"member_id": "M-007", "name": "Dil Maya Tamang", "name_ne": "दिलमाया तामाङ", "center_id": "CTR-001", "center_name": "Kalanki Center", "ward": "12", "loan_cycle": 2, "outstanding": 22000, "due": 1200, "overdue": 0},
    {"member_id": "M-008", "name": "Nirmala Devi Pokharel", "name_ne": "निर्मला देवी पोखरेल", "center_id": "CTR-001", "center_name": "Kalanki Center", "ward": "12", "loan_cycle": 4, "outstanding": 55000, "due": 3500, "overdue": 5},
    {"member_id": "M-009", "name": "Bishnu Maya KC", "name_ne": "विष्णुमाया केसी", "center_id": "CTR-004", "center_name": "Thamel Center", "ward": "26", "loan_cycle": 3, "outstanding": 38000, "due": 2100, "overdue": 0},
    {"member_id": "M-010", "name": "Srijana Syangtan", "name_ne": "श्रीजना स्याङ्तान", "center_id": "CTR-004", "center_name": "Thamel Center", "ward": "26", "loan_cycle": 1, "outstanding": 12000, "due": 700, "overdue": 0},
    {"member_id": "M-011", "name": "Tara Devi Maharjan", "name_ne": "तारा देवी महर्जन", "center_id": "CTR-001", "center_name": "Kalanki Center", "ward": "12", "loan_cycle": 5, "outstanding": 72000, "due": 4800, "overdue": 10},
    {"member_id": "M-012", "name": "Sarita BK", "name_ne": "सरिता बीके", "center_id": "CTR-004", "center_name": "Thamel Center", "ward": "26", "loan_cycle": 2, "outstanding": 18000, "due": 1000, "overdue": 0},
    # FO-202 clients
    {"member_id": "M-013", "name": "Kamini Sherpa", "name_ne": "कमिनी शेर्पा", "center_id": "CTR-002", "center_name": "Swoyambhu Center", "ward": "15", "loan_cycle": 3, "outstanding": 42000, "due": 2400, "overdue": 0},
    {"member_id": "M-014", "name": "Pabitra Basnet", "name_ne": "पवित्र बास्नेत", "center_id": "CTR-002", "center_name": "Swoyambhu Center", "ward": "15", "loan_cycle": 6, "outstanding": 88000, "due": 5900, "overdue": 18},
    {"member_id": "M-015", "name": "Gyanu Shrestha", "name_ne": "ज्ञानु श्रेष्ठ", "center_id": "CTR-004", "center_name": "Thamel Center", "ward": "26", "loan_cycle": 2, "outstanding": 25000, "due": 1400, "overdue": 3},
    {"member_id": "M-016", "name": "Menuka Thapa", "name_ne": "मेनुका थापा", "center_id": "CTR-004", "center_name": "Thamel Center", "ward": "26", "loan_cycle": 1, "outstanding": 10000, "due": 600, "overdue": 0},
    {"member_id": "M-017", "name": "Babita Devi Rai", "name_ne": "बबिता देवी राई", "center_id": "CTR-002", "center_name": "Swoyambhu Center", "ward": "15", "loan_cycle": 4, "outstanding": 63000, "due": 4200, "overdue": 35},
    # FO-203 clients
    {"member_id": "M-018", "name": "Kanchi Maya Sunuwar", "name_ne": "कान्छीमाया सुनुवार", "center_id": "CTR-003", "center_name": "Balaju Center", "ward": "16", "loan_cycle": 3, "outstanding": 35000, "due": 2000, "overdue": 0},
    {"member_id": "M-019", "name": "Hari Maya Dangi", "name_ne": "हरिमाया दाँगी", "center_id": "CTR-003", "center_name": "Balaju Center", "ward": "16", "loan_cycle": 2, "outstanding": 19000, "due": 1100, "overdue": 7},
    {"member_id": "M-020", "name": "Sushila Pariyar", "name_ne": "सुशिला परियार", "center_id": "CTR-005", "center_name": "Chabahil Center", "ward": "7", "loan_cycle": 5, "outstanding": 68000, "due": 4500, "overdue": 14},
    {"member_id": "M-021", "name": "Devi Kumari Khadka", "name_ne": "देवीकुमारी खड्का", "center_id": "CTR-005", "center_name": "Chabahil Center", "ward": "7", "loan_cycle": 3, "outstanding": 40000, "due": 2200, "overdue": 0},
    {"member_id": "M-022", "name": "Goma Devi Bishwokarma", "name_ne": "गोमादेवी विश्वकर्मा", "center_id": "CTR-003", "center_name": "Balaju Center", "ward": "16", "loan_cycle": 4, "outstanding": 52000, "due": 3400, "overdue": 21},
    {"member_id": "M-023", "name": "Nawaraj Buda", "name_ne": "नवराज बुढा", "center_id": "CTR-005", "center_name": "Chabahil Center", "ward": "7", "loan_cycle": 1, "outstanding": 8000, "due": 500, "overdue": 0},
    # FO-204 clients
    {"member_id": "M-024", "name": "Asha Kumari Chhetri", "name_ne": "आशाकुमारी छेत्री", "center_id": "CTR-005", "center_name": "Chabahil Center", "ward": "7", "loan_cycle": 2, "outstanding": 16000, "due": 900, "overdue": 0},
    {"member_id": "M-025", "name": "Parbati Ghimire", "name_ne": "पार्वती घिमिरे", "center_id": "CTR-001", "center_name": "Kalanki Center", "ward": "12", "loan_cycle": 3, "outstanding": 30000, "due": 1700, "overdue": 4},
    {"member_id": "M-026", "name": "Shanti Devi Mishra", "name_ne": "शान्तिदेवी मिश्र", "center_id": "CTR-005", "center_name": "Chabahil Center", "ward": "7", "loan_cycle": 4, "outstanding": 47000, "due": 3100, "overdue": 0},
    {"member_id": "M-027", "name": "Man Kumari Bhandari", "name_ne": "मानकुमारी भण्डारी", "center_id": "CTR-001", "center_name": "Kalanki Center", "ward": "12", "loan_cycle": 2, "outstanding": 14000, "due": 800, "overdue": 0},
    {"member_id": "M-028", "name": "Krishna Maya Thing", "name_ne": "कृष्णमाया थिङ", "center_id": "CTR-005", "center_name": "Chabahil Center", "ward": "7", "loan_cycle": 1, "outstanding": 9000, "due": 550, "overdue": 0},
]

# Historical collection amounts per day (past 6 days, per officer ~3-4 collections)
HISTORICAL_COLLECTIONS = {
    -1: [  # yesterday
        ("M-001", 2500, "FO-208"), ("M-003", 1800, "FO-208"), ("M-005", 3000, "FO-208"),
        ("M-007", 1200, "FO-201"), ("M-009", 2100, "FO-201"), ("M-011", 4800, "FO-201"),
        ("M-013", 2400, "FO-202"), ("M-014", 3500, "FO-202"),
        ("M-018", 2000, "FO-203"), ("M-020", 4500, "FO-203"),
        ("M-024", 900, "FO-204"), ("M-025", 1700, "FO-204"),
    ],
    -2: [
        ("M-002", 5200, "FO-208"), ("M-004", 900, "FO-208"), ("M-006", 1500, "FO-208"),
        ("M-008", 3500, "FO-201"), ("M-010", 700, "FO-201"),
        ("M-015", 1400, "FO-202"), ("M-016", 600, "FO-202"), ("M-013", 1200, "FO-202"),
        ("M-019", 1100, "FO-203"), ("M-021", 2200, "FO-203"), ("M-022", 1700, "FO-203"),
        ("M-026", 3100, "FO-204"), ("M-027", 800, "FO-204"),
    ],
    -3: [
        ("M-001", 2500, "FO-208"), ("M-005", 2000, "FO-208"),
        ("M-007", 1200, "FO-201"), ("M-012", 1000, "FO-201"), ("M-009", 1050, "FO-201"),
        ("M-013", 2400, "FO-202"), ("M-014", 2950, "FO-202"), ("M-015", 700, "FO-202"),
        ("M-018", 1000, "FO-203"), ("M-020", 2250, "FO-203"), ("M-023", 250, "FO-203"),
        ("M-024", 450, "FO-204"), ("M-026", 1550, "FO-204"),
    ],
    -4: [
        ("M-002", 2600, "FO-208"), ("M-003", 900, "FO-208"), ("M-006", 750, "FO-208"),
        ("M-008", 1750, "FO-201"), ("M-011", 2400, "FO-201"),
        ("M-013", 1200, "FO-202"), ("M-017", 2100, "FO-202"),
        ("M-019", 550, "FO-203"), ("M-020", 2250, "FO-203"), ("M-021", 1100, "FO-203"), ("M-022", 1700, "FO-203"),
        ("M-025", 850, "FO-204"), ("M-027", 400, "FO-204"), ("M-028", 275, "FO-204"),
    ],
    -5: [
        ("M-001", 1250, "FO-208"), ("M-004", 450, "FO-208"), ("M-005", 2000, "FO-208"),
        ("M-007", 600, "FO-201"), ("M-010", 350, "FO-201"), ("M-012", 500, "FO-201"),
        ("M-014", 2950, "FO-202"), ("M-015", 700, "FO-202"), ("M-016", 300, "FO-202"),
        ("M-018", 1000, "FO-203"), ("M-019", 550, "FO-203"), ("M-020", 4500, "FO-203"),
        ("M-024", 900, "FO-204"), ("M-026", 1550, "FO-204"), ("M-025", 850, "FO-204"),
    ],
    -6: [
        ("M-002", 5200, "FO-208"), ("M-003", 900, "FO-208"),
        ("M-008", 1750, "FO-201"), ("M-009", 1050, "FO-201"),
        ("M-013", 1200, "FO-202"), ("M-017", 2100, "FO-202"),
        ("M-021", 1100, "FO-203"), ("M-022", 1700, "FO-203"), ("M-023", 250, "FO-203"),
        ("M-027", 800, "FO-204"), ("M-028", 275, "FO-204"),
    ],
}


def _make_timestamp(day_offset: int = 0, hour: int = 9, minute: int = 0) -> str:
    """Create an ISO timestamp for a given day offset from today."""
    dt = datetime(
        TODAY.year, TODAY.month, TODAY.day,
        hour, minute, 0,
        tzinfo=timezone.utc,
    ) + timedelta(days=day_offset)
    return dt.isoformat()


def _make_date_str(day_offset: int = 0) -> str:
    """Create a date string for a given day offset from today."""
    d = TODAY + timedelta(days=day_offset)
    return str(d)


# ---------------------------------------------------------------------------
# Main seed function
# ---------------------------------------------------------------------------

async def seed_manager_data():
    """Create all demo data for the manager dashboard."""
    # Ensure tables exist
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Tables verified.")

    async with AsyncSessionLocal() as session:
        try:
            # Check if already seeded
            result = await session.execute(select(User).where(User.staff_id == "BM-001"))
            if result.scalar_one_or_none():
                logger.info("Manager seed data already exists. Skipping.")
                return

            # --- Get or create branch ---
            result = await session.execute(select(Branch).where(Branch.branch_id == "BR-KTM-001"))
            branch = result.scalar_one_or_none()
            if not branch:
                branch = Branch(
                    branch_id="BR-KTM-001",
                    name="Kathmandu Main Branch",
                    name_ne="काठमाडौं मुख्य शाखा",
                    address="Putalisadak, Kathmandu",
                )
                session.add(branch)
                await session.flush()
                logger.info("Created branch BR-KTM-001.")

            # --- Get existing FO-208 ---
            result = await session.execute(select(User).where(User.staff_id == "FO-208"))
            fo208 = result.scalar_one_or_none()
            if not fo208:
                fo208 = User(
                    staff_id="FO-208",
                    name="Ram Bahadur Shah",
                    name_ne="राम बहादुर शाह",
                    role="field_officer",
                    hashed_pin=hash_pin("1234"),
                    branch_id=branch.id,
                    phone_number="+977-9841234567",
                    is_active=True,
                )
                session.add(fo208)
                await session.flush()

            # --- Create new staff ---
            staff_map: dict[str, User] = {"FO-208": fo208}  # staff_id -> User
            for s in NEW_STAFF:
                user = User(
                    staff_id=s["staff_id"],
                    name=s["name"],
                    name_ne=s["name_ne"],
                    role=s["role"],
                    hashed_pin=hash_pin("1234"),
                    branch_id=branch.id,
                    phone_number=s["phone"],
                    is_active=True,
                )
                session.add(user)
                await session.flush()
                staff_map[s["staff_id"]] = user

            logger.info(f"Staff created: {len(staff_map)} total")

            # --- Get existing clients (from base seed) ---
            result = await session.execute(select(Client))
            existing_clients = {c.member_id: c for c in result.scalars().all()}
            logger.info(f"Existing clients: {len(existing_clients)}")

            # --- Create new clients ---
            client_map: dict[str, Client] = dict(existing_clients)
            for cd in NEW_CLIENTS:
                client = Client(
                    member_id=cd["member_id"],
                    name=cd["name"],
                    name_ne=cd["name_ne"],
                    center_id=cd["center_id"],
                    center_name=cd["center_name"],
                    ward=cd["ward"],
                    loan_cycle=cd["loan_cycle"],
                    outstanding_balance=float(cd["outstanding"]),
                    due_amount=float(cd["due"]),
                    next_installment_date=str(TODAY + timedelta(days=(7 - cd["overdue"]))),
                    overdue_days=cd["overdue"],
                    status="active",
                )
                session.add(client)
                await session.flush()
                client_map[cd["member_id"]] = client

            logger.info(f"Total clients now: {len(client_map)}")

            # --- Create loan accounts for new clients ---
            new_loan_count = 0
            for cd in NEW_CLIENTS:
                client = client_map[cd["member_id"]]
                loan_id = f"LN-{cd['member_id']}-{cd['loan_cycle']:03d}"
                # Check if loan already exists
                existing = (await session.execute(
                    select(LoanAccount).where(LoanAccount.loan_id == loan_id)
                )).scalar_one_or_none()
                if not existing:
                    loan = LoanAccount(
                        client_id=client.id,
                        loan_id=loan_id,
                        product_type="micro_loan",
                        disbursement_date=str(TODAY - timedelta(days=180)),
                        maturity_date=str(TODAY + timedelta(days=185)),
                        principal_amount=client.outstanding_balance * 1.5,
                        outstanding_balance=client.outstanding_balance,
                        installment_amount=client.due_amount,
                        installment_frequency="weekly",
                        status="overdue" if client.overdue_days > 7 else "active",
                    )
                    session.add(loan)
                    new_loan_count += 1
            await session.flush()
            logger.info(f"New loan accounts: {new_loan_count}")

            # --- Create devices ---
            device_map: dict[str, Device] = {}
            for staff_id, user in staff_map.items():
                device_id = f"DEV-{staff_id}-{uuid.uuid4().hex[:8]}"
                device = Device(
                    device_id=device_id,
                    user_id=user.id,
                    device_name=f"{user.name}'s Phone",
                    device_model="Samsung Galaxy A14",
                    os_version="Android 13",
                    app_version="1.2.0",
                    is_registered=True,
                    last_sync_at=_make_timestamp(0, 8, 30) if user.role == "field_officer" else _make_timestamp(0, 9, 0),
                )
                session.add(device)
                await session.flush()
                device_map[staff_id] = device

            logger.info(f"Devices created: {len(device_map)}")

            # ================================================================
            # Tasks for today
            # ================================================================
            # Map: member_id -> assigned officer staff_id
            # NOTE: M-001..M-006 already have tasks from base seed.py — skip them
            officer_assignment: dict[str, str] = {
                # FO-201 clients
                "M-007": "FO-201", "M-008": "FO-201", "M-009": "FO-201",
                "M-010": "FO-201", "M-011": "FO-201", "M-012": "FO-201",
                # FO-202 clients
                "M-013": "FO-202", "M-014": "FO-202", "M-015": "FO-202",
                "M-016": "FO-202", "M-017": "FO-202",
                # FO-203 clients
                "M-018": "FO-203", "M-019": "FO-203", "M-020": "FO-203",
                "M-021": "FO-203", "M-022": "FO-203", "M-023": "FO-203",
                # FO-204 clients
                "M-024": "FO-204", "M-025": "FO-204", "M-026": "FO-204",
                "M-027": "FO-204", "M-028": "FO-204",
            }

            task_map: dict[str, TaskAssignment] = {}  # member_id -> task
            tasks_created = 0

            # Load existing tasks for today (from base seed.py) so visits/collections can reference them
            existing_tasks_result = await session.execute(
                select(TaskAssignment).where(TaskAssignment.task_date == TODAY_STR)
            )
            # Build reverse lookup: client_id -> member_id
            client_id_to_member: dict[int, str] = {c.id: mid for mid, c in client_map.items()}
            for et in existing_tasks_result.scalars().all():
                if et.client_id and et.client_id in client_id_to_member:
                    task_map[client_id_to_member[et.client_id]] = et

            for member_id, officer_sid in officer_assignment.items():
                client = client_map.get(member_id)
                officer = staff_map.get(officer_sid)
                if not client or not officer:
                    continue

                task_type = "collection"
                priority = "medium"
                reason = None
                amount = client.due_amount

                if client.overdue_days >= 21:
                    task_type = "visit"
                    priority = "urgent"
                    reason = f"{client.overdue_days} days overdue — high risk"
                elif client.overdue_days >= 7:
                    task_type = "follow_up"
                    priority = "high"
                    reason = f"{client.overdue_days} days overdue"
                elif client.overdue_days > 0:
                    priority = "high"

                task = TaskAssignment(
                    client_id=client.id,
                    user_id=officer.id,
                    task_type=task_type,
                    task_date=TODAY_STR,
                    status="pending",
                    priority=priority,
                    reason=reason,
                    amount=amount,
                    is_completed=False,
                )
                session.add(task)
                await session.flush()
                task_map[member_id] = task
                tasks_created += 1

            logger.info(f"Tasks created for today: {tasks_created}")

            # ================================================================
            # Visit check-ins for today
            # ================================================================
            # Each officer does visits for most of their clients
            visit_data = [
                # FO-208 visits
                ("M-001", "FO-208", "collection_followup", 27.71, 85.32, 0, 9),
                ("M-002", "FO-208", "collection_followup", 27.72, 85.31, 0, 10),
                ("M-004", "FO-208", "collection", 27.70, 85.33, 0, 11),
                ("M-005", "FO-208", "overdue_visit", 27.73, 85.30, 0, 14),
                ("M-006", "FO-208", "collection", 27.71, 85.34, 0, 15),
                # FO-201 visits
                ("M-007", "FO-201", "collection", 27.72, 85.30, 0, 9),
                ("M-008", "FO-201", "collection_followup", 27.71, 85.29, 0, 10),
                ("M-009", "FO-201", "collection", 27.73, 85.31, 0, 11),
                ("M-011", "FO-201", "overdue_visit", 27.74, 85.28, 0, 13),
                ("M-012", "FO-201", "collection", 27.72, 85.32, 0, 14),
                # FO-202 visits
                ("M-013", "FO-202", "collection", 27.71, 85.30, 0, 9),
                ("M-014", "FO-202", "overdue_visit", 27.70, 85.29, 0, 10),
                ("M-015", "FO-202", "collection_followup", 27.72, 85.31, 0, 11),
                ("M-017", "FO-202", "overdue_visit", 27.73, 85.30, 0, 14),
                # FO-203 visits
                ("M-018", "FO-203", "collection", 27.74, 85.29, 0, 9),
                ("M-019", "FO-203", "collection_followup", 27.73, 85.28, 0, 10),
                ("M-020", "FO-203", "overdue_visit", 27.72, 85.30, 0, 12),
                ("M-021", "FO-203", "collection", 27.75, 85.31, 0, 13),
                ("M-022", "FO-203", "overdue_visit", 27.74, 85.27, 0, 15),
                # FO-204 visits
                ("M-024", "FO-204", "collection", 27.72, 85.28, 0, 9),
                ("M-025", "FO-204", "collection_followup", 27.71, 85.29, 0, 10),
                ("M-026", "FO-204", "collection", 27.73, 85.30, 0, 11),
            ]

            visit_map: dict[str, VisitCheckin] = {}  # member_id -> visit
            visits_created = 0
            for member_id, officer_sid, purpose, lat, lng, day_off, hour in visit_data:
                client = client_map.get(member_id)
                officer = staff_map.get(officer_sid)
                task = task_map.get(member_id)
                if not client:
                    continue

                visit = VisitCheckin(
                    client_id=client.id,
                    task_id=task.id if task else None,
                    visit_purpose=purpose,
                    gps_latitude=lat,
                    gps_longitude=lng,
                    gps_address=f"Near {client.center_name}, Kathmandu",
                    gps_accuracy_meters=15.0,
                    checked_in_at=_make_timestamp(day_off, hour, 30),
                    synced_at=_make_timestamp(day_off, hour, 32),
                )
                session.add(visit)
                await session.flush()
                visit_map[member_id] = visit
                visits_created += 1

                # Mark task as completed if visit created
                if task and not task.is_completed:
                    task.is_completed = True
                    task.completed_at = _make_timestamp(day_off, hour, 30)

            logger.info(f"Visit check-ins created: {visits_created}")

            # ================================================================
            # Collections for today
            # ================================================================
            today_collections = [
                # FO-208
                ("M-001", "FO-208", 2500, 22000, 0, "cash", True),
                ("M-002", "FO-208", 5200, 72800, 0, "cash", False),
                ("M-004", "FO-208", 900, 14100, 0, "digital", True),
                ("M-006", "FO-208", 1500, 26500, 0, "cash", True),
                # FO-201
                ("M-007", "FO-201", 1200, 20800, 0, "cash", True),
                ("M-008", "FO-201", 3500, 51500, 0, "cash", False),
                ("M-009", "FO-201", 2100, 35900, 0, "digital", True),
                ("M-012", "FO-201", 1000, 17000, 0, "cash", True),
                # FO-202
                ("M-013", "FO-202", 2400, 39600, 0, "cash", True),
                ("M-014", "FO-202", 5900, 82100, 0, "cash", False),  # high value, unverified
                ("M-015", "FO-202", 1400, 23600, 0, "digital", True),
                # FO-203
                ("M-018", "FO-203", 2000, 33000, 0, "cash", True),
                ("M-019", "FO-203", 1100, 17900, 0, "cash", True),
                ("M-020", "FO-203", 4500, 63500, 0, "cash", False),  # high value, unverified
                ("M-021", "FO-203", 2200, 37800, 0, "digital", True),
                # FO-204
                ("M-024", "FO-204", 900, 15100, 0, "cash", True),
                ("M-025", "FO-204", 1700, 28300, 0, "cash", True),
                ("M-026", "FO-204", 3100, 43900, 0, "digital", True),
            ]

            total_collections_created = 0
            receipt_counter = 1

            # --- Today's collections ---
            for i, (member_id, officer_sid, amount, outstanding_after, day_off, method, cbs) in enumerate(today_collections):
                client = client_map.get(member_id)
                task = task_map.get(member_id)
                visit = visit_map.get(member_id)
                if not client:
                    continue

                receipt_id = f"RCP-{TODAY.strftime('%Y%m%d')}-{receipt_counter:04d}"
                receipt_counter += 1

                collection = Collection(
                    receipt_id=receipt_id,
                    client_id=client.id,
                    task_id=task.id if task else None,
                    visit_id=visit.id if visit else None,
                    amount=float(amount),
                    due_amount=client.due_amount,
                    outstanding_after=float(outstanding_after),
                    payment_method=method,
                    is_high_value=(float(amount) >= 50000),
                    face_verified=True,
                    gps_latitude=27.71 + (i * 0.002),
                    gps_longitude=85.30 + (i * 0.002),
                    collected_at=_make_timestamp(day_off, 9 + (i % 4), 45),
                    cbs_verified=cbs,
                )
                session.add(collection)
                total_collections_created += 1

            # --- Historical collections (past 6 days) ---
            for day_offset, items in HISTORICAL_COLLECTIONS.items():
                for member_id, amount, officer_sid in items:
                    client = client_map.get(member_id)
                    if not client:
                        continue

                    receipt_id = f"RCP-{(TODAY + timedelta(days=day_offset)).strftime('%Y%m%d')}-{receipt_counter:04d}"
                    receipt_counter += 1

                    collection = Collection(
                        receipt_id=receipt_id,
                        client_id=client.id,
                        amount=float(amount),
                        due_amount=client.due_amount,
                        outstanding_after=client.outstanding_balance + amount,
                        payment_method="cash",
                        is_high_value=False,
                        face_verified=True,
                        collected_at=_make_timestamp(day_offset, 10, 0),
                        cbs_verified=True,
                    )
                    session.add(collection)
                    total_collections_created += 1

            await session.flush()
            logger.info(f"Collections created: {total_collections_created}")

            # ================================================================
            # Promise-to-Pay records
            # ================================================================
            ptp_data = [
                # Due today (3)
                {"client": "M-002", "amount": 5200, "officer": "FO-208", "date_offset": 0, "status": "pending"},
                {"client": "M-008", "amount": 3500, "officer": "FO-201", "date_offset": 0, "status": "pending"},
                {"client": "M-020", "amount": 4500, "officer": "FO-203", "date_offset": 0, "status": "fulfilled"},
                # Overdue — missed (2)
                {"client": "M-005", "amount": 6800, "officer": "FO-208", "date_offset": -5, "status": "pending"},
                {"client": "M-017", "amount": 4200, "officer": "FO-202", "date_offset": -3, "status": "broken"},
                # Future (2)
                {"client": "M-014", "amount": 5900, "officer": "FO-202", "date_offset": 3, "status": "pending"},
                {"client": "M-022", "amount": 3400, "officer": "FO-203", "date_offset": 5, "status": "pending"},
            ]

            ptp_count = 0
            for p in ptp_data:
                client = client_map.get(p["client"])
                task = task_map.get(p["client"])
                if not client:
                    continue
                expected_date = str(TODAY + timedelta(days=p["date_offset"]))

                ptp = PromiseToPay(
                    client_id=client.id,
                    task_id=task.id if task else None,
                    promised_amount=float(p["amount"]),
                    expected_payment_date=expected_date,
                    reason="Client requested extension" if p["date_offset"] > 0 else "Unable to pay on time",
                    outstanding_amount=client.outstanding_balance,
                    status=p["status"],
                )
                session.add(ptp)
                ptp_count += 1

            await session.flush()
            logger.info(f"PTP records created: {ptp_count}")

            # ================================================================
            # End-of-Day reports
            # ================================================================
            eod_reports = [
                # Submitted reports
                {
                    "officer": "FO-208",
                    "date_offset": 0,
                    "total_collections": 10100,
                    "total_visits": 5,
                    "pending_count": 1,
                    "is_submitted": True,
                    "is_confirmed": True,
                    "exceptions": None,
                },
                {
                    "officer": "FO-201",
                    "date_offset": 0,
                    "total_collections": 7800,
                    "total_visits": 5,
                    "pending_count": 1,
                    "is_submitted": True,
                    "is_confirmed": True,
                    "exceptions": None,
                },
                # Pending report (not yet submitted)
                {
                    "officer": "FO-203",
                    "date_offset": 0,
                    "total_collections": 0,
                    "total_visits": 5,
                    "pending_count": 5,
                    "is_submitted": False,
                    "is_confirmed": False,
                    "exceptions": None,
                },
                # Overdue report (from yesterday, not submitted)
                {
                    "officer": "FO-204",
                    "date_offset": -1,
                    "total_collections": 5700,
                    "total_visits": 3,
                    "pending_count": 2,
                    "is_submitted": False,
                    "is_confirmed": False,
                    "exceptions": [
                        {"type": "cash_mismatch", "amount": 3000, "message": "Cash NPR 3,000 mismatch in daily reconciliation"},
                    ],
                },
            ]

            eod_count = 0
            for e in eod_reports:
                officer = staff_map.get(e["officer"])
                if not officer:
                    continue

                exceptions_json = json.dumps(e["exceptions"]) if e["exceptions"] else None
                report_date = str(TODAY + timedelta(days=e["date_offset"]))

                eod = EndOfDayReport(
                    report_date=report_date,
                    officer_id=officer.id,
                    total_collections=float(e["total_collections"]),
                    total_visits=e["total_visits"],
                    pending_count=e["pending_count"],
                    exceptions_json=exceptions_json,
                    is_confirmed=e["is_confirmed"],
                    is_submitted=e["is_submitted"],
                    face_verified=e["is_submitted"],
                )
                session.add(eod)
                eod_count += 1

            await session.flush()
            logger.info(f"EOD reports created: {eod_count}")

            # ================================================================
            # Audit log entries
            # ================================================================
            audit_entries = [
                {
                    "user": "FO-208", "action_type": "collection_recorded",
                    "entity_type": "collection", "entity_id": "1",
                    "meta": {"description": "Collection NPR 2,500 for Sita Kumari Thapa", "member_id": "M-001"},
                },
                {
                    "user": "FO-208", "action_type": "collection_recorded",
                    "entity_type": "collection", "entity_id": "2",
                    "meta": {"description": "Collection NPR 5,200 for Maya Devi Shrestha", "member_id": "M-002"},
                },
                {
                    "user": "FO-201", "action_type": "visit_checkin",
                    "entity_type": "visit", "entity_id": "7",
                    "meta": {"description": "Check-in at Dil Maya Tamang location", "member_id": "M-007"},
                },
                {
                    "user": "FO-202", "action_type": "collection_recorded",
                    "entity_type": "collection", "entity_id": "10",
                    "meta": {"description": "High-value collection NPR 59,000 for Pabitra Basnet (unverified)", "member_id": "M-014"},
                },
                {
                    "user": "FO-203", "action_type": "promise_recorded",
                    "entity_type": "promise_to_pay", "entity_id": "3",
                    "meta": {"description": "PTP NPR 4,500 from Sushila Pariyar — fulfilled today", "member_id": "M-020"},
                },
                {
                    "user": "FO-208", "action_type": "eod_submitted",
                    "entity_type": "eod_report", "entity_id": "1",
                    "meta": {"description": "EOD submitted — NPR 10,100 collected, 5 visits completed"},
                },
                {
                    "user": "FO-204", "action_type": "sync_completed",
                    "entity_type": "sync", "entity_id": "sync-001",
                    "meta": {"description": "Device sync completed — 12 records synced"},
                },
                {
                    "user": "FO-201", "action_type": "collection_recorded",
                    "entity_type": "collection", "entity_id": "6",
                    "meta": {"description": "Collection NPR 3,500 for Nirmala Devi Pokharel", "member_id": "M-008"},
                },
                {
                    "user": "FO-203", "action_type": "visit_checkin",
                    "entity_type": "visit", "entity_id": "16",
                    "meta": {"description": "Overdue visit to Goma Devi Bishwokarma — 21 days overdue", "member_id": "M-022"},
                },
                {
                    "user": "FO-202", "action_type": "promise_recorded",
                    "entity_type": "promise_to_pay", "entity_id": "5",
                    "meta": {"description": "PTP NPR 5,900 from Pabitra Basnet — promised in 3 days", "member_id": "M-014"},
                },
            ]

            audit_count = 0
            for a in audit_entries:
                user = staff_map.get(a["user"])
                if not user:
                    continue

                audit_log = AuditLog(
                    user_id=user.id,
                    role=user.role,
                    branch_id=branch.id,
                    device_id=device_map.get(a["user"]).device_id if device_map.get(a["user"]) else None,
                    action_type=a["action_type"],
                    entity_type=a["entity_type"],
                    entity_id=a["entity_id"],
                    meta_json=json.dumps(a["meta"]) if a["meta"] else None,
                )
                session.add(audit_log)
                audit_count += 1

            await session.flush()
            logger.info(f"Audit logs created: {audit_count}")

            # ================================================================
            # Sync events
            # ================================================================
            sync_events_data = [
                # Completed/synced events
                {"entity_type": "collection", "entity_id": "1", "operation": "create", "status": "completed", "retry": 0},
                {"entity_type": "collection", "entity_id": "2", "operation": "create", "status": "completed", "retry": 0},
                {"entity_type": "visit_checkin", "entity_id": "1", "operation": "create", "status": "completed", "retry": 0},
                {"entity_type": "visit_checkin", "entity_id": "2", "operation": "create", "status": "completed", "retry": 0},
                {"entity_type": "task", "entity_id": "10", "operation": "update", "status": "completed", "retry": 0},
                {"entity_type": "collection", "entity_id": "3", "operation": "create", "status": "completed", "retry": 0},
                {"entity_type": "visit_checkin", "entity_id": "5", "operation": "create", "status": "completed", "retry": 0},
                {"entity_type": "collection", "entity_id": "4", "operation": "create", "status": "completed", "retry": 0},
                {"entity_type": "promise_to_pay", "entity_id": "1", "operation": "create", "status": "completed", "retry": 0},
                {"entity_type": "eod_report", "entity_id": "1", "operation": "create", "status": "completed", "retry": 0},
                {"entity_type": "client", "entity_id": "M-014", "operation": "update", "status": "completed", "retry": 0},
                {"entity_type": "collection", "entity_id": "5", "operation": "create", "status": "completed", "retry": 0},
                {"entity_type": "visit_checkin", "entity_id": "10", "operation": "create", "status": "synced", "retry": 0},
                {"entity_type": "collection", "entity_id": "6", "operation": "create", "status": "synced", "retry": 0},
                {"entity_type": "collection", "entity_id": "7", "operation": "create", "status": "synced", "retry": 0},
                # Pending events
                {"entity_type": "collection", "entity_id": "8", "operation": "create", "status": "pending", "retry": 0},
                {"entity_type": "collection", "entity_id": "9", "operation": "create", "status": "pending", "retry": 1},
                {"entity_type": "visit_checkin", "entity_id": "15", "operation": "create", "status": "pending", "retry": 0},
                # Failed events
                {"entity_type": "collection", "entity_id": "10", "operation": "create", "status": "failed", "retry": 3, "error": "CBS verification timeout"},
                {"entity_type": "sync", "entity_id": "batch-005", "operation": "batch", "status": "failed", "retry": 2, "error": "Network connectivity issue"},
            ]

            sync_count = 0
            for s in sync_events_data:
                sync_event = SyncEvent(
                    entity_type=s["entity_type"],
                    entity_id=s["entity_id"],
                    operation=s["operation"],
                    payload_json=json.dumps({"source": "mobile_app"}),
                    status=s["status"],
                    retry_count=s["retry"],
                    last_error=s.get("error"),
                    synced_at=_make_timestamp(0, 10, 0) if s["status"] in ("completed", "synced") else None,
                )
                session.add(sync_event)
                sync_count += 1

            await session.flush()
            logger.info(f"Sync events created: {sync_count}")

            # ================================================================
            # Commit
            # ================================================================
            await session.commit()

            logger.info("=" * 60)
            logger.info("Manager dashboard seed data created successfully!")
            logger.info(f"  Staff: {len(staff_map)} ({sum(1 for u in staff_map.values() if u.role == 'field_officer')} FOs + 1 BM)")
            logger.info(f"  Clients: {len(client_map)}")
            logger.info(f"  Tasks for today: {tasks_created}")
            logger.info(f"  Visit check-ins: {visits_created}")
            logger.info(f"  Collections (total): {total_collections_created}")
            logger.info(f"  PTP records: {ptp_count}")
            logger.info(f"  EOD reports: {eod_count}")
            logger.info(f"  Audit logs: {audit_count}")
            logger.info(f"  Sync events: {sync_count}")
            logger.info("=" * 60)

        except Exception as e:
            await session.rollback()
            logger.error(f"Manager seed error: {e}", exc_info=True)
            raise


if __name__ == "__main__":
    asyncio.run(seed_manager_data())
