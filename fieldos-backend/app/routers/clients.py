import time
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.models.client import Client
from app.models.loan_account import LoanAccount
from app.models.collection import Collection
from app.models.user import User
from app.schemas.common import ApiResponse, PaginatedResponse
from app.schemas.loan import BorrowerCreate
from app.services.audit_helper import write_audit
from app.deps.auth_deps import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/clients",
    tags=["Clients"],
    dependencies=[Depends(get_current_user)],  # all client data requires a valid token
)


@router.post("/", response_model=ApiResponse)
async def register_borrower(
    request: BorrowerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Field officer registers a new borrower. Auto-assigns the next member id."""
    try:
        count = (await db.execute(select(func.count()).select_from(Client))).scalar() or 0
        member_id = f"M-{count + 1:03d}"
        client = Client(
            member_id=member_id,
            name=request.name,
            name_ne=request.name_ne,
            center_id=request.center_id,
            center_name=request.center_name,
            ward=request.ward,
            loan_cycle=1,
            outstanding_balance=0.0,
            due_amount=0.0,
            overdue_days=0,
            status="active",
        )
        db.add(client)
        await db.flush()
        await write_audit(
            db, current_user, "borrower_registered",
            entity_type="client", entity_id=member_id,
            meta={"name": request.name},
        )
        await db.commit()
        return ApiResponse(
            success=True,
            data={"id": client.id, "member_id": client.member_id, "name": client.name},
            timestamp=int(time.time()),
        )
    except Exception as e:
        logger.error(f"Register borrower error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Borrower registration failed")


def _client_to_dict(client: Client) -> dict:
    return {
        "id": client.id,
        "member_id": client.member_id,
        "name": client.name,
        "name_ne": client.name_ne,
        "center_id": client.center_id,
        "center_name": client.center_name,
        "ward": client.ward,
        "outstanding_balance": client.outstanding_balance,
        "due_amount": client.due_amount,
        "overdue_days": client.overdue_days,
        "status": client.status,
        "loan_cycle": client.loan_cycle,
        "next_installment_date": client.next_installment_date,
    }


@router.get("/", response_model=PaginatedResponse)
@router.get("", response_model=PaginatedResponse, include_in_schema=False)
async def get_clients(
    search: str | None = Query(None, description="Search by name or member_id"),
    center_id: str | None = Query(None, description="Filter by center"),
    status_filter: str | None = Query(None, alias="status", description="Filter by status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        query = select(Client)

        # Officer-scope: a field officer sees only their OWN book of business
        # (clients they have a task assignment for). Managers/admins see all.
        # Without this, the client picker and search leak every officer's
        # borrowers onto one shared device.
        if current_user.role == "field_officer":
            from app.models.task import TaskAssignment
            own_client_ids = select(TaskAssignment.client_id).where(
                TaskAssignment.user_id == current_user.id
            )
            query = query.where(Client.id.in_(own_client_ids))

        if search:
            query = query.where(
                (Client.name.ilike(f"%{search}%")) | (Client.member_id.ilike(f"%{search}%"))
            )
        if center_id:
            query = query.where(Client.center_id == center_id)
        if status_filter:
            query = query.where(Client.status == status_filter)

        from sqlalchemy import func
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        query = query.order_by(Client.name).offset((page - 1) * page_size).limit(page_size)
        result = await db.execute(query)
        clients = result.scalars().all()

        return PaginatedResponse(
            success=True,
            data=[_client_to_dict(c) for c in clients],
            pagination={
                "page": page,
                "page_size": page_size,
                "total": total,
                "pages": (total + page_size - 1) // page_size if total > 0 else 1,
            },
            timestamp=int(time.time()),
        )
    except Exception as e:
        logger.error(f"Get clients error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get clients")


@router.get("/{client_id}", response_model=ApiResponse)
async def get_client_detail(client_id: int, db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(select(Client).where(Client.id == client_id))
        client = result.scalar_one_or_none()
        if not client:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")

        client_data = _client_to_dict(client)

        # Get loans
        loans_result = await db.execute(
            select(LoanAccount).where(LoanAccount.client_id == client_id)
        )
        loans = loans_result.scalars().all()
        client_data["loans"] = [
            {
                "id": la.id,
                "loan_id": la.loan_id,
                "product_type": la.product_type,
                "principal_amount": la.principal_amount,
                "outstanding_balance": la.outstanding_balance,
                "installment_amount": la.installment_amount,
                "status": la.status,
                "disbursement_date": la.disbursement_date,
                "maturity_date": la.maturity_date,
            }
            for la in loans
        ]

        # Get recent collections
        collections_result = await db.execute(
            select(Collection)
            .where(Collection.client_id == client_id)
            .order_by(Collection.id.desc())
            .limit(10)
        )
        collections = collections_result.scalars().all()
        client_data["recent_collections"] = [
            {
                "id": col.id,
                "receipt_id": col.receipt_id,
                "amount": col.amount,
                "collected_at": col.collected_at,
            }
            for col in collections
        ]

        return ApiResponse(
            success=True,
            data=client_data,
            timestamp=int(time.time()),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get client detail error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get client detail")
