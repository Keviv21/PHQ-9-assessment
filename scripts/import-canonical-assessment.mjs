import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const file = resolve(process.argv[2] || 'data/assessments/gad-7.json');
execFileSync(process.execPath, [new URL('./validate-assessment-definition.mjs', import.meta.url).pathname, file], {
  stdio: 'inherit',
});
const definition = JSON.parse(await readFile(file, 'utf8'));
const hashable = structuredClone(definition);
delete hashable.canonicalHash;
const contentHash = createHash('sha256').update(JSON.stringify(hashable)).digest('hex');
assert.equal(definition.canonicalHash, contentHash, 'canonicalHash does not match the canonical JSON content.');

const runtime = structuredClone(definition);
delete runtime.provenance;
runtime.privateEvidenceAvailable = true;
const expectedDatabase = process.env.ASSESSMENT_DATABASE_NAME?.trim();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const current = (await client.query('SELECT current_database() AS name')).rows[0].name;
  if (expectedDatabase && current !== expectedDatabase) {
    throw new Error(`Refusing to import into ${current}; expected ${expectedDatabase}.`);
  }
  await client.query('BEGIN');
  await client.query(`INSERT INTO pod_assessment_prototype.assessment_versions
    (id, assessment_id, definition_version, content_hash, bundle_hash, definition, runtime, imported_at)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
    ON CONFLICT (assessment_id, content_hash) DO NOTHING`, [
    contentHash,
    definition.id,
    definition.version,
    contentHash,
    definition.sourceSha256,
    JSON.stringify(definition),
    JSON.stringify(runtime),
    new Date().toISOString(),
  ]);
  await client.query(`INSERT INTO pod_assessment_prototype.assessment_library
    (id, title, active_version_id) VALUES ($1, $2, $3)
    ON CONFLICT (id) DO UPDATE
      SET title = EXCLUDED.title, active_version_id = EXCLUDED.active_version_id`,
  [definition.id, definition.title, contentHash]);
  await client.query('COMMIT');
  console.log(JSON.stringify({ status: 'passed', database: current,
    assessmentId: definition.id, activeVersionId: contentHash }, null, 2));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
