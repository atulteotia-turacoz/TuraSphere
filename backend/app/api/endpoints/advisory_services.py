"""
Advisory Service Catalog — service definitions + default pricing.

Replaces the old hardcoded SERVICES list in frontend/data.js and the
localStorage rate-card. The catalog is shared platform-wide and managed by
super admins; every authenticated user can read it.
"""
from decimal import Decimal
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.security import get_current_user, get_super_admin
from app.models.user import User
from app.models.advisory_board import BoardPhase
from app.models.advisory_service import AdvisoryService, FeeUnit


router = APIRouter(tags=["MABM - Advisory Services"])


# ── Schemas ──────────────────────────────────────────────

class AdvisoryServiceCreate(BaseModel):
    slug: str = Field(..., min_length=1, max_length=80)
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    fee_label: Optional[str] = None
    phase: str
    default_unit: str = "fixed"
    default_price: float = 0
    currency: str = "USD"
    is_active: bool = True
    sort_order: int = 0


class AdvisoryServiceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    fee_label: Optional[str] = None
    phase: Optional[str] = None
    default_unit: Optional[str] = None
    default_price: Optional[float] = None
    currency: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


# ── Helpers ──────────────────────────────────────────────

def _enum_value(v):
    return v.value if hasattr(v, "value") else v


def _serialize(s: AdvisoryService) -> dict:
    return {
        "id": s.id,
        "slug": s.slug,
        "name": s.name,
        "description": s.description or "",
        "fee_label": s.fee_label or "",
        "phase": _enum_value(s.phase),
        "default_unit": _enum_value(s.default_unit),
        "default_price": float(s.default_price or 0),
        "currency": s.currency or "USD",
        "is_active": bool(s.is_active),
        "sort_order": s.sort_order or 0,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


def _validate_phase(phase: str) -> str:
    try:
        return BoardPhase(phase).value
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid phase: {phase}")


def _validate_unit(unit: str) -> str:
    try:
        return FeeUnit(unit).value
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid fee unit: {unit}")


# ── Read endpoints (any authenticated user) ──────────────

@router.get("/advisory-services")
def list_advisory_services(
    phase: Optional[str] = None,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(AdvisoryService)
    if phase:
        q = q.filter(AdvisoryService.phase == _validate_phase(phase))
    if not include_inactive:
        q = q.filter(AdvisoryService.is_active == True)  # noqa: E712
    rows = q.order_by(AdvisoryService.phase, AdvisoryService.sort_order, AdvisoryService.id).all()
    return [_serialize(s) for s in rows]


@router.get("/advisory-services/{service_id}")
def get_advisory_service(
    service_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    s = db.query(AdvisoryService).filter(AdvisoryService.id == service_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Service not found")
    return _serialize(s)


# ── Write endpoints (super admin only) ───────────────────

@router.post("/advisory-services", status_code=201)
def create_advisory_service(
    data: AdvisoryServiceCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_super_admin),
):
    slug = (data.slug or "").strip()
    if not slug:
        raise HTTPException(status_code=400, detail="slug is required")
    if db.query(AdvisoryService).filter(AdvisoryService.slug == slug).first():
        raise HTTPException(status_code=409, detail=f"A service with slug '{slug}' already exists")

    s = AdvisoryService(
        slug=slug,
        name=data.name.strip(),
        description=(data.description or "").strip() or None,
        fee_label=(data.fee_label or "").strip() or None,
        phase=_validate_phase(data.phase),
        default_unit=_validate_unit(data.default_unit),
        default_price=Decimal(str(data.default_price or 0)),
        currency=(data.currency or "USD").upper().strip(),
        is_active=bool(data.is_active),
        sort_order=int(data.sort_order or 0),
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return _serialize(s)


@router.patch("/advisory-services/{service_id}")
def update_advisory_service(
    service_id: int,
    data: AdvisoryServiceUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_super_admin),
):
    s = db.query(AdvisoryService).filter(AdvisoryService.id == service_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Service not found")

    payload = data.dict(exclude_unset=True)
    if "phase" in payload and payload["phase"] is not None:
        payload["phase"] = _validate_phase(payload["phase"])
    if "default_unit" in payload and payload["default_unit"] is not None:
        payload["default_unit"] = _validate_unit(payload["default_unit"])
    if "default_price" in payload and payload["default_price"] is not None:
        payload["default_price"] = Decimal(str(payload["default_price"]))
    if "currency" in payload and payload["currency"] is not None:
        payload["currency"] = payload["currency"].upper().strip()
    if "name" in payload and payload["name"] is not None:
        payload["name"] = payload["name"].strip()

    for k, v in payload.items():
        setattr(s, k, v)

    db.commit()
    db.refresh(s)
    return _serialize(s)


@router.delete("/advisory-services/{service_id}", status_code=204)
def delete_advisory_service(
    service_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_super_admin),
):
    s = db.query(AdvisoryService).filter(AdvisoryService.id == service_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Service not found")
    db.delete(s)
    db.commit()
    return None
