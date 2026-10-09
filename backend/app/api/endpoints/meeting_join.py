"""
Public per-participant meeting join ("separate login").

Each meeting participant gets a unique opaque token (MeetingParticipant.access_token)
backing a personal magic-link join URL: /meeting/join/{token}. This is an
unauthenticated, token-gated endpoint (same pattern as public polls/surveys) so
contact-book participants without a platform account can still join individually.

Using the link identifies the participant, surfaces their per-meeting role +
permissions, records attendance, and forwards them to the real provider join URL.
"""
import os
from typing import Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.meeting import BoardMeeting, MeetingAgendaItem
from app.models.meeting_participant import MeetingParticipant, InviteStatus
from app.models.meeting_document import MeetingDocument
from app.models.board_section import BoardSection
from app.models.meeting_session_comment import MeetingSessionComment
from app.models.meeting_document_view import MeetingDocumentView, ViewSource
from app.models.meeting_engagement import MeetingSurvey, MeetingPoll, SurveyPhase
from app.models.survey import SurveyResponse
from app.models.poll import PollVote
from app.models.board_workspace import BoardActivity
from app.services import meeting_access
from app.services import account_config
from app.services import zoom_service
from app.services import meeting_chat
from app.services import document_preview
from app.services import session_discussion
from app.services.board_activity import log_board_activity
from app.api.endpoints.meetings import (
    _cohost_display_names, _video_provider, _participant_identity,
)

router = APIRouter(tags=["MABM - Meeting Join"])


def _enum_value(v):
    return v.value if hasattr(v, "value") else v


def _get_participant_by_token(token: str, db: Session) -> MeetingParticipant:
    p = db.query(MeetingParticipant).filter(
        MeetingParticipant.access_token == token
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="Invalid or expired join link")
    return p


def _participant_display(p: MeetingParticipant):
    """(name, email, organization) — delegates to the one resolver in meetings.py
    so the portal, the invite email and the roster cannot disagree."""
    return _participant_identity(p)


def _join_payload(p: MeetingParticipant, meeting: BoardMeeting, *, include_join_url: bool) -> dict:
    name, email, org = _participant_display(p)
    status = _enum_value(meeting.status)
    # Joining is only meaningful while the meeting is scheduled or live.
    joinable = status in ("scheduled", "live")
    return {
        "meeting": {
            "id": meeting.id,
            "title": meeting.title,
            "agenda_summary": meeting.agenda_summary,
            "scheduled_at": meeting.scheduled_at.isoformat() if meeting.scheduled_at else None,
            "duration_minutes": meeting.duration_minutes,
            "format": _enum_value(meeting.format),
            "status": status,
            "board_name": meeting.board.title if meeting.board else None,
            "has_join_url": bool(meeting.join_url),
            # Whether the meeting can be joined *inside* the portal (embedded Zoom
            # SDK). Only meetings provisioned through Zoom carry a numeric meeting
            # id; a hand-pasted join_url gives an external link but no in-app
            # session. The portal uses this to decide between opening the embedded
            # room and just checking the participant in.
            "has_in_app_session": bool(meeting.zoom_meeting_id),
            # 'zoom' | 'livekit' | None — which stack the portal should open. A
            # LiveKit meeting has no zoom_meeting_id, so the portal must not use
            # has_in_app_session alone to decide whether to enter the room.
            "video_provider": _video_provider(meeting),
            "chat_enabled": meeting_chat.chat_is_open(meeting),
        },
        "participant": {
            "name": name,
            "email": email,
            "organization": org,
            "role": _enum_value(p.role),
            "permissions": meeting_access.parse_permissions(p.permissions),
            "can_speak": p.can_speak,
            "invite_status": _enum_value(p.invite_status),
            "joined_at": p.joined_at.isoformat() if p.joined_at else None,
            "left_at": p.left_at.isoformat() if p.left_at else None,
            "requires_code": bool(p.access_code),
        },
        "joinable": joinable,
        "requires_code": bool(p.access_code),
        # The real provider (Zoom) URL is only handed out when the participant
        # actively enters and the meeting is joinable.
        "join_url": meeting.join_url if (include_join_url and joinable) else None,
    }


def _kol_actor(p: MeetingParticipant) -> str:
    name, email, _org = _participant_display(p)
    return f"{name or email or 'KOL'} (KOL/Advisor)"


def _log_kol_login(db: Session, board_id: int, actor_label: str):
    """Audit a KOL portal access as a 'login', de-duplicated to once per 30 min
    so reloads/polling don't flood the trail."""
    recent = db.query(BoardActivity).filter(
        BoardActivity.board_id == board_id,
        BoardActivity.action == "kol.login",
        BoardActivity.actor_label == actor_label,
        BoardActivity.created_at >= datetime.utcnow() - timedelta(minutes=30),
    ).first()
    if not recent:
        log_board_activity(db, board_id, None, "kol.login",
                           f"{actor_label} accessed the meeting portal", actor_label=actor_label)


@router.get("/public/meeting/join/{token}")
def get_join_info(token: str, db: Session = Depends(get_db)):
    """Returns meeting details + this participant's role/permissions. Read-only."""
    p = _get_participant_by_token(token, db)
    meeting = db.query(BoardMeeting).filter(BoardMeeting.id == p.meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    _log_kol_login(db, meeting.board_id, _kol_actor(p))  # audit: KOL login activity
    return _join_payload(p, meeting, include_join_url=False)


@router.post("/public/meeting/join/{token}/enter")
def enter_meeting(token: str, db: Session = Depends(get_db)):
    """
    Records the participant as joined (attendance), accepts the invite, and
    returns the provider join URL so the frontend can forward them in.
    """
    p = _get_participant_by_token(token, db)
    meeting = db.query(BoardMeeting).filter(BoardMeeting.id == p.meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    status = _enum_value(meeting.status)
    if status not in ("scheduled", "live"):
        raise HTTPException(status_code=410, detail=f"This meeting is {status} and cannot be joined.")

    p.invite_status = InviteStatus.accepted.value
    if not p.joined_at:
        p.joined_at = datetime.utcnow()
    p.left_at = None
    db.commit()
    db.refresh(p)
    return _join_payload(p, meeting, include_join_url=True)


class JoinCodeReq(BaseModel):
    code: Optional[str] = None


@router.post("/public/meeting/join/{token}/sdk-signature")
def get_join_sdk_signature(token: str, payload: JoinCodeReq = JoinCodeReq(), db: Session = Depends(get_db)):
    """In-app (on-platform) join for a participant: returns the Zoom Meeting SDK
    signature + params so the participant portal can embed the meeting instead of
    redirecting to zoom.us. Joins as an attendee (role 0). Also records attendance.
    If the participant has an access code, it must be supplied and match."""
    p = _get_participant_by_token(token, db)

    if p.access_code:
        supplied = (payload.code or "").strip().upper()
        if not supplied or supplied != p.access_code.upper():
            raise HTTPException(status_code=403, detail="Invalid or missing access code.")

    meeting = db.query(BoardMeeting).filter(BoardMeeting.id == p.meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    status = _enum_value(meeting.status)
    if status not in ("scheduled", "live"):
        raise HTTPException(status_code=410, detail=f"This meeting is {status} and cannot be joined.")
    if not meeting.zoom_meeting_id:
        raise HTTPException(status_code=400, detail="This meeting has no in-app session yet.")

    cfg = account_config.resolve_provider(
        db, account_config.owner_of_meeting(meeting), provider="zoom", allow_global=False,
    )
    sdk_key, sdk_secret = zoom_service.get_sdk_credentials(cfg) if cfg else (None, None)
    if not sdk_key or not sdk_secret:
        raise HTTPException(
            status_code=400,
            detail="In-app join isn't set up for this meeting yet (Meeting SDK not configured).",
        )

    # Host controls (record, mute others) are Zoom role 1 and need a ZAK. Granted
    # ONLY when this participant row belongs to the user who scheduled the
    # meeting — i.e. the organizer opening their own personal join link. It is
    # NOT enough to hold the `manage` permission: a moderator or co-host KOL
    # administers the meeting inside the portal but must not be able to record it.
    #
    # Still gated on the access code as well (verified above), since the ZAK is
    # the Zoom *account owner's* credential and a forwarded link must never carry
    # host rights with it.
    is_host = (
        p.user_id is not None
        and p.user_id == meeting.organizer_id
        and bool(p.access_code)
    )
    role = 1 if is_host else 0
    signature = zoom_service.build_sdk_signature(sdk_key, sdk_secret, meeting.zoom_meeting_id, role)
    zak = zoom_service.get_zak_token(cfg) if is_host else None
    # See the same block in meetings.py: role 1 without a ZAK silently joins
    # without host controls, so say so rather than leaving them to wonder.
    host_warning = (
        "Joining without host controls: Zoom did not return a host token (ZAK). "
        "Add the 'user:read:token' scope to your Zoom Server-to-Server OAuth app."
    ) if (is_host and not zak) else None
    name, _email, _org = _participant_display(p)

    # Record attendance (same as entering).
    p.invite_status = InviteStatus.accepted.value
    if not p.joined_at:
        p.joined_at = datetime.utcnow()
    p.left_at = None
    db.commit()

    return {
        "signature": signature,
        "sdk_key": sdk_key,
        "meeting_number": meeting.zoom_meeting_id,
        "password": meeting.zoom_password or "",
        "user_name": name or "Guest",
        "role": role,
        "zak": zak,
        "join_url": meeting.join_url,
        # Same co-host roster as the authenticated room, for an organizer who
        # joined through their own personal link. Empty for everyone else — a
        # participant has no business receiving the moderator list.
        "cohost_names": _cohost_display_names(meeting) if is_host else [],
        "host_warning": host_warning,
    }


@router.post("/public/meeting/join/{token}/leave")
def leave_meeting(token: str, db: Session = Depends(get_db)):
    """Records the participant as having left (attendance end timestamp)."""
    p = _get_participant_by_token(token, db)
    p.left_at = datetime.utcnow()
    db.commit()
    return {"detail": "Marked as left", "left_at": p.left_at.isoformat()}


# ── KOL / Advisor portal extras (materials + engagements) ────────────────────
# A participant (KOL/advisor) reaches everything through their join token. These
# read-only endpoints surface the assigned materials and the pre/live/post
# surveys & polls so they can be completed from the same portal.

def _has_perm(p: MeetingParticipant, slug: str) -> bool:
    return slug in set(meeting_access.parse_permissions(p.permissions))


@router.get("/public/meeting/join/{token}/materials")
def list_join_materials(token: str, db: Session = Depends(get_db)):
    """Documents the team marked visible to KOLs/advisors (`kol_visible`) for this
    meeting, surfaced only if the participant holds the `view_documents` permission.
    """
    p = _get_participant_by_token(token, db)
    can_view = _has_perm(p, "view_documents")
    can_download = _has_perm(p, "download_documents")
    if not can_view:
        return {"can_view": False, "can_download": False, "documents": []}

    docs = db.query(MeetingDocument).filter(
        MeetingDocument.meeting_id == p.meeting_id,
        MeetingDocument.is_enabled == True,    # noqa: E712
        MeetingDocument.kol_visible == True,   # noqa: E712
    ).order_by(MeetingDocument.created_at.desc()).all()

    out = []
    for d in docs:
        out.append({
            "id": d.id,
            "title": d.title,
            "phase": _enum_value(d.phase),
            "category": _enum_value(d.category),
            "section_id": d.section_id,
            "section_title": d.section.title if d.section else None,
            "section_sequence": d.section.sequence if d.section else None,
            "session_title": d.doc_session.title if d.doc_session else (d.agenda_item.title if d.agenda_item else None),
            "size_bytes": d.size_bytes,
            "mime_type": d.mime_type,
            # 'pdf' | 'image' | 'text' | null — Office files convert on demand.
            "preview_kind": document_preview.preview_kind(d.file_path or ""),
            "created_at": d.created_at.isoformat(),
        })
    return {"can_view": True, "can_download": can_download, "documents": out}


@router.get("/public/meeting/join/{token}/agenda")
def get_join_agenda(token: str, db: Session = Depends(get_db)):
    """The meeting's running order for the invited expert.

    The dashboard already groups material BY session, but there was nowhere to
    simply read what the day covers — including the items that carry no
    documents, which never appeared there at all.
    """
    p = _get_participant_by_token(token, db)
    meeting = db.query(BoardMeeting).filter(BoardMeeting.id == p.meeting_id).first()
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


@router.get("/public/meeting/join/{token}/materials/{document_id}/download")
def download_join_material(token: str, document_id: int, db: Session = Depends(get_db)):
    p = _get_participant_by_token(token, db)
    if not _has_perm(p, "download_documents"):
        raise HTTPException(status_code=403, detail="You don't have permission to download documents")
    doc = db.query(MeetingDocument).filter(
        MeetingDocument.id == document_id,
        MeetingDocument.meeting_id == p.meeting_id,
        MeetingDocument.is_enabled == True,    # noqa: E712
        MeetingDocument.kol_visible == True,   # noqa: E712
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not doc.file_path or not os.path.isfile(doc.file_path):
        raise HTTPException(status_code=404, detail="File not found on server")
    # Audit: KOL document download
    meeting = db.query(BoardMeeting).filter(BoardMeeting.id == p.meeting_id).first()
    if meeting:
        actor = _kol_actor(p)
        log_board_activity(db, meeting.board_id, None, "kol.document_download",
                           f"{actor} downloaded “{doc.title}” (v{doc.version})", actor_label=actor)
    # Downloading IS referring to the material, so it counts toward "experts who
    # opened section N" — but it carries no time, because once the file is on
    # their laptop we cannot know how long they read it.
    _record_view(db, p, doc, ViewSource.download)
    return FileResponse(doc.file_path, media_type=doc.mime_type or "application/octet-stream",
                        filename=os.path.basename(doc.file_path))


# ── In-meeting chat (participant / join-token side) ──────────────────────────
# The authenticated side of the same chat lives in meetings.py; both go through
# app.services.meeting_chat so the rules stay in one place.

class ChatSendReq(BaseModel):
    body: str


class ChatToggleReq(BaseModel):
    enabled: bool


def _chat_meeting_or_404(p: MeetingParticipant, db: Session) -> BoardMeeting:
    meeting = db.query(BoardMeeting).filter(BoardMeeting.id == p.meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@router.get("/public/meeting/join/{token}/chat")
def list_join_chat(token: str, after_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Chat for the participant's meeting-room panel. Readable by any participant
    on the meeting; sending is separately gated by the `chat` permission."""
    p = _get_participant_by_token(token, db)
    meeting = _chat_meeting_or_404(p, db)
    is_open = meeting_chat.chat_is_open(meeting)
    return {
        "chat_enabled": is_open,
        "can_send": is_open and _has_perm(p, "chat"),
        "can_manage": _has_perm(p, "manage"),
        "messages": meeting_chat.list_messages(db, p.meeting_id, after_id=after_id),
    }


@router.post("/public/meeting/join/{token}/chat", status_code=201)
def send_join_chat(token: str, data: ChatSendReq, db: Session = Depends(get_db)):
    p = _get_participant_by_token(token, db)
    meeting = _chat_meeting_or_404(p, db)

    if not meeting_chat.chat_is_open(meeting):
        raise HTTPException(status_code=403, detail="Chat is turned off for this meeting.")
    if not _has_perm(p, "chat"):
        raise HTTPException(status_code=403, detail="You don't have permission to send chat messages.")

    body = meeting_chat.clean_body(data.body)
    if not body:
        raise HTTPException(status_code=400, detail="Message is empty.")

    name, _email, _org = _participant_display(p)
    msg = meeting_chat.post_message(
        db, p.meeting_id, body,
        sender_name=name or "Guest",
        sender_role=_enum_value(p.role),
        participant_id=p.id,
    )
    return meeting_chat.message_to_dict(msg)


@router.patch("/public/meeting/join/{token}/chat/settings")
def set_join_chat_enabled(token: str, data: ChatToggleReq, db: Session = Depends(get_db)):
    """Chat on/off for an organizer who joined through their own link. Same
    `manage` permission that grants Zoom host role in the SDK signature above."""
    p = _get_participant_by_token(token, db)
    meeting = _chat_meeting_or_404(p, db)
    if not _has_perm(p, "manage"):
        raise HTTPException(status_code=403, detail="You don't have permission to manage this meeting.")
    meeting.chat_enabled = bool(data.enabled)
    db.commit()
    return {"chat_enabled": meeting.chat_enabled}


@router.get("/public/meeting/join/{token}/engagements")
def list_join_engagements(token: str, db: Session = Depends(get_db)):
    """Pre/post surveys and live polls for this meeting, with whether THIS
    participant (matched by email) has already responded."""
    p = _get_participant_by_token(token, db)
    _name, email, _org = _participant_display(p)
    email_l = (email or "").strip().lower()

    def _survey_done(survey_id: int) -> bool:
        if not email_l:
            return False
        return db.query(SurveyResponse).filter(
            SurveyResponse.survey_id == survey_id,
            SurveyResponse.status == "complete",
            func.lower(SurveyResponse.respondent_email) == email_l,
        ).first() is not None

    def _poll_done(poll_id: int) -> bool:
        if not email_l:
            return False
        return db.query(PollVote).filter(
            PollVote.poll_id == poll_id,
            func.lower(PollVote.voter_email) == email_l,
        ).first() is not None

    def _survey_item(link: MeetingSurvey):
        s = link.survey
        return {
            "title": s.title if s else None,
            "token": s.token if s else None,
            "status": _enum_value(s.status) if s else None,
            "responded": _survey_done(link.survey_id) if s else False,
        } if s else None

    def _poll_item(link: MeetingPoll):
        pl = link.poll
        return {
            "title": pl.title if pl else None,
            "token": pl.token if pl else None,
            "status": _enum_value(pl.status) if pl else None,
            "responded": _poll_done(link.poll_id) if pl else False,
        } if pl else None

    survey_links = db.query(MeetingSurvey).filter(MeetingSurvey.meeting_id == p.meeting_id).all()
    poll_links = db.query(MeetingPoll).filter(MeetingPoll.meeting_id == p.meeting_id).all()

    pre = [_survey_item(l) for l in survey_links if _enum_value(l.phase) == SurveyPhase.pre.value]
    post = [_survey_item(l) for l in survey_links if _enum_value(l.phase) == SurveyPhase.post.value]
    polls = [_poll_item(l) for l in poll_links]

    return {
        "can_vote": _has_perm(p, "vote"),
        "pre_surveys": [x for x in pre if x],
        "live_polls": [x for x in polls if x],
        "post_surveys": [x for x in post if x],
    }


# ── Expert dashboard ─────────────────────────────────────────────────────────
# One payload behind the invited expert's landing page, laid out to the spec in
# "KOL dashboard Advisory Board-Dr Shruti": a personal header, the invitation
# note, the meeting particulars, the other experts, the reading material grouped
# per session with its own discussion forum, and the survey link.
#
# It is deliberately ONE call. Every piece is small, the page shows them all at
# once, and an expert on a hotel connection should not wait on six round trips.

def _maps_url(venue: Optional[str]) -> Optional[str]:
    """Google Maps link for the venue — the spec asks for the venue to be given
    on maps. A search URL rather than an embed: no API key, and it opens in
    whatever maps app the expert already uses."""
    if not venue or not venue.strip():
        return None
    from urllib.parse import quote_plus
    return f"https://www.google.com/maps/search/?api=1&query={quote_plus(venue.strip())}"


def _expert_entry(mp: MeetingParticipant) -> dict:
    """One row of the expert roster. Names only, linked to the profile when the
    participant is a KOL — exactly what the spec asks for."""
    name, _email, org = _participant_display(mp)
    return {
        "id": mp.id,
        "name": name,
        "organization": org,
        # Only an HCP-linked participant has a profile page to point at.
        "profile_path": f"/hcp/{mp.hcp_id}" if mp.hcp_id else None,
        "role": _enum_value(mp.role),
    }


def _viewer(p: MeetingParticipant) -> session_discussion.Viewer:
    """This participant, as the discussion module sees them.

    Never a moderator: the panel writes and deletes its own, the organizer
    moderates from the board side.
    """
    name, _email, _org = _participant_display(p)
    return session_discussion.Viewer(
        kind=session_discussion.PARTICIPANT,
        id=p.id,
        name=name or "Participant",
        # Holding a valid join token is the whole permission — see the note on
        # add_session_comment below.
        can_post=bool(p.access_token),
        can_moderate=False,
    )


@router.get("/public/meeting/join/{token}/dashboard")
def get_expert_dashboard(token: str, db: Session = Depends(get_db)):
    p = _get_participant_by_token(token, db)
    meeting = db.query(BoardMeeting).filter(BoardMeeting.id == p.meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    board = meeting.board
    _log_kol_login(db, meeting.board_id, _kol_actor(p))

    name, email, org = _participant_display(p)
    hcp = p.hcp if p.hcp_id else None

    # ── Header: "Welcome Dr XYZ / Affiliations / Years of Experience" ──
    # Only a KOL-linked participant carries these; for anyone else the page
    # falls back to the plain greeting it always showed.
    profile = {
        "name": name,
        "email": email,
        "organization": org,
        "affiliations": hcp.affiliations if hcp else None,
        "years_of_experience": hcp.years_of_experience if hcp else None,
        "specialty": hcp.specialty if hcp else None,
        "designation": hcp.designation if hcp else None,
        "profile_path": f"/hcp/{p.hcp_id}" if p.hcp_id else None,
    }

    # ── Meeting particulars ──
    # Date and time are handed over pre-split. The spec lists "Save the Date"
    # and "Time" as two separate lines, and the client separately asked for date
    # and time to stop being one blob.
    when = meeting.scheduled_at
    end = (when + timedelta(minutes=meeting.duration_minutes or 60)) if when else None
    venue = (board.venue if board else None)
    details = {
        "topic": (board.title if board else None) or meeting.title,
        "meeting_title": meeting.title,
        "agenda_summary": meeting.agenda_summary,
        "save_the_date": when.date().isoformat() if when else None,
        "time": f"{when:%H:%M}" if when else None,
        "end_time": f"{end:%H:%M}" if end else None,
        "scheduled_at": when.isoformat() if when else None,
        "duration_minutes": meeting.duration_minutes,
        "format": _enum_value(meeting.format),
        "status": _enum_value(meeting.status),
        "venue": venue,
        "venue_map_url": _maps_url(venue),
        "objective": board.objective if board else None,
    }

    # ── The other experts, alphabetical ──
    # Everyone else on the meeting, sorted by name. Sorted here rather than in
    # the page so every client agrees on the order.
    others = [mp for mp in meeting.participants if mp.id != p.id]
    experts = sorted(
        (e for e in (_expert_entry(mp) for mp in others) if e["name"]),
        key=lambda e: e["name"].lower(),
    )

    # ── Reading material, grouped per session ──
    can_view = _has_perm(p, "view_documents")
    can_download = _has_perm(p, "download_documents")

    docs = []
    if can_view:
        docs = db.query(MeetingDocument).filter(
            MeetingDocument.meeting_id == meeting.id,
            MeetingDocument.is_enabled == True,    # noqa: E712
            MeetingDocument.kol_visible == True,   # noqa: E712
        ).order_by(MeetingDocument.created_at.asc()).all()

    def _doc_dict(d: MeetingDocument) -> dict:
        return {
            "id": d.id,
            "title": d.title,
            "category": _enum_value(d.category),
            "phase": _enum_value(d.phase),
            "mime_type": d.mime_type,
            "size_bytes": d.size_bytes,
            "version": d.version,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "preview_kind": document_preview.preview_kind(d.file_path or ""),
            # Its own session, shown on the row — a document is filed under a
            # section AND a session, and the two are independent.
            "session_title": d.doc_session.title if d.doc_session else None,
        }

    # Material grouped the way the team filed it: by SECTION, with each row
    # carrying its session. The agenda-item grouping below is the legacy filing,
    # kept so a document uploaded before sections existed still has a home.
    docs_by_section: dict = {}
    docs_by_agenda: dict = {}
    loose_docs = []
    for d in docs:
        if d.section_id:
            docs_by_section.setdefault(d.section_id, []).append(_doc_dict(d))
        elif d.agenda_item_id:
            docs_by_agenda.setdefault(d.agenda_item_id, []).append(_doc_dict(d))
        else:
            loose_docs.append(_doc_dict(d))

    sections = []
    if docs_by_section:
        rows = (
            db.query(BoardSection)
            .filter(BoardSection.id.in_(docs_by_section.keys()))
            .order_by(BoardSection.sequence.asc(), BoardSection.id.asc())
            .all()
        )
        sections = [{
            "id": sec.id,
            "title": sec.title,
            "sequence": sec.sequence,
            "documents": docs_by_section.get(sec.id, []),
        } for sec in rows]

    # Comments per session, oldest first, in one query rather than one per
    # session. Read through the shared module, so the thread the expert sees
    # here is the same one the client and the organizer are writing into.
    agenda_items = list(meeting.agenda_items)
    comments_by_session = session_discussion.comments_by_session(db, meeting, _viewer(p))

    sessions = [{
        "id": a.id,
        "sequence": a.sequence,
        "title": a.title,
        "description": a.description,
        "duration_minutes": a.duration_minutes,
        "documents": docs_by_agenda.get(a.id, []),
        "comments": comments_by_session.get(a.id, []),
    } for a in agenda_items]

    # ── Surveys ──
    survey_links = db.query(MeetingSurvey).filter(MeetingSurvey.meeting_id == meeting.id).all()
    email_l = (email or "").strip().lower()

    def _responded(survey_id: int) -> bool:
        if not email_l:
            return False
        return db.query(SurveyResponse).filter(
            SurveyResponse.survey_id == survey_id,
            SurveyResponse.status == "complete",
            func.lower(SurveyResponse.respondent_email) == email_l,
        ).first() is not None

    surveys = []
    for link in survey_links:
        s = link.survey
        if not s:
            continue
        surveys.append({
            "title": s.title,
            "token": s.token,
            "phase": _enum_value(link.phase),
            "status": _enum_value(s.status),
            "responded": _responded(link.survey_id),
        })

    return {
        "profile": profile,
        "details": details,
        "experts": experts,
        "sessions": sessions,
        # Material by section, each document carrying its own session.
        "sections": sections,
        # Filed under neither. Shown as "Other material" rather than dropped —
        # otherwise uploading without picking anything makes a document
        # silently invisible to the expert.
        "other_documents": loose_docs,
        "surveys": surveys,
        "can_view_documents": can_view,
        "can_download_documents": can_download,
        "can_comment": bool(p.access_token),
    }


class SessionCommentReq(BaseModel):
    body: str


@router.get("/public/meeting/join/{token}/discussion")
def get_join_discussion(token: str, db: Session = Depends(get_db)):
    """The expert's Discussion tab: every session, with its whole thread.

    The same conversation the dashboard shows folded under each session's
    reading material — here it is the page, because the panel kept missing it
    down there. Replies from the client and the project team appear inline,
    so an expert who asks a question sees the answer in the same place.
    """
    p = _get_participant_by_token(token, db)
    meeting = db.query(BoardMeeting).filter(BoardMeeting.id == p.meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return session_discussion.build_discussion(db, meeting, _viewer(p))


@router.post("/public/meeting/join/{token}/comments", status_code=201)
def add_join_comment(token: str, data: SessionCommentReq, db: Session = Depends(get_db)):
    """Post to the meeting's discussion without picking a session.

    What the expert's flat Discussion tab writes. The per-session route below
    still exists and is what the forum folded under each session on the
    dashboard uses — the two land in the same thread.
    """
    p = _get_participant_by_token(token, db)
    meeting = db.query(BoardMeeting).filter(BoardMeeting.id == p.meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    try:
        body = session_discussion.clean_body(data.body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    viewer = _viewer(p)
    c = session_discussion.add_comment(db, meeting, None, body, viewer)

    actor = _kol_actor(p)
    log_board_activity(db, meeting.board_id, None, "kol.session_comment",
                       f"{actor} posted in the discussion", actor_label=actor)
    return session_discussion.comment_dict(c, viewer)


@router.delete("/public/meeting/join/{token}/comments/{comment_id}")
def delete_join_comment(token: str, comment_id: int, db: Session = Depends(get_db)):
    """Remove one of your own comments, whichever session it belongs to.

    Addressed by comment id alone so the flat thread does not have to know which
    session a row came from before it can delete it.
    """
    p = _get_participant_by_token(token, db)
    c = db.query(MeetingSessionComment).filter(
        MeetingSessionComment.id == comment_id,
        MeetingSessionComment.meeting_id == p.meeting_id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    if not session_discussion.may_delete(c, _viewer(p)):
        raise HTTPException(status_code=403, detail="You can only delete your own comments.")
    db.delete(c)
    db.commit()
    return {"deleted": True}


@router.post("/public/meeting/join/{token}/sessions/{agenda_item_id}/comments", status_code=201)
def add_session_comment(token: str, agenda_item_id: int, data: SessionCommentReq,
                        db: Session = Depends(get_db)):
    """An expert leaves a thought on one session's reading material.

    Open to any participant holding a valid join token — the spec's whole point
    is "please feel free to add your thoughts in the comments section below",
    and gating that behind the chat permission would silence the people the
    forum exists for. Reading documents is a separate permission and stays so.
    """
    p = _get_participant_by_token(token, db)
    meeting = db.query(BoardMeeting).filter(BoardMeeting.id == p.meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    item = session_discussion.get_session_or_none(db, p.meeting_id, agenda_item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        body = session_discussion.clean_body(data.body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    viewer = _viewer(p)
    c = session_discussion.add_comment(db, meeting, item, body, viewer)

    # Audit: the organizer's engagement view reads the trail as well as the rows.
    actor = _kol_actor(p)
    log_board_activity(db, meeting.board_id, None, "kol.session_comment",
                       f"{actor} commented on “{item.title}”", actor_label=actor)

    return session_discussion.comment_dict(c, viewer)


@router.delete("/public/meeting/join/{token}/sessions/{agenda_item_id}/comments/{comment_id}")
def delete_session_comment(token: str, agenda_item_id: int, comment_id: int,
                           db: Session = Depends(get_db)):
    """An expert removes their own comment. Only their own — the organizer
    moderates from the board side, and one expert must never be able to delete
    another's contribution."""
    p = _get_participant_by_token(token, db)
    c = db.query(MeetingSessionComment).filter(
        MeetingSessionComment.id == comment_id,
        MeetingSessionComment.agenda_item_id == agenda_item_id,
        MeetingSessionComment.meeting_id == p.meeting_id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    if not session_discussion.may_delete(c, _viewer(p)):
        raise HTTPException(status_code=403, detail="You can only delete your own comments.")
    db.delete(c)
    db.commit()
    return {"deleted": True}


# ── Reading-material view tracking ───────────────────────────────────────────
# The organizer dashboard asks how many experts opened each section's slides and
# how long they spent. Nothing could answer that: a download left one line in the
# activity log, and opening a document left no trace at all. So the portal now
# records an open, and heartbeats while the viewer is on screen.

class ViewHeartbeatReq(BaseModel):
    seconds: int


def _record_view(db: Session, p: MeetingParticipant, doc: MeetingDocument,
                 source: ViewSource) -> MeetingDocumentView:
    name, _email, _org = _participant_display(p)
    v = MeetingDocumentView(
        meeting_id=p.meeting_id,
        document_id=doc.id,
        # Snapshotted, not joined on read — re-filing a document under another
        # session later must not rewrite who read what.
        agenda_item_id=doc.agenda_item_id,
        participant_id=p.id,
        participant_label=name or "Participant",
        source=source,
        seconds_spent=0,
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


def _visible_doc_or_404(db: Session, p: MeetingParticipant, document_id: int) -> MeetingDocument:
    doc = db.query(MeetingDocument).filter(
        MeetingDocument.id == document_id,
        MeetingDocument.meeting_id == p.meeting_id,
        MeetingDocument.is_enabled == True,    # noqa: E712
        MeetingDocument.kol_visible == True,   # noqa: E712
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.post("/public/meeting/join/{token}/materials/{document_id}/view", status_code=201)
def open_material(token: str, document_id: int, db: Session = Depends(get_db)):
    """Opens a document in the portal viewer. Returns the view id to heartbeat
    against, and the inline URL to render."""
    p = _get_participant_by_token(token, db)
    if not _has_perm(p, "view_documents"):
        raise HTTPException(status_code=403, detail="You don't have permission to view documents")
    doc = _visible_doc_or_404(db, p, document_id)
    v = _record_view(db, p, doc, ViewSource.view)

    meeting = db.query(BoardMeeting).filter(BoardMeeting.id == p.meeting_id).first()
    if meeting:
        actor = _kol_actor(p)
        log_board_activity(db, meeting.board_id, None, "kol.document_open",
                           f"{actor} opened “{doc.title}”", actor_label=actor)
    return {
        "view_id": v.id,
        "document_id": doc.id,
        "title": doc.title,
        "mime_type": doc.mime_type,
        "inline_url": f"/public/meeting/join/{token}/materials/{doc.id}/inline",
    }


@router.post("/public/meeting/join/{token}/views/{view_id}/heartbeat")
def heartbeat_view(token: str, view_id: int, data: ViewHeartbeatReq,
                   db: Session = Depends(get_db)):
    """Reports how long the document has been open, in seconds since it opened.

    The client sends elapsed-since-open rather than a delta, so a dropped beat
    corrects itself on the next one instead of losing time forever. The value
    only ever moves up — a stale beat arriving late cannot shrink the total.
    """
    p = _get_participant_by_token(token, db)
    v = db.query(MeetingDocumentView).filter(
        MeetingDocumentView.id == view_id,
        MeetingDocumentView.participant_id == p.id,
    ).first()
    if not v:
        raise HTTPException(status_code=404, detail="View not found")

    seconds = int(data.seconds or 0)
    # Guard against a tab left open overnight reporting 40,000 seconds of
    # "reading" and wrecking the average. 2 hours is far beyond any real read of
    # a slide deck.
    seconds = max(0, min(seconds, 7200))
    if seconds > (v.seconds_spent or 0):
        v.seconds_spent = seconds
        db.commit()
    return {"view_id": v.id, "seconds_spent": v.seconds_spent}


@router.get("/public/meeting/join/{token}/materials/{document_id}/inline")
def inline_material(token: str, document_id: int, db: Session = Depends(get_db)):
    """Serves the file for in-portal display. Separate from the download route
    because viewing needs only `view_documents` — an expert who may read the
    slides but not take a copy away can still read them."""
    p = _get_participant_by_token(token, db)
    if not _has_perm(p, "view_documents"):
        raise HTTPException(status_code=403, detail="You don't have permission to view documents")
    doc = _visible_doc_or_404(db, p, document_id)
    if not doc.file_path or not os.path.isfile(doc.file_path):
        raise HTTPException(status_code=404, detail="File not found on server")
    # A browser renders a PDF or an image; a .docx/.pptx/.xlsx it would simply
    # download, which is the one thing a view-only participant may not do. So
    # Office files are converted to PDF first (LibreOffice, cached).
    try:
        path, media_type = document_preview.prepare(doc.file_path, doc.mime_type)
    except document_preview.PreviewError as e:
        raise HTTPException(status_code=415, detail=str(e))
    return FileResponse(
        path,
        media_type=media_type,
        # inline, not attachment — this route exists to render in an iframe.
        headers={"Content-Disposition": f'inline; filename="{os.path.basename(path)}"'},
    )
