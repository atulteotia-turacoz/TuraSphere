import enum
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, Enum, ForeignKey, Boolean, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.crypto import EncryptedString


class MeetingProvider(str, enum.Enum):
    teams = "teams"
    zoom = "zoom"
    # Self-hosted SFU (see livekit.md). Unlike Zoom/Teams there is no external
    # account to link: credentials are a LiveKit URL + API key/secret, and the
    # platform default comes from LIVEKIT_* in settings when an account has no
    # row of its own. Recording, transcript and summary are ours rather than
    # gated by a customer's Zoom plan.
    livekit = "livekit"


class MeetingProviderConfig(Base):
    """
    Meeting provider (Teams or Zoom) credentials.

    SaaS model: each end-user account has its own row(s), keyed by `owner_user_id`.
    `owner_user_id IS NULL` marks the single **platform/global default** row per
    provider (super-admin managed). Config resolution prefers the account's own
    active row and falls back to the global default.

    `is_active=True` should hold for at most one row per (owner_user_id) — i.e. one
    active provider per account, plus one active global — enforced at app layer.
    """
    __tablename__ = "meeting_provider_config"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "provider", name="uq_meeting_provider_config_owner_provider"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    # NULL = platform/global default (super-admin); set = a specific account's config.
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    provider = Column(Enum(MeetingProvider), nullable=False)
    is_active = Column(Boolean, default=False, nullable=False, index=True)

    # OAuth / API credentials. `client_secret` is encrypted at rest (EncryptedString);
    # client_id / tenant_id / account_id are non-secret identifiers.
    client_id = Column(String(255), nullable=True)
    client_secret = Column(EncryptedString, nullable=True)
    tenant_id = Column(String(255), nullable=True)   # Teams (Microsoft Graph)
    account_id = Column(String(255), nullable=True)  # Zoom

    # Provider-specific extras (webhook secrets, organizer id, …) as JSON — encrypted
    # at rest since it can hold a Zoom webhook secret.
    extra_config = Column(EncryptedString, nullable=True)

    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    owner = relationship("User", foreign_keys=[owner_user_id])
    updater = relationship("User", foreign_keys=[updated_by])
