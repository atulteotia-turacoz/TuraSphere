from fastapi import APIRouter
from app.api.endpoints import kol_tiers
from app.api.endpoints import (
    auth, hcp, assessment, admin, configuration, plans, subscription,
    assessment_parameters, master_data, form_links, surveys, polls, kol_directory,
    twitter_config, kol_scrape, ctri, search_integrations,
    account_config, admin_config, board_sections,
    # MABM (Medical Advisory Board Meeting) module
    advisory_boards, advisory_services, board_kols, meetings, meeting_documents,
    meeting_transcripts, mabm_roles, meeting_provider, meeting_engagements,
    zoom_webhooks, meeting_minutes, manuscripts, email_jobs, meeting_join,
    meeting_livekit,
    board_clients, client_portal, board_status, board_workspace, board_emails,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(ctri.router)
api_router.include_router(hcp.router)
api_router.include_router(assessment.router)
api_router.include_router(admin.router)
api_router.include_router(search_integrations.router)
api_router.include_router(configuration.router)
api_router.include_router(plans.router)
api_router.include_router(subscription.router)
api_router.include_router(kol_tiers.router)
api_router.include_router(assessment_parameters.router)
api_router.include_router(master_data.router)
api_router.include_router(form_links.router)
api_router.include_router(surveys.router)
api_router.include_router(polls.router)
api_router.include_router(kol_directory.router)
api_router.include_router(kol_scrape.router)
api_router.include_router(twitter_config.router)
api_router.include_router(account_config.router)
api_router.include_router(board_sections.router)
api_router.include_router(admin_config.router)

# MABM module
api_router.include_router(advisory_boards.router)
api_router.include_router(board_kols.router)
api_router.include_router(advisory_services.router)
api_router.include_router(meetings.router)
api_router.include_router(meeting_documents.router)
api_router.include_router(meeting_transcripts.router)
api_router.include_router(mabm_roles.router)
api_router.include_router(meeting_provider.router)
api_router.include_router(meeting_engagements.router)
api_router.include_router(zoom_webhooks.router)
api_router.include_router(meeting_minutes.router)
api_router.include_router(manuscripts.router)
api_router.include_router(email_jobs.router)
api_router.include_router(meeting_join.router)
api_router.include_router(meeting_livekit.router)
api_router.include_router(board_clients.router)
api_router.include_router(client_portal.router)
api_router.include_router(board_status.router)
api_router.include_router(board_workspace.router)
api_router.include_router(board_emails.router)
