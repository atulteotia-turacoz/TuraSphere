"""
Advisory board workspace: team assignment (assigned medical writer / project
manager) + the board audit trail.

Team assignment also gates board access — see advisory_boards._check_board_access.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.board_workspace import BoardTeamMember, BoardActivity
from app.api.endpoints.advisory_boards import _get_board_or_404, _check_board_access
from app.services.board_activity import log_board_activity

router = APIRouter(tags=["MABM - Board Workspace"])


# ── Schemas ──────────────────────────────────────────────

class TeamMemberCreate(BaseModel):
    user_id: Optional[int] = None
    email: Optional[str] = None
    role: Optional[str] = "medical_writer"


class TeamMemberUpdate(BaseModel):
    role: str


# ── Helpers ──────────────────────────────────────────────

def _member_to_dict(m: BoardTeamMember) -> dict:
    return {
        "id": m.id,
        "board_id": m.board_id,
        "user_id": m.user_id,
        "name": m.user.full_name if m.user else None,
        "email": m.user.email if m.user else None,
        "organization": m.user.organization if m.user else None,
        "role": m.role,
        "assigned_at": m.assigned_at.isoformat() if m.assigned_at else None,
    }


# ── Team ─────────────────────────────────────────────────

@router.get("/advisory-boards/{board_id}/team")
def list_board_team(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)
    members = db.query(BoardTeamMember).filter(
        BoardTeamMember.board_id == board_id
    ).order_by(BoardTeamMember.assigned_at.asc()).all()
    return [_member_to_dict(m) for m in members]


@router.post("/advisory-boards/{board_id}/team", status_code=201)
def assign_board_team_member(
    board_id: int,
    data: TeamMemberCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)

    user = None
    if data.user_id:
        user = db.query(User).filter(User.id == data.user_id).first()
    elif data.email:
        user = db.query(User).filter(User.email == data.email.strip().lower()).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found (provide a valid user_id or registered email)")

    exists = db.query(BoardTeamMember).filter(
        BoardTeamMember.board_id == board_id, BoardTeamMember.user_id == user.id
    ).first()
    if exists:
        raise HTTPException(status_code=409, detail="User is already on this board's team")

    member = BoardTeamMember(
        board_id=board_id, user_id=user.id,
        role=(data.role or "medical_writer"), assigned_by=current_user.id,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    log_board_activity(db, board_id, current_user.id, "team.assigned",
                       f"Assigned {user.full_name} as {member.role}")
    return _member_to_dict(member)


@router.patch("/advisory-boards/{board_id}/team/{member_id}")
def update_board_team_member(
    board_id: int,
    member_id: int,
    data: TeamMemberUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)
    member = db.query(BoardTeamMember).filter(
        BoardTeamMember.id == member_id, BoardTeamMember.board_id == board_id
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")
    member.role = data.role
    db.commit()
    db.refresh(member)
    return _member_to_dict(member)


@router.delete("/advisory-boards/{board_id}/team/{member_id}")
def remove_board_team_member(
    board_id: int,
    member_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)
    member = db.query(BoardTeamMember).filter(
        BoardTeamMember.id == member_id, BoardTeamMember.board_id == board_id
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")
    name = member.user.full_name if member.user else f"user {member.user_id}"
    db.delete(member)
    db.commit()
    log_board_activity(db, board_id, current_user.id, "team.removed", f"Removed {name} from the team")
    return {"detail": "Team member removed"}


# ── Audit trail ──────────────────────────────────────────

@router.get("/advisory-boards/{board_id}/activity")
def list_board_activity(
    board_id: int,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)
    rows = db.query(BoardActivity).filter(
        BoardActivity.board_id == board_id
    ).order_by(BoardActivity.created_at.desc()).limit(min(limit, 500)).all()
    return [
        {
            "id": a.id,
            "action": a.action,
            "details": a.details,
            "performed_by": a.performed_by,
            "performer_name": a.performer.full_name if a.performer else a.actor_label,
            "actor_label": a.actor_label,
            "created_at": a.created_at.isoformat(),
        }
        for a in rows
    ]
