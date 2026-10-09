"""Rank directory KOLs from the public data already on each row.

The formal KOL score is the Assessment's C.1–C.9 model (ScoringEngine), most of
which needs a person's own answers (leadership, presentations, editorial roles).
The criteria that public data CAN fill are scored here with the same engine and
the same thresholds, so a directory ranking and an assessment never disagree on
what a given publication count or trial count is worth:

  C.3  publications, last 5 years (volume part)   max 4   ← PubMed (enrichment)
  C.4  years of experience (years part)            max 4   ← experience_years
  C.5  publication velocity, pubs/yr over 3 yrs    max 3   ← PubMed (enrichment)
  C.7  trials led                                  max 3   ← ClinicalTrials.gov + CTRI (as PI)
  C.8  guideline authorship                        max 3   ← Google Scholar (enrichment)
                                                  ─────
                                                   max 17

Ties are broken by the raw numbers (publications, then trials, then experience).
A KOL without research data (not enriched) can only score on experience, which is
why the response says how many are enriched.
"""
import json
from typing import Dict, List, Optional

from app.services.scoring_engine import ScoringEngine

MAX_SCORE = 17
PARTS = ("publications", "velocity", "experience", "trials", "guidelines")


def _json(text: Optional[str]) -> Dict:
    try:
        return json.loads(text) if text else {}
    except (ValueError, TypeError):
        return {}


def score_kol(kol) -> Dict:
    """Score breakdown for one KOL row (directory or pending)."""
    data = _json(kol.enrichment_data) if kol.enrichment_status == "done" else {}
    pubmed = data.get("pubmed") or {}
    trials = data.get("clinical_trials") or {}
    scholar = data.get("scholar") or {}
    ctri = _json(getattr(kol, "ctri_data", None))

    pubs = int(pubmed.get("total_count") or 0) if not pubmed.get("error") else 0
    per_year = float(pubmed.get("recent_per_year_3yr") or 0) if not pubmed.get("error") else 0.0
    led = int(trials.get("as_lead_count") or 0) + int(ctri.get("pi_count") or 0)
    trial_total = int(trials.get("total_count") or 0) + int(ctri.get("trial_count") or 0)
    years = kol.experience_years or 0

    parts = {
        # Only the volume part of C.3 / the years part of C.4 is public; the rest
        # (editorial board, procedures…) needs the assessment, so these cap at 4.
        "publications": min(ScoringEngine.score_c3_publications({"publications_count": pubs})[0], 4),
        "velocity": ScoringEngine.score_c5_citation_velocity(per_year)[0],
        "experience": min(ScoringEngine.score_c4_clinical({"years_experience": years})[0], 4),
        "trials": ScoringEngine.score_c7_patient_impact(led)[0],
        "guidelines": ScoringEngine.score_c8_guideline_authority(
            bool(scholar.get("intl_guidelines")), bool(scholar.get("national_guidelines")))[0],
    }
    parts = {k: float(v) for k, v in parts.items()}
    return {
        "score": sum(parts.values()),
        "parts": parts,
        "publications": pubs,
        "pubs_per_year": per_year,
        "trials_led": led,
        "trials": trial_total,
        "experience_years": kol.experience_years,
        "enriched": kol.enrichment_status == "done",
    }


def _counts(values: List[Optional[str]], top: int = 8) -> List[Dict]:
    """[{label, count}] for the `top` most common values; the rest folded into "Other"."""
    tally: Dict[str, int] = {}
    for v in values:
        v = (v or "").strip()
        if v:
            tally[v] = tally.get(v, 0) + 1
    ranked = sorted(tally.items(), key=lambda kv: (-kv[1], kv[0].lower()))
    out = [{"label": k, "count": n} for k, n in ranked[:top]]
    rest = sum(n for _, n in ranked[top:])
    if rest:
        out.append({"label": "Other", "count": rest})
    return out


def _city(state_city: Optional[str]) -> Optional[str]:
    """'Malviya Nagar, Delhi' -> 'Delhi' (the broader place reads better on a chart)."""
    parts = [p.strip() for p in (state_city or "").split(",") if p.strip()]
    return parts[-1].title() if parts else None


def insights(kols: List, top: int = 10) -> Dict:
    scored = [(k, score_kol(k)) for k in kols]
    ranked = sorted(
        (x for x in scored if x[1]["score"] > 0),
        key=lambda x: (-x[1]["score"], -x[1]["publications"], -x[1]["trials"], -(x[1]["experience_years"] or 0)),
    )
    bands = [("0", 0, 0), ("1–4", 1, 4), ("5–8", 5, 8), ("9–12", 9, 12), ("13–17", 13, MAX_SCORE)]
    years = [k.experience_years for k in kols if k.experience_years]
    return {
        "total": len(kols),
        "max_score": MAX_SCORE,
        "enriched": sum(1 for _, s in scored if s["enriched"]),
        "with_contact": sum(1 for k in kols if k.email or k.contact_no),
        "avg_experience": round(sum(years) / len(years), 1) if years else None,
        "not_enriched_ids": [k.id for k, s in scored if not s["enriched"] and k.enrichment_status != "running"],
        "running": sum(1 for k in kols if k.enrichment_status == "running"),
        "top": [{
            "id": k.id,
            "name": " ".join(p for p in (k.title, k.first_name, k.last_name) if p),
            "specialty": k.specialty,
            "institution": k.institution,
            "place": k.state_city,
            **s,
        } for k, s in ranked[:top]],
        "score_bands": [{"label": lbl, "count": sum(1 for _, s in scored if lo <= s["score"] <= hi)}
                        for lbl, lo, hi in bands],
        "by_specialty": _counts([k.specialty for k in kols]),
        "by_place": _counts([_city(k.state_city) for k in kols]),
        "by_therapeutic_area": _counts([k.therapeutic_area for k in kols]),
    }
