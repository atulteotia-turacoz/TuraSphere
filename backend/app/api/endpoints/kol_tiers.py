"""KOL tier bands — Account → KOL Tiers.

The six tiers used to be `if score >= N` branches in ScoringEngine. They are
rows now so the bands can be retuned without a deploy.
"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, get_super_admin
from app.models.user import User
from app.models.kol_tier import KolTier
from app.models.assessment import Assessment
from app.services.scoring_engine import ScoringEngine

router = APIRouter(prefix="/account", tags=["KOL Tiers"])


DEFAULT_BANDS = [
    ("GLOBAL_KOL", "Global KOL", 45, None, "#7C3AED", 1),
    ("STRATEGIC_KOL", "Strategic KOL", 35, 44.99, "#3A57A7", 2),
    ("NATIONAL_KOL", "National KOL", 25, 34.99, "#3E8E8D", 3),
    ("EMERGING_KOL", "Emerging KOL", 15, 24.99, "#3EA151", 4),
    ("LOCAL_KOL", "Local KOL", 5, 14.99, "#C77700", 5),
    ("NON_KOL", "Non KOL", 0, 4.99, "#6B7280", 6),
]


def _tiers_for(db: Session, user_id: int):
    """This account's tiers, seeded from the template on first use.

    Tiers are per-account like assessment-parameter preferences and master data.
    They were briefly global, which meant any user editing a band changed the
    bands — and re-tiered the stored assessments — for every other account.
    """
    rows = db.query(KolTier).filter(KolTier.user_id == user_id).all()
    if rows:
        return rows

    # Seed ONCE per account, tracked on the user rather than inferred from the
    # table being empty. An admin who deliberately clears an account's bands —
    # to rebuild them from scratch — must not have the six defaults reappear on
    # the next page load.
    owner = db.query(User).filter(User.id == user_id).first()
    if owner is not None and getattr(owner, "kol_tiers_seeded", False):
        return []

    template = db.query(KolTier).filter(KolTier.user_id.is_(None)).order_by(KolTier.sort_order).all()
    source = [(t.code, t.name, t.min_score, t.max_score, t.color, t.sort_order) for t in template] or DEFAULT_BANDS
    for code, name, lo, hi, color, order in source:
        db.add(KolTier(user_id=user_id, code=code, name=name, min_score=lo,
                       max_score=hi, color=color, sort_order=order, is_standard=True))
    if owner is not None:
        owner.kol_tiers_seeded = True
    db.commit()
    return db.query(KolTier).filter(KolTier.user_id == user_id).all()


def _retier_existing(db: Session, user_id: int) -> int:
    """Re-derive the stored tier on every assessment from its stored score.

    The tier is frozen onto the assessment when it is scored, so moving a band
    afterwards changed nothing anyone could see — an HCP on 45.0 kept showing as
    Global KOL after Global was raised to 55+. The score is the durable fact and
    the tier is derived from it, so re-deriving on a band change is cheap and
    is what "I changed the range" is expected to mean.
    """
    from app.models.hcp import HCPProfile
    changed = 0
    # Only this account's assessments. Re-tiering every row in the table would
    # rewrite other accounts' results from one user's band edit.
    owned = (
        db.query(Assessment)
        .join(HCPProfile, HCPProfile.id == Assessment.hcp_id)
        .filter(HCPProfile.user_id == user_id)
        .all()
    )
    for assessment in owned:
        if assessment.final_score is None:
            continue
        new_tier = ScoringEngine.determine_tier(float(assessment.final_score), db=db, user_id=user_id)
        if new_tier != assessment.tier:
            assessment.tier = new_tier
            changed += 1
    if changed:
        db.commit()
    return changed


def _coverage_gaps(db: Session, user_id: int):
    """Score ranges no active band covers, so the UI can warn about them."""
    tiers = (
        db.query(KolTier)
        .filter(KolTier.user_id == user_id, KolTier.is_active == True)  # noqa: E712
        .order_by(KolTier.min_score)
        .all()
    )
    if not tiers:
        return ["0 and above"]
    gaps = []
    cursor = 0.0
    for tier in tiers:
        if tier.min_score > cursor:
            gaps.append(f"{round(cursor, 2)}-{round(tier.min_score - 0.01, 2)}")
        upper = tier.max_score if tier.max_score is not None else float("inf")
        if upper == float("inf"):
            return gaps
        cursor = max(cursor, upper + 0.01)
    gaps.append(f"{round(cursor, 2)} and above")
    return gaps


class TierIn(BaseModel):
    code: Optional[str] = None
    name: str
    min_score: float
    max_score: Optional[float] = None
    color: Optional[str] = None
    # None, not 0 — an update that omits sort_order must leave the band where
    # it is. Defaulting to 0 made every edit flatten the band to first position.
    sort_order: Optional[int] = None
    is_active: Optional[bool] = True

    @field_validator("max_score")
    @classmethod
    def _range_must_make_sense(cls, v, info):
        lo = info.data.get("min_score")
        if v is not None and lo is not None and v < lo:
            raise ValueError("Highest score must be greater than or equal to lowest score")
        return v


def _out(t: KolTier) -> dict:
    return {
        "id": t.id, "code": t.code, "name": t.name,
        "min_score": t.min_score, "max_score": t.max_score,
        "color": t.color, "sort_order": t.sort_order,
        "is_active": t.is_active, "is_standard": t.is_standard,
    }


def _overlaps(db: Session, user_id: int, lo: float, hi: Optional[float], exclude_id: Optional[int] = None):
    """Two active bands covering the same score would make tiering arbitrary."""
    q = db.query(KolTier).filter(KolTier.user_id == user_id, KolTier.is_active == True)  # noqa: E712
    if exclude_id:
        q = q.filter(KolTier.id != exclude_id)
    for other in q.all():
        o_lo = other.min_score
        o_hi = other.max_score if other.max_score is not None else float("inf")
        n_hi = hi if hi is not None else float("inf")
        if lo <= o_hi and o_lo <= n_hi:
            return other
    return None


@router.get("/tiers")
def list_tiers(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Returns a plain list. It briefly returned {tiers, coverage_gaps} and that
    # broke every client still running the previous bundle with a
    # "tiers.map is not a function" — changing an existing response from array
    # to object is not a backwards-compatible change. Gaps are derived from
    # this same list on the client instead, so there is no second shape.
    _tiers_for(db, current_user.id)
    tiers = (
        db.query(KolTier)
        .filter(KolTier.user_id == current_user.id)
        .order_by(KolTier.sort_order, KolTier.id)
        .all()
    )
    return [_out(t) for t in tiers]


# ── Writes are super-admin only ──────────────────────────────────────────────
# Tier bands decide how every stored assessment is labelled, and re-tiering runs
# across the whole account the moment a band moves. That is not a setting an end
# user should be able to change for themselves, so the account page shows them
# read-only and a super admin maintains them per user from the admin panel.
#
# The bodies below take an explicit `owner_id` rather than reading
# `current_user`, because the super admin is editing SOMEONE ELSE'S bands.

def _create_tier(owner_id: int, data: "TierIn", db: Session) -> dict:
    code = (data.code or data.name).strip().upper().replace(" ", "_").replace("-", "_")
    if not code:
        raise HTTPException(status_code=400, detail="Name is required")
    if db.query(KolTier).filter(KolTier.user_id == owner_id, KolTier.code == code).first():
        raise HTTPException(status_code=400, detail=f"A tier with code {code} already exists")
    if data.is_active:
        clash = _overlaps(db, owner_id, data.min_score, data.max_score)
        if clash:
            raise HTTPException(
                status_code=400,
                detail=f"That range overlaps “{clash.name}” ({clash.min_score}–"
                       f"{clash.max_score if clash.max_score is not None else '∞'}). "
                       f"Bands cannot overlap — narrow “{clash.name}” first, then add this one.",
            )
    tier = KolTier(
        user_id=owner_id,
        code=code, name=data.name.strip(), min_score=data.min_score, max_score=data.max_score,
        color=data.color, sort_order=data.sort_order or 0,
        is_active=bool(data.is_active), is_standard=False,
    )
    db.add(tier)
    db.commit()
    db.refresh(tier)
    result = _out(tier)
    result["retiered"] = _retier_existing(db, owner_id)
    result["coverage_gaps"] = _coverage_gaps(db, owner_id)
    return result


def _update_tier(owner_id: int, tier_id: int, data: "TierIn", db: Session) -> dict:
    tier = db.query(KolTier).filter(
        KolTier.id == tier_id, KolTier.user_id == owner_id
    ).first()
    if not tier:
        raise HTTPException(status_code=404, detail="Tier not found")
    if data.is_active:
        clash = _overlaps(db, owner_id, data.min_score, data.max_score, exclude_id=tier_id)
        if clash:
            raise HTTPException(
                status_code=400,
                detail=f"That range overlaps “{clash.name}” ({clash.min_score}–"
                       f"{clash.max_score if clash.max_score is not None else '∞'}). "
                       f"Bands cannot overlap — narrow “{clash.name}” first, then widen this one.",
            )
    tier.name = data.name.strip()
    tier.min_score = data.min_score
    tier.max_score = data.max_score
    tier.color = data.color
    # Keep the existing position when the caller does not send one — the
    # admin editor has no sort field, and `or 0` was flattening every band it
    # touched to position 0.
    if data.sort_order is not None:
        tier.sort_order = data.sort_order
    tier.is_active = bool(data.is_active)
    db.commit()
    db.refresh(tier)
    result = _out(tier)
    result["retiered"] = _retier_existing(db, owner_id)
    result["coverage_gaps"] = _coverage_gaps(db, owner_id)
    return result


def _delete_tier(owner_id: int, tier_id: int, db: Session) -> dict:
    tier = db.query(KolTier).filter(
        KolTier.id == tier_id, KolTier.user_id == owner_id
    ).first()
    if not tier:
        raise HTTPException(status_code=404, detail="Tier not found")
    # `is_standard` used to block deletion outright. That guard dates from when
    # tiers were GLOBAL, where deleting one hit every account. They are
    # per-account copies now and only a super admin can get here, so a seeded
    # band is deletable like any other.
    #
    # It is safe: `assessments.tier` is a plain String(50) with no foreign key,
    # so a past assessment keeps the label it was scored with either way. What
    # the caller does need to know is the fallout, and both numbers are in the
    # response — how many assessments re-tiered, and any range now uncovered.
    db.delete(tier)
    db.commit()
    return {
        "detail": "Tier deleted",
        "retiered": _retier_existing(db, owner_id),
        "coverage_gaps": _coverage_gaps(db, owner_id),
    }


# ── Super-admin routes, scoped to a target account ───────────────────────────

def _target_user_or_404(user_id: int, db: Session) -> User:
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return u


@router.get("/users/{user_id}/tiers")
def admin_list_tiers(user_id: int, db: Session = Depends(get_db),
                     admin=Depends(get_super_admin)):
    """One account's tier bands, seeded from the template if it has none yet."""
    _target_user_or_404(user_id, db)
    _tiers_for(db, user_id)
    tiers = (
        db.query(KolTier)
        .filter(KolTier.user_id == user_id)
        .order_by(KolTier.sort_order, KolTier.id)
        .all()
    )
    return {"tiers": [_out(t) for t in tiers], "coverage_gaps": _coverage_gaps(db, user_id)}


@router.post("/users/{user_id}/tiers", status_code=201)
def admin_create_tier(user_id: int, data: TierIn, db: Session = Depends(get_db),
                      admin=Depends(get_super_admin)):
    _target_user_or_404(user_id, db)
    return _create_tier(user_id, data, db)


@router.put("/users/{user_id}/tiers/{tier_id}")
def admin_update_tier(user_id: int, tier_id: int, data: TierIn, db: Session = Depends(get_db),
                      admin=Depends(get_super_admin)):
    _target_user_or_404(user_id, db)
    return _update_tier(user_id, tier_id, data, db)


@router.delete("/users/{user_id}/tiers/{tier_id}")
def admin_delete_tier(user_id: int, tier_id: int, db: Session = Depends(get_db),
                      admin=Depends(get_super_admin)):
    _target_user_or_404(user_id, db)
    return _delete_tier(user_id, tier_id, db)


# ── The old end-user write routes ────────────────────────────────────────────
# Kept, rather than deleted, so a browser still running the previous bundle gets
# a clear explanation instead of a bare 404 from a vanished endpoint.

_READ_ONLY = ("Tier bands are managed by your administrator. "
              "Ask them to change a band for your account.")


@router.post("/tiers", status_code=403)
def create_tier_denied():
    raise HTTPException(status_code=403, detail=_READ_ONLY)


@router.put("/tiers/{tier_id}", status_code=403)
def update_tier_denied(tier_id: int):
    raise HTTPException(status_code=403, detail=_READ_ONLY)


@router.delete("/tiers/{tier_id}", status_code=403)
def delete_tier_denied(tier_id: int):
    raise HTTPException(status_code=403, detail=_READ_ONLY)
