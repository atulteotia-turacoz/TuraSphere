"""Cross-source enrichment service.
After all sources score their assigned parameters, this service fills in
zero-scored parameters using data from ANY available source.

Philosophy: Any source that has relevant data should contribute to any
parameter's score. A parameter should not stay at 0 just because its
primary source (e.g., CV) has no data, when another source (e.g., Practo)
has the needed information."""

import json
import logging
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)


def enrich_scores_cross_source(
    param_scores: List[Dict[str, Any]],
    pubmed_data: Optional[Dict[str, Any]] = None,
    practo_data: Optional[Dict[str, Any]] = None,
    clinical_trials_data: Optional[Dict[str, Any]] = None,
    scholar_data: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Enrich parameter scores using data from ALL available sources.

    For any parameter that scored 0, check if alternative sources have
    relevant data that could provide a non-zero score. If so, update
    the score, justification, and source info.

    Returns the enriched param_scores list (modified in-place).
    """
    if not param_scores:
        return param_scores

    pubmed = pubmed_data or {}
    practo = practo_data or {}
    ct_data = clinical_trials_data or {}
    scholar = scholar_data or {}

    practo_found = practo.get("profile_found", False)
    practo_source_json = json.dumps({
        "profile_found": practo_found,
        "profile_url": practo.get("profile_url", ""),
        "name": practo.get("name", ""),
        "specialty": practo.get("specialty", ""),
        "experience_years": practo.get("experience_years", 0),
        "rating": practo.get("rating", 0),
        "reviews_count": practo.get("reviews_count", 0),
        "hospital": practo.get("hospital", ""),
        "qualifications": practo.get("qualifications", []),
    }) if practo_found else None

    enriched_count = 0

    for ps in param_scores:
        # Only enrich parameters that scored 0
        if ps["score"] > 0:
            continue

        code = ps["parameter_code"]
        max_score = ps["max_score"]
        if max_score <= 0:
            continue

        new_score, new_justification, new_source, new_source_data = _try_alternative_sources(
            code, max_score, pubmed, practo, ct_data, scholar
        )

        if new_score > 0:
            ps["score"] = min(round(new_score, 1), max_score)
            ps["justification"] = new_justification
            ps["scoring_source"] = new_source
            if new_source == "practo" and practo_source_json:
                ps["source_data"] = practo_source_json
            elif new_source_data:
                ps["source_data"] = new_source_data
            enriched_count += 1

    if enriched_count > 0:
        logger.info(f"Cross-source enrichment: {enriched_count} parameters enhanced from alternative sources")

    return param_scores


def _try_alternative_sources(
    code: str,
    max_score: float,
    pubmed: Dict,
    practo: Dict,
    ct_data: Dict,
    scholar: Dict,
) -> tuple:
    """Try to score a parameter from alternative sources.

    Returns: (score, justification, source_name, source_data_json) or (0, "", "", None)
    """
    practo_found = practo.get("profile_found", False)
    practo_exp = practo.get("experience_years", 0) if practo_found else 0
    practo_rating = practo.get("rating", 0) if practo_found else 0
    practo_reviews = practo.get("reviews_count", 0) if practo_found else 0
    practo_hospital = practo.get("hospital", "") if practo_found else ""
    practo_quals = practo.get("qualifications", []) if practo_found else []
    practo_recs = practo.get("recommendations_count", 0) if practo_found else 0
    practo_name = practo.get("name", "") if practo_found else ""

    pubmed_total = pubmed.get("total_publications", 0)
    pubmed_5yr = pubmed.get("publications_last_5_years", 0)
    pubmed_ppy = pubmed.get("pubs_per_year_recent", 0)
    pubmed_coauthors = pubmed.get("coauthor_count", 0)
    pubmed_intl = pubmed.get("international_journals", 0)
    pubmed_growth = pubmed.get("pub_growth_rate")
    pubmed_pagerank = pubmed.get("pagerank_percentile")

    trials_led = ct_data.get("trials_led", 0)

    # ── Selection Criteria - Experience ──
    if code == "SC_YEARS_EXPERIENCE":
        if practo_exp >= 15:
            return max_score, f"Practo profile shows {practo_exp} years of experience (15+ → full score).", "practo", None
        elif practo_exp >= 10:
            score = round(max_score * 0.75, 1)
            return score, f"Practo profile shows {practo_exp} years of experience (10-15 range).", "practo", None
        elif practo_exp >= 5:
            score = round(max_score * 0.5, 1)
            return score, f"Practo profile shows {practo_exp} years of experience (5-10 range).", "practo", None
        elif practo_exp >= 1:
            score = round(max_score * 0.25, 1)
            return score, f"Practo profile shows {practo_exp} years of experience.", "practo", None

    # ── Selection Criteria - Qualifications ──
    if code == "SC_GRADUATION":
        if practo_quals:
            quals_str = ", ".join(practo_quals[:3])
            for q in practo_quals:
                ql = q.lower()
                if any(kw in ql for kw in ["mbbs", "bds", "bams", "bhms", "bpt", "graduation", "bachelor"]):
                    return max_score, f"Graduation qualification found on Practo: {quals_str}", "practo", None
            # General qualification found
            return round(max_score * 0.5, 1), f"Qualifications found on Practo: {quals_str}", "practo", None

    if code == "SC_POST_GRADUATION":
        if practo_quals:
            quals_str = ", ".join(practo_quals[:3])
            for q in practo_quals:
                ql = q.lower()
                if any(kw in ql for kw in ["md", "ms", "mds", "mch", "dm", "dnb", "fellow", "post"]):
                    return max_score, f"Post-graduation found on Practo: {quals_str}", "practo", None

    if code == "SC_FELLOWSHIP":
        if practo_quals:
            for q in practo_quals:
                if "fellow" in q.lower():
                    return max_score, f"Fellowship found on Practo: {q}", "practo", None

    # ── Selection Criteria - Publications (from PubMed) ──
    if code == "SC_PUB_NATIONAL":
        if pubmed_total >= 1:
            return max_score, f"Found {pubmed_total} publications on PubMed (cross-source).", "pubmed", None

    if code == "SC_PUB_INTERNATIONAL":
        if pubmed_intl >= 1:
            return max_score, f"Found {pubmed_intl} international publications on PubMed (cross-source).", "pubmed", None

    # ── C.1 Leadership ──
    if code == "C1_TOP_INSTITUTION":
        if practo_hospital:
            top_keywords = ["aiims", "apollo", "fortis", "max", "medanta", "tata memorial",
                           "narayana", "manipal", "kokilaben", "lilavati", "breach candy",
                           "hinduja", "jaslok", "sir ganga ram", "pgimer", "nimhans",
                           "christian medical", "safdarjung", "ram manohar", "king edward"]
            hospital_lower = practo_hospital.lower()
            if any(kw in hospital_lower for kw in top_keywords):
                return max_score, f"Affiliated with top institution: {practo_hospital} (via Practo).", "practo", None
            else:
                # Still give partial score for having a hospital affiliation
                return round(max_score * 0.3, 1), f"Affiliated with {practo_hospital} (via Practo).", "practo", None

    # ── C.3 Publications (from PubMed for CV-assigned params) ──
    if code == "C3_1_TO_5_ARTICLES":
        if 1 <= pubmed_5yr <= 5:
            return max_score, f"Found {pubmed_5yr} articles in last 5 years on PubMed (cross-source).", "pubmed", None
        elif pubmed_5yr > 5:
            return max_score, f"Found {pubmed_5yr} articles (exceeds 1-5 range, cross-source).", "pubmed", None

    if code == "C3_5_TO_10_ARTICLES":
        if pubmed_5yr >= 5:
            return max_score, f"Found {pubmed_5yr} articles in last 5 years on PubMed (cross-source).", "pubmed", None

    if code == "C3_INTL_PUBLICATION":
        if pubmed_intl >= 1:
            return max_score, f"Found {pubmed_intl} international journal articles on PubMed (cross-source).", "pubmed", None

    # ── C.4 Clinical Experience ──
    if code == "C4_YEARS_CLINICAL":
        if practo_exp >= 15:
            return max_score, f"Practo confirms {practo_exp} years of clinical experience (15+ → full score).", "practo", None
        elif practo_exp >= 10:
            score = round(max_score * 0.75, 1)
            return score, f"Practo confirms {practo_exp} years of clinical experience.", "practo", None
        elif practo_exp >= 5:
            score = round(max_score * 0.5, 1)
            return score, f"Practo confirms {practo_exp} years of clinical experience.", "practo", None
        elif practo_exp >= 1:
            score = round(max_score * 0.25, 1)
            return score, f"Practo shows {practo_exp} years of clinical experience.", "practo", None

    # ── C.5 Citation Velocity (from PubMed for CV-assigned params) ──
    if code == "C5_10_PLUS_PUBS_YR":
        if pubmed_ppy > 10:
            return max_score, f"Publishing {pubmed_ppy:.1f} articles/year (>10, cross-source from PubMed).", "pubmed", None

    if code == "C5_5_TO_10_PUBS_YR":
        if pubmed_ppy >= 5:
            return max_score, f"Publishing {pubmed_ppy:.1f} articles/year (5-10 range, cross-source).", "pubmed", None

    if code == "C5_2_TO_5_PUBS_YR":
        if pubmed_ppy >= 2:
            return max_score, f"Publishing {pubmed_ppy:.1f} articles/year (2-5 range, cross-source).", "pubmed", None

    # ── C.6 Network Centrality (from PubMed) ──
    if code == "C6_PAGERANK_TOP_10":
        if pubmed_pagerank is not None and pubmed_pagerank >= 90:
            return max_score, f"PageRank {pubmed_pagerank:.1f}% (top 10%, cross-source from PubMed).", "pubmed", None

    if code == "C6_PAGERANK_TOP_25":
        if pubmed_pagerank is not None and pubmed_pagerank >= 75:
            return max_score, f"PageRank {pubmed_pagerank:.1f}% (top 25%, cross-source from PubMed).", "pubmed", None

    if code == "C6_COAUTHORS_20_PLUS":
        if pubmed_coauthors > 20:
            return max_score, f"{pubmed_coauthors} co-authors on PubMed (>20, cross-source).", "pubmed", None

    # ── C.7 Patient Impact (from ClinicalTrials) ──
    if code == "C7_5_PLUS_TRIALS":
        if trials_led >= 5:
            return max_score, f"Led {trials_led} clinical trials (cross-source from ClinicalTrials.gov).", "clinical_trials", None

    if code == "C7_3_TO_4_TRIALS":
        if trials_led >= 3:
            return max_score, f"Led {trials_led} clinical trials (cross-source).", "clinical_trials", None

    if code == "C7_1_TO_2_TRIALS":
        if trials_led >= 1:
            return max_score, f"Led {trials_led} clinical trial(s) (cross-source).", "clinical_trials", None

    # ── C.8 Guideline Authority (from Google Scholar) ──
    if code == "C8_INTL_GUIDELINE":
        if scholar.get("intl_guidelines"):
            return max_score, "International guideline authorship detected (cross-source from Google Scholar).", "google_scholar", None

    if code == "C8_NATL_GUIDELINE":
        if scholar.get("national_guidelines"):
            return max_score, "National guideline authorship detected (cross-source from Google Scholar).", "google_scholar", None

    # ── C.9 Emerging Leader ──
    if code == "C9_PUB_GROWTH_20PCT":
        if pubmed_growth is not None and pubmed_growth > 20:
            return max_score, f"Publication growth {pubmed_growth:.1f}%/year (cross-source from PubMed).", "pubmed", None

    # ── SC_FACULTY_POSITIONS ──
    if code == "SC_FACULTY_POSITIONS":
        if practo_quals:
            for q in practo_quals:
                ql = q.lower()
                if any(kw in ql for kw in ["professor", "faculty", "teaching", "hod", "head of"]):
                    return max_score, f"Faculty/teaching position indicated on Practo: {q}", "practo", None

    # No alternative source could score this parameter
    return 0, "", "", None
