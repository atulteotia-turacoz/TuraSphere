"""Local copy of CTRI (Clinical Trials Registry - India) data.

Every CTRI search the app runs — a scrape, a KOL update, a bulk harvest — saves
what it read here, so the registry builds up in our own database:

* `ctri_trials`        — one row per trial, with its investigators as read from
                          the trial's public detail page.
* `ctri_investigators` — one row per person across all saved trials (KOL-wise):
                          institution, place, contact details and their trials.
* `ctri_harvests`      — each bulk "Scrape CTRI" run, with its progress.

Public registry data, so it is shared by every account; what an account does with
it (its directory, its pending queue) stays per account.
"""
import json
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from app.core.database import Base


def _json(value, default):
    if not value:
        return default
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return default


class CTRITrial(Base):
    __tablename__ = "ctri_trials"

    # CTRI's own internal id (the number behind EncHid), not ours.
    trial_id = Column(Integer, primary_key=True, autoincrement=False)
    ctri_no = Column(String(40), nullable=True, index=True)
    title = Column(Text, nullable=True)
    status = Column(String(120), nullable=True)
    condition = Column(Text, nullable=True)
    registered = Column(String(20), nullable=True)
    pg_thesis = Column(Boolean, default=False, nullable=False)
    # JSON list of investigators as parsed from the detail page.
    investigators_data = Column(Text, nullable=True)
    fetched_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    def as_dict(self) -> dict:
        from app.services.ctri_service import detail_url
        return {
            "trial_id": self.trial_id, "ctri_no": self.ctri_no, "title": self.title,
            "status": self.status, "condition": self.condition, "registered": self.registered,
            "pg_thesis": bool(self.pg_thesis), "url": detail_url(self.trial_id),
            "investigators": _json(self.investigators_data, []),
        }


class CTRIInvestigator(Base):
    __tablename__ = "ctri_investigators"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    # Normalised name ("manjunath shenoy") — the identity a CTRI-sourced KOL keeps
    # in kol_pending / kol_directory.ctri_key.
    name_key = Column(String(255), nullable=False, index=True)
    # Last name token, to find merge candidates without scanning the table.
    surname = Column(String(120), nullable=False, index=True)

    designation = Column(String(255), nullable=True)
    institution = Column(String(500), nullable=True)
    address = Column(Text, nullable=True)
    city = Column(String(120), nullable=True, index=True)
    state = Column(String(120), nullable=True, index=True)
    postal_code = Column(String(10), nullable=True)
    emails_data = Column(Text, nullable=True)     # JSON list
    phones_data = Column(Text, nullable=True)     # JSON list
    trials_data = Column(Text, nullable=True)     # JSON list of trial refs (+ role)

    trial_count = Column(Integer, default=0, nullable=False, index=True)
    pi_count = Column(Integer, default=0, nullable=False)
    # Every trial is the person's own postgraduate thesis — usually a student.
    thesis_only = Column(Boolean, default=False, nullable=False, index=True)
    # Search keywords whose results included this person ("Dermatology; Psoriasis").
    keywords = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    @property
    def emails(self) -> list:
        return _json(self.emails_data, [])

    @property
    def phones(self) -> list:
        return _json(self.phones_data, [])

    @property
    def trials(self) -> list:
        return _json(self.trials_data, [])

    def as_person(self) -> dict:
        """Same shape as ctri_service.group_investigators() output."""
        return {
            "name": self.name, "key": self.name_key, "designation": self.designation,
            "institution": self.institution, "address": self.address, "city": self.city,
            "state": self.state, "postal_code": self.postal_code,
            "email": (self.emails or [None])[0], "emails": self.emails, "phones": self.phones,
            "trials": self.trials, "trial_count": self.trial_count, "pi_count": self.pi_count,
            "thesis_only": bool(self.thesis_only),
        }


class CTRIHarvest(Base):
    """One bulk "Scrape CTRI" run: a keyword search, then every matching trial read."""
    __tablename__ = "ctri_harvests"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    keyword = Column(String(255), nullable=False)
    trials_matched = Column(Integer, default=0, nullable=False)   # what CTRI's search returned
    trials_total = Column(Integer, default=0, nullable=False)     # how many we set out to read
    trials_done = Column(Integer, default=0, nullable=False)
    trials_new = Column(Integer, default=0, nullable=False)       # not already saved
    investigators_saved = Column(Integer, default=0, nullable=False)
    # running | done | error
    status = Column(String(20), default="running", nullable=False, index=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    finished_at = Column(DateTime, nullable=True)
