import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

const PAGE_SIZE_OPTIONS = [10, 20, 50];

export default function Pagination({ currentPage, totalItems, pageSize, onPageChange, onPageSizeChange }) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  if (totalItems <= 10) return null;

  // Build page numbers with ellipsis
  const pages = [];
  const addPage = (n) => { if (!pages.includes(n) && n >= 1 && n <= totalPages) pages.push(n); };
  addPage(1);
  if (currentPage > 3) pages.push('...');
  for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) addPage(i);
  if (currentPage < totalPages - 2) pages.push('...');
  if (totalPages > 1) addPage(totalPages);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      padding: '14px 0', marginTop: 16,
    }}>
      {/* Left: showing X-Y of Z */}
      <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
        Showing <strong style={{ color: 'var(--color-text)' }}>{start}-{end}</strong> of <strong style={{ color: 'var(--color-text)' }}>{totalItems}</strong>
      </div>

      {/* Center: page buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button onClick={() => onPageChange(1)} disabled={currentPage === 1}
          style={navBtnStyle(currentPage === 1)} title="First page">
          <ChevronsLeft size={14} />
        </button>
        <button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1}
          style={navBtnStyle(currentPage === 1)} title="Previous">
          <ChevronLeft size={14} />
        </button>

        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`e${i}`} style={{ padding: '0 4px', color: 'var(--color-text-light)', fontSize: '0.82rem' }}>...</span>
          ) : (
            <button key={p} onClick={() => onPageChange(p)}
              style={{
                minWidth: 32, height: 32, borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                fontSize: '0.82rem', fontWeight: p === currentPage ? 700 : 400,
                background: p === currentPage ? 'var(--color-primary)' : 'transparent',
                color: p === currentPage ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (p !== currentPage) e.currentTarget.style.background = 'var(--color-primary-bg)'; }}
              onMouseLeave={e => { if (p !== currentPage) e.currentTarget.style.background = 'transparent'; }}>
              {p}
            </button>
          )
        )}

        <button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages}
          style={navBtnStyle(currentPage === totalPages)} title="Next">
          <ChevronRight size={14} />
        </button>
        <button onClick={() => onPageChange(totalPages)} disabled={currentPage === totalPages}
          style={navBtnStyle(currentPage === totalPages)} title="Last page">
          <ChevronsRight size={14} />
        </button>
      </div>

      {/* Right: page size */}
      {onPageSizeChange && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
          <span>Per page</span>
          <select value={pageSize} onChange={e => onPageSizeChange(Number(e.target.value))}
            style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: '0.82rem', background: 'var(--color-surface)', cursor: 'pointer' }}>
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

function navBtnStyle(disabled) {
  return {
    width: 32, height: 32, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
    background: 'var(--color-surface)', cursor: disabled ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    opacity: disabled ? 0.35 : 1, color: 'var(--color-text-secondary)',
    transition: 'all 0.15s',
  };
}
