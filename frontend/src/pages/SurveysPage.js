import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Trash2, CheckCircle, XCircle,
  AlertCircle, Loader, FileText, ToggleRight, ToggleLeft, BarChart3,
  Image, X, Clock, Users, Edit3, Link2, Eye,
} from 'lucide-react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import Pagination from '../components/Pagination';
import {
  useEngagementStats, StatusMix, EngagementCards, GapChips, FilterBar, downloadCsv,
} from '../components/common/EngagementInsights';
import {
  listSurveys, createSurvey, deleteSurvey, updateSurvey, uploadSurveyImage,
} from '../services/api';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const BACKEND_URL = API_BASE.replace('/api/v1', '');

// Page breaks and section headers are layout, not questions — counting them
// overstated the survey's size (a 3-question survey with 2 page breaks read as 5).
const countQuestions = (questions) =>
  (questions || []).filter(
    (q) => q.question_type !== 'page_break' && q.question_type !== 'section_header'
  ).length;

// Titles/descriptions are rich text (HTML). Showing them as plain text needs the DOM,
// not a tag-strip regex: `replace(/<[^>]*>/g, '')` removes the tags but leaves the
// ENTITIES behind, which is why the card read "Test&nbsp;Servey&nbsp;Description".
// Setting innerHTML and reading textContent strips tags AND decodes entities.
const plainText = (html) => {
  if (!html) return '';
  const el = document.createElement('div');
  el.innerHTML = html;
  // &nbsp; decodes to U+00A0, which \s doesn't reliably match — normalise it first.
  return (el.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
};

const truncate = (s, n) => (s && s.length > n ? `${s.slice(0, n).trimEnd()}…` : s || '');

function StatusBadge({ status }) {
  const config = {
    active: { bg: 'var(--color-success-bg)', color: 'var(--color-success-text)', icon: <CheckCircle size={11} />, label: 'Active' },
    closed: { bg: 'var(--color-error-bg)', color: 'var(--color-error-text)', icon: <XCircle size={11} />, label: 'Closed' },
    draft: { bg: 'var(--color-surface-raised)', color: 'var(--color-text-secondary)', icon: <Clock size={11} />, label: 'Draft' },
  };
  const c = config[status] || config.draft;
  return (
    <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: '0.73rem', fontWeight: 600,
      display: 'inline-flex', alignItems: 'center', gap: 4, background: c.bg, color: c.color }}>
      {c.icon} {c.label}
    </span>
  );
}

export default function SurveysPage() {
  const navigate = useNavigate();
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('recent');

  // A filter that shrinks the list must not strand you on a page that no
  // longer exists.
  useEffect(() => { setPage(1); }, [search, statusFilter, sortBy]);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCoverImage, setNewCoverImage] = useState('');
  const [uploadingCover, setUploadingCover] = useState(false);
  const coverFileRef = useRef();
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const fetchData = useCallback(async () => {
    try {
      const res = await listSurveys();
      setSurveys(res.data || []);
    } catch (err) {
      console.error('Failed to load surveys', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    if (!newTitle.trim()) { setError('Title is required'); return; }
    setCreating(true);
    try {
      const res = await createSurvey({ title: newTitle.trim(), description: newDesc.trim() || null, cover_image: newCoverImage || null });
      setShowCreate(false); setNewTitle(''); setNewDesc(''); setNewCoverImage('');
      navigate(`/surveys/${res.data.id}/edit`);
    } catch { setError('Failed to create survey'); }
    finally { setCreating(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this survey and all its responses?')) return;
    try { await deleteSurvey(id); await fetchData(); }
    catch { setError('Failed to delete'); }
  };

  const handleToggleStatus = async (survey) => {
    const newStatus = survey.status === 'active' ? 'closed' : 'active';
    try { await updateSurvey(survey.id, { status: newStatus }); await fetchData(); }
    catch { setError('Failed to update status'); }
  };

  const copyLink = (token) => {
    navigator.clipboard.writeText(`${window.location.origin}/survey/${token}`);
    setCopiedId(token);
    setTimeout(() => setCopiedId(null), 2000);
  };


  // Hooks must run on every render, so the stats hook sits above the loading
  // early-return rather than after it.
  const stats = useEngagementStats(surveys, { countKey: 'response_count' });

  if (loading) {
    return <div className="page container"><div className="loading-container"><div className="spinner"></div><p>Loading surveys...</p></div></div>;
  }

  const totalResponses = surveys.reduce((sum, s) => sum + (s.response_count || 0), 0);
  const activeSurveys = surveys.filter(s => s.status === 'active').length;
  const closedSurveys = surveys.filter(s => s.status === 'closed').length;
  // 'draft' fell between Active and Closed, so a page of unlaunched surveys
  // showed three zeroes with no hint of where they had gone.
  const draftSurveys = surveys.filter(s => (s.status || 'draft') === 'draft').length;

  const q = search.trim().toLowerCase();
  const visible = surveys
    .filter(s => (!q || (s.title || '').toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)))
    .filter(s => (!statusFilter || (s.status || 'draft') === statusFilter))
    .sort((a, b) => {
      switch (sortBy) {
        case 'responses': return (b.response_count || 0) - (a.response_count || 0);
        case 'title': return (a.title || '').localeCompare(b.title || '');
        case 'oldest': return new Date(a.created_at) - new Date(b.created_at);
        default: return new Date(b.created_at) - new Date(a.created_at);
      }
    });

  const filtersActive = Boolean(q || statusFilter);
  const clearFilters = () => { setSearch(''); setStatusFilter(''); };

  const exportCsv = () => downloadCsv(
    `surveys-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Title', 'Status', 'Responses', 'Created'],
    visible.map(s => [
      s.title, s.status, s.response_count || 0,
      s.created_at ? new Date(s.created_at).toLocaleDateString() : '',
    ]),
  );

  return (
    <div className="page container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="sr-only">Surveys</h1>
          <p style={{ color: 'var(--color-text-secondary)' }}>Create surveys, share links, and collect responses</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
          <Plus size={16} /> Create Survey
        </button>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center' }}>
          <AlertCircle size={16} /> <span style={{ flex: 1, marginLeft: 8 }}>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><XCircle size={16} /></button>
        </div>
      )}

      {/* Create Form */}
      {showCreate && (
        <div className="card" style={{ marginBottom: 24, overflow: 'hidden' }}>
          <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--color-border-light)', background: 'var(--color-primary-bg)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus size={16} style={{ color: 'var(--color-primary)' }} />
            <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-primary)', fontWeight: 600 }}>New Survey</h4>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Title *</label>
              <input className="form-control" placeholder="e.g. HCP Feedback Survey" value={newTitle}
                onChange={e => setNewTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Description (optional)</label>
              <ReactQuill theme="snow" value={newDesc} onChange={setNewDesc} placeholder="Brief description of the survey"
                modules={{ toolbar: [['bold', 'italic', 'underline', 'strike'], [{ 'header': [1, 2, 3, false] }], [{ 'list': 'ordered' }, { 'list': 'bullet' }], [{ 'align': [] }], ['link'], ['clean']] }}
                style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)' }} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 6 }}>Cover Image (optional)</label>
              <input ref={coverFileRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setUploadingCover(true);
                  try { const res = await uploadSurveyImage(file); setNewCoverImage(res.data.url); }
                  catch { setError('Image upload failed'); }
                  finally { setUploadingCover(false); if (coverFileRef.current) coverFileRef.current.value = ''; }
                }} />
              {newCoverImage ? (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img src={newCoverImage.startsWith('http') ? newCoverImage : `${BACKEND_URL}${newCoverImage}`} alt="Cover"
                    style={{ maxWidth: '100%', maxHeight: 130, borderRadius: 'var(--radius)', border: '1px solid var(--color-border)', objectFit: 'cover' }} />
                  <button onClick={() => setNewCoverImage('')} type="button"
                    style={{ position: 'absolute', top: 4, right: 4, background: 'var(--color-error)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    <X size={11} />
                  </button>
                </div>
              ) : (
                <button className="btn btn-sm btn-secondary" onClick={() => coverFileRef.current?.click()} disabled={uploadingCover} type="button">
                  {uploadingCover ? <Loader size={14} className="spinning" /> : <Image size={14} />} Upload Cover Image
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
                {creating ? <Loader size={14} className="spinning" /> : <><Plus size={14} /> Create & Add Questions</>}
              </button>
              <button className="btn btn-ghost" onClick={() => { setShowCreate(false); setNewTitle(''); setNewDesc(''); setNewCoverImage(''); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="stats-row" style={{ marginBottom: 28 }}>
        <div className="stat-card">
          <div className="stat-icon primary"><FileText size={20} /></div>
          <div className="stat-label">Total Surveys</div>
          <div className="stat-value">{surveys.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon success"><CheckCircle size={20} /></div>
          <div className="stat-label">Active</div>
          <div className="stat-value">{activeSurveys}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon warning"><Clock size={20} /></div>
          <div className="stat-label">Closed</div>
          <div className="stat-value">{closedSurveys}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon info"><Users size={20} /></div>
          <div className="stat-label">Total Responses</div>
          <div className="stat-value">{totalResponses}</div>
          <div className="stat-sub">avg {stats.avgPerItem} per survey</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon primary"><Edit3 size={20} /></div>
          <div className="stat-label">Drafts</div>
          <div className="stat-value">{draftSurveys}</div>
          <div className="stat-sub">not launched yet</div>
        </div>
      </div>

      <StatusMix stats={stats} noun="surveys" statusFilter={statusFilter} onStatusFilter={setStatusFilter} />
      <EngagementCards stats={stats} unit="responses" onOpen={(s) => navigate(`/surveys/${s.id}/results`)} />
      <GapChips stats={stats} onPick={(g) => setStatusFilter(g.key === 'draft' ? 'draft' : 'active')} />

      {surveys.length > 0 && (
        <FilterBar
          search={search} onSearch={setSearch}
          statusFilter={statusFilter} onStatusFilter={setStatusFilter} statusRows={stats.statusRows}
          sortBy={sortBy} onSort={setSortBy}
          sortOptions={[
            { value: 'recent', label: 'Newest first' },
            { value: 'oldest', label: 'Oldest first' },
            { value: 'responses', label: 'Most responses' },
            { value: 'title', label: 'Title A–Z' },
          ]}
          onExport={exportCsv} exportDisabled={visible.length === 0}
          showing={visible.length} totalCount={surveys.length} noun="surveys"
          onClear={clearFilters} filtersActive={filtersActive}
        />
      )}

      {/* Surveys List */}
      {surveys.length === 0 ? (
        <div className="card" style={{ padding: '60px 40px', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--color-primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <FileText size={28} style={{ color: 'var(--color-primary)' }} />
          </div>
          <h3 style={{ marginBottom: 6 }}>No Surveys Yet</h3>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: 20 }}>Create your first survey to start collecting responses.</p>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Create Your First Survey
          </button>
        </div>
      ) : (
        <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visible.slice((page - 1) * pageSize, page * pageSize).map(s => {
            const coverImg = s.cover_image ? (s.cover_image.startsWith('http') ? s.cover_image : `${BACKEND_URL}${s.cover_image}`) : null;
            return (
              <div key={s.id} className="card" style={{ overflow: 'hidden', transition: 'all var(--transition)' }}>
                <div style={{ display: 'flex', alignItems: 'stretch' }}>
                  {/* Cover image thumbnail */}
                  {coverImg && (
                    <div style={{ width: 100, minHeight: 100, flexShrink: 0, background: `url(${coverImg}) center/cover no-repeat`, borderRight: '1px solid var(--color-border-light)' }} />
                  )}

                  {/* Content */}
                  <div style={{ flex: 1, padding: '14px 20px', minWidth: 0, overflow: 'hidden' }}>
                    {/* Row 1: Title + Description + Status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--color-text)', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                            onClick={() => navigate(`/surveys/${s.id}/edit`)}>
                            {s.title}
                          </span>
                          <StatusBadge status={s.status} />
                        </div>
                        {plainText(s.description) && (
                          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-light)', margin: '2px 0 0', lineHeight: 1.3,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {truncate(plainText(s.description), 80)}
                          </p>
                        )}
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    </div>

                    {/* Row 2: Metrics + Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 12, flex: 1 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                          <FileText size={12} style={{ color: 'var(--color-primary-light)' }} />
                          <strong style={{ color: 'var(--color-text)' }}>{countQuestions(s.questions)}</strong> questions
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                          <Users size={12} style={{ color: 'var(--color-success)' }} />
                          <strong style={{ color: 'var(--color-text)' }}>{s.response_count || 0}</strong> responses
                        </span>
                      </div>

                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                        <button className="btn btn-sm btn-outline" onClick={() => navigate(`/surveys/${s.id}/edit`)} title="Edit survey">
                          <Edit3 size={13} /> Edit
                        </button>
                        {s.response_count > 0 && (
                          <button className="btn btn-sm btn-outline" onClick={() => navigate(`/surveys/${s.id}/results`)} title="View results">
                            <BarChart3 size={13} /> Results
                          </button>
                        )}
                        <button className="btn btn-sm btn-secondary" onClick={() => copyLink(s.token)} title="Copy survey link">
                          {copiedId === s.token ? <><CheckCircle size={13} style={{ color: 'var(--color-success)' }} /> Copied</> : <><Link2 size={13} /> Link</>}
                        </button>
                        {s.status === 'active' && (
                          <button className="btn btn-sm btn-ghost" onClick={() => window.open(`/survey/${s.token}`, '_blank')} title="Preview survey">
                            <Eye size={13} />
                          </button>
                        )}
                        <button className="btn btn-sm btn-ghost" onClick={() => handleToggleStatus(s)}
                          title={s.status === 'active' ? 'Close survey' : 'Activate survey'}>
                          {s.status === 'active' ? <ToggleRight size={14} style={{ color: 'var(--color-success)' }} /> : <ToggleLeft size={14} />}
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => handleDelete(s.id)} title="Delete"
                          style={{ color: 'var(--color-text-light)' }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--color-error)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-light)'}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <Pagination currentPage={page} totalItems={visible.length} pageSize={pageSize}
          onPageChange={setPage} onPageSizeChange={n => { setPageSize(n); setPage(1); }} />
        </>
      )}
    </div>
  );
}

