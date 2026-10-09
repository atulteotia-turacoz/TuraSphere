"""Web search for the Find KOLs "Google" method.

Provider chain, so a search never stops because one provider ran dry:

1. **SerpAPI** (real Google results) — every active key configured by the super
   admin under Admin → Google Search, default first. A key that is invalid or out
   of searches is dropped for the rest of the run and the next key is tried.
2. **Brave Search** (free, no key) — scraped from its HTML results page.
3. **DuckDuckGo** (free, no key) — last resort; it often answers bots with 202.

Results are web pages, not a doctor roster, so `extract_doctors` pulls
"Dr. First Last" names out of each result's title (a per-doctor page) and
snippet (a listing page that names several doctors).
"""
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional, Tuple

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

SERPAPI_URL = "https://serpapi.com/search.json"
BRAVE_URL = "https://search.brave.com/search"
DDG_URL = "https://html.duckduckgo.com/html/"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

PROVIDER_LABELS = {"serpapi": "Google (SerpAPI)", "brave": "Brave Search", "ddg": "DuckDuckGo"}


class ProviderError(Exception):
    """A provider couldn't answer. `dead` means don't try this key/provider again
    in the same run (bad key, quota used up, blocked)."""

    def __init__(self, message: str, dead: bool = False):
        super().__init__(message)
        self.dead = dead


# ── Providers ────────────────────────────────────────────────────

def _serpapi(client: httpx.Client, api_key: str, query: str, page: int, gl: Optional[str]) -> List[Dict]:
    params = {"engine": "google", "q": query, "api_key": api_key, "num": 10,
              "start": page * 10, "hl": "en"}
    if gl:
        params["gl"] = gl
    resp = client.get(SERPAPI_URL, params=params)
    try:
        data = resp.json()
    except ValueError:
        data = {}
    err = data.get("error") or ""
    # 401 = bad key, 429 = out of searches / throttled. SerpAPI also reports the
    # quota as a 200 with an "error" body on some plans.
    if resp.status_code in (401, 403, 429) or "run out" in err.lower() or "invalid api key" in err.lower():
        raise ProviderError(err or f"SerpAPI returned {resp.status_code}", dead=True)
    if resp.status_code != 200:
        raise ProviderError(err or f"SerpAPI returned {resp.status_code}")
    if err and "hasn't returned any results" in err:
        return []
    if err:
        raise ProviderError(err)
    return [{"title": r.get("title") or "", "url": r.get("link") or "", "snippet": r.get("snippet") or ""}
            for r in data.get("organic_results") or [] if r.get("link")]


def _brave(client: httpx.Client, query: str, page: int) -> List[Dict]:
    params = {"q": query, "source": "web"}
    if page:
        params["offset"] = page
    resp = client.get(BRAVE_URL, params=params, headers=HEADERS)
    if resp.status_code == 429:
        raise ProviderError("Brave rate-limited the search", dead=True)
    if resp.status_code != 200:
        raise ProviderError(f"Brave returned {resp.status_code}")
    soup = BeautifulSoup(resp.text, "html.parser")
    out = []
    for item in soup.select('div.snippet[data-type="web"]'):
        link = item.select_one('a[href^="http"]')
        title = item.select_one(".title")
        desc = item.select_one(".snippet-description, .generic-snippet .content, .description")
        if not link:
            continue
        out.append({
            "title": title.get_text(" ", strip=True) if title else "",
            "url": link.get("href") or "",
            "snippet": desc.get_text(" ", strip=True) if desc else "",
        })
    if not out and "captcha" in resp.text.lower():
        raise ProviderError("Brave asked for a captcha", dead=True)
    return out


def _ddg(client: httpx.Client, query: str, page: int) -> List[Dict]:
    if page:
        return []   # the HTML endpoint's paging needs a form token; one page is enough
    resp = client.post(DDG_URL, data={"q": query}, headers=HEADERS)
    if resp.status_code != 200:
        raise ProviderError(f"DuckDuckGo returned {resp.status_code}", dead=True)
    soup = BeautifulSoup(resp.text, "html.parser")
    out = []
    for item in soup.select(".result"):
        link = item.select_one("a.result__a")
        snip = item.select_one(".result__snippet")
        if link and link.get("href"):
            out.append({"title": link.get_text(" ", strip=True), "url": link["href"],
                        "snippet": snip.get_text(" ", strip=True) if snip else ""})
    return out


def web_search(
    queries: List[str],
    serpapi_keys: List[Tuple[int, str]],
    pages: int = 2,
    gl: Optional[str] = None,
    events: Optional[List[Dict]] = None,
) -> Tuple[List[Dict], List[str]]:
    """Run every (query, page) through the provider chain **in parallel**, so one
    slow SerpAPI call doesn't hold the others up.

    `serpapi_keys` is [(config_id, key)], tried in order. Returns (results, notes):
    every result carries `provider`, and the notes say which providers answered
    or were skipped. Each provider call is appended to `events` (for the usage
    log) — plain dicts, written to the DB by the caller on its own thread.
    """
    keys = [(cid, k) for cid, k in serpapi_keys if k]
    lock = threading.Lock()
    dead_keys: set = set()
    dead_free: set = set()
    used: Dict[str, int] = {}
    key_errors: List[str] = []
    events = events if events is not None else []

    def record(provider, config_id, query, page, status, n=0, error=None):
        with lock:
            events.append({"provider": provider, "config_id": config_id, "query": query[:500],
                           "page": page, "status": status, "results": n,
                           "error": (error or "")[:255] or None})

    def run(query: str, page: int) -> List[Dict]:
        with httpx.Client(timeout=25, follow_redirects=True) as client:
            for cid, key in keys:
                if key in dead_keys:
                    continue
                try:
                    got = _serpapi(client, key, query, page, gl)
                    record("serpapi", cid, query, page, "ok", len(got))
                    return [{**r, "provider": "serpapi"} for r in got]
                except (ProviderError, httpx.HTTPError) as exc:
                    dead = getattr(exc, "dead", False)
                    logger.warning("SerpAPI key %s… failed: %s", key[:6], exc)
                    record("serpapi", cid, query, page, "quota" if dead else "error", error=str(exc) or exc.__class__.__name__)
                    if dead:
                        with lock:
                            dead_keys.add(key)
                            key_errors.append(str(exc))
                        continue   # try the next key
                    break          # transient error: go to the free chain for this page

            for name, fn in (("brave", _brave), ("ddg", _ddg)):
                if name in dead_free:
                    continue
                try:
                    got = fn(client, query, page)
                    record(name, None, query, page, "ok", len(got))
                    return [{**r, "provider": name} for r in got]
                except (ProviderError, httpx.HTTPError) as exc:
                    logger.warning("%s search failed: %s", name, exc)
                    record(name, None, query, page, "error", error=str(exc) or exc.__class__.__name__)
                    if getattr(exc, "dead", True):
                        with lock:
                            dead_free.add(name)
            return []

    jobs = [(q, p) for q in queries for p in range(pages)]
    results: List[Dict] = []
    with ThreadPoolExecutor(max_workers=max(1, min(len(jobs), 6))) as pool:
        for got in pool.map(lambda j: run(*j), jobs):
            for r in got:
                used[r["provider"]] = used.get(r["provider"], 0) + 1
            results.extend(got)

    notes: List[str] = []
    if not keys:
        notes.append("Google search: no SerpAPI key is configured, so the free fallback was used.")
    elif dead_keys:
        detail = f" ({key_errors[-1]})" if key_errors else ""
        if len(dead_keys) == len(keys):
            notes.append(f"Google search: SerpAPI is unavailable{detail}, so the free fallback was used.")
        else:
            notes.append(f"Google search: {len(dead_keys)} SerpAPI key(s) unavailable{detail}; used the next key.")
    if used:
        notes.append("Web results from " + ", ".join(PROVIDER_LABELS[p] for p in used) + ".")
    elif queries:
        notes.append("Google search returned nothing — every provider failed or found no pages.")
    return results, notes


def serpapi_account(api_key: str) -> Dict:
    """Live plan + usage for one key from SerpAPI's account API (costs no search credit)."""
    try:
        resp = httpx.get("https://serpapi.com/account.json", params={"api_key": api_key}, timeout=15)
        data = resp.json()
    except Exception as exc:  # noqa: BLE001
        return {"error": f"Could not reach SerpAPI: {exc.__class__.__name__}"}
    if resp.status_code != 200 or data.get("error"):
        return {"error": data.get("error") or f"SerpAPI returned {resp.status_code}"}
    fields = ("account_email", "account_status", "plan_name", "plan_monthly_price",
              "plan_renewal_date", "searches_per_month", "plan_searches_left", "extra_credits",
              "total_searches_left", "this_month_usage", "this_hour_searches",
              "last_hour_searches", "account_rate_limit_per_hour")
    return {f: data.get(f) for f in fields}


# ── Doctor extraction ────────────────────────────────────────────

# "Dr. Munish Paul", "Dr Nivedita Dadu", "Dr.Rohit Batra", "Dr. A. K. Sharma".
_DR_RE = re.compile(r"\bD[Rr]\.?\s*((?:[A-Z][A-Za-z'’\-]*\.?\s*){1,5})")
_TOKEN_RE = re.compile(r"[A-Z][a-z'’\-]+|[A-Z]\.?")

# Words that end a name when they follow it ("Dr. Munish Paul Dermatologist").
_STOP = {
    "best", "top", "dermatologist", "dermatology", "skin", "specialist", "consultant",
    "senior", "sr", "associate", "director", "professor", "prof", "head", "hod",
    "doctor", "doctors", "clinic", "clinics", "hospital", "hospitals", "healthcare",
    "centre", "center", "in", "at", "is", "and", "the", "of", "for", "with", "by",
    "near", "me", "book", "appointment", "online", "consult", "reviews", "profile",
    "about", "team", "cosmetologist", "trichologist", "surgeon", "physician",
    "mbbs", "md", "ms", "dnb", "dvd", "frcp", "mrcp", "dm", "mch", "phd",
    "india", "new", "who", "has", "was", "ex", "aiims", "dr",
}
_INSTITUTION_RE = re.compile(
    r"(hospital|hospitals|healthcare|health care|clinic|medical|institute|aiims|medicity|"
    r"nursing home|centre|center|apollo|fortis|max|manipal|medanta|narayana)", re.I)
_DESIGNATION_RE = re.compile(
    r"((?:senior|sr\.?|associate|principal|chief|lead)?\s*"
    r"(?:consultant|director|professor|head of department|head|hod|surgeon)"
    r"(?:\s*[-–,]?\s*(?:of\s+)?[A-Z][A-Za-z&/ ]{2,40})?)", re.I)


def _clean_name(raw: str, extra_stop: set) -> Optional[str]:
    tokens = []
    for tok in _TOKEN_RE.findall(raw):
        low = tok.rstrip(".").lower()
        if low in _STOP or low in extra_stop:
            break
        tokens.append(tok if len(tok) > 2 or not tok[0].isalpha() else tok.rstrip(".") + ".")
    # Need a first and a last name — "Dr. Dadu" alone can't be told apart.
    full = [t for t in tokens if len(t.rstrip(".")) > 1]
    if len(tokens) < 2 or not full or len(tokens) > 4:
        return None
    return " ".join(t if len(t.rstrip(".")) > 1 else t.rstrip(".") + "." for t in tokens)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def extract_doctors(results: List[Dict], extra_stop_words: List[str]) -> List[Dict]:
    """One candidate per distinct doctor name. A name in the page title means a
    page about that doctor, so the page URL is their identity; names found in a
    listing page's snippet get `url#name-slug` so each stays distinct."""
    extra = {w.lower() for phrase in extra_stop_words if phrase for w in re.findall(r"[A-Za-z]+", phrase)}
    by_name: Dict[str, Dict] = {}

    for r in results:
        title, snippet, url = r.get("title") or "", r.get("snippet") or "", r.get("url") or ""
        if not url:
            continue
        segments = [s.strip() for s in re.split(r"\s[|–—-]\s", title) if s.strip()]
        institution = next((s for s in segments if _INSTITUTION_RE.search(s) and "Dr" not in s), None)

        for text, from_title in ((title, True), (snippet, False)):
            for m in _DR_RE.finditer(text):
                name = _clean_name(m.group(1), extra)
                if not name:
                    continue
                key = name.lower()
                if key in by_name:
                    continue
                after = text[m.end():m.end() + 140]
                desig = _DESIGNATION_RE.search(after)
                by_name[key] = {
                    "name": f"Dr. {name}",
                    "url": url if from_title else f"{url}#{_slug(name)}",
                    "page_url": url,
                    "page_title": title,
                    "snippet": snippet,
                    "institution": institution,
                    "designation": desig.group(1).strip(" ,-–") if desig else None,
                    "provider": r.get("provider"),
                }
                if from_title:
                    break   # a per-doctor page: the first title name is the subject
    return list(by_name.values())


def test_serpapi_key(api_key: str) -> Tuple[bool, str]:
    """For the admin "Test" button: one real query, reporting searches left."""
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get("https://serpapi.com/account.json", params={"api_key": api_key})
        data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        if resp.status_code != 200 or data.get("error"):
            return False, data.get("error") or f"SerpAPI returned {resp.status_code}"
        left = data.get("total_searches_left", data.get("plan_searches_left"))
        plan = data.get("plan_name") or "SerpAPI"
        return True, f"Connected — {plan}, {left} searches left this month." if left is not None else f"Connected — {plan}."
    except Exception as exc:  # noqa: BLE001
        return False, f"Connection failed: {exc}"
