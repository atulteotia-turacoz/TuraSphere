"""
Advisory board workspace: the team assigned to a board and its audit trail.

- BoardTeamMember assigns platform users (medical writers / project managers /
  reviewers) to a board. Assignment also GATES access: only assigned members
  (plus platform admins and the board creator) can manage the board.
- BoardActivity is a board-scoped audit log of who did what, when.
"""
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base


class BoardTeamMember(Base):
    """A platform user assigned to an advisory board, with a workspace role label."""
    __tablename__ = "board_team_members"
    __table_args__ = (
        UniqueConstraint("board_id", "user_id", name="uq_board_team_member"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    board_id = Column(Integer, ForeignKey("advisory_boards.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Free-form workspace role label, e.g. "project_manager", "medical_writer", "reviewer".
    role = Column(String(50), nullable=False, default="medical_writer")

    assigned_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    assigned_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    board = relationship("AdvisoryBoard", foreign_keys=[board_id])
    user = relationship("User", foreign_keys=[user_id])


class BoardActivity(Base):
    """Board-scoped audit trail entry."""
    __tablename__ = "board_activities"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    board_id = Column(Integer, ForeignKey("advisory_boards.id", ondelete="CASCADE"), nullable=False, index=True)
    action = Column(String(255), nullable=False)
    details = Column(Text, nullable=True)
    performed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    # Non-platform-user actor (e.g. a KOL/advisor accessing via magic link), since
    # performed_by only references real users. Used for KOL login/download audit.
    actor_label = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Relationships
    board = relationship("AdvisoryBoard", foreign_keys=[board_id])
    performer = relationship("User", foreign_keys=[performed_by])
