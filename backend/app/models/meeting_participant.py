import enum
from datetime import datetime

from sqlalchemy import Column, Integer, Boolean, Text, String, DateTime, Enum, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base


class ParticipantRole(str, enum.Enum):
    """
    Per-meeting role. Drives the default permission set granted to a participant
    (see app.services.meeting_access.DEFAULT_PERMISSIONS_BY_ROLE), which can then
    be overridden per participant via the `permissions` JSON column.
    """
    host = "host"                 # meeting owner/chair — full control
    moderator = "moderator"       # moderates chat/Q&A + manage controls, no auto speak
    panel_member = "panel_member"  # can speak + chat
    participant = "participant"   # chat only (default)
    observer = "observer"         # view-only


class InviteStatus(str, enum.Enum):
    pending = "pending"
    sent = "sent"
    accepted = "accepted"
    declined = "declined"


class MeetingParticipant(Base):
    __tablename__ = "meeting_participants"
    __table_args__ = (
        UniqueConstraint("meeting_id", "user_id", name="uq_meeting_participant_user"),
        UniqueConstraint("meeting_id", "hcp_id", name="uq_meeting_participant_hcp"),
        UniqueConstraint("meeting_id", "board_kol_id", name="uq_meeting_participant_board_kol"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    meeting_id = Column(Integer, ForeignKey("board_meetings.id", ondelete="CASCADE"), nullable=False, index=True)
    # Exactly one of these three identifies the person:
    #   user_id        — a real platform user (`users`)
    #   participant_id — a contact-book entry (`participants`), no login
    #   hcp_id         — a KOL/advisor from the HCP directory (`hcp_profiles`)
    #   board_kol_id   — a KOL from the advisory-board module's own list (`board_kols`)
    # `hcp_id` is the advisory-board case: the expert IS their KOL record, so the
    # participant dashboard can show affiliations / years of experience and link
    # the expert roster to the real profile page (/hcp/:id). The other two remain
    # for platform teammates and ad-hoc contacts.
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    hcp_id = Column(Integer, ForeignKey("hcp_profiles.id", ondelete="CASCADE"), nullable=True, index=True)
    # An expert from the advisory-board module's OWN KOL list — someone with no
    # HCP profile at all (external advisor, client-side attendee). Same idea as
    # hcp_id: the expert IS their directory record, just the other directory.
    board_kol_id = Column(Integer, ForeignKey("board_kols.id", ondelete="CASCADE"), nullable=True, index=True)

    role = Column(Enum(ParticipantRole), default=ParticipantRole.participant, nullable=False)
    invite_status = Column(Enum(InviteStatus), default=InviteStatus.pending, nullable=False)
    can_speak = Column(Boolean, default=False, nullable=False)  # max 10 panel speakers (doc requirement)

    # Granular per-participant permissions for THIS meeting. JSON array of slugs
    # (see app.services.meeting_access.MEETING_PERMISSIONS), e.g. ["chat", "vote"].
    # Defaulted from the role at invite time; overridable per participant.
    permissions = Column(Text, nullable=True)

    # Per-participant "separate login" to join the meeting. A unique opaque token
    # backing a magic-link join URL (/meeting/join/{token}) — identifies the
    # participant individually so attendance + role/permissions apply per person.
    access_token = Column(String(64), unique=True, nullable=True, index=True)
    token_issued_at = Column(DateTime, nullable=True)
    # Short access code ("password") emailed alongside the join link — a light
    # second factor the participant enters on the portal before joining.
    access_code = Column(String(12), nullable=True)

    invited_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    joined_at = Column(DateTime, nullable=True)
    left_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    meeting = relationship("BoardMeeting", back_populates="participants")
    user = relationship("User", foreign_keys=[user_id])
    hcp = relationship("HCPProfile", foreign_keys=[hcp_id])
    board_kol = relationship("BoardKol", foreign_keys=[board_kol_id])
