from pydantic import BaseModel


class CollectionCreate(BaseModel):
    client_id: int
    task_id: int | None = None
    officer_id: int | None = None
    visit_id: int | None = None
    amount: float
    due_amount: float = 0.0
    outstanding_after: float = 0.0
    payment_method: str = "cash"
    face_verified: bool = False
    gps_latitude: float | None = None
    gps_longitude: float | None = None
    collected_at: str | None = None


class CollectionResponse(BaseModel):
    id: int
    receipt_id: str
    client_id: int | None = None
    amount: float
    outstanding_after: float
    payment_method: str
    is_high_value: bool
    face_verified: bool
    cbs_verified: bool
    collected_at: str | None = None
