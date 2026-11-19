import React, { useState, useEffect } from 'react';
import DoctorChat from './DoctorChat.jsx';
import { languages } from '../data/languages.js';

export default function ClinicView({ currentLanguage, onOpenAssessment }) {
  const [step, setStep] = useState(1);
  const [patients, setPatients] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [definitions, setDefinitions] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedFormId, setSelectedFormId] = useState('phq9');
  const [prescribeLang, setPrescribeLang] = useState(currentLanguage || 'en');
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const [prescribedRecord, setPrescribedRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('Copy patient link');

  useEffect(() => {
    async function loadInitial() {
      try {
        const [patientsRes, catRes, defRes] = await Promise.all([
          fetch('/api/demo-patients'),
          fetch('/api/assessment-library'),
          fetch('/api/definitions'),
        ]);
        if (patientsRes.ok) setPatients(await patientsRes.json());
        if (catRes.ok) setCatalogue(await catRes.json());
        if (defRes.ok) setDefinitions(await defRes.json());
      } catch (err) {
        console.error('Failed to load clinic data:', err);
      }
    }
    loadInitial();
  }, []);

  useEffect(() => {
    setPrescribeLang(currentLanguage);
  }, [currentLanguage]);

  const filteredPatients = patients.filter((p) =>
    p.fullName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  async function handleGoToStepTwo() {
    if (!selectedPatientId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/demo-patients/${encodeURIComponent(selectedPatientId)}/recommendation`);
      if (res.ok) {
        const data = await res.json();
        setSuggestion(data);
        if (data.primarySuggestion?.id) {
          setSelectedFormId(data.primarySuggestion.id);
        }
      }
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePrescribe() {
    if (!selectedPatientId || !selectedFormId) return;
    setLoading(true);
    setError('');
    setPrescribedRecord(null);

    try {
      const isDefinition = selectedFormId.startsWith('definition:');
      const url = isDefinition
        ? `/api/definition-patients/${encodeURIComponent(selectedPatientId)}/prescriptions`
        : `/api/demo-patients/${encodeURIComponent(selectedPatientId)}/prescriptions`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          formId: isDefinition ? selectedFormId.slice(11) : selectedFormId,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to prescribe');

      setPrescribedRecord(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const selectedPatient = patients.find((p) => p.id === selectedPatientId);

  return (
    <div>
      <div className="page-heading">
        <p className="eyebrow">Patient Assessments & Tests</p>
        <h1>Prescribe Test</h1>
        <p>
          Select a patient, review the summary-based suggestion, discuss other options, and
          choose an assessment.
        </p>
      </div>

      <div className="steps" aria-label="Prescription progress">
        <div className={`step ${step === 1 ? 'current' : 'done'}`}>
          <span>1</span>Patient details
        </div>
        <div className="step-line" />
        <div className={`step ${step === 2 ? 'current' : ''}`}>
          <span>2</span>Confirm & Prescribe
        </div>
      </div>

      {error && (
        <div className="safety-alert" style={{ marginBottom: '18px' }}>
          {error}
        </div>
      )}

      {step === 1 && (
        <section>
          <label className="search-label" htmlFor="patient-search">
            Filter by Patient Name
          </label>
          <div className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              id="patient-search"
              type="search"
              placeholder="Search patient..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="patient-list">
            {filteredPatients.map((p) => {
              const initials = p.fullName
                .split(' ')
                .map((n) => n[0])
                .join('');
              const isSelected = p.id === selectedPatientId;
              return (
                <div
                  key={p.id}
                  className={`patient-row ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedPatientId(p.id)}
                >
                  <input
                    type="radio"
                    name="selected-patient"
                    checked={isSelected}
                    onChange={() => setSelectedPatientId(p.id)}
                  />
                  <div className="patient-avatar">{initials}</div>
                  <div>
                    <div className="patient-name">{p.fullName}</div>
                    <div className="patient-subtitle">{p.summarySubtitle || 'Patient summary available'}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="actions">
            <button
              className="button primary"
              type="button"
              disabled={!selectedPatientId || loading}
              onClick={handleGoToStepTwo}
            >
              {loading ? 'Loading...' : 'Next'}
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <div className="detail-grid">
            <article className="panel">
              <h2>Patient summary</h2>
              <div>
                <strong>{selectedPatient?.fullName}</strong>
                <p style={{ marginTop: '8px' }}>
                  {suggestion?.patient?.clinicalSummary ||
                    suggestion?.patient?.observations ||
                    'Recent clinician summary available for evaluation.'}
                </p>
                {suggestion?.patient?.conditions && (
                  <ul className="summary-list" style={{ marginTop: '12px' }}>
                    {suggestion.patient.conditions.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>
            </article>

            <article className="panel">
              <h2>Assessment shortlist</h2>
              {suggestion?.prescriptionChoices?.length > 0 ? (
                <div>
                  {suggestion.prescriptionChoices.map((choice) => (
                    <div
                      key={choice.id}
                      className={`result ${selectedFormId === choice.id ? 'primary' : ''}`}
                      onClick={() => setSelectedFormId(choice.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <strong>{choice.title}</strong>
                      <small>{choice.rationale || 'Suggested based on clinical profile'}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <p>Standard screening measures available: PHQ-9 (Depression), GAD-7 (Anxiety), DASS-21.</p>
              )}
            </article>
          </div>

          <DoctorChat onSelectAssessment={(id) => setSelectedFormId(id)} />

          <section className="panel" style={{ marginTop: '18px' }}>
            <h2>Doctor's final selection</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label className="search-label" htmlFor="assessment-select">
                  Assessment to prescribe
                </label>
                <select
                  id="assessment-select"
                  className="sidebar-language-select"
                  value={selectedFormId}
                  onChange={(e) => setSelectedFormId(e.target.value)}
                  style={{ height: '44px' }}
                >
                  <optgroup label="Core Clinical Assessments">
                    <option value="phq9">PHQ-9 (Patient Health Questionnaire - Depression)</option>
                    <option value="gad7">GAD-7 (Generalised Anxiety Disorder Assessment)</option>
                    <option value="pcl5">PCL-5 (Posttraumatic Stress Disorder Checklist)</option>
                    <option value="dass21">DASS-21 (Depression Anxiety Stress Scales)</option>
                  </optgroup>
                  {catalogue.length > 0 && (
                    <optgroup label="Assessment Library (186 measures)">
                      {catalogue.map((cat) => (
                        <option key={cat.id} value={`draft:${cat.id}`}>
                          {cat.title}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div>
                <label className="search-label" htmlFor="prescribe-language">
                  Assessment Language
                </label>
                <select
                  id="prescribe-language"
                  className="sidebar-language-select"
                  value={prescribeLang}
                  onChange={(e) => setPrescribeLang(e.target.value)}
                  style={{ height: '44px' }}
                >
                  {languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {prescribedRecord && (
            <div className="prescribed-card">
              <h3>Assessment Assigned!</h3>
              <p>
                {selectedPatient?.fullName} can now complete the assessment by voice conversation or
                on screen.
              </p>
              <div className="prescribed-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={() =>
                    onOpenAssessment &&
                    onOpenAssessment(prescribedRecord.id, prescribeLang, selectedFormId)
                  }
                >
                  Open patient assessment
                </button>
                <button
                  type="button"
                  className="button outline"
                  onClick={() => {
                    const url = `${window.location.origin}/?view=assessment&prescriptionId=${prescribedRecord.id}&language=${prescribeLang}`;
                    navigator.clipboard.writeText(url);
                    setCopyStatus('Copied!');
                    setTimeout(() => setCopyStatus('Copy patient link'), 2500);
                  }}
                >
                  {copyStatus}
                </button>
              </div>
            </div>
          )}

          <div className="actions">
            <button className="button outline" type="button" onClick={() => setStep(1)}>
              Back to patients
            </button>
            <button
              className="button primary"
              type="button"
              disabled={loading || Boolean(prescribedRecord)}
              onClick={handlePrescribe}
            >
              {loading ? 'Prescribing...' : 'Confirm & Prescribe'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
