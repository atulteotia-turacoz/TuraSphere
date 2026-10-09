"""
The per-session discussion thread, shared by all three sides of a board.

One forum, three doors into it:

  * the expert, on a join token          (`/public/meeting/join/{token}/...`)
  * the client/sponsor, on a portal token (`/public/client/{token}/...`)
  * the organizer / medical writer, logged in (`/meetings/{id}/...`)

Every one of them reads and writes `meeting_session_comments` through this
module, so the three views of the same conversation cannot drift apart — the
same mistake `meeting_engagement_stats` exists to prevent for the numbers.

Who may delete what
-------------------
Your own comment, always. Everything else, only a moderator (the organizer
side): one expert must never be able to remove another's contribution, and the
client must not be able to quietly delete an expert's criticism of the material
they commissioned.
"""
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from app.models.meeting import BoardMeeting, MeetingAgendaItem
from app.models.meeting_session_comment import MeetingSessionComment


# Kinds of author. Mirrors MeetingSessionComment.author_type.
PARTICIPANT = "participant"
CLIENT = "client"
TEAM = "team"

# What each side is called in the thread. The expert sees "Project team" rather
# than a job title because the person answering may be the organizer, a medical
# writer or the agency — one label the panel can make sense of.
AUTHOR_LABEL = {
    PARTICIPANT: "Expert",
    CLIENT: "Client",
    TEAM: "Project team",
}

MAX_BODY = 5000


@dataclass
class Viewer:
    """Who is reading or writing, in whichever of the three ways they arrived.

    `kind` is one of PARTICIPANT / CLIENT / TEAM and `id` is the row id in that
    kind's own table — the pair is what `is_mine` compares against, so a client
    with id 4 is never mistaken for a participant with id 4.
    """
    kind: str
    id: Optional[int]
    name: str
    can_post: bool = True
    can_moderate: bool = False


def _enum_value(v):
    return v.value if hasattr(v, "value") else v


def _author_id(c: MeetingSessionComment) -> Optional[int]:
    """The id column that belongs to this row's author_type."""
    kind = c.author_type or PARTICIPANT
    if kind == CLIENT:
        return c.client_id
    if kind == TEAM:
        return c.user_id
    return c.participant_id


def comment_dict(c: MeetingSessionComment, viewer: Optional[Viewer] = None) -> dict:
    kind = c.author_type or PARTICIPANT
    is_mine = bool(
        viewer and viewer.id is not None
        and kind == viewer.kind and _author_id(c) == viewer.id
    )
    return {
        "id": c.id,
        "agenda_item_id": c.agenda_item_id,
        # The session's title, resolved once here. A flat thread still wants to
        # say "on Test 1" under a comment that was written from the per-session
        # forum, rather than dropping the context on the floor.
        "session_title": c.agenda_item.title if c.agenda_item else None,
        "author_name": c.author_name or AUTHOR_LABEL.get(kind, "Participant"),
        "author_type": kind,
        "author_label": AUTHOR_LABEL.get(kind, "Participant"),
        "body": c.body,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "is_mine": is_mine,
        # Resolved here rather than in each of the three pages, so the button
        # and the endpoint agree on who may remove what.
        "can_delete": bool(is_mine or (viewer and viewer.can_moderate)),
    }


def comments_by_session(db: Session, meeting: BoardMeeting,
                        viewer: Optional[Viewer] = None) -> dict:
    """{agenda_item_id: [comment, ...]} for one meeting, oldest first.

    One query for the whole meeting rather than one per session — a board with
    eight sessions on the dashboard was otherwise eight round trips.
    """
    rows = db.query(MeetingSessionComment).filter(
        MeetingSessionComment.meeting_id == meeting.id
    ).order_by(MeetingSessionComment.created_at.asc()).all()

    out: dict = {}
    for c in rows:
        # A session-less comment keys on None — callers that group by session
        # read it out as the meeting's "General discussion".
        out.setdefault(c.agenda_item_id, []).append(comment_dict(c, viewer))
    return out


def build_discussion(db: Session, meeting: BoardMeeting, viewer: Viewer) -> dict:
    """The whole forum for one meeting: every session, with its thread.

    Sessions with nothing said in them are included on purpose — the Discussion
    tab is where you go to START a conversation about session 3, so it has to
    show session 3.
    """
    by_session = comments_by_session(db, meeting, viewer)
    sessions = sorted(meeting.agenda_items, key=lambda a: (a.sequence or 0, a.id))

    session_rows = []
    for idx, a in enumerate(sessions, start=1):
        items = by_session.get(a.id, [])
        session_rows.append({
            "id": a.id,
            "index": idx,
            "sequence": a.sequence,
            "title": a.title,
            "description": a.description,
            "comments": items,
            "comment_count": len(items),
        })

    # Comments on the meeting rather than on one session. The expert's flat
    # Discussion tab writes these; the client's and the organizer's grouped
    # views show them under "General discussion" so nothing said is unseen.
    general = by_session.get(None, [])

    # The same conversation as one list, oldest first — what a flat thread
    # renders. Built here rather than in the page so every side orders it
    # identically.
    thread = sorted(
        [c for items in by_session.values() for c in items],
        key=lambda c: (c["created_at"] or "", c["id"]),
    )

    return {
        "meeting": {
            "id": meeting.id,
            "title": meeting.title,
            "status": _enum_value(meeting.status),
            "scheduled_at": meeting.scheduled_at.isoformat() if meeting.scheduled_at else None,
        },
        "sessions": session_rows,
        "general": general,
        "general_count": len(general),
        "thread": thread,
        "total_comments": len(thread),
        "can_post": viewer.can_post,
        "can_moderate": viewer.can_moderate,
        "me": {
            "kind": viewer.kind,
            "name": viewer.name,
            "label": AUTHOR_LABEL.get(viewer.kind, "Participant"),
        },
    }


def get_session_or_none(db: Session, meeting_id: int,
                        agenda_item_id: int) -> Optional[MeetingAgendaItem]:
    """The agenda item, only if it belongs to this meeting.

    Scoped rather than fetched by id alone: a valid token for meeting A must not
    be able to post into meeting B's session by guessing its id.
    """
    return db.query(MeetingAgendaItem).filter(
        MeetingAgendaItem.id == agenda_item_id,
        MeetingAgendaItem.meeting_id == meeting_id,
    ).first()


def clean_body(body: Optional[str]) -> str:
    """The posted text, or a ValueError carrying the message to show."""
    text = (body or "").strip()
    if not text:
        raise ValueError("Comment is empty.")
    if len(text) > MAX_BODY:
        raise ValueError(f"Comment is too long ({MAX_BODY} characters max).")
    return text


def add_comment(db: Session, meeting: BoardMeeting, item: Optional[MeetingAgendaItem],
                body: str, viewer: Viewer) -> MeetingSessionComment:
    """Write one comment as `viewer`. `body` must already be through clean_body.

    `item` is None for a comment on the meeting as a whole — what the expert's
    flat Discussion tab posts.
    """
    c = MeetingSessionComment(
        agenda_item_id=item.id if item else None,
        meeting_id=meeting.id,
        author_type=viewer.kind,
        author_name=viewer.name or AUTHOR_LABEL.get(viewer.kind, "Participant"),
        body=body,
    )
    # Exactly one id column, chosen by the author's kind.
    if viewer.kind == CLIENT:
        c.client_id = viewer.id
    elif viewer.kind == TEAM:
        c.user_id = viewer.id
    else:
        c.participant_id = viewer.id

    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def may_delete(c: MeetingSessionComment, viewer: Viewer) -> bool:
    if viewer.can_moderate:
        return True
    kind = c.author_type or PARTICIPANT
    return viewer.id is not None and kind == viewer.kind and _author_id(c) == viewer.id
