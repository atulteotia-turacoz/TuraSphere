import React, { useEffect, useState } from 'react';
import { Plus, Trash2, UserCircle2, Mail, MapPin, Stethoscope, Edit3, X } from 'lucide-react';
import { listBoardKols, createBoardKol, updateBoardKol, deleteBoardKol } from '../../services/api';
import { errorMessage } from '../../utils/apiError';

export const TIERS = [
  { id: 'tier_1', label: 'Tier 1 — Global', color: 'var(--color-violet)' },
  { id: 'tier_2', label: 'Tier 2 — Regional', color: 'var(--color-info)' },
  { id: 'tier_3', label: 'Tier 3 — Local',    color: 'var(--color-success)' },
];
const TIER_BY_ID = Object.fromEntries(TIERS.map(t => [t.id, t]));

export const EMPTY_KOL = { name: '', specialty: '', affiliation: '', country: '', email: '', phone: '', tier: 'tier_2', notes: '' };

// This list used to live in localStorage, so an entry existed only on the
// machine that typed it and could never be assigned to a board (the board
// stores its panel server-side). It is now a real per-account table.


export default function KolsTab() {
  const [kols, setKols] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | kolId
  const [form, setForm] = useState(EMPTY_KOL);
  const [query, setQuery] = useState('');

  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const r = await listBoardKols();
      setKols(r.data || []);
      setErr('');
    } catch (e) {
      setErr(errorMessage(e, 'Could not load your KOLs.'));
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  const startCreate = () => { setForm(EMPTY_KOL); setEditing('new'); };
  const startEdit = (k) => {
    setForm({ ...EMPTY_KOL, ...k });
    setEditing(k.id);
  };
  const cancel = () => { setEditing(null); setForm(EMPTY_KOL); };

  const submit = async () => {
    if (!form.name.trim()) return;
    try {
      const payload = {
        name: form.name, specialty: form.specialty, affiliation: form.affiliation,
        country: form.country, email: form.email, phone: form.phone,
        tier: form.tier, notes: form.notes,
      };
      if (editing === 'new') await createBoardKol(payload);
      else if (editing) await updateBoardKol(editing, payload);
      await refresh();
      cancel();
    } catch (e) { setErr(errorMessage(e, 'Could not save the KOL.')); }
  };

  const remove = async (k) => {
    if (!window.confirm(`Remove "${k.name}" from the KOL directory? They'll also be removed from any board assignments.`)) return;
    try { await deleteBoardKol(k.id); await refresh(); }
    catch (e) { setErr(errorMessage(e, 'Could not remove the KOL.')); }
  };

  const filtered = kols.filter(k => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [k.name, k.specialty, k.affiliation, k.country, k.email].some(v => (v || '').toLowerCase().includes(q));
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>KOL Directory</h3>
          <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            Key Opinion Leaders available for advisory board engagements.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="form-control" placeholder="Search KOLs…" value={query} onChange={e => setQuery(e.target.value)} style={{ minWidth: 220 }} />
          <button className="btn btn-primary" onClick={startCreate}><Plus size={16} /> Add KOL</button>
        </div>
      </div>

      {err && (
        <div style={{ padding: '9px 12px', borderRadius: 7, marginBottom: 12,
                      background: 'var(--color-error-bg, #fdecec)', color: 'var(--color-error)', fontSize: '0.84rem' }}>
          {err}
        </div>
      )}
      {loading && kols.length === 0 && (
        <div style={{ padding: 20, color: 'var(--color-text-light)', fontSize: '0.86rem' }}>Loading KOLs…</div>
      )}

      {editing && (
        <div className="card" style={{ marginBottom: 18, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--color-border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0, fontSize: '0.95rem' }}>{editing === 'new' ? 'New KOL' : 'Edit KOL'}</h4>
            <button className="btn btn-sm btn-ghost" onClick={cancel}><X size={14} /></button>
          </div>
          <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <Field label="Full name *">
              <input className="form-control" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Dr. Jane Doe" />
            </Field>
            <Field label="Specialty">
              <input className="form-control" value={form.specialty} onChange={e => setForm({ ...form, specialty: e.target.value })} placeholder="Oncology" />
            </Field>
            <Field label="Affiliation">
              <input className="form-control" value={form.affiliation} onChange={e => setForm({ ...form, affiliation: e.target.value })} placeholder="Hospital / institution" />
            </Field>
            <Field label="Country">
              <input className="form-control" value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} placeholder="India" />
            </Field>
            <Field label="Email">
              <input className="form-control" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input className="form-control" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Tier">
              <select className="form-control" value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })}>
                {TIERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Notes" full>
              <textarea className="form-control" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Areas of expertise, conflicts of interest, prior engagements…" />
            </Field>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={cancel}>Cancel</button>
              <button className="btn btn-primary" onClick={submit} disabled={!form.name.trim()}>
                {editing === 'new' ? 'Add KOL' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: '50px 32px', textAlign: 'center' }}>
          <UserCircle2 size={36} style={{ color: 'var(--color-text-light)', marginBottom: 8 }} />
          <h4 style={{ margin: '0 0 4px' }}>{kols.length === 0 ? 'No KOLs yet' : 'No matches'}</h4>
          <p style={{ color: 'var(--color-text-secondary)', margin: '0 0 14px', fontSize: '0.88rem' }}>
            {kols.length === 0 ? 'Add Key Opinion Leaders to assign them to advisory boards.' : 'Try a different search term.'}
          </p>
          {kols.length === 0 && <button className="btn btn-primary" onClick={startCreate}><Plus size={14} /> Add your first KOL</button>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {filtered.map(k => {
            const tier = TIER_BY_ID[k.tier] || TIER_BY_ID.tier_2;
            return (
              <div key={k.id} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', background: `${tier.color}1A`,
                      color: tier.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.85rem', flexShrink: 0,
                    }}>
                      {k.name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.92rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.name}</div>
                      <div style={{ fontSize: '0.75rem', color: tier.color, fontWeight: 600 }}>{tier.label}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => startEdit(k)} title="Edit"><Edit3 size={13} /></button>
                    <button className="btn btn-sm btn-ghost" onClick={() => remove(k)} title="Remove"
                      style={{ color: 'var(--color-text-light)' }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--color-error)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-light)'}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {k.specialty && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Stethoscope size={11} /> {k.specialty}
                  </div>
                )}
                {k.affiliation && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                    {k.affiliation}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, fontSize: '0.75rem', color: 'var(--color-text-light)', flexWrap: 'wrap' }}>
                  {k.country && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><MapPin size={10} /> {k.country}</span>}
                  {k.email && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Mail size={10} /> {k.email}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, full, children }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : 'auto' }}>
      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: 4, color: 'var(--color-text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}
