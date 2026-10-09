"""
In-meeting chat for MABM board meetings.

Deliberately ours rather than Zoom's: messages persist with the board record and
stay readable after the meeting ends (Zoom's in-meeting chat lives in their cloud
and is gone from our side once the session closes). The meeting room renders this
in its side panel alongside the surveys and polls.

A message is written by exactly one of two kinds of sender, mirroring the two
ways into a meeting:
  - `user_id`        — a platform user in the authenticated meeting room
  - `participant_id` — a MeetingParticipant who came in via their join-link token
`sender_name` is denormalised so the transcript still reads correctly after a
participant is removed from the meeting.

Sending is gated by `BoardMeeting.chat_enabled` (the organizer's chat on/off
switch) plus the participant's `chat` permission — see app.services.meeting_access.
"""
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from app.core.database import Base


class MeetingChatMessage(Base):
    __tablename__ = "meeting_chat_messages"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    meeting_id = Column(Integer, ForeignKey("board_meetings.id", ondelete="CASCADE"),
                        nullable=False, index=True)

    # Exactly one of these is set; see module docstring.
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    participant_id = Column(Integer, ForeignKey("meeting_participants.id", ondelete="SET NULL"),
                            nullable=True)

    sender_name = Column(String(255), nullable=False)
    # Role label at send time ("Host", "KOL/Advisor", …) so the panel can badge
    # messages without re-resolving a participant that may since have changed.
    sender_role = Column(String(32), nullable=True)

    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    meeting = relationship("BoardMeeting", back_populates="chat_messages")
