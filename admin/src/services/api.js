import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to attach token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('admin_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_user');
      const base = process.env.PUBLIC_URL || '';
      window.location.href = base + '/login';
    }
    return Promise.reject(error);
  }
);

// ─── Auth ───────────────────────────────────────────────
export const login = (email, password) =>
  api.post('/auth/login', { email, password });

export const getProfile = () => api.get('/auth/me');

// ─── HCP (Admin) ────────────────────────────────────────
export const listHCPs = (params) => api.get('/admin/hcps', { params });
export const getHCP = (id) => api.get(`/hcp/${id}`);
export const deleteHCP = (id) => api.delete(`/admin/hcps/${id}`);

// KOL tier bands, per account. End users see these read-only on their Account
// page; only a super admin can change them, and always for a named user.
export const listUserKolTiers = (userId) => api.get(`/account/users/${userId}/tiers`);
export const createUserKolTier = (userId, data) => api.post(`/account/users/${userId}/tiers`, data);
export const updateUserKolTier = (userId, tierId, data) =>
  api.put(`/account/users/${userId}/tiers/${tierId}`, data);
export const deleteUserKolTier = (userId, tierId) =>
  api.delete(`/account/users/${userId}/tiers/${tierId}`);

// ─── Assessment ─────────────────────────────────────────
export const runAssessment = (hcpId) =>
  api.post(`/assessment/run/${hcpId}`);
export const getAssessment = (id) => api.get(`/admin/assessments/${id}`);
export const deleteAssessment = (id) => api.delete(`/admin/assessments/${id}`);
export const listAssessments = (params) =>
  api.get('/admin/assessments', { params });

// ─── Admin ──────────────────────────────────────────────
export const getAdminDashboard = () => api.get('/admin/dashboard');

export const listUsers = (params) => api.get('/admin/users', { params });
export const createUser = (data) => api.post('/admin/users', data);
export const updateUser = (id, data) =>
  api.put(`/admin/users/${id}`, data);
export const deleteUser = (id) => api.delete(`/admin/users/${id}`);
export const getUserDetail = (id) => api.get(`/admin/users/${id}/detail`);
export const downloadInvoicePdf = (invoiceId) => api.get(`/admin/invoices/${invoiceId}/pdf`, { responseType: 'blob' });

export const listAllAssessments = (params) =>
  api.get('/admin/assessments', { params });

export const getAuditLogs = (params) =>
  api.get('/admin/audit-logs', { params });

// ─── AI Configuration ────────────────────────────────────────────
export const listAIConfigs = () => api.get('/admin/config/ai');
export const getAIConfig = (id) => api.get(`/admin/config/ai/${id}`);
export const createAIConfig = (data) => api.post('/admin/config/ai', data);
export const updateAIConfig = (id, data) => api.put(`/admin/config/ai/${id}`, data);
export const deleteAIConfig = (id) => api.delete(`/admin/config/ai/${id}`);
export const testAIConfig = (id) => api.post(`/admin/config/ai/${id}/test`);
export const setDefaultAI = (id) => api.post(`/admin/config/ai/${id}/set-default`);

// ─── Payment Gateway ─────────────────────────────────────────────
export const listPaymentGateways = () => api.get('/admin/config/payment');
export const getPaymentGateway = (id) => api.get(`/admin/config/payment/${id}`);
export const createPaymentGateway = (data) => api.post('/admin/config/payment', data);
export const updatePaymentGateway = (id, data) => api.put(`/admin/config/payment/${id}`, data);
export const deletePaymentGateway = (id) => api.delete(`/admin/config/payment/${id}`);
export const testPaymentGateway = (id) => api.post(`/admin/config/payment/${id}/test`);
export const setDefaultPayment = (id) => api.post(`/admin/config/payment/${id}/set-default`);

// ─── Subscription Plans ─────────────────────────────────────────
export const listPlans = () => api.get('/admin/plans');
export const getPlan = (id) => api.get(`/admin/plans/${id}`);
export const createPlan = (data) => api.post('/admin/plans', data);
export const updatePlan = (id, data) => api.put(`/admin/plans/${id}`, data);
export const deletePlan = (id) => api.delete(`/admin/plans/${id}`);

// ─── PubMed / NCBI Configuration ────────────────────────────────
export const listPubMedConfigs = () => api.get('/admin/config/pubmed');
export const createPubMedConfig = (data) => api.post('/admin/config/pubmed', data);
export const updatePubMedConfig = (id, data) => api.put(`/admin/config/pubmed/${id}`, data);
export const deletePubMedConfig = (id) => api.delete(`/admin/config/pubmed/${id}`);
export const testPubMedConfig = (id) => api.post(`/admin/config/pubmed/${id}/test`);
export const setDefaultPubMed = (id) => api.post(`/admin/config/pubmed/${id}/set-default`);

// ─── ClinicalTrials.gov Configuration ────────────────────────────
export const listCTConfigs = () => api.get('/admin/config/clinical-trials');
export const createCTConfig = (data) => api.post('/admin/config/clinical-trials', data);
export const updateCTConfig = (id, data) => api.put(`/admin/config/clinical-trials/${id}`, data);
export const deleteCTConfig = (id) => api.delete(`/admin/config/clinical-trials/${id}`);
export const testCTConfig = (id) => api.post(`/admin/config/clinical-trials/${id}/test`);
export const setDefaultCT = (id) => api.post(`/admin/config/clinical-trials/${id}/set-default`);

// ─── Google Scholar Configuration ───────────────────────────────
export const listGSConfigs = () => api.get('/admin/config/google-scholar');
export const createGSConfig = (data) => api.post('/admin/config/google-scholar', data);
export const updateGSConfig = (id, data) => api.put(`/admin/config/google-scholar/${id}`, data);
export const deleteGSConfig = (id) => api.delete(`/admin/config/google-scholar/${id}`);
export const testGSConfig = (id) => api.post(`/admin/config/google-scholar/${id}/test`);
export const setDefaultGS = (id) => api.post(`/admin/config/google-scholar/${id}/set-default`);

// ─── Google Search (Find KOLs) — SerpAPI keys, super admin only ──
export const listWSConfigs = () => api.get('/admin/config/web-search');
export const createWSConfig = (data) => api.post('/admin/config/web-search', data);
export const updateWSConfig = (id, data) => api.put(`/admin/config/web-search/${id}`, data);
export const deleteWSConfig = (id) => api.delete(`/admin/config/web-search/${id}`);
export const testWSConfig = (id) => api.post(`/admin/config/web-search/${id}/test`);
export const setDefaultWS = (id) => api.post(`/admin/config/web-search/${id}/set-default`);
export const getWSUsage = (days = 30) => api.get('/admin/config/web-search/usage', { params: { days } });

// ─── LinkedIn Configuration ─────────────────────────────────────
export const listLinkedInConfigs = () => api.get('/admin/config/linkedin');
export const createLinkedInConfig = (data) => api.post('/admin/config/linkedin', data);
export const updateLinkedInConfig = (id, data) => api.put(`/admin/config/linkedin/${id}`, data);
export const deleteLinkedInConfig = (id) => api.delete(`/admin/config/linkedin/${id}`);
export const testLinkedInConfig = (id) => api.post(`/admin/config/linkedin/${id}/test`);
export const setDefaultLinkedIn = (id) => api.post(`/admin/config/linkedin/${id}/set-default`);

// ─── Practo Configuration ───────────────────────────────────────
export const testPractoSearch = (params) => api.post('/admin/config/practo/test', null, { params });

// ─── Advisory Services Catalog (MABM) ──────────────────────────
export const listAdvisoryServices = (params) => api.get('/advisory-services', { params });
export const getAdvisoryService = (id) => api.get(`/advisory-services/${id}`);
export const createAdvisoryService = (data) => api.post('/advisory-services', data);
export const updateAdvisoryService = (id, data) => api.patch(`/advisory-services/${id}`, data);
export const deleteAdvisoryService = (id) => api.delete(`/advisory-services/${id}`);

// ─── Meeting Provider Integrations (Zoom / Teams) ───────────────
export const listMeetingProviderConfigs = () => api.get('/mabm/provider-config');
export const upsertMeetingProviderConfig = (data) => api.put('/mabm/provider-config', data);
export const deleteMeetingProviderConfig = (id) => api.delete(`/mabm/provider-config/${id}`);

// ─── Master Data ────────────────────────────────────────────────
export const listMasterData = (params) => api.get('/admin/master-data', { params });
export const createMasterData = (data) => api.post('/admin/master-data', data);
export const updateMasterData = (id, data) => api.put(`/admin/master-data/${id}`, data);
export const deleteMasterData = (id) => api.delete(`/admin/master-data/${id}`);
export const toggleMasterData = (id) => api.put(`/admin/master-data/${id}/toggle`);

// ─── Surveys / Polls (Admin) ───────────────────────────────────
export const deleteSurvey = (id) => api.delete(`/admin/surveys/${id}`);
export const deletePoll = (id) => api.delete(`/polls/${id}`);
export const deleteFormSubmission = (id) => api.delete(`/form-links/submissions/${id}`);
export const downloadSubmissionCV = (id) => api.get(`/form-links/submissions/${id}/download-cv`, { responseType: 'blob' });

// ─── Site Settings ──────────────────────────────────────────────
export const getSiteSettings = () => api.get('/admin/site-settings');
export const updateSiteSetting = (key, value) => api.put(`/admin/site-settings/${key}`, { value });

// ─── Assessment Parameters ──────────────────────────────────────
export const listAssessmentParameters = () => api.get('/admin/parameters');
export const createAssessmentParameter = (data) => api.post('/admin/parameters', data);
export const updateAssessmentParameter = (id, data) => api.put(`/admin/parameters/${id}`, data);
export const deleteAssessmentParameter = (id) => api.delete(`/admin/parameters/${id}`);

// ─── SMTP / Email config + logs (SaaS multi-tenant) ─────────────
export const getGlobalSmtpConfig = () => api.get('/admin/smtp-config/global');
export const updateGlobalSmtpConfig = (data) => api.put('/admin/smtp-config/global', data);
export const listAllSmtpConfigs = () => api.get('/admin/smtp-configs');
export const updateSmtpConfig = (id, data) => api.put(`/admin/smtp-configs/${id}`, data);
export const toggleSmtpConfig = (id) => api.patch(`/admin/smtp-configs/${id}/toggle`);
export const deleteSmtpConfig = (id) => api.delete(`/admin/smtp-configs/${id}`);
export const listAllMeetingProviders = () => api.get('/admin/meeting-providers');
export const listAllEmailLogs = (params) => api.get('/admin/email-logs', { params });

// X (Twitter) — the platform/global config
// reveal=true returns the secrets in full instead of masked (admin only, logged).
export const getTwitterConfig = (reveal = false) =>
  api.get('/admin/twitter-config', { params: reveal ? { reveal: true } : {} });
export const saveTwitterConfig = (data) => api.put('/admin/twitter-config', data);
export const deleteTwitterConfig = () => api.delete('/admin/twitter-config');
export const testTwitterConfig = () => api.post('/admin/twitter-config/test');

export default api;
