import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

// Route segment → readable label. Anything not listed falls back to a
// title-cased segment, so a new route still renders something sensible.
const LABELS = {
  dashboard: 'Dashboard',
  assessments: 'Assessments',
  'advisory-boards': 'Advisory Boards',
  surveys: 'Surveys',
  polling: 'Polling',
  account: 'My Account',
  hcp: 'HCP',
  new: 'New Assessment',
  results: 'Results',
  assess: 'Assessment',
  checkout: 'Checkout',
  meeting: 'Meeting',
  edit: 'Edit',
};

// Segments that are an id rather than a place — shown as "#12", never linked.
const isId = (seg) => /^\d+$/.test(seg);

function labelFor(seg) {
  if (LABELS[seg]) return LABELS[seg];
  if (isId(seg)) return `#${seg}`;
  return seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);

  const crumbs = segments.map((seg, i) => ({
    label: labelFor(seg),
    // An id segment on its own is not a navigable page.
    to: isId(seg) ? null : '/' + segments.slice(0, i + 1).join('/'),
    last: i === segments.length - 1,
  }));

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link to="/dashboard" className="breadcrumb-home" aria-label="Dashboard">
        <Home size={14} />
      </Link>
      {crumbs.map((c, i) => (
        <React.Fragment key={`${c.label}-${i}`}>
          <ChevronRight size={13} className="breadcrumb-sep" aria-hidden="true" />
          {c.last || !c.to ? (
            <span className="breadcrumb-current" aria-current={c.last ? 'page' : undefined}>
              {c.label}
            </span>
          ) : (
            <Link to={c.to} className="breadcrumb-link">{c.label}</Link>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
