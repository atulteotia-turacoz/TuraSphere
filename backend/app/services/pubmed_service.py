"""PubMed integration service for fetching publication data."""
import httpx
from typing import Dict, List, Optional, Tuple
from xml.etree import ElementTree
import asyncio
from datetime import datetime


PUBMED_SEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
PUBMED_FETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

# Assessments only count recent output, so every PubMed lookup is scoped to this
# many calendar years (current year inclusive) unless a caller passes explicit
# dates. Without it the counts and the co-author network span a whole career.
PUBMED_WINDOW_YEARS = 5


def default_window() -> Tuple[str, str]:
    """(min_date, max_date) for the default look-back window, PubMed format."""
    current_year = datetime.now().year
    return f"{current_year - (PUBMED_WINDOW_YEARS - 1)}/01/01", f"{current_year}/12/31"


class PubMedService:

    def __init__(self, api_key: str = "", email: str = ""):
        self.api_key = api_key
        self.email = email

    async def search_publications(self, author_name: str, affiliation: str = "",
                                   min_date: str = "", max_date: str = "") -> Dict:
        query = f"{author_name}[Author]"
        if affiliation:
            query += f" AND {affiliation}[Affiliation]"

        params = {
            "db": "pubmed",
            "term": query,
            "retmax": 200,
            "retmode": "json",
            "sort": "date",
        }
        # NCBI only applies a date range when BOTH mindate and maxdate are present
        # — supplying one alone is silently ignored, so fill in the other end.
        if min_date or max_date:
            win_min, win_max = default_window()
            params["mindate"] = min_date or win_min
            params["maxdate"] = max_date or win_max
            params["datetype"] = "pdat"
        if self.api_key:
            params["api_key"] = self.api_key

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(PUBMED_SEARCH_URL, params=params)
            resp.raise_for_status()
            return resp.json()

    async def get_publication_count(self, author_name: str, affiliation: str = "",
                                     all_time: bool = False) -> int:
        """Publications in the default window; pass all_time=True for the career total."""
        min_date, max_date = ("", "") if all_time else default_window()
        data = await self.search_publications(author_name, affiliation, min_date, max_date)
        return int(data.get("esearchresult", {}).get("count", 0))

    async def get_pubs_per_year_recent(self, author_name: str, affiliation: str = "",
                                        years: int = 3) -> float:
        current_year = datetime.now().year
        start_year = current_year - years + 1
        data = await self.search_publications(
            author_name, affiliation,
            min_date=f"{start_year}/01/01",
            max_date=f"{current_year}/12/31"
        )
        count = int(data.get("esearchresult", {}).get("count", 0))
        return count / years if years > 0 else 0

    async def get_publication_ids(self, author_name: str, affiliation: str = "",
                                   all_time: bool = False) -> List[str]:
        """PMIDs from the default window; pass all_time=True for the whole career."""
        min_date, max_date = ("", "") if all_time else default_window()
        data = await self.search_publications(author_name, affiliation, min_date, max_date)
        return data.get("esearchresult", {}).get("idlist", [])

    async def fetch_article_details(self, pmids: List[str]) -> List[Dict]:
        if not pmids:
            return []
        params = {
            "db": "pubmed",
            "id": ",".join(pmids[:50]),
            "retmode": "xml",
        }
        if self.api_key:
            params["api_key"] = self.api_key

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(PUBMED_FETCH_URL, params=params)
            resp.raise_for_status()

        articles = []
        root = ElementTree.fromstring(resp.text)
        for article in root.findall(".//PubmedArticle"):
            title_el = article.find(".//ArticleTitle")
            journal_el = article.find(".//Journal/Title")
            pmid_el = article.find(".//PMID")
            doi_el = article.find(".//ArticleId[@IdType='doi']")
            if doi_el is None:
                doi_el = article.find(".//ELocationID[@EIdType='doi']")
            authors = []
            for author in article.findall(".//Author"):
                last = author.findtext("LastName", "")
                first = author.findtext("ForeName", "")
                if last:
                    authors.append(f"{last} {first}".strip())
            pmid = pmid_el.text if pmid_el is not None else ""
            doi = doi_el.text if doi_el is not None else ""
            if pmid:
                url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
            elif doi:
                url = f"https://doi.org/{doi}"
            else:
                url = ""
            iso_date, year = self._parse_pub_date(article)
            articles.append({
                "title": title_el.text if title_el is not None else "",
                "journal": journal_el.text if journal_el is not None else "",
                "year": year,
                # ISO date (YYYY, YYYY-MM or YYYY-MM-DD) for "last published N ago".
                "date": iso_date,
                "authors": authors,
                "pmid": pmid,
                "doi": doi,
                "url": url,
            })
        return articles

    # Month names PubMed uses in <PubDate>, mapped to numbers.
    _MONTHS = {m.lower(): i for i, m in enumerate(
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}

    @classmethod
    def _parse_pub_date(cls, article) -> Tuple[str, str]:
        """Best-available publication date as (iso, year).

        PubMed dates are irregular: some articles carry Year/Month/Day, some only a
        Year, some just a free-text MedlineDate ("2024 Jan-Feb"). Prefer the
        ArticleDate (the electronic pub date, most precise), then the journal
        PubDate. Returns as much precision as exists — "2024", "2024-01" or
        "2024-01-15" — so callers can still say "N months ago" when the day is
        missing.
        """
        def from_node(node):
            if node is None:
                return "", ""
            y = (node.findtext("Year") or "").strip()
            if not y:
                # MedlineDate like "2024 Jan-Feb" — take the leading year.
                md = (node.findtext("MedlineDate") or "").strip()
                y = md[:4] if md[:4].isdigit() else ""
                return (y, y) if y else ("", "")
            mo_raw = (node.findtext("Month") or "").strip()
            mo = cls._MONTHS.get(mo_raw.lower(), None)
            if mo is None and mo_raw.isdigit():
                mo = int(mo_raw)
            day = (node.findtext("Day") or "").strip()
            if mo and day.isdigit():
                return f"{y}-{mo:02d}-{int(day):02d}", y
            if mo:
                return f"{y}-{mo:02d}", y
            return y, y

        for path in (".//ArticleDate", ".//Journal/JournalIssue/PubDate", ".//PubDate"):
            iso, year = from_node(article.find(path))
            if iso:
                return iso, year
        return "", ""

    async def get_recent_articles(self, author_name: str, affiliation: str = "",
                                  limit: int = 15) -> List[Dict]:
        """The author's most recent articles, newest first (date-sorted search)."""
        ids = await self.get_publication_ids(author_name, affiliation)
        arts = await self.fetch_article_details(ids[:limit])
        arts.sort(key=lambda a: a.get("date") or a.get("year") or "", reverse=True)
        return arts

    async def get_coauthors(self, author_name: str, affiliation: str = "") -> Dict[str, int]:
        """Co-authors from the default window — not the author's whole career."""
        pmids = await self.get_publication_ids(author_name, affiliation)
        articles = await self.fetch_article_details(pmids[:100])

        coauthor_counts: Dict[str, int] = {}
        normalized_name = author_name.lower().strip()

        for article in articles:
            for a in article["authors"]:
                a_lower = a.lower().strip()
                if a_lower != normalized_name and len(a_lower) > 2:
                    coauthor_counts[a] = coauthor_counts.get(a, 0) + 1

        return coauthor_counts

    async def get_publication_history(self, author_name: str, affiliation: str = "",
                                      years_back: int = 10) -> Dict[int, int]:
        current_year = datetime.now().year
        history = {}
        for year in range(current_year - years_back, current_year + 1):
            data = await self.search_publications(
                author_name, affiliation,
                min_date=f"{year}/01/01",
                max_date=f"{year}/12/31"
            )
            history[year] = int(data.get("esearchresult", {}).get("count", 0))
            await asyncio.sleep(0.35)  # rate limit
        return history

    @staticmethod
    def calculate_growth_rate(history: Dict[int, int], recent_years: int = 5) -> Optional[float]:
        if len(history) < 2:
            return None
        years = sorted(history.keys())
        recent = years[-recent_years:] if len(years) >= recent_years else years
        if len(recent) < 2:
            return None
        values = [history[y] for y in recent]
        if values[0] == 0:
            return 100.0 if values[-1] > 0 else 0.0
        growth = ((values[-1] / values[0]) ** (1 / (len(recent) - 1)) - 1) * 100
        return growth
