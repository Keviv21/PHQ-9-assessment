import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for this database check.');
const base = `http://127.0.0.1:${process.env.PORT || 4174}`;
const health = await fetch(`${base}/api/health`).then((response) => response.json());
if (!health.ok || health.database !== 'postgresql') throw new Error('Start the local app with PostgreSQL before running this test.');
const formId = 'adult-adhd-self-report-scale-asrs--814829bfeff1';
const jsonRequest = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function api(path, options) {
  const response = await fetch(`${base}${path}`, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  return value;
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
let assignmentId;
let sessionId;
let completed = false;
try {
  await client.connect();
  const assignment = await api('/api/definition-patients/demo-a/prescriptions', jsonRequest({ formId }));
  assignmentId = assignment.id;
  const session = await api(`/api/definition-prescriptions/${assignmentId}/start`, jsonRequest({}));
  sessionId = session.id;
  const answers = Object.fromEntries(session.formSnapshot.questions.map((item) => [item.id, item.options[0].id]));
  for (const [question, option] of Object.entries({ Q1: 'O2', Q2: 'O3', Q3: 'O4', Q4: 'O1', Q5: 'O2', Q6: 'O3' })) {
    if (!session.formSnapshot.questions.find((item) => item.id === question)?.options.some((entry) => entry.id === option)) {
      throw new Error(`Test fixture option ${question}/${option} missing.`);
    }
    answers[question] = option;
  }
  const finished = await api(`/api/definition-sessions/${sessionId}/finish`,
    { ...jsonRequest({ answers }), method: 'POST' });
  const partA = finished.scores.metrics.find((metric) => metric.id === 'part_a_raw')?.value;
  if (partA !== 9) throw new Error(`Unexpected API draft Part A score: ${partA}`);
  const result = await client.query(`SELECT p.patient_id, p.form_id, s.state->>'status' AS status,
      s.state#>>'{answers,Q1}' AS q1, s.state#>>'{answers,Q2}' AS q2,
      metric->>'value' AS part_a_score
    FROM pod_assessment_prototype.definition_prescriptions p
    JOIN pod_assessment_prototype.definition_sessions s ON s.id = p.session_id
    CROSS JOIN LATERAL jsonb_array_elements(s.state#>'{scores,metrics}') AS metric
    WHERE p.id = $1 AND metric->>'id' = 'part_a_raw'`, [assignmentId]);
  const row = result.rows[0];
  if (!row || row.status !== 'completed' || row.q1 !== 'O2' || row.q2 !== 'O3' || Number(row.part_a_score) !== 9) {
    throw new Error('Direct PostgreSQL values did not match the completed API assessment.');
  }
  completed = true;
  console.log(JSON.stringify({ assignmentId, sessionId, patientId: row.patient_id,
    formId: row.form_id, status: row.status, savedQ1: row.q1, savedQ2: row.q2,
    savedDraftPartAScore: Number(row.part_a_score),
    inspectCommand: `npm run db:inspect:definition -- ${assignmentId}` }, null, 2));
} finally {
  if (!completed && assignmentId) {
    await client.query('DELETE FROM pod_assessment_prototype.definition_prescriptions WHERE id=$1', [assignmentId]);
    if (sessionId) await client.query('DELETE FROM pod_assessment_prototype.definition_sessions WHERE id=$1', [sessionId]);
  }
  await client.end();
}
