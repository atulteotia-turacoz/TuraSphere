"""
Public, token-gated client portal.

A board's client accesses everything through their magic-link token
(BoardClient.access_token) — no platform account required, same pattern as the
per-participant meeting-join links. Through the portal the client can:
  - view the board's project status,
  - list & download documents the team marked `client_visible`, and record an
    approval decision (approve / request changes / reject) per document,
  - read AND answer the board's discussion thread (see session_discussion).

The private client<->team message thread that used to live here was removed on
2026-09-21: it was never used, and the discussion thread — which the expert
panel can see too — is where the client now talks to the team.
"""
import os
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import verify_password, create_access_token, decode_token
from app.models.advisory_board import AdvisoryBoard
from app.models.meeting import BoardMeeting, MeetingAgendaItem
from app.models.meeting_document import MeetingDocument
from app.models.board_client import (
    BoardClient, DocumentApproval, ApprovalStatus,
)
from app.services.meeting_engagement_stats import build_engagement
from app.services import document_preview
from app.services import session_discussion
from app.models.meeting_session_comment import MeetingSessionComment
from app.models.meeting_engagement import MeetingSurvey
# Reused so the client's export and the team's are produced by the same code.
from app.api.endpoints.surveys import (
    _question_column_keys, _result_column_order, _responses_to_list,
)
from app.api.endpoints.advisory_boards import _enum_value

router = APIRouter(tags=["MABM - Client Portal"])

_VALID_APPROVAL = {s.value for s in ApprovalStatus}


# ── Schemas ──────────────────────────────────────────────

class ApprovalSubmit(BaseModel):
    status: str
    comment: str | None = None


class ClientLogin(BaseModel):
    password: str


# ── Helpers ──────────────────────────────────────────────

def _get_client_by_token(token: str, db: Session) -> BoardClient:
    c = db.query(BoardClient).filter(BoardClient.access_token == token).first()
    if not c:
        raise HTTPException(status_code=404, detail="Invalid or expired client link")
    return c


# ── Password gate ────────────────────────────────────────
# The portal link is the first factor: holding it proves the mail reached you.
# A password is the second, and it matters because that one URL now exposes
# board documents, approval decisions, the message thread with the team and the
# full expert-engagement picture — and a URL travels: forwarded mail, browser
# history, a shared screen.
#
# It is OPTIONAL per client. NULL password_hash keeps the link-only behaviour
# every existing client has, so turning this on cannot lock anybody out.

_CLIENT_SESSION_HOURS = 12


def _issue_client_session(client: BoardClient) -> str:
    """Short-lived proof that this browser has already entered the password.

    Signed with the app SECRET_KEY and bound to BOTH the client id and the
    current access token, so regenerating a client's link immediately kills
    every session issued against the old one.
    """
    return create_access_token(
        {"sub": f"client:{client.id}", "tok": client.access_token, "typ": "client_portal"},
        expires_delta=timedelta(hours=_CLIENT_SESSION_HOURS),
    )


def _session_is_valid(client: BoardClient, session: Optional[str]) -> bool:
    if not session:
        return False
    try:
        payload = decode_token(session)
    except Exception:      # noqa: BLE001 — expired or tampered reads the same here
        return False
    return (
        payload.get("typ") == "client_portal"
        and payload.get("sub") == f"client:{client.id}"
        and payload.get("tok") == client.access_token
    )


def _client_is_locked(client: BoardClient, session: Optional[str]) -> bool:
    """True when a password is set and this request has not proved it."""
    if not client.password_hash:
        return False
    return not _session_is_valid(client, session)


def _authed_client(token: str, db: Session, session: Optional[str]) -> BoardClient:
    """Resolve the client AND enforce the password gate.

    Every data endpoint goes through this rather than _get_client_by_token, so a
    new endpoint cannot accidentally skip the check — which is exactly the kind
    of hole a per-endpoint check leaves.
    """
    client = _get_client_by_token(token, db)
    if _client_is_locked(client, session):
        raise HTTPException(status_code=401, detail="Password required")
    return client


def _touch_last_seen(client: BoardClient, db: Session):
    client.last_seen_at = datetime.utcnow()
    db.commit()


def _approval_status_for(document_id: int, client_id: int, db: Session):
    a = db.query(DocumentApproval).filter(
        DocumentApproval.document_id == document_id,
        DocumentApproval.board_client_id == client_id,
    ).first()
    if not a:
        return {"status": ApprovalStatus.pending.value, "comment": None, "decided_at": None}
    return {
        "status": _enum_value(a.status),
        "comment": a.comment,
        "decided_at": a.decided_at.isoformat() if a.decided_at else None,
    }


def _client_visible_doc_or_404(token: str, document_id: int, db: Session,
                               session: Optional[str] = None):
    """Resolve (client, document) ensuring the doc belongs to the client's board and is shared."""
    client = _authed_client(token, db, session)
    row = (
        db.query(MeetingDocument)
        .join(BoardMeeting, MeetingDocument.meeting_id == BoardMeeting.id)
        .filter(
            MeetingDocument.id == document_id,
            BoardMeeting.board_id == client.board_id,
            MeetingDocument.client_visible == True,  # noqa: E712
            MeetingDocument.is_enabled == True,       # noqa: E712
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    return client, row


# ── Portal ───────────────────────────────────────────────

@router.post("/public/client/{token}/login")
def client_login(token: str, data: ClientLogin, db: Session = Depends(get_db)):
    """Exchange the portal password for a short-lived session.

    Deliberately gives the same message for a wrong password as for a client
    with no password set, so this cannot be used to probe which links are
    protected.
    """
    client = _get_client_by_token(token, db)
    if not client.password_hash or not verify_password(data.password or "", client.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect password.")
    _touch_last_seen(client, db)
    return {
        "session": _issue_client_session(client),
        "expires_in_hours": _CLIENT_SESSION_HOURS,
        "client": {"name": client.name, "email": client.email, "organization": client.organization},
    }


@router.get("/public/client/{token}")
def get_client_portal(token: str, db: Session = Depends(get_db),
                      x_client_session: Optional[str] = Header(None)):
    """Board project status + this client's profile.

    The one endpoint that answers before the gate — the portal has to be able to
    ask "do I need a password here?". It returns only the board title in that
    case, so the login screen can name what is being opened, and nothing more.
    """
    client = _get_client_by_token(token, db)
    board = db.query(AdvisoryBoard).filter(AdvisoryBoard.id == client.board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")

    if _client_is_locked(client, x_client_session):
        return {"locked": True, "board_title": board.title, "client_name": client.name}

    _touch_last_seen(client, db)

    meetings = db.query(BoardMeeting).filter(
        BoardMeeting.board_id == board.id
    ).order_by(BoardMeeting.scheduled_at.asc()).all()

    return {
        "locked": False,
        # Lets the portal show a Sign out control only where ending the session
        # actually means something.
        "password_protected": bool(client.password_hash),
        "client": {"name": client.name, "email": client.email, "organization": client.organization},
        "board": {
            "id": board.id,
            "title": board.title,
            "client": board.client,
            "sponsor": board.sponsor,
            "status": _enum_value(board.status),
            "current_phase": _enum_value(board.current_phase),
            "scheduled_date": board.scheduled_date.isoformat() if board.scheduled_date else None,
            "format": _enum_value(board.format),
            "objective": board.objective,
        },
        "meetings": [
            {
                "id": m.id,
                "title": m.title,
                "status": _enum_value(m.status),
                "scheduled_at": m.scheduled_at.isoformat() if m.scheduled_at else None,
            }
            for m in meetings
        ],
    }


@router.get("/public/client/{token}/meetings/{meeting_id}/agenda")
def list_client_agenda(token: str, meeting_id: int, db: Session = Depends(get_db),
                       x_client_session: Optional[str] = Header(None)):
    """The meeting's running order, for the client's own Agenda tab.

    Read-only and board-scoped: the client sees the agenda of a meeting on THEIR
    board and nothing else. Presenter names are deliberately left out — the team
    decides who presents, and a name here would read as a commitment to them.
    """
    client = _authed_client(token, db, x_client_session)
    meeting = db.query(BoardMeeting).filter(
        BoardMeeting.id == meeting_id,
        BoardMeeting.board_id == client.board_id,
    ).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    items = (
        db.query(MeetingAgendaItem)
        .filter(MeetingAgendaItem.meeting_id == meeting.id)
        .order_by(MeetingAgendaItem.sequence.asc(), MeetingAgendaItem.id.asc())
        .all()
    )
    return {
        "meeting": {
            "id": meeting.id,
            "title": meeting.title,
            "status": _enum_value(meeting.status),
            "scheduled_at": meeting.scheduled_at.isoformat() if meeting.scheduled_at else None,
            "duration_minutes": meeting.duration_minutes,
            "agenda_summary": meeting.agenda_summary,
        },
        "items": [
            {
                "id": a.id,
                "sequence": a.sequence,
                "title": a.title,
                "description": a.description,
                "duration_minutes": a.duration_minutes,
            }
            for a in items
        ],
    }


@router.get("/public/client/{token}/documents")
def list_client_documents(token: str, db: Session = Depends(get_db),
                          x_client_session: Optional[str] = Header(None)):
    """Documents the team shared with the client, with this client's approval status."""
    client = _authed_client(token, db, x_client_session)
    rows = (
        db.query(MeetingDocument, BoardMeeting.title)
        .join(BoardMeeting, MeetingDocument.meeting_id == BoardMeeting.id)
        .filter(
            BoardMeeting.board_id == client.board_id,
            MeetingDocument.client_visible == True,   # noqa: E712
            MeetingDocument.is_enabled == True,        # noqa: E712
        )
        .order_by(MeetingDocument.created_at.desc())
        .all()
    )
    return [
        {
            "id": doc.id,
            "title": doc.title,
            "category": _enum_value(doc.category),
            "phase": _enum_value(doc.phase),
            "meeting_id": doc.meeting_id,
            "meeting_title": meeting_title,
            # Section (folder) the document is filed in, so the list is grouped
            # rather than being one long pile. The session is a separate field —
            # which part of the meeting it belongs to — shown on the row itself.
            "section_id": doc.section_id,
            "section_title": doc.section.title if doc.section else None,
            "section_sequence": doc.section.sequence if doc.section else None,
            "session_title": doc.doc_session.title if doc.doc_session else (doc.agenda_item.title if doc.agenda_item else None),
            "size_bytes": doc.size_bytes,
            "mime_type": doc.mime_type,
            # What the portal should render inline: 'pdf' | 'image' | 'text' | null.
            # Office files report 'pdf' — they are converted on demand.
            "preview_kind": document_preview.preview_kind(doc.file_path or ""),
            "created_at": doc.created_at.isoformat(),
            "approval": _approval_status_for(doc.id, client.id, db),
        }
        for doc, meeting_title in rows
    ]


@router.get("/public/client/{token}/documents/{document_id}/download")
def download_client_document(token: str, document_id: int, db: Session = Depends(get_db),
                             x_client_session: Optional[str] = Header(None)):
    _client, doc = _client_visible_doc_or_404(token, document_id, db, x_client_session)
    if not doc.file_path or not os.path.isfile(doc.file_path):
        raise HTTPException(status_code=404, detail="File not found on server")
    filename = os.path.basename(doc.file_path)
    return FileResponse(doc.file_path, media_type=doc.mime_type or "application/octet-stream", filename=filename)


@router.get("/public/client/{token}/documents/{document_id}/preview")
def preview_client_document(token: str, document_id: int, db: Session = Depends(get_db),
                            x_client_session: Optional[str] = Header(None)):
    """The document as something a browser can show: the file itself for PDF,
    images and text; a LibreOffice-made PDF for Word/PowerPoint/Excel.

    Same access rule as the download route — sharing with the client is what
    makes it readable, and this only changes the FORM it is read in.
    """
    _client, doc = _client_visible_doc_or_404(token, document_id, db, x_client_session)
    try:
        path, media_type = document_preview.prepare(doc.file_path or "", doc.mime_type)
    except document_preview.PreviewError as e:
        # 415: the file is fine, this format just can't be shown inline. The
        # portal falls back to Download and shows this message.
        raise HTTPException(status_code=415, detail=str(e))
    return FileResponse(
        path, media_type=media_type,
        filename=os.path.basename(path),
        content_disposition_type="inline",
    )


@router.post("/public/client/{token}/documents/{document_id}/approval")
def submit_document_approval(
    token: str, document_id: int, data: ApprovalSubmit, db: Session = Depends(get_db),
    x_client_session: Optional[str] = Header(None),
):
    client, doc = _client_visible_doc_or_404(token, document_id, db, x_client_session)
    status = (data.status or "").strip()
    if status not in _VALID_APPROVAL:
        raise HTTPException(status_code=400, detail=f"Invalid status. Allowed: {sorted(_VALID_APPROVAL)}")

    approval = db.query(DocumentApproval).filter(
        DocumentApproval.document_id == doc.id,
        DocumentApproval.board_client_id == client.id,
    ).first()
    if not approval:
        approval = DocumentApproval(document_id=doc.id, board_client_id=client.id)
        db.add(approval)
    approval.status = status
    approval.comment = (data.comment or None)
    approval.decided_at = datetime.utcnow()
    db.commit()
    db.refresh(approval)
    return {
        "document_id": doc.id,
        "status": _enum_value(approval.status),
        "comment": approval.comment,
        "decided_at": approval.decided_at.isoformat() if approval.decided_at else None,
    }


# ── Session discussion (client side) ─────────────────────────────────────────
# The panel's thread on each session, which the client can now answer rather
# than only read as a count on the Engagement tab. The sponsor is the party
# asking the questions the board exists to settle, so leaving them unable to
# reply to an expert's comment made the forum a suggestion box.

class SessionCommentReq(BaseModel):
    body: str


def _client_meeting_or_404(client: BoardClient, meeting_id: int, db: Session) -> BoardMeeting:
    """Scoped to the client's own board — a portal token must not reach another
    board's discussion by guessing a meeting id."""
    meeting = db.query(BoardMeeting).filter(
        BoardMeeting.id == meeting_id,
        BoardMeeting.board_id == client.board_id,
    ).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


def _client_viewer(client: BoardClient) -> session_discussion.Viewer:
    """Never a moderator: the client writes and removes their own, and must not
    be able to delete an expert's criticism of the material they commissioned."""
    return session_discussion.Viewer(
        kind=session_discussion.CLIENT,
        id=client.id,
        name=client.name or "Client",
        can_post=True,
        can_moderate=False,
    )


@router.get("/public/client/{token}/meetings/{meeting_id}/discussion")
def get_client_discussion(token: str, meeting_id: int, db: Session = Depends(get_db),
                          x_client_session: Optional[str] = Header(None)):
    client = _authed_client(token, db, x_client_session)
    meeting = _client_meeting_or_404(client, meeting_id, db)
    _touch_last_seen(client, db)
    return session_discussion.build_discussion(db, meeting, _client_viewer(client))


@router.post("/public/client/{token}/meetings/{meeting_id}/comments", status_code=201)
def add_client_comment(token: str, meeting_id: int, data: SessionCommentReq,
                       db: Session = Depends(get_db),
                       x_client_session: Optional[str] = Header(None)):
    """Answer the panel without tying it to one session — the counterpart of the
    expert's flat Discussion tab."""
    client = _authed_client(token, db, x_client_session)
    meeting = _client_meeting_or_404(client, meeting_id, db)
    try:
        body = session_discussion.clean_body(data.body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    viewer = _client_viewer(client)
    c = session_discussion.add_comment(db, meeting, None, body, viewer)
    _touch_last_seen(client, db)
    return session_discussion.comment_dict(c, viewer)


@router.delete("/public/client/{token}/meetings/{meeting_id}/comments/{comment_id}")
def delete_client_comment(token: str, meeting_id: int, comment_id: int,
                          db: Session = Depends(get_db),
                          x_client_session: Optional[str] = Header(None)):
    client = _authed_client(token, db, x_client_session)
    meeting = _client_meeting_or_404(client, meeting_id, db)
    c = db.query(MeetingSessionComment).filter(
        MeetingSessionComment.id == comment_id,
        MeetingSessionComment.meeting_id == meeting.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    if not session_discussion.may_delete(c, _client_viewer(client)):
        raise HTTPException(status_code=403, detail="You can only delete your own comments.")
    db.delete(c)
    db.commit()
    return {"deleted": True}


@router.post("/public/client/{token}/meetings/{meeting_id}/sessions/{agenda_item_id}/comments",
             status_code=201)
def add_client_session_comment(token: str, meeting_id: int, agenda_item_id: int,
                               data: SessionCommentReq, db: Session = Depends(get_db),
                               x_client_session: Optional[str] = Header(None)):
    client = _authed_client(token, db, x_client_session)
    meeting = _client_meeting_or_404(client, meeting_id, db)

    item = session_discussion.get_session_or_none(db, meeting.id, agenda_item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        body = session_discussion.clean_body(data.body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    viewer = _client_viewer(client)
    c = session_discussion.add_comment(db, meeting, item, body, viewer)
    _touch_last_seen(client, db)
    return session_discussion.comment_dict(c, viewer)


@router.delete("/public/client/{token}/meetings/{meeting_id}/sessions/{agenda_item_id}/comments/{comment_id}")
def delete_client_session_comment(token: str, meeting_id: int, agenda_item_id: int,
                                  comment_id: int, db: Session = Depends(get_db),
                                  x_client_session: Optional[str] = Header(None)):
    client = _authed_client(token, db, x_client_session)
    meeting = _client_meeting_or_404(client, meeting_id, db)
    c = db.query(MeetingSessionComment).filter(
        MeetingSessionComment.id == comment_id,
        MeetingSessionComment.agenda_item_id == agenda_item_id,
        MeetingSessionComment.meeting_id == meeting.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    if not session_discussion.may_delete(c, _client_viewer(client)):
        raise HTTPException(status_code=403, detail="You can only delete your own comments.")
    db.delete(c)
    db.commit()
    return {"deleted": True}


# ── Engagement dashboard (client side) ───────────────────────────────────────
# The same roll-up the organizer sees. The client is the party the advisory board
# is being run *for*, and "are the experts actually reading what we prepared" is
# their question as much as anyone's.

@router.get("/public/client/{token}/meetings/{meeting_id}/engagement")
def get_client_engagement(token: str, meeting_id: int, db: Session = Depends(get_db),
                          x_client_session: Optional[str] = Header(None)):
    client = _authed_client(token, db, x_client_session)
    meeting = db.query(BoardMeeting).filter(
        BoardMeeting.id == meeting_id,
        # Scoped to the client's own board — a token must not read another
        # board's engagement by guessing a meeting id.
        BoardMeeting.board_id == client.board_id,
    ).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    _touch_last_seen(client, db)
    return build_engagement(db, meeting)


# ── Survey results (client side) ─────────────────────────────────────────────
# The client commissioned the board to find something out; the survey is the
# answer. They can read the roll-up on their Survey Results tab, and take the
# full response set away from here.

@router.get("/public/client/{token}/meetings/{meeting_id}/surveys/{survey_id}/responses")
def client_survey_responses(
    token: str, meeting_id: int, survey_id: int,
    db: Session = Depends(get_db),
    x_client_session: Optional[str] = Header(None),
):
    """Full responses for one survey linked to one of the client's meetings.

    Returns the SAME shape as the team's `/surveys/{id}/results`, reusing its
    serialisers, so the client's export and the team's cannot drift apart.

    Access is chained deliberately: the survey must be linked to the meeting,
    the meeting must belong to the client's board, and the client must have
    passed the password gate. Holding a portal token is not enough to read an
    arbitrary survey id.
    """
    client = _authed_client(token, db, x_client_session)
    meeting = db.query(BoardMeeting).filter(
        BoardMeeting.id == meeting_id,
        BoardMeeting.board_id == client.board_id,
    ).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    link = db.query(MeetingSurvey).filter(
        MeetingSurvey.meeting_id == meeting.id,
        MeetingSurvey.survey_id == survey_id,
    ).first()
    if not link or not link.survey:
        raise HTTPException(status_code=404, detail="That survey is not linked to this meeting.")

    survey = link.survey
    completed = [r for r in survey.responses if r.status == "complete"]
    q_map = _question_column_keys(survey.questions)
    return {
        "survey_id": survey.id,
        "title": survey.title,
        "phase": _enum_value(link.phase),
        "total_responses": len(completed),
        "columns": _result_column_order(survey, q_map),
        "responses": _responses_to_list(survey),
        # The live form, so the client can see the questions as the experts saw
        # them rather than inferring them from column headers.
        "survey_token": survey.token,
    }
