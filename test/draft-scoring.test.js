import test from 'node:test';
import assert from 'node:assert/strict';
import { dass21DraftId, scoreImportedAssessment } from '../src/draft-scoring.js';
import { getLiveDraftForm } from '../src/draft-library.js';
import { openDraftStore } from '../src/draft-store.js';

test('DASS-21 item mapping and raw severity bands match the published form', () => {
  const form = getLiveDraftForm(dass21DraftId);
  assert.equal(form.questions.length, 21);
  assert.ok(form.questions.every((item, index) => item.id === `Q${index + 1}` && item.options.length === 4));
  assert.deepEqual(scoreImportedAssessment(dass21DraftId, Array(21).fill(0)).rawSubscales,
    { depression: 0, anxiety: 0, stress: 0 });
  const values = Array(21).fill(0);
  for (const number of [3, 5, 10, 13, 16, 17, 21]) values[number - 1] = 2;
  const result = scoreImportedAssessment(dass21DraftId, values);
  assert.equal(result.rawTotal, 14);
  assert.equal(result.severity.total, 'Normal');
  assert.deepEqual(result.rawSubscales, { depression: 14, anxiety: 0, stress: 0 });
  assert.equal(result.dass42EquivalentSubscales.depression, 28);
  assert.equal(result.severity.depression, 'Extremely severe');
  assert.equal(result.severity.anxiety, 'Normal');
  assert.equal(scoreImportedAssessment(dass21DraftId, Array(21).fill(3)).rawTotal, 63);
  assert.equal(scoreImportedAssessment('not-scored', values), null);
  assert.throws(() => scoreImportedAssessment(dass21DraftId, Array(20).fill(0)), RangeError);
});

test('completed DASS-21 assignment returns a score from final reviewed answers', () => {
  const store = openDraftStore(':memory:');
  try {
    const prescription = store.prescribe('demo-d', dass21DraftId);
    assert.equal(prescription.unscored, false);
    const session = store.startPrescription(prescription.id, 'demo');
    for (let number = 1; number <= 21; number++) store.record(session.id, number, 0, 'demo');
    const finalAnswers = Array(21).fill(0);
    finalAnswers[2] = 3;
    const completed = store.finalize(session.id, finalAnswers);
    assert.equal(completed.scores.rawTotal, 3);
    assert.equal(completed.scores.rawSubscales.depression, 3);
    assert.equal(completed.unscored, false);
    assert.equal(store.get(session.id).scores.rawTotal, 3);
    assert.equal(store.analyticsPrescriptionRows()[0].form_id, 'dass21');
    assert.equal(store.patientAnalyticsRows('demo-d')[0].scores.rawTotal, 3);
  } finally { store.close(); }
});
