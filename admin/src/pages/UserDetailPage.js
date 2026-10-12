import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Check, FileText, BarChart3, ClipboardCheck, Users, UserSearch,
  Loader, AlertTriangle, Download, Trash2, Eye, X,
} from 'lucide-react';
import { getUserDetail, updateUser, downloadInvoicePdf, deleteHCP, deleteAssessment, deleteSurvey, deletePoll, deleteFormSubmission, downloadSubmissionCV } from '../services/api';
import UserKolTiersTab from './UserKolTiersTab';

const ALL_SERVICES = [
  { slug: 'assessments', label: 'KOL', icon: <ClipboardCheck size={15} /> },
  // Sub-tab of KOL Assessments, gated separately so scraping can be sold on its own.
  { slug: 'find_kols', label: 'Find KOLs', icon: <UserSearch size={15} /> },
  { slug: 'surveys', label: 'Surveys', icon: <FileText size={15} /> },
  { slug: 'polling', label: 'Polling', icon: <BarChart3 size={15} /> },
  { slug: 'assessment_forms', label: 'Assessment Forms', icon: <ClipboardCheck size={15} /> },
  { slug: 'advisory_boards', label: 'Advisory Boards', icon: <Users size={15} /> },
  { slug: 'publications', label: 'Publications', icon: <FileText size={15} /> },
  { slug: 'consensus', label: 'Consensus', icon: <Users size={15} /> },
  { slug: 'recent_guidelines', label: 'Recent Guidelines', icon: <FileText size={15} /> },
];

export default function UserDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [viewSubmission, setViewSubmission] = useState(null);

  const fetchData = async () => {
    try {
      const res = await getUserDetail(id);
      setData(res.data);
    } catch { }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [id]);
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); } }, [success]);

  const toggleService = async (slug) => {
    if (!data) return;
    setSaving(true);
    // An admin GRANTS; they do not make the user's selection for them. This
    // toggled `allowed_services` — the user's own switch — so revoking a module
    // here left the grant intact and the module stayed listed (just unchecked)
    // on the user's dashboard.
    const current = data.granted_services || [];
    const newServices = current.includes(slug) ? current.filter(s => s !== slug) : [...current, slug];
    try {
      // `[]` not `null`: null means "unrestricted" in the backend, so sending
      // it when the last module is revoked would grant the user everything.
      await updateUser(id, { granted_services: newServices });
      setSuccess('Services updated');
      await fetchData();
    } catch { }
    finally { setSaving(false); }
  };

  const handleDownloadInvoice = async (invoiceId) => {
    try {
      const res = await downloadInvoicePdf(invoiceId);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a'); a.href = url; a.download = `invoice_${invoiceId}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { setSuccess('Failed to download invoice'); }
  };

  const handleDownloadCV = async (submissionId, name) => {
    try {
      const res = await downloadSubmissionCV(submissionId);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a'); a.href = url; a.download = `cv_${name || submissionId}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { setSuccess('Failed to download CV'); }
  };

  const handleDelete = async (type, itemId, label) => {
    if (!window.confirm(`Delete this ${label}? This cannot be undone.`)) return;
    try {
      if (type === 'hcp') await deleteHCP(itemId);
      else if (type === 'assessment') await deleteAssessment(itemId);
      else if (type === 'survey') await deleteSurvey(itemId);
      else if (type === 'poll') await deletePoll(itemId);
      else if (type === 'submission') await deleteFormSubmission(itemId);
      setSuccess(`${label} deleted`);
      await fetchData();
    } catch { setSuccess(`Failed to delete ${label}`); }
  };

  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center' }}>User not found</div>;

  const services = data.granted_services || [];
  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'hcps', label: `HCPs (${data.hcps?.length || 0})` },
    { key: 'assessments', label: `Assessments (${data.assessments?.length || 0})` },
    { key: 'surveys', label: `Surveys (${data.surveys?.length || 0})` },
    { key: 'polls', label: `Polls (${data.polls?.length || 0})` },
    { key: 'submissions', label: `Form Submissions (${data.form_submissions?.length || 0})` },
    { key: 'billing', label: 'Billing' },
    // The account holder sees its bands read-only; this is where they are set.
    { key: 'kol-tiers', label: 'KOL Tiers' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-outline btn-sm" onClick={() => navigate('/users')} style={{ padding: '6px 10px' }}>
          <ArrowLeft size={16} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 className="page-title" style={{ marginBottom: 2 }}>{data.full_name}</h1>
          <p className="page-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {data.email}
            <span className={`badge badge-${data.role}`}>{(data.role || 'user').replace('_', ' ')}</span>
            <span className={`badge ${data.is_active ? 'badge-active' : 'badge-inactive'}`}>{data.is_active ? 'Active' : 'Inactive'}</span>
            {data.organization && <span style={{ color: 'var(--text-muted)' }}>{data.organization}</span>}
          </p>
        </div>
      </div>

      {success && <div className="alert alert-success"><Check size={16} /> {success}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid var(--border-color)' }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
              fontWeight: activeTab === tab.key ? 600 : 400, fontSize: '0.9rem',
              color: activeTab === tab.key ? 'var(--primary)' : 'var(--text-secondary)',
              borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
              marginBottom: '-2px', transition: 'all 0.15s',
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══ Overview Tab ══ */}
      {activeTab === 'overview' && (
        <>
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
            {[
              { label: 'HCP Profiles', value: data.hcps?.length || 0, color: 'var(--primary)' },
              { label: 'Assessments', value: data.assessments?.length || 0, color: 'var(--success)' },
              { label: 'Surveys', value: data.surveys?.length || 0, color: 'var(--tier-bronze)' },
              { label: 'Polls', value: data.polls?.length || 0, color: 'var(--tier-platinum)' },
            ].map((s, i) => (
              <div key={i} style={{ background: 'var(--content-card-bg)', padding: '18px 20px', borderRadius: 10, border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Allowed Services */}
          <div className="table-container" style={{ marginBottom: 24 }}>
            <div className="table-header">
              <h3>Allowed Services {saving && <Loader size={14} className="spinner" style={{ marginLeft: 8 }} />}</h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
                {services.length === 0 ? 'No modules granted — this user sees nothing' : `${services.length} module(s) granted`}
              </p>
            </div>
            <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
              {ALL_SERVICES.map(svc => {
                const isOn = services.includes(svc.slug);
                return (
                  <button key={svc.slug} onClick={() => toggleService(svc.slug)}
                    style={{
                      padding: '12px 16px', borderRadius: 10, border: '2px solid', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.15s', width: '100%',
                      borderColor: isOn ? 'var(--primary)' : 'var(--border-color)', background: isOn ? 'var(--primary-light)' : 'var(--content-bg)',
                      color: isOn ? 'var(--primary)' : 'var(--text-secondary)', fontSize: '0.88rem', fontWeight: 500, textAlign: 'left',
                    }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: 6, border: '2px solid', flexShrink: 0,
                      borderColor: isOn ? 'var(--primary)' : 'var(--border-strong)', background: isOn ? 'var(--primary)' : 'var(--content-card-bg)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {isOn && <Check size={14} style={{ color: 'var(--text-white)' }} />}
                    </div>
                    {svc.icon}
                    {svc.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* User Info */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="table-container">
              <div className="table-header"><h3>Subscription</h3></div>
              <div style={{ padding: '16px 20px' }}>
                {data.subscription ? (
                  <div style={{ fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div><strong>Plan:</strong> {data.subscription.plan_name}</div>
                    <div><strong>Status:</strong> <span className={`badge badge-${data.subscription.status}`}>{data.subscription.status}</span></div>
                    <div><strong>Cycle:</strong> {data.subscription.cycle}</div>
                    {data.subscription.expires_at && <div><strong>Expires:</strong> {new Date(data.subscription.expires_at).toLocaleDateString()}</div>}
                  </div>
                ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>No active subscription</p>}
              </div>
            </div>
            <div className="table-container">
              <div className="table-header"><h3>Invoices ({data.invoices?.length || 0})</h3></div>
              <div style={{ padding: data.invoices?.length ? 0 : '16px 20px' }}>
                {data.invoices?.length > 0 ? (
                  <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.78rem' }}>Date</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.78rem' }}>Amount</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.78rem' }}>Status</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem' }}>PDF</th>
                    </tr></thead>
                    <tbody>{data.invoices.map(inv => (
                      <tr key={inv.id} style={{ borderBottom: '1px solid var(--content-raised)' }}>
                        <td style={{ padding: '8px 12px' }}>{new Date(inv.created_at).toLocaleDateString()}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>${inv.amount}</td>
                        <td style={{ padding: '8px 12px' }}><span className={`badge badge-${inv.status}`}>{inv.status}</span></td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <button className="btn-icon" title="Download PDF" onClick={() => handleDownloadInvoice(inv.id)}>
                            <Download size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>No invoices</p>}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ══ HCPs Tab ══ */}
      {activeTab === 'hcps' && (
        <div className="table-container">
          <div className="table-header"><h3>HCP Profiles</h3></div>
          <div className="table-wrapper">
            <table>
              <thead><tr>
                <th>ID</th><th>Name</th><th>Specialty</th><th>Institution</th><th>Status</th><th>Created</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {(data.hcps || []).length > 0 ? data.hcps.map(h => (
                  <tr key={h.id}>
                    <td className="font-mono">{h.id}</td>
                    <td><strong>{h.full_name}</strong></td>
                    <td>{h.specialty || '--'}</td>
                    <td>{h.institution || '--'}</td>
                    <td><span className={`badge badge-${h.status}`}>{h.status}</span></td>
                    <td className="text-muted">{h.created_at ? new Date(h.created_at).toLocaleDateString() : '--'}</td>
                    <td><button className="btn-icon" title="Delete" onClick={() => handleDelete('hcp', h.id, 'HCP')}><Trash2 size={14} style={{ color: 'var(--danger)' }} /></button></td>
                  </tr>
                )) : <tr><td colSpan={7} className="table-empty"><p>No HCP profiles</p></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ Assessments Tab ══ */}
      {activeTab === 'assessments' && (
        <div className="table-container">
          <div className="table-header"><h3>Assessments</h3></div>
          <div className="table-wrapper">
            <table>
              <thead><tr>
                <th>ID</th><th>HCP</th><th>Score</th><th>Tier</th><th>Date</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {(data.assessments || []).length > 0 ? data.assessments.map(a => (
                  <tr key={a.id}>
                    <td className="font-mono">{a.id}</td>
                    <td><strong>{a.hcp_name}</strong></td>
                    <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{a.final_score?.toFixed(1)}</td>
                    <td><span className={`badge badge-${(a.tier || '').replace(/\s/g, '_')}`}>{(a.tier || '').replace(/_/g, ' ')}</span></td>
                    <td className="text-muted">{a.created_at ? new Date(a.created_at).toLocaleDateString() : '--'}</td>
                    <td><button className="btn-icon" title="Delete" onClick={() => handleDelete('assessment', a.id, 'Assessment')}><Trash2 size={14} style={{ color: 'var(--danger)' }} /></button></td>
                  </tr>
                )) : <tr><td colSpan={6} className="table-empty"><p>No assessments</p></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ Surveys Tab ══ */}
      {activeTab === 'surveys' && (
        <div className="table-container">
          <div className="table-header"><h3>Surveys</h3></div>
          <div className="table-wrapper">
            <table>
              <thead><tr>
                <th>ID</th><th>Title</th><th>Questions</th><th>Responses</th><th>Status</th><th>Created</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {(data.surveys || []).length > 0 ? data.surveys.map(s => (
                  <tr key={s.id}>
                    <td className="font-mono">{s.id}</td>
                    <td><strong>{s.title}</strong></td>
                    <td>{s.question_count}</td>
                    <td style={{ fontWeight: 600 }}>{s.response_count}</td>
                    <td><span className={`badge badge-${s.status}`}>{s.status}</span></td>
                    <td className="text-muted">{new Date(s.created_at).toLocaleDateString()}</td>
                    <td><button className="btn-icon" title="Delete" onClick={() => handleDelete('survey', s.id, 'Survey')}><Trash2 size={14} style={{ color: 'var(--danger)' }} /></button></td>
                  </tr>
                )) : <tr><td colSpan={7} className="table-empty"><p>No surveys</p></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ Polls Tab ══ */}
      {activeTab === 'polls' && (
        <div className="table-container">
          <div className="table-header"><h3>Polls</h3></div>
          <div className="table-wrapper">
            <table>
              <thead><tr>
                <th>ID</th><th>Title</th><th>Votes</th><th>Status</th><th>Created</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {(data.polls || []).length > 0 ? data.polls.map(p => (
                  <tr key={p.id}>
                    <td className="font-mono">{p.id}</td>
                    <td><strong>{p.title}</strong></td>
                    <td style={{ fontWeight: 600 }}>{p.vote_count}</td>
                    <td><span className={`badge badge-${p.status}`}>{p.status}</span></td>
                    <td className="text-muted">{new Date(p.created_at).toLocaleDateString()}</td>
                    <td><button className="btn-icon" title="Delete" onClick={() => handleDelete('poll', p.id, 'Poll')}><Trash2 size={14} style={{ color: 'var(--danger)' }} /></button></td>
                  </tr>
                )) : <tr><td colSpan={6} className="table-empty"><p>No polls</p></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ Form Submissions Tab ══ */}
      {activeTab === 'submissions' && (
        <div className="table-container">
          <div className="table-header"><h3>Form Submissions</h3></div>
          <div className="table-wrapper">
            <table>
              <thead><tr>
                <th>ID</th><th>Name</th><th>Email</th><th>Specialty</th><th>CV</th><th>Status</th><th>Submitted</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {(data.form_submissions || []).length > 0 ? data.form_submissions.map(s => (
                  <tr key={s.id}>
                    <td className="font-mono">{s.id}</td>
                    <td><strong>{s.full_name}</strong></td>
                    <td>{s.email}</td>
                    <td>{s.specialty}</td>
                    <td>{s.has_cv ? <button className="btn-icon" title="Download CV" onClick={() => handleDownloadCV(s.id, s.full_name)}><Download size={14} style={{ color: 'var(--primary)' }} /></button> : <span className="badge badge-inactive">No</span>}</td>
                    <td><span style={{
                      display: 'inline-block', padding: '2px 10px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600,
                      background: s.status === 'assessed' ? 'var(--success-light)' : s.status === 'pending' ? 'var(--warning-light)' : s.status === 'failed' ? 'var(--danger-light)' : 'var(--info-light)',
                      color: s.status === 'assessed' ? 'var(--success)' : s.status === 'pending' ? 'var(--warning)' : s.status === 'failed' ? 'var(--danger)' : 'var(--info)',
                    }}>{s.status === 'assessed' ? 'Assessed' : s.status === 'pending' ? 'Pending' : s.status === 'failed' ? 'Failed' : s.status}</span></td>
                    <td className="text-muted">{s.created_at ? new Date(s.created_at).toLocaleDateString() : '--'}</td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-icon" title="View Details" onClick={() => setViewSubmission(s)}><Eye size={14} style={{ color: 'var(--primary)' }} /></button>
                      <button className="btn-icon" title="Delete" onClick={() => handleDelete('submission', s.id, 'Submission')}><Trash2 size={14} style={{ color: 'var(--danger)' }} /></button>
                    </td>
                  </tr>
                )) : <tr><td colSpan={8} className="table-empty"><p>No form submissions</p></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ Billing Tab ══ */}
      {activeTab === 'billing' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="table-container">
            <div className="table-header"><h3>Subscription</h3></div>
            <div style={{ padding: '16px 20px' }}>
              {data.subscription ? (
                <div style={{ fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div><strong>Plan:</strong> {data.subscription.plan_name}</div>
                  <div><strong>Status:</strong> <span className={`badge badge-${data.subscription.status}`}>{data.subscription.status}</span></div>
                  <div><strong>Cycle:</strong> {data.subscription.cycle}</div>
                  {data.subscription.expires_at && <div><strong>Expires:</strong> {new Date(data.subscription.expires_at).toLocaleDateString()}</div>}
                </div>
              ) : <p style={{ color: 'var(--text-muted)' }}>No active subscription</p>}
            </div>
          </div>
          <div className="table-container">
            <div className="table-header"><h3>Billing Profile</h3></div>
            <div style={{ padding: '16px 20px' }}>
              {data.billing ? (
                <div style={{ fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.billing.company_name && <div><strong>Company:</strong> {data.billing.company_name}</div>}
                  {data.billing.address && <div><strong>Address:</strong> {data.billing.address}</div>}
                  {data.billing.gst && <div><strong>GST:</strong> {data.billing.gst}</div>}
                </div>
              ) : <p style={{ color: 'var(--text-muted)' }}>No billing profile</p>}
            </div>
          </div>
          <div className="table-container" style={{ gridColumn: '1 / -1' }}>
            <div className="table-header"><h3>Invoices ({data.invoices?.length || 0})</h3></div>
            <div className="table-wrapper">
              <table>
                <thead><tr>
                  <th>ID</th><th>Date</th><th>Amount</th><th>Status</th><th>PDF</th>
                </tr></thead>
                <tbody>
                  {(data.invoices || []).length > 0 ? data.invoices.map(inv => (
                    <tr key={inv.id}>
                      <td className="font-mono">{inv.id}</td>
                      <td>{new Date(inv.created_at).toLocaleDateString()}</td>
                      <td style={{ fontWeight: 600 }}>${inv.amount}</td>
                      <td><span className={`badge badge-${inv.status}`}>{inv.status}</span></td>
                      <td>
                        <button className="btn-icon" title="Download PDF" onClick={() => handleDownloadInvoice(inv.id)}>
                          <Download size={14} />
                        </button>
                      </td>
                    </tr>
                  )) : <tr><td colSpan={5} className="table-empty"><p>No invoices</p></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {activeTab === 'kol-tiers' && (
        <UserKolTiersTab userId={data.user?.id ?? data.id} userEmail={data.user?.email ?? data.email} />
      )}

      {/* ══ Submission Detail Modal ══ */}
      {viewSubmission && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setViewSubmission(null)}>
          <div style={{
            background: 'var(--content-card-bg)', borderRadius: 12, width: '100%', maxWidth: 600,
            maxHeight: '80vh', overflow: 'auto', padding: '24px',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>Submission Details</h3>
              <button className="btn-icon" onClick={() => setViewSubmission(null)}><X size={18} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px', fontSize: '0.88rem' }}>
              {[
                ['Full Name', viewSubmission.full_name],
                ['Email', viewSubmission.email],
                ['City', viewSubmission.city],
                ['Specialty', viewSubmission.specialty],
                ['Institution', viewSubmission.institution],
                ['Designation', viewSubmission.designation],
                ['Experience', viewSubmission.years_of_experience ? `${viewSubmission.years_of_experience} years` : '--'],
                ['Status', viewSubmission.status],
              ].map(([label, value], i) => (
                <div key={i}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontWeight: 500 }}>{value || '--'}</div>
                </div>
              ))}
            </div>
            <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--border-color)' }} />
            {[
              ['Key Clinical Interests', viewSubmission.key_clinical_interests],
              ['Publications', viewSubmission.publications],
              ['Conference Presentations', viewSubmission.conference_presentations],
              ['Professional Memberships', viewSubmission.professional_memberships],
              ['Awards & Recognitions', viewSubmission.awards_recognitions],
            ].map(([label, value], i) => (
              <div key={i} style={{ marginBottom: 12, fontSize: '0.88rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
                <div style={{ whiteSpace: 'pre-wrap', color: value && value !== '--' ? 'var(--text-primary)' : 'var(--border-strong)' }}>{value || '--'}</div>
              </div>
            ))}
            {viewSubmission.has_cv && (
              <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }}
                onClick={() => handleDownloadCV(viewSubmission.id, viewSubmission.full_name)}>
                <Download size={14} /> Download CV
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
