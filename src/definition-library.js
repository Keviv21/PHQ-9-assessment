import { readFileSync } from 'node:fs';
import { displayTitle, displayText } from './assessment-content.js';

const bundle = JSON.parse(readFileSync(new URL('../data/assessment-definitions-20261116.json', import.meta.url), 'utf8'));
const libraryCategories = JSON.parse(readFileSync(new URL('../data/assessment-library-categories.json', import.meta.url), 'utf8'));
let records = bundle.records;
let byId = new Map(records.map((record) => [record.id, record]));
if (byId.size !== 186) throw new Error('The cleaned assessment bundle is incomplete.');

export const definitionVersion = bundle.version;
export const sourceSha256 = bundle.sourceSha256;
export function useStoredDefinitions(definitions) {
  if (!definitions.length) return false;
  if (new Set(definitions.map(d => d.id)).size !== definitions.length) throw new Error('Duplicate stored definition.');
  records = definitions;
  byId = new Map(records.map(record => [record.id, record]));
  return true;
}
export function listDefinitions() {
  return records.map(({ id, title, description, questions, rules, scoringStatus, clinicallyApproved, versionId,
    questionnaireVerified, reviewIssues, referencePeriod }) => ({ id, title: displayTitle(title), description: displayText(description),
    versionId, questionCount: questions.length, ruleCount: rules.length, available: questions.length > 0,
    categories: libraryCategories[id] || ['Other'],
    referencePeriod: referencePeriod?.structured?.label ||
      referencePeriod?.instruction_claims?.find((claim) => /\b(?:past|last|previous)\s+\d*\s*(?:day|week|month|year)/i.test(claim)) || '',
    responseTypes: [...new Set(questions.map((question) => question.responseType))],
    scoringStatus, clinicallyApproved, questionnaireVerified,
    reviewIssues: reviewIssues.map(({ code }) => code) }));
}
export function getDefinition(id) { return byId.get(id) ?? null; }
