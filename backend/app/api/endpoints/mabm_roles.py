"""
MABM module-level role assignments — separate from platform users.role.
Roles: super_admin | sub_admin | medical_writer | turacoz_team
(Per-meeting roles like panel_member/participant live on meeting_participants.)

All endpoints require platform super_admin (the only one who can grant MABM roles).
"""
import json
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_super_admin
from app.models.user import User
from app.models.mabm_role import MABMRoleAssignment, MABMRole

router = APIRouter(tags=["MABM - Roles"])


# ── Schemas ──────────────────────────────────────────────

class RoleAssignmentCreate(BaseModel):
    user_id: int
    role: str   # super_admin | sub_admin | medical_writer | turacoz_team
    permissions: Optional[List[str]] = None  # capability slugs (sub_admin only)


class RoleAssignmentUpdate(BaseModel):
    permissions: Optional[List[str]] = None
    is_active: Optional[bool] = None


# ── Helpers ──────────────────────────────────────────────

def _enum_value(v):
    return v.value if hasattr(v, "value") else v


def _parse_json_field(val):
    if not val:
        return None
    if isinstance(val, (list, dict)):
        return val
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return None


def _ra_to_dict(ra: MABMRoleAssignment) -> dict:
    return {
        "id": ra.id,
        "user_id": ra.user_id,
        "user_name": ra.user.full_name if ra.user else None,
        "user_email": ra.user.email if ra.user else None,
        "role": _enum_value(ra.role),
        "permissions": _parse_json_field(ra.permissions) or [],
        "granted_by": ra.granted_by,
        "granted_at": ra.granted_at.isoformat(),
        "is_active": ra.is_active,
    }


# ── Routes ───────────────────────────────────────────────

@router.get("/mabm/role-assignments")
def list_mabm_role_assignments(
    role: Optional[str] = None,
    user_id: Optional[int] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(get_super_admin),
):
    q = db.query(MABMRoleAssignment)
    if role:
        q = q.filter(MABMRoleAssignment.role == role)
    if user_id is not None:
        q = q.filter(MABMRoleAssignment.user_id == user_id)
    rows = q.order_by(MABMRoleAssignment.granted_at.desc()).all()
    return [_ra_to_dict(r) for r in rows]


@router.post("/mabm/role-assignments", status_code=201)
def create_mabm_role_assignment(
    data: RoleAssignmentCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_super_admin),
):
    valid_roles = {r.value for r in MABMRole}
    if data.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role: {data.role}. Valid: {', '.join(sorted(valid_roles))}")

    target = db.query(User).filter(User.id == data.user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail=f"User {data.user_id} not found")

    ra = MABMRoleAssignment(
        user_id=data.user_id,
        role=data.role,
        permissions=json.dumps(data.permissions) if data.permissions is not None else None,
        granted_by=admin.id,
        is_active=True,
    )
    db.add(ra)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"User already has the {data.role} MABM role")
    db.refresh(ra)
    return _ra_to_dict(ra)


@router.patch("/mabm/role-assignments/{assignment_id}")
def update_mabm_role_assignment(
    assignment_id: int,
    data: RoleAssignmentUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_super_admin),
):
    ra = db.query(MABMRoleAssignment).filter(MABMRoleAssignment.id == assignment_id).first()
    if not ra:
        raise HTTPException(status_code=404, detail="Role assignment not found")

    payload = data.dict(exclude_unset=True)
    if "permissions" in payload:
        ra.permissions = json.dumps(payload["permissions"]) if payload["permissions"] is not None else None
    if "is_active" in payload:
        ra.is_active = payload["is_active"]
    db.commit()
    db.refresh(ra)
    return _ra_to_dict(ra)


@router.delete("/mabm/role-assignments/{assignment_id}")
def delete_mabm_role_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_super_admin),
):
    ra = db.query(MABMRoleAssignment).filter(MABMRoleAssignment.id == assignment_id).first()
    if not ra:
        raise HTTPException(status_code=404, detail="Role assignment not found")
    db.delete(ra)
    db.commit()
    return {"detail": "Role assignment removed"}
