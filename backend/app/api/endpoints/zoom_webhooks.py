"""
Zoom webhook receiver (Phase 4).

Configure in Zoom Marketplace → your app → Feature → Event Subscriptions:
  Endpoint URL: https://your-domain/api/v1/webhooks/zoom
  Verification: store the Zoom-provided "Secret Token" in
    meeting_provider_config.extra_config = {"webhook_secret": "..."}

Subscribed events (recommended):
  - endpoint.url_validation       (required handshake)
  - recording.completed           (auto-syncs the recording + transcript)
  - meeting.ended                 (optional: marks board_meetings.status=completed)
"""
import os
import uuid
from datetime import datetime
from fastapi import APIRouter, Request, HTTPException, Depends
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.meeting import BoardMeeting, MeetingStatus
from app.models.meeting_recording import MeetingRecording, MeetingTranscript, RecordingSource, TranscriptStatus
from app.services import zoom_service

router = APIRouter(tags=["MABM - Zoom Webhooks"])


def _enum_value(v):
    return v.value if hasattr(v, "value") else v


@router.post("/webhooks/zoom")
async def zoom_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Single endpoint that handles both the URL validation handshake and event
    deliveries. No auth dep — Zoom won't send a JWT — security is the HMAC
    signature on the request body.
    """
    body_bytes = await request.body()
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    cfg = zoom_service.get_active_zoom_config(db)
    if not cfg:
        raise HTTPException(status_code=503, detail="No active Zoom provider config")
    secret = zoom_service.get_webhook_secret(cfg)
    if not secret:
        raise HTTPException(status_code=503, detail="Zoom webhook_secret missing in extra_config")

    event = payload.get("event")

    # ── URL validation handshake (one-time when adding the webhook) ──
    if event == "endpoint.url_validation":
        plain = (payload.get("payload") or {}).get("plainToken") or ""
        if not plain:
            raise HTTPException(status_code=400, detail="Missing plainToken")
        return zoom_service.build_webhook_validation_response(plain, secret)

    # ── Signature verification for all other events ──
    timestamp = request.headers.get("x-zm-request-timestamp")
    signature = request.headers.get("x-zm-signature")
    if not zoom_service.verify_webhook_signature(secret, timestamp, signature, body_bytes):
        raise HTTPException(status_code=401, detail="Invalid signature")

    # ── Dispatch ──
    if event == "recording.completed":
        return _handle_recording_completed(payload, db, cfg)
    if event == "meeting.ended":
        return _handle_meeting_ended(payload, db)

    # Unknown event types: ack so Zoom doesn't retry forever.
    return {"detail": f"Event '{event}' acknowledged but not handled"}


# ── Event handlers ───────────────────────────────────────

def _handle_recording_completed(payload: dict, db: Session, cfg) -> dict:
    """
    payload.object = the meeting object with `id` (zoom meeting id) and
    `recording_files` (download URLs). We map id → board_meetings.zoom_meeting_id
    and persist the same way `sync_recording_from_zoom` does.
    """
    obj = payload.get("payload", {}).get("object", {})
    zoom_meeting_id = str(obj.get("id") or "")
    if not zoom_meeting_id:
        raise HTTPException(status_code=400, detail="Missing meeting id in payload")

    meeting = db.query(BoardMeeting).filter(BoardMeeting.zoom_meeting_id == zoom_meeting_id).first()
    if not meeting:
        # Webhook for a meeting we don't track — ack so Zoom stops retrying.
        return {"detail": f"No MABM meeting tracks Zoom meeting {zoom_meeting_id}; ignored"}

    extract = zoom_service.extract_recording_files(obj)
    if not extract["video_url"] and not extract["transcript_url"]:
        return {"detail": "No video or transcript URL in webhook payload"}

    recording_added = False
    transcript_updated = False

    if extract["video_url"]:
        try:
            blob = zoom_service.download_file(cfg, extract["video_url"])
            upload_dir = os.path.join(settings.UPLOAD_DIR, "meetings", str(meeting.id), "recordings")
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
            db.add(MeetingRecording(
                meeting_id=meeting.id,
                source=RecordingSource.provider.value,
                file_path_or_url=abs_path,
                duration_seconds=extract.get("video_duration_seconds"),
                recorded_at=recorded_at,
            ))
            recording_added = True
        except zoom_service.ZoomAPIError as e:
            # Don't fail the whole webhook on download error — let Zoom retry.
            print(f"[zoom webhook] recording download failed for meeting {meeting.id}: {e}")

    if extract["transcript_url"]:
        try:
            blob = zoom_service.download_file(cfg, extract["transcript_url"])
            text = blob.decode("utf-8", errors="replace")
            existing = db.query(MeetingTranscript).filter(
                MeetingTranscript.meeting_id == meeting.id
            ).first()
            if existing:
                if _enum_value(existing.status) not in (TranscriptStatus.finalized.value, TranscriptStatus.shared.value):
                    existing.raw_text = text
                    transcript_updated = True
            else:
                db.add(MeetingTranscript(
                    meeting_id=meeting.id,
                    raw_text=text,
                    status=TranscriptStatus.draft.value,
                ))
                transcript_updated = True
        except zoom_service.ZoomAPIError as e:
            print(f"[zoom webhook] transcript download failed for meeting {meeting.id}: {e}")

    db.commit()
    return {
        "detail": "recording.completed handled",
        "meeting_id": meeting.id,
        "recording_added": recording_added,
        "transcript_updated": transcript_updated,
    }


def _handle_meeting_ended(payload: dict, db: Session) -> dict:
    obj = payload.get("payload", {}).get("object", {})
    zoom_meeting_id = str(obj.get("id") or "")
    if not zoom_meeting_id:
        return {"detail": "missing meeting id"}
    meeting = db.query(BoardMeeting).filter(BoardMeeting.zoom_meeting_id == zoom_meeting_id).first()
    if not meeting:
        return {"detail": f"No MABM meeting tracks Zoom meeting {zoom_meeting_id}; ignored"}
    if _enum_value(meeting.status) != MeetingStatus.completed.value:
        meeting.status = MeetingStatus.completed.value
        db.commit()
    return {"detail": "meeting.ended handled", "meeting_id": meeting.id}
