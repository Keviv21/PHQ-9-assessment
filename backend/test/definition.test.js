import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { getDefinition, listDefinitions } from '../src/definition-library.js';
import { conditionState, scoreDefinition, validateAnswer } from '../src/definition-scoring.js';
import { openDefinitionStore } from '../src/definition-store.js';
import { createDefinitionVoiceStore, nextDefinitionItem, voiceDefinitionState } from '../src/definition-voice.js';

test('cleaned catalogue preserves all source records and identifies missing questionnaire', () => {
  const entries = listDefinitions();
  assert.equal(entries.length, 186);
  assert.equal(entries.filter((entry) => entry.available).length, 185);
  assert.equal(entries.filter((entry) => entry.ruleCount > 0).length, 183);
  assert.equal(entries.filter((entry) => entry.clinicallyApproved).length, 0);
  const asrs = entries.find((entry) => entry.id === 'adult-adhd-self-report-scale-asrs--814829bfeff1');
  assert.equal(asrs.referencePeriod, 'past 6 months');
  assert.ok(asrs.responseTypes.includes('choice'));
  assert.deepEqual(asrs.categories, ['ADHD', 'Diagnosis']);
  assert.ok(entries.every((entry) => entry.categories.length > 0));
  assert.equal(entries.filter((entry) => entry.categories.includes('Sport')).length, 4);
  assert.equal(entries.filter((entry) => entry.categories.includes('Trauma')).length, 12);
  const bam = entries.find((entry) => entry.id === 'brief-addiction-monitor-bam--dce6e8665d04');
  assert.ok(bam.responseTypes.includes('integer'));
});

test('draft rule uses printed option values and withholds missing required responses', () => {
  const form = getDefinition('adult-adhd-self-report-scale-asrs--814829bfeff1');
  const answers = Object.fromEntries(form.questions.map((item) => [item.id, item.options[0].id]));
  const complete = scoreDefinition(form, answers);
  assert.equal(complete.metrics.find((metric) => metric.id === 'part_a_raw').value, 0);
  delete answers.Q1;
  const incomplete = scoreDefinition(form, answers);
  assert.equal(incomplete.metrics.find((metric) => metric.id === 'part_a_raw').value, null);
});

test('multiple choice exclusivity and conditional display are checked', () => {
  const form = getDefinition('multilevel-assessment-of-psychopathology-mapsy--b575b63dbe1c');
  const trigger = form.questions.find((item) => item.id === 'Q74');
  const branch = form.questions.find((item) => item.id === 'Q75');
  assert.throws(() => validateAnswer(trigger, ['O1', 'O8']));
  assert.deepEqual(validateAnswer(trigger, ['O1', 'O2']), ['O1', 'O2']);
  assert.equal(conditionState(branch.displayIf, { Q74: ['O1'] }, form.questions), true);
  assert.equal(conditionState(branch.displayIf, { Q74: ['O8'] }, form.questions), false);
});

test('context-dependent branches and skip-scoring policies are explicit', () => {
  const form = getDefinition('crafft-substance-use-assessment-crafft-2-1-n--74bd92c2de16');
  const answers = Object.fromEntries(form.questions.map((item) => [item.id,
    item.options.length ? item.options[0].id : item.inputSpec?.answer_schema?.minimum ?? 0]));
  const branch = form.questions.find((item) => item.id === 'Q6');
  assert.equal(conditionState(branch.displayIf, answers, form.questions), false);
  const result = scoreDefinition(form, answers);
  assert.equal(result.metrics.find((metric) => metric.id === 'source_draft_1').value, 0);
  const whodas = getDefinition('the-world-health-organisation-disability-assessment-schedule-whodas-child--ba92f6f5986e');
  const school = whodas.questions.find((item) => item.id === 'Q25');
  assert.equal(conditionState(school.displayIf, {}, whodas.questions, { attends_school: true }), true);
  assert.equal(conditionState(school.displayIf, {}, whodas.questions, { attends_school: false }), false);
});

test('assigned assessment saves a snapshot and a draft report', async () => {
  const store = openDefinitionStore({ path: ':memory:' });
  try {
    const form = getDefinition('adult-adhd-self-report-scale-asrs--814829bfeff1');
    const prescription = await store.prescribe('demo-a', form.id);
    const session = await store.start(prescription.id);
    const answers = Object.fromEntries(form.questions.map((item) => [item.id, item.options[0].id]));
    const saved = await store.save(session.id, answers);
    assert.equal(saved.status, 'in_progress');
    const completed = await store.save(session.id, answers, true);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.scores.metrics.find((metric) => metric.id === 'part_a_raw').value, 0);
    assert.deepEqual((await store.getSession(session.id)).formSnapshot, form);
    assert.equal((await store.patientPrescriptions('demo-a'))[0].status, 'completed');
  } finally { await store.close(); }
});

test('BAM opens with choice and numeric questions and saves both response types', async () => {
  const store = openDefinitionStore({ path: ':memory:' });
  try {
    const form = getDefinition('brief-addiction-monitor-bam--dce6e8665d04');
    assert.equal(form.questions[0].responseType, 'choice');
    assert.equal(form.questions[1].responseType, 'integer');
    const prescription = await store.prescribe('demo-a', form.id);
    const session = await store.start(prescription.id);
    const saved = await store.save(session.id, { Q1: form.questions[0].options[0].id, Q2: 5 });
    assert.deepEqual(saved.answers, { Q1: form.questions[0].options[0].id, Q2: 5 });
    assert.equal((await store.getSession(session.id)).formSnapshot.title, form.title);
  } finally { await store.close(); }
});

test('BAM numeric skip conditions and three composite scores work together', async () => {
  const form = getDefinition('brief-addiction-monitor-bam--dce6e8665d04');
  const question = (id) => form.questions.find((item) => item.id === id);
  assert.equal(conditionState(question('Q5').displayIf, { Q4: 0 }, form.questions), false);
  assert.equal(conditionState(question('Q5').displayIf, { Q4: 3 }, form.questions), true);
  assert.equal(conditionState(question('Q7').displayIf, { Q6: 0 }, form.questions), false);
  assert.equal(conditionState(question('Q7').displayIf, { Q6: 2 }, form.questions), true);
  const voiceState = { status: 'in_progress', formSnapshot: form,
    answers: { Q1: 'O3', Q2: 5, Q3: 2, Q4: 0 }, context: {} };
  assert.equal(nextDefinitionItem(voiceState).item.id, 'Q6');
  voiceState.answers.Q6 = 0;
  assert.equal(nextDefinitionItem(voiceState).item.id, 'Q14');

  const answers = {
    Q1: 'O3', Q2: 5, Q3: 2, Q4: 0, Q6: 0, Q14: 'O2', Q15: 'O1', Q16: 4,
    Q17: 3, Q18: 'O2', Q19: 6, Q20: 'O2', Q21: 'O4', Q22: 7, Q23: 'O5',
  };
  const store = openDefinitionStore({ path: ':memory:' });
  try {
    const prescription = await store.prescribe('demo-a', form.id);
    const session = await store.start(prescription.id);
    const completed = await store.save(session.id, answers, true);
    assert.equal(completed.status, 'completed');
    assert.deepEqual(Object.fromEntries(completed.scores.metrics.map(({ label, value }) => [label, value])), {
      'Substance Use': 0, 'Risk Factors': 55, 'Protective Factors': 55,
    });
    assert.equal(completed.scores.status, 'source_draft_unapproved');
  } finally { await store.close(); }
});

test('voice flow validates a proposed answer and skips a hidden branch after confirmation', async () => {
  const questions = [
    { id: 'Q1', text: 'Trigger?', responseType: 'choice', options: [
      { id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }] },
    { id: 'Q2', text: 'Follow-up?', responseType: 'text', inputSpec: { answer_schema: { minLength: 1 } },
      displayIf: { item_id: 'Q1', operator: 'equals', value: 'yes' } },
    { id: 'Q3', text: 'Final?', responseType: 'integer', inputSpec: { answer_schema: { minimum: 0, maximum: 10 } } },
  ];
  let state = { id: 'session', status: 'in_progress', answers: {}, context: {}, formSnapshot: { questions } };
  const store = createDefinitionVoiceStore({ getSession: async () => state,
    save: async (_id, answers) => { state = { ...state, answers }; return state; } });
  assert.equal((await store.get('session')).currentNumber, 1);
  await assert.rejects(store.record('session', 1, 'maybe', 'voice', 'Maybe.'), /Invalid choice/);
  assert.deepEqual(state.answers, {});
  assert.equal((await store.record('session', 1, 'no', 'voice', 'No.')).currentNumber, 3);
  assert.deepEqual((await store.record('session', 3, 2, 'voice', 'Two.')).answers, { Q1: 'no', Q3: 2 });
  assert.equal(voiceDefinitionState(state).status, 'review');
});

test('all available source questionnaires expose a sequence of voice items', () => {
  for (const entry of listDefinitions().filter((item) => item.available)) {
    const form = getDefinition(entry.id);
    const state = { status: 'in_progress', formSnapshot: form, answers: {},
      context: { attends_school: true, works_or_studies: true, source_scoring_sex: 'female' } };
    const seen = new Set();
    for (let step = 0; step < form.questions.length; step++) {
      const next = nextDefinitionItem(state);
      if (!next) break;
      assert.ok(!seen.has(next.item.id), `${entry.id}: repeated ${next.item.id}`);
      seen.add(next.item.id);
      const item = next.item;
      const schema = item.inputSpec?.answer_schema ?? {};
      const value = item.responseType === 'multiple_choice' ? [item.options[0].id] :
        ['choice', 'single_choice'].includes(item.responseType) ? item.options[0].id :
          item.responseType === 'text' ? 'a'.repeat(schema.minLength ?? 1) : schema.minimum ?? 0;
      validateAnswer(item, value);
      state.answers[item.id] = value;
    }
    assert.equal(nextDefinitionItem(state), null, `${entry.id}: questionnaire did not end`);
  }
});

test('new browser flow scripts parse', () => {
  for (const file of ['../frontend/src/controllers/definition.js', '../frontend/src/controllers/definition-voice.js', '../frontend/src/controllers/clinic.js', 'src/server.js']) {
    const result = spawnSync(process.execPath, ['--check', file], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  }
  assert.match(readFileSync(new URL('../../frontend/src/pages/DefinitionPage.jsx', import.meta.url), 'utf8'), /definition-inline-report/);
});
