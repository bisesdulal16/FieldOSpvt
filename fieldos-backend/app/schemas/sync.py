from pydantic import BaseModel, ConfigDict


class SyncEventCreate(BaseModel):
    entity_type: str
    entity_id: str
    operation: str
    payload: dict | None = None


class SyncBatchRequest(BaseModel):
    events: list[SyncEventCreate]


class SyncEventResult(BaseModel):
    entity_type: str
    entity_id: str
    status: str
    error: str | None = None


class SyncStatusResponse(BaseModel):
    pending_count: int
    last_sync_at: str | None = None

    model_config = ConfigDict(from_attributes=True)
