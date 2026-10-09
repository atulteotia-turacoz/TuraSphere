"""Helper to append entries to a board's audit trail (BoardActivity)."""
from typing import Optional
from sqlalchemy.orm import Session

from app.models.board_workspace import BoardActivity


def log_board_activity(db: Session, board_id: int, user_id: Optional[int],
                       action: str, details: Optional[str] = None, *,
                       actor_label: Optional[str] = None, commit: bool = True):
    """Record one audit-trail entry. `user_id` for platform users; `actor_label`
    for non-user actors (e.g. a KOL/advisor on a magic link). By default commits;
    pass commit=False to fold it into the caller's transaction."""
    entry = BoardActivity(board_id=board_id, performed_by=user_id, action=action,
                          details=details, actor_label=actor_label)
    db.add(entry)
    if commit:
        db.commit()
    return entry
