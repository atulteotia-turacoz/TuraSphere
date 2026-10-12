import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, MessageSquare, BookMarked, ArrowLeft, Hammer } from 'lucide-react';

// Modules that are granted and appear in the nav, but have no screen yet. They
// are listed rather than hidden because the entitlement is real — the user has
// been given the module, it just is not built. A dead nav item that 404s is
// worse than one that says so.
const MODULES = {
  publications: {
    icon: BookOpen,
    title: 'Publications',
    blurb: 'Plan and track publication deliverables — manuscripts, abstracts and posters — alongside the boards and KOLs they come from.',
  },
  consensus: {
    icon: MessageSquare,
    title: 'Consensus',
    blurb: 'Run structured consensus exercises with your panel: propose statements, collect rounds of votes, and record where agreement was reached.',
  },
  recent_guidelines: {
    icon: BookMarked,
    title: 'Recent Guidelines',
    blurb: 'Track newly published clinical guidelines in your therapeutic areas and see which of your KOLs contributed to them.',
  },
};

export default function ComingSoonPage({ module }) {
  const cfg = MODULES[module] || { icon: Hammer, title: 'Module', blurb: 'This module is not available yet.' };
  const Icon = cfg.icon;

  return (
    <div className="page container">
      <div className="coming-soon">
        <div className="coming-soon-icon"><Icon size={30} /></div>
        <span className="coming-soon-badge">Coming soon</span>
        <h2>{cfg.title}</h2>
        <p>{cfg.blurb}</p>
        <p className="coming-soon-note">
          Your account has access to this module — it is still being built, and will
          appear here once it ships.
        </p>
        <Link to="/dashboard" className="btn btn-secondary">
          <ArrowLeft size={16} /> Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
