"""LinkedIn profile discovery service.
Uses web search (DuckDuckGo + Bing fallback) to find LinkedIn profiles and extract
publicly available professional information for KOL assessment."""

import httpx
import logging
import re
import asyncio
from typing import Dict, Optional
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


class LinkedInService:
    """Discovers LinkedIn profile info via web search (no API key needed)."""

    DDG_HTML_URL = "https://html.duckduckgo.com/html/"
    DDG_LITE_URL = "https://lite.duckduckgo.com/lite/"
    BING_URL = "https://www.bing.com/search"

    async def find_profile(
        self,
        full_name: str,
        institution: str = "",
        specialty: str = "",
        city: str = "",
    ) -> Dict:
        """Search for an HCP's LinkedIn profile and extract available info."""
        result = {
            "profile_found": False,
            "profile_url": None,
            "headline": None,
            "snippet": None,
            "connections_hint": None,
            "search_query": "",
        }

        # Build a targeted search query
        parts = [f'"{full_name}"', "site:linkedin.com/in"]
        if institution:
            parts.append(institution)
        if specialty:
            parts.append(specialty)
        if city:
            parts.append(city)
        query = " ".join(parts)
        result["search_query"] = query

        # Try multiple search engines in order
        for search_fn in [self._search_ddg_html, self._search_ddg_lite, self._search_bing]:
            try:
                search_result = await search_fn(query, full_name)
                if search_result:
                    result.update(search_result)
                    result["profile_found"] = True
                    return result
            except Exception as e:
                logger.debug(f"Search method {search_fn.__name__} failed: {e}")
                continue

        logger.info(f"LinkedIn profile not found for {full_name} via any search engine")
        return result

    async def _search_ddg_html(self, query: str, full_name: str) -> Optional[Dict]:
        """Search via DuckDuckGo HTML endpoint."""
        headers = {"User-Agent": BROWSER_UA}
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.post(
                self.DDG_HTML_URL,
                data={"q": query},
                headers=headers,
            )

        if resp.status_code != 200:
            logger.debug(f"DDG HTML returned {resp.status_code}")
            return None

        soup = BeautifulSoup(resp.text, "html.parser")
        return self._parse_ddg_results(soup, full_name)

    async def _search_ddg_lite(self, query: str, full_name: str) -> Optional[Dict]:
        """Search via DuckDuckGo Lite endpoint (fallback)."""
        headers = {"User-Agent": BROWSER_UA}
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.post(
                self.DDG_LITE_URL,
                data={"q": query},
                headers=headers,
            )

        if resp.status_code != 200:
            logger.debug(f"DDG Lite returned {resp.status_code}")
            return None

        soup = BeautifulSoup(resp.text, "html.parser")

        # DDG Lite has different HTML structure
        name_parts = full_name.lower().split()
        for link in soup.find_all("a", href=True):
            href = link.get("href", "")
            if "linkedin.com/in/" not in href:
                continue

            title = link.get_text(strip=True)
            if not any(part in title.lower() for part in name_parts if len(part) > 2):
                continue

            linkedin_url = self._extract_linkedin_url(href)
            if linkedin_url:
                # Get snippet from next sibling or parent
                snippet = ""
                parent_td = link.find_parent("td")
                if parent_td:
                    next_td = parent_td.find_next_sibling("td")
                    if next_td:
                        snippet = next_td.get_text(strip=True)

                return {
                    "profile_url": linkedin_url,
                    "headline": title,
                    "snippet": snippet or None,
                }

        return None

    async def _search_bing(self, query: str, full_name: str) -> Optional[Dict]:
        """Search via Bing (fallback when DDG is rate-limited)."""
        headers = {
            "User-Agent": BROWSER_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(
                self.BING_URL,
                params={"q": query},
                headers=headers,
            )

        if resp.status_code != 200:
            logger.debug(f"Bing returned {resp.status_code}")
            return None

        soup = BeautifulSoup(resp.text, "html.parser")
        name_parts = full_name.lower().split()

        for item in soup.select("li.b_algo"):
            link = item.select_one("h2 a")
            if not link:
                continue

            href = link.get("href", "")
            title = link.get_text(strip=True)

            if "linkedin.com/in/" not in href:
                continue

            if not any(part in title.lower() for part in name_parts if len(part) > 2):
                continue

            linkedin_url = self._extract_linkedin_url(href)
            if linkedin_url:
                snippet_el = item.select_one(".b_caption p")
                snippet = snippet_el.get_text(strip=True) if snippet_el else None
                return {
                    "profile_url": linkedin_url,
                    "headline": title,
                    "snippet": snippet,
                }

        return None

    def _parse_ddg_results(self, soup: BeautifulSoup, full_name: str) -> Optional[Dict]:
        """Parse DuckDuckGo HTML search results."""
        name_parts = full_name.lower().split()

        for item in soup.select(".result"):
            link_el = item.select_one("a.result__a")
            snippet_el = item.select_one(".result__snippet")

            if not link_el:
                continue

            href = link_el.get("href", "")
            title = link_el.get_text(strip=True)

            if "linkedin.com/in/" not in href:
                continue

            linkedin_url = self._extract_linkedin_url(href)
            if not linkedin_url:
                continue

            title_lower = title.lower()
            if not any(part in title_lower for part in name_parts if len(part) > 2):
                continue

            result = {
                "profile_url": linkedin_url,
                "headline": title,
                "snippet": snippet_el.get_text(strip=True) if snippet_el else None,
            }

            if result.get("snippet"):
                conn_match = re.search(r'(\d+)\+?\s*connections?', result["snippet"].lower())
                if conn_match:
                    result["connections_hint"] = conn_match.group(0)

            return result

        return None

    def _extract_linkedin_url(self, href: str) -> Optional[str]:
        """Extract clean LinkedIn URL from search result href."""
        match = re.search(r'(https?://[a-z]+\.linkedin\.com/in/[^&?#\s]+)', href)
        if match:
            return match.group(1)
        if "linkedin.com/in/" in href:
            return href.split("&")[0].split("?")[0]
        return None
