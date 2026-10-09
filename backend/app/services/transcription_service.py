"""
Speech-to-text for meeting recordings.

Why this exists: LiveKit records but does not transcribe. Before this, the only
transcript path in the product was Zoom's cloud auto-transcript, which needs a
paid Zoom plan — the very thing LiveKit was adopted to avoid. So a LiveKit
meeting produced an MP4 and no transcript at all.

Pipeline: MP4/WebM → extract mono 16 kHz audio (ffmpeg) → speech-to-text →
`MeetingTranscript` row in `draft`, which then flows through the existing
edit → finalize workflow untouched.

**Runs LOCALLY by default** (faster-whisper, `TRANSCRIBE_PROVIDER=local`): no API
key, no per-minute cost, and the meeting audio never leaves this server — which
matters when the recording is unpublished trial data and commercial strategy.
`TRANSCRIBE_PROVIDER=openai` switches to hosted Whisper for anyone who prefers it.

**The account's AI switch overrides that setting.** `TRANSCRIBE_PROVIDER` is
global, so on a deployment set to `openai` a meeting belonging to an account with
AI turned off would still have had its audio uploaded to OpenAI — the one door
left open after CV extraction and scoring were closed. `transcribe_file` now
takes `ai_allowed`, and when it is false the local model is used no matter what
the setting says, or the caller is told plainly why no transcript was produced.

**Why audio is extracted rather than passing the video.** Speech models want mono
16 kHz, and the hosted API caps uploads at 25 MB — a real recording here was
28.5 MB and would simply have failed. Stripping video took it to 0.23 MB in 0.2s,
so extraction is both what makes long meetings work and a large saving.

ffmpeg comes from `imageio-ffmpeg`, a pip package bundling a static binary, so
there is no system package to install on the deploy box.
"""
import logging
import os
import subprocess
import tempfile
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.configuration import AIConfiguration

# OpenAI's documented upload cap. We stay under it by extracting audio; this is
# kept as a guard for pathologically long meetings.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024

# Small, cheap and accurate enough for meeting minutes. `whisper-1` is the
# long-standing endpoint and accepts the widest input set.
DEFAULT_MODEL = "whisper-1"


class TranscriptionError(RuntimeError):
    """Anything that stops us producing text — surfaced to the organizer verbatim."""


def _ffmpeg() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as e:                                   # noqa: BLE001
        raise TranscriptionError(
            "Audio extraction needs ffmpeg. Run `pip install imageio-ffmpeg` and restart the API."
        ) from e


def extract_audio(src_path: str) -> str:
    """Mono 16 kHz 32 kbps m4a — what speech models want, and ~1% of the video's size.

    Returns a temp path the caller is responsible for deleting.
    """
    if not os.path.isfile(src_path):
        raise TranscriptionError(f"Recording file not found on the server: {src_path}")

    fd, out = tempfile.mkstemp(suffix=".m4a")
    os.close(fd)
    proc = subprocess.run(
        [_ffmpeg(), "-y", "-i", src_path,
         "-vn",                 # drop video — this is the whole point
         "-ac", "1",            # mono
         "-ar", "16000",        # 16 kHz is the standard STT sample rate
         "-b:a", "32k",
         out],
        capture_output=True, text=True,
    )
    if proc.returncode != 0 or not os.path.isfile(out) or os.path.getsize(out) == 0:
        try:
            os.unlink(out)
        except OSError:
            pass
        tail = (proc.stderr or "").strip().splitlines()[-3:]
        raise TranscriptionError("Could not extract audio from the recording. " + " ".join(tail))
    return out


# ── Local speech-to-text (default) ───────────────────────────────────────────
# Runs faster-whisper on this server: no API key, no per-minute cost, and the
# meeting audio never leaves the machine — which matters when the recording is
# unpublished trial data and commercial strategy.
#
# Model is loaded once and reused; loading is the slow part (seconds), transcribing
# is not. On this hardware `tiny` measured ~20x realtime on CPU, so an hour of
# meeting audio transcribes in a few minutes.
_LOCAL_MODEL = None
_LOCAL_MODEL_NAME = None


def _local_model(size: str):
    global _LOCAL_MODEL, _LOCAL_MODEL_NAME
    if _LOCAL_MODEL is not None and _LOCAL_MODEL_NAME == size:
        return _LOCAL_MODEL
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise TranscriptionError(
            "Local transcription needs faster-whisper. Run `pip install faster-whisper` "
            "and restart the API, or set TRANSCRIBE_PROVIDER=openai."
        ) from e
    # int8 keeps it usable on CPU; the first call downloads the model (~75 MB for
    # `tiny`, ~500 MB for `small`) and caches it under ~/.cache/huggingface.
    _LOCAL_MODEL = WhisperModel(size, device="cpu", compute_type="int8")
    _LOCAL_MODEL_NAME = size
    return _LOCAL_MODEL


def _transcribe_local(audio_path: str) -> Tuple[str, str]:
    size = settings.TRANSCRIBE_MODEL or "small"
    model = _local_model(size)
    segments, _info = model.transcribe(
        audio_path,
        language=settings.TRANSCRIBE_LANGUAGE or None,
        # Voice-activity filtering skips silence, which both speeds things up and
        # stops Whisper inventing filler over quiet stretches.
        vad_filter=True,
    )
    text = " ".join(s.text.strip() for s in segments).strip()
    return text, f"faster-whisper:{size}"


def owner_ai_enabled(db: Session, meeting_id: int) -> bool:
    """Whether the account owning this meeting permits AI.

    A meeting belongs to an advisory board, and the board to the user who
    created it — the same ownership chain the assessment scorer follows. Missing
    links default to allowed, matching `getattr(user, "ai_enabled", True)`
    everywhere else: the switch is opt-out, not opt-in.
    """
    try:
        from app.models.meeting import BoardMeeting
        from app.models.advisory_board import AdvisoryBoard
        from app.models.user import User as _User

        owner_id = (
            db.query(AdvisoryBoard.created_by)
            .join(BoardMeeting, BoardMeeting.board_id == AdvisoryBoard.id)
            .filter(BoardMeeting.id == meeting_id)
            .scalar()
        )
        if not owner_id:
            return True
        owner = db.query(_User).filter(_User.id == owner_id).first()
        return bool(getattr(owner, "ai_enabled", True)) if owner else True
    except Exception:                                    # noqa: BLE001
        # Never let an ownership lookup break transcription itself.
        logging.getLogger(__name__).exception(
            "could not resolve AI permission for meeting %s", meeting_id)
        return True


def _openai_config(db: Session) -> AIConfiguration:
    cfg = db.query(AIConfiguration).filter(
        AIConfiguration.provider == "openai",
        AIConfiguration.is_active == True,          # noqa: E712
    ).order_by(AIConfiguration.is_default.desc()).first()
    if not cfg or not cfg.api_key:
        raise TranscriptionError(
            "No active OpenAI configuration with an API key was found. Add one in "
            "the admin AI settings — transcription uses the same key as the other AI features."
        )
    return cfg


def transcribe_file(db: Session, media_path: str, ai_allowed: bool = True) -> Tuple[str, str]:
    """Transcribe a recording. Returns (text, model_used).

    `ai_allowed` comes from the owning account's switch. When it is false the
    hosted model is not an option, whatever `TRANSCRIBE_PROVIDER` says.

    Raises TranscriptionError with a message meant for the organizer, not a stack
    trace — this is triggered from a button in the meeting workspace.
    """
    audio_path = extract_audio(media_path)
    try:
        # Local by default — no API key, nothing leaves the server. `openai` stays
        # available for anyone who wants the hosted model instead, unless the
        # account has AI off, in which case it is not on the menu.
        use_hosted = (settings.TRANSCRIBE_PROVIDER or "local").lower() == "openai" and ai_allowed
        if not use_hosted:
            try:
                text, model = _transcribe_local(audio_path)
            except TranscriptionError:
                if ai_allowed:
                    raise
                # Re-raise with advice that fits the account: telling someone who
                # must not use AI to "set TRANSCRIBE_PROVIDER=openai" is wrong.
                raise TranscriptionError(
                    "AI is turned off for this account, so the recording can only be "
                    "transcribed by the local speech model — and that is not installed. "
                    "Run `pip install faster-whisper` on the server and restart the API, "
                    "or type the minutes manually."
                ) from None
            if not text:
                raise TranscriptionError(
                    "The transcription came back empty — the recording may have no audible speech."
                )
            if _is_silence(text):
                raise TranscriptionError(
                    "No speech was found in this recording — the transcript would be empty. "
                    "Check that microphones were on and unmuted during the meeting."
                )
            return text, model

        cfg = _openai_config(db)
        size = os.path.getsize(audio_path)
        if size > MAX_UPLOAD_BYTES:
            raise TranscriptionError(
                f"The extracted audio is {size / 1e6:.0f} MB, over the {MAX_UPLOAD_BYTES / 1e6:.0f} MB "
                "limit. Split the recording and transcribe each part."
            )

        from openai import OpenAI
        client = OpenAI(api_key=cfg.api_key, base_url=cfg.api_base_url or None)

        # Optional per-account override. `config_json` is a column on the table
        # but is not mapped on every deployment's model, and may hold a JSON
        # string rather than a dict — so read it defensively and fall back.
        model = None
        raw = getattr(cfg, "config_json", None)
        if isinstance(raw, str) and raw.strip():
            import json
            try:
                raw = json.loads(raw)
            except ValueError:
                raw = None
        if isinstance(raw, dict):
            model = raw.get("transcribe_model")

        with open(audio_path, "rb") as fh:
            result = client.audio.transcriptions.create(
                model=model or DEFAULT_MODEL,
                file=fh,
                response_format="text",
            )
        text = result if isinstance(result, str) else getattr(result, "text", "")
        text = (text or "").strip()
        if not text:
            raise TranscriptionError(
                "The transcription came back empty — the recording may have no audible speech."
            )
        if _is_silence(text):
            # Whisper emits filler like "Silence." / "[BLANK_AUDIO]" / "Thank you."
            # on a track with no speech. Saving that as the meeting transcript
            # would look like a broken result rather than a silent recording.
            raise TranscriptionError(
                "No speech was found in this recording — the transcript would be empty. "
                "Check that microphones were on and unmuted during the meeting."
            )
        return text, (model or DEFAULT_MODEL)
    except TranscriptionError:
        raise
    except Exception as e:                                   # noqa: BLE001
        raise TranscriptionError(f"Transcription failed: {e}") from e
    finally:
        try:
            os.unlink(audio_path)
        except OSError:
            pass


# Whisper's stock output on a track with no speech. Matching is on the whole
# transcript, so a real meeting that happens to contain the word "silence" is
# unaffected — only a transcript made ENTIRELY of these is rejected.
_SILENCE_TOKENS = {
    "silence", "[silence]", "[blank_audio]", "(silence)", "...", ".", "you",
    "thank you", "thanks for watching", "[music]", "(music)", "[no audio]",
}


def _is_silence(text: str) -> bool:
    import re
    # Strip the same punctuation and brackets from both sides of the comparison,
    # so "[BLANK_AUDIO]" matches the bare token.
    def norm(s: str) -> str:
        return s.strip().lower().strip(" .!?[]()")

    known = {norm(t) for t in _SILENCE_TOKENS}
    parts = [norm(p) for p in re.split(r"[.\n]+", text) if p.strip()]
    if not parts:
        return True
    return all(p in known or not p for p in parts)


def transcribe_recording_in_background(recording_id: int, wait_first: float = 8.0) -> None:
    """Transcribe a recording on a worker thread, for the auto-run after Stop.

    Runs detached from the request, with its OWN session — the request's session
    is closed the moment the response is returned. Failures are logged, never
    raised: the organizer already has their recording, and a transcript that
    didn't generate is a "press Generate" situation, not a broken stop.

    `wait_first` exists because egress keeps writing the MP4 for several seconds
    after the stop call returns, so transcribing immediately would read a
    truncated file — or none at all.
    """
    import threading

    def _work():
        import time
        import logging
        log = logging.getLogger(__name__)
        from app.core.database import SessionLocal
        from app.models.meeting_recording import MeetingRecording, MeetingTranscript, TranscriptStatus

        time.sleep(wait_first)
        db = SessionLocal()
        try:
            rec = db.query(MeetingRecording).filter(MeetingRecording.id == recording_id).first()
            if not rec:
                return
            path = resolve_media_path(rec.file_path_or_url)

            # Egress finishes asynchronously; give the file a chance to appear
            # and stop growing before reading it.
            last = -1
            for _ in range(12):                       # up to ~60s
                if not os.path.isfile(path):
                    path = resolve_media_path(rec.file_path_or_url)
                if os.path.isfile(path):
                    size = os.path.getsize(path)
                    if size > 0 and size == last:
                        break
                    last = size
                time.sleep(5)
            else:
                log.warning("auto-transcript: recording %s never settled", recording_id)

            # Resolved here, not passed in: this thread outlives the request
            # and its session, so it must look the owner up on its own.
            text_out, model = transcribe_file(
                db, path, ai_allowed=owner_ai_enabled(db, rec.meeting_id))

            t = db.query(MeetingTranscript).filter(
                MeetingTranscript.recording_id == rec.id).first()
            if t and _enum_value(t.status) in ("finalized", "shared"):
                return                                 # never clobber signed-off text
            if not t:
                t = MeetingTranscript(meeting_id=rec.meeting_id, recording_id=rec.id)
                db.add(t)
            t.raw_text = text_out
            t.status = TranscriptStatus.draft.value
            db.commit()
            log.info("auto-transcript: recording %s transcribed with %s", recording_id, model)
        except TranscriptionError as e:
            # Expected outcomes (silent recording, no API key) — informational.
            logging.getLogger(__name__).info("auto-transcript skipped for %s: %s", recording_id, e)
        except Exception:                                # noqa: BLE001
            logging.getLogger(__name__).exception("auto-transcript failed for %s", recording_id)
        finally:
            db.close()

    threading.Thread(target=_work, name=f"transcribe-{recording_id}", daemon=True).start()


def _enum_value(v):
    return v.value if hasattr(v, "value") else v


def resolve_media_path(stored: Optional[str]) -> str:
    """`file_path_or_url` may be relative to the backend working directory."""
    path = stored or ""
    if not path:
        raise TranscriptionError("This recording has no file on the server.")
    if path.startswith(("http://", "https://")):
        raise TranscriptionError(
            "This recording is hosted by the meeting provider, so it can't be transcribed here. "
            "Use the provider's own transcript instead."
        )
    from app.services.livekit_service import locate_recording_file, missing_recording_detail
    found = locate_recording_file(path)
    if not os.path.isfile(found):
        raise TranscriptionError(missing_recording_detail(path))
    return found
