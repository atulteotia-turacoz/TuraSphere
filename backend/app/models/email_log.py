import enum
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, Enum, Boolean, ForeignKey
from sqlalchemy.orm import relationship

from app.core.database import Base


class EmailKind(str, enum.Enum):
    meeting_reminder_24h = "meeting_reminder_24h"
    meeting_reminder_1h = "meeting_reminder_1h"
    minutes_shared = "minutes_shared"
    minutes_finalized = "minutes_finalized"
    manuscript_shared = "manuscript_shared"
    manuscript_status_change = "manuscript_status_change"
    manuscript_15day_ping = "manuscript_15day_ping"
    survey_invite = "survey_invite"            # Phase 3 reserved — automation lands later
    thank_you = "thank_you"
    # Board workspace email actions
    kol_invite = "kol_invite"
    survey_reminder = "survey_reminder"
    document_review = "document_review"
    client_invite = "client_invite"   # board client portal link
    report_review = "report_review"
    other = "other"


class EmailLog(Base):
    """
    Audit row written by email_service.send_email(). Used for:
      - Idempotency on cron jobs (was this 24h reminder already sent?)
      - Operator visibility (admin "Email & Jobs" tab)
      - Debugging delivery failures
    """
    __tablename__ = "email_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    # SaaS: the account (board/meeting owner) whose config sent this — scopes the
    # per-account "Email Logs" view. NULL for platform-level / legacy sends.
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    recipient_email = Column(String(320), nullable=False, index=True)
    subject = Column(String(500), nullable=False)
    body_preview = Column(Text, nullable=True)   # first ~500 chars of body for the audit view
    kind = Column(Enum(EmailKind), default=EmailKind.other, nullable=False, index=True)

    related_board_id = Column(Integer, ForeignKey("advisory_boards.id", ondelete="SET NULL"), nullable=True, index=True)
    related_meeting_id = Column(Integer, ForeignKey("board_meetings.id", ondelete="SET NULL"), nullable=True, index=True)
    related_manuscript_id = Column(Integer, ForeignKey("manuscripts.id", ondelete="SET NULL"), nullable=True, index=True)

    success = Column(Boolean, default=True, nullable=False)
    error = Column(Text, nullable=True)

    sent_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    meeting = relationship("BoardMeeting", foreign_keys=[related_meeting_id])
    manuscript = relationship("Manuscript", foreign_keys=[related_manuscript_id])
