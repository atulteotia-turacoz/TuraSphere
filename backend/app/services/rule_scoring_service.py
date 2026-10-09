"""Deterministic scoring — the same rubric, no LLM.

Used when an account has AI turned off. Every parameter below is decided by
counting or banding structured fields the form already collects, so the result
is reproducible: the same input always yields the same score, with no
temperature and no model drift.

Four parameters are *not* here because no rule can honestly decide them —
"unique clinical expertise", "description of surgical procedures" and "top
institution in the specialty" are judgement calls. They return 0 with a
justification saying they need manual review, and stay settable through the
manual scoring screen.
"""
from datetime import date
from typing import Dict, List, Any, Optional

# Rows arrive serialised as "a, b, c | d, e, f".
ROW_SEP = "|"
CELL_SEP = ","


def _rows(value) -> List[List[str]]:
    if not value:
        return []
    out = []
    for chunk in str(value).split(ROW_SEP):
        cells = [c.strip() for c in chunk.split(CELL_SEP) if c.strip()]
        if cells:
            out.append(cells)
    return out


def _year_of(cells: List[str]) -> Optional[int]:
    for c in cells:
        c = c.strip()
        if len(c) == 4 and c.isdigit():
            return int(c)
    return None


def _in_window(cells: List[str], years: int = 5) -> bool:
    y = _year_of(cells)
    return y is not None and y >= date.today().year - years


def _has(cells: List[str], word: str) -> bool:
    return any(word.lower() in c.lower() for c in cells)


def _text(form: Dict, key: str) -> str:
    return str(form.get(key) or "").strip()


def _int(form: Dict, key: str) -> Optional[int]:
    raw = form.get(key)
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return None


def _band(value: Optional[float], bands, max_score: float):
    """bands: list of (threshold, points) ordered high to low."""
    if value is None:
        return 0.0, "Not recorded."
    for threshold, points in bands:
        if value >= threshold:
            return min(points, max_score), f"{value} falls in the {threshold}+ band."
    return 0.0, f"{value} is below the lowest band."


DEGREE_WORDS = {
    "graduation": ("mbbs", "bds", "bams", "bhms", "bpt", "b.sc", "bsc nursing"),
    "post": ("md", "ms ", "m.s", "dnb", "dm ", "mch", "m.ch", "msc", "m.sc"),
    "fellowship": ("fellow", "frcs", "facs", "facp", "fics", "fams", "fesc"),
}


def score_parameters(parameters: List[Dict], form_data: Dict) -> List[Dict[str, Any]]:
    """Score the CV/form parameters by rule. Mirrors score_cv_with_ai's shape."""
    f = form_data or {}
    pubs = _rows(f.get("publications"))
    pres = _rows(f.get("conference_presentations"))
    adv = _rows(f.get("advisory_board"))
    books = _rows(f.get("textbooks"))
    office = _rows(f.get("office_bearer_positions"))
    faculty = _rows(f.get("faculty_positions"))
    education = _text(f, "education").lower()

    pres_recent = [r for r in pres if _in_window(r)]
    pres_intl = [r for r in pres_recent if _has(r, "international")]
    office_recent_intl = [r for r in office if _in_window(r) and _has(r, "international")]
    years = _int(f, "years_of_experience")
    procedures = _int(f, "procedures_per_year")
    age = _int(f, "age_estimate")

    def degree(kind):
        return any(w in education for w in DEGREE_WORDS[kind])

    NEEDS_REVIEW = (
        "Needs manual review — this criterion is a judgement call and AI scoring "
        "is off for this account."
    )

    results = []
    for p in parameters:
        code = p["code"]
        mx = float(p["max_score"])
        score, why = 0.0, "No evidence found."

        if code == "SC_GRADUATION":
            if degree("graduation"):
                score, why = mx, "A graduation degree is recorded."
        elif code == "SC_POST_GRADUATION":
            if degree("post"):
                score, why = mx, "A postgraduate degree is recorded."
        elif code == "SC_FELLOWSHIP":
            if degree("fellowship"):
                score, why = mx, "A fellowship qualification is recorded."
        elif code == "SC_OTHER_QUALIFICATION":
            if education and not (degree("graduation") or degree("post")):
                score, why = mx, "Other qualifications are recorded."
        elif code == "SC_NON_DOCTOR_DEGREE":
            if education and not degree("graduation"):
                score, why = mx, "A non-medical qualification is recorded."
        elif code in ("SC_YEARS_EXPERIENCE", "C4_YEARS_CLINICAL"):
            score, why = _band(years, [(15, 4), (10, 3), (5, 2), (0, 1)], mx)
            if years is not None:
                why = f"{years} years of experience."
        elif code in ("SC_SURGERIES_PER_YEAR", "C4_PROCEDURES_PER_YEAR"):
            score, why = _band(procedures, [(500, 4), (200, 3), (100, 2), (1, 1)], mx)
            if procedures is not None:
                why = f"{procedures} procedures per year."
        elif code == "SC_FACULTY_POSITIONS":
            if faculty:
                score, why = mx, f"{len(faculty)} faculty position(s) recorded."
        elif code in ("C1_BOARD_MEMBER", "C1_SOCIETY_LEADER"):
            if office:
                score, why = mx, f"{len(office)} office-bearer position(s) recorded."
        elif code == "C1_EXECUTIVE_BOARD":
            if office_recent_intl:
                score, why = mx, (
                    f"{len(office_recent_intl)} international office-bearer position(s) "
                    f"in the last 5 years."
                )
            elif office:
                why = "Office-bearer positions recorded, but none international within 5 years."
        elif code == "C1_ADVISORY_BOARDS":
            if adv:
                score, why = mx, f"{len(adv)} advisory board participation(s) recorded."
        elif code == "C2_1_TO_5_ENGAGEMENTS":
            n = len(pres_recent)
            if 1 <= n <= 5:
                score, why = mx, f"{n} speaking engagement(s) in the last 5 years."
            else:
                why = f"{n} engagement(s) in the last 5 years — outside the 1-5 band."
        elif code == "C2_5_TO_10_ENGAGEMENTS":
            n = len(pres_recent)
            if 5 <= n <= 10:
                score, why = mx, f"{n} speaking engagements in the last 5 years."
            else:
                why = f"{n} engagement(s) in the last 5 years — outside the 5-10 band."
        elif code == "C2_10_PLUS_ENGAGEMENTS":
            n = len(pres_recent)
            if n > 10:
                score, why = mx, f"{n} speaking engagements in the last 5 years."
            else:
                why = f"{n} engagement(s) in the last 5 years — fewer than 10."
        elif code == "C2_INTL_SPEAKER":
            n = len(pres_intl)
            if n >= 5:
                score, why = mx, f"{n} international engagements in the last 5 years."
            else:
                why = f"{n} international engagement(s) in the last 5 years — fewer than 5."
        elif code == "C3_TEXTBOOK_AUTHOR":
            if books:
                score, why = mx, f"{len(books)} textbook / chapter contribution(s) recorded."
        elif code == "C9_YOUNG_PROLIFIC":
            if age is not None and age < 45 and pubs:
                score, why = mx, f"Age approximately {age} with {len(pubs)} publication(s)."
            elif age is None:
                why = "No age estimate recorded."
            else:
                why = f"Age approximately {age}." if age >= 45 else "No publications recorded."
        elif code == "MEDICAL_REGISTRATION_NO":
            if _text(f, "medical_registration_no"):
                score, why = mx, "A medical registration number is recorded."
        elif code == "GOVERNMENT_ORGANISATION":
            val = _text(f, "affiliated_to_government").lower()
            if val and val not in ("no", "none", "false", "n/a"):
                score, why = mx, "Affiliated to a government organisation."
        elif code in ("SC_UNIQUE_EXPERTISE", "C4_UNIQUE_EXPERTISE"):
            if _text(f, "unique_expertise"):
                score, why = mx, f"Recorded: {_text(f, 'unique_expertise')[:80]}"
            else:
                why = NEEDS_REVIEW
        elif code in ("SC_SURGICAL_DESCRIPTION", "C1_TOP_INSTITUTION"):
            why = NEEDS_REVIEW

        results.append({
            "parameter_id": p["id"],
            "parameter_code": code,
            "parameter_name": p["name"],
            "parameter_category": p["category"],
            "score": round(min(score, mx), 2),
            "max_score": mx,
            "justification": why,
            "scoring_source": "rules",
        })
    return results
