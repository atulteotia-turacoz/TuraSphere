import json
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List, Any
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_user, get_super_admin
from app.models.user import User
from app.models.poll import Poll, PollVote, PollStatus

router = APIRouter(tags=["Polls"])


# ── Schemas ──────────────────────────────────────────────

class PollQuestionSchema(BaseModel):
    title: str
    options: List[Any]  # [{text, image}] or ["text"]
    allow_multiple: bool = False


class PollCreate(BaseModel):
    title: str
    description: Optional[str] = None
    cover_image: Optional[str] = None
    questions: List[PollQuestionSchema] = []
    show_results: bool = True
    require_name: bool = False


class PollUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    cover_image: Optional[str] = None
    questions: Optional[List[Any]] = None
    show_results: Optional[bool] = None
    require_name: Optional[bool] = None
    status: Optional[str] = None


class PublicVoteSchema(BaseModel):
    # {question_index: [selected_option_indices]}
    answers: dict
    voter_name: Optional[str] = None
    voter_email: Optional[str] = None


# ── Helpers ──────────────────────────────────────────────

def _parse_json(val):
    if not val:
        return None
    if isinstance(val, (list, dict)):
        return val
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return None


def _get_questions(poll: Poll):
    """Get questions list — supports both new multi-question and old single-question format."""
    qs = _parse_json(poll.questions)
    if qs:
        return qs
    # Fallback: old format (single question from title + options)
    opts = _parse_json(poll.options)
    if opts:
        return [{"title": poll.title, "options": opts, "allow_multiple": poll.allow_multiple}]
    return []


def _poll_to_dict(poll: Poll, include_votes: bool = False):
    questions = _get_questions(poll)
    result = {
        "id": poll.id,
        "user_id": poll.user_id,
        "title": poll.title,
        "description": poll.description,
        "cover_image": poll.cover_image,
        "questions": questions,
        "show_results": poll.show_results,
        "require_name": poll.require_name,
        "token": poll.token,
        "status": poll.status.value if hasattr(poll.status, 'value') else poll.status,
        "vote_count": len(poll.votes),
        "created_at": poll.created_at.isoformat(),
        "updated_at": poll.updated_at.isoformat(),
    }

    if include_votes:
        tallies = _compute_tallies(poll.votes, len(questions))
        result["tallies"] = tallies
        result["total_votes"] = len(poll.votes)
        result["votes"] = [{
            "id": v.id,
            "answers": _parse_json(v.selected_options) or {},
            "voter_name": v.voter_name,
            "voter_email": v.voter_email,
            "created_at": v.created_at.isoformat(),
        } for v in poll.votes]

    return result


def _compute_tallies(votes, num_questions):
    """Compute per-question tallies: {question_idx: {option_idx: count}}"""
    tallies = {}
    for v in votes:
        answers = _parse_json(v.selected_options) or {}
        for q_idx_str, selected in answers.items():
            q_idx = str(q_idx_str)
            if isinstance(selected, str):
                continue  # text answer, no tally
            if q_idx not in tallies:
                tallies[q_idx] = {}
            for opt_idx in (selected if isinstance(selected, list) else [selected]):
                if isinstance(opt_idx, str):
                    continue  # skip text values
                opt_key = str(opt_idx)
                tallies[q_idx][opt_key] = tallies[q_idx].get(opt_key, 0) + 1
    return tallies


# ── User Endpoints ───────────────────────────────────────

@router.post("/polls", status_code=201)
def create_poll(data: PollCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not data.questions:
        raise HTTPException(status_code=400, detail="At least one question is required")

    poll = Poll(
        user_id=current_user.id,
        title=data.title,
        description=data.description,
        cover_image=data.cover_image,
        questions=json.dumps([q.dict() for q in data.questions]),
        show_results=data.show_results,
        require_name=data.require_name,
        token=uuid.uuid4().hex,
        status=PollStatus.draft,
    )
    db.add(poll)
    db.commit()
    db.refresh(poll)
    return _poll_to_dict(poll)


@router.get("/polls")
def list_polls(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    polls = db.query(Poll).filter(Poll.user_id == current_user.id).order_by(Poll.created_at.desc()).all()
    return [_poll_to_dict(p) for p in polls]


@router.get("/polls/{poll_id}")
def get_poll(poll_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    poll = db.query(Poll).filter(Poll.id == poll_id).first()
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    if poll.user_id != current_user.id and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Access denied")
    return _poll_to_dict(poll, include_votes=True)


@router.put("/polls/{poll_id}")
def update_poll(poll_id: int, data: PollUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    poll = db.query(Poll).filter(Poll.id == poll_id).first()
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    if poll.user_id != current_user.id and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Access denied")

    if data.title is not None:
        poll.title = data.title
    if data.description is not None:
        poll.description = data.description
    if data.cover_image is not None:
        poll.cover_image = data.cover_image or None
    if data.questions is not None:
        poll.questions = json.dumps(data.questions)
    if data.show_results is not None:
        poll.show_results = data.show_results
    if data.require_name is not None:
        poll.require_name = data.require_name
    if data.status is not None:
        poll.status = data.status

    db.commit()
    db.refresh(poll)
    return _poll_to_dict(poll)


@router.delete("/polls/{poll_id}")
def delete_poll(poll_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    poll = db.query(Poll).filter(Poll.id == poll_id).first()
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    if poll.user_id != current_user.id and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Access denied")
    db.delete(poll)
    db.commit()
    return {"detail": "Poll deleted"}


@router.get("/polls/{poll_id}/results")
def get_poll_results(poll_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    poll = db.query(Poll).filter(Poll.id == poll_id).first()
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    if poll.user_id != current_user.id and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Access denied")
    return _poll_to_dict(poll, include_votes=True)


@router.delete("/polls/{poll_id}/votes/{vote_id}")
def delete_vote(poll_id: int, vote_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    poll = db.query(Poll).filter(Poll.id == poll_id).first()
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    if poll.user_id != current_user.id and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Access denied")
    vote = db.query(PollVote).filter(PollVote.id == vote_id, PollVote.poll_id == poll_id).first()
    if not vote:
        raise HTTPException(status_code=404, detail="Vote not found")
    db.delete(vote)
    db.commit()
    return {"detail": "Vote deleted"}


# ── Public Endpoints ─────────────────────────────────────

@router.get("/public/poll/{token}")
def get_public_poll(token: str, db: Session = Depends(get_db)):
    poll = db.query(Poll).filter(Poll.token == token).first()
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    if poll.status != PollStatus.active:
        raise HTTPException(status_code=410, detail="This poll is not currently accepting votes")

    questions = _get_questions(poll)
    result = {
        "title": poll.title,
        "description": poll.description,
        "cover_image": poll.cover_image,
        "questions": questions,
        "show_results": poll.show_results,
        "require_name": poll.require_name,
    }

    if poll.show_results:
        tallies = _compute_tallies(poll.votes, len(questions))
        result["tallies"] = tallies
        result["total_votes"] = len(poll.votes)

    return result


@router.post("/public/poll/{token}/vote")
def submit_vote(token: str, data: PublicVoteSchema, db: Session = Depends(get_db)):
    poll = db.query(Poll).filter(Poll.token == token).first()
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    if poll.status != PollStatus.active:
        raise HTTPException(status_code=410, detail="This poll is not currently accepting votes")

    questions = _get_questions(poll)
    if not data.answers:
        raise HTTPException(status_code=400, detail="Please answer at least one question")

    # Validate answers
    for q_idx_str, selected in data.answers.items():
        q_idx = int(q_idx_str)
        if q_idx < 0 or q_idx >= len(questions):
            raise HTTPException(status_code=400, detail="Invalid question")
        q = questions[q_idx]
        q_type = q.get("type", "choice")
        if q_type == "text":
            # Text answers are strings — no validation needed
            continue
        opts = q.get("options", [])
        sel_list = selected if isinstance(selected, list) else [selected]
        if not q.get("allow_multiple", False) and len(sel_list) > 1:
            raise HTTPException(status_code=400, detail=f"Question '{q['title']}' allows only one selection")
        for idx in sel_list:
            if isinstance(idx, str):
                continue  # text value in wrong field, skip
            if idx < 0 or idx >= len(opts):
                raise HTTPException(status_code=400, detail="Invalid option selected")

    if poll.require_name and not (data.voter_name or "").strip():
        raise HTTPException(status_code=400, detail="Name is required")

    vote = PollVote(
        poll_id=poll.id,
        selected_options=json.dumps(data.answers),
        voter_name=data.voter_name,
        voter_email=data.voter_email,
    )
    db.add(vote)
    db.commit()

    # Return updated tallies
    tallies = _compute_tallies(poll.votes, len(questions))
    # Include the just-added vote
    for q_idx_str, selected in data.answers.items():
        q_idx = str(q_idx_str)
        if isinstance(selected, str):
            continue  # text answer
        if q_idx not in tallies:
            tallies[q_idx] = {}
        for idx in (selected if isinstance(selected, list) else [selected]):
            if isinstance(idx, str):
                continue
            opt_key = str(idx)
            tallies[q_idx][opt_key] = tallies[q_idx].get(opt_key, 0) + 1

    return {
        "detail": "Vote submitted successfully",
        "tallies": tallies,
        "total_votes": len(poll.votes) + 1,
    }
