"""
Board update notifications.

A single helper that emails the people involved in an advisory board — the
assigned team (board creator + BoardTeamMember rows) and, optionally, the
meeting participants — whenever something changes (document added/shared, stage
change, meeting start/end, minutes shared/finalized, etc.).

Every wiring site calls `notify_board(...)` inside a try/except so a notification
failure never breaks the underlying action.
"""
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.advisory_board import AdvisoryBoard
from app.models.board_workspace import BoardTeamMember
from app.models.meeting import BoardMeeting
from app.models.meeting_participant import MeetingParticipant
from app.services import email_service
from app.models.email_log import EmailKind


def _participant_email(p: MeetingParticipant) -> Optional[str]:
    if p.participant_id and p.participant:
        return p.participant.email
    if p.user:
        return p.user.email
    return None


def board_recipients(
    db: Session,
    board_id: int,
    *,
    include_team: bool = True,
    include_participants: bool = True,
    meeting_id: Optional[int] = None,
) -> Tuple[List[str], Optional[int]]:
    """Returns (deduped recipient emails, owner_user_id) for a board."""
    board = db.query(AdvisoryBoard).filter(AdvisoryBoard.id == board_id).first()
    if not board:
        return [], None

    emails = set()
    if include_team:
        if board.creator and board.creator.email:
            emails.add(board.creator.email)
        for tm in db.query(BoardTeamMember).filter(BoardTeamMember.board_id == board_id).all():
            if tm.user and tm.user.email:
                emails.add(tm.user.email)

    if include_participants:
        q = (
            db.query(MeetingParticipant)
            .join(BoardMeeting, MeetingParticipant.meeting_id == BoardMeeting.id)
            .filter(BoardMeeting.board_id == board_id)
        )
        if meeting_id:
            q = q.filter(MeetingParticipant.meeting_id == meeting_id)
        for p in q.all():
            e = _participant_email(p)
            if e:
                emails.add(e)

    return sorted(e for e in emails if e), board.created_by


def build_body(title: str, lines: List[str], cta_label: Optional[str] = None, cta_url: Optional[str] = None) -> str:
    rows = "".join(f'<p style="margin:6px 0">{l}</p>' for l in lines)
    cta = ""
    if cta_label and cta_url:
        cta = (
            f'<p style="margin:18px 0"><a href="{cta_url}" '
            f'style="background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;'
            f'display:inline-block">{cta_label}</a></p>'
        )
    return (
        '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.6">'
        f'<h2 style="font-size:1.1rem;margin:0 0 10px">{title}</h2>{rows}{cta}</div>'
    )


def notify_board(
    db: Session,
    board_id: int,
    *,
    subject: str,
    body_html: str,
    kind: str = EmailKind.other.value,
    include_team: bool = True,
    include_participants: bool = True,
    meeting_id: Optional[int] = None,
) -> int:
    """Emails the board's team (+ participants) and returns the success count.
    Best-effort: callers wrap this in try/except."""
    recipients, owner_id = board_recipients(
        db, board_id,
        include_team=include_team,
        include_participants=include_participants,
        meeting_id=meeting_id,
    )
    if not recipients:
        return 0
    return email_service.send_email_bulk(
        db,
        recipients=recipients,
        subject=subject,
        body_html=body_html,
        kind=kind,
        board_id=board_id,
        meeting_id=meeting_id,
        owner_user_id=owner_id,
    )
