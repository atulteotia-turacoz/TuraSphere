"""Honorific titles (Dr., Prof., …) kept in their own `title` field, so names read
"Dr. Rekha Mittal" everywhere without the title being part of the first name."""
import re
from typing import Optional, Tuple

TITLES = ["Dr.", "Prof.", "Mr.", "Mrs.", "Ms."]
_CANON = {"dr": "Dr.", "prof": "Prof.", "professor": "Prof.", "mr": "Mr.", "mrs": "Mrs.",
          "ms": "Ms.", "miss": "Ms."}
_LEAD = re.compile(r"^\s*(dr|prof|professor|mr|mrs|ms|miss)\b\.?\s*", re.I)


def normalize_title(value: Optional[str]) -> Optional[str]:
    if not value or not value.strip():
        return None
    return _CANON.get(value.strip().rstrip(".").lower())


def split_title(full_name: Optional[str]) -> Tuple[Optional[str], str]:
    """"Prof. Dr. Rekha Mittal" -> ("Prof.", "Rekha Mittal"). The first title is
    kept; any further ones ("Dr." after "Prof.") are dropped from the name."""
    rest = (full_name or "").strip()
    title = None
    while True:
        m = _LEAD.match(rest)
        if not m or not rest[m.end():].strip():
            break   # a name that is only a title stays as it is
        title = title or _CANON[m.group(1).lower()]
        rest = rest[m.end():]
    return title, rest.strip()


def display_name(title: Optional[str], first: Optional[str], last: Optional[str]) -> str:
    return " ".join(p for p in (title, first, last) if p)
