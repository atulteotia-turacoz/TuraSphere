from app.models.user import User, UserRole
from app.models.hcp import HCPProfile, HCPType, HCPStatus
from app.models.assessment import Assessment
from app.models.audit_log import AuditLog
from app.models.configuration import AIConfiguration, PaymentGateway, SiteSetting
from app.models.master_data import MasterData, MasterDataType
from app.models.subscription_plan import SubscriptionPlan
from app.models.subscription import UserSubscription, BillingProfile, Invoice
from app.models.form_link import FormLink, FormSubmission, FormSubmissionStatus
from app.models.survey import Survey, SurveyQuestion, SurveyResponse, SurveyAnswer, QuestionType, SurveyStatus
from app.models.kol_directory import KOLDirectoryEntry
from app.models.kol_pending import KOLPendingEntry
from app.models.ctri import CTRITrial, CTRIInvestigator, CTRIHarvest

# ── MABM (Medical Advisory Board Meeting) module ──
from app.models.advisory_board import AdvisoryBoard, BoardStatus, BoardPhase, BoardFormat
from app.models.advisory_service import AdvisoryService, FeeUnit
from app.models.board_kol import BoardKol
from app.models.board_section import BoardSection
from app.models.meeting import BoardMeeting, MeetingAgendaItem, MeetingStatus, MeetingFormat
from app.models.meeting_participant import MeetingParticipant, ParticipantRole, InviteStatus
from app.models.meeting_document import (
    MeetingDocument, MeetingDocumentVisibility, MeetingDocumentComment,
    DocumentPhase, DocumentCategory,
)
from app.models.meeting_recording import (
    MeetingRecording, MeetingTranscript, RecordingSource, TranscriptStatus,
)
from app.models.mabm_role import MABMRoleAssignment, MABMRole
from app.models.meeting_provider import MeetingProviderConfig, MeetingProvider
from app.models.meeting_engagement import MeetingSurvey, MeetingPoll, SurveyPhase, PollPhase
# Referenced by MeetingPoll.poll via the string "Poll", so the registry is
# incomplete without this import.
from app.models.poll import Poll, PollVote
from app.models.meeting_chat import MeetingChatMessage
from app.models.meeting_session_comment import MeetingSessionComment
from app.models.meeting_document_view import MeetingDocumentView, ViewSource
from app.models.meeting_transcript_segment import MeetingTranscriptSegment
from app.models.meeting_minutes import MeetingMinutes, MeetingMinutesComment, MinutesStatus
from app.models.manuscript import (
    Manuscript, ManuscriptComment, ManuscriptStatusHistory,
    ManuscriptStatus, TERMINAL_STATUSES as MANUSCRIPT_TERMINAL_STATUSES,
)
from app.models.email_log import EmailLog, EmailKind
from app.models.smtp_config import SmtpConfig
from app.models.twitter_config import TwitterConfig
from app.models.board_client import (
    BoardClient, DocumentApproval, ApprovalStatus,
)
from app.models.board_workspace import BoardTeamMember, BoardActivity

__all__ = [
    "User",
    "UserRole",
    "HCPProfile",
    "HCPType",
    "HCPStatus",
    "Assessment",
    "AuditLog",
    "AIConfiguration",
    "PaymentGateway",
    "SiteSetting",
    "MasterData",
    "MasterDataType",
    "SubscriptionPlan",
    "UserSubscription",
    "BillingProfile",
    "Invoice",
    "FormLink",
    "FormSubmission",
    "FormSubmissionStatus",
    "KOLDirectoryEntry",
    "KOLPendingEntry",
    # MABM
    "AdvisoryBoard", "BoardStatus", "BoardPhase", "BoardFormat",
    "AdvisoryService", "FeeUnit", "BoardKol",
    "BoardMeeting", "MeetingAgendaItem", "MeetingStatus", "MeetingFormat",
    "BoardSection",
    "MeetingParticipant", "ParticipantRole", "InviteStatus",
    "MeetingDocument", "MeetingDocumentVisibility", "MeetingDocumentComment",
    "MeetingSessionComment", "MeetingDocumentView", "ViewSource",
    "DocumentPhase", "DocumentCategory",
    "MeetingRecording", "MeetingTranscript", "RecordingSource", "TranscriptStatus",
    "MABMRoleAssignment", "MABMRole",
    "MeetingProviderConfig", "MeetingProvider",
    "MeetingSurvey", "MeetingPoll", "SurveyPhase", "PollPhase", "Poll", "PollVote",
    "MeetingMinutes", "MeetingMinutesComment", "MinutesStatus",
    "Manuscript", "ManuscriptComment", "ManuscriptStatusHistory", "ManuscriptStatus",
    "MANUSCRIPT_TERMINAL_STATUSES",
    "EmailLog", "EmailKind",
    "SmtpConfig",
    "TwitterConfig",
    "BoardClient", "DocumentApproval", "ApprovalStatus",
    "BoardTeamMember", "BoardActivity",
]
