from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.kol_directory import INFLUENCE_LEVELS
from app.services.name_titles import normalize_title


class KOLBase(BaseModel):
    title: Optional[str] = None      # Dr. / Prof. / Mr. / Mrs. / Ms.
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    contact_no: Optional[str] = None

    therapeutic_area: Optional[str] = None
    geographic_zone: Optional[str] = None
    state_city: Optional[str] = None
    specialty: Optional[str] = None
    subspecialty: Optional[str] = None
    institution: Optional[str] = None
    designation: Optional[str] = None
    influence_level: Optional[str] = None
    functional_expertise: Optional[str] = None
    # Total years of practice.
    experience_years: Optional[int] = None

    notes: Optional[str] = None

    @field_validator("title", mode="before")
    @classmethod
    def check_title(cls, value):
        return normalize_title(value) if isinstance(value, str) else None

    @field_validator("experience_years", mode="before")
    @classmethod
    def check_experience(cls, value):
        if value in (None, ""):
            return None
        years = int(value)
        if not 0 <= years <= 80:
            raise ValueError("experience_years must be between 0 and 80")
        return years

    @field_validator("influence_level")
    @classmethod
    def check_influence_level(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        # Accept any casing, store the canonical form.
        for level in INFLUENCE_LEVELS:
            if level.lower() == value.strip().lower():
                return level
        raise ValueError(f"influence_level must be one of: {', '.join(INFLUENCE_LEVELS)}")


class KOLCreate(KOLBase):
    pass


class KOLUpdate(KOLBase):
    pass


class KOLBulkCreate(BaseModel):
    items: List[KOLCreate]


class KOLResponse(KOLBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source: str
    hcp_id: Optional[int] = None

    # Research footprint (PubMed / ClinicalTrials.gov / Scholar). `enrichment` is
    # the parsed payload — see KOLDirectoryEntry.enrichment.
    enrichment_status: str = "none"
    enrichment: Optional[dict] = None
    enrichment_updated_at: Optional[datetime] = None

    # CTRI trials this person ran ({trial_count, pi_count, trials}); None = never checked.
    ctri: Optional[dict] = None
    ctri_updated_at: Optional[datetime] = None

    created_at: datetime
    updated_at: datetime


class KOLListResponse(BaseModel):
    total: int
    items: List[KOLResponse]


class KOLFacetValue(BaseModel):
    value: str
    count: int


class KOLFacets(BaseModel):
    therapeutic_areas: List[KOLFacetValue]
    geographic_zones: List[KOLFacetValue]
    state_cities: List[KOLFacetValue]
    specialties: List[KOLFacetValue]
    subspecialties: List[KOLFacetValue]
    institutions: List[KOLFacetValue]
    designations: List[KOLFacetValue]
    influence_levels: List[KOLFacetValue]
    functional_expertises: List[KOLFacetValue]
    total: int


class KOLEnrichBulk(BaseModel):
    ids: List[int]
    # False (the default) only fetches KOLs never enriched or whose last run
    # failed, so "fetch details for these" is cheap to click twice.
    refresh: bool = False


class CTRICaptchaAnswer(BaseModel):
    """A CTRI session (from GET /kol-directory/ctri/captcha) + the code the user typed."""
    session: str
    captcha: str


class KOLCTRIBulkUpdate(CTRICaptchaAnswer):
    # The one CTRI search this CAPTCHA pays for — a specialty / condition / place.
    keyword: str
    # Limit matching to these KOLs; empty = every KOL in the directory.
    ids: List[int] = []
    # How many of the newest matching trials to read investigators from.
    max_trials: int = 150


class KOLDeleteBulk(BaseModel):
    ids: List[int]


class KOLBulkResult(BaseModel):
    created: int
    skipped: int
    items: List[KOLResponse]
