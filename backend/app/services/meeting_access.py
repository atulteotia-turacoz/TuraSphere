"""
Per-meeting participant roles & permissions for the MABM module.

This is the meeting-attendee permission layer — distinct from the module-level
MABM roles in app.services.mabm_access (which gate admin/authoring access). Here
each MeetingParticipant carries a per-meeting `role` plus a granular `permissions`
set that controls what they can do once they join via their personal login link.

Capability slugs (meeting-scoped):
  - speak              — unmute / speak (panel). Mirrors MeetingParticipant.can_speak.
  - chat               — send chat messages
  - present            — present / share screen
  - vote               — answer live polls
  - view_documents     — view meeting documents
  - download_documents — download meeting documents
  - manage             — host controls (mute others, manage participants)

Defaults per role (overridable per participant via the permissions JSON):
"""
import json
from typing import Iterable, List, Optional, Set


# All recognised meeting-scoped permission slugs.
MEETING_PERMISSIONS: Set[str] = {
    "speak",
    "chat",
    "present",
    "vote",
    "view_documents",
    "download_documents",
    "manage",
}

# Permissions that imply the participant occupies a panel "speaker" slot
# (subject to the per-meeting speaker cap).
SPEAKER_PERMISSION = "speak"

DEFAULT_PERMISSIONS_BY_ROLE = {
    "host": {
        "speak", "chat", "present", "vote",
        "view_documents", "download_documents", "manage",
    },
    # A moderator runs the room, so they need a voice in it — without `speak`
    # they could mute others and share a screen but never talk, which is not a
    # moderator in any ordinary sense.
    "moderator": {
        "speak", "chat", "present", "vote",
        "view_documents", "download_documents", "manage",
    },
    "panel_member": {
        "speak", "chat", "vote",
        "view_documents", "download_documents",
    },
    # `speak` added 2026-08-06. These are video meetings: someone invited as a
    # participant is expected to take part, and a KOL who cannot unmute has no
    # voice in the discussion the board exists for. They also never appeared in
    # the recording, since egress can only composite people who publish.
    # `observer` remains the genuinely listen-only role.
    "participant": {
        "speak", "chat", "vote", "view_documents",
    },
    "observer": {
        "view_documents",
    },
}

# Roles that occupy a panel speaker slot by default.
SPEAKER_ROLES = {"host", "panel_member"}


def default_permissions_for_role(role: str) -> Set[str]:
    """The default permission set for a role (empty set for unknown roles)."""
    return set(DEFAULT_PERMISSIONS_BY_ROLE.get(role, set()))


def normalize_permissions(perms: Optional[Iterable[str]]) -> List[str]:
    """Keep only recognised slugs, de-duplicated and stably ordered."""
    if not perms:
        return []
    seen = set(perms)
    return [p for p in sorted(MEETING_PERMISSIONS) if p in seen]


def parse_permissions(raw) -> List[str]:
    """Parse the stored permissions JSON (or list) into a clean slug list."""
    if not raw:
        return []
    if isinstance(raw, list):
        return normalize_permissions(raw)
    try:
        v = json.loads(raw)
        return normalize_permissions(v) if isinstance(v, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def serialize_permissions(perms: Optional[Iterable[str]]) -> str:
    """JSON-encode a permission set for storage."""
    return json.dumps(normalize_permissions(perms))


def resolve_permissions(role: str, explicit: Optional[Iterable[str]]) -> List[str]:
    """
    The effective permissions for a participant: an explicit override if provided,
    otherwise the role default. `speak` is reconciled with can_speak by callers.
    """
    if explicit is not None:
        return normalize_permissions(explicit)
    return normalize_permissions(default_permissions_for_role(role))
