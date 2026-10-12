import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Upload, AlertCircle, CheckCircle, FileText, X, Brain, Loader, User, Stethoscope, MapPin, Briefcase, Clock, BookOpen, Mic, Users, Award, BadgeCheck, Landmark, Plus, Trash2, Mail, Phone, Book, Crown, ClipboardList, ShieldCheck, Download } from 'lucide-react';
import { createHCP, updateHCP, getHCP, uploadCV, uploadConsent, downloadCV, downloadConsent, scoreWithAI, extractCVFields, parseRows, getMe, checkHCPDuplicate } from '../services/api';

const SCOPE_OPTIONS = [
  { value: '', label: 'Scope...' },
  { value: 'national', label: 'National' },
  { value: 'international', label: 'International' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'Status' },
  { value: 'current', label: 'Current' },
  { value: 'past', label: 'Past' },
];

const ROLE_OPTIONS = [
  { value: '', label: 'Role...' },
  { value: 'author', label: 'Author' },
  { value: 'co_author', label: 'Co-author' },
  { value: 'editor', label: 'Editor' },
  { value: 'chapter_author', label: 'Chapter Author' },
];

// The four repeatable sections. `columns` drives rendering, the blank-row shape,
// and the order fields are serialized in — so a section is described once.
// Keys match the API field names and the CV-extraction response.
const ROW_SECTIONS = {
  // Publications became rows because the rubric scores them by date and reach
  // ("1-5 peer reviewed articles in past five years", "article in international
  // peer-reviewed journals"). A free-text "7 papers" could not answer either.
  publications: {
    columns: [
      { key: 'title', placeholder: 'Article title...', width: '1.6fr' },
      { key: 'year', placeholder: 'Year...', width: '0.5fr' },
      { key: 'journal', placeholder: 'Journal...', width: '1.3fr' },
      { key: 'scope', options: SCOPE_OPTIONS, width: '1fr' },
    ],
  },
  conference_presentations: {
    columns: [
      { key: 'topic', placeholder: 'Topic...', width: '1.4fr' },
      { key: 'year', placeholder: 'Year...', width: '0.6fr' },
      { key: 'with_whom', placeholder: 'With Whom...', width: '1.2fr' },
      { key: 'scope', options: SCOPE_OPTIONS, width: '1fr' },
    ],
  },
  advisory_board: {
    columns: [
      { key: 'topic', placeholder: 'Topic...', width: '1fr' },
      { key: 'year', placeholder: 'Year...', width: '1fr' },
      { key: 'with_whom', placeholder: 'With Whom...', width: '1fr' },
    ],
  },
  textbooks: {
    columns: [
      { key: 'title', placeholder: 'Book / chapter...', width: '1.6fr' },
      { key: 'role', options: ROLE_OPTIONS, width: '1fr' },
      { key: 'year', placeholder: 'Year...', width: '0.6fr' },
    ],
  },
  faculty_positions: {
    columns: [
      { key: 'institution', placeholder: 'Institution...', width: '1.5fr' },
      { key: 'position', placeholder: 'Position...', width: '1.2fr' },
      { key: 'status', options: STATUS_OPTIONS, width: '1fr' },
      { key: 'years', placeholder: '2015-2020', width: '0.8fr' },
    ],
  },
  office_bearer_positions: {
    columns: [
      { key: 'position', placeholder: 'Position...', width: '1.2fr' },
      { key: 'organization', placeholder: 'Society...', width: '1.4fr' },
      { key: 'scope', options: SCOPE_OPTIONS, width: '1fr' },
      { key: 'year', placeholder: 'Year', width: '0.7fr' },
    ],
  },
};

const blankRow = (kind) =>
  Object.fromEntries(ROW_SECTIONS[kind].columns.map((c) => [c.key, '']));

const rowFilled = (row) => Object.values(row).some((v) => (v || '').toString().trim() !== '');
const rowsHaveData = (rows) => rows.some(rowFilled);

// A dropdown stores a machine value ('international'); the string handed to the
// API — and from there to the scoring prompt — carries the readable label.
const cellText = (col, value) => {
  const raw = (value || '').toString().trim();
  if (!col.options) return raw;
  const opt = col.options.find((o) => o.value === raw);
  return opt && opt.value ? opt.label : '';
};

// Rows go to the API as one string: fields joined by ", ", rows by " | ".
// A row holding nothing but a dropdown ("International" and no talk) is noise,
// so it is skipped — the same rule the backend normalizer applies.
// The inverse of serializeRows. Stored form is "a, b, c | a, b, c" — rows split
// on " | ", cells on ", ". Lossy by nature: a cell containing ", " cannot be
// told from a separator, so the LAST column absorbs any surplus rather than
// silently dropping text. Select columns snap back to a known option when the
// stored text matches one, so a re-opened row shows a dropdown value, not free
// text that no longer matches.
const deserializeRows = (kind, text) => {
  const spec = ROW_SECTIONS[kind];
  if (!spec || !text || !String(text).trim()) return [blankRow(kind)];
  const rows = String(text).split('|').map((chunk) => {
    const parts = chunk.split(',').map((x) => x.trim()).filter((x, i, a) => x || i < a.length - 1);
    const row = blankRow(kind);
    spec.columns.forEach((col, i) => {
      const last = i === spec.columns.length - 1;
      const value = last ? parts.slice(i).join(', ') : (parts[i] || '');
      if (!value) return;
      if (col.options) {
        const hit = col.options.find((o) => String(o).toLowerCase() === value.toLowerCase());
        row[col.key] = hit || '';
      } else {
        row[col.key] = value;
      }
    });
    return row;
  }).filter((r) => spec.columns.some((c) => (r[c.key] || '').trim()));
  return rows.length ? rows : [blankRow(kind)];
};

const serializeRows = (kind, rows) =>
  rows
    .filter((r) => ROW_SECTIONS[kind].columns.some((c) => !c.options && (r[c.key] || '').trim()))
    .map((r) => ROW_SECTIONS[kind].columns.map((c) => cellText(c, r[c.key])).filter(Boolean).join(', '))
    .filter(Boolean)
    .join(' | ');

const ICON_BTN = {
  background: 'none', border: 'none', cursor: 'pointer', padding: 4,
  color: 'var(--color-text-light)',
};
const GHOST_BTN = {
  background: 'none', border: '1px dashed var(--color-border, var(--color-border-strong))', borderRadius: 6,
  padding: '6px 10px', cursor: 'pointer', fontSize: '0.78rem',
  display: 'flex', alignItems: 'center', gap: 4, color: 'var(--color-primary)',
};

// Defined at module scope on purpose: a component declared inside the page body
// is a new type on every render, which remounts the inputs and steals focus
// mid-typing.
function RowSection({
  kind, icon: Icon, label, rows, setRows,
  pasteOpen, onTogglePaste, pasteText, onPasteText,
  pasteBusy, pasteError, onConvert, cvFallback,
}) {
  const { columns } = ROW_SECTIONS[kind];
  const gridTemplate = `${columns.map((c) => c.width || '1fr').join(' ')} auto`;

  const update = (index, key, value) =>
    setRows(rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)));

  const remove = (index) => {
    // Never leave the section empty — clearing the last row just blanks it.
    setRows(rows.length === 1 ? [blankRow(kind)] : rows.filter((_, i) => i !== index));
  };

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon size={14} /> {label}
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
        {rows.map((row, idx) => (
          <div key={idx} className="rowsection-row" style={{ display: 'grid', gridTemplateColumns: gridTemplate, gap: 8, alignItems: 'center' }}>
            {columns.map((col) => (
              col.options ? (
                <select
                  key={col.key}
                  className="form-control"
                  value={row[col.key] || ''}
                  onChange={(e) => update(idx, col.key, e.target.value)}
                >
                  {col.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  key={col.key}
                  type="text"
                  className="form-control"
                  placeholder={col.placeholder}
                  value={row[col.key] || ''}
                  onChange={(e) => update(idx, col.key, e.target.value)}
                />
              )
            ))}
            <button type="button" onClick={() => remove(idx)} style={ICON_BTN} title="Remove row">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setRows([...rows, blankRow(kind)])} style={GHOST_BTN}>
            <Plus size={12} /> Add Row
          </button>
          <button type="button" onClick={onTogglePaste} style={GHOST_BTN} title="Paste a whole list and split it into rows">
            <ClipboardList size={12} /> {pasteOpen ? 'Cancel Paste' : 'Paste List'}
          </button>
        </div>

        {pasteOpen && (
          <div style={{
            border: '1px solid var(--color-border, var(--color-border-strong))', borderRadius: 8,
            padding: 10, display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <p style={{ fontSize: '0.72rem', color: 'var(--color-text-light)', margin: 0 }}>
              Paste the whole list — one entry per line — and it will be split into rows for you.
              Existing rows are kept.
            </p>
            <textarea
              className="form-control"
              rows={5}
              placeholder={'Paste here, e.g.\nAtrial fibrillation update — ESC Congress, Amsterdam, 2023\nHeart failure panel — CSI Annual Meeting, 2022'}
              value={pasteText}
              onChange={(e) => onPasteText(e.target.value)}
              disabled={pasteBusy}
            />
            {pasteError && (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-danger, var(--color-error))', margin: 0 }}>{pasteError}</p>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onConvert}
              disabled={pasteBusy || !pasteText.trim()}
              style={{ alignSelf: 'flex-start', fontSize: '0.8rem' }}
            >
              {pasteBusy ? <Loader size={14} className="spinning" /> : <Brain size={14} />}
              {pasteBusy ? ' Splitting...' : ' Convert to Rows'}
            </button>
          </div>
        )}
      </div>
      {cvFallback && cvFallback.trim() && (
        <p style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', background: 'var(--color-surface-raised)', padding: '6px 10px', borderRadius: 6, marginTop: 6, marginBottom: 0 }}>
          <strong>From CV:</strong> {cvFallback}
        </p>
      )}
    </div>
  );
}

// The third step is the one that changes with the account's AI switch: with AI
// off the assessment is scored by the rule engine, so the progress bar must not
// announce an analysis that is not running.
const stepsFor = (aiEnabled, isExisting) => [
  // Step one creates a profile — except when this submission was recognised as
  // someone already on file, where it updates theirs instead. Saying "Creating
  // Profile" there would contradict the whole point of the duplicate check.
  { label: isExisting ? 'Updating Existing Profile' : 'Creating Profile', icon: User },
  { label: 'Uploading CV', icon: Upload },
  aiEnabled
    ? { label: 'AI + Multi-Source Analysis', icon: Brain }
    : { label: 'Rule-Based Analysis', icon: ClipboardList },
  { label: 'Scoring Complete', icon: CheckCircle },
];

// What the CV / the typed details matched on, in words a reviewer can check.
const MATCH_LABELS = {
  cv_file: 'the same CV file',
  medical_registration_no: 'medical registration number',
  email: 'email address',
  mobile: 'mobile number',
  full_name: 'name',
  city: 'city',
  institution: 'institution',
};

const TIER_LABELS = {
  GLOBAL_KOL: 'Global KOL',
  STRATEGIC_KOL: 'Strategic KOL',
  NATIONAL_KOL: 'National KOL',
  EMERGING_KOL: 'Emerging KOL',
  LOCAL_KOL: 'Local KOL',
  NON_KOL: 'Non-KOL',
};

// Shown the moment the form recognises someone already on file — before the
// user fills anything else in, and long before submitting. It has to answer
// three things at a glance: who we matched, why we think it is them, and what
// is about to happen to the existing record.
function DuplicateNotice({ match, choice, willReassess, onReassess, onCreateNew }) {
  const reasons = (match.matched_on || []).map((r) => MATCH_LABELS[r] || r).join(', ');
  const last = match.last_assessment;
  const assessedOn = last?.created_at
    ? new Date(last.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : null;
  // A strong match (same CV file, registration number, email or mobile) is
  // acted on unless the user says otherwise; a weaker one is only ever asked.
  const decided = willReassess;

  return (
    <div
      className="card"
      style={{
        maxWidth: 900, margin: '0 auto 20px', padding: '16px 18px',
        borderLeft: `4px solid var(--color-${decided ? 'primary' : 'warning'}, #d97706)`,
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <BadgeCheck size={20} style={{ color: decided ? 'var(--color-primary)' : '#d97706', flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {decided
              ? 'This HCP is already on file — no new record will be created'
              : 'This may be an HCP already on file'}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            <strong>{match.full_name || 'Unnamed HCP'}</strong>
            {match.institution ? ` — ${match.institution}` : ''}
            {match.city ? `, ${match.city}` : ''}
            {' '}(#{match.hcp_id})
            {reasons ? <> · matched on <strong>{reasons}</strong></> : null}
            <br />
            {match.assessment_count > 0 ? (
              <>
                Assessed {match.assessment_count === 1 ? 'once' : `${match.assessment_count} times`}
                {assessedOn ? `, last on ${assessedOn}` : ''}
                {last?.tier ? ` — ${TIER_LABELS[last.tier] || last.tier}` : ''}
                {last?.final_score != null ? ` (${last.final_score})` : ''}.
              </>
            ) : (
              <>Saved, but not assessed yet.</>
            )}
            <br />
            {decided
              ? 'Submitting will re-assess that record: the existing assessment is kept, a new one is added, and the audit trail records the re-assessment.'
              : 'If this is the same person, re-assess the existing record instead of adding a second one for them.'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-sm ${decided ? 'btn-primary' : 'btn-outline'}`}
              onClick={onReassess}
              disabled={choice === 'reassess' && decided}
            >
              Re-assess #{match.hcp_id}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${choice === 'new' ? 'btn-primary' : 'btn-outline'}`}
              onClick={onCreateNew}
            >
              Different person — create a new record
            </button>
            <a
              href={`/hcp/${match.hcp_id}/results`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-sm btn-outline"
            >
              View existing result
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// The document already stored against this HCP. Shows that it exists and lets
// it be opened; the stored filename is a UUID, so the label describes the
// document rather than echoing a meaningless name.
function AttachedFile({ label, meta, fetcher, hcpId, fallbackName }) {
  const [busy, setBusy] = React.useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const res = await fetcher(hcpId);
      const url = URL.createObjectURL(new Blob([res.data]));
      const disposition = res.headers['content-disposition'];
      const match = disposition && disposition.match(/filename="?([^"]+)"?/);
      const a = document.createElement('a');
      a.href = url;
      a.download = match ? match[1] : fallbackName;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { /* the button stays available to retry */ }
    finally { setBusy(false); }
  };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
      borderRadius: 8, marginBottom: 8,
      background: 'var(--color-success-bg)', border: '1px solid var(--color-success)',
    }}>
      <CheckCircle size={15} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{label}</div>
        {meta && <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>{meta}</div>}
      </div>
      <button type="button" onClick={open} disabled={busy} title="Download"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--color-text-secondary)' }}>
        {busy ? <Loader size={14} className="spinning" /> : <Download size={14} />}
      </button>
    </div>
  );
}

export default function NewHCPPage() {
  const navigate = useNavigate();
  const fileRef = useRef(null);


  const [form, setForm] = useState({
    full_name: '',
    email: '',
    mobile: '',
    city: '',
    specialty: '',
    institution: '',
    designation: '',
    years_of_experience: '',
    medical_registration_no: '',
    affiliated_to_government: '',
    key_clinical_interests: '',
    publications: '',
    unique_expertise: '',
    procedures_per_year: '',
    conference_presentations: '',
    advisory_board: '',
    professional_memberships: '',
    awards_recognitions: '',
  });
  const [conferenceRows, setConferenceRows] = useState([blankRow('conference_presentations')]);
  const [advisoryRows, setAdvisoryRows] = useState([blankRow('advisory_board')]);
  const [textbookRows, setTextbookRows] = useState([blankRow('textbooks')]);
  const [officeRows, setOfficeRows] = useState([blankRow('office_bearer_positions')]);
  const [facultyRows, setFacultyRows] = useState([blankRow('faculty_positions')]);
  const [publicationRows, setPublicationRows] = useState([blankRow('publications')]);
  // Which section's paste box is open, and the shared draft/state for it.
  const [pasteFor, setPasteFor] = useState(null);
  const [pasteText, setPasteText] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteError, setPasteError] = useState('');
  const [cvFile, setCvFile] = useState(null);
  const [consentFile, setConsentFile] = useState(null);
  const [consentError, setConsentError] = useState('');
  const consentRef = React.useRef(null);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  // `aiEnabled` still drives the copy above the drop zone, which must not
  // promise AI to an account that has it turned off.
  const [aiEnabled, setAiEnabled] = useState(true);
  const [currentStep, setCurrentStep] = useState(-1);
  const [error, setError] = useState('');

  // Duplicate detection. The same CV used to produce a second HCP record with
  // its own separate score history; now the form recognises the person first
  // and re-assesses the record that already exists.
  //   duplicate       — the strongest existing record this submission matches
  //   duplicateChoice — what the user decided about it ('reassess' | 'new')
  //   cvHash          — fingerprint of the uploaded CV, returned by extraction
  const [duplicate, setDuplicate] = useState(null);
  const [duplicateChoice, setDuplicateChoice] = useState(null);
  const [cvHash, setCvHash] = useState('');

  // Re-assessment mode. Same form, same fields, same uploads — the only
  // differences are that the record already exists (so it is updated, not
  // created) and the fields arrive pre-filled.
  const { id: reassessId } = useParams();
  const isReassess = Boolean(reassessId);
  const [existing, setExisting] = useState(null);
  const [prefilling, setPrefilling] = useState(Boolean(reassessId));

  useEffect(() => {
    if (!reassessId) return undefined;
    let live = true;
    getHCP(reassessId)
      .then((res) => {
        if (!live) return;
        const h = res.data;
        setExisting(h);
        // Scalar fields straight across; numbers become strings because every
        // input in this form is controlled by a string.
        setForm((prev) => {
          const next = { ...prev };
          Object.keys(prev).forEach((k) => {
            const v = h[k];
            if (v !== null && v !== undefined) next[k] = String(v);
          });
          return next;
        });
        setPublicationRows(deserializeRows('publications', h.publications));
        setConferenceRows(deserializeRows('conference_presentations', h.conference_presentations));
        setAdvisoryRows(deserializeRows('advisory_board', h.advisory_board));
        setTextbookRows(deserializeRows('textbooks', h.textbooks));
        setFacultyRows(deserializeRows('faculty_positions', h.faculty_positions));
        setOfficeRows(deserializeRows('office_bearer_positions', h.office_bearer_positions));
      })
      .catch(() => { if (live) setError('Could not load this HCP for re-assessment.'); })
      .finally(() => { if (live) setPrefilling(false); });
    return () => { live = false; };
  }, [reassessId]);

  useEffect(() => {
    let live = true;
    getMe()
      .then((res) => { if (live) setAiEnabled(res.data?.ai_enabled !== false); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // Takes a report from either source — the CV extraction, or the live check
  // below. The user's decision survives a re-check of the *same* record; a
  // different record is a different question, so it resets. Which record was
  // last seen lives in a ref, not in state: the check fires on a debounce, and
  // comparing against a ref keeps this callback pure.
  const duplicateIdRef = React.useRef(null);
  const applyDuplicateReport = React.useCallback((report) => {
    const best = report?.best_match || null;
    if (!best) {
      duplicateIdRef.current = null;
      setDuplicate(null);
      setDuplicateChoice(null);
      return;
    }
    if (duplicateIdRef.current !== best.hcp_id) {
      duplicateIdRef.current = best.hcp_id;
      setDuplicateChoice(null);
    }
    setDuplicate({ ...best, auto_merge: Boolean(report.auto_merge) });
  }, []);

  // Manual entry gets the same protection as an uploaded CV: type in an email,
  // mobile or registration number that is already on file and the match shows
  // up before the form is submitted. Debounced, because it fires on keystrokes.
  useEffect(() => {
    if (isReassess) return undefined;
    const identity = {
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      mobile: form.mobile.trim(),
      medical_registration_no: form.medical_registration_no.trim(),
      city: form.city.trim(),
      institution: form.institution.trim(),
      cv_hash: cvHash || undefined,
    };
    // Nothing identifying yet — nothing to match on. Cleared through the same
    // handler so the "which record was last seen" ref is reset too, or a form
    // emptied and re-typed would keep a stale decision.
    if (!identity.full_name && !identity.email && !identity.mobile
        && !identity.medical_registration_no && !identity.cv_hash) {
      applyDuplicateReport(null);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      checkHCPDuplicate(identity)
        .then((res) => { if (live) applyDuplicateReport(res.data); })
        .catch(() => {});
    }, 600);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReassess, form.full_name, form.email, form.mobile,
      form.medical_registration_no, form.city, form.institution, cvHash,
      applyDuplicateReport]);

  // The existing HCP this submission has been settled to be, if any. A strong
  // match (same CV file, registration number, email or mobile) counts as
  // settled on its own, unless the user has said "different person"; a weaker
  // one only once they have confirmed it.
  const duplicateTargetId = (() => {
    if (isReassess || !duplicate || duplicateChoice === 'new') return null;
    if (duplicateChoice === 'reassess') return duplicate.hcp_id;
    return duplicate.auto_merge ? duplicate.hcp_id : null;
  })();

  // Either route lands on a record that already exists, which is all the
  // progress panel needs to know.
  const usesExistingRecord = isReassess || Boolean(duplicateTargetId);

  // One entry per repeatable section, so handlers and JSX stay table-driven.
  const SECTIONS = [
    {
      kind: 'conference_presentations', rows: conferenceRows, setRows: setConferenceRows,
      icon: Mic, label: 'Conference Presentations / Speaker Activities (if available)',
    },
    {
      kind: 'advisory_board', rows: advisoryRows, setRows: setAdvisoryRows,
      icon: Users, label: 'Advisory Board',
    },
    {
      kind: 'publications', rows: publicationRows, setRows: setPublicationRows,
      icon: FileText, label: 'Publications (each with its year and journal)',
    },
    {
      kind: 'textbooks', rows: textbookRows, setRows: setTextbookRows,
      icon: Book, label: 'Textbooks / Book Chapters (if available)',
    },
    {
      kind: 'office_bearer_positions', rows: officeRows, setRows: setOfficeRows,
      icon: Crown, label: 'Office Bearer / Leadership Positions in Medical Associations',
    },
    {
      kind: 'faculty_positions', rows: facultyRows, setRows: setFacultyRows,
      icon: Briefcase, label: 'Faculty Positions & Affiliations (current and past)',
    },
  ];
  const sectionByKind = Object.fromEntries(SECTIONS.map((sec) => [sec.kind, sec]));

  // Everything RowSection needs, derived from one SECTIONS entry.
  const rowSectionProps = ({ kind, rows, setRows, icon, label }) => ({
    kind, rows, setRows, icon, label,
    pasteOpen: pasteFor === kind,
    onTogglePaste: () => togglePaste(kind),
    pasteText,
    onPasteText: setPasteText,
    pasteBusy,
    pasteError,
    onConvert: () => handleConvertPaste(kind, setRows),
    cvFallback: form[kind],
  });

  const togglePaste = (kind) => {
    setPasteError('');
    setPasteText('');
    setPasteFor((prev) => (prev === kind ? null : kind));
  };

  const handleConvertPaste = async (kind, setRows) => {
    const text = pasteText.trim();
    if (!text) return;
    setPasteBusy(true);
    setPasteError('');
    try {
      const res = await parseRows(kind, text);
      const parsed = (res.data?.rows || []).map((r) => ({ ...blankRow(kind), ...r }));
      if (parsed.length === 0) {
        setPasteError('No entries could be read from that text. Try one entry per line.');
        return;
      }
      // Append, discarding the blank starter row so the list does not gain a gap.
      setRows((prev) => [...prev.filter(rowFilled), ...parsed]);
      setPasteFor(null);
      setPasteText('');
    } catch (err) {
      const detail = err.response?.data?.detail;
      setPasteError(typeof detail === 'string' ? detail : 'Could not split the pasted text. Please try again or add rows manually.');
    } finally {
      setPasteBusy(false);
    }
  };

  // Checked in the browser as well as on the server. The server is the
  // authority, but rejecting here means the user finds out on pick rather than
  // after filling in the whole form and pressing Save.
  const CONSENT_EXT = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];

  const takeConsentFile = (file) => {
    if (!file) return;
    const dot = file.name.lastIndexOf('.');
    const ext = dot === -1 ? '' : file.name.slice(dot).toLowerCase();
    if (!CONSENT_EXT.includes(ext)) {
      setConsentError(`${ext || 'That file'} is not accepted. Use PDF, DOC, DOCX, JPG or PNG.`);
      setConsentFile(null);
      return;
    }
    setConsentError('');
    setConsentFile(file);
  };

  const handleConsentDrop = (e) => {
    e.preventDefault();
    takeConsentFile(e.dataTransfer?.files?.[0] || e.target?.files?.[0]);
  };

  const handleFileDrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (!file) return;

    setCvFile(file);
    setError('');
    setExtracting(true);

    try {
      const res = await extractCVFields(file);
      const fields = res.data;
      // The server fingerprinted the file and checked it against existing
      // records while it had the bytes in hand. Re-uploading a CV we have
      // already assessed is the case this whole flow exists for, so take its
      // verdict before touching the form.
      setCvHash(fields.cv_hash || '');
      applyDuplicateReport(fields.duplicate_check);
      // These come back as arrays of rows, not strings — handled separately below.
      const rowKeys = new Set(Object.keys(ROW_SECTIONS));
      setForm((prev) => {
        const updated = { ...prev };
        Object.keys(fields).forEach((key) => {
          if (rowKeys.has(key)) return;
          if (fields[key] !== null && fields[key] !== undefined && key in updated) {
            // Only auto-fill if the field is currently empty
            if (!updated[key] || updated[key].toString().trim() === '') {
              updated[key] = String(fields[key]);
            }
          }
        });
        return updated;
      });
      const toRows = (kind, val) => {
        if (!Array.isArray(val) || val.length === 0) return null;
        return val.map((r) => ({
          ...blankRow(kind),
          ...Object.fromEntries(
            ROW_SECTIONS[kind].columns.map((c) => [c.key, (r?.[c.key] ?? '').toString()])
          ),
        }));
      };
      // Same rule as the text fields: extraction fills a section only while it
      // is still untouched, so it never overwrites hand-typed rows.
      SECTIONS.forEach(({ kind, setRows }) => {
        const extractedRows = toRows(kind, fields[kind]);
        if (extractedRows) {
          setRows((prev) => (rowsHaveData(prev) ? prev : extractedRows));
        }
      });
      // A CV that yields an institution but no dated faculty history would
      // otherwise leave the section the user now edits looking empty, even
      // though the value was found. Seed it as the current post.
      const exInst = (fields.institution || '').toString().trim();
      const exPos = (fields.designation || '').toString().trim();
      if (exInst || exPos) {
        setFacultyRows((prev) => (rowsHaveData(prev) ? prev : [{
          ...blankRow('faculty_positions'),
          institution: exInst,
          position: exPos,
          status: 'current',
        }]));
      }
    } catch (err) {
      console.error('CV extraction failed:', err);
      // Not critical — the user can still fill the form manually. The backend
      // explains what it could not read (a scan with no text layer, a legacy
      // .doc), which is more useful than a generic failure line.
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' && detail
        ? detail
        : `Could not extract fields from this CV${aiEnabled ? '' : ' without AI'}. You can fill the form manually.`);
    } finally {
      setExtracting(false);
    }
  };

  const handleRemoveFile = (e) => {
    e.stopPropagation();
    setCvFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const hasFormData =
    Object.values(form).some((v) => v.trim() !== '') ||
    SECTIONS.some(({ rows }) => rowsHaveData(rows));

  // Nothing on this form asks for a current institution or designation any
  // more — Faculty Positions & Affiliations is the only place it is entered.
  // The two columns are still filled on submit, silently, because the
  // Assessments list searches and exports them, its completeness meter counts
  // them, HCP Detail shows them, the AI scoring prompt reads them, and the
  // public HCP form writes them directly. Derived, never asked.
  const currentPost = (() => {
    const rows = facultyRows.filter(r => (r.institution || '').trim() || (r.position || '').trim());
    const marked = rows.find(r => (r.status || '').toLowerCase() === 'current');
    if (marked) return marked;
    // No row says "current". Fall back to the first only while the status is
    // still unset — someone who has explicitly marked every post as past has
    // no current institution, and inventing one would be wrong.
    const allPast = rows.length > 0 && rows.every(r => (r.status || '').toLowerCase() === 'past');
    return allPast ? null : (rows[0] || null);
  })();
  const derivedInstitution = (currentPost?.institution || '').trim() || form.institution.trim();
  const derivedDesignation = (currentPost?.position || '').trim() || form.designation.trim();

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!isReassess && !cvFile && !hasFormData) {
      setError('Please fill in HCP details or upload a CV to proceed.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      // Step 1: Create HCP profile
      setCurrentStep(0);
      const payload = {};
      if (form.full_name.trim()) payload.full_name = form.full_name.trim();
      if (form.email.trim()) payload.email = form.email.trim();
      if (form.mobile.trim()) payload.mobile = form.mobile.trim();
      if (form.city.trim()) payload.city = form.city.trim();
      if (form.specialty.trim()) payload.specialty = form.specialty.trim();
      if (derivedInstitution) payload.institution = derivedInstitution;
      if (derivedDesignation) payload.designation = derivedDesignation;
      if (form.years_of_experience.trim()) payload.years_of_experience = parseInt(form.years_of_experience, 10);
      if (form.medical_registration_no.trim()) payload.medical_registration_no = form.medical_registration_no.trim();
      if (form.affiliated_to_government.trim()) payload.affiliated_to_government = form.affiliated_to_government.trim();
      if (form.key_clinical_interests.trim()) payload.key_clinical_interests = form.key_clinical_interests.trim();
      if (form.unique_expertise.trim()) payload.unique_expertise = form.unique_expertise.trim();
      if (form.procedures_per_year.trim()) payload.procedures_per_year = parseInt(form.procedures_per_year, 10);

      // Rows win; fall back to whatever free text the CV extraction left behind.
      SECTIONS.forEach(({ kind, rows }) => {
        const serialized = serializeRows(kind, rows);
        if (serialized) {
          payload[kind] = serialized;
        } else if ((form[kind] || '').trim()) {
          payload[kind] = form[kind].trim();
        }
      });

      if (form.professional_memberships.trim()) payload.professional_memberships = form.professional_memberships.trim();
      if (form.awards_recognitions.trim()) payload.awards_recognitions = form.awards_recognitions.trim();

      // If no name provided but CV is uploaded, derive from filename
      if (!payload.full_name && cvFile) {
        payload.full_name = cvFile.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
      }

      // Three ways in, one record out. A re-assessment updates the record it
      // was opened from; a recognised duplicate is sent through the create with
      // `merge_into`, so the server folds it into the matched record AND logs
      // that a duplicate was recognised on that record's audit trail — a plain
      // update would have moved the score with nothing saying why no new record
      // appeared. Anything else creates one. Everything after this point is
      // identical: a duplicate still gets a full assessment, only the id it
      // lands on differs.
      const res = isReassess
        ? await updateHCP(reassessId, payload)
        : await createHCP({
            ...payload,
            cv_hash: cvHash || undefined,
            merge_into: duplicateTargetId || undefined,
            // Only ever true when the user was shown a match and said it is a
            // different person; the server otherwise re-uses the existing
            // record even if this form missed the match.
            force_new: duplicateChoice === 'new',
          });
      // `res.data.id` also covers the server's own duplicate guard: if it
      // merged a create this form did not flag, that record's id comes back
      // here and the upload and scoring steps land on it.
      const hcpId = isReassess ? Number(reassessId) : res.data.id;

      // Step 2: Upload CV (if provided)
      // Consent first: it is the compliance artefact, and unlike the CV its
      // upload cannot fail on unreadable content, so it is the cheaper of the
      // two to get safely stored.
      if (consentFile) {
        try {
          await uploadConsent(hcpId, consentFile);
        } catch (err) {
          // Never lose the HCP over the consent letter — the record is created
          // by this point and the letter can be attached again from the profile.
          console.error('Consent upload failed:', err);
          setError('The HCP was saved, but the consent letter could not be uploaded. '
            + (err.response?.data?.detail || 'Please attach it again from the profile.'));
        }
      }

      if (cvFile) {
        setCurrentStep(1);
        await uploadCV(hcpId, cvFile);
      }

      // Step 3: AI scoring
      setCurrentStep(2);
      await scoreWithAI(hcpId);

      setCurrentStep(3);
      await new Promise((r) => setTimeout(r, 400));

      // Navigate to results
      navigate(`/hcp/${hcpId}/results`);
    } catch (err) {
      let msg;
      if (err.code === 'ECONNABORTED') {
        msg = 'AI analysis timed out. Please try again — large CVs may take longer to process.';
      } else {
        msg = err.response?.data?.detail || 'Failed to process assessment.';
      }
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
      setCurrentStep(-1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page container">
      <div className="page-header">
        <h1 className="sr-only">{isReassess ? 'Re-assessment' : 'New Assessment'}</h1>
        {isReassess ? (
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
              Re-assessment{existing?.full_name ? ` — ${existing.full_name}` : ''}
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
              The saved details are filled in below. Edit or add anything that has changed,
              then run the assessment again — the previous result is kept, and the change is
              recorded in the audit trail.
            </p>
          </div>
        ) : (
          <p style={{ color: 'var(--color-text-secondary)' }}>
            Fill your details, upload a CV, or both — Tool will analyze and score automatically
          </p>
        )}
      </div>

      {prefilling && (
        <div className="card" style={{ maxWidth: 900, margin: '0 auto 20px', padding: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Loader size={18} className="spinning" />
          <span style={{ color: 'var(--color-text-secondary)' }}>Loading the saved details…</span>
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ maxWidth: 900, margin: '0 auto 20px' }}>
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {!isReassess && duplicate && !loading && (
        <DuplicateNotice
          match={duplicate}
          choice={duplicateChoice}
          willReassess={Boolean(duplicateTargetId)}
          onReassess={() => setDuplicateChoice('reassess')}
          onCreateNew={() => setDuplicateChoice('new')}
        />
      )}

      {/* Processing Progress */}
      {loading && currentStep >= 0 && (
        <div className="card" style={{ maxWidth: 600, margin: '0 auto 24px', padding: '32px' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <Loader size={32} className="spinning" style={{ color: 'var(--color-primary)' }} />
            <h3 style={{ marginTop: 12 }}>Processing Assessment</h3>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
              Analyzing data, checking PubMed, ClinicalTrials...
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {stepsFor(aiEnabled, usesExistingRecord).map((step, i) => {
              const StepIcon = step.icon;
              const isActive = i === currentStep;
              const isDone = i < currentStep;
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                    borderRadius: 8,
                    background: isActive ? 'var(--color-primary-bg, var(--color-primary-bg))' : isDone ? 'var(--color-success-bg, var(--color-success-bg))' : 'var(--color-bg)',
                    border: isActive ? '1px solid var(--color-primary)' : '1px solid transparent',
                    opacity: (!isActive && !isDone) ? 0.5 : 1,
                  }}
                >
                  {isDone ? (
                    <CheckCircle size={20} style={{ color: 'var(--color-success)' }} />
                  ) : isActive ? (
                    <Loader size={20} className="spinning" style={{ color: 'var(--color-primary)' }} />
                  ) : (
                    <StepIcon size={20} style={{ color: 'var(--color-text-light)' }} />
                  )}
                  <span style={{ fontWeight: isActive ? 600 : 400 }}>{step.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Two-Column Form */}
      {!loading && (
        <form onSubmit={handleSubmit}>
          <div className="new-assessment-grid" style={{
            display: 'grid',
            // The details card takes the room — its four-column rows need it.
            // minmax stops the aside collapsing below a usable drop-zone width.
            gridTemplateColumns: 'minmax(0, 1fr) 260px',
            gap: '20px',
            alignItems: 'start',
            // Capped: on a wide monitor the details card ran past 1000px, and a
            // text input that wide is harder to scan, not easier.
            maxWidth: 1080,
            margin: '0 auto 24px',
          }}>
            {/* Left Column — HCP Details */}
            <div className="card">
              <div className="card-header">
                <h4><User size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Enter Details</h4>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                <p style={{ fontSize: '0.78rem', color: 'var(--color-text-light)', margin: 0 }}>
                  All fields are optional. You can assess using only a CV, only these details, or both.
                </p>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <User size={14} /> Full Name
                  </label>
                  <input
                    className="form-control"
                    placeholder="e.g. Dr. Anupam Kumar Singh"
                    value={form.full_name}
                    onChange={(e) => handleChange('full_name', e.target.value)}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Mail size={14} /> Email
                    </label>
                    <input
                      className="form-control"
                      type="email"
                      placeholder="e.g. dr.singh@hospital.org"
                      value={form.email}
                      onChange={(e) => handleChange('email', e.target.value)}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Phone size={14} /> Mobile
                    </label>
                    <input
                      className="form-control"
                      type="tel"
                      placeholder="e.g. +91 98765 43210"
                      value={form.mobile}
                      onChange={(e) => handleChange('mobile', e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <MapPin size={14} /> City / Location
                    </label>
                    <input
                      className="form-control"
                      placeholder="e.g. New Delhi"
                      value={form.city}
                      onChange={(e) => handleChange('city', e.target.value)}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Stethoscope size={14} /> Specialty / Therapeutic Area
                    </label>
                    <input
                      className="form-control"
                      placeholder="e.g. Cardiology, Oncology"
                      value={form.specialty}
                      onChange={(e) => handleChange('specialty', e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Clock size={14} /> Years of Experience
                    </label>
                    <input
                      className="form-control"
                      type="number"
                      min="0"
                      placeholder="e.g. 15"
                      value={form.years_of_experience}
                      onChange={(e) => handleChange('years_of_experience', e.target.value)}
                    />
                  </div>
                </div>

                <RowSection {...rowSectionProps(sectionByKind.faculty_positions)} />

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <BadgeCheck size={14} /> Medical Registration No.
                    </label>
                    <input
                      className="form-control"
                      placeholder="e.g. MCI-12345"
                      value={form.medical_registration_no}
                      onChange={(e) => handleChange('medical_registration_no', e.target.value)}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Landmark size={14} /> Affiliated to Government Organisation
                    </label>
                    <select
                      className="form-control"
                      value={form.affiliated_to_government}
                      onChange={(e) => handleChange('affiliated_to_government', e.target.value)}
                    >
                      <option value="">Select...</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <BookOpen size={14} /> Key Clinical or Research Interests
                  </label>
                  <textarea
                    className="form-control"
                    rows={2}
                    placeholder="e.g. Interventional cardiology, heart failure management"
                    value={form.key_clinical_interests}
                    onChange={(e) => handleChange('key_clinical_interests', e.target.value)}
                  />
                </div>

                {/* Six parameters score from these two and nothing wrote them
                    before, so an HCP entered without a CV lost all of them. */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Award size={14} /> Unique Surgical / Clinical Expertise
                    </label>
                    <input
                      className="form-control"
                      placeholder="e.g. Robotic hair restoration, quad-wavelength laser"
                      value={form.unique_expertise}
                      onChange={(e) => handleChange('unique_expertise', e.target.value)}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <ClipboardList size={14} /> Procedures / Surgeries per Year
                    </label>
                    <input
                      className="form-control"
                      type="number"
                      min="0"
                      placeholder="e.g. 250"
                      value={form.procedures_per_year}
                      onChange={(e) => handleChange('procedures_per_year', e.target.value)}
                    />
                  </div>
                </div>

                <RowSection {...rowSectionProps(sectionByKind.publications)} />

                <RowSection {...rowSectionProps(sectionByKind.textbooks)} />

                <RowSection {...rowSectionProps(sectionByKind.conference_presentations)} />

                <RowSection {...rowSectionProps(sectionByKind.advisory_board)} />

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Users size={14} /> Professional Memberships
                  </label>
                  <textarea
                    className="form-control"
                    rows={2}
                    placeholder="e.g. CSI, ISHR, AHA Fellow"
                    value={form.professional_memberships}
                    onChange={(e) => handleChange('professional_memberships', e.target.value)}
                  />
                  <p style={{ fontSize: '0.72rem', color: 'var(--color-text-light)', margin: '4px 0 0' }}>
                    Plain membership only. If a post was held — President, Secretary, council or
                    board seat — add it below instead; it scores far higher.
                  </p>
                </div>

                <RowSection {...rowSectionProps(sectionByKind.office_bearer_positions)} />

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Award size={14} /> Awards / Recognitions (if available)
                  </label>
                  <textarea
                    className="form-control"
                    rows={2}
                    placeholder="e.g. BC Roy Award, Best Paper Award APSC 2023"
                    value={form.awards_recognitions}
                    onChange={(e) => handleChange('awards_recognitions', e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Right Column — Consent Letter + Upload CV.
                Sticky as ONE block: the form beside it runs to ~25 fields and
                the drop zone is the faster path, so scrolling away from it hides
                the shortcut. The two cards must share the sticky wrapper —
                leaving the CV card sticky on its own made it detach and ride
                over the consent card on scroll. */}
            <div className="new-assessment-aside">
            {/* Consent above the CV: it is the permission to hold the rest of
                this record, so it reads first. */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <h4><ShieldCheck size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Consent Letter</h4>
              </div>
              <div className="card-body">
                <p style={{ fontSize: '0.74rem', color: 'var(--color-text-light)', margin: '0 0 8px' }}>
                  Signed consent from this HCP. Stored with the record; not read or used to
                  fill the form.
                </p>
                {isReassess && existing?.consent_file_path && !consentFile && (
                  <AttachedFile
                    label="Consent letter on file"
                    meta={existing.consent_uploaded_at
                      ? `Uploaded ${new Date(existing.consent_uploaded_at).toLocaleDateString()} — upload below only to replace`
                      : 'Upload below only to replace'}
                    fetcher={downloadConsent}
                    hcpId={reassessId}
                    fallbackName={`consent_${reassessId}.pdf`}
                  />
                )}
                <div
                  className={`file-upload ${consentFile ? 'active' : ''}`}
                  onClick={() => consentRef.current?.click()}
                  onDrop={handleConsentDrop}
                  onDragOver={(e) => e.preventDefault()}
                  style={{
                    padding: '12px 10px', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  }}
                >
                  <Upload size={20} style={{ color: consentFile ? 'var(--color-primary)' : 'var(--color-text-light)' }} />
                  <p style={{ margin: '6px 0 0', fontWeight: 500, textAlign: 'center', fontSize: '0.8rem' }}>
                    {consentFile ? 'Click to change' : 'Drop a file, or click to browse'}
                  </p>
                  <p style={{ fontSize: '0.72rem', color: 'var(--color-text-light)', margin: '2px 0 0' }}>
                    PDF, DOC, DOCX, JPG, PNG
                  </p>
                  {consentFile && (
                    <div className="file-name" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <CheckCircle size={15} style={{ color: 'var(--color-success)' }} />
                      <span style={{ fontSize: '0.84rem' }}>{consentFile.name}</span>
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); setConsentFile(null); setConsentError(''); if (consentRef.current) consentRef.current.value = ''; }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                        <X size={14} style={{ color: 'var(--color-text-light)' }} />
                      </button>
                    </div>
                  )}
                  <input
                    ref={consentRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                    style={{ display: 'none' }}
                    onChange={handleConsentDrop}
                  />
                </div>
                {consentError && (
                  <div style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--color-error)' }}>
                    {consentError}
                  </div>
                )}
              </div>
            </div>

            <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="card-header">
                <h4><FileText size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Upload CV</h4>
              </div>
              <div className="card-body" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <p style={{ fontSize: '0.74rem', color: 'var(--color-text-light)', margin: '0 0 8px' }}>
                  {aiEnabled
                    ? 'Upload a CV for AI-powered extraction. Fields will be auto-filled from the CV.'
                    : 'AI is turned off for this account, so the CV is read on this server by rule — nothing is sent to a model. Fields will be auto-filled from the CV.'}
                </p>
                {isReassess && existing?.cv_file_path && !cvFile && (
                  <AttachedFile
                    label="CV on file"
                    meta="Upload below only to replace it"
                    fetcher={downloadCV}
                    hcpId={reassessId}
                    fallbackName={`cv_${reassessId}.pdf`}
                  />
                )}
                <div
                  className={`file-upload ${cvFile ? 'active' : ''}`}
                  onClick={() => !extracting && fileRef.current?.click()}
                  onDrop={handleFileDrop}
                  onDragOver={(e) => e.preventDefault()}
                  style={{
                    padding: '14px 10px', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    cursor: extracting ? 'wait' : 'pointer',
                    opacity: extracting ? 0.7 : 1,
                  }}
                >
                  {extracting ? (
                    <Loader size={22} className="spinning" style={{ color: 'var(--color-primary)' }} />
                  ) : (
                    <Upload size={22} style={{ color: cvFile ? 'var(--color-primary)' : 'var(--color-text-light)' }} />
                  )}
                  <p style={{ margin: '6px 0 0', fontWeight: 500, textAlign: 'center', fontSize: '0.8rem' }}>
                    {extracting
                      ? 'Reading CV…'
                      : cvFile
                        ? 'Click to change'
                        : 'Drop a CV here, or click to browse'}
                  </p>
                  {extracting && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                      {aiEnabled ? 'AI is reading your CV and filling the form' : 'Reading your CV and filling the form'}
                    </p>
                  )}
                  {!extracting && (
                    <p style={{ fontSize: '0.72rem', color: 'var(--color-text-light)', margin: '2px 0 0' }}>PDF, DOC, DOCX, PPT, PPTX, PNG, JPG</p>
                  )}
                  {cvFile && !extracting && (
                    <div className="file-name" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <CheckCircle size={16} style={{ color: 'var(--color-success)' }} />
                      <span>{cvFile.name}</span>
                      <button type="button" onClick={handleRemoveFile} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                        <X size={14} style={{ color: 'var(--color-text-light)' }} />
                      </button>
                    </div>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.tiff,.bmp"
                    style={{ display: 'none' }}
                    onChange={handleFileDrop}
                  />
                </div>
              </div>
            </div>
            </div>{/* /new-assessment-aside */}
          </div>

          {/* Action Buttons */}
          <div className="new-assessment-actions" style={{ maxWidth: 1080, margin: '0 auto' }}>
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={extracting || prefilling || (!isReassess && !cvFile && !hasFormData)}
            >
              <Brain size={18} /> {isReassess ? 'Run Re-assessment' : 'Start Assessment'}
            </button>
            <button type="button" className="btn btn-secondary btn-lg" onClick={() => navigate('/assessments')}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
