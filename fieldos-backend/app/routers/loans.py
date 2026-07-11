"""
Loan origination lifecycle: application → approval → disbursement (+ schedule generation).

Roles:
  - Field officer (any authenticated user) submits applications.
  - Branch manager / admin approves and disburses (sensitive actions, audited + RBAC).
"""
import time
import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.models.loan_account import LoanAccount
from app.models.loan_schedule import LoanScheduleItem
from app.models.client import Client
from app.models.user import User
from app.schemas.loan import LoanApplicationCreate, LoanDisburseRequest, LoanResponse
from app.schemas.common import ApiResponse
from app.services.audit_helper import write_audit
from app.deps.auth_deps import get_current_user, require_manager_or_admin
from app.utils.nepal_time import now_nepal, today_nepal_str

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/loans", tags=["Loans"])


def _loan_dict(loan: LoanAccount) -> dict:
    return LoanResponse(
        id=loan.id, loan_id=loan.loan_id, client_id=loan.client_id,
        product_type=loan.product_type, principal_amount=loan.principal_amount,
        outstanding_balance=loan.outstanding_balance, installment_amount=loan.installment_amount,
        installment_frequency=loan.installment_frequency, status=loan.status,
        disbursement_date=loan.disbursement_date, maturity_date=loan.maturity_date,
    ).model_dump()


@router.post("/applications", response_model=ApiResponse)
async def submit_application(
    request: LoanApplicationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Field officer submits a loan application → creates a loan in 'pending' status."""
    try:
        client = (await db.execute(select(Client).where(Client.id == request.client_id))).scalar_one_or_none()
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")

        # Human-readable loan id: LN-<member>-<seq>
        count = (await db.execute(select(func.count()).select_from(LoanAccount))).scalar() or 0
        loan_id = f"LN-{client.member_id}-{count + 1:04d}"

        # Flat-interest installment: (principal + principal*rate*term/52weeks) / term
        principal = float(request.principal_amount)
        weeks = max(1, int(request.term_weeks))
        interest_total = principal * (float(request.interest_rate_pct) / 100.0) * (weeks / 52.0)
        installment = round((principal + interest_total) / weeks, 2)

        loan = LoanAccount(
            client_id=client.id,
            loan_id=loan_id,
            product_type=request.product_type,
            principal_amount=principal,
            outstanding_balance=0.0,        # nothing owed until disbursed
            installment_amount=installment,
            installment_frequency="weekly",
            term_weeks=weeks,
            status="pending",               # awaiting manager approval
        )
        db.add(loan)
        await db.flush()

        await write_audit(
            db, current_user, "loan_application_submitted",
            entity_type="loan", entity_id=loan.loan_id,
            meta={"client_id": client.id, "principal": principal, "term_weeks": weeks},
        )
        await db.commit()
        return ApiResponse(success=True, data=_loan_dict(loan), timestamp=int(time.time()))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Loan application error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Loan application failed")


@router.get("/", response_model=ApiResponse, dependencies=[Depends(get_current_user)])
async def list_loans(
    status_filter: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List loans, optionally by status (pending/approved/active/rejected)."""
    q = select(LoanAccount).order_by(LoanAccount.id.desc())
    if status_filter:
        q = q.where(LoanAccount.status == status_filter)
    loans = (await db.execute(q)).scalars().all()
    # attach client name for the dashboard queue
    data = []
    for ln in loans:
        c = (await db.execute(select(Client).where(Client.id == ln.client_id))).scalar_one_or_none()
        d = _loan_dict(ln)
        d["client_name"] = c.name if c else None
        d["member_id"] = c.member_id if c else None
        data.append(d)
    return ApiResponse(success=True, data=data, timestamp=int(time.time()))


@router.post("/{loan_id}/approve", response_model=ApiResponse,
             dependencies=[Depends(require_manager_or_admin)])
async def approve_loan(
    loan_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manager approves a pending loan application."""
    try:
        loan = (await db.execute(select(LoanAccount).where(LoanAccount.loan_id == loan_id))).scalar_one_or_none()
        if not loan:
            raise HTTPException(status_code=404, detail="Loan not found")
        if loan.status != "pending":
            raise HTTPException(status_code=409, detail=f"Loan is '{loan.status}', not pending")

        loan.status = "approved"
        await write_audit(
            db, current_user, "loan_approved",
            entity_type="loan", entity_id=loan.loan_id,
            meta={"principal": loan.principal_amount},
        )
        await db.commit()
        return ApiResponse(success=True, data=_loan_dict(loan), timestamp=int(time.time()))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Approve loan error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Loan approval failed")


@router.post("/{loan_id}/disburse", response_model=ApiResponse,
             dependencies=[Depends(require_manager_or_admin)])
async def disburse_loan(
    loan_id: str,
    request: LoanDisburseRequest = LoanDisburseRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manager disburses an approved loan: activates it, generates the repayment schedule,
    and updates the borrower's outstanding/due for collection."""
    try:
        loan = (await db.execute(select(LoanAccount).where(LoanAccount.loan_id == loan_id))).scalar_one_or_none()
        if not loan:
            raise HTTPException(status_code=404, detail="Loan not found")
        if loan.status != "approved":
            raise HTTPException(status_code=409, detail=f"Loan is '{loan.status}', must be approved before disbursement")

        disb = request.disbursement_date or today_nepal_str()
        start = now_nepal().date()
        installment = loan.installment_amount
        n = max(1, int(loan.term_weeks))
        total_to_collect = round(installment * n, 2)

        # Generate weekly schedule
        per_principal = round(loan.principal_amount / n, 2)
        for i in range(1, n + 1):
            due = (start + timedelta(weeks=i)).isoformat()
            db.add(LoanScheduleItem(
                loan_id=loan.id, installment_no=i, due_date=due,
                amount=installment, principal_component=per_principal,
                interest_component=round(installment - per_principal, 2),
            ))

        loan.status = "active"
        loan.disbursement_date = disb
        loan.maturity_date = (start + timedelta(weeks=n)).isoformat()
        loan.outstanding_balance = total_to_collect

        # Make the loan collectable: set client due to the first installment.
        client = (await db.execute(select(Client).where(Client.id == loan.client_id))).scalar_one_or_none()
        if client:
            client.outstanding_balance = total_to_collect
            client.due_amount = installment
            client.next_installment_date = (start + timedelta(weeks=1)).isoformat()
            client.status = "active"

        await write_audit(
            db, current_user, "loan_disbursed",
            entity_type="loan", entity_id=loan.loan_id,
            meta={"principal": loan.principal_amount, "installments": n,
                  "installment_amount": installment, "disbursement_date": disb},
        )
        await db.commit()
        result = _loan_dict(loan)
        result["schedule_installments"] = n
        return ApiResponse(success=True, data=result, timestamp=int(time.time()))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Disburse loan error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Loan disbursement failed")


@router.get("/{loan_id}/schedule", response_model=ApiResponse,
            dependencies=[Depends(get_current_user)])
async def get_schedule(loan_id: str, db: AsyncSession = Depends(get_db)):
    loan = (await db.execute(select(LoanAccount).where(LoanAccount.loan_id == loan_id))).scalar_one_or_none()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    items = (await db.execute(
        select(LoanScheduleItem).where(LoanScheduleItem.loan_id == loan.id).order_by(LoanScheduleItem.installment_no)
    )).scalars().all()
    return ApiResponse(
        success=True,
        data=[{"installment_no": it.installment_no, "due_date": it.due_date,
               "amount": it.amount, "is_paid": it.is_paid} for it in items],
        timestamp=int(time.time()),
    )
