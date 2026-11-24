import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const migrationDirectory = new URL('../db/migrations/', import.meta.url);
const migrations = (await readdir(migrationDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  for (const migration of migrations) {
    await client.query(await readFile(new URL(migration, migrationDirectory), 'utf8'));
  }
  const result = await client.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'pod_assessment_prototype'
      AND table_name IN ('patient_profiles', 'patient_imports', 'patient_documents')
    ORDER BY table_name`);
  console.log(JSON.stringify({ status: 'passed', migrations,
    tables: result.rows.map(({ table_name }) => table_name) }, null, 2));
} finally {
  await client.end();
}
