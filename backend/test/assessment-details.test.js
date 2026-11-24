import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessmentDetailVersion, getAssessmentDetail } from '../src/assessment-details.js';
import { listDefinitions } from '../src/definition-library.js';

test('new assessment detail bundle covers the full assignable catalogue', () => {
  const bundle = JSON.parse(readFileSync(new URL('../data/all-assessments.json', import.meta.url), 'utf8'));
  assert.equal(assessmentDetailVersion, '2026-11-18-scoring-verification-export');
  assert.equal(bundle.assessments.length, 186);
  for (const definition of listDefinitions()) {
    const detail = getAssessmentDetail(definition.id);
    assert.ok(detail, `Missing detail page for ${definition.id}`);
    assert.equal(detail.questionCount, definition.questionCount);
    assert.ok(detail.categories.length);
  }
  assert.equal(getAssessmentDetail('missing-form'), null);
});

test('ASRS details include source narrative, score components, and a questionnaire preview', () => {
  const asrs = getAssessmentDetail('adult-adhd-self-report-scale-asrs--814829bfeff1');
  assert.equal(asrs.minutes, 3);
  assert.equal(asrs.questionCount, 18);
  assert.ok(asrs.ageLabel.includes('18+'));
  assert.ok(asrs.sections.overview.length);
  assert.ok(asrs.sections.scoring.length);
  assert.ok(asrs.sections.psychometrics.length);
  assert.ok(asrs.reporting.metrics.some((metric) => metric.id === 'total_raw'));
  assert.equal(asrs.previewQuestions.length, 5);
});
