import enum
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, Enum, ForeignKey, Boolean, BigInteger, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base


class DocumentPhase(str, enum.Enum):
    pre = "pre"
    during = "during"
    post = "post"


class DocumentCategory(str, enum.Enum):
    # Legacy / generic
    agenda = "agenda"
    ppt = "ppt"
    draft = "draft"
    cv = "cv"
    reference = "reference"
    report = "report"
    questionnaire = "questionnaire"
    minutes = "minutes"
    manuscript = "manuscript"
    other = "other"
    # Pre-meeting stage
    slide_deck = "slide_deck"
    pre_read = "pre_read"
    survey_draft = "survey_draft"
    approved_materials = "approved_materials"
    # Meeting stage
    moderator_guide = "moderator_guide"
    poll_questions = "poll_questions"
    meeting_notes = "meeting_notes"
    transcript = "transcript"
    # Post-meeting stage
    draft_report = "draft_report"
    final_report = "final_report"
    analysis = "analysis"
    survey_results = "survey_results"
    client_feedback = "client_feedback"


class DocApprovalStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class MeetingDocument(Base):
    __tablename__ = "meeting_documents"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    meeting_id = Column(Integer, ForeignKey("board_meetings.id", ondelete="CASCADE"), nullable=False, index=True)

    # The section (folder) this document is filed under — "Section ABC" and its
    # five files, which is how both portals group shared material. NULL means
    # material that isn't in a section, which is how every existing document
    # stays valid. Sections are NOT sessions: a session is a part of the meeting
    # and holds no documents.
    section_id = Column(Integer, ForeignKey("board_sections.id", ondelete="SET NULL"),
                        nullable=True, index=True)

    # The session (part of the programme) it belongs to — a second, independent
    # heading with its own picker. Same table as the section, told apart by
    # `kind`; a document may have one of each, both, or neither.
    doc_session_id = Column(Integer, ForeignKey("board_sections.id", ondelete="SET NULL"),
                            nullable=True, index=True)

    # The ORIGINAL filing, kept for documents uploaded before sections existed
    # (and for the expert dashboard, which still groups its comment threads by
    # agenda item). New uploads set `section_id` instead.
    agenda_item_id = Column(Integer, ForeignKey("meeting_agenda_items.id", ondelete="SET NULL"),
                            nullable=True, index=True)

    phase = Column(Enum(DocumentPhase), nullable=False, index=True)
    category = Column(Enum(DocumentCategory), default=DocumentCategory.other, nullable=False)
    title = Column(String(500), nullable=False)
    # Sequential version per (meeting, title) — auto-incremented on re-upload.
    version = Column(Integer, default=1, nullable=False)
    # Document-level approval state (separate from per-client review approvals).
    approval_status = Column(Enum(DocApprovalStatus), default=DocApprovalStatus.pending, nullable=False)

    file_path = Column(String(1000), nullable=False)
    mime_type = Column(String(150), nullable=True)
    size_bytes = Column(BigInteger, nullable=True)

    # Opaque token backing an unauthenticated public link (/public/documents/{token}).
    # NULL until a manager generates a share link; clearing it revokes the link.
    public_token = Column(String(64), unique=True, nullable=True, index=True)

    uploaded_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    is_enabled = Column(Boolean, default=True, nullable=False)
    allow_comments = Column(Boolean, default=False, nullable=False)
    # Per-role audience flags. Team (managers) always have access; these gate the
    # external portals. Defaults off so documents stay internal until shared.
    client_visible = Column(Boolean, default=False, nullable=False)  # board client portal
    kol_visible = Column(Boolean, default=False, nullable=False)     # KOL/advisor meeting portal

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    meeting = relationship("BoardMeeting", back_populates="documents")
    agenda_item = relationship("MeetingAgendaItem", foreign_keys=[agenda_item_id])
    section = relationship("BoardSection", foreign_keys=[section_id])
    doc_session = relationship("BoardSection", foreign_keys=[doc_session_id])
    uploader = relationship("User", foreign_keys=[uploaded_by])
    visibility = relationship("MeetingDocumentVisibility", back_populates="document", cascade="all, delete-orphan")
    comments = relationship("MeetingDocumentComment", back_populates="document",
                            cascade="all, delete-orphan", order_by="MeetingDocumentComment.created_at")


class MeetingDocumentVisibility(Base):
    """If rows exist for a document, only those users can view it. Empty = visible to all meeting participants."""
    __tablename__ = "meeting_document_visibility"
    __table_args__ = (
        UniqueConstraint("document_id", "user_id", name="uq_meeting_document_visibility_user"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    document_id = Column(Integer, ForeignKey("meeting_documents.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    document = relationship("MeetingDocument", back_populates="visibility")
    user = relationship("User", foreign_keys=[user_id])


class MeetingDocumentComment(Base):
    __tablename__ = "meeting_document_comments"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    document_id = Column(Integer, ForeignKey("meeting_documents.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    document = relationship("MeetingDocument", back_populates="comments")
    user = relationship("User", foreign_keys=[user_id])
