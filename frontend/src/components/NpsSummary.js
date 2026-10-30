import React from 'react';

// Net Promoter Score roll-up for one `nps` survey question. Shared by the team's
// Survey Results page and the engagement dashboard (organizer + client portal);
// the numbers come from the backend's survey_nps.nps_summary.

// Fixed left-to-right order, negative pole → neutral → positive pole. Red and green
// are close for deuteranopia, so the neutral between them, the fixed position and the
// text labels carry the identity too — colour is never the only cue.
const BANDS = [
  { key: 'detractors', label: 'Detractors', range: '0–6', color: 'var(--color-error)', min: 0, max: 6 },
  { key: 'passives', label: 'Passives', range: '7–8', color: 'var(--color-border-strong)', min: 7, max: 8 },
  { key: 'promoters', label: 'Promoters', range: '9–10', color: 'var(--color-success)', min: 9, max: 10 },
];

const bandFor = (score) => BANDS.find(b => score >= b.min && score <= b.max);
const pctOf = (n, total) => (total ? Math.round((100 * n) / total) : 0);
// A real minus sign, and an explicit + since the scale runs from -100 to +100.
const formatScore = (score) => (score > 0 ? `+${score}` : score < 0 ? `−${Math.abs(score)}` : '0');

const MAX_BAR_PX = 56;

export default function NpsSummary({ nps, title }) {
  const peak = Math.max(...nps.distribution, 1);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 28px', alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 auto', minWidth: 96 }}>
        <div style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>NPS</div>
        <div style={{ fontSize: '2.75rem', fontWeight: 700, lineHeight: 1.1, color: 'var(--color-text)' }}>{formatScore(nps.score)}</div>
        <div style={{ fontSize: '0.76rem', color: 'var(--color-text-light)' }}>{nps.total} answer{nps.total === 1 ? '' : 's'}</div>
      </div>

      <div style={{ flex: '1 1 280px', minWidth: 0 }}>
        {title && <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>{title}</div>}

        {/* Share of each band: one whole, split into parts */}
        <div role="img" aria-label={BANDS.map(b => `${b.label} ${pctOf(nps[b.key], nps.total)}%`).join(', ')}
          style={{ display: 'flex', gap: 2, height: 12 }}>
          {BANDS.filter(b => nps[b.key] > 0).map(b => (
            <div key={b.key} title={`${b.label}: ${nps[b.key]} (${pctOf(nps[b.key], nps.total)}%)`}
              style={{ flex: `${nps[b.key]} 1 0`, minWidth: 3, background: b.color, borderRadius: 4 }} />
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', margin: '8px 0 14px' }}>
          {BANDS.map(b => (
            <span key={b.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: b.color, flexShrink: 0 }} />
              {b.label} ({b.range})
              <strong style={{ color: 'var(--color-text)' }}>{nps[b.key]}</strong>
              <span>{pctOf(nps[b.key], nps.total)}%</span>
            </span>
          ))}
        </div>

        {/* Answers per score, 0–10 */}
        <div className="keep-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(11, minmax(0, 1fr))', gap: 2, maxWidth: 420 }}>
          {nps.distribution.map((count, score) => (
            <div key={score} title={`Score ${score}: ${count} (${pctOf(count, nps.total)}%)`}
              aria-label={`Score ${score}: ${count}`}
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: MAX_BAR_PX + 34 }}>
              {count > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: 2 }}>{count}</span>}
              <div style={{ width: '100%', maxWidth: 24, height: Math.max((count / peak) * MAX_BAR_PX, count ? 3 : 1),
                background: count ? bandFor(score).color : 'var(--color-border-light)', borderRadius: count ? '4px 4px 0 0' : 0 }} />
              <span style={{ fontSize: '0.72rem', color: 'var(--color-text-light)', marginTop: 4 }}>{score}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
