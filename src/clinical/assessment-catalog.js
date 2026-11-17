import { readFileSync } from 'node:fs';

// Prototype-curated metadata. Clinical approval is still required before real patient use.
const entries = JSON.parse(readFileSync(new URL('../../data/clinical/assessment-catalog.json', import.meta.url), 'utf8'));
const concernSet = new Set(['depression', 'anxiety', 'traumaSymptoms', 'stress']);
const statuses = new Set(['available', 'separate_prototype']);

if (!Array.isArray(entries) || new Set(entries.map((entry) => entry.id)).size !== entries.length ||
    entries.some((entry) => !/^[a-z][a-z0-9]*$/.test(entry.id) || !entry.title || !entry.purpose ||
      !Array.isArray(entry.concerns) || !entry.concerns.length || entry.concerns.some((item) => !concernSet.has(item)) ||
      ![1, 2].includes(entry.priority) || !statuses.has(entry.availability) ||
      !Array.isArray(entry.languages) || !entry.languages.length || !entry.catalogDraftId ||
      !entry.source?.startsWith('https://') || !entry.reason ||
      (entry.preventiveReason && (!Array.isArray(entry.preventiveAgeGroups) || !entry.preventiveAgeGroups.length)) ||
      (entry.matchWhenAny && (!Array.isArray(entry.matchWhenAny) || !entry.matchWhenAny.length || entry.matchWhenAny.some((item) => !entry.concerns.includes(item)))) ||
      (entry.matchWhenAll && (!Array.isArray(entry.matchWhenAll) || !entry.matchWhenAll.length || entry.matchWhenAll.some((item) => !entry.concerns.includes(item)))))) {
  throw new Error('Assessment catalogue metadata is invalid.');
}

export function listAssessmentCatalog() {
  return structuredClone(entries);
}

export function getCatalogEntry(id) {
  const entry = entries.find((item) => item.id === id);
  return entry ? structuredClone(entry) : null;
}

// Structured retrieval over a small catalogue. No AI model or vector search is needed yet.
export function retrieveAssessmentCandidates(concerns, ageGroup) {
  const selected = new Set(concerns);
  if (!selected.size) {
    return entries.filter((entry) => entry.preventiveReason && entry.preventiveAgeGroups?.includes(ageGroup))
      .map((entry) => ({ ...structuredClone(entry), matchedConcerns: [], preventive: true }));
  }
  return entries.filter((entry) => entry.matchWhenAny || entry.matchWhenAll
    ? entry.matchWhenAny?.some((concern) => selected.has(concern)) || entry.matchWhenAll?.every((concern) => selected.has(concern))
    : entry.concerns.some((concern) => selected.has(concern)))
    .map((entry) => ({ ...structuredClone(entry), matchedConcerns: entry.concerns.filter((concern) => selected.has(concern)), preventive: false }));
}
