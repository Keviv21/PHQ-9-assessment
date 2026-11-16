import { readFileSync } from 'node:fs';

const input = process.argv[2];
if (!input) throw new Error('Pass a source bundle path.');
const source = JSON.parse(readFileSync(input, 'utf8'));
const methodCounts = {};
const ruleKeys = {};
const responseTypes = {};
const remaining = {};
const valueFields = {};
const samples = {};
const withoutRules = [];
const noQuestionnaire = [];
const approvalCounts = {};
const itemSamples = {};
const conditionalSamples = [];
const ruleSpecials = [];
for (const record of source.assessments) {
  if (!record.questionnaire?.items?.length) noQuestionnaire.push({ id: record.assessment_id, name: record.assessment?.name });
  if (!record.scoring?.rules?.length) withoutRules.push({ id: record.assessment_id, name: record.assessment?.name,
    status: record.scoring?.status, remainingWork: record.scoring?.remaining_work });
  const approval = String(record.review?.ready_for_clinical_use);
  approvalCounts[approval] = (approvalCounts[approval] || 0) + 1;
  for (const item of record.questionnaire?.items || []) {
    const type = item.response_type || 'missing';
    responseTypes[type] = (responseTypes[type] || 0) + 1;
    if (!itemSamples[type]) itemSamples[type] = { assessment: record.assessment_id, item };
    if (item.display_if && conditionalSamples.length < 3) conditionalSamples.push({assessment:record.assessment_id, item:item.id, display_if:item.display_if});
  }
  for (const rule of record.scoring?.rules || []) {
    const method = rule.method || 'missing';
    methodCounts[method] = (methodCounts[method] || 0) + 1;
    if (!samples[method]) samples[method] = { assessment: record.assessment_id, rule };
    const field = rule.value_field || 'missing';
    valueFields[field] = (valueFields[field] || 0) + 1;
    for (const key of Object.keys(rule)) ruleKeys[key] = (ruleKeys[key] || 0) + 1;
    if (['applies_if','option_value_overrides','item_transforms','context_constraints','optional_item_ids'].some(key=>key in rule) && ruleSpecials.length < 8) ruleSpecials.push({assessment:record.assessment_id,rule});
  }
  const status = record.scoring?.implementation_status?.raw_calculation || 'missing';
  remaining[status] = (remaining[status] || 0) + 1;
}
const first = source.assessments[0];
console.log(JSON.stringify({
  records: source.assessments.length, methodCounts, responseTypes, valueFields,
  ruleKeys, rawCalculationStatus: remaining,
  approvalCounts, withoutRules, noQuestionnaire, samples,
  firstRecord: {
    id: first.assessment_id,
    scoringStatus: first.scoring?.status,
    scoringKeys: Object.keys(first.scoring || {}),
    rule: first.scoring?.rules?.[0],
    remainingWork: first.scoring?.remaining_work,
    item: first.questionnaire?.items?.[0],
    responseSet: first.questionnaire?.response_sets?.[0],
  },
  itemSamples, conditionalSamples, ruleSpecials,
}, null, 2));
