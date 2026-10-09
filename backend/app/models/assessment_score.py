from sqlalchemy import Column, Integer, Float, Text, DateTime, ForeignKey, String, Boolean
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class AssessmentParameterScore(Base):
    __tablename__ = "assessment_parameter_scores"

    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False, index=True)
    parameter_id = Column(Integer, ForeignKey("assessment_parameters.id", ondelete="CASCADE"), nullable=False)
    parameter_code = Column(String(50), nullable=False)
    parameter_name = Column(String(255), nullable=False)
    parameter_category = Column(String(100), nullable=False)
    score = Column(Float, default=0)
    max_score = Column(Float, default=0)
    justification = Column(Text, nullable=True)
    scoring_source = Column(String(50), default="cv")  # cv, pubmed, clinical_trials, google_scholar, linkedin
    source_data = Column(Text, nullable=True)  # JSON: raw data from source (e.g. PubMed results)
    is_verified = Column(Boolean, default=False)
    verified_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
