import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const file = resolve(process.argv[2] || 'data/assessments/gad-7.json');
const definition = JSON.parse(await readFile(file, 'utf8'));

const required = [
  'schemaVersion', 'id', 'version', 'versionId', 'title', 'description',
  'administration', 'referencePeriod', 'language', 'metadata', 'questions',
  'rules', 'reporting', 'references', 'verification', 'provenance',
  'exceptionReport',
];
for (const key of required) assert.ok(Object.hasOwn(definition, key), `Missing ${key}.`);
assert.equal(definition.schemaVersion, '1.0.0');
assert.match(definition.versionId, /^[a-f0-9]{64}$/);
assert.ok(definition.questions.length > 0, 'Questionnaire is empty.');

const questionIds = definition.questions.map(({ id }) => id);
assert.equal(new Set(questionIds).size, questionIds.length, 'Question IDs must be unique.');
definition.questions.forEach((question, index) => {
  assert.equal(question.order, index + 1, `Unexpected order for ${question.id}.`);
  assert.ok(question.text?.trim(), `Missing text for ${question.id}.`);
  assert.ok(Array.isArray(question.options), `Missing options for ${question.id}.`);
  assert.equal(new Set(question.options.map(({ id }) => id)).size, question.options.length,
    `Option IDs must be unique within ${question.id}.`);
});

const ruleIds = new Set();
for (const rule of definition.rules) {
  assert.ok(!ruleIds.has(rule.id), `Duplicate rule ${rule.id}.`);
  ruleIds.add(rule.id);
  for (const itemId of rule.item_ids) assert.ok(questionIds.includes(itemId),
    `Rule ${rule.id} references unknown item ${itemId}.`);
  if (rule.severity_bands?.length) {
    const bands = [...rule.severity_bands].sort((a, b) => a.minimum_inclusive - b.minimum_inclusive);
    assert.equal(bands[0].minimum_inclusive, rule.minimum, `${rule.id} bands do not start at the minimum.`);
    assert.equal(bands.at(-1).maximum_inclusive, rule.maximum, `${rule.id} bands do not end at the maximum.`);
    for (let index = 1; index < bands.length; index += 1) {
      assert.equal(bands[index].minimum_inclusive, bands[index - 1].maximum_inclusive + 1,
        `${rule.id} severity bands overlap or have a gap.`);
    }
  }
}

for (const metric of definition.reporting.metrics) {
  assert.ok(ruleIds.has(metric.rule_id), `Report metric references unknown rule ${metric.rule_id}.`);
}
for (const chart of definition.reporting.reportPlan.charts) {
  const metric = definition.reporting.reportPlan.metrics.find(({ id }) => id === chart.metricId);
  assert.ok(metric, `Chart ${chart.id} references unknown metric ${chart.metricId}.`);
  assert.equal(chart.minimum, metric.minimum, `Chart ${chart.id} minimum differs from its metric.`);
  assert.equal(chart.maximum, metric.maximum, `Chart ${chart.id} maximum differs from its metric.`);
  assert.ok(chart.title?.trim(), `Chart ${chart.id} has no title.`);
  assert.ok(chart.colour, `Chart ${chart.id} has no colour policy.`);
}

const sample = definition.provenance.sampleReport;
assert.equal(Object.keys(sample.answers).length, definition.questions.length,
  'Sample report does not contain one answer per question.');
const sampleScores = new Map(definition.questions.map((question) => [
  question.id,
  new Map(question.options.map((option) => [option.id, option.score])),
]));
for (const comparison of sample.comparison.comparisons) {
  const rule = definition.rules.find(({ id }) => id === comparison.metricId);
  assert.ok(rule, `Sample comparison references unknown rule ${comparison.metricId}.`);
  const actual = rule.item_ids.reduce((total, itemId) => {
    const optionId = sample.answers[itemId];
    assert.ok(sampleScores.get(itemId).has(optionId), `Invalid sample answer for ${itemId}.`);
    return total + sampleScores.get(itemId).get(optionId);
  }, 0) * (rule.multiplier ?? 1);
  assert.equal(actual, comparison.expected, `Sample score mismatch for ${comparison.metricId}.`);
  assert.equal(comparison.actual, comparison.expected, `Stored comparison failed for ${comparison.metricId}.`);
}

const serialized = JSON.stringify(definition);
assert.doesNotMatch(serialized, /(?:^|["'])\/(?:home|Users)\//, 'Canonical JSON contains an absolute local path.');
assert.doesNotMatch(serialized, /local-data\//, 'Canonical JSON depends on local-data.');
assert.deepEqual(definition.exceptionReport.missingScoringRules, []);
assert.deepEqual(definition.exceptionReport.imageOnlyTables, []);

console.log(JSON.stringify({
  status: 'passed',
  file,
  assessmentId: definition.id,
  questions: definition.questions.length,
  scoringRules: definition.rules.length,
  reportCharts: definition.reporting.reportPlan.charts.length,
  sampleComparisons: sample.comparison.comparisons.length,
  openManualReviewItems: definition.exceptionReport.manualReview.length,
}, null, 2));
