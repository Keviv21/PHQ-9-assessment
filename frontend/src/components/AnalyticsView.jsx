import React, { useState, useEffect } from 'react';

export default function AnalyticsView() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAnalytics() {
      try {
        const res = await fetch('/api/analytics/overview');
        if (res.ok) {
          setOverview(await res.json());
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchAnalytics();
  }, []);

  return (
    <div>
      <div className="page-heading">
        <p className="eyebrow">Patient Assessments & Tests</p>
        <h1>Assessment Analytics</h1>
        <p>Track assessment activity, completion volume, and patient score trends over time.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <div className="panel" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>TOTAL COMPLETED</div>
          <div style={{ fontSize: '32px', fontWeight: '800', color: '#0088ff', marginTop: '6px' }}>
            {overview?.completedCount ?? 5}
          </div>
        </div>

        <div className="panel" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>ACTIVE ASSIGNMENTS</div>
          <div style={{ fontSize: '32px', fontWeight: '800', color: '#10b981', marginTop: '6px' }}>
            {overview?.activeCount ?? 2}
          </div>
        </div>

        <div className="panel" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>SCREENED PATIENTS</div>
          <div style={{ fontSize: '32px', fontWeight: '800', color: '#8b5cf6', marginTop: '6px' }}>
            {overview?.patientCount ?? 5}
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Assessment Distribution & Progress</h2>
        <p style={{ marginBottom: '16px' }}>
          Standardized clinical instruments administered across sample patient sessions:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
              <span>PHQ-9 (Depression Screening)</span>
              <strong>60%</strong>
            </div>
            <div style={{ height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: '60%', height: '100%', background: '#0088ff' }} />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
              <span>GAD-7 (Generalised Anxiety)</span>
              <strong>25%</strong>
            </div>
            <div style={{ height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: '25%', height: '100%', background: '#10b981' }} />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
              <span>DASS-21 / Other Measures</span>
              <strong>15%</strong>
            </div>
            <div style={{ height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: '15%', height: '100%', background: '#8b5cf6' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
