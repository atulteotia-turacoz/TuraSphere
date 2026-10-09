import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, Enum, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from app.core.database import Base


class FormSubmissionStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    assessed = "assessed"
    failed = "failed"


class FormLink(Base):
    __tablename__ = "form_links"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token = Column(String(64), unique=True, nullable=False, index=True)
    title = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User", foreign_keys=[user_id])
    submissions = relationship("FormSubmission", back_populates="form_link", cascade="all, delete-orphan")


class FormSubmission(Base):
    __tablename__ = "form_submissions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    form_link_id = Column(Integer, ForeignKey("form_links.id", ondelete="CASCADE"), nullable=False, index=True)
    full_name = Column(String(255), nullable=True)
    email = Column(String(255), nullable=True)
    city = Column(String(100), nullable=True)
    specialty = Column(String(255), nullable=True)
    institution = Column(String(255), nullable=True)
    designation = Column(String(255), nullable=True)
    years_of_experience = Column(Integer, nullable=True)
    key_clinical_interests = Column(Text, nullable=True)
    publications = Column(Text, nullable=True)
    conference_presentations = Column(Text, nullable=True)
    professional_memberships = Column(Text, nullable=True)
    awards_recognitions = Column(Text, nullable=True)
    cv_file_path = Column(String(512), nullable=True)
    cv_parsed_data = Column(Text, nullable=True)
    status = Column(Enum(FormSubmissionStatus), default=FormSubmissionStatus.pending, nullable=False, index=True)
    hcp_id = Column(Integer, ForeignKey("hcp_profiles.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    form_link = relationship("FormLink", back_populates="submissions")
    hcp_profile = relationship("HCPProfile", foreign_keys=[hcp_id])
