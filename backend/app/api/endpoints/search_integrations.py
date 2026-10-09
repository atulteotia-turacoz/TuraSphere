"""Search integrations beyond the admin CRUD in configuration.py:

* the **usage report** — live SerpAPI plan/usage per key (SerpAPI's account API,
  which costs no search credit) plus our own `web_search_usage` log; and
* **Account → Google Search / Google Scholar**: an account's own SerpAPI key, used
  before the platform's (same rule as Account → X (Twitter)).
"""
from datetime import datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, get_super_admin
from app.models.configuration import GoogleScholarConfig, WebSearchConfig, WebSearchUsage
from app.models.user import User
from app.services.account_config import serpapi_source
from app.services.web_search_service import serpapi_account, test_serpapi_key

router = APIRouter(tags=["Search integrations"])


def _mask(key: Optional[str]) -> Optional[str]:
    if not key:
        return None
    return f"{key[:6]}…{key[-4:]}" if len(key) > 12 else "••••"


def _usage_log(db: Session, days: int, user_id: Optional[int] = None) -> dict:
    """Our own log: totals, a per-day series, per-user split and recent calls."""
    since = datetime.utcnow() - timedelta(days=days)
    base = db.query(WebSearchUsage).filter(WebSearchUsage.created_at >= since)
    if user_id is not None:
        base = base.filter(WebSearchUsage.user_id == user_id)

    totals = {"serpapi": 0, "fallback": 0, "failed": 0, "results": 0}
    by_feature: dict = {}
    for provider, status, feature, n, res in (
        base.with_entities(WebSearchUsage.provider, WebSearchUsage.status, WebSearchUsage.feature,
                           func.count(), func.coalesce(func.sum(WebSearchUsage.results), 0))
        .group_by(WebSearchUsage.provider, WebSearchUsage.status, WebSearchUsage.feature).all()
    ):
        if status != "ok":
            totals["failed"] += n
        elif provider == "serpapi":
            totals["serpapi"] += n
        else:
            totals["fallback"] += n
        totals["results"] += int(res or 0)
        if provider == "serpapi" and status == "ok":
            by_feature[feature] = by_feature.get(feature, 0) + n

    day = func.date(WebSearchUsage.created_at)
    daily: dict = {}
    for d, provider, status, n in (
        base.with_entities(day, WebSearchUsage.provider, WebSearchUsage.status, func.count())
        .group_by(day, WebSearchUsage.provider, WebSearchUsage.status).all()
    ):
        row = daily.setdefault(str(d), {"date": str(d), "serpapi": 0, "fallback": 0, "failed": 0})
        if status != "ok":
            row["failed"] += n
        elif provider == "serpapi":
            row["serpapi"] += n
        else:
            row["fallback"] += n
    series = []
    for i in range(days - 1, -1, -1):   # every day in the window, zeros included
        d = str((datetime.utcnow() - timedelta(days=i)).date())
        series.append(daily.get(d, {"date": d, "serpapi": 0, "fallback": 0, "failed": 0}))

    by_user = []
    if user_id is None:
        for uid, name, email, n_serp, n_all in (
            base.outerjoin(User, User.id == WebSearchUsage.user_id)
            .with_entities(WebSearchUsage.user_id, User.full_name, User.email,
                           func.sum(func.if_((WebSearchUsage.provider == "serpapi") & (WebSearchUsage.status == "ok"), 1, 0)),
                           func.count())
            .group_by(WebSearchUsage.user_id, User.full_name, User.email)
            .order_by(func.count().desc()).limit(20).all()
        ):
            by_user.append({"user_id": uid, "name": name or email or "—", "email": email,
                            "serpapi": int(n_serp or 0), "total": n_all})

    recent = [{
        "at": r.created_at.isoformat() if r.created_at else None,
        "user_id": r.user_id, "feature": r.feature, "provider": r.provider,
        "status": r.status, "results": r.results, "query": r.query, "error": r.error,
        "key_scope": r.key_scope,
    } for r in base.order_by(WebSearchUsage.id.desc()).limit(25).all()]

    return {"days": days, "totals": totals, "serpapi_by_feature": by_feature,
            "daily": series, "by_user": by_user, "recent": recent}


# ── Admin: usage report ─────────────────────────────────────────

@router.get("/admin/config/web-search/usage")
def admin_usage(days: int = Query(30, ge=1, le=90), db: Session = Depends(get_db),
                _=Depends(get_super_admin)):
    """Platform SerpAPI keys (Google Search + Google Scholar) with their live plan
    usage, plus the whole platform's usage log."""
    accounts, seen = [], set()
    rows = ([("Google Search", r) for r in db.query(WebSearchConfig)
             .filter(WebSearchConfig.owner_user_id.is_(None)).order_by(WebSearchConfig.id).all()]
            + [("Google Scholar", r) for r in db.query(GoogleScholarConfig)
               .filter(GoogleScholarConfig.owner_user_id.is_(None),
                       GoogleScholarConfig.provider == "serpapi").order_by(GoogleScholarConfig.id).all()])
    for used_for, r in rows:
        if not r.api_key:
            continue
        if r.api_key in seen:   # one SerpAPI account can back both — show it once
            next(a for a in accounts if a["_key"] == r.api_key)["used_for"].append(used_for)
            continue
        seen.add(r.api_key)
        accounts.append({"_key": r.api_key, "config_id": r.id, "display_name": r.display_name,
                         "key": _mask(r.api_key), "is_active": r.is_active, "used_for": [used_for],
                         **serpapi_account(r.api_key)})
    for a in accounts:
        a.pop("_key")
    account_keys = db.query(func.count(WebSearchConfig.id)).filter(
        WebSearchConfig.owner_user_id.isnot(None)).scalar()
    return {"accounts": accounts, "account_owned_keys": account_keys, **_usage_log(db, days)}


# ── Account: own Google Search / Google Scholar keys ────────────

class AccountKeyUpsert(BaseModel):
    api_key: Optional[str] = None       # blank = keep the stored key
    is_active: bool = True
    provider: Optional[str] = None      # Scholar only: 'serpapi' | 'direct'


def _account_payload(row, source: str) -> dict:
    # Same answer as the dashboard's "Needs Attention" (account_config.serpapi_source).
    source = "fallback" if source == "none" else source
    return {
        "id": row.id if row else None,
        "configured": row is not None,
        "api_key_masked": _mask(row.api_key) if row else None,
        "is_active": row.is_active if row else True,
        "provider": getattr(row, "provider", None) if row else None,
        # Which key a search by this account will actually use first.
        "source": source,
    }


def _own(db: Session, model, user: User):
    return db.query(model).filter(model.owner_user_id == user.id).first()


def _upsert(db: Session, model, user: User, data: AccountKeyUpsert, label: str, **extra):
    row = _own(db, model, user)
    key = (data.api_key or "").strip()
    if row is None:
        if not key and extra.get("provider") != "direct":
            raise HTTPException(status_code=400, detail="Enter your SerpAPI key.")
        row = model(owner_user_id=user.id, display_name=f"{label} — {user.email}"[:100], **extra)
        db.add(row)
    for k, v in extra.items():
        setattr(row, k, v)
    if key:
        row.api_key = key
    row.is_active = data.is_active
    row.is_default = False
    db.commit()
    db.refresh(row)
    return row


def _test_key(key: Optional[str]) -> dict:
    if not key:
        return {"success": False, "message": "No key saved yet."}
    ok, msg = test_serpapi_key(key)
    return {"success": ok, "message": msg}


@router.get("/account/web-search-config")
def account_ws_get(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _account_payload(_own(db, WebSearchConfig, user), serpapi_source(db, user.id, WebSearchConfig))


@router.put("/account/web-search-config")
def account_ws_put(data: AccountKeyUpsert, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    _upsert(db, WebSearchConfig, user, data, "Google Search", provider="serpapi")
    return account_ws_get(db, user)


@router.delete("/account/web-search-config")
def account_ws_delete(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _own(db, WebSearchConfig, user)
    if row:
        db.delete(row)
        db.commit()
    return {"detail": "Your Google Search key was removed; searches use the platform key again."}


@router.post("/account/web-search-config/test")
def account_ws_test(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _own(db, WebSearchConfig, user)
    return _test_key(row.api_key if row else None)


@router.get("/account/web-search-usage")
def account_ws_usage(days: int = Query(30, ge=1, le=90), db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)):
    """This account's own searches, plus its own SerpAPI key's plan usage.
    The platform key's plan is never exposed here."""
    accounts, seen = [], set()
    for model, used_for in ((WebSearchConfig, "Google Search"), (GoogleScholarConfig, "Google Scholar")):
        row = _own(db, model, user)
        if not row or not row.api_key or (model is GoogleScholarConfig and row.provider != "serpapi"):
            continue
        if row.api_key in seen:
            accounts[-1]["used_for"].append(used_for)
            continue
        seen.add(row.api_key)
        accounts.append({"key": _mask(row.api_key), "used_for": [used_for], **serpapi_account(row.api_key)})
    return {"accounts": accounts, **_usage_log(db, days, user_id=user.id)}


@router.get("/account/scholar-config")
def account_gs_get(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _account_payload(_own(db, GoogleScholarConfig, user), serpapi_source(db, user.id, GoogleScholarConfig))


@router.put("/account/scholar-config")
def account_gs_put(data: AccountKeyUpsert, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    provider = data.provider if data.provider in ("serpapi", "direct") else "serpapi"
    _upsert(db, GoogleScholarConfig, user, data, "Google Scholar", provider=provider)
    return account_gs_get(db, user)


@router.delete("/account/scholar-config")
def account_gs_delete(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _own(db, GoogleScholarConfig, user)
    if row:
        db.delete(row)
        db.commit()
    return {"detail": "Your Google Scholar key was removed; the platform setting is used again."}


@router.post("/account/scholar-config/test")
def account_gs_test(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = _own(db, GoogleScholarConfig, user)
    if row and row.provider == "direct":
        try:
            resp = httpx.get("https://scholar.google.com/scholar", params={"q": "test"}, timeout=10,
                             headers={"User-Agent": "Mozilla/5.0"}, follow_redirects=True)
            ok = resp.status_code == 200
            return {"success": ok, "message": "Google Scholar reachable (direct)." if ok
                    else f"Google Scholar returned {resp.status_code} — it may be rate-limiting direct access."}
        except Exception as exc:  # noqa: BLE001
            return {"success": False, "message": f"Connection failed: {exc}"}
    return _test_key(row.api_key if row else None)
