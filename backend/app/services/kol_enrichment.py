"""KOL enrichment: publications & trials for a scraped candidate.

Given a pending KOL (name + specialty + city/institution), gathers a research
footprint from the sources already integrated in super admin:

  * PubMed            — publication count, recent output, the latest papers, and
                        how long ago the last one appeared.
  * ClinicalTrials.gov— trials the person appears on, and how many as lead.
  * Google Scholar    — best-effort guideline / consensus authorship signal.

Plus ready-to-click Google / Scholar / PubMed search links, because plain Google
cannot be scraped reliably and a human verifier should open it themselves.

Everything is name-matched, so results carry no guarantee of being the same
person — that is what Pending Verification is for. To cut down obvious wrong-person
matches the PubMed/Scholar queries are constrained by the doctor's city or clinic
when one is known, and the affiliation used is reported back so the reviewer can
judge confidence.
"""
import asyncio
import logging
from datetime import date, datetime
from typing import Dict, List, Optional
from urllib.parse import quote_plus

from app.services.pubmed_service import PubMedService
from app.services.clinical_trials_service import ClinicalTrialsService
from app.services.scholar_service import ScholarService

logger = logging.getLogger(__name__)

# Steps reported to the progress bar, in order. Kept here so the UI and the worker
# agree on the labels without duplicating strings.
ENRICHMENT_STEPS = ["PubMed publications", "ClinicalTrials.gov", "Google Scholar", "Search links"]


def _clean_name(name: str) -> str:
    """A person's name without the 'Dr.'/'Prof.' prefix PubMed would choke on."""
    out = (name or "").strip()
    for pref in ("dr.", "dr ", "prof.", "prof ", "mr.", "mr ", "ms.", "ms ", "mrs.", "mrs "):
        if out.lower().startswith(pref):
            out = out[len(pref):].strip()
    return out


def _ago(iso: str) -> Optional[Dict]:
    """Turn an ISO date (YYYY / YYYY-MM / YYYY-MM-DD) into a human 'ago' summary.

    Returns the parsed date plus a coarse days/months/years gap. Day defaults to
    the 1st and month to January when absent, so a bare year still yields a usable
    (if approximate) distance — flagged via `precision`.
    """
    if not iso:
        return None
    parts = iso.split("-")
    try:
        y = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 1
        d = int(parts[2]) if len(parts) > 2 else 1
        when = date(y, m, d)
    except (ValueError, IndexError):
        return None
    today = date.today()
    days = (today - when).days
    if days < 0:
        days = 0
    years = days // 365
    months = days // 30
    if years >= 1:
        human = f"{years} year{'s' if years != 1 else ''} ago"
    elif months >= 1:
        human = f"{months} month{'s' if months != 1 else ''} ago"
    else:
        human = f"{days} day{'s' if days != 1 else ''} ago" if days else "today"
    return {
        "date": iso,
        "days_ago": days,
        "months_ago": months,
        "years_ago": years,
        "human": human,
        "precision": {1: "year", 2: "month"}.get(len(parts), "day"),
    }


def _search_links(name: str, specialty: str, city: str) -> Dict[str, str]:
    """Ready-to-open manual search URLs — the honest substitute for scraping Google."""
    person = _clean_name(name)
    q = " ".join(x for x in (person, specialty, city) if x)
    return {
        "google": f"https://www.google.com/search?q={quote_plus(q)}",
        "google_scholar": f"https://scholar.google.com/scholar?q={quote_plus(person + ' ' + specialty)}",
        "pubmed": f"https://pubmed.ncbi.nlm.nih.gov/?term={quote_plus(person + '[Author]')}",
        "clinicaltrials": f"https://clinicaltrials.gov/search?term={quote_plus(person)}",
    }


async def _pubmed_block(pm: PubMedService, name: str, affiliation: str) -> Dict:
    total = await pm.get_publication_count(name, affiliation)
    articles = await pm.get_recent_articles(name, affiliation, limit=15)
    recent_per_year = await pm.get_pubs_per_year_recent(name, affiliation, years=3)

    latest = articles[0] if articles else None
    last_ago = _ago(latest.get("date") or latest.get("year")) if latest else None
    years = [int(a["year"]) for a in articles if (a.get("year") or "").isdigit()]

    return {
        "total_count": total,
        "recent_per_year_3yr": round(recent_per_year, 1),
        "first_seen_year": min(years) if years else None,
        "latest_year": max(years) if years else None,
        "last_published": last_ago,
        "articles": [
            {k: a[k] for k in ("title", "journal", "year", "date", "url", "pmid")}
            for a in articles
        ],
        "affiliation_used": affiliation or None,
    }


async def _trials_block(ct: ClinicalTrialsService, name: str) -> Dict:
    trials = await ct.search_trials_by_investigator(name)
    lead = [t for t in trials if t.get("is_lead_investigator")]
    return {
        "total_count": len(trials),
        "as_lead_count": len(lead),
        "trials": trials[:15],
    }


async def _scholar_block(sc: ScholarService, name: str, specialty: str) -> Dict:
    # Best-effort: Scholar bot-blocks without a paid key, so failure is expected and
    # must not sink the whole enrichment.
    try:
        return await sc.search_guidelines(_clean_name(name), specialty)
    except Exception as exc:  # noqa: BLE001
        logger.info("Scholar enrichment skipped for %s: %s", name, exc)
        return {"intl_guidelines": False, "national_guidelines": False, "results": [],
                "error": "unavailable"}


async def enrich_record(
    *,
    name: str,
    specialty: str = "",
    city: str = "",
    institution: str = "",
    pubmed_api_key: str = "",
    pubmed_email: str = "",
    user_id: Optional[int] = None,
) -> Dict:
    """Gather the full research footprint for one candidate. Never raises — each
    source degrades to an error marker so a partial result still reaches the UI."""
    person = _clean_name(name)
    # City is a better PubMed affiliation filter than a clinic brand name, which
    # rarely appears in author affiliations.
    affiliation = (city or "").strip()

    pm = PubMedService(api_key=pubmed_api_key, email=pubmed_email)
    ct = ClinicalTrialsService()
    sc = ScholarService(user_id=user_id)   # the owner's Scholar key first, then the platform's

    async def guarded(coro, label):
        try:
            return await coro
        except Exception as exc:  # noqa: BLE001
            logger.warning("Enrichment %s failed for %s: %s", label, name, exc)
            return {"error": str(exc.__class__.__name__)}

    pubmed, trials, scholar = await asyncio.gather(
        guarded(_pubmed_block(pm, person, affiliation), "pubmed"),
        guarded(_trials_block(ct, person), "trials"),
        guarded(_scholar_block(sc, person, specialty), "scholar"),
    )

    return {
        "pubmed": pubmed,
        "clinical_trials": trials,
        "scholar": scholar,
        "links": _search_links(name, specialty, city),
        "matched_on": {"name": person, "affiliation": affiliation or None,
                       "specialty": specialty or None},
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
