"""
Super-admin-managed meeting provider config (Teams or Zoom).
Phase 1: model + admin CRUD only. Actual API integration lands in Phase 4 (Zoom).

Setting `is_active=True` on one provider deactivates the other (single-active invariant
enforced at the app layer since MySQL lacks partial-unique indexes).

`client_secret` is masked in read responses.
"""
import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_super_admin, get_current_user
from app.models.user import User
from app.models.meeting_provider import MeetingProviderConfig, MeetingProvider
from app.services import account_config

router = APIRouter(tags=["MABM - Provider Config"])


# ── Schemas ──────────────────────────────────────────────

class ProviderConfigUpsert(BaseModel):
    provider: str   # teams | zoom
    is_active: bool = False
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    tenant_id: Optional[str] = None    # Teams
    account_id: Optional[str] = None   # Zoom
    extra_config: Optional[dict] = None


# ── Helpers ──────────────────────────────────────────────

def _enum_value(v):
    return v.value if hasattr(v, "value") else v


def _parse_json_field(val):
    if not val:
        return None
    if isinstance(val, (list, dict)):
        return val
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return None


def _mask_secret(secret: Optional[str]) -> Optional[str]:
    if not secret:
        return None
    if len(secret) <= 4:
        return "****"
    return f"****{secret[-4:]}"


def _config_to_dict(c: MeetingProviderConfig) -> dict:
    return {
        "id": c.id,
        "owner_user_id": c.owner_user_id,
        "provider": _enum_value(c.provider),
        "is_active": c.is_active,
        "client_id": c.client_id,
        "client_secret": _mask_secret(c.client_secret),
        "has_client_secret": bool(c.client_secret),
        "tenant_id": c.tenant_id,
        "account_id": c.account_id,
        "extra_config": _parse_json_field(c.extra_config) or {},
        "updated_by": c.updated_by,
        "created_at": c.created_at.isoformat(),
        "updated_at": c.updated_at.isoformat(),
    }


# ── Routes ───────────────────────────────────────────────

# These super-admin routes manage the PLATFORM/GLOBAL default rows (owner_user_id IS
# NULL). Per-account rows are managed via /account/meeting-providers; cross-account
# oversight lives at /admin/meeting-providers.

@router.get("/mabm/provider-config")
def list_provider_configs(
    db: Session = Depends(get_db),
    admin: User = Depends(get_super_admin),
):
    rows = db.query(MeetingProviderConfig).filter(
        MeetingProviderConfig.owner_user_id.is_(None)
    ).order_by(MeetingProviderConfig.id.asc()).all()
    return [_config_to_dict(r) for r in rows]


@router.get("/mabm/provider-config/active")
def get_active_provider_config(
    db: Session = Depends(get_db),
    admin: User = Depends(get_super_admin),
):
    c = db.query(MeetingProviderConfig).filter(
        MeetingProviderConfig.owner_user_id.is_(None),
        MeetingProviderConfig.is_active.is_(True),
    ).first()
    if not c:
        return None
    return _config_to_dict(c)


@router.get("/mabm/configured-providers")
def list_configured_providers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Which meeting platforms THIS account can use (its own config first, then the
    platform default), so the organizer can choose Zoom/Teams when provisioning."""
    return account_config.configured_providers(db, current_user.id)


@router.put("/mabm/provider-config")
def upsert_provider_config(
    data: ProviderConfigUpsert,
    db: Session = Depends(get_db),
    admin: User = Depends(get_super_admin),
):
    valid_providers = {p.value for p in MeetingProvider}
    if data.provider not in valid_providers:
        raise HTTPException(status_code=400, detail=f"Invalid provider: {data.provider}. Valid: {', '.join(sorted(valid_providers))}")

    c = db.query(MeetingProviderConfig).filter(
        MeetingProviderConfig.owner_user_id.is_(None),
        MeetingProviderConfig.provider == data.provider,
    ).first()
    if not c:
        c = MeetingProviderConfig(provider=data.provider, owner_user_id=None)
        db.add(c)

    # Single-active invariant (global scope): setting this provider active
    # deactivates the other global provider.
    if data.is_active:
        db.query(MeetingProviderConfig).filter(
            MeetingProviderConfig.owner_user_id.is_(None),
            MeetingProviderConfig.provider != data.provider,
        ).update({"is_active": False}, synchronize_session=False)

    c.is_active = data.is_active
    c.client_id = data.client_id
    if data.client_secret is not None:
        c.client_secret = data.client_secret
    c.tenant_id = data.tenant_id
    c.account_id = data.account_id
    c.extra_config = json.dumps(data.extra_config) if data.extra_config is not None else None
    c.updated_by = admin.id

    db.commit()
    db.refresh(c)
    return _config_to_dict(c)


@router.delete("/mabm/provider-config/{config_id}")
def delete_provider_config(
    config_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_super_admin),
):
    c = db.query(MeetingProviderConfig).filter(MeetingProviderConfig.id == config_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Provider config not found")
    db.delete(c)
    db.commit()
    return {"detail": "Provider config deleted"}
