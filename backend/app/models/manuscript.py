import enum
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, Enum, ForeignKey
from sqlalchemy.orm import relationship

from app.core.database import Base


class ManuscriptStatus(str, enum.Enum):
    """
    Lifecycle from the doc:
      draft → review → finalized → submitted → under_review →
        accepted | rejected | resubmitted → published
    """
    draft = "draft"
    review = "review"            # shared with co-authors for comments
    finalized = "finalized"      # admin signed off
    submitted = "submitted"      # sent to journal
    under_review = "under_review"
    accepted = "accepted"
    rejected = "rejected"
    resubmitted = "resubmitted"
    published = "published"


# Status values that count as "active" — receive 15-day status pings until terminal
TERMINAL_STATUSES = {ManuscriptStatus.published.value, ManuscriptStatus.rejected.value}


class Manuscript(Base):
    """
    Expert opinion / consensus / guidelines / review document tied to a board meeting.
    The actual draft file lives in meeting_documents (referenced via document_id).
    Status transitions are logged in ManuscriptStatusHistory.
    """
    __tablename__ = "manuscripts"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    meeting_id = Column(Integer, ForeignKey("board_meetings.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(500), nullable=False)
    document_id = Column(Integer, ForeignKey("meeting_documents.id", ondelete="SET NULL"), nullable=True)
    status = Column(Enum(ManuscriptStatus), default=ManuscriptStatus.draft, nullable=False, index=True)

    journal_name = Column(String(255), nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    accepted_at = Column(DateTime, nullable=True)
    published_at = Column(DateTime, nullable=True)
    published_url = Column(String(1000), nullable=True)
    doi = Column(String(255), nullable=True)

    # When the most recent status-change email was sent — drives the 15-day cadence
    last_status_email_at = Column(DateTime, nullable=True)

    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    meeting = relationship("BoardMeeting", foreign_keys=[meeting_id])
    document = relationship("MeetingDocument", foreign_keys=[document_id])
    creator = relationship("User", foreign_keys=[created_by])
    comments = relationship(
        "ManuscriptComment", back_populates="manuscript",
        cascade="all, delete-orphan", order_by="ManuscriptComment.created_at",
    )
    status_history = relationship(
        "ManuscriptStatusHistory", back_populates="manuscript",
        cascade="all, delete-orphan", order_by="ManuscriptStatusHistory.changed_at",
    )


class ManuscriptComment(Base):
    __tablename__ = "manuscript_comments"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    manuscript_id = Column(Integer, ForeignKey("manuscripts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    manuscript = relationship("Manuscript", back_populates="comments")
    user = relationship("User", foreign_keys=[user_id])


class ManuscriptStatusHistory(Base):
    __tablename__ = "manuscript_status_history"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    manuscript_id = Column(Integer, ForeignKey("manuscripts.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(Enum(ManuscriptStatus), nullable=False)
    note = Column(Text, nullable=True)
    changed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    changed_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    manuscript = relationship("Manuscript", back_populates="status_history")
    changer = relationship("User", foreign_keys=[changed_by])
