"""
Per-session discussion forum on the advisory-board expert dashboard.

Dr Shruti's dashboard spec puts a "Discussion forum (provision should be given to
add comments)" under EACH session's reading material, so an expert can leave
thoughts on session 1's slides separately from session 2's — "We will take these
up during the meeting."

Why this is not `MeetingDocumentComment`:
  * that one hangs off a single document, and the forum is per session (an
    agenda item), spanning every document under it;
  * its author is `users.id`, and an advisory-board expert has no platform login
    at all — they arrive on a join token. The author here is the
    `meeting_participants` row, which works for a KOL, a contact or a teammate
    alike.

Three kinds of author (2026-09-21)
----------------------------------
The forum started as a KOL-only suggestion box: experts wrote, the client and
the organizer read the rollup on their Engagement tab and had no way to answer.
A board is a conversation, so all three sides now post into the same thread, and
`author_type` says which one wrote a row:

  ``participant``  a KOL / expert, on their join token   -> participant_id
  ``client``       the sponsor, on their portal token     -> client_id
  ``team``         the organizer / medical writer, logged in -> user_id

Exactly one of the three id columns is set. `author_name` is still captured at
write time for every row, so a comment stays attributed after the author's row
is removed — which is why all three foreign keys are ON DELETE SET NULL.
"""
from datetime import datetime

from sqlalchemy import Column, Integer, Text, String, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship

from app.core.database import Base


class MeetingSessionComment(Base):
    __tablename__ = "meeting_session_comments"
    __table_args__ = (
        # The forum reads "all comments on this session, oldest first".
        Index("ix_msc_agenda_created", "agenda_item_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    # The session being discussed, or NULL for a comment about the meeting as a
    # whole. Cascades with the agenda item — deleting a session takes its forum
    # with it.
    #
    # Nullable since 2026-09-21: the expert's Discussion tab is one flat thread,
    # because a card per session read as a second copy of the Agenda tab. What
    # is written there belongs to the meeting, not to any one session. The forum
    # still folded under each session on the expert dashboard keeps setting it.
    agenda_item_id = Column(Integer, ForeignKey("meeting_agenda_items.id", ondelete="CASCADE"),
                            nullable=True, index=True)
    # Denormalised so the organizer's per-section rollup ("comments given on
    # section 1, with the name of the expert") can be read per meeting without
    # joining back through agenda items.
    meeting_id = Column(Integer, ForeignKey("board_meetings.id", ondelete="CASCADE"),
                        nullable=False, index=True)

    # Author, as a meeting participant. SET NULL rather than CASCADE: removing
    # someone from the meeting must not silently delete what they contributed to
    # the discussion — the organizer still needs to read it.
    participant_id = Column(Integer, ForeignKey("meeting_participants.id", ondelete="SET NULL"),
                            nullable=True, index=True)
    # The client (sponsor) who wrote it, when author_type == "client". SET NULL
    # for the same reason as the participant: removing someone's portal access
    # must not erase what they said in the discussion.
    client_id = Column(Integer, ForeignKey("board_clients.id", ondelete="SET NULL"),
                       nullable=True, index=True)
    # The logged-in organizer / medical writer, when author_type == "team".
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"),
                     nullable=True, index=True)

    # Which side of the board wrote this: participant | client | team.
    # Defaulted rather than nullable — every row that predates the two-way forum
    # was written by a KOL on a join token, which is exactly "participant".
    author_type = Column(String(20), nullable=False, default="participant",
                         server_default="participant")
    # Author name captured at write time, so a comment stays attributed even
    # after the participant row goes.
    author_name = Column(String(255), nullable=True)

    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    agenda_item = relationship("MeetingAgendaItem", foreign_keys=[agenda_item_id])
    meeting = relationship("BoardMeeting", foreign_keys=[meeting_id])
    participant = relationship("MeetingParticipant", foreign_keys=[participant_id])
    client = relationship("BoardClient", foreign_keys=[client_id])
    user = relationship("User", foreign_keys=[user_id])
