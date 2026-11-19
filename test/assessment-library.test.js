import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { openAssessmentLibrary } from '../src/assessment-library-store.js';
import { normalizeDefinition, contentHash, hashBytes, publicDefinition, validateBundle } from '../src/assessment-content.js';
import { archiveAssets, selectDisplayAssets } from '../src/assessment-assets.js';
import { scoreDefinition } from '../src/definition-scoring.js';
import { buildDefinitionReport, definitionReportHtml } from '../src/definition-report.js';
import { buildPatientAnalytics } from '../src/analytics.js';

function rawDefinition() {
  return { assessment_id: 'fixture', definition_version: '1', assessment: { name: 'Example scale', description: 'An assessment. NovoPsych marketing.', language: 'en' },
    administration: { instructions: 'Choose one answer.' }, questionnaire: { items: [
      { id: 'Q1', order: 1, text: 'First item', response_type: 'choice', options: [{ id: 'high', text: 'Often', printed_value: 3 }, { id: 'low', text: 'Never', printed_value: 0 }] },
      { id: 'Q2', order: 2, text: 'Days', response_type: 'integer', input_spec: { answer_schema: { minimum: 0, maximum: 4 } } },
    ] }, scoring: { enabled: false, status: 'draft', rules: [{ id: 'total', label: 'Total', method: 'sum', item_ids: ['Q1', 'Q2'], value_field: 'printed_value', minimum: 0, maximum: 7, multiplier: 1 }] },
    reporting: { mode: 'numeric_scores', metrics: [{ rule_id: 'total', label: 'Total', minimum: 0, maximum: 7, item_ids: ['Q1', 'Q2'], calculation_method: 'sum' }], interpretation: { overall_total: 'total' } },
    review: { issues: [] }, verification: { definition_version: '1', status: 'technical_checks_passed', rules: [] },
    context_sections: [{ id: 'info', title: 'Information', text: 'Useful content. NovoPsych promotional content.' }], assets: [], provenance: { source_url: 'https://novopsych.example', archive_path: '/private/source' } };
}
const record = (raw = rawDefinition()) => ({ raw, runtime: normalizeDefinition(raw, { bundleHash: 'bundle', verified: true }), links: [] });
const payload = records => ({ bundleHash: contentHash(records.map(r => r.raw)), records, assets: [], manifest: { assessments: records.length } });

async function storageContract(library) {
  await library.initialize();
  const original = record();
  assert.equal((await library.importBundle(payload([original]))).added, 1);
  assert.equal((await library.importBundle(payload([original]))).unchanged, 1);
  assert.deepEqual((await library.getVersion(original.runtime.versionId)).definition, original.raw);
  const edited = rawDefinition(); edited.questionnaire.items[0].text = 'Changed wording';
  const replacement = record(edited);
  await library.importBundle(payload([replacement]));
  assert.equal((await library.activeDefinitions())[0].questions[0].text, 'Changed wording');
  assert.equal((await library.getVersion(original.runtime.versionId)).runtime.questions[0].text, 'First item');
  const broken = record({ ...rawDefinition(), assessment_id: 'other' });
  broken.links = [{ id: 'missing', sha256: 'not-in-assets', metadata: {} }];
  await assert.rejects(library.importBundle(payload([original, broken])));
  assert.equal((await library.activeDefinitions())[0].versionId, replacement.runtime.versionId, 'failed import rolls back active pointers too');
  assert.equal((await library.stats()).assessment_versions, 2);
}

test('versioned SQLite imports are idempotent, preserve originals, and roll back atomically', async () => {
  const library = openAssessmentLibrary({ path: ':memory:' });
  try { await storageContract(library); } finally { await library.close(); }
});

test('versioned PostgreSQL import contract', { skip: !process.env.TEST_LIBRARY_DATABASE_URL }, async () => {
  // This URL must point to a disposable database, never the shared application database.
  const pool = new pg.Pool({ connectionString: process.env.TEST_LIBRARY_DATABASE_URL });
  const schema = `assessment_test_${randomUUID().replaceAll('-', '')}`;
  const library = openAssessmentLibrary({ pool, schema });
  try { await storageContract(library); }
  finally { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await library.close(); await pool.end(); }
});

test('public content omits source archives and provider marketing while preserving private source', () => {
  const raw = rawDefinition(), runtime = normalizeDefinition(raw);
  const dto = publicDefinition(runtime);
  assert.doesNotMatch(JSON.stringify(dto), /novopsych|\/private|source_url/i);
  assert.equal(dto.description, 'An assessment.');
  assert.equal(raw.provenance.archive_path, '/private/source');
  assert.equal(dto.questions[0].options[0].printed_value, 3);
  raw.assessment.name = 'NovoPsych Five-Factor Personality Scale';
  assert.equal(normalizeDefinition(raw).title, 'Five-Factor Personality Scale');
});

test('bundle validation rejects duplicate identities and mismatched report scales', () => {
  const raw = rawDefinition(); validateBundle({ assessments: [raw] });
  assert.throws(() => validateBundle({ assessments: [raw, raw] }), /duplicate/i);
  raw.reporting.metrics[0].maximum = 100;
  assert.throws(() => validateBundle({ assessments: [raw] }), /metric/i);
});

test('draft calculations require opt-in and unchanged evidence, use actual values, and preserve missing answers', () => {
  const d = record().runtime;
  const answers = { Q1: 'high', Q2: 4 };
  assert.equal(scoreDefinition(d, answers).metrics[0].value, null);
  assert.equal(scoreDefinition(d, answers, {}, { draftScores: true }).metrics[0].value, 7);
  assert.equal(scoreDefinition(d, { Q1: 'high' }, {}, { draftScores: true }).metrics[0].value, null);
  assert.equal(scoreDefinition(d, { Q1: 'high', Q2: 20 }, {}, { draftScores: true }).metrics[0].value, null);
  d.rules[0].multiplier = 2;
  assert.match(scoreDefinition(d, answers, {}, { draftScores: true }).metrics[0].reason, /stale/);
});

test('numeric transforms and signed composites work without inventing bounds or totals', () => {
  const raw = rawDefinition(); raw.scoring.rules[0].item_transforms = { Q2: { scale: -1, offset: 4 } };
  const d = record(raw).runtime;
  assert.equal(scoreDefinition(d, { Q1: 'high', Q2: 4 }, {}, { draftScores: true }).metrics[0].value, 3);
  const rows = [{ id: 'a', kind: 'definition', form_id: 'signed', form_version: '1', language: 'en', compatibility_key: 'context-a', overall_metric_id: null,
    completed_at: '2026-11-01T00:00:00Z', scores: { status: 'source_draft_unapproved', metrics: [{ id: 'balance', label: 'Balance', value: -3, minimum: -24, maximum: 24 }] } }];
  rows.push({ ...rows[0], id: 'b', compatibility_key: 'context-b' });
  const result = buildPatientAnalytics('demo-a', rows);
  assert.equal(result.series.length, 2);
  assert.equal(result.series[0].minTotal, -24);
  assert.equal(result.activity[0].score, null, 'a subscale is not an overall total');
});

test('reports compare only compatible saved results and escape all patient content', () => {
  const d = record().runtime;
  const base = { id: 'a', status: 'completed', demoPatientId: 'demo-a', formId: d.id, formVersion: d.versionId, formSnapshot: d,
    completedAt: '2026-11-01T00:00:00Z', context: {}, answers: { Q1: 'high', Q2: 4 }, scores: scoreDefinition(d, { Q1: 'high', Q2: 4 }, {}, { draftScores: true }) };
  const current = structuredClone(base); current.id = 'b'; current.completedAt = '2026-11-02T00:00:00Z'; current.scores.metrics[0].value = 4;
  const other = { ...base, id: 'other', context: { attends_school: false } };
  const report = buildDefinitionReport(current, [base, other]);
  assert.equal(report.visits.length, 2);
  assert.equal(report.metrics[0].previousChange, -3);
  assert.equal(report.metrics[0].value, 4, 'report reads persisted results instead of recomputing');
  report.responses[0].text = '<script>steal()</script>';
  const html = definitionReportHtml(report);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script|novopsych|https?:\/\//i);
  assert.match(html, /Response history/); assert.match(html, /Download PDF/);
});

test('asset archive verifies and deduplicates bytes; unreviewed and mismatched images are withheld', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assessment-assets-'));
  try {
    const bytes = Buffer.from('fixture-image'), sha256 = hashBytes(bytes), path = join(root, 'image.png');
    await writeFile(path, bytes);
    const raw = rawDefinition(); raw.assets = [{ id: 'A1', sha256, archive_path: path, mime_type: 'image/png', role: 'assessment_source_image' },
      { id: 'A2', sha256, archive_path: path, mime_type: 'image/png', role: 'reference_material' }];
    const result = await archiveAssets({ assessments: [raw] }, { sourceRoot: root, assetRoot: join(root, 'out') });
    assert.equal(result.assets.length, 1);
    assert.deepEqual(await readFile(join(root, 'out', result.assets[0].storageKey)), bytes);
    assert.deepEqual(selectDisplayAssets(raw, result.links.get(raw.assessment_id)), []);
    assert.throws(() => selectDisplayAssets(raw, result.links.get(raw.assessment_id), [{ assessmentId: raw.assessment_id, assetId: 'A1' }]), /checksum/);
    const selection = { assessmentId: raw.assessment_id, assetId: 'A1', sha256, questionId: 'Q1',
      reviewedBy: 'test-fixture-reviewer', reviewedOn: '2026-11-19', reuseBasis: 'synthetic test image', alt: 'Fixture image' };
    assert.equal(selectDisplayAssets(raw, result.links.get(raw.assessment_id), [selection])[0].questionId, 'Q1');
    result.links.get(raw.assessment_id)[0].metadata.role = 'website_decoration';
    assert.throws(() => selectDisplayAssets(raw, result.links.get(raw.assessment_id), [selection]), /cannot/);
    raw.assets[0].sha256 = '0'.repeat(64);
    await assert.rejects(archiveAssets({ assessments: [raw] }, { sourceRoot: root, assetRoot: join(root, 'out') }), /checksum/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
