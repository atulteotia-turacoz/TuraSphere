from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class UserBase(BaseModel):
    email: str
    full_name: str


class UserCreate(UserBase):
    password: str
    role: str = "user"
    organization: Optional[str] = None
    allowed_services: Optional[list] = None
    granted_services: Optional[list] = None


class UserLogin(BaseModel):
    email: str
    password: str


class UserUpdate(BaseModel):
    ai_enabled: Optional[bool] = None
    full_name: Optional[str] = None
    organization: Optional[str] = None
    is_active: Optional[bool] = None
    role: Optional[str] = None
    allowed_services: Optional[list] = None
    granted_services: Optional[list] = None


class UserResponse(UserBase):
    id: int
    role: str
    organization: Optional[str] = None
    is_active: bool
    allowed_services: Optional[str] = None
    granted_services: Optional[str] = None
    # Computed, not columns: the parsed grant and the granted ∩ selected set the
    # UI should actually render. Sent so the frontend does not re-implement the
    # intersection (and cannot get it wrong).
    ai_enabled: Optional[bool] = True
    granted_service_list: Optional[list] = None
    effective_services: Optional[list] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TokenUser(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    organization: Optional[str] = None
    allowed_services: Optional[list] = None

    model_config = ConfigDict(from_attributes=True)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: Optional[TokenUser] = None
