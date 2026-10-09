"""
Advisory Boards CRUD — promotes the localStorage `data.js` shape to a real backend.

Authorization (Phase 1):
  - Platform super_admin / admin: see and manage all boards
  - Platform user: see and manage only boards they created

JSON-as-Text fields (therapeutic_areas, regions, kol_ids, service_ids, pricing)
are serialized via json.dumps on write and json.loads on read.
"""
import json
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.advisory_board import AdvisoryBoard, BoardStatus, BoardPhase, BoardFormat
from app.models.board_workspace import BoardTeamMember
from app.services.mabm_access import user_has_mabm_capability
from app.services.board_activity import log_board_activity
from app.services import board_notify

router = APIRouter(tags=["MABM - Advisory Boards"])


# ── Schemas ──────────────────────────────────────────────

class AdvisoryBoardCreate(BaseModel):
    title: str
    client: Optional[str] = None
    sponsor: Optional[str] = None
    therapeutic_areas: Optional[List[str]] = None
    regions: Optional[List[str]] = None
    currency: Optional[str] = None
    status: Optional[str] = "draft"
    current_phase: Optional[str] = "pre_meeting"
    scheduled_date: Optional[str] = None  # ISO datetime
    start_time: Optional[str] = None  # "HH:MM"
    end_time: Optional[str] = None    # "HH:MM"
    format: Optional[str] = "virtual"
    venue: Optional[str] = None
    objective: Optional[str] = None
    notes: Optional[str] = None
    kol_ids: Optional[List[str]] = None
    service_ids: Optional[List[str]] = None
    pricing: Optional[dict] = None


class AdvisoryBoardUpdate(BaseModel):
    title: Optional[str] = None
    client: Optional[str] = None
    sponsor: Optional[str] = None
    therapeutic_areas: Optional[List[str]] = None
    regions: Optional[List[str]] = None
    currency: Optional[str] = None
    status: Optional[str] = None
    current_phase: Optional[str] = None
    scheduled_date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    format: Optional[str] = None
    venue: Optional[str] = None
    objective: Optional[str] = None
    notes: Optional[str] = None
    kol_ids: Optional[List[str]] = None
    service_ids: Optional[List[str]] = None
    pricing: Optional[dict] = None


# ── Helpers ──────────────────────────────────────────────

def _is_platform_admin(user: User) -> bool:
    role = user.role.value if hasattr(user.role, "value") else user.role
    return role in ("super_admin", "admin")


def _normalize_kol_ids(values) -> list:
    """Tag every board KOL reference with the directory it came from.

    A board's panel is drawn from two places — the advisory-board module's own
    list (`board_kols`) and the KOL module's profiles (`hcp_profiles`) — so a
    bare id is ambiguous once both are in play.

    Stored form is "own:5" / "hcp:31". A BARE id (int, or a digit string) is
    read as "hcp:<id>": that is what the column held before this existed, and
    rewriting history on read would silently unassign those experts.
    """
    out = []
    for v in values or []:
        if isinstance(v, int):
            out.append(f"hcp:{v}")
            continue
        text = str(v).strip()
        if not text:
            continue
        if text.isdigit():
            out.append(f"hcp:{text}")
        elif text.split(":", 1)[0] in ("own", "hcp") and text.split(":", 1)[-1].isdigit():
            out.append(text)
        # Anything else is a stale browser-local id from the localStorage era
        # ("kol_m1x2abc3"); dropped rather than stored, since it resolves to
        # nothing on any machine.
    # de-dupe, order preserved
    seen = set()
    return [x for x in out if not (x in seen or seen.add(x))]


def _parse_json_field(val):
    if not val:
        return None
    if isinstance(val, (list, dict)):
        return val
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return None


def _parse_iso_dt(val: Optional[str]) -> Optional[datetime]:
    if not val:
        return None
    try:
        # Accept "Z" suffix (e.g. 2026-01-15T10:00:00Z) by replacing with +00:00
        return datetime.fromisoformat(val.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid ISO datetime: {val}")


def _enum_value(v):
    return v.value if hasattr(v, "value") else v


def _primary_meeting_summary(b: AdvisoryBoard) -> Optional[dict]:
    """Lightweight summary of the board's single/earliest meeting (1 board = 1
    meeting) so the boards list can show a join-video shortcut. Returns None when
    no meeting has been created yet. Does NOT auto-create (unlike the
    primary-meeting endpoint)."""
    meetings = list(b.meetings or [])
    if not meetings:
        return None
    # Mirrors `_board_meeting()` in meetings.py exactly: `ORDER BY scheduled_at
    # ASC, id ASC`, which in MySQL sorts NULLs (date-TBD) FIRST. Sorting them last
    # here made this shortcut point at a different meeting than the workspace on
    # legacy boards that hold both a date-TBD and a scheduled meeting.
    meetings.sort(key=lambda m: (m.scheduled_at is not None, m.scheduled_at or datetime.min, m.id))
    m = meetings[0]
    return {
        "id": m.id,
        "join_url": m.join_url,
        "status": _enum_value(m.status),
        "scheduled_at": m.scheduled_at.isoformat() if m.scheduled_at else None,
        # Lets the boards list hide the "View transcript" action for everyone but
        # the organizer. The API refuses non-organizers regardless — this only
        # stops us showing a control that would 403.
        "organizer_id": m.organizer_id,
    }


def _board_to_dict(b: AdvisoryBoard) -> dict:
    return {
        "id": b.id,
        "title": b.title,
        "client": b.client,
        "sponsor": b.sponsor,
        "therapeutic_areas": _parse_json_field(b.therapeutic_areas) or [],
        "regions": _parse_json_field(b.regions) or [],
        "currency": b.currency,
        "status": _enum_value(b.status),
        "current_phase": _enum_value(b.current_phase),
        "scheduled_date": b.scheduled_date.isoformat() if b.scheduled_date else None,
        "start_time": b.start_time,
        "end_time": b.end_time,
        "format": _enum_value(b.format),
        "venue": b.venue,
        "objective": b.objective,
        "notes": b.notes,
        "kol_ids": _normalize_kol_ids(_parse_json_field(b.kol_ids)),
        "service_ids": _parse_json_field(b.service_ids) or [],
        "pricing": _parse_json_field(b.pricing) or {},
        "created_by": b.created_by,
        "created_at": b.created_at.isoformat(),
        "updated_at": b.updated_at.isoformat(),
        "primary_meeting": _primary_meeting_summary(b),
    }


def _get_board_or_404(board_id: int, db: Session) -> AdvisoryBoard:
    board = db.query(AdvisoryBoard).filter(AdvisoryBoard.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Advisory board not found")
    return board


def _is_board_team_member(board_id: int, user_id: int, db: Session) -> bool:
    return db.query(BoardTeamMember).filter(
        BoardTeamMember.board_id == board_id,
        BoardTeamMember.user_id == user_id,
    ).first() is not None


def _check_board_access(board: AdvisoryBoard, user: User, db: Session):
    """Board management is restricted to platform admins, the board creator, and
    users explicitly assigned to the board team. (The boards.manage capability
    governs who can CREATE boards / be assigned — not blanket access to all.)"""
    if _is_platform_admin(user):
        return
    if board.created_by == user.id:
        return
    if _is_board_team_member(board.id, user.id, db):
        return
    raise HTTPException(status_code=403, detail="Access denied")


# ── Routes ───────────────────────────────────────────────

@router.get("/advisory-boards")
def list_advisory_boards(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(AdvisoryBoard)
    # Non-admins see only boards they created OR are assigned to (team member).
    if not _is_platform_admin(current_user):
        assigned_ids = [
            r.board_id for r in db.query(BoardTeamMember.board_id).filter(
                BoardTeamMember.user_id == current_user.id
            ).all()
        ]
        if assigned_ids:
            q = q.filter((AdvisoryBoard.created_by == current_user.id) | (AdvisoryBoard.id.in_(assigned_ids)))
        else:
            q = q.filter(AdvisoryBoard.created_by == current_user.id)
    if status:
        q = q.filter(AdvisoryBoard.status == status)
    boards = q.order_by(AdvisoryBoard.created_at.desc()).all()
    return [_board_to_dict(b) for b in boards]


@router.post("/advisory-boards", status_code=201)
def create_advisory_board(
    data: AdvisoryBoardCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = AdvisoryBoard(
        title=data.title,
        client=data.client,
        sponsor=data.sponsor,
        therapeutic_areas=json.dumps(data.therapeutic_areas) if data.therapeutic_areas is not None else None,
        regions=json.dumps(data.regions) if data.regions is not None else None,
        currency=data.currency,
        status=data.status or BoardStatus.planning.value,
        current_phase=data.current_phase or BoardPhase.pre_meeting.value,
        scheduled_date=_parse_iso_dt(data.scheduled_date),
        start_time=data.start_time,
        end_time=data.end_time,
        format=data.format or BoardFormat.virtual.value,
        venue=data.venue,
        objective=data.objective,
        notes=data.notes,
        kol_ids=json.dumps(_normalize_kol_ids(data.kol_ids)) if data.kol_ids is not None else None,
        service_ids=json.dumps(data.service_ids) if data.service_ids is not None else None,
        pricing=json.dumps(data.pricing) if data.pricing is not None else None,
        created_by=current_user.id,
    )
    db.add(board)
    db.commit()
    db.refresh(board)
    log_board_activity(db, board.id, current_user.id, "board.created", f"Created board “{board.title}”")
    return _board_to_dict(board)


@router.get("/advisory-boards/{board_id}")
def get_advisory_board(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)
    return _board_to_dict(board)


@router.patch("/advisory-boards/{board_id}")
def update_advisory_board(
    board_id: int,
    data: AdvisoryBoardUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)

    payload = data.dict(exclude_unset=True)
    json_fields = {"therapeutic_areas", "regions", "kol_ids", "service_ids", "pricing"}

    prev_phase = _enum_value(board.current_phase)
    for field, value in payload.items():
        if field == "scheduled_date":
            board.scheduled_date = _parse_iso_dt(value)
        elif field in json_fields:
            # kol_ids is tagged by source directory on the way in, so a bare id
            # saved by an older client still lands as "hcp:<id>".
            if field == "kol_ids" and value is not None:
                value = _normalize_kol_ids(value)
            setattr(board, field, json.dumps(value) if value is not None else None)
        else:
            setattr(board, field, value)

    db.commit()
    db.refresh(board)

    # Audit trail: note a phase change specifically, else a generic update.
    new_phase = _enum_value(board.current_phase)
    if "current_phase" in payload and new_phase != prev_phase:
        log_board_activity(db, board.id, current_user.id, "board.phase_changed",
                           f"Stage changed from {prev_phase} to {new_phase}")
        # Notify the assigned team of stage changes (internal workflow — not participants).
        try:
            board_notify.notify_board(
                db, board.id,
                subject=f"Stage changed: {board.title}",
                body_html=board_notify.build_body(
                    f"{board.title} — stage updated",
                    [f"The board moved from <strong>{prev_phase}</strong> to <strong>{new_phase}</strong>."],
                ),
                include_participants=False,
            )
        except Exception:
            pass
    else:
        log_board_activity(db, board.id, current_user.id, "board.updated",
                           f"Updated: {', '.join(payload.keys())}")
    return _board_to_dict(board)


@router.delete("/advisory-boards/{board_id}")
def delete_advisory_board(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)
    db.delete(board)
    db.commit()
    return {"detail": "Advisory board deleted"}
