"""Google Scholar / guideline detection service."""
import asyncio
import subprocess
import json
import logging
import urllib.parse
import httpx
from typing import Dict, List, Optional, Tuple
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


GUIDELINE_WORDS = ["guideline", "consensus", "recommendation", "position statement"]
INTL_WORDS = ["international", "global", "world", "european", "american",
              "esc ", "aha ", "who ", "asia-pacific"]
NATIONAL_WORDS = ["national", "country", "society of", "association of"]


def _classify(items: List[Tuple[str, str]]) -> Dict:
    """(title, snippet) pairs -> guideline flags + matching results."""
    results, intl, national = [], False, False
    for title_text, snippet_text in items:
        combined = (title_text + " " + snippet_text).lower()
        if any(kw in combined for kw in GUIDELINE_WORDS):
            if any(kw in combined for kw in INTL_WORDS):
                intl = True
            elif any(kw in combined for kw in NATIONAL_WORDS):
                national = True
            results.append({"title": title_text, "snippet": snippet_text[:200], "is_international": intl})
    return {"intl_guidelines": intl, "national_guidelines": national, "results": results[:10]}


class ScholarService:
    """Guideline authorship from Google Scholar.

    With SerpAPI keys configured (Account → Google Scholar, then Admin → Google
    Scholar, provider "SerpAPI") it queries SerpAPI's google_scholar engine,
    trying each key in turn; with none, or when every key fails, it scrapes
    Scholar directly as before. Every call is written to web_search_usage.
    """

    SCHOLAR_URL = "https://scholar.google.com/scholar"
    SERPAPI_URL = "https://serpapi.com/search.json"

    def __init__(self, user_id: Optional[int] = None):
        self.user_id = user_id
        self.keys: List[Tuple[int, str, str]] = []
        try:
            from app.core.database import SessionLocal
            from app.services.integration_keys import scholar_keys
            db = SessionLocal()
            try:
                self.keys = scholar_keys(db, user_id)
            finally:
                db.close()
        except Exception as exc:  # noqa: BLE001 - no keys just means "scrape directly"
            logger.warning("Could not load Scholar keys: %s", exc)

    def _log(self, events: List[Dict]) -> None:
        from app.services.integration_keys import log_usage
        log_usage(events, self.user_id, "scholar", {cid: scope for cid, _, scope in self.keys})

    async def search_guidelines(self, author_name: str, specialty: str = "") -> Dict:
        """Search for guideline/consensus authorship: SerpAPI keys first, then direct."""
        query = f'"{author_name}" {specialty} (guideline OR "consensus statement" OR "practice recommendation")'
        events: List[Dict] = []
        try:
            for cid, key, _scope in self.keys:
                try:
                    async with httpx.AsyncClient(timeout=25) as client:
                        resp = await client.get(self.SERPAPI_URL, params={
                            "engine": "google_scholar", "q": query, "api_key": key, "num": 20, "hl": "en"})
                    data = resp.json() if resp.content else {}
                    err = data.get("error") or ""
                    if resp.status_code == 200 and (not err or "hasn't returned any results" in err):
                        items = [(r.get("title") or "", r.get("snippet") or "")
                                 for r in data.get("organic_results") or []]
                        events.append({"provider": "serpapi", "config_id": cid, "query": query,
                                       "status": "ok", "results": len(items)})
                        out = _classify(items)
                        out["provider"] = "serpapi"
                        return out
                    dead = resp.status_code in (401, 403, 429) or "run out" in err.lower() or "invalid api key" in err.lower()
                    events.append({"provider": "serpapi", "config_id": cid, "query": query,
                                   "status": "quota" if dead else "error",
                                   "error": (err or f"HTTP {resp.status_code}")[:255]})
                    if not dead:
                        break   # transient: go straight to the direct scrape
                except Exception as exc:  # noqa: BLE001
                    events.append({"provider": "serpapi", "config_id": cid, "query": query,
                                   "status": "error", "error": (str(exc) or exc.__class__.__name__)[:255]})
                    break

            out = await self._search_direct(query)
            events.append({"provider": "scholar_direct", "config_id": None, "query": query,
                           "status": "error" if out.get("error") else "ok",
                           "results": len(out.get("results") or []), "error": out.get("error")})
            out["provider"] = "direct"
            return out
        finally:
            await asyncio.to_thread(self._log, events)

    async def _search_direct(self, query: str) -> Dict:
        """Scrape Google Scholar directly (the original, key-less path)."""

        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://scholar.google.com/",
        }

        try:
            # Try httpx first
            resp = None
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                resp = await client.get(
                    self.SCHOLAR_URL,
                    params={"q": query, "hl": "en", "num": 20},
                    headers=headers,
                )

            # If rate-limited, try curl fallback
            if resp.status_code in (429, 403):
                logger.debug(f"Scholar httpx returned {resp.status_code}, trying curl")
                return self._search_with_curl(query)

            if resp.status_code != 200:
                return {"intl_guidelines": False, "national_guidelines": False,
                        "results": [], "error": f"Scholar returned {resp.status_code}"}

            soup = BeautifulSoup(resp.text, "html.parser")
            results = []
            intl = False
            national = False

            for item in soup.select(".gs_ri"):
                title = item.select_one(".gs_rt")
                snippet = item.select_one(".gs_rs")
                title_text = title.get_text() if title else ""
                snippet_text = snippet.get_text() if snippet else ""
                combined = (title_text + " " + snippet_text).lower()

                is_guideline = any(kw in combined for kw in
                                   ["guideline", "consensus", "recommendation", "position statement"])

                if is_guideline:
                    if any(kw in combined for kw in
                           ["international", "global", "world", "european", "american",
                            "esc ", "aha ", "who ", "asia-pacific"]):
                        intl = True
                    elif any(kw in combined for kw in
                             ["national", "country", "society of", "association of"]):
                        national = True

                    results.append({
                        "title": title_text,
                        "snippet": snippet_text[:200],
                        "is_international": intl,
                    })

            return {
                "intl_guidelines": intl,
                "national_guidelines": national,
                "results": results[:10],
            }
        except Exception as e:
            return {
                "intl_guidelines": False,
                "national_guidelines": False,
                "results": [],
                "error": str(e),
            }

    def _search_with_curl(self, query: str) -> Dict:
        """Fallback: use curl to bypass rate limiting."""
        try:
            params = urllib.parse.urlencode({"q": query, "hl": "en", "num": 20})
            url = f"{self.SCHOLAR_URL}?{params}"
            result = subprocess.run(
                ["curl", "-s", "--max-time", "15", "-L",
                 "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                 "-H", "Accept-Language: en-US,en;q=0.9",
                 url],
                capture_output=True, text=True, timeout=20,
            )
            if result.returncode != 0 or not result.stdout.strip():
                return {"intl_guidelines": False, "national_guidelines": False, "results": [], "error": "curl failed"}

            soup = BeautifulSoup(result.stdout, "html.parser")
            results = []
            intl = False
            national = False

            for item in soup.select(".gs_ri"):
                title = item.select_one(".gs_rt")
                snippet = item.select_one(".gs_rs")
                title_text = title.get_text() if title else ""
                snippet_text = snippet.get_text() if snippet else ""
                combined = (title_text + " " + snippet_text).lower()

                is_guideline = any(kw in combined for kw in
                                   ["guideline", "consensus", "recommendation", "position statement"])
                if is_guideline:
                    if any(kw in combined for kw in
                           ["international", "global", "world", "european", "american",
                            "esc ", "aha ", "who ", "asia-pacific"]):
                        intl = True
                    elif any(kw in combined for kw in
                             ["national", "country", "society of", "association of"]):
                        national = True
                    results.append({"title": title_text, "snippet": snippet_text[:200], "is_international": intl})

            return {"intl_guidelines": intl, "national_guidelines": national, "results": results[:10]}
        except Exception as e:
            logger.error(f"Scholar curl fallback failed: {e}")
            return {"intl_guidelines": False, "national_guidelines": False, "results": [], "error": str(e)}
