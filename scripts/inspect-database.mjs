import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('Set DATABASE_URL in the ignored .env.local file first.');
const sessionId = process.argv[2];
if (sessionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
  throw new Error('Pass a session UUID, for example: npm run db:inspect -- <session-id>');
}

const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 });
client.on('error', (error) => console.error('PostgreSQL connection lost:', error.code || error.message));
try {
  await client.connect();
  const identity = await client.query('SELECT current_database() AS database');
  console.log(`Connected to Neon database: ${identity.rows[0].database}`);
  const schema = await client.query("SELECT to_regnamespace('pod_assessment_prototype') IS NOT NULL AS exists");
  if (!schema.rows[0].exists) {
    console.log('Prototype schema does not exist yet. Start the app once with npm run dev.');
    process.exitCode = 0;
  } else if (sessionId) {
    const result = await client.query(`SELECT kind, form_id, patient_id, state
      FROM pod_assessment_prototype.sessions WHERE id = $1`, [sessionId]);
    if (!result.rows.length) {
      console.log('No assessment session found for that ID.');
    } else {
      const row = result.rows[0];
      const state = row.state;
      console.log(JSON.stringify({
        id: state.id, kind: row.kind, formId: row.form_id, patientId: row.patient_id,
        status: state.status, startedAt: state.startedAt, completedAt: state.completedAt,
        answers: state.answers.map(({ number, value, method }) => ({ number, value, method })),
        score: state.scores, reviewChangeCount: state.reviewChangeCount,
      }, null, 2));
    }
  } else {
    const tables = await client.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'pod_assessment_prototype' ORDER BY table_name`);
    console.log(`Prototype tables: ${tables.rows.map((row) => row.table_name).join(', ')}`);
    const counts = await client.query(`SELECT
      (SELECT count(*)::integer FROM pod_assessment_prototype.prescriptions) AS prescriptions,
      (SELECT count(*)::integer FROM pod_assessment_prototype.sessions) AS sessions,
      (SELECT count(*)::integer FROM pod_assessment_prototype.sessions
        WHERE state->>'status' = 'completed') AS completed`);
    console.table(counts.rows);
    const recent = await client.query(`SELECT id, kind, form_id, patient_id,
      state->>'status' AS status,
      jsonb_array_length(state->'answers') AS answers,
      state#>>'{scores,rawTotal}' AS raw_score,
      completed_at FROM pod_assessment_prototype.sessions
      ORDER BY started_at DESC LIMIT 10`);
    if (recent.rows.length) console.table(recent.rows.map((row) => ({
      id: row.id, kind: row.kind, form: row.form_id,
      patient: row.patient_id, status: row.status, answers: row.answers,
      score: row.raw_score ?? '—', completed: row.completed_at?.toISOString() ?? '—',
    })));
    else console.log('No cloud assessment sessions yet. Complete an assessment, then run this command again.');
  }
} finally { await client.end(); }
