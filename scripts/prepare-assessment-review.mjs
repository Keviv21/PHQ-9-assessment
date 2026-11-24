// Deliberately no pg/server/store imports and no dotenv loading: shared DB is unreachable here.
import { readFile, writeFile, mkdir, realpath, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hashBytes, contentHash, validateBundle, scoringRuntimeHash } from '../src/assessment-content.js';
import { archiveAssets } from '../src/assessment-assets.js';
import { prepareReportDefinition, versionPreparedDefinition, definitionReview, previewReport } from '../src/assessment-review.js';
import { reviewReportHtml, reviewCatalogueHtml } from '../src/assessment-review-html.js';

const args = process.argv.slice(2);
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (!['--source', '--source-root', '--out'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: node scripts/prepare-assessment-review.mjs --source <all-assessments.json> --source-root <extraction-root> [--out <new-review-directory>]');
  options.set(args[i], args[i + 1]);
}
if (!options.has('--source') || !options.has('--source-root')) throw new Error('--source and --source-root are required. This command performs local preparation only.');
const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(options.get('--out') || join(root, 'local-data/assessment-review'));
// Refuse replacing any existing directory: each review is a separate reproducible artifact.
try { await stat(out); throw new Error('Output already exists. Choose a new review directory.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const sourcePath = await realpath(resolve(options.get('--source')));
const sourceBytes = await readFile(sourcePath), bundleHash = hashBytes(sourceBytes);
const rawBundle = validateBundle(JSON.parse(sourceBytes));
const baselinePath = join(root, 'data/assessment-library.json');
const baselineBytes = await readFile(baselinePath), baseline = JSON.parse(baselineBytes);
if (baseline.bundleHash !== bundleHash) throw new Error('Extraction checksum does not match the local runtime baseline.');
if (baseline.records.length !== rawBundle.assessments.length) throw new Error('Source and baseline counts differ.');
const verification = spawnSync(process.env.PYTHON || 'python3', [join(root, 'scripts/verify-assessment-evidence.py'), sourcePath], { encoding: 'utf8' });
if (verification.status !== 0) throw new Error(verification.stderr || 'Source fingerprints failed.');
console.log(verification.stdout.trim());
console.log('Checking archived asset checksums (read-only)…');
const archive = await archiveAssets(rawBundle, { sourceRoot: resolve(options.get('--source-root')), assetRoot: out, dryRun: true });
const baselineMap = new Map(baseline.records.map(d => [d.id, d]));
const records = [], reviews = [];
for (const raw of rawBundle.assessments) {
  const previous = baselineMap.get(raw.assessment_id);
  if (!previous || previous.assets.length) throw new Error('Unexpected baseline or approved display assets; review the version recipe.');
  const runtime = versionPreparedDefinition(raw, prepareReportDefinition(previous));
  if (scoringRuntimeHash(runtime) !== previous.runtimeHash) throw new Error('Preparation changed scoring content.');
  const links = archive.links.get(raw.assessment_id);
  const review = definitionReview(runtime, raw, links);
  reviews.push(review); records.push({ raw, runtime, links });
}
// Run the existing independent source fixtures without promoting all definitions to clinical approval.
const benchmarks = JSON.parse(await readFile(join(root, 'test/fixtures/scoring-benchmarks.json'), 'utf8'));
const { scoreDefinition } = await import('../src/definition-scoring.js');
let assertions = 0, sourceGaps = 0;
for (const fixture of benchmarks.assessments) {
  const d = records.find(r => r.runtime.id === fixture.assessment_id).runtime;
  const review = reviews.find(r => r.assessmentId === d.id);
  review.sourceBenchmarkAssertions = 0;
  for (const example of fixture.cases) {
    const scores = scoreDefinition(d, example.answers, example.context || {}, { draftScores: true });
    for (const [id, expected] of Object.entries(example.expected_scores)) {
      const actual = scores.metrics.find(m => m.id === id)?.value;
      const gap = example.kind === 'known_source_gap';
      if (gap) sourceGaps++;
      else { assertions++; review.sourceBenchmarkAssertions++; }
      if ((gap || expected === null) ? actual !== null : !Number.isFinite(actual) || Math.abs(actual - expected) >= 0.0001) review.errors.push(`Source fixture mismatch: ${example.id}/${id}`);
    }
  }
  if (review.errors.length) review.technicalStatus = 'failed';
}
const manifest = {
  schemaVersion: 1, bundleHash, baselineSha256: hashBytes(baselineBytes), preparationVersion: '1.0.0-review.1',
  assessments: records.length, numericAssessments: reviews.filter(r => r.mode === 'numeric_scores').length,
  responseFields: records.reduce((n, r) => n + r.runtime.questions.length, 0), scoringRules: records.reduce((n, r) => n + r.runtime.rules.length, 0),
  chartConfigurations: records.reduce((n, r) => n + r.runtime.reporting.reportPlan.charts.length, 0),
  technicalPass: reviews.filter(r => r.technicalStatus === 'passed').length,
  clinicallyApproved: 0, sourceReportEquivalenceVerified: 0, databaseAccess: 'none',
  uniqueFiles: archive.assets.length, archivedBytes: archive.assets.reduce((n, a) => n + a.byteSize, 0),
  referencesWithoutFiles: archive.missing, displayImages: 0, clinicalScoringEnabled: false,
  independentSourceFixtures: { assessments: benchmarks.assessments.length, assertions, knownGapsWithheld: sourceGaps },
  syntheticallyExercisedRules: reviews.reduce((n, r) => n + r.rulesExercised, 0),
  syntheticCases: reviews.length * 4, previewPages: reviews.length * 3,
};
await mkdir(out, { recursive: true, mode: 0o700 });
for (const name of ['definitions', 'profiles', 'reviews', 'previews']) await mkdir(join(out, name), { mode: 0o700 });
const written = [];
async function save(path, value) {
  const bytes = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  await writeFile(join(out, path), bytes, { mode: 0o600 });
  written.push({ path, sha256: hashBytes(bytes) });
}
for (const [i, { runtime }] of records.entries()) {
  if (!/^[a-z0-9-]+$/.test(runtime.id)) throw new Error('Unsafe definition filename.');
  const review = reviews[i];
  await save(`definitions/${runtime.id}.json`, runtime);
  await save(`profiles/${runtime.id}.json`, runtime.reporting.reportPlan);
  await save(`reviews/${runtime.id}.json`, review);
  for (const scenario of ['single', 'repeated', 'missing']) await save(`previews/${runtime.id}.${scenario}.html`, reviewReportHtml(runtime, previewReport(runtime, scenario), review, scenario));
}
await save('assessment-library.json', { schemaVersion: 1, bundleHash, manifest, records: records.map(r => r.runtime) });
await save('readiness.json', { manifest, assessments: reviews });
const csv = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
await save('readiness.csv', ['Assessment,Mode,Technical status,Report readiness,Rules,Source benchmark assertions,Missing assets,Clinical status,Gaps', ...reviews.map(r => [r.title, r.mode, r.technicalStatus, r.reportStatus, r.ruleCount, r.sourceBenchmarkAssertions || 0, r.missingAssetReferences.length, r.clinicalStatus, r.gaps.join(' | ')].map(csv).join(','))].join('\n') + '\n');
await save('import-candidate.json', { schemaVersion: 1, kind: 'review_only_not_authorized_for_import', bundleHash, manifest, records, assets: archive.assets });
await save('asset-manifest.json', { uploadPerformed: false, publicDisplayApproved: false, assets: archive.assets,
  assessments: records.map(r => ({ assessmentId: r.runtime.id, references: r.links })) });
await save('import-plan.json', {
  status: 'proposal_only_requires_user_approval', databaseInspected: false, databaseWritten: false,
  proposedDatabase: 'assessment_config_prototype', proposedSchema: 'pod_assessment_prototype',
  design: 'One immutable JSONB version per assessment; catalogue points to active version. Never one giant database JSON row.',
  tables: { assessment_library: 'Catalogue and active version pointer', assessment_versions: 'Original extraction and configured runtime JSONB per version', assessment_assets: 'Content-addressed file metadata', assessment_version_assets: 'Version-to-file references', assessment_imports: 'Import manifest and provenance' },
  baseline: 'Comparison below is against the local JSON only, not the shared database.',
  activation: 'Do not activate automatically. First import into an isolated staging database/schema after approval, review, then explicitly promote selected versions.',
  operations: records.map(r => ({ assessmentId: r.runtime.id, localBaselineVersion: baselineMap.get(r.runtime.id).versionId, proposedVersion: r.runtime.versionId, scoringUnchanged: true, proposal: 'insert immutable version if absent; leave shared active version unchanged until separately approved' })),
  expectedDatabaseRowChanges: 'Unknown: no database connection was made.',
  patientRecordChanges: 0, assetUploads: 0, schemaChangesExecuted: 0,
  rollback: 'Before later promotion, capture active-version pointers. Restore those pointers if necessary; retain immutable historical versions and patient snapshots.',
  sharedDatabasePrecautions: ['Verify existing schema compatibility in a read-only preflight after approval.', 'Use a transaction and an advisory import lock.', 'Recheck expected active versions before promotion to avoid overwriting concurrent work.', 'No patient data migration; retain the definition version used by every saved administration.'],
});
await save('README.md', `# Local assessment review\n\nPrepared ${manifest.assessments} definitions, ${manifest.scoringRules} existing draft rules and ${manifest.previewPages} synthetic preview pages.\n\nOpen index.html, or run the dedicated preview server. Neither preparation nor preview connects to a database, reads .env files, starts the main app, or uploads assets.\n\n- definitions/: one complete runtime JSON per assessment.\n- profiles/: one report configuration per assessment, embedded in its definition.\n- reviews/: assessment-specific gaps and synthetic validation results.\n- assessment-library.json: combined runtime export for a later approved workflow.\n- import-candidate.json: private raw/runtime/asset records; NOT an approved import.\n- import-plan.json: proposed table mapping and activation precautions, not a database diff.\n- readiness.csv and readiness.json: coverage and limitations.\n- asset-manifest.json: checksum-verified local source files and proposed object keys. No upload occurred.\n\nAll definitions remain clinically unapproved. Technical checks cover ${manifest.syntheticCases} generated cases. Independent supplied source fixtures cover only ${benchmarks.assessments.length} instruments (${assertions} assertions), not all ${records.length}. Do not infer source-report equivalence from a passing technical check. Source thresholds, norm conversions and specialised report graphs require instrument-specific verification. No new normative data was invented.\n\nThe review renderer uses each embedded reporting.reportPlan. It does not load individual profile files as a runtime fallback. PHQ-9's earlier supplementary profile is preserved but disabled in this review pending reference selection.\n\nTo revise configuration, change the preparation code/reviewed source inputs and regenerate into a NEW output directory; do not hand-edit one copy of a generated definition without rebuilding and validating the bundle. The live runtime JSON and shared active versions are untouched.\n\nPDF: use Print / save PDF from any preview. All previews are self-contained and make no external asset requests.\n`);
await save('index.html', reviewCatalogueHtml(manifest, reviews));
await writeFile(join(out, 'checksums.json'), JSON.stringify(written, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ output: out, ...manifest }, null, 2));
if (manifest.technicalPass !== manifest.assessments) process.exitCode = 1;
