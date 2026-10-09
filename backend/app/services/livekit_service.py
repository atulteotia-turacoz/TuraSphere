"""
LiveKit — self-hosted SFU used when a meeting's provider is `livekit`.

Why this exists alongside Zoom: Zoom's Meeting SDK renders *its* UI and gates
recording behind the customer's Zoom plan (a Basic/free account has no cloud
recording at all, so no Record button can ever appear). With LiveKit we own the
UI and the recording, so an account with no paid Zoom still gets a full meeting.
Install and isolation notes live in `livekit.md` at the repo root.

**Sync on purpose.** TuraQuant's endpoints are sync `def`, so this module is too.
Token minting is pure local JWT signing and needs no loop at all. The room and
egress calls are async in `livekit-api`, so they go through `_run()`, which also
constructs `LiveKitAPI` *inside* the loop — its aiohttp session requires a
running loop at construction time.
"""
import asyncio
import json
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

# Optional dependency. LiveKit is one of three providers, so a missing
# `livekit-api` must NOT stop the whole API from booting — that would take
# advisory boards, surveys and Zoom meetings down with it. Import failure is
# recorded and raised only when a LiveKit route is actually called.
try:
    from livekit import api
    _IMPORT_ERROR = None
except ImportError as e:                                     # pragma: no cover
    api = None
    _IMPORT_ERROR = e

from app.core import crypto
from app.core.config import settings
from app.models.meeting import BoardMeeting
from app.models.meeting_provider import MeetingProviderConfig, MeetingProvider


class LiveKitNotConfigured(RuntimeError):
    """No usable URL/key/secret, or the SDK isn't installed.

    Callers already turn this into a 400 with the message shown to the user, so
    the missing-package case lands there too rather than as a 500.
    """


def _require_sdk() -> None:
    if api is None:
        raise LiveKitNotConfigured(
            "LiveKit support isn't installed on this server. Run "
            f"`pip install livekit-api==0.8.2` and restart the API. ({_IMPORT_ERROR})"
        )


# Egress writes inside its container; docker-compose maps this to
# backend/uploads/meetings/livekit on the host. The path the API sends must be
# the CONTAINER path, not the host one.
EGRESS_CONTAINER_DIR = "/out"
EGRESS_HOST_SUBDIR = os.path.join("meetings", "livekit")

# The compose bind-mount is `./backend/uploads/meetings/livekit:/out`, i.e. it is
# fixed relative to the repo — it does NOT follow UPLOAD_DIR. On the live server
# UPLOAD_DIR is /var/www/turaquant/uploads, so egress wrote the MP4 into
# backend/uploads/… while the API looked in uploads/…: the row appeared in the
# Post-meeting list but Play said "file is missing". Look in both places.
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EGRESS_COMPOSE_HOST_DIR = os.path.join(_BACKEND_ROOT, "uploads", EGRESS_HOST_SUBDIR)


def egress_host_dirs() -> list:
    """Every host directory an egress MP4 may be in, preferred first.

    1. EGRESS_HOST_DIR — the real /out bind mount, when configured;
    2. UPLOAD_DIR itself, when it already IS the egress folder
       (".../uploads/meetings/livekit") — appending meetings/livekit again gave
       ".../meetings/livekit/meetings/livekit/<file>" (seen on the live server);
    3. UPLOAD_DIR/meetings/livekit;
    4. backend/uploads/meetings/livekit — the compose mount, relative to the repo.
    """
    upload_root = settings.UPLOAD_DIR if os.path.isabs(settings.UPLOAD_DIR) \
        else os.path.join(os.getcwd(), settings.UPLOAD_DIR)
    upload_root = os.path.realpath(upload_root)
    candidates = []
    if settings.EGRESS_HOST_DIR:
        candidates.append(settings.EGRESS_HOST_DIR)
    if upload_root.rstrip(os.sep).endswith(EGRESS_HOST_SUBDIR):
        candidates.append(upload_root)
    candidates += [os.path.join(upload_root, EGRESS_HOST_SUBDIR), EGRESS_COMPOSE_HOST_DIR]
    dirs = []
    for d in candidates:
        d = os.path.realpath(d)
        if d not in dirs:
            dirs.append(d)
    return dirs


def recording_host_path(filename: str) -> str:
    """Where a recording file is (or will be) on this host: the first egress
    folder that already has it, else the preferred one."""
    for d in egress_host_dirs():
        if os.path.isfile(os.path.join(d, filename)):
            return os.path.join(d, filename)
    return os.path.join(egress_host_dirs()[0], filename)


def egress_status_for_file(db: Session, meeting: BoardMeeting, filename: str, owner_user_id=None) -> Optional[dict]:
    """What LiveKit says happened to the recording that should have produced
    `filename`: {"status": "EGRESS_COMPLETE" | "EGRESS_FAILED" | …, "error": …}.
    None when LiveKit can't be asked or doesn't know it."""
    try:
        res = _api_call(db, owner_user_id, lambda lk: lk.egress.list_egress(
            api.ListEgressRequest(room_name=room_name(meeting))))
    except Exception:  # noqa: BLE001 - diagnostics only
        return None
    for e in res.items:
        names = {os.path.basename(f.filename or "") for f in (getattr(e, "file_results", []) or [])}
        if filename in names or filename in str(e):
            try:
                status = api.EgressStatus.Name(e.status)
            except Exception:  # noqa: BLE001
                status = str(e.status)
            return {"status": status, "error": getattr(e, "error", "") or ""}
    return None


def missing_recording_detail(stored: str, egress: Optional[dict] = None) -> str:
    """A message that says WHY a recording file can't be found, not just that."""
    name = os.path.basename(stored or "")
    dirs = ", ".join(egress_host_dirs())
    if egress and egress.get("status") == "EGRESS_FAILED":
        err = egress.get("error") or "no reason given"
        low = err.lower()
        if "permission denied" in low:
            hint = ("The recorder isn't allowed to write to its output folder. Make that folder "
                    "writable for the egress container's user, then record again.")
        elif "no such file or directory" in low and "/out" in low:
            hint = ("The recorder's output folder was deleted or replaced after the egress container "
                    "started, so it is writing into a folder that no longer exists. Restart the egress "
                    "container (docker restart <egress>) so it re-attaches, then record again.")
        else:
            hint = "Check the egress container (bash infra/egress-diag.sh)."
        return f"The recording failed on the LiveKit server, so no file was written: {err}. {hint}"
    if egress and egress.get("status") in ("EGRESS_STARTING", "EGRESS_ACTIVE", "EGRESS_ENDING"):
        return "The recording is still being written. Give it a few seconds and try again."
    done = egress and egress.get("status") == "EGRESS_COMPLETE"
    return ((f"LiveKit finished the recording, but {name} isn't in any folder this server checks "
             if done else f"The recording file {name} isn't in any folder this server checks ")
            + f"({dirs}). Set EGRESS_HOST_DIR in backend/.env to the host folder mounted at the "
              "egress container's /out (docker inspect, or bash infra/egress-diag.sh), then restart the API.")


def locate_recording_file(stored: str) -> str:
    """Absolute path of a stored recording, falling back to the egress dirs.

    Returns the stored path (made absolute) when the file isn't found anywhere,
    so callers keep their existing "missing" handling.
    """
    path = stored if os.path.isabs(stored) else os.path.join(os.getcwd(), stored)
    if os.path.isfile(path):
        return path
    name = os.path.basename(stored)
    if name:
        for d in egress_host_dirs():
            candidate = os.path.join(d, name)
            if os.path.isfile(candidate):
                return candidate
    return path


@dataclass
class LiveKitCredentials:
    url: str          # ws:// or wss:// — what the BROWSER connects to
    api_key: str
    api_secret: str

    @property
    def http_url(self) -> str:
        """Server-side REST base. The SDK talks HTTP even though clients use WS."""
        return self.url.replace("wss://", "https://").replace("ws://", "http://")


def get_credentials(db: Session, owner_user_id: Optional[int]) -> LiveKitCredentials:
    """Account's own LiveKit row, else the platform default from settings.

    Mirrors the Zoom/Teams resolution order, so a customer can point their
    meetings at their own LiveKit deployment without a code change.
    """
    row = None
    if owner_user_id is not None:
        row = db.query(MeetingProviderConfig).filter(
            MeetingProviderConfig.owner_user_id == owner_user_id,
            MeetingProviderConfig.provider == MeetingProvider.livekit.value,
            MeetingProviderConfig.is_active == True,   # noqa: E712
        ).first()

    if row and row.client_id and row.client_secret:
        # Reuses the generic provider columns rather than adding LiveKit-specific
        # ones: client_id = API key, client_secret = API secret (encrypted at
        # rest by app.core.crypto, same as the Zoom/Teams secrets), tenant_id =
        # the ws:// URL.
        return LiveKitCredentials(
            url=row.tenant_id or settings.LIVEKIT_URL,
            api_key=row.client_id,
            api_secret=crypto.decrypt(row.client_secret),
        )

    if not (settings.LIVEKIT_URL and settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_SECRET):
        raise LiveKitNotConfigured(
            "LiveKit isn't configured. Set LIVEKIT_URL, LIVEKIT_API_KEY and "
            "LIVEKIT_API_SECRET, or add a LiveKit row under Account → Meeting Platforms."
        )
    return LiveKitCredentials(
        url=settings.LIVEKIT_URL,
        api_key=settings.LIVEKIT_API_KEY,
        api_secret=settings.LIVEKIT_API_SECRET,
    )


def room_name(meeting: BoardMeeting) -> str:
    """Derived, not stored — no column, no migration, no drift.

    The `tq-` prefix keeps TuraQuant rooms distinct from TuraClickMeet's
    `event-{slug}` even if the two ever share a server, and makes either
    product's LiveKit logs unambiguous.

    LIVEKIT_ROOM_PREFIX is prepended on top of that: dev and production share one
    LiveKit server, and meeting ids collide across the two databases, so without
    it a local test of meeting 14 lands in the live board's room. Empty in
    production — live names stay `tq-meeting-{id}`.
    """
    return f"{settings.LIVEKIT_ROOM_PREFIX}tq-meeting-{meeting.id}"


# Return annotation is a STRING on purpose: a real `api.VideoGrants` annotation is
# evaluated at import time and would raise AttributeError when the SDK is absent,
# defeating the optional-import above.
def build_grants(room: str, *, is_organizer: bool, can_speak: bool,
                 can_present: bool) -> "api.VideoGrants":
    """Permissions are decided here, server-side, and signed into the token — a
    client cannot grant itself more by editing anything.

    `room_record` is organizer-only, matching the rule enforced on recordings and
    transcripts in endpoints/meeting_transcripts.py.
    """
    sources = []
    if is_organizer or can_speak:
        sources.extend(["microphone", "camera"])
    if is_organizer or can_present:
        sources.extend(["screen_share", "screen_share_audio"])

    return api.VideoGrants(
        room_join=True,
        room=room,
        room_admin=is_organizer,      # mute others, remove participants
        room_record=is_organizer,     # only the organizer may start a recording
        can_publish=bool(sources),    # observers subscribe only
        can_subscribe=True,
        can_publish_data=True,
        can_publish_sources=sources,
        can_update_own_metadata=False,  # role rides in metadata; clients must not forge it
    )


def create_join_token(
    db: Session,
    meeting: BoardMeeting,
    *,
    identity: str,
    display_name: str,
    role: str,
    is_organizer: bool,
    can_speak: bool = True,
    can_present: bool = False,
    owner_user_id: Optional[int] = None,
    ttl_seconds: int = 6 * 3600,
) -> tuple[str, str]:
    """Returns (jwt, websocket_url). Pure local signing — no network call."""
    _require_sdk()
    creds = get_credentials(db, owner_user_id)
    room = room_name(meeting)
    token = (
        api.AccessToken(creds.api_key, creds.api_secret)
        .with_identity(identity)
        .with_name(display_name or "Guest")
        .with_metadata(json.dumps({"role": role, "meeting_id": meeting.id}))
        .with_attributes({"role": role})
        .with_grants(build_grants(room, is_organizer=is_organizer,
                                  can_speak=can_speak, can_present=can_present))
        .with_ttl(timedelta(seconds=ttl_seconds))
        .to_jwt()
    )
    return token, creds.url


# ── async bridge ─────────────────────────────────────────────────────────────

def _run(factory):
    """Run one LiveKit REST call from sync code.

    `factory` takes the LiveKitAPI and returns a coroutine. The client is built
    inside the loop because its aiohttp session needs a running one, and closed
    afterwards so we don't leak sessions across requests.
    """
    async def _main(creds: LiveKitCredentials):
        lk = api.LiveKitAPI(creds.http_url, creds.api_key, creds.api_secret)
        try:
            return await factory(lk)
        finally:
            await lk.aclose()

    def _call(creds):
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(_main(creds))
        # Already inside a loop (async caller): run in a private one off-thread.
        with ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, _main(creds)).result()

    return _call


def _api_call(db: Session, owner_user_id: Optional[int], factory):
    _require_sdk()
    creds = get_credentials(db, owner_user_id)
    return _run(factory)(creds)


# ── room + participant control ───────────────────────────────────────────────

def list_participants(db: Session, meeting: BoardMeeting, owner_user_id=None) -> list:
    res = _api_call(db, owner_user_id, lambda lk: lk.room.list_participants(
        api.ListParticipantsRequest(room=room_name(meeting))))
    return list(res.participants)


def remove_participant(db: Session, meeting: BoardMeeting, identity: str, owner_user_id=None) -> None:
    _api_call(db, owner_user_id, lambda lk: lk.room.remove_participant(
        api.RoomParticipantIdentity(room=room_name(meeting), identity=identity)))


def mute_participant(db: Session, meeting: BoardMeeting, identity: str, track_sid: str,
                     muted: bool = True, owner_user_id=None) -> None:
    _api_call(db, owner_user_id, lambda lk: lk.room.mute_published_track(
        api.MuteRoomTrackRequest(room=room_name(meeting), identity=identity,
                                 track_sid=track_sid, muted=muted)))


# ── recording (egress) ───────────────────────────────────────────────────────

def recording_filename(meeting: BoardMeeting, started_at: datetime) -> str:
    return f"{room_name(meeting)}-{started_at:%Y%m%d-%H%M%S}.mp4"


def start_recording(db: Session, meeting: BoardMeeting, owner_user_id=None) -> tuple[str, str]:
    """Starts a room-composite recording. Returns (egress_id, host_file_path).

    Egress joins as a hidden participant and writes the MP4 itself, so this
    returns as soon as the job is accepted — the file only exists once the
    recording stops.
    """
    started = datetime.utcnow()
    filename = recording_filename(meeting, started)
    req = api.RoomCompositeEgressRequest(
        room_name=room_name(meeting),
        # Without an explicit layout, egress falls back to its default, which
        # follows the active speaker — so a board meeting recording showed one
        # person at a time. "grid" tiles everyone who is publishing, and LiveKit's
        # template draws each participant's name on their tile, so the recording
        # shows who is in the room and who is talking.
        #
        # NOTE: the grid only contains people who actually PUBLISH. A participant
        # without the `speak` permission publishes nothing, so they cannot appear
        # in the recording and their audio cannot be captured — that is a meeting
        # permission, not an egress setting.
        layout="grid",
        # Our own layout (app/static/egress_template.html), so the MP4 matches
        # what people saw: initials avatars for camera-off participants, name
        # labels, mic state, speaker ring. LiveKit's stock template composites
        # published VIDEO only, so anyone with their camera off was missing from
        # the recording altogether. Blank falls back to the stock template.
        custom_base_url=settings.EGRESS_TEMPLATE_BASE_URL or "",
        file_outputs=[api.EncodedFileOutput(
            file_type=api.EncodedFileType.MP4,
            filepath=f"{EGRESS_CONTAINER_DIR}/{filename}",
        )],
    )
    info = _api_call(db, owner_user_id, lambda lk: lk.egress.start_room_composite_egress(req))
    host_path = recording_host_path(filename)
    return info.egress_id, host_path


def stop_recording(db: Session, egress_id: str, owner_user_id=None):
    return _api_call(db, owner_user_id, lambda lk: lk.egress.stop_egress(
        api.StopEgressRequest(egress_id=egress_id)))


def active_egress_for_room(db: Session, meeting: BoardMeeting, owner_user_id=None) -> Optional[str]:
    """egress_id of a recording still running for this room, else None."""
    info = active_egress_info(db, meeting, owner_user_id)
    return info[0] if info else None


def active_egress_info(db: Session, meeting: BoardMeeting, owner_user_id=None):
    """(egress_id, started_at_epoch_seconds) for a running recording, else None.

    The start time comes from LiveKit rather than the browser so the organizer's
    elapsed timer survives a page reload — a client-side stopwatch would restart
    from zero while the recording kept running. LiveKit reports `started_at` in
    **nanoseconds**; it is 0 until the egress actually begins, in which case we
    fall back to `updated_at` rather than reporting 1970.
    """
    res = _api_call(db, owner_user_id, lambda lk: lk.egress.list_egress(
        api.ListEgressRequest(room_name=room_name(meeting), active=True)))
    items = list(res.items)
    if not items:
        return None
    e = items[0]
    ns = getattr(e, "started_at", 0) or getattr(e, "updated_at", 0) or 0
    return e.egress_id, (int(ns) // 1_000_000_000 if ns else None)


def completed_egress_files(db: Session, meeting: BoardMeeting, owner_user_id=None) -> list:
    """Host paths of FINISHED recordings for this room, per LiveKit.

    Egress stops on its own when the room empties ("Source closed"), so a
    recording can complete without anyone pressing Stop — and then no
    MeetingRecording row is written and the file is invisible in the UI. This
    lists what LiveKit actually produced so those can be reconciled.
    """
    res = _api_call(db, owner_user_id, lambda lk: lk.egress.list_egress(
        api.ListEgressRequest(room_name=room_name(meeting))))
    out = []
    for e in res.items:
        for f in getattr(e, "file_results", []) or []:
            name = os.path.basename(f.filename or "")
            if not name:
                continue
            out.append({
                "egress_id": e.egress_id,
                "filename": name,
                "host_path": recording_host_path(name),
                "duration_seconds": int((getattr(f, "duration", 0) or 0) / 1_000_000_000) or None,
                "started_at": (int(getattr(e, "started_at", 0) or 0) // 1_000_000_000) or None,
            })
    return out


def test_connection(db: Session, owner_user_id=None) -> tuple[bool, str]:
    """Used by Account → Meeting Platforms to prove the config works."""
    try:
        _api_call(db, owner_user_id, lambda lk: lk.room.list_rooms(api.ListRoomsRequest()))
        return True, "Connected to LiveKit."
    except LiveKitNotConfigured as e:
        return False, str(e)
    except Exception as e:                                   # noqa: BLE001
        return False, f"Could not reach LiveKit: {e}"
