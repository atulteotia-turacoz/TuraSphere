import enum
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, Enum, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.mysql import MEDIUMTEXT
from sqlalchemy.orm import relationship

from app.core.database import Base


class RecordingSource(str, enum.Enum):
    provider = "provider"        # pulled from Teams/Zoom
    manual_upload = "manual_upload"


class TranscriptStatus(str, enum.Enum):
    draft = "draft"          # auto-generated, not yet edited
    edited = "edited"        # Medical Writer edited
    finalized = "finalized"  # admin signed off
    shared = "shared"        # distributed to participants


class MeetingRecording(Base):
    __tablename__ = "meeting_recordings"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    meeting_id = Column(Integer, ForeignKey("board_meetings.id", ondelete="CASCADE"), nullable=False, index=True)

    source = Column(Enum(RecordingSource), default=RecordingSource.manual_upload, nullable=False)
    file_path_or_url = Column(String(1000), nullable=False)
    duration_seconds = Column(Integer, nullable=True)

    recorded_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    meeting = relationship("BoardMeeting", back_populates="recordings")


class MeetingTranscript(Base):
    """One transcript per RECORDING, not per meeting.

    A meeting is often started and stopped several times, so it can hold several
    recordings — each is a separate stretch of conversation and deserves its own
    transcript. The old `unique(meeting_id)` made that impossible: transcribing a
    second recording overwrote the first.

    `recording_id` is nullable so transcripts that predate this (and Zoom's
    meeting-level auto-transcript, which has no recording row of ours) still fit.
    MySQL allows multiple NULLs under a unique index, so those legacy rows coexist.
    """
    __tablename__ = "meeting_transcripts"
    __table_args__ = (
        UniqueConstraint("recording_id", name="uq_meeting_transcript_recording"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    meeting_id = Column(Integer, ForeignKey("board_meetings.id", ondelete="CASCADE"), nullable=False, index=True)
    recording_id = Column(Integer, ForeignKey("meeting_recordings.id", ondelete="CASCADE"),
                          nullable=True, index=True)

    raw_text = Column(MEDIUMTEXT, nullable=True)     # provider-generated
    edited_text = Column(MEDIUMTEXT, nullable=True)  # Medical Writer's edits
    status = Column(Enum(TranscriptStatus), default=TranscriptStatus.draft, nullable=False)

    edited_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    finalized_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    shared_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    meeting = relationship("BoardMeeting", back_populates="transcripts")
    recording = relationship("MeetingRecording")
    editor = relationship("User", foreign_keys=[edited_by])
    finalizer = relationship("User", foreign_keys=[finalized_by])
