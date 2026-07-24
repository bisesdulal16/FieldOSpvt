import time
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.collection import Collection
from app.models.client import Client
from app.models.user import User
from app.schemas.collection import CollectionCreate, CollectionResponse
from app.schemas.common import ApiResponse
from app.services import auth_service
from app.services.audit_helper import write_audit
from app.services.sms_service import record_and_send_receipt
from app.deps.auth_deps import get_current_user, require_financial_access
from app.utils.nepal_time import to_nepal_iso

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/collections", tags=["Collections"],
                   dependencies=[Depends(require_financial_access)])


@router.post("/", response_model=ApiResponse)
async def create_collection(
    request: CollectionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        receipt_id = request.receipt_id or auth_service.generate_receipt_id()
        amount = float(request.amount)
        is_high_value = request.is_high_value or amount >= 50000

        if amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Collection amount must be greater than zero.",
            )

        # The client's REAL outstanding balance is the single source of truth. The
        # device-sent `outstanding_after` is ignored entirely — the server always
        # recomputes it, so a stale/zero client object on the device can never write
        # a wrong balance (this caused the "collected 2000 but due unchanged" bug).
        client = None
        if request.client_id:
            client_result = await db.execute(select(Client).where(Client.id == request.client_id))
            client = client_result.scalar_one_or_none()
        if not client:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Client not found — cannot record a collection.",
            )

        current_outstanding = float(client.outstanding_balance or 0.0)
        # Hard cap: a collection can never exceed the outstanding balance. This blocks
        # the "210,000 against a 2,100 due" fat-finger/fraud case at the server, so no
        # buggy or old app build can over-collect.
        if current_outstanding <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This client has no outstanding balance to collect against.",
            )
        if amount > current_outstanding:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Amount NPR {amount:,.0f} exceeds the outstanding balance of NPR {current_outstanding:,.0f}.",
            )

        outstanding_after = max(0.0, current_outstanding - amount)

        collection = Collection(
            receipt_id=receipt_id,
            client_id=request.client_id,
            task_id=request.task_id,
            officer_id=current_user.id,  # from the authenticated token, not the body
            visit_id=request.visit_id,
            amount=amount,
            due_amount=float(request.due_amount) if request.due_amount else 0.0,
            outstanding_after=outstanding_after,
            payment_method=request.payment_method or "cash",
            is_high_value=is_high_value,
            face_verified=request.face_verified or False,
            gps_latitude=request.gps_latitude,
            gps_longitude=request.gps_longitude,
            gps_address=request.gps_address,
            gps_accuracy_meters=request.gps_accuracy_meters,
            collected_at=to_nepal_iso(request.collected_at),
            cbs_verified=False,
        )
        db.add(collection)
        await db.flush()

        # Update client balance after collection
        if client:
            client.outstanding_balance = outstanding_after
            client.due_amount = max(0.0, float(client.due_amount) - amount)

        # Append-only audit of a sensitive money action, tied to the authenticated officer.
        await write_audit(
            db, current_user, "collection_recorded",
            entity_type="collection", entity_id=receipt_id,
            meta={"client_id": request.client_id, "amount": amount,
                  "payment_method": request.payment_method or "cash"},
        )

        client_phone = client.phone_number if client else None
        await db.commit()

        # Anti-under-reporting control: the SERVER (never the officer's phone) texts the client
        # the exact recorded amount, so a collection can't be quietly under-reported. Best-effort
        # + logged in sms_notifications; a gateway outage never fails the collection.
        await record_and_send_receipt(
            db, client_id=request.client_id, phone_number=client_phone,
            amount=amount, receipt_id=receipt_id,
        )

        return ApiResponse(
            success=True,
            data=CollectionResponse(
                id=collection.id,
                receipt_id=collection.receipt_id,
                client_id=collection.client_id,
                amount=collection.amount,
                outstanding_after=collection.outstanding_after,
                payment_method=collection.payment_method,
                is_high_value=collection.is_high_value,
                face_verified=collection.face_verified,
                cbs_verified=collection.cbs_verified,
                collected_at=collection.collected_at,
            ).model_dump(),
            timestamp=int(time.time()),
        )
    except HTTPException:
        # Validation rejections (overpayment cap, zero balance, missing client) must
        # reach the client with their real status + message, not be masked as a 500.
        raise
    except Exception as e:
        logger.error(f"Create collection error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Collection creation failed")
