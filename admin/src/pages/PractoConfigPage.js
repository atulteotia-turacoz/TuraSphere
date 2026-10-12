import React, { useState, useEffect } from 'react';
import {
  Stethoscope, Check, AlertTriangle, RefreshCw, Wifi, WifiOff,
  ExternalLink, Search,
} from 'lucide-react';
import { testPractoSearch, listAssessmentParameters } from '../services/api';

export default function PractoConfigPage() {
  const [testName, setTestName] = useState('Dr. Pallavi Rathi');
  const [testCity, setTestCity] = useState('Mumbai');
  const [testSpecialty, setTestSpecialty] = useState('Dermatology');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [parameters, setParameters] = useState([]);
  const [loadingParams, setLoadingParams] = useState(true);

  useEffect(() => {
    const fetchParams = async () => {
      try {
        const res = await listAssessmentParameters();
        const practoParams = (res.data || []).filter(
          (p) => p.scoring_source === 'practo'
        );
        setParameters(practoParams);
      } catch {
        // silent
      } finally {
        setLoadingParams(false);
      }
    };
    fetchParams();
  }, []);

  const handleTest = async () => {
    if (!testName.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testPractoSearch({
        doctor_name: testName,
        city: testCity,
        specialty: testSpecialty,
      });
      setTestResult(res.data);
    } catch {
      setTestResult({ success: false, message: 'Test request failed. Check backend logs.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header-row">
        <div>
          <h1><Stethoscope size={24} /> Practo Configuration</h1>
          <p className="page-subtitle">Configure Practo integration for patient influence scoring</p>
        </div>
      </div>

      {/* Info Card */}
      <div className="card" style={{ marginBottom: 20, background: 'var(--tier-gold-bg)', border: '1px solid var(--tier-gold-bg)' }}>
        <div className="card-body" style={{ padding: '16px 20px' }}>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--tier-gold)' }}>
            <strong>Practo Integration:</strong> Used for <strong>C.10 Practo Patient Influence</strong> scoring.
            This integration scrapes publicly available doctor profiles from{' '}
            <a href="https://www.practo.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tier-gold)' }}>
              practo.com <ExternalLink size={10} style={{ verticalAlign: 'middle' }} />
            </a>{' '}
            to extract patient reviews, ratings, experience, and recommendations.
            <strong> No API key required</strong> — works via web scraping of public profiles.
          </p>
        </div>
      </div>

      {/* How It Works */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body" style={{ padding: '20px 24px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1rem' }}>How It Works</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {[
              { step: '1', title: 'Search', desc: 'Searches Practo for the doctor by name, city, and specialty' },
              { step: '2', title: 'Match', desc: 'Validates the search result matches the HCP using name comparison' },
              { step: '3', title: 'Scrape', desc: 'Extracts rating, reviews, experience, and qualifications from the profile' },
              { step: '4', title: 'Score', desc: 'Maps extracted data to C.10 scoring parameters' },
            ].map((item) => (
              <div key={item.step} style={{
                padding: '14px 16px', borderRadius: 8, background: 'var(--content-bg)',
                border: '1px solid var(--border-color)',
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', background: 'var(--tier-gold)',
                  color: 'var(--text-white)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.75rem', fontWeight: 700, marginBottom: 8,
                }}>{item.step}</div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 4 }}>{item.title}</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Test Search */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body" style={{ padding: '20px 24px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '1rem' }}>
            <Search size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            Test Practo Search
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.82rem' }}>Doctor Name</label>
              <input
                className="form-control"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                placeholder="e.g. Dr. Pallavi Rathi"
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.82rem' }}>City</label>
              <input
                className="form-control"
                value={testCity}
                onChange={(e) => setTestCity(e.target.value)}
                placeholder="e.g. Mumbai"
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.82rem' }}>Specialty</label>
              <input
                className="form-control"
                value={testSpecialty}
                onChange={(e) => setTestSpecialty(e.target.value)}
                placeholder="e.g. Dermatology"
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={handleTest}
              disabled={testing || !testName.trim()}
              style={{ height: 40 }}
            >
              {testing ? <><RefreshCw size={14} className="spinning" /> Testing...</> : <><Wifi size={14} /> Test</>}
            </button>
          </div>

          {testResult && (
            <div style={{
              marginTop: 16, padding: '12px 16px', borderRadius: 8, fontSize: '0.88rem',
              background: testResult.success ? 'var(--success-light)' : 'var(--danger-light)',
              color: testResult.success ? 'var(--success)' : 'var(--danger)',
              border: `1px solid ${testResult.success ? 'var(--success-light)' : 'var(--danger-light)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: testResult.data ? 8 : 0 }}>
                {testResult.success
                  ? <Wifi size={16} />
                  : <WifiOff size={16} />}
                <span>{testResult.message}</span>
              </div>

              {testResult.data && (
                <div style={{
                  marginTop: 8, padding: '10px 14px', borderRadius: 6,
                  background: 'var(--content-card-bg)', border: '1px solid var(--success-light)', fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <div><strong>Name:</strong> {testResult.data.name}</div>
                    <div><strong>Specialty:</strong> {testResult.data.specialty}</div>
                    <div><strong>Rating:</strong> {testResult.data.rating}%</div>
                    <div><strong>Reviews:</strong> {testResult.data.reviews_count}</div>
                    <div><strong>Experience:</strong> {testResult.data.experience_years} years</div>
                    <div><strong>Hospital:</strong> {testResult.data.hospital || '--'}</div>
                  </div>
                  {testResult.profile_url && (
                    <div style={{ marginTop: 8 }}>
                      <a href={testResult.profile_url} target="_blank" rel="noopener noreferrer"
                        style={{ color: 'var(--tier-gold)', fontSize: '0.82rem' }}>
                        View on Practo <ExternalLink size={10} />
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Scoring Parameters */}
      <div className="card">
        <div className="card-body" style={{ padding: '20px 24px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '1rem' }}>
            Practo Scoring Parameters (C.10)
          </h3>

          {loadingParams ? (
            <div className="loading-spinner"><div className="spinner" /></div>
          ) : parameters.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              No Practo parameters found. They will be auto-created on server restart.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Max Score</th>
                  <th>Status</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {parameters.map((p) => (
                  <tr key={p.id}>
                    <td><code style={{ fontSize: '0.8rem', background: 'var(--content-raised)', padding: '2px 6px', borderRadius: 4 }}>{p.code}</code></td>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td style={{ textAlign: 'center' }}>{p.max_score}</td>
                    <td>
                      {p.is_active ? (
                        <span className="badge badge-success" style={{ fontSize: '0.72rem' }}>Active</span>
                      ) : (
                        <span className="badge badge-warning" style={{ fontSize: '0.72rem' }}>Inactive</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{p.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 6, background: 'var(--warning-light)', border: '1px solid var(--warning-light)', fontSize: '0.85rem', color: 'var(--warning)' }}>
            <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Practo parameters are <strong>bonus parameters</strong> (disabled by default). Users must enable them from
            their <strong>Parameter Preferences</strong> page before scoring to include Practo data.
          </div>
        </div>
      </div>
    </div>
  );
}
