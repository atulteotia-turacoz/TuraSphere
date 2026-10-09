import json
import os
import re
import uuid
from collections import Counter
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import Optional, List, Any
from pydantic import BaseModel

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user, get_super_admin
from app.models.user import User
from app.models.survey import (
    Survey, SurveyQuestion, SurveyResponse, SurveyAnswer,
    SurveyStatus, QuestionType,
)

router = APIRouter(tags=["Surveys"])


# ── Schemas ──────────────────────────────────────────────

class IntroFieldSchema(BaseModel):
    label: str
    field_type: str = "text"  # text, email, phone, number, textarea
    is_required: bool = False
    is_unique: bool = False  # if True, duplicate value blocks resubmission / triggers resume


class QuestionSchema(BaseModel):
    label: str
    question_type: str
    # For choice types: list of strings or {"text","image","go_to","requires_text"}.
    # For matrix: {"rows":[...], "columns":[...]} — both arrays of plain strings.
    options: Optional[Any] = None
    image: Optional[str] = None
    is_required: bool = False
    sort_order: int = 0


class SurveyCreate(BaseModel):
    title: str
    description: Optional[str] = None
    cover_image: Optional[str] = None
    intro_fields: Optional[List[IntroFieldSchema]] = None
    settings: Optional[Any] = None  # display options: {show_title, progress_bar, question_numbers, language, …}
    questions: List[QuestionSchema] = []


class SurveyUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    cover_image: Optional[str] = None
    intro_fields: Optional[List[Any]] = None  # List[IntroFieldSchema] or null to clear
    settings: Optional[Any] = None  # display options object, or null to clear
    status: Optional[str] = None
    questions: Optional[List[QuestionSchema]] = None


class PublicAnswerSchema(BaseModel):
    question_id: int
    answer_text: Optional[str] = None


class PublicSubmitSchema(BaseModel):
    respondent_name: Optional[str] = None
    respondent_email: Optional[str] = None
    intro_data: Optional[dict] = None
    answers: List[PublicAnswerSchema] = []
    response_id: Optional[int] = None  # if provided, finalize this partial response


class PublicLookupSchema(BaseModel):
    intro_data: dict = {}


class PublicPartialSaveSchema(BaseModel):
    response_id: Optional[int] = None
    intro_data: Optional[dict] = None
    answers: List[PublicAnswerSchema] = []
    last_question_id: Optional[int] = None


# ── Helper ───────────────────────────────────────────────

def _jdump(obj):
    # ensure_ascii=False keeps content (questions, options, answers, intro data) in its
    # original script — Hindi, Arabic, CJK, emoji, etc. — instead of \uXXXX escapes.
    return json.dumps(obj, ensure_ascii=False)


def _parse_json_field(val):
    if not val:
        return None
    if isinstance(val, (list, dict)):
        return val
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return None


def _survey_to_dict(survey: Survey, include_responses: bool = False):
    questions = []
    for q in survey.questions:
        opts = _parse_json_field(q.options)
        questions.append({
            "id": q.id,
            "label": q.label,
            "question_type": q.question_type.value if hasattr(q.question_type, 'value') else q.question_type,
            "options": opts,
            "image": q.image,
            "is_required": q.is_required,
            "sort_order": q.sort_order,
        })

    completed_responses = [r for r in survey.responses if r.status == "complete"]
    result = {
        "id": survey.id,
        "user_id": survey.user_id,
        "title": survey.title,
        "description": survey.description,
        "cover_image": survey.cover_image,
        "intro_fields": _parse_json_field(survey.intro_fields),
        "settings": _parse_json_field(survey.settings),
        "token": survey.token,
        "status": survey.status.value if hasattr(survey.status, 'value') else survey.status,
        "questions": questions,
        "response_count": len(completed_responses),
        "created_at": survey.created_at.isoformat(),
        "updated_at": survey.updated_at.isoformat(),
    }

    if include_responses:
        result["responses"] = _responses_to_list(survey)

    return result


_STRUCTURAL_TYPES = {QuestionType.section_header, QuestionType.page_break}
_LEADING_NUMBER_RE = re.compile(r"^\s*(\d+)\s*[.\)]")


def _question_column_keys(questions):
    """Map each question id -> a stable, UNIQUE column key for the results table / CSV.

    Answers are surfaced keyed by question label, but labels are not unique: a
    survey can carry many follow-ups sharing one label (e.g. the 20 "Kindly
    provide a reason for neutrality or disagreement." textareas in survey 13).
    Keying by the bare label collapses them into a single column, so within one
    respondent every such answer but the last is overwritten and lost from the
    table and the export (the DB rows are untouched — this is display-only).

    Duplicated labels therefore get a suffix tying each follow-up to the numbered
    statement it follows ("… (Q6)"), falling back to an occurrence counter when no
    statement number is in scope. Labels used only once are returned verbatim so
    existing single-use columns keep their exact headers.
    """
    base = {
        q.id: (q.label.strip() if q.label and q.label.strip() else f"Question {idx + 1}")
        for idx, q in enumerate(questions)
    }
    duplicated = {lbl for lbl, n in Counter(base.values()).items() if n > 1}
    keys = {}
    used = set()
    seen = Counter()
    last_stmt_no = None
    for q in questions:
        lbl = base[q.id]
        has_own_number = _LEADING_NUMBER_RE.match(lbl) is not None
        if q.question_type not in _STRUCTURAL_TYPES and has_own_number:
            last_stmt_no = _LEADING_NUMBER_RE.match(lbl).group(1)
        if lbl not in duplicated:
            keys[q.id] = lbl
            used.add(lbl)
            continue
        seen[lbl] += 1
        if last_stmt_no and not has_own_number:
            key = f"{lbl} (Q{last_stmt_no})"
        else:
            key = f"{lbl} ({seen[lbl]})"
        # Guard against two follow-ups resolving to the same parent number.
        if key in used:
            key = f"{lbl} (Q{last_stmt_no}-{seen[lbl]})" if last_stmt_no else f"{lbl} ({seen[lbl]})"
        keys[q.id] = key
        used.add(key)
    return keys


# Multi-select answers are stored as the selected option texts joined by "|||",
# each optionally carrying "other"-style custom text as "Option||~~||free text".
_MULTI_TYPES = {QuestionType.multi_select, QuestionType.checkbox}
FT_SEP = "||~~||"


def _norm_opt(s):
    return (s or "").strip()


def _choice_option_texts(q):
    """Ordered option display texts for a choice question (options may be plain
    strings or {"text": ...} objects)."""
    opts = _parse_json_field(q.options)
    if not isinstance(opts, list):
        return []
    out = []
    for o in opts:
        t = o.get("text") if isinstance(o, dict) else o
        if t is not None and str(t).strip() != "":
            out.append(str(t).strip())
    return out


def _option_col_key(base_key, option_text):
    return f"{base_key} — {option_text}"


def _multiselect_option_keys(questions, q_map):
    """qid -> {normalized option text: option column key} for multi-select/checkbox
    questions, so each selected value lands in its own per-option column."""
    out = {}
    for q in questions:
        if q.question_type in _MULTI_TYPES:
            base = q_map[q.id]
            out[q.id] = {_norm_opt(t): _option_col_key(base, t) for t in _choice_option_texts(q)}
    return out


def _result_column_order(survey, q_map):
    """Ordered answer-column keys in survey order, limited to answered questions.
    Multi-select/checkbox questions expand to one column per option so selections
    are split out (blank = not selected); everything else is a single column."""
    answered = {a.question_id for r in survey.responses for a in r.answers}
    cols = []
    for q in survey.questions:
        if q.question_type in _STRUCTURAL_TYPES or q.id not in answered:
            continue
        if q.question_type in _MULTI_TYPES:
            opts = _choice_option_texts(q)
            if opts:
                cols.extend(_option_col_key(q_map[q.id], t) for t in opts)
            else:
                cols.append(q_map[q.id])
        else:
            cols.append(q_map[q.id])
    return cols


def _responses_to_list(survey: Survey):
    # Use a stable, unique display key per question so (a) empty-label questions
    # (e.g. matrix grids the owner forgot to title) still get a column instead of
    # colliding under "", and (b) questions that share a label (repeated "reason"
    # follow-ups) each get their own column instead of overwriting one another.
    q_map = _question_column_keys(survey.questions)
    ms_opt_key = _multiselect_option_keys(survey.questions, q_map)
    intro_fields = _parse_json_field(survey.intro_fields) or []
    responses = []
    for r in survey.responses:
        # Include partials too — owners need to see and delete in-progress entries that
        # would otherwise block respondents on unique-field re-submits. The frontend
        # tags them with a "Partial" badge based on `status`.
        # Emit answers in survey-question order so the results table / CSV columns
        # line up with the form (each "reason" sits beside its statement) instead
        # of DB insertion order.
        by_qid = {a.question_id: a.answer_text for a in r.answers}
        answers = {}
        for q in survey.questions:
            if q.id not in by_qid:
                continue
            if q.id in ms_opt_key:
                # Split the multi-select into per-option columns. Each selected
                # option's cell shows the OPTION LABEL (not "Yes"), blank when not
                # picked; an "Other" pick shows the typed custom text instead.
                for seg in (by_qid[q.id] or "").split("|||"):
                    if seg == "":
                        continue
                    opt, _sep, custom = seg.partition(FT_SEP)
                    key = ms_opt_key[q.id].get(_norm_opt(opt)) or _option_col_key(q_map[q.id], _norm_opt(opt))
                    answers[key] = custom.strip() if custom.strip() else opt.strip()
            else:
                answers[q_map[q.id]] = by_qid[q.id]
        # Any answer whose question was since deleted still gets surfaced.
        for a in r.answers:
            if a.question_id not in q_map:
                answers[f"Q{a.question_id}"] = a.answer_text

        # Include intro field answers
        intro_data = _parse_json_field(r.intro_data) or {}

        responses.append({
            "id": r.id,
            "respondent_name": r.respondent_name,
            "respondent_email": r.respondent_email,
            "intro_data": intro_data,
            "submitted_at": r.submitted_at.isoformat(),
            "answers": answers,
            "status": r.status,
        })
    return responses


# ── User Endpoints (auth required) ───────────────────────

@router.post("/surveys", status_code=201)
def create_survey(
    data: SurveyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    survey = Survey(
        user_id=current_user.id,
        title=data.title,
        description=data.description,
        cover_image=data.cover_image,
        intro_fields=_jdump([f.dict() for f in data.intro_fields]) if data.intro_fields else None,
        settings=_jdump(data.settings) if data.settings else None,
        token=uuid.uuid4().hex,
        status=SurveyStatus.draft,
    )
    db.add(survey)
    db.flush()

    for i, q in enumerate(data.questions):
        sq = SurveyQuestion(
            survey_id=survey.id,
            label=q.label,
            question_type=q.question_type,
            options=_jdump(q.options) if q.options else None,
            image=q.image,
            is_required=q.is_required,
            sort_order=q.sort_order or i,
        )
        db.add(sq)

    db.commit()
    db.refresh(survey)
    return _survey_to_dict(survey)


@router.get("/surveys")
def list_surveys(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    surveys = db.query(Survey).filter(
        Survey.user_id == current_user.id
    ).order_by(Survey.created_at.desc()).all()
    return [_survey_to_dict(s) for s in surveys]


@router.get("/surveys/{survey_id}")
def get_survey(
    survey_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    survey = db.query(Survey).filter(Survey.id == survey_id).first()
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    if survey.user_id != current_user.id and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Access denied")
    return _survey_to_dict(survey, include_responses=True)


@router.put("/surveys/{survey_id}")
def update_survey(
    survey_id: int,
    data: SurveyUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    survey = db.query(Survey).filter(Survey.id == survey_id).first()
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    if survey.user_id != current_user.id and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Access denied")

    if data.title is not None:
        survey.title = data.title
    if data.description is not None:
        survey.description = data.description
    if data.cover_image is not None:
        survey.cover_image = data.cover_image or None
    if data.intro_fields is not None:
        survey.intro_fields = _jdump(data.intro_fields) if data.intro_fields else None
    if data.settings is not None:
        survey.settings = _jdump(data.settings) if data.settings else None
    if data.status is not None:
        survey.status = data.status

    if data.questions is not None:
        # IMPORTANT: preserve collected answers across an edit.
        # The frontend sends questions WITHOUT ids, so we can't diff by id. Simply
        # deleting the old question rows and re-creating them would cascade-delete
        # every survey_answer (survey_answers.question_id is ON DELETE CASCADE),
        # silently wiping all response data on a live survey.
        # So instead: create the new question rows FIRST, repoint each existing
        # answer from the old question to the new question in the SAME position
        # (by sort order), THEN delete the old rows — which by then have no answers
        # pointing at them, so nothing cascades. Answers whose position no longer
        # exists (a question was removed) fall away with that question, as intended.
        old_qs = db.query(SurveyQuestion).filter(
            SurveyQuestion.survey_id == survey.id
        ).order_by(SurveyQuestion.sort_order, SurveyQuestion.id).all()

        new_qs = []
        for i, q in enumerate(data.questions):
            sq = SurveyQuestion(
                survey_id=survey.id,
                label=q.label,
                question_type=q.question_type,
                options=_jdump(q.options) if q.options else None,
                image=q.image,
                is_required=q.is_required,
                sort_order=q.sort_order if q.sort_order is not None else i,
            )
            db.add(sq)
            new_qs.append(sq)
        db.flush()  # assign ids to the new question rows

        for old_q, new_q in zip(old_qs, new_qs):
            db.query(SurveyAnswer).filter(
                SurveyAnswer.question_id == old_q.id
            ).update({SurveyAnswer.question_id: new_q.id}, synchronize_session=False)

        old_ids = [q.id for q in old_qs]
        if old_ids:
            db.query(SurveyQuestion).filter(
                SurveyQuestion.id.in_(old_ids)
            ).delete(synchronize_session=False)

    db.commit()
    db.refresh(survey)
    return _survey_to_dict(survey)


@router.delete("/surveys/{survey_id}")
def delete_survey(
    survey_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    survey = db.query(Survey).filter(Survey.id == survey_id).first()
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    if survey.user_id != current_user.id and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Access denied")
    db.delete(survey)
    db.commit()
    return {"detail": "Survey deleted"}


@router.get("/surveys/{survey_id}/results")
def get_survey_results(
    survey_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    survey = db.query(Survey).filter(Survey.id == survey_id).first()
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    if survey.user_id != current_user.id and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Access denied")
    completed = [r for r in survey.responses if r.status == "complete"]
    # Canonical column order for the results table / CSV: survey-question order,
    # restricted to questions that actually have an answer (multi-select questions
    # expand to one column per option). Without this the frontend orders columns
    # by first-seen key across responses, scattering them out of survey order.
    q_map = _question_column_keys(survey.questions)
    columns = _result_column_order(survey, q_map)
    return {
        "survey_id": survey.id,
        "title": survey.title,
        "total_responses": len(completed),
        "columns": columns,
        "responses": _responses_to_list(survey),
    }


@router.delete("/surveys/{survey_id}/responses/{response_id}")
def delete_response(
    survey_id: int,
    response_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    survey = db.query(Survey).filter(Survey.id == survey_id).first()
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    if survey.user_id != current_user.id and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Access denied")
    resp = db.query(SurveyResponse).filter(
        SurveyResponse.id == response_id, SurveyResponse.survey_id == survey_id
    ).first()
    if not resp:
        raise HTTPException(status_code=404, detail="Response not found")
    db.delete(resp)
    db.commit()
    return {"detail": "Response deleted"}


# ── Image Upload ─────────────────────────────────────────

ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}

@router.post("/surveys/upload-image")
async def upload_survey_image(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        raise HTTPException(status_code=400, detail=f"Only images allowed: {', '.join(ALLOWED_IMAGE_EXT)}")

    upload_dir = os.path.join(settings.UPLOAD_DIR, "surveys", str(current_user.id))
    os.makedirs(upload_dir, exist_ok=True)

    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(upload_dir, filename)

    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    url = f"/uploads/surveys/{current_user.id}/{filename}"
    return {"url": url}


# ── Admin Endpoints ──────────────────────────────────────

@router.get("/admin/surveys")
def admin_list_surveys(
    db: Session = Depends(get_db),
    admin=Depends(get_super_admin),
):
    surveys = db.query(Survey).order_by(Survey.created_at.desc()).all()
    result = []
    for s in surveys:
        d = _survey_to_dict(s)
        d["owner_name"] = s.user.full_name if s.user else None
        d["owner_email"] = s.user.email if s.user else None
        result.append(d)
    return result


@router.delete("/admin/surveys/{survey_id}")
def admin_delete_survey(
    survey_id: int,
    db: Session = Depends(get_db),
    admin=Depends(get_super_admin),
):
    survey = db.query(Survey).filter(Survey.id == survey_id).first()
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    db.delete(survey)
    db.commit()
    return {"detail": "Survey deleted by admin"}


# ── Public Endpoints (No Auth) ───────────────────────────

@router.post("/public/survey/upload-file")
async def upload_public_survey_file(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    allowed = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"}
    if ext not in allowed:
        raise HTTPException(status_code=400, detail="File type not allowed")

    upload_dir = os.path.join(settings.UPLOAD_DIR, "surveys", "public")
    os.makedirs(upload_dir, exist_ok=True)

    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(upload_dir, filename)

    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    url = f"/uploads/surveys/public/{filename}"
    return {"url": url}


@router.get("/public/survey/{token}")
def get_public_survey(token: str, db: Session = Depends(get_db)):
    survey = db.query(Survey).filter(Survey.token == token).first()
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    if survey.status != SurveyStatus.active:
        raise HTTPException(status_code=410, detail="This survey is not currently accepting responses")

    questions = []
    for q in survey.questions:
        opts = _parse_json_field(q.options)
        questions.append({
            "id": q.id,
            "label": q.label,
            "question_type": q.question_type.value if hasattr(q.question_type, 'value') else q.question_type,
            "options": opts,
            "image": q.image,
            "is_required": q.is_required,
            "sort_order": q.sort_order,
        })

    return {
        "title": survey.title,
        "description": survey.description,
        "cover_image": survey.cover_image,
        "intro_fields": _parse_json_field(survey.intro_fields),
        "settings": _parse_json_field(survey.settings),
        "questions": questions,
    }


def _find_response_by_unique_intro(db: Session, survey: Survey, intro_data: dict) -> Optional[SurveyResponse]:
    """Match an existing response on any intro field marked is_unique.
    Returns the latest matching response, regardless of status."""
    intro_fields = _parse_json_field(survey.intro_fields) or []
    unique_labels = [f["label"] for f in intro_fields if f.get("is_unique") and f.get("label")]
    if not unique_labels:
        return None
    candidates = [
        (lbl, (intro_data.get(lbl) or "").strip().lower())
        for lbl in unique_labels
    ]
    candidates = [(lbl, val) for (lbl, val) in candidates if val]
    if not candidates:
        return None
    # Survey response counts per survey are small; iterate in Python rather than
    # touching DB-specific JSON predicates.
    responses = (
        db.query(SurveyResponse)
        .filter(SurveyResponse.survey_id == survey.id)
        .order_by(SurveyResponse.submitted_at.desc())
        .all()
    )
    for r in responses:
        existing = _parse_json_field(r.intro_data) or {}
        for lbl, val in candidates:
            if (existing.get(lbl) or "").strip().lower() == val:
                return r
    return None


def _response_to_resume_dict(response: SurveyResponse) -> dict:
    answers = {str(a.question_id): a.answer_text for a in response.answers}
    return {
        "response_id": response.id,
        "intro_data": _parse_json_field(response.intro_data) or {},
        "answers": answers,
        "last_question_id": response.last_question_id,
    }


@router.post("/public/survey/{token}/lookup")
def lookup_public_survey(
    token: str,
    data: PublicLookupSchema,
    db: Session = Depends(get_db),
):
    """Check if the respondent (matched by any is_unique intro field) has
    submitted this survey or has a partial in-progress response.

    Returns one of:
      - { status: 'new' }
      - { status: 'already_submitted' }
      - { status: 'resume', ...response_to_resume_dict }
    """
    survey = db.query(Survey).filter(Survey.token == token).first()
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    if survey.status != SurveyStatus.active:
        raise HTTPException(status_code=410, detail="This survey is not currently accepting responses")

    existing = _find_response_by_unique_intro(db, survey, data.intro_data or {})
    if not existing:
        return {"status": "new"}
    if existing.status == "complete":
        return {"status": "already_submitted"}
    return {"status": "resume", **_response_to_resume_dict(existing)}


@router.post("/public/survey/{token}/save-partial")
def save_partial_public_survey(
    token: str,
    data: PublicPartialSaveSchema,
    db: Session = Depends(get_db),
):
    """Upsert a partial (in-progress) response. Used between page transitions
    so a respondent can resume from the last unanswered question if they leave
    and come back with the same unique-field value."""
    survey = db.query(Survey).filter(Survey.token == token).first()
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    if survey.status != SurveyStatus.active:
        raise HTTPException(status_code=410, detail="This survey is not currently accepting responses")

    intro_data = data.intro_data or {}
    response: Optional[SurveyResponse] = None
    if data.response_id:
        response = db.query(SurveyResponse).filter(
            SurveyResponse.id == data.response_id,
            SurveyResponse.survey_id == survey.id,
        ).first()
        # Don't let a finalized response be silently re-opened.
        if response and response.status == "complete":
            raise HTTPException(status_code=409, detail="Response already submitted")

    if response is None:
        # Try to find existing partial by unique-field match before creating new.
        existing = _find_response_by_unique_intro(db, survey, intro_data)
        if existing and existing.status == "partial":
            response = existing
        elif existing and existing.status == "complete":
            raise HTTPException(status_code=409, detail="Response already submitted")

    if response is None:
        response = SurveyResponse(
            survey_id=survey.id,
            respondent_name=data.intro_data.get("Name") or data.intro_data.get("name") if data.intro_data else None,
            respondent_email=data.intro_data.get("Email") or data.intro_data.get("email") if data.intro_data else None,
            intro_data=_jdump(intro_data) if intro_data else None,
            status="partial",
            last_question_id=data.last_question_id,
        )
        db.add(response)
        db.flush()
    else:
        response.intro_data = _jdump(intro_data) if intro_data else None
        response.last_question_id = data.last_question_id
        if intro_data:
            response.respondent_name = intro_data.get("Name") or intro_data.get("name") or response.respondent_name
            response.respondent_email = intro_data.get("Email") or intro_data.get("email") or response.respondent_email

    # Replace answer rows with the latest snapshot.
    q_ids = {q.id for q in survey.questions}
    db.query(SurveyAnswer).filter(SurveyAnswer.response_id == response.id).delete()
    for ans in data.answers:
        if ans.question_id in q_ids:
            db.add(SurveyAnswer(
                response_id=response.id,
                question_id=ans.question_id,
                answer_text=ans.answer_text,
            ))
    db.commit()
    db.refresh(response)
    return _response_to_resume_dict(response)


@router.post("/public/survey/{token}/submit")
def submit_public_survey(
    token: str,
    data: PublicSubmitSchema,
    db: Session = Depends(get_db),
):
    survey = db.query(Survey).filter(Survey.token == token).first()
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    if survey.status != SurveyStatus.active:
        raise HTTPException(status_code=410, detail="This survey is not currently accepting responses")

    # Validate required intro fields
    intro_fields = _parse_json_field(survey.intro_fields) or []
    intro_data = data.intro_data or {}
    for field in intro_fields:
        if field.get("is_required") and not (intro_data.get(field["label"]) or "").strip():
            raise HTTPException(status_code=400, detail=f"'{field['label']}' is required")

    # Validate required questions — only those the user actually visited (for logic-based surveys)
    q_map = {q.id: q for q in survey.questions}
    answer_map = {a.question_id: a.answer_text for a in data.answers}
    answered_qids = {a.question_id for a in data.answers}

    for q in survey.questions:
        # Only enforce required on questions that were answered (logic may skip some)
        if q.is_required and q.id in answered_qids and not answer_map.get(q.id, "").strip():
            raise HTTPException(status_code=400, detail=f"Question '{q.label}' is required")

    response: Optional[SurveyResponse] = None
    if data.response_id:
        response = db.query(SurveyResponse).filter(
            SurveyResponse.id == data.response_id,
            SurveyResponse.survey_id == survey.id,
        ).first()
        if response and response.status == "complete":
            raise HTTPException(status_code=409, detail="Response already submitted")
    if response is None:
        # Don't allow a brand-new complete submission if a complete one already exists for a unique-field match.
        existing = _find_response_by_unique_intro(db, survey, intro_data)
        if existing and existing.status == "complete":
            raise HTTPException(status_code=409, detail="You have already filled this survey.")
        if existing and existing.status == "partial":
            response = existing  # finalize the partial in-place

    if response is None:
        response = SurveyResponse(
            survey_id=survey.id,
            respondent_name=data.respondent_name,
            respondent_email=data.respondent_email,
            intro_data=_jdump(intro_data) if intro_data else None,
            status="complete",
        )
        db.add(response)
        db.flush()
    else:
        response.respondent_name = data.respondent_name or response.respondent_name
        response.respondent_email = data.respondent_email or response.respondent_email
        response.intro_data = _jdump(intro_data) if intro_data else None
        response.status = "complete"
        response.last_question_id = None
        # Replace prior partial answers with the final snapshot.
        db.query(SurveyAnswer).filter(SurveyAnswer.response_id == response.id).delete()

    for ans in data.answers:
        if ans.question_id in q_map:
            sa = SurveyAnswer(
                response_id=response.id,
                question_id=ans.question_id,
                answer_text=ans.answer_text,
            )
            db.add(sa)

    db.commit()
    return {"detail": "Response submitted successfully", "response_id": response.id}
