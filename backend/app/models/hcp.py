import enum
from datetime import datetime

from sqlalchemy import Column, Integer, String, Float, Text, DateTime, Enum, ForeignKey
from sqlalchemy.orm import relationship

from app.core.database import Base


class HCPType(str, enum.Enum):
    surgeon = "surgeon"
    non_surgeon_doctor = "non_surgeon_doctor"
    non_doctor = "non_doctor"


class HCPStatus(str, enum.Enum):
    draft = "draft"
    submitted = "submitted"
    assessed = "assessed"


class HCPProfile(Base):
    __tablename__ = "hcp_profiles"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    full_name = Column(String(255), nullable=True, index=True)
    email = Column(String(255), nullable=True)
    mobile = Column(String(50), nullable=True)
    therapeutic_area = Column(String(255), nullable=True)
    city = Column(String(100), nullable=True)
    country = Column(String(100), nullable=True)
    specialty = Column(String(255), nullable=True)
    medical_registration_no = Column(String(100), nullable=True)
    hcp_type = Column(String(100), nullable=True)
    institution = Column(String(255), nullable=True)
    affiliations = Column(Text, nullable=True)
    years_of_experience = Column(Integer, nullable=True)
    procedures_per_year = Column(Integer, nullable=True)
    unique_expertise = Column(Text, nullable=True)
    faculty_positions = Column(Text, nullable=True)
    education = Column(Text, nullable=True)
    age_estimate = Column(Integer, nullable=True)
    designation = Column(String(255), nullable=True)
    key_clinical_interests = Column(Text, nullable=True)
    publications = Column(Text, nullable=True)
    conference_presentations = Column(Text, nullable=True)
    advisory_board = Column(Text, nullable=True)
    # Repeatable sections, serialized the same way as advisory_board:
    # fields joined by ", ", rows by " | ".
    textbooks = Column(Text, nullable=True)
    office_bearer_positions = Column(Text, nullable=True)
    affiliated_to_government = Column(String(10), nullable=True)
    professional_memberships = Column(Text, nullable=True)
    awards_recognitions = Column(Text, nullable=True)
    cv_file_path = Column(String(512), nullable=True)
    # SHA-256 of the uploaded CV's bytes. The cheapest and most certain way to
    # recognise "this is the CV we already assessed": same file, same hex.
    cv_file_hash = Column(String(64), nullable=True, index=True)
    # Signed consent letter from the HCP. Stored alongside the CV but kept
    # separate on purpose: it is a compliance record, not a source of profile
    # data, so it is never parsed and never auto-fills the form.
    consent_file_path = Column(String(512), nullable=True)
    consent_uploaded_at = Column(DateTime, nullable=True)
    cv_parsed_data = Column(Text, nullable=True)  # JSON stored as Text for MySQL compatibility
    status = Column(Enum(HCPStatus), default=HCPStatus.draft, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User", back_populates="hcp_profiles", foreign_keys=[user_id])
    assessments = relationship("Assessment", back_populates="hcp_profile", foreign_keys="Assessment.hcp_id")

    def __repr__(self):
        return f"<HCPProfile(id={self.id}, full_name='{self.full_name}', status='{self.status}')>"
