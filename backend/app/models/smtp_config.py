from datetime import datetime

from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.crypto import EncryptedString


class SmtpConfig(Base):
    """
    SMTP credentials used to send an account's emails.

    SaaS model: each end-user account has its own row, keyed by `owner_user_id`.
    `owner_user_id IS NULL` marks the single **platform/global default** row
    (super-admin managed). email_service resolves the account's own active config
    first and falls back to the global default, then to the env `settings.SMTP_*`.

    Secrets are stored as-is and masked on read (consistent with
    MeetingProviderConfig — app-layer encryption is future work).
    """
    __tablename__ = "smtp_config"
    __table_args__ = (
        UniqueConstraint("owner_user_id", name="uq_smtp_config_owner"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    # NULL = platform/global default (super-admin); set = a specific account's config.
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)

    host = Column(String(255), nullable=True)
    port = Column(Integer, default=587, nullable=False)
    username = Column(String(255), nullable=True)
    password = Column(EncryptedString, nullable=True)   # encrypted at rest
    use_tls = Column(Boolean, default=True, nullable=False)
    from_name = Column(String(255), nullable=True)
    from_email = Column(String(320), nullable=True)

    is_active = Column(Boolean, default=True, nullable=False, index=True)

    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    owner = relationship("User", foreign_keys=[owner_user_id])
    updater = relationship("User", foreign_keys=[updated_by])
