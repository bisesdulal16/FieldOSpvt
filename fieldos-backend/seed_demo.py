"""
FieldOS Nepal — canonical PILOT DEMO seed.

Wipes and rebuilds a realistic single-branch dataset for the golden-path demo:
  - 1 branch (Kathmandu Main)
  - 2 field officers + 1 branch manager (all PIN 1234)
  - 15 borrowers with Nepali names across 3 centers
  - loans spanning the full lifecycle: active/collecting, one delinquent (NPA risk),
    two pending applications (await approval), one approved (awaiting disbursement)
  - today's tasks for both officers (Nepal date)

Run:  python seed_demo.py     (DESTRUCTIVE — drops all tables first)
"""
import asyncio
import logging
from datetime import timedelta

from app.database import engine, Base, AsyncSessionLocal
from app.models.branch import Branch
from app.models.user import User
from app.models.client import Client
from app.models.loan_account import LoanAccount
from app.models.loan_schedule import LoanScheduleItem
from app.models.task import TaskAssignment
from app.models.visit_checkin import VisitCheckin
from app.services.auth_service import hash_pin
from app.utils.nepal_time import now_nepal

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TODAY = now_nepal().date()


def d(offset_days: int) -> str:
    return (TODAY + timedelta(days=offset_days)).isoformat()


# 15 borrowers. lifecycle: active | delinquent | pending | approved
BORROWERS = [
    # officer FO-208 — Kalanki + Swoyambhu
    {"name": "Sita Kumari Thapa",   "ne": "सिता कुमारी थापा",   "center": ("CTR-001", "Kalanki Center"),   "ward": "12", "officer": 0, "state": "active",     "cycle": 3, "due": 2500,  "outstanding": 45000, "overdue": 0},
    {"name": "Maya Devi Shrestha",  "ne": "माया देवी श्रेष्ठ",   "center": ("CTR-001", "Kalanki Center"),   "ward": "12", "officer": 0, "state": "active",     "cycle": 5, "due": 5200,  "outstanding": 41600, "overdue": 0},
    {"name": "Gita Nepali",         "ne": "गीता नेपाली",         "center": ("CTR-001", "Kalanki Center"),   "ward": "12", "officer": 0, "state": "active",     "cycle": 2, "due": 1800,  "outstanding": 32000, "overdue": 6},
    {"name": "Laxmi Tamang",        "ne": "लक्ष्मी तामाङ",       "center": ("CTR-002", "Swoyambhu Center"), "ward": "15", "officer": 0, "state": "active",     "cycle": 1, "due": 900,   "outstanding": 15000, "overdue": 0},
    {"name": "Kamala BK",           "ne": "कमला बीके",           "center": ("CTR-002", "Swoyambhu Center"), "ward": "15", "officer": 0, "state": "delinquent", "cycle": 4, "due": 6800,  "outstanding": 95000, "overdue": 45},
    {"name": "Saraswoti Poudel",    "ne": "सरस्वती पौडेल",       "center": ("CTR-002", "Swoyambhu Center"), "ward": "15", "officer": 0, "state": "active",     "cycle": 2, "due": 1500,  "outstanding": 28000, "overdue": 3},
    {"name": "Bimala Gurung",       "ne": "विमला गुरुङ",         "center": ("CTR-001", "Kalanki Center"),   "ward": "12", "officer": 0, "state": "active",     "cycle": 3, "due": 3200,  "outstanding": 52000, "overdue": 0},
    {"name": "Radha Karki",         "ne": "राधा कार्की",         "center": ("CTR-002", "Swoyambhu Center"), "ward": "15", "officer": 0, "state": "pending",     "cycle": 1, "due": 0,     "outstanding": 0,     "overdue": 0, "principal": 40000},
    # officer FO-209 — Balaju
    {"name": "Sunita Chaudhary",    "ne": "सुनिता चौधरी",        "center": ("CTR-003", "Balaju Center"),    "ward": "16", "officer": 1, "state": "active",     "cycle": 4, "due": 4100,  "outstanding": 68000, "overdue": 0},
    {"name": "Parbati Magar",       "ne": "पार्वती मगर",         "center": ("CTR-003", "Balaju Center"),    "ward": "16", "officer": 1, "state": "active",     "cycle": 2, "due": 2200,  "outstanding": 34000, "overdue": 12},
    {"name": "Devi Maya Rai",       "ne": "देवी माया राई",       "center": ("CTR-003", "Balaju Center"),    "ward": "16", "officer": 1, "state": "active",     "cycle": 3, "due": 2900,  "outstanding": 47000, "overdue": 0},
    {"name": "Anita Lama",          "ne": "अनिता लामा",          "center": ("CTR-003", "Balaju Center"),    "ward": "16", "officer": 1, "state": "active",     "cycle": 1, "due": 1200,  "outstanding": 18000, "overdue": 2},
    {"name": "Sarita Bhandari",     "ne": "सरिता भण्डारी",       "center": ("CTR-003", "Balaju Center"),    "ward": "16", "officer": 1, "state": "pending",     "cycle": 1, "due": 0,     "outstanding": 0,     "overdue": 0, "principal": 25000},
    {"name": "Goma Adhikari",       "ne": "गोमा अधिकारी",        "center": ("CTR-003", "Balaju Center"),    "ward": "16", "officer": 1, "state": "approved",    "cycle": 1, "due": 0,     "outstanding": 0,     "overdue": 0, "principal": 30000},
    {"name": "Muna Shrestha",       "ne": "मुना श्रेष्ठ",         "center": ("CTR-003", "Balaju Center"),    "ward": "16", "officer": 1, "state": "active",     "cycle": 2, "due": 1700,  "outstanding": 26000, "overdue": 0},
]


# Real Kathmandu-area coordinates per center, for seeded visit map points.
CENTER_COORDS = {
    "CTR-001": (27.6935, 85.2810),  # Kalanki
    "CTR-002": (27.7148, 85.2903),  # Swoyambhu
    "CTR-003": (27.7320, 85.3020),  # Balaju
}


async def seed():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Tables reset.")

    async with AsyncSessionLocal() as s:
        branch = Branch(branch_id="BR-KTM-001", name="Kathmandu Main Branch",
                        name_ne="काठमाडौं मुख्य शाखा", address="Putalisadak, Kathmandu",
                        # Office-network day-start gate: OFF by default ("" = disabled).
                        # It compares the request's source IP against this value, so any
                        # non-empty default (127.0.0.1 included) makes every real phone fail
                        # with 403 "You can only start your day from the branch office network".
                        # To enable, set this to the branch's real PUBLIC IP.
                        office_ip="")
        s.add(branch)
        await s.flush()

        officers = [
            User(staff_id="FO-208", name="Ram Bahadur Shah", name_ne="राम बहादुर शाह",
                 role="field_officer", hashed_pin=hash_pin("1234"), branch_id=branch.id,
                 phone_number="+977-9841234567", is_active=True),
            User(staff_id="FO-209", name="Hari Prasad Koirala", name_ne="हरि प्रसाद कोइराला",
                 role="field_officer", hashed_pin=hash_pin("1234"), branch_id=branch.id,
                 phone_number="+977-9841234569", is_active=True),
        ]
        manager = User(staff_id="BM-001", name="Suman Karki", name_ne="सुमन कार्की",
                       role="branch_manager", hashed_pin=hash_pin("1234"), branch_id=branch.id,
                       phone_number="+977-9841234568", is_active=True)
        for u in officers:
            s.add(u)
        s.add(manager)
        await s.flush()

        n_loans = 0
        n_tasks = 0
        for i, b in enumerate(BORROWERS):
            member_id = f"M-{i + 1:03d}"
            overdue = b["overdue"]
            client = Client(
                member_id=member_id, name=b["name"], name_ne=b["ne"],
                phone_number=f"+977-98{41000000 + i:08d}",  # demo Nepali mobile numbers
                center_id=b["center"][0], center_name=b["center"][1], ward=b["ward"],
                loan_cycle=b["cycle"], outstanding_balance=b["outstanding"], due_amount=b["due"],
                next_installment_date=d(7 - overdue), overdue_days=overdue,
                status="active" if b["state"] != "pending" else "prospect",
            )
            s.add(client)
            await s.flush()

            officer = officers[b["officer"]]
            state = b["state"]

            if state in ("active", "delinquent"):
                loan = LoanAccount(
                    client_id=client.id, loan_id=f"LN-{member_id}-{b['cycle']:03d}",
                    product_type="micro_loan", disbursement_date=d(-180), maturity_date=d(185),
                    principal_amount=round(b["outstanding"] * 1.4), outstanding_balance=b["outstanding"],
                    installment_amount=b["due"], installment_frequency="weekly", term_weeks=25,
                    status="active",
                )
                s.add(loan)
                n_loans += 1

                # Seed a GPS visit check-in so the manager map has recent points. Jitter the
                # center coords a little per client, stagger the time over the last few hours.
                base = CENTER_COORDS.get(b["center"][0])
                if base:
                    lat = base[0] + (i % 5) * 0.0009
                    lng = base[1] + (i % 4) * 0.0011
                    seen_at = (now_nepal() - timedelta(minutes=25 * i)).isoformat(timespec="seconds")
                    s.add(VisitCheckin(
                        client_id=client.id, officer_id=officer.id, visit_purpose="collection",
                        gps_latitude=lat, gps_longitude=lng, gps_address=b["center"][1],
                        checked_in_at=seen_at, synced_at=seen_at,
                    ))

                # today's collection/visit task
                if state == "delinquent":
                    s.add(TaskAssignment(client_id=client.id, user_id=officer.id, task_type="visit",
                                         task_date=TODAY.isoformat(), status="pending", priority="urgent",
                                         reason=f"{overdue} days overdue — NPA risk", is_completed=False))
                else:
                    prio = "urgent" if overdue > 5 else ("high" if b["due"] >= 3000 else "medium")
                    s.add(TaskAssignment(client_id=client.id, user_id=officer.id, task_type="collection",
                                         task_date=TODAY.isoformat(), status="pending", priority=prio,
                                         reason=f"{overdue} days overdue" if overdue else "Regular weekly installment",
                                         amount=b["due"], is_completed=False))
                n_tasks += 1

            elif state in ("pending", "approved"):
                principal = b["principal"]
                weeks = 25
                interest = principal * 0.18 * (weeks / 52.0)
                installment = round((principal + interest) / weeks, 2)
                loan = LoanAccount(
                    client_id=client.id, loan_id=f"LN-{member_id}-0001",
                    product_type="micro_loan",
                    principal_amount=principal, outstanding_balance=0.0,
                    installment_amount=installment, installment_frequency="weekly", term_weeks=weeks,
                    status=state,  # 'pending' or 'approved'
                )
                s.add(loan)
                n_loans += 1

        await s.commit()
        logger.info("Demo seed complete.")
        logger.info(f"  Branch: Kathmandu Main | Officers: FO-208, FO-209 (PIN 1234) | Manager: BM-001 (PIN 1234)")
        logger.info(f"  Borrowers: {len(BORROWERS)} | Loans: {n_loans} | Today's tasks: {n_tasks}")
        logger.info(f"  Lifecycle: active+delinquent collecting, 2 pending applications, 1 approved awaiting disbursement")


if __name__ == "__main__":
    asyncio.run(seed())
