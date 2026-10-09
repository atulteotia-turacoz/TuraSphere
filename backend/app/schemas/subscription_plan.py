from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class PlanBase(BaseModel):
    name: str
    slug: str
    description: Optional[str] = None
    price_monthly: float = 0
    price_yearly: float = 0
    currency: str = "USD"
    max_assessments: int = 0
    max_hcps: int = 0
    features: Optional[str] = None  # JSON array string
    is_active: bool = True
    is_popular: bool = False
    sort_order: int = 0
    badge_text: Optional[str] = None


class PlanCreate(PlanBase):
    pass


class PlanUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    price_monthly: Optional[float] = None
    price_yearly: Optional[float] = None
    currency: Optional[str] = None
    max_assessments: Optional[int] = None
    max_hcps: Optional[int] = None
    features: Optional[str] = None
    is_active: Optional[bool] = None
    is_popular: Optional[bool] = None
    sort_order: Optional[int] = None
    badge_text: Optional[str] = None


class PlanResponse(PlanBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)
