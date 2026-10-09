import enum
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, Enum, ForeignKey, Boolean
from sqlalchemy.orm import relationship

from app.core.database import Base


class MeetingStatus(str, enum.Enum):
    scheduled = "scheduled"
    live = "live"
    completed = "completed"
    cancelled = "cancelled"


class MeetingFormat(str, enum.Enum):
    in_person = "in_person"
    virtual = "virtual"
    hybrid = "hybrid"


class BoardMeeting(Base):
    __tablename__ = "board_meetings"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    board_id = Column(Integer, ForeignKey("advisory_boards.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    agenda_summary = Column(Text, nullable=True)  # one-line agenda blurb (doc requirement)

    scheduled_at = Column(DateTime, nullable=True, index=True)
    duration_minutes = Column(Integer, default=60, nullable=False)
    format = Column(Enum(MeetingFormat), default=MeetingFormat.virtual, nullable=False)
    status = Column(Enum(MeetingStatus), default=MeetingStatus.scheduled, nullable=False, index=True)

    # External meeting platform (Teams/Zoom). Phase 1: admin pastes URL manually.
    provider_id = Column(Integer, ForeignKey("meeting_provider_config.id", ondelete="SET NULL"), nullable=True)
    join_url = Column(String(1000), nullable=True)
    # Phase 4: when auto-provisioned via Zoom, the Zoom meeting numeric ID.
    # Used by webhook receiver to map recording.completed events back to a board_meeting.
    zoom_meeting_id = Column(String(64), nullable=True, index=True)
    # Meeting passcode (raw) — required by the in-app Zoom Meeting SDK embed, since
    # the join_url only carries the encrypted pwd. Stored from the create response.
    zoom_password = Column(String(64), nullable=True)

    # Organizer's chat on/off switch for the in-app chat panel. Off blocks new
    # messages; the existing transcript stays readable.
    chat_enabled = Column(Boolean, default=True, nullable=False)

    organizer_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    board = relationship("AdvisoryBoard", back_populates="meetings")
    organizer = relationship("User", foreign_keys=[organizer_id])
    provider = relationship("MeetingProviderConfig", foreign_keys=[provider_id])
    agenda_items = relationship("MeetingAgendaItem", back_populates="meeting",
                                cascade="all, delete-orphan", order_by="MeetingAgendaItem.sequence")
    participants = relationship("MeetingParticipant", back_populates="meeting", cascade="all, delete-orphan")
    documents = relationship("MeetingDocument", back_populates="meeting", cascade="all, delete-orphan")
    chat_messages = relationship("MeetingChatMessage", back_populates="meeting",
                                 cascade="all, delete-orphan")
    recordings = relationship("MeetingRecording", back_populates="meeting", cascade="all, delete-orphan")
    # A meeting can be recorded several times, and each recording gets its own
    # transcript — so this is a list, not a single row.
    transcripts = relationship("MeetingTranscript", back_populates="meeting",
                               cascade="all, delete-orphan")
    # Live, speaker-attributed lines captured while the meeting runs.
    transcript_segments = relationship("MeetingTranscriptSegment", back_populates="meeting",
                                       cascade="all, delete-orphan")


class MeetingAgendaItem(Base):
    __tablename__ = "meeting_agenda_items"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    meeting_id = Column(Integer, ForeignKey("board_meetings.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence = Column(Integer, default=0, nullable=False)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    duration_minutes = Column(Integer, nullable=True)
    presenter_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Relationships
    meeting = relationship("BoardMeeting", back_populates="agenda_items")
    presenter = relationship("User", foreign_keys=[presenter_user_id])
