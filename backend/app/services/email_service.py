"""
Email sender for the MABM module (Phase 5).

Behavior:
  - If SMTP_HOST is configured, sends via SMTP with TLS.
  - If SMTP_HOST is empty, logs the email to stdout instead (dev fallback —
    no crash, clear "[email-dev]" prefix in logs).
  - Every send (success or failure) is logged to email_logs for audit + the
    cron job idempotency checks.

Caller responsibility: pass the right `kind` so cron jobs can dedupe correctly.
"""
import smtplib
from email.message import EmailMessage
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.email_log import EmailLog, EmailKind
from app.services import account_config


class _SmtpSettings:
    """Resolved SMTP parameters — from an account/global SmtpConfig row, or env."""
    def __init__(self, host, port, username, password, use_tls, from_name, from_email):
        self.host = host
        self.port = port or 587
        self.username = username
        self.password = password
        self.use_tls = use_tls
        self.from_name = from_name or "TuraQuant Advisory Boards"
        self.from_email = from_email or "no-reply@turaquant.com"


def _resolve_smtp(db: Session, owner_user_id: Optional[int]) -> _SmtpSettings:
    """Account's own SMTP config → global default → env settings.SMTP_*."""
    cfg = account_config.resolve_smtp(db, owner_user_id)
    if cfg:
        return _SmtpSettings(cfg.host, cfg.port, cfg.username, cfg.password,
                             cfg.use_tls, cfg.from_name, cfg.from_email)
    return _SmtpSettings(settings.SMTP_HOST, settings.SMTP_PORT, settings.SMTP_USERNAME,
                         settings.SMTP_PASSWORD, settings.SMTP_USE_TLS,
                         settings.SMTP_FROM_NAME, settings.SMTP_FROM_EMAIL)


def _record(
    db: Session,
    *,
    recipient: str,
    subject: str,
    body: str,
    kind: str,
    meeting_id: Optional[int],
    manuscript_id: Optional[int],
    success: bool,
    error: Optional[str],
    board_id: Optional[int] = None,
    owner_user_id: Optional[int] = None,
) -> EmailLog:
    log = EmailLog(
        owner_user_id=owner_user_id,
        recipient_email=recipient,
        subject=subject[:500],
        body_preview=(body or "")[:8000],   # keep enough to render the email in history
        kind=kind,
        related_board_id=board_id,
        related_meeting_id=meeting_id,
        related_manuscript_id=manuscript_id,
        success=success,
        error=error,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def _build_message(smtp: _SmtpSettings, to: str, subject: str, body_html: str) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{smtp.from_name} <{smtp.from_email}>"
    msg["To"] = to
    # Set both plain + html so non-HTML clients aren't surprised
    plain = body_html  # callers pass simple text/HTML; we send the same string both ways
    msg.set_content(plain)
    msg.add_alternative(body_html, subtype="html")
    return msg


def send_email(
    db: Session,
    *,
    to: str,
    subject: str,
    body_html: str,
    kind: str = EmailKind.other.value,
    meeting_id: Optional[int] = None,
    manuscript_id: Optional[int] = None,
    board_id: Optional[int] = None,
    owner_user_id: Optional[int] = None,
) -> EmailLog:
    """Sends one email (using the owning account's SMTP, falling back to the global
    default then env settings) and writes an EmailLog row. Returns the log row."""
    rec = dict(meeting_id=meeting_id, manuscript_id=manuscript_id, board_id=board_id,
               owner_user_id=owner_user_id)
    if not to:
        return _record(db, recipient="(missing)", subject=subject, body=body_html,
                       kind=kind, success=False, error="No recipient email", **rec)

    smtp = _resolve_smtp(db, owner_user_id)

    if not smtp.host:
        # Dev fallback — log to stdout, mark as success so cron jobs treat it as sent
        print(f"[email-dev] to={to} subject={subject!r} kind={kind}\n{body_html}\n")
        return _record(db, recipient=to, subject=subject, body=body_html,
                       kind=kind, success=True,
                       error="(no SMTP host configured; logged to stdout)", **rec)

    msg = _build_message(smtp, to, subject, body_html)
    try:
        with smtplib.SMTP(smtp.host, smtp.port, timeout=20) as s:
            if smtp.use_tls:
                s.starttls()
            if smtp.username:
                s.login(smtp.username, smtp.password)
            s.send_message(msg)
    except Exception as e:
        return _record(db, recipient=to, subject=subject, body=body_html,
                       kind=kind, success=False, error=str(e)[:1000], **rec)

    return _record(db, recipient=to, subject=subject, body=body_html,
                   kind=kind, success=True, error=None, **rec)


def send_email_bulk(
    db: Session,
    *,
    recipients: Iterable[str],
    subject: str,
    body_html: str,
    kind: str = EmailKind.other.value,
    meeting_id: Optional[int] = None,
    manuscript_id: Optional[int] = None,
    board_id: Optional[int] = None,
    owner_user_id: Optional[int] = None,
) -> int:
    """Sends to every recipient and returns the count of successful deliveries."""
    successes = 0
    for to in recipients:
        log = send_email(
            db, to=to, subject=subject, body_html=body_html, kind=kind,
            meeting_id=meeting_id, manuscript_id=manuscript_id, board_id=board_id,
            owner_user_id=owner_user_id,
        )
        if log.success:
            successes += 1
    return successes
