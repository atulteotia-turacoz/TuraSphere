"""
Team-side (authenticated) management of an advisory board's clients, plus the
team view of client document approvals and the board-level message thread.

The matching client-facing, token-gated endpoints live in client_portal.py.
"""
import uuid
import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.advisory_board import AdvisoryBoard
from app.models.meeting import BoardMeeting
from app.models.meeting_document import MeetingDocument
from app.models.board_client import BoardClient, DocumentApproval
from app.api.endpoints.advisory_boards import _get_board_or_404, _check_board_access, _enum_value
from app.services.board_activity import log_board_activity
from app.services import email_service, account_config
from app.models.email_log import EmailKind
from app.core.config import settings
from app.core.security import get_password_hash

logger = logging.getLogger(__name__)

router = APIRouter(tags=["MABM - Board Clients"])


# ── Schemas ──────────────────────────────────────────────

class BoardClientCreate(BaseModel):
    name: str
    email: str
    organization: Optional[str] = None
    # Whether adding the client also emails them the portal link. Defaults to
    # true — a client with a link nobody sent is the bug this closes — but the
    # account holder can turn it off and send it themselves later.
    send_invite: Optional[bool] = True


class BoardClientUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    organization: Optional[str] = None


class ClientPasswordSet(BaseModel):
    # Omit to have one generated. Send null/"" with clear=true to remove it.
    password: Optional[str] = None
    clear: Optional[bool] = False


# ── Helpers ──────────────────────────────────────────────

def _new_client_token() -> str:
    return uuid.uuid4().hex


def _client_portal_url(c: BoardClient) -> str:
    base = (settings.APP_PUBLIC_URL or "").rstrip("/")
    return f"{base}/client/{c.access_token}"


def _build_client_invite_email(board: AdvisoryBoard, c: BoardClient) -> str:
    """The client's portal-link email — the counterpart of the participant invite.

    Deliberately says what the portal is *for*. A client who receives a bare
    link with no context is likely to treat it as phishing and never open it.
    """
    portal_url = _client_portal_url(c)
    greeting = f"Hi {c.name}," if c.name else "Hello,"
    sponsor_row = (
        f'<tr><td style="padding:2px 12px 2px 0;color:#6b7280">Sponsor</td>'
        f'<td style="padding:2px 0">{board.sponsor}</td></tr>' if board.sponsor else ''
    )
    # The password is NEVER put in this email. Mailing the link and the password
    # together would hand both factors to anyone who reads or forwards the
    # message, which is the exact risk the password exists to cover.
    password_note = (
        '<p style="margin:10px 0;font-size:13px;color:#374151">'
        'This portal is password protected. The project team will send you the '
        'password separately — you will be asked for it when you open the link.'
        '</p>' if c.password_hash else ''
    )
    return f"""\
<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.6">
  <p>{greeting}</p>
  <p>You have been given access to the client portal for the advisory board
     <strong>{board.title}</strong>.</p>
  <table style="border-collapse:collapse;margin:14px 0">
    <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Advisory board</td><td style="padding:2px 0"><strong>{board.title}</strong></td></tr>
    {sponsor_row}
  </table>
  <p>From the portal you can follow the project status, review and approve documents,
     message the project team, and see how the expert panel is engaging with the
     reading material.</p>
  <p style="margin:18px 0">
    <a href="{portal_url}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">Open my client portal</a>
  </p>
  {password_note}
  <p style="font-size:12px;color:#6b7280">This link is unique to you — please do not share it.
     If the button doesn't work, copy this into your browser:<br>
     <a href="{portal_url}">{portal_url}</a></p>
</div>"""


def _send_client_invite_email(db: Session, board: AdvisoryBoard, c: BoardClient) -> bool:
    """Sends the portal link and stamps invite_sent_at on success.

    Best-effort at creation time: a mail failure must never fail adding the
    client, because the link already exists and can be sent from the UI
    afterwards. Returns True only if the mail actually went out.
    """
    if not c.email or not c.access_token:
        return False
    log = email_service.send_email(
        db,
        to=c.email,
        subject=f"Your client portal: {board.title}",
        body_html=_build_client_invite_email(board, c),
        kind=EmailKind.client_invite.value,
        board_id=board.id,
        owner_user_id=account_config.owner_of_board(board),
    )
    if log.success:
        c.invite_sent_at = datetime.utcnow()
        db.commit()
        return True
    return False


def _client_to_dict(c: BoardClient) -> dict:
    return {
        "id": c.id,
        "board_id": c.board_id,
        "name": c.name,
        "email": c.email,
        "organization": c.organization,
        "access_token": c.access_token,
        "portal_path": f"/client/{c.access_token}" if c.access_token else None,
        "invited_at": c.invited_at.isoformat() if c.invited_at else None,
        "invite_sent_at": c.invite_sent_at.isoformat() if c.invite_sent_at else None,
        # Whether a password is set, never the hash itself.
        "has_password": bool(c.password_hash),
        "password_set_at": c.password_set_at.isoformat() if c.password_set_at else None,
        "last_seen_at": c.last_seen_at.isoformat() if c.last_seen_at else None,
        "created_at": c.created_at.isoformat(),
    }


def _get_client_or_404(board_id: int, client_id: int, db: Session) -> BoardClient:
    c = db.query(BoardClient).filter(
        BoardClient.id == client_id, BoardClient.board_id == board_id
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Client not found")
    return c


# ── Client management ────────────────────────────────────

@router.get("/advisory-boards/{board_id}/clients")
def list_board_clients(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)
    clients = db.query(BoardClient).filter(
        BoardClient.board_id == board_id
    ).order_by(BoardClient.created_at.asc()).all()
    return [_client_to_dict(c) for c in clients]


@router.post("/advisory-boards/{board_id}/clients", status_code=201)
def create_board_client(
    board_id: int,
    data: BoardClientCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)

    email = (data.email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    exists = db.query(BoardClient).filter(
        BoardClient.board_id == board_id, BoardClient.email == email
    ).first()
    if exists:
        raise HTTPException(status_code=409, detail="A client with this email is already assigned to this board")

    client = BoardClient(
        board_id=board_id,
        name=data.name.strip(),
        email=email,
        organization=(data.organization or None),
        access_token=_new_client_token(),
        token_issued_at=datetime.utcnow(),
        created_by=current_user.id,
    )
    db.add(client)
    db.commit()
    db.refresh(client)
    log_board_activity(db, board_id, current_user.id, "client.added", f"Added client {client.name} ({client.email})")

    # Best-effort: a mail failure must not fail the create. The link exists
    # either way and can be sent from the UI afterwards.
    if data.send_invite is not False:
        try:
            if _send_client_invite_email(db, board, client):
                log_board_activity(db, board_id, current_user.id, "client.invite_sent",
                                   f"Portal link emailed to {client.email}")
        except Exception as e:  # noqa: BLE001
            logger.warning("Client invite email failed for client %s: %s", client.id, e)

    db.refresh(client)
    return _client_to_dict(client)


# Unambiguous alphabet: no O/0, I/l/1 — these get read aloud and retyped.
_PW_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"


def _generate_password(length: int = 12) -> str:
    import secrets
    return "".join(secrets.choice(_PW_ALPHABET) for _ in range(length))


@router.post("/advisory-boards/{board_id}/clients/{client_id}/set-password")
def set_client_password(
    board_id: int,
    client_id: int,
    data: ClientPasswordSet,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set, replace, generate or clear a client's portal password.

    The plaintext is returned **once**, here, and never stored — only a bcrypt
    hash is kept, so it cannot be shown again later. That is deliberate: the team
    copies it now and passes it to the client through a channel of their own
    choosing, rather than it living in the database where the portal link
    already is.
    """
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)
    client = db.query(BoardClient).filter(
        BoardClient.id == client_id, BoardClient.board_id == board_id
    ).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    if data.clear:
        client.password_hash = None
        client.password_set_at = None
        db.commit()
        log_board_activity(db, board_id, current_user.id, "client.password_cleared",
                           f"Removed the portal password for {client.email}")
        db.refresh(client)
        return {"client": _client_to_dict(client), "password": None}

    plain = (data.password or "").strip() or _generate_password()
    if len(plain) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    client.password_hash = get_password_hash(plain)
    client.password_set_at = datetime.utcnow()
    db.commit()
    log_board_activity(db, board_id, current_user.id, "client.password_set",
                       f"Set a portal password for {client.email}")
    db.refresh(client)
    # Shown once in the UI so it can be copied and handed over.
    return {"client": _client_to_dict(client), "password": plain}


@router.post("/advisory-boards/{board_id}/clients/{client_id}/send-invite")
def send_client_invite(
    board_id: int,
    client_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send (or re-send) the portal link to one client, on demand.

    The manual counterpart to the automatic send at creation: it covers a client
    added before this existed, one whose email bounced, one who lost the mail,
    and one whose token was just regenerated.
    """
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)
    client = db.query(BoardClient).filter(
        BoardClient.id == client_id, BoardClient.board_id == board_id
    ).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if not client.access_token:
        raise HTTPException(status_code=400, detail="This client has no portal link yet.")

    sent = _send_client_invite_email(db, board, client)
    if not sent:
        # Surfaced rather than swallowed: on a manual click the user is waiting
        # for an answer, unlike the best-effort send during creation.
        raise HTTPException(
            status_code=502,
            detail="The invite email could not be sent. Check the SMTP settings under My Account.",
        )
    log_board_activity(db, board_id, current_user.id, "client.invite_sent",
                       f"Portal link emailed to {client.email}")
    db.refresh(client)
    return _client_to_dict(client)


@router.patch("/advisory-boards/{board_id}/clients/{client_id}")
def update_board_client(
    board_id: int,
    client_id: int,
    data: BoardClientUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)
    client = _get_client_or_404(board_id, client_id, db)

    payload = data.dict(exclude_unset=True)
    if "email" in payload and payload["email"]:
        payload["email"] = payload["email"].strip().lower()
    for field, value in payload.items():
        setattr(client, field, value)
    db.commit()
    db.refresh(client)
    return _client_to_dict(client)


@router.delete("/advisory-boards/{board_id}/clients/{client_id}")
def delete_board_client(
    board_id: int,
    client_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)
    client = _get_client_or_404(board_id, client_id, db)
    name = client.name
    db.delete(client)
    db.commit()
    log_board_activity(db, board_id, current_user.id, "client.removed", f"Removed client {name}")
    return {"detail": "Client removed"}


@router.post("/advisory-boards/{board_id}/clients/{client_id}/regenerate-token")
def regenerate_client_token(
    board_id: int,
    client_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)
    client = _get_client_or_404(board_id, client_id, db)
    client.access_token = _new_client_token()
    client.token_issued_at = datetime.utcnow()
    db.commit()
    db.refresh(client)
    return _client_to_dict(client)


# ── Approvals (team view) ────────────────────────────────

@router.get("/advisory-boards/{board_id}/approvals")
def list_board_approvals(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """All client document-approval decisions across the board's meetings."""
    board = _get_board_or_404(board_id, db)
    _check_board_access(board, current_user, db)

    rows = (
        db.query(DocumentApproval, MeetingDocument, BoardClient)
        .join(MeetingDocument, DocumentApproval.document_id == MeetingDocument.id)
        .join(BoardMeeting, MeetingDocument.meeting_id == BoardMeeting.id)
        .join(BoardClient, DocumentApproval.board_client_id == BoardClient.id)
        .filter(BoardMeeting.board_id == board_id)
        .order_by(DocumentApproval.updated_at.desc())
        .all()
    )
    return [
        {
            "id": a.id,
            "document_id": a.document_id,
            "document_title": doc.title,
            "meeting_id": doc.meeting_id,
            "client_id": client.id,
            "client_name": client.name,
            "status": _enum_value(a.status),
            "comment": a.comment,
            "decided_at": a.decided_at.isoformat() if a.decided_at else None,
            "updated_at": a.updated_at.isoformat(),
        }
        for a, doc, client in rows
    ]


