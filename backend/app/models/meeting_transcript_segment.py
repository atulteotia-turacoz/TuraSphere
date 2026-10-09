"""
Live transcript segments — one utterance, attributed to one speaker.

Separate from `MeetingTranscript` (which holds the whole post-recording text)
because live transcription produces a stream of short, speaker-attributed lines
while the meeting is running, and the organizer needs to read them as they
arrive.

Speaker attribution is the reason this is worth doing at all: LiveKit delivers
each participant's microphone as its OWN audio track, so a transcript built from
the live room can say who spoke. Transcribing the finished recording cannot —
egress mixes everyone into a single audio stream.
"""
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Float, Index
from sqlalchemy.orm import relationship

from app.core.database import Base


class MeetingTranscriptSegment(Base):
    __tablename__ = "meeting_transcript_segments"
    __table_args__ = (
        # The panel polls "everything newer than the last id I have", so this is
        # the access path that matters.
        Index("ix_mts_meeting_id_id", "meeting_id", "id"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    meeting_id = Column(Integer, ForeignKey("board_meetings.id", ondelete="CASCADE"),
                        nullable=False, index=True)

    # LiveKit participant identity ("user-7", "participant-24"). Kept alongside
    # the display name so a segment can still be traced to a person after a
    # rename, and so the same speaker's lines can be grouped.
    speaker_identity = Column(String(128), nullable=True)
    speaker_name = Column(String(255), nullable=True)

    text = Column(Text, nullable=False)
    # Seconds from when live transcription started — lets the transcript be
    # lined up against the recording afterwards.
    offset_seconds = Column(Float, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    meeting = relationship("BoardMeeting", back_populates="transcript_segments")
