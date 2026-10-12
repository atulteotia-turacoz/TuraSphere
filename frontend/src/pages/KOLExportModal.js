import React, { useEffect, useState } from 'react';
import { Download, X, Loader, AlertCircle, FileSpreadsheet, FileText } from 'lucide-react';
import { getKOLExportColumns, exportKOLs } from '../services/api';

// Find KOLs → Export. The user picks the format, which KOLs, and which columns;
// the column choice is remembered per browser so the next export starts from it.
const COLS_KEY = 'findKols.export.columns';
const FORMAT_KEY = 'findKols.export.format';

const load = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* optional */ } };

export default function KOLExportModal({ view, filters, total, pendingCount, selectedIds, onClose }) {
  const [columns, setColumns] = useState([]);
  const [chosen, setChosen] = useState(null);           // Set of keys
  const [format, setFormat] = useState(() => load(FORMAT_KEY, 'xlsx'));
  const [scope, setScope] = useState(view === 'pending' ? 'pending' : selectedIds.length ? 'selected' : 'directory');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getKOLExportColumns().then((r) => {
      setColumns(r.data);
      const saved = load(COLS_KEY, null);
      const known = new Set(r.data.map((c) => c.key));
      const initial = saved?.filter((k) => known.has(k));
      setChosen(new Set(initial?.length ? initial : r.data.filter((c) => c.default).map((c) => c.key)));
    }).catch(() => setError('Could not load the column list.'));
  }, []);

  const toggle = (key) => setChosen((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const rowCount = scope === 'selected' ? selectedIds.length : scope === 'pending' ? pendingCount : total;

  const download = async () => {
    const keys = columns.map((c) => c.key).filter((k) => chosen.has(k));   // catalogue order
    if (!keys.length) { setError('Pick at least one column.'); return; }
    setBusy(true); setError('');
    save(COLS_KEY, keys); save(FORMAT_KEY, format);
    try {
      const params = {
        format, columns: keys.join(','),
        scope: scope === 'pending' ? 'pending' : 'directory',
        ...(scope === 'selected' ? { ids: selectedIds.join(',') } : {}),
        // The list's own filters, so the file matches what's on screen.
        ...(scope === 'directory' ? filters : {}),
      };
      const res = await exportKOLs(params);
      const name = /filename="?([^"]+)"?/.exec(res.headers['content-disposition'] || '')?.[1]
        || `kols.${format}`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onClose();
    } catch {
      setError('Export failed. Please try again.');
      setBusy(false);
    }
  };

  const Choice = ({ value, current, set, children }) => (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, cursor: 'pointer', flex: 1,
      border: `1.5px solid ${current === value ? 'var(--color-primary)' : 'var(--color-border)'}`,
      background: current === value ? 'var(--color-primary-bg)' : 'transparent', fontSize: '0.84rem',
    }}>
      <input type="radio" checked={current === value} onChange={() => set(value)} /> {children}
    </label>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Download size={18} /> Export KOLs</h3>
          <button className="modal-close" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ overflow: 'auto' }}>
          {error && (
            <div className="alert alert-error" style={{ marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
              <AlertCircle size={16} /> {error}
            </div>
          )}

          <div className="form-label" style={{ fontSize: '0.82rem' }}>Format</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <Choice value="xlsx" current={format} set={setFormat}><FileSpreadsheet size={15} /> Excel (.xlsx)</Choice>
            <Choice value="csv" current={format} set={setFormat}><FileText size={15} /> CSV</Choice>
          </div>

          <div className="form-label" style={{ fontSize: '0.82rem' }}>Which KOLs</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            <Choice value="directory" current={scope} set={setScope}>
              Directory — all {total} matching the current search &amp; filters
            </Choice>
            {selectedIds.length > 0 && (
              <Choice value="selected" current={scope} set={setScope}>Only the {selectedIds.length} ticked KOL{selectedIds.length === 1 ? '' : 's'}</Choice>
            )}
            <Choice value="pending" current={scope} set={setScope}>Pending verification — {pendingCount} awaiting approval</Choice>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span className="form-label" style={{ fontSize: '0.82rem', margin: 0 }}>
              Columns {chosen && <span style={{ color: 'var(--color-text-light)', fontWeight: 400 }}>({chosen.size} of {columns.length})</span>}
            </span>
            <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setChosen(new Set(columns.map((c) => c.key)))}>All</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setChosen(new Set())}>None</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setChosen(new Set(columns.filter((c) => c.default).map((c) => c.key)))}>Default</button>
          </div>
          {!chosen ? (
            <div style={{ padding: 20, textAlign: 'center' }}><Loader size={18} className="spinning" /></div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 4 }}>
              {columns.map((c) => (
                <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.82rem', padding: '5px 6px', borderRadius: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={chosen.has(c.key)} onChange={() => toggle(c.key)} /> {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={download} disabled={busy || !chosen || rowCount === 0}>
            {busy ? <><Loader size={15} className="spinning" /> Preparing…</> : <><Download size={15} /> Download {rowCount} KOL{rowCount === 1 ? '' : 's'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
