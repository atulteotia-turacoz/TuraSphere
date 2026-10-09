from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict


class HCPBase(BaseModel):
    full_name: str
    email: Optional[str] = None
    mobile: Optional[str] = None
    therapeutic_area: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    specialty: Optional[str] = None
    medical_registration_no: Optional[str] = None
    hcp_type: Optional[str] = "non_surgeon_doctor"
    institution: Optional[str] = None
    affiliations: Optional[str] = None
    years_of_experience: Optional[int] = None
    procedures_per_year: Optional[int] = None
    unique_expertise: Optional[str] = None
    faculty_positions: Optional[str] = None
    education: Optional[str] = None
    age_estimate: Optional[int] = None
    designation: Optional[str] = None
    key_clinical_interests: Optional[str] = None
    publications: Optional[str] = None
    conference_presentations: Optional[str] = None
    advisory_board: Optional[str] = None
    textbooks: Optional[str] = None
    office_bearer_positions: Optional[str] = None
    affiliated_to_government: Optional[str] = None
    professional_memberships: Optional[str] = None
    awards_recognitions: Optional[str] = None


class HCPCreate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    mobile: Optional[str] = None
    therapeutic_area: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    specialty: Optional[str] = None
    medical_registration_no: Optional[str] = None
    hcp_type: Optional[str] = "non_surgeon_doctor"
    institution: Optional[str] = None
    affiliations: Optional[str] = None
    years_of_experience: Optional[int] = None
    procedures_per_year: Optional[int] = None
    unique_expertise: Optional[str] = None
    faculty_positions: Optional[str] = None
    education: Optional[str] = None
    age_estimate: Optional[int] = None
    designation: Optional[str] = None
    key_clinical_interests: Optional[str] = None
    publications: Optional[str] = None
    conference_presentations: Optional[str] = None
    advisory_board: Optional[str] = None
    textbooks: Optional[str] = None
    office_bearer_positions: Optional[str] = None
    affiliated_to_government: Optional[str] = None
    professional_memberships: Optional[str] = None
    awards_recognitions: Optional[str] = None

    # SHA-256 the CV extraction handed back, passed straight through so the
    # create can recognise the same file even when the CV carried no email,
    # mobile or registration number to match on.
    cv_hash: Optional[str] = None
    # The existing HCP this submission has been confirmed to be. Sent by the
    # New Assessment form once the duplicate it found is settled — including a
    # weaker match the user confirmed by hand, which the server would not have
    # merged on its own. Routing that through the create (rather than a plain
    # update) is what puts the "a duplicate was recognised" entry on the
    # record's audit trail.
    merge_into: Optional[int] = None
    # Set only when the user has been shown a duplicate warning and has chosen
    # "create a new record anyway". Without it, a create that matches an
    # existing HCP on the CV file, registration number, email or mobile re-uses
    # that record instead of adding a second one for the same person.
    force_new: bool = False


class HCPDuplicateCheckRequest(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    mobile: Optional[str] = None
    medical_registration_no: Optional[str] = None
    city: Optional[str] = None
    institution: Optional[str] = None
    cv_hash: Optional[str] = None
    # The record being re-assessed, so it never matches itself.
    exclude_id: Optional[int] = None


class HCPUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    mobile: Optional[str] = None
    therapeutic_area: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    specialty: Optional[str] = None
    medical_registration_no: Optional[str] = None
    hcp_type: Optional[str] = None
    institution: Optional[str] = None
    affiliations: Optional[str] = None
    years_of_experience: Optional[int] = None
    procedures_per_year: Optional[int] = None
    unique_expertise: Optional[str] = None
    faculty_positions: Optional[str] = None
    education: Optional[str] = None
    age_estimate: Optional[int] = None
    designation: Optional[str] = None
    key_clinical_interests: Optional[str] = None
    publications: Optional[str] = None
    conference_presentations: Optional[str] = None
    advisory_board: Optional[str] = None
    textbooks: Optional[str] = None
    office_bearer_positions: Optional[str] = None
    affiliated_to_government: Optional[str] = None
    professional_memberships: Optional[str] = None
    awards_recognitions: Optional[str] = None


class HCPResponse(HCPBase):
    id: int
    user_id: int
    cv_file_path: Optional[str] = None
    consent_file_path: Optional[str] = None
    consent_uploaded_at: Optional[datetime] = None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class HCPListResponse(BaseModel):
    total: int
    items: List[HCPResponse]
