import enum
from datetime import datetime

from sqlalchemy import Column, Integer, Boolean, Text, DateTime, Enum, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base


class MABMRole(str, enum.Enum):
    """
    Module-level roles for the MABM (Medical Advisory Board Meeting) platform.
    These are SEPARATE from the platform-wide users.role (super_admin/admin/user) —
    a user can have a platform role AND one or more MABM module roles.

    Per-meeting roles (panel_member, participant) live on meeting_participants.
    """
    super_admin = "super_admin"        # full MABM admin
    sub_admin = "sub_admin"            # delegated admin with granular permissions
    medical_writer = "medical_writer"  # transcript edit + minutes/manuscript authoring
    turacoz_team = "turacoz_team"      # internal Turacoz operator


class MABMRoleAssignment(Base):
    __tablename__ = "mabm_role_assignments"
    __table_args__ = (
        UniqueConstraint("user_id", "role", name="uq_mabm_role_user_role"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(Enum(MABMRole), nullable=False, index=True)

    # Granular permissions (mainly for sub_admin). JSON array of capability slugs:
    # e.g. ["meetings.create", "documents.manage", "manuscripts.review"]
    permissions = Column(Text, nullable=True)

    granted_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    granted_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    user = relationship("User", foreign_keys=[user_id])
    granter = relationship("User", foreign_keys=[granted_by])
