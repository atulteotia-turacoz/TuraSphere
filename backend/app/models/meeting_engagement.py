import enum
from datetime import datetime

from sqlalchemy import Column, Integer, DateTime, Enum, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base


class SurveyPhase(str, enum.Enum):
    pre = "pre"
    post = "post"


class PollPhase(str, enum.Enum):
    live = "live"


class MeetingSurvey(Base):
    """Links an existing /surveys row to a meeting, tagged pre or post."""
    __tablename__ = "meeting_surveys"
    __table_args__ = (
        UniqueConstraint("meeting_id", "survey_id", "phase", name="uq_meeting_survey_phase"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    meeting_id = Column(Integer, ForeignKey("board_meetings.id", ondelete="CASCADE"), nullable=False, index=True)
    survey_id = Column(Integer, ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False, index=True)
    phase = Column(Enum(SurveyPhase), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    meeting = relationship("BoardMeeting", foreign_keys=[meeting_id])
    survey = relationship("Survey", foreign_keys=[survey_id])
    creator = relationship("User", foreign_keys=[created_by])


class MeetingPoll(Base):
    """Links an existing /polls row to a meeting (always 'live' for now — Phase 3)."""
    __tablename__ = "meeting_polls"
    __table_args__ = (
        UniqueConstraint("meeting_id", "poll_id", name="uq_meeting_poll"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    meeting_id = Column(Integer, ForeignKey("board_meetings.id", ondelete="CASCADE"), nullable=False, index=True)
    poll_id = Column(Integer, ForeignKey("polls.id", ondelete="CASCADE"), nullable=False, index=True)
    phase = Column(Enum(PollPhase), default=PollPhase.live, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    meeting = relationship("BoardMeeting", foreign_keys=[meeting_id])
    poll = relationship("Poll", foreign_keys=[poll_id])
    creator = relationship("User", foreign_keys=[created_by])
