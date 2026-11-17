import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview, buildPatientAnalytics } from '../src/analytics.js';

test('patient timelines compare only the same assessment and version', () => {
  const rows = [
    { id: 'later', form_id: 'phq9', form_version: 'v1', language: 'en', mode: 'live', completed_at: '2026-11-10T10:00:00.000Z', scores_json: JSON.stringify({ rawTotal: 9, maxTotal: 27, severity: 'mild' }) },
    { id: 'earlier', form_id: 'phq9', form_version: 'v1', language: 'en', mode: 'demo', completed_at: '2026-10-10T10:00:00.000Z', scores_json: JSON.stringify({ rawTotal: 15, maxTotal: 27, severity: 'moderately severe', requiresHumanFollowUp: true }) },
    { id: 'other-form', form_id: 'gad7', form_version: 'v1', language: 'en', mode: 'live', completed_at: '2026-11-01T10:00:00.000Z', scores_json: JSON.stringify({ rawTotal: 8, maxTotal: 21 }) },
    { id: 'new-version', form_id: 'phq9', form_version: 'v2', language: 'en', mode: 'live', completed_at: '2026-11-11T10:00:00.000Z', scores_json: JSON.stringify({ rawTotal: 7, maxTotal: 27 }) },
  ];
  const result = buildPatientAnalytics('demo-a', rows);
  assert.equal(result.totalCompleted, 4);
  assert.equal(result.series.length, 3);
  const phqV1 = result.series.find((item) => item.formId === 'phq9' && item.formVersion === 'v1');
  assert.deepEqual(phqV1.points.map((point) => point.id), ['earlier', 'later']);
  assert.equal(phqV1.changeFromPrevious, -6);
  assert.equal(phqV1.points[0].requiresHumanFollowUp, true);
  assert.equal(result.series.find((item) => item.formVersion === 'v2').changeFromPrevious, null);
  assert.equal(result.series.find((item) => item.formId === 'gad7').maxTotal, 21);
});

test('overview counts prescribed work and uses completed linked assessments for timing', () => {
  const rows = [
    { form_id: 'phq9', created_at: '2026-10-01T00:00:00.000Z', assessment_id: 'a', assessment_status: 'completed', completed_at: '2026-10-01T02:00:00.000Z' },
    { form_id: 'phq9', created_at: '2026-11-01T00:00:00.000Z', assessment_id: 'b', assessment_status: 'completed', completed_at: '2026-11-01T06:00:00.000Z' },
    { form_id: 'gad7', created_at: '2026-11-02T00:00:00.000Z', assessment_id: 'c', assessment_status: 'in_progress', completed_at: null },
    { form_id: 'pcl5', created_at: '2026-11-03T00:00:00.000Z', assessment_id: null, assessment_status: null, completed_at: null },
  ];
  const result = buildOverview(rows, new Date('2026-11-13T00:00:00.000Z'));
  assert.deepEqual(result.totals, { prescribed: 4, completed: 2, inProgress: 1,
    notStarted: 1, completionRate: 50, medianCompletionHours: 4 });
  assert.equal(result.months.find((item) => item.month === '2026-10').completed, 1);
  assert.equal(result.months.find((item) => item.month === '2026-11').completed, 1);
  assert.deepEqual(result.byForm.map((item) => [item.prescribed, item.completed]), [[2, 2], [1, 0], [1, 0]]);
  assert.equal(buildOverview([], new Date('2026-11-13T00:00:00.000Z')).totals.completionRate, null);
});

test('combined analytics keeps all completed assessments and charts DASS-21 on separate scales', () => {
  const rows = [
    { id: 'phq', form_id: 'phq9', form_version: 'v1', language: 'en', mode: 'demo',
      completed_at: '2026-11-01T00:00:00.000Z', scores: { rawTotal: 8, maxTotal: 27 } },
    { id: 'dass', prescription_id: 'dass-rx', form_id: 'dass21', form_title: 'DASS-21',
      form_version: 'imported-draft-v1', language: 'en', mode: 'demo',
      completed_at: '2026-11-02T00:00:00.000Z', scores: { rawTotal: 14,
        rawSubscales: { depression: 8, anxiety: 4, stress: 2 },
        severity: { total: 'Normal', depression: 'Moderate', anxiety: 'Mild', stress: 'Normal' } } },
    { id: 'brief', prescription_id: 'brief-rx', form_id: 'draft:brief', form_title: 'Brief Resilience Scale',
      form_version: 'imported-draft-v1', language: 'en', mode: 'demo',
      completed_at: '2026-11-03T00:00:00.000Z', scores: null },
  ];
  const result = buildPatientAnalytics('demo-a', rows);
  assert.equal(result.totalCompleted, 3);
  assert.equal(result.totalScored, 2);
  assert.equal(result.series.length, 5);
  assert.equal(result.series.find((item) => item.formId === 'dass21' && item.metricId === 'total').maxTotal, 63);
  assert.equal(result.series.find((item) => item.metricId === 'depression').points[0].score, 8);
  assert.equal(result.activity[1].detailUrl, '/report.html?draftSessionId=dass');
  assert.equal(result.activity[2].score, null);
  assert.equal(result.activity[2].detailUrl, '/report.html?draftSessionId=brief');
  const overview = buildOverview([
    { form_id: 'phq9', created_at: rows[0].completed_at, assessment_id: 'phq',
      assessment_status: 'completed', completed_at: rows[0].completed_at },
    { form_id: 'dass21', form_title: 'DASS-21', created_at: rows[1].completed_at,
      assessment_id: 'dass', assessment_status: 'completed', completed_at: rows[1].completed_at },
    { form_id: 'draft:brief', form_title: 'Brief Resilience Scale', created_at: rows[2].completed_at,
      assessment_id: 'brief', assessment_status: 'completed', completed_at: rows[2].completed_at },
  ], new Date('2026-11-13T00:00:00.000Z'));
  assert.equal(overview.totals.completed, 3);
  assert.equal(overview.byForm.find((item) => item.formId === 'draft:brief').completed, 1);
  assert.equal(overview.months.find((item) => item.month === '2026-11').completed, 3);
});

test('completed catalogue analytics opens the shared report', () => {
  const result = buildPatientAnalytics('demo-a', [{ id: 'definition-session', kind: 'definition',
    prescription_id: 'definition-prescription', form_id: 'definition:sample', form_title: 'Sample assessment',
    form_version: 'v1', language: 'en', mode: 'screen', completed_at: '2026-11-03T00:00:00.000Z',
    scores: { metrics: [{ id: 'total', label: 'Total', value: 4, minimum: 0, maximum: 10 }] } }]);
  assert.equal(result.activity[0].detailUrl, '/report.html?definitionSessionId=definition-session');
});
