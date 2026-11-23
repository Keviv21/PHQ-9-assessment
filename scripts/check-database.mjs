import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL in .env.local first.');
const connection = new URL(url);
if (connection.searchParams.get('sslmode') !== 'verify-full') {
  throw new Error('DATABASE_URL must use sslmode=verify-full.');
}
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000 });
client.on('error', (error) => console.error('PostgreSQL connection lost:', error.code || error.message));
try {
  await client.connect();
  const result = await client.query(`SELECT current_database() AS database,
    to_regnamespace('pod_assessment_prototype') IS NOT NULL AS prototype_schema_exists,
    to_regnamespace('pod_assessment_content') IS NOT NULL AS content_schema_exists`);
  console.log(`Connected to PostgreSQL database: ${result.rows[0].database}`);
  console.log(`Prototype schema exists: ${result.rows[0].prototype_schema_exists}`);
  console.log(`Content schema exists: ${result.rows[0].content_schema_exists}`);
  if (result.rows[0].content_schema_exists) {
    const content = await client.query(`SELECT
      (SELECT count(*)::integer FROM pod_assessment_content.assessment_versions WHERE active) AS assessments,
      (SELECT count(*)::integer FROM pod_assessment_content.content_patients) AS patients`);
    console.log(`Published assessments: ${content.rows[0].assessments}; sample patients: ${content.rows[0].patients}`);
  }
  if (result.rows[0].prototype_schema_exists) {
    const temporary = await client.query(`SELECT count(*)::integer AS count FROM pod_assessment_prototype.sessions
      WHERE patient_id = 'demo-z'`);
    console.log(`Temporary smoke-check sessions remaining: ${temporary.rows[0].count}`);
  }
} finally {
  await client.end();
}
