"""
CBS Integration API — Phase 12A/12B/12C

15 endpoints across 3 phases:
  Phase 12A (Read-only): 7 endpoints — import log, import trigger, CBS clients,
                          client detail, loan schedule, PAR status, summary
  Phase 12B (Reconciliation): 4 endpoints — queue, approve, reject, bulk-approve
  Phase 12C (Write-back): 4 endpoints — submit posting, posting log, reconcile, report
"""
import json
import time
import uuid
import random
import logging
from datetime import date, timedelta, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, update

from app.database import get_db
from app.deps.auth_deps import require_manager_or_admin
from app.models.user import User
from app.models.client import Client
from app.models.collection import Collection
from app.models.cbs import (
    CBSImportLog,
    CBSClientSnapshot,
    CBSLoanSnapshot,
    CBSScheduleItem,
    CollectionEvent,
    CBSPostingLog,
)
from app.schemas.common import ApiResponse

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/cbs",
    tags=["CBS Integration"],
    dependencies=[Depends(require_manager_or_admin)],
)


def _ts() -> int:
    return int(time.time())


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------

class RejectBody(BaseModel):
    note: str | None = None


class BulkApproveBody(BaseModel):
    event_ids: list[int]


class SubmitPostingBody(BaseModel):
    event_ids: list[int]


# ---------------------------------------------------------------------------
# Phase 12A — Read-only CBS Endpoints
# ---------------------------------------------------------------------------

# 1. GET /cbs/import-log

@router.get("/import-log", response_model=ApiResponse)
async def get_import_log(db: AsyncSession = Depends(get_db)):
    """Returns CBS import history, most recent first."""
    try:
        result = await db.execute(
            select(CBSImportLog).order_by(CBSImportLog.started_at.desc()).limit(50)
        )
        logs = result.scalars().all()
        data = []
        for log in logs:
            data.append({
                "id": log.id,
                "source": log.source,
                "status": log.status,
                "record_count": log.record_count,
                "error_message": log.error_message,
                "started_at": str(log.started_at),
                "completed_at": str(log.completed_at) if log.completed_at else None,
            })
        return ApiResponse(success=True, data=data, timestamp=_ts())
    except Exception as e:
        logger.error(f"Import log error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load import log",
        )


# 2. POST /cbs/import — Trigger simulated CBS data import

@router.post("/import", response_model=ApiResponse)
async def trigger_cbs_import(db: AsyncSession = Depends(get_db)):
    """Triggers a simulated CBS data import for all active clients."""
    try:
        # Create import log
        import_log = CBSImportLog(
            source="api",
            status="running",
            record_count=0,
            started_at=datetime.utcnow(),
        )
        db.add(import_log)
        await db.flush()

        # Fetch all active clients
        result = await db.execute(
            select(Client).where(Client.status == "active")
        )
        clients = result.scalars().all()

        if not clients:
            import_log.status = "completed"
            import_log.completed_at = datetime.utcnow()
            return ApiResponse(
                success=True,
                data={
                    "import_id": import_log.id,
                    "clients_imported": 0,
                    "loans_imported": 0,
                    "schedule_items_imported": 0,
                },
                timestamp=_ts(),
            )

        now = datetime.utcnow()
        clients_imported = 0
        loans_imported = 0
        schedule_items_imported = 0

        # PAR status distribution: 4 current, 1 substandard, 1 special mention
        par_statuses = ["current", "current", "current", "current", "substandard", "special mention"]
        random.shuffle(par_statuses)

        for i, client in enumerate(clients):
            par_status = par_statuses[i % len(par_statuses)]

            # Create CBSClientSnapshot — slightly different balance from local (simulate mismatch)
            balance_drift = round(random.uniform(-2000, 2000), 2)
            cbs_balance = round(client.outstanding_balance + balance_drift, 2)
            cbs_due = round(client.due_amount + random.uniform(-200, 200), 2)
            cbs_overdue = max(0, client.overdue_days + random.randint(-3, 5))

            snapshot = CBSClientSnapshot(
                cbs_member_id=f"CBS-{client.member_id}",
                name=client.name,
                name_ne=client.name_ne,
                center_id=client.center_id,
                center_name=client.center_name,
                ward=client.ward,
                loan_cycle=client.loan_cycle,
                status="active",
                outstanding_balance=cbs_balance,
                due_amount=max(0, cbs_due),
                overdue_days=cbs_overdue,
                next_installment_date=client.next_installment_date,
                source="cbs",
                imported_at=now,
            )
            db.add(snapshot)
            await db.flush()
            clients_imported += 1

            # Create CBSLoanSnapshot
            total_installments = random.choice([12, 16, 18, 24])
            paid_installments = random.randint(4, total_installments - 2)
            principal = round(cbs_balance * 1.5, 2)
            installment_amt = round(principal / total_installments, 2)
            disbursement = date.today() - timedelta(days=total_installments * 7)

            loan_snapshot = CBSLoanSnapshot(
                client_id=client.id,
                cbs_loan_id=f"CBS-LN-{client.member_id}-{client.loan_cycle:03d}",
                product_type="micro_loan",
                principal_amount=principal,
                outstanding_balance=cbs_balance,
                installment_amount=installment_amt,
                installment_frequency="weekly",
                disbursement_date=str(disbursement),
                maturity_date=str(disbursement + timedelta(days=total_installments * 7 + 30)),
                par_status=par_status,
                total_installments=total_installments,
                paid_installments=paid_installments,
                last_payment_date=str(date.today() - timedelta(days=random.randint(1, 14))),
                last_payment_amount=installment_amt,
                source="cbs",
                imported_at=now,
            )
            db.add(loan_snapshot)
            await db.flush()
            loans_imported += 1

            # Create CBSScheduleItem records
            num_schedule = random.randint(8, 12)
            for j in range(1, num_schedule + 1):
                due_dt = disbursement + timedelta(weeks=j)
                if j <= paid_installments:
                    sched_status = "paid"
                    paid_amt = installment_amt
                    paid_dt = str(due_dt + timedelta(days=random.randint(-2, 2)))
                    days_ov = 0
                elif j == paid_installments + 1:
                    if cbs_overdue > 0:
                        sched_status = "overdue"
                        days_ov = cbs_overdue
                        # Partially paid sometimes
                        if random.random() < 0.3:
                            paid_amt = round(installment_amt * random.uniform(0.2, 0.8), 2)
                            sched_status = "partially_paid"
                        else:
                            paid_amt = 0.0
                    else:
                        sched_status = "pending"
                        days_ov = 0
                        paid_amt = 0.0
                    paid_dt = None
                else:
                    sched_status = "pending"
                    paid_amt = 0.0
                    paid_dt = None
                    days_ov = 0

                schedule_item = CBSScheduleItem(
                    loan_snapshot_id=loan_snapshot.id,
                    installment_no=j,
                    due_date=str(due_dt),
                    due_amount=installment_amt,
                    paid_amount=paid_amt,
                    status=sched_status,
                    paid_date=paid_dt,
                    days_overdue=days_ov,
                    imported_at=now,
                )
                db.add(schedule_item)
                schedule_items_imported += 1

        # Create sample CollectionEvents for reconciliation testing
        event_statuses = ["pending_review", "pending_review", "pending_review", "approved", "rejected", "posted", "pending_review", "posting_failed"]
        for i, client in enumerate(clients[:6]):
            ev_status = event_statuses[i] if i < len(event_statuses) else "pending_review"
            coll_event = CollectionEvent(
                collection_id=None,
                receipt_id=f"CEV-{date.today().strftime('%Y%m%d')}-{i+1:04d}",
                client_id=client.id,
                member_id=client.member_id,
                client_name=client.name,
                amount=round(random.uniform(500, 7000), 2),
                officer_id=1,
                officer_name="Ram Bahadur Shah",
                event_status=ev_status,
                idempotency_key=f"idem-{uuid.uuid4().hex[:16]}",
                reviewed_at=datetime.utcnow() if ev_status in ("approved", "rejected", "posted") else None,
                reviewed_by=1 if ev_status in ("approved", "rejected", "posted") else None,
                posted_at=datetime.utcnow() if ev_status == "posted" else None,
                created_at=datetime.utcnow() - timedelta(hours=random.randint(1, 48)),
            )
            db.add(coll_event)

        # Mark import as completed
        total_records = clients_imported + loans_imported + schedule_items_imported
        import_log.record_count = total_records
        import_log.status = "completed"
        import_log.completed_at = datetime.utcnow()

        await db.flush()

        return ApiResponse(
            success=True,
            data={
                "import_id": import_log.id,
                "clients_imported": clients_imported,
                "loans_imported": loans_imported,
                "schedule_items_imported": schedule_items_imported,
            },
            timestamp=_ts(),
        )
    except Exception as e:
        logger.error(f"CBS import error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to run CBS import",
        )


# 3. GET /cbs/clients — CBS clients with sync comparison

@router.get("/clients", response_model=ApiResponse)
async def get_cbs_clients(
    search: str | None = Query(None, description="Search by name or member_id"),
    db: AsyncSession = Depends(get_db),
):
    """Returns CBS client snapshots with local vs CBS balance comparison."""
    try:
        # Fetch all CBS snapshots
        stmt = select(CBSClientSnapshot).order_by(CBSClientSnapshot.name)
        if search:
            stmt = stmt.where(
                or_(
                    CBSClientSnapshot.name.ilike(f"%{search}%"),
                    CBSClientSnapshot.cbs_member_id.ilike(f"%{search}%"),
                )
            )
        result = await db.execute(stmt)
        snapshots = result.scalars().all()

        # Build local client map by member_id
        local_result = await db.execute(select(Client))
        local_clients = local_result.scalars().all()
        local_map: dict[str, Client] = {}
        for c in local_clients:
            local_map[c.member_id] = c

        data = []
        for snap in snapshots:
            # Map CBS member_id back to local member_id
            # CBS member_id format: "CBS-M-001" → local "M-001"
            local_member_id = snap.cbs_member_id.replace("CBS-", "")
            local_client = local_map.get(local_member_id)

            cbs_balance = round(snap.outstanding_balance, 2)
            local_balance = round(local_client.outstanding_balance, 2) if local_client else 0.0
            balance_diff = round(cbs_balance - local_balance, 2)

            # Determine sync status
            if local_client is None:
                sync_status = "cbs_only"
            elif abs(balance_diff) < 0.01:
                sync_status = "matched"
            elif not any(
                s for s in [snap.cbs_member_id]
            ):
                sync_status = "local_only"
            else:
                sync_status = "mismatch"

            data.append({
                "id": snap.id,
                "cbs_member_id": snap.cbs_member_id,
                "name": snap.name,
                "name_ne": snap.name_ne,
                "center_name": snap.center_name,
                "ward": snap.ward,
                "loan_cycle": snap.loan_cycle,
                "status": snap.status,
                "cbs_balance": cbs_balance,
                "local_balance": local_balance,
                "balance_diff": balance_diff,
                "sync_status": sync_status,
                "overdue_days": snap.overdue_days,
                "due_amount": round(snap.due_amount, 2),
            })

        return ApiResponse(success=True, data=data, timestamp=_ts())
    except Exception as e:
        logger.error(f"CBS clients error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load CBS clients",
        )


# 4. GET /cbs/clients/{client_id}/detail — Full CBS detail for a client

@router.get("/clients/{client_id}/detail", response_model=ApiResponse)
async def get_cbs_client_detail(
    client_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Returns full CBS detail: client snapshot, loan snapshots, schedule items."""
    try:
        # Get client
        client = (await db.execute(
            select(Client).where(Client.id == client_id)
        )).scalar_one_or_none()

        if not client:
            raise HTTPException(status_code=404, detail="Client not found")

        # Find CBS client snapshot by mapping member_id
        cbs_member_id = f"CBS-{client.member_id}"
        cbs_snapshot = (await db.execute(
            select(CBSClientSnapshot).where(
                CBSClientSnapshot.cbs_member_id == cbs_member_id
            )
        )).scalar_one_or_none()

        # Get all CBS loan snapshots for this client
        loans_result = await db.execute(
            select(CBSLoanSnapshot).where(
                CBSLoanSnapshot.client_id == client_id
            ).order_by(CBSLoanSnapshot.imported_at.desc())
        )
        loan_snapshots = loans_result.scalars().all()

        loans_data = []
        all_schedule_data = []
        for loan in loan_snapshots:
            # Get schedule items for each loan
            sched_result = await db.execute(
                select(CBSScheduleItem).where(
                    CBSScheduleItem.loan_snapshot_id == loan.id
                ).order_by(CBSScheduleItem.installment_no)
            )
            schedule_items = sched_result.scalars().all()

            running_total = 0.0
            schedule_data = []
            for item in schedule_items:
                running_total += item.due_amount
                schedule_data.append({
                    "id": item.id,
                    "installment_no": item.installment_no,
                    "due_date": item.due_date,
                    "due_amount": round(item.due_amount, 2),
                    "paid_amount": round(item.paid_amount, 2),
                    "status": item.status,
                    "paid_date": item.paid_date,
                    "days_overdue": item.days_overdue,
                    "running_total_due": round(running_total, 2),
                })
            all_schedule_data.extend(schedule_data)

            loans_data.append({
                "id": loan.id,
                "cbs_loan_id": loan.cbs_loan_id,
                "product_type": loan.product_type,
                "principal_amount": round(loan.principal_amount, 2),
                "outstanding_balance": round(loan.outstanding_balance, 2),
                "installment_amount": round(loan.installment_amount, 2),
                "installment_frequency": loan.installment_frequency,
                "disbursement_date": loan.disbursement_date,
                "maturity_date": loan.maturity_date,
                "par_status": loan.par_status,
                "total_installments": loan.total_installments,
                "paid_installments": loan.paid_installments,
                "last_payment_date": loan.last_payment_date,
                "last_payment_amount": round(loan.last_payment_amount, 2) if loan.last_payment_amount else None,
                "schedule_items": schedule_data,
                "installment_progress": {
                    "paid": loan.paid_installments,
                    "total": loan.total_installments,
                    "remaining": loan.total_installments - loan.paid_installments,
                    "pct": round(loan.paid_installments / loan.total_installments * 100, 1) if loan.total_installments > 0 else 0.0,
                },
            })

        client_data = None
        if cbs_snapshot:
            client_data = {
                "id": cbs_snapshot.id,
                "cbs_member_id": cbs_snapshot.cbs_member_id,
                "name": cbs_snapshot.name,
                "name_ne": cbs_snapshot.name_ne,
                "center_name": cbs_snapshot.center_name,
                "ward": cbs_snapshot.ward,
                "loan_cycle": cbs_snapshot.loan_cycle,
                "status": cbs_snapshot.status,
                "outstanding_balance": round(cbs_snapshot.outstanding_balance, 2),
                "due_amount": round(cbs_snapshot.due_amount, 2),
                "overdue_days": cbs_snapshot.overdue_days,
                "next_installment_date": cbs_snapshot.next_installment_date,
                "source": cbs_snapshot.source,
                "imported_at": str(cbs_snapshot.imported_at),
            }

        return ApiResponse(
            success=True,
            data={
                "client": client_data,
                "loans": loans_data,
                "total_schedule_items": len(all_schedule_data),
            },
            timestamp=_ts(),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"CBS client detail error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load CBS client detail",
        )


# 5. GET /cbs/loans/{loan_id}/schedule — Due schedule for a specific loan

@router.get("/loans/{loan_id}/schedule", response_model=ApiResponse)
async def get_loan_schedule(
    loan_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Returns the full due schedule for a CBS loan snapshot."""
    try:
        loan = (await db.execute(
            select(CBSLoanSnapshot).where(CBSLoanSnapshot.id == loan_id)
        )).scalar_one_or_none()

        if not loan:
            raise HTTPException(status_code=404, detail="Loan snapshot not found")

        result = await db.execute(
            select(CBSScheduleItem).where(
                CBSScheduleItem.loan_snapshot_id == loan_id
            ).order_by(CBSScheduleItem.installment_no)
        )
        items = result.scalars().all()

        running_total = 0.0
        paid_running = 0.0
        schedule_data = []
        for item in items:
            running_total += item.due_amount
            paid_running += item.paid_amount
            schedule_data.append({
                "id": item.id,
                "installment_no": item.installment_no,
                "due_date": item.due_date,
                "due_amount": round(item.due_amount, 2),
                "paid_amount": round(item.paid_amount, 2),
                "status": item.status,
                "paid_date": item.paid_date,
                "days_overdue": item.days_overdue,
                "running_total_due": round(running_total, 2),
                "running_total_paid": round(paid_running, 2),
            })

        return ApiResponse(
            success=True,
            data={
                "loan": {
                    "id": loan.id,
                    "cbs_loan_id": loan.cbs_loan_id,
                    "par_status": loan.par_status,
                    "outstanding_balance": round(loan.outstanding_balance, 2),
                },
                "schedule": schedule_data,
                "installment_progress": {
                    "paid": loan.paid_installments,
                    "total": loan.total_installments,
                    "remaining": loan.total_installments - loan.paid_installments,
                    "pct": round(loan.paid_installments / loan.total_installments * 100, 1) if loan.total_installments > 0 else 0.0,
                },
            },
            timestamp=_ts(),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Loan schedule error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load loan schedule",
        )


# 6. GET /cbs/par-status — PAR status summary

@router.get("/par-status", response_model=ApiResponse)
async def get_par_status(
    par_status: str | None = Query(None, description="Filter by PAR status"),
    db: AsyncSession = Depends(get_db),
):
    """Returns PAR status summary with breakdown and ratio."""
    try:
        stmt = select(CBSLoanSnapshot)
        if par_status:
            stmt = stmt.where(CBSLoanSnapshot.par_status == par_status)
        result = await db.execute(stmt)
        all_loans = result.scalars().all()

        total_loans = len(all_loans)
        total_outstanding = sum(l.outstanding_balance for l in all_loans)

        # Breakdown by par_status
        breakdown: dict[str, dict] = {}
        for loan in all_loans:
            ps = loan.par_status or "current"
            if ps not in breakdown:
                breakdown[ps] = {"count": 0, "outstanding": 0.0}
            breakdown[ps]["count"] += 1
            breakdown[ps]["outstanding"] = round(breakdown[ps]["outstanding"] + loan.outstanding_balance, 2)

        # PAR ratio: (substandard + doubtful + loss) / total
        par_categories = ["substandard", "doubtful", "loss"]
        par_outstanding = sum(
            breakdown.get(ps, {}).get("outstanding", 0.0) for ps in par_categories
        )
        par_ratio = round(par_outstanding / total_outstanding * 100, 2) if total_outstanding > 0 else 0.0

        # Non-current loans
        non_current = [
            {
                "id": l.id,
                "cbs_loan_id": l.cbs_loan_id,
                "par_status": l.par_status,
                "outstanding_balance": round(l.outstanding_balance, 2),
                "client_id": l.client_id,
                "product_type": l.product_type,
            }
            for l in all_loans
            if l.par_status != "current"
        ]

        return ApiResponse(
            success=True,
            data={
                "total_loans": total_loans,
                "total_outstanding": round(total_outstanding, 2),
                "breakdown": breakdown,
                "par_ratio": par_ratio,
                "par_outstanding": round(par_outstanding, 2),
                "non_current_loans": non_current,
            },
            timestamp=_ts(),
        )
    except Exception as e:
        logger.error(f"PAR status error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load PAR status",
        )


# 7. GET /cbs/summary — CBS integration summary

@router.get("/summary", response_model=ApiResponse)
async def get_cbs_summary(db: AsyncSession = Depends(get_db)):
    """Returns CBS integration summary with key metrics."""
    try:
        # Last import
        last_import_result = await db.execute(
            select(CBSImportLog)
            .where(CBSImportLog.status == "completed")
            .order_by(CBSImportLog.started_at.desc())
            .limit(1)
        )
        last_import = last_import_result.scalar_one_or_none()

        # Counts
        total_clients = (await db.execute(
            select(func.count()).select_from(CBSClientSnapshot)
        )).scalar() or 0

        total_loans = (await db.execute(
            select(func.count()).select_from(CBSLoanSnapshot)
        )).scalar() or 0

        total_schedule_items = (await db.execute(
            select(func.count()).select_from(CBSScheduleItem)
        )).scalar() or 0

        # Mismatched clients
        local_result = await db.execute(select(Client))
        local_clients = local_result.scalars().all()
        local_map = {c.member_id: c.outstanding_balance for c in local_clients}

        cbs_result = await db.execute(select(CBSClientSnapshot))
        cbs_snapshots = cbs_result.scalars().all()
        mismatched = 0
        for snap in cbs_snapshots:
            local_mid = snap.cbs_member_id.replace("CBS-", "")
            local_bal = local_map.get(local_mid, 0.0)
            if abs(round(snap.outstanding_balance, 2) - round(local_bal, 2)) >= 0.01:
                mismatched += 1

        # PAR ratio
        all_loans = (await db.execute(select(CBSLoanSnapshot))).scalars().all()
        total_outstanding = sum(l.outstanding_balance for l in all_loans)
        par_categories = ["substandard", "doubtful", "loss"]
        par_outstanding = sum(l.outstanding_balance for l in all_loans if l.par_status in par_categories)
        par_ratio = round(par_outstanding / total_outstanding * 100, 2) if total_outstanding > 0 else 0.0

        return ApiResponse(
            success=True,
            data={
                "last_import": {
                    "id": last_import.id,
                    "source": last_import.source,
                    "started_at": str(last_import.started_at),
                    "completed_at": str(last_import.completed_at) if last_import.completed_at else None,
                    "record_count": last_import.record_count,
                } if last_import else None,
                "total_clients": total_clients,
                "total_loans": total_loans,
                "total_schedule_items": total_schedule_items,
                "mismatched_clients": mismatched,
                "par_ratio": par_ratio,
            },
            timestamp=_ts(),
        )
    except Exception as e:
        logger.error(f"CBS summary error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load CBS summary",
        )


# ---------------------------------------------------------------------------
# Phase 12B — Event Reconciliation Endpoints
# ---------------------------------------------------------------------------

# 8. GET /cbs/reconciliation/queue — Pending collection events for review

@router.get("/reconciliation/queue", response_model=ApiResponse)
async def get_reconciliation_queue(
    event_status: str | None = Query(None, description="Filter by status"),
    db: AsyncSession = Depends(get_db),
):
    """Returns collection events for reconciliation review."""
    try:
        stmt = (
            select(CollectionEvent)
            .order_by(CollectionEvent.created_at.desc())
        )
        if event_status:
            stmt = stmt.where(CollectionEvent.event_status == event_status)

        result = await db.execute(stmt)
        events = result.scalars().all()

        data = []
        for ev in events:
            # Get client info
            client_info = None
            if ev.client_id:
                client = (await db.execute(
                    select(Client).where(Client.id == ev.client_id)
                )).scalar_one_or_none()
                if client:
                    client_info = {
                        "id": client.id,
                        "member_id": client.member_id,
                        "name": client.name,
                        "center_name": client.center_name,
                    }

            # Get reviewer info
            reviewer_name = None
            if ev.reviewed_by:
                reviewer = (await db.execute(
                    select(User).where(User.id == ev.reviewed_by)
                )).scalar_one_or_none()
                if reviewer:
                    reviewer_name = reviewer.name

            data.append({
                "id": ev.id,
                "collection_id": ev.collection_id,
                "receipt_id": ev.receipt_id,
                "client_id": ev.client_id,
                "member_id": ev.member_id,
                "client_name": ev.client_name,
                "client": client_info,
                "amount": round(ev.amount, 2),
                "officer_id": ev.officer_id,
                "officer_name": ev.officer_name,
                "event_status": ev.event_status,
                "idempotency_key": ev.idempotency_key,
                "reviewed_by": ev.reviewed_by,
                "reviewer_name": reviewer_name,
                "reviewed_at": str(ev.reviewed_at) if ev.reviewed_at else None,
                "review_note": ev.review_note,
                "posted_at": str(ev.posted_at) if ev.posted_at else None,
                "cbs_posting_ref": ev.cbs_posting_ref,
                "created_at": str(ev.created_at),
                "updated_at": str(ev.updated_at),
            })

        return ApiResponse(success=True, data=data, timestamp=_ts())
    except Exception as e:
        logger.error(f"Reconciliation queue error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load reconciliation queue",
        )


# 9. POST /cbs/reconciliation/{event_id}/approve — Approve a collection event

@router.post("/reconciliation/{event_id}/approve", response_model=ApiResponse)
async def approve_collection_event(
    event_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Approves a collection event for CBS posting."""
    try:
        event = (await db.execute(
            select(CollectionEvent).where(CollectionEvent.id == event_id)
        )).scalar_one_or_none()

        if not event:
            raise HTTPException(status_code=404, detail="Collection event not found")

        if event.event_status != "pending_review":
            raise HTTPException(
                status_code=400,
                detail=f"Cannot approve event with status '{event.event_status}'. Must be 'pending_review'.",
            )

        event.event_status = "approved"
        event.reviewed_by = 1  # Default reviewer (manager)
        event.reviewed_at = datetime.utcnow()
        event.updated_at = datetime.utcnow()
        await db.flush()

        return ApiResponse(
            success=True,
            data={
                "id": event.id,
                "receipt_id": event.receipt_id,
                "event_status": event.event_status,
                "reviewed_by": event.reviewed_by,
                "reviewed_at": str(event.reviewed_at),
            },
            timestamp=_ts(),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Approve event error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to approve collection event",
        )


# 10. POST /cbs/reconciliation/{event_id}/reject — Reject a collection event

@router.post("/reconciliation/{event_id}/reject", response_model=ApiResponse)
async def reject_collection_event(
    event_id: int,
    body: RejectBody | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Rejects a collection event."""
    try:
        event = (await db.execute(
            select(CollectionEvent).where(CollectionEvent.id == event_id)
        )).scalar_one_or_none()

        if not event:
            raise HTTPException(status_code=404, detail="Collection event not found")

        if event.event_status != "pending_review":
            raise HTTPException(
                status_code=400,
                detail=f"Cannot reject event with status '{event.event_status}'. Must be 'pending_review'.",
            )

        event.event_status = "rejected"
        event.reviewed_by = 1
        event.reviewed_at = datetime.utcnow()
        event.review_note = body.note if body and body.note else None
        event.updated_at = datetime.utcnow()
        await db.flush()

        return ApiResponse(
            success=True,
            data={
                "id": event.id,
                "receipt_id": event.receipt_id,
                "event_status": event.event_status,
                "reviewed_by": event.reviewed_by,
                "reviewed_at": str(event.reviewed_at),
                "review_note": event.review_note,
            },
            timestamp=_ts(),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Reject event error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reject collection event",
        )


# 11. POST /cbs/reconciliation/bulk-approve — Bulk approve events

@router.post("/reconciliation/bulk-approve", response_model=ApiResponse)
async def bulk_approve_events(
    body: BulkApproveBody,
    db: AsyncSession = Depends(get_db),
):
    """Bulk-approves multiple collection events."""
    try:
        if not body.event_ids:
            raise HTTPException(status_code=400, detail="event_ids must be a non-empty list")

        approved_count = 0
        errors: list[dict] = []
        now = datetime.utcnow()

        for eid in body.event_ids:
            event = (await db.execute(
                select(CollectionEvent).where(CollectionEvent.id == eid)
            )).scalar_one_or_none()

            if not event:
                errors.append({"event_id": eid, "error": "not_found"})
                continue

            if event.event_status != "pending_review":
                errors.append({
                    "event_id": eid,
                    "error": f"invalid_status: {event.event_status}",
                })
                continue

            event.event_status = "approved"
            event.reviewed_by = 1
            event.reviewed_at = now
            event.updated_at = now
            approved_count += 1

        await db.flush()

        return ApiResponse(
            success=True,
            data={
                "approved_count": approved_count,
                "errors": errors,
            },
            timestamp=_ts(),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Bulk approve error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to bulk approve events",
        )


# ---------------------------------------------------------------------------
# Phase 12C — Controlled Write-back Endpoints
# ---------------------------------------------------------------------------

# 12. POST /cbs/posting/submit — Submit approved events for CBS posting

@router.post("/posting/submit", response_model=ApiResponse)
async def submit_posting(
    body: SubmitPostingBody,
    db: AsyncSession = Depends(get_db),
):
    """Submits approved collection events for CBS posting (simulated)."""
    try:
        if not body.event_ids:
            raise HTTPException(status_code=400, detail="event_ids must be a non-empty list")

        posted_count = 0
        failed_count = 0
        results: list[dict] = []
        now = datetime.utcnow()

        for eid in body.event_ids:
            event = (await db.execute(
                select(CollectionEvent).where(CollectionEvent.id == eid)
            )).scalar_one_or_none()

            if not event:
                results.append({"event_id": eid, "status": "failed", "error": "not_found"})
                failed_count += 1
                continue

            if event.event_status != "approved":
                results.append({
                    "event_id": eid,
                    "status": "failed",
                    "error": f"invalid_status: {event.event_status}",
                })
                failed_count += 1
                continue

            # Simulate CBS posting (90% success rate)
            success = random.random() < 0.9
            idem_key = event.idempotency_key

            request_payload = json.dumps({
                "receipt_id": event.receipt_id,
                "member_id": event.member_id,
                "client_id": event.client_id,
                "amount": event.amount,
                "idempotency_key": idem_key,
                "timestamp": str(now),
            })

            if success:
                cbs_ref = f"CBS-REF-{uuid.uuid4().hex[:12].upper()}"
                response_payload = json.dumps({
                    "status": "posted",
                    "cbs_reference": cbs_ref,
                    "posted_amount": event.amount,
                    "posted_at": str(now),
                })

                event.event_status = "posted"
                event.posted_at = now
                event.cbs_posting_ref = cbs_ref
                event.updated_at = now

                posting_log = CBSPostingLog(
                    event_id=event.id,
                    idempotency_key=idem_key,
                    amount=event.amount,
                    client_id=event.client_id,
                    receipt_id=event.receipt_id,
                    status="success",
                    request_payload=request_payload,
                    response_payload=response_payload,
                    created_at=now,
                )
                db.add(posting_log)
                posted_count += 1
                results.append({
                    "event_id": eid,
                    "receipt_id": event.receipt_id,
                    "status": "posted",
                    "cbs_reference": cbs_ref,
                })
            else:
                error_msg = "CBS system timeout — please retry"
                response_payload = json.dumps({
                    "status": "failed",
                    "error": error_msg,
                })

                event.event_status = "posting_failed"
                event.updated_at = now

                posting_log = CBSPostingLog(
                    event_id=event.id,
                    idempotency_key=idem_key,
                    amount=event.amount,
                    client_id=event.client_id,
                    receipt_id=event.receipt_id,
                    status="failed",
                    request_payload=request_payload,
                    response_payload=response_payload,
                    error_message=error_msg,
                    created_at=now,
                )
                db.add(posting_log)
                failed_count += 1
                results.append({
                    "event_id": eid,
                    "receipt_id": event.receipt_id,
                    "status": "posting_failed",
                    "error": error_msg,
                })

        await db.flush()

        return ApiResponse(
            success=True,
            data={
                "posted_count": posted_count,
                "failed_count": failed_count,
                "results": results,
            },
            timestamp=_ts(),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Submit posting error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to submit posting",
        )


# 13. GET /cbs/posting/log — CBS posting history

@router.get("/posting/log", response_model=ApiResponse)
async def get_posting_log(
    posting_status: str | None = Query(None, description="Filter by status"),
    db: AsyncSession = Depends(get_db),
):
    """Returns CBS posting log history."""
    try:
        stmt = select(CBSPostingLog).order_by(CBSPostingLog.created_at.desc())
        if posting_status:
            stmt = stmt.where(CBSPostingLog.status == posting_status)

        result = await db.execute(stmt)
        logs = result.scalars().all()

        data = []
        for log in logs:
            # Get associated event info
            event_info = None
            if log.event_id:
                event = (await db.execute(
                    select(CollectionEvent).where(CollectionEvent.id == log.event_id)
                )).scalar_one_or_none()
                if event:
                    event_info = {
                        "receipt_id": event.receipt_id,
                        "client_name": event.client_name,
                        "amount": round(event.amount, 2),
                    }

            data.append({
                "id": log.id,
                "event_id": log.event_id,
                "event": event_info,
                "idempotency_key": log.idempotency_key,
                "amount": round(log.amount, 2),
                "client_id": log.client_id,
                "receipt_id": log.receipt_id,
                "status": log.status,
                "error_message": log.error_message,
                "created_at": str(log.created_at),
                "reconciled_at": str(log.reconciled_at) if log.reconciled_at else None,
            })

        return ApiResponse(success=True, data=data, timestamp=_ts())
    except Exception as e:
        logger.error(f"Posting log error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load posting log",
        )


# 14. POST /cbs/posting/{posting_id}/reconcile — Mark a posting as reconciled

@router.post("/posting/{posting_id}/reconcile", response_model=ApiResponse)
async def reconcile_posting(
    posting_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Marks a CBS posting as reconciled."""
    try:
        posting = (await db.execute(
            select(CBSPostingLog).where(CBSPostingLog.id == posting_id)
        )).scalar_one_or_none()

        if not posting:
            raise HTTPException(status_code=404, detail="Posting log not found")

        if posting.status != "success":
            raise HTTPException(
                status_code=400,
                detail=f"Cannot reconcile posting with status '{posting.status}'. Must be 'success'.",
            )

        posting.status = "reconciled"
        posting.reconciled_at = datetime.utcnow()
        await db.flush()

        return ApiResponse(
            success=True,
            data={
                "id": posting.id,
                "receipt_id": posting.receipt_id,
                "status": posting.status,
                "reconciled_at": str(posting.reconciled_at),
            },
            timestamp=_ts(),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Reconcile posting error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reconcile posting",
        )


# 15. GET /cbs/reconciliation/report — Reconciliation summary report

@router.get("/reconciliation/report", response_model=ApiResponse)
async def get_reconciliation_report(db: AsyncSession = Depends(get_db)):
    """Returns a comprehensive reconciliation summary report."""
    try:
        # Event counts by status
        all_events = (await db.execute(select(CollectionEvent))).scalars().all()
        total_events = len(all_events)

        status_breakdown: dict[str, int] = {}
        for ev in all_events:
            status_breakdown[ev.event_status] = status_breakdown.get(ev.event_status, 0) + 1

        # Amount totals
        total_submitted = sum(ev.amount for ev in all_events)
        total_posted = sum(ev.amount for ev in all_events if ev.event_status == "posted")
        total_rejected = sum(ev.amount for ev in all_events if ev.event_status == "rejected")
        total_approved = sum(ev.amount for ev in all_events if ev.event_status == "approved")

        # Posting success rate
        posted_events = [ev for ev in all_events if ev.event_status in ("posted", "posting_failed")]
        success_events = [ev for ev in all_events if ev.event_status == "posted"]
        posting_success_rate = (
            round(len(success_events) / len(posted_events) * 100, 1)
            if posted_events else 0.0
        )

        # Pending review count
        pending_review_count = status_breakdown.get("pending_review", 0)

        # Mismatched clients from CBS
        local_result = await db.execute(select(Client))
        local_clients = local_result.scalars().all()
        local_map = {c.member_id: c.outstanding_balance for c in local_clients}

        cbs_result = await db.execute(select(CBSClientSnapshot))
        cbs_snapshots = cbs_result.scalars().all()
        mismatched_count = 0
        for snap in cbs_snapshots:
            local_mid = snap.cbs_member_id.replace("CBS-", "")
            local_bal = local_map.get(local_mid, 0.0)
            if abs(round(snap.outstanding_balance, 2) - round(local_bal, 2)) >= 0.01:
                mismatched_count += 1

        # PAR ratio
        all_loans = (await db.execute(select(CBSLoanSnapshot))).scalars().all()
        total_outstanding = sum(l.outstanding_balance for l in all_loans)
        par_categories = ["substandard", "doubtful", "loss"]
        par_outstanding = sum(l.outstanding_balance for l in all_loans if l.par_status in par_categories)
        par_ratio = round(par_outstanding / total_outstanding * 100, 2) if total_outstanding > 0 else 0.0

        # Last import
        last_import_result = await db.execute(
            select(CBSImportLog)
            .where(CBSImportLog.status == "completed")
            .order_by(CBSImportLog.started_at.desc())
            .limit(1)
        )
        last_import = last_import_result.scalar_one_or_none()

        return ApiResponse(
            success=True,
            data={
                "total_events": total_events,
                "status_breakdown": status_breakdown,
                "total_amount_submitted": round(total_submitted, 2),
                "total_amount_posted": round(total_posted, 2),
                "total_amount_approved": round(total_approved, 2),
                "total_amount_rejected": round(total_rejected, 2),
                "posting_success_rate": posting_success_rate,
                "pending_review_count": pending_review_count,
                "mismatched_count": mismatched_count,
                "par_ratio": par_ratio,
                "last_import_at": str(last_import.started_at) if last_import else None,
            },
            timestamp=_ts(),
        )
    except Exception as e:
        logger.error(f"Reconciliation report error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load reconciliation report",
        )
