import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoringRuntimeHash } from '../src/assessment-content.js';
import { scoreDefinition } from '../src/definition-scoring.js';
import { prepareReportDefinition, validateReportDefinition, sampleAnswers, previewReport, definitionReview } from '../src/assessment-review.js';
import { reviewReportHtml } from '../src/assessment-review-html.js';
const library = JSON.parse(readFileSync(new URL('../data/assessment-library.json', import.meta.url))).records;
const prepared = library.map(prepareReportDefinition);

test('all 186 plans preserve scoring and cover every source metric without enabling interpretation', () => {
  assert.equal(prepared.length, 186);
  assert.equal(prepared.reduce((n, d) => n + d.rules.length, 0), 729);
  for (const [i, d] of prepared.entries()) {
    assert.equal(scoringRuntimeHash(d), library[i].runtimeHash, d.id);
    assert.deepEqual(d.questions, library[i].questions);
    assert.deepEqual(d.rules, library[i].rules);
    assert.deepEqual(validateReportDefinition(d), [], d.id);
    assert.equal(d.reporting.reportPlan.clinicalApproved, false);
    assert.ok(d.reporting.reportPlan.charts.every(c => c.colour === 'neutral'));
  }
});

test('all synthetic inputs respect questionnaire validation and all missing results are withheld', () => {
  for (const d of prepared) {
    const review = definitionReview(d, {});
    assert.deepEqual(review.errors, [], d.id);
    assert.deepEqual(review.unexercisedRuleIds, [], d.id);
    assert.equal(review.syntheticCases.find(c => c.variant === 'missing').calculated, 0, d.id);
  }
});

test('single-visit, repeated-visit and missing previews use only saved metric values and correct chart counts', () => {
  const d = prepared.find(d => d.id.startsWith('patient-health-questionnaire-depression-phq-9--'));
  const audit = definitionReview(d, {});
  const single = previewReport(d);
  single.metrics[0].value = 8; // Renderer must not rescore the synthetic responses.
  const html = reviewReportHtml(d, single, audit);
  assert.match(html, /: 8 score, range 0 to 27/);
  assert.doesNotMatch(html, /data-chart="visit_trend"/);
  assert.doesNotMatch(html, /community_cumulative|reference_distributions/);
  const repeated = previewReport(d, 'repeated');
  assert.match(reviewReportHtml(d, repeated, audit, 'repeated'), /data-chart="visit_trend"/);
  const missingHtml = reviewReportHtml(d, previewReport(d, 'missing'), audit, 'missing');
  assert.doesNotMatch(missingHtml, /<svg/);
  assert.match(missingHtml, /Required answer/);
  repeated.metrics[0].points[1].value = null;
  const gaps = reviewReportHtml(d, repeated, audit, 'repeated');
  assert.doesNotMatch(gaps, /<polyline/);
  assert.equal((gaps.match(/<circle /g) || []).length, 2);
});

test('descriptive, screening and unavailable reports never acquire numeric charts', () => {
  const special = prepared.filter(d => d.reporting.mode !== 'numeric_scores');
  assert.equal(special.length, 3);
  for (const d of special) {
    assert.deepEqual(d.reporting.reportPlan.charts, []);
    const html = reviewReportHtml(d, previewReport(d), definitionReview(d, {}));
    assert.doesNotMatch(html, /<svg/);
    assert.match(html, /No numeric graph/);
  }
});

test('changed scoring, chart-rule mismatch and unsafe report content are caught or escaped', () => {
  const d = structuredClone(prepared[0]);
  d.rules[0].maximum++;
  assert.ok(validateReportDefinition(d).some(e => /fingerprint/.test(e)));
  const d2 = structuredClone(prepared[0]);
  d2.reporting.reportPlan.charts[0].maximum++;
  assert.ok(validateReportDefinition(d2).some(e => /Invalid chart/.test(e)));
  const report = previewReport(prepared[0]);
  report.responses[0].value = '<script>alert(1)</script>';
  const html = reviewReportHtml(prepared[0], report, definitionReview(prepared[0], {}));
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
});

test('context-dependent scoring stays withheld when context is unknown; fixture contexts are explicit', () => {
  const d = prepared.find(d => d.id.startsWith('opioid-risk-tool-'));
  const { answers, context } = sampleAnswers(d);
  assert.equal(context.source_scoring_sex, 'female');
  assert.equal(scoreDefinition(d, answers, {}, { draftScores: true }).calculatedCount, 0);
  const unknown = scoreDefinition(d, {}, {}, { draftScores: true });
  assert.ok(unknown.metrics.every(m => m.value === null));
});
