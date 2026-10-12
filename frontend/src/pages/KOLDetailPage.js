import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, AlertCircle, Pencil, Trash2, Mail, Phone, MapPin, Globe2, Briefcase, Hourglass,
  ClipboardList, Loader, CheckCircle2,
} from 'lucide-react';
import { getKOL, enrichKOL, deleteKOL, getKOLFacets, updateKOLFromCTRI } from '../services/api';
import { kolName } from '../utils/kolName';
import { EnrichmentView, CTRICaptcha, CTRITrialsView } from './KOLScrapePanel';
import {
  KOLFormModal, avatarFor, INFLUENCE_STYLE, SOURCE_LABELS, EMPTY_FACETS,
} from './FindKOLsTab';

const BACK_TO = '/assessments?tab=find-kols';

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
};

// One label/value line; renders nothing when there is no value.
function Row({ label, children }) {
  if (children == null || children === '') return null;
  return (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', fontSize: '0.85rem', alignItems: 'baseline' }}>
      <span style={{ flex: '0 0 150px', color: 'var(--color-text-light)' }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, color: 'var(--color-text)', wordBreak: 'break-word' }}>{children}</span>
    </div>
  );
}

// A card with a heading; hidden when every Row inside it is empty.
function Section({ title, children }) {
  const hasContent = React.Children.toArray(children).some((c) => {
    const v = c?.props?.children;
    return v != null && v !== '';
  });
  if (!hasContent) return null;
  return (
    <div className="card" style={{ padding: '16px 20px', marginBottom: 16 }}>
      <div style={{
        fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
        color: 'var(--color-text-secondary)', marginBottom: 6, paddingBottom: 6,
        borderBottom: '1px solid var(--color-border-light)',
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export default function KOLDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [kol, setKol] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [facets, setFacets] = useState(EMPTY_FACETS);

  // Update from CTRI — one name search, which costs one security code.
  const [ctriOpen, setCtriOpen] = useState(false);
  const [ctri, setCtri] = useState({ session: '', captcha: '' });
  const [ctriNonce, setCtriNonce] = useState(0);
  const [ctriBusy, setCtriBusy] = useState(false);
  const [ctriMsg, setCtriMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await getKOL(id);
      setKol(res.data);
      setError('');
    } catch (err) {
      setError(err.response?.status === 404 ? 'This KOL no longer exists.' : 'Failed to load KOL.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // While publications / trials are being fetched, poll so the result appears on its own.
  const running = kol?.enrichment_status === 'running';
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [running, load]);

  const fetchDetails = async () => {
    setBusy(true); setError('');
    try {
      const res = await enrichKOL(id);
      setKol(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not start the fetch.');
    } finally {
      setBusy(false);
    }
  };

  const runCtri = async () => {
    if (!ctri.captcha) { setError('Type the CTRI security code first.'); return; }
    setCtriBusy(true); setError(''); setCtriMsg('');
    try {
      const before = kol.ctri?.trial_count || 0;
      const res = await updateKOLFromCTRI(id, ctri);
      setKol(res.data);
      const n = res.data.ctri?.trial_count || 0;
      setCtriMsg(n === 0 ? 'No CTRI trials found under this name.'
        : `${n} CTRI trial${n === 1 ? '' : 's'} on record${n > before ? ` (${n - before} new)` : ''}. Blank contact details were filled in where CTRI had them.`);
      setCtriOpen(false);
    } catch (err) {
      setError(err.response?.data?.detail || 'CTRI update failed.');
    } finally {
      setCtriBusy(false);
      setCtriNonce(n => n + 1);   // a code is good for one search
    }
  };

  const openEdit = async () => {
    setEditing(true);
    try {
      const res = await getKOLFacets();
      setFacets({ ...EMPTY_FACETS, ...res.data });
    } catch { /* suggestions only */ }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Remove ${kolName(kol, 'this KOL')} from the KOL database?`)) return;
    try {
      await deleteKOL(kol.id);
      navigate(BACK_TO);
    } catch {
      setError('Failed to delete KOL.');
    }
  };

  if (loading) {
    return <div className="loading-container"><div className="spinner"></div><p>Loading KOL...</p></div>;
  }

  if (!kol) {
    return (
      <div>
        <div className="alert alert-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={16} /> <span>{error || 'KOL not found.'}</span>
        </div>
        <Link to={BACK_TO} className="btn btn-secondary"><ArrowLeft size={16} /> Back to Find KOLs</Link>
      </div>
    );
  }

  const name = kolName(kol, 'Unnamed');
  const { initials, colors } = avatarFor(kol);
  const [bg, fg] = colors;
  const src = SOURCE_LABELS[kol.source] || SOURCE_LABELS.manual;
  const inf = INFLUENCE_STYLE[kol.influence_level];
  const role = [kol.designation, kol.institution].filter(Boolean).join(' · ');
  const place = [kol.state_city, kol.geographic_zone].filter(Boolean).join(', ');

  const pill = (text, style) => (
    <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, ...style }}>{text}</span>
  );
  const contact = (Icon, content) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <Icon size={13} style={{ color: 'var(--color-text-light)' }} /> {content}
    </span>
  );

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link to={BACK_TO} className="btn btn-ghost btn-sm"><ArrowLeft size={16} /> Back to Find KOLs</Link>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={16} /> <span>{error}</span>
        </div>
      )}

      {/* Header */}
      <div className="card" style={{ padding: 20, marginBottom: 20, display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{
          width: 60, height: 60, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: bg, color: fg, fontWeight: 700, fontSize: '1.1rem',
        }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ margin: 0, fontSize: '1.35rem' }}>{name}</h2>
          {role && <div style={{ color: 'var(--color-text-secondary)', marginTop: 4, fontSize: '0.9rem' }}>{role}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {inf && pill(kol.influence_level, { background: inf.bg, color: inf.color })}
            {pill(src.label, { background: src.bg, color: src.color, fontWeight: 600 })}
            {kol.geographic_zone && pill(<><Globe2 size={10} style={{ verticalAlign: -1 }} /> {kol.geographic_zone}</>,
              { background: 'var(--color-surface-raised)', color: 'var(--color-text-secondary)', fontWeight: 600 })}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap', fontSize: '0.83rem', color: 'var(--color-text-secondary)' }}>
            {kol.email && contact(Mail, <a href={`mailto:${kol.email}`} style={{ color: 'inherit' }}>{kol.email}</a>)}
            {kol.contact_no && contact(Phone, kol.contact_no)}
            {place && contact(MapPin, place)}
            {kol.experience_years != null && contact(Hourglass, `${kol.experience_years} yrs experience`)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button className="btn btn-outline btn-sm" onClick={openEdit}><Pencil size={14} /> Edit</button>
          <button className="btn btn-sm btn-ghost" onClick={handleDelete} style={{ color: 'var(--color-error)' }}>
            <Trash2 size={14} /> Remove
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, alignItems: 'start' }}>
        <div>
          <Section title="Professional">
            <Row label="Therapeutic area">{kol.therapeutic_area}</Row>
            <Row label="Specialty">{kol.specialty}</Row>
            <Row label="Subspecialty">{kol.subspecialty}</Row>
            <Row label="Institution">{kol.institution}</Row>
            <Row label="Designation">{kol.designation}</Row>
            <Row label="Functional expertise">{kol.functional_expertise}</Row>
            <Row label="Influence level">{kol.influence_level}</Row>
            <Row label="Total experience">{kol.experience_years != null ? `${kol.experience_years} years` : null}</Row>
          </Section>

          <Section title="Contact & Location">
            <Row label="Email">{kol.email}</Row>
            <Row label="Phone">{kol.contact_no}</Row>
            <Row label="State / City">{kol.state_city}</Row>
            <Row label="Country">{kol.geographic_zone}</Row>
          </Section>

          <Section title="Notes">
            <Row label="">{kol.notes && <span style={{ whiteSpace: 'pre-wrap' }}>{kol.notes}</span>}</Row>
          </Section>

          <Section title="Record">
            <Row label="Source">{src.label}</Row>
            <Row label="Added">{fmtDate(kol.created_at)}</Row>
            <Row label="Updated">{fmtDate(kol.updated_at)}</Row>
          </Section>
        </div>

        <div>
          <div className="card" style={{ padding: '16px 20px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontWeight: 600, fontSize: '0.92rem' }}>
              <Briefcase size={15} style={{ color: 'var(--color-primary)' }} /> Research footprint
            </div>
            <EnrichmentView record={kol} onRefresh={fetchDetails} refreshing={busy} />
          </div>

          <div className="card" style={{ padding: '16px 20px' }}>
            <CTRITrialsView record={kol} action={!ctriOpen && (
              <button className="btn btn-sm btn-ghost" style={{ fontSize: '0.72rem' }} onClick={() => setCtriOpen(true)}
                title="Search CTRI by this KOL's name">
                <ClipboardList size={12} /> {kol.ctri ? 'Update from CTRI' : 'Check CTRI'}
              </button>
            )} />
            {ctriMsg && (
              <div style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--color-success-text)', display: 'flex', gap: 6, alignItems: 'center' }}>
                <CheckCircle2 size={13} /> {ctriMsg}
              </div>
            )}
            {ctriOpen && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border-light)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: 8 }}>
                  Searches CTRI for <strong>{name}</strong>. CTRI asks for its security code on every search.
                </div>
                <CTRICaptcha nonce={ctriNonce} onChange={setCtri} />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn btn-sm btn-primary" onClick={runCtri} disabled={ctriBusy || !ctri.captcha}>
                    {ctriBusy ? <><Loader size={13} className="spinning" /> Searching CTRI…</> : 'Search CTRI'}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setCtriOpen(false)} disabled={ctriBusy}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <KOLFormModal kol={kol} facets={facets}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }} />
      )}
    </div>
  );
}
