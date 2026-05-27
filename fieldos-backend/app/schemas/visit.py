from pydantic import BaseModel


class VisitCheckinCreate(BaseModel):
    client_id: int
    task_id: int | None = None
    officer_id: int | None = None
    visit_purpose: str | None = None
    gps_latitude: float | None = None
    gps_longitude: float | None = None
    gps_address: str | None = None
    gps_accuracy_meters: float | None = None
    checked_in_at: str | None = None
