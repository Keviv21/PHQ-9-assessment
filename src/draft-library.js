import { dass21DraftId } from './draft-scoring.js';
import { assessmentCategories, legacyDraftRecords } from './assessment-source.js';

if (legacyDraftRecords.length !== 186) throw new Error('Legacy draft snapshots are missing.');
const records = new Map(legacyDraftRecords.map((record) => [record.id, record]));

export function listDraftAssessments() {
  return [...records.values()].map(({ id, title, description, referencePeriod, sourceUrl, extractedItemCount,
    incompleteItems, previewAvailable, reviewStatus }) => ({
    id, title, description, referencePeriod, sourceUrl, extractedItemCount,
    incompleteItems, previewAvailable, reviewStatus, categories: assessmentCategories[id] || ['Other'],
    scoringAvailable: id === dass21DraftId,
  }));
}

export function getDraftAssessment(id) {
  const record = records.get(id);
  return record ? { ...structuredClone(record), scoringAvailable: id === dass21DraftId } : null;
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
    scoringAvailable: id === dass21DraftId,
    questions: record.questions.map((question) => ({
      id: question.id,
      text: question.text,
      options: question.options.map((option, value) => ({ value, label: option.label })),
    })),
  };
}
