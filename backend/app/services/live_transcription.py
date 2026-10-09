"""
Live, speaker-attributed transcription for a running meeting.

A worker joins the LiveKit room as a hidden participant, subscribes to **each
participant's microphone separately**, and transcribes short chunks locally with
faster-whisper. Every line is written to `meeting_transcript_segments` with the
speaker's name, so the organizer can read who said what while the meeting runs.

Why per-track rather than transcribing the recording: LiveKit delivers each
participant's microphone as its own audio track, so attribution is free and
exact. Egress mixes everyone into one stream, which is why the post-recording
transcript can never say who spoke.

Design notes
------------
* One worker per meeting, in a daemon thread with its own asyncio loop and its
  own DB session — it outlives the request that started it.
* Audio is requested from LiveKit already at 16 kHz mono, which is what Whisper
  wants, so there is no resampling step.
* Chunking is energy-gated: a speaker's buffer is transcribed when they go quiet
  (end of utterance) or when the buffer reaches MAX_CHUNK_SECONDS. Transcribing
  fixed windows instead would cut words in half and produce worse text.
* Silence never reaches Whisper — it invents filler on quiet audio, which is how
  "Silence. Silence." ended up in an earlier transcript.
"""
import array
import asyncio
import logging
import math
import os
import tempfile
import threading
import time
import wave
from typing import Dict, Optional

log = logging.getLogger(__name__)

SAMPLE_RATE = 16000
# Speech quieter than this (mean absolute amplitude, 16-bit) is treated as
# silence. Low enough to catch a soft speaker, high enough to ignore room noise.
SILENCE_RMS = 300
# End an utterance after this much continuous quiet.
SILENCE_HOLD_SECONDS = 0.9
# Never let a buffer grow past this — a monologue still produces regular lines.
MAX_CHUNK_SECONDS = 18.0
# Ignore blips: a chunk shorter than this is almost always a cough or a click.
MIN_CHUNK_SECONDS = 0.7

# meeting_id -> worker
_workers: Dict[int, "LiveTranscriber"] = {}
_lock = threading.Lock()


def _rms(samples: array.array) -> float:
    if not samples:
        return 0.0
    return math.sqrt(sum(s * s for s in samples) / len(samples))


class LiveTranscriber:
    """Transcribes one meeting until stopped."""

    def __init__(self, meeting_id: int, room_name: str, url: str, token: str):
        self.meeting_id = meeting_id
        self.room_name = room_name
        self.url = url
        self.token = token
        self.started_at = time.time()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.error: Optional[str] = None
        # Guards the shared Whisper model — faster-whisper is not thread-safe and
        # several speakers can finish an utterance at the same moment.
        self._model_lock = threading.Lock()

    # ── lifecycle ────────────────────────────────────────────────────────────
    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name=f"livetx-{self.meeting_id}", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive()) and not self._stop.is_set()

    # ── worker ───────────────────────────────────────────────────────────────
    def _run(self) -> None:
        try:
            asyncio.run(self._main())
        except Exception as e:                                # noqa: BLE001
            self.error = str(e)
            log.exception("live transcription failed for meeting %s", self.meeting_id)
        finally:
            with _lock:
                if _workers.get(self.meeting_id) is self:
                    _workers.pop(self.meeting_id, None)

    async def _main(self) -> None:
        from livekit import rtc

        room = rtc.Room()
        tasks = set()

        @room.on("track_subscribed")
        def _on_track(track, publication, participant):
            if track.kind != rtc.TrackKind.KIND_AUDIO:
                return
            # Never transcribe the recorder or ourselves.
            if (participant.identity or "").startswith(("EG_", "livetx-")):
                return
            t = asyncio.create_task(self._consume(rtc, track, participant))
            tasks.add(t)
            t.add_done_callback(tasks.discard)

        await room.connect(self.url, self.token, rtc.RoomOptions(auto_subscribe=True))
        log.info("live transcription joined %s", self.room_name)

        # Tracks published before we joined don't fire track_subscribed.
        for p in room.remote_participants.values():
            for pub in p.track_publications.values():
                if pub.track and pub.track.kind == rtc.TrackKind.KIND_AUDIO:
                    t = asyncio.create_task(self._consume(rtc, pub.track, p))
                    tasks.add(t)
                    t.add_done_callback(tasks.discard)

        while not self._stop.is_set():
            await asyncio.sleep(0.4)

        for t in list(tasks):
            t.cancel()
        await room.disconnect()
        log.info("live transcription left %s", self.room_name)

    async def _consume(self, rtc, track, participant) -> None:
        """Buffer one participant's audio and emit a segment per utterance."""
        identity = participant.identity
        name = participant.name or identity
        stream = rtc.AudioStream(track, sample_rate=SAMPLE_RATE, num_channels=1)

        buf = array.array("h")
        quiet_for = 0.0
        speech_seen = False

        try:
            async for ev in stream:
                if self._stop.is_set():
                    break
                frame = ev.frame
                samples = array.array("h")
                # frame.data is a memoryview of int16 samples, not bytes —
                # frombytes needs a real bytes-like, so convert explicitly.
                samples.frombytes(bytes(frame.data))
                dur = frame.samples_per_channel / float(frame.sample_rate or SAMPLE_RATE)

                if _rms(samples) >= SILENCE_RMS:
                    buf.extend(samples)
                    quiet_for = 0.0
                    speech_seen = True
                elif speech_seen:
                    # Keep a little trailing quiet so words aren't clipped.
                    buf.extend(samples)
                    quiet_for += dur

                secs = len(buf) / float(SAMPLE_RATE)
                if speech_seen and (quiet_for >= SILENCE_HOLD_SECONDS or secs >= MAX_CHUNK_SECONDS):
                    chunk, buf = buf, array.array("h")
                    quiet_for, speech_seen = 0.0, False
                    if len(chunk) / float(SAMPLE_RATE) >= MIN_CHUNK_SECONDS:
                        # Off the event loop: Whisper is CPU-bound and would
                        # otherwise stall audio consumption for every speaker.
                        asyncio.get_running_loop().run_in_executor(
                            None, self._emit, chunk, identity, name)
        except asyncio.CancelledError:
            pass
        except Exception:                                     # noqa: BLE001
            log.exception("audio consumer failed for %s", identity)

    def _emit(self, chunk: array.array, identity: str, name: str) -> None:
        """Transcribe one utterance and store it. Never raises."""
        path = None
        try:
            fd, path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)
            with wave.open(path, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(SAMPLE_RATE)
                w.writeframes(chunk.tobytes())

            from app.services import transcription_service as ts
            from app.core.config import settings

            with self._model_lock:
                model = ts._local_model(settings.TRANSCRIBE_MODEL or "small")
                segments, _ = model.transcribe(
                    path, language=settings.TRANSCRIBE_LANGUAGE or None, vad_filter=True)
                text = " ".join(s.text.strip() for s in segments).strip()

            if not text or ts._is_silence(text):
                return

            from app.core.database import SessionLocal
            from app.models.meeting_transcript_segment import MeetingTranscriptSegment
            db = SessionLocal()
            try:
                db.add(MeetingTranscriptSegment(
                    meeting_id=self.meeting_id,
                    speaker_identity=identity,
                    speaker_name=name,
                    text=text,
                    offset_seconds=round(time.time() - self.started_at, 2),
                ))
                db.commit()
            finally:
                db.close()
        except Exception:                                     # noqa: BLE001
            log.exception("could not store live segment for %s", identity)
        finally:
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass


# ── module API ───────────────────────────────────────────────────────────────

def is_running(meeting_id: int) -> bool:
    with _lock:
        w = _workers.get(meeting_id)
    return bool(w and w.running)


def start(meeting_id: int, room_name: str, url: str, token: str) -> bool:
    """Returns False if one was already running."""
    with _lock:
        existing = _workers.get(meeting_id)
        if existing and existing.running:
            return False
        w = LiveTranscriber(meeting_id, room_name, url, token)
        _workers[meeting_id] = w
    w.start()
    return True


def stop(meeting_id: int) -> bool:
    with _lock:
        w = _workers.get(meeting_id)
    if not w:
        return False
    w.stop()
    return True
