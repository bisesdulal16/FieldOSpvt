from pydantic import BaseModel, ConfigDict


class UserBase(BaseModel):
    staff_id: str
    name: str
    name_ne: str | None = None
    role: str
    phone_number: str | None = None
    is_active: bool = True

    model_config = ConfigDict(from_attributes=True)


class UserProfile(UserBase):
    id: int
    branch_id: int | None = None
    branch_name: str | None = None

    model_config = ConfigDict(from_attributes=True)


class UserCreate(BaseModel):
    staff_id: str
    name: str
    name_ne: str | None = None
    role: str = "field_officer"
    pin: str
    branch_id: int | None = None
    phone_number: str | None = None
