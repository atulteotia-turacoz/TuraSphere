import json
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base


class KOLPendingEntry(Base):
    """A scraped KOL candidate awaiting approval.

    This is the "pending verification" holding area. When a user scrapes X and
    picks candidates, they land here with status='pending'. An approver reviews
    them: **approve** copies the row into `kol_directory`; **reject** leaves it
    here marked rejected. Nothing reaches the real directory without approval.
    """

    __tablename__ = "kol_pending"
    __table_args__ = (
        # One pending row per X handle per owner — re-scraping the same person
        # (while still pending) won't pile up duplicates.
        UniqueConstraint("user_id", "x_username", name="uq_kol_pending_owner_handle"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    # The account this candidate belongs to (who ran the scrape).
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # pending | approved | rejected
    status = Column(String(20), default="pending", nullable=False, index=True)

    # ── Person (from X) ──
    # Honorific — "Dr.", "Prof.", "Mr.", "Mrs.", "Ms." — shown before the name.
    title = Column(String(20), nullable=True)
    first_name = Column(String(150), nullable=True)
    last_name = Column(String(150), nullable=True)
    email = Column(String(255), nullable=True)
    contact_no = Column(String(120), nullable=True)

    # ── Segmentation (from the search criteria — X can't supply these) ──
    therapeutic_area = Column(String(255), nullable=True)
    geographic_zone = Column(String(60), nullable=True)
    state_city = Column(String(255), nullable=True)
    specialty = Column(String(255), nullable=True)
    subspecialty = Column(String(255), nullable=True)
    institution = Column(String(255), nullable=True)
    designation = Column(String(255), nullable=True)
    influence_level = Column(String(40), nullable=True)
    functional_expertise = Column(String(255), nullable=True)
    # Total years of practice (Practo listing, or stated in an X bio / web page).
    experience_years = Column(Integer, nullable=True)

    # ── X provenance ──
    x_username = Column(String(120), nullable=True, index=True)
    x_name = Column(String(255), nullable=True)
    x_bio = Column(Text, nullable=True)
    x_location = Column(String(255), nullable=True)
    x_followers = Column(Integer, nullable=True)
    x_profile_url = Column(String(300), nullable=True)

    # ── Practo provenance ──
    # The doctor's Practo profile URL — the identity for a Practo-sourced
    # candidate, the way x_username is for an X-sourced one.
    practo_profile_url = Column(String(300), nullable=True, index=True)

    # ── Google / web provenance ──
    # The web page the doctor was found on — the identity for a Google-sourced
    # candidate. A name taken from a listing page's snippet gets `#name-slug`
    # appended so several doctors on one page stay distinct.
    web_profile_url = Column(String(500), nullable=True, index=True)

    # CTRI (Clinical Trials Registry - India) — the person's normalised name, the
    # identity for a CTRI-sourced KOL (source="ctri"), and the trials they ran
    # there. Also filled for any KOL by "Update from CTRI".
    ctri_key = Column(String(300), nullable=True, index=True)
    ctri_data = Column(Text, nullable=True)
    ctri_updated_at = Column(DateTime, nullable=True)

    notes = Column(Text, nullable=True)
    source = Column(String(20), default="twitter", nullable=False)

    # ── Research enrichment (PubMed / ClinicalTrials.gov / Scholar) ──
    # Populated in the background after a candidate is sent for verification, and
    # on demand from the Details view. Status drives the progress bar; the payload
    # is the JSON built by kol_enrichment.enrich_record.
    #   none    — never run
    #   running — a background task is fetching
    #   done    — enrichment_data is fresh
    #   error   — the run failed; enrichment_data holds an {"error": ...} marker
    enrichment_status = Column(String(20), default="none", nullable=False, index=True)
    enrichment_data = Column(Text, nullable=True)
    enrichment_updated_at = Column(DateTime, nullable=True)

    # ── Review trail ──
    reviewed_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_notes = Column(Text, nullable=True)
    # Set once approved — points at the created directory row.
    kol_id = Column(Integer, ForeignKey("kol_directory.id", ondelete="SET NULL"), nullable=True)

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
    reviewer = relationship("User", foreign_keys=[reviewed_by_user_id])

    def __repr__(self):
        return f"<KOLPendingEntry(id={self.id}, @{self.x_username}, status={self.status})>"
