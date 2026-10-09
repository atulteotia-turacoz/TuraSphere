from datetime import datetime

from sqlalchemy import Column, Integer, String, Float, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from app.core.database import Base


class Assessment(Base):
    __tablename__ = "assessments"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    hcp_id = Column(Integer, ForeignKey("hcp_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    assessed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    # Criterion 1: Leadership
    c1_leadership_score = Column(Float, nullable=True)
    c1_details = Column(Text, nullable=True)  # JSON stored as Text

    # Criterion 2: Presentations
    c2_presentations_score = Column(Float, nullable=True)
    c2_details = Column(Text, nullable=True)

    # Criterion 3: Publications
    c3_publications_score = Column(Float, nullable=True)
    c3_details = Column(Text, nullable=True)

    # Criterion 4: Clinical Experience
    c4_clinical_experience_score = Column(Float, nullable=True)
    c4_details = Column(Text, nullable=True)

    # Criterion 5: Citation Velocity
    c5_citation_velocity_score = Column(Float, nullable=True)
    c5_details = Column(Text, nullable=True)

    # Criterion 6: Network Centrality
    c6_network_centrality_score = Column(Float, nullable=True)
    c6_details = Column(Text, nullable=True)

    # Criterion 7: Patient Impact
    c7_patient_impact_score = Column(Float, nullable=True)
    c7_details = Column(Text, nullable=True)

    # Criterion 8: Guideline Authority
    c8_guideline_authority_score = Column(Float, nullable=True)
    c8_details = Column(Text, nullable=True)

    # Criterion 9: Emerging Leader
    c9_emerging_leader_score = Column(Float, nullable=True)
    c9_details = Column(Text, nullable=True)

    # Aggregate scores
    base_score = Column(Float, nullable=True)
    bonus_score = Column(Float, nullable=True)
    final_score = Column(Float, nullable=True)

    # Tier classification
    tier = Column(
        String(50),
        nullable=True,
        index=True,
    )  # GLOBAL_KOL / STRATEGIC_KOL / NATIONAL_KOL / EMERGING_KOL / LOCAL_KOL / NON_KOL

    justification = Column(Text, nullable=True)
    confidence_flags = Column(Text, nullable=True)  # JSON stored as Text

    # External data snapshots
    pubmed_data = Column(Text, nullable=True)  # JSON stored as Text
    clinical_trials_data = Column(Text, nullable=True)  # JSON stored as Text
    network_data = Column(Text, nullable=True)  # JSON stored as Text

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    hcp_profile = relationship("HCPProfile", back_populates="assessments", foreign_keys=[hcp_id])
    assessor = relationship("User", back_populates="assessments", foreign_keys=[assessed_by])
    audit_logs = relationship("AuditLog", back_populates="assessment", foreign_keys="AuditLog.assessment_id")

    def __repr__(self):
        return f"<Assessment(id={self.id}, hcp_id={self.hcp_id}, tier='{self.tier}', final_score={self.final_score})>"
