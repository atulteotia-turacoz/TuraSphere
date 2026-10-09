"""
The advisory-board module's OWN KOL list (Advisory Boards → KOLs).

Distinct from the KOL module on purpose. A board's expert panel is assembled
from two places and the product treats both as first-class:

  * `hcp_profiles` — the KOL module's profile directory, carrying affiliations,
    years of experience, CV and assessments. Meeting invitations already draw
    from here, and these are the records the expert dashboard's header and the
    `/hcp/:id` profile links depend on.
  * `board_kols` — this table. Experts the advisory-board team knows about but
    who have no HCP profile: an external advisor, a client-side attendee, a
    name jotted down while scoping a board.

This list used to live in the browser's localStorage (`data.js`), which meant an
entry existed only on the machine that typed it, vanished on another, and could
never be assigned to a board — `advisory_boards.kol_ids` is server-side, and the
localStorage ids were strings like "kol_m1x2abc3" that its `List[int]` rejected.
That is the bug this table closes.
"""
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship

from app.core.database import Base


class BoardKol(Base):
    __tablename__ = "board_kols"
    __table_args__ = (
        Index("ix_board_kols_owner_active", "owner_user_id", "is_active"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    # Per account, like the participant contact book — one team's panel list is
    # not another's.
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    name = Column(String(255), nullable=False)
    specialty = Column(String(255), nullable=True)
    affiliation = Column(String(255), nullable=True)
    country = Column(String(120), nullable=True)
    email = Column(String(255), nullable=True, index=True)
    phone = Column(String(60), nullable=True)
    # tier_1 (Global) | tier_2 (Regional) | tier_3 (Local) — matches the labels
    # the KOLs tab has always shown.
    tier = Column(String(20), nullable=True, default="tier_2")
    notes = Column(Text, nullable=True)

    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    owner = relationship("User", foreign_keys=[owner_user_id])
