import React, { useMemo, useState } from 'react';
import { Search, Lock } from 'lucide-react';
import {
  PHASES, PHASE_BY_ID, SERVICES, FEE_UNITS,
  priceForService, formatMoney,
} from './data';

// Read-only rate card. Pricing is managed from the admin app's
// Configuration → Advisory Board Services page.
export default function PricingTab(/* canEdit */) {
  const [activePhase, setActivePhase] = useState('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SERVICES.filter((s) => {
      if (activePhase !== 'all' && s.phase !== activePhase) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || (s.feeLabel || '').toLowerCase().includes(q);
    });
  }, [activePhase, query]);

  const totalSet = SERVICES.filter((s) => Number(s.defaultPrice) > 0).length;
  const unitLabel = (u) => FEE_UNITS.find((x) => x.id === u)?.label || u;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Pricing & Rate Card</h3>
          <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            {totalSet} of {SERVICES.length} services have a rate configured.
            Pricing is set centrally — contact your super admin to update.
          </p>
        </div>
      </div>

      <div className="alert alert-info" style={{
        marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--color-info-bg)', color: 'var(--color-info-text)', border: '1px solid var(--color-info-bg)',
        padding: '10px 14px', borderRadius: 6,
      }}>
        <Lock size={14} />
        <span>
          This rate card is read-only. Super admins manage the catalog and prices from
          the admin panel under <strong>Configuration → Advisory Board Services</strong>.
        </span>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        <FilterPill active={activePhase === 'all'} onClick={() => setActivePhase('all')} label="All phases" color="var(--color-text-secondary)" />
        {PHASES.map((p) => (
          <FilterPill key={p.id} active={activePhase === p.id} onClick={() => setActivePhase(p.id)} label={p.label} color={p.color} />
        ))}
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-light)' }} />
          <input
            className="form-control"
            placeholder="Search services…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ paddingLeft: 32 }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg-muted, var(--color-bg))', borderBottom: '1px solid var(--color-border-light)' }}>
                <Th>Service</Th>
                <Th>Phase</Th>
                <Th>Default unit</Th>
                <Th align="right">Default price</Th>
                <Th align="right">Currency</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 30, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                  {SERVICES.length === 0 ? 'Loading catalog…' : 'No services match your filters.'}
                </td></tr>
              ) : filtered.map((svc) => {
                const phase = PHASE_BY_ID[svc.phase];
                const p = priceForService(svc.id);
                const isSet = Number(p.price) > 0;
                return (
                  <tr key={svc.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{svc.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-light)' }}>{svc.feeLabel}</div>
                    </Td>
                    <Td>
                      <span style={{ padding: '2px 8px', borderRadius: 4, background: `${phase.color}1A`, color: phase.color, fontSize: '0.72rem', fontWeight: 600 }}>
                        {phase.label}
                      </span>
                    </Td>
                    <Td>{unitLabel(p.unit)}</Td>
                    <Td align="right" style={{ fontWeight: 600 }}>
                      {isSet ? formatMoney(p.price, p.currency) : <span style={{ color: 'var(--color-text-light)', fontWeight: 400 }}>not set</span>}
                    </Td>
                    <Td align="right">{p.currency}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, label, color }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 999, fontSize: '0.8rem', fontWeight: 600,
      border: `1px solid ${active ? color : 'var(--color-border)'}`,
      background: active ? color : 'var(--color-text-inverse)', color: active ? 'var(--color-text-inverse)' : 'var(--color-text)',
      cursor: 'pointer', transition: 'all var(--transition)',
    }}>{label}</button>
  );
}

const Th = ({ children, align = 'left', style }) => (
  <th style={{ padding: '10px 14px', textAlign: align, fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', ...style }}>{children}</th>
);
const Td = ({ children, align = 'left', style }) => (
  <td style={{ padding: '10px 14px', textAlign: align, verticalAlign: 'middle', ...style }}>{children}</td>
);
