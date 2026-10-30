import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Plus, Trash2, Save, ArrowLeft, AlertCircle, Loader,
  CheckCircle, Copy, ExternalLink, Image, X, GitBranch,
  Settings, List, ChevronDown, ChevronUp, Type,
  SlidersHorizontal, Activity, Heading, Hash, ListOrdered, Asterisk, Globe,
  PenLine, MessageSquare, BookOpen, MoveVertical, Files, Star, PlusCircle,
  ArrowUp, ArrowDown, Edit3, ClipboardPaste,
  CheckSquare, ChevronsUpDown, Table, Grid3x3, BarChart3, RectangleHorizontal,
  AlignJustify, User, Mail, Phone, MapPin, Calendar, FileText, Gauge,
} from 'lucide-react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { getSurvey, updateSurvey, uploadSurveyImage } from '../services/api';
import RichTextView from '../components/RichTextView';
import InlineRichText from '../components/InlineRichText';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const BACKEND_URL = API_BASE.replace('/api/v1', '');

const NEEDS_OPTIONS = ['select', 'multi_select', 'radio', 'checkbox'];

// Standard NPS wording, pre-filled when the author picks the type on an empty question.
const NPS_DEFAULT_LABEL = 'How likely are you to recommend us to a friend or colleague?';

// Full rich-text ribbon for the "Add content → Text" block (section_header). Matches
// the toolbar shown in the design: font, size/heading, B/I/U/S, colour & highlight,
// align, lists, indent, link/image/video, quote/code, sub/superscript, clear.
const TEXT_BLOCK_QUILL_MODULES = {
  toolbar: [
    [{ font: [] }],
    [{ header: [1, 2, 3, 4, 5, 6, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ color: [] }, { background: [] }],
    [{ align: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ indent: '-1' }, { indent: '+1' }],
    ['link', 'image', 'video'],
    ['blockquote', 'code-block'],
    [{ script: 'sub' }, { script: 'super' }],
    [{ size: [] }],
    ['clean'],
  ],
};

// SurveyMonkey-style "Choose a question type" grid (images 8 & 9). Each tile maps to a
// supported backend QuestionType — some are the nearest equivalent (noted with ~).
const QUESTION_TYPE_GRID = [
  { group: 'Selection', items: [
    { label: 'Multiple choice', icon: List, type: 'radio' },
    { label: 'Checkboxes', icon: CheckSquare, type: 'checkbox' },
    { label: 'Dropdown', icon: ChevronsUpDown, type: 'select' },
    { label: 'Matrix of dropdown menus', icon: Table, type: 'matrix' },
    { label: 'Image choice', icon: Image, type: 'radio' },          // ~ radio w/ option images
  ]},
  { group: 'Rating', items: [
    { label: 'Star rating', icon: Star, type: 'rating' },
    { label: 'Net Promoter Score (NPS)', icon: Gauge, type: 'nps' },
    { label: 'Slider', icon: SlidersHorizontal, type: 'linear_scale' }, // ~ 1–10 scale
    { label: 'Ranking', icon: ListOrdered, type: 'multi_select' },      // ~ multi-select
    { label: 'Matrix / Rating scale', icon: Grid3x3, type: 'matrix' },
    { label: 'Best worst scale', icon: BarChart3, type: 'matrix' },     // ~ matrix grid
  ]},
  { group: 'Textbox', items: [
    { label: 'Comment box', icon: MessageSquare, type: 'textarea' },
    { label: 'Single text box', icon: RectangleHorizontal, type: 'text' },
    { label: 'Multiple textboxes', icon: AlignJustify, type: 'textarea' }, // ~ long text
  ]},
  { group: 'Forms', items: [
    { label: 'Name', icon: User, type: 'text' },
    { label: 'Email address', icon: Mail, type: 'email' },
    { label: 'Phone', icon: Phone, type: 'phone' },
    { label: 'Address', icon: MapPin, type: 'textarea' },           // ~ long text
    { label: 'Date / Time', icon: Calendar, type: 'date' },
  ]},
];
// Label shown on the type-picker button for the question's current backend type.
const GRID_LABEL_FOR_TYPE = (() => {
  const m = {};
  QUESTION_TYPE_GRID.forEach(g => g.items.forEach(it => { if (!(it.type in m)) m[it.type] = it.label; }));
  m.yes_no = 'Yes / No'; m.linear_scale = 'Slider'; m.number = 'Number'; m.url = 'Website URL';
  m.time = 'Date / Time'; m.file_upload = 'File upload';
  return m;
})();

const INTRO_FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'number', label: 'Number' },
  { value: 'textarea', label: 'Long Text' },
];

// ── Display options (the "Survey Settings" options menu) ──
const DEFAULT_DISPLAY_SETTINGS = {
  show_title: true,
  progress_bar: 'off',       // off | top | bottom
  page_titles: false,
  page_numbers: false,
  question_numbers: 'on',    // on | off
  required_asterisks: true,
  language: 'en',
};

const DISPLAY_SETTING_ROWS = [
  { key: 'show_title', icon: Type, label: 'Survey title', kind: 'toggle' },
  { key: 'progress_bar', icon: Activity, label: 'Progress bar', kind: 'select',
    options: [{ value: 'off', label: 'Off' }, { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }] },
  { key: 'page_titles', icon: Heading, label: 'Page titles', kind: 'toggle' },
  { key: 'page_numbers', icon: Hash, label: 'Page numbers', kind: 'toggle' },
  { key: 'question_numbers', icon: ListOrdered, label: 'Question numbers', kind: 'select',
    options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
  { key: 'required_asterisks', icon: Asterisk, label: 'Required asterisks', kind: 'toggle' },
  { key: 'language', icon: Globe, label: 'Language', kind: 'select',
    options: [{ value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' }, { value: 'fr', label: 'French' }, { value: 'de', label: 'German' }] },
];

/* ── Pill toggle switch (matches the green on/off switches in the options menu) ── */
function ToggleSwitch({ checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={onChange}
      style={{ width: 42, height: 23, borderRadius: 999, border: 'none', padding: 0, cursor: 'pointer',
        background: checked ? 'var(--color-success)' : 'var(--color-border-strong)', position: 'relative', transition: 'background 0.15s', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 2, left: checked ? 21 : 2, width: 19, height: 19, borderRadius: '50%',
        background: 'var(--color-surface)', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', transition: 'left 0.15s' }} />
    </button>
  );
}

/* ── The dropdown list of display options ── */
function DisplaySettingsMenu({ menuRef, style, settings, onChange }) {
  return (
    <div ref={menuRef} onClick={e => e.stopPropagation()}
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
        boxShadow: '0 10px 30px rgba(15,23,42,0.18)', width: 320, overflow: 'hidden', zIndex: 1000, ...style }}>
      {DISPLAY_SETTING_ROWS.map((row, i) => {
        const Icon = row.icon;
        return (
          <div key={row.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '13px 18px', borderBottom: i === DISPLAY_SETTING_ROWS.length - 1 ? 'none' : '1px solid var(--color-border-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Icon size={18} style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--color-text)' }}>{row.label}</span>
            </div>
            {row.kind === 'toggle' ? (
              <ToggleSwitch checked={!!settings[row.key]} onChange={() => onChange(row.key, !settings[row.key])} />
            ) : (
              <select className="form-control" value={settings[row.key]} onChange={e => onChange(row.key, e.target.value)}
                style={{ width: 'auto', minWidth: 92, fontSize: '0.85rem', padding: '4px 26px 4px 10px', fontWeight: 600, color: 'var(--color-primary)' }}>
                {row.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Question labels are rich text (HTML). Anywhere one is shown as plain text — the
// Logic dropdown, summaries — the markup has to come off, or the author reads
// "<p><strong><em>fgh</em>…" instead of "fgh". Parsing via the DOM also decodes
// entities (&nbsp;, &amp;) that a naive tag-strip regex would leave behind.
const plainText = (html) => {
  if (!html) return '';
  const el = document.createElement('div');
  el.innerHTML = html;
  // &nbsp; decodes to  , which is not matched by \s in older engines — kill it explicitly.
  return (el.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
};

const truncate = (s, n = 60) => (s && s.length > n ? `${s.slice(0, n).trimEnd()}…` : s || '');

// Items that carry a respondent-visible question number. Page breaks and section
// headers are structure, not questions — they must not inflate the count.
const isRealQuestion = (q) =>
  q && q.question_type !== 'page_break' && q.question_type !== 'section_header';

// Reassign sort_order AND keep every skip-logic reference pointing at the same
// target after the list is reordered.
//
// go_to values (question-level `q.go_to` and option-level `opt.go_to`) are 1-based
// positions in the full list. When a question is added / deleted / moved, those
// positions shift — so a rule that said "skip to Q5" would silently point at
// whatever now sits in slot 5. This remaps by IDENTITY: `afterRaw` must preserve
// the original question objects for survivors (build it with slice/splice/filter,
// no spread), so each old go_to is resolved to its target object and rewritten to
// that object's NEW position. A rule whose target was deleted is cleared to null.
const renumberLogic = (before, afterRaw) => {
  const newPos = new Map();
  afterRaw.forEach((q, i) => newPos.set(q, i + 1));
  const remap = (val) => {
    if (val == null || val === '') return null;
    if (val === 'end') return 'end';
    const target = before[parseInt(val, 10) - 1];
    if (!target) return null;
    const np = newPos.get(target);
    return np ? String(np) : null; // target removed → drop the dangling rule
  };
  return afterRaw.map((q, i) => {
    const nq = { ...q, sort_order: i };
    if (nq.go_to != null && nq.go_to !== '') nq.go_to = remap(nq.go_to);
    if (Array.isArray(nq.options)) {
      nq.options = nq.options.map((o) =>
        (o && typeof o === 'object' && o.go_to != null && o.go_to !== '')
          ? { ...o, go_to: remap(o.go_to) } : o);
    }
    return nq;
  });
};

const normalizeOption = (opt) => {
  if (typeof opt === 'string') return { text: opt, image: '', go_to: null, requires_text: false };
  return {
    text: opt?.text || '',
    image: opt?.image || '',
    go_to: opt?.go_to ?? null,
    requires_text: !!opt?.requires_text,
  };
};

const serializeOptions = (options) => {
  return options.map(o => {
    const norm = normalizeOption(o);
    const result = { text: norm.text };
    if (norm.image) result.image = norm.image;
    if (norm.go_to !== null && norm.go_to !== undefined && norm.go_to !== '') result.go_to = norm.go_to;
    if (norm.requires_text) result.requires_text = true;
    if (!result.image && !result.go_to && !result.requires_text) return result.text;
    return result;
  });
};

const resolveImg = (url) => {
  if (!url) return null;
  return url.startsWith('http') ? url : `${BACKEND_URL}${url}`;
};

/* ── Reusable section header ── */
function SectionHeader({ icon: Icon, title, subtitle, action }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--color-border-light)', background: 'var(--color-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {Icon && <Icon size={17} style={{ color: 'var(--color-primary)' }} />}
        <div>
          <h3 style={{ fontSize: '0.95rem', margin: 0, fontWeight: 600 }}>{title}</h3>
          {subtitle && <p style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', margin: '1px 0 0' }}>{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ── Image upload button ── */
function ImageUploadButton({ currentImage, onUpload, onRemove, label, height = 48, maxWidth = 120 }) {
  const fileRef = useRef();
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadSurveyImage(file);
      onUpload(res.data.url);
    } catch { alert('Image upload failed'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const imgSrc = resolveImg(currentImage);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
      {imgSrc ? (
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <img src={imgSrc} alt="" style={{ height, maxWidth, objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }} />
          <button onClick={onRemove} title="Remove" type="button"
            style={{ position: 'absolute', top: -6, right: -6, background: 'var(--color-error)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
            <X size={10} />
          </button>
        </div>
      ) : (
        <button className="btn btn-sm btn-secondary" onClick={() => fileRef.current?.click()} disabled={uploading} type="button"
          style={{ fontSize: '0.8rem' }}>
          {uploading ? <Loader size={12} className="spinning" /> : <Image size={13} />}
          {label || 'Image'}
        </button>
      )}
    </div>
  );
}

/* ── SurveyMonkey-style "Add content" dropdown button ── */
function AddContentButton({ onAddQuestion, onAddText, onPaste }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);
  const items = [
    { icon: Edit3, label: 'Question', onClick: onAddQuestion, divider: false },
    { icon: PenLine, label: 'Text', onClick: onAddText, divider: false },
    { icon: ClipboardPaste, label: 'Copy and paste questions', onClick: onPaste, divider: true },
  ];
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'var(--color-success)', color: 'var(--color-text-inverse)',
          border: 'none', borderRadius: 'var(--radius)', padding: '12px 22px', fontSize: '1rem', fontWeight: 700,
          cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.12)' }}>
        <PlusCircle size={20} /> Add content <ChevronDown size={16} style={{ marginLeft: 2 }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: 300, background: 'var(--color-surface)',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', boxShadow: '0 10px 30px rgba(15,23,42,0.18)',
          overflow: 'hidden', zIndex: 50 }}>
          {items.map((it, i) => {
            const Icon = it.icon;
            return (
              <button key={it.label} type="button"
                onClick={() => { setOpen(false); it.onClick(); }}
                style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', textAlign: 'left',
                  padding: '14px 22px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.95rem',
                  color: 'var(--color-text)', borderTop: it.divider ? '1px solid var(--color-border-light)' : 'none' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-raised)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                <Icon size={20} style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} /> {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Read-only preview of a question (the non-editing card body, image 4) ── */
function QuestionPreview({ q, qNum, isSectionHeader, isPageBreak }) {
  const opts = Array.isArray(q.options) ? q.options.map(normalizeOption) : [];
  const choiceMarker = (filled) => (
    <span style={{ width: 18, height: 18, borderRadius: q.question_type === 'checkbox' || q.question_type === 'multi_select' ? 4 : '50%',
      border: '2px solid var(--color-text-light)', display: 'inline-block', flexShrink: 0 }} />
  );

  if (isSectionHeader) {
    // q.label holds rich-text HTML from the "Add content → Text" editor. Render it
    // through the read-only Quill view so it looks exactly like the editor.
    const hasText = q.label && q.label.replace(/<(.|\n)*?>/g, '').trim();
    return hasText
      ? <RichTextView html={q.label} style={{ color: 'var(--color-text)' }} />
      : <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-text-light)' }}>Text block</div>;
  }
  if (isPageBreak) {
    return <div style={{ textAlign: 'center', color: 'var(--color-info)', fontWeight: 600, letterSpacing: 1, fontSize: '0.85rem' }}>— PAGE BREAK —</div>;
  }

  const title = (
    <div style={{ fontSize: '1.05rem', color: 'var(--color-text)', marginBottom: 18, lineHeight: 1.4 }}>
      {q.is_required && <span style={{ color: 'var(--color-error)', marginRight: 4 }}>*</span>}
      <span style={{ fontWeight: 600 }}>{qNum}. </span>
      {q.label
        ? <InlineRichText text={q.label} />
        : <span style={{ color: 'var(--color-text-light)' }}>(untitled question)</span>}
    </div>
  );

  let body = null;
  const t = q.question_type;
  if (['radio', 'select', 'checkbox', 'multi_select', 'yes_no'].includes(t)) {
    const list = t === 'yes_no'
      ? (opts.length >= 2 ? opts : [{ text: 'Yes' }, { text: 'No' }])
      : opts;
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {(list.length ? list : [{ text: '' }]).map((o, i) => (
          <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--color-text-secondary)', fontSize: '0.95rem' }}>
            {choiceMarker()} {o.text || <span style={{ color: 'var(--color-text-light)' }}>Option {i + 1}</span>}
          </label>
        ))}
      </div>
    );
  } else if (t === 'rating') {
    body = <div style={{ display: 'flex', gap: 6 }}>{[1, 2, 3, 4, 5].map(n => <Star key={n} size={26} style={{ color: 'var(--color-border-strong)' }} />)}</div>;
  } else if (t === 'linear_scale') {
    body = <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{Array.from({ length: 10 }, (_, i) => (
      <span key={i} style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--color-border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{i + 1}</span>
    ))}</div>;
  } else if (t === 'nps') {
    body = (
      <div style={{ maxWidth: 440 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{Array.from({ length: 11 }, (_, i) => (
          <span key={i} style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--color-border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{i}</span>
        ))}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: '0.78rem', color: 'var(--color-text-light)' }}>
          <span>Not at all likely</span><span>Extremely likely</span>
        </div>
      </div>
    );
  } else if (t === 'matrix') {
    const rows = Array.isArray(q.options?.rows) ? q.options.rows : [];
    const cols = Array.isArray(q.options?.columns) ? q.options.columns : [];
    body = (
      <table style={{ borderCollapse: 'collapse', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
        <thead><tr><th></th>{cols.map((c, i) => <th key={i} style={{ padding: '4px 12px', fontWeight: 600 }}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, ri) => (
          <tr key={ri}><td style={{ padding: '4px 12px 4px 0' }}>{r}</td>{cols.map((_, ci) => (
            <td key={ci} style={{ textAlign: 'center' }}>{choiceMarker()}</td>
          ))}</tr>
        ))}</tbody>
      </table>
    );
  } else if (t === 'textarea') {
    body = <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', height: 80, background: 'var(--color-surface)' }} />;
  } else {
    // text, number, email, phone, url, date, time, file_upload
    body = <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', height: 40, maxWidth: 420, background: 'var(--color-surface)' }} />;
  }

  return (
    <div>
      {title}
      {q.image && <img src={resolveImg(q.image)} alt="" style={{ maxHeight: 140, borderRadius: 'var(--radius-sm)', marginBottom: 14, display: 'block' }} />}
      {body}
    </div>
  );
}

/* ── Options tab (image 3). Only "Require an answer" persists (→ is_required);
   the rest are SurveyMonkey-style display controls kept as local UI state. ── */
function OptionsTab({ isRequired, onToggleRequired }) {
  const [errorMsg, setErrorMsg] = useState('This question requires an answer.');
  const [flags, setFlags] = useState({ layout: false, randomize: false, adjust: false });
  const row = (checked, onChange, label, children) => (
    <div style={{ borderBottom: '1px solid var(--color-border-light)', padding: '16px 4px' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={checked} onChange={onChange} style={{ marginTop: 3, width: 18, height: 18, accentColor: 'var(--color-success)' }} />
        <span style={{ fontSize: '0.95rem', color: 'var(--color-text)' }}>{label}</span>
      </label>
      {children}
    </div>
  );
  return (
    <div>
      {row(isRequired, e => onToggleRequired(e.target.checked), 'Require an answer to this question',
        isRequired && (
          <div style={{ paddingLeft: 30, marginTop: 12 }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 6 }}>Display this error message when this question is not answered.</div>
            <textarea className="form-control" rows={2} value={errorMsg} onChange={e => setErrorMsg(e.target.value)} style={{ resize: 'vertical' }} />
          </div>
        ))}
      {row(flags.layout, e => setFlags(f => ({ ...f, layout: e.target.checked })), 'Change the layout for how choices are displayed')}
      {row(flags.randomize, e => setFlags(f => ({ ...f, randomize: e.target.checked })), "Randomize, sort, or flip choices (does not apply to 'Other' or 'None of the above' answer choices)")}
      {row(flags.adjust, e => setFlags(f => ({ ...f, adjust: e.target.checked })), 'Adjust question layout')}
    </div>
  );
}

/* ── "Choose a question type" grid panel (images 8 & 9) ── */
function QuestionTypePicker({ currentType, onSelect }) {
  const [showTooltips, setShowTooltips] = useState(true);
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '20px 22px' }}>
      <h3 style={{ margin: '0 0 18px', fontSize: '1.15rem', color: 'var(--color-text)' }}>Choose a question type</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '8px 24px' }}>
        {QUESTION_TYPE_GRID.map(group => (
          <div key={group.group} style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-secondary)', margin: '8px 0 6px' }}>{group.group}</div>
            {group.items.map(it => {
              const Icon = it.icon;
              const active = it.type === currentType;
              return (
                <button key={it.label} type="button" title={showTooltips ? it.label : undefined}
                  onClick={() => onSelect(it.type)}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left',
                    background: active ? 'var(--color-primary-bg)' : 'none', border: 'none', cursor: 'pointer',
                    padding: '9px 10px', borderRadius: 'var(--radius-sm)', fontSize: '0.92rem',
                    color: active ? 'var(--color-primary)' : 'var(--color-text)', fontWeight: active ? 600 : 400 }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--color-surface-raised)'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none'; }}>
                  <Icon size={20} style={{ color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)', flexShrink: 0 }} /> {it.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {/* "Show tooltips" toggle (display-only) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--color-border-light)' }}>
        <ToggleSwitch checked={showTooltips} onChange={() => setShowTooltips(v => !v)} />
        <span style={{ fontSize: '0.9rem', color: 'var(--color-text)' }}>Show tooltips</span>
      </div>
    </div>
  );
}

export default function SurveyEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [survey, setSurvey] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [introFields, setIntroFields] = useState([]);
  const [status, setStatus] = useState('draft');
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [showLogicFor, setShowLogicFor] = useState(null); // kept for type change cleanup
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [introOpen, setIntroOpen] = useState(true);
  const [displaySettings, setDisplaySettings] = useState(DEFAULT_DISPLAY_SETTINGS);
  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false);
  const [optionsMenuPos, setOptionsMenuPos] = useState(null); // { top, right } in viewport coords (fixed)
  const optionsBtnRef = useRef();
  const optionsMenuRef = useRef();
  // ── SurveyMonkey-style editor state ──
  const [editingIdx, setEditingIdx] = useState(null);   // which question card is open in the tabbed editor
  const [editorTab, setEditorTab] = useState('edit');   // edit | options | logic | move | copy
  const [pasteOpen, setPasteOpen] = useState(false);    // "Copy and paste questions" box
  const [pasteText, setPasteText] = useState('');
  const [pasteAfter, setPasteAfter] = useState(null);   // insert pasted questions after this index (null = end)
  const [hoverIdx, setHoverIdx] = useState(null);       // card under the mouse (shows the toolbar)
  const [typePickerOpen, setTypePickerOpen] = useState(false); // "Choose a question type" grid in the Edit tab

  useEffect(() => {
    async function load() {
      try {
        const res = await getSurvey(id);
        const s = res.data;
        setSurvey(s);
        setTitle(s.title);
        setDescription(s.description || '');
        setCoverImage(s.cover_image || '');
        setIntroFields(s.intro_fields || []);
        setDisplaySettings({ ...DEFAULT_DISPLAY_SETTINGS, ...(s.settings || {}) });
        setStatus(s.status);
        setQuestions(s.questions.map(q => {
          // Matrix stores options as { rows, columns, multi_select } instead of a list.
          if (q.question_type === 'matrix') {
            const rows = Array.isArray(q.options?.rows) ? q.options.rows : [];
            const columns = Array.isArray(q.options?.columns) ? q.options.columns : [];
            return {
              label: q.label,
              question_type: q.question_type,
              options: { rows, columns, multi_select: !!q.options?.multi_select },
              image: q.image || '',
              is_required: q.is_required,
              sort_order: q.sort_order,
              go_to: null,
            };
          }
          const opts = (Array.isArray(q.options) ? q.options : []).map(normalizeOption);
          // Extract question-level go_to from options (for non-option types like text, number, etc.)
          let qGoTo = null;
          if (!NEEDS_OPTIONS.includes(q.question_type) && q.question_type !== 'yes_no') {
            const goToOpt = opts.find(o => o.go_to && !o.text);
            if (goToOpt) qGoTo = goToOpt.go_to;
          }
          return {
            label: q.label,
            question_type: q.question_type,
            options: opts.filter(o => o.text), // remove question-level go_to markers
            image: q.image || '',
            is_required: q.is_required,
            sort_order: q.sort_order,
            go_to: qGoTo,
          };
        }));
      } catch { setError('Failed to load survey'); }
      finally { setLoading(false); }
    }
    load();
  }, [id]);

  // ── Display-options menu: open (anchored to button) + close on outside click / scroll / resize ──
  const openOptionsMenu = () => {
    const r = optionsBtnRef.current?.getBoundingClientRect();
    if (r) setOptionsMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    setOptionsMenuOpen(true);
  };
  useEffect(() => {
    if (!optionsMenuOpen) return;
    const onDocClick = (e) => {
      if (optionsMenuRef.current?.contains(e.target) || optionsBtnRef.current?.contains(e.target)) return;
      setOptionsMenuOpen(false);
    };
    const close = () => setOptionsMenuOpen(false);
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [optionsMenuOpen]);
  const updateDisplaySetting = (key, value) => setDisplaySettings(prev => ({ ...prev, [key]: value }));

  // ── Question helpers ──
  const blankQuestion = (type = 'radio') => ({
    label: '', question_type: type,
    options: type === 'radio' || type === 'checkbox' || type === 'select' || type === 'multi_select'
      ? [{ text: '', image: '', go_to: null }, { text: '', image: '', go_to: null }] : [],
    image: '', is_required: false, sort_order: 0, go_to: null,
  });
  // Insert `item` after index `afterIdx` (null = append), open its editor, and renumber.
  // `openPicker` shows the "Choose a question type" grid right away (for fresh questions).
  const insertQuestion = (item, afterIdx, openPicker = false) => {
    setQuestions(prev => {
      const pos = afterIdx == null ? prev.length : afterIdx + 1;
      const next = renumberLogic(prev, [...prev.slice(0, pos), item, ...prev.slice(pos)]);
      setEditingIdx(pos); setEditorTab('edit'); setTypePickerOpen(openPicker);
      return next;
    });
  };
  // "Add content → Question": a fresh multiple-choice question (opens the type picker).
  const addQuestion = (afterIdx = null) => insertQuestion(blankQuestion('radio'), afterIdx, true);
  // "Add content → Text": a section-header / text block.
  const addText = (afterIdx = null) =>
    insertQuestion({ label: '', question_type: 'section_header', options: [], image: '', is_required: false, sort_order: 0, go_to: null }, afterIdx, false);
  // "New Page": insert a page break (no editor, no picker).
  const addPageBreak = (afterIdx = null) => {
    setQuestions(prev => {
      const pos = afterIdx == null ? prev.length : afterIdx + 1;
      const item = { label: '', question_type: 'page_break', options: [], image: '', is_required: false, sort_order: 0, go_to: null };
      return renumberLogic(prev, [...prev.slice(0, pos), item, ...prev.slice(pos)]);
    });
  };
  // Duplicate a question directly after it.
  const copyQuestion = (idx) => {
    setQuestions(prev => {
      const src = prev[idx];
      const clone = JSON.parse(JSON.stringify(src));
      const next = renumberLogic(prev, [...prev.slice(0, idx + 1), clone, ...prev.slice(idx + 1)]);
      return next;
    });
  };
  // "Copy and paste questions": one question per non-empty line, inserted after `pasteAfter`.
  const applyPaste = () => {
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length) {
      const items = lines.map(label => ({ label, question_type: 'radio',
        options: [{ text: '', image: '', go_to: null }, { text: '', image: '', go_to: null }],
        image: '', is_required: false, sort_order: 0, go_to: null }));
      setQuestions(prev => {
        const pos = pasteAfter == null ? prev.length : pasteAfter + 1;
        return renumberLogic(prev, [...prev.slice(0, pos), ...items, ...prev.slice(pos)]);
      });
    }
    setPasteText(''); setPasteOpen(false); setPasteAfter(null);
  };
  const openPaste = (afterIdx = null) => { setPasteAfter(afterIdx); setPasteOpen(true); };
  const updateQuestion = (idx, field, value) => setQuestions(prev => prev.map((q, i) => i === idx ? { ...q, [field]: value } : q));
  const removeQuestion = (idx) => {
    setQuestions(prev => renumberLogic(prev, prev.filter((_, i) => i !== idx)));
    if (showLogicFor === idx) setShowLogicFor(null);
    setEditingIdx(null); setHoverIdx(null); setTypePickerOpen(false);
  };
  const addOption = (idx) => setQuestions(prev => prev.map((q, i) => i === idx ? { ...q, options: [...q.options, { text: '', image: '', go_to: null }] } : q));
  const updateOptionField = (qIdx, oIdx, field, value) => {
    setQuestions(prev => prev.map((q, i) => {
      if (i !== qIdx) return q;
      const opts = [...q.options];
      opts[oIdx] = { ...normalizeOption(opts[oIdx]), [field]: value };
      return { ...q, options: opts };
    }));
  };
  const removeOption = (qIdx, oIdx) => setQuestions(prev => prev.map((q, i) => i !== qIdx ? q : { ...q, options: q.options.filter((_, j) => j !== oIdx) }));

  // ── Matrix helpers (rows + columns are plain string arrays; multi_select toggles checkbox mode) ──
  const ensureMatrixShape = (opts) => ({
    rows: Array.isArray(opts?.rows) ? opts.rows : [],
    columns: Array.isArray(opts?.columns) ? opts.columns : [],
    multi_select: !!opts?.multi_select,
  });
  const setMatrixField = (qIdx, key, list) => setQuestions(prev => prev.map((q, i) => {
    if (i !== qIdx) return q;
    const m = ensureMatrixShape(q.options);
    return { ...q, options: { ...m, [key]: list } };
  }));
  const addMatrixRow = (qIdx) => setQuestions(prev => prev.map((q, i) => {
    if (i !== qIdx) return q;
    const m = ensureMatrixShape(q.options);
    return { ...q, options: { ...m, rows: [...m.rows, ''] } };
  }));
  const addMatrixColumn = (qIdx) => setQuestions(prev => prev.map((q, i) => {
    if (i !== qIdx) return q;
    const m = ensureMatrixShape(q.options);
    return { ...q, options: { ...m, columns: [...m.columns, ''] } };
  }));
  const handleTypeChange = (qIdx, newType) => {
    setQuestions(prev => prev.map((q, i) => {
      if (i !== qIdx) return q;
      const label = newType === 'nps' && !q.label.trim() ? NPS_DEFAULT_LABEL : q.label;
      if (newType === 'matrix' && !Array.isArray(q.options?.rows)) {
        return { ...q, question_type: newType, go_to: null, options: { rows: [''], columns: ['', ''], multi_select: false } };
      }
      if (q.question_type === 'matrix' && newType !== 'matrix') {
        return { ...q, label, question_type: newType, options: [] };
      }
      return { ...q, label, question_type: newType };
    }));
  };
  const moveQuestion = (idx, dir) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= questions.length) return;
    const arr = [...questions];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    setQuestions(renumberLogic(questions, arr));
  };
  const moveQuestionTo = (fromIdx, toPos) => {
    const toIdx = toPos - 1;
    if (toIdx < 0 || toIdx >= questions.length || toIdx === fromIdx) return;
    const arr = [...questions];
    const [item] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, item);
    setQuestions(renumberLogic(questions, arr));
  };

  // ── Intro helpers ──
  const addIntroField = () => setIntroFields(prev => [...prev, { label: '', field_type: 'text', is_required: false, is_unique: false }]);
  const updateIntroField = (idx, field, value) => setIntroFields(prev => prev.map((f, i) => i === idx ? { ...f, [field]: value } : f));
  const removeIntroField = (idx) => setIntroFields(prev => prev.filter((_, i) => i !== idx));

  const hasAnyLogic = questions.some(q =>
    q.go_to || (Array.isArray(q.options) && q.options.some(o => normalizeOption(o).go_to !== null && normalizeOption(o).go_to !== ''))
  );

  const handleSave = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        cover_image: coverImage || null,
        intro_fields: introFields.filter(f => f.label.trim()),
        settings: displaySettings,
        status,
        questions: questions.map((q, i) => ({
          label: q.label, question_type: q.question_type, sort_order: i,
          image: q.image || null, is_required: q.is_required,
          options: q.question_type === 'matrix'
            ? {
                rows: (q.options?.rows || []).map(r => (r || '').trim()).filter(Boolean),
                columns: (q.options?.columns || []).map(c => (c || '').trim()).filter(Boolean),
                multi_select: !!q.options?.multi_select,
              }
            : NEEDS_OPTIONS.includes(q.question_type)
              ? serializeOptions(q.options).filter(o => (typeof o === 'string' ? o.trim() : o.text?.trim()))
              : (q.question_type === 'yes_no' && Array.isArray(q.options) && q.options.some(o => normalizeOption(o).go_to))
                ? serializeOptions(q.options)
                : q.go_to ? [{ go_to: q.go_to }] : null,
        })),
      };
      const res = await updateSurvey(id, payload);
      setSurvey(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { setError('Failed to save'); }
    finally { setSaving(false); }
  };

  const copyLink = () => {
    if (!survey) return;
    navigator.clipboard.writeText(`${window.location.origin}/survey/${survey.token}`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  if (loading) {
    return <div className="page container"><div className="loading-container"><div className="spinner"></div><p>Loading survey...</p></div></div>;
  }

  // Jump targets for the Logic tab.
  //
  // `value` stays the 1-based position in the FULL question list — that is what the
  // runtime matches against `sort_order` (see getPageForTarget in PublicSurveyPage).
  // Renumbering it would silently repoint every existing rule, so only the *label*
  // is renumbered.
  //
  // Page breaks are excluded: splitIntoPages()/buildLogicPages() drop them from the
  // page list, so getPageForTarget() can never resolve one — picking a page break
  // produced a jump that silently did nothing. Section headers DO sit on a page, so
  // they remain valid targets (survey 2 already has a rule pointing at one) but are
  // labelled as sections rather than numbered as questions.
  const logicTargets = (() => {
    const out = [{ value: '', label: '-- Choose page --' }];
    let qNum = 0;
    questions.forEach((q, i) => {
      if (q.question_type === 'page_break') return;
      const value = String(i + 1);
      const text = truncate(plainText(q.label)) || '(untitled)';
      if (q.question_type === 'section_header') {
        out.push({ value, label: `Section: ${text}` });
      } else {
        // Numbered the way the respondent sees it — headers and page breaks skipped.
        qNum += 1;
        out.push({ value, label: `Q${qNum}: ${text}` });
      }
    });
    out.push({ value: 'end', label: 'End survey' });
    return out;
  })();

  // "New Page" button — sits to the right of "Add content" and inserts a page break.
  const renderNewPageBtn = (afterIdx = null) => (
    <button type="button" onClick={() => addPageBreak(afterIdx)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--color-surface)', color: 'var(--color-text)',
        border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '12px 18px',
        fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer' }}>
      <FileText size={18} style={{ color: 'var(--color-text-secondary)' }} /> New Page
    </button>
  );

  // ── Per-question hover toolbar (image 4) ──
  const TOOLBAR_BTNS = [
    { key: 'edit', label: 'Edit', icon: PenLine, color: 'var(--color-success)', textColor: 'var(--color-surface)' },
    { key: 'options', label: 'Options', icon: Settings },
    { key: 'logic', label: 'Logic', icon: GitBranch },
    { key: 'move', label: 'Move', icon: MoveVertical },
    { key: 'copy', label: 'Copy', icon: Copy },
    { key: 'library', label: 'Library', icon: BookOpen, color: 'var(--color-warning)', textColor: 'var(--color-surface)' },
    { key: 'delete', label: 'Delete', icon: Trash2 },
  ];
  const renderToolbar = (idx, isPageBreak = false) => (
    <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 4, zIndex: 5 }}>
      {/* A page break has no editable content — only Move / Delete apply. */}
      {!isPageBreak && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)', padding: '3px 8px', marginRight: 2 }}>
          <MessageSquare size={14} style={{ color: 'var(--color-text-light)' }} /> <span style={{ fontSize: '0.75rem', color: 'var(--color-text-light)' }}>0</span>
        </div>
      )}
      {TOOLBAR_BTNS.filter(b => !isPageBreak || b.key === 'move' || b.key === 'delete').map(b => {
        const Icon = b.icon;
        return (
          <button key={b.key} type="button" title={b.label}
            onClick={() => {
              if (b.key === 'delete') { removeQuestion(idx); return; }
              if (b.key === 'copy') { copyQuestion(idx); return; }
              if (b.key === 'library') { alert('Question library — coming soon.'); return; }
              setEditingIdx(idx); setEditorTab(b.key); setTypePickerOpen(false);
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', cursor: 'pointer',
              borderRadius: 'var(--radius-sm)', padding: '6px 10px', fontSize: '0.8rem', fontWeight: 600,
              background: b.color || 'var(--color-text-secondary)', color: b.textColor || 'var(--color-text-inverse)' }}>
            <Icon size={13} /> {b.label}
          </button>
        );
      })}
    </div>
  );

  // ── Tabbed question editor (images 2,3,5) ──
  const EDITOR_TABS = [
    { key: 'edit', label: 'Edit' }, { key: 'options', label: 'Options' },
    { key: 'logic', label: 'Logic' }, { key: 'move', label: 'Move' }, { key: 'copy', label: 'Copy' },
  ];
  const hasOtherOption = (q) => Array.isArray(q.options) && q.options.some(o => normalizeOption(o).requires_text);
  const toggleOtherOption = (idx, q) => {
    if (hasOtherOption(q)) {
      updateQuestion(idx, 'options', q.options.filter(o => !normalizeOption(o).requires_text));
    } else {
      updateQuestion(idx, 'options', [...q.options, { text: 'Other (please specify)', image: '', go_to: null, requires_text: true }]);
    }
  };
  const reverseAnswers = (idx, q) => updateQuestion(idx, 'options', [...q.options].reverse());

  const renderEditor = (q, idx, qNum) => {
    const isSectionHeader = q.question_type === 'section_header';
    const isPageBreak = q.question_type === 'page_break';
    const isNonInput = isSectionHeader || isPageBreak;
    const isOptionType = NEEDS_OPTIONS.includes(q.question_type);
    const isYesNo = q.question_type === 'yes_no';
    const isMatrix = q.question_type === 'matrix';
    const yesNoOptions = isYesNo
      ? (q.options.length >= 2 ? q.options : [{ text: 'Yes', image: '', go_to: null }, { text: 'No', image: '', go_to: null }])
      : q.options;

    const tabBtn = (t) => (
      <button key={t.key} type="button" onClick={() => setEditorTab(t.key)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '14px 4px', fontSize: '0.95rem',
          fontWeight: 700, color: editorTab === t.key ? 'var(--color-success)' : 'var(--color-text-secondary)',
          borderBottom: editorTab === t.key ? '3px solid var(--color-success)' : '3px solid transparent', marginBottom: -1 }}>
        {t.label}
      </button>
    );

    return (
      <div>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 28, padding: '0 22px', borderBottom: '1px solid var(--color-border)' }}>
          {EDITOR_TABS.map(tabBtn)}
        </div>

        <div style={{ padding: 22, background: 'var(--color-bg)' }}>
          {/* ───── EDIT TAB ───── */}
          {editorTab === 'edit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: isNonInput ? '1fr' : '50px 1fr 240px', gap: 12, alignItems: 'start' }}>
                {!isNonInput && <div style={{ fontWeight: 700, fontSize: '1.1rem', paddingTop: 8 }}>Q{qNum}</div>}
                {isSectionHeader ? (
                  <div style={{ background: 'var(--color-surface)', borderRadius: 6 }}>
                    <ReactQuill theme="snow" value={q.label || ''}
                      onChange={val => updateQuestion(idx, 'label', val)}
                      placeholder="Enter text…" modules={TEXT_BLOCK_QUILL_MODULES} />
                  </div>
                ) : (
                  <input className="form-control"
                    placeholder={isPageBreak ? 'Page break label (optional)' : 'Enter your question'}
                    value={q.label} onChange={e => updateQuestion(idx, 'label', e.target.value)}
                    style={isNonInput ? { fontWeight: 600 } : {}} />
                )}
                {!isNonInput && (
                  <button type="button" className="form-control"
                    onClick={() => setTypePickerOpen(o => !o)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer',
                      background: 'var(--color-surface)', textAlign: 'left', fontWeight: 600,
                      color: typePickerOpen ? 'var(--color-primary)' : 'var(--color-text)',
                      borderColor: typePickerOpen ? 'var(--color-primary)' : undefined }}>
                    {GRID_LABEL_FOR_TYPE[q.question_type] || 'Choose type'}
                    <ChevronDown size={16} style={{ flexShrink: 0 }} />
                  </button>
                )}
              </div>

              {/* "Choose a question type" grid replaces the edit fields while open */}
              {!isNonInput && typePickerOpen && (
                <QuestionTypePicker currentType={q.question_type}
                  onSelect={t => { handleTypeChange(idx, t); setTypePickerOpen(false); }} />
              )}

              {!typePickerOpen && (<>
              {!isNonInput && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ImageUploadButton currentImage={q.image} onUpload={url => updateQuestion(idx, 'image', url)} onRemove={() => updateQuestion(idx, 'image', '')} label="Question Image" />
                  {q.image && <span style={{ fontSize: '0.75rem', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={12} /> Image attached</span>}
                </div>
              )}

              {/* Answer choices */}
              {isOptionType && (
                <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)', padding: 16 }}>
                  {q.options.map((opt, oIdx) => {
                    const o = normalizeOption(opt);
                    return (
                      <div key={oIdx} style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                        <span style={{ width: 18, height: 18, borderRadius: q.question_type === 'checkbox' || q.question_type === 'multi_select' ? 4 : '50%', border: '2px solid var(--color-text-light)', flexShrink: 0 }} />
                        <input className="form-control" style={{ flex: 1 }} placeholder={`Answer ${oIdx + 1}`} value={o.text}
                          onChange={e => updateOptionField(idx, oIdx, 'text', e.target.value)} />
                        <button type="button" title={o.requires_text ? 'Free-text enabled' : 'Allow free-text input for this choice'}
                          onClick={() => updateOptionField(idx, oIdx, 'requires_text', !o.requires_text)}
                          style={{ background: o.requires_text ? 'var(--color-primary-bg)' : 'none', border: '1px solid', borderColor: o.requires_text ? 'var(--color-primary)' : 'var(--color-border)', cursor: 'pointer', padding: '5px 7px', borderRadius: 4, color: o.requires_text ? 'var(--color-primary)' : 'var(--color-text-light)' }}>
                          <Type size={14} />
                        </button>
                        <button type="button" title="Add" onClick={() => addOption(idx)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-success)', padding: 4 }}><PlusCircle size={18} /></button>
                        <button type="button" title="Delete" onClick={() => removeOption(idx, oIdx)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-light)', padding: 4 }}><Trash2 size={16} /></button>
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <button type="button" onClick={() => reverseAnswers(idx, q)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <ArrowDown size={14} /> Reverse answer order
                    </button>
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => addOption(idx)} style={{ fontSize: '0.85rem' }}>
                      <Plus size={13} /> Add answer
                    </button>
                  </div>
                </div>
              )}

              {/* Yes / No */}
              {isYesNo && (
                <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {yesNoOptions.map((opt, oIdx) => {
                    const o = normalizeOption(opt);
                    return (
                      <div key={oIdx} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--color-text-light)' }} />
                        <input className="form-control" style={{ maxWidth: 200 }} value={o.text}
                          onChange={e => {
                            const newOpts = [...yesNoOptions];
                            newOpts[oIdx] = { ...normalizeOption(newOpts[oIdx]), text: e.target.value };
                            updateQuestion(idx, 'options', newOpts);
                          }} />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* NPS — fixed 0–10 scale, so there is nothing to configure */}
              {q.question_type === 'nps' && (
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', margin: 0 }}>
                  Respondents pick a score from 0 to 10. Results show the NPS: % promoters (9–10) minus % detractors (0–6), from −100 to +100.
                </p>
              )}

              {/* Matrix */}
              {isMatrix && (() => {
                const m = ensureMatrixShape(q.options);
                return (
                  <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)', padding: 16 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer', marginBottom: 12 }}>
                      <input type="checkbox" checked={!!m.multi_select} onChange={e => setMatrixField(idx, 'multi_select', e.target.checked)} />
                      Multiple selection per row
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16 }}>
                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 8 }}>Rows (statements)</label>
                        {m.rows.map((r, rIdx) => (
                          <div key={rIdx} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                            <input className="form-control" style={{ flex: 1 }} placeholder={`Statement ${rIdx + 1}`} value={r}
                              onChange={e => setMatrixField(idx, 'rows', m.rows.map((x, j) => j === rIdx ? e.target.value : x))} />
                            <button onClick={() => setMatrixField(idx, 'rows', m.rows.filter((_, j) => j !== rIdx))} type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', padding: 2 }}><Trash2 size={13} /></button>
                          </div>
                        ))}
                        <button className="btn btn-sm btn-ghost" onClick={() => addMatrixRow(idx)} type="button" style={{ fontSize: '0.8rem' }}><Plus size={12} /> Add Row</button>
                      </div>
                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 8 }}>Columns (choices)</label>
                        {m.columns.map((c, cIdx) => (
                          <div key={cIdx} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                            <input className="form-control" style={{ flex: 1 }} placeholder={`Choice ${cIdx + 1}`} value={c}
                              onChange={e => setMatrixField(idx, 'columns', m.columns.map((x, j) => j === cIdx ? e.target.value : x))} />
                            <button onClick={() => setMatrixField(idx, 'columns', m.columns.filter((_, j) => j !== cIdx))} type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', padding: 2 }}><Trash2 size={13} /></button>
                          </div>
                        ))}
                        <button className="btn btn-sm btn-ghost" onClick={() => addMatrixColumn(idx)} type="button" style={{ fontSize: '0.8rem' }}><Plus size={12} /> Add Column</button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* "Other" option + quiz mode placeholders (image 2) */}
              {isOptionType && (
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 4px', borderTop: '1px solid var(--color-border-light)', cursor: 'pointer', fontSize: '0.9rem' }}>
                    <input type="checkbox" checked={hasOtherOption(q)} onChange={() => toggleOtherOption(idx, q)} style={{ width: 18, height: 18, accentColor: 'var(--color-success)' }} />
                    Add an "Other" answer option or comment field
                  </label>
                </div>
              )}

              {isPageBreak && <p style={{ fontSize: '0.85rem', color: 'var(--color-info)', margin: 0 }}>Questions after this break appear on the next page.</p>}
              {isSectionHeader && <p style={{ fontSize: '0.85rem', color: 'var(--color-warning)', margin: 0 }}>A text / section block — respondents can't answer it.</p>}
              </>)}
            </div>
          )}

          {/* ───── OPTIONS TAB ───── */}
          {editorTab === 'options' && (
            isNonInput
              ? <p style={{ color: 'var(--color-text-light)' }}>No options for a text / page-break block.</p>
              : <OptionsTab isRequired={q.is_required} onToggleRequired={v => updateQuestion(idx, 'is_required', v)} />
          )}

          {/* ───── LOGIC TAB (image 5) ───── */}
          {editorTab === 'logic' && (() => {
            if (isMatrix || isNonInput) return <p style={{ color: 'var(--color-text-light)' }}>Skip logic isn't available for this question type.</p>;
            const targets = logicTargets.filter(t => t.value !== String(idx + 1));
            const logicRows = (isOptionType || isYesNo)
              ? (isYesNo ? yesNoOptions : q.options)
              : [null]; // single question-level row for text/number/etc.
            return (
              <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 80px', gap: 12, alignItems: 'center', padding: '12px 18px', background: 'var(--color-surface-raised)', fontWeight: 700, fontSize: '0.88rem' }}>
                  <span>If answer is …</span><span>Then skip to …</span>
                  <button type="button" onClick={() => {
                    if (logicRows[0] === null) { updateQuestion(idx, 'go_to', null); return; }
                    const cleared = (isYesNo ? yesNoOptions : q.options).map(o => ({ ...normalizeOption(o), go_to: null }));
                    updateQuestion(idx, 'options', cleared);
                  }} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontWeight: 700, cursor: 'pointer', textAlign: 'right', fontSize: '0.85rem' }}>Clear All</button>
                </div>
                {logicRows.map((opt, oIdx) => {
                  const isQLevel = opt === null;
                  const o = isQLevel ? null : normalizeOption(opt);
                  const value = isQLevel ? (q.go_to ?? '') : (o.go_to ?? '');
                  const onChange = (val) => {
                    if (isQLevel) { updateQuestion(idx, 'go_to', val || null); return; }
                    const list = isYesNo ? [...yesNoOptions] : [...q.options];
                    list[oIdx] = { ...normalizeOption(list[oIdx]), go_to: val || null };
                    updateQuestion(idx, 'options', list);
                  };
                  return (
                    <div key={oIdx} style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 80px', gap: 12, alignItems: 'center', padding: '14px 18px', borderTop: '1px solid var(--color-border-light)' }}>
                      <span style={{ fontSize: '0.92rem' }}>{isQLevel ? 'Any answer' : (o.text || `Answer ${oIdx + 1}`)}</span>
                      <select className="form-control" value={value} onChange={e => onChange(e.target.value)}>
                        {targets.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        {/* A rule saved against a page break (never a resolvable target) would
                            otherwise render as a blank select and look like "no logic set". */}
                        {value && !targets.some(t => t.value === value) && (
                          <option value={value}>⚠ Invalid target (position {value}) — please re-select</option>
                        )}
                      </select>
                      <button type="button" onClick={() => onChange('')} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer', textAlign: 'right', fontSize: '0.85rem' }}>Clear</button>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* ───── MOVE TAB ───── */}
          {editorTab === 'move' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ fontWeight: 600 }}>Move to position</label>
                <input type="number" min={1} max={questions.length} defaultValue={idx + 1} className="form-control" style={{ width: 90 }}
                  onChange={e => { const v = parseInt(e.target.value); if (v >= 1 && v <= questions.length) { moveQuestionTo(idx, v); setEditingIdx(v - 1); } }} />
                <span style={{ color: 'var(--color-text-light)', fontSize: '0.85rem' }}>of {questions.length}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" type="button" disabled={idx === 0} onClick={() => { moveQuestion(idx, -1); setEditingIdx(idx - 1); }}><ArrowUp size={14} /> Move up</button>
                <button className="btn btn-secondary" type="button" disabled={idx === questions.length - 1} onClick={() => { moveQuestion(idx, 1); setEditingIdx(idx + 1); }}><ArrowDown size={14} /> Move down</button>
              </div>
            </div>
          )}

          {/* ───── COPY TAB ───── */}
          {editorTab === 'copy' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>Create a duplicate of this question right below it.</p>
              <div><button className="btn btn-primary" type="button" onClick={() => { copyQuestion(idx); setEditingIdx(null); }}><Files size={15} /> Make a copy</button></div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 22px', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
          <button className="btn" type="button" onClick={() => addQuestion(idx)}
            style={{ background: 'var(--color-success)', color: 'var(--color-text-inverse)' }}>
            <PlusCircle size={16} /> Next question
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" type="button" onClick={() => { setEditingIdx(null); setTypePickerOpen(false); }}>Cancel</button>
            <button className="btn" type="button" onClick={() => { setEditingIdx(null); setTypePickerOpen(false); }}
              style={{ background: 'var(--color-success)', color: 'var(--color-text-inverse)' }}>Save</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="page container" style={{ maxWidth: 900 }}>
      {/* ── Display-options dropdown (fixed so the card's overflow:hidden doesn't clip it) ── */}
      {optionsMenuOpen && optionsMenuPos && (
        <DisplaySettingsMenu
          menuRef={optionsMenuRef}
          style={{ position: 'fixed', top: optionsMenuPos.top, right: optionsMenuPos.right }}
          settings={displaySettings}
          onChange={updateDisplaySetting}
        />
      )}

      {/* ── Header ── */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost" onClick={() => navigate('/surveys')} style={{ padding: 8 }}><ArrowLeft size={18} /></button>
          <div>
            <h1 style={{ fontSize: '1.4rem', margin: 0 }}>Edit Survey</h1>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', margin: 0 }}>
              {questions.filter(isRealQuestion).length} questions {survey?.response_count ? `/ ${survey.response_count} responses` : ''}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {survey && (
            <>
              <button className="btn btn-sm btn-secondary" onClick={copyLink}>
                {copiedLink ? <><CheckCircle size={13} style={{ color: 'var(--color-success)' }} /> Copied</> : <><Copy size={13} /> Copy Link</>}
              </button>
              {status === 'active' && (
                <button className="btn btn-sm btn-ghost" onClick={() => window.open(`/survey/${survey.token}`, '_blank')}>
                  <ExternalLink size={13} /> Preview
                </button>
              )}
            </>
          )}
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ minWidth: 90 }}>
            {saving ? <Loader size={15} className="spinning" /> : saved ? <><CheckCircle size={15} /> Saved</> : <><Save size={15} /> Save</>}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* ══ Section 1: Survey Settings ══ */}
      <div className="card" style={{ marginBottom: 20, overflow: 'hidden' }}>
        <div style={{ cursor: 'pointer' }} onClick={() => setSettingsOpen(!settingsOpen)}>
          <SectionHeader icon={Settings} title="Survey Settings" subtitle="Title, description, cover image & status"
            action={
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button ref={optionsBtnRef} type="button" title="Display options"
                  className="btn btn-sm btn-ghost"
                  onClick={e => { e.stopPropagation(); optionsMenuOpen ? setOptionsMenuOpen(false) : openOptionsMenu(); }}
                  style={{ padding: 6, color: optionsMenuOpen ? 'var(--color-primary)' : 'var(--color-text-light)' }}>
                  <SlidersHorizontal size={17} />
                </button>
                {settingsOpen ? <ChevronUp size={18} style={{ color: 'var(--color-text-light)' }} /> : <ChevronDown size={18} style={{ color: 'var(--color-text-light)' }} />}
              </div>
            } />
        </div>
        {settingsOpen && (
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Survey Title *</label>
                <input className="form-control" value={title} onChange={e => setTitle(e.target.value)} placeholder="Enter survey title" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Status</label>
                <select className="form-control" value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Description (optional)</label>
              <ReactQuill theme="snow" value={description} onChange={setDescription} placeholder="Brief description..."
                modules={{ toolbar: [['bold', 'italic', 'underline', 'strike'], [{ 'header': [1, 2, 3, false] }], [{ 'list': 'ordered' }, { 'list': 'bullet' }], [{ 'align': [] }], ['link'], ['clean']] }}
                style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)' }} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 6 }}>Cover Image</label>
              {coverImage ? (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img src={resolveImg(coverImage)} alt="Cover" style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 'var(--radius)', border: '1px solid var(--color-border)', objectFit: 'cover' }} />
                  <button onClick={() => setCoverImage('')} title="Remove" type="button"
                    style={{ position: 'absolute', top: 6, right: 6, background: 'var(--color-error)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <ImageUploadButton currentImage="" onUpload={setCoverImage} onRemove={() => {}} label="Upload Cover Image" />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ══ Section 2: Intro Fields ══ */}
      <div className="card" style={{ marginBottom: 20, overflow: 'hidden' }}>
        <div style={{ cursor: 'pointer' }} onClick={() => setIntroOpen(!introOpen)}>
          <SectionHeader icon={List} title={`Introduction Fields (${introFields.length})`}
            subtitle="Collect respondent info before the survey starts"
            action={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); addIntroField(); setIntroOpen(true); }} type="button" style={{ fontSize: '0.8rem' }}>
                <Plus size={13} /> Add
              </button>
              {introOpen ? <ChevronUp size={18} style={{ color: 'var(--color-text-light)' }} /> : <ChevronDown size={18} style={{ color: 'var(--color-text-light)' }} />}
            </div>} />
        </div>
        {introOpen && (
          <div style={{ padding: '16px 20px' }}>
            {introFields.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--color-text-light)', fontSize: '0.85rem' }}>
                No intro fields yet. Add fields like Name, Email, Organization, etc.
              </div>
            ) : (
              introFields.map((f, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', padding: '8px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-light)' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-primary)', minWidth: 20, textAlign: 'center' }}>{idx + 1}</span>
                  <input className="form-control" placeholder="Field label (e.g., Name)" value={f.label}
                    onChange={e => updateIntroField(idx, 'label', e.target.value)} style={{ flex: 1 }} />
                  <select className="form-control" value={f.field_type} onChange={e => updateIntroField(idx, 'field_type', e.target.value)}
                    style={{ width: 110 }}>
                    {INTRO_FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                    <input type="checkbox" checked={f.is_required} onChange={e => updateIntroField(idx, 'is_required', e.target.checked)} />
                    Required
                  </label>
                  <label
                    title="If checked, a respondent who already submitted with this value can't submit again — and partial progress will be resumed automatically."
                    style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!f.is_unique} onChange={e => updateIntroField(idx, 'is_unique', e.target.checked)} />
                    Unique
                  </label>
                  <button onClick={() => removeIntroField(idx)} type="button"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', padding: 4 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Logic indicator ── */}
      {hasAnyLogic && (
        <div style={{ background: 'var(--color-primary-bg)', border: '1px solid var(--color-info-bg)', borderRadius: 'var(--radius)', padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <GitBranch size={16} style={{ color: 'var(--color-primary)' }} />
          <span style={{ fontSize: '0.85rem', color: 'var(--color-primary-dark)' }}>
            <strong>Logic mode active</strong> — Survey will show one question per page with branching.
          </span>
        </div>
      )}

      {/* ══ Section 3: Questions (SurveyMonkey-style) ══ */}
      {questions.length === 0 && (
        <div className="card" style={{ padding: '48px 40px', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--color-primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Plus size={24} style={{ color: 'var(--color-primary)' }} />
          </div>
          <h4 style={{ marginBottom: 6 }}>No content yet</h4>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: 20, fontSize: '0.9rem' }}>Start building your survey by adding content.</p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
            <AddContentButton onAddQuestion={() => addQuestion()} onAddText={() => addText()} onPaste={() => openPaste()} />
            {renderNewPageBtn()}
          </div>
        </div>
      )}

      {(() => { let qNum = 0; return questions.map((q, idx) => {
        const isSectionHeader = q.question_type === 'section_header';
        const isPageBreak = q.question_type === 'page_break';
        const isNonInput = isSectionHeader || isPageBreak;
        if (!isNonInput) qNum++;
        const isEditing = editingIdx === idx;
        const hasLogicOnQ = q.go_to || (Array.isArray(q.options) && q.options.some(o => normalizeOption(o).go_to));
        return (
          <React.Fragment key={idx}>
            <div className="card"
              onMouseEnter={() => setHoverIdx(idx)} onMouseLeave={() => setHoverIdx(h => (h === idx ? null : h))}
              style={{ marginBottom: 0, overflow: 'visible', position: 'relative',
                borderLeft: isPageBreak ? '4px solid var(--color-info)' : isSectionHeader ? '4px solid var(--color-warning)' : hasLogicOnQ ? '4px solid var(--color-primary)' : undefined }}>
              {isEditing ? renderEditor(q, idx, qNum) : (
                <div style={{ position: 'relative', padding: '28px 24px', minHeight: 70 }}
                  onDoubleClick={() => { setEditingIdx(idx); setEditorTab('edit'); }}>
                  {hoverIdx === idx && renderToolbar(idx, isPageBreak)}
                  <QuestionPreview q={q} qNum={qNum} isSectionHeader={isSectionHeader} isPageBreak={isPageBreak} />
                </div>
              )}
            </div>
            {/* Add content (+ New Page) after every question */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, margin: '16px 0' }}>
              <AddContentButton
                onAddQuestion={() => addQuestion(idx)}
                onAddText={() => addText(idx)}
                onPaste={() => openPaste(idx)} />
              {renderNewPageBtn(idx)}
            </div>
          </React.Fragment>
        );
      }); })()}

      {/* Copy-and-paste questions modal */}
      {pasteOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setPasteOpen(false)}>
          <div className="card" style={{ width: 520, maxWidth: '90vw', padding: 0 }} onClick={e => e.stopPropagation()}>
            <SectionHeader icon={ClipboardPaste} title="Copy and paste questions" subtitle="One question per line — each becomes a multiple-choice question." />
            <div style={{ padding: 20 }}>
              <textarea className="form-control" rows={8} value={pasteText} onChange={e => setPasteText(e.target.value)}
                placeholder={"How satisfied are you?\nWould you recommend us?"} style={{ resize: 'vertical' }} autoFocus />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 20px 20px' }}>
              <button className="btn btn-secondary" type="button" onClick={() => { setPasteText(''); setPasteOpen(false); }}>Cancel</button>
              <button className="btn" type="button" onClick={applyPaste} style={{ background: 'var(--color-success)', color: 'var(--color-text-inverse)' }}>Add questions</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
