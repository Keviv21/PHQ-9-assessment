import { readFileSync } from 'node:fs';
import { form as phq9, hindiForm as phq9Hindi, scoreAnswers as scorePhq9 } from './assessment.js';

const gad7 = JSON.parse(readFileSync(new URL('../data/gad7.json', import.meta.url), 'utf8'));
const pcl5 = JSON.parse(readFileSync(new URL('../data/pcl5.json', import.meta.url), 'utf8'));
const forms = { phq9: { en: phq9, hi: phq9Hindi }, gad7: { en: gad7 }, pcl5: { en: pcl5 } };
export const formIds = Object.freeze(Object.keys(forms));

for (const [formId, translations] of Object.entries(forms)) {
  for (const [language, form] of Object.entries(translations)) {
    const count = { phq9: 9, gad7: 7, pcl5: 20 }[formId];
    const max = formId === 'pcl5' ? 4 : 3;
    if (form.formId !== formId || form.language !== language || form.questions.length !== count ||
        form.questions.some((question, index) => question.id !== `Q${String(index + 1).padStart(2, '0')}` || !question.text?.trim()) ||
        form.options.length !== max + 1 || form.options.some((option, index) => option.value !== index || !option.label?.trim())) {
      throw new Error(`Invalid ${formId} ${language} questionnaire.`);
    }
  }
}

export function getAssessmentForm(formId, language = 'en') {
  const form = forms[formId]?.[language];
  if (!form) throw new RangeError('Unsupported assessment or language.');
  return form;
}

export function assertAssessmentAnswer(formId, value) {
  const max = getAssessmentForm(formId).options.length - 1;
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`An answer must be an integer from 0 to ${max}.`);
}

export function assessmentQuestion(formId, number, language = 'en') {
  const form = getAssessmentForm(formId, language);
  if (!Number.isInteger(number) || number < 1 || number > form.questions.length) return null;
  return { number, total: form.questions.length, ...form.questions[number - 1] };
}

export function scoreAssessment(formId, answers) {
  const form = getAssessmentForm(formId);
  if (!Array.isArray(answers) || answers.length !== form.questions.length) {
    throw new RangeError(`A completed ${formId.toUpperCase()} needs exactly ${form.questions.length} answers.`);
  }
  answers.forEach((value) => assertAssessmentAnswer(formId, value));
  if (formId === 'phq9') return { ...scorePhq9(answers), maxTotal: 27 };
  const rawTotal = answers.reduce((sum, value) => sum + value, 0);
  if (formId === 'gad7') return {
    scoringVersion: 'gad7-v1', rawTotal, maxTotal: 21,
    severity: rawTotal <= 4 ? 'minimal' : rawTotal <= 9 ? 'mild' : rawTotal <= 14 ? 'moderate' : 'severe',
    requiresHumanFollowUp: false,
  };
  return {
    scoringVersion: 'pcl5-v1', rawTotal, maxTotal: 80,
    severity: null, requiresHumanFollowUp: false,
  };
}
