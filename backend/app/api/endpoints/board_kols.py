"""
CRUD for the advisory-board module's own KOL list (Advisory Boards → KOLs).

The counterpart source is the KOL module's `hcp_profiles`, read-only from here.
A board's `kol_ids` can reference either — see `advisory_boards._normalize_kol_ids`
for the "own:5" / "hcp:31" tagging that keeps the two apart.
"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.board_kol import BoardKol

router = APIRouter(tags=["MABM - Board KOLs"])


class BoardKolCreate(BaseModel):
    name: str
    specialty: Optional[str] = None
    affiliation: Optional[str] = None
    country: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    tier: Optional[str] = "tier_2"
    notes: Optional[str] = None


class BoardKolUpdate(BaseModel):
    name: Optional[str] = None
    specialty: Optional[str] = None
    affiliation: Optional[str] = None
    country: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    tier: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


def _to_dict(k: BoardKol) -> dict:
    return {
        "id": k.id,
        "name": k.name,
        "specialty": k.specialty,
        "affiliation": k.affiliation,
        "country": k.country,
        "email": k.email,
        "phone": k.phone,
        "tier": k.tier or "tier_2",
        "notes": k.notes,
        "is_active": k.is_active,
        "created_at": k.created_at.isoformat() if k.created_at else None,
    }


def _owned_or_404(kol_id: int, db: Session, user: User) -> BoardKol:
    k = db.query(BoardKol).filter(
        BoardKol.id == kol_id, BoardKol.owner_user_id == user.id
    ).first()
    if not k:
        raise HTTPException(status_code=404, detail="KOL not found")
    return k


@router.get("/board-kols")
def list_board_kols(
    is_active: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(BoardKol).filter(BoardKol.owner_user_id == current_user.id)
    if is_active is not None:
        q = q.filter(BoardKol.is_active.is_(is_active))
    return [_to_dict(k) for k in q.order_by(BoardKol.created_at.desc()).all()]


@router.post("/board-kols", status_code=201)
def create_board_kol(
    data: BoardKolCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    k = BoardKol(
        owner_user_id=current_user.id,
        name=name,
        specialty=(data.specialty or None),
        affiliation=(data.affiliation or None),
        country=(data.country or None),
        email=(data.email or "").strip().lower() or None,
        phone=(data.phone or None),
        tier=data.tier or "tier_2",
        notes=(data.notes or None),
    )
    db.add(k)
    db.commit()
    db.refresh(k)
    return _to_dict(k)


@router.patch("/board-kols/{kol_id}")
def update_board_kol(
    kol_id: int,
    data: BoardKolUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    k = _owned_or_404(kol_id, db, current_user)
    payload = data.model_dump(exclude_unset=True)
    if "name" in payload:
        if not (payload["name"] or "").strip():
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        payload["name"] = payload["name"].strip()
    if "email" in payload and payload["email"]:
        payload["email"] = payload["email"].strip().lower()
    for field, value in payload.items():
        setattr(k, field, value)
    db.commit()
    db.refresh(k)
    return _to_dict(k)


@router.delete("/board-kols/{kol_id}")
def delete_board_kol(
    kol_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Removes the KOL from the account's list.

    Boards that referenced it keep the now-dangling "own:<id>" entry in their
    `kol_ids`; the board UI drops references it cannot resolve, which is the
    behaviour it already had for stale ids.
    """
    k = _owned_or_404(kol_id, db, current_user)
    db.delete(k)
    db.commit()
    return {"deleted": True}
