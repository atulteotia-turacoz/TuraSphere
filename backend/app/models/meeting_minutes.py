import enum
from datetime import datetime

from sqlalchemy import Column, Integer, Text, DateTime, Enum, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.mysql import MEDIUMTEXT
from sqlalchemy.orm import relationship

from app.core.database import Base


class MinutesStatus(str, enum.Enum):
    draft = "draft"           # MW or admin drafting
    shared = "shared"         # shared with participants for review
    finalized = "finalized"   # admin signed off


class MeetingMinutes(Base):
    """
    Minutes of Meeting — distinct from MeetingTranscript. Typically authored
    *from* a transcript, but lives as its own document with its own comment
    thread and admin-finalize gate.
    """
    __tablename__ = "meeting_minutes"
    __table_args__ = (
        UniqueConstraint("meeting_id", name="uq_meeting_minutes"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    meeting_id = Column(Integer, ForeignKey("board_meetings.id", ondelete="CASCADE"), nullable=False, index=True)
    source_transcript_id = Column(Integer, ForeignKey("meeting_transcripts.id", ondelete="SET NULL"), nullable=True)

    draft_text = Column(MEDIUMTEXT, nullable=True)
    final_text = Column(MEDIUMTEXT, nullable=True)
    status = Column(Enum(MinutesStatus), default=MinutesStatus.draft, nullable=False)

    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    finalized_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    shared_at = Column(DateTime, nullable=True)
    finalized_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    creator = relationship("User", foreign_keys=[created_by])
    finalizer = relationship("User", foreign_keys=[finalized_by])
    comments = relationship(
        "MeetingMinutesComment", back_populates="minutes",
        cascade="all, delete-orphan", order_by="MeetingMinutesComment.created_at",
    )


class MeetingMinutesComment(Base):
    __tablename__ = "meeting_minutes_comments"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    minutes_id = Column(Integer, ForeignKey("meeting_minutes.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    minutes = relationship("MeetingMinutes", back_populates="comments")
    user = relationship("User", foreign_keys=[user_id])
