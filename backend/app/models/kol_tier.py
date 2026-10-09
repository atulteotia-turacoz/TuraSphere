from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.core.database import Base


class KolTier(Base):
    """A KOL tier and the score band that earns it.

    These were six `if score >= N` branches inside `ScoringEngine.determine_tier`,
    so renaming a tier or moving a threshold meant a code change and a deploy.
    They are rows now, editable from Account -> KOL Tiers.

    Bands are read as `min_score <= score <= max_score`. `max_score` is NULL on
    the open-ended top band, so the highest tier keeps matching however high a
    score goes.
    """

    __tablename__ = "kol_tiers"

    id = Column(Integer, primary_key=True, index=True)
    # Tiers belong to an account, like assessment-parameter preferences and
    # master data. NULL marks the system template, cloned for an account the
    # first time it opens the tab.
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    # Stored on every assessment, so it must stay stable when the label changes.
    # Unique per account, not globally — two accounts each have a GLOBAL_KOL.
    code = Column(String(50), nullable=False)
    name = Column(String(100), nullable=False)
    min_score = Column(Float, nullable=False, default=0)
    max_score = Column(Float, nullable=True)
    color = Column(String(30), nullable=True)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    # Seeded rows cannot be deleted — an assessment already carries their code —
    # but they can be renamed, re-banded or deactivated.
    is_standard = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
