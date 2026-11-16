// This registry contains only scoring rules checked against the cited source.
// Imported option indexes are not scores for other assessments.
export const dass21DraftId = 'depression-anxiety-stress-scales-short-form-dass-21--acf13d5bf87b';
export const dass21Source = 'https://novopsych.com/assessments/depression/depression-anxiety-stress-scales-short-form-dass-21/';

const subscaleItems = {
  depression: [3, 5, 10, 13, 16, 17, 21],
  anxiety: [2, 4, 7, 9, 15, 19, 20],
  stress: [1, 6, 8, 11, 12, 14, 18],
};
const bands = {
  total: [[16, 'Normal'], [20, 'Mild'], [25, 'Moderate'], [29, 'Severe'], [63, 'Extremely severe']],
  depression: [[4, 'Normal'], [6, 'Mild'], [10, 'Moderate'], [13, 'Severe'], [21, 'Extremely severe']],
  anxiety: [[3, 'Normal'], [4, 'Mild'], [7, 'Moderate'], [9, 'Severe'], [21, 'Extremely severe']],
  stress: [[7, 'Normal'], [9, 'Mild'], [12, 'Moderate'], [16, 'Severe'], [21, 'Extremely severe']],
};

export function scoreImportedAssessment(formId, values) {
  if (formId !== dass21DraftId) return null;
  if (!Array.isArray(values) || values.length !== 21 || values.some((value) =>
    !Number.isInteger(value) || value < 0 || value > 3)) {
    throw new RangeError('DASS-21 requires exactly 21 responses from 0 to 3.');
  }
  const rawSubscales = Object.fromEntries(Object.entries(subscaleItems).map(([name, items]) =>
    [name, items.reduce((sum, number) => sum + values[number - 1], 0)]));
  const rawTotal = values.reduce((sum, value) => sum + value, 0);
  const severity = Object.fromEntries(Object.entries({ total: rawTotal, ...rawSubscales }).map(([name, raw]) =>
    [name, bands[name].find(([maximum]) => raw <= maximum)[1]]));
  return {
    scoringVersion: 'dass21-novopsych-raw-v1',
    source: dass21Source,
    rawTotal,
    rawSubscales,
    dass42EquivalentSubscales: Object.fromEntries(Object.entries(rawSubscales).map(([name, raw]) => [name, raw * 2])),
    severity,
    interpretation: 'Symptom severity, not a diagnosis. Percentiles are not calculated.',
  };
}
