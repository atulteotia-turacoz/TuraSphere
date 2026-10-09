"""
Account-scoped configuration (SaaS multi-tenant):
  - SMTP config used to send THIS account's emails
  - Meeting-provider (Zoom/Teams) configs for THIS account
  - The account's email logs
  - A config-status summary used to drive dashboard / meeting-create warnings

Each row is owned by the calling user (`owner_user_id == current_user.id`). When an
account has no config, sends/meetings fall back to the platform default (managed by
the super-admin), but the status endpoint reports `source: 'platform'` so the UI can
nudge the user to set up their own.
"""
import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.smtp_config import SmtpConfig
from app.models.meeting_provider import MeetingProviderConfig, MeetingProvider
from app.models.email_log import EmailLog
from app.services import account_config, email_service

router = APIRouter(tags=["Account - Config"])


# ── Schemas ──────────────────────────────────────────────

class SmtpUpsert(BaseModel):
    host: Optional[str] = None
    port: Optional[int] = 587
    username: Optional[str] = None
    password: Optional[str] = None       # omit/None to keep the stored value
    use_tls: bool = True
    from_name: Optional[str] = None
    from_email: Optional[str] = None
    is_active: bool = True


class TestEmailRequest(BaseModel):
    to: Optional[str] = None             # defaults to the caller's own email


class ProviderUpsert(BaseModel):
    provider: str                        # zoom | teams
    is_active: bool = False
    client_id: Optional[str] = None
    client_secret: Optional[str] = None  # omit/None to keep the stored value
    tenant_id: Optional[str] = None      # Teams
    account_id: Optional[str] = None     # Zoom
    extra_config: Optional[dict] = None


# ── Helpers ──────────────────────────────────────────────

def _mask_secret(secret: Optional[str]) -> Optional[str]:
    if not secret:
        return None
    return "****" if len(secret) <= 4 else f"****{secret[-4:]}"


def _parse_json(val):
    if not val:
        return None
    if isinstance(val, (list, dict)):
        return val
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return None


def _enum_value(v):
    return v.value if hasattr(v, "value") else v


def _smtp_to_dict(c: Optional[SmtpConfig]) -> Optional[dict]:
    if not c:
        return None
    return {
        "id": c.id,
        "host": c.host,
        "port": c.port,
        "username": c.username,
        "password": _mask_secret(c.password),
        "has_password": bool(c.password),
        "use_tls": c.use_tls,
        "from_name": c.from_name,
        "from_email": c.from_email,
        "is_active": c.is_active,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def _sanitize_extra(extra: Optional[dict]) -> dict:
    """Mask secret-bearing keys in extra_config before returning to the client,
    and surface boolean 'configured' flags the UI can rely on."""
    e = dict(extra or {})
    out = dict(e)
    for k in ("sdk_secret", "webhook_secret"):
        if e.get(k):
            out[k] = _mask_secret(e[k])
    out["has_sdk_key"] = bool(e.get("sdk_key"))
    out["has_sdk_secret"] = bool(e.get("sdk_secret"))
    return out


def _provider_to_dict(c: MeetingProviderConfig) -> dict:
    return {
        "id": c.id,
        "provider": _enum_value(c.provider),
        "is_active": c.is_active,
        "client_id": c.client_id,
        "client_secret": _mask_secret(c.client_secret),
        "has_client_secret": bool(c.client_secret),
        "tenant_id": c.tenant_id,
        "account_id": c.account_id,
        "extra_config": _sanitize_extra(_parse_json(c.extra_config)),
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def _email_log_to_dict(l: EmailLog) -> dict:
    return {
        "id": l.id,
        "recipient_email": l.recipient_email,
        "subject": l.subject,
        "kind": _enum_value(l.kind),
        "success": l.success,
        "error": l.error,
        "related_board_id": l.related_board_id,
        "related_meeting_id": l.related_meeting_id,
        "sent_at": l.sent_at.isoformat() if l.sent_at else None,
    }


# ── SMTP config ──────────────────────────────────────────

@router.get("/account/smtp-config")
def get_account_smtp(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(SmtpConfig).filter(SmtpConfig.owner_user_id == current_user.id).first()
    return _smtp_to_dict(c)


@router.put("/account/smtp-config")
def upsert_account_smtp(
    data: SmtpUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    c = db.query(SmtpConfig).filter(SmtpConfig.owner_user_id == current_user.id).first()
    if not c:
        c = SmtpConfig(owner_user_id=current_user.id)
        db.add(c)
    c.host = (data.host or "").strip() or None
    c.port = data.port or 587
    c.username = (data.username or "").strip() or None
    if data.password is not None:                 # keep stored secret when omitted
        c.password = data.password or None
    c.use_tls = data.use_tls
    c.from_name = (data.from_name or "").strip() or None
    c.from_email = (data.from_email or "").strip() or None
    c.is_active = data.is_active
    c.updated_by = current_user.id
    db.commit()
    db.refresh(c)
    return _smtp_to_dict(c)


@router.delete("/account/smtp-config")
def delete_account_smtp(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(SmtpConfig).filter(SmtpConfig.owner_user_id == current_user.id).first()
    if c:
        db.delete(c)
        db.commit()
    return {"detail": "SMTP config removed"}


@router.post("/account/smtp-config/test")
def send_test_email(
    data: TestEmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    to = (data.to or current_user.email or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="No recipient email available.")
    log = email_service.send_email(
        db, to=to,
        subject="TuraQuant — SMTP test email",
        body_html="<p>This is a test email confirming your SMTP configuration works.</p>",
        owner_user_id=current_user.id,
    )
    if not log.success:
        raise HTTPException(status_code=502, detail=log.error or "Failed to send test email.")
    return {"detail": f"Test email sent to {to}.", "via": account_config.smtp_source(db, current_user.id)}


# ── Meeting providers (Zoom / Teams / LiveKit) ───────────

@router.post("/account/meeting-providers/livekit/test")
def test_account_livekit(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Prove the LiveKit config actually reaches a server, before someone finds
    out mid-meeting. Uses this account's own row if it has one, else the
    platform's server."""
    from app.services import livekit_service
    ok, message = livekit_service.test_connection(db, current_user.id)
    return {
        "ok": ok,
        "message": message,
        "source": account_config.provider_source(db, current_user.id, MeetingProvider.livekit.value),
    }


@router.get("/account/meeting-providers")
def list_account_providers(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(MeetingProviderConfig).filter(
        MeetingProviderConfig.owner_user_id == current_user.id
    ).order_by(MeetingProviderConfig.id.asc()).all()
    return [_provider_to_dict(r) for r in rows]


@router.put("/account/meeting-providers")
def upsert_account_provider(
    data: ProviderUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if data.provider not in {p.value for p in MeetingProvider}:
        raise HTTPException(status_code=400, detail=f"Invalid provider: {data.provider}")
    c = db.query(MeetingProviderConfig).filter(
        MeetingProviderConfig.owner_user_id == current_user.id,
        MeetingProviderConfig.provider == data.provider,
    ).first()
    if not c:
        c = MeetingProviderConfig(owner_user_id=current_user.id, provider=data.provider)
        db.add(c)
    # One active provider per account.
    if data.is_active:
        db.query(MeetingProviderConfig).filter(
            MeetingProviderConfig.owner_user_id == current_user.id,
            MeetingProviderConfig.provider != data.provider,
        ).update({"is_active": False}, synchronize_session=False)
    c.is_active = data.is_active
    c.client_id = data.client_id
    if data.client_secret is not None:
        c.client_secret = data.client_secret
    c.tenant_id = data.tenant_id
    c.account_id = data.account_id
    # Merge extra_config so masked secrets coming back from the UI don't clobber the
    # stored ones: an empty or "****"-masked secret means "keep existing".
    if data.extra_config is not None:
        existing_extra = _parse_json(c.extra_config) or {}
        merged = dict(existing_extra)
        for k, v in data.extra_config.items():
            if k in ("sdk_secret", "webhook_secret"):
                if v and not str(v).startswith("****"):
                    merged[k] = v
            else:
                merged[k] = v
        c.extra_config = json.dumps(merged)
    c.updated_by = current_user.id
    db.commit()
    db.refresh(c)
    return _provider_to_dict(c)


@router.delete("/account/meeting-providers/{provider}")
def delete_account_provider(
    provider: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    c = db.query(MeetingProviderConfig).filter(
        MeetingProviderConfig.owner_user_id == current_user.id,
        MeetingProviderConfig.provider == provider,
    ).first()
    if c:
        db.delete(c)
        db.commit()
    return {"detail": f"{provider} config removed"}


# ── Email logs (own) + config status ─────────────────────

@router.get("/account/email-logs")
def list_account_email_logs(
    kind: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(EmailLog).filter(EmailLog.owner_user_id == current_user.id)
    if kind:
        q = q.filter(EmailLog.kind == kind)
    total = q.count()
    rows = q.order_by(EmailLog.sent_at.desc()).offset(offset).limit(limit).all()
    return {"total": total, "items": [_email_log_to_dict(r) for r in rows]}


@router.get("/account/config-status")
def get_config_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return account_config.config_status(db, current_user.id)
