import pg from 'pg';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { schemaName } from '../../src/storage/postgres/database.js';

// A consistent snapshot of the patient and assessment tables; no application startup or writes.
export async function backupPatientData(connectionString, schema, destination) {
  schema = schemaName(schema);
  const url = new URL(connectionString);
  if (url.hostname.endsWith('.neon.tech')) url.searchParams.set('sslmode', 'verify-full');
  setDefaultAutoSelectFamilyAttemptTimeout(3000);
  const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 15000, statement_timeout: 15000 });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tables = {};
    for (const name of ['patients', 'patient_records', 'assessment_prescriptions', 'assessment_sessions']) {
      const table = `"${schema}"."${name}"`;
      if (!(await client.query('SELECT to_regclass($1) AS name', [table])).rows[0].name) {
        if (name === 'patient_records') continue; // Supports backup before the first history migration.
        throw new Error(`Missing application table: ${name}`);
      }
      tables[name] = (await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    }
    const text = JSON.stringify({ format: 'patient-data-backup-v1', database: url.pathname.slice(1), schema, createdAt: new Date().toISOString(), tables }, null, 2);
    const path = resolve(destination);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, text, { mode: 0o600, flag: 'wx' });
    if (readFileSync(path, 'utf8') !== text) throw new Error('Backup file verification failed.');
    await client.query('COMMIT');
    return { path, sha256: createHash('sha256').update(text).digest('hex'), counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])) };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await backupPatientData(process.env.DATABASE_URL, process.env.DATABASE_SCHEMA || 'assessments', process.argv[2] || `local-data/backups/patient-data-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Backup failed (${error.code || 'validation'}). The database was not changed.`);
    process.exitCode = 1;
  }
}
