from datetime import datetime

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship

from app.core.database import Base


class BoardSection(Base):
    """A heading a document can be filed under — a SECTION or a SESSION.

    Two separate lists, kept in one table because they are the same shape and
    the same code files a document under either:

      * `kind="section"` — a folder of documents, "Section ABC" and its files.
      * `kind="session"` — a part of the programme, "Session 1", "Session 2".

    A document may carry one of each, both, or neither, and each has its own
    picker: sections never appear in the session dropdown, and vice versa.

    Neither is the AGENDA. The agenda is the timed running order published to
    the client and the experts, so filing documents under agenda items meant
    adding a heading put a line in it that nobody meant to publish.

    Board-level, not meeting-level: the organizer sets these up once for the
    board, and a board's meeting draws from them.
    """
    __tablename__ = "board_sections"
    __table_args__ = (
        Index("ix_board_sections_board_kind_seq", "board_id", "kind", "sequence"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    board_id = Column(Integer, ForeignKey("advisory_boards.id", ondelete="CASCADE"),
                      nullable=False, index=True)

    # "section" | "session" — which of the two lists this heading belongs to.
    kind = Column(String(20), default="section", nullable=False, index=True)

    title = Column(String(300), nullable=False)
    # Display order. Ties break on id, so two sections added at the same position
    # still come out in a stable order rather than shuffling between requests.
    sequence = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    board = relationship("AdvisoryBoard", foreign_keys=[board_id])
