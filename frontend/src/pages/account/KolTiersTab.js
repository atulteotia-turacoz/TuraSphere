import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Layers, Lock } from 'lucide-react';
import { listKolTiers } from '../../services/api';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The score bands that turn an assessment total into a tier.
 *
 * READ-ONLY for the account holder. A band decides how every stored assessment
 * in the account is labelled, and moving one re-tiers all of them at once — so
 * the bands are maintained by a super admin, per account, from
 * Admin → user → KOL Tiers, rather than by the account itself.
 *
 * Hiding the buttons is presentation, not the control: the end-user write
 * endpoints return 403 regardless of what this page renders.
 */
export default function KolTiersTab() {
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await listKolTiers();
      const body = res.data;
      // Always coerce to an array. The endpoint returns a list, but a shape
      // change here once produced "tiers.map is not a function" on every open
      // tab, so never hand a non-array to render.
      setTiers(Array.isArray(body) ? body : (body?.tiers || []));
    } catch {
      setError('Could not load KOL tiers.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Score ranges no active band covers. Derived here rather than returned by
  // the API so there is only one shape to get right.
  const gaps = (() => {
    const active = tiers.filter((t) => t.is_active)
      .slice().sort((a, b) => a.min_score - b.min_score);
    if (active.length === 0) return [];
    const out = [];
    let cursor = 0;
    for (const t of active) {
      if (t.min_score > cursor) out.push(`${round2(cursor)}–${round2(t.min_score - 0.01)}`);
      if (t.max_score == null) return out;
      cursor = Math.max(cursor, t.max_score + 0.01);
    }
    out.push(`${round2(cursor)} and above`);
    return out;
  })();

  if (loading) return <div className="loading-container"><div className="spinner" /></div>;

  return (
    <div>
      <div className="tier-head">
        <div>
          <h3 className="tier-title"><Layers size={18} /> KOL Tiers</h3>
          <p className="tier-sub">
            The score bands that decide an HCP’s tier. An assessment total is matched
            against the active bands, so they must not overlap.
          </p>
        </div>
      </div>

      <div className="alert alert-info tier-readonly">
        <Lock size={16} />
        <span>
          These bands are managed by your administrator. Contact them if a range
          needs changing for your account.
        </span>
      </div>

      {gaps.length > 0 && (
        <div className="alert alert-warning tier-gap">
          <AlertCircle size={16} />
          <span>
            No active tier covers <strong>{gaps.join(', ')}</strong>. A score in that
            range is given the highest tier it clears — ask your administrator to
            extend a band to close the gap.
          </span>
        </div>
      )}
      {error && <div className="alert alert-error"><AlertCircle size={16} /> {error}</div>}

      <div className="card tier-card">
        <table className="tier-table">
          <thead>
            <tr>
              <th>Tier</th><th>Score range</th><th>Colour</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.id} className={t.is_active ? '' : 'is-off'}>
                <td>
                  <span className="tier-name">{t.name}</span>
                  <code className="tier-code">{t.code}</code>
                </td>
                <td className="tier-range-cell">
                  {t.min_score} – {t.max_score == null
                    ? <span title="No upper limit">and above</span>
                    : t.max_score}
                </td>
                <td><span className="tier-swatch" style={{ background: t.color || 'var(--color-border)' }} /></td>
                <td>
                  <span className={`tier-pill${t.is_active ? ' is-on' : ''}`}>
                    {t.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
