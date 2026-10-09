from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.crypto import EncryptedString


class TwitterConfig(Base):
    """X (Twitter) API credentials.

    Same SaaS shape as MeetingProviderConfig: each end-user account has at most
    one row keyed by `owner_user_id`, and `owner_user_id IS NULL` marks the single
    **platform/global default** row managed by the super-admin from the admin app.

    Resolution prefers the account's own row and falls back to the global default,
    so `config_status` can report source = 'account' | 'platform' | 'none' and the
    dashboard can nudge a user who has not connected their own X account.
    """

    __tablename__ = "twitter_config"
    __table_args__ = (
        UniqueConstraint("owner_user_id", name="uq_twitter_config_owner"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    # NULL = platform/global default (super-admin); set = a specific account's config.
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),
                           nullable=True, index=True, unique=True)

    display_name = Column(String(100), nullable=True)
    # The @handle this config posts as — display only.
    username = Column(String(100), nullable=True)

    # Non-secret identifiers.
    api_key = Column(String(255), nullable=True)
    client_id = Column(String(255), nullable=True)

    # Secrets — encrypted at rest via EncryptedString (TEXT-backed).
    api_secret = Column(EncryptedString(500), nullable=True)
    client_secret = Column(EncryptedString(500), nullable=True)
    bearer_token = Column(EncryptedString(1000), nullable=True)
    access_token = Column(EncryptedString(1000), nullable=True)
    access_token_secret = Column(EncryptedString(500), nullable=True)

    is_active = Column(Boolean, default=True, nullable=False, index=True)
    description = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    owner = relationship("User", foreign_keys=[owner_user_id])

    def __repr__(self):
        scope = "global" if self.owner_user_id is None else f"user={self.owner_user_id}"
        return f"<TwitterConfig({scope}, @{self.username})>"


def twitter_configured(cfg: "TwitterConfig | None") -> bool:
    """True only when the credentials could actually authenticate against X.

    Two complete sets qualify:
      * a bearer token (app-only / read access), or
      * the full OAuth 1.0a quartet: api_key + api_secret + access_token +
        access_token_secret (user context / posting).

    A partial set does NOT count. An earlier version accepted a lone `access_token`
    or a bare `api_key`, which let a half-filled config report itself as working —
    and cleared the dashboard's "Needs Attention" nudge — while every X call failed.
    """
    if cfg is None or not cfg.is_active:
        return False
    if cfg.bearer_token:
        return True
    return bool(cfg.api_key and cfg.api_secret and cfg.access_token and cfg.access_token_secret)
