"""
LiveKit endpoints — join tokens and recording control.

Two ways in, mirroring the Zoom split:
  * authenticated meeting room  -> /meetings/{id}/livekit/…
  * participant join link       -> /public/meeting/join/{token}/livekit/…

Permissions are signed into the token server-side (see services/livekit_service.
build_grants), so a client cannot grant itself the right to publish, to admin the
room, or to record. Recording is organizer-only, matching the rule already
enforced on recordings and transcripts in endpoints/meeting_transcripts.py.
"""
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.meeting import BoardMeeting
from app.models.meeting_participant import MeetingParticipant
from app.models.meeting_recording import MeetingRecording, RecordingSource
from app.models.meeting_transcript_segment import MeetingTranscriptSegment
from app.services import livekit_service, meeting_access, account_config, live_transcription
from app.api.endpoints.meeting_transcripts import _is_organizer_or_admin

router = APIRouter(tags=["MABM - LiveKit"])


def _enum_value(v):
    return v.value if hasattr(v, "value") else v


def _meeting_or_404(meeting_id: int, db: Session) -> BoardMeeting:
    m = db.query(BoardMeeting).filter(BoardMeeting.id == meeting_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return m


def _joinable_or_410(meeting: BoardMeeting) -> None:
    status = _enum_value(meeting.status)
    if status not in ("scheduled", "live"):
        raise HTTPException(status_code=410, detail=f"This meeting is {status} and cannot be joined.")


def _owner(meeting: BoardMeeting) -> Optional[int]:
    """Whose LiveKit credentials to use — the account that owns the meeting."""
    return account_config.owner_of_meeting(meeting)


def _token_response(db: Session, meeting: BoardMeeting, **kw) -> dict:
    try:
        token, url = livekit_service.create_join_token(
            db, meeting, owner_user_id=_owner(meeting), **kw)
    except livekit_service.LiveKitNotConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "token": token,
        "url": url,
        "room": livekit_service.room_name(meeting),
        "identity": kw["identity"],
        "user_name": kw["display_name"],
        "is_organizer": kw["is_organizer"],
        "can_record": kw["is_organizer"],
    }


# ── Authenticated room ───────────────────────────────────────────────────────

@router.post("/meetings/{meeting_id}/livekit/token")
def get_livekit_token(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Join token for a platform user. Only the organizer (or platform admin)
    gets room admin + record rights; colleagues join able to speak and present
    but not to record."""
    meeting = _meeting_or_404(meeting_id, db)
    _joinable_or_410(meeting)
    is_organizer = _is_organizer_or_admin(current_user, meeting)
    return _token_response(
        db, meeting,
        identity=f"user-{current_user.id}",
        display_name=current_user.full_name or current_user.email,
        role="organizer" if is_organizer else "team",
        is_organizer=is_organizer,
        can_speak=True,
        can_present=True,
    )


# ── Participant join link ────────────────────────────────────────────────────

class JoinCodeReq(BaseModel):
    code: Optional[str] = None


@router.post("/public/meeting/join/{token}/livekit/token")
def get_livekit_token_by_join_token(
    token: str,
    payload: JoinCodeReq = JoinCodeReq(),
    db: Session = Depends(get_db),
):
    """Join token for a KOL/advisor arriving through their personal link.

    Publish rights come from their per-meeting permissions: `speak` unlocks mic +
    camera, `present` unlocks screen share, and an observer with neither joins
    subscribe-only. Recording is never granted here — an organizer records from
    the in-platform room.
    """
    p = db.query(MeetingParticipant).filter(MeetingParticipant.access_token == token).first()
    if not p:
        raise HTTPException(status_code=404, detail="Invalid or expired join link")

    if p.access_code:
        supplied = (payload.code or "").strip().upper()
        if not supplied or supplied != p.access_code.upper():
            raise HTTPException(status_code=403, detail="Invalid or missing access code.")

    meeting = _meeting_or_404(p.meeting_id, db)
    _joinable_or_410(meeting)

    perms = set(meeting_access.parse_permissions(p.permissions))
    name = None
    if p.user:
        name = p.user.full_name

    # Attendance, same as the Zoom path — entering the room counts as joining.
    from app.models.meeting_participant import InviteStatus
    p.invite_status = InviteStatus.accepted.value
    if not p.joined_at:
        p.joined_at = datetime.utcnow()
    p.left_at = None
    db.commit()

    return _token_response(
        db, meeting,
        identity=f"participant-{p.id}",
        display_name=name or "Guest",
        role=_enum_value(p.role),
        is_organizer=False,
        can_speak=("speak" in perms) or bool(p.can_speak),
        can_present="present" in perms,
    )


# ── Host controls over other participants (organizer only) ───────────────────
# LiveKit enforces these server-side too — the organizer's token carries
# room_admin — but routing them through the API keeps one authorization rule and
# means the client can't act on a token it shouldn't have.

class MuteReq(BaseModel):
    identity: str
    track_sid: str
    muted: bool = True


class KickReq(BaseModel):
    identity: str


@router.get("/meetings/{meeting_id}/livekit/participants")
def livekit_participants(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Live roster with track sids, which the mute call needs."""
    meeting = _meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Access denied")
    try:
        people = livekit_service.list_participants(db, meeting, _owner(meeting))
    except livekit_service.LiveKitNotConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:                                        # noqa: BLE001
        return {"participants": []}     # room not created yet — nobody has joined
    return {"participants": [
        {
            "identity": p.identity,
            "name": p.name or p.identity,
            "joined_at": p.joined_at,
            "tracks": [
                {"sid": t.sid, "source": _enum_value(t.source), "muted": t.muted, "type": _enum_value(t.type)}
                for t in (p.tracks or [])
            ],
        }
        for p in people
    ]}


@router.post("/meetings/{meeting_id}/livekit/mute")
def livekit_mute(
    meeting_id: int,
    data: MuteReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mute (or unmute) someone else's published track."""
    meeting = _meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Only the meeting organizer can mute participants.")
    try:
        livekit_service.mute_participant(db, meeting, data.identity, data.track_sid, data.muted, _owner(meeting))
    except livekit_service.LiveKitNotConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:                                   # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Could not change that participant's mic: {e}")
    return {"identity": data.identity, "muted": data.muted}


@router.post("/meetings/{meeting_id}/livekit/remove")
def livekit_remove(
    meeting_id: int,
    data: KickReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove someone from the room. Their invite link still works, so this ends
    the current session rather than revoking access."""
    meeting = _meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Only the meeting organizer can remove participants.")
    try:
        livekit_service.remove_participant(db, meeting, data.identity, _owner(meeting))
    except livekit_service.LiveKitNotConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:                                   # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Could not remove that participant: {e}")
    return {"identity": data.identity, "removed": True}


# ── Live transcription (organizer only, both to run and to read) ─────────────

@router.get("/meetings/{meeting_id}/live-transcript")
def live_transcript(
    meeting_id: int,
    after_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Running transcript with speaker names. `after_id` returns only what's new,
    which is what the panel polls with.

    Organizer-only — the 403 is the guarantee; the UI simply hides the panel."""
    meeting = _meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Access denied")

    q = db.query(MeetingTranscriptSegment).filter(
        MeetingTranscriptSegment.meeting_id == meeting_id)
    if after_id:
        q = q.filter(MeetingTranscriptSegment.id > after_id)
    rows = q.order_by(MeetingTranscriptSegment.id.asc()).limit(500).all()
    return {
        "running": live_transcription.is_running(meeting_id),
        "segments": [
            {
                "id": s.id,
                "speaker_identity": s.speaker_identity,
                "speaker_name": s.speaker_name,
                "text": s.text,
                "offset_seconds": s.offset_seconds,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in rows
        ],
    }


@router.post("/meetings/{meeting_id}/live-transcript/start", status_code=201)
def live_transcript_start(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Start live transcription. A worker joins the room as a hidden participant
    and transcribes each speaker's own audio track."""
    meeting = _meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Only the meeting organizer can start transcription.")

    if live_transcription.is_running(meeting_id):
        return {"running": True, "already": True}

    # The worker joins as its own participant. Subscribe-only: it must never
    # publish audio or video into the meeting, or it would appear as a tile.
    try:
        token, url = livekit_service.create_join_token(
            db, meeting,
            identity=f"livetx-{meeting_id}",
            display_name="Transcription",
            role="transcriber",
            is_organizer=False,
            can_speak=False, can_present=False,
            owner_user_id=_owner(meeting),
        )
    except livekit_service.LiveKitNotConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))

    started = live_transcription.start(meeting_id, livekit_service.room_name(meeting), url, token)
    return {"running": True, "already": not started}


@router.post("/meetings/{meeting_id}/live-transcript/stop")
def live_transcript_stop(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Only the meeting organizer can stop transcription.")
    live_transcription.stop(meeting_id)
    return {"running": False}


# ── Recording (organizer only) ───────────────────────────────────────────────

@router.get("/meetings/{meeting_id}/livekit/recording")
def livekit_recording_status(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Whether a recording is running. Read from LiveKit rather than stored, so a
    reload — or a second organizer tab — always sees the truth."""
    meeting = _meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Access denied")
    try:
        info = livekit_service.active_egress_info(db, meeting, _owner(meeting))
    except livekit_service.LiveKitNotConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:                                        # noqa: BLE001
        return {"recording": False, "egress_id": None, "started_at": None}
    egress_id, started_at = info if info else (None, None)
    # `started_at` is epoch seconds from LiveKit, not the browser, so the
    # organizer's elapsed timer is correct after a reload or on a second tab.
    return {"recording": bool(egress_id), "egress_id": egress_id, "started_at": started_at}


@router.post("/meetings/{meeting_id}/livekit/recording/start", status_code=201)
def livekit_recording_start(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Only the meeting organizer can record.")

    try:
        if livekit_service.active_egress_for_room(db, meeting, _owner(meeting)):
            raise HTTPException(status_code=409, detail="A recording is already running.")
        egress_id, host_path = livekit_service.start_recording(db, meeting, _owner(meeting))
    except livekit_service.LiveKitNotConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:                                   # noqa: BLE001
        # A room only exists once someone is in it, so "does not exist" here is
        # the ordinary case of pressing Record before anyone has joined — worth a
        # plain sentence rather than a raw twirp error.
        if "does not exist" in str(e):
            raise HTTPException(
                status_code=409,
                detail="Nobody has joined the meeting yet, so there's nothing to record. "
                       "Start the recording once you're in the room.",
            )
        raise HTTPException(status_code=502, detail=f"Could not start recording: {e}")

    # Report the real start time so the client's timer matches the file.
    started = None
    try:
        info = livekit_service.active_egress_info(db, meeting, _owner(meeting))
        started = info[1] if info else None
    except Exception:                                        # noqa: BLE001
        pass
    return {"recording": True, "egress_id": egress_id, "file_path": host_path, "started_at": started}


@router.post("/meetings/{meeting_id}/livekit/recording/stop")
def livekit_recording_stop(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stops the running recording and files it under the meeting.

    The MP4 keeps being written for a few seconds after the stop call returns, so
    the row is created immediately but the file may briefly not exist yet — the
    recording list already tolerates that.
    """
    meeting = _meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Only the meeting organizer can record.")

    owner = _owner(meeting)
    try:
        egress_id = livekit_service.active_egress_for_room(db, meeting, owner)
        if not egress_id:
            # Egress stops itself when the room empties, so by the time Stop is
            # pressed the recording may already have finished. That is not an
            # error — reconcile so the finished file gets its row and appears in
            # the UI, instead of 404ing and losing it.
            from app.api.endpoints.meeting_transcripts import _reconcile_livekit_recordings
            added = _reconcile_livekit_recordings(db, meeting)
            if added:
                return {"recording": False, "reconciled": added,
                        "detail": "The recording had already finished (everyone left the meeting); it has been saved."}
            raise HTTPException(status_code=404, detail="No recording is running.")
        info = livekit_service.stop_recording(db, egress_id, owner)
    except livekit_service.LiveKitNotConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:                                   # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Could not stop recording: {e}")

    # Egress reports the CONTAINER path (/out/…); store where the host can read it.
    filename = None
    for res in getattr(info, "file_results", []) or []:
        filename = os.path.basename(res.filename or "")
    host_path = livekit_service.recording_host_path(
        filename or f"{livekit_service.room_name(meeting)}.mp4")

    rec = MeetingRecording(
        meeting_id=meeting.id,
        source=RecordingSource.provider.value,
        file_path_or_url=host_path,
        recorded_at=datetime.utcnow(),
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)

    # Transcribe automatically, on a worker thread — egress is still writing the
    # MP4 when this returns, so the job waits for the file to settle. Never
    # blocks the response, and a failure leaves the manual Generate button.
    from app.services import transcription_service
    transcription_service.transcribe_recording_in_background(rec.id)

    return {"recording": False, "recording_id": rec.id, "file_path": host_path,
            "transcribing": True}
