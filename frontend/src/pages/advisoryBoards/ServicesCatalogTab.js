import React, { useMemo, useState } from 'react';
import { Search, Tag, Layers } from 'lucide-react';
import {
  PHASES, PHASE_BY_ID, SERVICES, FEE_UNITS,
  priceForService, formatMoney,
} from './data';

const unitLabel = (unit) => FEE_UNITS.find(u => u.id === unit)?.label || unit;

export default function ServicesCatalogTab() {
  const [activePhase, setActivePhase] = useState('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SERVICES.filter(s => {
      if (activePhase !== 'all' && s.phase !== activePhase) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.desc.toLowerCase().includes(q) ||
        s.feeLabel.toLowerCase().includes(q)
      );
    });
  }, [activePhase, query]);

  const counts = useMemo(() => {
    const map = { all: SERVICES.length };
    for (const p of PHASES) map[p.id] = SERVICES.filter(s => s.phase === p.id).length;
    return map;
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Services Catalog</h3>
          <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            {SERVICES.length} chargeable services across {PHASES.length} phases. Pricing is set by your super admin.
          </p>
        </div>
        <div style={{ position: 'relative', minWidth: 260 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-light)' }} />
          <input
            className="form-control"
            placeholder="Search services…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ paddingLeft: 32 }}
          />
        </div>
      </div>

      {/* Phase filter pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
        <PhasePill active={activePhase === 'all'} onClick={() => setActivePhase('all')}
          label="All phases" count={counts.all} color="var(--color-text-secondary)" />
        {PHASES.map(p => (
          <PhasePill key={p.id} active={activePhase === p.id} onClick={() => setActivePhase(p.id)}
            label={p.label} count={counts[p.id]} color={p.color} />
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          No services match your filters.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {filtered.map(svc => <ServiceCard key={svc.id} svc={svc} />)}
        </div>
      )}
    </div>
  );
}

function PhasePill({ active, onClick, label, count, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px',
        borderRadius: 999,
        fontSize: '0.8rem',
        fontWeight: 600,
        border: `1px solid ${active ? color : 'var(--color-border)'}`,
        background: active ? color : 'var(--color-text-inverse)',
        color: active ? 'var(--color-text-inverse)' : 'var(--color-text)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        transition: 'all var(--transition)',
      }}
    >
      {label}
      <span style={{
        background: active ? 'rgba(255,255,255,0.25)' : 'var(--color-bg-muted, var(--color-surface-raised))',
        color: active ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
        padding: '0 6px', borderRadius: 999, fontSize: '0.7rem',
      }}>{count}</span>
    </button>
  );
}

function ServiceCard({ svc }) {
  const phase = PHASE_BY_ID[svc.phase];
  const p = priceForService(svc.id);
  return (
    <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <span style={{
          fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 4,
          background: `${phase.color}1A`, color: phase.color, whiteSpace: 'nowrap',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          <Layers size={10} /> {phase.label}
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', fontFamily: 'var(--font-mono, monospace)' }}>
          {svc.id}
        </span>
      </div>
      <div style={{ fontWeight: 600, fontSize: '0.92rem', lineHeight: 1.3 }}>{svc.name}</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{svc.desc}</div>
      <div style={{
        marginTop: 4, paddingTop: 8, borderTop: '1px dashed var(--color-border-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
          <Tag size={11} /> {svc.feeLabel}
        </span>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: p.isCustom ? 'var(--color-primary)' : 'var(--color-text-light)' }}>
          {p.price > 0 ? formatMoney(p.price, p.currency) : 'Not set'}
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-light)', fontWeight: 400, marginLeft: 4 }}>
            / {unitLabel(p.unit)}
          </span>
        </span>
      </div>
    </div>
  );
}
