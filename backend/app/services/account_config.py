"""
Per-account configuration resolution (SaaS multi-tenant).

Each end-user account (a User) can own its own SMTP + meeting-provider (Zoom/Teams)
config. A row with `owner_user_id IS NULL` is the platform/global default managed by
the super-admin. Resolution always prefers the account's own active+configured row
and falls back to the global default; SMTP falls back further to the env settings.

The "owning account" for an email/meeting is the board/meeting creator (see
`owner_of_board` / `owner_of_meeting`).
"""
from typing import Optional

from sqlalchemy.orm import Session

from app.models.smtp_config import SmtpConfig
from app.models.meeting_provider import MeetingProviderConfig, MeetingProvider
from app.models.twitter_config import TwitterConfig, twitter_configured


# ── Owner helpers ────────────────────────────────────────

def owner_of_board(board) -> Optional[int]:
    if not board:
        return None
    return board.created_by


def owner_of_meeting(meeting) -> Optional[int]:
    if not meeting:
        return None
    if getattr(meeting, "board", None) and meeting.board.created_by:
        return meeting.board.created_by
    return getattr(meeting, "organizer_id", None)


# ── SMTP resolution ──────────────────────────────────────

def _smtp_configured(c: Optional[SmtpConfig]) -> bool:
    return bool(c and c.is_active and c.host)


def resolve_smtp(db: Session, owner_user_id: Optional[int]) -> Optional[SmtpConfig]:
    """Account's active SMTP config, else the global (owner NULL) default, else None
    (caller falls back to env settings.SMTP_*)."""
    if owner_user_id is not None:
        own = db.query(SmtpConfig).filter(SmtpConfig.owner_user_id == owner_user_id).first()
        if _smtp_configured(own):
            return own
    glob = db.query(SmtpConfig).filter(SmtpConfig.owner_user_id.is_(None)).first()
    if _smtp_configured(glob):
        return glob
    return None


def smtp_source(db: Session, owner_user_id: Optional[int]) -> str:
    """'account' | 'platform' | 'none' — what backs this account's outbound email."""
    if owner_user_id is not None:
        own = db.query(SmtpConfig).filter(SmtpConfig.owner_user_id == owner_user_id).first()
        if _smtp_configured(own):
            return "account"
    glob = db.query(SmtpConfig).filter(SmtpConfig.owner_user_id.is_(None)).first()
    if _smtp_configured(glob):
        return "platform"
    return "none"


# ── Meeting-provider (Zoom/Teams) resolution ─────────────

def _provider_configured(c: Optional[MeetingProviderConfig]) -> bool:
    return bool(c and c.client_id)


def _platform_livekit_available() -> bool:
    """LiveKit is the one provider WE host, so its platform default lives in
    settings (LIVEKIT_URL/KEY/SECRET) rather than in a global config row. An
    account with no LiveKit row of its own can still hold meetings on ours —
    which is the whole point of adding it next to Zoom."""
    from app.core.config import settings
    return bool(settings.LIVEKIT_URL and settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_SECRET)


def resolve_provider(
    db: Session, owner_user_id: Optional[int], provider: Optional[str] = None,
    allow_global: bool = True,
) -> Optional[MeetingProviderConfig]:
    """The account's configured provider config, else (when `allow_global`) the
    global default.

    With `provider` given, returns that specific provider's config. Without it,
    returns the account's active provider (or the active global one).

    `allow_global=False` enforces account-only resolution — used when actually
    provisioning a Zoom/Teams meeting so an account can't silently ride on the
    platform's credentials."""
    def _query(owner):
        q = db.query(MeetingProviderConfig)
        q = q.filter(MeetingProviderConfig.owner_user_id == owner) if owner is not None \
            else q.filter(MeetingProviderConfig.owner_user_id.is_(None))
        if provider:
            q = q.filter(MeetingProviderConfig.provider == provider)
            return q.first()
        return q.filter(MeetingProviderConfig.is_active.is_(True)).first()

    if owner_user_id is not None:
        own = _query(owner_user_id)
        if _provider_configured(own):
            return own
    if allow_global:
        glob = _query(None)
        if _provider_configured(glob):
            return glob
    return None


def provider_source(db: Session, owner_user_id: Optional[int], provider: str) -> str:
    """'account' | 'platform' | 'none' for a specific provider."""
    if owner_user_id is not None:
        own = db.query(MeetingProviderConfig).filter(
            MeetingProviderConfig.owner_user_id == owner_user_id,
            MeetingProviderConfig.provider == provider,
        ).first()
        if _provider_configured(own):
            return "account"
    glob = db.query(MeetingProviderConfig).filter(
        MeetingProviderConfig.owner_user_id.is_(None),
        MeetingProviderConfig.provider == provider,
    ).first()
    if _provider_configured(glob):
        return "platform"
    # LiveKit needs no global row — the platform's own server is the default.
    if provider == MeetingProvider.livekit.value and _platform_livekit_available():
        return "platform"
    return "none"


def configured_providers(db: Session, owner_user_id: Optional[int]) -> list:
    """The providers this account can actually provision with — its OWN configs
    only (no platform fallback). Drives the meeting-link provider picker."""
    out = []
    for p in (MeetingProvider.zoom.value, MeetingProvider.teams.value):
        cfg = resolve_provider(db, owner_user_id, provider=p, allow_global=False)
        if _provider_configured(cfg):
            out.append({
                "provider": p,
                "is_active": bool(cfg.is_active),
                "source": "account",
            })

    # LiveKit is offered whenever the platform runs one, even with no account
    # row — unlike Zoom/Teams there are no third-party credentials to supply, so
    # "not configured" would be misleading. An account row only matters when the
    # customer points us at their OWN LiveKit deployment.
    lk_row = db.query(MeetingProviderConfig).filter(
        MeetingProviderConfig.owner_user_id == owner_user_id,
        MeetingProviderConfig.provider == MeetingProvider.livekit.value,
    ).first() if owner_user_id is not None else None
    if lk_row or _platform_livekit_available():
        out.append({
            "provider": MeetingProvider.livekit.value,
            "is_active": bool(lk_row.is_active) if lk_row else False,
            "source": "account" if _provider_configured(lk_row) else "platform",
        })
    return out


def active_provider(db: Session, owner_user_id: Optional[int]) -> Optional[str]:
    """The provider this account marked active, or None if they haven't chosen.

    Falls back to LiveKit when the platform runs one and nothing is chosen, since
    that is what `_video_provider()` will actually open — the form should promise
    the same thing the meeting delivers.
    """
    if owner_user_id is not None:
        row = db.query(MeetingProviderConfig).filter(
            MeetingProviderConfig.owner_user_id == owner_user_id,
            MeetingProviderConfig.is_active.is_(True),
        ).first()
        if row:
            return _enum_value_local(row.provider)
    return MeetingProvider.livekit.value if _platform_livekit_available() else None


def _enum_value_local(v):
    return v.value if hasattr(v, "value") else v


# ── Combined status (dashboard banner + meeting-create warning) ──

def twitter_source(db: Session, owner_user_id: Optional[int]) -> str:
    """'account' | 'platform' | 'none' for the X (Twitter) integration."""
    if owner_user_id is not None:
        own = db.query(TwitterConfig).filter(
            TwitterConfig.owner_user_id == owner_user_id,
        ).first()
        if twitter_configured(own):
            return "account"
    glob = db.query(TwitterConfig).filter(TwitterConfig.owner_user_id.is_(None)).first()
    if twitter_configured(glob):
        return "platform"
    return "none"


def serpapi_source(db: Session, owner_user_id: Optional[int], model) -> str:
    """'account' | 'platform' | 'none' for Google Search / Google Scholar.

    'account' = the account saved its own active setting (Account → Google
    Search / Google Scholar). 'platform' = it falls back to the super admin's
    config. 'none' = neither, so searches run on the free fallback.
    """
    if owner_user_id is not None:
        own = db.query(model).filter(model.owner_user_id == owner_user_id,
                                     model.is_active == True).first()
        if own and (own.api_key or getattr(own, "provider", None) == "direct"):
            return "account"
    glob = db.query(model).filter(model.owner_user_id.is_(None), model.is_active == True).first()
    return "platform" if glob else "none"


def config_status(db: Session, owner_user_id: Optional[int]) -> dict:
    from app.models.configuration import GoogleScholarConfig, WebSearchConfig
    return {
        "smtp": {"source": smtp_source(db, owner_user_id)},
        "zoom": {"source": provider_source(db, owner_user_id, MeetingProvider.zoom.value)},
        "teams": {"source": provider_source(db, owner_user_id, MeetingProvider.teams.value)},
        "livekit": {"source": provider_source(db, owner_user_id, MeetingProvider.livekit.value)},
        # Which platform this account picked in Account → Meeting Platforms.
        # The meeting-create form needs it: asking for a Zoom link when the
        # account runs on LiveKit is just confusing.
        "active_provider": active_provider(db, owner_user_id),
        "twitter": {"source": twitter_source(db, owner_user_id)},
        "google_search": {"source": serpapi_source(db, owner_user_id, WebSearchConfig)},
        "google_scholar": {"source": serpapi_source(db, owner_user_id, GoogleScholarConfig)},
    }
