"""Which SerpAPI keys a given account searches with, and the usage log.

Same SaaS rule as X (Twitter): an account's OWN key (Account → Google Search /
Google Scholar) is tried first, then the platform keys the super admin set in the
admin panel, then the free fallback (Brave / DuckDuckGo, or direct Scholar).
"""
import logging
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.configuration import GoogleScholarConfig, WebSearchConfig, WebSearchUsage

logger = logging.getLogger(__name__)


def web_search_keys(db: Session, user_id: Optional[int]) -> List[Tuple[int, str, str]]:
    """[(config_id, api_key, scope)] in the order to try them: the account's own
    active keys, then the platform's (default first). scope is 'account' | 'platform'."""
    q = db.query(WebSearchConfig).filter(WebSearchConfig.is_active == True,
                                         WebSearchConfig.provider == "serpapi")
    order = (WebSearchConfig.is_default.desc(), WebSearchConfig.id)
    own = q.filter(WebSearchConfig.owner_user_id == user_id).order_by(*order).all() if user_id else []
    platform = q.filter(WebSearchConfig.owner_user_id.is_(None)).order_by(*order).all()
    return ([(r.id, r.api_key, "account") for r in own if r.api_key]
            + [(r.id, r.api_key, "platform") for r in platform if r.api_key])


def scholar_keys(db: Session, user_id: Optional[int]) -> List[Tuple[int, str, str]]:
    """SerpAPI keys for Google Scholar, same order. Only configs set to the
    'serpapi' provider count; 'direct' configs mean "scrape Scholar directly",
    which is also the fallback when this list is empty or every key fails."""
    q = db.query(GoogleScholarConfig).filter(GoogleScholarConfig.is_active == True,
                                             GoogleScholarConfig.provider == "serpapi")
    order = (GoogleScholarConfig.is_default.desc(), GoogleScholarConfig.id)
    own = q.filter(GoogleScholarConfig.owner_user_id == user_id).order_by(*order).all() if user_id else []
    platform = q.filter(GoogleScholarConfig.owner_user_id.is_(None)).order_by(*order).all()
    return ([(r.id, r.api_key, "account") for r in own if r.api_key]
            + [(r.id, r.api_key, "platform") for r in platform if r.api_key])


def log_usage(events: List[Dict], user_id: Optional[int], feature: str,
              scopes: Optional[Dict[int, str]] = None) -> None:
    """Write provider-call events to web_search_usage on a session of its own, so
    it's safe from any thread and never disturbs the caller's transaction.
    Best-effort: a logging failure must never fail a search."""
    if not events:
        return
    db = SessionLocal()
    try:
        for e in events:
            db.add(WebSearchUsage(
                user_id=user_id, feature=feature,
                config_id=e.get("config_id"),
                key_scope=(scopes or {}).get(e.get("config_id")) if e.get("config_id") else None,
                provider=e["provider"], status=e["status"], results=e.get("results") or 0,
                query=(e.get("query") or "")[:500] or None, error=e.get("error"),
            ))
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning("Could not write web_search_usage: %s", exc)
    finally:
        db.close()
