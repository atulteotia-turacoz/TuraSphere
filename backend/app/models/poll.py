import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, Enum, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from app.core.database import Base


class PollStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    closed = "closed"


class Poll(Base):
    __tablename__ = "polls"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    cover_image = Column(String(500), nullable=True)
    questions = Column(Text, nullable=False)  # JSON: [{title, options: [{text, image}], allow_multiple}]
    options = Column(Text, nullable=True)  # DEPRECATED: kept for backward compat
    allow_multiple = Column(Boolean, default=False, nullable=False)  # default for single-question polls
    show_results = Column(Boolean, default=True, nullable=False)  # show results after voting
    require_name = Column(Boolean, default=False, nullable=False)
    token = Column(String(64), unique=True, nullable=False, index=True)
    status = Column(Enum(PollStatus), default=PollStatus.draft, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User", foreign_keys=[user_id])
    votes = relationship("PollVote", back_populates="poll", cascade="all, delete-orphan")


class PollVote(Base):
    __tablename__ = "poll_votes"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    poll_id = Column(Integer, ForeignKey("polls.id", ondelete="CASCADE"), nullable=False, index=True)
    selected_options = Column(Text, nullable=False)  # JSON array of selected option indices
    voter_name = Column(String(255), nullable=True)
    voter_email = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    poll = relationship("Poll", back_populates="votes")
