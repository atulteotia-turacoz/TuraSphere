import enum
from datetime import datetime

from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, Enum, Numeric, Index,
)

from app.core.database import Base
from app.models.advisory_board import BoardPhase


class FeeUnit(str, enum.Enum):
    fixed = "fixed"
    hourly = "hourly"
    per_day = "per_day"
    per_kol = "per_kol"
    per_region = "per_region"
    per_seat = "per_seat"


class AdvisoryService(Base):
    __tablename__ = "advisory_services"
    __table_args__ = (
        Index("ix_advisory_services_phase", "phase"),
        Index("ix_advisory_services_is_active", "is_active"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    # `slug` is the stable identifier used by AdvisoryBoard.service_ids JSON
    # (e.g. "pre_concept_dev"). Frontend-friendly; never changes once set.
    slug = Column(String(80), nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    fee_label = Column(String(255), nullable=True)
    phase = Column(Enum(BoardPhase), nullable=False)
    default_unit = Column(Enum(FeeUnit), default=FeeUnit.fixed, nullable=False)
    default_price = Column(Numeric(12, 2), default=0, nullable=False)
    currency = Column(String(10), default="USD", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
