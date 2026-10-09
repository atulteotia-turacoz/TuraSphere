"""PubMed-based scoring service.
Uses the admin-configured NCBI API key to fetch real publication data
and score publication-related parameters programmatically."""

import json
import logging
import asyncio
from typing import Dict, List, Any, Optional, Tuple
from sqlalchemy.orm import Session
from app.models.configuration import PubMedConfig
from app.services.pubmed_service import PubMedService, PUBMED_WINDOW_YEARS, default_window
from app.services.network_service import NetworkService

logger = logging.getLogger(__name__)


def get_default_pubmed_config(db: Session) -> Optional[PubMedConfig]:
    """Get the default active PubMed configuration."""
    config = db.query(PubMedConfig).filter(
        PubMedConfig.is_default == True,
        PubMedConfig.is_active == True,
    ).first()
    if not config:
        config = db.query(PubMedConfig).filter(
            PubMedConfig.is_active == True,
        ).first()
    return config


async def fetch_pubmed_data(
    author_name: str,
    affiliation: str,
    api_key: str = "",
    email: str = "",
) -> Dict[str, Any]:
    """Fetch all publication metrics from PubMed for an author."""
    pubmed = PubMedService(api_key=api_key, email=email)
    data = {
        "total_publications": 0,
        "publications_last_5_years": 0,
        "pubs_per_year_recent": 0.0,
        "coauthor_count": 0,
        "pagerank_percentile": None,
        "publication_history": {},
        "pub_growth_rate": None,
        "international_journals": 0,
        "recent_articles": [],
    }

    try:
        # Publication count — scoped to the assessment window, NOT the whole career.
        # This used to be an unfiltered all-time count (e.g. 444 lifetime vs 43 in
        # the last 5 years), which then drove SC_PUB_NATIONAL.
        total = await pubmed.get_publication_count(author_name, affiliation)
        data["total_publications"] = total

        # Publications in the window
        from datetime import datetime
        current_year = datetime.now().year
        win_min, win_max = default_window()
        search_5yr = await pubmed.search_publications(
            author_name, affiliation, min_date=win_min, max_date=win_max
        )
        data["publications_last_5_years"] = int(
            search_5yr.get("esearchresult", {}).get("count", 0)
        )

        # Pubs per year (last 3 years)
        data["pubs_per_year_recent"] = await pubmed.get_pubs_per_year_recent(
            author_name, affiliation, years=3
        )

        # Get article details for international journal detection
        pmids = search_5yr.get("esearchresult", {}).get("idlist", [])
        if pmids:
            articles = await pubmed.fetch_article_details(pmids[:50])
            # NCBI filters on the journal publication date, but we display the
            # ArticleDate (electronic pub date), which can be a year earlier — so an
            # article inside the window could still render as e.g. "2021" in a list
            # captioned "last 5 years". Drop those so the list matches its label.
            window_start = current_year - (PUBMED_WINDOW_YEARS - 1)
            articles = [
                a for a in articles
                if not (str(a.get("year", "")).isdigit() and int(a["year"]) < window_start)
            ]
            data["recent_articles"] = articles
            # Count international journals (simple heuristic)
            intl_keywords = ["international", "european", "american", "british",
                             "lancet", "nature", "science", "nejm", "bmj", "jama",
                             "annals", "global", "world"]
            intl_count = sum(
                1 for a in articles
                if any(kw in (a.get("journal", "") or "").lower() for kw in intl_keywords)
            )
            data["international_journals"] = intl_count

        # Co-authors and network analysis
        coauthors = await pubmed.get_coauthors(author_name, affiliation)
        data["coauthor_count"] = len(coauthors)

        if coauthors:
            # networkx's pagerank needs scipy, which isn't in requirements.txt. An
            # ImportError here used to bubble up to the outer handler and abandon
            # the whole fetch — losing publication_history and pub_growth_rate,
            # which are computed below. Keep it contained: no network score is
            # better than no PubMed data at all.
            try:
                percentile, _ = NetworkService.analyze_author_network(coauthors, author_name)
                data["pagerank_percentile"] = percentile
            except Exception as e:
                logger.warning(f"Co-author network analysis unavailable for {author_name}: {e}")

        # Publication history (per year across the window, for growth rate)
        history = {}
        for year in range(current_year - (PUBMED_WINDOW_YEARS - 1), current_year + 1):
            yr_data = await pubmed.search_publications(
                author_name, affiliation,
                min_date=f"{year}/01/01", max_date=f"{year}/12/31"
            )
            history[year] = int(yr_data.get("esearchresult", {}).get("count", 0))
            await asyncio.sleep(0.35)
        data["publication_history"] = history

        growth = PubMedService.calculate_growth_rate(history, recent_years=5)
        data["pub_growth_rate"] = growth

    except Exception as e:
        logger.error(f"Error fetching PubMed data for {author_name}: {e}")
        data["error"] = str(e)

    return data


def score_pubmed_parameters(
    parameters: List[Dict],
    pubmed_data: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Score publication-related parameters using real PubMed data."""
    results = []
    pubs_5yr = pubmed_data.get("publications_last_5_years", 0)
    pubs_per_year = pubmed_data.get("pubs_per_year_recent", 0)
    coauthor_count = pubmed_data.get("coauthor_count", 0)
    pagerank = pubmed_data.get("pagerank_percentile")
    growth_rate = pubmed_data.get("pub_growth_rate")
    intl_journals = pubmed_data.get("international_journals", 0)
    total_pubs = pubmed_data.get("total_publications", 0)

    # Include recent articles with hyperlinks in source data
    recent_articles = pubmed_data.get("recent_articles", [])
    source_summary = json.dumps({
        "total_publications": total_pubs,
        "publications_last_5_years": pubs_5yr,
        "pubs_per_year": round(pubs_per_year, 1),
        "coauthor_count": coauthor_count,
        "pagerank_percentile": round(pagerank, 1) if pagerank else None,
        "pub_growth_rate": round(growth_rate, 1) if growth_rate else None,
        "international_journals": intl_journals,
        "recent_articles": [
            {
                "title": a.get("title", ""),
                "journal": a.get("journal", ""),
                "year": a.get("year", ""),
                "pmid": a.get("pmid", ""),
                "doi": a.get("doi", ""),
                "url": a.get("url", ""),
            }
            for a in recent_articles[:20]
        ],
    })

    for p in parameters:
        code = p["code"]
        max_score = p["max_score"]
        score = 0.0
        justification = ""

        # --- Selection Criteria Publications ---
        if code == "SC_PUB_NATIONAL":
            if total_pubs >= 1:
                score = max_score
                justification = f"Found {total_pubs} publications on PubMed in the last {PUBMED_WINDOW_YEARS} years, indicating national-level publication activity."
            else:
                justification = f"No publications found on PubMed in the last {PUBMED_WINDOW_YEARS} years."

        elif code == "SC_PUB_INTERNATIONAL":
            if intl_journals >= 1:
                score = max_score
                justification = f"Found {intl_journals} publications in international journals on PubMed."
            else:
                justification = "No international journal publications found on PubMed."

        # --- C.3 Publications ---
        elif code == "C3_1_TO_5_ARTICLES":
            if 1 <= pubs_5yr <= 5:
                score = max_score
                justification = f"Found {pubs_5yr} peer-reviewed articles in the last 5 years on PubMed."
            elif pubs_5yr > 5:
                score = max_score
                justification = f"Found {pubs_5yr} articles (exceeds 1-5 range). Full score awarded."
            else:
                justification = f"Found {pubs_5yr} articles in the last 5 years on PubMed."

        elif code == "C3_5_TO_10_ARTICLES":
            if 5 <= pubs_5yr <= 10:
                score = max_score
                justification = f"Found {pubs_5yr} peer-reviewed articles in the last 5 years on PubMed."
            elif pubs_5yr > 10:
                score = max_score
                justification = f"Found {pubs_5yr} articles (exceeds 5-10 range). Full score awarded."
            else:
                justification = f"Found {pubs_5yr} articles (below 5 threshold) in the last 5 years."

        elif code == "C3_INTL_PUBLICATION":
            if intl_journals >= 1:
                score = max_score
                justification = f"Found {intl_journals} articles in international peer-reviewed journals."
            else:
                justification = "No publications in recognized international journals found on PubMed."

        elif code == "C3_TEXTBOOK_AUTHOR":
            # PubMed doesn't track textbooks well - score 0 and let AI handle from CV
            score = 0
            justification = "Textbook authorship cannot be verified via PubMed. Scored from CV if available."

        # --- C.5 Citation Velocity ---
        elif code == "C5_10_PLUS_PUBS_YR":
            if pubs_per_year > 10:
                score = max_score
                justification = f"Publishing {pubs_per_year:.1f} articles/year (>10/year threshold met)."
            else:
                justification = f"Publishing {pubs_per_year:.1f} articles/year (below >10/year threshold)."

        elif code == "C5_5_TO_10_PUBS_YR":
            if 5 <= pubs_per_year <= 10:
                score = max_score
                justification = f"Publishing {pubs_per_year:.1f} articles/year (5-10/year range)."
            elif pubs_per_year > 10:
                score = max_score
                justification = f"Publishing {pubs_per_year:.1f} articles/year (exceeds 5-10 range)."
            else:
                justification = f"Publishing {pubs_per_year:.1f} articles/year (below 5/year threshold)."

        elif code == "C5_2_TO_5_PUBS_YR":
            if 2 <= pubs_per_year <= 5:
                score = max_score
                justification = f"Publishing {pubs_per_year:.1f} articles/year (2-5/year range)."
            elif pubs_per_year > 5:
                score = max_score
                justification = f"Publishing {pubs_per_year:.1f} articles/year (exceeds 2-5 range)."
            else:
                justification = f"Publishing {pubs_per_year:.1f} articles/year (below 2/year threshold)."

        # --- C.6 Network Centrality ---
        elif code == "C6_PAGERANK_TOP_10":
            if pagerank is not None and pagerank >= 90:
                score = max_score
                justification = f"PageRank percentile: {pagerank:.1f}% (top 10% of co-author network)."
            else:
                pct = f"{pagerank:.1f}%" if pagerank else "N/A"
                justification = f"PageRank percentile: {pct} (not in top 10%)."

        elif code == "C6_PAGERANK_TOP_25":
            if pagerank is not None and pagerank >= 75:
                score = max_score
                justification = f"PageRank percentile: {pagerank:.1f}% (top 25% of co-author network)."
            else:
                pct = f"{pagerank:.1f}%" if pagerank else "N/A"
                justification = f"PageRank percentile: {pct} (not in top 25%)."

        elif code == "C6_COAUTHORS_20_PLUS":
            if coauthor_count > 20:
                score = max_score
                justification = f"Found {coauthor_count} unique co-authors on PubMed (>20 threshold met)."
            else:
                justification = f"Found {coauthor_count} unique co-authors on PubMed (below 20 threshold)."

        # --- C.9 Emerging Leader ---
        elif code == "C9_PUB_GROWTH_20PCT":
            if growth_rate is not None and growth_rate > 20:
                score = max_score
                justification = f"Publication growth rate: {growth_rate:.1f}%/year (>20% threshold met)."
            else:
                gr = f"{growth_rate:.1f}%" if growth_rate else "N/A"
                justification = f"Publication growth rate: {gr} (below 20% threshold)."

        else:
            justification = f"Parameter {code} not handled by PubMed scoring."

        results.append({
            "parameter_id": p["id"],
            "parameter_code": code,
            "parameter_name": p["name"],
            "parameter_category": p["category"],
            "score": min(round(score, 1), max_score),
            "max_score": max_score,
            "justification": justification,
            "scoring_source": "pubmed",
            "source_data": source_summary,
        })

    return results


async def score_clinical_trials_parameters(
    parameters: List[Dict],
    author_name: str,
) -> List[Dict[str, Any]]:
    """Score clinical trials parameters using ClinicalTrials.gov API."""
    from app.services.clinical_trials_service import ClinicalTrialsService

    results = []
    trial_data = {"trials_led": 0, "total_trials_found": 0}

    try:
        ct_service = ClinicalTrialsService()
        trial_data = await ct_service.get_trial_details(author_name)
    except Exception as e:
        logger.error(f"Error fetching clinical trials for {author_name}: {e}")
        trial_data["error"] = str(e)

    trials_led = trial_data.get("trials_led", 0)
    total_found = trial_data.get("total_trials_found", 0)
    source_summary = json.dumps({
        "trials_led": trials_led,
        "total_trials_found": total_found,
    })

    for p in parameters:
        code = p["code"]
        max_score = p["max_score"]
        score = 0.0
        justification = ""

        if code == "C7_5_PLUS_TRIALS":
            if trials_led >= 5:
                score = max_score
                justification = f"Led {trials_led} clinical trials on ClinicalTrials.gov (≥5 threshold met)."
            else:
                justification = f"Led {trials_led} clinical trials (below 5 threshold)."

        elif code == "C7_3_TO_4_TRIALS":
            if 3 <= trials_led <= 4:
                score = max_score
                justification = f"Led {trials_led} clinical trials (3-4 range)."
            elif trials_led > 4:
                score = max_score
                justification = f"Led {trials_led} clinical trials (exceeds 3-4 range)."
            else:
                justification = f"Led {trials_led} clinical trials (below 3 threshold)."

        elif code == "C7_1_TO_2_TRIALS":
            if 1 <= trials_led <= 2:
                score = max_score
                justification = f"Led {trials_led} clinical trial(s) (1-2 range)."
            elif trials_led > 2:
                score = max_score
                justification = f"Led {trials_led} clinical trials (exceeds 1-2 range)."
            else:
                justification = f"No clinical trials led found on ClinicalTrials.gov."

        results.append({
            "parameter_id": p["id"],
            "parameter_code": code,
            "parameter_name": p["name"],
            "parameter_category": p["category"],
            "score": min(round(score, 1), max_score),
            "max_score": max_score,
            "justification": justification,
            "scoring_source": "clinical_trials",
            "source_data": source_summary,
        })

    return results


async def score_google_scholar_parameters(
    parameters: List[Dict],
    author_name: str,
    specialty: str = "",
    user_id: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Score guideline parameters using Google Scholar (the owner's SerpAPI key first)."""
    from app.services.scholar_service import ScholarService

    results = []
    scholar_data = {"intl_guidelines": False, "national_guidelines": False}

    try:
        scholar = ScholarService(user_id=user_id)
        scholar_data = await scholar.search_guidelines(author_name, specialty)
    except Exception as e:
        logger.error(f"Error fetching Google Scholar data for {author_name}: {e}")
        scholar_data["error"] = str(e)

    intl = scholar_data.get("intl_guidelines", False)
    national = scholar_data.get("national_guidelines", False)
    source_summary = json.dumps({
        "intl_guidelines": intl,
        "national_guidelines": national,
        "results_count": len(scholar_data.get("results", [])),
    })

    for p in parameters:
        code = p["code"]
        max_score = p["max_score"]
        score = 0.0
        justification = ""

        if code == "C8_INTL_GUIDELINE":
            if intl:
                score = max_score
                justification = "International guideline authorship detected via Google Scholar."
            else:
                justification = "No international guideline authorship found on Google Scholar."

        elif code == "C8_NATL_GUIDELINE":
            if national:
                score = max_score
                justification = "National guideline authorship detected via Google Scholar."
            else:
                justification = "No national guideline authorship found on Google Scholar."

        results.append({
            "parameter_id": p["id"],
            "parameter_code": code,
            "parameter_name": p["name"],
            "parameter_category": p["category"],
            "score": min(round(score, 1), max_score),
            "max_score": max_score,
            "justification": justification,
            "scoring_source": "google_scholar",
            "source_data": source_summary,
        })

    return results


# ── CV fallback ──────────────────────────────────────────────────────────────

def publications_from_cv(publications_text: str, window_years: int = 5) -> dict:
    """Read the HCP's own publication rows into the shape PubMed scoring expects.

    Publication parameters are scored only from PubMed, so they land on 0
    whenever PubMed cannot find the author — a name spelled differently, a
    masked CV, or, commonly, journals PubMed does not index at all. A manual
    assessor reads the list off the CV and scores it; the tool ignored it.

    Rows arrive serialised as "title, year, journal, scope | title, year, ...".
    Only what is dated inside the window counts, matching the rubric's wording
    and the rule the AI prompt follows.
    """
    from datetime import date
    if not publications_text:
        return {}
    cutoff = date.today().year - window_years
    total = recent = intl_recent = 0
    for chunk in str(publications_text).split("|"):
        cells = [c.strip() for c in chunk.split(",") if c.strip()]
        if not cells:
            continue
        total += 1
        years = [c for c in cells if c.isdigit() and len(c) == 4]
        if not years:
            continue
        if int(years[0]) >= cutoff:
            recent += 1
            if any(c.lower() == "international" for c in cells):
                intl_recent += 1
    if not total:
        return {}
    return {
        "total_publications": total,
        "publications_last_5_years": recent,
        "international_journals": intl_recent,
        "pubs_per_year_recent": round(recent / window_years, 2),
        "coauthor_count": 0,
        "recent_articles": [],
        "_source": "cv",
    }
