import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import ProtectedRoute from './components/ProtectedRoute';
import TopNav from './components/TopNav';

import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import UsersPage from './pages/UsersPage';
import UserDetailPage from './pages/UserDetailPage';
import HCPsPage from './pages/HCPsPage';
import AssessmentsPage from './pages/AssessmentsPage';
import AssessmentDetailPage from './pages/AssessmentDetailPage';
import AuditLogsPage from './pages/AuditLogsPage';
import AIConfigPage from './pages/AIConfigPage';
import PaymentGatewayPage from './pages/PaymentGatewayPage';
import PlansPage from './pages/PlansPage';
import ParametersPage from './pages/ParametersPage';
import PubMedConfigPage from './pages/PubMedConfigPage';
import ClinicalTrialsConfigPage from './pages/ClinicalTrialsConfigPage';
import GoogleScholarConfigPage from './pages/GoogleScholarConfigPage';
import WebSearchConfigPage from './pages/WebSearchConfigPage';
import LinkedInConfigPage from './pages/LinkedInConfigPage';
import TwitterConfigPage from './pages/TwitterConfigPage';
import PractoConfigPage from './pages/PractoConfigPage';
import MasterDataPage from './pages/MasterDataPage';
import AdvisoryServicesPage from './pages/AdvisoryServicesPage';
import MeetingIntegrationsPage from './pages/MeetingIntegrationsPage';
import SmtpConfigPage from './pages/SmtpConfigPage';
import EmailLogsPage from './pages/EmailLogsPage';

function AdminLayout({ children }) {
  return (
    <div className="admin-layout-top">
      <TopNav />
      <main className="admin-content-area">
        {children}
      </main>
    </div>
  );
}

function ProtectedPage({ children }) {
  return (
    <ProtectedRoute>
      <AdminLayout>
        {children}
      </AdminLayout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="/dashboard" element={<ProtectedPage><DashboardPage /></ProtectedPage>} />
      <Route path="/users" element={<ProtectedPage><UsersPage /></ProtectedPage>} />
      <Route path="/users/new" element={<ProtectedPage><UsersPage showCreateModal /></ProtectedPage>} />
      <Route path="/users/:id" element={<ProtectedPage><UserDetailPage /></ProtectedPage>} />
      <Route path="/hcps" element={<ProtectedPage><HCPsPage /></ProtectedPage>} />
      <Route path="/assessments" element={<ProtectedPage><AssessmentsPage /></ProtectedPage>} />
      <Route path="/assessments/:id" element={<ProtectedPage><AssessmentDetailPage /></ProtectedPage>} />
      <Route path="/audit-logs" element={<ProtectedPage><AuditLogsPage /></ProtectedPage>} />
      <Route path="/ai-config" element={<ProtectedPage><AIConfigPage /></ProtectedPage>} />
      <Route path="/payment-gateways" element={<ProtectedPage><PaymentGatewayPage /></ProtectedPage>} />
      <Route path="/plans" element={<ProtectedPage><PlansPage /></ProtectedPage>} />
      <Route path="/parameters" element={<ProtectedPage><ParametersPage /></ProtectedPage>} />
      <Route path="/pubmed-config" element={<ProtectedPage><PubMedConfigPage /></ProtectedPage>} />
      <Route path="/clinical-trials-config" element={<ProtectedPage><ClinicalTrialsConfigPage /></ProtectedPage>} />
      <Route path="/google-scholar-config" element={<ProtectedPage><GoogleScholarConfigPage /></ProtectedPage>} />
      <Route path="/web-search-config" element={<ProtectedPage><WebSearchConfigPage /></ProtectedPage>} />
      <Route path="/linkedin-config" element={<ProtectedPage><LinkedInConfigPage /></ProtectedPage>} />
      <Route path="/twitter-config" element={<ProtectedPage><TwitterConfigPage /></ProtectedPage>} />
      <Route path="/practo-config" element={<ProtectedPage><PractoConfigPage /></ProtectedPage>} />
      <Route path="/master-data" element={<ProtectedPage><MasterDataPage /></ProtectedPage>} />
      <Route path="/advisory-services" element={<ProtectedPage><AdvisoryServicesPage /></ProtectedPage>} />
      <Route path="/meeting-integrations" element={<ProtectedPage><MeetingIntegrationsPage /></ProtectedPage>} />
      <Route path="/smtp-email" element={<ProtectedPage><SmtpConfigPage /></ProtectedPage>} />
      <Route path="/email-logs" element={<ProtectedPage><EmailLogsPage /></ProtectedPage>} />

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
