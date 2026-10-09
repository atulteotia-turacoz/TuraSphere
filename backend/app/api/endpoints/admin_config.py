"""
Super-admin oversight + platform defaults (SaaS multi-tenant):
  - Manage the PLATFORM/GLOBAL SMTP default (owner_user_id IS NULL)
  - View every account's SMTP + meeting-provider config (read-only)
  - View every account's email logs

Per-account rows are still owned/managed by each account via /account/* ; these
routes give the super-admin a control + oversight surface across all accounts.
"""
import json
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_super_admin
from app.models.user import User
from app.models.smtp_config import SmtpConfig
from app.models.meeting_provider import MeetingProviderConfig
from app.models.email_log import EmailLog

router = APIRouter(tags=["Admin - Config"])


# ── Schemas ──────────────────────────────────────────────

class GlobalSmtpUpsert(BaseModel):
    host: Optional[str] = None
    port: Optional[int] = 587
    username: Optional[str] = None
    password: Optional[str] = None
    use_tls: bool = True
    from_name: Optional[str] = None
    from_email: Optional[str] = None
    is_active: bool = True


class SmtpConfigUpdate(BaseModel):
    # All optional — only provided fields are applied. Password is left unchanged
    # when omitted or blank (the list endpoint returns it masked, never in clear).
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None
    use_tls: Optional[bool] = None
    from_name: Optional[str] = None
    from_email: Optional[str] = None
    is_active: Optional[bool] = None


# ── Helpers ──────────────────────────────────────────────

def _mask(secret: Optional[str]) -> Optional[str]:
    if not secret:
        return None
    return "****" if len(secret) <= 4 else f"****{secret[-4:]}"


def _enum_value(v):
    return v.value if hasattr(v, "value") else v


def _owner_label(db: Session, owner_user_id: Optional[int]) -> Optional[str]:
    if owner_user_id is None:
        return None
    u = db.query(User).filter(User.id == owner_user_id).first()
    return (u.email if u else f"user #{owner_user_id}")


def _smtp_to_dict(db: Session, c: SmtpConfig) -> dict:
    return {
        "id": c.id,
        "owner_user_id": c.owner_user_id,
        "owner_email": _owner_label(db, c.owner_user_id),
        "scope": "platform" if c.owner_user_id is None else "account",
        "host": c.host,
        "port": c.port,
        "username": c.username,
        "password": _mask(c.password),
        "use_tls": c.use_tls,
        "from_name": c.from_name,
        "from_email": c.from_email,
        "is_active": c.is_active,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


# ── Global SMTP default ──────────────────────────────────

@router.get("/admin/smtp-config/global")
def get_global_smtp(db: Session = Depends(get_db), admin: User = Depends(get_super_admin)):
    c = db.query(SmtpConfig).filter(SmtpConfig.owner_user_id.is_(None)).first()
    return _smtp_to_dict(db, c) if c else None


@router.put("/admin/smtp-config/global")
def upsert_global_smtp(
    data: GlobalSmtpUpsert,
    db: Session = Depends(get_db),
    admin: User = Depends(get_super_admin),
):
    c = db.query(SmtpConfig).filter(SmtpConfig.owner_user_id.is_(None)).first()
    if not c:
        c = SmtpConfig(owner_user_id=None)
        db.add(c)
    c.host = (data.host or "").strip() or None
    c.port = data.port or 587
    c.username = (data.username or "").strip() or None
    if data.password is not None:
        c.password = data.password or None
    c.use_tls = data.use_tls
    c.from_name = (data.from_name or "").strip() or None
    c.from_email = (data.from_email or "").strip() or None
    c.is_active = data.is_active
    c.updated_by = admin.id
    db.commit()
    db.refresh(c)
    return _smtp_to_dict(db, c)


# ── Oversight (read-only) ────────────────────────────────

@router.get("/admin/smtp-configs")
def list_all_smtp_configs(db: Session = Depends(get_db), admin: User = Depends(get_super_admin)):
    rows = db.query(SmtpConfig).order_by(SmtpConfig.owner_user_id.is_(None).desc(),
                                         SmtpConfig.owner_user_id.asc()).all()
    return [_smtp_to_dict(db, r) for r in rows]


# ── Manage any account's SMTP config (super-admin) ───────

def _get_smtp_or_404(db: Session, config_id: int) -> SmtpConfig:
    c = db.query(SmtpConfig).filter(SmtpConfig.id == config_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="SMTP config not found")
    return c


@router.put("/admin/smtp-configs/{config_id}")
def update_smtp_config(
    config_id: int,
    data: SmtpConfigUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_super_admin),
):
    c = _get_smtp_or_404(db, config_id)
    if data.host is not None:
        c.host = data.host.strip() or None
    if data.port is not None:
        c.port = data.port or 587
    if data.username is not None:
        c.username = data.username.strip() or None
    # Only overwrite the password when a non-blank one is supplied.
    if data.password:
        c.password = data.password
    if data.use_tls is not None:
        c.use_tls = data.use_tls
    if data.from_name is not None:
        c.from_name = data.from_name.strip() or None
    if data.from_email is not None:
        c.from_email = data.from_email.strip() or None
    if data.is_active is not None:
        c.is_active = data.is_active
    c.updated_by = admin.id
    db.commit()
    db.refresh(c)
    return _smtp_to_dict(db, c)


@router.patch("/admin/smtp-configs/{config_id}/toggle")
def toggle_smtp_config(
    config_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_super_admin),
):
    c = _get_smtp_or_404(db, config_id)
    c.is_active = not c.is_active
    c.updated_by = admin.id
    db.commit()
    db.refresh(c)
    return _smtp_to_dict(db, c)


@router.delete("/admin/smtp-configs/{config_id}")
def delete_smtp_config(
    config_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_super_admin),
):
    c = _get_smtp_or_404(db, config_id)
    db.delete(c)
    db.commit()
    return {"detail": "SMTP config deleted"}


@router.get("/admin/meeting-providers")
def list_all_providers(db: Session = Depends(get_db), admin: User = Depends(get_super_admin)):
    rows = db.query(MeetingProviderConfig).order_by(
        MeetingProviderConfig.owner_user_id.is_(None).desc(),
        MeetingProviderConfig.owner_user_id.asc(),
    ).all()
    return [{
        "id": r.id,
        "owner_user_id": r.owner_user_id,
        "owner_email": _owner_label(db, r.owner_user_id),
        "scope": "platform" if r.owner_user_id is None else "account",
        "provider": _enum_value(r.provider),
        "is_active": r.is_active,
        "client_id": r.client_id,
        "client_secret": _mask(r.client_secret),
        "configured": bool(r.client_id),
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    } for r in rows]


@router.get("/admin/email-logs")
def list_all_email_logs(
    owner_user_id: Optional[int] = None,
    kind: Optional[str] = None,
    success: Optional[bool] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
    admin: User = Depends(get_super_admin),
):
    q = db.query(EmailLog)
    if owner_user_id is not None:
        q = q.filter(EmailLog.owner_user_id == owner_user_id)
    if kind:
        q = q.filter(EmailLog.kind == kind)
    if success is not None:
        q = q.filter(EmailLog.success.is_(success))
    total = q.count()
    rows = q.order_by(EmailLog.sent_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [{
            "id": l.id,
            "owner_user_id": l.owner_user_id,
            "owner_email": _owner_label(db, l.owner_user_id),
            "recipient_email": l.recipient_email,
            "subject": l.subject,
            "kind": _enum_value(l.kind),
            "success": l.success,
            "error": l.error,
            "related_board_id": l.related_board_id,
            "related_meeting_id": l.related_meeting_id,
            "sent_at": l.sent_at.isoformat() if l.sent_at else None,
        } for l in rows],
    }
