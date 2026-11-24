import { readFileSync } from 'node:fs';
import { displayTitle, displayText } from './assessment-content.js';
import { scoringRuntimeHash } from './assessment-content.js';

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
export function useStoredReportProfiles(profiles) {
  for (const stored of profiles) {
    const definition = byId.get(stored.assessmentId);
    if (!definition || definition.versionId !== stored.assessmentVersionId) {
      throw new Error(`Report profile assessment version mismatch: ${stored.assessmentId}`);
    }
    if (stored.runtimeProfile.assessmentId !== definition.id ||
        stored.runtimeProfile.scoringHash !== scoringRuntimeHash(definition)) {
      throw new Error(`Report profile scoring hash mismatch: ${stored.assessmentId}`);
    }
    definition.reporting = { ...definition.reporting, analysisProfile: stored.runtimeProfile };
  }
  return profiles.length;
}
export function useStoredReportVisualSpecs(specs) {
  for (const stored of specs) {
    const definition = byId.get(stored.assessmentId);
    if (!definition || definition.versionId !== stored.assessmentVersionId) {
      throw new Error(`Report visual spec assessment version mismatch: ${stored.assessmentId}`);
    }
    const spec = stored.runtimeSpec;
    if (spec.schemaVersion !== 'report-visual-spec/1.0.0' || spec.assessmentId !== definition.id ||
        spec.definitionRef?.assessmentId !== definition.id ||
        spec.definitionRef?.questionnaireItemCount !== definition.questions.length) {
      throw new Error(`Report visual spec definition mismatch: ${stored.assessmentId}`);
    }
    const rules = new Set(definition.rules.map(rule => rule.id));
    if (spec.definitionRef.requiredRuleIds.some(id => !rules.has(id))) {
      throw new Error(`Report visual spec scoring rule mismatch: ${stored.assessmentId}`);
    }
    definition.reporting = { ...definition.reporting, reportVisualSpec: spec };
  }
  return specs.length;
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
