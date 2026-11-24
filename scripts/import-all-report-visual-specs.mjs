import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import pg from 'pg';
import { openReportVisualSpecStore } from '../src/report-visual-spec-store.js';

const args = process.argv.slice(2);
const value = key => args.includes(key) ? args[args.indexOf(key) + 1] : null;
const source = resolve(value('--source') ||
  new URL('../data/report-profiles/all-assessment-report-visual-specs.json', import.meta.url).pathname);
const bytes = await readFile(source);
const bundle = JSON.parse(bytes);
const hash = input => createHash('sha256').update(input).digest('hex');
const forbidden = /https?:\/\/|\/home\/|assessment-url-preview|assessment-exports\/|artifacts\/batches\//i;

if (bundle.schemaVersion !== 'report-visual-spec-bundle/1.0.0') {
  throw new Error('Unsupported report visual specification bundle.');
}
if (!Array.isArray(bundle.assessments) || bundle.assessments.length !== bundle.assessmentCount) {
  throw new Error('Visual specification bundle count is invalid.');
}
if (new Set(bundle.assessments.map(spec => spec.assessmentId)).size !== bundle.assessments.length) {
  throw new Error('Visual specification bundle contains duplicate assessment identities.');
}
if (forbidden.test(JSON.stringify(bundle))) {
  throw new Error('Visual specification bundle contains an external URL or extraction-workspace path.');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const parsed = new URL(process.env.DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.searchParams.get('sslmode') !== 'verify-full') {
  throw new Error('PostgreSQL requires sslmode=verify-full.');
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 15000 });
const store = openReportVisualSpecStore({ pool });
try {
  const destination = await pool.query("SELECT current_database() AS database, to_regnamespace('pod_assessment_prototype') IS NOT NULL AS schema_exists");
  const expected = value('--expected-database') || process.env.ASSESSMENT_DATABASE_NAME;
  if (expected && destination.rows[0].database !== expected) {
    throw new Error('Connected database does not match the requested destination.');
  }
  if (!destination.rows[0].schema_exists) throw new Error('The assessment prototype schema is missing.');
  await store.initialize();
  const activeRows = await pool.query(`SELECT a.id AS assessment_id, a.active_version_id,
      v.definition_version, v.runtime
    FROM pod_assessment_prototype.assessment_library a
    JOIN pod_assessment_prototype.assessment_versions v ON v.id=a.active_version_id`);
  const activeByAssessment = new Map(activeRows.rows.map(row => [row.assessment_id, row]));
  if (activeByAssessment.size !== bundle.assessments.length) {
    throw new Error(`Database/library count mismatch: database=${activeByAssessment.size}, bundle=${bundle.assessments.length}`);
  }

  const records = [];
  for (const sourceSpec of bundle.assessments) {
    if (sourceSpec.schemaVersion !== 'report-visual-spec/1.0.0' ||
        sourceSpec.definitionRef?.assessmentId !== sourceSpec.assessmentId) {
      throw new Error(`Invalid visual specification identity: ${sourceSpec.assessmentId}`);
    }
    const active = activeByAssessment.get(sourceSpec.assessmentId);
    if (!active) throw new Error(`Assessment is missing from PostgreSQL: ${sourceSpec.assessmentId}`);
    if (active.definition_version !== sourceSpec.definitionRef.definitionVersion) {
      throw new Error(`Definition version mismatch for ${sourceSpec.assessmentId}`);
    }
    if (active.runtime.questions.length !== sourceSpec.definitionRef.questionnaireItemCount) {
      throw new Error(`Questionnaire item count mismatch for ${sourceSpec.assessmentId}`);
    }
    const ruleIds = new Set(active.runtime.rules.map(rule => rule.id));
    const missingRules = sourceSpec.definitionRef.requiredRuleIds.filter(id => !ruleIds.has(id));
    if (missingRules.length) {
      throw new Error(`${sourceSpec.assessmentId} references missing rules: ${missingRules.join(', ')}`);
    }
    const databaseSpec = structuredClone(sourceSpec);
    const contentHash = hash(Buffer.from(JSON.stringify(databaseSpec)));
    const visualSpecVersionId = `visual_${contentHash}`;
    const runtimeSpec = structuredClone(databaseSpec);
    runtimeSpec.visualSpecVersionId = visualSpecVersionId;
    runtimeSpec.assessmentVersionId = active.active_version_id;
    records.push({
      id: visualSpecVersionId, assessmentId: sourceSpec.assessmentId,
      assessmentVersionId: active.active_version_id, schemaVersion: sourceSpec.schemaVersion,
      contentHash, status: sourceSpec.status,
      clinicalApproved: sourceSpec.validation?.clinicalApproved === true,
      sourceSpec: databaseSpec, runtimeSpec, validation: sourceSpec.validation || {},
    });
  }

  const importHash = hash(Buffer.from(JSON.stringify({ bundleHash: bundle.bundleHash,
    definitions: records.map(record => [record.assessmentId, record.assessmentVersionId]) })));
  const imported = await store.importSpecs({ importHash,
    manifest: { schemaVersion: 1, sourceFile: basename(source), bundleHash: bundle.bundleHash,
      assessmentCount: records.length, importedAt: new Date().toISOString() }, records });
  const readiness = await store.readiness();
  console.log(JSON.stringify({ database: destination.rows[0].database, schema: 'pod_assessment_prototype',
    ...imported, stats: await store.stats(), readiness: readiness.summary }, null, 2));
} finally {
  await store.close();
  await pool.end();
}
