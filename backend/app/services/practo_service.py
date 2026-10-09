"""Practo profile scraping service.
Searches Practo for doctor profiles and extracts structured data
from JSON-LD (Schema.org) embedded in the page for KOL assessment scoring."""

import asyncio
import re
import json
import logging
from typing import Dict, List, Optional
import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# Practo ships the whole profile as a Redux store in a <script>. It carries far
# more than the page's JSON-LD — verified degrees with college and year, medical
# council registration, specialisations, memberships, languages — so profile
# enrichment reads this and falls back to JSON-LD only for what it lacks.
REDUX_PREFIX = "window.__REDUX_STATE__="

# Practo gives addressCountry as an ISO code. Only the markets it serves.
COUNTRY_NAMES = {"IN": "India"}

# Practo has no country-wide listing (`/india/dermatologist` is 410 Gone), so a
# country search walks that country's major cities instead. Every slug here was
# checked to return a listing; its other old markets (Singapore, Manila, Jakarta)
# are 410 now, so India is the only country it can serve.
COUNTRY_CITIES = {
    "india": [
        "delhi", "mumbai", "bangalore", "chennai", "hyderabad", "kolkata", "pune",
        "ahmedabad", "gurgaon", "noida", "jaipur", "chandigarh", "lucknow", "indore",
    ],
}


class PractoService:
    """Discovers and scrapes doctor profiles from Practo using JSON-LD."""

    BASE_URL = "https://www.practo.com"
    SEARCH_URL = "https://www.practo.com/search/doctors"
    LISTING_URL = "https://www.practo.com/{city}/{specialty}"

    # Listing pages hold ~10 doctors each. Practo sometimes renders a page without
    # its JSON-LD, so tolerate a short run of blanks before deciding the listing has
    # actually ended, and cap total paging so a big city can't walk forever.
    EMPTY_PAGE_STREAK = 3
    MAX_PAGES = 60

    # Practo's listing URLs take a specialty *slug* ("dermatologist"), while our KOL
    # criteria carry a free-text specialty ("Dermatology", "Derm"). Map the common
    # ones; anything unmapped is slugified and tried as-is.
    SPECIALTY_SLUGS = {
        "dermatology": "dermatologist",
        "dermatologist": "dermatologist",
        "derm": "dermatologist",
        "skin": "dermatologist",
        "cosmetology": "cosmetologist",
        "trichology": "trichologist",
        "cardiology": "cardiologist",
        "oncology": "oncologist",
        "neurology": "neurologist",
        "endocrinology": "endocrinologist",
        "gastroenterology": "gastroenterologist",
        "rheumatology": "rheumatologist",
        "psychiatry": "psychiatrist",
        "pediatrics": "pediatrician",
        "ophthalmology": "ophthalmologist",
        "gynecology": "gynecologist",
        "orthopedics": "orthopedist",
        "urology": "urologist",
        "pulmonology": "pulmonologist",
        "nephrology": "nephrologist",
    }

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    async def search_doctor(
        self,
        doctor_name: str,
        city: str = "",
        specialty: str = "",
    ) -> Dict:
        """Search for a doctor on Practo and scrape their profile data."""
        result = {
            "profile_found": False,
            "profile_url": "",
            "name": "",
            "specialty": "",
            "experience_years": 0,
            "rating": 0.0,
            "reviews_count": 0,
            "recommendations_count": 0,
            "qualifications": [],
            "hospital": "",
            "locality": "",
            "consultation_fee": "",
            "services": [],
        }

        try:
            # Step 1: Search and find the matching profile URL via JSON-LD
            profile_info = await self._search_and_match(doctor_name, city, specialty)
            if not profile_info:
                logger.info(f"No Practo profile found for {doctor_name}")
                return result

            result["profile_url"] = profile_info["url"]
            result["profile_found"] = True

            # Step 2: Scrape the full profile page for detailed data
            profile_data = await self._scrape_profile(profile_info["url"])
            result.update(profile_data)
            # The older scraper above misses fields Practo now ships only in its
            # Redux state (experience read as 0 for a 31-year doctor). Fill the
            # gaps from fetch_profile_details, which reads that state.
            async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers=self.HEADERS) as client:
                details = await self.fetch_profile_details(client, profile_info["url"])
            for key, value in details.items():
                if value not in (None, "", [], 0) and not result.get(key):
                    result[key] = value
            if not result.get("name"):
                result["name"] = profile_info["name"]

            # Keep profile_found = True even if scrape got limited data
            result["profile_found"] = True

        except Exception as e:
            logger.error(f"Error searching Practo for {doctor_name}: {e}")
            result["error"] = str(e)

        return result

    @classmethod
    def _specialty_slug(cls, specialty: str) -> str:
        """Map a free-text specialty onto Practo's listing slug.

        Returns "" for empty input rather than assuming a specialty — the caller
        decides what to do, instead of silently listing something nobody asked for.
        """
        key = re.sub(r"[^a-z]", "", (specialty or "").lower())
        if key in cls.SPECIALTY_SLUGS:
            return cls.SPECIALTY_SLUGS[key]
        return re.sub(r"[^a-z0-9]+", "-", (specialty or "").lower()).strip("-")

    @staticmethod
    def _city_slug(city: str) -> str:
        return re.sub(r"[^a-z0-9]+", "-", (city or "").lower()).strip("-")

    def _listing_to_candidate(self, item: Dict) -> Optional[Dict]:
        """Shape one Physician JSON-LD block from a listing page into a candidate."""
        name = (item.get("name") or "").strip()
        url = (item.get("url") or "").split("?")[0]
        if not name or not url:
            return None

        addr = item.get("address") or {}
        clinic = item.get("branchOf") or {}
        specs = item.get("medicalSpecialty")
        if isinstance(specs, list):
            specialty = ", ".join(specs)
        else:
            specialty = specs or ""

        locality = (addr.get("addressLocality") or "").strip()
        region = (addr.get("addressRegion") or "").strip()

        fee = item.get("priceRange")
        try:
            fee = int(fee) if fee not in (None, "") else None
        except (TypeError, ValueError):
            fee = None

        geo = item.get("geo") or {}
        return {
            "name": name,
            "profile_url": url,
            "specialty": specialty,
            "clinic": (clinic.get("name") or "").strip(),
            "locality": locality,
            # Practo's addressRegion is the CITY, not the state — verified across
            # Delhi/Noida/Gurgaon/Pune, which all return their own name. Practo
            # publishes no state at all; the caller supplies it from the form.
            "region": region,
            "country": COUNTRY_NAMES.get((addr.get("addressCountry") or "").upper(),
                                         (addr.get("addressCountry") or "").strip()),
            "postal_code": (addr.get("postalCode") or "").strip(),
            "street_address": (addr.get("streetAddress") or "").strip(),
            "consultation_fee": fee,
            "image": item.get("image") or "",
            "latitude": geo.get("latitude"),
            "longitude": geo.get("longitude"),
        }

    @staticmethod
    def _url_path(url: str) -> str:
        path = re.sub(r"^https?://[^/]+", "", url or "").split("?")[0]
        return path.rstrip("/").lower()

    def _listing_experience(self, soup: BeautifulSoup) -> Dict[str, int]:
        """Profile path -> total years of experience, for every doctor on a listing
        page. The JSON-LD omits it, but the page's Redux state carries
        `experience_years` next to each doctor's `profile_url` — so experience
        comes for free, without opening each profile."""
        state = self._extract_redux(soup)
        found: Dict[str, int] = {}

        def walk(o):
            if isinstance(o, dict):
                if "experience_years" in o and o.get("profile_url"):
                    try:
                        years = int(o["experience_years"])
                        if 0 < years < 80:
                            found[self._url_path(o["profile_url"])] = years
                    except (TypeError, ValueError):
                        pass
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)

        if state:
            walk(state)
        return found

    def _extract_redux(self, soup: BeautifulSoup) -> Optional[Dict]:
        """Pull the `window.__REDUX_STATE__` store out of a Practo page."""
        for script in soup.find_all("script"):
            text = script.string or ""
            if text.startswith(REDUX_PREFIX):
                raw = text[len(REDUX_PREFIX):].strip().rstrip(";")
                try:
                    return json.loads(raw)
                except json.JSONDecodeError as exc:
                    logger.warning("Practo redux blob did not parse: %s", exc)
                    return None
        return None

    @staticmethod
    def _profile_details(pr: Dict, jsonld: Dict) -> Dict:
        """Flatten Practo's profile_reducer into the fields a KOL record wants."""
        quals = []
        for q in pr.get("qualifications") or []:
            name = ((q.get("master_qualification") or {}).get("name") or "").strip()
            if not name:
                continue
            college = ((q.get("master_college") or {}).get("name") or "").strip()
            year = q.get("completion_year")
            bits = name
            if college:
                bits += f" — {college}"
            if year:
                bits += f" ({year})"
            quals.append(bits)

        # Specialisations: the first is the headline specialty, the rest read as
        # subspecialties (e.g. Dermatologist + Cosmetologist).
        specs = []
        for s in pr.get("specializations") or []:
            spec = ((s.get("master_specialization") or {}).get("speciality") or {})
            nm = (spec.get("speciality_name") or "").strip()
            if nm and nm not in specs:
                specs.append(nm)
        if not specs:
            ml = jsonld.get("medicalSpecialty")
            specs = ml if isinstance(ml, list) else ([ml] if ml else [])

        reg = (pr.get("registrations") or [{}])[0]
        council = (reg.get("council") or {}).get("name") or ""

        agg = jsonld.get("aggregateRating") or {}

        def _int(v):
            try:
                return int(v)
            except (TypeError, ValueError):
                return None

        return {
            "name": (pr.get("full_name") or pr.get("name") or "").strip() or None,
            "summary": (pr.get("summary") or jsonld.get("description") or "").strip() or None,
            "specialty": specs[0] if specs else None,
            "subspecialties": specs[1:],
            "qualifications": quals,
            "experience_years": _int(pr.get("years_of_experience")),
            "specialist_experience_years": _int(pr.get("specialist_years_of_experience")),
            # Medical-council registration — the strongest signal that a profile is
            # a real, licensed practitioner rather than a lookalike.
            "registration_number": (reg.get("number") or "").strip() or None,
            "registration_council": council or None,
            "registration_year": reg.get("registration_year"),
            "registration_verified": bool(reg.get("verified")),
            "memberships": [
                (m.get("council") or {}).get("name") for m in (pr.get("memberships") or [])
                if (m.get("council") or {}).get("name")
            ],
            "languages": [l.get("name") for l in (pr.get("languages") or []) if l.get("name")],
            "awards": [a for a in (pr.get("awards") or []) if isinstance(a, str)],
            "rating": _int(agg.get("ratingValue")),
            "reviews_count": _int(agg.get("reviewCount") or agg.get("ratingCount")),
            "image": pr.get("image_url") or jsonld.get("image") or None,
        }

    async def fetch_profile_details(self, client: httpx.AsyncClient, profile_url: str) -> Dict:
        """Scrape one doctor's profile page for the detail the listing omits.

        Best-effort: any failure returns {} so one bad profile cannot sink a scrape.
        """
        try:
            resp = await client.get(profile_url)
            if resp.status_code != 200:
                logger.warning("Practo profile %s returned %d", profile_url, resp.status_code)
                return {}
            soup = BeautifulSoup(resp.text, "html.parser")
            redux = self._extract_redux(soup) or {}
            pr = redux.get("profile_reducer") or {}
            jsonld = next((i for i in self._extract_jsonld(soup)
                           if i.get("@type") in ("Physician", "Dentist")), {})
            if not pr and not jsonld:
                return {}
            return self._profile_details(pr, jsonld)
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("Practo profile %s failed: %s", profile_url, exc)
            return {}

    async def _enrich(self, client: httpx.AsyncClient, docs: List[Dict], concurrency: int) -> None:
        """Fetch every doctor's profile page and merge the detail in, in place.

        One page per doctor, so this is the expensive half of a scrape — capped by
        `concurrency` to stay polite rather than firing N requests at once.
        """
        sem = asyncio.Semaphore(max(1, concurrency))

        async def one(doc: Dict) -> None:
            async with sem:
                detail = await self.fetch_profile_details(client, doc["profile_url"])
            if not detail:
                return
            # The listing already gave us name/specialty/image — only overwrite
            # when the profile actually has a value.
            for k, v in detail.items():
                if v not in (None, "", [], 0):
                    doc[k] = v

        await asyncio.gather(*(one(d) for d in docs))

    async def discover_by_specialty(
        self,
        city: str,
        specialty: str,
        limit: int = 40,
        enrich: bool = True,
        concurrency: int = 6,
    ) -> List[Dict]:
        """List doctors of a specialty in a city from Practo's public directory.

        `search_doctor` verifies a doctor you can already name; this is the discovery
        path — it walks `/{city}/{specialty}` (~10 doctors per page, `?page=N`) and
        returns every profile found, so the KOL scrape can populate a city roster.

        Stops at `limit`, after `EMPTY_PAGE_STREAK` consecutive pages with no new
        doctors, or on the first non-200 — returning whatever it gathered rather
        than failing the scrape.
        """
        city_slug = self._city_slug(city)
        spec_slug = self._specialty_slug(specialty)
        # Both halves come from the form; without either there is no listing URL
        # to walk, and guessing one would return doctors nobody asked for.
        if not city_slug or not spec_slug:
            logger.warning("Practo discovery needs a city and a specialty; got city=%r specialty=%r",
                           city, specialty)
            return []

        base = self.LISTING_URL.format(city=city_slug, specialty=spec_slug)
        out: List[Dict] = []
        seen: set = set()
        empty_streak = 0

        async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers=self.HEADERS) as client:
            page = 1
            while len(out) < limit and page <= self.MAX_PAGES:
                try:
                    resp = await client.get(base, params={"page": page} if page > 1 else None)
                except httpx.HTTPError as exc:
                    logger.warning("Practo listing transport error on page %d: %s", page, exc)
                    break

                if resp.status_code != 200:
                    logger.warning("Practo listing %s page %d returned %d", base, page, resp.status_code)
                    break

                soup = BeautifulSoup(resp.text, "html.parser")
                experience = self._listing_experience(soup)
                fresh = 0
                for item in self._extract_jsonld(soup):
                    if item.get("@type") not in ("Physician", "Dentist"):
                        continue
                    cand = self._listing_to_candidate(item)
                    if not cand or cand["profile_url"] in seen:
                        continue
                    cand["experience_years"] = experience.get(self._url_path(cand["profile_url"]))
                    seen.add(cand["profile_url"])
                    out.append(cand)
                    fresh += 1
                    if len(out) >= limit:
                        break

                # Practo intermittently serves a listing page without its JSON-LD —
                # a blank page is not proof we've run out (page 11 can come back
                # empty while page 12 is full). Only stop after a run of them.
                if fresh == 0:
                    empty_streak += 1
                    if empty_streak >= self.EMPTY_PAGE_STREAK:
                        break
                else:
                    empty_streak = 0
                page += 1

            out = out[:limit]
            if enrich and out:
                await self._enrich(client, out, concurrency)

        logger.info("Practo discovery %s: %d doctors over %d page(s), enrich=%s",
                    base, len(out), page, enrich)
        return out

    @staticmethod
    def serves_country(country: str) -> bool:
        return (country or "").strip().lower() in COUNTRY_CITIES

    async def discover_by_country(
        self,
        country: str,
        specialty: str,
        limit: int = 40,
        enrich: bool = True,
        concurrency: int = 6,
    ) -> List[Dict]:
        """Country-wide version of `discover_by_specialty`: the limit is spread over
        the country's major cities so the roster isn't just the first city's top
        page. A city that runs short leaves its share to the next ones."""
        cities = COUNTRY_CITIES.get((country or "").strip().lower(), [])
        if not cities:
            logger.warning("Practo has no listings for country=%r", country)
            return []

        out: List[Dict] = []
        seen: set = set()
        for i, city in enumerate(cities):
            remaining = limit - len(out)
            if remaining <= 0:
                break
            share = -(-remaining // (len(cities) - i))   # ceil over the cities left
            docs = await self.discover_by_specialty(city, specialty, limit=share, enrich=False)
            for d in docs:
                if d["profile_url"] not in seen:
                    seen.add(d["profile_url"])
                    out.append(d)

        out = out[:limit]
        if enrich and out:
            async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers=self.HEADERS) as client:
                await self._enrich(client, out, concurrency)
        logger.info("Practo country discovery %s/%s: %d doctors", country, specialty, len(out))
        return out

    @staticmethod
    def _normalize_name(name: str) -> set:
        """Extract significant name parts for matching."""
        clean = re.sub(r"\b(dr\.?|prof\.?|mr\.?|ms\.?|mrs\.?)\b", "", name, flags=re.IGNORECASE)
        return {p.lower() for p in clean.split() if len(p) > 1}

    @staticmethod
    def _name_matches(search_name: str, found_name: str) -> bool:
        """Check if found name matches the search name."""
        search_parts = PractoService._normalize_name(search_name)
        found_parts = PractoService._normalize_name(found_name)
        if not search_parts or not found_parts:
            return False
        overlap = search_parts & found_parts
        # The surname must match, and at least two name parts overall (or the one
        # part given) — so "Vinay Singh" doesn't take "Vijay Singhal", and "Dr. X
        # Sharma" doesn't take any other Sharma.
        search_last = PractoService._last_name(search_name)
        if search_last and search_last not in found_parts:
            return False
        return len(overlap) >= min(2, len(search_parts))

    @staticmethod
    def _last_name(name: str) -> str:
        clean = re.sub(r"\b(dr\.?|prof\.?|mr\.?|ms\.?|mrs\.?)\b", "", name or "", flags=re.IGNORECASE)
        parts = [p.lower() for p in clean.replace("'s", "").split() if len(p) > 1]
        return parts[-1] if parts else ""

    def _extract_jsonld(self, soup: BeautifulSoup) -> List[Dict]:
        """Extract all JSON-LD blocks from a page."""
        results = []
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string)
                if isinstance(data, list):
                    results.extend(data)
                elif isinstance(data, dict):
                    results.append(data)
            except (json.JSONDecodeError, TypeError):
                continue
        return results

    AUTOCOMPLETE_URL = "https://www.practo.com/cerebro/autocomplete/v3/keyword"

    async def _search_and_match(
        self,
        doctor_name: str,
        city: str = "",
        specialty: str = "",
    ) -> Optional[Dict]:
        """Find a doctor's Practo profile by name via Practo's own autocomplete.

        The old `/search/doctors?q=[{"word":…,"category":"name"}]` request stopped
        honouring the name — Practo returns the city's generic top list for it,
        so nobody ever matched (verified 2026-09-24: not even Dr. Vinay Singh,
        who is #1 on Delhi's dermatologist listing). The autocomplete the site's
        search box uses returns `doctor_name` matches with the profile slug.
        `specialty` is unused by Practo here; it is kept for the callers.
        """
        clean_name = re.sub(r"\b(dr\.?|prof\.?)\s*", "", doctor_name, flags=re.IGNORECASE).strip()
        if not clean_name:
            return None
        # The autocomplete needs a city (no city → 503). Without one, try Practo's
        # major Indian cities in turn — it only serves India.
        cities = [city.lower().strip()] if city else COUNTRY_CITIES["india"]
        for c in cities:
            match = await self._autocomplete_match(doctor_name, clean_name, c)
            if match:
                return match
        logger.info(f"No Practo profile matching '{doctor_name}' ({city or 'major cities'})")
        return None

    async def _autocomplete_match(self, doctor_name: str, clean_name: str, city: str) -> Optional[Dict]:
        params = {"query": clean_name, "source": "desktop", "city": city}
        try:
            async with httpx.AsyncClient(
                timeout=15, follow_redirects=True,
                headers={**self.HEADERS, "Accept": "application/json"},
            ) as client:
                resp = await client.get(self.AUTOCOMPLETE_URL, params=params)
            if resp.status_code != 200:
                logger.warning(f"Practo autocomplete returned {resp.status_code} for city={city!r}")
                return None
            groups = (resp.json().get("results") or {}).get("grouped") or []
        except Exception as e:
            logger.error(f"Practo search failed: {e}")
            return None

        for group in groups:
            for m in group.get("matches") or []:
                if m.get("category") != "doctor_name" or not m.get("slug"):
                    continue
                found = m.get("suggestion") or ""
                if not self._name_matches(doctor_name, found):
                    continue
                # A city filter is a preference, not a guarantee — trust the match's own city.
                m_city = self._city_slug(m.get("city") or city or "")
                if not m_city:
                    continue
                return {
                    "name": f"Dr. {found}" if not found.lower().startswith("dr") else found,
                    "url": f"{self.BASE_URL}/{m_city}/doctor/{m['slug']}",
                    "city": m.get("city"),
                    "practice_name": m.get("practice_name"),
                }

        return None

    async def _scrape_profile(self, profile_url: str) -> Dict:
        """Scrape detailed data from a Practo doctor profile page using JSON-LD + HTML."""
        data = {}

        try:
            async with httpx.AsyncClient(
                timeout=15, follow_redirects=True, headers=self.HEADERS
            ) as client:
                resp = await client.get(profile_url)

            if resp.status_code != 200:
                logger.warning(f"Practo profile page returned {resp.status_code}")
                return data

            soup = BeautifulSoup(resp.text, "html.parser")

            # Primary: Extract data from JSON-LD (structured, reliable)
            jsonld_items = self._extract_jsonld(soup)
            for item in jsonld_items:
                if item.get("@type") in ("Physician", "Dentist"):
                    data["name"] = item.get("name", "")

                    # Specialty from medicalSpecialty
                    specs = item.get("medicalSpecialty", [])
                    if isinstance(specs, list) and specs:
                        data["specialty"] = ", ".join(specs)
                    elif isinstance(specs, str):
                        data["specialty"] = specs

                    # Description often has experience years
                    desc = item.get("description", "")
                    if desc:
                        years_match = re.search(r"experience of (\d+) years", desc)
                        if years_match:
                            data["experience_years"] = int(years_match.group(1))
                        # Extract hospital from description
                        practice_match = re.search(r"practices at (.+?)(?:\.|She|He)", desc)
                        if practice_match:
                            data["hospital"] = practice_match.group(1).strip()

                    # Qualifications from description
                    quals = item.get("award", [])
                    if quals:
                        data["qualifications"] = [q.replace("&amp;", "&") for q in quals]

                    # Aggregate rating
                    agg = item.get("aggregateRating", {})
                    if agg:
                        try:
                            data["rating"] = float(agg.get("ratingValue", 0))
                        except (ValueError, TypeError):
                            pass
                        try:
                            data["reviews_count"] = int(agg.get("ratingCount", 0))
                        except (ValueError, TypeError):
                            pass

                    break

            # Fallback/supplement: Extract from HTML elements
            self._scrape_html_fallback(soup, data)

        except Exception as e:
            logger.error(f"Error scraping Practo profile: {e}")
            data["error"] = str(e)

        return data

    def _scrape_html_fallback(self, soup: BeautifulSoup, data: Dict):
        """Fill in missing data from HTML elements."""
        # Name
        if not data.get("name"):
            name_el = soup.select_one('[data-qa-id="doctor-name"]') or soup.select_one("h1.doctor-name")
            if name_el:
                data["name"] = name_el.get_text(strip=True)

        # Experience (if not from JSON-LD)
        if not data.get("experience_years"):
            exp_el = soup.select_one('[data-qa-id="doctor-experience"]')
            if exp_el:
                match = re.search(r"(\d+)\s*(?:years?|yrs?)", exp_el.get_text(strip=True), re.IGNORECASE)
                if match:
                    data["experience_years"] = int(match.group(1))

        # Rating (if not from JSON-LD)
        if not data.get("rating"):
            rating_el = soup.select_one('[data-qa-id="doctor-rating"]')
            if rating_el:
                try:
                    data["rating"] = float(rating_el.get_text(strip=True).replace("%", ""))
                except ValueError:
                    pass

        # Reviews count (if not from JSON-LD)
        if not data.get("reviews_count"):
            for el in soup.find_all(string=re.compile(r"\d+\s*(patient\s*stor|review)", re.IGNORECASE)):
                match = re.search(r"(\d+)", el)
                if match:
                    data["reviews_count"] = int(match.group(1))
                    break

        # Recommendations
        if not data.get("recommendations_count"):
            rec_el = soup.find(string=re.compile(r"(\d+)%?\s*recommend", re.IGNORECASE))
            if rec_el:
                match = re.search(r"(\d+)", rec_el)
                if match:
                    data["recommendations_count"] = int(match.group(1))

        # Hospital (if not from JSON-LD)
        if not data.get("hospital"):
            clinic_el = soup.select_one('[data-qa-id="clinic-name"]')
            if clinic_el:
                data["hospital"] = clinic_el.get_text(strip=True)

        # Locality
        if not data.get("locality"):
            loc_el = soup.select_one('[data-qa-id="clinic-locality"]')
            if loc_el:
                data["locality"] = loc_el.get_text(strip=True)

        # Consultation fee
        if not data.get("consultation_fee"):
            fee_el = soup.select_one('[data-qa-id="consultation_fee"]')
            if fee_el:
                data["consultation_fee"] = fee_el.get_text(strip=True)
