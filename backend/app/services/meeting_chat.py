"""
Shared helpers for the in-meeting chat.

The chat is reachable two ways — the authenticated meeting room
(`/meetings/{id}/chat`, in endpoints/meetings.py) and a participant's join-link
token (`/public/meeting/join/{token}/chat`, in endpoints/meeting_join.py). Both
read and write the same `meeting_chat_messages` rows, so serialization, the
message-length limit and the "may this meeting still take messages" rule live
here rather than being written twice with a chance of drifting apart.
"""
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.meeting import BoardMeeting
from app.models.meeting_chat import MeetingChatMessage

# Long enough for a real paragraph, short enough that the panel stays readable
# and a single message can't be used to bloat the table.
MAX_BODY_CHARS = 4000

# Newest-N cap for a cold load; the panel then polls with `after_id` for deltas.
DEFAULT_LIMIT = 200


def message_to_dict(m: MeetingChatMessage) -> dict:
    return {
        "id": m.id,
        "sender_name": m.sender_name,
        "sender_role": m.sender_role,
        "body": m.body,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "user_id": m.user_id,
        "participant_id": m.participant_id,
    }


def list_messages(
    db: Session, meeting_id: int, after_id: Optional[int] = None, limit: int = DEFAULT_LIMIT,
) -> List[dict]:
    """Messages oldest-first. With `after_id` returns only what's newer, which is
    what the panel polls for; without it returns the most recent `limit`."""
    q = db.query(MeetingChatMessage).filter(MeetingChatMessage.meeting_id == meeting_id)
    if after_id:
        rows = q.filter(MeetingChatMessage.id > after_id).order_by(
            MeetingChatMessage.id.asc()).limit(limit).all()
    else:
        # Take the newest `limit`, then flip so the panel renders oldest-first.
        rows = list(reversed(
            q.order_by(MeetingChatMessage.id.desc()).limit(limit).all()
        ))
    return [message_to_dict(m) for m in rows]


def clean_body(body: Optional[str]) -> str:
    """Trim and length-check. Returns '' when there is nothing to send, so callers
    can reject empty/whitespace-only messages uniformly."""
    text = (body or "").strip()
    return text[:MAX_BODY_CHARS]


def chat_is_open(meeting: BoardMeeting) -> bool:
    """Whether the meeting is currently accepting new messages. `chat_enabled` is
    the organizer's switch; older rows predate the column and read as None, which
    is treated as on to match the column default."""
    return meeting.chat_enabled is not False


def post_message(
    db: Session, meeting_id: int, body: str, sender_name: str,
    sender_role: Optional[str] = None, user_id: Optional[int] = None,
    participant_id: Optional[int] = None,
) -> MeetingChatMessage:
    msg = MeetingChatMessage(
        meeting_id=meeting_id,
        body=body,
        sender_name=sender_name or "Guest",
        sender_role=sender_role,
        user_id=user_id,
        participant_id=participant_id,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg
