"""X (Twitter) scraping + approval workflow for the KOL directory.

Flow: scrape (search X, nothing saved) -> user picks candidates -> submit for
approval (rows land in kol_pending, status='pending') -> an approver approves
(row copied into kol_directory) or rejects.
"""
import asyncio
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.kol_directory import KOLDirectoryEntry
from app.models.kol_pending import KOLPendingEntry
from app.models.master_data import MasterData, MasterDataType, parse_keywords
from app.models.user import User
from app.schemas.kol_pending import (
    BulkReview, PendingListResponse, PendingResponse, PendingSubmit,
    PendingSubmitResult, ReviewAction, ScrapeCriteria, ScrapeResult,
)
from app.services import ctri_service, ctri_store, twitter_service
from app.services.ctri_service import CTRICaptchaError, CTRIError
from app.services.contact_finder import find_contacts
from app.services.kol_enrichment_jobs import pubmed_credentials, run_enrichment
from app.services.research_kols import ctgov_candidates, pubmed_candidates
from app.services.practo_service import PractoService
from app.services.twitter_service import TwitterSearchError
from app.services.integration_keys import log_usage, web_search_keys
from app.services.name_titles import split_title
from app.services.experience_backfill import experience_for_pages, practo_experience_by_name
from app.services.own_page import (
    find_own_page, fix_listing_links, is_listing, is_social, resolve_listing_links,
)
from app.services.web_search_service import extract_doctors, web_search

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/kol-directory", tags=["KOL Directory - Scrape"])


def _is_admin(user: User) -> bool:
    return user.role in ("admin", "super_admin")


# Leading titles to drop before splitting a name. Practo prefixes every listing
# with "Dr.", and plenty of X display names do too — without this the directory
# fills up with first_name="Dr.".
_NAME_TITLES = re.compile(r"^\s*(?:dr|prof|mr|mrs|ms|miss)\.?\s+", re.IGNORECASE)


def _split_name(full_name: str) -> tuple[Optional[str], Optional[str]]:
    cleaned = _NAME_TITLES.sub("", (full_name or "").strip())
    parts = cleaned.split()
    if not parts:
        # A name that was *only* a title still beats storing nothing.
        parts = (full_name or "").strip().split()
        if not parts:
            return None, None
    if len(parts) == 1:
        return parts[0], None
    return parts[0], " ".join(parts[1:])


# Neither source publishes contact details: Practo masks them in its own page data
# ("+918*****5", "dra****@gmail.com") and X exposes no email/phone field at all. The
# only place either legitimately appears is when someone typed it into their own
# public bio, so that is the one place we look.
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# An Indian mobile: 10 digits starting 6-9, optionally +91-prefixed and commonly
# written with a space or dash in the middle ("+91 98765 43210"). Deliberately
# anchored on that shape — a bare digit run in prose is as likely a registration
# number or a year, and a wrong number in a KOL record is worse than a blank one.
_PHONE_RE = re.compile(r"(?:\+91[\s-]?)?\b([6-9]\d{4})[\s-]?(\d{5})\b")


def _find_email(text: Optional[str]) -> Optional[str]:
    m = _EMAIL_RE.search(text or "")
    return m.group(0) if m else None


# "15+ years of experience", "20 yrs exp", "experience of 12 years",
# "over 25 years of clinical experience".
_EXPERIENCE_RES = [
    re.compile(r"(\d{1,2})\s*\+?\s*(?:years?|yrs?)\.?\s+(?:of\s+)?(?:\w+\s+){0,2}?(?:experience|exp\b)", re.I),
    re.compile(r"experience\s+of\s+(?:over\s+|more\s+than\s+|nearly\s+|about\s+)?(\d{1,2})\s*\+?\s*(?:years?|yrs?)", re.I),
    re.compile(r"(?:experience|exp\.?)\s*[:\-–]\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)", re.I),
]


def _find_experience(text: Optional[str]) -> Optional[int]:
    """Total years of experience when the text states it; None otherwise."""
    for rx in _EXPERIENCE_RES:
        m = rx.search(text or "")
        if m and 0 < int(m.group(1)) < 70:
            return int(m.group(1))
    return None


def _find_phone(text: Optional[str]) -> Optional[str]:
    # Masked values (Practo's "+918*****5") contain '*' and never match \d.
    m = _PHONE_RE.search(text or "")
    # Normalised to bare digits so the stored value is consistent.
    return f"{m.group(1)}{m.group(2)}" if m else None


def _resolve_topic_keywords(db: Session, user_id: int, therapeutic_area: str) -> list[str]:
    """The supporting search terms configured for this therapeutic area.

    Resolved server-side from Account → Categories rather than trusted from the
    request, so the keyword list stays the single source of truth. The caller's own
    area wins over a global one of the same name.
    """
    ta = (therapeutic_area or "").strip()
    if not ta:
        return []
    row = (
        db.query(MasterData)
        .filter(
            MasterData.type == MasterDataType.therapeutic_area,
            MasterData.is_active.is_(True),
            or_(MasterData.user_id == user_id, MasterData.user_id.is_(None)),
            or_(func.lower(MasterData.label) == ta.lower(),
                func.lower(MasterData.value) == ta.lower()),
        )
        # user_id IS NULL sorts last, so a personal override is picked first.
        .order_by(MasterData.user_id.is_(None).asc())
        .first()
    )
    return parse_keywords(row.keywords) if row else []


# ── 1. Scrape (search X / Practo — nothing is saved) ─────────────

def _practo_candidates(criteria: ScrapeCriteria, notes: list[str]) -> list[dict]:
    """Method 4: Practo's public city+specialty directory.

    The X methods sample whoever tweets; this returns the actual roster of
    practising doctors for a city (or, with only a Country, across that
    country's major cities), which is what a place-based KOL search
    (e.g. "dermatologists in Delhi") really wants.
    """
    # Both come from the form — nothing about the place or the specialty is fixed
    # in code. A City/State is used as-is; otherwise the Country (the
    # `geographic_zone` field) is walked city by city. The specialty falls back
    # through the criteria the user did fill in.
    city = (criteria.city or criteria.state or "").strip()
    # Practo is India-only, so a search with no place at all means India.
    country = (criteria.geographic_zone or "").strip() or "India"
    if country.lower() in ("north", "south", "east", "west"):   # legacy zone values
        country = "India"
    specialty = (criteria.specialty or criteria.subspecialty
                 or criteria.therapeutic_area or "").strip()
    if not specialty:
        notes.append("Practo skipped — pick a Therapeutic Area or Specialty to search it.")
        return []

    svc = PractoService()
    if not city and not svc.serves_country(country):
        notes.append(f"Practo only lists doctors in India — no Practo results for {country}.")
        return []

    # This endpoint is sync (FastAPI runs it in a threadpool), so there is no
    # running loop here and asyncio.run owns one for the duration of the scrape.
    if city:
        docs = asyncio.run(svc.discover_by_specialty(
            city, specialty, limit=criteria.limit, enrich=criteria.enrich_profiles,
        ))
    else:
        docs = asyncio.run(svc.discover_by_country(
            country, specialty, limit=criteria.limit, enrich=criteria.enrich_profiles,
        ))

    out = []
    for d in docs:
        place = ", ".join([p for p in (d.get("locality"), d.get("region")) if p])
        subs = d.get("subspecialties") or []
        reg_bits = [b for b in (d.get("registration_council"), d.get("registration_number")) if b]
        out.append({
            "key": d["profile_url"],
            "source": "practo",
            "name": d["name"],
            "bio": (d.get("summary") or " · ".join(
                [b for b in (d.get("specialty"), d.get("clinic")) if b])) or None,
            "location": place or None,
            "profile_url": d["profile_url"],
            # Practo masks contact details, so this only finds an address a doctor
            # wrote into their own public summary.
            "email": _find_email(d.get("summary")),
            "specialty": d.get("specialty") or None,
            "subspecialty": ", ".join(subs) or None,
            "institution": d.get("clinic") or None,
            "locality": d.get("locality") or None,
            "city": (d.get("region") or "").title() or None,
            # Practo publishes no state — carry the one that was searched for.
            "state": (criteria.state or "").strip() or None,
            "country": d.get("country") or None,
            "postal_code": d.get("postal_code") or None,
            "image_url": d.get("image") or None,
            "practo_clinic": d.get("clinic") or None,
            "practo_specialty": d.get("specialty") or None,
            "practo_fee": d.get("consultation_fee"),
            "practo_experience_years": d.get("experience_years"),
            "experience_years": d.get("experience_years") or _find_experience(d.get("summary")),
            "practo_qualifications": d.get("qualifications") or [],
            "practo_registration": " #".join(reg_bits) or None,
            "practo_registration_verified": bool(d.get("registration_verified")),
            "practo_memberships": d.get("memberships") or [],
            "practo_languages": d.get("languages") or [],
            "practo_rating": d.get("rating"),
            "practo_reviews_count": d.get("reviews_count"),
            "discovered_via": f"practo:{city or country}",
        })
    return out


# Country -> Google `gl` code, so results lean to that market. Unlisted countries
# just search without it.
_GL = {
    "india": "in", "united states": "us", "united kingdom": "uk", "canada": "ca",
    "australia": "au", "singapore": "sg", "united arab emirates": "ae",
    "germany": "de", "france": "fr", "japan": "jp", "south africa": "za",
}


def _google_candidates(criteria: ScrapeCriteria, serpapi_keys: list[tuple[int, str]],
                       notes: list[str], events: list[dict]) -> list[dict]:
    """Method 5: Google web search for doctors named on hospital / clinic /
    directory pages — reaches doctors who are on neither X nor Practo."""
    specialty = (criteria.specialty or criteria.subspecialty or criteria.therapeutic_area or "").strip()
    place = (criteria.city or criteria.state or criteria.geographic_zone or "").strip()
    if not specialty and not place:
        notes.append("Google search skipped — pick a Therapeutic Area / Specialty or a place.")
        return []

    term = specialty or "doctor"
    queries = [" ".join(p for p in (f'"Dr" {term}', place, "consultant") if p),
               " ".join(p for p in (f'"Dr" {term}', place, "hospital") if p)]
    country = (criteria.geographic_zone or "").strip().lower()
    results, search_notes = web_search(
        queries, serpapi_keys, pages=2 if criteria.limit > 20 else 1, gl=_GL.get(country),
        events=events,
    )
    notes.extend(search_notes)

    docs = extract_doctors(results, [term, criteria.therapeutic_area, criteria.city,
                                     criteria.state, criteria.geographic_zone])
    # Names seen only on a listing page: follow the listing's own link to each
    # doctor where it has one (free), so the saved link is their page.
    docs = docs[:criteria.limit]
    # A social post ("Dr X is a trusted surgeon…" on Instagram / Facebook) names
    # the doctor in its title but is not their page — look for a real one, and
    # keep the post only if nothing better turns up.
    for d in docs:
        if is_social(d["url"]) and not is_listing(d["url"]):
            d["social_url"] = d["url"]
            d["page_url"] = d["url"]
            d["url"] = f'{d["url"]}#{re.sub(r"[^a-z0-9]+", "-", d["name"].lower()).strip("-")}'
    resolve_listing_links(docs)
    # Still on a list page (the site blocked the free step): search the doctor by
    # name for their own page, a few at a time.
    if criteria.find_own_pages:
        still = [d for d in docs if is_listing(d["url"])]
        if still:
            city = (criteria.city or criteria.state or "").strip()
            with ThreadPoolExecutor(max_workers=4) as pool:
                owns = list(pool.map(lambda d: find_own_page(
                    d["name"].removeprefix("Dr. "), city, d["page_url"], serpapi_keys, events), still))
            for d, own in zip(still, owns):
                if own:
                    d["url"] = own
            found = sum(1 for o in owns if o)
            if found:
                notes.append(f"Found the own page of {found} of {len(still)} doctors named on list pages.")
    for d in docs:
        if d.get("social_url") and is_listing(d["url"]):
            d["url"] = d["social_url"]   # nothing better found — the post it is
    # Read total experience off each doctor's own page (the snippet rarely has
    # it; the page usually does — e.g. "has an experience of 31 years").
    need = [d for d in docs if not _find_experience(f"{d['page_title']} {d['snippet']}")]
    for d, years in zip(need, experience_for_pages([(d["url"], d["name"].split()[-1]) for d in need])):
        d["page_experience"] = years
    # Page didn't say (or blocked us): Practo by name — free.
    still = [d for d in need if not d.get("page_experience")]
    city = (criteria.city or criteria.state or "").strip()
    for d, years in zip(still, practo_experience_by_name([(d["name"].removeprefix("Dr. "), city) for d in still])):
        d["page_experience"] = years
    out = []
    for d in docs[:criteria.limit]:
        out.append({
            "key": d["url"],
            "source": "google",
            "name": d["name"],
            "bio": d["snippet"] or None,
            "location": place or None,
            "profile_url": d["url"],
            "email": _find_email(d["snippet"]),
            "contact_no": _find_phone(d["snippet"]),
            "specialty": specialty or None,
            "institution": d["institution"],
            "designation": d["designation"],
            "city": (criteria.city or "").strip() or None,
            "state": (criteria.state or "").strip() or None,
            "country": (criteria.geographic_zone or "").strip() or None,
            "experience_years": _find_experience(f"{d['page_title']} {d['snippet']}") or d.get("page_experience"),
            "web_page_title": d["page_title"] or None,
            "web_provider": d["provider"],
            "discovered_via": f"google:{d['provider']}",
        })
    return out


def _ctri_candidates(criteria: ScrapeCriteria, notes: list[str]) -> list[dict]:
    """Method 6: CTRI — principal and site investigators of Indian clinical trials
    for the Specialty (or Therapeutic Area). Trial investigators are research-active
    by definition, which is the KOL signal the other sources lack."""
    country = (criteria.geographic_zone or "").strip()
    if country and country.lower() != "india":
        notes.append(f"CTRI only registers trials run in India — no CTRI results for {country}.")
        return []
    keyword = (criteria.specialty or criteria.subspecialty or criteria.therapeutic_area or "").strip()

    trials = ctri_service.search(criteria.ctri_session, criteria.ctri_captcha, keyword)
    # Newest first; each trial names 1–20 investigators, so `limit` trials is
    # plenty to fill `limit` candidates once filtered by place.
    wanted = trials[:min(max(criteria.limit, 20), 100)]
    # Saved to our CTRI database as it's read (and reused from it when fresh).
    details, people = ctri_store.fetch_and_store([t["trial_id"] for t in wanted], keyword)
    notes.append(f"CTRI: {len(trials)} trial{'s' if len(trials) != 1 else ''} match “{keyword}” — "
                 f"read investigators from the newest {len(details)}.")

    state = (criteria.state or "").strip().lower()
    city = (criteria.city or "").strip().lower()
    inst = (criteria.institution or "").strip().lower()

    def wanted_person(p: dict) -> bool:
        where = f"{p.get('city') or ''} {p.get('state') or ''} {p.get('address') or ''}".lower()
        if state and state not in where:
            return False
        if city and city not in where:
            return False
        if inst and inst not in f"{p.get('institution') or ''} {p.get('address') or ''}".lower():
            return False
        return True

    out = []
    for p in (p for p in people if wanted_person(p)):
        latest = p["trials"][0]
        place = ", ".join(x for x in (p.get("city"), p.get("state")) if x)
        n, pi = p["trial_count"], p["pi_count"]
        bio = f"{n} CTRI trial{'s' if n != 1 else ''}" + (f", {pi} as PI" if pi else "") \
            + (" (postgraduate thesis only)" if p["thesis_only"] else "") \
            + f" · latest: {latest.get('title') or latest.get('ctri_no')}"
        out.append({
            "key": f"ctri:{p['key']}",
            "source": "ctri",
            "name": p["name"],
            "bio": bio,
            "location": place or None,
            "profile_url": latest["url"],
            "email": p.get("email"),
            "contact_no": ctri_service.best_phone(p.get("phones") or []),
            "specialty": (criteria.specialty or "").strip() or None,
            "institution": (p.get("institution") or "")[:255] or None,
            "designation": (p.get("designation") or "")[:255] or None,
            "city": p.get("city"),
            "state": p.get("state"),
            "country": "India",
            "postal_code": p.get("postal_code"),
            "ctri_key": p["key"],
            "ctri_trial_count": p["trial_count"],
            "ctri_pi_count": p["pi_count"],
            "ctri_trials": p["trials"][:50],
            "discovered_via": f"ctri:{keyword}",
        })
        if len(out) >= criteria.limit:
            break
    if people and not out:
        notes.append("CTRI found investigators, but none in the City / State / Institution you set.")
    return out


@router.get("/ctri/captcha")
def ctri_captcha(_: User = Depends(get_current_user)):
    """Start a CTRI search session: returns the CAPTCHA image for the user to read
    and an opaque session token to send back with their answer. Each code is good
    for one search."""
    try:
        return ctri_service.start_session()
    except CTRIError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


_SOURCE_LABELS = {"x": "X", "practo": "Practo", "google": "Google search", "ctri": "CTRI",
                  "pubmed": "PubMed", "ctgov": "ClinicalTrials.gov"}
# Sources whose identity is the page / search link in web_profile_url.
_WEB_SOURCES = ("google", "pubmed", "ctgov")


def _name_key(name: Optional[str]) -> str:
    words = re.findall(r"[a-z]+", (name or "").lower())
    return " ".join(w for w in words if w not in ("dr", "prof", "mr", "ms", "mrs"))


@router.post("/scrape", response_model=ScrapeResult)
@router.post("/scrape/twitter", response_model=ScrapeResult)  # legacy alias
def scrape(criteria: ScrapeCriteria, db: Session = Depends(get_db),
           current_user: User = Depends(get_current_user)):
    crit = criteria.model_dump()
    # Supporting keywords for the chosen therapeutic area feed both the X query and
    # the follower bio filter.
    crit["topic_keywords"] = _resolve_topic_keywords(db, current_user.id, criteria.therapeutic_area)

    hubs = [h.strip() for h in (criteria.hub_handles or []) if h and h.strip()]
    wants_x = criteria.use_recent_search or bool(hubs)

    candidates, seen = [], set()
    notes: list[str] = []

    def add(items):
        for c in items:
            key = (c.get("key") or "").lower()
            if key and key not in seen:
                seen.add(key)
                candidates.append(c)

    # Only the X methods need a bearer — a Practo-only scrape must not demand one.
    query = ""
    bearer = None
    if wants_x:
        bearer = twitter_service.resolve_bearer(db, current_user.id)
        if not bearer:
            raise HTTPException(
                status_code=400,
                detail="No X (Twitter) integration is connected. Add one under Account → X (Twitter), "
                       "or ask an admin to set the platform default.",
            )
        query = twitter_service.build_query(crit)
        if not query:
            raise HTTPException(
                status_code=400,
                detail="Nothing to search X for. Pick a Therapeutic Area (or add a City/State).",
            )

    def run_x() -> list[dict]:
        found = []
        # Method 2: recent-tweet keyword search.
        if criteria.use_recent_search:
            found += twitter_service.search_candidates(bearer, query, criteria.limit)
        # Method 3: hub-account followers/following, filtered to dermatologists.
        if hubs:
            found += twitter_service.search_via_followers(bearer, hubs, crit, per_hub=criteria.per_hub)
        # X has no contact fields — but people do put an address or number in their bio.
        for c in found:
            if c.get("source") == "x":
                c["email"] = _find_email(c.get("bio"))
                c["contact_no"] = _find_phone(c.get("bio"))
                c["experience_years"] = _find_experience(c.get("bio"))
        return found

    # PubMed / ClinicalTrials.gov carry their identity in web_profile_url, like Google.
    pubmed_key = pubmed_credentials(db)[0] if criteria.use_pubmed else ""

    if criteria.use_ctri:
        if not (criteria.ctri_session and (criteria.ctri_captcha or "").strip()):
            raise HTTPException(status_code=400, detail="Type the CTRI security code to search CTRI.")
        if not (criteria.specialty or criteria.subspecialty or criteria.therapeutic_area or "").strip():
            raise HTTPException(status_code=400,
                                detail="Pick a Therapeutic Area or Specialty — CTRI is searched for it.")

    # The DB session isn't thread-safe, so the keys are read here, not in the worker.
    # The account's own SerpAPI keys come first, then the platform's.
    key_rows = web_search_keys(db, current_user.id) if criteria.use_google else []
    serpapi_keys = [(cid, key) for cid, key, _ in key_rows]
    search_events: list[dict] = []

    # X, Practo, Google, CTRI, PubMed and ClinicalTrials.gov are independent
    # network-bound searches — run them side by side so the scrape takes as long
    # as the slowest one, not the sum.
    jobs = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        if wants_x:
            jobs["x"] = pool.submit(run_x)
        if criteria.use_practo:
            jobs["practo"] = pool.submit(_practo_candidates, criteria, notes)
        if criteria.use_google:
            jobs["google"] = pool.submit(_google_candidates, criteria, serpapi_keys, notes, search_events)
        if criteria.use_ctri:
            jobs["ctri"] = pool.submit(_ctri_candidates, criteria, notes)
        if criteria.use_pubmed:
            jobs["pubmed"] = pool.submit(pubmed_candidates, criteria, notes, pubmed_key, crit["topic_keywords"])
        if criteria.use_ctgov:
            jobs["ctgov"] = pool.submit(ctgov_candidates, criteria, notes, crit["topic_keywords"])
        outcomes = {}
        for name, fut in jobs.items():
            try:
                outcomes[name] = fut.result()
            except Exception as exc:  # noqa: BLE001 - one failing source must not sink the others
                outcomes[name] = exc

    log_usage(search_events, current_user.id, "find_kols", {cid: scope for cid, _, scope in key_rows})

    failures = {}
    for name in ("x", "practo", "ctri", "google", "pubmed", "ctgov"):
        res = outcomes.get(name)
        if isinstance(res, Exception):
            logger.warning("%s discovery failed: %s", name, res)
            failures[name] = res
        elif res:
            if name in ("google", "pubmed", "ctgov"):
                # The same doctor is often on Practo too — keep the richer Practo row,
                # but hand it any email / phone this source found.
                known = {_name_key(c.get("name")): c for c in candidates}
                for c in res:
                    twin = known.get(_name_key(c["name"]))
                    if twin is not None:
                        for f in ("email", "contact_no"):
                            if c.get(f) and not twin.get(f):
                                twin[f] = c[f]
                res = [c for c in res if _name_key(c["name"]) not in known]
            add(res)

    if failures and not candidates:
        # Nothing to show at all: surface the most specific error.
        if isinstance(failures.get("x"), TwitterSearchError):
            raise HTTPException(status_code=502, detail=str(failures["x"]))
        if isinstance(failures.get("ctri"), CTRICaptchaError):
            raise HTTPException(status_code=400, detail=f"CTRI: {failures['ctri']}")
        if isinstance(failures.get("ctri"), CTRIError):
            raise HTTPException(status_code=502, detail=f"CTRI: {failures['ctri']}")
        name, exc = next(iter(failures.items()))
        label = _SOURCE_LABELS[name]
        raise HTTPException(
            status_code=502,
            detail=f"{label} lookup failed: {exc.__class__.__name__}. Try again, or use another method.",
        )
    for name, exc in failures.items():
        label = _SOURCE_LABELS[name]
        notes.append(f"{label} failed ({exc}) — showing results from the other sources.")

    _flag_already_known(db, current_user.id, candidates)
    return {"query": query or f"practo:{criteria.city or criteria.state or criteria.geographic_zone or 'India'}",
            "count": len(candidates), "candidates": candidates, "notes": notes}


def _flag_already_known(db: Session, user_id: int, candidates: list[dict]) -> None:
    """Mark candidates already in this account's directory / pending queue, so the
    UI can grey them out instead of the user re-submitting duplicates.

    X candidates are matched on handle, Practo candidates on profile URL,
    Google candidates on the page URL they were found on.
    """
    handles = [c["x_username"].lower() for c in candidates
               if c.get("source") == "x" and c.get("x_username")]
    urls = [c["profile_url"] for c in candidates
            if c.get("source") == "practo" and c.get("profile_url")]

    known_handles, known_urls = set(), set()

    if handles:
        known_handles = {
            h.lower() for (h,) in db.query(KOLDirectoryEntry.x_username)
            .filter(KOLDirectoryEntry.user_id == user_id,
                    func.lower(KOLDirectoryEntry.x_username).in_(handles)).all() if h
        }
        known_handles |= {
            h.lower() for (h,) in db.query(KOLPendingEntry.x_username)
            .filter(KOLPendingEntry.user_id == user_id,
                    KOLPendingEntry.status == "pending",
                    func.lower(KOLPendingEntry.x_username).in_(handles)).all() if h
        }

    if urls:
        known_urls = {
            u for (u,) in db.query(KOLDirectoryEntry.practo_profile_url)
            .filter(KOLDirectoryEntry.user_id == user_id,
                    KOLDirectoryEntry.practo_profile_url.in_(urls)).all() if u
        }
        known_urls |= {
            u for (u,) in db.query(KOLPendingEntry.practo_profile_url)
            .filter(KOLPendingEntry.user_id == user_id,
                    KOLPendingEntry.status == "pending",
                    KOLPendingEntry.practo_profile_url.in_(urls)).all() if u
        }

    web_urls = [c["profile_url"] for c in candidates
                if c.get("source") in _WEB_SOURCES and c.get("profile_url")]
    known_web = set()
    if web_urls:
        known_web = {
            u for (u,) in db.query(KOLDirectoryEntry.web_profile_url)
            .filter(KOLDirectoryEntry.user_id == user_id,
                    KOLDirectoryEntry.web_profile_url.in_(web_urls)).all() if u
        }
        known_web |= {
            u for (u,) in db.query(KOLPendingEntry.web_profile_url)
            .filter(KOLPendingEntry.user_id == user_id,
                    KOLPendingEntry.status == "pending",
                    KOLPendingEntry.web_profile_url.in_(web_urls)).all() if u
        }

    ctri_keys = [c["ctri_key"] for c in candidates if c.get("source") == "ctri" and c.get("ctri_key")]
    known_ctri = set()
    if ctri_keys:
        known_ctri = {
            k for (k,) in db.query(KOLDirectoryEntry.ctri_key)
            .filter(KOLDirectoryEntry.user_id == user_id,
                    KOLDirectoryEntry.ctri_key.in_(ctri_keys)).all() if k
        }
        known_ctri |= {
            k for (k,) in db.query(KOLPendingEntry.ctri_key)
            .filter(KOLPendingEntry.user_id == user_id,
                    KOLPendingEntry.status == "pending",
                    KOLPendingEntry.ctri_key.in_(ctri_keys)).all() if k
        }

    for c in candidates:
        if c.get("source") == "ctri":
            c["already_known"] = c.get("ctri_key") in known_ctri
        elif c.get("source") == "practo":
            c["already_known"] = c.get("profile_url") in known_urls
        elif c.get("source") in _WEB_SOURCES:
            c["already_known"] = c.get("profile_url") in known_web
        else:
            c["already_known"] = (c.get("x_username") or "").lower() in known_handles


# ── 2. Submit picked candidates for approval ─────────────────────

@router.post("/pending/bulk", response_model=PendingSubmitResult, status_code=201)
def submit_for_approval(data: PendingSubmit, background: BackgroundTasks,
                        db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_user)):
    existing = {
        h.lower() for (h,) in db.query(KOLPendingEntry.x_username)
        .filter(KOLPendingEntry.user_id == current_user.id,
                KOLPendingEntry.status == "pending",
                KOLPendingEntry.x_username.isnot(None)).all() if h
    }
    already_directory = {
        h.lower() for (h,) in db.query(KOLDirectoryEntry.x_username)
        .filter(KOLDirectoryEntry.user_id == current_user.id,
                KOLDirectoryEntry.x_username.isnot(None)).all() if h
    }
    # Practo candidates are identified by profile URL rather than handle.
    existing_urls = {
        u for (u,) in db.query(KOLPendingEntry.practo_profile_url)
        .filter(KOLPendingEntry.user_id == current_user.id,
                KOLPendingEntry.status == "pending",
                KOLPendingEntry.practo_profile_url.isnot(None)).all() if u
    }
    existing_urls |= {
        u for (u,) in db.query(KOLDirectoryEntry.practo_profile_url)
        .filter(KOLDirectoryEntry.user_id == current_user.id,
                KOLDirectoryEntry.practo_profile_url.isnot(None)).all() if u
    }

    # Google candidates are identified by the page URL they were found on.
    existing_web = {
        u for (u,) in db.query(KOLPendingEntry.web_profile_url)
        .filter(KOLPendingEntry.user_id == current_user.id,
                KOLPendingEntry.status == "pending",
                KOLPendingEntry.web_profile_url.isnot(None)).all() if u
    }
    existing_web |= {
        u for (u,) in db.query(KOLDirectoryEntry.web_profile_url)
        .filter(KOLDirectoryEntry.user_id == current_user.id,
                KOLDirectoryEntry.web_profile_url.isnot(None)).all() if u
    }

    # CTRI candidates are identified by their normalised name.
    existing_ctri = {
        k for (k,) in db.query(KOLPendingEntry.ctri_key)
        .filter(KOLPendingEntry.user_id == current_user.id,
                KOLPendingEntry.status == "pending",
                KOLPendingEntry.ctri_key.isnot(None)).all() if k
    }
    existing_ctri |= {
        k for (k,) in db.query(KOLDirectoryEntry.ctri_key)
        .filter(KOLDirectoryEntry.user_id == current_user.id,
                KOLDirectoryEntry.ctri_key.isnot(None)).all() if k
    }

    created, skipped = [], 0
    for item in data.items:
        src = (item.source or "").lower()
        is_practo = src == "practo"
        is_google = src in _WEB_SOURCES   # Google, PubMed, CT.gov: identity is web_profile_url
        is_ctri = src == "ctri"
        ctri_key = (item.ctri_key or "").strip()
        handle = (item.x_username or "").strip()
        practo_url = (item.practo_profile_url or "").strip()
        web_url = (item.web_profile_url or "").strip()

        # Each source has its own identity + duplicate check; an item carrying
        # neither is unusable.
        if is_ctri:
            if not ctri_key or ctri_key in existing_ctri:
                skipped += 1
                continue
        elif is_practo:
            if not practo_url or practo_url in existing_urls:
                skipped += 1
                continue
        elif is_google:
            if not web_url or web_url in existing_web:
                skipped += 1
                continue
        elif not handle or handle.lower() in existing or handle.lower() in already_directory:
            skipped += 1
            continue

        title, bare = split_title(item.name or item.x_name or handle)
        # Practo and Google only ever return doctors (Google names are read after
        # "Dr"), so they're "Dr." even when the source dropped it. PubMed / CT.gov
        # people may be scientists — no title is assumed for them.
        if not title and (is_practo or src == "google"):
            title = "Dr."
        first, last = _split_name(bare)
        entry = KOLPendingEntry(
            user_id=current_user.id,
            status="pending",
            title=title,
            first_name=first, last_name=last,
            email=(item.email or "").strip() or None,
            contact_no=(item.contact_no or "").strip() or None,
            notes=(item.notes or "").strip() or None,
            therapeutic_area=(item.therapeutic_area or "").strip() or None,
            geographic_zone=(item.geographic_zone or "").strip() or None,
            state_city=(item.state_city or "").strip() or None,
            specialty=(item.specialty or "").strip() or None,
            subspecialty=(item.subspecialty or "").strip() or None,
            institution=(item.institution or "").strip() or None,
            designation=(item.designation or "").strip() or None,
            influence_level=(item.influence_level or "").strip() or None,
            functional_expertise=(item.functional_expertise or "").strip() or None,
            experience_years=item.experience_years,
            x_username=handle or None,
            x_name=item.x_name,
            x_bio=item.x_bio,
            x_location=item.x_location,
            x_followers=item.x_followers,
            x_profile_url=(item.x_profile_url or (f"https://x.com/{handle}" if handle else None)),
            practo_profile_url=practo_url or None,
            web_profile_url=web_url or None,
            ctri_key=ctri_key or None,
            ctri_data=json.dumps(ctri_service.summary(item.ctri_trials)) if is_ctri and item.ctri_trials else None,
            ctri_updated_at=datetime.utcnow() if is_ctri else None,
            source="ctri" if is_ctri else "practo" if is_practo else src if is_google else "twitter",
        )
        db.add(entry)
        created.append(entry)
        if is_ctri:
            existing_ctri.add(ctri_key)
        elif is_practo:
            existing_urls.add(practo_url)
        elif is_google:
            existing_web.add(web_url)
        else:
            existing.add(handle.lower())

    # Mark up front so the row already shows "running" when the client polls,
    # rather than briefly reading "none" before the background task starts.
    if data.enrich and created:
        for e in created:
            e.enrichment_status = "running"

    db.commit()
    for e in created:
        db.refresh(e)

    # Contact details first (the sources don't publish them — see contact_finder),
    # then research enrichment; the "running" status keeps the panel polling
    # through both, so the email / phone show up without a reload.
    if created:
        background.add_task(_after_submit, [e.id for e in created], current_user.id, data.enrich)

    return {"submitted": len(created), "skipped": skipped, "items": created}


# ── Research enrichment (PubMed / ClinicalTrials.gov / Scholar) ───
# The worker lives in services/kol_enrichment_jobs so the directory endpoints can
# run the exact same enrichment against an approved KOL row.

def _enrich_ids(ids: list[int]) -> None:
    run_enrichment(KOLPendingEntry, ids)


def _after_submit(ids: list[int], user_id: int, enrich: bool) -> None:
    find_contacts(KOLPendingEntry, ids, user_id)
    if enrich:
        run_enrichment(KOLPendingEntry, ids)


@router.post("/pending/{entry_id}/enrich", response_model=PendingResponse)
def enrich_pending(entry_id: int, background: BackgroundTasks,
                   db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    """(Re)run enrichment for one pending row — used by the Details view's button
    and to refresh a stale or failed run. Returns immediately with status='running';
    the client polls the row for the result."""
    entry = _get_pending(entry_id, db, current_user)
    if entry.enrichment_status == "running":
        raise HTTPException(status_code=409, detail="Enrichment is already running for this record.")
    entry.enrichment_status = "running"
    db.commit()
    background.add_task(_enrich_ids, [entry.id])
    db.refresh(entry)
    return entry


# ── 3. Review the pending queue ──────────────────────────────────

@router.get("/pending", response_model=PendingListResponse)
def list_pending(
    status: Optional[str] = Query(None, pattern="^(pending|approved|rejected)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(KOLPendingEntry)
    # Users see their own submissions; admins see everyone's.
    if not _is_admin(current_user):
        query = query.filter(KOLPendingEntry.user_id == current_user.id)
    if status:
        query = query.filter(KOLPendingEntry.status == status)

    scope = query
    total = scope.count()
    pending = scope.filter(KOLPendingEntry.status == "pending").count() if not status \
        else (total if status == "pending" else
              query.filter(KOLPendingEntry.status == "pending").count())
    items = query.order_by(KOLPendingEntry.created_at.desc()).all()
    return {"total": total, "pending": pending, "items": items}


def _get_pending(entry_id: int, db: Session, current_user: User) -> KOLPendingEntry:
    entry = db.query(KOLPendingEntry).filter(KOLPendingEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Pending KOL not found")
    # Admins may act on any row; a plain user only on their own (approve,
    # reject, delete).
    if not _is_admin(current_user) and entry.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return entry


# ── 4. Approve / reject (the owning account, or an admin) ────────

@router.post("/pending/{entry_id}/approve", response_model=PendingResponse)
def approve_pending(entry_id: int, action: ReviewAction = ReviewAction(),
                    db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    # The account that scraped a KOL approves it itself; admins can approve anyone's.
    # (_get_pending enforces owner-or-admin.)
    entry = _get_pending(entry_id, db, current_user)
    if entry.status == "approved":
        raise HTTPException(status_code=409, detail="Already approved")

    # Skip creating a duplicate if this candidate is already in the directory —
    # matched on handle for X entries, on profile URL for Practo ones.
    dupe = None
    if entry.x_username:
        dupe = db.query(KOLDirectoryEntry).filter(
            KOLDirectoryEntry.user_id == entry.user_id,
            func.lower(KOLDirectoryEntry.x_username) == entry.x_username.lower(),
        ).first()
    elif entry.practo_profile_url:
        dupe = db.query(KOLDirectoryEntry).filter(
            KOLDirectoryEntry.user_id == entry.user_id,
            KOLDirectoryEntry.practo_profile_url == entry.practo_profile_url,
        ).first()
    elif entry.web_profile_url:
        dupe = db.query(KOLDirectoryEntry).filter(
            KOLDirectoryEntry.user_id == entry.user_id,
            KOLDirectoryEntry.web_profile_url == entry.web_profile_url,
        ).first()
    elif entry.ctri_key:
        dupe = db.query(KOLDirectoryEntry).filter(
            KOLDirectoryEntry.user_id == entry.user_id,
            KOLDirectoryEntry.ctri_key == entry.ctri_key,
        ).first()

    if dupe is None:
        bio = (entry.x_bio or "").strip()
        notes = " | ".join(p for p in [
            f"From X: @{entry.x_username}" if entry.x_username else None,
            "From Practo" if entry.practo_profile_url else None,
            {"pubmed": "From PubMed", "ctgov": "From ClinicalTrials.gov"}.get(entry.source, "From Google search")
            if entry.web_profile_url else None,
            "From CTRI" if entry.source == "ctri" else None,
            bio or None,
            entry.x_profile_url or entry.practo_profile_url or entry.web_profile_url or None,
            # Everything the scrape found that has no column of its own.
            (entry.notes or "").strip() or None,
        ] if p)
        kol = KOLDirectoryEntry(
            user_id=entry.user_id,
            title=entry.title,
            first_name=entry.first_name,
            last_name=entry.last_name,
            email=entry.email,
            contact_no=entry.contact_no,
            therapeutic_area=entry.therapeutic_area,
            geographic_zone=entry.geographic_zone,
            state_city=entry.state_city or entry.x_location,
            specialty=entry.specialty,
            subspecialty=entry.subspecialty,
            institution=entry.institution,
            designation=entry.designation,
            influence_level=entry.influence_level,
            functional_expertise=entry.functional_expertise,
            experience_years=entry.experience_years,
            x_username=entry.x_username,
            practo_profile_url=entry.practo_profile_url,
            web_profile_url=entry.web_profile_url,
            ctri_key=entry.ctri_key,
            ctri_data=entry.ctri_data,
            ctri_updated_at=entry.ctri_updated_at,
            notes=notes or None,
            source=entry.source or "twitter",
            # Carry the research footprint across — it was fetched for this same
            # person while pending, so the approved KOL starts out enriched.
            enrichment_status=entry.enrichment_status if entry.enrichment_status in ("done", "error") else "none",
            enrichment_data=entry.enrichment_data,
            enrichment_updated_at=entry.enrichment_updated_at,
        )
        db.add(kol)
        db.flush()
        entry.kol_id = kol.id
    else:
        entry.kol_id = dupe.id

    entry.status = "approved"
    entry.reviewed_by_user_id = current_user.id
    entry.reviewed_at = datetime.utcnow()
    entry.review_notes = action.notes
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/pending/{entry_id}/reject", response_model=PendingResponse)
def reject_pending(entry_id: int, action: ReviewAction = ReviewAction(),
                   db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    entry = _get_pending(entry_id, db, current_user)
    entry.status = "rejected"
    entry.reviewed_by_user_id = current_user.id
    entry.reviewed_at = datetime.utcnow()
    entry.review_notes = action.notes
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/pending/approve-bulk", response_model=PendingListResponse)
def approve_bulk(data: BulkReview, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user)):
    for entry_id in data.ids:
        try:
            approve_pending(entry_id, ReviewAction(notes=data.notes), db, current_user)
        except HTTPException as exc:
            # Missing, already approved, or not this user's — skip, approve the rest.
            if exc.status_code not in (403, 404, 409):
                raise
    return list_pending(status=None, db=db, current_user=current_user)


@router.post("/pending/{entry_id}/find-page", response_model=PendingResponse)
def find_pending_own_page(entry_id: int, db: Session = Depends(get_db),
                          current_user: User = Depends(get_current_user)):
    """For a Google KOL whose link is a listing page: search the doctor by name
    and switch the link to their own page. One web search (SerpAPI key first,
    free fallback otherwise); the listing is kept in notes."""
    entry = _get_pending(entry_id, db, current_user)
    if not is_listing(entry.web_profile_url):
        raise HTTPException(status_code=400, detail="This KOL's link is already their own page.")
    name = f"{entry.first_name or ''} {entry.last_name or ''}".strip()
    city = (entry.state_city or "").split(",")[0].strip()
    key_rows = web_search_keys(db, current_user.id)
    events: list[dict] = []
    listing = entry.web_profile_url.split("#")[0]
    own = find_own_page(name, city, listing, [(c, k) for c, k, _ in key_rows], events)
    log_usage(events, current_user.id, "find_kols", {c: s for c, _, s in key_rows})
    if not own:
        raise HTTPException(status_code=404, detail=f"Couldn't find a page of Dr. {name}'s own — the listing link is kept.")
    entry.web_profile_url = own[:500]
    note = f"Listed on: {listing}"
    if entry.experience_years is None:
        years = experience_for_pages([(own, (entry.last_name or name).split()[-1])])[0]
        if years:
            entry.experience_years = years
            note += f" | Experience {years} yrs (from own page)"
    entry.notes = f"{entry.notes} | {note}" if entry.notes else note
    db.commit()
    db.refresh(entry)
    return entry


class FindPagesRequest(BulkReview):
    use_search: bool = False   # also search each still-unresolved doctor (SerpAPI keys)


@router.post("/pending/find-pages")
def find_pending_own_pages(data: FindPagesRequest, background: BackgroundTasks,
                           db: Session = Depends(get_db),
                           current_user: User = Depends(get_current_user)):
    """Bulk "Find own page" for pending Google KOLs whose link is a listing, in the
    background: follow the listing's link to each doctor (free), then optionally a
    web search; experience is read off each new page."""
    q = db.query(KOLPendingEntry).filter(KOLPendingEntry.id.in_(data.ids or [-1]))
    if not _is_admin(current_user):
        q = q.filter(KOLPendingEntry.user_id == current_user.id)
    ids = [r.id for r in q.all() if is_listing(r.web_profile_url)]
    if ids:
        background.add_task(fix_listing_links, KOLPendingEntry, ids, current_user.id, data.use_search)
    return {"queued": len(ids)}


class FindContactsRequest(BulkReview):
    use_search: bool = True   # also search each KOL by name (own SerpAPI key, then free)


@router.post("/pending/find-contacts")
def find_pending_contacts(data: FindContactsRequest, background: BackgroundTasks,
                          db: Session = Depends(get_db),
                          current_user: User = Depends(get_current_user)):
    """Look up the email / phone of pending KOLs that lack them, in the background
    (rows scraped before contacts were looked up automatically, or to retry).
    `use_search` also searches each by name — the account's SerpAPI keys first."""
    q = db.query(KOLPendingEntry).filter(KOLPendingEntry.id.in_(data.ids or [-1]))
    if not _is_admin(current_user):
        q = q.filter(KOLPendingEntry.user_id == current_user.id)
    ids = [r.id for r in q.all() if not (r.email and r.contact_no)]
    if ids:
        background.add_task(find_contacts, KOLPendingEntry, ids, current_user.id, data.use_search)
    return {"queued": len(ids)}


@router.post("/pending/delete-bulk")
def delete_pending_bulk(data: BulkReview, db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_user)):
    """Remove several pending-verification rows at once. Same rule as the single
    delete: admins may remove any; a user only their own — others are skipped."""
    if not data.ids:
        return {"deleted": 0}
    q = db.query(KOLPendingEntry).filter(KOLPendingEntry.id.in_(data.ids))
    if not _is_admin(current_user):
        q = q.filter(KOLPendingEntry.user_id == current_user.id)
    rows = q.all()
    for row in rows:
        db.delete(row)
    db.commit()
    return {"deleted": len(rows)}


@router.delete("/pending/{entry_id}")
def delete_pending(entry_id: int, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    entry = _get_pending(entry_id, db, current_user)
    db.delete(entry)
    db.commit()
    return {"detail": "Pending KOL removed"}
