"""
Microsoft Teams (Graph API) client for the MABM module.

Uses application (client-credentials) OAuth with credentials stored in the
`meeting_provider_config` row (provider='teams'): client_id, client_secret,
tenant_id. Creating an online meeting with app-only auth requires an organizer
AAD user — stored in extra_config as {"organizer_user_id": "<aad-object-id>"}.

Azure setup required for this to work live:
  - App registration with application permission `OnlineMeetings.ReadWrite.All`
    (admin-consented).
  - An application access policy granting the app rights to act for the organizer
    user (Graph: New-CsApplicationAccessPolicy / Grant-CsApplicationAccessPolicy).
"""
import json
import time
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from app.models.meeting_provider import MeetingProviderConfig, MeetingProvider

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

_TOKEN_CACHE: Dict[int, Tuple[str, float]] = {}
_TOKEN_TTL_BUFFER_SECONDS = 60


class TeamsConfigError(RuntimeError):
    """Raised when the Teams config row is missing required fields."""


class TeamsAPIError(RuntimeError):
    """Raised when a Graph API call returns a non-2xx response."""

    def __init__(self, status: int, body: Any):
        super().__init__(f"Graph API {status}: {body}")
        self.status = status
        self.body = body


def get_teams_config(db: Session, *, active_only: bool = False) -> Optional[MeetingProviderConfig]:
    q = db.query(MeetingProviderConfig).filter(
        MeetingProviderConfig.provider == MeetingProvider.teams.value
    )
    if active_only:
        q = q.filter(MeetingProviderConfig.is_active.is_(True))
    return q.first()


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


def get_organizer_user_id(config: MeetingProviderConfig) -> Optional[str]:
    return _config_extra(config).get("organizer_user_id")


def get_access_token(config: MeetingProviderConfig) -> str:
    """Fetches (or returns cached) a client-credentials access token for Graph."""
    if not config or not config.client_id or not config.client_secret or not config.tenant_id:
        raise TeamsConfigError("Teams config is missing client_id, client_secret, or tenant_id")

    now = time.time()
    cached = _TOKEN_CACHE.get(config.id)
    if cached and cached[1] > now + _TOKEN_TTL_BUFFER_SECONDS:
        return cached[0]

    token_url = f"https://login.microsoftonline.com/{config.tenant_id}/oauth2/v2.0/token"
    with httpx.Client(timeout=15.0) as client:
        r = client.post(token_url, data={
            "client_id": config.client_id,
            "client_secret": config.client_secret,
            "grant_type": "client_credentials",
            "scope": "https://graph.microsoft.com/.default",
        })
    if r.status_code != 200:
        raise TeamsAPIError(r.status_code, r.text)
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


def create_meeting(
    config: MeetingProviderConfig,
    *,
    topic: str,
    start_time_iso: Optional[str] = None,
    duration_minutes: int = 60,
) -> Dict[str, Any]:
    """Creates a Teams online meeting for the configured organizer. Returns the
    Graph response; caller persists `id` and `joinWebUrl` (-> join_url)."""
    organizer = get_organizer_user_id(config)
    if not organizer:
        raise TeamsConfigError(
            "Teams config is missing organizer_user_id (the AAD object id of the meeting organizer)"
        )
    token = get_access_token(config)

    # Compute start/end. Default to now if no schedule given.
    try:
        start = datetime.fromisoformat(start_time_iso.replace("Z", "+00:00")) if start_time_iso else datetime.utcnow()
    except (ValueError, AttributeError):
        start = datetime.utcnow()
    end = start + timedelta(minutes=duration_minutes or 60)

    payload = {
        "subject": topic,
        "startDateTime": start.isoformat(),
        "endDateTime": end.isoformat(),
    }
    with httpx.Client(timeout=20.0) as client:
        r = client.post(
            f"{GRAPH_BASE}/users/{organizer}/onlineMeetings",
            json=payload,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
    if r.status_code not in (200, 201):
        raise TeamsAPIError(r.status_code, r.text)
    return r.json()


def delete_meeting(config: MeetingProviderConfig, meeting_id: str) -> bool:
    """DELETE /users/{organizer}/onlineMeetings/{id} — removes a Teams meeting.
    Returns True if deleted, False if it no longer exists (404) or the organizer
    is not configured. Raises TeamsAPIError on any other failure."""
    if not meeting_id:
        return False
    organizer = get_organizer_user_id(config)
    if not organizer:
        return False
    token = get_access_token(config)
    with httpx.Client(timeout=15.0) as client:
        r = client.delete(
            f"{GRAPH_BASE}/users/{organizer}/onlineMeetings/{meeting_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    if r.status_code in (200, 204):
        return True
    if r.status_code == 404:
        return False
    raise TeamsAPIError(r.status_code, r.text)
