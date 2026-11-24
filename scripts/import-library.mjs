import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { hashBytes, contentHash, normalizeDefinition, validateBundle } from '../src/assessment-content.js';
import { archiveAssets, selectDisplayAssets } from '../src/assessment-assets.js';
import { openAssessmentLibrary } from '../src/assessment-library-store.js';

const args = process.argv.slice(2);
const value = key => args.includes(key) ? args[args.indexOf(key) + 1] : null;
const input = value('--source');
const skipAssets = args.includes('--skip-assets');
if (!input || (!value('--source-root') && !skipAssets)) throw new Error('Usage: npm run library:import -- --source <all-assessments.json> [--skip-assets | --source-root <extraction-directory>] [--dry-run] [--sqlite <file>] [--display-manifest <json>]');
const dryRun = args.includes('--dry-run');
const root = fileURLToPath(new URL('..', import.meta.url));
const assetRoot = resolve(process.env.ASSESSMENT_ASSET_ROOT || join(root, 'local-data/assessment-assets'));
const bytes = await readFile(input), bundleHash = hashBytes(bytes), bundle = validateBundle(JSON.parse(bytes));
const verification = spawnSync(process.env.PYTHON || 'python3', [fileURLToPath(new URL('verify-assessment-evidence.py', import.meta.url)), resolve(input)], { encoding: 'utf8' });
if (verification.status !== 0) throw new Error(verification.stderr || verification.error?.message || 'Source verification failed.');
console.log(verification.stdout.trim());
const assessmentId = value('--assessment-id');
if (assessmentId) {
  if (value('--export')) throw new Error('A targeted import cannot overwrite the full runtime JSON. Use update-phq9-report.mjs for the PHQ-9 file update.');
  bundle.assessments = bundle.assessments.filter(a => a.assessment_id === assessmentId);
  if (bundle.assessments.length !== 1) throw new Error('Unknown assessment ID.');
}

const selections = value('--display-manifest') ? JSON.parse(await readFile(value('--display-manifest'), 'utf8')) : [];
if (!Array.isArray(selections)) throw new Error('Display manifest must be an array.');
if (skipAssets && selections.length) throw new Error('Display assets cannot be selected when --skip-assets is used.');
const archive = skipAssets
  ? { assets: [], links: new Map(bundle.assessments.map((entry) => [entry.assessment_id, []])),
      missing: bundle.assessments.reduce((count, entry) => count + (entry.assets?.length || 0), 0) }
  : await archiveAssets(bundle, { sourceRoot: resolve(value('--source-root')), assetRoot, dryRun });
const records = bundle.assessments.map(raw => {
  const links = archive.links.get(raw.assessment_id);
  const displayAssets = selectDisplayAssets(raw, links, selections);
  const runtime = normalizeDefinition(raw, { bundleHash, verified: true });
  const { versionId: initialId, sourceSha256, ...runtimeContent } = runtime;
  const versionId = contentHash({ raw, displayAssets, runtimeContent,
    ...(displayAssets.length ? { assetReviews: links.filter(a => a.metadata.displayApproved).map(a => a.metadata.displayReview) } : {}) });
  runtime.versionId = versionId;
  runtime.assets = displayAssets.map(a => ({ ...a, url: `/api/assessment-assets/${versionId}/${encodeURIComponent(a.id)}` }));
  return { raw, runtime, links };
});
for (const selection of selections) if (!bundle.assessments.some(a => a.assessment_id === selection.assessmentId)) throw new Error('Unknown assessment in display manifest.');
const { assessments: ignoredAssessments, ...sourceBundleMetadata } = bundle;
const manifest = { bundleHash, assessments: records.length, responseFields: records.reduce((n, r) => n + r.runtime.questions.length, 0),
  scoringRules: records.reduce((n, r) => n + r.runtime.rules.length, 0), uniqueFiles: archive.assets.length,
  archivedBytes: archive.assets.reduce((n, a) => n + a.byteSize, 0), referencesWithoutFiles: archive.missing,
  displayImages: records.reduce((n, r) => n + r.runtime.assets.length, 0), clinicalScoringEnabled: false,
  assetImportMode: skipAssets ? 'metadata_in_definition_only' : 'verified_file_archive',
  sourceBundleVersion: bundle.bundle_version, sourceSchemaVersion: bundle.schema_version,
  sourceStatus: bundle.status, sourceBundleMetadata };
console.log(JSON.stringify({ dryRun, ...manifest }, null, 2));
if (value('--export')) {
  const output = resolve(value('--export'));
  await mkdir(dirname(output), { recursive: true });
  const header = JSON.stringify({ schemaVersion: 1, bundleHash, manifest }).slice(0, -1);
  const exportText = `${header},"records":[\n${records.map(r => JSON.stringify(r.runtime)).join(',\n')}\n]}\n`;
  await writeFile(output, exportText);
  await writeFile(`${output}.sha256`, hashBytes(exportText) + '\n');
  console.log(`Runtime JSON written to ${output}`);
}
if (!dryRun) {
  let pool, library;
  try {
    const sqlite = value('--sqlite');
    if (!sqlite) {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. For an explicit local import pass --sqlite <file>.');
      const url = new URL(process.env.DATABASE_URL);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.searchParams.get('sslmode') !== 'verify-full') throw new Error('PostgreSQL requires sslmode=verify-full.');
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 15000 });
      // Require the existing dev schema: never silently target a different application database.
      const { rows } = await pool.query("SELECT current_database() AS database, to_regnamespace('pod_assessment_prototype') IS NOT NULL AS exists");
      const expectedDatabase = value('--expected-database') || process.env.ASSESSMENT_DATABASE_NAME;
      if (expectedDatabase && rows[0].database !== expectedDatabase) throw new Error('Connected database does not match the requested import destination.');
      if (!rows[0].exists && !args.includes('--initialize-schema')) throw new Error('The selected database has no existing dev schema. Pass --initialize-schema to create the library schema deliberately.');
      console.log(`Import destination: ${rows[0].database}.pod_assessment_prototype`);
    } else if (sqlite !== ':memory:') await mkdir(dirname(resolve(sqlite)), { recursive: true });
    library = openAssessmentLibrary(pool ? { pool } : { path: sqlite });
    await library.initialize();
    console.log(JSON.stringify(await library.importBundle({ bundleHash, records, assets: archive.assets, manifest })));
    const active = await library.activeDefinitions();
    if (records.some(r => !active.some(a => a.id === r.runtime.id && a.versionId === r.runtime.versionId))) throw new Error('Import read-back mismatch.');
    await mkdir(join(root, 'local-data'), { recursive: true, mode: 0o700 });
    await writeFile(join(root, 'local-data/library-import.json'), JSON.stringify({ ...manifest, counts: await library.stats() }, null, 2), { mode: 0o600 });
    console.log('Import committed and read-back verified. Restart the app to load the new active versions.');
  } finally { await library?.close(); await pool?.end(); }
}
