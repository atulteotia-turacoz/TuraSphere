"""
Zoom API client for the MABM module (Phase 4).

Uses Zoom Server-to-Server OAuth credentials stored in the active row of
`meeting_provider_config` (provider='zoom', is_active=True). Webhook secret
lives in `extra_config` JSON as `{"webhook_secret": "..."}`.

What this module gives you:
  - get_active_zoom_config(db)           : the row, or None
  - get_access_token(config)             : cached, with TTL
  - create_meeting(config, ...)          : POST /users/me/meetings
  - list_recordings(config, meeting_id)  : GET /meetings/{id}/recordings
  - download_file(config, url, dest)     : authed download (recordings/transcripts)
  - verify_webhook_signature(...)        : Zoom webhook v2 HMAC-SHA256
  - build_webhook_validation_response(plain_token, secret) : for endpoint.url_validation

What this module does NOT do (out of scope for Phase 4):
  - Refresh tokens beyond the simple TTL cache
  - Retries with backoff (caller-side concern)
  - Bulk org-wide recording sync
"""
import base64
import hashlib
import hmac
import json
import time
from typing import Any, Dict, Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from app.models.meeting_provider import MeetingProviderConfig, MeetingProvider


ZOOM_OAUTH_TOKEN_URL = "https://zoom.us/oauth/token"
ZOOM_API_BASE = "https://api.zoom.us/v2"

# Module-level token cache: { config_id: (access_token, expires_at_unix) }
_TOKEN_CACHE: Dict[int, Tuple[str, float]] = {}
_TOKEN_TTL_BUFFER_SECONDS = 60   # refresh 60s before expiry


# ── Config ───────────────────────────────────────────────

def get_active_zoom_config(db: Session) -> Optional[MeetingProviderConfig]:
    """Returns the active Zoom config row, or None if Zoom isn't the active provider."""
    return db.query(MeetingProviderConfig).filter(
        MeetingProviderConfig.provider == MeetingProvider.zoom.value,
        MeetingProviderConfig.is_active.is_(True),
    ).first()


def _config_extra(config: MeetingProviderConfig) -> Dict[str, Any]:
    if not config.extra_config:
        return {}
    if isinstance(config.extra_config, dict):
        return config.extra_config
    try:
        v = json.loads(config.extra_config)
        return v if isinstance(v, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def get_webhook_secret(config: MeetingProviderConfig) -> Optional[str]:
    return _config_extra(config).get("webhook_secret")


def get_sdk_credentials(config: MeetingProviderConfig) -> Tuple[Optional[str], Optional[str]]:
    """Meeting SDK Key + Secret for the in-app embed. These come from a separate
    Zoom *Meeting SDK* app (NOT the Server-to-Server OAuth app), stored in
    extra_config as {"sdk_key": "...", "sdk_secret": "..."}."""
    extra = _config_extra(config)
    return extra.get("sdk_key"), extra.get("sdk_secret")


# ── In-app Meeting SDK embed ─────────────────────────────

class ZoomSDKNotConfigured(RuntimeError):
    """Raised when the account has no Meeting SDK Key/Secret configured."""


def build_sdk_signature(sdk_key: str, sdk_secret: str, meeting_number: str, role: int) -> str:
    """JWT signature for the Zoom Meeting SDK for Web (v2/v3 auth).

    Payload per Zoom spec: appKey/sdkKey, mn (meeting number), role
    (1=host, 0=participant), iat, exp (max 48h), tokenExp."""
    from jose import jwt  # python-jose (already a dependency)

    now = int(time.time())
    exp = now + 60 * 60 * 2  # 2 hours
    payload = {
        "appKey": sdk_key,
        "sdkKey": sdk_key,
        "mn": str(meeting_number),
        "role": int(role),
        "iat": now,
        "exp": exp,
        "tokenExp": exp,
    }
    return jwt.encode(payload, sdk_secret, algorithm="HS256")


def get_zak_token(config: MeetingProviderConfig) -> Optional[str]:
    """ZAK token for the OAuth app's user — required to JOIN AS HOST via the SDK.
    GET /users/me/token?type=zak. Returns None on failure (caller can still join
    as a participant)."""
    try:
        token = get_access_token(config)
    except (ZoomConfigError, ZoomAPIError):
        return None
    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.get(
                f"{ZOOM_API_BASE}/users/me/token",
                params={"type": "zak"},
                headers={"Authorization": f"Bearer {token}"},
            )
        if r.status_code == 200:
            return r.json().get("token")
    except httpx.HTTPError:
        pass
    return None


# ── OAuth ────────────────────────────────────────────────

class ZoomConfigError(RuntimeError):
    """Raised when the Zoom config row is missing required fields."""


class ZoomAPIError(RuntimeError):
    """Raised when a Zoom API call returns a non-2xx response."""

    def __init__(self, status: int, body: Any):
        super().__init__(f"Zoom API {status}: {body}")
        self.status = status
        self.body = body


def get_access_token(config: MeetingProviderConfig) -> str:
    """Fetches (or returns cached) Server-to-Server OAuth access token."""
    if not config or not config.client_id or not config.client_secret or not config.account_id:
        raise ZoomConfigError("Zoom config is missing client_id, client_secret, or account_id")

    now = time.time()
    cached = _TOKEN_CACHE.get(config.id)
    if cached and cached[1] > now + _TOKEN_TTL_BUFFER_SECONDS:
        return cached[0]

    basic = base64.b64encode(f"{config.client_id}:{config.client_secret}".encode()).decode()
    with httpx.Client(timeout=15.0) as client:
        r = client.post(
            ZOOM_OAUTH_TOKEN_URL,
            params={"grant_type": "account_credentials", "account_id": config.account_id},
            headers={"Authorization": f"Basic {basic}"},
        )
    if r.status_code != 200:
        raise ZoomAPIError(r.status_code, r.text)

    data = r.json()
    token = data["access_token"]
    expires_in = int(data.get("expires_in", 3600))
    _TOKEN_CACHE[config.id] = (token, now + expires_in)
    return token


def invalidate_token_cache(config_id: Optional[int] = None) -> None:
    if config_id is None:
        _TOKEN_CACHE.clear()
    else:
        _TOKEN_CACHE.pop(config_id, None)


# ── Meetings ─────────────────────────────────────────────

def create_meeting(
    config: MeetingProviderConfig,
    *,
    topic: str,
    start_time_iso: Optional[str] = None,   # ISO 8601 with timezone (Zoom requires UTC 'Z' suffix)
    duration_minutes: int = 60,
    agenda: Optional[str] = None,
    timezone: str = "UTC",
    settings_overrides: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Creates a scheduled meeting under the user identified as 'me' (the OAuth
    app's authorized user). Returns the full Zoom response, with `id`, `join_url`,
    `start_url`, etc. Caller persists `id` (numeric) as `zoom_meeting_id` and
    `join_url` on the BoardMeeting row.
    """
    token = get_access_token(config)
    payload: Dict[str, Any] = {
        "topic": topic,
        "type": 2 if start_time_iso else 1,    # 1 = instant, 2 = scheduled
        "duration": duration_minutes,
        "timezone": timezone,
        "settings": {
            "auto_recording": "cloud",         # so recording.completed webhook fires
            "approval_type": 2,                # no registration required
            "audio": "both",
            "host_video": True,
            "participant_video": False,
        },
    }
    if start_time_iso:
        payload["start_time"] = start_time_iso
    if agenda:
        payload["agenda"] = agenda[:2000]      # Zoom field limit
    if settings_overrides:
        payload["settings"].update(settings_overrides)

    with httpx.Client(timeout=15.0) as client:
        r = client.post(
            f"{ZOOM_API_BASE}/users/me/meetings",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
    if r.status_code not in (200, 201):
        raise ZoomAPIError(r.status_code, r.text)
    return r.json()


def update_meeting(
    config: MeetingProviderConfig,
    zoom_meeting_id: str,
    *,
    topic: Optional[str] = None,
    start_time_iso: Optional[str] = None,   # local wall-clock, read in `timezone`
    duration_minutes: Optional[int] = None,
    agenda: Optional[str] = None,
    timezone: Optional[str] = None,
) -> bool:
    """
    PATCH /meetings/{meetingId} — keeps the Zoom meeting in step when the
    organizer edits it in TuraQuant. Only the fields given are sent.
    Returns True if updated, False if Zoom no longer knows the meeting (404).
    Raises ZoomAPIError on any other failure.
    """
    payload: Dict[str, Any] = {}
    if topic is not None:
        payload["topic"] = topic
    if start_time_iso:
        payload["start_time"] = start_time_iso
        payload["timezone"] = timezone or "UTC"
    if duration_minutes is not None:
        payload["duration"] = duration_minutes
    if agenda is not None:
        payload["agenda"] = agenda[:2000]      # Zoom field limit
    if not zoom_meeting_id or not payload:
        return True

    token = get_access_token(config)
    with httpx.Client(timeout=15.0) as client:
        r = client.patch(
            f"{ZOOM_API_BASE}/meetings/{zoom_meeting_id}",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
    if r.status_code in (200, 204):
        return True
    if r.status_code == 404:
        return False
    raise ZoomAPIError(r.status_code, r.text)


def delete_meeting(config: MeetingProviderConfig, zoom_meeting_id: str) -> bool:
    """
    DELETE /meetings/{meetingId} — removes a previously created Zoom meeting.
    Returns True if it was deleted, False if Zoom no longer knows about it
    (404 — already gone / expired). Raises ZoomAPIError on any other failure.
    """
    if not zoom_meeting_id:
        return False
    token = get_access_token(config)
    with httpx.Client(timeout=15.0) as client:
        r = client.delete(
            f"{ZOOM_API_BASE}/meetings/{zoom_meeting_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    if r.status_code in (200, 204):
        return True
    if r.status_code == 404:
        return False
    raise ZoomAPIError(r.status_code, r.text)


# ── Recordings + Transcripts ─────────────────────────────

def list_recordings(config: MeetingProviderConfig, zoom_meeting_id: str) -> Dict[str, Any]:
    """
    GET /meetings/{meetingId}/recordings — returns recording_files[] including
    the cloud recording (MP4) and the auto-generated transcript (TRANSCRIPT/CC).
    """
    token = get_access_token(config)
    with httpx.Client(timeout=30.0) as client:
        r = client.get(
            f"{ZOOM_API_BASE}/meetings/{zoom_meeting_id}/recordings",
            headers={"Authorization": f"Bearer {token}"},
        )
    if r.status_code == 404:
        return {"recording_files": []}
    if r.status_code != 200:
        raise ZoomAPIError(r.status_code, r.text)
    return r.json()


def extract_recording_files(recordings_response: Dict[str, Any]) -> Dict[str, Any]:
    """
    Reduces a Zoom recordings response to the bits the MABM module cares about:
      - video_url (MP4)
      - video_duration_seconds
      - transcript_url (Zoom auto-transcript)
      - recorded_at (ISO)
    """
    files = recordings_response.get("recording_files") or []
    out: Dict[str, Any] = {
        "video_url": None,
        "video_duration_seconds": None,
        "transcript_url": None,
        "recorded_at": recordings_response.get("start_time"),
    }
    for f in files:
        ft = (f.get("file_type") or "").upper()
        rt = (f.get("recording_type") or "").lower()
        if ft == "MP4" and out["video_url"] is None:
            out["video_url"] = f.get("download_url") or f.get("play_url")
            # Zoom's `recording_files[].duration` is sometimes seconds, sometimes minutes
            # depending on file type. For MP4 it's seconds.
            d = f.get("duration")
            if d is not None:
                out["video_duration_seconds"] = int(d)
        if ft == "TRANSCRIPT" or rt == "audio_transcript":
            out["transcript_url"] = f.get("download_url") or f.get("play_url")
    return out


def download_file(config: MeetingProviderConfig, url: str) -> bytes:
    """Fetches a Zoom-hosted file (recording or transcript) using the bearer token."""
    if not url:
        raise ZoomConfigError("download_file called with empty URL")
    token = get_access_token(config)
    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        r = client.get(url, headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        raise ZoomAPIError(r.status_code, r.text[:500])
    return r.content


# ── Webhooks ─────────────────────────────────────────────

def verify_webhook_signature(
    secret: str,
    timestamp_header: Optional[str],
    signature_header: Optional[str],
    body_bytes: bytes,
) -> bool:
    """
    Validates Zoom's `x-zm-signature` against the request body.
    Format: "v0=hex-hmac-sha256(secret, 'v0:' + timestamp + ':' + body)"
    """
    if not secret or not timestamp_header or not signature_header:
        return False
    if not signature_header.startswith("v0="):
        return False
    message = f"v0:{timestamp_header}:{body_bytes.decode('utf-8', errors='replace')}".encode()
    expected = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"v0={expected}", signature_header)


def build_webhook_validation_response(plain_token: str, secret: str) -> Dict[str, str]:
    """
    Zoom 'endpoint.url_validation' challenge: the receiver must echo back
    {plainToken, encryptedToken=hmac_sha256(secret, plainToken)}.
    """
    encrypted = hmac.new(secret.encode(), plain_token.encode(), hashlib.sha256).hexdigest()
    return {"plainToken": plain_token, "encryptedToken": encrypted}
