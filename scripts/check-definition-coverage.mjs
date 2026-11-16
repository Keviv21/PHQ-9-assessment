import { listDefinitions, getDefinition } from '../src/definition-library.js';
import { scoreDefinition } from '../src/definition-scoring.js';

const report = { total: 0, noQuestions: [], noRules: [], allCalculated: 0, partial: 0, noneCalculated: [],
  calculatedRules: 0, withheldRules: 0, withheldReasons: {}, withheldCases: [],
  conditionKeys: {}, ineligiblePolicies: {}, outsideDeclaredRange: [] };
for (const entry of listDefinitions()) {
  report.total++;
  const form = getDefinition(entry.id);
  for (const item of form.questions) if (item.displayIf) {
    const key = item.displayIf.context_key ? `context:${item.displayIf.context_key}` :
      item.displayIf.any ? 'any' : item.displayIf.all ? 'all' : item.displayIf.operator ?? 'other';
    report.conditionKeys[key] = (report.conditionKeys[key] || 0) + 1;
  }
  for (const rule of form.rules) if (rule.ineligible_item_policy) report.ineligiblePolicies[rule.ineligible_item_policy] =
    (report.ineligiblePolicies[rule.ineligible_item_policy] || 0) + 1;
  if (!form.questions.length) report.noQuestions.push(form.title);
  if (!form.rules.length) report.noRules.push(form.title);
  const answers = {};
  for (const item of form.questions) {
    if (['choice', 'single_choice'].includes(item.responseType)) answers[item.id] = item.options[0]?.id;
    else if (item.responseType === 'multiple_choice') answers[item.id] = [item.options[0]?.id];
    else if (item.responseType === 'integer' || item.responseType === 'number') answers[item.id] = item.inputSpec?.answer_schema?.minimum ?? 0;
    else if (item.responseType === 'text') answers[item.id] = 'Example';
  }
  const result = scoreDefinition(form, answers, { attends_school: true, works_or_studies: true, source_scoring_sex: 'female' });
  report.calculatedRules += result.calculatedCount;
  report.withheldRules += result.withheldCount;
  for (const metric of result.metrics) if (metric.value !== null &&
    ((Number.isFinite(metric.minimum) && metric.value < metric.minimum) ||
      (Number.isFinite(metric.maximum) && metric.value > metric.maximum))) {
    report.outsideDeclaredRange.push({ assessment: form.title, rule: metric.id, value: metric.value,
      minimum: metric.minimum, maximum: metric.maximum });
  }
  if (form.rules.length && result.calculatedCount === form.rules.length) report.allCalculated++;
  else if (result.calculatedCount) report.partial++;
  else if (form.rules.length) report.noneCalculated.push(form.title);
  for (const metric of result.metrics.filter((metric) => metric.value === null)) {
    report.withheldReasons[metric.reason] = (report.withheldReasons[metric.reason] || 0) + 1;
    report.withheldCases.push({ assessment: form.title, rule: metric.id, reason: metric.reason });
  }
}
console.log(JSON.stringify(report, null, 2));
