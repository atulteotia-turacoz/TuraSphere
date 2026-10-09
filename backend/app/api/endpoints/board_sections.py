"""
The two lists a document can be filed under: SECTIONS and SESSIONS.

  * a section is a folder — "Section ABC" holding its five files;
  * a session is a part of the programme — "Session 1", "Session 2".

Both are created by the organizer, both are board-level, and a document may
carry one of each, both, or neither. They share this module and the
`board_sections` table (`kind` tells them apart) because they are the same shape
— but they are never mixed in a picker: the section dropdown lists sections, the
session dropdown lists sessions.

Neither is the AGENDA, which is the timed running order published to the client
and the experts. Filing documents under agenda items is what used to put
headings in it that nobody meant to publish.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.advisory_board import AdvisoryBoard
from app.models.board_section import BoardSection
from app.models.meeting import BoardMeeting
from app.models.meeting_document import MeetingDocument

router = APIRouter(tags=["MABM - Sections"])


# The two lists this module serves. A bad value is rejected rather than quietly
# creating a third kind nothing will ever read.
KINDS = ("section", "session")


def _kind_or_400(kind: str) -> str:
    k = (kind or "").strip().lower()
    if k not in KINDS:
        raise HTTPException(status_code=400, detail=f"Unknown kind: {kind}. Use one of {list(KINDS)}.")
    return k


class SectionCreate(BaseModel):
    title: str
    sequence: Optional[int] = None


class SectionUpdate(BaseModel):
    title: Optional[str] = None
    sequence: Optional[int] = None


def _to_dict(s: BoardSection, document_count: int = 0) -> dict:
    return {
        "id": s.id,
        "board_id": s.board_id,
        "kind": s.kind,
        "title": s.title,
        "sequence": s.sequence,
        "document_count": document_count,
        "created_at": s.created_at.isoformat(),
    }


def _duplicate_or_none(db: Session, board_id: int, title: str, kind: str = "section",
                       exclude_id: Optional[int] = None):
    """An existing section of this board with the same name.

    Compared case-insensitively on the trimmed title, because "Section 1" twice
    in the picker is indistinguishable to the person choosing — and a document
    filed under the second one looks lost.
    """
    q = db.query(BoardSection).filter(
        BoardSection.board_id == board_id,
        BoardSection.kind == kind,
        func.lower(func.trim(BoardSection.title)) == title.strip().lower(),
    )
    if exclude_id is not None:
        q = q.filter(BoardSection.id != exclude_id)
    return q.first()


def _board_or_404(board_id: int, db: Session) -> AdvisoryBoard:
    board = db.query(AdvisoryBoard).filter(AdvisoryBoard.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Advisory board not found")
    return board


def _section_or_404(board_id: int, section_id: int, db: Session, kind: Optional[str] = None) -> BoardSection:
    q = db.query(BoardSection).filter(
        BoardSection.id == section_id,
        BoardSection.board_id == board_id,
    )
    if kind:
        q = q.filter(BoardSection.kind == kind)
    s = q.first()
    if not s:
        raise HTTPException(status_code=404, detail="Section not found")
    return s


def sections_for_board(db: Session, board_id: int, kind: str = "section") -> list:
    """One board's headings of the given kind, in display order."""
    return (
        db.query(BoardSection)
        .filter(BoardSection.board_id == board_id, BoardSection.kind == kind)
        .order_by(BoardSection.sequence.asc(), BoardSection.id.asc())
        .all()
    )


@router.get("/advisory-boards/{board_id}/sections")
def list_board_sections(
    board_id: int,
    kind: str = "section",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    kind = _kind_or_400(kind)
    _board_or_404(board_id, db)
    rows = sections_for_board(db, board_id, kind)
    counts = {}
    if rows:
        ids = [s.id for s in rows]
        for doc in db.query(MeetingDocument.section_id).filter(
            MeetingDocument.section_id.in_(ids)
        ).all():
            counts[doc[0]] = counts.get(doc[0], 0) + 1
    return [_to_dict(s, counts.get(s.id, 0)) for s in rows]


@router.post("/advisory-boards/{board_id}/sections", status_code=201)
def create_board_section(
    board_id: int,
    data: SectionCreate,
    kind: str = "section",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    kind = _kind_or_400(kind)
    """Add a section. Created straight from the document upload form, so the
    organizer never has to leave what they were doing to file a document."""
    _board_or_404(board_id, db)
    title = (data.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="A section needs a title.")

    # Two sections with the same name are impossible to tell apart in the
    # picker, and a double-submit used to make exactly that. Hand back the one
    # that already exists instead of adding another: the caller selects it and
    # carries on, which is what they wanted either way.
    existing = _duplicate_or_none(db, board_id, title, kind)
    if existing:
        return _to_dict(existing)

    if data.sequence is None:
        # Append: a new session belongs at the end of the programme, not at 0.
        last = db.query(BoardSection).filter(
            BoardSection.board_id == board_id, BoardSection.kind == kind,
        ).order_by(BoardSection.sequence.desc()).first()
        sequence = (last.sequence + 1) if last else 0
    else:
        sequence = data.sequence

    s = BoardSection(board_id=board_id, kind=kind, title=title, sequence=sequence)
    db.add(s)
    db.commit()
    db.refresh(s)
    return _to_dict(s)


@router.patch("/advisory-boards/{board_id}/sections/{section_id}")
def update_board_section(
    board_id: int,
    section_id: int,
    data: SectionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = _section_or_404(board_id, section_id, db)
    payload = data.dict(exclude_unset=True)
    if "title" in payload:
        title = (payload["title"] or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="A section needs a title.")
        if _duplicate_or_none(db, board_id, title, s.kind, exclude_id=s.id):
            raise HTTPException(status_code=400, detail=f'This board already has a {s.kind} called "{title}".')
        s.title = title
    if "sequence" in payload and payload["sequence"] is not None:
        s.sequence = payload["sequence"]
    db.commit()
    db.refresh(s)
    return _to_dict(s)


@router.delete("/advisory-boards/{board_id}/sections/{section_id}")
def delete_board_section(
    board_id: int,
    section_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a section. Its documents are NOT deleted — they become unfiled and
    show under "Other documents" in the portals, so removing a heading can never
    lose a file (the FK is ON DELETE SET NULL)."""
    s = _section_or_404(board_id, section_id, db)
    freed = db.query(MeetingDocument).filter(MeetingDocument.section_id == s.id).count()
    db.delete(s)
    db.commit()
    return {"deleted": True, "section_id": section_id, "documents_unfiled": freed}


# ── Meeting-addressed aliases ────────────────────────────────────────────────
# The document workspace knows the meeting, not the board, and sessions are a
# board-level list. These two save every caller from looking the board up first.

@router.get("/meetings/{meeting_id}/sections")
def list_meeting_sections(
    meeting_id: int,
    kind: str = "section",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board_id = board_id_for_meeting(db, meeting_id)
    if board_id is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return list_board_sections(board_id, kind, db, current_user)


@router.post("/meetings/{meeting_id}/sections", status_code=201)
def create_meeting_section(
    meeting_id: int,
    data: SectionCreate,
    kind: str = "section",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board_id = board_id_for_meeting(db, meeting_id)
    if board_id is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return create_board_section(board_id, data, kind, db, current_user)


@router.delete("/meetings/{meeting_id}/sections/{section_id}")
def delete_meeting_section(
    meeting_id: int,
    section_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a heading from the document workspace, which knows the meeting
    rather than the board. Its documents survive and become unfiled."""
    board_id = board_id_for_meeting(db, meeting_id)
    if board_id is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return delete_board_section(board_id, section_id, db, current_user)


def board_id_for_meeting(db: Session, meeting_id: int) -> Optional[int]:
    """The board a meeting belongs to — used to check that a document's session
    comes from the same board as its meeting."""
    row = db.query(BoardMeeting.board_id).filter(BoardMeeting.id == meeting_id).first()
    return row[0] if row else None
