"""
Board completion-status dashboard for Medical Writers / Project Managers.

Aggregates, for one advisory board, the progress of everything that needs to get
done across its meetings: meeting statuses, documents & transcripts, minutes &
manuscripts, pre/post surveys, live polls, and client document approvals.

Access mirrors board management (`_check_board_access`): platform admins, the
board creator, and any MABM team member with `boards.manage` (incl. medical
writers & turacoz/PM team).
"""
from collections import Counter
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.meeting import BoardMeeting
from app.models.meeting_document import MeetingDocument
from app.models.meeting_recording import MeetingTranscript
from app.models.meeting_minutes import MeetingMinutes
from app.models.manuscript import Manuscript
from app.models.meeting_engagement import MeetingSurvey, MeetingPoll, SurveyPhase
from app.models.survey import SurveyResponse
from app.models.poll import PollVote
from app.models.board_client import DocumentApproval, BoardClient
from app.api.endpoints.advisory_boards import _get_board_or_404, _check_board_access, _enum_value

router = APIRouter(tags=["MABM - Board Status"])


def _counts(values):
    """A {value: count} dict from an iterable of enum/string statuses."""
    return dict(Counter(_enum_value(v) for v in values))


@router.get("/advisory-boards/{board_id}/status")
def get_board_status(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)

    meetings = db.query(BoardMeeting).filter(
        BoardMeeting.board_id == board_id
    ).order_by(BoardMeeting.scheduled_at.asc()).all()
    meeting_ids = [m.id for m in meetings]

    # Empty board → all-zero shape (avoid IN () queries).
    if not meeting_ids:
        docs = transcripts = minutes = manuscripts = []
        survey_links = poll_links = approvals = []
    else:
        docs = db.query(MeetingDocument).filter(MeetingDocument.meeting_id.in_(meeting_ids)).all()
        transcripts = db.query(MeetingTranscript).filter(MeetingTranscript.meeting_id.in_(meeting_ids)).all()
        minutes = db.query(MeetingMinutes).filter(MeetingMinutes.meeting_id.in_(meeting_ids)).all()
        manuscripts = db.query(Manuscript).filter(Manuscript.meeting_id.in_(meeting_ids)).all()
        survey_links = db.query(MeetingSurvey).filter(MeetingSurvey.meeting_id.in_(meeting_ids)).all()
        poll_links = db.query(MeetingPoll).filter(MeetingPoll.meeting_id.in_(meeting_ids)).all()
        approvals = (
            db.query(DocumentApproval)
            .join(MeetingDocument, DocumentApproval.document_id == MeetingDocument.id)
            .filter(MeetingDocument.meeting_id.in_(meeting_ids))
            .all()
        )

    # Engagement response/vote counts (completed only) for the linked surveys/polls.
    survey_ids = list({l.survey_id for l in survey_links})
    poll_ids = list({l.poll_id for l in poll_links})
    survey_responses = (
        db.query(SurveyResponse).filter(
            SurveyResponse.survey_id.in_(survey_ids), SurveyResponse.status == "complete"
        ).count() if survey_ids else 0
    )
    poll_votes = db.query(PollVote).filter(PollVote.poll_id.in_(poll_ids)).count() if poll_ids else 0

    transcript_by_meeting = {t.meeting_id: _enum_value(t.status) for t in transcripts}
    minutes_by_meeting = {mn.meeting_id: _enum_value(mn.status) for mn in minutes}
    docs_by_meeting = Counter(d.meeting_id for d in docs)

    return {
        "board": {
            "id": board.id,
            "title": board.title,
            "status": _enum_value(board.status),
            "current_phase": _enum_value(board.current_phase),
        },
        "meetings": {"total": len(meetings), "by_status": _counts(m.status for m in meetings)},
        "documents": {
            "total": len(docs),
            "client_visible": sum(1 for d in docs if d.client_visible),
            "enabled": sum(1 for d in docs if d.is_enabled),
        },
        "transcripts": {
            "total": len(transcripts),
            "by_status": _counts(t.status for t in transcripts),
            "missing": len(meetings) - len(transcripts),
        },
        "minutes": {
            "total": len(minutes),
            "by_status": _counts(mn.status for mn in minutes),
            "missing": len(meetings) - len(minutes),
        },
        "manuscripts": {"total": len(manuscripts), "by_status": _counts(ms.status for ms in manuscripts)},
        "engagements": {
            "pre_surveys": sum(1 for l in survey_links if _enum_value(l.phase) == SurveyPhase.pre.value),
            "post_surveys": sum(1 for l in survey_links if _enum_value(l.phase) == SurveyPhase.post.value),
            "polls": len(poll_links),
            "survey_responses": survey_responses,
            "poll_votes": poll_votes,
        },
        "approvals": {"total": len(approvals), "by_status": _counts(a.status for a in approvals)},
        "clients": db.query(BoardClient).filter(BoardClient.board_id == board_id).count(),
        "per_meeting": [
            {
                "id": m.id,
                "title": m.title,
                "status": _enum_value(m.status),
                "scheduled_at": m.scheduled_at.isoformat() if m.scheduled_at else None,
                "documents": docs_by_meeting.get(m.id, 0),
                "transcript_status": transcript_by_meeting.get(m.id),
                "minutes_status": minutes_by_meeting.get(m.id),
            }
            for m in meetings
        ],
    }
