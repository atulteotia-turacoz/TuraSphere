"""
Board Meetings + Agenda + Participants.

Per Phase 1 spec, the global Meetings tab on /advisory-boards is served by
GET /meetings (across all boards), while board-scoped routes live under
/advisory-boards/{board_id}/meetings.

Authorization (Phase 1):
  - Platform super_admin / admin: full access
  - Meeting organizer + board creator: manage their meeting
  - Participant: view-only access to meetings they're invited to
"""
import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session, object_session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.advisory_board import AdvisoryBoard
from app.models.meeting import BoardMeeting, MeetingAgendaItem, MeetingStatus, MeetingFormat
from app.models.meeting_participant import MeetingParticipant, ParticipantRole, InviteStatus
from app.models.hcp import HCPProfile
from app.models.board_kol import BoardKol
from app.models.meeting_provider import MeetingProviderConfig
from app.services.mabm_access import user_has_mabm_capability, get_user_mabm_capabilities
from app.services import meeting_chat
from app.services import zoom_service
from app.services import teams_service
from app.services import meeting_access
from app.services import email_service
from app.services import account_config
from app.services import board_notify
from app.models.email_log import EmailKind
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["MABM - Meetings"])


def _delete_external_meeting(db: Session, provider_config_id, external_id) -> None:
    """Best-effort removal of a previously provisioned Zoom/Teams meeting so a
    re-created link doesn't leave an orphan on the provider account. Never raises:
    failures (already deleted, transient API error, missing config) are logged and
    swallowed so re-provisioning still succeeds."""
    if not external_id or not provider_config_id:
        return
    cfg = db.query(MeetingProviderConfig).filter(MeetingProviderConfig.id == provider_config_id).first()
    if not cfg:
        return
    provider = _enum_value(cfg.provider)
    try:
        if provider == "zoom":
            zoom_service.delete_meeting(cfg, external_id)
        elif provider == "teams":
            teams_service.delete_meeting(cfg, external_id)
    except Exception as e:  # noqa: BLE001 — cleanup must never block re-provisioning
        logger.warning("Could not delete old %s meeting %s: %s", provider, external_id, e)


# ── Schemas ──────────────────────────────────────────────

class MeetingCreate(BaseModel):
    title: str
    agenda_summary: Optional[str] = None
    scheduled_at: Optional[str] = None  # ISO datetime (local wall-clock, no offset)
    timezone: Optional[str] = "UTC"     # IANA tz of scheduled_at, e.g. "Asia/Kolkata"
    duration_minutes: Optional[int] = 60
    format: Optional[str] = "virtual"
    provider_id: Optional[int] = None
    join_url: Optional[str] = None
    # Phase 4: when true, auto-provision a Zoom meeting (requires active Zoom config).
    # Sets join_url + zoom_meeting_id on the created BoardMeeting.
    auto_provision_zoom: Optional[bool] = False


class MeetingUpdate(BaseModel):
    title: Optional[str] = None
    agenda_summary: Optional[str] = None
    scheduled_at: Optional[str] = None
    duration_minutes: Optional[int] = None
    format: Optional[str] = None
    status: Optional[str] = None
    provider_id: Optional[int] = None
    join_url: Optional[str] = None
    # IANA tz of scheduled_at. Not stored — only used to tell Zoom how to read
    # the new wall-clock time when a rescheduled meeting is synced there.
    timezone: Optional[str] = None


class AgendaItemSchema(BaseModel):
    sequence: int = 0
    title: str
    description: Optional[str] = None
    duration_minutes: Optional[int] = None
    presenter_user_id: Optional[int] = None


class ParticipantInvite(BaseModel):
    # Exactly one of user_id / hcp_id / board_kol_id. `hcp_id` invites a KOL
    # straight from the HCP directory — the advisory-board default.
    user_id: Optional[int] = None
    hcp_id: Optional[int] = None
    board_kol_id: Optional[int] = None
    role: str = "participant"   # host | moderator | panel_member | participant | observer
    can_speak: Optional[bool] = None
    # Granular per-meeting permissions. If omitted, defaults are derived from the role.
    permissions: Optional[List[str]] = None


class ParticipantBulkInvite(BaseModel):
    invitees: List[ParticipantInvite]


class ParticipantUpdate(BaseModel):
    role: Optional[str] = None
    can_speak: Optional[bool] = None
    invite_status: Optional[str] = None
    permissions: Optional[List[str]] = None
    # When changing role, set reset_permissions=true to re-apply the new role's
    # default permission set (otherwise existing custom permissions are kept).
    reset_permissions: Optional[bool] = None


# ── Helpers ──────────────────────────────────────────────

PANEL_SPEAKER_LIMIT = 10  # doc: "max 10 speakers"

VALID_PARTICIPANT_ROLES = {r.value for r in ParticipantRole}


def _new_join_token() -> str:
    """A unique opaque token backing a participant's personal join link."""
    return uuid.uuid4().hex


def _new_access_code() -> str:
    """Short, human-typeable access code ("password") emailed with the join link.
    Avoids ambiguous chars (0/O, 1/I)."""
    import secrets
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(6))


def _finalize_perms_and_speak(role: str, explicit_perms, can_speak_provided, can_speak_value):
    """
    Reconciles the granular permission set with the can_speak flag.

    Returns (permissions_list, can_speak_bool). The `speak` permission and the
    can_speak column are always kept in sync so the panel-speaker cap stays
    authoritative.
    """
    perms = set(meeting_access.resolve_permissions(role, explicit_perms))
    if can_speak_provided:
        can_speak = bool(can_speak_value)
    else:
        can_speak = meeting_access.SPEAKER_PERMISSION in perms
    if can_speak:
        perms.add(meeting_access.SPEAKER_PERMISSION)
    else:
        perms.discard(meeting_access.SPEAKER_PERMISSION)
    return meeting_access.normalize_permissions(perms), can_speak


def _is_platform_admin(user: User) -> bool:
    role = user.role.value if hasattr(user.role, "value") else user.role
    return role in ("super_admin", "admin")


def _enum_value(v):
    return v.value if hasattr(v, "value") else v


def _parse_iso_dt(val: Optional[str]) -> Optional[datetime]:
    if not val:
        return None
    try:
        return datetime.fromisoformat(val.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid ISO datetime: {val}")


def _get_meeting_or_404(meeting_id: int, db: Session) -> BoardMeeting:
    m = db.query(BoardMeeting).filter(BoardMeeting.id == meeting_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return m


def _find_time_conflict(
    db: Session, board_id: int, start: Optional[datetime],
    duration_minutes: Optional[int], exclude_id: Optional[int] = None,
) -> Optional[BoardMeeting]:
    """Return the first scheduled/live meeting on the board whose time window
    overlaps [start, start + duration). Returns None when the slot is free, or
    when `start` is unset (a date-TBD meeting can't conflict). Completed and
    cancelled meetings never block a new booking."""
    if not start:
        return None
    new_end = start + timedelta(minutes=duration_minutes or 60)
    q = db.query(BoardMeeting).filter(
        BoardMeeting.board_id == board_id,
        BoardMeeting.scheduled_at.isnot(None),
        BoardMeeting.status.in_([MeetingStatus.scheduled.value, MeetingStatus.live.value]),
    )
    if exclude_id is not None:
        q = q.filter(BoardMeeting.id != exclude_id)
    for m in q.all():
        m_end = m.scheduled_at + timedelta(minutes=m.duration_minutes or 60)
        # Half-open overlap: they clash unless one ends at/before the other starts.
        if start < m_end and m.scheduled_at < new_end:
            return m
    return None


def _conflict_detail(conflict: BoardMeeting) -> str:
    start = conflict.scheduled_at
    end = start + timedelta(minutes=conflict.duration_minutes or 60)
    when = f"{start:%d %b %Y, %H:%M}–{end:%H:%M}"
    return (
        f'A meeting "{conflict.title}" is already scheduled on this board for {when}. '
        f"Please pick a different time."
    )


def _board_meeting(db: Session, board_id: int) -> Optional[BoardMeeting]:
    """The board's single meeting (1 board = 1 meeting), or None.

    Legacy boards can still hold more than one row — this resolves to the same
    one the workspace has always shown, so participants/documents/surveys stay
    attached where they already are.
    """
    return db.query(BoardMeeting).filter(
        BoardMeeting.board_id == board_id
    ).order_by(BoardMeeting.scheduled_at.asc(), BoardMeeting.id.asc()).first()


def _get_board_or_404(board_id: int, db: Session) -> AdvisoryBoard:
    b = db.query(AdvisoryBoard).filter(AdvisoryBoard.id == board_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Advisory board not found")
    return b


# ── Board phase auto-advance ─────────────────────────────
# The first three phases (pre_meeting → meeting → post_meeting) follow meeting
# lifecycle automatically. ongoing_support and event_specific are deliberate
# manual states and are never auto-set or overwritten.

def _advance_board_to_meeting(db: Session, board_id: int) -> None:
    board = db.query(AdvisoryBoard).filter(AdvisoryBoard.id == board_id).first()
    if not board:
        return
    if _enum_value(board.current_phase) == "pre_meeting":
        board.current_phase = "meeting"


def _advance_board_to_post_meeting(db: Session, board_id: int, just_ended_id: int) -> None:
    board = db.query(AdvisoryBoard).filter(AdvisoryBoard.id == board_id).first()
    if not board:
        return
    if _enum_value(board.current_phase) not in ("pre_meeting", "meeting"):
        return
    still_active = db.query(BoardMeeting.id).filter(
        BoardMeeting.board_id == board_id,
        BoardMeeting.id != just_ended_id,
        BoardMeeting.status.in_(["scheduled", "live"]),
    ).first()
    if still_active:
        return
    board.current_phase = "post_meeting"


def _regress_board_to_meeting(db: Session, board_id: int) -> None:
    """Reopening a completed meeting puts the board back into an active state.
    Only pulls back from the auto-managed post_meeting phase; the manual
    ongoing_support / event_specific phases are never overwritten."""
    board = db.query(AdvisoryBoard).filter(AdvisoryBoard.id == board_id).first()
    if not board:
        return
    if _enum_value(board.current_phase) == "post_meeting":
        board.current_phase = "meeting"


# A user can VIEW a meeting if they hold any MABM capability that operates on it,
# since you can't act on a meeting without being able to read it.
_VIEW_GRANTING_CAPS = {"meetings.manage", "documents.manage", "transcripts.manage", "minutes.manage"}


def _user_can_view_meeting(user: User, meeting: BoardMeeting, db: Session) -> bool:
    if _is_platform_admin(user):
        return True
    if meeting.organizer_id == user.id:
        return True
    if meeting.board and meeting.board.created_by == user.id:
        return True
    is_participant = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting.id,
        MeetingParticipant.user_id == user.id,
    ).first() is not None
    if is_participant:
        return True
    # MABM-role-based access (e.g. medical_writer needs to view to edit transcripts)
    return bool(get_user_mabm_capabilities(user, db) & _VIEW_GRANTING_CAPS)


def _user_can_manage_meeting(user: User, meeting: BoardMeeting, db: Session) -> bool:
    if _is_platform_admin(user):
        return True
    if meeting.organizer_id == user.id:
        return True
    if meeting.board and meeting.board.created_by == user.id:
        return True
    if user_has_mabm_capability(user, db, "meetings.manage"):
        return True
    return False


def _check_view_meeting(meeting: BoardMeeting, user: User, db: Session):
    if not _user_can_view_meeting(user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")


def _check_manage_meeting(meeting: BoardMeeting, user: User, db: Session):
    if not _user_can_manage_meeting(user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")


def _agenda_item_to_dict(a: MeetingAgendaItem) -> dict:
    return {
        "id": a.id,
        "meeting_id": a.meeting_id,
        "sequence": a.sequence,
        "title": a.title,
        "description": a.description,
        "duration_minutes": a.duration_minutes,
        "presenter_user_id": a.presenter_user_id,
    }


def _participant_to_dict(p: MeetingParticipant) -> dict:
    # KOL/HCP records take precedence, then contact-book entries, then linked Users.
    display_name, display_email, display_org = _participant_identity(p)
    # Profile fields for the expert dashboard header — only an HCP-linked
    # participant has them, so they are null for teammates and ad-hoc contacts.
    hcp = p.hcp if p.hcp_id else None
    bk = p.board_kol if p.board_kol_id else None
    return {
        "id": p.id,
        "meeting_id": p.meeting_id,
        "user_id": p.user_id,
        "hcp_id": p.hcp_id,
        "board_kol_id": p.board_kol_id,
        "user_name": display_name,
        "user_email": display_email,
        "organization": display_org,
        "specialty": (hcp.specialty if hcp else None) or (bk.specialty if bk else None),
        "designation": hcp.designation if hcp else None,
        "affiliations": hcp.affiliations if hcp else None,
        "years_of_experience": hcp.years_of_experience if hcp else None,
        # Deep link to the KOL profile page the expert roster points at.
        "profile_path": f"/hcp/{p.hcp_id}" if p.hcp_id else None,
        "role": _enum_value(p.role),
        "invite_status": _enum_value(p.invite_status),
        "can_speak": p.can_speak,
        "permissions": meeting_access.parse_permissions(p.permissions),
        # Per-participant "separate login" token + relative join path. The frontend
        # builds the full URL as `${origin}/meeting/join/${join_token}`.
        "join_token": p.access_token,
        "join_path": f"/meeting/join/{p.access_token}" if p.access_token else None,
        # The code the join page asks for, so the organizer can pass it on by
        # hand when the invite email didn't arrive. Organizer-side list only.
        "access_code": p.access_code,
        "invited_at": p.invited_at.isoformat() if p.invited_at else None,
        "joined_at": p.joined_at.isoformat() if p.joined_at else None,
        "left_at": p.left_at.isoformat() if p.left_at else None,
    }


# ── Participant invite email ─────────────────────────────
# When a participant is added to a meeting they get one email containing their
# personal login link (the "separate login" join page on our own platform) plus
# the meeting details. Members always join THROUGH this page — we deliberately do
# not put the raw Zoom/Teams link in the email.

def _cohost_display_names(meeting: BoardMeeting) -> List[str]:
    """Display names of participants the host should promote to Zoom **co-host**.

    Co-host rather than host on purpose: a Zoom co-host can mute/unmute others and
    manage participants, but cannot start cloud recording — so moderators run the
    room while recording stays with the organizer alone (the reason we don't just
    hand them signature role 1, which *can* record).

    Zoom's SDK has no way to request co-host in the signature; it is granted
    in-meeting by the host, so this list is handed to the organizer's client which
    calls `client.makeCoHost(userId)` as each person joins. Matching is on display
    name because that is the only identifier the Web SDK exposes for guests — and
    it is the very name we pass as `userName` when they join, so it matches exactly.
    """
    names = []
    for p in meeting.participants:
        if _enum_value(p.role) not in (ParticipantRole.host.value, ParticipantRole.moderator.value):
            continue
        if p.user_id and p.user_id == meeting.organizer_id:
            continue    # the organizer is already the real Zoom host
        _email, name = _participant_contact(p)
        if name:
            names.append(name)
    return names


def _participant_identity(mp: MeetingParticipant):
    """(name, email, organization) for a meeting participant.

    One resolver for every display path, so the invite email, the roster, the
    chat sender name and the portal never disagree about who someone is.
    Precedence follows how specific the record is: an HCP/KOL row first (it
    carries the richest profile), then the contact book, then a platform user.
    `institution` stands in for `organization` on an HCP — it is the same idea
    under the directory's own name.
    """
    if mp.hcp_id and mp.hcp:
        return mp.hcp.full_name, mp.hcp.email, mp.hcp.institution
    if mp.board_kol_id and mp.board_kol:
        return mp.board_kol.name, mp.board_kol.email, mp.board_kol.affiliation
    if mp.user_id and mp.user:
        return mp.user.full_name, mp.user.email, mp.user.organization
    return None, None, None


def _participant_contact(mp: MeetingParticipant):
    """Returns (email, display_name) for a meeting participant."""
    name, email, _org = _participant_identity(mp)
    return email, name


def _participant_login_url(mp: MeetingParticipant) -> str:
    base = (settings.APP_PUBLIC_URL or "").rstrip("/")
    return f"{base}/meeting/join/{mp.access_token}"


def _build_invite_email(meeting: BoardMeeting, mp: MeetingParticipant, name) -> str:
    board_title = meeting.board.title if meeting.board else "Advisory Board"
    login_url = _participant_login_url(mp)
    role = _enum_value(mp.role)
    if meeting.scheduled_at:
        end = meeting.scheduled_at + timedelta(minutes=meeting.duration_minutes or 60)
        when = f"{meeting.scheduled_at:%d %b %Y, %H:%M}–{end:%H:%M}"
    else:
        when = "To be confirmed"
    greeting = f"Hi {name}," if name else "Hello,"
    access_code_block = (
        f'<p style="margin:10px 0">Your access code: '
        f'<strong style="font-size:18px;letter-spacing:2px;background:#f1f5f9;padding:4px 10px;border-radius:6px">{mp.access_code}</strong>'
        f'<br><span style="font-size:12px;color:#6b7280">Enter this code on your meeting page to join.</span></p>'
        if mp.access_code else ''
    )
    return f"""\
<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.6">
  <p>{greeting}</p>
  <p>You have been added as <strong>{role}</strong> to a meeting on the advisory board
     <strong>{board_title}</strong>.</p>
  <table style="border-collapse:collapse;margin:14px 0">
    <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Meeting</td><td style="padding:2px 0"><strong>{meeting.title}</strong></td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Board</td><td style="padding:2px 0">{board_title}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#6b7280">When</td><td style="padding:2px 0">{when}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Duration</td><td style="padding:2px 0">{meeting.duration_minutes or 60} minutes</td></tr>
  </table>
  <p>Join the meeting using your personal, secure login link below. Please do not share it —
     it is unique to you.</p>
  <p style="margin:18px 0">
    <a href="{login_url}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">Open my meeting page</a>
  </p>
  {access_code_block}
  <p style="font-size:12px;color:#6b7280">If the button doesn't work, copy this link into your browser:<br>
     <a href="{login_url}">{login_url}</a></p>
</div>"""


def _send_participant_invite_email(db: Session, meeting: BoardMeeting, mp: MeetingParticipant) -> bool:
    """Sends the personal join-link email and, on success, marks the participant
    as 'sent'. Returns True only if the email actually went out."""
    email, name = _participant_contact(mp)
    if not email or not mp.access_token:
        return False
    if not mp.access_code:
        mp.access_code = _new_access_code()
        db.commit()
    body_html = _build_invite_email(meeting, mp, name)
    log = email_service.send_email(
        db,
        to=email,
        subject=f"You're invited: {meeting.title}",
        body_html=body_html,
        kind=EmailKind.kol_invite.value,
        meeting_id=meeting.id,
        board_id=meeting.board_id,
        owner_user_id=account_config.owner_of_meeting(meeting),
    )
    if log.success:
        mp.invite_status = InviteStatus.sent.value
        db.commit()
        return True
    return False


def _video_provider(m: BoardMeeting, db: Optional[Session] = None) -> Optional[str]:
    """Which in-app video stack this meeting should open — 'zoom' | 'livekit' | None.

    Order:
      1. the meeting's own provider row, if it names LiveKit;
      2. the ACCOUNT's chosen default (Account → Meeting Platforms) — an explicit
         user choice, so it beats a stale Zoom session left on the record. Without
         this, picking LiveKit appeared to do nothing on any meeting that had ever
         been provisioned through Zoom;
      3. an actual Zoom session;
      4. LiveKit whenever the platform runs one — so a meeting with no Zoom
         session (because the account has no paid Zoom) is not a dead end.

    The session is taken from the instance via `object_session` when not passed,
    so the serializers that call this don't all need a `db` parameter threaded
    through them.
    """
    if m.provider and _enum_value(m.provider.provider) == "livekit":
        return "livekit"

    livekit_ready = bool(settings.LIVEKIT_URL and settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_SECRET)

    db = db or object_session(m)
    if db is not None:
        owner = account_config.owner_of_meeting(m)
        if owner is not None:
            active = db.query(MeetingProviderConfig).filter(
                MeetingProviderConfig.owner_user_id == owner,
                MeetingProviderConfig.is_active == True,   # noqa: E712
            ).first()
            if active:
                chosen = _enum_value(active.provider)
                if chosen == "livekit" and (livekit_ready or active.client_id):
                    return "livekit"
                if chosen == "zoom" and m.zoom_meeting_id:
                    return "zoom"

    if m.zoom_meeting_id:
        return "zoom"
    if livekit_ready:
        return "livekit"
    return None


def _meeting_to_dict(m: BoardMeeting, include_detail: bool = False) -> dict:
    d = {
        "id": m.id,
        "board_id": m.board_id,
        "board_title": m.board.title if m.board else None,
        "title": m.title,
        "agenda_summary": m.agenda_summary,
        "scheduled_at": m.scheduled_at.isoformat() if m.scheduled_at else None,
        "duration_minutes": m.duration_minutes,
        "format": _enum_value(m.format),
        "status": _enum_value(m.status),
        "provider_id": m.provider_id,
        "video_provider": _video_provider(m),
        "join_url": m.join_url,
        "zoom_meeting_id": m.zoom_meeting_id,
        "organizer_id": m.organizer_id,
        "organizer_name": m.organizer.full_name if m.organizer else None,
        "created_at": m.created_at.isoformat(),
        "updated_at": m.updated_at.isoformat(),
        "participant_count": len(m.participants),
    }
    if include_detail:
        d["agenda_items"] = [_agenda_item_to_dict(a) for a in m.agenda_items]
        d["participants"] = [_participant_to_dict(p) for p in m.participants]
    return d


def _backfill_participant_provisioning(db: Session, participants) -> bool:
    """
    Lazily provisions legacy participant rows (created before per-participant
    tokens/permissions existed) with a join token + role-default permissions.
    Returns True if anything changed (caller commits).
    """
    changed = False
    for p in participants:
        if not p.access_token:
            p.access_token = _new_join_token()
            p.token_issued_at = datetime.utcnow()
            changed = True
        if not p.permissions:
            role = _enum_value(p.role)
            perms = set(meeting_access.default_permissions_for_role(role))
            if p.can_speak:
                perms.add(meeting_access.SPEAKER_PERMISSION)
            else:
                perms.discard(meeting_access.SPEAKER_PERMISSION)
            p.permissions = meeting_access.serialize_permissions(perms)
            changed = True
    return changed


def _count_panel_speakers(db: Session, meeting_id: int, exclude_id: Optional[int] = None) -> int:
    q = db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting_id,
        MeetingParticipant.can_speak.is_(True),
    )
    if exclude_id:
        q = q.filter(MeetingParticipant.id != exclude_id)
    return q.count()


# ── Board-scoped meeting routes ──────────────────────────

@router.get("/advisory-boards/{board_id}/meetings")
def list_board_meetings(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    has_global_view = (
        _is_platform_admin(current_user)
        or board.created_by == current_user.id
        or bool(get_user_mabm_capabilities(current_user, db) & _VIEW_GRANTING_CAPS)
    )
    if has_global_view:
        meetings = db.query(BoardMeeting).filter(
            BoardMeeting.board_id == board_id
        ).order_by(BoardMeeting.scheduled_at.desc()).all()
    else:
        # Restrict to meetings the user is a participant in
        meetings = db.query(BoardMeeting).join(
            MeetingParticipant, MeetingParticipant.meeting_id == BoardMeeting.id
        ).filter(
            BoardMeeting.board_id == board_id,
            MeetingParticipant.user_id == current_user.id,
        ).order_by(BoardMeeting.scheduled_at.desc()).all()
    return [_meeting_to_dict(m) for m in meetings]


@router.post("/advisory-boards/{board_id}/meetings", status_code=201)
def create_meeting(
    board_id: int,
    data: MeetingCreate,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create the board's meeting — or configure the existing one.

    1 board = 1 meeting. The workspace auto-creates a bare meeting the first time
    it is opened (see `get_primary_meeting`), so by the time the organizer fills in
    the scheduling form the board usually *already* has a row. Inserting a second
    one split the board in two: the workspace, participants, documents and surveys
    all resolve to the first meeting, while the Zoom link landed on the second —
    so every participant join link pointed at a meeting with no Zoom session.
    Scheduling now updates the board's existing meeting in place instead.
    """
    board = _get_board_or_404(board_id, db)
    can_create = (
        _is_platform_admin(current_user)
        or board.created_by == current_user.id
        or user_has_mabm_capability(current_user, db, "meetings.manage")
    )
    if not can_create:
        raise HTTPException(status_code=403, detail="Access denied")

    existing = _board_meeting(db, board.id)

    # Reject overlapping bookings up front (before any Zoom/Teams call) so the
    # organizer is told to pick another slot instead of silently double-booking.
    # The board's own meeting is excluded — it is the one being (re)scheduled, and
    # a board can only ever hold one, so this now only fires on legacy boards.
    new_start = _parse_iso_dt(data.scheduled_at)
    conflict = _find_time_conflict(
        db, board.id, new_start, data.duration_minutes,
        exclude_id=existing.id if existing else None,
    )
    if conflict:
        raise HTTPException(status_code=409, detail=_conflict_detail(conflict))

    join_url = data.join_url
    zoom_meeting_id = None
    zoom_password = None
    provider_id = data.provider_id

    # Account-only Zoom (no platform fallback): if the owner hasn't set up their
    # own Zoom, we skip link creation but still create the meeting record — the
    # organizer can add a link later from Account → Meeting Platforms.
    zoom_cfg = (
        account_config.resolve_provider(db, board.created_by, provider="zoom", allow_global=False)
        if data.auto_provision_zoom else None
    )
    if data.auto_provision_zoom and zoom_cfg:
        try:
            # scheduled_at is the user's local wall-clock (no offset). Send it as-is
            # and tell Zoom the timezone, so it doesn't mis-read it as UTC.
            zoom_resp = zoom_service.create_meeting(
                zoom_cfg,
                topic=data.title,
                start_time_iso=(new_start.replace(microsecond=0).isoformat() if new_start else None),
                duration_minutes=data.duration_minutes or 60,
                agenda=data.agenda_summary,
                timezone=data.timezone or "UTC",
            )
            zoom_meeting_id = str(zoom_resp.get("id"))
            join_url = zoom_resp.get("join_url") or join_url
            zoom_password = zoom_resp.get("password")
            provider_id = zoom_cfg.id
        except zoom_service.ZoomAPIError as e:
            raise HTTPException(status_code=502, detail=f"Zoom API error: {e}")
        except zoom_service.ZoomConfigError as e:
            raise HTTPException(status_code=400, detail=str(e))

    if existing:
        # Configure the board's meeting in place. Anything already attached to it
        # (participants and their join tokens, documents, surveys, polls) is
        # untouched — that is the whole point of not inserting a second row.
        old_external_id, old_provider_id = existing.zoom_meeting_id, existing.provider_id

        existing.title = data.title
        existing.scheduled_at = new_start
        existing.duration_minutes = data.duration_minutes or 60
        existing.format = data.format or MeetingFormat.virtual.value
        if data.agenda_summary is not None:
            existing.agenda_summary = data.agenda_summary
        # Only overwrite the link when this request actually produced one, so
        # re-scheduling without touching Zoom doesn't wipe an existing link.
        if zoom_meeting_id:
            existing.provider_id = provider_id
            existing.join_url = join_url
            existing.zoom_meeting_id = zoom_meeting_id
            existing.zoom_password = zoom_password
        elif join_url:
            existing.join_url = join_url
            if provider_id:
                existing.provider_id = provider_id
        # A board whose meeting already ran is being re-scheduled — put it back in
        # play, mirroring provision_meeting_link.
        if _enum_value(existing.status) in (MeetingStatus.completed.value, MeetingStatus.cancelled.value):
            existing.status = MeetingStatus.scheduled.value
            _regress_board_to_meeting(db, existing.board_id)

        # Replacing the Zoom link should not orphan the previous Zoom meeting.
        if old_external_id and zoom_meeting_id and old_external_id != zoom_meeting_id:
            _delete_external_meeting(db, old_provider_id, old_external_id)

        db.commit()
        db.refresh(existing)
        response.status_code = 200   # updated, not created
        return _meeting_to_dict(existing, include_detail=True)

    meeting = BoardMeeting(
        board_id=board.id,
        title=data.title,
        agenda_summary=data.agenda_summary,
        scheduled_at=new_start,
        duration_minutes=data.duration_minutes or 60,
        format=data.format or MeetingFormat.virtual.value,
        status=MeetingStatus.scheduled.value,
        provider_id=provider_id,
        join_url=join_url,
        zoom_meeting_id=zoom_meeting_id,
        zoom_password=zoom_password,
        organizer_id=current_user.id,
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return _meeting_to_dict(meeting, include_detail=True)


@router.get("/advisory-boards/{board_id}/primary-meeting")
def get_primary_meeting(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The board's single meeting (1 board = 1 meeting). Auto-creates it if none
    exists yet, so the board workspace always has a meeting to attach content to.
    The meeting itself only carries the Zoom/Teams + schedule details."""
    board = _get_board_or_404(board_id, db)
    meeting = _board_meeting(db, board_id)

    if not meeting:
        can_create = (
            _is_platform_admin(current_user)
            or board.created_by == current_user.id
            or user_has_mabm_capability(current_user, db, "meetings.manage")
        )
        if not can_create:
            raise HTTPException(status_code=403, detail="Access denied")
        meeting = BoardMeeting(
            board_id=board.id,
            title=board.title or "Advisory Board Meeting",
            scheduled_at=board.scheduled_date,
            format=_enum_value(board.format) if board.format else MeetingFormat.virtual.value,
            status=MeetingStatus.scheduled.value,
            organizer_id=current_user.id,
        )
        db.add(meeting)
        db.commit()
        db.refresh(meeting)
    elif not _user_can_view_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")

    return _meeting_to_dict(meeting, include_detail=True)


class ProvisionRequest(BaseModel):
    provider: str   # zoom | teams
    timezone: Optional[str] = "UTC"   # IANA tz of the meeting's scheduled time


@router.post("/meetings/{meeting_id}/provision")
def provision_meeting_link(
    meeting_id: int,
    data: ProvisionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create the actual meeting on the chosen platform (Zoom or Teams) using the
    super-admin-configured credentials, and store its join URL on the meeting."""
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_manage_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")

    provider = (data.provider or "").strip().lower()
    if provider not in ("zoom", "teams"):
        raise HTTPException(status_code=400, detail="provider must be 'zoom' or 'teams'")

    # Account-only (no platform fallback): the board owner must have their OWN
    # provider config to create a meeting link.
    cfg = account_config.resolve_provider(
        db, account_config.owner_of_meeting(meeting), provider=provider, allow_global=False,
    )
    if not cfg or not cfg.client_id:
        raise HTTPException(
            status_code=400,
            detail=f"Your account has no {provider.title()} configuration. "
                   f"Set it up in Account → Meeting Platforms first.",
        )

    # Remember the currently-linked external meeting so we can delete it once the
    # replacement is successfully created (re-creating a link should not orphan
    # the previous Zoom/Teams meeting on the provider account).
    old_external_id = meeting.zoom_meeting_id
    old_provider_id = meeting.provider_id

    tz = data.timezone or "UTC"
    try:
        if provider == "zoom":
            # Send the stored wall-clock time WITHOUT a 'Z'/offset and let the
            # timezone field tell Zoom how to read it — otherwise Zoom assumes UTC.
            start_iso = meeting.scheduled_at.replace(microsecond=0).isoformat() if meeting.scheduled_at else None
            resp = zoom_service.create_meeting(
                cfg, topic=meeting.title, start_time_iso=start_iso,
                duration_minutes=meeting.duration_minutes or 60, agenda=meeting.agenda_summary,
                timezone=tz,
            )
            meeting.join_url = resp.get("join_url")
            meeting.zoom_meeting_id = str(resp.get("id")) if resp.get("id") is not None else None
            meeting.zoom_password = resp.get("password")
        else:  # teams
            start_iso = meeting.scheduled_at.isoformat() if meeting.scheduled_at else None
            resp = teams_service.create_meeting(
                cfg, topic=meeting.title, start_time_iso=start_iso,
                duration_minutes=meeting.duration_minutes or 60,
            )
            meeting.join_url = resp.get("joinWebUrl") or resp.get("joinUrl")
            meeting.zoom_meeting_id = str(resp.get("id")) if resp.get("id") else None
    except (zoom_service.ZoomConfigError, teams_service.TeamsConfigError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (zoom_service.ZoomAPIError, teams_service.TeamsAPIError) as e:
        raise HTTPException(status_code=502, detail=str(e))

    meeting.provider_id = cfg.id

    # New link is in place — clean up the old provider meeting (best-effort).
    # Skip if the provider somehow returned the same id we already had.
    if old_external_id and old_external_id != meeting.zoom_meeting_id:
        _delete_external_meeting(db, old_provider_id, old_external_id)

    # Re-creating the meeting link implies the session is going to be (re)held,
    # so a finished/cancelled meeting is brought back to scheduled — otherwise a
    # fresh link would sit on a "completed" meeting with no way to start it.
    if _enum_value(meeting.status) in (MeetingStatus.completed.value, MeetingStatus.cancelled.value):
        meeting.status = MeetingStatus.scheduled.value
        _regress_board_to_meeting(db, meeting.board_id)

    db.commit()
    db.refresh(meeting)
    return _meeting_to_dict(meeting, include_detail=True)


@router.post("/meetings/{meeting_id}/sdk-signature")
def get_meeting_sdk_signature(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns everything the in-app Zoom Meeting SDK embed needs to join this
    meeting: a signed JWT signature, the SDK key, meeting number, passcode, the
    display name, and (for hosts) a ZAK token. Requires a Zoom *Meeting SDK* app
    configured in Account → Meeting Platforms (extra_config.sdk_key/sdk_secret)."""
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_view_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")

    if not meeting.zoom_meeting_id:
        raise HTTPException(
            status_code=400,
            detail="This meeting has no Zoom session yet. Create the meeting link first.",
        )

    cfg = account_config.resolve_provider(
        db, account_config.owner_of_meeting(meeting), provider="zoom", allow_global=False,
    )
    if not cfg:
        raise HTTPException(status_code=400, detail="No Zoom configuration found for this account.")

    sdk_key, sdk_secret = zoom_service.get_sdk_credentials(cfg)
    if not sdk_key or not sdk_secret:
        raise HTTPException(
            status_code=400,
            detail="In-app join isn't set up yet. Add your Zoom Meeting SDK Key & Secret in "
                   "Account → Meeting Platforms (this is a separate Zoom 'Meeting SDK' app).",
        )

    # Zoom host (role 1) is what exposes Record and the participant mute/unmute
    # controls in Zoom's toolbar, so it is restricted to the account that
    # scheduled the meeting — plus the platform operator. Deliberately narrower
    # than `_user_can_manage_meeting`: a colleague who can otherwise administer
    # the meeting still joins as an attendee and cannot record it.
    is_host = _is_platform_admin(current_user) or meeting.organizer_id == current_user.id
    role = 1 if is_host else 0
    signature = zoom_service.build_sdk_signature(sdk_key, sdk_secret, meeting.zoom_meeting_id, role)
    zak = zoom_service.get_zak_token(cfg) if is_host else None

    # Role 1 alone does NOT make you the Zoom host — the ZAK does. `get_zak_token`
    # returns None on any failure, so without this the organizer joins looking
    # like a host, silently gets no Record / mute-others controls, and has no idea
    # why. The usual cause is the Zoom OAuth app missing the `user:read:token`
    # scope; the call fails with Zoom code 4711.
    host_warning = None
    if is_host and not zak:
        host_warning = (
            "Joining without host controls: Zoom did not return a host token (ZAK). "
            "Add the 'user:read:token' scope to your Zoom Server-to-Server OAuth app "
            "in Account → Meeting Platforms, then rejoin."
        )

    return {
        "signature": signature,
        "sdk_key": sdk_key,
        "meeting_number": meeting.zoom_meeting_id,
        "password": meeting.zoom_password or "",
        "user_name": current_user.full_name or current_user.email,
        "user_email": current_user.email,
        "role": role,
        "zak": zak,
        "join_url": meeting.join_url,
        # Only the host acts on this, and only the host should see the roster.
        "cohost_names": _cohost_display_names(meeting) if is_host else [],
        "host_warning": host_warning,
    }


# ── Global meeting routes ────────────────────────────────

@router.get("/meetings")
def list_all_meetings(
    status: Optional[str] = None,
    upcoming: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(BoardMeeting)

    has_global_view = (
        _is_platform_admin(current_user)
        or bool(get_user_mabm_capabilities(current_user, db) & _VIEW_GRANTING_CAPS)
    )
    if not has_global_view:
        # Visible if user organized it, owns the board, or is a participant
        owned_board_ids = [
            b.id for b in db.query(AdvisoryBoard.id).filter(
                AdvisoryBoard.created_by == current_user.id
            ).all()
        ]
        participant_meeting_ids = [
            mp.meeting_id for mp in db.query(MeetingParticipant.meeting_id).filter(
                MeetingParticipant.user_id == current_user.id
            ).all()
        ]
        q = q.filter(
            (BoardMeeting.organizer_id == current_user.id)
            | (BoardMeeting.board_id.in_(owned_board_ids) if owned_board_ids else False)
            | (BoardMeeting.id.in_(participant_meeting_ids) if participant_meeting_ids else False)
        )

    if status:
        q = q.filter(BoardMeeting.status == status)
    if upcoming:
        q = q.filter(BoardMeeting.scheduled_at >= datetime.utcnow())

    meetings = q.order_by(BoardMeeting.scheduled_at.desc()).all()
    return [_meeting_to_dict(m) for m in meetings]


@router.get("/meetings/{meeting_id}")
def get_meeting(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_view_meeting(meeting, current_user, db)
    return _meeting_to_dict(meeting, include_detail=True)


# ── In-meeting chat (authenticated side) ─────────────────────────────────────
# The participant/join-token side of the same chat lives in meeting_join.py; both
# go through app.services.meeting_chat so the rules stay in one place.

class ChatSendReq(BaseModel):
    body: str


class ChatSettingsReq(BaseModel):
    enabled: bool


@router.get("/meetings/{meeting_id}/chat")
def list_meeting_chat(
    meeting_id: int,
    after_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Chat transcript for the meeting room panel. `after_id` returns only newer
    messages, which is what the panel polls with."""
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_view_meeting(meeting, current_user, db)
    return {
        "chat_enabled": meeting_chat.chat_is_open(meeting),
        "can_send": meeting_chat.chat_is_open(meeting),
        "can_manage": _user_can_manage_meeting(current_user, meeting, db),
        "messages": meeting_chat.list_messages(db, meeting_id, after_id=after_id),
    }


@router.post("/meetings/{meeting_id}/chat", status_code=201)
def send_meeting_chat(
    meeting_id: int,
    data: ChatSendReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_view_meeting(meeting, current_user, db)

    # The organizer's switch applies to everyone; a host who turned chat off can
    # turn it back on rather than being able to talk through it.
    if not meeting_chat.chat_is_open(meeting):
        raise HTTPException(status_code=403, detail="Chat is turned off for this meeting.")

    body = meeting_chat.clean_body(data.body)
    if not body:
        raise HTTPException(status_code=400, detail="Message is empty.")

    is_host = _user_can_manage_meeting(current_user, meeting, db)
    msg = meeting_chat.post_message(
        db, meeting_id, body,
        sender_name=current_user.full_name or current_user.email,
        sender_role="Host" if is_host else "Team",
        user_id=current_user.id,
    )
    return meeting_chat.message_to_dict(msg)


@router.patch("/meetings/{meeting_id}/chat/settings")
def set_meeting_chat_enabled(
    meeting_id: int,
    data: ChatSettingsReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Organizer's chat on/off switch. Turning it off blocks new messages from
    everyone; the existing transcript stays readable."""
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_manage_meeting(meeting, current_user, db)
    meeting.chat_enabled = bool(data.enabled)
    db.commit()
    return {"chat_enabled": meeting.chat_enabled}


@router.patch("/meetings/{meeting_id}")
def update_meeting(
    meeting_id: int,
    data: MeetingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_manage_meeting(meeting, current_user, db)

    payload = data.dict(exclude_unset=True)
    tz = payload.pop("timezone", None) or "UTC"
    for field, value in payload.items():
        if field == "scheduled_at":
            meeting.scheduled_at = _parse_iso_dt(value)
        else:
            setattr(meeting, field, value)

    # Rescheduling must respect the same no-overlap rule as creation. Only enforced
    # while the meeting stays bookable (scheduled/live); excludes itself.
    if ("scheduled_at" in payload or "duration_minutes" in payload) and \
            _enum_value(meeting.status) in (MeetingStatus.scheduled.value, MeetingStatus.live.value):
        conflict = _find_time_conflict(
            db, meeting.board_id, meeting.scheduled_at, meeting.duration_minutes, exclude_id=meeting.id,
        )
        if conflict:
            raise HTTPException(status_code=409, detail=_conflict_detail(conflict))

    # A Zoom-linked meeting is edited in Zoom too, BEFORE committing here: if Zoom
    # rejects the change nothing is saved, so the two never disagree on the time.
    zoom_synced = None
    if meeting.zoom_meeting_id and meeting.provider_id and \
            {"title", "agenda_summary", "scheduled_at", "duration_minutes"} & payload.keys():
        cfg = db.query(MeetingProviderConfig).filter(MeetingProviderConfig.id == meeting.provider_id).first()
        if cfg and _enum_value(cfg.provider) == "zoom":
            try:
                zoom_synced = zoom_service.update_meeting(
                    cfg, meeting.zoom_meeting_id,
                    topic=meeting.title if "title" in payload else None,
                    start_time_iso=(meeting.scheduled_at.replace(microsecond=0).isoformat()
                                    if "scheduled_at" in payload and meeting.scheduled_at else None),
                    duration_minutes=meeting.duration_minutes if "duration_minutes" in payload else None,
                    agenda=(meeting.agenda_summary or "") if "agenda_summary" in payload else None,
                    timezone=tz,
                )
            except zoom_service.ZoomConfigError as e:
                db.rollback()
                raise HTTPException(status_code=400, detail=f"Could not update the Zoom meeting: {e}")
            except zoom_service.ZoomAPIError as e:
                db.rollback()
                raise HTTPException(status_code=502, detail=f"Could not update the Zoom meeting, so nothing was saved: {e}")

    new_status = payload.get("status")
    if new_status == MeetingStatus.live.value:
        _advance_board_to_meeting(db, meeting.board_id)
    elif new_status == MeetingStatus.completed.value:
        _advance_board_to_post_meeting(db, meeting.board_id, meeting.id)

    db.commit()
    db.refresh(meeting)
    out = _meeting_to_dict(meeting, include_detail=True)
    # False = the Zoom meeting no longer exists (deleted/expired in Zoom), so only
    # TuraQuant changed; the UI tells the organizer to re-create the link.
    out["zoom_synced"] = zoom_synced
    return out


@router.delete("/meetings/{meeting_id}")
def delete_meeting(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_manage_meeting(meeting, current_user, db)
    # Tear down the provider (Zoom/Teams) meeting first so deleting the record
    # doesn't leave an orphan on the provider account. Best-effort — never blocks.
    _delete_external_meeting(db, meeting.provider_id, meeting.zoom_meeting_id)
    db.delete(meeting)
    db.commit()
    return {"detail": "Meeting deleted"}


@router.post("/meetings/{meeting_id}/start")
def start_meeting(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """scheduled → live. Idempotent if already live. A completed/cancelled
    meeting must be reopened first (use /reopen) before it can start again."""
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_manage_meeting(meeting, current_user, db)

    current = _enum_value(meeting.status)
    if current == MeetingStatus.live.value:
        # Already running — treat as a no-op so a double click never errors.
        return {"id": meeting.id, "status": current, "join_url": meeting.join_url}
    if current in (MeetingStatus.completed.value, MeetingStatus.cancelled.value):
        raise HTTPException(
            status_code=409,
            detail=f"Meeting is {current}. Reopen it before starting again.",
        )

    meeting.status = MeetingStatus.live.value
    _advance_board_to_meeting(db, meeting.board_id)
    db.commit()
    db.refresh(meeting)
    try:
        board_notify.notify_board(
            db, meeting.board_id,
            subject=f"Meeting started: {meeting.title}",
            body_html=board_notify.build_body(
                f"{meeting.title} is now live",
                ["The meeting has started — you can join now from your meeting page."],
            ),
            meeting_id=meeting.id,
        )
    except Exception:
        pass
    return {
        "id": meeting.id,
        "status": _enum_value(meeting.status),
        "join_url": meeting.join_url,
    }


@router.post("/meetings/{meeting_id}/end")
def end_meeting(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """live → completed. Idempotent if already completed. A meeting that never
    started (still scheduled) or was cancelled cannot be ended."""
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_manage_meeting(meeting, current_user, db)

    current = _enum_value(meeting.status)
    if current == MeetingStatus.completed.value:
        return {"id": meeting.id, "status": current}
    if current != MeetingStatus.live.value:
        raise HTTPException(
            status_code=409,
            detail=f"Meeting is {current}; only a live meeting can be ended.",
        )

    meeting.status = MeetingStatus.completed.value
    _advance_board_to_post_meeting(db, meeting.board_id, meeting.id)
    db.commit()
    db.refresh(meeting)
    try:
        board_notify.notify_board(
            db, meeting.board_id,
            subject=f"Meeting ended: {meeting.title}",
            body_html=board_notify.build_body(
                f"{meeting.title} has ended",
                ["The meeting has finished. Minutes, recording and transcript will follow in the workspace."],
            ),
            meeting_id=meeting.id,
        )
    except Exception:
        pass
    return {"id": meeting.id, "status": _enum_value(meeting.status)}


@router.post("/meetings/{meeting_id}/reopen")
def reopen_meeting(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """completed / cancelled → scheduled. Lets an organizer run a meeting again
    after it has ended (e.g. it was ended early, or the session is being re-held
    on a freshly generated link). Idempotent if already scheduled."""
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_manage_meeting(meeting, current_user, db)

    current = _enum_value(meeting.status)
    if current == MeetingStatus.scheduled.value:
        return {"id": meeting.id, "status": current}
    if current == MeetingStatus.live.value:
        raise HTTPException(
            status_code=409,
            detail="Meeting is live; end it before reopening.",
        )

    meeting.status = MeetingStatus.scheduled.value
    _regress_board_to_meeting(db, meeting.board_id)
    db.commit()
    db.refresh(meeting)
    return {"id": meeting.id, "status": _enum_value(meeting.status)}


# ── Agenda items ─────────────────────────────────────────

@router.get("/meetings/{meeting_id}/agenda-items")
def list_agenda_items(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_view_meeting(meeting, current_user, db)
    return [_agenda_item_to_dict(a) for a in meeting.agenda_items]


@router.post("/meetings/{meeting_id}/agenda-items", status_code=201)
def add_agenda_item(
    meeting_id: int,
    data: AgendaItemSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_manage_meeting(meeting, current_user, db)
    item = MeetingAgendaItem(
        meeting_id=meeting.id,
        sequence=data.sequence,
        title=data.title,
        description=data.description,
        duration_minutes=data.duration_minutes,
        presenter_user_id=data.presenter_user_id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _agenda_item_to_dict(item)


@router.patch("/meetings/{meeting_id}/agenda-items/{item_id}")
def update_agenda_item(
    meeting_id: int,
    item_id: int,
    data: AgendaItemSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_manage_meeting(meeting, current_user, db)
    item = db.query(MeetingAgendaItem).filter(
        MeetingAgendaItem.id == item_id,
        MeetingAgendaItem.meeting_id == meeting_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Agenda item not found")

    item.sequence = data.sequence
    item.title = data.title
    item.description = data.description
    item.duration_minutes = data.duration_minutes
    item.presenter_user_id = data.presenter_user_id
    db.commit()
    db.refresh(item)
    return _agenda_item_to_dict(item)


@router.delete("/meetings/{meeting_id}/agenda-items/{item_id}")
def delete_agenda_item(
    meeting_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_manage_meeting(meeting, current_user, db)
    item = db.query(MeetingAgendaItem).filter(
        MeetingAgendaItem.id == item_id,
        MeetingAgendaItem.meeting_id == meeting_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Agenda item not found")
    db.delete(item)
    db.commit()
    return {"detail": "Agenda item deleted"}


# ── Participants ─────────────────────────────────────────

@router.get("/meetings/{meeting_id}/participants")
def list_participants(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_view_meeting(meeting, current_user, db)
    if _backfill_participant_provisioning(db, meeting.participants):
        db.commit()
    return [_participant_to_dict(p) for p in meeting.participants]


@router.post("/meetings/{meeting_id}/participants", status_code=201)
def invite_participants(
    meeting_id: int,
    data: ParticipantBulkInvite,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bulk-invite users to a meeting. Skips users already invited."""
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_manage_meeting(meeting, current_user, db)

    if not data.invitees:
        return []

    # Validate roles + each invitee references exactly one of user_id / hcp_id / board_kol_id
    for inv in data.invitees:
        if inv.role not in VALID_PARTICIPANT_ROLES:
            raise HTTPException(status_code=400, detail=f"Invalid role: {inv.role}")
        if sum(1 for v in (inv.user_id, inv.hcp_id, inv.board_kol_id) if v) != 1:
            raise HTTPException(
                status_code=400,
                detail="Each invitee must reference exactly one of user_id, hcp_id or board_kol_id",
            )

    # Resolve effective permissions + can_speak per invitee, then enforce the
    # panel-speaker cap (counts everyone who ends up with the `speak` permission).
    resolved = [
        _finalize_perms_and_speak(inv.role, inv.permissions, inv.can_speak is not None, inv.can_speak)
        for inv in data.invitees
    ]
    new_speakers = sum(1 for _, can_speak in resolved if can_speak)
    current_speakers = _count_panel_speakers(db, meeting.id)
    if current_speakers + new_speakers > PANEL_SPEAKER_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot exceed panel speaker limit of {PANEL_SPEAKER_LIMIT} "
                   f"(currently {current_speakers}, requested +{new_speakers})",
        )

    # Validate hcp_id ownership — an HCP row belongs to the account that created
    # it (hcp_profiles.user_id), so this stops one account inviting another's KOLs.
    hcp_ids = [inv.hcp_id for inv in data.invitees if inv.hcp_id]
    if hcp_ids:
        valid_hcp = {
            row[0] for row in db.query(HCPProfile.id).filter(
                HCPProfile.id.in_(hcp_ids),
                HCPProfile.user_id == current_user.id,
            ).all()
        }
        missing_hcp = set(hcp_ids) - valid_hcp
        if missing_hcp:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid or inaccessible hcp_id(s): {sorted(missing_hcp)}",
            )

    # Validate board_kol_id ownership — the advisory-board module's own KOL list
    # is per account, like the contact book.
    bk_ids = [inv.board_kol_id for inv in data.invitees if inv.board_kol_id]
    if bk_ids:
        valid_bk = {
            row[0] for row in db.query(BoardKol.id).filter(
                BoardKol.id.in_(bk_ids),
                BoardKol.owner_user_id == current_user.id,
                BoardKol.is_active.is_(True),
            ).all()
        }
        missing_bk = set(bk_ids) - valid_bk
        if missing_bk:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid or inactive board_kol_id(s): {sorted(missing_bk)}",
            )

    # Find users / participants already invited so we can skip them silently
    user_ids = [inv.user_id for inv in data.invitees if inv.user_id]
    existing_user_ids: set[int] = set()
    if user_ids:
        existing_user_ids = {
            row[0] for row in db.query(MeetingParticipant.user_id).filter(
                MeetingParticipant.meeting_id == meeting.id,
                MeetingParticipant.user_id.in_(user_ids),
            ).all()
        }
    existing_hcp_ids: set[int] = set()
    if hcp_ids:
        existing_hcp_ids = {
            row[0] for row in db.query(MeetingParticipant.hcp_id).filter(
                MeetingParticipant.meeting_id == meeting.id,
                MeetingParticipant.hcp_id.in_(hcp_ids),
            ).all()
        }

    existing_bk_ids: set[int] = set()
    if bk_ids:
        existing_bk_ids = {
            row[0] for row in db.query(MeetingParticipant.board_kol_id).filter(
                MeetingParticipant.meeting_id == meeting.id,
                MeetingParticipant.board_kol_id.in_(bk_ids),
            ).all()
        }

    created = []
    for inv, (perms, can_speak) in zip(data.invitees, resolved):
        if inv.user_id and inv.user_id in existing_user_ids:
            continue
        if inv.hcp_id and inv.hcp_id in existing_hcp_ids:
            continue
        if inv.board_kol_id and inv.board_kol_id in existing_bk_ids:
            continue
        mp = MeetingParticipant(
            meeting_id=meeting.id,
            user_id=inv.user_id,
            hcp_id=inv.hcp_id,
            board_kol_id=inv.board_kol_id,
            role=inv.role,
            can_speak=can_speak,
            permissions=meeting_access.serialize_permissions(perms),
            access_token=_new_join_token(),       # personal "separate login" link
            token_issued_at=datetime.utcnow(),
            invite_status=InviteStatus.pending.value,
        )
        db.add(mp)
        created.append(mp)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="One or more invitees could not be added (invalid user_id or duplicate)")

    for mp in created:
        db.refresh(mp)

    # Send each new participant their personal join-link email (best-effort: a
    # mail failure is logged but never fails the invite — the link still exists
    # and can be resent from the UI).
    for mp in created:
        try:
            _send_participant_invite_email(db, meeting, mp)
        except Exception as e:  # noqa: BLE001
            logger.warning("Invite email failed for participant %s: %s", mp.id, e)

    for mp in created:
        db.refresh(mp)
    return [_participant_to_dict(p) for p in created]


@router.patch("/meetings/{meeting_id}/participants/{participant_id}")
def update_participant(
    meeting_id: int,
    participant_id: int,
    data: ParticipantUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_manage_meeting(meeting, current_user, db)
    p = db.query(MeetingParticipant).filter(
        MeetingParticipant.id == participant_id,
        MeetingParticipant.meeting_id == meeting_id,
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="Participant not found")

    payload = data.dict(exclude_unset=True)

    new_role = payload.get("role", _enum_value(p.role))
    if new_role not in VALID_PARTICIPANT_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {new_role}")

    # Determine the permission set:
    #   - explicit `permissions` always wins
    #   - else, if the role changed and reset_permissions=true, re-apply role defaults
    #   - else, keep the participant's existing permissions
    role_changed = "role" in payload and new_role != _enum_value(p.role)
    if "permissions" in payload:
        explicit_perms = payload["permissions"]
    elif role_changed and payload.get("reset_permissions"):
        explicit_perms = meeting_access.default_permissions_for_role(new_role)
    else:
        explicit_perms = meeting_access.parse_permissions(p.permissions)

    can_speak_provided = "can_speak" in payload
    perms, new_can_speak = _finalize_perms_and_speak(
        new_role, explicit_perms, can_speak_provided, payload.get("can_speak")
    )

    # Enforce panel-speaker cap if this change turns on speaking
    if not p.can_speak and new_can_speak:
        if _count_panel_speakers(db, meeting.id, exclude_id=p.id) + 1 > PANEL_SPEAKER_LIMIT:
            raise HTTPException(status_code=400, detail=f"Panel speaker limit of {PANEL_SPEAKER_LIMIT} reached")

    # Apply scalar fields handled by the model directly
    if "role" in payload:
        p.role = new_role
    if "invite_status" in payload:
        p.invite_status = payload["invite_status"]
    p.can_speak = new_can_speak
    p.permissions = meeting_access.serialize_permissions(perms)

    db.commit()
    db.refresh(p)
    return _participant_to_dict(p)


@router.post("/meetings/{meeting_id}/participants/{participant_id}/regenerate-token")
def regenerate_participant_token(
    meeting_id: int,
    participant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Issues a fresh personal join token for a participant, invalidating the old
    link. Use when a link may have leaked or needs to be re-sent.
    """
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_manage_meeting(meeting, current_user, db)
    p = db.query(MeetingParticipant).filter(
        MeetingParticipant.id == participant_id,
        MeetingParticipant.meeting_id == meeting_id,
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="Participant not found")
    p.access_token = _new_join_token()
    p.token_issued_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    return _participant_to_dict(p)


@router.post("/meetings/{meeting_id}/participants/{participant_id}/resend-invite")
def resend_participant_invite(
    meeting_id: int,
    participant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Re-sends the personal join-link email to one participant."""
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_manage_meeting(meeting, current_user, db)
    p = db.query(MeetingParticipant).filter(
        MeetingParticipant.id == participant_id,
        MeetingParticipant.meeting_id == meeting_id,
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="Participant not found")
    email, _ = _participant_contact(p)
    if not email:
        raise HTTPException(status_code=400, detail="This participant has no email address on file.")
    if not _send_participant_invite_email(db, meeting, p):
        raise HTTPException(status_code=502, detail="Could not send the invite email. Check the email/SMTP settings.")
    db.refresh(p)
    return _participant_to_dict(p)


@router.delete("/meetings/{meeting_id}/participants/{participant_id}")
def remove_participant(
    meeting_id: int,
    participant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    _check_manage_meeting(meeting, current_user, db)
    p = db.query(MeetingParticipant).filter(
        MeetingParticipant.id == participant_id,
        MeetingParticipant.meeting_id == meeting_id,
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="Participant not found")
    db.delete(p)
    db.commit()
    return {"detail": "Participant removed"}
