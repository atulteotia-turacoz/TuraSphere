// Survey response CSV export, shared by the team's Survey Results page and the
// client portal's Survey Results tab.
//
// Extracted rather than duplicated: this file carries a pile of hard-won detail
// — Excel's UTF-8 BOM, its ~1024-character single-line cell display limit,
// RFC-4180 quoting, matrix answers, the free-text separator — and a second
// hand-written copy would quietly be worse than this one.

// Mirror of the public-survey free-text separator. Converts
// "Other||~~||my custom reason" → "Other: my custom reason".
const FT_SEP = '||~~||';

// rowSep separates matrix rows: '; ' for compact on-page display, '\n' for CSV
// so each statement → answer pair lands on its own line inside one Excel cell.
export const formatAnswer = (val, rowSep = '; ') => {
  if (val == null || val === '') return val;
  const s = String(val);
  // Matrix answers arrive as a JSON map { "<row>": "<column>" | ["<col>", …] }.
  if (s.length > 1 && s[0] === '{' && s[s.length - 1] === '}') {
    try {
      const obj = JSON.parse(s);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return Object.entries(obj)
          .filter(([, v]) => {
            if (v == null) return false;
            if (Array.isArray(v)) return v.length > 0;
            return String(v).trim() !== '';
          })
          .map(([k, v], i) => `${i + 1}. ${k}   :   ${Array.isArray(v) ? v.join(', ') : v}`)
          .join(rowSep);
      }
    } catch { /* not a matrix payload — fall through */ }
  }
  return s.split('|||').map(seg => seg.replace(FT_SEP, ': ')).join('|||');
};

// Answer-column keys in the order the table/CSV should show them. The API sends
// `columns` in survey-question order (so each "reason" follow-up sits right
// after its statement); keep only those with an answer, then append leftovers
// (e.g. from a since-deleted question). Falls back to the first-seen union if an
// older backend didn't send `columns`.
export const orderedAnswerKeys = (data) => {
  const present = new Set(data.responses.flatMap(r => Object.keys(r.answers)));
  const base = Array.isArray(data.columns) ? data.columns.filter(k => present.has(k)) : [];
  const extras = [...present].filter(k => !base.includes(k));
  return base.length ? [...base, ...extras] : [...present];
};

const csvCell = (val) => {
  const s = (val == null ? '' : String(val))
    .replace(/\r\n|\r/g, '\n')   // CRLF/CR → lone LF: in-cell line break, not a record break
    .replace(/"/g, '""');        // RFC-4180 quote escaping
  return `"${s}"`;
};

// Excel only DISPLAYS ~1024 chars of a cell with no line breaks (the rest is
// stored, just hidden behind the formula bar), so a long free-text answer looks
// truncated in the grid. Soft-wrap at word boundaries so Excel renders the whole
// thing across several lines in the same cell — nothing is dropped.
const CELL_WRAP = 100;
const wrapForCell = (val) => {
  const text = val == null ? '' : String(val);
  return text.split('\n').map(line => {
    if (line.length <= CELL_WRAP) return line;
    const out = [];
    let cur = '';
    for (const word of line.split(' ')) {
      if (cur && cur.length + 1 + word.length > CELL_WRAP) { out.push(cur); cur = ''; }
      cur = cur ? `${cur} ${word}` : word;
      while (cur.length > CELL_WRAP) { out.push(cur.slice(0, CELL_WRAP)); cur = cur.slice(CELL_WRAP); }
    }
    if (cur) out.push(cur);
    return out.join('\n');
  }).join('\n');
};

/** Builds the CSV text for a survey-results payload. */
export const buildSurveyCsv = (data) => {
  const introKeys = new Set();
  data.responses.forEach(r => { if (r.intro_data) Object.keys(r.intro_data).forEach(k => introKeys.add(k)); });
  // Answer columns in survey order; drop any that collide with an intro field.
  const answerKeys = orderedAnswerKeys(data).filter(k => !introKeys.has(k));

  const headers = ['#', 'Respondent Name', 'Email', ...[...introKeys], ...answerKeys, 'Submitted At'];
  const rows = data.responses.map((r, i) => [
    i + 1,
    r.respondent_name || '',
    r.respondent_email || '',
    ...[...introKeys].map(k => wrapForCell(r.intro_data?.[k] || '')),
    ...answerKeys.map(k => wrapForCell(formatAnswer(r.answers[k] || '', '\n'))),
    new Date(r.submitted_at).toLocaleString(),
  ]);
  // Records joined with CRLF — the line ending Excel expects — so a full matrix
  // answer survives verbatim inside one cell.
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
};

/** Builds and downloads the CSV. Returns false when there is nothing to export. */
export const downloadSurveyCsv = (data, filename) => {
  if (!data || !data.responses?.length) return false;
  const csv = buildSurveyCsv(data);
  // A UTF-8 BOM so Excel detects UTF-8 and renders every script (Hindi, Arabic,
  // CJK, emoji) instead of falling back to the system locale encoding.
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `${data.title || 'survey'}_results.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
};
