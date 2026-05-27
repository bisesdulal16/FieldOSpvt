from pydantic import BaseModel


class AttendanceRecord(BaseModel):
    client_id: int | None = None
    member_id: str | None = None
    attendance_status: str = "present"


class MeetingCreate(BaseModel):
    center_id: str
    center_name: str
    meeting_date: str
    location: str | None = None
    total_members: int = 0
    present_count: int = 0
    paid_count: int = 0
    absent_count: int = 0
    followup_count: int = 0
    collection_expected: float = 0.0
    collection_received: float = 0.0
    attendance: list[AttendanceRecord] = []
