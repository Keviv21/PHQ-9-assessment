import { getAssessmentEntry } from './assessment-source.js';

const core = {
  phq9: { id: 'patient-health-questionnaire-depression-phq-9--8f81b7b3270c', referencePeriod: 'Past two weeks' },
  gad7: { id: 'generalised-anxiety-disorder-assessment-gad-7--265a24c61d94', referencePeriod: 'Past two weeks' },
  pcl5: { id: 'ptsd-checklist-5-pcl-5--5a88422b610e', referencePeriod: 'Past month' },
};

function displayLabel(value) {
  const text = String(value || '').trim();
  return text === text.toUpperCase() ? text.toLowerCase().replace(/^./, (letter) => letter.toUpperCase()) : text;
}

export function getCoreAssessmentForm(formId) {
  const config = core[formId];
  const entry = config && getAssessmentEntry(config.id);
  if (!entry) throw new Error(`Missing ${formId} in the assessment source.`);
  const items = [...(entry.questionnaire?.items || [])].sort((left, right) => left.order - right.order);
  const firstOptions = items[0]?.options || [];
  const expectedCount = { phq9: 9, gad7: 7, pcl5: 20 }[formId];
  if (items.length !== expectedCount || firstOptions.length !== (formId === 'pcl5' ? 5 : 4) ||
      items.some((item, index) => item.id !== `Q${index + 1}` || !item.text?.trim() ||
        item.options?.length !== firstOptions.length || item.options.some((option, value) => option.score !== value))) {
    throw new Error(`Invalid ${formId} questions or response anchors in the assessment source.`);
  }
  return {
    formId, language: 'en', version: 'v1-prototype',
    title: entry.assessment?.name || formId.toUpperCase(),
    referencePeriod: config.referencePeriod,
    instructions: entry.administration?.instructions || '',
    source: entry.references?.find((reference) => reference.url?.startsWith('https://'))?.url || '',
    options: firstOptions.map((option, value) => ({ value, label: displayLabel(option.text), description: displayLabel(option.text) })),
    questions: items.map((item, index) => ({ id: `Q${String(index + 1).padStart(2, '0')}`, text: item.text })),
  };
}
