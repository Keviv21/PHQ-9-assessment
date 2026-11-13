import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendAssessments } from '../src/recommendation.js';
import { getCatalogEntry, listAssessmentCatalog } from '../src/assessment-catalog.js';
import { getAssessmentForm } from '../src/forms.js';

const context = (changes = {}) => ({
  ageGroup: '19to64', concerns: [], traumaExposure: 'notReported', safetyStatus: 'noneReported', ...changes,
});

test('routes specific adult concerns to relevant measures with reasons', () => {
  const result = recommendAssessments(context({ concerns: ['depression', 'anxiety', 'stress'] }));
  assert.equal(result.status, 'suggestions');
  assert.deepEqual(result.recommendations.map((item) => item.id), ['gad7', 'phq9', 'dass21']);
  assert.ok(result.recommendations.every((item) => item.reason && item.source.startsWith('https://')));
});

test('PCL-5 requires trauma exposure review', () => {
  const pending = recommendAssessments(context({ concerns: ['traumaSymptoms'], traumaExposure: 'uncertain' }));
  assert.equal(pending.recommendations[0].availability, 'requires_trauma_review');
  assert.match(pending.recommendations[0].missingInformation[0], /trauma exposure/);
  assert.match(pending.recommendations[0].reason, /must be confirmed/);
  const confirmed = recommendAssessments(context({ concerns: ['traumaSymptoms'], traumaExposure: 'confirmed' }));
  assert.equal(confirmed.recommendations[0].availability, 'available');
});

test('prototype catalogue maps runnable forms to supported languages and keeps DASS separate', () => {
  const catalog = listAssessmentCatalog();
  assert.equal(catalog.length, 4);
  for (const entry of catalog.filter((item) => item.availability === 'available')) {
    for (const language of entry.languages) assert.equal(getAssessmentForm(entry.id, language).language, language);
  }
  assert.equal(getCatalogEntry('dass21').availability, 'separate_prototype');
  assert.equal(getCatalogEntry('unknown'), null);
});

test('safety concern pauses all questionnaire suggestions', () => {
  const result = recommendAssessments(context({ concerns: ['depression'], safetyStatus: 'concern' }));
  assert.equal(result.status, 'safety_review');
  assert.deepEqual(result.recommendations, []);
  assert.equal(recommendAssessments(context({ safetyStatus: 'notReviewed' })).status, 'needs_review');
});

test('age restrictions and older-adult anxiety caveat are explicit', () => {
  assert.equal(recommendAssessments(context({ ageGroup: 'under19' })).status, 'needs_review');
  assert.equal(recommendAssessments(context({ ageGroup: 'unknown' })).status, 'needs_review');
  const older = recommendAssessments(context({ ageGroup: '65plus', concerns: ['anxiety'] }));
  assert.match(older.recommendations[0].note, /insufficient/);
  assert.deepEqual(recommendAssessments(context()).recommendations.map((item) => item.id), ['gad7', 'phq9']);
  assert.deepEqual(recommendAssessments(context({ ageGroup: '65plus' })).recommendations.map((item) => item.id), ['phq9']);
});

test('rejects identifiers, free text, and malformed contexts', () => {
  assert.throws(() => recommendAssessments(context({ patientId: '123' })), /Only de-identified/);
  assert.throws(() => recommendAssessments(context({ notes: 'private' })), /Only de-identified/);
  assert.throws(() => recommendAssessments(context({ concerns: ['depression', 'depression'] })), /valid concerns/);
  assert.throws(() => recommendAssessments(context({ safetyStatus: 'false' })), /safety review/);
});
