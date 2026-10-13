from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from pydantic import BaseModel
from typing import Optional, List
from app.core.database import get_db
from app.core.security import get_current_user, get_current_admin
from app.models.user import User
from app.models.assessment_parameter import AssessmentParameter, UserParameterPreference

router = APIRouter()

# Categories that are "additional" (bonus) — default unchecked for users
ADDITIONAL_CATEGORIES = {"C.5 Citation Velocity", "C.6 Network Centrality", "C.7 Patient Impact", "C.8 Guideline Authority", "C.9 Emerging Leader", "C.10 Practo Patient Influence"}


# ─── Schemas ────────────────────────────────────────────────

class ParameterCreate(BaseModel):
    category: str
    code: str
    name: str
    description: Optional[str] = None
    max_score: float = 0
    score_group: Optional[str] = None
    group_max_score: Optional[float] = None
    is_active: bool = True
    is_standard: bool = True
    sort_order: int = 0

class ParameterUpdate(BaseModel):
    category: Optional[str] = None
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    max_score: Optional[float] = None
    score_group: Optional[str] = None
    group_max_score: Optional[float] = None
    is_active: Optional[bool] = None
    is_standard: Optional[bool] = None
    sort_order: Optional[int] = None

class ParameterOut(BaseModel):
    id: int
    category: str
    code: str
    name: str
    description: Optional[str]
    max_score: float
    score_group: Optional[str] = None
    group_max_score: Optional[float] = None
    is_active: bool
    is_standard: bool
    created_by: Optional[int]
    created_by_name: Optional[str] = None
    sort_order: int

    class Config:
        from_attributes = True

class UserParameterOut(BaseModel):
    id: int
    category: str
    code: str
    name: str
    description: Optional[str]
    max_score: float
    score_group: Optional[str] = None
    group_max_score: Optional[float] = None
    is_active: bool
    is_standard: bool
    is_additional: bool = False  # True for C.5-C.9 bonus params
    created_by: Optional[int]
    sort_order: int
    is_enabled: bool

class UserParameterToggle(BaseModel):
    parameter_id: int
    is_enabled: bool

class BulkToggle(BaseModel):
    preferences: List[UserParameterToggle]

class UserParameterCreate(BaseModel):
    category: str
    code: str
    name: str
    description: Optional[str] = None
    max_score: float = 0
    score_group: Optional[str] = None
    group_max_score: Optional[float] = None
    sort_order: int = 0

class UserParameterUpdate(BaseModel):
    category: Optional[str] = None
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    max_score: Optional[float] = None
    score_group: Optional[str] = None
    group_max_score: Optional[float] = None
    sort_order: Optional[int] = None


# ─── Admin Endpoints (CRUD - all parameters) ────────────────

@router.get("/admin/parameters", response_model=List[ParameterOut], tags=["Admin - Parameters"])
def admin_list_parameters(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    params = db.query(AssessmentParameter).order_by(
        AssessmentParameter.sort_order, AssessmentParameter.id
    ).all()

    # Collect creator user IDs and fetch names
    creator_ids = {p.created_by for p in params if p.created_by}
    creators = {}
    if creator_ids:
        users = db.query(User).filter(User.id.in_(creator_ids)).all()
        creators = {u.id: u.full_name or u.email for u in users}

    result = []
    for p in params:
        out = ParameterOut.model_validate(p)
        out.created_by_name = creators.get(p.created_by) if p.created_by else None
        result.append(out)
    return result


@router.post("/admin/parameters", response_model=ParameterOut, tags=["Admin - Parameters"])
def admin_create_parameter(
    data: ParameterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    existing = db.query(AssessmentParameter).filter(AssessmentParameter.code == data.code).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Parameter with code '{data.code}' already exists")
    param = AssessmentParameter(
        **data.dict(),
        created_by=current_user.id,
    )
    db.add(param)
    db.commit()
    db.refresh(param)
    return param


@router.put("/admin/parameters/{param_id}", response_model=ParameterOut, tags=["Admin - Parameters"])
def admin_update_parameter(
    param_id: int,
    data: ParameterUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    param = db.query(AssessmentParameter).filter(AssessmentParameter.id == param_id).first()
    if not param:
        raise HTTPException(status_code=404, detail="Parameter not found")
    if data.code and data.code != param.code:
        existing = db.query(AssessmentParameter).filter(AssessmentParameter.code == data.code).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Parameter with code '{data.code}' already exists")
    for key, value in data.dict(exclude_unset=True).items():
        setattr(param, key, value)
    db.commit()
    db.refresh(param)
    return param


@router.delete("/admin/parameters/{param_id}", tags=["Admin - Parameters"])
def admin_delete_parameter(
    param_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    param = db.query(AssessmentParameter).filter(AssessmentParameter.id == param_id).first()
    if not param:
        raise HTTPException(status_code=404, detail="Parameter not found")
    db.delete(param)
    db.commit()
    return {"detail": "Parameter deleted"}


# ─── User Endpoints (Preferences + Custom Parameter CRUD) ───

@router.get("/account/parameters", response_model=List[UserParameterOut], tags=["Account - Parameters"])
def user_list_parameters(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all active standard parameters + user's own custom parameters,
    with user's enabled/disabled preference."""
    params = db.query(AssessmentParameter).filter(
        or_(
            AssessmentParameter.is_standard == True,
            AssessmentParameter.created_by == current_user.id,
        ),
        AssessmentParameter.is_active == True,
    ).order_by(AssessmentParameter.is_standard.desc(), AssessmentParameter.sort_order, AssessmentParameter.id).all()

    prefs = db.query(UserParameterPreference).filter(
        UserParameterPreference.user_id == current_user.id
    ).all()
    pref_map = {p.parameter_id: p.is_enabled for p in prefs}

    result = []
    for p in params:
        # Additional (C.5-C.9) params default to unchecked; all others default to checked
        default_enabled = p.category not in ADDITIONAL_CATEGORIES
        result.append(UserParameterOut(
            id=p.id,
            category=p.category,
            code=p.code,
            name=p.name,
            description=p.description,
            max_score=p.max_score,
            score_group=p.score_group,
            group_max_score=p.group_max_score,
            is_active=p.is_active,
            is_standard=p.is_standard,
            is_additional=p.category in ADDITIONAL_CATEGORIES,
            created_by=p.created_by,
            sort_order=p.sort_order,
            is_enabled=pref_map.get(p.id, default_enabled),
        ))
    return result


@router.put("/account/parameters", tags=["Account - Parameters"])
def user_update_parameters(
    data: BulkToggle,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bulk update user parameter preferences (check/uncheck)."""
    for pref in data.preferences:
        existing = db.query(UserParameterPreference).filter(
            UserParameterPreference.user_id == current_user.id,
            UserParameterPreference.parameter_id == pref.parameter_id,
        ).first()
        if existing:
            existing.is_enabled = pref.is_enabled
        else:
            new_pref = UserParameterPreference(
                user_id=current_user.id,
                parameter_id=pref.parameter_id,
                is_enabled=pref.is_enabled,
            )
            db.add(new_pref)
    db.commit()
    return {"detail": "Preferences updated"}


@router.post("/account/parameters/custom", response_model=UserParameterOut, tags=["Account - Parameters"])
def user_create_custom_parameter(
    data: UserParameterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a custom parameter (user-owned, not standard)."""
    existing = db.query(AssessmentParameter).filter(AssessmentParameter.code == data.code).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Parameter with code '{data.code}' already exists")
    param = AssessmentParameter(
        category=data.category,
        code=data.code,
        name=data.name,
        description=data.description,
        max_score=data.max_score,
        score_group=data.score_group,
        group_max_score=data.group_max_score,
        sort_order=data.sort_order,
        is_active=True,
        is_standard=False,
        created_by=current_user.id,
    )
    db.add(param)
    db.commit()
    db.refresh(param)
    return UserParameterOut(
        id=param.id, category=param.category, code=param.code, name=param.name,
        description=param.description, max_score=param.max_score, is_active=param.is_active,
        score_group=param.score_group, group_max_score=param.group_max_score,
        is_standard=param.is_standard, is_additional=False, created_by=param.created_by,
        sort_order=param.sort_order, is_enabled=True,
    )


@router.put("/account/parameters/custom/{param_id}", response_model=UserParameterOut, tags=["Account - Parameters"])
def user_update_custom_parameter(
    param_id: int,
    data: UserParameterUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a custom parameter (only if created by this user)."""
    param = db.query(AssessmentParameter).filter(AssessmentParameter.id == param_id).first()
    if not param:
        raise HTTPException(status_code=404, detail="Parameter not found")
    if param.is_standard or param.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="You can only edit your own custom parameters")
    if data.code and data.code != param.code:
        existing = db.query(AssessmentParameter).filter(AssessmentParameter.code == data.code).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Parameter with code '{data.code}' already exists")
    for key, value in data.dict(exclude_unset=True).items():
        setattr(param, key, value)
    db.commit()
    db.refresh(param)

    pref = db.query(UserParameterPreference).filter(
        UserParameterPreference.user_id == current_user.id,
        UserParameterPreference.parameter_id == param.id,
    ).first()

    return UserParameterOut(
        id=param.id, category=param.category, code=param.code, name=param.name,
        description=param.description, max_score=param.max_score, is_active=param.is_active,
        score_group=param.score_group, group_max_score=param.group_max_score,
        is_standard=param.is_standard, is_additional=False, created_by=param.created_by,
        sort_order=param.sort_order, is_enabled=pref.is_enabled if pref else True,
    )


@router.delete("/account/parameters/custom/{param_id}", tags=["Account - Parameters"])
def user_delete_custom_parameter(
    param_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a custom parameter (only if created by this user)."""
    param = db.query(AssessmentParameter).filter(AssessmentParameter.id == param_id).first()
    if not param:
        raise HTTPException(status_code=404, detail="Parameter not found")
    if param.is_standard or param.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="You can only delete your own custom parameters")
    db.delete(param)
    db.commit()
    return {"detail": "Custom parameter deleted"}
