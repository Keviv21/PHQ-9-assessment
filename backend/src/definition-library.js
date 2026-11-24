import { assessmentCategories, assessmentEntries, assessmentSourceSha256, assessmentSourceVersion } from './assessment-source.js';

const records = assessmentEntries.map((entry) => ({
  id: entry.assessment_id,
  version: entry.definition_version,
  title: entry.assessment?.name ?? entry.assessment_id,
  description: entry.assessment?.description ?? '',
  administration: entry.administration?.instructions ?? null,
  referencePeriod: entry.assessment?.reference_period ?? null,
  sourceUrl: entry.references?.find?.((reference) => /^https:\/\//.test(reference.url))?.url ?? null,
  questions: (entry.questionnaire?.items ?? []).map((item) => ({
    id: item.id, order: item.order, text: item.text,
    responseType: item.response_type, selectionMode: item.selection_mode,
    inputSpec: item.input_spec, displayIf: item.display_if ?? null,
    options: item.options ?? [],
  })),
  rules: entry.scoring?.rules ?? [],
  scoringStatus: entry.scoring?.status ?? 'missing',
  scoringLimitations: entry.scoring?.limitations ?? [],
  remainingWork: entry.reporting?.coverage?.remaining_work ?? entry.scoring?.remaining_work ?? [],
  protocol: entry.scoring?.protocol ?? null,
  pairedProfile: entry.scoring?.paired_profile ?? null,
  reporting: entry.reporting,
  clinicallyApproved: entry.scoring?.enabled === true && entry.reporting?.clinical_scoring_enabled === true &&
    entry.review?.ready_for_clinical_use === true,
  questionnaireVerified: entry.review?.questionnaire_completeness_verified === true,
  reviewIssues: (entry.review?.issues ?? []).map(({ code, detail }) => ({ code, detail })),
}));
const byId = new Map(records.map((record) => [record.id, record]));
if (byId.size !== 186) throw new Error('The cleaned assessment bundle is incomplete.');

export const definitionVersion = assessmentSourceVersion;
export const sourceSha256 = assessmentSourceSha256;
export function listDefinitions() {
  return records.map(({ id, title, description, questions, rules, scoringStatus, clinicallyApproved,
    questionnaireVerified, reviewIssues, referencePeriod }) => ({ id, title, description,
    questionCount: questions.length, ruleCount: rules.length, available: questions.length > 0,
    categories: assessmentCategories[id] || ['Other'],
    referencePeriod: referencePeriod?.structured?.label ||
      referencePeriod?.instruction_claims?.find((claim) => /\b(?:past|last|previous)\s+\d*\s*(?:day|week|month|year)/i.test(claim)) || '',
    responseTypes: [...new Set(questions.map((question) => question.responseType))],
    scoringStatus, clinicallyApproved, questionnaireVerified,
    reviewIssues: reviewIssues.map(({ code }) => code) }));
}
export function getDefinition(id) { return byId.get(id) ?? null; }
