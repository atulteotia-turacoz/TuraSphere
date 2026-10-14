"""
Meeting recording + transcript.

Recording: provider-pulled (Phase 4 — Zoom) or manual upload (Phase 1).
Transcript: Medical Writer edits → admin finalizes → shared with participants.

Authorization — ORGANIZER ONLY (tightened 2026-08-05):
  Every route here, read or write, requires `_is_organizer_or_admin`: the account
  that scheduled the meeting (`BoardMeeting.organizer_id`), or the platform
  operator. Nobody else — not board owners, not co-organizers, not participants
  with a platform login, not holders of `transcripts.manage` / `meetings.manage`.

  Recordings and transcripts are also never emailed and never surfaced to
  participants: the join-token portal (endpoints/meeting_join.py) exposes only
  documents, surveys, polls and chat, and no EmailKind carries either one.

  This replaced a much wider model in which anyone who could view the meeting
  could read a finalized/shared transcript, and any meeting *manager* could
  upload recordings and edit transcripts.
"""
import os
import uuid
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from jose import JWTError, jwt

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user, create_access_token
from app.models.user import User
from app.models.meeting import BoardMeeting
from app.models.meeting_recording import (
    MeetingRecording, MeetingTranscript, RecordingSource, TranscriptStatus,
)
from app.services import zoom_service
from app.services import transcription_service

router = APIRouter(tags=["MABM - Recording & Transcript"])


ALLOWED_RECORDING_EXT = {".mp4", ".m4a", ".mp3", ".wav", ".webm", ".mov", ".mkv"}


# ── Schemas ──────────────────────────────────────────────

class TranscriptCreate(BaseModel):
    raw_text: str


class TranscriptUpdate(BaseModel):
    edited_text: str


# ── Helpers ──────────────────────────────────────────────

def _is_platform_admin(user: User) -> bool:
    role = user.role.value if hasattr(user.role, "value") else user.role
    return role in ("super_admin", "admin")


def _is_organizer_or_admin(user: User, meeting: BoardMeeting) -> bool:
    """Recordings and transcripts are private to the account that scheduled the
    meeting, plus the platform operator.

    Deliberately much narrower than the `_user_can_view_meeting` rule still used
    elsewhere in the module (endpoints/meetings.py), which also passes board
    owners, any participant holding a platform login, and MABM capability
    holders. A board meeting's recording can carry unpublished commercial and
    clinical discussion, so it is not team-visible: colleagues on the same board,
    co-organizers and `transcripts.manage` holders all get 403.
    """
    return _is_platform_admin(user) or meeting.organizer_id == user.id


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


def _recording_to_dict(r: MeetingRecording) -> dict:
    return {
        "id": r.id,
        "meeting_id": r.meeting_id,
        "source": _enum_value(r.source),
        "file_path_or_url": r.file_path_or_url,
        "duration_seconds": r.duration_seconds,
        "recorded_at": r.recorded_at.isoformat() if r.recorded_at else None,
        "created_at": r.created_at.isoformat(),
    }


def _transcript_to_dict(t: MeetingTranscript) -> dict:
    return {
        "id": t.id,
        "meeting_id": t.meeting_id,
        "raw_text": t.raw_text,
        "edited_text": t.edited_text,
        "status": _enum_value(t.status),
        "edited_by": t.edited_by,
        "editor_name": t.editor.full_name if t.editor else None,
        "finalized_by": t.finalized_by,
        "finalizer_name": t.finalizer.full_name if t.finalizer else None,
        "recording_id": t.recording_id,
        "shared_at": t.shared_at.isoformat() if t.shared_at else None,
        "created_at": t.created_at.isoformat(),
        "updated_at": t.updated_at.isoformat(),
    }


# ── Recording ────────────────────────────────────────────

@router.get("/meetings/{meeting_id}/recording")
def get_meeting_recording(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Access denied")
    _reconcile_livekit_recordings(db, meeting)
    recordings = db.query(MeetingRecording).filter(
        MeetingRecording.meeting_id == meeting_id
    ).order_by(MeetingRecording.created_at.desc()).all()
    return [_recording_to_dict(r) for r in recordings]


def _reconcile_livekit_recordings(db: Session, meeting: BoardMeeting) -> int:
    """File any recording LiveKit finished that we never wrote a row for.

    Egress stops itself when the room empties — the log says
    `End reason: Source closed` — so a meeting where everyone simply left ends
    with an MP4 on disk and no database row, which meant the recording never
    appeared in the UI at all. Pressing Stop afterwards 404s, because by then
    there is no active egress to stop.

    Runs on every recording list, so opening the Post-meeting tab is enough to
    recover one. Best-effort: LiveKit being unreachable must not break the list.
    """
    try:
        from app.services import livekit_service, account_config, transcription_service
        produced = livekit_service.completed_egress_files(
            db, meeting, account_config.owner_of_meeting(meeting))
    except Exception:                                        # noqa: BLE001
        return 0

    known = {
        os.path.basename(r.file_path_or_url or "")
        for r in db.query(MeetingRecording).filter(
            MeetingRecording.meeting_id == meeting.id).all()
    }
    added = 0
    for item in produced:
        if item["filename"] in known:
            continue
        # Only file it once the file is actually on disk — egress writes for a
        # few seconds after finishing.
        path = livekit_service.locate_recording_file(item["host_path"])
        if not os.path.isfile(path):
            continue
        rec = MeetingRecording(
            meeting_id=meeting.id,
            source=RecordingSource.provider.value,
            file_path_or_url=path,
            duration_seconds=item.get("duration_seconds"),
            recorded_at=datetime.utcfromtimestamp(item["started_at"]) if item.get("started_at") else datetime.utcnow(),
        )
        db.add(rec)
        db.commit()
        db.refresh(rec)
        added += 1
        # Same auto-transcription a normal Stop would have triggered.
        transcription_service.transcribe_recording_in_background(rec.id, wait_first=1.0)
    return added


@router.delete("/meetings/{meeting_id}/recording/{recording_id}")
def delete_meeting_recording(
    meeting_id: int,
    recording_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a recording — the database row AND the file on disk.

    Board recordings are large (tens of MB each) and carry confidential
    discussion, so the organizer needs a real delete, not just hiding the row.

    ⚠️ The transcript goes with it: `meeting_transcripts.recording_id` is
    `ON DELETE CASCADE`. The UI says so before confirming.
    """
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Only the meeting organizer can delete a recording.")

    rec = db.query(MeetingRecording).filter(
        MeetingRecording.id == recording_id,
        MeetingRecording.meeting_id == meeting_id,
    ).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found")

    stored = rec.file_path_or_url or ""
    file_removed = False
    detail = None

    if stored.startswith(("http://", "https://")):
        # Provider-hosted (Zoom): the file isn't ours, so only the row goes.
        detail = "The row was removed. The file lives on the meeting provider and was not touched."
    elif stored:
        from app.services.livekit_service import locate_recording_file, egress_host_dirs
        path = os.path.realpath(locate_recording_file(stored))
        # Containment check: only ever unlink inside our uploads tree (or the
        # egress output dir). The path comes from the database, and a bad value
        # must not be able to delete something else on the server.
        roots = [os.path.realpath(
            settings.UPLOAD_DIR if os.path.isabs(settings.UPLOAD_DIR)
            else os.path.join(os.getcwd(), settings.UPLOAD_DIR))] + egress_host_dirs()
        if not any(os.path.commonpath([path, r]) == r for r in roots):
            raise HTTPException(
                status_code=400,
                detail="Refusing to delete a file outside the uploads directory.",
            )
        try:
            os.unlink(path)
            file_removed = True
        except FileNotFoundError:
            detail = "The file was already gone; the record has been removed."
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"Could not delete the file: {e}")

    db.delete(rec)     # cascades to this recording's transcript
    db.commit()
    return {"deleted": True, "recording_id": recording_id,
            "file_removed": file_removed, "detail": detail}


# A <video src> can't send the Authorization header, so playback uses a
# short-lived link signed for ONE recording and ONE user. Long enough to watch
# and seek through a long meeting; the user is re-checked on every request.
# `typ` marks it as a scoped token, which get_current_user refuses — so a link
# copied out of a log can't be replayed as a login.
PLAY_LINK_TYP = "recording_play"
PLAY_LINK_TTL = timedelta(hours=6)


def _recording_path_or_404(db: Session, meeting: BoardMeeting, recording_id: int) -> str:
    """Host path of a recording's file, or an HTTPException that says why not."""
    rec = db.query(MeetingRecording).filter(
        MeetingRecording.id == recording_id,
        MeetingRecording.meeting_id == meeting.id,
    ).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found")

    path = rec.file_path_or_url or ""
    # A provider-hosted URL isn't ours to stream — hand the caller the link.
    if path.startswith(("http://", "https://")):
        raise HTTPException(status_code=409, detail=path)

    # Stored paths may be relative to the backend working directory, and egress
    # MP4s may sit in the compose mount rather than under UPLOAD_DIR.
    from app.services import livekit_service
    stored = path
    path = livekit_service.locate_recording_file(path)
    if not os.path.isfile(path):
        # Say why: ask LiveKit what happened to this recording (failed? still
        # writing? done but written somewhere this server doesn't look?).
        from app.services import account_config
        egress = livekit_service.egress_status_for_file(
            db, meeting, os.path.basename(stored), account_config.owner_of_meeting(meeting))
        raise HTTPException(status_code=404, detail=livekit_service.missing_recording_detail(stored, egress))
    return path


def _recording_file_response(path: str, download: bool = False) -> FileResponse:
    ext = os.path.splitext(path)[1].lower()
    media_type = {
        ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
        ".mkv": "video/x-matroska", ".m4a": "audio/mp4", ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
    }.get(ext, "application/octet-stream")
    return FileResponse(path, media_type=media_type, filename=os.path.basename(path),
                        content_disposition_type="attachment" if download else "inline")


@router.get("/meetings/{meeting_id}/recording/{recording_id}/stream")
def stream_meeting_recording(
    meeting_id: int,
    recording_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Serve the recording file so the organizer can play or download it.

    `file_path_or_url` is a server-side path (LiveKit egress writes into
    uploads/, manual uploads land there too), which a browser cannot open — the
    Post-meeting list showed a row with no way to watch it. Starlette's
    FileResponse honours HTTP Range, so seeking works in a <video> element
    instead of forcing a full download first.

    Organizer-only, same rule as the rest of this module.
    """
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Access denied")
    return _recording_file_response(_recording_path_or_404(db, meeting, recording_id))


@router.post("/meetings/{meeting_id}/recording/{recording_id}/play-link")
def create_recording_play_link(
    meeting_id: int,
    recording_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """A signed token for `/play`, so the browser streams the file with Range
    requests instead of downloading it whole first. The blob download used
    before timed out on long recordings ("Could not load the recording.").

    Checks the file exists now, so a missing/failed recording still gets the
    explanatory message rather than a broken player.
    """
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Access denied")
    _recording_path_or_404(db, meeting, recording_id)
    token = create_access_token(
        {"sub": str(current_user.id), "typ": PLAY_LINK_TYP,
         "meeting_id": meeting_id, "recording_id": recording_id},
        expires_delta=PLAY_LINK_TTL,
    )
    return {"token": token, "expires_in": int(PLAY_LINK_TTL.total_seconds())}


@router.get("/meetings/{meeting_id}/recording/{recording_id}/play")
def play_meeting_recording(
    meeting_id: int,
    recording_id: int,
    t: str,
    download: bool = False,
    db: Session = Depends(get_db),
):
    """Stream a recording for a <video src> (or a download link) using a token
    from `/play-link`. The token only opens the recording it was issued for,
    and the user must still be active and still the organizer."""
    try:
        claims = jwt.decode(t, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="This playback link has expired. Press Play again.")
    if (claims.get("typ") != PLAY_LINK_TYP
            or claims.get("meeting_id") != meeting_id
            or claims.get("recording_id") != recording_id):
        raise HTTPException(status_code=403, detail="Access denied")
    user = db.query(User).filter(User.id == int(claims.get("sub") or 0)).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=403, detail="Access denied")
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(user, meeting):
        raise HTTPException(status_code=403, detail="Access denied")
    return _recording_file_response(_recording_path_or_404(db, meeting, recording_id), download)


@router.post("/meetings/{meeting_id}/recording", status_code=201)
async def upload_meeting_recording(
    meeting_id: int,
    file: UploadFile = File(...),
    duration_seconds: Optional[int] = Form(None),
    recorded_at: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Access denied")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_RECORDING_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"Extension {ext or '(none)'} not allowed. Allowed: {', '.join(sorted(ALLOWED_RECORDING_EXT))}",
        )

    upload_dir = os.path.join(settings.UPLOAD_DIR, "meetings", str(meeting_id), "recordings")
    os.makedirs(upload_dir, exist_ok=True)

    filename = f"{uuid.uuid4().hex}{ext}"
    abs_path = os.path.join(upload_dir, filename)
    content = await file.read()
    with open(abs_path, "wb") as f:
        f.write(content)

    rec = MeetingRecording(
        meeting_id=meeting_id,
        source=RecordingSource.manual_upload.value,
        file_path_or_url=abs_path,
        duration_seconds=duration_seconds,
        recorded_at=_parse_iso_dt(recorded_at),
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return _recording_to_dict(rec)


# ── Transcript ───────────────────────────────────────────

@router.get("/meetings/{meeting_id}/transcript")
def get_meeting_transcript(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Access denied")
    t = db.query(MeetingTranscript).filter(MeetingTranscript.meeting_id == meeting_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="No transcript yet")
    # The draft/finalized/shared distinction used to decide who could read the
    # transcript. It no longer gates anything — the only reader is the organizer,
    # who sees their own transcript at every stage. `status` is now purely the
    # editing workflow's own state.
    return _transcript_to_dict(t)


@router.post("/meetings/{meeting_id}/transcript/generate", status_code=201)
def generate_transcript_from_recording(
    meeting_id: int,
    recording_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Transcribe a recording with speech-to-text and save it as a draft.

    Works for ANY recording we hold the file for — LiveKit egress or a manual
    upload — which is the gap this fills: LiveKit records but does not
    transcribe, and Zoom's auto-transcript needs a paid plan.

    Defaults to the most recent recording. The result lands as `draft`, so the
    existing edit → finalize workflow is unchanged.
    """
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Only the meeting organizer can generate a transcript.")

    q = db.query(MeetingRecording).filter(MeetingRecording.meeting_id == meeting_id)
    if recording_id:
        q = q.filter(MeetingRecording.id == recording_id)
    rec = q.order_by(MeetingRecording.created_at.desc()).first()
    if not rec:
        raise HTTPException(status_code=404, detail="No recording to transcribe yet.")

    try:
        path = transcription_service.resolve_media_path(rec.file_path_or_url)
        # The meeting's owning account decides whether the audio may be sent to
        # a hosted model, exactly as it does for CV extraction and scoring.
        text, model = transcription_service.transcribe_file(
            db, path,
            ai_allowed=transcription_service.owner_ai_enabled(db, meeting_id),
        )
    except transcription_service.TranscriptionError as e:
        # These messages are written for the organizer, so pass them through.
        raise HTTPException(status_code=400, detail=str(e))

    # One transcript per RECORDING, so transcribing a second recording no longer
    # overwrites the first. Never clobber one that has been finalized.
    t = db.query(MeetingTranscript).filter(MeetingTranscript.recording_id == rec.id).first()
    if t and _enum_value(t.status) in (TranscriptStatus.finalized.value, TranscriptStatus.shared.value):
        raise HTTPException(
            status_code=409,
            detail="This recording already has a finalized transcript. Reopen it before regenerating.",
        )
    if not t:
        t = MeetingTranscript(meeting_id=meeting_id, recording_id=rec.id)
        db.add(t)
    t.raw_text = text
    t.status = TranscriptStatus.draft.value
    t.edited_by = current_user.id
    db.commit()
    db.refresh(t)

    out = _transcript_to_dict(t)
    out["model"] = model
    return out


@router.get("/meetings/{meeting_id}/recording/{recording_id}/transcript/download")
def download_recording_transcript(
    meeting_id: int,
    recording_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download one recording's transcript as a .txt file.

    Serves the edited text when a writer has revised it, otherwise the raw
    machine output — the same precedence the viewer uses.
    """
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Access denied")
    t = db.query(MeetingTranscript).filter(
        MeetingTranscript.meeting_id == meeting_id,
        MeetingTranscript.recording_id == recording_id,
    ).first()
    if not t:
        raise HTTPException(status_code=404, detail="No transcript for this recording yet")

    body = (t.edited_text or t.raw_text or "").strip()
    if not body:
        raise HTTPException(status_code=404, detail="This transcript is empty")

    rec = db.query(MeetingRecording).filter(MeetingRecording.id == recording_id).first()
    when = (rec.recorded_at or rec.created_at) if rec else datetime.utcnow()
    safe_title = "".join(ch if ch.isalnum() or ch in " -_" else "" for ch in (meeting.title or "meeting")).strip()
    filename = f"{safe_title or 'meeting'} transcript {when:%Y-%m-%d %H%M}.txt"

    header = (
        f"{meeting.title}\n"
        f"Recorded: {when:%d %b %Y, %H:%M}\n"
        f"Status: {_enum_value(t.status)}\n"
        + "-" * 60 + "\n\n"
    )
    return Response(
        content=(header + body).encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/meetings/{meeting_id}/recording/{recording_id}/transcript")
def get_recording_transcript(
    meeting_id: int,
    recording_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The transcript for one specific recording, or 404 if it has none yet."""
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Access denied")
    t = db.query(MeetingTranscript).filter(
        MeetingTranscript.meeting_id == meeting_id,
        MeetingTranscript.recording_id == recording_id,
    ).first()
    if not t:
        raise HTTPException(status_code=404, detail="No transcript for this recording yet")
    return _transcript_to_dict(t)


@router.post("/meetings/{meeting_id}/transcript", status_code=201)
def create_meeting_transcript(
    meeting_id: int,
    data: TranscriptCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Access denied")
    existing = db.query(MeetingTranscript).filter(MeetingTranscript.meeting_id == meeting_id).first()
    if existing:
        raise HTTPException(status_code=409, detail="Transcript already exists; use PATCH to edit")
    t = MeetingTranscript(
        meeting_id=meeting_id,
        raw_text=data.raw_text,
        status=TranscriptStatus.draft.value,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _transcript_to_dict(t)


@router.patch("/meetings/{meeting_id}/transcript")
def edit_meeting_transcript(
    meeting_id: int,
    data: TranscriptUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Access denied")
    t = db.query(MeetingTranscript).filter(MeetingTranscript.meeting_id == meeting_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="No transcript yet — POST raw_text first")
    if _enum_value(t.status) in (TranscriptStatus.finalized.value, TranscriptStatus.shared.value):
        raise HTTPException(status_code=409, detail="Transcript already finalized; cannot edit")
    t.edited_text = data.edited_text
    t.status = TranscriptStatus.edited.value
    t.edited_by = current_user.id
    db.commit()
    db.refresh(t)
    return _transcript_to_dict(t)


@router.post("/meetings/{meeting_id}/transcript/finalize")
def finalize_meeting_transcript(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Access denied")
    t = db.query(MeetingTranscript).filter(MeetingTranscript.meeting_id == meeting_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="No transcript to finalize")
    t.status = TranscriptStatus.shared.value
    t.finalized_by = current_user.id
    t.shared_at = datetime.utcnow()
    db.commit()
    db.refresh(t)
    return _transcript_to_dict(t)


# ── Zoom sync (Phase 4) ──────────────────────────────────

@router.post("/meetings/{meeting_id}/zoom/sync-recording")
def sync_recording_from_zoom(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Pulls the latest cloud recording + auto-transcript from Zoom for this meeting,
    persisting them to meeting_recordings and meeting_transcripts.

    Requires: meeting was auto-provisioned via Zoom (has zoom_meeting_id),
    and an active Zoom provider config exists.
    """
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _is_organizer_or_admin(current_user, meeting):
        raise HTTPException(status_code=403, detail="Access denied")

    if not meeting.zoom_meeting_id:
        raise HTTPException(
            status_code=400,
            detail="This meeting has no zoom_meeting_id. Either it wasn't auto-provisioned via Zoom, or it predates Phase 4.",
        )
    cfg = zoom_service.get_active_zoom_config(db)
    if not cfg:
        raise HTTPException(
            status_code=400,
            detail="No active Zoom provider config. Configure it in MABM Admin → Meeting Provider.",
        )

    try:
        listing = zoom_service.list_recordings(cfg, meeting.zoom_meeting_id)
    except zoom_service.ZoomAPIError as e:
        raise HTTPException(status_code=502, detail=f"Zoom API error: {e}")
    except zoom_service.ZoomConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))

    extract = zoom_service.extract_recording_files(listing)
    if not extract["video_url"] and not extract["transcript_url"]:
        return {
            "detail": "Nothing to sync — Zoom hasn't published any recordings or transcripts for this meeting yet.",
            "recording_added": False,
            "transcript_updated": False,
        }

    recording_added = False
    transcript_updated = False

    # ── Recording ──
    if extract["video_url"]:
        try:
            blob = zoom_service.download_file(cfg, extract["video_url"])
            upload_dir = os.path.join(settings.UPLOAD_DIR, "meetings", str(meeting_id), "recordings")
            os.makedirs(upload_dir, exist_ok=True)
            filename = f"zoom_{uuid.uuid4().hex}.mp4"
            abs_path = os.path.join(upload_dir, filename)
            with open(abs_path, "wb") as f:
                f.write(blob)
            recorded_at = None
            if extract.get("recorded_at"):
                try:
                    recorded_at = datetime.fromisoformat(extract["recorded_at"].replace("Z", "+00:00"))
                except ValueError:
                    pass
            rec = MeetingRecording(
                meeting_id=meeting_id,
                source=RecordingSource.provider.value,
                file_path_or_url=abs_path,
                duration_seconds=extract.get("video_duration_seconds"),
                recorded_at=recorded_at,
            )
            db.add(rec)
            recording_added = True
        except zoom_service.ZoomAPIError as e:
            raise HTTPException(status_code=502, detail=f"Failed to download recording: {e}")

    # ── Transcript ──
    if extract["transcript_url"]:
        try:
            transcript_blob = zoom_service.download_file(cfg, extract["transcript_url"])
            transcript_text = transcript_blob.decode("utf-8", errors="replace")
            existing = db.query(MeetingTranscript).filter(
                MeetingTranscript.meeting_id == meeting_id
            ).first()
            if existing:
                # Don't overwrite a manually edited / finalized transcript
                if _enum_value(existing.status) in (TranscriptStatus.finalized.value, TranscriptStatus.shared.value):
                    pass  # leave it alone
                else:
                    existing.raw_text = transcript_text
                    transcript_updated = True
            else:
                t = MeetingTranscript(
                    meeting_id=meeting_id,
                    raw_text=transcript_text,
                    status=TranscriptStatus.draft.value,
                )
                db.add(t)
                transcript_updated = True
        except zoom_service.ZoomAPIError as e:
            raise HTTPException(status_code=502, detail=f"Failed to download transcript: {e}")

    db.commit()
    return {
        "detail": "Sync complete",
        "recording_added": recording_added,
        "transcript_updated": transcript_updated,
    }
