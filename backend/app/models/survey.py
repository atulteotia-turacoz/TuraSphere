import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, Enum, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from app.core.database import Base


class QuestionType(str, enum.Enum):
    text = "text"
    textarea = "textarea"
    number = "number"
    select = "select"
    multi_select = "multi_select"
    radio = "radio"
    checkbox = "checkbox"
    rating = "rating"
    date = "date"
    email = "email"
    phone = "phone"
    url = "url"
    time = "time"
    yes_no = "yes_no"
    linear_scale = "linear_scale"
    file_upload = "file_upload"
    section_header = "section_header"
    page_break = "page_break"
    matrix = "matrix"  # Likert-style grid: rows (statements) × columns (choices), one radio per row
    nps = "nps"  # Net Promoter Score: 0-10 "how likely to recommend"; scored in services/survey_nps.py


class SurveyStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    closed = "closed"


class Survey(Base):
    __tablename__ = "surveys"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    cover_image = Column(String(500), nullable=True)
    intro_fields = Column(Text, nullable=True)  # JSON array of {label, field_type, is_required}
    settings = Column(Text, nullable=True)  # JSON object of display options (title/progress bar/numbering/language…)
    token = Column(String(64), unique=True, nullable=False, index=True)
    status = Column(Enum(SurveyStatus), default=SurveyStatus.draft, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User", foreign_keys=[user_id])
    questions = relationship("SurveyQuestion", back_populates="survey", cascade="all, delete-orphan",
                             order_by="SurveyQuestion.sort_order")
    responses = relationship("SurveyResponse", back_populates="survey", cascade="all, delete-orphan")


class SurveyQuestion(Base):
    __tablename__ = "survey_questions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    survey_id = Column(Integer, ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False, index=True)
    # TEXT (not VARCHAR) because "Add content → Text" blocks (section_header) store
    # rich-text HTML here, which easily exceeds 500 chars.
    label = Column(Text, nullable=False)
    question_type = Column(Enum(QuestionType), nullable=False)
    options = Column(Text, nullable=True)  # JSON array for select/radio/checkbox/multi_select
    image = Column(String(500), nullable=True)  # URL/path for question image
    is_required = Column(Boolean, default=False, nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)

    # Relationships
    survey = relationship("Survey", back_populates="questions")


class SurveyResponse(Base):
    __tablename__ = "survey_responses"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    survey_id = Column(Integer, ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False, index=True)
    respondent_name = Column(String(255), nullable=True)
    respondent_email = Column(String(255), nullable=True)
    intro_data = Column(Text, nullable=True)  # JSON object of intro field answers
    # 'partial' = user started but did not finish; 'complete' = submitted.
    status = Column(String(16), default="complete", nullable=False, index=True)
    last_question_id = Column(Integer, nullable=True)  # for resume from saved progress
    submitted_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    survey = relationship("Survey", back_populates="responses")
    answers = relationship("SurveyAnswer", back_populates="response", cascade="all, delete-orphan")


class SurveyAnswer(Base):
    __tablename__ = "survey_answers"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    response_id = Column(Integer, ForeignKey("survey_responses.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id = Column(Integer, ForeignKey("survey_questions.id", ondelete="CASCADE"), nullable=False, index=True)
    answer_text = Column(Text, nullable=True)

    # Relationships
    response = relationship("SurveyResponse", back_populates="answers")
    question = relationship("SurveyQuestion", foreign_keys=[question_id])
