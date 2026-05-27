from pydantic import BaseModel


class AuditEventCreate(BaseModel):
    action_type: str
    entity_type: str | None = None
    entity_id: str | None = None
    metadata: dict | None = None


class AuditBatchRequest(BaseModel):
    events: list[AuditEventCreate]


class AuditLogResponse(BaseModel):
    id: int
    user_id: int | None = None
    role: str | None = None
    branch_id: int | None = None
    action_type: str
    entity_type: str | None = None
    entity_id: str | None = None

    class Config:
        from_attributes = True
