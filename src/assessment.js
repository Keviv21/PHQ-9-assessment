import { readFileSync } from 'node:fs';
import { formTranslations } from './form-translations.js';

export const form = Object.freeze(JSON.parse(readFileSync(new URL('../data/phq9.json', import.meta.url), 'utf8')));
export const hindiForm = Object.freeze(JSON.parse(readFileSync(new URL('../data/phq9.hi.json', import.meta.url), 'utf8')));
export const languages = Object.freeze([
  { code: 'en', name: 'English', speechCode: 'en-US' },
  { code: 'hi', name: 'Hindi (हिन्दी)', speechCode: 'hi-IN' },
  { code: 'mr', name: 'Marathi (मराठी)', speechCode: 'mr-IN' },
  { code: 'es', name: 'Spanish (Español)', speechCode: 'es-ES' },
  { code: 'bn', name: 'Bengali (বাংলা)', speechCode: 'bn-IN' },
  { code: 'te', name: 'Telugu (తెలుగు)', speechCode: 'te-IN' },
  { code: 'ta', name: 'Tamil (தமிழ்)', speechCode: 'ta-IN' },
  { code: 'gu', name: 'Gujarati (ગુજરાતી)', speechCode: 'gu-IN' },
  { code: 'kn', name: 'Kannada (ಕನ್ನಡ)', speechCode: 'kn-IN' },
  { code: 'ml', name: 'Malayalam (മലയാളം)', speechCode: 'ml-IN' },
  { code: 'pa', name: 'Punjabi (ਪੰਜਾਬੀ)', speechCode: 'pa-IN' },
  { code: 'or', name: 'Odia (ଓଡ଼ିଆ)', speechCode: 'or-IN' },
  { code: 'ur', name: 'Urdu (اردو)', speechCode: 'ur-IN' },
  { code: 'as', name: 'Assamese (অসমীয়া)', speechCode: 'as-IN' },
  { code: 'ar', name: 'Arabic (العربية)', speechCode: 'ar-SA' },
  { code: 'zh', name: 'Chinese Simplified (简体中文)', speechCode: 'zh-CN' },
  { code: 'zh-TW', name: 'Chinese Traditional (繁體中文)', speechCode: 'zh-TW' },
  { code: 'cs', name: 'Czech (Čeština)', speechCode: 'cs-CZ' },
  { code: 'da', name: 'Danish (Dansk)', speechCode: 'da-DK' },
  { code: 'nl', name: 'Dutch (Nederlands)', speechCode: 'nl-NL' },
  { code: 'fil', name: 'Filipino (Tagalog)', speechCode: 'fil-PH' },
  { code: 'fi', name: 'Finnish (Suomi)', speechCode: 'fi-FI' },
  { code: 'fr', name: 'French (Français)', speechCode: 'fr-FR' },
  { code: 'de', name: 'German (Deutsch)', speechCode: 'de-DE' },
  { code: 'el', name: 'Greek (Ελληνικά)', speechCode: 'el-GR' },
  { code: 'he', name: 'Hebrew (עברית)', speechCode: 'he-IL' },
  { code: 'hu', name: 'Hungarian (Magyar)', speechCode: 'hu-HU' },
  { code: 'id', name: 'Indonesian (Bahasa Indonesia)', speechCode: 'id-ID' },
  { code: 'it', name: 'Italian (Italiano)', speechCode: 'it-IT' },
  { code: 'ja', name: 'Japanese (日本語)', speechCode: 'ja-JP' },
  { code: 'ko', name: 'Korean (한국어)', speechCode: 'ko-KR' },
  { code: 'ms', name: 'Malay (Bahasa Melayu)', speechCode: 'ms-MY' },
  { code: 'no', name: 'Norwegian (Norsk)', speechCode: 'no-NO' },
  { code: 'fa', name: 'Persian (فارسی)', speechCode: 'fa-IR' },
  { code: 'pl', name: 'Polish (Polski)', speechCode: 'pl-PL' },
  { code: 'pt', name: 'Portuguese (Português)', speechCode: 'pt-PT' },
  { code: 'ro', name: 'Romanian (Română)', speechCode: 'ro-RO' },
  { code: 'ru', name: 'Russian (Русский)', speechCode: 'ru-RU' },
  { code: 'sv', name: 'Swedish (Svenska)', speechCode: 'sv-SE' },
  { code: 'th', name: 'Thai (ไทย)', speechCode: 'th-TH' },
  { code: 'tr', name: 'Turkish (Türkçe)', speechCode: 'tr-TR' },
  { code: 'uk', name: 'Ukrainian (Українська)', speechCode: 'uk-UA' },
  { code: 'vi', name: 'Vietnamese (Tiếng Việt)', speechCode: 'vi-VN' },
]);
const ids = Array.from({ length: 9 }, (_, index) => `Q${String(index + 1).padStart(2, '0')}`);

for (const assessmentForm of [form, hindiForm]) {
  if (assessmentForm.formId !== 'phq9' || assessmentForm.questions.length !== 9 ||
      assessmentForm.questions.some((question, index) => question.id !== ids[index] || !question.text?.trim()) ||
      assessmentForm.options.length !== 4 || assessmentForm.options.some((option, index) => option.value !== index || !option.label?.trim())) {
    throw new Error(`The ${assessmentForm.language} PHQ-9 form is invalid.`);
  }
}

export function getForm(language = 'en') {
  if (!languages.some((item) => item.code === language)) {
    throw new RangeError(`Unsupported language: ${language}`);
  }
  if (language === 'en') return form;
  if (language === 'hi') return hindiForm;
  const translation = formTranslations.phq9?.[language];
  if (translation) {
    return {
      ...form,
      language,
      title: translation.title || form.title,
      shortTitle: translation.shortTitle || form.shortTitle,
      referencePeriod: translation.referencePeriod || form.referencePeriod,
      instructions: translation.instructions || form.instructions,
      intro: translation.intro || form.intro,
      options: translation.options || form.options,
      questions: translation.questions || form.questions,
    };
  }
  return { ...form, language };
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
