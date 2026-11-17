import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../../data/legacy/draft-assessments.json', import.meta.url), 'utf8'));
if (!Array.isArray(data.records) || data.records.length !== data.sourceCount ||
    new Set(data.records.map((record) => record.id)).size !== data.records.length) {
  throw new Error('The assessment library import is invalid.');
}

const records = new Map(data.records.map((record) => [record.id, record]));

export function listDraftAssessments() {
  return data.records.map(({ id, title, referencePeriod, sourceUrl, extractedItemCount,
    incompleteItems, previewAvailable, reviewStatus }) => ({
    id, title, referencePeriod, sourceUrl, extractedItemCount,
    incompleteItems, previewAvailable, reviewStatus,
  }));
}

export function getDraftAssessment(id) {
  const record = records.get(id);
  return record ? structuredClone(record) : null;
}

export function getLiveDraftForm(id) {
  const record = records.get(id);
  if (!record?.previewAvailable) return null;
  return {
    formId: record.id,
    version: 'imported-draft-v1',
    language: 'en',
    title: record.title,
    referencePeriod: record.referencePeriod,
    instructions: record.instructions,
    source: record.sourceUrl,
    draft: true,
    questions: record.questions.map((question) => ({
      id: question.id,
      text: question.text,
      options: question.options.map((option, value) => ({ value, label: option.label })),
    })),
  };
}
