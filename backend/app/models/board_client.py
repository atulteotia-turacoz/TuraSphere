"""
Client access to an advisory board.

A platform user creates an advisory board for a client and assigns that client to
the board. The client does NOT get a real platform account — instead they receive a
magic-link backed by a unique opaque `access_token` (same pattern as the per-participant
meeting-join links). Via that link the client can:
  - view the board's project status,
  - review documents the team marked `client_visible` and approve / request changes / reject,
  - communicate with the team/KOLs through the board-level message thread.
"""
import enum
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, Enum, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base


class ApprovalStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    changes_requested = "changes_requested"
    rejected = "rejected"


class BoardClient(Base):
    """A client assigned to an advisory board, accessed via a magic-link token."""
    __tablename__ = "board_clients"
    __table_args__ = (
        UniqueConstraint("board_id", "email", name="uq_board_client_email"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    board_id = Column(Integer, ForeignKey("advisory_boards.id", ondelete="CASCADE"), nullable=False, index=True)

    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False)
    organization = Column(String(255), nullable=True)

    # Magic-link "separate login": a unique opaque token backing /client/{token}.
    access_token = Column(String(64), unique=True, nullable=True, index=True)
    # bcrypt hash of the client's portal password. NULL means no password is set
    # and the link alone opens the portal — the behaviour every existing client
    # has, kept so adding this cannot lock anyone out. Once set, the link is only
    # the first factor and the password is required on top of it.
    password_hash = Column(String(255), nullable=True)
    password_set_at = Column(DateTime, nullable=True)
    token_issued_at = Column(DateTime, nullable=True)

    invited_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    # When the portal-link email actually went out. NULL means the client has
    # a working link that nobody has sent them yet — the state the product
    # was permanently in before the invite email existed.
    invite_sent_at = Column(DateTime, nullable=True)
    last_seen_at = Column(DateTime, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    board = relationship("AdvisoryBoard", foreign_keys=[board_id])
    approvals = relationship("DocumentApproval", back_populates="board_client", cascade="all, delete-orphan")


class DocumentApproval(Base):
    """A client's review decision on a single meeting document."""
    __tablename__ = "document_approvals"
    __table_args__ = (
        UniqueConstraint("document_id", "board_client_id", name="uq_document_approval_client"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    document_id = Column(Integer, ForeignKey("meeting_documents.id", ondelete="CASCADE"), nullable=False, index=True)
    board_client_id = Column(Integer, ForeignKey("board_clients.id", ondelete="CASCADE"), nullable=False, index=True)

    status = Column(Enum(ApprovalStatus), default=ApprovalStatus.pending, nullable=False)
    comment = Column(Text, nullable=True)
    decided_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    document = relationship("MeetingDocument", foreign_keys=[document_id])
    board_client = relationship("BoardClient", back_populates="approvals")
