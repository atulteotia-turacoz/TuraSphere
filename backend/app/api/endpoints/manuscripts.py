"""
Manuscript pipeline endpoints (Phase 5).

Lifecycle (from the doc):
  draft → review → finalized → submitted → under_review →
    accepted | rejected | resubmitted → published

Status transitions log to ManuscriptStatusHistory and trigger email to participants
on key milestones (review, finalized, submitted, accepted, rejected, published).

Authorization: meeting manager OR MABM manuscripts.manage.
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
from app.models.manuscript import (
    Manuscript, ManuscriptComment, ManuscriptStatusHistory, ManuscriptStatus,
)
from app.models.meeting_document import MeetingDocument
from app.models.email_log import EmailKind
from app.services.mabm_access import user_has_mabm_capability, get_user_mabm_capabilities
from app.services import email_service
from app.services import account_config

router = APIRouter(tags=["MABM - Manuscripts"])

EMAIL_TRIGGERING_STATUSES = {
    ManuscriptStatus.review.value,
    ManuscriptStatus.finalized.value,
    ManuscriptStatus.submitted.value,
    ManuscriptStatus.accepted.value,
    ManuscriptStatus.rejected.value,
    ManuscriptStatus.published.value,
}


# ── Schemas ──────────────────────────────────────────────

class ManuscriptCreate(BaseModel):
    title: str
    document_id: Optional[int] = None
    journal_name: Optional[str] = None


class ManuscriptUpdate(BaseModel):
    title: Optional[str] = None
    document_id: Optional[int] = None
    journal_name: Optional[str] = None
    published_url: Optional[str] = None
    doi: Optional[str] = None


class StatusTransition(BaseModel):
    status: str
    note: Optional[str] = None


class CommentCreate(BaseModel):
    body: str


# ── Helpers ──────────────────────────────────────────────

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


def _get_manuscript_or_404(manuscript_id: int, db: Session) -> Manuscript:
    m = db.query(Manuscript).filter(Manuscript.id == manuscript_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Manuscript not found")
    return m


def _user_can_view(user: User, meeting: BoardMeeting, db: Session) -> bool:
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
    caps = get_user_mabm_capabilities(user, db)
    return any(c in caps for c in ("meetings.manage", "manuscripts.manage", "documents.manage"))


def _user_can_manage(user: User, meeting: BoardMeeting, db: Session) -> bool:
    if _is_platform_admin(user):
        return True
    if meeting.organizer_id == user.id:
        return True
    if meeting.board and meeting.board.created_by == user.id:
        return True
    caps = get_user_mabm_capabilities(user, db)
    return "meetings.manage" in caps or "manuscripts.manage" in caps


def _participant_emails(meeting_id: int, db: Session) -> list:
    rows = db.query(MeetingParticipant).filter(MeetingParticipant.meeting_id == meeting_id).all()
    out = [p.user.email for p in rows if p.user and p.user.email]
    return list(dict.fromkeys(out))


def _meeting_url(meeting_id: int) -> str:
    return f"{settings.APP_PUBLIC_URL.rstrip('/')}/advisory-boards#meetings/{meeting_id}"


def _manuscript_to_dict(m: Manuscript, *, include_relations: bool = False) -> dict:
    d = {
        "id": m.id,
        "meeting_id": m.meeting_id,
        "title": m.title,
        "document_id": m.document_id,
        "status": _enum_value(m.status),
        "journal_name": m.journal_name,
        "submitted_at": m.submitted_at.isoformat() if m.submitted_at else None,
        "accepted_at": m.accepted_at.isoformat() if m.accepted_at else None,
        "published_at": m.published_at.isoformat() if m.published_at else None,
        "published_url": m.published_url,
        "doi": m.doi,
        "last_status_email_at": m.last_status_email_at.isoformat() if m.last_status_email_at else None,
        "created_by": m.created_by,
        "creator_name": m.creator.full_name if m.creator else None,
        "created_at": m.created_at.isoformat(),
        "updated_at": m.updated_at.isoformat(),
        "comment_count": len(m.comments),
    }
    if include_relations:
        d["comments"] = [_comment_to_dict(c) for c in m.comments]
        d["status_history"] = [_history_to_dict(h) for h in m.status_history]
    return d


def _comment_to_dict(c: ManuscriptComment) -> dict:
    return {
        "id": c.id,
        "manuscript_id": c.manuscript_id,
        "user_id": c.user_id,
        "user_name": c.user.full_name if c.user else None,
        "body": c.body,
        "created_at": c.created_at.isoformat(),
    }


def _history_to_dict(h: ManuscriptStatusHistory) -> dict:
    return {
        "id": h.id,
        "status": _enum_value(h.status),
        "note": h.note,
        "changed_by": h.changed_by,
        "changer_name": h.changer.full_name if h.changer else None,
        "changed_at": h.changed_at.isoformat(),
    }


def _send_status_email(db: Session, meeting: BoardMeeting, m: Manuscript, new_status: str, note: Optional[str]) -> int:
    """Sends an email to all participants about the status change."""
    pretty = new_status.replace("_", " ").title()
    extra = f"<p><em>{note}</em></p>" if note else ""
    body = (
        f"<p>The manuscript <strong>{m.title}</strong> (linked to meeting "
        f"<strong>{meeting.title}</strong>) has moved to status: <strong>{pretty}</strong>.</p>"
        f"{extra}"
        + (f"<p>Published paper: <a href=\"{m.published_url}\">{m.published_url}</a></p>"
           if new_status == ManuscriptStatus.published.value and m.published_url else "")
        + f"<p>View on the platform: <a href=\"{_meeting_url(meeting.id)}\">{_meeting_url(meeting.id)}</a></p>"
    )
    return email_service.send_email_bulk(
        db, recipients=_participant_emails(meeting.id, db),
        subject=f"Manuscript status: {pretty} — {m.title}",
        body_html=body,
        kind=EmailKind.manuscript_status_change.value,
        meeting_id=meeting.id,
        manuscript_id=m.id,
        owner_user_id=account_config.owner_of_meeting(meeting),
    )


# ── Routes ───────────────────────────────────────────────

@router.get("/meetings/{meeting_id}/manuscripts")
def list_manuscripts(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_view(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    rows = db.query(Manuscript).filter(
        Manuscript.meeting_id == meeting_id
    ).order_by(Manuscript.created_at.desc()).all()
    return [_manuscript_to_dict(m) for m in rows]


@router.post("/meetings/{meeting_id}/manuscripts", status_code=201)
def create_manuscript(
    meeting_id: int,
    data: ManuscriptCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_manage(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    if data.document_id:
        doc = db.query(MeetingDocument).filter(
            MeetingDocument.id == data.document_id,
            MeetingDocument.meeting_id == meeting_id,
        ).first()
        if not doc:
            raise HTTPException(status_code=400, detail=f"Document {data.document_id} not found in this meeting")
    m = Manuscript(
        meeting_id=meeting_id,
        title=data.title.strip() or "Untitled manuscript",
        document_id=data.document_id,
        journal_name=data.journal_name,
        status=ManuscriptStatus.draft.value,
        created_by=current_user.id,
    )
    db.add(m)
    db.flush()
    db.add(ManuscriptStatusHistory(
        manuscript_id=m.id,
        status=ManuscriptStatus.draft.value,
        note="Created",
        changed_by=current_user.id,
    ))
    db.commit()
    db.refresh(m)
    return _manuscript_to_dict(m, include_relations=True)


@router.get("/manuscripts/{manuscript_id}")
def get_manuscript(
    manuscript_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_manuscript_or_404(manuscript_id, db)
    if not _user_can_view(current_user, m.meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    return _manuscript_to_dict(m, include_relations=True)


@router.patch("/manuscripts/{manuscript_id}")
def update_manuscript(
    manuscript_id: int,
    data: ManuscriptUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_manuscript_or_404(manuscript_id, db)
    if not _user_can_manage(current_user, m.meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    payload = data.dict(exclude_unset=True)
    if "document_id" in payload and payload["document_id"]:
        doc = db.query(MeetingDocument).filter(
            MeetingDocument.id == payload["document_id"],
            MeetingDocument.meeting_id == m.meeting_id,
        ).first()
        if not doc:
            raise HTTPException(status_code=400, detail="document_id must belong to this meeting")
    for k, v in payload.items():
        setattr(m, k, v)
    db.commit()
    db.refresh(m)
    return _manuscript_to_dict(m, include_relations=True)


@router.post("/manuscripts/{manuscript_id}/status")
def transition_manuscript_status(
    manuscript_id: int,
    data: StatusTransition,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_manuscript_or_404(manuscript_id, db)
    if not _user_can_manage(current_user, m.meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    valid = {s.value for s in ManuscriptStatus}
    if data.status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid status: {data.status}")

    m.status = data.status
    now = datetime.utcnow()
    if data.status == ManuscriptStatus.submitted.value and not m.submitted_at:
        m.submitted_at = now
    if data.status == ManuscriptStatus.accepted.value and not m.accepted_at:
        m.accepted_at = now
    if data.status == ManuscriptStatus.published.value and not m.published_at:
        m.published_at = now

    db.add(ManuscriptStatusHistory(
        manuscript_id=m.id,
        status=data.status,
        note=data.note,
        changed_by=current_user.id,
        changed_at=now,
    ))

    sent = 0
    if data.status in EMAIL_TRIGGERING_STATUSES:
        sent = _send_status_email(db, m.meeting, m, data.status, data.note)
        m.last_status_email_at = now

    db.commit()
    db.refresh(m)
    return {**_manuscript_to_dict(m, include_relations=True), "emails_sent": sent}


@router.delete("/manuscripts/{manuscript_id}")
def delete_manuscript(
    manuscript_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_manuscript_or_404(manuscript_id, db)
    if not _user_can_manage(current_user, m.meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    db.delete(m)
    db.commit()
    return {"detail": "Manuscript deleted"}


# ── Comments ─────────────────────────────────────────────

@router.post("/manuscripts/{manuscript_id}/comments", status_code=201)
def add_manuscript_comment(
    manuscript_id: int,
    data: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_manuscript_or_404(manuscript_id, db)
    if not _user_can_view(current_user, m.meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    if _enum_value(m.status) not in (ManuscriptStatus.review.value, ManuscriptStatus.draft.value, ManuscriptStatus.finalized.value):
        # Allow comments during early lifecycle; lock down once submitted/published
        raise HTTPException(status_code=409, detail=f"Comments closed at status '{_enum_value(m.status)}'")
    body = (data.body or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Comment body required")
    c = ManuscriptComment(manuscript_id=m.id, user_id=current_user.id, body=body)
    db.add(c)
    db.commit()
    db.refresh(c)
    return _comment_to_dict(c)


@router.delete("/manuscripts/{manuscript_id}/comments/{comment_id}")
def delete_manuscript_comment(
    manuscript_id: int,
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_manuscript_or_404(manuscript_id, db)
    c = db.query(ManuscriptComment).filter(
        ManuscriptComment.id == comment_id,
        ManuscriptComment.manuscript_id == manuscript_id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    is_owner = c.user_id == current_user.id
    if not is_owner and not _user_can_manage(current_user, m.meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    db.delete(c)
    db.commit()
    return {"detail": "Comment deleted"}
