"""
In-browser previews for shared documents.

The client portal only offered Download, so approving a deck meant saving it,
opening it in Office and coming back — and on a phone, often not at all.

What a browser can already render, we serve as-is (PDF, images, plain text).
Everything else — .doc/.docx/.ppt/.pptx/.xls/.xlsx — is converted to PDF with
LibreOffice, which is already a deployment dependency (see `deploy.sh`: it is
installed for reading legacy CVs, and `cv_parser._convert_via_soffice` uses it
the same way).

Conversions are CACHED under `<UPLOAD_DIR>/previews/`, keyed by the source path,
its size and its mtime — a 10 MB deck takes seconds to convert, and the client
flips between documents. A changed source file produces a new key, so a stale
preview can never be served.

Poppler is NOT needed: the PDF goes straight into an <iframe>, so nothing has to
be rasterised.
"""
import hashlib
import logging
import os
import shutil
import subprocess
import tempfile
from typing import Optional, Tuple

from app.core.config import settings

logger = logging.getLogger(__name__)

# Rendered by the browser directly — no conversion.
NATIVE_PDF_EXT = {".pdf"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
TEXT_EXT = {".txt", ".csv"}

# LibreOffice converts these to PDF.
OFFICE_EXT = {".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".odt", ".odp", ".ods", ".rtf"}

IMAGE_MIME = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp",
}
TEXT_MIME = {".txt": "text/plain; charset=utf-8", ".csv": "text/plain; charset=utf-8"}

# A big deck is slow to convert; a stuck soffice must not hold a worker forever.
CONVERT_TIMEOUT_SECONDS = 180


class PreviewError(RuntimeError):
    """Preview is not possible — the message is written for the reader."""


def can_preview(file_path: str) -> bool:
    ext = os.path.splitext(file_path or "")[1].lower()
    return ext in NATIVE_PDF_EXT | IMAGE_EXT | TEXT_EXT | OFFICE_EXT


def preview_kind(file_path: str) -> Optional[str]:
    """'pdf' | 'image' | 'text' | None — what the client should render."""
    ext = os.path.splitext(file_path or "")[1].lower()
    if ext in NATIVE_PDF_EXT or ext in OFFICE_EXT:
        return "pdf"
    if ext in IMAGE_EXT:
        return "image"
    if ext in TEXT_EXT:
        return "text"
    return None


def _soffice_binary() -> Optional[str]:
    """LibreOffice's CLI, or None when it isn't installed."""
    for candidate in ("soffice", "libreoffice"):
        path = shutil.which(candidate)
        if path:
            return path
    return None


def _cache_dir() -> str:
    root = settings.UPLOAD_DIR if os.path.isabs(settings.UPLOAD_DIR) \
        else os.path.join(os.getcwd(), settings.UPLOAD_DIR)
    path = os.path.join(root, "previews")
    os.makedirs(path, exist_ok=True)
    return path


def _cache_path(src: str) -> str:
    st = os.stat(src)
    key = f"{os.path.realpath(src)}|{st.st_size}|{int(st.st_mtime)}"
    return os.path.join(_cache_dir(), hashlib.sha1(key.encode()).hexdigest() + ".pdf")


def _convert_to_pdf(src: str) -> str:
    """Convert an Office file to PDF and return the cached PDF's path."""
    cached = _cache_path(src)
    if os.path.isfile(cached) and os.path.getsize(cached) > 0:
        return cached

    binary = _soffice_binary()
    if not binary:
        raise PreviewError(
            "This file type can't be previewed on this server yet. Download it instead."
        )

    with tempfile.TemporaryDirectory() as outdir:
        try:
            proc = subprocess.run(
                # -env:UserInstallation gives each conversion its own profile, so
                # two at once don't fight over ~/.config/libreoffice and hang.
                [binary, f"-env:UserInstallation=file://{outdir}/profile",
                 "--headless", "--convert-to", "pdf", "--outdir", outdir, src],
                capture_output=True, timeout=CONVERT_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            raise PreviewError("This document took too long to prepare. Download it instead.")
        except OSError as e:                                  # noqa: BLE001
            logger.warning("LibreOffice could not be run: %s", e)
            raise PreviewError("Preview isn't available right now. Download the file instead.")

        produced = os.path.join(outdir, os.path.splitext(os.path.basename(src))[0] + ".pdf")
        if not os.path.isfile(produced):
            logger.warning("LibreOffice produced no PDF for %s: %s", src, proc.stderr[-400:])
            raise PreviewError("This document could not be prepared for preview. Download it instead.")
        # Move into the cache only once it is complete, so a crash mid-convert
        # cannot leave a truncated PDF that would be served forever after.
        shutil.move(produced, cached)
    return cached


def discard(file_path: str) -> bool:
    """Drop the cached PDF for a source file. Call this when the source is
    deleted, or its converted copy would sit in `<UPLOAD_DIR>/previews/` forever
    — invisible, and growing by a megabyte or two per deleted deck.

    Best-effort: the cache key needs the source file's size and mtime, so this
    must run BEFORE the source is removed. Returns True if a cached file went.
    """
    try:
        cached = _cache_path(file_path)
    except OSError:
        return False                                   # source already gone
    try:
        os.remove(cached)
        return True
    except FileNotFoundError:
        return False
    except OSError as e:                               # noqa: BLE001
        logger.warning("Could not remove cached preview %s: %s", cached, e)
        return False


def prepare(file_path: str, mime_type: Optional[str] = None) -> Tuple[str, str]:
    """(path_to_serve, media_type) for an inline preview.

    Raises PreviewError with a reader-facing message when the file cannot be
    previewed — the caller turns that into a 415.
    """
    if not file_path or not os.path.isfile(file_path):
        raise PreviewError("The file is missing on the server.")

    ext = os.path.splitext(file_path)[1].lower()
    if ext in NATIVE_PDF_EXT:
        return file_path, "application/pdf"
    if ext in IMAGE_EXT:
        return file_path, IMAGE_MIME.get(ext, mime_type or "application/octet-stream")
    if ext in TEXT_EXT:
        return file_path, TEXT_MIME[ext]
    if ext in OFFICE_EXT:
        return _convert_to_pdf(file_path), "application/pdf"

    raise PreviewError(
        f"{ext or 'This file'} can't be previewed in the browser. Download it instead."
    )
