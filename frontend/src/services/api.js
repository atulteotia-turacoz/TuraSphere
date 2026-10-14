import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1';

const api = axios.create({ baseURL: API_BASE, timeout: 120000 });

// Client-portal session. Kept per-tab in sessionStorage rather than
// localStorage: a client portal link is often opened on a shared or borrowed
// machine, and the session should die with the tab rather than linger.
const clientSessionKey = (token) => `client_session:${token}`;
export const getClientSession = (token) => {
  try { return sessionStorage.getItem(clientSessionKey(token)); } catch { return null; }
};
export const setClientSession = (token, session) => {
  try { sessionStorage.setItem(clientSessionKey(token), session); } catch { /* private mode */ }
};
export const clearClientSession = (token) => {
  try { sessionStorage.removeItem(clientSessionKey(token)); } catch { /* private mode */ }
};

// Add token interceptor
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // Attach the client-portal session to any /public/client/{token}/… call. Done
  // centrally so a new client-portal endpoint cannot forget it.
  const m = (config.url || '').match(/\/public\/client\/([^/?]+)/);
  if (m) {
    const session = getClientSession(m[1]);
    if (session) config.headers['X-Client-Session'] = session;
  }
  return config;
});

// Auto-logout on expired/invalid session. If the server says 401 and we had a
// token, the token is stale — clear auth state and bounce the user to /login
// instead of leaving them on a broken page like the dashboard.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const hadToken = !!localStorage.getItem('token');
    const url = error.config?.url || '';
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register');

    // A client-portal session that expires mid-visit must re-show the lock
    // screen, not leave the client staring at panels that all failed. Broadcast
    // it so the page can react without every tab handling 401 itself.
    const clientMatch = url.match(/\/public\/client\/([^/?]+)/);
    if (status === 401 && clientMatch && !url.endsWith('/login')) {
      try {
        clearClientSession(clientMatch[1]);
        window.dispatchEvent(new CustomEvent('client-portal-locked', { detail: clientMatch[1] }));
      } catch { /* non-browser context */ }
      return Promise.reject(error);
    }

    if (status === 401 && hadToken && !isAuthEndpoint) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.replace('/login');
      }
    }
    return Promise.reject(error);
  }
);

// Auth
export const login = (data) => api.post('/auth/login', data);
export const register = (data) => api.post('/auth/register', data);
export const getMe = () => api.get('/auth/me');

// HCP
export const createHCP = (data) => api.post('/hcp/', data);
// "Is this person already on file?" — asked before a New Assessment is
// submitted, so the same doctor never ends up with two records and two
// unrelated score histories. Returns matches with the reason each matched.
export const checkHCPDuplicate = (data) => api.post('/hcp/check-duplicate', data);
export const listHCPs = (params) => api.get('/hcp/', { params });

// The advisory-board module's OWN KOL list (Advisory Boards -> KOLs).
// Separate from the KOL module's /hcp directory; a board's panel can draw
// from either, and kol_ids tags which with "own:" / "hcp:".
export const listBoardKols = (params) => api.get('/board-kols', { params });
export const createBoardKol = (data) => api.post('/board-kols', data);
export const updateBoardKol = (id, data) => api.patch(`/board-kols/${id}`, data);
export const deleteBoardKol = (id) => api.delete(`/board-kols/${id}`);
export const getHCP = (id) => api.get(`/hcp/${id}`);
export const updateHCP = (id, data) => api.put(`/hcp/${id}`, data);
export const deleteHCP = (id) => api.delete(`/hcp/${id}`);
export const uploadCV = (id, file) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post(`/hcp/${id}/upload-cv`, fd);
};

// The signed consent letter. Separate from the CV because it is a compliance
// record, not a source of profile data — it is never parsed and never
// auto-fills the form.
export const uploadConsent = (id, file) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post(`/hcp/${id}/upload-consent`, fd);
};
export const downloadConsent = (id) =>
  api.get(`/hcp/${id}/download-consent`, { responseType: 'blob' });
export const downloadCV = (id) => api.get(`/hcp/${id}/download-cv`, { responseType: 'blob' });
export const extractCVFields = (file) => {
  const fd = new FormData();
  fd.append('file', file);
  // 60s was below what a real CV takes: an 11-page one measured 76s end to
  // end, so the browser aborted a request the server went on to answer and the
  // user was told extraction had failed. Raising the output-token budget for
  // long CVs made responses longer still.
  return api.post('/hcp/extract-cv-fields', fd, { timeout: 240000 });
};
// Split a pasted block of text into rows for one repeatable form section.
export const parseRows = (kind, text) =>
  api.post('/hcp/parse-rows', { kind, text }, { timeout: 120000 });

// Assessments
export const scoreManual = (hcpId, data) => api.post(`/assessments/${hcpId}/score-manual`, data);
export const scoreAutomated = (hcpId, data) => api.post(`/assessments/${hcpId}/score-automated`, data);
export const scoreWithAI = (hcpId) => api.post(`/assessments/${hcpId}/score-ai`, null, { timeout: 300000 });
export const getAssessment = (hcpId) => api.get(`/assessments/${hcpId}`);
export const getParameterScores = (hcpId) => api.get(`/assessments/${hcpId}/parameter-scores`);
export const listAssessments = (params) => api.get('/assessments/', { params });
// Aggregated server-side — the dashboard should not download every assessment
// just to draw a tier bar chart.
export const getAssessmentStats = () => api.get('/assessments/stats');
export const exportCSV = (hcpId) => api.get(`/assessments/${hcpId}/export-csv`, { responseType: 'blob' });
export const getAudit = (hcpId) => api.get(`/assessments/${hcpId}/audit`);
export const verifyParameterScore = (scoreId) => api.put(`/assessments/parameter-score/${scoreId}/verify`);
// Approve the whole assessment in ONE call. The page used to fire a verify
// request per parameter, which left no audit record of the approval.
export const approveAssessment = (assessmentId) =>
  api.post(`/assessments/${assessmentId}/approve`);
// Set one parameter's score by hand. The server re-totals the assessment and
// re-derives the tier, and returns both — the four judgement-based criteria the
// rule engine cannot decide have no other way to be settled.
export const overrideParameterScore = (scoreId, score, justification) =>
  api.put(`/assessments/parameter-score/${scoreId}`, { score, justification });

// Account & Subscription
export const getProfile = () => api.get('/account/profile');
export const updateProfile = (data) => api.put('/account/profile', data);
export const getBilling = () => api.get('/account/billing');
export const updateBilling = (data) => api.put('/account/billing', data);
export const getSubscription = () => api.get('/account/subscription');
export const subscribe = (data) => api.post('/account/subscribe', data);
export const createOrder = (data) => api.post('/account/create-order', data);
export const verifyPayment = (data) => api.post('/account/verify-payment', data);
export const cancelSubscription = () => api.post('/account/cancel-subscription');
export const getInvoices = () => api.get('/account/invoices');
export const downloadInvoicePdf = (invoiceId) => api.get(`/account/invoices/${invoiceId}/pdf`, { responseType: 'blob' });

// Plans (public)
export const getPlans = () => api.get('/plans');

// Master Data (public — returns globals + caller's own rows when authenticated)
export const getMasterData = (type) => api.get('/master-data/active', { params: { type } });

// Categories (per-user CRUD over user-managed master data types)
export const listMyCategories = (type) => api.get('/account/categories', { params: type ? { type } : {} });
export const createMyCategory = (data) => api.post('/account/categories', data);
export const updateMyCategory = (id, data) => api.put(`/account/categories/${id}`, data);
export const toggleMyCategory = (id) => api.put(`/account/categories/${id}/toggle`);
export const deleteMyCategory = (id) => api.delete(`/account/categories/${id}`);

// Assessment Parameters (user preferences + custom CRUD)
export const getAssessmentParameters = () => api.get('/account/parameters');

// KOL tier bands (Account -> KOL Tiers)
export const listKolTiers = () => api.get('/account/tiers');
export const createKolTier = (data) => api.post('/account/tiers', data);
export const updateKolTier = (id, data) => api.put(`/account/tiers/${id}`, data);
export const deleteKolTier = (id) => api.delete(`/account/tiers/${id}`);
export const updateAssessmentParameters = (data) => api.put('/account/parameters', data);
export const createCustomParameter = (data) => api.post('/account/parameters/custom', data);
export const updateCustomParameter = (id, data) => api.put(`/account/parameters/custom/${id}`, data);
export const deleteCustomParameter = (id) => api.delete(`/account/parameters/custom/${id}`);

// Account: Participants (advisory-board contact book)

// Account-scoped config (SaaS): SMTP, meeting providers, email logs, status
export const getAccountSmtpConfig = () => api.get('/account/smtp-config');
export const updateAccountSmtpConfig = (data) => api.put('/account/smtp-config', data);
export const deleteAccountSmtpConfig = () => api.delete('/account/smtp-config');
export const sendTestEmail = (data) => api.post('/account/smtp-config/test', data || {});
export const listAccountMeetingProviders = () => api.get('/account/meeting-providers');
export const upsertAccountMeetingProvider = (data) => api.put('/account/meeting-providers', data);
export const deleteAccountMeetingProvider = (provider) => api.delete(`/account/meeting-providers/${provider}`);
export const listAccountEmailLogs = (params) => api.get('/account/email-logs', { params });
export const getAccountConfigStatus = () => api.get('/account/config-status');

// Payment Gateway (public)
export const getActivePaymentGateway = () => api.get('/payment-gateway/active');

// Form Links
export const createFormLink = (data) => api.post('/form-links', data);
export const listFormLinks = () => api.get('/form-links');
export const deleteFormLink = (id) => api.delete(`/form-links/${id}`);
export const toggleFormLink = (id) => api.put(`/form-links/${id}/toggle`);
export const listFormSubmissions = (params) => api.get('/form-links/submissions', { params });
export const deleteFormSubmission = (id) => api.delete(`/form-links/submissions/${id}`);
export const startAssessmentFromSubmission = (id) => api.post(`/form-links/submissions/${id}/start-assessment`);
export const markSubmissionAssessed = (id) => api.put(`/form-links/submissions/${id}/mark-assessed`);
export const downloadSubmissionCV = (id) => api.get(`/form-links/submissions/${id}/download-cv`, { responseType: 'blob' });

// Public Form (no auth)
export const getPublicForm = (token) => api.get(`/public/form/${token}`);
export const submitPublicForm = (token, formData) => api.post(`/public/form/${token}/submit`, formData, { timeout: 180000 });
export const extractCVPublic = (token, formData) => api.post(`/public/form/${token}/extract-cv`, formData, { timeout: 240000 });

// Surveys
export const createSurvey = (data) => api.post('/surveys', data);
export const listSurveys = () => api.get('/surveys');
export const getSurvey = (id) => api.get(`/surveys/${id}`);
export const updateSurvey = (id, data) => api.put(`/surveys/${id}`, data);
export const deleteSurvey = (id) => api.delete(`/surveys/${id}`);
export const getSurveyResults = (id) => api.get(`/surveys/${id}/results`);
export const deleteSurveyResponse = (surveyId, responseId) => api.delete(`/surveys/${surveyId}/responses/${responseId}`);

export const uploadSurveyImage = (file) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post('/surveys/upload-image', fd);
};

// Public Survey (no auth)
export const getPublicSurvey = (token) => api.get(`/public/survey/${token}`);
export const submitPublicSurvey = (token, data) => api.post(`/public/survey/${token}/submit`, data);
export const lookupPublicSurvey = (token, introData) => api.post(`/public/survey/${token}/lookup`, { intro_data: introData });
export const savePartialPublicSurvey = (token, data) => api.post(`/public/survey/${token}/save-partial`, data);
export const uploadPublicSurveyFile = (file) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post('/public/survey/upload-file', fd);
};

// Admin Surveys
export const adminListSurveys = () => api.get('/admin/surveys');
export const adminDeleteSurvey = (id) => api.delete(`/admin/surveys/${id}`);

// Polls
export const createPoll = (data) => api.post('/polls', data);
export const listPolls = () => api.get('/polls');
export const getPoll = (id) => api.get(`/polls/${id}`);
export const updatePoll = (id, data) => api.put(`/polls/${id}`, data);
export const deletePoll = (id) => api.delete(`/polls/${id}`);
export const getPollResults = (id) => api.get(`/polls/${id}/results`);
export const deletePollVote = (pollId, voteId) => api.delete(`/polls/${pollId}/votes/${voteId}`);

// Public Poll (no auth)
export const getPublicPoll = (token) => api.get(`/public/poll/${token}`);
export const submitPollVote = (token, data) => api.post(`/public/poll/${token}/vote`, data);

// ─── MABM (Medical Advisory Board Meeting) module ──────────────────────────
// Backend uses snake_case; frontend keeps camelCase. Adapters handle the diff
// so consumers don't need to think about it.

// Boards: maps frontend camelCase board shape ↔ backend snake_case
export const boardToApi = (b = {}) => ({
  title: b.title,
  client: b.client,
  sponsor: b.sponsor,
  therapeutic_areas: b.therapeuticArea ?? b.therapeutic_areas,
  regions: b.region ?? b.regions,
  currency: b.currency,
  status: b.status,
  current_phase: b.currentPhase ?? b.current_phase,
  scheduled_date: b.scheduledDate ?? b.scheduled_date,
  start_time: b.startTime ?? b.start_time,
  end_time: b.endTime ?? b.end_time,
  format: b.format,
  venue: b.venue,
  objective: b.objective,
  notes: b.notes,
  kol_ids: b.kolIds ?? b.kol_ids,
  service_ids: b.serviceIds ?? b.service_ids,
  pricing: b.pricing,
});

export const boardFromApi = (b = {}) => ({
  id: b.id,
  title: b.title,
  client: b.client,
  sponsor: b.sponsor,
  therapeuticArea: b.therapeutic_areas || [],
  region: b.regions || [],
  currency: b.currency,
  status: b.status,
  currentPhase: b.current_phase,
  scheduledDate: b.scheduled_date,
  startTime: b.start_time || '',
  endTime: b.end_time || '',
  format: b.format,
  venue: b.venue,
  objective: b.objective,
  notes: b.notes,
  kolIds: b.kol_ids || [],
  serviceIds: b.service_ids || [],
  pricing: b.pricing || {},
  createdBy: b.created_by,
  createdAt: b.created_at,
  updatedAt: b.updated_at,
  primaryMeeting: b.primary_meeting || null,
});

const stripUndef = (obj) => Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));

// Advisory service catalog (read-only on end user — managed in admin app)
export const listAdvisoryServices = (params) => api.get('/advisory-services', { params });

export const listAdvisoryBoards = (params) => api.get('/advisory-boards', { params }).then(r => ({ ...r, data: r.data.map(boardFromApi) }));
export const createAdvisoryBoard = (data) => api.post('/advisory-boards', stripUndef(boardToApi(data))).then(r => ({ ...r, data: boardFromApi(r.data) }));
export const getAdvisoryBoard = (id) => api.get(`/advisory-boards/${id}`).then(r => ({ ...r, data: boardFromApi(r.data) }));
export const updateAdvisoryBoard = (id, data) => api.patch(`/advisory-boards/${id}`, stripUndef(boardToApi(data))).then(r => ({ ...r, data: boardFromApi(r.data) }));
export const deleteAdvisoryBoard = (id) => api.delete(`/advisory-boards/${id}`);

// Meetings (board-scoped + global)
export const listBoardMeetings = (boardId) => api.get(`/advisory-boards/${boardId}/meetings`);
export const getPrimaryMeeting = (boardId) => api.get(`/advisory-boards/${boardId}/primary-meeting`);
export const provisionMeetingLink = (meetingId, provider) =>
  api.post(`/meetings/${meetingId}/provision`, { provider, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
export const listConfiguredProviders = () => api.get('/mabm/configured-providers');
export const createMeeting = (boardId, data) => api.post(`/advisory-boards/${boardId}/meetings`, data);
// In-app Zoom Meeting SDK embed: fetch the signed signature + join params.
export const getMeetingSdkSignature = (meetingId) => api.post(`/meetings/${meetingId}/sdk-signature`);
// LiveKit — self-hosted alternative to Zoom (see livekit.md). Permissions are
// signed into the token server-side; the client cannot widen them.
export const testAccountLiveKit = () => api.post('/account/meeting-providers/livekit/test');
export const getLiveKitToken = (meetingId) => api.post(`/meetings/${meetingId}/livekit/token`);
export const getJoinLiveKitToken = (token, code) => api.post(`/public/meeting/join/${token}/livekit/token`, { code: code || null });
// Live, speaker-attributed transcript. Organizer-only — the API 403s otherwise.
export const getLiveTranscript = (meetingId, afterId) =>
  api.get(`/meetings/${meetingId}/live-transcript`, { params: afterId ? { after_id: afterId } : undefined });
export const startLiveTranscript = (meetingId) => api.post(`/meetings/${meetingId}/live-transcript/start`);
export const stopLiveTranscript = (meetingId) => api.post(`/meetings/${meetingId}/live-transcript/stop`);
export const getLiveKitParticipants = (meetingId) => api.get(`/meetings/${meetingId}/livekit/participants`);
export const muteLiveKitParticipant = (meetingId, identity, trackSid, muted) => api.post(`/meetings/${meetingId}/livekit/mute`, { identity, track_sid: trackSid, muted });
export const removeLiveKitParticipant = (meetingId, identity) => api.post(`/meetings/${meetingId}/livekit/remove`, { identity });
export const getLiveKitRecording = (meetingId) => api.get(`/meetings/${meetingId}/livekit/recording`);
export const startLiveKitRecording = (meetingId) => api.post(`/meetings/${meetingId}/livekit/recording/start`);
export const stopLiveKitRecording = (meetingId) => api.post(`/meetings/${meetingId}/livekit/recording/stop`);
// In-meeting chat, authenticated side. `afterId` fetches only newer messages (polling).
export const getMeetingChat = (meetingId, afterId) => api.get(`/meetings/${meetingId}/chat`, { params: afterId ? { after_id: afterId } : undefined });
export const sendMeetingChat = (meetingId, body) => api.post(`/meetings/${meetingId}/chat`, { body });
export const setMeetingChatEnabled = (meetingId, enabled) => api.patch(`/meetings/${meetingId}/chat/settings`, { enabled });
export const listAllMeetings = (params) => api.get('/meetings', { params });
export const getMeeting = (meetingId) => api.get(`/meetings/${meetingId}`);
export const updateMeeting = (meetingId, data) => api.patch(`/meetings/${meetingId}`, data);
export const deleteMeeting = (meetingId) => api.delete(`/meetings/${meetingId}`);
export const startMeeting = (meetingId) => api.post(`/meetings/${meetingId}/start`);
export const endMeeting = (meetingId) => api.post(`/meetings/${meetingId}/end`);
export const reopenMeeting = (meetingId) => api.post(`/meetings/${meetingId}/reopen`);

// Agenda items
export const listAgendaItems = (meetingId) => api.get(`/meetings/${meetingId}/agenda-items`);
export const addAgendaItem = (meetingId, data) => api.post(`/meetings/${meetingId}/agenda-items`, data);
export const updateAgendaItem = (meetingId, itemId, data) => api.patch(`/meetings/${meetingId}/agenda-items/${itemId}`, data);
export const deleteAgendaItem = (meetingId, itemId) => api.delete(`/meetings/${meetingId}/agenda-items/${itemId}`);

// Participants
export const listMeetingParticipants = (meetingId) => api.get(`/meetings/${meetingId}/participants`);
export const inviteMeetingParticipants = (meetingId, invitees) => api.post(`/meetings/${meetingId}/participants`, { invitees });
export const updateMeetingParticipant = (meetingId, participantId, data) => api.patch(`/meetings/${meetingId}/participants/${participantId}`, data);
export const removeMeetingParticipant = (meetingId, participantId) => api.delete(`/meetings/${meetingId}/participants/${participantId}`);
export const regenerateParticipantJoinToken = (meetingId, participantId) => api.post(`/meetings/${meetingId}/participants/${participantId}/regenerate-token`);
export const resendParticipantInvite = (meetingId, participantId) => api.post(`/meetings/${meetingId}/participants/${participantId}/resend-invite`);

// Public per-participant meeting join ("separate login" — token-gated, no auth)
export const getMeetingJoinInfo = (token) => api.get(`/public/meeting/join/${token}`);
export const enterMeetingViaToken = (token) => api.post(`/public/meeting/join/${token}/enter`);
// In-app (on-platform) participant join — Zoom Meeting SDK signature by token.
// `code` is the access code emailed to the participant (required if they have one).
export const publicJoinSdkSignature = (token, code) => api.post(`/public/meeting/join/${token}/sdk-signature`, { code: code || null });
export const leaveMeetingViaToken = (token) => api.post(`/public/meeting/join/${token}/leave`);
// KOL/Advisor portal extras (token-gated)
export const getJoinMaterials = (token) => api.get(`/public/meeting/join/${token}/materials`);
export const downloadJoinMaterial = (token, documentId) => api.get(`/public/meeting/join/${token}/materials/${documentId}/download`, { responseType: 'blob' });
export const getJoinEngagements = (token) => api.get(`/public/meeting/join/${token}/engagements`);
// Expert dashboard — the invited KOL's landing page (profile header, meeting
// particulars, expert roster, per-session material + discussion, surveys).
export const getExpertDashboard = (token) => api.get(`/public/meeting/join/${token}/dashboard`);
export const addSessionComment = (token, agendaItemId, body) =>
  api.post(`/public/meeting/join/${token}/sessions/${agendaItemId}/comments`, { body });
export const deleteSessionComment = (token, agendaItemId, commentId) =>
  api.delete(`/public/meeting/join/${token}/sessions/${agendaItemId}/comments/${commentId}`);
// The expert's Discussion tab. Same thread as the forum folded under each
// session on their dashboard — here it is the whole page, and it carries the
// client's and the project team's replies inline.
export const getJoinDiscussion = (token) => api.get(`/public/meeting/join/${token}/discussion`);
// The flat tab posts to the MEETING, not to a session — hence no agenda item in
// the path. Deleting is by comment id for the same reason.
export const addJoinComment = (token, body) =>
  api.post(`/public/meeting/join/${token}/comments`, { body });
export const deleteJoinComment = (token, commentId) =>
  api.delete(`/public/meeting/join/${token}/comments/${commentId}`);
// Reading-material view tracking — feeds the organizer/client engagement
// dashboard ("who opened section N, and for how long").
export const openJoinMaterial = (token, documentId) =>
  api.post(`/public/meeting/join/${token}/materials/${documentId}/view`);
export const heartbeatJoinMaterial = (token, viewId, seconds) =>
  api.post(`/public/meeting/join/${token}/views/${viewId}/heartbeat`, { seconds });
export const getJoinAgenda = (token) => api.get(`/public/meeting/join/${token}/agenda`);
// Fetched, not used as an <iframe src>: a cross-origin URL (the API is on its
// own host/port) can be refused by the browser, and it fails as a blank
// "refused to connect" page inside the frame with nothing the app can catch.
// Going through axios uses the same channel as every other call and gives us a
// same-origin blob to render.
export const getJoinMaterialInline = (token, documentId) =>
  api.get(`/public/meeting/join/${token}/materials/${documentId}/inline`, { responseType: 'blob' });

// Engagement roll-ups
export const getMeetingEngagement = (meetingId) => api.get(`/meetings/${meetingId}/engagement`);
export const getClientEngagement = (token, meetingId) =>
  api.get(`/public/client/${token}/meetings/${meetingId}/engagement`);
export const getClientLiveKitToken = (token, meetingId) =>
  api.post(`/public/client/${token}/meetings/${meetingId}/livekit/token`);
export const getClientChat = (token, meetingId, afterId) =>
  api.get(`/public/client/${token}/meetings/${meetingId}/chat`, { params: afterId ? { after_id: afterId } : {} });
export const sendClientChat = (token, meetingId, body) =>
  api.post(`/public/client/${token}/meetings/${meetingId}/chat`, { body });
export const getClientPolls = (token, meetingId) =>
  api.get(`/public/client/${token}/meetings/${meetingId}/polls`);
export const listClientRoomDocuments = (token, meetingId) =>
  api.get(`/public/client/${token}/meetings/${meetingId}/room-documents`);
export const previewClientRoomDocument = (token, meetingId, documentId) =>
  api.get(`/public/client/${token}/meetings/${meetingId}/room-documents/${documentId}/preview`, { responseType: 'blob' });

// Session discussion — one thread per session, written by the panel, the client
// and the project team alike. Three callers, one conversation.
export const getClientDiscussion = (token, meetingId) =>
  api.get(`/public/client/${token}/meetings/${meetingId}/discussion`);
export const addClientSessionComment = (token, meetingId, agendaItemId, body) =>
  api.post(`/public/client/${token}/meetings/${meetingId}/sessions/${agendaItemId}/comments`, { body });
export const deleteClientSessionComment = (token, meetingId, agendaItemId, commentId) =>
  api.delete(`/public/client/${token}/meetings/${meetingId}/sessions/${agendaItemId}/comments/${commentId}`);

export const addClientComment = (token, meetingId, body) =>
  api.post(`/public/client/${token}/meetings/${meetingId}/comments`, { body });
export const deleteClientComment = (token, meetingId, commentId) =>
  api.delete(`/public/client/${token}/meetings/${meetingId}/comments/${commentId}`);

export const getMeetingDiscussion = (meetingId) => api.get(`/meetings/${meetingId}/discussion`);
export const addMeetingComment = (meetingId, body) =>
  api.post(`/meetings/${meetingId}/comments`, { body });
export const deleteMeetingComment = (meetingId, commentId) =>
  api.delete(`/meetings/${meetingId}/comments/${commentId}`);
export const addMeetingSessionComment = (meetingId, agendaItemId, body) =>
  api.post(`/meetings/${meetingId}/sessions/${agendaItemId}/comments`, { body });
export const deleteMeetingSessionComment = (meetingId, agendaItemId, commentId) =>
  api.delete(`/meetings/${meetingId}/sessions/${agendaItemId}/comments/${commentId}`);
// Full survey responses for a client — same shape as the team's
// /surveys/{id}/results, so both exports come out identical.
export const getClientSurveyResponses = (token, meetingId, surveyId) =>
  api.get(`/public/client/${token}/meetings/${meetingId}/surveys/${surveyId}/responses`);
// In-meeting chat, participant side. `afterId` fetches only newer messages (polling).
export const getJoinChat = (token, afterId) => api.get(`/public/meeting/join/${token}/chat`, { params: afterId ? { after_id: afterId } : undefined });
export const sendJoinChat = (token, body) => api.post(`/public/meeting/join/${token}/chat`, { body });
export const setJoinChatEnabled = (token, enabled) => api.patch(`/public/meeting/join/${token}/chat/settings`, { enabled });

// Documents
export const listMeetingDocuments = (meetingId, params) => api.get(`/meetings/${meetingId}/documents`, { params });
export const uploadMeetingDocument = (meetingId, { file, phase, category, title, sectionId, sessionId }) => {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('phase', phase);
  if (category) fd.append('category', category);
  if (title) fd.append('title', title);
  // Two INDEPENDENT fields, both optional, each with its own list:
  //   sectionId — the folder the file goes in ("Section ABC" and its files)
  //   sessionId — the part of the programme it belongs to ("Session 1")
  // Neither appears in the other's dropdown.
  if (sectionId) fd.append('section_id', String(sectionId));
  if (sessionId) fd.append('session_id', String(sessionId));
  return api.post(`/meetings/${meetingId}/documents`, fd);
};

// The two lists a document can be filed under, both created by the organizer:
//   kind 'section' — a folder ("Section ABC" and its files)
//   kind 'session' — a part of the programme ("Session 1")
// Neither is the agenda (the timed running order, published as such).
export const listMeetingSections = (meetingId, kind = 'section') => api.get(`/meetings/${meetingId}/sections`, { params: { kind } });
export const createMeetingSection = (meetingId, data, kind = 'section') => api.post(`/meetings/${meetingId}/sections`, data, { params: { kind } });
export const listBoardSections = (boardId, kind = 'section') => api.get(`/advisory-boards/${boardId}/sections`, { params: { kind } });
export const createBoardSection = (boardId, data, kind = 'section') => api.post(`/advisory-boards/${boardId}/sections`, data, { params: { kind } });
export const updateBoardSection = (boardId, sectionId, data) => api.patch(`/advisory-boards/${boardId}/sections/${sectionId}`, data);
export const deleteMeetingSection = (meetingId, sectionId) => api.delete(`/meetings/${meetingId}/sections/${sectionId}`);
export const deleteBoardSection = (boardId, sectionId) => api.delete(`/advisory-boards/${boardId}/sections/${sectionId}`);
export const updateMeetingDocument = (meetingId, documentId, data) => api.patch(`/meetings/${meetingId}/documents/${documentId}`, data);
export const deleteMeetingDocument = (meetingId, documentId) => api.delete(`/meetings/${meetingId}/documents/${documentId}`);
export const downloadMeetingDocument = (meetingId, documentId) => api.get(`/meetings/${meetingId}/documents/${documentId}/download`, { responseType: 'blob' });
// Inline preview (Office files arrive converted to PDF).
export const previewMeetingDocument = (meetingId, documentId) => api.get(`/meetings/${meetingId}/documents/${documentId}/preview`, { responseType: 'blob' });
// Public share link — mint/revoke a no-login link for a document.
export const createDocumentShareLink = (meetingId, documentId) => api.post(`/meetings/${meetingId}/documents/${documentId}/share-link`);
export const revokeDocumentShareLink = (meetingId, documentId) => api.delete(`/meetings/${meetingId}/documents/${documentId}/share-link`);
// Full public URL a token resolves to (opens the file directly, no auth).
export const publicDocumentUrl = (token) => `${API_BASE}/public/documents/${token}`;
export const setMeetingDocumentVisibility = (meetingId, documentId, userIds) => api.put(`/meetings/${meetingId}/documents/${documentId}/visibility`, { user_ids: userIds });
export const listMeetingDocumentComments = (meetingId, documentId) => api.get(`/meetings/${meetingId}/documents/${documentId}/comments`);
export const addMeetingDocumentComment = (meetingId, documentId, body) => api.post(`/meetings/${meetingId}/documents/${documentId}/comments`, { body });
export const deleteMeetingDocumentComment = (meetingId, documentId, commentId) => api.delete(`/meetings/${meetingId}/documents/${documentId}/comments/${commentId}`);

// ── Board Clients (team-side, authenticated) ──
export const listBoardClients = (boardId) => api.get(`/advisory-boards/${boardId}/clients`);
export const createBoardClient = (boardId, data) => api.post(`/advisory-boards/${boardId}/clients`, data);
export const updateBoardClient = (boardId, clientId, data) => api.patch(`/advisory-boards/${boardId}/clients/${clientId}`, data);
export const deleteBoardClient = (boardId, clientId) => api.delete(`/advisory-boards/${boardId}/clients/${clientId}`);
export const regenerateClientToken = (boardId, clientId) => api.post(`/advisory-boards/${boardId}/clients/${clientId}/regenerate-token`);
// Emails the client their portal link. The counterpart of the automatic send
// when a client is added — used to hand the portal over manually.
export const sendClientInvite = (boardId, clientId) =>
  api.post(`/advisory-boards/${boardId}/clients/${clientId}/send-invite`);
// Set, generate or clear a client's portal password. The plaintext comes back
// ONCE in the response and is never retrievable again.
export const setClientPassword = (boardId, clientId, body) =>
  api.post(`/advisory-boards/${boardId}/clients/${clientId}/set-password`, body || {});
// Exchange the portal password for a session.
export const clientPortalLogin = (token, password) =>
  api.post(`/public/client/${token}/login`, { password });
export const listBoardApprovals = (boardId) => api.get(`/advisory-boards/${boardId}/approvals`);
export const getBoardStatus = (boardId) => api.get(`/advisory-boards/${boardId}/status`);
// Board workspace — team assignment + audit trail
export const listBoardTeam = (boardId) => api.get(`/advisory-boards/${boardId}/team`);
export const assignBoardTeamMember = (boardId, data) => api.post(`/advisory-boards/${boardId}/team`, data);
export const updateBoardTeamMember = (boardId, memberId, role) => api.patch(`/advisory-boards/${boardId}/team/${memberId}`, { role });
export const removeBoardTeamMember = (boardId, memberId) => api.delete(`/advisory-boards/${boardId}/team/${memberId}`);
export const listBoardActivity = (boardId) => api.get(`/advisory-boards/${boardId}/activity`);
// Board email communication
export const sendBoardEmail = (boardId, data) => api.post(`/advisory-boards/${boardId}/emails/send`, data);
export const listBoardEmails = (boardId) => api.get(`/advisory-boards/${boardId}/emails`);

// ── Client Portal (token-gated, no auth) ──
export const getClientPortal = (token) => api.get(`/public/client/${token}`);
export const getClientAgenda = (token, meetingId) => api.get(`/public/client/${token}/meetings/${meetingId}/agenda`);
export const listClientDocuments = (token) => api.get(`/public/client/${token}/documents`);
export const downloadClientDocument = (token, documentId) => api.get(`/public/client/${token}/documents/${documentId}/download`, { responseType: 'blob' });
// Inline preview: the file itself for PDF/image/text, a LibreOffice-made PDF for Office files.
export const previewClientDocument = (token, documentId) => api.get(`/public/client/${token}/documents/${documentId}/preview`, { responseType: 'blob' });
export const submitDocumentApproval = (token, documentId, status, comment) => api.post(`/public/client/${token}/documents/${documentId}/approval`, { status, comment });

// Recording + Transcript
export const getMeetingRecording = (meetingId) => api.get(`/meetings/${meetingId}/recording`);
// Streamed through the API (organizer-only, honours Range so <video> can seek).
// Fetched as a blob because the route needs the auth header — a bare <video src>
// would hit it unauthenticated and 401.
export const deleteMeetingRecording = (meetingId, recordingId) =>
  api.delete(`/meetings/${meetingId}/recording/${recordingId}`);
// <video src> can't send the Authorization header, so playback goes through a
// short-lived signed link. The browser then streams with Range requests instead
// of downloading the whole file first (which timed out on long recordings).
export const getMeetingRecordingPlayUrl = async (meetingId, recordingId, { download = false } = {}) => {
  const { data } = await api.post(`/meetings/${meetingId}/recording/${recordingId}/play-link`);
  const q = new URLSearchParams({ t: data.token, ...(download ? { download: 'true' } : {}) });
  return `${API_BASE}/meetings/${meetingId}/recording/${recordingId}/play?${q}`;
};
export const uploadMeetingRecording = (meetingId, { file, durationSeconds, recordedAt }) => {
  const fd = new FormData();
  fd.append('file', file);
  if (durationSeconds != null) fd.append('duration_seconds', durationSeconds);
  if (recordedAt) fd.append('recorded_at', recordedAt);
  return api.post(`/meetings/${meetingId}/recording`, fd);
};
export const getMeetingTranscript = (meetingId) => api.get(`/meetings/${meetingId}/transcript`);
// Speech-to-text over a stored recording (LiveKit egress or manual upload).
// Long-running: extraction + upload + Whisper, so allow well past the default.
export const downloadRecordingTranscript = (meetingId, recordingId) =>
  api.get(`/meetings/${meetingId}/recording/${recordingId}/transcript/download`, { responseType: 'blob' });
export const getRecordingTranscript = (meetingId, recordingId) =>
  api.get(`/meetings/${meetingId}/recording/${recordingId}/transcript`);
export const generateMeetingTranscript = (meetingId, recordingId) =>
  api.post(`/meetings/${meetingId}/transcript/generate`, null,
    { params: recordingId ? { recording_id: recordingId } : undefined, timeout: 600000 });
export const createMeetingTranscript = (meetingId, rawText) => api.post(`/meetings/${meetingId}/transcript`, { raw_text: rawText });
export const editMeetingTranscript = (meetingId, editedText) => api.patch(`/meetings/${meetingId}/transcript`, { edited_text: editedText });
export const finalizeMeetingTranscript = (meetingId) => api.post(`/meetings/${meetingId}/transcript/finalize`);

// MABM role assignments (super admin)
export const listMabmRoleAssignments = (params) => api.get('/mabm/role-assignments', { params });
export const createMabmRoleAssignment = (data) => api.post('/mabm/role-assignments', data);
export const updateMabmRoleAssignment = (id, data) => api.patch(`/mabm/role-assignments/${id}`, data);
export const deleteMabmRoleAssignment = (id) => api.delete(`/mabm/role-assignments/${id}`);

// Meeting provider config (super admin)
export const listMeetingProviderConfigs = () => api.get('/mabm/provider-config');
export const getActiveMeetingProviderConfig = () => api.get('/mabm/provider-config/active');
export const upsertMeetingProviderConfig = (data) => api.put('/mabm/provider-config', data);
export const deleteMeetingProviderConfig = (id) => api.delete(`/mabm/provider-config/${id}`);

// Zoom sync (Phase 4 — pulls latest recording + transcript from Zoom)
export const syncMeetingFromZoom = (meetingId) => api.post(`/meetings/${meetingId}/zoom/sync-recording`);

// Minutes of Meeting (Phase 5)
export const getMeetingMinutes = (meetingId) => api.get(`/meetings/${meetingId}/minutes`);
export const createMeetingMinutes = (meetingId, data) => api.post(`/meetings/${meetingId}/minutes`, data);
export const editMeetingMinutes = (meetingId, draftText) => api.patch(`/meetings/${meetingId}/minutes`, { draft_text: draftText });
export const shareMeetingMinutes = (meetingId) => api.post(`/meetings/${meetingId}/minutes/share`);
export const finalizeMeetingMinutes = (meetingId) => api.post(`/meetings/${meetingId}/minutes/finalize`);
export const listMeetingMinutesComments = (meetingId) => api.get(`/meetings/${meetingId}/minutes/comments`);
export const addMeetingMinutesComment = (meetingId, body) => api.post(`/meetings/${meetingId}/minutes/comments`, { body });
export const deleteMeetingMinutesComment = (meetingId, commentId) => api.delete(`/meetings/${meetingId}/minutes/comments/${commentId}`);

// Manuscripts (Phase 5)
export const listMeetingManuscripts = (meetingId) => api.get(`/meetings/${meetingId}/manuscripts`);
export const createManuscript = (meetingId, data) => api.post(`/meetings/${meetingId}/manuscripts`, data);
export const getManuscript = (manuscriptId) => api.get(`/manuscripts/${manuscriptId}`);
export const updateManuscript = (manuscriptId, data) => api.patch(`/manuscripts/${manuscriptId}`, data);
export const transitionManuscriptStatus = (manuscriptId, status, note) => api.post(`/manuscripts/${manuscriptId}/status`, { status, note });
export const addManuscriptComment = (manuscriptId, body) => api.post(`/manuscripts/${manuscriptId}/comments`, { body });
export const deleteManuscriptComment = (manuscriptId, commentId) => api.delete(`/manuscripts/${manuscriptId}/comments/${commentId}`);
export const deleteManuscript = (manuscriptId) => api.delete(`/manuscripts/${manuscriptId}`);

// Email jobs (super admin)
export const sendMeetingReminders = () => api.post('/jobs/send-meeting-reminders');
export const sendManuscriptPings = () => api.post('/jobs/send-manuscript-pings');
export const listEmailLog = (params) => api.get('/jobs/email-log', { params });

// Meeting engagements (link existing surveys/polls to a meeting)
export const listMeetingSurveys = (meetingId, params) => api.get(`/meetings/${meetingId}/surveys`, { params });
export const linkMeetingSurvey = (meetingId, surveyId, phase) => api.post(`/meetings/${meetingId}/surveys`, { survey_id: surveyId, phase });
export const unlinkMeetingSurvey = (meetingId, linkId) => api.delete(`/meetings/${meetingId}/surveys/${linkId}`);
export const listMeetingPolls = (meetingId) => api.get(`/meetings/${meetingId}/polls`);
export const linkMeetingPoll = (meetingId, pollId) => api.post(`/meetings/${meetingId}/polls`, { poll_id: pollId });
export const unlinkMeetingPoll = (meetingId, linkId) => api.delete(`/meetings/${meetingId}/polls/${linkId}`);
export const listPendingPreMeetingSurveys = () => api.get('/me/pending-pre-meeting-surveys');

// X (Twitter) integration — the calling account's own config
// reveal=true returns this account's OWN secrets in full (never the platform's).
export const getMyTwitterConfig = (reveal = false) =>
  api.get('/account/twitter-config', { params: reveal ? { reveal: true } : {} });
export const saveMyTwitterConfig = (data) => api.put('/account/twitter-config', data);
export const deleteMyTwitterConfig = () => api.delete('/account/twitter-config');
export const testMyTwitterConfig = () => api.post('/account/twitter-config/test');
// Account → Google Search / Google Scholar: this account's own SerpAPI key
// (tried before the platform key).
export const getMyWebSearchConfig = () => api.get('/account/web-search-config');
export const saveMyWebSearchConfig = (data) => api.put('/account/web-search-config', data);
export const deleteMyWebSearchConfig = () => api.delete('/account/web-search-config');
export const testMyWebSearchConfig = () => api.post('/account/web-search-config/test');
export const getMyWebSearchUsage = (days = 30) => api.get('/account/web-search-usage', { params: { days } });
export const getMyScholarConfig = () => api.get('/account/scholar-config');
export const saveMyScholarConfig = (data) => api.put('/account/scholar-config', data);
export const deleteMyScholarConfig = () => api.delete('/account/scholar-config');
export const testMyScholarConfig = () => api.post('/account/scholar-config/test');

// KOL Directory ("Find KOLs")
export const listKOLs = (params) => api.get('/kol-directory/', { params });
export const getKOLFacets = () => api.get('/kol-directory/facets');
// Directory charts: top KOLs + breakdowns, for the same filters as the list.
export const getKOLInsights = (params) => api.get('/kol-directory/insights', { params });
export const createKOL = (data) => api.post('/kol-directory/', data);
export const bulkCreateKOLs = (items) => api.post('/kol-directory/bulk', { items });
export const updateKOL = (id, data) => api.put(`/kol-directory/${id}`, data);
export const deleteKOL = (id) => api.delete(`/kol-directory/${id}`);
export const deleteKOLsBulk = (ids) => api.post('/kol-directory/delete/bulk', { ids });
// Total experience for KOLs saved without it (runs in the background).
export const getExperienceMissing = () => api.get('/kol-directory/experience/missing');
// Export: the column catalogue, and the file itself (CSV or Excel) as a blob.
export const getKOLExportColumns = () => api.get('/kol-directory/export/columns');
export const exportKOLs = (params) => api.get('/kol-directory/export', { params, responseType: 'blob' });
export const fetchExperience = (useSearch = false) =>
  api.post('/kol-directory/experience/fetch', null, { params: { use_search: useSearch } });
export const addHCPToKOLDatabase = (hcpId) => api.post(`/kol-directory/from-hcp/${hcpId}`);
export const getKOL = (id) => api.get(`/kol-directory/${id}`);
// Research enrichment (PubMed / ClinicalTrials.gov / Scholar) for a KOL already in
// the directory — the same fetch the pending queue runs after a scrape.
export const enrichKOL = (id) => api.post(`/kol-directory/${id}/enrich`);
// refresh=false only fetches KOLs never enriched or whose last run failed.
export const enrichKOLsBulk = (ids, refresh = false) =>
  api.post('/kol-directory/enrich/bulk', { ids, refresh });

// CTRI (Clinical Trials Registry - India). Its search sits behind a CAPTCHA:
// load one, show the image, and send { session, captcha } with the search.
export const getCTRICaptcha = () => api.get('/kol-directory/ctri/captcha');
// Search CTRI by this KOL's name and record their trials (fills blank contact fields).
export const updateKOLFromCTRI = (id, answer) => api.post(`/kol-directory/${id}/ctri`, answer);
// One keyword search; matching directory KOLs are updated in the background.
export const updateKOLsFromCTRIBulk = (data) => api.post('/kol-directory/ctri/update-bulk', data);
// CTRI database — bulk scrape (one code per keyword) and the saved investigators.
export const startCTRIHarvest = (data) => api.post('/kol-directory/ctri/harvest', data);
export const listCTRIHarvests = () => api.get('/kol-directory/ctri/harvests');
export const getCTRIStats = () => api.get('/kol-directory/ctri/stats');
export const listCTRIInvestigators = (params) => api.get('/kol-directory/ctri/investigators', { params });
export const sendCTRIInvestigators = (data) => api.post('/kol-directory/ctri/investigators/send', data);
// Update directory KOLs from the saved CTRI data — no code needed.
export const matchCTRIDirectory = (ids = []) => api.post('/kol-directory/ctri/match-directory', { ids });

// Find KOLs — scrape from X (Twitter) + approval workflow
// Runs whichever sources the criteria enable (X recent tweets, X hub followers, Practo).
export const scrapeKOLs = (criteria) => api.post('/kol-directory/scrape', criteria);
// enrich=true kicks off PubMed / ClinicalTrials.gov / Scholar enrichment in the
// background for each created row; the panel then polls the pending list.
export const submitKOLsForApproval = (items, enrich = true) => api.post('/kol-directory/pending/bulk', { items, enrich });
// `params` (optional): skip, limit, search, source, therapeutic_area, geographic_zone.
export const listPendingKOLs = (status, params = {}) => api.get('/kol-directory/pending', { params: { ...(status ? { status } : {}), ...params } });
export const getPendingKOLFacets = (status) => api.get('/kol-directory/pending/facets', { params: status ? { status } : {} });
export const approvePendingKOL = (id, notes) => api.post(`/kol-directory/pending/${id}/approve`, { notes: notes || null });
export const rejectPendingKOL = (id, notes) => api.post(`/kol-directory/pending/${id}/reject`, { notes: notes || null });
export const deletePendingKOL = (id) => api.delete(`/kol-directory/pending/${id}`);
export const deletePendingKOLsBulk = (ids) => api.post('/kol-directory/pending/delete-bulk', { ids });
export const approvePendingKOLsBulk = (ids) => api.post('/kol-directory/pending/approve-bulk', { ids });
// Google KOLs whose link is a listing page: find the doctor's own page.
export const findPendingOwnPage = (id) => api.post(`/kol-directory/pending/${id}/find-page`);
export const findPendingOwnPages = (ids, useSearch = false) =>
  api.post('/kol-directory/pending/find-pages', { ids, use_search: useSearch });
// Look up the published email / phone of pending KOLs (background).
export const findPendingContacts = (ids, useSearch = true) =>
  api.post('/kol-directory/pending/find-contacts', { ids, use_search: useSearch });
// Re-run enrichment for one pending record (Details view button / refresh).
export const enrichPendingKOL = (id) => api.post(`/kol-directory/pending/${id}/enrich`);

export default api;
