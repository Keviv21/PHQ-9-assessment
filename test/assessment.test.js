import test from 'node:test';
import assert from 'node:assert/strict';
import { form, getForm, currentQuestion, scoreAnswers } from '../src/legacy/assessment.js';
import { openStore } from '../src/storage/sqlite/standard-store.js';

test('PHQ-9 uses nine items and the two-week frequency scale', () => {
  assert.equal(form.questions.length, 9);
  assert.equal(form.referencePeriod, 'Past two weeks');
  assert.deepEqual(form.options.map((option) => option.value), [0, 1, 2, 3]);
  assert.equal(currentQuestion(9).id, 'Q09');
  assert.equal(currentQuestion(10), null);
});

test('Hindi uses fixed PHQ-9 items and the same scored response values', () => {
  const hindi = getForm('hi');
  assert.equal(hindi.language, 'hi');
  assert.equal(hindi.questions.length, 9);
  assert.deepEqual(hindi.questions.map((question) => question.id), form.questions.map((question) => question.id));
  assert.deepEqual(hindi.options.map((option) => option.value), [0, 1, 2, 3]);
  assert.equal(hindi.options[0].label, 'एक भी दिन नहीं');
  assert.equal(currentQuestion(9, 'hi').text, hindi.questions[8].text);
  assert.throws(() => getForm('mr'), /Unsupported/);
  const store = openStore(':memory:');
  try {
    let state = store.create('demo', 'hi');
    assert.equal(state.language, 'hi');
    assert.equal(state.formVersion, hindi.version);
    for (let number = 1; number <= 9; number++) state = store.record(state.id, number, number === 9 ? 1 : 0, 'demo');
    state = store.finalize(state.id, state.answers.map((answer) => answer.value));
    assert.equal(state.scores.rawTotal, 1);
    assert.equal(state.scores.requiresHumanFollowUp, true);
    assert.equal(store.results()[0].language, 'hi');
  } finally { store.close(); }
});

test('score bands and item 9 follow-up are independent', () => {
  const bands = [[0, 'minimal'], [5, 'mild'], [10, 'moderate'], [15, 'moderately severe'], [20, 'severe']];
  for (const [total, severity] of bands) {
    const answers = Array(9).fill(0);
    let remaining = total;
    for (let index = 0; index < 8; index++) { answers[index] = Math.min(3, remaining); remaining -= answers[index]; }
    answers[8] = remaining;
    assert.equal(scoreAnswers(answers).severity, severity);
  }
  const result = scoreAnswers([0, 0, 0, 0, 0, 0, 0, 0, 1]);
  assert.equal(result.rawTotal, 1);
  assert.equal(result.requiresHumanFollowUp, true);
  assert.throws(() => scoreAnswers(Array(8).fill(0)), /exactly 9/);
});

test('final review updates answers before scoring and locks the report', () => {
  const store = openStore(':memory:');
  try {
    let state = store.create('demo');
    for (let number = 1; number <= 9; number++) state = store.record(state.id, number, number === 9 ? 1 : 0, 'demo');
    assert.equal(state.status, 'review');
    assert.equal(state.scores, null);
    assert.equal(store.results().length, 0);
    assert.throws(() => store.finalize(state.id, Array(8).fill(0)), /not ready for final review/);
    assert.equal(store.get(state.id).status, 'review');
    const finalValues = [0, 2, 0, 0, 0, 0, 0, 0, 0];
    state = store.finalize(state.id, finalValues);
    assert.equal(state.status, 'completed');
    assert.equal(state.answers.length, 9);
    assert.equal(state.answers[1].value, 2);
    assert.equal(state.answers[8].value, 0);
    assert.equal(state.scores.rawTotal, 2);
    assert.equal(state.scores.requiresHumanFollowUp, false);
    assert.equal(state.reviewChangeCount, 2);
    assert.equal(store.results()[0].scores.rawTotal, 2);
    assert.throws(() => store.finalize(state.id, finalValues), /not ready/);
    assert.throws(() => store.record(state.id, 9, 1, 'demo'), /already completed/);
  } finally { store.close(); }
});

test('a positive item 9 chosen during final review is flagged', () => {
  const store = openStore(':memory:');
  try {
    let state = store.create('demo');
    for (let number = 1; number <= 9; number++) state = store.record(state.id, number, 0, 'demo');
    state = store.finalize(state.id, [0, 0, 0, 0, 0, 0, 0, 0, 1]);
    assert.equal(state.scores.rawTotal, 1);
    assert.equal(state.scores.requiresHumanFollowUp, true);
  } finally { store.close(); }
});
