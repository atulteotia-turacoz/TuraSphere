from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class ManualScoreInput(BaseModel):
    c1_board_member: bool = False
    c1_advisory_board: bool = False
    c1_professor: bool = False
    c1_society_leader: bool = False
    c1_executive_body: bool = False
    c2_presentations_count: int = 0
    c2_presentation_level: str = "domestic"
    c3_publications_count: int = 0
    c3_editorial_board: bool = False
    c3_intl_journal: bool = False
    c3_textbook_contributor: bool = False
    c4_years_experience: int = 0
    c4_procedures_per_year: int = 0
    c4_unique_expertise: bool = False


class AssessmentResponse(BaseModel):
    id: int
    hcp_id: int
    c1_leadership_score: Optional[float] = None
    c1_details: Optional[str] = None
    c2_presentations_score: Optional[float] = None
    c2_details: Optional[str] = None
    c3_publications_score: Optional[float] = None
    c3_details: Optional[str] = None
    c4_clinical_experience_score: Optional[float] = None
    c4_details: Optional[str] = None
    c5_citation_velocity_score: Optional[float] = None
    c5_details: Optional[str] = None
    c6_network_centrality_score: Optional[float] = None
    c6_details: Optional[str] = None
    c7_patient_impact_score: Optional[float] = None
    c7_details: Optional[str] = None
    c8_guideline_authority_score: Optional[float] = None
    c8_details: Optional[str] = None
    c9_emerging_leader_score: Optional[float] = None
    c9_details: Optional[str] = None
    base_score: Optional[float] = None
    bonus_score: Optional[float] = None
    final_score: Optional[float] = None
    tier: Optional[str] = None
    justification: Optional[str] = None
    confidence_flags: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
