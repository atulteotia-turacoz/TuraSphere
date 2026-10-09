"""
Board workspace email communication: send invitations / reminders / review
notifications and view the sent-email history (with delivery status).

Reuses email_service (SMTP with a dev stdout fallback) and the EmailLog audit
table. Every send is scoped to the board (related_board_id) so the history shows
in the project workspace.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.config import settings
from app.core.security import get_current_user
from app.models.user import User
from app.models.meeting import BoardMeeting
from app.models.meeting_participant import MeetingParticipant
from app.models.meeting_document import MeetingDocument
from app.models.meeting_engagement import MeetingSurvey
from app.models.board_client import BoardClient
from app.models.email_log import EmailLog, EmailKind
from app.services import email_service
from app.services.board_activity import log_board_activity
from app.api.endpoints.advisory_boards import _get_board_or_404, _check_board_access, _enum_value

router = APIRouter(tags=["MABM - Board Emails"])

APP = settings.APP_PUBLIC_URL.rstrip("/")


class EmailSend(BaseModel):
    type: str                      # kol_invite | survey_reminder | document_review | report_review
    document_id: Optional[int] = None
    note: Optional[str] = None


# ── Recipient helpers ────────────────────────────────────

def _participant_email(p: MeetingParticipant):
    if p.user and p.user.email:
        return p.user.full_name, p.user.email
    if p.participant and p.participant.email:
        return p.participant.full_name, p.participant.email
    return None, None


def _board_participants(board_id: int, db: Session):
    """All KOL/advisor participants across the board's meeting(s) that have an email + join token."""
    return (
        db.query(MeetingParticipant)
        .join(BoardMeeting, MeetingParticipant.meeting_id == BoardMeeting.id)
        .filter(BoardMeeting.board_id == board_id, MeetingParticipant.access_token.isnot(None))
        .all()
    )


def _board_meeting_id(board_id: int, db: Session):
    m = db.query(BoardMeeting).filter(BoardMeeting.board_id == board_id).order_by(BoardMeeting.id.asc()).first()
    return m.id if m else None


def _wrap(title: str, lines: list, cta_label: str, cta_url: str, links: Optional[list] = None) -> str:
    """`links` is an optional list of (label, url) rendered above the CTA — the
    actual surveys / documents the email is about. Recipients asked for the real
    links in the mail rather than only a button to the portal home, and several
    mail clients strip or hide button styling, so every URL is also printed as
    plain text below."""
    body = "".join(f"<p style='margin:0 0 10px'>{l}</p>" for l in lines)

    link_block = ""
    if links:
        items = "".join(
            f"<li style='margin:0 0 6px'>"
            f"<a href='{url}' style='color:#4F46E5;font-weight:600'>{label}</a><br>"
            f"<span style='font-size:11px;color:#94a3b8'>{url}</span></li>"
            for label, url in links
        )
        link_block = f"<ul style='margin:0 0 4px;padding-left:18px'>{items}</ul>"

    return (
        f"<div style='font-family:Arial,sans-serif;color:#0f172a'>"
        f"<h2 style='margin:0 0 12px'>{title}</h2>{body}{link_block}"
        f"<p style='margin:18px 0'><a href='{cta_url}' "
        f"style='background:#4F46E5;color:#fff;padding:10px 18px;border-radius:8px;"
        f"text-decoration:none;font-weight:600'>{cta_label}</a></p>"
        f"<p style='font-size:12px;color:#64748b'>Or open: {cta_url}</p></div>"
    )


def _meeting_surveys(meeting_id: Optional[int], db: Session) -> list:
    """(label, url) for every survey linked to the meeting that has a public
    token. `/survey/{token}` is already a public page, so these are safe to mail
    as-is — no per-recipient gating to lose."""
    if not meeting_id:
        return []
    out = []
    for link in db.query(MeetingSurvey).filter(MeetingSurvey.meeting_id == meeting_id).all():
        s = link.survey
        if not s or not s.token:
            continue
        phase = _enum_value(link.phase)
        suffix = " (pre-meeting)" if phase == "pre" else " (post-meeting)" if phase == "post" else ""
        out.append((f"{s.title or 'Survey'}{suffix}", f"{APP}/survey/{s.token}"))
    return out


def _meeting_documents(meeting_id: Optional[int], db: Session, document_id: Optional[int] = None):
    """Returns (docs, direct_links) for the documents shared with KOLs on this meeting.

    `direct_links` covers only documents that already carry a public share token.
    Whether a document is public is decided in ONE place — the 🔗 action on the
    documents panel (`create_document_share_link` / `revoke_document_share_link`)
    — and this email simply reflects that state. Sending mail never mints a token:
    a public token makes the file readable by anyone holding the link, and having
    two different screens able to publish a file made it unclear which one governed.

    Documents without a token are still named in the mail; the recipient reaches
    them through their own portal link, gated on their `view_documents` permission.
    """
    if not meeting_id:
        return [], []
    q = db.query(MeetingDocument).filter(
        MeetingDocument.meeting_id == meeting_id,
        MeetingDocument.is_enabled == True,    # noqa: E712
        MeetingDocument.kol_visible == True,   # noqa: E712
    )
    if document_id:
        q = q.filter(MeetingDocument.id == document_id)
    docs = q.order_by(MeetingDocument.created_at.desc()).all()
    direct_links = [
        (d.title or "Document", f"{APP}{settings.API_V1_STR}/public/documents/{d.public_token}")
        for d in docs if d.public_token
    ]
    return docs, direct_links


# ── Send ─────────────────────────────────────────────────

@router.post("/advisory-boards/{board_id}/emails/send")
def send_board_email(
    board_id: int,
    data: EmailSend,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)
    meeting_id = _board_meeting_id(board_id, db)
    note = (data.note or "").strip()
    note_line = [note] if note else []
    sent, failed = 0, 0

    def _send(name, email, subject, html, kind):
        nonlocal sent, failed
        log = email_service.send_email(db, to=email, subject=subject, body_html=html,
                                       kind=kind, board_id=board_id, meeting_id=meeting_id,
                                       owner_user_id=board.created_by)
        if log.success:
            sent += 1
        else:
            failed += 1

    if data.type == EmailKind.report_review.value:
        # → board clients
        clients = db.query(BoardClient).filter(
            BoardClient.board_id == board_id, BoardClient.access_token.isnot(None)
        ).all()
        if not clients:
            raise HTTPException(status_code=400, detail="No clients with a portal link assigned to this board")
        subject = f"Report ready for your review — {board.title}"
        for c in clients:
            url = f"{APP}/client/{c.access_token}"
            html = _wrap("Report review", [f"Dear {c.name},",
                         f"A report for <b>{board.title}</b> is ready for your review and approval."] + note_line,
                         "Review in your portal", url)
            _send(c.name, c.email, subject, html, EmailKind.report_review.value)

    elif data.type in (EmailKind.kol_invite.value, EmailKind.survey_reminder.value, EmailKind.document_review.value):
        # → KOL/advisor participants
        parts = _board_participants(board_id, db)
        if not parts:
            raise HTTPException(status_code=400, detail="No KOLs/advisors with a join link on this board")

        # The actual thing the email is about, so the recipient gets a real link
        # rather than only a button to the portal home. `portal_tab` deep-links
        # the portal to the relevant tab for anything that can't be linked
        # directly (documents without a public share token).
        links, portal_tab = [], None

        if data.type == EmailKind.kol_invite.value:
            subject, title, intro, cta = (f"You're invited — {board.title}", "Advisory board invitation",
                                          f"You have been invited to the advisory board <b>{board.title}</b>.", "Open your portal")
        elif data.type == EmailKind.survey_reminder.value:
            links = _meeting_surveys(meeting_id, db)
            portal_tab = "engagements"
            names = ", ".join(f"“{lbl}”" for lbl, _ in links)
            subject, title, intro, cta = (
                f"Reminder: complete your survey — {board.title}", "Survey reminder",
                (f"This is a reminder to complete {names} for <b>{board.title}</b>."
                 if links else
                 f"This is a reminder to complete your survey for <b>{board.title}</b>."),
                "Complete survey" if len(links) == 1 else "Open your portal",
            )
        else:
            docs, links = _meeting_documents(meeting_id, db, data.document_id)
            portal_tab = "materials"
            names = ", ".join(f"“{d.title}”" for d in docs if d.title)
            subject, title, intro, cta = (
                f"Document for your review — {board.title}", "Document review",
                (f"{names} {'is' if len(docs) == 1 else 'are'} ready for your review "
                 f"in <b>{board.title}</b>." if names else
                 f"A document is ready for your review in <b>{board.title}</b>."),
                "Review document",
            )
            if docs and not links:
                # Reachable only through the portal — say so, rather than leaving
                # the recipient wondering where the promised link is.
                note_line = note_line + ["Open your portal below to view and download it."]

        for p in parts:
            name, email = _participant_email(p)
            if not email:
                continue
            url = f"{APP}/meeting/join/{p.access_token}"
            if portal_tab:
                url = f"{url}?tab={portal_tab}"
            # A single directly-linkable survey becomes the button itself; anything
            # else keeps the personal portal link as the CTA, with the resources
            # listed above it.
            cta_url = links[0][1] if (data.type == EmailKind.survey_reminder.value and len(links) == 1) else url
            html = _wrap(title, [f"Dear {name or 'Advisor'},", intro] + note_line, cta, cta_url, links=links)
            _send(name, email, subject, html, data.type)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown email type: {data.type}")

    log_board_activity(db, board_id, current_user.id, "email.sent",
                       f"Sent {data.type} email — {sent} delivered, {failed} failed")
    return {"type": data.type, "sent": sent, "failed": failed}


# ── History ──────────────────────────────────────────────

@router.get("/advisory-boards/{board_id}/emails")
def list_board_emails(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)
    rows = db.query(EmailLog).filter(
        EmailLog.related_board_id == board_id
    ).order_by(EmailLog.sent_at.desc()).limit(300).all()
    return [
        {
            "id": e.id,
            "recipient_email": e.recipient_email,
            "subject": e.subject,
            "kind": _enum_value(e.kind),
            "success": bool(e.success),
            "error": e.error,
            "body_preview": e.body_preview,   # rendered when opening a record
            "sent_at": e.sent_at.isoformat(),
        }
        for e in rows
    ]
