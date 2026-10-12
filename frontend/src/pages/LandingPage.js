import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Brain, BookOpen, FlaskConical, Network, FileSearch, Download,
  Upload, Cpu, BarChart3, ArrowRight, Check, Zap, FileText, ClipboardCheck,
  Users, MessageSquare, ListChecks, BookMarked, User,
} from 'lucide-react';
import api, { getMe } from '../services/api';
import ThemeToggle from '../components/common/ThemeToggle';
import Wordmark from '../components/common/Wordmark';

const services = [
  { icon: <ClipboardCheck size={24} />, title: 'KOL', desc: 'AI-powered scoring across nine validated criteria with tier classification.', color: 'var(--color-primary)' },
  { icon: <FileText size={24} />, title: 'Surveys', desc: 'Build multi-page surveys with logic branching, images, and rich text.', color: 'var(--color-accent)' },
  { icon: <BarChart3 size={24} />, title: 'Polling', desc: 'Quick polls with multiple questions, real-time results, and CSV export.', color: 'var(--color-violet)' },
  { icon: <ListChecks size={24} />, title: 'Assessment Forms', desc: 'Sharable HCP assessment forms with AI-powered auto-scoring.', color: 'var(--color-success)' },
  { icon: <Users size={24} />, title: 'Advisory Boards', desc: 'Identify and engage the right KOLs for advisory board participation.', color: 'var(--color-warning)' },
  { icon: <BookOpen size={24} />, title: 'Publications', desc: 'Track publication records, citation velocity, and research impact.', color: 'var(--color-info)' },
  { icon: <MessageSquare size={24} />, title: 'Consensus', desc: 'Gather expert consensus through structured survey methodologies.', color: 'var(--color-error)' },
  { icon: <BookMarked size={24} />, title: 'Recent Guidelines', desc: 'Detect KOL contributions to clinical guidelines and practice standards.', color: 'var(--color-accent)' },
];

const features = [
  { icon: <Brain size={28} />, title: 'AI-Powered Scoring', description: 'Leverage advanced algorithms to objectively score and classify KOLs across nine validated criteria.' },
  { icon: <BookOpen size={28} />, title: 'PubMed Integration', description: 'Automatically fetch and analyze publication records to quantify research output and impact.' },
  { icon: <FlaskConical size={28} />, title: 'Clinical Trials Analysis', description: 'Pull investigator roles from ClinicalTrials.gov to assess clinical trial involvement.' },
  { icon: <Network size={28} />, title: 'Network Centrality', description: 'Map co-authorship networks and compute PageRank to identify the most connected leaders.' },
  { icon: <FileSearch size={28} />, title: 'Guideline Detection', description: 'Detect contributions to clinical practice guidelines using intelligent text analysis.' },
  { icon: <Download size={28} />, title: 'Export & Audit Trail', description: 'Export to CSV, view full audit trails, and maintain compliance-ready documentation.' },
];

const tiers = [
  // Ordinal scale drawn straight off the Turacoz brand ramp — blue at the top,
  // down through teal and the greens, neutral for no tier. Flat colours, no
  // gradients. `fg` is carried per tier because the two lightest steps cannot
  // hold white text.
  { name: 'Global KOL', range: '85 - 100', bg: 'var(--brand-blue)', fg: '#FFFFFF', desc: 'World-renowned experts with international influence' },
  { name: 'Strategic KOL', range: '70 - 84', bg: 'var(--brand-teal)', fg: '#FFFFFF', desc: 'High-impact leaders shaping regional strategy' },
  { name: 'National KOL', range: '55 - 69', bg: 'var(--brand-green-4)', fg: '#FFFFFF', desc: 'Recognized authorities at the national level' },
  { name: 'Emerging KOL', range: '40 - 54', bg: 'var(--brand-green-3)', fg: '#FFFFFF', desc: 'Rising stars showing strong potential' },
  { name: 'Local KOL', range: '25 - 39', bg: 'var(--brand-green-1)', fg: 'var(--brand-ink)', desc: 'Respected practitioners in their community' },
  { name: 'Non-KOL', range: '0 - 24', bg: 'var(--color-text-light)', fg: '#FFFFFF', desc: 'Does not meet KOL classification thresholds' },
];

const fallbackPlans = [
  { id: 1, name: 'Starter', slug: 'starter', price_monthly: 0, price_yearly: 0, description: 'Perfect for trying out', max_assessments: 5, max_hcps: 10, is_popular: false, badge_text: null, features: JSON.stringify(['5 Assessments/month', '10 HCP Profiles', 'Basic Scoring', 'Surveys & Polls', 'CSV Export']) },
  { id: 2, name: 'Professional', slug: 'professional', price_monthly: 99, price_yearly: 990, description: 'For growing teams', max_assessments: 100, max_hcps: 500, is_popular: true, badge_text: 'Most Popular', features: JSON.stringify(['100 Assessments/month', '500 HCP Profiles', 'Full Scoring (C.1-C.9)', 'PubMed & ClinicalTrials.gov', 'Unlimited Surveys & Polls', 'Logic Branching', 'CV Parsing', 'Priority Support']) },
  { id: 3, name: 'Enterprise', slug: 'enterprise', price_monthly: 299, price_yearly: 2990, description: 'For large organizations', max_assessments: 0, max_hcps: 0, is_popular: false, badge_text: 'Best Value', features: JSON.stringify(['Unlimited Everything', 'All Data Integrations', 'SSO & Role-Based Access', 'Audit Trail & Compliance', 'Custom API Access', 'Dedicated Account Manager']) },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [billing, setBilling] = useState('monthly');
  const [showPricing, setShowPricing] = useState(false);
  const isLoggedIn = !!localStorage.getItem('token');
  const [userName, setUserName] = useState('');

  useEffect(() => {
    if (isLoggedIn) {
      getMe()
        .then(res => setUserName(res.data.full_name || res.data.email || 'User'))
        .catch(() => {});
    }
  }, [isLoggedIn]);

  useEffect(() => {
    api.get('/site-settings/show_pricing').then((res) => {
      const visible = res.data?.value === 'true';
      setShowPricing(visible);
      if (visible) {
        api.get('/plans').then((r) => setPlans(r.data.length > 0 ? r.data : fallbackPlans)).catch(() => setPlans(fallbackPlans));
      }
    }).catch(() => setShowPricing(false));
  }, []);

  const parseFeatures = (f) => { try { return JSON.parse(f || '[]'); } catch { return []; } };
  const currencySymbols = { USD: '$', INR: '₹', EUR: '€', GBP: '£' };

  return (
    <div className="landing-page">
      <ThemeToggle className="theme-toggle-floating" />
      {/* Nav */}
      <div className="landing-nav">
        <div className="landing-nav-brand">
          {<Wordmark />}
        </div>
        <nav className="landing-nav-links">
          <a href="#services">Solutions</a>
          <a href="#features">Features</a>
          <a href="#how-it-works">How It Works</a>
          {showPricing && <a href="#pricing">Pricing</a>}
        </nav>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {isLoggedIn ? (
            <>
              <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--color-text)' }}>
                <User size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                {userName}
              </span>
              <Link to="/dashboard" className="btn btn-primary">Dashboard</Link>
              <button className="btn btn-ghost" onClick={() => { localStorage.removeItem('token'); navigate('/login'); }}>Logout</button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost">Log In</Link>
              {showPricing ? (
                <a href="#pricing" className="btn btn-primary">Get Started</a>
              ) : (
                <Link to="/login" className="btn btn-primary">Get Started</Link>
              )}
            </>
          )}
        </div>
      </div>

      {/* Hero */}
      <section className="hero">
        <div className="hero-content">
          <h1>AI-Powered KOL Intelligence, Engagement & Management</h1>
          <p>
            From AI-powered KOL assessments to surveys, polling, advisory boards, and guideline tracking
            — TuraSphere KOL gives medical affairs teams everything they need to identify, engage, and
            manage Key Opinion Leaders in one unified platform.
          </p>
          <div className="hero-buttons">
            {showPricing ? (
              <a href="#pricing" className="btn btn-primary">Get Started <ArrowRight size={18} /></a>
            ) : (
              <Link to="/login" className="btn btn-primary">Get Started <ArrowRight size={18} /></Link>
            )}
            <a href="#services" className="btn btn-outline">Explore Solutions</a>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="features" id="services">
        <h2>Our Solutions</h2>
        <p>A comprehensive suite of tools for KOL identification, engagement, and medical affairs dissemination.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 20, maxWidth: 1100, margin: '40px auto 0', padding: '0 24px' }}>
          {services.map((s, i) => (
            <div key={i} style={{
              background: 'var(--color-surface)', borderRadius: 12, padding: '24px 20px', border: '1px solid var(--color-border)',
              transition: 'all 0.2s', cursor: 'default',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)'; }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: `${s.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, color: s.color }}>
                {s.icon}
              </div>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 6, color: 'var(--color-text)' }}>{s.title}</h3>
              <p style={{ fontSize: '0.88rem', color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.5 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="features" id="features" style={{ background: 'var(--color-bg)' }}>
        <h2>Platform Features</h2>
        <p>Powered by AI and integrated with the world's leading medical databases.</p>
        <div className="features-grid">
          {features.map((f, i) => (
            <div className="feature-card" key={i}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="how-it-works" id="how-it-works">
        <div className="how-it-works-inner">
          <h2>How It Works</h2>
          <div className="steps">
            <div className="step">
              <div className="step-number">1</div>
              <Upload size={32} style={{ color: 'var(--color-primary)', marginBottom: 12 }} />
              <h3>Create & Configure</h3>
              <p>Set up HCP profiles, create surveys with logic branching, or launch quick polls for your team.</p>
            </div>
            <div className="step">
              <div className="step-number">2</div>
              <Cpu size={32} style={{ color: 'var(--color-primary)', marginBottom: 12 }} />
              <h3>AI Analysis & Collection</h3>
              <p>Our engine scores KOLs using PubMed, ClinicalTrials.gov, and co-authorship data while collecting survey responses.</p>
            </div>
            <div className="step">
              <div className="step-number">3</div>
              <BarChart3 size={32} style={{ color: 'var(--color-primary)', marginBottom: 12 }} />
              <h3>Insights & Reports</h3>
              <p>Get tier classifications, survey analytics, poll results, and export everything as compliance-ready reports.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Tier Breakdown */}
      <section className="tier-section">
        <h2>KOL Tier Classification</h2>
        <p>Our scoring system classifies healthcare professionals into six distinct tiers.</p>
        <div className="tier-grid">
          {tiers.map((t, i) => (
            <div className="tier-card" key={i} style={{ background: t.bg, color: t.fg }}>
              <h4>{t.name}</h4>
              <div className="tier-range">{t.range}</div>
              <p>{t.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section className="stats-section">
        <div className="stats-section-inner">
          <h2>Trusted by Medical Affairs Teams Worldwide</h2>
          <div className="stats-numbers">
            <div className="stat-item"><div className="stat-num">500+</div><div className="stat-desc">Medical Affairs Teams</div></div>
            <div className="stat-item"><div className="stat-num">50,000+</div><div className="stat-desc">KOLs Assessed</div></div>
            <div className="stat-item"><div className="stat-num">10,000+</div><div className="stat-desc">Surveys Completed</div></div>
            <div className="stat-item"><div className="stat-num">10x</div><div className="stat-desc">Faster Than Manual</div></div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      {showPricing && (
        <section className="pricing-section" id="pricing">
          <h2>Simple, Transparent Pricing</h2>
          <p>Choose the plan that fits your team. Upgrade or downgrade anytime.</p>
          <div className="pricing-toggle">
            <button className={`pricing-toggle-btn ${billing === 'monthly' ? 'active' : ''}`} onClick={() => setBilling('monthly')}>Monthly</button>
            <button className={`pricing-toggle-btn ${billing === 'yearly' ? 'active' : ''}`} onClick={() => setBilling('yearly')}>Yearly <span className="pricing-save-badge">Save 20%</span></button>
          </div>
          <div className="pricing-grid">
            {plans.map((plan) => {
              const featureList = parseFeatures(plan.features);
              const price = billing === 'yearly' ? plan.price_yearly : plan.price_monthly;
              const perMonth = billing === 'yearly' ? Math.round(plan.price_yearly / 12) : plan.price_monthly;
              const sym = currencySymbols[(plan.currency || 'USD').toUpperCase()] || plan.currency + ' ';
              return (
                <div key={plan.id} className={`pricing-card ${plan.is_popular ? 'popular' : ''}`}>
                  {plan.badge_text && <div className="pricing-badge"><Zap size={12} /> {plan.badge_text}</div>}
                  <h3>{plan.name}</h3>
                  <p className="pricing-desc">{plan.description}</p>
                  <div className="pricing-price">
                    {price === 0 ? <span className="pricing-amount">Free</span> : (
                      <><span className="pricing-currency">{sym}</span><span className="pricing-amount">{perMonth}</span><span className="pricing-period">/mo</span></>
                    )}
                  </div>
                  {billing === 'yearly' && price > 0 && <div className="pricing-yearly-note">{sym}{price} billed yearly</div>}
                  <button className={`btn ${plan.is_popular ? 'btn-primary' : 'btn-outline'} btn-block`}
                    onClick={() => isLoggedIn ? navigate(`/checkout?plan_id=${plan.id}&cycle=${billing}`) : navigate(`/register?plan=${plan.slug}&plan_id=${plan.id}&cycle=${billing}`)}>
                    {price === 0 ? 'Get Started Free' : 'Subscribe Now'}
                  </button>
                  <ul className="pricing-features">
                    {featureList.map((feat, i) => <li key={i}><Check size={16} className="pricing-check" /> {feat}</li>)}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="landing-footer">
        &copy; {new Date().getFullYear()} TuraSphere KOL. All rights reserved.
      </footer>
    </div>
  );
}
