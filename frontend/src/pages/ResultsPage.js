import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import {
  AlertCircle, ArrowLeft, Download, FileText, ChevronDown, ChevronUp, Home,
  Cpu, Database, FlaskConical, BookOpen, ExternalLink, CheckCircle, ShieldCheck, ShieldAlert,
  Stethoscope, Globe, GraduationCap, UserCheck, Pencil, Save, X, RefreshCw,
} from 'lucide-react';
import { getAssessment, getHCP, exportCSV, getAudit, getParameterScores, overrideParameterScore, approveAssessment } from '../services/api';

const BAR_COLORS = [
  'var(--color-primary)', 'var(--color-violet)', 'var(--color-info)', 'var(--color-accent)', 'var(--color-success)',
  'var(--color-warning)', 'var(--color-error)', 'var(--color-pink)', 'var(--color-primary)', 'var(--color-accent)',
  'var(--color-warning)', 'var(--color-violet)', 'var(--color-accent)', 'var(--color-success)', 'var(--color-error)',
];

const SOURCE_LABELS = {
  cv: { label: 'CV / Internet', icon: Cpu, color: 'var(--color-primary)' },
  pubmed: { label: 'PubMed', icon: Database, color: 'var(--color-success)' },
  clinical_trials: { label: 'ClinicalTrials.gov', icon: FlaskConical, color: 'var(--color-warning)' },
  google_scholar: { label: 'Google Scholar', icon: BookOpen, color: 'var(--color-violet)' },
  practo: { label: 'Practo', icon: Stethoscope, color: 'var(--color-pink)' },
  researchgate: { label: 'Researchgate', icon: Globe, color: '#00D0AF' },
  scopus: { label: 'Scopus', icon: GraduationCap, color: '#E9711C' },
  manual: { label: 'Reviewer', icon: UserCheck, color: 'var(--color-warning)' },
  rules: { label: 'Rule engine', icon: ShieldCheck, color: 'var(--color-primary)' },
};

// The rule engine writes this when a criterion is a judgement call it cannot
// make. Those rows are the reviewer's queue, so they are called out.
const NEEDS_REVIEW = 'needs manual review';
const needsReview = (ps) =>
  (ps.scoring_source || '') !== 'manual' &&
  (ps.justification || '').toLowerCase().includes(NEEDS_REVIEW);

// Raw action names are what the API stores; these are what a reader should see.
// Server timestamps are UTC (`datetime.utcnow()`), but several endpoints send
// them with no timezone marker — "2026-09-04 11:39:31". Browsers parse that form
// as LOCAL time, which showed the audit trail 5.5 hours behind in IST. Append
// the Z ourselves when it is missing so the value is read as UTC and then
// rendered in the viewer's own timezone.
const fmtServerTime = (value) => {
  if (!value) return '-';
  let text = String(value).trim().replace(' ', 'T');
  const hasZone = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(text);
  if (!hasZone) text += 'Z';
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
};

const AUDIT_ACTIONS = {
  ai_assessment: 'KOL Assessment',
  rule_assessment: 'KOL Assessment (rule engine)',
  parameter_score_override: 'Score set by reviewer',
  // Without these three the trail shows the raw slug, which is exactly the part
  // of the record someone reads to answer "who re-ran this, and when was it
  // approved".
  reassessment: 'Re-assessment',
  assessment_approved: 'Assessment approved',
  hcp_updated: 'Profile edited',
  // Why there is no second record for this HCP: a re-submitted CV (or a form
  // submission) was recognised as someone already on file.
  duplicate_detected: 'Duplicate recognised — existing record re-used',
};

const ALL_SOURCES = ['cv', 'pubmed', 'google_scholar', 'researchgate', 'scopus'];

function SourceBadge({ source }) {
  const info = SOURCE_LABELS[source] || SOURCE_LABELS.cv;
  const Icon = info.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: '0.72rem', padding: '2px 8px', borderRadius: 12,
      background: `${info.color}12`, color: info.color, fontWeight: 500,
      whiteSpace: 'nowrap',
    }}>
      <Icon size={11} /> {info.label}
    </span>
  );
}

function SourceLinks({ source, sourceData, hcpName, hcpInstitution, hcpSpecialty }) {
  const authorName = sourceData?._author_name || hcpName || '';
  const institution = sourceData?._institution || hcpInstitution || '';
  const specialty = sourceData?._specialty || hcpSpecialty || '';
  if (!authorName) return null;

  // Assessments only count the last N years, so the link must land on the same
  // window — an unfiltered search showed a whole career and contradicted the count.
  const PUBMED_WINDOW_YEARS = 5;

  // Build the same PubMed search query the scoring engine used:
  // name[Author] AND institution[Affiliation] AND the date window.
  const buildPubmedUrl = () => {
    const currentYear = new Date().getFullYear();
    const fromYear = currentYear - (PUBMED_WINDOW_YEARS - 1);
    let query = `${authorName}[Author]`;
    if (institution) query += ` AND ${institution}[Affiliation]`;
    query += ` AND ("${fromYear}"[Date - Publication] : "${currentYear}"[Date - Publication])`;
    return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`;
  };

  if (source === 'pubmed') {
    const totalPubs = sourceData?.total_publications || 0;
    const pubs5yr = sourceData?.publications_last_5_years || 0;
    const articles = sourceData?.recent_articles || [];
    const pubmedUrl = buildPubmedUrl();
    const searchDesc = institution ? `"${authorName}" at "${institution}"` : `"${authorName}"`;

    return (
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-success)', marginBottom: 4 }}>
          <a href={pubmedUrl} target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--color-success)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Database size={11} /> View {totalPubs} publications on PubMed (last {PUBMED_WINDOW_YEARS} yrs) <ExternalLink size={9} />
          </a>
          {pubs5yr > 0 && <span style={{ color: 'var(--color-text-light)', fontWeight: 400, marginLeft: 6 }}>({pubs5yr} in last {PUBMED_WINDOW_YEARS} yrs)</span>}
        </div>
        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-light)', marginBottom: 4 }}>
          Search: {searchDesc}
        </div>
        {articles.length > 0 && (
          <div style={{ maxHeight: '150px', overflowY: 'auto', paddingRight: 4 }}>
            {articles.slice(0, 10).map((article, i) => (
              <div key={i} style={{ fontSize: '0.75rem', marginBottom: 4, lineHeight: 1.3, paddingLeft: 8, borderLeft: '2px solid var(--color-success-bg)' }}>
                {article.url ? (
                  <a href={article.url} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--color-success)', textDecoration: 'none', fontWeight: 500 }}>
                    {article.title || 'Untitled'} <ExternalLink size={9} style={{ display: 'inline' }} />
                  </a>
                ) : (
                  <span style={{ fontWeight: 500 }}>{article.title || 'Untitled'}</span>
                )}
                <div style={{ color: 'var(--color-text-light)', fontSize: '0.68rem' }}>
                  {article.journal}{article.year ? ` (${article.year})` : ''}
                  {article.doi && (
                    <> &middot; <a href={`https://doi.org/${article.doi}`} target="_blank" rel="noopener noreferrer"
                      style={{ color: 'var(--color-text-secondary)' }}>DOI <ExternalLink size={8} /></a></>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (source === 'clinical_trials') {
    const trialsLed = sourceData?.trials_led || 0;
    const totalFound = sourceData?.total_trials_found || 0;
    const ctSearchUrl = `https://clinicaltrials.gov/search?term=${encodeURIComponent(authorName + (institution ? ' ' + institution : ''))}`;
    return (
      <div style={{ marginTop: 6, fontSize: '0.72rem' }}>
        <a href={ctSearchUrl} target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--color-warning)', textDecoration: 'none', fontWeight: 500 }}>
          <FlaskConical size={10} /> View on ClinicalTrials.gov <ExternalLink size={9} />
        </a>
        <span style={{ color: 'var(--color-text-light)', marginLeft: 6 }}>({trialsLed} led, {totalFound} total found)</span>
      </div>
    );
  }

  if (source === 'google_scholar') {
    const scholarQuery = specialty ? `${authorName} ${specialty} guideline` : authorName;
    const scholarSearchUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(scholarQuery)}`;
    return (
      <div style={{ marginTop: 6, fontSize: '0.72rem' }}>
        <a href={scholarSearchUrl} target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--color-violet)', textDecoration: 'none', fontWeight: 500 }}>
          <BookOpen size={10} /> View on Google Scholar <ExternalLink size={9} />
        </a>
        <span style={{ color: 'var(--color-text-light)', marginLeft: 6 }}>({sourceData?.results_count || 0} results)</span>
      </div>
    );
  }

  if (source === 'practo') {
    const profileUrl = sourceData?.profile_url;
    const rating = sourceData?.rating || 0;
    const reviews = sourceData?.reviews_count || 0;
    const experience = sourceData?.experience_years || 0;
    const hospital = sourceData?.hospital || '';
    const practoName = sourceData?.name || authorName;

    if (!sourceData?.profile_found) {
      return (
        <div style={{ marginTop: 6, fontSize: '0.72rem', color: 'var(--color-text-light)' }}>
          <Stethoscope size={10} /> No Practo profile found for "{authorName}"
        </div>
      );
    }

    return (
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-pink)', marginBottom: 4 }}>
          {profileUrl ? (
            <a href={profileUrl} target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--color-pink)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Stethoscope size={11} /> View {practoName} on Practo <ExternalLink size={9} />
            </a>
          ) : (
            <span><Stethoscope size={11} /> Practo Profile</span>
          )}
        </div>
        <div style={{ fontSize: '0.68rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
          {rating > 0 && <span>Rating: <strong>{rating}%</strong> &middot; </span>}
          {reviews > 0 && <span>{reviews} reviews &middot; </span>}
          {experience > 0 && <span>{experience} yrs exp &middot; </span>}
          {hospital && <span>{hospital}</span>}
        </div>
      </div>
    );
  }

  return null;
}

function getTierBadgeClass(tier) {
  if (!tier) return 'badge-non-kol';
  const cls = tier.toLowerCase().replace(/[\s-]/g, '_');
  const map = {
    global_kol: 'badge-global',
    strategic_kol: 'badge-strategic',
    national_kol: 'badge-national',
    emerging_kol: 'badge-emerging',
    local_kol: 'badge-local',
    non_kol: 'badge-non-kol',
  };
  return map[cls] || 'badge-non-kol';
}

export default function ResultsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [assessment, setAssessment] = useState(null);
  const [hcp, setHcp] = useState(null);
  const [paramScores, setParamScores] = useState(null);
  const [audit, setAudit] = useState(null);
  const [showAudit, setShowAudit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [approving, setApproving] = useState(false);
  // Inline per-parameter editing. `editing` holds the row id being edited so
  // only one is open at a time.
  const [editing, setEditing] = useState(null);
  const [editScore, setEditScore] = useState('');
  const [editWhy, setEditWhy] = useState('');
  const [savingScore, setSavingScore] = useState(false);
  const [scoreError, setScoreError] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        const [assessRes, hcpRes] = await Promise.all([
          getAssessment(id),
          getHCP(id),
        ]);
        setAssessment(assessRes.data);
        setHcp(hcpRes.data);

        // Try to load per-parameter scores
        try {
          const psRes = await getParameterScores(id);
          setParamScores(psRes.data);
        } catch {
          // May not have parameter scores (old assessments)
        }
      } catch (err) {
        setError('Failed to load assessment results.');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id]);

  const startEdit = (ps) => {
    setScoreError('');
    setEditing(ps.id);
    setEditScore(String(ps.score ?? ''));
    // A "needs manual review" placeholder is not a justification worth keeping;
    // anything a person or a source actually wrote is.
    setEditWhy(needsReview(ps) ? '' : (ps.justification || ''));
  };

  const cancelEdit = () => {
    setEditing(null);
    setScoreError('');
  };

  const saveScore = async (ps) => {
    const value = parseFloat(editScore);
    if (Number.isNaN(value) || value < 0 || value > ps.max_score) {
      setScoreError(`Score must be between 0 and ${ps.max_score}.`);
      return;
    }
    setSavingScore(true);
    setScoreError('');
    try {
      const res = await overrideParameterScore(ps.id, value, editWhy.trim());
      const saved = res.data;
      // The server re-totals and re-tiers, so take both from its response
      // rather than re-adding the rows here and risking a different answer.
      setParamScores((prev) => ({
        ...prev,
        final_score: saved.assessment_total,
        tier: saved.tier,
        parameter_scores: prev.parameter_scores.map((row) =>
          row.id === ps.id
            ? { ...row, score: saved.score, justification: saved.justification,
                scoring_source: 'manual', is_verified: true }
            : row
        ),
      }));
      setAssessment((prev) => (prev
        ? { ...prev, final_score: saved.assessment_total, tier: saved.tier }
        : prev));
      setEditing(null);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setScoreError(typeof detail === 'string' ? detail : 'Could not save this score. Please try again.');
    } finally {
      setSavingScore(false);
    }
  };

  const handleExport = async () => {
    try {
      const res = await exportCSV(id);
      const blob = new Blob([res.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kol_assessment_${id}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Failed to export CSV.');
    }
  };

  // Refetch, unconditionally. handleAudit caches, which is right for a toggle
  // but wrong after an approval adds a new entry to a trail already on screen.
  const loadAudit = async () => {
    try {
      const res = await getAudit(id);
      setAudit(res.data);
    } catch { /* the trail simply keeps what it had */ }
  };

  const handleAudit = async () => {
    if (audit) {
      setShowAudit(!showAudit);
      return;
    }
    try {
      const res = await getAudit(id);
      setAudit(res.data);
      setShowAudit(true);
    } catch {
      alert('Failed to load audit trail.');
    }
  };

  // Renders the whole assessment as a print-ready A4 page in a new tab and fires
  // the browser's print dialog — "Save as PDF" from there. No PDF lib needed.
  const handleDownloadPDF = () => {
    if (!paramScores?.parameter_scores) return;

    const groups = {};
    paramScores.parameter_scores.forEach((ps) => {
      const cat = ps.parameter_category || 'Uncategorized';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(ps);
    });

    let grandMax = 0;
    let grandScore = 0;
    paramScores.parameter_scores.forEach((ps) => {
      grandScore += ps.score || 0;
      grandMax += ps.max_score || 0;
    });

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const tier = (assessment?.tier || '').replace(/_/g, ' ');
    const finalScore = (assessment?.final_score ?? grandScore).toFixed(1);
    const allVerified = paramScores.parameter_scores.every((ps) => ps.is_verified);

    let categoryHtml = '';
    Object.entries(groups).forEach(([category, scores]) => {
      const catScore = scores.reduce((s, p) => s + (p.score || 0), 0);
      const catMax = scores.reduce((s, p) => s + (p.max_score || 0), 0);
      categoryHtml += `
        <tr class="cat-row"><td colspan="4"><strong>${esc(category)}</strong> — ${catScore.toFixed(1)} / ${catMax}</td></tr>
        ${scores.map((ps) => `
          <tr class="${(ps.score || 0) > 0 ? 'scored' : ''}">
            <td>${esc(ps.parameter_name)} <div class="code">${esc(ps.parameter_code || '')}</div></td>
            <td class="num">${ps.score.toFixed(1)} / ${ps.max_score}</td>
            <td>${esc(ps.scoring_source || '')}</td>
            <td>${esc(ps.justification || '')}</td>
          </tr>
        `).join('')}
      `;
    });

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>KOL Assessment — ${esc(hcp?.full_name || 'HCP')}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: -apple-system, Arial, sans-serif; color: var(--color-text); font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 20px 0 8px; border-bottom: 2px solid var(--color-primary); padding-bottom: 4px; }
  .meta { color: var(--color-text-secondary); margin-bottom: 12px; }
  .summary { display: flex; gap: 14px; margin: 14px 0 20px; flex-wrap: wrap; }
  .summary-item { border: 1px solid var(--color-border); padding: 8px 14px; border-radius: 8px; }
  .summary-item .label { font-size: 10px; color: var(--color-text-secondary); text-transform: uppercase; }
  .summary-item .value { font-size: 16px; font-weight: 700; color: var(--color-primary); }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border: 1px solid var(--color-border); padding: 6px 8px; text-align: left; vertical-align: top; font-size: 11px; }
  th { background: var(--color-bg); font-weight: 600; }
  .cat-row td { background: var(--color-primary-bg); color: var(--color-primary-dark); }
  tr.scored td { background: var(--color-success-bg); }
  tr.scored td:first-child { border-left: 3px solid var(--color-success); }
  @media print { tr.scored td { background: var(--color-success-bg) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } .cat-row td { background: var(--color-primary-bg) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  .num { text-align: right; font-weight: 600; white-space: nowrap; }
  .code { font-size: 9px; color: var(--color-text-light); }
  .status { display: inline-block; padding: 3px 10px; border-radius: 10px; font-weight: 600; font-size: 11px; }
  .status.approved { background: var(--color-success-bg); color: var(--color-success); }
  .status.notverified { background: var(--color-warning-bg); color: var(--color-warning-text); }
</style></head><body>
  <h1>KOL Assessment Results</h1>
  <div class="meta">
    <strong>${esc(hcp?.full_name || '')}</strong>${hcp?.specialty ? ' — ' + esc(hcp.specialty) : ''}${hcp?.institution ? ' | ' + esc(hcp.institution) : ''}
  </div>
  <div class="summary">
    <div class="summary-item"><div class="label">Final Score</div><div class="value">${finalScore} / ${grandMax}</div></div>
    <div class="summary-item"><div class="label">Tier</div><div class="value">${esc(tier || 'N/A')}</div></div>
    <div class="summary-item"><div class="label">Parameters</div><div class="value">${paramScores.parameter_scores.length}</div></div>
    <div class="summary-item"><div class="label">Status</div><div class="value"><span class="status ${allVerified ? 'approved' : 'notverified'}">${allVerified ? 'Approved' : 'Not Approved'}</span></div></div>
  </div>

  <h2>Detailed Parameter Scores</h2>
  <table>
    <thead><tr><th>Parameter</th><th class="num">Score</th><th>Source</th><th>Justification</th></tr></thead>
    <tbody>${categoryHtml}</tbody>
  </table>

  ${assessment?.justification ? `<h2>Summary</h2><p>${esc(assessment.justification)}</p>` : ''}

  <script>window.onload = () => { setTimeout(() => { window.print(); }, 300); };<\u002Fscript>
</body></html>`;

    const win = window.open('', '_blank');
    if (!win) { alert('Please allow pop-ups to download PDF.'); return; }
    win.document.write(html);
    win.document.close();
  };

  // Approving the assessment = verifying every parameter score in one go. The
  // per-row verify controls are gone, so this is the only way to verify now.
  const handleApproveAll = async () => {
    if (!paramScores?.parameter_scores) return;
    const unverified = paramScores.parameter_scores.filter((ps) => !ps.is_verified);
    if (unverified.length === 0) return;
    setApproving(true);
    try {
      // One call rather than one per parameter: it is a single round trip and,
      // unlike `verify`, it writes an audit entry recording who approved and when.
      const assessmentId = paramScores.assessment_id || assessment?.assessment_id || assessment?.id;
      await approveAssessment(assessmentId);
      const stamp = new Date().toISOString();
      setParamScores((prev) => prev && ({
        ...prev,
        parameter_scores: prev.parameter_scores.map((ps) =>
          ps.is_verified ? ps : { ...ps, is_verified: true, verified_at: stamp }
        ),
      }));
      if (showAudit) loadAudit();   // the new approval entry belongs in an open trail
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to approve assessment.');
    } finally {
      setApproving(false);
    }
  };

  if (loading) {
    return (
      <div className="page container">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading results...</p>
        </div>
      </div>
    );
  }

  if (error || !assessment) {
    return (
      <div className="page container">
        <div className="alert alert-error"><AlertCircle size={18} /> {error || 'No assessment found.'}</div>
        <Link to="/assessments" className="btn btn-secondary"><ArrowLeft size={16} /> Back to Assessments</Link>
      </div>
    );
  }

  const tierLabel = assessment.tier ? assessment.tier.replace(/_/g, ' ') : 'N/A';

  // Use parameter scores if available (AI assessment), otherwise fall back to legacy C.1-C.9
  const hasParamScores = paramScores && paramScores.parameter_scores && paramScores.parameter_scores.length > 0;

  // Group parameter scores by category
  // Every CV parameter carries the same source on a zero-AI account, so saying
  // so once above the table beats repeating a badge on 25 rows.
  const ruleScored = hasParamScores
    ? paramScores.parameter_scores.filter((ps) => ps.scoring_source === 'rules').length
    : 0;

  const categoryGroups = {};
  if (hasParamScores) {
    paramScores.parameter_scores.forEach((ps) => {
      if (!categoryGroups[ps.parameter_category]) {
        categoryGroups[ps.parameter_category] = [];
      }
      categoryGroups[ps.parameter_category].push(ps);
    });
  }

  // Chart data from parameter scores
  const chartData = hasParamScores
    ? paramScores.parameter_scores.map((ps) => ({
        name: ps.parameter_code,
        score: ps.score,
        max: ps.max_score,
        fullName: ps.parameter_name,
      }))
    : [];

  // Calculate max possible score
  const maxPossible = hasParamScores
    ? paramScores.parameter_scores.reduce((sum, ps) => sum + ps.max_score, 0)
    : 55;

  return (
    <div className="page container">
      <div style={{ marginBottom: '16px' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/assessments')}>
          <ArrowLeft size={16} /> Back to Assessments
        </button>
      </div>

      {/* Header with Score */}
      <div className="results-header">
        <div className="score-meter">
          <div className="score-meter-circle" style={{ borderColor: 'var(--color-primary-light)' }}>
            <div className="score-meter-value">{assessment.final_score?.toFixed(1) || '0'}</div>
            <div className="score-meter-label">out of {maxPossible}</div>
          </div>
        </div>
        <h2>{hcp?.full_name || 'HCP'}</h2>
        <div style={{ margin: '12px 0' }}>
          <span className={`badge ${getTierBadgeClass(assessment.tier)}`} style={{ fontSize: '1rem', padding: '6px 20px' }}>
            {tierLabel}
          </span>
        </div>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          {hcp?.specialty} {hcp?.institution ? `| ${hcp.institution}` : ''}
        </p>
      </div>

      {/* Score Summary */}
      <div className="score-summary">
        <div className="score-summary-item">
          <div className="score-label">Total Score</div>
          <div className="score-number">{assessment.final_score?.toFixed(1) || '0'}</div>
        </div>
        <div className="score-summary-item">
          <div className="score-label">Max Possible</div>
          <div className="score-number">{maxPossible}</div>
        </div>
        <div className="score-summary-item">
          <div className="score-label">Parameters Scored</div>
          <div className="score-number">{hasParamScores ? paramScores.parameter_scores.length : '—'}</div>
        </div>
        <div className="score-summary-item">
          <div className="score-label">Data Sources</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {ALL_SOURCES.map((src) => {
              const isActive = hasParamScores && paramScores.scoring_meta?.sources_used?.includes(src);
              const info = SOURCE_LABELS[src] || SOURCE_LABELS.cv;
              const Icon = info.icon;
              return (
                <span key={src} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: '0.72rem', padding: '2px 8px', borderRadius: 12,
                  background: isActive ? `${info.color}12` : 'var(--color-surface-raised)',
                  color: isActive ? info.color : 'var(--color-text-light)',
                  fontWeight: 500, whiteSpace: 'nowrap',
                }}>
                  <Icon size={11} /> {info.label}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Parameter Scores Breakdown */}
      {hasParamScores && (
        <div>
          {/* Detailed Scores by Category */}
          <div className="card" style={{ marginBottom: 'var(--spacing-xl)' }}>
            <div className="card-header">
              {/* .card-header is a flex row, so the title and its note are
                  wrapped to keep the note underneath rather than beside it. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <h4>Detailed Parameter Scores</h4>
                {ruleScored > 0 && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: '0.78rem', color: 'var(--color-text-secondary)', fontWeight: 400,
                  }}>
                    <ShieldCheck size={13} style={{ color: 'var(--color-primary)' }} />
                    {ruleScored} {ruleScored === 1 ? 'parameter' : 'parameters'} scored by the rule engine — no AI was used.
                  </span>
                )}
              </div>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {Object.entries(categoryGroups).map(([category, scores]) => {
                return (
                  <div key={category}>
                    <div style={{
                      padding: '10px 16px', background: 'var(--color-bg)',
                      fontWeight: 600, fontSize: '0.85rem', color: 'var(--color-text-secondary)',
                      borderBottom: '1px solid var(--color-border)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <span>{category}</span>
                      <span style={{ fontWeight: 400 }}>
                        {scores.reduce((s, p) => s + p.score, 0).toFixed(1)} / {scores.reduce((s, p) => s + p.max_score, 0)}
                      </span>
                    </div>
                    <table className="table" style={{ marginBottom: 0 }}>
                      <tbody>
                        {scores.map((ps, i) => {
                          // Scored parameters (score > 0) are highlighted green; zero-score rows stay plain.
                          const scored = (ps.score || 0) > 0;
                          const awaiting = needsReview(ps);
                          const rowBg = scored
                            ? 'var(--color-success-bg)'
                            : (awaiting ? 'var(--color-warning-bg, #fff8e6)' : undefined);
                          const isEditing = editing === ps.id;
                          return (
                          <tr key={ps.id || ps.parameter_id} style={{
                            background: rowBg,
                            borderLeft: scored
                              ? '3px solid var(--color-success)'
                              : (awaiting ? '3px solid var(--color-warning)' : undefined),
                          }}>
                            <td style={{ width: '22%', fontWeight: 500, fontSize: '0.85rem', padding: '8px 12px', background: rowBg }}>
                              <div>{ps.parameter_name}</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                                {ALL_SOURCES.includes(ps.scoring_source) ? (
                                  <span style={{ fontSize: '0.7rem', lineHeight: 1.4 }}>
                                    {ALL_SOURCES.map((src, idx) => {
                                      const isActive = ps.scoring_source === src;
                                      const info = SOURCE_LABELS[src] || SOURCE_LABELS.cv;
                                      return (
                                        <span key={src}>
                                          <span style={{ color: isActive ? info.color : 'var(--color-text-light)', fontWeight: isActive ? 600 : 400 }}>
                                            {info.label}
                                          </span>
                                          {idx < ALL_SOURCES.length - 1 && <span style={{ color: 'var(--color-border-strong)' }}> / </span>}
                                        </span>
                                      );
                                    })}
                                  </span>
                                ) : ps.scoring_source === 'manual' ? (
                                  // Unlike the rule engine, this applies to individual rows,
                                  // so it stays on the row it belongs to.
                                  <SourceBadge source="manual" />
                                ) : null}
                              </div>
                            </td>
                            <td style={{ width: '10%', padding: '8px 12px', background: rowBg }}>
                              {isEditing ? (
                                <input
                                  type="number"
                                  className="form-control"
                                  autoFocus
                                  min={0}
                                  max={ps.max_score}
                                  step={0.5}
                                  value={editScore}
                                  onChange={(e) => setEditScore(e.target.value)}
                                  style={{ width: 74, padding: '4px 6px', fontSize: '0.85rem' }}
                                />
                              ) : (
                                <strong>{ps.score.toFixed(1)}</strong>
                              )}
                              <span style={{ color: 'var(--color-text-light)', fontSize: '0.78rem' }}> / {ps.max_score}</span>
                              {!isEditing && (
                                <div className="progress-bar" style={{ width: '70px', marginTop: '3px', height: 5 }}>
                                  <div
                                    className="progress-bar-fill"
                                    style={{
                                      width: `${ps.max_score > 0 ? (ps.score / ps.max_score) * 100 : 0}%`,
                                      background: BAR_COLORS[i % BAR_COLORS.length],
                                    }}
                                  ></div>
                                </div>
                              )}
                            </td>
                            <td style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', padding: '8px 12px', background: rowBg }}>
                              {isEditing ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  <textarea
                                    className="form-control"
                                    rows={2}
                                    placeholder="Why this score? (recorded in the audit trail)"
                                    value={editWhy}
                                    onChange={(e) => setEditWhy(e.target.value)}
                                    style={{ fontSize: '0.82rem' }}
                                  />
                                  {scoreError && (
                                    <span style={{ color: 'var(--color-danger, var(--color-error))', fontSize: '0.76rem' }}>
                                      {scoreError}
                                    </span>
                                  )}
                                  <div style={{ display: 'flex', gap: 8 }}>
                                    <button type="button" className="btn btn-primary btn-sm"
                                      disabled={savingScore} onClick={() => saveScore(ps)}
                                      style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                      <Save size={13} /> {savingScore ? 'Saving...' : 'Save'}
                                    </button>
                                    <button type="button" className="btn btn-secondary btn-sm"
                                      disabled={savingScore} onClick={cancelEdit}
                                      style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                      <X size={13} /> Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div>{ps.justification}</div>
                                  <SourceLinks
                                    source={ps.scoring_source}
                                    sourceData={ps.source_data}
                                    hcpName={hcp?.full_name}
                                    hcpInstitution={hcp?.institution}
                                    hcpSpecialty={hcp?.specialty}
                                  />
                                  <button type="button" onClick={() => startEdit(ps)}
                                    style={{
                                      background: 'none', border: 'none', padding: '4px 0 0',
                                      cursor: 'pointer', color: awaiting ? 'var(--color-warning)' : 'var(--color-primary)',
                                      fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: 4,
                                      fontWeight: awaiting ? 600 : 400,
                                    }}>
                                    <Pencil size={11} /> {awaiting ? 'Score this criterion' : 'Edit score'}
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Justification */}
      {assessment.justification && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-header"><h4>Summary</h4></div>
          <div className="card-body">
            <p style={{ lineHeight: 1.7, color: 'var(--color-text-secondary)' }}>{assessment.justification}</p>
          </div>
        </div>
      )}

      {/* Overall Verification Status + Approve */}
      {hasParamScores && (() => {
        const allVerified = paramScores.parameter_scores.every((ps) => ps.is_verified);
        // Criteria no rule can decide. Approving while these still read "needs
        // manual review" would sign off scores nobody set, so the button waits
        // for them — a deliberate 0 counts as a decision and clears the flag.
        const pending = paramScores.parameter_scores.filter(needsReview);
        const blocked = pending.length > 0;
        return (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, padding: '14px 18px', marginBottom: '16px', flexWrap: 'wrap',
            background: allVerified ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
            border: `1px solid ${allVerified ? 'var(--color-success-bg)' : 'var(--color-warning)'}`,
            borderRadius: 10,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: allVerified ? 'var(--color-success)' : 'var(--color-warning-text)' }}>
                {allVerified ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}
                Status: {allVerified ? 'Approved' : 'Not Approved'}
              </div>
              {blocked && (
                <span style={{ fontSize: '0.8rem', color: 'var(--color-warning-text)' }}>
                  {pending.length} {pending.length === 1 ? 'criterion needs' : 'criteria need'} your score —
                  {' '}highlighted below. Set each one (0 is a valid answer) to finish the assessment.
                </span>
              )}
            </div>
            <button
              className="btn btn-primary"
              onClick={handleApproveAll}
              disabled={approving || allVerified || blocked}
              title={blocked ? 'Score the highlighted criteria first' : undefined}
            >
              <CheckCircle size={16} /> {approving ? 'Approving...' : allVerified ? 'Approved' : 'Approve'}
            </button>
          </div>
        );
      })()}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={handleExport}>
          <Download size={16} /> Download CSV
        </button>
        <button className="btn btn-primary" onClick={handleDownloadPDF}>
          <Download size={16} /> Download PDF
        </button>
        <button className="btn btn-outline" onClick={handleAudit}>
          <FileText size={16} /> {showAudit ? 'Hide' : 'View'} Audit Trail
        </button>
        <Link to={`/hcp/${id}/reassess`} className="btn btn-outline"
              title="Open this HCP's details pre-filled, edit what has changed, and score again">
          <RefreshCw size={16} /> Re-assessment
        </Link>
        <Link to="/assessments" className="btn btn-secondary">
          <Home size={16} /> Back to Assessments
        </Link>
      </div>

      {/* Audit Trail */}
      {showAudit && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <button className="collapsible-trigger" onClick={() => setShowAudit(!showAudit)}>
            Audit Trail
            {showAudit ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          <div className="collapsible-content">
            {audit ? (
              Array.isArray(audit) ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Time Stamp</th>
                      <th>Action</th>
                      <th>User</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((entry, i) => (
                      <tr key={i}>
                        <td>{fmtServerTime(entry.timestamp || entry.created_at)}</td>
                        <td>{AUDIT_ACTIONS[entry.action] || entry.action || '-'}</td>
                        <td>{entry.performed_by_name || entry.user || entry.user_email || '-'}</td>
                        <td style={{ fontSize: '0.85rem' }}>
                          {entry.details ? (typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details)) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <pre style={{ fontSize: '0.85rem', background: 'var(--color-bg)', padding: '16px', borderRadius: '8px', overflow: 'auto' }}>
                  {JSON.stringify(audit, null, 2)}
                </pre>
              )
            ) : (
              <p style={{ color: 'var(--color-text-secondary)' }}>Loading audit data...</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
