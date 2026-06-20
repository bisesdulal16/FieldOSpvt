import time
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.collection import Collection
from app.models.client import Client
from app.schemas.collection import CollectionCreate, CollectionResponse
from app.schemas.common import ApiResponse
from app.services import auth_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/collections", tags=["Collections"])


@router.post("/", response_model=ApiResponse)
async def create_collection(
    request: CollectionCreate,
    db: AsyncSession = Depends(get_db),
):
    try:
        receipt_id = request.receipt_id or auth_service.generate_receipt_id()
        is_high_value = request.is_high_value or float(request.amount) >= 50000

        collection = Collection(
            receipt_id=receipt_id,
            client_id=request.client_id,
            task_id=request.task_id,
            officer_id=request.officer_id,
            visit_id=request.visit_id,
            amount=float(request.amount),
            due_amount=float(request.due_amount) if request.due_amount else 0.0,
            outstanding_after=float(request.outstanding_after) if request.outstanding_after else 0.0,
            payment_method=request.payment_method or "cash",
            is_high_value=is_high_value,
            face_verified=request.face_verified or False,
            gps_latitude=request.gps_latitude,
            gps_longitude=request.gps_longitude,
            gps_address=request.gps_address,
            gps_accuracy_meters=request.gps_accuracy_meters,
            collected_at=request.collected_at or datetime.now(timezone.utc).isoformat(),
            cbs_verified=False,
        )
        db.add(collection)
        await db.flush()

        # Update client balance after collection
        if request.client_id:
            client_result = await db.execute(select(Client).where(Client.id == request.client_id))
            client = client_result.scalar_one_or_none()
            if client and request.outstanding_after:
                client.outstanding_balance = float(request.outstanding_after)
                client.due_amount = max(0.0, client.due_amount - float(request.amount))

        await db.commit()

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
    except Exception as e:
        logger.error(f"Create collection error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Collection creation failed")
