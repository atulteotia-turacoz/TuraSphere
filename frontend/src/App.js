import React from 'react';
import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/common/ProtectedRoute';
import Sidebar from './components/common/Sidebar';
import AppBar from './components/common/AppBar';
import ComingSoonPage from './pages/ComingSoonPage';
import { getMe } from './services/api';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import NewHCPPage from './pages/NewHCPPage';
import HCPDetailPage from './pages/HCPDetailPage';
import KOLDetailPage from './pages/KOLDetailPage';
import AssessmentPage from './pages/AssessmentPage';
import ResultsPage from './pages/ResultsPage';
import AccountPage from './pages/AccountPage';
import AssessmentsListPage from './pages/AssessmentsListPage';
import CheckoutPage from './pages/CheckoutPage';
import PublicFormPage from './pages/PublicFormPage';
import SurveysPage from './pages/SurveysPage';
import SurveyEditPage from './pages/SurveyEditPage';
import SurveyResultsPage from './pages/SurveyResultsPage';
import PublicSurveyPage from './pages/PublicSurveyPage';
import PublicPollPage from './pages/PublicPollPage';
import PublicMeetingJoinPage from './pages/PublicMeetingJoinPage';
import PublicClientPortalPage from './pages/PublicClientPortalPage';
import PollingPage from './pages/PollingPage';
import AdvisoryBoardsPage from './pages/AdvisoryBoardsPage';
import MeetingRoomPage from './pages/MeetingRoomPage';

const COLLAPSE_KEY = 'turaquant-sidebar-collapsed';

function AuthenticatedLayout({ children }) {
  // The shell owns the chrome state so the app bar and the sidebar stay in sync
  // — the collapse control sits in the bar, the thing it collapses does not.
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (e) { return false; }
  });
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [userName, setUserName] = React.useState('');
  const [allowedServices, setAllowedServices] = React.useState(null); // null = all

  React.useEffect(() => {
    getMe()
      .then((res) => {
        setUserName(res.data.full_name || res.data.email || 'User');
        const role = res.data.role;
        if (role === 'super_admin' || role === 'admin') {
          setAllowedServices(null); // admins see everything
        } else if (Array.isArray(res.data.effective_services)) {
          // The API now computes granted ∩ selected, so the UI does not have to
          // re-derive it (and cannot get the intersection wrong).
          setAllowedServices(res.data.effective_services);
        } else {
          // Older API without the computed field: fall back to the raw JSON.
          let services = null;
          try {
            services = res.data.allowed_services ? JSON.parse(res.data.allowed_services) : null;
          } catch { services = null; }
          setAllowedServices(services);
        }
      })
      .catch(() => {});
  }, []);

  const toggleCollapse = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch (e) { /* ignore */ }
      return next;
    });
  }, []);

  const closeDrawer = React.useCallback(() => setDrawerOpen(false), []);

  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar
        collapsed={collapsed}
        drawerOpen={drawerOpen}
        onCloseDrawer={closeDrawer}
        allowedServices={allowedServices}
      />
      <div className="app-main">
        <AppBar
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onOpenDrawer={() => setDrawerOpen(true)}
          userName={userName}
        />
        <div className="app-content">{children}</div>
      </div>
    </div>
  );
}

function ProtectedPage({ children }) {
  return (
    <ProtectedRoute>
      <AuthenticatedLayout>
        {children}
      </AuthenticatedLayout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/form/:token" element={<PublicFormPage />} />
      <Route path="/survey/:token" element={<PublicSurveyPage />} />
      <Route path="/poll/:token" element={<PublicPollPage />} />
      <Route path="/meeting/join/:token" element={<PublicMeetingJoinPage />} />
      <Route path="/client/:token" element={<PublicClientPortalPage />} />

      {/* Protected routes */}
      <Route path="/dashboard" element={<ProtectedPage><DashboardPage /></ProtectedPage>} />
      <Route path="/advisory-boards" element={<ProtectedPage><AdvisoryBoardsPage /></ProtectedPage>} />
      {/* Full-screen meeting room — no navbar/layout chrome */}
      <Route path="/meeting-room/:meetingId" element={<ProtectedRoute><MeetingRoomPage /></ProtectedRoute>} />
      <Route path="/assessments" element={<ProtectedPage><AssessmentsListPage /></ProtectedPage>} />
      <Route path="/surveys" element={<ProtectedPage><SurveysPage /></ProtectedPage>} />
      <Route path="/surveys/:id/edit" element={<ProtectedPage><SurveyEditPage /></ProtectedPage>} />
      <Route path="/surveys/:id/results" element={<ProtectedPage><SurveyResultsPage /></ProtectedPage>} />
      <Route path="/polling" element={<ProtectedPage><PollingPage /></ProtectedPage>} />
      <Route path="/hcp/new" element={<ProtectedPage><NewHCPPage /></ProtectedPage>} />
      {/* Same form in re-assessment mode: the record exists, so the fields
          arrive pre-filled and saving updates instead of creating. */}
      <Route path="/hcp/:id/reassess" element={<ProtectedPage><NewHCPPage /></ProtectedPage>} />
      <Route path="/hcp/:id" element={<ProtectedPage><HCPDetailPage /></ProtectedPage>} />
      <Route path="/kols/:id" element={<ProtectedPage><KOLDetailPage /></ProtectedPage>} />
      <Route path="/hcp/:id/assess" element={<ProtectedPage><AssessmentPage /></ProtectedPage>} />
      <Route path="/hcp/:id/results" element={<ProtectedPage><ResultsPage /></ProtectedPage>} />
      <Route path="/account" element={<ProtectedPage><AccountPage /></ProtectedPage>} />
      {/* Granted but not yet built — a real page beats a 404. */}
      <Route path="/publications" element={<ProtectedPage><ComingSoonPage module="publications" /></ProtectedPage>} />
      <Route path="/consensus" element={<ProtectedPage><ComingSoonPage module="consensus" /></ProtectedPage>} />
      <Route path="/recent-guidelines" element={<ProtectedPage><ComingSoonPage module="recent_guidelines" /></ProtectedPage>} />
      <Route path="/checkout" element={<ProtectedPage><CheckoutPage /></ProtectedPage>} />
    </Routes>
  );
}
