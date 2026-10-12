import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { AlertCircle, FileText, Play, Download, ArrowLeft, File, UserPlus, CheckCircle, Loader, ShieldCheck, Upload as UploadIcon, RefreshCw } from 'lucide-react';
import { getHCP, getAssessment, exportCSV, downloadCV, downloadConsent, uploadConsent, addHCPToKOLDatabase, getMe } from '../services/api';

function getTierBadge(tier) {
  if (!tier) return null;
  const cls = tier.toLowerCase().replace(/[\s-]/g, '_');
  const classMap = {
    global_kol: 'badge-global',
    strategic_kol: 'badge-strategic',
    national_kol: 'badge-national',
    emerging_kol: 'badge-emerging',
    local_kol: 'badge-local',
    non_kol: 'badge-non-kol',
  };
  return <span className={`badge ${classMap[cls] || 'badge-non-kol'}`}>{tier.replace(/_/g, ' ')}</span>;
}

function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') return val.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

export default function HCPDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate(); // eslint-disable-line no-unused-vars
  const [hcp, setHcp] = useState(null);
  // "Make KOL Database" writes into the Find KOLs directory, so it is offered
  // only to accounts entitled to that module. Defaults to visible and is hidden
  // once /me answers — the same order AssessmentsListPage uses, so a slow
  // profile call never blocks a permitted user.
  const [canFindKols, setCanFindKols] = useState(true);
  const [assessment, setAssessment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [kolStatus, setKolStatus] = useState(''); // '' | 'saving' | 'added' | 'exists'
  const [kolError, setKolError] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        const hcpRes = await getHCP(id);
        setHcp(hcpRes.data);
        try {
          const assessRes = await getAssessment(id);
          setAssessment(assessRes.data);
        } catch {
          // No assessment yet
        }
      } catch (err) {
        setError('Failed to load HCP profile.');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id]);

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

  const handleAddToKOLDatabase = async () => {
    setKolStatus('saving'); setKolError('');
    try {
      await addHCPToKOLDatabase(id);
      setKolStatus('added');
    } catch (err) {
      // 409 means it's already in the directory — that's a success state, not an error.
      if (err.response?.status === 409) {
        setKolStatus('exists');
      } else {
        setKolStatus('');
        setKolError(err.response?.data?.detail || 'Failed to add to KOL database.');
      }
    }
  };

  // Shared by both attachments. The only differences are which endpoint to
  // call, the fallback filename and the error wording, so they are parameters
  // rather than a second near-identical copy of this function.
  const saveAttachment = async (fetcher, fallbackName, label) => {
    try {
      const res = await fetcher(id);
      const blob = new Blob([res.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // The server sets a readable filename; fall back only if it does not.
      const disposition = res.headers['content-disposition'];
      const match = disposition && disposition.match(/filename="?([^"]+)"?/);
      a.download = match ? match[1] : fallbackName;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert(e.response?.status === 404
        ? `No ${label} is on file for this HCP.`
        : `Failed to download the ${label}.`);
    }
  };

  // Existing HCPs predate the consent field, and the only other upload path is
  // the NEW HCP form — so without this the letter could never be attached to a
  // record that already exists, and the download below would be unreachable.
  const consentRef = useRef(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState('');
  const CONSENT_EXT = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];

  const handleConsentPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dot = file.name.lastIndexOf('.');
    const ext = dot === -1 ? '' : file.name.slice(dot).toLowerCase();
    if (!CONSENT_EXT.includes(ext)) {
      setConsentError(`${ext || 'That file'} is not accepted. Use PDF, DOC, DOCX, JPG or PNG.`);
      e.target.value = '';
      return;
    }
    setConsentBusy(true); setConsentError('');
    try {
      const res = await uploadConsent(id, file);
      setHcp(res.data);          // reflect the new letter without a reload
    } catch (err) {
      setConsentError(err.response?.data?.detail || 'Could not upload the consent letter.');
    } finally {
      setConsentBusy(false);
      e.target.value = '';
    }
  };

  useEffect(() => {
    let live = true;
    getMe().then((res) => {
      if (!live) return;
      const role = res.data?.role;
      if (role === 'super_admin' || role === 'admin') return;   // unrestricted
      // Granted ∩ selected from the API; the raw selection is the fallback.
      let services = Array.isArray(res.data?.effective_services) ? res.data.effective_services : null;
      if (!services) {
        try {
          const raw = res.data?.allowed_services;
          services = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch { services = null; }
      }
      // No list stored means no restriction, matching the rest of the app.
      if (Array.isArray(services) && !services.includes('find_kols')) setCanFindKols(false);
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  const handleDownloadCV = () => saveAttachment(downloadCV, `cv_${id}.pdf`, 'CV');
  const handleDownloadConsent = () => saveAttachment(downloadConsent, `consent_${id}.pdf`, 'consent letter');

  if (loading) {
    return (
      <div className="page container">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading HCP profile...</p>
        </div>
      </div>
    );
  }

  if (error || !hcp) {
    return (
      <div className="page container">
        <div className="alert alert-error"><AlertCircle size={18} /> {error || 'HCP not found.'}</div>
        <Link to="/assessments" className="btn btn-secondary"><ArrowLeft size={16} /> Back to Assessments</Link>
      </div>
    );
  }

  const affiliations = toArray(hcp.affiliations);

  // Sections the New Assessment form captures as repeatable rows. Each is stored
  // as one string — fields joined by ", ", rows by " | " — so a row per bullet.
  const credentialSections = [
    ['Faculty Positions & Affiliations', hcp.faculty_positions],
    ['Textbooks / Book Chapters', hcp.textbooks],
    ['Office Bearer / Leadership Positions', hcp.office_bearer_positions],
    ['Conference Presentations', hcp.conference_presentations],
    ['Advisory Boards', hcp.advisory_board],
    ['Professional Memberships', hcp.professional_memberships],
    ['Awards / Recognitions', hcp.awards_recognitions],
  ].filter(([, value]) => value && String(value).trim());

  return (
    <div className="page container">
      <div style={{ marginBottom: '16px' }}>
        <Link to="/assessments" className="btn btn-ghost btn-sm"><ArrowLeft size={16} /> Back to Assessments</Link>
      </div>

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>{hcp.full_name}</h1>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            {hcp.specialty} {hcp.institution ? `at ${hcp.institution}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {assessment ? (
            <Link to={`/hcp/${id}/results`} className="btn btn-primary"><FileText size={16} /> View Results</Link>
          ) : (
            <Link to={`/hcp/${id}/assess`} className="btn btn-primary"><Play size={16} /> Run Assessment</Link>
          )}
          {assessment && (
            <button className="btn btn-secondary" onClick={handleExport}><Download size={16} /> Export CSV</button>
          )}
          <Link to={`/hcp/${id}/reassess`} className="btn btn-outline"
                title="Open these details pre-filled, edit what has changed, and score again">
            <RefreshCw size={16} /> Re-assessment
          </Link>
          {!canFindKols ? null : kolStatus === 'added' || kolStatus === 'exists' ? (
            <Link to="/assessments" className="btn btn-outline" style={{ color: 'var(--color-success)', borderColor: 'var(--color-success)' }}>
              <CheckCircle size={16} /> {kolStatus === 'added' ? 'Added to KOL Database' : 'Already in KOL Database'}
            </Link>
          ) : (
            <button className="btn btn-outline" onClick={handleAddToKOLDatabase} disabled={kolStatus === 'saving'}
              title="Add this HCP to the Find KOLs database">
              {kolStatus === 'saving'
                ? <><Loader size={16} className="spinning" /> Adding</>
                : <><UserPlus size={16} /> Make KOL Database</>}
            </button>
          )}
        </div>
      </div>

      {kolError && (
        <div className="alert alert-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={16} /> {kolError}
        </div>
      )}

      <div className="dashboard-grid">
        {/* Profile Info */}
        <div className="card">
          <div className="card-header"><h4>Profile Information</h4></div>
          <div className="card-body">
            <table className="table">
              <tbody>
                {[
                  ['Email', hcp.email],
                  ['Mobile', hcp.mobile],
                  ['Country', hcp.country],
                  ['HCP Type', hcp.hcp_type?.replace(/_/g, ' ')],
                  ['Specialty', hcp.specialty],
                  ['Institution', hcp.institution],
                  ['Years of Experience', hcp.years_of_experience],
                  ['Procedures/Year', hcp.procedures_per_year],
                  ['Unique Expertise', hcp.unique_expertise],
                  ['Age Estimate', hcp.age_estimate],
                  ['Education', hcp.education],
                ].map(([label, value]) => value ? (
                  <tr key={label}>
                    <td style={{ fontWeight: 600, width: '40%', color: 'var(--color-text-secondary)' }}>{label}</td>
                    <td>{value}</td>
                  </tr>
                ) : null)}
              </tbody>
            </table>
          </div>
        </div>

        {/* Faculty roles, textbooks, leadership, presentations, advisory boards,
            memberships and awards. Only rendered when at least one has content.
            Was headed "Credentials", which these are not — a credential is a
            qualification or licence; these are activities and achievements. */}
        {credentialSections.length > 0 && (
          <div className="card">
            <div className="card-header"><h4>Professional Activities &amp; Achievements</h4></div>
            <div className="card-body">
              {credentialSections.map(([label, value]) => (
                <div key={label} style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                    {label}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.88rem' }}>
                    {String(value).split(' | ').filter((entry) => entry.trim()).map((entry, i) => (
                      <li key={i}>{entry}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Assessment Summary */}
        <div className="card">
          <div className="card-header"><h4>Assessment Summary</h4></div>
          <div className="card-body">
            {assessment ? (
              <div style={{ textAlign: 'center' }}>
                <div className="score-meter">
                  <div className="score-meter-circle">
                    <div className="score-meter-value">{assessment.final_score?.toFixed(1)}</div>
                    <div className="score-meter-label">Final Score</div>
                  </div>
                </div>
                <div style={{ marginBottom: '16px' }}>{getTierBadge(assessment.tier)}</div>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
                  Assessed on {assessment.created_at ? new Date(assessment.created_at).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '32px', color: 'var(--color-text-secondary)' }}>
                <p>No assessment completed yet.</p>
                <Link to={`/hcp/${id}/assess`} className="btn btn-primary" style={{ marginTop: '16px' }}>
                  <Play size={16} /> Run Assessment
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Affiliations. Faculty positions used to sit here as comma-split badges;
          they are now captured as rows (" | " separated) and render in Credentials. */}
      {affiliations.length > 0 && (
        <div className="card" style={{ marginTop: '24px' }}>
          <div className="card-header"><h4>Affiliations</h4></div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {affiliations.map((a, i) => (
                <span key={i} className="badge" style={{ background: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>{a}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Consent letter — above the CV, the same order as the New HCP form.
          Rendered whether or not one exists, because "no consent on file" is
          itself worth seeing on a compliance record. */}
      {(
        <div className="card" style={{ marginTop: '24px' }}>
          <div className="card-header">
            <h4><ShieldCheck size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Consent Letter</h4>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <p style={{ fontWeight: 500, marginBottom: 4 }}>
                  {hcp.consent_file_path
                    ? `Signed consent from ${hcp.full_name}`
                    : 'No consent letter on file'}
                </p>
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                  {/* consent_uploaded_at, not updated_at — the record changes for
                      many reasons, and only this timestamp says when the consent
                      itself was filed. */}
                  {hcp.consent_file_path
                    ? (hcp.consent_uploaded_at
                        ? `Uploaded on ${new Date(hcp.consent_uploaded_at).toLocaleDateString()}`
                        : 'Upload date not recorded')
                    : 'PDF, DOC, DOCX, JPG or PNG'}
                </p>
                {consentError && (
                  <p style={{ fontSize: '0.82rem', color: 'var(--color-error)', margin: '6px 0 0' }}>
                    {consentError}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {hcp.consent_file_path && (
                  <button className="btn btn-outline" onClick={handleDownloadConsent}>
                    <Download size={16} /> Download
                  </button>
                )}
                <button className="btn btn-outline" disabled={consentBusy}
                        onClick={() => consentRef.current?.click()}>
                  {consentBusy
                    ? <><Loader size={16} className="spinning" /> Uploading…</>
                    : <><UploadIcon size={16} /> {hcp.consent_file_path ? 'Replace' : 'Upload'}</>}
                </button>
                <input ref={consentRef} type="file" style={{ display: 'none' }}
                       accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                       onChange={handleConsentPick} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CV Document */}
      {hcp.cv_file_path && (
        <div className="card" style={{ marginTop: '24px' }}>
          <div className="card-header"><h4><File size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Uploaded CV</h4></div>
          <div className="card-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 500, marginBottom: 4 }}>
                  {hcp.full_name}'s CV
                </p>
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                  Uploaded on {hcp.updated_at ? new Date(hcp.updated_at).toLocaleDateString() : 'N/A'}
                </p>
              </div>
              <button className="btn btn-outline" onClick={handleDownloadCV}>
                <Download size={16} /> Download CV
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
