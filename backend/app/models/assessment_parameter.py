from sqlalchemy import Column, Integer, String, Boolean, Float, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class AssessmentParameter(Base):
    __tablename__ = "assessment_parameters"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String(100), nullable=False)
    code = Column(String(50), nullable=False, unique=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    max_score = Column(Float, default=0)
    is_active = Column(Boolean, default=True)
    is_standard = Column(Boolean, default=True)  # True = system/admin param, False = user-created
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)  # NULL = system-seeded
    scoring_source = Column(String(50), default="cv")  # cv, pubmed, clinical_trials, google_scholar, linkedin
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user_preferences = relationship("UserParameterPreference", back_populates="parameter", cascade="all, delete-orphan")


class UserParameterPreference(Base):
    __tablename__ = "user_parameter_preferences"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    parameter_id = Column(Integer, ForeignKey("assessment_parameters.id", ondelete="CASCADE"), nullable=False)
    is_enabled = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    parameter = relationship("AssessmentParameter", back_populates="user_preferences")
