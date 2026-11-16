import { readFileSync } from 'node:fs';

const bundle = JSON.parse(readFileSync(new URL('../data/assessment-definitions-20261116.json', import.meta.url), 'utf8'));
const byId = new Map(bundle.records.map((record) => [record.id, record]));
if (byId.size !== 186) throw new Error('The cleaned assessment bundle is incomplete.');

export const definitionVersion = bundle.version;
export const sourceSha256 = bundle.sourceSha256;
export function listDefinitions() {
  return bundle.records.map(({ id, title, description, questions, rules, scoringStatus, clinicallyApproved,
    questionnaireVerified, reviewIssues }) => ({ id, title, description,
    questionCount: questions.length, ruleCount: rules.length, available: questions.length > 0,
    scoringStatus, clinicallyApproved, questionnaireVerified,
    reviewIssues: reviewIssues.map(({ code }) => code) }));
}
export function getDefinition(id) { return byId.get(id) ?? null; }
