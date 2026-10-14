from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    PROJECT_NAME: str = "TuraInsights KOL"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"

    DATABASE_URL: str = "mysql+pymysql://atul:Atul%40kumar01@localhost:3306/tura_kol_assessment"
    SECRET_KEY: str = "tura-kol-assessment-secret-key-change-in-production-2024"
    ALGORITHM: str = "HS256"
    # Symmetric key for encrypting stored secrets (SMTP passwords, OAuth client
    # secrets) at rest. Leave empty to derive one from SECRET_KEY. A urlsafe
    # base64 32-byte Fernet key is used as-is; any other string is hashed to one.
    # NOTE: changing this (or SECRET_KEY when this is empty) makes previously
    # encrypted secrets unreadable — re-enter them after a key rotation.
    SECRET_ENCRYPTION_KEY: str = ""
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:3001"

    PUBMED_API_KEY: str = ""
    NCBI_EMAIL: str = ""

    UPLOAD_DIR: str = "uploads"

    # Public base URL of the frontend (used to build links inside emails).
    APP_PUBLIC_URL: str = "http://localhost:3000"

    # Email / SMTP. Leave SMTP_HOST empty for the dev fallback (logs to stdout,
    # still writes an EmailLog row so the workspace history + delivery status work).
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = True
    SMTP_FROM_NAME: str = "TuraQuant Advisory Boards"
    SMTP_FROM_EMAIL: str = "no-reply@turaquant.com"

    # LiveKit — the self-hosted SFU used when a meeting's provider is `livekit`
    # (see livekit.md). This is the PLATFORM DEFAULT, used when an account has no
    # `meeting_provider_config` row of its own; per-account credentials override
    # it, exactly like the Zoom/Teams fallback chain.
    #
    # LIVEKIT_URL is what the BROWSER connects to, so it must be reachable from
    # the client, not from inside Docker — ws://localhost:7890 in dev (7890, not
    # 7880: that port belongs to the separate TuraClickMeet stack), wss://… in
    # production.
    LIVEKIT_URL: str = ""
    LIVEKIT_API_KEY: str = ""
    LIVEKIT_API_SECRET: str = ""

    # Prepended to every room name (livekit_service.room_name). Exists because
    # dev and production now share ONE LiveKit server: without it a developer
    # opening meeting 14 locally joins `tq-meeting-14` on the live SFU — the same
    # room a real advisory board with real KOLs is sitting in. A LiveKit API key
    # cannot prevent this; any valid key may join any room, so the room NAME is
    # the only isolation boundary there is.
    #
    # Empty in production, so live room names are unchanged. Set `dev-` locally.
    LIVEKIT_ROOM_PREFIX: str = ""

    # Where the egress container's headless Chrome fetches our recording layout
    # from (app/static/egress_template.html). This is resolved INSIDE Docker, so
    # it is not the browser-facing URL: `localhost` there means the egress
    # container itself. `host.docker.internal` reaches the host on Docker
    # Desktop; on a Linux server use the host's LAN IP or the compose service
    # name. Leave blank to fall back to LiveKit's stock template, which omits
    # camera-off participants entirely.
    EGRESS_TEMPLATE_BASE_URL: str = "http://host.docker.internal:8000/egress-template/egress_template.html"
    # Absolute HOST folder that is bind-mounted at the egress container's /out —
    # where recordings actually land (see `docker inspect <egress>` → Mounts, or
    # infra/egress-diag.sh). Blank = guess from UPLOAD_DIR and the repo layout.
    EGRESS_HOST_DIR: str = ""

    # Speech-to-text for meeting recordings.
    #   local  (default) — faster-whisper on this server. No API key, no
    #                      per-minute cost, and the audio never leaves the box,
    #                      which matters for unpublished clinical/commercial talk.
    #   openai           — hosted Whisper, using the ai_configurations key.
    TRANSCRIBE_PROVIDER: str = "local"
    # tiny | base | small | medium | large-v3. `small` is the usual accuracy/speed
    # balance for meeting audio; `tiny` measured ~20x realtime on CPU here.
    TRANSCRIBE_MODEL: str = "small"
    # Blank = auto-detect. Set e.g. "en" when the language is known — it is both
    # faster and stops short utterances being mis-detected.
    # Pin the language. Auto-detect misreads short or repetitive audio — "Hello
    # hello hello" was detected as French and transcribed as "à l'autre".
    TRANSCRIBE_LANGUAGE: str = "en"

    # Extra fonts for the Office -> PDF preview (LibreOffice). A deck set in
    # Trebuchet MS / Calibri / Aptos is drawn in a substitute serif when the
    # converter can't see those fonts, which is the "design mismatch". Every
    # .ttf/.otf here is handed to each conversion. Blank = backend/fonts.
    PREVIEW_FONTS_DIR: str = ""

    class Config:
        env_file = ".env"
        case_sensitive = True

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]


settings = Settings()
