"""CTRI database — bulk scrape ("harvest") and the saved, KOL-wise investigator data.

A harvest costs one CAPTCHA (the keyword search); reading the matching trials and
saving their investigators then runs in the background. Everything saved here can
be browsed, sent for verification, and matched to directory KOLs without CTRI.
"""
import json
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.core.security import get_current_user
from app.models.ctri import CTRIHarvest, CTRIInvestigator, CTRITrial
from app.models.kol_directory import KOLDirectoryEntry
from app.models.kol_pending import KOLPendingEntry
from app.models.user import User
from app.schemas.kol_directory import CTRICaptchaAnswer
from app.schemas.kol_pending import PendingSubmit, PendingSubmitItem
from app.services import ctri_service, ctri_store
from app.services.ctri_service import CTRICaptchaError, CTRIError

router = APIRouter(prefix="/kol-directory/ctri", tags=["KOL Directory - CTRI"])

# A harvest still "running" after this long was cut off by a restart.
_STALE_AFTER = timedelta(hours=3)


# ── Harvest (bulk scrape) ────────────────────────────────────────

class HarvestRequest(CTRICaptchaAnswer):
    keyword: str
    # Newest matching trials to read. Each is one public page; ~2000 take a few minutes.
    max_trials: int = 200


def _harvest_dict(h: CTRIHarvest) -> dict:
    status = h.status
    if status == "running" and datetime.utcnow() - h.created_at > _STALE_AFTER:
        status = "error"
    return {
        "id": h.id, "keyword": h.keyword, "status": status,
        "error": h.error or ("Interrupted (server restarted)." if status != h.status else None),
        "trials_matched": h.trials_matched, "trials_total": h.trials_total,
        "trials_done": h.trials_done, "trials_new": h.trials_new,
        "investigators_saved": h.investigators_saved,
        "created_at": h.created_at, "finished_at": h.finished_at,
    }


def _run_harvest(harvest_id: int, trial_ids: list[int], keyword: str) -> None:
    db = SessionLocal()
    h = db.get(CTRIHarvest, harvest_id)
    try:
        def progress(done: int, new: int) -> None:
            h.trials_done, h.trials_new = done, new
            db.commit()

        _, people = ctri_store.fetch_and_store(trial_ids, keyword, progress)
        h.trials_done = len(trial_ids)
        h.investigators_saved = len(people)
        h.status = "done"
    except Exception as exc:  # noqa: BLE001 - background task: record, never raise
        db.rollback()
        h = db.get(CTRIHarvest, harvest_id)
        h.status = "error"
        h.error = f"{exc.__class__.__name__}: {exc}"[:1000]
    finally:
        h.finished_at = datetime.utcnow()
        db.commit()
        db.close()


@router.post("/harvest")
def start_harvest(data: HarvestRequest, background: BackgroundTasks,
                  db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    keyword = (data.keyword or "").strip()
    if not keyword:
        raise HTTPException(status_code=400, detail="Enter a keyword to search CTRI for.")
    try:
        trials = ctri_service.search(data.session, data.captcha, keyword)
    except CTRICaptchaError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except CTRIError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    trial_ids = [t["trial_id"] for t in trials[:max(1, min(data.max_trials, 2000))]]
    h = CTRIHarvest(user_id=current_user.id, keyword=keyword[:255], trials_matched=len(trials),
                    trials_total=len(trial_ids), status="running" if trial_ids else "done",
                    finished_at=None if trial_ids else datetime.utcnow())
    db.add(h)
    db.commit()
    db.refresh(h)
    if trial_ids:
        background.add_task(_run_harvest, h.id, trial_ids, keyword)
    return _harvest_dict(h)


@router.get("/harvests")
def list_harvests(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (db.query(CTRIHarvest).filter(CTRIHarvest.user_id == current_user.id)
            .order_by(CTRIHarvest.created_at.desc()).limit(10).all())
    return [_harvest_dict(h) for h in rows]


# ── Saved data ───────────────────────────────────────────────────

@router.get("/stats")
def ctri_stats(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    states = (db.query(CTRIInvestigator.state, func.count(CTRIInvestigator.id))
              .filter(CTRIInvestigator.state.isnot(None))
              .group_by(CTRIInvestigator.state)
              .order_by(func.count(CTRIInvestigator.id).desc()).all())
    return {
        "trials": db.query(func.count(CTRITrial.trial_id)).scalar() or 0,
        "investigators": db.query(func.count(CTRIInvestigator.id)).scalar() or 0,
        "established": db.query(func.count(CTRIInvestigator.id))
        .filter(CTRIInvestigator.thesis_only.is_(False)).scalar() or 0,
        "states": [{"value": s, "count": n} for s, n in states],
    }


def _known_keys(db: Session, user_id: int, keys: list[str]) -> tuple[set, set]:
    if not keys:
        return set(), set()
    directory = {k for (k,) in db.query(KOLDirectoryEntry.ctri_key).filter(
        KOLDirectoryEntry.user_id == user_id, KOLDirectoryEntry.ctri_key.in_(keys)).all()}
    pending = {k for (k,) in db.query(KOLPendingEntry.ctri_key).filter(
        KOLPendingEntry.user_id == user_id, KOLPendingEntry.status == "pending",
        KOLPendingEntry.ctri_key.in_(keys)).all()}
    return directory, pending


@router.get("/investigators")
def list_investigators(
    search: Optional[str] = None,
    state: Optional[str] = None,
    min_trials: int = 0,
    hide_thesis: bool = False,
    sort: str = Query("trials", pattern="^(trials|recent|name)$"),
    skip: int = 0,
    limit: int = Query(25, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(CTRIInvestigator)
    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.filter(or_(CTRIInvestigator.name.ilike(like), CTRIInvestigator.institution.ilike(like),
                         CTRIInvestigator.city.ilike(like), CTRIInvestigator.emails_data.ilike(like),
                         CTRIInvestigator.keywords.ilike(like), CTRIInvestigator.trials_data.ilike(like)))
    if state:
        q = q.filter(CTRIInvestigator.state == state)
    if min_trials > 0:
        q = q.filter(CTRIInvestigator.trial_count >= min_trials)
    if hide_thesis:
        q = q.filter(CTRIInvestigator.thesis_only.is_(False))
    total = q.count()
    order = {
        "trials": (CTRIInvestigator.thesis_only.asc(), CTRIInvestigator.trial_count.desc(),
                   CTRIInvestigator.pi_count.desc()),
        "recent": (CTRIInvestigator.updated_at.desc(),),
        "name": (CTRIInvestigator.name.asc(),),
    }[sort]
    rows = q.order_by(*order).offset(skip).limit(limit).all()
    in_dir, in_pending = _known_keys(db, current_user.id, [r.name_key for r in rows])
    items = []
    for r in rows:
        items.append({
            "id": r.id, "name": r.name, "name_key": r.name_key,
            "designation": r.designation, "institution": r.institution, "address": r.address,
            "city": r.city, "state": r.state, "postal_code": r.postal_code,
            "emails": r.emails, "phones": r.phones,
            "trial_count": r.trial_count, "pi_count": r.pi_count, "thesis_only": bool(r.thesis_only),
            "keywords": r.keywords, "updated_at": r.updated_at,
            # The shape CTRITrialsView reads.
            "ctri": ctri_service.summary(r.trials), "ctri_updated_at": r.updated_at,
            "in_directory": r.name_key in in_dir, "in_pending": r.name_key in in_pending,
        })
    return {"total": total, "items": items}


class InvestigatorIds(BaseModel):
    ids: List[int]
    therapeutic_area: Optional[str] = None
    specialty: Optional[str] = None


@router.post("/investigators/send")
def send_for_verification(data: InvestigatorIds, background: BackgroundTasks,
                          db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Saved CTRI investigators -> this account's Pending Verification queue."""
    from app.api.endpoints.kol_scrape import submit_for_approval   # avoid a circular import

    rows = db.query(CTRIInvestigator).filter(CTRIInvestigator.id.in_(data.ids or [-1])).all()
    items = []
    for r in rows:
        p = r.as_person()
        n, pi = r.trial_count, r.pi_count
        items.append(PendingSubmitItem(
            source="ctri",
            name=r.name,
            email=p["email"],
            contact_no=ctri_service.best_phone(r.phones),
            notes=" | ".join(x for x in [
                f"CTRI: {n} trial{'s' if n != 1 else ''}" + (f", {pi} as PI" if pi else "")
                + (" (postgraduate thesis only)" if r.thesis_only else ""),
                f"Address: {r.address}" if r.address else None,
                f"Other emails: {', '.join(r.emails[1:])}" if len(r.emails) > 1 else None,
            ] if x),
            therapeutic_area=(data.therapeutic_area or "").strip() or None,
            specialty=(data.specialty or "").strip() or None,
            geographic_zone="India",
            state_city=", ".join(x for x in (r.city, r.state) if x) or None,
            institution=(r.institution or "")[:255] or None,
            designation=r.designation,
            ctri_key=r.name_key,
            ctri_trials=r.trials,
        ))
    if not items:
        return {"submitted": 0, "skipped": 0}
    res = submit_for_approval(PendingSubmit(items=items), background, db, current_user)
    return {"submitted": res["submitted"], "skipped": res["skipped"]}


class MatchRequest(BaseModel):
    ids: List[int] = []   # directory KOLs; empty = all of this account's


@router.post("/match-directory")
def match_directory(data: MatchRequest, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    """Update directory KOLs from the saved CTRI data — no CTRI search, no code."""
    q = db.query(KOLDirectoryEntry)
    if current_user.role == "user":
        q = q.filter(KOLDirectoryEntry.user_id == current_user.id)
    if data.ids:
        q = q.filter(KOLDirectoryEntry.id.in_(data.ids))
    checked = matched = 0
    for kol in q.all():
        checked += 1
        if ctri_service.apply_to_row(kol, ctri_store.match_kol(db, kol.first_name, kol.last_name)):
            matched += 1
    db.commit()
    return {"checked": checked, "matched": matched}
