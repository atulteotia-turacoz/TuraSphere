"""
At-rest encryption for stored secrets (SMTP passwords, OAuth client secrets,
webhook secrets).

`EncryptedString` is a SQLAlchemy column type that transparently encrypts on
write and decrypts on read, so application code keeps working with plaintext
(`cfg.password`, `cfg.client_secret`, …) while the DB only ever holds ciphertext.

Key:
  - `settings.SECRET_ENCRYPTION_KEY` if set (a urlsafe-base64 32-byte Fernet key is
    used directly; any other string is SHA-256 → base64 to make a valid key).
  - otherwise derived from `settings.SECRET_KEY`.

Backwards compatibility: rows written before this shipped hold plaintext. On read,
if a value isn't a valid token we return it unchanged (legacy plaintext); the next
save re-stores it encrypted.
"""
import base64
import hashlib
import functools

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.types import TypeDecorator, Text

from app.core.config import settings

# Marks ciphertext we produced, so decrypt() can tell our tokens from legacy
# plaintext without guessing.
_PREFIX = "enc::"


def _derive_key(raw: str) -> bytes:
    """Turn any string into a valid 32-byte urlsafe-base64 Fernet key."""
    raw = (raw or "").strip()
    if raw:
        try:
            # Already a valid Fernet key? Use it directly.
            Fernet(raw.encode())
            return raw.encode()
        except (ValueError, TypeError):
            pass
    seed = raw or settings.SECRET_KEY or "tura-default-secret"
    digest = hashlib.sha256(seed.encode()).digest()      # 32 bytes
    return base64.urlsafe_b64encode(digest)


@functools.lru_cache(maxsize=1)
def _fernet() -> Fernet:
    key = settings.SECRET_ENCRYPTION_KEY or settings.SECRET_KEY
    return Fernet(_derive_key(key))


def encrypt(plaintext):
    """Encrypt a string → prefixed token. None/'' pass through unchanged."""
    if plaintext is None or plaintext == "":
        return plaintext
    token = _fernet().encrypt(str(plaintext).encode()).decode()
    return _PREFIX + token


def decrypt(value):
    """Decrypt a token. Values without our prefix (legacy plaintext) and any token
    that fails to decrypt are returned unchanged so nothing breaks mid-migration."""
    if value is None or value == "":
        return value
    if not isinstance(value, str) or not value.startswith(_PREFIX):
        return value                                     # legacy plaintext
    try:
        return _fernet().decrypt(value[len(_PREFIX):].encode()).decode()
    except (InvalidToken, ValueError):
        return value


class EncryptedString(TypeDecorator):
    """Transparently encrypts on the way to the DB, decrypts on the way out.
    Backed by TEXT so ciphertext never overflows the column."""
    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return encrypt(value)

    def process_result_value(self, value, dialect):
        return decrypt(value)
