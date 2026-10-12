import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle, Loader, Send, Star, Upload, ArrowRight, ArrowLeft } from 'lucide-react';
import 'react-quill-new/dist/quill.snow.css';
import { getPublicSurvey, submitPublicSurvey, uploadPublicSurveyFile, lookupPublicSurvey, savePartialPublicSurvey } from '../services/api';
import RichTextView from '../components/RichTextView';
import InlineRichText from '../components/InlineRichText';
import ThemeToggle from '../components/common/ThemeToggle';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const BACKEND_URL = API_BASE.replace('/api/v1', '');

const resolveImg = (url) => {
  if (!url) return null;
  return url.startsWith('http') ? url : `${BACKEND_URL}${url}`;
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

// Hidden separator used to attach a respondent's free-text input to the
// selected option in a single answer_text string. Stays embedded through
// resume; the results UI prettifies it back to "Option: free text".
const FT_SEP = '||~~||';
const splitOpt = (val) => {
  if (!val) return { text: '', extra: '' };
  const i = val.indexOf(FT_SEP);
  return i < 0 ? { text: val, extra: '' } : { text: val.slice(0, i), extra: val.slice(i + FT_SEP.length) };
};
const joinOpt = (text, extra) => (extra && extra.length > 0 ? `${text}${FT_SEP}${extra}` : text);
const parseMultiSegments = (val) => (val || '').split('|||').filter(Boolean).map(splitOpt);
const encodeMultiSegments = (segs) => segs.map(s => joinOpt(s.text, s.extra)).join('|||');

// Check if survey has any branching logic (option-level or question-level go_to)
const surveyHasLogic = (questions) => {
  return (questions || []).some(q => {
    const opts = Array.isArray(q.options) ? q.options : [];
    return opts.some(o => {
      const n = normalizeOption(o);
      return n.go_to !== null && n.go_to !== '' && n.go_to !== undefined;
    });
  });
};

// True iff the respondent has answered `q`. Matrix needs every row filled — for multi-select that
// means at least one column picked per row; for single-select it means a non-empty selection.
// Options flagged `requires_text` ("Others — please specify") that were picked but
// left blank. Selecting "Others" on its own stores just the option label, which tells
// us nothing — the free-text box is what carries the answer, so it must be filled.
// Returns the labels of the offending options.
const optionsMissingText = (q, val) => {
  // Matrix questions store options as an object ({rows, columns, ...}), not an
  // array — guard so `.map` never runs on a non-array and crashes Next/Submit.
  const opts = Array.isArray(q.options) ? q.options.map(normalizeOption) : [];
  const isBlank = (text, extra) => {
    const o = opts.find(x => x.text === text);
    return !!o?.requires_text && String(extra || '').trim() === '';
  };

  if (q.question_type === 'select' || q.question_type === 'radio') {
    const { text, extra } = splitOpt(val || '');
    return text && isBlank(text, extra) ? [text] : [];
  }
  if (q.question_type === 'checkbox' || q.question_type === 'multi_select') {
    return parseMultiSegments(val).filter(s => isBlank(s.text, s.extra)).map(s => s.text);
  }
  return [];
};

// A "please specify" box is always required once its option is picked — show it as
// such (red border) while it's empty, rather than only failing on Next.
const specifyStyle = (extra, base = {}) => ({
  ...base,
  borderColor: String(extra || '').trim() === '' ? 'var(--color-error)' : undefined,
});

const isQuestionAnswered = (q, val) => {
  if (val == null || String(val).trim() === '') return false;
  // "Others" with an empty specify box is not an answer.
  if (optionsMissingText(q, val).length > 0) return false;
  if (q.question_type === 'matrix') {
    let parsed;
    try { parsed = JSON.parse(val); } catch { return false; }
    const rows = Array.isArray(q.options?.rows) ? q.options.rows : [];
    if (rows.length === 0) return false;
    const isMulti = !!q.options?.multi_select;
    return rows.every(r => {
      const cell = parsed?.[r];
      return isMulti
        ? Array.isArray(cell) && cell.length > 0
        : cell != null && String(cell).trim() !== '';
    });
  }
  return true;
};

// Check if survey has page breaks
const surveyHasPageBreaks = (questions) => {
  return (questions || []).some(q => q.question_type === 'page_break');
};

// Split questions into pages at page_break markers
const splitIntoPages = (questions) => {
  const pages = [];
  let current = [];
  for (const q of (questions || [])) {
    if (q.question_type === 'page_break') {
      if (current.length > 0) pages.push(current);
      current = [];
    } else {
      current.push(q);
    }
  }
  if (current.length > 0) pages.push(current);
  return pages;
};

// Find which page index contains a given question sort_order (1-based position)
const findPageForQuestion = (pages, targetPos) => {
  const targetIdx = targetPos - 1; // 0-based
  let qCount = 0;
  for (let p = 0; p < pages.length; p++) {
    for (const q of pages[p]) {
      if (q.sort_order === targetIdx) return p;
      qCount++;
    }
  }
  return pages.length - 1; // fallback to last page
};

// ── Display options (set in the editor's "Survey Settings" options menu) ──
const DEFAULT_PUBLIC_SETTINGS = {
  show_title: true,
  progress_bar: 'off',       // off | top | bottom
  page_titles: false,
  page_numbers: false,
  question_numbers: 'on',    // on | off
  required_asterisks: true,
  language: 'en',
};

// UI chrome strings, translated per the survey's `language` setting.
const UI_STRINGS = {
  en: { start: 'Start Survey', checking: 'Checking…', next: 'Next', back: 'Back', submit: 'Submit',
    submitting: 'Submitting…', submitResponse: 'Submit Response', loading: 'Loading survey…',
    beforeBegin: 'Before we begin…', clickStart: 'Click "Start" to begin the survey.',
    thankYou: 'Thank You!', submittedMsg: 'Your response has been submitted successfully.',
    page: 'Page', of: 'of', unavailable: 'Survey Unavailable',
    alreadyTitle: 'You have already filled this survey',
    alreadyMsg: 'Our records show a response with this information has already been submitted. Thank you!',
    welcomeBack: 'Welcome back — we picked up where you left off.' },
  es: { start: 'Comenzar encuesta', checking: 'Comprobando…', next: 'Siguiente', back: 'Atrás', submit: 'Enviar',
    submitting: 'Enviando…', submitResponse: 'Enviar respuesta', loading: 'Cargando encuesta…',
    beforeBegin: 'Antes de empezar…', clickStart: 'Haz clic en "Comenzar" para iniciar la encuesta.',
    thankYou: '¡Gracias!', submittedMsg: 'Tu respuesta se ha enviado correctamente.',
    page: 'Página', of: 'de', unavailable: 'Encuesta no disponible',
    alreadyTitle: 'Ya has completado esta encuesta',
    alreadyMsg: 'Nuestros registros muestran que ya se ha enviado una respuesta con esta información. ¡Gracias!',
    welcomeBack: 'Bienvenido de nuevo: continuamos donde lo dejaste.' },
  fr: { start: 'Commencer l\'enquête', checking: 'Vérification…', next: 'Suivant', back: 'Retour', submit: 'Envoyer',
    submitting: 'Envoi…', submitResponse: 'Envoyer la réponse', loading: 'Chargement de l\'enquête…',
    beforeBegin: 'Avant de commencer…', clickStart: 'Cliquez sur « Commencer » pour démarrer l\'enquête.',
    thankYou: 'Merci !', submittedMsg: 'Votre réponse a bien été envoyée.',
    page: 'Page', of: 'sur', unavailable: 'Enquête indisponible',
    alreadyTitle: 'Vous avez déjà répondu à cette enquête',
    alreadyMsg: 'Nos archives indiquent qu\'une réponse avec ces informations a déjà été envoyée. Merci !',
    welcomeBack: 'Bon retour — nous avons repris là où vous vous étiez arrêté.' },
  de: { start: 'Umfrage starten', checking: 'Wird geprüft…', next: 'Weiter', back: 'Zurück', submit: 'Absenden',
    submitting: 'Wird gesendet…', submitResponse: 'Antwort absenden', loading: 'Umfrage wird geladen…',
    beforeBegin: 'Bevor wir beginnen…', clickStart: 'Klicken Sie auf „Starten", um die Umfrage zu beginnen.',
    thankYou: 'Vielen Dank!', submittedMsg: 'Ihre Antwort wurde erfolgreich übermittelt.',
    page: 'Seite', of: 'von', unavailable: 'Umfrage nicht verfügbar',
    alreadyTitle: 'Sie haben diese Umfrage bereits ausgefüllt',
    alreadyMsg: 'Unsere Aufzeichnungen zeigen, dass bereits eine Antwort mit diesen Informationen übermittelt wurde. Vielen Dank!',
    welcomeBack: 'Willkommen zurück — wir machen dort weiter, wo Sie aufgehört haben.' },
};

function RatingInput({ value, onChange }) {
  const [hover, setHover] = useState(0);
  const selected = parseInt(value) || 0;
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}
          onClick={() => onChange(String(n))}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
          <Star size={28} fill={(hover || selected) >= n ? 'var(--color-warning)' : 'none'}
            style={{ color: (hover || selected) >= n ? 'var(--color-warning)' : 'var(--color-border-strong)' }} />
        </button>
      ))}
      {selected > 0 && <span style={{ marginLeft: 8, color: 'var(--color-text-secondary)', fontSize: '0.9rem', alignSelf: 'center' }}>{selected}/5</span>}
    </div>
  );
}

function LinearScaleInput({ value, onChange }) {
  const selected = parseInt(value) || 0;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
        <button key={n} type="button" onClick={() => onChange(String(n))}
          style={{
            width: 42, height: 42, borderRadius: 8, border: '2px solid',
            borderColor: selected === n ? 'var(--color-primary)' : 'var(--color-border)',
            background: selected === n ? 'var(--color-primary)' : 'var(--color-surface)',
            color: selected === n ? 'var(--color-text-inverse)' : 'var(--color-text)',
            fontWeight: 600, fontSize: '0.95rem', cursor: 'pointer',
          }}>
          {n}
        </button>
      ))}
    </div>
  );
}

// Full-screen image viewer. Closes on backdrop click, the × button, or Escape.
function ImageLightbox({ src, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';   // don't scroll the page behind it
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div onClick={onClose} role="dialog" aria-modal="true"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out' }}>
      <button onClick={onClose} aria-label="Close"
        style={{ position: 'absolute', top: 16, right: 20, width: 40, height: 40, borderRadius: '50%',
          background: 'rgba(255,255,255,0.15)', border: 'none', color: 'var(--color-text-inverse)', fontSize: 24, lineHeight: 1, cursor: 'pointer' }}>×</button>
      <img src={src} alt="" onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '95vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }} />
    </div>
  );
}

// A thumbnail that opens the lightbox on click. Inside option labels it must
// preventDefault/stopPropagation so clicking the image doesn't also toggle the option.
function ZoomThumb({ src, onZoom, style }) {
  return (
    <span title="Click to enlarge"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onZoom(src); }}
      style={{ display: 'inline-flex', cursor: 'zoom-in', flexShrink: 0, position: 'relative' }}>
      <img src={src} alt="" style={style} />
    </span>
  );
}

function QuestionRenderer({ q, idx, answer, setAnswer, showNumber, showAsterisk = true }) {
  const imgSrc = resolveImg(q.image);
  const [zoom, setZoom] = useState(null);

  if (q.question_type === 'section_header') {
    // q.label is rich-text HTML authored via the "Add content → Text" editor.
    return (
      <div>
        <RichTextView html={q.label} style={{ color: 'var(--color-text)' }} />
        {imgSrc && (
          <img src={imgSrc} alt="" onClick={() => setZoom(imgSrc)} title="Click to enlarge"
            style={{ marginTop: 10, maxWidth: '100%', maxHeight: 250, borderRadius: 8, cursor: 'zoom-in' }} />
        )}
        {zoom && <ImageLightbox src={zoom} onClose={() => setZoom(null)} />}
      </div>
    );
  }

  return (
    <div>
      <label style={{ fontSize: '1rem', fontWeight: 500, marginBottom: 12, display: 'block' }}>
        {showNumber && `${idx + 1}. `}<InlineRichText text={q.label} />
        {showAsterisk && q.is_required && <span style={{ color: 'var(--color-error)', marginLeft: 4 }}>*</span>}
      </label>

      {imgSrc && (
        <div style={{ marginBottom: 14 }}>
          <img src={imgSrc} alt="" onClick={() => setZoom(imgSrc)} title="Click to enlarge"
            style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8, objectFit: 'contain', cursor: 'zoom-in' }} />
        </div>
      )}

      {q.question_type === 'text' && (
        <input className="form-control" value={answer || ''} onChange={e => setAnswer(e.target.value)} />
      )}
      {q.question_type === 'textarea' && (
        <textarea className="form-control" rows={3} value={answer || ''} onChange={e => setAnswer(e.target.value)} />
      )}
      {q.question_type === 'number' && (
        <input className="form-control" type="number" value={answer || ''} onChange={e => setAnswer(e.target.value)} />
      )}
      {q.question_type === 'email' && (
        <input className="form-control" type="email" placeholder="email@example.com" value={answer || ''} onChange={e => setAnswer(e.target.value)} />
      )}
      {q.question_type === 'phone' && (
        <input className="form-control" type="tel" placeholder="+91 98765 43210" value={answer || ''} onChange={e => setAnswer(e.target.value)} />
      )}
      {q.question_type === 'url' && (
        <input className="form-control" type="url" placeholder="https://..." value={answer || ''} onChange={e => setAnswer(e.target.value)} />
      )}
      {q.question_type === 'date' && (
        <input className="form-control" type="date" value={answer || ''} onChange={e => setAnswer(e.target.value)} />
      )}
      {q.question_type === 'time' && (
        <input className="form-control" type="time" value={answer || ''} onChange={e => setAnswer(e.target.value)} />
      )}

      {q.question_type === 'select' && (() => {
        const { text: selectedText, extra: selectedExtra } = splitOpt(answer || '');
        const selectedOpt = (q.options || []).map(normalizeOption).find(o => o.text === selectedText);
        return (
          <>
            <select className="form-control" value={selectedText} onChange={e => setAnswer(joinOpt(e.target.value, ''))}>
              <option value="">Select...</option>
              {(q.options || []).map((opt, i) => {
                const o = normalizeOption(opt);
                return <option key={i} value={o.text}>{o.text}</option>;
              })}
            </select>
            {selectedOpt?.requires_text && (
              <input className="form-control" style={specifyStyle(selectedExtra, { marginTop: 8 })}
                placeholder="Please specify... (required)" aria-required="true"
                value={selectedExtra}
                onChange={e => setAnswer(joinOpt(selectedText, e.target.value))} />
            )}
          </>
        );
      })()}

      {q.question_type === 'radio' && (() => {
        const { text: selectedText, extra: selectedExtra } = splitOpt(answer || '');
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
            {(q.options || []).map((opt, i) => {
              const o = normalizeOption(opt);
              const optImg = resolveImg(o.image);
              const isSelected = selectedText === o.text;
              return (
                <div key={i}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.95rem',
                    padding: '8px 12px', borderRadius: 8, border: '1px solid', borderColor: isSelected ? 'var(--color-primary)' : 'var(--color-border)',
                    background: isSelected ? 'var(--color-primary-bg)' : 'var(--color-surface)', transition: 'all 0.15s' }}>
                    <input type="radio" name={`q_${q.id}`} value={o.text} checked={isSelected}
                      onChange={() => setAnswer(joinOpt(o.text, ''))} />
                    {optImg && <ZoomThumb src={optImg} onZoom={setZoom} style={{ height: 40, maxWidth: 60, objectFit: 'cover', borderRadius: 4 }} />}
                    {o.text}
                  </label>
                  {isSelected && o.requires_text && (
                    <input className="form-control" style={specifyStyle(selectedExtra, { marginTop: 6, marginLeft: 26 })}
                      placeholder="Please specify... (required)" aria-required="true" autoFocus
                      value={selectedExtra}
                      onChange={e => setAnswer(joinOpt(o.text, e.target.value))} />
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {(q.question_type === 'checkbox' || q.question_type === 'multi_select') && (() => {
        const segments = parseMultiSegments(answer);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
            {(q.options || []).map((opt, i) => {
              const o = normalizeOption(opt);
              const optImg = resolveImg(o.image);
              const segIdx = segments.findIndex(s => s.text === o.text);
              const isChecked = segIdx >= 0;
              const extra = isChecked ? segments[segIdx].extra : '';
              return (
                <div key={i}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.95rem',
                    padding: '8px 12px', borderRadius: 8, border: '1px solid', borderColor: isChecked ? 'var(--color-primary)' : 'var(--color-border)',
                    background: isChecked ? 'var(--color-primary-bg)' : 'var(--color-surface)', transition: 'all 0.15s' }}>
                    <input type="checkbox" checked={isChecked}
                      onChange={() => {
                        const newSegs = isChecked
                          ? segments.filter((_, idx) => idx !== segIdx)
                          : [...segments, { text: o.text, extra: '' }];
                        setAnswer(encodeMultiSegments(newSegs));
                      }} />
                    {optImg && <ZoomThumb src={optImg} onZoom={setZoom} style={{ height: 40, maxWidth: 60, objectFit: 'cover', borderRadius: 4 }} />}
                    {o.text}
                  </label>
                  {isChecked && o.requires_text && (
                    <input className="form-control" style={specifyStyle(extra, { marginTop: 6, marginLeft: 26 })}
                      placeholder="Please specify... (required)" aria-required="true" autoFocus
                      value={extra}
                      onChange={e => {
                        const newSegs = segments.map((s, idx) => idx === segIdx ? { ...s, extra: e.target.value } : s);
                        setAnswer(encodeMultiSegments(newSegs));
                      }} />
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {q.question_type === 'rating' && (
        <RatingInput value={answer} onChange={setAnswer} />
      )}

      {q.question_type === 'yes_no' && (
        <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
          {['Yes', 'No'].map(v => (
            <button key={v} type="button" onClick={() => setAnswer(v)}
              style={{
                padding: '10px 32px', borderRadius: 8, border: '2px solid',
                borderColor: answer === v ? 'var(--color-primary)' : 'var(--color-border)',
                background: answer === v ? 'var(--color-primary)' : 'var(--color-surface)',
                color: answer === v ? 'var(--color-text-inverse)' : 'var(--color-text)',
                fontWeight: 500, cursor: 'pointer', fontSize: '1rem',
              }}>
              {v}
            </button>
          ))}
        </div>
      )}

      {q.question_type === 'linear_scale' && (
        <LinearScaleInput value={answer} onChange={setAnswer} />
      )}

      {q.question_type === 'matrix' && (() => {
        const rows = Array.isArray(q.options?.rows) ? q.options.rows : [];
        const columns = Array.isArray(q.options?.columns) ? q.options.columns : [];
        const isMulti = !!q.options?.multi_select;
        let parsed = {};
        try { parsed = answer ? JSON.parse(answer) : {}; } catch { parsed = {}; }
        const writeCell = (rowText, value) => {
          const next = { ...parsed, [rowText]: value };
          setAnswer(JSON.stringify(next));
        };
        const isCellChecked = (rowText, colText) => {
          const v = parsed[rowText];
          return isMulti ? Array.isArray(v) && v.includes(colText) : v === colText;
        };
        const toggleCell = (rowText, colText) => {
          if (!isMulti) { writeCell(rowText, colText); return; }
          const existing = Array.isArray(parsed[rowText]) ? parsed[rowText] : [];
          const next = existing.includes(colText)
            ? existing.filter(c => c !== colText)
            : [...existing, colText];
          writeCell(rowText, next);
        };
        return (
          <div style={{ overflowX: 'auto', marginTop: 4 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.92rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '10px 12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}></th>
                  {columns.map((c, ci) => (
                    <th key={ci} style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--color-text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? 'var(--color-surface-raised)' : 'var(--color-surface)' }}>
                    <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)', maxWidth: 320 }}>{r}</td>
                    {columns.map((c, ci) => (
                      <td key={ci} style={{ padding: '12px', textAlign: 'center' }}>
                        <input
                          type={isMulti ? 'checkbox' : 'radio'}
                          name={isMulti ? undefined : `q_${q.id}_r${ri}`}
                          value={c}
                          checked={isCellChecked(r, c)}
                          onChange={() => toggleCell(r, c)}
                          style={{ width: 18, height: 18, cursor: 'pointer' }} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {q.question_type === 'file_upload' && (
        <div>
          {answer ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={16} style={{ color: 'var(--color-success)' }} />
              <span style={{ fontSize: '0.9rem', color: 'var(--color-success)' }}>File uploaded</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAnswer('')}>Change</button>
            </div>
          ) : (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', border: '2px dashed var(--color-border-strong)', borderRadius: 8, cursor: 'pointer', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
              <Upload size={16} /> Choose file
              <input type="file" style={{ display: 'none' }} onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const res = await uploadPublicSurveyFile(file);
                  setAnswer(res.data.url);
                } catch { /* handled silently */ }
              }} />
            </label>
          )}
        </div>
      )}

      {zoom && <ImageLightbox src={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}

export default function PublicSurveyPage() {
  const { token } = useParams();
  const [surveyData, setSurveyData] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [answers, setAnswers] = useState({});
  const [introAnswers, setIntroAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  // Step-by-step state
  const [currentStep, setCurrentStep] = useState(-1); // -1 = intro, 0..n = question index
  const [questionHistory, setQuestionHistory] = useState([]); // stack of visited question indices
  // Resume / dedup state (driven by unique intro fields)
  const [responseId, setResponseId] = useState(null);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [lookupChecking, setLookupChecking] = useState(false);
  const [resumeNotice, setResumeNotice] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await getPublicSurvey(token);
        setSurveyData(res.data);
      } catch (err) {
        const status = err.response?.status;
        if (status === 404) setPageError('This survey does not exist.');
        else if (status === 410) setPageError('This survey is no longer accepting responses.');
        else setPageError('Failed to load survey.');
      } finally {
        setPageLoading(false);
      }
    }
    load();
  }, [token]);

  const setAnswer = (qId, value) => setAnswers(prev => ({ ...prev, [qId]: value }));

  const hasLogic = surveyData ? surveyHasLogic(surveyData.questions) : false;
  const hasPageBreak = surveyData ? surveyHasPageBreaks(surveyData.questions) : false;
  const useStepMode = hasLogic || hasPageBreak;
  const introFields = surveyData?.intro_fields || [];
  const hasIntro = introFields.length > 0;

  // ── Display options (from the editor's "Survey Settings" options menu) ──
  const s = { ...DEFAULT_PUBLIC_SETTINGS, ...(surveyData?.settings || {}) };
  const t = UI_STRINGS[s.language] || UI_STRINGS.en;
  const showTitle = s.show_title;
  const showQNumbers = s.question_numbers !== 'off';
  const showAsterisks = s.required_asterisks;
  const showPageNumbers = s.page_numbers;
  const showPageTitles = s.page_titles;
  const progressBar = s.progress_bar; // off | top | bottom

  // Build pages: split questions by page_break. If only logic (no page breaks), each question = 1 page.
  // Section headers are always grouped with the question(s) that follow them on the same page.
  const buildLogicPages = (questions) => {
    const filtered = questions.filter(q => q.question_type !== 'page_break');
    const result = [];
    let pending = []; // section headers waiting to attach to next real question
    for (const q of filtered) {
      if (q.question_type === 'section_header') {
        pending.push(q);
      } else {
        result.push([...pending, q]);
        pending = [];
      }
    }
    // trailing section headers with no question after them — add as their own page
    if (pending.length > 0) result.push(pending);
    return result;
  };

  const groupSectionsIntoPages = (pages) => {
    // For page-break mode: merge leading section_headers of a page into the previous page if that page has questions
    // Actually just ensure section headers within each page stay with questions — they already do.
    // But if a page is ONLY section headers, merge it with the next page.
    const result = [];
    for (const page of pages) {
      const allSections = page.every(q => q.question_type === 'section_header');
      if (allSections && result.length > 0) {
        // append to previous page
        result[result.length - 1] = [...result[result.length - 1], ...page];
      } else if (allSections && result.length === 0) {
        // first page is all sections — hold it, it'll merge with next
        result.push([...page]);
      } else if (result.length > 0 && result[result.length - 1].every(q => q.question_type === 'section_header')) {
        // previous page was only sections, merge with this one
        result[result.length - 1] = [...result[result.length - 1], ...page];
      } else {
        result.push(page);
      }
    }
    return result;
  };

  const pages = surveyData
    ? (hasPageBreak ? groupSectionsIntoPages(splitIntoPages(surveyData.questions)) : (hasLogic ? buildLogicPages(surveyData.questions) : []))
    : [];

  // Find which page contains a question by its 1-based sort position
  const getPageForTarget = (targetPos) => {
    const targetSortOrder = targetPos - 1;
    for (let p = 0; p < pages.length; p++) {
      if (pages[p].some(q => q.sort_order === targetSortOrder)) return p;
    }
    return null;
  };

  // Get next page based on logic from last question on current page
  const getNextPageIdx = (pageIdx) => {
    if (pageIdx < 0 || pageIdx >= pages.length) return 'end';
    const pageQs = pages[pageIdx];

    // Check logic on all questions in this page (last one with a go_to wins)
    for (let i = pageQs.length - 1; i >= 0; i--) {
      const q = pageQs[i];
      const currentAnswer = answers[q.id] || '';
      // Matrix stores options as a dict, not an array — skip logic-target scanning for it.
      const opts = Array.isArray(q.options) ? q.options : [];

      // 1. Check option-level logic (for select/radio/yes_no — matched answer)
      for (const opt of opts) {
        const o = normalizeOption(opt);
        if (o.text && o.text === currentAnswer && o.go_to) {
          if (o.go_to === 'end') return 'end';
          const targetPage = getPageForTarget(parseInt(o.go_to));
          if (targetPage !== null) return targetPage;
        }
      }

      // 2. Check question-level go_to (stored as [{go_to: "X"}] with no text — for text/number/etc.)
      for (const opt of opts) {
        const o = normalizeOption(opt);
        if (!o.text && o.go_to) {
          if (o.go_to === 'end') return 'end';
          const targetPage = getPageForTarget(parseInt(o.go_to));
          if (targetPage !== null) return targetPage;
        }
      }
    }

    // Default: next page
    const next = pageIdx + 1;
    return next < pages.length ? next : 'end';
  };

  // Find page index of the first page containing any question NOT fully answered yet.
  // Falls back to last page if every question is already answered.
  const firstUnansweredPageIdx = (prefilledAnswers) => {
    for (let p = 0; p < pages.length; p++) {
      for (const q of pages[p]) {
        if (q.question_type === 'section_header') continue;
        if (!isQuestionAnswered(q, prefilledAnswers[q.id])) {
          return p;
        }
      }
    }
    return Math.max(0, pages.length - 1);
  };

  // Save current progress in the background. We don't block the UI on this.
  const savePartialInBackground = (overrides = {}) => {
    if (!surveyData) return;
    const hasUnique = introFields.some(f => f.is_unique);
    if (!hasUnique) return; // partial save only meaningful when we can identify the respondent later
    const payload = {
      response_id: overrides.responseId ?? responseId,
      intro_data: overrides.introAnswers ?? introAnswers,
      answers: Object.entries(overrides.answers ?? answers).map(([qId, text]) => ({
        question_id: parseInt(qId),
        answer_text: text,
      })),
      last_question_id: overrides.lastQuestionId ?? null,
    };
    savePartialPublicSurvey(token, payload)
      .then(res => {
        if (res?.data?.response_id && !responseId && !overrides.responseId) {
          setResponseId(res.data.response_id);
        }
      })
      .catch(() => { /* silent — autosave shouldn't block UX */ });
  };

  const handleNext = async () => {
    setError('');

    if (currentStep === -1) {
      for (const f of introFields) {
        if (f.is_required && !(introAnswers[f.label] || '').trim()) {
          setError(`"${f.label}" is required`);
          return;
        }
      }
      // If any unique intro field is set, look up the respondent before starting.
      const hasUniqueValue = introFields.some(f => f.is_unique && (introAnswers[f.label] || '').trim());
      if (hasUniqueValue) {
        setLookupChecking(true);
        try {
          const res = await lookupPublicSurvey(token, introAnswers);
          const data = res.data || {};
          if (data.status === 'already_submitted') {
            setAlreadySubmitted(true);
            setLookupChecking(false);
            return;
          }
          if (data.status === 'resume') {
            // Hydrate previous answers + intro into state, then resume on the first unanswered page.
            const prevAnswers = {};
            for (const [qId, text] of Object.entries(data.answers || {})) {
              prevAnswers[parseInt(qId)] = text;
            }
            setAnswers(prevAnswers);
            if (data.intro_data) setIntroAnswers(data.intro_data);
            setResponseId(data.response_id);
            const resumePage = useStepMode ? firstUnansweredPageIdx(prevAnswers) : 0;
            const history = [];
            for (let i = 0; i <= resumePage; i++) history.push(i);
            setQuestionHistory(history);
            setCurrentStep(resumePage);
            setResumeNotice((UI_STRINGS[surveyData?.settings?.language] || UI_STRINGS.en).welcomeBack);
            setLookupChecking(false);
            return;
          }
        } catch {
          // Lookup failed (network etc.) — fall through and let the user proceed.
        } finally {
          setLookupChecking(false);
        }
      }
      setQuestionHistory([0]);
      setCurrentStep(0);
      // Initial partial save so any unique-field respondent can be matched on return.
      savePartialInBackground({ lastQuestionId: pages[0]?.[0]?.id ?? null });
      return;
    }

    // Validate all required questions on current page
    const pageQs = pages[currentStep] || [];
    for (const q of pageQs) {
      // Applies even to optional questions: picking "Others" and leaving the box
      // blank would otherwise submit the bare option label as the answer.
      const missingText = optionsMissingText(q, answers[q.id]);
      if (missingText.length > 0) {
        setError(`"${q.label}" — please specify details for "${missingText[0]}"`);
        return;
      }
      if (q.is_required && q.question_type !== 'section_header' && q.question_type !== 'page_break' && !isQuestionAnswered(q, answers[q.id])) {
        setError(q.question_type === 'matrix'
          ? `"${q.label}" — please answer every row`
          : `"${q.label}" is required`);
        return;
      }
    }

    const next = getNextPageIdx(currentStep);
    if (next === 'end' || next === null) {
      handleSubmit();
    } else {
      setQuestionHistory(prev => [...prev, next]);
      setCurrentStep(next);
      // After advancing, autosave with the new "last question on this page" pointer.
      const firstQOnNext = (pages[next] || []).find(q => q.question_type !== 'section_header');
      savePartialInBackground({ lastQuestionId: firstQOnNext?.id ?? null });
    }
  };

  const handleBack = () => {
    setError('');
    if (questionHistory.length <= 1) {
      setCurrentStep(-1);
      setQuestionHistory([]);
    } else {
      const newHistory = [...questionHistory];
      newHistory.pop();
      setCurrentStep(newHistory[newHistory.length - 1]);
      setQuestionHistory(newHistory);
    }
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    setError('');

    // For classic mode, validate all required
    if (!useStepMode) {
      for (const q of surveyData.questions) {
        const missingText = optionsMissingText(q, answers[q.id]);
        if (missingText.length > 0) {
          setError(`"${q.label}" — please specify details for "${missingText[0]}"`);
          return;
        }
        if (q.is_required && q.question_type !== 'section_header' && q.question_type !== 'page_break' && !isQuestionAnswered(q, answers[q.id])) {
          setError(q.question_type === 'matrix'
            ? `"${q.label}" — please answer every row`
            : `"${q.label}" is required`);
          return;
        }
      }
      // Validate intro fields
      for (const f of introFields) {
        if (f.is_required && !(introAnswers[f.label] || '').trim()) {
          setError(`"${f.label}" is required`);
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      await submitPublicSurvey(token, {
        respondent_name: introAnswers['Name'] || introAnswers['name'] || null,
        respondent_email: introAnswers['Email'] || introAnswers['email'] || null,
        intro_data: Object.keys(introAnswers).length > 0 ? introAnswers : null,
        answers: Object.entries(answers).map(([qId, text]) => ({
          question_id: parseInt(qId),
          answer_text: text,
        })),
        response_id: responseId,
      });
      setSubmitted(true);
    } catch (err) {
      if (err.response?.status === 409) {
        setAlreadySubmitted(true);
      } else {
        setError(err.response?.data?.detail || 'Submission failed.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading / Error / Submitted states ──
  if (pageLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader size={32} className="spinning" style={{ color: 'var(--color-primary)' }} />
          <p style={{ marginTop: 12, color: 'var(--color-text-secondary)' }}>{t.loading}</p>
        </div>
      </div>
    );
  }
  if (pageError) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <AlertCircle size={48} style={{ color: 'var(--color-error)', marginBottom: 16 }} />
          <h2>{t.unavailable}</h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>{pageError}</p>
        </div>
      </div>
    );
  }
  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
        <div style={{ textAlign: 'center', maxWidth: 500, padding: 40 }}>
          <CheckCircle size={64} style={{ color: 'var(--color-success)', marginBottom: 20 }} />
          <h2>{t.thankYou}</h2>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '1.05rem' }}>{t.submittedMsg}</p>
        </div>
      </div>
    );
  }
  if (alreadySubmitted) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
        <div style={{ textAlign: 'center', maxWidth: 500, padding: 40 }}>
          <CheckCircle size={64} style={{ color: 'var(--color-primary)', marginBottom: 20 }} />
          <h2>{t.alreadyTitle}</h2>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '1.05rem' }}>{t.alreadyMsg}</p>
        </div>
      </div>
    );
  }

  const coverImg = resolveImg(surveyData.cover_image);

  // ══════════════════════════════════════════════════════════
  // STEP-BY-STEP MODE (page breaks and/or logic)
  // ══════════════════════════════════════════════════════════
  if (useStepMode) {
    const isIntroStep = currentStep === -1;
    const currentPageQs = !isIntroStep && pages[currentStep] ? pages[currentStep] : [];
    const isLastPage = !isIntroStep && getNextPageIdx(currentStep) === 'end';
    const progress = isIntroStep ? 0 : Math.round(((questionHistory.length) / pages.length) * 100);
    // Global question numbering offset
    let globalQNum = 0;
    for (let p = 0; p < currentStep; p++) {
      globalQNum += (pages[p] || []).filter(q => q.question_type !== 'section_header').length;
    }

    // Progress bar — position (top/bottom/off) and the page counter are driven by display settings.
    const progressBarEl = progressBar === 'off' ? null : (
      <div style={{ marginBottom: progressBar === 'bottom' ? 0 : 24, marginTop: progressBar === 'bottom' ? 24 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 4, background: 'var(--color-border)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--color-primary)', borderRadius: 4, width: `${Math.min(progress, 100)}%`, transition: 'width 0.3s ease' }} />
          </div>
          {!isIntroStep && showPageNumbers && (
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', whiteSpace: 'nowrap' }}>
              {t.page} {questionHistory.length} {t.of} {pages.length}
            </span>
          )}
        </div>
      </div>
    );

    return (
      <div className="public-survey-container" style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '40px 16px' }}>
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
          {/* Survey title on every page */}
          {showTitle && (
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 16px', textAlign: 'center' }}>{surveyData.title}</h2>
          )}
          {/* Page number / counter (standalone when there's no progress bar to host it) */}
          {!isIntroStep && showPageNumbers && progressBar === 'off' && (
            <div style={{ textAlign: 'center', marginBottom: 16, fontSize: '0.8rem', color: 'var(--color-text-light)' }}>
              {t.page} {questionHistory.length} {t.of} {pages.length}
            </div>
          )}
          {/* Progress bar (top) */}
          {progressBar === 'top' && progressBarEl}

          {/* Intro step */}
          {isIntroStep && (
            <>
              <div className="card" style={{ marginBottom: 24, padding: '32px 28px', textAlign: 'center' }}>
                {coverImg && (
                  <div style={{ marginBottom: 16 }}>
                    <img src={coverImg} alt="" style={{ width: '100%', maxHeight: 350, borderRadius: 8, objectFit: 'cover' }} />
                  </div>
                )}
                {showTitle && <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>{surveyData.title}</h1>}
                {surveyData.description && (
                  <RichTextView html={surveyData.description} style={{ color: 'var(--color-text-secondary)' }} />
                )}
              </div>

              {error && <div className="alert alert-error" style={{ marginBottom: 16 }}><AlertCircle size={16} /> {error}</div>}

              <div className="card" style={{ padding: '28px', marginBottom: 16 }}>
                {hasIntro ? (
                  <>
                    <h3 style={{ fontSize: '1rem', marginBottom: 16, color: 'var(--color-text-secondary)' }}>{t.beforeBegin}</h3>
                    {introFields.map((f, i) => (
                      <div key={i} className="form-group" style={{ marginBottom: 14 }}>
                        <label style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                          {f.label} {showAsterisks && f.is_required && <span style={{ color: 'var(--color-error)' }}>*</span>}
                        </label>
                        {f.field_type === 'textarea' ? (
                          <textarea className="form-control" rows={2} value={introAnswers[f.label] || ''}
                            onChange={e => setIntroAnswers(prev => ({ ...prev, [f.label]: e.target.value }))} />
                        ) : (
                          <input className="form-control" type={f.field_type === 'email' ? 'email' : f.field_type === 'phone' ? 'tel' : f.field_type === 'number' ? 'number' : 'text'}
                            value={introAnswers[f.label] || ''}
                            onChange={e => setIntroAnswers(prev => ({ ...prev, [f.label]: e.target.value }))} />
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <p style={{ textAlign: 'center', color: 'var(--color-text-secondary)', margin: 0 }}>{t.clickStart}</p>
                )}
              </div>
            </>
          )}

          {/* Current page questions */}
          {!isIntroStep && (
            <>
              {resumeNotice && <div className="alert" style={{ marginBottom: 16, background: 'var(--color-primary-bg)', border: '1px solid var(--color-info-bg)', color: 'var(--color-primary-dark)', padding: '10px 14px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}><CheckCircle size={16} /> {resumeNotice}</div>}
              {error && <div className="alert alert-error" style={{ marginBottom: 16 }}><AlertCircle size={16} /> {error}</div>}
              {showPageTitles && (
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text-secondary)', margin: '0 0 14px' }}>
                  {t.page} {questionHistory.length}
                </h3>
              )}
              {currentPageQs.map((q, i) => {
                const qNum = globalQNum + currentPageQs.slice(0, i + 1).filter(x => x.question_type !== 'section_header').length;
                if (q.question_type === 'section_header') {
                  return (
                    <div key={q.id} style={{ marginBottom: 12, padding: '16px 28px', background: 'var(--color-surface-raised)', borderRadius: 12, borderLeft: '4px solid var(--color-primary)' }}>
                      {/* q.label is rich-text HTML from the "Add content → Text" editor. */}
                      <RichTextView html={q.label} style={{ color: 'var(--color-text)' }} />
                      {q.image && <img src={resolveImg(q.image)} alt="" style={{ marginTop: 10, maxWidth: '100%', maxHeight: 200, borderRadius: 8 }} />}
                    </div>
                  );
                }
                return (
                  <div key={q.id} className="card" style={{ marginBottom: 12, padding: '24px 28px' }}>
                    <QuestionRenderer
                      q={q} idx={qNum - 1}
                      answer={answers[q.id]}
                      setAnswer={(val) => setAnswer(q.id, val)}
                      showNumber={showQNumbers}
                      showAsterisk={showAsterisks}
                    />
                  </div>
                );
              })}
            </>
          )}

          {/* Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 8 }}>
            {isIntroStep ? (
              <>
                <div />
                <button type="button" className="btn btn-primary btn-lg" onClick={handleNext} disabled={lookupChecking}>
                  {lookupChecking ? <><Loader size={18} className="spinning" /> {t.checking}</> : <>{t.start} <ArrowRight size={18} /></>}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-ghost" onClick={handleBack}>
                  <ArrowLeft size={16} /> {t.back}
                </button>
                {isLastPage ? (
                  <button type="button" className="btn btn-primary btn-lg" onClick={handleNext} disabled={submitting}>
                    {submitting ? <><Loader size={18} className="spinning" /> {t.submitting}</> : <><Send size={18} /> {t.submit}</>}
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={handleNext}>
                    {t.next} <ArrowRight size={16} />
                  </button>
                )}
              </>
            )}
          </div>

          {/* Progress bar (bottom) */}
          {progressBar === 'bottom' && progressBarEl}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // CLASSIC MODE (all questions on one page, no logic/page breaks)
  // ══════════════════════════════════════════════════════════
  return (
    <div className="public-survey-container" style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '40px 16px' }}>
      <ThemeToggle className="theme-toggle-floating" />
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        {/* Header */}
        <div className="card" style={{ marginBottom: 24, padding: '32px 28px' }}>
          {coverImg && (
            <div style={{ marginBottom: 16 }}>
              <img src={coverImg} alt="" style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8, objectFit: 'cover' }} />
            </div>
          )}
          {showTitle && <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>{surveyData.title}</h1>}
          {surveyData.description && (
            <RichTextView html={surveyData.description} style={{ color: 'var(--color-text-secondary)' }} />
          )}
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Intro Fields */}
          {hasIntro && (
            <div className="card" style={{ marginBottom: 16, padding: '20px 28px' }}>
              {introFields.map((f, i) => (
                <div key={i} className="form-group" style={{ marginBottom: i < introFields.length - 1 ? 14 : 0 }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                    {f.label} {showAsterisks && f.is_required && <span style={{ color: 'var(--color-error)' }}>*</span>}
                  </label>
                  {f.field_type === 'textarea' ? (
                    <textarea className="form-control" rows={2} value={introAnswers[f.label] || ''}
                      onChange={e => setIntroAnswers(prev => ({ ...prev, [f.label]: e.target.value }))} />
                  ) : (
                    <input className="form-control"
                      type={f.field_type === 'email' ? 'email' : f.field_type === 'phone' ? 'tel' : f.field_type === 'number' ? 'number' : 'text'}
                      value={introAnswers[f.label] || ''} placeholder={f.label}
                      onChange={e => setIntroAnswers(prev => ({ ...prev, [f.label]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Questions */}
          {(() => { let qNum = 0; return surveyData.questions.map((q, idx) => {
            if (q.question_type === 'section_header') {
              return (
                <div key={q.id} style={{ marginBottom: 12, padding: '16px 28px', background: 'var(--color-surface-raised)', borderRadius: 12, borderLeft: '4px solid var(--color-primary)' }}>
                  <QuestionRenderer q={q} idx={idx} answer={answers[q.id]} setAnswer={(val) => setAnswer(q.id, val)} showNumber={false} showAsterisk={showAsterisks} />
                </div>
              );
            }
            qNum++;
            return (
              <div key={q.id} className="card" style={{ marginBottom: 12, padding: '20px 28px' }}>
                <QuestionRenderer q={q} idx={qNum - 1} answer={answers[q.id]} setAnswer={(val) => setAnswer(q.id, val)} showNumber={showQNumbers} showAsterisk={showAsterisks} />
              </div>
            );
          }); })()}

          {/* Submit */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
            <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
              {submitting ? <><Loader size={18} className="spinning" /> {t.submitting}</> : <><Send size={18} /> {t.submitResponse}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
