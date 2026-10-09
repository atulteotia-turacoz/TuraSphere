"""Recognising an HCP we have already assessed.

The New Assessment page has no notion of identity: every submission created a
fresh `hcp_profiles` row, so uploading the same CV twice produced two records
for one person, two separate score histories, and no trail linking them. What a
reviewer actually wants in that case is the *existing* record re-assessed —
same HCP id, a new assessment against it, and an audit entry saying why.

Identity here is decided from what a CV reliably carries: the file itself, the
medical registration number, the email, the mobile, and the name (which alone
is never enough — plenty of "Dr Sharma"s). Matches are graded, because the
consequences differ: a `strong` match silently re-uses the existing record, a
`likely` one asks the user, a `weak` one is only ever a hint.
"""

import hashlib
import re
from typing import Iterable, List, Optional

from sqlalchemy.orm import Session

from app.models.hcp import HCPProfile


# Ordered strongest → weakest; `_RANK` turns that into something comparable.
CONFIDENCE_ORDER = ("exact", "strong", "likely", "weak")
_RANK = {c: i for i, c in enumerate(CONFIDENCE_ORDER)}

# At or above this grade the server re-uses the existing record without asking.
AUTO_MERGE_CONFIDENCES = ("exact", "strong")

# Titles and degree suffixes carried by a name in a CV header. "Prof. (Dr.) A
# K Sharma, MD, DM" and "Dr A K Sharma" are the same person, and only the
# stripped form makes that visible.
_NAME_NOISE = {
    "dr", "drs", "prof", "professor", "mr", "mrs", "ms", "miss", "sir", "smt",
    "md", "mbbs", "ms", "mch", "dm", "dnb", "phd", "frcs", "mrcp", "facc",
    "fesc", "faha", "fics", "facs", "frcp", "diploma", "capt", "col", "maj",
    "lt", "brig", "the", "late",
}

# A name the form invents rather than reads — never an identity signal.
_PLACEHOLDER_NAMES = {"unnamed hcp", "unnamed", "hcp", "cv", "resume"}


def normalize_name(value: Optional[str]) -> str:
    if not value:
        return ""
    text = re.sub(r"[^a-z0-9]+", " ", str(value).lower())
    words = [w for w in text.split() if w and w not in _NAME_NOISE]
    joined = " ".join(words)
    return "" if joined in _PLACEHOLDER_NAMES else joined


def normalize_email(value: Optional[str]) -> str:
    if not value:
        return ""
    text = str(value).strip().lower()
    return text if "@" in text and "." in text.split("@")[-1] else ""


def normalize_mobile(value: Optional[str]) -> str:
    """Digits only, keyed on the last 10.

    A CV writes the same number as "+91 98765 43210", "098765 43210" or
    "9876543210"; comparing the raw strings finds none of them equal. Ten
    digits is the subscriber number in India and long enough elsewhere that a
    collision needs two people to share a number.
    """
    if not value:
        return ""
    digits = re.sub(r"\D", "", str(value))
    if len(digits) < 8:
        return ""
    return digits[-10:]


def normalize_registration(value: Optional[str]) -> str:
    """Uppercase alphanumerics — "MCI-12345", "MCI 12345", "mci12345" all match."""
    if not value:
        return ""
    text = re.sub(r"[^A-Z0-9]", "", str(value).upper())
    # Two or three characters is a fragment ("NA", "NIL"), not a registration.
    return text if len(text) >= 4 else ""


def _normalize_place(value: Optional[str]) -> str:
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", " ", str(value).lower()).strip()


def cv_fingerprint(file_bytes: bytes) -> str:
    """SHA-256 of the uploaded file — the same CV re-uploaded gives the same hex."""
    return hashlib.sha256(file_bytes).hexdigest()


def _better(a: str, b: str) -> str:
    return a if _RANK[a] <= _RANK[b] else b


def _candidate_query(db: Session, current_user, exclude_id: Optional[int]):
    query = db.query(HCPProfile)
    # Same visibility rule as the HCP list: a plain user is only ever matched
    # against their own records, so one account's CV never surfaces another's.
    if getattr(current_user, "role", "user") == "user":
        query = query.filter(HCPProfile.user_id == current_user.id)
    if exclude_id:
        query = query.filter(HCPProfile.id != exclude_id)
    return query


def find_duplicates(
    db: Session,
    current_user,
    *,
    full_name: Optional[str] = None,
    email: Optional[str] = None,
    mobile: Optional[str] = None,
    medical_registration_no: Optional[str] = None,
    city: Optional[str] = None,
    institution: Optional[str] = None,
    cv_hash: Optional[str] = None,
    exclude_id: Optional[int] = None,
) -> List[dict]:
    """Existing profiles that look like the same person, strongest match first.

    Every returned entry carries *why* it matched, because the UI has to say so
    — "matches an existing record" with no reason is not something a reviewer
    can act on.
    """
    want_name = normalize_name(full_name)
    want_email = normalize_email(email)
    want_mobile = normalize_mobile(mobile)
    want_reg = normalize_registration(medical_registration_no)
    want_city = _normalize_place(city)
    want_inst = _normalize_place(institution)
    want_hash = (cv_hash or "").strip().lower()

    if not any((want_name, want_email, want_mobile, want_reg, want_hash)):
        return []

    matches = []
    for hcp in _candidate_query(db, current_user, exclude_id).all():
        reasons = []
        confidence = None

        if want_hash and (getattr(hcp, "cv_file_hash", None) or "").lower() == want_hash:
            reasons.append("cv_file")
            confidence = "exact"

        if want_reg and normalize_registration(hcp.medical_registration_no) == want_reg:
            reasons.append("medical_registration_no")
            confidence = _better(confidence or "strong", "strong")

        if want_email and normalize_email(hcp.email) == want_email:
            reasons.append("email")
            confidence = _better(confidence or "strong", "strong")

        if want_mobile and normalize_mobile(hcp.mobile) == want_mobile:
            reasons.append("mobile")
            confidence = _better(confidence or "strong", "strong")

        if want_name and normalize_name(hcp.full_name) == want_name:
            reasons.append("full_name")
            # A name on its own is the weakest signal there is; the same name at
            # the same hospital or in the same city is a different matter.
            same_place = (
                (want_city and _normalize_place(hcp.city) == want_city)
                or (want_inst and _normalize_place(hcp.institution) == want_inst)
            )
            if same_place:
                reasons.append("city" if want_city and _normalize_place(hcp.city) == want_city
                               else "institution")
            name_grade = "likely" if same_place else "weak"
            confidence = _better(confidence or name_grade, name_grade)

        if not confidence:
            continue

        matches.append({
            "hcp_id": hcp.id,
            "full_name": hcp.full_name,
            "email": hcp.email,
            "mobile": hcp.mobile,
            "city": hcp.city,
            "institution": hcp.institution,
            "medical_registration_no": hcp.medical_registration_no,
            "status": hcp.status.value if hasattr(hcp.status, "value") else hcp.status,
            "created_at": hcp.created_at.isoformat() + "Z" if hcp.created_at else None,
            "confidence": confidence,
            "matched_on": reasons,
        })

    matches.sort(key=lambda m: (_RANK[m["confidence"]], -m["hcp_id"]))
    return matches


def attach_assessment_summary(db: Session, matches: Iterable[dict]) -> List[dict]:
    """Add each match's assessment history — the part that decides the message.

    "Already assessed on 4 Sep, NATIONAL_KOL" is what turns a duplicate warning
    into something the user understands; a bare name repeats what they typed.
    """
    from app.models.assessment import Assessment

    out = []
    for match in matches:
        rows = (
            db.query(Assessment)
            .filter(Assessment.hcp_id == match["hcp_id"])
            .order_by(Assessment.created_at.desc())
            .all()
        )
        latest = rows[0] if rows else None
        out.append({
            **match,
            "assessment_count": len(rows),
            "last_assessment": None if latest is None else {
                "id": latest.id,
                "tier": latest.tier,
                "final_score": latest.final_score,
                "created_at": latest.created_at.isoformat() + "Z" if latest.created_at else None,
            },
        })
    return out


def duplicate_report(db: Session, current_user, **kwargs) -> dict:
    """The payload both the CV extraction and the explicit check hand back."""
    matches = attach_assessment_summary(
        db, find_duplicates(db, current_user, **kwargs)
    )
    best = matches[0] if matches else None
    return {
        "matches": matches,
        "best_match": best,
        # The single question the caller is really asking: may I create a new
        # record, or is this someone we already hold?
        "auto_merge": bool(best and best["confidence"] in AUTO_MERGE_CONFIDENCES),
    }


MATCH_LABELS = {
    "cv_file": "the same CV file",
    "medical_registration_no": "medical registration number",
    "email": "email address",
    "mobile": "mobile number",
    "full_name": "name",
    "city": "city",
    "institution": "institution",
}


def describe_match(match: dict) -> str:
    """Human phrasing for the audit trail: "matched on email address, name"."""
    labels = [MATCH_LABELS.get(r, r) for r in match.get("matched_on", [])]
    return ", ".join(labels) if labels else "identity fields"
