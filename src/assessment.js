import { readFileSync } from 'node:fs';

export const form = Object.freeze(JSON.parse(readFileSync(new URL('../data/phq9.json', import.meta.url), 'utf8')));
export const languages = Object.freeze([{ code: 'en', name: 'English', speechCode: 'en-IN' }]);
const ids = Array.from({ length: 9 }, (_, index) => `Q${String(index + 1).padStart(2, '0')}`);

if (form.formId !== 'phq9' || form.questions.length !== 9 ||
    form.questions.some((question, index) => question.id !== ids[index] || !question.text?.trim()) ||
    form.options.length !== 4 || form.options.some((option, index) => option.value !== index || !option.label?.trim())) {
  throw new Error('The PHQ-9 form is invalid.');
}

export function getForm(language = 'en') {
  if (language !== 'en') throw new RangeError('Only the verified English PHQ-9 form is available.');
  return form;
}

export function assertAnswer(value) {
  if (!Number.isInteger(value) || value < 0 || value > 3) throw new RangeError('An answer must be an integer from 0 to 3.');
}

export function scoreAnswers(answers) {
  if (!Array.isArray(answers) || answers.length !== 9) throw new RangeError('A completed PHQ-9 needs exactly 9 answers.');
  answers.forEach(assertAnswer);
  const rawTotal = answers.reduce((total, value) => total + value, 0);
  const severity = rawTotal <= 4 ? 'minimal' : rawTotal <= 9 ? 'mild' : rawTotal <= 14 ? 'moderate' : rawTotal <= 19 ? 'moderately severe' : 'severe';
  return {
    scoringVersion: 'phq9-v1',
    rawTotal,
    severity,
    item9Value: answers[8],
    requiresHumanFollowUp: answers[8] > 0,
  };
}

export function currentQuestion(number, language = 'en') {
  if (!Number.isInteger(number) || number < 1 || number > 9) return null;
  const question = getForm(language).questions[number - 1];
  return { number, total: 9, id: question.id, text: question.text };
}
