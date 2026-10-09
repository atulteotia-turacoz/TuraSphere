import json
import logging
import re
from typing import Iterable, Optional

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.core.security import get_current_user
from app.models.hcp import HCPProfile
from app.models.kol_directory import KOLDirectoryEntry
from app.models.kol_pending import KOLPendingEntry
from app.models.user import User
from app.schemas.kol_directory import (
    CTRICaptchaAnswer, KOLBulkCreate, KOLBulkResult, KOLCreate, KOLCTRIBulkUpdate, KOLDeleteBulk,
    KOLEnrichBulk, KOLFacets, KOLListResponse, KOLResponse, KOLUpdate,
)
from app.services import ctri_service, ctri_store, kol_export
from app.services.ctri_service import CTRICaptchaError, CTRIError
from app.services.name_titles import split_title
from app.services.experience_backfill import backfill_experience
from app.services.kol_enrichment_jobs import run_enrichment
from app.services.kol_ranking import insights as kol_insights

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/kol-directory", tags=["KOL Directory"])

_TITLES = {"dr", "dr.", "prof", "prof.", "mr", "mr.", "ms", "ms.", "mrs", "mrs."}

# Free-text columns the `search` box scans.
SEARCH_FIELDS = [
    "first_name", "last_name", "email", "contact_no",
    "institution", "state_city", "specialty", "subspecialty",
    "designation", "functional_expertise",
]

# Response key -> model column, for the filter rail.
FACET_FIELDS = {
    "therapeutic_areas": "therapeutic_area",
    "geographic_zones": "geographic_zone",
    "state_cities": "state_city",
    "specialties": "specialty",
    "subspecialties": "subspecialty",
    "institutions": "institution",
    "designations": "designation",
    "influence_levels": "influence_level",
    "functional_expertises": "functional_expertise",
}

# Columns copied straight from the request body on create / bulk import.
PROFILE_FIELDS = [
    "therapeutic_area", "geographic_zone", "state_city", "specialty",
    "subspecialty", "institution", "designation", "influence_level",
    "functional_expertise",
]


def _profile_values(row) -> dict:
    """Trim the profile fields off a request body, mapping blanks to NULL."""
    return {
        field: (getattr(row, field, None) or "").strip() or None
        for field in PROFILE_FIELDS
    }


def _split_name(full_name: str) -> tuple[str, str]:
    """Split a name into (first, last). Callers take the title off first with
    `split_title` (it has its own `title` column); a leading title that is still
    present stays with the first name, so "Dr Punit Saraogi" keeps "Saraogi" as
    the last name.
    """
    parts = (full_name or "").strip().split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    # A leading title is kept with the first name, so "Dr Punit Saraogi"
    # yields a last name of "Saraogi" rather than "Punit Saraogi".
    if parts[0].lower() in _TITLES and len(parts) >= 3:
        return " ".join(parts[:2]), " ".join(parts[2:])
    return parts[0], " ".join(parts[1:])


def normalize_phones(value: Optional[str]) -> set[str]:
    """Reduce a free-text contact field to a set of comparable numbers.

    A KOL may list several numbers in one cell ("9123837286 / 9830316133"), and
    the same number may be written with a country code, spaces, or dashes. Each
    number is reduced to its last 10 digits so those all compare equal.
    """
    if not value:
        return set()
    numbers = set()
    for part in re.split(r"[/,;&]| and ", str(value)):
        digits = re.sub(r"\D", "", part)
        if len(digits) >= 10:
            numbers.add(digits[-10:])
    return numbers


def _existing_phones(db: Session, user_id: int, exclude_id: Optional[int] = None) -> set[str]:
    query = db.query(KOLDirectoryEntry.contact_no).filter(
        KOLDirectoryEntry.user_id == user_id,
        KOLDirectoryEntry.contact_no.isnot(None),
    )
    if exclude_id is not None:
        query = query.filter(KOLDirectoryEntry.id != exclude_id)
    return {n for (value,) in query.all() for n in normalize_phones(value)}


def _clashing_phone(contact_no: Optional[str], taken: Iterable[str]) -> Optional[str]:
    """Return the first number in `contact_no` that is already taken, if any."""
    taken = set(taken)
    for number in normalize_phones(contact_no):
        if number in taken:
            return number
    return None


def _scoped(query, current_user: User):
    if current_user.role == "user":
        return query.filter(KOLDirectoryEntry.user_id == current_user.id)
    return query


def _get_owned(entry_id: int, db: Session, current_user: User) -> KOLDirectoryEntry:
    entry = db.query(KOLDirectoryEntry).filter(KOLDirectoryEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="KOL not found")
    if current_user.role == "user" and entry.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return entry


def _filtered(db: Session, model, current_user: User, search: Optional[str], exact: dict):
    """The list's filters — shared by the list and the export, so an export is
    exactly what the user is looking at."""
    query = db.query(model)
    if model is KOLPendingEntry:
        query = query.filter(KOLPendingEntry.status == "pending")
        if current_user.role == "user":
            query = query.filter(KOLPendingEntry.user_id == current_user.id)
    else:
        query = _scoped(query, current_user)
    if search:
        term = f"%{search}%"
        query = query.filter(or_(*[
            getattr(model, field).ilike(term) for field in SEARCH_FIELDS if hasattr(model, field)
        ]))
    for field, value in exact.items():
        if value and hasattr(model, field):
            query = query.filter(getattr(model, field) == value)
    return query


@router.get("/", response_model=KOLListResponse)
def list_kols(
    skip: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=1000),
    search: Optional[str] = None,
    therapeutic_area: Optional[str] = None,
    geographic_zone: Optional[str] = None,
    state_city: Optional[str] = None,
    specialty: Optional[str] = None,
    subspecialty: Optional[str] = None,
    institution: Optional[str] = None,
    designation: Optional[str] = None,
    influence_level: Optional[str] = None,
    functional_expertise: Optional[str] = None,
    source: Optional[str] = None,
    sort: str = Query("recent", pattern="^(recent|name)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = _filtered(db, KOLDirectoryEntry, current_user, search, {
        "therapeutic_area": therapeutic_area,
        "geographic_zone": geographic_zone,
        "state_city": state_city,
        "specialty": specialty,
        "subspecialty": subspecialty,
        "institution": institution,
        "designation": designation,
        "influence_level": influence_level,
        "functional_expertise": functional_expertise,
        "source": source,
    })

    total = query.count()
    order = (
        (KOLDirectoryEntry.first_name.asc(), KOLDirectoryEntry.last_name.asc())
        if sort == "name"
        else (KOLDirectoryEntry.created_at.desc(),)
    )
    items = query.order_by(*order).offset(skip).limit(limit).all()
    return {"total": total, "items": items}


@router.get("/facets", response_model=KOLFacets)
def kol_facets(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Distinct filter values with counts, so the UI can render the filter rail."""
    def _counts(field: str):
        column = getattr(KOLDirectoryEntry, field)
        rows = (
            _scoped(db.query(column, func.count(KOLDirectoryEntry.id)), current_user)
            .filter(column.isnot(None), column != "")
            .group_by(column)
            .order_by(func.count(KOLDirectoryEntry.id).desc())
            .all()
        )
        return [{"value": value, "count": count} for value, count in rows]

    total = _scoped(db.query(func.count(KOLDirectoryEntry.id)), current_user).scalar() or 0
    facets = {key: _counts(field) for key, field in FACET_FIELDS.items()}
    return {**facets, "total": total}


@router.get("/insights")
def directory_insights(
    search: Optional[str] = None,
    therapeutic_area: Optional[str] = None,
    geographic_zone: Optional[str] = None,
    state_city: Optional[str] = None,
    specialty: Optional[str] = None,
    subspecialty: Optional[str] = None,
    institution: Optional[str] = None,
    designation: Optional[str] = None,
    influence_level: Optional[str] = None,
    functional_expertise: Optional[str] = None,
    source: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Charts for the Directory: top KOLs by the public-data part of the
    assessment score (see services/kol_ranking), and how the KOLs split by
    specialty / place / area. Takes the same filters as the list."""
    query = _filtered(db, KOLDirectoryEntry, current_user, search, {
        "therapeutic_area": therapeutic_area, "geographic_zone": geographic_zone,
        "state_city": state_city, "specialty": specialty, "subspecialty": subspecialty,
        "institution": institution, "designation": designation,
        "influence_level": influence_level, "functional_expertise": functional_expertise,
        "source": source,
    })
    return kol_insights(query.all())


# The `:int` converter matters: this router is mounted before the scrape one, so a
# bare /{entry_id} would swallow GET /kol-directory/pending.
@router.get("/{entry_id:int}", response_model=KOLResponse)
def get_kol(entry_id: int, db: Session = Depends(get_db),
            current_user: User = Depends(get_current_user)):
    """One KOL. Used by the details view to poll a running enrichment without
    re-fetching the whole page."""
    return _get_owned(entry_id, db, current_user)


@router.post("/", response_model=KOLResponse, status_code=201)
def create_kol(data: KOLCreate, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    email = (data.email or "").strip() or None
    contact_no = (data.contact_no or "").strip() or None

    if email:
        existing = (
            db.query(KOLDirectoryEntry)
            .filter(KOLDirectoryEntry.user_id == current_user.id, KOLDirectoryEntry.email == email)
            .first()
        )
        if existing:
            raise HTTPException(status_code=409, detail=f"A KOL with email {email} already exists")

    clash = _clashing_phone(contact_no, _existing_phones(db, current_user.id))
    if clash:
        raise HTTPException(status_code=409, detail=f"A KOL with contact number {clash} already exists")

    entry = KOLDirectoryEntry(
        user_id=current_user.id,
        first_name=(data.first_name or "").strip() or None,
        last_name=(data.last_name or "").strip() or None,
        email=email,
        contact_no=contact_no,
        notes=data.notes,
        source="manual",
        title=data.title,
        experience_years=data.experience_years,
        **_profile_values(data),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/bulk", response_model=KOLBulkResult, status_code=201)
def bulk_create_kols(data: KOLBulkCreate, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user)):
    """Import many KOLs at once.

    A row is skipped when its email OR any of its contact numbers already
    belongs to a KOL — whether that KOL is already in the database or appeared
    earlier in this same batch. Both keys are checked, so a repeated phone is
    caught even when the email is new.
    """
    existing_emails = {
        e.lower() for (e,) in db.query(KOLDirectoryEntry.email)
        .filter(KOLDirectoryEntry.user_id == current_user.id, KOLDirectoryEntry.email.isnot(None))
        .all() if e
    }
    existing_phones = _existing_phones(db, current_user.id)

    created, skipped = [], 0
    for row in data.items:
        email = (row.email or "").strip() or None
        contact_no = (row.contact_no or "").strip() or None

        if email and email.lower() in existing_emails:
            skipped += 1
            continue
        if _clashing_phone(contact_no, existing_phones):
            skipped += 1
            continue

        entry = KOLDirectoryEntry(
            user_id=current_user.id,
            first_name=(row.first_name or "").strip() or None,
            last_name=(row.last_name or "").strip() or None,
            email=email,
            contact_no=contact_no,
            notes=row.notes,
            source="import",
            title=row.title,
            experience_years=row.experience_years,
            **_profile_values(row),
        )
        db.add(entry)
        created.append(entry)

        # Seed the seen-sets from this row so later rows in the same batch
        # dedupe against it too.
        if email:
            existing_emails.add(email.lower())
        existing_phones |= normalize_phones(contact_no)

    db.commit()
    for entry in created:
        db.refresh(entry)
    return {"created": len(created), "skipped": skipped, "items": created}


@router.post("/from-hcp/{hcp_id}", response_model=KOLResponse, status_code=201)
def add_hcp_to_directory(hcp_id: int, db: Session = Depends(get_db),
                         current_user: User = Depends(get_current_user)):
    """Promote an existing HCP profile into the Find KOLs directory."""
    hcp = db.query(HCPProfile).filter(HCPProfile.id == hcp_id).first()
    if not hcp:
        raise HTTPException(status_code=404, detail="HCP not found")
    if current_user.role == "user" and hcp.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    existing = (
        db.query(KOLDirectoryEntry)
        .filter(KOLDirectoryEntry.user_id == current_user.id, KOLDirectoryEntry.hcp_id == hcp.id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="This HCP is already in the KOL database")

    email = (hcp.email or "").strip() or None
    if email:
        dupe = (
            db.query(KOLDirectoryEntry)
            .filter(KOLDirectoryEntry.user_id == current_user.id, KOLDirectoryEntry.email == email)
            .first()
        )
        if dupe:
            raise HTTPException(status_code=409, detail=f"A KOL with email {email} already exists")

    title, bare = split_title(hcp.full_name or "")
    first_name, last_name = _split_name(bare)
    city_country = ", ".join(p for p in [(hcp.city or "").strip(), (hcp.country or "").strip()] if p)
    entry = KOLDirectoryEntry(
        user_id=current_user.id,
        title=title,
        first_name=first_name or None,
        last_name=last_name or None,
        email=email,
        therapeutic_area=(hcp.therapeutic_area or hcp.specialty or "").strip() or None,
        state_city=city_country or None,
        specialty=(hcp.specialty or "").strip() or None,
        institution=(hcp.institution or "").strip() or None,
        designation=(hcp.designation or "").strip() or None,
        functional_expertise=(hcp.unique_expertise or "").strip() or None,
        source="hcp",
        hcp_id=hcp.id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.put("/{entry_id}", response_model=KOLResponse)
def update_kol(entry_id: int, data: KOLUpdate, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    entry = _get_owned(entry_id, db, current_user)
    fields = data.model_dump(exclude_unset=True)

    email = (fields.get("email") or "").strip() or None
    if email and email.lower() != (entry.email or "").lower():
        dupe = (
            db.query(KOLDirectoryEntry)
            .filter(
                KOLDirectoryEntry.user_id == entry.user_id,
                KOLDirectoryEntry.email == email,
                KOLDirectoryEntry.id != entry.id,
            )
            .first()
        )
        if dupe:
            raise HTTPException(status_code=409, detail=f"A KOL with email {email} already exists")

    if "contact_no" in fields:
        clash = _clashing_phone(
            fields.get("contact_no"),
            _existing_phones(db, entry.user_id, exclude_id=entry.id),
        )
        if clash:
            raise HTTPException(status_code=409, detail=f"A KOL with contact number {clash} already exists")

    for key, value in fields.items():
        setattr(entry, key, value.strip() or None if isinstance(value, str) else value)
    db.commit()
    db.refresh(entry)
    return entry


# ── Research enrichment (PubMed / ClinicalTrials.gov / Scholar) ──
# The same fetch that runs when a scraped candidate is sent for verification, but
# for a KOL already in the directory — including ones added by hand or by import.

@router.post("/{entry_id}/enrich", response_model=KOLResponse)
def enrich_kol(entry_id: int, background: BackgroundTasks,
               db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    """(Re)run enrichment for one directory KOL. Returns immediately with
    status='running'; the client polls the row for the result."""
    entry = _get_owned(entry_id, db, current_user)
    if entry.enrichment_status == "running":
        raise HTTPException(status_code=409, detail="Enrichment is already running for this KOL.")
    entry.enrichment_status = "running"
    db.commit()
    background.add_task(run_enrichment, KOLDirectoryEntry, [entry.id])
    db.refresh(entry)
    return entry


# ── CTRI (Clinical Trials Registry - India) ──
# Each CTRI search costs one CAPTCHA the user types (GET /kol-directory/ctri/captcha).
# Trial detail pages are public, so everything after the search is free.

def _ctri_search(answer: CTRICaptchaAnswer, keyword: str) -> list[dict]:
    try:
        return ctri_service.search(answer.session, answer.captcha, keyword)
    except CTRICaptchaError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except CTRIError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


def _kol_name(entry) -> str:
    return f"{entry.first_name or ''} {entry.last_name or ''}".strip()


@router.post("/{entry_id}/ctri", response_model=KOLResponse)
def update_kol_from_ctri(entry_id: int, answer: CTRICaptchaAnswer,
                         db: Session = Depends(get_db),
                         current_user: User = Depends(get_current_user)):
    """Search CTRI for this KOL by name and record the trials they ran there.
    Blank email / phone / institution / designation / place are filled from the
    trial records; nothing already set is overwritten."""
    entry = _get_owned(entry_id, db, current_user)
    name = _kol_name(entry)
    if len(ctri_service.name_tokens(name)) < 2:
        raise HTTPException(status_code=400, detail="CTRI needs a first and last name to search by.")
    trials = _ctri_search(answer, name)
    _, found = ctri_store.fetch_and_store([t["trial_id"] for t in trials[:40]])
    people = [p for p in found if ctri_service.names_match(p["name"], name)]
    if not ctri_service.apply_to_row(entry, people):
        # Checked and found nothing — record that, so the page can say so.
        entry.ctri_data = json.dumps(ctri_service.summary((entry.ctri or {}).get("trials", [])))
        entry.ctri_updated_at = datetime.utcnow()
    db.commit()
    db.refresh(entry)
    return entry


def _ctri_bulk_match(trial_ids: list[int], kol_ids: list[int], keyword: str) -> None:
    """Background half of the bulk update: read the trials' investigators (saving
    them to the CTRI database) and attach them to every directory KOL whose name matches."""
    db = SessionLocal()
    try:
        details, people = ctri_store.fetch_and_store(trial_ids, keyword)
        matched = 0
        for kol in db.query(KOLDirectoryEntry).filter(KOLDirectoryEntry.id.in_(kol_ids)).all():
            name = _kol_name(kol)
            if len(ctri_service.name_tokens(name)) < 2:
                continue
            mine = [p for p in people if ctri_service.names_match(p["name"], name)]
            if ctri_service.apply_to_row(kol, mine):
                matched += 1
        db.commit()
        logger.info("CTRI bulk update: %d trials, %d investigators, %d KOLs matched",
                    len(details), len(people), matched)
    except Exception:  # noqa: BLE001 - background task: log, never raise into the server
        logger.exception("CTRI bulk update failed")
        db.rollback()
    finally:
        db.close()


@router.post("/ctri/update-bulk")
def update_kols_from_ctri(data: KOLCTRIBulkUpdate, background: BackgroundTasks,
                          db: Session = Depends(get_db),
                          current_user: User = Depends(get_current_user)):
    """One CTRI search (one CAPTCHA) by keyword, then — in the background — match
    the investigators of the newest matching trials against the directory and
    update every KOL found among them."""
    keyword = (data.keyword or "").strip()
    if not keyword:
        raise HTTPException(status_code=400, detail="Enter a keyword to search CTRI for.")
    query = _scoped(db.query(KOLDirectoryEntry.id), current_user)
    if data.ids:
        query = query.filter(KOLDirectoryEntry.id.in_(data.ids))
    kol_ids = [i for (i,) in query.all()]
    if not kol_ids:
        return {"trials": 0, "checked": 0, "kols": 0}
    trials = _ctri_search(data, keyword)
    trial_ids = [t["trial_id"] for t in trials[:max(10, min(data.max_trials, 300))]]
    if trial_ids:
        background.add_task(_ctri_bulk_match, trial_ids, kol_ids, keyword)
    return {"trials": len(trials), "checked": len(trial_ids), "kols": len(kol_ids)}


@router.post("/enrich/bulk")
def enrich_kols_bulk(data: KOLEnrichBulk, background: BackgroundTasks,
                     db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user)):
    """Queue enrichment for several KOLs at once — the "fetch details for all of
    these" action. Rows already running are left alone rather than re-queued, so
    clicking twice doesn't double the work."""
    if not data.ids:
        return {"queued": 0, "skipped": 0}

    rows = _scoped(
        db.query(KOLDirectoryEntry).filter(KOLDirectoryEntry.id.in_(data.ids)),
        current_user,
    ).all()

    queued = [r for r in rows if r.enrichment_status != "running"
              and (data.refresh or r.enrichment_status in ("none", "error"))]
    for row in queued:
        row.enrichment_status = "running"
    db.commit()

    if queued:
        background.add_task(run_enrichment, KOLDirectoryEntry, [r.id for r in queued])
    return {"queued": len(queued), "skipped": len(rows) - len(queued)}


def _missing_experience(db: Session, model, current_user: User):
    q = db.query(model.id).filter(model.experience_years.is_(None))
    if model is KOLPendingEntry:
        q = q.filter(KOLPendingEntry.status == "pending")
    if current_user.role == "user":
        q = q.filter(model.user_id == current_user.id)
    return [i for (i,) in q.all()]


@router.get("/export/columns")
def export_columns(_: User = Depends(get_current_user)):
    """The columns an export can include, in order, with the default selection."""
    return kol_export.catalogue()


@router.get("/export")
def export_kols(
    format: str = Query("xlsx", pattern="^(csv|xlsx)$"),
    columns: str = Query("", description="Comma-separated column keys; blank = the defaults."),
    scope: str = Query("directory", pattern="^(directory|pending)$"),
    ids: str = Query("", description="Comma-separated ids — export only these (the ticked KOLs)."),
    search: Optional[str] = None,
    therapeutic_area: Optional[str] = None,
    geographic_zone: Optional[str] = None,
    state_city: Optional[str] = None,
    specialty: Optional[str] = None,
    subspecialty: Optional[str] = None,
    institution: Optional[str] = None,
    designation: Optional[str] = None,
    influence_level: Optional[str] = None,
    functional_expertise: Optional[str] = None,
    source: Optional[str] = None,
    sort: str = Query("recent", pattern="^(recent|name)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download KOLs as CSV or Excel with the chosen columns. Same filters and
    visibility as the list; `ids` narrows it to the ticked KOLs."""
    keys = [k for k in columns.split(",") if k in kol_export.COLUMNS] or \
        [c["key"] for c in kol_export.catalogue() if c["default"]]
    model = KOLPendingEntry if scope == "pending" else KOLDirectoryEntry
    query = _filtered(db, model, current_user, search, {
        "therapeutic_area": therapeutic_area, "geographic_zone": geographic_zone,
        "state_city": state_city, "specialty": specialty, "subspecialty": subspecialty,
        "institution": institution, "designation": designation,
        "influence_level": influence_level, "functional_expertise": functional_expertise,
        "source": source,
    })
    id_list = [int(i) for i in ids.split(",") if i.strip().isdigit()]
    if id_list:
        query = query.filter(model.id.in_(id_list))
    order = ((model.first_name.asc(), model.last_name.asc()) if sort == "name"
             else (model.created_at.desc(),))
    records = query.order_by(*order).all()

    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M")
    name = f"kols-{'pending' if scope == 'pending' else 'directory'}-{stamp}"
    if format == "csv":
        body, mime = kol_export.to_csv(records, keys), "text/csv; charset=utf-8"
    else:
        body = kol_export.to_xlsx(records, keys, "Pending KOLs" if scope == "pending" else "KOLs")
        mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return Response(content=body, media_type=mime, headers={
        "Content-Disposition": f'attachment; filename="{name}.{format}"',
        "X-Row-Count": str(len(records)),
        "Access-Control-Expose-Headers": "Content-Disposition, X-Row-Count",
    })


@router.get("/experience/missing")
def experience_missing(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """How many KOLs (directory / pending) still have no total experience."""
    return {"directory": len(_missing_experience(db, KOLDirectoryEntry, current_user)),
            "pending": len(_missing_experience(db, KOLPendingEntry, current_user))}


@router.post("/experience/fetch")
def experience_fetch(background: BackgroundTasks,
                     use_search: bool = Query(False, description="Also web-search each doctor's Practo "
                                                                 "profile — uses a SerpAPI search per KOL."),
                     db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Fill total experience for existing KOLs that lack it, in the background:
    saved text → Practo profile → source web page → (optional) web search."""
    ids_dir = _missing_experience(db, KOLDirectoryEntry, current_user)
    ids_pen = _missing_experience(db, KOLPendingEntry, current_user)
    if ids_dir:
        background.add_task(backfill_experience, KOLDirectoryEntry, ids_dir, current_user.id, use_search)
    if ids_pen:
        background.add_task(backfill_experience, KOLPendingEntry, ids_pen, current_user.id, use_search)
    return {"queued": len(ids_dir) + len(ids_pen), "directory": len(ids_dir), "pending": len(ids_pen)}


@router.post("/delete/bulk")
def delete_kols_bulk(data: KOLDeleteBulk, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user)):
    """Remove several KOLs at once. Scoped like the single delete: a plain user
    only removes their own rows; ids they can't see are silently skipped."""
    if not data.ids:
        return {"deleted": 0}

    rows = _scoped(
        db.query(KOLDirectoryEntry).filter(KOLDirectoryEntry.id.in_(data.ids)),
        current_user,
    ).all()
    # Per-row delete (not a bulk query delete) so ORM cascades still run.
    for row in rows:
        db.delete(row)
    db.commit()
    return {"deleted": len(rows)}


@router.delete("/{entry_id}")
def delete_kol(entry_id: int, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    entry = _get_owned(entry_id, db, current_user)
    db.delete(entry)
    db.commit()
    return {"detail": "KOL deleted"}
