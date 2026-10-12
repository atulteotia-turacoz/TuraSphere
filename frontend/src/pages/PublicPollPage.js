import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle, Loader, BarChart3 } from 'lucide-react';
import 'react-quill-new/dist/quill.snow.css';
import { getPublicPoll, submitPollVote } from '../services/api';
import ThemeToggle from '../components/common/ThemeToggle';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const BACKEND_URL = API_BASE.replace('/api/v1', '');
const resolveImg = (url) => (!url ? null : url.startsWith('http') ? url : `${BACKEND_URL}${url}`);
const normalizeOpt = (o) => (typeof o === 'string' ? { text: o, image: '' } : { text: o?.text || '', image: o?.image || '' });

export default function PublicPollPage() {
  const { token } = useParams();
  const [poll, setPoll] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [answers, setAnswers] = useState({}); // {questionIndex: [optionIndices]}
  const [voterName, setVoterName] = useState('');
  const [voterEmail, setVoterEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [voted, setVoted] = useState(false);
  const [tallies, setTallies] = useState({});
  const [totalVotes, setTotalVotes] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await getPublicPoll(token);
        setPoll(res.data);
        if (res.data.tallies) { setTallies(res.data.tallies); setTotalVotes(res.data.total_votes || 0); }
      } catch (err) {
        const st = err.response?.status;
        if (st === 404) setPageError('This poll does not exist.');
        else if (st === 410) setPageError('This poll is no longer accepting votes.');
        else setPageError('Failed to load poll.');
      } finally { setLoading(false); }
    }
    load();
  }, [token]);

  const toggleOption = (qi, oi, allowMultiple) => {
    setAnswers(prev => {
      const current = prev[qi] || [];
      if (allowMultiple) {
        return { ...prev, [qi]: current.includes(oi) ? current.filter(i => i !== oi) : [...current, oi] };
      }
      return { ...prev, [qi]: [oi] };
    });
  };

  const handleVote = async () => {
    setError('');
    const questions = poll.questions || [];
    // Validate at least one answer
    const hasAnswer = Object.values(answers).some(a => Array.isArray(a) ? a.length > 0 : (a || '').trim());
    if (!hasAnswer) { setError('Please answer at least one question'); return; }
    if (poll.require_name && !voterName.trim()) { setError('Name is required'); return; }

    setSubmitting(true);
    try {
      const res = await submitPollVote(token, {
        answers,
        voter_name: voterName.trim() || null,
        voter_email: voterEmail.trim() || null,
      });
      setVoted(true);
      setTallies(res.data.tallies || {});
      setTotalVotes(res.data.total_votes || 0);
    } catch (err) {
      setError(err.response?.data?.detail || 'Vote failed');
    } finally { setSubmitting(false); }
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
      <div style={{ textAlign: 'center' }}><Loader size={32} className="spinning" style={{ color: 'var(--color-primary)' }} /><p style={{ marginTop: 12, color: 'var(--color-text-secondary)' }}>Loading poll...</p></div>
    </div>
  );

  if (pageError) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}><AlertCircle size={48} style={{ color: 'var(--color-error)', marginBottom: 16 }} /><h2>Poll Unavailable</h2><p style={{ color: 'var(--color-text-secondary)' }}>{pageError}</p></div>
    </div>
  );

  const questions = poll.questions || [];
  const coverImg = resolveImg(poll.cover_image);
  const showResults = voted || (poll.show_results && totalVotes > 0);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '40px 16px' }}>
      <ThemeToggle className="theme-toggle-floating" />
      <div style={{ maxWidth: 750, margin: '0 auto' }}>
        {/* Header */}
        <div className="card" style={{ marginBottom: 24, padding: '32px 28px', overflow: 'hidden' }}>
          {coverImg && (
            <div style={{ margin: '-32px -28px 20px', overflow: 'hidden' }}>
              <img src={coverImg} alt="" style={{ width: '100%', maxHeight: 280, objectFit: 'cover' }} />
            </div>
          )}
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>{poll.title}</h1>
          {poll.description && (
            <div className="ql-editor" style={{ color: 'var(--color-text-secondary)', margin: 0, padding: 0, textAlign: 'left' }}
              dangerouslySetInnerHTML={{ __html: poll.description }} />
          )}
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}><AlertCircle size={16} /> {error}</div>}

        {voted && (
          <div style={{ textAlign: 'center', marginBottom: 20, padding: 16, background: 'var(--color-success-bg)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <CheckCircle size={20} style={{ color: 'var(--color-success-text)' }} />
            <span style={{ color: 'var(--color-success-text)', fontWeight: 600 }}>Your vote has been recorded!</span>
          </div>
        )}

        {/* Questions */}
        {questions.map((q, qi) => {
          const isText = q.type === 'text';
          const opts = (q.options || []).map(normalizeOpt);
          const selected = answers[qi] || [];
          const allowMultiple = q.allow_multiple;
          const qTallies = tallies[qi] || tallies[String(qi)] || {};

          return (
            <div key={qi} className="card" style={{ marginBottom: 16, padding: '24px 28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-primary)', background: 'var(--color-primary-bg)', padding: '2px 8px', borderRadius: 999 }}>Q{qi + 1}</span>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>{q.title}</h3>
              </div>

              {/* Text question */}
              {isText && !voted && (
                <textarea className="form-control" rows={3} placeholder="Type your answer..."
                  value={typeof answers[qi] === 'string' ? answers[qi] : ''}
                  onChange={e => setAnswers(prev => ({ ...prev, [qi]: e.target.value }))} />
              )}
              {isText && voted && typeof answers[qi] === 'string' && (
                <div style={{ padding: '10px 14px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-light)', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
                  {answers[qi]}
                </div>
              )}

              {/* Choice question */}
              {!isText && allowMultiple && (
                <p style={{ fontSize: '0.78rem', color: 'var(--color-primary)', margin: '0 0 10px' }}>Select all that apply</p>
              )}

              {!isText && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {opts.map((opt, oi) => {
                  const isSelected = selected.includes(oi);
                  const votes = qTallies[oi] || qTallies[String(oi)] || 0;
                  const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
                  const optImg = resolveImg(opt.image);

                  return (
                    <div key={oi} onClick={() => !voted && toggleOption(qi, oi, allowMultiple)}
                      style={{
                        position: 'relative', overflow: 'hidden', padding: '12px 16px', borderRadius: 'var(--radius)',
                        cursor: voted ? 'default' : 'pointer',
                        border: '2px solid', borderColor: isSelected ? 'var(--color-primary)' : 'var(--color-border)',
                        background: isSelected ? 'var(--color-primary-bg)' : 'var(--color-surface)', transition: 'all 0.15s',
                      }}>
                      {showResults && (
                        <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${pct}%`,
                          background: isSelected ? 'rgba(79,70,229,0.08)' : 'rgba(0,0,0,0.02)', transition: 'width 0.5s', zIndex: 0 }} />
                      )}
                      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 20, height: 20, borderRadius: allowMultiple ? 4 : '50%', flexShrink: 0,
                          border: '2px solid', borderColor: isSelected ? 'var(--color-primary)' : 'var(--color-border-strong)',
                          background: isSelected ? 'var(--color-primary)' : 'var(--color-surface)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {isSelected && <CheckCircle size={12} style={{ color: 'var(--color-text-inverse)' }} />}
                        </div>
                        {optImg && <img src={optImg} alt="" style={{ height: 36, width: 36, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />}
                        <span style={{ flex: 1, fontSize: '0.92rem', fontWeight: isSelected ? 600 : 400 }}>{opt.text}</span>
                        {showResults && (
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: isSelected ? 'var(--color-primary)' : 'var(--color-text)' }}>{pct}%</span>
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-light)' }}>{votes}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>}
            </div>
          );
        })}

        {/* Voter info + Submit */}
        {!voted && (
          <div className="card" style={{ padding: '20px 24px', marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 14 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                  Name {poll.require_name && <span style={{ color: 'var(--color-error)' }}>*</span>}
                </label>
                <input className="form-control" value={voterName} onChange={e => setVoterName(e.target.value)} placeholder="Your name" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>Email (optional)</label>
                <input className="form-control" type="email" value={voterEmail} onChange={e => setVoterEmail(e.target.value)} placeholder="email@example.com" />
              </div>
            </div>
            <button className="btn btn-primary btn-lg btn-block" onClick={handleVote}
              disabled={submitting || Object.values(answers).every(a => Array.isArray(a) ? a.length === 0 : !(a || '').trim())}
              style={{ width: '100%' }}>
              {submitting ? <><Loader size={18} className="spinning" /> Voting...</> : <><BarChart3 size={18} /> Submit Vote</>}
            </button>
          </div>
        )}

        {showResults && (
          <div style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            Total: <strong>{totalVotes}</strong> vote{totalVotes !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}
