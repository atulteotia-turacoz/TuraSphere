import enum
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, Enum, ForeignKey
from sqlalchemy.orm import relationship

from app.core.database import Base


class BoardStatus(str, enum.Enum):
    # Aligned with frontend BOARD_STATUSES in pages/advisoryBoards/data.js
    planning = "planning"
    scheduled = "scheduled"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"


class BoardPhase(str, enum.Enum):
    # Aligned with frontend PHASES in pages/advisoryBoards/data.js
    pre_meeting = "pre_meeting"
    meeting = "meeting"
    post_meeting = "post_meeting"
    ongoing_support = "ongoing_support"
    event_specific = "event_specific"


class BoardFormat(str, enum.Enum):
    in_person = "in_person"
    virtual = "virtual"
    hybrid = "hybrid"


class AdvisoryBoard(Base):
    __tablename__ = "advisory_boards"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    title = Column(String(255), nullable=False)
    client = Column(String(255), nullable=True)
    sponsor = Column(String(255), nullable=True)  # master_data pharma_sponsor value
    therapeutic_areas = Column(Text, nullable=True)  # JSON array of master_data values
    regions = Column(Text, nullable=True)  # JSON array of master_data values
    currency = Column(String(10), nullable=True)
    status = Column(Enum(BoardStatus), default=BoardStatus.planning, nullable=False, index=True)
    current_phase = Column(Enum(BoardPhase), default=BoardPhase.pre_meeting, nullable=False)
    scheduled_date = Column(DateTime, nullable=True)
    start_time = Column(String(5), nullable=True)  # "HH:MM" — board/meeting start time
    end_time = Column(String(5), nullable=True)    # "HH:MM" — board/meeting end time
    format = Column(Enum(BoardFormat), default=BoardFormat.virtual, nullable=False)
    venue = Column(String(500), nullable=True)
    objective = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)

    # Carried over from existing data.js shape so KOLs/Catalog/Pricing tabs keep working
    kol_ids = Column(Text, nullable=True)        # JSON array of HCP ids
    service_ids = Column(Text, nullable=True)    # JSON array of service slugs
    pricing = Column(Text, nullable=True)        # JSON object — rate-card overrides

    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    creator = relationship("User", foreign_keys=[created_by])
    meetings = relationship("BoardMeeting", back_populates="board", cascade="all, delete-orphan")
