"""
Who opened which reading material, and for how long.

Dr Shruti's organizer dashboard is built almost entirely on this: "number of
experts who opened the slides for section 1/2/3", "number who referred to all
three sections", "number yet to refer to any", and "average time spent on
section N reading material". None of it was answerable — the only trace a
document left was a `kol.document_download` line in the board activity log,
which records that a file was fetched, not that anyone read it and certainly not
for how long.

One row per open. A participant who opens section 1 three times has three rows;
the rollups sum `seconds_spent` per participant before averaging, so a person
who keeps coming back counts once as a reader and their time adds up.
"""
import enum
from datetime import datetime

from sqlalchemy import (
    Column, Integer, String, DateTime, Enum, ForeignKey, Index,
)
from sqlalchemy.orm import relationship

from app.core.database import Base


class ViewSource(str, enum.Enum):
    # Opened in the portal's document viewer — the only path that can time.
    view = "view"
    # Downloaded. Counts as "referred to the material" (they took it away to
    # read), but contributes NO time: once the file leaves the browser we have
    # no idea how long it was open, and inventing a number would poison the
    # averages the organizer is reading.
    download = "download"


class MeetingDocumentView(Base):
    __tablename__ = "meeting_document_views"
    __table_args__ = (
        # "who opened section N" and "time spent on section N" both read by
        # (meeting, section, participant).
        Index("ix_mdv_meeting_agenda", "meeting_id", "agenda_item_id"),
        Index("ix_mdv_meeting_participant", "meeting_id", "participant_id"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)

    meeting_id = Column(Integer, ForeignKey("board_meetings.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("meeting_documents.id", ondelete="CASCADE"),
                         nullable=False, index=True)
    # Copied from the document at open time rather than joined on read. A
    # document can be re-filed under a different session later, and moving it
    # must not silently rewrite the history of who read what, when.
    agenda_item_id = Column(Integer, ForeignKey("meeting_agenda_items.id", ondelete="SET NULL"),
                            nullable=True, index=True)

    participant_id = Column(Integer, ForeignKey("meeting_participants.id", ondelete="SET NULL"),
                            nullable=True, index=True)
    # Name captured at open time, so the roll-up still reads correctly after a
    # participant is removed from the meeting.
    participant_label = Column(String(255), nullable=True)

    source = Column(Enum(ViewSource), default=ViewSource.view, nullable=False)
    # Seconds the document was actually open, maintained by heartbeat while the
    # viewer is on screen. Always 0 for a download.
    seconds_spent = Column(Integer, default=0, nullable=False)

    opened_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    meeting = relationship("BoardMeeting", foreign_keys=[meeting_id])
    document = relationship("MeetingDocument", foreign_keys=[document_id])
    agenda_item = relationship("MeetingAgendaItem", foreign_keys=[agenda_item_id])
    participant = relationship("MeetingParticipant", foreign_keys=[participant_id])
