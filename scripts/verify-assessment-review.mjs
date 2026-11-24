// Offline import rehearsal: hard-coded in-memory SQLite, never PostgreSQL or .env.
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { contentHash, hashBytes } from '../src/assessment-content.js';
import { validateReportDefinition } from '../src/assessment-review.js';
import { openAssessmentLibrary } from '../src/assessment-library-store.js';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--dir') throw new Error('Usage: node scripts/verify-assessment-review.mjs --dir <review-directory>');
const root = await realpath(resolve(args[1]));
const checksums = JSON.parse(await readFile(join(root, 'checksums.json'), 'utf8'));
for (const entry of checksums) {
  const file = await realpath(resolve(root, entry.path));
  const rel = relative(root, file);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid artifact path.');
  if (hashBytes(await readFile(file)) !== entry.sha256) throw new Error(`Artifact changed: ${entry.path}. Regenerate before import review.`);
}
const candidate = JSON.parse(await readFile(join(root, 'import-candidate.json'), 'utf8'));
if (candidate.kind !== 'review_only_not_authorized_for_import' || candidate.manifest.databaseAccess !== 'none') throw new Error('Invalid review candidate.');
for (const { raw, runtime } of candidate.records) {
  const { versionId, sourceSha256, ...runtimeContent } = runtime;
  if (versionId !== contentHash({ raw, displayAssets: [], runtimeContent })) throw new Error('Version checksum mismatch.');
  const errors = validateReportDefinition(runtime);
  if (errors.length) throw new Error(errors.join('\n'));
}
const library = openAssessmentLibrary({ path: ':memory:' });
let result;
try {
  await library.initialize();
  const first = await library.importBundle(candidate);
  const second = await library.importBundle(candidate);
  const saved = await library.activeDefinitions();
  if (first.added !== candidate.records.length || second.added !== 0 || second.unchanged !== candidate.records.length) throw new Error('Local import is not idempotent.');
  for (const { runtime } of candidate.records) {
    if (contentHash(saved.find(d => d.id === runtime.id)) !== contentHash(runtime)) throw new Error('Read-back content mismatch.');
  }
  const original = candidate.records[0];
  const changed = structuredClone(original);
  changed.runtime.reporting.reportPlan.version = '1.0.0-rehearsal.2';
  const { versionId, sourceSha256, ...runtimeContent } = changed.runtime;
  changed.runtime.versionId = contentHash({ raw: changed.raw, displayAssets: [], runtimeContent });
  await library.importBundle({ ...candidate, records: [changed], assets: [] });
  const old = await library.getVersion(original.runtime.versionId);
  if (contentHash(old.runtime) !== contentHash(original.runtime)) throw new Error('Previous version was modified.');
  result = { status: 'passed', artifactsVerified: checksums.length, database: 'ephemeral SQLite :memory: only', postgresAccess: false,
    definitionsReadBack: saved.length, firstImportAdded: first.added, repeatImportAdded: second.added, previousVersionPreserved: true,
    postgresqlCompatibility: 'Not checked against the shared database. Requires an approved isolated PostgreSQL rehearsal before promotion.', sharedDatabaseChanges: 0 };
} finally { await library.close(); }
await writeFile(join(root, 'local-import-verification.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(result, null, 2));
