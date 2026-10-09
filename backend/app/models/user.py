import enum
from datetime import datetime

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Enum, Text
from sqlalchemy.orm import relationship

from app.core.database import Base


class UserRole(str, enum.Enum):
    super_admin = "super_admin"
    admin = "admin"
    user = "user"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    full_name = Column(String(255), nullable=False)
    hashed_password = Column(String(512), nullable=False)
    role = Column(Enum(UserRole), default=UserRole.user, nullable=False)
    organization = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    # What an ADMIN has granted this user. NULL means "everything" — that is the
    # backwards-compatible reading for accounts created before this existed.
    granted_services = Column(Text, nullable=True)
    # Whether this account may use the LLM at all — CV extraction and rubric
    # scoring both. Off means the deterministic rule scorer runs instead and no
    # CV text or page image ever leaves the system for a model.
    ai_enabled = Column(Boolean, default=True, nullable=False, server_default="1")

    # Whether this account's KOL tier bands have been seeded from the template.
    # Seeding used to fire whenever the account had NO tier rows, which could
    # not tell "new account" from "an admin deleted them all on purpose" — so
    # clearing the bands silently restored the six defaults on the next read.
    kol_tiers_seeded = Column(Boolean, default=False, nullable=False)
    # Which of the granted services the USER has switched on. NULL means "all of
    # them". Always clamped to granted_services on write.
    allowed_services = Column(Text, nullable=True)  # JSON array of service slugs
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    hcp_profiles = relationship("HCPProfile", back_populates="user", foreign_keys="HCPProfile.user_id")
    assessments = relationship("Assessment", back_populates="assessor", foreign_keys="Assessment.assessed_by")
    audit_logs = relationship("AuditLog", back_populates="performer", foreign_keys="AuditLog.performed_by")

    def __repr__(self):
        return f"<User(id={self.id}, email='{self.email}', role='{self.role}')>"
