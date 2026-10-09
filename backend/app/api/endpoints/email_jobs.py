"""
Cron-callable email job endpoints (Phase 5).

Exposed under super_admin auth so an external scheduler (cron, GitHub Actions,
APScheduler in a sidecar) can POST to them on a schedule. All jobs are
idempotent — safe to call repeatedly without sending duplicate emails.

Schedule recommendations:
  POST /jobs/send-meeting-reminders   every 30 min
  POST /jobs/send-manuscript-pings    daily
"""
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_super_admin
from app.models.user import User
from app.models.meeting import BoardMeeting, MeetingStatus
from app.models.meeting_participant import MeetingParticipant
from app.models.manuscript import Manuscript, ManuscriptStatus, TERMINAL_STATUSES
from app.models.email_log import EmailLog, EmailKind
from app.services import email_service
from app.services import account_config

router = APIRouter(tags=["MABM - Email Jobs"])


def _enum_value(v):
    return v.value if hasattr(v, "value") else v


def _participant_emails(meeting_id: int, db: Session) -> List[str]:
    rows = db.query(MeetingParticipant).filter(MeetingParticipant.meeting_id == meeting_id).all()
    return list(dict.fromkeys([p.user.email for p in rows if p.user and p.user.email]))


def _meeting_url(meeting_id: int) -> str:
    return f"{settings.APP_PUBLIC_URL.rstrip('/')}/advisory-boards#meetings/{meeting_id}"


def _already_sent(db: Session, kind: str, meeting_id: int) -> bool:
    return db.query(EmailLog).filter(
        EmailLog.kind == kind,
        EmailLog.related_meeting_id == meeting_id,
        EmailLog.success.is_(True),
    ).first() is not None


# ── Meeting reminders ────────────────────────────────────

@router.post("/jobs/send-meeting-reminders")
def send_meeting_reminders(
    db: Session = Depends(get_db),
    admin: User = Depends(get_super_admin),
):
    """
    Sends:
      - 24h reminders for meetings scheduled within [now + 23h, now + 25h]
      - 1h reminders for meetings scheduled within [now + 30min, now + 90min]
    Each meeting receives at most one reminder of each kind (idempotency via email_logs).
    """
    now = datetime.utcnow()
    summary = {"reminder_24h_meetings": 0, "reminder_24h_emails": 0,
               "reminder_1h_meetings": 0, "reminder_1h_emails": 0}

    # 24h window
    candidates_24h = db.query(BoardMeeting).filter(
        BoardMeeting.status == MeetingStatus.scheduled.value,
        BoardMeeting.scheduled_at >= now + timedelta(hours=23),
        BoardMeeting.scheduled_at <= now + timedelta(hours=25),
    ).all()
    for m in candidates_24h:
        if _already_sent(db, EmailKind.meeting_reminder_24h.value, m.id):
            continue
        body = (
            f"<p>Reminder: <strong>{m.title}</strong> is scheduled for "
            f"<strong>{m.scheduled_at.isoformat()}</strong> (about 24 hours from now).</p>"
            + (f"<p>Join link: <a href=\"{m.join_url}\">{m.join_url}</a></p>" if m.join_url else "")
            + f"<p>Meeting page: <a href=\"{_meeting_url(m.id)}\">{_meeting_url(m.id)}</a></p>"
        )
        sent = email_service.send_email_bulk(
            db, recipients=_participant_emails(m.id, db),
            subject=f"Reminder: {m.title} (in 24h)",
            body_html=body,
            kind=EmailKind.meeting_reminder_24h.value,
            meeting_id=m.id,
            owner_user_id=account_config.owner_of_meeting(m),
        )
        summary["reminder_24h_meetings"] += 1
        summary["reminder_24h_emails"] += sent

    # 1h window
    candidates_1h = db.query(BoardMeeting).filter(
        BoardMeeting.status == MeetingStatus.scheduled.value,
        BoardMeeting.scheduled_at >= now + timedelta(minutes=30),
        BoardMeeting.scheduled_at <= now + timedelta(minutes=90),
    ).all()
    for m in candidates_1h:
        if _already_sent(db, EmailKind.meeting_reminder_1h.value, m.id):
            continue
        body = (
            f"<p>Starting in about 1 hour: <strong>{m.title}</strong>.</p>"
            + (f"<p><a href=\"{m.join_url}\">Click to join</a></p>" if m.join_url else "")
            + f"<p>Meeting page: <a href=\"{_meeting_url(m.id)}\">{_meeting_url(m.id)}</a></p>"
        )
        sent = email_service.send_email_bulk(
            db, recipients=_participant_emails(m.id, db),
            subject=f"Starting soon: {m.title}",
            body_html=body,
            kind=EmailKind.meeting_reminder_1h.value,
            meeting_id=m.id,
            owner_user_id=account_config.owner_of_meeting(m),
        )
        summary["reminder_1h_meetings"] += 1
        summary["reminder_1h_emails"] += sent

    return {"detail": "ok", **summary}


# ── Manuscript 15-day pings ──────────────────────────────

@router.post("/jobs/send-manuscript-pings")
def send_manuscript_pings(
    db: Session = Depends(get_db),
    admin: User = Depends(get_super_admin),
):
    """
    Doc requirement: "Status message should be sent to all participants every
    15 days until manuscript is published."

    Sends a status ping for every non-terminal manuscript where the last status
    email was sent more than 15 days ago (or never).
    """
    now = datetime.utcnow()
    threshold = now - timedelta(days=15)

    candidates = db.query(Manuscript).filter(
        ~Manuscript.status.in_(list(TERMINAL_STATUSES)),
    ).all()

    pinged = 0
    emails_sent = 0
    for m in candidates:
        last = m.last_status_email_at
        if last is not None and last > threshold:
            continue
        meeting = m.meeting
        if not meeting:
            continue
        pretty = _enum_value(m.status).replace("_", " ").title()
        body = (
            f"<p>Status update on the manuscript <strong>{m.title}</strong> "
            f"(meeting: {meeting.title}).</p>"
            f"<p>Current status: <strong>{pretty}</strong>.</p>"
            + (f"<p>Journal: {m.journal_name}</p>" if m.journal_name else "")
            + f"<p>View: <a href=\"{_meeting_url(meeting.id)}\">{_meeting_url(meeting.id)}</a></p>"
        )
        sent = email_service.send_email_bulk(
            db, recipients=_participant_emails(meeting.id, db),
            subject=f"Manuscript status update: {m.title}",
            body_html=body,
            kind=EmailKind.manuscript_15day_ping.value,
            meeting_id=meeting.id,
            manuscript_id=m.id,
            owner_user_id=account_config.owner_of_meeting(meeting),
        )
        m.last_status_email_at = now
        pinged += 1
        emails_sent += sent

    db.commit()
    return {"detail": "ok", "manuscripts_pinged": pinged, "emails_sent": emails_sent}


# ── Email log viewer ─────────────────────────────────────

@router.get("/jobs/email-log")
def recent_email_log(
    limit: int = 100,
    kind: Optional[str] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(get_super_admin),
):
    q = db.query(EmailLog)
    if kind:
        q = q.filter(EmailLog.kind == kind)
    rows = q.order_by(EmailLog.sent_at.desc()).limit(min(limit, 500)).all()
    return [{
        "id": r.id,
        "recipient_email": r.recipient_email,
        "subject": r.subject,
        "kind": _enum_value(r.kind),
        "related_meeting_id": r.related_meeting_id,
        "related_manuscript_id": r.related_manuscript_id,
        "success": r.success,
        "error": r.error,
        "sent_at": r.sent_at.isoformat(),
    } for r in rows]
