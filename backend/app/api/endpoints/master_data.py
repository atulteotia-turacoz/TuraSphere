from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional
from pydantic import BaseModel

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_admin, get_current_user, decode_token
from app.models.master_data import MasterData, MasterDataType, USER_MANAGED_TYPES, parse_keywords
from app.models.user import User

# Optional bearer — endpoints that work for both anon and authenticated callers
optional_oauth2 = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login", auto_error=False)

router = APIRouter(tags=["Master Data"])


# ─── Schemas ─────────────────────────────────────────────────────

class MasterDataCreate(BaseModel):
    type: str
    label: str
    value: str
    sort_order: int = 0
    is_active: bool = True


class MasterDataUpdate(BaseModel):
    label: Optional[str] = None
    value: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class CategoryCreate(BaseModel):
    type: str
    label: str
    value: Optional[str] = None  # auto-derived from label if missing
    # Supporting search terms, one per line — see MasterData.keywords.
    keywords: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True


class CategoryUpdate(BaseModel):
    label: Optional[str] = None
    value: Optional[str] = None
    keywords: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


def _slugify(text: str) -> str:
    out = []
    for ch in (text or "").strip().lower():
        if ch.isalnum():
            out.append(ch)
        elif ch in (" ", "-", "_", "/"):
            out.append("_")
    slug = "".join(out).strip("_")
    while "__" in slug:
        slug = slug.replace("__", "_")
    return slug or "item"


def _serialize(i: MasterData) -> dict:
    return {
        "id": i.id,
        "type": i.type.value if isinstance(i.type, MasterDataType) else i.type,
        "label": i.label,
        "value": i.value,
        "keywords": i.keywords or "",
        # Parsed form, so callers don't each re-implement the splitting.
        "keyword_list": parse_keywords(i.keywords),
        "sort_order": i.sort_order,
        "is_active": i.is_active,
        "is_global": i.user_id is None,
        "user_id": i.user_id,
    }


def _maybe_user(token: Optional[str], db: Session) -> Optional[User]:
    if not token:
        return None
    try:
        payload = decode_token(token)
        uid = payload.get("sub")
        if uid is None:
            return None
        return db.query(User).filter(User.id == int(uid)).first()
    except HTTPException:
        return None


# ─── Public endpoint (for frontend dropdowns) ───────────────────

@router.get("/master-data/active")
def list_active_master_data(
    type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    token: Optional[str] = Depends(optional_oauth2),
):
    """Active master data for dropdowns. Returns globals + caller's own rows when authenticated."""
    user = _maybe_user(token, db)

    query = db.query(MasterData).filter(MasterData.is_active == True)
    if type:
        query = query.filter(MasterData.type == type)
    if user is None:
        query = query.filter(MasterData.user_id.is_(None))
    else:
        query = query.filter(or_(MasterData.user_id.is_(None), MasterData.user_id == user.id))

    items = query.order_by(MasterData.sort_order.asc(), MasterData.label.asc()).all()
    return [
        {
            "id": i.id,
            "type": i.type.value if isinstance(i.type, MasterDataType) else i.type,
            "label": i.label,
            "value": i.value,
            # The KOL scrape dropdown reads these to show what a pick will search on.
            "keyword_list": parse_keywords(i.keywords),
            "is_global": i.user_id is None,
        }
        for i in items
    ]


# ─── User-scoped categories CRUD (per-user masters) ──────────────

@router.get("/account/categories")
def list_my_categories(
    type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List the caller's own category items. Includes inactive."""
    if type:
        if type not in {t.value for t in USER_MANAGED_TYPES}:
            raise HTTPException(status_code=400, detail="Type is not user-managed")
    query = db.query(MasterData).filter(MasterData.user_id == current_user.id)
    if type:
        query = query.filter(MasterData.type == type)
    else:
        query = query.filter(MasterData.type.in_([t.value for t in USER_MANAGED_TYPES]))
    items = query.order_by(MasterData.type, MasterData.sort_order.asc(), MasterData.label.asc()).all()
    return [_serialize(i) for i in items]


@router.post("/account/categories", status_code=201)
def create_my_category(
    data: CategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if data.type not in {t.value for t in USER_MANAGED_TYPES}:
        raise HTTPException(status_code=400, detail="Type is not user-managed")
    if not (data.label or "").strip():
        raise HTTPException(status_code=400, detail="Label is required")

    value = (data.value or _slugify(data.label)).strip()

    # Block duplicate against caller's own rows AND against global rows of the same type
    clash = db.query(MasterData).filter(
        MasterData.type == data.type,
        MasterData.value == value,
        or_(MasterData.user_id == current_user.id, MasterData.user_id.is_(None)),
    ).first()
    if clash:
        raise HTTPException(status_code=400, detail=f"A {data.type} with value '{value}' already exists")

    item = MasterData(
        type=data.type,
        label=data.label.strip(),
        value=value,
        # Store the normalised list so what is read back matches what is searched on.
        keywords="\n".join(parse_keywords(data.keywords)) or None,
        sort_order=data.sort_order,
        is_active=data.is_active,
        user_id=current_user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _serialize(item)


@router.put("/account/categories/{item_id}")
def update_my_category(
    item_id: int,
    data: CategoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = db.query(MasterData).filter(
        MasterData.id == item_id,
        MasterData.user_id == current_user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    payload = data.model_dump(exclude_unset=True)

    if "value" in payload and payload["value"]:
        clash = db.query(MasterData).filter(
            MasterData.type == item.type,
            MasterData.value == payload["value"],
            MasterData.id != item.id,
            or_(MasterData.user_id == current_user.id, MasterData.user_id.is_(None)),
        ).first()
        if clash:
            raise HTTPException(status_code=400, detail="An item with this value already exists")

    # Normalise the same way create does; an explicit empty string clears them.
    if "keywords" in payload:
        item.keywords = "\n".join(parse_keywords(payload.pop("keywords"))) or None

    for k, v in payload.items():
        if v is not None or k in ("sort_order", "is_active"):
            setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return _serialize(item)


@router.put("/account/categories/{item_id}/toggle")
def toggle_my_category(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = db.query(MasterData).filter(
        MasterData.id == item_id,
        MasterData.user_id == current_user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.is_active = not item.is_active
    db.commit()
    db.refresh(item)
    return _serialize(item)


@router.delete("/account/categories/{item_id}")
def delete_my_category(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = db.query(MasterData).filter(
        MasterData.id == item_id,
        MasterData.user_id == current_user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()
    return {"detail": "Deleted"}


# ─── Admin CRUD (existing — global rows) ─────────────────────────

@router.get("/admin/master-data")
def list_all_master_data(
    type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    """List all master data (including inactive) for admin."""
    query = db.query(MasterData)
    if type:
        query = query.filter(MasterData.type == type)
    items = query.order_by(MasterData.type, MasterData.sort_order.asc(), MasterData.label.asc()).all()
    return [
        {
            "id": i.id,
            "type": i.type.value if isinstance(i.type, MasterDataType) else i.type,
            "label": i.label,
            "value": i.value,
            "sort_order": i.sort_order,
            "is_active": i.is_active,
            "user_id": i.user_id,
            "created_at": str(i.created_at) if i.created_at else None,
            "updated_at": str(i.updated_at) if i.updated_at else None,
        }
        for i in items
    ]


@router.post("/admin/master-data", status_code=201)
def create_master_data(
    data: MasterDataCreate,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    valid_types = [t.value for t in MasterDataType]
    if data.type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid type. Must be one of: {', '.join(valid_types)}")

    existing = db.query(MasterData).filter(
        MasterData.type == data.type,
        MasterData.value == data.value,
        MasterData.user_id.is_(None),
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"A {data.type} with value '{data.value}' already exists")

    item = MasterData(
        type=data.type,
        label=data.label,
        value=data.value,
        sort_order=data.sort_order,
        is_active=data.is_active,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _serialize(item)


@router.put("/admin/master-data/{item_id}")
def update_master_data(
    item_id: int,
    data: MasterDataUpdate,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    item = db.query(MasterData).filter(MasterData.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    update_data = data.model_dump(exclude_unset=True)

    if "value" in update_data:
        existing = db.query(MasterData).filter(
            MasterData.type == item.type,
            MasterData.value == update_data["value"],
            MasterData.id != item_id,
            MasterData.user_id == item.user_id,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"A {item.type.value} with this value already exists")

    for key, val in update_data.items():
        setattr(item, key, val)
    db.commit()
    db.refresh(item)
    return _serialize(item)


@router.put("/admin/master-data/{item_id}/toggle")
def toggle_master_data(
    item_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    item = db.query(MasterData).filter(MasterData.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.is_active = not item.is_active
    db.commit()
    db.refresh(item)
    return {"id": item.id, "is_active": item.is_active}


@router.delete("/admin/master-data/{item_id}")
def delete_master_data(
    item_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    item = db.query(MasterData).filter(MasterData.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()
    return {"detail": "Deleted"}
