import React, { useState, useEffect } from 'react';

export default function ReportsView({ initialResultId }) {
  const [patients, setPatients] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadPatients() {
      try {
        const res = await fetch('/api/demo-patients');
        if (res.ok) setPatients(await res.json());
      } catch (err) {
        console.error(err);
      }
    }
    loadPatients();
  }, []);

  useEffect(() => {
    if (!selectedPatientId) {
      setReports([]);
      setSelectedReport(null);
      return;
    }

    async function loadPatientReports() {
      setLoading(true);
      try {
        const res = await fetch(`/api/results?patient=${encodeURIComponent(selectedPatientId)}`);
        if (res.ok) {
          const data = await res.json();
          setReports(data);
          if (data.length > 0) setSelectedReport(data[0]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadPatientReports();
  }, [selectedPatientId]);

  return (
    <div>
      <div className="page-heading">
        <p className="eyebrow">Patient Assessments & Tests</p>
        <h1>View Test Reports</h1>
        <p>Choose a patient to view their assigned assessments and completed clinical reports.</p>
      </div>

      <div style={{ maxWidth: '400px', marginBottom: '24px' }}>
        <label className="search-label" htmlFor="patient-select">
          Patient
        </label>
        <select
          id="patient-select"
          className="sidebar-language-select"
          value={selectedPatientId}
          onChange={(e) => setSelectedPatientId(e.target.value)}
          style={{ height: '44px' }}
        >
          <option value="">Choose a patient</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}
            </option>
          ))}
        </select>
      </div>

      {loading && <p>Loading test reports...</p>}

      {!loading && selectedPatientId && reports.length === 0 && (
        <div className="panel" style={{ textAlign: 'center', padding: '30px' }}>
          <p style={{ color: '#64748b' }}>No completed assessments or prescriptions for this patient yet.</p>
        </div>
      )}

      {reports.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: '20px' }}>
          {/* Report List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {reports.map((r) => {
              const isSelected = selectedReport?.id === r.id;
              return (
                <div
                  key={r.id}
                  className={`result ${isSelected ? 'primary' : ''}`}
                  onClick={() => setSelectedReport(r)}
                  style={{ cursor: 'pointer', background: isSelected ? '#eff6ff' : '#fff' }}
                >
                  <strong>{r.formTitle || r.formId?.toUpperCase()}</strong>
                  <small style={{ color: '#64748b', display: 'block', marginTop: '4px' }}>
                    Score: {r.score ?? r.scores?.rawTotal ?? 'Complete'} · {new Date(r.createdAt || Date.now()).toLocaleDateString()}
                  </small>
                </div>
              );
            })}
          </div>

          {/* Report Detail View */}
          {selectedReport && (
            <div className="report-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#1e293b' }}>
                    {selectedReport.formTitle || selectedReport.formId?.toUpperCase()} Report
                  </h2>
                  <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                    Completed on {new Date(selectedReport.createdAt || Date.now()).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  className="button outline"
                  style={{ fontSize: '13px' }}
                  onClick={() => window.print()}
                >
                  Print / Save as PDF
                </button>
              </div>

              {selectedReport.scores && (
                <div className="score-banner">
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' }}>
                      Overall Severity
                    </div>
                    <div className="score-band" style={{ marginTop: '4px', textTransform: 'capitalize' }}>
                      {selectedReport.scores.severity || 'Evaluation completed'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', textAlign: 'right' }}>
                      Total Score
                    </div>
                    <div className="score-num" style={{ marginTop: '4px' }}>
                      {selectedReport.scores.rawTotal} / {selectedReport.scores.maxTotal || 27}
                    </div>
                  </div>
                </div>
              )}

              {selectedReport.scores?.requiresHumanFollowUp && (
                <div className="safety-alert">
                  <span style={{ fontSize: '18px' }}>⚠️</span>
                  <div>
                    <strong>Clinical Follow-up Flagged:</strong> Patient indicated thoughts of self-harm
                    or feeling better off dead (Item 9). Prompt clinician safety review required.
                  </div>
                </div>
              )}

              {selectedReport.answers && selectedReport.answers.length > 0 && (
                <div style={{ marginTop: '24px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '12px' }}>
                    Confirmed Item Responses
                  </h3>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <th style={{ textAlign: 'left', padding: '10px 12px' }}>Item</th>
                        <th style={{ textAlign: 'left', padding: '10px 12px' }}>Response</th>
                        <th style={{ textAlign: 'right', padding: '10px 12px' }}>Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedReport.answers.map((a, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '10px 12px' }}>Question {i + 1}</td>
                          <td style={{ padding: '10px 12px', color: '#334155' }}>
                            {a.label || (typeof a === 'object' ? a.value : a)}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600' }}>
                            {typeof a === 'object' ? a.value : a}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
