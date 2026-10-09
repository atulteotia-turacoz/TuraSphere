"""
Minutes of Meeting endpoints (Phase 5).

Lifecycle: draft → shared (visible to participants, comments enabled)
          → finalized (admin signed off; final_text frozen).

Authorization:
  - View draft: meeting manager OR MABM minutes.manage
  - View shared/finalized: meeting viewer
  - Edit / share / finalize: meeting manager OR MABM minutes.manage
  - Comment: any viewer (only when status=shared and not finalized)
  - Delete comment: comment author OR meeting manager
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.meeting import BoardMeeting
from app.models.meeting_participant import MeetingParticipant
from app.models.meeting_minutes import MeetingMinutes, MeetingMinutesComment, MinutesStatus
from app.models.meeting_recording import MeetingTranscript
from app.models.email_log import EmailKind
from app.services.mabm_access import user_has_mabm_capability, get_user_mabm_capabilities
from app.services import email_service
from app.services import account_config
from app.services import board_notify

router = APIRouter(tags=["MABM - Minutes"])


# ── Schemas ──────────────────────────────────────────────

class MinutesCreate(BaseModel):
    draft_text: Optional[str] = None
    seed_from_transcript: Optional[bool] = False  # if true, copy current transcript edited_text/raw_text


class MinutesUpdate(BaseModel):
    draft_text: str


class CommentCreate(BaseModel):
    body: str


# ── Helpers ──────────────────────────────────────────────

_VIEW_GRANTING_CAPS = {"meetings.manage", "documents.manage", "transcripts.manage", "minutes.manage"}


def _is_platform_admin(user: User) -> bool:
    role = user.role.value if hasattr(user.role, "value") else user.role
    return role in ("super_admin", "admin")


def _enum_value(v):
    return v.value if hasattr(v, "value") else v


def _get_meeting_or_404(meeting_id: int, db: Session) -> BoardMeeting:
    m = db.query(BoardMeeting).filter(BoardMeeting.id == meeting_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return m


def _user_can_view_meeting(user: User, meeting: BoardMeeting, db: Session) -> bool:
    if _is_platform_admin(user):
        return True
    if meeting.organizer_id == user.id:
        return True
    if meeting.board and meeting.board.created_by == user.id:
        return True
    if db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting.id,
        MeetingParticipant.user_id == user.id,
    ).first() is not None:
        return True
    return bool(get_user_mabm_capabilities(user, db) & _VIEW_GRANTING_CAPS)


def _user_can_manage_minutes(user: User, meeting: BoardMeeting, db: Session) -> bool:
    if _is_platform_admin(user):
        return True
    if meeting.organizer_id == user.id:
        return True
    if meeting.board and meeting.board.created_by == user.id:
        return True
    caps = get_user_mabm_capabilities(user, db)
    return "meetings.manage" in caps or "minutes.manage" in caps


def _participant_emails(meeting_id: int, db: Session) -> list:
    rows = db.query(MeetingParticipant).filter(MeetingParticipant.meeting_id == meeting_id).all()
    out = []
    for p in rows:
        if p.user and p.user.email:
            out.append(p.user.email)
    return list(dict.fromkeys(out))   # dedupe, preserve order


def _meeting_url(meeting_id: int) -> str:
    return f"{settings.APP_PUBLIC_URL.rstrip('/')}/advisory-boards#meetings/{meeting_id}"


def _minutes_to_dict(m: MeetingMinutes, *, include_text: bool = True) -> dict:
    d = {
        "id": m.id,
        "meeting_id": m.meeting_id,
        "source_transcript_id": m.source_transcript_id,
        "status": _enum_value(m.status),
        "created_by": m.created_by,
        "creator_name": m.creator.full_name if m.creator else None,
        "finalized_by": m.finalized_by,
        "finalizer_name": m.finalizer.full_name if m.finalizer else None,
        "shared_at": m.shared_at.isoformat() if m.shared_at else None,
        "finalized_at": m.finalized_at.isoformat() if m.finalized_at else None,
        "comment_count": len(m.comments),
        "created_at": m.created_at.isoformat(),
        "updated_at": m.updated_at.isoformat(),
    }
    if include_text:
        d["draft_text"] = m.draft_text
        d["final_text"] = m.final_text
    return d


def _comment_to_dict(c: MeetingMinutesComment) -> dict:
    return {
        "id": c.id,
        "minutes_id": c.minutes_id,
        "user_id": c.user_id,
        "user_name": c.user.full_name if c.user else None,
        "body": c.body,
        "created_at": c.created_at.isoformat(),
    }


# ── Routes ───────────────────────────────────────────────

@router.get("/meetings/{meeting_id}/minutes")
def get_minutes(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_view_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    m = db.query(MeetingMinutes).filter(MeetingMinutes.meeting_id == meeting_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="No minutes yet")
    if _enum_value(m.status) == MinutesStatus.draft.value and not _user_can_manage_minutes(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Minutes are still in draft and not yet shared")
    return _minutes_to_dict(m)


@router.post("/meetings/{meeting_id}/minutes", status_code=201)
def create_minutes(
    meeting_id: int,
    data: MinutesCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_manage_minutes(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    if db.query(MeetingMinutes).filter(MeetingMinutes.meeting_id == meeting_id).first():
        raise HTTPException(status_code=409, detail="Minutes already exist for this meeting; PATCH to edit.")

    draft_text = data.draft_text or ""
    source_transcript_id = None
    if data.seed_from_transcript:
        t = db.query(MeetingTranscript).filter(MeetingTranscript.meeting_id == meeting_id).first()
        if t:
            draft_text = t.edited_text or t.raw_text or ""
            source_transcript_id = t.id

    m = MeetingMinutes(
        meeting_id=meeting_id,
        source_transcript_id=source_transcript_id,
        draft_text=draft_text,
        status=MinutesStatus.draft.value,
        created_by=current_user.id,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return _minutes_to_dict(m)


@router.patch("/meetings/{meeting_id}/minutes")
def edit_minutes(
    meeting_id: int,
    data: MinutesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_manage_minutes(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    m = db.query(MeetingMinutes).filter(MeetingMinutes.meeting_id == meeting_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="No minutes to edit")
    if _enum_value(m.status) == MinutesStatus.finalized.value:
        raise HTTPException(status_code=409, detail="Minutes already finalized; cannot edit.")
    m.draft_text = data.draft_text
    db.commit()
    db.refresh(m)
    return _minutes_to_dict(m)


@router.post("/meetings/{meeting_id}/minutes/share")
def share_minutes(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Share with participants for review. Sends email + opens comment thread."""
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_manage_minutes(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    m = db.query(MeetingMinutes).filter(MeetingMinutes.meeting_id == meeting_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="No minutes to share")
    if _enum_value(m.status) == MinutesStatus.finalized.value:
        raise HTTPException(status_code=409, detail="Minutes already finalized.")

    m.status = MinutesStatus.shared.value
    m.shared_at = datetime.utcnow()
    db.commit()
    db.refresh(m)

    recipients = _participant_emails(meeting_id, db)
    body = (
        f"<p>Minutes for the meeting <strong>{meeting.title}</strong> are now available for review.</p>"
        f"<p>Please add your comments on the platform: "
        f"<a href=\"{_meeting_url(meeting_id)}\">{_meeting_url(meeting_id)}</a></p>"
    )
    sent = email_service.send_email_bulk(
        db, recipients=recipients,
        subject=f"Review minutes: {meeting.title}",
        body_html=body,
        kind=EmailKind.minutes_shared.value,
        meeting_id=meeting_id,
        owner_user_id=account_config.owner_of_meeting(meeting),
    )
    # Also alert the assigned team (the bulk above only goes to participants).
    try:
        board_notify.notify_board(
            db, meeting.board_id,
            subject=f"Minutes shared for review: {meeting.title}",
            body_html=board_notify.build_body(
                f"Minutes shared — {meeting.title}",
                ["Minutes have been shared with participants for review."],
            ),
            kind=EmailKind.minutes_shared.value,
            include_participants=False, meeting_id=meeting_id,
        )
    except Exception:
        pass
    return {**_minutes_to_dict(m), "emails_sent": sent}


@router.post("/meetings/{meeting_id}/minutes/finalize")
def finalize_minutes(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_manage_minutes(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    m = db.query(MeetingMinutes).filter(MeetingMinutes.meeting_id == meeting_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="No minutes to finalize")
    if _enum_value(m.status) == MinutesStatus.finalized.value:
        raise HTTPException(status_code=409, detail="Already finalized")

    m.status = MinutesStatus.finalized.value
    m.final_text = m.draft_text
    m.finalized_by = current_user.id
    m.finalized_at = datetime.utcnow()
    db.commit()
    db.refresh(m)

    recipients = _participant_emails(meeting_id, db)
    body = (
        f"<p>The minutes for <strong>{meeting.title}</strong> have been finalized.</p>"
        f"<p>View the final version: "
        f"<a href=\"{_meeting_url(meeting_id)}\">{_meeting_url(meeting_id)}</a></p>"
    )
    sent = email_service.send_email_bulk(
        db, recipients=recipients,
        subject=f"Minutes finalized: {meeting.title}",
        body_html=body,
        kind=EmailKind.minutes_finalized.value,
        meeting_id=meeting_id,
        owner_user_id=account_config.owner_of_meeting(meeting),
    )
    try:
        board_notify.notify_board(
            db, meeting.board_id,
            subject=f"Minutes finalized: {meeting.title}",
            body_html=board_notify.build_body(
                f"Minutes finalized — {meeting.title}",
                ["The minutes for this meeting have been finalized."],
            ),
            kind=EmailKind.minutes_finalized.value,
            include_participants=False, meeting_id=meeting_id,
        )
    except Exception:
        pass
    return {**_minutes_to_dict(m), "emails_sent": sent}


# ── Comments ─────────────────────────────────────────────

@router.get("/meetings/{meeting_id}/minutes/comments")
def list_minutes_comments(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_view_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    m = db.query(MeetingMinutes).filter(MeetingMinutes.meeting_id == meeting_id).first()
    if not m:
        return []
    return [_comment_to_dict(c) for c in m.comments]


@router.post("/meetings/{meeting_id}/minutes/comments", status_code=201)
def add_minutes_comment(
    meeting_id: int,
    data: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_view_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    m = db.query(MeetingMinutes).filter(MeetingMinutes.meeting_id == meeting_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="No minutes to comment on")
    if _enum_value(m.status) != MinutesStatus.shared.value:
        raise HTTPException(status_code=409, detail="Comments only allowed while minutes are in 'shared' status")
    body = (data.body or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Comment body is required")

    c = MeetingMinutesComment(minutes_id=m.id, user_id=current_user.id, body=body)
    db.add(c)
    db.commit()
    db.refresh(c)
    return _comment_to_dict(c)


@router.delete("/meetings/{meeting_id}/minutes/comments/{comment_id}")
def delete_minutes_comment(
    meeting_id: int,
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    m = db.query(MeetingMinutes).filter(MeetingMinutes.meeting_id == meeting_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="No minutes")
    c = db.query(MeetingMinutesComment).filter(
        MeetingMinutesComment.id == comment_id, MeetingMinutesComment.minutes_id == m.id
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    is_owner = c.user_id == current_user.id
    if not is_owner and not _user_can_manage_minutes(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    db.delete(c)
    db.commit()
    return {"detail": "Comment deleted"}
