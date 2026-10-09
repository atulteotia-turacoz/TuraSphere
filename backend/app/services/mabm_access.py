"""
MABM (Medical Advisory Board Meeting) authorization helpers.

Translates a user's MABM role assignments into a set of capability slugs that
endpoint handlers can check via `user_has_mabm_capability(...)`. This sits on
top of the existing platform roles (super_admin/admin/user) — those are still
the primary gate; MABM caps grant additional access for module-specific tasks
like editing transcripts or managing documents on meetings the user didn't
organize.

Capability slugs (Phase 2 scope):
  - boards.manage       — full CRUD on advisory_boards
  - meetings.manage     — full CRUD on board_meetings (+ start/end + agenda + participants)
  - documents.manage    — full CRUD on meeting_documents
  - transcripts.manage  — create/edit/finalize meeting transcripts
  - minutes.manage      — minutes-of-meeting workflow (Phase 5)
  - manuscripts.manage  — manuscript pipeline (Phase 5)

Defaults per MABM role (overridable for sub_admin via the permissions JSON):
  - super_admin    : all capabilities (sentinel '*')
  - sub_admin      : exactly what's listed in mabm_role_assignments.permissions
  - medical_writer : documents + transcripts + minutes + manuscripts
  - turacoz_team   : boards + meetings + documents + transcripts
"""
import json
from typing import Set
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.mabm_role import MABMRoleAssignment, MABMRole


ALL_CAPABILITIES: Set[str] = {
    "boards.manage",
    "meetings.manage",
    "documents.manage",
    "transcripts.manage",
    "minutes.manage",
    "manuscripts.manage",
}

MEDICAL_WRITER_DEFAULTS: Set[str] = {
    # Medical writers & project managers manage projects end-to-end:
    "boards.manage",
    "meetings.manage",
    "documents.manage",
    "transcripts.manage",
    "minutes.manage",
    "manuscripts.manage",
}

TURACOZ_TEAM_DEFAULTS: Set[str] = {
    "boards.manage",
    "meetings.manage",
    "documents.manage",
    "transcripts.manage",
}


def _parse_perms(raw):
    if not raw:
        return []
    if isinstance(raw, list):
        return raw
    try:
        v = json.loads(raw)
        return v if isinstance(v, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def get_user_mabm_capabilities(user: User, db: Session) -> Set[str]:
    """Returns the set of MABM capability slugs the user holds via active assignments."""
    if user is None:
        return set()
    rows = db.query(MABMRoleAssignment).filter(
        MABMRoleAssignment.user_id == user.id,
        MABMRoleAssignment.is_active.is_(True),
    ).all()
    if not rows:
        return set()

    caps: Set[str] = set()
    for ra in rows:
        role = ra.role.value if hasattr(ra.role, "value") else ra.role
        if role == MABMRole.super_admin.value:
            return set(ALL_CAPABILITIES)  # short-circuit — super_admin has everything
        elif role == MABMRole.medical_writer.value:
            caps |= MEDICAL_WRITER_DEFAULTS
        elif role == MABMRole.turacoz_team.value:
            caps |= TURACOZ_TEAM_DEFAULTS
        elif role == MABMRole.sub_admin.value:
            caps |= set(_parse_perms(ra.permissions))
    return caps


def user_has_mabm_capability(user: User, db: Session, capability: str) -> bool:
    """True if the user has the given capability via any active MABM role assignment."""
    return capability in get_user_mabm_capabilities(user, db)


def user_is_mabm_super_admin(user: User, db: Session) -> bool:
    """True if the user has an active MABM super_admin role assignment."""
    if user is None:
        return False
    return db.query(MABMRoleAssignment).filter(
        MABMRoleAssignment.user_id == user.id,
        MABMRoleAssignment.role == MABMRole.super_admin.value,
        MABMRoleAssignment.is_active.is_(True),
    ).first() is not None
