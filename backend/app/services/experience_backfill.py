"""Fill `experience_years` for KOLs saved before the scrape captured it (or found
by X / Google, which only state it sometimes).

Per KOL, first hit wins:
  1. text already on the row — notes / X bio ("15+ years of experience");
  2. its Practo profile (`practo_profile_url`), which always states it;
  3. the web page it was found on (`web_profile_url`) — see `page_experience`:
     on the doctor's own page its experience FIELD first ("28 Years" on the
     profile card), then prose; on a list page only text near their name;
  4. Practo's own name search (free): the doctor by name in their city, else
     Practo's major cities — a match must share the surname;
  5. optional (`use_search`): a web search for the doctor's Practo profile.
     With SerpAPI keys this costs one search per KOL, so it's opt-in.

Nothing is guessed: a KOL with no stated experience anywhere stays NULL.
"""
import asyncio
import logging
import re
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import httpx
from bs4 import BeautifulSoup

from app.core.database import SessionLocal
from app.services.integration_keys import log_usage, web_search_keys
from app.services.practo_service import PractoService
from app.services.web_search_service import web_search

logger = logging.getLogger(__name__)

HEADERS = PractoService.HEADERS
_PRACTO_DOCTOR = re.compile(r"practo\.com/[^/]+/doctor/", re.I)
NAME_WINDOW = (250, 400)   # chars before / after the doctor's name to look in


def _find(text: Optional[str]) -> Optional[int]:
    from app.api.endpoints.kol_scrape import _find_experience   # one regex set, shared
    return _find_experience(text)


def _near_name(text: str, last_name: str) -> Optional[int]:
    """A stated experience within NAME_WINDOW of the doctor's surname."""
    if not last_name or len(last_name) < 3:
        return None
    for m in re.finditer(re.escape(last_name), text, re.I):
        years = _find(text[max(0, m.start() - NAME_WINDOW[0]): m.end() + NAME_WINDOW[1]])
        if years:
            return years
    return None


async def _practo_profile_years(client: httpx.AsyncClient, url: str) -> Optional[int]:
    try:
        details = await asyncio.wait_for(
            PractoService().fetch_profile_details(client, url.split("?")[0].split("#")[0]), PAGE_DEADLINE)
    except asyncio.TimeoutError:
        return None
    years = details.get("experience_years")
    return years if isinstance(years, int) and 0 < years < 80 else None


async def _page_years(client: httpx.AsyncClient, url: str, last_name: str) -> Optional[int]:
    return await page_experience(client, url, last_name)


def _is_own_page(url: str, title: str, last_name: str) -> bool:
    """The page is about this doctor: their name is in its address or title."""
    last = (last_name or "").lower()
    path = re.sub(r"[-_/.]", " ", url.split("#")[0].lower())
    return bool(last) and (last in path or last in (title or "").lower())


# A profile card's experience FIELD: an element whose whole text is just
# "28 Years" / "28+ Yrs" / "Experience: 28 years" / "28 Years Experience"
# (Rainbow shows an icon + <span>28 Years</span>).
_FIELD_RE = re.compile(
    r"^(?:(?:total\s+)?experience\s*[:\-–]?\s*)?(\d{1,2})\s*\+?\s*(?:years?|yrs?)\.?"
    r"(?:\s+(?:of\s+)?experience)?$", re.I)


def _experience_field(soup: BeautifulSoup) -> Optional[int]:
    """The page's own experience field, if it has one — first on the page wins,
    since profile cards sit at the top."""
    for s in soup.find_all(string=True):
        text = " ".join(s.split())
        if 5 <= len(text) <= 32:
            m = _FIELD_RE.match(text)
            if m and 0 < int(m.group(1)) < 70:
                return int(m.group(1))
    return None


async def page_experience(client: httpx.AsyncClient, url: str, last_name: str) -> Optional[int]:
    """Total experience stated on a doctor's page — THE one place this is read,
    used by the scrape, "Find own page", link fixing and "Fetch experience".

    Practo profile → its Redux data. Any other page → a stated experience near
    the doctor's surname; on the doctor's OWN page (name in address or title)
    the whole page counts, since everything on it is about them. A listing
    (`#name-slug`) is only ever read near the name.
    """
    if not url:
        return None
    base = url.split("#")[0]
    if _PRACTO_DOCTOR.search(base):
        return await _practo_profile_years(client, base)
    html = await _fetch_html(client, base)
    if not html:
        return None
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = soup.get_text(" ", strip=True)
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    own = "#" not in url and _is_own_page(base, title, last_name)
    # 1. The profile's own experience field beats prose: Rainbow's card says
    #    "28 Years" while the bio says "experience of 31 years in Pediatrics".
    if own:
        years = _experience_field(soup)
        if years:
            return years
    # 2. A stated experience near the doctor's name (the only thing trusted on a list page).
    years = _near_name(text, last_name)
    if years or not own:
        return years
    # 3. Anywhere on the doctor's own page.
    return _find(text)


def practo_experience_by_name(items: List[Tuple[str, str]], concurrency: int = 4) -> List[Optional[int]]:
    """Sync helper: [(name, city)] -> [years] via Practo's name search (free;
    same unique-match rule as "Fetch experience"). For doctors whose own page
    doesn't state experience or can't be read (Justdial blocks bots)."""
    async def run():
        sem = asyncio.Semaphore(concurrency)
        async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers=HEADERS) as client:
            async def one(name, city):
                async with sem:
                    try:
                        match = await _practo_by_name(name, city)
                        return await _practo_profile_years(client, match["url"]) if match else None
                    except Exception:  # noqa: BLE001
                        return None
            return await asyncio.gather(*(one(n, c) for n, c in items))
    return asyncio.run(run()) if items else []


def experience_for_pages(items: List[Tuple[str, str]], concurrency: int = 6) -> List[Optional[int]]:
    """Sync helper: [(url, surname)] -> [years] — for the scrape's worker thread."""
    async def run():
        sem = asyncio.Semaphore(concurrency)
        async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers=HEADERS) as client:
            async def one(url, last):
                async with sem:
                    try:
                        return await page_experience(client, url, last)
                    except Exception:  # noqa: BLE001
                        return None
            return await asyncio.gather(*(one(u, l) for u, l in items))
    return asyncio.run(run()) if items else []


MAX_PAGE_BYTES = 2_000_000
PAGE_DEADLINE = 20   # seconds for the whole download, not per chunk


async def _fetch_html(client: httpx.AsyncClient, url: str) -> Optional[str]:
    """An HTML page, capped in size and total time. httpx's timeout applies per
    chunk, so a slow 17 MB PDF could otherwise hold a run for minutes (seen
    locally). Non-HTML responses are dropped from the headers alone."""
    async def get():
        async with client.stream("GET", url) as resp:
            if resp.status_code != 200 or "html" not in resp.headers.get("content-type", ""):
                return None
            buf = bytearray()
            async for chunk in resp.aiter_bytes():
                buf.extend(chunk)
                if len(buf) >= MAX_PAGE_BYTES:
                    break
            return buf.decode(resp.encoding or "utf-8", errors="replace")
    try:
        return await asyncio.wait_for(get(), PAGE_DEADLINE)
    except (httpx.HTTPError, asyncio.TimeoutError):
        return None


async def _practo_by_name(name: str, city: str) -> Optional[Dict]:
    """The doctor's Practo profile by name. Their own city first; otherwise the
    major cities — but only when exactly ONE doctor there carries this full name,
    since a Google/X KOL's saved city is often just the city that was searched,
    and a same-named doctor elsewhere must not lend their experience."""
    svc = PractoService()
    clean = re.sub(r"\b(dr\.?|prof\.?)\s*", "", name, flags=re.I).strip()
    want = PractoService._normalize_name(clean)
    if len(want) < 2:
        return None
    if city:
        m = await svc._autocomplete_match(name, clean, city.lower())
        if m and want <= PractoService._normalize_name(m["name"]):
            return m
    from app.services.practo_service import COUNTRY_CITIES
    others = [c for c in COUNTRY_CITIES["india"] if c != (city or "").lower()]
    found = await asyncio.gather(*(svc._autocomplete_match(name, clean, c) for c in others))
    exact = {m["url"]: m for m in found if m and want <= PractoService._normalize_name(m["name"])}
    return next(iter(exact.values())) if len(exact) == 1 else None


def _surname(entry) -> str:
    parts = (entry.last_name or entry.first_name or "").replace("'s", "").split()
    return parts[-1] if parts else ""


async def find_years(entry, client: httpx.AsyncClient, search_keys: Optional[List[Tuple[int, str]]],
                     events: List[Dict]) -> Tuple[Optional[int], Optional[str]]:
    """(years, where it came from) for one KOL row, or (None, None)."""
    years = _find(entry.notes) or _find(getattr(entry, "x_bio", None))
    if years:
        return years, "saved text"

    if entry.practo_profile_url:
        years = await _practo_profile_years(client, entry.practo_profile_url)
        if years:
            return years, "Practo profile"

    last = _surname(entry)
    if entry.web_profile_url:
        years = await _page_years(client, entry.web_profile_url, last)
        if years:
            return years, "source web page"

    name = f"{entry.first_name or ''} {entry.last_name or ''}".replace("'s", "").strip()
    city = (entry.state_city or "").split(",")[0].strip()
    if last and name:
        match = await _practo_by_name(name, city)
        if match:
            years = await _practo_profile_years(client, match["url"])
            if years:
                return years, "Practo (name search)"

    if search_keys is not None and last:
        query = " ".join(p for p in (f'"Dr {name}"', city, "practo") if p)
        # web_search is sync (thread pool inside) — keep it off the event loop.
        results, _ = await asyncio.to_thread(web_search, [query], search_keys, 1, None, events)
        for r in results:
            if _PRACTO_DOCTOR.search(r["url"]) and last.lower() in r["url"].lower():
                years = await _practo_profile_years(client, r["url"])
                if years:
                    return years, "Practo (via search)"
            years = _near_name(f"{r.get('title', '')} {r.get('snippet', '')}", last)
            if years:
                return years, "search result"
    return None, None


def backfill_experience(model, ids: List[int], user_id: Optional[int], use_search: bool = False) -> Dict:
    """Background worker. Fills experience_years on each row that lacks it and
    notes where the number came from. Returns a summary (also logged)."""
    db = SessionLocal()
    summary = {"checked": 0, "filled": 0, "by_source": {}}
    try:
        rows = db.query(model).filter(model.id.in_(ids), model.experience_years.is_(None)).all()
        keys = web_search_keys(db, user_id) if use_search else None
        search_keys = [(cid, k) for cid, k, _ in keys] if keys is not None else None
        scopes = {cid: s for cid, _, s in keys or []}
        events: List[Dict] = []

        async def run_all():
            sem = asyncio.Semaphore(5)
            async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers=HEADERS) as client:
                async def one(row):
                    async with sem:
                        try:
                            return row, *(await find_years(row, client, search_keys, events))
                        except Exception as exc:  # noqa: BLE001 - one bad page must not stop the rest
                            logger.info("Experience lookup failed for %s %s: %s", model.__name__, row.id, exc)
                            return row, None, None
                return await asyncio.gather(*(one(r) for r in rows))

        for row, years, source in asyncio.run(run_all()):
            summary["checked"] += 1
            if years:
                row.experience_years = years
                note = f"Experience {years} yrs (from {source})"
                row.notes = f"{row.notes} | {note}" if row.notes else note
                summary["filled"] += 1
                summary["by_source"][source] = summary["by_source"].get(source, 0) + 1
        db.commit()
        log_usage(events, user_id, "experience", scopes)
        logger.info("Experience backfill %s: %s", model.__name__, summary)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning("Experience backfill failed: %s", exc)
        summary["error"] = str(exc)
    finally:
        db.close()
    summary["finished_at"] = datetime.utcnow().isoformat()
    return summary
