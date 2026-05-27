from pydantic import BaseModel, ConfigDict


class LoginRequest(BaseModel):
    staff_id: str
    pin: str
    device_id: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class BiometricLoginRequest(BaseModel):
    device_id: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int

    model_config = ConfigDict(from_attributes=True)


class LoginResponse(BaseModel):
    user: dict
    device: dict | None = None
    tokens: TokenResponse

    model_config = ConfigDict(from_attributes=True)
