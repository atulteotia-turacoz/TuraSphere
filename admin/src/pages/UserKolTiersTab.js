import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Edit3, Check, X, AlertCircle, Layers } from 'lucide-react';
import {
  listUserKolTiers, createUserKolTier, updateUserKolTier, deleteUserKolTier,
} from '../services/api';

const BLANK = { name: '', min_score: '', max_score: '', color: '#3EA151', is_active: true, sort_order: 0 };
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * One account's KOL tier bands, edited by a super admin.
 *
 * The account holder sees these read-only on their own Account page. Editing
 * lives here because a band decides how every stored assessment in that account
 * is labelled, and saving re-tiers all of them — the response reports how many
 * moved, which is worth showing rather than swallowing.
 */
export default function UserKolTiersTab({ userId, userEmail }) {
  const [tiers, setTiers] = useState([]);
  const [gaps, setGaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await listUserKolTiers(userId);
      setTiers(res.data?.tiers || []);
      setGaps(res.data?.coverage_gaps || []);
      setError('');
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not load this account’s tiers.');
    } finally { setLoading(false); }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const cancel = () => { setEditingId(null); setAdding(false); setDraft(BLANK); setError(''); };

  const startEdit = (t) => {
    setAdding(false);
    setEditingId(t.id);
    setError('');
    setDraft({
      name: t.name,
      min_score: String(t.min_score ?? ''),
      max_score: t.max_score == null ? '' : String(t.max_score),
      color: t.color || '#3EA151',
      is_active: t.is_active,
      sort_order: t.sort_order ?? 0,
    });
  };

  const payload = () => ({
    name: draft.name.trim(),
    min_score: Number(draft.min_score),
    // Empty means no ceiling, which is different from zero — the top band has
    // to keep matching however high a score goes.
    max_score: draft.max_score === '' ? null : Number(draft.max_score),
    color: draft.color,
    is_active: draft.is_active,
    // Sent explicitly so the band keeps its position — the API treats a missing
    // sort_order as "leave it", but being explicit keeps ordering predictable
    // when a band is edited repeatedly.
    sort_order: draft.sort_order,
  });

  const save = async () => {
    if (!draft.name.trim()) { setError('Give the tier a name.'); return; }
    if (draft.min_score === '' || Number.isNaN(Number(draft.min_score))) {
      setError('Lowest score is required.'); return;
    }
    setBusy(true); setError('');
    try {
      const res = adding
        ? await createUserKolTier(userId, payload())
        : await updateUserKolTier(userId, editingId, payload());
      await load();
      cancel();
      const n = res?.data?.retiered || 0;
      setNotice(n
        ? `Saved — ${n} of this account's assessment${n === 1 ? '' : 's'} moved to a different tier.`
        : 'Saved.');
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not save this tier.');
    } finally { setBusy(false); }
  };

  const toggleActive = async (t) => {
    setBusy(true); setError('');
    try {
      const res = await updateUserKolTier(userId, t.id, {
        name: t.name, min_score: t.min_score, max_score: t.max_score,
        color: t.color, is_active: !t.is_active,
      });
      await load();
      const n = res?.data?.retiered || 0;
      setNotice(`${t.name} ${t.is_active ? 'deactivated' : 'activated'}`
        + (n ? ` — ${n} assessment${n === 1 ? '' : 's'} re-tiered.` : '.'));
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not change this tier.');
    } finally { setBusy(false); }
  };

  const remove = async (t) => {
    const range = `${t.min_score}–${t.max_score == null ? 'and above' : t.max_score}`;
    if (!window.confirm(
      `Delete the “${t.name}” tier (${range}) for ${userEmail}?\n\n`
      + 'Assessments already scored into it keep their recorded tier, but that '
      + 'score range will no longer be covered until another band is extended.'
    )) return;
    setBusy(true); setError('');
    try {
      const res = await deleteUserKolTier(userId, t.id);
      await load();
      const n = res?.data?.retiered || 0;
      const left = res?.data?.coverage_gaps || [];
      setNotice('Tier deleted.'
        + (n ? ` ${n} assessment${n === 1 ? '' : 's'} re-tiered.` : '')
        + (left.length ? ` No band now covers ${left.join(', ')}.` : ''));
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not delete this tier.');
    } finally { setBusy(false); }
  };

  const editor = (
    <tr>
      <td>
        <input className="form-control" value={draft.name} placeholder="Tier name"
               onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input className="form-control" style={{ width: 80 }} value={draft.min_score} placeholder="Min"
                 onChange={(e) => setDraft({ ...draft, min_score: e.target.value })} />
          <span>–</span>
          <input className="form-control" style={{ width: 80 }} value={draft.max_score} placeholder="∞"
                 onChange={(e) => setDraft({ ...draft, max_score: e.target.value })} />
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 3 }}>
          Leave the upper bound empty for “and above”.
        </div>
      </td>
      <td>
        <input type="color" value={draft.color} style={{ width: 40, height: 28, padding: 0, border: 'none', background: 'none' }}
               onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
      </td>
      <td>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
          <input type="checkbox" checked={draft.is_active}
                 onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />
          Active
        </label>
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button className="btn btn-sm btn-primary" onClick={save} disabled={busy}>
          <Check size={14} /> Save
        </button>
        <button className="btn btn-sm" onClick={cancel} disabled={busy} style={{ marginLeft: 6 }}>
          <X size={14} />
        </button>
      </td>
    </tr>
  );

  if (loading) return <div className="loading-container"><div className="spinner" /></div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 7, fontSize: '1rem' }}>
            <Layers size={17} /> KOL Tiers
          </h3>
          <p style={{ margin: '3px 0 0', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
            Score bands for <strong>{userEmail}</strong>. The account sees these read-only;
            saving a change re-tiers that account’s existing assessments.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" disabled={adding}
                onClick={() => {
                  setAdding(true); setEditingId(null); setError('');
                  // Land at the end of the list, not on top of an existing band.
                  setDraft({ ...BLANK, sort_order: (tiers[tiers.length - 1]?.sort_order ?? 0) + 1 });
                }}>
          <Plus size={15} /> Add Tier
        </button>
      </div>

      {gaps.length > 0 && (
        <div className="alert alert-warning" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <AlertCircle size={16} />
          <span>
            No active tier covers <strong>{gaps.map(g => (typeof g === 'string' ? g : `${round2(g.from)}–${round2(g.to)}`)).join(', ')}</strong>.
            A score in that range takes the highest band it clears.
          </span>
        </div>
      )}
      {error && <div className="alert alert-error"><AlertCircle size={16} /> {error}</div>}
      {notice && <div className="alert alert-success"><Check size={16} /> {notice}</div>}

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Tier</th><th>Score range</th><th>Colour</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {adding && editor}
            {!adding && tiers.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 18, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                  This account has no tier bands. Assessments will not be given a tier
                  until at least one band exists — add them with <strong>Add Tier</strong>.
                </td>
              </tr>
            )}
            {tiers.map((t) => (
              editingId === t.id ? <React.Fragment key={t.id}>{editor}</React.Fragment> : (
                <tr key={t.id} style={{ opacity: t.is_active ? 1 : 0.55 }}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{t.name}</div>
                    <code style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{t.code}</code>
                  </td>
                  <td>
                    {t.min_score} – {t.max_score == null ? 'and above' : t.max_score}
                  </td>
                  <td>
                    <span style={{
                      display: 'inline-block', width: 18, height: 18, borderRadius: 5,
                      background: t.color || 'var(--border)',
                    }} />
                  </td>
                  <td>
                    <button type="button" className="btn btn-sm" onClick={() => toggleActive(t)} disabled={busy}>
                      {t.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" onClick={() => startEdit(t)} title="Edit">
                      <Edit3 size={14} />
                    </button>
                    {/* Seeded bands are deletable too. They are per-account
                        copies, and a past assessment keeps the label it was
                        scored with because assessments.tier is a plain string,
                        not a foreign key. */}
                    <button className="btn btn-sm" onClick={() => remove(t)}
                            style={{ marginLeft: 6 }} title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
