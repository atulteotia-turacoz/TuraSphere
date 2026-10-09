"""A Google-found doctor's OWN page, when the name was only seen on a listing.

`extract_doctors` takes names from two places: a result's title (a page about
that doctor — the URL is theirs) and a result's snippet (a listing page such as
"Best Paediatricians in Meerut" that names several doctors). A snippet name is
saved as `listing_url#name-slug`, so its link opened the whole list.

Two ways to get the doctor's own page:
  * `resolve_listing_links` (free, at scrape time): open the listing and follow
    the link whose text / address carries the doctor's name. Works for ordinary
    hospital & directory sites; Justdial serves bots an empty page, so it can't.
  * `find_own_page` (on demand, one web search): search the doctor by name and
    pick their own page — same site as the listing first, then doctor-profile
    sites; social posts only as a last resort.
"""
import asyncio
import logging
import re
from typing import Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from app.services.web_search_service import HEADERS, web_search

logger = logging.getLogger(__name__)

SOCIAL = ("instagram.com", "facebook.com", "youtube.com", "twitter.com", "x.com", "linkedin.com/posts")
# Sites whose per-doctor pages are useful profiles.
PROFILE_HINTS = ("/doctor/", "/doctors/", "/dr-", "/Dr-", "/profile", "/consultant")


def is_social(url: Optional[str]) -> bool:
    return bool(url) and any(s in url.lower() for s in SOCIAL)


def is_listing(url: Optional[str]) -> bool:
    """Our convention: a snippet-derived (listing) link carries `#name-slug`."""
    return bool(url) and "#" in url


def _tokens(name: str) -> List[str]:
    clean = re.sub(r"\b(dr|prof)\.?\s*", "", name or "", flags=re.I)
    return [t.lower() for t in re.findall(r"[A-Za-z]+", clean) if len(t) > 1]


def _mentions(text: str, tokens: List[str]) -> bool:
    low = (text or "").lower()
    return bool(tokens) and all(t in low for t in tokens)


def _domain(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


# ── Free: follow the link next to the name on the listing page ──

async def _resolve_one(client: httpx.AsyncClient, page_url: str, names: List[str]) -> Dict[str, str]:
    """name -> own URL, for the names found on one listing page."""
    try:
        resp = await asyncio.wait_for(client.get(page_url), 10)
    except (httpx.HTTPError, asyncio.TimeoutError):
        return {}
    if resp.status_code != 200 or "html" not in resp.headers.get("content-type", "") or len(resp.text) < 500:
        return {}   # Justdial & co. answer bots with an empty shell
    soup = BeautifulSoup(resp.text[:2_000_000], "html.parser")
    listing = page_url.split("#")[0].rstrip("/")
    links = []
    for a in soup.find_all("a", href=True):
        href = urljoin(page_url, a["href"]).split("#")[0]
        if not href.startswith("http") or href.rstrip("/") == listing:
            continue
        links.append((href, a.get_text(" ", strip=True)))
    found = {}
    for name in names:
        tokens = _tokens(name)
        # Best: the doctor's name is in the link's address — a page about them
        # (".../dr-rekha-mittal-pediatric-neurologist"). Query-string variants
        # ("?t=vc") are the same page; take the plain one.
        def spaced(t):
            return t.replace("-", " ").replace("_", " ").replace("/", " ").replace(".", " ")
        by_path = sorted({h.split("?")[0] for h, _ in links
                          if _mentions(spaced(urlparse(h).path), tokens)}, key=len)
        if by_path:
            found[name] = by_path[0]
            continue
        # The name is the site itself (drniveditadadu.com): their own website —
        # link its home page, not whichever page ("book-an-appointment") came first.
        own_sites = {f"{urlparse(h).scheme}://{urlparse(h).netloc}/" for h, _ in links
                     if _mentions(spaced(_domain(h)), tokens)
                     or _mentions(_domain(h), ["".join(tokens)])}
        if own_sites:
            found[name] = sorted(own_sites, key=len)[0]
            continue
        # Next: the link text names them, and the address looks like a profile —
        # not "book an appointment" / "contact" next to the name.
        for href, text in links:
            if _mentions(text, tokens) and any(h in href for h in PROFILE_HINTS) \
                    and not re.search(r"book|appointment|contact|enquir|call", href, re.I):
                found[name] = href.split("?")[0]
                break
    return found


def resolve_listing_links(docs: List[Dict], max_pages: int = 8) -> None:
    """In place: give snippet-derived doctors their own page where the listing
    links to it. Unresolved ones keep the `#name-slug` listing link."""
    pages: Dict[str, List[Dict]] = {}
    for d in docs:
        if is_listing(d.get("url")):
            pages.setdefault(d["page_url"], []).append(d)
    if not pages:
        return

    async def run():
        async with httpx.AsyncClient(timeout=10, follow_redirects=True, headers=HEADERS) as client:
            items = list(pages.items())[:max_pages]
            results = await asyncio.gather(*(_resolve_one(client, url, [d["name"] for d in ds]) for url, ds in items))
            return dict(zip([u for u, _ in items], results))

    try:
        resolved = asyncio.run(run())
    except Exception as exc:  # noqa: BLE001 - best effort
        logger.info("Listing link resolution skipped: %s", exc)
        return
    for page_url, by_name in resolved.items():
        for d in pages[page_url]:
            own = by_name.get(d["name"])
            if own:
                d["url"] = own


# ── On demand: search the doctor by name ──

def pick_own_page(results: List[Dict], name: str, prefer_domain: str = "", city: str = "") -> Optional[str]:
    tokens = _tokens(name)
    city_l = (city or "").lower().strip()
    scored: List[Tuple[int, str]] = []
    for r in results:
        url = r.get("url") or ""
        haystack = f"{r.get('title', '')} {url.replace('-', ' ')}"
        if not url or not _mentions(haystack, tokens):
            continue
        score = 0
        if prefer_domain and _domain(url) == prefer_domain:
            score += 50
        if any(h in url for h in PROFILE_HINTS):
            score += 20
        if _mentions(url.replace("-", " ").replace("_", " "), tokens):
            score += 15   # the name is in the address — a page about them
        if any(s in url for s in SOCIAL):
            score -= 40
        # Same name, different doctor: a page in the searched city is far likelier
        # to be them ("G. Harshitha" in Meerut vs a Hyderabad homeo clinic).
        if city_l and city_l in f"{url} {r.get('title', '')} {r.get('snippet', '')}".lower():
            score += 30
        scored.append((score, url))
    scored.sort(key=lambda s: -s[0])
    return scored[0][1] if scored else None


def find_own_page(name: str, city: str, listing_url: str,
                  keys: List[Tuple[int, str]], events: List[Dict]) -> Optional[str]:
    # "G. Harshitha" inside an exact phrase misses "G Harshitha" — drop the dots.
    plain = re.sub(r"\s+", " ", name.replace(".", " ")).strip()
    query = " ".join(p for p in (f'"Dr {plain}"', city) if p)
    results, _ = web_search([query], keys, pages=1, events=events)
    return pick_own_page(results, name, _domain(listing_url) if listing_url else "", city)


# ── Bulk: fix the listing links of saved KOLs ──

def fix_listing_links(model, ids: List[int], user_id: Optional[int], use_search: bool = False) -> Dict:
    """Background worker for saved KOLs whose link is a listing page.

    1. free: re-open each listing and follow the link next to the doctor's name;
    2. then a web search by name — with the account's SerpAPI keys when
       `use_search`, otherwise the free providers only (often rate-limited).
    The listing is kept in notes as "Listed on: …". Returns a summary.
    """
    from app.core.database import SessionLocal
    from app.services.integration_keys import log_usage, web_search_keys

    db = SessionLocal()
    summary = {"checked": 0, "fixed": 0, "by": {}}
    try:
        rows = [r for r in db.query(model).filter(model.id.in_(ids)).all() if is_listing(r.web_profile_url)]
        summary["checked"] = len(rows)

        def name_of(r):
            return f"Dr. {r.first_name or ''} {r.last_name or ''}".replace("'s", "").strip()

        docs = [{"row": r, "name": name_of(r), "page_url": r.web_profile_url.split("#")[0],
                 "url": r.web_profile_url} for r in rows]
        resolve_listing_links(docs, max_pages=50)

        key_rows = web_search_keys(db, user_id) if use_search else []
        keys = [(c, k) for c, k, _ in key_rows]
        events: List[Dict] = []
        for d in docs:
            how = "listing page"
            if is_listing(d["url"]):
                city = (d["row"].state_city or "").split(",")[0].strip()
                own = find_own_page(d["name"].removeprefix("Dr. "), city, d["page_url"], keys, events)
                if not own:
                    continue
                d["url"], how = own, "web search"
            r = d["row"]
            r.web_profile_url = d["url"][:500]
            note = f"Listed on: {d['page_url']}"
            if r.experience_years is None:
                from app.services.experience_backfill import experience_for_pages
                years = experience_for_pages([(d["url"], d["name"].split()[-1])])[0]
                if years:
                    r.experience_years = years
                    note += f" | Experience {years} yrs (from own page)"
                    summary["experience"] = summary.get("experience", 0) + 1
            r.notes = f"{r.notes} | {note}" if r.notes else note
            summary["fixed"] += 1
            summary["by"][how] = summary["by"].get(how, 0) + 1
        db.commit()
        log_usage(events, user_id, "find_kols", {c: s for c, _, s in key_rows})
        logger.info("Listing-link fix %s: %s", model.__name__, summary)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning("Listing-link fix failed: %s", exc)
        summary["error"] = str(exc)
    finally:
        db.close()
    return summary
