from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict


class ScrapeCriteria(BaseModel):
    """The Find KOLs criteria used to build the X search query / Practo listing."""
    therapeutic_area: Optional[str] = None
    geographic_zone: Optional[str] = None
    state: Optional[str] = None
    city: Optional[str] = None
    state_city: Optional[str] = None
    specialty: Optional[str] = None
    subspecialty: Optional[str] = None
    institution: Optional[str] = None
    designation: Optional[str] = None
    influence_level: Optional[str] = None
    functional_expertise: Optional[str] = None
    limit: int = 40

    # Method 2: keyword search over recent tweets.
    use_recent_search: bool = True
    # Method 3: scan the followers/following of these hub @handles and keep the
    # profiles that look like dermatologists in the requested place.
    hub_handles: List[str] = []
    per_hub: int = 200
    # Method 4: Practo's public city+specialty directory. Unlike the X methods this
    # is a roster rather than a sample, but it carries no social signal.
    use_practo: bool = False
    # Fetch each Practo doctor's profile page for the detail the listing omits
    # (qualifications, council registration, experience, rating, languages).
    # One extra request per doctor, so it is the slow half of a Practo scrape.
    enrich_profiles: bool = True
    # Method 5: Google web search (SerpAPI keys from Admin → Google Search, free
    # Brave / DuckDuckGo fallback). Finds doctors named on hospital / clinic pages.
    use_google: bool = False
    # For Google names seen only on a list page that the free step can't follow
    # (Justdial, Fortis… block bots): search each doctor by name for their own
    # page. Uses up to one SerpAPI search per such doctor.
    find_own_pages: bool = True
    # Method 6: CTRI (Clinical Trials Registry - India). Its search is behind a
    # CAPTCHA, so the client first loads one (GET /kol-directory/ctri/captcha) and
    # sends the session + the code the user typed. Investigators are read from the
    # newest `limit` matching trials.
    use_ctri: bool = False
    ctri_session: Optional[str] = None
    ctri_captcha: Optional[str] = None
    # Method 7: PubMed — authors of the last 5 years' papers on the topic whose own
    # affiliation names the City / State (often with their email).
    use_pubmed: bool = False
    # Method 8: ClinicalTrials.gov — investigators and site contacts of trials on
    # the topic in the place (often with email and phone).
    use_ctgov: bool = False


class ScrapeCandidate(BaseModel):
    # Stable identity for selection + de-duplication: the @handle for an X
    # candidate, the profile URL for a Practo one.
    key: str
    # Which source found this candidate: 'x' | 'practo' | 'google' | 'ctri' |
    # 'pubmed' | 'ctgov'.
    source: str = "x"

    # Display block, filled from whichever source found the candidate.
    name: Optional[str] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    profile_url: Optional[str] = None

    # Contact. Practo masks both ("+918*****5" / "dra****@gmail.com") and X
    # publishes neither, so these are only ever filled when someone wrote them
    # into their own public bio.
    email: Optional[str] = None
    contact_no: Optional[str] = None

    # Professional profile, filled by whichever source knows it.
    specialty: Optional[str] = None
    subspecialty: Optional[str] = None
    institution: Optional[str] = None
    designation: Optional[str] = None

    # Geography. Practo publishes locality/city/country + pincode but no state —
    # its addressRegion is the city — so state comes from the search criteria.
    locality: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    postal_code: Optional[str] = None
    image_url: Optional[str] = None

    # Total years of practice. Practo publishes it for every doctor; for X and
    # Google it's only set when the bio / page text states it.
    experience_years: Optional[int] = None

    # X-only.
    x_username: Optional[str] = None
    x_followers: Optional[int] = None
    x_verified: bool = False

    # Practo-only.
    practo_clinic: Optional[str] = None
    practo_specialty: Optional[str] = None
    practo_fee: Optional[int] = None
    practo_experience_years: Optional[int] = None
    practo_qualifications: List[str] = []
    # Medical-council registration — the strongest evidence a profile is a real,
    # licensed practitioner.
    practo_registration: Optional[str] = None
    practo_registration_verified: bool = False
    practo_memberships: List[str] = []
    practo_languages: List[str] = []
    practo_rating: Optional[int] = None
    practo_reviews_count: Optional[int] = None

    # Google-only: the page's title, and which provider served it
    # ('serpapi' | 'brave' | 'ddg').
    web_page_title: Optional[str] = None
    web_provider: Optional[str] = None

    # CTRI-only: the trials this investigator ran, and how many as the
    # principal investigator / overall coordinator.
    ctri_key: Optional[str] = None
    ctri_trial_count: Optional[int] = None
    ctri_pi_count: Optional[int] = None
    ctri_trials: List[dict] = []

    suggested_influence_level: Optional[str] = None
    # How this candidate was found: "tweet" | "followers:@hub" | "following:@hub"
    # | "practo:<city>" | "google:<provider>".
    discovered_via: Optional[str] = None
    # True when this candidate is already in the directory or pending queue.
    already_known: bool = False


class ScrapeResult(BaseModel):
    query: str
    count: int
    candidates: List[ScrapeCandidate]
    # Why a requested method returned nothing (e.g. Practo for a non-India country).
    notes: List[str] = []


# ── Submitting picked candidates for approval ──

class PendingSubmitItem(BaseModel):
    # 'twitter' | 'practo' | 'google' | 'ctri' | 'pubmed' | 'ctgov' — matches
    # KOLPendingEntry.source. PubMed / CT.gov carry their identity in web_profile_url.
    source: str = "twitter"
    # Display name as found. For X this mirrors x_name; for Practo it is the only
    # name we have, and the backend splits it into first/last.
    name: Optional[str] = None

    # X candidates carry a handle; Practo candidates carry a profile URL instead,
    # so neither is required on its own — the endpoint rejects an item with no
    # identity at all.
    x_username: Optional[str] = None
    x_name: Optional[str] = None
    x_bio: Optional[str] = None
    x_location: Optional[str] = None
    x_followers: Optional[int] = None
    x_profile_url: Optional[str] = None

    practo_profile_url: Optional[str] = None
    # Google candidates: the page they were found on.
    web_profile_url: Optional[str] = None
    # CTRI candidates: normalised name (identity) + the trials they ran.
    ctri_key: Optional[str] = None
    ctri_trials: Optional[List[dict]] = None

    # Only ever set when self-published — see ScrapeCandidate.email.
    email: Optional[str] = None
    contact_no: Optional[str] = None
    # Everything the scrape learned that has no column of its own (qualifications,
    # registration, experience, rating, languages, memberships). Appended to notes.
    notes: Optional[str] = None

    # Segmentation fields carried from the search criteria (editable in the UI).
    therapeutic_area: Optional[str] = None
    geographic_zone: Optional[str] = None
    state_city: Optional[str] = None
    specialty: Optional[str] = None
    subspecialty: Optional[str] = None
    institution: Optional[str] = None
    designation: Optional[str] = None
    influence_level: Optional[str] = None
    functional_expertise: Optional[str] = None
    experience_years: Optional[int] = None


class PendingSubmit(BaseModel):
    items: List[PendingSubmitItem]
    # Kick off PubMed / ClinicalTrials.gov / Scholar enrichment in the background
    # for every created row. The client then polls the pending list to drive the
    # progress bar.
    enrich: bool = True


class PendingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    source: str = "twitter"
    title: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    contact_no: Optional[str] = None
    notes: Optional[str] = None
    therapeutic_area: Optional[str] = None
    geographic_zone: Optional[str] = None
    state_city: Optional[str] = None
    specialty: Optional[str] = None
    subspecialty: Optional[str] = None
    institution: Optional[str] = None
    designation: Optional[str] = None
    influence_level: Optional[str] = None
    functional_expertise: Optional[str] = None
    x_username: Optional[str] = None
    x_name: Optional[str] = None
    x_bio: Optional[str] = None
    x_location: Optional[str] = None
    x_followers: Optional[int] = None
    x_profile_url: Optional[str] = None
    practo_profile_url: Optional[str] = None
    web_profile_url: Optional[str] = None
    ctri_key: Optional[str] = None
    ctri: Optional[dict] = None
    ctri_updated_at: Optional[datetime] = None
    experience_years: Optional[int] = None
    review_notes: Optional[str] = None
    kol_id: Optional[int] = None
    # Research enrichment. `enrichment_data` is the JSON blob as a string; the API
    # parses it into `enrichment` so the client gets an object, not a string.
    enrichment_status: str = "none"
    enrichment: Optional[dict] = None
    enrichment_updated_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class PendingListResponse(BaseModel):
    total: int
    pending: int
    items: List[PendingResponse]


class PendingSubmitResult(BaseModel):
    submitted: int
    skipped: int
    items: List[PendingResponse]


class ReviewAction(BaseModel):
    notes: Optional[str] = None


class BulkReview(BaseModel):
    ids: List[int]
    notes: Optional[str] = None
