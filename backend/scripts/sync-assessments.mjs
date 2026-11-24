import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Pass the source all-assessments.json path.');

const destination = new URL('../data/all-assessments.json', import.meta.url);
const raw = readFileSync(inputPath);
const source = JSON.parse(raw);
const ids = source.assessments?.map((entry) => entry.assessment_id);
if (!Array.isArray(ids) || ids.length !== 186 || new Set(ids).size !== 186) {
  throw new Error('Expected 186 unique assessments in the source file.');
}

const previous = JSON.parse(readFileSync(destination, 'utf8'));
const categories = previous.appMetadata?.categories;
const recommendationCatalog = previous.appMetadata?.recommendationCatalog;
const legacyDraftRecords = previous.appMetadata?.legacyDraftRecords;
if (!categories || typeof categories !== 'object' || !Array.isArray(recommendationCatalog) ||
    recommendationCatalog.length !== 4 || !Array.isArray(legacyDraftRecords) || legacyDraftRecords.length !== 186) {
  throw new Error('The bundled assessment categories, recommendation metadata, or legacy snapshots are incomplete.');
}

source.appMetadata = {
  sourceSha256: createHash('sha256').update(raw).digest('hex'),
  categories,
  recommendationCatalog,
  legacyDraftRecords,
};
writeFileSync(destination, JSON.stringify(source));
console.log(`Synchronized ${ids.length} assessments into data/all-assessments.json.`);
