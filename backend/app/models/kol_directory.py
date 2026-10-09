import json
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base

# Influence Level is a fixed vocabulary so the filter facet stays clean —
# free text fragments into "natl" / "National" / "national".
INFLUENCE_LEVELS = ["Global", "National", "Regional", "Local", "Emerging"]


class KOLDirectoryEntry(Base):
    """A KOL in the searchable "Find KOLs" directory.

    Independent of HCPProfile/Assessment: an entry may be typed in by hand,
    bulk-imported from a spreadsheet, or promoted from an existing HCP profile
    (in which case `source` is "hcp" and `hcp_id` points back at the origin).
    """

    __tablename__ = "kol_directory"
    __table_args__ = (
        # Prevents the same KOL being added twice by re-import or re-promotion.
        UniqueConstraint("user_id", "email", name="uq_kol_directory_user_email"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Honorific — "Dr.", "Prof.", "Mr.", "Mrs.", "Ms." — shown before the name.
    title = Column(String(20), nullable=True)
    first_name = Column(String(150), nullable=True, index=True)
    last_name = Column(String(150), nullable=True, index=True)
    email = Column(String(255), nullable=True, index=True)
    # Free text — a KOL may list more than one number, e.g. "9123837286 / 9830316133".
    contact_no = Column(String(120), nullable=True, index=True)

    # ── Profile / segmentation fields ──
    therapeutic_area = Column(String(255), nullable=True, index=True)
    geographic_zone = Column(String(60), nullable=True, index=True)   # North | South | East | West
    state_city = Column(String(255), nullable=True, index=True)
    specialty = Column(String(255), nullable=True, index=True)
    subspecialty = Column(String(255), nullable=True, index=True)
    # Society / Hospital / Institution — one combined affiliation field.
    institution = Column(String(255), nullable=True, index=True)
    designation = Column(String(255), nullable=True, index=True)
    # Constrained to INFLUENCE_LEVELS below.
    influence_level = Column(String(40), nullable=True, index=True)
    functional_expertise = Column(String(255), nullable=True, index=True)
    # Total years of practice — from the scrape, or entered on the KOL form.
    experience_years = Column(Integer, nullable=True)

    notes = Column(Text, nullable=True)
    # X (Twitter) handle, set when the KOL came from a scrape (source="twitter").
    # Lets a re-scrape / re-approval detect "already in the directory".
    x_username = Column(String(120), nullable=True, index=True)
    # Practo profile URL, set when the KOL came from a Practo scrape
    # (source="practo"). Same purpose as x_username for the X path.
    practo_profile_url = Column(String(300), nullable=True, index=True)
    # Web page the KOL was found on by the Google search (source="google").
    web_profile_url = Column(String(500), nullable=True, index=True)
    # CTRI (Clinical Trials Registry - India) — the person's normalised name, the
    # identity for a CTRI-sourced KOL (source="ctri"), and the trials they ran
    # there. Also filled for any KOL by "Update from CTRI".
    ctri_key = Column(String(300), nullable=True, index=True)
    ctri_data = Column(Text, nullable=True)
    ctri_updated_at = Column(DateTime, nullable=True)

    # "manual" | "import" | "hcp" | "twitter" | "practo" | "google" | "ctri"
    source = Column(String(20), default="manual", nullable=False, index=True)
    hcp_id = Column(Integer, ForeignKey("hcp_profiles.id", ondelete="SET NULL"), nullable=True, index=True)

    # ── Research enrichment (PubMed / ClinicalTrials.gov / Scholar) ──
    # Same three columns as kol_pending, so one worker serves both. Carried over
    # when a pending candidate is approved, and re-runnable on demand from the
    # directory card — a KOL added by hand or by import starts at "none".
    #   none    — never run
    #   running — a background task is fetching
    #   done    — enrichment_data is fresh
    #   error   — the run failed; enrichment_data holds an {"error": ...} marker
    enrichment_status = Column(String(20), default="none", nullable=False, index=True)
    enrichment_data = Column(Text, nullable=True)
    enrichment_updated_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    @property
    def enrichment(self) -> dict | None:
        """`enrichment_data` parsed to an object, for the API response. None when
        never run or unparseable, so the client never sees a raw JSON string."""
        if not self.enrichment_data:
            return None
        try:
            return json.loads(self.enrichment_data)
        except (ValueError, TypeError):
            return None

    @property
    def ctri(self) -> dict | None:
        """`ctri_data` parsed — {trial_count, pi_count, trials: [...]}."""
        if not self.ctri_data:
            return None
        try:
            return json.loads(self.ctri_data)
        except (ValueError, TypeError):
            return None

    user = relationship("User", foreign_keys=[user_id])
    hcp_profile = relationship("HCPProfile", foreign_keys=[hcp_id])

    def __repr__(self):
        return f"<KOLDirectoryEntry(id={self.id}, name='{self.first_name} {self.last_name}')>"
