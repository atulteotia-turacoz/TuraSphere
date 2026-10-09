"""Saving CTRI data to our database, and reading it back.

`fetch_and_store()` is what every CTRI feature calls after its (CAPTCHA'd)
search: trials already saved recently are read from `ctri_trials` instead of
CTRI, the rest are fetched and saved, and every investigator is merged into
`ctri_investigators` — one row per person, however many searches found them.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Callable, Optional

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.ctri import CTRIInvestigator, CTRITrial
from app.services import ctri_service

logger = logging.getLogger(__name__)

# A saved trial younger than this is reused rather than re-read from CTRI.
# Investigators of a registered trial rarely change.
FRESH_FOR = timedelta(days=30)


# ── Trials ───────────────────────────────────────────────────────

def cached_trials(db: Session, trial_ids: list[int]) -> dict[int, dict]:
    if not trial_ids:
        return {}
    cutoff = datetime.utcnow() - FRESH_FOR
    rows = db.query(CTRITrial).filter(CTRITrial.trial_id.in_(trial_ids),
                                      CTRITrial.fetched_at >= cutoff).all()
    return {r.trial_id: r.as_dict() for r in rows}


def save_trials(db: Session, trials: list[dict]) -> None:
    if not trials:
        return
    existing = {r.trial_id: r for r in
                db.query(CTRITrial).filter(CTRITrial.trial_id.in_([t["trial_id"] for t in trials])).all()}
    now = datetime.utcnow()
    for t in trials:
        row = existing.get(t["trial_id"]) or CTRITrial(trial_id=t["trial_id"])
        row.ctri_no = t.get("ctri_no")
        row.title = t.get("title")
        row.status = (t.get("status") or "")[:120] or None
        row.condition = t.get("condition")
        row.registered = t.get("registered")
        row.pg_thesis = bool(t.get("pg_thesis"))
        row.investigators_data = json.dumps(t.get("investigators") or [])
        row.fetched_at = now
        if t["trial_id"] not in existing:
            db.add(row)


# ── People ───────────────────────────────────────────────────────

def _surname(name: str) -> str:
    tokens = ctri_service.name_tokens(name)
    return tokens[-1] if tokens else ""


def find_person(db: Session, person: dict) -> Optional[CTRIInvestigator]:
    """The saved row for this person: same surname, and the names match
    (initials allowed) or they share an email."""
    surname = _surname(person["name"])
    if not surname:
        return None
    emails = {e.lower() for e in person.get("emails") or [] if e}
    for row in db.query(CTRIInvestigator).filter(CTRIInvestigator.surname == surname).all():
        if ctri_service.names_match(row.name, person["name"]) or emails & {e.lower() for e in row.emails}:
            return row
    if emails:
        # Same email under a different surname spelling.
        for row in db.query(CTRIInvestigator).filter(
                CTRIInvestigator.emails_data.like(f'%"{next(iter(emails))}"%')).all():
            return row
    return None


def _recount(row: CTRIInvestigator, trials: list[dict]) -> None:
    row.trials_data = json.dumps(trials)
    row.trial_count = len(trials)
    row.pi_count = sum(1 for t in trials if t.get("role") == "PI")
    row.thesis_only = bool(trials) and all(t.get("pg_thesis") for t in trials)


def save_people(db: Session, people: list[dict], keyword: Optional[str] = None) -> int:
    """Merge grouped investigators into `ctri_investigators`. Returns how many
    rows were created or updated."""
    count = 0
    for p in people:
        if not p.get("name") or not _surname(p["name"]):
            continue
        row = find_person(db, p)
        if row is None:
            row = CTRIInvestigator(name=p["name"][:255], name_key=p["key"][:255],
                                   surname=_surname(p["name"])[:120])
            db.add(row)
            trials = p["trials"]
        else:
            trials = ctri_service.merge_trials(row.trials, p["trials"])
            # Prefer the fuller spelling of the name ("Manjunath Shenoy" over "M Shenoy").
            if len(ctri_service.name_tokens(p["name"])[0]) > len(ctri_service.name_tokens(row.name)[0]):
                row.name = p["name"][:255]
        _recount(row, trials)
        # Contact / place: newest search wins where it has a value.
        for field, size in (("designation", 255), ("institution", 500), ("address", None),
                            ("city", 120), ("state", 120), ("postal_code", 10)):
            if p.get(field):
                setattr(row, field, p[field][:size] if size else p[field])
        row.emails_data = json.dumps(list(dict.fromkeys((p.get("emails") or []) + row.emails)))
        row.phones_data = json.dumps(list(dict.fromkeys((p.get("phones") or []) + row.phones)))
        if keyword:
            kws = [k for k in (row.keywords or "").split("; ") if k]
            if keyword not in kws:
                row.keywords = "; ".join(kws + [keyword])[:2000]
        db.flush()   # so a later person in this batch can find this row
        count += 1
    return count


# ── The one call every feature makes ─────────────────────────────

def fetch_and_store(trial_ids: list[int], keyword: Optional[str] = None,
                    progress: Optional[Callable[[int, int], None]] = None,
                    chunk: int = 25) -> tuple[list[dict], list[dict]]:
    """Read these trials (saved copy when fresh, CTRI otherwise), save them and
    their investigators, and return (trials, grouped people) — newest first.
    `progress(done, new)` is called after each chunk."""
    db = SessionLocal()
    try:
        cached = cached_trials(db, trial_ids)
        missing = [t for t in trial_ids if t not in cached]
        fetched: list[dict] = []
        for i in range(0, len(missing), chunk):
            batch = ctri_service.fetch_trials(missing[i:i + chunk])
            save_trials(db, batch)
            db.commit()
            fetched += batch
            if progress:
                progress(len(cached) + min(i + chunk, len(missing)), len(fetched))
        if progress and not missing:
            progress(len(cached), 0)
        by_id = {**cached, **{t["trial_id"]: t for t in fetched}}
        trials = [by_id[t] for t in trial_ids if t in by_id]
        people = ctri_service.group_investigators(trials)
        save_people(db, people, keyword)
        db.commit()
        return trials, people
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def match_kol(db: Session, first_name: Optional[str], last_name: Optional[str]) -> list[dict]:
    """Saved investigators matching a KOL's name, as person dicts (no CTRI call)."""
    name = f"{first_name or ''} {last_name or ''}".strip()
    if len(ctri_service.name_tokens(name)) < 2:
        return []
    rows = db.query(CTRIInvestigator).filter(CTRIInvestigator.surname == _surname(name)).all()
    return [r.as_person() for r in rows if ctri_service.names_match(r.name, name)]
