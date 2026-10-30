"""
Engagement roll-ups for the organizer / Turacoz / client dashboard.

Every figure in "KOL dashboard Advisory Board-Dr Shruti" for the non-expert
audience is computed here, once, so the organizer's view and the client's view
of the same meeting can never disagree.

Definitions, because several of them are easy to get subtly wrong:

* An **expert** is a meeting participant who is not the organizer and not
  internal team — the people the engagement question is actually about. Everyone
  invited counts as a denominator whether or not they ever showed up; "number of
  experts yet to refer to any of the reading material" is meaningless otherwise.

* **Referred to / opened** means at least one `MeetingDocumentView` row — either
  opening it in the portal viewer or downloading it. Downloading is referring.

* **Time** comes only from viewer sessions. A download contributes 0, because
  once the file is on someone's laptop we cannot know how long they read it.
  Sections whose only activity is downloads therefore report "no timing data"
  rather than an average of zero, which would read as "nobody read it".

* **Average time on a section** averages over the experts who opened it, not
  over all experts — the question is how long a reader spent, not how long the
  average invitee spent including the ones who never opened it.
"""
import html as _html
import re
from typing import Optional

from sqlalchemy.orm import Session

import json

from app.models.meeting import BoardMeeting, MeetingAgendaItem
from app.models.hcp import HCPProfile
from app.models.meeting_participant import MeetingParticipant, ParticipantRole
from app.models.meeting_document import MeetingDocument
from app.models.meeting_document_view import MeetingDocumentView, ViewSource
from app.models.meeting_session_comment import MeetingSessionComment
from app.services import session_discussion
from app.models.meeting_engagement import MeetingSurvey
from app.models.survey import SurveyQuestion, SurveyResponse, SurveyAnswer
from app.services.survey_nps import nps_summary


def _enum_value(v):
    return v.value if hasattr(v, "value") else v


# Survey elements that are layout, not questions. A section header carries the
# survey's intro copy and a page break carries nothing at all — listing them as
# "Q1. <p>Dear Dermatologist…</p> — 0 answered" is noise that pushes the real
# questions off the screen.
_NON_QUESTION_TYPES = {"section_header", "page_break"}

# Question labels are authored in a rich-text editor, so they arrive as HTML.
# The results view is a summary, not the survey itself, so it wants the words.
_TAG_RE = re.compile(r"<[^>]+>")


def _plain_text(value: Optional[str]) -> str:
    """HTML label -> readable single-line text.

    Block-level tags become spaces so "</p><p>" does not glue two sentences
    together, then entities are decoded (&nbsp; is rife in pasted Word content)
    and runs of whitespace collapsed.
    """
    if not value:
        return ""
    text = re.sub(r"<(br|/p|/div|/li|/h[1-6])\s*/?>", " ", value, flags=re.I)
    text = _TAG_RE.sub("", text)
    text = _html.unescape(text)
    return re.sub(r"\s+", " ", text).replace("\xa0", " ").strip()


# Roles that run the meeting rather than attend it as an advisor.
_NON_EXPERT_ROLES = {ParticipantRole.host.value, ParticipantRole.moderator.value}


def _is_expert(mp: MeetingParticipant, meeting: BoardMeeting) -> bool:
    if mp.user_id and meeting.organizer_id and mp.user_id == meeting.organizer_id:
        return False
    return _enum_value(mp.role) not in _NON_EXPERT_ROLES


def _display(mp: MeetingParticipant):
    """(name, organization) — mirrors meetings._participant_identity without
    importing an endpoint module into a service.

    Must cover all THREE identity columns. Missing one does not degrade
    gracefully: the caller drops any row with no name, so an unhandled source
    disappears from the expert list entirely.
    """
    if mp.hcp_id and mp.hcp:
        return mp.hcp.full_name, mp.hcp.institution
    if mp.board_kol_id and mp.board_kol:
        return mp.board_kol.name, mp.board_kol.affiliation
    if mp.user_id and mp.user:
        return mp.user.full_name, mp.user.organization
    return None, None


def build_engagement(db: Session, meeting: BoardMeeting) -> dict:
    board = meeting.board

    # ── Experts ──────────────────────────────────────────────────────────
    experts = [mp for mp in meeting.participants if _is_expert(mp, meeting)]
    expert_by_id = {mp.id: mp for mp in experts}

    def _expert_dict(mp: MeetingParticipant) -> dict:
        name, org = _display(mp)
        return {
            "id": mp.id,
            "name": name,
            "organization": org,
            "profile_path": f"/hcp/{mp.hcp_id}" if mp.hcp_id else None,
            "role": _enum_value(mp.role),
            "joined_at": mp.joined_at.isoformat() if mp.joined_at else None,
        }

    expert_rows = sorted(
        (e for e in (_expert_dict(mp) for mp in experts) if e["name"]),
        key=lambda e: e["name"].lower(),
    )
    name_of = {e["id"]: e["name"] for e in expert_rows}
    total_experts = len(expert_rows)

    # ── Sessions ─────────────────────────────────────────────────────────
    sessions = sorted(meeting.agenda_items, key=lambda a: (a.sequence or 0, a.id))

    doc_counts: dict = {}
    for d in db.query(MeetingDocument).filter(
        MeetingDocument.meeting_id == meeting.id,
        MeetingDocument.is_enabled.is_(True),
        MeetingDocument.kol_visible.is_(True),
    ).all():
        doc_counts[d.agenda_item_id] = doc_counts.get(d.agenda_item_id, 0) + 1

    # ── Views ────────────────────────────────────────────────────────────
    views = db.query(MeetingDocumentView).filter(
        MeetingDocumentView.meeting_id == meeting.id
    ).all()

    # readers[section_id] -> set of participant ids
    # seconds[section_id][participant_id] -> total seconds from viewer sessions
    readers: dict = {}
    seconds: dict = {}
    readers_any: set = set()
    for v in views:
        if v.participant_id not in expert_by_id:
            continue        # organizer/team activity is not expert engagement
        readers_any.add(v.participant_id)
        readers.setdefault(v.agenda_item_id, set()).add(v.participant_id)
        if _enum_value(v.source) == ViewSource.view.value and (v.seconds_spent or 0) > 0:
            per = seconds.setdefault(v.agenda_item_id, {})
            per[v.participant_id] = per.get(v.participant_id, 0) + int(v.seconds_spent or 0)

    # ── Comments ─────────────────────────────────────────────────────────
    comments = db.query(MeetingSessionComment).filter(
        MeetingSessionComment.meeting_id == meeting.id
    ).order_by(MeetingSessionComment.created_at.asc()).all()
    comments_by_session: dict = {}
    for c in comments:
        # The thread now carries client and team replies as well as the panel's
        # own comments, so the rollup says which side each one came from rather
        # than presenting a reply from the organizer as an expert's engagement.
        kind = c.author_type or session_discussion.PARTICIPANT
        comments_by_session.setdefault(c.agenda_item_id, []).append({
            "id": c.id,
            "expert_name": c.author_name or name_of.get(c.participant_id) or "Participant",
            "author_type": kind,
            "author_label": session_discussion.AUTHOR_LABEL.get(kind, "Participant"),
            "body": c.body,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        })

    # ── Per-section rows ─────────────────────────────────────────────────
    section_rows = []
    for idx, a in enumerate(sessions, start=1):
        r = readers.get(a.id, set())
        per_expert = seconds.get(a.id, {})
        timed = list(per_expert.values())
        section_rows.append({
            "id": a.id,
            "index": idx,
            "title": a.title,
            "document_count": doc_counts.get(a.id, 0),
            "opened_count": len(r),
            "opened_pct": round(100 * len(r) / total_experts) if total_experts else 0,
            "opened_names": sorted((name_of[p] for p in r if p in name_of), key=str.lower),
            "not_opened_names": sorted(
                (e["name"] for e in expert_rows if e["id"] not in r), key=str.lower
            ),
            # None, not 0 — see the module docstring. A section read only via
            # downloads has no timing, and reporting 0 would read as "unread".
            "avg_seconds": round(sum(timed) / len(timed)) if timed else None,
            "timed_expert_count": len(timed),
            "comments": comments_by_session.get(a.id, []),
            "comment_count": len(comments_by_session.get(a.id, [])),
        })

    # Experts who referred to EVERY section that actually has material. A
    # section with nothing uploaded cannot be held against anyone.
    sections_with_docs = [s for s in section_rows if s["document_count"] > 0]
    if sections_with_docs:
        all_sections_ids = set.intersection(
            *[readers.get(s["id"], set()) for s in sections_with_docs]
        )
    else:
        all_sections_ids = set()

    none_ids = {e["id"] for e in expert_rows} - readers_any

    summary = {
        "total_experts": total_experts,
        "referred_any_count": len(readers_any),
        "referred_any_pct": round(100 * len(readers_any) / total_experts) if total_experts else 0,
        "all_sections_count": len(all_sections_ids),
        "all_sections_names": sorted((name_of[p] for p in all_sections_ids if p in name_of), key=str.lower),
        "none_count": len(none_ids),
        "none_names": sorted((name_of[p] for p in none_ids if p in name_of), key=str.lower),
        "total_comments": len(comments),
        "sections_with_documents": len(sections_with_docs),
    }

    # ── The panel ────────────────────────────────────────────────────────
    # A KOL can be a participant and a participant can be a KOL — they are the
    # same people seen from two places: `advisory_boards.kol_ids` (assigned to
    # the board) and `meeting_participants.hcp_id` (invited to the meeting).
    # The client's Experts tab wants the union, deduped by HCP record, with the
    # difference made visible rather than hidden.
    #
    # Kept SEPARATE from `experts` above on purpose: `experts` is the engagement
    # denominator, and someone assigned to the board but never invited to the
    # meeting has had no chance to open anything. Folding them in would quietly
    # depress every percentage on the dashboard.
    panel = []
    seen_hcp = set()
    seen_board_kol = set()

    for mp in experts:
        row = _expert_dict(mp)
        if not row["name"]:
            continue
        hcp = mp.hcp if mp.hcp_id else None
        bk = mp.board_kol if mp.board_kol_id else None
        row.update({
            "hcp_id": mp.hcp_id,
            "board_kol_id": mp.board_kol_id,
            "specialty": (hcp.specialty if hcp else None) or (bk.specialty if bk else None),
            "affiliation": (hcp.institution if hcp else None) or (bk.affiliation if bk else None) or row.get("organization"),
            "country": (hcp.country if hcp else None) or (bk.country if bk else None),
            "invited": True,
            "opened_any": mp.id in readers_any,
            "sections_opened": sum(1 for sec in section_rows if mp.id in readers.get(sec["id"], set())),
            "comment_count": sum(1 for c in comments if c.participant_id == mp.id),
        })
        if mp.hcp_id:
            seen_hcp.add(mp.hcp_id)
        if mp.board_kol_id:
            seen_board_kol.add(mp.board_kol_id)
        panel.append(row)

    # Board-assigned KOLs who have not been invited to the meeting yet.
    try:
        assigned_ids = json.loads(board.kol_ids) if (board and board.kol_ids) else []
    except (TypeError, ValueError):
        assigned_ids = []
    # kol_ids entries are tagged by source ("hcp:31" / "own:5"). Only the HCP
    # ones resolve to a profile here; a board-own KOL has no hcp_profiles row,
    # so it is listed from its own table below.
    hcp_assigned = []
    own_assigned = []
    for v in assigned_ids:
        text = str(v).strip()
        if text.startswith("own:") and text[4:].isdigit():
            own_assigned.append(int(text[4:]))
        elif text.startswith("hcp:") and text[4:].isdigit():
            hcp_assigned.append(int(text[4:]))
        elif text.isdigit():
            hcp_assigned.append(int(text))   # pre-tagging rows
    assigned_ids = [i for i in hcp_assigned if i not in seen_hcp]
    if assigned_ids:
        for h in db.query(HCPProfile).filter(HCPProfile.id.in_(assigned_ids)).all():
            panel.append({
                "id": f"hcp-{h.id}",
                "hcp_id": h.id,
                "name": h.full_name,
                "organization": h.institution,
                "affiliation": h.institution,
                "specialty": h.specialty,
                "country": h.country,
                "profile_path": f"/hcp/{h.id}",
                "role": None,
                "joined_at": None,
                # The honest distinction: on the panel, but with no meeting
                # invitation yet, so no engagement can exist for them.
                "invited": False,
                "opened_any": False,
                "sections_opened": 0,
                "comment_count": 0,
            })

    # Board-own KOLs (no HCP profile, so no engagement can exist for them).
    own_assigned = [i for i in own_assigned if i not in seen_board_kol]
    if own_assigned:
        from app.models.board_kol import BoardKol
        for k in db.query(BoardKol).filter(BoardKol.id.in_(own_assigned)).all():
            panel.append({
                "id": f"own-{k.id}",
                "hcp_id": None,
                "name": k.name,
                "organization": k.affiliation,
                "affiliation": k.affiliation,
                "specialty": k.specialty,
                "country": k.country,
                "profile_path": None,
                "role": None,
                "joined_at": None,
                "invited": False,
                "opened_any": False,
                "sections_opened": 0,
                "comment_count": 0,
            })

    panel.sort(key=lambda e: (e["name"] or "").lower())

    # ── Surveys, question by question ────────────────────────────────────
    surveys = []
    for link in db.query(MeetingSurvey).filter(MeetingSurvey.meeting_id == meeting.id).all():
        s = link.survey
        if not s:
            continue
        questions = db.query(SurveyQuestion).filter(
            SurveyQuestion.survey_id == s.id
        ).order_by(SurveyQuestion.sort_order.asc(), SurveyQuestion.id.asc()).all()
        responses = db.query(SurveyResponse).filter(
            SurveyResponse.survey_id == s.id,
            SurveyResponse.status == "complete",
        ).all()
        response_ids = [r.id for r in responses]
        name_by_response = {r.id: (r.respondent_name or r.respondent_email or "Anonymous") for r in responses}

        answers_by_q: dict = {}
        if response_ids:
            for a in db.query(SurveyAnswer).filter(SurveyAnswer.response_id.in_(response_ids)).all():
                answers_by_q.setdefault(a.question_id, []).append(a)

        q_rows = []
        for q in questions:
            if _enum_value(q.question_type) in _NON_QUESTION_TYPES:
                continue
            rows = answers_by_q.get(q.id, [])
            # Choice questions get counted; free text is listed verbatim, since
            # tallying distinct sentences tells the organizer nothing.
            tally: dict = {}
            texts = []
            for a in rows:
                val = (a.answer_text or "").strip()
                if not val:
                    continue
                if _enum_value(q.question_type) in ("text", "textarea", "long_text", "short_text"):
                    texts.append({"expert_name": name_by_response.get(a.response_id, "Anonymous"), "answer": val})
                else:
                    # checkbox/multi-select answers arrive comma-joined
                    for part in [p.strip() for p in val.split(",")] if "," in val else [val]:
                        if part:
                            tally[part] = tally.get(part, 0) + 1
            q_row = {
                "id": q.id,
                # Plain text, not the stored HTML — see _plain_text.
                "label": _plain_text(q.label),
                "type": _enum_value(q.question_type),
                "answered_count": len({a.response_id for a in rows}),
                "options": sorted(
                    ({"label": k, "count": v} for k, v in tally.items()),
                    key=lambda o: (-o["count"], o["label"]),
                ),
                "text_answers": texts,
            }
            if _enum_value(q.question_type) == "nps":
                q_row["nps"] = nps_summary(a.answer_text for a in rows)
            q_rows.append(q_row)

        for i, row in enumerate(q_rows, start=1):
            row["number"] = i

        surveys.append({
            "id": s.id,
            "title": _plain_text(s.title) or s.title,
            "phase": _enum_value(link.phase),
            "token": s.token,
            "response_count": len(responses),
            "response_pct": round(100 * len(responses) / total_experts) if total_experts else 0,
            "questions": q_rows,
        })

    # ── Meeting particulars (same block the expert sees) ──────────────────
    from app.api.endpoints.meeting_join import _maps_url   # local import: avoids a cycle
    when = meeting.scheduled_at
    venue = board.venue if board else None
    details = {
        "topic": (board.title if board else None) or meeting.title,
        "meeting_title": meeting.title,
        "agenda_summary": meeting.agenda_summary,
        "save_the_date": when.date().isoformat() if when else None,
        "time": f"{when:%H:%M}" if when else None,
        "duration_minutes": meeting.duration_minutes,
        "scheduled_at": when.isoformat() if when else None,
        "format": _enum_value(meeting.format),
        "status": _enum_value(meeting.status),
        "venue": venue,
        "venue_map_url": _maps_url(venue),
    }

    return {
        "details": details,
        "experts": expert_rows,
        # Union of board-assigned KOLs and invited participants — see above.
        "panel": panel,
        "total_sections": len(section_rows),
        "summary": summary,
        "sections": section_rows,
        "surveys": surveys,
    }
