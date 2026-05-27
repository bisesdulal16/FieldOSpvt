"""
Seed script for FieldOS Nepal — creates demo data.
"""
import asyncio
import logging
from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.database import engine, Base, AsyncSessionLocal
from app.models.branch import Branch
from app.models.user import User
from app.models.client import Client
from app.models.loan_account import LoanAccount
from app.models.task import TaskAssignment
from app.services.auth_service import hash_pin

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def seed_data():
    # Create tables first
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Tables created.")

    async with AsyncSessionLocal() as session:
        try:
            from sqlalchemy import select, func
            count_result = await session.execute(select(func.count()).select_from(User))
            if count_result.scalar() > 0:
                logger.info("Database already has data. Skipping seed.")
                return

            # --- Branch ---
            branch = Branch(
                branch_id="BR-KTM-001",
                name="Kathmandu Main Branch",
                name_ne="काठमाडौं मुख्य शाखा",
                address="Putalisadak, Kathmandu",
            )
            session.add(branch)
            await session.flush()

            # --- User ---
            user = User(
                staff_id="FO-208",
                name="Ram Bahadur Shah",
                name_ne="राम बहादुर शाह",
                role="field_officer",
                hashed_pin=hash_pin("1234"),
                branch_id=branch.id,
                phone_number="+977-9841234567",
                is_active=True,
            )
            session.add(user)
            await session.flush()

            # --- Branch Manager ---
            manager = User(
                staff_id="BM-001",
                name="Suman Karki",
                name_ne="सुमन कार्की",
                role="branch_manager",
                hashed_pin=hash_pin("1234"),
                branch_id=branch.id,
                phone_number="+977-9841234568",
                is_active=True,
            )
            session.add(manager)
            await session.flush()

            # --- Clients ---
            clients_data = [
                {"member_id": "M-001", "name": "Sita Kumari Thapa", "name_ne": "सिता कुमारी थापा", "center_id": "CTR-001", "center_name": "Kalanki Center", "ward": "12", "loan_cycle": 3, "outstanding_balance": 45000.00, "due_amount": 2500.00, "overdue_days": 0},
                {"member_id": "M-002", "name": "Maya Devi Shrestha", "name_ne": "माया देवी श्रेष्ठ", "center_id": "CTR-001", "center_name": "Kalanki Center", "ward": "12", "loan_cycle": 5, "outstanding_balance": 78000.00, "due_amount": 5200.00, "overdue_days": 7},
                {"member_id": "M-003", "name": "Gita Nepali", "name_ne": "गीता नेपाली", "center_id": "CTR-002", "center_name": "Swoyambhu Center", "ward": "15", "loan_cycle": 2, "outstanding_balance": 32000.00, "due_amount": 1800.00, "overdue_days": 14},
                {"member_id": "M-004", "name": "Laxmi Tamang", "name_ne": "लक्ष्मी तामाङ", "center_id": "CTR-002", "center_name": "Swoyambhu Center", "ward": "15", "loan_cycle": 1, "outstanding_balance": 15000.00, "due_amount": 900.00, "overdue_days": 0},
                {"member_id": "M-005", "name": "Kamala BK", "name_ne": "कमला बीके", "center_id": "CTR-003", "center_name": "Balaju Center", "ward": "16", "loan_cycle": 4, "outstanding_balance": 95000.00, "due_amount": 6800.00, "overdue_days": 21},
                {"member_id": "M-006", "name": "Saraswoti Poudel", "name_ne": "सरस्वती पौडेल", "center_id": "CTR-003", "center_name": "Balaju Center", "ward": "16", "loan_cycle": 2, "outstanding_balance": 28000.00, "due_amount": 1500.00, "overdue_days": 3},
            ]

            clients = []
            for cd in clients_data:
                client = Client(
                    member_id=cd["member_id"], name=cd["name"], name_ne=cd["name_ne"],
                    center_id=cd["center_id"], center_name=cd["center_name"], ward=cd["ward"],
                    loan_cycle=cd["loan_cycle"], outstanding_balance=cd["outstanding_balance"],
                    due_amount=cd["due_amount"],
                    next_installment_date=str(date.today() + timedelta(days=(7 - cd["overdue_days"]))),
                    overdue_days=cd["overdue_days"], status="active",
                )
                session.add(client)
                clients.append(client)
            await session.flush()

            # --- Loan Accounts ---
            for client in clients:
                loan = LoanAccount(
                    client_id=client.id, loan_id=f"LN-{client.member_id}-{client.loan_cycle:03d}",
                    product_type="micro_loan",
                    disbursement_date=str(date.today() - timedelta(days=180)),
                    maturity_date=str(date.today() + timedelta(days=185)),
                    principal_amount=client.outstanding_balance * 1.5,
                    outstanding_balance=client.outstanding_balance,
                    installment_amount=client.due_amount,
                    installment_frequency="weekly",
                    status="overdue" if client.overdue_days > 7 else "active",
                )
                session.add(loan)
            await session.flush()

            # --- Tasks ---
            today_str = str(date.today())
            tasks_data = [
                {"client": clients[0], "task_type": "collection", "priority": "high", "amount": 2500.00},
                {"client": clients[1], "task_type": "collection", "priority": "urgent", "amount": 5200.00},
                {"client": clients[2], "task_type": "follow_up", "priority": "high", "reason": "14 days overdue"},
                {"client": clients[3], "task_type": "collection", "priority": "medium", "amount": 900.00},
                {"client": clients[4], "task_type": "visit", "priority": "urgent", "reason": "21 days overdue — NPA risk"},
                {"client": clients[5], "task_type": "collection", "priority": "medium", "amount": 1500.00},
            ]

            for td in tasks_data:
                task = TaskAssignment(
                    client_id=td["client"].id, user_id=user.id, task_type=td["task_type"],
                    task_date=today_str, status="pending", priority=td["priority"],
                    reason=td.get("reason"), amount=td.get("amount"), is_completed=False,
                )
                session.add(task)

            await session.commit()
            logger.info("Seed data created successfully!")
            logger.info(f"  User: FO-208 / PIN: 1234 / Clients: {len(clients)} / Tasks: {len(tasks_data)}")
        except Exception as e:
            await session.rollback()
            logger.error(f"Seed error: {e}", exc_info=True)
            raise


if __name__ == "__main__":
    asyncio.run(seed_data())
