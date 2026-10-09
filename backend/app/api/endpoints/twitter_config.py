"""X (Twitter) integration config.

Two scopes over one table, mirroring the meeting-provider design:

  * /admin/twitter-config    — the platform/global row (owner_user_id IS NULL),
                               managed by admins from the admin app.
  * /account/twitter-config  — the calling user's own row, managed from /account.

An account with no row of its own falls back to the platform default, but
`config_status` still reports source='platform' so the dashboard can nudge the
user to connect their own X account.
"""
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_admin, get_current_user
from app.models.twitter_config import TwitterConfig, twitter_configured
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["X (Twitter) Config"])

# Secrets are write-only: they go in from the form, but never come back out.
SECRET_FIELDS = ["api_secret", "client_secret", "bearer_token", "access_token", "access_token_secret"]
PLAIN_FIELDS = ["display_name", "username", "api_key", "client_id", "description"]


class TwitterUpsert(BaseModel):
    display_name: Optional[str] = None
    username: Optional[str] = None
    api_key: Optional[str] = None
    client_id: Optional[str] = None
    # Omit or send None to KEEP the stored secret; send "" to clear it.
    api_secret: Optional[str] = None
    client_secret: Optional[str] = None
    bearer_token: Optional[str] = None
    access_token: Optional[str] = None
    access_token_secret: Optional[str] = None
    is_active: Optional[bool] = None
    description: Optional[str] = None


def _mask(secret: Optional[str]) -> Optional[str]:
    if not secret:
        return None
    if len(secret) <= 8:
        return "****"
    return secret[:4] + "****" + secret[-4:]


def _to_dict(cfg: Optional[TwitterConfig], scope: str, reveal: bool = False) -> dict:
    """Serialise a config.

    Secrets are masked by default so they can't be scraped off a page that merely
    got loaded. `reveal=True` returns them in full and is only reachable from the
    admin endpoint, behind an explicit request — see `admin_get`.
    """
    if cfg is None:
        return {"configured": False, "scope": scope, "is_active": False}

    def show(secret: Optional[str]) -> Optional[str]:
        return secret if reveal else _mask(secret)

    return {
        "id": cfg.id,
        "scope": scope,
        "configured": twitter_configured(cfg),
        "revealed": reveal,
        "display_name": cfg.display_name,
        "username": cfg.username,
        "api_key": cfg.api_key,
        "client_id": cfg.client_id,
        "api_secret": show(cfg.api_secret),
        "client_secret": show(cfg.client_secret),
        "bearer_token": show(cfg.bearer_token),
        "access_token": show(cfg.access_token),
        "access_token_secret": show(cfg.access_token_secret),
        "has_api_secret": bool(cfg.api_secret),
        "has_bearer_token": bool(cfg.bearer_token),
        "has_access_token": bool(cfg.access_token),
        "is_active": bool(cfg.is_active),
        "description": cfg.description,
        "created_at": cfg.created_at,
        "updated_at": cfg.updated_at,
    }


def _get(db: Session, owner_user_id: Optional[int]) -> Optional[TwitterConfig]:
    query = db.query(TwitterConfig)
    query = (
        query.filter(TwitterConfig.owner_user_id.is_(None))
        if owner_user_id is None
        else query.filter(TwitterConfig.owner_user_id == owner_user_id)
    )
    return query.first()


def _upsert(db: Session, owner_user_id: Optional[int], data: TwitterUpsert) -> TwitterConfig:
    cfg = _get(db, owner_user_id)
    if cfg is None:
        cfg = TwitterConfig(owner_user_id=owner_user_id, is_active=True)
        db.add(cfg)

    payload = data.model_dump(exclude_unset=True)

    for field in PLAIN_FIELDS:
        if field in payload:
            value = payload[field]
            setattr(cfg, field, (value or "").strip() or None if isinstance(value, str) else value)

    # A secret that is absent from the payload keeps its stored value, so the UI can
    # save the form without ever round-tripping the real secret back to the browser.
    for field in SECRET_FIELDS:
        if field in payload and payload[field] is not None:
            setattr(cfg, field, payload[field].strip() or None)

    if payload.get("is_active") is not None:
        cfg.is_active = bool(payload["is_active"])

    if cfg.username:
        cfg.username = cfg.username.lstrip("@") or None

    db.commit()
    db.refresh(cfg)
    return cfg


def _delete(db: Session, owner_user_id: Optional[int]) -> dict:
    cfg = _get(db, owner_user_id)
    if not cfg:
        raise HTTPException(status_code=404, detail="No X (Twitter) configuration found")
    db.delete(cfg)
    db.commit()
    return {"detail": "X (Twitter) configuration removed"}


def _verify_bearer(bearer_token: str) -> dict:
    """Call X with the bearer token and report what actually came back.

    The token is sent EXACTLY as stored. X issues bearer tokens percent-encoded
    (%2B, %3D); URL-decoding one makes X reject it with 401, so it must never be
    unquoted on the way out.
    """
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                "https://api.x.com/2/users/by/username/TwitterDev",
                headers={"Authorization": f"Bearer {bearer_token}"},
            )
    except httpx.HTTPError as exc:
        logger.warning("X API test call failed: %s", exc)
        return {"success": False, "message": f"Could not reach the X API: {exc.__class__.__name__}"}

    if resp.status_code == 200:
        return {"success": True, "message": "Connected to the X API — bearer token is valid."}
    if resp.status_code == 401:
        return {"success": False, "message": "X rejected the bearer token (401 Unauthorized). Check it was copied exactly, including any %2B / %3D."}
    if resp.status_code == 402:
        # Auth succeeded — the token is good, but the X plan has nothing left to spend.
        return {"success": False, "message": "Bearer token is valid, but your X API plan has no credits left (402 Payment Required). Top up the plan in the X Developer Portal — reads will fail until you do."}
    if resp.status_code == 429:
        return {"success": True, "message": "Bearer token is valid, but you are currently rate limited (429). Try again shortly."}
    if resp.status_code == 403:
        return {"success": False, "message": "X returned 403 Forbidden — the app is authenticated but not entitled to this endpoint. Check the app's access level."}
    return {"success": False, "message": f"X returned HTTP {resp.status_code}."}


def _test(cfg: Optional[TwitterConfig]) -> dict:
    """Verify the stored credentials against the live X API where possible."""
    if cfg is None:
        return {"success": False, "message": "No configuration saved yet."}
    if not cfg.is_active:
        return {"success": False, "message": "Configuration is inactive."}

    if cfg.bearer_token:
        return _verify_bearer(cfg.bearer_token)

    # Without a bearer token we can't make an app-only call, so fall back to
    # reporting whether the credential set is at least complete.
    if cfg.api_key and cfg.api_secret and cfg.access_token and cfg.access_token_secret:
        return {"success": True, "message": "OAuth 1.0a keys present — ready to post as @%s." % (cfg.username or "user")}
    if cfg.api_key and cfg.api_secret:
        return {"success": False, "message": "API Key and Secret saved. Add a Bearer Token for read access, or an Access Token + Secret pair to post."}
    return {"success": False, "message": "Add either a Bearer Token, or the API Key + Secret and Access Token pair."}


# ── Admin: the platform/global row ────────────────────────

@router.get("/admin/twitter-config")
def admin_get(
    reveal: bool = Query(False, description="Return secrets in full instead of masked."),
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    """The platform config. Secrets are masked unless `reveal=true` is asked for.

    Revealing is admin-only and audit-logged — the plaintext credentials are the
    keys to the org's X account, so a deliberate request is required to see them.
    """
    cfg = _get(db, None)
    if reveal and cfg is not None:
        logger.info(
            "X (Twitter) platform secrets revealed by user_id=%s (%s)",
            admin.id, getattr(admin, "email", "?"),
        )
    return _to_dict(cfg, scope="platform", reveal=reveal)


@router.put("/admin/twitter-config")
def admin_upsert(data: TwitterUpsert, db: Session = Depends(get_db),
                 _admin: User = Depends(get_current_admin)):
    return _to_dict(_upsert(db, None, data), scope="platform")


@router.delete("/admin/twitter-config")
def admin_delete(db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)):
    return _delete(db, None)


@router.post("/admin/twitter-config/test")
def admin_test(db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)):
    return _test(_get(db, None))


# ── Account: the calling user's own row ───────────────────

@router.get("/account/twitter-config")
def account_get(
    reveal: bool = Query(False, description="Return this account's own secrets in full."),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """This account's own config.

    `reveal=true` returns the caller's OWN secrets in full. It can never expose the
    platform credentials — the fallback branch below returns no secrets at all, so a
    user cannot read the org's keys by asking for them here.
    """
    own = _get(db, current_user.id)
    if own is not None:
        if reveal:
            logger.info(
                "X (Twitter) account secrets revealed by user_id=%s (%s)",
                current_user.id, getattr(current_user, "email", "?"),
            )
        return _to_dict(own, scope="account", reveal=reveal)

    # Surface the platform fallback so the UI can say "using the platform default".
    # Deliberately carries no credentials, revealed or otherwise.
    glob = _get(db, None)
    if twitter_configured(glob):
        return {"configured": False, "scope": "platform", "is_active": False,
                "platform_fallback": True}
    return {"configured": False, "scope": "none", "is_active": False}


@router.put("/account/twitter-config")
def account_upsert(data: TwitterUpsert, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    return _to_dict(_upsert(db, current_user.id, data), scope="account")


@router.delete("/account/twitter-config")
def account_delete(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _delete(db, current_user.id)


@router.post("/account/twitter-config/test")
def account_test(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _test(_get(db, current_user.id))
