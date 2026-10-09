"""Module entitlements.

Two separate ideas that used to be one field:

* ``granted_services``  — what an ADMIN has given the account. NULL means
  "everything", which is how accounts that predate this field are read.
* ``allowed_services``  — which of those the USER has switched on for
  themselves. NULL means "all the granted ones".

The effective set a user actually sees is the intersection. Keeping the two
apart is what stops a user from granting themselves a module: ``PUT /profile``
writes only ``allowed_services``, and it is clamped to the granted set here.
"""
import json
from typing import Optional, List

# Every module the product knows about. A slug not in here cannot be granted,
# so a typo in an admin payload fails closed rather than creating a phantom
# module nothing can serve.
ALL_SERVICES = [
    "advisory_boards",
    "publications",
    "consensus",
    "recent_guidelines",
    "surveys",
    "polling",
    "assessments",
    "assessment_forms",
    # A tab inside Assessments rather than a nav module, but the admin panel has
    # always offered it as a grantable slug and AssessmentsListPage gates on it.
    # Omitting it here would make the backend silently drop a real grant.
    "find_kols",
]

# Roles that bypass entitlements entirely.
PRIVILEGED_ROLES = {"admin", "super_admin"}


def parse_services(raw) -> Optional[List[str]]:
    """JSON text column -> list of slugs, or None for 'unrestricted'."""
    if raw is None:
        return None
    if isinstance(raw, list):
        return [s for s in raw if s in ALL_SERVICES]
    try:
        val = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(val, list):
        return None
    return [s for s in val if s in ALL_SERVICES]


def _role_of(user) -> str:
    role = getattr(user, "role", None)
    return role.value if hasattr(role, "value") else str(role or "")


def granted_for(user) -> List[str]:
    """The services this account is entitled to. Admins get everything."""
    if _role_of(user) in PRIVILEGED_ROLES:
        return list(ALL_SERVICES)
    granted = parse_services(getattr(user, "granted_services", None))
    # NULL = unrestricted, so an account created before this field existed keeps
    # working exactly as it did.
    return list(ALL_SERVICES) if granted is None else granted


def effective_for(user) -> List[str]:
    """What the user actually sees: granted ∩ their own selection."""
    granted = granted_for(user)
    chosen = parse_services(getattr(user, "allowed_services", None))
    if chosen is None:
        return granted
    return [s for s in granted if s in chosen]


def clamp_selection(user, requested) -> List[str]:
    """Reduce a user's requested selection to what they are actually granted.

    Silently dropping the rest rather than erroring: the UI only ever offers
    granted modules, so anything else is either a stale tab or someone calling
    the API by hand — neither deserves a 400, and neither gets the module.
    """
    granted = granted_for(user)
    requested = set(requested) if isinstance(requested, list) else set()
    # Ordered by the GRANT, not by the request, so the stored value is stable
    # whatever order the client sent — and so it matches effective_for().
    return [s for s in granted if s in requested]
