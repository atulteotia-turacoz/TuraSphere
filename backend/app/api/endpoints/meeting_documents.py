"""
Meeting documents categorized by lifecycle phase (pre / during / post).
Includes per-document visibility (who can see) + comment-only access.

Authorization (Phase 1):
  - View document: anyone who can view the meeting AND passes the visibility filter
  - Manage document (upload/update/delete/visibility): meeting organizer, board owner, platform admin
  - Comment: any viewer (when allow_comments=True); delete own comment only (admins delete any)
"""
import os
import uuid
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.meeting import BoardMeeting, MeetingAgendaItem
from app.models.meeting_participant import MeetingParticipant
from app.models.meeting_document import (
    MeetingDocument, MeetingDocumentVisibility, MeetingDocumentComment,
    DocumentPhase, DocumentCategory, DocApprovalStatus,
)
from app.services.mabm_access import user_has_mabm_capability, get_user_mabm_capabilities
from app.services import board_notify
from app.services import document_preview
from app.api.endpoints.board_sections import board_id_for_meeting
from app.models.board_section import BoardSection

router = APIRouter(tags=["MABM - Documents"])


# Allowed extensions per the MABM doc (PPT, Word, PDF, ZIP, images, etc.)
ALLOWED_DOC_EXT = {
    ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".zip", ".txt", ".csv",
}


# ── Schemas ──────────────────────────────────────────────

class DocumentUpdate(BaseModel):
    title: Optional[str] = None
    phase: Optional[str] = None      # pre | during | post
    category: Optional[str] = None
    is_enabled: Optional[bool] = None
    allow_comments: Optional[bool] = None
    client_visible: Optional[bool] = None   # share with board client(s) for review/approval
    kol_visible: Optional[bool] = None      # share with KOLs/advisors in the meeting portal
    version: Optional[int] = None
    approval_status: Optional[str] = None   # pending | approved | rejected
    # The section (folder) this document is filed under.
    section_id: Optional[int] = None
    session_id: Optional[int] = None
    # Legacy filing, kept so an older document can still be re-filed.
    # dashboard. Send null to detach it back to meeting-level material.
    agenda_item_id: Optional[int] = None


class VisibilityUpdate(BaseModel):
    user_ids: List[int]   # full replace; empty list = visible to all participants


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


def _get_document_or_404(meeting_id: int, document_id: int, db: Session) -> MeetingDocument:
    d = db.query(MeetingDocument).filter(
        MeetingDocument.id == document_id,
        MeetingDocument.meeting_id == meeting_id,
    ).first()
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    return d


_VIEW_GRANTING_CAPS = {"meetings.manage", "documents.manage", "transcripts.manage", "minutes.manage"}


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


def _user_can_manage_meeting(user: User, meeting: BoardMeeting, db: Session) -> bool:
    if _is_platform_admin(user):
        return True
    if meeting.organizer_id == user.id:
        return True
    if meeting.board and meeting.board.created_by == user.id:
        return True
    # Either meetings.manage or documents.manage qualifies — both imply ability to manage this meeting's docs
    caps = get_user_mabm_capabilities(user, db)
    return "meetings.manage" in caps or "documents.manage" in caps


def _user_can_view_document(user: User, doc: MeetingDocument, db: Session) -> bool:
    """Manager always sees; otherwise must be a meeting viewer AND pass the visibility allowlist (if any)."""
    if _user_can_manage_meeting(user, doc.meeting, db):
        return True
    if not _user_can_view_meeting(user, doc.meeting, db):
        return False
    if not doc.is_enabled:
        return False
    visibility_rows = db.query(MeetingDocumentVisibility).filter(
        MeetingDocumentVisibility.document_id == doc.id
    ).all()
    if not visibility_rows:
        return True   # empty allowlist = visible to all viewers
    allowed_ids = {v.user_id for v in visibility_rows}
    return user.id in allowed_ids


def _validate_heading(db: Session, meeting_id: int, heading_id: Optional[int], kind: str) -> None:
    """A document's section/session must come from the same board as its meeting,
    and be of the right kind — a section id in the session field would put a
    folder in the session dropdown, which is exactly what we are avoiding."""
    if heading_id is None:
        return
    board_id = board_id_for_meeting(db, meeting_id)
    owns = db.query(BoardSection.id).filter(
        BoardSection.id == heading_id,
        BoardSection.board_id == board_id,
        BoardSection.kind == kind,
    ).first()
    if not owns:
        raise HTTPException(status_code=400, detail=f"That {kind} does not belong to this board.")


def _document_to_dict(d: MeetingDocument) -> dict:
    return {
        "id": d.id,
        "meeting_id": d.meeting_id,
        "phase": _enum_value(d.phase),
        "category": _enum_value(d.category),
        # Section (the folder) and session (part of the programme) are two
        # independent fields — a document can have either, both or neither.
        "section_id": d.section_id,
        "section_title": d.section.title if d.section else None,
        "section_sequence": d.section.sequence if d.section else None,
        "session_id": d.doc_session_id,
        "session_title": d.doc_session.title if d.doc_session else None,
        "session_sequence": d.doc_session.sequence if d.doc_session else None,
        # Pre-sections filing, still shown so an old document keeps its label.
        "agenda_item_id": d.agenda_item_id,
        "agenda_item_title": d.agenda_item.title if d.agenda_item else None,
        "title": d.title,
        "version": d.version,
        "approval_status": _enum_value(d.approval_status),
        "file_path": d.file_path,
        "mime_type": d.mime_type,
        # 'pdf' | 'image' | 'text' | null — what the viewer should render.
        "preview_kind": document_preview.preview_kind(d.file_path or ""),
        "size_bytes": d.size_bytes,
        "public_token": d.public_token,
        "uploaded_by": d.uploaded_by,
        "uploader_name": d.uploader.full_name if d.uploader else None,
        "is_enabled": d.is_enabled,
        "allow_comments": d.allow_comments,
        "client_visible": d.client_visible,
        "kol_visible": d.kol_visible,
        "visibility_user_ids": [v.user_id for v in d.visibility],
        "comment_count": len(d.comments),
        "created_at": d.created_at.isoformat(),
        "updated_at": d.updated_at.isoformat(),
    }


def _comment_to_dict(c: MeetingDocumentComment) -> dict:
    return {
        "id": c.id,
        "document_id": c.document_id,
        "user_id": c.user_id,
        "user_name": c.user.full_name if c.user else None,
        "body": c.body,
        "created_at": c.created_at.isoformat(),
    }


# ── Document CRUD ────────────────────────────────────────

@router.get("/meetings/{meeting_id}/documents")
def list_meeting_documents(
    meeting_id: int,
    phase: Optional[str] = None,        # pre | during | post
    category: Optional[str] = None,
    enabled_only: Optional[bool] = True,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_view_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")

    q = db.query(MeetingDocument).filter(MeetingDocument.meeting_id == meeting_id)
    if phase:
        q = q.filter(MeetingDocument.phase == phase)
    if category:
        q = q.filter(MeetingDocument.category == category)
    if enabled_only and not _user_can_manage_meeting(current_user, meeting, db):
        q = q.filter(MeetingDocument.is_enabled.is_(True))
    if search:
        q = q.filter(MeetingDocument.title.ilike(f"%{search}%"))

    docs = q.order_by(MeetingDocument.created_at.desc()).all()

    # Apply visibility filter for non-managers
    if not _user_can_manage_meeting(current_user, meeting, db):
        docs = [d for d in docs if _user_can_view_document(current_user, d, db)]

    return [_document_to_dict(d) for d in docs]


@router.post("/meetings/{meeting_id}/documents", status_code=201)
async def upload_meeting_document(
    meeting_id: int,
    phase: str = Form(...),
    category: str = Form("other"),
    title: Optional[str] = Form(None),
    agenda_item_id: Optional[int] = Form(None),
    section_id: Optional[int] = Form(None),
    session_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    _ = meeting.board  # ensure relationship loaded for permission check
    if not _user_can_manage_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")

    if phase not in (DocumentPhase.pre.value, DocumentPhase.during.value, DocumentPhase.post.value):
        raise HTTPException(status_code=400, detail=f"Invalid phase: {phase}")
    valid_categories = {c.value for c in DocumentCategory}
    if category not in valid_categories:
        raise HTTPException(status_code=400, detail=f"Invalid category: {category}")
    _validate_heading(db, meeting_id, section_id, 'section')
    _validate_heading(db, meeting_id, session_id, 'session')
    if agenda_item_id is not None:
        owns_session = db.query(MeetingAgendaItem.id).filter(
            MeetingAgendaItem.id == agenda_item_id,
            MeetingAgendaItem.meeting_id == meeting_id,
        ).first()
        if not owns_session:
            raise HTTPException(status_code=400, detail="That session does not belong to this meeting.")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_DOC_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"Extension {ext or '(none)'} not allowed. Allowed: {', '.join(sorted(ALLOWED_DOC_EXT))}",
        )

    upload_dir = os.path.join(settings.UPLOAD_DIR, "meetings", str(meeting_id), "documents")
    os.makedirs(upload_dir, exist_ok=True)

    filename = f"{uuid.uuid4().hex}{ext}"
    abs_path = os.path.join(upload_dir, filename)
    content = await file.read()
    with open(abs_path, "wb") as f:
        f.write(content)

    final_title = title or (file.filename or filename)
    # Auto-version: re-uploading a document with the same title bumps the version.
    prior = db.query(MeetingDocument).filter(
        MeetingDocument.meeting_id == meeting_id,
        MeetingDocument.title == final_title,
    ).count()

    doc = MeetingDocument(
        meeting_id=meeting_id,
        agenda_item_id=agenda_item_id,
        section_id=section_id,
        doc_session_id=session_id,
        phase=phase,
        category=category,
        title=final_title,
        version=prior + 1,
        file_path=abs_path,
        mime_type=file.content_type,
        size_bytes=len(content),
        uploaded_by=current_user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    # Alert the assigned team that a new document was added (not participants —
    # they're notified only when it's explicitly shared with them, below).
    try:
        board_notify.notify_board(
            db, meeting.board_id,
            subject=f"New document: {final_title}",
            body_html=board_notify.build_body(
                f"New document added — {meeting.title}",
                [f"<strong>{final_title}</strong> was uploaded to the {phase}-meeting workspace."],
            ),
            include_participants=False, meeting_id=meeting_id,
        )
    except Exception:
        pass
    return _document_to_dict(doc)


@router.patch("/meetings/{meeting_id}/documents/{document_id}")
def update_meeting_document(
    meeting_id: int,
    document_id: int,
    data: DocumentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = _get_document_or_404(meeting_id, document_id, db)
    if not _user_can_manage_meeting(current_user, doc.meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")

    payload = data.dict(exclude_unset=True)
    if "phase" in payload and payload["phase"] not in {p.value for p in DocumentPhase}:
        raise HTTPException(status_code=400, detail=f"Invalid phase: {payload['phase']}")
    if "category" in payload and payload["category"] not in {c.value for c in DocumentCategory}:
        raise HTTPException(status_code=400, detail=f"Invalid category: {payload['category']}")
    if "approval_status" in payload and payload["approval_status"] not in {s.value for s in DocApprovalStatus}:
        raise HTTPException(status_code=400, detail=f"Invalid approval_status: {payload['approval_status']}")
    if "section_id" in payload:
        _validate_heading(db, meeting_id, payload["section_id"], "section")
    if "session_id" in payload:
        _validate_heading(db, meeting_id, payload["session_id"], "session")
        # The model column is `doc_session_id`; the API says `session_id`.
        payload["doc_session_id"] = payload.pop("session_id")
    if payload.get("agenda_item_id") is not None:
        owns_session = db.query(MeetingAgendaItem.id).filter(
            MeetingAgendaItem.id == payload["agenda_item_id"],
            MeetingAgendaItem.meeting_id == meeting_id,
        ).first()
        if not owns_session:
            raise HTTPException(status_code=400, detail="That session does not belong to this meeting.")

    was_kol_visible = bool(doc.kol_visible)
    for field, value in payload.items():
        setattr(doc, field, value)
    db.commit()
    db.refresh(doc)
    # When a document is newly shared with KOLs/advisors, alert the participants.
    if doc.kol_visible and not was_kol_visible:
        try:
            board_notify.notify_board(
                db, doc.meeting.board_id,
                subject=f"A document was shared with you: {doc.title}",
                body_html=board_notify.build_body(
                    f"Document shared — {doc.meeting.title if doc.meeting else 'Meeting'}",
                    [f"<strong>{doc.title}</strong> is now available in your meeting portal."],
                ),
                include_team=False, meeting_id=meeting_id,
            )
        except Exception:
            pass
    return _document_to_dict(doc)


@router.delete("/meetings/{meeting_id}/documents/{document_id}")
def delete_meeting_document(
    meeting_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = _get_document_or_404(meeting_id, document_id, db)
    if not _user_can_manage_meeting(current_user, doc.meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")

    file_path = doc.file_path
    # Before the source goes: the cache key is built from its size and mtime, so
    # this cannot be done afterwards.
    preview_removed = document_preview.discard(file_path) if file_path else False

    db.delete(doc)
    db.commit()

    file_removed = False
    if file_path and os.path.isfile(file_path):
        try:
            os.remove(file_path)
            file_removed = True
        except OSError:
            pass  # file already gone — not a hard error
    return {"detail": "Document deleted", "file_removed": file_removed,
            "preview_cache_removed": preview_removed}


@router.get("/meetings/{meeting_id}/documents/{document_id}/download")
def download_meeting_document(
    meeting_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = _get_document_or_404(meeting_id, document_id, db)
    if not _user_can_view_document(current_user, doc, db):
        raise HTTPException(status_code=403, detail="Access denied")
    if not os.path.isfile(doc.file_path):
        raise HTTPException(status_code=404, detail="File missing on server")
    return FileResponse(
        path=doc.file_path,
        media_type=doc.mime_type or "application/octet-stream",
        filename=doc.title,
    )


@router.get("/meetings/{meeting_id}/documents/{document_id}/preview")
def preview_meeting_document(
    meeting_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Read the document in the browser instead of downloading it. Office files
    are converted to PDF by LibreOffice (cached); PDFs, images and text are
    served as they are. Same view permission as the download route."""
    doc = _get_document_or_404(meeting_id, document_id, db)
    if not _user_can_view_document(current_user, doc, db):
        raise HTTPException(status_code=403, detail="Access denied")
    try:
        path, media_type = document_preview.prepare(doc.file_path or "", doc.mime_type)
    except document_preview.PreviewError as e:
        raise HTTPException(status_code=415, detail=str(e))
    return FileResponse(
        path=path, media_type=media_type,
        filename=os.path.basename(path),
        content_disposition_type="inline",
    )


# ── Public share link ────────────────────────────────────

@router.post("/meetings/{meeting_id}/documents/{document_id}/share-link", status_code=201)
def create_document_share_link(
    meeting_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate (or return the existing) public link for a document. Anyone with
    the link can open the file without logging in — so only meeting managers can
    mint one. Idempotent: returns the same token until it's revoked."""
    doc = _get_document_or_404(meeting_id, document_id, db)
    if not _user_can_manage_meeting(current_user, doc.meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    if not doc.public_token:
        doc.public_token = uuid.uuid4().hex
        db.commit()
        db.refresh(doc)
    return {"document_id": doc.id, "public_token": doc.public_token}


@router.delete("/meetings/{meeting_id}/documents/{document_id}/share-link")
def revoke_document_share_link(
    meeting_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Revoke the public link — the old URL stops working immediately."""
    doc = _get_document_or_404(meeting_id, document_id, db)
    if not _user_can_manage_meeting(current_user, doc.meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    doc.public_token = None
    db.commit()
    return {"document_id": doc.id, "public_token": None}


@router.get("/public/documents/{token}")
def open_public_document(token: str, db: Session = Depends(get_db)):
    """Unauthenticated: stream a document by its public token, inline so a PDF/
    image opens directly in the browser. Gated only on the token + is_enabled —
    minting the link is the manager's explicit decision to share it openly."""
    doc = db.query(MeetingDocument).filter(
        MeetingDocument.public_token == token,
        MeetingDocument.is_enabled == True,  # noqa: E712
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not doc.file_path or not os.path.isfile(doc.file_path):
        raise HTTPException(status_code=404, detail="File not found on server")
    return FileResponse(
        path=doc.file_path,
        media_type=doc.mime_type or "application/octet-stream",
        filename=doc.title,
        content_disposition_type="inline",
    )


# ── Visibility ───────────────────────────────────────────

@router.put("/meetings/{meeting_id}/documents/{document_id}/visibility")
def set_document_visibility(
    meeting_id: int,
    document_id: int,
    data: VisibilityUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = _get_document_or_404(meeting_id, document_id, db)
    if not _user_can_manage_meeting(current_user, doc.meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")

    db.query(MeetingDocumentVisibility).filter(
        MeetingDocumentVisibility.document_id == document_id
    ).delete(synchronize_session=False)
    for uid in set(data.user_ids):
        db.add(MeetingDocumentVisibility(document_id=document_id, user_id=uid))
    db.commit()
    db.refresh(doc)
    return {
        "document_id": document_id,
        "visibility_user_ids": [v.user_id for v in doc.visibility],
    }


# ── Comments ─────────────────────────────────────────────

@router.get("/meetings/{meeting_id}/documents/{document_id}/comments")
def list_document_comments(
    meeting_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = _get_document_or_404(meeting_id, document_id, db)
    if not _user_can_view_document(current_user, doc, db):
        raise HTTPException(status_code=403, detail="Access denied")
    return [_comment_to_dict(c) for c in doc.comments]


@router.post("/meetings/{meeting_id}/documents/{document_id}/comments", status_code=201)
def add_document_comment(
    meeting_id: int,
    document_id: int,
    data: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = _get_document_or_404(meeting_id, document_id, db)
    if not _user_can_view_document(current_user, doc, db):
        raise HTTPException(status_code=403, detail="Access denied")
    if not doc.allow_comments and not _user_can_manage_meeting(current_user, doc.meeting, db):
        raise HTTPException(status_code=403, detail="Comments are disabled for this document")
    body = (data.body or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Comment body is required")

    c = MeetingDocumentComment(document_id=document_id, user_id=current_user.id, body=body)
    db.add(c)
    db.commit()
    db.refresh(c)
    return _comment_to_dict(c)


@router.delete("/meetings/{meeting_id}/documents/{document_id}/comments/{comment_id}")
def delete_document_comment(
    meeting_id: int,
    document_id: int,
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = _get_document_or_404(meeting_id, document_id, db)
    c = db.query(MeetingDocumentComment).filter(
        MeetingDocumentComment.id == comment_id,
        MeetingDocumentComment.document_id == document_id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    is_owner = c.user_id == current_user.id
    if not is_owner and not _user_can_manage_meeting(current_user, doc.meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    db.delete(c)
    db.commit()
    return {"detail": "Comment deleted"}
