import React, { useState, useEffect, useCallback } from 'react';
import { COUNTRIES } from '../utils/countries';
import { kolName } from '../utils/kolName';
import {
  Twitter, Search, X, Loader, AlertCircle, Users,
  MapPin, Send, ExternalLink, BadgeCheck, ThumbsUp, ThumbsDown, Trash2, Clock,
  Stethoscope, IndianRupee, Briefcase, Star, GraduationCap, Mail, Phone, Info,
  FileText, FlaskConical, BookOpen, RefreshCw, CheckCircle2, ExternalLink as LinkIcon, Globe,
  ClipboardList,
} from 'lucide-react';
import {
  scrapeKOLs, submitKOLsForApproval, listPendingKOLs, getPendingKOLFacets,
  approvePendingKOL, rejectPendingKOL, deletePendingKOL, deletePendingKOLsBulk, approvePendingKOLsBulk, getMasterData,
  findPendingOwnPage, findPendingOwnPages, findPendingContacts,
  enrichPendingKOL, getCTRICaptcha,
} from '../services/api';

const INFLUENCE_LEVELS = ['Global', 'National', 'Regional', 'Local', 'Emerging'];

// Badge for where a candidate / pending row came from.
function SourceBadge({ source, size = '0.68rem' }) {
  const cfg = source === 'practo'
    ? { icon: Stethoscope, label: 'Practo', color: 'var(--color-accent)', bg: 'var(--color-info-bg)' }
    : source === 'google'
      ? { icon: Globe, label: 'Google', color: 'var(--color-success)', bg: 'var(--color-success-bg)' }
      : source === 'ctri'
        ? { icon: ClipboardList, label: 'CTRI', color: 'var(--color-violet)', bg: 'var(--color-violet-bg)' }
        : source === 'pubmed'
          ? { icon: BookOpen, label: 'PubMed', color: 'var(--color-accent)', bg: 'var(--color-info-bg)' }
          : source === 'ctgov'
            ? { icon: FlaskConical, label: 'ClinicalTrials.gov', color: 'var(--color-violet)', bg: 'var(--color-violet-bg)' }
            : { icon: Twitter, label: 'X', color: 'var(--color-info)', bg: 'var(--color-info-bg)' };
  const Icon = cfg.icon;
  return (
    <span style={{ fontSize: size, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
      color: cfg.color, background: cfg.bg,
      display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <Icon size={9} /> {cfg.label}
    </span>
  );
}

const fmtFollowers = (n) => {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

// ─────────────────────────────────────────────────────────
// CTRI security code
// ─────────────────────────────────────────────────────────
// CTRI's search is behind a CAPTCHA. This loads one, shows it, and reports
// { session, captcha } as the user types. A code is good for one search, so
// the parent bumps `nonce` after every attempt to load a fresh one.
export function CTRICaptcha({ nonce = 0, onChange }) {
  const [img, setImg] = useState(null);
  const [session, setSession] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr(''); setCode('');
    try {
      const res = await getCTRICaptcha();
      setImg(res.data.image);
      setSession(res.data.session);
    } catch (e) {
      setImg(null); setSession('');
      setErr(e.response?.data?.detail || 'Could not reach CTRI.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, nonce]);
  useEffect(() => { onChange?.({ session, captcha: code.trim() }); }, [session, code, onChange]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ height: 44, minWidth: 120, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid var(--color-border)', borderRadius: 6, background: '#fff', padding: '0 4px' }}>
        {loading ? <Loader size={16} className="spinning" />
          : img ? <img src={img} alt="CTRI security code" style={{ height: 38 }} />
            : <span style={{ fontSize: '0.74rem', color: 'var(--color-error)' }}>{err || 'No code'}</span>}
      </div>
      <button type="button" className="btn btn-sm btn-ghost" onClick={load} disabled={loading} title="Load a different code">
        <RefreshCw size={13} /> New code
      </button>
      <input className="form-control" style={{ width: 140, letterSpacing: '0.12em' }} maxLength={6}
        placeholder="Type the code" value={code} onChange={(e) => setCode(e.target.value)}
        aria-label="CTRI security code" autoComplete="off" />
    </div>
  );
}

// The CTRI trials recorded on a KOL / pending row (`record.ctri`).
export function CTRITrialsView({ record: p, action }) {
  const c = p.ctri;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-secondary)' }}>
          CTRI — Clinical Trials Registry India
        </span>
        {action}
      </div>
      {!c ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-light)' }}>
          Not checked yet. Update from CTRI searches the registry by name for trials this person ran in India.
        </div>
      ) : c.trial_count === 0 ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-light)' }}>
          No CTRI trials found under this name.
        </div>
      ) : (
        <>
          <div style={{ fontSize: '0.8rem' }}>
            <strong>{c.trial_count}</strong> trial{c.trial_count === 1 ? '' : 's'}
            {c.pi_count ? <> · <strong>{c.pi_count}</strong> as principal investigator</> : null}
          </div>
          <ul style={{ margin: '5px 0 0', paddingLeft: 16, fontSize: '0.76rem', color: 'var(--color-text-secondary)' }}>
            {(c.trials || []).slice(0, 8).map((t) => (
              <li key={t.ctri_no || t.trial_id} style={{ marginBottom: 3 }}>
                <a href={t.url} target="_blank" rel="noreferrer" style={{ color: 'var(--color-text-primary)', textDecoration: 'none' }}>
                  {t.title || t.ctri_no}
                </a>
                <span style={{ color: 'var(--color-text-light)' }}>
                  {' '}— {[t.ctri_no, t.role, t.status, t.condition].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
          {(c.trials || []).length > 8 && (
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-light)', marginTop: 3 }}>
              + {c.trials.length - 8} more
            </div>
          )}
        </>
      )}
      {p.ctri_updated_at && (
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-light)', marginTop: 6 }}>
          Checked {fmtDate(p.ctri_updated_at)}. Name-matched — verify it's the same person.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Scrape modal: criteria → candidate list → send for approval
// ─────────────────────────────────────────────────────────
export function ScrapeModal({ initialCriteria, onClose, onSubmitted }) {
  const [criteria, setCriteria] = useState({
    therapeutic_area: '', geographic_zone: '', state: '', city: '',
    specialty: '', subspecialty: '', institution: '', designation: '',
    influence_level: '', functional_expertise: '', limit: 40,
    ...initialCriteria,
  });
  // Therapeutic areas are user-managed (Account → Categories) — the dropdown is
  // built from them, and each carries the supporting keywords the search runs on.
  const [areas, setAreas] = useState([]);
  const [areasLoaded, setAreasLoaded] = useState(false);
  // Method toggles: X recent tweets (2), X hub followers (3), Practo directory (4).
  const [useRecent, setUseRecent] = useState(true);
  const [hubText, setHubText] = useState('');
  const [usePracto, setUsePracto] = useState(true);
  // Method 5: Google web search — hospital / clinic pages that name doctors.
  const [useGoogle, setUseGoogle] = useState(true);
  const [findOwnPages, setFindOwnPages] = useState(true);
  // Method 6: CTRI — trial investigators. Needs a security code per search.
  const [useCtri, setUseCtri] = useState(false);
  const [ctri, setCtri] = useState({ session: '', captcha: '' });
  const [ctriNonce, setCtriNonce] = useState(0);
  // Methods 7–8: research registries — authors / investigators in the place, with
  // the email (and trial phone) they published.
  const [usePubmed, setUsePubmed] = useState(true);
  const [useCtgov, setUseCtgov] = useState(true);
  const [enrichProfiles, setEnrichProfiles] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);      // { query, count, candidates }
  const [picked, setPicked] = useState({});         // candidate key -> true
  const [submitting, setSubmitting] = useState(false);

  const set = (k, v) => setCriteria((c) => ({ ...c, [k]: v }));
  const hubHandles = hubText.split(/[\s,]+/).map((h) => h.replace(/^@/, '').trim()).filter(Boolean);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getMasterData('therapeutic_area');
        if (cancelled) return;
        const list = res.data || [];
        setAreas(list);
        // Default to the first area only when the caller didn't pass one, so a
        // pre-filled criteria (e.g. from an advisory board) still wins.
        setCriteria((c) => (c.therapeutic_area || !list.length
          ? c : { ...c, therapeutic_area: list[0].label }));
      } catch {
        if (!cancelled) setError('Could not load therapeutic areas. Add them in Account → Categories.');
      } finally {
        if (!cancelled) setAreasLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // The keywords behind the picked area — shown so the user can see what the
  // search actually runs on, and why a bare label alone would find little.
  const activeArea = areas.find((a) => a.label === criteria.therapeutic_area);
  const activeKeywords = activeArea?.keyword_list || [];

  const runScrape = async () => {
    if (!useRecent && hubHandles.length === 0 && !usePracto && !useGoogle && !useCtri && !usePubmed && !useCtgov) {
      setError('Pick at least one method: recent tweets, a hub @handle, the Practo directory, Google search, CTRI, PubMed or ClinicalTrials.gov.');
      return;
    }
    if (useCtri && !ctri.captcha) {
      setError('Type the CTRI security code shown under CTRI, or untick CTRI.');
      return;
    }
    setRunning(true); setError(''); setResult(null); setPicked({});
    try {
      const res = await scrapeKOLs({
        ...criteria, use_recent_search: useRecent, hub_handles: hubHandles, per_hub: 200,
        use_practo: usePracto, enrich_profiles: enrichProfiles, use_google: useGoogle,
        find_own_pages: useGoogle && findOwnPages,
        use_ctri: useCtri, ctri_session: useCtri ? ctri.session : null, ctri_captcha: useCtri ? ctri.captcha : null,
        use_pubmed: usePubmed, use_ctgov: useCtgov,
      });
      setResult(res.data);
      // Pre-tick everything not already known.
      const pre = {};
      (res.data.candidates || []).forEach((c) => { if (!c.already_known) pre[c.key] = true; });
      setPicked(pre);
    } catch (e) {
      setError(e.response?.data?.detail || 'Scrape failed. Check your X (Twitter) connection.');
    } finally {
      setRunning(false);
      // A CTRI code is single-use — load a fresh one for the next search.
      if (useCtri) setCtriNonce((n) => n + 1);
    }
  };

  const toggle = (key) => setPicked((p) => ({ ...p, [key]: !p[key] }));
  const pickedList = (result?.candidates || []).filter((c) => picked[c.key]);

  const submit = async () => {
    if (pickedList.length === 0) return;
    setSubmitting(true); setError('');
    try {
      const items = pickedList.map((c) => {
        const isPracto = c.source === 'practo';
        // PubMed / ClinicalTrials.gov are keyed by their search link, like Google.
        const isGoogle = ['google', 'pubmed', 'ctgov'].includes(c.source);
        const isCtri = c.source === 'ctri';
        const isX = !isPracto && !isGoogle && !isCtri;
        // Everything the scrape found that has no column of its own. Kept as text
        // on the record rather than dropped on the floor.
        const extras = [
          c.practo_qualifications?.length && `Qualifications: ${c.practo_qualifications.join('; ')}`,
          c.practo_registration && `Reg: ${c.practo_registration}${c.practo_registration_verified ? ' (verified)' : ''}`,
          c.practo_memberships?.length && `Memberships: ${c.practo_memberships.join('; ')}`,
          c.practo_languages?.length && `Languages: ${c.practo_languages.join(', ')}`,
          c.practo_rating != null && `Rating: ${c.practo_rating}% (${c.practo_reviews_count ?? 0} reviews)`,
          c.practo_fee != null && `Fee: ₹${c.practo_fee}`,
          c.postal_code && `PIN: ${c.postal_code}`,
          isGoogle && c.web_page_title && `Found on: ${c.web_page_title}`,
          c.source !== 'google' && isGoogle && c.institution && `Affiliation: ${c.institution}`,
          isGoogle && c.bio && c.bio.replace(/\|/g, '/'),
          isCtri && c.bio && c.bio.replace(/\|/g, '/'),
        ].filter(Boolean).join(' | ');
        return {
          source: isPracto ? 'practo' : isGoogle ? c.source : isCtri ? 'ctri' : 'twitter',
          name: c.name,
          email: c.email || null,
          contact_no: c.contact_no || null,
          notes: extras || null,
          // X identity; left blank for Practo / Google candidates.
          x_username: isX ? c.x_username : null,
          x_name: isX ? c.name : null,
          x_bio: isX ? c.bio : null,
          x_location: isX ? c.location : null,
          x_followers: isX ? c.x_followers : null,
          x_profile_url: isX ? c.profile_url : null,
          // Practo identity.
          practo_profile_url: isPracto ? c.profile_url : null,
          // Google identity: the page the doctor was found on.
          web_profile_url: isGoogle ? c.profile_url : null,
          // CTRI identity + the trials found for this investigator.
          ctri_key: isCtri ? c.ctri_key : null,
          ctri_trials: isCtri ? c.ctri_trials : null,
          therapeutic_area: criteria.therapeutic_area || null,
          geographic_zone: criteria.geographic_zone || null,
          // What the scrape actually found beats the criteria, which are only what
          // we asked for: the doctor's own locality/city is more precise than the
          // city we searched.
          state_city: [c.locality || c.city, c.state].filter(Boolean).join(', ')
            || [criteria.city, criteria.state].filter(Boolean).join(', ')
            || c.location || null,
          specialty: c.specialty || criteria.specialty || null,
          subspecialty: c.subspecialty || criteria.subspecialty || null,
          institution: c.institution || criteria.institution || null,
          designation: c.designation || criteria.designation || null,
          influence_level: criteria.influence_level || c.suggested_influence_level || null,
          functional_expertise: criteria.functional_expertise || null,
          experience_years: c.experience_years ?? null,
        };
      });
      const res = await submitKOLsForApproval(items);
      onSubmitted?.(res.data);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to send for approval.');
      setSubmitting(false);
    }
  };

  const field = (label, key, opts = {}) => (
    <div>
      <label className="form-label" style={{ fontSize: '0.8rem' }}>{label}{opts.optional && <span style={{ color: 'var(--color-text-light)' }}> (optional)</span>}</label>
      {opts.select ? (
        <select className="form-control" value={criteria[key]} onChange={(e) => set(key, e.target.value)}>
          <option value="">Any</option>
          {opts.select.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input className="form-control" value={criteria[key]} placeholder={opts.placeholder || ''}
          onChange={(e) => set(key, e.target.value)} />
      )}
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: '100%', maxWidth: 760, maxHeight: '90vh', overflow: 'auto', padding: 0 }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 1 }}>
          <h3 style={{ margin: 0, fontSize: '1.02rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Search size={18} style={{ color: 'var(--color-primary)' }} /> Find KOLs
          </h3>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }} onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ padding: 22 }}>
          {error && (
            <div className="alert alert-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={16} /> <span>{error}</span>
            </div>
          )}

          <p style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>
            Two kinds of source, and they answer different questions. <strong>X</strong> shows
            social influence but only reaches doctors who are active there, and it matches what
            people <strong>write</strong>, not where they live — so location is approximate.
            <strong> Practo</strong> lists the actual practising doctors in a city with their clinic
            and specialty, but carries no social signal. <strong>Google</strong> finds doctors named on
            hospital and clinic pages, in any country. Review results before sending for approval.
          </p>
          <p style={{ fontSize: '0.78rem', color: 'var(--color-text-light)', margin: '0 0 16px' }}>
            Tip: a City or State is a tighter filter than Country. When you set a City/State,
            the Country is skipped so it doesn't pull in the whole country. With only a Country,
            Practo searches its major cities (Practo covers India only). Very specific cities
            may return few or no recent tweets on X.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div>
              <label className="form-label" style={{ fontSize: '0.8rem' }}>Therapeutic Area</label>
              <select className="form-control" value={criteria.therapeutic_area}
                onChange={(e) => set('therapeutic_area', e.target.value)}>
                <option value="">{areasLoaded && !areas.length ? 'None configured' : 'Any'}</option>
                {areas.map((a) => <option key={a.id} value={a.label}>{a.label}</option>)}
              </select>
            </div>
            {field('Country', 'geographic_zone', { select: COUNTRIES })}
            {field('State', 'state', { placeholder: 'Maharashtra' })}
            {field('City', 'city', { placeholder: 'Mumbai' })}
            {field('Specialty', 'specialty', { optional: true, placeholder: 'Dermatology' })}
            {field('Subspecialty', 'subspecialty', { optional: true, placeholder: 'Pediatric Dermatology' })}
            {field('Institution', 'institution', { optional: true, placeholder: 'AIIMS' })}
            {field('Designation', 'designation', { optional: true })}
            {field('Influence Level', 'influence_level', { optional: true, select: INFLUENCE_LEVELS })}
            {field('Functional Expertise', 'functional_expertise', { optional: true })}
          </div>

          {/* What the chosen area actually searches on. */}
          {criteria.therapeutic_area && (
            <div style={{ marginTop: 10, fontSize: '0.76rem', color: 'var(--color-text-light)' }}>
              {activeKeywords.length > 0 ? (
                <>
                  Also searching {activeKeywords.length} supporting keyword{activeKeywords.length === 1 ? '' : 's'}:{' '}
                  <span style={{ color: 'var(--color-text-secondary)' }}>{activeKeywords.join(' · ')}</span>
                </>
              ) : (
                <>
                  No supporting keywords for {criteria.therapeutic_area} — only the label itself is
                  searched, which finds few people. Add them in Account → Categories → Therapeutic Area.
                </>
              )}
            </div>
          )}

          {/* Search methods */}
          <div style={{ marginTop: 18, padding: 14, borderRadius: 8, background: 'var(--color-bg)', border: '1px solid var(--color-border-light)' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
              How to find them
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={usePracto} onChange={(e) => setUsePracto(e.target.checked)} style={{ marginTop: 3 }} />
              <span style={{ fontSize: '0.84rem' }}>
                <strong>Practo directory</strong> — every doctor listed in your City for the
                Specialty (or Therapeutic Area), with clinic, locality and fee. With only a Country,
                it searches that country's major cities.
                <span style={{ color: 'var(--color-text-light)' }}> Best coverage for a place-based search. India only.</span>
              </span>
            </label>
            {usePracto && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 12, marginLeft: 24 }}>
                <input type="checkbox" checked={enrichProfiles} onChange={(e) => setEnrichProfiles(e.target.checked)} style={{ marginTop: 3 }} />
                <span style={{ fontSize: '0.84rem' }}>
                  <strong>Open each doctor's profile</strong> — adds qualifications, medical-council
                  registration, years of experience, rating, languages and subspecialty.
                  <span style={{ color: 'var(--color-text-light)' }}> One extra page per doctor, so it's slower. Off = name, clinic, locality and fee only.</span>
                </span>
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={useGoogle} onChange={(e) => setUseGoogle(e.target.checked)} style={{ marginTop: 3 }} />
              <span style={{ fontSize: '0.84rem' }}>
                <strong>Google search</strong> — doctors named on hospital, clinic and directory pages
                for the Specialty (or Therapeutic Area) in your City, State or Country.
                <span style={{ color: 'var(--color-text-light)' }}> Works for any country. Runs alongside X and Practo.</span>
              </span>
            </label>
            {useGoogle && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 12, marginLeft: 24 }}>
                <input type="checkbox" checked={findOwnPages} onChange={(e) => setFindOwnPages(e.target.checked)} style={{ marginTop: 3 }} />
                <span style={{ fontSize: '0.84rem' }}>
                  <strong>Find each doctor's own page</strong> — when a doctor is named only on a list page
                  (e.g. "Best Pediatricians in Meerut" on Justdial), search for their own page and read their experience from it.
                  <span style={{ color: 'var(--color-text-light)' }}> Uses up to one SerpAPI search per such doctor. Off = keep the list link (you can still use Find own page later).</span>
                </span>
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={useCtri} onChange={(e) => setUseCtri(e.target.checked)} style={{ marginTop: 3 }} />
              <span style={{ fontSize: '0.84rem' }}>
                <strong>CTRI (Clinical Trials Registry - India)</strong> — principal and site investigators of
                registered trials for the Specialty (or Therapeutic Area), with institution, address, phone and
                email from the trial record. Filtered to your City / State.
                <span style={{ color: 'var(--color-text-light)' }}> India only. CTRI asks for a security code on every search.</span>
              </span>
            </label>
            {useCtri && (
              <div style={{ marginBottom: 12, marginLeft: 24 }}>
                <CTRICaptcha nonce={ctriNonce} onChange={setCtri} />
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={usePubmed} onChange={(e) => setUsePubmed(e.target.checked)} style={{ marginTop: 3 }} />
              <span style={{ fontSize: '0.84rem' }}>
                <strong>PubMed</strong> — authors of the last 5 years' papers on the Specialty (and the Therapeutic
                Area's keywords) whose own affiliation is in your City (or State), with institution and the email
                they published as corresponding author.
                <span style={{ color: 'var(--color-text-light)' }}> Any country. Finds research-active doctors; private practitioners rarely publish.</span>
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={useCtgov} onChange={(e) => setUseCtgov(e.target.checked)} style={{ marginTop: 3 }} />
              <span style={{ fontSize: '0.84rem' }}>
                <strong>ClinicalTrials.gov</strong> — principal investigators and site contacts of trials on the
                Specialty (and the Therapeutic Area's keywords) at sites in your City (or State), with the email and
                phone listed on the trial.
                <span style={{ color: 'var(--color-text-light)' }}> Any country. No security code needed.</span>
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={useRecent} onChange={(e) => setUseRecent(e.target.checked)} style={{ marginTop: 3 }} />
              <span style={{ fontSize: '0.84rem' }}>
                <strong>Recent tweets on X</strong> — people who tweeted these terms in the last 7 days.
                <span style={{ color: 'var(--color-text-light)' }}> Only catches active tweeters.</span>
              </span>
            </label>
            <div>
              <label className="form-label" style={{ fontSize: '0.84rem', fontWeight: 600 }}>
                Followers of these X accounts <span style={{ color: 'var(--color-text-light)', fontWeight: 400 }}>(optional — finds profiles even if they don't tweet)</span>
              </label>
              <input className="form-control" value={hubText} placeholder="@AADskin, @JAMADerm, @IADVL_Official"
                onChange={(e) => setHubText(e.target.value)} />
              <small style={{ color: 'var(--color-text-light)', fontSize: '0.76rem' }}>
                You don't need a follower list — just name the accounts. Put in a few society /
                journal / KOL handles for your area and their followers &amp; following are scanned for
                you, then filtered by bio (using the Therapeutic Area's keywords) to your City/State.
                Leave blank to skip.
              </small>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <button className="btn btn-primary" onClick={runScrape} disabled={running}>
              {running ? <><Loader size={15} className="spinning" /> Searching…</> : <><Search size={15} /> Search</>}
            </button>
            <label style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              Max results
              <select className="form-control" style={{ width: 80, padding: '4px 8px' }}
                value={criteria.limit} onChange={(e) => set('limit', Number(e.target.value))}>
                {[20, 40, 60, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>

          {result && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                  {result.count} found · {pickedList.length} selected
                </span>
                {result.count === 0 && <span style={{ fontSize: '0.82rem', color: 'var(--color-text-light)' }}>Try broader terms, or tick the Practo directory for full city coverage.</span>}
              </div>
              {(result.notes || []).map((n) => (
                <div key={n} style={{ fontSize: '0.8rem', color: 'var(--color-warning)', marginBottom: 8 }}>{n}</div>
              ))}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflow: 'auto' }}>
                {result.candidates.map((c) => {
                  const isPicked = !!picked[c.key];
                  const isPracto = c.source === 'practo';
                  const isX = c.source === 'x';
                  return (
                    <label key={c.key} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8,
                      border: '1px solid', borderColor: isPicked ? 'var(--color-primary)' : 'var(--color-border)',
                      background: c.already_known ? 'var(--color-bg)' : isPicked ? 'var(--color-primary-bg)' : 'var(--color-surface)',
                      cursor: c.already_known ? 'not-allowed' : 'pointer', opacity: c.already_known ? 0.6 : 1,
                    }}>
                      <input type="checkbox" checked={isPicked} disabled={c.already_known}
                        onChange={() => toggle(c.key)} style={{ marginTop: 3 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.name || c.x_username}</span>
                          {c.x_verified && <BadgeCheck size={13} style={{ color: '#1DA1F2' }} />}
                          <SourceBadge source={c.source} />
                          <a href={c.profile_url} target="_blank" rel="noreferrer"
                            style={{ fontSize: '0.8rem', color: '#1DA1F2', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 2 }}
                            onClick={(e) => e.stopPropagation()}>
                            {isX ? `@${c.x_username}` : isPracto ? 'Profile' : c.source === 'ctri' ? 'Latest trial'
                              : c.source === 'pubmed' ? 'Papers' : c.source === 'ctgov' ? 'Trials'
                                : c.profile_url?.includes('#') ? 'List page' : 'Page'} <ExternalLink size={10} />
                          </a>
                          {c.already_known && <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-text-light)', background: 'var(--color-border)', padding: '1px 7px', borderRadius: 999 }}>Already added</span>}
                          {c.practo_registration_verified && (
                            <span title={c.practo_registration} style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-success-text)', background: 'var(--color-success-bg)', padding: '1px 7px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              <BadgeCheck size={9} /> Reg. verified
                            </span>
                          )}
                          {c.suggested_influence_level && !c.already_known && (
                            <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-primary)', background: 'var(--color-primary-bg)', padding: '1px 7px', borderRadius: 999 }}>{c.suggested_influence_level}</span>
                          )}
                        </div>

                        {/* Specialty → subspecialty, and where they practise. */}
                        {(c.specialty || c.institution) && (
                          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                            {[c.specialty, c.subspecialty].filter(Boolean).join(' · ')}
                            {c.institution && <span style={{ color: 'var(--color-text-light)' }}> — {c.institution}</span>}
                            {c.designation && <span style={{ color: 'var(--color-text-light)' }}> · {c.designation}</span>}
                          </div>
                        )}
                        {c.bio && <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{c.bio}</div>}

                        <div style={{ display: 'flex', gap: 12, marginTop: 3, fontSize: '0.75rem', color: 'var(--color-text-light)', flexWrap: 'wrap' }}>
                          {c.location && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><MapPin size={10} /> {[c.location, c.postal_code].filter(Boolean).join(' ')}</span>}
                          {/* Followers are an X signal; Practo has none, so show practice detail instead. */}
                          {isX && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Users size={10} /> {fmtFollowers(c.x_followers)} followers</span>}
                          {c.experience_years != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Briefcase size={10} /> {c.experience_years} yrs experience</span>}
                          {c.ctri_trial_count != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><FlaskConical size={10} /> {c.ctri_trial_count} CTRI trial{c.ctri_trial_count === 1 ? '' : 's'}{c.ctri_pi_count ? ` (${c.ctri_pi_count} as PI)` : ''}</span>}
                          {c.practo_rating != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Star size={10} /> {c.practo_rating}% ({c.practo_reviews_count ?? 0})</span>}
                          {isPracto && c.practo_fee != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><IndianRupee size={10} />{c.practo_fee}</span>}
                          {c.email && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Mail size={10} /> {c.email}</span>}
                          {c.contact_no && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Phone size={10} /> {c.contact_no}</span>}
                          {c.discovered_via && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              · {c.discovered_via.startsWith('tweet') ? 'via recent tweet' : `via ${c.discovered_via}`}
                            </span>
                          )}
                        </div>

                        {/* Degrees are the clearest evidence a listing is a real KOL. */}
                        {c.practo_qualifications?.length > 0 && (
                          <div title={c.practo_qualifications.join('\n')}
                            style={{ fontSize: '0.73rem', color: 'var(--color-text-light)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <GraduationCap size={10} style={{ verticalAlign: -1 }} /> {c.practo_qualifications.join(' · ')}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" onClick={submit} disabled={submitting || pickedList.length === 0}>
                  {submitting ? <><Loader size={14} className="spinning" /> Sending…</> : <><Send size={14} /> Send {pickedList.length} for Approval</>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Details modal for one pending record
// ─────────────────────────────────────────────────────────
const STATUS_STYLE = {
  pending: { label: 'Pending', color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
  approved: { label: 'Approved', color: 'var(--color-success)', bg: 'var(--color-success-bg)' },
  rejected: { label: 'Rejected', color: 'var(--color-error)', bg: 'var(--color-error-bg)' },
};

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
};

// One label/value line. Renders nothing when there is no value, so a section
// collapses instead of showing a column of dashes.
const Row = ({ label, children }) => {
  if (children == null || children === '' || children === false) return null;
  return (
    <div style={{ display: 'flex', gap: 10, padding: '5px 0', fontSize: '0.82rem', alignItems: 'baseline' }}>
      <span style={{ flex: '0 0 132px', color: 'var(--color-text-light)' }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>{children}</span>
    </div>
  );
};

const Section = ({ title, children }) => {
  // Hide a section whose every Row collapsed, rather than leaving a bare heading.
  const kids = React.Children.toArray(children).filter(Boolean);
  const empty = kids.every((k) => {
    const v = k?.props?.children;
    return v == null || v === '' || v === false;
  });
  if (kids.length === 0 || empty) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
        color: 'var(--color-text-secondary)', marginBottom: 4, paddingBottom: 4,
        borderBottom: '1px solid var(--color-border-light)' }}>
        {title}
      </div>
      {kids}
    </div>
  );
};

// Steps shown while enrichment runs, matching the backend's ENRICHMENT_STEPS.
const ENRICH_STEPS = ['PubMed publications', 'ClinicalTrials.gov', 'Google Scholar', 'Search links'];

// The publications / trials / scholar block for one record. Shared with the
// directory's KOL details modal — both pending and directory rows carry the same
// enrichment_status / enrichment / enrichment_updated_at fields.
export function EnrichmentView({ record: p, onRefresh, refreshing }) {
  const status = p.enrichment_status || 'none';
  const e = p.enrichment || null;
  const pm = e?.pubmed || {};
  const ct = e?.clinical_trials || {};
  const sc = e?.scholar || {};
  const links = e?.links || {};

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-secondary)' }}>
        Publications &amp; Trials
      </span>
      {status !== 'running' && (
        <button className="btn btn-sm btn-ghost" onClick={onRefresh} disabled={refreshing}
          style={{ fontSize: '0.72rem' }} title="Re-run PubMed / ClinicalTrials.gov / Scholar">
          <RefreshCw size={12} className={refreshing ? 'spinning' : ''} /> {status === 'none' ? 'Fetch' : 'Refresh'}
        </button>
      )}
    </div>
  );

  if (status === 'running') {
    return (
      <div style={{ marginBottom: 16 }}>
        {header}
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Loader size={14} className="spinning" /> Gathering research footprint…
        </div>
        <div style={{ fontSize: '0.74rem', color: 'var(--color-text-light)', marginTop: 4 }}>
          {ENRICH_STEPS.join(' · ')}
        </div>
      </div>
    );
  }

  if (status === 'none') {
    return (
      <div style={{ marginBottom: 16 }}>
        {header}
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-light)' }}>
          Not fetched yet. Click <strong>Fetch</strong> to pull publications from PubMed, trials from
          ClinicalTrials.gov, and guideline authorship from Google Scholar.
        </div>
      </div>
    );
  }

  // done / error — an errored source still shows what the others returned.
  const last = pm.last_published;
  return (
    <div style={{ marginBottom: 16 }}>
      {header}

      {/* PubMed */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
          <FileText size={12} /> PubMed
          {links.pubmed && <a href={links.pubmed} target="_blank" rel="noreferrer" style={{ color: '#1DA1F2' }}><LinkIcon size={10} /></a>}
        </div>
        {pm.error ? (
          <div style={{ fontSize: '0.76rem', color: 'var(--color-text-light)' }}>Could not reach PubMed ({pm.error}).</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: '0.8rem' }}>
              <span><strong>{pm.total_count ?? 0}</strong> publications</span>
              {pm.recent_per_year_3yr != null && <span><strong>{pm.recent_per_year_3yr}</strong>/yr (last 3y)</span>}
              {pm.first_seen_year && pm.latest_year && <span>{pm.first_seen_year}–{pm.latest_year}</span>}
              {last?.human && <span>Last: <strong>{last.human}</strong>{last.precision !== 'day' ? ' (approx.)' : ''}</span>}
            </div>
            {(pm.articles || []).length > 0 && (
              <ul style={{ margin: '5px 0 0', paddingLeft: 16, fontSize: '0.76rem', color: 'var(--color-text-secondary)' }}>
                {pm.articles.slice(0, 6).map((a, i) => (
                  <li key={i} style={{ marginBottom: 2 }}>
                    <a href={a.url} target="_blank" rel="noreferrer" style={{ color: 'var(--color-text-primary)', textDecoration: 'none' }}>
                      {a.title || 'Untitled'}
                    </a>
                    <span style={{ color: 'var(--color-text-light)' }}> — {a.journal || '—'}{a.date || a.year ? `, ${a.date || a.year}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            {pm.affiliation_used && (
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-light)', marginTop: 3 }}>
                Name-matched, filtered by “{pm.affiliation_used}”. Verify it’s the same person.
              </div>
            )}
          </>
        )}
      </div>

      {/* ClinicalTrials.gov */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
          <FlaskConical size={12} /> ClinicalTrials.gov
          {links.clinicaltrials && <a href={links.clinicaltrials} target="_blank" rel="noreferrer" style={{ color: '#1DA1F2' }}><LinkIcon size={10} /></a>}
        </div>
        {ct.error ? (
          <div style={{ fontSize: '0.76rem', color: 'var(--color-text-light)' }}>Could not reach ClinicalTrials.gov ({ct.error}).</div>
        ) : (
          <>
            <div style={{ fontSize: '0.8rem' }}>
              <strong>{ct.total_count ?? 0}</strong> trials{ct.as_lead_count ? <> · <strong>{ct.as_lead_count}</strong> as lead</> : null}
            </div>
            {(ct.trials || []).length > 0 && (
              <ul style={{ margin: '5px 0 0', paddingLeft: 16, fontSize: '0.76rem', color: 'var(--color-text-secondary)' }}>
                {ct.trials.slice(0, 5).map((t, i) => (
                  <li key={i} style={{ marginBottom: 2 }}>
                    <a href={`https://clinicaltrials.gov/study/${t.nct_id}`} target="_blank" rel="noreferrer" style={{ color: 'var(--color-text-primary)', textDecoration: 'none' }}>
                      {t.title || t.nct_id}
                    </a>
                    <span style={{ color: 'var(--color-text-light)' }}> — {t.status}{t.is_lead_investigator ? ', lead' : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Google Scholar (best-effort) */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
          <BookOpen size={12} /> Google Scholar
          {links.google_scholar && <a href={links.google_scholar} target="_blank" rel="noreferrer" style={{ color: '#1DA1F2' }}><LinkIcon size={10} /></a>}
        </div>
        {sc.error === 'unavailable' || sc.error ? (
          <div style={{ fontSize: '0.76rem', color: 'var(--color-text-light)' }}>
            Scholar blocks automated access — use the link above to check manually.
          </div>
        ) : (
          <div style={{ fontSize: '0.8rem' }}>
            {sc.intl_guidelines || sc.national_guidelines
              ? <span><CheckCircle2 size={12} style={{ verticalAlign: -2, color: 'var(--color-success)' }} /> {[sc.intl_guidelines && 'international', sc.national_guidelines && 'national'].filter(Boolean).join(' & ')} guideline authorship found</span>
              : <span style={{ color: 'var(--color-text-light)' }}>No guideline / consensus authorship detected.</span>}
          </div>
        )}
      </div>

      {/* Manual links */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: '0.76rem' }}>
        {links.google && <a href={links.google} target="_blank" rel="noreferrer" style={{ color: '#1DA1F2', display: 'inline-flex', alignItems: 'center', gap: 3 }}>Google <LinkIcon size={10} /></a>}
        {links.google_scholar && <a href={links.google_scholar} target="_blank" rel="noreferrer" style={{ color: '#1DA1F2', display: 'inline-flex', alignItems: 'center', gap: 3 }}>Scholar <LinkIcon size={10} /></a>}
        {links.pubmed && <a href={links.pubmed} target="_blank" rel="noreferrer" style={{ color: '#1DA1F2', display: 'inline-flex', alignItems: 'center', gap: 3 }}>PubMed <LinkIcon size={10} /></a>}
      </div>

      {p.enrichment_updated_at && (
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-light)', marginTop: 6 }}>
          Fetched {fmtDate(p.enrichment_updated_at)}
        </div>
      )}
    </div>
  );
}

export function DetailsModal({ record: p, onClose, onEnrich, enriching }) {
  if (!p) return null;
  const st = STATUS_STYLE[p.status] || STATUS_STYLE.pending;
  const name = kolName(p) || p.x_name || p.x_username || '—';
  // The scrape packs everything without a column of its own into notes as
  // "A | B | C" — split it back out so it reads as a list, not a wall of text.
  const noteParts = (p.notes || '').split('|').map((s) => s.trim()).filter(Boolean);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {name}
            <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '1px 8px', borderRadius: 999, background: st.bg, color: st.color }}>{st.label}</span>
            <SourceBadge source={p.source} size="0.66rem" />
          </h3>
          <button className="modal-close" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ overflow: 'auto' }}>
          <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: '10px 12px', marginBottom: 16, background: 'var(--color-bg)' }}>
            <EnrichmentView record={p} onRefresh={onEnrich} refreshing={enriching} />
          </div>

          {p.ctri && (
            <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: '10px 12px', marginBottom: 16, background: 'var(--color-bg)' }}>
              <CTRITrialsView record={p} />
            </div>
          )}

          <Section title="Professional">
            <Row label="Specialty">{p.specialty}</Row>
            <Row label="Subspecialty">{p.subspecialty}</Row>
            <Row label="Institution">{p.institution}</Row>
            <Row label="Designation">{p.designation}</Row>
            <Row label="Total experience">{p.experience_years != null ? `${p.experience_years} years` : null}</Row>
            <Row label="Therapeutic area">{p.therapeutic_area}</Row>
            <Row label="Influence level">{p.influence_level}</Row>
            <Row label="Functional expertise">{p.functional_expertise}</Row>
          </Section>

          <Section title="Contact">
            <Row label="Email">{p.email}</Row>
            <Row label="Phone">{p.contact_no}</Row>
            {/* Say why it's blank — neither source publishes contact details, so an
                empty section otherwise reads as a scrape failure. */}
            <Row label="">
              {!p.email && !p.contact_no && (
                <span style={{ color: 'var(--color-text-light)', fontStyle: 'italic' }}>
                  No contact published. Their own page, PubMed, ClinicalTrials.gov, X and a web
                  search by name were checked after the scrape; select the row and use Find contacts to retry.
                </span>
              )}
            </Row>
          </Section>

          <Section title="Location">
            <Row label="State / City">{p.state_city}</Row>
            <Row label="Country">{p.geographic_zone}</Row>
            <Row label="Profile location">{p.x_location}</Row>
          </Section>

          <Section title="Source">
            <Row label="Found via">{{ practo: 'Practo directory', google: 'Google search', ctri: 'CTRI (Clinical Trials Registry - India)' }[p.source] || 'X (Twitter)'}</Row>
            <Row label="X handle">
              {p.x_username && (
                <a href={p.x_profile_url || `https://x.com/${p.x_username}`} target="_blank" rel="noreferrer"
                  style={{ color: '#1DA1F2', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  @{p.x_username} <ExternalLink size={10} />
                </a>
              )}
            </Row>
            <Row label="Followers">{p.x_followers != null ? fmtFollowers(p.x_followers) : null}</Row>
            <Row label="Practo profile">
              {p.practo_profile_url && (
                <a href={p.practo_profile_url} target="_blank" rel="noreferrer"
                  style={{ color: 'var(--color-accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  Open profile <ExternalLink size={10} />
                </a>
              )}
            </Row>
            <Row label="Web page">
              {p.web_profile_url && (
                <a href={p.web_profile_url} target="_blank" rel="noreferrer"
                  style={{ color: 'var(--color-success)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  Open page <ExternalLink size={10} />
                </a>
              )}
            </Row>
          </Section>

          <Section title="Bio">
            <Row label="">{p.x_bio && <span style={{ whiteSpace: 'pre-wrap' }}>{p.x_bio}</span>}</Row>
          </Section>

          <Section title="Scraped details">
            <Row label="">
              {noteParts.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {noteParts.map((n, i) => <li key={i} style={{ marginBottom: 2 }}>{n}</li>)}
                </ul>
              )}
            </Row>
          </Section>

          <Section title="Record">
            <Row label="Status">{st.label}</Row>
            <Row label="Review note">{p.review_notes}</Row>
            <Row label="In directory">{p.kol_id ? `Yes (KOL #${p.kol_id})` : null}</Row>
            <Row label="Added">{fmtDate(p.created_at)}</Row>
            <Row label="Updated">{fmtDate(p.updated_at)}</Row>
          </Section>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Pending verification queue
// ─────────────────────────────────────────────────────────
const PENDING_PAGE_SIZE = 100;
const PENDING_SOURCE_LABELS = {
  practo: 'Practo', google: 'Google', pubmed: 'PubMed', ctgov: 'ClinicalTrials.gov', ctri: 'CTRI', twitter: 'X',
};

export function PendingPanel({ isAdmin, onChanged, onNotice }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  // The queue can hold tens of thousands of rows after a bulk import — it is read a
  // page at a time and narrowed by source / area / country / name.
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState({ source: [], therapeutic_area: [], geographic_zone: [] });
  const [narrow, setNarrow] = useState({ source: '', therapeutic_area: '', geographic_zone: '' });
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim()), 350);
    return () => clearTimeout(t);
  }, [searchText]);
  useEffect(() => { setPage(0); }, [filter, narrow, search]);
  useEffect(() => {
    getPendingKOLFacets(filter || undefined).then((r) => setFacets(r.data)).catch(() => {});
  }, [filter, total]);
  const pageParams = useCallback(() => {
    const params = { skip: page * PENDING_PAGE_SIZE, limit: PENDING_PAGE_SIZE };
    Object.entries(narrow).forEach(([k, v]) => { if (v) params[k] = v; });
    if (search) params.search = search;
    return params;
  }, [page, narrow, search]);
  const [busy, setBusy] = useState(null);
  const [detailsId, setDetailsId] = useState(null);   // id of the record in the modal
  const [enrichingId, setEnrichingId] = useState(null);
  // Bulk delete — ids ticked in the list; cleared when the status filter changes.
  const [checked, setChecked] = useState(() => new Set());
  const [deletingBulk, setDeletingBulk] = useState(false);
  useEffect(() => { setChecked(new Set()); }, [filter, page, narrow, search]);

  // A refresh that doesn't flip the whole panel into its loading spinner — used by
  // the enrichment poller so the list doesn't flicker every few seconds.
  const loadQuiet = useCallback(async () => {
    try {
      const res = await listPendingKOLs(filter || undefined, pageParams());
      setItems(res.data.items || []);
      setTotal(res.data.total ?? 0);
    } catch {
      onNotice?.('Failed to load pending KOLs.');
    }
  }, [filter, pageParams, onNotice]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listPendingKOLs(filter || undefined, pageParams());
      setItems(res.data.items || []);
      setTotal(res.data.total ?? 0);
    } catch {
      onNotice?.('Failed to load pending KOLs.');
    } finally {
      setLoading(false);
    }
  }, [filter, pageParams, onNotice]);

  useEffect(() => { load(); }, [load]);

  // Enrichment runs in the background; poll while any row is still 'running' so the
  // progress bar advances and results appear without a manual refresh.
  const runningCount = items.filter((i) => i.enrichment_status === 'running').length;
  useEffect(() => {
    if (runningCount === 0) return undefined;
    const t = setInterval(loadQuiet, 2500);
    return () => clearInterval(t);
  }, [runningCount, loadQuiet]);

  // The live record for the modal — from items, so polling updates flow into an
  // open modal (e.g. status running -> done) instead of a frozen snapshot.
  const detailRecord = detailsId != null ? items.find((i) => i.id === detailsId) || null : null;

  const runEnrich = async (id) => {
    setEnrichingId(id);
    try {
      await enrichPendingKOL(id);
      await loadQuiet();
    } catch (e) {
      onNotice?.(e.response?.data?.detail || 'Could not start enrichment.');
    } finally {
      setEnrichingId(null);
    }
  };

  const toggleChecked = (id) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allChecked = items.length > 0 && items.every((i) => checked.has(i.id));
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(items.map((i) => i.id)));

  // Only rows still pending can be approved; others in the selection are skipped.
  const checkedPending = items.filter((i) => checked.has(i.id) && i.status === 'pending').map((i) => i.id);
  const approveChecked = async () => {
    const n = checkedPending.length;
    if (!n || !window.confirm(`Approve ${n} KOL${n === 1 ? '' : 's'} and add ${n === 1 ? 'it' : 'them'} to the KOL directory?`)) return;
    setDeletingBulk(true);
    try {
      await approvePendingKOLsBulk(checkedPending);
      onNotice?.(`Approved ${n} KOL${n === 1 ? '' : 's'} — added to the KOL directory.`, 'success');
      setChecked(new Set());
      await load();
      onChanged?.();
    } catch (e) {
      onNotice?.(e.response?.data?.detail || 'Failed to approve the selected KOLs.');
    } finally {
      setDeletingBulk(false);
    }
  };

  // A Google link ending in "#name-slug" is the listing page the name was read
  // from ("Best Paediatricians in Meerut"), not the doctor's own page.
  const isListing = (p) => !!p.web_profile_url && p.web_profile_url.includes('#');
  const checkedListing = items.filter((i) => checked.has(i.id) && isListing(i)).map((i) => i.id);
  const [findingId, setFindingId] = useState(null);

  const findOwnPage = async (p) => {
    setFindingId(p.id);
    try {
      const r = await findPendingOwnPage(p.id);
      onNotice?.(`Found ${kolName(p)}'s own page`
        + (r.data.experience_years && !p.experience_years ? ` — ${r.data.experience_years} yrs experience.` : '.'), 'success');
      await loadQuiet();
    } catch (e) {
      onNotice?.(e.response?.data?.detail || 'Could not find their own page.');
    } finally {
      setFindingId(null);
    }
  };

  const findOwnPages = async () => {
    const n = checkedListing.length;
    const useSearch = window.confirm(
      `Find the own page of ${n} doctor${n === 1 ? '' : 's'} linked to a list.\n\n`
      + 'First each list is re-opened and the link next to the name is followed (free).\n'
      + `OK = also web-search the ones still unresolved (up to ${n} SerpAPI search${n === 1 ? '' : 'es'}).\n`
      + 'Cancel = free step only.');
    try {
      const r = await findPendingOwnPages(checkedListing, useSearch);
      onNotice?.(`Finding own pages for ${r.data.queued} KOL${r.data.queued === 1 ? '' : 's'} in the background — links and experience update shortly.`, 'success');
      setChecked(new Set());
      setTimeout(loadQuiet, 8000);
      setTimeout(loadQuiet, 25000);
    } catch (e) {
      onNotice?.(e.response?.data?.detail || 'Could not start.');
    }
  };

  // Rows still missing an email or phone — looked up automatically after a scrape;
  // this re-runs it (older rows, or a retry).
  const checkedNoContact = items.filter((i) => checked.has(i.id) && !(i.email && i.contact_no)).map((i) => i.id);
  const findContacts = async () => {
    try {
      const r = await findPendingContacts(checkedNoContact);
      onNotice?.(`Looking up contact details for ${r.data.queued} KOL${r.data.queued === 1 ? '' : 's'} in the background — email and phone fill in shortly.`, 'success');
      setChecked(new Set());
      setTimeout(loadQuiet, 15000);
      setTimeout(loadQuiet, 45000);
      setTimeout(loadQuiet, 120000);
    } catch (e) {
      onNotice?.(e.response?.data?.detail || 'Could not start.');
    }
  };

  const deleteChecked = async () => {
    const n = checked.size;
    if (!n || !window.confirm(`Remove ${n} KOL${n === 1 ? '' : 's'} from pending verification? This cannot be undone.`)) return;
    setDeletingBulk(true);
    try {
      const res = await deletePendingKOLsBulk([...checked]);
      const deleted = res.data.deleted ?? 0;
      onNotice?.(`Removed ${deleted} KOL${deleted === 1 ? '' : 's'}`
        + (deleted < n ? ` — ${n - deleted} could not be removed (not yours or already gone).` : '.'), 'success');
      setChecked(new Set());
      await load();
      onChanged?.();
    } catch (e) {
      onNotice?.(e.response?.data?.detail || 'Failed to remove the selected KOLs.');
    } finally {
      setDeletingBulk(false);
    }
  };

  const act = async (fn, id, okMsg) => {
    setBusy(id);
    try {
      await fn(id);
      setChecked((prev) => { const next = new Set(prev); next.delete(id); return next; });
      onNotice?.(okMsg, 'success');
      await load();
      onChanged?.();
    } catch (e) {
      onNotice?.(e.response?.data?.detail || 'Action failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {['pending', 'approved', 'rejected', ''].map((s) => (
          <button key={s || 'all'} onClick={() => setFilter(s)}
            className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-outline'}`}>
            {s ? STATUS_STYLE[s].label : 'All'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input className="form-control" placeholder="Search name, email, institution…" value={searchText}
          onChange={(e) => setSearchText(e.target.value)} style={{ flex: '1 1 220px', minWidth: 180 }} />
        {[['source', 'All sources'], ['therapeutic_area', 'All therapeutic areas'], ['geographic_zone', 'All countries']].map(([key, all]) => (
          <select key={key} className="form-control" value={narrow[key]} style={{ flex: '0 1 220px' }}
            onChange={(e) => setNarrow((n) => ({ ...n, [key]: e.target.value }))}>
            <option value="">{all}</option>
            {(facets[key] || []).map((f) => (
              <option key={f.value} value={f.value}>
                {(key === 'source' ? PENDING_SOURCE_LABELS[f.value] || f.value : f.value)} ({f.count})
              </option>
            ))}
          </select>
        ))}
      </div>

      {/* Enrichment progress — visible while any record is still being enriched. */}
      {runningCount > 0 && (() => {
        const total = items.length || 1;
        const done = total - runningCount;
        const pct = Math.round((done / total) * 100);
        return (
          <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: 'var(--color-info-bg)', border: '1px solid var(--color-info-bg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: 'var(--color-info-text)', marginBottom: 6 }}>
              <Loader size={14} className="spinning" />
              Fetching publications &amp; trials — {done} of {total} done, {runningCount} in progress…
            </div>
            <div style={{ height: 6, borderRadius: 999, background: 'var(--color-info-bg)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-info)', transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-info)', marginTop: 4 }}>
              PubMed · ClinicalTrials.gov · Google Scholar
            </div>
          </div>
        );
      })()}

      {loading ? (
        <div className="loading-container"><div className="spinner" /><p>Loading…</p></div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          <Clock size={40} style={{ color: 'var(--color-border-strong)', marginBottom: 10 }} />
          <p style={{ margin: 0 }}>Nothing {filter || 'here'} yet. Use Scrape data and send candidates for approval.</p>
        </div>
      ) : (
        <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, minHeight: 32, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
            fontSize: '0.82rem', color: 'var(--color-text-secondary)', userSelect: 'none' }}>
            <input type="checkbox" checked={allChecked} onChange={toggleAll} style={{ width: 15, height: 15, cursor: 'pointer' }} />
            Select all{total > PENDING_PAGE_SIZE ? ' on this page' : ''}
          </label>
          {checked.size > 0 && (
            <>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text)' }}>{checked.size} selected</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setChecked(new Set())}>Clear</button>
              {checkedNoContact.length > 0 && (
                <button className="btn btn-sm btn-outline" onClick={findContacts} disabled={deletingBulk} style={{ marginLeft: 'auto' }}
                  title="Look up each doctor's published email and phone — their page, PubMed, ClinicalTrials.gov, X and a web search, in parallel">
                  <Mail size={14} /> Find contacts ({checkedNoContact.length})
                </button>
              )}
              {checkedListing.length > 0 && (
                <button className="btn btn-sm btn-outline" onClick={findOwnPages} disabled={deletingBulk}
                  style={{ marginLeft: checkedNoContact.length > 0 ? 0 : 'auto' }}
                  title="Replace list links with each doctor's own page (and read their experience from it)">
                  <Globe size={14} /> Find own pages ({checkedListing.length})
                </button>
              )}
              {checkedPending.length > 0 && (
                <button className="btn btn-sm btn-primary" onClick={approveChecked} disabled={deletingBulk}
                  style={{ marginLeft: checkedListing.length > 0 || checkedNoContact.length > 0 ? 0 : 'auto' }}>
                  <ThumbsUp size={14} /> Approve selected ({checkedPending.length})
                </button>
              )}
              <button className="btn btn-sm" onClick={deleteChecked} disabled={deletingBulk}
                style={{ marginLeft: checkedPending.length > 0 || checkedListing.length > 0 || checkedNoContact.length > 0 ? 0 : 'auto', background: 'var(--color-error)', color: 'var(--color-text-inverse)', border: 'none' }}>
                {deletingBulk ? <Loader size={14} className="spinning" /> : <Trash2 size={14} />}
                {' '}Delete selected ({checked.size})
              </button>
            </>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((p) => {
            const st = STATUS_STYLE[p.status] || STATUS_STYLE.pending;
            const name = kolName(p) || p.x_name || p.x_username;
            return (
              <div key={p.id} className="card" style={{
                padding: 14, display: 'flex', alignItems: 'flex-start', gap: 12,
                ...(checked.has(p.id) && { outline: '2px solid var(--color-primary)', outlineOffset: -1 }),
              }}>
                <input type="checkbox" checked={checked.has(p.id)} onChange={() => toggleChecked(p.id)}
                  aria-label={`Select ${name}`} style={{ width: 15, height: 15, marginTop: 3, flexShrink: 0, cursor: 'pointer' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>{name}</span>
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '1px 8px', borderRadius: 999, background: st.bg, color: st.color }}>{st.label}</span>
                    {p.x_username && (
                      <a href={p.x_profile_url || `https://x.com/${p.x_username}`} target="_blank" rel="noreferrer"
                        style={{ fontSize: '0.78rem', color: '#1DA1F2', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <Twitter size={11} /> @{p.x_username} <ExternalLink size={9} />
                      </a>
                    )}
                    {p.practo_profile_url && (
                      <a href={p.practo_profile_url} target="_blank" rel="noreferrer"
                        style={{ fontSize: '0.78rem', color: 'var(--color-accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <Stethoscope size={11} /> Practo <ExternalLink size={9} />
                      </a>
                    )}
                    {p.web_profile_url && (
                      <a href={p.web_profile_url} target="_blank" rel="noreferrer"
                        title={isListing(p) ? 'A list page that names this doctor — not their own page' : 'The doctor\'s own page'}
                        style={{ fontSize: '0.78rem', color: 'var(--color-success)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <Globe size={11} /> Google{isListing(p) ? ' · list' : ''} <ExternalLink size={9} />
                      </a>
                    )}
                    {isListing(p) && (
                      <button className="btn btn-sm btn-ghost" disabled={findingId === p.id} onClick={() => findOwnPage(p)}
                        title="Search this doctor by name and switch the link to their own page (1 web search)"
                        style={{ fontSize: '0.72rem', padding: '1px 6px' }}>
                        {findingId === p.id ? <Loader size={11} className="spinning" /> : 'Find own page'}
                      </button>
                    )}
                    {p.experience_years != null && (
                      <span style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Briefcase size={10} /> {p.experience_years} yrs
                      </span>
                    )}
                    {p.influence_level &&<span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-primary)', background: 'var(--color-primary-bg)', padding: '1px 7px', borderRadius: 999 }}>{p.influence_level}</span>}
                  </div>
                  {p.x_bio && <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: 3 }}>{p.x_bio}</div>}
                  <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: '0.75rem', color: 'var(--color-text-light)', flexWrap: 'wrap' }}>
                    {p.therapeutic_area && <span>{p.therapeutic_area}</span>}
                    {p.specialty && <span>{[p.specialty, p.subspecialty].filter(Boolean).join(' · ')}</span>}
                    {p.institution && <span>{p.institution}</span>}
                    {p.state_city && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><MapPin size={10} /> {p.state_city}</span>}
                    {p.email && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Mail size={10} /> {p.email}</span>}
                    {p.contact_no && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Phone size={10} /> {p.contact_no}</span>}
                    {p.x_followers != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Users size={10} /> {fmtFollowers(p.x_followers)}</span>}
                    {p.enrichment_status === 'running' && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--color-info)' }}>
                        <Loader size={10} className="spinning" /> fetching publications…
                      </span>
                    )}
                    {p.enrichment_status === 'done' && p.enrichment?.pubmed && !p.enrichment.pubmed.error && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--color-success-text)' }}>
                        <FileText size={10} /> {p.enrichment.pubmed.total_count ?? 0} pubs
                        {p.enrichment.pubmed.last_published?.human ? ` · last ${p.enrichment.pubmed.last_published.human}` : ''}
                      </span>
                    )}
                    {p.ctri?.trial_count > 0 && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--color-violet)' }}>
                        <ClipboardList size={10} /> {p.ctri.trial_count} CTRI trial{p.ctri.trial_count === 1 ? '' : 's'}
                      </span>
                    )}
                    {p.enrichment_status === 'done' && (p.enrichment?.clinical_trials?.total_count > 0) && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--color-success-text)' }}>
                        <FlaskConical size={10} /> {p.enrichment.clinical_trials.total_count} trials
                      </span>
                    )}
                  </div>
                  {p.notes && (
                    <div title={p.notes} style={{ fontSize: '0.73rem', color: 'var(--color-text-light)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.notes}
                    </div>
                  )}
                  {p.review_notes && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', marginTop: 4, fontStyle: 'italic' }}>Note: {p.review_notes}</div>}
                </div>

                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {/* Every record, whatever its status — the row is a summary, this
                      shows everything the scrape captured. */}
                  <button className="btn btn-sm btn-outline" onClick={() => setDetailsId(p.id)} title="View full details">
                    <Info size={13} /> Details
                  </button>
                  {/* The account that scraped a KOL approves it; admins can approve anyone's. */}
                  {p.status === 'pending' && (
                    <>
                      <button className="btn btn-sm btn-primary" disabled={busy === p.id}
                        onClick={() => act((id) => approvePendingKOL(id), p.id, 'Approved — added to KOL directory.')}>
                        <ThumbsUp size={13} /> Approve
                      </button>
                      <button className="btn btn-sm btn-outline" disabled={busy === p.id}
                        onClick={() => act((id) => rejectPendingKOL(id), p.id, 'Rejected.')}>
                        <ThumbsDown size={13} /> Reject
                      </button>
                    </>
                  )}
                  <button className="btn btn-sm btn-ghost" title="Remove" disabled={busy === p.id}
                    onClick={() => act((id) => deletePendingKOL(id), p.id, 'Removed.')}
                    style={{ color: 'var(--color-text-light)' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {total > PENDING_PAGE_SIZE && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 12, fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
            <span>{page * PENDING_PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PENDING_PAGE_SIZE)} of {total.toLocaleString()}</span>
            <button className="btn btn-sm btn-outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button className="btn btn-sm btn-outline" disabled={(page + 1) * PENDING_PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
        </>
      )}

      {detailRecord && (
        <DetailsModal
          record={detailRecord}
          onClose={() => setDetailsId(null)}
          onEnrich={() => runEnrich(detailRecord.id)}
          enriching={enrichingId === detailRecord.id || detailRecord.enrichment_status === 'running'}
        />
      )}
    </div>
  );
}
