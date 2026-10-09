"""Fill `email` / `contact_no` for scraped KOLs from every source that publishes them.

The scrape sources don't carry contact details (Practo masks them, X has no such
field, Google snippets rarely show them), so after a scrape each new row is looked
up here. The sources run in parallel; per field, the first in this order wins:
  1. text already on the row — notes / X bio;
  2. the web page it was found on (`web_profile_url`);
  3. PubMed — a corresponding author's affiliation ends "Electronic address: …";
     only an author with the same surname AND first name, whose affiliation
     names one of the KOL's places (when known);
  4. ClinicalTrials.gov — a trial's central / site contact by the same full name;
  5. X — the profile's bio, then the website linked on it (their own site); the
     handle is the row's own, or an X profile found by the name search;
  6. a web search by name + city ("contact"): the top result pages, then result
     snippets that name the doctor.

On the doctor's own site (their surname in the domain) any published contact
counts — that IS their contact. Anywhere else (a hospital profile, a directory, a
list page) only a contact within NAME_WINDOW of their name counts, or an address
carrying their name, so a portal's footer or a web designer's address never
passes as the doctor's. `mailto:` / `tel:` links beat numbers read out of prose,
and Cloudflare-obfuscated addresses (`data-cfemail`) are decoded. A value found
for SWITCHBOARD_MIN+ different doctors in one run is a hospital switchboard /
portal line and is dropped.

Nothing is guessed: a KOL whose contact isn't published anywhere stays blank.
"""
import asyncio
import logging
import re
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from urllib.parse import unquote, urlparse

import httpx
from bs4 import BeautifulSoup

from xml.etree import ElementTree

from app.core.database import SessionLocal
from app.services.clinical_trials_service import ClinicalTrialsService
from app.services.experience_backfill import HEADERS, NAME_WINDOW, _fetch_html, _is_own_page, _surname
from app.services.integration_keys import log_usage, web_search_keys
from app.services.kol_enrichment_jobs import pubmed_credentials
from app.services.own_page import _mentions, is_social
from app.services.pubmed_service import PUBMED_FETCH_URL, PUBMED_SEARCH_URL
from app.services.twitter_service import USERS_URL as X_USERS_URL, TwitterSearchError, resolve_bearer
from app.services.web_search_service import web_search

logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# Same shape as the scrape's: an Indian mobile, optionally +91-prefixed.
_MOBILE_RE = re.compile(r"(?:\+91[\s-]?)?\b([6-9]\d{4})[\s-]?(\d{5})\b")
# Addresses that are never a person's: image names ("logo@2x.png"), site-builder
# and error-tracker addresses, template placeholders.
_JUNK_EMAIL = re.compile(
    r"\.(png|jpe?g|gif|webp|svg|css|js)$|@(example|domain|email|yourdomain|sentry|"
    r"[\w.-]*sentry\.io|wixpress|[\w.-]*\.wix|godaddy)\b|^(no-?reply|donotreply|test|user|name)@", re.I)
# Role addresses — a site's front desk. Only the doctor's when it's their own site.
_ROLE_EMAIL = re.compile(
    r"^(info|contact|contactus|hello|care|help|helpdesk|support|admin|enquir\w*|inquir\w*|"
    r"appointments?|booking|office|mail|sales|marketing|hr|careers|feedback|reception|team|admissions?|editor\w*)\d*@", re.I)
# Results not worth opening: masked (Practo), bot-blocked (Justdial) or not pages.
_SKIP_PAGES = ("practo.com", "justdial.com", "lybrate.com")
RESULT_PAGES = 3   # result pages opened per KOL from the name search
SWITCHBOARD_MIN = 3


def _cf_decode(hexstr: str) -> Optional[str]:
    """Cloudflare's email protection: first byte is the XOR key for the rest."""
    try:
        key = int(hexstr[:2], 16)
        return "".join(chr(int(hexstr[i:i + 2], 16) ^ key) for i in range(2, len(hexstr), 2))
    except ValueError:
        return None


def _clean_email(raw: str) -> Optional[str]:
    e = unquote(raw).split("?")[0].strip().strip(".").lower()
    return e if _EMAIL_RE.fullmatch(e) and not _JUNK_EMAIL.search(e) else None


def _clean_phone(raw: str) -> Optional[str]:
    """A tel: link's number as bare digits — Indian mobile or landline. Toll-free
    1800 lines are a hospital's call centre, not the doctor's."""
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("0091"):
        digits = digits[4:]
    elif digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    if digits.startswith("1800"):
        return None
    if len(digits) == 10 and digits[0] in "6789":
        return digits
    if len(digits) == 11 and digits.startswith("0"):   # STD landline "01212765432"
        return digits
    return None


def _text_contacts(text: str) -> Tuple[List[str], List[str]]:
    emails = [e for e in (_clean_email(m) for m in _EMAIL_RE.findall(text or "")) if e]
    phones = [f"{m.group(1)}{m.group(2)}" for m in _MOBILE_RE.finditer(text or "")]
    return emails, phones


def _near_name(text: str, last: str) -> Tuple[List[str], List[str]]:
    """Contacts within NAME_WINDOW of each mention of the surname."""
    emails: List[str] = []
    phones: List[str] = []
    if not last or len(last) < 3:
        return emails, phones
    for m in re.finditer(re.escape(last), text or "", re.I):
        e, p = _text_contacts(text[max(0, m.start() - NAME_WINDOW[0]): m.end() + NAME_WINDOW[1]])
        emails += e
        phones += p
    return emails, phones


def _pick_email(emails: List[str], tokens: List[str]) -> Optional[str]:
    """The address carrying the doctor's name, else the first one."""
    for e in emails:
        local = e.split("@")[0]
        if any(t in local for t in tokens if len(t) >= 3):
            return e
    return emails[0] if emails else None


def _named(email: str, tokens: List[str]) -> bool:
    local = email.split("@")[0]
    return any(t in local for t in tokens if len(t) >= 3)


def page_contacts(html: str, url: str, last: str, tokens: List[str],
                  places: Optional[List[str]] = None, own: bool = False) -> Tuple[Optional[str], Optional[str]]:
    """(email, phone) published on one page for this doctor. With `places` (a page
    found by searching their name) the page must name them in full and mention
    one of their places — a same-named doctor elsewhere must not lend their number.
    `own`: the doctor linked this site themselves (their X profile's website)."""
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    domain = urlparse(url).netloc.lower().removeprefix("www.")
    # "drkishorepandit.com", "drvarshaliclinic.com" — their name in the domain.
    own_site = own or any(len(t) >= 4 and t in domain for t in tokens)
    about = own_site or _is_own_page(url, title, last)

    # Links first — an explicit mailto:/tel: is the page saying "this is the contact".
    link_emails, link_phones = [], []
    for el in soup.select("[data-cfemail]"):
        e = _clean_email(_cf_decode(el["data-cfemail"]) or "")
        if e:
            el.replace_with(e)   # so the text pass below sees it next to the name
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.lower().startswith("mailto:"):
            e = _clean_email(href[7:])
            if e:
                link_emails.append(e)
        elif href.lower().startswith("tel:"):
            p = _clean_phone(href[4:])
            if p:
                link_phones.append(p)

    for s in soup(["script", "style", "noscript"]):
        s.decompose()
    text = " ".join(soup.get_text(" ").split())
    if places is not None and not (
            _mentions(f"{url.replace('-', ' ')} {title} {text[:5000]}", tokens)
            and (not places or any(p.lower() in text.lower() for p in places))):
        return None, None
    t_emails, t_phones = _text_contacts(text)
    n_emails, n_phones = _near_name(text, last)
    near = set(n_emails) | set(n_phones)

    if own_site:
        emails = [e for e in link_emails + t_emails
                  if _named(e, tokens) or e.split("@")[1].removeprefix("www.") == domain or e in near]
        phones = link_phones + t_phones
    else:
        # An address with their name on a page about them counts; otherwise only
        # what sits next to their name (a link counts when it's in that window).
        # The site's own address or a role address (care@<portal>, info@<hospital>)
        # is theirs, not the doctor's, unless it carries the doctor's name.
        emails = [e for e in link_emails + t_emails if (about and _named(e, tokens))] \
            + [e for e in [*link_emails, *n_emails]
               if e in near and e.split("@")[1] != domain and not _ROLE_EMAIL.match(e)]
        phones = [p for p in link_phones if p in near] + n_phones
    return _pick_email(emails, tokens), (phones[0] if phones else None)


def _tokens(entry) -> List[str]:
    return [t.lower() for t in re.findall(r"[A-Za-z]+", f"{entry.first_name or ''} {entry.last_name or ''}")
            if len(t) > 1]


Hit = Tuple[str, Optional[str], Optional[str]]   # (where, email, phone)


async def _ncbi_get(client: httpx.AsyncClient, url: str, params: Dict) -> httpx.Response:
    """NCBI answers 429 past its per-second limit — wait and retry a few times."""
    for attempt in range(4):
        r = await client.get(url, params=params, timeout=30)
        if r.status_code != 429:
            return r
        await asyncio.sleep(1 + attempt)
    return r


async def _pubmed_hits(client: httpx.AsyncClient, first: str, last: str, places: List[str],
                       api_key: str, sem: asyncio.Semaphore) -> List[Hit]:
    """The address in this author's own PubMed affiliation, most recent paper first."""
    if len(first) < 2 or len(last) < 2:
        return []
    params = {"db": "pubmed", "term": f'"{last} {first}"[Author]', "retmax": 25,
              "retmode": "json", "sort": "date"}
    if api_key:
        params["api_key"] = api_key
    try:
        async with sem:   # NCBI allows 3 req/s keyless, 10 with a key
            r = await _ncbi_get(client, PUBMED_SEARCH_URL, params)
            ids = r.json().get("esearchresult", {}).get("idlist", []) if r.status_code == 200 else []
            if not ids:
                return []
            fetch = {"db": "pubmed", "id": ",".join(ids), "retmode": "xml"}
            if api_key:
                fetch["api_key"] = api_key
            r = await _ncbi_get(client, PUBMED_FETCH_URL, fetch)
        root = ElementTree.fromstring(r.text) if r.status_code == 200 else None
    except (httpx.HTTPError, ValueError, ElementTree.ParseError):
        return []
    for art in (root.findall(".//PubmedArticle") if root is not None else []):
        pmid = art.findtext(".//PMID", "")
        for au in art.findall(".//AuthorList/Author"):
            fore = (au.findtext("ForeName") or "").lower().split()
            if (au.findtext("LastName") or "").lower() != last or not fore or fore[0] != first:
                continue
            affs = " ".join(a.text or "" for a in au.findall(".//AffiliationInfo/Affiliation"))
            if places and not any(p.lower() in affs.lower() for p in places):
                continue
            emails = _text_contacts(affs)[0]
            if emails:
                return [(f"PubMed PMID {pmid}", _pick_email(emails, [first, last]), None)]
    return []


async def _ctgov_hits(plain: str, tokens: List[str], places: List[str]) -> List[Hit]:
    """A ClinicalTrials.gov central / site contact with this full name — at a site
    in one of the KOL's places (when known): a same-named investigator abroad is
    someone else."""
    svc = ClinicalTrialsService()
    params = {"query.term": f'"{plain}"', "pageSize": 30, "format": "json"}
    data = await svc._fetch_with_httpx(params)
    if data is None:
        data = await asyncio.to_thread(svc._fetch_with_curl, params)
    for study in (data or {}).get("studies", []):
        proto = study.get("protocolSection", {})
        nct = proto.get("identificationModule", {}).get("nctId", "")
        cl = proto.get("contactsLocationsModule", {})
        locs = cl.get("locations") or []

        def where(*ls):
            return " ".join(f"{l.get('city', '')} {l.get('state', '')}" for l in ls).lower()
        # Central contacts belong to the whole study; a site contact to its site.
        contacts = [(c, where(*locs)) for c in cl.get("centralContacts") or []]
        for loc in locs:
            contacts += [(c, where(loc)) for c in loc.get("contacts") or []]
        for c, place_text in contacts:
            if not _mentions(c.get("name") or "", tokens):
                continue
            if places and not any(p.lower() in place_text for p in places):
                continue
            e = _clean_email(c.get("email") or "")
            p = _clean_phone(c.get("phone") or "")
            if e or p:
                return [(f"ClinicalTrials.gov {nct}", e, p)]
    return []


_X_PROFILE = re.compile(r"^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})(?:[/?#]|$)", re.I)
_X_RESERVED = {"search", "hashtag", "home", "explore", "i", "intent", "share", "status", "login"}


def _x_user(bearer: str, handle: str) -> Optional[dict]:
    """Bio + website of one X profile. Raises TwitterSearchError on 401/402/429."""
    with httpx.Client(timeout=20) as c:
        r = c.get(X_USERS_URL.format(handle=handle),
                  params={"user.fields": "name,description,url,entities"},
                  headers={"Authorization": f"Bearer {bearer}"})
    if r.status_code in (401, 402, 429):
        raise TwitterSearchError(f"X returned {r.status_code}")
    return (r.json() or {}).get("data") if r.status_code == 200 else None


def _source_label(where: str) -> str:
    """For the summary: a page's domain, else the source's name ("PubMed", "X")."""
    return urlparse(where).netloc.removeprefix("www.") if where.startswith("http") else where.split(" ")[0]


async def find_contact(entry, client: httpx.AsyncClient, search_keys: Optional[List[Tuple[int, str]]],
                       events: List[Dict], pubmed_key: str = "", pubmed_sem: Optional[asyncio.Semaphore] = None,
                       x_state: Optional[Dict] = None) -> List[Hit]:
    """Every contact found for one KOL row, best source first (see module doc).
    The caller takes the first email and the first phone that survive its checks."""
    hits: List[Hit] = []

    def have() -> bool:
        return bool((entry.email or any(h[1] for h in hits)) and (entry.contact_no or any(h[2] for h in hits)))

    last = _surname(entry)
    tokens = _tokens(entry)
    for text in (entry.notes, getattr(entry, "x_bio", None)):
        e, p = _text_contacts(text or "")
        if e or p:
            hits.append(("saved text", _pick_email(e, tokens), p[0] if p else None))

    opened = set()

    async def from_page(url: str, places: Optional[List[str]] = None, own: bool = False) -> List[Hit]:
        page = url.split("#")[0]
        if not page.startswith("http") or page in opened or is_social(page) \
                or any(s in page for s in _SKIP_PAGES):
            return []
        opened.add(page)
        html = await _fetch_html(client, page)
        if not html:
            return []
        e, p = page_contacts(html, page, last, tokens, places, own)
        return [(page, e, p)] if e or p else []

    if entry.web_profile_url:
        hits += await from_page(entry.web_profile_url)
    if have():
        return hits

    name = f"{entry.first_name or ''} {entry.last_name or ''}".replace("'s", "").strip()
    plain = re.sub(r"\s+", " ", name.replace(".", " ")).strip()
    city = (entry.state_city or "").split(",")[0].strip()
    # "Malviya Nagar, Delhi" — the page must mention any of them ("EARTH", "🇮🇳" from an
    # X profile can't be checked, but non-letters are dropped).
    places = [p.strip() for p in (entry.state_city or "").split(",") if re.search(r"[A-Za-z]{3}", p)]
    first = (re.findall(r"[A-Za-z]{2,}", entry.first_name or "") or [""])[0].lower()
    bearer = (x_state or {}).get("bearer")
    x_handle = (getattr(entry, "x_username", None) or "").lstrip("@")

    async def search() -> Tuple[List[Hit], List[Hit]]:
        """(X hits, web hits) — the X profile may come from this same search."""
        results: List[Dict] = []
        if search_keys is not None and last and name:
            queries = [" ".join(p for p in (f'"Dr {plain}"', city, "contact") if p)]
            if bearer and not x_handle:
                queries.append(f'"{plain}" doctor twitter')
            # web_search is sync (thread pool inside) — keep it off the event loop.
            results, _ = await asyncio.to_thread(web_search, queries, search_keys, 1, None, events)
        return await asyncio.gather(x_hits(results), web_hits(results))

    async def x_hits(results: List[Dict]) -> List[Hit]:
        handle, trusted = x_handle, bool(x_handle)
        if not handle:
            for r in results:
                m = _X_PROFILE.match(r.get("url") or "")
                if m and m.group(1).lower() not in _X_RESERVED and _mentions(r.get("title") or "", tokens):
                    handle = m.group(1)
                    break
        if not (handle and bearer) or x_state.get("dead"):
            return []
        try:
            user = await asyncio.to_thread(_x_user, bearer, handle)
        except (TwitterSearchError, httpx.HTTPError) as exc:
            x_state["dead"] = True   # out of credits / rate-limited: stop asking for this run
            logger.info("X lookup stopped: %s", exc)
            return []
        if not user or not (trusted or _mentions(user.get("name") or "", tokens)):
            return []
        out: List[Hit] = []
        e, p = _text_contacts(user.get("description") or "")
        if e or p:
            out.append((f"X @{handle} bio", _pick_email(e, tokens), p[0] if p else None))
        urls = ((user.get("entities") or {}).get("url") or {}).get("urls") or []
        site = (urls[0].get("expanded_url") if urls else None) or user.get("url")
        if site and not is_social(site):
            out += [(f"{w} (linked from X @{handle})", e, p) for w, e, p in await from_page(site, own=True)]
        return out

    async def web_hits(results: List[Dict]) -> List[Hit]:
        out: List[Hit] = []
        # Pages about the doctor first (name in address or title), then the rest.
        ranked = sorted(results, key=lambda r: not _is_own_page(r.get("url") or "", r.get("title") or "", last))
        tries = 0
        for r in ranked:
            if tries >= RESULT_PAGES or (any(h[1] for h in out) and any(h[2] for h in out)):
                break
            url = r.get("url") or ""
            if url.split("#")[0] in opened or is_social(url) or any(s in url for s in _SKIP_PAGES):
                continue
            tries += 1
            out += await from_page(url, places)
        # Last resort: a result snippet that states it next to their name.
        for r in results:
            url = r.get("url") or ""
            if is_social(url) or any(s in url for s in _SKIP_PAGES):
                continue
            e, p = _near_name(f"{r.get('title', '')} {r.get('snippet', '')}", last)
            e = [x for x in e if _named(x, tokens) or not _ROLE_EMAIL.match(x)]
            if e or p:
                out.append((url or "search result", _pick_email(e, tokens), p[0] if p else None))
        return out

    async def nothing() -> List[Hit]:
        return []

    pubmed, ctgov, (x_found, web_found) = await asyncio.gather(
        _pubmed_hits(client, first, last.lower(), places, pubmed_key, pubmed_sem or asyncio.Semaphore(3))
        if first and last else nothing(),
        _ctgov_hits(plain, tokens, places) if len(tokens) >= 2 else nothing(),
        search(),
    )
    return hits + pubmed + ctgov + x_found + web_found


def find_contacts(model, ids: List[int], user_id: Optional[int], use_search: bool = True) -> Dict:
    """Background worker. Fills email / contact_no on each row missing either and
    notes where they came from. `use_search` also searches each KOL by name (the
    account's SerpAPI keys first, then the free providers). PubMed and
    ClinicalTrials.gov are always asked; X when the account has a bearer token.
    Returns a summary."""
    db = SessionLocal()
    summary = {"checked": 0, "email": 0, "phone": 0, "by_source": {}}
    try:
        rows = [r for r in db.query(model).filter(model.id.in_(ids)).all()
                if not (r.email and r.contact_no)]
        keys = web_search_keys(db, user_id) if use_search else None
        search_keys = [(cid, k) for cid, k, _ in keys] if keys is not None else None
        scopes = {cid: s for cid, _, s in keys or []}
        pubmed_key, _ = pubmed_credentials(db)
        x_state = {"bearer": resolve_bearer(db, user_id) if user_id else None, "dead": False}
        events: List[Dict] = []

        async def run_all():
            sem = asyncio.Semaphore(5)
            pubmed_sem = asyncio.Semaphore(3)
            async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers=HEADERS) as client:
                async def one(row):
                    async with sem:
                        try:
                            return row, await find_contact(row, client, search_keys, events,
                                                           pubmed_key, pubmed_sem, x_state)
                        except Exception as exc:  # noqa: BLE001 - one bad page must not stop the rest
                            logger.info("Contact lookup failed for %s %s: %s", model.__name__, row.id, exc)
                            return row, []
                return await asyncio.gather(*(one(r) for r in rows))

        found = asyncio.run(run_all())
        # The same number / address for several different doctors is the
        # hospital's or portal's line, not theirs.
        seen: Dict[str, set] = {}
        for row, hits in found:
            for _, e, p in hits:
                for v in (e, p):
                    if v:
                        seen.setdefault(v, set()).add(row.id)
        # Count KOLs that already carry the value too, so a small re-run still
        # recognises a line many earlier rows got.
        run_ids = [r.id for r, _ in found]
        for col in (model.email, model.contact_no):
            vals = [v for v in seen if v]
            for rid, v in db.query(model.id, col).filter(col.in_(vals or [""]), ~model.id.in_(run_ids or [-1])):
                seen[v].add(rid)
        shared = {v for v, rows_ in seen.items() if len(rows_) >= SWITCHBOARD_MIN}
        for row, hits in found:
            summary["checked"] += 1
            email = next(((w, e) for w, e, _ in hits if e and e not in shared), None)
            phone = next(((w, p) for w, _, p in hits if p and p not in shared), None)
            notes = []
            for field, label, pick in (("email", "Email", email), ("contact_no", "Phone", phone)):
                if pick and not getattr(row, field):
                    setattr(row, field, pick[1][:255 if field == "email" else 120])
                    summary["email" if field == "email" else "phone"] += 1
                    src = _source_label(pick[0])
                    summary["by_source"][src] = summary["by_source"].get(src, 0) + 1
                    notes.append(f"{label} from: {pick[0]}")
            if notes:
                note = " | ".join(notes)
                row.notes = f"{row.notes} | {note}" if row.notes else note
        db.commit()
        log_usage(events, user_id, "find_kols", scopes)
        logger.info("Contact lookup %s: %s", model.__name__, summary)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning("Contact lookup failed: %s", exc)
        summary["error"] = str(exc)
    finally:
        db.close()
    summary["finished_at"] = datetime.utcnow().isoformat()
    return summary
