"""
CBS data bridge (read-first integration).

  - POST /data/import-clients : upsert the institution's client/loan-balance list from a CSV
    they export from their core-banking system. Match by member_id.
  - GET  /data/postings       : the day's collections as a CSV "postings file" the finance team
    imports back into the CBS. We do NOT write to the CBS directly (avoids double-posting).

JSON in / JSON out so it works through the dashboard proxy (no multipart, no non-JSON responses).
When you have the institution's real export, adjust the column names in `_num`/row reads below.
"""
import csv
import io
import time
import logging

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.client import Client
from app.models.collection import Collection
from app.models.user import User
from app.schemas.common import ApiResponse
from app.deps.auth_deps import require_manager_or_admin, get_current_user
from app.services.audit_helper import write_audit
from app.utils.nepal_time import today_nepal_str

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/data", tags=["Data Import/Export"])

CLIENT_TEMPLATE = "member_id,name,phone_number,center_id,center_name,ward,outstanding_balance,due_amount,next_installment_date,overdue_days"


class ImportClientsRequest(BaseModel):
    csv_text: str


def _num(row: dict, key: str, default: float = 0.0) -> float:
    v = (row.get(key) or "").strip()
    try:
        return float(v) if v else default
    except ValueError:
        return default


@router.get("/import-clients/template", response_model=ApiResponse,
            dependencies=[Depends(require_manager_or_admin)])
async def import_template():
    """The exact CSV header the importer expects, so the institution can map their CBS export."""
    return ApiResponse(success=True, data={"header": CLIENT_TEMPLATE,
                                           "example": f"{CLIENT_TEMPLATE}\nM-201,Bishnu Maya Rai,+977-9800000201,CTR-001,Kalanki Center,12,45000,2500,2026-07-20,0"},
                       timestamp=int(time.time()))


@router.post("/import-clients", response_model=ApiResponse,
             dependencies=[Depends(require_manager_or_admin)])
async def import_clients(
    body: ImportClientsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upsert clients from a CSV the institution exported from their CBS. Match by member_id:
    existing members are updated (balances refreshed), new members are created."""
    try:
        reader = csv.DictReader(io.StringIO(body.csv_text.lstrip("﻿")))
        created = updated = 0
        errors: list[str] = []
        for i, row in enumerate(reader, start=2):  # row 1 is the header
            member_id = (row.get("member_id") or "").strip()
            if not member_id:
                errors.append(f"row {i}: missing member_id")
                continue
            try:
                existing = (await db.execute(select(Client).where(Client.member_id == member_id))).scalar_one_or_none()
                overdue = int(_num(row, "overdue_days"))
                if existing:
                    if row.get("name"): existing.name = row["name"].strip()
                    if row.get("phone_number"): existing.phone_number = row["phone_number"].strip()
                    if row.get("center_id"): existing.center_id = row["center_id"].strip()
                    if row.get("center_name"): existing.center_name = row["center_name"].strip()
                    if row.get("ward"): existing.ward = row["ward"].strip()
                    if row.get("outstanding_balance"): existing.outstanding_balance = _num(row, "outstanding_balance")
                    if row.get("due_amount"): existing.due_amount = _num(row, "due_amount")
                    if row.get("next_installment_date"): existing.next_installment_date = row["next_installment_date"].strip()
                    if row.get("overdue_days"): existing.overdue_days = overdue
                    updated += 1
                else:
                    db.add(Client(
                        member_id=member_id, name=(row.get("name") or member_id).strip(),
                        phone_number=(row.get("phone_number") or "").strip() or None,
                        center_id=(row.get("center_id") or "").strip() or None,
                        center_name=(row.get("center_name") or "").strip() or None,
                        ward=(row.get("ward") or "").strip() or None,
                        outstanding_balance=_num(row, "outstanding_balance"),
                        due_amount=_num(row, "due_amount"),
                        next_installment_date=(row.get("next_installment_date") or "").strip() or None,
                        overdue_days=overdue, loan_cycle=1, status="active",
                    ))
                    created += 1
            except Exception as e:  # one bad row must not abort the whole import
                errors.append(f"row {i}: {e}")

        await write_audit(db, current_user, "cbs_clients_imported",
                          entity_type="import", meta={"created": created, "updated": updated})
        await db.commit()
        return ApiResponse(success=True,
                           data={"created": created, "updated": updated,
                                 "error_count": len(errors), "errors": errors[:20]},
                           timestamp=int(time.time()))
    except Exception as e:
        logger.error(f"Import clients error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Client import failed")


@router.get("/postings", response_model=ApiResponse,
            dependencies=[Depends(require_manager_or_admin)])
async def postings(
    date: str | None = Query(None, description="YYYY-MM-DD, defaults to today (Nepal)"),
    db: AsyncSession = Depends(get_db),
):
    """The day's collections as a CSV string the finance team imports into the CBS."""
    try:
        day = date or today_nepal_str()
        cols = (await db.execute(
            select(Collection).where(Collection.collected_at.like(f"{day}%")).order_by(Collection.id)
        )).scalars().all()
        clients = {c.id: c for c in (await db.execute(select(Client))).scalars().all()}
        officers = {u.id: u for u in (await db.execute(select(User))).scalars().all()}

        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["receipt_id", "member_id", "client_name", "amount", "payment_method",
                    "collected_at", "officer_staff_id", "officer_name", "cbs_verified"])
        for c in cols:
            cl = clients.get(c.client_id)
            of = officers.get(c.officer_id)
            w.writerow([c.receipt_id, cl.member_id if cl else "", cl.name if cl else "",
                        c.amount, c.payment_method, c.collected_at,
                        of.staff_id if of else "", of.name if of else "", c.cbs_verified])

        return ApiResponse(success=True,
                           data={"date": day, "count": len(cols),
                                 "filename": f"fieldos-postings-{day}.csv", "csv": out.getvalue()},
                           timestamp=int(time.time()))
    except Exception as e:
        logger.error(f"Postings export error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Postings export failed")
