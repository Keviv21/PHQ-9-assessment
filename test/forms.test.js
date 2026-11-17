import test from 'node:test';
import assert from 'node:assert/strict';
import { getAssessmentForm, scoreAssessment } from '../src/legacy/forms.js';
import { openStore } from '../src/storage/sqlite/standard-store.js';

test('GAD-7 and PCL-5 imported forms have the expected item and response ranges', () => {
  const gad7 = getAssessmentForm('gad7');
  const pcl5 = getAssessmentForm('pcl5');
  assert.equal(gad7.questions.length, 7);
  assert.deepEqual(gad7.options.map((item) => item.value), [0, 1, 2, 3]);
  assert.equal(pcl5.questions.length, 20);
  assert.deepEqual(pcl5.options.map((item) => item.value), [0, 1, 2, 3, 4]);
  assert.throws(() => getAssessmentForm('pcl5', 'hi'), /Unsupported/);
});

test('GAD-7 bands are deterministic and PCL-5 has a total without an invented severity band', () => {
  for (const [total, expected] of [[0, 'minimal'], [4, 'minimal'], [5, 'mild'], [9, 'mild'],
    [10, 'moderate'], [14, 'moderate'], [15, 'severe'], [21, 'severe']]) {
    const values = Array(7).fill(0);
    let remaining = total;
    for (let index = 0; index < values.length; index++) { values[index] = Math.min(3, remaining); remaining -= values[index]; }
    assert.equal(scoreAssessment('gad7', values).severity, expected);
  }
  assert.deepEqual(scoreAssessment('pcl5', Array(20).fill(4)), {
    scoringVersion: 'pcl5-v1', rawTotal: 80, maxTotal: 80, severity: null, requiresHumanFollowUp: false,
  });
  assert.throws(() => scoreAssessment('pcl5', Array(19).fill(0)), /exactly 20/);
  assert.throws(() => scoreAssessment('gad7', [4, ...Array(6).fill(0)]), /0 to 3/);
});

test('GAD-7 and PCL-5 persisted sessions accept their full response ranges', () => {
  const store = openStore(':memory:');
  try {
    for (const [formId, count, value, maxTotal] of [['gad7', 7, 3, 21], ['pcl5', 20, 4, 80]]) {
      let state = store.create('demo', 'en', 'demo-a', formId);
      for (let number = 1; number <= count; number++) state = store.record(state.id, number, value, 'demo');
      assert.equal(state.status, 'review');
      state = store.finalize(state.id, Array(count).fill(value));
      assert.equal(state.scores.rawTotal, maxTotal);
      assert.equal(state.answers.length, count);
    }
  } finally { store.close(); }
});
