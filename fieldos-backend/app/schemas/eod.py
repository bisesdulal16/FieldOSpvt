from pydantic import BaseModel


class EODCreate(BaseModel):
    report_date: str
    total_collections: float = 0.0
    total_visits: int = 0
    pending_count: int = 0
    exceptions: dict | None = None
    face_verified: bool = False
