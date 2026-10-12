import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, CheckCircle, XCircle,
  AlertCircle, Loader, FileText, ToggleRight, ToggleLeft, BarChart3,
  Clock, Users, Link2, Eye, Edit3, Save,
} from 'lucide-react';
import {
  listPolls, createPoll, deletePoll, updatePoll, getPollResults, deletePollVote,
} from '../services/api';
import {
  useEngagementStats, StatusMix, EngagementCards, GapChips, FilterBar, downloadCsv,
} from '../components/common/EngagementInsights';

function StatusBadge({ status }) {
  const config = {
    active: { bg: 'var(--color-success-bg)', color: 'var(--color-success-text)', label: 'Active' },
    closed: { bg: 'var(--color-error-bg)', color: 'var(--color-error-text)', label: 'Closed' },
    draft: { bg: 'var(--color-surface-raised)', color: 'var(--color-text-secondary)', label: 'Draft' },
  };
  const c = config[status] || config.draft;
  return <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: '0.73rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, background: c.bg, color: c.color }}>{c.label}</span>;
}

export default function PollingPage() {
  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('recent');
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newQuestions, setNewQuestions] = useState([
    { title: '', options: ['', ''], allow_multiple: false },
  ]);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [error, setError] = useState('');
  const [expandedPoll, setExpandedPoll] = useState(null);
  const [pollResults, setPollResults] = useState(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const [editingPoll, setEditingPoll] = useState(null); // poll id being edited
  const [editTitle, setEditTitle] = useState('');
  const [editQuestions, setEditQuestions] = useState([]);
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchPolls = useCallback(async () => {
    try { const res = await listPolls(); setPolls(res.data || []); }
    catch { console.error('Failed to load polls'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchPolls(); }, [fetchPolls]);

  // ── Question helpers for create form ──
  const addNewQuestion = (type = 'choice') => setNewQuestions(prev => [...prev, { title: '', type, options: type === 'choice' ? ['', ''] : [], allow_multiple: false }]);
  const removeNewQuestion = (qi) => setNewQuestions(prev => prev.filter((_, i) => i !== qi));
  const updateNewQuestion = (qi, field, val) => setNewQuestions(prev => prev.map((q, i) => i === qi ? { ...q, [field]: val } : q));
  const addNewOption = (qi) => setNewQuestions(prev => prev.map((q, i) => i === qi ? { ...q, options: [...q.options, ''] } : q));
  const updateNewOption = (qi, oi, val) => setNewQuestions(prev => prev.map((q, i) => {
    if (i !== qi) return q;
    const opts = [...q.options]; opts[oi] = val; return { ...q, options: opts };
  }));
  const removeNewOption = (qi, oi) => setNewQuestions(prev => prev.map((q, i) => i !== qi ? q : { ...q, options: q.options.filter((_, j) => j !== oi) }));

  const handleCreate = async () => {
    if (!newTitle.trim()) { setError('Poll title is required'); return; }
    for (let i = 0; i < newQuestions.length; i++) {
      const q = newQuestions[i];
      if (!q.title.trim()) { setError(`Question ${i + 1} title is required`); return; }
      if (q.type !== 'text') {
        const validOpts = q.options.filter(o => o.trim());
        if (validOpts.length < 2) { setError(`Question ${i + 1} needs at least 2 options`); return; }
      }
    }
    setCreating(true);
    try {
      await createPoll({
        title: newTitle.trim(),
        questions: newQuestions.map(q => ({
          title: q.title.trim(),
          type: q.type || 'choice',
          options: q.type === 'text' ? [] : q.options.filter(o => o.trim()).map(o => ({ text: o.trim() })),
          allow_multiple: q.type === 'text' ? false : q.allow_multiple,
        })),
      });
      setShowCreate(false); setNewTitle(''); setNewQuestions([{ title: '', type: 'choice', options: ['', ''], allow_multiple: false }]);
      await fetchPolls();
    } catch { setError('Failed to create poll'); }
    finally { setCreating(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this poll and all votes?')) return;
    try { await deletePoll(id); await fetchPolls(); } catch { setError('Failed to delete'); }
  };

  const handleToggle = async (poll) => {
    const newStatus = poll.status === 'active' ? 'closed' : 'active';
    try { await updatePoll(poll.id, { status: newStatus }); await fetchPolls(); } catch { setError('Failed to update'); }
  };

  const copyLink = (token) => {
    navigator.clipboard.writeText(`${window.location.origin}/poll/${token}`);
    setCopiedId(token); setTimeout(() => setCopiedId(null), 2000);
  };

  const viewResults = async (pollId) => {
    if (expandedPoll === pollId) { setExpandedPoll(null); setPollResults(null); return; }
    setExpandedPoll(pollId); setLoadingResults(true);
    try { const res = await getPollResults(pollId); setPollResults(res.data); }
    catch { setError('Failed to load results'); }
    finally { setLoadingResults(false); }
  };

  // ── Edit helpers ──
  const startEdit = (p) => {
    setEditingPoll(p.id);
    setEditTitle(p.title);
    setEditQuestions((p.questions || []).map(q => ({
      title: q.title || '',
      type: q.type || 'choice',
      options: (q.options || []).map(o => typeof o === 'string' ? o : o.text || ''),
      allow_multiple: q.allow_multiple || false,
    })));
    setExpandedPoll(null); setPollResults(null);
  };
  const cancelEdit = () => { setEditingPoll(null); setEditTitle(''); setEditQuestions([]); };
  const addEditQuestion = (type = 'choice') => setEditQuestions(prev => [...prev, { title: '', type, options: type === 'choice' ? ['', ''] : [], allow_multiple: false }]);
  const removeEditQuestion = (qi) => setEditQuestions(prev => prev.filter((_, i) => i !== qi));
  const updateEditQuestion = (qi, field, val) => setEditQuestions(prev => prev.map((q, i) => i === qi ? { ...q, [field]: val } : q));
  const addEditOption = (qi) => setEditQuestions(prev => prev.map((q, i) => i === qi ? { ...q, options: [...q.options, ''] } : q));
  const updateEditOption = (qi, oi, val) => setEditQuestions(prev => prev.map((q, i) => {
    if (i !== qi) return q;
    const opts = [...q.options]; opts[oi] = val; return { ...q, options: opts };
  }));
  const removeEditOption = (qi, oi) => setEditQuestions(prev => prev.map((q, i) => i !== qi ? q : { ...q, options: q.options.filter((_, j) => j !== oi) }));

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) { setError('Poll title is required'); return; }
    for (let i = 0; i < editQuestions.length; i++) {
      const q = editQuestions[i];
      if (!q.title.trim()) { setError(`Question ${i + 1} title is required`); return; }
      if (q.type !== 'text' && q.options.filter(o => o.trim()).length < 2) { setError(`Question ${i + 1} needs at least 2 options`); return; }
    }
    setSavingEdit(true);
    try {
      await updatePoll(editingPoll, {
        title: editTitle.trim(),
        questions: editQuestions.map(q => ({
          title: q.title.trim(),
          type: q.type || 'choice',
          options: q.type === 'text' ? [] : q.options.filter(o => o.trim()).map(o => ({ text: o.trim() })),
          allow_multiple: q.type === 'text' ? false : q.allow_multiple,
        })),
      });
      setEditingPoll(null);
      await fetchPolls();
    } catch { setError('Failed to save poll'); }
    finally { setSavingEdit(false); }
  };

  const exportCSV = () => {
    if (!pollResults) return;
    const qs = pollResults.questions || [];
    const headers = ['#', 'Voter Name', 'Email', ...qs.map((q, i) => `Q${i + 1}: ${q.title}`), 'Voted At'];
    const rows = (pollResults.votes || []).map((v, i) => {
      const answers = v.answers || {};
      return [
        i + 1, v.voter_name || '', v.voter_email || '',
        ...qs.map((q, qi) => {
          const sel = answers[qi] || answers[String(qi)] || [];
          const selList = Array.isArray(sel) ? sel : [sel];
          const opts = (q.options || []).map(o => typeof o === 'string' ? o : o.text);
          return selList.map(idx => opts[idx] || '').join('; ');
        }),
        new Date(v.created_at).toLocaleString(),
      ];
    });
    const csv = [headers.map(h => `"${h}"`).join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    // UTF-8 BOM so Excel renders all scripts (Hindi, Arabic, CJK, emoji…) correctly.
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `poll_${pollResults.title || 'results'}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // Above the early return: a hook skipped on the loading render and called on
  // the next one throws "rendered more hooks than during the previous render".
  const stats = useEngagementStats(polls, { countKey: 'vote_count' });

  if (loading) return <div className="page container"><div className="loading-container"><div className="spinner"></div><p>Loading polls...</p></div></div>;

  const totalVotes = polls.reduce((s, p) => s + (p.vote_count || 0), 0);
  // 'draft' sat between Active and Closed and was reported by neither.
  const draftPolls = polls.filter(p => (p.status || 'draft') === 'draft').length;


  const q = search.trim().toLowerCase();
  const visible = polls
    .filter(p => (!q || (p.title || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)))
    .filter(p => (!statusFilter || (p.status || 'draft') === statusFilter))
    .sort((a, b) => {
      switch (sortBy) {
        case 'votes': return (b.vote_count || 0) - (a.vote_count || 0);
        case 'title': return (a.title || '').localeCompare(b.title || '');
        case 'oldest': return new Date(a.created_at) - new Date(b.created_at);
        default: return new Date(b.created_at) - new Date(a.created_at);
      }
    });

  const filtersActive = Boolean(q || statusFilter);
  const clearFilters = () => { setSearch(''); setStatusFilter(''); };

  const exportCsv = () => downloadCsv(
    `polls-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Title', 'Status', 'Questions', 'Votes', 'Created'],
    visible.map(p => [
      p.title, p.status, (p.questions || []).length, p.vote_count || 0,
      p.created_at ? new Date(p.created_at).toLocaleDateString() : '',
    ]),
  );

  return (
    <div className="page container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1 className="sr-only">Polling</h1><p style={{ color: 'var(--color-text-secondary)' }}>Create polls, share links, and collect votes</p></div>
        <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}><Plus size={16} /> Create Poll</button>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center' }}>
          <AlertCircle size={16} /> <span style={{ flex: 1, marginLeft: 8 }}>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><XCircle size={16} /></button>
        </div>
      )}

      {/* ══ Create Poll Form ══ */}
      {showCreate && (
        <div className="card" style={{ marginBottom: 24, overflow: 'hidden' }}>
          <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--color-border-light)', background: 'var(--color-primary-bg)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <BarChart3 size={16} style={{ color: 'var(--color-primary)' }} />
            <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-primary)', fontWeight: 600 }}>New Poll</h4>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Poll Title *</label>
              <input className="form-control" placeholder="e.g. Weekly Team Feedback" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
            </div>

            {/* Questions */}
            {newQuestions.map((q, qi) => (
              <div key={qi} style={{ padding: '14px 16px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-light)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-primary)' }}>Question {qi + 1}</span>
                    <select value={q.type || 'choice'} onChange={e => {
                      updateNewQuestion(qi, 'type', e.target.value);
                      if (e.target.value === 'text') updateNewQuestion(qi, 'options', []);
                      else if (q.options.length < 2) updateNewQuestion(qi, 'options', ['', '']);
                    }} style={{ fontSize: '0.78rem', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer' }}>
                      <option value="choice">Choice</option>
                      <option value="text">Text Field</option>
                    </select>
                  </div>
                  {newQuestions.length > 1 && (
                    <button onClick={() => removeNewQuestion(qi)} type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Trash2 size={12} /> Remove
                    </button>
                  )}
                </div>
                <input className="form-control" placeholder={q.type === 'text' ? 'Question (e.g., Any comments?)' : 'Question title *'} value={q.title}
                  onChange={e => updateNewQuestion(qi, 'title', e.target.value)} style={{ marginBottom: 10 }} />

                {(q.type || 'choice') === 'choice' && (
                  <>
                    <label style={{ display: 'block', marginBottom: 6, fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>Options (min 2)</label>
                    {q.options.map((opt, oi) => (
                      <div key={oi} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', minWidth: 16, textAlign: 'center' }}>{String.fromCharCode(65 + oi)}</span>
                        <input className="form-control" placeholder={`Option ${oi + 1}`} value={opt}
                          onChange={e => updateNewOption(qi, oi, e.target.value)} style={{ flex: 1 }} />
                        {q.options.length > 2 && (
                          <button onClick={() => removeNewOption(qi, oi)} type="button"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)' }}><Trash2 size={13} /></button>
                        )}
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => addNewOption(qi)} type="button" style={{ fontSize: '0.78rem' }}>
                        <Plus size={12} /> Add Option
                      </button>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8rem', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
                        <input type="checkbox" checked={q.allow_multiple} onChange={e => updateNewQuestion(qi, 'allow_multiple', e.target.checked)} />
                        Allow multiple selections
                      </label>
                    </div>
                  </>
                )}
                {q.type === 'text' && (
                  <div style={{ padding: '8px 12px', background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--color-border)', color: 'var(--color-text-light)', fontSize: '0.82rem' }}>
                    Respondents will see a text input field
                  </div>
                )}
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-start' }}>
              <button className="btn btn-sm btn-secondary" onClick={() => addNewQuestion('choice')} type="button">
                <Plus size={13} /> Add Choice Question
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => addNewQuestion('text')} type="button">
                <Plus size={13} /> Add Text Question
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
                {creating ? <Loader size={14} className="spinning" /> : <><Plus size={14} /> Create Poll</>}
              </button>
              <button className="btn btn-ghost" onClick={() => { setShowCreate(false); setNewTitle(''); setNewQuestions([{ title: '', type: 'choice', options: ['', ''], allow_multiple: false }]); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="stats-row" style={{ marginBottom: 28 }}>
        <div className="stat-card"><div className="stat-icon primary"><BarChart3 size={20} /></div><div className="stat-label">Total Polls</div><div className="stat-value">{polls.length}</div></div>
        <div className="stat-card"><div className="stat-icon success"><CheckCircle size={20} /></div><div className="stat-label">Active</div><div className="stat-value">{polls.filter(p => p.status === 'active').length}</div></div>
        <div className="stat-card"><div className="stat-icon warning"><Clock size={20} /></div><div className="stat-label">Closed</div><div className="stat-value">{polls.filter(p => p.status === 'closed').length}</div></div>
        <div className="stat-card"><div className="stat-icon info"><Users size={20} /></div><div className="stat-label">Total Votes</div><div className="stat-value">{totalVotes}</div><div className="stat-sub">avg {stats.avgPerItem} per poll</div></div>
        <div className="stat-card"><div className="stat-icon primary"><Edit3 size={20} /></div><div className="stat-label">Drafts</div><div className="stat-value">{draftPolls}</div><div className="stat-sub">not launched yet</div></div>
      </div>

      <StatusMix stats={stats} noun="polls" statusFilter={statusFilter} onStatusFilter={setStatusFilter} />
      <EngagementCards stats={stats} unit="votes" onOpen={(p) => viewResults(p.id)} />
      <GapChips stats={stats} onPick={(g) => setStatusFilter(g.key === 'draft' ? 'draft' : 'active')} />

      {polls.length > 0 && (
        <FilterBar
          search={search} onSearch={setSearch}
          statusFilter={statusFilter} onStatusFilter={setStatusFilter} statusRows={stats.statusRows}
          sortBy={sortBy} onSort={setSortBy}
          sortOptions={[
            { value: 'recent', label: 'Newest first' },
            { value: 'oldest', label: 'Oldest first' },
            { value: 'votes', label: 'Most votes' },
            { value: 'title', label: 'Title A–Z' },
          ]}
          onExport={exportCsv} exportDisabled={visible.length === 0}
          showing={visible.length} totalCount={polls.length} noun="polls"
          onClear={clearFilters} filtersActive={filtersActive}
        />
      )}

      {/* Polls List */}
      {polls.length === 0 ? (
        <div className="card" style={{ padding: '60px 40px', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--color-primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <BarChart3 size={28} style={{ color: 'var(--color-primary)' }} />
          </div>
          <h3 style={{ marginBottom: 6 }}>No Polls Yet</h3>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: 20 }}>Create your first poll to start collecting votes.</p>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={16} /> Create Your First Poll</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visible.map(p => {
            const qs = p.questions || [];
            const totalQs = qs.length;
            const isExpanded = expandedPoll === p.id;
            const isEditing = editingPoll === p.id;
            return (
              <div key={p.id} className="card" style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: p.status === 'active' ? 'var(--color-success)' : p.status === 'closed' ? 'var(--color-error)' : 'var(--color-text-light)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--color-text)' }}>{p.title}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: '0.78rem', color: 'var(--color-text-light)' }}>
                      <span>{totalQs} question{totalQs !== 1 ? 's' : ''}</span>
                      <span><strong style={{ color: 'var(--color-text-secondary)' }}>{p.vote_count}</strong> votes</span>
                      <span>{new Date(p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button className="btn btn-sm btn-outline" onClick={() => isEditing ? cancelEdit() : startEdit(p)}>
                      <Edit3 size={13} /> {isEditing ? 'Cancel' : 'Edit'}
                    </button>
                    <button className="btn btn-sm btn-outline" onClick={() => viewResults(p.id)}><BarChart3 size={13} /> {isExpanded ? 'Hide' : 'Results'}</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => copyLink(p.token)}>
                      {copiedId === p.token ? <><CheckCircle size={12} style={{ color: 'var(--color-success)' }} /> Copied</> : <><Link2 size={12} /> Link</>}
                    </button>
                    {p.status === 'active' && <button className="btn btn-sm btn-ghost" onClick={() => window.open(`/poll/${p.token}`, '_blank')}><Eye size={13} /></button>}
                    <button className="btn btn-sm btn-ghost" onClick={() => handleToggle(p)}>
                      {p.status === 'active' ? <ToggleRight size={14} style={{ color: 'var(--color-success)' }} /> : <ToggleLeft size={14} />}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => handleDelete(p.id)} style={{ color: 'var(--color-text-light)' }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--color-error)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-light)'}><Trash2 size={13} /></button>
                  </div>
                </div>

                {/* ── Inline Edit Form ── */}
                {isEditing && (
                  <div style={{ borderTop: '1px solid var(--color-border-light)', padding: '16px 20px', background: 'var(--color-bg)' }}>
                    <div className="form-group" style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: '0.82rem', fontWeight: 500 }}>Poll Title</label>
                      <input className="form-control" value={editTitle} onChange={e => setEditTitle(e.target.value)} />
                    </div>

                    {editQuestions.map((q, qi) => (
                      <div key={qi} style={{ padding: '12px 14px', background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-light)', marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-primary)' }}>Q{qi + 1}</span>
                            <select value={q.type || 'choice'} onChange={e => {
                              updateEditQuestion(qi, 'type', e.target.value);
                              if (e.target.value === 'text') updateEditQuestion(qi, 'options', []);
                              else if (q.options.length < 2) updateEditQuestion(qi, 'options', ['', '']);
                            }} style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--color-border)', cursor: 'pointer' }}>
                              <option value="choice">Choice</option>
                              <option value="text">Text</option>
                            </select>
                          </div>
                          {editQuestions.length > 1 && (
                            <button onClick={() => removeEditQuestion(qi)} type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: '0.75rem' }}>
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                        <input className="form-control" placeholder="Question title" value={q.title}
                          onChange={e => updateEditQuestion(qi, 'title', e.target.value)} style={{ marginBottom: 8 }} />
                        {(q.type || 'choice') === 'choice' && (
                          <>
                            {q.options.map((opt, oi) => (
                              <div key={oi} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
                                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-light)', minWidth: 14 }}>{String.fromCharCode(65 + oi)}</span>
                                <input className="form-control" style={{ flex: 1, fontSize: '0.85rem' }} placeholder={`Option ${oi + 1}`} value={opt}
                                  onChange={e => updateEditOption(qi, oi, e.target.value)} />
                                {q.options.length > 2 && (
                                  <button onClick={() => removeEditOption(qi, oi)} type="button"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)' }}><Trash2 size={12} /></button>
                                )}
                              </div>
                            ))}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                              <button className="btn btn-sm btn-ghost" onClick={() => addEditOption(qi)} type="button" style={{ fontSize: '0.75rem' }}><Plus size={11} /> Option</button>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
                                <input type="checkbox" checked={q.allow_multiple} onChange={e => updateEditQuestion(qi, 'allow_multiple', e.target.checked)} /> Multi-select
                              </label>
                            </div>
                          </>
                        )}
                        {q.type === 'text' && (
                          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-light)', padding: '6px 0' }}>Text input field</div>
                        )}
                      </div>
                    ))}

                    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => addEditQuestion('choice')} type="button" style={{ fontSize: '0.78rem' }}><Plus size={12} /> Choice</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => addEditQuestion('text')} type="button" style={{ fontSize: '0.78rem' }}><Plus size={12} /> Text</button>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-primary btn-sm" onClick={handleSaveEdit} disabled={savingEdit}>
                        {savingEdit ? <Loader size={13} className="spinning" /> : <><Save size={13} /> Save Changes</>}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>Cancel</button>
                    </div>
                  </div>
                )}

                {/* Expanded Results */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--color-border-light)', padding: '16px 20px' }}>
                    {loadingResults ? <div style={{ textAlign: 'center', padding: 20 }}><Loader size={20} className="spinning" /></div> : pollResults ? (
                      <>
                        {/* Per-question bar charts */}
                        {(pollResults.questions || []).map((q, qi) => {
                          const isText = q.type === 'text';
                          const opts = (q.options || []).map(o => typeof o === 'string' ? o : o.text);
                          const qTallies = (pollResults.tallies || {})[qi] || (pollResults.tallies || {})[String(qi)] || {};
                          return (
                            <div key={qi} style={{ marginBottom: 20, padding: '12px 14px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-light)' }}>
                              <div style={{ fontSize: '0.88rem', fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ color: 'var(--color-primary)', fontSize: '0.78rem' }}>Q{qi + 1}</span>
                                {q.title}
                                {isText && <span style={{ fontSize: '0.7rem', color: 'var(--color-text-light)', fontWeight: 400 }}>(text)</span>}
                                {!isText && q.allow_multiple && <span style={{ fontSize: '0.7rem', color: 'var(--color-text-light)', fontWeight: 400 }}>(multi)</span>}
                              </div>
                              {isText ? (
                                <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                                  {(pollResults.votes || []).map((v, vi) => {
                                    const ans = (v.answers || {})[qi] || (v.answers || {})[String(qi)];
                                    const text = typeof ans === 'string' ? ans : '';
                                    if (!text) return null;
                                    return (
                                      <div key={vi} style={{ padding: '6px 10px', marginBottom: 4, background: 'var(--color-surface)', borderRadius: 4, border: '1px solid var(--color-border-light)', fontSize: '0.84rem' }}>
                                        {v.voter_name && <span style={{ fontWeight: 500, color: 'var(--color-text-secondary)', marginRight: 8 }}>{v.voter_name}:</span>}
                                        {text}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                opts.map((o, oi) => {
                                  const votes = qTallies[oi] || qTallies[String(oi)] || 0;
                                  const pct = pollResults.total_votes > 0 ? Math.round((votes / pollResults.total_votes) * 100) : 0;
                                  return (
                                    <div key={oi} style={{ marginBottom: 6 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                                        <span style={{ fontSize: '0.84rem' }}>{o}</span>
                                        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>{votes} ({pct}%)</span>
                                      </div>
                                      <div style={{ height: 6, background: 'var(--color-border-light)', borderRadius: 3, overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-primary)', borderRadius: 3, transition: 'width 0.3s' }} />
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          );
                        })}
                        <div style={{ fontSize: '0.82rem', color: 'var(--color-text-light)', marginBottom: 12 }}>Total: <strong>{pollResults.total_votes}</strong> votes</div>
                        {pollResults.total_votes > 0 && (
                          <button className="btn btn-sm btn-outline" onClick={exportCSV} style={{ marginBottom: 12 }}><FileText size={13} /> Export CSV</button>
                        )}
                        {(pollResults.votes || []).length > 0 && (
                          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                            <table className="table" style={{ fontSize: '0.8rem' }}>
                              <thead><tr><th>#</th><th>Name</th>{(pollResults.questions || []).map((q, i) => <th key={i}>Q{i + 1}</th>)}<th>Date</th><th></th></tr></thead>
                              <tbody>
                                {(pollResults.votes || []).map((v, i) => {
                                  const answers = v.answers || {};
                                  return (
                                    <tr key={v.id}>
                                      <td>{i + 1}</td>
                                      <td>{v.voter_name || <span style={{ color: 'var(--color-text-light)' }}>--</span>}</td>
                                      {(pollResults.questions || []).map((q, qi) => {
                                        const ans = answers[qi] || answers[String(qi)];
                                        if (q.type === 'text') return <td key={qi} style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={typeof ans === 'string' ? ans : ''}>{typeof ans === 'string' ? ans : '--'}</td>;
                                        const sel = ans || [];
                                        const selList = Array.isArray(sel) ? sel : [sel];
                                        const opts = (q.options || []).map(o => typeof o === 'string' ? o : o.text);
                                        return <td key={qi}>{selList.map(idx => opts[idx]).join(', ') || '--'}</td>;
                                      })}
                                      <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-light)' }}>{new Date(v.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                                      <td><button className="btn btn-sm btn-ghost" onClick={async () => { await deletePollVote(p.id, v.id); viewResults(p.id); await fetchPolls(); }}
                                        style={{ color: 'var(--color-text-light)', padding: 2 }}
                                        onMouseEnter={e => e.currentTarget.style.color = 'var(--color-error)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-light)'}><Trash2 size={12} /></button></td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
