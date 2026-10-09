"""
Link/unlink existing /surveys and /polls to MABM meetings, plus a
"pending pre-meeting surveys" widget endpoint for the participant dashboard.

Authorization:
  - Link/unlink: meeting manager (organizer / board owner / platform admin / MABM meetings.manage)
  - List linked engagements: anyone who can view the meeting
  - Pending widget: scoped to the current user's own participations
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.meeting import BoardMeeting
from app.models.meeting_participant import MeetingParticipant
from app.models.meeting_engagement import MeetingSurvey, MeetingPoll, SurveyPhase, PollPhase
from app.models.survey import Survey, SurveyResponse
from app.models.poll import Poll
from app.services import board_notify
from app.services.mabm_access import user_has_mabm_capability, get_user_mabm_capabilities
from app.services.meeting_engagement_stats import build_engagement
from app.services import session_discussion
from app.models.meeting_session_comment import MeetingSessionComment
from app.models.meeting import MeetingAgendaItem

router = APIRouter(tags=["MABM - Engagements"])


# ── Schemas ──────────────────────────────────────────────

class LinkSurvey(BaseModel):
    survey_id: int
    phase: str   # pre | post


class LinkPoll(BaseModel):
    poll_id: int


# ── Helpers (mirrors meetings.py) ────────────────────────

_VIEW_GRANTING_CAPS = {"meetings.manage", "documents.manage", "transcripts.manage", "minutes.manage"}


def _is_platform_admin(user: User) -> bool:
    role = user.role.value if hasattr(user.role, "value") else user.role
    return role in ("super_admin", "admin")


def _enum_value(v):
    return v.value if hasattr(v, "value") else v


def _get_meeting_or_404(meeting_id: int, db: Session) -> BoardMeeting:
    m = db.query(BoardMeeting).filter(BoardMeeting.id == meeting_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return m


def _user_can_view_meeting(user: User, meeting: BoardMeeting, db: Session) -> bool:
    if _is_platform_admin(user):
        return True
    if meeting.organizer_id == user.id:
        return True
    if meeting.board and meeting.board.created_by == user.id:
        return True
    if db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting.id,
        MeetingParticipant.user_id == user.id,
    ).first() is not None:
        return True
    return bool(get_user_mabm_capabilities(user, db) & _VIEW_GRANTING_CAPS)


def _user_can_manage_meeting(user: User, meeting: BoardMeeting, db: Session) -> bool:
    if _is_platform_admin(user):
        return True
    if meeting.organizer_id == user.id:
        return True
    if meeting.board and meeting.board.created_by == user.id:
        return True
    return user_has_mabm_capability(user, db, "meetings.manage")


def _link_survey_to_dict(link: MeetingSurvey) -> dict:
    s = link.survey
    return {
        "id": link.id,
        "meeting_id": link.meeting_id,
        "survey_id": link.survey_id,
        "phase": _enum_value(link.phase),
        "title": s.title if s else None,
        "token": s.token if s else None,
        "status": (_enum_value(s.status) if s else None),
        "response_count": len(s.responses) if s else 0,
        "created_at": link.created_at.isoformat(),
    }


def _link_poll_to_dict(link: MeetingPoll) -> dict:
    p = link.poll
    return {
        "id": link.id,
        "meeting_id": link.meeting_id,
        "poll_id": link.poll_id,
        "phase": _enum_value(link.phase),
        "title": p.title if p else None,
        "token": p.token if p else None,
        "status": (_enum_value(p.status) if p else None),
        "vote_count": len(p.votes) if (p and hasattr(p, "votes")) else None,
        "created_at": link.created_at.isoformat(),
    }


# ── Surveys ──────────────────────────────────────────────

@router.get("/meetings/{meeting_id}/surveys")
def list_meeting_surveys(
    meeting_id: int,
    phase: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_view_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    q = db.query(MeetingSurvey).filter(MeetingSurvey.meeting_id == meeting_id)
    if phase:
        q = q.filter(MeetingSurvey.phase == phase)
    return [_link_survey_to_dict(l) for l in q.order_by(MeetingSurvey.created_at.desc()).all()]


@router.post("/meetings/{meeting_id}/surveys", status_code=201)
def link_meeting_survey(
    meeting_id: int,
    data: LinkSurvey,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_manage_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    if data.phase not in (SurveyPhase.pre.value, SurveyPhase.post.value):
        raise HTTPException(status_code=400, detail=f"Invalid phase: {data.phase}. Use 'pre' or 'post'.")
    if not db.query(Survey).filter(Survey.id == data.survey_id).first():
        raise HTTPException(status_code=404, detail=f"Survey {data.survey_id} not found")

    link = MeetingSurvey(
        meeting_id=meeting_id,
        survey_id=data.survey_id,
        phase=data.phase,
        created_by=current_user.id,
    )
    db.add(link)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That survey is already linked to this meeting in this phase")
    db.refresh(link)
    survey = db.query(Survey).filter(Survey.id == data.survey_id).first()
    try:
        board_notify.notify_board(
            db, meeting.board_id,
            subject=f"New survey to complete: {meeting.title}",
            body_html=board_notify.build_body(
                f"A survey is ready — {meeting.title}",
                [f"<strong>{survey.title if survey else 'A survey'}</strong> ({data.phase}-meeting) is now available in your meeting portal."],
            ),
            include_team=False, meeting_id=meeting_id,
        )
    except Exception:
        pass
    return _link_survey_to_dict(link)


@router.delete("/meetings/{meeting_id}/surveys/{link_id}")
def unlink_meeting_survey(
    meeting_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_manage_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    link = db.query(MeetingSurvey).filter(
        MeetingSurvey.id == link_id, MeetingSurvey.meeting_id == meeting_id
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Survey link not found")
    db.delete(link)
    db.commit()
    return {"detail": "Survey unlinked"}


# ── Polls ────────────────────────────────────────────────

@router.get("/meetings/{meeting_id}/polls")
def list_meeting_polls(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_view_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    links = db.query(MeetingPoll).filter(
        MeetingPoll.meeting_id == meeting_id
    ).order_by(MeetingPoll.created_at.desc()).all()
    return [_link_poll_to_dict(l) for l in links]


@router.post("/meetings/{meeting_id}/polls", status_code=201)
def link_meeting_poll(
    meeting_id: int,
    data: LinkPoll,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_manage_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    if not db.query(Poll).filter(Poll.id == data.poll_id).first():
        raise HTTPException(status_code=404, detail=f"Poll {data.poll_id} not found")

    link = MeetingPoll(
        meeting_id=meeting_id,
        poll_id=data.poll_id,
        phase=PollPhase.live.value,
        created_by=current_user.id,
    )
    db.add(link)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That poll is already linked to this meeting")
    db.refresh(link)
    poll = db.query(Poll).filter(Poll.id == data.poll_id).first()
    try:
        board_notify.notify_board(
            db, meeting.board_id,
            subject=f"New live poll: {meeting.title}",
            body_html=board_notify.build_body(
                f"A live poll is ready — {meeting.title}",
                [f"<strong>{getattr(poll, 'title', None) or getattr(poll, 'question', None) or 'A poll'}</strong> is now available in your meeting portal."],
            ),
            include_team=False, meeting_id=meeting_id,
        )
    except Exception:
        pass
    return _link_poll_to_dict(link)


@router.delete("/meetings/{meeting_id}/polls/{link_id}")
def unlink_meeting_poll(
    meeting_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_manage_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    link = db.query(MeetingPoll).filter(
        MeetingPoll.id == link_id, MeetingPoll.meeting_id == meeting_id
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Poll link not found")
    db.delete(link)
    db.commit()
    return {"detail": "Poll unlinked"}


# ── Dashboard widget: surveys this user still owes ───────

@router.get("/me/pending-pre-meeting-surveys")
def list_pending_pre_meeting_surveys(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns pre-meeting surveys for meetings the current user is a participant
    in, that they haven't responded to yet (matched by their email).

    Doc: "Display a pre-meeting survey on the dashboard until the survey is filled by the user."
    """
    # All meetings the user is invited to
    participant_meeting_ids = [
        mp.meeting_id for mp in db.query(MeetingParticipant.meeting_id).filter(
            MeetingParticipant.user_id == current_user.id
        ).all()
    ]
    if not participant_meeting_ids:
        return []

    # All pre-meeting survey links across those meetings
    links = db.query(MeetingSurvey).filter(
        MeetingSurvey.meeting_id.in_(participant_meeting_ids),
        MeetingSurvey.phase == SurveyPhase.pre.value,
    ).all()
    if not links:
        return []

    # Survey IDs the user has already responded to (matched by email)
    survey_ids = list({l.survey_id for l in links})
    responded_ids = {
        r.survey_id for r in db.query(SurveyResponse.survey_id).filter(
            SurveyResponse.survey_id.in_(survey_ids),
            SurveyResponse.respondent_email == current_user.email,
        ).all()
    }

    result = []
    for l in links:
        if l.survey_id in responded_ids:
            continue
        s = l.survey
        m = l.meeting
        if not s or not m:
            continue
        result.append({
            "link_id": l.id,
            "meeting_id": m.id,
            "meeting_title": m.title,
            "meeting_scheduled_at": m.scheduled_at.isoformat() if m.scheduled_at else None,
            "survey_id": s.id,
            "survey_title": s.title,
            "survey_token": s.token,   # respondent uses /public/survey/{token} to fill it
            "linked_at": l.created_at.isoformat(),
        })
    return result


# ── Engagement dashboard (organizer / Turacoz / client) ──────────────────────
# The non-expert half of "KOL dashboard Advisory Board-Dr Shruti": who read what,
# for how long, who said what, and how the survey came back question by question.
# Every figure is computed in app.services.meeting_engagement_stats so this and
# the client portal's copy can never disagree.

@router.get("/meetings/{meeting_id}/engagement")
def get_meeting_engagement(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Engagement roll-up for the people running the board.

    Gated on *view* rather than *manage*: an assigned medical writer needs to see
    how the panel is engaging in order to chase them, and they are not
    necessarily the organizer.
    """
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_view_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    return build_engagement(db, meeting)


# ── Session discussion (team side) ───────────────────────────────────────────
# The panel's per-session thread, which the organizer can now answer instead of
# only reading as a rollup on the Engagement tab. An expert who asks a question
# about session 2's slides gets the reply in the same place they asked it.


class SessionCommentReq(BaseModel):
    body: str


def _team_viewer(user: User, can_moderate: bool) -> session_discussion.Viewer:
    """The logged-in team member, as the discussion module sees them.

    Moderation sits here and nowhere else: the organizer side is the only one
    that may remove somebody else's comment, so a disagreement between two
    experts cannot be settled by one of them deleting the other.
    """
    return session_discussion.Viewer(
        kind=session_discussion.TEAM,
        id=user.id,
        name=user.full_name or user.email,
        can_post=True,
        can_moderate=can_moderate,
    )


@router.get("/meetings/{meeting_id}/discussion")
def get_meeting_discussion(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Every session's thread for one meeting.

    Gated on *view* for the same reason as the engagement roll-up: the medical
    writer chasing the panel needs to read what the panel said.
    """
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_view_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    viewer = _team_viewer(current_user, _user_can_manage_meeting(current_user, meeting, db))
    return session_discussion.build_discussion(db, meeting, viewer)


@router.post("/meetings/{meeting_id}/comments", status_code=201)
def add_meeting_comment(
    meeting_id: int,
    data: SessionCommentReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Answer the panel without tying it to one session."""
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_view_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    try:
        body = session_discussion.clean_body(data.body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    viewer = _team_viewer(current_user, _user_can_manage_meeting(current_user, meeting, db))
    c = session_discussion.add_comment(db, meeting, None, body, viewer)
    return session_discussion.comment_dict(c, viewer)


@router.delete("/meetings/{meeting_id}/comments/{comment_id}")
def delete_meeting_comment(
    meeting_id: int,
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a comment by id: your own, or anyone's with manage rights."""
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_view_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")
    c = db.query(MeetingSessionComment).filter(
        MeetingSessionComment.id == comment_id,
        MeetingSessionComment.meeting_id == meeting.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    viewer = _team_viewer(current_user, _user_can_manage_meeting(current_user, meeting, db))
    if not session_discussion.may_delete(c, viewer):
        raise HTTPException(status_code=403, detail="You can only delete your own comments.")
    db.delete(c)
    db.commit()
    return {"deleted": True}


@router.post("/meetings/{meeting_id}/sessions/{agenda_item_id}/comments", status_code=201)
def add_meeting_session_comment(
    meeting_id: int,
    agenda_item_id: int,
    data: SessionCommentReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Answer the panel on one session.

    *View*, not *manage*: replying to an expert is the ordinary work of whoever
    is running the board day to day, and they are not necessarily the organizer.
    Removing someone else's comment stays a manage-level act.
    """
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_view_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")

    item = session_discussion.get_session_or_none(db, meeting.id, agenda_item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        body = session_discussion.clean_body(data.body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    viewer = _team_viewer(current_user, _user_can_manage_meeting(current_user, meeting, db))
    c = session_discussion.add_comment(db, meeting, item, body, viewer)
    return session_discussion.comment_dict(c, viewer)


@router.delete("/meetings/{meeting_id}/sessions/{agenda_item_id}/comments/{comment_id}")
def delete_meeting_session_comment(
    meeting_id: int,
    agenda_item_id: int,
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a comment: your own, or anyone's if you can manage the meeting."""
    meeting = _get_meeting_or_404(meeting_id, db)
    if not _user_can_view_meeting(current_user, meeting, db):
        raise HTTPException(status_code=403, detail="Access denied")

    c = db.query(MeetingSessionComment).filter(
        MeetingSessionComment.id == comment_id,
        MeetingSessionComment.agenda_item_id == agenda_item_id,
        MeetingSessionComment.meeting_id == meeting.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")

    viewer = _team_viewer(current_user, _user_can_manage_meeting(current_user, meeting, db))
    if not session_discussion.may_delete(c, viewer):
        raise HTTPException(status_code=403, detail="You can only delete your own comments.")
    db.delete(c)
    db.commit()
    return {"deleted": True}
