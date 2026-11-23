import { readFileSync } from 'node:fs';

const source = JSON.parse(readFileSync(new URL('../data/all-assessments.json', import.meta.url), 'utf8'));
if (!Array.isArray(source.assessments) || source.assessments.length !== 186 ||
    new Set(source.assessments.map((entry) => entry.assessment_id)).size !== 186) {
  throw new Error('The assessment source must contain 186 unique records.');
}

export const assessmentSourceVersion = source.bundle_version;
export const assessmentSourceSha256 = source.appMetadata?.sourceSha256;
export const assessmentCategories = source.appMetadata?.categories || {};
export const recommendationCatalog = source.appMetadata?.recommendationCatalog || [];
export const legacyDraftRecords = source.appMetadata?.legacyDraftRecords || [];
export const assessmentEntries = source.assessments;
const byId = new Map(assessmentEntries.map((entry) => [entry.assessment_id, entry]));

export function getAssessmentEntry(id) { return byId.get(id) || null; }
