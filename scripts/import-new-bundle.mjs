import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const path = process.argv[2];
if (!path) throw new Error('Pass the cleaned assessment JSON path.');
const raw = readFileSync(path);
const source = JSON.parse(raw);
if (!Array.isArray(source.assessments) || source.assessments.length !== 186) throw new Error('Expected 186 assessment records.');
const records = source.assessments.map((entry) => ({
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
  remainingWork: entry.scoring?.remaining_work ?? [],
  clinicallyApproved: entry.review?.ready_for_clinical_use === true,
  questionnaireVerified: entry.review?.questionnaire_completeness_verified === true,
  reviewIssues: (entry.review?.issues ?? []).map(({ code, detail }) => ({ code, detail })),
}));
if (new Set(records.map(({ id }) => id)).size !== records.length) throw new Error('Duplicate assessment ID.');
const output = {
  version: '2026-11-16-source-draft-v1',
  sourceSha256: createHash('sha256').update(raw).digest('hex'),
  importedAt: new Date().toISOString(),
  records,
};
writeFileSync(new URL('../data/assessment-definitions-20261116.json', import.meta.url), JSON.stringify(output));
console.log(`Imported ${records.length} definitions, ${records.filter((r) => r.questions.length).length} with questions, ${records.filter((r) => r.rules.length).length} with draft scoring rules.`);
