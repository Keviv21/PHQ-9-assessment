import pg from 'pg';

const id = process.argv[2];
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')) {
  throw new Error('Pass a definition assignment UUID: npm run db:inspect:definition -- <assignment-id>');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
try {
  await client.connect();
  const result = await client.query(`SELECT p.id AS assignment_id, p.patient_id, p.form_id,
      p.created_at, s.id AS session_id, s.state
    FROM pod_assessment_prototype.definition_prescriptions p
    LEFT JOIN pod_assessment_prototype.definition_sessions s ON s.id = p.session_id
    WHERE p.id = $1 OR s.id = $1`, [id]);
  if (!result.rows.length) throw new Error('Definition assignment or session not found.');
  const row = result.rows[0];
  const state = row.state;
  const answers = state ? state.formSnapshot.questions.filter((item) => Object.hasOwn(state.answers, item.id))
    .map((item) => {
      const answer = state.answers[item.id];
      const option = item.options?.find((entry) => entry.id === answer);
      return { questionId: item.id, answer: item.responseType === 'text' ? '[text response saved]' : answer,
        printedValue: option?.printed_value ?? null };
    }) : [];
  console.log(JSON.stringify({
    assignmentId: row.assignment_id, patientId: row.patient_id, formId: row.form_id,
    sessionId: row.session_id, status: state?.status ?? 'assigned',
    createdAt: row.created_at.toISOString(), completedAt: state?.completedAt ?? null,
    answerCount: answers.length, answers,
    draftScores: state?.scores?.metrics?.map(({ id, label, value, reason }) => ({ id, label, value, reason })) ?? [],
  }, null, 2));
} finally { await client.end(); }
