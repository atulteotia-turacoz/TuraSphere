from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


# ─── Billing Profile ──────────────────────────────────────────────
class BillingProfileUpdate(BaseModel):
    company_name: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    country: Optional[str] = None
    tax_id: Optional[str] = None
    phone: Optional[str] = None


class BillingProfileResponse(BillingProfileUpdate):
    id: int
    user_id: int
    model_config = ConfigDict(from_attributes=True)


# ─── Subscription ─────────────────────────────────────────────────
class SubscribeRequest(BaseModel):
    plan_id: int
    billing_cycle: str = "monthly"  # monthly / yearly


class SubscriptionResponse(BaseModel):
    id: int
    user_id: int
    plan_id: int
    status: str
    billing_cycle: str
    current_period_start: Optional[datetime] = None
    current_period_end: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    plan_name: Optional[str] = None
    plan_price: Optional[float] = None
    model_config = ConfigDict(from_attributes=True)


# ─── Invoice ──────────────────────────────────────────────────────
class InvoiceResponse(BaseModel):
    id: int
    invoice_number: str
    plan_name: str
    billing_cycle: str
    amount: float
    currency: str
    status: str
    billing_name: Optional[str] = None
    billing_email: Optional[str] = None
    billing_company: Optional[str] = None
    billing_address: Optional[str] = None
    billing_tax_id: Optional[str] = None
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ─── Profile Update ──────────────────────────────────────────────
class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    organization: Optional[str] = None
    allowed_services: Optional[list] = None
