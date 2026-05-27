import time
import logging
from fastapi import APIRouter, Depends, HTTPException, status

from app.database import get_db
from app.models.promise_to_pay import PromiseToPay
from app.schemas.promise import PromiseToPayCreate
from app.schemas.common import ApiResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/promise-to-pay", tags=["Promise to Pay"])


@router.post("/", response_model=ApiResponse)
async def create_promise(
    request: PromiseToPayCreate,
    db=Depends(get_db),
):
    try:
        promise = PromiseToPay(
            client_id=request.client_id,
            task_id=request.task_id,
            promised_amount=float(request.promised_amount),
            expected_payment_date=request.expected_payment_date,
            reason=request.reason,
            outstanding_amount=float(request.outstanding_amount),
            status="pending",
        )
        db.add(promise)
        await db.flush()

        return ApiResponse(
            success=True,
            data={
                "id": promise.id,
                "client_id": promise.client_id,
                "promised_amount": promise.promised_amount,
                "expected_payment_date": promise.expected_payment_date,
                "outstanding_amount": promise.outstanding_amount,
                "status": promise.status,
            },
            timestamp=int(time.time()),
        )
    except Exception as e:
        logger.error(f"Create promise error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Promise creation failed")
