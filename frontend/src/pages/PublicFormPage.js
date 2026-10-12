import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  Upload, AlertCircle, CheckCircle, FileText, X, User, Building2,
  Stethoscope, MapPin, Briefcase, Clock, BookOpen, Mic, Users, Award, Loader, Send, Mail,
} from 'lucide-react';
import { getPublicForm, submitPublicForm, extractCVPublic } from '../services/api';
import ThemeToggle from '../components/common/ThemeToggle';
import Wordmark from '../components/common/Wordmark';

export default function PublicFormPage() {
  const { token } = useParams();
  const fileRef = useRef(null);

  const [formInfo, setFormInfo] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState('');

  const [form, setForm] = useState({
    full_name: '', email: '', city: '', specialty: '', institution: '',
    designation: '', years_of_experience: '', key_clinical_interests: '',
    publications: '', conference_presentations: '', professional_memberships: '',
    awards_recognitions: '',
  });
  const [cvFile, setCvFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await getPublicForm(token);
        setFormInfo(res.data);
      } catch (err) {
        const status = err.response?.status;
        if (status === 404) setPageError('This form link does not exist.');
        else if (status === 410) setPageError('This form link is no longer active.');
        else setPageError('Failed to load form. Please check the link and try again.');
      } finally {
        setPageLoading(false);
      }
    }
    load();
  }, [token]);

  const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleFileDrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (!file) return;
    setCvFile(file);
    setError('');

    // Auto-extract fields from CV
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await extractCVPublic(token, fd);
      const extracted = res.data;
      // Only fill empty fields so user's existing input is preserved
      setForm(prev => {
        const updated = { ...prev };
        Object.keys(extracted).forEach(key => {
          if (extracted[key] && !prev[key]?.trim()) {
            updated[key] = key === 'years_of_experience' ? String(extracted[key]) : extracted[key];
          }
        });
        return updated;
      });
    } catch {
      // Extraction failed silently — user can still fill manually
    } finally {
      setExtracting(false);
    }
  };

  const handleRemoveFile = (e) => {
    e.stopPropagation();
    setCvFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const filledCount = Object.values(form).filter(v => v.trim() !== '').length;
  const hasFormData = filledCount > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!cvFile && !hasFormData) {
      setError('Please fill in HCP details or upload a CV.');
      return;
    }

    setError('');
    setSubmitting(true);

    try {
      const fd = new FormData();
      Object.entries(form).forEach(([key, val]) => {
        if (val.trim()) {
          fd.append(key, key === 'years_of_experience' ? parseInt(val, 10) : val.trim());
        }
      });
      if (cvFile) fd.append('file', cvFile);

      await submitPublicForm(token, fd);
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.detail || 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Every state of this page is branded. It is the only screen people outside
  // the account ever see, and an unbranded form asking a doctor for their CV
  // reads as a phishing page.
  const Shell = ({ children, narrow }) => (
    <div className="pf-page">
      <header className="pf-bar">
        <Wordmark />
        <ThemeToggle />
      </header>
      <main className={`pf-main${narrow ? ' is-narrow' : ''}`}>{children}</main>
      <footer className="pf-foot">
        Your details are used only for this assessment and are not shared publicly.
      </footer>
    </div>
  );

  if (pageLoading) {
    return (
      <Shell narrow>
        <div className="pf-state">
          <Loader size={30} className="spinning" style={{ color: 'var(--color-primary)' }} />
          <p>Loading form…</p>
        </div>
      </Shell>
    );
  }

  if (pageError) {
    return (
      <Shell narrow>
        <div className="pf-state">
          <span className="pf-state-icon is-error"><AlertCircle size={26} /></span>
          <h2>Form unavailable</h2>
          <p>{pageError}</p>
        </div>
      </Shell>
    );
  }

  if (submitted) {
    return (
      <Shell narrow>
        <div className="pf-state">
          <span className="pf-state-icon is-success"><CheckCircle size={26} /></span>
          <h2>Submission received</h2>
          <p>
            Thank you. The assessment team will review your details
            {cvFile ? ' and CV' : ''} and follow up if anything else is needed.
          </p>
          <p className="pf-state-note">You can close this page.</p>
        </div>
      </Shell>
    );
  }

  const field = (key, label, icon, props = {}) => (
    <div className="pf-field">
      <label htmlFor={`pf-${key}`}>{icon}{label}</label>
      {props.multiline ? (
        <textarea id={`pf-${key}`} className="form-control" rows={props.rows || 2}
          placeholder={props.placeholder} value={form[key]}
          onChange={e => handleChange(key, e.target.value)} />
      ) : (
        <input id={`pf-${key}`} className="form-control" type={props.type || 'text'}
          min={props.min} placeholder={props.placeholder} value={form[key]}
          onChange={e => handleChange(key, e.target.value)} />
      )}
    </div>
  );

  return (
    <Shell>
      <div className="pf-head">
        <h1>{formInfo?.title || 'HCP Assessment Form'}</h1>
        <p>
          Share your professional details for review. Upload a CV, fill the form,
          or do both — <strong>every field is optional</strong>.
        </p>
      </div>

      {error && (
        <div className="alert alert-error pf-alert"><AlertCircle size={18} /> {error}</div>
      )}

      {/* CV first: dropping one fills the form in below, so asking for it after
          twelve fields had it backwards. Horizontal, so it cannot stretch into
          the tall empty column it used to be. */}
      <div
        className={`pf-cv${cvFile ? ' has-file' : ''}${extracting ? ' is-busy' : ''}`}
        onClick={() => !extracting && fileRef.current?.click()}
        onDrop={handleFileDrop}
        onDragOver={e => e.preventDefault()}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
      >
        <span className="pf-cv-icon">
          {extracting ? <Loader size={22} className="spinning" />
            : cvFile ? <CheckCircle size={22} /> : <Upload size={22} />}
        </span>
        <span className="pf-cv-copy">
          <strong>
            {extracting ? 'Reading your CV…'
              : cvFile ? cvFile.name
              : 'Have a CV? Upload it and we\u2019ll fill the form for you'}
          </strong>
          <span>
            {extracting ? 'This takes a few seconds. Anything we find is filled in below for you to check.'
              : cvFile ? 'Details below were filled from this file — please check them.'
              : 'Drag and drop, or click to browse. PDF, DOC, DOCX, PPT, PPTX, PNG or JPG.'}
          </span>
        </span>
        {cvFile && !extracting && (
          <button type="button" className="pf-cv-clear" onClick={handleRemoveFile} title="Remove file">
            <X size={16} />
          </button>
        )}
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.tiff,.bmp"
          style={{ display: 'none' }} onChange={handleFileDrop} />
      </div>

      <form onSubmit={handleSubmit}>
        <section className="card pf-section">
          <h2 className="pf-section-title"><User size={16} /> About you</h2>
          <div className="pf-grid is-2">
            {field('full_name', 'Full name', <User size={14} />, { placeholder: 'e.g. Dr. Anupam Kumar Singh' })}
            {field('email', 'Email', <Mail size={14} />, { type: 'email', placeholder: 'e.g. doctor@hospital.com' })}
            {field('city', 'City / location', <MapPin size={14} />, { placeholder: 'e.g. New Delhi' })}
            {field('specialty', 'Specialty', <Stethoscope size={14} />, { placeholder: 'e.g. Cardiology' })}
          </div>
        </section>

        <section className="card pf-section">
          <h2 className="pf-section-title"><Building2 size={16} /> Practice</h2>
          <div className="pf-grid">
            {field('institution', 'Institution / hospital', <Building2 size={14} />, { placeholder: 'e.g. AIIMS, Pushpanjali Hospital' })}
            {field('designation', 'Designation', <Briefcase size={14} />, { placeholder: 'e.g. Professor, HOD' })}
            {field('years_of_experience', 'Years of experience', <Clock size={14} />, { type: 'number', min: '0', placeholder: 'e.g. 15' })}
          </div>
        </section>

        <section className="card pf-section">
          <h2 className="pf-section-title"><Award size={16} /> Expertise &amp; recognition</h2>
          <div className="pf-grid is-wide">
            {field('key_clinical_interests', 'Key clinical or research interests', <BookOpen size={14} />, { multiline: true, placeholder: 'e.g. Interventional cardiology, heart failure' })}
            {field('publications', 'Publications', <FileText size={14} />, { multiline: true, placeholder: 'e.g. 25 peer-reviewed papers in NEJM, Lancet' })}
            {field('conference_presentations', 'Conference presentations', <Mic size={14} />, { multiline: true, placeholder: 'e.g. Keynote at ESC 2024' })}
            {field('professional_memberships', 'Professional memberships', <Users size={14} />, { multiline: true, placeholder: 'e.g. CSI, AHA Fellow' })}
            {field('awards_recognitions', 'Awards / recognitions', <Award size={14} />, { multiline: true, placeholder: 'e.g. BC Roy Award' })}
          </div>
        </section>

        {/* Sticky, because the form is long enough that a footer button would
            sit far below whatever you are typing. */}
        <div className="pf-submit">
          <span className="pf-submit-status">
            {cvFile && filledCount > 0 ? `CV attached · ${filledCount} field${filledCount === 1 ? '' : 's'} filled`
              : cvFile ? 'CV attached'
              : filledCount > 0 ? `${filledCount} field${filledCount === 1 ? '' : 's'} filled`
              : 'Add a CV or fill at least one field'}
          </span>
          <button type="submit" className="btn btn-primary" disabled={submitting || (!cvFile && !hasFormData)}>
            {submitting ? <><Loader size={16} className="spinning" /> Submitting…</> : <><Send size={16} /> Submit</>}
          </button>
        </div>
      </form>
    </Shell>
  );
}
