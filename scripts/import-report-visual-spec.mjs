import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { neon, neonConfig } from '@neondatabase/serverless';

const execFileAsync = promisify(execFile);

// Some development networks allow HTTPS through curl while blocking Node's
// direct sockets. Neon supports a custom fetch implementation, so keep the SQL
// protocol on HTTPS and pass credentials through private temporary files.
neonConfig.fetchFunction = async (url, options = {}) => {
  const directory = await mkdtemp(join(tmpdir(), 'neon-http-'));
  const headersPath = join(directory, 'headers');
  const requestPath = join(directory, 'request.json');
  const responsePath = join(directory, 'response.json');
  try {
    const headers = new Headers(options.headers);
    const headerLines = [...headers.entries()].map(([name, content]) => {
      if (/\r|\n/.test(name) || /\r|\n/.test(content)) throw new Error('Invalid HTTP header.');
      return `${name}: ${content}`;
    }).join('\n');
    await writeFile(headersPath, `${headerLines}\n`, { mode: 0o600 });
    await writeFile(requestPath, options.body ?? '', { mode: 0o600 });
    const { stdout } = await execFileAsync('curl', ['--silent', '--show-error',
      '--connect-timeout', '15', '--max-time', '90', '--request', options.method || 'POST',
      '--header', `@${headersPath}`, '--data-binary', `@${requestPath}`,
      '--output', responsePath, '--write-out', '%{http_code}', String(url)],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const status = Number(stdout.trim());
    if (!Number.isInteger(status) || status < 100) throw new Error('Invalid HTTP status from curl.');
    return new Response(await readFile(responsePath), { status,
      headers: { 'content-type': 'application/json' } });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const args = process.argv.slice(2);
const value = key => args.includes(key) ? args[args.indexOf(key) + 1] : null;
const source = resolve(value('--source') ||
  new URL('../data/report-profiles/ais-report-visual-spec.json', import.meta.url).pathname);
const bytes = await readFile(source);
const spec = JSON.parse(bytes);
const hash = input => createHash('sha256').update(input).digest('hex');

if (spec.schemaVersion !== 'report-visual-spec/1.0.0') throw new Error('Unsupported report visual specification.');
if (!spec.assessmentId || spec.definitionRef?.assessmentId !== spec.assessmentId) {
  throw new Error('Visual specification assessment identity is invalid.');
}
if (!Array.isArray(spec.charts) || !Array.isArray(spec.tables) || !Array.isArray(spec.variants)) {
  throw new Error('Visual specification is missing report structures.');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const parsed = new URL(process.env.DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.searchParams.get('sslmode') !== 'verify-full') {
  throw new Error('PostgreSQL requires sslmode=verify-full.');
}

// Use Neon's HTTPS transport so imports work on networks that block direct
// PostgreSQL and WebSocket connections.
const sql = neon(process.env.DATABASE_URL);
{
  const destination = await sql.query("SELECT current_database() AS database, to_regnamespace('pod_assessment_prototype') IS NOT NULL AS schema_exists");
  const expected = value('--expected-database') || process.env.ASSESSMENT_DATABASE_NAME;
  if (expected && destination[0].database !== expected) throw new Error('Connected database does not match the requested destination.');
  if (!destination[0].schema_exists) throw new Error('The assessment prototype schema is missing.');
  await sql.query(`CREATE TABLE IF NOT EXISTS pod_assessment_prototype.report_visual_spec_versions (
    id TEXT PRIMARY KEY,
    assessment_id TEXT NOT NULL REFERENCES pod_assessment_prototype.assessment_library(id),
    assessment_version_id TEXT NOT NULL REFERENCES pod_assessment_prototype.assessment_versions(id),
    schema_version TEXT NOT NULL, content_hash TEXT NOT NULL, status TEXT NOT NULL,
    clinical_approved BOOLEAN NOT NULL DEFAULT FALSE,
    source_spec JSONB NOT NULL, runtime_spec JSONB NOT NULL, validation JSONB NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(assessment_id,content_hash))`);
  await sql.query(`CREATE TABLE IF NOT EXISTS pod_assessment_prototype.assessment_report_visual_specs (
    assessment_id TEXT PRIMARY KEY REFERENCES pod_assessment_prototype.assessment_library(id),
    active_visual_spec_version_id TEXT NOT NULL REFERENCES pod_assessment_prototype.report_visual_spec_versions(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await sql.query(`CREATE TABLE IF NOT EXISTS pod_assessment_prototype.report_visual_spec_imports (
    import_hash TEXT PRIMARY KEY, manifest JSONB NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const result = await sql.query(`SELECT a.active_version_id, v.definition_version, v.runtime
    FROM pod_assessment_prototype.assessment_library a
    JOIN pod_assessment_prototype.assessment_versions v ON v.id=a.active_version_id
    WHERE a.id=$1`, [spec.assessmentId]);
  const active = result[0];
  if (!active) throw new Error('Assessment is not present in PostgreSQL.');
  if (active.definition_version !== spec.definitionRef.definitionVersion) {
    throw new Error(`Definition version mismatch: database=${active.definition_version}, spec=${spec.definitionRef.definitionVersion}`);
  }
  if (active.runtime.questions.length !== spec.definitionRef.questionnaireItemCount) {
    throw new Error('Questionnaire item count does not match the active definition.');
  }
  const ruleIds = new Set(active.runtime.rules.map(rule => rule.id));
  const missingRules = spec.definitionRef.requiredRuleIds.filter(id => !ruleIds.has(id));
  if (missingRules.length) throw new Error(`Visual specification references missing rules: ${missingRules.join(', ')}`);

  // The application database is self-contained. Import only stable identifiers,
  // hashes and report configuration; never persist source URLs or file paths.
  const databaseSpec = structuredClone(spec);
  databaseSpec.sources = databaseSpec.sources.map(({ id, role, sha256, pageCount, usage }) =>
    ({ id, role, sha256, pageCount, usage }));
  databaseSpec.assets = databaseSpec.assets.map(({ id, role, sha256, mimeType, sourceRef, runtimeUsage }) =>
    ({ id, role, sha256, mimeType, sourceRef, runtimeUsage }));
  const storedBytes = Buffer.from(JSON.stringify(databaseSpec));
  const runtimeSpec = structuredClone(databaseSpec);
  const contentHash = hash(storedBytes);
  const visualSpecVersionId = `visual_${contentHash}`;
  runtimeSpec.visualSpecVersionId = visualSpecVersionId;
  runtimeSpec.assessmentVersionId = active.active_version_id;
  const record = {
    id: visualSpecVersionId, assessmentId: spec.assessmentId,
    assessmentVersionId: active.active_version_id, schemaVersion: spec.schemaVersion,
    contentHash, status: spec.status, clinicalApproved: spec.validation.clinicalApproved === true,
    sourceSpec: databaseSpec, runtimeSpec, validation: spec.validation,
  };
  const importHash = hash(Buffer.concat([storedBytes, Buffer.from(active.active_version_id)]));
  const importedAt = new Date().toISOString();
  const manifest = { schemaVersion: 1, sourceFile: basename(source), assessmentId: spec.assessmentId,
    visualSpecVersionId, assessmentVersionId: active.active_version_id, importedAt };
  const [, inserted] = await sql.transaction([
    sql.query('SELECT pg_advisory_xact_lock($1)', [728186495]),
    sql.query(`INSERT INTO pod_assessment_prototype.report_visual_spec_versions
      (id,assessment_id,assessment_version_id,schema_version,content_hash,status,
       clinical_approved,source_spec,runtime_spec,validation,imported_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11)
      ON CONFLICT(id) DO NOTHING RETURNING id`,
    [record.id, record.assessmentId, record.assessmentVersionId, record.schemaVersion,
      record.contentHash, record.status, record.clinicalApproved, JSON.stringify(record.sourceSpec),
      JSON.stringify(record.runtimeSpec), JSON.stringify(record.validation), importedAt]),
    sql.query(`INSERT INTO pod_assessment_prototype.assessment_report_visual_specs
      (assessment_id,active_visual_spec_version_id,updated_at) VALUES ($1,$2,$3)
      ON CONFLICT(assessment_id) DO UPDATE SET
        active_visual_spec_version_id=excluded.active_visual_spec_version_id,
        updated_at=excluded.updated_at`, [record.assessmentId, record.id, importedAt]),
    sql.query(`INSERT INTO pod_assessment_prototype.report_visual_spec_imports
      (import_hash,manifest,imported_at) VALUES ($1,$2::jsonb,$3)
      ON CONFLICT(import_hash) DO NOTHING`, [importHash, JSON.stringify(manifest), importedAt]),
  ]);
  const stats = (await sql.query(`SELECT
    (SELECT count(*)::int FROM pod_assessment_prototype.report_visual_spec_versions) AS report_visual_spec_versions,
    (SELECT count(*)::int FROM pod_assessment_prototype.assessment_report_visual_specs) AS assessment_report_visual_specs,
    (SELECT count(*)::int FROM pod_assessment_prototype.report_visual_spec_imports) AS report_visual_spec_imports`))[0];
  const verified = (await sql.query(`SELECT v.id, v.runtime_spec->>'layoutTemplate' AS layout_template
    FROM pod_assessment_prototype.assessment_report_visual_specs a
    JOIN pod_assessment_prototype.report_visual_spec_versions v
      ON v.id=a.active_visual_spec_version_id
    WHERE a.assessment_id=$1`, [spec.assessmentId]))[0];
  if (!verified || verified.id !== visualSpecVersionId) {
    throw new Error('Imported visual specification was not activated.');
  }
  console.log(JSON.stringify({ database: destination[0].database, schema: 'pod_assessment_prototype',
    source, added: inserted.length, unchanged: inserted.length ? 0 : 1, active: 1,
    stats, visualSpecVersionId, layoutTemplate: verified.layout_template }, null, 2));
}
